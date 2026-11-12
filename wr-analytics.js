/* wr-analytics.js — 업무일지 › 주간 분석 › 📊 분석 (v13.312)
 * 예전 차트 탭(도넛 2 · 일별 누적막대 2 · 월별 비교 2 — 고르고 "비교 분석"을 눌러야 보이던 것)을
 * "무엇을 봐야 하나"부터 읽히게 다시 짬:
 *   ① 숫자 — 업무 시간 · 인당 하루 평균 · 수주 투입률 · 상위 3개 수주 비중 · 업체 미지정 · 8h 미달 (지난 같은 길이 기간과 비교)
 *   ② 한눈에 — 규칙으로 뽑은 결론 (비중 변화 · 과부하/적음 · 업체 급증 · 80% 집중 · 데이터 확인)
 *   ③ 시간 구성 — 분장별 한 줄 막대(전체=100%) + 표 (지난 기간 대비 %p)
 *   ④ 날짜별 투입 — 분장별 쌓은 막대 + 인원×8h 기준선 (기간이 길면 주 단위)
 *   ⑤ 사람별 부하 — 하루 평균 막대(8h 눈금) · 분장 구성 · 주 수주
 *   ⑥ 어디에 — 업체 / 수주 순위 · 누적 %(80% 선) · 인원 · 일수 · 지난 기간 대비
 *   ⑦ 월별 추이 — 분장 / 사람 / 업체 × 최근 3·6·12개월 색 농도 표 + 인당 하루 평균 줄
 * 필터는 화면 위 공통 필터 그대로 (gF · wdApply) — 지난 기간 · 월별은 같은 필터를 다른 기간에 (wr-filters.js gfRange)
 * 의존(전역): aD, sN, sT, sO, sON, sCL, cKw, excludeVac, selWeek, AM, getABR, getOClient, getOCmt, eH, fD, gF, gfRange, wdApply, krHolidayName */
var WA = { dim: 'client', mDim: 'abbr', mN: 6, hideUn: false, sel: [], dN: 12, sy: 'ord', kSort: null };   // v13.459 sel = 강조(선택) · dN = 방향 추이 주 수 · sy = 사분면 세로축 · kSort = 개인 KPI 정렬
(function () { try { var s = JSON.parse(localStorage.getItem('wm-wa') || '{}'); ['dim', 'mDim', 'mN', 'hideUn', 'sel', 'dN', 'sy', 'kSort'].forEach(function (k) { if (s[k] != null) WA[k] = s[k]; }); } catch (e) {} })();
function _waSave() { try { localStorage.setItem('wm-wa', JSON.stringify({ dim: WA.dim, mDim: WA.mDim, mN: WA.mN, hideUn: WA.hideUn, sel: WA.sel, dN: WA.dN, sy: WA.sy, kSort: WA.kSort })); } catch (e) {} }

