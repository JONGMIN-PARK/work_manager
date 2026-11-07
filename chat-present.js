/* chat-present.js — 🎤 발표 모드 (v13.370 · 발표 펜 3단계)
 *   방 머리 🎤 → 화면 공유 + 음성 통화 + 발표 펜을 한 번에. 끝나면 "발표 정리"(시간 · 들은 사람 · 반응 · 질문)를 방에 남김
 *   보는 사람: ✋ 손들기 · 💬 질문 · 👏 👍 반응 · Alt 누른 채 움직이면 내 이름표 포인터
 *   발표자: 👥 패널 — 손든 사람에게 펜 주기 · 회수 · 내리기, 질문 답함 표시 (PC 앱 투명 창 막대에서도 같음)
 *   전달은 발표 펜 채널(chat-ink.js) 그대로 — 발표자 웹 화면이 상태(CI.pres)의 주인, 바뀌면 'pres' 로 모두에게
 *     보는 사람 → 발표자: hand · q · rx   발표자 → 모두: pres · rx   투명 창 → 웹 화면: hcmd
 */
var CP_RX = ['👏', '👍', '❤️', '😮'];
function _cpE(s) { return typeof _ciE === 'function' ? _ciE(s) : String(s == null ? '' : s); }
function _cpToast(m, t) { if (typeof _cxToast === 'function') _cxToast(m, t); }
function _cpNew() { return { on: true, hands: {}, qs: [], grant: {}, rx: {}, seen: {} }; }
function _cpState() { var p = CI.pres || {}; return { t: 'pres', hands: p.hands || {}, qs: p.qs || [], grant: p.grant || {} }; }
function _cpCast() { if (CI.role === 'host' && CI.pres && !CI.relay) _ciCast(_cpState()); }

