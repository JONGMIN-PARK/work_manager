/* ═══════════════════════════════════════════════════════════════════════
   my-work-timeline.js — 🕒 내 업무 타임라인 · 옆 달력 (v13.271)
   ─────────────────────────────────────────────────────────────────────
   내 업무 맨 위 띠 — 한눈에 시간 순으로. 업무 부하 탭에서는 팀원별 줄로 (같은 그리기).
     · 줌: 주(하루 안 시각까지) · 월 · 년(주마다 묶어 ●n) + Ctrl+휠 · 두 손가락으로 부드럽게, 마우스 아래 날짜 기준
     · 가로 이동: 빈 곳 끌기 · Shift+휠 · 트랙패드 · 손가락 · ← → (Shift = 한 화면) · [오늘] · 날짜로 가기
     · 그리기: 기간 있는 것(일정 · 마일스톤 · 시작일 있는 맵 주제 · 할 일) = 막대, 마감만 = ◆ (시각 있으면 그 시각), 지연 = 빨강 + 오늘까지 꼬리
     · 줄: 칸(보드 카테고리) · 출처 · 한 줄로. 겹치면 아래로 비켜 쌓고 넘치면 +n. 위 출처 칩 · 거르기 · 보드 요약이 그대로 걸림
     · 바로: 올리면 미리보기 · 누르면 상세 패널 · ◆ 끌어 마감 바꾸기 · 할 일 막대 끌기(옮기기 · 양 끝 = 시작 · 마감) · 일정 막대 옮기기
             빈 날 두 번 누르기 = 그날 마감 할 일
     · 옆 달력: 날짜별 점, 타임라인이 보는 기간 띠. 🔗 연동 켜면 — 마우스 자리 날짜를 달력이 따라가고(잠깐 머물면),
       누르면 그날 고정 + 그날 할 일 목록, 달력에서 누르면 타임라인이 그날로. 년 줌이면 12달 칸. 휴대폰은 한 주 줄(펼치면 달)
     · 접기(다음 8주 밀도 막대) · 아래 끝 끌어 높이 · 줌 · 위치 · 줄 · 연동 · 달력은 기억
   서버: GET /api/my-work/events (내 일정, 400일까지) · 항목 start(시작일)는 GET /api/my-work 에
   전역 의존: _mw · _mwPaint · _mwEsc · _mwToast · _mwErr · _mwDays · _mwDueLabel · _mwMe · MW_SRC · mwOpenItem (my-work.js)
              mwBoardCols · mwBoardColOf · MW_CAT_COLORS · MW_NONE_COL · _mwbShowDone (my-work-board.js) · mwVisibleItems (my-work-io.js)
              mwPanelOpen · mwSetDue · _mwpCanDue · mwUndoToast · _mwpApply (my-work-panel.js) · mwAddTodo (my-work.js)
              _mwcEventModal · _mwcMoveEvent (my-work-cal.js) · expandRepeatingEvents · toCamelArray · EVT_TYPE · krHolidayName
   ═══════════════════════════════════════════════════════════════════════ */

var MWT_PPD = { week: 120, month: 30, year: 2.6 };   // 하루 폭(px)
var MWT_MIN = 1.4, MWT_MAX = 320;
var MWT_LABEL = 118;   // 왼쪽 줄 이름 폭 (휴대폰 76 — CSS 와 같게, 인스턴스마다 this.L)
var MWT_ROW = 24;      // 한 줄 높이
var MWT_AX = 36;       // 날짜 머리
var MWT_MAXROWS = 6;   // 한 칸 안 쌓기 — 넘치면 +n
var MWT_SRC_COLOR = { mindmap: '#EC4899', issue: '#F59E0B', action: '#06B6D4', prestudy: '#8B5CF6', milestone: '#6366F1', dev: '#10B981', todo: '#3B82F6' };
var MWT_WD = '일월화수목금토';

