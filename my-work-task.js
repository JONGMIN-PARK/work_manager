/* ═══════════════════════════════════════════════════════════════════════
   my-work-task.js — 🎯 내 업무 할 일 관리 · 종류별 등록 (v13.253)
   ─────────────────────────────────────────────────────────────────────
   중요도 4단계 (1 긴급 · 2 높음 · 3 보통 · 4 낮음) — 이슈 · 회의 액션 · 개발 · 사전검토 · 맵 주제는 원래 자리에 반영
   ⭐ 오늘 집중 · 정렬(마감 · 중요도 · 직접 순서) · 거르기 (할 일 편집은 my-work-panel.js 상세 패널)
   종류별 등록 창 — 할 일 · 회의 · 출장 · 외근 · 연차/반차 · 검토 · 기타 (참석자 고르기 · 겹침 경고 · 회의록 같이 만들기)
   중요 × 급함 칸 계산 (mwQuadOf) — 보드 그리기는 my-work-board.js (v13.268)
   서버 API: PUT /api/my-work/priority · /mark · /order · GET /directory · POST·PUT /todos · POST /api/meetings · /api/events
   전역 의존: _mw · _mwPaint · _mwFind · _mwEsc · _mwToast · _mwErr · _mwMe · _mwLS · _mwDays · _mwDueLabel · MW_SRC · mwOpenItem · renderMyWork (my-work.js)
              _mwc · mwCalLoadEvents · _mwcAfterChange · _mwcEventModal (my-work-cal.js) · QuickParse (quick-parse.js)
              createEvent · createModal · projGetAll · projCanEdit · ymdAddDays (project-data.js) · wmGuardedModal · EVT_TYPE
   ═══════════════════════════════════════════════════════════════════════ */

var MW_PRI = {
  1: { label: '긴급', icon: '🔴', color: '#DC2626' },
  2: { label: '높음', icon: '🟠', color: '#F97316' },
  3: { label: '보통', icon: '🟡', color: '#94A3B8' },
  4: { label: '낮음', icon: '⚪', color: '#64748B' }
};
var MW_TODO_STATUS = { todo: '할 일', doing: '진행 중', waiting: '대기' };
var MW_REPEAT = { '': '반복 없음', daily: '매일', weekdays: '평일마다', weekly: '매주', monthly: '매월' };
/* 등록 종류 — evt: 일정 유형(EVT_TYPE), time: 시각 칸, range: 종료일, place: 장소, people: 참석자/동행, proj: 프로젝트, half: 정해진 시각 */
var MW_KINDS = [
  { k: 'todo', icon: '✏️', label: '할 일', time: true },
  { k: 'meeting', icon: '🤝', label: '회의', evt: 'meeting', time: true, place: true, people: '참석자', proj: true, defDur: 60 },
  { k: 'trip', icon: '✈️', label: '출장', evt: 'trip', range: true, place: true, people: '동행', proj: true },
  { k: 'fieldService', icon: '🔧', label: '외근', evt: 'fieldService', time: true, place: true, people: '동행', proj: true, defDur: 240 },
  { k: 'dayoff', icon: '🌴', label: '연차', evt: 'dayoff', range: true },
  { k: 'amoff', icon: '🌅', label: '오전반차', evt: 'amoff', half: ['09:00', '13:00'] },
  { k: 'pmoff', icon: '🌇', label: '오후반차', evt: 'pmoff', half: ['14:00', '18:00'] },
  { k: 'review', icon: '🔍', label: '검토', evt: 'review', time: true, proj: true, defDur: 60 },
  { k: 'etc', icon: '📌', label: '기타 일정', evt: 'etc', time: true, place: true, defDur: 60 }
];
function _mwKind(k) { return MW_KINDS.filter(function (x) { return x.k === k; })[0] || MW_KINDS[0]; }
function _mwtToday() { return (_mw.data && _mw.data.today) || localDate(); }
function _mwtMin(t) { return t ? (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)) : 0; }
function _mwtHm(m) { m = Math.max(0, Math.min(23 * 60 + 59, m)); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }

/* ── 목록 줄 조각 (my-work.js _mwRowHtml 가 부름) ─────────────────── */
function mwPriBadge(it) {
  var p = MW_PRI[it.pri] || MW_PRI[3];
  if (it.done) return '<span class="mw-pri-sp"></span>';
  var can = it.canPri ? ' data-pri="' + _mwEsc(it.key) + '" role="button" tabindex="0" title="중요도 바꾸기 — ' + (it.src === 'todo' ? '' : (MW_SRC[it.src] || {}).label + '에도 반영') + '"' : ' title="중요도 ' + p.label + '"';
  return '<span class="mw-pri mw-pri' + (it.pri || 3) + (it.canPri ? ' is-can' : '') + '"' + can + '>' + (it.pri === 3 || !it.pri ? '' : p.label) + '</span>';
}
function mwFocusBtn(it) {
  if (!_mw.data || !_mw.data.self || it.done) return '';
  return '<button class="mw-star' + (it.focus ? ' on' : '') + '" data-focus="' + _mwEsc(it.key) + '" title="' + (it.focus ? '오늘 집중에서 빼기' : '⭐ 오늘 집중 — 목록 맨 위에') + '">' + (it.focus ? '★' : '☆') + '</button>';
}
/** 개인 할 일 덧붙임 — 상태 · 하위 항목 · 메모 · 반복 */
function mwTodoExtra(it) {
  var h = '';
  if (it.todoStatus === 'doing') h += '<span class="mw-st mw-st-doing">진행 중</span>';
  if (it.todoStatus === 'waiting') h += '<span class="mw-st mw-st-wait" title="기다리는 중' + (it.waitingFor ? ' — ' + _mwEsc(it.waitingFor) : '') + '">대기' + (it.waitingFor ? ' · ' + _mwEsc(it.waitingFor) : '') + '</span>';
  if (it.checkTotal) h += '<span class="mw-cl" title="하위 항목">☑ ' + it.checkDone + '/' + it.checkTotal + '</span>';
  if (it.memo) h += '<span class="mw-ic" title="' + _mwEsc(it.memo.slice(0, 200)) + '">📝</span>';
  if (it.repeat) h += '<span class="mw-ic" title="' + _mwEsc(MW_REPEAT[it.repeat] || '') + ' 반복">🔁</span>';
  if (it.estimateH) h += '<span class="mw-ic mw-est" title="예상 시간">' + it.estimateH + 'h</span>';
  return h;
}

