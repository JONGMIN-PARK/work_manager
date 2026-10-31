/* ═══════════════════════════════════════════════════════════════════════
   my-work.js — 🎯 내 업무 · 👥 업무 부하 (v13.248)
   ─────────────────────────────────────────────────────────────────────
   담당과 마감이 붙는 곳(마인드맵 주제 · 이슈 · 회의 액션 · 사전검토 · 마일스톤 · 개발 작업)을
   한 화면에 모은다. 새로 입력하는 것은 '개인 할 일' 뿐.
   서버 API (server/routes/my-work.js):
     GET /api/my-work?userId=   GET /api/my-work/people   PUT /api/my-work/done
     POST·PUT·DELETE /api/my-work/todos   GET /api/my-work/load   PUT /api/my-work/reassign
   달력 보기(주 · 월) · 구독은 my-work-cal.js (v13.252)
   중요도 · 오늘 집중 · 정렬 · 종류별 등록은 my-work-task.js (v13.253)
   상세 패널(자동 저장) · 되돌리기 · 단축키는 my-work-panel.js (v13.254) — 줄을 누르면 패널, 원래 화면은 패널의 [열기]
   보드(내 칸 · 카테고리)는 my-work-board.js, 휴지통 · 내보내기 · 맵으로는 my-work-io.js (v13.268)
   📁 내 프로젝트(목록 · 보드 위 띠 · 프로젝트 패널)는 my-work-proj.js (v13.273)
   전역 의존: apiFetch, eH, showToast, currentUser, setPage, setMode, showIssueDetail, showProjectDetail, psOpenModal, _mm
   ═══════════════════════════════════════════════════════════════════════ */

// color — 달력 · 타임라인이 같은 색을 쓰게 한 곳에 (v13.275, 예전엔 둘이 달라 같은 일이 다른 색이었다)
var MW_SRC = {
  mindmap:   { icon: '🧠', label: '맵',       color: '#EC4899' },
  issue:     { icon: '🎫', label: '이슈',     color: '#F59E0B' },
  action:    { icon: '📝', label: '회의',     color: '#06B6D4' },
  prestudy:  { icon: '🔍', label: '사전검토', color: '#8B5CF6' },
  milestone: { icon: '◆', label: '마일스톤', color: '#6366F1' },
  dev:       { icon: '🛠', label: '개발',     color: '#10B981' },
  todo:      { icon: '✏️', label: '할 일',    color: '#3B82F6' }
};
function mwSrcColor(src) { return (MW_SRC[src] && MW_SRC[src].color) || '#94A3B8'; }
var MW_MOVE_SRC = ['mindmap', 'issue', 'action', 'dev', 'prestudy'];
var _mw = { sel: null, userId: null, people: null, canLoad: false, data: null, src: 'all', open: null, load: null, loadSel: null, weeks: 8, dept: '',
  view: null, anchor: null, ev: null };   // view: list · week · month — anchor: 달력에서 보고 있는 날 — ev: 내 일정 { from, to, userId, rows }

function _mwEsc(s) { return (typeof eH === 'function') ? eH(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _mwToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
/** 오늘 (서버가 준 날 → 이 PC 날짜). 달력 · 타임라인 · 패널 · 노트가 모두 이것 (v13.275 — 다섯 벌이던 것, UTC 대체값 없앰) */
function mwToday() { return (_mw.data && _mw.data.today) || localDate(); }
function _mwMe() { return (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.sub || currentUser.id) : null; }
function _mwErr(e) { return (e && (e.message || (e.data && e.data.message))) || '오류'; }
function _mwLS(k, v) {
  try {
    if (v === undefined) return JSON.parse(localStorage.getItem('mw-' + k) || 'null');
    localStorage.setItem('mw-' + k, JSON.stringify(v));
  } catch (_) { return null; }
}

/* ── 날짜 ─────────────────────────────────────────────────────────── */
function _mwDays(a, b) {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
}
function _mwWeekday(d) { return '일월화수목금토'[new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay()]; }
/** 마감 표시 — 지연 · 오늘 · 내일 · 10/30 (목) */
function _mwDueLabel(due, today) {
  if (!due) return '';
  var d = _mwDays(today, due);
  if (d < 0) return 'D+' + (-d);
  if (d === 0) return '오늘';
  if (d === 1) return '내일';
  return (+due.slice(5, 7)) + '/' + (+due.slice(8, 10)) + ' (' + _mwWeekday(due) + ')';
}
/** 묶음 — focus(⭐ 오늘 집중) · late · today · week(이번 주 일요일까지) · next(다음 주) · later · nodue · done */
function _mwGroupOf(it, today) {
  if (it.done) return 'done';
  if (it.focus) return 'focus';
  if (!it.due) return 'nodue';
  var d = _mwDays(today, it.due);
  if (d < 0) return 'late';
  if (d === 0) return 'today';
  var toSun = 6 - ((new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))).getUTCDay() + 6) % 7);
  if (d <= toSun) return 'week';
  if (d <= toSun + 7) return 'next';
  return 'later';
}
var MW_GROUPS = [
  { key: 'focus', label: '⭐ 오늘 집중', cls: 'mw-g-focus' },
  { key: 'late', label: '지연', cls: 'mw-g-late' },
  { key: 'today', label: '오늘' },
  { key: 'week', label: '이번 주' },
  { key: 'next', label: '다음 주' },
  { key: 'later', label: '나중에', fold: true },
  { key: 'nodue', label: '마감 없음', fold: true },
  { key: 'done', label: '다 한 것 (최근 7일)', fold: true }
];