function _mtlNum(d) { return Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5); }
function _mtlYmd(n) { return new Date(Math.floor(n) * 864e5).toISOString().slice(0, 10); }
function _mtlMin(t) { return t ? (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)) : 0; }
function _mtlHm(m) { m = Math.max(0, Math.min(1439, Math.round(m))); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function _mtlDow(n) { return new Date(Math.floor(n) * 864e5).getUTCDay(); }
function _mtlToday() { return (_mw.data && _mw.data.today) || (typeof localDate === 'function' ? localDate() : new Date().toISOString().slice(0, 10)); }
function _mtlHol(d) { return typeof krHolidayName === 'function' ? krHolidayName(d) : ''; }
function _mtlNarrow() { return window.matchMedia && window.matchMedia('(max-width: 768px)').matches; }
var _mtlCtx = null;
/** 글 폭 (px, 12px 글꼴) — 이름표가 겹치지 않게 쌓으려고 실제로 잼 */
function _mtlTextW(s) {
  if (!_mtlCtx) { _mtlCtx = document.createElement('canvas').getContext('2d'); _mtlCtx.font = '12px ' + ((document.body && getComputedStyle(document.body).fontFamily) || 'sans-serif'); }
  return _mtlCtx.measureText(String(s)).width;
}
function _mtlFmt(n, ppd, min) {
  var d = _mtlYmd(n);
  if (ppd < 6) return d.slice(0, 4) + '년 ' + (+d.slice(5, 7)) + '월';
  return (ppd >= 60 ? '' : d.slice(0, 4) + '.') + (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + ' (' + MWT_WD[_mtlDow(n)] + ')' + (min != null && ppd >= 60 ? ' ' + _mtlHm(min) : '');
}

/* ═══ 타임라인 하나 (내 업무 · 업무 부하가 각자 하나씩) ═══ */
function MwTimeline(o) {
  this.o = o;
  var s = null;
  try { s = JSON.parse(localStorage.getItem('mtl-' + o.ls) || 'null'); } catch (_) {}
  s = s || {};
  this.st = { ppd: s.ppd || (_mtlNarrow() ? MWT_PPD.week : MWT_PPD.month), center: s.center || null, collapsed: !!s.collapsed,
    height: s.height || 260, group: s.group || 'cat', cal: s.cal !== false, link: s.link !== false, calOpen: false };
  this.L = MWT_LABEL;
  this.el = null; this.pick = null; this.hover = null; this.calMonth = null; this.items = []; this.byDay = {};
}
/** 기억 — 고른 설정은 바로, 스크롤 위치는 잠깐 모아서 (now) */
MwTimeline.prototype.save = function (now) {
  var self = this;
  clearTimeout(this._saveT);
  function w() {
    var s = self.st;
    try { localStorage.setItem('mtl-' + self.o.ls, JSON.stringify({ ppd: s.ppd, center: s.center, collapsed: s.collapsed, height: s.height, group: s.group, cal: s.cal, link: s.link })); } catch (_) {}
  }
  if (now) w(); else this._saveT = setTimeout(w, 300);
};
MwTimeline.prototype.X = function (n) { return this.L + (n - this.from) * this.st.ppd; };
MwTimeline.prototype.N = function (x) { return this.from + (x - this.L) / this.st.ppd; };

/* ── 뼈대 (한 번만) ───────────────────────────────────────────────── */
MwTimeline.prototype.build = function () {
  var o = this.o, el = document.createElement('section');
  el.className = 'mwt' + (o.calendar ? ' has-cal' : '');
  el.id = o.id;
  // 머리는 짧게 — 자주 쓰는 것만 밖에 (줌 · 이동 · 연동), 나머지는 ⋯ 메뉴
  el.innerHTML = '<div class="mtl-hd">' +
      '<button class="mtl-fold" data-t="fold" title="접기 · 펴기">▾</button><b class="mtl-ttl">🕒 ' + _mwEsc(o.title || '타임라인') + '</b>' +
      '<span class="mwc-seg mtl-lv">' + [['week', '주'], ['month', '월'], ['year', '년']].map(function (x) { return '<button class="mwc-seg-b" data-t="lv" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</span>' +
      '<span class="mtl-nav"><button data-t="prev" title="앞으로 한 화면 (Shift+←)">‹</button><button data-t="today">오늘</button><button data-t="next" title="뒤로 한 화면 (Shift+→)">›</button></span>' +
      (o.calendar ? '<label class="mtl-link" title="켜면 타임라인 마우스 자리 날짜 ↔ 옆 달력이 따라 움직임"><input type="checkbox" data-t="link"> 🔗 연동</label>' : '') +
      '<span class="mtl-hint">Ctrl+휠 확대 · 끌어서 이동</span>' +
      '<button class="mw-btn mtl-mb" data-t="more" title="줄 나누기 · 달력 · 날짜로 가기">⋯</button>' +
      '<input type="date" class="mtl-go" data-t="go" tabindex="-1" aria-label="이 날짜로 가기">' +
    '</div>' +
    '<div class="mtl-dens" hidden></div>' +
    '<div class="mtl-main">' +
      '<div class="mtl-sc" tabindex="0" aria-label="타임라인 — ← → 이동, + − 확대 · 축소">' +
        '<div class="mtl-cv"><div class="mtl-ax"></div><div class="mtl-bg"></div><div class="mtl-lanes"></div>' +
          '<div class="mtl-now"></div><div class="mtl-guide is-hover" hidden><span></span></div><div class="mtl-guide is-pick" hidden><span></span></div></div>' +
      '</div>' +
      (o.calendar ? '<aside class="mtl-cal"></aside>' : '') +
    '</div>' +
    '<div class="mtl-rs" title="끌어서 높이 조절"></div>';
  this.el = el;
  this.sc = el.querySelector('.mtl-sc'); this.cv = el.querySelector('.mtl-cv');
  this.bind();
  return el;
};

/** 다시 그린 화면의 자리(slot)에 붙이고 새로 그림 — 스크롤은 기억한 가운데 날짜로 */
MwTimeline.prototype.mount = function (slot) {
  if (!slot) return;
  if (!this.el) this.build();
  slot.replaceWith(this.el);
  this.update();
};

/* ── 데이터 → 배치 ───────────────────────────────────────────────── */
MwTimeline.prototype.update = function () {
  var o = this.o, st = this.st, today = _mtlToday(), tn = _mtlNum(today);
  this.L = _mtlNarrow() ? 76 : MWT_LABEL;
  this.el.classList.toggle('is-collapsed', st.collapsed);
  this.el.classList.toggle('no-cal', !st.cal);
  var lk = this.el.querySelector('[data-t="link"]'); if (lk) lk.checked = st.link;
  this.el.querySelector('.mtl-main').style.height = st.height + 'px';
  this.items = o.items(this) || [];
  var lanes = o.lanes(this) || [];
  // 범위 — 지연 맨 앞 ~ 1년 뒤 (항목이 더 멀면 그만큼)
  var lo = tn - 90, hi = tn + 365;
  this.items.forEach(function (t) { lo = Math.min(lo, t.n0 - 14); hi = Math.max(hi, t.n1 + 30); });
  this.from = lo; this.to = hi;
  this.cv.style.width = (this.L + (hi - lo + 1) * st.ppd) + 'px';
  this.byDay = {};
  var by = this.byDay;
  this.items.forEach(function (t) { var k = _mtlYmd(t.n1); (by[k] = by[k] || []).push(t); });
  this.layout(lanes);
  // 오늘 선 — 주 줌이면 지금 시각까지
  var now = new Date(Date.now() + 9 * 3600000), nm = now.getUTCHours() * 60 + now.getUTCMinutes();
  var nowEl = this.el.querySelector('.mtl-now');
  nowEl.style.left = (this.X(tn) + (st.ppd >= 60 ? nm / 1440 * st.ppd : st.ppd / 2)) + 'px';
  this.el.querySelectorAll('[data-t="lv"]').forEach(function (b) {
    var v = b.getAttribute('data-v');
    b.classList.toggle('on', v === 'week' ? st.ppd >= 60 : v === 'month' ? st.ppd >= 6 && st.ppd < 60 : st.ppd < 6);
  });
  // 위치 — 기억한 가운데 날짜 (처음이면 오늘이 왼쪽 1/4 쯤)
  var w = this.sc.clientWidth || 800;
  var c = st.center != null ? st.center : tn + (w * 0.25) / st.ppd;
  this._lock = true;
  this.sc.scrollLeft = Math.max(0, this.X(c) - (w - this.L) / 2 - this.L);
  this._lock = false;
  this.drawAxis();
  this.drawPick();
  if (st.collapsed) this.drawDensity();
  if (o.calendar) this.drawCal();
};

/** 줄마다 쌓기 · 그리기 */
MwTimeline.prototype.layout = function (lanes) {
  var self = this, st = this.st, ppd = st.ppd, agg = ppd < 6, tn = _mtlNum(_mtlToday());
  var byLane = {};
  this.items.forEach(function (t) { (byLane[t.lane] = byLane[t.lane] || []).push(t); });
  var used = lanes.filter(function (l) { return byLane[l.id] || l.keep; });
  if (!used.length) used = lanes.slice(0, 1);
  var h = '';
  used.forEach(function (l) {
    var list = (byLane[l.id] || []).slice().sort(function (a, b) { return a.x0 - b.x0 || a.x1 - b.x1; });
    var rows = [], out = '', over = {};
    if (agg) {
      // 년 줌 — 주마다 묶어 ●n (누르면 그 주로 확대)
      var wk = {};
      list.forEach(function (t) { var m = t.n1 - ((_mtlDow(t.n1) + 6) % 7); (wk[m] = wk[m] || []).push(t); });
      Object.keys(wk).forEach(function (m) {
        var ts = wk[m], late = ts.some(function (t) { return t.late; }), x = self.X(+m) + 3.5 * ppd;
        var r = Math.min(11, 5 + ts.length);
        out += '<button class="mtl-agg' + (late ? ' is-late' : '') + '" data-agg="' + m + '" style="left:' + (x - r) + 'px;top:' + (MWT_ROW / 2 - r + 4) + 'px;width:' + (2 * r) + 'px;height:' + (2 * r) + 'px;--c:' + (l.color || '#94A3B8') + '" title="' + _mwEsc(_mtlYmd(+m).slice(5).replace('-', '/') + ' 주 · ' + ts.length + '개 — 누르면 확대\n' + ts.slice(0, 8).map(function (t) { return '· ' + t.title; }).join('\n')) + '">' + ts.length + '</button>';
      });
      rows = [0];
    } else {
      // 같은 날 ◆ 3개 이상 · 같은 기간 막대 3개 이상은 하나로 묶음 — "◆ 드릴 외 5" (누르면 그날 목록 · 확대)
      var grp = {};
      list.forEach(function (t) { var k = t.bar ? 'b' + t.n0 + '-' + t.n1 : 'p' + t.n1; (grp[k] = grp[k] || []).push(t); });
      var bundled = {};
      Object.keys(grp).forEach(function (k) {
        var ts = grp[k];
        if (ts.length < 3) return;
        ts.forEach(function (t) { bundled[t.key] = true; });
        var b = ts[0];
        list.push({ key: 'cl:' + l.id + ':' + k, cluster: ts, title: b.title + ' 외 ' + (ts.length - 1), n0: b.n0, n1: b.n1, f0: b.bar ? 0 : 0.5, f1: 1, bar: b.bar,
          late: ts.some(function (t) { return t.late; }), color: b.color, pri: Math.min.apply(null, ts.map(function (t) { return t.pri || 3; })),
          tip: ts.map(function (t) { return '· ' + t.title; }).slice(0, 12).join('\n') + (ts.length > 12 ? '\n… ' + (ts.length - 12) + '개 더' : '') });
      });
      list = list.filter(function (t) { return !bundled[t.key]; }).sort(function (a, b) { return a.n0 - b.n0 || a.f0 - b.f0; });
      list.forEach(function (t) {
        t.x0 = self.X(t.n0) + t.f0 * ppd;
        t.x1 = t.bar ? self.X(t.n1) + t.f1 * ppd : t.x0;
        var lw = Math.min(200, _mtlTextW(t.title) + (t.cluster ? 40 : 28));
        // 차지하는 끝 — 막대가 글보다 짧으면 글이 막대 오른쪽으로 나오므로 그만큼 더
        var end = t.bar ? t.x1 + (t.x1 - t.x0 < lw ? lw : 0) : t.x0 + 8 + lw;
        var start = t.bar ? t.x0 : t.x0 - 7;
        var r = 0;
        while (r < rows.length && rows[r] > start - 10) r++;   // 이름표 사이 10px
        if (r >= MWT_MAXROWS) { var dk = Math.round(t.x0 / 40); (over[dk] = over[dk] || { x: t.x0, n: 0, ts: [] }); over[dk].n++; over[dk].ts.push(t); return; }
        rows[r] = end;
        t.row = r;
        out += self.itemHtml(t, r);
      });
      Object.keys(over).forEach(function (k) {
        var v = over[k];
        out += '<button class="mtl-more" data-more="' + _mtlYmd(v.ts[0].n1) + '" style="left:' + (v.x - 4) + 'px;top:' + (MWT_MAXROWS * MWT_ROW + 2) + 'px" title="' + _mwEsc(v.ts.map(function (t) { return '· ' + t.title; }).join('\n')) + '">+' + v.n + '</button>';
      });
      // 지연 꼬리 — 마감 ~ 오늘
      list.forEach(function (t) {
        if (!t.late || t.row == null || t.bar) return;
        var xa = t.x0, xb = self.X(tn) + ppd / 2;
        if (xb > xa) out += '<div class="mtl-tail" style="left:' + xa + 'px;width:' + (xb - xa) + 'px;top:' + (t.row * MWT_ROW + MWT_ROW / 2 + 3) + 'px"></div>';
      });
    }
    var nrows = Math.max(1, rows.length) + (Object.keys(over).length ? 1 : 0);
    var cnt = list.length;
    h += '<div class="mtl-lane" data-lane="' + _mwEsc(l.id) + '" style="height:' + (nrows * MWT_ROW + 8) + 'px;--c:' + (l.color || '#94A3B8') + '">' +
      '<div class="mtl-ln" title="' + _mwEsc(l.name) + '"><i></i><span>' + (l.icon ? l.icon + ' ' : '') + _mwEsc(l.name) + '</span><b>' + (cnt || '') + '</b></div>' + out + '</div>';
  });
  this.cv.querySelector('.mtl-lanes').innerHTML = h;
};

MwTimeline.prototype.itemHtml = function (t, r) {
  if (t.cluster) {   // 묶음 — 막대 묶음은 막대 모양 그대로 + 개수
    var cw = t.bar ? 'width:' + Math.max(6, t.x1 - t.x0) + 'px;' : '';
    return '<div role="button" tabindex="0" class="mtl-cl' + (t.bar ? ' is-bar' : '') + (t.late ? ' is-late' : '') + '" data-cl="' + _mtlYmd(t.n1) + '" style="left:' + (t.bar ? t.x0 : t.x0 - 7) + 'px;' + cw + 'top:' + (r * MWT_ROW + 4) + 'px;--c:' + t.color + '" title="' + _mwEsc(t.tip) + '">' +
      (t.bar ? '' : '<i></i>') + '<b>' + t.cluster.length + '</b><span class="mtl-tx">' + _mwEsc(t.title) + '</span></div>';
  }
  var cls = 'mtl-it ' + (t.bar ? 'mtl-bar' : 'mtl-pt') + (t.late ? ' is-late' : '') + (t.done ? ' is-done' : '') + (t.pri === 1 ? ' is-urg' : t.pri === 2 ? ' is-hi' : '') +
    (t.drag ? ' can-drag' : '') + (t.key === _mw.sel ? ' mw-picked' : '') + (t.pending ? ' is-pending' : '');
  var top = r * MWT_ROW + 4;
  var tip = t.title + '\n' + (t.tip || '');
  var lbl = '<span class="mtl-tx">' + (t.icon ? '<em>' + t.icon + '</em>' : '') + _mwEsc(t.title) + '</span>';
  if (t.bar) {
    var w = Math.max(6, t.x1 - t.x0);
    return '<div class="' + cls + (w < 60 ? ' is-short' : '') + '" data-tk="' + _mwEsc(t.key) + '" style="left:' + t.x0 + 'px;width:' + w + 'px;top:' + top + 'px;--c:' + t.color + '" title="' + _mwEsc(tip) + '">' +
      (t.drag === 'bar' ? '<b class="mtl-h is-l" data-edge="l"></b><b class="mtl-h is-r" data-edge="r"></b>' : '') + lbl + '</div>';
  }
  return '<div class="' + cls + '" data-tk="' + _mwEsc(t.key) + '" style="left:' + (t.x0 - 7) + 'px;top:' + top + 'px;--c:' + t.color + '" title="' + _mwEsc(tip) + '"><i></i>' + lbl + '</div>';
};

/* ── 날짜 머리 · 바탕 (보이는 구간만) ─────────────────────────────── */
MwTimeline.prototype.view = function () {
  var sl = this.sc.scrollLeft, w = this.sc.clientWidth;
  return { n0: Math.floor(this.N(sl + this.L)), n1: Math.ceil(this.N(sl + w)), c: this.N(sl + this.L + (w - this.L) / 2) };
};
MwTimeline.prototype.drawAxis = function () {
  var self = this, st = this.st, ppd = st.ppd, v = this.view(), tn = _mtlNum(_mtlToday());
  var a = '', b = '', n0 = Math.max(this.from, v.n0 - 2), n1 = Math.min(this.to, v.n1 + 2);
  if (ppd < 6) {   // 년 — 달 · 해
    for (var n = n0 - 40; n <= n1; n++) {
      var d = _mtlYmd(n);
      if (d.slice(8) !== '01') continue;
      var x = this.X(n);
      a += '<span class="mtl-t1" style="left:' + x + 'px">' + (d.slice(5, 7) === '01' ? '<b>' + d.slice(0, 4) + '</b> ' : '') + (+d.slice(5, 7)) + '월</span>';
      b += '<i class="mtl-vl is-m" style="left:' + x + 'px"></i>';
    }
  } else {
    for (var m = n0; m <= n1; m++) {
      var dd = _mtlYmd(m), xx = this.X(m), dow = _mtlDow(m), hol = _mtlHol(dd);
      if (dd.slice(8) === '01' || m === n0) a += '<span class="mtl-t1" style="left:' + xx + 'px">' + dd.slice(0, 4) + '.' + (+dd.slice(5, 7)) + '</span>';
      var show = ppd >= 14 || dow === 1;
      if (show) a += '<span class="mtl-t2' + (dow === 0 || hol ? ' is-sun' : dow === 6 ? ' is-sat' : '') + (m === tn ? ' is-today' : '') + '" style="left:' + xx + 'px;width:' + (ppd >= 14 ? ppd : 7 * ppd) + 'px"' + (hol ? ' title="' + _mwEsc(hol) + '"' : '') + '>' +
        (ppd >= 60 ? (+dd.slice(5, 7)) + '/' + (+dd.slice(8, 10)) + ' ' + MWT_WD[dow] + (hol ? ' · ' + _mwEsc(hol) : '') : +dd.slice(8, 10)) + '</span>';
      if (dow === 0 || dow === 6 || hol) b += '<i class="mtl-we' + (hol ? ' is-hol' : '') + '" style="left:' + xx + 'px;width:' + ppd + 'px"></i>';
      if (ppd >= 14 || dow === 1) b += '<i class="mtl-vl' + (dow === 1 ? ' is-w' : '') + '" style="left:' + xx + 'px"></i>';
      if (ppd >= 60) for (var hh = 6; hh < 24; hh += 6) b += '<i class="mtl-vl is-h" style="left:' + (xx + hh / 24 * ppd) + 'px"></i>';
    }
  }
  var cd = _mtlYmd(v.c);
  this.cv.querySelector('.mtl-ax').innerHTML = '<div class="mtl-corner">' + (ppd < 6 ? cd.slice(0, 4) + '년' : cd.slice(0, 4) + '.' + (+cd.slice(5, 7))) + '</div>' + a;
  this.cv.querySelector('.mtl-bg').innerHTML = b;
  st.center = v.c;
  this.save();
  if (this.o.calendar && st.cal) this.drawBand();
};

/* ── 접었을 때 — 다음 8주 밀도 막대 ─────────────────────────────── */
MwTimeline.prototype.drawDensity = function () {
  var tn = _mtlNum(_mtlToday()), by = this.byDay, h = '';
  for (var n = tn - 7; n < tn + 49; n++) {
    var d = _mtlYmd(n), ts = by[d] || [], late = ts.some(function (t) { return t.late; });
    h += '<button class="mtl-dc' + (n === tn ? ' is-today' : '') + (late ? ' is-late' : '') + '" data-dd="' + d + '" style="--k:' + Math.min(1, ts.length / 5) + '" title="' + _mwEsc(_mtlFmt(n, 30) + ' · ' + ts.length + '개') + '"></button>';
  }
  var el = this.el.querySelector('.mtl-dens');
  el.innerHTML = '<span class="mtl-dl0">지난주</span>' + h + '<span class="mtl-dl0">7주 뒤</span>';
  el.hidden = false;
};

/* ── 줌 · 이동 ────────────────────────────────────────────────────── */
MwTimeline.prototype.zoomTo = function (ppd, clientX) {
  var st = this.st, r = this.sc.getBoundingClientRect();
  var ax = clientX != null ? clientX - r.left : this.L + (r.width - this.L) / 2;
  ax = Math.max(this.L, ax);
  var n = this.N(this.sc.scrollLeft + ax);
  st.ppd = Math.max(MWT_MIN, Math.min(MWT_MAX, ppd));
  // 그 날짜가 마우스 아래 그대로 있게 — 가운데로 환산해 update 에 맡김
  st.center = n + ((this.L + (r.width - this.L) / 2) - ax) / st.ppd;
  this.update();
  this.save(true);
};
MwTimeline.prototype.goDate = function (d, pick) {
  this.st.center = _mtlNum(d) + 0.5;
  this.update();
  if (pick) this.setPick(d);
};

/* ── 안내선 · 고른 날 ─────────────────────────────────────────────── */
MwTimeline.prototype.drawPick = function () {
  var g = this.el.querySelector('.mtl-guide.is-pick');
  if (!this.pick) { g.hidden = true; return; }
  var n = _mtlNum(this.pick);
  g.hidden = false;
  g.style.left = (this.X(n) + this.st.ppd / 2) + 'px';
  g.querySelector('span').textContent = '📌 ' + _mtlFmt(n, this.st.ppd);
};
MwTimeline.prototype.setPick = function (d) {
  this.pick = d;
  this.drawPick();
  if (this.o.calendar) {
    if (this.st.link) this.calMonth = d.slice(0, 7);
    this.drawCal();
  }
};
MwTimeline.prototype.hoverAt = function (clientX) {
  var r = this.sc.getBoundingClientRect(), x = this.sc.scrollLeft + clientX - r.left;
  var g = this.el.querySelector('.mtl-guide.is-hover');
  if (x < this.sc.scrollLeft + this.L) { g.hidden = true; return null; }
  var nf = this.N(x), n = Math.floor(nf), min = (nf - n) * 1440;
  var ppd = this.st.ppd;
  var snap = ppd >= 60 ? this.X(n) + Math.round(min / 30) * 30 / 1440 * ppd : this.X(n) + ppd / 2;
  g.hidden = false;
  g.style.left = snap + 'px';
  var label = ppd < 6 ? _mtlFmt(n, ppd) + ' ' + (Math.floor((+_mtlYmd(n).slice(8, 10) - 1) / 7) + 1) + '주' : _mtlFmt(n, ppd, Math.round(min / 30) * 30);
  g.querySelector('span').textContent = label;
  var d = _mtlYmd(n);
  // 🔗 연동 — 잠깐 머물면 달력이 그 해 · 달로 넘어가고 그날을 옅게
  if (this.o.calendar && this.st.link && this.st.cal && this.hover !== d) {
    var self = this;
    this.hover = d;
    clearTimeout(this._hovT);
    this._hovT = setTimeout(function () { if (self.hover === d) { self.calMonth = d.slice(0, 7); self.drawCal(); } }, 220);
  }
  return d;
};

/* ═══ 이벤트 묶기 ═══ */
MwTimeline.prototype.bind = function () {
  var self = this, el = this.el, sc = this.sc;
  var raf = null;
  sc.addEventListener('scroll', function () {
    if (self._lock) return;
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = null; self.drawAxis(); self.maybeLoad(); });
  });
  // 머리 단추
  el.querySelector('.mtl-hd').addEventListener('click', function (e) {
    var b = e.target.closest('[data-t]');
    if (!b) return;
    var t = b.getAttribute('data-t'), st = self.st;
    if (t === 'fold') { st.collapsed = !st.collapsed; self.save(true); if (!st.collapsed) self.el.querySelector('.mtl-dens').hidden = true; self.update(); return; }
    if (t === 'lv') { self.zoomTo(MWT_PPD[b.getAttribute('data-v')]); return; }
    if (t === 'prev' || t === 'next') { self.sc.scrollBy({ left: (t === 'prev' ? -1 : 1) * (self.sc.clientWidth - self.L - 40), behavior: 'smooth' }); return; }
    if (t === 'today') { self.st.center = null; self.pick = null; self.calMonth = null; self.update(); self.save(true); return; }
    if (t === 'more') { self.moreMenu(b); return; }
  });
  el.querySelector('.mtl-hd').addEventListener('change', function (e) {
    var t = e.target.getAttribute('data-t');
    if (t === 'go' && e.target.value) { self.goDate(e.target.value, true); e.target.value = ''; }
    if (t === 'link') { self.st.link = e.target.checked; self.save(true); if (self.st.link && self.pick) self.calMonth = self.pick.slice(0, 7); if (self.o.calendar) self.drawCal(); }
  });
  el.querySelector('.mtl-dens').addEventListener('click', function (e) {
    var c = e.target.closest('[data-dd]');
    if (!c) return;
    self.st.collapsed = false; self.el.querySelector('.mtl-dens').hidden = true;
    self.goDate(c.getAttribute('data-dd'), true);
  });
  // Ctrl+휠 (트랙패드 집기 포함) = 확대 · 축소, 마우스 아래 날짜 기준
  sc.addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    self.zoomTo(self.st.ppd * Math.exp(-e.deltaY * 0.0022), e.clientX);
  }, { passive: false });
  // 키보드
  sc.addEventListener('keydown', function (e) {
    var ppd = self.st.ppd;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      var step = e.shiftKey ? sc.clientWidth - self.L - 40 : Math.max(ppd, 40);
      sc.scrollLeft += e.key === 'ArrowLeft' ? -step : step;
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); self.zoomTo(ppd * 1.6); }
    else if (e.key === '-') { e.preventDefault(); self.zoomTo(ppd / 1.6); }
  });
  // 마우스 — 안내선
  sc.addEventListener('mousemove', function (e) { if (!self._drag && !self._pan) self.hoverAt(e.clientX); });
  sc.addEventListener('mouseleave', function () { el.querySelector('.mtl-guide.is-hover').hidden = true; self.hover = null; });

  // 끌기 — 빈 곳 = 가로 이동, 항목 = 마감 · 기간 바꾸기 (마우스). 손가락은 아래 touch
  sc.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    var it = e.target.closest('.mtl-it');
    if (e.target.closest('.mtl-ln, .mtl-agg, .mtl-more, .mtl-cl')) return;
    if (it && it.classList.contains('can-drag')) { self.startDrag(e, it, e.target.getAttribute('data-edge') || 'move'); return; }
    if (it) return;
    var sx = e.clientX, sl = sc.scrollLeft, moved = false;
    self._pan = true;
    function mv(ev) { var dx = ev.clientX - sx; if (Math.abs(dx) > 4) moved = true; if (moved) { sc.scrollLeft = sl - dx; sc.classList.add('is-panning'); } }
    function up() {
      document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
      sc.classList.remove('is-panning');
      self._pan = false;
      if (moved) self._noClick = Date.now();
    }
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  });
  // 손가락 — 두 손가락 = 확대 · 축소, 길게 눌러 끌기 = 마감 바꾸기 (그 외는 브라우저 기본 가로 스크롤)
  var pinch = null, lp = null;
  sc.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
      clearTimeout(lp && lp.t); lp = null;
      var a = e.touches[0], b = e.touches[1];
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, ppd: self.st.ppd, cx: (a.clientX + b.clientX) / 2 };
      return;
    }
    var it = e.target.closest('.mtl-it.can-drag');
    if (!it || e.touches.length !== 1) return;
    var t0 = e.touches[0];
    lp = { it: it, x: t0.clientX, y: t0.clientY, edge: e.target.getAttribute('data-edge') || 'move' };
    lp.t = setTimeout(function () { if (lp) { lp.on = true; if (navigator.vibrate) navigator.vibrate(10); self.startDrag({ clientX: lp.x, touch: true }, lp.it, lp.edge); } }, 380);
  }, { passive: true });
  sc.addEventListener('touchmove', function (e) {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      var a = e.touches[0], b = e.touches[1];
      self.zoomTo(pinch.ppd * (Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d), pinch.cx);
      return;
    }
    if (!lp) return;
    var t = e.touches[0];
    if (!lp.on) { if (Math.abs(t.clientX - lp.x) > 8 || Math.abs(t.clientY - lp.y) > 8) { clearTimeout(lp.t); lp = null; } return; }
    e.preventDefault();
    if (self._drag) self._drag.move(t.clientX);
  }, { passive: false });
  sc.addEventListener('touchend', function () {
    pinch = null;
    if (lp) { clearTimeout(lp.t); if (lp.on && self._drag) self._drag.end(); lp = null; }
  });

  // 누르기
  sc.addEventListener('click', function (e) {
    if (self._noClick && Date.now() - self._noClick < 300) return;
    var ag = e.target.closest('[data-agg]');
    if (ag) { self.st.center = +ag.getAttribute('data-agg') + 3.5; self.zoomTo(MWT_PPD.month); return; }
    var cl = e.target.closest('[data-cl]');
    if (cl) {   // 묶음 — 달력이 있으면 그날 목록, 없으면 주 줌으로 확대
      var cdd = cl.getAttribute('data-cl');
      if (self.o.calendar && self.st.cal) { self.calMonth = cdd.slice(0, 7); self.setPick(cdd); }
      else { self.st.center = _mtlNum(cdd) + 0.5; self.zoomTo(MWT_PPD.week); }
      return;
    }
    var mo = e.target.closest('[data-more]');
    if (mo) { self.goDate(mo.getAttribute('data-more'), true); if (self.st.ppd < 60) self.zoomTo(MWT_PPD.week); return; }
    var it = e.target.closest('.mtl-it');
    if (it) { var t = self.find(it.getAttribute('data-tk')); if (t) self.o.onOpen(t, self); return; }
    if (e.target.closest('.mtl-ln')) return;
    var d = self.hoverAt(e.clientX);
    if (d) {
      if (self.o.calendar && self.st.link) self.setPick(d);
      else { self.pick = d; self.drawPick(); if (self.o.calendar) self.drawCal(); }
    }
  });
  sc.addEventListener('dblclick', function (e) {
    if (e.target.closest('.mtl-it, .mtl-ln, .mtl-agg, .mtl-more, .mtl-cl') || !self.o.onAdd) return;
    var d = self.hoverAt(e.clientX);
    if (d) self.o.onAdd(d, e.clientX, e.clientY, self);
  });
  // 높이 조절
  el.querySelector('.mtl-rs').addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var sy = e.clientY, h0 = self.st.height, main = el.querySelector('.mtl-main');
    function mv(ev) { self.st.height = Math.max(140, Math.min(Math.round(window.innerHeight * 0.75), h0 + ev.clientY - sy)); main.style.height = self.st.height + 'px'; }
    function up() { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); self.save(true); }
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  });
  if (this.o.calendar) this.bindCal();
};
/** ⋯ 메뉴 — 줄 나누기 · 옆 달력 · 날짜로 가기 · 확대 · 축소 */
MwTimeline.prototype.moreMenu = function (anchor) {
  var self = this, st = this.st, o = this.o, h = '';
  if (o.groups) h += '<div class="mw-pmenu-n">줄 나누기</div>' + [['cat', '칸 (보드 카테고리)'], ['src', '출처 (맵 · 이슈 · 회의 …)'], ['pack', '한 줄로 촘촘히']].map(function (x) {
    return '<button data-v="g:' + x[0] + '"' + (st.group === x[0] ? ' class="on"' : '') + '>' + (st.group === x[0] ? '● ' : '○ ') + x[1] + '</button>';
  }).join('');
  if (o.calendar) h += '<div class="mw-pmenu-n">보기</div><button data-v="cal">📅 옆 달력 ' + (st.cal ? '숨기기' : '보이기') + '</button>';
  h += '<button data-v="go">📆 날짜로 가기…</button><button data-v="zi">＋ 확대</button><button data-v="zo">− 축소</button>';
  mwPopMenu(anchor, h, function (v) {
    if (v.slice(0, 2) === 'g:') { st.group = v.slice(2); self.save(true); self.update(); return; }
    if (v === 'cal') { st.cal = !st.cal; self.save(true); self.update(); return; }
    if (v === 'zi') return self.zoomTo(st.ppd * 1.6);
    if (v === 'zo') return self.zoomTo(st.ppd / 1.6);
    if (v === 'go') { var g = self.el.querySelector('.mtl-go'); try { g.showPicker(); } catch (_) { g.focus(); g.click(); } }
  }, { id: 'mwtMore', key: 'mwt:' + o.ls });
};
MwTimeline.prototype.find = function (k) { for (var i = 0; i < this.items.length; i++) if (this.items[i].key === k) return this.items[i]; return null; };

