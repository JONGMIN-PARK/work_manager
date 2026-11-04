/* ═══════════════════════════════════════════════════════════════════════
   my-work-notes.js — 📝 내 업무 노트 서랍 · 회의 미리보기 (v13.272)
   ─────────────────────────────────────────────────────────────────────
   평소엔 안 보이고 쓸 때만 — 머리 [📝 노트] → 오른쪽 서랍 (상세 패널 자리를 같이 씀, 둘 중 하나만)
     · 날짜마다 한 장 · ‹ › 로 날짜 이동 · 🔗 연동이면 타임라인 · 달력에서 고른 날을 따라감
     · 그날 회의가 있으면 '🤝 그날 회의' 한 줄씩 — 누르면 그 회의 메모 (내 것, 회의록은 [회의록 열기] 로)
     · 줄 단위로 쓰기 — Enter 다음 줄 · 빈 줄 Backspace · ↑↓ · 여러 줄 붙여넣기 · 자동 저장
     · 할 일로 올리기 — 줄 끝 ➜ 또는 '- [ ] ' / '[] ' 로 쓰면 저절로. 올린 줄은 ✓ (누르면 그 할 일). "내일 !높음 견적" 처럼 마감 · 중요도도 읽음
     · 🔍 검색 · 지난 노트. 노트 있는 날은 타임라인 날짜 머리 · 달력에 작은 점
   회의 미리보기 — 타임라인의 회의 일정에 마우스를 올리면 안건 · 회의록 앞부분 · 내 액션 · [📝 메모] [회의록 열기]
   저장: 줄 = 글 한 줄, 올린 줄은 '- [x] 제목 ⟦todo-id⟧' (검색 · 다른 곳에선 표시 없이)
   📖 펼쳐 보기 — mwNotesSpread → note-book.js wmBookOpen
   서버 API: GET·PUT /api/my-work/notes · GET /notes/find · GET /meeting-brief · GET /events
   전역 의존: _mw · _mwEsc · _mwToast · _mwErr · _mwFind · _mwPaint · mwAddTodo (my-work.js) · mwPanelOpen · mwPanelClose · mwPanelIsOpen (my-work-panel.js)
              _mtlMain · _mtlNum · _mtlYmd · _mtlFmt · mwToday (my-work-timeline.js) · QuickParse · expandRepeatingEvents · toCamelArray · showProjectDetail · pdSwitchTab · pmtOpenCard
   ═══════════════════════════════════════════════════════════════════════ */

var _mwn = { open: false, date: null, ref: '', rows: [], notes: {}, meetings: [], timer: null, inflight: null, state: 'idle', find: false, brief: {}, seq: 0,
  loaded: null,        // 다 불러온 날짜 — 이 날짜가 아니면 편집기 잠금 · 저장 안 함 (v13.331: 불러오기 전에 친 글이 그날 노트를 덮던 것)
  loadErr: false,      // 불러오기 실패 — [다시 불러오기]
  retryN: 0, retryT: null,
  srv: {} };           // 'date|ref' → 서버에 마지막으로 있던 글 (임시 보관 글을 되살릴지 가르는 기준)
var MWN_MAX = 20000, MWN_LINE = 500;   // 서버 한도와 같게 (server/routes/my-work.js PUT /notes)
var MWN_TODO_RE = /^- \[x\] (.*?)(?: ⟦([^⟧]*)⟧)?$/;
var MWN_PEND_RE = /^(?:- )?\[ ?\]\s+/;

function mwNotesIsOpen() { return _mwn.open; }
/** 글자 크기 — '' 보통 · 's' 작게 · 'l' 크게 (이 브라우저에만 기억 · v13.327) */
function _mwnFs() { try { var v = localStorage.getItem('wm.mwn.fs'); return v === 's' || v === 'l' ? v : ''; } catch (_) { return ''; } }
function _mwnApplyFs(el) { var f = _mwnFs(); el.classList.toggle('fs-s', f === 's'); el.classList.toggle('fs-l', f === 'l'); }
function _mwnLabel(d) {
  var t = mwToday(), n = _mtlNum(d) - _mtlNum(t);
  return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + ' (' + '일월화수목금토'[new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay()] + ')' +
    (n === 0 ? ' · 오늘' : n === -1 ? ' · 어제' : n === 1 ? ' · 내일' : d.slice(0, 4) !== t.slice(0, 4) ? ' · ' + d.slice(0, 4) : '');
}
function _mwnParse(body) {
  var rows = String(body || '').split('\n').map(function (l) {
    var m = MWN_TODO_RE.exec(l);
    return m ? { t: m[1], todo: m[2] || true } : { t: l };
  });
  return rows.length ? rows : [{ t: '' }];
}
function _mwnBody(src) {
  var rows = (src || _mwn.rows).slice();
  while (rows.length && !rows[rows.length - 1].t && !rows[rows.length - 1].todo) rows.pop();
  return rows.map(function (r) { return r.todo ? '- [x] ' + r.t + (typeof r.todo === 'string' ? ' ⟦' + r.todo + '⟧' : '') : r.t; }).join('\n');
}

