/* wr-analytics-kpi.js — 업무일지 › 주간 분석 › 📊 분석 확장 1단계 (v13.459)
 *   🎯 선택 강조 — data-wa-sel 이 붙은 줄 · 점 · 범례를 누르면 분석 탭 전체가 그 대상 기준으로 강조
 *       (누르기 = 하나만 · Ctrl/⌘+누르기 = 여러 개 · 다시 누르기/Esc = 풀기). 숫자는 바꾸지 않고 강조만 — 거르려면 칩의 「만 보기」
 *   👥 개인 KPI — 사람 × KPI 표. 칸 색 = 팀(같은 부서 3명 이상이면 부서) 중앙값에서 떨어진 정도 — 순위 아님
 *   🎯 사분면 — 하루 평균 × 수주 투입률(또는 하루 수주 수), 가는 점선 = 팀 중앙값
 *   🧭 업무 방향 — 분장을 실행(B·M) · 성장(D·R) · 대응(A·S) · 운영(G) 으로 묶어 최근 N주 100% 쌓은 영역 + 기울기(최근 8주 직선 맞춤)
 * 권한: 사람끼리 비교(다른 사람 줄 · 사분면 · 사람별 방향 문장)는 관리자 · 임원 · 팀장만, 나머지는 본인 줄 + 팀 중앙값
 * 의존: wr-analytics.js (WA · _wa* · _ws* · waAgg 의 p.dh/dord/rd/nr/short/dept), eH, gfRange, currentUser, shortName, aN · sN · togN */

/* ─── 공통 ─── */
function _wsMgr() { var r = typeof currentUser !== 'undefined' && currentUser ? currentUser.role : ''; return ['admin', 'executive', 'manager'].indexOf(r) >= 0; }
function _wsMe() { var u = (typeof currentUser !== 'undefined' && currentUser) || {}; return [u.name, u.display_name].filter(Boolean); }
function _wsSN(n) { return typeof shortName === 'function' ? shortName(n) : n; }
function _wsBoxW() { var b = document.getElementById('waBox'); return b ? b.clientWidth : 900; }
/* 반 칸(.wa-g2r) 폭 — 900px 넘으면 두 칸(5:7), 아니면 한 칸 */
function _wsHalfW(part) { var w = _wsBoxW(); return Math.max(280, Math.round(w > 900 ? (w - 10) * part / 12 : w) - 30); }