/* ── 원래 자리로 열기 ─────────────────────────────────────────────── */
/** 다른 화면의 창 열기 — 표준 가드(두 번 눌러도 한 번만 · 안 뜨면 알림) */
function _mwGuard(key, fn, elId) {
  if (typeof wmGuardedModal === 'function') return wmGuardedModal(key, fn, elId);
  fn();
}
/** 원래 자리로 열기 — 패널의 [화면에서 열기] · 업무 부하 목록에서. 개인 할 일은 상세 패널 */
function mwOpenItem(it) {
  if (!it) return;
  switch (it.src) {
    case 'mindmap':
      if (!it.mapOpen) { _mwToast('🔒 이 맵을 볼 권한이 없습니다 — 맵 주인에게 공유를 요청하세요', 'warn'); return; }
      if (typeof _mm === 'undefined' || (typeof mmHasAccess === 'function' && !mmHasAccess())) { _mwToast('🔒 마인드맵 사용 권한이 없습니다', 'warn'); return; }
      _mm.goto = { mapId: it.mapId, sheet: it.sheet || 0, node: it.nodeId };
      _mm.mapId = it.mapId;
      setPage('mindmap');
      return;
    case 'issue':
      if (typeof showIssueDetail === 'function') _mwGuard('mwIssue', function () { showIssueDetail(it.id); }, 'issueDetailPanel');
      return;
    case 'prestudy':
      setPage('project'); setMode('prestudy');
      var tries = 0;
      (function wait() {
        if (typeof _psList !== 'undefined' && _psList.some(function (p) { return p.id === it.id; })) { _mwGuard('mwPrestudy', function () { psOpenModal(it.id); }, 'psmTitle'); return; }
        if (++tries < 30) setTimeout(wait, 100);
      })();
      return;
    case 'todo':
      // 팀 보기에서 남의 할 일은 열지 않음 — 고치면 404 만 나던 것 (v13.275)
      if (it.userId && it.userId !== _mwMe()) { _mwToast('🔒 다른 사람의 개인 할 일은 열 수 없습니다', 'warn'); return; }
      if (_mw.data && _mw.data.self && typeof mwPanelOpen === 'function') mwPanelOpen(it);
      return;
    default:   // action · milestone · dev — 프로젝트 상세
      if (it.projectId && typeof showProjectDetail === 'function') showProjectDetail(it.projectId);
      else _mwToast('연결된 프로젝트가 없습니다', 'warn');
  }
}

/* ═══ 🎯 내 업무 ═══ */
/* 마지막 목록 기억 (v13.270) — 탭을 처음 열 때 '불러오는 중' 대신 이 브라우저 탭에서 마지막으로 본 내 목록을 바로 그리고 새로 받아 바꿈.
   sessionStorage (탭을 닫으면 지워짐) · 내 것만 */
function _mwCache(v) {
  var k = 'mw-cache:' + _mwMe();
  try {
    if (v === undefined) { var c = JSON.parse(sessionStorage.getItem(k) || 'null'); return c && c.self ? c : null; }
    var s = JSON.stringify(v);
    if (s.length < 2000000) sessionStorage.setItem(k, s);
  } catch (_) { return null; }
}
function renderMyWork() {
  var el = document.getElementById('mMyWork');
  if (!el) return;
  _mwLastLoad();
  if (_mw.userId == null) _mw.userId = _mwMe();
  var mine = _mw.userId === _mwMe();
  if (!_mw.data && mine) { var c = _mwCache(); if (c) { _mw.data = c; _mwPaint(); } }
  if (!_mw.data) el.innerHTML = '<div class="mw-empty">불러오는 중...</div>';
  var seq = _mw.seq = (_mw.seq || 0) + 1;   // 사람을 빨리 바꿔도 늦게 온 옛 응답은 버림
  // 사람 목록 · 일정이 비슷한 때 오면 한 번만 다시 그림 (그리는 사이 누른 것이 빗나가지 않게)
  var again = function () {
    if (seq !== _mw.seq || !_mw.data || _mw.againT) return;
    _mw.againT = requestAnimationFrame(function () { _mw.againT = null; if (seq === _mw.seq) _mwPaint(); });
  };
  // v13.270: 목록이 오면 바로 그림 — 사람 목록 · 일정은 따로 와서 오면 다시 그림 (예전엔 셋 다 올 때까지 기다림)
  if (!_mw.people) apiFetch('/api/my-work/people').then(function (r) {
    _mw.people = (r && r.data) || []; _mw.canLoad = !!(r && r.canLoad); again();
  }).catch(function () {});
  if (typeof mwCalLoadEvents === 'function') mwCalLoadEvents(true).then(again, function () {});
  apiFetch('/api/my-work' + (!mine ? '?userId=' + encodeURIComponent(_mw.userId) : '')).then(function (r) {
    if (seq !== _mw.seq) return;
    _mw.data = r;
    if (r.self) _mwCache(r);
    _mwPaint();
    _mwLastApply();
  }).catch(function (e) {
    if (seq !== _mw.seq) return;
    if (_mwLast.pending && _mwLast.pending.who && _mw.userId !== _mwMe()) { _mwLast.pending = null; _mw.userId = _mwMe(); renderMyWork(); return; }   // 기억한 다른 사람을 못 보게 됐으면 나로
    _mwLast.pending = null;
    if (_mw.data && mine) { _mwToast('❌ 내 업무를 새로 받지 못했습니다 — ' + _mwErr(e), 'error'); return; }   // 기억해 둔 목록은 그대로
    el.innerHTML = '<div class="mw-empty">내 업무를 불러오지 못했습니다 — ' + _mwEsc(_mwErr(e)) + '</div>';
  });
}

/* ═══ 마지막 상태 (v13.286) ═══
   새로고침 · 다른 탭에 갔다 와도 보던 그대로 — 출처 칩 · 보던 사람 · 달력에서 보던 날 · 열린 상세/📁 프로젝트/노트 패널 · 스크롤.
   보기(목록 · 보드 · 주 · 월) · 정렬 · 접기 · 타임라인은 원래 따로 기억(mw-view · mtl-*). localStorage 'mw-last' */
