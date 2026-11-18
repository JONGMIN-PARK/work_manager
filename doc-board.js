/**
 * 🖍 문서 칠판 (v13.526) — 문서 크게 보기 · ▶ 발표 모드에서 쪽 위에 표시 · 글 · 붙인 그림
 *   도구: ✋ 고르기(옮기기 · 크기 · Delete) · 펜 · 형광펜 · 직선 · 화살표 · 네모 · 동그라미 · 글자 · 🖼 그림(Ctrl+V 붙여넣기 · 끌어 놓기 · 파일) · 지우개
 *         되돌리기(Ctrl+Z) · 다시(Ctrl+Y) · 이 쪽 지우기 · 표시 숨기기 · 색 6 · 굵기 3
 *   좌표: 쪽 너비 1000 기준(세로도 같은 단위) → 창 크기 · 전체 화면이 달라도 같은 자리
 *   저장: 쪽마다 자동(1초 쉬면) — PUT /api/docs/files/:id/annot/:page. 다른 사람이 먼저 고쳤으면 합쳐서 다시
 *         고칠 권한이 없으면 그리기는 되지만 저장하지 않음(임시 — 막대에 🔒 표시)
 *   쪽: 미리보기의 .dp-pg[data-pg] (PDF 쪽 · 슬라이드 · 그림 · 그 밖은 내용 전체 한 장)
 *   docBoardAttach(viewEl, file, { readOnly, bar: 막대 넣을 곳, current(): 지금 쪽 번호 }) → board
 */
