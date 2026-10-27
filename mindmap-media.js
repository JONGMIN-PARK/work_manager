/**
 * 업무 관리자 — 🧠 마인드맵 주제 안 내용 줄 (v13.220)
 * 주제 글(node.text) 아래에 글 줄 · 이미지 줄을 섞어 넣는다 — node.blocks = [{ t: 'text', v } | { t: 'img', id, w, h, dw }]
 *   w·h = 원본 크기(비율 계산용), dw = 표시 폭(px). 이미지 본문은 /api/mindmaps/:id/images (058_mindmap_images) — 맵 문서에는 id 만.
 * 넣기: 패널 [＋ 이미지] · Alt+I · 캡처 붙여넣기(Ctrl+V) · 파일 끌어다 놓기. 올릴 때 긴 변 1600px 로 줄임.
 * 의존(전역): mindmap.js(_mm · _mmMutate · _mmSelInfo · _mmRoot · _mmPaint …), apiFetch, createModal, wmGuardedModal
 */

var MM_IMG_MAX_SIDE = 1600;
var MM_IMG_SIZES = [{ k: 120, l: '작게' }, { k: 220, l: '보통' }, { k: 340, l: '크게' }, { k: 480, l: '아주 크게' }];
var MM_IMG_DEFAULT_W = 220;

/* ═══ 불러오기 ═══ */
function mmLoadImages(mapId) {
  _mm.images = {};
  _mm.imagesLoaded = false;
  return apiFetch('/api/mindmaps/' + encodeURIComponent(mapId) + '/images', { timeoutMs: 60000 }).then(function (r) {
    if (_mm.mapId !== mapId) return;
    ((r && r.data) || []).forEach(function (im) { _mm.images[im.id] = im; });
    _mm.imagesLoaded = true;
    if (_mmHasBlocks()) _mmPaint();
  }).catch(function () { _mm.imagesLoaded = true; });
}
function _mmHasBlocks() {
  var any = false;
  (_mm.doc ? _mm.doc.sheets : []).forEach(function (sh) { mmWalk(sh.root, function (n) { if (n.blocks && n.blocks.length) any = true; }); });
  return any;
}

/* ═══ 그리기 ═══ */
function _mmImgBox(b) {
  var dw = b.dw || MM_IMG_DEFAULT_W;
  var dh = (b.w && b.h) ? Math.round(dw * b.h / b.w) : Math.round(dw * 0.66);
  return { w: dw, h: dh };
}
/** 주제 안 내용 줄 HTML — 이미지 크기는 저장된 값으로 미리 잡아 불러오기 전후 배치가 같다 */
function _mmBlocksHtml(n) {
  var bl = n.blocks;
  if (!bl || !bl.length) return '';
  return '<div class="mm-blocks">' + bl.map(function (b) {
    if (b.t === 'img') {
      var box = _mmImgBox(b);
      var im = _mm.images && _mm.images[b.id];
      var st = 'width:' + box.w + 'px;height:' + box.h + 'px';
      return im
        ? '<img class="mm-blk-img" data-img="' + _mmEsc(b.id) + '" src="' + im.src + '" style="' + st + '" draggable="false" alt="">'
        : '<div class="mm-blk-img mm-blk-missing" style="' + st + '">' + (_mm.imagesLoaded ? '🖼 이미지를 찾을 수 없음' : '🖼 불러오는 중…') + '</div>';
    }
    return '<div class="mm-blk-text">' + (b.v ? _mmEsc(b.v) : '<i class="mm-ph">(빈 줄)</i>') + '</div>';
  }).join('') + '</div>';
}
/** 이미지가 있으면 주제 최대 폭을 이미지에 맞춰 넓힘 */
function _mmNodeMaxW(n) {
  var m = 0;
  (n.blocks || []).forEach(function (b) { if (b.t === 'img') m = Math.max(m, _mmImgBox(b).w); });
  return m ? Math.max(260, m + 28) : 0;
}

