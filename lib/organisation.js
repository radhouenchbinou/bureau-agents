// Organisation définie par l'utilisateur : bureaux, projets, rôles, placements et noms donnés aux agents.
// Stockée dans un fichier JSON ; les fichiers de Claude Code ne sont jamais modifiés.
'use strict';
const fsp = require('fs').promises, path = require('path');

const ACCUEIL = 'accueil';                 // bureau toujours présent, où arrive tout ce qui n'a pas de place
const CLE = /^(s:[\w-]{1,80}|a:[\w-]{1,80}:[\w-]{1,80})$/;
const ID = /^[a-z0-9-]{1,64}$/;
const ROLES = ['chefProjet', 'techLead'];

class ErreurOrganisation extends Error {}
const refus = m => { throw new ErreurOrganisation(m); };

const nouvelle = () => ({ version: 1, bureaux: [{ id: ACCUEIL, nom: 'Accueil' }], projets: [], roles: { chefProjet: null, techLead: null },
  placements: {}, sessionProjet: {}, noms: {}, prix: {}, reglages: { seuilPauseMin: 2 } });

// Complète un fichier ancien ou abîmé sans perdre ce qui est lisible
function normaliser(o) {
  const n = nouvelle();
  if (!o || typeof o !== 'object') return n;
  const bureaux = Array.isArray(o.bureaux) ? o.bureaux.filter(b => b && ID.test(b.id) && typeof b.nom === 'string') : [];
  n.bureaux = bureaux.some(b => b.id === ACCUEIL) ? bureaux : [n.bureaux[0], ...bureaux];
  n.projets = Array.isArray(o.projets) ? o.projets.filter(p => p && ID.test(p.id) && typeof p.nom === 'string')
    .map(p => ({ id: p.id, nom: p.nom, depots: Array.isArray(p.depots) ? p.depots.filter(d => typeof d === 'string') : [], bureau: p.bureau || null, techLead: p.techLead || null })) : [];
  for (const k of ['placements', 'sessionProjet', 'noms', 'prix']) if (o[k] && typeof o[k] === 'object') n[k] = { ...o[k] };
  if (o.roles) for (const r of ROLES) n.roles[r] = o.roles[r] || null;
  if (o.reglages && Number.isFinite(o.reglages.seuilPauseMin)) n.reglages.seuilPauseMin = Math.min(60, Math.max(1, o.reglages.seuilPauseMin));
  return n;
}

const nettoyer = (s, max = 60) => { if (typeof s !== 'string') refus('Nom manquant'); s = s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim(); if (!s) refus('Nom vide'); return s.slice(0, max); };
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
function idLibre(liste, base) { let id = slug(base), i = 2; while (liste.some(x => x.id === id)) id = slug(base) + '-' + i++; return id; }
const bureau = (o, id) => o.bureaux.find(b => b.id === id) || refus('Bureau inconnu');
const projet = (o, id) => o.projets.find(p => p.id === id) || refus('Projet inconnu');
const cle = c => (typeof c === 'string' && CLE.test(c)) ? c : refus('Identifiant d\'agent ou de session invalide');

// Crée un projet (et son bureau) pour chaque dépôt encore inconnu ; renvoie true si l'organisation a changé
function synchroniser(o, sessions) {
  let change = false;
  for (const s of sessions) {
    if (!s.depot || o.sessionProjet[s.cle] || o.projets.some(p => p.depots.includes(s.depot))) continue;
    const b = { id: idLibre(o.bureaux, s.depot), nom: s.depot }; o.bureaux.push(b);
    o.projets.push({ id: idLibre(o.projets, s.depot), nom: s.depot, depots: [s.depot], bureau: b.id, techLead: null });
    change = true;
  }
  return change;
}

// Où se trouve chaque session et chaque agent, à quel projet il appartient et quel nom afficher
function resoudre(o, { sessions, agents }) {
  const bureaux = new Set(o.bureaux.map(b => b.id)), parSession = new Map();
  const projetDe = s => (o.sessionProjet[s.cle] && o.projets.find(p => p.id === o.sessionProjet[s.cle])) || o.projets.find(p => p.depots.includes(s.depot)) || null;
  const valide = b => b && bureaux.has(b) ? b : null;
  const out = { sessions: {}, agents: {} };
  for (const s of sessions) {
    const p = projetDe(s), b = valide(o.placements[s.cle]) || (p && valide(p.bureau)) || ACCUEIL;
    parSession.set(s.cle, { projet: p ? p.id : null, bureau: b });
    out.sessions[s.cle] = { projet: p ? p.id : null, bureau: b, nom: o.noms[s.cle] || s.nomOrigine, renomme: !!o.noms[s.cle] };
  }
  for (const a of agents) {
    const ps = parSession.get(a.session) || { projet: null, bureau: ACCUEIL };
    out.agents[a.cle] = { projet: ps.projet, bureau: valide(o.placements[a.cle]) || ps.bureau, nom: o.noms[a.cle] || a.nomOrigine, renomme: !!o.noms[a.cle] };
  }
  return out;
}

