/* ═══════════════════════════════════════════════════════════════════════
   my-work-panel.js — 🎯 내 업무 상세 패널 · 되돌리기 · 단축키 (v13.254)
   ─────────────────────────────────────────────────────────────────────
   할 일 편집은 이 패널 하나로 (예전 팝업 · 줄 안 편집 · 날짜 칸을 대신함).
     · 오른쪽에 열리고 목록은 그대로 — 다른 줄을 누르면 패널 내용만 바뀜
     · 자동 저장 — 고치면 바로 (글자는 잠깐 쉬었다가), 닫아도 남은 저장을 마저 함. [저장] 버튼 없음
     · 모든 출처를 같은 패널에서 — 개인 할 일은 전부, 이슈 · 회의 액션 · 맵 주제 등은 중요도 · 마감 · 완료 · 집중 + [원래 화면 열기]
     · 하위 항목: Enter 다음 줄 · 빈 줄 Backspace 지우기 · ↑↓ 이동 · 여러 줄 붙여넣기 · 끌어서 순서
     · 되돌리기 — 완료 · 지우기 · 중요도 · 마감을 아래 알림에서 바로 취소
     · 단축키 (목록 · 4칸): ↑↓/j k 고르기 · Enter 열기 · x 완료 · 1~4 중요도 · f 집중 · d 마감 오늘→내일 · Del 지우기 · n 새로 · ? 도움말
   서버 API: PUT /api/my-work/todos/:id · /done · /priority · /due · /mark · DELETE·POST /todos
   전역 의존: _mw · _mwPaint · _mwFind · _mwEsc · _mwToast · _mwErr · _mwLS · _mwDays · _mwDueLabel · MW_SRC · mwOpenItem · renderMyWork (my-work.js)
              MW_PRI · MW_TODO_STATUS · MW_REPEAT · mwSetPriority · mwToggleFocus (my-work-task.js) · MWC_DUE_SRC (my-work-cal.js)
   ═══════════════════════════════════════════════════════════════════════ */

var _mwp = { key: null, it: null, q: {}, timer: null, inflight: null, state: 'idle', undoT: null };

function _mwpToday() { return (_mw.data && _mw.data.today) || localDate(); }
function _mwpAdd(d, n) { return ymdAddDays(d, n); }
function _mwpDow(d) { return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay(); }
/** 마감 빨리 고르기 — 오늘 · 내일 · 이번 주 금(지났으면 다음 주) · 다음 주 월 */
function _mwpQuickDues() {
  var t = _mwpToday(), w = _mwpDow(t);
  var fri = _mwpAdd(t, ((5 - w) + 7) % 7);
  if (fri <= _mwpAdd(t, 1)) fri = _mwpAdd(fri, 7);   // 오늘 · 내일과 겹치면 다음 주 금
  var mon = _mwpAdd(t, ((1 - w) + 7) % 7 || 7);
  return [['오늘', t], ['내일', _mwpAdd(t, 1)], ['금요일', fri], ['다음 주 월', mon]];
}
function _mwpCanDue(it) { return !it.done && it.canDone && (typeof MWC_DUE_SRC !== 'undefined' ? MWC_DUE_SRC : ['todo', 'mindmap', 'issue', 'action']).indexOf(it.src) >= 0; }
function _mwpIsTodo(it) { return it && it.src === 'todo' && _mw.data && _mw.data.self; }

/* ═══ 열기 · 닫기 ═══ */
function mwPanelOpen(it, opt) {
  if (!it) return;
  opt = opt || {};
  if (_mwp.key && _mwp.key !== it.key) _mwpFlush();
  _mwp.key = it.key; _mwp.it = it;
  _mw.sel = it.key;
  var p = document.getElementById('mwPanel');
  if (!p) {
    p = document.createElement('aside');
    p.id = 'mwPanel'; p.className = 'mwp';
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', '할 일 상세');
    document.body.appendChild(p);
    _mwpBind(p);
  }
  _mwpRender(p);
  document.body.classList.add('mwp-open');
  requestAnimationFrame(function () { p.classList.add('on'); });
  _mwpMarkRow();
  if (opt.focus) { var f = p.querySelector(opt.focus); if (f) { f.focus(); if (f.select) f.select(); } }
}
function mwPanelClose() {
  var p = document.getElementById('mwPanel');
  _mwpFlush();
  _mwp.key = null; _mwp.it = null;
  document.body.classList.remove('mwp-open');
  if (p) p.classList.remove('on');
  _mwpMarkRow();
}
function mwPanelIsOpen() { return !!_mwp.key; }
/** 목록을 새로 받은 뒤 — 같은 항목으로 다시 이어 붙임 (입력 중이면 칸은 그대로) */
function mwPanelSync() {
  if (!_mwp.key) { _mwpMarkRow(); return; }
  var it = _mwFind(_mwp.key);
  var p = document.getElementById('mwPanel');
  if (!it) { mwPanelClose(); return; }
  _mwp.it = it;
  if (p && !p.contains(document.activeElement) && !_mwp.timer && !_mwp.inflight) _mwpRender(p);
  _mwpMarkRow();
}
function _mwpMarkRow() {
  document.querySelectorAll('#mMyWork .mw-picked').forEach(function (r) { r.classList.remove('mw-picked'); });
  if (!_mw.sel) return;
  var r = document.querySelector('#mMyWork [data-key="' + (window.CSS && CSS.escape ? CSS.escape(_mw.sel) : _mw.sel) + '"], #mMyWork [data-qk="' + (window.CSS && CSS.escape ? CSS.escape(_mw.sel) : _mw.sel) + '"]');
  if (r) r.classList.add('mw-picked');
}

