/* chat-ink.js — 🎤 화면 공유 발표 펜 (v13.368 · 1단계)
 *   레이저 포인터 · 펜 · 형광펜(진하게) · 직선 · 화살표 · 사각형 · 원 · 글자 · 사라지는 잉크 · 되돌리기 · 지우기 · 권한(발표자만/모두)
 *   전달: 화면 공유 연결마다 여는 데이터 채널 'ink' (브라우저끼리 바로, 서버 안 거침)
 *     발표자가 가운데 — 보는 사람이 그린 것은 발표자에게 갔다가(권한 확인) 다른 사람에게 다시 나감. 늦게 온 사람은 'sync' 로 남은 잉크 받음
 *   좌표는 화면(영상) 안의 비율 0~1, 굵기는 화면 너비 1000 기준 → 창 크기가 달라도 같은 자리 · 같은 굵기
 *   그리는 곳: 보는 사람은 화면 공유 창(#crtWin) 위, 발표자는 "발표 펜" 창(#ciHost — 내 공유 화면 미리보기) 위
 *   chat-rtc.js 가 부르는 것: chatInkHostDc · chatInkViewDc · chatInkViewLayer · chatInkHostOpen · chatInkEnd · chatInkSetTool
 *   2단계(v13.369): 🔦 스포트라이트 · 🔍 돋보기 · ① 번호 · 화면이 바뀌면 자동 지움 · 📸 그림까지 캡처 → 방에 사진
 *     PC 앱이면 "발표 펜" = 공유하는 모니터 위 투명 창(desktop/ink-overlay.html — 이 파일을 서버에서 불러 씀)에 바로 그림
 *     투명 창은 화면 캡처에서 빠지므로(윈도우 10 2004+) 보는 쪽엔 영상 + 이 층으로 한 번만 보임. 창 ↔ 웹 화면은 IPC 로 중계(CI.ovl)
 */
var CI = { role: null, strokes: [], ptr: {}, spot: null, mag: null, auto: false, ovl: false, relay: null, tool: null, color: '#EF4444', size: 1, bold: false, fade: true, allow: 'host', dcs: {}, dc: null, layers: [], seq: 0, raf: 0, sendT: 0, live: null, lastP: 0 };
var CI_COLORS = [['#EF4444', '빨강'], ['#F59E0B', '주황'], ['#FACC15', '노랑'], ['#22C55E', '초록'], ['#3B82F6', '파랑'], ['#FFFFFF', '흰색']];
var CI_W = [3, 6, 11], CI_FONT = [22, 30, 42], CI_FADE_MS = 2600, CI_TRAIL_MS = 650;
var CI_IC = {
  none: '<path d="m4 4 7 17 2.5-7.5L21 11Z"/>',
  laser: '<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  hl: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  bold: '<path d="M6 12h8a4 4 0 0 1 0 8H6V4h7a4 4 0 0 1 0 8"/>',
  line: '<path d="M5 19 19 5"/>',
  arrow: '<path d="M6 18 18 6"/><path d="M9 6h9v9"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  text: '<path d="M5 7V5h14v2"/><path d="M9 19h6"/><path d="M12 5v14"/>',
  fade: '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  erase: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21"/><path d="M22 21H7"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  spot: '<circle cx="12" cy="12" r="5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  mag: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  num: '<circle cx="12" cy="12" r="9"/><path d="M10.5 9 12.5 7.5V16.5"/>',
  auto: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M9 9.5l2 2 4-4"/>',
  snap: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>'
};
function _ciSvg(k) { return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + CI_IC[k] + '</svg>'; }
function _ciMe() { return typeof _cxMe === 'function' ? _cxMe() : null; }
function _ciE(s) { return typeof _cxE === 'function' ? _cxE(s) : String(s == null ? '' : s); }
function _ciName(uid) {
  var ms = (typeof CX !== 'undefined' && CX.info && CX.info.members) || [];
  var m = ms.filter(function (x) { return x.id === uid; })[0];
  return m ? m.name : '';
}
function _ciCanDraw() { return CI.role === 'host' || (CI.role === 'view' && CI.allow === 'all'); }
function _ciHostId() { return CI.role === 'host' ? _ciMe() : (typeof CRT !== 'undefined' && CRT.watch ? CRT.watch.from : null); }

/* ─── 연결 ─── */
function chatInkHostDc(uid, dc) {   // 발표자: 보는 사람마다
  CI.role = 'host';
  CI.dcs[uid] = dc;
  dc.onopen = function () { _ciTx(dc, { t: 'sync', strokes: CI.strokes.filter(function (s) { return !s.f && s.done; }), allow: CI.allow }); };
  dc.onclose = function () { if (CI.dcs[uid] === dc) delete CI.dcs[uid]; delete CI.ptr[uid]; _ciKick(); };
  dc.onmessage = function (e) {
    var m; try { m = JSON.parse(e.data); } catch (_) { return; }
    if (CI.allow !== 'all') return;   // 발표자만 — 보는 사람 잉크는 받지 않음
    if (m.t === 's' && m.s) { m.s.by = uid; m.s.id = uid + ':' + String(m.s.id).split(':').pop(); }
    else if (m.t === 'p' || m.t === 'pe') m.by = uid;
    else if (m.t === 'u') { if (String(m.id).indexOf(uid + ':') !== 0) return; }
    else if (m.t === 'clr') { m.by = uid; }
    else return;
    _ciApply(m); _ciCast(m, uid);
  };
}
function chatInkViewDc(dc) {   // 보는 사람: 발표자와 하나
  CI.role = 'view'; CI.dc = dc; CI.strokes = []; CI.ptr = {}; CI.allow = 'host';
  dc.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (_) { return; } _ciApply(m); };
  dc.onclose = function () { if (CI.dc === dc) CI.dc = null; };
  _ciToolbars();
}
function _ciTx(dc, m) { try { if (dc && dc.readyState === 'open') dc.send(typeof m === 'string' ? m : JSON.stringify(m)); } catch (e) {} }
function _ciCast(m, except) {   // 발표자 → 모두 (보낸 사람 빼고) · PC 앱 투명 창에도
  var j = JSON.stringify(m);
  Object.keys(CI.dcs).forEach(function (u) { if (u !== except) _ciTx(CI.dcs[u], j); });
  if (CI.ovl && except !== '__ovl' && window.wmDesktop && window.wmDesktop.inkSend) window.wmDesktop.inkSend(m);
}
function _ciSend(m) { if (CI.relay) return CI.relay(m); if (CI.role === 'host') _ciCast(m); else if (CI.dc) _ciTx(CI.dc, m); }

