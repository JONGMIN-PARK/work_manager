/**
 * 📄 문서 미리보기 (v13.524) — 문서 화면 미리보기 칸 · ⛶ 크게 보기 · 프로젝트 📂 문서 탭이 함께 쓴다.
 *
 *  원본 받기  docFetchRaw(file)      서버 /api/docs/files/:id/raw (같은 출처 — 버킷 CORS 와 무관) → 안 되면 서명 URL
 *  그리기     docPreviewInto(el, file, data, opts)   형식별:
 *    PDF   pdf.js 로 쪽마다 그림(보일 때 그림 · PC 앱처럼 PDF 보기 기능이 없는 곳에서도)
 *    PPTX  슬라이드 XML 을 읽어 모양 그대로(위치 · 글꼴 크기 · 색 · 그림 · 표 · 배경 · 마스터 장식)
 *    DOCX  mammoth(서식 · 그림) · XLSX/XLS 시트 탭 · CSV/TSV 표
 *    글    txt · md · 코드 · 설정 등 — UTF-8 이 아니면 EUC-KR(한글 윈도 메모장) 로 읽음, 형식을 몰라도 글이면 글로
 *    그림  png · jpg · gif · bmp · webp · svg · avif · ico     동영상/소리  mp4 · webm · mov · mp3 · wav · m4a …
 *    HWP/HWPX  파일 안의 첫 쪽 미리보기 그림 + 미리보기 글     ZIP  안의 파일 목록
 *    그 밖(DOC · PPT 옛 형식 등)  안내 + 내려받기 + (선택) Office 뷰어
 *  크게 보기  docViewFile(fileOrId)   화면 가득 — Esc · ✕ 로 닫음, 표준 가드(wmGuardedModal)
 */

/* ═══ 형식 ═══ */
var DP_IMG = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'avif', 'ico'];
var DP_VIDEO = ['mp4', 'm4v', 'webm', 'mov', 'ogv'];
var DP_AUDIO = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'];
var DP_TEXT = ['txt', 'log', 'md', 'markdown', 'json', 'xml', 'csv', 'tsv', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'toml', 'sql', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'kt',
  'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'html', 'htm', 'css', 'scss', 'bat', 'cmd', 'sh', 'ps1', 'properties', 'env', 'gcode', 'nc', 'st', 'scl', 'awl',
  'prg', 'mpf', 'spf', 'vb', 'vbs', 'bas', 'lua', 'r', 'm', 'srt', 'vtt', 'rtf', 'svg_'];
var DP_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  ico: 'image/x-icon', emf: 'image/emf', wmf: 'image/wmf', tif: 'image/tiff', tiff: 'image/tiff', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/mp4',
  ogv: 'video/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg', pdf: 'application/pdf' };

function _dpExt(f) {
  var e = String((f && f.ext) || '').toLowerCase().replace(/^\./, '');
  if (!e && f && f.name && f.name.indexOf('.') >= 0) e = f.name.split('.').pop().toLowerCase();
  return e;
}
function _dpEsc(s) { return typeof eH === 'function' ? eH(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

/* 만든 blob 주소 — 다른 파일로 바꾸거나 창을 닫으면 돌려줌 */
function _dpBlobUrl(bag, data, type) {
  var u = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' }));
  if (bag) bag.push(u);
  return u;
}
function _dpFreeUrls(bag) { (bag || []).forEach(function (u) { try { URL.revokeObjectURL(u); } catch (_) {} }); if (bag) bag.length = 0; }

/* ═══ 원본 받기 — 최근 몇 개는 기억(미리보기 → 크게 보기에서 다시 받지 않게) ═══ */
var _dpCache = [];   // [{id, data, at}] — 합계 80MB 까지
function _dpCacheGet(id) { var h = _dpCache.filter(function (x) { return x.id === id; })[0]; return h ? h.data : null; }
function _dpCachePut(id, data) {
  _dpCache = _dpCache.filter(function (x) { return x.id !== id; });
  _dpCache.unshift({ id: id, data: data });
  var sum = 0;
  _dpCache = _dpCache.filter(function (x, i) { sum += x.data.byteLength || 0; return i === 0 || sum <= 80 * 1024 * 1024; });
}
async function docFetchRaw(f) {
  if (!f) return null;
  if (f.data) return f.data;
  var hit = _dpCacheGet(f.id);
  if (hit) return hit;
  if (!f.storageKey && !f.storage_key) return null;
  var data = null, err = null;
  // ① 같은 출처 — 토큰이 만료됐으면 apiFetch 로 한 번 깨워서 다시
  for (var t = 0; t < 2 && !data; t++) {
    try {
      var h = {};
      if (typeof _accessToken !== 'undefined' && _accessToken) h.Authorization = 'Bearer ' + _accessToken;
      var r = await fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/docs/files/' + encodeURIComponent(f.id) + '/raw', { headers: h });
      if (r.status === 401 && t === 0 && typeof apiFetch === 'function') { try { await apiFetch('/api/auth/me'); } catch (_) {} continue; }
      if (r.ok) data = await r.arrayBuffer();
      else { var j = null; try { j = await r.json(); } catch (_) {} err = new Error((j && j.message) || ('HTTP ' + r.status)); err.status = r.status; break; }
    } catch (e) { err = e; break; }
  }
  // ② 예전 길 — 서명 URL 에서 직접 (서버가 원본을 못 읽을 때)
  if (!data && !(err && (err.status === 403 || err.status === 404))) {
    try {
      var dl = await apiFetch('/api/docs/files/' + encodeURIComponent(f.id) + '/download-url');
      if (dl && dl.data && dl.data.downloadUrl) { var r2 = await fetch(dl.data.downloadUrl); if (r2.ok) data = await r2.arrayBuffer(); }
    } catch (e2) { if (!err) err = e2; }
  }
  if (!data) throw err || new Error('원본을 받지 못했습니다');
  _dpCachePut(f.id, data);
  return data;
}

/* ═══ 글자 — UTF-8 이 아니면 EUC-KR · UTF-16 ═══ */
function docDecodeText(buf) {
  var u8 = new Uint8Array(buf);
  if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) u8 = u8.subarray(3);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
  catch (_) { try { return new TextDecoder('euc-kr').decode(u8); } catch (e) { return new TextDecoder('utf-8').decode(u8); } }
}
/* 앞부분에 0 바이트가 없고 제어 문자가 적으면 글 파일로 본다 */
function _dpLooksText(buf) {
  var u8 = new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096)), bad = 0;
  if (!u8.length) return false;
  if ((u8[0] === 0xFF && u8[1] === 0xFE) || (u8[0] === 0xFE && u8[1] === 0xFF)) return true;
  for (var i = 0; i < u8.length; i++) { var c = u8[i]; if (c === 0) return false; if (c < 9 || (c > 13 && c < 32)) bad++; }
  return bad / u8.length < 0.02;
}

/* ═══ 필요한 도구 ═══ */
function _dpNeed(ext) {
  if (typeof wmLib !== 'function') return Promise.resolve();
  var need = ext === 'pdf' ? ['pdfjs'] : (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'csv' || ext === 'tsv' || ext === 'hwp') ? ['xlsx'] :
    ext === 'docx' ? ['jszip', 'mammoth'] : (ext === 'pptx' || ext === 'ppsx' || ext === 'hwpx' || ext === 'zip') ? ['jszip'] : null;
  return need ? wmLib(need).catch(function () {}) : Promise.resolve();
}

/* ═══ 그리기 ═══
   el: 넣을 곳 · data: ArrayBuffer · opts: { big: 크게 보기, isStale(): 그사이 다른 파일로 바뀜, signedUrl, onLink }
   el.__dpCleanup 에 정리 함수(관찰자 · blob 주소)를 달아 둔다 — 다음 그리기 전에 부른다 */
