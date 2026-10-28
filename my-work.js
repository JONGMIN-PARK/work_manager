/* ═══════════════════════════════════════════════════════════════════════
   my-work.js — 🎯 내 업무 · 👥 업무 부하 (v13.248)
   ─────────────────────────────────────────────────────────────────────
   담당과 마감이 붙는 곳(마인드맵 주제 · 이슈 · 회의 액션 · 사전검토 · 마일스톤 · 개발 작업)을
   한 화면에 모은다. 새로 입력하는 것은 '개인 할 일' 뿐.
   서버 API (server/routes/my-work.js):
     GET /api/my-work?userId=   GET /api/my-work/people   PUT /api/my-work/done
     POST·PUT·DELETE /api/my-work/todos   GET /api/my-work/load   PUT /api/my-work/reassign
   달력 보기(주 · 월) · 구독은 my-work-cal.js (v13.252)
   전역 의존: apiFetch, eH, showToast, currentUser, setPage, setMode, showIssueDetail, showProjectDetail, psOpenModal, _mm
   ═══════════════════════════════════════════════════════════════════════ */

var MW_SRC = {
  mindmap:   { icon: '🧠', label: '맵' },
  issue:     { icon: '🎫', label: '이슈' },
  action:    { icon: '📝', label: '회의' },
  prestudy:  { icon: '🔍', label: '사전검토' },
  milestone: { icon: '◆', label: '일정' },
  dev:       { icon: '🛠', label: '개발' },
  todo:      { icon: '✏️', label: '할 일' }
};
var MW_MOVE_SRC = ['mindmap', 'issue', 'action', 'dev', 'prestudy'];
var _mw = { userId: null, people: null, canLoad: false, data: null, src: 'all', open: null, load: null, loadSel: null, weeks: 8, dept: '',
  view: null, anchor: null, ev: null };   // view: list · week · month — anchor: 달력에서 보고 있는 날 — ev: 내 일정 { from, to, userId, rows }

function _mwEsc(s) { return (typeof eH === 'function') ? eH(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _mwToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
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
/** 묶음 — late · today · week(이번 주 일요일까지) · next(다음 주) · later · nodue · done */
function _mwGroupOf(it, today) {
  if (it.done) return 'done';
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
  { key: 'late', label: '지연', cls: 'mw-g-late' },
  { key: 'today', label: '오늘' },
  { key: 'week', label: '이번 주' },
  { key: 'next', label: '다음 주' },
  { key: 'later', label: '나중에', fold: true },
  { key: 'nodue', label: '마감 없음', fold: true },
  { key: 'done', label: '다 한 것 (최근 7일)', fold: true }
];

/* ── 원래 자리로 열기 ─────────────────────────────────────────────── */
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
      if (typeof showIssueDetail === 'function') showIssueDetail(it.id);
      return;
    case 'prestudy':
      setPage('project'); setMode('prestudy');
      var tries = 0;
      (function wait() {
        if (typeof _psList !== 'undefined' && _psList.some(function (p) { return p.id === it.id; })) { psOpenModal(it.id); return; }
        if (++tries < 30) setTimeout(wait, 100);
      })();
      return;
    case 'todo':
      return;
    default:   // action · milestone · dev — 프로젝트 상세
      if (it.projectId && typeof showProjectDetail === 'function') showProjectDetail(it.projectId);
      else _mwToast('연결된 프로젝트가 없습니다', 'warn');
  }
}

/* ═══ 🎯 내 업무 ═══ */
function renderMyWork() {
  var el = document.getElementById('mMyWork');
  if (!el) return;
  if (_mw.userId == null) _mw.userId = _mwMe();
  if (!_mw.data) el.innerHTML = '<div class="mw-empty">불러오는 중...</div>';
  var ppl = _mw.people ? Promise.resolve(_mw.people) : apiFetch('/api/my-work/people').then(function (r) {
    _mw.people = (r && r.data) || []; _mw.canLoad = !!(r && r.canLoad); return _mw.people;
  });
  ppl.then(function () {
    return Promise.all([
      apiFetch('/api/my-work' + (_mw.userId && _mw.userId !== _mwMe() ? '?userId=' + encodeURIComponent(_mw.userId) : '')),
      typeof mwCalLoadEvents === 'function' ? mwCalLoadEvents(true).catch(function () { return null; }) : null
    ]);
  }).then(function (res) {
    _mw.data = res[0];
    _mwPaint();
  }).catch(function (e) {
    el.innerHTML = '<div class="mw-empty">내 업무를 불러오지 못했습니다 — ' + _mwEsc(_mwErr(e)) + '</div>';
  });
}

