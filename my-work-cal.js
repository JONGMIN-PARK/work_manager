/* ═══════════════════════════════════════════════════════════════════════
   my-work-cal.js — 🎯 내 업무 달력 보기 · 구독 (v13.252)
   ─────────────────────────────────────────────────────────────────────
   [목록 | 주 | 월] — 할 일은 마감일에, 일정(events)은 날짜 · 시각에 놓인다.
     끌어 놓기: 할 일 = 마감 바꾸기 (개인 할 일 · 맵 주제 · 이슈 · 회의 액션 — 마일스톤 · 개발 · 사전검토는 원래 화면에서)
                일정 = 날짜 · 시각 옮기기 (수정 권한 있는 것만, 반복은 전체 회차)
     빈 칸 누르기: 종류별 등록 창 (my-work-task.js mwRegister — 주 보기 시간 칸은 그 시각으로)
     📤 구독: 개인 .ics 주소 — 구글 · 아웃룩 달력에 'URL로 추가'
   서버 API: GET /api/my-work/events · PUT /api/my-work/due · GET·POST·DELETE /api/my-work/feed
   전역 의존: _mw · _mwPaint · _mwFind · _mwEsc · _mwToast · _mwErr · _mwMe · _mwLS · _mwDays · MW_SRC · mwOpenItem (my-work.js)
              expandRepeatingEvents · toCamelArray · ymdAddDays · createEvent · updateEvent · createModal (project-data.js)
              showEventModal (calendar.js) · wmGuardedModal (project-detail.js) · EVT_TYPE (config.js)
   ═══════════════════════════════════════════════════════════════════════ */

var MWC_DUE_SRC = ['todo', 'mindmap', 'issue', 'action'];
var MWC_HOUR_H = 44;          // 주 보기 한 시간 높이(px)
var MWC_DAY_MAX = 4;          // 월 보기 칸당 칩
var MWC_SRC_COLOR = { mindmap: '#8B5CF6', issue: '#EF4444', action: '#06B6D4', prestudy: '#F59E0B', milestone: '#6366F1', dev: '#0EA5E9', todo: '#64748B' };
var _mwc = { map: {}, drag: null, selfAt: 0 };

function _mwcView() {
  if (!_mw.view) _mw.view = _mwLS('view') || 'list';
  return _mw.view;
}
function _mwcToday() { return (_mw.data && _mw.data.today) || (typeof localDate === 'function' ? localDate() : new Date().toISOString().slice(0, 10)); }
function _mwcAdd(d, n) { return ymdAddDays(d, n); }
function _mwcMonday(d) {
  var w = (new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay() + 6) % 7;
  return _mwcAdd(d, -w);
}
function _mwcMin(t) { return t ? (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)) : 0; }
function _mwcHm(m) { m = Math.max(0, Math.min(23 * 60 + 59, Math.round(m))); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }

/** 지금 보기의 날짜 범위 */
function _mwcRange() {
  var v = _mwcView(), today = _mwcToday();
  var a = _mw.anchor || today;
  if (v === 'week') { var m = _mwcMonday(a); return { from: m, to: _mwcAdd(m, 6) }; }
  if (v === 'month') { var g = _mwcMonday(a.slice(0, 8) + '01'); return { from: g, to: _mwcAdd(g, 41) }; }
  return { from: today, to: _mwcAdd(today, 6) };   // 목록 — 오늘 일정 띠용
}

/** 내 일정 불러오기 — 범위 · 사람이 같으면 다시 안 받음 (force 면 받음) */
function mwCalLoadEvents(force) {
  var rg = _mwcRange();
  var uid = _mw.userId || _mwMe();
  if (!force && _mw.ev && _mw.ev.userId === uid && _mw.ev.from === rg.from && _mw.ev.to === rg.to) return Promise.resolve(_mw.ev);
  var q = '?from=' + rg.from + '&to=' + rg.to + (uid && uid !== _mwMe() ? '&userId=' + encodeURIComponent(uid) : '');
  return apiFetch('/api/my-work/events' + q).then(function (r) {
    _mw.ev = { userId: uid, from: rg.from, to: rg.to, rows: toCamelArray((r && r.data) || []) };
    return _mw.ev;
  });
}