/* ── 항목 끌기 — 하루 단위 (◆ = 마감, 막대 = 옮기기 · 양 끝) ─────── */
MwTimeline.prototype.startDrag = function (e, node, edge) {
  var self = this, t = this.find(node.getAttribute('data-tk'));
  if (!t) return;
  var ppd = this.st.ppd, sx = e.clientX, shift = 0, moved = false;
  var left0 = parseFloat(node.style.left), w0 = parseFloat(node.style.width) || 0;
  var at = this.el.querySelector('.mtl-guide.is-hover span'), ag = this.el.querySelector('.mtl-guide.is-hover');
  var d = this._drag = {
    move: function (cx) {
      var dx = cx - sx;
      if (Math.abs(dx) > 4) moved = true;
      if (!moved) return;
      node.classList.add('is-drag');
      shift = Math.round(dx / ppd);
      if (edge === 'l') { var s = Math.min(shift, t.n1 - t.n0); shift = s; node.style.left = (left0 + s * ppd) + 'px'; node.style.width = Math.max(6, w0 - s * ppd) + 'px'; }
      else if (edge === 'r') { var s2 = Math.max(shift, t.n0 - t.n1); shift = s2; node.style.width = Math.max(6, w0 + s2 * ppd) + 'px'; }
      else node.style.left = (left0 + shift * ppd) + 'px';
      var base = edge === 'l' ? t.n0 : t.n1;
      ag.hidden = false; ag.style.left = (self.X(base + shift) + ppd / 2) + 'px';
      at.textContent = (edge === 'l' ? '시작 ' : edge === 'r' || !t.bar ? '마감 ' : '옮기기 ') + _mtlFmt(base + shift, 30) + (shift ? ' (' + (shift > 0 ? '+' : '') + shift + '일)' : '');
    },
    end: function () {
      self._drag = null;
      node.classList.remove('is-drag');
      if (moved) self._noClick = Date.now();
      if (moved && shift) self.o.onMove(t, edge, shift, self); else if (moved) { node.style.left = left0 + 'px'; if (w0) node.style.width = w0 + 'px'; }
    }
  };
  if (e.touch) return;
  function mv(ev) { d.move(ev.clientX); }
  function up() { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); d.end(); }
  document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
};