/* ─── 받은 것 반영 ─── */
function _ciApply(m) {
  if (m.t === 'sync') { CI.strokes = m.strokes || []; CI.allow = m.allow || 'host'; _ciToolbars(); }
  else if (m.t === 'st') {
    CI.allow = m.allow || 'host'; if (!_ciCanDraw()) chatInkSetTool(null); _ciToolbars();
    var w = document.getElementById('crtWin'); if (w && CI.allow === 'all') w.classList.add('big');
    if (typeof _cxToast === 'function') _cxToast(CI.allow === 'all' ? '발표자가 그리기를 열었습니다 — 화면 위 도구로 함께 표시하세요' : '이제 발표자만 그립니다', 'info');
  }
  else if (m.t === 's' && m.s) {
    var s = m.s, i = _ciIdx(s.id);
    if (s.done && s.f) s.end = performance.now();
    if (i >= 0) CI.strokes[i] = s; else CI.strokes.push(s);
    if (CI.strokes.length > 600) CI.strokes.splice(0, CI.strokes.length - 600);
  }
  else if (m.t === 'u') { var k = _ciIdx(m.id); if (k >= 0) CI.strokes.splice(k, 1); }
  else if (m.t === 'clr') CI.strokes = m.by ? CI.strokes.filter(function (s) { return s.by !== m.by; }) : [];
  else if (m.t === 'p') _ciPtr(m.by, m.x, m.y);
  else if (m.t === 'pe') delete CI.ptr[m.by];
  else if (m.t === 'sp') CI.spot = { by: m.by, x: m.x, y: m.y, r: m.r || 0.13 };
  else if (m.t === 'spe') CI.spot = null;
  else if (m.t === 'mg') CI.mag = { by: m.by, x: m.x, y: m.y, z: m.z || 2.2 };
  else if (m.t === 'mge') CI.mag = null;
  else if (m.t === 'cfg') { CI.auto = !!m.auto; _ciToolbars(); }
  _ciKick();
}
function _ciIdx(id) { for (var i = CI.strokes.length - 1; i >= 0; i--) if (CI.strokes[i].id === id) return i; return -1; }
function _ciPtr(by, x, y) {
  var p = CI.ptr[by] || (CI.ptr[by] = { pts: [] }), now = performance.now();
  p.x = x; p.y = y; p.at = now; p.pts.push({ x: x, y: y, t: now });
}

