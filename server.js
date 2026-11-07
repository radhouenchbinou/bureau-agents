#!/usr/bin/env node
// Bureau des agents : serveur local qui liste les sessions Claude Code, leurs agents et l'état du Mac.
// Lecture seule sur ~/.claude ; aucune dépendance npm.
'use strict';
const http = require('http'), fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os'), crypto = require('crypto');
const { execFile } = require('child_process');

const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const SESSIONS = path.join(CLAUDE, 'sessions'), PROJECTS = path.join(CLAUDE, 'projects');
const DATA = path.join(HOME, '.bureau-agents'), HIST = path.join(DATA, 'historique.json');
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.BUREAU_PORT || 4747);
const HOST = process.env.BUREAU_HOST || '127.0.0.1';
const TOKEN = process.env.BUREAU_TOKEN || '';
const RECENT_MS = 24 * 3600e3;      // sessions terminées gardées 24 h
const AGENT_ACTIVE_MS = 15 * 60e3;  // un agent non terminé sans écriture depuis 15 min est « en attente »
const REFRESH_MS = 10e3;            // collecte toutes les 10 s
const HIST_MS = 60e3, HIST_MAX = 120; // un point d'historique par minute, sur 2 h

if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !TOKEN) {
  console.error('BUREAU_HOST ouvre le serveur au réseau : définir aussi BUREAU_TOKEN.');
  process.exit(1);
}

const sh = (cmd, args, timeout = 15000) => new Promise(res =>
  execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (e, out) => res(out || '')));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readJson = async f => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return null; } };
const statOr = async f => { try { return await fsp.stat(f); } catch { return null; } };

