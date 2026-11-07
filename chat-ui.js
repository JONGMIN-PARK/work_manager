/* chat-ui.js — 💬 사내 메신저 화면 (v13.315)
 *   예전 ✉️ 쪽지 화면(messages-ui.js, v13.315 에 지움)을 대신함 — 같은 #mMessages · renderMessages · msgOpenThread · msgComposeTo · refreshMsgBadge 이름을 덮어씀
 *   서버 /api/chat (server/routes/chat.js) · 실시간은 fetch 스트림(SSE, Authorization 헤더 그대로)
 *   기본: 방 목록(고정 · 알림 끔 · 안 읽음 · @) · 말풍선 · 날짜 줄 · 안 읽은 사람 수 · 입력 중 · 답글 줄기 · 공감 · 공지 · 전달 · 수정/삭제 · 파일(끌어 놓기 · 붙여넣기 · 사진 미리보기) · 찾기
 *   데이터: ＋업무 카드(통합 검색) · 이슈 카드 버튼 · 프로젝트 방 옆 현황 · /todo /issue /ai /요약
 *   화면 공유는 chat-rtc.js
 * 의존(전역): apiFetch, API_BASE, _accessToken, currentUser, eH, showToast, createModal, wmGuardedModal, globalSearchNav, setPage, rMD */
var CX = { rooms: [], room: null, info: null, msgs: [], reads: {}, more: false, users: null, cards: [], replyTo: null, editId: null, thread: null, threadMsgs: [], typing: {}, ctx: null, aside: true, q: '', loading: false, blobs: {} };
var CX_REACTS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '✅', '👀'];
var CX_ICON = { project: '📁', milestone: '🚩', issue: '🐞', order: '📦', meeting: '🗓', mindmap: '🧠', doc: '📄', dev: '🛠', checklist: '☑️', as: '🔧', todo: '✅', note: '📝', weekly: '📅', prestudy: '🔍', tech: '🧪', work: '📒', comment: '💬', member: '👤', message: '✉️', cdoc: '📝' };
var CX_ISSUE = { open: '접수', inProgress: '대응중', resolved: '해결', closed: '종결' };

function _cxMe() { return (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.id || currentUser.sub) : null; }
function _cxE(s) { return typeof eH === 'function' ? eH(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _cxToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _cxErr(e) { return (e && e.data && e.data.message) || (e && e.message) || '실패했습니다'; }
function _cxT(iso) { var d = new Date(iso); return isNaN(d) ? '' : (d.getHours() < 12 ? '오전 ' : '오후 ') + (((d.getHours() + 11) % 12) + 1) + ':' + ('0' + d.getMinutes()).slice(-2); }
function _cxDay(iso) { var d = new Date(iso); return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + '일월화수목금토'[d.getDay()] + '요일'; }
function _cxRel(iso) {
  var d = new Date(iso), n = new Date(); if (isNaN(d)) return '';
  if (d.toDateString() === n.toDateString()) return _cxT(iso);
  var y = new Date(n); y.setDate(n.getDate() - 1); if (d.toDateString() === y.toDateString()) return '어제';
  return d.getFullYear() === n.getFullYear() ? (d.getMonth() + 1) + '/' + d.getDate() : d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate();
}
function _cxSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : n >= 1024 ? Math.round(n / 1024) + 'KB' : n + 'B'; }
function _cxInit(name) { return String(name || '?').trim().slice(0, 1) || '?'; }
function _cxHue(id) { var h = 0; String(id || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }
function _cxAv(id, name, on) { return '<span class="cx-av" style="--h:' + _cxHue(id) + '">' + _cxE(_cxInit(name)) + (on ? '<i class="cx-on"></i>' : '') + '</span>'; }
/* 글 → HTML (이스케이프 뒤 링크 · @멘션 · 줄바꿈) */
function _cxText(s) {
  if (typeof chatCodeText === 'function') return chatCodeText(s);   // v13.358 ``` 코드 블록 · `한 줄 코드`
  var h = _cxE(s || '');
  h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  h = h.replace(/(^|\s)@([^\s@<]{1,20})/g, '$1<b class="cx-at">@$2</b>');
  return h.replace(/\n/g, '<br>');
}

/* ─── 실시간 스트림 ─── */
var CXS = { ctrl: null, on: false, backoff: 1000, timer: null };
function chatStreamStart() {
  if (CXS.on || typeof apiFetch !== 'function' || !_cxMe() || (typeof AUTH_SKIP !== 'undefined' && AUTH_SKIP)) return;
  CXS.on = true;
  var ctrl = CXS.ctrl = new AbortController();
  fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/stream', { headers: { Authorization: 'Bearer ' + (typeof _accessToken !== 'undefined' ? _accessToken : '') }, signal: ctrl.signal, cache: 'no-store' })
    .then(function (res) {
      if (res.status === 401) { CXS.on = false; return apiFetch('/api/chat/unread-count').then(function () { CXS.timer = setTimeout(chatStreamStart, 500); }); }   // 토큰 새로 받고 다시
      if (!res.ok || !res.body) throw new Error('stream ' + res.status);
      CXS.backoff = 1000;
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) throw new Error('closed');
          buf += dec.decode(r.value, { stream: true });
          var i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            var chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            var ev = 'message', data = '';
            chunk.split('\n').forEach(function (l) { if (l.indexOf('event: ') === 0) ev = l.slice(7); else if (l.indexOf('data: ') === 0) data += l.slice(6); });
            if (data) { try { chatOnEvent(ev, JSON.parse(data)); } catch (e) { console.warn('[chat] event', e); } }
          }
          return pump();
        });
      }
      return pump();
    })
    .catch(function () {})
    .then(function () {
      if (ctrl.signal.aborted) return;
      CXS.on = false;
      clearTimeout(CXS.timer);
      CXS.timer = setTimeout(chatStreamStart, CXS.backoff);
      CXS.backoff = Math.min(30000, CXS.backoff * 2);
    });
}
function chatStreamStop() { CXS.on = false; clearTimeout(CXS.timer); if (CXS.ctrl) CXS.ctrl.abort(); }
/* 로그인되면 붙고, 나가면 끊고 */
setInterval(function () { if (_cxMe()) { if (!CXS.on) chatStreamStart(); } else if (CXS.on) chatStreamStop(); }, 2000);

function _cxVisibleRoom(id) {
  var page = document.getElementById('mMessages');
  return CX.room === id && page && !page.classList.contains('hidden') && !document.hidden;
}
function chatOnEvent(ev, d) {
  if (ev === 'hello') { if (CX.rooms.length) _cxLoadRooms(); else chatBadge(); return; }   // (다시) 붙으면 놓친 것 반영
  if (ev === 'msg') {
    var mine = d.userId === _cxMe();
    var r = CX.rooms.filter(function (x) { return x.id === d.roomId; })[0];
    if (r) {
      r.lastAt = d.at; r.last = { userName: d.userName, body: d.deleted ? '(지운 메시지)' : d.post ? '📌 ' + d.post.title : d.file && !d.body ? '📎 ' + d.file.name : d.body, mine: mine, kind: d.kind };
      if (!mine && !d.replyTo && d.kind !== 'system' && !_cxVisibleRoom(d.roomId)) { r.unread = (r.unread || 0) + 1; if ((d.mentions || []).indexOf(_cxMe()) >= 0) r.mentioned = (r.mentioned || 0) + 1; }
      CX.rooms.sort(function (a, b) { return (b.pinned - a.pinned) || (new Date(b.lastAt) - new Date(a.lastAt)); });
    } else _cxLoadRooms();
    if (CX.room === d.roomId) {
      if (d.replyTo) { if (CX.thread === d.replyTo) { CX.threadMsgs.push(d); _cxDrawThread(true); } }
      else { _cxUpsert(d); _cxDrawMsgs(true); }
      if (_cxVisibleRoom(d.roomId)) _cxMarkRead();
    }
    if (CX.typing[d.roomId]) { delete CX.typing[d.roomId][d.userId || 'ai']; _cxDrawTyping(); }
    if (CX.room === d.roomId && (d.kind === 'system' || (d.cards || []).some(function (c) { return c.type === 'issue'; }))) _cxCtxRefresh();
    _cxDrawRooms();
    chatBadge();
    if (d.post && CX.aside && CX.asideTab === 'board' && CX.room === d.roomId && typeof chatPostsTab === 'function') chatPostsTab();
    if (!mine && d.kind !== 'system' && !_cxVisibleRoom(d.roomId) && !(r && r.muted && (d.mentions || []).indexOf(_cxMe()) < 0)) _cxNotify(d, r);
  } else if (ev === 'upd') {
    if (d.post && typeof chatCollabOnUpd === 'function') chatCollabOnUpd(d);
    if (CX.room === d.roomId && (d.cards || []).some(function (c) { return c.type === 'issue'; })) _cxCtxRefresh();
    if (CX.room === d.roomId) {
      if (d.replyTo && CX.thread === d.replyTo) { CX.threadMsgs = CX.threadMsgs.map(function (m) { return m.id === d.id ? d : m; }); _cxDrawThread(); }
      if (CX.thread === d.id && CX.threadMsgs.length) { CX.threadMsgs[0] = d; _cxDrawThread(); }
      if (!d.replyTo && _cxUpsert(d, true)) _cxDrawMsgs();
    }
  } else if (ev === 'read') {
    if (CX.room === d.roomId) { CX.reads[d.userId] = Math.max(CX.reads[d.userId] || 0, d.id); _cxDrawReadCounts(); }
    if (d.userId === _cxMe()) { var rr = CX.rooms.filter(function (x) { return x.id === d.roomId; })[0]; if (rr) { rr.unread = 0; rr.mentioned = 0; _cxDrawRooms(); chatBadge(); } }
  } else if (ev === 'typing') {
    if (d.userId === _cxMe()) return;
    var t = CX.typing[d.roomId] = CX.typing[d.roomId] || {};
    t[d.userId] = { name: d.name, until: Date.now() + (d.userId === 'ai' ? 60000 : 5000) };
    _cxDrawTyping();
    setTimeout(_cxDrawTyping, 5200);
  } else if (ev === 'presence') {
    CX.rooms.forEach(function (r) { if (r.peerId === d.userId) r.online = d.online; });
    if (CX.info) CX.info.members.forEach(function (m) { if (m.id === d.userId) m.online = d.online; });
    if (CX.users) CX.users.forEach(function (u) { if (u.id === d.userId) u.online = d.online; });
    _cxDrawRooms(); _cxDrawHead(); _cxDrawAside();
  } else if (ev === 'notice') {
    if (CX.room === d.roomId && CX.info) { CX.info.notice = d.notice; _cxDrawNotice(); }
  } else if (ev === 'room') {   // v13.359 역할 · 내보내기
    if (d.removed && d.removed === _cxMe()) { CX.rooms = CX.rooms.filter(function (r) { return r.id !== d.roomId; }); if (CX.room === d.roomId) { CX.room = null; _cxDrawMain(); } _cxDrawRooms(); _cxToast('대화방에서 내보내졌습니다', 'warn'); return; }
    if (CX.room === d.roomId) apiFetch('/api/chat/rooms/' + encodeURIComponent(d.roomId)).then(function (r) { if (CX.room !== d.roomId) return; var was = CX.info && CX.info.myRole; CX.info = r.data; _cxDrawHead(); _cxDrawAside(); if (was !== CX.info.myRole) { _cxDrawMain(); _cxDrawHead(); _cxDrawNotice(); _cxDrawMsgs(); } }).catch(function () {});
  } else if (ev === 'focus') {   // v13.363 🎯
    if (typeof chatFocusOnEvent === 'function') chatFocusOnEvent(d);
  } else if (ev === 'remind' || ev === 'sched') {   // v13.362 ⏰
    if (typeof chatTimeOnEvent === 'function') chatTimeOnEvent(ev, d);
  } else if (ev === 'doc' || ev === 'doc-cur') {   // v13.360 📝 공동 문서
    if (typeof chatDocOnEvent === 'function') chatDocOnEvent(ev, d);
  } else if (ev === 'folder') {
    if (typeof chatCollabOnFolder === 'function') chatCollabOnFolder(d);
  } else if (ev === 'annot' || ev === 'annot-cur') {
    if (typeof chatBoardOnEvent === 'function') chatBoardOnEvent(ev, d);
  } else if (ev === 'rtc') {
    if (typeof chatCallOnSignal === 'function' && chatCallOnSignal(d)) return;   // v13.361 📞 통화 신호
    if (typeof chatRtcOnSignal === 'function') chatRtcOnSignal(d);
  }
}
/* 보낸 응답으로는 없을 때만 넣음 — 실시간으로 먼저 온 더 새 모습(공감 · 수정)을 옛 응답이 덮지 않게 */
function _cxAddIfNew(m) { if (CX.msgs.some(function (x) { return x.id === m.id; })) return false; CX.msgs.push(m); return true; }
function _cxUpsert(m, onlyReplace) {
  for (var i = CX.msgs.length - 1; i >= 0; i--) if (CX.msgs[i].id === m.id) { CX.msgs[i] = m; return true; }
  if (onlyReplace) return false;
  CX.msgs.push(m); return true;
}