async function docPreviewInto(el, f, data, opts) {
  opts = opts || {};
  if (el.__dpCleanup) { try { el.__dpCleanup(); } catch (_) {} el.__dpCleanup = null; }
  var ext = _dpExt(f), bag = [], obs = [];
  var stale = function () { return (opts.isStale && opts.isStale()) || !el.isConnected; };
  el.__dpCleanup = function () { obs.forEach(function (o) { try { o.disconnect(); } catch (_) {} }); _dpFreeUrls(bag); };
  var ctx = { el: el, f: f, ext: ext, bag: bag, obs: obs, big: !!opts.big, stale: stale, opts: opts };
  await _dpNeed(ext);
  if (stale()) return;
  try {
    if (DP_IMG.indexOf(ext) >= 0) return _dpImage(ctx, data);
    if (ext === 'pdf') return await _dpPdf(ctx, data);
    if (ext === 'pptx' || ext === 'ppsx') return await _dpPptx(ctx, data);
    if (ext === 'docx') return await _dpDocx(ctx, data);
    if ((ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') && typeof XLSX !== 'undefined') return _dpSheet(ctx, XLSX.read(data, { type: 'array' }));
    if (ext === 'csv' || ext === 'tsv') return _dpCsv(ctx, data);
    if (DP_VIDEO.indexOf(ext) >= 0 || DP_AUDIO.indexOf(ext) >= 0) return _dpMedia(ctx, data);
    if (ext === 'hwpx') return await _dpHwpx(ctx, data);
    if (ext === 'hwp') return _dpHwp(ctx, data);
    if (ext === 'zip') return await _dpZip(ctx, data);
    if (DP_TEXT.indexOf(ext) >= 0 || _dpLooksText(data)) return _dpText(ctx, data);
    return _dpFallback(ctx);
  } catch (e) {
    console.warn('[docPreview]', ext, e);
    if (stale()) return;
    el.innerHTML = '<div class="dp-msg">미리보기를 그리지 못했습니다' + (e && e.message ? ' — ' + _dpEsc(e.message) : '') + '</div>' + _dpFallbackBtns(ctx);
  }
}

function _dpImage(ctx, data) {
  var u = _dpBlobUrl(ctx.bag, data, DP_MIME[ctx.ext]);
  ctx.el.innerHTML = '<div class="dp-img' + (ctx.big ? ' big' : '') + '"><img src="' + u + '" alt="' + _dpEsc(ctx.f.name) + '"></div>';
  var img = ctx.el.querySelector('img');
  img.onerror = function () { ctx.el.innerHTML = '<div class="dp-msg">이 그림 형식은 브라우저가 보여 주지 못합니다.</div>' + _dpFallbackBtns(ctx); };
  // 크게 보기: 눌러서 원래 크기 ↔ 화면 맞춤
  if (ctx.big) img.onclick = function () { img.parentNode.classList.toggle('full'); };
}

function _dpMedia(ctx, data) {
  var video = DP_VIDEO.indexOf(ctx.ext) >= 0;
  var u = _dpBlobUrl(ctx.bag, data, DP_MIME[ctx.ext]);
  ctx.el.innerHTML = '<div class="dp-media">' + (video ? '<video controls preload="metadata" src="' + u + '"></video>' : '<div class="dp-audio-ic">🎵</div><audio controls preload="metadata" src="' + u + '"></audio>') + '</div>';
  var m = ctx.el.querySelector(video ? 'video' : 'audio');
  m.onerror = function () { ctx.el.innerHTML = '<div class="dp-msg">이 ' + (video ? '동영상' : '소리') + ' 형식은 브라우저가 재생하지 못합니다.</div>' + _dpFallbackBtns(ctx); };
}

function _dpText(ctx, data) {
  var text = docDecodeText(data), MAX = ctx.big ? 400000 : 120000, cut = text.length > MAX;
  if (cut) text = text.slice(0, MAX);
  var html;
  if ((ctx.ext === 'md' || ctx.ext === 'markdown') && typeof _docMD === 'function') html = '<div class="dp-md">' + _docMD(text) + '</div>';
  else if (ctx.ext === 'json') { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (_) {} html = '<pre class="dp-pre">' + _dpEsc(text) + '</pre>'; }
  else html = '<pre class="dp-pre">' + _dpEsc(text) + '</pre>';
  ctx.el.innerHTML = html + (cut ? '<div class="dp-note">앞부분만 보여 줍니다 — 전체는 내려받아 보세요.</div>' : '');
}

function _dpCsv(ctx, data) {
  var text = docDecodeText(data);
  if (typeof XLSX !== 'undefined') {
    var wb = XLSX.read(text, { type: 'string', FS: ctx.ext === 'tsv' ? '\t' : undefined, raw: true });
    return _dpSheet(ctx, wb);
  }
  return _dpText(ctx, data);
}

function _dpSheet(ctx, wb) {
  var names = wb.SheetNames || [];
  var tabs = names.length > 1 ? '<div class="dp-tabs">' + names.map(function (n, i) { return '<button type="button" class="btn btn-s ' + (i ? 'btn-g' : 'btn-p') + '" data-i="' + i + '">' + _dpEsc(n) + '</button>'; }).join('') + '</div>' : '';
  var body = names.map(function (n, i) {
    var sh = wb.Sheets[n], rng = sh && sh['!ref'] ? XLSX.utils.decode_range(sh['!ref']) : null, cut = false;
    if (rng && rng.e.r - rng.s.r > 2000) { cut = true; sh = Object.assign({}, sh, { '!ref': XLSX.utils.encode_range({ s: rng.s, e: { r: rng.s.r + 2000, c: rng.e.c } }) }); }
    return '<div class="dp-sheet" data-i="' + i + '"' + (i ? ' hidden' : '') + '>' + XLSX.utils.sheet_to_html(sh, { editable: false }).replace(/^[\s\S]*?<table/i, '<table').replace(/<\/table>[\s\S]*$/i, '</table>') +
      (cut ? '<div class="dp-note">앞 2,000줄만 보여 줍니다.</div>' : '') + '</div>';
  }).join('');
  ctx.el.innerHTML = tabs + '<div class="dp-sheets">' + body + '</div>';
  ctx.el.querySelectorAll('.dp-tabs button').forEach(function (b) {
    b.onclick = function () {
      ctx.el.querySelectorAll('.dp-tabs button').forEach(function (x) { x.className = 'btn btn-s ' + (x === b ? 'btn-p' : 'btn-g'); });
      ctx.el.querySelectorAll('.dp-sheet').forEach(function (s) { s.hidden = s.getAttribute('data-i') !== b.getAttribute('data-i'); });
    };
  });
}

async function _dpDocx(ctx, data) {
  if (typeof mammoth === 'undefined') throw new Error('Word 도구를 불러오지 못했습니다');
  var conv = await mammoth.convertToHtml({ arrayBuffer: data.slice(0) });
  if (ctx.stale()) return;
  var html = (conv && conv.value) || '';
  // 문서 안 링크 — javascript: 같은 주소는 지우고, 새 창으로
  var box = document.createElement('div');
  box.innerHTML = html;
  box.querySelectorAll('script,iframe,object,embed').forEach(function (n) { n.remove(); });
  box.querySelectorAll('[href]').forEach(function (a) { if (!/^(https?:|mailto:|#)/i.test(a.getAttribute('href') || '')) a.removeAttribute('href'); else { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); } });
  box.querySelectorAll('*').forEach(function (n) { Array.prototype.slice.call(n.attributes).forEach(function (at) { if (/^on/i.test(at.name)) n.removeAttribute(at.name); }); });
  ctx.el.innerHTML = '<div class="dp-paper"><div class="dp-word">' + (box.innerHTML || '<p style="color:#888">(본문이 비어 있습니다)</p>') + '</div></div>';
}

/* ─── PDF — 쪽마다 캔버스, 보일 때 그림 ─── */
async function _dpPdf(ctx, data) {
  if (typeof pdfjsLib === 'undefined') {   // 도구가 없으면 브라우저 PDF 보기로
    var u = _dpBlobUrl(ctx.bag, data, 'application/pdf');
    ctx.el.innerHTML = '<iframe class="dp-pdf-frame" src="' + u + '"></iframe>';
    return;
  }
  var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;   // pdf.js 가 버퍼를 가져가므로 복사본
  if (ctx.stale()) { pdf.destroy(); return; }
  var n = pdf.numPages, first = await pdf.getPage(1), vp1 = first.getViewport({ scale: 1 });
  var openUrl = _dpBlobUrl(ctx.bag, data, 'application/pdf');
  var html = '<div class="dp-bar"><span>' + n + '쪽</span><a href="' + openUrl + '" target="_blank" rel="noopener">🔗 새 탭에서 열기</a></div><div class="dp-pages">';
  for (var i = 1; i <= n; i++) html += '<div class="dp-page" data-p="' + i + '" style="aspect-ratio:' + vp1.width + '/' + vp1.height + '"><span class="dp-pno">' + i + '</span></div>';
  ctx.el.innerHTML = html + '</div>';
  var busy = {};
  var draw = async function (box, ahead) {
    var p = +box.getAttribute('data-p'), w = box.clientWidth;
    var next = function () { var nx = ahead > 0 && ctx.el.querySelector('.dp-page[data-p="' + (p + 1) + '"]'); if (nx) setTimeout(function () { if (!ctx.stale()) draw(nx, ahead - 1).catch(function () {}); }, 30); };
    if (!w || busy[p] === w) return next();
    busy[p] = w;
    var page = p === 1 ? first : await pdf.getPage(p);
    var vp = page.getViewport({ scale: 1 });
    box.style.aspectRatio = vp.width + '/' + vp.height;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5), scale = (w * dpr) / vp.width;
    var cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width * scale); cv.height = Math.floor(vp.height * scale);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: page.getViewport({ scale: scale }) }).promise;
    if (ctx.stale()) return;
    var old = box.querySelector('canvas'); if (old) old.remove();
    box.insertBefore(cv, box.firstChild);
    next();
  };
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) draw(e.target, 2).catch(function (er) { if (!/Cancel/.test(er && er.name || '')) console.warn('[pdf page]', er); }); }); }, { root: null, rootMargin: '600px 0px' });
  ctx.el.querySelectorAll('.dp-page').forEach(function (b) { io.observe(b); });
  draw(ctx.el.querySelector('.dp-page'), 1).catch(function () {});   // 첫 쪽은 바로 (칸이 화면 아래에 있어도 스크롤하면 곧장 보이게)
  ctx.obs.push(io);
  // 폭이 바뀌면(크게 보기 · 창 크기) 보이는 쪽을 다시 선명하게
  var tm = null, ro = new ResizeObserver(function () { clearTimeout(tm); tm = setTimeout(function () { ctx.el.querySelectorAll('.dp-page').forEach(function (b) { var r = b.getBoundingClientRect(); if (r.bottom > -600 && r.top < innerHeight + 600) draw(b).catch(function () {}); }); }, 250); });
  ro.observe(ctx.el);
  ctx.obs.push(ro, { disconnect: function () { try { pdf.destroy(); } catch (_) {} } });
}