/* ═══ 그리기 ═══ */
function _mwpRender(p) {
  var it = _mwp.it, today = _mwpToday();
  var s = MW_SRC[it.src] || { icon: '•', label: it.src };
  var todo = _mwpIsTodo(it);
  var pri = it.pri || 3;
  var h = '<div class="mwp-h"><span class="mwp-src">' + s.icon + ' ' + _mwEsc(s.label) + '</span>' +
    '<span class="mwp-save" id="mwpSave" aria-live="polite"></span>' +
    '<button class="mwp-x" data-p="close" title="닫기 (Esc)">✕</button></div>';
  h += '<div class="mwp-b">';
  // 완료 · 제목
  h += '<div class="mwp-trow">' + (it.canDone ? '<input type="checkbox" class="mw-chk mwp-done" data-p="done"' + (it.done ? ' checked' : '') + ' title="완료">' : '') +
    (todo ? '<textarea id="mwpTitle" class="mwp-title" rows="1" maxlength="500" data-f="title">' + _mwEsc(it.title) + '</textarea>'
          : '<div class="mwp-title mwp-ro">' + _mwEsc(it.title) + '</div>') + '</div>';
  if (it.ctx) h += '<div class="mwp-ctx">' + _mwEsc(it.ctx) + '</div>';
  // 바로 하기 줄 — 집중 · 원래 화면
  h += '<div class="mwp-acts">' +
    (_mw.data.self && !it.done ? '<button class="mwp-chip' + (it.focus ? ' on' : '') + '" data-p="focus">' + (it.focus ? '★ 오늘 집중' : '☆ 오늘 집중') + '</button>' : '') +
    (!todo ? '<button class="mwp-chip" data-p="source">↗ ' + _mwEsc(s.label) + ' 화면에서 열기</button>' : '') + '</div>';
  // 중요도
  h += '<div class="mwp-sec"><div class="mwp-l">중요도' + (!todo && it.canPri ? ' <i>' + _mwEsc(s.label) + '에도 반영</i>' : '') + '</div>' +
    (it.canPri && !it.done ? '<div class="mwp-seg" data-g="pri">' + [1, 2, 3, 4].map(function (v) {
      return '<button data-pri-v="' + v + '" class="mwp-p' + v + (pri === v ? ' on' : '') + '">' + MW_PRI[v].icon + ' ' + MW_PRI[v].label + '</button>';
    }).join('') + '</div>' : '<div class="mwp-ro">' + MW_PRI[pri].icon + ' ' + MW_PRI[pri].label + (it.src === 'milestone' ? ' <i>(마일스톤은 중요도 없음)</i>' : '') + '</div>') + '</div>';
  // 상태 (할 일)
  if (todo) {
    var st = it.todoStatus || 'todo';
    h += '<div class="mwp-sec"><div class="mwp-l">상태</div><div class="mwp-seg" data-g="status">' + Object.keys(MW_TODO_STATUS).map(function (k) {
      return '<button data-st-v="' + k + '"' + (st === k ? ' class="on"' : '') + '>' + MW_TODO_STATUS[k] + '</button>';
    }).join('') + '</div>' +
      '<input id="mwpWait" class="mw-input mwp-in" data-f="waitingFor" maxlength="100" placeholder="누구 · 무엇을 기다리나요?" value="' + _mwEsc(it.waitingFor || '') + '"' + (st === 'waiting' ? '' : ' hidden') + '></div>';
  } else if (it.status) {
    h += '<div class="mwp-sec"><div class="mwp-l">원래 상태</div><div class="mwp-ro">' + _mwEsc(it.status) + (it.progress != null ? ' · 진행 ' + it.progress + '%' : '') + '</div></div>';
  }
  // 마감
  var canDue = _mwpCanDue(it);
  h += '<div class="mwp-sec"><div class="mwp-l">마감' + (it.due ? ' <i class="' + (it.due < today && !it.done ? 'mw-late' : '') + '">' + _mwEsc(_mwDueLabel(it.due, today)) + (it.dueTime ? ' ' + _mwEsc(it.dueTime) : '') + '</i>' : '') + '</div>';
  if (canDue) {
    h += '<div class="mwp-quick">' + _mwpQuickDues().map(function (q) {
      return '<button class="mwp-chip' + (it.due === q[1] ? ' on' : '') + '" data-due-v="' + q[1] + '">' + q[0] + '</button>';
    }).join('') + '<button class="mwp-chip" data-due-v="">없음</button></div>' +
      '<div class="mwp-row"><input id="mwpDue" type="date" class="mw-input" value="' + _mwEsc(it.due || '') + '">' +
      (todo ? '<input id="mwpTime" type="time" step="300" class="mw-input" value="' + _mwEsc(it.dueTime || '') + '" title="마감 시각 — 30분 전 텔레그램 알림"' + (it.due ? '' : ' disabled') + '>' : '') + '</div>';
  } else {
    h += '<div class="mwp-ro">' + (it.due ? _mwEsc(it.due) : '없음') + (it.done ? '' : ' <i>— ' + _mwEsc(s.label) + ' 화면에서 바꿉니다</i>') + '</div>';
  }
  h += '</div>';
  if (todo) {
    h += '<div class="mwp-sec mwp-two"><div><div class="mwp-l">반복</div><select id="mwpRep" class="mw-sel">' + Object.keys(MW_REPEAT).map(function (k) {
        return '<option value="' + k + '"' + ((it.repeat || '') === k ? ' selected' : '') + '>' + MW_REPEAT[k] + '</option>';
      }).join('') + '</select></div>' +
      '<div><div class="mwp-l">예상 시간</div><input id="mwpEst" type="number" min="0" max="999" step="0.5" class="mw-input mwp-num" data-f="estimateH" value="' + (it.estimateH || '') + '" placeholder="시간"></div></div>';
    // 하위 항목
    h += '<div class="mwp-sec"><div class="mwp-l">하위 항목 <i id="mwpClN"></i></div><div class="mwp-clbar"><span id="mwpClBar"></span></div>' +
      '<div id="mwpCl" class="mwp-cl"></div>' +
      '<input id="mwpClAdd" class="mw-input mwp-in" maxlength="200" placeholder="+ 하위 항목 — Enter 로 계속, 여러 줄 붙여넣기 가능"></div>';
    h += '<div class="mwp-sec"><div class="mwp-l">메모</div><textarea id="mwpMemo" class="mw-input mwp-memo" data-f="memo" maxlength="5000" placeholder="자세한 내용 · 링크 · 연락처…">' + _mwEsc(it.memo || '') + '</textarea></div>';
  }
  h += '</div>';
  // 칸 (v13.268) — 보드의 어느 칸에 있는지 · 옮기기
  if (_mw.data.self && !it.done && typeof mwBoardColOf === 'function') {
    var col = mwBoardColOf(it);
    h += '<div class="mwp-sec"><div class="mwp-l">칸' + (it.cat && col.id === it.cat ? ' <i>📌 고정</i>' : ' <i>자동 — 중요도 · 마감 따라</i>') + '</div><div class="mwp-row"><select id="mwpCat" class="mw-sel">' +
      mwBoardCols().map(function (c) { return '<option value="' + _mwEsc(c.id) + '"' + (c.id === col.id ? ' selected' : '') + '>' + _mwEsc((c.icon ? c.icon + ' ' : '') + c.name) + '</option>'; }).join('') +
      '</select>' + (it.cat ? '<button class="mwp-chip" data-p="unpin">고정 풀기</button>' : '') + '</div></div>';
  }
  h += '<div class="mwp-f">' + (todo ? '<button class="mw-btn mwp-del" data-p="delete">🗑 휴지통으로</button>' : '') +
    '<span class="mwp-keys" title="단축키">Esc 닫기 · ? 단축키</span></div>';
  p.innerHTML = h;
  if (todo) { _mwpPaintCl(); _mwpGrow(p.querySelector('#mwpTitle')); _mwpGrow(p.querySelector('#mwpMemo')); }
  _mwpShowState();
}
function _mwpGrow(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, ta.classList.contains('mwp-memo') ? 360 : 140) + 'px'; }