var WA_ST = { good: '#1a8a40', warn: '#c8730a', bad: '#d21f1f' };
var WA_GAP_COL = '#a3acb9';   // 8h 미달 — 분장 색과 겹치지 않는 회색
/* v13.459 강조(선택) — data-wa-sel="종류:키" (p 사람 · ab 분장 · cl 업체 · ord 수주 · dir 방향) · 동작은 wr-analytics-kpi.js */
function _wsA(k) { return ' data-wa-sel="' + eH(k) + '"'; }
function _wsPpl() { return (WA.sel || []).filter(function (x) { return x.slice(0, 2) === 'p:'; }).map(function (x) { return x.slice(2); }); }
function _wsPH(map) { var t = 0; _wsPpl().forEach(function (n) { t += (map && map[n]) || 0; }); return t; }   // 고른 사람들의 시간 합 (map = { 이름: 시간 })
function _wsNm() { var p = _wsPpl(); return p.length === 1 ? (typeof shortName === 'function' ? shortName(p[0]) : p[0]) : p.length + '명'; }
function _waR1(n) { return Math.round(n * 10) / 10; }
function _waH(n) { n = _waR1(n || 0); return (n >= 1000 ? Math.round(n).toLocaleString() : String(n)) + 'h'; }
function _waPct(a, b) { return b > 0 ? _waR1(a / b * 100) : 0; }
function _waD(s) { return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))); }
function _waS(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function _waAdd(s, n) { return _waS(new Date(_waD(s).getTime() + n * 86400000)); }
function _waMD(s) { return s.slice(4, 6) + '/' + s.slice(6, 8); }
function _waIsWork(s) {
  var w = _waD(s).getUTCDay(); if (w === 0 || w === 6) return false;
  return !(typeof krHolidayName === 'function' && krHolidayName(s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8)));
}
function _waVac(r) { if (r.abbr === 'V' || r.abbr === 'v') return true; var t = String(r.taskType || ''); return t.indexOf('휴가') >= 0 || t.indexOf('연차') >= 0 || t.indexOf('반차') >= 0; }
function _waIsOrd(no) { return /[A-Za-z]/.test(no || '') && /\d/.test(no || ''); }
function _waCl(r) { return r.oclient || (typeof getOClient === 'function' ? getOClient(r.orderNo) : '') || '(미지정)'; }
function _waAbName(k) { return (typeof AM !== 'undefined' && AM[k]) || k || '?'; }
function _waAbCol(k) { return typeof getABR === 'function' ? getABR(k) : '#64748B'; }
/* 색 위 글자 — 밝은 색엔 검정, 어두운 색엔 흰색 */
function _waInk(hex) {
  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return '#fff';
  var n = parseInt(m[1], 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  function lin(c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.36 ? '#111827' : '#fff';
}
function _waCodes() { return typeof AM !== 'undefined' ? Object.keys(AM) : []; }
/* 분장 필터 · 검색 · 휴가 제외 · 수주/업체 필터가 걸리면 '8h 미달'은 뜻이 없음 (예전 차트의 휴가 보정과 같은 기준) */
function _waGapOn() { return !cKw && !excludeVac && !sO.size && !sON.size && !sCL.size && !(sT.size && !sT.has('V')); }

/** 행 → 집계 */
function waAgg(rows, rg) {
  var A = { n: rows.length, total: 0, vac: 0, work: 0, ord: 0, unCl: 0, gap: 0, gapDays: 0, ab: {}, P: {}, C: {}, O: {}, D: {}, pd: {}, wd: 0, rg: rg };
  for (var d = rg.s; d <= rg.e; d = _waAdd(d, 1)) if (_waIsWork(d)) A.wd++;
  rows.forEach(function (r) {
    var h = +r.hours || 0, ab = r.abbr || '?';
    A.total += h; A.ab[ab] = (A.ab[ab] || 0) + h;
    var p = A.P[r.name] || (A.P[r.name] = { k: r.name, h: 0, work: 0, vac: 0, days: {}, ab: {}, ord: {}, rd: {}, dh: {}, dord: {}, nr: 0, short: 0, dept: {} });
    p.h += h; p.ab[ab] = (p.ab[ab] || 0) + h; p.rd[r.date] = 1; if (r.dept) p.dept[r.dept] = (p.dept[r.dept] || 0) + 1;
    var dy = A.D[r.date] || (A.D[r.date] = { d: r.date, h: 0, ab: {}, ppl: {}, ph: {} });
    dy.h += h; dy.ab[ab] = (dy.ab[ab] || 0) + h; dy.ppl[r.name] = 1; dy.ph[r.name] = (dy.ph[r.name] || 0) + h;
    var key = r.name + '\u0001' + r.date; A.pd[key] = (A.pd[key] || 0) + h;
    if (_waVac(r)) { A.vac += h; p.vac += h; return; }
    A.work += h; p.work += h; p.days[r.date] = 1; p.dh[r.date] = (p.dh[r.date] || 0) + h;
    p.nr++; if (String(r.content || '').replace(/s+/g, '').length < 10) p.short++;
    var c = _waCl(r), C = A.C[c] || (A.C[c] = { k: c, h: 0, ppl: {}, days: {}, ph: {} });
    C.h += h; C.ppl[r.name] = 1; C.days[r.date] = 1; C.ph[r.name] = (C.ph[r.name] || 0) + h;
    if (c === '(미지정)') A.unCl += h;
    var no = r.orderNo || '';
    if (_waIsOrd(no)) {
      A.ord += h; p.ord[no] = (p.ord[no] || 0) + h; (p.dord[r.date] || (p.dord[r.date] = {}))[no] = 1;
      var o = A.O[no] || (A.O[no] = { k: no, nm: r.ocmt || (typeof getOCmt === 'function' ? getOCmt(no) : '') || '', cl: c, h: 0, ppl: {}, days: {}, ph: {} });
      o.h += h; o.ppl[r.name] = 1; o.days[r.date] = 1; o.ph[r.name] = (o.ph[r.name] || 0) + h;
    }
  });
  Object.keys(A.pd).forEach(function (k) {
    if (!_waIsWork(k.split('\u0001')[1])) return;
    var g = 8 - A.pd[k]; if (g > 0.05) { A.gap += g; A.gapDays++; }
  });
  A.people = Object.keys(A.P).length;
  A.pDays = 0; Object.keys(A.P).forEach(function (n) { var p = A.P[n]; p.nd = Object.keys(p.days).length; p.avg = p.nd ? p.work / p.nd : 0; A.pDays += p.nd; });
  A.avg = A.pDays ? A.work / A.pDays : 0;
  var os = Object.keys(A.O).map(function (k) { return A.O[k]; }).sort(function (a, b) { return b.h - a.h; });
  A.ordList = os;
  A.top3 = os.slice(0, 3).reduce(function (s, o) { return s + o.h; }, 0);
  return A;
}

function _waRange(f) {
  if (selWeek && selWeek.start && selWeek.end) return { s: selWeek.start, e: selWeek.end };
  var ds = f.map(function (r) { return r.date; }).sort();
  return { s: ds[0], e: ds[ds.length - 1] };
}
/** 지난 기간 — 달 단위(1일~말일)면 그 앞 같은 수의 달, 아니면 주 단위로 통째 이동 (월~금이면 지난주 월~금) */
function waPrevRange(rg) {
  var s = _waD(rg.s), e = _waD(rg.e), e1 = new Date(e.getTime() + 86400000);
  if (s.getUTCDate() === 1 && e1.getUTCDate() === 1) {
    var n = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth() + 1;
    var ps = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - n, 1)), pe = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 0));
    return { s: _waS(ps), e: _waS(pe) };
  }
  var len = Math.round((e - s) / 86400000) + 1, sh = Math.ceil(len / 7) * 7;
  return { s: _waAdd(rg.s, -sh), e: _waAdd(rg.e, -sh) };
}
function _waRows(rows) { return typeof wdApply === 'function' ? wdApply(rows) : rows; }

var _waLast = null;
/* v13.405 창 크기가 바뀌면 그래프를 새 폭으로 다시 그림 — 넓을 때 그린 그래프(고정 px)가 줄인 창에서 그대로 남아 화면이 옆으로 길어지던 것 */
var _waRO = null, _waW = 0, _waROT = null;
function _waWatch() {
  var box = document.getElementById('waBox'); if (!box || typeof ResizeObserver === 'undefined') return;
  if (!_waRO) _waRO = new ResizeObserver(function (en) {
    var w = Math.round(en[0].contentRect.width); if (!w || Math.abs(w - _waW) < 40) return;
    clearTimeout(_waROT);
    _waROT = setTimeout(function () { var b = document.getElementById('waBox'); if (_waLast && b && b.offsetParent) { _waW = Math.round(b.clientWidth); waRender(_waLast.f); } }, 180);
  });
  _waRO.disconnect(); _waRO.observe(box); _waW = Math.round(box.clientWidth);
}
/** 📊 분석 그리기 — upV · sTab 에서 (f = 지금 필터 결과) */
function waRender(f) {
  var box = document.getElementById('waBox'); if (!box) return;
  f = f || _waRows(gF());
  if (!f.length) { box.innerHTML = '<div class="wa-empty">' + (sN.size ? '필터 조건에 맞는 기록이 없습니다' : '팀원을 고르면 분석이 나옵니다') + '</div>'; return; }
  var rg = _waRange(f);
  var A = waAgg(f, rg), P = null, prg = null;
  if (selWeek && typeof gfRange === 'function') {   // 지난 같은 길이 기간 (전체 기간이면 비교 없음)
    prg = waPrevRange(rg);
    var pr = _waRows(gfRange(prg.s, prg.e));
    if (pr.length) P = waAgg(pr, prg);
  }
  _waLast = { f: f, A: A, P: P, rg: rg, prg: prg };
  if (typeof wadData === 'function') _waLast.dir = wadData(rg);   // v13.459 업무 방향 (최근 N주) — 한눈에 문장에도 씀
  setTimeout(_waWatch, 0);
  var gapOn = _waGapOn();
  box.innerHTML = ''
    + '<div class="wa-scope">' + _waMD(rg.s) + ' ~ ' + _waMD(rg.e) + ' · 평일 ' + A.wd + '일 · ' + A.people + '명 · ' + A.n.toLocaleString() + '건'
    + (P ? ' <span class="wa-vs">비교: 지난 기간 ' + _waMD(prg.s) + ' ~ ' + _waMD(prg.e) + '</span>' : selWeek ? ' <span class="wa-vs">지난 기간 기록 없음 — 비교 생략</span>' : ' <span class="wa-vs">전체 기간 — 주 · 기간을 고르면 지난 기간과 비교</span>') + '</div>'
    + (typeof wsBar === 'function' ? wsBar() : '')
    + _waTiles(A, P, gapOn)
    + _waFind(A, P, gapOn)
    + '<div class="wa-g2">' + _waMix(A, P, gapOn) + _waPeople(A) + '</div>'
    + (typeof wakCard === 'function' ? wakCard(A, P) : '')
    + (typeof wapCard === 'function' ? wapCard(A) : '')   // v13.460 고른 한 사람 자세히
    + (typeof wadCard === 'function' ? '<div class="wa-g2 wa-g2r">' + waqCard(A) + wadCard() + '</div>' : '')
    + (typeof watCard === 'function' ? watCard(A) + '<div class="wa-g2 wa-g2r">' + warCard() + wavCard() + '</div>' : '')
    + _waDaily(A, gapOn)
    + _waTop(A, P)
    + '<div id="waMonth">' + _waMonth(rg) + '</div>';
  _waBind(box);
  if (typeof wsBind === 'function') wsBind(box);
  if (typeof wa2Bind === 'function') wa2Bind(box);
}

