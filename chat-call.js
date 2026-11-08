/**
 * chat-call.js — 📞 음성 · 🎥 영상 통화 (v13.361)
 *   방 머리의 📞 · 🎥 → 방 사람에게 울림(받기 · 거절, 접속 안 했으면 휴대폰 푸시) → 들어온 사람끼리 서로 연결(WebRTC 그물형, 6명 정도)
 *   통화 중: 🎤 끄기 · 📷 켜기/끄기 · 🖥 화면 공유(카메라 자리에) · 작게 · 끊기 · 시간 · 말하는 사람 테두리
 *   신호는 화면 공유와 같은 길(POST /rooms/:id/rtc, sid = call-…) · 서버는 누가 들어와 있는지만 기억 · 시작/끝을 방에 남김
 *   chat-ui.js 가 부르는 것: chatCallStart · chatCallOnSignal · chatCallCardHtml · chatCallJoin
 */
var CALL = null;   // 내가 들어가 있는 통화
var CALL_RING = null;   // 울리는 중인 통화 { roomId, sid, from, fromName, video }
function _clE(s) { return typeof _cxE === 'function' ? _cxE(s) : String(s == null ? '' : s); }
function _clToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _clIce() { return typeof _crtIce === 'function' ? _crtIce() : [{ urls: 'stun:stun.l.google.com:19302' }]; }
function _clSig(roomId, body) { return apiFetch('/api/chat/rooms/' + encodeURIComponent(roomId) + '/rtc', { method: 'POST', body: JSON.stringify(body) }).catch(function () {}); }
function _clMe() { return typeof _cxMe === 'function' ? _cxMe() : null; }
function _clName(uid) {
  var m = typeof CX !== 'undefined' && CX.info && (CX.info.members || []).filter(function (x) { return x.id === uid; })[0];
  return m ? m.name : (CALL && CALL.names[uid]) || '';
}

/* ─── 시작 · 참여 ─── */
function _clMedia(video) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('이 기기는 통화를 지원하지 않습니다'));
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } } : false })
    .catch(function (e) {
      if (video) return navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function (s) { _clToast('카메라를 쓸 수 없어 음성으로 들어갑니다', 'warn'); return s; });
      throw e;
    });
}
function chatCallStart(roomId, video) {
  if (CALL) { _clToast('이미 통화 중입니다', 'warn'); _clWin(); return; }
  apiFetch('/api/chat/rooms/' + encodeURIComponent(roomId) + '/call').then(function (r) {
    if (r && r.data) return chatCallJoin(roomId, r.data.id, video);   // 이 방에 벌써 통화가 있으면 거기로
    var sid = 'call-' + Math.random().toString(36).slice(2, 12);
    return _clEnter(roomId, sid, video, true);
  }).catch(function (e) { _clToast((e && e.message) || '통화를 시작하지 못했습니다', 'error'); });
}
function chatCallJoin(roomId, sid, video) {
  if (CALL && CALL.sid === sid) { _clWin(); return; }
  if (CALL) { _clToast('이미 다른 통화 중입니다', 'warn'); return; }
  _clStopRing();
  return _clEnter(roomId, sid, video, false);
}
function _clEnter(roomId, sid, video, starter) {
  return _clMedia(video).then(function (stream) {
    CALL = { roomId: roomId, sid: sid, video: !!video, local: stream, cam: stream.getVideoTracks()[0] || null, screen: null, peers: {}, names: {}, at: Date.now(), muted: false, small: false };
    _clWin();
    _clSig(roomId, starter ? { type: 'call', sid: sid, data: { video: !!video } } : { type: 'call-join', sid: sid });
    if (typeof wmIsDesktopApp === 'function' && wmIsDesktopApp()) { /* PC 앱: 창 앞으로 */ }
    CALL.tick = setInterval(_clTick, 1000);
    _clLevels();
  }).catch(function (e) { _clToast('마이크 · 카메라를 쓸 수 없습니다: ' + ((e && e.message) || e), 'error'); });
}
function chatCallLeave() {
  var c = CALL; if (!c) return;
  CALL = null;
  _clSig(c.roomId, { type: 'call-leave', sid: c.sid });
  Object.keys(c.peers).forEach(function (u) { try { c.peers[u].pc.close(); } catch (_) {} });
  c.local.getTracks().forEach(function (t) { t.stop(); });
  if (c.screen) c.screen.getTracks().forEach(function (t) { t.stop(); });
  clearInterval(c.tick); if (c.ac) try { c.ac.close(); } catch (_) {}
  var w = document.getElementById('clWin'); if (w) w.remove();
}
window.addEventListener('beforeunload', function () { if (CALL) chatCallLeave(); });

