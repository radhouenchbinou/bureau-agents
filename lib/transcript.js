// Index incrémental des transcripts Claude Code (.jsonl) : on ne relit que les octets ajoutés depuis la dernière lecture
'use strict';
const fsp = require('fs').promises;
const { masquer } = require('./masque');

const GAP_ACTIF_MS = 5 * 60e3;   // deux événements à moins de 5 min d'écart comptent comme du temps actif
const CHUNK = 4 << 20;
const MAX_FICHIERS = 300;        // fichiers modifiés gardés par transcript (pour le compte, pas pour l'affichage)
const MAX_RECENTS = 64;          // messages récents gardés pour dédoublonner l'usage d'une réponse découpée en plusieurs lignes
const PALIER_HAIKU = 100000;     // Haiku 5.5 : au-delà de 100 000 jetons de prompt, la requête est facturée au palier haut
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const CHAMPS = ['entree', 'sortie', 'cacheLu', 'ecrit5m', 'ecrit1h'];

const vide = () => ({ debut: 0, fin: 0, actifMs: 0, outils: 0, erreurs: 0, editions: 0, fichiers: [], commits: 0,
  tokens: { entree: 0, sortie: 0, cacheLu: 0, cacheEcrit: 0 }, parModele: {}, modeles: {}, branche: '', cwd: '', consigne: '',
  recents: [], enCours: [], commitsEnAttente: [], dernierOutil: '' });

const texte = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join('\n') : '';

