// Santé du poste : partie commune (module os de Node) et compléments propres à macOS, Linux et Windows.
// Un indicateur indisponible sur le système vaut null ; le front l'affiche « non disponible ».
'use strict';
const os = require('os'), fs = require('fs'), fsp = fs.promises, path = require('path');
const { execFile } = require('child_process');

const sh = (cmd, args, timeout = 15000) => new Promise(res =>
  execFile(cmd, args, { timeout, maxBuffer: 16 << 20, windowsHide: true }, (e, out) => res(out || '')));
const lire = async f => { try { return await fsp.readFile(f, 'utf8'); } catch { return ''; } };
const r1 = x => x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10;

// Dossier de worktree d'un build : ~/…/wt/<nom> ou <dépôt>/.claude/worktrees/<nom>
const worktreeDe = d => (d.match(/[\\/]wt[\\/]([^\\/]+)/) || d.match(/[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/) || [])[1];
const estJava = c => /(^|[\\/])java(\.exe)?$/i.test(c);

// Pourcentage processeur à partir des temps cumulés de os.cpus() (marche aussi sous Windows, où loadavg vaut 0)
let cpuPrec = null;
function cpuPct() {
  const t = os.cpus().reduce((a, c) => { const s = Object.values(c.times).reduce((x, y) => x + y, 0); a.total += s; a.idle += c.times.idle; return a; }, { total: 0, idle: 0 });
  const p = cpuPrec; cpuPrec = t;
  if (!p || t.total === p.total) return null;
  return Math.max(0, Math.min(100, 100 * (1 - (t.idle - p.idle) / (t.total - p.total))));
}

async function disque(dossier) {
  try { const s = await fsp.statfs(dossier); return { libreGo: s.bavail * s.bsize / 2 ** 30, totalGo: s.blocks * s.bsize / 2 ** 30 }; }
  catch { return { libreGo: null, totalGo: null }; }
}

function regrouper(procs, nommer) {
  const g = {};
  for (const p of procs) { const n = nommer(p), x = g[n] || (g[n] = { n, cpu: 0, mem: 0, count: 0 }); x.cpu += p.cpu; x.mem += p.mem; x.count++; }
  return Object.values(g).sort((a, b) => b.cpu - a.cpu || b.mem - a.mem).slice(0, 6).map(x => ({ ...x, cpu: Math.round(x.cpu), mem: Math.round(x.mem) }));
}
function nomProcessus(p, cwd) {
  const c = p.comm;
  if (c.includes('Virtualization.VirtualMachine') || /vmmem/i.test(c)) return 'Machine virtuelle Docker';
  if (estJava(c)) { const d = cwd[p.pid] || '', w = d && worktreeDe(d); return w ? 'Build ' + w : d ? 'Java · ' + path.basename(d) : 'Java'; }
  if (/[\\/]Claude\.app[\\/]/i.test(c) || /^claude(\.exe)?$/i.test(path.basename(c))) return 'Claude';
  if (/Docker( Desktop)?\.app|com\.docker/i.test(c)) return 'Docker';
  return path.basename(c).replace(/\.exe$/i, '');
}

// ---- macOS ----
async function mac() {
  const [swap, mp, batt, therm, ps] = await Promise.all([sh('sysctl', ['-n', 'vm.swapusage']), sh('memory_pressure', []),
    sh('pmset', ['-g', 'batt']), sh('pmset', ['-g', 'therm']), sh('ps', ['-Ao', 'pid=,pcpu=,rss=,comm='])]);
  const mo = re => { const m = swap.match(re); return m ? Number(m[1]) / 1024 : null; };
  const procs = psUnix(ps), javas = procs.filter(p => estJava(p.comm)).map(p => p.pid), cwd = {};
  if (javas.length) {
    let pid = null;
    for (const l of (await sh('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', javas.join(',')])).split('\n')) {
      if (l[0] === 'p') pid = l.slice(1); else if (l[0] === 'n' && pid) cwd[pid] = l.slice(1);
    }
  }
  const bm = batt.match(/(\d+)%/), mf = mp.match(/free percentage: (\d+)%/);
  return { swapUtiliseGo: mo(/used = ([\d.]+)M/), swapTotalGo: mo(/total = ([\d.]+)M/), memLibrePct: mf ? Number(mf[1]) : null,
    batteriePct: bm ? Number(bm[1]) : null, secteur: bm ? batt.includes('AC Power') : null,
    thermique: therm ? (therm.includes('No thermal warning') && therm.includes('No performance warning') ? 'ok' : 'alerte') : null,
    temperatureC: null, procs, javas, cwd };
}