/* ─── 시작 · 끝 (발표자 웹 화면) ─── */
function chatPresStart(roomId) {
  if (typeof CRT === 'undefined') return;
  if (CRT.share && CRT.share.roomId !== roomId) { _cpToast('다른 방에서 화면 공유 중입니다 — 먼저 끝내 주세요', 'warn'); return; }
  function begin() {
    CI.role = 'host';
    CI.pres = CI.pres || _cpNew(); CI.pres.room = roomId; CI.pres.at = CI.pres.at || Date.now();
    if (typeof chatInkHostOpen === 'function') chatInkHostOpen();
    if (typeof chatCallStart === 'function' && typeof CALL !== 'undefined' && !CALL) {
      chatCallStart(roomId, false); CI.pres.call = true;
      var k = 0, mt = setInterval(function () {   // 통화 창은 작게 — 발표 화면을 가리지 않게
        var w = document.querySelector('.cl-win'); if (w && CALL) { CALL.small = true; w.classList.add('small'); clearInterval(mt); } else if (++k > 40) clearInterval(mt);
      }, 100);
    }
    _cpCast(); if (typeof _crtBar === 'function') _crtBar();
    _cpToast('🎤 발표를 시작했습니다 — 화면 공유 · 음성 · 발표 펜', 'success');
  }
  if (CRT.share) { begin(); return; }
  chatRtcShare(roomId);
  var n = 0, t = setInterval(function () {   // 화면 고르기를 마치면
    if (CRT.share && CRT.share.roomId === roomId) { clearInterval(t); begin(); }
    else if (++n > 240) clearInterval(t);
  }, 250);
}
/* 공유가 끝날 때 chat-ink.js 의 chatInkEnd 가 부름 — 정리를 방에 */
function chatPresEnd() {
  var p = CI.pres; if (!p || !p.on || CI.role !== 'host' || CI.relay || !p.room) return;
  p.on = false;
  var end = Date.now(), min = Math.max(1, Math.round((end - p.at) / 60000));
  var hm = function (t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
  var names = Object.keys(p.seen).map(function (u) { return p.seen[u]; }).filter(Boolean);
  var rx = Object.keys(p.rx).filter(function (e) { return p.rx[e]; }).map(function (e) { return e + ' ' + p.rx[e]; });
  var lines = ['🎤 발표 정리', '· 시간: ' + hm(p.at) + ' ~ ' + hm(end) + ' (' + min + '분)', '· 들은 사람: ' + (names.length ? names.join(', ') + ' (' + names.length + '명)' : '없음')];
  if (rx.length) lines.push('· 반응: ' + rx.join(' · '));
  if (p.qs.length) {
    lines.push('· 질문 ' + p.qs.length + '개' + (p.qs.some(function (q) { return !q.done; }) ? ' — 답 못 한 것 ' + p.qs.filter(function (q) { return !q.done; }).length + '개' : ''));
    p.qs.forEach(function (q, i) { lines.push('  ' + (i + 1) + '. ' + q.text + ' — ' + q.name + (q.done ? ' ✅' : ' ⏳')); });
  }
  if (p.snaps) lines.push('· 📸 캡처 ' + p.snaps + '장은 위에 올라가 있습니다');
  apiFetch('/api/chat/rooms/' + encodeURIComponent(p.room) + '/messages', { method: 'POST', body: JSON.stringify({ body: lines.join('\n') }) }).catch(function () {});
  if (p.call && typeof chatCallLeave === 'function' && typeof CALL !== 'undefined' && CALL && CALL.roomId === p.room) chatCallLeave();
}

/* ─── 발표자: 보는 사람이 보낸 것 ─── */
function chatPresFromViewer(uid, m) {   // true = 발표 메시지였음
  if (['hand', 'q', 'rx'].indexOf(m.t) < 0) return false;
  var p = CI.pres || (CI.pres = _cpNew()), nm = _ciName(uid) || '참여자';
  if (m.t === 'hand') { if (m.on) p.hands[uid] = nm; else delete p.hands[uid]; if (m.on) _cpToast('✋ ' + nm + ' 님이 손을 들었습니다', 'info'); }
  else if (m.t === 'q') { var tx = String(m.text || '').trim().slice(0, 300); if (!tx) return true; p.qs.push({ id: uid.slice(0, 6) + Date.now().toString(36), by: uid, name: nm, text: tx, done: false }); _cpToast('💬 ' + nm + ': ' + tx.slice(0, 60), 'info'); }
  else if (m.t === 'rx') { if (CP_RX.indexOf(m.e) < 0) return true; p.rx[m.e] = (p.rx[m.e] || 0) + 1; var r = { t: 'rx', by: uid, e: m.e }; _cpFloat(r); _ciCast(r); return true; }
  _cpCast(); _ciToolbars(); _cpPanelDraw();
  return true;
}
/* 발표자 명령 — 패널(웹 화면 미리보기 창) · 투명 창(hcmd 로 넘어옴) */
function chatPresHostCmd(m) {
  if (CI.relay) { CI.relay({ t: 'hcmd', c: m.c, uid: m.uid, id: m.id }); return; }
  var p = CI.pres || (CI.pres = _cpNew());
  if (m.c === 'grant') { p.grant[m.uid] = true; delete p.hands[m.uid]; }
  else if (m.c === 'ungrant') delete p.grant[m.uid];
  else if (m.c === 'lower') delete p.hands[m.uid];
  else if (m.c === 'qdone') p.qs.forEach(function (q) { if (q.id === m.id) q.done = !q.done; });
  _cpCast(); _ciToolbars(); _cpPanelDraw();
}
function chatPresSeen(uid) { if (CI.pres) CI.pres.seen[uid] = _ciName(uid) || CI.pres.seen[uid] || ''; }

/* ─── 모두: 받은 것 ─── */
function chatPresApply(m) {
  if (m.t === 'pres') {
    var was = _cpCanPen();
    CI.pres = Object.assign(CI.pres || {}, { on: true, hands: m.hands || {}, qs: m.qs || [], grant: m.grant || {} });
    var now = _cpCanPen();
    if (CI.role === 'view' && was !== now) { _cpToast(now ? '✎ 발표자가 펜을 줬습니다 — 화면 위에 표시하세요' : '펜이 회수됐습니다', now ? 'success' : 'info'); if (!now && typeof chatInkSetTool === 'function') chatInkSetTool(null); var w = document.getElementById('crtWin'); if (now && w) w.classList.add('big'); }
    _ciToolbars(); _cpPanelDraw();
    return true;
  }
  if (m.t === 'rx') { _cpFloat(m); return true; }
  return false;
}
function _cpCanPen() { var me = _ciMe(); return !!(CI.role === 'view' && CI.pres && CI.pres.grant && CI.pres.grant[me]); }

/* ─── 보는 사람: 손들기 · 질문 · 반응 ─── */
function chatPresHand() {
  if (CI.role !== 'view' || !CI.dc) return;
  var me = _ciMe(), on = !(CI.pres && CI.pres.hands && CI.pres.hands[me]);
  _ciTx(CI.dc, { t: 'hand', on: on });
  CI.pres = CI.pres || _cpNew(); if (on) CI.pres.hands[me] = _ciName(me); else delete CI.pres.hands[me];
  _ciToolbars();
}
function chatPresReact(e) {
  if (CI.role === 'view' && CI.dc) { _ciTx(CI.dc, { t: 'rx', e: e }); _cpFloat({ by: _ciMe(), e: e }); }
}
function chatPresAsk(anchor) {
  if (CI.role !== 'view' || !CI.dc) return;
  var host = anchor.closest('.crt-win') || document.body, old = host.querySelector('.cp-ask'); if (old) { old.remove(); return; }
  var box = document.createElement('div'); box.className = 'cp-ask';
  box.innerHTML = '<input type="text" maxlength="300" placeholder="발표자에게 질문 — Enter 보내기" aria-label="질문"><button type="button">보내기</button>';
  host.appendChild(box);
  var r = anchor.getBoundingClientRect(), hr = host.getBoundingClientRect();
  box.style.top = (r.bottom - hr.top + 6) + 'px'; box.style.left = Math.max(8, Math.min(hr.width - 340, r.left - hr.left - 140)) + 'px';
  var inp = box.querySelector('input'); setTimeout(function () { inp.focus(); }, 0);
  function send() { var v = inp.value.trim(); if (!v) return; _ciTx(CI.dc, { t: 'q', text: v }); box.remove(); _cpToast('💬 질문을 보냈습니다', 'success'); }
  inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } else if (e.key === 'Escape') box.remove(); });
  box.querySelector('button').addEventListener('click', send);
}

