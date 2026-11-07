#!/usr/bin/env node
// Bureau des agents : serveur local (macOS, Linux, Windows) qui liste les agents de codage, leur rendement et la santé du poste.
// Aucune dépendance npm ; lecture seule sur les dossiers des outils, écriture seulement dans ~/.bureau-agents.
'use strict';
const http = require('http'), fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os'), crypto = require('crypto');
const { IndexTranscripts } = require('./lib/transcript');
const { SourceClaude } = require('./lib/source-claude');
const { Poste } = require('./lib/poste');
const org = require('./lib/organisation');
const { calculer, mesurer } = require('./lib/kpi');

const DATA = process.env.BUREAU_DATA || path.join(os.homedir(), '.bureau-agents');
const F_INDEX = path.join(DATA, 'index-transcripts.json'), F_HIST = path.join(DATA, 'historique.json'), F_ORG = path.join(DATA, 'organisation.json');
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.BUREAU_PORT || 4747);
const HOST = process.env.BUREAU_HOST || '127.0.0.1';
const TOKEN = process.env.BUREAU_TOKEN || '';
const HORIZON_J = Number(process.env.BUREAU_HORIZON_JOURS || 7);
const REFRESH_MS = 10e3, SAUVE_MS = 30e3;
const FENETRES = { '1h': 36e5, '24h': 864e5, '7j': 7 * 864e5 };
const CSRF = crypto.randomBytes(24).toString('hex');

if (!['127.0.0.1', 'localhost', '::1'].includes(HOST) && !TOKEN) { console.error('BUREAU_HOST ouvre le serveur au réseau : définir aussi BUREAU_TOKEN.'); process.exit(1); }

const lireJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
async function ecrire(f, v) { await fsp.mkdir(DATA, { recursive: true }); const t = f + '.' + process.pid + '.tmp'; await fsp.writeFile(t, JSON.stringify(v)); await fsp.rename(t, f); }

const index = new IndexTranscripts(lireJson(F_INDEX) || {});
const source = new SourceClaude({ dossier: process.env.BUREAU_CLAUDE_DIR || path.join(os.homedir(), '.claude'), horizonMs: HORIZON_J * 864e5, index });
const poste = new Poste({ historique: lireJson(F_HIST) || [] });
const stock = new org.StockOrganisation(F_ORG);

let scan = { sessions: [], agents: [] }, mesure = null, pret = false, enCours = null, genere = 0, erreur = null;
// Une seule collecte à la fois : un appel pendant une collecte attend celle qui tourne
function collecter() {
  if (enCours) return enCours;
  return enCours = (async () => {
    try {
      const [s, m] = await Promise.all([source.scanner(), poste.relever()]);
      scan = s; mesure = m; pret = true; genere = Date.now(); erreur = null;
      if (org.synchroniser(stock.o, scan.sessions)) await stock.enregistrer();
    } catch (e) { erreur = String(e && e.message || e); console.error(e); }
    finally { enCours = null; }
  })();
}
async function sauver() {
  if (index.modifie) { index.modifie = false; await ecrire(F_INDEX, index).catch(e => console.error('index non enregistré :', e.message)); }
  await ecrire(F_HIST, poste.hist).catch(() => {});
}

function etat(fenetre) {
  const o = stock.o, res = org.resoudre(o, scan), fen = FENETRES[fenetre] || FENETRES['24h'];
  return {
    genere, pret, erreur, csrf: CSRF, fenetre: FENETRES[fenetre] ? fenetre : '24h', horizonJours: HORIZON_J,
    indexation: source.progression, organisation: o,
    sessions: scan.sessions.map(s => ({ ...s, ...res.sessions[s.cle], mesures: mesurer(s, res.sessions[s.cle], o) })),
    agents: scan.agents.map(a => ({ ...a, ...res.agents[a.cle], mesures: mesurer(a, res.agents[a.cle], o) })),
    kpi: calculer(scan, res, o, fen), poste: mesure
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const egal = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function corps(req, max = 32 << 10) {
  return new Promise((ok, ko) => { let n = 0; const b = []; req.on('data', c => { n += c.length; if (n > max) { ko(new Error('trop gros')); req.destroy(); } else b.push(c); }); req.on('end', () => ok(Buffer.concat(b).toString('utf8'))); req.on('error', ko); });
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const envoyer = (code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  if (TOKEN && !egal(u.searchParams.get('t') || req.headers['x-bureau-token'], TOKEN)) return envoyer(401, { erreur: 'Jeton manquant ou faux' });
  try {
    if (u.pathname === '/api/etat' && req.method === 'GET') {
      if (u.searchParams.has('maintenant') || !pret) await collecter();
      return envoyer(200, etat(u.searchParams.get('fenetre')));
    }
    if (u.pathname === '/api/organisation' && req.method === 'POST') {
      // Protection contre les requêtes d'un autre site : même origine, JSON et jeton de page
      const origine = req.headers.origin;
      if (origine && new URL(origine).host !== req.headers.host) return envoyer(403, { erreur: 'Origine refusée' });
      if (!egal(req.headers['x-bureau-csrf'], CSRF) || !/^application\/json/.test(req.headers['content-type'] || '')) return envoyer(403, { erreur: 'Jeton de page manquant' });
      let op; try { op = JSON.parse(await corps(req)); } catch { return envoyer(400, { erreur: 'Requête illisible' }); }
      try { const r = org.appliquer(stock.o, op); await stock.enregistrer(); return envoyer(200, { ok: true, resultat: r || null }); }
      catch (e) { if (e instanceof org.ErreurOrganisation) return envoyer(400, { erreur: e.message }); throw e; }
    }
    if (req.method !== 'GET') return envoyer(405, { erreur: 'Méthode refusée' });
    const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const f = path.resolve(PUBLIC, rel);
    if (!f.startsWith(PUBLIC + path.sep)) return envoyer(404, 'Introuvable', 'text/plain; charset=utf-8');
    fsp.readFile(f).then(b => envoyer(200, b, TYPES[path.extname(f)] || 'application/octet-stream'), () => envoyer(404, 'Introuvable', 'text/plain; charset=utf-8'));
  } catch (e) { console.error(e); envoyer(500, { erreur: 'Erreur interne' }); }
}).listen(PORT, HOST, () => console.log(`Bureau des agents : http://${HOST === '0.0.0.0' ? os.hostname() : HOST}:${PORT}/${TOKEN ? '?t=…' : ''}`));

(async () => { await stock.charger(); await collecter(); await sauver(); })();
setInterval(collecter, REFRESH_MS);
setInterval(sauver, SAUVE_MS);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => sauver().finally(() => process.exit(0)));
