// Bureau 3D des sessions Claude Code et de leurs agents, fiche de détail et annuaire ; rafraîchi toutes les 10 s
'use strict';
const ETATS = {
  en_cours: { t: 'en cours', css: 'var(--run)', hex: 0x1D9E75 }, en_attente: { t: 'en attente', css: 'var(--warn)', hex: 0xE3A944 },
  termine: { t: 'terminé', css: 'var(--done)', hex: 0x9A978D }, interrompu: { t: 'interrompu', css: 'var(--risk)', hex: 0xD85A5A },
  active: { t: 'active', css: 'var(--run)', hex: 0x1D9E75 }, inactive: { t: 'inactive', css: 'var(--warn)', hex: 0xE3A944 },
  terminee: { t: 'terminée', css: 'var(--done)', hex: 0x9A978D }
};
const PALETTE = [0x7F77DD, 0x1D9E75, 0xD85A30, 0x3B82C4, 0xC98A1E, 0xB45AA8, 0x5A9E3A, 0x2E9AA8];
const hex = c => '#' + c.toString(16).padStart(6, '0');
const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const colOf = s => s.etat === 'terminee' ? 0x9A978D : PALETTE[hash(s.projet) % PALETTE.length];
const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const QS = new URLSearchParams(location.search).get('t'), API = '/api/etat' + (QS ? '?t=' + encodeURIComponent(QS) : '');
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

let DATA = null, showDone = store.get('bureau.showDone') === '1', sel = null;
const $ = id => document.getElementById(id);
$('show-done').checked = showDone;
const visible = () => DATA ? DATA.sessions.filter(s => showDone || s.etat !== 'terminee') : [];
const findS = id => DATA && DATA.sessions.find(s => s.id === id);

// ---------- Scène ----------
const wrap = $('wrap'), tip = $('tip'), coarse = matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: !coarse, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2)); renderer.shadowMap.enabled = true; wrap.prepend(renderer.domElement);
const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
let fit = 1, camReady = false;
function resize() { const w = wrap.clientWidth, h = wrap.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); fit = Math.max(1, 1.6 / cam.aspect); if (camReady) placeCam(); }
new ResizeObserver(resize).observe(wrap); resize();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); scene.add(sun); scene.add(sun.target);
const M = (c, o = {}) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o));
const box = (w, h, d, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c)); m.castShadow = m.receiveShadow = true; return m; };
function label(text, color, scale = 1) {
  const c = document.createElement('canvas'), x = c.getContext('2d'), fs = 44, font = '500 ' + fs + 'px ui-sans-serif,system-ui,sans-serif';
  x.font = font; const w = Math.ceil(x.measureText(text).width) + 36; c.width = w; c.height = fs + 28;
  x.font = font; x.fillStyle = color; x.beginPath(); x.roundRect ? x.roundRect(0, 0, w, c.height, 14) : x.rect(0, 0, w, c.height); x.fill();
  x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(text, 18, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.scale.set(w / c.height * 0.42 * scale, 0.42 * scale, 1); s.renderOrder = 10; s.userData.base = s.scale.clone(); return s;
}
const skins = [0xe6b89c, 0xc68b6a, 0x8d5a3b, 0xf1cbb0, 0xa86f4c], hairs = [0x2c2c2a, 0x5a3a22, 0x1a1a1a, 0x8a6a3a];
function person(col, seated, seed) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.75, 12), M(col)); body.position.y = seated ? 0.95 : 1.0; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), M(skins[seed % 5])); head.position.y = seated ? 1.55 : 1.6; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(hairs[(seed >> 3) % 4])); hair.position.y = head.position.y + 0.02; g.add(hair);
  if (!seated) for (const s of [-0.12, 0.12]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.62, 8), M(0x3b3b44)); l.position.set(s, 0.31, 0); l.castShadow = true; g.add(l); }
  g.userData = { body, head }; return g;
}

let office = null, clickables = [], devs = [], screens = [], labels = {}, anchors = {}, leads = [], packets = [], bounds = { cx: 0, cz: 0, r: 20 };
function dispose(o) { o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); } }); }

