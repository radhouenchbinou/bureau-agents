// Scène 2.5D du bureau, dessinée en Canvas 2D (vue isométrique, aucune image externe).
// Unités du monde : a et b en cases au sol, z en pixels. La scène reçoit l'état via Bureau.maj et remonte clics et dépôts.
'use strict';
const Bureau = (() => {
  const T = 17, H = 8.5, CELL_L = 3.4, CELL_P = 3, COULOIR = 2.4, ALLEE = 2.5, VITESSE = 3.2, MUR = 44;
  const PAUSE = 'salle-pause', MODELES = 'salle-modeles';
  const cv = document.getElementById('scene-canvas'), wrap = document.getElementById('scene'), tip = document.getElementById('scene-tip');
  const c = cv.getContext('2d'), immobile = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dpr = 1, W = 1, HT = 1, cam = { s: 1, x: 0, y: 0 }, cible = null, ajustee = false;
  let plan = null, gens = new Map(), racks = [], selection = null, survol = null, t = 0, actif = true, signature = '', recherche = '';
  let rappels = { choisir() {}, deposer() {} };

  const iso = (a, b, z = 0) => [(a - b) * T, (a + b) * H - z];
  const sol = (ix, iy) => { const u = ix / T, v = iy / H; return [(u + v) / 2, (v - u) / 2]; };
  function teinte(hex, f) { const n = parseInt(hex.slice(1), 16); return 'rgb(' + (((n >> 16) * f) | 0) + ',' + ((((n >> 8) & 255) * f) | 0) + ',' + (((n & 255) * f) | 0) + ')'; }
  function mele(hex, vers, k) { const a = parseInt(hex.slice(1), 16), b = parseInt(vers.slice(1), 16), m = s => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k); return '#' + [16, 8, 0].map(s => m(s).toString(16).padStart(2, '0')).join(''); }
  function poly(pts, fond, trait) { c.beginPath(); pts.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); c.closePath(); c.fillStyle = fond; c.fill(); if (trait) { c.strokeStyle = trait; c.lineWidth = .5; c.stroke(); } }
  function boite(a, b, l, p, h, coul, z = 0) {
    const s = z + h;
    poly([iso(a, b + p, z), iso(a + l, b + p, z), iso(a + l, b + p, s), iso(a, b + p, s)], teinte(coul, .82));
    poly([iso(a + l, b, z), iso(a + l, b + p, z), iso(a + l, b + p, s), iso(a + l, b, s)], teinte(coul, .66));
    poly([iso(a, b, s), iso(a + l, b, s), iso(a + l, b + p, s), iso(a, b + p, s)], coul);
  }
  function dallage(a, b, l, p, c1, c2) { for (let i = 0; i < Math.ceil(l); i++) for (let j = 0; j < Math.ceil(p); j++) { const x2 = Math.min(a + i + 1, a + l), y2 = Math.min(b + j + 1, b + p); poly([iso(a + i, b + j), iso(x2, b + j), iso(x2, y2), iso(a + i, y2)], (i + j) % 2 ? c1 : c2); } }
  function etiquette(txt, x, y, fond, encre, taille = 11) {
    c.font = '500 ' + taille + 'px ui-sans-serif,system-ui,sans-serif'; const w = c.measureText(txt).width + 12;
    c.fillStyle = fond; c.beginPath(); c.roundRect ? c.roundRect(x - w / 2, y - 9, w, 17, 4) : c.rect(x - w / 2, y - 9, w, 17); c.fill();
    c.fillStyle = encre; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, x, y);
  }
  const coupe = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const hash = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };

  // ---------- Plan : pièces par rangées, couloirs, allée à l'ouest, salle de pause et salle des modèles en bas ----------
  function construire(salles, personnes, modeles) {
    const pieces = salles.map(s => {
      const n = s.occupants.length, cols = n ? Math.min(6, Math.max(2, Math.ceil(Math.sqrt(n * 1.3)))) : 2, rows = Math.max(1, Math.ceil(n / cols));
      return { ...s, cols, rows, l: Math.max(9, cols * CELL_L + 1.2), p: Math.max(6, rows * CELL_P + 1.4) };
    });
    const aire = pieces.reduce((x, p) => x + p.l * p.p, 0), maxL = Math.max(26, Math.sqrt(aire) * 1.5);
    const rangs = []; let r = null;
    for (const p of pieces) { if (!r || (r.l > 0 && r.l + p.l > maxL)) { r = { pieces: [], l: 0, p: 0 }; rangs.push(r); } p.a = r.l; r.pieces.push(p); r.l += p.l; r.p = Math.max(r.p, p.p); }
    let b = 0; const L0 = Math.max(26, ...rangs.map(x => x.l));
    for (const x of rangs) { x.b = b; x.pieces.forEach(p => { p.b = b; }); x.couloir = b + x.p + COULOIR / 2; b += x.p + COULOIR; }
    if (!rangs.length) { rangs.push({ pieces: [], l: 0, p: 0, b: 0, couloir: COULOIR / 2 }); b = COULOIR; }
    const nPause = personnes.length, mL = Math.max(11, Math.min(modeles.length, 6) * 2.7 + 2), mP = modeles.length > 6 ? 11 : 7;
    const pL = Math.max(12, L0 - mL), pP = Math.max(mP, 7 + Math.ceil(Math.max(0, nPause - 8) / 6) * 1.7);
    const pause = { id: PAUSE, nom: 'Salle de pause', a: 0, b, l: pL, p: pP, c1: '#F8E9CF', c2: '#F3DFBC', encre: '#854F0B', porte: Math.min(pL - 3, 7) };
    const salleM = { id: MODELES, nom: 'Salle des modèles', a: pL, b, l: Math.max(mL, L0 - pL), p: pP, c1: '#D5D4CE', c2: '#CAC8C1', encre: '#444441' };
    const fin = rangs[rangs.length - 1].couloir, L = pL + salleM.l, objets = [];
    const ajout = (prof, dessin) => objets.push({ prof, dessin });
    const murB = (a, bb, fen) => ajout(a + .5 + bb + .1, () => { boite(a, bb, 1, .2, MUR, '#F1EFE8'); if (fen) poly([iso(a + .1, bb + .2, 15), iso(a + .9, bb + .2, 15), iso(a + .9, bb + .2, 37), iso(a + .1, bb + .2, 37)], '#BBD8EE', '#85B7EB'); });
    const murA = (a, bb) => ajout(a + .1 + bb + .5, () => boite(a, bb, .2, 1, MUR, '#F1EFE8'));
    pieces.forEach((p, ip) => {
      const prem = p.b === 0;
      for (let i = 0; i < Math.ceil(p.l); i++) { const a = p.a + Math.min(i, p.l - 1); murB(a, p.b, prem && i % 4 === 1); }
      for (let j = 0; j < Math.ceil(p.p); j++) murA(p.a, p.b + Math.min(j, p.p - 1));
      p.places = {};
      p.occupants.forEach((cle, i) => {
        const col = i % p.cols, rg = Math.floor(i / p.cols), cx = p.a + .6 + (col + .5) * (p.l - 1.2) / p.cols, by = p.b + 1.2 + rg * CELL_P;
        const per = personnes.find(x => x.cle === cle), lead = per && per.lead;
        const place = p.places[cle] = { a: cx, b: by + 1.5, allee: cx + (p.l - 1.2) / p.cols / 2, couloir: rangs.find(x => x.pieces.includes(p)).couloir, cle };
        ajout(cx + by + .45, () => {
          const allume = gens.get(cle), on = allume && allume.presence === 'poste' && !allume.chemin.length;
          boite(cx - 1, by, 2, .9, 13, lead ? '#8A5F3A' : '#B98D5E');
          boite(cx - .3, by + .1, .6, .1, 11, '#2C2C2A', 13);
          const coulE = on ? (Math.sin(t * 5 + i) > -.7 ? p.couleur : teinte(p.couleur, .8)) : '#5F5E5A';
          poly([iso(cx - .26, by + .21, 14), iso(cx + .26, by + .21, 14), iso(cx + .26, by + .21, 23), iso(cx - .26, by + .21, 23)], coulE);
        });
        ajout(cx + by + 1.62, () => boite(cx - .28, by + 1.25, .56, .56, 6, '#444441'));
      });
      if (p.l > 10) ajout(p.a + p.l - .7 + p.b + .9, () => plante(p.a + p.l - .9, p.b + .7));
    });
    // Salle de pause
    for (let i = 0; i < Math.ceil(pause.l); i++) { const a = i; if (a < pause.porte || a >= pause.porte + 3) murB(a, pause.b); }
    for (let j = 0; j < Math.ceil(pause.p); j++) murA(0, pause.b + j);
    const bb = pause.b;
    ajout(1 + bb + 2.5, () => { boite(1, bb + 1.9, 4.4, 1, 8, '#BA7517'); boite(1, bb + 1.6, 4.4, .35, 17, '#854F0B'); });
    ajout(pause.l - 2 + bb + 1.2, () => { boite(pause.l - 2.6, bb + .8, 1, .8, 24, '#444441'); poly([iso(pause.l - 2.4, bb + 1.61, 10), iso(pause.l - 1.8, bb + 1.61, 10), iso(pause.l - 1.8, bb + 1.61, 20), iso(pause.l - 2.4, bb + 1.61, 20)], '#E24B4A'); });
    ajout(5.7 + bb + 4.9, () => boite(5, bb + 4.4, 1.4, 1, 8, '#B98D5E'));
    ajout(.9 + bb + pause.p - .9, () => plante(.8, bb + pause.p - 1));
    const spots = [[1.8, bb + 3.1], [3.2, bb + 3.1], [4.6, bb + 3.1], [pause.l - 2.1, bb + 2.3]];
    for (let j = 0; spots.length < nPause + 4 && j < 20; j++) for (let i = 0; i < 6; i++) { const a = 1.6 + i * Math.max(1.6, (pause.l - 3) / 6), y = bb + 5 + j * 1.7; if (y < bb + pause.p - .4 && a < pause.l - 1) spots.push([a, y]); }
    // Salle des modèles
    for (let i = 0; i < Math.ceil(salleM.l); i++) { const a = salleM.a + Math.min(i, salleM.l - 1); if (i < 3 || i >= 6) murB(a, salleM.b); }
    for (let j = 0; j < Math.ceil(salleM.p); j++) murA(salleM.a, salleM.b + j);
    racks = modeles.slice(0, 12).map((m, i) => {
      const col = i % 6, rg = Math.floor(i / 6), a = salleM.a + 1 + col * 2.7, rb = salleM.b + 1.6 + rg * 4.6, cle = 'm:' + m.moteur + ':' + m.nom, ra = { m, a, b: rb, cle };
      ajout(a + .75 + rb + .5, () => {
        boite(a, rb, 1.5, 1, 62, '#2C2C2A');
        for (let n = 0; n < 5; n++) { const z = 10 + n * 10, lit = m.charge && (!m.calcule || Math.sin(t * 9 + n * 1.7 + i) > -.2); poly([iso(a + .2, rb + 1.01, z), iso(a + 1.3, rb + 1.01, z), iso(a + 1.3, rb + 1.01, z + 4), iso(a + .2, rb + 1.01, z + 4)], lit ? (m.calcule ? '#5DCAA5' : '#EF9F27') : '#5F5E5A'); }
      });
      return ra;
    });
    const couloirs = rangs.map(x => x.couloir);
    plan = { pieces, pause, salleM, rangs, objets, spots, L, Hb: bb + pP, fin, porteX: pause.porte + 1.5, porteB: bb, couloirs };
  }
  function plante(a, b) { boite(a - .25, b - .25, .5, .5, 8, '#993C1D'); const q = iso(a, b, 19); c.fillStyle = '#3B6D11'; c.beginPath(); c.arc(q[0], q[1], 8, 0, 7); c.fill(); }
  const salleDe = cle => plan && plan.pieces.find(p => p.places[cle]);

  // Chemin entre le poste et un point de la salle de pause : allée du bureau, couloir, allée ouest si besoin, porte
  function trajet(pl, spot, retour) {
    const allerY = plan.fin, porte = [[plan.porteX, allerY], [plan.porteX, plan.porteB + 1]];
    const milieu = pl.couloir === allerY ? [] : [[-1.2, pl.couloir], [-1.2, allerY]];
    const aller = [[pl.allee, pl.b], [pl.allee, pl.couloir], ...milieu, ...porte, spot];
    return retour ? [...aller.slice(0, -1).reverse(), [pl.a, pl.b]] : aller;
  }
  function assigner(q) { if (q.spot != null) return; const pris = new Set([...gens.values()].map(g => g.spot)); for (let i = 0; i < plan.spots.length; i++) if (!pris.has(i)) { q.spot = i; return; } q.spot = 0; }

  function maj({ salles, personnes, modeles, sel, filtre }) {
    selection = sel; recherche = filtre || '';
    const sig = JSON.stringify([salles.map(s => [s.id, s.nom, s.occupants]), modeles.map(m => [m.nom, m.charge, m.calcule])]);
    if (sig !== signature) { signature = sig; construire(salles, personnes, modeles); if (!ajustee) { ajuster(true); ajustee = true; } }
    const vus = new Set();
    for (const per of personnes) {
      vus.add(per.cle); const pl = salleDe(per.cle) && salleDe(per.cle).places[per.cle]; if (!pl) continue;
      let q = gens.get(per.cle);
      if (!q) {
        q = { ...per, chemin: [], ph: hash(per.cle) % 60 / 9, op: 1 }; gens.set(per.cle, q);
        if (per.presence === 'pause') { assigner(q); [q.a, q.b] = plan.spots[q.spot]; } else { q.a = pl.a; q.b = pl.b; }
      } else {
        const avant = q.presence; Object.assign(q, per); q.part = false; q.op = 1;
        if (avant !== per.presence) {
          // Changement d'avis en chemin : il rebrousse chemin au lieu de finir le trajet
          const enRoute = q.chemin.length > 0 && q.fait && q.fait.length;
          if (per.presence === 'pause') { assigner(q); q.chemin = enRoute ? [...q.fait.slice().reverse(), plan.spots[q.spot]] : trajet(pl, plan.spots[q.spot], false); }
          else { q.chemin = enRoute ? [...q.fait.slice().reverse(), [pl.a, pl.b]] : trajet(pl, plan.spots[q.spot ?? 0], true); q.spot = null; }
          q.fait = [];
          if (immobile) { const f = q.chemin[q.chemin.length - 1]; q.a = f[0]; q.b = f[1]; q.chemin = []; }
        } else if (!q.chemin.length) {
          // Plan recalculé : chacun reprend sa place sans traverser les murs
          if (per.presence === 'pause') { if (q.spot == null) assigner(q); [q.a, q.b] = plan.spots[q.spot]; } else { q.a = pl.a; q.b = pl.b; }
        }
      }
      q.place = pl;
    }
    for (const [k, q] of gens) if (!vus.has(k)) { q.part = true; }
    dessiner();   // une image tout de suite, même si l'onglet n'anime pas encore
  }

  // ---------- Dessin ----------
  function dessinerPersonne(q) {
    const [sx, sy] = iso(q.a, q.b), marche = q.chemin.length > 0, assis = q.presence === 'poste' && !marche || (q.presence === 'pause' && !marche && q.spot != null && q.spot < 3);
    const estLead = q.lead, tr = recherche && !q.nom.toLowerCase().includes(recherche) ? .3 : (q.op ?? 1);
    c.globalAlpha = tr;
    c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(sx, sy, 7, 3.5, 0, 0, 7); c.fill();
    const sw = marche ? Math.sin(t * 11 + q.ph) * 3 : 0, base = assis ? 6 : 0, ech = estLead ? 1.12 : 1;
    if (!assis) { c.strokeStyle = '#2C2C2A'; c.lineWidth = 2.4; c.lineCap = 'round'; c.beginPath(); c.moveTo(sx - 2, sy - 9); c.lineTo(sx - 2 + sw, sy - 1); c.moveTo(sx + 2, sy - 9); c.lineTo(sx + 2 - sw, sy - 1); c.stroke(); }
    const bob = marche ? Math.abs(Math.sin(t * 11 + q.ph)) * 1.2 : (q.presence === 'poste' ? Math.sin(t * 8 + q.ph) * .5 : Math.sin(t * 1.2 + q.ph) * .3), by = sy - 8 - base - bob;
    c.fillStyle = q.couleur; c.beginPath(); c.roundRect ? c.roundRect(sx - 5 * ech, by - 10 * ech, 10 * ech, 12 * ech, 3) : c.rect(sx - 5 * ech, by - 10 * ech, 10 * ech, 12 * ech); c.fill();
    const h = hash(q.cle), peaux = ['#E6B89C', '#C68B6A', '#8D5A3B', '#F1CBB0', '#A86F4C'], cheveux = ['#2C2C2A', '#5A3A22', '#1A1A1A', '#8A6A3A'];
    c.fillStyle = peaux[h % 5]; c.beginPath(); c.arc(sx, by - 14 * ech, 5 * ech, 0, 7); c.fill();
    c.fillStyle = cheveux[(h >> 3) % 4]; c.beginPath(); c.arc(sx, by - 15 * ech, 5 * ech, Math.PI, 0); c.fill();
    if (q.outilCoul) { c.fillStyle = q.outilCoul; c.beginPath(); c.arc(sx + 5, by - 4, 2.6, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke(); }
    if (selection === q.cle) { c.strokeStyle = '#3B6FD6'; c.lineWidth = 2; c.beginPath(); c.ellipse(sx, sy, 10, 5, 0, 0, 7); c.stroke(); }
    c.globalAlpha = 1; q.hx = sx; q.hy = by - 6; q.ty = by - 28 * ech;
  }
  function dessiner() {
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, HT);
    if (!plan) return;
    c.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.x, dpr * cam.y);
    // Sols : allée ouest et couloirs, puis les pièces
    dallage(-ALLEE, 0, ALLEE, plan.Hb, '#EDEBE4', '#E5E2DA');
    for (const r of plan.rangs) dallage(0, r.b, plan.L, r.p + COULOIR, '#EDEBE4', '#E5E2DA');
    for (const p of plan.pieces) { const fond = mele(p.couleur, '#FFFFFF', .84), f2 = mele(p.couleur, '#FFFFFF', .76); dallage(p.a, p.b, p.l, p.p, fond, f2); }
    dallage(plan.pause.a, plan.pause.b, plan.pause.l, plan.pause.p, plan.pause.c1, plan.pause.c2);
    dallage(plan.salleM.a, plan.salleM.b, plan.salleM.l, plan.salleM.p, plan.salleM.c1, plan.salleM.c2);
    if (glisse && glisse.salle) { const p = plan.pieces.find(x => x.id === glisse.salle); if (p) poly([iso(p.a, p.b), iso(p.a + p.l, p.b), iso(p.a + p.l, p.b + p.p), iso(p.a, p.b + p.p)], 'rgba(59,111,214,.18)', '#3B6FD6'); }
    const liste = plan.objets.slice();
    for (const q of gens.values()) if (!(glisse && glisse.q === q)) liste.push({ prof: q.a + q.b + .1, dessin: () => dessinerPersonne(q) });
    liste.sort((u, v) => u.prof - v.prof).forEach(o => o.dessin());
    if (glisse) { const [ix, iy] = [(glisse.x - cam.x) / cam.s, (glisse.y - cam.y) / cam.s], [a, b] = sol(ix, iy), q = glisse.q, sa = q.a, sb = q.b; q.a = a; q.b = b; dessinerPersonne(q); q.a = sa; q.b = sb; }
    for (const p of [...plan.pieces, plan.pause, plan.salleM]) { const q = iso(p.a + p.l / 2, p.b + .2, MUR + 12); etiquette(coupe(p.nom, 28), q[0], q[1], p.encre || teinte(p.couleur, .72), '#fff', 12); }
    for (const r of racks) { const q = iso(r.a + .75, r.b + 1.5); etiquette(coupe(r.m.nom, 16), q[0], q[1] + 12, r.cle === selection ? '#3B6FD6' : '#2C2C2A', '#fff'); }
    const montre = cam.s >= .62;
    for (const q of gens.values()) {
      if (q.hx == null) continue;
      const sel = q.cle === selection, sur = survol === q.cle;
      if (!montre && !sel && !sur && q.presence !== 'poste') continue;
      const pt = q.chemin.length ? '#378ADD' : q.presence === 'poste' ? '#1D9E75' : '#EF9F27';
      etiquette(coupe(q.nom, sel || sur ? 34 : 16), q.hx, q.ty, sel ? '#3B6FD6' : 'rgba(255,255,255,.94)', sel ? '#fff' : '#2C2C2A');
      c.fillStyle = pt; c.beginPath(); c.arc(q.hx, q.ty + 12, 3, 0, 7); c.fill();
      if (q.bulle && !q.chemin.length) etiquette(q.bulle, q.hx, q.ty - 18, q.raison === 'attend' ? '#854F0B' : '#0F6E56', '#fff');
    }
  }
  let dernier = performance.now();
  function boucle(n) {
    const dt = Math.min((n - dernier) / 1000, .25); dernier = n; t += dt;
    for (const [k, q] of gens) {
      if (q.part) { q.op = (q.op ?? 1) - dt * 1.5; if (q.op <= 0) gens.delete(k); continue; }
      if (!q.chemin.length) continue;
      const g = q.chemin[0], da = g[0] - q.a, db = g[1] - q.b, l = Math.hypot(da, db), pas = dt * VITESSE;
      if (l <= pas) { q.a = g[0]; q.b = g[1]; (q.fait = q.fait || []).push(q.chemin.shift()); } else { q.a += da / l * pas; q.b += db / l * pas; }
    }
    if (cible) { const k = Math.min(1, dt * 5); cam.s += (cible.s - cam.s) * k; cam.x += (cible.x - cam.x) * k; cam.y += (cible.y - cam.y) * k; if (Math.abs(cible.s - cam.s) < .002) cible = null; }
    if (actif && !document.hidden) { dessiner(); }
    if (!immobile) requestAnimationFrame(boucle);
  }

  // ---------- Caméra et interactions ----------
  function bornes() { const pts = [iso(-ALLEE, 0), iso(plan.L, 0), iso(-ALLEE, plan.Hb), iso(plan.L, plan.Hb)]; const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - MUR - 24, y1: Math.max(...ys) + 12 }; }
  function ajuster(net) {
    if (!plan) return; const b = bornes(), s = Math.max(.25, Math.min(1.5, Math.min(W / (b.x1 - b.x0 + 30), HT / (b.y1 - b.y0 + 30))));
    const v = { s, x: W / 2 - s * (b.x0 + b.x1) / 2, y: HT / 2 - s * (b.y0 + b.y1) / 2 };
    if (net) { cam = v; cible = null; } else cible = v;
  }
  function viser(a, b, s = 1.25) { const q = iso(a, b, 20); cible = { s, x: W / 2 - s * q[0], y: HT / 2 - s * q[1] }; }
  function viserCle(k) { const q = gens.get(k); if (q) viser(q.a, q.b); else { const r = racks.find(x => x.cle === k); if (r) viser(r.a, r.b); } }
  function redim() {
    const r = wrap.getBoundingClientRect(); W = r.width; HT = r.height; dpr = Math.min(devicePixelRatio || 1, 2); cv.width = W * dpr; cv.height = HT * dpr;
    if (plan) { if (!ajustee) { ajuster(true); ajustee = true; } dessiner(); }
  }
  new ResizeObserver(redim).observe(wrap); redim();
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function trouver(mx, my) {
    const ix = (mx - cam.x) / cam.s, iy = (my - cam.y) / cam.s; let mieux = null, d = 16 / Math.min(1, cam.s);
    for (const q of gens.values()) { if (q.hx == null || q.part) continue; const v = Math.hypot(q.hx - ix, q.hy - iy); if (v < d) { d = v; mieux = q.cle; } if (Math.abs(q.ty - iy) < 9 && Math.abs(q.hx - ix) < 30 && cam.s >= .62) mieux = mieux || q.cle; }
    if (mieux) return mieux;
    for (const r of racks) { const [px, py] = iso(r.a + .75, r.b + .5, 30); if (Math.abs(px - ix) < 20 && Math.abs(py - iy) < 36) return r.cle; }
    return null;
  }
  function salleSous(mx, my) { const [a, b] = sol((mx - cam.x) / cam.s, (my - cam.y) / cam.s); const p = plan && plan.pieces.find(p => a >= p.a && a < p.a + p.l && b >= p.b && b < p.b + p.p); return p ? p.id : null; }
  const ptrs = new Map(); let geste = null, glisse = null, minuterie = null, pince = 0;
  const debuterGlisse = (k, x, y) => { const q = gens.get(k); if (q && q.deplacable !== false) { glisse = { q, x, y, salle: null }; geste = null; wrap.style.cursor = 'grabbing'; } };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); ptrs.set(e.pointerId, [x, y]);
    if (ptrs.size === 2) { clearTimeout(minuterie); geste = null; glisse = null; const [a, b] = [...ptrs.values()]; pince = Math.hypot(a[0] - b[0], a[1] - b[1]); return; }
    const k = trouver(x, y); geste = { x0: x, y0: y, lx: x, ly: y, k, bouge: 0, type: e.pointerType };
    if (k && e.pointerType !== 'mouse' && gens.has(k)) minuterie = setTimeout(() => { if (geste && geste.bouge < 8) { if (navigator.vibrate) navigator.vibrate(15); debuterGlisse(k, x, y); } }, 350);
  });
  cv.addEventListener('pointermove', e => {
    const [x, y] = pos(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [x, y]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; if (pince) zoomer(d / pince, mx, my); pince = d; return; }
    if (glisse) { glisse.x = x; glisse.y = y; glisse.salle = salleSous(x, y); return; }
    if (geste) {
      const dx = x - geste.lx, dy = y - geste.ly; geste.bouge += Math.abs(dx) + Math.abs(dy); geste.lx = x; geste.ly = y;
      if (geste.bouge > 6 && geste.k && geste.type === 'mouse' && gens.has(geste.k)) { debuterGlisse(geste.k, x, y); return; }
      if (geste.bouge > 8) clearTimeout(minuterie);
      if (geste.bouge > 3) { cam.x += dx; cam.y += dy; cible = null; wrap.style.cursor = 'grabbing'; }
      return;
    }
    const k = e.pointerType === 'mouse' ? trouver(x, y) : null; survol = k; cv.style.cursor = k ? 'pointer' : 'grab';
    if (k && tip) { const q = gens.get(k), r = racks.find(z => z.cle === k); tip.textContent = q ? q.detail : r ? r.m.nom + ' · ' + r.m.moteur + (r.m.calcule ? ' · calcule' : r.m.charge ? ' · chargé' : ' · au repos') : ''; tip.style.left = Math.min(x + 14, W - 280) + 'px'; tip.style.top = Math.min(y + 14, HT - 50) + 'px'; tip.style.opacity = 1; } else if (tip) tip.style.opacity = 0;
  });
  const lever = e => {
    ptrs.delete(e.pointerId); clearTimeout(minuterie); wrap.style.cursor = '';
    if (glisse) { const g = glisse; glisse = null; if (g.salle) rappels.deposer(g.q.cle, g.salle); return; }
    if (geste && geste.bouge < 8 && geste.k) rappels.choisir(geste.k);
    geste = null; pince = 0;
  };
  cv.addEventListener('pointerup', lever); cv.addEventListener('pointercancel', e => { glisse = null; lever(e); });
  cv.addEventListener('pointerleave', () => { survol = null; if (tip) tip.style.opacity = 0; });
  function zoomer(f, mx, my) { const s = Math.max(.2, Math.min(3, cam.s * f)), k = s / cam.s; cam.x = mx - (mx - cam.x) * k; cam.y = my - (my - cam.y) * k; cam.s = s; cible = null; if (immobile) dessiner(); }
  cv.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = pos(e); zoomer(Math.exp(-e.deltaY * .0015), x, y); }, { passive: false });
  document.getElementById('z-plus').onclick = () => zoomer(1.25, W / 2, HT / 2);
  document.getElementById('z-moins').onclick = () => zoomer(.8, W / 2, HT / 2);
  document.getElementById('z-tout').onclick = () => ajuster(false);
  document.addEventListener('visibilitychange', () => { dernier = performance.now(); });
  if (!immobile) requestAnimationFrame(boucle);
  return { maj, viserCle, position: k => { const q = gens.get(k); return q && { a: q.a, b: q.b, presence: q.presence, etapes: q.chemin.length, x: q.hx * cam.s + cam.x, y: q.hy * cam.s + cam.y }; }, salleEn: (id) => { const p = plan && plan.pieces.find(z => z.id === id), q = p && iso(p.a + p.l / 2, p.b + p.p / 2); return q && { x: q[0] * cam.s + cam.x, y: q[1] * cam.s + cam.y }; }, sur: r => { rappels = { ...rappels, ...r }; }, actif: v => { actif = v; if (v) redim(); } };
})();