/* ─── 그림 층 ─── */
function _ciLayer(host, video, kind) {
  var old = CI.layers.filter(function (l) { return l.video === video; })[0]; if (old) return old;
  var cv = document.createElement('canvas'); cv.className = 'ci-cv';
  host.appendChild(cv);
  var L = { host: host, video: video, cv: cv, kind: kind };
  CI.layers.push(L);
  var fit = function () { _ciFit(L); };
  if (typeof ResizeObserver === 'function') { L.ro = new ResizeObserver(fit); L.ro.observe(video); L.ro.observe(host); }
  video.addEventListener('loadedmetadata', fit); video.addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', fit);
  _ciBindDraw(L);
  fit();
  return L;
}
function _ciFit(L) {
  var v = L.video, cv = L.cv, dpr = window.devicePixelRatio || 1;
  cv.style.left = v.offsetLeft + 'px'; cv.style.top = v.offsetTop + 'px';
  cv.style.width = v.offsetWidth + 'px'; cv.style.height = v.offsetHeight + 'px';
  var W = Math.round(v.offsetWidth * dpr), H = Math.round(v.offsetHeight * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  _ciDraw(L);
}
function _ciRect(L) {   // 영상 안 실제 화면(검은 띠 빼고)
  if (L.fixed) return { x: 0, y: 0, w: L.video.offsetWidth, h: L.video.offsetHeight };
  var W = L.video.offsetWidth, H = L.video.offsetHeight, vw = L.video.videoWidth || 16, vh = L.video.videoHeight || 9;
  var k = Math.min(W / vw, H / vh), w = vw * k, h = vh * k;
  return { x: (W - w) / 2, y: (H - h) / 2, w: w, h: h };
}
function _ciKick() {
  if (CI.raf) return;
  CI.raf = requestAnimationFrame(function () {
    CI.raf = 0;
    var now = performance.now(), more = false;
    CI.strokes = CI.strokes.filter(function (s) { return !(s.f && s.end && now - s.end > CI_FADE_MS); });
    Object.keys(CI.ptr).forEach(function (k) { var p = CI.ptr[k]; p.pts = p.pts.filter(function (q) { return now - q.t < CI_TRAIL_MS; }); if (now - p.at > 2500) delete CI.ptr[k]; });
    CI.layers.forEach(_ciDraw);
    if (CI.strokes.some(function (s) { return s.f && s.end; }) || Object.keys(CI.ptr).length || CI.mag) more = true;
    if (more) _ciKick();
  });
}
function _ciDraw(L) {
  var cv = L.cv, g = cv.getContext('2d'), dpr = window.devicePixelRatio || 1, R = _ciRect(L), now = performance.now();
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.save(); g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
  CI.strokes.forEach(function (s) {
    var a = s.f && s.end ? Math.max(0, 1 - (now - s.end) / CI_FADE_MS) : 1;
    if (a > 0) _ciShape(g, s, R, a);
  });
  if (CI.live && CI.live.L === L && CI.live.box) { var b = CI.live.box; g.setLineDash([5, 4]); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1; g.strokeRect(b.x, b.y, b.w, b.h); g.setLineDash([]); }
  if (CI.spot) _ciSpot(g, R, L);
  if (CI.mag) _ciMag(g, R, L);
  Object.keys(CI.ptr).forEach(function (k) { _ciLaser(g, CI.ptr[k], R, k, now); });
  g.restore();
}
/* 🔦 스포트라이트 — 동그라미만 밝게 */
function _ciSpot(g, R, L) {
  var sp = CI.spot, cx = R.x + sp.x * R.w, cy = R.y + sp.y * R.h, r = sp.r * R.w;
  g.save();
  g.fillStyle = 'rgba(2,6,23,.68)';
  g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.arc(cx, cy, r, 0, Math.PI * 2, true); g.fill('evenodd');
  var gr = g.createRadialGradient(cx, cy, r * 0.86, cx, cy, r * 1.06);
  gr.addColorStop(0, 'rgba(2,6,23,0)'); gr.addColorStop(1, 'rgba(2,6,23,.35)');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r * 1.06, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.restore();
}
/* 🔍 돋보기 — 보는 쪽은 영상을 크게, 투명 창은 테두리만(발표자는 실제 화면을 봄) */
function _ciMag(g, R, L) {
  var m = CI.mag, cx = R.x + m.x * R.w, cy = R.y + m.y * R.h, r = Math.max(60, 0.12 * R.w), v = L.video;
  g.save();
  if (!L.fixed && v.videoWidth) {
    var vw = v.videoWidth, vh = v.videoHeight, sr = r / m.z / R.w * vw;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    try { g.drawImage(v, m.x * vw - sr, m.y * vh - sr, sr * 2, sr * 2, cx - r, cy - r, r * 2, r * 2); } catch (e) {}
    g.restore(); g.save();
  }
  g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 14;
  g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.shadowBlur = 0; g.strokeStyle = 'rgba(15,23,42,.55)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, r + 2.5, 0, Math.PI * 2); g.stroke();
  g.restore();
}
function _ciShape(g, s, R, alpha) {
  var u = R.w / 1000, X = function (x) { return R.x + x * R.w; }, Y = function (y) { return R.y + y * R.h; };
  var lw = (CI_W[s.w] || 6) * u;
  g.save(); g.globalAlpha = alpha; g.strokeStyle = g.fillStyle = s.c; g.lineCap = 'round'; g.lineJoin = 'round';
  if (s.t === 'hl') { g.globalAlpha = alpha * (s.b ? 0.62 : 0.34); lw = lw * (s.b ? 5.2 : 3.6); g.lineCap = 'square'; }
  else if (s.b) lw *= 1.6;
  g.lineWidth = Math.max(1.2, lw);
  if (s.t !== 'hl' && s.t !== 'text') { g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 2.5 * (window.devicePixelRatio || 1); }
  if (s.t === 'pen' || s.t === 'hl') {
    var p = s.p || []; if (p.length < 2) { g.restore(); return; }
    g.beginPath(); g.moveTo(X(p[0]), Y(p[1]));
    if (p.length === 2) g.lineTo(X(p[0]) + 0.1, Y(p[1]));
    for (var i = 2; i + 3 < p.length; i += 2) { var mx = (X(p[i]) + X(p[i + 2])) / 2, my = (Y(p[i + 1]) + Y(p[i + 3])) / 2; g.quadraticCurveTo(X(p[i]), Y(p[i + 1]), mx, my); }
    if (p.length >= 4) g.lineTo(X(p[p.length - 2]), Y(p[p.length - 1]));
    g.stroke();
  } else if (s.t === 'line' || s.t === 'arrow') {
    var x1 = X(s.x), y1 = Y(s.y), x2 = X(s.x2), y2 = Y(s.y2);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    if (s.t === 'arrow') {
      var ang = Math.atan2(y2 - y1, x2 - x1), hd = Math.max(10, g.lineWidth * 3.6);
      g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - hd * Math.cos(ang - 0.45), y2 - hd * Math.sin(ang - 0.45)); g.lineTo(x2 - hd * Math.cos(ang + 0.45), y2 - hd * Math.sin(ang + 0.45)); g.closePath(); g.fill();
    }
  } else if (s.t === 'rect' || s.t === 'ellipse') {
    var rx = Math.min(X(s.x), X(s.x2)), ry = Math.min(Y(s.y), Y(s.y2)), rw = Math.abs(X(s.x2) - X(s.x)), rh = Math.abs(Y(s.y2) - Y(s.y));
    g.beginPath();
    if (s.t === 'rect') { var rr = Math.min(6 * u * 3, rw / 4, rh / 4); g.moveTo(rx + rr, ry); g.arcTo(rx + rw, ry, rx + rw, ry + rh, rr); g.arcTo(rx + rw, ry + rh, rx, ry + rh, rr); g.arcTo(rx, ry + rh, rx, ry, rr); g.arcTo(rx, ry, rx + rw, ry, rr); g.closePath(); }
    else g.ellipse(rx + rw / 2, ry + rh / 2, Math.max(1, rw / 2), Math.max(1, rh / 2), 0, 0, Math.PI * 2);
    g.stroke();
  } else if (s.t === 'num') {
    var nr = (CI_FONT[s.w] || 30) * u * 0.62 * (s.b ? 1.25 : 1), nx = X(s.x), ny = Y(s.y);
    g.beginPath(); g.arc(nx, ny, nr, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0; g.lineWidth = Math.max(1.5, nr / 7); g.strokeStyle = s.c === '#FFFFFF' ? '#0F172A' : '#fff'; g.stroke();
    g.fillStyle = s.c === '#FFFFFF' || s.c === '#FACC15' ? '#0F172A' : '#fff';
    g.font = '800 ' + (nr * 1.15) + 'px "Pretendard","Malgun Gothic",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(s.n), nx, ny + nr * 0.06);
  } else if (s.t === 'text' && s.s) {
    var fs = (CI_FONT[s.w] || 30) * u * (s.b ? 1.2 : 1);
    g.font = '700 ' + fs + 'px "Pretendard","Malgun Gothic",sans-serif'; g.textBaseline = 'top';
    g.lineWidth = Math.max(2, fs / 7); g.strokeStyle = s.c === '#FFFFFF' ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.92)';
    String(s.s).split('\n').forEach(function (ln, i) { g.strokeText(ln, X(s.x), Y(s.y) + i * fs * 1.25); g.fillText(ln, X(s.x), Y(s.y) + i * fs * 1.25); });
  }
  g.restore();
}
function _ciLaser(g, p, R, by, now) {
  var X = function (x) { return R.x + x * R.w; }, Y = function (y) { return R.y + y * R.h; }, u = R.w / 1000;
  var host = by === _ciHostId(), col = host ? '#FF2D2D' : '#3B82F6';
  if (p.pts.length > 1) {
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    for (var i = 1; i < p.pts.length; i++) {
      var a = 1 - (now - p.pts[i].t) / CI_TRAIL_MS; if (a <= 0) continue;
      g.globalAlpha = a * 0.75; g.strokeStyle = col; g.lineWidth = Math.max(2, 7 * u * a);
      g.beginPath(); g.moveTo(X(p.pts[i - 1].x), Y(p.pts[i - 1].y)); g.lineTo(X(p.pts[i].x), Y(p.pts[i].y)); g.stroke();
    }
    g.restore();
  }
  if (now - p.at > 1500) return;
  var cx = X(p.x), cy = Y(p.y), r = Math.max(5, 8 * u);
  g.save();
  var gr = g.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2);
  gr.addColorStop(0, host ? 'rgba(255,45,45,.55)' : 'rgba(59,130,246,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r * 3.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, r * 0.38, 0, Math.PI * 2); g.fill();
  if (!host && by !== _ciMe()) {   // 발표자 포인터는 이름표 없이 — 다른 사람 것만
    var nm = _ciName(by);
    if (nm) { g.font = '600 12px "Pretendard",sans-serif'; var tw = g.measureText(nm).width; g.fillStyle = 'rgba(17,24,39,.85)'; g.fillRect(cx + r + 4, cy + r, tw + 12, 20); g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(nm, cx + r + 10, cy + r + 10); }
  }
  g.restore();
}