/* ─── PPTX — 슬라이드 모양 그대로 ─── */
var _DP_EMU_PT = 12700;   // 1pt = 12700 EMU → 슬라이드를 pt 단위 px 로 그린 뒤 폭에 맞춰 줄임
function _dpX(s) { return new DOMParser().parseFromString(s, 'application/xml'); }
function _dpK(el, name) { var out = []; if (!el) return out; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) out.push(c); return out; }
function _dpK1(el, name) { return _dpK(el, name)[0] || null; }
function _dpPath(el) { for (var i = 1; i < arguments.length && el; i++) el = _dpK1(el, arguments[i]); return el || null; }
function _dpDesc(el, name) { return el ? el.getElementsByTagNameNS('*', name) : []; }
function _dpDir(p) { return p.slice(0, p.lastIndexOf('/') + 1); }
function _dpJoin(base, rel) {
  if (/^\//.test(rel)) return rel.slice(1);
  var parts = (base + rel).split('/'), out = [];
  parts.forEach(function (x) { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); });
  return out.join('/');
}
async function _dpRels(zip, path) {
  var rp = _dpDir(path) + '_rels/' + path.slice(path.lastIndexOf('/') + 1) + '.rels', map = {};
  var f = zip.file(rp); if (!f) return map;
  var x = _dpX(await f.async('string'));
  Array.prototype.forEach.call(_dpDesc(x, 'Relationship'), function (r) {
    map[r.getAttribute('Id')] = { target: r.getAttribute('TargetMode') === 'External' ? null : _dpJoin(_dpDir(path), r.getAttribute('Target') || ''), type: r.getAttribute('Type') || '' };
  });
  return map;
}
function _dpRelOf(rels, type) { for (var k in rels) if (rels[k].type.slice(-type.length - 1) === '/' + type) return rels[k].target; return null; }