/** 일정 회차들 (반복 펼침) — [{ ev, date, end }] 범위와 겹치는 것만 */
function _mwcOccurrences(from, to) {
  if (!_mw.ev) return [];
  var orig = {};
  _mw.ev.rows.forEach(function (ev) { orig[ev.id] = ev; });
  return expandRepeatingEvents(_mw.ev.rows.slice(), from, to).filter(function (o) {
    var end = o.endDate && o.endDate >= o.startDate ? o.endDate : o.startDate;
    return o.startDate <= to && end >= from;
  }).map(function (o) {
    return { ev: orig[o._origId || o.id] || o, date: o.startDate, end: o.endDate && o.endDate >= o.startDate ? o.endDate : o.startDate };
  });
}

/** 달력에 놓을 것 — 할 일 + 일정 회차 */
function _mwcEntries(items, from, to) {
  var today = _mwcToday(), self = _mw.data && _mw.data.self;
  var out = [];
  var showTasks = _mw.src !== 'event', showEvt = _mw.src === 'all' || _mw.src === 'event';
  if (showTasks) items.forEach(function (it) {
    if (!it.due || it.due < from || it.due > to) return;
    if (_mw.src !== 'all' && it.src !== _mw.src) return;
    var s = MW_SRC[it.src] || { icon: '•', label: it.src };
    out.push({ kind: 'task', key: 't|' + it.key, it: it, title: it.title, icon: s.icon, color: MWC_SRC_COLOR[it.src] || '#64748B',
      date: it.due, end: it.due, time: it.dueTime || '', timeEnd: it.dueTime ? _mwcHm(_mwcMin(it.dueTime) + 30) : '', done: it.done, pri: it.pri, late: !it.done && it.due < today, urgent: it.urgent && !it.done,
      drag: !it.done && it.canDone && MWC_DUE_SRC.indexOf(it.src) >= 0,
      tip: s.label + ' — ' + it.title + (it.ctx ? ' · ' + it.ctx : '') });
  });
  // 📁 내 프로젝트 기간 띠 (v13.273) — 전체 보기일 때
  if (_mw.src === 'all' && typeof mwProjCalEntries === 'function') out = mwProjCalEntries(from, to).concat(out);
  if (showEvt) _mwcOccurrences(from, to).forEach(function (o) {
    var ev = o.ev, t = EVT_TYPE[ev.type] || EVT_TYPE.etc;
    out.push({ kind: 'evt', key: 'e|' + ev.id + '|' + o.date, ev: ev, occ: o.date, title: ev.title || t.label, icon: t.icon, color: ev.color || t.color,
      date: o.date, end: o.end, time: ev.startTime || '', timeEnd: ev.endTime || '', done: false, late: false,
      drag: !!ev.canModify, repeat: !!ev.repeat,
      tip: t.label + ' — ' + (ev.startTime ? ev.startTime + (ev.endTime ? '~' + ev.endTime : '') + ' ' : '') + (ev.title || '') + (o.end !== o.date ? ' (' + o.date.slice(5) + '~' + o.end.slice(5) + ')' : '') + (ev.repeat ? ' · 반복' : '') + (ev.canModify ? '' : ' · 보기 전용') });
  });
  _mwc.map = {};
  out.forEach(function (x) { _mwc.map[x.key] = x; });
  return out;
}
function _mwcCmp(a, b) {
  if ((a.kind === 'proj') !== (b.kind === 'proj')) return a.kind === 'proj' ? -1 : 1;   // 프로젝트 띠는 맨 위
  if (a.done !== b.done) return a.done ? 1 : -1;
  if ((a.time || '') !== (b.time || '')) return (a.time || '') < (b.time || '') ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'evt' ? -1 : 1;
  return (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || a.title.localeCompare(b.title);
}

function _mwcChip(x, opt) {
  opt = opt || {};
  // 프로젝트 띠 — 이어지는 날은 글 없이 띠만 (시작 날 · 월요일 · 1일에 이름)
  var cont = x.kind === 'proj' && opt.day && opt.day !== x.date && new Date(opt.day + 'T00:00:00Z').getUTCDay() !== 1 && opt.day.slice(8) !== '01';
  if (x.kind === 'proj') return '<div class="mwc-chip mwc-proj' + (cont ? ' is-cont' : '') + (opt.day === x.date ? ' is-s' : '') + (opt.day === x.end ? ' is-e' : '') + '" data-ck="' + _mwEsc(x.key) + '" tabindex="0" role="button" style="--c:' + _mwEsc(x.color) + '" title="' + _mwEsc(x.tip) + '">' +
    (cont ? '' : '<span class="mwc-ic">' + _mwEsc(x.icon) + '</span><span class="mwc-tx">' + _mwEsc(x.title) + '</span>') + '</div>';
  return '<div class="mwc-chip mwc-' + x.kind + (x.done ? ' is-done' : '') + (x.late ? ' is-late' : '') + '" data-ck="' + _mwEsc(x.key) + '" tabindex="0" role="button"' +
    (x.drag ? ' draggable="true"' : '') + ' style="--c:' + _mwEsc(x.color) + '" title="' + _mwEsc(x.tip) + '">' +
    '<span class="mwc-ic">' + x.icon + '</span>' + (x.repeat ? '<span class="mwc-ic">🔁</span>' : '') +
    (x.time && !opt.noTime ? '<b class="mwc-tm">' + _mwEsc(x.time) + '</b>' : '') +
    (x.urgent ? '<b class="mw-urg">긴급</b>' : x.pri === 2 && !x.done ? '<b class="mw-urg mw-urg2">높음</b>' : '') + '<span class="mwc-tx">' + _mwEsc(x.title) + '</span></div>';
}

/* ── 머리 도구 · 거르기 칩 · 목록 위 '오늘 일정' 띠 ───────────────── */
function mwCalToolsHtml(r) {
  var v = _mwcView();
  var h = '<span class="mwc-seg">' + [['list', '목록'], ['matrix', '보드'], ['week', '주'], ['month', '월']].map(function (x) {
    return '<button class="mwc-seg-b' + (v === x[0] ? ' on' : '') + '" data-mwc-view="' + x[0] + '">' + x[1] + '</button>';
  }).join('') + '</span>';
  if (r && r.self) h += '<button class="mw-btn" data-mwc="feed" title="구글 · 아웃룩 달력에서 내 업무 보기">📤 구독</button>';
  return h;
}
function mwCalChipHtml() {
  if ((_mwcView() !== 'week' && _mwcView() !== 'month') || !_mw.ev) return '';
  var rg = _mwcRange();
  var n = _mwcOccurrences(rg.from, rg.to).length;
  return n ? '<button class="mw-chip' + (_mw.src === 'event' ? ' on' : '') + '" data-src="event">📅 일정 ' + n + '</button>' : '';
}
function mwCalTodayHtml(today) {
  if (!_mw.ev) return '';
  var list = _mwcEntries([], today, today).filter(function (x) { return x.kind === 'evt'; }).sort(_mwcCmp);
  if (!list.length) return '';
  return '<div class="mwc-todaybar"><span class="mwc-tb-h">📅 오늘 일정</span>' + list.map(function (x) {
    return _mwcChip(x);
  }).join('') + '</div>';
}

/* ── 달력 본문 ────────────────────────────────────────────────────── */
function mwCalHtml(items, today) {
  var v = _mwcView(), rg = _mwcRange();
  var all = _mwcEntries(items, rg.from, rg.to);
  var a = _mw.anchor || today;
  var label = v === 'week' ? rg.from.replace(/-/g, '. ') + ' ~ ' + (+rg.to.slice(5, 7)) + '/' + (+rg.to.slice(8, 10))
    : a.slice(0, 4) + '년 ' + (+a.slice(5, 7)) + '월';
  var nodue = items.filter(function (it) { return !it.done && !it.due && (_mw.src === 'all' || it.src === _mw.src); }).length;
  var h = '<div class="mwc-nav"><button class="mw-btn" data-mwc-nav="-1" title="이전">◀</button>' +
    '<button class="mw-btn" data-mwc-nav="0">오늘</button><button class="mw-btn" data-mwc-nav="1" title="다음">▶</button>' +
    '<b class="mwc-label">' + _mwEsc(label) + '</b>' +
    '<span class="mw-sub">' + (_mw.data.self ? '빈 칸을 누르면 할 일 · 일정 등록 · 끌어서 날짜 바꾸기' : '보기 전용') + (nodue ? ' · 마감 없는 일 ' + nodue + '건은 목록에서' : '') + '</span></div>';
  return h + (v === 'week' ? _mwcWeekHtml(all, rg, today) : _mwcMonthHtml(all, rg, today, a));
}

function _mwcDayHead(d, today) {
  var dow = '일월화수목금토'[new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay()];
  var hol = typeof krHolidayName === 'function' ? krHolidayName(d) : '';
  return '<div class="mwc-dh' + (d === today ? ' is-today' : '') + (dow === '일' || hol ? ' is-off' : dow === '토' ? ' is-sat' : '') + '">' +
    dow + ' <b>' + (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + '</b>' + (hol ? '<i>' + _mwEsc(hol) + '</i>' : '') + '</div>';
}

/** 주 보기 — 위: 하루 종일 · 할 일 / 아래: 시간 칸 */
function _mwcWeekHtml(all, rg, today) {
  var days = [];
  for (var i = 0; i < 7; i++) days.push(_mwcAdd(rg.from, i));
  var timed = function (x) { return x.time && x.date === x.end; };   // 마감 시각 있는 할 일도 시간 칸에 (v13.253)
  var h = '<div class="mwc mwc-week"><div class="mwc-wk-in"><div class="mwc-row mwc-wk-h"><div class="mwc-gut"></div>' + days.map(function (d) { return _mwcDayHead(d, today); }).join('') + '</div>';
  h += '<div class="mwc-row mwc-allday"><div class="mwc-gut">종일</div>' + days.map(function (d) {
    var list = all.filter(function (x) { return !timed(x) && x.date <= d && x.end >= d; }).sort(_mwcCmp);
    return '<div class="mwc-ad' + (d === today ? ' is-today' : '') + '" data-day="' + d + '">' + list.map(function (x) { return _mwcChip(x, { day: d }); }).join('') + '</div>';
  }).join('') + '</div>';
  var hours = '';
  for (var hr = 0; hr < 24; hr++) hours += '<div class="mwc-hr" style="height:' + MWC_HOUR_H + 'px"><span>' + (hr ? hr + ':00' : '') + '</span></div>';
  h += '<div class="mwc-tscroll" id="mwcTScroll"><div class="mwc-row mwc-tbody"><div class="mwc-gut">' + hours + '</div>' + days.map(function (d) {
    var list = all.filter(function (x) { return timed(x) && x.date === d; });
    return '<div class="mwc-tcol' + (d === today ? ' is-today' : '') + '" data-tday="' + d + '" style="height:' + (24 * MWC_HOUR_H) + 'px;--hh:' + MWC_HOUR_H + 'px">' +
      _mwcLanes(list).map(function (b) {
        var x = b.x, s = _mwcMin(x.time), e = x.timeEnd && x.timeEnd > x.time ? _mwcMin(x.timeEnd) : s + 60;
        var short = (e - s) < 45;   // 45분 아래는 한 줄 (시작 시각 + 제목)
        return '<div class="mwc-blk' + (short ? ' mwc-blk-s' : '') + '" data-ck="' + _mwEsc(x.key) + '" tabindex="0" role="button"' + (x.drag ? ' draggable="true"' : '') + ' title="' + _mwEsc(x.tip) + '" style="--c:' + _mwEsc(x.color) +
          ';top:' + (s / 60 * MWC_HOUR_H) + 'px;height:' + Math.max(20, (e - s) / 60 * MWC_HOUR_H - 2) + 'px;left:calc(' + (b.col / b.cols * 100) + '% + 2px);width:calc(' + (100 / b.cols) + '% - 4px)">' +
          '<b>' + _mwEsc(x.time) + (x.timeEnd && !short ? '~' + _mwEsc(x.timeEnd) : '') + '</b> ' + x.icon + (x.repeat ? '🔁' : '') + ' ' + _mwEsc(x.title) + '</div>';
      }).join('') +
      (d === today ? '<div class="mwc-now" style="top:' + (_mwcNowMin() / 60 * MWC_HOUR_H) + 'px"></div>' : '') +
    '</div>';
  }).join('') + '</div></div></div></div>';
  return h;
}
function _mwcNowMin() { var n = new Date(); return n.getHours() * 60 + n.getMinutes(); }

/** 겹치는 시각 일정은 나란히 — [{ x, col, cols }] */
function _mwcLanes(list) {
  list = list.slice().sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
  var out = [], group = [], groupEnd = -1;
  function endOf(x) { var s = _mwcMin(x.time); return x.timeEnd && x.timeEnd > x.time ? _mwcMin(x.timeEnd) : s + 60; }
  function flush() {
    var cols = [];
    group.forEach(function (b) {
      var c = 0;
      while (cols[c] != null && cols[c] > _mwcMin(b.x.time)) c++;
      cols[c] = endOf(b.x); b.col = c;
    });
    group.forEach(function (b) { b.cols = cols.length; out.push(b); });
    group = []; groupEnd = -1;
  }
  list.forEach(function (x) {
    if (group.length && _mwcMin(x.time) >= groupEnd) flush();
    group.push({ x: x });
    groupEnd = Math.max(groupEnd, endOf(x));
  });
  if (group.length) flush();
  return out;
}

/** 월 보기 — 6주 */
function _mwcMonthHtml(all, rg, today, anchor) {
  var mon = anchor.slice(0, 7);
  var h = '<div class="mwc mwc-month"><div class="mwc-mh">' + ['월', '화', '수', '목', '금', '토', '일'].map(function (d) { return '<div>' + d + '</div>'; }).join('') + '</div><div class="mwc-mgrid">';
  for (var i = 0; i < 42; i++) {
    var d = _mwcAdd(rg.from, i);
    var list = all.filter(function (x) { return x.date <= d && x.end >= d; }).sort(_mwcCmp);
    var hol = typeof krHolidayName === 'function' ? krHolidayName(d) : '';
    h += '<div class="mwc-md' + (d.slice(0, 7) !== mon ? ' is-out' : '') + (d === today ? ' is-today' : '') + (i % 7 === 6 || hol ? ' is-off' : i % 7 === 5 ? ' is-sat' : '') + '" data-day="' + d + '">' +
      '<div class="mwc-mdn"><b>' + (+d.slice(8, 10)) + '</b>' + (hol ? '<i>' + _mwEsc(hol) + '</i>' : '') + '</div>' +
      list.slice(0, MWC_DAY_MAX).map(function (x) { return _mwcChip(x, { day: d }); }).join('') +
      (list.length > MWC_DAY_MAX ? '<button class="mwc-more" data-mwc-more="' + d + '">+' + (list.length - MWC_DAY_MAX) + ' 더보기</button>' : '') +
    '</div>';
  }
  return h + '</div></div>';
}

/* ── 누르기 ───────────────────────────────────────────────────────── */
/** my-work.js 의 el.onclick 에서 먼저 부름 — 처리했으면 true */
function mwCalClick(e) {
  var t = e.target;
  var vb = t.closest('[data-mwc-view]');
  if (vb) {
    _mw.view = vb.getAttribute('data-mwc-view'); _mwLS('view', _mw.view);
    if (_mw.view === 'list' && _mw.src === 'event') _mw.src = 'all';
    _mwcRepaint();
    return true;
  }
  if (t.closest('[data-mwc="feed"]')) { mwCalFeedModal(); return true; }
  var nav = t.closest('[data-mwc-nav]');
  if (nav) {
    var n = +nav.getAttribute('data-mwc-nav'), a = _mw.anchor || _mwcToday();
    if (!n) _mw.anchor = null;
    else if (_mw.view === 'week') _mw.anchor = _mwcAdd(a, 7 * n);
    else { var dt = new Date(+a.slice(0, 4), +a.slice(5, 7) - 1 + n, 1); _mw.anchor = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-01'; }
    _mwcRepaint();
    return true;
  }
  var more = t.closest('[data-mwc-more]');
  if (more) { _mw.anchor = more.getAttribute('data-mwc-more'); _mw.view = 'week'; _mwLS('view', 'week'); _mwcRepaint(); return true; }
  var chip = t.closest('[data-ck]');
  if (chip) { _mwcOpen(_mwc.map[chip.getAttribute('data-ck')]); return true; }
  if (!_mw.data || !_mw.data.self) return false;
  var col = t.closest('[data-tday]');
  if (col && t === col) {
    var y = e.clientY - col.getBoundingClientRect().top;
    var m = Math.floor(y / MWC_HOUR_H * 2) * 30;
    mwRegister({ date: col.getAttribute('data-tday'), t1: _mwcHm(m), t2: _mwcHm(Math.min(m + 60, 23 * 60 + 59)), kind: 'etc' });
    return true;
  }
  var day = t.closest('[data-day]');
  if (day && (t === day || t.closest('.mwc-mdn'))) { mwRegister({ date: day.getAttribute('data-day'), kind: 'todo' }); return true; }
  return false;
}

function _mwcRepaint() {
  mwCalLoadEvents().then(_mwPaint).catch(function (e) { _mwToast('❌ 일정을 불러오지 못했습니다 — ' + _mwErr(e), 'error'); _mwPaint(); });
}

function _mwcOpen(x) {
  if (!x) return;
  if (x.kind === 'task') { if (typeof mwPanelOpen === 'function') mwPanelOpen(x.it); else mwOpenItem(x.it); return; }
  if (x.kind === 'proj') { mwProjOpen(x.p.id); return; }
  _mwcEventModal(x.ev.id);
}
function _mwcEventModal(id, date, opts) {
  if (typeof showEventModal !== 'function') return;
  opts = Object.assign({ onSaved: _mwcAfterChange }, opts || {});
  wmGuardedModal('evtModal', function () { return showEventModal(id, date, opts); }, 'evtModal');
}
function _mwcAfterChange() {
  _mwc.selfAt = Date.now();
  if (typeof mwTimelineEvReload === 'function') mwTimelineEvReload();   // 타임라인 일정도 (v13.271)
  return mwCalLoadEvents(true).then(_mwPaint);
}

/* ── 빈 칸 → 등록: my-work-task.js mwRegister (v13.253 — 종류별 등록 창) ── */

/* ── 끌어 놓기 ────────────────────────────────────────────────────── */
function mwCalBind(el) {
  // 시간 칸 — 처음엔 08시부터 보이게, 다시 그릴 때는 보던 자리 그대로
  var ts = el.querySelector('#mwcTScroll');
  if (ts) {
    ts.scrollTop = _mwc.scrollTop != null ? _mwc.scrollTop : 8 * MWC_HOUR_H - 6;
    ts.onscroll = function () { _mwc.scrollTop = ts.scrollTop; };
  }
  if (el._mwcDnd) return;
  el._mwcDnd = true;
  // 칩 · 블록은 Tab 으로 가서 Enter 로 열기
  el.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-ck]')) { e.preventDefault(); e.target.click(); }
  });
  // 지금 선 — 1분마다 따라 내려감
  setInterval(function () {
    var n = el.querySelector('.mwc-now');
    if (n) n.style.top = (_mwcNowMin() / 60 * MWC_HOUR_H) + 'px';
  }, 60000);
  el.addEventListener('dragstart', function (e) {
    var c = e.target.closest && e.target.closest('[data-ck]');
    if (!c || !el.querySelector('.mwc')) return;
    var x = _mwc.map[c.getAttribute('data-ck')];
    if (!x || !x.drag) { e.preventDefault(); return; }
    _mwc.drag = { x: x, grabY: c.classList.contains('mwc-blk') ? e.clientY - c.getBoundingClientRect().top : 0 };
    e.dataTransfer.setData('text/plain', x.key);
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('mwc-dragging');
  });
  el.addEventListener('dragend', function () {
    _mwc.drag = null;
    el.classList.remove('mwc-dragging');
    el.querySelectorAll('.mw-drop-on').forEach(function (x) { x.classList.remove('mw-drop-on'); });
  });
  el.addEventListener('dragover', function (e) {
    if (!_mwc.drag) return;
    var tgt = e.target.closest && (e.target.closest('[data-tday]') || e.target.closest('[data-day]'));
    if (!tgt) return;
    e.preventDefault();
    el.querySelectorAll('.mw-drop-on').forEach(function (x) { if (x !== tgt) x.classList.remove('mw-drop-on'); });
    tgt.classList.add('mw-drop-on');
  });
  el.addEventListener('drop', function (e) {
    var d = _mwc.drag;
    if (!d) return;
    var col = e.target.closest && e.target.closest('[data-tday]');
    var day = e.target.closest && e.target.closest('[data-day]');
    if (!col && !day) return;
    e.preventDefault();
    var date = col ? col.getAttribute('data-tday') : day.getAttribute('data-day');
    var time = null;
    if (col) {
      var y = e.clientY - col.getBoundingClientRect().top - d.grabY;
      time = _mwcHm(Math.round(y / MWC_HOUR_H * 4) * 15);   // 15분 단위
    }
    _mwc.drag = null;
    if (d.x.kind === 'task') _mwcMoveTask(d.x, date, time);
    else _mwcMoveEvent(d.x, date, time);
  });
}

