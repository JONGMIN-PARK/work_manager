/* ═══════════════════════════════════════════════════════════════════════
   project-images.js — 프로젝트 참고 이미지(장비 사진 등)
   ─────────────────────────────────────────────────────────────────────
   · 등록: 여러 장(업로드 시 다운스케일) — 프로젝트 등록/편집 모달의 📷 섹션
   · 열람: 한 장씩 표시 + ◀▶ 돌아가며 보기(라이트박스 캐러셀)
   · 타임라인 호버 프리뷰: 개요 + 대표 이미지
   서버: GET/POST /api/projects/:id/images, DELETE /api/projects/:id/images/:imgId
   전역 의존: apiFetch, toCamelArray, eH, showToast, projGet.
   ═══════════════════════════════════════════════════════════════════════ */

var _pimgCache = {};                 // projId -> 이미지 배열 캐시
if (typeof window !== 'undefined' && !window._pimgStaging) window._pimgStaging = []; // 신규 생성 시 임시 보관(서버 id 없음)
var _PIMG_CONTAINER = 'projImagesSection';

function _pimgEsc(s) { return (typeof eH === 'function') ? eH(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _pimgToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }

/* ── 데이터 래퍼 ─────────────────────────────────────────────────────── */
function projImagesGet(projId) {
  return apiFetch('/api/projects/' + projId + '/images').then(function (r) { return toCamelArray(r.data); });
}
function projImagesAdd(projId, images) {
  return apiFetch('/api/projects/' + projId + '/images', { method: 'POST', body: JSON.stringify({ images: images }) })
    .then(function (r) { _pimgCache[projId] = null; return toCamelArray(r.data); });
}
function projImageDel(projId, imgId) {
  return apiFetch('/api/projects/' + projId + '/images/' + imgId, { method: 'DELETE' })
    .then(function (r) { _pimgCache[projId] = null; return r; });
}

/* ── 업로드 이미지 다운스케일(canvas, 최대 1280px, JPEG) → data URI ──── */
function _pimgDownscale(file, maxDim, quality) {
  maxDim = maxDim || 1280; quality = quality || 0.82;
  return new Promise(function (resolve, reject) {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('이미지 파일이 아닙니다')); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.width, h = img.height;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
          var c = document.createElement('canvas'); c.width = nw; c.height = nh;
          c.getContext('2d').drawImage(img, 0, 0, nw, nh);
          var out = c.toDataURL('image/jpeg', quality);
          c.width = c.height = 0; // 캔버스 즉시 해제(메모리 회수 — 대용량 다중 처리 시 OOM 방지)
          if (img.src && img.src.indexOf('data:') === 0) img.src = '';
          resolve(out && out.length > 8 ? out : fr.result);
        } catch (e) { resolve(fr.result); }
      };
      img.onerror = function () { resolve(fr.result); };
      img.src = fr.result;
    };
    fr.onerror = function () { reject(new Error('파일 읽기 실패')); };
    fr.readAsDataURL(file);
  });
}

/* ── 기존 data URI 이미지 소급 압축(메모 등) ─────────────────────────── */
// data URI → 다운스케일된 data URI. 더 작아진 경우에만 교체, 아니면 원본 반환.
function pimgDownscaleDataUrl(dataUrl, maxDim, quality) {
  maxDim = maxDim || 1280; quality = quality || 0.8;
  return new Promise(function (resolve) {
    if (!dataUrl || dataUrl.indexOf('data:image') !== 0) { resolve(dataUrl); return; }
    var img = new Image();
    img.onload = function () {
      try {
        var w = img.width, h = img.height;
        var scale = Math.min(1, maxDim / Math.max(w, h));
        var nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
        var c = document.createElement('canvas'); c.width = nw; c.height = nh;
        c.getContext('2d').drawImage(img, 0, 0, nw, nh);
        var out = c.toDataURL('image/jpeg', quality);
        c.width = c.height = 0;
        resolve((out && out.length < dataUrl.length) ? out : dataUrl);
      } catch (e) { resolve(dataUrl); }
    };
    img.onerror = function () { resolve(dataUrl); };
    img.src = dataUrl;
  });
}

