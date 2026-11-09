/* chat-alert.js — 🔔 새 메시지 알림 (v13.371)
 *   ① 소리(띵동 · @나는 세 번) · 진동(휴대폰) · 머리 💬 아이콘 흔들기 · 탭 제목 앞 숫자 "(3) …"
 *   ② 화면이 가려지면(앱 내림 · 다른 탭) 서버에 알림 → 서버가 휴대폰 · 브라우저 푸시를 보냄 (chat.js pushOffline · hub.awake)
 *      휴대폰은 앱을 내리면 화면 코드가 멈춰 스스로 알림을 못 띄우므로 이게 있어야 바로 옴
 *   ③ 🔔 알림 메뉴(메신저 목록 머리) — 소리 · 진동 켜고 끄기 · 들어 보기 · 이 기기 알림 켜기 · 시험 알림
 *   ④ 알림 켜기 안내 띠 — 아이폰 Safari 는 "홈 화면에 추가" 안내, 그 밖에는 [알림 켜기]
 * 의존(전역): CXS(chat-ui.js), apiFetch, API_BASE, _accessToken, wmPushState/wmPushEnable/wmPushTest/wmAppInstall(wm-app.js), _cxMenu, _cxToast, chatOpenRoom */
var CXA = { set: null, ac: null, last: 0, push: null };
(function () {
  var d = { sound: true, vib: true };
  try { var v = JSON.parse(localStorage.getItem('wm-cx-alert') || 'null'); if (v && typeof v === 'object') { if ('sound' in v) d.sound = !!v.sound; if ('vib' in v) d.vib = !!v.vib; } } catch (e) {}
  CXA.set = d;
})();
function _cxaSave() { try { localStorage.setItem('wm-cx-alert', JSON.stringify(CXA.set)); } catch (e) {} }

/* ─── 소리 — 파일 없이 만들어 냄. 휴대폰(특히 아이폰)은 한 번 누른 뒤에만 소리가 나므로 첫 누름에 깨워 둠 ─── */
function _cxaCtx() {
  var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  if (!CXA.ac) { try { CXA.ac = new AC(); } catch (e) { return null; } }
  if (CXA.ac.state === 'suspended') { try { CXA.ac.resume(); } catch (e) {} }
  return CXA.ac;
}
(function () {
  function wake() {
    var ac = _cxaCtx();
    if (ac) { try { var o = ac.createOscillator(), g = ac.createGain(); g.gain.value = 0; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.01); } catch (e) {} }
    document.removeEventListener('pointerdown', wake, true); document.removeEventListener('keydown', wake, true);
  }
  document.addEventListener('pointerdown', wake, true); document.addEventListener('keydown', wake, true);
})();
/** 띵동 — mention 이면 세 음 */
function chatAlertSound(mention) {
  var ac = _cxaCtx(); if (!ac || ac.state !== 'running') return false;
  var notes = mention ? [988, 1319, 1568] : [880, 1319], t0 = ac.currentTime + 0.01;
  notes.forEach(function (f, i) {
    var o = ac.createOscillator(), g = ac.createGain(), t = t0 + i * 0.13;
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.45);
  });
  return true;
}
/** 새 메시지 한 번 — 소리 · 진동 · 💬 흔들기 (짧은 시간 몰려 오면 한 번만) */
function chatAlertPing(o) {
  o = o || {};
  var btn = document.getElementById('hdrMsgBtn');
  if (btn) { btn.classList.remove('cx-ping'); void btn.offsetWidth; btn.classList.add('cx-ping'); setTimeout(function () { btn.classList.remove('cx-ping'); }, 1300); }
  var now = Date.now(); if (now - CXA.last < 1500) return; CXA.last = now;
  if (o.silent) return;
  if (CXA.set.sound) chatAlertSound(o.mention);
  if (CXA.set.vib && !document.hidden && navigator.vibrate) { try { navigator.vibrate(o.mention ? [70, 50, 70, 50, 70] : [60, 40, 60]); } catch (e) {} }
}

/* ─── 탭 제목 앞 숫자 — 다른 곳이 제목을 바꿔도 숫자만 붙였다 뗌 ─── */
function chatAlertTitle(n) {
  var base = String(document.title || '').replace(/^\(\d+\+?\)\s*/, '');
  var t = n > 0 ? '(' + (n > 99 ? '99+' : n) + ') ' + base : base;
  if (document.title !== t) document.title = t;
  CXA.n = n;
}
(function () {   // 화면 이동으로 제목이 바뀌면 다시 붙임
  var el = document.querySelector('title'); if (!el || typeof MutationObserver !== 'function') return;
  new MutationObserver(function () { if (CXA.n > 0 && !/^\(\d+\+?\)/.test(document.title)) chatAlertTitle(CXA.n); }).observe(el, { childList: true, characterData: true, subtree: true });
})();

