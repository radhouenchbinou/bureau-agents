// Bureau des agents (2D) : plan des bureaux avec glisser-déposer, fiche, rendement, santé du poste et organisation.
// Les données viennent de /api/etat toutes les 10 s ; chaque modification passe par POST /api/organisation.
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

const ETATS = {
  en_cours: { t: 'en cours', css: 'var(--run)', vif: true }, en_attente: { t: 'en attente', css: 'var(--warn)', vif: true },
  termine: { t: 'terminé', css: 'var(--done)' }, interrompu: { t: 'interrompu', css: 'var(--risk)' },
  active: { t: 'au travail', css: 'var(--run)', vif: true }, inactive: { t: 'en pause', css: 'var(--warn)', vif: true }, terminee: { t: 'fermée', css: 'var(--done)' }
};
const FEN_MS = { '1h': 36e5, '24h': 864e5, '7j': 7 * 864e5 };
const PALETTE = ['#6a61d0', '#13866a', '#c4512a', '#2f6fb3', '#b0801c', '#a24c97', '#4f8a2f', '#1f8a99', '#8a5a3a', '#c0446a'];
const hash = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const couleur = id => id ? PALETTE[hash(id) % PALETTE.length] : '#8a877d';

// ---------- Formats ----------
const fr = (n, d = 1) => n == null ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const nb = n => n == null ? '—' : n >= 1e9 ? fr(n / 1e9) + ' Md' : n >= 1e6 ? fr(n / 1e6) + ' M' : n >= 1e4 ? fr(n / 1e3, 0) + ' k' : Number(n).toLocaleString('fr-FR');
const dollars = n => n == null ? '—' : (n >= 100 ? fr(n, 0) : fr(n, 2)) + ' $';
const pct = n => n == null ? '—' : fr(100 * n) + ' %';
function duree(ms) { if (!ms) return '—'; const s = Math.round(ms / 1000); if (s < 60) return s + ' s'; const m = Math.round(s / 60); if (m < 60) return m + ' min'; const h = Math.floor(m / 60); return h + ' h ' + String(m % 60).padStart(2, '0'); }
function ago(ms) { if (!ms) return '—'; const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 90 ? 'il y a ' + s + ' s' : s < 5400 ? 'il y a ' + Math.round(s / 60) + ' min' : s < 172800 ? 'il y a ' + Math.round(s / 3600) + ' h' : 'il y a ' + Math.round(s / 86400) + ' j'; }
const initiales = n => (String(n).match(/[\p{L}\p{N}]+/gu) || ['?']).slice(0, 2).map(w => w[0]).join('').toUpperCase();

// ---------- État ----------
const TQ = new URLSearchParams(location.search).get('t');
let D = null, S = new Map(), A = new Map(), P = new Map(), B = new Map();
let vue = store.get('bureau.vue') || 'plan', fen = store.get('bureau.fen') || '24h', fermees = store.get('bureau.fermees') === '1', cherche = '', sel = store.get('bureau.sel');
let tri = { agents: { c: 'cout', asc: false }, sessions: { c: 'cout', asc: false } };
$('fermees').checked = fermees;

const nomDe = cle => (S.get(cle) || A.get(cle) || {}).nom || 'absent';
function rolesDe(cle) {
  const o = D.organisation, r = [];
  if (o.roles.chefProjet === cle) r.push(['Chef de projet', 'cp']);
  if (o.roles.techLead === cle) r.push(['Tech lead', 'tl']);
  for (const p of o.projets) if (p.techLead === cle) r.push(['TL · ' + p.nom, 'tl']);
  return r;
}
const enFenetre = x => ETATS[x.etat].vif || x.derniereActivite >= Date.now() - FEN_MS[fen];
const correspond = x => !cherche || x.nom.toLowerCase().includes(cherche) || (x.nomOrigine || '').toLowerCase().includes(cherche);
function sessionsVisibles() { return D.sessions.filter(s => (fermees || s.etat !== 'terminee') && enFenetre(s)); }
function agentsVisibles(s) { return s.agents.map(k => A.get(k)).filter(a => a && enFenetre(a)); }
// Pendant qu'on tape dans un champ, on ne redessine pas le bloc qui le contient
const occupe = el => { const a = document.activeElement; return a && el.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); };