/* ── 하위 항목 ── */
function _mwpCl() { return _mwp.it.checklist || (_mwp.it.checklist = []); }
function _mwpPaintCl(focusIdx, caretEnd) {
  var box = document.getElementById('mwpCl');
  if (!box) return;
  var cl = _mwpCl();
  box.innerHTML = cl.map(function (c, i) {
    return '<div class="mwp-cli' + (c.d ? ' is-d' : '') + '" data-ci="' + i + '"><span class="mwp-grip" draggable="true" title="끌어서 순서">⋮⋮</span>' +
      '<input type="checkbox" data-cchk="' + i + '"' + (c.d ? ' checked' : '') + '>' +
      '<input class="mwp-clt" data-ct="' + i + '" value="' + _mwEsc(c.t) + '" maxlength="200">' +
      '<button class="mw-x" data-cx="' + i + '" title="빼기">×</button></div>';
  }).join('');
  var done = cl.filter(function (c) { return c.d; }).length;
  var n = document.getElementById('mwpClN'); if (n) n.textContent = cl.length ? done + '/' + cl.length : '';
  var bar = document.getElementById('mwpClBar'); if (bar) { bar.style.width = cl.length ? Math.round(done / cl.length * 100) + '%' : '0'; bar.parentNode.hidden = !cl.length; }
  if (focusIdx != null) {
    var f = box.querySelector('[data-ct="' + focusIdx + '"]');
    if (f) { f.focus(); var L = caretEnd ? f.value.length : 0; f.setSelectionRange(L, L); }
  }
}
function _mwpClSave() {
  var it = _mwp.it, cl = _mwpCl();
  it.checkTotal = cl.length; it.checkDone = cl.filter(function (c) { return c.d; }).length;
  it.progress = cl.length ? Math.round(it.checkDone / it.checkTotal * 100) : null;
  _mwpQueue({ checklist: cl.map(function (c) { return { id: c.id, t: c.t, d: !!c.d }; }) }, 400);
}
function _mwpClNewId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function _mwpClAddLines(text, at) {
  var cl = _mwpCl();
  var lines = String(text).split(/\r?\n/).map(function (x) { return x.replace(/^\s*([-*•☐☑]|\d+[.)])\s*/, '').trim(); }).filter(Boolean);
  var room = 50 - cl.length;
  if (lines.length > room) { _mwToast('하위 항목은 50개까지입니다', 'warn'); lines = lines.slice(0, room); }
  var idx = at == null ? cl.length : at;
  lines.forEach(function (t, k) { cl.splice(idx + k, 0, { id: _mwpClNewId(), t: t.slice(0, 200), d: false }); });
  return lines.length;
}

