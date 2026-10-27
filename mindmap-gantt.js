/**
 * 업무 관리자 — 🧠 마인드맵 간트 보기
 * 주제 트리를 그대로 행으로(접기 반영), 시작일·마감일을 막대로. 일 · 주 · 월 눈금, 오늘 선, 주말 음영.
 *  - 막대: 시작~마감 / 마감만 있으면 ◆ 마일스톤 / 날짜 없는 부모는 하위 일정을 묶은 요약 막대(진척은 맵과 같은 하위 평균)
 *  - 앱 데이터에 연결된 주제(프로젝트 · 마일스톤 · 이슈 …)는 원본 날짜로 — 빗금 막대, 여기서는 못 옮김
 *  - 관계선은 선후 화살표로 (뒤 작업이 앞 작업보다 먼저 시작하면 빨간색)
 *  - 끌어서 옮기기 · 양 끝을 끌어 기간 바꾸기 · 빈 줄을 끌어 새 일정. Alt+←/→ 하루(Shift 는 한 주) 옮기기
 * 의존(전역): mindmap.js, mindmap-edit.js(_mmMutate · mmUndo · mmRedo), mindmap-view.js(_mmNodeColor), mindmap-panel.js
 */

var MM_GT_SCALES = [
  { k: 'day', l: '일', dw: 34, pad: 4 },
  { k: 'week', l: '주', dw: 14, pad: 10 },
  { k: 'month', l: '월', dw: 4.2, pad: 31 }
];
var MM_GT_ROW = 36;
var MM_GT_LEFT = 440;
var MM_GT_MAX_DAYS = 1500;
var MM_GT_WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function _mmgState() {
  if (!_mm.gt) {
    var sc = 'day';
    try { sc = localStorage.getItem('mm-gantt-scale') || 'day'; } catch (_) {}
    _mm.gt = { scale: sc, filter: '', scrolled: false };
  }
  return _mm.gt;
}
function _mmgScale() {
  var k = _mmgState().scale;
  for (var i = 0; i < MM_GT_SCALES.length; i++) if (MM_GT_SCALES[i].k === k) return MM_GT_SCALES[i];
  return MM_GT_SCALES[0];
}

/* ── 날짜: 일 번호(UTC 기준 1970-01-01 부터 며칠째)로 계산 ── */
function _mmgDay(s) {
  if (!s) return null;
  s = String(s);
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5;
  // 서버 DATE 가 시각까지 붙어 오면(앱 데이터 원본) 이 기기의 날짜로
  var d = new Date(s);
  return isNaN(d) ? null : Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5;
}
function _mmgStr(dn) { return new Date(dn * 864e5).toISOString().slice(0, 10); }
function _mmgToday() { var d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5; }
function _mmgDow(dn) { return new Date(dn * 864e5).getUTCDay(); }
function _mmgFmt(dn, withDow) {
  var d = new Date(dn * 864e5);
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + (withDow ? '(' + MM_GT_WEEK[d.getUTCDay()] + ')' : '');
}

/** 주제의 일정 → { s, e, kind: task|mile, src: own|ref } 또는 null */
function _mmgSpan(n) {
  var s = n.startDate, e = n.dueDate, src = 'own';
  if (!s && !e && n.ref) {
    var r = _mm.refs[n.ref.type + ':' + n.ref.id];
    if (r && (r.start || r.end)) { s = r.start || null; e = r.end || null; src = 'ref'; }
  }
  var a = _mmgDay(s), b = _mmgDay(e);
  if (a == null && b == null) return null;
  if (a == null) return { s: b, e: b, kind: 'mile', src: src };
  if (b == null) b = a;
  if (b < a) { var t = a; a = b; b = t; }
  return { s: a, e: b, kind: 'task', src: src };
}
function _mmgDone(n) { return !!(n.done || _mmRefDone(n)); }
var _mmgPmap = null;   // _mmgCollect 때 만든 진행률 표 (맵과 같은 기준 — _mmProgressMap)
function _mmgProg(n) {
  if (_mmgPmap && n.id && _mmgPmap[n.id]) return _mmgPmap[n.id].p;
  if (_mmgDone(n)) return 100;
  var p = parseInt(n.progress, 10);
  if (isNaN(p) && n.ref) { var r = _mm.refs[n.ref.type + ':' + n.ref.id]; if (r) p = parseInt(r.progress, 10); }
  return isNaN(p) ? 0 : Math.max(0, Math.min(100, p));
}