/* ═══ 이미지 줄이기 · 올리기 ═══ */
function _mmReadDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var rd = new FileReader();
    rd.onload = function () { resolve(rd.result); };
    rd.onerror = function () { reject(new Error('파일을 읽지 못했습니다')); };
    rd.readAsDataURL(file);
  });
}
/** 긴 변 1600px 로 줄여 data URI — 작은 PNG·GIF 는 그대로(투명·움직임 유지), 나머지는 JPEG 0.85 */
function _mmDownscale(file) {
  return _mmReadDataUrl(file).then(function (url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var keep = /^image\/(png|gif|webp)$/.test(file.type) && file.size <= 600 * 1024 && Math.max(w, h) <= MM_IMG_MAX_SIDE;
        if (keep) { resolve({ src: url, w: w, h: h }); return; }
        var k = Math.min(1, MM_IMG_MAX_SIDE / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        var g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, cw, ch);
        g.drawImage(img, 0, 0, cw, ch);
        resolve({ src: c.toDataURL('image/jpeg', 0.85), w: cw, h: ch });
      };
      img.onerror = function () { reject(new Error('이미지로 읽을 수 없는 파일입니다')); };
      img.src = url;
    });
  });
}

/** 이미지 파일들을 주제(nodeId)의 내용 줄 끝에 추가 */
function mmAddImageFiles(files, nodeId) {
  if (_mm.readOnly) return Promise.resolve();
  var list = Array.prototype.filter.call(files || [], function (f) { return /^image\//.test(f.type); });
  if (!list.length) { _mmToast('이미지 파일이 아닙니다', 'error'); return Promise.resolve(); }
  var mapId = _mm.mapId;
  var made = [];
  _mmToast('이미지 넣는 중… (' + list.length + '장)');
  var chain = Promise.resolve();
  list.forEach(function (f) {
    chain = chain.then(function () { return _mmDownscale(f); }).then(function (im) {
      return apiFetch('/api/mindmaps/' + encodeURIComponent(mapId) + '/images', { method: 'POST', body: JSON.stringify(im), timeoutMs: 60000 })
        .then(function (r) { _mm.images[r.data.id] = { id: r.data.id, src: im.src, w: im.w, h: im.h }; made.push({ t: 'img', id: r.data.id, w: im.w, h: im.h, dw: Math.min(MM_IMG_DEFAULT_W, im.w) }); });
    });
  });
  return chain.catch(function (e) {
    _mmToast('❌ ' + _mmErr(e) + (made.length ? ' — ' + made.length + '장은 넣었습니다' : ''), 'error');
  }).then(function () {
    if (!made.length || _mm.mapId !== mapId) return;
    var f = mmFind(_mmRoot(), nodeId) || _mmSelInfo();
    if (!f) return;
    _mmMutate(function () { f.node.blocks = (f.node.blocks || []).concat(made); _mm.sel = f.node.id; });
    _mmEnsureVisible(f.node.id);
  });
}

/** Alt+I · 패널 버튼 — 파일 고르기 */
function mmPickImage() {
  var f = _mmSelInfo();
  if (!f || _mm.readOnly) return;
  var inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.multiple = true;
  inp.style.display = 'none';
  inp.onchange = function () { mmAddImageFiles(inp.files, f.node.id); inp.remove(); };
  document.body.appendChild(inp);
  inp.click();
}

/** 캔버스 붙여넣기 — 클립보드에 이미지가 있으면 선택 주제에 넣고 true */
function mmPasteImages(e) {
  var items = (e.clipboardData && e.clipboardData.items) || [];
  var files = [];
  Array.prototype.forEach.call(items, function (it) { if (it.kind === 'file' && /^image\//.test(it.type)) { var fl = it.getAsFile(); if (fl) files.push(fl); } });
  if (!files.length) return false;
  e.preventDefault();
  var f = _mmSelInfo();
  if (f) mmAddImageFiles(files, f.node.id);
  return true;
}

function mmAddTextLine() {
  var f = _mmSelInfo();
  if (!f || _mm.readOnly) return;
  if (_mm.multi.length) _mmClearMulti();
  _mmMutate(function () { f.node.blocks = (f.node.blocks || []).concat([{ t: 'text', v: '' }]); });
  _mmPaintPanel();
  var ins = document.querySelectorAll('#mmPanel .mm-blk-in');
  if (ins.length) ins[ins.length - 1].focus();
}

/* ═══ 속성 패널 — 내용 줄 ═══ */
function _mmBlocksPanelHtml(n, ro) {
  var bl = n.blocks || [];
  var rows = bl.map(function (b, i) {
    var tools = ro ? '' : '<span class="mm-blk-tools">' +
      '<button data-blk-act="up" data-i="' + i + '" title="위로"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button data-blk-act="down" data-i="' + i + '" title="아래로"' + (i === bl.length - 1 ? ' disabled' : '') + '>↓</button>' +
      '<button data-blk-act="del" data-i="' + i + '" title="줄 삭제">×</button></span>';
    if (b.t === 'img') {
      var im = _mm.images && _mm.images[b.id];
      return '<div class="mm-blk-row">' + (im ? '<img class="mm-blk-thumb" data-img="' + _mmEsc(b.id) + '" src="' + im.src + '" alt="" title="크게 보기">' : '<span class="mm-blk-thumb mm-blk-missing">🖼</span>') +
        '<select class="mm-input mm-blk-size" data-i="' + i + '"' + (ro ? ' disabled' : '') + '>' +
        MM_IMG_SIZES.map(function (s) { return '<option value="' + s.k + '"' + ((b.dw || MM_IMG_DEFAULT_W) === s.k ? ' selected' : '') + '>' + s.l + '</option>'; }).join('') + '</select>' + tools + '</div>';
    }
    return '<div class="mm-blk-row"><input class="mm-input mm-blk-in" data-i="' + i + '" value="' + _mmEsc(b.v || '') + '" placeholder="글 줄"' + (ro ? ' readonly' : '') + '>' + tools + '</div>';
  }).join('');
  return '<div class="mm-pn-sec"><div class="mm-pn-h">내용 줄 <span class="mm-hint">글 · 이미지 섞어서</span></div>' + rows +
    (ro ? '' : '<div class="mm-swatches"><button class="btn btn-g btn-s" data-blk-act="add-text">＋ 글 줄</button>' +
      '<button class="btn btn-g btn-s" data-blk-act="add-img" title="Alt+I · 캡처는 Ctrl+V · 파일은 끌어다 놓기">＋ 이미지</button></div>') + '</div>';
}
function _mmBindBlocksPanel(pn, n) {
  pn.querySelectorAll('.mm-blk-in').forEach(function (inp) {
    inp.onchange = function () {
      var i = parseInt(inp.getAttribute('data-i'), 10);
      _mmMutate(function () { if (n.blocks && n.blocks[i]) n.blocks[i].v = inp.value.replace(/\s+$/, ''); });
    };
    inp.onkeydown = function (e) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); inp.blur(); if (!_mm.readOnly) mmAddTextLine(); }
    };
  });
  pn.querySelectorAll('.mm-blk-size').forEach(function (sel) {
    sel.onchange = function () {
      var i = parseInt(sel.getAttribute('data-i'), 10);
      _mmMutate(function () { if (n.blocks && n.blocks[i]) n.blocks[i].dw = parseInt(sel.value, 10); });
    };
  });
  pn.querySelectorAll('.mm-blk-thumb[data-img]').forEach(function (img) { img.onclick = function () { mmImageView(img.getAttribute('data-img')); }; });
  pn.querySelectorAll('[data-blk-act]').forEach(function (btn) {
    btn.onclick = function (e) {
      e.stopPropagation();
      var act = btn.getAttribute('data-blk-act'), i = parseInt(btn.getAttribute('data-i'), 10);
      if (act === 'add-text') { mmAddTextLine(); return; }
      if (act === 'add-img') { mmPickImage(); return; }
      _mmMutate(function () {
        var bl = n.blocks || [];
        if (act === 'del') bl.splice(i, 1);
        else if (act === 'up' && i > 0) bl.splice(i - 1, 0, bl.splice(i, 1)[0]);
        else if (act === 'down' && i < bl.length - 1) bl.splice(i + 1, 0, bl.splice(i, 1)[0]);
        if (bl.length) n.blocks = bl; else delete n.blocks;
      });
    };
  });
}

/** 이미지 크게 보기 */
function mmImageView(id) {
  var im = _mm.images && _mm.images[id];
  if (!im) return;
  return wmGuardedModal('mmImgView', function () {
    createModal({ id: 'mmImgViewModal', title: '🖼 이미지', html: '<div class="mm-imgview"><img src="' + im.src + '" alt=""></div>', width: '92vw', closeOnEsc: true, closeOnOverlay: true,
      onClose: function () { setTimeout(_mmFocusCanvas, 0); } });
  }, 'mmImgViewModal');
}
