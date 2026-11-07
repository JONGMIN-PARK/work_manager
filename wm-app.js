/**
 * wm-app.js — 앱으로 쓰기 (v13.355)
 *   ① 휴대폰 · PC 브라우저: 서비스 워커 등록 → "앱 설치"(안드로이드 · 아이폰 · PC 크롬/엣지)
 *   ② PC 앱(Electron, desktop/): window.wmDesktop 다리 — 윈도우 알림 · 작업 표시줄 숫자 · 트레이에서 바로 가기
 *   ③ 앱 아이콘 숫자(navigator.setAppBadge) — 설치한 앱에서 안 읽은 메시지 수
 *   공통 진입: wmAppInstall() — 내 메뉴 › 📲 앱 설치
 */
var WM_DESKTOP_DOWNLOAD = 'https://github.com/JONGMIN-PARK/work_manager/releases/latest';
var _wmInstallEvt = null;

function wmIsDesktopApp() { return !!(window.wmDesktop && window.wmDesktop.isDesktop); }
function wmIsStandalone() {
  try { return wmIsDesktopApp() || window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (_) { return false; }
}
function _wmOs() {
  var ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'pc';
}

/* ─── 서비스 워커 · 설치 신호 ─── */
(function () {
  if (wmIsDesktopApp()) { document.documentElement.classList.add('wm-desktop'); return; }   // PC 앱은 자체 창 · 알림을 씀
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (e) { console.warn('[app] 서비스 워커', e && e.message); });
  });
  navigator.serviceWorker.addEventListener('message', function (e) {   // 알림 누름 → 그 자리로
    var go = e.data && e.data.wmGo;
    if (go && typeof wmDeepGo === 'function') wmDeepGo(go);
  });
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); _wmInstallEvt = e; });
  window.addEventListener('appinstalled', function () {
    _wmInstallEvt = null;
    if (typeof showToast === 'function') showToast('📲 앱으로 설치했습니다', 'success');
  });
})();

/* ─── 안 읽은 수 → 앱 아이콘 · 작업 표시줄 ─── */
function wmAppBadge(n) {
  n = Math.max(0, n | 0);
  if (wmIsDesktopApp()) { try { window.wmDesktop.setBadge(n); } catch (_) {} return; }
  if (!wmIsStandalone()) return;
  try { if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n); else if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch (_) {}
}

/* ─── 알림: PC 앱이면 윈도우 알림 (누르면 창이 앞으로 + 그 자리로) ─── */
function wmAppNotify(title, body, go) {
  if (!wmIsDesktopApp()) return false;
  try { window.wmDesktop.notify({ title: title, body: body, go: go || '' }); return true; } catch (_) { return false; }
}
if (wmIsDesktopApp() && window.wmDesktop.onGo) {
  window.wmDesktop.onGo(function (go) { if (go && typeof wmDeepGo === 'function') wmDeepGo(go); });
}

/* ─── 📲 앱 설치 안내 ─── */
function wmAppInstall() {
  if (typeof createModal !== 'function') return false;
  var os = _wmOs();
  var div = document.createElement('div');
  div.id = 'wmAppInstall';
  var step = function (n, t) { return '<li style="margin:6px 0"><b style="color:var(--ac)">' + n + '</b> ' + t + '</li>'; };
  var card = function (key, icon, title, inner) {
    return '<section style="border:1px solid ' + (os === key ? 'var(--ac)' : 'var(--bd)') + ';border-radius:12px;padding:14px 16px;margin-bottom:12px;background:var(--bg-i)">' +
      '<div style="display:flex;align-items:center;gap:8px;font-weight:700;color:var(--t1);margin-bottom:6px">' + icon + ' ' + title +
      (os === key ? '<span style="margin-left:auto;font-size:11px;font-weight:600;color:var(--ac)">지금 이 기기</span>' : '') + '</div>' + inner + '</section>';
  };
  var installed = wmIsStandalone();
  div.innerHTML =
    (installed ? '<p style="margin:0 0 12px;color:var(--ok,#22c55e);font-weight:600">✅ 지금 앱으로 쓰고 있습니다.</p>' : '') +
    card('pc', '🖥️', 'PC (윈도우) — 메신저 앱',
      '<p style="margin:0 0 8px;font-size:13px;color:var(--t4)">창을 닫아도 트레이에 남아 메시지 알림을 받습니다. 작업 표시줄에 안 읽은 수 · <b>Ctrl+Shift+M</b> 로 바로 열기.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn-p" style="text-decoration:none" href="' + WM_DESKTOP_DOWNLOAD + '" target="_blank" rel="noopener">⬇ PC 앱 받기</a>' +
      (_wmInstallEvt ? '<button type="button" class="btn btn-g" id="wmInstPwa">이 브라우저에 앱으로 설치</button>' : '') + '</div>') +
    card('android', '🤖', '안드로이드',
      (os === 'android' && _wmInstallEvt ? '<button type="button" class="btn btn-p" id="wmInstAnd">📲 지금 설치</button>' :
        '<ol style="margin:0;padding-left:4px;list-style:none;font-size:13px">' + step('1', '크롬으로 이 주소를 엽니다') + step('2', '오른쪽 위 <b>⋮</b> → <b>앱 설치</b> (또는 홈 화면에 추가)') + step('3', '홈 화면의 <b>업무관리</b> 아이콘으로 엽니다') + '</ol>')) +
    card('ios', '🍎', '아이폰 · 아이패드',
      '<ol style="margin:0;padding-left:4px;list-style:none;font-size:13px">' + step('1', '<b>Safari</b> 로 이 주소를 엽니다 (다른 브라우저는 안 됩니다)') + step('2', '아래 <b>공유 ⬆</b> 단추 → <b>홈 화면에 추가</b>') + step('3', '홈 화면의 <b>업무관리</b> 아이콘으로 엽니다 — 알림은 iOS 16.4 이상') + '</ol>') +
    '<p style="margin:4px 0 0;font-size:12px;color:var(--t5)">주소: <code>' + location.origin + '</code> · 모든 기기가 같은 서버 · 같은 데이터를 씁니다.</p>';
  var modal = createModal({ title: '📲 앱으로 설치', content: div, width: '520px' });
  function prompt() {
    if (!_wmInstallEvt) return;
    _wmInstallEvt.prompt();
    _wmInstallEvt.userChoice.then(function () { _wmInstallEvt = null; modal.close(); });
  }
  var a = div.querySelector('#wmInstAnd'), p = div.querySelector('#wmInstPwa');
  if (a) a.onclick = prompt;
  if (p) p.onclick = prompt;
  return true;
}