/* ─── 시스템 알림 (화면이 가려졌을 때) — 푸시를 켠 기기는 서버가 보내므로 건너뜀 ─── */
function chatAlertSysNotify(title, body, roomId) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  _cxaPushState().then(function (st) {
    if (st === 'on') return;   // 서버 푸시가 같은 tag 로 옴
    var opt = { body: body, tag: 'chat-' + roomId, renotify: true, icon: '/icons/icon-192.png', data: { go: 'chat:' + roomId } };
    var reg = navigator.serviceWorker && navigator.serviceWorker.getRegistration ? navigator.serviceWorker.getRegistration('/') : Promise.resolve(null);
    reg.then(function (r) {
      if (r && r.showNotification) return r.showNotification(title, opt);   // 안드로이드 크롬은 new Notification 이 안 됨
      var n = new Notification(title, opt); n.onclick = function () { window.focus(); chatOpenRoom(roomId); n.close(); };
    }).catch(function () {});
  });
}
function _cxaPushState(fresh) {
  if (typeof wmPushState !== 'function') return Promise.resolve('unsupported');
  if (CXA.push && !fresh) return Promise.resolve(CXA.push);
  return wmPushState().then(function (st) { CXA.push = st; return st; }, function () { return 'off'; });
}

/* ─── 화면 가려짐 · 다시 보임 → 서버 (가려진 동안은 푸시) ─── */
function _cxaAway(away) {
  if (typeof CXS === 'undefined' || !CXS.on || typeof _accessToken === 'undefined' || !_accessToken) return;
  if (CXA.sentAway === away) return; CXA.sentAway = away;
  try {
    fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/away', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + _accessToken }, body: JSON.stringify({ cid: CXS.cid, away: away }) }).catch(function () { CXA.sentAway = null; });
  } catch (e) {}
}
document.addEventListener('visibilitychange', function () { _cxaAway(document.hidden); });
window.addEventListener('pagehide', function () { _cxaAway(true); });
window.addEventListener('pageshow', function () { if (!document.hidden) _cxaAway(false); });
/** 스트림이 (다시) 붙으면 — 서버는 주소의 away 로 알지만, 붙는 사이 바뀌었을 수 있음 */
function chatAlertOnHello() { CXA.sentAway = null; if (document.hidden) _cxaAway(true); else CXA.sentAway = false; }