/**
 * 트리 → 행 정보. 요약(부모)은 하위 일정 전체를 묶고, 진척은 맵과 같은 값(값 있는 하위만의 평균).
 * 반환 { info: {id: {n, depth, parent, span, sum, color}}, order: [id…] (전체, 트리 순) }
 */
function _mmgCollect(root) {
  var info = {}, order = [];
  var colors = {};
  _mmgPmap = _mmProgressMap(root);
  mmWalk(root, function (n, parent, depth) {
    colors[n.id] = _mmNodeColor(n, parent, depth, root, colors);
    info[n.id] = { n: n, depth: depth, parent: parent ? parent.id : null, span: _mmgSpan(n), color: colors[n.id] };
    order.push(n.id);
  });
  (function roll(n) {
    var it = info[n.id];
    var lo = null, hi = null;
    (n.children || []).forEach(function (c) {
      var r = roll(c);
      if (!r) return;
      lo = lo == null ? r.s : Math.min(lo, r.s);
      hi = hi == null ? r.e : Math.max(hi, r.e);
    });
    if (lo != null) it.sum = { s: lo, e: hi, prog: _mmgProg(n) };
    // 자기 일정이 있으면 그것이 기준(하위는 참고), 없으면 하위 묶음
    if (it.span) return { s: Math.min(it.span.s, lo == null ? it.span.s : lo), e: Math.max(it.span.e, hi == null ? it.span.e : hi) };
    return it.sum ? { s: it.sum.s, e: it.sum.e } : null;
  })(root);
  return { info: info, order: order };
}

/** 요약 숫자 — 일정 있는 주제 기준 (중심 주제 · 묶음 막대 제외) */
function _mmgStats(data) {
  var today = _mmgToday();
  var st = { all: 0, run: 0, late: 0, week: 0, done: 0, nodate: 0 };
  data.order.forEach(function (id) {
    var it = data.info[id];
    if (it.depth === 0) return;
    if (!it.span) { if (!it.sum) st.nodate++; return; }
    st.all++;
    var done = _mmgProg(it.n) >= 100;
    if (done) { st.done++; return; }
    if (it.span.e < today) st.late++;
    else if (it.span.s <= today) st.run++;
    if (it.span.e >= today && it.span.e <= today + 6) st.week++;
  });
  return st;
}
function _mmgMatch(it, f, today) {
  if (!f) return true;
  var sp = it.span, done = _mmgProg(it.n) >= 100;
  if (f === 'dated') return !!sp;
  if (f === 'late') return !!sp && !done && sp.e < today;
  if (f === 'run') return !!sp && !done && sp.s <= today && sp.e >= today;
  if (f === 'week') return !!sp && !done && sp.e >= today && sp.e <= today + 6;
  if (f === 'nodate') return !sp && !it.sum && it.depth > 0;
  if (f === 'done') return !!sp && done;
  return true;
}

/** 보일 행 — 접힘 반영. 거르기 중이면 맞는 주제와 그 위 단계만(접힘 무시) */
function _mmgRows(data, f) {
  var today = _mmgToday();
  if (!f) {
    var out = [];
    mmWalk(_mmRoot(), function (n) { out.push(n.id); if (n.collapsed) return false; });
    return out;
  }
  var keep = {};
  data.order.forEach(function (id) {
    if (!_mmgMatch(data.info[id], f, today)) return;
    for (var x = id; x && !keep[x]; x = data.info[x].parent) keep[x] = true;
  });
  return data.order.filter(function (id) { return keep[id]; });
}

/** 보이는 기간 [t0, t1] — 일정 전체 + 오늘, 눈금에 맞춰 앞뒤 여유 */
function _mmgRange(data, sc) {
  var lo = _mmgToday(), hi = lo;
  data.order.forEach(function (id) {
    var sp = data.info[id].span;
    if (sp) { lo = Math.min(lo, sp.s); hi = Math.max(hi, sp.e); }
  });
  lo -= sc.pad; hi += sc.pad + (sc.k === 'day' ? 14 : sc.k === 'week' ? 28 : 60);
  if (sc.k === 'month') {
    var a = new Date(lo * 864e5); lo = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1) / 864e5;
  } else {
    lo -= (_mmgDow(lo) + 6) % 7;   // 월요일부터
  }
  if (hi - lo > MM_GT_MAX_DAYS) hi = lo + MM_GT_MAX_DAYS;
  return { t0: lo, t1: hi };
}

