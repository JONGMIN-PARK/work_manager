/**
 * 👀 지금 같이 보는 사람 (v13.539) — 화면 어디든 <span class="wpr-slot" data-wpr="project:ID"></span> 를 두면
 *   그 자리에 '👀 김팀원 · 이팀원' 이 뜸. 20초마다(+ 자리가 새로 생기면 곧바로) 보이는 자리의 키를 모아 서버에 '나 여기 있음'
 *   자리가 사라지면(창 닫힘) 그 키는 바로 빠지기(leave) · 화면을 안 보면(다른 탭) 멈춤
 *   서버 POST /api/presence (routes/presence.js)
 */
var WPR = { keys: [], timer: null, busy: false, last: {} };
function _wprE(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
/* 보이는 자리 — 자리 자체는 아무도 없으면 숨겨 두므로 부모가 보이는지로 */
function _wprSlots() { return [].slice.call(document.querySelectorAll('.wpr-slot[data-wpr]')).filter(function (el) { return el.isConnected && el.parentElement && el.parentElement.getClientRects().length; }); }
function _wprPaint(map) {
  _wprSlots().forEach(function (el) {
    var list = (map || WPR.last)[el.getAttribute('data-wpr')] || [];
    // 내용이 같으면 손대지 않음 — DOM 을 바꾸면 감시자가 또 깨어나 서로 부르며 멈출 수 있음
    if (!list.length) { if (!el.hidden) el.hidden = true; if (el.innerHTML) el.innerHTML = ''; return; }
    var nm = list.map(function (u) { return u.name; }).filter(Boolean);
    var html = '<span class="wpr-dot"></span>' + nm.slice(0, 3).map(function (n) { return '<span class="wpr-av" title="' + _wprE(n) + '">' + _wprE(String(n).slice(0, 1)) + '</span>'; }).join('') +
      '<span class="wpr-t">' + _wprE(nm[0]) + (nm.length > 1 ? ' 외 ' + (nm.length - 1) + '명' : '') + ' 보는 중</span>';
    var ttl = '👀 지금 같이 보는 사람: ' + nm.join(', ');
    if (el.hidden) el.hidden = false;
    if (el.title !== ttl) el.title = ttl;
    if (el.innerHTML !== html) el.innerHTML = html;
  });
}
function wprTick() {
  if (WPR.busy || typeof apiFetch !== 'function' || typeof currentUser === 'undefined' || !currentUser) return;
  if (document.visibilityState === 'hidden') return;
  var keys = _wprSlots().map(function (el) { return el.getAttribute('data-wpr'); }).filter(function (k, i, a) { return a.indexOf(k) === i; });
  var gone = WPR.keys.filter(function (k) { return keys.indexOf(k) < 0; });
  WPR.keys = keys;
  if (gone.length) apiFetch('/api/presence', { method: 'POST', body: JSON.stringify({ keys: gone, leave: true }) }).catch(function () {});
  if (!keys.length) return;
  WPR.busy = true;
  apiFetch('/api/presence', { method: 'POST', body: JSON.stringify({ keys: keys }) }).then(function (r) { WPR.last = (r && r.data) || {}; _wprPaint(WPR.last); })
    .catch(function () {}).then(function () { WPR.busy = false; });
}
(function () {
  if (typeof document === 'undefined') return;
  var soon = null;
  function kick() { clearTimeout(soon); soon = setTimeout(wprTick, 400); }
  function start() {
    if (typeof currentUser === 'undefined' || !currentUser) return setTimeout(start, 2000);
    WPR.timer = setInterval(wprTick, 20000);
    // 자리가 새로 생기거나 사라지면 곧바로 (프로젝트 상세 · 문서 창을 열고 닫을 때)
    //   앱 전체 DOM 변화마다 깨므로 0.3초에 한 번만 확인 (메신저 · 노트 미리보기가 자주 바뀜)
    var seen = '', pend = null;
    new MutationObserver(function (ms) {
      if (pend || ms.every(function (m) { return m.target.closest && m.target.closest('.wpr-slot'); })) return;   // 표시 자리 안의 변화(내가 그린 것)는 무시
      pend = setTimeout(function () {
        pend = null;
        var k = _wprSlots().map(function (el) { return el.getAttribute('data-wpr'); }).sort().join(',');
        if (k !== seen) { seen = k; kick(); }
      }, 300);
    })
      .observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', kick);
    window.addEventListener('pagehide', function () { if (WPR.keys.length) try { navigator.sendBeacon && fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/presence', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (typeof _accessToken !== 'undefined' ? _accessToken : '') }, body: JSON.stringify({ keys: WPR.keys, leave: true }) }); } catch (_) {} });
    kick();
  }
  setTimeout(start, 2500);
})();