/* ─── 그리기 (포인터) ─── */
function _ciBindDraw(L) {
  var cv = L.cv;
  function pos(e) { var r = cv.getBoundingClientRect(), R = _ciRect(L); return { x: Math.max(0, Math.min(1, (e.clientX - r.left - R.x) / R.w)), y: Math.max(0, Math.min(1, (e.clientY - r.top - R.y) / R.h)), R: R }; }
  cv.addEventListener('pointerdown', function (e) {
    if (!CI.tool || !_ciCanDraw() || e.button !== 0) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    var p = pos(e), me = _ciMe();
    if (CI.tool === 'laser') { CI.live = { L: L, laser: true }; _ciPtr(me, p.x, p.y); _ciSend({ t: 'p', by: me, x: p.x, y: p.y }); _ciKick(); return; }
    if (CI.tool === 'spot' || CI.tool === 'mag') return;
    if (CI.tool === 'text') { _ciTextAt(L, p); return; }
    if (CI.tool === 'num') {
      var nn = CI.strokes.reduce(function (a, x) { return x.t === 'num' ? Math.max(a, x.n || 0) : a; }, 0) + 1;
      var ns = { id: me + ':' + (++CI.seq) + Date.now().toString(36).slice(-3), by: me, t: 'num', n: nn, c: CI.color, w: CI.size, b: CI.bold || undefined, f: CI.fade || undefined, x: r4(p.x), y: r4(p.y), done: true };
      if (ns.f) ns.end = performance.now();
      CI.strokes.push(ns); _ciSend({ t: 's', s: ns }); _ciKick(); return;
    }
    var s = { id: me + ':' + (++CI.seq) + Date.now().toString(36).slice(-3), by: me, t: CI.tool, c: CI.color, w: CI.size, b: CI.bold || undefined, f: CI.fade || undefined };
    if (s.t === 'pen' || s.t === 'hl') s.p = [r4(p.x), r4(p.y)]; else { s.x = s.x2 = r4(p.x); s.y = s.y2 = r4(p.y); }
    CI.strokes.push(s); CI.live = { L: L, s: s };
    _ciKick(); _ciSendLive();
  });
  cv.addEventListener('pointermove', function (e) {
    var lv = CI.live;
    if (!lv || lv.L !== L) {   // 레이저 · 스포트라이트 · 돋보기는 누르지 않아도 따라감
      if ((CI.tool === 'spot' || CI.tool === 'mag') && CI.role === 'host') { var hq = pos(e), hn = performance.now(); if (hn - CI.lastP > 30) { CI.lastP = hn; _ciHover(hq.x, hq.y); } return; }
      if (CI.tool === 'laser' && _ciCanDraw()) { var q = pos(e), n = performance.now(); if (n - CI.lastP > 30) { CI.lastP = n; _ciPtr(_ciMe(), q.x, q.y); _ciSend({ t: 'p', by: _ciMe(), x: r4(q.x), y: r4(q.y) }); _ciKick(); } }
      return;
    }
    var p = pos(e);
    if (lv.laser) { var n2 = performance.now(); if (n2 - CI.lastP > 30) { CI.lastP = n2; _ciPtr(_ciMe(), p.x, p.y); _ciSend({ t: 'p', by: _ciMe(), x: r4(p.x), y: r4(p.y) }); } _ciKick(); return; }
    var s = lv.s;
    if (s.p) { var lx = s.p[s.p.length - 2], ly = s.p[s.p.length - 1]; if (Math.abs(lx - p.x) + Math.abs(ly - p.y) < 0.0015) return; s.p.push(r4(p.x), r4(p.y)); }
    else {
      var x2 = p.x, y2 = p.y;
      if (e.shiftKey) {   // Shift: 정사각 · 정원 · 45° 직선
        if (s.t === 'rect' || s.t === 'ellipse') { var d = Math.max(Math.abs(x2 - s.x) * p.R.w, Math.abs(y2 - s.y) * p.R.h); x2 = s.x + Math.sign(x2 - s.x || 1) * d / p.R.w; y2 = s.y + Math.sign(y2 - s.y || 1) * d / p.R.h; }
        else { var ang = Math.round(Math.atan2((y2 - s.y) * p.R.h, (x2 - s.x) * p.R.w) / (Math.PI / 4)) * Math.PI / 4, len = Math.hypot((x2 - s.x) * p.R.w, (y2 - s.y) * p.R.h); x2 = s.x + Math.cos(ang) * len / p.R.w; y2 = s.y + Math.sin(ang) * len / p.R.h; }
      }
      s.x2 = r4(x2); s.y2 = r4(y2);
    }
    _ciKick(); _ciSendLive();
  });
  function end() {
    var lv = CI.live; if (!lv || lv.L !== L) return;
    CI.live = null;
    if (lv.laser) { if (CI.tool !== 'laser') _ciSend({ t: 'pe', by: _ciMe() }); return; }
    var s = lv.s; s.done = true;
    if (!s.p && Math.abs(s.x2 - s.x) < 0.002 && Math.abs(s.y2 - s.y) < 0.002) { CI.strokes.splice(_ciIdx(s.id), 1); _ciSend({ t: 'u', id: s.id }); _ciKick(); return; }   // 그냥 누름은 버림
    if (s.f) s.end = performance.now();
    clearTimeout(CI.sendT); CI.sendT = 0; _ciSend({ t: 's', s: s }); _ciKick();
  }
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', function () { if (CI.tool === 'laser' && !CI.live) _ciSend({ t: 'pe', by: _ciMe() }); });
  cv.addEventListener('wheel', function (e) {   // 스포트라이트 크기 · 돋보기 배율
    if (CI.role !== 'host' || (CI.tool !== 'spot' && CI.tool !== 'mag')) return;
    e.preventDefault();
    if (CI.tool === 'spot') CI.spotR = Math.max(0.05, Math.min(0.35, (CI.spotR || 0.13) * (e.deltaY > 0 ? 0.9 : 1.1)));
    else CI.magZ = Math.max(1.5, Math.min(4, (CI.magZ || 2.2) * (e.deltaY > 0 ? 0.9 : 1.1)));
    var q = pos(e); _ciHover(q.x, q.y);
  }, { passive: false });
}
function _ciHover(x, y) {
  var me = _ciMe(), m = CI.tool === 'spot' ? { t: 'sp', by: me, x: r4(x), y: r4(y), r: r4(CI.spotR || 0.13) } : { t: 'mg', by: me, x: r4(x), y: r4(y), z: Math.round((CI.magZ || 2.2) * 10) / 10 };
  _ciApply(m); _ciSend(m);
}
function r4(v) { return Math.round(v * 10000) / 10000; }
function _ciSendLive() {   // 그리는 동안 40ms 마다 이어 보냄
  if (CI.sendT) return;
  CI.sendT = setTimeout(function () { CI.sendT = 0; if (CI.live && CI.live.s) _ciSend({ t: 's', s: CI.live.s }); }, 40);
}
function _ciTextAt(L, p) {
  var R = p.R, old = L.host.querySelector('.ci-txt'); if (old) old.remove();
  var ta = document.createElement('textarea'); ta.className = 'ci-txt'; ta.rows = 1; ta.placeholder = '글자 입력 · Enter';
  var fs = (CI_FONT[CI.size] || 30) * R.w / 1000 * (CI.bold ? 1.2 : 1);
  ta.style.left = (L.cv.offsetLeft + R.x + p.x * R.w) + 'px'; ta.style.top = (L.cv.offsetTop + R.y + p.y * R.h) + 'px';
  ta.style.fontSize = Math.max(12, fs) + 'px'; ta.style.color = CI.color;
  L.host.appendChild(ta); setTimeout(function () { ta.focus(); }, 0);
  var done = false;
  function fin(ok) {
    if (done) return; done = true;
    var v = ta.value.trim(); ta.remove();
    if (!ok || !v) return;
    var me = _ciMe(), s = { id: me + ':' + (++CI.seq) + Date.now().toString(36).slice(-3), by: me, t: 'text', c: CI.color, w: CI.size, b: CI.bold || undefined, f: CI.fade || undefined, x: r4(p.x), y: r4(p.y), s: v.slice(0, 300), done: true };
    if (s.f) s.end = performance.now();
    CI.strokes.push(s); _ciSend({ t: 's', s: s }); _ciKick();
  }
  ta.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); fin(true); } else if (e.key === 'Escape') { e.preventDefault(); fin(false); } });
  ta.addEventListener('blur', function () { fin(true); });
}