var _mwLast = { tried: false, leaving: false, pending: null, t: null };
function _mwLastState() {
  var me = _mwMe();
  return {
    user: me, who: _mw.userId && _mw.userId !== me ? _mw.userId : null, src: _mw.src || 'all', anchor: _mw.anchor || null,
    panel: typeof mwPanelIsOpen === 'function' && mwPanelIsOpen() ? _mw.sel : null,
    proj: typeof mwProjIsOpen === 'function' && mwProjIsOpen() && typeof _mwj !== 'undefined' ? _mwj.id : null,
    notes: typeof mwNotesIsOpen === 'function' && mwNotesIsOpen() && typeof _mwn !== 'undefined' ? (_mwn.date || true) : null,
    y: Math.round(window.scrollY || 0)
  };
}
function _mwLastSave(now) {
  clearTimeout(_mwLast.t);
  var go = function () {
    if (_mwLast.leaving || _mwLast.pending || (typeof curPage !== 'undefined' && curPage !== 'mywork') || !_mw.data) return;
    _mwLS('last', _mwLastState());
  };
  if (now) go(); else _mwLast.t = setTimeout(go, 300);
}
/** 이 화면에 들어올 때 한 번 — 기억한 출처 · 사람 · 날을 먼저 맞춰 그 화면으로 불러옴 */
function _mwLastLoad() {
  if (_mwLast.tried) return;
  _mwLast.tried = true; _mwLast.leaving = false;
  var L = _mwLS('last');
  if (!L || L.user !== _mwMe()) return;
  _mw.src = L.src || 'all';
  _mw.anchor = L.anchor || null;
  _mw.userId = L.who || _mwMe();
  _mwLast.pending = L;
}
/** 목록이 오면 — 열려 있던 패널 · 스크롤 */
function _mwLastApply() {
  var L = _mwLast.pending;
  if (!L) return;
  _mwLast.pending = null;
  if (L.panel && typeof mwPanelOpen === 'function') { var it = _mwFind(L.panel); if (it) mwPanelOpen(it); }
  else if (L.proj && typeof mwProjOpen === 'function') mwProjOpen(L.proj);
  else if (L.notes && typeof mwNotesOpen === 'function' && _mw.data && _mw.data.self) mwNotesOpen(typeof L.notes === 'string' ? L.notes : undefined);
  if (L.y) requestAnimationFrame(function () { requestAnimationFrame(function () { window.scrollTo(0, L.y); }); });
}
/** 다른 화면으로 나갈 때 (mode.js setPage) — 지금 상태를 바로 기억하고, 나가며 닫는 패널은 기억에 안 넣음. 다시 오면 복원 */
function mwOnLeave() {
  _mwLastSave(true);
  _mwLast.leaving = true;
  _mwLast.tried = false;
}
// 누르기 · 키 · 스크롤 뒤에 기억 (패널은 body 에 붙으므로 문서 전체에서)
(function () {
  if (typeof document === 'undefined') return;
  var on = function () { if (typeof curPage !== 'undefined' && curPage === 'mywork') _mwLastSave(); };
  document.addEventListener('click', on, true);
  document.addEventListener('keyup', on, true);
  window.addEventListener('scroll', on, { passive: true });
})();