/* 새 메시지 알림 — 화면 안 작은 창(누르면 그 방) · 탭이 가려져 있으면 브라우저 알림 */
function _cxNotify(d, r) {
  if (typeof chatFocusMute === 'function' && chatFocusMute(d)) return;   // v13.363 🎯 집중 중이면 미룸
  var title = (r && r.kind !== 'dm' ? r.name + ' · ' : '') + (d.userName || 'AI');
  var body = d.file && !d.body ? '📎 ' + d.file.name : (d.body || '').slice(0, 120);
  // v13.355 PC 앱: 창이 앞에 없으면(다른 프로그램 작업 중 · 트레이) 윈도우 알림 — 누르면 창이 앞으로 + 그 방으로
  if (typeof wmIsDesktopApp === 'function' && wmIsDesktopApp() && !document.hasFocus()) { wmAppNotify('💬 ' + title, body, 'chat:' + d.roomId); return; }
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { var n = new Notification('💬 ' + title, { body: body, tag: 'chat-' + d.roomId, renotify: true }); n.onclick = function () { window.focus(); chatOpenRoom(d.roomId); n.close(); }; } catch (e) {}
    return;
  }
  var box = document.getElementById('cxPop');
  if (!box) { box = document.createElement('div'); box.id = 'cxPop'; box.className = 'cx-pops'; document.body.appendChild(box); }
  var p = document.createElement('button'); p.type = 'button'; p.className = 'cx-pop';
  p.innerHTML = _cxAv(d.userId, d.userName) + '<span><b></b><i></i></span>';
  p.querySelector('b').textContent = title; p.querySelector('i').textContent = body;
  p.addEventListener('click', function () { chatOpenRoom(d.roomId); p.remove(); });
  box.appendChild(p);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(function () { p.classList.add('out'); setTimeout(function () { p.remove(); }, 300); }, 6000);
}

/* ─── 뱃지 ─── */
function chatBadge() {
  var b = document.getElementById('msgBadge'); if (!b) return;
  var n = CX.rooms.length ? CX.rooms.reduce(function (s, r) { return s + (r.muted && !r.mentioned ? 0 : r.unread || 0); }, 0) : null;
  function set(k) { if (typeof wmAppBadge === 'function') wmAppBadge(k); if (k > 0) { b.textContent = k > 99 ? '99+' : k; b.style.display = 'inline-flex'; } else b.style.display = 'none'; }
  if (n != null) return set(n);
  if (typeof apiFetch === 'function' && _cxMe()) apiFetch('/api/chat/unread-count').then(function (r) { set((r && r.count) || 0); }).catch(function () {});
}
function refreshMsgBadge() { if (!CX.rooms.length) chatBadge(); else _cxLoadRooms(); }

/* ─── 화면 틀 ─── */
function renderMessages() {
  var el = document.getElementById('mMessages'); if (!el) return;
  if (!el.querySelector('.cx')) {
    el.innerHTML = '<div class="cx no-aside' + (CX.room ? ' has-room' : '') + '">' +
      '<aside class="cx-side"><div class="cx-side-h"><b>💬 메신저</b><span class="cx-side-a"><button type="button" class="cx-ib" id="cxFocus" title="🎯 집중 모드 — 방해 금지 · 메신저만 크게">🎯</button><button type="button" class="cx-ib" id="cxReqs" title="🛠 요청함 — 나에게 온 · 내가 올린 요청">🛠</button><button type="button" class="cx-ib" id="cxFolders" title="📁 내 폴더 — 모아 둔 메시지 · 사진 · 파일">📂</button><button type="button" class="cx-ib" id="cxNew" title="새 대화 (사람 · 그룹 · 프로젝트 방)">＋</button></span></div>' +
      '<div class="cx-sq"><input id="cxQ" type="search" placeholder="대화방 · 메시지 찾기" aria-label="대화방 · 메시지 찾기"></div>' +
      '<div class="cx-perm" id="cxPerm" hidden><span>🔔 앱을 닫아 두어도 새 메시지 알림을 받을까요?</span><button type="button" id="cxPermOn">알림 켜기</button></div>' +
      '<div class="cx-rooms" id="cxRooms" role="list"></div></aside>' +
      '<section class="cx-main" id="cxMain"></section>' +
      '<aside class="cx-aside" id="cxAside"></aside></div>';
    el.querySelector('#cxNew').addEventListener('click', chatNewModal);
    if (typeof chatFocusMenu === 'function') { el.querySelector('#cxFocus').addEventListener('click', function (e) { chatFocusMenu(e.currentTarget); }); if (!CX.focusInit) { CX.focusInit = true; chatFocusInit(); } }
    if (typeof chatLibrary === 'function') { el.querySelector('#cxReqs').addEventListener('click', function () { chatLibrary('reqs'); }); el.querySelector('#cxFolders').addEventListener('click', function () { chatLibrary('folders'); }); }
    var q = el.querySelector('#cxQ'), qt;
    q.addEventListener('input', function () { CX.q = q.value.trim(); clearTimeout(qt); qt = setTimeout(_cxSearch, 250); _cxDrawRooms(); });
    if ('Notification' in window && Notification.permission === 'default') el.querySelector('#cxPerm').hidden = false;
    el.querySelector('#cxPermOn').addEventListener('click', function () { (typeof wmPushEnable === 'function' ? wmPushEnable() : Notification.requestPermission()).then(function () { el.querySelector('#cxPerm').hidden = true; }); });   // v13.359 앱을 닫아도 오게 푸시까지
  }
  if (typeof _cfBar === 'function') _cfBar();
  var want = CX.pending || CX.room, wantMid = CX.pendingMid; CX.pending = null; CX.pendingMid = null;
  _cxLoadRooms().then(function () { if (want) chatOpenRoom(want, false, wantMid); else if (window.innerWidth > 760 && CX.rooms[0]) chatOpenRoom(CX.rooms[0].id); else _cxDrawMain(); });
}
function _cxLoadRooms() {
  return apiFetch('/api/chat/rooms').then(function (r) { CX.rooms = (r && r.data) || []; _cxDrawRooms(); chatBadge(); }).catch(function () {});
}
function _cxDrawRooms() {
  var box = document.getElementById('cxRooms'); if (!box) return;
  var q = CX.q.toLowerCase();
  var list = CX.rooms.filter(function (r) { return !q || (r.name || '').toLowerCase().indexOf(q) >= 0; });
  var h = list.map(function (r) {
    var ic = r.kind === 'project' ? '<span class="cx-av cx-av-p">📁</span>' : r.kind === 'group' ? '<span class="cx-av cx-av-g">👥</span>' : _cxAv(r.peerId, r.name, r.online);
    var last = r.last ? (r.kind !== 'dm' && r.last.kind !== 'system' && !r.last.mine ? r.last.userName + ': ' : r.last.mine ? '나: ' : '') + (r.last.body || '') : '';
    return '<button type="button" class="cx-r' + (r.id === CX.room ? ' on' : '') + (r.unread ? ' has-un' : '') + '" data-room="' + _cxE(r.id) + '" role="listitem">' + ic +
      '<span class="cx-r-t"><b>' + _cxE(r.name) + (r.kind !== 'dm' ? ' <i>' + r.members + '</i>' : '') + (r.pinned ? ' 📌' : '') + (r.muted ? ' 🔕' : '') + (r.peerFocus && new Date(r.peerFocus) > new Date() ? ' <em class="cf-tag" title="' + _cxE(typeof chatFocusLabel === 'function' ? chatFocusLabel(r.peerFocus) : '') + '">🎯</em>' : '') + '</b><span>' + _cxE(last) + '</span></span>' +
      '<span class="cx-r-m"><i>' + (r.lastAt ? _cxRel(r.lastAt) : '') + '</i>' + (r.mentioned ? '<em class="cx-at-b">@</em>' : '') + (r.unread ? '<em class="' + (r.muted ? 'mute' : '') + '">' + (r.unread > 99 ? '99+' : r.unread) + '</em>' : '') + '</span></button>';
  }).join('');
  if (CX.q && CX.found) h += '<div class="cx-found-h">메시지 ' + CX.found.length + '건</div>' + CX.found.map(function (m) {
    var r = CX.rooms.filter(function (x) { return x.id === m.roomId; })[0];
    return '<button type="button" class="cx-found" data-room="' + _cxE(m.roomId) + '" data-mid="' + m.id + '"><b>' + _cxE(r ? r.name : '') + ' · ' + _cxE(m.userName || '') + '</b><span>' + _cxE((m.body || (m.file ? m.file.name : '')).slice(0, 90)) + '</span><i>' + _cxRel(m.at) + '</i></button>';
  }).join('');
  if (!h) h = '<div class="cx-empty">' + (CX.q ? '찾는 대화가 없습니다' : '아직 대화가 없습니다 — ＋ 로 시작해 보세요') + '</div>';
  box.innerHTML = h;
  if (!box._bound) { box._bound = true; box.addEventListener('click', function (e) { var b = e.target.closest('[data-room]'); if (b) chatOpenRoom(b.dataset.room, false, b.dataset.mid ? +b.dataset.mid : null); }); }
}
function _cxSearch() {
  if (CX.q.length < 2) { CX.found = null; _cxDrawRooms(); return; }
  var q = CX.q;
  apiFetch('/api/chat/search?q=' + encodeURIComponent(q)).then(function (r) { if (q !== CX.q) return; CX.found = (r && r.data) || []; _cxDrawRooms(); }).catch(function () {});
}

