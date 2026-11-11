/**
 * chat-board.js — 🖼 사진 칠판 (v13.356)
 *   메신저 사진을 크게 보고, 그 위에 같이 표시한다. 원본은 그대로 두고 표시 · 자르기 · 회전은 따로 저장(chat_files.annot).
 *   - 보기: 원본 ↔ 표시 보기 · 확대/축소(휠 · 두 손가락 · 0 맞춤) · 끌어 옮기기 · 회전(저장됨)
 *   - 표시: 펜 · 형광펜 · 글자 · 화살표 · 사각형 · 원 · 흐리게(가리기) · 집중(나머지 어둡게) · 지우개 · 되돌리기
 *   - 자르기: 이대로 자르기(원본은 그대로) · 잘라서 복사(어디든 붙여넣기) · 잘라서 보내기
 *   - 같이: 방 사람이 그리면 바로 보임 · 그리는 중인 선 · 누가 어디를 가리키는지(칠판처럼)
 *   - 보내기 전에: 붙여넣은 사진 · 📸 화면 캡처를 먼저 표시하고 보냄 (보내면 원본 + 표시 모두 남음)
 *   - v13.409 나만 보는 회전: ⟲ ⟳ · 📐 1° 단위 바로잡기 · 📏 수평 맞추기 · ⬚ 빈 모서리 채우기 — 사람마다 따로 저장(chat_file_views), 👥 모두에게도 가능 · ◀ ▶ 방 사진 넘겨 보기
 *   chat-ui.js 가 부르는 것: chatBoardOpen · chatBoardDraft · chatBoardCapture · chatBoardOnEvent · chatBoardThumb
 */
var CB = null;   // 열린 칠판 하나
var _cbDim = null;   // 지금 그리는 사진 크기 · 영역 (화면 · 저장 · 미리보기 공용)
var _cbImgs = {};
var _cbMosC = typeof WeakMap !== 'undefined' ? new WeakMap() : { get: function () { return null; }, set: function () {} };   // 사진별 흐리게 조각   // fid → 불러온 사진 (미리보기 · 칠판이 같이 씀)
var CB_COLORS = ['#EF4444', '#F59E0B', '#22C55E', '#3B82F6', '#A855F7', '#111827', '#FFFFFF'];
var CB_TOOLS = [
  ['pan', '✋', '옮기기 (Space 누르고 끌어도 됨)', 'V'], ['pen', '✏️', '펜', 'P'], ['hl', '🖍️', '형광펜', 'M'], ['text', '🅣', '글자', 'T'],
  ['arrow', '↗', '화살표', 'A'], ['rect', '▭', '사각형', 'R'], ['ellipse', '◯', '원', 'O'],
  ['blur', '▦', '흐리게 — 개인정보 · 비밀 가리기', 'B'], ['box', '🔦', '집중 — 고른 곳만 밝게', 'F'],
  ['crop', '✂️', '자르기 · 잘라서 복사 · 잘라서 보내기', 'C'], ['erase', '🧽', '지우개 — 누른 표시 지우기', 'E']
];
var CB_KEYS = {}; CB_TOOLS.forEach(function (t) { CB_KEYS[t[3].toLowerCase()] = t[0]; });

function _cbE(s) { return typeof _cxE === 'function' ? _cxE(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _cbToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _cbMe() { return typeof _cxMe === 'function' ? _cxMe() : null; }
function _cbId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function _cbApi() { return typeof API_BASE !== 'undefined' ? API_BASE : ''; }
function _cbIsImg(mime) { return /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(mime || ''); }

/* ─── 사진 받기 (인증 필요한 주소 · GCS 서명 주소 모두 blob 으로 — 캔버스가 더럽혀지지 않게) ─── */
function _cbLoadImg(src) {
  return new Promise(function (ok, no) {
    function load(u, cors) {
      var im = new Image();
      if (cors) im.crossOrigin = 'anonymous';
      im.onload = function () { ok(im); };
      im.onerror = function () { no(new Error('사진을 불러오지 못했습니다')); };
      im.src = u;
    }
    if (/^https?:/.test(src)) fetch(src).then(function (r) { if (!r.ok) throw new Error(); return r.blob(); }).then(function (b) { load(URL.createObjectURL(b)); }).catch(function () { load(src, true); });
    else load(src);
  });
}
function _cbFileUrl(fid) { return typeof _cxBlob === 'function' ? _cxBlob(fid) : Promise.reject(new Error('no blob')); }
function _cbFileImg(fid) {
  if (!_cbImgs[fid]) { _cbImgs[fid] = _cbFileUrl(fid).then(_cbLoadImg); _cbImgs[fid].catch(function () { delete _cbImgs[fid]; }); }
  return _cbImgs[fid];
}

/* ─── 좌표: 사진 픽셀 → (회전) → (확대 · 옮김) → 화면 ─── */
function _cbRotM(rot, W, H) {
  rot = +rot || 0;
  if (rot === 90) return [0, 1, -1, 0, H, 0];
  if (rot === 180) return [-1, 0, 0, -1, W, H];
  if (rot === 270) return [0, -1, 1, 0, 0, W];
  if (!rot) return [1, 0, 0, 1, 0, 0];
  // v13.409 비스듬히 — 돌린 뒤 사진 전체가 (0,0) 오른쪽 아래에 오게
  var t = rot * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  var xs = [0, W * c, -H * s, W * c - H * s], ys = [0, W * s, H * c, W * s + H * c];
  return [c, s, -s, c, -Math.min.apply(null, xs), -Math.min.apply(null, ys)];
}
/** 각도 정리 — 0.1° 단위 · 0 이상 360 미만 (서버 annAng 과 같음) */
function _cbNA(v) { v = Math.round((+v || 0) * 10) / 10; v = ((v % 360) + 360) % 360; return v >= 359.95 ? 0 : Math.round(v * 10) / 10; }
function _cbSkew(rot) { return Math.abs(((+rot || 0) % 90 + 90) % 90) > 0.01; }
/** 영역(사진 픽셀)을 돌린 뒤 감싸는 상자 (돌린 공간 좌표) */
function _cbBoxOf(area, R) {
  var pts = [[area.x, area.y], [area.x + area.w, area.y], [area.x, area.y + area.h], [area.x + area.w, area.y + area.h]].map(function (p) { return _cbApply(R, p[0], p[1]); });
  var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
  var x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
  return { x: x, y: y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y };
}
/** 비스듬히 돌린 영역 안에서 빈 모서리 없는 가장 큰 직사각형 (돌린 공간 좌표) */
function _cbInner(area, rot, W, H) {
  var R = _cbRotM(rot, W, H), c = _cbApply(R, area.x + area.w / 2, area.y + area.h / 2);
  var t = rot * Math.PI / 180, sa = Math.abs(Math.sin(t)), ca = Math.abs(Math.cos(t)), w = area.w, h = area.h, wr, hr;
  var lg = Math.max(w, h), sh = Math.min(w, h);
  if (sh <= 2 * sa * ca * lg || Math.abs(sa - ca) < 1e-10) { var x = 0.5 * sh; if (w >= h) { wr = x / sa; hr = x / ca; } else { wr = x / ca; hr = x / sa; } }
  else { var c2 = ca * ca - sa * sa; wr = (w * ca - h * sa) / c2; hr = (h * ca - w * sa) / c2; }
  return { x: c.x - wr / 2, y: c.y - hr / 2, w: wr, h: hr };
}
/** 화면에 보일 범위 (돌린 공간) — 빈 모서리 채우기면 안쪽 직사각형 */
function _cbTarget(area, rot, W, H, fill) { return fill && _cbSkew(rot) ? _cbInner(area, rot, W, H) : _cbBoxOf(area, _cbRotM(rot, W, H)); }
/* v13.409 지금 보는 각도 — 내가 돌려 둔 게 있으면 그것, 없으면 같이 쓰는 회전 */
function _cbAng() { return CB.fid && CB.my ? CB.my.a : (CB.a.rot || 0); }
function _cbFill() { return !!CB.fill && _cbSkew(_cbAng()); }
function _cbVA(a) { return Object.assign({}, a || CB.a, { rot: _cbAng() }); }
function _cbApply(m, x, y) { return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; }
function _cbViewM() {
  var r = _cbRotM(_cbAng(), CB.W, CB.H), z = CB.zoom;
  return [r[0] * z, r[1] * z, r[2] * z, r[3] * z, r[4] * z + CB.panX, r[5] * z + CB.panY];
}
function _cbToImg(sx, sy) {
  var m = _cbViewM(), det = m[0] * m[3] - m[1] * m[2];
  var x = sx - m[4], y = sy - m[5];
  return { x: (m[3] * x - m[2] * y) / det, y: (-m[1] * x + m[0] * y) / det };
}
function _cbNorm(s) { return { x: Math.min(s.x, s.x2), y: Math.min(s.y, s.y2), w: Math.abs(s.x2 - s.x), h: Math.abs(s.y2 - s.y) }; }
function _cbArea() { return (CB.mode === 'mark' && CB.a.crop && CB.tool !== 'crop') ? CB.a.crop : { x: 0, y: 0, w: CB.W, h: CB.H }; }
function _cbScale() { return _cbDim ? Math.max(_cbDim.W, _cbDim.H) / 1000 : CB ? Math.max(CB.W, CB.H) / 1000 : 1; }

/* ─── 그리기 ─── */
function _cbMosaic(s, img) {
  var key = s.id + ':' + s.x + ':' + s.y + ':' + s.x2 + ':' + s.y2;
  var box = _cbMosC.get(img); if (!box) { box = {}; _cbMosC.set(img, box); }
  if (box[key]) return box[key];
  var r = _cbNorm(s), blk = Math.max(6, Math.round(Math.max(r.w, r.h) / 18));
  var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(r.w / blk)); c.height = Math.max(1, Math.round(r.h / blk));
  c.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  if (!(CB && CB.draft === s) && !/^live/.test(s.id || '')) box[key] = c;   // 그리는 중인 것은 담아 두지 않음
  return c;
}
function _cbShape(g, s, img, live) {
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = s.c; g.fillStyle = s.c; g.lineWidth = s.w;
  var r;
  if (s.t === 'pen' || s.t === 'hl') {
    if (s.t === 'hl') { g.globalAlpha = 0.38; g.lineWidth = s.w * 4; g.lineCap = 'butt'; g.globalCompositeOperation = 'multiply'; }
    g.beginPath(); g.moveTo(s.p[0], s.p[1]);
    for (var i = 2; i < s.p.length; i += 2) g.lineTo(s.p[i], s.p[i + 1]);
    if (s.p.length === 2) g.lineTo(s.p[0] + 0.1, s.p[1]);
    g.stroke();
  } else if (s.t === 'line' || s.t === 'arrow') {
    g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x2, s.y2); g.stroke();
    if (s.t === 'arrow') {
      var ang = Math.atan2(s.y2 - s.y, s.x2 - s.x), hl = Math.max(s.w * 3.5, 14 * _cbScale());
      g.beginPath(); g.moveTo(s.x2, s.y2);
      g.lineTo(s.x2 - hl * Math.cos(ang - 0.45), s.y2 - hl * Math.sin(ang - 0.45));
      g.lineTo(s.x2 - hl * Math.cos(ang + 0.45), s.y2 - hl * Math.sin(ang + 0.45));
      g.closePath(); g.fill();
    }
  } else if (s.t === 'rect' || s.t === 'ellipse') {
    r = _cbNorm(s);
    g.beginPath();
    if (s.t === 'rect') g.rect(r.x, r.y, r.w, r.h); else g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    if (s.fill) { g.globalAlpha = 0.18; g.fill(); g.globalAlpha = 1; }
    g.stroke();
  } else if (s.t === 'blur') {
    r = _cbNorm(s);
    if (r.w > 1 && r.h > 1 && img) { g.imageSmoothingEnabled = false; g.drawImage(_cbMosaic(s, img), r.x, r.y, r.w, r.h); }
    if (live) { g.setLineDash([6 * _cbScale(), 4 * _cbScale()]); g.lineWidth = 2 * _cbScale(); g.strokeStyle = '#fff'; g.strokeRect(r.x, r.y, r.w, r.h); }
  } else if (s.t === 'box') {
    r = _cbNorm(s);
    var A = (_cbDim && _cbDim.area) || r;
    g.beginPath(); g.rect(A.x - 1, A.y - 1, A.w + 2, A.h + 2); g.rect(r.x, r.y, r.w, r.h);
    g.fillStyle = 'rgba(15,18,32,.6)'; g.fill('evenodd');
    g.lineWidth = Math.max(2, s.w * 0.6); g.strokeStyle = s.c; g.strokeRect(r.x, r.y, r.w, r.h);
  } else if (s.t === 'text') {
    var lines = String(s.s || '').split('\n'), fs = s.fs || 32;
    g.font = '700 ' + fs + 'px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
    g.textBaseline = 'top';
    g.lineWidth = Math.max(2, fs / 7); g.strokeStyle = s.c === '#FFFFFF' || s.c === '#ffffff' ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.92)';
    lines.forEach(function (ln, i) { g.strokeText(ln, s.x, s.y + i * fs * 1.25); g.fillText(ln, s.x, s.y + i * fs * 1.25); });
  }
  g.restore();
}
/** 사진 + 표시를 g 에 (변환은 부른 쪽에서) */
function _cbPaint(g, img, a, opt) {
  opt = opt || {};
  var area = opt.area || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  _cbDim = { W: img.naturalWidth, H: img.naturalHeight, area: area };
  g.save();
  g.beginPath(); g.rect(area.x, area.y, area.w, area.h); g.clip();
  g.drawImage(img, 0, 0);
  if (opt.marks !== false) {
    var shapes = (a.shapes || []);
    shapes.filter(function (s) { return s.t === 'blur'; }).forEach(function (s) { _cbShape(g, s, img); });
    shapes.filter(function (s) { return s.t === 'box'; }).forEach(function (s) { _cbShape(g, s, img); });
    shapes.filter(function (s) { return s.t !== 'blur' && s.t !== 'box'; }).forEach(function (s) { _cbShape(g, s, img); });
  }
  g.restore();
}
/** 저장 · 복사 · 보내기용 그림 — 회전 · 자르기 · 표시 반영. area 를 주면 그 부분만 */
function _cbFlatten(img, a, opt) {
  opt = opt || {};
  var W = img.naturalWidth, H = img.naturalHeight, rot = a.rot || 0;
  var area = opt.area || (opt.marks !== false && a.crop) || { x: 0, y: 0, w: W, h: H };
  // 돌린 공간에서 담을 범위 — vsel(비스듬히 보며 고른 곳) · 빈 모서리 채우기 · 아니면 영역 전체를 감싸는 상자
  var R = _cbRotM(rot, W, H), T = opt.vsel || _cbTarget(area, rot, W, H, opt.fill);
  var max = opt.max || 4096, k = Math.min(1, max / Math.max(T.w, T.h, 1));
  var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(T.w * k)); c.height = Math.max(1, Math.round(T.h * k));
  var g = c.getContext('2d');
  if (opt.bg) { g.fillStyle = opt.bg; g.fillRect(0, 0, c.width, c.height); }
  g.setTransform(R[0] * k, R[1] * k, R[2] * k, R[3] * k, (R[4] - T.x) * k, (R[5] - T.y) * k);
  var keep = _cbDim;
  _cbPaint(g, img, a, { area: area, marks: opt.marks });
  _cbDim = keep;
  return c;
}
function _cbBlob(canvas) { return new Promise(function (ok) { canvas.toBlob(function (b) { ok(b); }, 'image/png'); }); }