/** 다시 그려도 쓰던 글은 그대로 — 위 입력 칸 · 보드 칸 [+] 입력 (v13.270) */
function _mwKeepInputs(el) {
  var keep = [], act = document.activeElement;
  el.querySelectorAll('#mwAddTitle, #mwAddDue, [data-bform] input').forEach(function (x) {
    var f = x.closest('[data-bform]');
    var sel = x.id ? '#' + x.id : '[data-bform="' + f.getAttribute('data-bform') + '"] input';
    if (x.value || x === act || (f && !f.hidden)) keep.push({ sel: sel, v: x.value, focus: x === act, s: x.selectionStart, e: x.selectionEnd, open: f && !f.hidden });
  });
  return keep;
}
function _mwRestoreInputs(el, keep) {
  keep.forEach(function (k) {
    var x = el.querySelector(k.sel);
    if (!x) return;
    var f = x.closest('[data-bform]');
    if (f && k.open) f.hidden = false;
    x.value = k.v;
    if (k.focus) { x.focus(); try { if (k.s != null) x.setSelectionRange(k.s, k.e); } catch (_) {} }
  });
}
function _mwPaint() {
  var el = document.getElementById('mMyWork');
  if (!el || !_mw.data) return;
  var keep = _mwKeepInputs(el);
  _mwPaintNow(el);
  if (typeof mwTimelineMount === 'function') mwTimelineMount(el);
  _mwRestoreInputs(el, keep);
  if (typeof mwProjSync === 'function') mwProjSync();
}
function _mwPaintNow(el) {
  var r = _mw.data, today = r.today, items = r.data || [];
  var folds = _mwLS('fold') || { later: true, nodue: true, done: true };
  var counts = {};
  items.forEach(function (it) { if (!it.done) counts[it.src] = (counts[it.src] || 0) + 1; });
  var shown = items.filter(function (it) { return (_mw.src === 'all' || it.src === _mw.src) && (typeof mwFilterItem !== 'function' || mwFilterItem(it)); });
  var by = {};
  shown.forEach(function (it) { (by[_mwGroupOf(it, today)] = by[_mwGroupOf(it, today)] || []).push(it); });
  Object.keys(by).forEach(function (g) {
    by[g].sort(typeof mwSortFn === 'function' ? mwSortFn(g) : function (a, b) {
      if (g === 'done') return String(b.doneAt || '').localeCompare(String(a.doneAt || ''));
      return String(a.due || '9999').localeCompare(String(b.due || '9999')) || (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || a.title.localeCompare(b.title);
    });
  });
  var n = function (k) { return (by[k] || []).length; };
  // v13.295 공통 툴바(.wm-tb) — [제목 · 지연 · 오늘 · 이번 주] [목록 · 보드 · 주 · 월] … [사람] [📝 노트] [⋯ 내보내기 · 맵으로 · 구독 · 텔레그램 · 휴지통 · 새로 고침]
  var h = '<div class="mw-head wm-tb">' +
    '<h3 class="wm-tb-t">🎯 ' + (r.self ? '내 업무' : _mwEsc(r.user.name) + ' 님 업무') + '</h3>' +
    '<div class="mw-sum">' +
      (n('late') ? _mwPill('late', '지연 ' + n('late'), ' mw-pill-late') : '') +
      _mwPill('today', '오늘 ' + n('today'), n('today') ? '' : ' is-0') + _mwPill('week', '이번 주 ' + n('week'), n('week') ? '' : ' is-0') +
    '</div>' +
    (typeof mwCalToolsHtml === 'function' ? mwCalToolsHtml(r) : '') +
    '<span class="wm-tb-sp"></span>' +
    (_mw.people && _mw.people.length > 1 ? '<select id="mwWho" class="mw-sel wm-tb-sel" title="다른 사람 업무 보기">' + _mw.people.map(function (u) {
      return '<option value="' + _mwEsc(u.id) + '"' + (u.id === r.user.id ? ' selected' : '') + '>' + _mwEsc(u.name) + (u.id === _mwMe() ? ' (나)' : u.dept ? ' · ' + _mwEsc(u.dept) : '') + '</option>';
    }).join('') + '</select>' : '') +
    (r.self && typeof mwNotesOpen === 'function' ? '<button class="mw-btn mwn-btn' + (typeof mwNotesIsOpen === 'function' && mwNotesIsOpen() ? ' on' : '') + ((r.noteDays || []).indexOf(today) >= 0 ? ' has' : '') +
      '" data-mwn="open" title="📝 노트 — 끄적 메모 · 회의 메모 (줄을 할 일로 올리기)">📝 노트</button>' : '') +
    '<div class="hdr-pop" id="mwMoreWrap"><button class="btn btn-g wm-more" onclick="wmHdrPop(\'mwMoreWrap\')" title="내보내기 · 맵으로 · 달력 구독 · 텔레그램 · 휴지통" aria-haspopup="true" aria-expanded="false">⋯' + (r.self && r.trashN ? '<span class="wm-flt-n" title="휴지통">' + r.trashN + '</span>' : '') + '</button>' +
      '<div class="hdr-pop-menu" role="menu">' +
        (typeof mwIoToolsHtml === 'function' ? mwIoToolsHtml(r) : '') +
        (r.self && typeof mwCalFeedModal === 'function' ? '<div class="hdr-mi-sep"></div><button class="hdr-mi" data-mwc="feed" title="구글 · 아웃룩 달력에서 내 업무 보기">📅 달력 구독 (구글 · 아웃룩)</button>' : '') +
        '<div class="hdr-mi-sep"></div><button class="hdr-mi" data-mw="refresh" title="새로 고침">↻ 새로 고침</button>' +
      '</div></div>' +
  '</div>';
  h += '<div id="mwtSlot"></div>';   // 🕒 타임라인 · 옆 달력 (v13.271, my-work-timeline.js — 다시 그려도 그 띠는 그대로 옮겨 붙임)
  // 출처 거르기
  h += '<div class="mw-chips"><button class="mw-chip' + (_mw.src === 'all' ? ' on' : '') + '" data-src="all">전체 ' + items.filter(function (x) { return !x.done; }).length + '</button>' +
    Object.keys(MW_SRC).filter(function (k) { return counts[k]; }).map(function (k) {
      return '<button class="mw-chip' + (_mw.src === k ? ' on' : '') + '" data-src="' + k + '">' + MW_SRC[k].icon + ' ' + MW_SRC[k].label + ' ' + counts[k] + '</button>';
    }).join('') + (typeof mwCalChipHtml === 'function' ? mwCalChipHtml() : '') + '</div>';
  // 달력 보기 — 목록 대신 주 · 월 달력
  if (_mw.view === 'week' || _mw.view === 'month') {
    el.innerHTML = '<div class="mw-wrap">' + h + mwCalHtml(items, today) + '</div>';
    _mwBind(el);
    mwCalBind(el);
    if (typeof mwPanelSync === 'function') mwPanelSync();
    return;
  }
  if (typeof mwCalTodayHtml === 'function') h += mwCalTodayHtml(today);
  if (r.self) {
    h += '<form class="mw-add" id="mwAdd"><input id="mwAddTitle" class="mw-input" maxlength="500" placeholder="+ 할 일 — &quot;내일 14:00 !긴급 견적 회신&quot; 처럼 적으면 마감 · 중요도까지" autocomplete="off">' +
      '<input id="mwAddDue" type="date" class="mw-input mw-date" title="마감 (없어도 됨)"><button class="mw-btn mw-btn-p" type="submit">추가</button>' +
      '<button class="mw-btn" type="button" data-mwt="new" title="회의 · 출장 · 외근 · 연차 · 검토 등 종류별로 등록">📅 일정 등록…</button></form>';
  }
  if (typeof mwProjStripHtml === 'function') h += mwProjStripHtml(today);   // 📁 내 프로젝트 (v13.273)
  if (typeof mwListToolsHtml === 'function') h += mwListToolsHtml();
  if (_mw.view === 'matrix' && typeof mwBoardHtml === 'function') {   // 보드 — 내 칸 (v13.268, 예전 4칸)
    el.innerHTML = '<div class="mw-wrap mw-wrap-board">' + h + mwBoardHtml(shown, today) + '</div>';
    _mwBind(el);
    if (typeof mwProjBind === 'function') mwProjBind(el);
    mwBindBoard(el);
    mwBoardAfterPaint(el);
    if (typeof mwPanelSync === 'function') mwPanelSync();
    return;
  }
  var any = false;
  MW_GROUPS.forEach(function (g) {
    var list = by[g.key] || [];
    if (!list.length) return;
    any = true;
    var folded = !!folds[g.key];
    h += '<section class="mw-grp ' + (g.cls || '') + (folded ? ' mw-folded' : '') + '" data-grp="' + g.key + '">' +
      '<div class="mw-grp-h" data-fold="' + g.key + '"><span class="mw-tri">▾</span>' + g.label + ' <b>' + list.length + '</b></div>' +
      '<div class="mw-rows">' + _mwRowsHtml(g.key, list, today) + '</div></section>';
  });
  if (!any) h += '<div class="mw-empty">' + (r.self ? '🎉 담당한 일이 없습니다. 마인드맵 주제 · 이슈 · 회의 액션에 담당과 마감을 넣으면 여기에 모입니다.' : '담당한 일이 없습니다.') + '</div>';
  el.innerHTML = '<div class="mw-wrap">' + h + '</div>';
  _mwBind(el);
  if (typeof mwProjBind === 'function') mwProjBind(el);
  if (typeof mwBindOrder === 'function') mwBindOrder(el);
  if (typeof mwPanelSync === 'function') mwPanelSync();
}

/** 묶음이 길면 앞 MW_ROW_CAP 줄만 — 나머지는 '＋ N개 더 보기' (v13.275, 지연 수십 개가 화면을 다 덮던 것) */
var MW_ROW_CAP = 15;
function _mwRowsHtml(key, list, today) {
  var all = (_mw.more || {})[key] || list.length <= MW_ROW_CAP + 3;
  var shown = all ? list : list.slice(0, MW_ROW_CAP);
  return shown.map(function (it) { return _mwRowHtml(it, today); }).join('') +
    (all ? '' : '<button class="mw-more" data-mw-more="' + key + '">＋ ' + (list.length - MW_ROW_CAP) + '개 더 보기</button>');
}
/** 머리 요약 알약 — 누르면 그 묶음으로 (목록 보기에서만, 접혀 있으면 폄 — v13.275) */
function _mwPill(key, text, cls) {
  return '<button class="mw-pill' + (cls || '') + '" data-mw-jump="' + key + '" title="목록에서 이 묶음으로">' + text + '</button>';
}
function _mwJump(key) {
  if (_mw.view !== 'list') { _mw.view = 'list'; _mwLS('view', 'list'); _mwPaint(); }
  var f = _mwLS('fold') || { later: true, nodue: true, done: true };
  if (f[key]) { f[key] = false; _mwLS('fold', f); }
  var sec = document.querySelector('#mMyWork .mw-grp[data-grp="' + key + '"]');
  if (!sec) { _mwToast('이 묶음에 보이는 일이 없습니다 — 거르기를 확인하세요'); return; }
  sec.classList.remove('mw-folded');
  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  sec.classList.add('mw-flash'); setTimeout(function () { sec.classList.remove('mw-flash'); }, 1200);
}
function _mwRowHtml(it, today) {
  var s = MW_SRC[it.src] || { icon: '•', label: it.src };
  var late = !it.done && it.due && it.due < today;
  var ord = !it.done && _mw.data.self && typeof mwSortMode === 'function' && mwSortMode() === 'manual';
  return '<div class="mw-row' + (it.done ? ' mw-done' : '') + (it.pri === 1 && !it.done ? ' mw-row-urg' : '') + (it.pending ? ' is-pending' : '') + '" data-key="' + _mwEsc(it.key) + '"' + (ord ? ' data-ord="1" draggable="true"' : '') + '>' +
    (typeof mwFocusBtn === 'function' ? mwFocusBtn(it) : '') +
    (it.canDone ? '<input type="checkbox" class="mw-chk" data-done="' + _mwEsc(it.key) + '"' + (it.done ? ' checked' : '') + ' title="' + (it.done ? '완료 되돌리기' : '완료 — 원래 자리에도 반영됩니다') + '">' : '<span class="mw-chk-sp"></span>') +
    '<span class="mw-src" title="' + s.label + '">' + s.icon + '<i>' + s.label + '</i></span>' +
    (typeof mwPriBadge === 'function' ? mwPriBadge(it) : '') +
    '<span class="mw-title' + (it.src === 'todo' ? ' mw-todo-t' : '') + '" data-open="' + _mwEsc(it.key) + '">' + _mwEsc(it.title) + '</span>' +
    (it.src === 'todo' && typeof mwTodoExtra === 'function' ? mwTodoExtra(it) : '') +
    (typeof mwProjTag === 'function' ? mwProjTag(it) : '') +
    (it.ctx ? '<span class="mw-ctx" title="' + _mwEsc(it.ctx) + '">' + _mwEsc(it.ctx) + '</span>' : '<span class="mw-ctx"></span>') +
    (it.progress != null && !it.done && it.src !== 'todo' ? '<span class="mw-prog' + (it.progress ? '' : ' is-zero') + '" title="진행률"><span style="width:' + Math.max(0, Math.min(100, it.progress)) + '%"></span><em>' + it.progress + '%</em></span>' : '') +
    // 개인 할 일 마감은 눌러서 편집 창에서 (v13.253 — 날짜 · 시각 · 반복을 같이)
    (it.src === 'todo' && !it.done && _mw.data.self
      ? '<span class="mw-due mw-due-btn' + (late ? ' mw-late' : '') + (it.due ? '' : ' is-empty') + '" data-open="' + _mwEsc(it.key) + '" title="마감 바꾸기">' + (it.due ? _mwEsc(_mwDueLabel(it.due, today)) + (it.dueTime ? ' ' + _mwEsc(it.dueTime) : '') : '마감 ＋') + '</span>'
      : '<span class="mw-due' + (late ? ' mw-late' : '') + '">' + _mwEsc(_mwDueLabel(it.due, today)) + (it.dueTime ? ' ' + _mwEsc(it.dueTime) : '') + '</span>') +
    (it.src === 'todo' && _mw.data.self ? '<button class="mw-x" data-del="' + _mwEsc(it.key) + '" title="휴지통으로">×</button>' : '') +
    '</div>';
}

function _mwFind(key) { return ((_mw.data && _mw.data.data) || []).filter(function (x) { return x.key === key; })[0]; }

/* ── 할 일 바로 그리기 (v13.270) ───────────────────────────────────────
   예전엔 추가한 뒤 내 업무 전체(맵 · 이슈 · 회의 …)를 다시 받아 한참 걸렸다.
   이제 누르는 즉시 목록에 넣어 그리고(저장 중 흐림), 서버가 돌려준 한 줄로 바꿔 끼운다. 전체 다시 받기 없음 */
/** 서버 my_todos 행 → 목록 항목 (server/lib/my-work.js collect 의 todo 와 같은 모양) */
function mwTodoItem(x) {
  var cl = Array.isArray(x.checklist) ? x.checklist : [];
  var it = { src: 'todo', id: x.id, key: 'todo:' + x.id, userId: x.user_id || (_mw.data.user && _mw.data.user.id), title: String(x.title || '').split('\n')[0].trim() || '(제목 없음)', ctx: '',
    start: x.start_date || null, due: x.due_date || null, done: !!x.done_at, doneAt: x.done_at || null, pri: +x.priority || 3, estimateH: x.estimate_h != null ? Number(x.estimate_h) : null,
    todoStatus: x.status || 'todo', waitingFor: x.waiting_for || '', memo: x.memo || '', dueTime: x.due_time || null, repeat: x.repeat || null, checklist: cl,
    canDone: true, canPri: true, weight: 1 };
  it.urgent = it.pri === 1;
  if (cl.length) { it.checkDone = cl.filter(function (c) { return c && c.d; }).length; it.checkTotal = cl.length; it.progress = Math.round(it.checkDone / it.checkTotal * 100); }
  return it;
}
/** 서버가 준 행을 목록에 넣고 그림 (이미 있으면 바꿈) */
function mwPutTodo(row, extra) {
  if (!_mw.data || !_mw.data.self || !row) return null;
  var it = Object.assign(mwTodoItem(row), extra || {});
  var list = _mw.data.data, i;
  for (i = 0; i < list.length; i++) if (list[i].key === it.key) { list[i] = it; break; }
  if (i === list.length) list.push(it);
  _mwPaint();
  return it;
}
/** 할 일 추가 — 바로 그리고 저장. catId 면 보드 그 칸에 고정까지 → Promise(항목) */
function mwAddTodo(body, catId) {
  if (!_mw.data || !_mw.data.self) return apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify(body) }).then(function () { renderMyWork(); });
  var tmp = 'tmp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  var it = mwTodoItem({ id: tmp, title: body.title, start_date: body.startDate || null, due_date: body.dueDate || null, due_time: body.dueTime || null, priority: body.priority || 3,
    repeat: body.repeat || null, memo: body.memo || null, checklist: [] });
  it.pending = true; it.canDone = false; it.canPri = false;
  if (catId) it.cat = catId;
  if (body.myProjectId) it.proj = body.myProjectId;   // 📁 내 프로젝트에 바로 (v13.273 — 서버가 표시까지)
  _mw.data.data.push(it);
  _mwPaint();
  return apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
    var real = mwTodoItem(r.data);
    var wasSel = _mw.sel === it.key;
    delete it.pending;
    Object.assign(it, real);
    if (catId) it.cat = catId;
    if (body.myProjectId) it.proj = body.myProjectId;
    if (wasSel) _mw.sel = it.key;
    _mwPaint();
    if (catId) apiFetch('/api/my-work/mark', { method: 'PUT', body: JSON.stringify({ key: it.key, category: catId }) })
      .catch(function (e) { it.cat = null; _mwPaint(); _mwToast('❌ 칸에 넣지 못했습니다 — ' + _mwErr(e), 'error'); });
    return it;
  }).catch(function (e) {
    _mw.data.data = _mw.data.data.filter(function (x) { return x !== it; });
    _mwPaint();
    throw e;
  });
}