/* ═══ 옆 달력 ═══ */
MwTimeline.prototype.calBase = function () {
  return this.calMonth || (this.pick ? this.pick.slice(0, 7) : _mtlYmd(this.st.center != null ? this.st.center : _mtlNum(_mtlToday())).slice(0, 7));
};
MwTimeline.prototype.drawCal = function () {
  var cal = this.el.querySelector('.mtl-cal');
  if (!cal || !this.st.cal) return;
  var self = this, ym = this.calBase(), today = _mtlToday(), by = this.byDay;
  var narrow = _mtlNarrow(), h = '';
  var year = this.st.ppd < 6;
  h += '<div class="mtl-cal-hd"><button data-cn="-1" title="이전">◀</button><b>' + (year ? ym.slice(0, 4) + '년' : ym.slice(0, 4) + '.' + (+ym.slice(5, 7))) + '</b><button data-cn="1" title="다음">▶</button>' +
    (narrow ? '<button data-cn="open" class="mtl-cal-open">' + (this.st.calOpen ? '▴ 접기' : '▾ 달') + '</button>' : '') + '</div>';
  if (year) {
    // 년 줌 — 12달 칸 (누르면 그 달로 확대)
    var y = ym.slice(0, 4);
    h += '<div class="mtl-cal-y">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) {
      var k = y + '-' + String(m).padStart(2, '0'), n = 0, late = 0;
      Object.keys(by).forEach(function (d) { if (d.slice(0, 7) === k) { n += by[d].length; late += by[d].filter(function (t) { return t.late; }).length; } });
      return '<button class="mtl-cm' + (today.slice(0, 7) === k ? ' is-today' : '') + '" data-cm="' + k + '"><span>' + m + '월</span><b' + (late ? ' class="is-late"' : '') + '>' + (n || '') + '</b></button>';
    }).join('') + '</div>';
  } else {
    var first = _mtlNum(ym + '-01'), g0 = first - _mtlDow(first);
    var cells = 42;
    if (narrow && !this.st.calOpen) {   // 휴대폰 — 고른 날(없으면 가운데 날)이 든 한 주만
      var base = this.pick ? _mtlNum(this.pick) : Math.floor(this.st.center || _mtlNum(today));
      g0 = base - _mtlDow(base); cells = 7;
    }
    h += '<div class="mtl-cal-g"><div class="mtl-cal-w">' + MWT_WD.split('').map(function (w, i) { return '<span' + (i === 0 ? ' class="is-sun"' : i === 6 ? ' class="is-sat"' : '') + '>' + w + '</span>'; }).join('') + '</div><div class="mtl-cal-d">';
    for (var i = 0; i < cells; i++) {
      var n = g0 + i, d = _mtlYmd(n), ts = by[d] || [], dow = i % 7, hol = _mtlHol(d);
      var dots = ts.slice(0, 3).map(function (t) { return '<i style="background:' + (t.late ? '#DC2626' : t.ev ? (t.color || '#06B6D4') : t.pri <= 2 ? '#F97316' : '#94A3B8') + '"></i>'; }).join('');
      h += '<button class="mtl-cd' + (d.slice(0, 7) !== ym && cells === 42 ? ' is-out' : '') + (d === today ? ' is-today' : '') + (dow === 0 || hol ? ' is-sun' : dow === 6 ? ' is-sat' : '') +
        (d === self.pick ? ' is-pick' : '') + (d === self.hover && self.st.link ? ' is-hover' : '') + '" data-cd="' + d + '" title="' + _mwEsc(d + (hol ? ' ' + hol : '') + (ts.length ? ' · ' + ts.length + '개' : '')) + '">' +
        '<span>' + (+d.slice(8, 10)) + '</span><em>' + (ts.length > 3 ? '<b>' + ts.length + '</b>' : dots) + '</em></button>';
    }
    h += '</div></div>';
  }
  // 고른 날 목록
  if (this.pick) {
    var list = (by[this.pick] || []).slice().sort(function (a, b) { return (a.time || '99').localeCompare(b.time || '99'); });
    var pn = _mtlNum(this.pick);
    h += '<div class="mtl-dl"><div class="mtl-dl-h">📌 ' + _mtlFmt(pn, 30) + (_mtlHol(this.pick) ? ' · ' + _mwEsc(_mtlHol(this.pick)) : '') + ' <i>' + list.length + '개</i>' +
      (this.o.onAdd ? '<button data-cadd="' + this.pick + '" title="이날 마감 할 일">＋</button>' : '') + '</div>' +
      (list.length ? list.map(function (t) {
        return '<button class="mtl-dli' + (t.late ? ' is-late' : '') + (t.done ? ' is-done' : '') + '" data-ctk="' + _mwEsc(t.key) + '"><i style="background:' + t.color + '"></i>' + (t.time ? '<b>' + _mwEsc(t.time) + '</b>' : '') + (t.icon ? t.icon + ' ' : '') + _mwEsc(t.title) + '</button>';
      }).join('') : '<div class="mtl-dl-e">마감 · 일정 없음</div>') + '</div>';
  }
  cal.innerHTML = h;
  this.drawBand();
};
/** 달력에 타임라인이 보는 기간 띠 */
MwTimeline.prototype.drawBand = function () {
  var cal = this.el.querySelector('.mtl-cal');
  if (!cal) return;
  var v = this.view();
  var a = _mtlYmd(v.n0), b = _mtlYmd(v.n1 - 1);
  cal.querySelectorAll('[data-cd]').forEach(function (c) { var d = c.getAttribute('data-cd'); c.classList.toggle('is-view', d >= a && d <= b); });
  cal.querySelectorAll('[data-cm]').forEach(function (c) { var m = c.getAttribute('data-cm'); c.classList.toggle('is-view', m >= a.slice(0, 7) && m <= b.slice(0, 7)); });
};
MwTimeline.prototype.bindCal = function () {
  var self = this, cal = this.el.querySelector('.mtl-cal');
  cal.addEventListener('click', function (e) {
    var t = e.target;
    var cn = t.closest('[data-cn]');
    if (cn) {
      var v = cn.getAttribute('data-cn');
      if (v === 'open') { self.st.calOpen = !self.st.calOpen; self.drawCal(); return; }
      var ym = self.calBase(), y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
      if (self.st.ppd < 6) y += +v; else m += +v;
      var nd = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
      self.calMonth = nd;
      if (self.st.link) { self.st.center = _mtlNum(nd + '-15'); self.update(); } else self.drawCal();
      return;
    }
    var cm = t.closest('[data-cm]');
    if (cm) { self.calMonth = cm.getAttribute('data-cm'); self.st.center = _mtlNum(self.calMonth + '-15'); self.zoomTo(MWT_PPD.month); return; }
    var ca = t.closest('[data-cadd]');
    if (ca) { var r = ca.getBoundingClientRect(); self.o.onAdd(ca.getAttribute('data-cadd'), r.left, r.bottom, self); return; }
    var ct = t.closest('[data-ctk]');
    if (ct) { var it = self.find(ct.getAttribute('data-ctk')); if (it) self.o.onOpen(it, self); return; }
    var cd = t.closest('[data-cd]');
    if (cd) {
      var d = cd.getAttribute('data-cd');
      if (self.st.link) self.goDate(d, true);   // 🔗 연동 — 타임라인이 그날로
      else { self.pick = d; self.drawCal(); self.drawPick(); }
    }
  });
  cal.addEventListener('dblclick', function (e) {
    var cd = e.target.closest('[data-cd]');
    if (cd && self.o.onAdd) { var r = cd.getBoundingClientRect(); self.o.onAdd(cd.getAttribute('data-cd'), r.left, r.bottom, self); }
  });
};

