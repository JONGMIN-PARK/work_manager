/* ═══════════════════════════════════════════════════════════════════════
   my-work-board.js — 🎯 내 업무 보드 · 내 칸(카테고리) (v13.268)
   ─────────────────────────────────────────────────────────────────────
   예전 4칸 보기(중요 × 급함)를 '내 칸' 보드로. 이 화면 하나로 보고 바로 처리한다.
     · 칸 = 사람마다 직접 (기본 4칸 = 지금 하기 · 계획하기 · 빨리 끝내기 · 나중에, 자동 규칙 rule 1~4)
       [⚙ 칸 관리] 목록 창 — 추가 · 이름 · 아이콘 · 색 · 끌어서 순서 · 삭제 · 기본으로 (최대 12칸)
     · 끌어 넣으면 그 칸에 📌 고정 (my_work_marks.category_id — 원래 자리는 그대로).
       고정 안 한 항목은 중요도 × 급함으로 기본 칸에. 기본 칸을 지웠으면 '분류 안 됨'
     · 카드에서 바로 — 완료 · ⭐ 집중 · 📅 마감 · 🗑 휴지통 · ⋯ 칸 옮기기 (휴대폰은 끌기 대신 ⋯)
     · 칸 머리 [+] 그 칸에 바로 할 일 · 위 요약(지연 · 오늘 · 이번 주 · 집중) 누르면 그것만
   서버 API: GET·POST /api/my-work/categories · PUT·DELETE /categories/:id · PUT /categories-order · POST /categories-reset · PUT /mark { category }
   전역 의존: _mw · _mwPaint · _mwFind · _mwEsc · _mwToast · _mwErr · _mwLS · _mwDays · _mwDueLabel · _mwGroupOf · MW_SRC · renderMyWork (my-work.js)
              MW_PRI · mwPriBadge · mwSortFn · mwQuadOf · mwFocusBtn (my-work-task.js)
              mwUndoToast · mwDeleteTodo · mwSetDue · _mwpQuickDues · _mwpCanDue (my-work-panel.js) · QuickParse · createModal · wmGuardedModal
   ═══════════════════════════════════════════════════════════════════════ */

var MW_CAT_COLORS = {
  red: '#DC2626', orange: '#F97316', amber: '#F59E0B', green: '#10B981', teal: '#14B8A6',
  blue: '#3B82F6', purple: '#8B5CF6', pink: '#EC4899', slate: '#94A3B8'
};
var MW_RULE_HINT = { 1: '중요 · 급함', 2: '중요 · 안 급함', 3: '덜 중요 · 급함', 4: '덜 중요 · 안 급함' };
var MW_NONE_COL = { id: 'none', name: '분류 안 됨', icon: '📥', color: 'slate', virtual: true };
var MW_BF = [['late', '지연'], ['today', '오늘'], ['week', '이번 주'], ['focus', '⭐ 집중']];

function mwBoardCols() { return (_mw.data && _mw.data.cats) || []; }
function _mwbColor(c) { return MW_CAT_COLORS[c && c.color] || MW_CAT_COLORS.slate; }
/** 이 항목이 놓일 칸 — 고정한 칸 → 규칙 칸 → 분류 안 됨 */
function mwBoardColOf(it) {
  var cols = mwBoardCols();
  var i;
  if (it.cat) for (i = 0; i < cols.length; i++) if (cols[i].id === it.cat) return cols[i];
  var q = mwQuadOf(it, _mw.data.today);
  for (i = 0; i < cols.length; i++) if (cols[i].rule === q) return cols[i];
  return MW_NONE_COL;
}
function _mwbFilter() { return _mwLS('bf') || ''; }
function _mwbShowDone() { return !!_mwLS('bdone'); }
/** 위 요약 거르기에 맞는지 */
function _mwbPass(it, f, today) {
  if (!f) return true;
  if (it.done) return false;
  if (f === 'focus') return !!it.focus;
  if (!it.due) return false;
  var d = _mwDays(today, it.due);
  if (f === 'late') return d < 0;
  if (f === 'today') return d === 0;
  if (f === 'week') { var g = _mwGroupOf(Object.assign({}, it, { focus: null }), today); return g === 'today' || g === 'week'; }
  return true;
}
/** 지금 보드에 보이는 항목 (내보내기 · 맵으로 공용) */
function mwBoardItems(items) {
  var today = _mw.data.today, f = _mwbFilter(), withDone = _mwbShowDone();
  return items.filter(function (it) { return (withDone || !it.done) && _mwbPass(it, f, today); });
}

