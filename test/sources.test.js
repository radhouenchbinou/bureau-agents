'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { presence, Stabilisateur } = require('../lib/presence');
const { appliquer, vide, IndexTranscripts } = require('../lib/transcript');
const codex = require('../lib/source-codex');
const proc = require('../lib/source-processus');

const NOW = Date.parse('2026-11-09T12:00:00Z'), L = JSON.stringify;

test('présence d\'un agent : poste, pause, parti, et un outil qui tourne le garde à son poste', () => {
  const a = (age, outils = 0, etat = 'en_cours') => ({ cle: 'a:s:x', etat, derniereActivite: NOW - age, stats: { outilsEnCours: outils } });
  const o = { maintenant: NOW, seuilMs: 120e3 };
  assert.equal(presence(a(10e3), o).presence, 'poste');
  assert.equal(presence(a(300e3), o).presence, 'pause');
  assert.deepEqual(presence(a(600e3, 1), o), { presence: 'poste', raison: 'outil' });
  assert.equal(presence(a(2 * 3600e3, 1), o).presence, 'pause');   // outil perdu
  assert.equal(presence(a(1e3, 0, 'termine'), o).presence, 'parti');
  assert.equal(presence(a(1e3, 0, 'interrompu'), o).presence, 'parti');
});

test('présence d\'une session selon son état et son niveau de visibilité', () => {
  assert.equal(presence({ cle: 's:a', etat: 'active' }).presence, 'poste');
  assert.deepEqual(presence({ cle: 's:a', etat: 'inactive', niveau: 'complet' }), { presence: 'pause', raison: 'attend' });
  assert.deepEqual(presence({ cle: 's:a', etat: 'inactive', niveau: 'presence' }), { presence: 'pause', raison: 'repos' });
  assert.equal(presence({ cle: 's:a', etat: 'terminee' }).presence, 'parti');
});

test('un changement de présence n\'est appliqué qu\'après 30 s, partir est immédiat', () => {
  const s = new Stabilisateur(30e3);
  assert.equal(s.filtrer('k', 'poste', 0), 'poste');
  assert.equal(s.filtrer('k', 'pause', 1000), 'poste');
  assert.equal(s.filtrer('k', 'poste', 5000), 'poste');   // retour : le compteur repart
  assert.equal(s.filtrer('k', 'pause', 6000), 'poste');
  assert.equal(s.filtrer('k', 'pause', 35000), 'poste');
  assert.equal(s.filtrer('k', 'pause', 36000), 'pause');
  assert.equal(s.filtrer('k', 'parti', 36001), 'parti');
  assert.equal(s.filtrer('k', 'poste', 36002), 'poste');
});

test('Claude Code : un outil reste en cours jusqu\'à son résultat', () => {
  const st = vide();
  appliquer(st, L({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'mvn test' } }] } }));
  assert.deepEqual(st.enCours, ['t1']); assert.equal(st.dernierOutil, 'Bash');
  appliquer(st, L({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }));
  assert.deepEqual(st.enCours, []);
});

