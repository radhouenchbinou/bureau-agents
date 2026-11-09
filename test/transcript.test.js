'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { IndexTranscripts, appliquer, vide, creeUnCommit } = require('../lib/transcript');
const { masquer } = require('../lib/masque');

const L = o => JSON.stringify(o);
const asst = (id, ts, content, usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }) =>
  L({ type: 'assistant', timestamp: ts, gitBranch: 'feature/x', cwd: '/home/u/projets/app', message: { id, model: 'claude-opus-5-5', usage, content } });

test('compte outils, éditions, fichiers distincts, commits et erreurs', () => {
  const st = vide();
  appliquer(st, L({ type: 'user', timestamp: '2026-11-07T10:00:00Z', message: { role: 'user', content: 'Corrige le bug du panier' } }));
  appliquer(st, asst('m1', '2026-11-07T10:00:10Z', [{ type: 'tool_use', name: 'Edit', input: { file_path: '/a.js' } }, { type: 'tool_use', name: 'Write', input: { file_path: '/a.js' } }]));
  appliquer(st, asst('m2', '2026-11-07T10:01:00Z', [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'git add -A && git commit -m "x"' } }, { type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'git commit --dry-run' } }]));
  appliquer(st, asst('m3', '2026-11-07T10:01:02Z', [{ type: 'tool_use', id: 'b3', name: 'Bash', input: { command: 'git commit -m "y"' } }]));
  appliquer(st, L({ type: 'user', timestamp: '2026-11-07T10:01:05Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'ok' }, { type: 'tool_result', tool_use_id: 'b3', is_error: true, content: 'Exit code 1' }] } }));
  assert.equal(st.outils, 5);
  assert.equal(st.editions, 2);
  assert.deepEqual(st.fichiers, ['/a.js']);
  assert.equal(st.commits, 1);
  assert.equal(st.erreurs, 1);
  assert.equal(st.consigne, 'Corrige le bug du panier');
  assert.equal(st.branche, 'feature/x');
  assert.equal(st.cwd, '/home/u/projets/app');
});

test('une réponse découpée en plusieurs lignes ne compte ses jetons qu\'une fois', () => {
  const st = vide();
  appliquer(st, asst('m1', '2026-11-07T10:00:00Z', [{ type: 'text', text: 'a' }], { input_tokens: 10, output_tokens: 2 }));
  appliquer(st, asst('m1', '2026-11-07T10:00:01Z', [{ type: 'tool_use', name: 'Read', input: {} }], { input_tokens: 10, output_tokens: 8 }));
  appliquer(st, asst('m2', '2026-11-07T10:00:02Z', [], { input_tokens: 1, output_tokens: 1 }));
  assert.equal(st.tokens.entree, 11);
  assert.equal(st.tokens.sortie, 9);
  assert.equal(st.modeles['claude-opus-5-5'], 2);
});

test('temps actif : les pauses de plus de 5 min ne comptent pas', () => {
  const st = vide();
  for (const ts of ['2026-11-07T10:00:00Z', '2026-11-07T10:02:00Z', '2026-11-07T10:30:00Z', '2026-11-07T10:31:00Z'])
    appliquer(st, L({ type: 'system', timestamp: ts }));
  assert.equal(st.actifMs, 3 * 60e3);
  assert.equal(st.fin - st.debut, 31 * 60e3);
});

test('ignore les lignes api-request et les lignes illisibles', () => {
  const st = vide();
  appliquer(st, '{"type":"api-request-blob","message":{"role":"user","content":[{"type":"tool_result","is_error":true}]}}');
  appliquer(st, '{pas du json');
  assert.equal(st.erreurs, 0);
});

test('lecture incrémentale : ne relit que les octets ajoutés et garde une ligne incomplète pour plus tard', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-')), f = path.join(dir, 't.jsonl');
  const l1 = asst('m1', '2026-11-07T10:00:00Z', [{ type: 'tool_use', name: 'Edit', input: { file_path: '/x' } }]) + '\n';
  const l2 = asst('m2', '2026-11-07T10:00:30Z', [{ type: 'tool_use', name: 'Edit', input: { file_path: '/y' } }]);
  fs.writeFileSync(f, l1 + l2.slice(0, 20));
  const idx = new IndexTranscripts();
  let st = await idx.lire(f, fs.statSync(f).size);
  assert.equal(st.editions, 1);
  assert.equal(idx.fichiers[f].offset, Buffer.byteLength(l1));
  fs.writeFileSync(f, l1 + l2 + '\n');
  st = await idx.lire(f, fs.statSync(f).size);
  assert.equal(st.editions, 2);
  // Index sauvegardé puis rechargé : rien n'est recompté
  const idx2 = new IndexTranscripts(JSON.parse(JSON.stringify(idx)));
  st = await idx2.lire(f, fs.statSync(f).size);
  assert.equal(st.editions, 2);
  // Fichier raccourci : relu depuis le début
  fs.writeFileSync(f, l1);
  st = await idx2.lire(f, fs.statSync(f).size);
  assert.equal(st.editions, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un index d\'une ancienne version est ignoré', () => {
  assert.deepEqual(new IndexTranscripts({ '/a': { offset: 3 } }).fichiers, {});
  assert.deepEqual(new IndexTranscripts({ v: 1, fichiers: { '/a': {} } }).fichiers, {});
});

test('détection des commits : début de commande, hors guillemets, sans --dry-run ni --amend', () => {
  for (const c of ['git commit -m x', 'cd a && git commit -am "y"', 'GIT_AUTHOR_NAME=x git -C repo commit -m z', 'make; git commit -m "a; b"'])
    assert.ok(creeUnCommit(c), c);
  for (const c of ['echo "git commit"', 'git log --grep commit', 'git commit --amend --no-edit', 'git commit --dry-run', "grep 'git commit' f", 'git status'])
    assert.ok(!creeUnCommit(c), c);
});

test('jetons par modèle, cache 1 h séparé, palier Haiku 5.5, réponse entrecoupée dédoublonnée', () => {
  const st = vide(), m = (id, model, usage) => L({ type: 'assistant', timestamp: '2026-11-07T10:00:00Z', message: { id, model, usage, content: [] } });
  appliquer(st, m('a', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 300, cache_creation: { ephemeral_1h_input_tokens: 100 } }));
  appliquer(st, m('b', 'claude-haiku-5-5', { input_tokens: 150000, output_tokens: 1 }));
  appliquer(st, m('a', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 7, cache_creation_input_tokens: 300, cache_creation: { ephemeral_1h_input_tokens: 100 } }));
  assert.deepEqual(st.parModele['claude-opus-5-5'], { entree: 10, sortie: 7, cacheLu: 0, ecrit5m: 200, ecrit1h: 100 });
  assert.equal(st.parModele['claude-haiku-5-5#>100k'].entree, 150000);
  assert.equal(st.tokens.sortie, 8);
  assert.equal(st.tokens.cacheEcrit, 300);
});

test('consigne : les secrets collés sont masqués', () => {
  const st = vide();
  appliquer(st, L({ type: 'user', message: { role: 'user', content: 'Utilise ghp_abcdefghijklmnopqrstuvwxyz123456 et password=hunter2' } }));
  assert.equal(st.consigne, 'Utilise ghp_•••• et password=••••');
  assert.equal(masquer('postgres://rne:s3cr3t@h/db'), 'postgres://rne:••••@h/db');
  assert.match(masquer('-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----'), /^\[clé privée masquée\]$/);
});