/* ═══ 그리기 ═══ */
function mwBoardHtml(items, today) {
  var self = _mw.data.self, f = _mwbFilter();
  var open = items.filter(function (it) { return !it.done; });
  var cnt = {};
  MW_BF.forEach(function (b) { cnt[b[0]] = open.filter(function (it) { return _mwbPass(it, b[0], today); }).length; });
  var h = '<div class="mwb-bar"><div class="mwb-sum">' + MW_BF.map(function (b) {
    return '<button class="mwb-pill' + (f === b[0] ? ' on' : '') + (b[0] === 'late' && cnt.late ? ' is-late' : '') + '" data-bf="' + b[0] + '">' + b[1] + ' <b>' + cnt[b[0]] + '</b></button>';
  }).join('') + (f ? '<button class="mwb-pill mwb-clear" data-bf="">✕ 모두 보기</button>' : '') + '</div>' +
    '<label class="mwb-tg"><input type="checkbox" data-bact="done"' + (_mwbShowDone() ? ' checked' : '') + '> 다 한 것도</label>' +
    (self ? '<button class="mw-btn" data-bact="cats" title="칸 추가 · 이름 · 색 · 순서 · 삭제">⚙ 칸 관리</button>' : '') + '</div>';
  var cols = mwBoardCols().slice();
  var by = {};
  mwBoardItems(items).forEach(function (it) { var c = mwBoardColOf(it); (by[c.id] = by[c.id] || []).push(it); });
  if (by.none) cols.push(MW_NONE_COL);
  var sorter = mwSortFn('');
  h += '<div class="mwb" style="--cols:' + Math.min(4, Math.max(1, cols.length)) + ';--cols3:' + Math.min(3, Math.max(1, cols.length)) + '">' + cols.map(function (c) {
    var list = (by[c.id] || []).sort(function (a, b) {
      return (a.done ? 1 : 0) - (b.done ? 1 : 0) || (b.focus ? 1 : 0) - (a.focus ? 1 : 0) || sorter(a, b);
    });
    var n = list.filter(function (x) { return !x.done; }).length;
    return '<section class="mwb-c" data-col="' + _mwEsc(c.id) + '" style="--qc:' + _mwbColor(c) + '">' +
      '<div class="mwb-h"><span class="mwb-name">' + (c.icon ? _mwEsc(c.icon) + ' ' : '') + _mwEsc(c.name) + '</span>' +
        (c.rule ? '<i title="고정하지 않은 항목이 여기 자동으로 들어옵니다">' + MW_RULE_HINT[c.rule] + '</i>' : c.virtual ? '<i>기본 칸을 지워 갈 곳이 없는 항목</i>' : '') +
        '<b>' + n + '</b>' +
        (self && !c.virtual ? '<button class="mwb-add" data-badd="' + _mwEsc(c.id) + '" title="이 칸에 할 일 추가">＋</button>' : '') + '</div>' +
      (self && !c.virtual ? '<form class="mwb-qa" data-bform="' + _mwEsc(c.id) + '" hidden><input class="mw-input" maxlength="500" placeholder="할 일 — Enter (예: 내일 !높음 견적)" autocomplete="off"></form>' : '') +
      '<div class="mwb-l">' + (list.length ? list.map(function (it) { return _mwbCard(it, today); }).join('') : '<div class="mwb-e">' + (self && !c.virtual ? '카드를 끌어 오거나 ＋ 로 추가' : '없음') + '</div>') + '</div></section>';
  }).join('') + '</div>';
  return h;
}

