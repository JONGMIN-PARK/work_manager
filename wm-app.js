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
/** opt: { urgent: 사라지지 않음(📞 통화), tag: 같은 tag 는 바꿔 끼움 · wmAppNotifyClose 로 닫기 } */
function wmAppNotify(title, body, go, opt) {
  if (!wmIsDesktopApp()) return false;
  try { window.wmDesktop.notify({ title: title, body: body, go: go || '', urgent: !!(opt && opt.urgent), tag: (opt && opt.tag) || '' }); return true; } catch (_) { return false; }
}
function wmAppNotifyClose(tag) { try { if (wmIsDesktopApp() && window.wmDesktop.notifyClose) window.wmDesktop.notifyClose(tag); } catch (_) {} }
/* v13.382 📌 항상 위 (PC 앱) — 머리 단추 · 트레이 메뉴 · Ctrl+Alt+T 가 같은 상태 */
function _wmOnTopShow(on) {
  var b = document.getElementById('hdrOnTop'); if (!b) return;
  b.hidden = false; b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.title = on ? '📌 항상 위 — 켜짐 (누르면 끔 · Ctrl+Alt+T)' : '📌 항상 위에 두기 — 다른 프로그램을 써도 이 창이 위에 (Ctrl+Alt+T)';
}
function wmOnTopToggle() {
  if (!wmIsDesktopApp() || !window.wmDesktop.setOnTop) return;
  var on = !document.getElementById('hdrOnTop').classList.contains('on');
  window.wmDesktop.setOnTop(on); _wmOnTopShow(on);
  if (typeof showToast === 'function') showToast(on ? '📌 항상 위에 둡니다' : '📌 항상 위를 껐습니다', 'info');
}
if (wmIsDesktopApp() && window.wmDesktop.getOnTop) {
  var _wmOnTopInit = function () { window.wmDesktop.getOnTop().then(_wmOnTopShow).catch(function () {}); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wmOnTopInit); else _wmOnTopInit();
  if (window.wmDesktop.onOnTop) window.wmDesktop.onOnTop(_wmOnTopShow);
}
/* v13.454 PC 앱(새 버전) — 윈도우 제목 줄 대신 머리 줄을 끌어 창을 옮기고, 최소화 · 최대화 · 닫기 단추 색을 테마에 맞춤 */
function _wmHex(c) { var m = String(c || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/); if (!m) return /^#[0-9a-f]{6}$/i.test(c) ? c : ''; if (m[4] != null && +m[4] < 0.5) return ''; return '#' + [m[1], m[2], m[3]].map(function (v) { var h = (+v).toString(16); return h.length < 2 ? '0' + h : h; }).join(''); }
var _wmTbLast = '';
/* v13.458 반투명 머리 줄(노바 · 펄 등) — 바탕 위에 섞인 실제 보이는 색으로 창 단추 칸을 칠해 경계가 안 보이게 */
function _wmMix(fg, bg) { var p = function (c) { var m = String(c || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/); return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null; }; var f = p(fg), b = p(bg); if (!f || f[3] === 0) return ''; if (!b || b[3] === 0) b = [255, 255, 255, 1]; var a = f[3]; return '#' + [0, 1, 2].map(function (i) { var v = Math.round(f[i] * a + b[i] * (1 - a)).toString(16); return v.length < 2 ? '0' + v : v; }).join(''); }
/* v13.456 오른쪽 위 창 단추(최소화 · 최대화 · 닫기)가 차지하는 폭 → --wm-tbo-r (CSS 가 그만큼 비워 둠) */
function wmTitleBarArea() {
  try {
    var o = navigator.windowControlsOverlay, r = o && o.visible && o.getTitlebarAreaRect ? o.getTitlebarAreaRect() : null;
    var w = r && r.width > 0 ? Math.round(window.innerWidth - (r.x + r.width)) : 0;
    if (w > 40 && w < 400) document.documentElement.style.setProperty('--wm-tbo-r', w + 'px');
    var hd = document.querySelector('.hdr'), hh = hd ? Math.round(hd.getBoundingClientRect().height) : 0;   // 좁은 창 메신저가 이 아래부터 덮음
    if (hh > 20 && hh < 200) document.documentElement.style.setProperty('--wm-tbo-h', hh + 'px');
  } catch (e) {}
}
function wmTitleBarSync() {
  if (!(wmIsDesktopApp() && window.wmDesktop.titleBarOverlay && window.wmDesktop.setTitleBar)) return;
  document.documentElement.classList.add('wm-tbo');
  wmTitleBarArea();
  var solo = !!window.WM_SOLO, hd = solo ? document.getElementById('cxHead') : document.querySelector('.hdr');
  var el = hd && hd.offsetParent !== null ? hd : document.body;
  /* v13.458 머리 줄을 '지금 보이는 색' 단색으로 칠하고 창 단추 칸도 같은 색 — 반투명(노바 · 펄 · 글라스 …) 머리 줄이라
     창 단추 칸만 색이 달라 보이던 것. 원래 테마 색을 읽으려고 잠깐 끄고 잼(같은 프레임이라 깜빡임 없음) */
  var ov = document.getElementById('wmTboBg');
  if (!ov) { ov = document.createElement('style'); ov.id = 'wmTboBg'; document.head.appendChild(ov); }
  ov.media = 'not all';
  var cs = getComputedStyle(el);
  var bg = _wmMix(cs.backgroundColor, getComputedStyle(document.body).backgroundColor) || _wmHex(getComputedStyle(document.body).backgroundColor) || '#0b1022';
  var css = 'html.wm-tbo .hdr,html.wm-tbo.wm-solo #cxHead{background:' + bg + '!important}';
  if (ov.textContent !== css) ov.textContent = css;
  ov.media = 'all';
  var fg = _wmHex(getComputedStyle(document.body).color) || '#e2e8f0';
  // v13.458 머리 줄 아래 구분선(border-bottom · inset 그림자 1px)은 창 단추 영역이 덮지 않게 그 위까지만
  var h = hd && hd.offsetParent !== null ? Math.min(64, Math.max(32, Math.floor(hd.getBoundingClientRect().height) - 1)) : 40;
  var key = bg + fg + h; if (key === _wmTbLast) return; _wmTbLast = key;
  window.wmDesktop.setTitleBar({ color: bg, symbol: fg, h: h });
}
if (wmIsDesktopApp() && window.wmDesktop.titleBarOverlay) {
  document.documentElement.classList.add('wm-tbo');
  var _wmTbT = 0, _wmTbSoon = function () { clearTimeout(_wmTbT); _wmTbT = setTimeout(wmTitleBarSync, 120); };
  var _wmTbInit = function () {
    wmTitleBarSync(); setTimeout(wmTitleBarSync, 1500); setTimeout(wmTitleBarSync, 5000);
    try { new MutationObserver(_wmTbSoon).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] }); new MutationObserver(_wmTbSoon).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] }); } catch (e) {}
    window.addEventListener('resize', _wmTbSoon);
    try { if (navigator.windowControlsOverlay) navigator.windowControlsOverlay.addEventListener('geometrychange', wmTitleBarArea); } catch (e) {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wmTbInit); else _wmTbInit();
}
/* v13.494 PC 앱 창 단추 — 윈도우 기본 단추(늘 맨 위에 덮여 알림 · 검색 · 창과 겹치고, 테마와 색이 어긋남) 대신 머리 줄 오른쪽 끝에 직접.
 *   글자색(--t2)을 따르는 가는 선 아이콘 · 마우스를 올리면 옅은 바탕, 닫기만 빨강 · 최대화면 '이전 크기로' 모양 · 창이 뒤로 가면 흐리게
 *   예전 PC 앱(titleBarOverlay)이면 위의 예전 방식 그대로. 따로 띄운 창(?solo)은 윈도우 제목 줄이 있어 그리지 않음 */