/* ─── 화면 그리기 ─── */
function _cbDraw() {
  if (!CB || CB.raf) return;
  CB.raf = requestAnimationFrame(function () {
    if (!CB) return;
    CB.raf = 0;
    var cv = CB.cv, g = cv.getContext('2d'), dpr = CB.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    var m = _cbViewM();
    g.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
    var area = _cbArea();
    // v13.373 바탕(그림자 판 + 사진 + 끝낸 표시)은 한 장 담아 두고 — 같이 보는 사람 손가락 · 그리는 중인 선만 바뀌면 그것만 다시
    var key = m.join(',') + '|' + (CB.rev || 0) + '|' + CB.mode + '|' + _cbFill() + CB.tool + '|' + cv.width + 'x' + cv.height + '|' + area.x + ',' + area.y + ',' + area.w + ',' + area.h;
    if (!CB.base || CB.baseKey !== key) {
      var bc = CB.base || (CB.base = document.createElement('canvas'));
      if (bc.width !== cv.width || bc.height !== cv.height) { bc.width = cv.width; bc.height = cv.height; }
      var bg = bc.getContext('2d');
      bg.setTransform(1, 0, 0, 1, 0, 0); bg.clearRect(0, 0, bc.width, bc.height);
      bg.save();
      if (_cbFill() && CB.tool !== 'crop') {   // v13.409 빈 모서리 채우기 — 안쪽 직사각형만
        var T = _cbTarget(area, _cbAng(), CB.W, CB.H, true), z0 = CB.zoom;
        bg.setTransform(z0 * dpr, 0, 0, z0 * dpr, CB.panX * dpr, CB.panY * dpr);
        bg.beginPath(); bg.rect(T.x, T.y, T.w, T.h); bg.clip();
      }
      bg.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
      bg.save(); bg.shadowColor = 'rgba(0,0,0,.45)'; bg.shadowBlur = 30 / CB.zoom; bg.fillStyle = '#fff'; bg.fillRect(area.x, area.y, area.w, area.h); bg.restore();
      _cbPaint(bg, CB.img, CB.mode === 'orig' ? { shapes: [] } : CB.a, { area: area, marks: CB.mode !== 'orig' });
      bg.restore();
      CB.baseKey = key;
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(CB.base, 0, 0);
    g.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
    // 그리는 중 (나 · 다른 사람)
    if (CB.mode !== 'orig') {
      g.save(); g.beginPath(); g.rect(area.x, area.y, area.w, area.h); g.clip();
      if (CB.draft) _cbShape(g, CB.draft, CB.img, true);
      Object.keys(CB.peers).forEach(function (k) { var p = CB.peers[k]; if (p.live) _cbShape(g, p.live, CB.img, true); });
      g.restore();
    }
    // 자르기 고르는 중
    if (CB.tool === 'crop' && _cbSkew(_cbAng())) {   // v13.409 비스듬히 본 채로 고르기 — 돌린 공간에서
      var vs = CB.cropSel, FB = _cbBoxOf({ x: 0, y: 0, w: CB.W, h: CB.H }, _cbRotM(_cbAng(), CB.W, CB.H));
      g.save(); g.setTransform(CB.zoom * dpr, 0, 0, CB.zoom * dpr, CB.panX * dpr, CB.panY * dpr);
      g.beginPath(); g.rect(FB.x, FB.y, FB.w, FB.h); if (vs) g.rect(vs.x, vs.y, vs.w, vs.h);
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fill('evenodd');
      if (vs) { g.setLineDash([8 / CB.zoom, 5 / CB.zoom]); g.lineWidth = 2 / CB.zoom; g.strokeStyle = '#fff'; g.strokeRect(vs.x, vs.y, vs.w, vs.h); }
      g.restore();
      g.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
    } else if (CB.tool === 'crop') {
      var cs = CB.cropSel || CB.a.crop;
      g.save();
      g.beginPath(); g.rect(0, 0, CB.W, CB.H);
      if (cs) g.rect(cs.x, cs.y, cs.w, cs.h);
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fill('evenodd');
      if (cs) { g.setLineDash([8 / CB.zoom, 5 / CB.zoom]); g.lineWidth = 2 / CB.zoom; g.strokeStyle = '#fff'; g.strokeRect(cs.x, cs.y, cs.w, cs.h); }
      g.restore();
    }
    // 같이 보는 사람 손가락
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    Object.keys(CB.peers).forEach(function (k) {
      var p = CB.peers[k]; if (p.x == null) return;
      var s = _cbApply(m, p.x, p.y);
      g.save();
      g.fillStyle = p.c || '#3B82F6'; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x + 4, s.y + 15); g.lineTo(s.x + 8, s.y + 9); g.lineTo(s.x + 15, s.y + 8); g.closePath(); g.fill(); g.stroke();
      g.font = '600 11.5px "Malgun Gothic",sans-serif';
      var tw = g.measureText(p.name).width;
      g.fillStyle = p.c || '#3B82F6'; _cbRound(g, s.x + 12, s.y + 14, tw + 12, 19, 9); g.fill();
      g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(p.name, s.x + 18, s.y + 23.5);
      g.restore();
    });
    if (CB.lvl) _cbDrawLevel(g);
    _cbZoomLabel();
  });
}
/* 📏 수평 맞추기 — 끄는 중인 선과 바로잡을 각도 */
function _cbLvlDelta(L) { var phi = Math.atan2(L.y2 - L.y1, L.x2 - L.x1) * 180 / Math.PI; return Math.round(phi / 90) * 90 - phi; }
function _cbDrawLevel(g) {
  var L = CB.lvl, d = _cbLvlDelta(L);
  g.save();
  g.lineCap = 'round'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.55)';
  g.beginPath(); g.moveTo(L.x1, L.y1); g.lineTo(L.x2, L.y2); g.stroke();
  g.lineWidth = 2; g.strokeStyle = '#FACC15'; g.setLineDash([10, 6]); g.stroke(); g.setLineDash([]);
  [[L.x1, L.y1], [L.x2, L.y2]].forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 5, 0, Math.PI * 2); g.fillStyle = '#FACC15'; g.fill(); });
  var t = (d > 0 ? '⟳ ' : '⟲ ') + Math.abs(Math.round(d * 10) / 10) + '° 바로잡기';
  g.font = '700 12.5px "Malgun Gothic",sans-serif';
  var tw = g.measureText(t).width;
  g.fillStyle = 'rgba(15,18,32,.9)'; _cbRound(g, L.x2 + 12, L.y2 - 12, tw + 16, 24, 12); g.fill();
  g.fillStyle = '#FACC15'; g.textBaseline = 'middle'; g.fillText(t, L.x2 + 20, L.y2);
  g.restore();
}
function _cbRound(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function _cbFit() {
  if (!CB) return;
  var T = _cbTarget(_cbArea(), _cbAng(), CB.W, CB.H, _cbFill() && CB.tool !== 'crop');
  var bx = T.x, by = T.y, bw = T.w, bh = T.h;
  var cw = CB.cv.clientWidth, ch = CB.cv.clientHeight, pad = cw < 600 ? 12 : 40;
  var strip = CB.el.querySelector('[data-ang]');   // v13.409 📐 띠가 열려 있으면 그 위로 맞춤 (사진 아래를 가리지 않게)
  if (strip && !strip.hidden && strip.offsetHeight) ch = Math.max(120, ch - strip.offsetHeight - 14);
  CB.zoom = Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh, 4);
  CB.panX = (cw - bw * CB.zoom) / 2 - bx * CB.zoom;
  CB.panY = (ch - bh * CB.zoom) / 2 - by * CB.zoom;
  _cbDraw();
}
function _cbZoomAt(f, sx, sy) {
  var nz = Math.max(0.05, Math.min(16, CB.zoom * f));
  f = nz / CB.zoom;
  CB.panX = sx - (sx - CB.panX) * f; CB.panY = sy - (sy - CB.panY) * f; CB.zoom = nz;
  _cbDraw();
}
function _cbZoomLabel() { var z = CB && CB.el.querySelector('[data-zl]'); if (z) z.textContent = Math.round(CB.zoom * 100) + '%'; }