/* ═══ 저장 — 바뀐 칸만 모아서 차례로 ═══ */
function _mwpQueue(patch, delay) {
  Object.keys(patch).forEach(function (k) { _mwp.q[k] = patch[k]; });
  _mwp.state = 'dirty'; _mwpShowState();
  clearTimeout(_mwp.timer);
  _mwp.timer = setTimeout(_mwpFlush, delay == null ? 0 : delay);
}
function _mwpFlush() {
  clearTimeout(_mwp.timer); _mwp.timer = null;
  var it = _mwp.it;
  if (!it || !Object.keys(_mwp.q).length) return _mwp.inflight || Promise.resolve();
  if (_mwp.inflight) { _mwp.inflight.then(function () { _mwpFlush(); }); return _mwp.inflight; }
  var body = _mwp.q; _mwp.q = {};
  var id = it.id;
  _mwp.state = 'saving'; _mwpShowState();
  _mwp.inflight = apiFetch('/api/my-work/todos/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(body) }).then(function () {
    _mwp.inflight = null;
    _mwpApply(it, body);
    _mwp.state = Object.keys(_mwp.q).length ? 'dirty' : 'saved'; _mwpShowState();
    _mwPaint();
    if (Object.keys(_mwp.q).length) _mwpFlush();
  }).catch(function (e) {
    _mwp.inflight = null;
    Object.keys(body).forEach(function (k) { if (!(k in _mwp.q)) _mwp.q[k] = body[k]; });   // 다시 하기용으로 되돌려 둠
    _mwp.state = 'error'; _mwp.err = _mwErr(e); _mwpShowState();
  });
  return _mwp.inflight;
}
/** 저장된 값을 목록 항목에 반영 */
function _mwpApply(it, b) {
  if ('title' in b) it.title = b.title;
  if ('priority' in b) { it.pri = b.priority; it.urgent = b.priority === 1; }
  if ('status' in b) it.todoStatus = b.status;
  if ('waitingFor' in b) it.waitingFor = b.waitingFor;
  if ('dueDate' in b) it.due = b.dueDate;
  if ('dueTime' in b) it.dueTime = b.dueTime;
  if ('repeat' in b) it.repeat = b.repeat;
  if ('estimateH' in b) it.estimateH = b.estimateH;
  if ('memo' in b) it.memo = b.memo;
}
function _mwpShowState() {
  var el = document.getElementById('mwpSave');
  if (!el) return;
  var m = { idle: '', dirty: '…', saving: '저장 중…', saved: '✓ 저장됨', error: '⚠️ 저장 못 함 — 다시 하기' }[_mwp.state] || '';
  el.textContent = m;
  el.className = 'mwp-save is-' + _mwp.state;
  el.title = _mwp.state === 'error' ? (_mwp.err || '') : '';
}

