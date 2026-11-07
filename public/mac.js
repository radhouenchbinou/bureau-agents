// Section « Santé du Mac » : verdict, indicateurs, gros consommateurs et actions conseillées
'use strict';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fr = (n, d = 1) => n == null ? '—' : Number(n).toFixed(d).replace('.', ',');
const ST = { ok: 'normal', warn: 'vigilance', risk: 'risque' };
function lvl(v, warn, risk, inv) { if (v == null) return 'ok'; return inv ? (v < risk ? 'risk' : v < warn ? 'warn' : 'ok') : (v > risk ? 'risk' : v > warn ? 'warn' : 'ok'); }
function spark(arr, max) {
  if (!arr || arr.length < 2) return '';
  const w = 160, h = 28, n = arr.length, pts = arr.map((v, i) => [i / (n - 1) * w, h - 2 - Math.min(1, v / max) * (h - 4)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '), last = pts[n - 1];
  return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z" fill="var(--st)" opacity=".12"/><path d="' + d + '" fill="none" stroke="var(--st)" stroke-width="1.5" vector-effect="non-scaling-stroke"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.5" fill="var(--st)"/></svg>';
}
function ago(ms) { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 90 ? 'il y a ' + s + ' s' : s < 5400 ? 'il y a ' + Math.round(s / 60) + ' min' : 'il y a ' + Math.round(s / 3600) + ' h'; }

function renderMac(d) {
  const when = document.getElementById('mac-when'), v = document.getElementById('verdict');
  if (!d) { v.className = 'verdict st-warn'; v.innerHTML = '<b>En attente</b><span>Premier relevé en cours…</span>'; return; }
  when.textContent = 'Relevé ' + ago(d.epoch * 1000);
  const ratio = d.load1 / d.ncpu, swapPct = d.swapTotalGb ? 100 * d.swapUsedGb / d.swapTotalGb : 0, diskPct = d.diskTotalGb ? 100 * d.diskFreeGb / d.diskTotalGb : 100, nb = d.builds.length, H = d.history || [];
  const K = [
    { k: 'Charge processeur', s: lvl(ratio, 1, 2), v: fr(ratio) + '×', sub: fr(d.load1) + ' / ' + d.ncpu + ' cœurs', pct: Math.min(100, ratio / 3 * 100), sp: spark(H.map(x => x.load / d.ncpu), 3),
      dsc: 'Moyenne sur 1 min. Sur 5 min : ' + fr(d.load5) + ', sur 15 min : ' + fr(d.load15) },
    { k: 'Swap utilisé', s: lvl(swapPct, 50, 80), v: Math.round(swapPct) + ' %', sub: fr(d.swapUsedGb) + ' / ' + fr(d.swapTotalGb) + ' Go', pct: swapPct, sp: spark(H.map(x => x.swap), 100),
      dsc: 'Le disque sert de mémoire quand les ' + d.memGb + ' Go ne suffisent plus' },
    { k: 'Mémoire libre', s: lvl(d.memFreePct, 30, 15, true), v: (d.memFreePct ?? '—') + ' %', sub: 'sur ' + d.memGb + ' Go', pct: d.memFreePct || 0, dsc: 'Mesure de pression mémoire de macOS' },
    { k: 'Disque libre', s: lvl(diskPct, 20, 10, true), v: Math.round(diskPct) + ' %', sub: fr(d.diskFreeGb, 0) + ' Go sur ' + d.diskTotalGb, pct: 100 - diskPct, dsc: 'Sous 10 %, macOS ralentit et le swap peut manquer de place' },
    { k: 'Builds en parallèle', s: lvl(nb, 3, 5), v: String(nb), sub: d.jvms + ' JVM', pct: Math.min(100, nb / 10 * 100), dsc: nb ? 'Worktrees : ' + d.builds.join(', ') : 'Aucun build de worktree en cours' },
    { k: 'Alimentation', s: (!d.onAC && d.batteryPct != null && d.batteryPct < 20) ? 'risk' : (!d.onAC && d.batteryPct < 40) ? 'warn' : 'ok', v: d.onAC ? 'secteur' : (d.batteryPct + ' %'),
      sub: d.onAC && d.batteryPct != null ? 'batterie ' + d.batteryPct + ' %' : 'sur batterie', pct: d.batteryPct || 0, dsc: d.onAC ? 'Branché' : 'Débranché : les builds vident la batterie vite' },
    { k: 'Température', s: d.thermalOk ? 'ok' : 'risk', v: d.thermalOk ? 'normale' : 'alerte', sub: '', pct: d.thermalOk ? 0 : 100, dsc: d.thermalOk ? 'Aucune alerte thermique ni de bridage du processeur' : 'macOS bride le processeur pour le refroidir' }];
  const ss = K.map(x => x.s), worst = ss.includes('risk') ? 'risk' : ss.includes('warn') ? 'warn' : 'ok', nRisk = ss.filter(s => s === 'risk').length, nWarn = ss.filter(s => s === 'warn').length;
  const why = []; if (swapPct > 80) why.push('le swap est presque plein'); if (ratio > 2) why.push('le processeur est à ' + fr(ratio) + ' fois sa capacité'); if (nb > 5) why.push(nb + ' builds tournent en même temps'); if (diskPct < 10) why.push('le disque est presque plein'); if (!d.thermalOk) why.push('le Mac chauffe');
  v.className = 'verdict st-' + worst;
  v.innerHTML = '<b>' + (worst === 'risk' ? 'Utilisation à risque' : worst === 'warn' ? 'À surveiller' : 'Tout va bien') + '</b><span>' +
    (worst === 'risk' ? nRisk + ' indicateur' + (nRisk > 1 ? 's' : '') + ' au rouge : ' + why.join(', ') + '. Le Mac peut figer et des tests échouer par délai dépassé.' :
      worst === 'warn' ? nWarn + ' indicateur' + (nWarn > 1 ? 's' : '') + ' à surveiller, rien de bloquant pour l\'instant.' : 'Charge, mémoire et disque dans les seuils.') + '</span>';
  document.getElementById('kpis').innerHTML = K.map(x => '<div class="kpi st-' + x.s + '"><div class="k">' + x.k + '<span class="pill">' + ST[x.s] + '</span></div><div class="v">' + x.v + (x.sub ? ' <small>' + esc(x.sub) + '</small>' : '') + '</div>' + (x.sp || '<div class="bar"><i style="width:' + Math.round(x.pct) + '%"></i></div>') + '<div class="d">' + esc(x.dsc) + '</div></div>').join('');
  document.getElementById('hogs').innerHTML = (d.top || []).map(h => '<li><span>' + esc(h.n) + '</span><em>' + h.cpu + ' % · ' + (h.mem >= 1024 ? fr(h.mem / 1024) + ' Go' : h.mem + ' Mo') + '</em>' + (h.count > 1 ? '<small>' + h.count + ' processus</small>' : '') + '</li>').join('');
  const vm = (d.top || []).find(h => h.n === 'Machine virtuelle Docker'), todo = [];
  if (nb > 3) todo.push('Limiter les vérifications à 2 ou 3 builds en même temps (' + nb + ' en cours)');
  if (ratio > 2 && nb <= 3) todo.push('Attendre la fin des builds en cours avant d\'en lancer d\'autres');
  if (swapPct > 80) todo.push('Redémarrer le Mac après les fusions' + (d.uptimeDays ? ' (allumé depuis ' + d.uptimeDays + ' jours)' : '') + ' : le swap ne se vide pas sans ça');
  if (vm && vm.cpu > 100) todo.push('Quitter Docker quand les tests Testcontainers et les bases locales ne servent plus');
  if (diskPct < 20) todo.push('Libérer de la place : worktrees fusionnés, caches JetBrains');
  if (!d.onAC && d.batteryPct < 40) todo.push('Brancher le Mac');
  if (!todo.length) todo.push('Rien à faire pour l\'instant');
  document.getElementById('todo').innerHTML = todo.map(t => '<li>' + esc(t) + '</li>').join('');
}