function _mwBind(el) {
  var who = el.querySelector('#mwWho');
  if (who) who.onchange = function () { if (typeof mwPanelClose === 'function') mwPanelClose(); if (typeof mwProjClose === 'function') mwProjClose(); _mw.userId = who.value; _mw.src = 'all'; _mw.anchor = null; renderMyWork(); };
  var add = el.querySelector('#mwAdd');
  if (add) add.onsubmit = function (e) {
    e.preventDefault();
    var t = el.querySelector('#mwAddTitle'), d = el.querySelector('#mwAddDue');
    var title = (t.value || '').trim();
    if (!title) { t.focus(); return; }
    // 한 줄 읽기 — "내일 14:00 !긴급 견적 회신" (quick-parse.js)
    var q = typeof QuickParse !== 'undefined' ? QuickParse.parse(title, _mw.data.today) : { title: title };
    if (!q.title) { _mwToast('할 일 내용을 적어 주세요', 'warn'); t.focus(); return; }
    var body = { title: q.title, dueDate: d.value || q.due || null, dueTime: (d.value || q.due) && q.time ? q.time : null, priority: q.priority || 3 };
    // 바로 그림 — 입력 칸을 먼저 비우고(다시 그릴 때 쓰던 글을 지켜 주므로), 이어서 칠 수 있게 커서를 둠 (v13.270)
    t.value = ''; d.value = '';
    mwAddTodo(body).then(function () {
      if (q.title !== title) _mwToast('✏️ 추가 — ' + q.title + (body.dueDate ? ' · ' + _mwDueLabel(body.dueDate, _mw.data.today) + (body.dueTime ? ' ' + body.dueTime : '') : '') + (body.priority !== 3 && typeof MW_PRI !== 'undefined' ? ' · ' + MW_PRI[body.priority].label : ''));
    }).catch(function (e2) {
      _mwToast('❌ 추가하지 못했습니다 — ' + _mwErr(e2), 'error');
      var x = document.getElementById('mwAddTitle'); if (x && !x.value) x.value = title;   // 쓴 글은 돌려줌
    });
    var x = document.getElementById('mwAddTitle'); if (x) x.focus();
  };
  el.onclick = function (e) {
    var t = e.target;
    if (t.closest('[data-mw="refresh"]')) { renderMyWork(); return; }
    if (t.closest('[data-mwn="open"]')) { mwNotesToggle(); return; }
    if (typeof mwIoClick === 'function' && mwIoClick(e)) return;
    if (typeof mwProjClick === 'function' && mwProjClick(e)) return;
    if (typeof mwBoardClick === 'function' && mwBoardClick(e)) return;
    if (typeof mwCalClick === 'function' && mwCalClick(e)) return;
    if (typeof mwTaskClick === 'function' && mwTaskClick(e)) return;
    var chip = t.closest('[data-src]');
    if (chip) { _mw.src = chip.getAttribute('data-src'); _mwPaint(); return; }
    var jump = t.closest('[data-mw-jump]');
    if (jump) { _mwJump(jump.getAttribute('data-mw-jump')); return; }
    var more = t.closest('[data-mw-more]');
    if (more) { _mw.more = _mw.more || {}; _mw.more[more.getAttribute('data-mw-more')] = true; _mwPaint(); return; }
    var fold = t.closest('[data-fold]');
    if (fold) {
      var f = _mwLS('fold') || { later: true, nodue: true, done: true };
      var k = fold.getAttribute('data-fold');
      f[k] = !f[k]; _mwLS('fold', f);
      fold.parentNode.classList.toggle('mw-folded', !!f[k]);
      return;
    }
    var del = t.closest('[data-del]');
    if (del) {
      var it = _mwFind(del.getAttribute('data-del'));
      if (it && typeof mwDeleteTodo === 'function') mwDeleteTodo(it);   // 묻지 않고 지우고 아래 알림에서 되돌리기
      return;
    }
    var op = t.closest('[data-open]');
    if (op) {
      var it2 = _mwFind(op.getAttribute('data-open'));
      if (typeof mwPanelOpen === 'function') mwPanelOpen(it2, op.classList.contains('mw-due-btn') ? { focus: '#mwpDue' } : null);
      else mwOpenItem(it2);
    }
  };
  el.onchange = function (e) {
    var t = e.target;
    if (typeof mwTaskChange === 'function' && mwTaskChange(e)) return;
    if (typeof mwProjChange === 'function' && mwProjChange(e)) return;
    if (t.hasAttribute('data-done')) { _mwToggleDone(_mwFind(t.getAttribute('data-done')), t.checked, t); return; }
  };
}

