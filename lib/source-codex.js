// Source « Codex » : fils de ~/.codex/sessions (lecture seule, jamais auth.json). Un fil avec parent est un agent de ce fil.
'use strict';
const fsp = require('fs').promises, path = require('path'), os = require('os');
const { resume } = require('./transcript');
const { projetDuDossier } = require('./source-claude');

const OUVERT_MS = 30 * 60e3;       // fil modifié il y a moins de 30 min alors que Codex tourne : encore ouvert
const TOUR_MAX_MS = 15 * 60e3;     // un tour sans écriture depuis 15 min est considéré comme arrêté
const EDITION = /^(apply_patch|write_file|edit_file)$/;

const vide = () => ({ debut: 0, fin: 0, actifMs: 0, outils: 0, erreurs: 0, editions: 0, fichiers: [], commits: 0,
  tokens: { entree: 0, sortie: 0, cacheLu: 0, cacheEcrit: 0 }, modeles: {}, branche: '', cwd: '', consigne: '', enCours: [], dernierOutil: '',
  enTour: false, parent: '', nomAgent: '', id: '' });

function appliquer(st, ligne) {
  let d; try { d = JSON.parse(ligne); } catch { return; }
  const ts = d.timestamp ? Date.parse(d.timestamp) : 0, p = d.payload && typeof d.payload === 'object' ? d.payload : {};
  if (ts) {
    if (!st.debut || ts < st.debut) st.debut = ts;
    if (st.fin && ts > st.fin && ts - st.fin < 5 * 60e3) st.actifMs += ts - st.fin;
    if (ts > st.fin) st.fin = ts;
  }
  if (d.type === 'session_meta') { if (!st.id) { st.id = p.id || ''; st.cwd = p.cwd || ''; st.parent = p.parent_thread_id || ''; st.nomAgent = p.agent_nickname || p.agent_role || ''; } return; }
  if (d.type === 'turn_context') { if (p.cwd) st.cwd = p.cwd; if (p.model) st.modeles[p.model] = (st.modeles[p.model] || 0) + 1; return; }
  if (d.type === 'event_msg') {
    if (p.type === 'task_started') st.enTour = true;
    else if (p.type === 'task_complete' || p.type === 'turn_aborted') { st.enTour = false; st.enCours = []; }
    else if (p.type === 'user_message' && !st.consigne && typeof p.message === 'string' && !p.message.trim().startsWith('<')) st.consigne = p.message.replace(/\s+/g, ' ').trim().slice(0, 300);
    else if (p.type === 'token_count' && p.info && p.info.total_token_usage) {
      // Totaux cumulés du fil : on remplace. Les jetons en cache sont inclus dans l'entrée côté Codex
      const u = p.info.total_token_usage, lu = u.cached_input_tokens || 0, ec = u.cache_write_input_tokens || 0;
      st.tokens = { entree: Math.max(0, (u.input_tokens || 0) - lu - ec), sortie: u.output_tokens || 0, cacheLu: lu, cacheEcrit: ec };
    }
    return;
  }
  if (d.type === 'response_item') {
    if (p.type === 'custom_tool_call' || p.type === 'function_call') {
      st.outils++; st.dernierOutil = p.name || '';
      if (p.call_id && st.enCours.length < 50) st.enCours.push(p.call_id);
      const texte = typeof p.input === 'string' ? p.input : typeof p.arguments === 'string' ? p.arguments : '';
      if (EDITION.test(p.name || '')) st.editions++;
      if (/\bgit\b[^\n]{0,80}\bcommit\b/.test(texte) && !/--dry-run/.test(texte)) st.commits++;
    } else if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') {
      if (p.call_id) st.enCours = st.enCours.filter(i => i !== p.call_id);
      if (p.is_error === true) st.erreurs++;
    }
  }
}
const PARSEUR = { vide, appliquer };

