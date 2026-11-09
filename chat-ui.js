/* chat-ui.js — 💬 사내 메신저 화면 (v13.315)
 *   예전 ✉️ 쪽지 화면(messages-ui.js, v13.315 에 지움)을 대신함 — 같은 #mMessages · renderMessages · msgOpenThread · msgComposeTo · refreshMsgBadge 이름을 덮어씀
 *   서버 /api/chat (server/routes/chat.js) · 실시간은 fetch 스트림(SSE, Authorization 헤더 그대로)
 *   기본: 방 목록(고정 · 알림 끔 · 안 읽음 · @) · 말풍선 · 날짜 줄 · 안 읽은 사람 수 · 입력 중 · 답글 줄기 · 공감 · 공지 · 전달 · 수정/삭제 · 파일(끌어 놓기 · 붙여넣기 · 사진 미리보기) · 찾기
 *   데이터: ＋업무 카드(통합 검색) · 이슈 카드 버튼 · 프로젝트 방 옆 현황 · /todo /issue /ai /요약
 *   화면 공유는 chat-rtc.js
 * 의존(전역): apiFetch, API_BASE, _accessToken, currentUser, eH, showToast, createModal, wmGuardedModal, globalSearchNav, setPage, rMD */
var CX = { rooms: [], room: null, info: null, msgs: [], reads: {}, more: false, users: null, cards: [], replyTo: null, editId: null, thread: null, threadMsgs: [], typing: {}, ctx: null, aside: true, q: '', loading: false, blobs: {},
  cache: {}, cacheOrder: [], readMark: null, newBelow: 0, rf: _cxLsGet('wm-cx-rf') || 'all', drafts: (function () { try { return JSON.parse(_cxLsGet('wm-cx-drafts') || '{}') || {}; } catch (e) { return {}; } })(), pendSeq: 0 };
/* v13.366 — 브라우저 저장소(없거나 막혀도 그냥 넘어감) · 한 박자 모아 그리기 */
function _cxLsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _cxLsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
var _cxSoonQ = {};
function _cxSoon(key, fn) {
  if (_cxSoonQ[key]) return;
  _cxSoonQ[key] = true;
  var run = function () { _cxSoonQ[key] = false; fn(); };
  if (document.hidden || typeof requestAnimationFrame !== 'function') setTimeout(run, 120); else requestAnimationFrame(run);
}
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
function _cxAv(id, name, on) { if (typeof chatAvHtml === 'function') return chatAvHtml(id, name, on); return '<span class="cx-av" style="--h:' + _cxHue(id) + '">' + _cxE(_cxInit(name)) + (on ? '<i class="cx-on"></i>' : '') + '</span>'; }   // v13.378 프로필 사진
/* 글 → HTML (이스케이프 뒤 링크 · @멘션 · 줄바꿈) */
function _cxText(s) {
  if (typeof chatCodeText === 'function') return chatCodeText(s);   // v13.358 ``` 코드 블록 · `한 줄 코드`
  var h = _cxE(s || '');
  h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  h = h.replace(/(^|\s)@([^\s@<]{1,20})/g, '$1<b class="cx-at">@$2</b>');
  return h.replace(/\n/g, '<br>');
}

/* ─── 실시간 스트림 ─── */
var CXS = { ctrl: null, on: false, backoff: 1000, timer: null, cid: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) };   // cid — 이 탭 · 앱 (v13.371 가려짐 알리기)
function chatStreamStart() {
  if (CXS.on || typeof apiFetch !== 'function' || !_cxMe() || (typeof AUTH_SKIP !== 'undefined' && AUTH_SKIP)) return;
  CXS.on = true;
  var ctrl = CXS.ctrl = new AbortController();
  fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/stream?cid=' + CXS.cid + (document.hidden ? '&away=1' : ''), { headers: { Authorization: 'Bearer ' + (typeof _accessToken !== 'undefined' ? _accessToken : '') }, signal: ctrl.signal, cache: 'no-store' })
    .then(function (res) {
      if (res.status === 401) { CXS.on = false; return apiFetch('/api/chat/unread-count').then(function () { CXS.timer = setTimeout(chatStreamStart, 500); }); }   // 토큰 새로 받고 다시
      if (!res.ok || !res.body) throw new Error('stream ' + res.status);
      CXS.backoff = 1000; CXS.seen = Date.now();
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) throw new Error('closed');
          CXS.seen = Date.now();
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
      CXS.timer = setTimeout(chatStreamStart, Math.round(CXS.backoff * (0.6 + Math.random() * 0.8)));   // v13.366 흩어서 다시 붙기
      CXS.backoff = Math.min(30000, CXS.backoff * 2);
    });
}
function chatStreamStop() { CXS.on = false; clearTimeout(CXS.timer); if (CXS.ctrl) CXS.ctrl.abort(); }
/* v13.382 조용히 끊긴 연결 살리기 — 서버는 25초마다 신호를 보냄. 70초 넘게 아무것도 안 오면(잠자기 · 망 바뀜 · 중간 장비가 끊음)
 *   새로 붙음. 예전엔 죽은 연결을 붙든 채 기다려 📞 통화 · 메시지를 못 받았음(창을 숨겨 둔 PC 앱에서 특히) */
function _cxsRevive(force) {
  if (!CXS.on || !CXS.ctrl || CXS.ctrl.signal.aborted) { if (force && !CXS.on && _cxMe()) { clearTimeout(CXS.timer); CXS.backoff = 1000; chatStreamStart(); } return; }
  if (!force && !(CXS.seen && Date.now() - CXS.seen > 70000)) return;
  var c = CXS.ctrl; CXS.ctrl = null; CXS.on = false; c.abort(); clearTimeout(CXS.timer); CXS.backoff = 1000; chatStreamStart();
}
setInterval(function () { _cxsRevive(false); }, 20000);
window.addEventListener('online', function () { _cxsRevive(true); });   // 망이 돌아오면 바로
document.addEventListener('visibilitychange', function () { if (!document.hidden) _cxsRevive(false); });
/* 로그인되면 붙고, 나가면 끊고 */
setInterval(function () { if (_cxMe()) { if (!CXS.on) chatStreamStart(); } else if (CXS.on) chatStreamStop(); }, 2000);