/* ─── ① 숫자 ─── */
function _waDelta(cur, prev, kind, good) {   // kind: 'pct'(변화율) | 'pp'(%p) | 'h' ; good: 1 오르면 좋음 · -1 내리면 좋음 · 0 중립
  if (prev == null) return '';
  var d = kind === 'pct' ? (prev > 0 ? _waR1((cur - prev) / prev * 100) : null) : _waR1(cur - prev);
  if (d == null) return '';
  if (Math.abs(d) < (kind === 'h' ? 0.1 : 0.5)) return '<span class="wa-dl">— 지난 기간과 같음</span>';
  var up = d > 0, col = !good ? 'var(--t4)' : (up === (good > 0) ? WA_ST.good : WA_ST.bad);
  return '<span class="wa-dl" style="color:' + col + '">' + (up ? '▲ ' : '▼ ') + Math.abs(d) + (kind === 'pct' ? '%' : kind === 'pp' ? '%p' : 'h') + '</span>';
}
function _waTile(label, val, sub, delta, tip, flag) {
  return '<div class="wa-t"' + (tip ? ' title="' + eH(tip) + '"' : '') + '><div class="wa-tl">' + label + '</div><div class="wa-tv">' + val + (flag || '') + '</div>'
    + '<div class="wa-ts">' + (delta || '') + (sub ? '<span>' + sub + '</span>' : '') + '</div></div>';
}
function _waTiles(A, P, gapOn) {
  var ordR = _waPct(A.ord, A.work), t3 = _waPct(A.top3, A.ord), un = _waPct(A.unCl, A.work);
  var avgFlag = A.avg > 9.5 ? ' <span class="wa-flag" style="color:' + WA_ST.bad + '">▲ 과부하</span>' : (A.avg && A.avg < 6 ? ' <span class="wa-flag" style="color:' + WA_ST.warn + '">▼ 적음</span>' : '');
  return '<div class="wa-tiles">'
    + _waTile('업무 시간', _waH(A.work), '휴가 ' + _waH(A.vac), _waDelta(A.work, P && P.work, 'pct', 0), '휴가를 뺀 기록 시간의 합')
    + _waTile('인당 하루 평균', _waR1(A.avg) + 'h', '기준 8h · ' + A.pDays + '인·일', _waDelta(A.avg, P && P.avg, 'h', 0), '휴가 뺀 업무 시간 ÷ 사람마다 기록한 날 수의 합', avgFlag)
    + _waTile('수주 투입률', ordR + '%', '공통 · 기타 ' + _waR1(100 - ordR) + '%', _waDelta(ordR, P && _waPct(P.ord, P.work), 'pp', 1), '수주번호(영문+숫자)가 있는 기록의 시간 비율')
    + _waTile('상위 3개 수주', t3 + '%', A.ordList[0] ? eH(A.ordList[0].nm || A.ordList[0].k) + ' ' + _waPct(A.ordList[0].h, A.ord) + '%' : '-', _waDelta(t3, P && _waPct(P.top3, P.ord), 'pp', 0), '수주 시간 중 가장 많은 3개 수주가 차지하는 비율 — 높을수록 몇 건에 몰림')
    + _waTile('업체 미지정', un + '%', _waH(A.unCl), _waDelta(un, P && _waPct(P.unCl, P.work), 'pp', -1), '업체를 알 수 없는 기록의 시간 비율 — 수주번호 · 업체 확인 필요')
    + (gapOn ? _waTile('8h 미달', _waH(A.gap), A.gapDays + '인·일 · 반차 · 미기록', _waDelta(A.gap, P && P.gap, 'h', -1), '평일에 기록한 날 중 합이 8h 가 안 되는 만큼 (예전 차트는 휴가로 채워 넣었음)') : '')
    + '</div>';
}

