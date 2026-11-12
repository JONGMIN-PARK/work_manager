/* wr-analytics-p2.js — 업무일지 › 주간 분석 › 📊 분석 확장 2단계 (v13.460)
 *   👤 자세히(wap)   — 사람을 하나만 고르면: 숫자 4개(팀 중앙값과) · 최근 N주 작은 추이 3개 · 분장 구성 앞/뒤 · 주력 수주 · 업체 이동 · 목표 대비
 *   🎯 목표 대비(wat) — 팀 · 부서 · 사람마다 정한 분장 비율(서버 /api/wa-targets)과 실제. 사람 목표가 없으면 부서 → 팀 목표
 *   🧷 한 사람 의존(war) — 최근 N주 16h 넘는 수주 · 업체 중 80% 넘게 한 사람이 한 것 (그 사람이 빠지면 위험)
 *   🔀 업체 이동(wav) — 최근 N주를 앞 · 뒤 반으로 나눠 업체 비중 변화 · 새 업체 · 오래 붙잡힌 수주 · 사람마다 주력 업체
 * 기간: 👤 숫자 · 🎯 는 위에서 고른 기간, 나머지는 🧭 업무 방향과 같은 최근 N주(8 · 12 · 26) — wadData 의 rows 를 다시 묶음(_wa2)
 * 권한: 다른 사람 이름이 나오는 것은 관리자 · 임원 · 팀장만(_wsMgr), 그 밖엔 본인 것 + 팀 합계
 * 의존: wr-analytics.js · wr-analytics-kpi.js · apiFetch · showToast · wmConfirm */

/* ─── 최근 N주 다시 묶기 (사람 × 주 · 수주 · 업체) — D 에 메모 ─── */
function _wa2(D) {
  if (!D || !D.rows) return null;
  if (D._2) return D._2;
  var wks = []; for (var i = 0; i < D.N; i++) wks.push(_waAdd(D.s, i * 7));
  var P = {}, O = {}, C = {}, T = {};
  D.rows.forEach(function (r) {
    if (_waVac(r)) return;
    var h = +r.hours || 0; if (!h) return;
    var wk = _wadMon(r.date), n = r.name, ab = r.abbr || '?', cl = _waCl(r), no = r.orderNo || '';
    T[wk] = (T[wk] || 0) + h;
    var pp = P[n] || (P[n] = { k: n, t: 0, w: {} }); pp.t += h;
    var w = pp.w[wk] || (pp.w[wk] = { t: 0, oh: 0, d: {}, dord: {}, ab: {}, o: {}, c: {} });
    w.t += h; w.d[r.date] = (w.d[r.date] || 0) + h; w.ab[ab] = (w.ab[ab] || 0) + h; w.c[cl] = (w.c[cl] || 0) + h;
    if (_waIsOrd(no)) {
      w.oh += h; w.o[no] = (w.o[no] || 0) + h; (w.dord[r.date] || (w.dord[r.date] = {}))[no] = 1;
      var o = O[no] || (O[no] = { k: no, nm: '', cl: cl, h: 0, ph: {}, w: {}, last: '' });
      if (!o.nm) o.nm = r.ocmt || (typeof getOCmt === 'function' ? getOCmt(no) : '') || '';
      o.h += h; o.ph[n] = (o.ph[n] || 0) + h; o.w[wk] = (o.w[wk] || 0) + h; if (r.date > o.last) o.last = r.date;
    }
    var c = C[cl] || (C[cl] = { k: cl, h: 0, ph: {}, w: {}, last: '' });
    c.h += h; c.ph[n] = (c.ph[n] || 0) + h; c.w[wk] = (c.w[wk] || 0) + h; if (r.date > c.last) c.last = r.date;
  });
  var half = Math.floor(D.N / 2);
  return (D._2 = { wks: wks, a: wks.slice(0, half), b: wks.slice(half), P: P, O: O, C: C, T: T });
}
function _wa2Med(v) { v = v.filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; }); if (!v.length) return null; var m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
function _wa2Sum(map, wks) { var t = 0; wks.forEach(function (k) { t += (map && map[k]) || 0; }); return t; }
/* 사람 한 명의 여러 주를 합친 것 — { t, ab, o, c } */
function _wa2Pool(pp, wks) {
  var o = { t: 0, ab: {}, o: {}, c: {} };
  if (!pp) return o;
  wks.forEach(function (k) {
    var w = pp.w[k]; if (!w) return;
    o.t += w.t;
    ['ab', 'o', 'c'].forEach(function (f) { Object.keys(w[f]).forEach(function (x) { o[f][x] = (o[f][x] || 0) + w[f][x]; }); });
  });
  return o;
}
function _wa2Top(map) { var k = Object.keys(map || {}).filter(function (x) { return x !== '(미지정)'; }).sort(function (a, b) { return map[b] - map[a]; })[0]; return k || null; }
function _wa2Rng(wks) { return wks.length ? _waMD(wks[0]) + '~' + _waMD(_waAdd(wks[wks.length - 1], 4)) : ''; }
function _wa2Path(pts) { var d = '', pen = false; pts.forEach(function (p) { if (!p) { pen = false; return; } d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); pen = true; }); return d; }
function _wa2OrdNm(X, k) { var o = X && X.O[k]; return (o && o.nm) || k; }
function _wa2Pc(v) { return Math.round(v) + '%'; }
function _wa2Pp(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.round(Math.abs(v)) + '%p'; }

/* 다시 그리기 — what: 'tgt' 목표가 바뀜 · 'dir' 주 수가 바뀜 · 'sel' 고른 것이 바뀜 · noApply = 부르는 쪽이 wsApply */
function wa2Re(what, noApply) {
  var L = _waLast, box = document.getElementById('waBox'); if (!L || !box) return;
  _wsRe('waPerC', wapCard(L.A));
  if (what === 'tgt') { _wsRe('waTgtC', watCard(L.A)); _wsRe('waFindC', _waFind(L.A, L.P, _waGapOn())); }
  if (what === 'dir') { _wsRe('waRiskC', warCard()); _wsRe('waMovC', wavCard()); _wsRe('waFindC', _waFind(L.A, L.P, _waGapOn())); }
  if (!noApply && typeof wsApply === 'function') wsApply(box);
}