/* ═══ 그리기 ═══ */
function _mmPaintGantt() {
  var g = _mmEl('mmGantt');
  if (!g || !_mm.doc || !_mm.gantt) return;
  var gs = _mmgState();
  var sc = _mmgScale();
  var dw = sc.dw;
  var data = _mmgCollect(_mmRoot());
  var stats = _mmgStats(data);
  var rows = _mmgRows(data, gs.filter);
  var rg = _mmgRange(data, sc);
  var days = rg.t1 - rg.t0 + 1;
  var W = Math.ceil(days * dw);
  var today = _mmgToday();
  var x = function (dn) { return (dn - rg.t0) * dw; };
  var ro = _mm.readOnly;

  // 상단: 요약 칩(눌러서 거르기) · 눈금 · 오늘
  var chip = function (f, label, n, cls) {
    return '<button class="mm-gt-chip' + (cls || '') + (gs.filter === f ? ' on' : '') + '" data-gt-filter="' + f + '"' + (n === 0 && f ? ' disabled' : '') + '>' +
      label + '<b>' + n + '</b></button>';
  };
  var pct = stats.all ? Math.round(stats.done / stats.all * 100) : 0;
  var bar = '<div class="mm-gt-bar">' +
    '<div class="mm-gt-kpi"><div class="mm-gt-ring" style="--p:' + pct + '"><span>' + pct + '%</span></div><div><b>완료율</b><small>' + stats.done + ' / ' + stats.all + ' 작업</small></div></div>' +
    '<div class="mm-gt-chips">' + chip('', '전체', stats.all + stats.nodate) + chip('run', '진행 중', stats.run, ' mm-gt-c-run') +
    chip('late', '지연', stats.late, ' mm-gt-c-late') + chip('week', '이번 주 마감', stats.week, ' mm-gt-c-week') +
    chip('done', '완료', stats.done, ' mm-gt-c-done') + chip('nodate', '날짜 없음', stats.nodate, ' mm-gt-c-nodate') + '</div>' +
    '<span class="mm-flex"></span>' +
    '<div class="mm-seg">' + MM_GT_SCALES.map(function (s) { return '<button data-gt-scale="' + s.k + '" class="' + (s.k === sc.k ? 'on' : '') + '">' + s.l + '</button>'; }).join('') + '</div>' +
    '<button class="mm-tbtn" data-gt-today title="오늘로 이동">' + _mmIcon('calendar', 14) + '<span>오늘</span></button>' +
    '</div>';

  // 눈금 머리: 위(월 또는 연) · 아래(일 · 주 · 월)
  var top = [], low = [], seps = [];
  var d0 = new Date(rg.t0 * 864e5);
  if (sc.k === 'month') {
    for (var y = d0.getUTCFullYear(); ; y++) {
      var ys = Math.max(rg.t0, Date.UTC(y, 0, 1) / 864e5), ye = Math.min(rg.t1 + 1, Date.UTC(y + 1, 0, 1) / 864e5);
      if (ys > rg.t1) break;
      top.push('<div class="mm-gt-h1" style="left:' + x(ys) + 'px;width:' + (ye - ys) * dw + 'px"><span>' + y + '년</span></div>');
    }
  }
  for (var mo = 0; ; mo++) {
    var ms = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + mo, 1) / 864e5;
    var me = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + mo + 1, 1) / 864e5;
    if (ms > rg.t1) break;
    var a = Math.max(ms, rg.t0), b = Math.min(me, rg.t1 + 1);
    var md = new Date(ms * 864e5);
    if (sc.k === 'month') low.push('<div class="mm-gt-h2" style="left:' + x(a) + 'px;width:' + (b - a) * dw + 'px">' + (md.getUTCMonth() + 1) + '월</div>');
    else top.push('<div class="mm-gt-h1" style="left:' + x(a) + 'px;width:' + (b - a) * dw + 'px"><span>' + md.getUTCFullYear() + '년 ' + (md.getUTCMonth() + 1) + '월</span></div>');
    if (ms > rg.t0) seps.push('<div class="mm-gt-msep" style="left:' + x(ms) + 'px"></div>');
  }
  if (sc.k === 'day') {
    for (var dn = rg.t0; dn <= rg.t1; dn++) {
      var dw2 = _mmgDow(dn);
      low.push('<div class="mm-gt-h2 mm-gt-d' + (dw2 === 0 ? ' mm-gt-sun' : dw2 === 6 ? ' mm-gt-sat' : '') + (dn === today ? ' mm-gt-now' : '') +
        '" style="left:' + x(dn) + 'px;width:' + dw + 'px"><b>' + new Date(dn * 864e5).getUTCDate() + '</b><small>' + MM_GT_WEEK[dw2] + '</small></div>');
    }
  } else if (sc.k === 'week') {
    for (var wk = rg.t0; wk <= rg.t1; wk += 7) {
      low.push('<div class="mm-gt-h2' + (today >= wk && today < wk + 7 ? ' mm-gt-now' : '') + '" style="left:' + x(wk) + 'px;width:' + 7 * dw + 'px">' + _mmgFmt(wk) + '</div>');
    }
  }

  // 행
  var H = rows.length * MM_GT_ROW;
  var idx = {};
  var rowsHtml = rows.map(function (id, i) {
    idx[id] = i;
    return _mmgRowHtml(data.info[id], x, dw, today, ro);
  }).join('');

  // 선후 화살표 (관계선 — 양쪽 모두 보이고 일정이 있을 때)
  var deps = [];
  (_mmSheet().relations || []).forEach(function (rl) {
    var A = data.info[rl.from], B = data.info[rl.to];
    if (!A || !B || idx[rl.from] == null || idx[rl.to] == null) return;
    var sa = A.span || A.sum, sb = B.span || B.sum;
    if (!sa || !sb) return;
    var x1 = x(sa.e + 1) + (A.span && A.span.kind === 'mile' ? -dw / 2 + 8 : 0), y1 = idx[rl.from] * MM_GT_ROW + MM_GT_ROW / 2;
    var x2 = x(sb.s) + (B.span && B.span.kind === 'mile' ? dw / 2 - 8 : 0), y2 = idx[rl.to] * MM_GT_ROW + MM_GT_ROW / 2;
    var bad = sb.s <= sa.e;
    var d;
    if (x2 - x1 >= 16) {
      var mx = x1 + 8;
      d = 'M' + x1 + ',' + y1 + ' H' + mx + ' V' + y2 + ' H' + (x2 - 2);
    } else {
      var yMid = y2 + (y2 > y1 ? -MM_GT_ROW / 2 : MM_GT_ROW / 2);
      d = 'M' + x1 + ',' + y1 + ' h8 V' + yMid + ' H' + (x2 - 10) + ' V' + y2 + ' H' + (x2 - 2);
    }
    deps.push('<path d="' + d + '" class="mm-gt-dep' + (bad ? ' mm-gt-dep-bad' : '') + '"><title>' + _mmEsc((A.n.text || '') + ' → ' + (B.n.text || '') + (bad ? ' — 앞 작업이 끝나기 전에 시작합니다' : '')) + '</title></path>');
  });

  // 배경: 주말 음영 · 날짜 선 (월요일 기준이라 토 · 일은 5~7번째 칸)
  var bg = sc.k === 'month' ? '' :
    'background-image:linear-gradient(90deg,transparent ' + 5 * dw + 'px,var(--gt-we) ' + 5 * dw + 'px,var(--gt-we) ' + 7 * dw + 'px)' +
    (sc.k === 'day' ? ',linear-gradient(90deg,var(--gt-line) 1px,transparent 1px)' : ',linear-gradient(90deg,var(--gt-line) 1px,transparent 1px)') +
    ';background-size:' + 7 * dw + 'px 100%,' + (sc.k === 'day' ? dw : 7 * dw) + 'px 100%';
  var todayX = x(today) + dw / 2;
  var inRange = today >= rg.t0 && today <= rg.t1;

  var sc0 = _mmEl('mmGtScroll');
  var keep = sc0 ? { l: sc0.scrollLeft, t: sc0.scrollTop, scale: g.getAttribute('data-scale') } : null;
  var hadFocus = g.contains(document.activeElement);   // 다시 그린 뒤에도 키 입력(Alt+← 등)이 이어지게
  g.setAttribute('data-scale', sc.k);
  g.innerHTML = bar +
    '<div class="mm-gt-scroll" id="mmGtScroll" tabindex="0">' +
    '<div class="mm-gt-inner" style="width:' + (MM_GT_LEFT + W) + 'px;--gt-left:' + MM_GT_LEFT + 'px">' +
    '<div class="mm-gt-head">' +
    '<div class="mm-gt-lhead"><span>작업</span><span>담당</span><span>기간</span><span>진척</span></div>' +
    '<div class="mm-gt-thead" style="width:' + W + 'px"><div class="mm-gt-t1">' + top.join('') + '</div><div class="mm-gt-t2">' + low.join('') + '</div>' +
    (inRange ? '<div class="mm-gt-nowpill" style="left:' + todayX + 'px">오늘</div>' : '') + '</div></div>' +
    '<div class="mm-gt-rows" style="height:' + H + 'px">' +
    '<div class="mm-gt-grid" style="width:' + W + 'px;height:' + H + 'px;' + bg + '">' + seps.join('') +
    (inRange ? '<div class="mm-gt-today" style="left:' + todayX + 'px"></div>' : '') + '</div>' +
    rowsHtml +
    '<svg class="mm-gt-deps" width="' + W + '" height="' + H + '"><defs><marker id="mmGtArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>' + deps.join('') + '</svg>' +
    '</div>' +
    (rows.length ? '' : '<div class="mm-gt-empty">맞는 작업이 없습니다</div>') +
    '</div></div>';
  var scr = _mmEl('mmGtScroll');
  if (keep && keep.scale === sc.k) { scr.scrollLeft = keep.l; scr.scrollTop = keep.t; }
  else if (!gs.scrolled || (keep && keep.scale !== sc.k)) { gs.scrolled = true; _mmgScrollToDay(today, rg); }
  if (hadFocus) _mmgFocus();
  g._range = rg;
  g._data = data;
  _mmgBind(g);
}

