// Index incrémental des transcripts Claude Code (.jsonl) : on ne relit que les octets ajoutés depuis la dernière lecture
'use strict';
const fsp = require('fs').promises;

const GAP_ACTIF_MS = 5 * 60e3;   // deux événements à moins de 5 min d'écart comptent comme du temps actif
const CHUNK = 4 << 20;
const MAX_FICHIERS = 300;        // fichiers modifiés gardés par transcript (pour le compte, pas pour l'affichage)
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

const vide = () => ({ debut: 0, fin: 0, actifMs: 0, outils: 0, erreurs: 0, editions: 0, fichiers: [], commits: 0,
  tokens: { entree: 0, sortie: 0, cacheLu: 0, cacheEcrit: 0 }, modeles: {}, branche: '', cwd: '', consigne: '', dernierMsg: null });

const texte = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join('\n') : '';

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
    const u = m.usage;
    if (u) {
      // Une réponse découpée en plusieurs lignes répète le même usage : on remplace au lieu d'additionner
      const t = { entree: u.input_tokens || 0, sortie: u.output_tokens || 0, cacheLu: u.cache_read_input_tokens || 0, cacheEcrit: u.cache_creation_input_tokens || 0 };
      const p = st.dernierMsg && st.dernierMsg.id === m.id ? st.dernierMsg : null;
      for (const k in t) st.tokens[k] += t[k] - (p ? p.t[k] : 0);
      if (m.model && !p) st.modeles[m.model] = (st.modeles[m.model] || 0) + 1;
      st.dernierMsg = { id: m.id, t, modele: m.model || (p && p.modele) || '' };
    }
    if (Array.isArray(m.content)) for (const c of m.content) {
      if (!c || c.type !== 'tool_use') continue;
      st.outils++;
      const inp = c.input || {};
      if (EDIT_TOOLS.has(c.name)) {
        st.editions++;
        const f = inp.file_path || inp.notebook_path;
        if (f && !st.fichiers.includes(f) && st.fichiers.length < MAX_FICHIERS) st.fichiers.push(f);
      }
      if (c.name === 'Bash' && /\bgit\b[^\n]*\bcommit\b/.test(inp.command || '') && !/--dry-run/.test(inp.command || '')) st.commits++;
    }
  } else if (d.type === 'user') {
    if (Array.isArray(m.content)) { for (const c of m.content) if (c && c.type === 'tool_result' && c.is_error) st.erreurs++; }
    if (!st.consigne) { const t = texte(m.content).trim(); if (t && !t.startsWith('<')) st.consigne = t.replace(/\s+/g, ' ').slice(0, 300); }
  }
}

const VERSION = 2;   // à augmenter quand les compteurs changent : l'index sauvegardé est alors reconstruit

class IndexTranscripts {
  constructor(etat) { this.fichiers = etat && etat.v === VERSION && etat.fichiers ? etat.fichiers : {}; this.modifie = false; }
  // Met à jour les compteurs d'un fichier et les renvoie ; relit tout si le fichier a raccourci
  async lire(f, taille) {
    let e = this.fichiers[f];
    if (!e || taille < e.offset) e = this.fichiers[f] = { offset: 0, stats: vide() };
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
        for (const l of lignes) if (l) appliquer(e.stats, l);
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

module.exports = { IndexTranscripts, appliquer, vide };