function _mwcMoveTask(x, date, time) {
  var it = x.it;
  // 개인 할 일은 시간 칸에 놓으면 마감 시각도 (다른 출처는 날짜만)
  if (it.src === 'todo' && time && (it.due !== date || it.dueTime !== time)) {
    apiFetch('/api/my-work/todos/' + encodeURIComponent(it.id), { method: 'PUT', body: JSON.stringify({ dueDate: date, dueTime: time }) }).then(function () {
      it.due = date; it.dueTime = time;
      _mwToast('📆 "' + it.title + '" 마감을 ' + (+date.slice(5, 7)) + '/' + (+date.slice(8, 10)) + ' ' + time + ' 로 옮겼습니다');
      _mwPaint();
    }).catch(function (e) { _mwToast('❌ ' + _mwErr(e), 'error'); _mwPaint(); });
    return;
  }
  if (it.due === date) return;
  apiFetch('/api/my-work/due', { method: 'PUT', body: JSON.stringify({ src: it.src, id: it.id, userId: it.userId, due: date }) }).then(function () {
    it.due = date;
    _mwToast('📆 "' + it.title + '" 마감을 ' + (+date.slice(5, 7)) + '/' + (+date.slice(8, 10)) + ' 로 옮겼습니다' + (it.src !== 'todo' ? ' — ' + (MW_SRC[it.src] || {}).label + '에도 반영' : ''));
    _mwPaint();
  }).catch(function (e) { _mwToast('❌ ' + _mwErr(e), 'error'); _mwPaint(); });
}