function _mmgRowHtml(it, x, dw, today, ro) {
  var n = it.n;
  var kids = (n.children || []).length;
  var done = _mmgDone(n);
  var sp = it.span, sum = it.sum;
  var prog = _mmgProg(n);
  var name = String(n.text || '').split('\n')[0] || '(제목 없음)';
  var who = _mmAssigneeName(n);
  if (!who && n.ref && _mm.refs[n.ref.type + ':' + n.ref.id]) who = (_mm.refs[n.ref.type + ':' + n.ref.id].people || [])[0] || '';
  var shown = sp || sum;
  var late = sp && !done && prog < 100 && sp.e < today;
  var period = shown ? (shown.s === shown.e ? _mmgFmt(shown.s) : _mmgFmt(shown.s) + ' – ' + _mmgFmt(shown.e)) + '<small>' + (shown.e - shown.s + 1) + '일</small>' : '<span class="mm-gt-none">—</span>';
  var ri = n.ref ? (MM_REF_TYPES[n.ref.type] || { i: '🔗' }).i : '';
  var cls = 'mm-gt-row' + (it.depth === 0 ? ' mm-gt-root' : it.depth === 1 ? ' mm-gt-main' : '') + (n.id === _mm.sel ? ' mm-gt-sel' : '') + (done ? ' mm-gt-done' : '') + (late ? ' mm-gt-late' : '');
  var h = '<div class="' + cls + '" data-gt-row="' + _mmEsc(n.id) + '" style="--c:' + it.color + '">' +
    '<div class="mm-gt-l">' +
    '<div class="mm-gt-name" style="padding-left:' + (it.depth * 16 + 6) + 'px">' +
    '<span class="mm-gt-tog"' + (kids ? ' data-gt-tog="' + _mmEsc(n.id) + '"' : '') + '>' + (kids ? (n.collapsed ? '▸' : '▾') : '') + '</span>' +
    '<span class="mm-gt-dot"></span>' + (ri ? '<span class="mm-gt-ri">' + ri + '</span>' : '') +
    '<span class="mm-gt-txt" title="' + _mmEsc(n.text || '') + '">' + _mmEsc(name) + '</span>' +
    (n.collapsed && kids ? '<span class="mm-gt-more">+' + kids + '</span>' : '') + '</div>' +
    '<div class="mm-gt-who">' + (who ? '<span class="mm-gt-av">' + _mmEsc(who.slice(0, 1)) + '</span><span>' + _mmEsc(who) + '</span>' : '') + '</div>' +
    '<div class="mm-gt-when' + (late ? ' mm-gt-late-t' : '') + '">' + period + '</div>' +
    '<div class="mm-gt-pct">' + (shown ? '<span class="mm-gt-pbar"><i style="width:' + (sp ? prog : sum.prog) + '%"></i></span>' + (sp ? prog : sum.prog) + '%' : '') + '</div>' +
    '</div>' +
    '<div class="mm-gt-track' + (!sp && !ro && it.depth > 0 ? ' mm-gt-can-new' : '') + '">';
  var label = '<span class="mm-gt-lab">' + _mmEsc(name) + (who ? ' <em>' + _mmEsc(who) + '</em>' : '') +
    (late ? ' <b class="mm-gt-lateb">지연 ' + (today - sp.e) + '일</b>' : '') + (done ? ' <b class="mm-gt-doneb">✓</b>' : '') + '</span>';
  var tip = _mmEsc(name + '\n' + (shown ? _mmgFmt(shown.s, true) + (shown.e !== shown.s ? ' ~ ' + _mmgFmt(shown.e, true) : '') + ' · ' + (shown.e - shown.s + 1) + '일' : '') +
    (who ? '\n담당 ' + who : '') + '\n진척 ' + (sp ? prog : sum ? sum.prog : 0) + '%' + (sp && sp.src === 'ref' ? '\n(연결된 원본의 날짜 — 원본에서 바꿉니다)' : ''));
  if (sp && sp.kind === 'mile') {
    h += '<div class="mm-gt-mile' + (sp.src === 'ref' ? ' mm-gt-ref' : '') + '" data-gt-bar="' + _mmEsc(n.id) + '" data-gt-kind="mile" style="left:' + (x(sp.s) + dw / 2) + 'px" title="' + tip + '"><i></i></div>' +
      label.replace('class="mm-gt-lab"', 'class="mm-gt-lab" style="left:' + (x(sp.s) + dw / 2 + 14) + 'px"');
  } else if (sp) {
    var w = Math.max(dw, (sp.e - sp.s + 1) * dw);
    h += '<div class="mm-gt-task' + (sp.src === 'ref' ? ' mm-gt-ref' : '') + '" data-gt-bar="' + _mmEsc(n.id) + '" data-gt-kind="task" style="left:' + x(sp.s) + 'px;width:' + w + 'px" title="' + tip + '">' +
      '<i class="mm-gt-fill" style="width:' + prog + '%"></i>' + (w > 46 ? '<span class="mm-gt-in">' + prog + '%</span>' : '') +
      (sp.src === 'own' && !ro ? '<i class="mm-gt-hd mm-gt-hl" data-gt-h="l"></i><i class="mm-gt-hd mm-gt-hr" data-gt-h="r"></i>' : '') + '</div>' +
      label.replace('class="mm-gt-lab"', 'class="mm-gt-lab" style="left:' + (x(sp.s) + w + 8) + 'px"');
  } else if (sum) {
    var sw = (sum.e - sum.s + 1) * dw;
    h += '<div class="mm-gt-sum" style="left:' + x(sum.s) + 'px;width:' + sw + 'px" title="' + tip + '"><i class="mm-gt-fill" style="width:' + sum.prog + '%"></i></div>' +
      label.replace('class="mm-gt-lab"', 'class="mm-gt-lab mm-gt-lab-sum" style="left:' + (x(sum.s) + sw + 8) + 'px"');
  }
  return h + '</div></div>';
}