/* ── 일정 범위 넓히기 (내 업무 것만) ─────────────────────────────── */
MwTimeline.prototype.maybeLoad = function () { if (this.o.loadMore) this.o.loadMore(this.view(), this); };

/* ═══ 내 업무 — 데이터 · 동작 ═══ */
var _mtlEv = { uid: null, from: null, to: null, rows: [], busy: false };
/** 타임라인용 내 일정 (달력 보기와 따로 — 넓은 기간). 400일씩 */
function mwtLoadEvents(from, to, force) {
  var uid = _mw.userId || _mwMe();
  if (!force && _mtlEv.uid === uid && _mtlEv.from && from >= _mtlEv.from && to <= _mtlEv.to) return Promise.resolve(false);
  if (_mtlEv.busy) return Promise.resolve(false);
  if (_mtlEv.uid !== uid || force) { _mtlEv.from = null; _mtlEv.to = null; _mtlEv.rows = []; }
  var f = _mtlEv.from && from >= _mtlEv.from ? _mtlEv.to : from;
  var t = _mtlEv.to && to <= _mtlEv.to ? _mtlEv.from : to;
  if (f > t) { var x = f; f = t; t = x; }
  if (_mwDays(f, t) > 399) t = _mtlYmd(_mtlNum(f) + 399);
  _mtlEv.busy = true;
  var q = '?from=' + f + '&to=' + t + (uid && uid !== _mwMe() ? '&userId=' + encodeURIComponent(uid) : '');
  return apiFetch('/api/my-work/events' + q).then(function (r) {
    _mtlEv.busy = false;
    if ((_mw.userId || _mwMe()) !== uid) return false;
    var rows = typeof toCamelArray === 'function' ? toCamelArray((r && r.data) || []) : ((r && r.data) || []);
    var have = {};
    _mtlEv.rows.forEach(function (e) { have[e.id] = true; });
    rows.forEach(function (e) { if (!have[e.id]) _mtlEv.rows.push(e); else _mtlEv.rows = _mtlEv.rows.map(function (o) { return o.id === e.id ? e : o; }); });
    _mtlEv.uid = uid;
    _mtlEv.from = _mtlEv.from && _mtlEv.from < f ? _mtlEv.from : f;
    _mtlEv.to = _mtlEv.to && _mtlEv.to > t ? _mtlEv.to : t;
    return true;
  }).catch(function () { _mtlEv.busy = false; return false; });
}
/** 일정을 고친 뒤 (달력 · 등록 창) — 타임라인 일정도 새로 */
function mwTimelineEvReload() {
  if (!_mtlMain) return;
  var v = _mtlMain.from != null ? _mtlMain.view() : null;
  var c = v ? _mtlYmd(v.c) : _mtlToday();
  mwtLoadEvents(_mtlYmd(_mtlNum(c) - 120), _mtlYmd(_mtlNum(c) + 270), true).then(function (ch) { if (ch && _mtlMain.el && _mtlMain.el.isConnected) _mtlMain.update(); });
}

