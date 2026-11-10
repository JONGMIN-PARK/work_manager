/**
 * chat-lock.js — 🔒 채팅 잠금 (v13.426) · 옵션 (기본 꺼짐)
 *   PIN(숫자 4~8자리)을 정하면 켜짐 · 🔒 단추 / Ctrl+Shift+L 로 지금 잠그기 · 자리 비움 N분이면 자동 잠금(고르기)
 *   잠기면: 메신저 화면 흐리게 + 가리개 · 새 메시지 알림은 내용 없이 "새 메시지" 만 · 새로 고쳐도 잠김 유지(이 기기)
 *   PIN 확인은 서버(틀리면 5번마다 1분) · 잊으면 로그아웃 후 다시 로그인하면 풀림
 *   화면 가리개(사생활 보호)이지 권한 경계는 아님 — 자리를 오래 비울 땐 로그아웃 권장
 */
var CXL = { hasPin: false, auto: 0, autoMs: 0, locked: false, last: Date.now(), hiddenAt: 0, loaded: false };
function _cxlKey() { return 'wm_cx_lock_' + ((typeof _cxMe === 'function' && _cxMe()) || ''); }
function _cxlLs(v) { try { if (v === undefined) return localStorage.getItem(_cxlKey()); if (v === null) localStorage.removeItem(_cxlKey()); else localStorage.setItem(_cxlKey(), v); } catch (e) { return null; } }
function chatLockIsOn() { return !!CXL.locked; }
function chatLockLoad() {
  return apiFetch('/api/chat/lock').then(function (r) {
    CXL.hasPin = !!r.data.hasPin; CXL.auto = +r.data.auto || 0; CXL.autoMs = CXL.auto * 60000; CXL.loaded = true;
    if (!CXL.hasPin) { _cxlLs(null); if (CXL.locked) _cxlApply(false); }
    else if (_cxlLs() === '1') _cxlApply(true);
    _cxlBtn();
    return CXL;
  }).catch(function () { return CXL; });
}
/* 잠금 걸기 · 풀기 — html.cx-locked + 메신저 화면 위 가리개 */
function _cxlApply(on) {
  CXL.locked = !!on;
  document.documentElement.classList.toggle('cx-locked', CXL.locked);
  var host = document.getElementById('mMessages'), ov = document.getElementById('cxLockOv');
  if (!CXL.locked) { if (ov) ov.remove(); _cxlBtn(); return; }
  if (host && !ov) {
    ov = document.createElement('div'); ov.id = 'cxLockOv'; ov.className = 'cx-lock-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', '채팅 잠김');
    ov.innerHTML = '<div class="cx-lock-card"><div class="cx-lock-ic">🔒</div><b>채팅이 잠겨 있어요</b><span>PIN 을 넣으면 다시 보입니다</span>' +
      '<form data-f autocomplete="off"><input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" data-pin placeholder="PIN" aria-label="PIN"><button type="submit" class="wm-pri">풀기</button></form>' +
      '<em data-err></em><i class="cx-lock-help">PIN 을 잊었다면 로그아웃한 뒤 다시 로그인하면 풀립니다</i></div>';
    host.appendChild(ov);
    var f = ov.querySelector('[data-f]'), pin = ov.querySelector('[data-pin]'), err = ov.querySelector('[data-err]');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!pin.value) return pin.focus();
      var btn = f.querySelector('button'); btn.disabled = true;
      apiFetch('/api/chat/lock/verify', { method: 'POST', body: JSON.stringify({ pin: pin.value }) }).then(function () {
        _cxlLs(null); _cxlApply(false); CXL.last = Date.now();
      }).catch(function (e2) {
        btn.disabled = false; pin.value = ''; pin.focus();
        err.textContent = _cxErr(e2); ov.querySelector('.cx-lock-card').classList.remove('shake'); void ov.offsetWidth; ov.querySelector('.cx-lock-card').classList.add('shake');
      });
    });
    setTimeout(function () { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); pin.focus(); }, 30);
  }
  _cxlBtn();
}
function chatLockNow() {
  if (!CXL.hasPin) { chatLockSettings(true); return; }
  _cxlLs('1'); _cxlApply(true);
  var mn = document.getElementById('cxMenu'); if (mn) mn.remove();
}
/* 🔒 단추 (메신저 왼쪽 머리) — 잠금 안 정했으면 설정 창, 정했으면 작은 메뉴 */
function _cxlBtn() {
  var b = document.getElementById('cxLockBtn'); if (!b) return;
  b.classList.toggle('on', CXL.hasPin);
  b.title = CXL.hasPin ? '🔒 채팅 잠그기 (Ctrl+Shift+L)' + (CXL.auto ? ' · 자리 비움 ' + CXL.auto + '분이면 자동' : '') : '🔒 채팅 잠금 — PIN 을 정하면 쓸 수 있어요';
}
function chatLockBind(el) {
  var b = el.querySelector('#cxLockBtn'); if (!b) return;
  b.addEventListener('click', function () {
    if (!CXL.hasPin) return chatLockSettings(true);
    _cxMenu(b, [['🔒 지금 잠그기', chatLockNow], ['⚙️ 잠금 설정…', function () { chatLockSettings(false); }]]);
  });
  if (!CXL.loaded) chatLockLoad(); else { _cxlBtn(); if (CXL.locked) _cxlApply(true); }
}
/* ⚙️ 잠금 설정 창 */
function chatLockSettings(first) {
  return wmGuardedModal('chatLock', function () {
    var has = CXL.hasPin;
    var md = createModal({ id: 'chatLockModal', title: '🔒 채팅 잠금', width: '420px', closeOnEsc: true,
      html: '<div class="cx-lock-set">' +
        '<p class="cx-lock-intro">자리를 비울 때 메신저 화면을 가립니다. 잠기면 대화 · 알림 내용이 안 보이고, PIN 을 넣어야 다시 보여요.</p>' +
        (has ? '<label class="cw-f"><span>지금 PIN</span><input class="wr-inp" type="password" inputmode="numeric" maxlength="8" data-old placeholder="바꾸거나 끌 때 필요"></label>' : '') +
        '<label class="cw-f"><span>' + (has ? '새 PIN (바꿀 때만)' : 'PIN 정하기') + ' — 숫자 4~8자리</span><input class="wr-inp" type="password" inputmode="numeric" maxlength="8" data-pin></label>' +
        '<label class="cw-f"><span>한 번 더</span><input class="wr-inp" type="password" inputmode="numeric" maxlength="8" data-pin2></label>' +
        '<label class="cw-f"><span>자리 비움 자동 잠금</span><select class="wr-inp" data-auto>' + [[0, '끔 — 직접 잠글 때만'], [1, '1분'], [3, '3분'], [5, '5분'], [10, '10분'], [30, '30분'], [60, '1시간']].map(function (x) { return '<option value="' + x[0] + '"' + (CXL.auto === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
        '<p class="cx-lock-note">자리 비움 = 이 창에서 마우스 · 키보드를 안 쓰거나 다른 창 · 앱을 보고 있는 시간. 직접 잠그기는 🔒 단추나 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>.<br>잠금은 화면을 가리는 기능이에요 — 오래 자리를 비우면 로그아웃이 더 안전합니다.</p>' +
        '<em class="cx-lock-err" data-err></em>' +
        '<div class="cw-foot">' + (has ? '<button type="button" class="wm-sec cx-lock-off" data-off>잠금 끄기</button>' : '') + '<span class="cw-hint"></span><button type="button" class="wm-sec" data-x>닫기</button><button type="button" class="wm-pri" data-go>' + (has ? '저장' : '켜기') + '</button></div></div>' });
    var box = md.box, q = function (k) { var x = box.querySelector('[data-' + k + ']'); return x ? x.value.trim() : ''; }, err = box.querySelector('[data-err]');
    box.querySelector('[data-x]').onclick = md.close;
    function save(body) {
      return apiFetch('/api/chat/lock', { method: 'PUT', body: JSON.stringify(body) }).then(function (r) {
        CXL.hasPin = r.data.hasPin; CXL.auto = r.data.auto; CXL.autoMs = CXL.auto * 60000; CXL.last = Date.now();
        if (!CXL.hasPin) { _cxlLs(null); _cxlApply(false); }
        _cxlBtn(); md.close();
        _cxToast(!CXL.hasPin ? '🔓 채팅 잠금을 껐습니다' : '🔒 채팅 잠금 ' + (has ? '설정을 저장했습니다' : '을 켰습니다') + (CXL.auto ? ' · 자리 비움 ' + CXL.auto + '분이면 자동' : ''), 'success');
      }).catch(function (e) { err.textContent = _cxErr(e); });
    }
    box.querySelector('[data-go]').onclick = function () {
      err.textContent = '';
      var pin = q('pin'), pin2 = q('pin2'), body = { auto: +q('auto') };
      if (!has || pin) {
        if (!/^\d{4,8}$/.test(pin)) return (err.textContent = 'PIN 은 숫자 4~8자리로 정해 주세요');
        if (pin !== pin2) return (err.textContent = '두 번 넣은 PIN 이 다릅니다');
        body.pin = pin;
      }
      if (has && body.pin) body.oldPin = q('old');
      save(body);
    };
    var off = box.querySelector('[data-off]');
    if (off) off.onclick = function () { if (!q('old')) { err.textContent = '끄려면 지금 PIN 을 넣어 주세요'; return; } save({ off: true, oldPin: q('old') }); };
    setTimeout(function () { var x = box.querySelector(has ? '[data-old]' : '[data-pin]'); if (x) x.focus(); }, 30);
  }, 'chatLockModal');
}
/* 자리 비움 — 이 창에서 손이 안 가거나 다른 창을 보는 시간 */
(function () {
  function act() { CXL.last = Date.now(); }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, act, { passive: true, capture: true }); });
  var mm = 0; document.addEventListener('mousemove', function () { var n = Date.now(); if (n - mm > 2000) { mm = n; act(); } }, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) CXL.hiddenAt = Date.now();
    else { if (CXL.hiddenAt && CXL.autoMs && CXL.hasPin && !CXL.locked && Date.now() - CXL.hiddenAt >= CXL.autoMs) chatLockNow(); CXL.hiddenAt = 0; act(); }
  });
  setInterval(function () {
    if (!CXL.hasPin || !CXL.autoMs || CXL.locked) return;
    var idle = Date.now() - Math.max(CXL.last, CXL.hiddenAt && document.hidden ? 0 : 0);
    if (idle >= CXL.autoMs) chatLockNow();
  }, 1000);
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'L' || e.key === 'l')) { if (typeof currentUser === 'undefined' || !currentUser) return; e.preventDefault(); chatLockNow(); }
  }, true);
  // 다른 탭에서 잠그거나 풀면 따라감
  window.addEventListener('storage', function (e) { if (e.key && e.key === _cxlKey()) _cxlApply(e.newValue === '1'); });
})();