/* ─── 도구 ─── */
function chatInkSetTool(t) {
  if (t && !_ciCanDraw()) return;
  if (CI.tool === 'laser' && t !== 'laser') _ciSend({ t: 'pe', by: _ciMe() });
  if (CI.tool === 'spot' && t !== 'spot') { CI.spot = null; _ciSend({ t: 'spe', by: _ciMe() }); _ciKick(); }
  if (CI.tool === 'mag' && t !== 'mag') { CI.mag = null; _ciSend({ t: 'mge', by: _ciMe() }); _ciKick(); }
  CI.tool = t || null;
  if (typeof CI.onTool === 'function') CI.onTool(CI.tool);
  CI.layers.forEach(function (L) { L.cv.classList.toggle('on', !!CI.tool); L.cv.dataset.tool = CI.tool || ''; });
  _ciToolbars();
}
function chatInkUndo() {
  var me = _ciMe();
  for (var i = CI.strokes.length - 1; i >= 0; i--) if (CI.strokes[i].by === me) { var id = CI.strokes[i].id; CI.strokes.splice(i, 1); _ciSend({ t: 'u', id: id }); _ciKick(); return; }
}
function chatInkClear(all) {
  if (all && CI.role !== 'host') return;
  var m = all ? { t: 'clr' } : { t: 'clr', by: _ciMe() };
  _ciApply(m); _ciSend(m);
}
function chatInkAllow(mode) {
  if (CI.role !== 'host') return;
  if (CI.relay) { CI.allow = mode === 'all' ? 'all' : 'host'; CI.relay({ t: 'st', allow: CI.allow }); _ciToolbars(); return; }
  CI.allow = mode === 'all' ? 'all' : 'host';
  _ciCast({ t: 'st', allow: CI.allow }); _ciToolbars();
  if (typeof _cxToast === 'function') _cxToast(CI.allow === 'all' ? '모두 그릴 수 있습니다' : '발표자만 그립니다', 'info');
}
var CI_TOOLS = [['none', '선택 · 끄기', 'V'], ['laser', '레이저 포인터', 'L'], ['spot', '스포트라이트 — 휠로 크기', 'S', 1], ['mag', '돋보기 — 휠로 배율', 'G', 1], null, ['pen', '펜', 'P'], ['hl', '형광펜', 'H'], null, ['line', '직선', 'I'], ['arrow', '화살표', 'A'], ['rect', '사각형', 'R'], ['ellipse', '원', 'O'], ['text', '글자', 'T'], ['num', '번호 ①②③', 'N']];
function _ciTbHtml() {
  var h = '<div class="ci-g">';
  CI_TOOLS.forEach(function (t) {
    if (!t) { h += '</div><span class="ci-sep"></span><div class="ci-g">'; return; }
    h += '<button type="button" class="ci-b' + (t[3] ? ' ci-host' : '') + '" data-ct="' + t[0] + '" title="' + t[1] + ' (' + t[2] + ')" aria-label="' + t[1] + '">' + _ciSvg(t[0]) + '</button>';
  });
  h += '</div><span class="ci-sep"></span><div class="ci-g ci-sw">' + CI_COLORS.map(function (c, i) { return '<button type="button" class="ci-c" data-cc="' + c[0] + '" style="--c:' + c[0] + '" title="' + c[1] + ' (' + (i + 1) + ')" aria-label="' + c[1] + '"></button>'; }).join('') + '</div>' +
    '<span class="ci-sep"></span><div class="ci-g">' + [0, 1, 2].map(function (i) { return '<button type="button" class="ci-b ci-sz" data-cs="' + i + '" title="굵기 ' + (i + 1) + '" aria-label="굵기 ' + (i + 1) + '"><i style="--d:' + (4 + i * 4) + 'px"></i></button>'; }).join('') +
    '<button type="button" class="ci-b" data-cbold title="진하게 (B) — 형광펜은 더 진하고 굵게" aria-label="진하게">' + _ciSvg('bold') + '</button>' +
    '<button type="button" class="ci-b" data-cfade title="사라지는 잉크 (F) — 3초 뒤 저절로 지워짐" aria-label="사라지는 잉크">' + _ciSvg('fade') + '</button></div>' +
    '<span class="ci-sep"></span><div class="ci-g"><button type="button" class="ci-b" data-cundo title="되돌리기 (Z)" aria-label="되돌리기">' + _ciSvg('undo') + '</button>' +
    '<button type="button" class="ci-b" data-cmine title="내 잉크 지우기 (E)" aria-label="내 잉크 지우기">' + _ciSvg('erase') + '</button>' +
    '<button type="button" class="ci-b ci-host" data-call title="모두 지우기 (C)" aria-label="모두 지우기">' + _ciSvg('trash') + '</button>' +
    '<button type="button" class="ci-b ci-host ci-tg" data-cauto title="화면이 바뀌면 자동으로 지우기 — 슬라이드를 넘기면 남는 잉크를 지움" aria-label="화면이 바뀌면 자동으로 지우기">' + _ciSvg('auto') + '</button>' +
    '<button type="button" class="ci-b ci-host ci-allow" data-callow title="보는 사람도 그리기 — 끄면 발표자만" aria-label="보는 사람도 그리기">' + _ciSvg('users') + '</button></div>' +
    '<span class="ci-sep ci-always"></span><div class="ci-g ci-always"><button type="button" class="ci-b" data-csnap title="그림까지 캡처 → 이 방에 사진으로 (나중에 계속 표시 가능)" aria-label="그림까지 캡처">' + _ciSvg('snap') + '</button></div>';
  return h;
}
function _ciToolbar(el) {
  el.className = 'ci-tb'; el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', '발표 펜');
  el.innerHTML = _ciTbHtml();
  el.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ct) chatInkSetTool(b.dataset.ct === 'none' ? null : b.dataset.ct);
    else if (b.dataset.cc) { CI.color = b.dataset.cc; if (!CI.tool || CI.tool === 'laser') chatInkSetTool('pen'); _ciToolbars(); }
    else if (b.dataset.cs) { CI.size = +b.dataset.cs; _ciToolbars(); }
    else if ('cbold' in b.dataset) { CI.bold = !CI.bold; _ciToolbars(); }
    else if ('cfade' in b.dataset) { CI.fade = !CI.fade; _ciToolbars(); }
    else if ('cundo' in b.dataset) chatInkUndo();
    else if ('cmine' in b.dataset) chatInkClear(false);
    else if ('call' in b.dataset) chatInkClear(true);
    else if ('callow' in b.dataset) chatInkAllow(CI.allow === 'all' ? 'host' : 'all');
    else if ('cauto' in b.dataset) chatInkAuto(!CI.auto);
    else if ('csnap' in b.dataset) chatInkSnap();
  });
  _ciSync(el);
}
function _ciSync(el) {
  var can = _ciCanDraw();
  el.classList.toggle('off', !can); el.classList.toggle('is-host', CI.role === 'host');
  el.querySelectorAll('[data-ct]').forEach(function (b) { b.classList.toggle('on', (b.dataset.ct === 'none' ? null : b.dataset.ct) === CI.tool); b.disabled = !can; });
  el.querySelectorAll('[data-cc]').forEach(function (b) { b.classList.toggle('on', b.dataset.cc === CI.color); b.disabled = !can; });
  el.querySelectorAll('[data-cs]').forEach(function (b) { b.classList.toggle('on', +b.dataset.cs === CI.size); b.disabled = !can; });
  var q = function (s) { return el.querySelector(s); };
  q('[data-cbold]').classList.toggle('on', CI.bold); q('[data-cfade]').classList.toggle('on', CI.fade); q('[data-callow]').classList.toggle('on', CI.allow === 'all'); q('[data-cauto]').classList.toggle('on', !!CI.auto);
  ['[data-cbold]', '[data-cfade]', '[data-cundo]', '[data-cmine]'].forEach(function (s) { q(s).disabled = !can; });
  var st = el.parentNode && el.parentNode.querySelector('.ci-state');
  if (st) st.textContent = CI.role === 'host' ? (CI.allow === 'all' ? '모두 그리기' : '발표자만 그리기') : (can ? '그리기 허용됨' : '발표자만 그립니다');
}
function _ciToolbars() { document.querySelectorAll('.ci-tb').forEach(_ciSync); }