function build(list) {
  if (office) { scene.remove(office); dispose(office); }
  packets.forEach(p => { scene.remove(p.m); p.m.material.dispose(); }); packets = [];
  office = new THREE.Group(); scene.add(office); clickables = []; devs = []; screens = []; labels = {}; anchors = {}; leads = [];
  const tag = (objs, k) => objs.forEach(o => { o.userData.k = k; clickables.push(o); });
  // Dimensions de chaque îlot : les agents en rangées, le lead devant
  const pods = list.map(s => { const n = s.agents.length, cols = n ? Math.min(6, Math.max(2, Math.ceil(Math.sqrt(n * 1.4)))) : 1, rows = Math.ceil(n / cols);
    return { s, n, cols, rows, w: Math.max(cols * 1.9, 3.6) + 1.2, d: rows * 1.9 + 3.6 }; });
  const area = pods.reduce((a, p) => a + p.w * p.d, 0), maxW = Math.max(16, Math.sqrt(area) * 1.5);
  let x = 0, z = 0, rowD = 0, W = 0;
  pods.forEach(p => { if (x > 0 && x + p.w > maxW) { z += rowD + 1.5; x = 0; rowD = 0; } p.x = x + p.w / 2; p.z = z; x += p.w + 1.5; rowD = Math.max(rowD, p.d); W = Math.max(W, x - 1.5); });
  const D = z + rowD, ox = -W / 2, oz = -D / 2;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 8, D + 8), M(0xd9d4c7)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; office.add(floor);
  const back = box(W + 8, 3.5, 0.3, 0xece8de); back.position.set(0, 1.75, -D / 2 - 4); office.add(back);
  for (let i = 0; i < Math.max(2, Math.round(W / 6)); i++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), M(0xbfd8ee, { emissive: 0x6a8fb0, emissiveIntensity: 0.35 })); w.position.set(-W / 2 + (i + 0.5) * (W / Math.max(2, Math.round(W / 6))), 2.1, -D / 2 - 3.84); office.add(w); }
  const half = Math.max(W, D) / 2 + 4; Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, far: 120 }); sun.shadow.camera.updateProjectionMatrix();
  sun.position.set(8, 30, 14); sun.target.position.set(0, 0, 0);
  pods.forEach(p => {
    const s = p.s, col = colOf(s), cx = ox + p.x, z0 = oz + p.z, sk = 's:' + s.id, fini = s.etat === 'terminee';
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), M(new THREE.Color(col).lerp(new THREE.Color(0xd9d4c7), fini ? 0.85 : 0.72)));
    rug.rotation.x = -Math.PI / 2; rug.position.set(cx, 0.01, z0 + p.d / 2); rug.receiveShadow = true; office.add(rug); tag([rug], sk);
    s.agents.forEach((a, i) => {
      const r = Math.floor(i / p.cols), c = i % p.cols, ax = cx + (c - (p.cols - 1) / 2) * 1.9, az = z0 + 1.2 + r * 1.9, k = 'a:' + s.id + ':' + a.id, e = ETATS[a.etat], g = new THREE.Group();
      g.position.set(ax, 0, az); office.add(g);
      const top = box(1.5, 0.08, 0.8, fini ? 0xa9a193 : 0xb98d5e); top.position.y = 0.78; g.add(top);
      for (const px of [-0.68, 0.68]) for (const q of [-0.33, 0.33]) { const l = box(0.06, 0.76, 0.06, 0x55524c); l.position.set(px, 0.38, q); g.add(l); }
      const mon = box(0.75, 0.48, 0.05, 0x222226); mon.position.set(0, 1.18, -0.22); g.add(mon);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.4), new THREE.MeshBasicMaterial({ color: e.hex })); scr.position.set(0, 1.18, -0.19); g.add(scr);
      screens.push({ m: scr.material, base: new THREE.Color(e.hex), ph: hash(a.id) % 60 / 10, mode: a.etat });
      const kb = box(0.5, 0.03, 0.16, 0x3a3a3e); kb.position.set(0, 0.84, 0.08); g.add(kb);
      const ch = box(0.55, 0.08, 0.55, 0x3b3b44); ch.position.set(0, 0.5, 0.75); g.add(ch); const bk = box(0.55, 0.6, 0.08, 0x3b3b44); bk.position.set(0, 0.85, 1.03); g.add(bk);
      const objs = [top, mon, scr, ch];
      if (a.etat === 'en_cours' || a.etat === 'en_attente') { const pp = person(col, true, hash(a.id)); pp.position.set(0, 0, 0.72); g.add(pp); devs.push({ p: pp, ph: hash(a.id) % 60 / 10, on: a.etat === 'en_cours' }); objs.push(pp.userData.body, pp.userData.head); }
      const lb = label(clip(a.description, 30), e.css.includes('run') ? '#13866A' : hex(e.hex), 0.8); lb.position.set(0, 2.15, 0.3); g.add(lb); labels[k] = { l: lb, always: a.etat === 'en_cours' };
      anchors[k] = new THREE.Vector3(ax, 1.3, az); tag(objs, k);
    });
    // Lead : debout devant son équipe, derrière un bureau
    const lz = z0 + p.d - 1.0, ld = box(2.2, 0.1, 0.9, fini ? 0x8f8676 : 0x8a5f3a); ld.position.set(cx, 0.8, lz - 0.5); office.add(ld);
    const lf = box(2.1, 0.75, 0.08, fini ? 0x7a7264 : 0x6e4a2c); lf.position.set(cx, 0.4, lz - 0.08); office.add(lf);
    const objs = [ld, lf];
    if (!fini) { const lp = person(col, false, hash(s.id)); lp.position.set(cx, 0, lz); lp.rotation.y = Math.PI; office.add(lp); leads.push({ p: lp, ph: hash(s.id) % 60 / 10, on: s.etat === 'active' }); objs.push(lp.userData.body, lp.userData.head); }
    tag(objs, sk); anchors[sk] = new THREE.Vector3(cx, 1.6, lz);
    const lb = label(clip(s.nom, 34), hex(col), 1.15); lb.position.set(cx, 2.7, lz); office.add(lb); labels[sk] = { l: lb, always: true };
    if (!p.n) { const nb = label('aucun agent', '#8a877d', 0.7); nb.position.set(cx, 1.2, z0 + 1.3); office.add(nb); }
  });
  bounds = { cx: 0, cz: 0, r: Math.max(12, Math.max(W, D) * 0.85 + 6) };
}