/* ─── ② 한눈에 ─── */
function _waFind(A, P, gapOn) {
  var F = [];
  // 분장 비중 변화
  if (P && P.total) {
    var best = null;
    _waCodes().forEach(function (k) {
      if (k === 'V') return;   // 휴가는 비중 변화로 말할 게 없음 — 업무 시간 안에서만
      var a = _waPct(A.ab[k] || 0, A.work), b = _waPct(P.ab[k] || 0, P.work), d = _waR1(a - b);
      if (!best || Math.abs(d) > Math.abs(best.d)) best = { k: k, a: a, b: b, d: d };
    });
    if (best && Math.abs(best.d) >= 5) F.push(['info', _waAbName(best.k) + ' 비중 ' + best.b + '% → ' + best.a + '% (' + (best.d > 0 ? '+' : '') + best.d + '%p · 휴가 뺀 업무 시간 중)']);
    // 업체 급증 · 급감
    var mv = Object.keys(A.C).concat(Object.keys(P.C)).filter(function (k, i, a) { return a.indexOf(k) === i && k !== '(미지정)'; }).map(function (k) {
      var a = (A.C[k] || {}).h || 0, b = (P.C[k] || {}).h || 0; return { k: k, a: a, b: b, d: a - b };
    }).sort(function (x, y) { return Math.abs(y.d) - Math.abs(x.d); })[0];
    if (mv && Math.abs(mv.d) >= 8 && Math.abs(mv.d) >= Math.max(mv.a, mv.b) * 0.4) F.push(['info', '업체 ' + mv.k + ' 투입 ' + (mv.d > 0 ? '늘어남' : '줄어듦') + ' ' + _waH(mv.b) + ' → ' + _waH(mv.a)]);
    var dw = A.work - P.work;
    if (P.work && Math.abs(dw) / P.work >= 0.15) F.push(['info', '업무 시간 ' + (dw > 0 ? '+' : '') + _waR1(dw / P.work * 100) + '% (' + _waH(P.work) + ' → ' + _waH(A.work) + ')' + (A.people !== P.people ? ' · 인원 ' + P.people + ' → ' + A.people + '명' : '')]);
  }
  // 사람별 부하
  Object.keys(A.P).map(function (n) { return A.P[n]; }).filter(function (p) { return p.nd >= 3; }).sort(function (a, b) { return b.avg - a.avg; }).forEach(function (p) {
    if (p.avg > 9.5) F.push(['bad', p.k + ' 하루 평균 ' + _waR1(p.avg) + 'h — 과부하 (' + p.nd + '일)']);
    else if (p.avg < 6) F.push(['warn', p.k + ' 하루 평균 ' + _waR1(p.avg) + 'h — 기록이 빠졌는지 확인 (' + p.nd + '일)']);
  });
  // 80% 집중
  if (A.ordList.length >= 4) {
    var cum = 0, n80 = 0;
    for (var i = 0; i < A.ordList.length; i++) { cum += A.ordList[i].h; n80 = i + 1; if (cum >= A.ord * 0.8) break; }
    F.push([n80 <= 2 ? 'warn' : 'info', '수주 ' + A.ordList.length + '개 중 ' + n80 + '개가 수주 시간의 80% — ' + A.ordList.slice(0, Math.min(n80, 3)).map(function (o) { return o.nm || o.k; }).join(', ')]);
  }
  var un = _waPct(A.unCl, A.work);
  if (un >= 10) F.push(['warn', '업체 미지정 ' + un + '% (' + _waH(A.unCl) + ') — 수주번호 · 업체를 채우면 업체별 분석이 정확해짐']);
  if (gapOn && A.wd && A.gap >= A.people * 4) F.push(['warn', '8h 미달 ' + _waH(A.gap) + ' (' + A.gapDays + '인·일) — 반차 · 미기록 확인']);
  // 가장 바쁜 날
  var days = Object.keys(A.D).map(function (d) { return A.D[d]; });
  if (days.length >= 3) {
    var top = days.slice().sort(function (a, b) { return b.h / Object.keys(b.ppl).length - a.h / Object.keys(a.ppl).length; })[0], per = top.h / Object.keys(top.ppl).length;
    if (per > 9.5) F.push(['warn', '가장 바쁜 날 ' + _waMD(top.d) + ' — 인당 ' + _waR1(per) + 'h']);
  }
  if (typeof wadFind === 'function') wadFind(F);
  if (typeof wa2Find === 'function') wa2Find(F, A);   // v13.460 목표 · 의존 · 업체 이동
  if (!F.length) F.push(['good', '눈에 띄는 쏠림 · 과부하 없음']);
  if (typeof wsFindSort === 'function') F = wsFindSort(F);
  var ic = { bad: '⛔', warn: '⚠️', info: '•', good: '✅' };
  return '<section class="wa-card wa-find" id="waFindC"><div class="wa-h"><h4>🔎 한눈에</h4></div><ul>'
    + F.slice(0, 8).map(function (x) { return '<li' + (x[2] ? ' class="wa-fsel"' : '') + '><span class="wa-fi" style="color:' + (WA_ST[x[0]] || 'var(--t5)') + '">' + ic[x[0]] + '</span>' + eH(x[1]) + '</li>'; }).join('') + '</ul></section>';
}

function _waSaveBtn(id) {
  return '<div class="cht-save-wrap"><button class="cht-save-btn" onclick="toggleChartMenu(this)">📷 저장</button><div class="cht-save-menu" data-target="' + id + '"></div></div>';
}
function _waTip(lines) { return ' tabindex="0" data-tip="' + eH(lines.join('\n')) + '"'; }