// ---- Linux ----
async function linux() {
  const mi = await lire('/proc/meminfo'), kv = k => { const m = mi.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')); return m ? Number(m[1]) : null; };
  const st = kv('SwapTotal'), sf = kv('SwapFree'), mt = kv('MemTotal'), ma = kv('MemAvailable');
  const ps = await sh('ps', ['-eo', 'pid=,pcpu=,rss=,comm=']), procs = psUnix(ps), javas = procs.filter(p => estJava(p.comm) || p.comm === 'java').map(p => p.pid), cwd = {};
  for (const pid of javas) { try { cwd[pid] = await fsp.readlink('/proc/' + pid + '/cwd'); } catch {} }
  let batteriePct = null, secteur = null;
  for (const b of (await fsp.readdir('/sys/class/power_supply').catch(() => [])).filter(n => /^BAT/.test(n))) {
    const cap = Number((await lire('/sys/class/power_supply/' + b + '/capacity')).trim());
    if (!Number.isNaN(cap)) { batteriePct = cap; secteur = !/Discharging/i.test(await lire('/sys/class/power_supply/' + b + '/status')); }
  }
  let temperatureC = null;
  for (const z of await fsp.readdir('/sys/class/thermal').catch(() => [])) {
    if (!z.startsWith('thermal_zone')) continue;
    const t = Number((await lire('/sys/class/thermal/' + z + '/temp')).trim()) / 1000;
    if (t > 0 && t < 150) temperatureC = Math.max(temperatureC || 0, t);
  }
  return { swapUtiliseGo: st != null && sf != null ? (st - sf) / 2 ** 20 : null, swapTotalGo: st != null ? st / 2 ** 20 : null,
    memLibrePct: mt && ma != null ? Math.round(100 * ma / mt) : null, batteriePct, secteur,
    thermique: temperatureC == null ? null : temperatureC >= 90 ? 'alerte' : 'ok', temperatureC: r1(temperatureC), procs, javas, cwd };
}

function psUnix(out) {
  return out.split('\n').map(l => l.trim().split(/\s+/)).filter(p => p.length >= 4)
    .map(p => ({ pid: p[0], cpu: Number(p[1]) || 0, mem: Number(p[2]) / 1024, comm: p.slice(3).join(' ') }));
}

// ---- Windows (une seule invocation PowerShell par relevé) ----
const PS_WIN = [
  '$ErrorActionPreference="SilentlyContinue"',
  '$pf=Get-CimInstance Win32_PageFileUsage | Measure-Object -Property AllocatedBaseSize,CurrentUsage -Sum',
  '$b=Get-CimInstance Win32_Battery | Select-Object -First 1',
  '$p=Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64,Path',
  '[pscustomobject]@{pfTotal=($pf|?{$_.Property -eq "AllocatedBaseSize"}).Sum;pfUsed=($pf|?{$_.Property -eq "CurrentUsage"}).Sum;bat=$b.EstimatedChargeRemaining;batStatus=$b.BatteryStatus;procs=$p} | ConvertTo-Json -Depth 3 -Compress'
].join(';');
let cpuWinPrec = null;
async function windows() {
  let d = {}; try { d = JSON.parse(await sh('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_WIN], 30000)); } catch {}
  // CPU de Get-Process = secondes cumulées : on en tire un pourcentage par différence entre deux relevés
  // Comme ps sous Unix, 100 % = un cœur entier
  const maintenant = Date.now(), prec = cpuWinPrec, cumul = {};
  const procs = (d.procs || []).map(p => {
    const pid = String(p.Id), c = Number(p.CPU) || 0; cumul[pid] = c;
    const pct = prec && prec.cumul[pid] != null ? Math.max(0, (c - prec.cumul[pid]) / ((maintenant - prec.t) / 1000) * 100) : 0;
    return { pid, cpu: pct, mem: (Number(p.WorkingSet64) || 0) / 2 ** 20, comm: p.Path || p.ProcessName || '' };
  });
  cpuWinPrec = { t: maintenant, cumul };
  return { swapUtiliseGo: d.pfUsed != null ? d.pfUsed / 1024 : null, swapTotalGo: d.pfTotal != null ? d.pfTotal / 1024 : null,
    memLibrePct: Math.round(100 * os.freemem() / os.totalmem()), batteriePct: d.bat ?? null, secteur: d.bat == null ? null : d.batStatus === 2,
    thermique: null, temperatureC: null, procs, javas: procs.filter(p => estJava(p.comm)).map(p => p.pid), cwd: {} };
}

class Poste {
  constructor({ dossierDisque = os.homedir(), historique = [], histMs = 60e3, histMax = 1440 } = {}) {
    this.dossierDisque = dossierDisque; this.hist = historique; this.histMs = histMs; this.histMax = histMax;
    this.dernierHist = historique.length ? historique[historique.length - 1].e * 1000 : 0; cpuPct();
  }
  async relever() {
    const plateforme = process.platform;
    const [spec, dk] = await Promise.all([plateforme === 'darwin' ? mac() : plateforme === 'win32' ? windows() : linux(), disque(this.dossierDisque)]);
    const ncpu = os.cpus().length, load = plateforme === 'win32' ? null : os.loadavg(), cpu = cpuPct();
    const builds = [...new Set(Object.values(spec.cwd).map(worktreeDe).filter(Boolean))].sort();
    const maintenant = Date.now();
    const v = {
      epoch: Math.floor(maintenant / 1000), plateforme, systeme: os.type() + ' ' + os.release(), hote: os.hostname(), ncpu, memGo: Math.round(os.totalmem() / 2 ** 30),
      cpuPct: r1(cpu), load1: load ? r1(load[0]) : null, load5: load ? r1(load[1]) : null, load15: load ? r1(load[2]) : null,
      swapUtiliseGo: r1(spec.swapUtiliseGo), swapTotalGo: r1(spec.swapTotalGo), memLibrePct: spec.memLibrePct,
      disqueLibreGo: r1(dk.libreGo), disqueTotalGo: dk.totalGo == null ? null : Math.round(dk.totalGo),
      builds, jvms: spec.javas.length, batteriePct: spec.batteriePct, secteur: spec.secteur, thermique: spec.thermique, temperatureC: spec.temperatureC,
      allumeJours: Math.floor(os.uptime() / 86400), top: regrouper(spec.procs, p => nomProcessus(p, spec.cwd))
    };
    if (maintenant - this.dernierHist >= this.histMs) {
      this.dernierHist = maintenant;
      this.hist.push({ e: v.epoch, cpu: v.cpuPct, load: v.load1, swap: v.swapTotalGo ? Math.round(100 * v.swapUtiliseGo / v.swapTotalGo) : 0, mem: v.memLibrePct });
      if (this.hist.length > this.histMax) this.hist.splice(0, this.hist.length - this.histMax);
    }
    v.historique = this.hist;
    return v;
  }
}

module.exports = { Poste, worktreeDe, nomProcessus, psUnix };