// 메모 HTML 내 data URI 이미지들을 순차 압축 + 작게 auto-size 스타일 적용.
// 반환: { html, changed, before, after, count }
function pimgCompressMemoHtml(html, opts) {
  opts = opts || {};
  var smallStyle = opts.smallStyle || 'max-width:240px;max-height:200px;width:auto;height:auto;border-radius:6px;display:block;margin:6px 0;cursor:zoom-in';
  return new Promise(function (resolve) {
    var before = html ? html.length : 0;
    if (!html || html.indexOf('<img') < 0) { resolve({ html: html, changed: false, before: before, after: before, count: 0 }); return; }
    var doc = new DOMParser().parseFromString('<div id="_pcr">' + html + '</div>', 'text/html');
    var root = doc.getElementById('_pcr');
    var imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
    var count = 0, i = 0;
    function next() {
      if (i >= imgs.length) {
        var outHtml = root.innerHTML;
        resolve({ html: outHtml, changed: count > 0, before: before, after: outHtml.length, count: count });
        return;
      }
      var img = imgs[i++];
      var src = img.getAttribute('src') || '';
      if (src.indexOf('data:image') !== 0) { next(); return; }
      pimgDownscaleDataUrl(src, opts.maxDim || 1280, opts.quality || 0.8).then(function (nsrc) {
        if (nsrc && nsrc !== src) { img.setAttribute('src', nsrc); count++; }
        img.setAttribute('style', smallStyle); // 표시도 작게(원본 풀사이즈 → 썸네일)
        next();
      });
    }
    next();
  });
}

/* ── 모달 내 이미지 관리 섹션 렌더 ───────────────────────────────────── */
function renderProjImages(projId) {
  var el = document.getElementById(_PIMG_CONTAINER); if (!el) return;
  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<span style="font-size:11px;font-weight:700;color:var(--t3)">📷 참고 이미지 <span style="color:var(--t6);font-weight:400">(장비 사진 등 · 여러 장)</span></span>' +
      '<label class="btn btn-g btn-s" style="font-size:10px;cursor:pointer">＋ 사진 추가<input type="file" accept="image/*" multiple style="display:none" onchange="pimgOnPick(this,\'' + (projId || '') + '\')"></label>' +
    '</div>' +
    '<div id="' + _PIMG_CONTAINER + '_grid" style="display:flex;flex-wrap:wrap;gap:6px"></div>';
  _pimgRenderGrid(projId);
}

function _pimgRenderGrid(projId) {
  var grid = document.getElementById(_PIMG_CONTAINER + '_grid'); if (!grid) return;
  function paint(list) {
    if (!list || !list.length) { grid.innerHTML = '<div style="font-size:10px;color:var(--t6);padding:2px 0">등록된 이미지 없음 — [＋ 사진 추가]</div>'; return; }
    grid.innerHTML = list.map(function (im, i) {
      var key = im.id || ('staged:' + i);
      return '<div style="position:relative;width:64px;height:64px;border:1px solid var(--bd);border-radius:6px;overflow:hidden;cursor:pointer;background:var(--bg-i)" onclick="pimgViewerFor(\'' + (projId || '') + '\',' + i + ')" title="클릭하여 크게 보기">' +
        '<img src="' + im.src + '" style="width:100%;height:100%;object-fit:cover" alt="">' +
        '<button onclick="event.stopPropagation();pimgRemove(\'' + (projId || '') + '\',\'' + key + '\')" title="삭제" style="position:absolute;top:1px;right:1px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:17px;height:17px;font-size:10px;line-height:1;cursor:pointer;padding:0">✕</button>' +
      '</div>';
    }).join('');
  }
  if (!projId) { paint(window._pimgStaging || []); return; }
  grid.innerHTML = '<div style="font-size:10px;color:var(--t6)">로딩 중...</div>';
  projImagesGet(projId).then(function (list) { _pimgCache[projId] = list; paint(list); })
    .catch(function (err) { grid.innerHTML = '<div style="font-size:10px;color:var(--t6)">' + ((err && err.status === 404) ? '서버 배포 후 사용 가능' : '이미지 로드 실패') + '</div>'; });
}