/* ═══ 바로 바뀌는 것 (완료 · 중요도 · 마감 · 집중 · 지우기) — 되돌리기 알림 ═══ */
function mwUndoToast(msg, undo, label) {
  var old = document.getElementById('mwUndo');
  if (old) old.remove();
  clearTimeout(_mwp.undoT);
  var t = document.createElement('div');
  t.id = 'mwUndo'; t.className = 'mw-undo';
  t.innerHTML = '<span>' + _mwEsc(msg) + '</span>' + (undo ? '<button>' + _mwEsc(label || '되돌리기') + '</button>' : '');
  document.body.appendChild(t);
  requestAnimationFrame(function () { t.classList.add('on'); });
  var b = t.querySelector('button');
  if (b) b.onclick = function () { t.remove(); clearTimeout(_mwp.undoT); undo(); };
  _mwp.undoT = setTimeout(function () { t.classList.remove('on'); setTimeout(function () { t.remove(); }, 250); }, 6000);
}
/** 완료 · 되돌리기 — 목록 체크 · 패널 · 단축키 공용 */
function mwSetDone(it, done) {
  if (!it || !it.canDone || !!it.done === !!done) return Promise.resolve();
  var prev = { done: it.done, doneAt: it.doneAt, focus: it.focus };
  it.done = done; it.doneAt = done ? new Date().toISOString() : null; if (done) it.focus = null;
  _mwPaint(); if (_mwp.key === it.key) _mwpRender(document.getElementById('mwPanel'));
  return apiFetch('/api/my-work/done', { method: 'PUT', body: JSON.stringify({ src: it.src, id: it.id, userId: it.userId, done: done }) }).then(function (r) {
    var next = r && r.data && r.data.next;
    mwUndoToast(done ? '✅ 완료' + (it.src !== 'todo' ? ' — ' + (MW_SRC[it.src] || {}).label + '에도 반영' : '') + (next ? ' · 🔁 다음 회차 만듦' : '') : '↩ 완료 취소', function () { mwSetDone(it, !done); });
    if (next) renderMyWork();
  }).catch(function (e) {
    it.done = prev.done; it.doneAt = prev.doneAt; it.focus = prev.focus;
    _mwPaint(); _mwToast('❌ ' + _mwErr(e), 'error');
  });
}
/** 마감 바꾸기 — 할 일은 패널 저장, 다른 출처는 /due (원래 자리) */
function mwSetDue(it, due, time) {
  if (!it || !_mwpCanDue(it)) return Promise.resolve();
  var prev = { due: it.due || null, dueTime: it.dueTime || null };
  if (it.src === 'todo') {
    var b = { dueDate: due || null };
    if (!due) b.dueTime = null; else if (time !== undefined) b.dueTime = time;
    if (_mwp.key === it.key) { _mwpQueue(b, 0); _mwpApply(it, b); _mwpRender(document.getElementById('mwPanel')); _mwPaint(); }
    else {
      _mwpApply(it, b); _mwPaint();
      apiFetch('/api/my-work/todos/' + encodeURIComponent(it.id), { method: 'PUT', body: JSON.stringify(b) }).catch(function (e) { _mwpApply(it, { dueDate: prev.due, dueTime: prev.dueTime }); _mwPaint(); _mwToast('❌ ' + _mwErr(e), 'error'); });
    }
    mwUndoToast('📆 마감 ' + (due ? _mwDueLabel(due, _mwpToday()) : '없음'), function () { mwSetDue(it, prev.due, prev.dueTime); });
    return Promise.resolve();
  }
  it.due = due || null; _mwPaint(); if (_mwp.key === it.key) _mwpRender(document.getElementById('mwPanel'));
  return apiFetch('/api/my-work/due', { method: 'PUT', body: JSON.stringify({ src: it.src, id: it.id, userId: it.userId, due: due || null }) }).then(function () {
    mwUndoToast('📆 마감 ' + (due ? _mwDueLabel(due, _mwpToday()) : '없음') + ' — ' + (MW_SRC[it.src] || {}).label + '에도 반영', function () { mwSetDue(it, prev.due); });
  }).catch(function (e) {
    it.due = prev.due; _mwPaint(); if (_mwp.key === it.key) _mwpRender(document.getElementById('mwPanel'));
    _mwToast('❌ ' + _mwErr(e), 'error');
  });
}
/** 개인 할 일 지우기 — 휴지통으로 (v13.268, 비우기 전까지 보관). 되돌리기 = 되살리기 */
function mwDeleteTodo(it) {
  if (!it || it.src !== 'todo') return;
  _mwpFlush();
  if (_mwp.key === it.key) mwPanelClose();
  _mw.data.data = _mw.data.data.filter(function (x) { return x !== it; });
  _mw.data.trashN = (_mw.data.trashN || 0) + 1;
  _mwPaint();
  apiFetch('/api/my-work/todos/' + encodeURIComponent(it.id), { method: 'DELETE' }).then(function () {
    mwUndoToast('🗑 "' + it.title + '" 휴지통으로', function () { mwRestoreTodo(it.id); });
  }).catch(function (e) { _mwToast('❌ ' + _mwErr(e), 'error'); renderMyWork(); });
}
function mwRestoreTodo(id) {
  return apiFetch('/api/my-work/todos/' + encodeURIComponent(id) + '/restore', { method: 'POST' }).then(function () {
    _mwToast('↩ 되살렸습니다'); renderMyWork();
  }).catch(function (e) { _mwToast('❌ ' + _mwErr(e), 'error'); });
}