/* ─── 바꾸기 (내가 한 것 → 저장 · 되돌리기) ─── */
/** 바뀐 것을 CB.a 에 — 같은 것을 두 번 받아도 그대로(표시 id 기준) */
function _cbApplyOp(op) {
  var a = CB.a;
  if (op.clear) a.shapes = [];
  if (op.remove && op.remove.length) a.shapes = a.shapes.filter(function (s) { return op.remove.indexOf(s.id) < 0; });
  if (op.add) op.add.forEach(function (s) { a.shapes = a.shapes.filter(function (x) { return x.id !== s.id; }); a.shapes.push(s); });
  if ('rot' in op) a.rot = op.rot;
  if ('crop' in op) a.crop = op.crop;
  CB.rev = (CB.rev || 0) + 1;
}
function _cbDo(op, fromUndo) {
  _cbApplyOp(op);
  if (!fromUndo) { CB.redo = []; }
  if (CB.fid) _cbCursor({ op: op, live: null }, true);   // v13.373 같이 보는 사람에게 바로 (저장은 뒤에서)
  _cbSave(op);
  _cbInfo();
  if ('rot' in op) { if (!CB.my) _cbFit(); _cbAngUi(); }
  _cbDraw();
}
function _cbInverse(op, before) {
  var inv = {};
  if (op.add) inv.remove = op.add.map(function (s) { return s.id; });
  if (op.remove) inv.add = before.shapes.filter(function (s) { return op.remove.indexOf(s.id) >= 0; });
  if ('rot' in op) inv.rot = before.rot || 0;
  if ('crop' in op) inv.crop = before.crop || null;
  return inv;
}
function _cbCommit(op) {
  var before = { shapes: CB.a.shapes.slice(), rot: CB.a.rot, crop: CB.a.crop };
  CB.undo.push({ op: op, inv: _cbInverse(op, before) });
  if (CB.undo.length > 100) CB.undo.shift();
  _cbDo(op);
}
function _cbUndo(redo) {
  var st = redo ? CB.redo : CB.undo, it = st.pop(); if (!it) return;
  (redo ? CB.undo : CB.redo).push(it);
  _cbDo(redo ? it.op : it.inv, true);
}
function _cbSave(op) {
  if (!CB.fid) return;   // 보내기 전(초안) — 보낼 때 같이 저장
  var body = {};
  if (op.add) body.add = op.add;
  if (op.remove) body.remove = op.remove;
  if ('rot' in op) body.rot = op.rot;
  if ('crop' in op) body.crop = op.crop;
  if (op.clear) body.clear = true;
  CB.saving = (CB.saving || 0) + 1; _cbInfo();
  apiFetch('/api/chat/files/' + encodeURIComponent(CB.fid) + '/annot', { method: 'POST', body: JSON.stringify(body) })
    .catch(function (e) { _cbToast((e && e.data && e.data.message) || '표시를 저장하지 못했습니다', 'error'); })
    .then(function () { if (CB) { CB.saving--; _cbInfo(); } });
}

/* ─── 열기 ─── */
function _cbShell(title) {
  var ov = document.createElement('div');
  ov.className = 'cb'; ov.id = 'cbBoard'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', '사진 칠판');
  // v13.437 화면 전체 확대 막기 — 두 손가락 벌리기는 사진만 키움(도구 줄 · 확대 단추는 그대로). 아이폰 사파리는 touch-action 만으로는
  //   새는 일이 있어 gesture* · 두 손가락 touchmove 도 막음 (사진 위 벌리기는 pointer 이벤트로 따로 처리 — _cbZoomAt)
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) { ov.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false }); });
  ov.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1 && e.cancelable) e.preventDefault(); }, { passive: false });
  ov.innerHTML =
    '<div class="cb-top">' +
      '<div class="cb-ttl"><b data-title></b><i data-info></i></div>' +
      '<div class="cb-seg" role="tablist"><button type="button" data-mode="orig" title="원본 그대로 (Tab)">원본</button><button type="button" data-mode="mark" title="표시한 모습 (Tab)">✏️ 표시 보기</button></div>' +
      '<div class="cb-peers" data-peers></div>' +
      '<div class="cb-acts">' +
        '<button type="button" data-a="copy" title="복사 — 지금 보이는 모습 (Ctrl+C)">📋<span>복사</span></button>' +
        '<button type="button" data-a="share" title="표시한 그림을 새 사진으로 보내기">📤<span>새 사진으로</span></button>' +
        '<button type="button" data-a="dl" title="표시한 그림 받기">⬇<span>받기</span></button>' +
        '<button type="button" class="cb-send" data-a="send" hidden>➤ 보내기</button>' +
        '<button type="button" class="cb-x" data-a="close" title="닫기 (Esc)">✕</button>' +
      '</div>' +
    '</div>' +
    '<div class="cb-stage"><canvas></canvas><div class="cb-hint" data-hint hidden></div><div class="cb-loading" data-loading>사진 불러오는 중…</div>' +
      '<button type="button" class="cb-nav cb-prev" data-a="prev" title="이전 사진 (←)" hidden>‹</button><button type="button" class="cb-nav cb-next" data-a="next" title="다음 사진 (→)" hidden>›</button><span class="cb-pos" data-pos hidden></span>' +
      '<div class="cb-ang" data-ang hidden>' +
        '<div class="cb-ang-r"><button type="button" data-a="fine-" title="왼쪽으로 1° (,) · Shift 는 0.1°">−1°</button><input type="range" min="-45" max="45" step="0.1" value="0" data-fine aria-label="비스듬히 바로잡기 각도"><button type="button" data-a="fine+" title="오른쪽으로 1° (.) · Shift 는 0.1°">+1°</button><output data-angv>0°</output></div>' +
        '<div class="cb-ang-b"><button type="button" data-a="level" title="사진 속 수평(또는 수직)이어야 할 선을 따라 끌면 그만큼 바로잡음 (L)">📏 수평 맞추기</button>' +
        '<button type="button" data-a="fill" title="비스듬히 돌렸을 때 생기는 빈 모서리를 잘라 화면을 채움">⬚ 빈 모서리 채우기</button>' +
        '<button type="button" data-a="rotshare" title="방 사람 모두 이 각도로 보게 (같이 쓰는 회전)">👥 모두에게 이렇게</button>' +
        '<button type="button" data-a="rot0" title="내가 돌린 것을 지우고 처음 모습으로">↺ 원래대로</button></div>' +
        '<i data-angwho></i>' +
      '</div></div>' +
    '<div class="cb-bar">' +
      '<div class="cb-tools">' + CB_TOOLS.map(function (t) { return '<button type="button" data-tool="' + t[0] + '" title="' + _cbE(t[2]) + ' (' + t[3] + ')"><span>' + t[1] + '</span></button>'; }).join('') + '</div>' +
      '<div class="cb-sep"></div>' +
      '<div class="cb-colors">' + CB_COLORS.map(function (c) { return '<button type="button" data-color="' + c + '" style="--c:' + c + '" title="색"></button>'; }).join('') + '</div>' +
      '<div class="cb-widths"><button type="button" data-w="2" title="가늘게"><i style="height:2px"></i></button><button type="button" data-w="4" title="보통"><i style="height:4px"></i></button><button type="button" data-w="8" title="굵게"><i style="height:7px"></i></button></div>' +
      '<div class="cb-sep"></div>' +
      '<div class="cb-view">' +
        '<button type="button" data-a="undo" title="되돌리기 (Ctrl+Z)">↶</button><button type="button" data-a="redo" title="다시 (Ctrl+Y)">↷</button>' +
        '<button type="button" data-a="rotl" title="왼쪽으로 90° — 내 화면에만 · 저장됨 ([)">⟲</button><button type="button" data-a="rotr" title="오른쪽으로 90° — 내 화면에만 · 저장됨 (])">⟳</button>' +
        '<button type="button" data-a="angle" title="📐 비스듬히 바로잡기 · 수평 맞추기 · 모두에게">📐</button>' +
        '<button type="button" data-a="zout" title="작게 (-)">−</button><button type="button" class="cb-zl" data-a="fit" data-zl title="화면에 맞추기 (0)">100%</button><button type="button" data-a="zin" title="크게 (+)">＋</button>' +
        '<button type="button" data-a="clear" title="표시 모두 지우기">🗑</button>' +
      '</div>' +
    '</div>';
  ov.querySelector('[data-title]').textContent = title || '사진';
  ov.tabIndex = -1;
  document.body.appendChild(ov);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // 뒤 입력칸에 글자가 들어가지 않게
  ov.focus({ preventScroll: true });
  return ov;
}
function _cbStart(o) {
  if (CB) chatBoardClose();
  var ov = _cbShell(o.name);
  CB = { el: ov, cv: ov.querySelector('canvas'), fid: o.fid || null, room: o.roomId, name: o.name || 'image.png', draftFile: o.file || null, replyTo: o.replyTo || null,
    a: { rot: 0, crop: null, shapes: [] }, mode: 'mark', tool: o.tool || 'pen', color: '#EF4444', wSel: 4, zoom: 1, panX: 0, panY: 0,
    undo: [], redo: [], peers: {}, dpr: window.devicePixelRatio || 1, ptrs: {}, by: '', at: null, my: null, fill: false };
  try { var pref = JSON.parse(localStorage.getItem('cb-pref') || '{}'); if (pref.color) CB.color = pref.color; if (pref.w) CB.wSel = pref.w; } catch (_) {}
  if (o.fid) ov.classList.add('is-file'); else { ov.classList.add('is-draft'); ov.querySelector('[data-a="send"]').hidden = false; }
  _cbBind();
  _cbResize();
  _cbSyncUi();
  try { if (localStorage.getItem('cb-ang') === '1') ov.querySelector('[data-ang]').hidden = false; } catch (_) {}
  return ov;
}
/** 대화방 사진 열기 — 원본 · 표시 보기 · 같이 그리기 */
function chatBoardOpen(fid, name, roomId) {
  _cbStart({ fid: fid, name: name, roomId: roomId || (typeof CX !== 'undefined' && CX.room), tool: 'pan' });
  var my = CB;
  Promise.all([
    _cbFileImg(fid),
    apiFetch('/api/chat/files/' + encodeURIComponent(fid) + '/annot').catch(function () { return null; })
  ]).then(function (r) {
    if (CB !== my) return;
    var an = r[1] && r[1].data;
    if (an) { CB.a = { rot: an.rot || 0, crop: an.crop || null, shapes: an.shapes || [] }; CB.rev = (CB.rev || 0) + 1; CB.by = r[1].byName || ''; CB.at = r[1].at; }
    var mine = r[1] ? r[1].mine : (_cbViews && _cbViews[fid]) || null;   // v13.409 내가 돌려 둔 각도
    CB.my = mine ? { a: +mine.a || 0, f: !!mine.f } : null; CB.fill = !!(mine && mine.f);
    if (_cbViews) { if (CB.my) _cbViews[fid] = CB.my; else delete _cbViews[fid]; }
    _cbReady(r[0]);
  }).catch(function (e) { if (CB === my) { CB.el.querySelector('[data-loading]').textContent = (e && e.message) || '사진을 불러오지 못했습니다'; } });
  _cbNavLoad(my);
  return true;
}
/* ◀ ▶ 그 방 사진 넘겨 보기 (v13.409) — 오래된 것 → 새 것 순서. 열 때마다 새로 받고, 넘길 때는 받아 둔 목록을 그대로 */
var _cbNavKeep = null;
function _cbNavLoad(my) {
  if (!my.room || !my.fid || typeof apiFetch !== 'function') return;
  var keep = _cbNavKeep && _cbNavKeep.room === my.room ? _cbNavKeep.list : null; _cbNavKeep = null;
  var p = keep ? Promise.resolve(keep) : apiFetch('/api/chat/rooms/' + encodeURIComponent(my.room) + '/files').then(function (r) {
    return ((r && r.data) || []).filter(function (f) { return _cbIsImg(f.mime); }).reverse().map(function (f) { return { id: f.id, name: f.name }; });
  });
  p.then(function (list) {
    if (CB !== my) return;
    var i = list.map(function (f) { return f.id; }).indexOf(my.fid);
    if (i < 0 || list.length < 2) return;
    my.list = list; my.idx = i;
    var pv = my.el.querySelector('[data-a="prev"]'), nx = my.el.querySelector('[data-a="next"]'), pos = my.el.querySelector('[data-pos]');
    pv.hidden = nx.hidden = pos.hidden = false; pv.disabled = i === 0; nx.disabled = i === list.length - 1;
    pos.textContent = (i + 1) + ' / ' + list.length;
  }).catch(function () {});
}
function _cbNav(d) {
  if (!CB || !CB.list || CB.textEl) return;
  var n = CB.list[CB.idx + d]; if (!n) return;
  var room = CB.room, mode = CB.mode;
  _cbNavKeep = { room: room, list: CB.list };
  chatBoardOpen(n.id, n.name, room);
  if (CB) { CB.mode = mode; _cbSyncUi(); }
}
/** 보내기 전 — 붙여넣은 사진 · 캡처 */
function chatBoardDraft(file, opt) {
  opt = opt || {};
  _cbStart({ file: file, name: file.name || ('image-' + new Date().toISOString().slice(0, 19).replace(/\D/g, '') + '.png'), roomId: typeof CX !== 'undefined' ? CX.room : null, replyTo: opt.replyTo, tool: opt.tool || 'pen' });
  var my = CB;
  _cbLoadImg(URL.createObjectURL(file)).then(function (img) {
    if (CB !== my) return;
    _cbReady(img);
    if (opt.hint) _cbHint(opt.hint);
  }).catch(function (e) { _cbToast(e.message, 'error'); chatBoardClose(); });
}
function _cbReady(img) {
  CB.img = img; CB.W = img.naturalWidth; CB.H = img.naturalHeight;
  CB.el.querySelector('[data-loading]').remove();
  CB.el.classList.add('ready');
  _cbFit(); _cbInfo(); _cbSyncUi(); _cbAngUi();
}
function chatBoardClose() {
  if (!CB) return;
  if (CB.fid && CB.room) _cbCursor({ bye: true }, true);
  if (CB.textEl) CB.textEl.remove();
  CB.el.remove();
  document.removeEventListener('keydown', _cbKey, true);
  window.removeEventListener('resize', _cbResize);
  CB = null;
}

