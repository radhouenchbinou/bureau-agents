// Agents vus seulement par leurs processus (pas d'historique lisible) et moteurs de modèles locaux.
// Les lignes de commande servent à reconnaître l'outil et son port ; elles ne sont ni gardées ni renvoyées.
'use strict';
const os = require('os'), fsp = require('fs').promises, crypto = require('crypto');
const { execFile } = require('child_process');
const { projetDuDossier } = require('./source-claude');

const sh = (cmd, args, timeout = 15000) => new Promise(res => execFile(cmd, args, { timeout, maxBuffer: 16 << 20, windowsHide: true }, (e, out) => res(out || '')));

const OUTILS = [
  { id: 'copilot', nom: 'GitHub Copilot', re: /copilot-(language-server|lang|agent)/i },
  { id: 'cursor', nom: 'Cursor', re: /[\\/]Cursor\.app[\\/]Contents[\\/]MacOS[\\/]Cursor(\s|$)|[\\/]cursor(\.exe)?(\s|$)/i },
  { id: 'windsurf', nom: 'Windsurf', re: /[\\/]Windsurf\.app[\\/]Contents[\\/]MacOS[\\/]Electron(\s|$)|[\\/]windsurf(\.exe)?(\s|$)/i },
  { id: 'codeium', nom: 'Codeium', re: /language_server_(macos|linux|windows)/i },
  { id: 'aider', nom: 'Aider', re: /[\\/]aider(\.exe)?(\s|$)/i },
  { id: 'gemini', nom: 'Gemini CLI', re: /@google[\\/]gemini-cli|[\\/]gemini(\.js|\.exe)?(\s|$)/i },
  { id: 'goose', nom: 'Goose', re: /[\\/]goose(d|\.exe)?(\s|$)/i },
  { id: 'opencode', nom: 'OpenCode', re: /[\\/]opencode(\.exe)?(\s|$)/i },
  { id: 'qwen', nom: 'Qwen Code', re: /@qwen-code|[\\/]qwen(\.exe)?(\s|$)/i },
  { id: 'amp', nom: 'Amp', re: /@sourcegraph[\\/]amp|[\\/]amp(\.exe)?(\s|$)/i },
  { id: 'tabnine', nom: 'Tabnine', re: /TabNine(-[\w-]+)?(\.exe)?(\s|$)/i }
];
// Port d'écoute : option --port de la commande, sinon le port par défaut du moteur
const MOTEURS = [
  { id: 'ollama', nom: 'Ollama', re: /[\\/]ollama(\.exe)?\s+serve/i, port: 11434, api: 'ollama' },
  { id: 'lmstudio', nom: 'LM Studio', re: /[\\/]LM Studio\.app[\\/]Contents[\\/]MacOS|[\\/]lm-studio(\.exe)?(\s|$)/i, port: 1234, api: 'openai' },
  { id: 'llamacpp', nom: 'llama.cpp', re: /[\\/]llama-server(\.exe)?(\s|$)|[\\/]llamafile(\s|$)/i, port: 8080, api: 'openai' },
  { id: 'mlx', nom: 'MLX', re: /mlx_lm[. ]server/i, port: 8080, api: 'openai' },
  { id: 'vllm', nom: 'vLLM', re: /\bvllm\s+serve|vllm\.entrypoints/i, port: 8000, api: 'openai' },
  { id: 'koboldcpp', nom: 'KoboldCpp', re: /koboldcpp/i, port: 5001, api: 'openai' },
  { id: 'localai', nom: 'LocalAI', re: /[\\/]local-ai(\s|$)/i, port: 8080, api: 'openai' },
  { id: 'gpt4all', nom: 'GPT4All', re: /[\\/]gpt4all(\.exe)?(\s|$)/i, port: 4891, api: 'openai' },
  { id: 'jan', nom: 'Jan', re: /[\\/]Jan\.app[\\/]Contents[\\/]MacOS|[\\/]jan(\.exe)?(\s|$)/i, port: 1337, api: 'openai' }
];
const CALCUL = /ollama(\.exe)?\s+runner|[\\/]llama-server|[\\/]llamafile|mlx_lm[. ]server|vllm/i;   // processus qui font tourner un modèle
const CPU_ACTIF = 5, CPU_CALCUL = 15;

// Le programme lancé (et son script pour node, python…), sans ses options : un shell dont les arguments citent « aider » n'est pas Aider
const tete = cmd => { const i = cmd.search(/\s-(?!m\s)/); return i < 0 ? cmd : cmd.slice(0, i); };
const outilDe = cmd => OUTILS.find(o => o.re.test(tete(cmd)));
const moteurDe = cmd => MOTEURS.find(m => m.re.test(tete(cmd)));

// pid → ligne de commande
async function commandes() {
  const m = new Map();
  if (process.platform === 'win32') {
    let l = []; try { l = JSON.parse(await sh('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'], 30000)); } catch {}
    for (const p of Array.isArray(l) ? l : []) if (p.CommandLine) m.set(String(p.ProcessId), p.CommandLine);
    return m;
  }
  for (const l of (await sh('ps', process.platform === 'darwin' ? ['-Ao', 'pid=,command='] : ['-eo', 'pid=,args='])).split('\n')) {
    const t = l.trim(), i = t.indexOf(' '); if (i > 0) m.set(t.slice(0, i), t.slice(i + 1));
  }
  return m;
}

