/* chat-alert.js — 🔔 새 메시지 알림 (v13.371)
 *   ① 소리(띵동 · @나는 세 번) · 진동(휴대폰) · 머리 💬 아이콘 흔들기 · 탭 제목 앞 숫자 "(3) …"
 *   ② 화면이 가려지면(앱 내림 · 다른 탭) 서버에 알림 → 서버가 휴대폰 · 브라우저 푸시를 보냄 (chat.js pushOffline · hub.awake)
 *      휴대폰은 앱을 내리면 화면 코드가 멈춰 스스로 알림을 못 띄우므로 이게 있어야 바로 옴
 *   ③ 🔔 알림 메뉴(메신저 목록 머리) — 소리 · 진동 켜고 끄기 · 🎵 알림 소리 고르기 · 이 기기 알림 켜기 · 시험 알림
 *   ⑤ v13.412 🎵 알림 소리 — 14가지(파일 없이 만들어 냄) · 종류별(1:1 · 그룹 방 · @나 · 🔑 키워드) · 크기 · 이 기기에 저장
 *   ④ 알림 켜기 안내 띠 — 아이폰 Safari 는 "홈 화면에 추가" 안내, 그 밖에는 [알림 켜기]
 * 의존(전역): CXS(chat-ui.js), apiFetch, API_BASE, _accessToken, wmPushState/wmPushEnable/wmPushTest/wmAppInstall(wm-app.js), _cxMenu, _cxToast, chatOpenRoom */