// ---------- Plan ----------
function carte(x, lead) {
  const e = ETATS[x.etat], p = P.get(x.projet), roles = lead ? rolesDe(x.cle) : [];
  return '<button type="button" class="pers' + (lead ? ' lead' : '') + (e.vif ? '' : ' fini') + (sel === x.cle ? ' on' : '') + '" draggable="true" data-k="' + esc(x.cle) + '" style="--c:' + couleur(x.projet) + ';--e:' + e.css + '" title="' + esc(x.nom) + '">'
    + '<span class="av">' + esc(initiales(x.nom)) + '<i' + (x.etat === 'en_cours' || x.etat === 'active' ? ' class="pulse"' : '') + '></i></span>'
    + '<span class="nm">' + esc(x.nom) + '</span>'
    + (lead ? '<span class="roles">' + roles.map(r => '<span class="role ' + r[1] + '">' + esc(r[0]) + '</span>').join('') + '</span>' : '')
    + '<span class="sub">' + e.t + (lead ? ' · ' + esc(p ? p.nom : x.depot) : x.etat === 'en_cours' || x.etat === 'en_attente' ? '' : ' · ' + ago(x.derniereActivite)) + '</span></button>';
}
function renderPlan() {
  const parBureau = new Map(D.organisation.bureaux.map(b => [b.id, new Map()]));
  const equipe = (b, s) => { const m = parBureau.get(b) || parBureau.get('accueil'); if (!m.has(s.cle)) m.set(s.cle, { s, lead: false, agents: [] }); return m.get(s.cle); };
  for (const s of sessionsVisibles()) {
    const ag = agentsVisibles(s), okS = correspond(s), okA = ag.filter(correspond);
    if (!okS && !okA.length) continue;
    if (okS || okA.some(a => a.bureau === s.bureau)) equipe(s.bureau, s).lead = true;
    for (const a of okS ? ag : okA) equipe(a.bureau, s).agents.push(a);
  }
  const pleins = [], vides = [];
  for (const b of D.organisation.bureaux) (parBureau.get(b.id).size ? pleins : vides).push(b);
  const piece = b => {
    const eq = [...parBureau.get(b.id).values()], n = eq.reduce((x, e) => x + e.agents.length + (e.lead ? 1 : 0), 0);
    return '<section class="piece" data-b="' + esc(b.id) + '" style="--c:' + couleur(b.id) + '"><div class="piece-h"><h3>' + esc(b.nom) + '</h3><small>' + n + ' pers.</small></div><div class="piece-b">'
      + (eq.length ? eq.map(e => '<div class="equipe">' + (e.lead ? carte(e.s, true) : '<p class="none" style="font-size:11.5px">Équipe de ' + esc(e.s.nom) + '</p>')
        + (e.agents.length ? '<div class="postes">' + e.agents.map(a => carte(a, false)).join('') + '</div>' : '') + '</div>').join('') : '<div class="piece-vide">Bureau vide : glisse quelqu\'un ici.</div>')
      + '</div></section>';
  };
  $('plan').innerHTML = pleins.map(piece).join('') + vides.map(piece).join('')
    + '<div class="ajout"><form id="f-bureau"><input type="text" name="nom" maxlength="60" placeholder="Nom du nouveau bureau" aria-label="Nom du nouveau bureau" required><button class="btn prim" type="submit">Créer</button></form></div>';
}
const plan = $('plan');
plan.addEventListener('click', e => { const b = e.target.closest('.pers'); if (b) choisir(b.dataset.k, true); });
plan.addEventListener('dragstart', e => { const b = e.target.closest('.pers'); if (!b) return; e.dataTransfer.setData('text/plain', b.dataset.k); e.dataTransfer.effectAllowed = 'move'; b.classList.add('glisse'); });
plan.addEventListener('dragend', e => { const b = e.target.closest('.pers'); if (b) b.classList.remove('glisse'); plan.querySelectorAll('.cible').forEach(x => x.classList.remove('cible')); });
plan.addEventListener('dragover', e => { const p = e.target.closest('.piece'); if (!p) return; e.preventDefault(); plan.querySelectorAll('.cible').forEach(x => x !== p && x.classList.remove('cible')); p.classList.add('cible'); });
plan.addEventListener('drop', e => { const p = e.target.closest('.piece'); if (!p) return; e.preventDefault(); p.classList.remove('cible'); deplacer(e.dataTransfer.getData('text/plain'), p.dataset.b); });
plan.addEventListener('submit', e => { if (e.target.id !== 'f-bureau') return; e.preventDefault(); const nom = e.target.nom.value.trim(); if (nom) envoyer({ op: 'bureau.creer', nom }); });
function deplacer(cle, bureau) {
  const a = A.get(cle), s = S.get(cle); if (!a && !s) return;
  // Un agent qui rejoint le bureau de sa session reprend la place par défaut (il suivra sa session)
  const cible = a && S.get(a.session) && S.get(a.session).bureau === bureau ? null : bureau;
  if ((a || s).bureau === bureau && cible !== null) return;
  envoyer({ op: 'deplacer', cle, bureau: cible });
}