var _WM_WC_ICON = {
  min: '<path d="M1 5.5h9"/>',
  max: '<rect x="1" y="1" width="9" height="9" rx="1.2"/>',
  res: '<rect x="1" y="3" width="7" height="7" rx="1.2"/><path d="M3.2 3V2.2C3.2 1.5 3.7 1 4.4 1h4.4c.7 0 1.2.5 1.2 1.2v4.4c0 .7-.5 1.2-1.2 1.2H8"/>',
  close: '<path d="M1.2 1.2l8.6 8.6M9.8 1.2l-8.6 8.6"/>'
};
function _wmWcSvg(k) { return '<svg viewBox="0 0 11 11" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">' + _WM_WC_ICON[k] + '</svg>'; }
function wmWinControls() {
  if (!(wmIsDesktopApp() && window.wmDesktop.winControls && window.wmDesktop.winAction) || window.WM_SOLO) return;
  var hdr = document.querySelector('.hdr');
  if (!hdr || document.getElementById('wmWc')) return;
  var de = document.documentElement;
  de.classList.add('wm-tbo', 'wm-wc');
  var box = document.createElement('div');
  box.id = 'wmWc'; box.className = 'wm-wc-box'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', '창');
  box.innerHTML = '<button type="button" data-a="min" title="최소화" aria-label="최소화">' + _wmWcSvg('min') + '</button>'
    + '<button type="button" data-a="max" title="최대화" aria-label="최대화">' + _wmWcSvg('max') + '</button>'
    + '<button type="button" data-a="close" class="x" title="닫기 — 트레이로 (알림 · 통화는 계속 받음)" aria-label="닫기">' + _wmWcSvg('close') + '</button>';
  hdr.appendChild(box);
  box.addEventListener('click', function (e) { var b = e.target.closest('[data-a]'); if (b) window.wmDesktop.winAction(b.dataset.a); });
  function show(s) {
    s = s || {};
    var m = !!(s.max || s.full), b = box.querySelector('[data-a="max"]');
    if (b.dataset.m !== String(m)) { b.dataset.m = String(m); b.innerHTML = _wmWcSvg(m ? 'res' : 'max'); b.title = m ? '이전 크기로' : '최대화'; b.setAttribute('aria-label', b.title); }
    de.classList.toggle('wm-wc-max', m);
    if (s.focus != null) de.classList.toggle('wm-wc-blur', !s.focus);
  }
  if (window.wmDesktop.winState) window.wmDesktop.winState().then(show).catch(function () {});
  if (window.wmDesktop.onWinState) window.wmDesktop.onWinState(show);
  wmTitleBarArea();
  window.addEventListener('resize', function () { clearTimeout(_wmWcT); _wmWcT = setTimeout(wmTitleBarArea, 120); });
}
var _wmWcT = 0;
if (wmIsDesktopApp() && window.wmDesktop.winControls) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wmWinControls); else wmWinControls();
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
    .then(function (j) { var d = j && j.data; if (!d) return; if (d.build && d.build !== WMU.mine) _wmUpdateShow(d); else _wmDeskUpdate(d.desktop); })
    .catch(function () {})
    .then(function () { WMU.busy = false; });
}
function _wmUpdateShow(d) {
  _wmDeskUpdate(d.desktop);   // v13.495 PC 앱도 새 것이 있으면 지금부터 받아 둠 → 새로 고칠 때 같이 설치
  var later = null; try { later = JSON.parse(localStorage.getItem('wm-upd-later') || 'null'); } catch (_) {}
  if (later && later.build === d.build && later.until > Date.now()) return;   // '나중에' 누른 것은 1시간 조용히
  if (WMU.shown === d.build && document.getElementById('wmUpd')) return;
  WMU.shown = d.build;
  // v13.467 무엇이 바뀌었는지(제목)는 관리자에게만 — 그 밖엔 버전 번호만
  var _adm = typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin';
  var desk = wmIsDesktopApp() && window.wmDesktop.appUpdate && d.desktop && _wmVerNewer(d.desktop.version, WMD.ver);
  _wmUpdBar({ title: '새 버전' + (d.version ? ' v' + d.version : '') + '이 나왔습니다',
    sub: (_adm && d.title) || (desk ? '새로 고치면 PC 앱(v' + d.desktop.version + ')까지 업데이트됩니다' : '새로 고치면 바로 적용됩니다 — 쓰던 메시지는 그대로 남습니다'),
    go: wmUpdateApply,
    later: function () { try { localStorage.setItem('wm-upd-later', JSON.stringify({ build: d.build, until: Date.now() + 3600000 })); } catch (_) {} } });
}
/* ─── 🖥 PC 앱 자체 업데이트 (v13.495) — 웹 새로 고침과 같이 ───
 *   새 PC 앱(wmDesktop.appUpdate): 서버에 더 새 설치 파일이 있으면 뒤에서 받아 두고, 새로 고칠 때(띠 · F5 · Ctrl+R) 설치하고 다시 시작
 *   예전 PC 앱(GitHub 릴리스를 보던 것 — 스스로는 못 받음): '설치 파일 받기' 띠 (한 번 설치하면 그 뒤로 자동) */