/* ─── 🔔 메뉴 · 알림 켜기 띠 ─── */
function chatAlertBindUi(el) {
  var b = el.querySelector('#cxAlertBtn');
  if (b) b.addEventListener('click', function () { chatAlertMenu(b); });
  _cxaBanner(el);
}
function _cxaBanner(el) {
  var bar = el.querySelector('#cxPerm'); if (!bar) return;
  var x = null; try { x = +localStorage.getItem('wm-cx-perm-x') || 0; } catch (e) {}
  if (x && Date.now() - x < 7 * 864e5) return;   // 닫으면 일주일 조용히
  _cxaPushState(true).then(function (st) {
    if (st !== 'off' && st !== 'ios-install') return;
    bar.querySelector('[data-pt]').textContent = st === 'ios-install' ? '📲 아이폰은 Safari 공유 ⬆ → 홈 화면에 추가한 앱에서 새 메시지 알림을 받을 수 있어요' : '🔔 앱을 내리거나 닫아 두어도 새 메시지 알림을 받을까요?';
    var on = bar.querySelector('#cxPermOn'); on.textContent = st === 'ios-install' ? '방법 보기' : '알림 켜기';
    on.onclick = function () {
      if (st === 'ios-install') { if (typeof wmAppInstall === 'function') wmAppInstall(); return; }
      wmPushEnable().then(function (ok) { CXA.push = null; if (ok) bar.hidden = true; });
    };
    bar.querySelector('#cxPermX').onclick = function () { bar.hidden = true; try { localStorage.setItem('wm-cx-perm-x', String(Date.now())); } catch (e) {} };
    bar.hidden = false;
  });
}
function chatAlertMenu(btn) {
  _cxaPushState(true).then(function (st) {
    var lab = { on: '✅ 켜짐', off: '꺼짐', denied: '⛔ 막힘 (설정에서 허용)', 'ios-install': '홈 화면 앱에서만', unsupported: '이 브라우저는 안 됨', desktop: 'PC 앱 — 윈도우 알림' }[st] || st;
    var items = [
      [(CXA.set.sound ? '✅' : '⬜') + ' 🔊 새 메시지 소리', function () { CXA.set.sound = !CXA.set.sound; _cxaSave(); if (CXA.set.sound) chatAlertSound(false); _cxToast(CXA.set.sound ? '🔊 소리를 켰습니다' : '🔇 소리를 껐습니다', 'info'); }],
      navigator.vibrate ? [(CXA.set.vib ? '✅' : '⬜') + ' 📳 진동', function () { CXA.set.vib = !CXA.set.vib; _cxaSave(); if (CXA.set.vib) try { navigator.vibrate([60, 40, 60]); } catch (e) {} }] : null,
      ['🎵 소리 들어 보기', function () { if (!chatAlertSound(false)) _cxToast('이 기기는 소리를 낼 수 없습니다 — 한 번 누른 뒤 다시 해 보세요', 'warn'); }],
      ['📲 이 기기 알림: ' + lab, function () {
        if (st === 'off') wmPushEnable().then(function () { CXA.push = null; });
        else if (st === 'ios-install' && typeof wmAppInstall === 'function') wmAppInstall();
        else if (st === 'denied') _cxToast('브라우저 · 휴대폰 설정 › 알림에서 이 사이트(앱)를 허용해 주세요', 'warn');
        else if (st === 'on' && typeof wmPushDisable === 'function' && confirm('이 기기 알림을 끌까요?')) wmPushDisable().then(function () { CXA.push = null; });
      }],
      st === 'on' && typeof wmPushTest === 'function' ? ['🔔 시험 알림 보내기', wmPushTest] : null,
      ['🔑 키워드 알림' + (CX.kw && CX.kw.length ? ' (' + CX.kw.length + ')' : '') + '…', chatKeywordModal],
      typeof chatWallModal === 'function' ? ['🎨 대화방 배경…', function () { chatWallModal(false); }] : null
    ].filter(Boolean);
    _cxMenu(btn, items);
  });
}

/* 🔑 키워드 알림 (v13.380) — 이 낱말이 나오면 알림 꺼 둔 방이라도 알림 (휴대폰 푸시 포함) */
function chatKeywordModal() {
  if (typeof wmGuardedModal !== 'function' || typeof createModal !== 'function') return;
  return wmGuardedModal('chatKeywords', function () {
    var m = createModal({ id: 'chatKwModal', title: '🔑 키워드 알림', width: '420px', closeOnEsc: true, closeOnOverlay: true,
      html: '<p class="cxp-note" style="margin:0 0 8px">장비 이름 · 내 프로젝트 · 거래처처럼 꼭 알아야 하는 낱말. 이 낱말이 나오면 알림을 꺼 둔 방이라도 알려 줍니다. 두 글자 이상, 20개까지.</p>' +
        '<textarea class="wr-inp" id="cxKwIn" rows="4" placeholder="쉼표나 줄바꿈으로 — 예: 3호기, 조립기, 삼성전자" style="width:100%;box-sizing:border-box;resize:vertical"></textarea>' +
        '<div class="cx-mfoot"><span class="cxp-note" data-n></span><button type="button" class="wm-pri" data-save>저장</button></div>' });
    var ta = m.box.querySelector('#cxKwIn');
    ta.value = (CX.kw || []).join(', ');
    function list() { return ta.value.split(/[,\n]/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length >= 2; }); }
    function cnt() { m.box.querySelector('[data-n]').textContent = list().length + '개'; }
    ta.addEventListener('input', cnt); cnt();
    m.box.querySelector('[data-save]').addEventListener('click', function () {
      apiFetch('/api/chat/me/keywords', { method: 'PUT', body: JSON.stringify({ keywords: list() }) }).then(function (r) { CX.kw = r.data || []; _cxToast('🔑 키워드 ' + CX.kw.length + '개를 저장했습니다', 'success'); m.close(); }).catch(function (e) { _cxToast((e && e.message) || '저장하지 못했습니다', 'error'); });
    });
  }, 'chatKwModal');
}
if (typeof window !== 'undefined') window.chatKeywordModal = chatKeywordModal;