var DB_COLORS = ['#EF4444', '#F59E0B', '#FACC15', '#22C55E', '#3B82F6', '#111827', '#FFFFFF'];
var DB_W = [3, 6, 12];
var DB_TOOLS = [
  ['none', '🖱', '보기 (표시 안 함)'], ['select', '✋', '고르기 — 끌어 옮기기 · 모서리로 크기 · Delete 지우기 · 두 번 눌러 글 고치기'],
  ['pen', '✏️', '펜'], ['hl', '🖍', '형광펜'], ['line', '╱', '직선'], ['arrow', '↗', '화살표'], ['rect', '▭', '네모'], ['ell', '◯', '동그라미'],
  ['text', 'T', '글자 — 누른 자리에 쓰기 (Enter 넣기 · Shift+Enter 줄 바꿈)'], ['erase', '🧽', '지우개 — 누른 표시 지우기']
];
var DB_NS = 'http://www.w3.org/2000/svg';
function _dbE(s) { return typeof eH === 'function' ? eH(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _dbId() { return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function _dbToast(m, k) { if (typeof showToast === 'function') showToast(m, k); }

function docBoardAttach(view, f, opts) {
  opts = opts || {};
  var B = { view: view, f: f, tool: 'none', color: DB_COLORS[0], w: 1, pages: {}, canEdit: false, hidden: false, sel: null, readOnly: !!opts.readOnly, dead: false, saving: 0, state: '' };
  var ro = new ResizeObserver(function () { Object.keys(B.pages).forEach(function (k) { _dbSize(B.pages[k]); }); });
  B.destroy = function () { B.dead = true; ro.disconnect(); document.removeEventListener('paste', onPaste, true); document.removeEventListener('keydown', onKey, true); _dbFlushAll(B); };

  /* 쪽마다 겹 그림판 */
  function pageOf(el) {
    var n = +el.getAttribute('data-pg');
    if (B.pages[n] && B.pages[n].el === el) return B.pages[n];
    var svg = document.createElementNS(DB_NS, 'svg');
    svg.setAttribute('class', 'db-svg');
    el.appendChild(svg);
    var P = B.pages[n] = B.pages[n] || { n: n, items: [], version: 0, undo: [], redo: [], timer: null };
    P.el = el; P.svg = svg;
    ro.observe(el);
    _dbSize(P); _dbPaint(B, P);
    if (!B.readOnly) _dbBindPage(B, P);
    return P;
  }
  B.scan = function () { view.querySelectorAll('.dp-pg[data-pg]').forEach(pageOf); };
  B.page = function (n) { var el = view.querySelector('.dp-pg[data-pg="' + n + '"]'); return el ? pageOf(el) : null; };
  B.current = function () {
    if (opts.current) { var c = opts.current(); if (c != null) return B.page(c); }
    // 화면에 가장 많이 보이는 쪽
    var best = null, bestV = -1;
    view.querySelectorAll('.dp-pg[data-pg]').forEach(function (el) {
      var r = el.getBoundingClientRect(), v = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (v > bestV) { bestV = v; best = el; }
    });
    return best ? pageOf(best) : null;
  };
  B.setTool = function (t) {
    B.tool = t; B.sel = null; _dbCommitText(B);
    view.classList.toggle('db-on', t !== 'none' && !B.hidden);
    view.setAttribute('data-db-tool', t);
    Object.keys(B.pages).forEach(function (k) { _dbPaint(B, B.pages[k]); });
    _dbBarPaint(B);
  };
  B.setHidden = function (h) { B.hidden = h; view.classList.toggle('db-hide', h); if (h) B.setTool('none'); _dbBarPaint(B); };

  /* 붙여넣기 — 그림이면 그림으로, 글이면 글 상자로 (글 상자를 쓰는 중이면 그대로 둠) */
  function onPaste(e) {
    if (B.readOnly || B.dead || !view.isConnected || B.hidden) return;
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT' || ae.isContentEditable)) return;
    var cd = e.clipboardData; if (!cd) return;
    var file = Array.prototype.filter.call(cd.files || [], function (x) { return /^image\//.test(x.type); })[0];
    var text = cd.getData && cd.getData('text/plain');
    if (!file && !text) return;
    e.preventDefault(); e.stopPropagation();
    var P = B.current(); if (!P) return;
    if (file) _dbAddImage(B, P, file);
    else { _dbPush(P); var it = { id: _dbId(), k: 'text', c: B.color === '#FFFFFF' ? '#111827' : B.color, s: 28, x: 60, y: 80, t: text.slice(0, 2000) }; P.items.push(it); _dbChanged(B, P); B.sel = { P: P, id: it.id }; if (B.tool === 'none') B.setTool('select'); else _dbPaint(B, P); }
  }
  function onKey(e) {
    if (B.dead || !view.isConnected || B.readOnly) return;
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT' || ae.isContentEditable)) return;
    var mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { var P = B.current(); if (P && _dbUndo(B, P)) e.preventDefault(); return; }
    if (mod && (e.key === 'y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) { var P2 = B.current(); if (P2 && _dbRedo(B, P2)) e.preventDefault(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && B.sel) { e.preventDefault(); e.stopPropagation(); _dbDeleteSel(B); return; }
  }
  /** Esc — 고른 것 풀기 · 도구 끄기. 처리했으면 true (크게 보기 창이 닫히지 않게) */
  B.esc = function () {
    if (B.text) { _dbCancelText(B); return true; }
    if (B.sel) { B.sel = null; Object.keys(B.pages).forEach(function (k) { _dbPaint(B, B.pages[k]); }); return true; }
    if (B.tool !== 'none') { B.setTool('none'); return true; }
    return false;
  };
  document.addEventListener('paste', onPaste, true);
  document.addEventListener('keydown', onKey, true);

  B.scan();
  // 슬라이드 · 쪽이 나중에 생겨도
  var mo = new MutationObserver(function () { if (!B.dead) B.scan(); });
  mo.observe(view, { childList: true, subtree: true });
  var _d = B.destroy; B.destroy = function () { mo.disconnect(); _d(); };

  if (opts.bar) { B.bar = opts.bar; _dbBarBuild(B); }
  // 저장된 표시 받기
  B.ready = apiFetch('/api/docs/files/' + encodeURIComponent(f.id) + '/annot').then(function (r) {
    var d = (r && r.data) || {};
    B.canEdit = !!d.canEdit && !B.readOnly;
    Object.keys(d.pages || {}).forEach(function (k) {
      var P = B.pages[k] || (B.pages[k] = { n: +k, items: [], version: 0, undo: [], redo: [], timer: null });
      P.items = d.pages[k].items || []; P.version = d.pages[k].version || 0;
      if (P.svg) _dbPaint(B, P);
    });
    B.state = B.canEdit ? 'saved' : (B.readOnly ? '' : 'temp');
    _dbBarPaint(B);
    return B;
  }).catch(function () { B.state = 'temp'; _dbBarPaint(B); return B; });
  return B;
}

function _dbSize(P) {
  var r = P.el.getBoundingClientRect(), w = r.width || P.el.clientWidth, h = r.height || P.el.clientHeight;
  if (!w || !h) return;
  P.k = w / 1000;   // 화면 px / 1단위
  P.H = Math.round(h / P.k);
  P.svg.setAttribute('viewBox', '0 0 1000 ' + P.H);
  P.svg.setAttribute('preserveAspectRatio', 'none');
}
/* 화면 좌표 → 쪽 단위 */
function _dbPt(P, e) { var r = P.el.getBoundingClientRect(), k = r.width / 1000; return [Math.round((e.clientX - r.left) / k * 10) / 10, Math.round((e.clientY - r.top) / k * 10) / 10]; }

/* ─── 그리기(SVG) ─── */
function _dbArrow(x1, y1, x2, y2, w) {
  var a = Math.atan2(y2 - y1, x2 - x1), L = Math.max(14, w * 4.2), s = 0.5;
  return 'M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 + 'M' + (x2 - L * Math.cos(a - s)) + ' ' + (y2 - L * Math.sin(a - s)) + 'L' + x2 + ' ' + y2 + 'L' + (x2 - L * Math.cos(a + s)) + ' ' + (y2 - L * Math.sin(a + s));
}
function _dbItemSvg(it) {
  var c = _dbE(it.c || '#EF4444'), w = it.w || 4, id = _dbE(it.id), hit = Math.max(w, 14);
  var common = ' stroke="' + c + '" stroke-width="' + w + '" fill="none" stroke-linecap="round" stroke-linejoin="round"';
  var hitA = ' class="db-hit" stroke="transparent" stroke-width="' + hit + '" fill="none" data-id="' + id + '"';
  if (it.k === 'pen') {
    var d = (it.p || []).map(function (q, i) { return (i ? 'L' : 'M') + q[0] + ' ' + q[1]; }).join('');
    if ((it.p || []).length === 1) d += 'l0.1 0';
    return '<path d="' + d + '"' + common + (it.a ? ' opacity="' + it.a + '"' : '') + ' data-id="' + id + '"/><path d="' + d + '"' + hitA + '/>';
  }
  if (it.k === 'line') return '<line x1="' + it.x1 + '" y1="' + it.y1 + '" x2="' + it.x2 + '" y2="' + it.y2 + '"' + common + ' data-id="' + id + '"/><line x1="' + it.x1 + '" y1="' + it.y1 + '" x2="' + it.x2 + '" y2="' + it.y2 + '"' + hitA + '/>';
  if (it.k === 'arrow') { var ad = _dbArrow(it.x1, it.y1, it.x2, it.y2, w); return '<path d="' + ad + '"' + common + ' data-id="' + id + '"/><path d="' + ad + '"' + hitA + '/>'; }
  if (it.k === 'rect' || it.k === 'ell') {
    var x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2), ww = Math.abs(it.x2 - it.x1), hh = Math.abs(it.y2 - it.y1);
    var sh = it.k === 'rect' ? 'rect x="' + x + '" y="' + y + '" width="' + ww + '" height="' + hh + '" rx="' + Math.min(6, ww / 4) + '"' : 'ellipse cx="' + (x + ww / 2) + '" cy="' + (y + hh / 2) + '" rx="' + (ww / 2) + '" ry="' + (hh / 2) + '"';
    return '<' + sh + common + ' data-id="' + id + '"/><' + sh + hitA + '/>';
  }
  if (it.k === 'text') {
    var lines = String(it.t || '').split('\n'), s = it.s || 28;
    return '<text x="' + it.x + '" y="' + it.y + '" font-size="' + s + '" fill="' + c + '" class="db-text" data-id="' + id + '">' +
      lines.map(function (ln, i) { return '<tspan x="' + it.x + '" dy="' + (i ? s * 1.25 : 0) + '">' + (_dbE(ln) || ' ') + '</tspan>'; }).join('') + '</text>';
  }
  if (it.k === 'img') return '<image href="' + _dbE(it.src) + '" x="' + it.x + '" y="' + it.y + '" width="' + it.w + '" height="' + it.h + '" preserveAspectRatio="none" data-id="' + id + '" class="db-img"/>';
  return '';
}
function _dbPaint(B, P) {
  if (!P.svg) return;
  var h = P.items.map(_dbItemSvg).join('') + (P.draft ? _dbItemSvg(P.draft) : '');
  P.svg.innerHTML = h;
  // 고른 것 — 점선 테두리 + 크기 손잡이
  if (B.sel && B.sel.P === P) {
    var el = P.svg.querySelector('[data-id="' + B.sel.id + '"]:not(.db-hit)');
    if (el) {
      var bb; try { bb = el.getBBox(); } catch (_) { bb = null; }
      if (bb) {
        var pad = 6, hs = 12;
        P.svg.insertAdjacentHTML('beforeend', '<rect class="db-selbox" x="' + (bb.x - pad) + '" y="' + (bb.y - pad) + '" width="' + (bb.width + pad * 2) + '" height="' + (bb.height + pad * 2) + '"/>' +
          '<rect class="db-handle" data-h="1" x="' + (bb.x + bb.width + pad - hs / 2) + '" y="' + (bb.y + bb.height + pad - hs / 2) + '" width="' + hs + '" height="' + hs + '"/>');
        B.sel.bb = bb;
      }
    } else B.sel = null;
  }
}

/* ─── 쪽에 손대기 ─── */
function _dbBindPage(B, P) {
  var svg = P.svg, drag = null;
  svg.addEventListener('pointerdown', function (e) {
    if (B.tool === 'none' || B.hidden || e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    var pt = _dbPt(P, e), t = B.tool, hitId = e.target.getAttribute && e.target.getAttribute('data-id');
    if (B.text) _dbCommitText(B);
    if (t === 'erase') { if (hitId) { _dbPush(P); P.items = P.items.filter(function (x) { return x.id !== hitId; }); _dbChanged(B, P); _dbPaint(B, P); } drag = { erase: true }; svg.setPointerCapture(e.pointerId); return; }
    if (t === 'select') {
      if (e.target.getAttribute('data-h') && B.sel && B.sel.P === P) { drag = { resize: true, start: pt, orig: JSON.stringify(_dbFind(P, B.sel.id)), bb: B.sel.bb }; _dbPush(P); }
      else if (hitId) { B.sel = { P: P, id: hitId }; drag = { move: true, start: pt, orig: JSON.stringify(_dbFind(P, hitId)) }; _dbPush(P); _dbPaint(B, P); }
      else { B.sel = null; _dbPaint(B, P); return; }
      svg.setPointerCapture(e.pointerId); return;
    }
    if (t === 'text') { _dbStartText(B, P, pt, null); return; }
    var w = DB_W[B.w] || 6;
    if (t === 'pen' || t === 'hl') P.draft = { id: _dbId(), k: 'pen', c: B.color, w: t === 'hl' ? w * 3.2 : w, a: t === 'hl' ? 0.35 : undefined, p: [pt] };
    else P.draft = { id: _dbId(), k: t, c: B.color, w: w, x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1] };
    drag = { draw: true };
    svg.setPointerCapture(e.pointerId);
    _dbPaint(B, P);
  });
  svg.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var pt = _dbPt(P, e);
    if (drag.erase) { var el = document.elementFromPoint(e.clientX, e.clientY), id = el && el.getAttribute && el.getAttribute('data-id'); if (id && P.svg.contains(el)) { _dbPush(P); P.items = P.items.filter(function (x) { return x.id !== id; }); _dbChanged(B, P); _dbPaint(B, P); } return; }
    if (drag.draw && P.draft) {
      if (P.draft.k === 'pen') { var l = P.draft.p[P.draft.p.length - 1]; if (Math.abs(l[0] - pt[0]) + Math.abs(l[1] - pt[1]) > 1.2) P.draft.p.push(pt); }
      else { P.draft.x2 = pt[0]; P.draft.y2 = pt[1]; if (e.shiftKey && P.draft.k !== 'line' && P.draft.k !== 'arrow') { var dd = Math.max(Math.abs(pt[0] - P.draft.x1), Math.abs(pt[1] - P.draft.y1)); P.draft.x2 = P.draft.x1 + Math.sign(pt[0] - P.draft.x1 || 1) * dd; P.draft.y2 = P.draft.y1 + Math.sign(pt[1] - P.draft.y1 || 1) * dd; } }
      _dbPaint(B, P); return;
    }
    if ((drag.move || drag.resize) && B.sel) {
      var o = JSON.parse(drag.orig), it = _dbFind(P, B.sel.id); if (!it) return;
      var dx = pt[0] - drag.start[0], dy = pt[1] - drag.start[1];
      if (drag.move) _dbMove(it, o, dx, dy);
      else _dbResize(it, o, drag.bb, dx, dy);
      drag.changed = true;
      _dbPaint(B, P);
    }
  });
  var end = function () {
    if (!drag) return;
    if (drag.draw && P.draft) {
      var d = P.draft; P.draft = null;
      var tiny = d.k !== 'pen' && Math.abs(d.x2 - d.x1) + Math.abs(d.y2 - d.y1) < 3;
      if (!tiny) { _dbPush(P); P.items.push(d); _dbChanged(B, P); }
      _dbPaint(B, P);
    } else if ((drag.move || drag.resize) && drag.changed) _dbChanged(B, P);
    else if (drag.move || drag.resize) P.undo.pop();   // 안 움직였으면 되돌리기 칸도 빼기
    drag = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('dblclick', function (e) {
    if (B.tool !== 'select') return;
    var id = e.target.getAttribute && e.target.getAttribute('data-id'), it = id && _dbFind(P, id);
    if (it && it.k === 'text') { e.preventDefault(); _dbStartText(B, P, [it.x, it.y], it); }
  });
  // 그림 파일 끌어 놓기
  P.el.addEventListener('dragover', function (e) { if (B.readOnly || !e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return; e.preventDefault(); });
  P.el.addEventListener('drop', function (e) {
    var f = e.dataTransfer && Array.prototype.filter.call(e.dataTransfer.files || [], function (x) { return /^image\//.test(x.type); })[0];
    if (!f) return; e.preventDefault(); e.stopPropagation();
    _dbAddImage(B, P, f, _dbPt(P, e));
  });
}
function _dbFind(P, id) { return P.items.filter(function (x) { return x.id === id; })[0]; }
function _dbMove(it, o, dx, dy) {
  if (it.k === 'pen') it.p = o.p.map(function (q) { return [Math.round((q[0] + dx) * 10) / 10, Math.round((q[1] + dy) * 10) / 10]; });
  else if ('x1' in o) { it.x1 = o.x1 + dx; it.y1 = o.y1 + dy; it.x2 = o.x2 + dx; it.y2 = o.y2 + dy; }
  else { it.x = o.x + dx; it.y = o.y + dy; }
}
function _dbResize(it, o, bb, dx, dy) {
  if (!bb || bb.width < 1) return;
  var sx = Math.max(0.1, (bb.width + dx) / bb.width), sy = Math.max(0.1, (bb.height + dy) / Math.max(1, bb.height));
  if (it.k === 'img') { var s = Math.max(sx, sy); it.w = Math.max(10, o.w * s); it.h = Math.max(10, o.h * s); }
  else if (it.k === 'text') it.s = Math.max(8, Math.min(200, Math.round(o.s * sx)));
  else if (it.k === 'pen') it.p = o.p.map(function (q) { return [bb.x + (q[0] - bb.x) * sx, bb.y + (q[1] - bb.y) * sy]; });
  else { it.x2 = o.x2 + dx; it.y2 = o.y2 + dy; }
}
function _dbDeleteSel(B) {
  var s = B.sel; if (!s) return;
  _dbPush(s.P); s.P.items = s.P.items.filter(function (x) { return x.id !== s.id; });
  B.sel = null; _dbChanged(B, s.P); _dbPaint(B, s.P);
}

/* ─── 글 상자 ─── */
function _dbStartText(B, P, pt, it) {
  _dbCommitText(B);
  var k = P.el.getBoundingClientRect().width / 1000, s = it ? it.s : [22, 30, 44][B.w] || 30;
  var ta = document.createElement('textarea');
  ta.className = 'db-ta';
  ta.value = it ? it.t : '';
  ta.style.cssText = 'left:' + (pt[0] * k) + 'px;top:' + ((pt[1] - (it ? s * 0.85 : s * 0.85)) * k) + 'px;font-size:' + (s * k) + 'px;color:' + (it ? it.c : B.color);
  ta.rows = Math.max(1, ta.value.split('\n').length);
  P.el.appendChild(ta);
  B.text = { P: P, ta: ta, it: it, pt: pt, s: s };
  if (it) { it._hide = true; P.svg.querySelectorAll('[data-id="' + it.id + '"]').forEach(function (n) { n.style.display = 'none'; }); }
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); _dbCommitText(B); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _dbCancelText(B); }
    e.stopPropagation();
  });
  ta.addEventListener('input', function () { ta.rows = Math.max(1, ta.value.split('\n').length); });
  ta.addEventListener('blur', function () { setTimeout(function () { if (B.text && B.text.ta === ta) _dbCommitText(B); }, 120); });
  ta.focus(); setTimeout(function () { if (document.activeElement !== ta && ta.isConnected) ta.focus(); }, 0);   // 바로 · 혹시 뺏기면 한 번 더
}
function _dbCommitText(B) {
  var T = B.text; if (!T) return;
  B.text = null;
  var v = T.ta.value.replace(/\s+$/, ''); T.ta.remove();
  var P = T.P;
  if (T.it) {
    delete T.it._hide;
    if (v !== T.it.t) { _dbPush(P); if (v) T.it.t = v; else P.items = P.items.filter(function (x) { return x !== T.it; }); _dbChanged(B, P); }
  } else if (v) { _dbPush(P); P.items.push({ id: _dbId(), k: 'text', c: B.color, s: T.s, x: T.pt[0], y: T.pt[1], t: v }); _dbChanged(B, P); }
  _dbPaint(B, P);
}
function _dbCancelText(B) { var T = B.text; if (!T) return; B.text = null; T.ta.remove(); if (T.it) delete T.it._hide; _dbPaint(B, T.P); }

/* ─── 그림 붙이기 — 긴 변 1600px 로 줄여 webp(없으면 jpeg) ─── */
function _dbAddImage(B, P, file, at) {
  var fr = new FileReader();
  fr.onload = function () {
    var img = new Image();
    img.onload = function () {
      var max = 1600, sc = Math.min(1, max / Math.max(img.width, img.height)), cw = Math.max(1, Math.round(img.width * sc)), ch = Math.max(1, Math.round(img.height * sc));
      var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
      var src = cv.toDataURL('image/webp', 0.86);
      if (!/^data:image\/webp/.test(src)) src = cv.toDataURL('image/jpeg', 0.86);
      if (src.length > 3 * 1024 * 1024) src = cv.toDataURL('image/jpeg', 0.7);
      var w = 420, h = w * ch / cw;   // 쪽 너비의 42% — 놓은 뒤 모서리로 키우기
      if (P.H && h > P.H * 0.8) { h = P.H * 0.8; w = h * cw / ch; }
      var x = at ? at[0] - w / 2 : (1000 - w) / 2, y = at ? at[1] - h / 2 : Math.max(10, ((P.H || h + 40) - h) / 2);
      var it = { id: _dbId(), k: 'img', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), src: src };
      _dbPush(P); P.items.push(it); _dbChanged(B, P);
      B.sel = { P: P, id: it.id };
      if (B.tool !== 'select') B.setTool('select'); else _dbPaint(B, P);
      B.sel = { P: P, id: it.id }; _dbPaint(B, P);
      _dbToast('🖼 그림을 붙였습니다 — 끌어 옮기고, 모서리로 크기를 바꾸고, Delete 로 지울 수 있어요');
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}

/* ─── 되돌리기 · 저장 ─── */
function _dbPush(P) { P.undo.push(JSON.stringify(P.items)); if (P.undo.length > 60) P.undo.shift(); P.redo = []; }
function _dbUndo(B, P) { if (!P.undo.length) return false; P.redo.push(JSON.stringify(P.items)); P.items = JSON.parse(P.undo.pop()); B.sel = null; _dbChanged(B, P); _dbPaint(B, P); return true; }
function _dbRedo(B, P) { if (!P.redo.length) return false; P.undo.push(JSON.stringify(P.items)); P.items = JSON.parse(P.redo.pop()); B.sel = null; _dbChanged(B, P); _dbPaint(B, P); return true; }
function _dbChanged(B, P) {
  if (B.readOnly) return;
  if (!B.canEdit) { B.state = 'temp'; _dbBarPaint(B); return; }
  clearTimeout(P.timer);
  B.state = 'dirty'; _dbBarPaint(B);
  P.timer = setTimeout(function () { _dbSave(B, P); }, 1000);
}
function _dbSave(B, P) {
  clearTimeout(P.timer); P.timer = null;
  if (!B.canEdit) return Promise.resolve();
  if (P.inflight) { P.again = true; return P.inflight; }
  var body = { items: P.items.map(function (x) { var o = Object.assign({}, x); delete o._hide; return o; }), version: P.version };
  B.saving++; B.state = 'saving'; _dbBarPaint(B);
  P.inflight = apiFetch('/api/docs/files/' + encodeURIComponent(B.f.id) + '/annot/' + P.n, { method: 'PUT', body: JSON.stringify(body) })
    .then(function (r) { P.version = r && r.data ? r.data.version : P.version; B.savedAny = true; })
    .catch(function (e) {
      var d = e && e.data;
      if (d && d.error === 'CONFLICT' && d.latest) {   // 남이 먼저 — 남의 것 + 내 새 것 합치기
        var have = {}; d.latest.items.forEach(function (x) { have[x.id] = 1; });
        P.items = d.latest.items.concat(P.items.filter(function (x) { return !have[x.id]; }));
        P.version = d.latest.version; P.again = true;
        _dbPaint(B, P);
        _dbToast('다른 사람이 이 쪽에 그린 것과 합쳤습니다');
        return;
      }
      B.err = (d && d.message) || e.message || '저장 못 함';
      if (d && d.error === 'FORBIDDEN') B.canEdit = false;
      throw e;
    })
    .then(function () { B.err = null; }, function () {})
    .then(function () {
      B.saving--; P.inflight = null;
      if (P.again && !B.dead) { P.again = false; return _dbSave(B, P); }
      B.state = B.err ? 'err' : (B.canEdit ? 'saved' : 'temp'); _dbBarPaint(B);
      if (typeof B.onSaved === 'function') B.onSaved();
    });
  return P.inflight;
}
function _dbFlushAll(B) { Object.keys(B.pages).forEach(function (k) { var P = B.pages[k]; if (P.timer) _dbSave(B, P); }); }
function _dbClearPage(B) {
  var P = B.current(); if (!P || !P.items.length) return;
  _dbPush(P); P.items = []; B.sel = null; _dbChanged(B, P); _dbPaint(B, P);
  _dbToast('이 쪽 표시를 지웠습니다 — Ctrl+Z 로 되돌릴 수 있어요');
}

/* ─── 도구 막대 ─── */
function _dbBarBuild(B) {
  var bar = B.bar;
  bar.classList.add('db-bar');
  bar.innerHTML = '<div class="db-tools">' + DB_TOOLS.map(function (t) { return '<button type="button" class="db-b" data-tool="' + t[0] + '" title="' + _dbE(t[2]) + '">' + t[1] + '</button>'; }).join('') +
    '<button type="button" class="db-b" data-act="img" title="🖼 그림 넣기 — 화면 캡처 뒤 Ctrl+V 로 바로 붙여도 됩니다">🖼</button></div>' +
    '<div class="db-cols">' + DB_COLORS.map(function (c) { return '<button type="button" class="db-c" data-color="' + c + '" style="background:' + c + '" title="색"></button>'; }).join('') + '</div>' +
    '<div class="db-ws">' + DB_W.map(function (w, i) { return '<button type="button" class="db-w" data-w="' + i + '" title="굵기"><i style="width:' + (4 + i * 4) + 'px;height:' + (4 + i * 4) + 'px"></i></button>'; }).join('') + '</div>' +
    '<div class="db-acts"><button type="button" class="db-b" data-act="undo" title="되돌리기 (Ctrl+Z)">↶</button><button type="button" class="db-b" data-act="redo" title="다시 (Ctrl+Y)">↷</button>' +
    '<button type="button" class="db-b" data-act="del" title="고른 것 지우기 (Delete)">🗑</button><button type="button" class="db-b" data-act="clear" title="이 쪽 표시 모두 지우기">🧹</button>' +
    '<button type="button" class="db-b" data-act="hide" title="표시 숨기기 · 보이기">👁</button></div><span class="db-state"></span>' +
    '<input type="file" accept="image/*" hidden class="db-file">';
  bar.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tool]'); if (t) { B.setTool(t.dataset.tool === B.tool && t.dataset.tool !== 'none' ? 'none' : t.dataset.tool); return; }
    var c = e.target.closest('[data-color]'); if (c) { B.color = c.dataset.color; if (B.tool === 'none' || B.tool === 'select' || B.tool === 'erase') B.setTool('pen'); _dbRecolorSel(B); _dbBarPaint(B); return; }
    var w = e.target.closest('[data-w]'); if (w) { B.w = +w.dataset.w; if (B.tool === 'none' || B.tool === 'select' || B.tool === 'erase') B.setTool('pen'); _dbBarPaint(B); return; }
    var a = e.target.closest('[data-act]'); if (!a) return;
    var P = B.current();
    if (a.dataset.act === 'undo' && P) _dbUndo(B, P);
    else if (a.dataset.act === 'redo' && P) _dbRedo(B, P);
    else if (a.dataset.act === 'del') _dbDeleteSel(B);
    else if (a.dataset.act === 'clear') _dbClearPage(B);
    else if (a.dataset.act === 'hide') B.setHidden(!B.hidden);
    else if (a.dataset.act === 'img') bar.querySelector('.db-file').click();
  });
  bar.querySelector('.db-file').addEventListener('change', function () { var f = this.files && this.files[0]; var P = B.current(); if (f && P) _dbAddImage(B, P, f); this.value = ''; });
  _dbBarPaint(B);
}
function _dbRecolorSel(B) { var s = B.sel; if (!s) return; var it = _dbFind(s.P, s.id); if (!it || it.k === 'img') return; _dbPush(s.P); it.c = B.color; _dbChanged(B, s.P); _dbPaint(B, s.P); }
function _dbBarPaint(B) {
  var bar = B.bar; if (!bar) return;
  bar.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === B.tool); });
  bar.querySelectorAll('[data-color]').forEach(function (b) { b.classList.toggle('on', b.dataset.color === B.color); });
  bar.querySelectorAll('[data-w]').forEach(function (b) { b.classList.toggle('on', +b.dataset.w === B.w); });
  var hb = bar.querySelector('[data-act="hide"]'); if (hb) hb.classList.toggle('on', B.hidden);
  var st = bar.querySelector('.db-state');
  if (st) {
    var m = { saved: ['☁', '저장됨'], dirty: ['…', '고침'], saving: ['⏳', '저장 중'], temp: ['🔒', '임시 (저장 권한 없음)'], err: ['⚠', B.err || '저장 못 함'] }[B.state];
    st.textContent = m ? m[0] + ' ' + m[1] : '';
    st.className = 'db-state ' + (B.state || '');
    st.title = B.state === 'temp' ? '이 문서를 고칠 수 있는 사람(프로젝트 참여자)만 표시를 저장할 수 있습니다. 지금 그린 것은 창을 닫으면 사라집니다.' : '쪽마다 자동 저장';
  }
}