function _mwbCard(it, today) {
  var s = MW_SRC[it.src] || { icon: '•', label: it.src };
  var self = _mw.data.self;
  var late = !it.done && it.due && it.due < today;
  var k = _mwEsc(it.key);
  var meta = '';
  if (it.due) meta += '<span class="mw-due' + (late ? ' mw-late' : '') + '">' + _mwEsc(_mwDueLabel(it.due, today)) + (it.dueTime ? ' ' + _mwEsc(it.dueTime) : '') + '</span>';
  if (it.checkTotal) meta += '<span class="mwb-m">☑ ' + it.checkDone + '/' + it.checkTotal + '</span>';
  else if (it.progress != null && !it.done) meta += '<span class="mwb-m">' + it.progress + '%</span>';
  if (it.todoStatus === 'doing') meta += '<span class="mw-st mw-st-doing">진행 중</span>';
  if (it.todoStatus === 'waiting') meta += '<span class="mw-st mw-st-wait">대기' + (it.waitingFor ? ' · ' + _mwEsc(it.waitingFor) : '') + '</span>';
  if (it.ctx) meta += '<span class="mwb-ctx" title="' + _mwEsc(it.ctx) + '">' + _mwEsc(it.ctx) + '</span>';
  if (it.cat && mwBoardColOf(it).id === it.cat) meta += '<span class="mwb-pin" title="이 칸에 고정 — ⋯ 에서 풀기">📌</span>';
  if (typeof mwProjTag === 'function') meta += mwProjTag(it);   // 📁 내 프로젝트 (v13.273)
  var acts = '';
  if (self && !it.done) {
    acts = '<span class="mwb-acts">' + mwFocusBtn(it) +
      (_mwpCanDue(it) ? '<button data-bdue="' + k + '" title="마감 바꾸기">📅</button>' : '') +
      (it.src === 'todo' ? '<button data-btrash="' + k + '" title="휴지통으로">🗑</button>' : '') +
      '<button data-bmenu="' + k + '" title="다른 칸으로 (m)">⋯</button></span>';
  }
  return '<div class="mwb-i' + (it.done ? ' mw-done' : '') + (it.pending ? ' is-pending' : '') + (it.pri === 1 && !it.done ? ' is-urg' : '') + (it.focus ? ' is-focus' : '') + '" data-qk="' + k + '"' + (self && !it.done ? ' draggable="true"' : '') + '>' +
    '<div class="mwb-top">' +
      (it.canDone ? '<input type="checkbox" class="mw-chk" data-done="' + k + '"' + (it.done ? ' checked' : '') + ' title="' + (it.done ? '완료 되돌리기' : '완료') + '">' : '<span class="mw-chk-sp"></span>') +
      '<span class="mwb-t" data-open="' + k + '"><em title="' + _mwEsc(s.label) + '">' + s.icon + '</em> ' + _mwEsc(it.title) + '</span>' + acts + '</div>' +
    '<div class="mwb-meta">' + mwPriBadge(it) + meta + '</div></div>';
}

/* ═══ 누르기 (my-work.js el.onclick 에서 먼저 부름) ═══ */
function mwBoardClick(e) {
  var t = e.target;
  var bf = t.closest('[data-bf]');
  if (bf) { var v = bf.getAttribute('data-bf'); _mwLS('bf', _mwbFilter() === v ? '' : v); _mwPaint(); return true; }
  if (t.closest('[data-bact="cats"]')) { mwCatsOpen(); return true; }
  var add = t.closest('[data-badd]');
  if (add) {
    var form = document.querySelector('#mMyWork [data-bform="' + add.getAttribute('data-badd') + '"]');
    if (form) { form.hidden = !form.hidden; if (!form.hidden) form.querySelector('input').focus(); }
    return true;
  }
  var mb = t.closest('[data-bmenu]');
  if (mb) { mwMoveMenu(mb, _mwFind(mb.getAttribute('data-bmenu'))); return true; }
  var db = t.closest('[data-bdue]');
  if (db) { _mwbDueMenu(db, _mwFind(db.getAttribute('data-bdue'))); return true; }
  var tb = t.closest('[data-btrash]');
  if (tb) { mwDeleteTodo(_mwFind(tb.getAttribute('data-btrash'))); return true; }
  return false;
}

/** 칸 고정 · 풀기 (catId null = 풀기) */
function mwSetCat(it, catId) {
  if (!it) return;
  catId = catId && catId !== 'none' ? catId : null;
  var prev = it.cat || null;
  if (prev === catId) return;
  it.cat = catId;
  _mwPaint();
  if (typeof mwPanelSync === 'function') mwPanelSync();
  apiFetch('/api/my-work/mark', { method: 'PUT', body: JSON.stringify({ key: it.src + ':' + it.id, category: catId }) }).then(function () {
    var c = mwBoardColOf(it);
    mwUndoToast(catId ? '📌 ' + (c.icon ? c.icon + ' ' : '') + c.name + ' 칸에 고정' : '자동 분류로 — ' + (c.icon ? c.icon + ' ' : '') + c.name, function () { mwSetCat(it, prev); });
  }).catch(function (er) { it.cat = prev; _mwPaint(); _mwToast('❌ ' + _mwErr(er), 'error'); });
}