/* ═══ 열기 · 닫기 ═══ */
function mwNotesToggle() { if (_mwn.open) mwNotesClose(); else mwNotesOpen(); }
function mwNotesOpen(date, ref) {
  if (!_mw.data || !_mw.data.self) return;
  if (typeof mwPanelIsOpen === 'function' && mwPanelIsOpen()) mwPanelClose();
  if (typeof mwProjIsOpen === 'function' && mwProjIsOpen()) mwProjClose();   // 📁 프로젝트 패널과 같은 자리 (v13.273)
  var el = document.getElementById('mwNotes');
  if (!el) {
    el = document.createElement('aside');
    el.id = 'mwNotes'; el.className = 'mwp mwn';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '노트');
    document.body.appendChild(el);
    _mwnBind(el);
  }
  _mwnApplyFs(el);
  _mwn.open = true;
  // 다시 열 때는 서버 것을 새로 — 그새 📓 노트북 · 다른 기기에서 고쳤을 수 있음 (남은 저장이 있으면 그대로)
  if (!_mwn.timer && !_mwn.inflight && !_mwn.retryT) _mwn.loaded = null;
  document.body.classList.add('mwp-open');
  requestAnimationFrame(function () { el.classList.add('on'); });
  _mwnBtn();
  mwNotesGo(date || (_mtlMain && _mtlMain.st.link && _mtlMain.pick) || mwToday(), ref || '');
}
function mwNotesClose(quiet) {
  if (!_mwn.open) return;
  _mwnFlush();
  _mwn.open = false;
  var el = document.getElementById('mwNotes');
  if (el) el.classList.remove('on');
  if (!quiet || !(typeof mwPanelIsOpen === 'function' && mwPanelIsOpen())) document.body.classList.remove('mwp-open');
  mwMeetingCardHide(true);
  _mwnBtn();
}
/** 날짜 · 회의 바꾸기 — 남은 저장을 마치고 불러옴 */
function mwNotesGo(date, ref) {
  if (!_mwn.open) return;
  _mwnFlush();
  ref = ref || '';
  var same = _mwn.date === date;
  _mwn.date = date; _mwn.ref = ref; _mwn.find = false;
  var seq = ++_mwn.seq;
  if (same && _mwn.loaded === date) {
    _mwn.rows = _mwnParse(_mwn.notes[ref] != null ? _mwn.notes[ref] : '');
    _mwnRender(); _mwnFocusEnd(); if (ref) _mwnLoadBrief(ref.slice(3)); return;
  }
  // 다 불러오기 전엔 편집기를 잠가 둠 — 빈 칸에 친 글이 그날 노트를 덮지 않게
  _mwn.loaded = null; _mwn.loadErr = false;
  _mwn.rows = [{ t: '' }];
  _mwn.meetings = []; _mwn.notes = {};
  _mwnRender();
  Promise.all([
    apiFetch('/api/my-work/notes?date=' + date),
    apiFetch('/api/my-work/events?from=' + date + '&to=' + date).catch(function () { return null; })
  ]).then(function (res) {
    if (seq !== _mwn.seq) return;
    _mwn.loaded = date;
    Object.keys(_mwn.srv).forEach(function (k) { if (k.indexOf(date + '|') === 0) delete _mwn.srv[k]; });
    (res[0].data.notes || []).forEach(function (n) { _mwn.notes[n.ref] = n.body; _mwn.srv[date + '|' + n.ref] = n.body; });
    var rows = res[1] ? (typeof toCamelArray === 'function' ? toCamelArray(res[1].data || []) : res[1].data || []) : [];
    var occ = typeof expandRepeatingEvents === 'function' ? expandRepeatingEvents(rows.slice(), date, date) : rows;
    var orig = {};
    rows.forEach(function (e) { orig[e.id] = e; });
    _mwn.meetings = occ.filter(function (o) { var e = orig[o._origId || o.id] || o; return e.type === 'meeting' && o.startDate <= date && (o.endDate || o.startDate) >= date; })
      .map(function (o) { var e = orig[o._origId || o.id] || o; return { id: e.id, title: e.title || '회의', time: e.startTime || '' }; })
      .sort(function (a, b) { return (a.time || '99').localeCompare(b.time || '99'); });
    // 이 기기에 남은 '저장 못 한 글' 이 있으면 되살림 (창을 닫았거나 저장이 실패했던 것)
    _mwnDraftRestore(date);
    _mwn.rows = _mwnParse(_mwn.notes[_mwn.ref] || '');
    _mwnPaintTop();
    _mwnPaintRows();
    _mwnFocusEnd();
    if (_mwn.ref) _mwnLoadBrief(_mwn.ref.slice(3));
  }).catch(function (e) {
    if (seq !== _mwn.seq) return;
    _mwn.loadErr = true;   // 잠근 채 — 빈 글이 저장되면 서버가 그날 노트를 지움
    _mwnPaintRows();
    _mwToast('❌ 노트를 불러오지 못했습니다 — ' + _mwErr(e), 'error');
  });
}
function _mwnReady() { return _mwn.loaded === _mwn.date && !_mwn.loadErr; }

/* ═══ 이 기기에 임시 보관 — 저장이 끝날 때까지 (v13.331) ═══
   key = 사람 · 날짜 · 장. base = 고치기 시작할 때의 서버 글. 다시 열 때 서버 글이 base 와 같으면 그대로 되살리고,
   다르면(그새 다른 곳에서 고침) 서버 글 아래에 '저장 못 한 글' 로 붙여 둘 다 남김 */
function _mwnDraftKey(date, ref) { return 'wm.mwn.draft:' + (_mwMe() || '') + ':' + date + '|' + (ref || ''); }
function _mwnDraftPut(date, ref, body, base) {
  try { localStorage.setItem(_mwnDraftKey(date, ref), JSON.stringify({ body: body, base: base, at: Date.now() })); } catch (_) {}
}
function _mwnDraftDrop(date, ref, body) {
  try {
    var k = _mwnDraftKey(date, ref), d = JSON.parse(localStorage.getItem(k) || 'null');
    if (d && (body == null || d.body === body)) localStorage.removeItem(k);   // 그 사이 더 쓴 게 있으면 남김
  } catch (_) {}
}
function _mwnDraftRestore(date) {
  var pre = 'wm.mwn.draft:' + (_mwMe() || '') + ':' + date + '|', back = 0;
  try {
    Object.keys(localStorage).forEach(function (k) {
      if (k.indexOf(pre) !== 0) return;
      var ref = k.slice(pre.length), d = JSON.parse(localStorage.getItem(k) || 'null'), srv = _mwn.notes[ref] || '';
      if (!d || d.body === srv) { localStorage.removeItem(k); return; }
      if (d.base === srv) _mwn.notes[ref] = d.body;
      else _mwn.notes[ref] = (srv ? srv + '\n\n' : '') + '— 저장 못 한 글 (' + new Date(d.at).toTimeString().slice(0, 5) + ') —\n' + d.body;
      back++;
      _mwnSaveRaw(date, ref, _mwn.notes[ref], srv);
    });
  } catch (_) {}
  if (back) _mwToast('↩️ 저장 못 했던 노트 글을 되살렸습니다', 'info');
}