function _mwToggleDone(it, done, box) {
  if (!it) return;
  box.disabled = true;
  if (it.src === 'prestudy' || it.src === 'milestone') { box.disabled = false; mwSetDone(it, done, box); return; }   // 사전검토는 끝내는 방법을 고름
  var row = box.closest('.mw-row');
  if (row) row.classList.toggle('mw-done', done);
  // 체크가 보인 뒤 '다 한 것' 으로 옮김 — 저장 · 되돌리기 알림은 mwSetDone (my-work-panel.js)
  setTimeout(function () { mwSetDone(it, done); }, 250);
}

/* ═══ 👥 업무 부하 ═══ */
function renderWorkload() {
  var el = document.getElementById('mWorkload');
  if (!el) return;
  if (!_mw.load) el.innerHTML = '<div class="mw-empty">불러오는 중...</div>';
  _mw.weeks = _mwLS('weeks') || _mw.weeks;
  var q = '?weeks=' + _mw.weeks + (_mw.dept ? '&deptId=' + encodeURIComponent(_mw.dept) : '');
  apiFetch('/api/my-work/load' + q).then(function (r) {
    _mw.load = r.data;
    _mwPaintLoad();
  }).catch(function (e) {
    el.innerHTML = '<div class="mw-empty">업무 부하를 불러오지 못했습니다 — ' + _mwEsc(_mwErr(e)) + '</div>';
  });
}

/** 과부하 기준 — 앞 2주(지연 포함) 남은 양이 팀 평균의 1.5배 이상이고 6 이상 */
function _mwLoadStats(L) {
  var near = {}, sum = 0, cnt = 0;
  L.users.forEach(function (u) {
    var r = L.rows[u.id];
    var v = r ? r.late.w + r.cells[0].w + (r.cells[1] ? r.cells[1].w : 0) : 0;
    near[u.id] = v; sum += v; cnt++;
  });
  var avg = cnt ? sum / cnt : 0;
  return { near: near, avg: avg, over: Math.max(6, avg * 1.5) };
}
function _mwHeat(w) { return w <= 0 ? 0 : w <= 2 ? 1 : w <= 4 ? 2 : w <= 7 ? 3 : 4; }