function _mmgScrollToDay(dn, rg) {
  var scr = _mmEl('mmGtScroll');
  if (!scr) return;
  var sc = _mmgScale();
  scr.scrollLeft = Math.max(0, (dn - rg.t0) * sc.dw - (scr.clientWidth - MM_GT_LEFT) / 3);
}

/* ═══ 보기 열기 · 동작 ═══ */
function _mmgSetDates(id, s, e, kind) {
  var f = mmFind(_mmRoot(), id);
  if (!f) return;
  _mmMutate(function () {
    if (kind === 'mile') { f.node.dueDate = _mmgStr(e); return; }
    f.node.startDate = _mmgStr(s);
    f.node.dueDate = _mmgStr(e);
  }, { paint: false });
  _mmPaintGantt();
  _mmPaintPanel();
}
function _mmgFocus() {
  var scr = _mmEl('mmGtScroll');
  if (scr) try { scr.focus({ preventScroll: true }); } catch (_) { scr.focus(); }
}
function _mmgSelect(id) {
  _mm.sel = id;
  _mmgFocus();
  var g = _mmEl('mmGantt');
  if (g) g.querySelectorAll('.mm-gt-row').forEach(function (r) { r.classList.toggle('mm-gt-sel', r.getAttribute('data-gt-row') === id); });
  _mmPaintPanel();
}