var CXA = { set: null, ac: null, last: 0, push: null };
/* 🎵 소리 모음 (v13.412) — 음표 { f 높이, t 시작, d 길이, w 파형, g 세기, to 미끄러질 높이, a 올라오는 시간, h [[배음 배수, 세기]] } */
var CXA_SOUNDS = [
  { id: 'dingdong', g: 'base', name: '띵동', ico: '🔔', n: [{ f: 880, t: 0, d: 0.42 }, { f: 1319, t: 0.13, d: 0.42 }] },
  { id: 'triple', g: 'base', name: '띵동댕', ico: '🎶', n: [{ f: 988, t: 0, d: 0.42 }, { f: 1319, t: 0.13, d: 0.42 }, { f: 1568, t: 0.26, d: 0.5 }] },
  { id: 'bell', g: 'base', name: '맑은 종', ico: '🛎️', n: [{ f: 1318.5, t: 0, d: 1.4, h: [[2, 0.35], [3.01, 0.18], [4.2, 0.08]] }] },
  { id: 'tok', g: 'base', name: '톡', ico: '💬', n: [{ f: 640, to: 190, t: 0, d: 0.1, g: 1.4 }] },
  { id: 'drop', g: 'base', name: '물방울', ico: '💧', n: [{ f: 520, to: 1500, t: 0, d: 0.17 }, { f: 900, to: 1900, t: 0.12, d: 0.13, g: 0.5 }] },
  { id: 'marimba', g: 'inst', name: '마림바', ico: '🪵', n: [{ f: 784, t: 0, d: 0.36, w: 'triangle', g: 1.3, h: [[4, 0.12]] }, { f: 1047, t: 0.12, d: 0.42, w: 'triangle', g: 1.3, h: [[4, 0.12]] }] },
  { id: 'chime', g: 'base', name: '도미솔', ico: '🎐', n: [{ f: 1047, t: 0, d: 0.6, h: [[2, 0.15]] }, { f: 1319, t: 0.1, d: 0.6, h: [[2, 0.15]] }, { f: 1568, t: 0.2, d: 0.8, h: [[2, 0.15]] }] },
  { id: 'xylo', g: 'inst', name: '실로폰', ico: '🎹', n: [{ f: 1047, t: 0, d: 0.25, w: 'triangle', g: 1.2 }, { f: 1175, t: 0.07, d: 0.25, w: 'triangle', g: 1.2 }, { f: 1319, t: 0.14, d: 0.25, w: 'triangle', g: 1.2 }, { f: 1568, t: 0.21, d: 0.4, w: 'triangle', g: 1.2 }] },
  { id: 'harp', g: 'inst', name: '하프', ico: '🪕', n: [523, 659, 784, 1047, 1319, 1568].map(function (f, i) { return { f: f, t: i * 0.045, d: 0.7, w: 'triangle', g: 0.7 }; }) },
  { id: 'pad', g: 'base', name: '부드럽게', ico: '☁️', n: [{ f: 523, t: 0, d: 0.9, a: 0.12, h: [[1.5, 0.4]] }, { f: 659, t: 0.18, d: 0.9, a: 0.12, h: [[1.5, 0.4]] }] },
  { id: 'coin', g: 'fun', name: '반짝', ico: '✨', n: [{ f: 988, t: 0, d: 0.09, w: 'square', g: 0.35 }, { f: 1319, t: 0.08, d: 0.38, w: 'square', g: 0.35 }] },
  { id: 'beep', g: 'base', name: '삐빅', ico: '📟', n: [{ f: 1800, t: 0, d: 0.07, w: 'square', g: 0.3 }, { f: 1800, t: 0.11, d: 0.07, w: 'square', g: 0.3 }] },
  { id: 'knock', g: 'base', name: '똑똑', ico: '🚪', n: [{ f: 260, to: 150, t: 0, d: 0.09, w: 'triangle', g: 2.2 }, { f: 260, to: 150, t: 0.15, d: 0.09, w: 'triangle', g: 2.2 }] },
  { id: 'alarm', g: 'base', name: '급해요', ico: '🚨', n: [0, 1, 2].map(function (i) { return { f: 1175, to: 1568, t: i * 0.2, d: 0.16, w: 'sawtooth', g: 0.25 }; }) },
  // 악기
  { id: 'musicbox', g: 'inst', name: '오르골', ico: '🎠', n: [1568, 1319, 1175, 1319, 1568].map(function (f, i) { return { f: f, t: i * 0.12, d: 0.5, w: 'triangle', g: 0.9, h: [[3, 0.12]] }; }) },
  { id: 'doorbell', g: 'inst', name: '현관 벨', ico: '🏠', n: [{ f: 659, t: 0, d: 0.9, h: [[2, 0.3], [3, 0.1]] }, { f: 523, t: 0.45, d: 1.2, h: [[2, 0.3], [3, 0.1]] }] },
  { id: 'gong', g: 'inst', name: '징', ico: '🥁', n: [{ f: 196, t: 0, d: 2.2, a: 0.03, g: 1.6, h: [[2.4, 0.5], [3.9, 0.25], [5.3, 0.12]] }] },
  { id: 'piano', g: 'inst', name: '피아노', ico: '🎼', n: [{ f: 784, t: 0, d: 0.7, w: 'triangle', g: 1.2, h: [[2, 0.25], [3, 0.08]] }, { f: 988, t: 0.14, d: 0.7, w: 'triangle', g: 1.2, h: [[2, 0.25], [3, 0.08]] }, { f: 1175, t: 0.28, d: 1, w: 'triangle', g: 1.2, h: [[2, 0.25], [3, 0.08]] }] },
  { id: 'kalimba', g: 'inst', name: '칼림바', ico: '🎵', n: [{ f: 1047, t: 0, d: 0.5, g: 1.1, h: [[5.4, 0.15]] }, { f: 1568, t: 0.1, d: 0.6, g: 1.1, h: [[5.4, 0.15]] }] },
  // 재미
  { id: 'levelup', g: 'fun', name: '레벨 업', ico: '🎮', n: [523, 659, 784, 1047].map(function (f, i) { return { f: f, t: i * 0.06, d: i === 3 ? 0.35 : 0.08, w: 'square', g: 0.3 }; }) },
  { id: 'tada', g: 'fun', name: '짜잔', ico: '🎉', n: [{ f: 392, t: 0, d: 0.08, w: 'triangle', g: 1.2 }, { f: 392, t: 0.1, d: 0.08, w: 'triangle', g: 1.2 }].concat([523, 659, 784].map(function (f) { return { f: f, t: 0.22, d: 0.8, w: 'triangle', g: 0.9 }; })) },
  { id: 'boing', g: 'fun', name: '띠용', ico: '🤪', n: [{ f: 150, to: 700, t: 0, d: 0.18, g: 1.3 }, { f: 700, to: 230, t: 0.16, d: 0.32, g: 1.3 }] },
  { id: 'laser', g: 'fun', name: '뿅', ico: '🔫', n: [{ f: 1700, to: 180, t: 0, d: 0.25, w: 'square', g: 0.28 }] },
  { id: 'pop', g: 'fun', name: '뽁', ico: '🫧', n: [{ f: 900, to: 280, t: 0, d: 0.06, g: 1.8 }] },
  { id: 'bubble', g: 'fun', name: '보글보글', ico: '🐟', n: [600, 820, 700, 980, 760].map(function (f, i) { return { f: f, to: f * 2.1, t: i * 0.07, d: 0.07, g: 0.9 }; }) },
  { id: 'bird', g: 'fun', name: '새소리', ico: '🐦', n: [0, 1, 2].map(function (i) { return { f: 2100 + i * 150, to: 3300, t: i * 0.11, d: 0.08, g: 0.8 }; }) },
  { id: 'whistle', g: 'fun', name: '휘파람', ico: '😗', n: [{ f: 1200, to: 2400, t: 0, d: 0.22, g: 0.9 }, { f: 2400, to: 1500, t: 0.24, d: 0.3, g: 0.9 }] },
  { id: 'cat', g: 'fun', name: '야옹', ico: '🐱', n: [{ f: 520, to: 880, t: 0, d: 0.2, w: 'sawtooth', g: 0.22, h: [[2, 0.3]] }, { f: 880, to: 460, t: 0.18, d: 0.36, w: 'sawtooth', g: 0.22, h: [[2, 0.3]] }] },
  { id: 'frog', g: 'fun', name: '개굴', ico: '🐸', n: [0, 0.16].map(function (t) { return { f: 170, to: 260, t: t, d: 0.11, w: 'sawtooth', g: 0.35 }; }) },
  { id: 'heart', g: 'fun', name: '두근두근', ico: '💓', n: [0, 0.16, 0.7, 0.86].map(function (t) { return { f: 120, to: 70, t: t, d: 0.13, g: 3 }; }) },
  { id: 'robot', g: 'fun', name: '로봇', ico: '🤖', n: [300, 450, 250, 520].map(function (f, i) { return { f: f, t: i * 0.08, d: 0.07, w: 'square', g: 0.25 }; }) },
  { id: 'ufo', g: 'fun', name: '우주선', ico: '🛸', n: [{ f: 380, to: 1300, t: 0, d: 0.45, g: 0.7 }, { f: 1300, to: 380, t: 0.42, d: 0.45, g: 0.7 }] },
  { id: 'phone', g: 'fun', name: '따르릉', ico: '☎️', n: [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return { f: i % 2 ? 1600 : 1350, t: i * 0.045, d: 0.045, w: 'square', g: 0.22 }; }) },
  { id: 'drip', g: 'fun', name: '똑', ico: '🚰', n: [{ f: 1900, to: 600, t: 0, d: 0.06, g: 1.4 }] },
  { id: 'random', g: 'fun', name: '랜덤', ico: '🎲', n: null },
  { id: 'none', g: 'base', name: '소리 없음', ico: '🔇', n: [] }
];
var CXA_GROUPS = [['base', '기본'], ['inst', '악기'], ['fun', '재미']];
/* 종류 — 1:1 · 그룹 방 · @나 · 🔑 키워드 (기본은 예전과 같게: 띵동 · @나 · 키워드는 띵동댕) */
var CXA_KINDS = [['dm', '💬 1:1 대화', 'dingdong'], ['room', '👥 그룹 방', 'dingdong'], ['at', '@ 나를 부를 때', 'triple'], ['kw', '🔑 키워드', 'triple']];
(function () {
  var d = { sound: true, vib: true, snd: {}, vol: 0.8, bg: false };
  try {
    var v = JSON.parse(localStorage.getItem('wm-cx-alert') || 'null');
    if (v && typeof v === 'object') {
      if ('sound' in v) d.sound = !!v.sound; if ('vib' in v) d.vib = !!v.vib; if ('bg' in v) d.bg = !!v.bg;
      if (isFinite(+v.vol)) d.vol = Math.max(0, Math.min(1, +v.vol));
      if (v.snd && typeof v.snd === 'object') d.snd = v.snd;
    }
  } catch (e) {}
  CXA_KINDS.forEach(function (k) { if (!_cxaSnd(d.snd[k[0]])) d.snd[k[0]] = k[2]; });
  CXA.set = d;
})();
function _cxaSnd(id) { for (var i = 0; i < CXA_SOUNDS.length; i++) if (CXA_SOUNDS[i].id === id) return CXA_SOUNDS[i]; return null; }
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
/** 알림 소리 — kind: 'dm' · 'room' · 'at' · 'kw' (true 는 'at', false/없음은 'dm'), 또는 소리 id 를 바로 (미리 듣기) */
function chatAlertSound(kind, opt) {
  var ac = _cxaCtx(); if (!ac || ac.state !== 'running') return false;
  if (kind === true) kind = 'at'; else if (!kind) kind = 'dm';
  var snd = _cxaSnd(kind) || _cxaSnd(CXA.set.snd[kind]) || CXA_SOUNDS[0];
  if (!snd.n) { var pool = CXA_SOUNDS.filter(function (x) { return x.n && x.n.length; }); snd = pool[Math.floor(Math.random() * pool.length)]; }   // 🎲 랜덤 — 들을 때마다 다른 소리
  var vol = opt && opt.vol != null ? opt.vol : CXA.set.vol;
  if (!snd.n.length || vol <= 0) return true;
  var peak = 0.22 * vol, t0 = ac.currentTime + 0.01;
  var out = ac.createGain(); out.gain.value = 1; out.connect(ac.destination);
  snd.n.forEach(function (n) {
    var t = t0 + n.t, a = n.a || 0.012;
    [[1, 1]].concat(n.h || []).forEach(function (hm, j) {
      var o = ac.createOscillator(), g = ac.createGain(), pk = Math.max(0.0002, peak * (n.g || 1) * hm[1]), d = j ? n.d * 0.6 : n.d;
      o.type = n.w || 'sine';
      o.frequency.setValueAtTime(n.f * hm[0], t);
      if (n.to) o.frequency.exponentialRampToValueAtTime(n.to * hm[0], t + d * 0.8);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.03);
    });
  });
  return true;
}
/** 새 메시지 한 번 — 소리 · 진동 · 💬 흔들기 (짧은 시간 몰려 오면 한 번만) */
function chatAlertPing(o) {
  o = o || {};
  var btn = document.getElementById('hdrMsgBtn');
  if (btn) { btn.classList.remove('cx-ping'); void btn.offsetWidth; btn.classList.add('cx-ping'); setTimeout(function () { btn.classList.remove('cx-ping'); }, 1300); }
  var now = Date.now(); if (now - CXA.last < 1500) return; CXA.last = now;
  var kind = o.kind || (o.mention ? 'at' : 'dm');
  if (o.silent) { if (CXA.set.sound && CXA.set.bg) chatAlertSound(kind); return; }   // PC 앱이 뒤에 있을 때 — 윈도우 알림 소리가 따로 남(원하면 내 소리도)
  if (CXA.set.sound) chatAlertSound(kind);
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
      [(CXA.set.sound ? '✅' : '⬜') + ' 🔊 새 메시지 소리', function () { CXA.set.sound = !CXA.set.sound; _cxaSave(); if (CXA.set.sound) chatAlertSound('dm'); _cxToast(CXA.set.sound ? '🔊 소리를 켰습니다' : '🔇 소리를 껐습니다', 'info'); }],
      navigator.vibrate ? [(CXA.set.vib ? '✅' : '⬜') + ' 📳 진동', function () { CXA.set.vib = !CXA.set.vib; _cxaSave(); if (CXA.set.vib) try { navigator.vibrate([60, 40, 60]); } catch (e) {} }] : null,
      ['🎵 알림 소리 고르기…', chatSoundModal],
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

/* 🎵 알림 소리 고르기 (v13.412) — 종류를 고르고 → 소리 카드를 누르면 들려 주고 그 종류에 바로 정함 */
function chatSoundModal() {
  if (typeof wmGuardedModal !== 'function' || typeof createModal !== 'function') return;
  return wmGuardedModal('chatSounds', function () {
    var cur = 'at';
    var m = createModal({ id: 'chatSndModal', title: '🎵 알림 소리', width: '620px', boxStyle: 'max-height:88vh', closeOnEsc: true, closeOnOverlay: true,
      html: '<p class="cxp-note" style="margin:0 0 10px">종류를 고르고 소리를 누르면 들려 주고 바로 정해집니다. 이 기기에만 저장돼요 (PC · 휴대폰 따로).</p>' +
        '<div class="cxs-kinds" role="tablist">' + CXA_KINDS.map(function (k) { return '<button type="button" role="tab" data-k="' + k[0] + '"><b>' + _cxE(k[1]) + '</b><i data-kn="' + k[0] + '"></i></button>'; }).join('') + '</div>' +
        CXA_GROUPS.map(function (gr) {
          return '<div class="cxs-gh">' + gr[1] + '</div><div class="cxs-grid">' + CXA_SOUNDS.filter(function (x) { return x.g === gr[0]; }).map(function (x) { return '<button type="button" data-s="' + x.id + '"><span>' + x.ico + '</span><b>' + _cxE(x.name) + '</b></button>'; }).join('') + '</div>';
        }).join('') +
        '<label class="cxs-vol">🔈 크기 <input type="range" min="0" max="100" step="5" data-vol> <output data-volv></output></label>' +
        (typeof wmIsDesktopApp === 'function' && wmIsDesktopApp() ? '<label class="cxs-bg"><input type="checkbox" data-bg> PC 앱이 뒤에 있을 때도 이 소리 내기 <i>윈도우 알림 소리와 겹치면 윈도우 설정 › 알림 › 업무 관리자 › 소리를 끄세요</i></label>' : '') +
        '<div class="cx-mfoot"><span class="cxp-note">' + (CXA.set.sound ? '' : '🔇 지금 새 메시지 소리가 꺼져 있어요 — 고르면 켜집니다') + '</span><button type="button" data-reset>기본으로</button></div>' });
    var box = m.box;
    function draw() {
      box.querySelectorAll('[data-k]').forEach(function (b) { b.classList.toggle('on', b.dataset.k === cur); });
      CXA_KINDS.forEach(function (k) { var s = _cxaSnd(CXA.set.snd[k[0]]); box.querySelector('[data-kn="' + k[0] + '"]').textContent = s ? s.ico + ' ' + s.name : ''; });
      box.querySelectorAll('[data-s]').forEach(function (b) { b.classList.toggle('on', b.dataset.s === CXA.set.snd[cur]); });
      box.querySelector('[data-volv]').textContent = Math.round(CXA.set.vol * 100) + '%';
    }
    var vol = box.querySelector('[data-vol]'); vol.value = Math.round(CXA.set.vol * 100);
    vol.addEventListener('input', function () { CXA.set.vol = (+vol.value || 0) / 100; _cxaSave(); draw(); });
    vol.addEventListener('change', function () { chatAlertSound(cur); });
    var bg = box.querySelector('[data-bg]'); if (bg) { bg.checked = !!CXA.set.bg; bg.addEventListener('change', function () { CXA.set.bg = bg.checked; _cxaSave(); }); }
    box.addEventListener('click', function (e) {
      var k = e.target.closest('[data-k]'), s = e.target.closest('[data-s]');
      if (k) { cur = k.dataset.k; draw(); chatAlertSound(cur); return; }
      if (s) {
        CXA.set.snd[cur] = s.dataset.s; if (s.dataset.s !== 'none') CXA.set.sound = true; _cxaSave(); draw();
        if (!chatAlertSound(s.dataset.s)) _cxToast('이 기기는 아직 소리를 낼 수 없습니다 — 한 번 더 눌러 보세요', 'warn');
        return;
      }
      if (e.target.closest('[data-reset]')) { CXA_KINDS.forEach(function (x) { CXA.set.snd[x[0]] = x[2]; }); CXA.set.vol = 0.8; vol.value = 80; _cxaSave(); draw(); chatAlertSound(cur); }
    });
    draw();
  }, 'chatSndModal');
}
if (typeof window !== 'undefined') { window.chatSoundModal = chatSoundModal; window.chatAlertSound = chatAlertSound; }

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