/* ─── 보는 사람: 화면 공유 창에 층 · 도구 막대 ─── */
function chatInkViewLayer(win) {
  var v = win.querySelector('video'); if (!v || win.querySelector('.ci-tb')) return;
  var tb = document.createElement('div'); win.insertBefore(tb, v); _ciToolbar(tb);
  var st = document.createElement('span'); st.className = 'ci-state'; tb.appendChild(st); _ciSync(tb);
  _ciLayer(win, v, 'view');
}

/* ─── 발표자: 내 공유 화면 미리보기 창에서 그리기 ─── */
function chatInkHostOpen() {
  if (typeof CRT === 'undefined' || !CRT.share) return;
  CI.role = 'host';
  if (window.wmDesktop && window.wmDesktop.inkOverlay && !CI.noOvl) {   // PC 앱 — 공유 화면 위에 바로
    _ciOvlBind();
    CI.ovl = true; window.wmDesktop.inkOverlay({ me: _ciMe() });
    if (typeof _crtBar === 'function') _crtBar();
    return;
  }
  var el = document.getElementById('ciHost');
  if (el) { el.hidden = false; return; }
  el = document.createElement('div'); el.id = 'ciHost'; el.className = 'crt-win big ci-host-win';
  el.innerHTML = '<div class="crt-h"><b>발표 펜</b><span class="crt-msg">여기에 그리면 보는 사람 화면에 바로 나타납니다</span><button type="button" data-fs title="전체 화면">' + _ciSvg('expand') + '</button><button type="button" data-x title="닫기 (그린 것은 남음)">' + _ciSvg('x') + '</button></div><div class="ci-tb"></div><video autoplay playsinline muted></video>';
  document.body.appendChild(el);
  var v = el.querySelector('video'); v.srcObject = CRT.share.stream;
  _ciToolbar(el.querySelector('.ci-tb'));
  var st = document.createElement('span'); st.className = 'ci-state'; el.querySelector('.ci-tb').appendChild(st); _ciSync(el.querySelector('.ci-tb'));
  _ciLayer(el, v, 'host');
  el.querySelector('[data-x]').addEventListener('click', function () { chatInkSetTool(null); el.hidden = true; });
  el.querySelector('[data-fs]').addEventListener('click', function () { if (document.fullscreenElement) document.exitFullscreen(); else (el.requestFullscreen || function () {}).call(el); });
  _ciDragHead(el);
  if (!CI.tool) chatInkSetTool('pen');
}
function _ciDragHead(el) {
  var h = el.querySelector('.crt-h');
  h.addEventListener('pointerdown', function (e) {
    if (e.target.closest('button') || document.fullscreenElement) return;
    var r = el.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    function mv(ev) { el.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - sx)) + 'px'; el.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - sy)) + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; }
    function up() { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); }
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  });
}