function _cxVisibleRoom(id) {
  var page = document.getElementById('mMessages');
  return CX.room === id && page && !page.classList.contains('hidden') && !document.hidden;
}
function chatOnEvent(ev, d) {
  if (ev === 'hello') {   // (다시) 붙으면 놓친 것 반영 — 열린 방 메시지도
    if (typeof chatAlertOnHello === 'function') chatAlertOnHello();   // v13.371 가려짐 상태 맞추기
    setTimeout(_cxRetryWaiting, 500);   // v13.380 ⏳
    if (CX.hadHello && typeof wmUpdateCheck === 'function') setTimeout(function () { wmUpdateCheck(true); }, 1500);   // v13.374 다시 붙음 = 서버가 다시 켜졌을 수 있음(새 배포)
    if (CX.rooms.length) _cxLoadRooms(); else chatBadge();
    if (CX.hadHello && CX.room && CX.msgs.length) _cxCatchUp();
    CX.hadHello = true; return;
  }
  if (ev === 'msg') {
    var mine = d.userId === _cxMe();
    var r = CX.rooms.filter(function (x) { return x.id === d.roomId; })[0];
    if (r) {
      if (!d.replyTo && typeof d.id === 'number') r.lastId = Math.max(r.lastId || 0, d.id);
      _cxPfDrop(d.roomId);
      r.lastAt = d.at; r.last = { userName: d.userName, body: d.deleted ? '(지운 메시지)' : d.post ? '📌 ' + d.post.title : d.file && !d.body ? (_cxIsPhoto(d.file) ? '📷 사진' : /^audio\//.test(d.file.mime || '') ? '🎤 음성 메시지' : '📎 ' + d.file.name) : d.body, mine: mine, kind: d.kind };
      if (!mine && !d.replyTo && d.kind !== 'system' && !_cxVisibleRoom(d.roomId)) { r.unread = (r.unread || 0) + 1; if ((d.mentions || []).indexOf(_cxMe()) >= 0) r.mentioned = (r.mentioned || 0) + 1; }
      CX.rooms.sort(function (a, b) { return (b.pinned - a.pinned) || (new Date(b.lastAt) - new Date(a.lastAt)); });
    } else _cxLoadRooms();
    if (CX.room === d.roomId) {
      if (d.replyTo) { if (CX.thread === d.replyTo) { CX.threadMsgs.push(d); _cxDrawThread(true); } }
      else if (CX.fwd && !mine) { CX.newBelow++; _cxNewBtn(); }   // v13.375 옛 대화를 읽는 중 — 최근으로 가면 보임
      else if (CX.fwd && mine) { _cxToLatest(); }
      else { if (!(d.userId === _cxMe() && _cxSettlePending(d))) _cxUpsert(d); _cxDrawMsgs(true); _cxCacheTouch(); }
      if (_cxVisibleRoom(d.roomId)) _cxMarkRead();
    }
    if (CX.typing[d.roomId]) { delete CX.typing[d.roomId][d.userId || 'ai']; _cxDrawTyping(); }
    if (CX.room === d.roomId && (d.kind === 'system' || (d.cards || []).some(function (c) { return c.type === 'issue'; }))) _cxCtxRefresh();
    _cxDrawRooms();
    chatBadge();
    if (d.post && CX.aside && CX.asideTab === 'board' && CX.room === d.roomId && typeof chatPostsTab === 'function') chatPostsTab();
    var kwHit = !mine && _cxKwHit(d.body);   // v13.380 🔑
    if (!mine && d.kind !== 'system' && !_cxVisibleRoom(d.roomId) && !(r && r.muted && (d.mentions || []).indexOf(_cxMe()) < 0 && !kwHit)) _cxNotify(kwHit ? Object.assign({}, d, { kw: kwHit }) : d, r);
  } else if (ev === 'upd') {
    _cxPfDrop(d.roomId);
    if (d.post && typeof chatCollabOnUpd === 'function') chatCollabOnUpd(d);
    if (CX.room === d.roomId && (d.cards || []).some(function (c) { return c.type === 'issue'; })) _cxCtxRefresh();
    if (CX.room === d.roomId) {
      if (d.replyTo && CX.thread === d.replyTo) { CX.threadMsgs = CX.threadMsgs.map(function (m) { return m.id === d.id ? d : m; }); _cxDrawThread(); }
      if (CX.thread === d.id && CX.threadMsgs.length) { CX.threadMsgs[0] = d; _cxDrawThread(); }
      if (!d.replyTo && _cxUpsert(d, true)) _cxDrawMsgs();
    }
  } else if (ev === 'read' || ev === 'reads') {   // v13.366 'reads' = 1초 동안 모은 읽음
    (ev === 'reads' ? d.list || [] : [d]).forEach(function (x) { _cxOnRead(d.roomId, x.userId, x.id); });
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
    _cxDrawRooms(); _cxSoon('head', _cxDrawHead);
    if (CX.aside && !CX.thread && _cxAsideTab() === 'people') _cxSoon('aside', _cxDrawAside);   // v13.366 답글 입력 · 다른 탭은 그대로
  } else if (ev === 'notice') {
    if (CX.room === d.roomId && CX.info) { CX.info.notice = d.notice; _cxDrawNotice(); }
  } else if (ev === 'room') {   // v13.359 역할 · 내보내기
    if (d.removed && d.removed === _cxMe()) { CX.rooms = CX.rooms.filter(function (r) { return r.id !== d.roomId; }); if (CX.room === d.roomId) { CX.room = null; _cxDrawMain(); } _cxDrawRooms(); _cxToast('대화방에서 내보내졌습니다', 'warn'); return; }
    if (CX.room === d.roomId) apiFetch('/api/chat/rooms/' + encodeURIComponent(d.roomId)).then(function (r) { if (CX.room !== d.roomId) return; var was = CX.info && CX.info.myRole; CX.info = r.data; _cxDrawHead(); _cxDrawAside(); if (was !== CX.info.myRole) { _cxDrawMain(); _cxDrawHead(); _cxDrawNotice(); _cxDrawMsgs(); } }).catch(function () {});
  } else if (ev === 'status' || ev === 'avatar') {   // v13.378 🙂 상태 · 🖼 프로필 사진
    if (typeof chatProfileOnEvent === 'function') chatProfileOnEvent(ev, d);
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
/* v13.366 읽음 — 내 것은 방 목록 숫자, 남의 것은 메시지 옆 숫자 */
function _cxOnRead(roomId, uid, id) {
  if (CX.room === roomId) { CX.reads[uid] = Math.max(CX.reads[uid] || 0, id); _cxSoon('reads', _cxDrawReadCounts); }
  else if (CX.cache[roomId]) CX.cache[roomId].reads[uid] = Math.max(CX.cache[roomId].reads[uid] || 0, id);
  if (uid === _cxMe()) { var rr = CX.rooms.filter(function (x) { return x.id === roomId; })[0]; if (rr && (rr.unread || rr.mentioned)) { rr.unread = 0; rr.mentioned = 0; _cxDrawRooms(); chatBadge(); } }
}
/* 실시간으로 내 메시지가 먼저 오면 '보내는 중' 자리를 그것으로 바꿈 */
function _cxSettlePending(d) {
  for (var i = 0; i < CX.msgs.length; i++) { var p = CX.msgs[i]; if (p.pending && !p.failed && !p.realId && p.body === d.body) { p.realId = d.id; CX.msgs[i] = d; return true; } }
  return false;
}
/* 끊겼다 다시 붙으면 열린 방의 놓친 메시지 */
function _cxCatchUp() {
  var my = CX.room;
  apiFetch('/api/chat/rooms/' + encodeURIComponent(my) + '/messages').then(function (r) {
    if (CX.room !== my) return;
    CX.msgs = _cxMergeNewer(r.data || [], true); CX.more = !!r.more;
    (r.reads || []).forEach(function (x) { CX.reads[x.userId] = Math.max(CX.reads[x.userId] || 0, x.id); });
    _cxDrawMsgs(true); _cxCacheTouch();
    if (_cxVisibleRoom(my)) _cxMarkRead();
  }).catch(function () {});
}
/* 방 담아 두기 — 다시 열 때 바로 보이고 뒤에서 새로 받음 (최근 12곳) */
function _cxCacheTouch() {
  if (!CX.room || !CX.info) return;
  CX.cache[CX.room] = { info: CX.info, msgs: CX.msgs.filter(function (m) { return !m.pending; }), more: CX.more, reads: Object.assign({}, CX.reads) };
  CX.cacheOrder = CX.cacheOrder.filter(function (x) { return x !== CX.room; }); CX.cacheOrder.push(CX.room);
  while (CX.cacheOrder.length > 12) delete CX.cache[CX.cacheOrder.shift()];
  if (typeof chatLocalSave === 'function') chatLocalSave();
}
function _cxAsideTab() { return CX.asideTab || (CX.info && CX.info.kind === 'project' ? 'ctx' : CX.info && CX.info.equipKey ? 'equip' : 'people'); }
/* 보낸 응답으로는 없을 때만 넣음 — 실시간으로 먼저 온 더 새 모습(공감 · 수정)을 옛 응답이 덮지 않게 */
function _cxAddIfNew(m) { if (CX.msgs.some(function (x) { return x.id === m.id; })) return false; CX.msgs.push(m); return true; }
function _cxUpsert(m, onlyReplace) {
  for (var i = CX.msgs.length - 1; i >= 0; i--) if (CX.msgs[i].id === m.id) { CX.msgs[i] = m; return true; }
  if (onlyReplace) return false;
  CX.msgs.push(m); return true;
}

/* 새 메시지 알림 — 화면 안 작은 창(누르면 그 방) · 탭이 가려져 있으면 브라우저 알림 */
/** 🔑 키워드 — 글에 있으면 그 낱말 */
function _cxKwHit(body) {
  var t = String(body || '').toLowerCase(); if (!t || !CX.kw || !CX.kw.length) return null;
  for (var i = 0; i < CX.kw.length; i++) { var k = String(CX.kw[i]).toLowerCase(); if (k.length >= 2 && t.indexOf(k) >= 0) return CX.kw[i]; }
  return null;
}
function chatKeywordsLoad() { if (typeof apiFetch === 'function' && _cxMe()) apiFetch('/api/chat/me/keywords').then(function (r) { CX.kw = (r && r.data) || []; }).catch(function () {}); }
function _cxNotify(d, r) {
  if (typeof chatFocusMute === 'function' && chatFocusMute(d)) return;   // v13.363 🎯 집중 중이면 미룸
  var title = (r && r.kind !== 'dm' ? r.name + ' · ' : '') + (d.userName || 'AI');
  var body = d.file && !d.body ? '📎 ' + d.file.name : (d.body || '').slice(0, 120);
  // v13.355 PC 앱: 창이 앞에 없으면(다른 프로그램 작업 중 · 트레이) 윈도우 알림 — 누르면 창이 앞으로 + 그 방으로
  var at = (d.mentions || []).indexOf(_cxMe()) >= 0 || !!d.kw;
  if (d.kw) title = '🔑 ' + d.kw + ' · ' + title;
  if (typeof wmIsDesktopApp === 'function' && wmIsDesktopApp() && !document.hasFocus()) { wmAppNotify('💬 ' + title, body, 'chat:' + d.roomId); if (typeof chatAlertPing === 'function') chatAlertPing({ mention: at, silent: true }); return; }
  if (typeof chatAlertPing === 'function') chatAlertPing({ mention: at });   // v13.371 🔔 소리 · 진동 · 💬 아이콘 흔들기
  if (document.hidden) {
    // 푸시를 켠 기기는 서버가 보냄(가려진 화면 → 푸시) — 여기서 또 띄우면 두 번
    if (typeof chatAlertSysNotify === 'function') chatAlertSysNotify('💬 ' + title, body, d.roomId);
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
  function set(k) { if (typeof wmAppBadge === 'function') wmAppBadge(k); if (typeof chatAlertTitle === 'function') chatAlertTitle(k); if (k > 0) { b.textContent = k > 99 ? '99+' : k; b.style.display = 'inline-flex'; } else b.style.display = 'none'; }
  if (n != null) return set(n);
  if (typeof apiFetch === 'function' && _cxMe()) apiFetch('/api/chat/unread-count').then(function (r) { set((r && r.count) || 0); }).catch(function () {});
}
function refreshMsgBadge() { if (!CX.rooms.length) chatBadge(); else _cxLoadRooms(); }

/* ─── 화면 틀 ─── */
function renderMessages() {
  var el = document.getElementById('mMessages'); if (!el) return;
  if (!el.querySelector('.cx')) {
    el.innerHTML = '<div class="cx no-aside' + (CX.room ? ' has-room' : '') + (_cxLsGet('wm-cx-side-off') ? ' side-off' : '') + '">' +
      '<aside class="cx-side"><div class="cx-side-h"><button type="button" class="cx-me" id="cxMe" title="🙂 내 프로필 · 상태">' + _cxAv(_cxMe(), (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '') + '</button><b>💬 메신저</b><span class="cx-side-a"><button type="button" class="cx-ib" id="cxFocus" title="🎯 집중 모드 — 방해 금지 · 메신저만 크게">🎯</button><button type="button" class="cx-ib" id="cxReqs" title="🛠 요청함 — 나에게 온 · 내가 올린 요청">🛠</button><button type="button" class="cx-ib" id="cxFolders" title="📁 내 폴더 — 모아 둔 메시지 · 사진 · 파일">📂</button><button type="button" class="cx-ib" id="cxOrgBtn" title="🏢 조직도 — 부서별 사람 · 접속 · 상태">🏢</button><button type="button" class="cx-ib" id="cxAlertBtn" title="🔔 알림 — 소리 · 진동 · 휴대폰 알림">🔔</button><button type="button" class="cx-ib" id="cxNew" title="새 대화 (사람 · 그룹 · 프로젝트 방)">＋</button></span></div>' +
      '<div class="cx-sq"><input id="cxQ" type="search" placeholder="대화방 · 메시지 찾기  (Ctrl+K 방 이동)" aria-label="대화방 · 메시지 찾기"></div>' +
      '<div class="cx-rf" id="cxRf" role="tablist">' + [['all', '전체'], ['unread', '안 읽음'], ['at', '@나'], ['dm', '1:1'], ['group', '그룹'], ['project', '프로젝트']].map(function (f) { return '<button type="button" data-rf="' + f[0] + '" class="' + (CX.rf === f[0] ? 'on' : '') + '">' + f[1] + '</button>'; }).join('') + '</div>' +
      '<div class="cx-perm" id="cxPerm" hidden><span data-pt>🔔 앱을 닫아 두어도 새 메시지 알림을 받을까요?</span><button type="button" id="cxPermOn">알림 켜기</button><button type="button" class="cx-perm-x" id="cxPermX" title="닫기" aria-label="닫기">✕</button></div>' +
      '<div class="cx-rooms" id="cxRooms" role="list"></div></aside>' +
      '<section class="cx-main" id="cxMain"></section>' +
      '<aside class="cx-aside" id="cxAside"></aside></div>';
    el.querySelector('#cxNew').addEventListener('click', chatNewModal);
    el.querySelector('#cxOrgBtn').addEventListener('click', function () { if (typeof chatOrgToggle === 'function') chatOrgToggle(); });
    el.querySelector('#cxMe').addEventListener('click', function () { if (typeof chatProfileModal === 'function') chatProfileModal(); });
    if (typeof chatAvatarsLoad === 'function' && !CX.avInit) { CX.avInit = true; chatAvatarsLoad(); chatKeywordsLoad(); }
    if (typeof chatFocusMenu === 'function') { el.querySelector('#cxFocus').addEventListener('click', function (e) { chatFocusMenu(e.currentTarget); }); if (!CX.focusInit) { CX.focusInit = true; chatFocusInit(); } }
    if (typeof chatLibrary === 'function') { el.querySelector('#cxReqs').addEventListener('click', function () { chatLibrary('reqs'); }); el.querySelector('#cxFolders').addEventListener('click', function () { chatLibrary('folders'); }); }
    el.querySelector('#cxRf').addEventListener('click', function (e) { var b = e.target.closest('[data-rf]'); if (!b) return; CX.rf = b.dataset.rf; _cxLsSet('wm-cx-rf', CX.rf); el.querySelectorAll('#cxRf [data-rf]').forEach(function (x) { x.classList.toggle('on', x === b); }); _cxDrawRoomsNow(); });
    var q = el.querySelector('#cxQ'), qt;
    q.addEventListener('input', function () { CX.q = q.value.trim(); clearTimeout(qt); qt = setTimeout(_cxSearch, 250); _cxDrawRooms(); });
    if (typeof chatAlertBindUi === 'function') chatAlertBindUi(el);   // v13.371 🔔 알림 설정 · 켜기 안내 (chat-alert.js)
    else if ('Notification' in window && Notification.permission === 'default') { el.querySelector('#cxPerm').hidden = false; el.querySelector('#cxPermOn').addEventListener('click', function () { Notification.requestPermission().then(function () { el.querySelector('#cxPerm').hidden = true; }); }); }
  }
  if (typeof _cfBar === 'function') _cfBar();
  _cxFull();
  if (!CX.rooms.length && typeof chatLocalLoad === 'function' && !CX.localTried) {   // v13.380 열자마자 — 담아 둔 목록 · 최근 방
    CX.localTried = true;
    chatLocalLoad().then(function (v) {
      if (!v || CX.rooms.length) return;
      CX.rooms = v.rooms || []; Object.keys(v.cache || {}).forEach(function (id) { if (!CX.cache[id]) { CX.cache[id] = v.cache[id]; CX.cacheOrder.push(id); } });
      _cxDrawRoomsNow(); chatBadge();
      if (CX.room && CX.cache[CX.room] && !CX.msgs.length) chatOpenRoom(CX.room);
    });
  }
  var want = CX.pending || CX.room, wantMid = CX.pendingMid; CX.pending = null; CX.pendingMid = null;
  // v13.372 목록을 받는 사이 다른 곳에서 방을 열었으면(알림 · 검색 · 바로 가기) 그대로 둠 — 예전엔 다시 열거나 빈 화면으로 덮어 "불러오는 중" 에 멈춤
  // v13.382 열 방(부른 방 · PC 는 마지막에 보던 방)은 목록을 기다리지 않고 같이 받기 — 예전: 목록 → 방 내용 차례로(왕복 2번)
  var wide = window.innerWidth > 760, last = wide ? _cxLsGet('wm-cx-last') : null, guess = want && !wantMid ? want : !want && !CX.room ? last : null;
  if (guess && !CX.cache[guess] && !(CX.pf[guess] && Date.now() - CX.pf[guess].t < 15000)) { var gp = _cxFetchRoomNow(guess); CX.pf[guess] = { t: Date.now(), p: gp }; gp.catch(function () { if (CX.pf[guess] && CX.pf[guess].p === gp) delete CX.pf[guess]; }); }
  var room0 = CX.room;
  _cxLoadRooms().then(function () {
    if (CX.room !== room0) return;   // v13.385 목록을 받는 사이 다른 방을 열었으면 그대로 (예전: 처음 방을 다시 열어 덮음)
    if (want) chatOpenRoom(want, false, wantMid); else if (CX.room) return;
    else if (wide && CX.rooms[0]) chatOpenRoom(last && CX.rooms.some(function (r) { return r.id === last; }) ? last : CX.rooms[0].id);
    else _cxDrawMain();
  });
}
/* v13.385 휴대폰 — 대화방에 들어가면 앱 머리 · 탭 줄을 숨겨 세로를 다 씀(카톡처럼). 목록으로 나오면 다시 보임.
 *   CSS 는 메신저 화면일 때만 적용(html.cx-full:has(#mMessages:not(.hidden))) → 다른 탭으로 가면 저절로 돌아옴 */
function _cxFull() {
  var root = document.querySelector('#mMessages .cx');
  var on = !!(root && _cxIsPhone() && root.classList.contains('has-room'));
  if (document.documentElement.classList.contains('cx-full') !== on) document.documentElement.classList.toggle('cx-full', on);
  _cxFit();
}
/* v13.371 휴대폰 — 메신저를 보이는 화면 높이에 딱 맞춤(주소창 · 키보드가 올라와도 입력칸이 가려지지 않게) */
function _cxFit() {
  var page = document.getElementById('mMessages'), cx = page && page.querySelector('.cx');
  if (!cx || page.classList.contains('hidden')) return;
  var ta = document.getElementById('cxIn'), cp = ta && ta.closest('.cx-comp');   // v13.373 칸 너비 따라 안내 글 길이
  if (cp && cp.offsetWidth) ta.placeholder = cp.offsetWidth < 620 ? '메시지 입력' : '메시지 · @사람 · /명령';
  if (!_cxIsPhone()) { page.style.removeProperty('--cx-h'); return; }
  if (_cxKbOpen()) return;   // v13.374 키보드가 떠 있는 동안은 줄이지 않음(_cxKb 가 맡음) — 줄이면 아이폰이 페이지를 밀어 올려 입력칸이 위로 감
  var vv = window.visualViewport, vh = vv ? vv.height : window.innerHeight;
  var top = cx.getBoundingClientRect().top + (window.scrollY || 0);   // 문서 안 자리 (머리 · 탭 아래)
  page.style.setProperty('--cx-h', Math.max(300, Math.round(vh - top)) + 'px');   // v13.384 휴대폰은 화면 끝까지 (아래 틈 없이 — 앱처럼)
}
/* v13.372 휴대폰 키보드 — 키보드가 올라오면 메신저를 보이는 화면에 딱 붙임(입력칸이 키보드 바로 위).
 *   예전: 페이지가 밀려 올라가며 입력칸이 키보드에서 멀리 떠 있거나 위로 사라짐 */
/* v13.374 키보드가 떠 있나 — 아이폰 홈 화면 앱은 키보드가 뜨면 innerHeight 도 같이 줄어(예전 판단이 안 맞음),
 *   키보드 없을 때 본 화면 높이(CX.vvBase)와 비교. 방향이 바뀌면 다시 잼 */
function _cxTextFocused() { var a = document.activeElement; return !!(a && (/^(TEXTAREA|SELECT)$/.test(a.tagName) || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range|color|file)$/i.test(a.type)) || a.isContentEditable)); }
function _cxVvBaseNote() {
  var vv = window.visualViewport; if (!vv) return;
  var o = window.innerWidth > window.innerHeight ? 'l' : 'p';
  if (CX.vvO !== o) { CX.vvO = o; CX.vvBase = 0; }
  if (!_cxTextFocused()) CX.vvBase = Math.max(CX.vvBase || 0, vv.height, window.innerHeight);
}
function _cxKbOpen() {
  var vv = window.visualViewport; if (!vv || !_cxIsPhone() || !_cxTextFocused()) return false;
  var base = CX.vvBase || 0;
  return (base && base - vv.height > 120) || window.innerHeight - vv.height > 120;
}
function _cxKb() {
  var cx = document.querySelector('#mMessages .cx'); if (!cx) return;
  _cxVvBaseNote();
  var vv = window.visualViewport, a = document.activeElement;
  var on = !!(vv && a && cx.contains(a) && _cxKbOpen());
  var box = document.getElementById('cxMsgs'), atB = box && box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (on) {
    cx.classList.add('cx-kb'); document.documentElement.classList.add('cx-kb-on');
    cx.style.top = Math.round(vv.offsetTop) + 'px'; cx.style.height = Math.round(vv.height) + 'px';
  } else if (cx.classList.contains('cx-kb')) {
    cx.classList.remove('cx-kb'); document.documentElement.classList.remove('cx-kb-on'); cx.style.top = ''; cx.style.height = ''; if (document.documentElement.classList.contains('cx-full')) window.scrollTo(0, 0);   // v13.387 아이폰이 밀어 올린 화면 되돌림(위 메뉴가 상태 표시줄 밑으로 가 안 눌리던 것)
  } else return;
  if (atB) _cxToBottom();   // v13.385
  if (typeof _cxNewBtn === 'function') _cxNewBtn();
}
(function () {
  var t, raf = 0;
  function on() { _cxVvBaseNote(); clearTimeout(t); t = setTimeout(_cxFull, 60); kb(); }
  setTimeout(_cxVvBaseNote, 0); window.addEventListener('load', _cxVvBaseNote);
  function kb() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; _cxKb(); }); }
  window.addEventListener('resize', on);
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', on); window.visualViewport.addEventListener('scroll', kb); }
  window.addEventListener('orientationchange', on);
  document.addEventListener('focusin', function () { kb(); setTimeout(_cxKb, 350); });   // 키보드가 다 올라온 뒤 한 번 더
  document.addEventListener('focusout', function () { setTimeout(_cxKb, 80); setTimeout(function () { if (document.documentElement.classList.contains('cx-full') && !_cxTextFocused() && window.scrollY) window.scrollTo(0, 0); }, 350); });
})();
/* v13.373 PC — 대화방 목록 접기(대화에만 집중 · 창을 좁혀 둘 때). 기억해 둠 */
function chatSideToggle(on) {
  var cx = document.querySelector('#mMessages .cx'); if (!cx) return;
  var off = on == null ? !cx.classList.contains('side-off') : !on;
  cx.classList.toggle('side-off', off); _cxLsSet('wm-cx-side-off', off ? '1' : null);
  _cxDrawHead();
  var ta = document.getElementById('cxIn'); if (ta && ta.offsetWidth) { ta.placeholder = ta.closest('.cx-comp').offsetWidth < 620 ? '메시지 입력' : '메시지 · @사람 · /명령'; }
}
document.addEventListener('keydown', function (e) {
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'l' || e.key === 'L' || e.code === 'KeyL') && document.querySelector('#mMessages:not(.hidden) .cx') && !_cxIsPhone()) { e.preventDefault(); chatSideToggle(); }
});
function _cxLoadRooms() {
  return apiFetch('/api/chat/rooms').then(function (r) { CX.rooms = (r && r.data) || []; _cxDrawRooms(); chatBadge(); if (document.getElementById('cxRooms')) _cxPrefetchIdle(); if (typeof chatLocalSave === 'function') chatLocalSave(); }).catch(function () {});
}
function _cxDrawRooms() { _cxSoon('rooms', _cxDrawRoomsNow); }   // v13.366 이벤트가 몰려도 한 번만
function _cxRfPass(r) {
  var f = CX.rf || 'all';
  if (f === 'all' || r.id === CX.room) return true;
  if (f === 'unread') return !!r.unread || !!r.mentioned;
  if (f === 'at') return !!r.mentioned;
  return r.kind === f;
}
function _cxDrawRoomsNow() {
  var box = document.getElementById('cxRooms'); if (!box) return;
  var q = CX.q.toLowerCase();
  var list = CX.rooms.filter(function (r) { return (!q || (r.name || '').toLowerCase().indexOf(q) >= 0) && (q || _cxRfPass(r)); });
  var rfn = { unread: 0, at: 0 };
  CX.rooms.forEach(function (r) { if (r.unread || r.mentioned) rfn.unread++; if (r.mentioned) rfn.at++; });
  document.querySelectorAll('#cxRf [data-rf]').forEach(function (b) { var k = b.dataset.rf; if (k in rfn) b.setAttribute('data-n', rfn[k] || ''); });
  var h = list.map(function (r) {
    var ic = r.self ? '<span class="cx-av cx-av-me">📝</span>' : r.kind === 'project' ? '<span class="cx-av cx-av-p">📁</span>' : r.kind === 'group' ? '<span class="cx-av cx-av-g">👥</span>' : _cxAv(r.peerId, r.name, r.online);
    var last = r.last ? (r.kind !== 'dm' && r.last.kind !== 'system' && !r.last.mine ? r.last.userName + ': ' : r.last.mine ? '나: ' : '') + (r.last.body || '') : '';
    var dr = r.id !== CX.room && CX.drafts[r.id] ? CX.drafts[r.id].replace(/\s+/g, ' ').slice(0, 60) : '';
    return '<button type="button" class="cx-r' + (r.id === CX.room ? ' on' : '') + (r.unread ? ' has-un' : '') + '" data-room="' + _cxE(r.id) + '" role="listitem">' + ic +
      '<span class="cx-r-t"><b>' + _cxE(r.name) + (r.kind !== 'dm' ? ' <i>' + r.members + '</i>' : '') + (r.pinned ? ' 📌' : '') + (r.muted ? ' 🔕' : '') + (r.peerStatus && typeof chatStatusText === 'function' ? ' <em class="cx-stc" title="' + _cxE(chatStatusText(r.peerStatus)) + '">' + _cxE(chatStatusText(r.peerStatus, true)) + '</em>' : '') + (r.peerFocus && new Date(r.peerFocus) > new Date() ? ' <em class="cf-tag" title="' + _cxE(typeof chatFocusLabel === 'function' ? chatFocusLabel(r.peerFocus) : '') + '">🎯</em>' : '') + '</b>' + (dr ? '<span class="cx-r-dr">✏️ ' + _cxE(dr) + '</span>' : '<span>' + _cxE(last) + '</span>') + '</span>' +
      '<span class="cx-r-m"><i>' + (r.lastAt ? _cxRel(r.lastAt) : '') + '</i>' + (r.mentioned ? '<em class="cx-at-b">@</em>' : '') + (r.unread ? '<em class="' + (r.muted ? 'mute' : '') + '">' + (r.unread > 99 ? '99+' : r.unread) + '</em>' : '') + '</span></button>';
  }).join('');
  if (CX.q && CX.found) h += '<div class="cx-found-h">메시지 ' + CX.found.length + '건</div>' + CX.found.map(function (m) {
    var r = CX.rooms.filter(function (x) { return x.id === m.roomId; })[0];
    return '<button type="button" class="cx-found" data-room="' + _cxE(m.roomId) + '" data-mid="' + m.id + '"><b>' + _cxE(r ? r.name : '') + ' · ' + _cxE(m.userName || '') + '</b><span>' + _cxE((m.body || (m.file ? m.file.name : '')).slice(0, 90)) + '</span><i>' + _cxRel(m.at) + '</i></button>';
  }).join('');
  if (!h) h = '<div class="cx-empty">' + (CX.q ? '찾는 대화가 없습니다' : CX.rf && CX.rf !== 'all' && CX.rooms.length ? '이 조건의 대화가 없습니다 — <b>전체</b> 를 눌러 보세요' : '아직 대화가 없습니다 — ＋ 로 시작해 보세요') + '</div>';
  if (box._h === h) return;   // 같은 모습이면 다시 안 그림
  box._h = h; box.innerHTML = h;
  if (!box._bound) {
    box._bound = true;
    box.addEventListener('click', function (e) { var b = e.target.closest('[data-room]'); if (b) chatOpenRoom(b.dataset.room, false, b.dataset.mid ? +b.dataset.mid : null); });
    // v13.372 누르기 직전(손가락 닿음 · 마우스 올림 0.1초)에 미리 받기 — 열면 거의 바로
    var hv = null;
    box.addEventListener('pointerdown', function (e) { var b = e.target.closest('.cx-r[data-room]'); if (b) _cxPrefetch(b.dataset.room); }, { passive: true });
    box.addEventListener('pointerover', function (e) { if (e.pointerType !== 'mouse') return; var b = e.target.closest('.cx-r[data-room]'); clearTimeout(hv); if (b) hv = setTimeout(function () { _cxPrefetch(b.dataset.room); }, 100); });
  }
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
  if (changed && CX.room) { _cxDraftSave(); _cxCacheTouch(); }
  CX.room = id; if (changed) _cxLsSet('wm-cx-last', id);   // v13.382 다음에 열 때 이 방부터
  // 방이 바뀌면 그 방 것만 — 예전 방의 답글 줄기 · 고른 카드 · 수정 중 · 옆 탭은 비움
  CX.fwd = false;
  if (changed) { CX.quote = null; if (CX.readFrom && CX.readFrom.room !== id) CX.readFrom = null; }
  if (changed) { CX.msgs = []; CX.info = null; CX.ctx = null; CX.cards = []; CX.replyTo = null; CX.editId = null; CX.thread = null; CX.threadMsgs = []; CX.asideTab = null; CX.readMark = null; CX.newBelow = 0; }
  var cached = changed && !focusMid && CX.cache[id];
  var reuse = !changed && !!CX.info && !!document.getElementById('cxMsgs');   // v13.366 같은 방 다시 열기 — 화면은 그대로, 내용만 새로
  var drawnRole = reuse ? CX.info.myRole : cached && cached.info ? cached.info.myRole : null;
  if (cached) { CX.info = cached.info; CX.msgs = cached.msgs.slice(); CX.more = cached.more; CX.reads = Object.assign({}, cached.reads); }   // v13.366 바로 보이기
  if (changed && window.innerWidth <= 980) CX.aside = false;   // 좁은 화면은 옆 칸이 대화를 덮으므로 닫고 시작 (📊 · ⓘ 로 열기)
  var root = document.querySelector('#mMessages .cx'); if (root) root.classList.add('has-room');
  _cxFull();   // v13.385 휴대폰 — 대화방은 화면 전체
  _cxDrawRooms(); if (!reuse) _cxDrawMain();
  if (cached) { _cxDrawHead(); _cxDrawNotice(); _cxDrawMsgs(false); _cxDrawAside(); }
  var my = id;
  if (changed && !focusMid) _cxReadEarly(id);   // v13.372 열자마자 읽음 — 내용 받기를 기다리지 않음
  (focusMid ? _cxFetchRoomNow(id, focusMid) : _cxFetchRoom(id)).then(function (rs) {
    if (CX.room !== my) return;
    CX.info = rs[0].data; CX.msgs = _cxMergeNewer(rs[1].data || [], !focusMid); CX.more = !!rs[1].more;
    CX.reads = {}; (rs[1].reads || []).forEach(function (x) { CX.reads[x.userId] = x.id; });
    if ((drawnRole === 'readonly') !== (CX.info.myRole === 'readonly')) _cxDrawMain();   // 읽기만 — 입력칸 대신 안내
    var _readBefore = CX.info.lastReadId || 0;
    if (CX.readFrom && CX.readFrom.room === my) _readBefore = Math.min(_readBefore, CX.readFrom.id);   // v13.372 먼저 보낸 읽음이 앞질렀을 때 · v13.385 방에 있는 동안 간직(같은 방을 곧바로 다시 열면 안 읽음 줄이 사라지던 것)
    if (!focusMid && !(!changed && CX.readMark != null)) { var me0 = _cxMe(); CX.readMark = CX.msgs.some(function (m) { return typeof m.id === 'number' && m.id > _readBefore && m.userId !== me0 && m.kind !== 'system'; }) ? _readBefore : null; }
    _cxDrawHead(); _cxDrawNotice(); _cxDrawMsgs(cached || reuse ? true : false, focusMid); _cxMarkRead(); _cxDrawAside(); _cxCacheTouch();
    if (!focusMid && !reuse) { CX.unUpOff = false; setTimeout(_cxUnUp, 600); setTimeout(_cxUnUp, 2100); }   // v13.385 늘 맨 아래(최근)부터 — 안 읽은 첫 줄은 ↑ 단추로 (예전: 안 읽은 첫 줄로 가 있음)
    if (focusMid) { var rr0 = CX.rooms.filter(function (x) { return x.id === my; })[0]; CX.fwd = !!(rr0 && rr0.lastId > _cxLastId()); if (CX.fwd) _cxNewBtn(); }   // v13.375 옛 자리 — 아래로 내리면 이어서
    if (typeof chatSmartPrior === 'function' && !focusMid) chatSmartPrior(CX.info);   // 👋 들어오기 전 대화
    if (CX.openThread) { var th = CX.openThread; CX.openThread = null; chatOpenThread(th); }
    if (typeof chatTimeStrip === 'function') chatTimeStrip();   // ⏰ 이 방 예약
    if (typeof chatSmartCatchup === 'function' && !focusMid && !(reuse && document.getElementById('csCatch'))) chatSmartCatchup(_readBefore);   // ✨ 안 읽은 게 많으면 요약 띠   // 요청함 · 폴더에서 글 열기
    if (CX.info.kind === 'project') apiFetch('/api/chat/rooms/' + encodeURIComponent(id) + '/context').then(function (c) { if (CX.room === my) { CX.ctx = c.data; _cxDrawAside(); } }).catch(function () {});
    var ta = document.getElementById('cxIn'); if (ta && window.innerWidth > 760) ta.focus();
  }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
}
/* v13.372 방 내용 받기 — 미리 받기(목록에 손가락 · 마우스가 올라가면, 안 읽은 방은 한가할 때)와 열기가 같은 요청을 나눠 씀 */
CX.pf = {};
function _cxFetchRoomNow(id, around) {
  var e = encodeURIComponent(id);
  return Promise.all([apiFetch('/api/chat/rooms/' + e), apiFetch('/api/chat/rooms/' + e + '/messages' + (around ? '?around=' + around : ''))]);
}
function _cxFetchRoom(id) {
  var f = CX.pf[id];
  if (f && Date.now() - f.t < 15000) { delete CX.pf[id]; return f.p; }   // 한 번만 씀 — 다음 열기는 새로
  return _cxFetchRoomNow(id);
}
function _cxPrefetch(id) {
  if (!id || id === CX.room || (CX.pf[id] && Date.now() - CX.pf[id].t < 15000) || typeof apiFetch !== 'function') return;
  var p = _cxFetchRoomNow(id);
  CX.pf[id] = { t: Date.now(), p: p };
  p.then(function (rs) {   // 열기 전에도 담아 두면 열 때 바로 그려짐
    if (CX.room === id || !CX.pf[id] || CX.pf[id].p !== p) return;
    var rd = {}; (rs[1].reads || []).forEach(function (x) { rd[x.userId] = x.id; });
    CX.cache[id] = { info: rs[0].data, msgs: rs[1].data || [], more: !!rs[1].more, reads: rd };
    CX.cacheOrder = CX.cacheOrder.filter(function (x) { return x !== id; }); CX.cacheOrder.push(id);
    while (CX.cacheOrder.length > 12) delete CX.cache[CX.cacheOrder.shift()];
  }, function () { delete CX.pf[id]; });
}
/** 새 소식이 온 방은 미리 받은 것을 버림(옛 내용을 보여 주지 않게) */
function _cxPfDrop(id) { delete CX.pf[id]; }
/** 한가할 때 안 읽은 방 3곳까지 미리 */
function _cxPrefetchIdle() {
  var run = function () { CX.rooms.filter(function (r) { return r.unread && r.id !== CX.room && !CX.cache[r.id]; }).slice(0, 3).forEach(function (r, i) { setTimeout(function () { _cxPrefetch(r.id); }, i * 300); }); };
  setTimeout(function () { if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 3000 }); else run(); }, 1500);   // v13.382 지금 여는 방이 먼저 (예전엔 같이 나가 DB 를 나눠 씀)
}
/** 열자마자 읽음 — 목록이 아는 마지막 번호로 (서버가 실제 마지막을 넘지 않게 자름) */
function _cxReadEarly(id) {
  var r = CX.rooms.filter(function (x) { return x.id === id; })[0];
  if (!r || !r.lastId || !(r.unread || r.mentioned)) return;
  CX.readFrom = { room: id, id: r.readId || 0 };   // "여기부터 안 읽음" 줄은 읽기 전 위치로
  r.unread = 0; r.mentioned = 0; r.readId = r.lastId; _cxDrawRooms(); chatBadge();
  apiFetch('/api/chat/rooms/' + encodeURIComponent(id) + '/read', { method: 'POST', body: JSON.stringify({ lastId: r.lastId }) }).catch(function () {});
}
/* v13.373 받은 목록으로 바꿀 때 — 요청이 오가는 사이 실시간으로 먼저 온 더 새 메시지는 살림(안 그러면 방금 온 메시지가 사라짐) · 보내는 중도 */
function _cxMergeNewer(got, keepNewer) {
  var mx = 0; got.forEach(function (m) { if (typeof m.id === 'number' && m.id > mx) mx = m.id; });
  var have = {}; got.forEach(function (m) { have[m.id] = 1; });
  var newer = keepNewer ? CX.msgs.filter(function (m) { return typeof m.id === 'number' && m.id > mx && !have[m.id] && m.roomId === CX.room && !m.replyTo; }) : [];
  return got.concat(newer, CX.msgs.filter(function (m) { return m.pending; }));
}
/** ⏳ 대기 중인 글 다시 보내기 (연결 돌아옴 · 다시 붙음 · 화면 다시 봄) */
function _cxRetryWaiting() {
  if (!navigator.onLine) return;
  var w = CX.msgs.filter(function (m) { return m.pending && m.failed && m.wait; });
  if (!w.length) return;
  CX.msgs = CX.msgs.filter(function (m) { return w.indexOf(m) < 0; });
  w.forEach(function (m) { _cxSend(m.body, null, m.cards, m.quote && m.quote.id); });
}
window.addEventListener('online', function () { setTimeout(_cxRetryWaiting, 800); });
document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(_cxRetryWaiting, 600); });
function _cxLastId() { for (var i = CX.msgs.length - 1; i >= 0; i--) if (typeof CX.msgs[i].id === 'number') return CX.msgs[i].id; return 0; }
function _cxMarkRead() {
  var last = _cxLastId();
  var r = CX.rooms.filter(function (x) { return x.id === CX.room; })[0];
  if (!last || (CX.reads[_cxMe()] || 0) >= last) { if (r && r.unread) { r.unread = 0; _cxDrawRooms(); chatBadge(); } return; }
  CX.reads[_cxMe()] = last;
  if (r) { r.unread = 0; r.mentioned = 0; _cxDrawRooms(); chatBadge(); }
  // v13.372 첫 번은 바로 보내고, 0.4초 안에 또 오면 끝에 한 번 (예전: 늘 0.4초 기다림)
  var room = CX.room;
  function send(rm, id) { apiFetch('/api/chat/rooms/' + encodeURIComponent(rm) + '/read', { method: 'POST', body: JSON.stringify({ lastId: id }) }).catch(function () {}); }
  if (CX.readT) { CX.readNext = { room: room, id: last }; return; }
  send(room, last);
  CX.readT = setTimeout(function () { CX.readT = null; var n = CX.readNext; CX.readNext = null; if (n) send(n.room, n.id); }, 400);
}
document.addEventListener('visibilitychange', function () { if (!document.hidden && CX.room && _cxVisibleRoom(CX.room)) _cxMarkRead(); });