/* ── 떠 있는 작은 메뉴 — 내 업무 공용 (칸 옮기기 · 마감 · 중요도 · 내보내기 · 사전검토 끝내기, v13.270 하나로) ──
   mwPopMenu(anchor, html, onPick(v), { id, key, onCancel, align: 'left'|'right' })
   html 안 버튼은 data-v. 같은 key 로 다시 부르면 닫힘(토글). 밖을 누르거나 Esc = onCancel. ↑↓ 로 고르기 */
function mwPopMenu(anchor, html, onPick, opt) {
  opt = opt || {};
  var id = opt.id || 'mwbPop';
  var key = opt.key != null ? opt.key : anchor;
  document.querySelectorAll('.mwb-pop').forEach(function (o) { if (o._cancel) o._cancel(); o.remove(); if (o.id === id && o._key === key) id = null; });
  if (!id) return;
  var m = document.createElement('div');
  m.id = id; m.className = 'mw-pmenu mwb-pop'; m._key = key; m._cancel = opt.onCancel || null;
  m.innerHTML = html;
  document.body.appendChild(m);
  var r = anchor.getBoundingClientRect();
  m.style.top = Math.max(8, Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 4)) + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, opt.align === 'left' ? r.left : r.right - m.offsetWidth)) + 'px';
  m.onclick = function (ev) {
    var b = ev.target.closest('[data-v]');
    if (!b) return;
    m._cancel = null;
    m.remove();
    onPick(b.getAttribute('data-v'));
  };
  function cancel() { var f = m._cancel; m._cancel = null; m.remove(); if (f) f(); }
  setTimeout(function () {
    document.addEventListener('mousedown', function off(ev) { if (!m.isConnected) { document.removeEventListener('mousedown', off); return; } if (!m.contains(ev.target)) { cancel(); document.removeEventListener('mousedown', off); } });
  }, 0);
  var first = m.querySelector('button');
  if (first) first.focus();
  m.addEventListener('keydown', function (ev) {
    var bs = Array.from(m.querySelectorAll('button')), i = bs.indexOf(document.activeElement);
    if (ev.key === 'Escape') { ev.stopPropagation(); cancel(); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); bs[Math.min(bs.length - 1, i + 1)].focus(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); bs[Math.max(0, i - 1)].focus(); }
  });
}
function mwMoveMenu(anchor, it) {
  if (!it) return;
  var cur = mwBoardColOf(it);
  var h = '<div class="mw-pmenu-n">다른 칸으로</div>' + mwBoardCols().map(function (c) {
    return '<button data-v="' + _mwEsc(c.id) + '"' + (c.id === cur.id ? ' class="on"' : '') + '><i class="mwb-dot" style="background:' + _mwbColor(c) + '"></i>' + (c.icon ? _mwEsc(c.icon) + ' ' : '') + _mwEsc(c.name) + '</button>';
  }).join('') + (it.cat ? '<button data-v="__unpin">↺ 고정 풀기 (자동 분류)</button>' : '');
  // 📁 내 프로젝트로 (v13.273)
  var pjs = typeof mwProjChoices === 'function' ? mwProjChoices() : [], pjCur = typeof mwProjOf === 'function' ? mwProjOf(it) : null;
  if (pjs.length || pjCur) h += '<div class="mw-pmenu-n">프로젝트로</div>' + pjs.map(function (c) {
    return '<button data-v="__pj:' + _mwEsc(c[0]) + '"' + (pjCur && pjCur.id === c[0] ? ' class="on"' : '') + '>' + _mwEsc(c[1]) + '</button>';
  }).join('') + (pjCur ? '<button data-v="__pj:">↺ 프로젝트에서 빼기</button>' : '');
  h += it.src === 'todo' ? '<button data-v="__trash" class="mwb-pop-del">🗑 휴지통으로</button>' : '';
  mwPopMenu(anchor, h, function (v) {
    if (v.slice(0, 5) === '__pj:') return mwProjSetItem(it, v.slice(5) || null);
    if (v === '__unpin') return mwSetCat(it, null);
    if (v === '__trash') return mwDeleteTodo(it);
    mwSetCat(it, v);
  });
}
function _mwbDueMenu(anchor, it) {
  if (!it) return;
  var h = '<div class="mw-pmenu-n">마감</div>' + _mwpQuickDues().map(function (q) {
    return '<button data-v="' + q[1] + '"' + (it.due === q[1] ? ' class="on"' : '') + '>' + q[0] + ' <i>' + (+q[1].slice(5, 7)) + '/' + (+q[1].slice(8, 10)) + '</i></button>';
  }).join('') + '<button data-v="">없음</button><button data-v="__more">날짜 고르기…</button>';
  mwPopMenu(anchor, h, function (v) {
    if (v === '__more') { mwPanelOpen(it, { focus: '#mwpDue' }); return; }
    mwSetDue(it, v || null);
  });
}