/* ─── 방 열기 ─── */
function chatOpenRoom(id, keep, focusMid) {
  if (typeof setPage === 'function' && document.getElementById('mMessages') && document.getElementById('mMessages').classList.contains('hidden')) { CX.pending = id; CX.pendingMid = focusMid || null; setPage('messages'); return; }
  var changed = CX.room !== id;
  CX.room = id;
  // 방이 바뀌면 그 방 것만 — 예전 방의 답글 줄기 · 고른 카드 · 수정 중 · 옆 탭은 비움
  if (changed) { CX.msgs = []; CX.info = null; CX.ctx = null; CX.cards = []; CX.replyTo = null; CX.editId = null; CX.thread = null; CX.threadMsgs = []; CX.asideTab = null; }
  if (changed && window.innerWidth <= 980) CX.aside = false;   // 좁은 화면은 옆 칸이 대화를 덮으므로 닫고 시작 (📊 · ⓘ 로 열기)
  var root = document.querySelector('#mMessages .cx'); if (root) root.classList.add('has-room');
  _cxDrawRooms(); _cxDrawMain();
  var my = id;
  Promise.all([apiFetch('/api/chat/rooms/' + encodeURIComponent(id)), apiFetch('/api/chat/rooms/' + encodeURIComponent(id) + '/messages' + (focusMid ? '?around=' + focusMid : ''))]).then(function (rs) {
    if (CX.room !== my) return;
    CX.info = rs[0].data; CX.msgs = rs[1].data || []; CX.more = !!rs[1].more;
    CX.reads = {}; (rs[1].reads || []).forEach(function (x) { CX.reads[x.userId] = x.id; });
    if (CX.info.myRole === 'readonly') _cxDrawMain();   // 읽기만 — 입력칸 대신 안내
    var _readBefore = CX.info.lastReadId || 0;
    _cxDrawHead(); _cxDrawNotice(); _cxDrawMsgs(false, focusMid); _cxMarkRead(); _cxDrawAside();
    if (CX.openThread) { var th = CX.openThread; CX.openThread = null; chatOpenThread(th); }
    if (typeof chatTimeStrip === 'function') chatTimeStrip();   // ⏰ 이 방 예약
    if (typeof chatSmartCatchup === 'function' && !focusMid) chatSmartCatchup(_readBefore);   // ✨ 안 읽은 게 많으면 요약 띠   // 요청함 · 폴더에서 글 열기
    if (CX.info.kind === 'project') apiFetch('/api/chat/rooms/' + encodeURIComponent(id) + '/context').then(function (c) { if (CX.room === my) { CX.ctx = c.data; _cxDrawAside(); } }).catch(function () {});
    var ta = document.getElementById('cxIn'); if (ta && window.innerWidth > 760) ta.focus();
  }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
}
function _cxMarkRead() {
  var last = CX.msgs.length ? CX.msgs[CX.msgs.length - 1].id : 0;
  var r = CX.rooms.filter(function (x) { return x.id === CX.room; })[0];
  if (!last || (CX.reads[_cxMe()] || 0) >= last) { if (r && r.unread) { r.unread = 0; _cxDrawRooms(); chatBadge(); } return; }
  CX.reads[_cxMe()] = last;
  if (r) { r.unread = 0; r.mentioned = 0; _cxDrawRooms(); chatBadge(); }
  apiFetch('/api/chat/rooms/' + encodeURIComponent(CX.room) + '/read', { method: 'POST', body: JSON.stringify({ lastId: last }) }).catch(function () {});
}
document.addEventListener('visibilitychange', function () { if (!document.hidden && CX.room && _cxVisibleRoom(CX.room)) _cxMarkRead(); });

function _cxDrawMain() {
  var m = document.getElementById('cxMain'); if (!m) return;
  var root = document.querySelector('#mMessages .cx'); if (root && !CX.room) root.classList.add('no-aside');
  if (!CX.room) { m.innerHTML = '<div class="cx-blank"><div>💬</div><b>대화를 고르거나 새로 시작하세요</b><span>업무 카드 · 프로젝트 방 현황 · /ai 로 데이터에 바로 묻기</span></div>'; return; }
  m.innerHTML = '<header class="cx-h" id="cxHead"></header><div class="cx-notice" id="cxNotice" hidden></div>' +
    '<div class="cx-msgs" id="cxMsgs" tabindex="0" aria-live="polite"><div class="cx-loading">불러오는 중…</div></div>' +
    '<div class="cx-typing" id="cxTyping"></div>' + (CX.info && CX.info.myRole === 'readonly' ? '<div class="cx-ro">👁 읽기만 하는 멤버입니다 — 글 · 파일을 올리려면 방장에게 말해 주세요</div>' : _cxComposerHtml('cxIn', 'cxComp')) +
    '<div class="cx-drop" id="cxDrop" hidden>여기에 놓으면 보냅니다</div>';
  _cxBindComposer('cxIn', 'cxComp', false);
  var box = m.querySelector('#cxMsgs');
  box.addEventListener('scroll', function () { if (box.scrollTop < 60 && CX.more && !CX.loading) _cxLoadOlder(); });
  box.addEventListener('click', _cxMsgClick);
  // 끌어 놓기
  var dz = m.querySelector('#cxDrop'), dc = 0;
  m.addEventListener('dragenter', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { dc++; dz.hidden = false; e.preventDefault(); } });
  m.addEventListener('dragover', function (e) { if (!dz.hidden) e.preventDefault(); });
  m.addEventListener('dragleave', function () { if (--dc <= 0) { dc = 0; dz.hidden = true; } });
  m.addEventListener('drop', function (e) { if (dz.hidden) return; e.preventDefault(); e.stopPropagation(); dc = 0; dz.hidden = true; _cxUpload(Array.prototype.slice.call(e.dataTransfer.files || [])); }, true);
}
function _cxDrawHead() {
  var h = document.getElementById('cxHead'); if (!h || !CX.info) return;
  var r = CX.rooms.filter(function (x) { return x.id === CX.room; })[0] || {};
  var i = CX.info, others = i.members.filter(function (m) { return !m.me; });
  var on = others.filter(function (m) { return m.online; }).length;
  var name = i.kind === 'dm' ? (others[0] ? others[0].name : '') : (i.name || r.name || '');
  var sub = i.kind === 'dm' ? (others[0] ? (others[0].focusUntil && typeof chatFocusLabel === 'function' && chatFocusLabel(others[0].focusUntil) ? chatFocusLabel(others[0].focusUntil) + ' — 급하면 @멘션' : (others[0].online ? '● 접속 중' : '접속 안 함')) + (others[0].dept ? ' · ' + others[0].dept : '') : '') : i.members.length + '명 · 접속 ' + (on + 1) + (others.some(function (m) { return m.focusUntil && new Date(m.focusUntil) > new Date(); }) ? ' · 🎯 집중 ' + others.filter(function (m) { return m.focusUntil && new Date(m.focusUntil) > new Date(); }).length : '');
  h.innerHTML = '<button type="button" class="cx-ib cx-back" data-h="back" aria-label="목록으로">‹</button>' +
    (i.kind === 'project' ? '<span class="cx-av cx-av-p">📁</span>' : i.kind === 'group' ? '<span class="cx-av cx-av-g">👥</span>' : _cxAv(others[0] && others[0].id, name, others[0] && others[0].online)) +
    '<span class="cx-h-t"><b>' + _cxE(name) + '</b><span class="' + (i.kind === 'dm' && others[0] && others[0].online ? 'on' : '') + '">' + _cxE(sub) + '</span></span>' +
    '<span class="cx-h-a">' +
      (typeof chatCallStart === 'function' && i.myRole !== 'readonly' ? '<button type="button" class="cx-ib" data-h="call" title="음성 통화">📞</button><button type="button" class="cx-ib" data-h="vcall" title="영상 통화">🎥</button>' : '') +
      '<button type="button" class="cx-ib" data-h="share" title="화면 공유">🖥</button>' +
      '<button type="button" class="cx-ib" data-h="files" title="파일 모음">📎</button>' +
      '<button type="button" class="cx-ib' + (CX.aside ? ' on' : '') + '" data-h="aside" title="' + (i.kind === 'project' ? '프로젝트 현황' : '대화 정보') + '">' + (i.kind === 'project' ? '📊' : 'ⓘ') + '</button>' +
      '<button type="button" class="cx-ib" data-h="more" title="더보기">⋯</button></span>';
  h.querySelectorAll('[data-h]').forEach(function (b) { b.addEventListener('click', function () { _cxHeadAct(b.dataset.h, b); }); });
}
function _cxHeadAct(k, btn) {
  if ((k === 'call' || k === 'vcall') && typeof chatCallStart === 'function') { chatCallStart(CX.room, k === 'vcall'); return; }   // v13.361
  if (k === 'back') { var root = document.querySelector('#mMessages .cx'); if (root) { root.classList.remove('has-room'); root.classList.add('no-aside'); } CX.room = null; CX.thread = null; _cxDrawRooms(); return; }
  if (k === 'aside') { CX.aside = !CX.aside; document.querySelector('#mMessages .cx').classList.toggle('no-aside', !CX.aside); _cxDrawHead(); _cxDrawAside(); return; }
  if (k === 'files') { CX.aside = true; CX.asideTab = 'files'; document.querySelector('#mMessages .cx').classList.remove('no-aside'); _cxDrawAside(); return; }
  if (k === 'share') { if (typeof chatRtcShare === 'function') chatRtcShare(CX.room); return; }
  if (k === 'more') {
    var r = CX.rooms.filter(function (x) { return x.id === CX.room; })[0] || {};
    _cxMenu(btn, [
      [r.pinned ? '📌 고정 풀기' : '📌 맨 위에 고정', function () { _cxRoomPut({ pinned: !r.pinned }); }],
      [r.muted ? '🔔 알림 켜기' : '🔕 알림 끄기 (@멘션만)', function () { _cxRoomPut({ muted: !r.muted }); }],
      CX.info.kind !== 'dm' ? ['➕ 사람 초대', chatInviteModal] : null,
      CX.info.kind === 'group' ? ['✏️ 방 이름 바꾸기', function () { var n = prompt('방 이름', CX.info.name || ''); if (n != null) _cxRoomPut({ name: n }); }] : null,
      ['✨ 대화 요약 (AI)', function () { _cxSend('/요약'); }],
      CX.info.kind !== 'dm' ? ['🚪 나가기', function () { if (!confirm('이 대화방에서 나갈까요?')) return; apiFetch('/api/chat/rooms/' + CX.room + '/members/me', { method: 'DELETE' }).then(function () { CX.room = null; renderMessages(); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); }); }] : null
    ].filter(Boolean));
  }
}
function _cxRoomPut(b) {
  apiFetch('/api/chat/rooms/' + CX.room, { method: 'PUT', body: JSON.stringify(b) }).then(function () {
    var r = CX.rooms.filter(function (x) { return x.id === CX.room; })[0];
    if (r) { if ('pinned' in b) r.pinned = b.pinned; if ('muted' in b) r.muted = b.muted; if ('name' in b) r.name = b.name; }
    if ('name' in b && CX.info) CX.info.name = b.name;
    CX.rooms.sort(function (x, y) { return (y.pinned - x.pinned) || (new Date(y.lastAt) - new Date(x.lastAt)); });
    _cxDrawRooms(); _cxDrawHead(); chatBadge();
  }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
}
function _cxDrawNotice() {
  var n = document.getElementById('cxNotice'); if (!n) return;
  var m = CX.info && CX.info.notice;
  n.hidden = !m;
  if (!m) return;
  n.innerHTML = '<span>📢</span><button type="button" class="cx-notice-t" data-go="' + m.id + '"></button><button type="button" class="cx-ib" data-off title="공지 내리기">✕</button>';
  n.querySelector('.cx-notice-t').textContent = (m.userName ? m.userName + ': ' : '') + (m.body || (m.file ? m.file.name : ''));
  n.querySelector('[data-go]').addEventListener('click', function () { _cxJump(m.id); });
  n.querySelector('[data-off]').addEventListener('click', function () { apiFetch('/api/chat/rooms/' + CX.room + '/notice', { method: 'POST', body: JSON.stringify({ messageId: null }) }).catch(function (e) { _cxToast(_cxErr(e), 'error'); }); });
}
function _cxDrawTyping() {
  var el = document.getElementById('cxTyping'); if (!el) return;
  var t = CX.typing[CX.room] || {}, now = Date.now();
  var names = Object.keys(t).filter(function (k) { return t[k].until > now; }).map(function (k) { return t[k].name || 'AI'; });
  el.innerHTML = names.length ? '<i></i><i></i><i></i> ' + _cxE(names.slice(0, 3).join(', ')) + (names.indexOf('AI') >= 0 && names.length === 1 ? ' 가 데이터를 살펴보는 중…' : ' 님이 입력 중…') : '';
}

/* ─── 메시지 그리기 ─── */
function _cxUnreadOf(m) {
  if (!CX.info || m.kind === 'system') return 0;
  var n = 0;
  CX.info.members.forEach(function (u) { if (u.id !== m.userId && (CX.reads[u.id] || 0) < m.id) n++; });
  return n;
}
function _cxMsgHtml(m, prev, inThread) {
  var mine = m.userId === _cxMe(), h = '';
  if (!prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString()) h += '<div class="cx-day"><span>' + _cxDay(m.at) + '</span></div>';
  if (m.kind === 'system') return h + '<div class="cx-sys" data-mid="' + m.id + '">' + _cxText(m.body) + '</div>';
  var cont = prev && prev.userId === m.userId && prev.kind !== 'system' && (new Date(m.at) - new Date(prev.at)) < 5 * 60000 && new Date(prev.at).toDateString() === new Date(m.at).toDateString();
  var ai = m.kind === 'ai';
  var body = '';
  if (m.deleted) body = '<div class="cx-b cx-del">삭제된 메시지입니다</div>';
  else {
    if (m.post && typeof chatPostHtml === 'function') body += chatPostHtml(m, { full: inThread });   // v13.358 📌 게시판 글
    else if (m.body) body += '<div class="cx-b' + (ai ? ' cx-ai' : '') + '">' + (ai ? '<div class="cx-ai-h">🤖 AI · 내가 볼 수 있는 데이터로 답함</div>' + (typeof rMD === 'function' ? rMD(_cxE(m.body)) : _cxText(m.body)) : _cxText(m.body)) + (m.edited ? '<i class="cx-ed">수정됨</i>' : '') + '</div>';
    if (m.file) body += _cxFileHtml(m.file);
    if (m.cards && m.cards.length) body += '<div class="cx-cards">' + m.cards.map(function (c, i) { return _cxCardHtml(c, i, m); }).join('') + '</div>';
  }
  var rx = m.reactions ? Object.keys(m.reactions).map(function (e) { var l = m.reactions[e]; return '<button type="button" class="cx-rx' + (l.indexOf(_cxMe()) >= 0 ? ' on' : '') + '" data-rx="' + e + '" title="' + _cxE(_cxNames(l)) + '">' + e + ' ' + l.length + '</button>'; }).join('') : '';
  var un = _cxUnreadOf(m);
  var meta = '<span class="cx-meta"><em class="cx-un" data-un="' + m.id + '">' + (un || '') + '</em><i>' + _cxT(m.at) + '</i></span>';
  h += '<div class="cx-m' + (mine ? ' mine' : '') + (cont ? ' cont' : '') + (ai ? ' is-ai' : '') + '" data-mid="' + m.id + '">' +
    (!mine && !cont ? (ai ? '<span class="cx-av cx-av-ai">🤖</span>' : _cxAv(m.userId, m.userName)) : (!mine ? '<span class="cx-av-sp"></span>' : '')) +
    '<div class="cx-col">' + (!mine && !cont ? '<div class="cx-who">' + _cxE(ai ? 'AI' : m.userName) + '</div>' : '') +
    '<div class="cx-row">' + (mine ? meta : '') + '<div class="cx-bw">' + body + '</div>' + (!mine ? meta : '') +
    (m.deleted ? '' : '<span class="cx-acts"><button type="button" data-a="react" title="공감">😊</button>' + (inThread ? '' : '<button type="button" data-a="reply" title="답글">↩</button>') + '<button type="button" data-a="more" title="더보기">⋯</button></span>') + '</div>' +
    (rx ? '<div class="cx-rxs">' + rx + '</div>' : '') +
    (!inThread && m.replies ? '<button type="button" class="cx-th" data-a="reply">💬 답글 ' + m.replies + ' · ' + _cxRel(m.lastReplyAt) + '</button>' : '') +
    '</div></div>';
  return h;
}
function _cxNames(ids) {
  var mm = (CX.info && CX.info.members) || [];
  return ids.map(function (id) { var u = mm.filter(function (x) { return x.id === id; })[0]; return u ? u.name : ''; }).filter(Boolean).join(', ');
}
function _cxFileHtml(f) {
  var img = /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(f.mime || '');
  if (img) return '<button type="button" class="cx-img" data-file="' + _cxE(f.id) + '" data-img="1" title="' + _cxE(f.name) + '"><img alt="' + _cxE(f.name) + '" data-blob="' + _cxE(f.id) + '"></button>';
  var ext = ((/\.([A-Za-z0-9]{1,6})$/.exec(f.name) || [])[1] || 'FILE').toUpperCase();
  return '<div class="cx-file"><span class="cx-fx">' + _cxE(ext) + '</span><span class="cx-fn"><b>' + _cxE(f.name) + '</b><i>' + _cxSize(f.size || 0) + '</i></span>' +
    '<button type="button" class="cx-ib" data-file="' + _cxE(f.id) + '" data-dl="1" title="받기">⬇</button>' +
    (CX.info && CX.info.kind === 'project' ? '<button type="button" class="cx-ib" data-todoc="' + _cxE(f.id) + '" title="프로젝트 문서로 보내기">📂</button>' : '') + '</div>';
}
function _cxCardHtml(c, i, m) {
  if (c.type === 'call' && typeof chatCallCardHtml === 'function') return chatCallCardHtml(c, m);
  if (c.type === 'share') {
    var live = c.on && typeof chatRtcIsLive === 'function' && chatRtcIsLive(c.id);
    return '<div class="cx-card cx-share"><span>🖥</span><span class="cx-card-t"><b>' + (c.on ? '화면 공유' : '화면 공유 끝남') + '</b><i>' + _cxE(m.userName) + '</i></span>' +
      (c.on && c.from !== _cxMe() ? '<button type="button" class="wm-pri" data-watch="' + _cxE(c.id) + '" data-from="' + _cxE(c.from) + '">' + (live ? '다시 보기' : '보기') + '</button>' : '') + '</div>';
  }
  var st = c.type === 'issue' && c.status ? '<em class="cx-st st-' + _cxE(c.status) + '">' + (CX_ISSUE[c.status] || c.status) + '</em>' + (c.urgency === 'urgent' ? '<em class="cx-st st-urg">긴급</em>' : '') : '';
  var acts = c.type === 'issue' && !m.deleted ? '<span class="cx-card-a">' +
    (c.status !== 'inProgress' && c.status !== 'resolved' && c.status !== 'closed' ? '<button type="button" data-act="inProgress" data-ci="' + i + '">대응 시작</button>' : '') +
    (c.status !== 'resolved' && c.status !== 'closed' ? '<button type="button" data-act="resolved" data-ci="' + i + '">해결</button>' : '<button type="button" data-act="open" data-ci="' + i + '">다시 열기</button>') +
    (c.urgency !== 'urgent' && c.status !== 'resolved' && c.status !== 'closed' ? '<button type="button" data-act="urgent" data-ci="' + i + '">🔴 긴급</button>' : '') + '</span>' : '';
  return '<div class="cx-card" data-card="' + i + '"><button type="button" class="cx-card-o" data-open="' + i + '"><span class="cx-card-i">' + (CX_ICON[c.type] || '🔗') + '</span><span class="cx-card-t"><b>' + _cxE(c.title || c.id) + '</b><i>' + _cxE(c.sub || '') + '</i></span>' + st + '</button>' + acts + '</div>';
}
function _cxDrawMsgs(append, focusMid) {
  var box = document.getElementById('cxMsgs'); if (!box) return;
  var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  var h = (CX.more ? '<button type="button" class="cx-older" data-older>이전 대화 더 보기</button>' : '') +
    (CX.msgs.length ? '' : '<div class="cx-empty">첫 메시지를 남겨 보세요 — <b>＋</b> 로 업무 카드를 붙이거나 <b>/ai</b> 로 데이터에 바로 물을 수 있어요</div>');
  CX.msgs.forEach(function (m, i) { h += _cxMsgHtml(m, CX.msgs[i - 1], false); });
  var prevH = box.scrollHeight, prevTop = box.scrollTop;
  box.innerHTML = h;
  _cxLoadBlobs(box);
  if (focusMid) { _cxJump(focusMid); return; }
  if (append === 'older') box.scrollTop = box.scrollHeight - prevH + prevTop;
  else if (!append || atBottom || (CX.msgs.length && CX.msgs[CX.msgs.length - 1].userId === _cxMe())) box.scrollTop = box.scrollHeight;
}
function _cxDrawReadCounts() {
  document.querySelectorAll('#mMessages [data-un]').forEach(function (e) {
    var id = +e.dataset.un, m = CX.msgs.filter(function (x) { return x.id === id; })[0] || CX.threadMsgs.filter(function (x) { return x.id === id; })[0];
    if (m) { var n = _cxUnreadOf(m); e.textContent = n || ''; }
  });
}
function _cxLoadOlder() {
  if (!CX.msgs.length) return;
  CX.loading = true;
  var my = CX.room;
  apiFetch('/api/chat/rooms/' + CX.room + '/messages?before=' + CX.msgs[0].id).then(function (r) {
    CX.loading = false;
    if (CX.room !== my) return;
    CX.msgs = (r.data || []).concat(CX.msgs); CX.more = !!r.more;
    _cxDrawMsgs('older');
  }).catch(function () { CX.loading = false; });
}
function _cxJump(id) {
  var el = document.querySelector('#cxMsgs [data-mid="' + id + '"]');
  if (!el) { if (CX.more) { CX.loading = true; apiFetch('/api/chat/rooms/' + CX.room + '/messages?around=' + id + '&limit=120').then(function (r) { CX.loading = false; CX.msgs = r.data || []; CX.more = !!r.more; _cxDrawMsgs(false, null); var e2 = document.querySelector('#cxMsgs [data-mid="' + id + '"]'); if (e2) { e2.scrollIntoView({ block: 'center' }); e2.classList.add('cx-hl'); } }).catch(function () { CX.loading = false; }); } return; }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('cx-hl'); void el.offsetWidth; el.classList.add('cx-hl');
}
/* 사진 — 인증이 필요한 주소라 받아서 blob 으로 */
function _cxBlob(fid) {
  if (CX.blobs[fid]) return CX.blobs[fid];
  CX.blobs[fid] = fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/files/' + encodeURIComponent(fid), { headers: { Authorization: 'Bearer ' + _accessToken } }).then(function (res) {
    var ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') >= 0) return res.json().then(function (j) { return j.data.url; });   // GCS 서명 주소
    return res.blob().then(function (b) { return URL.createObjectURL(b); });
  });
  CX.blobs[fid].catch(function () { delete CX.blobs[fid]; });
  return CX.blobs[fid];
}
function _cxLoadBlobs(root) {
  root.querySelectorAll('img[data-blob]').forEach(function (img) {
    var id = img.dataset.blob; img.removeAttribute('data-blob');
    _cxBlob(id).then(function (u) {
      img.src = u;
      var holder = img.closest('[data-mid]'), m = holder && _cxFindMsg(+holder.dataset.mid);
      if (typeof chatBoardThumb === 'function' && m && m.file) chatBoardThumb(img, m.file);   // 표시 · 자르기 · 회전한 모습으로
    }).catch(function () { img.alt = '사진을 불러오지 못했습니다'; });
  });
}
function _cxDownload(fid, name) {
  fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/files/' + encodeURIComponent(fid) + '?dl=1', { headers: { Authorization: 'Bearer ' + _accessToken } }).then(function (res) {
    var ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') >= 0) return res.json().then(function (j) { location.href = j.data.url; });
    return res.blob().then(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name || 'file'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000); });
  }).catch(function () { _cxToast('받지 못했습니다', 'error'); });
}
function _cxFindMsg(id) { return CX.msgs.filter(function (m) { return m.id === id; })[0] || CX.threadMsgs.filter(function (m) { return m.id === id; })[0]; }