function _cxDrawMain() {
  var m = document.getElementById('cxMain'); if (!m) return;
  var root = document.querySelector('#mMessages .cx'); if (root && !CX.room) root.classList.add('no-aside');
  if (typeof chatWallApply === 'function') chatWallApply();   // v13.396 🎨 대화방 배경 (chat-wall.js)
  if (!CX.room) { m.innerHTML = '<div class="cx-blank"><div>💬</div><b>대화를 고르거나 새로 시작하세요</b><span>업무 카드 · 프로젝트 방 현황 · /ai 로 데이터에 바로 묻기</span></div>'; return; }
  m.innerHTML = '<header class="cx-h" id="cxHead"></header><div class="cx-notice" id="cxNotice" hidden></div>' +
    '<div class="cx-msgs" id="cxMsgs" tabindex="0" aria-live="polite"><div class="cx-loading">불러오는 중…</div></div>' +
    '<div class="cx-typing" id="cxTyping"></div>' + (CX.info && CX.info.myRole === 'readonly' ? '<div class="cx-ro">👁 읽기만 하는 멤버입니다 — 글 · 파일을 올리려면 방장에게 말해 주세요</div>' : _cxComposerHtml('cxIn', 'cxComp')) +
    '<div class="cx-drop" id="cxDrop" hidden>여기에 놓으면 보냅니다</div>' +
    '<button type="button" class="cx-newb" id="cxNewB" hidden>↓ <span></span></button>' +
    '<button type="button" class="cx-unup" id="cxUnUp" hidden>↑ <span></span></button>';
  _cxBindComposer('cxIn', 'cxComp', false);
  var ta0 = m.querySelector('#cxIn'); if (ta0 && CX.drafts[CX.room]) { ta0.value = CX.drafts[CX.room]; ta0.style.height = 'auto'; ta0.style.height = Math.min(160, ta0.scrollHeight) + 'px'; }
  var box = m.querySelector('#cxMsgs');
  box.addEventListener('scroll', function () {
    if (box.scrollTop < 60 && CX.more && !CX.loading) _cxLoadOlder();
    if (CX.fwd && !CX.loading && box.scrollHeight - box.scrollTop - box.clientHeight < 200) _cxLoadNewer();   // v13.375 앞으로 읽기
    _cxSoon('newb', _cxNewBtn);
    if (!CX.unUpOff) _cxSoon('unup', _cxUnUp);
  }, { passive: true });
  ['wheel', 'touchstart', 'mousedown', 'keydown'].forEach(function (ev) { box.addEventListener(ev, _cxUnstick, { passive: true }); });   // v13.385 직접 굴리면 맨 아래 붙이기 그만
  m.querySelector('#cxUnUp').addEventListener('click', function () {
    var ln = box.querySelector('.cx-unl'); _cxUnstick(); CX.unUpOff = true; this.hidden = true;
    if (ln) { var fr = 0; (function fix() {   // 화면 밖 말풍선 높이가 어림이라 한 번에 안 맞음 → 맞을 때까지 몇 번 고침
      var d = ln.getBoundingClientRect().top - box.getBoundingClientRect().top - 60;
      if (Math.abs(d) > 2) box.scrollTop += d;
      if (++fr < 40) requestAnimationFrame(fix);
    })(); }
  });
  m.querySelector('#cxNewB').addEventListener('click', function () { if (CX.fwd) { _cxToLatest(); return; } CX.newBelow = 0; box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); _cxNewBtn(); });
  box.addEventListener('click', _cxMsgClick);
  _cxLongPress(box);
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
  var pst = i.kind === 'dm' && others[0] && others[0].status && typeof chatStatusText === 'function' ? chatStatusText(others[0].status) : '';
  var sub = i.kind === 'dm' ? (others[0] ? (pst ? pst + ' · ' : '') + (others[0].focusUntil && typeof chatFocusLabel === 'function' && chatFocusLabel(others[0].focusUntil) ? chatFocusLabel(others[0].focusUntil) + ' — 급하면 @멘션' : (others[0].online ? '● 접속 중' : '접속 안 함')) + (others[0].dept ? ' · ' + others[0].dept : '') : '') : i.members.length + '명 · 접속 ' + (on + 1) + (others.some(function (m) { return m.focusUntil && new Date(m.focusUntil) > new Date(); }) ? ' · 🎯 집중 ' + others.filter(function (m) { return m.focusUntil && new Date(m.focusUntil) > new Date(); }).length : '');
  var sideOff = !!(document.querySelector('#mMessages .cx.side-off'));
  h.innerHTML = '<button type="button" class="cx-ib cx-back" data-h="back" aria-label="목록으로">‹</button>' +
    '<button type="button" class="cx-ib cx-sidet" data-h="side" title="' + (sideOff ? '대화방 목록 펴기' : '대화방 목록 접기 — 대화에만 집중') + ' (Alt+L)" aria-label="대화방 목록 접기 · 펴기">' + (sideOff ? '»' : '«') + '</button>' +
    (i.self ? '<span class="cx-av cx-av-me">📝</span>' : i.kind === 'project' ? '<span class="cx-av cx-av-p">📁</span>' : i.kind === 'group' ? '<span class="cx-av cx-av-g">👥</span>' : _cxAv(others[0] && others[0].id, name, others[0] && others[0].online)) +
    '<span class="cx-h-t"><b>' + _cxE(name) + '</b><span class="' + (i.kind === 'dm' && others[0] && others[0].online ? 'on' : '') + '">' + _cxE(sub) + '</span></span>' +
    '<span class="cx-h-a">' +
      (typeof chatCallStart === 'function' && i.myRole !== 'readonly' ? '<button type="button" class="cx-ib" data-h="call" title="음성 통화">📞</button><button type="button" class="cx-ib" data-h="vcall" title="영상 통화">🎥</button>' : '') +
      (typeof chatPresStart === 'function' && i.myRole !== 'readonly' ? '<button type="button" class="cx-ib" data-h="present" title="🎤 발표 시작 — 화면 공유 + 음성 + 발표 펜 · 끝나면 정리를 방에">🎤</button>' : '') +
      '<button type="button" class="cx-ib" data-h="share" title="화면 공유">🖥</button>' +
      (typeof chatFindOpen === 'function' ? '<button type="button" class="cx-ib" data-h="find" title="이 방에서 찾기 (Ctrl+F)">🔍</button>' : '') +
      '<button type="button" class="cx-ib" data-h="files" title="파일 모음">📎</button>' +
      '<button type="button" class="cx-ib' + (CX.aside ? ' on' : '') + '" data-h="aside" title="' + (i.kind === 'project' ? '프로젝트 현황' : '대화 정보') + '">' + (i.kind === 'project' ? '📊' : 'ⓘ') + '</button>' +
      '<button type="button" class="cx-ib" data-h="more" title="더보기">⋯</button></span>';
  h.querySelectorAll('[data-h]').forEach(function (b) { b.addEventListener('click', function () { _cxHeadAct(b.dataset.h, b); }); });
}
function _cxHeadAct(k, btn) {
  if ((k === 'call' || k === 'vcall') && typeof chatCallStart === 'function') { chatCallStart(CX.room, k === 'vcall'); return; }   // v13.361
  if (k === 'back') { var root = document.querySelector('#mMessages .cx'); if (root) { root.classList.remove('has-room'); root.classList.add('no-aside'); } CX.room = null; CX.thread = null; _cxDrawRooms(); _cxFull(); return; }
  if (k === 'side') { chatSideToggle(); return; }   // v13.373
  if (k === 'aside') { CX.aside = !CX.aside; document.querySelector('#mMessages .cx').classList.toggle('no-aside', !CX.aside); _cxDrawHead(); _cxDrawAside(); return; }
  if (k === 'files') { CX.aside = true; CX.asideTab = 'files'; document.querySelector('#mMessages .cx').classList.remove('no-aside'); _cxDrawAside(); return; }
  if (k === 'share') { if (typeof chatRtcShare === 'function') chatRtcShare(CX.room); return; }
  if (k === 'find' && typeof chatFindOpen === 'function') { chatFindOpen(); return; }
  if (k === 'present' && typeof chatPresStart === 'function') { chatPresStart(CX.room); return; }   // v13.370
  if (k === 'more') {
    var r = CX.rooms.filter(function (x) { return x.id === CX.room; })[0] || {};
    // v13.371~373 대화 칸이 좁아 머리에서 숨긴 단추는 여기로 (휴대폰 · 좁힌 PC 창)
    var hid = function (k) { var b = document.querySelector('#cxHead [data-h="' + k + '"]'); return !!b && getComputedStyle(b).display === 'none'; };
    _cxMenu(btn, [
      hid('vcall') ? ['🎥 영상 통화', function () { chatCallStart(CX.room, true); }] : null,
      hid('find') ? ['🔍 이 방에서 찾기', chatFindOpen] : null,
      hid('files') ? ['📎 파일 모음', function () { _cxHeadAct('files'); }] : null,
      hid('present') ? ['🎤 발표 시작', function () { chatPresStart(CX.room); }] : null,
      hid('share') ? ['🖥 화면 공유', function () { _cxHeadAct('share'); }] : null,
      [r.pinned ? '📌 고정 풀기' : '📌 맨 위에 고정', function () { _cxRoomPut({ pinned: !r.pinned }); }],
      [r.muted ? '🔔 알림 켜기' : '🔕 알림 끄기 (@멘션만)', function () { _cxRoomPut({ muted: !r.muted }); }],
      CX.info.kind !== 'dm' ? ['➕ 사람 초대', chatInviteModal] : null,
      CX.info.kind === 'group' ? ['✏️ 방 이름 바꾸기', function () { var n = prompt('방 이름', CX.info.name || ''); if (n != null) _cxRoomPut({ name: n }); }] : null,
      ['✨ 대화 요약 (AI)', function () { _cxSend('/요약'); }],
      typeof chatPollModal === 'function' && CX.info.myRole !== 'readonly' ? ['🗳 투표 만들기', function () { chatPollModal('vote'); }] : null,
      typeof chatPollModal === 'function' && CX.info.myRole !== 'readonly' ? ['📅 약속 잡기', function () { chatPollModal('time'); }] : null,
      typeof chatWallModal === 'function' ? ['🎨 배경 화면', function () { chatWallModal(true); }] : null,
      typeof chatExportModal === 'function' ? ['📤 대화 내보내기', chatExportModal] : null,
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
/* 안 읽은 사람 수 — 100명 방도 빠르게: 읽은 위치를 줄 세워 두고 이분 찾기 */
function _cxReadSorted() {
  var ms = (CX.info && CX.info.members) || [];
  return ms.map(function (u) { return CX.reads[u.id] || 0; }).sort(function (a, b) { return a - b; });
}
function _cxUnreadOf(m, sorted) {
  if (!CX.info || m.kind === 'system' || typeof m.id !== 'number') return 0;
  var a = sorted || _cxReadSorted(), lo = 0, hi = a.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (a[mid] < m.id) lo = mid + 1; else hi = mid; }
  var n = lo;   // 읽은 위치 < m.id 인 사람 수
  if (CX.info.members.some(function (u) { return u.id === m.userId; }) && (CX.reads[m.userId] || 0) < m.id) n--;   // 쓴 사람은 빼고
  return Math.max(0, n);
}
function _cxMsgHtml(m, prev, inThread, next) {
  var mine = m.userId === _cxMe(), h = '';
  if (!prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString()) h += '<div class="cx-day"><span>' + _cxDay(m.at) + '</span></div>';
  if (!inThread && CX.readMark != null && typeof m.id === 'number' && m.id > CX.readMark && (!prev || (typeof prev.id === 'number' && prev.id <= CX.readMark)) && !mine) h += '<div class="cx-unl"><span>여기부터 안 읽음</span></div>';
  if (m.kind === 'system') return h + '<div class="cx-sys" data-mid="' + m.id + '">' + _cxText(m.body) + '</div>';
  var alb = null;   // v13.377 🖼 앨범
  if (!inThread && m.grp && m.file && !m.deleted) {
    alb = CX.msgs.filter(function (x) { return x.grp === m.grp && x.file && !x.deleted && !x.replyTo; });
    if (alb.length < 2) alb = null;
    else if (alb[0].id !== m.id) return h + '<div class="cx-gh" hidden></div>';
  }
  var cont = prev && prev.userId === m.userId && prev.kind !== 'system' && (new Date(m.at) - new Date(prev.at)) < 5 * 60000 && new Date(prev.at).toDateString() === new Date(m.at).toDateString();
  var ai = m.kind === 'ai';
  var body = '';
  if (m.deleted) body = '<div class="cx-b cx-del">삭제된 메시지입니다</div>';
  else {
    // v13.376 인용 답장 — 글이 있으면 말풍선 안 위쪽에(카톡처럼), 파일 · 게시판 글이면 그 위에 따로
    var qh = m.quote ? _cxQuoteHtml(m.quote) : '', qIn = qh && m.body && !m.post;
    if (qh && !qIn) body += qh;
    if (m.poll && typeof chatPollHtml === 'function') body += chatPollHtml(m);   // v13.381 🗳 · 📅
    else if (m.post && typeof chatPostHtml === 'function') body += chatPostHtml(m, { full: inThread });   // v13.358 📌 게시판 글
    else if (m.body) body += '<div class="cx-b' + (ai ? ' cx-ai' : '') + (qIn ? ' has-q' : '') +
      (!ai && !qIn && typeof chatEmojiOnly === 'function' ? (chatEmojiOnly(m.body) ? ' cx-jumbo' : chatCodeOnly(m.body) ? ' cx-codeonly' : '') : '') + '">' + (qIn ? qh : '') + (ai ? '<div class="cx-ai-h">🤖 AI · 내가 볼 수 있는 데이터로 답함</div>' + (typeof rMD === 'function' ? rMD(_cxE(m.body)) : _cxText(m.body)) : _cxText(m.body)) + (m.edited ? '<i class="cx-ed">수정됨</i>' : '') + '</div>';
    if (m.link && typeof chatLinkHtml === 'function') body += chatLinkHtml(m.link);   // v13.378 🔗
    if (m.ack && !m.pending && typeof chatAckHtml === 'function') body += chatAckHtml(m);   // v13.381 ✔
    if (alb) body += _cxAlbumHtml(alb);
    else if (m.file) body += _cxFileHtml(m.file);
    if (m.cards && m.cards.length) body += '<div class="cx-cards">' + m.cards.map(function (c, i) { return _cxCardHtml(c, i, m); }).join('') + '</div>';
  }
  var rx = m.reactions ? Object.keys(m.reactions).map(function (e) { var l = m.reactions[e]; return '<button type="button" class="cx-rx' + (l.indexOf(_cxMe()) >= 0 ? ' on' : '') + '" data-rx="' + e + '" title="' + _cxE(_cxNames(l)) + '">' + e + ' ' + l.length + '</button>'; }).join('') : '';
  var meta = m.pending ? '<span class="cx-meta">' + (m.failed ? '<span class="cx-fail' + (m.wait ? ' wait' : '') + '">' + (m.wait ? '⏳ 연결되면 보냄' : '⚠ 못 보냄') + ' <button type="button" data-retry="' + m.id + '">' + (m.wait ? '지금' : '다시 보내기') + '</button><button type="button" data-drop="' + m.id + '">지우기</button></span>' : '<i class="cx-sending" title="보내는 중">◷</i>') + '</span>'
    : '<span class="cx-meta"><em class="cx-un" data-un="' + m.id + '"></em>' + (!alb && _cxSameMin(m, next) ? '' : '<i>' + _cxT(m.at) + '</i>') + '</span>';   // 읽음 숫자는 _cxDrawReadCounts 가 채움 · v13.376 같은 사람 같은 분에 이어 보낸 건 마지막에만 시각
  h += '<div class="cx-m' + (mine ? ' mine' : '') + (cont ? ' cont' : '') + (ai ? ' is-ai' : '') + (m.pending ? ' cx-pend' + (m.failed ? ' failed' : '') : '') + '" data-mid="' + m.id + '">' +
    (!mine && !cont ? (ai ? '<span class="cx-av cx-av-ai">🤖</span>' : _cxAv(m.userId, m.userName)) : (!mine ? '<span class="cx-av-sp"></span>' : '')) +
    '<div class="cx-col">' + (!mine && !cont ? '<div class="cx-who">' + _cxE(ai ? 'AI' : m.userName) + '</div>' : '') +
    '<div class="cx-row">' + (mine ? meta : '') + '<div class="cx-bw">' + body + '</div>' + (!mine ? meta : '') +
    (m.deleted || m.pending ? '' : '<span class="cx-acts"><button type="button" data-a="react" title="공감">😊</button>' + (inThread ? '' : '<button type="button" data-a="quote" title="답장 — 원문을 붙여 이 대화에서 답함">↩</button><button type="button" data-a="reply" title="답글 줄기 — 옆 칸에서 따로 이어 감">💬</button>') + '<button type="button" data-a="more" title="더보기">⋯</button></span>') + '</div>' +
    (rx ? '<div class="cx-rxs">' + rx + '</div>' : '') +
    (!inThread && m.replies ? '<button type="button" class="cx-th" data-a="reply">💬 답글 ' + m.replies + ' · ' + _cxRel(m.lastReplyAt) + '</button>' : '') +
    '</div></div>';
  return h;
}
/** 다음 메시지가 같은 사람 · 같은 분이면 시각은 다음에 (카톡처럼 묶음 끝에만) */
function _cxSameMin(m, next) {
  if (!next || next.pending || m.pending || next.kind === 'system' || next.userId !== m.userId) return false;
  var a = new Date(m.at), b = new Date(next.at);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() && a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes();
}
function _cxNames(ids) {
  var mm = (CX.info && CX.info.members) || [];
  return ids.map(function (id) { var u = mm.filter(function (x) { return x.id === id; })[0]; return u ? u.name : ''; }).filter(Boolean).join(', ');
}
function _cxFileHtml(f) {
  if (/^audio\//i.test(f.mime || '') && typeof chatVoiceHtml === 'function') return chatVoiceHtml(f);   // v13.379 🎤
  var img = /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(f.mime || '');
  if (img) return '<button type="button" class="cx-img" data-file="' + _cxE(f.id) + '" data-img="1" title="' + _cxE(f.name) + '"><img alt="' + _cxE(f.name) + '" data-blob="' + _cxE(f.id) + '" data-small="1"></button>';
  var ext = ((/\.([A-Za-z0-9]{1,6})$/.exec(f.name) || [])[1] || 'FILE').toUpperCase();
  return '<div class="cx-file"><span class="cx-fx">' + _cxE(ext) + '</span><span class="cx-fn"><b>' + _cxE(f.name) + '</b><i>' + _cxSize(f.size || 0) + '</i></span>' +
    '<button type="button" class="cx-ib" data-file="' + _cxE(f.id) + '" data-dl="1" title="받기">⬇</button>' +
    (CX.info && CX.info.kind === 'project' ? '<button type="button" class="cx-ib" data-todoc="' + _cxE(f.id) + '" title="프로젝트 문서로 보내기">📂</button>' : '') + '</div>';
}
function _cxAlbumHtml(list) {
  var n = list.length, shown = list.slice(0, 9);
  return '<div class="cx-alb n' + Math.min(n, 9) + '">' + shown.map(function (x, i) {
    var more = i === 8 && n > 9 ? '<span class="cx-alb-more">+' + (n - 9) + '</span>' : '';
    return '<button type="button" class="cx-img cx-alb-i" data-file="' + _cxE(x.file.id) + '" data-img="1" data-amid="' + x.id + '" title="' + _cxE(x.file.name) + '"><img alt="' + _cxE(x.file.name) + '" data-blob="' + _cxE(x.file.id) + '" data-small="1">' + more + '</button>';
  }).join('') + '</div><div class="cx-alb-n">🖼 사진 ' + n + '장</div>';
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
  return '<div class="cx-card" data-card="' + i + '"><button type="button" class="cx-card-o" data-open="' + i + '"><span class="cx-card-i">' + (CX_ICON[c.type] || '🔗') + '</span><span class="cx-card-t"><b>' + _cxE(c.title || c.id) + '</b>' + (c.sub && !(typeof chatEmojiOnly === 'function' && chatEmojiOnly(c.sub)) ? '<i>' + _cxE(c.sub) + '</i>' : '') + '</span>' + st + '</button>' + acts + '</div>';
}
/* v13.366 메시지 목록 — 앞쪽이 같으면 바뀐 메시지만 바꾸고 새 것만 덧붙임(사진 · 스크롤 그대로, 100명 방도 가볍게) */
function _cxWrap(m, html) { return '<div class="cx-mw" data-k="' + _cxE(String(m.id)) + '">' + html + '</div>'; }
function _cxDrawMsgs(append, focusMid) {
  var box = document.getElementById('cxMsgs'); if (!box) return;
  var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  var n = CX.msgs.length, hs = new Array(n), ids = new Array(n);
  for (var i = 0; i < n; i++) { hs[i] = _cxMsgHtml(CX.msgs[i], CX.msgs[i - 1], false, CX.msgs[i + 1]); ids[i] = CX.msgs[i].id; }
  var pIds = box._ids, pHs = box._hs, L = pIds ? pIds.length : 0, f = 0;
  var inc = append !== 'older' && !focusMid && L > 0 && n > 0 && box._room === CX.room && box._more === CX.more;
  if (inc) { while (f < L && f < n && pIds[f] === ids[f]) f++; if (f === 0) inc = false; }
  var prevH = box.scrollHeight, prevTop = box.scrollTop, added = 0;
  if (inc) {
    var tpl = document.createElement('template');
    for (var j = 0; j < f && inc; j++) if (pHs[j] !== hs[j]) {
      var w = box.querySelector('.cx-mw[data-k="' + _cxE(String(ids[j])) + '"]');
      if (!w) { inc = false; break; }
      tpl.innerHTML = _cxWrap(CX.msgs[j], hs[j]); w.replaceWith(tpl.content.firstChild);
    }
  }
  if (inc) {
    for (var k = f; k < L; k++) { var o = box.querySelector('.cx-mw[data-k="' + _cxE(String(pIds[k])) + '"]'); if (o) o.remove(); }
    var tail = ''; for (var q = f; q < n; q++) tail += _cxWrap(CX.msgs[q], hs[q]);
    if (tail) box.insertAdjacentHTML('beforeend', tail);
    for (var z = f; z < n; z++) if (pIds.indexOf(ids[z]) < 0 && CX.msgs[z].userId !== _cxMe()) added++;
  } else {
    var h = (CX.more ? '<button type="button" class="cx-older" data-older>이전 대화 더 보기</button>' : '') +
      (n ? '' : '<div class="cx-empty">첫 메시지를 남겨 보세요 — <b>＋</b> 로 업무 카드를 붙이거나 <b>/ai</b> 로 데이터에 바로 물을 수 있어요</div>');
    for (var y = 0; y < n; y++) h += _cxWrap(CX.msgs[y], hs[y]);
    box.innerHTML = h;
  }
  box._ids = ids; box._hs = hs; box._room = CX.room; box._more = CX.more;
  _cxLoadBlobs(box);
  _cxDrawReadCounts();
  if (focusMid) { _cxJump(focusMid); return; }
  if (append === 'older') box.scrollTop = box.scrollHeight - prevH + prevTop;
  else if (append === 'newer' || append === 'top') { if (append === 'top') box.scrollTop = 0; }
  else if (!append || atBottom || (n && CX.msgs[n - 1].userId === _cxMe() && added === 0)) { _cxToBottom(); CX.newBelow = 0; }
  else if (added) CX.newBelow += added;   // 위를 보고 있을 때 온 것 — ↓ 단추로 알려 줌
  _cxNewBtn();
}
/* v13.385 맨 아래로 붙이기 — 화면 밖 말풍선은 높이를 어림(content-visibility)으로 두어, 한 번 내리면 실제 높이가 잡히며
 *   위로 밀려 381~1092px 덜 내려가 있었음. 2초 동안(또는 사람이 직접 굴릴 때까지) 높이가 바뀔 때마다 다시 맨 아래로 */
function _cxToBottom() {
  var box = document.getElementById('cxMsgs'); if (!box) return;
  CX.stickUntil = Date.now() + 2000; box.scrollTop = box.scrollHeight; CX.stickTop = box.scrollTop;
  if (CX.stickRaf) return;
  (function loop() {
    CX.stickRaf = 0;
    var b = document.getElementById('cxMsgs'); if (!b || Date.now() > (CX.stickUntil || 0)) return;
    if (CX.stickTop != null && b.scrollTop < CX.stickTop - 40) { CX.stickUntil = 0; return; }   // 누가 위로 올렸으면 그만
    if (b.scrollHeight - b.scrollTop - b.clientHeight > 1) b.scrollTop = b.scrollHeight;
    CX.stickTop = b.scrollTop;
    CX.stickRaf = requestAnimationFrame(loop);
  })();
}
function _cxUnstick() { CX.stickUntil = 0; }
/** v13.385 안 읽은 게 화면 위로 지나가 있으면 ↑ 단추 — 들어가면 늘 맨 아래(최근)부터, 처음부터 읽고 싶으면 이걸로 */
function _cxUnUp() {
  var b = document.getElementById('cxUnUp'), box = document.getElementById('cxMsgs'); if (!b || !box) return;
  var ln = box.querySelector('.cx-unl');
  if (!ln || CX.readMark == null) { b.hidden = true; return; }
  var top = ln.getBoundingClientRect().top - box.getBoundingClientRect().top;
  if (top >= 0) { b.hidden = true; CX.unUpOff = true; return; }
  if (CX.unUpOff) return;
  var me = _cxMe(), n = CX.msgs.filter(function (m) { return typeof m.id === 'number' && m.id > CX.readMark && m.userId !== me && m.kind !== 'system' && !m.replyTo; }).length;
  var f0 = CX.msgs.filter(function (m) { return typeof m.id === 'number'; })[0], more = CX.more && f0 && f0.id > CX.readMark;   // 앞쪽을 아직 안 받았으면 'N개 넘게'
  b.querySelector('span').textContent = '안 읽은 메시지 ' + n + (more ? '개 넘게' : '개') + ' — 처음부터 보기'; b.hidden = !n;
  var hd = document.getElementById('cxHead'), nt = document.getElementById('cxNotice');
  b.style.top = ((hd ? hd.offsetHeight : 56) + (nt && !nt.hidden ? nt.offsetHeight : 0) + 10) + 'px';
}
/* ↓ 새 메시지 N개 · 맨 아래로 */
function _cxNewBtn() {
  var b = document.getElementById('cxNewB'), box = document.getElementById('cxMsgs'); if (!b || !box) return;
  var gap = box.scrollHeight - box.scrollTop - box.clientHeight;
  if (gap < 80) CX.newBelow = 0;
  var show = CX.newBelow > 0 || CX.fwd || gap > box.clientHeight * 1.5;
  b.hidden = !show; if (!show) return;
  b.classList.toggle('has-new', CX.newBelow > 0);
  b.querySelector('span').textContent = CX.newBelow > 0 ? '새 메시지 ' + CX.newBelow + '개' : CX.fwd ? '최근 대화로' : '맨 아래로';
  var comp = document.getElementById('cxComp') || document.querySelector('#cxMain .cx-ro'), ty = document.getElementById('cxTyping');
  b.style.bottom = ((comp ? comp.offsetHeight : 60) + (ty ? ty.offsetHeight : 0) + 12) + 'px';
}
function _cxDrawReadCounts() {
  var els = document.querySelectorAll('#mMessages [data-un]'); if (!els.length) return;
  var by = {}, sorted = _cxReadSorted();
  CX.msgs.forEach(function (x) { by[x.id] = x; }); CX.threadMsgs.forEach(function (x) { by[x.id] = x; });
  els.forEach(function (e) { var m = by[e.dataset.un]; if (m) { var n = _cxUnreadOf(m, sorted); var t = n ? String(n) : ''; if (e.textContent !== t) e.textContent = t; } });
}
function _cxLoadOlder() {
  if (!CX.msgs.length) return;
  CX.loading = true;
  var my = CX.room;
  var first = CX.msgs.filter(function (m) { return typeof m.id === 'number'; })[0]; if (!first) { CX.loading = false; return; }
  apiFetch('/api/chat/rooms/' + CX.room + '/messages?before=' + first.id).then(function (r) {
    CX.loading = false;
    if (CX.room !== my) return;
    CX.msgs = (r.data || []).concat(CX.msgs); CX.more = !!r.more;
    _cxDrawMsgs('older');
  }).catch(function () { CX.loading = false; });
}
/* v13.375 앞으로 읽기 — 처음부터 읽거나 찾기로 옛 자리에 갔을 때, 아래로 내리면 다음 것을 이어 받음 */
function _cxLoadNewer() {
  var last = _cxLastId(); if (!last || !CX.room) return;
  CX.loading = true; var my = CX.room;
  apiFetch('/api/chat/rooms/' + encodeURIComponent(my) + '/messages?after=' + last).then(function (r) {
    CX.loading = false; if (CX.room !== my) return;
    var add = (r.data || []).filter(function (m) { return !CX.msgs.some(function (x) { return x.id === m.id; }); });
    CX.msgs = CX.msgs.filter(function (m) { return !m.pending; }).concat(add); CX.fwd = !!r.more;
    if (!CX.fwd) CX.newBelow = 0;
    _cxDrawMsgs('newer'); _cxMarkRead();
  }).catch(function () { CX.loading = false; });
}
/** 👋 처음부터 읽기 */
function chatReadFromStart() {
  if (!CX.room) return;
  CX.loading = true; var my = CX.room;
  apiFetch('/api/chat/rooms/' + encodeURIComponent(my) + '/messages?after=0').then(function (r) {
    CX.loading = false; if (CX.room !== my) return;
    CX.msgs = r.data || []; CX.more = false; CX.fwd = !!r.more; CX.readMark = null; CX.newBelow = 0;
    var box = document.getElementById('cxMsgs'); if (box) { box._ids = null; }
    _cxDrawMsgs('top'); _cxNewBtn();
  }).catch(function (e) { CX.loading = false; _cxToast(_cxErr(e), 'error'); });
}
/** 최근 대화로 (앞으로 읽던 중) */
function _cxToLatest() {
  if (!CX.room) return;
  var my = CX.room; CX.loading = true;
  apiFetch('/api/chat/rooms/' + encodeURIComponent(my) + '/messages').then(function (r) {
    CX.loading = false; if (CX.room !== my) return;
    CX.msgs = (r.data || []).concat(CX.msgs.filter(function (m) { return m.pending; })); CX.more = !!r.more; CX.fwd = false; CX.newBelow = 0;
    var box = document.getElementById('cxMsgs'); if (box) { box._ids = null; }
    _cxDrawMsgs(false); _cxMarkRead(); _cxCacheTouch();
  }).catch(function () { CX.loading = false; });
}
function _cxJump(id) {
  var el = document.querySelector('#cxMsgs [data-mid="' + id + '"]');
  if (!el) { if (CX.more) { CX.loading = true; apiFetch('/api/chat/rooms/' + CX.room + '/messages?around=' + id + '&limit=120').then(function (r) { CX.loading = false; CX.msgs = r.data || []; CX.more = !!r.more; var rr1 = CX.rooms.filter(function (x) { return x.id === CX.room; })[0]; CX.fwd = !!(rr1 && rr1.lastId > _cxLastId()); _cxDrawMsgs('newer', null); var e2 = document.querySelector('#cxMsgs [data-mid="' + id + '"]'); if (e2) { e2.scrollIntoView({ block: 'center' }); e2.classList.add('cx-hl'); } }).catch(function () { CX.loading = false; }); } return; }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('cx-hl'); void el.offsetWidth; el.classList.add('cx-hl');
}
/* 사진 — 인증이 필요한 주소라 받아서 blob 으로 */
function _cxBlob(fid, thumb) {
  var key = thumb ? fid + ':t' : fid;
  if (CX.blobs[key]) return CX.blobs[key];
  if (thumb && CX.blobs[fid]) return CX.blobs[fid];   // 원본을 이미 받았으면 그것
  CX.blobs[key] = fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/files/' + encodeURIComponent(fid) + (thumb ? '?thumb=1' : ''), { headers: { Authorization: 'Bearer ' + _accessToken } }).then(function (res) {
    var ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') >= 0) return res.json().then(function (j) { if (thumb) _cxBackfillThumb(fid, j.data.url); return j.data.url; });   // GCS 서명 주소
    var isThumb = res.headers.get('X-Thumb') === '1';
    return res.blob().then(function (b) { if (thumb && !isThumb) _cxBackfillThumb(fid, b); return URL.createObjectURL(b); });
  });
  CX.blobs[key].catch(function () { delete CX.blobs[key]; });
  return CX.blobs[key];
}
/** 예전 사진 — 처음 본 사람이 미리보기를 만들어 올려 둠 (다음부터 모두 작게 받음) */
var _cxBackfilled = {};
function _cxBackfillThumb(fid, src) {
  if (_cxBackfilled[fid]) return; _cxBackfilled[fid] = 1;
  var get = typeof src === 'string' ? fetch(src).then(function (r) { return r.blob(); }) : Promise.resolve(src);
  get.then(function (b) { if (!b || b.size < 150 * 1024 || !_cxIsPhoto({ type: b.type || 'image/jpeg' })) return; return _cxBitmap(b).then(function (bmp) { return _cxJpeg(_cxCanvasOf(bmp, CX_THUMB), 0.72); }).then(function (t) { return _cxPutThumb(fid, t); }); }).catch(function () {});
}
/* v13.371 사진은 화면 가까이 올 때만 받음(사진 많은 방도 열자마자 수십 개 받지 않게) · 맨 아래를 보던 중이면 사진이 커져도 맨 아래 유지 */
function _cxLoadBlobs(root) {
  if (typeof chatLinkImgs === 'function') chatLinkImgs(root);   // v13.378 🔗 미리보기 사진
  if (typeof chatVoiceWarm === 'function') chatVoiceWarm(root);   // v13.379 🎤
  var imgs = root.querySelectorAll('img[data-blob]'); if (!imgs.length) return;
  if (typeof IntersectionObserver !== 'function') { imgs.forEach(_cxBlobImg); return; }
  imgs.forEach(function (img) {
    var sc = img.closest('.cx-msgs,.cx-as-b') || null, key = sc || document;
    if (!key._cxIO) key._cxIO = new IntersectionObserver(function (es, io) { es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); _cxBlobImg(e.target); } }); }, { root: sc, rootMargin: '600px 0px' });
    key._cxIO.observe(img);
  });
}
function _cxBlobImg(img) {
  if (!img.dataset.blob) return;
  var id = img.dataset.blob; img.removeAttribute('data-blob');
  var sc = img.closest('.cx-msgs'), small = img.dataset.small === '1';
  img.addEventListener('load', function () { if (sc && sc._stick) sc.scrollTop = sc.scrollHeight; }, { once: true });
  _cxBlob(id, small).then(function (u) {
    if (sc) sc._stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
    img.src = u;
    var ai0 = img.closest('[data-amid]'), holder = !img.closest('.cx-q') && (ai0 || img.closest('[data-mid]')), m = holder && _cxFindMsg(+(ai0 ? ai0.dataset.amid : holder.dataset.mid));   // 인용 상자 속 사진은 그대로 · 앨범은 그 사진의 메시지
    if (typeof chatBoardThumb === 'function' && m && m.file) chatBoardThumb(img, m.file);   // 표시 · 자르기 · 회전한 모습으로
  }).catch(function () { img.alt = '사진을 불러오지 못했습니다'; });
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
  var rt = t.closest('[data-retry]'), dp = t.closest('[data-drop]');   // v13.366 못 보낸 메시지
  if (rt || dp) {
    var pid = (rt || dp).dataset[rt ? 'retry' : 'drop'], pm = CX.msgs.filter(function (x) { return String(x.id) === pid; })[0];
    CX.msgs = CX.msgs.filter(function (x) { return String(x.id) !== pid; });
    if (rt && pm) { _cxSend(pm.body, null, pm.cards, pm.quote && pm.quote.id); } else _cxDrawMsgs(true);
    return;
  }
  var mel = t.closest('[data-mid]'), m = mel && _cxFindMsg(+mel.dataset.mid);
  if (t.closest('[data-voice]') && typeof chatVoiceClick === 'function' && chatVoiceClick(t, e)) return;   // v13.379 🎤
  if (typeof chatMoreClick === 'function' && t.closest('[data-vote],[data-pclose],[data-ack],[data-ackl]') && chatMoreClick(t)) return;   // v13.381
  var qj = t.closest('[data-qjump]');
  if (qj) { _cxJump(+qj.dataset.qjump); return; }   // v13.376 인용 → 원문 자리
  var un = t.closest('[data-un]');
  if (un && un.textContent && m) { _cxReadersPop(un, m); return; }   // v13.372 숫자 누르면 누가 읽었나
  var rx = t.closest('[data-rx]');
  if (rx && m) { _cxReact(m.id, rx.dataset.rx); return; }
  var a = t.closest('[data-a]');
  if (a && m) {
    if (a.dataset.a === 'react') _cxMenu(a, CX_REACTS.map(function (em) { return [em, function () { _cxReact(m.id, em); }]; }), 'cx-rxpick');
    else if (a.dataset.a === 'reply') chatOpenThread(m.id);
    else if (a.dataset.a === 'quote') _cxStartQuote(m);
    else if (a.dataset.a === 'more') _cxMsgMenu(a, m);
    _cxActsClose();
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
  if (fl && m) { var fm = fl.dataset.amid ? _cxFindMsg(+fl.dataset.amid) || m : m; if (fl.dataset.img) _cxViewImage(fl.dataset.file, fm.file && fm.file.name); else _cxDownload(fl.dataset.file, fm.file && fm.file.name); return; }
  var td = t.closest('[data-todoc]');
  if (td) { apiFetch('/api/chat/files/' + td.dataset.todoc + '/to-docs', { method: 'POST', body: JSON.stringify({ projectId: CX.info && CX.info.projectId }) }).then(function () { _cxToast('📂 프로젝트 문서로 보냈습니다', 'success'); }).catch(function (err) { _cxToast(_cxErr(err), 'error'); }); return; }
  var w = t.closest('[data-watch]');
  if (w && typeof chatRtcWatch === 'function') { chatRtcWatch(CX.room, w.dataset.watch, w.dataset.from); return; }
  // v13.399 마우스로 말풍선 · 사람(얼굴 · 이름)을 누르면 공감 · 답장 · 답글 · ⋯ 띠 (예전엔 마우스만 올려도 떴다). 휴대폰은 길게 누르기 그대로
  if (mel && m && !m.pending && !m.deleted && CXP.type !== 'touch' && t.closest('.cx-bw,.cx-av,.cx-who') && !t.closest('a,button,img,input,textarea,[data-file],.cx-code')) {
    var sel = window.getSelection ? String(window.getSelection()) : '';
    if (sel.trim()) return;   // 글을 끌어 고르는 중이면 그대로
    _cxActsOpen(mel);
  }
}
/* 누르면 뜨는 띠 — 마우스가 메시지 밖으로 나가거나 Esc · 굴리기 · 다른 곳 누르기로 닫힘 */
var CXP = { type: 'mouse', el: null, t: null };
document.addEventListener('pointerdown', function (e) { CXP.type = e.pointerType || 'mouse'; }, true);
function _cxActsClose() {
  clearTimeout(CXP.t);
  if (CXP.el) { CXP.el.classList.remove('cx-acton'); CXP.el.removeEventListener('pointerleave', _cxActsLeave); CXP.el.removeEventListener('pointerenter', _cxActsEnter); }
  CXP.el = null;
}
function _cxActsLeave() { clearTimeout(CXP.t); CXP.t = setTimeout(_cxActsClose, 350); }
function _cxActsEnter() { clearTimeout(CXP.t); }
function _cxActsOpen(mel) {
  if (CXP.el === mel) { _cxActsClose(); return; }   // 한 번 더 누르면 닫힘
  _cxActsClose();
  CXP.el = mel; mel.classList.add('cx-acton');
  mel.addEventListener('pointerleave', _cxActsLeave); mel.addEventListener('pointerenter', _cxActsEnter);
}
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && CXP.el) _cxActsClose(); });
document.addEventListener('pointerdown', function (e) { if (CXP.el && !CXP.el.contains(e.target) && !(e.target.closest && e.target.closest('.cx-menu'))) _cxActsClose(); }, true);
document.addEventListener('scroll', function (e) { if (CXP.el && e.target && e.target.contains && e.target.contains(CXP.el)) _cxActsClose(); }, true);
function _cxOpenCard(c) {
  if (c.type === 'cdoc' && typeof chatDocOpen === 'function') { chatDocOpen(c.id); return; }   // v13.360 📝 공동 문서
  if (c.type === 'todo') { if (typeof setPage === 'function') setPage('mywork'); return; }
  if (typeof globalSearchNav === 'function') globalSearchNav(c.type, { id: c.id, title: c.title, sub: c.sub, nav: c.nav || {} }, '');
}
function _cxReact(mid, emoji) {
  apiFetch('/api/chat/messages/' + mid + '/react', { method: 'POST', body: JSON.stringify({ emoji: emoji }) }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
}
/* v13.372 읽은 사람 · 안 읽은 사람 — 메시지 옆 숫자를 누르면 */
function _cxReadersPop(anchor, m) {
  var ms = ((CX.info && CX.info.members) || []).filter(function (u) { return u.id !== m.userId; });
  var yes = ms.filter(function (u) { return (CX.reads[u.id] || 0) >= m.id; }), no = ms.filter(function (u) { return (CX.reads[u.id] || 0) < m.id; });
  var old = document.getElementById('cxMenu'); if (old) old.remove();
  var p = document.createElement('div'); p.id = 'cxMenu'; p.className = 'cx-menu cx-readers'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', '읽음 확인');
  function list(t, arr, cls) { return '<div class="cx-rd-h ' + cls + '">' + t + ' <b>' + arr.length + '</b></div>' + (arr.length ? arr.map(function (u) { return '<div class="cx-rd-u">' + _cxAv(u.id, u.name, u.online) + '<span>' + _cxE(u.name) + (u.dept ? ' <i>' + _cxE(u.dept) + '</i>' : '') + '</span></div>'; }).join('') : '<div class="cx-rd-e">없음</div>'); }
  p.innerHTML = list('안 읽음', no, 'no') + list('읽음', yes, 'yes');
  document.body.appendChild(p);
  var r = anchor.getBoundingClientRect(), w = p.offsetWidth, hh = p.offsetHeight;
  p.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left - w / 2)) + 'px';
  p.style.top = (r.bottom + hh + 6 > window.innerHeight ? Math.max(6, r.top - hh - 4) : r.bottom + 4) + 'px';
  setTimeout(function () { document.addEventListener('pointerdown', function off(e) { if (!p.contains(e.target)) { p.remove(); document.removeEventListener('pointerdown', off, true); } }, true); }, 0);
}
/* v13.372 휴대폰 — 메시지를 길게 누르면 메뉴(답글 · 공감 · 복사 …). 터치 화면엔 마우스 올림 단추가 없어서 */
function _cxLongPress(box) {
  var t = null, sx = 0, sy = 0;
  box.addEventListener('touchstart', function (e) {
    var b = e.target.closest('.cx-bw'); if (!b || e.touches.length > 1 || e.target.closest('a,button,img,[data-file]')) return;
    var mel = b.closest('[data-mid]'), m = mel && _cxFindMsg(+mel.dataset.mid); if (!m || m.pending || m.deleted) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    clearTimeout(t); t = setTimeout(function () {
      t = null; if (navigator.vibrate) try { navigator.vibrate(15); } catch (er) {}
      mel.classList.add('cx-press'); setTimeout(function () { mel.classList.remove('cx-press'); }, 400);
      var inTh = !!b.closest('#cxThMsgs');
      _cxMsgMenu(b, m, [
        ['😊 공감…', function () { _cxMenu(b, CX_REACTS.map(function (em) { return [em, function () { _cxReact(m.id, em); }]; }), 'cx-rxpick'); }],
        inTh ? null : ['↩ 답장', function () { _cxStartQuote(m); }],
        inTh ? null : ['💬 답글 줄기', function () { chatOpenThread(m.id); }]
      ].filter(Boolean));
    }, 480);
  }, { passive: true });
  function cancel(e) { if (!t) return; if (e && e.touches && e.touches[0] && Math.abs(e.touches[0].clientX - sx) < 8 && Math.abs(e.touches[0].clientY - sy) < 8) return; clearTimeout(t); t = null; }
  box.addEventListener('touchmove', cancel, { passive: true });
  // v13.376 오른쪽으로 밀면 답장 (카톡처럼) · 같은 말풍선 두 번 누르면 👍
  var sw = null, lastTap = { t: 0, id: null, x: 0, y: 0 };
  box.addEventListener('touchstart', function (e) {
    sw = null; if (e.touches.length > 1 || box.id === 'cxThMsgs') return;
    var mel = e.target.closest('.cx-m[data-mid]'); if (!mel || e.target.closest('a,button,img,[data-file],textarea,input')) return;
    sw = { el: mel, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, lock: 0 };
  }, { passive: true });
  box.addEventListener('touchmove', function (e) {
    if (!sw) return;
    var dx = e.touches[0].clientX - sw.x, dy = e.touches[0].clientY - sw.y;
    if (!sw.lock) { if (Math.abs(dx) > 10 || Math.abs(dy) > 10) sw.lock = Math.abs(dx) > Math.abs(dy) * 1.3 && dx > 0 ? 1 : -1; }
    if (sw.lock !== 1) return;
    sw.dx = Math.max(0, Math.min(84, dx));
    sw.el.style.transform = 'translateX(' + sw.dx + 'px)'; sw.el.classList.add('cx-swiping'); sw.el.classList.toggle('cx-swipe-ok', sw.dx >= 56);
  }, { passive: true });
  box.addEventListener('touchend', function (e) {
    clearTimeout(t); t = null;
    if (sw && sw.lock === 1) {
      var el = sw.el, ok = sw.dx >= 56;
      el.style.transition = 'transform .18s'; el.style.transform = ''; el.classList.remove('cx-swipe-ok');
      setTimeout(function () { el.style.transition = ''; el.classList.remove('cx-swiping'); }, 200);
      if (ok) { var m0 = _cxFindMsg(+el.dataset.mid); if (m0 && !m0.pending && !m0.deleted) { if (navigator.vibrate) try { navigator.vibrate(10); } catch (er) {} _cxStartQuote(m0); } }
      sw = null; return;
    }
    // 두 번 눌러 공감
    var ct = e.changedTouches && e.changedTouches[0], bw = e.target.closest('.cx-bw'), mel2 = bw && bw.closest('.cx-m[data-mid]');
    if (sw && !sw.lock && ct && mel2 && !e.target.closest('a,button,img,[data-file]')) {
      var now = Date.now();
      if (lastTap.id === mel2.dataset.mid && now - lastTap.t < 320 && Math.abs(ct.clientX - lastTap.x) < 30 && Math.abs(ct.clientY - lastTap.y) < 30) {
        lastTap = { t: 0, id: null };
        var m1 = _cxFindMsg(+mel2.dataset.mid);
        if (m1 && !m1.pending && !m1.deleted) { var em = _cxLsGet('wm-cx-dbl') || '👍'; _cxReact(m1.id, em); _cxPop(bw, em); }
      } else lastTap = { t: now, id: mel2.dataset.mid, x: ct.clientX, y: ct.clientY };
    }
    sw = null;
  });
  box.addEventListener('touchcancel', function () { clearTimeout(t); t = null; });
  box.addEventListener('contextmenu', function (e) { if (e.target.closest('.cx-bw') && matchMedia('(pointer:coarse)').matches) e.preventDefault(); });
}
/* v13.376 😊 이모티콘 판 — 자주 쓴 것 · 빠른 답(누르면 바로 보냄) · 분류 */
var CX_EMO = {
  '빠른 답': ['확인했습니다 ✅', '검토 중입니다 👀', '완료했습니다 🙆', '잠시만요 🙏', '감사합니다 🙇', '통화 가능할까요? 📞', '지금 확인해 볼게요 🔍', '내일 처리하겠습니다 📅'],
  '표정': '😀 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 🤗 🤭 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🤧 🥵 🥶 😵 🤯 🥳 😎 🤓 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 😤 😡 😠'.split(' '),
  '손 · 사람': '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 👏 🙌 👐 🤲 🙏 💪 🙇 🙆 🙅 🤷 🤦 💁 🙋'.split(' '),
  '업무': '✅ ☑️ ❌ ⭕ ❗ ❓ ⚠️ 🚨 🔥 💯 📌 📎 📝 📋 📅 ⏰ ⏳ 📞 💻 🖥 🖨 🔧 🔩 ⚙️ 🛠 🏭 📦 🚚 📈 📉 💡 🔍 🔒 🔑 📢 🎯 🚀 🏁'.split(' '),
  '기호': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ⭐ 🌟 ✨ ⚡ 🎉 🎊 🎁 ☕ 🍚 🍺 🌧 ☀️ ⛄ 👀 💬 💭 ➡️ ⬅️ ⬆️ ⬇️ 🔄 ➕ ➖ ✖️'.split(' ')
};
function _cxEmoRecent() { try { return JSON.parse(_cxLsGet('wm-cx-emo') || '[]') || []; } catch (e) { return []; } }
function _cxEmojiPick(btn, ta, inThread, go) {
  var old = document.getElementById('cxEmo'); if (old) { old.remove(); return; }
  var tabs = ['자주'].concat(Object.keys(CX_EMO)), cur = _cxEmoRecent().length ? '자주' : '빠른 답';
  var p = document.createElement('div'); p.id = 'cxEmo'; p.className = 'cx-emo'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', '이모티콘');
  function draw() {
    var list = cur === '자주' ? _cxEmoRecent() : CX_EMO[cur];
    p.innerHTML = '<div class="cx-emo-tabs">' + tabs.map(function (t) { return '<button type="button" data-tab="' + t + '" class="' + (t === cur ? 'on' : '') + '">' + t + '</button>'; }).join('') + '</div>' +
      '<div class="cx-emo-g' + (cur === '빠른 답' ? ' qr' : '') + '">' + (list.length ? list.map(function (x) { return '<button type="button" data-e="' + _cxE(x) + '">' + _cxE(x) + '</button>'; }).join('') : '<div class="cx-emo-e">아직 없습니다 — 쓰면 여기 모입니다</div>') + '</div>' +
      '<div class="cx-emo-f">두 번 눌러 공감: <button type="button" data-dbl>' + (_cxLsGet('wm-cx-dbl') || '👍') + '</button> <i>휴대폰에서 말풍선을 두 번 누르면</i></div>';
  }
  draw();
  document.body.appendChild(p);
  var r = btn.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 12);
  p.style.width = w + 'px'; p.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.right - w)) + 'px';
  p.style.bottom = (window.innerHeight - r.top + 6) + 'px';
  var pickDbl = false;
  p.addEventListener('mousedown', function (e) { e.preventDefault(); });   // 입력칸 포커스 유지 (휴대폰 키보드 안 내려감)
  p.addEventListener('click', function (e) {
    var tb = e.target.closest('[data-tab]'); if (tb) { cur = tb.dataset.tab; pickDbl = false; draw(); return; }
    if (e.target.closest('[data-dbl]')) { pickDbl = true; cur = '손 · 사람'; draw(); p.querySelector('.cx-emo-f i').textContent = '← 바꿀 공감을 고르세요'; return; }
    var b = e.target.closest('[data-e]'); if (!b) return;
    var x = b.dataset.e;
    if (pickDbl) { _cxLsSet('wm-cx-dbl', x); pickDbl = false; draw(); return; }
    var rec = _cxEmoRecent().filter(function (y) { return y !== x; }); rec.unshift(x); _cxLsSet('wm-cx-emo', JSON.stringify(rec.slice(0, 24)));
    if (CX_EMO['빠른 답'].indexOf(x) >= 0) { ta.value = x; p.remove(); go(); return; }   // 빠른 답은 바로 보냄
    var s0 = ta.selectionStart || ta.value.length, s1 = ta.selectionEnd || s0;
    ta.value = ta.value.slice(0, s0) + x + ta.value.slice(s1); ta.selectionStart = ta.selectionEnd = s0 + x.length;
    ta.dispatchEvent(new Event('input'));
  });
  setTimeout(function () { document.addEventListener('pointerdown', function off(e) { if (!p.contains(e.target) && e.target !== btn) { p.remove(); document.removeEventListener('pointerdown', off, true); } }, true); }, 0);
}
/** 공감 떠오름 (두 번 누름) */
function _cxPop(anchor, em) {
  var r = anchor.getBoundingClientRect(), p = document.createElement('span');
  p.className = 'cx-rxpop'; p.textContent = em; p.style.left = (r.left + r.width / 2) + 'px'; p.style.top = (r.top + r.height / 2) + 'px';
  document.body.appendChild(p); setTimeout(function () { p.remove(); }, 800);
}
function _cxMsgMenu(btn, m, pre) {
  var mine = m.userId === _cxMe();
  _cxMenu(btn, (pre || []).concat([
    !pre && typeof m.id === 'number' && !m.replyTo ? ['↩ 답장', function () { _cxStartQuote(m); }] : null,
    m.file ? ['⬇ 받기', function () { _cxDownload(m.file.id, m.file.name); }] : null,
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
  ]).filter(Boolean));
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
function _cxIsPhone() { return window.innerWidth <= 760; }
function _cxCanCapture() { return !!((window.wmDesktop && window.wmDesktop.captureScreen) || (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && !/Android|iPhone|iPad/i.test(navigator.userAgent))); }
function _cxComposerHtml(taId, wrapId) {
  // v13.381 자주 쓰는 것(k) — 넓은 칸은 입력 줄에, 좁은 칸(휴대폰 · 좁힌 창)은 ＋ 도구판에. 나머지는 늘 도구판
  function btn(c, ic, tl, title, cls) { return '<button type="button" class="cx-ib' + (cls ? ' ' + cls : '') + '" data-c="' + c + '" title="' + title + '">' + ic + '<span class="cx-tl">' + tl + '</span></button>'; }
  var main = wrapId === 'cxComp';
  var keep = [btn('attach', '📎', '파일 · 사진', '파일 · 사진 (끌어 놓기 · 붙여넣기도 됨)'), btn('card', '🗂', '업무 카드', '업무 카드 붙이기 — 이슈 · 프로젝트 · 마일스톤 · 문서 …'),
    main && typeof chatTimeComposer === 'function' ? btn('sched', '⏰', '예약 보내기', '⏰ 예약 보내기 — 글을 쓰고 누르면 그때 보냄') : '',
    main && typeof chatPostModal === 'function' ? btn('post', '✍️', '게시판 글', '게시판 글쓰기 — 공지 · 자료 · 질문 · 🛠 요청') : '',
    _cxCanCapture() ? btn('cap', '📸', '화면 캡처', '화면 캡처 — 잘라서 표시하고 보내기') : ''].join('');
  var more = [_cxIsPhone() ? btn('camera', '📷', '카메라', '사진 찍어 보내기') : '',
    typeof chatVoiceCan === 'function' && chatVoiceCan() ? btn('voice', '🎤', '음성 메시지', '🎤 음성 메시지 — 말로 보내기 (AI 가 글로도 받아씀)') : '',
    main && typeof chatPollModal === 'function' ? btn('poll', '🗳', '투표', '🗳 투표 만들기') + btn('meet', '📅', '약속 잡기', '📅 약속 잡기 — 후보 시간마다 일정 겹침 보기 · 정하면 달력') : '',
    main ? btn('ack', '✔', '확인 요청', '✔ 확인 요청 — 받은 사람마다 "확인했어요" 단추, 안 누르면 다음 날 아침 다시 알림', CX.ackNext ? 'on' : '') : '',
    '<button type="button" class="cx-ib cx-q-orig' + (_cxPhotoOrig() ? ' on' : '') + '" data-c="orig" title="사진 화질 — 지금: ' + (_cxPhotoOrig() ? '원본 그대로' : '줄여서(빠름)') + '">' + (_cxPhotoOrig() ? '🅾' : '🖼') + '<span class="cx-tl">' + (_cxPhotoOrig() ? '원본 화질' : '사진 줄여서') + '</span></button>'].join('');
  return '<div class="cx-comp' + (main && CX.ackNext ? ' ack-on' : '') + '" id="' + wrapId + '"><div class="cx-chips" data-chips></div><div class="cx-reply" data-replybar hidden></div>' +
    (main ? '<div class="cx-ackchip" data-ackchip' + (CX.ackNext ? '' : ' hidden') + '>✔ 확인 요청으로 보냄 <button type="button" class="cx-ib" data-c="ack" title="끄기">✕</button></div>' : '') +
    '<div class="cx-comp-r"><button type="button" class="cx-ib cx-tools-t" data-c="tools" title="더 보기 — 음성 · 투표 · 약속 · 확인 요청 …" aria-label="도구 열기" aria-expanded="false">＋</button>' +
    '<span class="cx-tools-k">' + keep + '</span><span class="cx-tools" data-tools>' + keep.replace(/class="cx-ib/g, 'class="cx-ib cx-k2') + more + '</span>' +
    '<textarea id="' + taId + '" rows="1" autocomplete="off" enterkeyhint="send" placeholder="' + (_cxIsPhone() ? '메시지 입력' : '메시지 · @사람 · /명령') + '" title="Enter 보내기 · Shift+Enter 줄바꿈 · @ 사람 부르기 · / 명령(/ai · /요약 · /todo · /issue) · 파일은 끌어 놓거나 붙여넣기" aria-label="메시지 입력"></textarea>' +
    '<button type="button" class="cx-ib cx-emo-t" data-c="emoji" title="이모티콘 · 빠른 답" aria-label="이모티콘">😊</button>' +
    '<button type="button" class="cx-send" data-c="send" title="보내기" aria-label="보내기">➤</button>' +
    '<input type="file" data-c="file" multiple hidden>' + (_cxIsPhone() ? '<input type="file" data-c="cam" accept="image/*" capture="environment" hidden>' : '') + '</div><div class="cx-sugg" data-sugg hidden></div></div>';
}
function _cxBindComposer(taId, wrapId, inThread) {
  var wrap = document.getElementById(wrapId), ta = document.getElementById(taId); if (!wrap || !ta) return;
  var fileIn = wrap.querySelector('[data-c="file"]'), sugg = wrap.querySelector('[data-sugg]'), lastTyping = 0, sel = 0;
  function grow() { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; }
  if (wrap.offsetWidth && wrap.offsetWidth < 620) ta.placeholder = '메시지 입력';   // v13.373 좁은 대화 칸 — 긴 안내는 두 줄로 꺾임
  ta.addEventListener('input', function () {
    grow();
    if (!inThread && !CX.editId) _cxDraftSave(ta.value);
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
    else if (e.key === 'Escape' && CX.quote && !inThread) { _cxEndQuote(); }
    else if (e.key === 'ArrowUp' && !ta.value && !inThread) { var last = CX.msgs.slice().reverse().filter(function (m) { return m.userId === _cxMe() && m.kind === 'text' && !m.deleted && !m.pending; })[0]; if (last) { e.preventDefault(); _cxStartEdit(last); } }
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
    if (b.dataset.c === 'tools') { _tools(!wrap.classList.contains('tools-open')); return; }
    if (b.closest('[data-tools]')) _tools(false);   // 도구 하나 고르면 판은 닫음
    if (b.dataset.c === 'attach') fileIn.click();
    else if (b.dataset.c === 'camera') { var cam = wrap.querySelector('[data-c="cam"]'); if (cam) cam.click(); }
    else if (b.dataset.c === 'card') chatCardPicker(inThread);
    else if (b.dataset.c === 'post' && typeof chatPostModal === 'function') chatPostModal();
    else if (b.dataset.c === 'sched' && typeof chatTimeComposer === 'function') chatTimeComposer(b, ta);
    else if (b.dataset.c === 'cap' && typeof chatBoardCapture === 'function') chatBoardCapture(inThread ? CX.thread : null);
    else if (b.dataset.c === 'send') _go();
    else if (b.dataset.c === 'emoji') _cxEmojiPick(b, ta, inThread, _go);
    else if (b.dataset.c === 'voice' && typeof chatVoiceStart === 'function') chatVoiceStart(wrap, inThread ? CX.thread : null);   // v13.379 🎤
    else if (b.dataset.c === 'poll' && typeof chatPollModal === 'function') chatPollModal('vote');   // v13.381
    else if (b.dataset.c === 'meet' && typeof chatPollModal === 'function') chatPollModal('time');
    else if (b.dataset.c === 'ack') {
      CX.ackNext = !CX.ackNext; wrap.classList.toggle('ack-on', CX.ackNext);
      wrap.querySelectorAll('[data-c="ack"]').forEach(function (x) { x.classList.toggle('on', CX.ackNext); });
      var ch = wrap.querySelector('[data-ackchip]'); if (ch) ch.hidden = !CX.ackNext;
      ta.focus();
    }
    else if (b.dataset.c === 'orig') {   // v13.377 사진 화질
      var on = !_cxPhotoOrig(); _cxLsSet('wm-cx-photo', on ? 'orig' : null);
      document.querySelectorAll('[data-c="orig"]').forEach(function (x) { x.classList.toggle('on', on); x.title = '사진 화질 — 지금: ' + (on ? '원본 그대로' : '줄여서(빠름)'); x.firstChild.textContent = on ? '🅾' : '🖼'; var tl = x.querySelector('.cx-tl'); if (tl) tl.textContent = on ? '원본 화질' : '사진 줄여서'; });
      _cxToast(on ? '🅾 사진을 원본 그대로 보냅니다 (도면 · 측정값 사진에)' : '🖼 사진을 줄여서 보냅니다 (빠르고 데이터 적게)', 'info');
    }
  });
  wrap.addEventListener('click', function (e) { var x = e.target.closest('[data-unchip]'); if (x) { CX.cards.splice(+x.dataset.unchip, 1); _cxDrawChips(); } var rc = e.target.closest('[data-unreply]'); if (rc) _cxCancelEdit(); if (e.target.closest('[data-unquote]')) _cxEndQuote(); });
  function _tools(on) {
    wrap.classList.toggle('tools-open', on);
    var t = wrap.querySelector('[data-c="tools"]'); if (t) t.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) setTimeout(function () { document.addEventListener('pointerdown', function off(ev) { if (!wrap.contains(ev.target)) { _tools(false); } document.removeEventListener('pointerdown', off, true); }, true); }, 0);
  }
  var camIn = wrap.querySelector('[data-c="cam"]');
  if (camIn) camIn.addEventListener('change', function () { _cxUpload(Array.prototype.slice.call(camIn.files || []), inThread ? CX.thread : null); camIn.value = ''; });
  ta.addEventListener('focus', function () { if (wrap.classList.contains('tools-open')) _tools(false); });
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
    if (!inThread) { _cxDraftSave(''); if (CX.readMark != null) CX.readMark = null; }
    _cxSend(v, inThread ? CX.thread : null, inThread ? null : CX.cards.slice());
    if (!inThread) { CX.cards = []; _cxDrawChips(); }
  }
}
function _cxSend(body, replyTo, cards, quoteId) {
  var room = CX.room, pid = null;
  if (quoteId === undefined && !replyTo && CX.quote) { quoteId = CX.quote.id; }
  var ack = !replyTo && CX.ackNext && body && body[0] !== '/';   // v13.381 ✔ 확인 요청
  if (ack) { CX.ackNext = false; var cp0 = document.getElementById('cxComp'); if (cp0) { cp0.classList.remove('ack-on'); cp0.querySelectorAll('[data-c="ack"]').forEach(function (x) { x.classList.remove('on'); }); var ch0 = cp0.querySelector('[data-ackchip]'); if (ch0) ch0.hidden = true; } }
  var quote = quoteId ? (CX.quote && CX.quote.id === quoteId ? CX.quote.q : _cxQuoteOf(_cxFindMsg(quoteId))) : null;
  if (!replyTo && CX.quote) _cxEndQuote();
  if (CX.fwd && !replyTo) _cxToLatest();   // v13.375 옛 대화를 읽다가 보내면 최근으로
  if (!replyTo && body && body[0] !== '/') {   // v13.366 보내는 중 — 바로 보이게
    pid = 'p' + (++CX.pendSeq);
    CX.msgs.push({ id: pid, pending: true, roomId: room, userId: _cxMe(), userName: (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '', kind: 'text', body: body, cards: cards && cards.length ? cards : null, mentions: [], at: new Date().toISOString(), quote: quote, ack: ack ? { req: true, by: {} } : null });
    _cxDrawMsgs(true);
    var bx = document.getElementById('cxMsgs'); if (bx) bx.scrollTop = bx.scrollHeight;
  }
  function settle(real, failed) {
    if (!pid || CX.room !== room) return false;
    for (var i = 0; i < CX.msgs.length; i++) if (CX.msgs[i].id === pid) {
      if (failed) { CX.msgs[i].failed = true; CX.msgs[i].wait = failed === 'net'; }
      else if (real && !CX.msgs.some(function (x) { return x.id === real.id; })) CX.msgs[i] = real;
      else CX.msgs.splice(i, 1);
      _cxDrawMsgs(true); return true;
    }
    if (real) { _cxUpsert(real, true); _cxDrawMsgs(true); }   // 실시간으로 먼저 바뀌어 있음
    return true;
  }
  return apiFetch('/api/chat/rooms/' + room + '/messages', { method: 'POST', body: JSON.stringify({ body: body, replyTo: replyTo || null, cards: cards && cards.length ? cards : undefined, quoteId: quoteId || undefined, ack: ack || undefined }), timeoutMs: /^\/(ai|요약|summary)/.test(body) ? 120000 : 15000 })
    .then(function (r) { if (settle(r && r.data, false)) return; if (r && r.data && CX.room === room) { if (r.data.replyTo) { if (CX.thread === r.data.replyTo && !CX.threadMsgs.some(function (m) { return m.id === r.data.id; })) { CX.threadMsgs.push(r.data); _cxDrawThread(true); } } else if (_cxAddIfNew(r.data)) _cxDrawMsgs(true); } })
    .catch(function (e) { var net = !navigator.onLine || /fetch|network|timeout|시간|Failed/i.test(_cxErr(e)); if (settle(null, net ? 'net' : true)) { _cxToast(net ? '⏳ 연결이 약합니다 — 다시 연결되면 자동으로 보냅니다' : _cxErr(e), net ? 'warn' : 'error'); return; } _cxToast(_cxErr(e), 'error'); var ta = document.getElementById(replyTo ? 'cxThIn' : 'cxIn'); if (ta && !ta.value) ta.value = body; });
}
/* v13.376 💬 인용 답장 — 카톡 '답장' */
function _cxQuoteOf(m) {
  if (!m) return null;
  return { id: m.id, userName: m.userName || (m.kind === 'ai' ? 'AI' : ''), body: String(m.post ? '📌 ' + m.post.title : m.body || '').slice(0, 200), file: m.file ? { id: m.file.id, name: m.file.name, mime: m.file.mime } : null, deleted: !!m.deleted };
}
function _cxQuoteHtml(q) {
  var img = q.file && /^image\//i.test(q.file.mime || '');
  var txt = q.deleted ? '삭제된 메시지' : q.body ? q.body.replace(/\s+/g, ' ') : q.file ? (img ? '📷 사진' : '📎 ' + q.file.name) : '';
  return '<button type="button" class="cx-q' + (q.deleted ? ' del' : '') + '" data-qjump="' + q.id + '" title="원문으로 가기">' +
    (img && !q.deleted ? '<img alt="" data-blob="' + _cxE(q.file.id) + '" data-small="1">' : '') +
    '<span><b>' + _cxE(q.userName || '') + '</b><i>' + _cxE(txt) + '</i></span></button>';
}
function _cxStartQuote(m) {
  if (!m || typeof m.id !== 'number') return;
  if (CX.editId) _cxCancelEdit();
  CX.quote = { id: m.id, q: _cxQuoteOf(m) };
  var rb = document.querySelector('#cxComp [data-replybar]'); if (!rb) return;
  rb.hidden = false; rb.className = 'cx-reply is-quote';
  rb.innerHTML = '<span class="cx-rq">↩ <b></b> 에게 답장<i></i></span><button type="button" class="cx-ib" data-unquote title="답장 그만 (Esc)">✕</button>';
  rb.querySelector('b').textContent = CX.quote.q.userName || '';
  rb.querySelector('i').textContent = CX.quote.q.body || (CX.quote.q.file ? '📎 ' + CX.quote.q.file.name : '');
  var ta = document.getElementById('cxIn'); if (ta) ta.focus();
}
function _cxEndQuote() {
  CX.quote = null;
  var rb = document.querySelector('#cxComp [data-replybar]');
  if (rb && rb.classList.contains('is-quote')) { rb.hidden = true; rb.className = 'cx-reply'; rb.innerHTML = ''; }
}
function _cxStartEdit(m) {
  CX.editId = m.id;
  var ta = document.getElementById('cxIn'); if (!ta) return;
  ta.value = m.body; ta.focus(); ta.dispatchEvent(new Event('input'));
  if (CX.quote) _cxEndQuote();
  var rb = document.querySelector('#cxComp [data-replybar]'); rb.hidden = false; rb.className = 'cx-reply';
  rb.innerHTML = '<span>✏️ 메시지 수정 중 — Enter 저장 · Esc 취소</span><button type="button" class="cx-ib" data-unreply>✕</button>';
}
/* 방마다 쓰다 만 글 — 방을 옮겨도 남음 */
function _cxDraftSave(v) {
  if (!CX.room) return;
  if (v === undefined) { var ta = document.getElementById('cxIn'); if (!ta || CX.editId) return; v = ta.value; }
  if (v && v.trim()) CX.drafts[CX.room] = v.slice(0, 4000); else delete CX.drafts[CX.room];
  clearTimeout(CX.draftT); CX.draftT = setTimeout(function () { _cxLsSet('wm-cx-drafts', JSON.stringify(CX.drafts)); }, 500);
}
function _cxCancelEdit() {
  CX.editId = null;
  var ta = document.getElementById('cxIn'); if (ta) { ta.value = CX.drafts[CX.room] || ''; ta.style.height = 'auto'; }
  var rb = document.querySelector('#cxComp [data-replybar]'); if (rb) rb.hidden = true;
}
function _cxDrawChips() {
  var c = document.querySelector('#cxComp [data-chips]'); if (!c) return;
  c.innerHTML = CX.cards.map(function (k, i) { return '<span class="cx-chip">' + (CX_ICON[k.type] || '🔗') + ' ' + _cxE(k.title) + '<button type="button" data-unchip="' + i + '" aria-label="빼기">✕</button></span>'; }).join('');
}

/* 파일 올리기 — 하나씩 · 진행 표시 */
/* v13.377 🖼 사진 — 보내기 전에 줄이고(긴 변 2048 · 방향 바로) 작은 미리보기(360)를 만듦. '원본 화질'이면 그대로 */
var CX_PHOTO_MAX = 2048, CX_THUMB = 360;
function _cxIsPhoto(f) { return /^image\/(jpeg|png|webp|bmp)$/i.test((f && (f.type || f.mime)) || ''); }
function _cxPhotoOrig() { return _cxLsGet('wm-cx-photo') === 'orig'; }
function _cxBitmap(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); });
  return new Promise(function (ok, no) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { ok(im); }; im.onerror = no; im.src = u; });
}
function _cxCanvasOf(bmp, max) {
  var w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight, k = Math.min(1, max / Math.max(w, h));
  var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
function _cxJpeg(c, q) { return new Promise(function (ok) { c.toBlob(function (b) { ok(b); }, 'image/jpeg', q); }); }
/** → { file: 보낼 것, thumb: 미리보기 Blob|null } */
function _cxPrepPhoto(f) {
  if (!_cxIsPhoto(f)) return Promise.resolve({ file: f, thumb: null });
  return _cxBitmap(f).then(function (bmp) {
    var w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    var big = _cxPhotoOrig() || (f.size < 500 * 1024 && Math.max(w, h) <= CX_PHOTO_MAX) ? Promise.resolve(f)
      : _cxJpeg(_cxCanvasOf(bmp, CX_PHOTO_MAX), 0.85).then(function (b) { return b && b.size < f.size ? new File([b], f.name.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.jpg', { type: 'image/jpeg' }) : f; });
    var th = Math.max(w, h) > CX_THUMB * 1.3 ? _cxJpeg(_cxCanvasOf(bmp, CX_THUMB), 0.72) : Promise.resolve(null);
    return Promise.all([big, th]).then(function (r) { if (bmp.close) try { bmp.close(); } catch (e) {} return { file: r[0], thumb: r[1] }; });
  }).catch(function () { return { file: f, thumb: null }; });
}
function _cxPutThumb(fid, blob) {
  if (!fid || !blob) return Promise.resolve();
  return fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/files/' + encodeURIComponent(fid) + '/thumb', { method: 'POST', headers: { Authorization: 'Bearer ' + _accessToken, 'Content-Type': 'image/jpeg' }, body: blob }).catch(function () {});
}
function _cxUpload(files, replyTo) {
  if (!files || !files.length || !CX.room) return;
  var room = CX.room, qid = !replyTo && CX.quote ? CX.quote.id : null;
  if (qid) _cxEndQuote();
  var photos = files.filter(_cxIsPhoto);
  files = photos.slice(0, 30).concat(files.filter(function (f) { return !_cxIsPhoto(f); }).slice(0, 10));
  var grp = !replyTo && photos.length > 1 ? 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : null;   // 여러 장 = 앨범
  var chain = Promise.resolve();   // 차례로 — 앨범 순서 · 휴대폰 부담
  files.forEach(function (f0) { chain = chain.then(function () { return _cxUploadOne(f0, room, replyTo, qid, _cxIsPhoto(f0) ? grp : null); }); });
}
function _cxUploadOne(f0, room, replyTo, qid, grp) {
  return _cxPrepPhoto(f0).then(function (prep) { return new Promise(function (done) {
    var f = prep.file;
    var tip = document.createElement('div'); tip.className = 'cx-upl'; tip.innerHTML = '<span></span><i><b style="width:0%"></b></i><em></em>';
    tip.querySelector('span').textContent = '📎 ' + f.name;
    var host = document.getElementById('cxTyping'); if (host) host.parentNode.insertBefore(tip, host);
    function prog(p) { tip.querySelector('b').style.width = Math.round(p * 100) + '%'; tip.querySelector('em').textContent = f.size > 5 * 1048576 ? _cxSize(f.size * p) + ' / ' + _cxSize(f.size) : ''; }
    function ok(d) {
      tip.remove();
      if (d && prep.thumb && d.file) { CX.blobs[d.file.id + ':t'] = Promise.resolve(URL.createObjectURL(prep.thumb)); _cxPutThumb(d.file.id, prep.thumb); }   // 내 화면은 바로 미리보기
      if (d && CX.room === room && !d.replyTo && _cxAddIfNew(d)) _cxDrawMsgs(true);
      done();
    }
    function fail(m) { tip.remove(); _cxToast(f.name + ' — ' + (m || '올리지 못했습니다'), 'error'); done(); }
    // v13.386 📦 8MB 넘는 파일 — GCS 로 바로 · 나눠서 · 끊기면 이어서 (chat-upload.js). 못 쓰면 예전 길(25MB 까지)
    if (typeof chatUploadWantsDirect === 'function' && chatUploadWantsDirect(f)) {
      var sig = {}, x = document.createElement('button'); x.type = 'button'; x.className = 'cx-upl-x'; x.title = '올리기 취소'; x.textContent = '✕';
      x.addEventListener('click', function () { if (sig.cancel) sig.cancel(); });
      tip.appendChild(x);
      chatUploadDirect(f, room, { replyTo: replyTo || null, quoteId: !replyTo && qid ? qid : null, grp: grp, onProgress: prog, signal: sig }).then(ok, function (e) {
        if (e && e.cancel) { tip.remove(); _cxToast(f.name + ' — 올리기를 취소했습니다', 'info'); done(); return; }
        if (e && e.fallback && f.size <= 25 * 1024 * 1024) { x.remove(); legacy(); return; }
        fail(e && e.fallback ? '큰 파일 바로 올리기를 쓸 수 없어 25MB 까지만 올릴 수 있습니다' : (e && e.message) || (e && e.net ? '연결이 끊겨 올리지 못했습니다 — 다시 보내 주세요' : ''));
      });
      return;
    }
    legacy();
    function legacy() {
      if (f.size > 25 * 1024 * 1024) { fail('25MB 까지 올릴 수 있습니다'); return; }
      var xhr = new XMLHttpRequest();
      xhr.open('POST', (typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/rooms/' + encodeURIComponent(room) + '/files?name=' + encodeURIComponent(f.name) + (replyTo ? '&replyTo=' + replyTo : '') + (!replyTo && qid ? '&quoteId=' + qid : '') + (grp ? '&grp=' + grp : '') + (f0._dur ? '&dur=' + f0._dur : ''));
      xhr.setRequestHeader('Authorization', 'Bearer ' + _accessToken);
      xhr.setRequestHeader('Content-Type', f.type || 'application/octet-stream');
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) prog(e.loaded / e.total); };
      xhr.onload = function () {
        if (xhr.status >= 300) { var m = '올리지 못했습니다'; try { m = JSON.parse(xhr.responseText).message || m; } catch (e) {} fail(m); return; }
        var d = null; try { d = JSON.parse(xhr.responseText).data; } catch (e) {}
        ok(d);
      };
      xhr.onerror = function () { fail(); };
      xhr.send(f);
    }
  }); });
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
  _cxLoadBlobs(box); _cxDrawReadCounts();
  box.scrollTop = box.scrollHeight;
}

/* ─── 오른쪽: 답글 줄기 · 프로젝트 현황 · 멤버 · 파일 ─── */
/* v13.389 옆 칸 닫기 — 휴대폰은 옆 칸이 화면을 다 덮으므로 ‹ 대화 단추 · 뒤로 가기(아이폰 밀기 · 안드로이드 뒤로)로 닫힘 */
function _cxAsideClose(fromPop) {
  if (CX.thread) { CX.thread = null; if (_cxIsPhone()) CX.aside = false; } else CX.aside = false;
  _cxDrawAside(); _cxDrawHead();
}
/** 휴대폰에서 옆 칸이 열리면 기록 한 칸을 넣어 뒤로 가기가 옆 칸을 닫게, 닫히면 그 칸을 뺌 */
function _cxAsideHist(open) {
  if (open) {
    if (!_cxIsPhone() || CX.histAside) return;
    CX.histAside = true; try { history.pushState({ cxAside: 1 }, ''); } catch (e) {}
  } else if (CX.histAside) {
    CX.histAside = false; CX.histSkip = true; try { history.back(); } catch (e) { CX.histSkip = false; }
  }
}
window.addEventListener('popstate', function () {
  if (CX.histSkip) { CX.histSkip = false; return; }
  if (CX.histAside) { CX.histAside = false; _cxAsideClose(true); }
});
function _cxDrawAside() {
  var a = document.getElementById('cxAside'); if (!a) return;
  var root = document.querySelector('#mMessages .cx'); if (root) root.classList.toggle('no-aside', !CX.aside || !CX.room);
  if (!CX.room || !CX.aside) { a.innerHTML = ''; _cxAsideHist(false); return; }
  _cxAsideHist(true);
  if (CX.thread) {
    a.innerHTML = '<div class="cx-as-h">' + '<button type="button" class="cx-ib cx-as-back" data-x aria-label="대화로 돌아가기">‹ 대화</button>' + '<b>💬 답글</b><button type="button" class="cx-ib" data-x aria-label="닫기">✕</button></div><div class="cx-msgs cx-th-msgs" id="cxThMsgs"></div>' + _cxComposerHtml('cxThIn', 'cxThComp');
    a.querySelectorAll('[data-x]').forEach(function (x) { x.addEventListener('click', function () { _cxAsideClose(); }); });
    a.querySelector('#cxThMsgs').addEventListener('click', _cxMsgClick); _cxLongPress(a.querySelector('#cxThMsgs'));
    _cxBindComposer('cxThIn', 'cxThComp', true);
    _cxDrawThread();
    return;
  }
  var tab = _cxAsideTab();
  var tabs = (CX.info && CX.info.kind === 'project' ? [['ctx', '📊 현황']] : []).concat(CX.info && CX.info.equipKey ? [['equip', '🏭 장비']] : []).concat([['board', '📌 게시판'], ['docs', '📝 문서'], ['people', '👤 멤버'], ['files', '📎 파일']]);
  a.innerHTML = '<div class="cx-as-tabs">' + '<button type="button" class="cx-ib cx-as-back" data-x aria-label="대화로 돌아가기">‹ 대화</button>' + tabs.map(function (t) { return '<button type="button" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '<button type="button" class="cx-ib" data-x aria-label="닫기">✕</button></div><div class="cx-as-b" id="cxAsB"></div>';
  a.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { CX.asideTab = b.dataset.tab; _cxDrawAside(); }); });
  a.querySelectorAll('[data-x]').forEach(function (x) { x.addEventListener('click', function () { _cxAsideClose(); }); });
  var b = a.querySelector('#cxAsB');
  if (tab === 'ctx') b.innerHTML = _cxCtxHtml();
  else if (tab === 'board' && typeof chatPostsTab === 'function') chatPostsTab(b);
  else if (tab === 'docs' && typeof chatDocsTab === 'function') chatDocsTab(b);
  else if (tab === 'equip' && typeof chatEquipAside === 'function') chatEquipAside(b);
  else if (tab === 'people') {
    var ms = (CX.info && CX.info.members) || [];
    var mg = CX.info && CX.info.canManage;
    b.innerHTML = (CX.info && CX.info.kind !== 'dm' ? '<div class="cx-roles">👑 방장 ' + ms.filter(function (m) { return m.role === 'owner'; }).length + ' · 멤버 ' + ms.length + (ms.some(function (m) { return m.role === 'readonly'; }) ? ' · 👁 읽기만 ' + ms.filter(function (m) { return m.role === 'readonly'; }).length : '') + '</div>' : '') +
      ms.map(function (m) { return '<div class="cx-pp">' + _cxAv(m.id, m.name, m.online) + '<span><b>' + _cxE(m.name) + (m.me ? ' (나)' : '') + (m.role === 'owner' ? ' <em class="cx-role own">👑 방장</em>' : m.role === 'readonly' ? ' <em class="cx-role ro">👁 읽기만</em>' : '') + '</b><i>' + _cxE([m.status && typeof chatStatusText === 'function' ? chatStatusText(m.status) : '', m.dept || ''].filter(Boolean).join(' · ')) + '</i></span>' +
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
      html: '<button type="button" class="cx-self-b" data-self>📝 <b>나와의 채팅</b><i>PC ↔ 휴대폰 파일 옮기기 · 메모 · 링크 모아 두기</i></button>' +
        '<div class="cx-seg"><button type="button" data-k="dm" class="on">👤 1:1</button><button type="button" data-k="group">👥 그룹</button><button type="button" data-k="project">📁 프로젝트 방</button></div>' +
        '<div data-pane></div>' });
    var pane = m.box.querySelector('[data-pane]');
    m.box.querySelector('[data-self]').addEventListener('click', function () {   // v13.380
      apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'self' }) }).then(function (r) { m.close(); _cxLoadRooms().then(function () { chatOpenRoom(r.data.id); }); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
    });
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
        '<div class="cx-hist-note">초대한 사람도 이 방의 대화를 처음부터 모두 봅니다</div>' +
        '<div class="cx-mfoot"><span data-n>0명</span><button type="button" class="wm-pri" data-go disabled>초대</button></div>' });
    var picked = [];
    _cxPeoplePick(m.box, true, CX.info.members.map(function (x) { return x.id; }), function (ids) { picked = ids; m.box.querySelector('[data-n]').textContent = ids.length + '명'; m.box.querySelector('[data-go]').disabled = !ids.length; });
    m.box.querySelector('[data-go]').addEventListener('click', function () {
      apiFetch('/api/chat/rooms/' + CX.room + '/members', { method: 'POST', body: JSON.stringify({ userIds: picked }) }).then(function () { m.close(); chatOpenRoom(CX.room, true); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
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
