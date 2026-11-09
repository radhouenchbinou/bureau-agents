'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { calculer, cout, coutDetail, prixDe, PRIX_DEFAUT, GRILLE_DATE } = require('../lib/kpi');
const { worktreeDe, psUnix, nomProcessus } = require('../lib/poste');
const { projetDuDossier, projetDuDossierEncode } = require('../lib/source-claude');

const st = (o = {}) => ({ debut: 0, fin: 60e3, actifMs: 30e3, outils: 10, erreurs: 1, editions: 4, fichiers: 2, commits: 1,
  tokens: { entree: 1e6, sortie: 1e6, cacheLu: 0, cacheEcrit: 0 }, modele: 'claude-sonnet-5-5', ...o });

test('prix par version de modèle, famille en repli, grille remplaçable', () => {
  assert.equal(prixDe('claude-opus-5-5', PRIX_DEFAUT), PRIX_DEFAUT['opus-5-5']);
  assert.equal(prixDe('claude-opus-4-1-20250805', PRIX_DEFAUT), PRIX_DEFAUT['opus-4-1']);
  assert.equal(prixDe('claude-opus-9', PRIX_DEFAUT), PRIX_DEFAUT.opus);
  assert.equal(prixDe('inconnu', PRIX_DEFAUT), PRIX_DEFAUT.defaut);
  assert.equal(cout(st(), PRIX_DEFAUT), 2 + 10);                                    // Sonnet 5.5
  assert.equal(cout(st({ tokens: { entree: 0, sortie: 0, cacheLu: 1e6, cacheEcrit: 1e6 } }), PRIX_DEFAUT), 0.1 + 2.5);
  assert.equal(cout(st(), { ...PRIX_DEFAUT, 'sonnet-5-5': { entree: 1, sortie: 2 } }), 3);
  assert.equal(GRILLE_DATE, '2026-11-09');
});

test('coût par modèle : chaque modèle à son prix, cache 1 h à 2 ×, modèle inconnu signalé', () => {
  const parModele = { 'claude-opus-5-5': { entree: 1e6, sortie: 0, cacheLu: 1e6, ecrit5m: 1e6, ecrit1h: 1e6 },
    'claude-haiku-5-5#>100k': { entree: 1e6, sortie: 1e6, cacheLu: 0, ecrit5m: 0, ecrit1h: 0 } };
  const c = coutDetail(st({ parModele }), PRIX_DEFAUT);
  assert.ok(Math.abs(c.cout - (4 + 0.2 + 5 + 8 + 0.5 + 2.5)) < 1e-9);
  assert.equal(c.approx, false);
  assert.equal(coutDetail(st({ parModele: { 'gpt-x': { entree: 1e6, sortie: 0, cacheLu: 0, ecrit5m: 0, ecrit1h: 0 } } }), PRIX_DEFAUT).approx, true);
});

test('agrégats par projet et bureau sur la fenêtre', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const agents = [
    { cle: 'a:s:1', session: 's:s', etat: 'termine', derniereActivite: now - 60e3, stats: st() },
    { cle: 'a:s:2', session: 's:s', etat: 'en_cours', derniereActivite: now - 10e3, stats: st({ commits: 3 }) },
    { cle: 'a:s:3', session: 's:s', etat: 'termine', derniereActivite: now - 3 * 36e5, stats: st() }];
  const sessions = [{ cle: 's:s', etat: 'active', derniereActivite: now, stats: st({ editions: 0 }) }];
  const r = { sessions: { 's:s': { projet: 'p', bureau: 'b', nom: 'S' } }, agents: Object.fromEntries(agents.map(a => [a.cle, { projet: 'p', bureau: 'b', nom: a.cle }])) };
  const k = calculer({ sessions, agents }, r, { prix: {} }, 36e5, now);
  assert.equal(k.global.agents, 2);           // l'agent terminé il y a 3 h sort de la fenêtre d'une heure
  assert.equal(k.global.termines, 1);
  assert.equal(k.global.enCours, 1);
  assert.equal(k.global.sessions, 1);
  assert.equal(k.global.commits, 1 + 3 + 1);
  assert.equal(k.global.terminesParHeure, 1);
  assert.equal(k.projets.p.cout, 3 * 12);
  assert.equal(k.tarifs, GRILLE_DATE);
  assert.equal(k.bureaux.b.editions, 8);
  assert.equal(k.global.tauxErreur, 3 / 30);
});

test('worktree d\'un build et regroupement des processus', () => {
  assert.equal(worktreeDe('/Users/u/IdeaProjects/wt/core-f4/module'), 'core-f4');
  assert.equal(worktreeDe('C:\\dev\\app\\.claude\\worktrees\\canal-12\\x'), 'canal-12');
  assert.equal(worktreeDe('/home/u/app'), undefined);
  const p = psUnix('  12  5.0 2048 /usr/bin/java\n 13 0.1 100 /Applications/Claude.app/Contents/MacOS/Claude\n');
  assert.deepEqual(p.map(x => x.pid), ['12', '13']);
  assert.equal(nomProcessus(p[0], { 12: '/Users/u/IdeaProjects/wt/ba-f1' }), 'Build ba-f1');
  assert.equal(nomProcessus(p[1], {}), 'Claude');
  assert.equal(nomProcessus({ pid: '1', comm: 'C:\\Program Files\\Java\\bin\\java.exe' }, {}), 'Java');
});

test('nom de dépôt depuis le dossier de travail, sous Unix et Windows', () => {
  assert.equal(projetDuDossier('/Users/u/IdeaProjects/kompta-mcp/.claude/worktrees/doc-x'), 'kompta-mcp');
  assert.equal(projetDuDossier('C:\\Users\\u\\code\\api'), 'api');
  assert.equal(projetDuDossier('/Users/u/Library/Application Support/Claude/scratch-workspaces/a/b'), 'brouillons');
  assert.equal(projetDuDossierEncode('-Users-u-IdeaProjects-cloud-ai-core--claude-worktrees-x', '/Users/u'), 'cloud-ai-core');
});