/* ═══ 패널 이벤트 (한 번만 묶음) ═══ */
function _mwpBind(p) {
  p.addEventListener('click', function (e) {
    var it = _mwp.it, t = e.target;
    if (!it) return;
    var a = t.closest('[data-p]');
    if (a) {
      var k = a.getAttribute('data-p');
      if (k === 'close') return mwPanelClose();
      if (k === 'focus') { mwToggleFocus(it); setTimeout(function () { if (_mwp.key === it.key) _mwpRender(p); }, 0); return; }
      if (k === 'source') { mwPanelClose(); mwOpenItem(it); return; }   // 다른 화면으로 가면 패널은 닫음
      if (k === 'delete') return mwDeleteTodo(it);
      if (k === 'unpin') { mwSetCat(it, null); return; }
      if (k === 'done') return;   // change 에서
    }
    var pv = t.closest('[data-pri-v]');
    if (pv) {
      var v = +pv.getAttribute('data-pri-v');
      if (it.src === 'todo') { var old = it.pri; _mwpQueue({ priority: v }, 0); _mwpApply(it, { priority: v }); _mwPaint(); mwUndoToast(MW_PRI[v].icon + ' 중요도 ' + MW_PRI[v].label, function () { _mwpQueue({ priority: old }, 0); _mwpApply(it, { priority: old }); _mwPaint(); if (_mwp.key === it.key) _mwpRender(p); }); }
      else mwSetPriority(it, v);
      p.querySelectorAll('[data-pri-v]').forEach(function (b) { b.classList.toggle('on', b === pv); });
      return;
    }
    var sv = t.closest('[data-st-v]');
    if (sv) {
      var st = sv.getAttribute('data-st-v');
      _mwpQueue(st === 'waiting' ? { status: st } : { status: st, waitingFor: '' }, 0);
      p.querySelectorAll('[data-st-v]').forEach(function (b) { b.classList.toggle('on', b === sv); });
      var w = p.querySelector('#mwpWait');
      if (w) { w.hidden = st !== 'waiting'; if (st === 'waiting') w.focus(); else w.value = ''; }
      return;
    }
    var dv = t.closest('[data-due-v]');
    if (dv) { mwSetDue(it, dv.getAttribute('data-due-v') || null); return; }
    var cx = t.closest('[data-cx]');
    if (cx) { _mwpCl().splice(+cx.getAttribute('data-cx'), 1); _mwpPaintCl(); _mwpClSave(); return; }
    if (t.closest('#mwpSave') && _mwp.state === 'error') { _mwpFlush(); }
  });
  p.addEventListener('change', function (e) {
    var it = _mwp.it, t = e.target;
    if (!it) return;
    if (t.matches('[data-p="done"]')) return mwSetDone(it, t.checked);
    if (t.id === 'mwpDue') return mwSetDue(it, t.value || null);
    if (t.id === 'mwpCat') return mwSetCat(it, t.value);
    if (t.id === 'mwpTime') { if (!it.due) return; _mwpQueue({ dueTime: t.value || null }, 0); return; }
    if (t.id === 'mwpRep') {
      if (t.value && !it.due) { _mwToast('반복은 마감일이 있어야 합니다 — 마감을 먼저 고르세요', 'warn'); t.value = ''; return; }
      _mwpQueue({ repeat: t.value || null }, 0); return;
    }
    if (t.hasAttribute('data-cchk')) { _mwpCl()[+t.getAttribute('data-cchk')].d = t.checked; _mwpPaintCl(); _mwpClSave(); return; }
  });
  // 글자 칸 — 잠깐 쉬면 저장
  p.addEventListener('input', function (e) {
    var t = e.target, f = t.getAttribute('data-f');
    if (t.tagName === 'TEXTAREA') _mwpGrow(t);
    if (f === 'title') { var v = t.value.replace(/\n/g, ' ').trim(); if (v) _mwpQueue({ title: v }, 700); return; }
    if (f === 'waitingFor') return _mwpQueue({ waitingFor: t.value.trim() }, 700);
    if (f === 'memo') return _mwpQueue({ memo: t.value }, 900);
    if (f === 'estimateH') { var h = t.value === '' ? null : +t.value; if (h === null || (h >= 0 && h <= 999)) _mwpQueue({ estimateH: h }, 700); return; }
    if (t.hasAttribute('data-ct')) { var c = _mwpCl()[+t.getAttribute('data-ct')]; if (c && t.value.trim()) { c.t = t.value.trim(); _mwpClSave(); } }
  });
  p.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.isComposing || e.keyCode === 229) return;   // 한글 조합 중은 건드리지 않음
    if (e.key === 'Escape') { e.stopPropagation(); if (t.blur) t.blur(); mwPanelClose(); return; }
    if (t.id === 'mwpTitle' && e.key === 'Enter') { e.preventDefault(); t.blur(); return; }
    if (t.id === 'mwpClAdd' && e.key === 'Enter') {
      e.preventDefault();
      if (!t.value.trim()) return;
      if (_mwpClAddLines(t.value)) { t.value = ''; _mwpPaintCl(); _mwpClSave(); t.focus(); }
      return;
    }
    if (t.hasAttribute('data-ct')) {
      var i = +t.getAttribute('data-ct'), cl = _mwpCl();
      if (e.key === 'Enter') { e.preventDefault(); cl.splice(i + 1, 0, { id: _mwpClNewId(), t: '', d: false }); _mwpPaintCl(i + 1); return; }
      if (e.key === 'Backspace' && !t.value) { e.preventDefault(); cl.splice(i, 1); _mwpPaintCl(i > 0 ? i - 1 : null, true); _mwpClSave(); if (!cl.length) p.querySelector('#mwpClAdd').focus(); return; }
      if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); _mwpPaintCl(i - 1, true); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (i < cl.length - 1) _mwpPaintCl(i + 1, true); else p.querySelector('#mwpClAdd').focus(); return; }
    }
  });
  // 빈 하위 항목은 칸을 떠나면 정리
  p.addEventListener('focusout', function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-ct') && !t.value.trim()) {
      var i = +t.getAttribute('data-ct'), cl = _mwpCl();
      setTimeout(function () { if (cl[i] && !cl[i].t) { cl.splice(i, 1); _mwpPaintCl(); _mwpClSave(); } }, 0);
    }
  });
  // 여러 줄 붙여넣기 → 하위 항목 여러 개
  p.addEventListener('paste', function (e) {
    var t = e.target;
    if (t.id !== 'mwpClAdd' && !(t.hasAttribute && t.hasAttribute('data-ct'))) return;
    var txt = (e.clipboardData || window.clipboardData).getData('text');
    if (!/\n/.test(txt)) return;
    e.preventDefault();
    var at = t.hasAttribute('data-ct') ? +t.getAttribute('data-ct') + 1 : null;
    var n = _mwpClAddLines(txt, at);
    if (n) { _mwpPaintCl(); _mwpClSave(); _mwToast('☑ 하위 항목 ' + n + '개 넣음'); }
  });
  // 하위 항목 끌어서 순서
  var dragI = null;
  p.addEventListener('dragstart', function (e) { var g = e.target.closest && e.target.closest('.mwp-grip'); if (!g) return; dragI = +g.parentNode.getAttribute('data-ci'); e.dataTransfer.setData('text/plain', 'cl'); e.dataTransfer.effectAllowed = 'move'; });
  p.addEventListener('dragover', function (e) { if (dragI != null && e.target.closest && e.target.closest('.mwp-cli')) e.preventDefault(); });
  p.addEventListener('drop', function (e) {
    var row = e.target.closest && e.target.closest('.mwp-cli');
    if (dragI == null || !row) return;
    e.preventDefault();
    var to = +row.getAttribute('data-ci'), cl = _mwpCl();
    var item = cl.splice(dragI, 1)[0];
    cl.splice(to, 0, item);
    dragI = null; _mwpPaintCl(); _mwpClSave();
  });
  p.addEventListener('dragend', function () { dragI = null; });
}