function _mwPaint() {
  var el = document.getElementById('mMyWork');
  if (!el || !_mw.data) return;
  var r = _mw.data, today = r.today, items = r.data || [];
  var folds = _mwLS('fold') || { later: true, nodue: true, done: true };
  var counts = {};
  items.forEach(function (it) { if (!it.done) counts[it.src] = (counts[it.src] || 0) + 1; });
  var shown = items.filter(function (it) { return _mw.src === 'all' || it.src === _mw.src; });
  var by = {};
  shown.forEach(function (it) { (by[_mwGroupOf(it, today)] = by[_mwGroupOf(it, today)] || []).push(it); });
  Object.keys(by).forEach(function (g) {
    by[g].sort(function (a, b) {
      if (g === 'done') return String(b.doneAt || '').localeCompare(String(a.doneAt || ''));
      return String(a.due || '9999').localeCompare(String(b.due || '9999')) || (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || a.title.localeCompare(b.title);
    });
  });
  var n = function (k) { return (by[k] || []).length; };
  var h = '<div class="mw-head">' +
    '<h2>🎯 ' + (r.self ? '내 업무' : _mwEsc(r.user.name) + ' 님 업무') + '</h2>' +
    '<div class="mw-sum">' +
      (n('late') ? '<span class="mw-pill mw-pill-late">지연 ' + n('late') + '</span>' : '') +
      '<span class="mw-pill">오늘 ' + n('today') + '</span><span class="mw-pill">이번 주 ' + n('week') + '</span>' +
    '</div>' +
    '<div class="mw-tools">' +
      (_mw.people && _mw.people.length > 1 ? '<select id="mwWho" class="mw-sel" title="다른 사람 업무 보기">' + _mw.people.map(function (u) {
        return '<option value="' + _mwEsc(u.id) + '"' + (u.id === r.user.id ? ' selected' : '') + '>' + _mwEsc(u.name) + (u.id === _mwMe() ? ' (나)' : u.dept ? ' · ' + _mwEsc(u.dept) : '') + '</option>';
      }).join('') + '</select>' : '') +
      (typeof mwCalToolsHtml === 'function' ? mwCalToolsHtml(r) : '') +
      '<button class="mw-btn" data-mw="refresh" title="새로 고침">↻</button>' +
    '</div></div>';
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
    return;
  }
  if (typeof mwCalTodayHtml === 'function') h += mwCalTodayHtml(today);
  if (r.self) {
    h += '<form class="mw-add" id="mwAdd"><input id="mwAddTitle" class="mw-input" maxlength="500" placeholder="+ 개인 할 일 — 어디에도 속하지 않는 일을 적어 두세요" autocomplete="off">' +
      '<input id="mwAddDue" type="date" class="mw-input mw-date" title="마감 (없어도 됨)"><button class="mw-btn mw-btn-p" type="submit">추가</button></form>';
  }
  var any = false;
  MW_GROUPS.forEach(function (g) {
    var list = by[g.key] || [];
    if (!list.length) return;
    any = true;
    var folded = !!folds[g.key];
    h += '<section class="mw-grp ' + (g.cls || '') + (folded ? ' mw-folded' : '') + '" data-grp="' + g.key + '">' +
      '<div class="mw-grp-h" data-fold="' + g.key + '"><span class="mw-tri">▾</span>' + g.label + ' <b>' + list.length + '</b></div>' +
      '<div class="mw-rows">' + list.map(function (it) { return _mwRowHtml(it, today); }).join('') + '</div></section>';
  });
  if (!any) h += '<div class="mw-empty">' + (r.self ? '🎉 담당한 일이 없습니다. 마인드맵 주제 · 이슈 · 회의 액션에 담당과 마감을 넣으면 여기에 모입니다.' : '담당한 일이 없습니다.') + '</div>';
  el.innerHTML = '<div class="mw-wrap">' + h + '</div>';
  _mwBind(el);
}