// Caméra orbitale
let th = 0, ph = 0.95, rad = 27, radTo = 27, drag = false, px = 0, py = 0, moved = 0, ptype = 'mouse';
const look = new THREE.Vector3(), lookTo = new THREE.Vector3();
function placeCam() { const R = rad * fit; cam.position.set(look.x + R * Math.sin(ph) * Math.sin(th), look.y + R * Math.cos(ph), look.z + R * Math.sin(ph) * Math.cos(th)); cam.lookAt(look); }
camReady = true; placeCam();
const maxRad = () => bounds.r * 2;
function viewAll() { lookTo.set(bounds.cx, 0.5, bounds.cz); radTo = bounds.r; }
function viewAt(k, r) { const a = anchors[k]; if (a) { lookTo.set(a.x, 0.8, a.z - (k.startsWith('s:') ? 2 : 0)); radTo = r; } }
$('zin').onclick = () => { radTo = Math.max(5, radTo * 0.8); };
$('zout').onclick = () => { radTo = Math.min(maxRad(), radTo * 1.25); };
$('zall').onclick = viewAll;
const el = renderer.domElement, ray = new THREE.Raycaster(), mv = new THREE.Vector2();
function hit(e) { const r = el.getBoundingClientRect(); mv.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(mv, cam); const h = ray.intersectObjects(clickables, false)[0]; return h && h.object.userData.k; }
el.addEventListener('pointerdown', e => { drag = true; moved = 0; px = e.clientX; py = e.clientY; ptype = e.pointerType; wrap.style.cursor = 'grabbing'; });
addEventListener('pointerup', e => { if (drag && moved < (ptype === 'mouse' ? 6 : 14)) { const k = hit(e); if (k) select(k, true); } drag = false; wrap.style.cursor = 'grab'; });
addEventListener('pointercancel', () => { drag = false; });
addEventListener('pointermove', e => {
  if (drag) { const dx = e.clientX - px, dy = e.clientY - py; moved += Math.abs(dx) + Math.abs(dy); px = e.clientX; py = e.clientY; th -= dx * 0.006; if (ptype === 'mouse') ph = Math.min(1.35, Math.max(0.3, ph - dy * 0.005)); placeCam(); tip.style.opacity = 0; return; }
  if (e.target !== el) { tip.style.opacity = 0; return; }
  const k = hit(e); el.style.cursor = k ? 'pointer' : ''; if (!k) { tip.style.opacity = 0; return; }
  const it = item(k); if (!it) return; const r = wrap.getBoundingClientRect();
  tip.innerHTML = it.a ? '<b>' + esc(it.a.description) + '</b>' + esc(ETATS[it.a.etat].t) + ' · ' + esc(it.s.nom) : '<b>' + esc(it.s.nom) + '</b>Session ' + esc(ETATS[it.s.etat].t) + ' · ' + it.s.agents.length + ' agent' + (it.s.agents.length > 1 ? 's' : '');
  tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 290) + 'px'; tip.style.top = Math.min(e.clientY - r.top + 14, r.height - 80) + 'px'; tip.style.opacity = 1;
});
el.addEventListener('wheel', e => { e.preventDefault(); radTo = rad = Math.min(maxRad(), Math.max(5, rad + e.deltaY * 0.03)); placeCam(); }, { passive: false });

