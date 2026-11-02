/* chat-rtc.js — 💬 메신저 🖥 화면 공유 (v13.315) · WebRTC
 *   보내는 사람: getDisplayMedia → 방에 "화면 공유" 카드 → 보는 사람이 [보기] 누르면 그 사람마다 연결(offer)
 *   보는 사람: join 신호 → offer 받아 answer → 떠 있는 창에서 봄 (크게 · 전체 화면 · 닫기)
 *   신호는 서버를 거쳐 전달만(POST /api/chat/rooms/:id/rtc · 실시간 스트림 'rtc'), 영상은 브라우저끼리 바로
 *   STUN 은 공개 서버 · 회사 방화벽 뒤에서 안 붙으면 window.WM_TURN = [{ urls, username, credential }] 로 TURN 추가
 *   원격 제어(상대 화면 조작)는 브라우저에서 불가 — PC 앱 단계에서 */
var CRT = { share: null, viewers: {}, watch: null };
function _crtIce() { return [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }].concat(window.WM_TURN || []); }
function _crtSig(roomId, body) { return apiFetch('/api/chat/rooms/' + encodeURIComponent(roomId) + '/rtc', { method: 'POST', body: JSON.stringify(body) }).catch(function () {}); }
function chatRtcIsLive(sid) { return !!(CRT.watch && CRT.watch.sid === sid); }

/* 보내기 */
function chatRtcShare(roomId) {
  if (CRT.share) { if (confirm('화면 공유를 마칠까요?')) chatRtcStop(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { _cxToast('이 브라우저는 화면 공유를 지원하지 않습니다 (PC 크롬 · 엣지 · 파이어폭스)', 'warn'); return; }
  navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false }).then(function (stream) {
    var sid = 'sh-' + Math.random().toString(36).slice(2, 10);
    CRT.share = { roomId: roomId, sid: sid, stream: stream };
    stream.getVideoTracks()[0].addEventListener('ended', chatRtcStop);
    apiFetch('/api/chat/rooms/' + roomId + '/share', { method: 'POST', body: JSON.stringify({ sid: sid, on: true }) }).catch(function () {});
    _crtBar();
  }).catch(function (e) { if (e && e.name !== 'NotAllowedError') _cxToast('화면 공유를 시작하지 못했습니다: ' + (e.message || e), 'error'); });
}
function chatRtcStop() {
  var s = CRT.share; if (!s) return;
  CRT.share = null;
  s.stream.getTracks().forEach(function (t) { t.stop(); });
  Object.keys(CRT.viewers).forEach(function (u) { try { CRT.viewers[u].close(); } catch (e) {} });
  CRT.viewers = {};
  _crtSig(s.roomId, { type: 'stop', sid: s.sid });
  apiFetch('/api/chat/rooms/' + s.roomId + '/share', { method: 'POST', body: JSON.stringify({ sid: s.sid, on: false }) }).catch(function () {});
  var bar = document.getElementById('crtBar'); if (bar) bar.remove();
}
function _crtBar() {
  var bar = document.getElementById('crtBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'crtBar'; bar.className = 'crt-bar'; document.body.appendChild(bar); }
  var n = Object.keys(CRT.viewers).length;
  bar.innerHTML = '<span class="crt-dot"></span><b>화면 공유 중</b><span>' + (n ? '보는 사람 ' + n + '명' : '아직 보는 사람 없음') + '</span><button type="button">공유 끝내기</button>';
  bar.querySelector('button').addEventListener('click', chatRtcStop);
}
function _crtOfferTo(userId) {
  var s = CRT.share; if (!s) return;
  if (CRT.viewers[userId]) { try { CRT.viewers[userId].close(); } catch (e) {} }
  var pc = new RTCPeerConnection({ iceServers: _crtIce() });
  CRT.viewers[userId] = pc;
  s.stream.getTracks().forEach(function (t) { pc.addTrack(t, s.stream); });
  pc.onicecandidate = function (e) { if (e.candidate) _crtSig(s.roomId, { type: 'ice', to: userId, sid: s.sid, data: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
  pc.onconnectionstatechange = function () { if (['failed', 'closed', 'disconnected'].indexOf(pc.connectionState) >= 0 && CRT.viewers[userId] === pc && pc.connectionState !== 'disconnected') { delete CRT.viewers[userId]; _crtBar(); } };
  pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () { _crtSig(s.roomId, { type: 'offer', to: userId, sid: s.sid, data: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); });
  _crtBar();
}

/* 보기 */
function chatRtcWatch(roomId, sid, from) {
  if (CRT.watch && CRT.watch.sid === sid) { _crtWin(); return; }
  chatRtcLeave();
  CRT.watch = { roomId: roomId, sid: sid, from: from, pc: null, pend: [] };
  _crtWin('연결하는 중…');
  _crtSig(roomId, { type: 'join', to: from, sid: sid });
  setTimeout(function () { if (CRT.watch && CRT.watch.sid === sid && !CRT.watch.connected) _crtWin('연결이 늦어요 — 같은 회사망이 아니면 중계(TURN) 서버가 필요할 수 있습니다'); }, 12000);
}
function chatRtcLeave() {
  var w = CRT.watch; if (!w) return;
  CRT.watch = null;
  if (w.pc) try { w.pc.close(); } catch (e) {}
  _crtSig(w.roomId, { type: 'leave', to: w.from, sid: w.sid });
  var el = document.getElementById('crtWin'); if (el) el.remove();
}
function _crtWin(msg) {
  var el = document.getElementById('crtWin');
  if (!el) {
    el = document.createElement('div'); el.id = 'crtWin'; el.className = 'crt-win';
    el.innerHTML = '<div class="crt-h"><b>🖥 화면 공유</b><span class="crt-msg"></span><button type="button" data-big title="크게 · 작게">⤢</button><button type="button" data-fs title="전체 화면">⛶</button><button type="button" data-x title="닫기">✕</button></div><video autoplay playsinline muted></video>';
    document.body.appendChild(el);
    el.querySelector('[data-x]').addEventListener('click', chatRtcLeave);
    el.querySelector('[data-big]').addEventListener('click', function () { el.classList.toggle('big'); });
    el.querySelector('[data-fs]').addEventListener('click', function () { var v = el.querySelector('video'); (v.requestFullscreen || v.webkitRequestFullscreen || function () {}).call(v); });
    // 머리를 잡고 옮기기
    var h = el.querySelector('.crt-h');
    h.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      var r = el.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      function mv(ev) { el.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - sx)) + 'px'; el.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - sy)) + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; }
      function up() { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); }
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
    });
  }
  el.querySelector('.crt-msg').textContent = msg || '';
  return el;
}