/* ─── 화면 상태 ─── */
function _cbSyncUi() {
  var el = CB.el;
  el.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === CB.mode); });
  el.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === CB.tool); });
  el.querySelectorAll('[data-color]').forEach(function (b) { b.classList.toggle('on', b.dataset.color === CB.color); });
  el.querySelectorAll('[data-w]').forEach(function (b) { b.classList.toggle('on', +b.dataset.w === CB.wSel); });
  el.classList.toggle('orig', CB.mode === 'orig');
  el.dataset.tool = CB.tool;
  var u = el.querySelector('[data-a="undo"]'), r = el.querySelector('[data-a="redo"]');
  if (u) u.disabled = !CB.undo.length; if (r) r.disabled = !CB.redo.length;
}
function _cbInfo() {
  if (!CB) return;
  var i = CB.el.querySelector('[data-info]'); if (!i) return;
  var n = CB.a.shapes.length, bits = [];
  if (CB.W) bits.push(CB.W + '×' + CB.H);
  if (n) bits.push('표시 ' + n);
  if (CB.a.crop) bits.push('잘림');
  if (CB.fid && CB.my) bits.push('나만 ' + _cbDeg(CB.my.a) + '° 돌려 봄');
  else if (CB.a.rot) bits.push(_cbDeg(CB.a.rot) + '° 돌림' + (CB.fid ? '(모두)' : ''));
  if (CB.saving) bits.push('저장 중…');
  else if (CB.by && CB.fid) bits.push('마지막 ' + CB.by);
  if (!CB.fid) bits.push('보내기 전 — 원본과 표시가 같이 갑니다');
  i.textContent = bits.join(' · ');
  _cbSyncUi();
}
function _cbHint(t, ms) {
  var h = CB && CB.el.querySelector('[data-hint]'); if (!h) return;
  h.textContent = t; h.hidden = false;
  clearTimeout(CB.hintT); CB.hintT = setTimeout(function () { if (h) h.hidden = true; }, ms || 3500);
}
function _cbResize() {
  if (!CB) return;
  var st = CB.cv.parentNode, w = st.clientWidth, h = st.clientHeight;
  CB.dpr = window.devicePixelRatio || 1;
  CB.cv.width = Math.round(w * CB.dpr); CB.cv.height = Math.round(h * CB.dpr);
  CB.cv.style.width = w + 'px'; CB.cv.style.height = h + 'px';
  if (CB.img) _cbFit();
}
function _cbSetTool(t) {
  if (!CB) return;
  if (CB.textEl) _cbTextDone();
  var was = CB.tool;
  CB.tool = t; CB.cropSel = null; _cbCropMenu(false);
  if (t !== 'pan' && t !== 'crop' && t !== 'level' && CB.mode === 'orig') CB.mode = 'mark';
  if (t === 'crop') { CB.mode = 'mark'; _cbFit(); _cbHint(_cbSkew(_cbAng()) ? '비스듬히 돌린 모습 그대로 고르세요 — 잘라서 복사 · 보내기' : '잘라낼 곳을 끌어 고르세요 — 원본은 그대로 남습니다'); }
  else if (was === 'crop' && _cbFill()) _cbFit();
  if (t === 'level') _cbHint('📏 사진 속 수평(또는 수직)이어야 할 선을 따라 끌어 주세요', 5000);
  var lb = CB.el.querySelector('[data-a="level"]'); if (lb) lb.classList.toggle('on', t === 'level');
  _cbSyncUi(); _cbDraw();
}