/* 색 — srgb · scheme(테마 · clrMap) · sys · prst + 밝기 조정 */
function _dpHex2(h) { h = String(h || '').replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function _dpRgbHsl(c) {
  var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
  if (mx !== mn) { var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h, s, l];
}
function _dpHslRgb(h, s, l) {
  if (!s) return [l * 255, l * 255, l * 255];
  var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  var f = function (t) { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
var _DP_PRST = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080' };
function _dpColor(el, th) {
  if (!el) return null;
  var c = null, src = null;
  for (var k = el.firstElementChild; k; k = k.nextElementSibling) {
    if (k.localName === 'srgbClr') { c = k.getAttribute('val'); src = k; }
    else if (k.localName === 'schemeClr') { var v = k.getAttribute('val'); v = (th.map && th.map[v]) || v; c = th.colors[v] || null; src = k; }
    else if (k.localName === 'sysClr') { c = k.getAttribute('lastClr') || (k.getAttribute('val') === 'window' ? 'FFFFFF' : '000000'); src = k; }
    else if (k.localName === 'prstClr') { c = _DP_PRST[k.getAttribute('val')] || '000000'; src = k; }
    else if (k.localName === 'scrgbClr') { c = [k.getAttribute('r'), k.getAttribute('g'), k.getAttribute('b')].map(function (x) { return ('0' + Math.round((+x || 0) / 100000 * 255).toString(16)).slice(-2); }).join(''); src = k; }
    if (src) break;
  }
  if (!c) return null;
  var rgb = _dpHex2(c), a = 1;
  for (var m = src.firstElementChild; m; m = m.nextElementSibling) {
    var val = (+m.getAttribute('val') || 0) / 100000, hsl;
    if (m.localName === 'lumMod' || m.localName === 'lumOff') { hsl = _dpRgbHsl(rgb); hsl[2] = m.localName === 'lumMod' ? hsl[2] * val : hsl[2] + val; rgb = _dpHslRgb(hsl[0], hsl[1], Math.max(0, Math.min(1, hsl[2]))); }
    else if (m.localName === 'tint') rgb = rgb.map(function (x) { return x + (255 - x) * (1 - val); });
    else if (m.localName === 'shade') rgb = rgb.map(function (x) { return x * val; });
    else if (m.localName === 'alpha') a = val;
  }
  rgb = rgb.map(function (x) { return Math.max(0, Math.min(255, Math.round(x))); });
  return a < 1 ? 'rgba(' + rgb.join(',') + ',' + a.toFixed(2) + ')' : 'rgb(' + rgb.join(',') + ')';
}
function _dpScheme(v, th) { var c = th.colors[(th.map && th.map[v]) || v]; return c ? '#' + c : '#000'; }
function _dpFill(spPr, th) {
  if (!spPr) return undefined;
  if (_dpK1(spPr, 'noFill')) return null;
  var sf = _dpK1(spPr, 'solidFill'); if (sf) return _dpColor(sf, th);
  var gf = _dpK1(spPr, 'gradFill');
  if (gf) {
    var st = _dpDesc(gf, 'gs'), cs = Array.prototype.map.call(st, function (g) { return _dpColor(g, th) + ' ' + Math.round((+g.getAttribute('pos') || 0) / 1000) + '%'; });
    var lin = _dpDesc(gf, 'lin')[0], ang = lin ? (+lin.getAttribute('ang') || 0) / 60000 + 90 : 180;
    return cs.length ? 'linear-gradient(' + ang + 'deg,' + cs.join(',') + ')' : undefined;
  }
  return undefined;
}

/* 자리(placeholder) — 슬라이드의 모양이 위치 · 글꼴을 레이아웃 · 마스터에서 물려받는다 */
function _dpPh(sp) { var nv = sp.firstElementChild, ph = nv ? _dpDesc(nv, 'ph')[0] : null; return ph ? { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') } : null; }
function _dpPhMap(spTree) {
  var m = { byIdx: {}, byType: {} };
  if (!spTree) return m;
  Array.prototype.forEach.call(_dpDesc(spTree, 'sp'), function (sp) {
    var ph = _dpPh(sp); if (!ph) return;
    if (ph.idx != null && !m.byIdx[ph.idx]) m.byIdx[ph.idx] = sp;
    if (!m.byType[ph.type]) m.byType[ph.type] = sp;
  });
  return m;
}
function _dpPhFind(map, ph) {
  if (!map || !ph) return null;
  var t = ph.type === 'ctrTitle' ? 'title' : ph.type === 'subTitle' ? 'body' : ph.type;
  return (ph.idx != null && map.byIdx[ph.idx]) || map.byType[ph.type] || map.byType[t] || null;
}
function _dpXfrm(sp) {
  var spPr = _dpK1(sp, 'spPr') || _dpK1(sp, 'grpSpPr'), x = spPr ? _dpK1(spPr, 'xfrm') : _dpK1(sp, 'xfrm');
  if (!x) return null;
  var off = _dpK1(x, 'off'), ext = _dpK1(x, 'ext');
  if (!off || !ext) return null;
  var r = { x: +off.getAttribute('x') || 0, y: +off.getAttribute('y') || 0, w: +ext.getAttribute('cx') || 0, h: +ext.getAttribute('cy') || 0,
    rot: (+x.getAttribute('rot') || 0) / 60000, flipH: x.getAttribute('flipH') === '1', flipV: x.getAttribute('flipV') === '1' };
  var co = _dpK1(x, 'chOff'), ce = _dpK1(x, 'chExt');
  if (co && ce) { r.cx = +co.getAttribute('x') || 0; r.cy = +co.getAttribute('y') || 0; r.cw = +ce.getAttribute('cx') || 1; r.ch = +ce.getAttribute('cy') || 1; }
  return r;
}
/* 글꼴 크기 — 모양 lstStyle → 레이아웃 · 마스터 자리 lstStyle → 마스터 txStyles */
function _dpLvlSz(lst, lvl) { if (!lst) return null; var p = _dpK1(lst, 'lvl' + (lvl + 1) + 'pPr'), d = p ? _dpK1(p, 'defRPr') : null; return d && d.getAttribute('sz') ? +d.getAttribute('sz') / 100 : null; }
function _dpLvlClr(lst, lvl, th) { if (!lst) return null; var p = _dpK1(lst, 'lvl' + (lvl + 1) + 'pPr'), d = p ? _dpK1(p, 'defRPr') : null, sf = d ? _dpK1(d, 'solidFill') : null; return sf ? _dpColor(sf, th) : null; }
function _dpLvlBu(lst, lvl) { if (!lst) return undefined; var p = _dpK1(lst, 'lvl' + (lvl + 1) + 'pPr'); if (!p) return undefined; if (_dpK1(p, 'buNone')) return null; var bc = _dpK1(p, 'buChar'); return bc ? bc.getAttribute('char') : undefined; }

async function _dpPptx(ctx, data) {
  if (typeof JSZip === 'undefined') throw new Error('압축 도구를 불러오지 못했습니다');
  var zip = await JSZip.loadAsync(data);
  var presPath = 'ppt/presentation.xml', pres = _dpX(await zip.file(presPath).async('string'));
  var sz = _dpDesc(pres, 'sldSz')[0], W = (+(sz && sz.getAttribute('cx')) || 9144000) / _DP_EMU_PT, H = (+(sz && sz.getAttribute('cy')) || 6858000) / _DP_EMU_PT;
  var presRels = await _dpRels(zip, presPath);
  var ids = Array.prototype.map.call(_dpDesc(_dpDesc(pres, 'sldIdLst')[0], 'sldId'), function (s) { return s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id'); });
  var slides = ids.map(function (id) { return presRels[id] && presRels[id].target; }).filter(Boolean);
  if (!slides.length) slides = Object.keys(zip.files).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); }).sort(function (a, b) { return (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]); });
  // 숨긴 슬라이드도 보여 주되 표시
  var cache = {};   // 레이아웃 · 마스터 · 테마 한 번만 읽기
  var part = async function (p) {
    if (!cache[p]) cache[p] = (async function () { var f = zip.file(p); if (!f) return null; return { path: p, x: _dpX(await f.async('string')), rels: await _dpRels(zip, p) }; })();
    return cache[p];
  };
  ctx.el.innerHTML = '<div class="dp-bar"><span>슬라이드 ' + slides.length + '장</span></div><div class="dp-slides">' +
    slides.map(function (s, i) { return '<div class="dp-slide-wrap" data-i="' + i + '" style="aspect-ratio:' + W + '/' + H + '"><span class="dp-pno">' + (i + 1) + '</span></div>'; }).join('') + '</div>';
  var done = {};
  /* ahead: 그린 뒤 다음 몇 장을 미리(칸 안에서 빠르게 넘겨도 빈 슬라이드가 덜 보이게) */
  var render = async function (wrap, ahead) {
    var i = +wrap.getAttribute('data-i');
    var next = function () { var nx = ahead > 0 && ctx.el.querySelector('.dp-slide-wrap[data-i="' + (i + 1) + '"]'); if (nx) setTimeout(function () { if (!ctx.stale()) render(nx, ahead - 1).catch(function () {}); }, 30); };
    if (done[i]) return next(); done[i] = true;
    var sl = await part(slides[i]); if (!sl) return;
    var layout = await part(_dpRelOf(sl.rels, 'slideLayout') || ''), master = layout ? await part(_dpRelOf(layout.rels, 'slideMaster') || '') : null;
    var theme = master ? await part(_dpRelOf(master.rels, 'theme') || '') : null;
    var th = { colors: {}, map: {}, fonts: {} };
    if (theme) {
      var cs = _dpDesc(theme.x, 'clrScheme')[0];
      for (var c = cs && cs.firstElementChild; c; c = c.nextElementSibling) { var v = c.firstElementChild; if (v) th.colors[c.localName] = v.getAttribute('val') && v.localName === 'srgbClr' ? v.getAttribute('val') : (v.getAttribute('lastClr') || '000000'); }
      var mj = _dpDesc(_dpDesc(theme.x, 'majorFont')[0], 'latin')[0], mn = _dpDesc(_dpDesc(theme.x, 'minorFont')[0], 'latin')[0];
      th.fonts.major = mj && mj.getAttribute('typeface'); th.fonts.minor = mn && mn.getAttribute('typeface');
    }
    var cm = master ? _dpDesc(master.x, 'clrMap')[0] : null;
    if (cm) Array.prototype.forEach.call(cm.attributes, function (a) { th.map[a.name] = a.value; });
    var ov = _dpDesc(sl.x, 'overrideClrMapping')[0];
    if (ov) Array.prototype.forEach.call(ov.attributes, function (a) { th.map[a.name] = a.value; });
    var env = { ctx: ctx, zip: zip, th: th, W: W, H: H,
      lPh: layout ? _dpPhMap(_dpDesc(layout.x, 'spTree')[0]) : null, mPh: master ? _dpPhMap(_dpDesc(master.x, 'spTree')[0]) : null,
      tx: master ? _dpDesc(master.x, 'txStyles')[0] : null };
    var slide = document.createElement('div');
    slide.className = 'dp-slide';
    slide.style.width = W + 'px'; slide.style.height = H + 'px';
    // 배경 — 슬라이드 → 레이아웃 → 마스터
    var bgEl = null, bgPart = null;
    [sl, layout, master].some(function (pt) { if (!pt) return false; var bg = _dpDesc(pt.x, 'bg')[0]; if (bg) { bgEl = bg; bgPart = pt; return true; } return false; });
    slide.style.background = '#fff';
    if (bgEl) {
      var bgPr = _dpK1(bgEl, 'bgPr'), bgRef = _dpK1(bgEl, 'bgRef');
      if (bgPr) {
        var blip = _dpDesc(bgPr, 'blip')[0];
        if (blip) { var bu = await _dpImgUrl(env, bgPart, blip); if (bu) slide.style.background = 'url("' + bu + '") center/cover no-repeat'; }
        else { var fl = _dpFill(bgPr, th); if (fl) slide.style.background = fl; }
      } else if (bgRef) { var rc = _dpColor(bgRef, th); if (rc) slide.style.background = rc; }
    }
    // 마스터 · 레이아웃의 장식(자리 아닌 모양) → 슬라이드 모양
    var showM = function (pt) { var r = pt && pt.x.documentElement; return !(r && r.getAttribute('showMasterSp') === '0'); };
    if (master && showM(sl) && showM(layout)) await _dpTree(env, master, _dpDesc(master.x, 'spTree')[0], slide, null, true);
    if (layout && showM(sl)) await _dpTree(env, layout, _dpDesc(layout.x, 'spTree')[0], slide, null, true);
    await _dpTree(env, sl, _dpDesc(sl.x, 'spTree')[0], slide, null, false);
    if (ctx.stale()) return;
    if (sl.x.documentElement.getAttribute('show') === '0') { var hb = document.createElement('span'); hb.className = 'dp-hidden'; hb.textContent = '숨긴 슬라이드'; wrap.appendChild(hb); }
    wrap.appendChild(slide);
    fit(wrap);
    next();
  };
  var fit = function (wrap) { var s = wrap.querySelector('.dp-slide'); if (s && wrap.clientWidth) s.style.transform = 'scale(' + (wrap.clientWidth / W) + ')'; };
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) render(e.target, 2).catch(function (er) { console.warn('[pptx slide]', er); e.target.insertAdjacentHTML('beforeend', '<div class="dp-msg">이 슬라이드를 그리지 못했습니다</div>'); }); }); }, { rootMargin: '500px 0px' });
  ctx.el.querySelectorAll('.dp-slide-wrap').forEach(function (w) { io.observe(w); });
  var w0 = ctx.el.querySelector('.dp-slide-wrap'); if (w0) render(w0, 1).catch(function () {});   // 첫 슬라이드는 바로
  var ro = new ResizeObserver(function () { ctx.el.querySelectorAll('.dp-slide-wrap').forEach(fit); });
  ro.observe(ctx.el);
  ctx.obs.push(io, ro);
}