/* ═══ 끌기 · 칸 안 바로 추가 (el 은 그대로 남으므로 한 번만 묶음) ═══ */
function mwBindBoard(el) {
  if (el._mwb) return;
  el._mwb = true;
  var key = null;
  el.addEventListener('dragstart', function (e) {
    var c = e.target.closest && e.target.closest('.mwb-i[draggable]');
    if (!c) return;
    key = c.getAttribute('data-qk');
    e.dataTransfer.setData('text/plain', key);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('is-drag');
  });
  el.addEventListener('dragover', function (e) {
    if (!key) return;
    var col = e.target.closest && e.target.closest('.mwb-c[data-col]');
    if (!col || col.getAttribute('data-col') === 'none') return;
    e.preventDefault();
    el.querySelectorAll('.mwb-c.is-over').forEach(function (x) { if (x !== col) x.classList.remove('is-over'); });
    col.classList.add('is-over');
  });
  el.addEventListener('drop', function (e) {
    var col = e.target.closest && e.target.closest('.mwb-c[data-col]');
    if (!key || !col) return;
    e.preventDefault();
    var it = _mwFind(key); key = null;
    if (it && mwBoardColOf(it).id !== col.getAttribute('data-col')) mwSetCat(it, col.getAttribute('data-col'));
  });
  el.addEventListener('dragend', function () {
    key = null;
    el.querySelectorAll('.is-over,.is-drag').forEach(function (x) { x.classList.remove('is-over'); x.classList.remove('is-drag'); });
  });
  el.addEventListener('change', function (e) {
    if (e.target.matches && e.target.matches('[data-bact="done"]')) { _mwLS('bdone', e.target.checked); _mwPaint(); }
  });
  el.addEventListener('keydown', function (e) {
    var f = e.target.closest && e.target.closest('[data-bform]');
    if (f && e.key === 'Escape') { f.hidden = true; e.target.value = ''; }
  });
  el.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('[data-bform]');
    if (!f) return;
    e.preventDefault();
    var inp = f.querySelector('input'), raw = (inp.value || '').trim();
    if (!raw) return;
    var catId = f.getAttribute('data-bform');
    var q = typeof QuickParse !== 'undefined' ? QuickParse.parse(raw, _mw.data.today) : { title: raw };
    if (!q.title) { _mwToast('할 일 내용을 적어 주세요', 'warn'); return; }
    // 바로 그림 (v13.270) — 다시 그린 뒤 같은 칸 입력 칸을 열어 둠 (연달아 넣기)
    _mwLS('bqa', catId);
    inp.value = '';   // 먼저 비움 — 다시 그릴 때 쓰던 글을 지켜 주므로
    mwAddTodo({ title: q.title, dueDate: q.due || null, dueTime: q.due && q.time ? q.time : null, priority: q.priority || 3 }, catId)
      .catch(function (er) { _mwToast('❌ 추가하지 못했습니다 — ' + _mwErr(er), 'error'); });
  });
}
/** 다시 그린 뒤 — 방금 쓰던 칸의 바로 추가 칸을 다시 열어 둠 (연달아 넣기) */
function mwBoardAfterPaint(el) {
  var c = _mwLS('bqa');
  if (!c) return;
  _mwLS('bqa', null);
  var f = el.querySelector('[data-bform="' + c + '"]');
  if (f) { f.hidden = false; f.querySelector('input').focus(); }
}