function _mwRowHtml(it, today) {
  var s = MW_SRC[it.src] || { icon: '•', label: it.src };
  var late = !it.done && it.due && it.due < today;
  return '<div class="mw-row' + (it.done ? ' mw-done' : '') + '" data-key="' + _mwEsc(it.key) + '">' +
    (it.canDone ? '<input type="checkbox" class="mw-chk" data-done="' + _mwEsc(it.key) + '"' + (it.done ? ' checked' : '') + ' title="' + (it.done ? '완료 되돌리기' : '완료 — 원래 자리에도 반영됩니다') + '">' : '<span class="mw-chk-sp"></span>') +
    '<span class="mw-src" title="' + s.label + '">' + s.icon + '<i>' + s.label + '</i></span>' +
    '<span class="mw-title' + (it.src === 'todo' ? ' mw-todo-t' : '') + '" data-open="' + _mwEsc(it.key) + '">' + (it.urgent && !it.done ? '<b class="mw-urg">긴급</b>' : '') + _mwEsc(it.title) + '</span>' +
    (it.ctx ? '<span class="mw-ctx" title="' + _mwEsc(it.ctx) + '">' + _mwEsc(it.ctx) + '</span>' : '<span class="mw-ctx"></span>') +
    (it.progress != null && !it.done ? '<span class="mw-prog" title="진행률"><span style="width:' + Math.max(0, Math.min(100, it.progress)) + '%"></span><em>' + it.progress + '%</em></span>' : '') +
    (it.src === 'todo' && !it.done && _mw.data.self
      ? '<input type="date" class="mw-input mw-date mw-due-edit" data-due="' + _mwEsc(it.key) + '" value="' + _mwEsc(it.due || '') + '" title="마감 바꾸기">'
      : '<span class="mw-due' + (late ? ' mw-late' : '') + '">' + _mwEsc(_mwDueLabel(it.due, today)) + '</span>') +
    (it.src === 'todo' && _mw.data.self ? '<button class="mw-x" data-del="' + _mwEsc(it.key) + '" title="지우기">×</button>' : '') +
    '</div>';
}

function _mwFind(key) { return ((_mw.data && _mw.data.data) || []).filter(function (x) { return x.key === key; })[0]; }

function _mwBind(el) {
  var who = el.querySelector('#mwWho');
  if (who) who.onchange = function () { _mw.userId = who.value; _mw.src = 'all'; _mw.anchor = null; renderMyWork(); };
  var add = el.querySelector('#mwAdd');
  if (add) add.onsubmit = function (e) {
    e.preventDefault();
    var t = el.querySelector('#mwAddTitle'), d = el.querySelector('#mwAddDue');
    var title = (t.value || '').trim();
    if (!title) { t.focus(); return; }
    apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: title, dueDate: d.value || null }) }).then(function () {
      renderMyWork();
      setTimeout(function () { var x = document.getElementById('mwAddTitle'); if (x) x.focus(); }, 300);
    }).catch(function (e2) { _mwToast('❌ ' + _mwErr(e2), 'error'); });
  };
  el.onclick = function (e) {
    var t = e.target;
    if (t.closest('[data-mw="refresh"]')) { renderMyWork(); return; }
    if (typeof mwCalClick === 'function' && mwCalClick(e)) return;
    var chip = t.closest('[data-src]');
    if (chip) { _mw.src = chip.getAttribute('data-src'); _mwPaint(); return; }
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
      if (!it || !confirm('"' + it.title + '" 할 일을 지울까요?')) return;
      apiFetch('/api/my-work/todos/' + encodeURIComponent(it.id), { method: 'DELETE' }).then(renderMyWork).catch(function (e2) { _mwToast('❌ ' + _mwErr(e2), 'error'); });
      return;
    }
    var op = t.closest('[data-open]');
    if (op) {
      var it2 = _mwFind(op.getAttribute('data-open'));
      if (it2 && it2.src === 'todo' && _mw.data.self && !it2.done) { _mwEditTodo(op, it2); return; }
      mwOpenItem(it2);
    }
  };
  el.onchange = function (e) {
    var t = e.target;
    if (t.hasAttribute('data-done')) { _mwToggleDone(_mwFind(t.getAttribute('data-done')), t.checked, t); return; }
    if (t.hasAttribute('data-due')) {
      var it = _mwFind(t.getAttribute('data-due'));
      if (!it) return;
      apiFetch('/api/my-work/todos/' + encodeURIComponent(it.id), { method: 'PUT', body: JSON.stringify({ dueDate: t.value || null }) }).then(renderMyWork)
        .catch(function (e2) { _mwToast('❌ ' + _mwErr(e2), 'error'); });
    }
  };
}

