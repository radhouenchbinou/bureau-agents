// Où se trouve un agent dans le bureau : à son poste, en salle de pause, ou parti.
'use strict';

const OUTIL_MAX_MS = 60 * 60e3;   // au-delà, un outil sans résultat est considéré comme perdu (appel interrompu)
const STABLE_MS = 30e3;           // un changement n'est appliqué qu'après 30 s dans le nouvel état

// Présence brute d'une session ou d'un agent, et la raison affichée
function presence(x, { maintenant = Date.now(), seuilMs = 120e3 } = {}) {
  if (x.etat === 'termine' || x.etat === 'terminee' || x.etat === 'interrompu') return { presence: 'parti', raison: x.etat };
  if (x.cle.startsWith('s:')) return x.etat === 'active' ? { presence: 'poste', raison: 'travaille' } : { presence: 'pause', raison: x.niveau === 'presence' ? 'repos' : 'attend' };
  const age = maintenant - x.derniereActivite, st = x.stats;
  if (st && st.outilsEnCours > 0 && age < OUTIL_MAX_MS) return { presence: 'poste', raison: 'outil' };
  return age < seuilMs ? { presence: 'poste', raison: 'travaille' } : { presence: 'pause', raison: 'inactif' };
}

// Évite les allers-retours : une nouvelle présence doit tenir 30 s. Partir et arriver sont immédiats.
class Stabilisateur {
  constructor(stableMs = STABLE_MS) { this.stableMs = stableMs; this.etats = new Map(); }
  filtrer(cle, p, maintenant = Date.now()) {
    const e = this.etats.get(cle);
    if (!e || p === 'parti' || e.p === 'parti') { this.etats.set(cle, { p, candidat: null, depuis: 0 }); return p; }
    if (p === e.p) { e.candidat = null; return p; }
    if (e.candidat !== p) { e.candidat = p; e.depuis = maintenant; }
    if (maintenant - e.depuis >= this.stableMs) { e.p = p; e.candidat = null; }
    return e.p;
  }
  oublier(garder) { for (const k of this.etats.keys()) if (!garder.has(k)) this.etats.delete(k); }
}

module.exports = { presence, Stabilisateur };