/* ═══ ⚙ 칸 관리 — 목록 창 ═══ */
function mwCatsOpen() {
  return wmGuardedModal('mwCats', function () {
    return apiFetch('/api/my-work/categories').then(function (r) { _mw.data.cats = (r && r.data) || []; _mwbCatsBuild(); });
  }, 'mwCatsModal', { onOpen: function () { var x = document.getElementById('mwcNewName'); if (x) x.focus(); } });
}
function _mwbCounts() {
  var n = {};
  ((_mw.data && _mw.data.data) || []).forEach(function (it) { if (!it.done) { var c = mwBoardColOf(it); n[c.id] = (n[c.id] || 0) + 1; } });
  return n;
}
function _mwbSwatches(name, cur) {
  return '<span class="mwk-sw">' + Object.keys(MW_CAT_COLORS).map(function (k) {
    return '<button type="button" data-' + name + '="' + k + '" class="' + (k === cur ? 'on' : '') + '" style="background:' + MW_CAT_COLORS[k] + '" title="' + k + '"></button>';
  }).join('') + '</span>';
}
function _mwbCatsBuild() {
  var ov = createModal({ id: 'mwCatsModal', width: '620px', titleText: '⚙ 내 칸 관리', closeOnEsc: true, closeOnOverlay: true,
    onClose: function () { _mwPaint(); }, html: '<div id="mwcBody"></div>' }).overlay;
  var body = ov.querySelector('#mwcBody');
  var newColor = 'teal';
  function paint() {
    var cats = mwBoardCols(), n = _mwbCounts();
    body.innerHTML = '<div class="mw-sub mwk-hint">칸에 끌어 넣은 항목은 그 칸에 고정됩니다. <b>자동</b> 표시 칸은 고정하지 않은 항목이 중요도 · 마감에 따라 들어오는 칸입니다. 칸을 지워도 항목은 지워지지 않고 자동 분류로 돌아갑니다.</div>' +
      '<div class="mwk-list" id="mwcList">' + cats.map(function (c, i) {
        return '<div class="mwk-row" data-cid="' + _mwEsc(c.id) + '" draggable="true">' +
          '<span class="mwk-grip" title="끌어서 순서">⋮⋮</span>' +
          '<input class="mw-input mwk-ic" data-cf="icon" maxlength="4" value="' + _mwEsc(c.icon || '') + '" title="아이콘 (이모지)">' +
          '<input class="mw-input mwk-nm" data-cf="name" maxlength="40" value="' + _mwEsc(c.name) + '">' +
          _mwbSwatches('ccol', c.color) +
          '<span class="mwk-n" title="들어 있는 남은 일">' + (n[c.id] || 0) + '개</span>' +
          (c.rule ? '<span class="mwk-rule" title="' + MW_RULE_HINT[c.rule] + '">자동</span>' : '<span class="mwk-rule is-off"></span>') +
          '<button type="button" class="mw-x" data-cdel="' + _mwEsc(c.id) + '" title="칸 지우기">×</button></div>';
      }).join('') + '</div>' +
      (cats.length < 12 ? '<form class="mwk-new" id="mwcNew"><input class="mw-input mwk-ic" id="mwcNewIcon" maxlength="4" placeholder="📁"><input class="mw-input mwk-nm" id="mwcNewName" maxlength="40" placeholder="새 칸 이름 — 예: 영업 · 개발 · 대기 · 개인">' +
        _mwbSwatches('ncol', newColor) + '<button class="mw-btn mw-btn-p" type="submit">추가</button></form>' : '<div class="mw-sub">칸은 12개까지입니다.</div>') +
      '<div class="mwk-foot"><button type="button" class="mw-btn" data-creset>기본 4칸으로 되돌리기</button><span class="mw-sub">' + cats.length + ' / 12칸</span></div>';
  }
  function setCats(list) { _mw.data.cats = list; paint(); _mwPaint(); }
  function upd(id, patch) {
    var c = mwBoardCols().filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var prev = Object.assign({}, c);
    Object.assign(c, patch); _mwPaint();
    apiFetch('/api/my-work/categories/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(patch) })
      .catch(function (er) { Object.assign(c, prev); paint(); _mwPaint(); _mwToast('❌ ' + _mwErr(er), 'error'); });
  }
  paint();
  body.addEventListener('change', function (e) {
    var t = e.target, row = t.closest('[data-cid]');
    if (!row || !t.hasAttribute('data-cf')) return;
    var f = t.getAttribute('data-cf'), v = t.value.trim();
    if (f === 'name' && !v) { _mwToast('칸 이름을 적어 주세요', 'warn'); paint(); return; }
    var p = {}; p[f] = v; upd(row.getAttribute('data-cid'), p);
  });
  body.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.hasAttribute('data-cf')) { e.preventDefault(); e.target.blur(); } });
  body.addEventListener('click', function (e) {
    var t = e.target;
    var sw = t.closest('[data-ccol]');
    if (sw) { upd(sw.closest('[data-cid]').getAttribute('data-cid'), { color: sw.getAttribute('data-ccol') }); paint(); return; }
    var nw = t.closest('[data-ncol]');
    if (nw) { newColor = nw.getAttribute('data-ncol'); body.querySelectorAll('[data-ncol]').forEach(function (b) { b.classList.toggle('on', b === nw); }); return; }
    var del = t.closest('[data-cdel]');
    if (del) {
      var id = del.getAttribute('data-cdel'), c = mwBoardCols().filter(function (x) { return x.id === id; })[0], n = _mwbCounts()[id] || 0;
      if (!confirm('"' + c.name + '" 칸을 지울까요?' + (n ? '\n들어 있는 ' + n + '개는 지워지지 않고 자동 분류로 돌아갑니다.' : ''))) return;
      apiFetch('/api/my-work/categories/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () {
        ((_mw.data && _mw.data.data) || []).forEach(function (it) { if (it.cat === id) it.cat = null; });
        setCats(mwBoardCols().filter(function (x) { return x.id !== id; }));
        _mwToast('🗑 "' + c.name + '" 칸을 지웠습니다');
      }).catch(function (er) { _mwToast('❌ ' + _mwErr(er), 'error'); });
      return;
    }
    if (t.closest('[data-creset]')) {
      if (!confirm('기본 4칸(지금 하기 · 계획하기 · 빨리 끝내기 · 나중에)으로 되돌릴까요?\n만든 칸과 칸 고정이 모두 풀립니다. 항목은 그대로입니다.')) return;
      apiFetch('/api/my-work/categories-reset', { method: 'POST' }).then(function (r) {
        ((_mw.data && _mw.data.data) || []).forEach(function (it) { it.cat = null; });
        setCats((r && r.data) || []);
        _mwToast('↺ 기본 4칸으로 되돌렸습니다');
      }).catch(function (er) { _mwToast('❌ ' + _mwErr(er), 'error'); });
    }
  });
  body.addEventListener('submit', function (e) {
    e.preventDefault();
    var nm = body.querySelector('#mwcNewName'), ic = body.querySelector('#mwcNewIcon');
    if (!nm.value.trim()) { nm.focus(); return; }
    apiFetch('/api/my-work/categories', { method: 'POST', body: JSON.stringify({ name: nm.value.trim(), icon: ic.value.trim(), color: newColor }) }).then(function (r) {
      setCats(mwBoardCols().concat([r.data]));
      var x = body.querySelector('#mwcNewName'); if (x) x.focus();
    }).catch(function (er) { _mwToast('❌ ' + _mwErr(er), 'error'); });
  });
  // 끌어서 순서
  var drag = null;
  body.addEventListener('dragstart', function (e) { drag = e.target.closest && e.target.closest('.mwk-row'); if (drag) { e.dataTransfer.setData('text/plain', 'cat'); drag.classList.add('is-drag'); } });
  body.addEventListener('dragover', function (e) {
    var row = drag && e.target.closest && e.target.closest('.mwk-row');
    if (!row || row === drag) return;
    e.preventDefault();
    var r = row.getBoundingClientRect();
    row.parentNode.insertBefore(drag, e.clientY < r.top + r.height / 2 ? row : row.nextSibling);
  });
  body.addEventListener('drop', function (e) { if (drag) e.preventDefault(); });
  body.addEventListener('dragend', function () {
    if (!drag) return;
    drag.classList.remove('is-drag'); drag = null;
    var ids = Array.from(body.querySelectorAll('.mwk-row')).map(function (r) { return r.getAttribute('data-cid'); });
    var byId = {};
    mwBoardCols().forEach(function (c) { byId[c.id] = c; });
    _mw.data.cats = ids.map(function (id, i) { byId[id].order = i; return byId[id]; });
    _mwPaint();
    apiFetch('/api/my-work/categories-order', { method: 'PUT', body: JSON.stringify({ ids: ids }) }).catch(function (er) { _mwToast('❌ 순서를 저장하지 못했습니다 — ' + _mwErr(er), 'error'); });
  });
  return ov;
}
