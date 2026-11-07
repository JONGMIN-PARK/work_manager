/* chat-rtc.js — 💬 메신저 🖥 화면 공유 (v13.315) · WebRTC
 *   보내는 사람: getDisplayMedia → 방에 "화면 공유" 카드 → 보는 사람이 [보기] 누르면 그 사람마다 연결(offer)
 *   보는 사람: join 신호 → offer 받아 answer → 떠 있는 창에서 봄 (크게 · 전체 화면 · 닫기)
 *   신호는 서버를 거쳐 전달만(POST /api/chat/rooms/:id/rtc · 실시간 스트림 'rtc'), 영상은 브라우저끼리 바로
 *   STUN 은 공개 서버 · 회사 방화벽 뒤에서 안 붙으면 window.WM_TURN = [{ urls, username, credential }] 로 TURN 추가
 *   🖱 원격 제어(v13.360): 보내는 쪽이 PC 앱이면 보는 사람이 [제어 요청] → 보내는 사람이 허락 → 마우스 · 키보드가
 *     데이터 채널(브라우저끼리 바로)로 가서 PC 앱이 윈도우 입력으로 넣음. 보내는 쪽은 언제든 끝내기 · Ctrl+Alt+End */
var CRT = { share: null, viewers: {}, dcs: {}, watch: null, ctl: null, ctlAsk: null };
function _crtCanCtl() { return !!(window.wmDesktop && window.wmDesktop.remoteInput); }
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
  if (CRT.ctl) _crtCtlEnd(true);
  CRT.share = null; CRT.ctlAsk = null; CRT.dcs = {};
  s.stream.getTracks().forEach(function (t) { t.stop(); });
  Object.keys(CRT.viewers).forEach(function (u) { try { CRT.viewers[u].close(); } catch (e) {} });
  CRT.viewers = {};
  _crtSig(s.roomId, { type: 'stop', sid: s.sid });
  apiFetch('/api/chat/rooms/' + s.roomId + '/share', { method: 'POST', body: JSON.stringify({ sid: s.sid, on: false }) }).catch(function () {});
  var bar = document.getElementById('crtBar'); if (bar) bar.remove();
  if (typeof chatInkEnd === 'function') chatInkEnd('host');   // v13.368 발표 펜
}
function _crtBar() {
  var bar = document.getElementById('crtBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'crtBar'; bar.className = 'crt-bar'; document.body.appendChild(bar); }
  var n = Object.keys(CRT.viewers).length;
  if (CRT.ctlAsk) {   // 제어 요청 — 허락 · 거절
    bar.className = 'crt-bar ask';
    bar.innerHTML = '<span class="crt-dot"></span><b>🖱 ' + _cxE(CRT.ctlAsk.name) + ' 님이 내 화면 제어를 요청합니다</b><button type="button" data-ok>허락</button><button type="button" data-no>거절</button>';
    bar.querySelector('[data-ok]').addEventListener('click', function () { _crtCtlStart(CRT.ctlAsk.id); });
    bar.querySelector('[data-no]').addEventListener('click', function () { var a = CRT.ctlAsk; CRT.ctlAsk = null; _crtSig(CRT.share.roomId, { type: 'ctl-no', to: a.id, sid: CRT.share.sid }); _crtBar(); });
    return;
  }
  bar.className = 'crt-bar' + (CRT.ctl ? ' ctl' : '');
  bar.innerHTML = '<span class="crt-dot"></span><b>' + (CRT.ctl ? '🖱 ' + _cxE(CRT.ctlName || '') + ' 님이 내 화면을 제어 중' : '화면 공유 중') + '</b><span>' + (CRT.ctl ? 'Ctrl+Alt+End 로 바로 끝내기' : n ? '보는 사람 ' + n + '명' : '아직 보는 사람 없음') + '</span>' +
    (CRT.ctl ? '<button type="button" data-ctlx>제어 끝내기</button>' : '') + (typeof chatInkHostOpen === 'function' && !CRT.ctl ? '<button type="button" class="crt-ink" data-ink title="내 공유 화면 위에 레이저 · 펜 · 형광펜 · 도형으로 표시 — 보는 사람 화면에 바로">✎ 발표 펜</button>' : '') + '<button type="button" data-stop>공유 끝내기</button>';
  bar.querySelector('[data-stop]').addEventListener('click', chatRtcStop);
  var ink = bar.querySelector('[data-ink]'); if (ink) ink.addEventListener('click', chatInkHostOpen);
  var cx = bar.querySelector('[data-ctlx]'); if (cx) cx.addEventListener('click', function () { _crtCtlEnd(); });
}
function _crtOfferTo(userId) {
  var s = CRT.share; if (!s) return;
  if (CRT.viewers[userId]) { try { CRT.viewers[userId].close(); } catch (e) {} }
  var pc = new RTCPeerConnection({ iceServers: _crtIce() });
  CRT.viewers[userId] = pc;
  s.stream.getTracks().forEach(function (t) { pc.addTrack(t, s.stream); });
  var dc = pc.createDataChannel('ctl', { ordered: true });
  CRT.dcs[userId] = dc;
  dc.onopen = function () { try { dc.send(JSON.stringify({ t: 'hello', ctl: _crtCanCtl() })); } catch (e) {} };
  if (typeof chatInkHostDc === 'function') chatInkHostDc(userId, pc.createDataChannel('ink', { ordered: true }));   // v13.368 발표 펜
  dc.onmessage = function (e) {
    if (CRT.ctl !== userId || !_crtCanCtl()) return;   // 허락한 사람 것만
    var ev; try { ev = JSON.parse(e.data); } catch (_) { return; }
    window.wmDesktop.remoteInput(ev);
  };
  pc.onicecandidate = function (e) { if (e.candidate) _crtSig(s.roomId, { type: 'ice', to: userId, sid: s.sid, data: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
  pc.onconnectionstatechange = function () { if (['failed', 'closed', 'disconnected'].indexOf(pc.connectionState) >= 0 && CRT.viewers[userId] === pc && pc.connectionState !== 'disconnected') { delete CRT.viewers[userId]; _crtBar(); } };
  pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () { _crtSig(s.roomId, { type: 'offer', to: userId, sid: s.sid, data: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); });
  _crtBar();
}

/* 🖱 제어 허락 · 끝 (보내는 쪽) */
function _crtCtlStart(uid) {
  var s = CRT.share; if (!s || !_crtCanCtl()) return;
  var name = CRT.ctlAsk && CRT.ctlAsk.id === uid ? CRT.ctlAsk.name : '';
  if (CRT.ctl && CRT.ctl !== uid) _crtCtlEnd();
  CRT.ctl = uid; CRT.ctlName = name; CRT.ctlAsk = null;
  window.wmDesktop.remoteControl(true);
  _crtSig(s.roomId, { type: 'ctl-ok', to: uid, sid: s.sid });
  _crtBar();
}
function _crtCtlEnd(silent) {
  var uid = CRT.ctl; if (!uid) return;
  CRT.ctl = null; CRT.ctlName = '';
  if (_crtCanCtl()) window.wmDesktop.remoteControl(false);
  if (CRT.share) _crtSig(CRT.share.roomId, { type: 'ctl-end', to: uid, sid: CRT.share.sid });
  if (!silent) _crtBar();
}
if (window.wmDesktop && window.wmDesktop.onCtlStop) window.wmDesktop.onCtlStop(function () { _crtCtlEnd(); });   // Ctrl+Alt+End

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
  if (w.ctl) _crtViewCtl(false);
  CRT.watch = null;
  if (w.pc) try { w.pc.close(); } catch (e) {}
  _crtSig(w.roomId, { type: 'leave', to: w.from, sid: w.sid });
  var el = document.getElementById('crtWin'); if (el) { if (document.fullscreenElement === el) document.exitFullscreen().catch(function () {}); el.remove(); }
  if (typeof chatInkEnd === 'function') chatInkEnd('view');
}
function _crtWin(msg) {
  var el = document.getElementById('crtWin');
  if (!el) {
    el = document.createElement('div'); el.id = 'crtWin'; el.className = 'crt-win';
    el.innerHTML = '<div class="crt-h"><b>🖥 화면 공유</b><span class="crt-msg"></span><button type="button" data-ctl hidden title="상대 화면을 마우스 · 키보드로 조작 (상대가 허락해야 함)">🖱 제어 요청</button><button type="button" data-big title="크게 · 작게">⤢</button><button type="button" data-fs title="전체 화면">⛶</button><button type="button" data-x title="닫기">✕</button></div><video autoplay playsinline muted></video>';
    document.body.appendChild(el);
    el.querySelector('[data-x]').addEventListener('click', chatRtcLeave);
    el.querySelector('[data-big]').addEventListener('click', function () { el.classList.toggle('big'); });
    el.querySelector('[data-ctl]').addEventListener('click', function () {
      var w = CRT.watch; if (!w) return;
      if (w.ctl) { _crtSig(w.roomId, { type: 'ctl-end', to: w.from, sid: w.sid }); _crtViewCtl(false); return; }
      if (w.asking) return;
      w.asking = true; _crtCtlBtn();
      _crtSig(w.roomId, { type: 'ctl-req', to: w.from, sid: w.sid });
      _crtWin('상대가 허락하기를 기다리는 중…');
    });
    el.querySelector('[data-fs]').addEventListener('click', function () { if (document.fullscreenElement) { document.exitFullscreen(); return; } (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el); });   // 창째로 — 발표 펜 그림도 같이
    if (typeof chatInkViewLayer === 'function') chatInkViewLayer(el);
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
    else if (d.type === 'leave' && CRT.viewers[d.from]) { if (CRT.ctl === d.from) _crtCtlEnd(true); try { CRT.viewers[d.from].close(); } catch (e) {} delete CRT.viewers[d.from]; delete CRT.dcs[d.from]; _crtBar(); }
    else if (d.type === 'ctl-req' && CRT.viewers[d.from]) {
      if (!_crtCanCtl()) { _crtSig(s.roomId, { type: 'ctl-no', to: d.from, sid: s.sid }); return; }
      CRT.ctlAsk = { id: d.from, name: d.fromName || '' }; _crtBar();
      if (window.wmDesktop && window.wmDesktop.notify) window.wmDesktop.notify({ title: '🖱 화면 제어 요청', body: (d.fromName || '') + ' 님이 내 화면 제어를 요청합니다', go: '' });
    }
    else if (d.type === 'ctl-end' && CRT.ctl === d.from) { CRT.ctl = null; CRT.ctlName = ''; if (_crtCanCtl()) window.wmDesktop.remoteControl(false); _crtBar(); }
    return;
  }
  if (w && d.sid === w.sid && d.from === w.from) {
    if (d.type === 'offer') {
      if (w.pc) try { w.pc.close(); } catch (e) {}
      var pc = w.pc = new RTCPeerConnection({ iceServers: _crtIce() });
      pc.ondatachannel = function (e) {
        if (e.channel.label === 'ink') { if (typeof chatInkViewDc === 'function') chatInkViewDc(e.channel); return; }   // v13.368 발표 펜
        w.dc = e.channel;
        w.dc.onmessage = function (m) { var d; try { d = JSON.parse(m.data); } catch (_) { return; } if (d.t === 'hello') { w.canCtl = !!d.ctl; _crtCtlBtn(); } };
      };
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
    } else if (d.type === 'ctl-ok') {
      w.asking = false; _crtViewCtl(true); _crtWin('🖱 제어 중 — 화면을 누르고 움직이면 상대 PC 가 움직입니다');
    } else if (d.type === 'ctl-no') {
      w.asking = false; _crtCtlBtn(); _crtWin('상대가 제어를 거절했습니다');
    } else if (d.type === 'ctl-end') {
      w.asking = false; _crtViewCtl(false); _crtWin('제어가 끝났습니다');
    } else if (d.type === 'stop') {
      var el = _crtWin('공유가 끝났습니다'); setTimeout(function () { if (CRT.watch === w) chatRtcLeave(); else if (el && !CRT.watch) el.remove(); }, 1500);
    }
  }
}
window.addEventListener('beforeunload', function () { if (CRT.share) chatRtcStop(); if (CRT.watch) chatRtcLeave(); });

/* ─── 🖱 보는 쪽: 제어 중이면 영상 위 마우스 · 키보드를 상대에게 ─── */
function _crtCtlBtn() {
  var el = document.getElementById('crtWin'), w = CRT.watch; if (!el || !w) return;
  var b = el.querySelector('[data-ctl]');
  b.hidden = !w.canCtl;
  b.textContent = w.ctl ? '🖱 제어 끝내기' : w.asking ? '🖱 요청 중…' : '🖱 제어 요청';
  b.classList.toggle('on', !!w.ctl);
  el.classList.toggle('ctl', !!w.ctl);
}
function _crtSend(o) { var w = CRT.watch; if (w && w.ctl && w.dc && w.dc.readyState === 'open') w.dc.send(JSON.stringify(o)); }
function _crtVidPos(v, e) {   // 화면(검은 띠 빼고) 안의 비율 0~1
  var r = v.getBoundingClientRect(), vw = v.videoWidth || 16, vh = v.videoHeight || 9;
  var k = Math.min(r.width / vw, r.height / vh), cw = vw * k, ch = vh * k, ox = r.left + (r.width - cw) / 2, oy = r.top + (r.height - ch) / 2;
  return { x: Math.max(0, Math.min(1, (e.clientX - ox) / cw)), y: Math.max(0, Math.min(1, (e.clientY - oy) / ch)) };
}
function _crtViewCtl(on) {
  var w = CRT.watch; if (!w) return;
  var el = document.getElementById('crtWin'); if (!el) return;
  var v = el.querySelector('video');
  if (w.off) { w.off(); w.off = null; }
  w.ctl = !!on; _crtCtlBtn();
  if (on && typeof chatInkSetTool === 'function') chatInkSetTool(null);   // 제어 중엔 펜 끔 (영상 위 누르기는 상대 PC 로)
  if (!on) return;
  if (!el.classList.contains('big')) el.classList.add('big');
  var sink = document.createElement('textarea');   // 키보드 · 한글 입력(IME)을 받는 숨은 칸
  sink.className = 'crt-sink'; sink.setAttribute('aria-label', '원격 키보드'); el.appendChild(sink);
  var lastMove = 0, composing = false;
  function mv(e) { var n = Date.now(); if (n - lastMove < 30) return; lastMove = n; var p = _crtVidPos(v, e); _crtSend({ t: 'mm', x: p.x, y: p.y }); }
  function dn(e) { e.preventDefault(); sink.focus(); var p = _crtVidPos(v, e); _crtSend({ t: 'md', b: e.button, x: p.x, y: p.y }); }
  function up(e) { e.preventDefault(); var p = _crtVidPos(v, e); _crtSend({ t: 'mu', b: e.button, x: p.x, y: p.y }); }
  function wh(e) { e.preventDefault(); _crtSend({ t: 'wh', dy: e.deltaY > 0 ? -120 : 120 }); }
  function ctx(e) { e.preventDefault(); }
  function kd(e) {
    if (composing || e.isComposing || e.keyCode === 229) return;
    var printable = e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
    if (printable) return;   // 글자는 input 으로 (한글 · 대소문자 그대로)
    e.preventDefault(); _crtSend({ t: 'kd', k: e.code });
  }
  function ku(e) { if (composing || e.isComposing) return; var printable = e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey; if (printable) return; e.preventDefault(); _crtSend({ t: 'ku', k: e.code }); }
  function inp(e) { if (composing) return; if (sink.value) { _crtSend({ t: 'tx', s: sink.value }); sink.value = ''; } }
  function cs() { composing = true; }
  function ce(e) { composing = false; if (e.data) _crtSend({ t: 'tx', s: e.data }); sink.value = ''; }
  v.addEventListener('pointermove', mv); v.addEventListener('pointerdown', dn); v.addEventListener('pointerup', up);
  v.addEventListener('wheel', wh, { passive: false }); v.addEventListener('contextmenu', ctx);
  sink.addEventListener('keydown', kd); sink.addEventListener('keyup', ku); sink.addEventListener('input', inp);
  sink.addEventListener('compositionstart', cs); sink.addEventListener('compositionend', ce);
  setTimeout(function () { sink.focus(); }, 50);
  w.off = function () {
    v.removeEventListener('pointermove', mv); v.removeEventListener('pointerdown', dn); v.removeEventListener('pointerup', up);
    v.removeEventListener('wheel', wh); v.removeEventListener('contextmenu', ctx); sink.remove();
  };
}