/* ═══ 단축키 — 목록 · 4칸에서 (입력 칸 · 창이 열려 있으면 안 함) ═══ */
var MW_KEYS_HELP = [['↑ ↓ · j k', '고르기'], ['Enter · o', '상세 열기'], ['x · Space', '완료 / 되돌리기'], ['1 2 3 4', '중요도 긴급 · 높음 · 보통 · 낮음'], ['f', '⭐ 오늘 집중'],
  ['d', '마감 오늘 → 내일 → 없음'], ['m', '다른 칸으로 옮기기 (보드)'], ['Delete', '개인 할 일 휴지통으로 (되돌리기 가능)'], ['n', '새 할 일 입력'], ['Esc', '패널 닫기'], ['?', '이 도움말']];
function _mwKeyRows() {
  var sel = _mw.view === 'matrix' ? '#mMyWork [data-qk]' : '#mMyWork .mw-row[data-key]';
  return Array.from(document.querySelectorAll(sel)).filter(function (r) { return r.offsetParent !== null; });
}
document.addEventListener('keydown', function (e) {
  if (typeof curPage === 'undefined' || curPage !== 'mywork' || !_mw.data) return;
  if (_mw.view === 'week' || _mw.view === 'month') return;
  var t = e.target;
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (t && (t.closest && t.closest('input,textarea,select,[contenteditable="true"],#mwPanel,.wa-modal-overlay'))) return;
  if (document.querySelector('.wa-modal-overlay')) return;
  var k = e.key;
  if (k === 'Escape' && mwPanelIsOpen()) { mwPanelClose(); return; }
  if (k === '?') { _mwKeysHelp(); e.preventDefault(); return; }
  if (k === 'n') { var a = document.getElementById('mwAddTitle'); if (a) { e.preventDefault(); a.focus(); } return; }
  var rows = _mwKeyRows();
  if (!rows.length) return;
  var keyOf = function (r) { return r.getAttribute('data-key') || r.getAttribute('data-qk'); };
  var i = rows.map(keyOf).indexOf(_mw.sel);
  var move = function (n) {
    e.preventDefault();
    var r = rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + n))];
    _mw.sel = keyOf(r); _mwpMarkRow();
    r.scrollIntoView({ block: 'nearest' });
    if (mwPanelIsOpen()) mwPanelOpen(_mwFind(_mw.sel));
  };
  if (k === 'ArrowDown' || k === 'j') return move(1);
  if (k === 'ArrowUp' || k === 'k') return move(-1);
  var it = _mwFind(_mw.sel);
  if (!it) return;
  if (k === 'Enter' || k === 'o') { e.preventDefault(); mwPanelOpen(it); return; }
  if (k === 'x' || k === ' ') { e.preventDefault(); if (it.canDone) mwSetDone(it, !it.done); else _mwToast('이 항목은 원래 화면에서 완료합니다', 'warn'); return; }
  if (/^[1-4]$/.test(k)) {
    if (!it.canPri || it.done) return;
    var v = +k;
    if (it.src === 'todo') {
      var old = it.pri;
      _mwpApply(it, { priority: v }); _mwPaint();
      apiFetch('/api/my-work/todos/' + encodeURIComponent(it.id), { method: 'PUT', body: JSON.stringify({ priority: v }) })
        .then(function () { mwUndoToast(MW_PRI[v].icon + ' 중요도 ' + MW_PRI[v].label, function () { _mwpApply(it, { priority: old }); _mwPaint(); apiFetch('/api/my-work/todos/' + encodeURIComponent(it.id), { method: 'PUT', body: JSON.stringify({ priority: old }) }); }); })
        .catch(function (er) { _mwpApply(it, { priority: old }); _mwPaint(); _mwToast('❌ ' + _mwErr(er), 'error'); });
    } else mwSetPriority(it, v);
    if (_mwp.key === it.key) _mwpRender(document.getElementById('mwPanel'));
    return;
  }
  if (k === 'f' && _mw.data.self && !it.done) { mwToggleFocus(it); return; }
  if (k === 'm' && _mw.data.self && !it.done && typeof mwMoveMenu === 'function') {
    var cardEl = rows[i];
    if (cardEl) { e.preventDefault(); mwMoveMenu(cardEl, it); }
    return;
  }
  if (k === 'd') {
    if (!_mwpCanDue(it)) { _mwToast('이 항목의 마감은 원래 화면에서 바꿉니다', 'warn'); return; }
    var td = _mwpToday();
    mwSetDue(it, !it.due || it.due < td ? td : it.due === td ? _mwpAdd(td, 1) : null);
    return;
  }
  if ((k === 'Delete' || k === 'Backspace') && it.src === 'todo' && _mw.data.self) { e.preventDefault(); mwDeleteTodo(it); return; }
});
function _mwKeysHelp() {
  if (document.getElementById('mwKeys')) return;
  var ov = createModal({ id: 'mwKeys', width: '380px', titleText: '⌨️ 내 업무 단축키', closeOnEsc: true, closeOnOverlay: true,
    html: '<table class="mw-keys">' + MW_KEYS_HELP.map(function (x) { return '<tr><td><kbd>' + _mwEsc(x[0]) + '</kbd></td><td>' + _mwEsc(x[1]) + '</td></tr>'; }).join('') + '</table>' }).overlay;
  return ov;
}