function _mwcMoveEvent(x, date, time) {
  var ev = x.ev;
  var shift = _mwDays(x.occ, date);
  var up = {};
  if (shift) {
    up.startDate = _mwcAdd(ev.startDate, shift);
    up.endDate = _mwcAdd(ev.endDate && ev.endDate >= ev.startDate ? ev.endDate : ev.startDate, shift);
  }
  if (time && time !== ev.startTime) {
    var dur = ev.startTime && ev.endTime && ev.endTime > ev.startTime ? _mwcMin(ev.endTime) - _mwcMin(ev.startTime) : 60;
    up.startTime = time;
    up.endTime = _mwcHm(Math.min(_mwcMin(time) + dur, 23 * 60 + 59));
  }
  if (!Object.keys(up).length) return;
  if (ev.repeat && !confirm('반복 일정입니다. 모든 회차가 함께 옮겨집니다. 계속할까요?')) return;
  _mwc.selfAt = Date.now();
  updateEvent(ev.id, up, ev.version).then(function () {
    _mwToast('📅 "' + (ev.title || '일정') + '" 을 ' + (+date.slice(5, 7)) + '/' + (+date.slice(8, 10)) + (up.startTime ? ' ' + up.startTime : '') + ' 로 옮겼습니다');
    return _mwcAfterChange();
  }).catch(function (e) {
    var msg = e && e.data && e.data.error === 'CONFLICT' ? '다른 사람이 먼저 고쳤습니다 — 새로 불러옵니다' : _mwErr(e);
    _mwToast('❌ ' + msg, 'error');
    _mwcAfterChange();
  });
}