/* ─── 입력 ─── */
function _cbPt(e) { var r = CB.cv.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
// 굵기 · 글자 크기는 '지금 화면에서 보이는 크기' 기준 → 사진 픽셀로 (크게 확대하면 가늘게 정밀하게)
function _cbW() { return Math.max(0.5, Math.round(CB.wSel * 1.6 / CB.zoom * 10) / 10); }
function _cbBind() {
  var el = CB.el, cv = CB.cv;
  el.addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b || !CB) return;
    if (b.dataset.mode) { CB.mode = b.dataset.mode; if (CB.mode === 'orig' && CB.tool !== 'pan') CB.tool = 'pan'; _cbFit(); _cbSyncUi(); return; }
    if (b.dataset.tool) return _cbSetTool(b.dataset.tool);
    if (b.dataset.color) { CB.color = b.dataset.color; _cbPref(); _cbSyncUi(); if (CB.tool === 'pan' || CB.tool === 'erase' || CB.tool === 'crop') _cbSetTool('pen'); return; }
    if (b.dataset.w) { CB.wSel = +b.dataset.w; _cbPref(); _cbSyncUi(); return; }
    if (b.dataset.cm) return _cbCropAct(b.dataset.cm);
    var a = b.dataset.a; if (!a) return;
    if (a === 'close') chatBoardClose();
    else if (a === 'undo') _cbUndo(false);
    else if (a === 'redo') _cbUndo(true);
    else if (a === 'rotl' || a === 'rotr') _cbTurn(a === 'rotr' ? 90 : -90);
    else if (a === 'fine-' || a === 'fine+') _cbTurn((a === 'fine+' ? 1 : -1) * (e.shiftKey ? 0.1 : 1));
    else if (a === 'angle') _cbAngToggle();
    else if (a === 'level') _cbSetTool(CB.tool === 'level' ? 'pan' : 'level');
    else if (a === 'fill') _cbFillToggle();
    else if (a === 'rotshare') _cbRotShare();
    else if (a === 'rot0') _cbRotReset();
    else if (a === 'prev' || a === 'next') _cbNav(a === 'next' ? 1 : -1);
    else if (a === 'zin' || a === 'zout') _cbZoomAt(a === 'zin' ? 1.25 : 0.8, cv.clientWidth / 2, cv.clientHeight / 2);
    else if (a === 'fit') { if (Math.abs(CB.zoom - 1) < 0.01) _cbFit(); else _cbZoomAt(1 / CB.zoom, cv.clientWidth / 2, cv.clientHeight / 2); }
    else if (a === 'clear') { if (!CB.a.shapes.length) return; if (!(await wmConfirm('표시 ' + CB.a.shapes.length + '개를 모두 지울까요? (되돌리기 가능)'))) return; _cbCommit({ remove: CB.a.shapes.map(function (s) { return s.id; }) }); }
    else if (a === 'copy') _cbCopy();
    else if (a === 'dl') _cbDownload();
    else if (a === 'share') _cbShareNew();
    else if (a === 'send') _cbSendDraft();
  });
  var fine = el.querySelector('[data-fine]');
  fine.addEventListener('input', function () { var A = _cbAng(), base = Math.round(A / 90) * 90; _cbTurn(base + (+fine.value || 0), true); });
  fine.addEventListener('keydown', function (e) { if (e.key === 'Escape') fine.blur(); });
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = _cbPt(e);
    if (e.ctrlKey || e.metaKey || !e.shiftKey) _cbZoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p.sx, p.sy);
    else { CB.panX -= e.deltaY; _cbDraw(); }
  }, { passive: false });
  cv.addEventListener('dblclick', function (e) { if (CB.tool === 'pan') { var p = _cbPt(e); if (CB.zoom < 1.5) _cbZoomAt(2, p.sx, p.sy); else _cbFit(); } });
  cv.addEventListener('pointerdown', _cbDown);
  cv.addEventListener('pointermove', _cbMove);
  cv.addEventListener('pointerup', _cbUp);
  cv.addEventListener('pointercancel', _cbUp);
  cv.addEventListener('pointerleave', function () { if (CB && CB.fid) _cbCursor({ x: null }); });
  document.addEventListener('keydown', _cbKey, true);
  window.addEventListener('resize', _cbResize);
}
function _cbPref() { try { localStorage.setItem('cb-pref', JSON.stringify({ color: CB.color, w: CB.wSel })); } catch (_) {} }
function _cbKey(e) {
  if (!CB) return;
  if (CB.textEl && e.target === CB.textEl) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && CB.el.contains(e.target)) return;   // 칠판 안 입력칸만 (뒤 대화 입력칸에 초점이 남아 있어도 칠판 단축키는 됨)
  var k = e.key, mod = e.ctrlKey || e.metaKey;
  if (k === 'Escape' && CB.tool === 'level') { e.preventDefault(); e.stopPropagation(); CB.lvl = null; _cbSetTool('pan'); return; }
  if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); if (CB.tool === 'crop' && CB.cropSel) { CB.cropSel = null; _cbCropMenu(false); _cbDraw(); } else chatBoardClose(); return; }
  if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); _cbUndo(e.shiftKey); return; }
  if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); _cbUndo(true); return; }
  if (mod && (k === 'c' || k === 'C')) { e.preventDefault(); _cbCopy(); return; }
  if (mod && k === 'Enter' && !CB.fid) { e.preventDefault(); _cbSendDraft(); return; }
  if (mod) return;
  if (k === ' ') { e.preventDefault(); CB.space = true; CB.cv.style.cursor = 'grab'; document.addEventListener('keyup', function up(ev) { if (ev.key === ' ') { if (CB) { CB.space = false; CB.cv.style.cursor = ''; } document.removeEventListener('keyup', up); } }); return; }
  if (k === 'Tab') { e.preventDefault(); CB.mode = CB.mode === 'orig' ? 'mark' : 'orig'; _cbFit(); _cbSyncUi(); return; }
  if (k === '0') { _cbFit(); return; }
  if (k === '+' || k === '=') { _cbZoomAt(1.25, CB.cv.clientWidth / 2, CB.cv.clientHeight / 2); return; }
  if (k === '-') { _cbZoomAt(0.8, CB.cv.clientWidth / 2, CB.cv.clientHeight / 2); return; }
  if (k === '[' || k === ']') { _cbTurn(k === ']' ? 90 : -90); return; }
  if (e.code === 'Comma' || e.code === 'Period') { e.preventDefault(); _cbTurn((e.code === 'Period' ? 1 : -1) * (e.shiftKey ? 0.1 : 1)); return; }
  if (k === 'l' || k === 'L') { e.preventDefault(); _cbSetTool(CB.tool === 'level' ? 'pan' : 'level'); return; }
  if ((k === 'ArrowLeft' || k === 'ArrowRight') && CB.list) { e.preventDefault(); _cbNav(k === 'ArrowRight' ? 1 : -1); return; }
  if (k === 'Enter' && !CB.fid) { e.preventDefault(); _cbSendDraft(); return; }
  if ((k === 'Delete' || k === 'Backspace') && CB.cropSel) return;
  var t = CB_KEYS[k.toLowerCase()]; if (t) { e.preventDefault(); _cbSetTool(t); }
}
function _cbDown(e) {
  if (!CB || !CB.img) return;
  var cv = CB.cv; cv.setPointerCapture(e.pointerId);
  var p = _cbPt(e);
  CB.ptrs[e.pointerId] = p;
  var ids = Object.keys(CB.ptrs);
  if (ids.length === 2) {   // 두 손가락 — 확대 · 옮기기
    CB.draft = null; CB.drag = null;
    var a = CB.ptrs[ids[0]], b = CB.ptrs[ids[1]];
    CB.pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), cx: (a.sx + b.sx) / 2, cy: (a.sy + b.sy) / 2 };
    _cbDraw(); return;
  }
  if (CB.textEl) { _cbTextDone(); return; }
  var tool = (CB.space || e.button === 1 || (CB.mode === 'orig' && CB.tool !== 'level')) ? 'pan' : CB.tool;
  var ip = _cbToImg(p.sx, p.sy);
  CB.drag = { tool: tool, sx: p.sx, sy: p.sy, px: CB.panX, py: CB.panY, ix: ip.x, iy: ip.y, rx: (p.sx - CB.panX) / CB.zoom, ry: (p.sy - CB.panY) / CB.zoom };
  if (tool === 'pan') { cv.style.cursor = 'grabbing'; return; }
  if (tool === 'level') { CB.lvl = { x1: p.sx, y1: p.sy, x2: p.sx, y2: p.sy }; _cbDraw(); return; }
  if (tool === 'erase') { _cbErase(ip); return; }
  if (tool === 'text') { CB.drag = null; _cbText(ip, p); return; }
  if (tool === 'crop') { CB.cropSel = null; _cbCropMenu(false); return; }
  var w = _cbW();
  if (tool === 'pen' || tool === 'hl') CB.draft = { id: _cbId(), t: tool, c: CB.color, w: w, p: [r1(ip.x), r1(ip.y)] };
  else CB.draft = { id: _cbId(), t: tool, c: CB.color, w: w, x: ip.x, y: ip.y, x2: ip.x, y2: ip.y };
  _cbDraw();
  function r1(v) { return Math.round(v * 10) / 10; }
}
function _cbMove(e) {
  if (!CB || !CB.img) return;
  var p = _cbPt(e);
  if (CB.ptrs[e.pointerId]) CB.ptrs[e.pointerId] = p;
  if (CB.pinch) {
    var ids = Object.keys(CB.ptrs); if (ids.length < 2) return;
    var a = CB.ptrs[ids[0]], b = CB.ptrs[ids[1]], d = Math.hypot(a.sx - b.sx, a.sy - b.sy), cx = (a.sx + b.sx) / 2, cy = (a.sy + b.sy) / 2;
    CB.panX += cx - CB.pinch.cx; CB.panY += cy - CB.pinch.cy;
    _cbZoomAt(d / (CB.pinch.d || d), cx, cy);
    CB.pinch = { d: d, cx: cx, cy: cy };
    return;
  }
  var ip = _cbToImg(p.sx, p.sy), d0 = CB.drag;
  if (CB.fid) _cbCursor({ x: ip.x, y: ip.y, live: CB.draft });
  if (!d0) return;
  if (d0.tool === 'pan') { CB.panX = d0.px + p.sx - d0.sx; CB.panY = d0.py + p.sy - d0.sy; _cbDraw(); return; }
  if (d0.tool === 'erase') { _cbErase(ip); return; }
  if (d0.tool === 'level') { CB.lvl.x2 = p.sx; CB.lvl.y2 = p.sy; _cbDraw(); return; }
  if (d0.tool === 'crop' && _cbSkew(_cbAng())) {   // v13.409 비스듬히 — 돌린 공간에서 고름
    var FB = _cbBoxOf({ x: 0, y: 0, w: CB.W, h: CB.H }, _cbRotM(_cbAng(), CB.W, CB.H));
    var rx = (p.sx - CB.panX) / CB.zoom, ry = (p.sy - CB.panY) / CB.zoom;
    var a1 = clamp(Math.min(d0.rx, rx), FB.x, FB.x + FB.w), b1 = clamp(Math.min(d0.ry, ry), FB.y, FB.y + FB.h), a2 = clamp(Math.max(d0.rx, rx), FB.x, FB.x + FB.w), b2 = clamp(Math.max(d0.ry, ry), FB.y, FB.y + FB.h);
    CB.cropSel = { x: Math.round(a1), y: Math.round(b1), w: Math.round(a2 - a1), h: Math.round(b2 - b1), v: 1 };
    _cbDraw(); return;
  }
  if (d0.tool === 'crop') {
    var x1 = clamp(Math.min(d0.ix, ip.x), 0, CB.W), y1 = clamp(Math.min(d0.iy, ip.y), 0, CB.H), x2 = clamp(Math.max(d0.ix, ip.x), 0, CB.W), y2 = clamp(Math.max(d0.iy, ip.y), 0, CB.H);
    CB.cropSel = { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
    _cbDraw(); return;
  }
  var s = CB.draft; if (!s) return;
  if (s.p) {
    var lx = s.p[s.p.length - 2], ly = s.p[s.p.length - 1];
    if (Math.hypot(ip.x - lx, ip.y - ly) * CB.zoom >= 1.5) s.p.push(Math.round(ip.x * 10) / 10, Math.round(ip.y * 10) / 10);
  } else {
    s.x2 = ip.x; s.y2 = ip.y;
    if (e.shiftKey && (s.t === 'rect' || s.t === 'ellipse')) { var m = Math.max(Math.abs(s.x2 - s.x), Math.abs(s.y2 - s.y)); s.x2 = s.x + m * Math.sign(s.x2 - s.x || 1); s.y2 = s.y + m * Math.sign(s.y2 - s.y || 1); }
  }
  _cbDraw();
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
}
function _cbUp(e) {
  if (!CB) return;
  delete CB.ptrs[e.pointerId];
  if (CB.pinch) { if (Object.keys(CB.ptrs).length < 2) CB.pinch = null; return; }
  var d0 = CB.drag; CB.drag = null; CB.cv.style.cursor = '';
  if (!d0) return;
  if (d0.tool === 'level') {
    var L = CB.lvl; CB.lvl = null;
    if (L && Math.hypot(L.x2 - L.x1, L.y2 - L.y1) > 24) { var dl = _cbLvlDelta(L); _cbSetTool('pan'); if (Math.abs(dl) >= 0.05) { _cbTurn(dl); _cbHint('📏 ' + _cbDeg(Math.abs(dl)) + '° 바로잡았습니다' + (CB.fid ? ' — 내 화면에만' : '')); } }
    else _cbDraw();
    return;
  }
  if (d0.tool === 'crop') { if (CB.cropSel && CB.cropSel.w > 4 && CB.cropSel.h > 4) _cbCropMenu(true); else { CB.cropSel = null; _cbDraw(); } return; }
  var s = CB.draft; CB.draft = null;
  if (!s) return;
  var ok = s.p ? s.p.length >= 2 : Math.hypot(s.x2 - s.x, s.y2 - s.y) * CB.zoom > 4;
  if (!ok) { _cbDraw(); return; }
  if (!s.p) { s.x = r1(s.x); s.y = r1(s.y); s.x2 = r1(s.x2); s.y2 = r1(s.y2); }
  s.by = _cbMe();
  CB.liveSent = null;
  _cbCommit({ add: [s] });   // _cbDo 가 op + live:null 을 바로 보냄
  function r1(v) { return Math.round(v * 10) / 10; }
}
/* 지우개 — 누른 곳의 맨 위 표시 */
function _cbHit(s, p) {
  var tol = Math.max(6 / CB.zoom, (s.w || 4) * (s.t === 'hl' ? 2 : 0.8));
  if (s.p) { for (var i = 0; i < s.p.length - 2; i += 2) if (_cbSeg(p, s.p[i], s.p[i + 1], s.p[i + 2], s.p[i + 3]) < tol) return true; return s.p.length === 2 && Math.hypot(p.x - s.p[0], p.y - s.p[1]) < tol; }
  if (s.t === 'line' || s.t === 'arrow') return _cbSeg(p, s.x, s.y, s.x2, s.y2) < tol;
  if (s.t === 'text') { var lines = String(s.s).split('\n'), fs = s.fs || 32, w = Math.max.apply(null, lines.map(function (l) { return l.length; })) * fs * 0.9; return p.x >= s.x && p.x <= s.x + w && p.y >= s.y && p.y <= s.y + lines.length * fs * 1.25; }
  var r = _cbNorm(s);
  if (s.t === 'blur' || s.t === 'box' || s.fill) return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  if (s.t === 'ellipse') { var nx = (p.x - r.x - r.w / 2) / (r.w / 2), ny = (p.y - r.y - r.h / 2) / (r.h / 2), dd = Math.sqrt(nx * nx + ny * ny); return Math.abs(dd - 1) * Math.min(r.w, r.h) / 2 < tol; }
  return (Math.abs(p.x - r.x) < tol || Math.abs(p.x - r.x - r.w) < tol) && p.y > r.y - tol && p.y < r.y + r.h + tol || (Math.abs(p.y - r.y) < tol || Math.abs(p.y - r.y - r.h) < tol) && p.x > r.x - tol && p.x < r.x + r.w + tol;
}
function _cbSeg(p, x1, y1, x2, y2) {
  var dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / l)) : 0;
  return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
}
function _cbErase(p) {
  for (var i = CB.a.shapes.length - 1; i >= 0; i--) { if (_cbHit(CB.a.shapes[i], p)) { _cbCommit({ remove: [CB.a.shapes[i].id] }); return; } }
}
/* 글자 — 누른 곳에 바로 쓰기 (Enter 넣기 · Shift+Enter 줄바꿈 · Esc 그만) */
function _cbText(ip, sp) {
  var ta = document.createElement('textarea');
  ta.className = 'cb-text'; ta.rows = 1; ta.placeholder = '글자 입력 · Enter';
  var fs = (CB.wSel === 2 ? 18 : CB.wSel === 8 ? 40 : 26) / CB.zoom;
  ta.style.left = sp.sx + 'px'; ta.style.top = sp.sy + 'px'; ta.style.color = CB.color;
  ta.style.fontSize = Math.max(12, fs * CB.zoom) + 'px';
  ta.style.lineHeight = '1.25';
  CB.el.querySelector('.cb-stage').appendChild(ta);
  CB.textEl = ta; CB.textAt = { x: ip.x, y: ip.y, fs: fs, c: CB.color };
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); _cbTextDone(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ta.value = ''; _cbTextDone(); }
  });
  ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; ta.style.width = 'auto'; ta.style.width = Math.max(120, ta.scrollWidth + 8) + 'px'; });
  ta.addEventListener('blur', function () { setTimeout(function () { if (CB && CB.textEl === ta) _cbTextDone(); }, 0); });
  setTimeout(function () { ta.focus(); }, 0);
}
function _cbTextDone() {
  var ta = CB.textEl; if (!ta) return;
  CB.textEl = null;
  var v = ta.value.replace(/\s+$/, ''), at = CB.textAt;
  ta.remove();
  if (v) _cbCommit({ add: [{ id: _cbId(), t: 'text', c: at.c, w: 2, x: Math.round(at.x), y: Math.round(at.y), x2: 0, y2: 0, s: v, fs: Math.round(at.fs), by: _cbMe() }] });
}