// ---------- Fiche ----------
function options(liste, val, vide) { return (vide ? '<option value="">' + esc(vide) + '</option>' : '') + liste.map(([v, t]) => '<option value="' + esc(v) + '"' + (v === val ? ' selected' : '') + '>' + esc(t) + '</option>').join(''); }
const optBureaux = val => options(D.organisation.bureaux.map(b => [b.id, b.nom]), val);
function mini(m) {
  const t = [['Durée', duree(m.dureeMs)], ['Temps actif', duree(m.actifMs)], ['Outils', nb(m.outils)], ['Erreurs', m.outils ? pct(m.tauxErreur) : '—'], ['Éditions', nb(m.editions)], ['Fichiers', nb(m.fichiers)],
    ['Commits', nb(m.commits)], ['Jetons', nb(m.jetons)], ['Coût estimé', dollars(m.cout)]];
  return '<div class="mini">' + t.map(([k, v]) => '<div><b>' + v + '</b><span>' + k + '</span></div>').join('') + '</div>';
}
function blocNom(x) {
  return '<div><p class="kicker">Nom affiché</p><form class="ligne" data-act="renommer"><input type="text" name="nom" maxlength="60" value="' + esc(x.nom) + '" aria-label="Nom affiché"><button class="btn" type="submit">Renommer</button>'
    + (x.renomme ? '<button class="btn" type="button" data-act="nom-origine">Nom d\'origine</button>' : '') + '</form>' + (x.renomme ? '<p class="orig">À l\'origine : ' + esc(x.nomOrigine) + '</p>' : '') + '</div>';
}
function renderFiche() {
  const f = $('fiche'); if (occupe(f)) return;
  const x = sel && (A.get(sel) || S.get(sel));
  if (!x) { f.innerHTML = '<p class="kicker">Fiche</p><p class="none">' + (D ? 'Clique sur une personne pour voir ce qu\'elle fait, la renommer ou la changer de bureau.' : 'Chargement…') + '</p>'; return; }
  const e = ETATS[x.etat], c = couleur(x.projet), p = P.get(x.projet), st = x.stats || {};
  if (x.cle.startsWith('a:')) {
    const s = S.get(x.session), build = D.poste && x.worktree && D.poste.builds.includes(x.worktree);
    f.innerHTML = '<div class="who"><span class="badge" style="--c:' + c + '">' + esc(x.type) + '</span><span class="etat" style="--e:' + e.css + '">' + e.t + '</span>' + (x.arrierePlan ? '<span class="orig">arrière-plan</span>' : '') + '</div>'
      + '<div><p class="kicker">' + (e.vif ? 'Travaille sur' : 'A travaillé sur') + '</p><h2>' + esc(x.nom) + '</h2></div>'
      + blocNom(x)
      + '<label class="ligne"><span class="kicker" style="margin:0;flex:0 0 auto">Bureau</span><select data-act="bureau">' + optBureaux(x.bureau) + '</select></label>'
      + mini(x.mesures)
      + (x.consigne ? '<div><p class="kicker">Début de sa consigne</p><p class="consigne">' + esc(x.consigne) + '</p></div>' : '')
      + '<dl class="meta"><dt>Session</dt><dd>' + (s ? '<button type="button" class="btn petit" data-k="' + esc(s.cle) + '">' + esc(s.nom) + '</button>' : '—') + '</dd><dt>Projet</dt><dd>' + esc(p ? p.nom : '—') + '</dd>'
      + (x.worktree ? '<dt>Worktree</dt><dd>' + esc(x.worktree) + (build ? ' · <span style="color:var(--warn)">build en cours</span>' : '') + '</dd>' : '')
      + (st.branche ? '<dt>Branche</dt><dd>' + esc(st.branche) + '</dd>' : '') + (st.modele ? '<dt>Modèle</dt><dd>' + esc(st.modele) + '</dd>' : '')
      + '<dt>Début</dt><dd>' + (x.debut ? new Date(x.debut).toLocaleString('fr-FR') : '—') + '</dd><dt>Activité</dt><dd>' + ago(x.derniereActivite) + '</dd></dl>';
  } else {
    const o = D.organisation, ag = x.agents.map(k => A.get(k)).filter(Boolean), tot = ag.reduce((t, a) => { for (const k of ['jetons', 'cout', 'editions', 'commits']) t[k] += a.mesures[k]; return t; }, { jetons: 0, cout: 0, editions: 0, commits: 0 });
    const on = (v, t, act) => '<button type="button" class="btn petit' + (v ? ' prim' : '') + '" aria-pressed="' + v + '" data-act="' + act + '">' + t + '</button>';
    f.innerHTML = '<div class="who"><span class="badge" style="--c:' + c + '">session</span><span class="etat" style="--e:' + e.css + '">' + e.t + '</span>' + rolesDe(x.cle).map(r => '<span class="role ' + r[1] + '">' + esc(r[0]) + '</span>').join('') + '</div>'
      + '<div><p class="kicker">Lead</p><h2>' + esc(x.nom) + '</h2></div>'
      + blocNom(x)
      + '<div><p class="kicker">Rôles</p><div class="ligne">' + on(o.roles.chefProjet === x.cle, 'Chef de projet global', 'chef') + on(o.roles.techLead === x.cle, 'Tech lead global', 'tl')
      + (p ? on(p.techLead === x.cle, 'Tech lead de ' + esc(p.nom), 'tlp') : '') + '</div></div>'
      + '<label class="ligne"><span class="kicker" style="margin:0;flex:0 0 auto">Projet</span><select data-act="projet">' + options(o.projets.map(q => [q.id, q.nom]), x.projet) + '</select></label>'
      + '<label class="ligne"><span class="kicker" style="margin:0;flex:0 0 auto">Bureau</span><select data-act="bureau">' + optBureaux(x.bureau) + '</select></label>'
      + '<div><p class="kicker">Travail du lead</p>' + mini(x.mesures) + '</div>'
      + (ag.length ? '<p class="orig">Son équipe : ' + ag.length + ' agent' + (ag.length > 1 ? 's' : '') + ', ' + nb(tot.editions) + ' éditions, ' + nb(tot.commits) + ' commits, ' + nb(tot.jetons) + ' jetons, ' + dollars(tot.cout) + '</p>' : '')
      + '<dl class="meta">' + (x.cwd ? '<dt>Dossier</dt><dd>' + esc(x.cwd.replace(/^(\/Users|\/home|C:\\Users)[\\/][^\\/]+/i, '~')) + '</dd>' : '') + '<dt>Dépôt</dt><dd>' + esc(x.depot) + '</dd>'
      + (st.branche ? '<dt>Branche</dt><dd>' + esc(st.branche) + '</dd>' : '') + (st.modele ? '<dt>Modèle</dt><dd>' + esc(st.modele) + '</dd>' : '') + '<dt>Activité</dt><dd>' + ago(x.derniereActivite) + '</dd></dl>'
      + (ag.length ? '<div><p class="kicker">Son équipe</p><ul class="alist">' + ag.map(a => '<li><button type="button" data-k="' + esc(a.cle) + '"><span class="dot" style="--e:' + ETATS[a.etat].css + '"></span>' + esc(a.nom) + '</button></li>').join('') + '</ul></div>' : '<p class="none">Aucun agent lancé.</p>');
  }
}
const fiche = $('fiche');
fiche.addEventListener('click', e => {
  const k = e.target.closest('[data-k]'); if (k) return choisir(k.dataset.k, false);
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'FORM') return;
  const x = A.get(sel) || S.get(sel), o = D.organisation; if (!x) return;
  if (b.dataset.act === 'nom-origine') envoyer({ op: 'renommer', cle: x.cle, nom: null });
  if (b.dataset.act === 'chef') envoyer({ op: 'role', role: 'chefProjet', cle: o.roles.chefProjet === x.cle ? null : x.cle });
  if (b.dataset.act === 'tl') envoyer({ op: 'role', role: 'techLead', cle: o.roles.techLead === x.cle ? null : x.cle });
  if (b.dataset.act === 'tlp') { const p = P.get(x.projet); envoyer({ op: 'projet.techLead', id: p.id, cle: p.techLead === x.cle ? null : x.cle }); }
});
fiche.addEventListener('submit', e => { e.preventDefault(); const x = A.get(sel) || S.get(sel); if (x && e.target.dataset.act === 'renommer') envoyer({ op: 'renommer', cle: x.cle, nom: e.target.nom.value.trim() || null }).then(() => e.target.nom.blur()); });
fiche.addEventListener('change', e => {
  const x = A.get(sel) || S.get(sel); if (!x) return;
  if (e.target.dataset.act === 'bureau') { deplacer(x.cle, e.target.value); e.target.blur(); }
  if (e.target.dataset.act === 'projet') { envoyer({ op: 'session.projet', cle: x.cle, projet: e.target.value }); e.target.blur(); }
});
function choisir(k, depuisPlan) {
  sel = k; store.set('bureau.sel', k);
  if (vue !== 'plan') montrer('plan');
  document.querySelectorAll('.pers.on').forEach(c => c.classList.remove('on'));
  document.querySelectorAll('.pers[data-k="' + CSS.escape(k) + '"]').forEach(c => c.classList.add('on'));
  $('fiche').innerHTML = ''; renderFiche();
  if (matchMedia('(max-width:980px)').matches && depuisPlan) $('fiche').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Rendement ----------
const COLS = [['cout', 'Coût est.', dollars], ['jetons', 'Jetons', nb], ['dureeMs', 'Durée', duree], ['actifMs', 'Actif', duree], ['outils', 'Outils', nb], ['tauxErreur', 'Erreurs', pct], ['editions', 'Éditions', nb], ['fichiers', 'Fichiers', nb], ['commits', 'Commits', nb]];
function tableLignes(lignes, cle) {
  const t = tri[cle], l = [...lignes].sort((a, b) => (t.c === 'nom' ? a.nom.localeCompare(b.nom) : (a[t.c] || 0) - (b[t.c] || 0)) * (t.asc ? 1 : -1)).slice(0, 200);
  const th = (c, txt) => '<th><button type="button" data-tri="' + cle + ':' + c + '"' + (t.c === c ? ' aria-sort="' + (t.asc ? 'ascending' : 'descending') + '"' : '') + '>' + txt + '</button></th>';
  return '<div class="tbl"><table><thead><tr>' + th('nom', cle === 'agents' ? 'Agent' : 'Session') + '<th>État</th><th>Projet</th>' + COLS.map(([c, txt]) => th(c, txt)).join('') + '</tr></thead><tbody>'
    + (l.length ? l.map(x => { const p = P.get(x.projet); return '<tr><td><button type="button" class="lien" data-k="' + esc(x.cle) + '">' + esc(x.nom) + '</button></td><td>' + ETATS[x.etat].t + '</td><td>' + (p ? '<span class="sw" style="--c:' + couleur(p.id) + '"></span>' + esc(p.nom) : '—') + '</td>'
      + COLS.map(([c, , f]) => '<td>' + (c === 'tauxErreur' && !x.outils ? '—' : f(x[c])) + '</td>').join('') + '</tr>'; }).join('') : '<tr><td colspan="12" class="none">Rien sur cette période.</td></tr>') + '</tbody></table></div>';
}
function tableGroupes(groupes, nommer) {
  const l = Object.entries(groupes).sort((a, b) => b[1].cout - a[1].cout);
  return '<div class="tbl"><table><thead><tr><th>Nom</th><th>Agents</th><th>Terminés</th><th>En cours</th><th>Durée moy.</th><th>Actif</th><th>Erreurs</th><th>Éditions</th><th>Commits</th><th>Jetons</th><th>Coût est.</th></tr></thead><tbody>'
    + (l.length ? l.map(([k, g]) => { const [n, c] = nommer(k); return '<tr><td><span class="sw" style="--c:' + c + '"></span>' + esc(n) + '</td><td>' + g.agents + (g.sessions ? ' + ' + g.sessions + ' lead' + (g.sessions > 1 ? 's' : '') : '') + '</td><td>' + g.termines + '</td><td>' + (g.enCours + g.enAttente)
      + '</td><td>' + duree(g.dureeMoyenneMs) + '</td><td>' + duree(g.actifMs) + '</td><td>' + (g.outils ? pct(g.tauxErreur) : '—') + '</td><td>' + nb(g.editions) + '</td><td>' + nb(g.commits) + '</td><td>' + nb(g.jetons) + '</td><td>' + dollars(g.cout) + '</td></tr>'; }).join('')
      : '<tr><td colspan="11" class="none">Rien sur cette période.</td></tr>') + '</tbody></table></div>';
}
function renderRendement() {
  const k = D.kpi, g = k.global, lib = { '1h': 'la dernière heure', '24h': 'les dernières 24 h', '7j': 'les 7 derniers jours' }[fen];
  const tile = (t, v, d) => '<div class="tile"><span class="k">' + t + '</span><span class="v">' + v + '</span>' + (d ? '<span class="d">' + d + '</span>' : '') + '</div>';
  $('v-rendement').innerHTML = '<div class="vue-grid"><div class="bloc"><div class="bloc-h"><h2>Rendement sur ' + lib + '</h2><p>Agents et leads actifs pendant la période ; leurs compteurs portent sur toute leur durée. Coût estimé au prix public des API.</p></div><div class="tiles">'
    + tile('Agents actifs', nb(g.agents), g.sessions + ' session' + (g.sessions > 1 ? 's' : '') + ' (leads)') + tile('Agents terminés', nb(g.termines), fr(g.terminesParHeure) + ' par heure')
    + tile('En cours', nb(g.enCours + g.enAttente), g.enAttente ? g.enAttente + ' en attente' : '') + tile('Durée moyenne', duree(g.dureeMoyenneMs), 'des agents terminés')
    + tile('Temps actif cumulé', duree(g.actifMs)) + tile('Erreurs d\'outils', g.outils ? pct(g.tauxErreur) : '—', nb(g.erreurs) + ' sur ' + nb(g.outils) + ' appels')
    + tile('Éditions', nb(g.editions), nb(g.fichiers) + ' fichiers') + tile('Commits', nb(g.commits)) + tile('Jetons', nb(g.jetons)) + tile('Coût estimé', dollars(g.cout), dollars(g.coutMoyen) + ' en moyenne') + '</div></div>'
    + '<div class="bloc"><h3>Par projet</h3>' + tableGroupes(k.projets, id => { const p = P.get(id); return [p ? p.nom : 'Sans projet', couleur(p && p.id)]; }) + '</div>'
    + '<div class="bloc"><h3>Par bureau</h3>' + tableGroupes(k.bureaux, id => { const b = B.get(id); return [b ? b.nom : id, couleur(id)]; }) + '</div>'
    + '<div class="bloc"><h3>Agents</h3>' + tableLignes(k.agents.map(l => ({ ...l, nom: nomDe(l.cle) })), 'agents') + '</div>'
    + '<div class="bloc"><h3>Sessions (travail des leads)</h3>' + tableLignes(k.sessions.map(l => ({ ...l, nom: nomDe(l.cle) })), 'sessions') + '</div></div>';
}
$('v-rendement').addEventListener('click', e => {
  const t = e.target.closest('[data-tri]'); if (t) { const [cle, c] = t.dataset.tri.split(':'); tri[cle] = { c, asc: tri[cle].c === c ? !tri[cle].asc : c === 'nom' }; renderRendement(); return; }
  const k = e.target.closest('[data-k]'); if (k) choisir(k.dataset.k, false);
});

// ---------- Poste ----------
const ST = { ok: 'normal', warn: 'vigilance', risk: 'risque', na: 'non disponible' };
function lvl(v, warn, risk, inv) { if (v == null) return 'na'; return inv ? (v < risk ? 'risk' : v < warn ? 'warn' : 'ok') : (v > risk ? 'risk' : v > warn ? 'warn' : 'ok'); }
function spark(arr, max) {
  arr = arr.filter(v => v != null); if (arr.length < 2) return '';
  if (arr.length > 120) { const s = arr.length / 120; arr = Array.from({ length: 120 }, (_, i) => arr[Math.floor(i * s)]); }
  const w = 160, h = 28, n = arr.length, pts = arr.map((v, i) => [i / (n - 1) * w, h - 2 - Math.min(1, v / max) * (h - 4)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z" fill="var(--st)" opacity=".12"/><path d="' + d + '" fill="none" stroke="var(--st)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>';
}
function renderPoste() {
  const d = D.poste, el = $('v-poste'); if (!d) { el.innerHTML = '<p class="none">Premier relevé en cours…</p>'; return; }
  // Swap total à 0 : aucun fichier de swap créé pour l'instant, donc 0 % utilisé (et non « indisponible »)
  const H = d.historique || [], ratio = d.load1 != null ? d.load1 / d.ncpu : null, swapPct = d.swapTotalGo == null ? null : d.swapTotalGo ? 100 * d.swapUtiliseGo / d.swapTotalGo : 0;
  const diskPct = d.disqueTotalGo ? 100 * d.disqueLibreGo / d.disqueTotalGo : null, nbB = d.builds.length, win = d.plateforme === 'win32';
  const K = [
    { k: 'Processeur', s: lvl(d.cpuPct, 75, 92), v: d.cpuPct == null ? 'mesure…' : fr(d.cpuPct, 0) + ' %', sub: d.ncpu + ' cœurs', pct: d.cpuPct, sp: spark(H.map(x => x.cpu), 100), dsc: 'Utilisation moyenne de tous les cœurs' },
    { k: 'Charge', s: lvl(ratio, 1, 2), v: ratio == null ? 'non disponible' : fr(ratio) + '×', sub: ratio == null ? '' : fr(d.load1) + ' / ' + d.ncpu, pct: ratio == null ? 0 : Math.min(100, ratio / 3 * 100), sp: ratio == null ? '' : spark(H.map(x => x.load != null ? x.load / d.ncpu : null), 3),
      dsc: ratio == null ? 'Windows ne fournit pas de charge moyenne' : 'Sur 5 min : ' + fr(d.load5) + ', sur 15 min : ' + fr(d.load15) },
    { k: win ? 'Fichier d\'échange' : 'Swap', s: lvl(swapPct, 50, 80), v: swapPct == null ? 'non disponible' : fr(swapPct, 0) + ' %', sub: swapPct == null ? '' : fr(d.swapUtiliseGo) + ' / ' + fr(d.swapTotalGo) + ' Go', pct: swapPct, sp: spark(H.map(x => x.swap), 100), dsc: 'Le disque sert de mémoire quand les ' + d.memGo + ' Go ne suffisent plus' },
    { k: 'Mémoire libre', s: lvl(d.memLibrePct, 30, 15, true), v: d.memLibrePct == null ? 'non disponible' : d.memLibrePct + ' %', sub: 'sur ' + d.memGo + ' Go', pct: d.memLibrePct, dsc: d.plateforme === 'darwin' ? 'Mesure de pression mémoire de macOS' : 'Mémoire disponible pour les programmes' },
    { k: 'Disque libre', s: lvl(diskPct, 20, 10, true), v: diskPct == null ? 'non disponible' : fr(diskPct, 0) + ' %', sub: diskPct == null ? '' : fr(d.disqueLibreGo, 0) + ' Go sur ' + d.disqueTotalGo, pct: diskPct == null ? 0 : 100 - diskPct, dsc: 'Sous 10 %, le système ralentit et le swap peut manquer de place' },
    { k: 'Builds en parallèle', s: win ? 'na' : lvl(nbB, 3, 5), v: win ? String(d.jvms) + ' JVM' : String(nbB), sub: win ? '' : d.jvms + ' JVM', pct: Math.min(100, nbB / 10 * 100), dsc: win ? 'Worktree des builds non lisible sous Windows' : nbB ? 'Worktrees : ' + d.builds.join(', ') : 'Aucun build de worktree en cours' },
    { k: 'Alimentation', s: d.batteriePct == null ? 'na' : (!d.secteur && d.batteriePct < 20) ? 'risk' : (!d.secteur && d.batteriePct < 40) ? 'warn' : 'ok', v: d.batteriePct == null ? 'secteur' : d.secteur ? 'secteur' : d.batteriePct + ' %',
      sub: d.batteriePct != null && d.secteur ? 'batterie ' + d.batteriePct + ' %' : d.batteriePct != null ? 'sur batterie' : '', pct: d.batteriePct || 0, dsc: d.batteriePct == null ? 'Pas de batterie détectée' : d.secteur ? 'Branché' : 'Débranché : les builds vident la batterie vite' },
    { k: 'Température', s: d.thermique == null ? 'na' : d.thermique === 'ok' ? 'ok' : 'risk', v: d.thermique == null ? 'non disponible' : d.temperatureC != null ? fr(d.temperatureC, 0) + ' °C' : d.thermique === 'ok' ? 'normale' : 'alerte', sub: '', pct: d.thermique === 'alerte' ? 100 : 0,
      dsc: d.thermique == null ? 'Aucun capteur lisible sur ce système' : d.thermique === 'ok' ? 'Pas de bridage du processeur' : 'Le système bride le processeur pour le refroidir' }];
  const ss = K.map(x => x.s), worst = ss.includes('risk') ? 'risk' : ss.includes('warn') ? 'warn' : 'ok', nR = ss.filter(s => s === 'risk').length, nW = ss.filter(s => s === 'warn').length;
  const why = []; if (swapPct > 80) why.push('le swap est presque plein'); if (ratio > 2) why.push('la charge est à ' + fr(ratio) + ' fois le nombre de cœurs'); if (d.cpuPct > 92) why.push('le processeur est saturé'); if (nbB > 5) why.push(nbB + ' builds tournent en même temps'); if (diskPct != null && diskPct < 10) why.push('le disque est presque plein'); if (d.thermique === 'alerte') why.push('le poste chauffe'); if (!d.secteur && d.batteriePct != null && d.batteriePct < 20) why.push('la batterie est presque vide');
  const todo = [];
  if (nbB > 3) todo.push('Limiter les vérifications à 2 ou 3 builds en même temps (' + nbB + ' en cours)');
  if (ratio > 2 && nbB <= 3) todo.push('Attendre la fin des builds en cours avant d\'en lancer d\'autres');
  if (swapPct > 80) todo.push('Redémarrer après les fusions' + (d.allumeJours ? ' (allumé depuis ' + d.allumeJours + ' jours)' : '') + ' : le swap ne se vide pas sans ça');
  const vm = (d.top || []).find(h => h.n === 'Machine virtuelle Docker'); if (vm && vm.cpu > 100) todo.push('Quitter Docker quand les conteneurs ne servent plus');
  if (diskPct != null && diskPct < 20) todo.push('Libérer de la place : worktrees fusionnés, caches des IDE');
  if (d.batteriePct != null && !d.secteur && d.batteriePct < 40) todo.push('Brancher le poste');
  if (!todo.length) todo.push('Rien à faire pour l\'instant');
  el.innerHTML = '<div class="vue-grid"><div class="bloc"><div class="bloc-h"><h2>Santé du poste</h2><p>' + esc(d.hote) + ' · ' + esc(d.systeme) + ' · relevé ' + ago(d.epoch * 1000) + '</p></div>'
    + '<div class="verdict st-' + worst + '"><b>' + (worst === 'risk' ? 'Utilisation à risque' : worst === 'warn' ? 'À surveiller' : 'Tout va bien') + '</b><span>'
    + (worst === 'risk' ? nR + ' indicateur' + (nR > 1 ? 's' : '') + ' au rouge : ' + why.join(', ') + '. Le poste peut figer et des tests échouer par délai dépassé.' : worst === 'warn' ? nW + ' indicateur' + (nW > 1 ? 's' : '') + ' à surveiller, rien de bloquant pour l\'instant.' : 'Processeur, mémoire et disque dans les seuils.') + '</span></div>'
    + '<div class="kpis">' + K.map(x => '<div class="kpi st-' + x.s + (x.s === 'na' ? ' na' : '') + '"><div class="k">' + x.k + '<span class="pill">' + ST[x.s] + '</span></div><div class="v">' + x.v + (x.sub ? ' <small>' + esc(x.sub) + '</small>' : '') + '</div>'
      + (x.sp || (x.s === 'na' ? '' : '<div class="bar"><i style="width:' + Math.round(Math.max(0, Math.min(100, x.pct || 0))) + '%"></i></div>')) + '<div class="d">' + esc(x.dsc) + '</div></div>').join('') + '</div></div>'
    + '<div class="cols"><div class="bloc"><h3>Ce qui consomme</h3><ul class="hogs">' + (d.top || []).map(h => '<li><span>' + esc(h.n) + '</span><em>' + h.cpu + ' % · ' + (h.mem >= 1024 ? fr(h.mem / 1024) + ' Go' : h.mem + ' Mo') + '</em>' + (h.count > 1 ? '<small>' + h.count + ' processus</small>' : '') + '</li>').join('') + '</ul></div>'
    + '<div class="bloc"><h3>Pour faire baisser le risque</h3><ol class="todo">' + todo.map(t => '<li>' + esc(t) + '</li>').join('') + '</ol></div></div>'
    + '<p class="seuils">Seuils : processeur 75 % / 92 % · charge 1× / 2× les cœurs · swap 50 % / 80 % · mémoire libre 30 % / 15 % · disque libre 20 % / 10 % · builds 3 / 5. Courbes sur les dernières 24 h.</p></div>';
}

// ---------- Organisation ----------
function optSessions(val) {
  const l = [...D.sessions].sort((a, b) => (a.etat === 'terminee') - (b.etat === 'terminee') || b.derniereActivite - a.derniereActivite).map(s => [s.cle, s.nom + ' · ' + s.depot + (s.etat === 'terminee' ? ' (fermée)' : '')]);
  if (val && !S.has(val)) l.unshift([val, 'session absente des 7 derniers jours']);
  return options(l, val, 'Personne');
}
function renderOrganisation() {
  const el = $('v-organisation'); if (occupe(el)) return;
  const o = D.organisation, occ = id => D.sessions.filter(s => s.bureau === id).length + D.agents.filter(a => a.bureau === id).length;
  const noms = Object.entries(o.noms);
  el.innerHTML = '<div class="vue-grid">'
    + '<div class="carte"><h2>Rôles globaux</h2><div class="rang" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))"><label>Chef de projet global<select data-op="role" data-role="chefProjet">' + optSessions(o.roles.chefProjet) + '</select></label>'
    + '<label>Tech lead global<select data-op="role" data-role="techLead">' + optSessions(o.roles.techLead) + '</select></label></div><p class="none">Un rôle est porté par une session Claude : c\'est elle qui pilote. Le badge s\'affiche sur le plan.</p></div>'
    + '<div class="carte"><h2>Projets</h2><p class="none">Un projet regroupe un ou plusieurs dépôts. Les nouveaux dépôts créent leur projet et leur bureau automatiquement.</p><div class="rangs">'
    + o.projets.map(p => '<div class="rang" data-p="' + esc(p.id) + '"><label>Nom<input type="text" maxlength="60" value="' + esc(p.nom) + '" data-op="projet.renommer"></label>'
      + '<label>Tech lead du projet<select data-op="projet.techLead">' + optSessions(p.techLead) + '</select></label>'
      + '<label>Bureau par défaut<select data-op="projet.bureau">' + options(o.bureaux.map(b => [b.id, b.nom]), p.bureau, 'Accueil') + '</select></label>'
      + '<label>Fusionner dans<select data-op="projet.fusionner">' + options(o.projets.filter(q => q.id !== p.id).map(q => [q.id, q.nom]), '', '…') + '</select></label>'
      + '<div class="depots">Dépôts : ' + (p.depots.length ? p.depots.map(esc).join(', ') : 'aucun (sessions rattachées à la main)') + '</div></div>').join('')
    + '</div><form class="form-l" data-op="projet.creer"><input type="text" name="nom" maxlength="60" placeholder="Nom du nouveau projet" required><button class="btn prim" type="submit">Créer le projet</button></form></div>'
    + '<div class="carte"><h2>Bureaux</h2><div class="rangs">' + o.bureaux.map(b => '<div class="rang" data-b="' + esc(b.id) + '" style="grid-template-columns:minmax(0,1fr) auto auto"><label>Nom<input type="text" maxlength="60" value="' + esc(b.nom) + '" data-op="bureau.renommer"></label><span class="none">' + occ(b.id) + ' pers.</span>'
      + (b.id === 'accueil' ? '<span></span>' : '<button type="button" class="btn dang petit" data-op="bureau.supprimer">Supprimer</button>') + '</div>').join('')
    + '</div><form class="form-l" data-op="bureau.creer"><input type="text" name="nom" maxlength="60" placeholder="Nom du nouveau bureau" required><button class="btn prim" type="submit">Créer le bureau</button></form></div>'
    + '<div class="carte"><h2>Noms donnés</h2>' + (noms.length ? '<div class="rangs">' + noms.map(([k, n]) => { const x = A.get(k) || S.get(k); return '<div class="rang" style="grid-template-columns:minmax(0,1fr) auto"><div><b>' + esc(n) + '</b><div class="orig">' + (x ? 'À l\'origine : ' + esc(x.nomOrigine) : 'agent absent des 7 derniers jours') + '</div></div><button type="button" class="btn petit" data-op="renommer" data-cle="' + esc(k) + '">Nom d\'origine</button></div>'; }).join('') + '</div>'
      : '<p class="none">Aucun nom donné. Renomme un agent ou une session depuis sa fiche.</p>') + '</div></div>';
}
const vOrg = $('v-organisation');
vOrg.addEventListener('change', e => {
  const t = e.target, op = t.dataset.op, p = t.closest('[data-p]'), b = t.closest('[data-b]'); if (!op) return;
  if (op === 'role') envoyer({ op, role: t.dataset.role, cle: t.value || null });
  else if (op === 'projet.renommer' && t.value.trim()) envoyer({ op, id: p.dataset.p, nom: t.value });
  else if (op === 'projet.techLead') envoyer({ op, id: p.dataset.p, cle: t.value || null });
  else if (op === 'projet.bureau') envoyer({ op, id: p.dataset.p, bureau: t.value || null });
  else if (op === 'projet.fusionner' && t.value) { const cible = P.get(t.value); if (confirm('Fusionner « ' + P.get(p.dataset.p).nom + ' » dans « ' + cible.nom + ' » ?')) envoyer({ op, source: p.dataset.p, cible: t.value }); else t.value = ''; }
  else if (op === 'bureau.renommer' && t.value.trim()) envoyer({ op, id: b.dataset.b, nom: t.value });
  t.blur();
});
vOrg.addEventListener('click', e => {
  const t = e.target.closest('button[data-op]'); if (!t) return;
  if (t.dataset.op === 'bureau.supprimer') { const b = B.get(t.closest('[data-b]').dataset.b); if (confirm('Supprimer le bureau « ' + b.nom + ' » ? Ses occupants retournent dans le bureau de leur projet.')) envoyer({ op: 'bureau.supprimer', id: b.id }); }
  if (t.dataset.op === 'renommer') envoyer({ op: 'renommer', cle: t.dataset.cle, nom: null });
});
vOrg.addEventListener('submit', e => { e.preventDefault(); const f = e.target, nom = f.nom.value.trim(); if (nom) envoyer({ op: f.dataset.op, nom }).then(() => { f.nom.value = ''; f.nom.blur(); }); });

// ---------- Rendu général ----------
function indexer() {
  S = new Map(D.sessions.map(s => [s.cle, s])); A = new Map(D.agents.map(a => [a.cle, a]));
  P = new Map(D.organisation.projets.map(p => [p.id, p])); B = new Map(D.organisation.bureaux.map(b => [b.id, b]));
}
function renderEntete() {
  const ouvertes = D.sessions.filter(s => s.etat !== 'terminee'), n = e => D.agents.filter(a => a.etat === e).length, g = D.kpi.global;
  $('counts').innerHTML = [[ouvertes.length, 'sessions ouvertes'], [D.sessions.filter(s => s.etat === 'active').length, 'au travail'], [n('en_cours'), 'agents en cours'], [n('en_attente'), 'en attente'], [g.termines, 'terminés sur la période'], [dollars(g.cout), 'estimés sur la période']]
    .map(([v, t]) => '<span><b>' + v + '</b>' + t + '</span>').join('');
  if (D.poste) $('hote').textContent = 'Agents de codage · ' + D.poste.hote + ' · ' + D.poste.systeme;
  const bd = $('bandeau'), i = D.indexation;
  bd.hidden = !(D.erreur || (i && i.faits < i.total));
  bd.textContent = D.erreur ? 'Dernière collecte en erreur : ' + D.erreur : i && i.faits < i.total ? 'Indexation des transcripts : ' + i.faits + ' sur ' + i.total + '…' : '';
  document.querySelectorAll('#fenetre button').forEach(b => b.setAttribute('aria-checked', b.dataset.f === fen));
}
function rendre() {
  if (!D) return;
  indexer(); if (sel && !A.has(sel) && !S.has(sel)) sel = null;
  if (!sel) { const s = D.sessions.find(s => s.etat === 'active') || D.sessions[0]; if (s) sel = s.cle; }
  renderEntete();
  if (vue === 'plan') { renderPlan(); renderFiche(); }
  if (vue === 'rendement') renderRendement();
  if (vue === 'poste') renderPoste();
  if (vue === 'organisation') renderOrganisation();
}
function montrer(v) {
  vue = v; store.set('bureau.vue', v);
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.v === v));
  document.querySelectorAll('.vue').forEach(s => { s.hidden = s.id !== 'v-' + v; });
  rendre();
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) montrer(b.dataset.v); });