/* 메시지 위 누르기 — 공감 · 답글 · 더보기 · 카드 · 파일 */
function _cxMsgClick(e) {
  var t = e.target;
  if (t.closest('[data-older]')) { _cxLoadOlder(); return; }
  var mel = t.closest('[data-mid]'), m = mel && _cxFindMsg(+mel.dataset.mid);
  var rx = t.closest('[data-rx]');
  if (rx && m) { _cxReact(m.id, rx.dataset.rx); return; }
  var a = t.closest('[data-a]');
  if (a && m) {
    if (a.dataset.a === 'react') _cxMenu(a, CX_REACTS.map(function (em) { return [em, function () { _cxReact(m.id, em); }]; }), 'cx-rxpick');
    else if (a.dataset.a === 'reply') chatOpenThread(m.id);
    else if (a.dataset.a === 'more') _cxMsgMenu(a, m);
    return;
  }
  var op = t.closest('[data-open]');
  if (op && m) { var c = m.cards[+op.dataset.open]; if (c) _cxOpenCard(c); return; }
  var act = t.closest('[data-act]');
  if (act && m) {
    act.disabled = true;
    apiFetch('/api/chat/messages/' + m.id + '/action', { method: 'POST', body: JSON.stringify({ card: +act.dataset.ci, action: act.dataset.act }) })
      .then(function (r) { if (r && r.data) { _cxUpsert(r.data, true); _cxDrawMsgs(true); } })
      .catch(function (err) { act.disabled = false; _cxToast(_cxErr(err), 'error'); });
    return;
  }
  var fl = t.closest('[data-file]');
  if (fl && m) { if (fl.dataset.img) _cxViewImage(fl.dataset.file, m.file && m.file.name); else _cxDownload(fl.dataset.file, m.file && m.file.name); return; }
  var td = t.closest('[data-todoc]');
  if (td) { apiFetch('/api/chat/files/' + td.dataset.todoc + '/to-docs', { method: 'POST', body: JSON.stringify({ projectId: CX.info && CX.info.projectId }) }).then(function () { _cxToast('📂 프로젝트 문서로 보냈습니다', 'success'); }).catch(function (err) { _cxToast(_cxErr(err), 'error'); }); return; }
  var w = t.closest('[data-watch]');
  if (w && typeof chatRtcWatch === 'function') { chatRtcWatch(CX.room, w.dataset.watch, w.dataset.from); return; }
}
function _cxOpenCard(c) {
  if (c.type === 'cdoc' && typeof chatDocOpen === 'function') { chatDocOpen(c.id); return; }   // v13.360 📝 공동 문서
  if (c.type === 'todo') { if (typeof setPage === 'function') setPage('mywork'); return; }
  if (typeof globalSearchNav === 'function') globalSearchNav(c.type, { id: c.id, title: c.title, sub: c.sub, nav: c.nav || {} }, '');
}
function _cxReact(mid, emoji) {
  apiFetch('/api/chat/messages/' + mid + '/react', { method: 'POST', body: JSON.stringify({ emoji: emoji }) }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
}
function _cxMsgMenu(btn, m) {
  var mine = m.userId === _cxMe();
  _cxMenu(btn, [
    m.body ? ['📋 복사', function () { try { navigator.clipboard.writeText(m.body); _cxToast('복사했습니다', 'success'); } catch (e) {} }] : null,
    ['↪ 전달', function () { chatForwardModal(m); }],
    typeof chatSaveMenu === 'function' ? ['📁 폴더에 담기', function () { chatSaveMenu(btn, m); }] : null,
    typeof chatRemindMenu === 'function' ? ['⏰ 다시 알림…', function () { chatRemindMenu(btn, m); }] : null,
    ['📢 공지로', function () { apiFetch('/api/chat/rooms/' + CX.room + '/notice', { method: 'POST', body: JSON.stringify({ messageId: m.id }) }).catch(function (e) { _cxToast(_cxErr(e), 'error'); }); }],
    m.body ? ['✅ 내 할 일로', function () { apiFetch('/api/chat/rooms/' + CX.room + '/messages', { method: 'POST', body: JSON.stringify({ body: '/todo ' + m.body.split('\n')[0].slice(0, 200), replyTo: m.id }) }).then(function () { _cxToast('✅ 내 할 일에 넣었습니다', 'success'); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); }); }] : null,
    m.body && typeof nbSendToInbox === 'function' ? ['📓 노트로 (낙서장)', function () {   // v13.316
      var who = m.userName || '', when = m.createdAt ? new Date(m.createdAt).toLocaleString() : '';
      nbSendToInbox('> 💬 ' + (CX.info && CX.info.name ? CX.info.name + ' · ' : '') + who + (when ? ' · ' + when : '') + '\n\n' + m.body, 'chat');
    }] : null,
    mine && m.body && m.kind === 'text' ? ['✏️ 수정', function () { _cxStartEdit(m); }] : null,
    mine ? ['🗑 삭제', function () { if (confirm('이 메시지를 지울까요? 모두에게서 지워집니다.')) apiFetch('/api/chat/messages/' + m.id, { method: 'DELETE' }).catch(function (e) { _cxToast(_cxErr(e), 'error'); }); }] : null
  ].filter(Boolean));
}
/* 작은 메뉴 (공용) */
function _cxMenu(anchor, items, cls) {
  var old = document.getElementById('cxMenu'); if (old) old.remove();
  var mnu = document.createElement('div'); mnu.id = 'cxMenu'; mnu.className = 'cx-menu' + (cls ? ' ' + cls : ''); mnu.setAttribute('role', 'menu');
  items.forEach(function (it) { var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = it[0]; b.addEventListener('click', function () { mnu.remove(); it[1](); }); mnu.appendChild(b); });
  document.body.appendChild(mnu);
  var r = anchor.getBoundingClientRect(), w = mnu.offsetWidth, hh = mnu.offsetHeight;
  mnu.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.right - w)) + 'px';
  mnu.style.top = (r.bottom + hh + 6 > window.innerHeight ? Math.max(6, r.top - hh - 4) : r.bottom + 4) + 'px';
  setTimeout(function () { document.addEventListener('pointerdown', function off(e) { if (!mnu.contains(e.target)) { mnu.remove(); document.removeEventListener('pointerdown', off, true); } }, true); }, 0);
  var first = mnu.querySelector('button'); if (first) first.focus();
  mnu.addEventListener('keydown', function (e) { if (e.key === 'Escape') mnu.remove(); });
}
function _cxViewImage(fid, name) {
  if (typeof chatBoardOpen === 'function') return chatBoardOpen(fid, name, CX.room);   // v13.356 🖼 사진 칠판 (원본 · 표시 보기 · 같이 그리기)
  _cxBlob(fid).then(function (u) {
    var ov = document.createElement('div'); ov.className = 'cx-lightbox'; ov.innerHTML = '<img alt=""><div class="cx-lb-a"><button type="button" data-dl>⬇ 받기</button><button type="button" data-x>✕ 닫기</button></div>';
    ov.querySelector('img').src = u; ov.querySelector('img').alt = name || '';
    function close() { ov.remove(); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', function (e) { if (e.target.closest('[data-dl]')) _cxDownload(fid, name); else close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(ov);
  });
}

/* ─── 입력칸 (본 대화 · 답글 줄기 공용) ─── */
function _cxCanCapture() { return !!((window.wmDesktop && window.wmDesktop.captureScreen) || (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && !/Android|iPhone|iPad/i.test(navigator.userAgent))); }
function _cxComposerHtml(taId, wrapId) {
  return '<div class="cx-comp" id="' + wrapId + '"><div class="cx-chips" data-chips></div><div class="cx-reply" data-replybar hidden></div>' +
    '<div class="cx-comp-r"><button type="button" class="cx-ib" data-c="attach" title="파일 · 사진 (끌어 놓기 · 붙여넣기도 됨)">📎</button>' +
    '<button type="button" class="cx-ib" data-c="card" title="업무 카드 붙이기 — 이슈 · 프로젝트 · 마일스톤 · 문서 …">＋</button>' +
    (wrapId === 'cxComp' && typeof chatTimeComposer === 'function' ? '<button type="button" class="cx-ib" data-c="sched" title="⏰ 예약 보내기 — 글을 쓰고 누르면 그때 보냄">⏰</button>' : '') +
    (wrapId === 'cxComp' && typeof chatPostModal === 'function' ? '<button type="button" class="cx-ib" data-c="post" title="게시판 글쓰기 — 공지 · 자료 · 질문 · 🛠 요청">✍️</button>' : '') +
    (_cxCanCapture() ? '<button type="button" class="cx-ib" data-c="cap" title="화면 캡처 — 잘라서 표시하고 보내기">📸</button>' : '') +
    '<textarea id="' + taId + '" rows="1" placeholder="메시지 · @사람 · /명령" title="Enter 보내기 · Shift+Enter 줄바꿈 · @ 사람 부르기 · / 명령(/ai · /요약 · /todo · /issue) · 파일은 끌어 놓거나 붙여넣기" aria-label="메시지 입력"></textarea>' +
    '<button type="button" class="cx-send" data-c="send" title="보내기" aria-label="보내기">➤</button>' +
    '<input type="file" data-c="file" multiple hidden></div><div class="cx-sugg" data-sugg hidden></div></div>';
}
function _cxBindComposer(taId, wrapId, inThread) {
  var wrap = document.getElementById(wrapId), ta = document.getElementById(taId); if (!wrap || !ta) return;
  var fileIn = wrap.querySelector('[data-c="file"]'), sugg = wrap.querySelector('[data-sugg]'), lastTyping = 0, sel = 0;
  function grow() { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; }
  ta.addEventListener('input', function () {
    grow();
    if (Date.now() - lastTyping > 3000 && ta.value.trim() && ta.value[0] !== '/') { lastTyping = Date.now(); apiFetch('/api/chat/rooms/' + CX.room + '/typing', { method: 'POST', body: '{}' }).catch(function () {}); }
    _suggest();
  });
  function _suggest() {
    var v = ta.value, pos = ta.selectionStart, before = v.slice(0, pos), items = [];
    var at = /(^|\s)@([^\s@]{0,15})$/.exec(before);
    if (at && CX.info) {
      var q = at[2];
      items = CX.info.members.filter(function (m) { return !m.me && m.name.indexOf(q) >= 0; }).slice(0, 6).map(function (m) { return { t: '@' + m.name, d: m.dept || '', ins: function () { ta.value = before.slice(0, before.length - q.length - 1) + '@' + m.name + ' ' + v.slice(pos); } }; });
      if (CX.info.kind !== 'dm' && '모두'.indexOf(q) === 0) items.push({ t: '@모두', d: '방 전체', ins: function () { ta.value = before.slice(0, before.length - q.length - 1) + '@모두 ' + v.slice(pos); } });
    } else if (/^\/\S*$/.test(v) && !inThread) {
      items = [['/ai ', '내 권한 데이터로 AI 답 — 예: /ai 이번 주 지연 이슈'], ['/요약', '이 방 대화를 AI 가 정리'], ['/todo ', '내 할 일로 — 예: /todo 내일 15:00 견적 회신'], ['/issue ', '이 프로젝트에 이슈 (프로젝트 방)'], ['/help', '명령 보기']]
        .filter(function (c) { return c[0].indexOf(v.trim()) === 0; }).map(function (c) { return { t: c[0].trim(), d: c[1], ins: function () { ta.value = c[0]; } }; });
    }
    sel = 0;
    if (!items.length) { sugg.hidden = true; sugg._items = null; return; }
    sugg._items = items;
    sugg.innerHTML = items.map(function (it, i) { return '<button type="button" data-si="' + i + '"' + (i === 0 ? ' class="on"' : '') + '><b>' + _cxE(it.t) + '</b><i>' + _cxE(it.d) + '</i></button>'; }).join('');
    sugg.hidden = false;
  }
  function pick(i) { var it = sugg._items && sugg._items[i]; if (!it) return; it.ins(); sugg.hidden = true; sugg._items = null; ta.focus(); grow(); }
  sugg.addEventListener('mousedown', function (e) { var b = e.target.closest('[data-si]'); if (b) { e.preventDefault(); pick(+b.dataset.si); } });
  ta.addEventListener('keydown', function (e) {
    if (sugg._items && !sugg.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + sugg._items.length) % sugg._items.length; sugg.querySelectorAll('button').forEach(function (b, i) { b.classList.toggle('on', i === sel); }); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) { e.preventDefault(); pick(sel); return; }
      if (e.key === 'Escape') { sugg.hidden = true; return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); _go(); }
    else if (e.key === 'Escape' && CX.editId && !inThread) { _cxCancelEdit(); }
    else if (e.key === 'ArrowUp' && !ta.value && !inThread) { var last = CX.msgs.slice().reverse().filter(function (m) { return m.userId === _cxMe() && m.kind === 'text' && !m.deleted; })[0]; if (last) { e.preventDefault(); _cxStartEdit(last); } }
  });
  ta.addEventListener('paste', function (e) {
    var files = typeof wmPastedFiles === 'function' ? wmPastedFiles(e) : Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || []);
    if (!files.length) return;
    e.preventDefault();
    // 사진 한 장 붙여넣기 → 칠판에서 표시 · 자르고 Enter 로 보내기 (v13.356)
    if (files.length === 1 && /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(files[0].type) && typeof chatBoardDraft === 'function') return chatBoardDraft(files[0], { replyTo: inThread ? CX.thread : null, hint: '표시하고 Enter 로 보내기 · 그대로 보내도 됩니다' });
    _cxUpload(files, inThread ? CX.thread : null);
  });
  wrap.addEventListener('click', function (e) {
    var b = e.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === 'attach') fileIn.click();
    else if (b.dataset.c === 'card') chatCardPicker(inThread);
    else if (b.dataset.c === 'post' && typeof chatPostModal === 'function') chatPostModal();
    else if (b.dataset.c === 'sched' && typeof chatTimeComposer === 'function') chatTimeComposer(b, ta);
    else if (b.dataset.c === 'cap' && typeof chatBoardCapture === 'function') chatBoardCapture(inThread ? CX.thread : null);
    else if (b.dataset.c === 'send') _go();
  });
  wrap.addEventListener('click', function (e) { var x = e.target.closest('[data-unchip]'); if (x) { CX.cards.splice(+x.dataset.unchip, 1); _cxDrawChips(); } var rc = e.target.closest('[data-unreply]'); if (rc) _cxCancelEdit(); });
  fileIn.addEventListener('change', function () { _cxUpload(Array.prototype.slice.call(fileIn.files || []), inThread ? CX.thread : null); fileIn.value = ''; });
  function _go() {
    var v = ta.value.trim();
    if (!v && !(CX.cards.length && !inThread)) return;
    if (CX.editId && !inThread) {
      var id = CX.editId; _cxCancelEdit();
      apiFetch('/api/chat/messages/' + id, { method: 'PUT', body: JSON.stringify({ body: v }) }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
      return;
    }
    ta.value = ''; grow(); sugg.hidden = true;
    _cxSend(v, inThread ? CX.thread : null, inThread ? null : CX.cards.slice());
    if (!inThread) { CX.cards = []; _cxDrawChips(); }
  }
}
function _cxSend(body, replyTo, cards) {
  var room = CX.room;
  return apiFetch('/api/chat/rooms/' + room + '/messages', { method: 'POST', body: JSON.stringify({ body: body, replyTo: replyTo || null, cards: cards && cards.length ? cards : undefined }), timeoutMs: /^\/(ai|요약|summary)/.test(body) ? 120000 : 15000 })
    .then(function (r) { if (r && r.data && CX.room === room) { if (r.data.replyTo) { if (CX.thread === r.data.replyTo && !CX.threadMsgs.some(function (m) { return m.id === r.data.id; })) { CX.threadMsgs.push(r.data); _cxDrawThread(true); } } else if (_cxAddIfNew(r.data)) _cxDrawMsgs(true); } })
    .catch(function (e) { _cxToast(_cxErr(e), 'error'); var ta = document.getElementById(replyTo ? 'cxThIn' : 'cxIn'); if (ta && !ta.value) ta.value = body; });
}
function _cxStartEdit(m) {
  CX.editId = m.id;
  var ta = document.getElementById('cxIn'); if (!ta) return;
  ta.value = m.body; ta.focus(); ta.dispatchEvent(new Event('input'));
  var rb = document.querySelector('#cxComp [data-replybar]'); rb.hidden = false;
  rb.innerHTML = '<span>✏️ 메시지 수정 중 — Enter 저장 · Esc 취소</span><button type="button" class="cx-ib" data-unreply>✕</button>';
}
function _cxCancelEdit() {
  CX.editId = null;
  var ta = document.getElementById('cxIn'); if (ta) { ta.value = ''; ta.style.height = 'auto'; }
  var rb = document.querySelector('#cxComp [data-replybar]'); if (rb) rb.hidden = true;
}
function _cxDrawChips() {
  var c = document.querySelector('#cxComp [data-chips]'); if (!c) return;
  c.innerHTML = CX.cards.map(function (k, i) { return '<span class="cx-chip">' + (CX_ICON[k.type] || '🔗') + ' ' + _cxE(k.title) + '<button type="button" data-unchip="' + i + '" aria-label="빼기">✕</button></span>'; }).join('');
}

