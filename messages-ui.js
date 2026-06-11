/* ═══════════════════════════════════════════════════════════════════════
   messages-ui.js — 사용자 간 1:1 메시지(쪽지) 메뉴
   ─────────────────────────────────────────────────────────────────────
   업무 인수인계 맥락 전달·개인 알림 채널. 별도 최상위 메뉴(✉️ 메시지).
   서버 API:
     GET  /api/messages/unread-count         → {count}
     GET  /api/messages/threads              → 대화 목록(상대별 최신+미읽음)
     GET  /api/messages?withUserId=          → 특정 상대와 대화(읽음처리)
     POST /api/messages  {toUserId, body, contextType?, contextId?}
     POST /api/messages/read  {fromUserId}
   전역 의존: apiFetch, toCamelArray, eH, showToast, currentUser, userLookup.
   ═══════════════════════════════════════════════════════════════════════ */

function _mqEsc(s) { return (typeof eH === 'function') ? eH(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _mqToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _mqRel(iso) {
  if (typeof _pdRelTime === 'function') { var r = _pdRelTime(iso); if (r) return r; }
  try { var d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString(); } catch (e) { return ''; }
}
function _mqMe() { return (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.sub || currentUser.id) : null; }

/* ── 데이터 래퍼 ─────────────────────────────────────────────────────── */
function msgUnreadCount() {
  return apiFetch('/api/messages/unread-count').then(function (r) { return (r && r.count) || 0; });
}
function msgThreadsGet() {
  return apiFetch('/api/messages/threads').then(function (r) { return toCamelArray(r.data); });
}
function msgThreadGet(peerId) {
  return apiFetch('/api/messages?withUserId=' + encodeURIComponent(peerId)).then(function (r) { return toCamelArray(r.data); });
}
function msgSend(toUserId, body, ctx) {
  ctx = ctx || {};
  return apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ toUserId: toUserId, body: body, contextType: ctx.type, contextId: ctx.id }) })
    .then(function (r) { return r && r.data; });
}

/* ── 메뉴 미읽음 뱃지 ────────────────────────────────────────────────── */
function refreshMsgBadge() {
  if (typeof apiFetch !== 'function' || !_mqMe()) return;
  msgUnreadCount().then(function (n) {
    var b = document.getElementById('msgBadge');
    if (!b) return;
    if (n > 0) { b.textContent = n > 99 ? '99+' : n; b.style.display = 'inline-flex'; }
    else { b.style.display = 'none'; }
  }).catch(function () {});
}

/* ── 현재 열린 대화 상대 ─────────────────────────────────────────────── */
var _msgPeer = null;
var _msgPeerName = '';

/* ── 메인 렌더 ───────────────────────────────────────────────────────── */
function renderMessages() {
  var el = document.getElementById('mMessages');
  if (!el) return;
  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
      '<h2 style="margin:0;font-size:18px;color:var(--t2)">✉️ 메시지</h2>' +
      '<button class="btn btn-p btn-s" onclick="msgNewMessage()">✏️ 새 메시지</button>' +
    '</div>' +
    '<div style="display:flex;gap:12px;align-items:stretch;min-height:420px;max-height:calc(100vh - 240px)">' +
      '<div id="msgThreadList" style="width:280px;flex-shrink:0;overflow:auto;border:1px solid var(--bd);border-radius:10px;background:var(--bg-p)"></div>' +
      '<div id="msgThreadView" style="flex:1;display:flex;flex-direction:column;border:1px solid var(--bd);border-radius:10px;background:var(--bg-p);overflow:hidden">' +
        '<div style="margin:auto;color:var(--t6);font-size:12px;padding:30px">왼쪽에서 대화를 선택하거나 [새 메시지]로 시작하세요.</div>' +
      '</div>' +
    '</div>';
  _msgRenderThreadList();
  refreshMsgBadge();
}