async function dossiers(pids) {
  const cwd = {};
  if (!pids.length || process.platform === 'win32') return cwd;
  if (process.platform === 'darwin') {
    let pid = null;
    for (const l of (await sh('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')])).split('\n')) { if (l[0] === 'p') pid = l.slice(1); else if (l[0] === 'n' && pid) cwd[pid] = l.slice(1); }
  } else for (const p of pids) { try { cwd[p] = await fsp.readlink('/proc/' + p + '/cwd'); } catch {} }
  return cwd;
}

// Un dossier générique (racine, dossier personnel) ne dit rien du projet
const dossierUtile = (d, home = os.homedir()) => d && d !== '/' && d !== home ? d : '';
const cleDe = (id, cwd) => 's:p-' + id + '-' + crypto.createHash('sha1').update(cwd || '').digest('hex').slice(0, 8);

// Une « session » de niveau présence par outil et par dossier
function regrouper(procs, cmds, cwd, maintenant) {
  const g = new Map();
  for (const p of procs) {
    const c = cmds.get(p.pid); if (!c) continue;
    const o = outilDe(c); if (!o) continue;
    const d = dossierUtile(cwd[p.pid]), k = o.id + '|' + d;
    const x = g.get(k) || { o, d, cpu: 0, mem: 0, n: 0, pid: p.pid }; x.cpu += p.cpu; x.mem += p.mem; x.n++; g.set(k, x);
  }
  return [...g.values()].map(x => ({
    cle: cleDe(x.o.id, x.d), id: x.o.id, source: x.o.id, niveau: 'presence', nomOrigine: x.o.nom, cwd: x.d, depot: x.d ? projetDuDossier(x.d) : '',
    etat: x.cpu >= CPU_ACTIF ? 'active' : 'inactive', pid: Number(x.pid) || null, debut: 0, derniereActivite: maintenant, stats: null, agents: [],
    processus: { cpu: Math.round(x.cpu), memMo: Math.round(x.mem), nombre: x.n }
  }));
}

const lireJson = async (url, timeout = 1500) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(timeout) }); return r.ok ? await r.json() : null; } catch { return null; } };
const portDe = (cmd, defaut) => { const m = cmd.match(/--port[= ](\d{2,5})/); return m ? Number(m[1]) : defaut; };

// Moteurs de modèles locaux lancés sur le poste ; seuls leurs ports sont interrogés, et uniquement sur 127.0.0.1
async function modeles(procs, cmds) {
  const vus = new Map(); let cpuCalcul = 0;
  for (const p of procs) {
    const c = cmds.get(p.pid); if (!c) continue;
    if (CALCUL.test(tete(c))) cpuCalcul += p.cpu;
    const m = moteurDe(c); if (m && !vus.has(m.id)) vus.set(m.id, { ...m, port: portDe(c, m.port) });
  }
  const calcule = cpuCalcul >= CPU_CALCUL, sortie = [], moteurs = [];
  for (const m of vus.values()) {
    const base = 'http://127.0.0.1:' + m.port;
    if (m.api === 'ollama') {
      const [tags, ps] = await Promise.all([lireJson(base + '/api/tags'), lireJson(base + '/api/ps')]);
      moteurs.push({ id: m.id, nom: m.nom, port: m.port, repond: !!tags });
      const charges = new Map(((ps && ps.models) || []).map(x => [x.name, x]));
      for (const t of (tags && tags.models) || []) {
        const c = charges.get(t.name);
        sortie.push({ moteur: m.nom, nom: t.name, charge: !!c, calcule: !!c && calcule, tailleGo: (t.size || 0) / 2 ** 30, memoireGo: c ? (c.size || 0) / 2 ** 30 : 0, famille: (t.details && t.details.family) || '' });
      }
    } else {
      const j = await lireJson(base + '/v1/models');
      moteurs.push({ id: m.id, nom: m.nom, port: m.port, repond: !!j });
      for (const x of (j && j.data) || []) sortie.push({ moteur: m.nom, nom: x.id, charge: true, calcule, tailleGo: 0, memoireGo: 0, famille: '' });
    }
  }
  return { moteurs, modeles: sortie.sort((a, b) => b.charge - a.charge || a.nom.localeCompare(b.nom)), cpuCalcul: Math.round(cpuCalcul) };
}

async function scanner(procs, maintenant = Date.now()) {
  const cmds = await commandes();
  const utiles = procs.filter(p => { const c = cmds.get(p.pid); return c && outilDe(c); }).map(p => p.pid);
  const cwd = await dossiers(utiles);
  const codexVivant = procs.some(p => /[\\/]codex(\.exe)?$/i.test(p.comm) || /[\\/]codex(\.exe)?(\s|$)/i.test(tete(cmds.get(p.pid) || '')));
  return { sessions: regrouper(procs, cmds, cwd, maintenant), locaux: await modeles(procs, cmds), codexVivant };
}

module.exports = { scanner, regrouper, modeles, outilDe, moteurDe, cleDe, dossierUtile, portDe };