/* 파일 올리기 — 하나씩 · 진행 표시 */
function _cxUpload(files, replyTo) {
  if (!files || !files.length || !CX.room) return;
  var room = CX.room;
  files.slice(0, 10).forEach(function (f) {
    if (f.size > 25 * 1024 * 1024) { _cxToast(f.name + ' — 25MB 까지 올릴 수 있습니다', 'warn'); return; }
    var tip = document.createElement('div'); tip.className = 'cx-upl'; tip.innerHTML = '<span></span><i><b style="width:0%"></b></i>';
    tip.querySelector('span').textContent = '📎 ' + f.name;
    var host = document.getElementById('cxTyping'); if (host) host.parentNode.insertBefore(tip, host);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', (typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/rooms/' + encodeURIComponent(room) + '/files?name=' + encodeURIComponent(f.name) + (replyTo ? '&replyTo=' + replyTo : ''));
    xhr.setRequestHeader('Authorization', 'Bearer ' + _accessToken);
    xhr.setRequestHeader('Content-Type', f.type || 'application/octet-stream');
    xhr.upload.onprogress = function (e) { if (e.lengthComputable) tip.querySelector('b').style.width = Math.round(e.loaded / e.total * 100) + '%'; };
    xhr.onload = function () {
      tip.remove();
      if (xhr.status >= 300) { var m = '올리지 못했습니다'; try { m = JSON.parse(xhr.responseText).message || m; } catch (e) {} _cxToast(f.name + ' — ' + m, 'error'); return; }
      try { var d = JSON.parse(xhr.responseText).data; if (CX.room === room && !d.replyTo && _cxAddIfNew(d)) _cxDrawMsgs(true); } catch (e) {}
    };
    xhr.onerror = function () { tip.remove(); _cxToast(f.name + ' — 올리지 못했습니다', 'error'); };
    xhr.send(f);
  });
}