/* ═══ 👤 자세히 — 한 사람 ═══ */
function _wapWk(w) {
  if (!w || w.t <= 0) return null;
  var ds = Object.keys(w.d), nd = ds.length;
  var no = nd ? ds.reduce(function (s, d) { return s + Object.keys(w.dord[d] || {}).length; }, 0) / nd : 0;
  return { t: w.t, nd: nd, avg: nd ? w.t / nd : 0, ordR: w.oh / w.t * 100, nOrd: no };
}
/* 작은 추이 — 진한 선 = 이 사람 · 점선 = 팀 중앙값(그 주 8h 넘게 기록한 사람들) */
function _wapSpark(wks, vals, meds, W, H, fmt, aria) {
  var L = 34, R = 34, T = 8, B = 18, cw = W - L - R, ch = H - T - B, n = wks.length;
  var all = vals.concat(meds).filter(function (v) { return v != null; });
  if (!all.length) return '<div class="wa-empty">기록 없음</div>';
  var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  var pad = (hi - lo) * 0.15; lo = Math.max(0, lo - pad); hi += pad;
  function X(i) { return L + (n === 1 ? cw / 2 : i * cw / (n - 1)); }
  function Y(v) { return T + ch - (v - lo) / (hi - lo) * ch; }
  var s = '<svg class="wa-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + eH(aria) + '">';
  [lo, hi].forEach(function (v) { s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="wa-grid"/><text x="' + (L - 5) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" class="wa-ax" text-anchor="end">' + fmt(v) + '</text>'; });
  s += '<path class="wap-med" d="' + _wa2Path(meds.map(function (v, i) { return v == null ? null : [X(i), Y(v)]; })) + '"/>';
  s += '<path class="wap-ln" d="' + _wa2Path(vals.map(function (v, i) { return v == null ? null : [X(i), Y(v)]; })) + '"/>';
  var li = -1; vals.forEach(function (v, i) { if (v != null) { li = i; s += '<circle class="wap-dot" cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="2.6"/>'; } });
  if (li >= 0) s += '<circle class="wap-dot" cx="' + X(li).toFixed(1) + '" cy="' + Y(vals[li]).toFixed(1) + '" r="4"/><text class="wap-end" x="' + (X(li) + 6).toFixed(1) + '" y="' + (Y(vals[li]) + 4).toFixed(1) + '">' + fmt(vals[li]) + '</text>';
  s += '<text x="' + L + '" y="' + (H - 4) + '" class="wa-ax">' + _waMD(wks[0]) + '</text><text x="' + (W - R) + '" y="' + (H - 4) + '" class="wa-ax" text-anchor="end">' + _waMD(wks[n - 1]) + '</text>';
  wks.forEach(function (k, i) {
    var half = n === 1 ? cw / 2 : cw / (n - 1) / 2, x0 = Math.max(L, X(i) - half), x1 = Math.min(W - R, X(i) + half);
    s += '<rect class="wa-hit" x="' + x0.toFixed(1) + '" y="' + T + '" width="' + (x1 - x0).toFixed(1) + '" height="' + ch + '"' + _waTip([vals[i] == null ? '기록 없음' : fmt(vals[i]), _waMD(k) + ' 주', '팀 중앙값 ' + (meds[i] == null ? '–' : fmt(meds[i]))]) + '/>';
  });
  return s + '</svg>';
}
/* 분장 구성 막대 (HTML) — mix = { 분장: 시간 }, tot = 합 */
function _wapBar(mix, tot, lbl) {
  var ks = Object.keys(mix).filter(function (k) { return mix[k] > 0; }).sort(function (a, b) { return mix[b] - mix[a]; });
  return '<div class="wap-br"><span class="wap-bl">' + lbl + '</span><div class="wa-seg wap-seg">' + ks.map(function (k) {
    var p = mix[k] / tot * 100, c = _waAbCol(k);
    return '<div class="wa-sg" style="flex:' + mix[k] + ' 1 0;background:' + c + '"' + _wsA('ab:' + k) + _waTip([_wa2Pc(p) + ' · ' + _waH(mix[k]), _waAbName(k)]) + '>' + (p >= 9 ? '<span style="color:' + _waInk(c) + '">' + Math.round(p) + '%</span>' : '') + '</div>';
  }).join('') + '</div></div>';
}
function wapCard(A) {
  var none = '<div id="waPerC" hidden></div>', ps = _wsPpl();
  if (ps.length !== 1) return none;
  var n = ps[0]; if (!_wsMgr() && _wsMe().indexOf(n) < 0) return none;
  var D = _waLast && _waLast.dir, X = _wa2(D), pp = X && X.P[n], p = A.P[n];
  // ① 위 기간 숫자 — 팀 중앙값과
  var all = Object.keys(A.P).map(function (k) { return _wakRow(A.P[k], A, null); }).filter(function (r) { return r.work > 0 || r.nd > 0; });
  var me = p ? _wakRow(p, A, null) : null;
  var stat = function (k, nm) {
    var v = me ? me[k] : null, m = _wakMed(all, k);
    return '<div class="wa-t"><div class="wa-tl">' + nm + '</div><div class="wa-tv">' + _wakF(k, v) + '</div><div class="wa-ts"><span>팀 중앙값 ' + _wakF(k, m) + '</span></div></div>';
  };
  var tiles = '<div class="wa-tiles wap-tiles">' + stat('avg', '하루 평균') + stat('ordR', '수주 투입률') + stat('nOrd', '하루 수주 수') + stat('rec', '기록률') + '</div>';
  // ② 최근 N주 작은 추이 3개
  var spark = '', mixes = '', moves = '';
  if (pp) {
    var bw = _wsBoxW() - 32, cols = bw >= 760 ? 3 : bw >= 500 ? 2 : 1, W = Math.floor((bw - (cols - 1) * 12) / cols);
    var mine = X.wks.map(function (k) { return _wapWk(pp.w[k]); });
    var team = X.wks.map(function (k) { return Object.keys(X.P).map(function (q) { return _wapWk(X.P[q].w[k]); }).filter(function (s) { return s && s.t >= 8; }); });
    var M = [['avg', '하루 평균', function (v) { return _waR1(v) + 'h'; }], ['ordR', '수주 투입률', function (v) { return Math.round(v) + '%'; }], ['nOrd', '하루 수주 수', function (v) { return _waR1(v) + '개'; }]];
    spark = '<div class="wap-sp" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' + M.map(function (m) {
      var vals = mine.map(function (s) { return s ? s[m[0]] : null; }), meds = team.map(function (ts) { return _wa2Med(ts.map(function (s) { return s[m[0]]; })); });
      return '<div><div class="wad-sm-t">' + m[1] + '</div><div class="wa-chart">' + _wapSpark(X.wks, vals, meds, W, 96, m[2], n + ' ' + m[1] + ' 주마다') + '</div></div>';
    }).join('') + '</div><div class="wa-lg"><span><i class="wap-k"></i>' + eH(_wsSN(n)) + '</span><span><i class="wap-k med"></i>팀 중앙값 (그 주 8h 넘게 기록한 사람)</span></div>';
    // ③ 분장 구성 — 앞 반 · 뒤 반
    var a = _wa2Pool(pp, X.a), b = _wa2Pool(pp, X.b);
    if (a.t > 0 && b.t > 0) {
      var ch = Object.keys(a.ab).concat(Object.keys(b.ab)).filter(function (k, i, z) { return z.indexOf(k) === i; })
        .map(function (k) { return { k: k, d: (b.ab[k] || 0) / b.t * 100 - (a.ab[k] || 0) / a.t * 100 }; })
        .filter(function (x) { return Math.abs(x.d) >= 3; }).sort(function (x, y) { return Math.abs(y.d) - Math.abs(x.d); }).slice(0, 3);
      mixes = '<div class="wad-sm-t">분장 구성 — 앞 ' + X.a.length + '주 · 최근 ' + X.b.length + '주</div>'
        + _wapBar(a.ab, a.t, '앞 ' + _wa2Rng(X.a)) + _wapBar(b.ab, b.t, '최근 ' + _wa2Rng(X.b))
        + (ch.length ? '<div class="wap-chg">' + ch.map(function (x) { return '<span>' + eH(_waAbName(x.k)) + ' <b>' + _wa2Pp(x.d) + '</b></span>'; }).join('') + '</div>' : '<div class="wap-chg wa-mut">구성이 크게 바뀌지 않음</div>');
      // ④ 주력 수주 · 업체
      var ta = _wa2Top(a.o), tb = _wa2Top(b.o), ca = _wa2Top(a.c), cb = _wa2Top(b.c);
      var line = function (lb, x, y, ma, mb) {
        if (!x && !y) return '';
        var nm = function (k) { return lb === '수주' ? _wa2OrdNm(X, k) : k; };
        return '<div class="wap-mv"><span class="wa-mut">주력 ' + lb + '</span> ' + (x === y
          ? '<b>' + eH(nm(y)) + '</b> 그대로 <span class="wa-mut">(' + _wa2Pc(ma[x] / a.t * 100) + ' → ' + _wa2Pc(mb[y] / b.t * 100) + ')</span>'
          : (x ? eH(nm(x)) + ' <span class="wa-mut">' + _wa2Pc(ma[x] / a.t * 100) + '</span>' : '<span class="wa-mut">없음</span>') + ' → <b>' + (y ? eH(nm(y)) + '</b> <span class="wa-mut">' + _wa2Pc(mb[y] / b.t * 100) + '</span>' : '없음</b>')) + '</div>';
      };
      var top3 = Object.keys(b.o).sort(function (x, y) { return b.o[y] - b.o[x]; }).slice(0, 3);
      moves = line('수주', ta, tb, a.o, b.o) + line('업체', ca, cb, a.c, b.c)
        + (top3.length ? '<div class="wap-mv"><span class="wa-mut">최근 ' + X.b.length + '주 많이 한 수주</span> ' + top3.map(function (k) { return '<span class="wap-o"' + _wsA('ord:' + k) + '>' + eH(_wa2OrdNm(X, k)) + ' <span class="wa-mut">' + _wa2Pc(b.o[k] / b.t * 100) + '</span></span>'; }).join(' · ') + '</div>' : '');
    }
  }
  // ⑤ 목표 대비
  var tg = '', dept = me && me.dept, T = typeof _watFor === 'function' ? _watFor(n, dept) : null;
  if (T && p) {
    var gp = _watGap(_watAct(p.ab, p.work), T.mix).slice(0, 3);
    tg = '<div class="wap-mv"><span class="wa-mut">목표 대비 (' + eH(T.src === '개인' ? '개인 목표' : T.src === '팀' ? '팀 목표' : T.src + ' 목표') + ')</span> ' + gp.map(function (x) { return eH(_waAbName(x.k)) + ' 목표 ' + x.t + '% · 실제 ' + Math.round(x.a) + '% <b>' + _wa2Pp(x.d) + '</b>'; }).join(' · ') + '</div>';
  }
  var D2 = D ? D.N : WA.dN || 12;
  return '<section class="wa-card wap-card" id="waPerC"><div class="wa-h"><h4>👤 ' + eH(_wsSN(n)) + ' 자세히 <span class="wa-sub">' + (dept ? eH(dept) + ' · ' : '') + '숫자 = 위 기간 · 추이 = 최근 ' + D2 + '주</span></h4>'
    + _waSaveBtn('waPerC') + '<button type="button" class="wa-chip-x wap-x" data-ws-x="p:' + eH(n) + '" aria-label="자세히 닫기" title="닫기 (Esc)">✕</button></div>'
    + tiles + (pp ? spark + '<div class="wap-g">' + '<div>' + mixes + '</div><div>' + moves + tg + '</div></div>' : '<div class="wa-empty">최근 ' + D2 + '주 기록이 없습니다</div>' + tg)
    + '<div class="wa-note">사람 하나만 고르면 나옴 · 다른 칸의 줄 · 점 · 이름을 눌러도 바뀜 · 주 수는 🧭 업무 방향의 8 · 12 · 26주를 따름</div></section>';
}

/* ═══ 🎯 목표 구성 대비 ═══ */
var WAT = { rows: null, canEdit: false, st: '', ed: null };
function watLoad(force) {
  if (WAT.st === 'loading' || (WAT.rows && !force)) return;
  if (typeof apiFetch !== 'function') { WAT.rows = []; return; }
  WAT.st = 'loading';
  apiFetch('/api/wa-targets').then(function (r) {
    WAT.rows = (r && r.data) || []; WAT.canEdit = !!(r && r.canEdit); WAT.st = ''; wa2Re('tgt');
  }).catch(function () { WAT.rows = WAT.rows || []; WAT.st = 'err'; wa2Re('tgt'); });
}
function _watGet(scope, key) { var x = (WAT.rows || []).filter(function (r) { return r.scope === scope && r.key === key; })[0]; return x && Object.keys(x.mix || {}).length ? x : null; }
function _watFor(n, dept) {
  var x;
  if ((x = _watGet('person', n))) return { mix: x.mix, src: '개인', row: x };
  if (dept && (x = _watGet('dept', dept))) return { mix: x.mix, src: dept, row: x };
  if ((x = _watGet('team', '*'))) return { mix: x.mix, src: '팀', row: x };
  return null;
}
/* 실제 — 휴가(V) 뺀 업무 시간 중 분장별 % */
function _watAct(ab, work) { var o = {}; if (!work) return o; Object.keys(ab || {}).forEach(function (k) { if (k !== 'V') o[k] = ab[k] / work * 100; }); return o; }
function _watGap(act, mix) {
  return Object.keys(mix || {}).map(function (k) { var a = act[k] || 0, t = +mix[k] || 0; return { k: k, a: a, t: t, d: a - t }; })
    .sort(function (x, y) { return Math.abs(y.d) - Math.abs(x.d); });
}
function _watCodes() { var c = _waCodes().filter(function (k) { return k !== 'V'; }); return c.length ? c : ['B', 'M', 'D', 'R', 'A', 'S', 'G']; }
function _watMiniBar(pc, cls, tipOf) {
  var ks = _watCodes().concat(Object.keys(pc).filter(function (k) { return _watCodes().indexOf(k) < 0; })).filter(function (k) { return pc[k] > 0.05; });
  var used = ks.reduce(function (s, k) { return s + pc[k]; }, 0);
  return '<div class="wat-b ' + cls + '">' + ks.map(function (k) { return '<i style="flex:' + pc[k].toFixed(2) + ' 1 0;background:' + _waAbCol(k) + '"' + _waTip(tipOf(k)) + '></i>'; }).join('')
    + (used < 99.5 ? '<i class="wat-rest" style="flex:' + (100 - used).toFixed(2) + ' 1 0"' + _waTip([_wa2Pc(100 - used), cls === 't' ? '목표 안 정한 몫' : '그 밖']) + '></i>' : '') + '</div>';
}
function _watRow(label, sub, selKey, act, T) {
  var gaps = _watGap(act, T.mix), tot = gaps.reduce(function (s, x) { return s + Math.abs(x.d); }, 0);
  var tipOf = function (k) { return [_waAbName(k), '실제 ' + _wa2Pc(act[k] || 0) + ' · 목표 ' + (T.mix[k] ? T.mix[k] + '%' : '없음')]; };
  var chips = gaps.filter(function (x) { return Math.abs(x.d) >= 3; }).slice(0, 3).map(function (x) {
    return '<span class="wat-g' + (Math.abs(x.d) >= 10 ? ' big' : '') + '"><i style="background:' + _waAbCol(x.k) + '"></i>' + eH(_waAbName(x.k)) + ' ' + _wa2Pp(x.d) + '</span>';
  }).join('') || '<span class="wa-mut">목표 가까이</span>';
  return '<div class="wat-r"' + (selKey ? _wsA(selKey) + ' tabindex="0"' : '') + '><div class="wat-nm" title="' + eH(label) + '">' + eH(label) + (sub ? ' <span class="wa-mut">' + eH(sub) + '</span>' : '') + '</div>'
    + '<div class="wat-bars">' + _watMiniBar(act, 'a', tipOf) + _watMiniBar(T.mix, 't', tipOf) + '</div>'
    + '<div class="wat-gp">' + chips + '</div><div class="num wat-sum" title="목표를 정한 분장마다 실제와의 차이를 더한 것 — 작을수록 목표에 가까움">' + Math.round(tot) + '%p</div></div>';
}
/* 부서 단위 실제 — 그 부서(가장 많이 적은 부서) 사람들의 합 */
function _watDepts(A) {
  var o = {};
  Object.keys(A.P).forEach(function (n) {
    var p = A.P[n], d = Object.keys(p.dept || {}).sort(function (a, b) { return p.dept[b] - p.dept[a]; })[0]; if (!d) return;
    var x = o[d] || (o[d] = { k: d, ab: {}, work: 0, n: 0 });
    x.work += p.work; x.n++; Object.keys(p.ab).forEach(function (k) { x.ab[k] = (x.ab[k] || 0) + p.ab[k]; });
  });
  return o;
}
function watCard(A) {
  if (WAT.rows == null) watLoad();
  var can = WAT.canEdit || _wsMgr(), mgr = _wsMgr(), me = _wsMe();
  var head = '<div class="wa-h"><h4>🎯 목표 구성 대비 <span class="wa-sub">분장별 목표 비율과 실제 · 휴가 뺀 업무 시간 · 위 기간</span></h4>'
    + (can ? '<button type="button" class="wat-edb' + (WAT.ed ? ' on' : '') + '" data-wat-ed>✏️ 목표 정하기</button>' : '') + _waSaveBtn('waTgtC') + '</div>';
  if (WAT.rows == null) return '<section class="wa-card" id="waTgtC">' + head + '<div class="wa-empty">목표 불러오는 중…</div></section>';
  var rows = [], depts = _watDepts(A), dk = Object.keys(depts);
  var teamT = dk.length === 1 && _watGet('dept', dk[0]) ? { mix: _watGet('dept', dk[0]).mix, src: dk[0] } : _watGet('team', '*') ? { mix: _watGet('team', '*').mix, src: '팀' } : null;
  if (teamT && A.work) rows.push(_watRow(dk.length === 1 && teamT.src !== '팀' ? dk[0] : '팀 전체', teamT.src === '팀' ? '' : '부서 목표', null, _watAct(A.ab, A.work), teamT));
  if (dk.length > 1) dk.sort(function (a, b) { return a.localeCompare(b, 'ko'); }).forEach(function (d) { var t = _watGet('dept', d); if (t && depts[d].work) rows.push(_watRow(d, depts[d].n + '명', null, _watAct(depts[d].ab, depts[d].work), { mix: t.mix, src: d })); });
  var ppl = Object.keys(A.P).filter(function (n) { return A.P[n].work > 0 && (mgr || me.indexOf(n) >= 0); }).map(function (n) {
    var p = A.P[n], dept = Object.keys(p.dept || {}).sort(function (a, b) { return p.dept[b] - p.dept[a]; })[0], T = _watFor(n, dept);
    if (!T) return null;
    var act = _watAct(p.ab, p.work);
    return { n: n, T: T, act: act, tot: _watGap(act, T.mix).reduce(function (s, x) { return s + Math.abs(x.d); }, 0) };
  }).filter(Boolean).sort(function (a, b) { return b.tot - a.tot; });
  var pRows = ppl.map(function (x) { return _watRow(_wsSN(x.n), x.T.src === '개인' ? '개인 목표' : x.T.src === '팀' ? '팀 목표' : x.T.src + ' 목표', 'p:' + x.n, x.act, x.T); });
  var body = rows.length || pRows.length
    ? '<div class="wat-h"><span>대상</span><span>위 = 실제 · 아래 = 목표</span><span>많이 벗어난 분장</span><span class="num">차이 합</span></div><div class="wat-l">' + rows.join('') + (rows.length && pRows.length ? '<div class="wat-sep"></div>' : '') + pRows.join('') + '</div>'
    : '<div class="wa-empty">' + (can ? '아직 목표가 없습니다 — ✏️ 목표 정하기로 팀 · 부서 · 사람마다 분장 비율을 정하면 실제와 비교합니다' : '아직 정해진 목표가 없습니다 (관리자 · 임원 · 팀장이 정함)') + '</div>';
  return '<section class="wa-card" id="waTgtC">' + head + (WAT.ed && can ? _watEd(A) : '') + body
    + (WAT.st === 'err' ? '<div class="wa-note">⚠️ 목표를 불러오지 못했습니다 — 새로 고침하면 다시 시도</div>' : '')
    + '<div class="wa-note">사람 목표가 없으면 부서 → 팀 목표를 씀 · 차이 합 = 목표를 정한 분장마다 |실제 − 목표| 를 더한 것 · 빗금 = 목표를 안 정한 몫' + (mgr ? '' : ' · 다른 사람 것은 관리자 · 임원 · 팀장만 봅니다') + '</div></section>';
}
/* 목표 고치는 칸 (카드 안에 펼침 — 창을 띄우지 않음) */
function _watEd(A) {
  var e = WAT.ed, depts = Object.keys(_watDepts(A)).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  (WAT.rows || []).forEach(function (r) { if (r.scope === 'dept' && depts.indexOf(r.key) < 0) depts.push(r.key); });
  var ppl = Object.keys(A.P).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  (WAT.rows || []).forEach(function (r) { if (r.scope === 'person' && ppl.indexOf(r.key) < 0) ppl.push(r.key); });
  var opt = function (sc, k, lb) { var has = !!_watGet(sc, k); return '<option value="' + sc + ':' + eH(k) + '"' + (e.scope === sc && e.key === k ? ' selected' : '') + '>' + eH(lb) + (has ? ' ✓' : '') + '</option>'; };
  var sel = '<select data-wat-scope aria-label="목표 대상">' + opt('team', '*', '팀 전체')
    + (depts.length ? '<optgroup label="부서">' + depts.map(function (d) { return opt('dept', d, d); }).join('') + '</optgroup>' : '')
    + (ppl.length ? '<optgroup label="사람">' + ppl.map(function (n) { return opt('person', n, n); }).join('') + '</optgroup>' : '') + '</select>';
  var cur = (_watGet(e.scope, e.key) || {}).mix || {};
  var codes = _watCodes().concat(Object.keys(cur).filter(function (k) { return _watCodes().indexOf(k) < 0; }));
  var sum = codes.reduce(function (s, k) { return s + (+cur[k] || 0); }, 0);
  var row = _watGet(e.scope, e.key);
  return '<div class="wat-ed" id="watEd"><div class="wat-ed-h"><b>목표 대상</b> ' + sel
    + (row ? '<span class="wa-mut">' + eH(row.updatedName || '') + ' · ' + eH(String(row.updatedAt || '').slice(0, 10)) + '</span>' : '<span class="wa-mut">아직 없음</span>') + '</div>'
    + '<div class="wat-ins">' + codes.map(function (k) {
      return '<label class="wat-in"><span class="wa-sw" style="background:' + _waAbCol(k) + '"></span><span class="wat-k">' + eH(_waAbName(k)) + '</span><input type="number" inputmode="numeric" min="0" max="100" step="5" data-wat-k="' + eH(k) + '" value="' + (cur[k] ? cur[k] : '') + '" placeholder="–" aria-label="' + eH(_waAbName(k)) + ' 목표 %">%</label>';
    }).join('') + '</div>'
    + '<div class="wat-ed-f"><span class="wat-sumv' + (sum > 100 ? ' over' : '') + '" id="watSum">합 ' + sum + '%</span><span class="wa-mut">100% 가 안 돼도 됨 — 적은 분장만 비교</span>'
    + '<button type="button" data-wat-fill title="위 기간의 실제 비율로 채우기">실제로 채우기</button>'
    + (row ? '<button type="button" class="wat-del" data-wat-del>지우기</button>' : '')
    + '<button type="button" data-wat-close>닫기</button><button type="button" class="wat-save" data-wat-save' + (sum > 100 ? ' disabled' : '') + '>저장</button></div></div>';
}
function _watEdSum() {
  var t = 0; document.querySelectorAll('#watEd [data-wat-k]').forEach(function (i) { t += Math.max(0, Math.round(+i.value || 0)); });
  var s = document.getElementById('watSum'), b = document.querySelector('#watEd [data-wat-save]');
  if (s) { s.textContent = '합 ' + t + '%'; s.classList.toggle('over', t > 100); }
  if (b) b.disabled = t > 100;
  return t;
}
/* 실제로 채우기 — 반올림해도 합이 100 을 안 넘게(큰 나머지 순) */
function _watFill(A) {
  var e = WAT.ed, ab = {}, work = 0;
  if (e.scope === 'person') { var p = A.P[e.key]; if (p) { ab = p.ab; work = p.work; } }
  else if (e.scope === 'dept') { var d = _watDepts(A)[e.key]; if (d) { ab = d.ab; work = d.work; } }
  else { ab = A.ab; work = A.work; }
  var act = _watAct(ab, work), ks = Object.keys(act).filter(function (k) { return act[k] > 0; });
  var fl = {}, used = 0; ks.forEach(function (k) { fl[k] = Math.floor(act[k]); used += fl[k]; });
  var tgt = Math.min(100, Math.round(ks.reduce(function (s, k) { return s + act[k]; }, 0)));
  ks.sort(function (a, b) { return (act[b] - fl[b]) - (act[a] - fl[a]); }).forEach(function (k) { if (used < tgt) { fl[k]++; used++; } });
  document.querySelectorAll('#watEd [data-wat-k]').forEach(function (i) { var k = i.getAttribute('data-wat-k'); i.value = fl[k] ? fl[k] : ''; });
  _watEdSum();
}
function _watSave(del) {
  var e = WAT.ed; if (!e) return;
  var mix = {};
  if (!del) document.querySelectorAll('#watEd [data-wat-k]').forEach(function (i) { var v = Math.round(+i.value || 0); if (v > 0) mix[i.getAttribute('data-wat-k')] = v; });
  if (!del && _watEdSum() > 100) return;
  var b = document.querySelector('#watEd [data-wat-save]'); if (b) b.disabled = true;
  apiFetch('/api/wa-targets', { method: 'PUT', body: JSON.stringify({ scope: e.scope, key: e.key, mix: mix }) }).then(function (r) {
    WAT.rows = (WAT.rows || []).filter(function (x) { return !(x.scope === e.scope && x.key === e.key); });
    if (r && r.data) WAT.rows.push(r.data);
    if (typeof showToast === 'function') showToast(r && r.data ? '목표를 저장했습니다' : '목표를 지웠습니다');
    wa2Re('tgt');
  }).catch(function (err) {
    if (b) b.disabled = false;
    if (typeof showToast === 'function') showToast((err && err.message) || '저장하지 못했습니다', 'error');
  });
}

/* ═══ 🧷 한 사람 의존 ═══ */
var WAR_MIN_H = 16, WAR_SHARE = 80;
function _warItems(X) {
  var out = [];
  [['ord', X.O], ['cl', X.C]].forEach(function (z) {
    Object.keys(z[1]).forEach(function (k) {
      var o = z[1][k]; if (z[0] === 'cl' && k === '(미지정)') return;
      if (o.h < WAR_MIN_H) return;
      var ps = Object.keys(o.ph).sort(function (a, b) { return o.ph[b] - o.ph[a]; }), s = o.ph[ps[0]] / o.h * 100;
      if (s < WAR_SHARE) return;
      out.push({ t: z[0], k: k, nm: z[0] === 'ord' ? (o.nm || k) : k, sub: z[0] === 'ord' ? k + (o.cl && o.cl !== '(미지정)' ? ' · ' + o.cl : '') : '', h: o.h, p: ps[0], s: s, p2: ps[1] || '', s2: ps[1] ? o.ph[ps[1]] / o.h * 100 : 0, last: o.last });
    });
  });
  return out.sort(function (a, b) { return b.h - a.h; });
}
function warCard() {
  var D = _waLast && _waLast.dir, X = _wa2(D), mgr = _wsMgr(), me = _wsMe(), N = D ? D.N : WA.dN || 12;
  var head = '<div class="wa-h"><h4>🧷 한 사람 의존 <span class="wa-sub">최근 ' + N + '주 · ' + WAR_MIN_H + 'h 넘는 수주 · 업체 중 ' + WAR_SHARE + '% 넘게 한 사람이</span></h4>' + _waSaveBtn('waRiskC') + '</div>';
  if (!X) return '<section class="wa-card" id="waRiskC">' + head + '<div class="wa-empty">기록이 없습니다</div></section>';
  if (Object.keys(X.P).length < 2) return '<section class="wa-card" id="waRiskC">' + head + '<div class="wa-empty">위 팀원 필터에 2명 이상 있어야 볼 수 있습니다</div></section>';
  var all = _warItems(X), list = mgr ? all : all.filter(function (x) { return me.indexOf(x.p) >= 0; });
  if (!list.length) return '<section class="wa-card" id="waRiskC">' + head + '<div class="wa-empty">✅ ' + (mgr ? '한 사람에게 몰린 수주 · 업체 없음' : '내가 거의 혼자 맡은 수주 · 업체 없음') + '</div></section>';
  var by = {}; list.forEach(function (x) { by[x.p] = by[x.p] || { o: 0, c: 0, h: 0 }; by[x.p][x.t === 'ord' ? 'o' : 'c']++; by[x.p].h += x.h; });
  var sum = mgr ? '<div class="war-sum">' + Object.keys(by).sort(function (a, b) { return by[b].h - by[a].h; }).map(function (n) {
    return '<span class="war-pc" tabindex="0"' + _wsA('p:' + n) + '>' + eH(_wsSN(n)) + ' <span class="wa-mut">' + [by[n].o ? '수주 ' + by[n].o : '', by[n].c ? '업체 ' + by[n].c : ''].filter(Boolean).join(' · ') + '</span></span>';
  }).join('') + '</div>' : '';
  var MAX = 12, show = list.slice(0, MAX);
  var rows = show.map(function (x) {
    return '<tr' + _wsA((x.t === 'ord' ? 'ord:' : 'cl:') + x.k) + ' tabindex="0"><td class="wa-tn" title="' + eH(x.nm + (x.sub ? ' · ' + x.sub : '')) + '"><span class="war-t">' + (x.t === 'ord' ? '수주' : '업체') + '</span>' + eH(x.nm) + '</td>'
      + '<td><span class="war-pc"' + _wsA('p:' + x.p) + '>' + eH(_wsSN(x.p)) + '</span></td>'
      + '<td class="war-m"' + _waTip([_wa2Pc(x.s) + ' · ' + _waH(x.h * x.s / 100), x.p + (x.p2 ? ' · 다음 ' + x.p2 + ' ' + _wa2Pc(x.s2) : ' 혼자')]) + '><span class="war-bar"><i style="width:' + x.s.toFixed(1) + '%"></i></span><b>' + (x.s >= 99.5 ? '혼자' : _wa2Pc(x.s)) + '</b></td>'
      + '<td class="num">' + _waH(x.h) + '</td><td class="wa-mut">' + (x.p2 ? eH(_wsSN(x.p2)) + ' ' + _wa2Pc(x.s2) : '–') + '</td><td class="num wa-mut">' + _waMD(x.last) + '</td></tr>';
  }).join('');
  return '<section class="wa-card" id="waRiskC">' + head + sum
    + '<div class="wa-tw"><table class="wa-tbl war-tbl"><thead><tr><th>' + (mgr ? '수주 · 업체' : '내가 거의 혼자 맡은 것') + '</th><th>맡은 사람</th><th>비중</th><th class="num">시간</th><th>다음 사람</th><th class="num">마지막</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + (list.length > MAX ? '<div class="wa-note">외 ' + (list.length - MAX) + '개 — 시간 많은 순으로 ' + MAX + '개만</div>' : '')
    + '<div class="wa-note">그 사람이 빠지면 멈출 수 있는 일 — 두 번째 사람이 함께 보도록 나누기 · 인수인계 문서 확인</div></section>';
}

/* ═══ 🔀 업체 이동 — 최근 N주 앞 반 · 뒤 반 ═══ */
function _wavLong(X) {
  var n = X.wks.length, q = Math.max(1, Math.floor(n / 4)), bt = _wa2Sum(X.T, X.b), out = [];
  Object.keys(X.O).forEach(function (k) {
    var o = X.O[k], idx = X.wks.map(function (w, i) { return o.w[w] ? i : -1; }).filter(function (i) { return i >= 0; });
    if (!idx.length || idx[0] >= q || idx[idx.length - 1] < n - q || idx.length < n / 2) return;
    out.push({ k: k, nm: o.nm || k, wk: idx.length, hb: _wa2Sum(o.w, X.b) });
  });
  out.sort(function (a, b) { return b.hb - a.hb; });
  return { list: out, h: out.reduce(function (s, x) { return s + x.hb; }, 0), bt: bt };
}
function _wavDiv(d, mx) {
  var w = Math.min(50, Math.abs(d) / (mx || 1) * 50);
  return '<span class="wav-dv"><i class="' + (d >= 0 ? 'up' : 'dn') + '" style="width:' + w.toFixed(1) + '%;' + (d >= 0 ? 'left:50%' : 'right:50%') + '"></i></span>';
}
function wavCard() {
  var D = _waLast && _waLast.dir, X = _wa2(D), mgr = _wsMgr(), me = _wsMe(), N = D ? D.N : WA.dN || 12;
  var head = '<div class="wa-h"><h4>🔀 업체 이동 <span class="wa-sub">최근 ' + N + '주를 앞 · 뒤 반으로 · 휴가 제외</span></h4>' + _waSaveBtn('waMovC') + '</div>';
  var ta = X ? _wa2Sum(X.T, X.a) : 0, tb = X ? _wa2Sum(X.T, X.b) : 0;
  if (!X || !ta || !tb) return '<section class="wa-card" id="waMovC">' + head + '<div class="wa-empty">앞 · 뒤 반 모두 기록이 있어야 볼 수 있습니다 — 🧭 업무 방향에서 주 수를 늘려 보세요</div></section>';
  var cl = Object.keys(X.C).map(function (k) { var c = X.C[k], a = _wa2Sum(c.w, X.a), b = _wa2Sum(c.w, X.b); return { k: k, a: a, b: b, pa: a / ta * 100, pb: b / tb * 100 }; });
  var named = cl.filter(function (x) { return x.k !== '(미지정)'; });
  var rk = function (f) { var o = {}; named.filter(function (x) { return x[f] > 0; }).sort(function (x, y) { return y[f] - x[f]; }).forEach(function (x, i) { o[x.k] = i + 1; }); return o; };
  var ra = rk('a'), rb = rk('b');
  var newH = named.filter(function (x) { return !x.a && x.b; }).reduce(function (s, x) { return s + x.b; }, 0);
  var topA = named.slice().sort(function (x, y) { return y.a - x.a; })[0], topB = named.slice().sort(function (x, y) { return y.b - x.b; })[0];
  var lg = _wavLong(X);
  var tiles = '<div class="wa-tiles wav-tiles">'
    + _waTile('주력 업체', topB && topB.b ? eH(topB.k) : '–', topA && topA.a ? (topA.k === (topB && topB.k) ? '그대로' : '앞: ' + eH(topA.k)) : '', '', '최근 반에서 시간이 가장 많은 업체 (미지정 빼고)')
    + _waTile('새 업체 비중', _wa2Pc(newH / tb * 100), _waH(newH) + ' · 앞 반엔 없던 업체', '', '최근 반 업무 시간 중 앞 반엔 기록이 없던 업체의 비율')
    + _waTile('오래 붙잡힌 수주', _wa2Pc(lg.h / tb * 100), lg.list.length + '개 · 처음부터 끝까지', '', '최근 ' + N + '주 처음 · 끝 무렵에 모두 기록이 있고 절반 넘는 주에 나온 수주가 최근 반 시간에서 차지하는 비율')
    + '</div>';
  var list = named.filter(function (x) { return x.pa >= 1 || x.pb >= 1; }).sort(function (x, y) { return Math.max(y.pa, y.pb) - Math.max(x.pa, x.pb); }).slice(0, 10);
  var mx = Math.max.apply(null, list.map(function (x) { return Math.abs(x.pb - x.pa); }).concat([1]));
  var tbl = list.length ? '<div class="wa-tw"><table class="wa-tbl wav-tbl"><thead><tr><th>업체</th><th class="num">앞 ' + X.a.length + '주</th><th class="num">최근 ' + X.b.length + '주</th><th class="wav-dh">변화</th><th class="num">순위</th></tr></thead><tbody>'
    + list.map(function (x) {
      var d = x.pb - x.pa, st = !x.a ? '<span class="wav-new">새로</span>' : !x.b ? '<span class="wa-mut">빠짐</span>' : (ra[x.k] && rb[x.k] && ra[x.k] !== rb[x.k] ? '<span class="wa-mut">' + ra[x.k] + '→</span>' + rb[x.k] : rb[x.k] || '');
      return '<tr' + _wsA('cl:' + x.k) + ' tabindex="0"><td class="wa-tn" title="' + eH(x.k) + '">' + eH(x.k) + '</td><td class="num">' + (x.a ? _wa2Pc(x.pa) : '<span class="wa-mut">–</span>') + '</td><td class="num">' + (x.b ? _wa2Pc(x.pb) : '<span class="wa-mut">–</span>') + '</td>'
        + '<td class="wav-dc"' + _waTip([_wa2Pp(d), x.k + ' · ' + _waH(x.a) + ' → ' + _waH(x.b)]) + '>' + _wavDiv(d, mx) + '<span class="wav-dt">' + _wa2Pp(d) + '</span></td><td class="num">' + st + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '';
  var longs = lg.list.length ? '<div class="wap-mv"><span class="wa-mut">오래 붙잡힌 수주</span> ' + lg.list.slice(0, 3).map(function (x) { return '<span class="wap-o"' + _wsA('ord:' + x.k) + '>' + eH(x.nm) + ' <span class="wa-mut">' + x.wk + '주 · 최근 ' + _waH(x.hb) + '</span></span>'; }).join(' · ') + '</div>' : '';
  // 사람마다 — 주력 업체 앞 → 최근 · 새 업체 비중 · 크게 는 · 준 업체
  var ppl = Object.keys(X.P).filter(function (n) { return mgr || me.indexOf(n) >= 0; }).map(function (n) {
    var a = _wa2Pool(X.P[n], X.a), b = _wa2Pool(X.P[n], X.b); if (!a.t || !b.t) return null;
    var ks = Object.keys(a.c).concat(Object.keys(b.c)).filter(function (k, i, z) { return z.indexOf(k) === i && k !== '(미지정)'; });
    var ds = ks.map(function (k) { return { k: k, d: (b.c[k] || 0) / b.t * 100 - (a.c[k] || 0) / a.t * 100 }; }).sort(function (x, y) { return y.d - x.d; });
    var nw = ks.filter(function (k) { return !a.c[k] && b.c[k]; }).reduce(function (s, k) { return s + b.c[k]; }, 0) / b.t * 100;
    return { n: n, ta: _wa2Top(a.c), tb: _wa2Top(b.c), nw: nw, up: ds[0] && ds[0].d >= 5 ? ds[0] : null, dn: ds[ds.length - 1] && ds[ds.length - 1].d <= -5 ? ds[ds.length - 1] : null };
  }).filter(Boolean).sort(function (x, y) { return ((y.ta !== y.tb) - (x.ta !== x.tb)) || (y.nw - x.nw); });   // 주력이 바뀐 사람 먼저
  var ptbl = ppl.length ? '<div class="wad-sm-t">사람마다</div><div class="wa-tw"><table class="wa-tbl wav-ptbl"><thead><tr><th>이름</th><th>주력 업체 앞 → 최근</th><th class="num">새 업체</th><th>크게 는 업체</th><th>크게 준 업체</th></tr></thead><tbody>'
    + ppl.map(function (x) {
      return '<tr' + _wsA('p:' + x.n) + ' tabindex="0"><td class="wa-tn">' + eH(_wsSN(x.n)) + '</td><td>' + (x.ta === x.tb ? eH(x.tb || '–') + ' <span class="wa-mut">그대로</span>' : eH(x.ta || '–') + ' → <b>' + eH(x.tb || '–') + '</b>') + '</td>'
        + '<td class="num">' + (x.nw >= 1 ? _wa2Pc(x.nw) : '<span class="wa-mut">–</span>') + '</td><td>' + (x.up ? eH(x.up.k) + ' <span class="wa-mut">' + _wa2Pp(x.up.d) + '</span>' : '<span class="wa-mut">–</span>') + '</td><td>' + (x.dn ? eH(x.dn.k) + ' <span class="wa-mut">' + _wa2Pp(x.dn.d) + '</span>' : '<span class="wa-mut">–</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '';
  return '<section class="wa-card" id="waMovC">' + head + tiles + tbl + longs + ptbl
    + '<div class="wa-note">앞 ' + _wa2Rng(X.a) + ' · 최근 ' + _wa2Rng(X.b) + ' · 비중 = 그 반의 업무 시간 중 · 미지정 업체는 뺌</div></section>';
}

/* ═══ 🔎 한눈에 — 목표 · 의존 · 업체 이동 문장 ═══ */
function wa2Find(F, A) {
  var mgr = _wsMgr();
  // 목표
  if (WAT.rows && A && A.work) {
    var t = _watGet('team', '*');
    if (t) { var g = _watGap(_watAct(A.ab, A.work), t.mix)[0]; if (g && Math.abs(g.d) >= 10) F.push(['warn', '목표 대비: ' + _waAbName(g.k) + ' 목표 ' + g.t + '% · 실제 ' + Math.round(g.a) + '% (' + _wa2Pp(g.d) + ')']); }
    if (mgr) {
      Object.keys(A.P).map(function (n) {
        var p = A.P[n]; if (p.nd < 3) return null;
        var dept = Object.keys(p.dept || {}).sort(function (a, b) { return p.dept[b] - p.dept[a]; })[0], T = _watFor(n, dept); if (!T) return null;
        var gs = _watGap(_watAct(p.ab, p.work), T.mix), tot = gs.reduce(function (s, x) { return s + Math.abs(x.d); }, 0);
        return tot >= 30 ? { n: n, tot: tot, g: gs[0] } : null;
      }).filter(Boolean).sort(function (a, b) { return b.tot - a.tot; }).slice(0, 2).forEach(function (x) {
        F.push(['info', x.n + ' — 목표와 차이 ' + Math.round(x.tot) + '%p (' + _waAbName(x.g.k) + ' ' + _wa2Pp(x.g.d) + ')']);
      });
    }
  }
  if (typeof _waLite !== 'undefined' && _waLite) return;   // 처음 그릴 땐 아래 카드와 함께 (wr-analytics.js waRender)
  var D = _waLast && _waLast.dir, X = _wa2(D); if (!X) return;
  // 한 사람 의존
  if (mgr && Object.keys(X.P).length >= 2) {
    var it = _warItems(X);
    if (it.length) {
      var no = it.filter(function (x) { return x.t === 'ord'; }).length, nc = it.length - no;
      F.push(['warn', '한 사람 의존: ' + [no ? '수주 ' + no + '개' : '', nc ? '업체 ' + nc + '곳' : ''].filter(Boolean).join(' · ') + ' — 가장 큰 것 ' + it[0].nm + ' (' + it[0].p + ' ' + (it[0].s >= 99.5 ? '혼자' : _wa2Pc(it[0].s)) + ', ' + _waH(it[0].h) + ')']);
    }
  }
  // 업체 이동
  var ta = _wa2Sum(X.T, X.a), tb = _wa2Sum(X.T, X.b);
  if (ta >= 16 && tb >= 16) {
    var named = Object.keys(X.C).filter(function (k) { return k !== '(미지정)'; });
    var top = function (wks) { return named.slice().sort(function (x, y) { return _wa2Sum(X.C[y].w, wks) - _wa2Sum(X.C[x].w, wks); })[0]; };
    var a = top(X.a), b = top(X.b);
    var nw = named.filter(function (k) { return !_wa2Sum(X.C[k].w, X.a) && _wa2Sum(X.C[k].w, X.b); }).reduce(function (s, k) { return s + _wa2Sum(X.C[k].w, X.b); }, 0);
    var mv = [];   // 한 줄로 — 한눈에는 8줄까지만
    if (a && b && a !== b && _wa2Sum(X.C[b].w, X.b) > 0) mv.push('주력 업체 ' + a + ' → ' + b + ' (' + _wa2Pc(_wa2Sum(X.C[b].w, X.b) / tb * 100) + ')');
    if (nw / tb >= 0.2) mv.push('새 업체 비중 ' + _wa2Pc(nw / tb * 100) + ' (앞 반엔 없던 업체)');
    if (mv.length) F.push(['info', '업체 이동(최근 ' + X.b.length + '주): ' + mv.join(' · ')]);
  }
}

/* ─── 묶기 — 목표 고치는 칸 (한 번만, 상자에 위임) ─── */
function wa2Bind(box) {
  if (box._wa2B) return; box._wa2B = true;
  box.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-wat-ed],[data-wat-fill],[data-wat-save],[data-wat-del],[data-wat-close]');
    if (!t || !box.contains(t)) return;
    var L = _waLast; if (!L) return;
    if (t.hasAttribute('data-wat-ed')) { WAT.ed = WAT.ed ? null : { scope: 'team', key: '*' }; _wsRe('waTgtC', watCard(L.A)); var s = document.querySelector('#watEd select'); if (s) s.focus(); return; }
    if (t.hasAttribute('data-wat-close')) { WAT.ed = null; _wsRe('waTgtC', watCard(L.A)); wsApply(box); return; }
    if (t.hasAttribute('data-wat-fill')) { _watFill(L.A); return; }
    if (t.hasAttribute('data-wat-save')) { _watSave(false); return; }
    if (t.hasAttribute('data-wat-del')) {
      var lb = WAT.ed.scope === 'team' ? '팀 전체' : WAT.ed.key;
      Promise.resolve(typeof wmConfirm === 'function' ? wmConfirm(lb + ' 목표를 지울까요?') : true).then(function (ok) { if (ok) _watSave(true); });
    }
  });
  box.addEventListener('change', function (e) {
    if (!e.target.hasAttribute || !e.target.hasAttribute('data-wat-scope') || !_waLast) return;
    var v = e.target.value, i = v.indexOf(':');
    WAT.ed = { scope: v.slice(0, i), key: v.slice(i + 1) };
    _wsRe('waTgtC', watCard(_waLast.A));
    var s = document.querySelector('#watEd select'); if (s) s.focus();
  });
  box.addEventListener('input', function (e) { if (e.target.hasAttribute && e.target.hasAttribute('data-wat-k')) _watEdSum(); });
  box.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.hasAttribute && e.target.hasAttribute('data-wat-k')) { e.preventDefault(); _watSave(false); } });
}