// Une commande shell crée-t-elle un commit ? On regarde le début de chaque commande enchaînée (&&, ||, ;, |),
// hors guillemets : « echo "git commit" », --dry-run et --amend ne comptent pas.
function creeUnCommit(cmd) {
  const segs = []; let cur = '', q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"') i++; cur += ' '; continue; }
    if (c === '"' || c === "'") { q = c; cur += ' '; continue; }
    if (c === ';' || c === '\n' || c === '|' || (c === '&' && cmd[i + 1] === '&')) { segs.push(cur); cur = ''; if (cmd[i + 1] === c) i++; continue; }
    cur += c;
  }
  segs.push(cur);
  return segs.some(s => /^\s*(?:[A-Z_][A-Z0-9_]*=\S*\s+)*git(?:\s+-[Cc]\s+\S+)*\s+commit\b/.test(s) && !/\s--(?:dry-run|amend)\b/.test(s));
}
// Usage d'une réponse, réparti par modèle (et par palier pour Haiku 5.5), écritures en cache 5 min et 1 h séparées
function usageDe(m) {
  const u = m.usage || {}, cree = u.cache_creation_input_tokens || 0, e1h = Math.min(cree, (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0);
  const t = { entree: u.input_tokens || 0, sortie: u.output_tokens || 0, cacheLu: u.cache_read_input_tokens || 0, ecrit5m: cree - e1h, ecrit1h: e1h };
  let cle = m.model || 'inconnu';
  if (/haiku-5-5/.test(cle) && t.entree + t.cacheLu + cree > PALIER_HAIKU) cle += '#>100k';
  return { cle, t };
}
function ajouterUsage(st, cle, t, signe) {
  const p = st.parModele[cle] || (st.parModele[cle] = { entree: 0, sortie: 0, cacheLu: 0, ecrit5m: 0, ecrit1h: 0 });
  for (const k of CHAMPS) p[k] += signe * t[k];
  st.tokens.entree += signe * t.entree; st.tokens.sortie += signe * t.sortie; st.tokens.cacheLu += signe * t.cacheLu; st.tokens.cacheEcrit += signe * (t.ecrit5m + t.ecrit1h);
}

// Applique une ligne du transcript aux compteurs. Exportée pour les tests.
function appliquer(st, ligne) {
  // Les lignes api-request* recopient les requêtes entières : inutiles ici et très lourdes à parser
  if (ligne.startsWith('{"type":"api-request')) return;
  let d; try { d = JSON.parse(ligne); } catch { return; }
  const ts = d.timestamp ? Date.parse(d.timestamp) : 0;
  if (ts) {
    if (!st.debut || ts < st.debut) st.debut = ts;
    if (st.fin && ts > st.fin && ts - st.fin < GAP_ACTIF_MS) st.actifMs += ts - st.fin;
    if (ts > st.fin) st.fin = ts;
  }
  if (d.gitBranch) st.branche = d.gitBranch;
  if (d.cwd && !st.cwd) st.cwd = d.cwd;
  const m = d.message; if (!m) return;
  if (d.type === 'assistant') {
    if (m.usage) {
      // Une réponse découpée en plusieurs lignes (parfois entrecoupées d'autres messages) répète son usage :
      // on retire la contribution précédente du même message avant d'ajouter la nouvelle
      const { cle, t } = usageDe(m), i = m.id ? st.recents.findIndex(r => r.id === m.id) : -1;
      if (i >= 0) { const p = st.recents[i]; ajouterUsage(st, p.cle, p.t, -1); st.recents.splice(i, 1); }
      else if (m.model) st.modeles[m.model] = (st.modeles[m.model] || 0) + 1;
      ajouterUsage(st, cle, t, 1);
      if (m.id) { st.recents.push({ id: m.id, cle, t }); if (st.recents.length > MAX_RECENTS) st.recents.shift(); }
    }
    if (Array.isArray(m.content)) for (const c of m.content) {
      if (!c || c.type !== 'tool_use') continue;
      st.outils++; st.dernierOutil = c.name || '';
      if (c.id && st.enCours.length < 50) st.enCours.push(c.id);
      const inp = c.input || {};
      if (EDIT_TOOLS.has(c.name)) {
        st.editions++;
        const f = inp.file_path || inp.notebook_path;
        if (f && !st.fichiers.includes(f) && st.fichiers.length < MAX_FICHIERS) st.fichiers.push(f);
      }
      // Un commit ne compte qu'une fois son résultat reçu sans erreur
      if (c.name === 'Bash' && c.id && creeUnCommit(String(inp.command || '')) && st.commitsEnAttente.length < 50) st.commitsEnAttente.push(c.id);
    }
  } else if (d.type === 'user') {
    if (Array.isArray(m.content)) for (const c of m.content) {
      if (!c || c.type !== 'tool_result') continue;
      if (c.is_error) st.erreurs++;
      if (c.tool_use_id) {
        st.enCours = st.enCours.filter(i => i !== c.tool_use_id);
        const k = st.commitsEnAttente.indexOf(c.tool_use_id);
        if (k >= 0) { st.commitsEnAttente.splice(k, 1); if (!c.is_error) st.commits++; }
      }
    }
    if (!st.consigne) { const t = texte(m.content).trim(); if (t && !t.startsWith('<')) st.consigne = masquer(t.replace(/\s+/g, ' ')).slice(0, 300); }
  }
}

const VERSION = 5;   // à augmenter quand les compteurs changent : l'index sauvegardé est alors reconstruit

const CLAUDE = { vide, appliquer };

class IndexTranscripts {
  constructor(etat) { this.fichiers = etat && etat.v === VERSION && etat.fichiers ? etat.fichiers : {}; this.modifie = false; }
  // Met à jour les compteurs d'un fichier et les renvoie ; relit tout si le fichier a raccourci
  // `parseur` : { vide, appliquer } propre au format de l'outil (Claude Code par défaut)
  async lire(f, taille, parseur = CLAUDE) {
    let e = this.fichiers[f];
    if (!e || taille < e.offset) e = this.fichiers[f] = { offset: 0, stats: parseur.vide() };
    if (taille === e.offset) return e.stats;
    let fh; try {
      fh = await fsp.open(f, 'r');
      const buf = Buffer.alloc(Math.min(CHUNK, taille - e.offset));
      let pos = e.offset, reste = '';
      while (pos < taille) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, taille - pos), pos);
        if (!bytesRead) break;
        pos += bytesRead;
        const lignes = (reste + buf.toString('utf8', 0, bytesRead)).split('\n');
        reste = lignes.pop();
        for (const l of lignes) if (l) parseur.appliquer(e.stats, l);
      }
      // Une ligne incomplète en fin de fichier sera relue au prochain passage
      e.offset = pos - Buffer.byteLength(reste);
      this.modifie = true;
    } catch { /* fichier disparu ou illisible : on garde les derniers compteurs */ }
    finally { if (fh) await fh.close(); }
    return e.stats;
  }
  oublier(garder) { for (const f of Object.keys(this.fichiers)) if (!garder.has(f)) { delete this.fichiers[f]; this.modifie = true; } }
  toJSON() { return { v: VERSION, fichiers: this.fichiers }; }
}

// Compteurs exposés par l'API : on retire l'état interne de l'index et la liste des fichiers
function resume(st) {
  const modele = Object.entries(st.modeles).sort((a, b) => b[1] - a[1])[0];
  return { debut: st.debut, fin: st.fin, actifMs: st.actifMs, outils: st.outils, erreurs: st.erreurs, editions: st.editions,
    fichiers: st.fichiers.length, commits: st.commits, tokens: { ...st.tokens }, parModele: JSON.parse(JSON.stringify(st.parModele || {})),
    modele: modele ? modele[0] : '', branche: st.branche, outilsEnCours: st.enCours.length, dernierOutil: st.dernierOutil };
}

module.exports = { IndexTranscripts, appliquer, vide, resume, creeUnCommit };