/* ── 정렬 · 거르기 ────────────────────────────────────────────────── */
function mwSortMode() { return _mwLS('sort') || 'due'; }
function mwPriFilter() { return _mwLS('prif') || 'all'; }
function mwFilterItem(it) {
  var f = mwPriFilter();
  if (f === 'hot' && it.pri > 2) return false;
  if (f === 'urgent' && it.pri !== 1) return false;
  if (f === 'doing' && it.todoStatus !== 'doing') return false;
  if (f === 'waiting' && it.todoStatus !== 'waiting') return false;
  return true;
}
function mwSortFn(group) {
  var mode = mwSortMode();
  return function (a, b) {
    if (group === 'done') return String(b.doneAt || '').localeCompare(String(a.doneAt || ''));
    if (mode === 'manual' && (a.order != null || b.order != null)) {
      if (a.order == null) return 1;
      if (b.order == null) return -1;
      if (a.order !== b.order) return a.order - b.order;
    }
    var due = function (x) { return String(x.due || '9999') + (x.dueTime || '99'); };
    if (mode === 'pri') return (a.pri - b.pri) || due(a).localeCompare(due(b)) || a.title.localeCompare(b.title);
    return due(a).localeCompare(due(b)) || (a.pri - b.pri) || a.title.localeCompare(b.title);
  };
}
function mwListToolsHtml() {
  var s = mwSortMode(), f = mwPriFilter();
  return '<div class="mw-ltools">' +
    '<select class="mw-sel" id="mwSort" title="정렬">' + [['due', '마감순'], ['pri', '중요도순'], ['manual', '직접 순서 (끌어서)']].map(function (x) {
      return '<option value="' + x[0] + '"' + (s === x[0] ? ' selected' : '') + '>↕ ' + x[1] + '</option>';
    }).join('') + '</select>' +
    '<select class="mw-sel" id="mwPriF" title="거르기">' + [['all', '모두'], ['hot', '🔴🟠 긴급 · 높음'], ['urgent', '🔴 긴급만'], ['doing', '진행 중 (할 일)'], ['waiting', '대기 (할 일)']].map(function (x) {
      return '<option value="' + x[0] + '"' + (f === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
    }).join('') + '</select>' +
    (s === 'manual' ? '<span class="mw-sub">줄을 끌어 순서를 바꾸세요 (묶음 안에서)</span>' : '') +
    '</div>';
}

/* ── 누르기 · 바꾸기 (my-work.js el.onclick / onchange 에서 먼저 부름) ── */
function mwTaskClick(e) {
  var t = e.target;
  var pb = t.closest('[data-pri]');
  if (pb) { _mwPriMenu(pb, _mwFind(pb.getAttribute('data-pri'))); return true; }
  var fb = t.closest('[data-focus]');
  if (fb) { mwToggleFocus(_mwFind(fb.getAttribute('data-focus'))); return true; }
  if (t.closest('[data-mwt="new"]')) { mwRegister({ date: _mwtToday(), kind: 'meeting' }); return true; }
  return false;
}
function mwTaskChange(e) {
  var t = e.target;
  if (t.id === 'mwSort') { _mwLS('sort', t.value); _mwPaint(); return true; }
  if (t.id === 'mwPriF') { _mwLS('prif', t.value); _mwPaint(); return true; }
  return false;
}

function _mwPriMenu(anchor, it) {
  if (!it) return;
  mwPopMenu(anchor, [1, 2, 3, 4].map(function (p) {
    return '<button data-v="' + p + '"' + (it.pri === p ? ' class="on"' : '') + '>' + MW_PRI[p].icon + ' ' + MW_PRI[p].label + '</button>';
  }).join('') + (it.src !== 'todo' ? '<div class="mw-pmenu-n">' + _mwEsc((MW_SRC[it.src] || {}).label || '') + '에도 반영됩니다</div>' : ''),
  function (v) { mwSetPriority(it, +v); }, { id: 'mwPriMenu', key: 'pri:' + it.key, align: 'left' });
}
function mwSetPriority(it, p) {
  if (!it || it.pri === p) return Promise.resolve();
  var prev = it.pri;
  it.pri = p; it.urgent = p === 1;
  _mwPaint();
  return apiFetch('/api/my-work/priority', { method: 'PUT', body: JSON.stringify({ src: it.src, id: it.id, userId: it.userId, priority: p }) }).then(function () {
    var msg = MW_PRI[p].icon + ' 중요도 ' + MW_PRI[p].label + (it.src !== 'todo' ? ' — ' + (MW_SRC[it.src] || {}).label + '에도 반영' : '');
    if (typeof mwUndoToast === 'function') mwUndoToast(msg, function () { mwSetPriority(it, prev); }); else _mwToast(msg);
    if (typeof mwPanelSync === 'function') mwPanelSync();
  }).catch(function (e) { it.pri = prev; it.urgent = prev === 1; _mwPaint(); _mwToast('❌ ' + _mwErr(e), 'error'); });
}
function mwToggleFocus(it) {
  if (!it) return;
  var on = !it.focus;
  it.focus = on ? _mwtToday() : null;
  _mwPaint();
  apiFetch('/api/my-work/mark', { method: 'PUT', body: JSON.stringify({ key: it.src + ':' + it.id, focus: on }) }).then(function () {
    if (on) _mwToast('⭐ 오늘 집중에 넣었습니다 — 끝낼 때까지 맨 위에 있고 아침 브리핑에도 나옵니다');
  }).catch(function (e) { it.focus = on ? null : _mwtToday(); _mwPaint(); _mwToast('❌ ' + _mwErr(e), 'error'); });
}

/* ── 직접 순서 — 같은 묶음 안에서 끌기 ────────────────────────────── */
function mwBindOrder(el) {
  if (el._mwOrd) return;
  el._mwOrd = true;
  var drag = null;
  el.addEventListener('dragstart', function (e) {
    var row = e.target.closest && e.target.closest('.mw-row[data-ord]');
    if (!row) return;
    drag = row;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.getAttribute('data-key'));
    row.classList.add('mw-row-drag');
  });
  el.addEventListener('dragover', function (e) {
    if (!drag) return;
    var row = e.target.closest && e.target.closest('.mw-row[data-ord]');
    if (!row || row === drag || row.parentNode !== drag.parentNode) return;
    e.preventDefault();
    var r = row.getBoundingClientRect();
    row.parentNode.insertBefore(drag, e.clientY < r.top + r.height / 2 ? row : row.nextSibling);
  });
  el.addEventListener('drop', function (e) { if (drag) e.preventDefault(); });
  el.addEventListener('dragend', function () {
    if (!drag) return;
    var box = drag.parentNode;
    drag.classList.remove('mw-row-drag');
    drag = null;
    var keys = [];
    box.querySelectorAll('.mw-row[data-ord]').forEach(function (r, i) {
      var it = _mwFind(r.getAttribute('data-key'));
      if (it) { it.order = i; keys.push(it.src + ':' + it.id); }
    });
    if (!keys.length) return;
    apiFetch('/api/my-work/order', { method: 'PUT', body: JSON.stringify({ keys: keys }) }).catch(function (er) { _mwToast('❌ 순서를 저장하지 못했습니다 — ' + _mwErr(er), 'error'); renderMyWork(); });
  });
}