/* ─── 연결 (사람마다 하나) — 먼저 있던 사람이 새로 온 사람에게 offer ─── */
function _clPeer(uid, offerer) {
  var c = CALL, p = c.peers[uid];
  if (p) return p;
  var pc = new RTCPeerConnection({ iceServers: _clIce() });
  p = c.peers[uid] = { pc: pc, stream: new MediaStream(), pend: [] };
  c.local.getAudioTracks().forEach(function (t) { pc.addTrack(t, c.local); });
  if (offerer) {   // 거는 쪽이 영상 자리를 만든다 — 카메라 없이 들어와도 나중에 켤 수 있게. 받는 쪽은 offer 의 자리를 씀(_clVideoSlot)
    p.vs = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    var vt = c.screen ? c.screen.getVideoTracks()[0] : c.cam;
    if (vt) p.vs.replaceTrack(vt);
  }
  pc.ontrack = function (e) { if (p.stream.getTracks().indexOf(e.track) < 0) p.stream.addTrack(e.track); e.track.onunmute = function () { _clDraw(); }; _clDraw(); };
  pc.onicecandidate = function (e) { if (e.candidate) _clSig(c.roomId, { type: 'ice', to: uid, sid: c.sid, data: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
  pc.onconnectionstatechange = function () { if (pc.connectionState === 'failed' && CALL && CALL.peers[uid] === p) { _clDrop(uid); } _clDraw(); };
  return p;
}
function _clVideoSlot(p) {
  if (p.vs) return;
  var tv = p.pc.getTransceivers().filter(function (t) { return t.receiver && t.receiver.track && t.receiver.track.kind === 'video'; })[0];
  if (!tv) return;
  tv.direction = 'sendrecv'; p.vs = tv.sender;
  var c = CALL, vt = c.screen ? c.screen.getVideoTracks()[0] : c.cam;
  if (vt) tv.sender.replaceTrack(vt).catch(function () {});
}
function _clDrop(uid) { var p = CALL && CALL.peers[uid]; if (!p) return; try { p.pc.close(); } catch (_) {} delete CALL.peers[uid]; _clDraw(); }
function _clOffer(uid) {
  var p = _clPeer(uid, true), c = CALL;
  p.pc.createOffer().then(function (o) { return p.pc.setLocalDescription(o); }).then(function () {
    _clSig(c.roomId, { type: 'offer', to: uid, sid: c.sid, data: { type: p.pc.localDescription.type, sdp: p.pc.localDescription.sdp } });
  }).catch(function (e) { console.warn('[call] offer', e); });
}

/** 신호 (chat-ui.js 'rtc' 이벤트에서) — 통화 것만 */
function chatCallOnSignal(d) {
  if (!/^call-/.test(d.sid || '')) return false;
  var c = CALL;
  if (d.type === 'call') {
    if (c && c.sid === d.sid) return true;
    if (c || d.from === _clMe()) return true;
    _clRing({ roomId: d.roomId, sid: d.sid, from: d.from, fromName: d.fromName, video: !!(d.data && d.data.video) });
    return true;
  }
  if (d.type === 'call-no') { if (c && c.sid === d.sid) _clToast((d.fromName || '') + ' 님이 통화를 받지 않았습니다', 'info'); return true; }
  if (!c || c.sid !== d.sid) {
    if (d.type === 'call-leave' && CALL_RING && CALL_RING.sid === d.sid && d.from === CALL_RING.from) _clStopRing();
    return true;
  }
  if (d.fromName) c.names[d.from] = d.fromName;
  if (d.type === 'call-join') { _clOffer(d.from); }
  else if (d.type === 'call-leave') { _clDrop(d.from); }
  else if (d.type === 'offer') {
    var p = _clPeer(d.from);
    p.pc.setRemoteDescription(d.data).then(function () { _clVideoSlot(p); p.pend.forEach(function (x) { p.pc.addIceCandidate(x).catch(function () {}); }); p.pend = []; return p.pc.createAnswer(); })
      .then(function (a) { return p.pc.setLocalDescription(a); })
      .then(function () { _clSig(c.roomId, { type: 'answer', to: d.from, sid: c.sid, data: { type: p.pc.localDescription.type, sdp: p.pc.localDescription.sdp } }); })
      .catch(function (e) { console.warn('[call] answer', e); });
  } else if (d.type === 'answer' && c.peers[d.from]) {
    var pa = c.peers[d.from];
    pa.pc.setRemoteDescription(d.data).then(function () { pa.pend.forEach(function (x) { pa.pc.addIceCandidate(x).catch(function () {}); }); pa.pend = []; }).catch(function () {});
  } else if (d.type === 'ice') {
    var pi = c.peers[d.from] || _clPeer(d.from);
    if (pi.pc.remoteDescription) pi.pc.addIceCandidate(d.data).catch(function () {}); else pi.pend.push(d.data);
  }
  return true;
}

/* ─── 울림 ─── */
function _clRing(r) {
  _clStopRing();
  CALL_RING = r;
  var el = document.createElement('div'); el.id = 'clRing'; el.className = 'cl-ring';
  el.innerHTML = '<div class="cl-ring-av">' + (typeof _cxAv === 'function' ? _cxAv(r.from, r.fromName) : '') + '</div><div class="cl-ring-t"><b>' + _clE(r.fromName) + '</b><span>' + (r.video ? '🎥 영상 통화' : '📞 음성 통화') + ' 요청</span></div>' +
    '<button type="button" class="cl-no" data-no title="거절">✕</button><button type="button" class="cl-yes" data-aud title="음성으로 받기">📞</button>' + (r.video ? '<button type="button" class="cl-yes" data-vid title="영상으로 받기">🎥</button>' : '');
  document.body.appendChild(el);
  el.querySelector('[data-no]').onclick = function () { _clSig(r.roomId, { type: 'call-no', to: r.from, sid: r.sid }); _clStopRing(); };
  el.querySelector('[data-aud]').onclick = function () { chatCallJoin(r.roomId, r.sid, false); };
  var v = el.querySelector('[data-vid]'); if (v) v.onclick = function () { chatCallJoin(r.roomId, r.sid, true); };
  // 소리 — 짧은 두 음을 되풀이
  try {
    var ac = new (window.AudioContext || window.webkitAudioContext)(), n = 0;
    r.ac = ac;
    r.beep = setInterval(function () {
      [0, 0.25].forEach(function (dt) { var o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = n % 2 ? 660 : 880; g.gain.value = 0.06; o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + dt); o.stop(ac.currentTime + dt + 0.18); });
      n++;
    }, 1500);
  } catch (_) {}
  if (typeof wmAppNotify === 'function') wmAppNotify((r.video ? '🎥 ' : '📞 ') + r.fromName + ' 님의 통화', '눌러서 받기', 'chat:' + r.roomId, { urgent: true, tag: r.sid });   // v13.382 받거나 끊길 때까지 남음
  r.timer = setTimeout(_clStopRing, 45000);   // 45초 지나면 그침
}
function _clStopRing() {
  var r = CALL_RING; if (!r) return;
  CALL_RING = null;
  clearInterval(r.beep); clearTimeout(r.timer); if (r.ac) try { r.ac.close(); } catch (_) {}
  if (typeof wmAppNotifyClose === 'function') wmAppNotifyClose(r.sid);
  var el = document.getElementById('clRing'); if (el) el.remove();
}

/* ─── 통화 창 ─── */
function _clWin() {
  var c = CALL; if (!c) return;
  var w = document.getElementById('clWin');
  if (!w) {
    w = document.createElement('div'); w.id = 'clWin'; w.className = 'cl-win';
    w.innerHTML = '<div class="cl-h"><span class="cl-dot"></span><b data-title></b><span class="cl-time" data-time>0:00</span><button type="button" data-small title="작게 · 크게">▁</button></div>' +
      '<div class="cl-grid" data-grid></div>' +
      '<div class="cl-bar"><button type="button" data-mic title="마이크 끄기 · 켜기">🎤</button><button type="button" data-cam title="카메라 켜기 · 끄기">📷</button><button type="button" data-scr title="화면 공유">🖥</button><button type="button" class="cl-end" data-end title="끊기">📞 끊기</button></div>';
    document.body.appendChild(w);
    w.querySelector('[data-end]').onclick = chatCallLeave;
    w.querySelector('[data-mic]').onclick = _clMic;
    w.querySelector('[data-cam]').onclick = _clCam;
    w.querySelector('[data-scr]').onclick = _clScreen;
    w.querySelector('[data-small]').onclick = function () { c.small = !c.small; w.classList.toggle('small', c.small); };
    // 머리 잡고 옮기기
    var h = w.querySelector('.cl-h');
    h.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      var r = w.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      function mv(ev) { w.style.left = Math.max(0, Math.min(innerWidth - 120, ev.clientX - sx)) + 'px'; w.style.top = Math.max(0, Math.min(innerHeight - 60, ev.clientY - sy)) + 'px'; w.style.right = 'auto'; w.style.bottom = 'auto'; }
      function up() { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); }
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
    });
  }
  var room = typeof CX !== 'undefined' && CX.rooms.filter(function (r) { return r.id === c.roomId; })[0];
  w.querySelector('[data-title]').textContent = (c.video ? '🎥 ' : '📞 ') + ((room && room.name) || '통화');
  _clDraw();
}
function _clTile(id, name, stream, me) {
  var vt = stream && stream.getVideoTracks().filter(function (t) { return t.readyState === 'live' && !t.muted; })[0];
  return '<div class="cl-tile' + (me ? ' me' : '') + (vt ? '' : ' novid') + '" data-tile="' + _clE(id) + '"><video autoplay playsinline' + (me ? ' muted' : '') + '></video>' +
    '<div class="cl-av">' + (typeof _cxAv === 'function' ? _cxAv(id, name) : '') + '</div><span class="cl-nm">' + _clE(name) + (me ? ' (나)' : '') + (me && CALL.muted ? ' 🔇' : '') + '</span></div>';
}
function _clDraw() {
  var c = CALL, w = document.getElementById('clWin'); if (!c || !w) return;
  var g = w.querySelector('[data-grid]'), ids = Object.keys(c.peers);
  var html = ids.map(function (u) { return _clTile(u, _clName(u) || '연결 중…', c.peers[u].stream); }).join('') + _clTile(_clMe(), (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '나', c.screen || c.local, true);
  if (g._sig !== html) {
    g.innerHTML = html; g._sig = html;
    g.dataset.n = ids.length + 1;
    ids.forEach(function (u) { var v = g.querySelector('[data-tile="' + u + '"] video'); if (v) v.srcObject = c.peers[u].stream; });
    var mv = g.querySelector('.cl-tile.me video'); if (mv) mv.srcObject = c.screen || (c.cam ? new MediaStream([c.cam]) : null);
  }
  if (!ids.length) g.setAttribute('data-wait', '상대가 받기를 기다리는 중…'); else g.removeAttribute('data-wait');
  w.querySelector('[data-mic]').classList.toggle('off', c.muted);
  w.querySelector('[data-cam]').classList.toggle('off', !c.cam);
  w.querySelector('[data-scr]').classList.toggle('on', !!c.screen);
}
function _clTick() {
  var c = CALL, w = document.getElementById('clWin'); if (!c || !w) return;
  var s = Math.floor((Date.now() - c.at) / 1000);
  w.querySelector('[data-time]').textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2);
}
/* 말하는 사람 테두리 */
function _clLevels() {
  var c = CALL; if (!c || !(window.AudioContext || window.webkitAudioContext)) return;
  try {
    var ac = c.ac = new (window.AudioContext || window.webkitAudioContext)();
    var an = {};
    c.levelT = setInterval(function () {
      if (CALL !== c) return clearInterval(c.levelT);
      var list = [[_clMe(), c.local]].concat(Object.keys(c.peers).map(function (u) { return [u, c.peers[u].stream]; }));
      list.forEach(function (x) {
        var st = x[1]; if (!st || !st.getAudioTracks().length) return;
        if (!an[x[0]] || an[x[0]].st !== st) { var a = ac.createAnalyser(); a.fftSize = 256; try { ac.createMediaStreamSource(st).connect(a); } catch (_) { return; } an[x[0]] = { a: a, st: st, buf: new Uint8Array(a.frequencyBinCount) }; }
        var o = an[x[0]]; o.a.getByteFrequencyData(o.buf);
        var sum = 0; for (var i = 0; i < o.buf.length; i++) sum += o.buf[i];
        var tile = document.querySelector('#clWin [data-tile="' + x[0] + '"]'); if (tile) tile.classList.toggle('talk', sum / o.buf.length > 18 && !(x[0] === _clMe() && c.muted));
      });
    }, 250);
  } catch (_) {}
}