function _msgRenderThreadList() {
  var box = document.getElementById('msgThreadList');
  if (!box) return;
  box.innerHTML = '<div style="font-size:11px;color:var(--t6);padding:12px">로딩 중...</div>';
  msgThreadsGet().then(function (list) {
    list = list || [];
    if (!list.length) { box.innerHTML = '<div style="font-size:11px;color:var(--t6);padding:14px;line-height:1.6">아직 주고받은 메시지가 없습니다.<br>[새 메시지]로 시작하세요.</div>'; return; }
    box.innerHTML = list.map(function (t) {
      var nm = t.peerDisplay || t.peerName || '?';
      var active = (_msgPeer === t.peer);
      var unread = Number(t.unread) || 0;
      var last = (t.fromUserId === _mqMe() ? '나: ' : '') + (t.body || '');
      return '<div onclick="msgOpenThread(\'' + t.peer + '\',\'' + _mqJs(nm) + '\')" style="padding:10px 12px;border-bottom:1px solid var(--bd);cursor:pointer;' + (active ? 'background:var(--bg-hv)' : '') + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">' +
          '<span style="font-size:12px;font-weight:600;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _mqEsc(nm) + '</span>' +
          (unread > 0 ? '<span style="background:#EF4444;color:#fff;font-size:9px;font-weight:700;border-radius:9px;min-width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;padding:0 4px;flex-shrink:0">' + (unread > 99 ? '99+' : unread) + '</span>' : '') +
        '</div>' +
        '<div style="font-size:10px;color:var(--t6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">' + _mqEsc(last.slice(0, 40)) + '</div>' +
      '</div>';
    }).join('');
  }).catch(function (err) {
    box.innerHTML = '<div style="font-size:11px;color:var(--t6);padding:14px">' + ((err && err.status === 404) ? '서버 배포 후 사용할 수 있습니다.' : '대화 목록을 불러오지 못했습니다.') + '</div>';
  });
}

// 단일따옴표 onclick 인자용 — 따옴표/역슬래시 이스케이프
function _mqJs(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function msgOpenThread(peerId, peerName) {
  _msgPeer = peerId; _msgPeerName = peerName || '';
  _msgRenderThreadList();
  var view = document.getElementById('msgThreadView');
  if (!view) return;
  view.innerHTML =
    '<div style="padding:10px 14px;border-bottom:1px solid var(--bd);font-size:13px;font-weight:700;color:var(--t2);flex-shrink:0">' + _mqEsc(peerName) + '</div>' +
    '<div id="msgThreadBody" style="flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px"><div style="color:var(--t6);font-size:11px">로딩 중...</div></div>' +
    '<div style="display:flex;gap:6px;padding:10px;border-top:1px solid var(--bd);flex-shrink:0">' +
      '<textarea id="msgComposeBody" rows="2" placeholder="메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)" style="flex:1;resize:none;box-sizing:border-box;padding:8px;font-size:12px;border:1px solid var(--bd);border-radius:8px;background:var(--bg-i);color:var(--t2)" onkeydown="msgComposeKey(event)"></textarea>' +
      '<button class="btn btn-p" onclick="msgSendUI()" style="flex-shrink:0">전송</button>' +
    '</div>';
  msgThreadGet(peerId).then(function (msgs) {
    _msgRenderMsgs(msgs || []);
    refreshMsgBadge();
    _msgRenderThreadList(); // 미읽음 갱신
  }).catch(function (err) {
    var body = document.getElementById('msgThreadBody');
    if (body) body.innerHTML = '<div style="color:var(--t6);font-size:11px">' + ((err && err.status === 404) ? '서버 배포 후 사용할 수 있습니다.' : '대화를 불러오지 못했습니다.') + '</div>';
  });
  var ta = document.getElementById('msgComposeBody'); if (ta) ta.focus();
}

function _msgRenderMsgs(msgs) {
  var body = document.getElementById('msgThreadBody');
  if (!body) return;
  var me = _mqMe();
  if (!msgs.length) { body.innerHTML = '<div style="color:var(--t6);font-size:11px;margin:auto">첫 메시지를 보내보세요.</div>'; return; }
  body.innerHTML = msgs.map(function (m) {
    var mine = (m.fromUserId === me);
    var when = _mqRel(m.createdAt);
    var bubble = mine
      ? 'align-self:flex-end;background:var(--ac);color:#fff'
      : 'align-self:flex-start;background:var(--bg-i);color:var(--t2);border:1px solid var(--bd)';
    return '<div style="max-width:78%;' + bubble + ';padding:7px 11px;border-radius:12px;font-size:12px;line-height:1.5;word-break:break-word;white-space:pre-wrap">' +
      _mqEsc(m.body) +
      '<div style="font-size:9px;opacity:.7;margin-top:3px;text-align:right">' + _mqEsc(when) + (mine && m.readAt ? ' · 읽음' : '') + '</div>' +
    '</div>';
  }).join('');
  body.scrollTop = body.scrollHeight;
}

function msgComposeKey(ev) {
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); msgSendUI(); }
}