/* ═══ 그리기 ═══ */
function _mwnRender() {
  var el = document.getElementById('mwNotes');
  if (!el) return;
  var d = _mwn.date;
  var h = '<div class="mwp-h mwn-h"><b class="mwn-ttl">📝 노트</b><span class="mwp-save" id="mwnSave" aria-live="polite"></span>' +
    (typeof renderNotebook === 'function' ? '<button class="mwn-ib" onclick="mwNotesToBook()" title="📓 노트북에서 크게 보기 (일일 노트)">📓</button>' : '') + '<button class="mwn-ib" onclick="mwNotesSpread()" title="📖 펼쳐 보기 — 노트 여러 장(2~4)을 골라 책처럼 나란히">📖</button><button class="mwn-ib mwn-fs" data-n="fs" title="글자 크기 — 작게 · 보통 · 크게 (누를 때마다)">가' + ({ s: '⁻', l: '⁺' }[_mwnFs()] || '') + '</button><button class="mwn-ib" data-n="find" title="노트 검색">🔍</button><button class="mwp-x" data-n="close" title="닫기 (Esc)">✕</button></div>';
  h += '<div class="mwn-nav"><button data-n="prev" title="전날">‹</button><label class="mwn-date" title="날짜 고르기"><span>' + _mwEsc(_mwnLabel(d)) + '</span><input type="date" data-n="date" value="' + d + '"></label>' +
    '<button data-n="next" title="다음날">›</button>' + (d !== mwToday() ? '<button data-n="today" class="mwn-tod">오늘</button>' : '') + '</div>';
  if (_mwn.find) {
    h += '<div class="mwn-find"><input class="mw-input" id="mwnQ" placeholder="노트에서 찾기 — Enter" autocomplete="off"><div id="mwnFound" class="mwn-list"></div></div>';
  }
  h += '<div class="mwp-b mwn-b" id="mwnBody">' + _mwnBodyHtml() + '</div>';
  el.innerHTML = h;
  _mwnPaintRows();
  _mwnShowState();
  if (_mwn.find) { var q = el.querySelector('#mwnQ'); q.focus(); _mwnFind(''); }
}
/** 위 칸만 다시 (그날 회의 · 회의 메모 머리) — 줄 편집기는 건드리지 않음 */
function _mwnPaintTop() {
  var t = document.getElementById('mwnTop');
  if (t) t.innerHTML = _mwnTopHtml();
}
function _mwnBodyHtml() {
  var h = '<div id="mwnTop">' + _mwnTopHtml() + '</div>';
  h += '<div class="mwn-ed" id="mwnEd"></div>' +
    '<div class="mwn-tip">Enter 다음 줄 · 줄 끝 <b>➜</b> 할 일로 · <code>- [ ]</code> 로 쓰면 저절로 할 일</div>';
  if (!_mwn.ref) h += '<details class="mwn-old" id="mwnOld"><summary>지난 노트</summary><div class="mwn-list" id="mwnOldL"></div></details>';
  return h;
}
function _mwnTopHtml() {
  var h = '', mt = _mwn.ref ? _mwn.meetings.filter(function (m) { return 'ev:' + m.id === _mwn.ref; })[0] : null;
  if (_mwn.ref) {
    h += '<div class="mwn-ref"><button data-n="back" title="그날 노트로">‹</button><span>🤝 ' + (mt && mt.time ? '<b>' + _mwEsc(mt.time) + '</b> ' : '') + _mwEsc(mt ? mt.title : '회의') + ' 메모</span></div>' +
      '<div class="mwn-brief" id="mwnBrief"></div>';
  } else if (_mwn.meetings.length) {
    h += '<div class="mwn-mt"><div class="mwp-l">🤝 그날 회의</div>' + _mwn.meetings.map(function (m) {
      var n = (_mwn.notes['ev:' + m.id] || '').split('\n').filter(function (l) { return l.trim(); }).length;
      return '<button class="mwn-mtr" data-mt="' + _mwEsc(m.id) + '">' + (m.time ? '<b>' + _mwEsc(m.time) + '</b>' : '') + '<span>' + _mwEsc(m.title) + '</span><i>' + (n ? '메모 ' + n + '줄' : '메모 쓰기') + ' ›</i></button>';
    }).join('') + '</div>';
  }
  return h;
}
/** 줄 모양 — 'h' 제목(# · ## · ###) · 'pend' 아직 안 올린 '- [ ]' · '' 보통 */
function _mwnKind(r) {
  if (r.todo) return '';
  if (/^#{1,3}\s/.test(r.t)) return 'h';
  if (MWN_PEND_RE.test(r.t)) return 'pend';
  return '';
}
function _mwnRowHtml(r, i) {
  var k = _mwnKind(r);
  return '<div class="mwn-r' + (r.todo ? ' is-todo' : '') + (k ? ' is-' + k : '') + (r.t.trim() ? '' : ' is-empty') + '" data-i="' + i + '" data-k="' + k + '">' +
    (r.todo ? '<button class="mwn-ok" data-open="' + i + '" title="할 일로 올림 — 누르면 열기" aria-label="할 일 열기">✓</button>'
      : k === 'pend' ? '<span class="mwn-box" aria-hidden="true"></span>' : '<span class="mwn-dot" aria-hidden="true">' + (k === 'h' ? '' : '•') + '</span>') +
    '<input class="mwn-t" data-i="' + i + '" value="' + _mwEsc(r.t) + '" maxlength="' + MWN_LINE + '"' + (i === 0 && !r.t && _mwn.rows.length === 1 ? ' placeholder="생각나는 대로 — 해야 할 건 ➜ 로 할 일에 · ## 로 제목"' : '') + ' aria-label="' + (i + 1) + '번째 줄">' +
    (r.todo || k === 'h' ? '' : '<button class="mwn-up" data-up="' + i + '" title="이 줄을 할 일로 (Ctrl+Enter)" aria-label="할 일로">➜</button>') + '</div>';
}
/** 쓰는 중 줄 모양이 바뀌면(## 를 치거나 지움) 그 줄만 다시 — 커서 자리 그대로 */
function _mwnRowRefresh(input, r) {
  var row = input.closest('.mwn-r'), i = +input.getAttribute('data-i');
  row.classList.toggle('is-empty', !r.t.trim());
  if (row.getAttribute('data-k') === _mwnKind(r)) return;
  var c = input.selectionStart, tmp = document.createElement('div');
  tmp.innerHTML = _mwnRowHtml(r, i);
  row.replaceWith(tmp.firstChild);
  var x = document.querySelector('#mwnEd .mwn-t[data-i="' + i + '"]');
  if (x) { x.focus(); try { x.setSelectionRange(c, c); } catch (_) {} }
}
function _mwnPaintRows(focus, caret) {
  var ed = document.getElementById('mwnEd');
  if (!ed) return;
  if (_mwn.loadErr) {
    ed.innerHTML = '<div class="mwn-lock is-err">❌ 이 날 노트를 불러오지 못했습니다<button class="mw-btn" data-n="reload">다시 불러오기</button></div>';
    return;
  }
  if (!_mwnReady()) {   // 불러오는 동안 — 자리만 (쓸 수 없음)
    ed.innerHTML = '<div class="mwn-lock" aria-busy="true"><i></i><i></i><i></i></div>';
    return;
  }
  ed.innerHTML = _mwn.rows.map(_mwnRowHtml).join('');
  if (focus != null) {
    var x = ed.querySelector('.mwn-t[data-i="' + focus + '"]');
    if (x) { x.focus(); var c = caret == null ? x.value.length : caret; try { x.setSelectionRange(c, c); } catch (_) {} }
  }
}
function _mwnFocusEnd() {
  if (_mwn.find || ('ontouchstart' in window)) return;   // 휴대폰은 자판이 갑자기 뜨지 않게
  var i = _mwn.rows.length - 1;
  _mwnPaintRows(i);
}
function _mwnShowState() {
  var s = document.getElementById('mwnSave');
  if (!s) return;
  s.textContent = { idle: '', dirty: '…', saving: '저장 중…', saved: '✓ 저장됨', error: '⚠️ 저장 못 함 — 누르면 다시', toolong: '⚠️ 2만 자 넘음 — 줄여야 저장됩니다' }[_mwn.state] || '';
  s.className = 'mwp-save' + (_mwn.state === 'saved' ? ' is-saved' : (_mwn.state === 'error' || _mwn.state === 'toolong') ? ' is-error' : '');
}
function _mwnBtn() {
  var b = document.querySelector('#mMyWork [data-mwn="open"]');
  if (!b) return;
  b.classList.toggle('on', _mwn.open);
  var days = (_mw.data && _mw.data.noteDays) || [];
  b.classList.toggle('has', days.indexOf(mwToday()) >= 0);
}

/* ═══ 저장 — 잠깐 쉬면 ═══ */
function _mwnQueue(ms) {
  if (!_mwnReady()) return;
  _mwn.state = 'dirty'; _mwnShowState();
  clearTimeout(_mwn.timer);
  _mwn.timer = setTimeout(function () { _mwn.timer = null; _mwnSave(); }, ms == null ? 700 : ms);
}
function _mwnFlush() { if (_mwn.timer) { clearTimeout(_mwn.timer); _mwn.timer = null; _mwnSave(); } }
/** 지금 화면의 글을 저장 — 다 불러온 날만 · 2만 자 한도 */
function _mwnSave() {
  if (!_mwn.date || !_mwnReady()) return;
  var date = _mwn.date, ref = _mwn.ref, body = _mwnBody();
  if (body.length > MWN_MAX) { _mwn.state = 'toolong'; _mwnShowState(); return; }
  _mwn.notes[ref] = body;
  _mwnDraftPut(date, ref, body, _mwn.srv[date + '|' + ref] || '');
  _mwnSaveRaw(date, ref, body);
}
var MWN_RETRY = [3000, 10000, 30000, 60000];
/** 세 갈래 합치기 — base(둘 다 알던 글) · mine(이 기기) · theirs(다른 곳에서 고친 지금 서버 글) (v13.333)
 *  한쪽만 고쳤으면 그쪽 · 둘 다 끝에 덧붙였으면 이어 붙임 · 그 밖엔 서버 글 아래에 이 기기에만 있는 줄을 붙여 둘 다 남김 (지우지 않음) */
function wmMergeNote(base, mine, theirs) {
  base = base || ''; mine = mine || ''; theirs = theirs || '';
  if (mine === theirs || mine === base) return theirs;
  if (theirs === base) return mine;
  if (mine.indexOf(base) === 0 && theirs.indexOf(base) === 0) {
    var add = mine.slice(base.length);
    return theirs + (add.charAt(0) === '\n' || !theirs || theirs.slice(-1) === '\n' ? '' : '\n') + add;
  }
  var have = {}; theirs.split('\n').forEach(function (l) { have[l] = 1; });
  var extra = mine.split('\n').filter(function (l) { return l.trim() && !have[l]; });
  if (!extra.length) return theirs;
  return (theirs ? theirs + '\n' : '') + '— 이 기기에서 쓴 글 (' + new Date().toTimeString().slice(0, 5) + ') —\n' + extra.join('\n');
}
/** 그 날 · 그 장을 저장 — 앞 저장이 끝난 뒤 차례로 (v13.275) · 실패하면 조금씩 늦춰 다시 (v13.331)
 *  v13.333: 보낼 때 그 장의 가장 새 글(want)을 보냄 · 서버 글 기준(base)을 함께 → 다른 곳에서 고쳤으면 합쳐서 다시 */
function _mwnBaseOf(date, ref) { var k = date + '|' + ref; return k in _mwn.srv ? _mwn.srv[k] : _mwn.loaded === date ? '' : undefined; }
function _mwnSaveRaw(date, ref, body) {
  var key = date + '|' + ref;
  _mwn.want = _mwn.want || {};
  _mwn.want[key] = body;
  if (_mwn.date === date && _mwn.ref === ref) { _mwn.state = 'saving'; _mwnShowState(); }
  var prev = _mwn.inflight || Promise.resolve(), sentBase;
  var p = _mwn.inflight = prev.catch(function () {}).then(function () {
    body = _mwn.want[key] != null ? _mwn.want[key] : body;   // 줄 서 있는 사이 더 쓴 것 · 합친 것
    sentBase = _mwnBaseOf(date, ref);
    if (sentBase === body) return null;   // 이미 서버와 같음
    var req = { date: date, ref: ref, body: body }; if (sentBase !== undefined) req.base = sentBase;
    return apiFetch('/api/my-work/notes', { method: 'PUT', body: JSON.stringify(req) });
  }).then(function () {
    if (_mwn.inflight === p) _mwn.inflight = null;
    if (_mwn.want[key] === body) delete _mwn.want[key];
    _mwn.srv[date + '|' + ref] = body;
    _mwnDraftDrop(date, ref, body);
    _mwn.retryN = 0;
    if (_mwn.date === date && _mwn.ref === ref && !_mwn.timer && !_mwn.inflight) { _mwn.state = 'saved'; _mwnShowState(); }
    // 노트 있는 날 점 (그날 어느 장이든 글이 있으면)
    var any = Object.keys(_mwn.date === date ? _mwn.notes : {}).some(function (k) { return String(_mwn.notes[k] || '').trim(); }) || !!body.trim();
    var days = (_mw.data.noteDays = _mw.data.noteDays || []), at = days.indexOf(date);
    if (any && at < 0) days.push(date); else if (!any && at >= 0) days.splice(at, 1);
    _mwnBtn();
    if (typeof _mtlMain !== 'undefined' && _mtlMain && _mtlMain.el && _mtlMain.el.isConnected) { _mtlMain.drawAxis(); if (_mtlMain.o.calendar) _mtlMain.drawCal(); }
  }).catch(function (e) {
    if (_mwn.inflight === p) _mwn.inflight = null;
    if (e && e.status === 409 && e.data && e.data.data) {   // 다른 곳(노트북 · 다른 창 · 기기)에서 먼저 고침 → 합쳐서 다시
      var theirs = e.data.data.body || '', live = _mwn.date === date && _mwn.ref === ref && _mwn.loaded === date;
      var merged = wmMergeNote(sentBase, live ? _mwnBody() : (_mwn.want[key] != null ? _mwn.want[key] : body), theirs);
      _mwn.srv[key] = theirs;
      if (_mwn.date === date) _mwn.notes[ref] = merged;
      if (live) { var ae = document.activeElement, idx = ae && ae.getAttribute ? ae.getAttribute('data-i') : null; _mwn.rows = _mwnParse(merged); _mwnPaintRows(false); if (idx != null) { var t = document.querySelector('#mwnEd .mwn-t[data-i="' + idx + '"]'); if (t) t.focus(); } }
      _mwnDraftPut(date, ref, merged, theirs);
      if (merged !== theirs) { _mwToast('🔀 다른 곳에서 고친 글과 합쳤습니다', 'info'); _mwnSaveRaw(date, ref, merged); }
      else { delete _mwn.want[key]; _mwnDraftDrop(date, ref, merged); if (live) { _mwn.state = 'saved'; _mwnShowState(); } }
      return;
    }
    if (_mwn.date === date && _mwn.ref === ref) { _mwn.state = 'error'; _mwnShowState(); }
    // 글은 이 기기에 남아 있음(임시 보관). 서버 · 연결 문제면 조금 뒤 저절로 다시 — 글 자체가 잘못(4xx)이면 알리기만
    var st = e && e.status, again = !st || st >= 500 || st === 408 || st === 429;
    if (again && _mwn.retryN < MWN_RETRY.length) {
      clearTimeout(_mwn.retryT);
      _mwn.retryT = setTimeout(function () {
        _mwn.retryT = null;
        var d = null; try { d = JSON.parse(localStorage.getItem(_mwnDraftKey(date, ref)) || 'null'); } catch (_) {}
        _mwnSaveRaw(date, ref, d ? d.body : body);
      }, MWN_RETRY[_mwn.retryN++]);
      if (_mwn.retryN === 1) _mwToast('⚠️ 노트 저장이 잠깐 안 됩니다 — 이 기기에 두고 곧 다시 저장합니다', 'warn');
    } else {
      _mwToast('❌ 노트 저장 못 함 — ' + _mwErr(e) + ' (글은 이 기기에 남아 있습니다)', 'error');
    }
  });
  return p;
}

/* ═══ 줄 → 할 일 ═══ */
function _mwnUp(i, keepFocus) {
  var r = _mwn.rows[i];
  if (!r || r.todo) return;
  var raw = r.t.replace(MWN_PEND_RE, '').trim();
  if (!raw) { _mwToast('할 일로 올릴 내용을 적어 주세요', 'warn'); return; }
  var q = typeof QuickParse !== 'undefined' ? QuickParse.parse(raw, mwToday()) : { title: raw };
  r.t = raw; r.todo = true;
  // 할 일 등록이 끝나기 전에 날짜 · 장을 바꿔도 그 날 노트에 표시가 남게 — 그때의 날 · 장 · 줄 목록을 잡아 둠 (v13.331)
  var date = _mwn.date, ref = _mwn.ref, rows = _mwn.rows;
  function save() {
    if (_mwn.date === date && _mwn.ref === ref && _mwn.rows === rows) _mwnQueue(0);
    else { var b = _mwnBody(rows); if (_mwn.date === date) _mwn.notes[ref] = b; _mwnDraftPut(date, ref, b, _mwn.srv[date + '|' + ref] || ''); _mwnSaveRaw(date, ref, b); }
  }
  function paint(f) { if (_mwn.rows === rows) _mwnPaintRows(f); }
  paint(keepFocus);
  save();
  mwAddTodo({ title: q.title || raw, dueDate: q.due || null, dueTime: q.due && q.time ? q.time : null, priority: q.priority || 3,
    memo: '📝 ' + _mwnLabel(date).replace(/ · .*/, '') + ' 노트에서' }).then(function (it) {
    r.todo = it && it.id ? it.id : true;
    save();
    _mwToast('✏️ 할 일로 — ' + (q.title || raw) + (q.due ? ' · ' + (+q.due.slice(5, 7)) + '/' + (+q.due.slice(8, 10)) : ''));
  }).catch(function (e) {
    r.todo = false; r.t = raw; paint(); save();
    _mwToast('❌ 할 일로 올리지 못했습니다 — ' + _mwErr(e), 'error');
  });
}

/* ═══ 검색 · 지난 노트 ═══ */
function _mwnFind(q, box) {
  var out = box || document.getElementById('mwnFound');
  if (!out) return;
  out.innerHTML = '<div class="mwn-e">찾는 중…</div>';
  apiFetch('/api/my-work/notes/find' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (r) {
    var list = (r && r.data) || [];
    out.innerHTML = list.length ? list.map(function (x) {
      return '<button class="mwn-fi" data-go="' + x.date + '" data-ref="' + _mwEsc(x.ref) + '"><b>' + _mwEsc(_mwnLabel(x.date)) + (x.ref ? ' · 🤝' : '') + '</b><span>' + _mwEsc(x.snip) + '</span><i>' + x.lines + '줄</i></button>';
    }).join('') : '<div class="mwn-e">' + (q ? '"' + _mwEsc(q) + '" 이 든 노트가 없습니다' : '아직 쓴 노트가 없습니다') + '</div>';
  }).catch(function (e) { out.innerHTML = '<div class="mwn-e">❌ ' + _mwEsc(_mwErr(e)) + '</div>'; });
}

/* ═══ 회의 요약 (메모 화면 위 · 타임라인 미리보기 카드 공용) ═══ */
function _mwnBriefLoad(evId) {
  var c = _mwn.brief[evId];
  if (c) return c.p || Promise.resolve(c.v);
  var p = apiFetch('/api/my-work/meeting-brief?eventId=' + encodeURIComponent(evId)).then(function (r) { return r && r.data; });
  _mwn.brief[evId] = { p: p };
  return p.then(function (v) { _mwn.brief[evId] = { v: v }; setTimeout(function () { delete _mwn.brief[evId]; }, 60000); return v; }, function (e) { delete _mwn.brief[evId]; throw e; });
}
function _mwnBriefHtml(b, opt) {
  opt = opt || {};
  if (!b) return '<div class="mwn-bf-e">연결된 회의록이 없는 일정입니다</div>';
  if (b.locked) return '<div class="mwn-bf-e">🔒 이 회의록을 볼 권한이 없습니다</div>';
  var h = (b.projectName ? '<div class="mwn-bf-p">📁 ' + _mwEsc(b.projectName) + '</div>' : '');
  if (b.agenda.length) h += '<div class="mwn-bf-l">안건 ' + b.agendaN + '</div><ul class="mwn-bf-a">' + b.agenda.slice(0, opt.short ? 4 : 8).map(function (g) {
    return '<li' + (g.done ? ' class="is-done"' : '') + '>' + _mwEsc(g.text) + (g.result ? ' <i>→ ' + _mwEsc(g.result.slice(0, 60)) + '</i>' : '') + '</li>';
  }).join('') + '</ul>';
  if (b.minutes) h += '<div class="mwn-bf-l">회의록</div><div class="mwn-bf-m">' + _mwEsc(b.minutes.slice(0, opt.short ? 140 : 300)) + (b.minutes.length > (opt.short ? 140 : 300) ? '…' : '') + '</div>';
  h += '<div class="mwn-bf-l">내 액션 ' + b.myActions.length + (b.actionN ? ' / 전체 ' + b.actionN : '') + '</div>' +
    (b.myActions.length ? '<ul class="mwn-bf-a">' + b.myActions.map(function (a) { return '<li' + (a.done ? ' class="is-done"' : '') + '>' + _mwEsc(a.title) + (a.due ? ' <i>' + _mwEsc(a.due.slice(5).replace('-', '/')) + '</i>' : '') + '</li>'; }).join('') + '</ul>' : '');
  return h;
}
function _mwnLoadBrief(evId) {
  var box = document.getElementById('mwnBrief');
  if (!box) return;
  box.innerHTML = '<div class="mwn-bf-e">회의록 불러오는 중…</div>';
  _mwnBriefLoad(evId).then(function (b) {
    if (_mwn.ref !== 'ev:' + evId || !document.getElementById('mwnBrief')) return;
    box.innerHTML = '<details class="mwn-bf"' + (b && !b.locked ? '' : ' open') + '><summary>회의록 요약' + (b && b.meetingId && !b.locked ? '<button class="mw-btn mwn-om" data-om="' + _mwEsc(evId) + '">회의록 열기 ↗</button>' : '') + '</summary>' + _mwnBriefHtml(b) + '</details>';
  }).catch(function () { box.innerHTML = '<div class="mwn-bf-e">회의록을 불러오지 못했습니다</div>'; });
}
/** 회의록 열기 — 프로젝트 상세 → 회의 탭 → 그 회의 카드 */
function mwOpenMeeting(evId) {
  if (mwOpenMeeting.busy) return;
  mwOpenMeeting.busy = true;
  setTimeout(function () { mwOpenMeeting.busy = false; }, 1500);
  _mwnBriefLoad(evId).then(function (b) {
    if (!b || b.locked || !b.meetingId) { _mwToast('열 수 있는 회의록이 없습니다', 'warn'); return; }
    if (!b.projectId || typeof showProjectDetail !== 'function') { _mwToast('프로젝트 없는 회의록은 회의 화면에서 엽니다', 'warn'); return; }
    mwNotesClose(); mwMeetingCardHide(true);
    showProjectDetail(b.projectId);
    var tries = 0;
    (function step() {
      if (++tries > 60) return;
      if (!document.getElementById('pdTabMeeting')) return setTimeout(step, 100);
      if (tries === 1 || !(typeof _pmt !== 'undefined' && _pmt && _pmt.projId === b.projectId)) { if (typeof pdSwitchTab === 'function' && !step.sw) { step.sw = true; pdSwitchTab('meeting', b.projectId); } }
      if (typeof _pmt !== 'undefined' && _pmt && _pmt.projId === b.projectId && (_pmt.list || []).some(function (m) { return String(m.id) === String(b.meetingId); })) { pmtOpenCard(b.meetingId); return; }
      setTimeout(step, 100);
    })();
  }).catch(function (e) { mwOpenMeeting.busy = false; _mwToast('❌ 회의록을 열지 못했습니다 — ' + _mwErr(e), 'error'); });
}

/* ── 타임라인 회의 미리보기 카드 ─────────────────────────────────── */
var _mwnCard = { t: null, hideT: null, ev: null };
function mwMeetingCard(t, rect) {
  if (!t || !t.ev) return;
  clearTimeout(_mwnCard.hideT);
  var c = document.getElementById('mwnCard');
  if (_mwnCard.ev === t.ev.id + t.occ && c) return;
  if (!c) {
    c = document.createElement('div');
    c.id = 'mwnCard'; c.className = 'mwn-card';
    document.body.appendChild(c);
    c.addEventListener('mouseenter', function () { clearTimeout(_mwnCard.hideT); });
    c.addEventListener('mouseleave', function () { mwMeetingCardHide(); });
    c.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cm]');
      if (!b) return;
      var k = b.getAttribute('data-cm'), ev = c._ev;
      if (k === 'memo') { mwMeetingCardHide(true); mwNotesOpen(c._occ, 'ev:' + ev.id); }
      else if (k === 'open') mwOpenMeeting(ev.id);
      else if (k === 'evt' && typeof _mwcEventModal === 'function') { mwMeetingCardHide(true); _mwcEventModal(ev.id, c._occ); }
    });
  }
  _mwnCard.ev = t.ev.id + t.occ;
  c._ev = t.ev; c._occ = t.occ;
  var head = '<div class="mwn-card-h"><b>🤝 ' + _mwEsc(t.ev.title || '회의') + '</b><i>' + _mwEsc(_mwnLabel(t.occ)) + (t.ev.startTime ? ' ' + _mwEsc(t.ev.startTime) + (t.ev.endTime ? '~' + _mwEsc(t.ev.endTime) : '') : '') + (t.ev.location ? ' · ' + _mwEsc(t.ev.location) : '') + '</i></div>';
  var memo = (_mw.data && _mw.data.self) ? '<button class="mw-btn" data-cm="memo">📝 메모</button>' : '';
  c.innerHTML = head + '<div class="mwn-card-b">불러오는 중…</div><div class="mwn-card-f">' + memo + '<button class="mw-btn" data-cm="evt">일정</button></div>';
  c.style.display = 'block';
  var x = Math.min(window.innerWidth - c.offsetWidth - 10, Math.max(10, rect.left));
  var y = rect.bottom + 6 + c.offsetHeight > window.innerHeight ? rect.top - c.offsetHeight - 6 : rect.bottom + 6;
  c.style.left = x + 'px'; c.style.top = Math.max(8, y) + 'px';
  _mwnBriefLoad(t.ev.id).then(function (b) {
    if (_mwnCard.ev !== t.ev.id + t.occ) return;
    c.querySelector('.mwn-card-b').innerHTML = _mwnBriefHtml(b, { short: true });
    if (b && b.meetingId && !b.locked) c.querySelector('.mwn-card-f').insertAdjacentHTML('beforeend', '<button class="mw-btn mw-btn-p" data-cm="open">회의록 열기 ↗</button>');
  }).catch(function () { c.querySelector('.mwn-card-b').textContent = '회의록을 불러오지 못했습니다'; });
}
function mwMeetingCardHide(now) {
  clearTimeout(_mwnCard.hideT);
  function go() { var c = document.getElementById('mwnCard'); if (c) c.style.display = 'none'; _mwnCard.ev = null; }
  if (now) go(); else _mwnCard.hideT = setTimeout(go, 220);
}