/* 창 열기 — 머리(✕)와 Esc 를 직접 묶어 저장 안 한 내용이 있으면 묻는다 (createModal 기본 ✕ · Esc 는 그냥 닫음) */
function _mwtModal(id, width, title, body, isDirty) {
  var ov = createModal({ id: id, width: width, html: '<div class="mwt-head"><b>' + title + '</b><button type="button" class="mwt-x" data-mwt-close title="닫기 (Esc)">✕</button></div>' + body }).overlay;
  function close(force) {
    if (!ov.isConnected) return;
    if (!force && isDirty() && !confirm('저장하지 않은 내용이 있습니다. 닫을까요?')) return;
    ov.remove();
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    if (e.key !== 'Escape' || e.isComposing || !ov.isConnected) return;
    var all = document.querySelectorAll('.wa-modal-overlay');
    if (all[all.length - 1] !== ov) return;   // 맨 위 창만
    e.stopPropagation();
    close();
  }
  document.addEventListener('keydown', onKey, true);
  ov.querySelector('[data-mwt-close]').onclick = function () { close(); };
  return { ov: ov, close: close };
}

/* 할 일 편집은 my-work-panel.js 상세 패널 (v13.254 — 팝업 대신 자동 저장 패널) */

/* ═══ 종류별 등록 창 ═══ */
/** opt: { date, t1, t2, kind, title } */
function mwRegister(opt) {
  opt = opt || {};
  wmGuardedModal('mwReg', function () {
    var need = [_mw.dir ? null : apiFetch('/api/my-work/directory').then(function (r) { _mw.dir = (r && r.data) || []; }).catch(function () { _mw.dir = []; })];
    return Promise.all(need).then(function () { _mwBuildRegister(opt); });
  }, 'mwRegModal', { onOpen: function () { var x = document.getElementById('mwrTitle'); if (x) x.focus(); } });
}
function _mwBuildRegister(opt) {
  var st = { kind: opt.kind || (opt.t1 ? 'meeting' : 'todo'), pri: 3, people: [] };
  var html = '<form id="mwrForm" class="mwt-f">' +
    '<div class="mwr-kinds" id="mwrKinds">' + MW_KINDS.map(function (k) {
      return '<button type="button" data-k="' + k.k + '"' + (k.k === st.kind ? ' class="on"' : '') + '>' + k.icon + ' ' + k.label + '</button>';
    }).join('') + '</div>' +
    '<input id="mwrTitle" class="mw-input mwt-title" maxlength="255" autocomplete="off" value="' + _mwEsc(opt.title || '') + '">' +
    '<div class="mwr-hint" id="mwrHint">💡 "내일 14:00 !긴급 견적 회신" 처럼 적으면 날짜 · 시각 · 중요도를 알아서 채웁니다</div>' +
    '<div class="mwt-row"><span class="mwt-l" id="mwrDateL">날짜</span><input id="mwrDate" type="date" class="mw-input" value="' + _mwEsc(opt.date || _mwtToday()) + '">' +
      '<span data-f="range">~ <input id="mwrEnd" type="date" class="mw-input" value="' + _mwEsc(opt.date || _mwtToday()) + '"></span>' +
      '<span data-f="time"><input id="mwrT1" type="time" step="300" class="mw-input" value="' + _mwEsc(opt.t1 || '') + '"> ~ <input id="mwrT2" type="time" step="300" class="mw-input" value="' + _mwEsc(opt.t2 || '') + '"></span>' +
      '<span data-f="half" class="mw-sub" id="mwrHalf"></span></div>' +
    '<div class="mwr-warn" id="mwrWarn" hidden></div>' +
    '<div class="mwt-row" data-f="pri"><span class="mwt-l">중요도</span><span class="mwt-seg" id="mwrPri">' + [1, 2, 3, 4].map(function (p) {
      return '<button type="button" data-v="' + p + '" class="mwt-p' + p + (p === 3 ? ' on' : '') + '">' + MW_PRI[p].icon + ' ' + MW_PRI[p].label + '</button>';
    }).join('') + '</span><select id="mwrRep" class="mw-sel">' + Object.keys(MW_REPEAT).map(function (k) { return '<option value="' + k + '">' + MW_REPEAT[k] + '</option>'; }).join('') + '</select></div>' +
    '<div class="mwt-row" data-f="place"><span class="mwt-l">장소</span><input id="mwrPlace" class="mw-input mwr-wide" maxlength="255" placeholder="회의실 · 고객사 · 지역"></div>' +
    '<div class="mwt-row" data-f="people"><span class="mwt-l" id="mwrPeopleL">참석자</span><span class="mwr-people" id="mwrPeople"></span>' +
      '<select id="mwrPick" class="mw-sel"><option value="">+ 사람 고르기</option>' + (_mw.dir || []).filter(function (u) { return u.id !== _mwMe(); }).map(function (u) {
        return '<option value="' + _mwEsc(u.name) + '">' + _mwEsc(u.display || u.name) + (u.dept ? ' · ' + _mwEsc(u.dept) : '') + '</option>';
      }).join('') + '</select></div>' +
    '<div class="mwt-row" data-f="proj"><span class="mwt-l">프로젝트</span><select id="mwrProj" class="mw-sel mwr-wide"><option value="">(없음 — 개인)</option></select></div>' +
    '<label class="mwr-chk" data-f="minutes"><input type="checkbox" id="mwrMin"> 📝 회의록도 같이 만들기 <i>(회의 탭에서 안건 · 결정 · 액션 기록)</i></label>' +
    '<textarea id="mwrMemo" class="mw-input mwt-memo" rows="2" maxlength="5000" placeholder="메모 (선택)"></textarea>' +
    '<div class="mwc-q-btns"><button type="button" class="mw-btn" id="mwrMore" data-f="more" title="반복 · 색 · 여러 프로젝트">자세히…</button><span style="flex:1"></span>' +
      '<button type="button" class="mw-btn" id="mwrCancel">닫기</button><button type="submit" class="mw-btn mw-btn-p">등록</button></div></form>';
  var M = _mwtModal('mwRegModal', '560px', '➕ 등록', html, function () { return !!($('mwrTitle').value.trim() || $('mwrMemo').value.trim() || $('mwrPlace').value.trim() || st.people.length); });
  var ov = M.ov;
  var $ = function (id) { return ov.querySelector('#' + id); };
  // 프로젝트 — 편집할 수 있는 것만 (서버 규칙과 같음)
  if (typeof projGetAll === 'function') projGetAll().then(function (ps) {
    var sel = $('mwrProj');
    if (!sel) return;
    ps.filter(function (p) { return p.status !== 'done' && (typeof projCanEdit !== 'function' || projCanEdit(p)); }).forEach(function (p) {
      var o = document.createElement('option'); o.value = p.id; o.textContent = p.name || p.orderNo; sel.appendChild(o);
    });
  }).catch(function () {});

  function kind() { return _mwKind(st.kind); }
  function apply() {
    var k = kind();
    var show = { range: !!k.range, time: !!k.time, half: !!k.half, pri: k.k === 'todo', place: !!k.place, people: !!k.people, proj: !!k.proj, minutes: k.k === 'meeting', more: !!k.evt && !k.half && k.k !== 'dayoff' };
    ov.querySelectorAll('[data-f]').forEach(function (x) { x.hidden = !show[x.getAttribute('data-f')]; });
    $('mwrDateL').textContent = k.k === 'todo' ? '마감' : k.range ? '기간' : '날짜';
    $('mwrHalf').textContent = k.half ? k.half[0] + ' ~ ' + k.half[1] : '';
    if (k.people) $('mwrPeopleL').textContent = k.people;
    $('mwrTitle').placeholder = k.k === 'todo' ? '무엇을 할까요?' : k.half || k.k === 'dayoff' ? k.label + ' (메모 — 비워도 됨)' : k.label + ' 제목';
    if (k.k !== 'todo' && k.time && $('mwrT1').value && !$('mwrT2').value && k.defDur) $('mwrT2').value = _mwtHm(_mwtMin($('mwrT1').value) + k.defDur);
    ov.querySelectorAll('#mwrKinds button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-k') === k.k); });
    checkConflict();
  }
  function paintPeople() {
    $('mwrPeople').innerHTML = st.people.map(function (n, i) { return '<span class="mwr-pp">' + _mwEsc(n) + '<button type="button" data-px="' + i + '">×</button></span>'; }).join('');
  }
  // 한 줄 읽기 — 제목에서 날짜 · 시각 · 중요도 · #종류
  function parseTitle() {
    if (typeof QuickParse === 'undefined') return;
    var v = $('mwrTitle').value;
    var q = QuickParse.parse(v, _mwtToday());
    if (q.title === v.trim()) return;
    var got = [];
    if (q.kind && q.kind !== 'todo') { st.kind = q.kind; got.push(_mwKind(q.kind).label); }
    if (q.kind === 'todo') st.kind = 'todo';
    if (q.due) { $('mwrDate').value = q.due; if ($('mwrEnd').value < q.due) $('mwrEnd').value = q.due; got.push((+q.due.slice(5, 7)) + '/' + (+q.due.slice(8, 10))); }
    if (q.time) { $('mwrT1').value = q.time; $('mwrT2').value = q.timeEnd || ''; got.push(q.time + (q.timeEnd ? '~' + q.timeEnd : '')); if (!q.kind && st.kind === 'todo' && q.timeEnd) st.kind = 'meeting'; }
    if (q.priority) { st.pri = q.priority; ov.querySelectorAll('#mwrPri button').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-v') === st.pri); }); got.push(MW_PRI[st.pri].label); }
    $('mwrTitle').value = q.title;
    $('mwrHint').textContent = '✓ 읽음: ' + got.join(' · ');
    apply();
  }
  $('mwrTitle').addEventListener('blur', parseTitle);
  // Enter — 읽을 게 있으면 읽어서 채우고 멈춤 (확인하고 한 번 더 Enter 로 등록)
  $('mwrTitle').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    var before = $('mwrTitle').value;
    parseTitle();
    if ($('mwrTitle').value !== before) e.preventDefault();
  });

  // 겹침 — 같은 날 시각 있는 내 일정
  var cTimer = null;
  function checkConflict() {
    clearTimeout(cTimer);
    cTimer = setTimeout(function () {
      var k = kind(), d = $('mwrDate').value, t1 = k.half ? k.half[0] : $('mwrT1').value, t2 = k.half ? k.half[1] : $('mwrT2').value;
      var w = $('mwrWarn');
      if (!w) return;
      if (k.k === 'todo' || !d || !t1) { w.hidden = true; return; }
      var s1 = _mwtMin(t1), e1 = t2 && t2 > t1 ? _mwtMin(t2) : s1 + 60;
      apiFetch('/api/my-work/events?from=' + d + '&to=' + d).then(function (r) {
        var rows = typeof expandRepeatingEvents === 'function' ? expandRepeatingEvents(toCamelArray((r && r.data) || []), d, d) : [];
        var hit = rows.filter(function (ev) {
          if (ev.startDate !== d || !ev.startTime) return false;
          var s2 = _mwtMin(ev.startTime), e2 = ev.endTime && ev.endTime > ev.startTime ? _mwtMin(ev.endTime) : s2 + 60;
          return s1 < e2 && s2 < e1;
        });
        if (!$('mwrWarn')) return;
        w.hidden = !hit.length;
        w.innerHTML = hit.length ? '⚠️ 겹치는 일정 — ' + hit.slice(0, 3).map(function (ev) { return '<b>' + _mwEsc(ev.startTime + (ev.endTime ? '~' + ev.endTime : '')) + '</b> ' + _mwEsc(ev.title || ''); }).join(', ') + ' (그래도 등록할 수 있습니다)' : '';
      }).catch(function () {});
    }, 250);
  }
  ['mwrDate', 'mwrT1', 'mwrT2'].forEach(function (id) { $(id).addEventListener('change', function () {
    if (id === 'mwrDate' && $('mwrEnd').value < $('mwrDate').value) $('mwrEnd').value = $('mwrDate').value;
    if (id === 'mwrT1' && kind().defDur && (!$('mwrT2').value || $('mwrT2').value <= $('mwrT1').value)) $('mwrT2').value = _mwtHm(_mwtMin($('mwrT1').value) + kind().defDur);
    checkConflict();
  }); });

  ov.querySelector('form').onclick = function (e) {
    var kb = e.target.closest('[data-k]');
    if (kb) { st.kind = kb.getAttribute('data-k'); apply(); return; }
    var pb = e.target.closest('#mwrPri [data-v]');
    if (pb) { st.pri = +pb.getAttribute('data-v'); ov.querySelectorAll('#mwrPri button').forEach(function (b) { b.classList.toggle('on', b === pb); }); return; }
    var px = e.target.closest('[data-px]');
    if (px) { st.people.splice(+px.getAttribute('data-px'), 1); paintPeople(); }
  };
  $('mwrPick').onchange = function () {
    if (this.value && st.people.indexOf(this.value) < 0) st.people.push(this.value);
    this.value = ''; paintPeople();
  };
  $('mwrCancel').onclick = function () { M.close(); };
  $('mwrMore').onclick = function () {
    var v = vals();
    M.close(true);
    _mwcEventModal(null, v.date, { title: v.title, startTime: v.t1, endTime: v.t2, location: v.place });
  };
  function vals() {
    var k = kind();
    var t1 = k.half ? k.half[0] : k.time ? $('mwrT1').value : '';
    var t2 = k.half ? k.half[1] : k.time && t1 ? $('mwrT2').value : '';
    return { k: k, title: $('mwrTitle').value.trim(), date: $('mwrDate').value, end: k.range ? ($('mwrEnd').value || $('mwrDate').value) : $('mwrDate').value,
      t1: t1, t2: t2, place: k.place ? $('mwrPlace').value.trim() : '', proj: k.proj ? $('mwrProj').value : '', memo: $('mwrMemo').value.trim() };
  }
  var busy = false;
  ov.querySelector('form').onsubmit = function (e) {
    e.preventDefault();
    if (busy) return;
    parseTitle();
    var v = vals(), k = v.k;
    var title = v.title || (k.evt && (k.half || k.k === 'dayoff') ? k.label : '');
    if (!title) { $('mwrTitle').focus(); _mwToast('제목을 적어 주세요', 'warn'); return; }
    if (!v.date) { _mwToast('날짜를 고르세요', 'warn'); return; }
    if (v.end < v.date) { _mwToast('끝나는 날이 시작보다 앞설 수 없습니다', 'warn'); return; }
    if (v.t1 && v.t2 && v.t2 <= v.t1) { _mwToast('끝 시각이 시작 시각보다 늦어야 합니다', 'warn'); return; }
    if (k.k === 'todo' && $('mwrRep').value && !v.date) { _mwToast('반복은 마감일이 있어야 합니다', 'warn'); return; }
    busy = true;
    if (typeof _mwc !== 'undefined') _mwc.selfAt = Date.now();
    var p;
    if (k.k === 'todo') {
      p = apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: title, dueDate: v.date, dueTime: v.t1 || null, priority: st.pri, repeat: $('mwrRep').value || null, memo: v.memo || null }) });
    } else if (k.k === 'meeting' && $('mwrMin').checked) {
      // 회의록과 같이 — 회의를 만들면 서버가 일정을 붙여 준다 (시각 · 참석자 · 장소 따라감)
      p = apiFetch('/api/meetings', { method: 'POST', body: JSON.stringify({ title: title, projectId: v.proj || null, meetDate: v.date, attendees: st.people,
        form: { timeStart: v.t1 || '', timeEnd: v.t2 || '', place: v.place || '' }, minutes: v.memo || null }) });
    } else {
      p = createEvent({ title: title, type: k.evt, startDate: v.date, endDate: v.end, startTime: v.t1 || null, endTime: v.t1 ? (v.t2 || null) : null,
        projectIds: v.proj ? [v.proj] : [], assignees: st.people, location: v.place, memo: v.memo });
    }
    p.then(function (r) {
      M.close(true);
      _mwToast(k.icon + ' ' + k.label + ' 등록 — ' + title + (st.people.length && k.people ? ' (' + k.people + ' 달력에도 나옵니다)' : ''));
      if (typeof _pdInvalidate === 'function') _pdInvalidate('evt');
      if (k.k === 'todo') { if (!(r && r.data && mwPutTodo(r.data))) renderMyWork(); }   // 할 일은 그 한 줄만 바로 (v13.270)
      else _mwcAfterChange();
    }).catch(function (e2) { busy = false; _mwToast('❌ ' + _mwErr(e2), 'error'); });
  };
  apply();
  paintPeople();
}

/* ═══ 중요 × 급함 — 보드 기본 칸(rule 1~4)의 자동 분류 ═══ */
/** 급함 = 지연 · 오늘~2일 안 마감 / 중요 = 긴급 · 높음 → 1 지금 하기 · 2 계획하기 · 3 빨리 끝내기 · 4 나중에 */
function mwQuadOf(it, today) {
  var imp = it.pri <= 2;
  var urg = !!it.due && _mwDays(today, it.due) <= 2;
  return imp ? (urg ? 1 : 2) : (urg ? 3 : 4);
}