function pimgOnPick(input, projId) {
  var files = Array.prototype.slice.call(input.files || []);
  input.value = '';
  if (!files.length) return;
  _pimgToast(files.length + '장 압축 처리 중...', 'info');
  // 순차 처리 — 대용량 이미지 여러 장 동시 디코드 시 브라우저 메모리 폭증(크래시) 방지
  var items = [];
  var chain = Promise.resolve();
  files.forEach(function (f) {
    chain = chain.then(function () {
      return _pimgDownscale(f).then(function (src) { if (src) items.push({ src: src }); }).catch(function () {});
    });
  });
  chain.then(function () {
    if (!items.length) { _pimgToast('이미지 처리 실패', 'error'); return; }
    if (!projId) {  // 신규 생성 — 스테이징
      window._pimgStaging = (window._pimgStaging || []).concat(items);
      _pimgRenderGrid('');
      _pimgToast(items.length + '장 추가됨 (프로젝트 등록 시 저장)');
      return;
    }
    projImagesAdd(projId, items).then(function () { _pimgCache[projId] = null; _pimgRenderGrid(projId); _pimgToast(items.length + '장 등록됨'); })
      .catch(function (err) {
        var msg = (err && err.status === 413) ? '이미지가 너무 큽니다.' : (err && err.status === 403) ? '권한이 없습니다.' : (err && err.status === 404) ? '서버 배포 후 사용 가능' : '업로드 실패';
        _pimgToast('❌ ' + msg, 'error');
      });
  });
}

function pimgRemove(projId, key) {
  if (String(key).indexOf('staged:') === 0) {
    var i = parseInt(key.split(':')[1], 10);
    if (window._pimgStaging && i >= 0) { window._pimgStaging.splice(i, 1); _pimgRenderGrid(''); }
    return;
  }
  if (!confirm('이 이미지를 삭제할까요?')) return;
  projImageDel(projId, key).then(function () { _pimgRenderGrid(projId); _pimgToast('삭제됨'); })
    .catch(function () { _pimgToast('삭제 실패', 'error'); });
}

// 신규 프로젝트 저장 후 스테이징 이미지 일괄 업로드
function pimgFlushStaging(projId) {
  var staged = window._pimgStaging || [];
  window._pimgStaging = [];
  if (!projId || !staged.length) return Promise.resolve();
  return projImagesAdd(projId, staged).catch(function (e) { console.warn('[pimg] staging flush 실패', e && e.message); });
}
function pimgResetStaging() { window._pimgStaging = []; }

/* ── 라이트박스 캐러셀 (한 장씩, ◀▶) ────────────────────────────────── */
var _pimgViewer = null;
function pimgViewerFor(projId, index) {
  var list = !projId ? (window._pimgStaging || []) : (_pimgCache[projId] || null);
  if (list) { pimgOpenViewer(list, index); return; }
  projImagesGet(projId).then(function (l) { _pimgCache[projId] = l; pimgOpenViewer(l, index); }).catch(function () { _pimgToast('이미지를 불러오지 못했습니다.', 'error'); });
}
function pimgOpenViewer(list, index) {
  if (!list || !list.length) return;
  _pimgViewer = { list: list, idx: Math.max(0, Math.min(index || 0, list.length - 1)) };
  var ex = document.getElementById('pimgViewer'); if (ex) ex.remove();
  var ov = document.createElement('div'); ov.id = 'pimgViewer';
  ov.style.cssText = 'position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.86)';
  ov.onclick = function (e) { if (e.target === ov) pimgViewerClose(); };
  ov.innerHTML =
    '<button onclick="pimgViewerClose()" style="position:absolute;top:16px;right:20px;background:none;border:none;color:#fff;font-size:26px;cursor:pointer">✕</button>' +
    '<button onclick="pimgViewerNav(-1)" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.15);border:none;color:#fff;font-size:26px;width:48px;height:64px;border-radius:8px;cursor:pointer">‹</button>' +
    '<div style="max-width:92vw;max-height:88vh;display:flex;flex-direction:column;align-items:center;gap:8px">' +
      '<img id="pimgViewerImg" style="max-width:92vw;max-height:80vh;object-fit:contain;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,.5)" alt="">' +
      '<div id="pimgViewerCap" style="color:#eee;font-size:12px;text-align:center"></div>' +
    '</div>' +
    '<button onclick="pimgViewerNav(1)" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.15);border:none;color:#fff;font-size:26px;width:48px;height:64px;border-radius:8px;cursor:pointer">›</button>';
  document.body.appendChild(ov);
  _pimgViewerPaint();
  document.addEventListener('keydown', _pimgViewerKey);
}
function _pimgViewerPaint() {
  if (!_pimgViewer) return;
  var it = _pimgViewer.list[_pimgViewer.idx] || {};
  var img = document.getElementById('pimgViewerImg'); if (img) img.src = it.src || '';
  var cap = document.getElementById('pimgViewerCap');
  if (cap) cap.textContent = (_pimgViewer.idx + 1) + ' / ' + _pimgViewer.list.length + (it.caption ? ' · ' + it.caption : '');
}
function pimgViewerNav(d) {
  if (!_pimgViewer) return;
  var n = _pimgViewer.list.length;
  _pimgViewer.idx = (_pimgViewer.idx + d + n) % n;
  _pimgViewerPaint();
}
function pimgViewerClose() {
  var ov = document.getElementById('pimgViewer'); if (ov) ov.remove();
  _pimgViewer = null;
  document.removeEventListener('keydown', _pimgViewerKey);
}
function _pimgViewerKey(e) {
  if (e.key === 'Escape') pimgViewerClose();
  else if (e.key === 'ArrowLeft') pimgViewerNav(-1);
  else if (e.key === 'ArrowRight') pimgViewerNav(1);
}