const geo = new THREE.SphereGeometry(0.1, 10, 8);
function sendPacket(k) {
  const live = Object.keys(anchors).filter(x => x.startsWith('a:') && labels[x] && labels[x].always);
  k = k || live[Math.random() * live.length | 0]; if (!k) return;
  const sid = k.split(':')[1], from = anchors['s:' + sid]; if (!from) return;
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xE8B04B })); scene.add(m);
  packets.push({ m, from: from.clone().setY(1.9), to: anchors[k].clone(), t: 0, back: Math.random() < 0.35 });
}

// ---------- Fiche et annuaire ----------
function item(k) { const [t, sid, aid] = k.split(':'), s = findS(sid); if (!s) return null; return t === 'a' ? (s.agents.find(a => a.id === aid) ? { s, a: s.agents.find(a => a.id === aid) } : null) : { s }; }
const fiche = $('fiche');
function etatTag(e) { return '<span class="etat" style="--e:' + ETATS[e].css + '">' + ETATS[e].t + '</span>'; }
function renderFiche() {
  const it = sel && item(sel);
  if (!it) { fiche.innerHTML = '<p class="kicker">Fiche</p><p class="none">' + (DATA ? 'Clique sur une personne ou une carte pour voir ce qu\'elle fait.' : 'Chargement…') + '</p>'; return; }
  const s = it.s, c = hex(colOf(s));
  if (it.a) {
    const a = it.a, build = DATA.mac && a.worktree && DATA.mac.builds.includes(a.worktree);
    fiche.innerHTML = '<div class="who"><span class="badge" style="--c:' + c + '">' + esc(a.type) + '</span>' + etatTag(a.etat) + (a.arrierePlan ? '<span class="when">arrière-plan</span>' : '') + '</div>'
      + '<div><p class="kicker">' + (a.etat === 'en_cours' || a.etat === 'en_attente' ? 'Travaille sur' : 'A travaillé sur') + '</p><h2>' + esc(a.description) + '</h2></div>'
      + (a.consigne ? '<div><p class="kicker">Début de sa consigne</p><p class="consigne">' + esc(a.consigne) + '</p></div>' : '')
      + '<dl class="meta"><dt>Session</dt><dd>' + esc(s.nom) + '</dd><dt>Projet</dt><dd>' + esc(s.projet) + '</dd>' + (a.worktree ? '<dt>Worktree</dt><dd>' + esc(a.worktree) + '</dd>' : '')
      + (build ? '<dt>Mac</dt><dd style="color:var(--warn)">build en cours</dd>' : '') + '<dt>Activité</dt><dd>' + ago(a.derniereActivite) + '</dd></dl>'
      + '<button type="button" class="crd" style="--e:' + c + '" data-k="s:' + esc(s.id) + '"><span class="nm">← Session ' + esc(s.nom) + '</span></button>';
  } else {
    const n = k => s.agents.filter(a => a.etat === k).length;
    fiche.innerHTML = '<div class="who"><span class="badge" style="--c:' + c + '">session</span>' + etatTag(s.etat) + '</div>'
      + '<div><p class="kicker">Lead</p><h2>' + esc(s.nom) + '</h2></div>'
      + '<dl class="meta"><dt>Projet</dt><dd>' + esc(s.projet) + '</dd>' + (s.cwd ? '<dt>Dossier</dt><dd>' + esc(s.cwd.replace(/^\/Users\/[^/]+/, '~')) + '</dd>' : '')
      + '<dt>Agents</dt><dd>' + s.agents.length + (s.agents.length ? ' · ' + ['en_cours', 'en_attente', 'termine', 'interrompu'].filter(n).map(k => n(k) + ' ' + ETATS[k].t).join(' · ') : '') + '</dd>'
      + '<dt>Activité</dt><dd>' + ago(s.derniereActivite) + '</dd></dl>'
      + (s.agents.length ? '<div><p class="kicker">Son équipe</p><ul class="alist">' + s.agents.map(a => '<li><button type="button" data-k="a:' + esc(s.id) + ':' + esc(a.id) + '"><span class="dot" style="background:' + ETATS[a.etat].css + '"></span>' + esc(a.description) + '</button></li>').join('') + '</ul></div>' : '<p class="none">Aucun agent lancé dans les dernières 24 h.</p>');
  }
}
fiche.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) select(b.dataset.k, false); });

