// Indicateurs de rendement : par agent, par session (travail du lead lui-même), puis agrégés par projet, par bureau et au global.
// Un agent compte dans la fenêtre s'il a été actif pendant celle-ci ; ses compteurs portent sur toute sa durée de vie.
'use strict';

// Prix en dollars par million de jetons, par famille de modèle (estimation, remplaçable par org.prix)
const PRIX_DEFAUT = {
  opus: { entree: 15, sortie: 75 }, sonnet: { entree: 3, sortie: 15 }, haiku: { entree: 1, sortie: 5 }, defaut: { entree: 3, sortie: 15 }
};
const CACHE_LU = 0.1, CACHE_ECRIT = 1.25;

function prixDe(modele, grille) {
  const m = (modele || '').toLowerCase();
  const k = Object.keys(grille).filter(k => k !== 'defaut').sort((a, b) => b.length - a.length).find(k => m.includes(k.toLowerCase()));
  return grille[k || 'defaut'] || PRIX_DEFAUT.defaut;
}
function cout(st, grille) {
  if (!st) return 0;
  const p = prixDe(st.modele, grille), t = st.tokens;
  return (t.entree * p.entree + t.cacheLu * p.entree * CACHE_LU + t.cacheEcrit * p.entree * CACHE_ECRIT + t.sortie * p.sortie) / 1e6;
}
const jetons = st => st ? st.tokens.entree + st.tokens.sortie + st.tokens.cacheLu + st.tokens.cacheEcrit : 0;

function ligne(x, r, grille) {
  const st = x.stats;
  return { cle: x.cle, nom: r.nom, projet: r.projet, bureau: r.bureau, etat: x.etat, session: x.session || null,
    dureeMs: st && st.fin && st.debut ? st.fin - st.debut : 0, actifMs: st ? st.actifMs : 0, outils: st ? st.outils : 0, erreurs: st ? st.erreurs : 0,
    tauxErreur: st && st.outils ? st.erreurs / st.outils : 0, editions: st ? st.editions : 0, fichiers: st ? st.fichiers : 0, commits: st ? st.commits : 0,
    jetons: jetons(st), sortie: st ? st.tokens.sortie : 0, cout: cout(st, grille), modele: st ? st.modele : '' };
}

const groupeVide = () => ({ agents: 0, termines: 0, enCours: 0, enAttente: 0, interrompus: 0, sessions: 0, dureeTermines: 0,
  actifMs: 0, outils: 0, erreurs: 0, editions: 0, fichiers: 0, commits: 0, jetons: 0, cout: 0 });
function ajouter(g, l, estAgent) {
  if (estAgent) {
    g.agents++;
    if (l.etat === 'termine') { g.termines++; g.dureeTermines += l.dureeMs; }
    else if (l.etat === 'en_cours') g.enCours++; else if (l.etat === 'en_attente') g.enAttente++; else if (l.etat === 'interrompu') g.interrompus++;
  } else g.sessions++;
  for (const k of ['actifMs', 'outils', 'erreurs', 'editions', 'fichiers', 'commits', 'jetons', 'cout']) g[k] += l[k];
}
function finir(g, heures) {
  return { ...g, terminesParHeure: g.termines / heures, dureeMoyenneMs: g.termines ? g.dureeTermines / g.termines : 0,
    tauxErreur: g.outils ? g.erreurs / g.outils : 0, coutMoyen: g.agents + g.sessions ? g.cout / (g.agents + g.sessions) : 0 };
}

function calculer({ sessions, agents }, res, org, fenetreMs, maintenant = Date.now()) {
  const grille = { ...PRIX_DEFAUT, ...(org.prix || {}) }, depuis = maintenant - fenetreMs, heures = fenetreMs / 36e5;
  const dans = x => x.derniereActivite >= depuis || x.etat === 'en_cours' || x.etat === 'en_attente' || x.etat === 'active';
  const la = agents.filter(dans).map(a => ligne(a, res.agents[a.cle], grille));
  const ls = sessions.filter(dans).map(s => ligne(s, res.sessions[s.cle], grille));
  const global = groupeVide(), projets = {}, bureaux = {};
  const dansGroupe = (map, k) => map[k] || (map[k] = groupeVide());
  for (const [liste, estAgent] of [[la, true], [ls, false]]) for (const l of liste) {
    ajouter(global, l, estAgent); ajouter(dansGroupe(projets, l.projet || '_'), l, estAgent); ajouter(dansGroupe(bureaux, l.bureau), l, estAgent);
  }
  const fin = m => Object.fromEntries(Object.entries(m).map(([k, g]) => [k, finir(g, heures)]));
  return { fenetreMs, global: finir(global, heures), projets: fin(projets), bureaux: fin(bureaux), agents: la, sessions: ls };
}

// Mesures d'un agent ou d'une session hors fenêtre (pour la fiche)
const mesurer = (x, r, org) => ligne(x, r, { ...PRIX_DEFAUT, ...(org.prix || {}) });

module.exports = { calculer, mesurer, cout, prixDe, PRIX_DEFAUT };