/* ─── 반응이 화면 위로 떠오름 (그림 층이 있는 모든 창) ─── */
function _cpFloat(m) {
  (CI.layers || []).forEach(function (L) {
    if (!L.host || !L.host.isConnected || L.host.hidden) return;
    var f = document.createElement('div'); f.className = 'cp-fly';
    var nm = m.by && m.by !== _ciMe() ? _ciName(m.by) : '';
    f.innerHTML = '<b>' + _cpE(m.e) + '</b>' + (nm ? '<i>' + _cpE(nm) + '</i>' : '');
    f.style.left = (L.cv.offsetLeft + 28 + Math.random() * 70) + 'px';   // 왼쪽 아래에서 — 오른쪽 아래 통화 창에 안 가림
    f.style.top = (L.cv.offsetTop + L.cv.offsetHeight - 70) + 'px';
    L.host.appendChild(f);
    setTimeout(function () { f.remove(); }, 2600);
  });
}

/* ─── 도구 막대에 붙는 것 ─── */
var CP_IC = {
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  ask: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M9.5 8.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5"/><path d="M12 14.5h.01"/>',
  panel: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'
};
function _cpSvg(k) { return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + CP_IC[k] + '</svg>'; }
function chatPresTbHtml() {
  return '<span class="ci-sep ci-always ci-vonly"></span><div class="ci-g ci-always ci-vonly">' +
    '<button type="button" class="ci-b" data-pr="hand" title="손들기 — 발표자에게 알림 (펜을 받을 수 있음)" aria-label="손들기">' + _cpSvg('hand') + '</button>' +
    '<button type="button" class="ci-b" data-pr="ask" title="질문 보내기" aria-label="질문 보내기">' + _cpSvg('ask') + '</button>' +
    CP_RX.slice(0, 2).map(function (e) { return '<button type="button" class="ci-b ci-rx" data-prx="' + e + '" title="반응 ' + e + '" aria-label="반응 ' + e + '">' + e + '</button>'; }).join('') + '</div>' +
    '<span class="ci-sep ci-host"></span><div class="ci-g ci-host"><button type="button" class="ci-b ci-pn" data-pr="panel" title="참여자 — 손든 사람 · 펜 주기 · 질문" aria-label="참여자 패널">' + _cpSvg('panel') + '<em data-prn hidden></em></button></div>';
}
function chatPresTbClick(b) {
  if (b.dataset.prx) { chatPresReact(b.dataset.prx); return true; }
  if (b.dataset.pr === 'hand') { chatPresHand(); return true; }
  if (b.dataset.pr === 'ask') { chatPresAsk(b); return true; }
  if (b.dataset.pr === 'panel') { _cpPanel(b); return true; }
  return false;
}
function chatPresSync(el) {
  var p = CI.pres || {}, me = _ciMe();
  var hb = el.querySelector('[data-pr="hand"]'); if (hb) { var up = !!(p.hands && p.hands[me]); hb.classList.toggle('on', up); hb.title = up ? '손 내리기' : '손들기 — 발표자에게 알림 (펜을 받을 수 있음)'; hb.disabled = !CI.dc; }
  ['ask'].forEach(function (k) { var x = el.querySelector('[data-pr="' + k + '"]'); if (x) x.disabled = !CI.dc; });
  el.querySelectorAll('[data-prx]').forEach(function (x) { x.disabled = !CI.dc; });
  var n = el.querySelector('[data-prn]');
  if (n) { var c = Object.keys(p.hands || {}).length + (p.qs || []).filter(function (q) { return !q.done; }).length; n.hidden = !c; n.textContent = c; }
}

