// Contrôle d'accès du serveur : nom d'hôte attendu (anti DNS rebinding), jeton d'accès et cookie de session.
// Fonction pure (sans réseau) pour être testée : renvoie ce que le serveur doit faire de la requête.
'use strict';
const crypto = require('crypto');

const LOCAUX = ['127.0.0.1', 'localhost', '::1'];
const COOKIE = 'bureau_session';

const egal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Valeur du cookie dérivée du jeton : le jeton lui-même n'est jamais stocké dans le navigateur
const session = token => crypto.createHmac('sha256', token).update('bureau-agents/session').digest('hex');

function cookies(entete) {
  const out = {};
  for (const p of String(entete || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
  return out;
}

// Hôtes acceptés dans l'en-tête Host. Serveur local : seulement les noms locaux sur ce port (une page d'un autre site
// qui fait pointer son domaine sur 127.0.0.1 envoie son propre nom et est refusée). Serveur ouvert au réseau : le jeton
// protège ; BUREAU_HOSTS restreint en plus les noms acceptés s'il est défini.
function hotesAutorises({ host, port, hotes = [] }) {
  if (!LOCAUX.includes(host) && !hotes.length) return null;   // null = pas de contrôle du nom
  const base = LOCAUX.includes(host) ? ['127.0.0.1', 'localhost', '[::1]'].map(h => `${h}:${port}`) : [];
  return new Set([...base, ...hotes.map(h => h.toLowerCase())]);
}

// req : { method, headers }, u : URL analysée. Renvoie { refus: [code, message] } | { redirection, cookie } | { ok: true }
function controler(req, u, { host, port, token = '', hotes = [], https = false }) {
  const permis = hotesAutorises({ host, port, hotes });
  if (permis && !permis.has(String(req.headers.host || '').toLowerCase())) return { refus: [421, 'Nom d\'hôte refusé'] };
  if (!token) return { ok: true };
  const attendu = session(token), c = cookies(req.headers.cookie)[COOKIE];
  if (egal(c, attendu) || egal(req.headers['x-bureau-token'], token)) return { ok: true };
  // Lien d'ouverture …/?t=<jeton> : on pose le cookie et on recharge sans le jeton (il ne reste ni dans l'historique ni dans les journaux)
  const t = u.searchParams.get('t');
  if (req.method === 'GET' && egal(t, token)) {
    const propre = new URL(u.href); propre.searchParams.delete('t');
    return { redirection: propre.pathname + propre.search,
      cookie: `${COOKIE}=${attendu}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${https ? '; Secure' : ''}` };
  }
  return { refus: [401, 'Jeton manquant ou faux'] };
}

module.exports = { controler, hotesAutorises, session, cookies, egal, COOKIE };