/* ─── 답글 줄기 ─── */
function chatOpenThread(mid) {
  CX.thread = mid; CX.threadMsgs = []; CX.aside = true;
  var root = document.querySelector('#mMessages .cx'); if (root) root.classList.remove('no-aside');
  _cxDrawAside();
  apiFetch('/api/chat/rooms/' + CX.room + '/messages?thread=' + mid + '&limit=200').then(function (r) { if (CX.thread !== mid) return; CX.threadMsgs = r.data || []; _cxDrawThread(); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
}
function _cxDrawThread(append) {
  var box = document.getElementById('cxThMsgs'); if (!box) return;
  var h = '';
  CX.threadMsgs.forEach(function (m, i) { h += _cxMsgHtml(m, CX.threadMsgs[i - 1], true); if (i === 0) h += '<div class="cx-th-sep">답글 ' + (CX.threadMsgs.length - 1) + '</div>'; });
  box.innerHTML = h || '<div class="cx-loading">불러오는 중…</div>';
  _cxLoadBlobs(box);
  box.scrollTop = box.scrollHeight;
}

/* ─── 오른쪽: 답글 줄기 · 프로젝트 현황 · 멤버 · 파일 ─── */
function _cxDrawAside() {
  var a = document.getElementById('cxAside'); if (!a) return;
  var root = document.querySelector('#mMessages .cx'); if (root) root.classList.toggle('no-aside', !CX.aside || !CX.room);
  if (!CX.room || !CX.aside) { a.innerHTML = ''; return; }
  if (CX.thread) {
    a.innerHTML = '<div class="cx-as-h"><b>💬 답글</b><button type="button" class="cx-ib" data-x aria-label="닫기">✕</button></div><div class="cx-msgs cx-th-msgs" id="cxThMsgs"></div>' + _cxComposerHtml('cxThIn', 'cxThComp');
    a.querySelector('[data-x]').addEventListener('click', function () { CX.thread = null; _cxDrawAside(); });
    a.querySelector('#cxThMsgs').addEventListener('click', _cxMsgClick);
    _cxBindComposer('cxThIn', 'cxThComp', true);
    _cxDrawThread();
    return;
  }
  var tab = CX.asideTab || (CX.info && CX.info.kind === 'project' ? 'ctx' : 'people');
  var tabs = (CX.info && CX.info.kind === 'project' ? [['ctx', '📊 현황']] : []).concat([['board', '📌 게시판'], ['docs', '📝 문서'], ['people', '👤 멤버'], ['files', '📎 파일']]);
  a.innerHTML = '<div class="cx-as-tabs">' + tabs.map(function (t) { return '<button type="button" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '<button type="button" class="cx-ib" data-x aria-label="닫기">✕</button></div><div class="cx-as-b" id="cxAsB"></div>';
  a.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { CX.asideTab = b.dataset.tab; _cxDrawAside(); }); });
  a.querySelector('[data-x]').addEventListener('click', function () { CX.aside = false; _cxDrawAside(); _cxDrawHead(); });
  var b = a.querySelector('#cxAsB');
  if (tab === 'ctx') b.innerHTML = _cxCtxHtml();
  else if (tab === 'board' && typeof chatPostsTab === 'function') chatPostsTab(b);
  else if (tab === 'docs' && typeof chatDocsTab === 'function') chatDocsTab(b);
  else if (tab === 'people') {
    var ms = (CX.info && CX.info.members) || [];
    var mg = CX.info && CX.info.canManage;
    b.innerHTML = (CX.info && CX.info.kind !== 'dm' ? '<div class="cx-roles">👑 방장 ' + ms.filter(function (m) { return m.role === 'owner'; }).length + ' · 멤버 ' + ms.length + (ms.some(function (m) { return m.role === 'readonly'; }) ? ' · 👁 읽기만 ' + ms.filter(function (m) { return m.role === 'readonly'; }).length : '') + '</div>' : '') +
      ms.map(function (m) { return '<div class="cx-pp">' + _cxAv(m.id, m.name, m.online) + '<span><b>' + _cxE(m.name) + (m.me ? ' (나)' : '') + (m.role === 'owner' ? ' <em class="cx-role own">👑 방장</em>' : m.role === 'readonly' ? ' <em class="cx-role ro">👁 읽기만</em>' : '') + '</b><i>' + _cxE(m.dept || '') + '</i></span>' +
        (!m.me ? '<button type="button" class="cx-ib" data-dm="' + _cxE(m.id) + '" title="1:1 대화">💬</button>' : '') +
        (mg && CX.info.kind !== 'dm' ? '<button type="button" class="cx-ib" data-role="' + _cxE(m.id) + '" title="역할 · 내보내기">⋯</button>' : '') + '</div>'; }).join('') +
      (CX.info && CX.info.kind !== 'dm' && CX.info.myRole !== 'readonly' ? '<button type="button" class="btn btn-g btn-s cx-inv">➕ 사람 초대</button>' : '');
    b.querySelectorAll('[data-dm]').forEach(function (x) { x.addEventListener('click', function () { chatStartDm(x.dataset.dm); }); });
    b.querySelectorAll('[data-role]').forEach(function (x) { x.addEventListener('click', function () { _cxRoleMenu(x, ms.filter(function (m) { return m.id === x.dataset.role; })[0]); }); });
    var inv = b.querySelector('.cx-inv'); if (inv) inv.addEventListener('click', chatInviteModal);
  } else {
    b.innerHTML = '<div class="cx-loading">불러오는 중…</div>';
    apiFetch('/api/chat/rooms/' + CX.room + '/files').then(function (r) {
      var fs = (r && r.data) || [];
      b.innerHTML = fs.length ? fs.map(function (f) { return '<button type="button" class="cx-af" data-f="' + _cxE(f.id) + '" data-n="' + _cxE(f.name) + '" data-img="' + (/^image\//.test(f.mime || '') ? 1 : '') + '"><span class="cx-fx">' + _cxE(((/\.([A-Za-z0-9]{1,6})$/.exec(f.name) || [])[1] || 'FILE').toUpperCase()) + '</span><span><b>' + _cxE(f.name) + '</b><i>' + _cxSize(f.size) + ' · ' + _cxE(f.userName || '') + ' · ' + _cxRel(f.at) + '</i></span></button>'; }).join('') : '<div class="cx-empty">주고받은 파일이 없습니다</div>';
      if (typeof chatRoomFolders === 'function') chatRoomFolders(b);
      b.querySelectorAll('[data-f]').forEach(function (x) { x.addEventListener('click', function () { if (x.dataset.img) _cxViewImage(x.dataset.f, x.dataset.n); else _cxDownload(x.dataset.f, x.dataset.n); }); });
    }).catch(function () { b.innerHTML = '<div class="cx-empty">불러오지 못했습니다</div>'; });
  }
}
/* 👑 역할 · 내보내기 (방장) — v13.359 */
function _cxRoleMenu(btn, u) {
  if (!u) return;
  function set(role) { apiFetch('/api/chat/rooms/' + CX.room + '/members/' + u.id, { method: 'PUT', body: JSON.stringify({ role: role }) }).then(function () { chatOpenRoom(CX.room, true); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); }); }
  _cxMenu(btn, [
    u.role !== 'owner' ? ['👑 방장으로', function () { set('owner'); }] : null,
    u.role !== 'member' ? ['🙂 멤버로', function () { set('member'); }] : null,
    u.role !== 'readonly' ? ['👁 읽기만 (글 · 파일 못 올림)', function () { set('readonly'); }] : null,
    !u.me ? ['🚪 내보내기', function () { if (!confirm(u.name + ' 님을 이 방에서 내보낼까요?')) return; apiFetch('/api/chat/rooms/' + CX.room + '/members/' + u.id, { method: 'DELETE' }).then(function () { chatOpenRoom(CX.room, true); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); }); }] : null
  ].filter(Boolean));
}
/* 프로젝트 방 옆 현황 다시 받기 — 이슈 카드가 오가거나 상태가 바뀌면 (잠깐 모아서 한 번) */
function _cxCtxRefresh() {
  if (!CX.info || CX.info.kind !== 'project') return;
  clearTimeout(CX._ctxT);
  var my = CX.room;
  CX._ctxT = setTimeout(function () {
    apiFetch('/api/chat/rooms/' + encodeURIComponent(my) + '/context').then(function (c) { if (CX.room === my) { CX.ctx = c.data; if (!CX.thread && (CX.asideTab || 'ctx') === 'ctx') _cxDrawAside(); } }).catch(function () {});
  }, 400);
}
function _cxCtxHtml() {
  var c = CX.ctx;
  if (!c) return '<div class="cx-loading">프로젝트 현황 불러오는 중…</div>';
  var p = c.project, pg = Math.max(0, Math.min(100, +p.progress || 0));
  function md(s) { return s ? String(s).slice(5, 10).replace('-', '/') : '-'; }
  var today = new Date(), end = p.end ? new Date(String(p.end).slice(0, 10)) : null, dday = end ? Math.ceil((end - today) / 86400000) : null;
  var h = '<button type="button" class="cx-ctx-p" data-proj="' + _cxE(p.id) + '"><b>' + _cxE(p.name) + '</b><i>' + (p.orderNo ? _cxE(p.orderNo) + ' · ' : '') + md(p.start) + ' ~ ' + md(p.end) + (dday != null ? ' · ' + (dday >= 0 ? 'D-' + dday : 'D+' + -dday) : '') + '</i></button>' +
    '<div class="cx-ctx-bar"><i style="width:' + pg + '%"></i></div><div class="cx-ctx-n"><span>진척 <b>' + pg + '%</b></span><span>열린 이슈 <b>' + c.issues.open + '</b>' + (c.issues.late ? ' · <em>지연 ' + c.issues.late + '</em>' : '') + '</span></div>';
  h += '<div class="cx-ctx-h">🐞 열린 이슈</div>' + (c.issues.top.length ? c.issues.top.map(function (i) { return '<div class="cx-ctx-i"><button type="button" data-iss="' + _cxE(i.id) + '">' + (i.urgency === 'urgent' ? '🔴 ' : '') + _cxE(i.title) + '</button><span>' + (CX_ISSUE[i.status] || i.status) + '</span><button type="button" class="cx-ib" data-share-iss="' + _cxE(i.id) + '" data-t="' + _cxE(i.title) + '" title="대화에 카드로 올리기">↗</button></div>'; }).join('') : '<div class="cx-empty">없음 👍</div>');
  h += '<div class="cx-ctx-h">🚩 다가오는 마일스톤</div>' + (c.milestones.length ? c.milestones.map(function (m) { return '<div class="cx-ctx-i' + (m.late ? ' late' : '') + '"><span class="cx-ctx-mn">' + _cxE(m.name) + '</span><span>' + md(m.end) + (m.progress != null ? ' · ' + m.progress + '%' : '') + '</span></div>'; }).join('') : '<div class="cx-empty">없음</div>');
  h += '<div class="cx-ctx-tip">💡 <b>/issue 제목</b> 으로 바로 이슈 · <b>/ai</b> 로 이 프로젝트를 물어보세요</div>';
  setTimeout(function () {
    var b = document.getElementById('cxAsB'); if (!b) return;
    var pp = b.querySelector('[data-proj]'); if (pp) pp.addEventListener('click', function () { _cxOpenCard({ type: 'project', id: p.id, nav: { projectId: p.id } }); });
    b.querySelectorAll('[data-iss]').forEach(function (x) { x.addEventListener('click', function () { _cxOpenCard({ type: 'issue', id: x.dataset.iss, nav: { issueId: x.dataset.iss } }); }); });
    b.querySelectorAll('[data-share-iss]').forEach(function (x) { x.addEventListener('click', function () { _cxSend('', null, [{ type: 'issue', id: x.dataset.shareIss, title: x.dataset.t, nav: { issueId: x.dataset.shareIss } }]); }); });
  }, 0);
  return h;
}

/* ─── 새 대화 · 초대 · 전달 · 카드 고르기 (표준 가드 창) ─── */
function _cxUsers() { return CX.users ? Promise.resolve(CX.users) : apiFetch('/api/chat/users').then(function (r) { CX.users = (r && r.data) || []; return CX.users; }); }
function chatStartDm(uid) {
  return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: uid }) }).then(function (r) { return _cxLoadRooms().then(function () { chatOpenRoom(r.data.id); }); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
}
function chatOpenProject(pid) {
  return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'project', projectId: pid }) }).then(function (r) {
    CX.aside = true;
    var page = document.getElementById('mMessages');
    if (page && page.classList.contains('hidden')) { CX.pending = r.data.id; if (typeof setPage === 'function') setPage('messages'); }
    else _cxLoadRooms().then(function () { chatOpenRoom(r.data.id); });
  }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
}
function _cxPeoplePick(box, multi, exclude, onPick) {
  _cxUsers().then(function (us) {
    var pick = {}, q = '';
    function draw() {
      var list = us.filter(function (u) { return !u.me && (exclude || []).indexOf(u.id) < 0 && (!q || (u.name + ' ' + u.dept).toLowerCase().indexOf(q) >= 0); });
      box.querySelector('[data-list]').innerHTML = list.map(function (u) { return '<button type="button" class="cx-pp' + (pick[u.id] ? ' on' : '') + '" data-u="' + _cxE(u.id) + '">' + _cxAv(u.id, u.name, u.online) + '<span><b>' + _cxE(u.name) + '</b><i>' + _cxE(u.dept) + '</i></span>' + (multi ? '<em>' + (pick[u.id] ? '✓' : '') + '</em>' : '') + '</button>'; }).join('') || '<div class="cx-empty">없음</div>';
      box.querySelectorAll('[data-u]').forEach(function (b) { b.addEventListener('click', function () { if (!multi) return onPick([b.dataset.u]); if (pick[b.dataset.u]) delete pick[b.dataset.u]; else pick[b.dataset.u] = 1; draw(); onPick(Object.keys(pick), true); }); });
    }
    box.querySelector('[data-q]').addEventListener('input', function (e) { q = e.target.value.trim().toLowerCase(); draw(); });
    draw();
  });
}
function chatNewModal() {
  return wmGuardedModal('chatNew', function () {
    var m = createModal({ id: 'chatNewModal', title: '💬 새 대화', width: '460px', closeOnEsc: true, closeOnOverlay: true,
      html: '<div class="cx-seg"><button type="button" data-k="dm" class="on">👤 1:1</button><button type="button" data-k="group">👥 그룹</button><button type="button" data-k="project">📁 프로젝트 방</button></div>' +
        '<div data-pane></div>' });
    var pane = m.box.querySelector('[data-pane]');
    function show(k) {
      m.box.querySelectorAll('[data-k]').forEach(function (b) { b.classList.toggle('on', b.dataset.k === k); });
      if (k === 'project') {
        pane.innerHTML = '<input class="wr-inp cx-mq" data-q placeholder="프로젝트 이름 · 수주번호" aria-label="프로젝트 찾기"><div class="cx-plist" data-list><div class="cx-empty">찾을 프로젝트 이름을 적으세요 — 프로젝트 담당 · 참여자가 처음부터 멤버가 됩니다</div></div>';
        var qt; pane.querySelector('[data-q]').addEventListener('input', function (e) {
          clearTimeout(qt); var q = e.target.value.trim(); if (!q) return;
          qt = setTimeout(function () { apiFetch('/api/search?cat=project&limit=12&q=' + encodeURIComponent(q)).then(function (r) {
            var g = ((r.data && r.data.groups) || []).filter(function (x) { return x.key === 'project'; })[0], items = g ? g.items : [];
            pane.querySelector('[data-list]').innerHTML = items.map(function (it) { return '<button type="button" class="cx-pp" data-p="' + _cxE(it.id) + '"><span class="cx-av cx-av-p">📁</span><span><b>' + _cxE(it.title) + '</b><i>' + _cxE(it.sub || '') + '</i></span></button>'; }).join('') || '<div class="cx-empty">없음</div>';
            pane.querySelectorAll('[data-p]').forEach(function (b) { b.addEventListener('click', function () { m.close(); chatOpenProject(b.dataset.p); }); });
          }).catch(function () {}); }, 220);
        });
        return;
      }
      pane.innerHTML = (k === 'group' ? '<input class="wr-inp cx-mq" data-name placeholder="방 이름 (비우면 사람 이름으로)" aria-label="방 이름">' : '') + '<input class="wr-inp cx-mq" data-q placeholder="이름 · 부서 찾기" aria-label="사람 찾기"><div class="cx-plist" data-list></div>' +
        (k === 'group' ? '<div class="cx-mfoot"><span data-n>0명 고름</span><button type="button" class="wm-pri" data-go disabled>만들기</button></div>' : '');
      var picked = [];
      _cxPeoplePick(pane, k === 'group', null, function (ids, partial) {
        if (k === 'dm') { m.close(); chatStartDm(ids[0]); return; }
        picked = ids; pane.querySelector('[data-n]').textContent = ids.length + '명 고름'; pane.querySelector('[data-go]').disabled = !ids.length;
      });
      var go = pane.querySelector('[data-go]');
      if (go) go.addEventListener('click', function () {
        go.disabled = true;
        apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: pane.querySelector('[data-name]').value, userIds: picked }) })
          .then(function (r) { m.close(); return _cxLoadRooms().then(function () { chatOpenRoom(r.data.id); }); }).catch(function (e) { go.disabled = false; _cxToast(_cxErr(e), 'error'); });
      });
      var qi = pane.querySelector('[data-q]'); if (qi) qi.focus();
    }
    m.box.querySelectorAll('[data-k]').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.k); }); });
    show('dm');
  }, 'chatNewModal');
}
function chatInviteModal() {
  if (!CX.info) return;
  return wmGuardedModal('chatInvite', function () {
    var m = createModal({ id: 'chatInvModal', title: '➕ 사람 초대', width: '420px', closeOnEsc: true, closeOnOverlay: true,
      html: '<input class="wr-inp cx-mq" data-q placeholder="이름 · 부서 찾기"><div class="cx-plist" data-list></div>' +
        '<label class="cx-hist"><input type="checkbox" data-hist checked> <span><b>이전 대화도 보여 주기</b><i>끄면 초대한 다음부터만 보입니다 (게시판 · 파일 · 찾기도)</i></span></label>' +
        '<div class="cx-mfoot"><span data-n>0명</span><button type="button" class="wm-pri" data-go disabled>초대</button></div>' });
    var picked = [];
    _cxPeoplePick(m.box, true, CX.info.members.map(function (x) { return x.id; }), function (ids) { picked = ids; m.box.querySelector('[data-n]').textContent = ids.length + '명'; m.box.querySelector('[data-go]').disabled = !ids.length; });
    m.box.querySelector('[data-go]').addEventListener('click', function () {
      apiFetch('/api/chat/rooms/' + CX.room + '/members', { method: 'POST', body: JSON.stringify({ userIds: picked, history: m.box.querySelector('[data-hist]').checked }) }).then(function () { m.close(); chatOpenRoom(CX.room, true); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
    });
  }, 'chatInvModal');
}
function chatForwardModal(msg) {
  return wmGuardedModal('chatFwd', function () {
    var m = createModal({ id: 'chatFwdModal', title: '↪ 전달', width: '420px', closeOnEsc: true, closeOnOverlay: true,
      html: '<div class="cx-fwd-p"></div><div class="cx-plist" data-list>' + CX.rooms.filter(function (r) { return r.id !== CX.room; }).map(function (r) { return '<button type="button" class="cx-pp" data-r="' + _cxE(r.id) + '">' + (r.kind === 'dm' ? _cxAv(r.peerId, r.name) : '<span class="cx-av cx-av-g">' + (r.kind === 'project' ? '📁' : '👥') + '</span>') + '<span><b>' + _cxE(r.name) + '</b></span><em></em></button>'; }).join('') + '</div><div class="cx-mfoot"><span data-n>0곳</span><button type="button" class="wm-pri" data-go disabled>보내기</button></div>' });
    m.box.querySelector('.cx-fwd-p').textContent = (msg.body || (msg.file ? '📎 ' + msg.file.name : '')).slice(0, 120);
    var pick = {};
    m.box.querySelectorAll('[data-r]').forEach(function (b) { b.addEventListener('click', function () { if (pick[b.dataset.r]) delete pick[b.dataset.r]; else if (Object.keys(pick).length < 10) pick[b.dataset.r] = 1; b.classList.toggle('on', !!pick[b.dataset.r]); b.querySelector('em').textContent = pick[b.dataset.r] ? '✓' : ''; var n = Object.keys(pick).length; m.box.querySelector('[data-n]').textContent = n + '곳'; m.box.querySelector('[data-go]').disabled = !n; }); });
    m.box.querySelector('[data-go]').addEventListener('click', function () {
      apiFetch('/api/chat/messages/' + msg.id + '/forward', { method: 'POST', body: JSON.stringify({ roomIds: Object.keys(pick) }) }).then(function (r) { m.close(); _cxToast('↪ ' + r.data.sent + '곳에 보냈습니다', 'success'); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
    });
  }, 'chatFwdModal');
}
/* ＋ 업무 카드 — 통합 검색에서 고르기 */
var CX_CAT_L = { project: '프로젝트', milestone: '마일스톤', issue: '이슈', order: '수주', meeting: '회의', mindmap: '마인드맵', doc: '문서', dev: '개발', checklist: '체크리스트', as: 'A/S', todo: '내 할 일', note: '노트', weekly: '주간 보고', prestudy: '사전검토', tech: '요소기술', work: '업무일지', comment: '피드백', member: '사람', message: '메시지' };
function chatCardPicker(inThread) {
  return wmGuardedModal('chatCard', function () {
    var m = createModal({ id: 'chatCardModal', title: '＋ 업무 카드 붙이기', width: '520px', closeOnEsc: true, closeOnOverlay: true,
      html: '<input class="wr-inp cx-mq" data-q placeholder="이슈 · 프로젝트 · 마일스톤 · 문서 · 회의 … 찾기" aria-label="업무 찾기"><div class="cx-plist cx-cardlist" data-list><div class="cx-empty">찾을 말을 적으세요 — 고르면 대화에 카드로 붙고, 누르면 그 화면으로 갑니다. 이슈 카드는 대화에서 바로 대응 · 해결 처리</div></div>' });
    var qt, q = m.box.querySelector('[data-q]'); q.focus();
    q.addEventListener('input', function () {
      clearTimeout(qt); var v = q.value.trim(); if (v.length < 1) return;
      qt = setTimeout(function () {
        apiFetch('/api/search?limit=5&q=' + encodeURIComponent(v)).then(function (r) {
          var gs = ((r.data && r.data.groups) || []).filter(function (g) { return g.items && g.items.length && CX_CAT_L[g.key]; });
          var all = [];
          m.box.querySelector('[data-list]').innerHTML = gs.map(function (g) { return '<div class="cx-ctx-h">' + (CX_ICON[g.key] || '') + ' ' + CX_CAT_L[g.key] + ' <i>' + g.total + '</i></div>' + g.items.map(function (it) { all.push({ type: g.key, id: it.id, title: it.title, sub: it.sub, nav: it.nav }); return '<button type="button" class="cx-pp" data-ci="' + (all.length - 1) + '"><span class="cx-card-i">' + (CX_ICON[g.key] || '🔗') + '</span><span><b>' + _cxE(it.title) + '</b><i>' + _cxE(it.sub || '') + '</i></span></button>'; }).join(''); }).join('') || '<div class="cx-empty">없음</div>';
          m.box.querySelectorAll('[data-ci]').forEach(function (b) { b.addEventListener('click', function () {
            var c = all[+b.dataset.ci];
            m.close();
            if (inThread) { _cxSend('', CX.thread, [c]); return; }
            if (CX.cards.length >= 5) { _cxToast('카드는 5개까지', 'warn'); return; }
            CX.cards.push(c); _cxDrawChips();
            var ta = document.getElementById('cxIn'); if (ta) ta.focus();
          }); });
        }).catch(function () {});
      }, 220);
    });
  }, 'chatCardModal');
}

/* ─── 예전 이름 (다른 화면에서 부르는 것) ─── */
function msgOpenThread(userId) { return chatStartDm(userId); }
function msgComposeTo(userId) { if (typeof setPage === 'function') setPage('messages'); return chatStartDm(userId); }
if (typeof window !== 'undefined') {
  window.renderMessages = renderMessages; window.refreshMsgBadge = refreshMsgBadge; window.msgOpenThread = msgOpenThread; window.msgComposeTo = msgComposeTo;
  window.chatOpenRoom = chatOpenRoom; window.chatOpenProject = chatOpenProject; window.chatStartDm = chatStartDm;
}