// Applique une opération venue du front ; lève ErreurOrganisation si elle est invalide
function appliquer(o, op) {
  if (!op || typeof op.op !== 'string') refus('Opération manquante');
  switch (op.op) {
    case 'bureau.creer': { const nom = nettoyer(op.nom); const b = { id: idLibre(o.bureaux, nom), nom }; o.bureaux.push(b); return b; }
    case 'bureau.renommer': bureau(o, op.id).nom = nettoyer(op.nom); return;
    case 'bureau.supprimer': {
      if (op.id === ACCUEIL) refus('L\'accueil ne peut pas être supprimé');
      bureau(o, op.id); o.bureaux = o.bureaux.filter(b => b.id !== op.id);
      for (const k of Object.keys(o.placements)) if (o.placements[k] === op.id) delete o.placements[k];
      for (const p of o.projets) if (p.bureau === op.id) p.bureau = null;
      return;
    }
    case 'deplacer': { const c = cle(op.cle); if (op.bureau == null) delete o.placements[c]; else { bureau(o, op.bureau); o.placements[c] = op.bureau; } return; }
    case 'renommer': { const c = cle(op.cle); if (op.nom == null || op.nom === '') delete o.noms[c]; else o.noms[c] = nettoyer(op.nom); return; }
    case 'projet.creer': { const nom = nettoyer(op.nom); const p = { id: idLibre(o.projets, nom), nom, depots: [], bureau: null, techLead: null }; o.projets.push(p); return p; }
    case 'projet.renommer': projet(o, op.id).nom = nettoyer(op.nom); return;
    case 'projet.bureau': { const p = projet(o, op.id); if (op.bureau != null) bureau(o, op.bureau); p.bureau = op.bureau || null; return; }
    case 'projet.fusionner': {
      if (op.source === op.cible) refus('Un projet ne se fusionne pas avec lui-même');
      const s = projet(o, op.source), c = projet(o, op.cible);
      c.depots = [...new Set([...c.depots, ...s.depots])]; if (!c.techLead) c.techLead = s.techLead; if (!c.bureau) c.bureau = s.bureau;
      for (const k of Object.keys(o.sessionProjet)) if (o.sessionProjet[k] === s.id) o.sessionProjet[k] = c.id;
      o.projets = o.projets.filter(p => p.id !== s.id); return;
    }
    case 'session.projet': { const c = cle(op.cle); if (!c.startsWith('s:')) refus('Seule une session change de projet'); if (op.projet == null) delete o.sessionProjet[c]; else { projet(o, op.projet); o.sessionProjet[c] = op.projet; } return; }
    case 'role': { if (!ROLES.includes(op.role)) refus('Rôle inconnu'); o.roles[op.role] = op.cle == null ? null : cle(op.cle); return; }
    case 'reglage': { const v = Number(op.seuilPauseMin); if (!Number.isInteger(v) || v < 1 || v > 60) refus('Seuil entre 1 et 60 minutes'); o.reglages.seuilPauseMin = v; return; }
    case 'projet.techLead': projet(o, op.id).techLead = op.cle == null ? null : cle(op.cle); return;
    default: refus('Opération inconnue : ' + op.op);
  }
}

class StockOrganisation {
  constructor(fichier) { this.fichier = fichier; this.o = nouvelle(); this.file = Promise.resolve(); }
  async charger() { try { this.o = normaliser(JSON.parse(await fsp.readFile(this.fichier, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') console.error('organisation illisible, repartie de zéro :', e.message); } return this.o; }
  // Écritures sérialisées et atomiques (fichier temporaire puis renommage)
  enregistrer() {
    this.file = this.file.then(async () => {
      await fsp.mkdir(path.dirname(this.fichier), { recursive: true });
      const tmp = this.fichier + '.' + process.pid + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(this.o, null, 2)); await fsp.rename(tmp, this.fichier);
    }).catch(e => console.error('organisation non enregistrée :', e.message));
    return this.file;
  }
}

module.exports = { ACCUEIL, ROLES, ErreurOrganisation, nouvelle, normaliser, synchroniser, resoudre, appliquer, StockOrganisation };