function _mmgBind(g) {
  if (g._bound) return;
  g._bound = true;
  g.addEventListener('click', function (e) {
    var t = e.target;
    var f = t.closest('[data-gt-filter]');
    if (f) { var gs = _mmgState(); var v = f.getAttribute('data-gt-filter'); gs.filter = gs.filter === v ? '' : v; _mmPaintGantt(); return; }
    var s = t.closest('[data-gt-scale]');
    if (s) {
      _mmgState().scale = s.getAttribute('data-gt-scale');
      try { localStorage.setItem('mm-gantt-scale', _mmgState().scale); } catch (_) {}
      _mmPaintGantt();
      return;
    }
    if (t.closest('[data-gt-today]')) { _mmgScrollToDay(_mmgToday(), g._range); return; }
    var tg = t.closest('[data-gt-tog]');
    if (tg) {
      var fn = mmFind(_mmRoot(), tg.getAttribute('data-gt-tog'));
      if (!fn) return;
      if (_mm.readOnly) fn.node.collapsed = !fn.node.collapsed;
      else _mmMutate(function () { fn.node.collapsed = !fn.node.collapsed; }, { paint: false });
      _mmPaintGantt();
      return;
    }
    var row = t.closest('[data-gt-row]');
    if (row && !g._dragged) _mmgSelect(row.getAttribute('data-gt-row'));
  });
  g.addEventListener('dblclick', function (e) {
    var row = e.target.closest('[data-gt-row]');
    if (!row || e.target.closest('.mm-gt-track')) return;
    // 작업 이름을 두 번 누르면 맵에서 그 주제로
    var id = row.getAttribute('data-gt-row');
    _mmSetView('map');
    _mmSelect(id);
  });
  g.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || _mm.readOnly) return;
    var track = e.target.closest('.mm-gt-track');
    if (!track) return;
    var row = track.closest('[data-gt-row]');
    var id = row.getAttribute('data-gt-row');
    var data = g._data, rg = g._range, sc = _mmgScale();
    var it = data && data.info[id];
    if (!it) return;
    var barEl = e.target.closest('[data-gt-bar]');
    var mode, s0, e0, kind;
    if (barEl) {
      if (!it.span || it.span.src !== 'own') { _mmgSelect(id); return; }
      kind = it.span.kind;
      var hd = e.target.getAttribute('data-gt-h');
      mode = hd === 'l' ? 'l' : hd === 'r' ? 'r' : 'move';
      s0 = it.span.s; e0 = it.span.e;
    } else if (!it.span && it.depth > 0) {
      mode = 'new'; kind = 'task';
      var rect = track.getBoundingClientRect();
      s0 = e0 = rg.t0 + Math.floor((e.clientX - rect.left) / sc.dw);
    } else { return; }
    e.preventDefault();
    _mmgSelect(id);
    var x0 = e.clientX;
    var ns = s0, ne = e0;
    var ghost = barEl;
    if (mode === 'new') {
      ghost = document.createElement('div');
      ghost.className = 'mm-gt-task mm-gt-ghost';
      track.appendChild(ghost);
    }
    var tip = document.createElement('div');
    tip.className = 'mm-gt-tip';
    g.appendChild(tip);
    g._dragged = false;
    var paint = function (cx, cy) {
      var dd = Math.round((cx - x0) / sc.dw);
      if (mode === 'move') { ns = s0 + dd; ne = e0 + dd; }
      else if (mode === 'l') { ns = Math.min(s0 + dd, e0); ne = e0; }
      else if (mode === 'r') { ns = s0; ne = Math.max(e0 + dd, s0); }
      else { ns = Math.min(s0, s0 + dd); ne = Math.max(s0, s0 + dd); }
      if (kind === 'mile') ghost.style.left = ((ne - rg.t0) * sc.dw + sc.dw / 2) + 'px';
      else { ghost.style.left = ((ns - rg.t0) * sc.dw) + 'px'; ghost.style.width = Math.max(sc.dw, (ne - ns + 1) * sc.dw) + 'px'; }
      var lab = row.querySelector('.mm-gt-lab');
      if (lab) lab.style.visibility = 'hidden';
      var gr = g.getBoundingClientRect();
      tip.innerHTML = kind === 'mile' ? '◆ ' + _mmgFmt(ne, true) : _mmgFmt(ns, true) + ' → ' + _mmgFmt(ne, true) + ' <b>' + (ne - ns + 1) + '일</b>';
      tip.style.left = (cx - gr.left + 14) + 'px';
      tip.style.top = (cy - gr.top - 34) + 'px';
    };
    var move = function (ev) {
      if (Math.abs(ev.clientX - x0) > 2) g._dragged = true;
      if (g._dragged) { g.classList.add('mm-gt-dragging'); paint(ev.clientX, ev.clientY); }
    };
    var up = function () {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      g.classList.remove('mm-gt-dragging');
      tip.remove();
      // 빈 줄은 그냥 눌러도 하루짜리 일정이 생김
      if (mode === 'new' || ns !== s0 || ne !== e0) _mmgSetDates(id, ns, ne, kind);
      setTimeout(function () { g._dragged = false; }, 0);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  g.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') return;
    var k = typeof mmKeyName === 'function' ? mmKeyName(e) : '';
    if (k === 'Ctrl+Z') { e.preventDefault(); mmUndo(); return; }
    if (k === 'Ctrl+Y' || k === 'Ctrl+Shift+Z') { e.preventDefault(); mmRedo(); return; }
    var rows = Array.prototype.map.call(g.querySelectorAll('[data-gt-row]'), function (r) { return r.getAttribute('data-gt-row'); });
    var i = rows.indexOf(_mm.sel);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (e.altKey) return;
      e.preventDefault();
      var j = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (rows[j]) { _mmgSelect(rows[j]); var el = g.querySelector('[data-gt-row="' + rows[j] + '"]'); if (el) el.scrollIntoView({ block: 'nearest' }); }
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey && !_mm.readOnly) {
      // Alt+←/→ 하루, Alt+Shift 는 한 주 옮기기
      var it = g._data && g._data.info[_mm.sel];
      if (!it || !it.span || it.span.src !== 'own') return;
      e.preventDefault();
      var d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 7 : 1);
      _mmgSetDates(_mm.sel, it.span.s + d, it.span.e + d, it.span.kind);
    }
  });
}

/** 보기 전환: map · outline · gantt */
function _mmSetView(v) {
  _mm.outline = v === 'outline';
  _mm.gantt = v === 'gantt';
  var ol = _mmEl('mmOutline'), cv = _mmEl('mmCanvas'), gt = _mmEl('mmGantt');
  if (!ol || !cv) return;
  ol.classList.toggle('hidden', !_mm.outline);
  if (gt) gt.classList.toggle('hidden', !_mm.gantt);
  cv.classList.toggle('hidden', _mm.outline || _mm.gantt);
  [['mmVMap', 'map'], ['mmVOut', 'outline'], ['mmVGantt', 'gantt']].forEach(function (p) {
    var b = _mmEl(p[0]);
    if (b) b.classList.toggle('on', (v || 'map') === p[1]);
  });
  var ed = _mmEl('mmEd');
  if (ed) ed.classList.toggle('mm-view-gantt', _mm.gantt);
  if (_mm.outline) _mmPaintOutline();
  else if (_mm.gantt) { _mmPaintGantt(); _mmgFocus(); }
  else { _mmPaint(); _mmFit(); _mmFocusCanvas(); }
}