function _mwEditTodo(span, it) {
  var inp = document.createElement('input');
  inp.className = 'mw-input mw-title-edit';
  inp.value = it.title; inp.maxLength = 500;
  span.replaceWith(inp);
  inp.focus(); inp.select();
  var done = false;
  function finish(save) {
    if (done) return; done = true;
    var v = inp.value.trim();
    if (!save || !v || v === it.title) { _mwPaint(); return; }
    apiFetch('/api/my-work/todos/' + encodeURIComponent(it.id), { method: 'PUT', body: JSON.stringify({ title: v }) }).then(renderMyWork)
      .catch(function (e) { _mwToast('❌ ' + _mwErr(e), 'error'); _mwPaint(); });
  }
  inp.onkeydown = function (e) { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); };
  inp.onblur = function () { finish(true); };
}

function _mwToggleDone(it, done, box) {
  if (!it) return;
  box.disabled = true;
  var row = box.closest('.mw-row');
  if (row) row.classList.toggle('mw-done', done);
  apiFetch('/api/my-work/done', { method: 'PUT', body: JSON.stringify({ src: it.src, id: it.id, userId: it.userId, done: done }) }).then(function () {
    it.done = done; it.doneAt = done ? new Date().toISOString() : null;
    _mwToast(done ? '✅ 완료 — ' + (MW_SRC[it.src] || {}).label + '에도 반영했습니다' : '↩ 완료를 되돌렸습니다');
    setTimeout(_mwPaint, 350);   // 체크가 보인 뒤 '다 한 것' 으로 옮김
  }).catch(function (e) {
    box.checked = !done; box.disabled = false;
    if (row) row.classList.toggle('mw-done', !done);
    _mwToast('❌ ' + _mwErr(e), 'error');
  });
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
  var h = '<div class="mw-head"><h2>👥 업무 부하</h2>' +
    '<div class="mw-sum"><span class="mw-sub">칸 = 그 주에 마감인 남은 일 (진행률만큼 덜 셈) · 칸을 누르면 목록 · 목록 줄을 사람 이름에 끌어 놓으면 담당이 바뀝니다</span></div>' +
    '<div class="mw-tools">' +
      (Object.keys(depts).length > 1 ? '<select id="mwDept" class="mw-sel"><option value="">전체 부서</option>' + Object.keys(depts).map(function (d) {
        return '<option value="' + _mwEsc(d) + '"' + (d === _mw.dept ? ' selected' : '') + '>' + _mwEsc(depts[d]) + '</option>';
      }).join('') + '</select>' : '') +
      '<select id="mwWeeks" class="mw-sel">' + [4, 8, 12].map(function (w) { return '<option value="' + w + '"' + (w === _mw.weeks ? ' selected' : '') + '>' + w + '주</option>'; }).join('') + '</select>' +
      '<button class="mw-btn" data-mw="refresh" title="새로 고침">↻</button></div></div>';
  h += '<div class="mw-load-scroll"><table class="mw-load"><thead><tr><th class="mw-l-name">사람</th><th class="mw-l-late">지연</th>' +
    L.weeks.map(function (w, i) { return '<th' + (i === 0 ? ' class="mw-l-now"' : '') + '>' + (i === 0 ? '이번 주' : (+w.slice(5, 7)) + '/' + (+w.slice(8, 10))) + '</th>'; }).join('') +
    '<th>이후</th><th>마감 없음</th><th>합계</th></tr></thead><tbody>';
  var sel = _mw.loadSel;
  function td(uid, col, c, extra) {
    var on = sel && sel.u === uid && sel.c === col;
    if (!c || !c.n) return '<td class="mw-cell' + (extra || '') + '"></td>';
    return '<td class="mw-cell mw-h' + (col === 'late' ? 'L' : col === 'nodue' || col === 'later' ? 'N' : _mwHeat(c.w)) + (on ? ' mw-on' : '') + (extra || '') + '" data-cell="' + uid + '|' + col + '" title="' + c.n + '건 · 남은 양 ' + c.w + '">' + c.n + '</td>';
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