function msgSendUI() {
  if (!_msgPeer) return;
  var ta = document.getElementById('msgComposeBody');
  var body = ta ? (ta.value || '').trim() : '';
  if (!body) { if (ta) ta.focus(); return; }
  if (ta) ta.disabled = true;
  msgSend(_msgPeer, body).then(function () {
    if (ta) { ta.value = ''; ta.disabled = false; ta.focus(); }
    return msgThreadGet(_msgPeer);
  }).then(function (msgs) {
    _msgRenderMsgs(msgs || []);
    _msgRenderThreadList();
  }).catch(function (err) {
    if (ta) ta.disabled = false;
    var msg = (err && err.status === 404) ? '서버 배포 후 사용할 수 있습니다.' : ((err && err.message) || '전송 실패');
    _mqToast('❌ ' + msg, 'error');
  });
}

/* ── 새 메시지(사용자 선택) ──────────────────────────────────────────── */
function msgNewMessage() {
  if (typeof userLookup !== 'function') { _mqToast('사용자 목록을 불러올 수 없습니다.', 'error'); return; }
  userLookup().then(function (users) {
    var me = _mqMe();
    users = (users || []).filter(function (u) { return u.id !== me; });
    var opts = users.map(function (u) { return '<option value="' + u.id + '">' + _mqEsc(u.displayName || u.name || u.id) + '</option>'; }).join('');
    var ex = document.getElementById('msgNewModal'); if (ex) ex.remove();
    var m = document.createElement('div'); m.id = 'msgNewModal';
    m.style.cssText = 'position:fixed;inset:0;z-index:10002;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(3px)';
    m.innerHTML = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:12px;padding:18px;width:340px;max-width:94%">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="font-size:13px;font-weight:700;color:var(--t1)">✏️ 새 메시지</h3><button class="btn btn-g btn-s" onclick="document.getElementById(\'msgNewModal\').remove()">✕</button></div>' +
      '<label class="fl" style="font-size:11px">받는 사람</label>' +
      '<select id="msgNewUser" class="si" style="width:100%;margin-bottom:10px">' + (opts || '<option value="">사용자 없음</option>') + '</select>' +
      '<div style="display:flex;gap:8px"><button class="btn btn-g" style="flex:1" onclick="document.getElementById(\'msgNewModal\').remove()">취소</button><button class="btn btn-p" style="flex:1" onclick="msgNewStart()">대화 열기</button></div>' +
    '</div>';
    document.body.appendChild(m);
  }).catch(function () { _mqToast('사용자 목록 로드 실패', 'error'); });
}

function msgNewStart() {
  var sel = document.getElementById('msgNewUser');
  var uid = sel ? sel.value : '';
  if (!uid) { _mqToast('받는 사람을 선택하세요', 'warn'); return; }
  var nm = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
  var md = document.getElementById('msgNewModal'); if (md) md.remove();
  msgOpenThread(uid, nm);
}

/* ── 다른 화면에서 특정 사용자에게 바로 메시지 (예: 담당 이관) ─────────── */
function msgComposeTo(userId, userName) {
  if (typeof setPage === 'function') setPage('messages');
  setTimeout(function () { msgOpenThread(userId, userName || ''); }, 60);
}

/* ── 미읽음 뱃지 주기 갱신(로그인 상태일 때만) ───────────────────────── */
if (typeof window !== 'undefined' && !window._msgBadgeTimer) {
  window._msgBadgeTimer = setInterval(function () {
    if (typeof currentUser !== 'undefined' && currentUser && document.getElementById('msgBadge')) refreshMsgBadge();
  }, 90000);
}

/* ── 전역 노출 ───────────────────────────────────────────────────────── */
if (typeof window !== 'undefined') {
  window.renderMessages = renderMessages;
  window.refreshMsgBadge = refreshMsgBadge;
  window.msgOpenThread = msgOpenThread;
  window.msgSendUI = msgSendUI;
  window.msgComposeKey = msgComposeKey;
  window.msgNewMessage = msgNewMessage;
  window.msgNewStart = msgNewStart;
  window.msgComposeTo = msgComposeTo;
}