/* ─── 자르기 메뉴 ─── */
function _cbCropMenu(show) {
  var old = CB.el.querySelector('.cb-cm'); if (old) old.remove();
  if (!show) return;
  var m = document.createElement('div'); m.className = 'cb-cm';
  m.innerHTML = '<b>' + CB.cropSel.w + '×' + CB.cropSel.h + '</b>' +
    (CB.cropSel.v ? '' : '<button type="button" data-cm="apply" title="원본은 그대로 · 표시 보기에서 이 부분만">✂️ 이대로 자르기</button>') +
    '<button type="button" data-cm="copy" title="클립보드로 — 어디든 붙여넣기">📋 잘라서 복사</button>' +
    (CB.room ? '<button type="button" data-cm="send" title="이 부분만 새 사진으로 대화방에">📤 잘라서 보내기</button>' : '') +
    (CB.a.crop ? '<button type="button" data-cm="reset">↺ 자르기 풀기</button>' : '') +
    '<button type="button" data-cm="cancel">취소</button>';
  CB.el.querySelector('.cb-stage').appendChild(m);
}
function _cbCropAct(k) {
  var sel = CB.cropSel;
  if (k === 'cancel') { CB.cropSel = null; _cbCropMenu(false); _cbDraw(); return; }
  if (k === 'reset') { _cbCommit({ crop: null }); CB.cropSel = null; _cbCropMenu(false); _cbSetTool('pan'); _cbFit(); return; }
  if (!sel) return;
  if (k === 'apply') { _cbCommit({ crop: sel }); CB.cropSel = null; _cbCropMenu(false); CB.tool = 'pan'; _cbSyncUi(); _cbFit(); _cbHint('잘랐습니다 — 원본 보기에서 전체를 볼 수 있어요'); return; }
  var c = _cbCropCanvas(sel);
  if (k === 'copy') _cbClip(c, '잘라서 복사했습니다 — 붙여넣기(Ctrl+V)');
  if (k === 'send') _cbBlob(c).then(function (b) { return _cbUploadBlob(b, _cbBase() + '-부분.png'); }).then(function () { _cbToast('📤 잘라서 보냈습니다', 'success'); });
}

/* ─── 복사 · 받기 · 보내기 ─── */
function _cbBase() { return String(CB.name || 'image').replace(/\.[A-Za-z0-9]{1,6}$/, ''); }
function _cbView() { return _cbFlatten(CB.img, CB.mode === 'orig' ? { rot: _cbAng(), shapes: [] } : _cbVA(), { marks: CB.mode !== 'orig', fill: _cbFill() }); }
/** 고른 부분 — 보통은 사진 픽셀 기준, 비스듬히 본 채로 고른 것(v)은 돌린 공간 기준 */
function _cbCropCanvas(sel) {
  if (sel.v) return _cbFlatten(CB.img, _cbVA(), { vsel: sel, area: { x: 0, y: 0, w: CB.W, h: CB.H } });
  return _cbFlatten(CB.img, _cbVA(), { area: sel });
}
function _cbClip(canvas, msg) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') { _cbToast('이 브라우저는 그림 복사를 지원하지 않습니다 — ⬇ 받기를 쓰세요', 'warn'); return; }
  navigator.clipboard.write([new ClipboardItem({ 'image/png': _cbBlob(canvas) })])
    .then(function () { _cbToast(msg || '📋 복사했습니다 — 붙여넣기(Ctrl+V)', 'success'); })
    .catch(function () { _cbToast('복사하지 못했습니다', 'error'); });
}
function _cbCopy() { if (CB && CB.img) _cbClip(CB.cropSel ? _cbCropCanvas(CB.cropSel) : _cbView()); }
function _cbDownload() {
  _cbBlob(_cbView()).then(function (b) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = _cbBase() + (CB.mode === 'orig' ? '' : '-표시') + '.png';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  });
}
function _cbUploadBlob(blob, name, replyTo) {
  var room = CB && CB.room;
  if (!room) return Promise.reject(new Error('대화방이 없습니다'));
  return new Promise(function (ok, no) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', _cbApi() + '/api/chat/rooms/' + encodeURIComponent(room) + '/files?name=' + encodeURIComponent(name) + (replyTo ? '&replyTo=' + replyTo : ''));
    xhr.setRequestHeader('Authorization', 'Bearer ' + _accessToken);
    xhr.setRequestHeader('Content-Type', blob.type || 'image/png');
    xhr.onload = function () {
      if (xhr.status >= 300) { var m = '올리지 못했습니다'; try { m = JSON.parse(xhr.responseText).message || m; } catch (_) {} _cbToast(m, 'error'); return no(new Error(m)); }
      var d = null; try { d = JSON.parse(xhr.responseText).data; } catch (_) {}
      if (d && typeof CX !== 'undefined' && CX.room === room && !d.replyTo && typeof _cxAddIfNew === 'function' && _cxAddIfNew(d)) _cxDrawMsgs(true);
      ok(d);
    };
    xhr.onerror = function () { _cbToast('올리지 못했습니다', 'error'); no(new Error('net')); };
    xhr.send(blob);
  });
}
function _cbShareNew() {
  if (!CB.img) return;
  _cbBlob(_cbView()).then(function (b) { return _cbUploadBlob(b, _cbBase() + '-표시.png'); }).then(function () { _cbToast('📤 표시한 그림을 보냈습니다', 'success'); }).catch(function () {});
}
/* 보내기 전 사진: 원본을 올리고 → 표시 · 자르기 · 회전을 붙인다 (받는 사람도 원본 ↔ 표시 보기) */
function _cbSendDraft() {
  if (!CB || CB.fid || !CB.img || CB.sending) return;
  if (CB.textEl) _cbTextDone();
  CB.sending = true;
  var a = CB.a, my = CB, btn = CB.el.querySelector('[data-a="send"]'); if (btn) { btn.disabled = true; btn.textContent = '보내는 중…'; }
  var file = CB.draftFile;
  var p = file.size > 25 * 1024 * 1024 ? _cbBlob(_cbFlatten(CB.img, { rot: 0, shapes: [] }, { marks: false, max: 4096 })) : Promise.resolve(file);
  p.then(function (b) { return _cbUploadBlob(b, my.name, my.replyTo); }).then(function (msg) {
    var fid = msg && msg.file && msg.file.id;
    if (!fid || (!a.shapes.length && !a.rot && !a.crop)) return;
    var chunks = [];
    for (var i = 0; i < a.shapes.length; i += 50) chunks.push(a.shapes.slice(i, i + 50));
    if (!chunks.length) chunks.push([]);
    return chunks.reduce(function (pr, ch, i) {
      return pr.then(function () {
        var body = { add: ch };
        if (i === 0) { if (a.rot) body.rot = a.rot; if (a.crop) body.crop = a.crop; }
        return apiFetch('/api/chat/files/' + encodeURIComponent(fid) + '/annot', { method: 'POST', body: JSON.stringify(body) });
      });
    }, Promise.resolve());
  }).then(function () { if (CB === my) chatBoardClose(); }).catch(function () {
    if (CB === my) { CB.sending = false; if (btn) { btn.disabled = false; btn.textContent = '➤ 보내기'; } }
  });
}