/* 끝 — 공유를 마치거나 보기를 닫으면 */
function chatInkEnd(role) {
  if (role && CI.role && role !== CI.role) return;
  if (CI.ovl && window.wmDesktop && window.wmDesktop.inkClose) window.wmDesktop.inkClose();
  chatInkAuto(false, true);
  if (CI.hv) { CI.hv.srcObject = null; CI.hv = null; }
  CI.layers.forEach(function (L) { if (L.ro) L.ro.disconnect(); if (L.cv.parentNode) L.cv.remove(); });
  var h = document.getElementById('ciHost'); if (h) { if (document.fullscreenElement === h) document.exitFullscreen().catch(function () {}); h.remove(); }
  CI.layers = []; CI.strokes = []; CI.ptr = {}; CI.spot = null; CI.mag = null; CI.dcs = {}; CI.dc = null; CI.tool = null; CI.live = null; CI.role = null; CI.allow = 'host'; CI.ovl = false;
}

/* 단축키 — 발표 펜 창이나 공유 창이 열려 있고, 글 입력 중이 아닐 때 */
document.addEventListener('keydown', function (e) {
  if (!CI.layers.some(function (L) { return L.host.isConnected && !L.host.hidden; }) || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (!_ciCanDraw()) return;
  var k = e.key.toLowerCase(), map = { v: null, l: 'laser', p: 'pen', h: 'hl', i: 'line', a: 'arrow', r: 'rect', o: 'ellipse', t: 'text', n: 'num' };
  if (CI.role === 'host') { map.s = 'spot'; map.g = 'mag'; }
  if (k in map) { e.preventDefault(); chatInkSetTool(map[k]); }
  else if (k === 'b') { CI.bold = !CI.bold; _ciToolbars(); }
  else if (k === 'f') { CI.fade = !CI.fade; _ciToolbars(); }
  else if (k === 'z') { e.preventDefault(); chatInkUndo(); }
  else if (k === 'e') chatInkClear(false);
  else if (k === 'c' && CI.role === 'host') chatInkClear(true);
  else if (/^[1-6]$/.test(k)) { CI.color = CI_COLORS[+k - 1][0]; if (!CI.tool || CI.tool === 'laser') chatInkSetTool('pen'); _ciToolbars(); }
  else if (k === 'escape' && CI.tool) { e.preventDefault(); chatInkSetTool(null); }
});

function chatInkHostToggle() { if (CI.ovl && window.wmDesktop && window.wmDesktop.inkClose) window.wmDesktop.inkClose(); else chatInkHostOpen(); }
/* ─── PC 앱 투명 창 ↔ 웹 화면 (웹 화면 쪽) ─── */
function _ciOvlBind() {
  if (CI.ovlBound || !window.wmDesktop || !window.wmDesktop.onInk) return;
  CI.ovlBound = true;
  window.wmDesktop.onInk(function (m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ready') { window.wmDesktop.inkSend({ t: 'sync', strokes: CI.strokes.filter(function (x) { return !x.f && x.done; }), allow: CI.allow }); window.wmDesktop.inkSend({ t: 'cfg', auto: CI.auto }); return; }
    if (m.t === 'ovl-closed') { CI.ovl = false; CI.spot = null; CI.mag = null; _ciCast({ t: 'spe', by: _ciMe() }); _ciCast({ t: 'mge', by: _ciMe() }); if (typeof _crtBar === 'function') _crtBar(); return; }
    if (m.t === 'st') { chatInkAllow(m.allow); return; }
    if (m.t === 'auto') { chatInkAuto(!!m.on); return; }
    if (m.t === 'snap') { chatInkSnap(); return; }
    if (CI.role !== 'host') return;
    if (['s', 'u', 'clr', 'p', 'pe', 'sp', 'spe', 'mg', 'mge'].indexOf(m.t) < 0) return;
    _ciApply(m); _ciCast(m, '__ovl');
  });
}

/* ─── 화면이 바뀌면 자동으로 지우기 (발표자 웹 화면이 공유 영상을 작게 떠서 비교) ─── */
function _ciHostVideo() {
  if (typeof CRT === 'undefined' || !CRT.share) return null;
  var hv = document.querySelector('#ciHost video');
  if (hv && hv.srcObject === CRT.share.stream) return hv;
  if (!CI.hv || CI.hv.srcObject !== CRT.share.stream) { CI.hv = document.createElement('video'); CI.hv.muted = true; CI.hv.playsInline = true; CI.hv.srcObject = CRT.share.stream; CI.hv.play().catch(function () {}); }
  return CI.hv;
}
function chatInkAuto(on, quiet) {
  if (CI.relay) { CI.auto = !!on; CI.relay({ t: 'auto', on: !!on }); _ciToolbars(); return; }
  CI.auto = !!on && CI.role === 'host';
  clearInterval(CI.autoT); CI.autoT = null; CI.autoPrev = null;
  if (CI.auto) {
    var cv = document.createElement('canvas'); cv.width = 48; cv.height = 27;
    var g = cv.getContext('2d', { willReadFrequently: true });
    CI.autoT = setInterval(function () {
      var v = _ciHostVideo(); if (!v || !v.videoWidth) return;
      try { g.drawImage(v, 0, 0, 48, 27); } catch (e) { return; }
      var d = g.getImageData(0, 0, 48, 27).data, cur = new Uint8Array(48 * 27);
      for (var i = 0, j = 0; i < d.length; i += 4, j++) cur[j] = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
      var prev = CI.autoPrev; CI.autoPrev = cur;
      if (!prev) return;
      var ch = 0; for (var k = 0; k < cur.length; k++) if (Math.abs(cur[k] - prev[k]) > 28) ch++;
      if (ch / cur.length > 0.22 && CI.strokes.some(function (s) { return !s.f; })) { chatInkClear(true); if (typeof _cxToast === 'function') _cxToast('화면이 바뀌어 잉크를 지웠습니다', 'info'); }
    }, 700);
  }
  if (CI.ovl && window.wmDesktop && window.wmDesktop.inkSend) window.wmDesktop.inkSend({ t: 'cfg', auto: CI.auto });
  _ciToolbars();
  if (!quiet && typeof _cxToast === 'function') _cxToast(CI.auto ? '화면이 바뀌면 잉크를 자동으로 지웁니다' : '자동 지우기를 껐습니다', 'info');
}

/* ─── 📸 그림까지 캡처 → 이 방에 사진 ─── */
function chatInkSnap() {
  if (CI.relay) { CI.relay({ t: 'snap' }); return; }
  var v = CI.role === 'view' ? document.querySelector('#crtWin video') : _ciHostVideo();
  var room = typeof CRT !== 'undefined' ? (CI.role === 'view' ? CRT.watch && CRT.watch.roomId : CRT.share && CRT.share.roomId) : null;
  if (!v || !room) return;
  function go() {
    var vw = v.videoWidth, vh = v.videoHeight; if (!vw) return;
    var cv = document.createElement('canvas'); cv.width = vw; cv.height = vh;
    var g = cv.getContext('2d'); g.drawImage(v, 0, 0, vw, vh);
    var R = { x: 0, y: 0, w: vw, h: vh };
    CI.strokes.forEach(function (s) { _ciShape(g, s, R, 1); });
    if (CI.spot) _ciSpot(g, R, { fixed: true, video: { offsetWidth: vw, offsetHeight: vh } });
    cv.toBlob(function (b) {
      if (!b) return;
      var d = new Date(), nm = '발표 캡처 ' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2) + ('0' + d.getSeconds()).slice(-2) + '.png';
      fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/rooms/' + encodeURIComponent(room) + '/files?name=' + encodeURIComponent(nm), { method: 'POST', headers: { Authorization: 'Bearer ' + (typeof _accessToken !== 'undefined' ? _accessToken : ''), 'Content-Type': 'image/png' }, body: b })
        .then(function (r) { if (!r.ok) throw new Error(r.status); if (typeof _cxToast === 'function') _cxToast('📸 그림까지 캡처해 방에 올렸습니다 — 사진 칠판에서 계속 표시할 수 있어요', 'success'); })
        .catch(function () { if (typeof _cxToast === 'function') _cxToast('캡처를 올리지 못했습니다', 'error'); });
    }, 'image/png');
  }
  if (v.videoWidth) go(); else v.addEventListener('loadeddata', go, { once: true });
}