/* ── 구독 (.ics) ──────────────────────────────────────────────────── */
function mwCalFeedModal() {
  wmGuardedModal('mwcFeed', function () {
    return apiFetch('/api/my-work/feed').then(function (r) { _mwcBuildFeed(r && r.data); });
  }, 'mwcFeedModal');
}
function _mwcBuildFeed(f) {
  var body = f
    ? '<p class="mwc-f-p">아래 주소를 달력 앱에 <b>URL로 추가</b>하면 내 할 일(마감)과 일정이 보입니다.</p>' +
      '<div class="mwc-f-url"><input id="mwcFeedUrl" class="mw-input" readonly value="' + _mwEsc(f.url) + '"><button class="mw-btn mw-btn-p" data-f="copy">복사</button></div>' +
      '<ul class="mwc-f-how"><li><b>구글 캘린더</b> — 왼쪽 \'다른 캘린더\' 옆 ＋ → URL로 추가</li>' +
      '<li><b>아웃룩</b> — 일정 추가 → 웹에서 구독</li><li><b>아이폰</b> — 설정 → 캘린더 → 계정 → 구독 캘린더 추가</li></ul>' +
      '<p class="mwc-f-note">⏱ 달력 앱이 몇 시간마다 가져가므로 바로 보이지 않을 수 있습니다 (구글은 반나절까지 늦음). 보내기만 되고, 달력 앱에서 고친 것은 여기로 오지 않습니다.<br>' +
      '🔒 이 주소를 아는 사람은 로그인 없이 내 업무를 볼 수 있습니다. 새어 나갔다면 \'새 주소\' 를 누르세요 — 옛 주소는 바로 끊깁니다.' +
      (f.lastUsedAt ? '<br>마지막으로 가져간 때: ' + _mwEsc(new Date(f.lastUsedAt).toLocaleString()) : '') + '</p>' +
      '<div class="mwc-q-btns"><button class="mw-btn" data-f="off">구독 끄기</button><span style="flex:1"></span><button class="mw-btn" data-f="new">새 주소</button></div>'
    : '<p class="mwc-f-p">구글 · 아웃룩 · 아이폰 달력에서 내 할 일(마감)과 일정을 같이 볼 수 있게 개인 구독 주소를 만듭니다.</p>' +
      '<p class="mwc-f-note">🔒 주소를 아는 사람은 누구나 볼 수 있으니 다른 사람과 나누지 마세요. 언제든 끄거나 새로 만들 수 있습니다.</p>' +
      '<div class="mwc-q-btns"><span style="flex:1"></span><button class="mw-btn mw-btn-p" data-f="new">구독 주소 만들기</button></div>';
  var ov = createModal({ id: 'mwcFeedModal', width: '520px', titleText: '📤 내 업무 달력 구독', html: body, closeOnEsc: true }).overlay;
  ov.onclick = function (e) {
    var b = e.target.closest('[data-f]');
    if (!b) return;
    var k = b.getAttribute('data-f');
    if (k === 'copy') {
      var inp = ov.querySelector('#mwcFeedUrl');
      inp.select();
      (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject()).then(function () { _mwToast('📋 주소를 복사했습니다'); })
        .catch(function () { try { document.execCommand('copy'); _mwToast('📋 주소를 복사했습니다'); } catch (_) { _mwToast('주소를 직접 복사해 주세요', 'warn'); } });
      return;
    }
    if (k === 'new' && f && !confirm('새 주소를 만들면 지금 주소로 구독한 달력은 더 이상 갱신되지 않습니다. 계속할까요?')) return;
    if (k === 'off' && !confirm('구독을 끌까요? 달력 앱에 추가한 것은 더 이상 갱신되지 않습니다.')) return;
    b.disabled = true;
    apiFetch('/api/my-work/feed', { method: k === 'off' ? 'DELETE' : 'POST' }).then(function (r) {
      ov.remove();
      _mwcBuildFeed(r && r.data);
      if (k === 'off') _mwToast('구독을 껐습니다', 'warn');
    }).catch(function (e2) { b.disabled = false; _mwToast('❌ ' + _mwErr(e2), 'error'); });
  };
}

/* 다른 화면(달력 탭 등)에서 일정이 바뀌면 다시 받음 — 내가 방금 바꾼 것은 이미 반영 */
if (typeof wmDataBus !== 'undefined') wmDataBus.on('event', function () {
  if (Date.now() - _mwc.selfAt < 1500) return;
  _mw.ev = null;   // 다른 화면에 있어도 버림 — 돌아오면 새로 받음
  if (typeof curPage === 'undefined' || curPage !== 'mywork') return;
  clearTimeout(_mwc.busT);
  _mwc.busT = setTimeout(function () { mwCalLoadEvents(true).then(_mwPaint).catch(function () {}); }, 200);
});
