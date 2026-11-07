/**
 * chat-board.js — 🖼 사진 칠판 (v13.356)
 *   메신저 사진을 크게 보고, 그 위에 같이 표시한다. 원본은 그대로 두고 표시 · 자르기 · 회전은 따로 저장(chat_files.annot).
 *   - 보기: 원본 ↔ 표시 보기 · 확대/축소(휠 · 두 손가락 · 0 맞춤) · 끌어 옮기기 · 회전(저장됨)
 *   - 표시: 펜 · 형광펜 · 글자 · 화살표 · 사각형 · 원 · 흐리게(가리기) · 집중(나머지 어둡게) · 지우개 · 되돌리기
 *   - 자르기: 이대로 자르기(원본은 그대로) · 잘라서 복사(어디든 붙여넣기) · 잘라서 보내기
 *   - 같이: 방 사람이 그리면 바로 보임 · 그리는 중인 선 · 누가 어디를 가리키는지(칠판처럼)
 *   - 보내기 전에: 붙여넣은 사진 · 📸 화면 캡처를 먼저 표시하고 보냄 (보내면 원본 + 표시 모두 남음)
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
  if (rot === 90) return [0, 1, -1, 0, H, 0];
  if (rot === 180) return [-1, 0, 0, -1, W, H];
  if (rot === 270) return [0, -1, 1, 0, 0, W];
  return [1, 0, 0, 1, 0, 0];
}
function _cbApply(m, x, y) { return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; }
function _cbViewM() {
  var r = _cbRotM(CB.a.rot || 0, CB.W, CB.H), z = CB.zoom;
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
  var max = opt.max || 4096, k = Math.min(1, max / Math.max(area.w, area.h));
  var sw = (rot % 180 ? area.h : area.w), sh = (rot % 180 ? area.w : area.h);
  var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  var g = c.getContext('2d');
  // 영역의 네 모서리를 회전한 뒤 왼쪽 위가 (0,0) 이 되게
  var R = _cbRotM(rot, W, H);
  var pts = [[area.x, area.y], [area.x + area.w, area.y], [area.x, area.y + area.h], [area.x + area.w, area.y + area.h]].map(function (p) { return _cbApply(R, p[0], p[1]); });
  var minX = Math.min.apply(null, pts.map(function (p) { return p.x; })), minY = Math.min.apply(null, pts.map(function (p) { return p.y; }));
  g.setTransform(R[0] * k, R[1] * k, R[2] * k, R[3] * k, (R[4] - minX) * k, (R[5] - minY) * k);
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
    // 그림자 판
    g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 30 / CB.zoom; g.fillStyle = '#fff'; g.fillRect(area.x, area.y, area.w, area.h); g.restore();
    _cbPaint(g, CB.img, CB.mode === 'orig' ? { shapes: [] } : CB.a, { area: area, marks: CB.mode !== 'orig' });
    // 그리는 중 (나 · 다른 사람)
    if (CB.mode !== 'orig') {
      g.save(); g.beginPath(); g.rect(area.x, area.y, area.w, area.h); g.clip();
      if (CB.draft) _cbShape(g, CB.draft, CB.img, true);
      Object.keys(CB.peers).forEach(function (k) { var p = CB.peers[k]; if (p.live) _cbShape(g, p.live, CB.img, true); });
      g.restore();
    }
    // 자르기 고르는 중
    if (CB.tool === 'crop') {
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
    _cbZoomLabel();
  });
}
function _cbRound(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function _cbFit() {
  if (!CB) return;
  var area = _cbArea(), R = _cbRotM(CB.a.rot || 0, CB.W, CB.H);
  var pts = [[area.x, area.y], [area.x + area.w, area.y + area.h]].map(function (p) { return _cbApply(R, p[0], p[1]); });
  var bx = Math.min(pts[0].x, pts[1].x), by = Math.min(pts[0].y, pts[1].y), bw = Math.abs(pts[1].x - pts[0].x), bh = Math.abs(pts[1].y - pts[0].y);
  var cw = CB.cv.clientWidth, ch = CB.cv.clientHeight, pad = cw < 600 ? 12 : 40;
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
function _cbDo(op, fromUndo) {
  var a = CB.a;
  if (op.remove) a.shapes = a.shapes.filter(function (s) { return op.remove.indexOf(s.id) < 0; });
  if (op.add) op.add.forEach(function (s) { a.shapes = a.shapes.filter(function (x) { return x.id !== s.id; }); a.shapes.push(s); });
  if ('rot' in op) a.rot = op.rot;
  if ('crop' in op) a.crop = op.crop;
  if (!fromUndo) { CB.redo = []; }
  _cbSave(op);
  _cbInfo();
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
    '<div class="cb-stage"><canvas></canvas><div class="cb-hint" data-hint hidden></div><div class="cb-loading" data-loading>사진 불러오는 중…</div></div>' +
    '<div class="cb-bar">' +
      '<div class="cb-tools">' + CB_TOOLS.map(function (t) { return '<button type="button" data-tool="' + t[0] + '" title="' + _cbE(t[2]) + ' (' + t[3] + ')"><span>' + t[1] + '</span></button>'; }).join('') + '</div>' +
      '<div class="cb-sep"></div>' +
      '<div class="cb-colors">' + CB_COLORS.map(function (c) { return '<button type="button" data-color="' + c + '" style="--c:' + c + '" title="색"></button>'; }).join('') + '</div>' +
      '<div class="cb-widths"><button type="button" data-w="2" title="가늘게"><i style="height:2px"></i></button><button type="button" data-w="4" title="보통"><i style="height:4px"></i></button><button type="button" data-w="8" title="굵게"><i style="height:7px"></i></button></div>' +
      '<div class="cb-sep"></div>' +
      '<div class="cb-view">' +
        '<button type="button" data-a="undo" title="되돌리기 (Ctrl+Z)">↶</button><button type="button" data-a="redo" title="다시 (Ctrl+Y)">↷</button>' +
        '<button type="button" data-a="rotl" title="왼쪽으로 돌리기 — 저장됨 ([)">⟲</button><button type="button" data-a="rotr" title="오른쪽으로 돌리기 — 저장됨 (])">⟳</button>' +
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
    undo: [], redo: [], peers: {}, dpr: window.devicePixelRatio || 1, ptrs: {}, by: '', at: null };
  try { var pref = JSON.parse(localStorage.getItem('cb-pref') || '{}'); if (pref.color) CB.color = pref.color; if (pref.w) CB.wSel = pref.w; } catch (_) {}
  if (o.fid) ov.classList.add('is-file'); else { ov.classList.add('is-draft'); ov.querySelector('[data-a="send"]').hidden = false; }
  _cbBind();
  _cbResize();
  _cbSyncUi();
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
    if (an) { CB.a = { rot: an.rot || 0, crop: an.crop || null, shapes: an.shapes || [] }; CB.by = r[1].byName || ''; CB.at = r[1].at; }
    _cbReady(r[0]);
  }).catch(function (e) { if (CB === my) { CB.el.querySelector('[data-loading]').textContent = (e && e.message) || '사진을 불러오지 못했습니다'; } });
  return true;
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
  _cbFit(); _cbInfo(); _cbSyncUi();
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
  if (CB.a.rot) bits.push(CB.a.rot + '° 돌림');
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
  CB.tool = t; CB.cropSel = null; _cbCropMenu(false);
  if (t !== 'pan' && t !== 'crop' && CB.mode === 'orig') CB.mode = 'mark';
  if (t === 'crop') { CB.mode = 'mark'; _cbFit(); _cbHint('잘라낼 곳을 끌어 고르세요 — 원본은 그대로 남습니다'); }
  _cbSyncUi(); _cbDraw();
}

/* ─── 입력 ─── */
function _cbPt(e) { var r = CB.cv.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
// 굵기 · 글자 크기는 '지금 화면에서 보이는 크기' 기준 → 사진 픽셀로 (크게 확대하면 가늘게 정밀하게)
function _cbW() { return Math.max(0.5, Math.round(CB.wSel * 1.6 / CB.zoom * 10) / 10); }
function _cbBind() {
  var el = CB.el, cv = CB.cv;
  el.addEventListener('click', function (e) {
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
    else if (a === 'rotl' || a === 'rotr') { _cbCommit({ rot: (((CB.a.rot || 0) + (a === 'rotr' ? 90 : 270)) % 360) }); _cbFit(); }
    else if (a === 'zin' || a === 'zout') _cbZoomAt(a === 'zin' ? 1.25 : 0.8, cv.clientWidth / 2, cv.clientHeight / 2);
    else if (a === 'fit') { if (Math.abs(CB.zoom - 1) < 0.01) _cbFit(); else _cbZoomAt(1 / CB.zoom, cv.clientWidth / 2, cv.clientHeight / 2); }
    else if (a === 'clear') { if (!CB.a.shapes.length) return; if (!confirm('표시 ' + CB.a.shapes.length + '개를 모두 지울까요? (되돌리기 가능)')) return; _cbCommit({ remove: CB.a.shapes.map(function (s) { return s.id; }) }); }
    else if (a === 'copy') _cbCopy();
    else if (a === 'dl') _cbDownload();
    else if (a === 'share') _cbShareNew();
    else if (a === 'send') _cbSendDraft();
  });
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
  if (k === '[' || k === ']') { _cbCommit({ rot: (((CB.a.rot || 0) + (k === ']' ? 90 : 270)) % 360) }); _cbFit(); return; }
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
  var tool = (CB.space || e.button === 1 || CB.mode === 'orig') ? 'pan' : CB.tool;
  var ip = _cbToImg(p.sx, p.sy);
  CB.drag = { tool: tool, sx: p.sx, sy: p.sy, px: CB.panX, py: CB.panY, ix: ip.x, iy: ip.y };
  if (tool === 'pan') { cv.style.cursor = 'grabbing'; return; }
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
  if (d0.tool === 'crop') { if (CB.cropSel && CB.cropSel.w > 4 && CB.cropSel.h > 4) _cbCropMenu(true); else { CB.cropSel = null; _cbDraw(); } return; }
  var s = CB.draft; CB.draft = null;
  if (!s) return;
  var ok = s.p ? s.p.length >= 2 : Math.hypot(s.x2 - s.x, s.y2 - s.y) * CB.zoom > 4;
  if (!ok) { _cbDraw(); return; }
  if (!s.p) { s.x = r1(s.x); s.y = r1(s.y); s.x2 = r1(s.x2); s.y2 = r1(s.y2); }
  s.by = _cbMe();
  _cbCommit({ add: [s] });
  if (CB.fid) _cbCursor({ live: null }, true);
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
    '<button type="button" data-cm="apply" title="원본은 그대로 · 표시 보기에서 이 부분만">✂️ 이대로 자르기</button>' +
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
  var c = _cbFlatten(CB.img, CB.a, { area: sel });
  if (k === 'copy') _cbClip(c, '잘라서 복사했습니다 — 붙여넣기(Ctrl+V)');
  if (k === 'send') _cbBlob(c).then(function (b) { return _cbUploadBlob(b, _cbBase() + '-부분.png'); }).then(function () { _cbToast('📤 잘라서 보냈습니다', 'success'); });
}

/* ─── 복사 · 받기 · 보내기 ─── */
function _cbBase() { return String(CB.name || 'image').replace(/\.[A-Za-z0-9]{1,6}$/, ''); }
function _cbView() { return _cbFlatten(CB.img, CB.mode === 'orig' ? { rot: CB.a.rot, shapes: [] } : CB.a, { marks: CB.mode !== 'orig' }); }
function _cbClip(canvas, msg) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') { _cbToast('이 브라우저는 그림 복사를 지원하지 않습니다 — ⬇ 받기를 쓰세요', 'warn'); return; }
  navigator.clipboard.write([new ClipboardItem({ 'image/png': _cbBlob(canvas) })])
    .then(function () { _cbToast(msg || '📋 복사했습니다 — 붙여넣기(Ctrl+V)', 'success'); })
    .catch(function () { _cbToast('복사하지 못했습니다', 'error'); });
}
function _cbCopy() { if (CB && CB.img) _cbClip(CB.cropSel ? _cbFlatten(CB.img, CB.a, { area: CB.cropSel }) : _cbView()); }
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
var _cbCurT = 0, _cbCurQ = null, _cbCurTimer = 0;
function _cbCursor(o, now) {
  if (!CB || !CB.fid) return;
  var body = { x: o.x, y: o.y, bye: o.bye };
  if ('live' in o) { var s = o.live; body.live = s && s.p ? s.p.slice(-2000) : s ? [s.x, s.y, s.x2, s.y2] : null; body.lt = s ? s.t : null; body.c = s ? s.c : CB.color; body.w = s ? s.w : 0; }
  if (o.x === undefined && CB.lastXY) { body.x = CB.lastXY.x; body.y = CB.lastXY.y; }
  if (o.x != null) CB.lastXY = { x: o.x, y: o.y };
  _cbCurQ = { fid: CB.fid, body: body };
  var gap = Date.now() - _cbCurT;
  clearTimeout(_cbCurTimer);
  var every = body.live ? 140 : 450;   // 그리는 중엔 자주, 손가락만 움직일 땐 드물게
  if (now || gap > every) flush(); else _cbCurTimer = setTimeout(flush, every - gap);
  function flush() {
    if (!_cbCurQ) return;
    var q = _cbCurQ; _cbCurQ = null; _cbCurT = Date.now();
    if (typeof apiFetch === 'function') apiFetch('/api/chat/files/' + encodeURIComponent(q.fid) + '/cursor', { method: 'POST', body: JSON.stringify(q.body) }).catch(function () {});
  }
}
function _cbPeerColor(id) { var h = 0; String(id).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return 'hsl(' + h + ' 70% 48%)'; }
function _cbDrawPeers() {
  var box = CB && CB.el.querySelector('[data-peers]'); if (!box) return;
  var ks = Object.keys(CB.peers);
  box.innerHTML = ks.length ? '<span class="cb-live">● 같이 보는 중</span>' + ks.map(function (k) { var p = CB.peers[k]; return '<span class="cb-peer" style="--pc:' + p.c + '" title="' + _cbE(p.name) + '">' + _cbE(String(p.name || '?').slice(0, 1)) + '</span>'; }).join('') : '';
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
    if (op.clear) CB.a.shapes = [];
    if (op.remove && op.remove.length) CB.a.shapes = CB.a.shapes.filter(function (s) { return op.remove.indexOf(s.id) < 0; });
    (op.add || []).forEach(function (s) { CB.a.shapes = CB.a.shapes.filter(function (x) { return x.id !== s.id; }); CB.a.shapes.push(s); });
    if ('rot' in op) { CB.a.rot = op.rot; _cbFit(); }
    if ('crop' in op) { CB.a.crop = op.crop; _cbFit(); }
    if (CB.peers[d.by]) CB.peers[d.by].live = null;
    CB.by = d.byName;
    _cbInfo(); _cbDraw();
  } else if (ev === 'annot-cur') {
    if (!CB || CB.fid !== d.fileId) return;
    if (d.bye) { delete CB.peers[d.by]; _cbDrawPeers(); _cbDraw(); return; }
    var p = CB.peers[d.by] || (CB.peers[d.by] = { name: d.byName, c: _cbPeerColor(d.by) });
    if (d.x != null) { p.x = d.x; p.y = d.y; }
    if (d.live === null) p.live = null;
    else if (d.live && d.lt) p.live = (d.lt === 'pen' || d.lt === 'hl') ? { t: d.lt, c: d.c, w: d.w, p: d.live } : { t: d.lt, c: d.c, w: d.w, x: d.live[0], y: d.live[1], x2: d.live[2], y2: d.live[3], id: 'live' + d.by };
    clearTimeout(p.tm); p.tm = setTimeout(function () { if (CB && CB.peers[d.by] === p) { delete CB.peers[d.by]; _cbDrawPeers(); _cbDraw(); } }, 15000);
    _cbDrawPeers(); _cbDraw();
  }
}

/** 대화 속 사진 미리보기 — 표시 · 자르기 · 회전이 있으면 그 모습으로 + ✏️ 표시 수 */
function chatBoardThumb(img, f, force) {
  var an = f.annot;
  var btn = img.closest('.cx-img');
  if (btn) {
    var tag = btn.querySelector('.cx-img-tag');
    if (an && (an.n || an.crop)) {
      if (!tag) { tag = document.createElement('span'); tag.className = 'cx-img-tag'; btn.appendChild(tag); }
      tag.textContent = '✏️ ' + (an.n ? '표시 ' + an.n : '잘림');
    } else if (tag) tag.remove();
  }
  img.dataset.cbthumb = f.id;
  if (!an || (!an.n && !an.rot && !an.crop)) { if (force) _cbFileUrl(f.id).then(function (u) { img.src = u; }); return; }
  Promise.all([_cbFileImg(f.id), apiFetch('/api/chat/files/' + encodeURIComponent(f.id) + '/annot')]).then(function (r) {
    var a = (r[1] && r[1].data) || { shapes: [] };
    var c = _cbFlatten(r[0], a, { max: 640 });
    img.src = c.toDataURL('image/jpeg', 0.88);
  }).catch(function () {});
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