class SourceCodex {
  constructor({ dossier = path.join(os.homedir(), '.codex'), horizonMs = 7 * 864e5, index }) { this.dossier = dossier; this.horizonMs = horizonMs; this.index = index; }

  async titres() {
    const f = path.join(this.dossier, 'session_index.jsonl'), t = new Map();
    let brut = ''; try { brut = await fsp.readFile(f, 'utf8'); } catch { return t; }
    for (const l of brut.split('\n')) { try { const d = JSON.parse(l); if (d.id && d.thread_name) t.set(d.id, d.thread_name); } catch {} }
    return t;
  }
  // Dossiers sessions/AAAA/MM/JJ de l'horizon, sans parcourir tout l'historique
  async fichiers(maintenant) {
    const out = [];
    for (let i = 0; i <= Math.ceil(this.horizonMs / 864e5); i++) {
      const j = new Date(maintenant - i * 864e5), dir = path.join(this.dossier, 'sessions', String(j.getFullYear()), String(j.getMonth() + 1).padStart(2, '0'), String(j.getDate()).padStart(2, '0'));
      let es; try { es = await fsp.readdir(dir); } catch { continue; }
      for (const e of es) if (e.startsWith('rollout-') && e.endsWith('.jsonl')) out.push(path.join(dir, e));
    }
    return out;
  }

  // codexVivant : un processus Codex tourne sur le poste
  async scanner(maintenant = Date.now(), { codexVivant = false } = {}) {
    const titres = await this.titres(), vus = [], lignes = [];
    for (const f of await this.fichiers(maintenant)) {
      let st; try { st = await fsp.stat(f); } catch { continue; }
      if (maintenant - st.mtimeMs > this.horizonMs) continue;
      const stats = await this.index.lire(f, st.size, PARSEUR); vus.push(f);
      // Sans contexte de tour, c'est une session d'un autre outil importée par Codex, pas un agent qui a travaillé
      if (stats.id && Object.keys(stats.modeles).length) lignes.push({ stats, mtime: st.mtimeMs });
    }
    const sessions = [], agents = [], parCle = new Map();
    for (const { stats, mtime } of lignes) {
      const age = maintenant - mtime, travaille = stats.enTour && age < TOUR_MAX_MS, ouvert = codexVivant && age < OUVERT_MS;
      if (stats.parent) continue;
      const s = { cle: 's:' + stats.id, id: stats.id, source: 'codex', niveau: 'complet', nomOrigine: titres.get(stats.id) || (stats.consigne && stats.consigne.slice(0, 60)) || 'Fil Codex',
        cwd: stats.cwd, depot: projetDuDossier(stats.cwd) || 'codex', etat: travaille && codexVivant ? 'active' : ouvert ? 'inactive' : 'terminee', pid: null,
        debut: stats.debut || mtime, derniereActivite: mtime, stats: resume(stats), agents: [] };
      sessions.push(s); parCle.set(s.id, s);
    }
    for (const { stats, mtime } of lignes) {
      if (!stats.parent) continue;
      const par = parCle.get(stats.parent), age = maintenant - mtime; if (!par) continue;
      const a = { cle: 'a:' + par.id + ':' + stats.id, id: stats.id, session: par.cle, source: 'codex', niveau: 'complet', nomOrigine: stats.nomAgent || titres.get(stats.id) || (stats.consigne && stats.consigne.slice(0, 60)) || 'Agent Codex',
        type: 'codex', etat: stats.enTour && age < TOUR_MAX_MS && codexVivant ? 'en_cours' : stats.enTour && !codexVivant ? 'interrompu' : 'termine', arrierePlan: true,
        debut: stats.debut || mtime, derniereActivite: mtime, consigne: stats.consigne, worktree: '', stats: resume(stats) };
      par.agents.push(a.cle); agents.push(a);
    }
    return { sessions, agents, vus };
  }
}

module.exports = { SourceCodex, appliquer, vide };