/* ─── 같이 보기: 손가락 · 그리는 중인 선 ─── */
var _cbCurT = 0, _cbCurQ = null, _cbCurTimer = 0, _cbCurPend = 0;
function _cbCursor(o, now) {
  if (!CB || !CB.fid) return;
  var body = { x: o.x, y: o.y, bye: o.bye };
  if (o.op) body.op = { add: o.op.add, remove: o.op.remove, clear: o.op.clear, rot: o.op.rot, crop: o.op.crop };
  if (o.op && !('crop' in o.op)) delete body.op.crop;
  if ('live' in o) {
    var s = o.live; body.lt = s ? s.t : null; body.c = s ? s.c : CB.color; body.w = s ? s.w : 0;
    if (s && s.p) {   // v13.373 펜 · 형광펜은 새로 그은 점만 (6번에 한 번은 전부 — 빠진 게 있어도 맞춰짐)
      var ls = CB.liveSent && CB.liveSent.id === s.id ? CB.liveSent : (CB.liveSent = { id: s.id, n: 0, k: 0 });
      var full = ls.n === 0 || ++ls.k % 6 === 0 || ls.n > s.p.length;
      body.from = full ? 0 : ls.n; body.live = s.p.slice(body.from); body.lid = s.id;
      if (body.live.length > 2000) { body.from = Math.max(0, s.p.length - 2000); body.live = s.p.slice(body.from); }
      _cbCurPend = s.p.length;
    } else body.live = s ? [s.x, s.y, s.x2, s.y2] : null;
  }
  if (o.x === undefined && CB.lastXY) { body.x = CB.lastXY.x; body.y = CB.lastXY.y; }
  if (o.x != null) CB.lastXY = { x: o.x, y: o.y };
  _cbCurQ = { fid: CB.fid, body: body };
  var gap = Date.now() - _cbCurT;
  clearTimeout(_cbCurTimer);
  var every = body.op ? 0 : body.live ? 70 : 300;   // 그리는 중엔 자주, 손가락만 움직일 땐 드물게, 끝낸 표시는 바로
  if (now || gap > every) flush(); else _cbCurTimer = setTimeout(flush, every - gap);
  function flush() {
    if (!_cbCurQ) return;
    var q = _cbCurQ; _cbCurQ = null; _cbCurT = Date.now();
    if (q.body.lid && CB && CB.liveSent && CB.liveSent.id === q.body.lid) CB.liveSent.n = q.body.from + q.body.live.length;   // 보낸 데까지
    if (typeof apiFetch === 'function') apiFetch('/api/chat/files/' + encodeURIComponent(q.fid) + '/cursor', { method: 'POST', body: JSON.stringify(q.body) }).catch(function () {});
  }
}
function _cbPeerColor(id) { var h = 0; String(id).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return 'hsl(' + h + ' 70% 48%)'; }
function _cbDrawPeers() {
  var box = CB && CB.el.querySelector('[data-peers]'); if (!box) return;
  var ks = Object.keys(CB.peers);
  box.innerHTML = ks.length ? '<span class="cb-live">● 같이 보는 중</span>' + ks.map(function (k) { var p = CB.peers[k]; return '<span class="cb-peer" style="--pc:' + p.c + '" title="' + _cbE(p.name) + '">' + _cbE(String(p.name || '?').slice(0, 1)) + '</span>'; }).join('') : '';
}

/* ─── v13.409 나만 보는 회전 ─── */
var _cbViews = null, _cbViewsP = null, _cbViewsUid = null, _cbMineT = 0;
function _cbViewsOk() { return !!_cbViews && _cbViewsUid === _cbMe(); }
/** 내가 돌려 둔 사진 전부 — 앱 켤 때 한 번 */
function _cbViewsLoad() {
  if (_cbViewsOk()) return Promise.resolve(_cbViews);
  if (_cbViewsP && _cbViewsUid === _cbMe()) return _cbViewsP;
  _cbViewsUid = _cbMe(); _cbViews = null;
  // 받는 동안만 담아 둠 — 다 받은 뒤 목록이 비워지면 다시 받음(끝없이 같은 약속을 돌려주며 도는 일 없게)
  var my = _cbViewsP = (typeof apiFetch === 'function' ? apiFetch('/api/chat/my-views') : Promise.resolve(null)).then(function (r) { return (r && r.data) || {}; }, function () { return {}; }).then(function (v) {
    if (_cbViewsP === my) { _cbViews = v; _cbViewsP = null; }
    return v;
  });
  return _cbViewsP;
}
function _cbDeg(v) { return String(Math.round((+v || 0) * 10) / 10); }
/** 돌리기 — d 만큼 더하기(abs 면 그 각도로). 보내기 전 사진은 보내는 모습 그대로 모두에게 */
function _cbTurn(d, abs) {
  if (!CB || !CB.img) return;
  var n = _cbNA(abs ? d : _cbAng() + d);
  if (!CB.fid) { if (n !== (CB.a.rot || 0)) _cbCommit({ rot: n }); _cbFit(); _cbAngUi(); return; }
  _cbSetMine(n === _cbNA(CB.a.rot) && !CB.fill ? null : { a: n, f: !!CB.fill });
}
function _cbSetMine(v) {
  CB.my = v; CB.fill = !!(v && v.f);
  if (CB.cropSel) { CB.cropSel = null; _cbCropMenu(false); }
  if (_cbViews) { if (v) _cbViews[CB.fid] = v; else delete _cbViews[CB.fid]; }
  _cbFit(); _cbInfo(); _cbAngUi();
  var fid = CB.fid, sum = { rot: CB.a.rot || 0, n: CB.a.shapes.length, crop: !!CB.a.crop };
  clearTimeout(_cbMineT);
  _cbMineT = setTimeout(function () {   // 막대를 끄는 동안은 모아서 한 번
    apiFetch('/api/chat/files/' + encodeURIComponent(fid) + '/view', { method: 'PUT', body: JSON.stringify(v ? { angle: v.a, fill: v.f } : { angle: null }) })
      .then(function () { document.querySelectorAll('img[data-cbthumb="' + fid + '"]').forEach(function (img) { chatBoardThumb(img, { id: fid, annot: sum }, true); }); })
      .catch(function () { _cbToast('돌린 각도를 저장하지 못했습니다', 'error'); });
  }, 500);
}
function _cbFillToggle() {
  CB.fill = !CB.fill;
  if (CB.fid) _cbSetMine(CB.fill || _cbAng() !== _cbNA(CB.a.rot) ? { a: _cbAng(), f: CB.fill } : null);
  else { _cbFit(); _cbAngUi(); }
}
function _cbRotShare() {
  if (!CB.fid) return;
  var A = _cbAng();
  if (A !== _cbNA(CB.a.rot)) _cbCommit({ rot: A });
  _cbSetMine(CB.fill ? { a: A, f: true } : null);
  _cbHint('👥 방 사람 모두 ' + _cbDeg(A) + '° 로 봅니다');
}
function _cbRotReset() {
  CB.fill = false;
  if (CB.fid) { _cbSetMine(null); return; }
  if (CB.a.rot) _cbCommit({ rot: 0 });
  _cbFit(); _cbAngUi();
}
function _cbAngToggle() {
  var s = CB.el.querySelector('[data-ang]'); s.hidden = !s.hidden;
  try { localStorage.setItem('cb-ang', s.hidden ? '0' : '1'); } catch (_) {}
  _cbAngUi(); _cbFit();
}
/** 📐 띠 · 버튼 상태 맞추기 */
function _cbAngUi() {
  if (!CB) return;
  var el = CB.el, A = _cbAng(), base = Math.round(A / 90) * 90, fine = Math.round((A - base) * 10) / 10;
  var r = el.querySelector('[data-fine]'); if (r && document.activeElement !== r) r.value = fine;
  var o = el.querySelector('[data-angv]'); if (o) o.textContent = (fine > 0 ? '+' : '') + _cbDeg(fine) + '°' + (base % 360 ? ' · ' + (base % 360 + 360) % 360 + '°' : '');
  var f = el.querySelector('[data-a="fill"]'); if (f) { f.classList.toggle('on', !!CB.fill); f.disabled = !_cbSkew(A) && !CB.fill; }
  var sh = el.querySelector('[data-a="rotshare"]'); if (sh) { sh.hidden = !CB.fid; sh.disabled = !CB.my || CB.my.a === _cbNA(CB.a.rot); }
  var z = el.querySelector('[data-a="rot0"]'); if (z) z.disabled = CB.fid ? !CB.my : !CB.a.rot && !CB.fill;
  var w = el.querySelector('[data-angwho]');
  if (w) w.textContent = !CB.fid ? '보내면 이 모습 그대로 갑니다' : CB.my ? '🙋 내 화면에만 — 남의 화면은 그대로' : CB.a.rot ? '👥 모두 같이 보는 각도 (' + _cbDeg(CB.a.rot) + '°)' : '돌리면 내 화면에만 저장됩니다';
  var ab = el.querySelector('[data-a="angle"]'); if (ab) ab.classList.toggle('on', !el.querySelector('[data-ang]').hidden || !!CB.my);
}

