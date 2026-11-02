/* ═══════════════════════════════════════════════════════════════════════
   notebook-ink.js — ✍️ 노트북 손글씨 · 마커 (v13.316)
   ─────────────────────────────────────────────────────────────────────
   펜 입력(Pointer Events): 필압 → 굵기 · 펜 뒤 지우개 버튼 · 손바닥 무시(펜을 한 번 쓰면 손가락은 화면 이동)
   도구: 펜 · 형광펜 · 지우개(획 단위) · 올가미(골라서 옮기기 · 지우기) · 도형 보정(직선 · 사각형 · 원)
   데이터(논리 좌표 — 폭 1000 기준이라 화면 폭이 달라도 같은 모양):
     칸   { h: 높이, s: [획] }
     획   { t: 'pen'|'hl', c: '#색', w: 굵기, p: [x, y, 필압(0~100), x, y, 필압, …] }
   전역: NbInk.svg(칸, opt) → SVG 글 · NbInk.attach(요소, 칸, { onChange, overlay }) → 편집기 · NbInk.tool (지금 도구)
   ═══════════════════════════════════════════════════════════════════════ */
var NbInk = (function () {
  'use strict';
  var W = 1000;
  var tool = { t: 'pen', c: '#1f2937', w: 4, snap: false };
  var penSeen = false;
  var COLORS = ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed'];
  var HL_COLORS = ['#facc15', '#4ade80', '#60a5fa', '#f472b6', '#fb923c'];

  function r1(n) { return Math.round(n * 10) / 10; }

  /* ─── 획 → SVG 모양 ─── */
  function pts(st) { var a = [], p = st.p || []; for (var i = 0; i + 2 < p.length + 1; i += 3) a.push([p[i], p[i + 1], p[i + 2] == null ? 50 : p[i + 2]]); return a; }
  /** 펜: 필압으로 굵기가 변하는 채운 모양 */
  function penPath(st) {
    var P = pts(st);
    if (!P.length) return '';
    var base = st.w || 4;
    function wid(pr) { return base * (0.3 + 0.95 * Math.min(1, pr / 70)); }
    if (P.length === 1 || (P.length === 2 && Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) < 1)) {
      var r = wid(P[0][2]) / 2;
      return 'M' + r1(P[0][0] - r) + ' ' + r1(P[0][1]) + 'a' + r1(r) + ' ' + r1(r) + ' 0 1 0 ' + r1(2 * r) + ' 0a' + r1(r) + ' ' + r1(r) + ' 0 1 0 ' + r1(-2 * r) + ' 0Z';
    }
    // 필압을 살짝 부드럽게 (끊김 줄이기)
    var pr = P.map(function (p, i) { var a = P[Math.max(0, i - 1)][2], b = P[Math.min(P.length - 1, i + 1)][2]; return (a + 2 * p[2] + b) / 4; });
    var L = [], R = [];
    for (var i = 0; i < P.length; i++) {
      var a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      var nx = -dy / d, ny = dx / d, hw = wid(pr[i]) / 2;
      L.push([P[i][0] + nx * hw, P[i][1] + ny * hw]);
      R.push([P[i][0] - nx * hw, P[i][1] - ny * hw]);
    }
    function curve(arr) {
      var s = '';
      for (var k = 1; k < arr.length - 1; k++) {
        var mx = (arr[k][0] + arr[k + 1][0]) / 2, my = (arr[k][1] + arr[k + 1][1]) / 2;
        s += 'Q' + r1(arr[k][0]) + ' ' + r1(arr[k][1]) + ' ' + r1(mx) + ' ' + r1(my);
      }
      var e = arr[arr.length - 1];
      return s + 'L' + r1(e[0]) + ' ' + r1(e[1]);
    }
    var re = R.slice().reverse();
    var hwE = wid(pr[pr.length - 1]) / 2, hwS = wid(pr[0]) / 2;
    return 'M' + r1(L[0][0]) + ' ' + r1(L[0][1]) + curve(L) +
      'A' + r1(hwE) + ' ' + r1(hwE) + ' 0 0 1 ' + r1(re[0][0]) + ' ' + r1(re[0][1]) + curve(re) +
      'A' + r1(hwS) + ' ' + r1(hwS) + ' 0 0 1 ' + r1(L[0][0]) + ' ' + r1(L[0][1]) + 'Z';
  }
  /** 형광펜: 같은 굵기 선 */
  function linePath(st) {
    var P = pts(st);
    if (!P.length) return '';
    var s = 'M' + r1(P[0][0]) + ' ' + r1(P[0][1]);
    if (P.length === 1) return s + 'l0.1 0';
    for (var k = 1; k < P.length - 1; k++) s += 'Q' + r1(P[k][0]) + ' ' + r1(P[k][1]) + ' ' + r1((P[k][0] + P[k + 1][0]) / 2) + ' ' + r1((P[k][1] + P[k + 1][1]) / 2);
    var e = P[P.length - 1];
    return s + 'L' + r1(e[0]) + ' ' + r1(e[1]);
  }
  function safeColor(c) { return /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#1f2937'; }
  function strokeEl(st, i, sel) {
    var c = safeColor(st.c);
    if (st.t === 'hl') return '<path data-i="' + i + '" class="nbk-hl' + (sel ? ' sel' : '') + '" d="' + linePath(st) + '" fill="none" stroke="' + c + '" stroke-width="' + r1((st.w || 18)) + '" stroke-linecap="round" stroke-linejoin="round" opacity=".38"/>';
    return '<path data-i="' + i + '" class="nbk-pen' + (sel ? ' sel' : '') + '" d="' + penPath(st) + '" fill="' + c + '"/>';
  }
  /** 칸 전체 → SVG 글 (보기 · 내보내기 · 인쇄) */
  function svg(blk, opt) {
    opt = opt || {};
    var h = Math.max(40, (blk && blk.h) || 300), s = (blk && blk.s) || [];
    var body = '';
    // 형광펜을 먼저 깔고 그 위에 펜 (글씨가 형광 밑에 묻히지 않게)
    s.forEach(function (st, i) { if (st.t === 'hl') body += strokeEl(st, i, opt.sel && opt.sel[i]); });
    s.forEach(function (st, i) { if (st.t !== 'hl') body += strokeEl(st, i, opt.sel && opt.sel[i]); });
    return '<svg class="nbk-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + h + '" preserveAspectRatio="xMinYMin meet"' + (opt.fixed ? ' width="' + opt.fixed + '" height="' + Math.round(opt.fixed * h / W) + '"' : '') + '>' + body + '</svg>';
  }

  /* ─── 도형 보정 ─── */
  function pathLen(P) { var L = 0; for (var i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return L; }
  function snapShape(st) {
    var P = pts(st);
    if (P.length < 5) return null;
    var L = pathLen(P), a = P[0], z = P[P.length - 1], gap = Math.hypot(z[0] - a[0], z[1] - a[1]);
    var avg = Math.round(P.reduce(function (s, p) { return s + p[2]; }, 0) / P.length);
    function mk(list) { var p = []; list.forEach(function (q) { p.push(Math.round(q[0]), Math.round(q[1]), avg); }); return { t: st.t, c: st.c, w: st.w, p: p }; }
    if (gap > L * 0.92 && L > 30) return mk([a, z]);                       // 직선
    if (gap > L * 0.2 || L < 60) return null;                               // 닫힌 모양만
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    P.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 || 1, ry = (y1 - y0) / 2 || 1;
    var eE = 0, eR = 0;
    P.forEach(function (p) {
      var nx = (p[0] - cx) / rx, ny = (p[1] - cy) / ry;
      eE += Math.abs(Math.hypot(nx, ny) - 1);
      eR += Math.min(Math.abs(Math.abs(nx) - 1), Math.abs(Math.abs(ny) - 1));
    });
    eE /= P.length; eR /= P.length;
    if (eR < 0.12 && eR < eE) return mk([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
    if (eE < 0.16) { var o = []; for (var k = 0; k <= 48; k++) { var t = k / 48 * Math.PI * 2; o.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); } return mk(o); }
    return null;
  }
  /* 점 줄이기 — 거의 같은 자리 점은 빼서 저장 크기 줄이기 */
  function thin(p) {
    var o = [p[0], p[1], p[2]];
    for (var i = 3; i < p.length; i += 3) {
      var lx = o[o.length - 3], ly = o[o.length - 2];
      if (Math.hypot(p[i] - lx, p[i + 1] - ly) >= 1.2 || i + 3 >= p.length) o.push(p[i], p[i + 1], p[i + 2]);
    }
    return o;
  }
  function inPoly(x, y, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if (((a[1] > y) !== (b[1] > y)) && (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1] || 1e-9) + a[0])) c = !c;
    }
    return c;
  }
  function hitStroke(st, x, y, r) {
    var p = st.p || [], rr = r + (st.w || 4) / 2;
    for (var i = 0; i < p.length; i += 3) if (Math.hypot(p[i] - x, p[i + 1] - y) <= rr) return true;
    for (var k = 3; k < p.length; k += 3) {   // 점 사이 선분도
      var ax = p[k - 3], ay = p[k - 2], bx = p[k], by = p[k + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      var t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= rr) return true;
    }
    return false;
  }

  /* ─── 편집기 ─── */
  /**
   * @param host  그릴 요소 (안을 비우고 SVG 를 넣음)
   * @param blk   { h, s } — 이 객체를 그대로 고침
   * @param o     { onChange(blk), overlay: 덮어 그리기(높이 고정, 늘지 않음), height: overlay 높이(논리) }
   */
  function attach(host, blk, o) {
    o = o || {};
    blk.s = blk.s || [];
    if (!o.overlay) blk.h = Math.max(120, blk.h || 320);
    var ed = { host: host, blk: blk, undo: [], redo: [], sel: null, cur: null, mode: null, destroyed: false };
    host.classList.add('nbk-host', 'nbk-on');
    function H() { return o.overlay ? Math.max(40, o.height ? o.height() : blk.h || 300) : blk.h; }
    function scale() { return W / Math.max(1, host.clientWidth); }
    function draw() {
      var h = H();
      if (o.overlay) blk.h = h;
      var selMap = null;
      if (ed.sel) { selMap = {}; ed.sel.forEach(function (i) { selMap[i] = true; }); }
      var live = ed.cur ? strokeEl(ed.cur, -1) : '';
      var lasso = ed.lasso ? '<polyline class="nbk-lasso" points="' + ed.lasso.map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join(' ') + '"/>' : '';
      var box = '';
      if (ed.sel && ed.sel.length) {
        var b = bbox(ed.sel);
        box = '<rect class="nbk-selbox" x="' + r1(b[0] - 6) + '" y="' + r1(b[1] - 6) + '" width="' + r1(b[2] - b[0] + 12) + '" height="' + r1(b[3] - b[1] + 12) + '"/>';
      }
      host.innerHTML = svg({ h: h, s: blk.s }, { sel: selMap }).replace('</svg>', live + lasso + box + '</svg>');
      if (!o.overlay) host.style.aspectRatio = W + ' / ' + h;
    }
    function bbox(ids) {
      var b = [Infinity, Infinity, -Infinity, -Infinity];
      ids.forEach(function (i) { var p = blk.s[i].p; for (var k = 0; k < p.length; k += 3) { b[0] = Math.min(b[0], p[k]); b[1] = Math.min(b[1], p[k + 1]); b[2] = Math.max(b[2], p[k]); b[3] = Math.max(b[3], p[k + 1]); } });
      return b;
    }
    function push() { ed.undo.push(JSON.stringify(blk.s)); if (ed.undo.length > 100) ed.undo.shift(); ed.redo = []; }
    function changed() { if (o.onChange) o.onChange(blk); if (ed.onState) ed.onState(); }
    function pos(e) {
      var r = host.getBoundingClientRect(), k = W / Math.max(1, r.width);
      return [(e.clientX - r.left) * k, (e.clientY - r.top) * k, Math.round((e.pointerType === 'mouse' || !e.pressure ? 0.5 : e.pressure) * 100)];
    }
    var panY = null;
    function down(e) {
      if (ed.destroyed || (e.button !== 0 && e.button !== 5 && e.pointerType !== 'pen')) return;
      if (e.pointerType === 'pen') penSeen = true;
      if (e.pointerType === 'touch' && penSeen) {   // 펜을 쓰는 중이면 손가락 · 손바닥은 화면 이동
        panY = e.clientY; return;
      }
      e.preventDefault();
      try { host.setPointerCapture(e.pointerId); } catch (_) {}
      var p = pos(e);
      var eraser = (e.buttons & 32) || e.button === 5 || tool.t === 'eraser';
      if (eraser) { ed.mode = 'erase'; push(); ed.erased = false; eraseAt(p); return; }
      if (tool.t === 'lasso') {
        if (ed.sel && ed.sel.length) {
          var b = bbox(ed.sel);
          if (p[0] >= b[0] - 10 && p[0] <= b[2] + 10 && p[1] >= b[1] - 10 && p[1] <= b[3] + 10) { ed.mode = 'move'; push(); ed.last = p; return; }
        }
        ed.mode = 'lasso'; ed.lasso = [p]; ed.sel = null; draw(); return;
      }
      ed.sel = null;
      ed.mode = 'draw';
      var hl = tool.t === 'hl';
      ed.cur = { t: hl ? 'hl' : 'pen', c: tool.c, w: hl ? Math.max(12, tool.w * 4) : tool.w, p: [Math.round(p[0]), Math.round(p[1]), p[2]] };
      draw();
    }
    function move(e) {
      if (panY != null && e.pointerType === 'touch') {
        var sc = host.closest('.nb-scroll') || document.scrollingElement;
        if (sc) sc.scrollTop += panY - e.clientY;
        panY = e.clientY; return;
      }
      if (!ed.mode) return;
      e.preventDefault();
      var list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (!list.length) list = [e];
      if (ed.mode === 'draw') {
        list.forEach(function (ev) { var p = pos(ev); ed.cur.p.push(Math.round(p[0]), Math.round(p[1]), p[2]); });
        // 아래 끝 가까이 쓰면 칸을 늘림
        var lastY = ed.cur.p[ed.cur.p.length - 2];
        var liveEl = host.querySelector('path[data-i="-1"]');
        if (!o.overlay && lastY > blk.h - 50) { blk.h = Math.min(6000, blk.h + 200); draw(); }
        else if (liveEl) liveEl.setAttribute('d', ed.cur.t === 'hl' ? linePath(ed.cur) : penPath(ed.cur));   // 쓰는 중엔 그 획만 다시 (빠르게)
        else draw();
      } else if (ed.mode === 'erase') { list.forEach(function (ev) { eraseAt(pos(ev)); }); }
      else if (ed.mode === 'lasso') { ed.lasso.push(pos(e)); draw(); }
      else if (ed.mode === 'move') {
        var p2 = pos(e), dx = p2[0] - ed.last[0], dy = p2[1] - ed.last[1];
        ed.last = p2;
        ed.sel.forEach(function (i) { var q = blk.s[i].p; for (var k = 0; k < q.length; k += 3) { q[k] = Math.round((q[k] + dx) * 10) / 10; q[k + 1] = Math.round((q[k + 1] + dy) * 10) / 10; } });
        draw();
      }
    }
    function up(e) {
      if (panY != null) { panY = null; return; }
      if (!ed.mode) return;
      var m = ed.mode; ed.mode = null;
      if (m === 'draw' && ed.cur) {
        var st = ed.cur; ed.cur = null;
        st.p = thin(st.p);
        if (tool.snap) { var sn = snapShape(st); if (sn) st = sn; }
        push(); blk.s.push(st); draw(); changed();
      } else if (m === 'erase') { if (!ed.erased) ed.undo.pop(); else changed(); }
      else if (m === 'lasso') {
        var poly = ed.lasso; ed.lasso = null;
        if (poly.length > 3) {
          ed.sel = [];
          blk.s.forEach(function (st, i) {
            var p = st.p, inside = 0, n = 0;
            for (var k = 0; k < p.length; k += 3) { n++; if (inPoly(p[k], p[k + 1], poly)) inside++; }
            if (n && inside / n > 0.6) ed.sel.push(i);
          });
          if (!ed.sel.length) ed.sel = null;
        }
        draw(); if (ed.onState) ed.onState();
      } else if (m === 'move') {
        ed.sel.forEach(function (i) { var q = blk.s[i].p; for (var k = 0; k < q.length; k++) q[k] = Math.round(q[k]); });
        draw(); changed();
      }
    }
    function eraseAt(p) {
      var hit = -1, r = 8 * Math.max(1, scale() * 0.6);
      for (var i = blk.s.length - 1; i >= 0; i--) if (hitStroke(blk.s[i], p[0], p[1], r)) { hit = i; break; }
      if (hit >= 0) { blk.s.splice(hit, 1); ed.erased = true; draw(); }
    }
    host.addEventListener('pointerdown', down);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
    host.addEventListener('contextmenu', function (e) { if (ed.mode) e.preventDefault(); });
    draw();

    ed.redraw = draw;
    ed.undoOne = function () { if (!ed.undo.length) return; ed.redo.push(JSON.stringify(blk.s)); blk.s = JSON.parse(ed.undo.pop()); ed.sel = null; draw(); changed(); };
    ed.redoOne = function () { if (!ed.redo.length) return; ed.undo.push(JSON.stringify(blk.s)); blk.s = JSON.parse(ed.redo.pop()); ed.sel = null; draw(); changed(); };
    ed.clear = function () { if (!blk.s.length) return; push(); blk.s = []; ed.sel = null; draw(); changed(); };
    ed.deleteSel = function () {
      if (!ed.sel || !ed.sel.length) return false;
      push();
      var del = {}; ed.sel.forEach(function (i) { del[i] = 1; });
      blk.s = blk.s.filter(function (_, i) { return !del[i]; });
      ed.sel = null; draw(); changed(); return true;
    };
    ed.recolorSel = function (c) {
      if (!ed.sel || !ed.sel.length) return false;
      push(); ed.sel.forEach(function (i) { blk.s[i].c = c; }); draw(); changed(); return true;
    };
    ed.grow = function (d) { if (o.overlay) return; push(); blk.h = Math.max(120, Math.min(6000, blk.h + d)); draw(); changed(); };
    ed.hasSel = function () { return !!(ed.sel && ed.sel.length); };
    ed.destroy = function () {
      ed.destroyed = true;
      host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up);
      host.classList.remove('nbk-on');
    };
    return ed;
  }

  return { svg: svg, attach: attach, tool: tool, COLORS: COLORS, HL_COLORS: HL_COLORS, W: W, snapShape: snapShape, penPath: penPath, hitStroke: hitStroke,
    penSeen: function () { return penSeen; } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NbInk;
