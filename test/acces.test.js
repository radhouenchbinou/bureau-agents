'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { controler, session, COOKIE } = require('../lib/acces');

const req = (headers, method = 'GET') => ({ method, headers });
const U = p => new URL(p, 'http://x');
const local = { host: '127.0.0.1', port: 4747 };

test('serveur local : seuls les noms locaux sur le bon port passent (DNS rebinding)', () => {
  for (const h of ['127.0.0.1:4747', 'localhost:4747', '[::1]:4747', 'LOCALHOST:4747'])
    assert.deepEqual(controler(req({ host: h }), U('/api/etat'), local), { ok: true }, h);
  for (const h of ['attaquant.example:4747', 'localhost:80', '127.0.0.1', '', undefined])
    assert.equal(controler(req({ host: h }), U('/api/etat'), local).refus[0], 421, String(h));
  assert.deepEqual(controler(req({ host: 'bureau.lan:4747' }), U('/'), { ...local, hotes: ['bureau.lan:4747'] }), { ok: true });
});

test('jeton : lien ?t= → cookie HttpOnly SameSite=Strict et redirection sans le jeton', () => {
  const o = { host: '0.0.0.0', port: 4747, token: 'secret-123' };
  assert.equal(controler(req({ host: 'x' }), U('/api/etat'), o).refus[0], 401);
  assert.equal(controler(req({ host: 'x' }), U('/?t=faux'), o).refus[0], 401);
  const r = controler(req({ host: 'x' }), U('/?fenetre=1h&t=secret-123'), o);
  assert.equal(r.redirection, '/?fenetre=1h');
  assert.match(r.cookie, /HttpOnly; SameSite=Strict/);
  assert.ok(!r.cookie.includes('secret-123'));
  assert.deepEqual(controler(req({ host: 'x', cookie: 'a=b; ' + COOKIE + '=' + session('secret-123') }), U('/api/etat'), o), { ok: true });
  assert.deepEqual(controler(req({ host: 'x', 'x-bureau-token': 'secret-123' }, 'POST'), U('/api/organisation'), o), { ok: true });
  assert.equal(controler(req({ host: 'x' }, 'POST'), U('/api/organisation?t=secret-123'), o).refus[0], 401);   // jamais par l'URL en POST
  assert.match(controler(req({ host: 'x' }), U('/?t=secret-123'), { ...o, https: true }).cookie, /; Secure$/);
});