function _mtlTaskOf(it, grp, today) {
  var col = grp === 'cat' && typeof mwBoardColOf === 'function' ? mwBoardColOf(it) : null;
  if (grp === 'cat' && !col) grp = 'pack';
  var start = it.start && it.due && it.start < it.due ? it.start : null;
  var d = it.due || it.start;
  if (!d) return null;
  var s = MW_SRC[it.src] || {};
  var self = _mw.data && _mw.data.self;
  var bar = !!start;
  var n0 = _mtlNum(start || d), n1 = _mtlNum(d);
  var tm = !bar && it.dueTime ? _mtlMin(it.dueTime) : null;
  return {
    key: it.key, it: it, title: it.title, icon: s.icon, lane: grp === 'cat' ? col.id : grp === 'src' ? it.src : 'all',
    color: grp === 'cat' ? (MW_CAT_COLORS[col.color] || '#94A3B8') : (MWT_SRC_COLOR[it.src] || '#94A3B8'),
    bar: bar, n0: n0, n1: n1, f0: bar ? 0 : (tm != null ? tm / 1440 : 0.5), f1: 1, time: it.dueTime || null,
    late: !it.done && it.due && it.due < today, done: !!it.done, pri: it.pri || 3, pending: !!it.pending,
    drag: !self || it.done || it.pending ? null : (bar ? (it.src === 'todo' ? 'bar' : null) : (_mwpCanDue(it) ? 'pt' : null)),
    tip: (s.label || '') + (it.ctx ? ' · ' + it.ctx : '') + (start ? '\n' + start + ' ~ ' + d : it.due ? '\n마감 ' + _mwDueLabel(it.due, today) + (it.dueTime ? ' ' + it.dueTime : '') : '') + (it.done ? ' · 완료' : '')
  };
}
function _mtlEvTasks(grp, from, to) {
  if (!_mtlEv.rows.length || typeof expandRepeatingEvents !== 'function') return [];
  var orig = {};
  _mtlEv.rows.forEach(function (e) { orig[e.id] = e; });
  var types = typeof EVT_TYPE !== 'undefined' ? EVT_TYPE : {};
  return expandRepeatingEvents(_mtlEv.rows.slice(), from, to).map(function (o) {
    var ev = orig[o._origId || o.id] || o, end = o.endDate && o.endDate >= o.startDate ? o.endDate : o.startDate;
    var ty = types[ev.type] || { color: '#06B6D4', icon: '📅', label: '일정' };
    var multi = end > o.startDate, timed = !!ev.startTime;
    var f0 = timed ? _mtlMin(ev.startTime) / 1440 : 0, f1 = timed && ev.endTime && !multi ? _mtlMin(ev.endTime) / 1440 : 1;
    return { key: 'ev:' + ev.id + ':' + o.startDate, ev: ev, occ: o.startDate, title: ev.title || ty.label, icon: ty.icon, color: ty.color,
      lane: grp === 'pack' ? 'all' : '__ev', bar: multi || timed, n0: _mtlNum(o.startDate), n1: _mtlNum(end), f0: f0, f1: multi ? 1 : Math.max(f1, f0 + 0.02),
      time: ev.startTime || null, late: false, done: false, pri: 3,
      drag: ev.canModify && _mw.data && _mw.data.self ? 'ev' : null,
      tip: ty.label + (ev.location ? ' · ' + ev.location : '') + '\n' + o.startDate + (end !== o.startDate ? ' ~ ' + end : '') + (ev.startTime ? ' ' + ev.startTime + (ev.endTime ? '~' + ev.endTime : '') : '') };
  });
}