function _wmVerNewer(a, b) {
  var x = String(a || '').split('.').map(Number), y = String(b || '').split('.').map(Number);
  for (var i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
var WMD = { ver: '', ready: '', pct: 0, busy: false };
function _wmDeskUpdate(info) {
  if (!wmIsDesktopApp() || !info || !info.version || window.WM_SOLO) return;
  var api = window.wmDesktop.appUpdate;
  if (api) {
    var go = function () { if (_wmVerNewer(info.version, WMD.ver) && !WMD.ready && !WMD.busy) api('check'); };
    if (WMD.ver) go(); else api('state').then(function (s) { _wmDeskState(s); go(); }).catch(function () {});
    return;
  }
  // 예전 PC 앱 — 버전을 모르니 창 단추(v13.494) · 업데이트 다리가 없는 것으로 판단
  var key = 'wm-desk-later-' + info.version, later = 0;
  try { later = +localStorage.getItem(key) || 0; } catch (_) {}
  if (later > Date.now() || document.getElementById('wmUpd')) return;
  _wmUpdBar({ title: 'PC 앱 새 버전 v' + info.version, sub: '설치 파일을 한 번만 받아 설치하면 그 뒤로는 새로 고칠 때 저절로 업데이트됩니다',
    goText: '⬇ 설치 파일 받기', go: function () { var a = document.createElement('a'); a.href = info.file; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); },
    later: function () { try { localStorage.setItem(key, String(Date.now() + 86400000)); } catch (_) {} } });
}
function _wmDeskState(s) {
  s = s || {};
  WMD.ver = s.version || WMD.ver; WMD.ready = s.ready || ''; WMD.pct = s.pct || 0; WMD.busy = !!s.busy;
  // v13.496 설치 과정이 보이게 — 새로 고침을 눌렀는데 아직 받는 중이면 띠에 % · 다 받으면 '설치 중'
  var bar = document.getElementById('wmUpd');
  if (s.installing) { _wmDeskInstalling(bar); return; }
  if (WMD.waiting && WMD.busy) { _wmDeskProgress(bar); return; }
  // 웹은 그대로인데 PC 앱만 새 것을 받아 둠 → 다시 시작하면 적용
  if (WMD.ready && !document.getElementById('wmUpd')) {
    _wmUpdBar({ title: 'PC 앱 새 버전 v' + WMD.ready + ' 준비됨', sub: '새로 고치면(F5) 설치하고 다시 시작합니다 — 쓰던 메시지는 그대로 남습니다', goText: '지금 적용', go: wmUpdateApply });
  }
}
if (wmIsDesktopApp() && window.wmDesktop.onAppUpdate) {
  window.wmDesktop.onAppUpdate(_wmDeskState);
  window.wmDesktop.appUpdate('state').then(_wmDeskState).catch(function () {});
}
/* 받는 중 % 막대 · 설치 중 — 띠를 그 자리에서 바꿈 (없으면 새로) */
function _wmDeskBar(bar, title, sub, pct) {
  if (!bar) bar = _wmUpdBar({ title: '', go: function () {} });
  bar.classList.add('is-busy', 'wm-upd-desk');
  bar.querySelector('b').textContent = title;
  bar.querySelector('i').textContent = sub;
  var go = bar.querySelector('.wm-upd-go'); if (go) go.remove();
  var x = bar.querySelector('.wm-upd-x'); if (x) x.remove();
  var p = bar.querySelector('.wm-upd-pg');
  if (pct == null) { if (p) p.remove(); return bar; }
  if (!p) { p = document.createElement('span'); p.className = 'wm-upd-pg'; p.innerHTML = '<i></i>'; bar.appendChild(p); }
  p.firstChild.style.width = Math.max(2, Math.min(100, pct)) + '%';
  p.setAttribute('role', 'progressbar'); p.setAttribute('aria-valuenow', String(pct)); p.setAttribute('aria-valuemin', '0'); p.setAttribute('aria-valuemax', '100');
  return bar;
}
function _wmDeskProgress(bar) {
  _wmDeskBar(bar, '⬇ PC 앱 새 버전 받는 중 ' + (WMD.pct || 0) + '%', '다 받으면 바로 설치하고 다시 엽니다 — 그동안 계속 쓰셔도 됩니다', WMD.pct || 0);
}
function _wmDeskInstalling(bar) {
  _wmDeskBar(bar, '⏳ PC 앱 업데이트 설치 중…', '설치 창이 뜨고, 끝나면 업무 관리자가 다시 열립니다 (10초쯤)', 100);
}
/** 띠 하나 — 웹 새 버전 · PC 앱 새 버전 같은 모양 */
function _wmUpdBar(o) {
  var old = document.getElementById('wmUpd'); if (old) old.remove();
  var bar = document.createElement('div'); bar.id = 'wmUpd'; bar.className = 'wm-upd'; bar.setAttribute('role', 'status');
  bar.innerHTML = '<span class="wm-upd-i">⬆</span><span class="wm-upd-t"><b></b><i></i></span><button type="button" class="wm-upd-go"></button><button type="button" class="wm-upd-x" title="나중에 다시 알림">나중에</button>';
  bar.querySelector('b').textContent = o.title; bar.querySelector('i').textContent = o.sub || '';
  bar.querySelector('.wm-upd-go').textContent = o.goText || '지금 새로 고침';
  bar.querySelector('.wm-upd-go').onclick = o.go;
  bar.querySelector('.wm-upd-x').onclick = function () { if (o.later) o.later(); bar.remove(); };
  document.body.appendChild(bar);
  return bar;
}
/** 새로 고침 — 서비스 워커도 새 것으로 · PC 앱은 받아 둔 새 버전도 설치 (v13.495) */
function wmUpdateApply() {
  // v13.482 누르자마자 표시(휴대폰에서 눌렸는지 몰라 여러 번 누르던 것) · 기다림은 0.7초까지만
  var bar = document.getElementById('wmUpd');
  if (bar) { if (bar.classList.contains('is-busy')) return; bar.classList.add('is-busy'); var g = bar.querySelector('.wm-upd-go'); if (g) g.textContent = '⏳ 새로 고치는 중…'; }
  if (wmIsDesktopApp() && window.wmDesktop.appUpdate && !window.__wmDeskSkip) {
    window.__wmDeskSkip = true;   // 설치를 못 하면 웹만 새로 고침
    window.wmDesktop.appUpdate('apply').then(function (s) {
      if (s && s.installing) { _wmDeskInstalling(document.getElementById('wmUpd')); return; }
      if (s && s.waiting) { WMD.waiting = true; WMD.pct = s.pct || 0; _wmDeskProgress(document.getElementById('wmUpd')); return; }   // 다 받는 대로 PC 앱이 설치하고 다시 엶
      wmUpdateApply();   // 받아 둔 것이 없으면 웹만 새로 고침
    }).catch(function () { wmUpdateApply(); });
    return;
  }
  var done = false, go = function () { if (done) return; done = true; if (typeof window.__wmReload === 'function') window.__wmReload(); else location.reload(); };   // __wmReload = 시험용
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration('/').then(function (r) { return r && r.update(); }).catch(function () {}).then(go);
      setTimeout(go, 700);   // 서비스 워커가 늦어도
      return;
    }
  } catch (_) {}
  go();
}