/* ═══ 서랍 이벤트 (한 번만) ═══ */
function _mwnBind(el) {
  el.addEventListener('click', function (e) {
    var t = e.target;
    var n = t.closest('[data-n]');
    if (n && n.tagName !== 'INPUT') {
      var k = n.getAttribute('data-n');
      if (k === 'close') return mwNotesClose();
      if (k === 'prev' || k === 'next') return mwNotesGo(_mtlYmd(_mtlNum(_mwn.date) + (k === 'prev' ? -1 : 1)));
      if (k === 'today') return mwNotesGo(mwToday());
      if (k === 'reload') { _mwn.loaded = null; return mwNotesGo(_mwn.date, _mwn.ref); }
      if (k === 'back') return mwNotesGo(_mwn.date, '');
      if (k === 'fs') { var f = { s: '', '': 'l', l: 's' }[_mwnFs()]; try { localStorage.setItem('wm.mwn.fs', f); } catch (_) {} _mwnApplyFs(el); _mwnFlush(); _mwnRender(); return; }
      if (k === 'find') { _mwnFlush(); _mwn.find = !_mwn.find; _mwnRender(); return; }
    }
    var mt = t.closest('[data-mt]');
    if (mt) return mwNotesGo(_mwn.date, 'ev:' + mt.getAttribute('data-mt'));
    var om = t.closest('[data-om]');
    if (om) { e.preventDefault(); return mwOpenMeeting(om.getAttribute('data-om')); }
    var go = t.closest('[data-go]');
    if (go) return mwNotesGo(go.getAttribute('data-go'), go.getAttribute('data-ref') || '');
    var up = t.closest('[data-up]');
    if (up) return _mwnUp(+up.getAttribute('data-up'));
    var op = t.closest('[data-open]');
    if (op) {
      var r = _mwn.rows[+op.getAttribute('data-open')];
      var it = r && typeof r.todo === 'string' ? _mwFind('todo:' + r.todo) : null;
      if (it) mwPanelOpen(it); else _mwToast('이 할 일은 끝났거나 지워졌습니다', 'warn');
      return;
    }
    if (t.closest('#mwnSave') && _mwn.state === 'error') _mwnSave();
  });
  el.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-n') === 'date' && e.target.value) mwNotesGo(e.target.value);
  });
  el.addEventListener('toggle', function (e) {
    if (e.target.id === 'mwnOld' && e.target.open) _mwnFind('', document.getElementById('mwnOldL'));
  }, true);
  el.addEventListener('input', function (e) {
    var t = e.target;
    if (!t.classList.contains('mwn-t')) return;
    var r = _mwn.rows[+t.getAttribute('data-i')];
    if (r) { r.t = t.value; if (!e.isComposing) _mwnRowRefresh(t, r); _mwnQueue(); }
  });
  el.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.isComposing || e.keyCode === 229) return;   // 한글 조합 중
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (_mwn.find && (t.id === 'mwnQ' || t.closest('.mwn-find'))) { _mwn.find = false; _mwnRender(); _mwnFocusEnd(); return; }   // 찾기만 닫음
      mwNotesClose(); return;
    }
    if (t.id === 'mwnQ' && e.key === 'Enter') { e.preventDefault(); _mwnFind(t.value.trim()); return; }
    if (!t.classList.contains('mwn-t')) return;
    var i = +t.getAttribute('data-i'), rows = _mwn.rows, r = rows[i];
    var s = t.selectionStart, en = t.selectionEnd;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _mwnUp(i); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      var before = t.value.slice(0, s), after = t.value.slice(en);
      r.t = before;
      rows.splice(i + 1, 0, { t: after });
      _mwnPaintRows(i + 1, 0);
      if (MWN_PEND_RE.test(before) && !r.todo) _mwnUp(i, i + 1);   // '- [ ] 견적' + Enter → 할 일 (커서는 다음 줄에 그대로)
      _mwnQueue();
      return;
    }
    if (e.key === 'Backspace' && s === 0 && en === 0 && i > 0 && !r.todo) {
      e.preventDefault();
      var p = rows[i - 1];
      if (p.todo) { if (!r.t) { rows.splice(i, 1); _mwnPaintRows(i - 1); _mwnQueue(); } return; }
      var at = p.t.length;
      p.t += r.t; rows.splice(i, 1);
      _mwnPaintRows(i - 1, at);
      _mwnQueue();
      return;
    }
    if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); _mwnPaintRows(i - 1, Math.min(s, rows[i - 1].t.length)); return; }
    if (e.key === 'ArrowDown' && i < rows.length - 1) { e.preventDefault(); _mwnPaintRows(i + 1, Math.min(s, rows[i + 1].t.length)); return; }
  });
  el.addEventListener('focusout', function (e) {
    var t = e.target;
    if (!t.classList || !t.classList.contains('mwn-t')) return;
    var r = _mwn.rows[+t.getAttribute('data-i')];
    if (r && !r.todo && MWN_PEND_RE.test(r.t) && r.t.replace(MWN_PEND_RE, '').trim()) _mwnUp(+t.getAttribute('data-i'));
  });
  el.addEventListener('paste', function (e) {
    var t = e.target;
    if (!t.classList.contains('mwn-t')) return;
    var txt = (e.clipboardData || window.clipboardData).getData('text');
    if (!/\n/.test(txt)) return;
    e.preventDefault();
    var i = +t.getAttribute('data-i'), r = _mwn.rows[i];
    var lines = txt.replace(/\r/g, '').split('\n').map(function (l) { return l.slice(0, MWN_LINE); });
    var head = t.value.slice(0, t.selectionStart), tail = t.value.slice(t.selectionEnd);
    r.t = head + lines[0];
    var add = lines.slice(1).map(function (l) { return { t: l }; });
    add[add.length - 1].t += tail;
    Array.prototype.splice.apply(_mwn.rows, [i + 1, 0].concat(add));
    _mwnPaintRows(i + add.length);
    _mwnQueue();
  });
}