/* ─── 버튼 ─── */
function _clMic() { var c = CALL; c.muted = !c.muted; c.local.getAudioTracks().forEach(function (t) { t.enabled = !c.muted; }); _clDraw(); }
function _clSetVideo(track) { var c = CALL; Object.keys(c.peers).forEach(function (u) { if (c.peers[u].vs) c.peers[u].vs.replaceTrack(track || null).catch(function () {}); }); }
function _clCam() {
  var c = CALL;
  if (c.cam) { c.cam.stop(); c.cam = null; if (!c.screen) _clSetVideo(null); c._sig = null; _clDraw(); return; }
  navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } }).then(function (s) {
    c.cam = s.getVideoTracks()[0]; if (!c.screen) _clSetVideo(c.cam); _clDraw();
  }).catch(function () { _clToast('카메라를 쓸 수 없습니다', 'warn'); });
}
function _clScreen() {
  var c = CALL;
  if (c.screen) { c.screen.getTracks().forEach(function (t) { t.stop(); }); c.screen = null; _clSetVideo(c.cam); _clDraw(); return; }
  if (!navigator.mediaDevices.getDisplayMedia) { _clToast('이 기기는 화면 공유를 할 수 없습니다', 'warn'); return; }
  navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false }).then(function (s) {
    c.screen = s; var t = s.getVideoTracks()[0];
    t.addEventListener('ended', function () { if (CALL === c && c.screen === s) { c.screen = null; _clSetVideo(c.cam); _clDraw(); } });
    _clSetVideo(t); _clDraw();
  }).catch(function () {});
}