/* 신호 받기 */
function chatRtcOnSignal(d) {
  var s = CRT.share, w = CRT.watch;
  if (s && d.sid === s.sid) {
    if (d.type === 'join') _crtOfferTo(d.from);
    else if (d.type === 'answer' && CRT.viewers[d.from]) CRT.viewers[d.from].setRemoteDescription(d.data).catch(function () {});
    else if (d.type === 'ice' && CRT.viewers[d.from]) CRT.viewers[d.from].addIceCandidate(d.data).catch(function () {});
    else if (d.type === 'leave' && CRT.viewers[d.from]) { try { CRT.viewers[d.from].close(); } catch (e) {} delete CRT.viewers[d.from]; _crtBar(); }
    return;
  }
  if (w && d.sid === w.sid && d.from === w.from) {
    if (d.type === 'offer') {
      if (w.pc) try { w.pc.close(); } catch (e) {}
      var pc = w.pc = new RTCPeerConnection({ iceServers: _crtIce() });
      pc.ontrack = function (e) { var el = _crtWin(''); var v = el.querySelector('video'); if (v.srcObject !== e.streams[0]) v.srcObject = e.streams[0]; w.connected = true; };
      pc.onicecandidate = function (e) { if (e.candidate) _crtSig(w.roomId, { type: 'ice', to: w.from, sid: w.sid, data: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
      pc.onconnectionstatechange = function () { if (pc.connectionState === 'failed') _crtWin('연결이 끊겼습니다 — 다시 [보기] 를 눌러 보세요'); };
      pc.setRemoteDescription(d.data).then(function () {
        w.pend.forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); }); w.pend = [];
        return pc.createAnswer();
      }).then(function (a) { return pc.setLocalDescription(a); }).then(function () {
        _crtSig(w.roomId, { type: 'answer', to: w.from, sid: w.sid, data: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }).catch(function (e) { _crtWin('연결하지 못했습니다: ' + (e.message || e)); });
    } else if (d.type === 'ice') {
      if (w.pc && w.pc.remoteDescription) w.pc.addIceCandidate(d.data).catch(function () {}); else w.pend.push(d.data);
    } else if (d.type === 'stop') {
      var el = _crtWin('공유가 끝났습니다'); setTimeout(function () { if (CRT.watch === w) chatRtcLeave(); else if (el && !CRT.watch) el.remove(); }, 1500);
    }
  }
}
window.addEventListener('beforeunload', function () { if (CRT.share) chatRtcStop(); if (CRT.watch) chatRtcLeave(); });