// Lit le début d'un fichier (sans charger un transcript de plusieurs Mo)
async function head(f, bytes = 256 << 10) {
  let fh; try { fh = await fsp.open(f, 'r'); const b = Buffer.alloc(bytes); const { bytesRead } = await fh.read(b, 0, bytes, 0); return b.toString('utf8', 0, bytesRead); }
  catch { return ''; } finally { if (fh) await fh.close(); }
}
const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('\n') : '';
const clip = (s, n) => { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Premier message de l'utilisateur (titre de repli) ; mis en cache par date de modification
const firstCache = new Map();
async function firstUserText(f, mtime) {
  const c = firstCache.get(f); if (c && c.m === mtime) return c.v;
  let v = '';
  for (const l of (await head(f)).split('\n')) {
    let d; try { d = JSON.parse(l); } catch { continue; }
    const m = d.message; if (!m || m.role !== 'user') continue;
    const t = textOf(m.content).trim(); if (t && !t.startsWith('<')) { v = t; break; }
  }
  firstCache.set(f, { m: mtime, v }); return v;
}

// Index sessionId → dossier projet, reconstruit à chaque collecte (readdir peu coûteux)
async function projectDirs() { try { return (await fsp.readdir(PROJECTS)).map(d => path.join(PROJECTS, d)); } catch { return []; } }

async function agentsOf(dir, sessionAlive) {
  const sub = path.join(dir, 'subagents'); let files; try { files = await fsp.readdir(sub); } catch { return []; }
  const out = [];
  for (const f of files.filter(f => f.endsWith('.meta.json'))) {
    const id = f.slice(0, -'.meta.json'.length), meta = await readJson(path.join(sub, f)); if (!meta) continue;
    const jf = path.join(sub, id + '.jsonl'), st = await statOr(jf), mtime = st ? st.mtimeMs : 0;
    if (Date.now() - mtime > RECENT_MS && meta.finished) continue;
    const prompt = await firstUserText(jf, mtime);
    const wt = (prompt.match(/\/(?:IdeaProjects\/wt|\.claude\/worktrees)\/([\w.-]+)/) || [])[1] || '';
    const etat = meta.finished ? 'termine' : !sessionAlive ? 'interrompu' : Date.now() - mtime < AGENT_ACTIVE_MS ? 'en_cours' : 'en_attente';
    out.push({ id, description: meta.description || id, type: meta.agentType || 'agent', etat, derniereActivite: mtime,
      consigne: clip(prompt, 300), worktree: wt, arrierePlan: meta.requestShape === 'background' });
  }
  return out.sort((a, b) => b.derniereActivite - a.derniereActivite);
}

async function collectSessions() {
  const dirs = await projectDirs(), live = new Map();
  let files = []; try { files = (await fsp.readdir(SESSIONS)).filter(f => f.endsWith('.json')); } catch {}
  for (const f of files) { const s = await readJson(path.join(SESSIONS, f)); if (s && s.sessionId && alive(s.pid)) live.set(s.sessionId, s); }
  const found = [];
  for (const d of dirs) {
    let entries; try { entries = await fsp.readdir(d); } catch { continue; }
    for (const e of entries.filter(e => e.endsWith('.jsonl'))) {
      const id = e.slice(0, -6), s = live.get(id), st = await statOr(path.join(d, e)); if (!st) continue;
      if (!s && Date.now() - st.mtimeMs > RECENT_MS) continue;
      found.push({ id, dir: d, file: path.join(d, e), mtime: st.mtimeMs, s });
    }
  }
  const out = [];
  for (const x of found) {
    const sdir = path.join(x.dir, x.id), title = (await readJson(path.join(sdir, 'custom-title.json')) || {}).customTitle;
    const isLive = !!x.s, agents = await agentsOf(sdir, isLive);
    const name = (x.s && x.s.name) || title || clip(await firstUserText(x.file, x.mtime), 60) || x.id.slice(0, 8);
    const cwd = (x.s && x.s.cwd) || '';
    // Nom du dossier projet : chemin du cwd avec chaque caractère non alphanumérique remplacé par « - »
    const enc = path.basename(x.dir).replace(HOME.replace(/[^a-zA-Z0-9]/g, '-') + '-', '').replace(/^IdeaProjects-/, '').split('--')[0];
    out.push({ id: x.id, nom: name, cwd, projet: cwd ? path.basename(cwd.replace(/\/\.claude\/worktrees\/.*/, '')) : enc,
      etat: isLive ? (x.s.status === 'busy' ? 'active' : 'inactive') : 'terminee', pid: isLive ? x.s.pid : null,
      derniereActivite: Math.max(x.mtime, isLive ? x.s.statusUpdatedAt || 0 : 0), agents });
  }
  return out.sort((a, b) => (a.etat === 'terminee') - (b.etat === 'terminee') || b.derniereActivite - a.derniereActivite);
}

// --- État du Mac (même collecte que le relevé de l'artefact) ---
let hist = [];
try { hist = JSON.parse(fs.readFileSync(HIST, 'utf8')); } catch {}
let lastHist = hist.length ? hist[hist.length - 1].e * 1000 : 0;
const WT = path.join(HOME, 'IdeaProjects', 'wt') + '/';

async function collectMac() {
  const [ncpu, mem, load, swap, mp, df, batt, therm, up, ps] = await Promise.all([
    sh('sysctl', ['-n', 'hw.ncpu']), sh('sysctl', ['-n', 'hw.memsize']), sh('sysctl', ['-n', 'vm.loadavg']), sh('sysctl', ['-n', 'vm.swapusage']),
    sh('memory_pressure', []), sh('df', ['-k', '/System/Volumes/Data']), sh('pmset', ['-g', 'batt']), sh('pmset', ['-g', 'therm']),
    sh('uptime', []), sh('ps', ['-Ao', 'pid=,pcpu=,rss=,comm='])]);
  const loads = (load.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  const num = re => { const m = swap.match(re); return m ? Number(m[1]) / 1024 : 0; };
  const dfl = df.trim().split('\n').pop().split(/\s+/);
  const procs = ps.split('\n').map(l => l.trim().split(/\s+/)).filter(p => p.length >= 4)
    .map(p => ({ pid: p[0], cpu: Number(p[1]), mem: Number(p[2]) / 1024, comm: p.slice(3).join(' ') }));
  const javas = procs.filter(p => p.comm.endsWith('/java')).map(p => p.pid), cwd = {};
  if (javas.length) {
    let pid = null;
    for (const l of (await sh('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', javas.join(',')])).split('\n')) {
      if (l[0] === 'p') pid = l.slice(1); else if (l[0] === 'n' && pid) cwd[pid] = l.slice(1);
    }
  }
  const wtOf = d => d.startsWith(WT) ? d.slice(WT.length).split('/')[0] : (d.match(/\/\.claude\/worktrees\/([^/]+)/) || [])[1];
  const builds = [...new Set(Object.values(cwd).map(wtOf).filter(Boolean))].sort();
  const name = p => {
    const c = p.comm;
    if (c.includes('Virtualization.VirtualMachine')) return 'Machine virtuelle Docker';
    if (c.endsWith('/java')) { const d = cwd[p.pid] || '', w = wtOf(d); return w ? 'Build ' + w : d ? 'Java · ' + path.basename(d) : 'Java'; }
    if (/\/Claude\.app\//i.test(c)) return 'Claude';
    if (c.includes('Docker.app')) return 'Docker';
    return path.basename(c);
  };
  const groups = {};
  for (const p of procs) { const n = name(p), g = groups[n] || (groups[n] = { n, cpu: 0, mem: 0, count: 0 }); g.cpu += p.cpu; g.mem += p.mem; g.count++; }
  const top = Object.values(groups).sort((a, b) => b.cpu - a.cpu).slice(0, 6).map(g => ({ ...g, cpu: Math.round(g.cpu), mem: Math.round(g.mem) }));
  const swapTotal = num(/total = ([\d.]+)M/), swapUsed = num(/used = ([\d.]+)M/), now = Date.now();
  if (now - lastHist >= HIST_MS) {
    lastHist = now; const d = new Date();
    hist.push({ e: Math.floor(now / 1000), t: d.toTimeString().slice(0, 5), load: Math.round(loads[0] * 10) / 10, swap: swapTotal ? Math.round(100 * swapUsed / swapTotal) : 0 });
    hist = hist.slice(-HIST_MAX);
    fsp.mkdir(DATA, { recursive: true }).then(() => fsp.writeFile(HIST, JSON.stringify(hist))).catch(() => {});
  }
  const bm = batt.match(/(\d+)%/), um = up.match(/up (\d+) day/), mf = mp.match(/free percentage: (\d+)%/);
  const r1 = x => Math.round(x * 10) / 10;
  return { epoch: Math.floor(now / 1000), ncpu: Number(ncpu) || 1, memGb: Math.round(Number(mem) / 2 ** 30),
    load1: r1(loads[0]), load5: r1(loads[1]), load15: r1(loads[2]), swapUsedGb: r1(swapUsed), swapTotalGb: r1(swapTotal),
    memFreePct: mf ? Number(mf[1]) : null, diskFreeGb: dfl.length > 3 ? r1(Number(dfl[3]) / 2 ** 20) : 0, diskTotalGb: dfl.length > 3 ? Math.round(Number(dfl[1]) / 2 ** 20) : 0,
    builds, jvms: javas.length, batteryPct: bm ? Number(bm[1]) : null, onAC: batt.includes('AC Power'),
    thermalOk: therm.includes('No thermal warning') && therm.includes('No performance warning'), uptimeDays: um ? Number(um[1]) : null, top, history: hist };
}

let etat = null, erreur = null, busy = false;
async function collect() {
  if (busy) return; busy = true;
  try { const [sessions, mac] = await Promise.all([collectSessions(), collectMac()]); etat = { genere: Date.now(), sessions, mac }; erreur = null; }
  catch (e) { erreur = String(e && e.stack || e); console.error(erreur); }
  finally { busy = false; }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const tokenOk = u => !TOKEN || (u.searchParams.get('t') || '').length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(u.searchParams.get('t')), Buffer.from(TOKEN));

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body, type) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(body); };
  if (!tokenOk(u)) return send(401, 'Jeton manquant ou faux', 'text/plain; charset=utf-8');
  if (u.pathname === '/api/etat') {
    if (u.searchParams.has('maintenant')) await collect();
    if (!etat) await collect();
    return send(etat ? 200 : 503, JSON.stringify(etat ? { ...etat, erreur } : { erreur }), 'application/json; charset=utf-8');
  }
  const rel = u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  const f = path.join(PUBLIC, rel);
  if (!f.startsWith(PUBLIC + path.sep)) return send(404, 'Introuvable', 'text/plain; charset=utf-8');
  fsp.readFile(f).then(b => send(200, b, TYPES[path.extname(f)] || 'application/octet-stream'), () => send(404, 'Introuvable', 'text/plain; charset=utf-8'));
}).listen(PORT, HOST, () => console.log(`Bureau des agents : http://${HOST === '0.0.0.0' ? os.hostname() : HOST}:${PORT}/${TOKEN ? '?t=…' : ''}`));

collect(); setInterval(collect, REFRESH_MS);