function _mwPaintLoad() {
  var el = document.getElementById('mWorkload');
  var L = _mw.load;
  if (!el || !L) return;
  var st = _mwLoadStats(L);
  var depts = {};
  (_mw.people || L.users).forEach(function (u) { if (u.departmentId) depts[u.departmentId] = u.dept; });
  // v13.289 공통 툴바(.wm-tb) — 제목 · 보기 전환 … 부서 · 기간 · ↻, 읽는 법은 툴바 아래 한 줄
  var h = '<div class="wm-tb"><h3 class="wm-tb-t">👥 업무 부하</h3>' +
    '<span class="mwc-seg wm-seg">' + [['table', '표'], ['tl', '🕒 타임라인']].map(function (x) {
      return '<button class="mwc-seg-b' + ((_mwLS('loadview') || 'table') === x[0] ? ' on' : '') + '" data-lv="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</span>' +
    '<span class="wm-tb-sp"></span>' +
      (Object.keys(depts).length > 1 ? '<select id="mwDept" class="mw-sel"><option value="">전체 부서</option>' + Object.keys(depts).map(function (d) {
        return '<option value="' + _mwEsc(d) + '"' + (d === _mw.dept ? ' selected' : '') + '>' + _mwEsc(depts[d]) + '</option>';
      }).join('') + '</select>' : '') +
      '<select id="mwWeeks" class="mw-sel">' + [4, 8, 12].map(function (w) { return '<option value="' + w + '"' + (w === _mw.weeks ? ' selected' : '') + '>' + w + '주</option>'; }).join('') + '</select>' +
      '<button class="mw-btn" data-mw="refresh" title="새로 고침">↻</button></div>' +
    '<div class="wm-tb-help">칸 = 그 주에 마감인 남은 일 수 (색은 남은 양 — 1 = 반나절, 예상 시간 · 진행률 반영) · 🌴 휴가 · 칸을 누르면 목록 · 목록 줄을 사람 이름에 끌어 놓으면 담당이 바뀝니다</div>';
  // 🕒 팀 타임라인 (v13.271) — 사람마다 한 줄, 마감 ◆ · 기간 막대 · 🌴 휴가
  if (_mwLS('loadview') === 'tl' && typeof mwLoadTimelineMount === 'function') {
    el.innerHTML = '<div class="mw-wrap">' + h + '<div id="mwtLoadSlot"></div></div>';
    _mwBindLoad(el);
    mwLoadTimelineMount(el);
    return;
  }
  h += '<div class="mw-load-scroll"><table class="mw-load"><thead><tr><th class="mw-l-name">사람</th><th class="mw-l-late">지연</th>' +
    L.weeks.map(function (w, i) { return '<th' + (i === 0 ? ' class="mw-l-now"' : '') + '>' + (i === 0 ? '이번 주' : (+w.slice(5, 7)) + '/' + (+w.slice(8, 10))) + '</th>'; }).join('') +
    '<th>이후</th><th>마감 없음</th><th>합계</th></tr></thead><tbody>';
  var sel = _mw.loadSel;
  // 휴가 (v13.253) — 그 주에 연차 · 반차가 있으면 🌴 (반차는 반나절)
  var LEAVE_LABEL = { dayoff: '연차', amoff: '오전반차', pmoff: '오후반차' };
  function leaveOf(uid, col) {
    if (!/^w\d+$/.test(col)) return '';
    var w0 = L.weeks[+col.slice(1)], list = ((L.leaves || {})[uid] || []).filter(function (x) { var d = _mwDays(w0, x.date); return d >= 0 && d < 7; });
    if (!list.length) return '';
    var days = list.reduce(function (n, x) { return n + (x.type === 'dayoff' ? 1 : 0.5); }, 0);
    var tip = list.map(function (x) { return (+x.date.slice(5, 7)) + '/' + (+x.date.slice(8, 10)) + ' ' + LEAVE_LABEL[x.type]; }).join(', ');
    return '<i class="mw-leave" title="휴가 ' + days + '일 — ' + _mwEsc(tip) + '">🌴' + (days !== 1 ? days : '') + '</i>';
  }
  function td(uid, col, c, extra) {
    var on = sel && sel.u === uid && sel.c === col;
    var lv = leaveOf(uid, col);
    if (!c || !c.n) return '<td class="mw-cell' + (extra || '') + '">' + lv + '</td>';
    return '<td class="mw-cell mw-h' + (col === 'late' ? 'L' : col === 'nodue' || col === 'later' ? 'N' : _mwHeat(c.w)) + (on ? ' mw-on' : '') + (extra || '') + '" data-cell="' + uid + '|' + col + '" title="' + c.n + '건 · 남은 양 ' + c.w + '">' + c.n + lv + '</td>';
  }
  L.users.forEach(function (u) {
    var r = L.rows[u.id] || { late: { n: 0 }, cells: [], later: { n: 0 }, nodue: { n: 0 }, total: { n: 0, w: 0 } };
    var flag = st.near[u.id] >= st.over ? '<span class="mw-flag mw-over" title="앞 2주 남은 양 ' + st.near[u.id] + ' (팀 평균 ' + Math.round(st.avg * 10) / 10 + ')">과부하</span>'
      : (!r.total.n ? '<span class="mw-flag mw-free">여유</span>' : '');
    h += '<tr><th class="mw-l-name" data-drop="' + _mwEsc(u.id) + '"><span>' + _mwEsc(u.name) + '</span>' + (u.dept ? '<i>' + _mwEsc(u.dept) + '</i>' : '') + flag + '</th>' +
      td(u.id, 'late', r.late, ' mw-l-late') +
      L.weeks.map(function (w, i) { return td(u.id, 'w' + i, r.cells[i], i === 0 ? ' mw-l-now' : ''); }).join('') +
      td(u.id, 'later', r.later) + td(u.id, 'nodue', r.nodue) +
      '<td class="mw-tot" data-cell="' + u.id + '|all">' + (r.total.n || '') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  if (!L.users.length) h += '<div class="mw-empty">볼 수 있는 사람이 없습니다.</div>';
  h += '<div id="mwLoadList">' + (sel ? _mwLoadListHtml(sel) : '<div class="mw-empty mw-hint">칸을 누르면 그 일들이 여기에 나옵니다.</div>') + '</div>';
  el.innerHTML = '<div class="mw-wrap">' + h + '</div>';
  _mwBindLoad(el);
}

function _mwCellItems(s) {
  var L = _mw.load, today = L.today;
  return (L.items || []).filter(function (it) {
    if (it.done || it.userId !== s.u) return false;
    if (s.c === 'all') return true;
    if (s.c === 'nodue') return !it.due;
    if (!it.due) return false;
    if (s.c === 'late') return it.due < today;
    if (it.due < today) return false;
    var k = Math.floor(_mwDays(L.weeks[0], it.due) / 7);
    if (s.c === 'later') return k >= L.weeks.length;
    return 'w' + k === s.c;
  }).sort(function (a, b) { return String(a.due || '9999').localeCompare(String(b.due || '9999')); });
}

function _mwLoadListHtml(s) {
  var L = _mw.load;
  var u = L.users.filter(function (x) { return x.id === s.u; })[0];
  var list = _mwCellItems(s);
  var colLabel = s.c === 'all' ? '전체' : s.c === 'late' ? '지연' : s.c === 'nodue' ? '마감 없음' : s.c === 'later' ? '이후' : (s.c === 'w0' ? '이번 주' : L.weeks[+s.c.slice(1)].slice(5).replace('-', '/') + ' 주');
  var others = L.users.filter(function (x) { return x.id !== s.u; });
  return '<div class="mw-ll-h">' + _mwEsc(u ? u.name : '') + ' · ' + colLabel + ' <b>' + list.length + '</b></div>' +
    list.map(function (it) {
      var src = MW_SRC[it.src] || {};
      var movable = MW_MOVE_SRC.indexOf(it.src) >= 0;
      return '<div class="mw-row mw-ll-row"' + (movable ? ' draggable="true" data-drag="' + _mwEsc(it.key) + '"' : '') + '>' +
        '<span class="mw-src">' + src.icon + '<i>' + src.label + '</i></span>' +
        '<span class="mw-title" data-lopen="' + _mwEsc(it.key) + '">' + _mwEsc(it.title) + '</span>' +
        '<span class="mw-ctx">' + _mwEsc(it.ctx || '') + '</span>' +
        (typeof mwPriBadge === 'function' && it.pri !== 3 ? mwPriBadge({ pri: it.pri, key: it.key }) : '') +
        (it.progress != null ? '<span class="mw-pct">' + it.progress + '%</span>' : '') +
        '<span class="mw-due' + (it.due && it.due < L.today ? ' mw-late' : '') + '">' + _mwEsc(_mwDueLabel(it.due, L.today)) + '</span>' +
        (movable ? '<select class="mw-sel mw-move" data-move="' + _mwEsc(it.key) + '" title="담당 바꾸기"><option value="">담당 바꾸기…</option>' +
          others.map(function (o) { return '<option value="' + _mwEsc(o.id) + '">→ ' + _mwEsc(o.name) + '</option>'; }).join('') + '</select>' : '<span class="mw-move-sp"></span>') +
        '</div>';
    }).join('');
}

function _mwLoadFind(key) { return ((_mw.load && _mw.load.items) || []).filter(function (x) { return x.key === key; })[0]; }

function _mwReassign(it, toId) {
  if (!it || !toId || toId === it.userId) return;
  var to = _mw.load.users.filter(function (u) { return u.id === toId; })[0];
  apiFetch('/api/my-work/reassign', { method: 'PUT', body: JSON.stringify({ src: it.src, id: it.id, fromUserId: it.userId, toUserId: toId }) }).then(function () {
    _mwToast('👤 "' + it.title + '" 담당을 ' + (to ? to.name : '') + ' 님으로 바꿨습니다');
    renderWorkload();
  }).catch(function (e) { _mwToast('❌ ' + _mwErr(e), 'error'); _mwPaintLoad(); });
}

function _mwBindLoad(el) {
  var dept = el.querySelector('#mwDept');
  if (dept) dept.onchange = function () { _mw.dept = dept.value; _mw.loadSel = null; renderWorkload(); };
  var wk = el.querySelector('#mwWeeks');
  if (wk) wk.onchange = function () { _mw.weeks = +wk.value; _mwLS('weeks', _mw.weeks); _mw.loadSel = null; renderWorkload(); };
  el.onclick = function (e) {
    var t = e.target;
    if (t.closest('[data-mw="refresh"]')) { renderWorkload(); return; }
    var lv = t.closest('[data-lv]');
    if (lv) { _mwLS('loadview', lv.getAttribute('data-lv')); _mwPaintLoad(); return; }
    var c = t.closest('[data-cell]');
    if (c) {
      var p = c.getAttribute('data-cell').split('|');
      _mw.loadSel = (_mw.loadSel && _mw.loadSel.u === p[0] && _mw.loadSel.c === p[1]) ? null : { u: p[0], c: p[1] };
      _mwPaintLoad();
      var ll = document.getElementById('mwLoadList');
      if (_mw.loadSel && ll && ll.scrollIntoView) ll.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    var op = t.closest('[data-lopen]');
    if (op) mwOpenItem(_mwLoadFind(op.getAttribute('data-lopen')));
  };
  el.onchange = function (e) {
    var t = e.target;
    if (t.hasAttribute('data-move') && t.value) _mwReassign(_mwLoadFind(t.getAttribute('data-move')), t.value);
  };
  // 끌어 놓기 — 목록 줄 → 사람 이름 (el 은 그대로 남으므로 한 번만 묶음)
  if (el._mwDnd) return;
  el._mwDnd = true;
  el.addEventListener('dragstart', function (e) {
    var r = e.target.closest && e.target.closest('[data-drag]');
    if (!r) return;
    e.dataTransfer.setData('text/plain', r.getAttribute('data-drag'));
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('mw-dragging');
  });
  el.addEventListener('dragend', function () { el.classList.remove('mw-dragging'); el.querySelectorAll('.mw-drop-on').forEach(function (x) { x.classList.remove('mw-drop-on'); }); });
  el.addEventListener('dragover', function (e) {
    var th = e.target.closest && e.target.closest('[data-drop]');
    if (!th) return;
    e.preventDefault();
    el.querySelectorAll('.mw-drop-on').forEach(function (x) { if (x !== th) x.classList.remove('mw-drop-on'); });
    th.classList.add('mw-drop-on');
  });
  el.addEventListener('drop', function (e) {
    var th = e.target.closest && e.target.closest('[data-drop]');
    if (!th) return;
    e.preventDefault();
    _mwReassign(_mwLoadFind(e.dataTransfer.getData('text/plain')), th.getAttribute('data-drop'));
  });
}