var _mtlMain = null;
function _mtlMainInst() {
  if (_mtlMain) return _mtlMain;
  _mtlMain = new MwTimeline({
    id: 'mwTimeline', ls: 'main', title: '타임라인', calendar: true, groups: true,
    lanes: function (tl) {
      var g = tl.st.group, ev = { id: '__ev', name: '일정', icon: '📅', color: '#06B6D4' };
      if (g === 'pack') return [{ id: 'all', name: '전체', icon: '🎯', color: '#6366F1', keep: true }];
      if (g === 'src') return Object.keys(MW_SRC).map(function (k) { return { id: k, name: MW_SRC[k].label, icon: MW_SRC[k].icon, color: MWT_SRC_COLOR[k] }; }).concat([ev]);
      var cols = (typeof mwBoardCols === 'function' ? mwBoardCols() : []).map(function (c) { return { id: c.id, name: c.name, icon: c.icon, color: MW_CAT_COLORS[c.color] || '#94A3B8', keep: true }; });
      return cols.concat([{ id: 'none', name: MW_NONE_COL.name, icon: MW_NONE_COL.icon, color: '#94A3B8' }, ev]);
    },
    items: function (tl) {
      var today = _mtlToday(), g = tl.st.group, out = [];
      var showDone = typeof _mwbShowDone === 'function' && _mwbShowDone();
      if (_mw.src !== 'event') (typeof mwVisibleItems === 'function' ? mwVisibleItems() : (_mw.data.data || [])).forEach(function (it) {
        if (it.done && !showDone) return;
        var t = _mtlTaskOf(it, g, today);
        if (t) out.push(t);
      });
      if (_mw.src === 'all' || _mw.src === 'event') {
        var tn = _mtlNum(today);
        out = out.concat(_mtlEvTasks(g, _mtlEv.from || _mtlYmd(tn - 90), _mtlEv.to || _mtlYmd(tn + 300)));
      }
      return out;
    },
    onOpen: function (t) {
      if (t.ev) { if (typeof _mwcEventModal === 'function') _mwcEventModal(t.ev.id, t.occ); return; }
      if (typeof mwPanelOpen === 'function') mwPanelOpen(t.it); else mwOpenItem(t.it);
    },
    onMove: function (t, edge, shift) {
      if (t.ev) { if (typeof _mwcMoveEvent === 'function') _mwcMoveEvent({ ev: t.ev, occ: t.occ }, _mtlYmd(_mtlNum(t.occ) + shift)); return; }
      var it = t.it;
      if (t.drag === 'bar') {
        var s = it.start, d = it.due;
        if (edge === 'l') s = _mtlYmd(_mtlNum(s) + shift);
        else if (edge === 'r') d = _mtlYmd(_mtlNum(d) + shift);
        else { s = _mtlYmd(_mtlNum(s) + shift); d = _mtlYmd(_mtlNum(d) + shift); }
        if (s > d) s = d;
        mwSetTodoRange(it, s, d);
        return;
      }
      mwSetDue(it, _mtlYmd(_mtlNum(it.due) + shift));
    },
    onAdd: function (date, x, y) { if (_mw.data && _mw.data.self) mwtQuickAdd(date, x, y); },
    loadMore: function (v) {
      if (_mtlEv.from && _mtlYmd(v.n0) >= _mtlEv.from && _mtlYmd(v.n1) <= _mtlEv.to) return;
      clearTimeout(_mtlMain._ldT);
      _mtlMain._ldT = setTimeout(function () {
        var c = Math.floor(v.c);
        mwtLoadEvents(_mtlYmd(c - 150), _mtlYmd(c + 240)).then(function (ch) { if (ch) _mtlMain.update(); });
      }, 250);
    }
  });
  return _mtlMain;
}
/** 내 업무 화면을 다시 그린 뒤 (my-work.js _mwPaint) — 자리에 붙이고 새로 */
function mwTimelineMount(el) {
  var slot = el.querySelector('#mwtSlot');
  if (!slot || !_mw.data) return;
  var tl = _mtlMainInst();
  var uid = _mw.userId || _mwMe();
  if (_mtlEv.uid !== uid) {
    _mtlEv.rows = []; _mtlEv.from = null; _mtlEv.to = null;
    var tn = _mtlNum(_mtlToday());
    mwtLoadEvents(_mtlYmd(tn - 90), _mtlYmd(tn + 300)).then(function (ch) { if (ch && tl.el && tl.el.isConnected) tl.update(); });
  }
  tl.mount(slot);
}