var _cbThumbT = {};
/** 메신저 실시간 신호 (chat-ui.js chatOnEvent 가 넘겨 줌) */
function chatBoardOnEvent(ev, d) {
  if (ev === 'annot') {
    if (typeof CX !== 'undefined') {
      (CX.msgs || []).concat(CX.threadMsgs || []).forEach(function (m) { if (m.file && m.file.id === d.fileId) m.file.annot = d.sum; });
      clearTimeout(_cbThumbT[d.fileId]);   // 여럿이 그리는 중엔 잠깐 모아서 한 번에
      _cbThumbT[d.fileId] = setTimeout(function () { document.querySelectorAll('img[data-cbthumb="' + d.fileId + '"]').forEach(function (img) { chatBoardThumb(img, { id: d.fileId, annot: d.sum }, true); }); }, 900);
    }
    if (!CB || CB.fid !== d.fileId || d.by === _cbMe()) return;
    var op = d.op || {};
    var fit = ('rot' in op && op.rot !== CB.a.rot && !CB.my) || ('crop' in op && JSON.stringify(op.crop) !== JSON.stringify(CB.a.crop));
    _cbApplyOp(op); if (fit) _cbFit(); _cbAngUi();
    if (CB.peers[d.by]) CB.peers[d.by].live = null;
    CB.by = d.byName;
    _cbInfo(); _cbDraw();
  } else if (ev === 'annot-cur') {
    if (!CB || CB.fid !== d.fileId) return;
    if (d.bye) { delete CB.peers[d.by]; _cbDrawPeers(); _cbDraw(); return; }
    var p = CB.peers[d.by] || (CB.peers[d.by] = { name: d.byName, c: _cbPeerColor(d.by) });
    if (d.x != null) { p.x = d.x; p.y = d.y; }
    if (d.op) {   // v13.373 끝낸 표시 · 지우기 · 돌리기를 저장 전에 바로
      var fit2 = ('rot' in d.op && d.op.rot !== CB.a.rot && !CB.my) || ('crop' in d.op && JSON.stringify(d.op.crop) !== JSON.stringify(CB.a.crop));
      _cbApplyOp(d.op); if (fit2) _cbFit(); _cbInfo();
    }
    if (d.live === null) p.live = null;
    else if (d.live && d.lt) {
      if (d.lt === 'pen' || d.lt === 'hl') {   // 새 점만 온 것 — 이어 붙임 (순서가 어긋나면 다음 전체를 기다림)
        if (!d.from || !p.live || p.live.lid !== d.lid) { if (!d.from) p.live = { t: d.lt, c: d.c, w: d.w, p: d.live.slice(), lid: d.lid }; }
        else if (p.live.p.length === d.from) p.live.p = p.live.p.concat(d.live);
        else if (p.live.p.length > d.from) p.live.p = p.live.p.slice(0, d.from).concat(d.live);
      } else p.live = { t: d.lt, c: d.c, w: d.w, x: d.live[0], y: d.live[1], x2: d.live[2], y2: d.live[3], id: 'live' + d.by };
    }
    clearTimeout(p.tm); p.tm = setTimeout(function () { if (CB && CB.peers[d.by] === p) { delete CB.peers[d.by]; _cbDrawPeers(); _cbDraw(); } }, 15000);
    _cbDrawPeers(); _cbDraw();
  }
}

/** 대화 속 사진 미리보기 — 표시 · 자르기 · 회전이 있으면 그 모습으로 + ✏️ 표시 수 */
function chatBoardThumb(img, f, force) {
  if (!_cbViewsOk() && !(f && f._vw)) { _cbViewsLoad().then(function () { chatBoardThumb(img, Object.assign({}, f, { _vw: 1 }), force); }); return; }   // v13.409 내가 돌려 둔 각도부터 (한 번만 기다림)
  var an = f.annot, v = (_cbViews || {})[f.id];
  var btn = img.closest('.cx-img');
  if (btn) {
    var tag = btn.querySelector('.cx-img-tag');
    if (an && (an.n || an.crop)) {
      if (!tag) { tag = document.createElement('span'); tag.className = 'cx-img-tag'; btn.appendChild(tag); }
      tag.textContent = '✏️ ' + (an.n ? '표시 ' + an.n : '잘림');
    } else if (tag) tag.remove();
  }
  img.dataset.cbthumb = f.id;
  var need = !!(an && (an.n || an.crop)), rot = v ? v.a : (an && an.rot) || 0;
  if (!need && !rot) { delete img.dataset.cbkey; if (force) _cbFileUrl(f.id).then(function (u) { img.src = u; }); return; }
  // v13.440 만든 미리보기는 담아 두고 다시 씀 — 굴릴 때마다 · 목록을 다시 그릴 때마다 새로 만들던 것 (휴대폰 굴림이 끊기던 가장 큰 원인)
  var fill = !!(v && v.f), key = f.id + '|' + rot + '|' + (fill ? 1 : 0) + '|' + (an ? (an.n || 0) + ':' + (an.crop ? 1 : 0) : '');
  var old = _cbThumbKey[f.id];
  if (old && (force || old !== key)) { var op = _cbThumbC[old]; delete _cbThumbC[old]; if (op) op.then(function (t) { setTimeout(function () { URL.revokeObjectURL(t.url); }, 15000); }).catch(function () {}); }
  _cbThumbKey[f.id] = key;
  if (!_cbThumbC[key]) { _cbThumbC[key] = _cbThumbMake(f.id, need, rot, fill); _cbThumbC[key].catch(function () { if (_cbThumbKey[f.id] === key) delete _cbThumbKey[f.id]; delete _cbThumbC[key]; }); }
  img.dataset.cbkey = key;
  _cbThumbC[key].then(function (t) {
    if (img.dataset.cbkey !== key) return;
    if (img.dataset.dim && !img.closest('.cx-alb,.cx-q')) {   // 자리를 미리 잡아 둔 칸 — 돌린 모양에 맞춤 (가로 ↔ 세로)
      var k = Math.max(t.w, t.h) > 468 ? 360 / Math.max(t.w, t.h) : 1, dw = Math.min(t.w * k, 280), dh = Math.min(dw * t.h / t.w, 260);
      var sw = Math.round(Math.max(dw, 80)) + 'px', sh = Math.round(Math.max(dh, 60)) + 'px';
      if (img.style.width !== sw) img.style.width = sw; if (img.style.height !== sh) img.style.height = sh;
    }
    img.src = t.url;
  }).catch(function () {});
}
/* v13.440 미리보기 만들기 — 화면을 멈추지 않게
 *   · 돌리기만 한 사진: 작은 미리보기(360px)를 돌림 — 예전엔 원본(수 MB)을 받아 화면을 멈춘 채 풀었다
 *   · 표시 · 자르기가 있는 사진: 좌표가 원본 기준이라 원본을 쓰되, 푸는 일(decode)은 뒤에서
 *   · 압축도 뒤에서(toBlob) — toDataURL 은 끝날 때까지 화면이 멈춤 */
var _cbThumbC = {}, _cbThumbKey = {};
function _cbThumbMake(fid, need, rot, fill) {
  var url = !need && typeof _cxBlob === 'function' ? _cxBlob(fid, true) : _cbFileUrl(fid);
  var src = url.then(_cbLoadImg).then(function (im) { return typeof im.decode === 'function' ? im.decode().then(function () { return im; }, function () { return im; }) : im; });
  return Promise.all([src, need ? apiFetch('/api/chat/files/' + encodeURIComponent(fid) + '/annot') : null]).then(function (r) {
    var a = Object.assign({ crop: null, shapes: [] }, (r[1] && r[1].data) || {}, { rot: rot });
    var c = _cbFlatten(r[0], a, { max: 640, fill: fill });
    var png = (_cbSkew(rot) && !fill) || _cbHasAlpha(r[0]);   // 비스듬한 빈 모서리 · 비치는 사진은 투명하게 (JPEG 는 투명한 곳이 검게 바뀜)
    return new Promise(function (ok, no) { c.toBlob(function (b) { if (b) ok({ url: URL.createObjectURL(b), w: c.width, h: c.height }); else no(new Error('blob')); }, png ? 'image/png' : 'image/jpeg', 0.88); });
  });
}
/** 사진에 비치는(투명한) 곳이 있는지 — 작게 줄여 알파만 봄 (사진마다 한 번) */
var _cbAlphaC = new WeakMap();
function _cbHasAlpha(img) {
  if (_cbAlphaC.has(img)) return _cbAlphaC.get(img);
  var has = false;
  try {
    var n = 64, c = document.createElement('canvas'); c.width = n; c.height = n;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, n, n);
    var d = g.getImageData(0, 0, n, n).data;
    for (var i = 3; i < d.length; i += 4) if (d[i] < 250) { has = true; break; }
  } catch (e) { has = false; }
  _cbAlphaC.set(img, has);
  return has;
}

/* ─── 📸 화면 캡처 → 잘라서 표시 → 보내기 ─── */
function _cbDataBlob(url) {   // data: 주소 → Blob (보안 정책상 fetch(data:) 는 막혀 있음)
  var i = url.indexOf(','), bin = atob(url.slice(i + 1)), arr = new Uint8Array(bin.length);
  for (var k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
  return new Blob([arr], { type: (/data:([^;]+)/.exec(url) || [])[1] || 'image/png' });
}
function chatBoardCapture(replyTo) {
  function go(blob) { chatBoardDraft(new File([blob], '캡처-' + new Date().toTimeString().slice(0, 8).replace(/:/g, '') + '.png', { type: 'image/png' }), { tool: 'crop', replyTo: replyTo, hint: '보낼 부분을 끌어 고르세요 — 고른 뒤 표시하고 Enter 로 보내기' }); }
  // PC 앱: 창을 잠깐 숨기고 화면 전체를 찍는다
  if (window.wmDesktop && window.wmDesktop.captureScreen) {
    return window.wmDesktop.captureScreen().then(function (url) { if (!url) throw new Error('캡처하지 못했습니다'); return _cbDataBlob(url); }).then(go).catch(function (e) { _cbToast(e.message || '캡처하지 못했습니다', 'error'); });
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { _cbToast('이 기기에서는 화면 캡처를 쓸 수 없습니다', 'warn'); return; }
  navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'never' }, audio: false }).then(function (stream) {
    var v = document.createElement('video'); v.muted = true; v.srcObject = stream;
    return v.play().then(function () { return new Promise(function (r) { setTimeout(r, 350); }); }).then(function () {
      var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      stream.getTracks().forEach(function (t) { t.stop(); });
      return _cbBlob(c);
    });
  }).then(go).catch(function (e) { if (e && e.name !== 'NotAllowedError') _cbToast('캡처하지 못했습니다', 'error'); });
}

if (typeof window !== 'undefined') {
  window.chatBoardOpen = chatBoardOpen; window.chatBoardDraft = chatBoardDraft; window.chatBoardCapture = chatBoardCapture;
  window.chatBoardOnEvent = chatBoardOnEvent; window.chatBoardThumb = chatBoardThumb; window.chatBoardClose = chatBoardClose;
}