test('Codex : modèle, jetons cumulés, outils, commits, tours et consigne', () => {
  const st = codex.vide(), e = (type, payload, ts = '2026-11-09T10:00:00Z') => codex.appliquer(st, L({ type, timestamp: ts, payload }));
  e('session_meta', { id: 'f1', cwd: '/home/u/app', parent_thread_id: null });
  e('turn_context', { model: 'gpt-x', cwd: '/home/u/app/sous' });
  e('event_msg', { type: 'task_started' });
  e('event_msg', { type: 'user_message', message: '<system-reminder>ignoré</system-reminder>' });
  e('event_msg', { type: 'user_message', message: 'Corrige le panier' });
  e('response_item', { type: 'function_call', name: 'exec', call_id: 'c1', arguments: 'git add . && git commit -m x' });
  assert.equal(st.enCours.length, 1);
  e('response_item', { type: 'function_call_output', call_id: 'c1', output: 'ok' });
  e('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c2', input: 'x' });
  e('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 10, output_tokens: 7 } } });
  e('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 200, cached_input_tokens: 60, cache_write_input_tokens: 10, output_tokens: 9 } } });
  assert.deepEqual(st.tokens, { entree: 130, sortie: 9, cacheLu: 60, cacheEcrit: 10 });
  assert.equal(st.outils, 2); assert.equal(st.commits, 1); assert.equal(st.editions, 1);
  assert.equal(st.consigne, 'Corrige le panier'); assert.equal(st.cwd, '/home/u/app/sous'); assert.equal(st.enTour, true);
  e('event_msg', { type: 'task_complete' });
  assert.equal(st.enTour, false); assert.deepEqual(st.enCours, []);
});

test('Codex : ignore les sessions importées, relie les agents à leur fil et applique l\'état', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-cx-')), jour = new Date(), j = path.join(dir, 'sessions', String(jour.getFullYear()), String(jour.getMonth() + 1).padStart(2, '0'), String(jour.getDate()).padStart(2, '0'));
  fs.mkdirSync(j, { recursive: true });
  const fil = (id, lignes) => fs.writeFileSync(path.join(j, 'rollout-' + id + '.jsonl'), lignes.map(l => L(l)).join('\n') + '\n');
  const ts = new Date().toISOString(), meta = (id, parent) => ({ type: 'session_meta', timestamp: ts, payload: { id, cwd: '/x/app', parent_thread_id: parent || null, agent_nickname: parent ? 'Testeur' : null } });
  const ctx = { type: 'turn_context', timestamp: ts, payload: { model: 'gpt-x' } }, go = { type: 'event_msg', timestamp: ts, payload: { type: 'task_started' } };
  fil('reel', [meta('reel'), ctx, go]); fil('enfant', [meta('enfant', 'reel'), ctx, go]); fil('importe', [meta('importe')]);
  fs.writeFileSync(path.join(dir, 'session_index.jsonl'), L({ id: 'reel', thread_name: 'Ma tâche' }) + '\n');
  const src = new codex.SourceCodex({ dossier: dir, index: new IndexTranscripts() });
  let r = await src.scanner(Date.now(), { codexVivant: true });
  assert.deepEqual(r.sessions.map(s => [s.id, s.nomOrigine, s.etat, s.depot]), [['reel', 'Ma tâche', 'active', 'app']]);
  assert.deepEqual(r.agents.map(a => [a.nomOrigine, a.session, a.etat]), [['Testeur', 's:reel', 'en_cours']]);
  r = await src.scanner(Date.now(), { codexVivant: false });
  assert.equal(r.sessions[0].etat, 'terminee');
  assert.equal(r.agents[0].etat, 'interrompu');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('signatures de processus : reconnaît les outils sans faux positif', () => {
  const trouve = c => (proc.outilDe(c) || {}).id;
  assert.equal(trouve('/Users/u/Library/Application Support/JetBrains/plugins/github-copilot-intellij/copilot-agent/native/darwin-arm64/copilot-language-server --stdio'), 'copilot');
  assert.equal(trouve('/Applications/Cursor.app/Contents/MacOS/Cursor'), 'cursor');
  assert.equal(trouve('/usr/bin/python3 /home/u/.local/bin/aider --model x'), 'aider');
  assert.equal(trouve('node /usr/lib/node_modules/@google/gemini-cli/dist/index.js'), 'gemini');
  assert.equal(trouve('/System/Library/PrivateFrameworks/TextInputUIMacHelper.framework/XPCServices/CursorUIViewService.xpc/Contents/MacOS/CursorUIViewService'), undefined);
  assert.equal(trouve('/bin/zsh -c cat notes-amplitude.txt'), undefined);
  assert.equal(trouve('sh -c exec /usr/local/bin/aider sleep 30'), undefined);
  assert.equal(trouve('grep -r /usr/bin/aider .'), undefined);
  const moteur = c => (proc.moteurDe(c) || {}).id;
  assert.equal(moteur('/opt/homebrew/opt/ollama/bin/ollama serve'), 'ollama');
  assert.equal(moteur('/usr/local/bin/llama-server -m x.gguf --port 9090'), 'llamacpp');
  assert.equal(moteur('python -m mlx_lm.server --model y'), 'mlx');
  assert.equal(moteur('/usr/bin/java -jar ollama-client.jar'), undefined);
  assert.equal(proc.portDe('llama-server --port 9090', 8080), 9090);
  assert.equal(proc.portDe('llama-server', 8080), 8080);
});

test('un outil vu par processus : un groupe par dossier, actif selon le processeur, sans ligne de commande exposée', () => {
  const secret = '--api-key=SECRET123';
  const procs = [{ pid: '1', cpu: 8, mem: 100, comm: 'a' }, { pid: '2', cpu: 1, mem: 50, comm: 'b' }, { pid: '3', cpu: 0, mem: 10, comm: 'c' }, { pid: '4', cpu: 90, mem: 10, comm: 'autre' }];
  const cmds = new Map([['1', '/bin/aider ' + secret], ['2', '/bin/aider ' + secret], ['3', '/bin/aider'], ['4', '/usr/bin/vim']]);
  const r = proc.regrouper(procs, cmds, { 1: '/home/u/app', 2: '/home/u/app', 3: os.homedir() }, NOW);
  assert.equal(r.length, 2);
  const app = r.find(x => x.depot === 'app'), sans = r.find(x => x.depot === '');
  assert.equal(app.etat, 'active'); assert.equal(app.niveau, 'presence'); assert.deepEqual(app.processus, { cpu: 9, memMo: 150, nombre: 2 });
  assert.equal(sans.etat, 'inactive'); assert.equal(sans.cwd, '');
  assert.ok(!JSON.stringify(r).includes('SECRET123'));
  assert.equal(proc.cleDe('aider', '/a'), proc.cleDe('aider', '/a'));
  assert.match(app.cle, /^s:p-aider-[0-9a-f]{8}$/);
});

test('modèles Ollama : installés, chargés, en calcul si le processus du modèle travaille', async () => {
  const srv = http.createServer((q, s) => {
    s.setHeader('Content-Type', 'application/json');
    if (q.url === '/api/tags') s.end(L({ models: [{ name: 'a:8b', size: 2 ** 30, details: { family: 'llama' } }, { name: 'b:3b', size: 2 ** 31 }] }));
    else if (q.url === '/api/ps') s.end(L({ models: [{ name: 'a:8b', size: 3 * 2 ** 30 }] }));
    else { s.statusCode = 404; s.end('{}'); }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port, cmds = new Map([['1', '/bin/ollama serve --port ' + port], ['2', '/bin/ollama runner --model z']]);
  let r = await proc.modeles([{ pid: '1', cpu: 0, mem: 1, comm: 'x' }, { pid: '2', cpu: 50, mem: 1, comm: 'y' }], cmds);
  assert.deepEqual(r.moteurs, [{ id: 'ollama', nom: 'Ollama', port, repond: true }]);
  assert.deepEqual(r.modeles.map(m => [m.nom, m.charge, m.calcule, Math.round(m.memoireGo)]), [['a:8b', true, true, 3], ['b:3b', false, false, 0]]);
  r = await proc.modeles([{ pid: '1', cpu: 0, mem: 1, comm: 'x' }, { pid: '2', cpu: 1, mem: 1, comm: 'y' }], cmds);
  assert.equal(r.modeles[0].calcule, false);
  srv.close();
  // Sans moteur lancé, aucun port n'est interrogé
  assert.deepEqual((await proc.modeles([{ pid: '9', cpu: 0, mem: 0, comm: 'z' }], new Map([['9', '/bin/ls']]))).moteurs, []);
});