/* 📖 펼쳐 보기 — 보던 일일 노트부터 (공용 창은 note-book.js wmBookOpen · v13.326 노트북 · 업무일지 · 회의록도) */
function mwNotesSpread() {
  if (_mwn.open) _mwnFlush();
  return wmBookOpen({ cur: _mwn.date ? 'daily:' + _mwn.date + '|' + (_mwn.ref || '') : null, kind: 'daily' });
}

/* ═══ 창을 닫거나 다른 앱으로 갈 때 — 남은 글을 바로 보냄 (v13.331) ═══
   보통 fetch 는 페이지가 내려가면 끊김 → keepalive. 못 보낸 글도 임시 보관에 있어 다음에 되살림 */
function _mwnFlushNow() {
  if (!_mwn.timer || !_mwnReady()) return;
  clearTimeout(_mwn.timer); _mwn.timer = null;
  var date = _mwn.date, ref = _mwn.ref, body = _mwnBody();
  if (body.length > MWN_MAX) return;
  _mwn.notes[ref] = body;
  _mwnDraftPut(date, ref, body, _mwn.srv[date + '|' + ref] || '');
  try {
    fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/my-work/notes', {
      method: 'PUT', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (typeof _accessToken !== 'undefined' ? _accessToken : '') },
      body: JSON.stringify(Object.assign({ date: date, ref: ref, body: body }, _mwnBaseOf(date, ref) !== undefined ? { base: _mwnBaseOf(date, ref) } : {}))
    }).then(function (r) { if (r.ok) { _mwn.srv[date + '|' + ref] = body; _mwnDraftDrop(date, ref, body); } }).catch(function () {});
  } catch (_) {}
}
window.addEventListener('pagehide', _mwnFlushNow);
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') _mwnFlushNow(); });
window.addEventListener('beforeunload', function (e) {
  if (_mwn.timer || _mwn.inflight || _mwn.retryT) { _mwnFlushNow(); e.preventDefault(); e.returnValue = ''; }   // 아직 저장 중 — 닫을지 물음
});

/** 📓 노트북으로 — 남은 저장을 마친 뒤 옮김 (노트북 일일 노트가 저장 전 옛 글을 불러오지 않게) */
function mwNotesToBook() {
  _mwnFlush();
  var p = _mwn.inflight || Promise.resolve();
  p.catch(function () {}).then(function () { mwNotesClose(); if (typeof nbOpenDailyView === 'function') nbOpenDailyView(); });
}