/* ─── ③ 시간 구성 (분장) ─── */
function _waMix(A, P, gapOn) {
  var parts = _waCodes().concat(Object.keys(A.ab).filter(function (k) { return _waCodes().indexOf(k) < 0; }))
    .map(function (k) { return { k: k, n: _waAbName(k), h: A.ab[k] || 0, c: _waAbCol(k) }; }).filter(function (x) { return x.h > 0; })
    .sort(function (a, b) { return b.h - a.h; });
  if (gapOn && A.gap > 0) parts.push({ k: '_gap', n: '8h 미달', h: A.gap, c: WA_GAP_COL });
  var tot = parts.reduce(function (s, x) { return s + x.h; }, 0) || 1;
  var sp = _wsPpl().length, sh = function (k) { return sp && k !== '_gap' ? _wsPH(Object.keys(A.P).reduce(function (o, n) { o[n] = A.P[n].ab[k] || 0; return o; }, {})) : 0; };
  var bar = '<div class="wa-seg" role="img" aria-label="분장별 시간 구성">' + parts.map(function (x) {
    var p = x.h / tot * 100, s = sh(x.k);
    return '<div class="wa-sg" style="flex:' + x.h + ' 1 0;background:' + x.c + '"' + (x.k !== '_gap' ? _wsA('ab:' + x.k) : '') + _waTip([_waH(x.h) + ' · ' + _waR1(p) + '%', x.n].concat(sp && x.k !== '_gap' ? ['선택(' + _wsNm() + ') ' + _waH(s) + ' · ' + _waPct(s, x.h) + '%'] : [])) + '>' + (sp && s > 0 ? '<i class="wa-ov" style="width:' + Math.min(100, s / x.h * 100).toFixed(1) + '%"></i>' : '') + (p >= 8 ? '<span style="color:' + _waInk(x.c) + '">' + Math.round(p) + '%</span>' : '') + '</div>';
  }).join('') + '</div>';
  var pt = P ? (P.total + (gapOn ? P.gap : 0)) : 0;
  var rows = parts.map(function (x) {
    var p = _waR1(x.h / tot * 100), d = '';
    if (P) { var pv = x.k === '_gap' ? P.gap : (P.ab[x.k] || 0), dp = _waR1(p - (pt ? pv / pt * 100 : 0)); d = Math.abs(dp) < 0.5 ? '<span class="wa-mut">–</span>' : '<span class="wa-mut">' + (dp > 0 ? '▲' : '▼') + Math.abs(dp) + '%p</span>'; }
    var s = sh(x.k);
    return '<tr' + (x.k !== '_gap' ? _wsA('ab:' + x.k) : '') + '><td><span class="wa-sw" style="background:' + x.c + '"></span>' + eH(x.n) + '</td><td class="num">' + _waH(x.h) + '</td><td class="num">' + p + '%</td>' + (P ? '<td class="num">' + d + '</td>' : '') + (sp ? '<td class="num wa-selc">' + (s ? _waH(s) : '') + '</td>' : '') + '</tr>';
  }).join('');
  return '<section class="wa-card" id="waMixC"><div class="wa-h"><h4>🧩 시간 구성 <span class="wa-sub">분장별 · 전체 = 100%</span></h4>' + _waSaveBtn('waMixC') + '</div>' + bar
    + '<table class="wa-tbl"><thead><tr><th>분장</th><th class="num">시간</th><th class="num">비중</th>' + (P ? '<th class="num">지난 기간 대비</th>' : '') + (sp ? '<th class="num wa-selc" title="고른 사람의 시간">' + eH(_wsNm()) + '</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + (gapOn && A.gap > 0 ? '<div class="wa-note">8h 미달 = 평일 기록이 8h 에 못 미친 만큼 (반차 · 미기록 추정)</div>' : '') + '</section>';
}

/* ─── ⑤ 사람별 부하 ─── */
function _waPeople(A) {
  var ps = Object.keys(A.P).map(function (n) { return A.P[n]; }).sort(function (a, b) { return b.work - a.work; });
  var MAX = 12;
  var rows = ps.map(function (p) {
    var st = p.avg > 9.5 ? ['bad', '▲'] : p.avg && p.avg < 6 ? ['warn', '▼'] : null;
    var col = st ? WA_ST[st[0]] : 'var(--ac)';
    var mix = Object.keys(p.ab).sort(function (a, b) { return p.ab[b] - p.ab[a]; }).map(function (k) {
      return '<i style="flex:' + p.ab[k] + ' 1 0;background:' + _waAbCol(k) + '"' + _waTip([_waH(p.ab[k]) + ' · ' + _waPct(p.ab[k], p.h) + '%', _waAbName(k)]) + '></i>';
    }).join('');
    var to = Object.keys(p.ord).sort(function (a, b) { return p.ord[b] - p.ord[a]; })[0];
    var tn = to ? ((A.O[to] && A.O[to].nm) || to) : '';
    var dn = typeof shortName === 'function' ? shortName(p.k) : p.k;
    return '<div class="wa-pr"' + _wsA('p:' + p.k) + '><div class="wa-pn" title="' + eH(p.k) + '">' + eH(dn) + '</div>'
      + '<div class="wa-pm"' + _waTip([_waR1(p.avg) + 'h / 일', p.k + ' · ' + p.nd + '일 · 업무 ' + _waH(p.work) + (p.vac ? ' · 휴가 ' + _waH(p.vac) : '')]) + '><div class="wa-mt"><i style="width:' + Math.min(100, p.avg / MAX * 100) + '%;background:' + col + '"></i><b style="left:' + (8 / MAX * 100) + '%"></b></div>'
      + '<span class="wa-pv">' + (st ? '<em style="color:' + col + '">' + st[1] + '</em>' : '') + _waR1(p.avg) + 'h</span></div>'
      + '<div class="wa-pmx">' + mix + '</div>'
      + '<div class="wa-po" title="' + eH(tn) + '">' + (to ? eH(tn) + ' <span class="wa-mut">' + _waPct(p.ord[to], p.work) + '%</span>' : '<span class="wa-mut">수주 없음</span>') + '</div>'
      + '<div class="wa-ph num">' + _waH(p.work) + '</div></div>';
  }).join('');
  return '<section class="wa-card" id="waPplC"><div class="wa-h"><h4>👤 사람별 부하 <span class="wa-sub">하루 평균 · 눈금 = 8h</span></h4>' + _waSaveBtn('waPplC') + '</div>'
    + '<div class="wa-ph-h"><span>이름</span><span>하루 평균</span><span>분장 구성</span><span>가장 많이 한 수주</span><span class="num">업무 시간</span></div>'
    + '<div class="wa-pl">' + rows + '</div>'
    + '<div class="wa-note"><span style="color:' + WA_ST.bad + '">▲</span> 9.5h 넘음 · <span style="color:' + WA_ST.warn + '">▼</span> 6h 안 됨 (기록 누락 확인) · 휴가 뺀 업무 시간 ÷ 기록한 날</div></section>';
}

/* ─── ④ 날짜별 투입 ─── */
function _waBuckets(A) {
  var rg = A.rg, days = [], d;
  for (d = rg.s; d <= rg.e; d = _waAdd(d, 1)) if (_waIsWork(d) || A.D[d]) days.push(d);
  var weekly = days.length > 31;
  var B = [], map = {};
  days.forEach(function (x) {
    var k = x;
    if (weekly) { var w = _waD(x).getUTCDay(); k = _waAdd(x, -((w + 6) % 7)); }
    var b = map[k];
    if (!b) { b = map[k] = { k: k, h: 0, ab: {}, wd: 0, ppl: {}, ph: {}, off: !_waIsWork(x) }; B.push(b); }
    if (_waIsWork(x)) { b.wd++; b.off = false; }
    var D = A.D[x]; if (!D) return;
    b.h += D.h; Object.keys(D.ab).forEach(function (a) { b.ab[a] = (b.ab[a] || 0) + D.ab[a]; });
    Object.keys(D.ppl).forEach(function (p) { b.ppl[p] = 1; b.ph[p] = (b.ph[p] || 0) + (D.ph[p] || 0); });
  });
  B.forEach(function (b) { b.cap = b.wd * A.people * 8; });
  return { B: B, weekly: weekly };
}
function _waNice(m) { var p = Math.pow(10, Math.floor(Math.log10(m || 1))), n = m / p; var s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10; return s * p; }
function _waColPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return 'M' + x + ' ' + (y + h) + 'V' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + r) + 'V' + (y + h) + 'Z';
}
function _waDaily(A, gapOn) {
  var bk = _waBuckets(A), B = bk.B;
  if (!B.length) return '';
  var box = document.getElementById('waBox'), W = Math.max(320, (box ? box.clientWidth : 900) - 34), H = 230, L = 40, R = 8, T = 10, Bt = 30;
  var cw = W - L - R, ch = H - T - Bt, n = B.length, step = cw / n, bw = Math.max(4, Math.min(24, step * 0.62));
  var max = Math.max.apply(null, B.map(function (b) { return Math.max(b.h, b.cap); }).concat([1]));
  var tick = _waNice(max / 4), top = Math.ceil(max / tick) * tick;
  function y(v) { return T + ch - v / top * ch; }
  var codes = _waCodes().filter(function (k) { return B.some(function (b) { return b.ab[k]; }); });
  // v13.341 분장 설정에 없는 약자도 쌓음 (예전엔 빠져서 막대가 비어 보임 — 시간 구성 카드엔 나오는데)
  B.forEach(function (b) { Object.keys(b.ab).forEach(function (k) { if (codes.indexOf(k) < 0) codes.push(k); }); });
  var s = '<svg class="wa-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="날짜별 투입 시간">';
  for (var t = 0; t <= top + 0.001; t += tick) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" class="wa-grid"/><text x="' + (L - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" class="wa-ax" text-anchor="end">' + _waR1(t) + '</text>';
  var lblEvery = Math.ceil(n / Math.max(1, Math.floor(cw / 46)));
  B.forEach(function (b, i) {
    var x = L + i * step + (step - bw) / 2, base = y(0), segs = [];
    codes.forEach(function (k) { if (b.ab[k]) segs.push([k, b.ab[k]]); });
    var cy = base;
    segs.forEach(function (sg, j) {
      var hh = sg[1] / top * ch, gap = j < segs.length - 1 && hh > 3 ? 2 : 0;
      cy -= hh;
      s += j === segs.length - 1 ? '<path d="' + _waColPath(x, cy, bw, hh, 3) + '" fill="' + _waAbCol(sg[0]) + '"' + _wsA('ab:' + sg[0]) + '/>' : '<rect x="' + x.toFixed(1) + '" y="' + (cy + gap).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, hh - gap).toFixed(1) + '" fill="' + _waAbCol(sg[0]) + '"' + _wsA('ab:' + sg[0]) + '/>';
    });
    if (b.cap) s += '<line x1="' + (L + i * step + 2).toFixed(1) + '" x2="' + (L + (i + 1) * step - 2).toFixed(1) + '" y1="' + y(b.cap).toFixed(1) + '" y2="' + y(b.cap).toFixed(1) + '" class="wa-cap"/>';
    if (i % lblEvery === 0) s += '<text x="' + (L + i * step + step / 2).toFixed(1) + '" y="' + (H - 12) + '" class="wa-ax' + (b.off ? ' off' : '') + '" text-anchor="middle">' + _waMD(b.k) + '</text>';
    if (_wsPpl().length) { var sv = _wsPH(b.ph); b._sy = y(sv); b._sx = L + i * step + step / 2; }
    var tip = [_waH(b.h) + (b.cap ? ' / 기준 ' + _waH(b.cap) + ' (' + _waPct(b.h, b.cap) + '%)' : ''), (bk.weekly ? _waMD(b.k) + ' 주' : _waMD(b.k) + (b.off ? ' (휴일)' : '')) + ' · ' + Object.keys(b.ppl).length + '명']
      .concat(segs.slice().reverse().map(function (sg) { return _waAbName(sg[0]) + '  ' + _waH(sg[1]); }))
      .concat(_wsPpl().length ? ['선택(' + _wsNm() + ')  ' + _waH(_wsPH(b.ph))] : []);
    s += '<rect class="wa-hit" x="' + (L + i * step).toFixed(1) + '" y="' + T + '" width="' + step.toFixed(1) + '" height="' + ch + '"' + _waTip(tip) + '/>';
  });
  if (_wsPpl().length) {   // v13.459 고른 사람의 투입 — 진한 선 + 점 (팀 막대 위에)
    var pts = B.filter(function (b) { return b._sx != null; });
    s += '<path class="wa-selln" d="' + pts.map(function (b, i) { return (i ? 'L' : 'M') + b._sx.toFixed(1) + ' ' + b._sy.toFixed(1); }).join('') + '"/>';
    pts.forEach(function (b) { s += '<circle class="wa-seldot" cx="' + b._sx.toFixed(1) + '" cy="' + b._sy.toFixed(1) + '" r="4"/>'; });
  }
  s += '</svg>';
  var legend = '<div class="wa-lg">' + codes.map(function (k) { return '<span class="wa-lgk"' + _wsA('ab:' + k) + '><i style="background:' + _waAbCol(k) + '"></i>' + eH(_waAbName(k)) + '</span>'; }).join('') + '<span><i class="ln"></i>기준 = 인원 × 8h × 평일</span>' + (_wsPpl().length ? '<span><i class="ln sel"></i>선택(' + eH(_wsNm()) + ')</span>' : '') + '</div>';
  var tbl = '<details class="wa-tview"><summary>표로 보기</summary><div class="wa-tw"><table class="wa-tbl"><thead><tr><th>' + (bk.weekly ? '주' : '날짜') + '</th><th class="num">합계</th><th class="num">기준</th>' + codes.map(function (k) { return '<th class="num">' + eH(k) + '</th>'; }).join('') + '</tr></thead><tbody>'
    + B.map(function (b) { return '<tr><td>' + _waMD(b.k) + '</td><td class="num">' + _waR1(b.h) + '</td><td class="num">' + _waR1(b.cap) + '</td>' + codes.map(function (k) { return '<td class="num">' + (b.ab[k] ? _waR1(b.ab[k]) : '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details>';
  return '<section class="wa-card" id="waDayC"><div class="wa-h"><h4>📅 ' + (bk.weekly ? '주별' : '날짜별') + ' 투입 <span class="wa-sub">분장별로 쌓음 · 짧은 가로선 = 기준 시간</span></h4>' + _waSaveBtn('waDayC') + '</div>'
    + legend + '<div class="wa-chart">' + s + '</div>' + tbl + '</section>';
}

/* ─── ⑥ 어디에 — 업체 / 수주 순위 ─── */
function _waTop(A, P) {
  var isCl = WA.dim !== 'order';
  var src = isCl ? A.C : A.O, prv = P ? (isCl ? P.C : P.O) : null;
  var list = Object.keys(src).map(function (k) { return src[k]; }).filter(function (x) { return !(isCl && WA.hideUn && x.k === '(미지정)'); }).sort(function (a, b) { return b.h - a.h; });
  var tot = list.reduce(function (s, x) { return s + x.h; }, 0) || 1, N = 12, show = list.slice(0, N), rest = list.slice(N);
  if (rest.length) show.push({ k: '기타 ' + rest.length + '개', h: rest.reduce(function (s, x) { return s + x.h; }, 0), ppl: rest.reduce(function (o, x) { Object.keys(x.ppl).forEach(function (p) { o[p] = 1; }); return o; }, {}), days: {}, _etc: true });
  var max = show.length ? Math.max.apply(null, show.map(function (x) { return x.h; })) : 1, cum = 0, cut = false;
  var rows = show.map(function (x) {
    cum += x.h;
    var cp = _waPct(cum, tot), mark = '';
    if (!cut && !x._etc && cp >= 80) { cut = true; mark = ' wa-80'; }
    var pv = prv && !x._etc ? ((prv[x.k] || {}).h || 0) : null, d = '';
    if (pv != null) { var dd = _waR1(x.h - pv); d = pv === 0 ? '<span class="wa-mut">새로</span>' : Math.abs(dd) < 0.5 ? '<span class="wa-mut">–</span>' : '<span class="wa-mut">' + (dd > 0 ? '▲' : '▼') + Math.abs(dd) + 'h</span>'; }
    var ss = !x._etc && _wsPpl().length ? _wsPH(x.ph) : 0;
    var name = isCl || x._etc ? eH(x.k) : '<b>' + eH(x.nm || x.k) + '</b> <span class="wa-mut">' + eH(x.k) + (x.cl && x.cl !== '(미지정)' ? ' · ' + eH(x.cl) : '') + '</span>';
    return '<tr class="' + mark + '"' + (x._etc ? '' : _wsA((isCl ? 'cl:' : 'ord:') + x.k)) + '><td class="wa-tn" title="' + eH(x.nm ? x.nm + ' ' + x.k : x.k) + '">' + name + '</td>'
      + '<td class="wa-bc"' + _waTip([_waH(x.h) + ' · ' + _waPct(x.h, tot) + '%', (x.nm || x.k) + ' · ' + Object.keys(x.ppl).length + '명' + (x._etc ? '' : ' · ' + Object.keys(x.days).length + '일')].concat(ss ? ['선택(' + _wsNm() + ') ' + _waH(ss) + ' · ' + _waPct(ss, x.h) + '%'] : [])) + '><span class="wa-b" style="width:calc(' + (x.h / max).toFixed(3) + ' * (100% - 52px))' + (x._etc ? ';opacity:.45' : '') + '">' + (ss ? '<i class="wa-bsel" style="width:' + Math.min(100, ss / x.h * 100).toFixed(1) + '%"></i>' : '') + '</span><span class="wa-bv">' + _waH(x.h) + '</span></td>'
      + '<td class="num">' + _waPct(x.h, tot) + '%</td><td class="num wa-mut">' + cp + '%</td><td class="num">' + Object.keys(x.ppl).length + '</td><td class="num">' + (x._etc ? '' : Object.keys(x.days).length) + '</td>' + (prv ? '<td class="num">' + d + '</td>' : '') + '</tr>';
  }).join('');
  return '<section class="wa-card" id="waTopC"><div class="wa-h"><h4>🏢 어디에 시간을 썼나 <span class="wa-sub">' + (isCl ? '업체' : '수주') + ' ' + list.length + '개 · 휴가 제외</span></h4>'
    + '<span class="wm-seg wa-seg2"><button data-wa-dim="client" class="' + (isCl ? 'on' : '') + '">업체</button><button data-wa-dim="order" class="' + (!isCl ? 'on' : '') + '">수주</button></span>'
    + (isCl ? '<label class="wa-chk"><input type="checkbox" data-wa-hideun' + (WA.hideUn ? ' checked' : '') + '> 미지정 빼기</label>' : '')
    + _waSaveBtn('waTopC') + '</div>'
    + (list.length ? '<div class="wa-tw"><table class="wa-tbl wa-rank"><thead><tr><th>' + (isCl ? '업체' : '수주') + '</th><th>시간</th><th class="num">비중</th><th class="num" title="위에서부터 더한 비중 — 80% 를 넘는 줄에 선">누적</th><th class="num">인원</th><th class="num">일수</th>' + (prv ? '<th class="num">지난 기간 대비</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<div class="wa-note">굵은 선 = 위에서부터 더해 시간의 80% 가 되는 곳 — 그 위가 핵심</div>' : '<div class="wa-empty">수주번호가 있는 기록이 없습니다</div>') + '</section>';
}

/* ─── ⑦ 월별 추이 — 색 농도 표 ─── */
function _waMonth(rg) {
  if (typeof gfRange !== 'function') return '';
  var end = rg.e.slice(0, 6), ms = [], y = +end.slice(0, 4), m = +end.slice(4, 6);
  for (var i = 0; i < WA.mN; i++) { ms.unshift(y + ('0' + m).slice(-2)); m--; if (!m) { m = 12; y--; } }
  var rows = _waRows(gfRange(ms[0] + '01', ms[ms.length - 1] + '31'));
  var dim = WA.mDim, V = {}, tot = {}, work = {}, pdays = {}, seen = {};
  rows.forEach(function (r) {
    var mo = r.date.slice(0, 6), h = +r.hours || 0, vac = _waVac(r);
    tot[mo] = (tot[mo] || 0) + h;
    if (!vac) { work[mo] = (work[mo] || 0) + h; var pk = mo + r.name + '\u0001' + r.date; if (!seen[pk]) { seen[pk] = 1; pdays[mo] = (pdays[mo] || 0) + 1; } }
    var k = dim === 'abbr' ? (r.abbr || '?') : dim === 'person' ? r.name : _waCl(r);
    if (dim !== 'abbr' && vac) return;
    var o = V[k] || (V[k] = { k: k, t: 0, m: {} }); o.t += h; o.m[mo] = (o.m[mo] || 0) + h;
  });
  // 앞쪽 빈 달(이 필터로 기록이 없는 달)은 빼고 — 최소 2개월은 남김
  while (ms.length > 2 && !tot[ms[0]]) ms.shift();
  var list = Object.keys(V).map(function (k) { return V[k]; }).sort(function (a, b) { return b.t - a.t; });
  if (list.length > 10) {
    var rest = list.slice(9), o = { k: '기타 ' + rest.length, t: 0, m: {}, etc: true };
    rest.forEach(function (x) { o.t += x.t; Object.keys(x.m).forEach(function (mo) { o.m[mo] = (o.m[mo] || 0) + x.m[mo]; }); });
    list = list.slice(0, 9).concat([o]);
  }
  var max = 0; list.forEach(function (x) { ms.forEach(function (mo) { max = Math.max(max, x.m[mo] || 0); }); });
  var today = new Date(), curMo = today.getFullYear() + ('0' + (today.getMonth() + 1)).slice(-2);
  var STEP = [0, 12, 26, 42, 60, 80];
  function cell(v, lines) {
    if (!v) return '<td class="wa-hm"></td>';
    var st = Math.max(1, Math.ceil(v / (max || 1) * 5));
    return '<td class="wa-hm" style="background:color-mix(in srgb,var(--ac) ' + STEP[st] + '%,transparent);color:' + (st >= 4 ? '#fff' : 'var(--t2)') + '"' + _waTip(lines) + '>' + Math.round(v) + '</td>';
  }
  function chg(x) {
    var a = x[ms[ms.length - 1]] || 0, b = x[ms[ms.length - 2]] || 0;
    if (!b) return a ? '<span class="wa-mut">새로</span>' : '';
    var d = _waR1((a - b) / b * 100);
    return Math.abs(d) < 1 ? '<span class="wa-mut">–</span>' : '<span class="wa-mut">' + (d > 0 ? '▲' : '▼') + Math.abs(d) + '%</span>';
  }
  var head = '<tr><th>' + ({ abbr: '분장', person: '사람', client: '업체' })[dim] + '</th>' + ms.map(function (mo) { return '<th class="num">' + (+mo.slice(4)) + '월' + (mo === curMo ? '<sup title="이번 달 — 아직 진행 중">*</sup>' : '') + '</th>'; }).join('') + '<th class="num">합계</th><th class="num" title="마지막 달 ÷ 그 전 달">전월 대비</th></tr>';
  var body = list.map(function (x) {
    var nm = dim === 'abbr' ? '<span class="wa-sw" style="background:' + _waAbCol(x.k) + '"></span>' + eH(_waAbName(x.k)) : eH(x.k);
    return '<tr' + (x.etc ? '' : _wsA((dim === 'abbr' ? 'ab:' : dim === 'person' ? 'p:' : 'cl:') + x.k)) + '><td class="wa-tn">' + nm + '</td>' + ms.map(function (mo) { return cell(x.m[mo] || 0, [_waH(x.m[mo] || 0) + (tot[mo] ? ' · ' + _waPct(x.m[mo] || 0, dim === 'abbr' ? tot[mo] : work[mo]) + '%' : ''), (dim === 'abbr' ? _waAbName(x.k) : x.k) + ' · ' + mo.slice(0, 4) + '년 ' + (+mo.slice(4)) + '월']); }).join('')
      + '<td class="num"><b>' + Math.round(x.t) + '</b></td><td class="num">' + chg(x.m) + '</td></tr>';
  }).join('');
  var sumRow = '<tr class="wa-sum"><td>합계' + (dim === 'abbr' ? '' : ' (휴가 제외)') + '</td>' + ms.map(function (mo) { var v = dim === 'abbr' ? tot[mo] || 0 : work[mo] || 0; return '<td class="num">' + (v ? Math.round(v) : '<span class="wa-mut">기록 없음</span>') + '</td>'; }).join('') + '<td></td><td class="num">' + chg(dim === 'abbr' ? tot : work) + '</td></tr>';
  var avgRow = '<tr class="wa-sum"><td title="휴가 뺀 업무 시간 ÷ 사람마다 기록한 날">인당 하루 평균</td>' + ms.map(function (mo) { var a = pdays[mo] ? work[mo] / pdays[mo] : 0; return '<td class="num"' + (a > 9.5 ? ' style="color:' + WA_ST.bad + '"' : '') + '>' + (a ? _waR1(a) + 'h' : '') + '</td>'; }).join('') + '<td></td><td></td></tr>';
  return '<section class="wa-card" id="waMonC"><div class="wa-h"><h4>📈 월별 추이 <span class="wa-sub">진할수록 많음 · 같은 필터 · ' + (+ms[0].slice(4)) + '월 ~ ' + (+ms[ms.length - 1].slice(4)) + '월</span></h4>'
    + '<span class="wm-seg wa-seg2">' + [['abbr', '분장'], ['person', '사람'], ['client', '업체']].map(function (d) { return '<button data-wa-mdim="' + d[0] + '" class="' + (dim === d[0] ? 'on' : '') + '">' + d[1] + '</button>'; }).join('') + '</span>'
    + '<span class="wm-seg wa-seg2">' + [3, 6, 12].map(function (k) { return '<button data-wa-mn="' + k + '" class="' + (WA.mN === k ? 'on' : '') + '">' + k + '개월</button>'; }).join('') + '</span>'
    + _waSaveBtn('waMonC') + '</div>'
    + (list.length ? '<div class="wa-tw"><table class="wa-tbl wa-heat"><thead>' + head + '</thead><tbody>' + body + sumRow + avgRow + '</tbody></table></div>' : '<div class="wa-empty">이 기간에 기록이 없습니다</div>')
    + '<div class="wa-note">시간(h) · <sup>*</sup> 이번 달은 아직 진행 중 · 위 공통 필터(팀원 · 수주 · 업체 · 검색)는 그대로, 기간만 월 단위로</div></section>';
}

/* ─── 묶기 · 말풍선 ─── */
/* 한 번만 — 상자에 위임 (부분만 다시 그려도 다시 묶을 필요 없음) */
function _waBind(box) {
  if (!box._waTip) {
    box._waTip = true;
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-wa-dim],[data-wa-mdim],[data-wa-mn]'); if (!b) return;
      if (b.dataset.waDim) { WA.dim = b.dataset.waDim; _waSave(); _waReTop(); }
      else if (b.dataset.waMdim) { WA.mDim = b.dataset.waMdim; _waSave(); _waReMonth(); }
      else { WA.mN = +b.dataset.waMn; _waSave(); _waReMonth(); }
    });
    box.addEventListener('change', function (e) {
      if (e.target.hasAttribute && e.target.hasAttribute('data-wa-hideun')) { WA.hideUn = e.target.checked; _waSave(); _waReTop(); }
    });
    var show = function (e) {
      var t = e.target.closest && e.target.closest('[data-tip]'); if (!t || !box.contains(t)) return;
      var tip = document.getElementById('waTip');
      if (!tip) { tip = document.createElement('div'); tip.id = 'waTip'; tip.className = 'wa-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
      tip.textContent = '';
      t.dataset.tip.split('\n').forEach(function (l, i) { var d = document.createElement('div'); if (i === 0) d.className = 'v'; d.textContent = l; tip.appendChild(d); });
      tip.style.display = 'block';
      var r = t.getBoundingClientRect(), x = e.clientX != null && e.type !== 'focusin' ? e.clientX : r.left + r.width / 2, y = e.clientY != null && e.type !== 'focusin' ? e.clientY : r.top;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.max(6, Math.min(window.innerWidth - tw - 6, x + 12)) + 'px';
      tip.style.top = (y - th - 10 < 6 ? y + 16 : y - th - 10) + 'px';
    };
    var hide = function () { var tip = document.getElementById('waTip'); if (tip) tip.style.display = 'none'; };
    box.addEventListener('pointermove', show);
    box.addEventListener('focusin', show);
    box.addEventListener('pointerleave', hide);
    box.addEventListener('focusout', hide);
    box.addEventListener('pointerover', function (e) { if (!(e.target.closest && e.target.closest('[data-tip]'))) hide(); });
  }
}
function _waReTop() {
  var L = _waLast, el = document.getElementById('waTopC'); if (!L || !el) return;
  var tmp = document.createElement('div'); tmp.innerHTML = _waTop(L.A, L.P); el.replaceWith(tmp.firstChild);
}
function _waReMonth() {
  var L = _waLast, el = document.getElementById('waMonth'); if (!L || !el) return;
  el.innerHTML = _waMonth(L.rg);
}
