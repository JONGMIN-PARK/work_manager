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
   📖 펼쳐 보기 (v13.325) — 노트 2~4장을 골라 책처럼 나란히 (mwNotesSpread · _mwns)
   서버 API: GET·PUT /api/my-work/notes · GET /notes/find · GET /meeting-brief · GET /events
   전역 의존: _mw · _mwEsc · _mwToast · _mwErr · _mwFind · _mwPaint · mwAddTodo (my-work.js) · mwPanelOpen · mwPanelClose · mwPanelIsOpen (my-work-panel.js)
              _mtlMain · _mtlNum · _mtlYmd · _mtlFmt · mwToday (my-work-timeline.js) · QuickParse · expandRepeatingEvents · toCamelArray · showProjectDetail · pdSwitchTab · pmtOpenCard
   ═══════════════════════════════════════════════════════════════════════ */

var _mwn = { open: false, date: null, ref: '', rows: [], notes: {}, meetings: [], timer: null, inflight: null, state: 'idle', find: false, brief: {}, seq: 0 };
var MWN_TODO_RE = /^- \[x\] (.*?)(?: ⟦([^⟧]*)⟧)?$/;
var MWN_PEND_RE = /^(?:- )?\[ ?\]\s+/;

function mwNotesIsOpen() { return _mwn.open; }
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
    (typeof renderNotebook === 'function' ? '<button class="mwn-ib" onclick="nbOpenDailyView()" title="📓 노트북에서 크게 보기 (일일 노트)">📓</button>' : '') + '<button class="mwn-ib" onclick="mwNotesSpread()" title="📖 펼쳐 보기 — 노트 여러 장(2~4)을 골라 책처럼 나란히">📖</button><button class="mwn-ib" data-n="find" title="노트 검색">🔍</button><button class="mwp-x" data-n="close" title="닫기 (Esc)">✕</button></div>';
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
  b.classList.toggle('has', days.indexOf(mwToday()) >= 0);
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
  // 앞 저장이 끝난 뒤 보냄 — 둘이 엇갈려 옛 글이 새 글을 덮던 것 (v13.275)
  var prev = _mwn.inflight || Promise.resolve();
  var p = _mwn.inflight = prev.catch(function () {}).then(function () {
    return apiFetch('/api/my-work/notes', { method: 'PUT', body: JSON.stringify({ date: date, ref: ref, body: body }) });
  }).then(function () {
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
  var q = typeof QuickParse !== 'undefined' ? QuickParse.parse(raw, mwToday()) : { title: raw };
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
      if (k === 'today') return mwNotesGo(mwToday());
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

/* ═══ 📖 펼쳐 보기 (v13.325) — 고른 노트를 책 펼치듯 2 · 3 · 4장 나란히 ═══
   왼쪽: 노트 목록(최신이 위) 체크 · 찾기 / 오른쪽: 옛 장이 왼쪽인 종이. ‹ › (← →) 는 목록에서 장 수만큼 통째로 넘김.
   장 수는 localStorage 'mwn-spread-n' (2~4). 종이 머리를 누르면 그 노트를 📝 서랍에서 열어 고칠 수 있음 */
var MWN_SPREAD_MAX = 4;
var _mwns = { n: 2, list: [], pick: [], bodies: {}, q: '', seq: 0 };
function _mwnsKey(x) { return x.date + '|' + (x.ref || ''); }
function _mwnsN() { var n = 0; try { n = +localStorage.getItem('mwn-spread-n'); } catch (e) {} return n >= 2 && n <= MWN_SPREAD_MAX ? n : 2; }
function _mwnsSetN(n) {
  _mwns.n = n;
  try { localStorage.setItem('mwn-spread-n', String(n)); } catch (e) {}
  document.querySelectorAll('#mwnSpreadModal .mwns-seg button').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-v') === n); });
}

/** 진입 — 서랍에서 보던 노트가 있으면 그 장과 바로 앞(옛) 장을 미리 골라 둠 */
function mwNotesSpread() {
  if (_mwn.open) _mwnFlush();
  return wmGuardedModal('mwnSpread', function () {
    _mwns.n = _mwnsN(); _mwns.q = ''; _mwns.bodies = {};
    return apiFetch('/api/my-work/notes/find?book=1').then(function (r) {
      _mwns.list = (r && r.data) || [];
      if (!_mwns.list.length) { _mwToast('아직 쓴 노트가 없습니다 — 📝 노트에 먼저 써 주세요', 'warn'); return false; }
      var cur = _mwn.date ? _mwns.list.filter(function (x) { return x.date === _mwn.date && (x.ref || '') === (_mwn.ref || ''); })[0] : null;
      var at = Math.max(0, Math.min(_mwns.list.length - _mwns.n, cur ? _mwns.list.indexOf(cur) : 0));
      _mwns.pick = _mwns.list.slice(at, at + _mwns.n).map(_mwnsKey);
      _mwnsBuild();
    });
  }, 'mwnSpreadModal', { onOpen: _mwnsLoadPages });
}
function _mwnsBuild() {
  var h = '<div class="mwns">' +
    '<div class="mwns-bar">' +
      '<span class="mwns-seg" role="group" aria-label="한 번에 볼 장 수">' + [2, 3, 4].map(function (n) { return '<button type="button" data-s="n" data-v="' + n + '" class="' + (_mwns.n === n ? 'on' : '') + '">' + n + '장</button>'; }).join('') + '</span>' +
      '<button type="button" class="mw-btn" data-s="prev" title="옛 노트 쪽으로 넘기기 (←)">‹ 앞 장</button><button type="button" class="mw-btn" data-s="next" title="새 노트 쪽으로 넘기기 (→)">뒷 장 ›</button>' +
      '<span class="mwns-cnt" id="mwnsCnt"></span><span style="flex:1"></span>' +
      '<button type="button" class="mw-btn" data-s="side" title="노트 고르는 목록 접기 · 펴기">☰ 목록</button>' +
    '</div>' +
    '<div class="mwns-main">' +
      '<div class="mwns-side"><input class="mw-input" id="mwnsQ" placeholder="목록에서 찾기 (날짜 · 내용)" autocomplete="off"><div class="mwns-list" id="mwnsList"></div></div>' +
      '<div class="mwns-book" id="mwnsBook"></div>' +
    '</div></div>';
  var ov = createModal({ id: 'mwnSpreadModal', width: 'min(1500px, 97vw)', titleText: '📖 노트 펼쳐 보기', html: h, closeOnEsc: true,
    boxStyle: 'max-height:92vh;height:92vh;padding:14px 16px;display:flex;flex-direction:column;overflow:hidden' }).overlay;
  ov.classList.add('mwns-ov');
  var wrap = ov.querySelector('.mwns').parentElement;   // createModal 의 본문 칸도 늘어나야 종이가 창 높이를 채움
  if (wrap && !wrap.classList.contains('wa-modal-box')) wrap.style.cssText += ';flex:1;min-height:0;display:flex;flex-direction:column';
  if (window.innerWidth < 700) ov.querySelector('.mwns').classList.add('no-side');   // 휴대폰은 종이부터
  _mwnsPaintList();
  ov.addEventListener('click', function (e) {
    var t = e.target;
    var s = t.closest('[data-s]');
    if (s) {
      var k = s.getAttribute('data-s');
      if (k === 'n') { _mwnsSetN(+s.getAttribute('data-v')); _mwnsFill(); return; }
      if (k === 'prev' || k === 'next') return _mwnsFlip(k === 'prev' ? 1 : -1);
      if (k === 'side') { ov.querySelector('.mwns').classList.toggle('no-side'); return; }
      if (k === 'open') return _mwnsOpenNote(s.getAttribute('data-k'));
      if (k === 'drop') return _mwnsToggle(s.getAttribute('data-k'));
    }
    var it = t.closest('[data-pk]');
    if (it) { e.preventDefault(); _mwnsToggle(it.getAttribute('data-pk')); }
  });
  ov.querySelector('#mwnsQ').addEventListener('input', function (e) { _mwns.q = e.target.value.trim().toLowerCase(); _mwnsPaintList(); });
  ov.addEventListener('keydown', function (e) {
    if (e.target.id === 'mwnsQ' || e.isComposing) return;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); _mwnsFlip(1); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); _mwnsFlip(-1); }
  });
  _mwnsSwipe(ov.querySelector('#mwnsBook'));
  ov.tabIndex = -1; ov.focus();
}
/** 고른 것 — 목록 순서(최신 위). 종이는 이걸 뒤집어 옛 장이 왼쪽 */
function _mwnsSorted() {
  var keys = _mwns.list.map(_mwnsKey);
  return _mwns.pick.filter(function (k) { return keys.indexOf(k) >= 0; }).sort(function (a, b) { return keys.indexOf(a) - keys.indexOf(b); });
}
/** 장 수를 바꾸면 — 늘면 고른 것 옆(옛 쪽 먼저) 노트로 채우고, 줄면 옛 쪽부터 뺌 */
function _mwnsFill() {
  var keys = _mwns.list.map(_mwnsKey), pick = _mwnsSorted().slice(0, _mwns.n);
  var last = pick.length ? keys.indexOf(pick[pick.length - 1]) : -1, i;
  for (i = last + 1; pick.length < _mwns.n && i < keys.length; i++) if (pick.indexOf(keys[i]) < 0) pick.push(keys[i]);
  for (i = last - 1; pick.length < _mwns.n && i >= 0; i--) if (pick.indexOf(keys[i]) < 0) pick.push(keys[i]);
  _mwns.pick = pick;
  _mwnsPaintList(); _mwnsLoadPages();
}
function _mwnsToggle(k) {
  var at = _mwns.pick.indexOf(k);
  if (at >= 0) _mwns.pick.splice(at, 1);
  else {
    if (_mwns.pick.length >= _mwns.n) {
      if (_mwns.n < MWN_SPREAD_MAX) _mwnsSetN(_mwns.n + 1);   // 더 고르면 장 수도 늘림 (4장까지)
      else { _mwToast('한 번에 ' + MWN_SPREAD_MAX + '장까지 펼칠 수 있습니다 — 하나를 빼고 고르세요', 'warn'); return; }
    }
    _mwns.pick.push(k);
  }
  _mwnsPaintList(); _mwnsLoadPages();
}
/** ‹ › — 고른 묶음을 목록에서 장 수만큼 통째로 옮김 (d=1 옛 쪽 · -1 새 쪽). 본문을 먼저 받은 뒤 책장 넘기듯 */
function _mwnsFlip(d) {
  if (_mwns.flipping) return;
  var keys = _mwns.list.map(_mwnsKey), cur = _mwnsSorted(), n = _mwns.n;
  var top = cur.length ? keys.indexOf(cur[0]) : 0;
  var start = Math.max(0, Math.min(Math.max(0, keys.length - n), top + d * n));
  if (cur.length === Math.min(n, keys.length) && start === top) { _mwnsBump(d); return; }
  var next = keys.slice(start, start + n), seq = ++_mwns.seq;
  _mwns.flipping = true;
  _mwnsEnsure(next).catch(function () {}).then(function () {
    if (seq !== _mwns.seq || !document.getElementById('mwnsBook')) { _mwns.flipping = false; return; }
    var old = _mwnsSorted().slice().reverse();
    _mwns.pick = next;
    _mwnsPaintList();
    var first = document.querySelector('#mwnsList .mwns-it.on');
    if (first) first.scrollIntoView({ block: 'nearest' });
    _mwnsTurn(d, old, function () { _mwns.flipping = false; });
  });
}
/** 끝에서 더 넘기려 하면 — 종이가 살짝 들렸다 내려앉음 */
function _mwnsBump(d) {
  var book = document.getElementById('mwnsBook');
  var p = book && book.querySelector(d > 0 ? '.mwns-page:first-child' : '.mwns-page:last-child');
  if (!p || _mwnsCalm()) { _mwToast(d > 0 ? '가장 옛 노트입니다' : '가장 최근 노트입니다'); return; }
  p.classList.remove('mwns-bump-l', 'mwns-bump-r'); void p.offsetWidth;
  p.classList.add(d > 0 ? 'mwns-bump-l' : 'mwns-bump-r');
  _mwToast(d > 0 ? '가장 옛 노트입니다' : '가장 최근 노트입니다');
}
function _mwnsCalm() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
/** 책장 넘기기 — 두 장이면 진짜 책처럼 한 장(앞면 = 넘어가는 장, 뒷면 = 새로 보일 장)이 등을 축으로 넘어감.
    3 · 4장이면 종이가 차례로 한 장씩 넘어가며 바뀜. old = 넘기기 전 종이 키(왼→오) */
