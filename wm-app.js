/**
 * wm-app.js — 앱으로 쓰기 (v13.355)
 *   ① 휴대폰 · PC 브라우저: 서비스 워커 등록 → "앱 설치"(안드로이드 · 아이폰 · PC 크롬/엣지)
 *   ② PC 앱(Electron, desktop/): window.wmDesktop 다리 — 윈도우 알림 · 작업 표시줄 숫자 · 트레이에서 바로 가기
 *   ③ 앱 아이콘 숫자(navigator.setAppBadge) — 설치한 앱에서 안 읽은 메시지 수
 *   ④ 🔔 푸시(v13.359): wmPushEnable · wmPushState — 앱을 닫아도 알림 (서버 /api/push)
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
    (installed ? '<p style="margin:0 0 12px;color:var(--ok,#22c55e);font-weight:600">✅ 지금 앱으로 쓰고 있습니다.</p>' : '') + _wmPushCard() +
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
  _wmPushCardFill(div);
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

/* ─── 🔔 휴대폰 · 브라우저 푸시 (v13.359) — 앱을 닫아 두어도 메신저 · 업무 알림 ─── */
function wmPushSupported() { return !wmIsDesktopApp() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol !== 'file:'; }
/** 'on' · 'off' · 'denied' · 'ios-install'(아이폰은 홈 화면 앱에서만) · 'unsupported' · 'desktop'(PC 앱은 트레이로 받음) */
function wmPushState() {
  if (wmIsDesktopApp()) return Promise.resolve('desktop');
  if (_wmOs() === 'ios' && !wmIsStandalone()) return Promise.resolve('ios-install');
  if (!wmPushSupported()) return Promise.resolve('unsupported');
  if (Notification.permission === 'denied') return Promise.resolve('denied');
  return navigator.serviceWorker.getRegistration('/').then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; })
    .then(function (sub) { return sub && Notification.permission === 'granted' ? 'on' : 'off'; }).catch(function () { return 'off'; });
}
function _wmB64(s) {
  var pad = '='.repeat((4 - s.length % 4) % 4), raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')), out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function _wmPushSubscribe() {
  return Promise.all([navigator.serviceWorker.ready, apiFetch('/api/push/key')]).then(function (r) {
    var reg = r[0], key = r[1].data.publicKey;
    return reg.pushManager.getSubscription().then(function (sub) {
      return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _wmB64(key) });
    });
  }).then(function (sub) {
    return apiFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub }) });
  });
}
/** 알림 켜기 — 반드시 누름(사용자 동작) 안에서 부를 것 (아이폰 규칙) */
function wmPushEnable() {
  if (!wmPushSupported()) { if (typeof showToast === 'function') showToast(_wmOs() === 'ios' && !wmIsStandalone() ? '아이폰은 Safari → 공유 → 홈 화면에 추가한 앱에서 알림을 켤 수 있어요' : '이 브라우저는 알림을 받을 수 없습니다', 'warn'); return Promise.resolve(false); }
  return Notification.requestPermission().then(function (p) {
    if (p !== 'granted') { if (typeof showToast === 'function') showToast('알림이 막혀 있습니다 — 브라우저 · 휴대폰 설정에서 허용해 주세요', 'warn'); return false; }
    return _wmPushSubscribe().then(function () { if (typeof showToast === 'function') showToast('🔔 이 기기에서 알림을 받습니다', 'success'); return true; });
  }).catch(function (e) { console.warn('[push]', e); if (typeof showToast === 'function') showToast('알림을 켜지 못했습니다', 'error'); return false; });
}
function wmPushDisable() {
  return navigator.serviceWorker.getRegistration('/').then(function (reg) { return reg && reg.pushManager.getSubscription(); }).then(function (sub) {
    if (!sub) return;
    var ep = sub.endpoint;
    return sub.unsubscribe().then(function () { return apiFetch('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: ep }) }); });
  }).then(function () { if (typeof showToast === 'function') showToast('이 기기 알림을 껐습니다', 'info'); });
}
function wmPushTest() {
  return apiFetch('/api/push/test', { method: 'POST', body: '{}' }).then(function (r) { if (typeof showToast === 'function') showToast(r.data.sent ? '🔔 시험 알림을 보냈습니다 (' + r.data.sent + '대)' : '알림 받을 기기가 없습니다 — 먼저 켜 주세요', r.data.sent ? 'success' : 'warn'); });
}
/* 로그인되면: 이미 허용한 기기는 조용히 다시 등록 (다른 사람이 로그인했거나 서버 키가 바뀌었을 때) */
(function () {
  if (!wmPushSupported()) return;
  var tries = 0;
  (function wait() {
    if (typeof currentUser !== 'undefined' && currentUser && currentUser.id && typeof apiFetch === 'function') {
      if (Notification.permission === 'granted') _wmPushSubscribe().catch(function (e) { console.warn('[push] sync', e && e.message); });
      return;
    }
    if (++tries < 90) setTimeout(wait, 2000);
  })();
})();
function _wmPushCard() {
  return '<section class="wm-push" id="wmPushCard"><div class="wm-push-h">🔔 이 기기 알림 <b data-pst>확인 중…</b></div><p>앱을 닫아 두어도 새 메시지 · 요청 · 이슈 알림이 옵니다. 메신저에 접속해 있는 동안은 화면 안에서만 알려 줍니다.</p><div class="wm-push-a" data-pa></div></section>';
}
function _wmPushCardFill(box) {
  var card = box.querySelector('#wmPushCard'); if (!card) return;
  wmPushState().then(function (st) {
    var label = { on: '✅ 켜짐', off: '꺼짐', denied: '⛔ 막힘', 'ios-install': '홈 화면 앱에서', unsupported: '지원 안 함', desktop: 'PC 앱 — 트레이로 받음' }[st];
    card.querySelector('[data-pst]').textContent = label;
    card.dataset.st = st;
    var a = card.querySelector('[data-pa]');
    a.innerHTML = st === 'on' ? '<button type="button" class="btn btn-g" data-pt>시험 알림</button><button type="button" class="btn btn-g" data-poff>이 기기 끄기</button>' :
      st === 'off' ? '<button type="button" class="btn btn-p" data-pon>🔔 알림 켜기</button>' :
      st === 'denied' ? '<span class="wm-push-tip">브라우저 · 휴대폰 설정 › 알림 에서 이 사이트를 허용해 주세요</span>' :
      st === 'ios-install' ? '<span class="wm-push-tip">아래 🍎 방법으로 홈 화면에 추가한 뒤, 그 앱에서 켜 주세요 (iOS 16.4 이상)</span>' : '';
    var on = a.querySelector('[data-pon]'), off = a.querySelector('[data-poff]'), t = a.querySelector('[data-pt]');
    if (on) on.onclick = function () { wmPushEnable().then(function () { _wmPushCardFill(box); }); };
    if (off) off.onclick = function () { wmPushDisable().then(function () { _wmPushCardFill(box); }); };
    if (t) t.onclick = wmPushTest;
  });
}

/* ─── ⬆ 새 버전 알림 (v13.374) — 켜 둔 채로 있는 화면(PC 앱 트레이 · 휴대폰 앱 · 브라우저 탭)이 새 배포를 알아챔 ───
 *   닫았다 다시 열면 원래 늘 새 것(HTML 은 저장 안 함, 스크립트는 빌드 번호 주소). 켜 둔 화면만 옛 것이라
 *   앱으로 돌아올 때 · 창을 다시 볼 때 · 10분마다 · 서버가 다시 켜진 뒤(메신저 연결이 다시 붙음) 서버 빌드와 비교 → 띠를 띄워 확인받고 새로 고침 */
var WMU = { mine: '', t: 0, busy: false, shown: '' };
(function () {
  var m = document.querySelector('meta[name="wm-build"]'); WMU.mine = m ? m.getAttribute('content') || '' : '';
  if (!WMU.mine || location.protocol === 'file:') return;   // 서버가 내려준 화면에서만 (GitHub Pages · 파일은 건너뜀)
  document.addEventListener('visibilitychange', function () { if (!document.hidden) wmUpdateCheck(); });
  window.addEventListener('focus', function () { wmUpdateCheck(); });
  window.addEventListener('online', function () { wmUpdateCheck(true); });
  setInterval(function () { if (!document.hidden) wmUpdateCheck(); }, 10 * 60000);
})();
/** 서버 빌드와 비교 — force 가 아니면 1분에 한 번만 */
function wmUpdateCheck(force) {
  if (!WMU.mine || WMU.busy || location.protocol === 'file:') return;
  var now = Date.now(); if (!force && now - WMU.t < 60000) return;
  WMU.t = now; WMU.busy = true;
  fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/build', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { var d = j && j.data; if (d && d.build && d.build !== WMU.mine) _wmUpdateShow(d); })
    .catch(function () {})
    .then(function () { WMU.busy = false; });
}
function _wmUpdateShow(d) {
  var later = null; try { later = JSON.parse(localStorage.getItem('wm-upd-later') || 'null'); } catch (_) {}
  if (later && later.build === d.build && later.until > Date.now()) return;   // '나중에' 누른 것은 1시간 조용히
  if (WMU.shown === d.build && document.getElementById('wmUpd')) return;
  WMU.shown = d.build;
  var old = document.getElementById('wmUpd'); if (old) old.remove();
  var bar = document.createElement('div'); bar.id = 'wmUpd'; bar.className = 'wm-upd'; bar.setAttribute('role', 'status');
  bar.innerHTML = '<span class="wm-upd-i">⬆</span><span class="wm-upd-t"><b></b><i></i></span><button type="button" class="wm-upd-go">지금 새로 고침</button><button type="button" class="wm-upd-x" title="1시간 뒤에 다시 알림">나중에</button>';
  bar.querySelector('b').textContent = '새 버전' + (d.version ? ' v' + d.version : '') + '이 나왔습니다';
  bar.querySelector('i').textContent = d.title || '새로 고치면 바로 적용됩니다 — 쓰던 메시지는 그대로 남습니다';
  bar.querySelector('.wm-upd-go').onclick = wmUpdateApply;
  bar.querySelector('.wm-upd-x').onclick = function () { try { localStorage.setItem('wm-upd-later', JSON.stringify({ build: d.build, until: Date.now() + 3600000 })); } catch (_) {} bar.remove(); };
  document.body.appendChild(bar);
}
/** 새로 고침 — 서비스 워커도 새 것으로 */
function wmUpdateApply() {
  var go = function () { location.reload(); };
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration('/').then(function (r) { return r && r.update(); }).catch(function () {}).then(go);
      setTimeout(go, 1500);   // 서비스 워커가 늦어도
      return;
    }
  } catch (_) {}
  go();
}