// ---------- Réseau ----------
const qs = extra => { const p = new URLSearchParams({ fenetre: fen, ...extra }); if (TQ) p.set('t', TQ); return '?' + p; };
let chargement = null;
async function charger(maintenant) {
  const btn = $('actualiser'), msg = $('msg');
  if (maintenant) { btn.classList.add('spin'); btn.disabled = true; }
  try {
    const r = await fetch('/api/etat' + qs(maintenant ? { maintenant: '1' } : {}), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 401 ? 'jeton refusé' : 'HTTP ' + r.status);
    D = await r.json(); rendre(); msg.textContent = maintenant ? 'À jour' : '';
  } catch (e) { msg.textContent = 'Serveur injoignable (' + e.message + ') : nouvel essai dans 10 s'; }
  finally { btn.classList.remove('spin'); btn.disabled = false; }
}
async function envoyer(op) {
  try {
    const h = { 'Content-Type': 'application/json', 'X-Bureau-Csrf': D.csrf }; if (TQ) h['X-Bureau-Token'] = TQ;
    const r = await fetch('/api/organisation' + (TQ ? '?t=' + encodeURIComponent(TQ) : ''), { method: 'POST', headers: h, body: JSON.stringify(op) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('msg').textContent = 'Refusé : ' + (j.erreur || 'HTTP ' + r.status); return; }
    $('msg').textContent = 'Enregistré';
  } catch (e) { $('msg').textContent = 'Échec de l\'enregistrement (' + e.message + ')'; }
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  await charger(false);
}
$('actualiser').onclick = () => charger(true);
$('fenetre').addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (!b) return; fen = b.dataset.f; store.set('bureau.fen', fen); charger(false); });
$('fermees').onchange = e => { fermees = e.target.checked; store.set('bureau.fermees', fermees ? '1' : '0'); rendre(); };
$('cherche').addEventListener('input', e => { cherche = e.target.value.trim().toLowerCase(); if (vue === 'plan') renderPlan(); });
setInterval(() => { if (!document.hidden) charger(false); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) charger(false); });
montrer(vue); charger(false);
