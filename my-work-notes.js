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
   서버 API: GET·PUT /api/my-work/notes · GET /notes/find · GET /meeting-brief · GET /events
   전역 의존: _mw · _mwEsc · _mwToast · _mwErr · _mwFind · _mwPaint · mwAddTodo (my-work.js) · mwPanelOpen · mwPanelClose · mwPanelIsOpen (my-work-panel.js)
              _mtlMain · _mtlNum · _mtlYmd · _mtlFmt · _mtlToday (my-work-timeline.js) · QuickParse · expandRepeatingEvents · toCamelArray · showProjectDetail · pdSwitchTab · pmtOpenCard
   ═══════════════════════════════════════════════════════════════════════ */

var _mwn = { open: false, date: null, ref: '', rows: [], notes: {}, meetings: [], timer: null, inflight: null, state: 'idle', find: false, brief: {}, seq: 0 };
var MWN_TODO_RE = /^- \[x\] (.*?)(?: ⟦([^⟧]*)⟧)?$/;
var MWN_PEND_RE = /^(?:- )?\[ ?\]\s+/;

function mwNotesIsOpen() { return _mwn.open; }
function _mwnToday() { return typeof _mtlToday === 'function' ? _mtlToday() : ((_mw.data && _mw.data.today) || localDate()); }
function _mwnLabel(d) {
  var t = _mwnToday(), n = _mtlNum(d) - _mtlNum(t);
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
function _mwnBody() {
  var rows = _mwn.rows.slice();
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
  _mwn.open = true;
  document.body.classList.add('mwp-open');
  requestAnimationFrame(function () { el.classList.add('on'); });
  _mwnBtn();
  mwNotesGo(date || (_mtlMain && _mtlMain.st.link && _mtlMain.pick) || _mwnToday(), ref || '');
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
  _mwn.rows = _mwnParse(same && _mwn.notes[ref] != null ? _mwn.notes[ref] : '');
  _mwnRender();
  if (same && _mwn.loaded === date) { _mwnFocusEnd(); if (ref) _mwnLoadBrief(ref.slice(3)); return; }
  _mwn.meetings = []; _mwn.notes = {};
  Promise.all([
    apiFetch('/api/my-work/notes?date=' + date),
    apiFetch('/api/my-work/events?from=' + date + '&to=' + date).catch(function () { return null; })
  ]).then(function (res) {
    if (seq !== _mwn.seq) return;
    _mwn.loaded = date;
    (res[0].data.notes || []).forEach(function (n) { _mwn.notes[n.ref] = n.body; });
    var rows = res[1] ? (typeof toCamelArray === 'function' ? toCamelArray(res[1].data || []) : res[1].data || []) : [];
    var occ = typeof expandRepeatingEvents === 'function' ? expandRepeatingEvents(rows.slice(), date, date) : rows;
    var orig = {};
    rows.forEach(function (e) { orig[e.id] = e; });
    _mwn.meetings = occ.filter(function (o) { var e = orig[o._origId || o.id] || o; return e.type === 'meeting' && o.startDate <= date && (o.endDate || o.startDate) >= date; })
      .map(function (o) { var e = orig[o._origId || o.id] || o; return { id: e.id, title: e.title || '회의', time: e.startTime || '' }; })
      .sort(function (a, b) { return (a.time || '99').localeCompare(b.time || '99'); });
    // 불러오는 사이 이미 쓰기 시작했으면 쓰던 줄은 그대로 두고 회의 칸만 채움 (커서가 튀지 않게)
    var ed = document.getElementById('mwnEd');
    var typing = _mwn.timer || _mwn.inflight || (ed && ed.contains(document.activeElement) && _mwn.rows.some(function (r) { return r.t; }));
    if (typing) { _mwnPaintTop(); }
    else {
      _mwn.rows = _mwnParse(_mwn.notes[_mwn.ref] || '');
      var hadFocus = ed && ed.contains(document.activeElement);
      _mwnPaintTop();
      _mwnPaintRows();
      if (hadFocus || !('ontouchstart' in window)) _mwnFocusEnd();
    }
    if (_mwn.ref) _mwnLoadBrief(_mwn.ref.slice(3));
  }).catch(function (e) { _mwToast('❌ 노트를 불러오지 못했습니다 — ' + _mwErr(e), 'error'); });
}

/* ═══ 그리기 ═══ */
function _mwnRender() {
  var el = document.getElementById('mwNotes');
  if (!el) return;
  var d = _mwn.date;
  var h = '<div class="mwp-h mwn-h"><b class="mwn-ttl">📝 노트</b><span class="mwp-save" id="mwnSave" aria-live="polite"></span>' +
    '<button class="mwn-ib" data-n="find" title="노트 검색">🔍</button><button class="mwp-x" data-n="close" title="닫기 (Esc)">✕</button></div>';
  h += '<div class="mwn-nav"><button data-n="prev" title="전날">‹</button><label class="mwn-date" title="날짜 고르기"><span>' + _mwEsc(_mwnLabel(d)) + '</span><input type="date" data-n="date" value="' + d + '"></label>' +
    '<button data-n="next" title="다음날">›</button>' + (d !== _mwnToday() ? '<button data-n="today" class="mwn-tod">오늘</button>' : '') + '</div>';
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
function _mwnPaintRows(focus, caret) {
  var ed = document.getElementById('mwnEd');
  if (!ed) return;
  ed.innerHTML = _mwn.rows.map(function (r, i) {
    return '<div class="mwn-r' + (r.todo ? ' is-todo' : '') + '" data-i="' + i + '">' +
      (r.todo ? '<button class="mwn-ok" data-open="' + i + '" title="할 일로 올림 — 누르면 열기">✓</button>' : '<span class="mwn-dot">•</span>') +
      '<input class="mwn-t" data-i="' + i + '" value="' + _mwEsc(r.t) + '" maxlength="500"' + (i === 0 && !r.t && _mwn.rows.length === 1 ? ' placeholder="생각나는 대로 — 해야 할 건 ➜ 로 할 일에"' : '') + '>' +
      (r.todo ? '' : '<button class="mwn-up" data-up="' + i + '" title="이 줄을 할 일로 (Ctrl+Enter)">➜</button>') + '</div>';
  }).join('');
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
  s.textContent = { idle: '', dirty: '…', saving: '저장 중…', saved: '✓ 저장됨', error: '⚠️ 저장 못 함 — 누르면 다시' }[_mwn.state] || '';
  s.className = 'mwp-save' + (_mwn.state === 'saved' ? ' is-saved' : _mwn.state === 'error' ? ' is-error' : '');
}
function _mwnBtn() {
  var b = document.querySelector('#mMyWork [data-mwn="open"]');
  if (!b) return;
  b.classList.toggle('on', _mwn.open);
  var days = (_mw.data && _mw.data.noteDays) || [];
  b.classList.toggle('has', days.indexOf(_mwnToday()) >= 0);
}

/* ═══ 저장 — 잠깐 쉬면 ═══ */
function _mwnQueue(ms) {
  _mwn.state = 'dirty'; _mwnShowState();
  clearTimeout(_mwn.timer);
  _mwn.timer = setTimeout(function () { _mwn.timer = null; _mwnSave(); }, ms == null ? 700 : ms);
}
function _mwnFlush() { if (_mwn.timer) { clearTimeout(_mwn.timer); _mwn.timer = null; _mwnSave(); } }
function _mwnSave() {
  if (!_mwn.date) return;
  var date = _mwn.date, ref = _mwn.ref, body = _mwnBody();
  _mwn.notes[ref] = body;
  _mwn.state = 'saving'; _mwnShowState();
  var p = _mwn.inflight = apiFetch('/api/my-work/notes', { method: 'PUT', body: JSON.stringify({ date: date, ref: ref, body: body }) }).then(function () {
    if (_mwn.inflight === p) _mwn.inflight = null;
    if (_mwn.date === date && _mwn.ref === ref && !_mwn.timer) { _mwn.state = 'saved'; _mwnShowState(); }
    // 노트 있는 날 점 (그날 어느 장이든 글이 있으면)
    var any = Object.keys(_mwn.date === date ? _mwn.notes : {}).some(function (k) { return String(_mwn.notes[k] || '').trim(); }) || !!body.trim();
    var days = (_mw.data.noteDays = _mw.data.noteDays || []), at = days.indexOf(date);
    if (any && at < 0) days.push(date); else if (!any && at >= 0) days.splice(at, 1);
    _mwnBtn();
    if (typeof _mtlMain !== 'undefined' && _mtlMain && _mtlMain.el && _mtlMain.el.isConnected) { _mtlMain.drawAxis(); if (_mtlMain.o.calendar) _mtlMain.drawCal(); }
  }).catch(function (e) {
    if (_mwn.inflight === p) _mwn.inflight = null;
    _mwn.state = 'error'; _mwnShowState();
    _mwToast('❌ 노트 저장 못 함 — ' + _mwErr(e), 'error');
  });
}

/* ═══ 줄 → 할 일 ═══ */
function _mwnUp(i) {
  var r = _mwn.rows[i];
  if (!r || r.todo) return;
  var raw = r.t.replace(MWN_PEND_RE, '').trim();
  if (!raw) { _mwToast('할 일로 올릴 내용을 적어 주세요', 'warn'); return; }
  var q = typeof QuickParse !== 'undefined' ? QuickParse.parse(raw, _mwnToday()) : { title: raw };
  r.t = raw; r.todo = true;
  _mwnPaintRows();
  _mwnQueue(0);
  mwAddTodo({ title: q.title || raw, dueDate: q.due || null, dueTime: q.due && q.time ? q.time : null, priority: q.priority || 3,
    memo: '📝 ' + _mwnLabel(_mwn.date).replace(/ · .*/, '') + ' 노트에서' }).then(function (it) {
    r.todo = it && it.id ? it.id : true;
    _mwnQueue(0);
    _mwToast('✏️ 할 일로 — ' + (q.title || raw) + (q.due ? ' · ' + (+q.due.slice(5, 7)) + '/' + (+q.due.slice(8, 10)) : ''));
  }).catch(function (e) {
    r.todo = false; r.t = raw; _mwnPaintRows(); _mwnQueue(0);
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
  if (_mwn.brief[evId]) return Promise.resolve(_mwn.brief[evId].v);
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
  });
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
      if (k === 'today') return mwNotesGo(_mwnToday());
      if (k === 'back') return mwNotesGo(_mwn.date, '');
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
    if (r) { r.t = t.value; _mwnQueue(); }
  });
  el.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.isComposing || e.keyCode === 229) return;   // 한글 조합 중
    if (e.key === 'Escape') { e.stopPropagation(); mwNotesClose(); return; }
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
      if (MWN_PEND_RE.test(before) && !r.todo) _mwnUp(i);   // '- [ ] 견적' + Enter → 할 일
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
    var lines = txt.replace(/\r/g, '').split('\n');
    var head = t.value.slice(0, t.selectionStart), tail = t.value.slice(t.selectionEnd);
    r.t = head + lines[0];
    var add = lines.slice(1).map(function (l) { return { t: l }; });
    add[add.length - 1].t += tail;
    Array.prototype.splice.apply(_mwn.rows, [i + 1, 0].concat(add));
    _mwnPaintRows(i + add.length);
    _mwnQueue();
  });
}