/** 할 일 시작 ~ 마감 함께 (막대 끌기) — 되돌리기 */
function mwSetTodoRange(it, start, due) {
  var prev = { start: it.start || null, due: it.due || null };
  _mwpApply(it, { startDate: start, dueDate: due });
  _mwPaint();
  apiFetch('/api/my-work/todos/' + encodeURIComponent(it.id), { method: 'PUT', body: JSON.stringify({ startDate: start, dueDate: due }) }).then(function () {
    mwUndoToast('📆 ' + (+start.slice(5, 7)) + '/' + (+start.slice(8, 10)) + ' ~ ' + (+due.slice(5, 7)) + '/' + (+due.slice(8, 10)), function () { mwSetTodoRange(it, prev.start, prev.due); });
  }).catch(function (e) { _mwpApply(it, { startDate: prev.start, dueDate: prev.due }); _mwPaint(); _mwToast('❌ ' + _mwErr(e), 'error'); });
}

/** 빈 날 두 번 누르기 · 달력 ＋ — 그 자리에 작은 입력 칸 → 그날 마감 할 일 */
function mwtQuickAdd(date, x, y) {
  var old = document.getElementById('mwtQa');
  if (old) old.remove();
  var f = document.createElement('form');
  f.id = 'mwtQa'; f.className = 'mtl-qa';
  f.innerHTML = '<b>' + _mwEsc(_mtlFmt(_mtlNum(date), 30)) + ' 마감</b><input class="mw-input" maxlength="500" placeholder="할 일 — Enter" autocomplete="off">';
  document.body.appendChild(f);
  f.style.left = Math.max(8, Math.min(window.innerWidth - f.offsetWidth - 8, x - 20)) + 'px';
  f.style.top = Math.max(8, Math.min(window.innerHeight - f.offsetHeight - 8, y + 8)) + 'px';
  var inp = f.querySelector('input');
  inp.focus();
  function close() { f.remove(); document.removeEventListener('mousedown', off); }
  function off(e) { if (!f.contains(e.target)) close(); }
  setTimeout(function () { document.addEventListener('mousedown', off); }, 0);
  inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  f.onsubmit = function (e) {
    e.preventDefault();
    var raw = inp.value.trim();
    if (!raw) return;
    var q = typeof QuickParse !== 'undefined' ? QuickParse.parse(raw, _mtlToday()) : { title: raw };
    close();
    mwAddTodo({ title: q.title || raw, dueDate: date, dueTime: q.time || null, priority: q.priority || 3 }).then(function () {
      _mwToast('✏️ ' + (+date.slice(5, 7)) + '/' + (+date.slice(8, 10)) + ' 마감 — ' + (q.title || raw));
    }).catch(function (er) { _mwToast('❌ 추가하지 못했습니다 — ' + _mwErr(er), 'error'); });
  };
}

/* ═══ 업무 부하 — 팀원별 줄 (읽기 전용, 달력 없음) ═══ */
var _mtlLoad = null;
function mwLoadTimelineMount(el) {
  var slot = el.querySelector('#mwtLoadSlot');
  if (!slot || !_mw.load) return;
  if (!_mtlLoad) _mtlLoad = new MwTimeline({
    id: 'mwLoadTimeline', ls: 'load', title: '팀 타임라인',
    lanes: function () {
      return (_mw.load.users || []).map(function (u) { return { id: u.id, name: u.name, icon: '👤', color: '#6366F1', keep: true }; });
    },
    items: function () {
      var L = _mw.load, today = L.today || _mtlToday(), out = [];
      (L.items || []).forEach(function (it) {
        if (it.done || !(it.due || it.start)) return;
        var t = _mtlTaskOf(Object.assign({}, it, { key: it.key }), 'src', today);
        if (!t) return;
        t.lane = it.userId; t.drag = null;
        out.push(t);
      });
      // 🌴 휴가
      var LBL = { dayoff: '연차', amoff: '오전반차', pmoff: '오후반차' };
      Object.keys(L.leaves || {}).forEach(function (uid) {
        (L.leaves[uid] || []).forEach(function (x) {
          out.push({ key: 'lv:' + uid + ':' + x.date, lane: uid, title: LBL[x.type] || '휴가', icon: '🌴', color: '#10B981', bar: false, n0: _mtlNum(x.date), n1: _mtlNum(x.date), f0: 0.5, f1: 1, late: false, done: false, pri: 3, drag: null, leave: true, tip: x.date });
        });
      });
      return out;
    },
    onOpen: function (t) { if (t.it) mwOpenItem(_mwLoadFind(t.it.key) || t.it); },
    onMove: function () {}
  });
  _mtlLoad.mount(slot);
}