function renderDir(list) {
  $('dir').innerHTML = list.map(s => {
    const c = hex(colOf(s));
    return '<div class="team' + (s.etat === 'terminee' ? ' fini' : '') + '"><h3 tabindex="0" role="button" data-k="s:' + esc(s.id) + '"><span class="dot" style="background:' + c + '"></span>' + esc(s.nom) + '<small>' + esc(s.projet) + ' · ' + ETATS[s.etat].t + ' · ' + s.agents.length + ' agent' + (s.agents.length > 1 ? 's' : '') + '</small></h3>'
      + (s.agents.length ? '<div class="grid">' + s.agents.map(a => { const k = 'a:' + s.id + ':' + a.id;
        return '<button type="button" class="crd' + (sel === k ? ' on' : '') + '" style="--e:' + ETATS[a.etat].css + '" data-k="' + esc(k) + '"><span class="nm">' + esc(a.description) + '</span><span class="ms">' + ETATS[a.etat].t + ' · ' + ago(a.derniereActivite) + '</span></button>'; }).join('') + '</div>' : '<p class="none">Aucun agent lancé.</p>') + '</div>';
  }).join('') || '<p class="none">Aucune session à afficher.</p>';
}
$('dir').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) select(b.dataset.k, false); });
$('dir').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('h3[data-k]')) { e.preventDefault(); select(e.target.dataset.k, false); } });

function select(k, fromScene) {
  sel = k; renderFiche();
  document.querySelectorAll('.crd.on').forEach(c => c.classList.remove('on'));
  document.querySelectorAll('#dir [data-k="' + CSS.escape(k) + '"]').forEach(c => c.classList.add('on'));
  if (fromScene) { if (matchMedia('(max-width:860px)').matches) fiche.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  else { wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); viewAt(k, k.startsWith('s:') ? 13 : 8); }
  if (k.startsWith('a:')) for (let i = 0; i < 3; i++) setTimeout(() => sendPacket(k), i * 180);
}

function renderCounts() {
  const S = DATA.sessions, live = S.filter(s => s.etat !== 'terminee'), A = S.flatMap(s => s.agents), n = e => A.filter(a => a.etat === e).length;
  $('counts').innerHTML = [[live.length, 'sessions ouvertes'], [S.filter(s => s.etat === 'active').length, 'au travail'], [n('en_cours'), 'agents en cours'], [n('en_attente'), 'en attente'], [n('termine'), 'agents terminés (24 h)']]
    .map(([v, t]) => '<span><b>' + v + '</b>' + t + '</span>').join('');
}