/* ═══ 🎯 선택 강조 ═══ */
function _wsTypes() { var o = {}; (WA.sel || []).forEach(function (x) { o[x.split(':')[0]] = 1; }); return o; }
function _wsLabel(k) {
  var t = k.split(':')[0], v = k.slice(t.length + 1), A = _waLast && _waLast.A;
  if (t === 'ab') return _waAbName(v);
  if (t === 'dir') return _wadG(v).n;
  if (t === 'ord') return (A && A.O[v] && A.O[v].nm) || v;
  if (t === 'p') return _wsSN(v);
  return v;
}
function wsToggle(k, multi) {
  var s = (WA.sel || []).slice(), i = s.indexOf(k);
  if (multi) { if (i >= 0) s.splice(i, 1); else s.push(k); }
  else s = i >= 0 && s.length === 1 ? [] : [k];
  WA.sel = s.slice(-6); _waSave(); wsRefresh();
}
function wsClear() { if (!(WA.sel || []).length) return; WA.sel = []; _waSave(); wsRefresh(); }
function _wsRe(id, html) {
  var el = document.getElementById(id); if (!el || html == null) return;
  var t = document.createElement('div'); t.innerHTML = html;
  if (t.firstElementChild) el.replaceWith(t.firstElementChild);
}
/* 고른 것이 바뀌면 — 고른 사람 몫을 그리는 칸만 다시 그리고(빠름) 나머지는 class 만 */
function wsRefresh() {
  var L = _waLast, box = document.getElementById('waBox'); if (!L || !box) return;
  var gapOn = _waGapOn();
  _wsRe('waSelBar', wsBar());
  _wsRe('waFindC', _waFind(L.A, L.P, gapOn));
  _wsRe('waMixC', _waMix(L.A, L.P, gapOn));
  _wsRe('waDayC', _waDaily(L.A, gapOn));
  _wsRe('waTopC', _waTop(L.A, L.P));
  _wsRe('waSctC', waqCard(L.A));
  _wsRe('waDirC', wadCard());
  wsApply(box);
}
function wsApply(box) {
  box = box || document.getElementById('waBox'); if (!box) return;
  var sel = WA.sel || [], ty = _wsTypes();
  box.classList.toggle('wa-has-sel', sel.length > 0);
  box.querySelectorAll('[data-wa-sel]').forEach(function (el) {
    var k = el.getAttribute('data-wa-sel'), t = k.split(':')[0];
    if (!ty[t]) { el.classList.remove('wa-on', 'wa-off'); return; }
    var on = sel.indexOf(k) >= 0;
    el.classList.toggle('wa-on', on); el.classList.toggle('wa-off', !on);
  });
}
function wsBar() {
  var sel = WA.sel || [], ic = { p: '👤', ab: '🧩', cl: '🏢', ord: '📄', dir: '🧭' };
  var chips = sel.map(function (k) {
    var t = k.split(':')[0], v = k.slice(t.length + 1);
    return '<span class="wa-chip">' + (ic[t] || '') + ' ' + eH(_wsLabel(k))
      + (t === 'p' ? '<button type="button" class="wa-chip-o" data-ws-only="' + eH(v) + '" title="위 팀원 필터를 이 사람만으로 — 숫자도 이 사람 기준">만 보기</button>' : '')
      + '<button type="button" class="wa-chip-x" data-ws-x="' + eH(k) + '" aria-label="' + eH(_wsLabel(k)) + ' 강조 풀기">✕</button></span>';
  }).join('');
  return '<div class="wa-selbar' + (sel.length ? ' on' : '') + '" id="waSelBar">'
    + (sel.length ? '<b>강조</b>' + chips + '<button type="button" class="wa-selclr" data-ws-clr>모두 풀기</button>' : '')
    + '<span class="wa-selhint">💡 이름 · 줄 · 점 · 범례를 누르면 강조 — Ctrl+누르기 = 여러 개 · Esc = 풀기</span></div>';
}
/* 한눈에 — 고른 대상 이야기를 맨 위로 (x[2] = 1 이면 강조 표시) */
function wsFindSort(F) {
  var keys = (WA.sel || []).map(function (k) { var t = k.split(':')[0], v = k.slice(t.length + 1); return t === 'ab' ? _waAbName(v) : t === 'dir' ? _wadG(v).n : t === 'ord' ? _wsLabel(k) : v; });
  if (!keys.length) return F;
  var hit = function (x) { return keys.some(function (k) { return k && String(x[1]).indexOf(k) >= 0; }); };
  return F.filter(hit).map(function (x) { return [x[0], x[1], 1]; }).concat(F.filter(function (x) { return !hit(x); }));
}
function _wsOnly(n) {
  if (typeof aN === 'undefined' || typeof togN !== 'function') return;
  var i = aN.indexOf(n); if (i < 0) return;
  sN.clear(); togN(i);
}
function wsBind(box) {
  wsApply(box);
  if (box._wsB) return; box._wsB = true;
  box.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-ws-x],[data-ws-clr],[data-ws-only],[data-wak-sort],[data-wad-n],[data-waq-y],[data-wa-sel]');
    if (!t || !box.contains(t)) return;
    if (t.hasAttribute('data-ws-x')) { var x = t.getAttribute('data-ws-x'); WA.sel = (WA.sel || []).filter(function (k) { return k !== x; }); _waSave(); wsRefresh(); return; }
    if (t.hasAttribute('data-ws-clr')) { wsClear(); return; }
    if (t.hasAttribute('data-ws-only')) { _wsOnly(t.getAttribute('data-ws-only')); return; }
    if (t.hasAttribute('data-wak-sort')) {
      var sk = t.getAttribute('data-wak-sort'), cur = WA.kSort || {};
      WA.kSort = { k: sk, d: cur.k === sk ? -(cur.d || -1) : (sk === 'name' ? 1 : -1) }; _waSave();
      if (_waLast) { _wsRe('waKpiC', wakCard(_waLast.A, _waLast.P)); wsApply(box); }
      return;
    }
    if (t.hasAttribute('data-wad-n')) { WA.dN = +t.getAttribute('data-wad-n'); _waSave(); if (_waLast) { _waLast.dir = wadData(_waLast.rg); _wsRe('waFindC', _waFind(_waLast.A, _waLast.P, _waGapOn())); _wsRe('waKpiC', wakCard(_waLast.A, _waLast.P)); _wsRe('waDirC', wadCard()); wsApply(box); } return; }
    if (t.hasAttribute('data-waq-y')) { WA.sy = t.getAttribute('data-waq-y'); _waSave(); if (_waLast) { _wsRe('waSctC', waqCard(_waLast.A)); wsApply(box); } return; }
    if (getSelection && String(getSelection()).length > 2) return;   // 글자를 긁는 중이면 강조 안 함
    wsToggle(t.getAttribute('data-wa-sel'), e.ctrlKey || e.metaKey);
  });
  box.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest) {
      var t = e.target.closest('[data-wa-sel]'); if (!t || !box.contains(t) || /^(BUTTON|INPUT|SELECT|SUMMARY)$/.test(e.target.tagName)) return;
      e.preventDefault(); wsToggle(t.getAttribute('data-wa-sel'), e.ctrlKey || e.metaKey);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !(WA.sel || []).length) return;
    var b = document.getElementById('waBox');
    if (b && b.offsetParent && !document.querySelector('.wa-modal-overlay')) wsClear();
  });
}

/* ═══ 🧭 업무 방향 — 실행 · 성장 · 대응 · 운영 ═══
   색: 범주 팔레트 1 · 3 · 2 · 7번(파랑 · 청록 · 주황 · 보라) — 쌓는 순서에서 이웃끼리 색약 ΔE ≥ 9 (dataviz validate_palette 통과) */
var WAD_G = [
  { k: 'exec', n: '실행', d: '수주 · 양산', ab: ['B', 'M'], c: ['#2a78d6', '#3987e5'] },
  { k: 'grow', n: '성장', d: '개발 · 제안', ab: ['D', 'R'], c: ['#1baf7a', '#199e70'] },
  { k: 'resp', n: '대응', d: 'CS현장 · 영업지원', ab: ['A', 'S'], c: ['#eb6834', '#d95926'] },
  { k: 'ops', n: '운영', d: '공통', ab: ['G'], c: ['#6250d6', '#9085e9'] }
];
var WAD_ETC = { k: 'etc', n: '기타', d: '분장 없음 · 그 밖', ab: [], c: ['#a3acb9', '#6b7280'] };
function _wadGs() { return WAD_G.concat([WAD_ETC]); }
function _wadG(k) { return _wadGs().filter(function (g) { return g.k === k; })[0] || WAD_ETC; }
function _wadOf(ab) { for (var i = 0; i < WAD_G.length; i++) if (WAD_G[i].ab.indexOf(ab) >= 0) return WAD_G[i].k; return 'etc'; }
function _wadDark() { var m = String(getComputedStyle(document.body).color).match(/\d+/g); return m ? (+m[0] * 299 + +m[1] * 587 + +m[2] * 114) / 1000 > 140 : false; }
function _wadCol(g, dk) { return g.c[dk ? 1 : 0]; }
function _wadMon(s) { var w = _waD(s).getUTCDay(); return _waAdd(s, -((w + 6) % 7)); }