/* ── 타임라인 호버 프리뷰 (개요 + 대표 이미지) ───────────────────────── */
var _tlOv = (typeof window !== 'undefined' && window._tlOv) ? window._tlOv : {};
if (typeof window !== 'undefined') window._tlOv = _tlOv;
var _pimgHoverTimer = null, _pimgHoverProj = null, _pimgHoverIdx = 0;

function pimgHover(ev, projId) {
  if (_pimgHoverTimer) { clearTimeout(_pimgHoverTimer); _pimgHoverTimer = null; }
  _pimgHoverProj = projId; _pimgHoverIdx = 0;
  var anchor = ev && ev.currentTarget ? ev.currentTarget : null;
  var card = document.getElementById('pimgPreview');
  if (!card) {
    card = document.createElement('div'); card.id = 'pimgPreview';
    card.style.cssText = 'position:fixed;z-index:10040;width:280px;background:var(--bg-p);border:1px solid var(--bd);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);padding:10px;font-size:11px;color:var(--t2);pointer-events:auto';
    card.onmouseenter = function () { if (_pimgHoverTimer) { clearTimeout(_pimgHoverTimer); _pimgHoverTimer = null; } };
    card.onmouseleave = function () { pimgHoverOut(); };
    document.body.appendChild(card);
  }
  // 위치 — 앵커 기준 우하단, 뷰포트 클램프
  var x = 80, y = 80;
  if (anchor && anchor.getBoundingClientRect) { var r = anchor.getBoundingClientRect(); x = Math.min(r.left, window.innerWidth - 296); y = Math.min(r.bottom + 8, window.innerHeight - 260); }
  card.style.left = Math.max(8, x) + 'px';
  card.style.top = Math.max(8, y) + 'px';
  card.style.display = 'block';
  _pimgRenderPreview(projId);
}
function _pimgRenderPreview(projId) {
  var card = document.getElementById('pimgPreview'); if (!card || _pimgHoverProj !== projId) return;
  var ov = _tlOv[projId] || {};
  var head =
    '<div style="font-weight:700;font-size:12px;color:var(--t1);margin-bottom:3px;display:flex;align-items:center;gap:5px">' +
      (ov.color ? '<span style="width:8px;height:8px;border-radius:50%;background:' + ov.color + ';flex-shrink:0"></span>' : '') +
      _pimgEsc(ov.name || '프로젝트') + '</div>' +
    '<div style="font-size:10px;color:var(--t5);line-height:1.6;margin-bottom:6px">' +
      (ov.statusLabel ? '<span>' + _pimgEsc(ov.statusLabel) + '</span>' : '') +
      (ov.period ? ' · ' + _pimgEsc(ov.period) : '') +
      (ov.progress != null ? ' · ' + ov.progress + '%' : '') +
      (ov.assignees ? '<br>👤 ' + _pimgEsc(ov.assignees) : '') +
    '</div>';
  var memoList = (ov.memoImgs || []).map(function (s) { return { src: s }; });
  var imgBox = '<div id="pimgPreviewImg" style="width:100%;height:158px;border-radius:8px;background:#0d0d10;display:flex;align-items:center;justify-content:center;color:var(--t6);font-size:10px;overflow:hidden;position:relative">' + (memoList.length ? '' : '사진 로딩...') + '</div>';
  card.innerHTML = head + imgBox;
  // 메모 내 이미지가 있으면 즉시 표시(서버 참고이미지가 없을 때의 폴백 + 즉시성)
  if (memoList.length) _pimgPreviewImg(projId, memoList);
  var cached = _pimgCache[projId];
  if (cached) { _pimgPreviewImg(projId, cached.length ? cached : memoList); return; }
  projImagesGet(projId).then(function (l) {
    _pimgCache[projId] = l;
    if (_pimgHoverProj === projId) _pimgPreviewImg(projId, (l && l.length) ? l : memoList);
  }).catch(function () {
    if (_pimgHoverProj === projId && !memoList.length) { var b = document.getElementById('pimgPreviewImg'); if (b) b.innerHTML = '<span style="color:var(--t6)">사진 없음</span>'; }
  });
}
var _pimgPreviewCur = null; // 현재 프리뷰에 표시 중인 이미지 리스트(서버 또는 메모)
function _pimgPreviewImg(projId, list) {
  var b = document.getElementById('pimgPreviewImg'); if (!b || _pimgHoverProj !== projId) return;
  if (!list || !list.length) { b.innerHTML = '<span style="color:var(--t6)">등록된 사진 없음</span>'; return; }
  _pimgPreviewCur = list;
  var idx = Math.max(0, Math.min(_pimgHoverIdx, list.length - 1));
  var multi = list.length > 1;
  b.style.cursor = 'zoom-in';
  b.onclick = function () { pimgOpenViewer(list, idx); };
  b.innerHTML = '<img src="' + list[idx].src + '" style="width:100%;height:100%;object-fit:contain;background:#0d0d10">' +
    '<div style="position:absolute;right:6px;bottom:5px;background:rgba(0,0,0,.62);color:#fff;font-size:9px;padding:2px 7px;border-radius:9px;backdrop-filter:blur(2px)">' + (multi ? (idx + 1) + '/' + list.length + ' · ' : '') + '🔍 클릭</div>' +
    (multi ?
      '<button onclick="event.stopPropagation();pimgPreviewNav(\'' + projId + '\',-1)" style="position:absolute;left:3px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.5);color:#fff;border:none;width:24px;height:38px;border-radius:6px;cursor:pointer;font-size:15px">‹</button>' +
      '<button onclick="event.stopPropagation();pimgPreviewNav(\'' + projId + '\',1)" style="position:absolute;right:3px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.5);color:#fff;border:none;width:24px;height:38px;border-radius:6px;cursor:pointer;font-size:15px">›</button>'
      : '');
}
function pimgPreviewNav(projId, d) {
  var list = _pimgPreviewCur; if (!list || !list.length) return;
  _pimgHoverIdx = (_pimgHoverIdx + d + list.length) % list.length;
  _pimgPreviewImg(projId, list);
}
function pimgHoverOut() {
  if (_pimgHoverTimer) clearTimeout(_pimgHoverTimer);
  _pimgHoverTimer = setTimeout(function () {
    var card = document.getElementById('pimgPreview'); if (card) card.style.display = 'none';
    _pimgHoverProj = null;
  }, 180);
}

/* ── 전역 노출 ───────────────────────────────────────────────────────── */
if (typeof window !== 'undefined') {
  window.projImagesGet = projImagesGet; window.projImagesAdd = projImagesAdd; window.projImageDel = projImageDel;
  window.renderProjImages = renderProjImages; window.pimgOnPick = pimgOnPick; window.pimgRemove = pimgRemove;
  window.pimgFlushStaging = pimgFlushStaging; window.pimgResetStaging = pimgResetStaging;
  window.pimgViewerFor = pimgViewerFor; window.pimgOpenViewer = pimgOpenViewer; window.pimgViewerNav = pimgViewerNav; window.pimgViewerClose = pimgViewerClose;
  window.pimgHover = pimgHover; window.pimgHoverOut = pimgHoverOut; window.pimgPreviewNav = pimgPreviewNav;
  window.pimgDownscale = _pimgDownscale; // 메모 이미지 등 다른 모듈에서 압축 재사용
  window.pimgDownscaleDataUrl = pimgDownscaleDataUrl;
  window.pimgCompressMemoHtml = pimgCompressMemoHtml;
}