// ---------- Données ----------
let sig = '', first = true;
function apply() {
  const list = visible();
  const nsig = JSON.stringify(list.map(s => [s.id, s.etat, s.agents.map(a => [a.id, a.etat])]));
  if (nsig !== sig) { sig = nsig; build(list); if (first) { viewAll(); look.copy(lookTo); rad = radTo; placeCam(); first = false; } }
  $('empty').hidden = list.length > 0;
  if (sel && !item(sel)) sel = null;
  if (!sel) { const s = list.find(s => s.etat === 'active') || list[0]; if (s) sel = 's:' + s.id; }
  renderCounts(); renderDir(list); renderFiche(); renderMac(DATA.mac);
  $('when').textContent = 'Mis à jour ' + new Date(DATA.genere).toLocaleTimeString('fr-FR');
}
async function load(now) {
  const btn = $('refresh'), msg = $('refresh-msg');
  if (now) { btn.classList.add('spin'); btn.disabled = true; msg.textContent = ''; }
  try {
    const r = await fetch(API + (now ? (API.includes('?') ? '&' : '?') + 'maintenant=1' : ''), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 401 ? 'jeton refusé' : 'HTTP ' + r.status);
    DATA = await r.json(); apply(); msg.textContent = now ? 'À jour' : '';
  } catch (e) { msg.textContent = 'Serveur injoignable (' + e.message + '), nouvel essai dans 10 s'; }
  finally { btn.classList.remove('spin'); btn.disabled = false; }
}
$('refresh').onclick = () => load(true);
$('show-done').onchange = e => { showDone = e.target.checked; store.set('bureau.showDone', showDone ? '1' : '0'); first = true; if (DATA) apply(); };
setInterval(() => { if (!document.hidden) load(false); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });
setInterval(() => { if (DATA) { renderMac(DATA.mac); $('when').textContent = 'Mis à jour ' + ago(DATA.genere); } }, 30000);
renderFiche(); renderMac(null); load(false);

// ---------- Animation ----------
const still = matchMedia('(prefers-reduced-motion: reduce)').matches, clock = new THREE.Clock(); let acc = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime; acc += dt;
  if (acc > 0.8 && !still) { acc = 0; sendPacket(); }
  const ease = still ? 1 : Math.min(1, dt * 4);
  if (look.distanceTo(lookTo) > 0.01 || Math.abs(rad - radTo) > 0.01) { look.lerp(lookTo, ease); rad += (radTo - rad) * ease; placeCam(); }
  if (!still) {
    devs.forEach(d => { d.p.userData.body.position.y = 0.95 + (d.on ? Math.sin(t * 9 + d.ph) * 0.015 : 0); d.p.userData.head.rotation.y = Math.sin(t * (d.on ? 0.6 : 0.2) + d.ph) * 0.35; });
    screens.forEach(s => s.m.color.copy(s.base).multiplyScalar(s.mode === 'en_cours' ? 0.82 + 0.18 * Math.sin(t * 3 + s.ph) : s.mode === 'en_attente' ? 0.75 + 0.25 * Math.sin(t * 1.2 + s.ph) : 0.7));
    leads.forEach(l => { l.p.rotation.y = Math.PI + (l.on ? Math.sin(t * 0.5 + l.ph) * 0.9 : 0); });
  }
  for (const k in labels) { const { l, always } = labels[k], b = l.userData.base, on = k === sel, f = on ? 1.25 + 0.08 * Math.sin(t * 6) : 1; l.scale.set(b.x * f, b.y * f, 1); l.visible = always || on; }
  for (let i = packets.length - 1; i >= 0; i--) {
    const p = packets[i]; p.t += dt * 0.9; const u = Math.min(1, p.t), a = p.back ? p.to : p.from, b = p.back ? p.from : p.to;
    p.m.position.lerpVectors(a, b, u); p.m.position.y += Math.sin(u * Math.PI) * 1.2;
    if (u >= 1) { scene.remove(p.m); p.m.material.dispose(); packets.splice(i, 1); }
  }
  renderer.render(scene, cam); requestAnimationFrame(loop);
}
loop();