async function _dpImgUrl(env, pt, blip) {
  var rid = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || blip.getAttribute('r:embed');
  var rel = rid && pt.rels[rid]; if (!rel || !rel.target) return null;
  var f = env.zip.file(rel.target); if (!f) return null;
  var ext = rel.target.split('.').pop().toLowerCase();
  if (ext === 'emf' || ext === 'wmf' || ext === 'tif' || ext === 'tiff') return null;   // 브라우저가 못 그리는 그림
  return _dpBlobUrl(env.ctx.bag, await f.async('blob').then(function (b) { return new Blob([b], { type: DP_MIME[ext] || 'image/png' }); }));
}

/* 모양 나무 — grp 는 자식 좌표를 바깥 좌표로 바꿔 그림. tf: 좌표 바꾸는 함수 */
async function _dpTree(env, pt, tree, host, tf, decoOnly) {
  if (!tree) return;
  for (var n = tree.firstElementChild; n; n = n.nextElementSibling) {
    var nm = n.localName;
    if (nm === 'AlternateContent') { var ch = _dpK1(n, 'Choice') || _dpK1(n, 'Fallback'); if (ch) await _dpTree(env, pt, ch, host, tf, decoOnly); continue; }
    if (decoOnly && (nm === 'sp' || nm === 'pic') && _dpPh(n)) continue;   // 마스터 · 레이아웃의 자리는 그리지 않음(슬라이드가 채움)
    if (nm === 'grpSp') {
      var gx = _dpXfrm(n);
      var inner = gx && gx.cw ? (function (g, outer) {
        return function (r) { var sx = g.w / g.cw, sy = g.h / g.ch; var o = { x: g.x + (r.x - g.cx) * sx, y: g.y + (r.y - g.cy) * sy, w: r.w * sx, h: r.h * sy, rot: r.rot, flipH: r.flipH, flipV: r.flipV }; return outer ? outer(o) : o; };
      })(gx, tf) : tf;
      await _dpTree(env, pt, n, host, inner, decoOnly);
      continue;
    }
    if (nm === 'sp' || nm === 'cxnSp') await _dpShape(env, pt, n, host, tf);
    else if (nm === 'pic') await _dpPic(env, pt, n, host, tf);
    else if (nm === 'graphicFrame') _dpFrame(env, n, host, tf);
  }
}
function _dpBox(r, tf) {
  if (tf) r = tf(r);
  var d = document.createElement('div');
  d.className = 'dp-sh';
  d.style.cssText = 'left:' + (r.x / _DP_EMU_PT) + 'px;top:' + (r.y / _DP_EMU_PT) + 'px;width:' + (r.w / _DP_EMU_PT) + 'px;height:' + (r.h / _DP_EMU_PT) + 'px';
  var t = [];
  if (r.rot) t.push('rotate(' + r.rot + 'deg)');
  if (r.flipH) t.push('scaleX(-1)');
  if (r.flipV) t.push('scaleY(-1)');
  if (t.length) d.style.transform = t.join(' ');
  return { d: d, r: r };
}
async function _dpShape(env, pt, sp, host, tf) {
  var ph = _dpPh(sp), lsp = ph ? _dpPhFind(env.lPh, ph) : null, msp = ph ? (_dpPhFind(env.mPh, ph) || (lsp && _dpPhFind(env.mPh, _dpPh(lsp)))) : null;
  var xf = _dpXfrm(sp) || (lsp && _dpXfrm(lsp)) || (msp && _dpXfrm(msp));
  if (!xf) return;
  var txBody = _dpK1(sp, 'txBody');
  var hasText = txBody && Array.prototype.some.call(_dpDesc(txBody, 't'), function (t) { return t.textContent; });
  var spPr = _dpK1(sp, 'spPr'), th = env.th;
  var geom = spPr && _dpK1(spPr, 'prstGeom'), prst = geom ? geom.getAttribute('prst') : 'rect';
  var fill = _dpFill(spPr, th);
  var style = _dpK1(sp, 'style');
  if (fill === undefined && style) { var fr = _dpK1(style, 'fillRef'); if (fr && fr.getAttribute('idx') !== '0') fill = _dpColor(fr, th); }
  var ln = spPr && _dpK1(spPr, 'ln'), lineClr = null, lineW = 0;
  if (ln && !_dpK1(ln, 'noFill')) { lineClr = _dpColor(_dpK1(ln, 'solidFill'), th); lineW = (+ln.getAttribute('w') || 12700) / _DP_EMU_PT; }
  if (!lineClr && (!ln || !_dpK1(ln, 'noFill')) && style) { var lr = _dpK1(style, 'lnRef'); if (lr && lr.getAttribute('idx') !== '0') { lineClr = _dpColor(lr, th); lineW = lineW || 1; } }
  if (ph && !hasText && !fill && !lineClr) return;   // 빈 자리 — 편집할 때만 보이는 상자
  var b = _dpBox(xf, tf), d = b.d;
  var isLine = sp.localName === 'cxnSp' || /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(prst);
  if (isLine) {
    var w = b.r.w / _DP_EMU_PT, h = b.r.h / _DP_EMU_PT;
    d.innerHTML = '<svg width="' + Math.max(w, 1) + '" height="' + Math.max(h, 1) + '" style="overflow:visible;position:absolute;left:0;top:0"><line x1="0" y1="0" x2="' + w + '" y2="' + h + '" stroke="' + (lineClr || '#000') + '" stroke-width="' + (lineW || 1) + '"/></svg>';
    host.appendChild(d);
    return;
  }
  if (fill) d.style.background = fill;
  if (lineClr) d.style.border = Math.max(0.5, lineW) + 'px solid ' + lineClr;
  if (prst === 'ellipse') d.style.borderRadius = '50%';
  else if (prst === 'roundRect') d.style.borderRadius = Math.min(b.r.w, b.r.h) / _DP_EMU_PT * 0.16 + 'px';
  var fRef = style && _dpK1(style, 'fontRef');   // 도형 글자 기본 색 (보통 흰색)
  if (hasText) d.appendChild(_dpText2(env, txBody, ph, lsp, msp, false, fRef ? _dpColor(fRef, th) : null));
  host.appendChild(d);
}
async function _dpPic(env, pt, pic, host, tf) {
  var xf = _dpXfrm(pic); if (!xf) return;
  var blip = _dpDesc(pic, 'blip')[0];
  var b = _dpBox(xf, tf);
  var u = blip ? await _dpImgUrl(env, pt, blip) : null;
  if (u) { var im = document.createElement('img'); im.src = u; im.alt = ''; im.style.cssText = 'width:100%;height:100%;object-fit:fill;display:block'; b.d.appendChild(im); }
  else { b.d.className += ' dp-ph'; b.d.textContent = '🖼'; }
  host.appendChild(b.d);
}
function _dpFrame(env, gf, host, tf) {
  var xf = _dpXfrm(gf); if (!xf) return;
  var b = _dpBox(xf, tf), tbl = _dpDesc(gf, 'tbl')[0];
  if (tbl) {
    var cols = Array.prototype.map.call(_dpDesc(tbl, 'gridCol'), function (g) { return (+g.getAttribute('w') || 0) / _DP_EMU_PT; });
    var h = '<table class="dp-tbl"><colgroup>' + cols.map(function (w) { return '<col style="width:' + w + 'px">'; }).join('') + '</colgroup>';
    _dpK(tbl, 'tr').forEach(function (tr) {
      h += '<tr style="height:' + ((+tr.getAttribute('h') || 0) / _DP_EMU_PT) + 'px">';
      _dpK(tr, 'tc').forEach(function (tc) {
        if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') return;
        var tcPr = _dpK1(tc, 'tcPr'), bg = tcPr ? _dpFill(tcPr, env.th) : null;
        var span = (tc.getAttribute('gridSpan') ? ' colspan="' + tc.getAttribute('gridSpan') + '"' : '') + (tc.getAttribute('rowSpan') ? ' rowspan="' + tc.getAttribute('rowSpan') + '"' : '');
        var cell = document.createElement('div'); var tb = _dpK1(tc, 'txBody'); if (tb) cell.appendChild(_dpText2(env, tb, { type: 'tbl' }, null, null, true));
        h += '<td' + span + (bg ? ' style="background:' + bg + '"' : '') + '>' + cell.innerHTML + '</td>';
      });
      h += '</tr>';
    });
    b.d.innerHTML = h + '</table>';
  } else {
    var uri = (_dpDesc(gf, 'graphicData')[0] || { getAttribute: function () { return ''; } }).getAttribute('uri') || '';
    b.d.className += ' dp-ph';
    b.d.textContent = /chart/.test(uri) ? '📊 차트' : /diagram/.test(uri) ? '🔷 다이어그램' : '📎 개체';
  }
  host.appendChild(b.d);
}
/* 글 상자 — 문단 · 글머리 · 글꼴 크기(물려받기) · 자동 맞춤 */
function _dpText2(env, txBody, ph, lsp, msp, inTable, shapeClr) {
  var th = env.th, bp = _dpK1(txBody, 'bodyPr');
  var box = document.createElement('div'); box.className = 'dp-tx';
  var ins = function (a, def) { var v = bp && bp.getAttribute(a); return (v != null ? +v : def) / _DP_EMU_PT; };
  if (!inTable) box.style.padding = ins('tIns', 45720) + 'px ' + ins('rIns', 91440) + 'px ' + ins('bIns', 45720) + 'px ' + ins('lIns', 91440) + 'px';
  var anchor = bp && bp.getAttribute('anchor');
  if (!anchor) [lsp, msp].some(function (s) { var b2 = s && _dpDesc(s, 'bodyPr')[0]; if (b2 && b2.getAttribute('anchor')) { anchor = b2.getAttribute('anchor'); return true; } return false; });
  box.style.justifyContent = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';
  if (bp && bp.getAttribute('wrap') === 'none') box.style.whiteSpace = 'nowrap';
  if (bp && bp.getAttribute('vert') && /vert/.test(bp.getAttribute('vert')) && bp.getAttribute('vert') !== 'horz') box.style.writingMode = 'vertical-rl';
  var na = bp && _dpK1(bp, 'normAutofit'), scale = na && na.getAttribute('fontScale') ? +na.getAttribute('fontScale') / 100000 : 1;
  var lnRed = na && na.getAttribute('lnSpcReduction') ? +na.getAttribute('lnSpcReduction') / 100000 : 0;
  var type = ph ? ph.type : 'other', isTitle = type === 'title' || type === 'ctrTitle';
  var txs = env.tx ? _dpK1(env.tx, isTitle ? 'titleStyle' : (ph && type !== 'tbl' ? 'bodyStyle' : 'otherStyle')) : null;
  var lists = [_dpK1(txBody, 'lstStyle'), lsp && _dpDesc(lsp, 'lstStyle')[0], msp && _dpDesc(msp, 'lstStyle')[0], txs];
  var pick = function (fn, lvl) { for (var i = 0; i < lists.length; i++) { var v = fn(lists[i], lvl); if (v !== null && v !== undefined) return v; } return undefined; };
  var defFont = isTitle ? th.fonts.major : th.fonts.minor;
  _dpK(txBody, 'p').forEach(function (p) {
    var pPr = _dpK1(p, 'pPr'), lvl = pPr && pPr.getAttribute('lvl') ? +pPr.getAttribute('lvl') : 0;
    var para = document.createElement('div'); para.className = 'dp-p';
    var algn = (pPr && pPr.getAttribute('algn')) || (isTitle && type === 'ctrTitle' ? 'ctr' : null);
    if (!algn) [lists[1], lists[2], txs].some(function (l) { var q = l && _dpK1(l, 'lvl' + (lvl + 1) + 'pPr'); if (q && q.getAttribute('algn')) { algn = q.getAttribute('algn'); return true; } return false; });
    para.style.textAlign = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left';
    var baseSz = pick(_dpLvlSz, lvl) || (isTitle ? 44 : ph && type !== 'tbl' ? 24 : 18);
    var baseClr = pick(function (l, v) { return _dpLvlClr(l, v, th); }, lvl) || shapeClr || _dpScheme('tx1', th);
    var spc = pPr && _dpDesc(pPr, 'spcPct')[0];
    var lh = spc && spc.parentNode.localName === 'lnSpc' ? (+spc.getAttribute('val') / 100000) : 1.0;
    para.style.lineHeight = Math.max(0.8, (lh - lnRed) * 1.18);
    var sb = pPr && _dpK1(pPr, 'spcBef'), sbp = sb && _dpK1(sb, 'spcPts');
    if (sbp) para.style.marginTop = (+sbp.getAttribute('val') / 100) * scale + 'px';
    var marL = pPr && pPr.getAttribute('marL'); if (marL) para.style.paddingLeft = (+marL / _DP_EMU_PT) + 'px';
    else if (lvl) para.style.paddingLeft = (lvl * 27) + 'px';
    // 글머리
    var bu;
    if (pPr && _dpK1(pPr, 'buNone')) bu = null;
    else if (pPr && _dpK1(pPr, 'buChar')) bu = _dpK1(pPr, 'buChar').getAttribute('char');
    else if (pPr && _dpK1(pPr, 'buAutoNum')) bu = '•';
    else bu = isTitle || !ph || type === 'tbl' ? null : pick(_dpLvlBu, lvl);
    var runs = 0, firstSz = baseSz;
    for (var r = p.firstElementChild; r; r = r.nextElementSibling) {
      if (r.localName === 'br') { para.appendChild(document.createElement('br')); continue; }
      if (r.localName !== 'r' && r.localName !== 'fld') continue;
      var t = _dpK1(r, 't'); if (!t) continue;
      var rPr = _dpK1(r, 'rPr'), span = document.createElement('span');
      span.textContent = t.textContent;
      var sz = rPr && rPr.getAttribute('sz') ? +rPr.getAttribute('sz') / 100 : baseSz;
      if (!runs) firstSz = sz;
      span.style.fontSize = (sz * scale) + 'px';
      if (rPr && rPr.getAttribute('b') === '1') span.style.fontWeight = '700';
      if (rPr && rPr.getAttribute('i') === '1') span.style.fontStyle = 'italic';
      if (rPr && rPr.getAttribute('u') && rPr.getAttribute('u') !== 'none') span.style.textDecoration = 'underline';
      if (rPr && rPr.getAttribute('strike') && rPr.getAttribute('strike') !== 'noStrike') span.style.textDecoration = 'line-through';
      var clr = rPr && _dpK1(rPr, 'solidFill') ? _dpColor(_dpK1(rPr, 'solidFill'), th) : null;
      span.style.color = clr || baseClr;
      var hl = rPr && _dpK1(rPr, 'highlight'); if (hl) span.style.background = _dpColor(hl, th);
      var lat = rPr && (_dpK1(rPr, 'ea') || _dpK1(rPr, 'latin')), face = lat && lat.getAttribute('typeface');
      if (face && face.charAt(0) === '+') face = /mj/.test(face) ? th.fonts.major : th.fonts.minor;
      face = face || defFont;
      if (face) span.style.fontFamily = '"' + face.replace(/"/g, '') + '", "맑은 고딕", "Malgun Gothic", sans-serif';
      var bl = rPr && rPr.getAttribute('baseline'); if (bl && +bl) { span.style.verticalAlign = +bl > 0 ? 'super' : 'sub'; span.style.fontSize = (sz * scale * 0.7) + 'px'; }
      para.appendChild(span); runs++;
    }
    if (!runs) { var epr = _dpK1(p, 'endParaRPr'), esz = epr && epr.getAttribute('sz') ? +epr.getAttribute('sz') / 100 : baseSz; para.style.fontSize = (esz * scale) + 'px'; para.innerHTML = '&#8203;'; }
    else if (bu) { var bs = document.createElement('span'); bs.className = 'dp-bu'; bs.textContent = bu === '§' || bu === 'Ø' || bu === 'ü' || bu === 'q' || bu === 'n' || bu === 'l' ? '•' : bu; bs.style.fontSize = (firstSz * scale) + 'px'; bs.style.color = baseClr; para.insertBefore(bs, para.firstChild); }
    box.appendChild(para);
  });
  return box;
}

/* ─── HWPX · HWP — 파일 안에 든 미리보기 그림 + 글 ─── */
async function _dpHwpx(ctx, data) {
  if (typeof JSZip === 'undefined') return _dpFallback(ctx);
  var z = await JSZip.loadAsync(data);
  var imgF = z.file(/^Preview\/PrvImage\.(png|jpg|jpeg|gif|bmp)$/i)[0], txtF = z.file(/^Preview\/PrvText\.txt$/i)[0];
  var img = imgF ? _dpBlobUrl(ctx.bag, await imgF.async('blob').then(function (b) { return new Blob([b], { type: DP_MIME[imgF.name.split('.').pop().toLowerCase()] || 'image/png' }); })) : null;
  var text = txtF ? docDecodeText(await txtF.async('arraybuffer')) : '';
  if (!text) {   // 미리보기 글이 없으면 본문에서 뽑기
    var secs = Object.keys(z.files).filter(function (n) { return /^Contents\/section\d+\.xml$/i.test(n); }).sort();
    for (var i = 0; i < secs.length && text.length < 60000; i++) {
      var x = _dpX(await z.file(secs[i]).async('string'));
      text += Array.prototype.map.call(_dpDesc(x, 'p'), function (p) { return Array.prototype.map.call(_dpDesc(p, 't'), function (t) { return t.textContent; }).join(''); }).join('\n') + '\n';
    }
  }
  _dpHwpOut(ctx, img, text);
}
function _dpHwp(ctx, data) {
  if (typeof XLSX === 'undefined' || !XLSX.CFB) return _dpFallback(ctx);
  var cfb = XLSX.CFB.read(new Uint8Array(data), { type: 'array' });
  var pi = XLSX.CFB.find(cfb, 'PrvImage'), pt = XLSX.CFB.find(cfb, 'PrvText');
  var img = null;
  if (pi && pi.content && pi.content.length) {
    var u8 = new Uint8Array(pi.content), mime = u8[0] === 0x89 ? 'image/png' : u8[0] === 0x47 ? 'image/gif' : u8[0] === 0x42 ? 'image/bmp' : 'image/jpeg';
    img = _dpBlobUrl(ctx.bag, u8, mime);
  }
  var text = pt && pt.content && pt.content.length ? new TextDecoder('utf-16le').decode(new Uint8Array(pt.content)).replace(/\u0000/g, '') : '';
  if (!img && !text) return _dpFallback(ctx);
  _dpHwpOut(ctx, img, text);
}
function _dpHwpOut(ctx, img, text) {
  ctx.el.innerHTML = '<div class="dp-note top">📝 한글 문서 — 파일에 담긴 첫 쪽 미리보기' + (text ? '와 글' : '') + '입니다. 서식 그대로 보려면 내려받아 한글에서 여세요.</div>' +
    (img ? '<div class="dp-paper"><img class="dp-hwp-img" src="' + img + '" alt="미리보기"></div>' : '') +
    (text ? '<pre class="dp-pre">' + _dpEsc(text.replace(/<([^>]{0,40})>/g, '$1').slice(0, 60000)) + '</pre>' : '') + _dpFallbackBtns(ctx, true);
}

async function _dpZip(ctx, data) {
  if (typeof JSZip === 'undefined') return _dpFallback(ctx);
  var z = await JSZip.loadAsync(data), rows = [];
  z.forEach(function (p, f) { if (!f.dir) rows.push({ p: p, s: f._data && f._data.uncompressedSize }); });
  ctx.el.innerHTML = '<div class="dp-bar"><span>📦 압축 파일 · ' + rows.length + '개</span></div><div class="dp-zip">' +
    rows.slice(0, 2000).map(function (r) { return '<div><span>' + _dpEsc(r.p) + '</span><b>' + (r.s != null && typeof formatFileSize === 'function' ? formatFileSize(r.s) : '') + '</b></div>'; }).join('') + '</div>';
}

function _dpFallbackBtns(ctx, noViewer) {
  var f = ctx.f, h = '<div class="dp-fb-btns"><button type="button" class="btn btn-g btn-s" onclick="docDownloadFile(\'' + (typeof eA === 'function' ? eA(f.id) : f.id) + '\')">💾 내려받기</button>';
  if (!noViewer && ctx.opts.signedUrl && /^(doc|ppt|pps|xls|docx|pptx|xlsx|rtf)$/.test(ctx.ext)) {
    h += '<a class="btn btn-g btn-s" target="_blank" rel="noopener" href="https://view.officeapps.live.com/op/view.aspx?src=' + encodeURIComponent(ctx.opts.signedUrl) + '">🌐 Office 뷰어 (외부 서비스로 보냄)</a>';
  } else if (!noViewer && /^(doc|ppt|pps|xls|rtf)$/.test(ctx.ext)) {
    h += '<button type="button" class="btn btn-g btn-s" onclick="docOpenOfficeViewer(\'' + (typeof eA === 'function' ? eA(f.id) : f.id) + '\')">🌐 Office 뷰어 (외부 서비스로 보냄)</button>';
  }
  return h + '</div>';
}
function _dpFallback(ctx) {
  var icon = typeof getDocIcon === 'function' ? getDocIcon(ctx.ext).icon : '📎';
  var why = /^(doc|ppt|pps|xls)$/.test(ctx.ext) ? '옛 Office 형식(.' + ctx.ext + ')은 브라우저에서 바로 그릴 수 없습니다. 새 형식(.' + ctx.ext + 'x)으로 저장해 올리면 바로 보입니다.'
    : '이 형식(.' + _dpEsc(ctx.ext || '?') + ')은 브라우저에서 미리 볼 수 없습니다.';
  ctx.el.innerHTML = '<div class="dp-msg"><div style="font-size:26px;margin-bottom:6px">' + icon + '</div>' + why + '</div>' + _dpFallbackBtns(ctx);
}
/* Office 뷰어 — 누를 때만 서명 URL 을 받아 새 창으로 (원본이 Microsoft 로 전송됨) */
async function docOpenOfficeViewer(id) {
  var w = window.open('about:blank', '_blank');
  try {
    var dl = await apiFetch('/api/docs/files/' + encodeURIComponent(id) + '/download-url');
    var u = dl && dl.data && dl.data.downloadUrl;
    if (!u) throw new Error('주소를 받지 못했습니다');
    if (w) w.location = 'https://view.officeapps.live.com/op/view.aspx?src=' + encodeURIComponent(u);
  } catch (e) { if (w) w.close(); if (typeof showToast === 'function') showToast('Office 뷰어를 열지 못했습니다: ' + (e.message || e), 'error'); }
}

/* ═══ ⛶ 크게 보기 ═══ */
async function _dpFileRec(fileOrId) {
  if (fileOrId && typeof fileOrId === 'object') return fileOrId;
  var r = await apiFetch('/api/docs/files/' + encodeURIComponent(fileOrId));
  return r && r.data ? (typeof toCamel === 'function' ? toCamel(r.data) : r.data) : null;
}
function docViewFile(fileOrId) {
  var key = 'docView';
  var run = function () {
    return _dpFileRec(fileOrId).then(function (f) {
      if (!f) { if (typeof showToast === 'function') showToast('파일을 찾을 수 없습니다.', 'warn'); return false; }
      _dpBuildViewer(f);
    });
  };
  if (typeof wmGuardedModal === 'function') return wmGuardedModal(key, run, 'docViewModal');
  return run();
}
function docViewClose() {
  var m = document.getElementById('docViewModal'); if (!m) return;
  var b = m.querySelector('.dpv-body'); if (b && b.__dpCleanup) b.__dpCleanup();
  if (m.__key) document.removeEventListener('keydown', m.__key, true);
  m.remove();
}
function _dpBuildViewer(f) {
  docViewClose();
  var id = typeof eA === 'function' ? eA(f.id) : f.id;
  var icon = typeof getDocIcon === 'function' ? getDocIcon(_dpExt(f)).icon : '📄';
  var m = document.createElement('div');
  m.id = 'docViewModal'; m.className = 'dpv';
  m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', f.name || '미리보기');
  m.innerHTML = '<div class="dpv-box"><div class="dpv-head"><span class="dpv-ic">' + icon + '</span><span class="dpv-nm" title="' + _dpEsc(f.name) + '">' + _dpEsc(f.name) + '</span>' +
    '<span class="dpv-sz">' + (typeof formatFileSize === 'function' ? formatFileSize(f.size) : '') + '</span>' +
    '<button type="button" class="btn btn-g btn-s" onclick="docDownloadFile(\'' + id + '\')">💾 내려받기</button>' +
    '<button type="button" class="btn btn-g btn-s dpv-x" onclick="docViewClose()" title="닫기 (Esc)">✕</button></div>' +
    '<div class="dpv-body"><div class="dp-msg">⏳ 불러오는 중…</div></div></div>';
  m.addEventListener('mousedown', function (e) { if (e.target === m) m.__downOut = true; });
  m.addEventListener('click', function (e) { if (e.target === m && m.__downOut) docViewClose(); m.__downOut = false; });
  m.__key = function (e) { if (e.key === 'Escape' && document.getElementById('docViewModal') === m) { e.stopPropagation(); e.preventDefault(); docViewClose(); } };
  document.addEventListener('keydown', m.__key, true);
  document.body.appendChild(m);
  var body = m.querySelector('.dpv-body'), stale = function () { return !body.isConnected; };
  docFetchRaw(f).then(function (data) {
    if (stale()) return;
    if (!data) { body.innerHTML = '<div class="dp-msg">원본 파일이 저장되어 있지 않습니다 (이전 버전 업로드)</div>'; return; }
    return docPreviewInto(body, f, data, { big: true, isStale: stale });
  }).catch(function (e) { if (!stale()) body.innerHTML = '<div class="dp-msg">원본을 받지 못했습니다 — ' + _dpEsc(e.message || e) + '</div>'; });
}