function _mwnsTurn(d, old, done) {
  var book = document.getElementById('mwnsBook');
  var nowKeys = _mwnsSorted().slice().reverse();
  var olds = book ? book.querySelectorAll('.mwns-page') : [];
  if (!book || _mwnsCalm() || !olds.length) { _mwnsPaintBook(); done(); return; }
  var pair = olds.length === 2 && nowKeys.length === 2 && book.classList.contains('is-pair');
  if (!pair) {
    _mwnsPaintBook();
    var ps = book.querySelectorAll('.mwns-page'), cnt = ps.length;
    ps.forEach(function (p, i) {
      var at = d < 0 ? i : cnt - 1 - i;   // 새 쪽으로 넘기면 왼쪽부터, 옛 쪽이면 오른쪽부터
      p.style.animationDelay = (at * 90) + 'ms';
      p.classList.add(d < 0 ? 'mwns-in-r' : 'mwns-in-l');
    });
    setTimeout(function () { ps.forEach(function (p) { p.classList.remove('mwns-in-r', 'mwns-in-l'); p.style.animationDelay = ''; }); done(); }, 520 + cnt * 90);
    return;
  }
  // 넘어가는 장의 자리 (새 쪽 = 오른쪽 장이 왼쪽으로, 옛 쪽 = 왼쪽 장이 오른쪽으로)
  var fwd = d < 0, from = olds[fwd ? 1 : 0], stay = olds[fwd ? 0 : 1];
  var box = function (el) { return 'left:' + el.offsetLeft + 'px;top:' + el.offsetTop + 'px;width:' + el.offsetWidth + 'px;height:' + el.offsetHeight + 'px'; };
  var fromBox = box(from), stayBox = box(stay);
  var frontHtml = from.outerHTML, coverHtml = stay.outerHTML;
  _mwnsPaintBook();   // 밑에는 이미 새 펼침면
  var nps = book.querySelectorAll('.mwns-page');
  var backHtml = nps[fwd ? 0 : 1].outerHTML;   // 넘어간 장의 뒷면 = 새 펼침면에서 그쪽 장
  // 넘어가는 장이 내려앉기 전까지 반대쪽은 옛 장이 덮고 있음
  var cover = document.createElement('div');
  cover.className = 'mwns-cover'; cover.style.cssText = stayBox; cover.innerHTML = coverHtml;
  var leaf = document.createElement('div');
  leaf.className = 'mwns-leaf ' + (fwd ? 'to-l' : 'to-r'); leaf.style.cssText = fromBox;
  leaf.innerHTML = '<div class="mwns-face front">' + frontHtml + '<i class="mwns-shade"></i></div><div class="mwns-face back">' + backHtml + '<i class="mwns-shade"></i></div>';
  book.appendChild(cover); book.appendChild(leaf);
  book.classList.add('is-turning');
  var fin = false, end = function () {
    if (fin) return; fin = true;
    leaf.remove(); cover.remove(); book.classList.remove('is-turning');
    done();
  };
  leaf.addEventListener('animationend', function (e) { if (e.target === leaf) { cover.remove(); setTimeout(end, 30); } });
  setTimeout(end, 1300);   // 애니메이션 이벤트가 안 와도 풀림
  requestAnimationFrame(function () { leaf.classList.add('go'); });
}
function _mwnsPaintList() {
  var box = document.getElementById('mwnsList');
  if (!box) return;
  var q = _mwns.q, sorted = _mwnsSorted();
  var rows = _mwns.list.filter(function (x) {
    if (!q) return true;
    var k = _mwnsKey(x), body = _mwns.bodies[k];
    return (x.snip || '').toLowerCase().indexOf(q) >= 0 || x.date.indexOf(q) >= 0 || _mwnLabel(x.date).indexOf(q) >= 0 || (body != null && body.toLowerCase().indexOf(q) >= 0);
  });
  box.innerHTML = rows.length ? rows.map(function (x) {
    var k = _mwnsKey(x), on = sorted.indexOf(k) >= 0;
    return '<label class="mwns-it' + (on ? ' on' : '') + '" data-pk="' + _mwEsc(k) + '"><input type="checkbox" tabindex="-1"' + (on ? ' checked' : '') + '>' +
      '<b>' + _mwEsc(_mwnLabel(x.date)) + (x.ref ? ' · 🤝' : '') + '</b><span>' + _mwEsc(x.snip || '') + '</span><i>' + x.lines + '줄</i></label>';
  }).join('') : '<div class="mwn-e">맞는 노트가 없습니다</div>';
  var c = document.getElementById('mwnsCnt');
  if (c) c.textContent = sorted.length + ' / ' + _mwns.n + '장';
}
/** 고른 장의 본문 받기 — 날짜마다 한 번 (그날 회의 메모도 같이 옴) */
function _mwnsLoadPages() {
  var keys = _mwnsSorted(), seq = ++_mwns.seq;
  _mwns.flipping = false;
  _mwnsPaintBook();
  if (keys.every(function (k) { return k in _mwns.bodies; })) return;
  _mwnsEnsure(keys).then(function () { if (seq === _mwns.seq) _mwnsPaintBook(); })
    .catch(function (e) { _mwToast('❌ 노트를 불러오지 못했습니다 — ' + _mwErr(e), 'error'); });
}
/** 본문 받아 두기 — 넘기기 전에 먼저 (뒷면이 '불러오는 중' 이 되지 않게). 다음 묶음도 미리 */
function _mwnsEnsure(keys) {
  var need = {};
  keys.forEach(function (k) { if (!(k in _mwns.bodies)) need[k.split('|')[0]] = 1; });
  return Promise.all(Object.keys(need).map(function (d) {
    return apiFetch('/api/my-work/notes?date=' + d).then(function (r) {
      (r.data.notes || []).forEach(function (n) { _mwns.bodies[d + '|' + (n.ref || '')] = n.body || ''; });
      keys.forEach(function (k) { if (k.split('|')[0] === d && !(k in _mwns.bodies)) _mwns.bodies[k] = ''; });
    });
  }));
}
function _mwnsPaintBook() {
  var book = document.getElementById('mwnsBook');
  if (!book) return;
  var keys = _mwnsSorted().slice().reverse();   // 옛 장이 왼쪽 — 책 넘기는 순서
  book.style.setProperty('--mwns-n', Math.max(1, keys.length));
  book.className = 'mwns-book' + (keys.length === 2 ? ' is-pair' : '');
  if (!keys.length) { book.innerHTML = '<div class="mwns-empty">왼쪽 목록에서 볼 노트를 고르세요 (최대 ' + MWN_SPREAD_MAX + '장)</div>'; return; }
  var last = keys.length - 1;
  book.innerHTML = keys.map(function (k, i) {
    var p = k.split('|'), d = p[0], ref = p[1] || '', body = _mwns.bodies[k];
    var lines = body == null ? null : _mwnParse(body);
    while (lines && lines.length && !lines[lines.length - 1].t && !lines[lines.length - 1].todo) lines.pop();
    return '<article class="mwns-page" data-k="' + _mwEsc(k) + '">' +
      '<header><button type="button" class="mwns-ph" data-s="open" data-k="' + _mwEsc(k) + '" title="이 노트를 📝 서랍에서 열어 고치기"><b>' + _mwEsc(_mwnLabel(d)) + '</b>' + (ref ? '<span>🤝 회의 메모</span>' : '') + '</button>' +
        '<button type="button" class="mwns-x" data-s="drop" data-k="' + _mwEsc(k) + '" title="이 장 빼기">✕</button></header>' +
      '<div class="mwns-lines">' + (lines == null ? '<div class="mwn-e">불러오는 중…</div>' : !lines.length ? '<div class="mwn-e">빈 노트</div>' : lines.map(function (r) {
        return '<div class="mwns-l' + (r.todo ? ' is-todo' : '') + '">' + (r.todo ? '<i>✓</i>' : '') + (_mwEsc(r.t) || '&nbsp;') + '</div>';
      }).join('')) + '</div>' +
      '<footer><span>' + (lines ? lines.filter(function (r) { return r.t; }).length + '줄' : '') + '</span><span>' + (i + 1) + '</span></footer>' +
      // 바깥 모서리 — 마우스를 올리면 살짝 접히고, 누르면 넘김
      (i === 0 ? '<button type="button" class="mwns-corner l" data-s="prev" title="앞 장 (옛 노트)" aria-label="앞 장"></button>' : '') +
      (i === last ? '<button type="button" class="mwns-corner r" data-s="next" title="뒷 장 (새 노트)" aria-label="뒷 장"></button>' : '') +
      '</article>';
  }).join('');
}
/** 손가락 · 마우스로 밀어 넘기기 (종이 위에서 옆으로 60px 넘게) */
function _mwnsSwipe(book) {
  var sx = null, sy = 0;
  book.addEventListener('pointerdown', function (e) {
    if (e.button || e.target.closest('button, a, input')) { sx = null; return; }
    sx = e.clientX; sy = e.clientY;
  });
  book.addEventListener('pointerup', function (e) {
    if (sx == null) return;
    var dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && !(window.getSelection && String(window.getSelection()))) _mwnsFlip(dx < 0 ? -1 : 1);
  });
  book.addEventListener('pointercancel', function () { sx = null; });
}
function _mwnsOpenNote(k) {
  var p = String(k).split('|');
  var m = document.getElementById('mwnSpreadModal');
  if (m) m.remove();
  if (_mwn.open) mwNotesGo(p[0], p[1] || ''); else mwNotesOpen(p[0], p[1] || '');
}