/* ─── 대화 속 통화 카드 ─── */
function chatCallCardHtml(cd, m) {
  var live = cd.on, mine = CALL && CALL.sid === cd.id;
  return '<div class="cx-card cl-card' + (live ? ' live' : '') + '"><span class="cl-ci">' + (cd.video ? '🎥' : '📞') + '</span><span class="cx-card-t"><b>' + (live ? (cd.video ? '영상' : '음성') + ' 통화 중' : '통화 끝' + (cd.mins ? ' · ' + cd.mins + '분' : '')) + '</b><i>' + _clE(m.userName || '') + '</i></span>' +
    (live && !mine ? '<button type="button" class="wm-pri" data-calljoin="' + _clE(cd.id) + '" data-video="' + (cd.video ? 1 : '') + '">참여</button>' : mine ? '<button type="button" class="btn btn-g btn-s" data-callshow>보기</button>' : '') + '</div>';
}
document.addEventListener('click', function (e) {
  var j = e.target.closest && e.target.closest('[data-calljoin]');
  if (j && typeof CX !== 'undefined') { chatCallJoin(CX.room, j.dataset.calljoin, !!j.dataset.video); return; }
  if (e.target.closest && e.target.closest('[data-callshow]')) _clWin();
});

if (typeof window !== 'undefined') { window.chatCallStart = chatCallStart; window.chatCallJoin = chatCallJoin; window.chatCallLeave = chatCallLeave; window.chatCallOnSignal = chatCallOnSignal; window.chatCallCardHtml = chatCallCardHtml; }