/** 최근 N주 (고른 기간의 마지막 날까지) — 같은 공통 필터, 기간만 넓혀서 (gfRange) */
function wadData(rg) {
  if (typeof gfRange !== 'function' || !rg || !rg.e) return null;
  var N = WA.dN || 12, s = _waAdd(_wadMon(rg.e), -(N - 1) * 7), W = {}, ppl = {};
  _waRows(gfRange(s, rg.e)).forEach(function (r) {
    if (_waVac(r)) return;
    var h = +r.hours || 0; if (!h) return;
    var wk = _wadMon(r.date), g = _wadOf(r.abbr || '');
    var o = W[wk] || (W[wk] = { k: wk, t: 0, g: {}, pp: {} });
    o.t += h; o.g[g] = (o.g[g] || 0) + h;
    var p = o.pp[r.name] || (o.pp[r.name] = { t: 0, g: {} });
    p.t += h; p.g[g] = (p.g[g] || 0) + h; ppl[r.name] = 1;
  });
  var L = [];
  for (var i = 0; i < N; i++) { var k = _waAdd(s, i * 7); if (W[k] && W[k].t > 0) L.push(W[k]); }
  var gs = _wadGs().filter(function (g) { return L.some(function (w) { return w.g[g.k]; }); });
  return { N: N, s: s, e: rg.e, W: L, gs: gs, team: _wadSlopes(L, gs), ppl: Object.keys(ppl) };
}
/* 기울기 — 8h 이상 기록한 주만, 최근 8주를 직선으로 맞춤 (sl = 주마다 %p · a/b = 맞춘 선의 처음/끝) */
function _wadSlopes(ws, gs) {
  ws = ws.filter(function (w) { return w && w.t >= 8; }).slice(-8);
  var n = ws.length, R = {};
  if (n < 4) return { n: n, g: R };
  gs.forEach(function (g) {
    var ys = ws.map(function (w) { return (w.g[g.k] || 0) / w.t * 100; });
    var mx = (n - 1) / 2, my = ys.reduce(function (a, b) { return a + b; }, 0) / n, num = 0, den = 0;
    ys.forEach(function (y, i) { num += (i - mx) * (y - my); den += (i - mx) * (i - mx); });
    var sl = den ? num / den : 0;
    R[g.k] = { sl: sl, a: Math.max(0, my - sl * mx), b: Math.max(0, my + sl * mx) };
  });
  return { n: n, g: R };
}
function _wadPerson(D, name) { return _wadSlopes(D.W.map(function (w) { return w.pp[name]; }), D.gs); }
function _wadMoved(x) { return Math.abs(x.sl) >= 1 && Math.abs(x.b - x.a) >= 4; }
function _wadBig(sl) {
  var best = null;
  Object.keys(sl.g).forEach(function (k) { var x = sl.g[k]; if (_wadMoved(x) && (!best || Math.abs(x.sl) > Math.abs(best.sl))) best = { k: k, sl: x.sl, a: x.a, b: x.b }; });
  return best;
}
function _wadSl(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + _waR1(Math.abs(v)) + '%p'; }
/** 한눈에 — 방향 문장 */
function wadFind(F) {
  var D = _waLast && _waLast.dir; if (!D || D.team.n < 4) return;
  Object.keys(D.team.g).forEach(function (k) {
    var x = D.team.g[k]; if (!_wadMoved(x)) return;
    var g = _wadG(k), up = x.sl > 0;
    var why = k === 'resp' && up ? ' — 현장 · 품질 이슈가 늘었는지 확인' : k === 'ops' && up ? ' — 공통 업무가 늘어 본업 시간이 줄어드는 중' : '';
    F.push([(k === 'resp' || k === 'ops') && up ? 'warn' : 'info', '방향: ' + g.n + '(' + g.d + ') 비중 주마다 ' + _wadSl(x.sl) + ' ' + (up ? '↑' : '↓') + ' — 최근 ' + D.team.n + '주 ' + Math.round(x.a) + '% → ' + Math.round(x.b) + '%' + why]);
  });
  if (!_wsMgr()) return;
  D.ppl.map(function (n) { var b = _wadBig(_wadPerson(D, n)); return b && Math.abs(b.sl) >= 2 ? { n: n, b: b } : null; }).filter(Boolean)
    .sort(function (a, b) { return Math.abs(b.b.sl) - Math.abs(a.b.sl); }).slice(0, 2)
    .forEach(function (x) { var g = _wadG(x.b.k); F.push(['info', x.n + ' — ' + g.n + '(' + g.d + ') 비중 주마다 ' + _wadSl(x.b.sl) + ' (' + Math.round(x.b.a) + '% → ' + Math.round(x.b.b) + '%)']); });
}
/* 100% 쌓은 영역 — ws: [{k 주, t, g}] (t=0 인 주는 건너뜀) */
function _wadArea(ws, gs, W, H, aria, small) {
  var L = 34, R = 8, T = 6, B = small ? 18 : 24, cw = W - L - R, ch = H - T - B, n = ws.length, dk = _wadDark();
  var xs = ws.map(function (w, i) { return L + (n === 1 ? cw / 2 : i * cw / (n - 1)); });
  var pts = ws.map(function (w, i) { return { x: xs[i], w: w }; }).filter(function (p) { return p.w && p.w.t > 0; });
  function y(v) { return T + ch - v / 100 * ch; }
  var s = '<svg class="wa-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + eH(aria) + '">';
  [0, 50, 100].forEach(function (t) { s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t) + '" y2="' + y(t) + '" class="wa-grid"/><text x="' + (L - 6) + '" y="' + (y(t) + 3.5) + '" class="wa-ax" text-anchor="end">' + t + '%</text>'; });
  if (pts.length) {
    var base = pts.map(function () { return 0; });
    gs.forEach(function (g) {
      var lo = base.slice(), hi = pts.map(function (p, i) { return base[i] + (p.w.g[g.k] || 0) / p.w.t * 100; });
      if (hi.every(function (v, i) { return v - lo[i] < 0.01; })) return;
      var d = pts.length === 1
        ? 'M' + (pts[0].x - 10) + ' ' + y(hi[0]) + 'H' + (pts[0].x + 10) + 'V' + y(lo[0]) + 'H' + (pts[0].x - 10) + 'Z'
        : pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + y(hi[i]).toFixed(1); }).join('') + pts.slice().reverse().map(function (p, j) { var i = pts.length - 1 - j; return 'L' + p.x.toFixed(1) + ' ' + y(lo[i]).toFixed(1); }).join('') + 'Z';
      s += '<path class="wad-band" d="' + d + '" fill="' + _wadCol(g, dk) + '"' + _wsA('dir:' + g.k) + '/>';
      var li = pts.length - 1, th = (hi[li] - lo[li]) / 100 * ch;   // 끝에 바로 이름표 (띠가 두꺼울 때만)
      if (th >= (small ? 12 : 14)) s += '<text class="wad-lb" x="' + (pts[li].x - 5).toFixed(1) + '" y="' + (y((hi[li] + lo[li]) / 2) + 4).toFixed(1) + '" text-anchor="end" fill="' + _waInk(_wadCol(g, dk)) + '"' + _wsA('dir:' + g.k) + '>' + eH(g.n) + ' ' + Math.round(hi[li] - lo[li]) + '%</text>';
      base = hi;
    });
  }
  var every = Math.ceil(n / Math.max(1, Math.floor(cw / 52)));
  ws.forEach(function (w, i) {
    if (!small && i % every === 0) s += '<text x="' + xs[i].toFixed(1) + '" y="' + (H - 8) + '" class="wa-ax" text-anchor="' + (n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle') + '">' + _waMD(w.k) + '</text>';
    var half = n === 1 ? cw / 2 : cw / (n - 1) / 2, x0 = Math.max(L, xs[i] - half), x1 = Math.min(W - R, xs[i] + half);
    var tip = w.t > 0 ? [_waH(w.t), _waMD(w.k) + ' 주'].concat(gs.map(function (g) { return g.n + '  ' + _waR1((w.g[g.k] || 0) / w.t * 100) + '% · ' + _waH(w.g[g.k] || 0); })) : [_waMD(w.k) + ' 주', '기록 없음'];
    s += '<rect class="wa-hit" x="' + x0.toFixed(1) + '" y="' + T + '" width="' + (x1 - x0).toFixed(1) + '" height="' + ch + '"' + _waTip(tip) + '/>';
  });
  return s + '</svg>';
}
function wadCard() {
  var D = _waLast && _waLast.dir, N = WA.dN || 12;
  var head = '<div class="wa-h"><h4>🧭 업무 방향 <span class="wa-sub">분장을 4갈래로 묶은 비중 · 주 단위 · 휴가 제외</span></h4>'
    + '<span class="wm-seg wa-seg2">' + [8, 12, 26].map(function (k) { return '<button data-wad-n="' + k + '" class="' + (N === k ? 'on' : '') + '">' + k + '주</button>'; }).join('') + '</span>' + _waSaveBtn('waDirC') + '</div>';
  if (!D || D.W.length < 2) return '<section class="wa-card" id="waDirC">' + head + '<div class="wa-empty">기록이 2주 이상 있어야 방향을 볼 수 있습니다</div></section>';
  var dk = _wadDark(), W = _wsHalfW(7);
  var legend = '<div class="wa-lg">' + D.gs.map(function (g) { return '<span class="wa-lgk" tabindex="0"' + _wsA('dir:' + g.k) + ' title="' + eH(g.d) + '"><i style="background:' + _wadCol(g, dk) + '"></i>' + eH(g.n) + ' <span class="wa-mut">' + eH(g.d) + '</span></span>'; }).join('') + '</div>';
  var sl = D.team.n >= 4 ? '<div class="wad-sls"><span class="wa-mut">최근 ' + D.team.n + '주 기울기</span>' + D.gs.map(function (g) {
    var x = D.team.g[g.k]; if (!x) return '';
    var mv = _wadMoved(x);
    return '<span class="wad-sl' + (mv ? ' mv' : '') + '"' + _wsA('dir:' + g.k) + ' title="' + eH(g.n + ' — 맞춘 선 ' + Math.round(x.a) + '% → ' + Math.round(x.b) + '%') + '"><i style="background:' + _wadCol(g, dk) + '"></i>' + eH(g.n) + ' ' + Math.round(x.b) + '% <b>' + (mv ? (x.sl > 0 ? '↑ ' : '↓ ') : '') + _wadSl(x.sl) + '/주</b></span>';
  }).join('') + '</div>' : '<div class="wa-note">기울기는 8h 넘게 기록한 주가 4주 이상일 때 나옵니다</div>';
  var team = '<div class="wad-sm-t">팀 전체</div><div class="wa-chart">' + _wadArea(D.W, D.gs, W, 180, '팀 전체 업무 방향', false) + '</div>';
  var mine = _wsPpl().filter(function (n) { return D.ppl.indexOf(n) >= 0 && (_wsMgr() || _wsMe().indexOf(n) >= 0); }).slice(0, 3).map(function (n) {
    var ws = D.W.map(function (w) { var p = w.pp[n]; return { k: w.k, t: p ? p.t : 0, g: p ? p.g : {} }; });
    var b = _wadBig(_wadPerson(D, n));
    return '<div class="wad-sm-t">👤 ' + eH(_wsSN(n)) + (b ? ' <span class="wa-mut">' + eH(_wadG(b.k).n) + ' ' + _wadSl(b.sl) + '/주</span>' : '') + '</div><div class="wa-chart">' + _wadArea(ws, D.gs, W, 92, n + ' 업무 방향', true) + '</div>';
  }).join('');
  var tbl = '<details class="wa-tview"><summary>표로 보기</summary><div class="wa-tw"><table class="wa-tbl"><thead><tr><th>주</th><th class="num">업무 시간</th>' + D.gs.map(function (g) { return '<th class="num">' + eH(g.n) + '</th>'; }).join('') + '</tr></thead><tbody>'
    + D.W.map(function (w) { return '<tr><td>' + _waMD(w.k) + '</td><td class="num">' + _waR1(w.t) + '</td>' + D.gs.map(function (g) { return '<td class="num">' + _waR1((w.g[g.k] || 0) / w.t * 100) + '%</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details>';
  return '<section class="wa-card" id="waDirC">' + head + legend + sl + team + mine + tbl
    + '<div class="wa-note">실행 = 수주 · 양산 · 성장 = 개발 · 제안 · 대응 = CS현장 · 영업지원 · 운영 = 공통 — 사람을 고르면 그 사람 방향이 아래에 같이 나옴</div></section>';
}

/* ═══ 👥 개인 KPI ═══ */
function _wakF(k, v) {
  if (v == null) return '<span class="wa-mut">–</span>';
  if (k === 'avg' || k === 'sd') return _waR1(v) + 'h';
  if (k === 'nOrd') return String(_waR1(v));
  if (k === 'nd' || k === 'newO') return String(Math.round(v));
  return Math.round(v) + '%';
}
/* bad: 1 높으면 살펴볼 쪽 · -1 낮으면 · 2 양쪽(하루 평균 9.5h 초과 · 6h 미만) · 0 중립 / fl = 색칠 최소 차이 */
var WAK_COLS = [
  { g: '부하', k: 'avg', n: '하루 평균', bad: 2, fl: 0.5, tip: '업무 시간 ÷ 기록한 날 — 9.5h 넘으면 과부하, 6h 안 되면 기록 누락 의심' },
  { g: '부하', k: 'over', n: '초과일', bad: 1, fl: 8, tip: '하루 9.5h 를 넘긴 날의 비율' },
  { g: '부하', k: 'sd', n: '들쭉날쭉', bad: 1, fl: 0.6, tip: '하루 업무 시간의 표준편차 — 클수록 몰아서 함' },
  { g: '가치', k: 'ordR', n: '수주 투입률', bad: -1, fl: 8, tip: '수주번호가 있는 기록의 시간 비율 — 직접 업무' },
  { g: '가치', k: 'gR', n: '공통', bad: 0, fl: 8, tip: '공통(G) 분장 시간 비율' },
  { g: '집중', k: 'nOrd', n: '하루 수주 수', bad: 1, fl: 0.4, tip: '하루에 손댄 수주 개수 평균 — 클수록 일이 잘게 쪼개짐' },
  { g: '집중', k: 'top', n: '주력 수주', bad: 0, fl: 10, tip: '가장 많이 한 수주가 업무 시간에서 차지하는 비율' },
  { g: '집중', k: 'newO', n: '새 수주', bad: 0, fl: 1, tip: '지난 기간엔 없다가 이번에 들어간 수주 수 (주 · 기간을 골랐을 때)' },
  { g: '기록', k: 'nd', n: '기록일', bad: 0, fl: 99, tip: '업무(휴가 제외)를 기록한 날 수' },
  { g: '기록', k: 'rec', n: '기록률', bad: -1, fl: 8, tip: '평일 중 기록(휴가 포함)이 있는 날의 비율' },
  { g: '기록', k: 'short', n: '짧은 내용', bad: 1, fl: 8, tip: '내용이 10자도 안 되는 기록의 비율' }
];
function _wakRow(p, A, P) {
  var ds = Object.keys(p.dh || {}), n = ds.length, mean = n ? p.work / n : 0, sd = 0;
  ds.forEach(function (d) { sd += Math.pow(p.dh[d] - mean, 2); }); sd = n > 1 ? Math.sqrt(sd / n) : 0;
  var over = ds.filter(function (d) { return (A.pd[p.k + '\u0001' + d] || 0) > 9.5; }).length;
  var nOrd = n ? Object.keys(p.dord || {}).reduce(function (s, d) { return s + Object.keys(p.dord[d]).length; }, 0) / n : 0;
  var ordH = 0, topH = 0; Object.keys(p.ord).forEach(function (k) { ordH += p.ord[k]; topH = Math.max(topH, p.ord[k]); });
  var pp = P && P.P[p.k], recD = Object.keys(p.rd || {}).filter(_waIsWork).length;
  var dept = Object.keys(p.dept || {}).sort(function (a, b) { return p.dept[b] - p.dept[a]; })[0] || '';
  return {
    k: p.k, dept: dept, work: p.work, nd: n, weak: n < 3,
    avg: n ? p.avg : null, over: n ? over / n * 100 : null, sd: n > 1 ? sd : null,
    ordR: p.work ? ordH / p.work * 100 : null, gR: p.work ? (p.ab.G || 0) / p.work * 100 : null,
    nOrd: n ? nOrd : null, top: p.work && ordH ? topH / p.work * 100 : null,
    newO: P ? (pp ? Object.keys(p.ord).filter(function (k) { return !pp.ord[k]; }).length : Object.keys(p.ord).length) : null,
    rec: A.wd ? Math.min(100, recD / A.wd * 100) : null, short: p.nr ? p.short / p.nr * 100 : null
  };
}
function _wakMed(rows, k) {
  var v = rows.filter(function (r) { return !r.weak && r[k] != null; }).map(function (r) { return r[k]; }).sort(function (a, b) { return a - b; });
  if (!v.length) return null;
  var m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function _wakMad(rows, k, med) {
  if (med == null) return 0;
  var v = rows.filter(function (r) { return !r.weak && r[k] != null; }).map(function (r) { return Math.abs(r[k] - med); }).sort(function (a, b) { return a - b; });
  if (!v.length) return 0;
  var m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
/* 기준(중앙값) — 같은 부서에 3명 이상이면 부서, 아니면 팀 전체 */
function _wakRefs(rows) {
  var all = {}, by = {};
  WAK_COLS.forEach(function (c) { var m = _wakMed(rows, c.k); all[c.k] = { m: m, d: _wakMad(rows, c.k, m) }; });
  var depts = {}; rows.forEach(function (r) { if (r.dept && !r.weak) (depts[r.dept] = depts[r.dept] || []).push(r); });
  Object.keys(depts).forEach(function (d) {
    if (depts[d].length < 3 || depts[d].length === rows.filter(function (r) { return !r.weak; }).length) return;
    by[d] = {}; WAK_COLS.forEach(function (c) { var m = _wakMed(depts[d], c.k); by[d][c.k] = { m: m, d: _wakMad(depts[d], c.k, m) }; });
  });
  return { all: all, by: by, depts: Object.keys(depts).length };
}
function _wakCell(c, r, ref) {
  var v = r[c.k], R = (ref.by[r.dept] || ref.all)[c.k], med = R && R.m;
  var txt = _wakF(c.k, v);
  if (v == null || med == null) return '<td class="num">' + txt + '</td>';
  var z = (v - med) / Math.max(R.d * 1.4826, c.fl), bad = c.bad === 2 ? (v > 9.5 || v < 6) : (c.bad ? z * c.bad >= 1 : false);
  var a = Math.abs(z), st = '';
  if (bad) st = 'background:color-mix(in srgb,' + WA_ST.warn + ' ' + (a >= 2 || c.bad === 2 ? 24 : 15) + '%,transparent)';
  else if (a >= 1 && c.k !== 'nd') st = 'background:color-mix(in srgb,var(--ac) ' + (a >= 2 ? 16 : 9) + '%,transparent)';
  var mk = bad ? '<em class="wak-w">' + (v > med ? '▲' : '▼') + '</em>' : '';
  var dv = v - med, dtx = c.k === 'avg' || c.k === 'sd' ? _waR1(Math.abs(dv)) + 'h' : c.k === 'nOrd' || c.k === 'newO' || c.k === 'nd' ? _waR1(Math.abs(dv)) : Math.round(Math.abs(dv)) + '%p';
  var tip = [c.n + ' ' + _wakF(c.k, v).replace(/<[^>]+>/g, ''), (ref.by[r.dept] ? r.dept + ' ' : '팀 ') + '중앙값 ' + _wakF(c.k, med).replace(/<[^>]+>/g, '') + (Math.abs(dv) > 0.05 ? ' · ' + (dv > 0 ? '+' : '−') + dtx : ''), c.tip];
  return '<td class="num wak-c"' + (st ? ' style="' + st + '"' : '') + _waTip(tip) + '>' + mk + txt + '</td>';
}
function wakCard(A, P) {
  var all = Object.keys(A.P).map(function (n) { return _wakRow(A.P[n], A, P); }).filter(function (r) { return r.work > 0 || r.nd > 0; });
  if (!all.length) return '';
  var mgr = _wsMgr(), me = _wsMe(), D = _waLast && _waLast.dir;
  var ref = _wakRefs(all), showDept = ref.depts >= 2;
  var rows = mgr ? all : all.filter(function (r) { return me.indexOf(r.k) >= 0; });
  var ks = WA.kSort || { k: 'work', d: -1 };
  rows.sort(function (a, b) {
    if (ks.k === 'name') return a.k.localeCompare(b.k, 'ko') * ks.d;
    var x = ks.k === 'work' ? a.work : a[ks.k], y = ks.k === 'work' ? b.work : b[ks.k];
    if (x == null) return 1; if (y == null) return -1;
    return (x - y) * ks.d || a.k.localeCompare(b.k, 'ko');
  });
  if (showDept) rows.sort(function (a, b) { return (a.dept || '￿').localeCompare(b.dept || '￿', 'ko'); });
  function th(k, n, tip) { var on = ks.k === k; return '<th class="num wak-sort' + (on ? ' on' : '') + '" data-wak-sort="' + k + '" title="' + eH(tip || '') + ' — 눌러서 정렬">' + n + (on ? (ks.d > 0 ? ' ↑' : ' ↓') : '') + '</th>'; }
  var grp = [], last = '';
  WAK_COLS.forEach(function (c) { if (c.g !== last) { grp.push({ g: c.g, n: 0 }); last = c.g; } grp[grp.length - 1].n++; });
  var h1 = '<tr class="wak-grp"><th></th>' + (showDept ? '<th></th>' : '') + '<th></th>' + grp.map(function (g, i) { return '<th colspan="' + g.n + '"' + (i ? ' class="wak-gs"' : '') + '>' + g.g + '</th>' + (g.g === '집중' ? '<th class="wak-gs"></th>' : ''); }).join('') + '</tr>';
  var h2 = '<tr><th class="wak-sort' + (ks.k === 'name' ? ' on' : '') + '" data-wak-sort="name">이름</th>' + (showDept ? '<th>부서</th>' : '') + th('work', '업무 시간', '휴가 뺀 업무 시간')
    + WAK_COLS.map(function (c) { return th(c.k, c.n, c.tip) + (c.k === 'newO' ? '<th title="최근 몇 주 동안 가장 크게 늘거나 준 업무 방향(실행 · 성장 · 대응 · 운영)">방향</th>' : ''); }).join('') + '</tr>';
  var dirTd = function (r) {
    if (!D) return '<td class="wa-mut">–</td>';
    var b = _wadBig(_wadPerson(D, r.k)); if (!b) return '<td class="wa-mut" title="최근 주들에 크게 바뀐 방향 없음">–</td>';
    var g = _wadG(b.k);
    return '<td class="wak-dir" title="' + eH(g.n + '(' + g.d + ') 맞춘 선 ' + Math.round(b.a) + '% → ' + Math.round(b.b) + '%') + '"><i style="background:' + _wadCol(g, _wadDark()) + '"></i>' + eH(g.n) + ' ' + (b.sl > 0 ? '↑' : '↓') + _waR1(Math.abs(b.sl)) + '</td>';
  };
  var body = rows.map(function (r) {
    return '<tr class="' + (r.weak ? 'wa-weak' : '') + '" tabindex="0"' + _wsA('p:' + r.k) + (r.weak ? ' title="기록 3일 미만 — 숫자가 흔들릴 수 있음"' : '') + '><td class="wa-tn wak-nm" title="' + eH(r.k) + '">' + eH(_wsSN(r.k)) + '</td>'
      + (showDept ? '<td class="wa-mut">' + eH(r.dept || '–') + '</td>' : '') + '<td class="num">' + _waH(r.work) + '</td>'
      + WAK_COLS.map(function (c) { return _wakCell(c, r, ref) + (c.k === 'newO' ? dirTd(r) : ''); }).join('') + '</tr>';
  }).join('');
  var foot = '<tr class="wa-sum"><td>팀 중앙값</td>' + (showDept ? '<td></td>' : '') + '<td class="num">' + _waH(_wakMed(all, 'work') || 0) + '</td>'
    + WAK_COLS.map(function (c) { return '<td class="num">' + _wakF(c.k, ref.all[c.k].m) + '</td>' + (c.k === 'newO' ? '<td></td>' : ''); }).join('') + '</tr>';
  return '<section class="wa-card" id="waKpiC"><div class="wa-h"><h4>👥 개인 KPI <span class="wa-sub">' + (mgr ? rows.length + '명 · 칸 색 = ' + (showDept ? '같은 부서(3명 이상)나 팀' : '팀') + ' 중앙값에서 떨어진 정도 · 순위 아님' : '내 숫자와 팀 중앙값') + '</span></h4>' + _waSaveBtn('waKpiC') + '</div>'
    + (rows.length ? '<div class="wa-tw"><table class="wa-tbl wak-tbl"><thead>' + h1 + h2 + '</thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>' : '<div class="wa-empty">이 필터에 내 기록이 없습니다</div>')
    + '<div class="wa-note"><span class="wak-key warn"></span>▲▼ 살펴볼 쪽으로 떨어짐 · <span class="wak-key"></span>그냥 다름 · 흐린 줄 = 기록 3일 미만 · 칸에 올리면 중앙값과 차이'
    + (mgr ? '' : ' · 다른 사람 숫자는 관리자 · 임원 · 팀장만 봅니다') + '</div></section>';
}

/* ═══ 🎯 사분면 — 하루 평균 × 수주 투입률(또는 하루 수주 수) ═══ */
function waqCard(A) {
  if (!_wsMgr()) return '';
  var frag = WA.sy === 'frag', yk = frag ? 'nOrd' : 'ordR';
  var rows = Object.keys(A.P).map(function (n) { return _wakRow(A.P[n], A, null); }).filter(function (r) { return r.nd > 0 && r.avg != null && r[yk] != null; });
  var head = '<div class="wa-h"><h4>🎯 사분면 <span class="wa-sub">가로 = 하루 평균 · 세로 = ' + (frag ? '하루 수주 수' : '수주 투입률') + ' · 점선 = 팀 중앙값</span></h4>'
    + '<span class="wm-seg wa-seg2"><button data-waq-y="ord" class="' + (!frag ? 'on' : '') + '">수주 투입률</button><button data-waq-y="frag" class="' + (frag ? 'on' : '') + '">하루 수주 수</button></span>' + _waSaveBtn('waSctC') + '</div>';
  if (rows.length < 2) return '<section class="wa-card" id="waSctC">' + head + '<div class="wa-empty">2명 이상일 때 비교할 수 있습니다</div></section>';
  var W = _wsHalfW(5), H = 310, L = 40, R = 14, T = 26, B = 34, cw = W - L - R, ch = H - T - B;
  var xs = rows.map(function (r) { return r.avg; }), ys = rows.map(function (r) { return r[yk]; });
  var x0 = Math.floor(Math.min(5, Math.min.apply(null, xs) - 0.5)), x1 = Math.ceil(Math.max(10, Math.max.apply(null, xs) + 0.5));
  var y1 = frag ? Math.ceil(Math.max(2, Math.max.apply(null, ys) + 0.5)) : 100, y0 = frag ? 0 : Math.max(0, Math.min(75, Math.floor((Math.min.apply(null, ys) - 5) / 25) * 25));   // 투입률이 모두 높으면 아래를 잘라 차이가 보이게
  function X(v) { return L + (v - x0) / (x1 - x0) * cw; }
  function Y(v) { return T + ch - (v - y0) / (y1 - y0) * ch; }
  var mx = _wakMed(rows, 'avg'), my = _wakMed(rows, yk);
  if (mx == null) mx = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
  if (my == null) my = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
  var s = '<svg class="wa-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="사람별 하루 평균과 ' + (frag ? '하루 수주 수' : '수주 투입률') + '">';
  var xt = x1 - x0 > 8 ? 2 : 1;
  for (var v = x0; v <= x1; v += xt) s += '<line x1="' + X(v).toFixed(1) + '" x2="' + X(v).toFixed(1) + '" y1="' + T + '" y2="' + (T + ch) + '" class="wa-grid"/><text x="' + X(v).toFixed(1) + '" y="' + (H - 18) + '" class="wa-ax" text-anchor="middle">' + v + 'h</text>';
  var yt = frag ? (y1 > 6 ? 2 : 1) : 25;
  for (var u = y0; u <= y1; u += yt) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(u).toFixed(1) + '" y2="' + Y(u).toFixed(1) + '" class="wa-grid"/><text x="' + (L - 6) + '" y="' + (Y(u) + 3.5).toFixed(1) + '" class="wa-ax" text-anchor="end">' + u + (frag ? '' : '%') + '</text>';
  s += '<text x="' + (L + cw / 2) + '" y="' + (H - 3) + '" class="wa-ax" text-anchor="middle">하루 평균 업무 시간 →</text>';
  s += '<line class="waq-med" x1="' + X(mx).toFixed(1) + '" x2="' + X(mx).toFixed(1) + '" y1="' + T + '" y2="' + (T + ch) + '"/><line class="waq-med" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(my).toFixed(1) + '" y2="' + Y(my).toFixed(1) + '"/>';
  var q = frag ? ['여유 · 여러 수주', '바쁨 · 여러 수주', '여유 · 한 일에 집중', '바쁨 · 한 일에 집중'] : ['여유 · 직접 업무', '바쁨 · 직접 업무', '여유 · 간접 업무 많음', '바쁨 · 간접 업무 많음'];
  s += '<text class="waq-q" x="' + L + '" y="' + (T - 10) + '">↖ ' + q[0] + '</text><text class="waq-q" x="' + (W - R) + '" y="' + (T - 10) + '" text-anchor="end">' + q[1] + ' ↗</text>'
    + '<text class="waq-q" x="' + (L + 6) + '" y="' + (T + ch - 6) + '">↙ ' + q[2] + '</text><text class="waq-q" x="' + (W - R - 6) + '" y="' + (T + ch - 6) + '" text-anchor="end">' + q[3] + ' ↘</text>';
  var many = rows.length > 12, sel = _wsPpl();
  rows.sort(function (a, b) { return a.work - b.work; }).forEach(function (r) {
    var cx = X(r.avg), cy = Y(r[yk]), lb = !many || sel.indexOf(r.k) >= 0, right = cx < L + cw - 60;
    s += '<g class="waq-pt' + (r.weak ? ' weak' : '') + '"' + _wsA('p:' + r.k) + '>'
      + '<circle class="waq-dot" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="6"/>'
      + (lb ? '<text class="waq-lb" x="' + (cx + (right ? 9 : -9)).toFixed(1) + '" y="' + (cy + 4).toFixed(1) + '" text-anchor="' + (right ? 'start' : 'end') + '">' + eH(_wsSN(r.k)) + '</text>' : '')
      + '<circle class="waq-hit" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="13"' + _waTip([_wsSN(r.k), '하루 평균 ' + _waR1(r.avg) + 'h · ' + (frag ? '하루 수주 ' + _waR1(r.nOrd) + '개' : '수주 투입률 ' + Math.round(r.ordR) + '%'), r.nd + '일 · 업무 ' + _waH(r.work) + (r.weak ? ' · 기록 3일 미만' : '')]) + '/></g>';
  });
  s += '</svg>';
  var tbl = '<details class="wa-tview"><summary>표로 보기</summary><div class="wa-tw"><table class="wa-tbl"><thead><tr><th>이름</th><th class="num">하루 평균</th><th class="num">' + (frag ? '하루 수주 수' : '수주 투입률') + '</th><th class="num">기록일</th></tr></thead><tbody>'
    + rows.slice().sort(function (a, b) { return b.avg - a.avg; }).map(function (r) { return '<tr><td>' + eH(r.k) + '</td><td class="num">' + _waR1(r.avg) + 'h</td><td class="num">' + _wakF(yk, r[yk]) + '</td><td class="num">' + r.nd + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
  return '<section class="wa-card" id="waSctC">' + head + '<div class="wa-chart">' + s + '</div>' + tbl
    + '<div class="wa-note">속 빈 점 = 기록 3일 미만' + (many ? ' · 사람이 많아 이름은 고른 사람만' : '') + '</div></section>';
}
