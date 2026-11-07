/**
 * chat-focus.js — 🎯 메신저 집중 모드 (v13.363)
 *   메신저 왼쪽 위 🎯 → 🔕 방해 금지(30분 · 1시간 · 2시간 · 오늘 18시까지 · 직접) + 🖥 메신저만 크게
 *   집중 중: 알림 상자 · 소리 · 휴대폰 푸시 · 텔레그램을 미룸 (서버도) — '@멘션 · 나에게 온 긴급 요청은 받기' 고를 수 있음
 *   위 띠에 남은 시간 · 미룬 알림 수 · 끝나면 "집중하는 동안 N개" 정리 · 같은 방 사람에게 '🎯 집중 중 ~15:00' 표시
 *   chat-ui.js 가 부르는 것: chatFocusMute(d) · chatFocusInit · chatFocusMenu · chatFocusOnEvent · chatFocusLabel(until)
 */
var CF = { until: null, allow: true, held: [], big: false, timer: null };
function _cfToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _cfOn() { return !!(CF.until && new Date(CF.until) > new Date()); }
function _cfHm(d) { d = new Date(d); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
function chatFocusLabel(until) { return until && new Date(until) > new Date() ? '🎯 집중 중 ~' + _cfHm(until) : ''; }

function chatFocusInit() {
  try { CF.big = localStorage.getItem('cf-big') === '1'; } catch (_) {}
  _cfBig(CF.big, true);
  if (typeof apiFetch !== 'function') return;
  apiFetch('/api/chat/focus').then(function (r) { CF.until = r.data.until; CF.allow = r.data.allow !== false; _cfArm(); _cfBar(); }).catch(function () {});
}
/** 알림을 미룰까 — 미루면 true (chat-ui _cxNotify 에서) */
function chatFocusMute(d) {
  if (!_cfOn()) return false;
  var me = typeof _cxMe === 'function' ? _cxMe() : null;
  if (CF.allow && ((d.mentions || []).indexOf(me) >= 0 || (d.post && d.post.urgency === 'urgent' && d.post.assignee === me))) return false;
  CF.held.push({ roomId: d.roomId, who: d.userName, body: d.post ? '📌 ' + d.post.title : d.body || (d.file ? '📎 ' + d.file.name : ''), at: Date.now() });
  _cfBar();
  return true;
}
function _cfSet(body) {
  var was = _cfOn();   // 보내기 전 — 실시간 신호가 응답보다 먼저 올 수 있음
  return apiFetch('/api/chat/focus', { method: 'PUT', body: JSON.stringify(body) }).then(function (r) {
    CF.until = r.data.until; CF.allow = r.data.allow !== false;
    if (!CF.until && was) _cfDone(); else { _cfArm(); _cfBar(); }
    if (CF.until) _cfToast('🎯 ' + _cfHm(CF.until) + '까지 집중 — 메신저 알림을 미룹니다' + (CF.allow ? ' (@멘션 · 긴급 요청은 받음)' : ''), 'success');
  }).catch(function (e) { _cfToast((e && e.data && e.data.message) || '바꾸지 못했습니다', 'error'); });
}
function _cfArm() {
  clearTimeout(CF.timer);
  if (!_cfOn()) return;
  CF.timer = setTimeout(function () { CF.until = null; _cfDone(); }, Math.min(new Date(CF.until) - Date.now() + 500, 2147483000));
}
/** 끝 — 미룬 것 정리해서 보여 줌 */
function _cfDone() {
  clearTimeout(CF.timer);
  if (CF.lastDone && Date.now() - CF.lastDone < 3000) return;   // 응답 · 실시간 신호 · 타이머가 겹쳐도 한 번만
  CF.lastDone = Date.now();
  var held = CF.held; CF.held = [];
  _cfBar();
  if (!held.length) { _cfToast('🎯 집중 끝 — 그동안 새 메시지는 없었습니다', 'info'); return; }
  var rooms = {}; held.forEach(function (h) { rooms[h.roomId] = (rooms[h.roomId] || 0) + 1; });
  var box = document.getElementById('cxPop');
  if (!box) { box = document.createElement('div'); box.id = 'cxPop'; box.className = 'cx-pops'; document.body.appendChild(box); }
  var p = document.createElement('button'); p.type = 'button'; p.className = 'cx-pop cf-pop';
  p.innerHTML = '<span class="ct-ic">🎯</span><span><b></b><i></i></span>';
  p.querySelector('b').textContent = '집중 끝 — 그동안 메시지 ' + held.length + '개 · 대화방 ' + Object.keys(rooms).length + '곳';
  p.querySelector('i').textContent = held.slice(-2).map(function (h) { return (h.who || '') + ': ' + h.body; }).join(' / ');
  var top = Object.keys(rooms).sort(function (x, y) { return rooms[y] - rooms[x]; })[0];
  p.addEventListener('click', function () { p.remove(); if (top) chatOpenRoom(top); });
  box.appendChild(p);
  setTimeout(function () { p.classList.add('out'); setTimeout(function () { p.remove(); }, 300); }, 30000);
}
function chatFocusMenu(anchor) {
  if (typeof _cxMenu !== 'function') return;
  var now = new Date(), items = [];
  if (_cfOn()) items.push(['✅ 집중 끝내기 (' + _cfHm(CF.until) + '까지였음)', function () { _cfSet({ off: true }); }]);
  items.push(['🔕 30분 집중', function () { _cfSet({ minutes: 30, allow: CF.allow }); }]);
  items.push(['🔕 1시간 집중', function () { _cfSet({ minutes: 60, allow: CF.allow }); }]);
  items.push(['🔕 2시간 집중', function () { _cfSet({ minutes: 120, allow: CF.allow }); }]);
  if (now.getHours() < 18) { var e = new Date(now); e.setHours(18, 0, 0, 0); items.push(['🔕 오늘 18:00까지', function () { _cfSet({ until: e.toISOString(), allow: CF.allow }); }]); }
  items.push([(CF.allow ? '☑' : '☐') + ' @멘션 · 나에게 온 긴급 요청은 받기', function () { CF.allow = !CF.allow; if (_cfOn()) _cfSet({ until: CF.until, allow: CF.allow }); else _cfToast(CF.allow ? '집중 중에도 @멘션 · 긴급 요청은 받습니다' : '집중 중엔 모두 미룹니다', 'info'); }]);
  items.push([(CF.big ? '☑' : '☐') + ' 🖥 메신저만 크게 (위 메뉴 숨김)', function () { _cfBig(!CF.big); }]);
  _cxMenu(anchor, items);
}
function _cfBig(on, silent) {
  CF.big = !!on;
  try { localStorage.setItem('cf-big', on ? '1' : '0'); } catch (_) {}
  document.documentElement.classList.toggle('wm-focus-big', CF.big);   // CSS 가 메신저 화면일 때만 적용 (:has)
  if (!silent) _cfBar();
}
/** 메신저 위 띠 */
function _cfBar() {
  var host = document.querySelector('#mMessages .cx'); if (!host) return;
  var bar = document.getElementById('cfBar');
  var on = _cfOn();
  if (!on && !CF.big) { if (bar) bar.remove(); _cfMark(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'cfBar'; bar.className = 'cf-bar'; host.parentNode.insertBefore(bar, host); }
  var left = on ? Math.max(0, Math.round((new Date(CF.until) - Date.now()) / 60000)) : 0;
  bar.className = 'cf-bar' + (on ? ' on' : '');
  bar.innerHTML = (on ? '<b>🎯 집중 중</b><span>' + _cfHm(CF.until) + '까지 · ' + (left >= 60 ? Math.floor(left / 60) + '시간 ' : '') + (left % 60) + '분 남음 · 미룬 알림 ' + CF.held.length + '개' + (CF.allow ? ' · @멘션 · 긴급은 받음' : ' · 모두 미룸') + '</span><button type="button" data-cfx>끝내기</button>' : '<b>🖥 메신저만 크게</b><span>Esc 두 번 또는 오른쪽 단추로 돌아가기</span>') +
    (CF.big ? '<button type="button" data-cfbig>↙ 원래 화면</button>' : '');
  var x = bar.querySelector('[data-cfx]'); if (x) x.onclick = function () { _cfSet({ off: true }); };
  var bg = bar.querySelector('[data-cfbig]'); if (bg) bg.onclick = function () { _cfBig(false); };
  _cfMark();
}
function _cfMark() { var b = document.getElementById('cxFocus'); if (b) { b.classList.toggle('on', _cfOn()); b.title = _cfOn() ? chatFocusLabel(CF.until) + ' — 누르면 바꾸기' : '🎯 집중 모드 — 방해 금지 · 메신저만 크게'; } }
setInterval(function () { if (_cfOn()) _cfBar(); }, 60000);
document.addEventListener('keydown', function (e) {   // Esc 두 번 → 크게 보기 끝
  if (e.key !== 'Escape' || !CF.big || !document.documentElement.classList.contains('wm-focus-big')) return;
  if (document.querySelector('.wa-modal-overlay, #cbBoard, #cdDoc, .cx-menu')) return;
  var n = Date.now(); if (CF.lastEsc && n - CF.lastEsc < 600) { _cfBig(false); } CF.lastEsc = n;
});
/** 다른 사람 집중 표시 바뀜 */
function chatFocusOnEvent(d) {
  if (typeof CX === 'undefined') return;
  var me = typeof _cxMe === 'function' ? _cxMe() : null;
  if (d.userId === me) { var was = _cfOn(); CF.until = d.until; if (was && !_cfOn()) _cfDone(); else { _cfArm(); _cfBar(); } return; }   // 다른 기기에서 바꿔도
  CX.rooms.forEach(function (r) { if (r.peerId === d.userId) r.peerFocus = d.until; });
  if (CX.info) CX.info.members.forEach(function (m) { if (m.id === d.userId) m.focusUntil = d.until; });
  if (typeof _cxDrawRooms === 'function') _cxDrawRooms();
  if (typeof _cxDrawHead === 'function') _cxDrawHead();
}

if (typeof window !== 'undefined') { window.chatFocusMute = chatFocusMute; window.chatFocusInit = chatFocusInit; window.chatFocusMenu = chatFocusMenu; window.chatFocusOnEvent = chatFocusOnEvent; window.chatFocusLabel = chatFocusLabel; window._cfBig = _cfBig; window._cfBar = _cfBar; }
