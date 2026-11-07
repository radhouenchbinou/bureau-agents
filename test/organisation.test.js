'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const org = require('../lib/organisation');

const scan = () => ({
  sessions: [{ cle: 's:s1', depot: 'api', nomOrigine: 'Session API' }, { cle: 's:s2', depot: 'front', nomOrigine: 'Session front' }],
  agents: [{ cle: 'a:s1:x1', session: 's:s1', nomOrigine: 'Agent tests' }, { cle: 'a:s1:x2', session: 's:s1', nomOrigine: 'Agent doc' }]
});
function preparee() { const o = org.nouvelle(); org.synchroniser(o, scan().sessions); return o; }

test('un projet et un bureau par dépôt, créés une seule fois', () => {
  const o = org.nouvelle();
  assert.equal(org.synchroniser(o, scan().sessions), true);
  assert.equal(org.synchroniser(o, scan().sessions), false);
  assert.deepEqual(o.projets.map(p => p.depots), [['api'], ['front']]);
  assert.deepEqual(o.bureaux.map(b => b.id), ['accueil', 'api', 'front']);
});

test('les agents suivent leur session, sauf s\'ils ont leur propre place', () => {
  const o = preparee();
  let r = org.resoudre(o, scan());
  assert.equal(r.sessions['s:s1'].bureau, 'api');
  assert.equal(r.agents['a:s1:x1'].bureau, 'api');
  org.appliquer(o, { op: 'deplacer', cle: 's:s1', bureau: 'front' });
  org.appliquer(o, { op: 'deplacer', cle: 'a:s1:x2', bureau: 'accueil' });
  r = org.resoudre(o, scan());
  assert.equal(r.agents['a:s1:x1'].bureau, 'front');
  assert.equal(r.agents['a:s1:x2'].bureau, 'accueil');
  org.appliquer(o, { op: 'deplacer', cle: 'a:s1:x2', bureau: null });
  assert.equal(org.resoudre(o, scan()).agents['a:s1:x2'].bureau, 'front');
});

test('renommer nettoie le nom, et null rend le nom d\'origine', () => {
  const o = preparee();
  org.appliquer(o, { op: 'renommer', cle: 'a:s1:x1', nom: '  Testeur \n  en   chef  ' + 'x'.repeat(80) });
  const r = org.resoudre(o, scan()).agents['a:s1:x1'];
  assert.equal(r.nom.length, 60);
  assert.ok(r.nom.startsWith('Testeur en chef x'));
  assert.equal(r.renomme, true);
  org.appliquer(o, { op: 'renommer', cle: 'a:s1:x1', nom: null });
  assert.equal(org.resoudre(o, scan()).agents['a:s1:x1'].nom, 'Agent tests');
});

test('supprimer un bureau renvoie ses occupants dans le bureau de leur projet, et l\'accueil est protégé', () => {
  const o = preparee();
  const b = org.appliquer(o, { op: 'bureau.creer', nom: 'Équipe nuit' });
  assert.equal(b.id, 'equipe-nuit');
  org.appliquer(o, { op: 'deplacer', cle: 's:s1', bureau: b.id });
  org.appliquer(o, { op: 'bureau.supprimer', id: b.id });
  assert.equal(org.resoudre(o, scan()).sessions['s:s1'].bureau, 'api');
  assert.throws(() => org.appliquer(o, { op: 'bureau.supprimer', id: 'accueil' }), org.ErreurOrganisation);
});

test('fusionner deux projets regroupe les dépôts et les sessions rattachées', () => {
  const o = preparee();
  const [api, front] = o.projets;
  org.appliquer(o, { op: 'projet.techLead', id: front.id, cle: 's:s2' });
  org.appliquer(o, { op: 'projet.fusionner', source: front.id, cible: api.id });
  assert.deepEqual(o.projets.map(p => p.id), [api.id]);
  assert.deepEqual(o.projets[0].depots, ['api', 'front']);
  assert.equal(o.projets[0].techLead, 's:s2');
  assert.equal(org.resoudre(o, scan()).sessions['s:s2'].projet, api.id);
  // Le dépôt fusionné ne recrée pas de projet
  assert.equal(org.synchroniser(o, scan().sessions), false);
});

test('rôles globaux et rattachement manuel d\'une session à un projet', () => {
  const o = preparee();
  org.appliquer(o, { op: 'role', role: 'chefProjet', cle: 's:s1' });
  org.appliquer(o, { op: 'role', role: 'techLead', cle: 's:s2' });
  assert.deepEqual(o.roles, { chefProjet: 's:s1', techLead: 's:s2' });
  const p = org.appliquer(o, { op: 'projet.creer', nom: 'Refonte' });
  org.appliquer(o, { op: 'session.projet', cle: 's:s1', projet: p.id });
  assert.equal(org.resoudre(o, scan()).sessions['s:s1'].projet, p.id);
});

test('refuse les opérations invalides', () => {
  const o = preparee();
  for (const op of [{}, { op: 'inconnue' }, { op: 'deplacer', cle: 'pas une clé', bureau: 'api' }, { op: 'deplacer', cle: 's:s1', bureau: 'absent' },
    { op: 'renommer', cle: 's:s1', nom: '   ' }, { op: 'role', role: 'roi', cle: 's:s1' }, { op: 'session.projet', cle: 'a:s1:x1', projet: o.projets[0].id },
    { op: 'projet.fusionner', source: o.projets[0].id, cible: o.projets[0].id }, { op: 'bureau.creer', nom: 42 }])
    assert.throws(() => org.appliquer(o, op), org.ErreurOrganisation, JSON.stringify(op));
});

test('normaliser répare un fichier partiel ou abîmé', () => {
  assert.deepEqual(org.normaliser(null), org.nouvelle());
  const n = org.normaliser({ bureaux: [{ id: 'x', nom: 'X' }, { id: 'MAUVAIS ID', nom: 'Y' }], projets: [{ id: 'p', nom: 'P' }], roles: { chefProjet: 's:a' } });
  assert.deepEqual(n.bureaux.map(b => b.id), ['accueil', 'x']);
  assert.deepEqual(n.projets[0].depots, []);
  assert.equal(n.roles.chefProjet, 's:a');
});

test('le stock enregistre de façon atomique et se recharge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-')), f = path.join(dir, 'sous', 'organisation.json');
  const s = new org.StockOrganisation(f);
  await s.charger();
  org.appliquer(s.o, { op: 'bureau.creer', nom: 'Labo' });
  await Promise.all([s.enregistrer(), s.enregistrer()]);
  const s2 = new org.StockOrganisation(f);
  await s2.charger();
  assert.ok(s2.o.bureaux.some(b => b.nom === 'Labo'));
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['organisation.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});