/* ─── 발표자 패널 ─── */
function _cpPanel(btn) {
  var host = btn.closest('.crt-win, #bar') || document.body, old = document.getElementById('cpPanel');
  if (old) { old.remove(); if (old._btn === btn) return; }
  var pn = document.createElement('div'); pn.id = 'cpPanel'; pn.className = 'cp-panel'; pn._btn = btn;
  (host.id === 'bar' ? document.body : host).appendChild(pn);
  var r = btn.getBoundingClientRect(), hr = (host.id === 'bar' ? document.body : host).getBoundingClientRect();
  pn.style.top = (r.bottom - hr.top + 8) + 'px'; pn.style.left = Math.max(8, r.right - hr.left - 340) + 'px';
  pn.addEventListener('click', function (e) {
    var a = e.target.closest('[data-pc]'); if (!a) { if (e.target.closest('[data-px]')) pn.remove(); return; }
    chatPresHostCmd({ c: a.dataset.pc, uid: a.dataset.uid, id: a.dataset.id });
  });
  _cpPanelDraw();
  if (typeof CI.onTool === 'function') CI.onTool(CI.tool);   // 투명 창 — 패널 위에서도 마우스 잡게
}
function _cpPanelDraw() {
  var pn = document.getElementById('cpPanel'); if (!pn) return;
  var p = CI.pres || {}, hands = Object.keys(p.hands || {}), grant = Object.keys(p.grant || {}), qs = p.qs || [];
  var row = function (uid, nm, btns) { return '<div class="cp-row"><span class="cp-av">' + _cpE(String(nm || '?').slice(0, 1)) + '</span><b>' + _cpE(nm || '') + '</b><span class="cp-act">' + btns + '</span></div>'; };
  pn.innerHTML = '<div class="cp-h"><b>참여자</b><button type="button" class="ci-b" data-px aria-label="닫기">' + _ciSvg('x') + '</button></div>' +
    '<div class="cp-sec"><h5>✋ 손든 사람 <i>' + hands.length + '</i></h5>' + (hands.map(function (u) { return row(u, p.hands[u], '<button type="button" data-pc="grant" data-uid="' + _cpE(u) + '">펜 주기</button><button type="button" class="g" data-pc="lower" data-uid="' + _cpE(u) + '">내리기</button>'); }).join('') || '<div class="cp-empty">없음</div>') + '</div>' +
    '<div class="cp-sec"><h5>✎ 펜을 가진 사람 <i>' + grant.length + '</i></h5>' + (grant.map(function (u) { return row(u, _ciName(u), '<button type="button" class="g" data-pc="ungrant" data-uid="' + _cpE(u) + '">회수</button>'); }).join('') || '<div class="cp-empty">발표자만</div>') + '</div>' +
    '<div class="cp-sec"><h5>💬 질문 <i>' + qs.filter(function (q) { return !q.done; }).length + ' / ' + qs.length + '</i></h5>' + (qs.slice().reverse().map(function (q) { return '<div class="cp-q' + (q.done ? ' done' : '') + '"><p>' + _cpE(q.text) + '</p><span><i>' + _cpE(q.name) + '</i><button type="button" class="g" data-pc="qdone" data-id="' + _cpE(q.id) + '">' + (q.done ? '다시' : '답함 ✓') + '</button></span></div>'; }).join('') || '<div class="cp-empty">아직 없음</div>') + '</div>';
}
