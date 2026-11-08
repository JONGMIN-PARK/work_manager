/* chat-voice.js — 🎤 음성 메시지 (v13.379)
 *   녹음: 도구판 🎤 → 입력 줄이 녹음 띠로 [● 0:12 · 취소 · 보내기 ➤] (최대 5분, 넘으면 자동으로 보냄)
 *   소리 형식: 크롬 · 안드로이드 webm/opus, 아이폰 mp4/aac — 브라우저가 되는 것으로
 *   재생: 말풍선 안 ▶ · 진행 막대(눌러서 옮기기) · 1× / 1.5× / 2× · 받아쓰기(서버 AI)가 오면 말풍선 아래 글
 * chat-ui.js 가 부르는 것: chatVoiceCan · chatVoiceStart · chatVoiceHtml · chatVoiceClick · chatVoiceWarm
 * 의존: CX, _cxBlob, _cxUpload, _cxToast, _cxE */
var CXV = { rec: null, audio: null, playing: null, speed: 1, url: {} };
function chatVoiceCan() { return !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
function _cxvFmt(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
function _cxvMime() {
  var c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (var i = 0; i < c.length; i++) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c[i])) return c[i];
  return '';
}
/** 녹음 시작 — comp = 입력 줄 감싸개(.cx-comp) */
function chatVoiceStart(comp, replyTo) {
  if (!chatVoiceCan()) { _cxToast('이 브라우저는 녹음할 수 없습니다', 'warn'); return; }
  if (CXV.rec) return;
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
    var mime = _cxvMime(), mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined), chunks = [];
    var st = CXV.rec = { mr: mr, stream: stream, t0: Date.now(), send: false, room: CX.room, comp: comp };
    mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      clearInterval(st.tick); bar.remove(); comp.classList.remove('rec-on'); CXV.rec = null;
      var secs = (Date.now() - st.t0) / 1000;
      if (!st.send || secs < 0.8 || CX.room !== st.room) { if (st.send && secs < 0.8) _cxToast('너무 짧습니다 — 조금 더 길게 말해 주세요', 'info'); return; }
      var type = (mr.mimeType || mime || 'audio/webm').split(';')[0], ext = /mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
      var d = new Date(), name = '음성 메시지 ' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2) + '.' + ext;
      var f = new File(chunks, name, { type: type }); f._dur = Math.round(secs * 10) / 10;
      _cxUpload([f], replyTo || null);
    };
    var bar = document.createElement('div'); bar.className = 'cx-rec'; bar.setAttribute('role', 'status');
    bar.innerHTML = '<i class="cx-rec-dot"></i><b data-t>0:00</b><span class="cx-rec-l">녹음 중 · 최대 5분</span><span class="cx-rec-wave"><i></i><i></i><i></i><i></i><i></i></span><button type="button" class="btn btn-g btn-s" data-rx>취소</button><button type="button" class="wm-pri" data-rs>보내기 ➤</button>';
    comp.appendChild(bar); comp.classList.add('rec-on');
    st.tick = setInterval(function () { var s = (Date.now() - st.t0) / 1000; bar.querySelector('[data-t]').textContent = _cxvFmt(s); if (s >= 300) { st.send = true; mr.stop(); } }, 250);
    bar.querySelector('[data-rx]').onclick = function () { st.send = false; mr.stop(); };
    bar.querySelector('[data-rs]').onclick = function () { st.send = true; mr.stop(); };
    mr.start(500);
    if (navigator.vibrate) try { navigator.vibrate(20); } catch (e) {}
  }).catch(function (e) { _cxToast(e && e.name === 'NotAllowedError' ? '마이크를 허용해 주세요 (브라우저 · 휴대폰 설정)' : '마이크를 쓸 수 없습니다', 'warn'); });
}
/** 말풍선 안 재생기 */
function chatVoiceHtml(f) {
  return '<div class="cx-voice" data-voice="' + _cxE(f.id) + '" data-dur="' + (f.dur || 0) + '"><button type="button" class="cx-vp" data-vplay title="재생">▶</button>' +
    '<span class="cx-vbar" data-vseek><i></i></span><em data-vt>' + (f.dur ? _cxvFmt(f.dur) : '🎤') + '</em>' +
    '<button type="button" class="cx-vs" data-vspeed title="재생 속도">' + CXV.speed + '×</button></div>' +
    (f.transcript ? '<div class="cx-vtx" title="AI 받아쓰기">📝 ' + _cxE(f.transcript) + '</div>' : '');
}
/** 보이면 미리 받아 둠 — 아이폰은 누름 안에서 바로 재생해야 함 */
function chatVoiceWarm(root) {
  root.querySelectorAll('[data-voice]').forEach(function (v) {
    var id = v.dataset.voice; if (CXV.url[id] || v._warm) return; v._warm = 1;
    _cxBlob(id).then(function (u) { CXV.url[id] = u; }).catch(function () {});
  });
}
function _cxvUi(box, a) {
  if (!box || !box.isConnected) return;
  var d = isFinite(a.duration) && a.duration > 0 ? a.duration : +(box.dataset.dur || 0);
  box.querySelector('.cx-vbar i').style.width = (d ? Math.min(100, a.currentTime / d * 100) : 0) + '%';
  box.querySelector('[data-vt]').textContent = _cxvFmt(a.paused && !a.currentTime ? d : a.currentTime);
  box.querySelector('[data-vplay]').textContent = a.paused ? '▶' : '❚❚';
  box.classList.toggle('on', !a.paused);
}
/** _cxMsgClick 이 부름 — 처리했으면 true */
function chatVoiceClick(t, ev) {
  var box = t.closest('[data-voice]'); if (!box) return false;
  var id = box.dataset.voice, a = CXV.audio || (CXV.audio = new Audio());
  if (t.closest('[data-vspeed]')) {
    CXV.speed = CXV.speed === 1 ? 1.5 : CXV.speed === 1.5 ? 2 : 1; a.playbackRate = CXV.speed;
    document.querySelectorAll('[data-vspeed]').forEach(function (b) { b.textContent = CXV.speed + '×'; });
    return true;
  }
  var seek = t.closest('[data-vseek]');
  if (seek && CXV.playing === id && isFinite(a.duration)) { var r = seek.getBoundingClientRect(); a.currentTime = Math.max(0, Math.min(1, ((ev && ev.clientX) - r.left) / r.width)) * a.duration; return true; }
  if (!t.closest('[data-vplay]') && !seek) return true;
  if (CXV.playing === id) { if (a.paused) a.play().catch(function () {}); else a.pause(); return true; }
  if (CXV.playing) { a.pause(); var old = document.querySelector('[data-voice="' + CXV.playing + '"]'); if (old) { old.classList.remove('on'); old.querySelector('[data-vplay]').textContent = '▶'; old.querySelector('.cx-vbar i').style.width = '0%'; } }
  CXV.playing = id;
  a.ontimeupdate = function () { _cxvUi(document.querySelector('[data-voice="' + id + '"]'), a); };
  a.onplay = a.onpause = a.ontimeupdate;
  a.onended = function () { a.currentTime = 0; _cxvUi(document.querySelector('[data-voice="' + id + '"]'), a); };
  function go(u) {
    a.src = u; a.playbackRate = CXV.speed;
    a.play().catch(function (e) {
      a.pause(); _cxvUi(document.querySelector('[data-voice="' + id + '"]'), a); CXV.playing = null;
      _cxToast(e && e.name === 'NotAllowedError' ? '한 번 더 눌러 재생하세요' : '이 기기에서 재생할 수 없는 소리 형식입니다 — ⋯ 메뉴에서 받아서 들어 주세요', 'info');
    });
  }
  if (CXV.url[id]) go(CXV.url[id]);
  else { box.querySelector('[data-vplay]').textContent = '…'; _cxBlob(id).then(function (u) { CXV.url[id] = u; go(u); }).catch(function () { _cxToast('소리를 불러오지 못했습니다', 'error'); }); }
  return true;
}
if (typeof window !== 'undefined') { window.chatVoiceCan = chatVoiceCan; window.chatVoiceStart = chatVoiceStart; window.chatVoiceHtml = chatVoiceHtml; window.chatVoiceClick = chatVoiceClick; window.chatVoiceWarm = chatVoiceWarm; }
