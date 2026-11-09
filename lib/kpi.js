// Indicateurs de rendement : par agent, par session (travail du lead lui-même), puis agrégés par projet, par bureau et au global.
// Un agent compte dans la fenêtre s'il a été actif pendant celle-ci ; ses compteurs portent sur toute sa durée de vie.
'use strict';

// Prix publics de l'API Claude, en dollars par million de jetons, relevés le 2026-11-09 sur
// https://platform.claude.com/docs/en/about-claude/pricing (à mettre à jour avec GRILLE_DATE).
// Clé = morceau de l'identifiant du modèle ; la clé la plus longue qui y figure gagne (opus-5-5 avant opus-5).
// lu = lecture du cache ; écritures en cache : 1,25 × entrée (5 min) et 2 × entrée (1 h), sauf valeur donnée.
// Remplaçable ou complétable par la clé `prix` de organisation.json (même format, mêmes noms de champs).
const GRILLE_DATE = '2026-11-09';
const PRIX_DEFAUT = {
  'fable-5-1': { entree: 10, sortie: 50, lu: 0.25 }, 'mythos-5-1': { entree: 10, sortie: 50, lu: 0.25 },
  'fable-5': { entree: 10, sortie: 50, lu: 1 }, 'mythos-5': { entree: 10, sortie: 50, lu: 1 },
  'opus-5-5': { entree: 4, sortie: 20, lu: 0.2 }, 'opus-5': { entree: 5, sortie: 25 },
  'opus-4-8': { entree: 5, sortie: 25 }, 'opus-4-7': { entree: 5, sortie: 25 }, 'opus-4-6': { entree: 5, sortie: 25 }, 'opus-4-5': { entree: 5, sortie: 25 },
  'opus-4-1': { entree: 15, sortie: 75 }, 'opus-4': { entree: 15, sortie: 75 },
  'sonnet-5-5': { entree: 2, sortie: 10, lu: 0.1 }, 'sonnet-5': { entree: 2, sortie: 10, lu: 0.2 },
  'sonnet-4-6': { entree: 3, sortie: 15 }, 'sonnet-4-5': { entree: 3, sortie: 15 }, 'sonnet-4': { entree: 3, sortie: 15 },
  'haiku-5-5': { entree: 0.1, sortie: 0.5, lu: 0.01 }, 'haiku-5-5#>100k': { entree: 0.5, sortie: 2.5, lu: 0.05 },
  'haiku-4-5': { entree: 1, sortie: 5 },
  // Familles seules (identifiant sans version reconnue) : le prix de la dernière génération
  opus: { entree: 4, sortie: 20, lu: 0.2 }, sonnet: { entree: 2, sortie: 10, lu: 0.1 }, haiku: { entree: 0.1, sortie: 0.5, lu: 0.01 },
  defaut: { entree: 2, sortie: 10 }
};
const CACHE_LU = 0.1, ECRIT_5M = 1.25, ECRIT_1H = 2;

// Prix d'un modèle et si la grille le connaît (sinon le tarif par défaut, et le coût est signalé comme approximatif)
function prixConnu(modele, grille) {
  const m = (modele || '').toLowerCase();
  const k = Object.keys(grille).filter(k => k !== 'defaut').sort((a, b) => b.length - a.length).find(k => m.includes(k.toLowerCase()));
  return { p: grille[k || 'defaut'] || PRIX_DEFAUT.defaut, connu: !!k };
}
const prixDe = (modele, grille) => prixConnu(modele, grille).p;
const montant = (t, p) => (t.entree * p.entree + t.cacheLu * (p.lu != null ? p.lu : p.entree * CACHE_LU)
  + (t.ecrit5m || 0) * (p.e5 != null ? p.e5 : p.entree * ECRIT_5M) + (t.ecrit1h || 0) * (p.e1 != null ? p.e1 : p.entree * ECRIT_1H) + t.sortie * p.sortie) / 1e6;

// Coût d'un agent ou d'une session : chaque modèle utilisé au prix de ce modèle (une session peut en mêler plusieurs)
function coutDetail(st, grille) {
  if (!st) return { cout: 0, approx: false };
  const par = st.parModele && Object.keys(st.parModele).length ? st.parModele : null;
  if (par) {
    let cout = 0, approx = false;
    for (const [m, t] of Object.entries(par)) { const { p, connu } = prixConnu(m, grille); cout += montant(t, p); if (!connu && (t.entree || t.sortie)) approx = true; }
    return { cout, approx };
  }
  // Sources sans détail par modèle (Codex) : tout au modèle principal ; écritures en cache comptées à 5 min
  const { p, connu } = prixConnu(st.modele, grille), t = st.tokens;
  return { cout: montant({ entree: t.entree, sortie: t.sortie, cacheLu: t.cacheLu, ecrit5m: t.cacheEcrit, ecrit1h: 0 }, p), approx: !connu };
}
const cout = (st, grille) => coutDetail(st, grille).cout;
const jetons = st => st ? st.tokens.entree + st.tokens.sortie + st.tokens.cacheLu + st.tokens.cacheEcrit : 0;

function ligne(x, r, grille) {
  const st = x.stats, c = coutDetail(st, grille);
  return { cle: x.cle, nom: r.nom, projet: r.projet, bureau: r.bureau, etat: x.etat, session: x.session || null, source: x.source || '', niveau: x.niveau || 'complet',
    dureeMs: st && st.fin && st.debut ? st.fin - st.debut : 0, actifMs: st ? st.actifMs : 0, outils: st ? st.outils : 0, erreurs: st ? st.erreurs : 0,
    tauxErreur: st && st.outils ? st.erreurs / st.outils : 0, editions: st ? st.editions : 0, fichiers: st ? st.fichiers : 0, commits: st ? st.commits : 0,
    jetons: jetons(st), sortie: st ? st.tokens.sortie : 0, cout: c.cout, coutApprox: c.approx, modele: st ? st.modele : '' };
}

const groupeVide = () => ({ agents: 0, termines: 0, enCours: 0, enAttente: 0, interrompus: 0, sessions: 0, dureeTermines: 0,
  actifMs: 0, outils: 0, erreurs: 0, editions: 0, fichiers: 0, commits: 0, jetons: 0, cout: 0, coutApprox: 0 });
function ajouter(g, l, estAgent) {
  if (estAgent) {
    g.agents++;
    if (l.etat === 'termine') { g.termines++; g.dureeTermines += l.dureeMs; }
    else if (l.etat === 'en_cours') g.enCours++; else if (l.etat === 'en_attente') g.enAttente++; else if (l.etat === 'interrompu') g.interrompus++;
  } else g.sessions++;
  for (const k of ['actifMs', 'outils', 'erreurs', 'editions', 'fichiers', 'commits', 'jetons', 'cout']) g[k] += l[k];
  if (l.coutApprox) g.coutApprox++;   // nombre de lignes dont un modèle est absent de la grille
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
  return { fenetreMs, tarifs: GRILLE_DATE, global: finir(global, heures), projets: fin(projets), bureaux: fin(bureaux), agents: la, sessions: ls };
}

// Mesures d'un agent ou d'une session hors fenêtre (pour la fiche)
const mesurer = (x, r, org) => ligne(x, r, { ...PRIX_DEFAUT, ...(org.prix || {}) });

module.exports = { calculer, mesurer, cout, coutDetail, prixDe, prixConnu, PRIX_DEFAUT, GRILLE_DATE };
