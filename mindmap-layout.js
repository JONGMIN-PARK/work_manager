/**
 * 업무 관리자 — 마인드맵 순수 로직 (DOM 없음 · test/mindmap-layout.test.js)
 * - 트리 탐색·변경: mmFind · mmWalk · mmMoveNode · mmRemoveNode · mmCloneBranch
 * - 배치: mmLayout(root, structure, sizes) — balanced(좌우 마인드맵) · right(논리도) · down(조직도)
 * - 변환: mmToMarkdown · mmFromMarkdown
 * 노드 형식은 PRD_마인드맵 5.3 (id · text · children · side · collapsed · color · markers · labels · note · 작업 정보)
 */

var MM_GAP = { h: 44, v: 12, downH: 18, downV: 46 };
var MM_BOUND_PAD = 10;   // 경계(boundary) 안쪽 여백
var MM_SUM_GAP = 30;     // 요약 중괄호 + 간격

function mmUid() {
  return 'n-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

function mmNewNode(text) { return { id: mmUid(), text: text == null ? '' : String(text), children: [] }; }

/** fn(node, parent, depth) 전위 순회. fn 이 false 를 돌려주면 그 노드의 하위는 건너뜀 */
function mmWalk(root, fn) {
  (function go(n, parent, depth) {
    if (fn(n, parent, depth) === false) return;
    (n.children || []).forEach(function (c) { go(c, n, depth + 1); });
  })(root, null, 0);
}

/** id → { node, parent, index, depth } (없으면 null) */
function mmFind(root, id) {
  var hit = null;
  mmWalk(root, function (n, parent, depth) {
    if (hit) return false;
    if (n.id === id) { hit = { node: n, parent: parent, index: parent ? parent.children.indexOf(n) : -1, depth: depth }; return false; }
  });
  return hit;
}

function mmCount(root) { var c = 0; mmWalk(root, function () { c++; }); return c; }

function mmIsAncestor(root, ancestorId, id) {
  var a = mmFind(root, ancestorId);
  if (!a) return false;
  return !!mmFind(a.node, id);
}

/** 노드 제거 (루트 불가). 제거한 노드를 돌려줌 */
function mmRemoveNode(root, id) {
  var f = mmFind(root, id);
  if (!f || !f.parent) return null;
  f.parent.children.splice(f.index, 1);
  return f.node;
}

/**
 * 노드를 newParentId 아래 index 위치로 이동. 자기 자신·자기 하위로는 이동 불가 → false
 * index 생략 시 맨 뒤. 같은 부모 안 이동도 처리.
 */
function mmMoveNode(root, id, newParentId, index) {
  if (id === root.id || id === newParentId) return false;
  if (mmIsAncestor(root, id, newParentId)) return false;
  var target = mmFind(root, newParentId);
  var f = mmFind(root, id);
  if (!target || !f) return false;
  var sameParent = f.parent === target.node;
  f.parent.children.splice(f.index, 1);
  var kids = target.node.children || (target.node.children = []);
  var at = (index == null || index < 0) ? kids.length : index;
  if (sameParent && f.index < at) at--;
  kids.splice(Math.min(at, kids.length), 0, f.node);
  // 1단계로 들어오거나 나가면 좌우 배치를 다시 정하도록
  if (target.node !== root) delete f.node.side;
  return true;
}

/** 가지 깊은 복사 + 새 id (붙여넣기용) */
function mmCloneBranch(node) {
  var copy = JSON.parse(JSON.stringify(node));
  mmWalk(copy, function (n) { n.id = mmUid(); });
  return copy;
}

/**
 * 배치 계산. sizes[id] = { w, h } (DOM 에서 측정), 요약 글상자는 sizes['sum:' + id]. 접힌 노드의 하위는 배치하지 않음.
 * 경계(node.boundary)는 블록에 여백을, 요약(node.summary)은 글상자 크기만큼 최소 블록을 더한다.
 * 반환: { pos: { id: { x, y, w, h, side, depth, parentId } }, bounds: { minX, minY, maxX, maxY } }
 * 좌표는 루트 중심 (0,0) 기준. 경계·요약 위치는 mmDecorations.
 */
function mmLayout(root, structure, sizes) {
  var lay = _mmLayoutCore(root, structure, sizes);
  var aligned = mmAlignSizes(root, structure, sizes, lay.pos);
  if (!aligned) return lay;
  // 같은 단계 맞춤: 폭(조직도는 높이도)을 넓힌 크기로 다시 배치 — 높이는 그대로라 좌우 배정도 같다
  var lay2 = _mmLayoutCore(root, structure, aligned.sizes);
  lay2.aligned = aligned.ids;
  return lay2;
}

/**
 * 같은 단계 맞춤 (node.alignLevels) — 켜진 주제의 하위를 (좌우 방향, 상대 깊이)로 묶어
 * 묶음 안 가장 넓은 폭으로 맞춘다. 중심 주제에 켜면 맵 전체. 조직도는 같은 줄 높이도 맞춘다.
 * 켜진 주제 안에 또 켜진 주제가 있으면 바깥 것을 따른다.
 * 반환: null(맞출 게 없음) 또는 { sizes: 새 크기표, ids: { id: true } 크기가 바뀐 주제 }
 */
function mmAlignSizes(root, structure, sizes, pos) {
  var groups = {}, any = false;
  function sz(id) { return sizes[id] || { w: 80, h: 30 }; }
  mmWalk(root, function (n) {
    if (!pos[n.id]) return false;
    if (!n.alignLevels) return n.collapsed ? false : undefined;
    any = true;
    (function go(list, depth) {
      list.forEach(function (c) {
        var p = pos[c.id];
        if (!p) return;
        var key = n.id + '|' + (structure === 'down' ? 'down' : p.side) + '|' + depth;
        (groups[key] = groups[key] || []).push(c.id);
        if (!c.collapsed) go(c.children || [], depth + 1);
      });
    })(n.collapsed ? [] : (n.children || []), 1);
    return false;   // 하위는 이 묶음이 맡음
  });
  if (!any) return null;
  var out = {}, ids = {};
  Object.keys(sizes).forEach(function (k) { out[k] = sizes[k]; });
  Object.keys(groups).forEach(function (key) {
    var list = groups[key];
    if (list.length < 2) return;
    var w = 0, h = 0;
    list.forEach(function (id) { var s0 = sz(id); w = Math.max(w, s0.w); h = Math.max(h, s0.h); });
    list.forEach(function (id) {
      var s0 = sz(id);
      var nw = { w: w, h: structure === 'down' ? h : s0.h };
      if (nw.w !== s0.w || nw.h !== s0.h) { out[id] = nw; ids[id] = true; }
    });
  });
  return { sizes: out, ids: ids };
}

function _mmLayoutCore(root, structure, sizes) {
  var pos = {};
  function sz(n) { return sizes[n.id] || { w: 80, h: 30 }; }
  function kids(n) { return (n.collapsed || !n.children) ? [] : n.children; }
  function pad(n) { return n.boundary ? MM_BOUND_PAD * 2 : 0; }
  function sumSz(n) { return (n.summary && kids(n).length) ? (sizes['sum:' + n.id] || { w: 80, h: 26 }) : null; }

  // ── 가로 배치 (오른쪽 dir=1 / 왼쪽 dir=-1) ──
  var hMemo = {};
  function blockH(n) {
    if (hMemo[n.id] != null) return hMemo[n.id];
    var ks = kids(n);
    var sum = 0;
    ks.forEach(function (c, i) { sum += blockH(c) + (i ? MM_GAP.v : 0); });
    var ss = sumSz(n);
    if (ss) sum = Math.max(sum, ss.h);
    return (hMemo[n.id] = Math.max(sz(n).h, sum) + pad(n));
  }
  function placeH(n, x, top, dir, depth, parentId, side) {
    var s = sz(n);
    var bh = blockH(n);
    var y = top + bh / 2;   // 노드 중심 y
    var nx = dir > 0 ? x : x - s.w;   // x 는 부모 쪽 가장자리
    pos[n.id] = { x: nx, y: y - s.h / 2, w: s.w, h: s.h, side: side, depth: depth, parentId: parentId };
    var ks = kids(n);
    var sum = 0;
    ks.forEach(function (c, i) { sum += blockH(c) + (i ? MM_GAP.v : 0); });
    var cy = y - sum / 2;
    var cx = dir > 0 ? nx + s.w + MM_GAP.h : nx - MM_GAP.h;
    ks.forEach(function (c) {
      placeH(c, cx, cy, dir, depth + 1, n.id, side);
      cy += blockH(c) + MM_GAP.v;
    });
  }

  // ── 세로 배치 (조직도) ──
  var wMemo = {};
  function blockW(n) {
    if (wMemo[n.id] != null) return wMemo[n.id];
    var ks = kids(n);
    var sum = 0;
    ks.forEach(function (c, i) { sum += blockW(c) + (i ? MM_GAP.downH : 0); });
    var ss = sumSz(n);
    if (ss) sum = Math.max(sum, ss.w);
    return (wMemo[n.id] = Math.max(sz(n).w, sum) + pad(n));
  }
  function placeD(n, left, y, depth, parentId) {
    var s = sz(n);
    var bw = blockW(n);
    var cxm = left + bw / 2;
    pos[n.id] = { x: cxm - s.w / 2, y: y, w: s.w, h: s.h, side: 'down', depth: depth, parentId: parentId };
    var ks = kids(n);
    var sum = 0;
    ks.forEach(function (c, i) { sum += blockW(c) + (i ? MM_GAP.downH : 0); });
    var cl = cxm - sum / 2;
    ks.forEach(function (c) {
      placeD(c, cl, y + s.h + MM_GAP.downV, depth + 1, n.id);
      cl += blockW(c) + MM_GAP.downH;
    });
  }

  var rs = sz(root);
  if (structure === 'down') {
    placeD(root, -blockW(root) / 2, -rs.h / 2, 0, null);
  } else {
    pos[root.id] = { x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h, side: 'root', depth: 0, parentId: null };
    var ks = kids(root);
    var right = [], left = [];
    if (structure === 'right') {
      right = ks;
    } else {
      // balanced: side 가 지정된 노드는 그대로, 나머지는 가벼운 쪽에 (XMind 와 같은 시계방향 채우기)
      var rh = 0, lh = 0;
      ks.forEach(function (c) {
        var side = c.side;
        if (side !== 'left' && side !== 'right') side = rh <= lh ? 'right' : 'left';
        if (side === 'right') { right.push(c); rh += blockH(c) + MM_GAP.v; } else { left.push(c); lh += blockH(c) + MM_GAP.v; }
      });
    }
    [[right, 1, 'right'], [left, -1, 'left']].forEach(function (g) {
      var list = g[0], dir = g[1];
      if (!list.length) return;
      var sum = 0;
      list.forEach(function (c, i) { sum += blockH(c) + (i ? MM_GAP.v : 0); });
      var top = -sum / 2;
      var x = dir > 0 ? rs.w / 2 + MM_GAP.h * 1.4 : -rs.w / 2 - MM_GAP.h * 1.4;
      list.forEach(function (c) {
        placeH(c, x, top, dir, 1, root.id, g[2]);
        top += blockH(c) + MM_GAP.v;
      });
    });
  }

  var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  Object.keys(pos).forEach(function (id) {
    var p = pos[id];
    if (p.x < b.minX) b.minX = p.x;
    if (p.y < b.minY) b.minY = p.y;
    if (p.x + p.w > b.maxX) b.maxX = p.x + p.w;
    if (p.y + p.h > b.maxY) b.maxY = p.y + p.h;
  });
  return { pos: pos, bounds: b };
}

/** 보이는 하위(자기 포함 여부 선택)의 사각 범위 */
function mmSubtreeBox(node, pos, includeSelf) {
  var b = null;
  mmWalk(node, function (n) {
    if (n === node && !includeSelf) return n.collapsed ? false : undefined;
    var p = pos[n.id];
    if (!p) return false;
    if (!b) b = { minX: p.x, minY: p.y, maxX: p.x + p.w, maxY: p.y + p.h };
    else {
      b.minX = Math.min(b.minX, p.x); b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x + p.w); b.maxY = Math.max(b.maxY, p.y + p.h);
    }
    if (n.collapsed) return false;
  });
  return b;
}

/**
 * 경계 · 요약 위치. 반환 { boundaries: [{ id, x, y, w, h, title }], summaries: [{ id, side, path, x, y }] }
 * 요약은 하위 묶음 바깥쪽(오른쪽 가지는 오른쪽, 왼쪽 가지는 왼쪽, 조직도는 아래)에 중괄호 + 글상자.
 * 경계·요약이 차지한 범위만큼 layout.bounds 도 넓힌다.
 */
function mmDecorations(root, structure, layout, sizes) {
  var pos = layout.pos, out = { boundaries: [], summaries: [] }, b = layout.bounds;
  function grow(x1, y1, x2, y2) {
    b.minX = Math.min(b.minX, x1); b.minY = Math.min(b.minY, y1);
    b.maxX = Math.max(b.maxX, x2); b.maxY = Math.max(b.maxY, y2);
  }
  mmWalk(root, function (n) {
    var p = pos[n.id];
    if (!p) return false;
    if (n.boundary) {
      var bx = mmSubtreeBox(n, pos, true);
      var P = MM_BOUND_PAD - 2;
      var r = { id: n.id, x: bx.minX - P, y: bx.minY - P, w: bx.maxX - bx.minX + P * 2, h: bx.maxY - bx.minY + P * 2, title: n.boundary.title || '' };
      out.boundaries.push(r);
      grow(r.x, r.y - (r.title ? 18 : 0), r.x + r.w, r.y + r.h);
    }
    if (n.summary && !n.collapsed && (n.children || []).length) {
      var cb = mmSubtreeBox(n, pos, false);
      if (cb) {
        var ss = sizes['sum:' + n.id] || { w: 80, h: 26 };
        var s;
        if (structure === 'down') {
          var y0 = cb.maxY + 8, cx = (cb.minX + cb.maxX) / 2;
          s = { id: n.id, side: 'down', x: cx - ss.w / 2, y: y0 + 18,
            path: 'M' + cb.minX + ',' + y0 + ' Q' + cb.minX + ',' + (y0 + 8) + ' ' + (cx - 6) + ',' + (y0 + 8) + ' L' + cx + ',' + (y0 + 14) +
              ' L' + (cx + 6) + ',' + (y0 + 8) + ' Q' + cb.maxX + ',' + (y0 + 8) + ' ' + cb.maxX + ',' + y0 };
        } else {
          var left = p.side === 'left';
          var x0 = left ? cb.minX - 8 : cb.maxX + 8, d = left ? -1 : 1, cy = (cb.minY + cb.maxY) / 2;
          s = { id: n.id, side: left ? 'left' : 'right', x: left ? x0 - MM_SUM_GAP + 8 - ss.w : x0 + MM_SUM_GAP - 8, y: cy - ss.h / 2,
            path: 'M' + x0 + ',' + cb.minY + ' Q' + (x0 + 8 * d) + ',' + cb.minY + ' ' + (x0 + 8 * d) + ',' + (cy - 6) + ' L' + (x0 + 14 * d) + ',' + cy +
              ' L' + (x0 + 8 * d) + ',' + (cy + 6) + ' Q' + (x0 + 8 * d) + ',' + cb.maxY + ' ' + x0 + ',' + cb.maxY };
        }
        out.summaries.push(s);
        grow(s.x, s.y, s.x + ss.w, s.y + ss.h);
      }
    }
    if (n.collapsed) return false;
  });
  return out;
}

/** 번호 매기기 — numbering 이 켜진 주제의 하위에 1 · 1.1 · 1.1.1 */
function mmNumbering(root) {
  var out = {};
  mmWalk(root, function (n) {
    if (!n.numbering) return;
    (function go(list, prefix) {
      list.forEach(function (c, i) {
        var num = prefix ? prefix + '.' + (i + 1) : String(i + 1);
        out[c.id] = num;
        go(c.children || [], num);
      });
    })(n.children || [], '');
    return false;
  });
  return out;
}

/** 관계선 path — 두 주제 가장자리 사이 휘어진 곡선 + 가운데(라벨) 좌표 */
function mmRelationPath(a, b) {
  var acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  var sx, sy, ex, ey;
  if (Math.abs(bcx - acx) >= Math.max(a.w, b.w) / 2) {
    sx = bcx > acx ? a.x + a.w : a.x; sy = acy;
    ex = bcx > acx ? b.x : b.x + b.w; ey = bcy;
  } else {
    sx = acx; sy = bcy > acy ? a.y + a.h : a.y;
    ex = bcx; ey = bcy > acy ? b.y : b.y + b.h;
  }
  var dx = ex - sx, dy = ey - sy;
  var len = Math.sqrt(dx * dx + dy * dy) || 1;
  var bend = Math.min(80, len * 0.35);
  var nx = -dy / len * bend, ny = dx / len * bend;
  return {
    d: 'M' + sx + ',' + sy + ' C' + (sx + dx * 0.25 + nx) + ',' + (sy + dy * 0.25 + ny) + ' ' + (sx + dx * 0.75 + nx) + ',' + (sy + dy * 0.75 + ny) + ' ' + ex + ',' + ey,
    mx: (sx + ex) / 2 + nx * 0.75, my: (sy + ey) / 2 + ny * 0.75
  };
}

/**
 * 연결선 양 끝점. 가로 구조에서 2단계 아래 주제(밑줄 모양)는 밑줄 높이에서 잇는다 — XMind 기본 모양.
 * 반환 { sx, sy, ex, ey, vertical }
 */
function _mmEdgeEnds(p, c, structure) {
  if (structure === 'down') return { sx: p.x + p.w / 2, sy: p.y + p.h, ex: c.x + c.w / 2, ey: c.y, vertical: true };
  var left = c.side === 'left';
  return {
    sx: left ? p.x : p.x + p.w,
    sy: p.depth >= 2 ? p.y + p.h - 1 : p.y + p.h / 2,
    ex: left ? c.x + c.w : c.x,
    ey: c.depth >= 2 ? c.y + c.h - 1 : c.y + c.h / 2,
    vertical: false
  };
}

/** 부모→자식 연결선 SVG path (곡선). p·c = mmLayout 의 pos 항목 */
function mmEdgePath(p, c, structure) {
  var e = _mmEdgeEnds(p, c, structure);
  if (e.vertical) {
    var my = (e.sy + e.ey) / 2;
    return 'M' + e.sx + ',' + e.sy + ' C' + e.sx + ',' + my + ' ' + e.ex + ',' + my + ' ' + e.ex + ',' + e.ey;
  }
  var mx = (e.sx + e.ex) / 2;
  return 'M' + e.sx + ',' + e.sy + ' C' + mx + ',' + e.sy + ' ' + mx + ',' + e.ey + ' ' + e.ex + ',' + e.ey;
}

/**
 * 끝으로 갈수록 가늘어지는 가지 — 채운 도형 path. w0 = 부모 쪽 굵기, w1 = 자식 쪽 굵기.
 * 곡선 양 끝의 접선이 가로(조직도는 세로)라 그 수직 방향으로 두께를 벌린다.
 */
function mmEdgeShape(p, c, structure, w0, w1) {
  var e = _mmEdgeEnds(p, c, structure);
  var h0 = w0 / 2, h1 = w1 / 2;
  function pt(x, y) { return x + ',' + y; }
  if (e.vertical) {
    var my = (e.sy + e.ey) / 2;
    return 'M' + pt(e.sx - h0, e.sy) + ' C' + pt(e.sx - h0, my) + ' ' + pt(e.ex - h1, my) + ' ' + pt(e.ex - h1, e.ey) +
      ' L' + pt(e.ex + h1, e.ey) + ' C' + pt(e.ex + h1, my) + ' ' + pt(e.sx + h0, my) + ' ' + pt(e.sx + h0, e.sy) + ' Z';
  }
  var mx = (e.sx + e.ex) / 2;
  return 'M' + pt(e.sx, e.sy - h0) + ' C' + pt(mx, e.sy - h0) + ' ' + pt(mx, e.ey - h1) + ' ' + pt(e.ex, e.ey - h1) +
    ' L' + pt(e.ex, e.ey + h1) + ' C' + pt(mx, e.ey + h1) + ' ' + pt(mx, e.sy + h0) + ' ' + pt(e.sx, e.sy + h0) + ' Z';
}

/** 트리 → Markdown (# 중심 주제 / - 하위 들여쓰기 2칸). 완료 노드는 [x] */
function mmToMarkdown(root) {
  var out = ['# ' + (root.text || '').replace(/\n/g, ' ')];
  if (root.note) out.push('', String(root.note).trim());
  out.push('');
  (function go(list, depth) {
    list.forEach(function (n) {
      var t = (n.text || '').replace(/\n/g, ' ');
      out.push(new Array(depth + 1).join('  ') + '- ' + (n.done ? '[x] ' : '') + t);
      go(n.children || [], depth + 1);
    });
  })(root.children || [], 0);
  return out.join('\n') + '\n';
}

/**
 * Markdown → 트리. 지원: 제목(#~######) 계층 + 목록(-, *, +, 1.) 들여쓰기(공백·탭).
 * 첫 제목(또는 첫 줄)이 중심 주제. 내용이 없으면 null.
 */
function mmFromMarkdown(text) {
  var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  var root = null;
  var stack = [];   // { level, node } — level: 제목은 0~5, 목록은 10 + 들여쓰기
  var headBase = 0; // 목록 들여쓰기 기준이 될 마지막 제목 level
  function attach(level, node) {
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    var parent = stack.length ? stack[stack.length - 1].node : root;
    parent.children.push(node);
    stack.push({ level: level, node: node });
  }
  lines.forEach(function (raw) {
    if (!raw.trim()) return;
    var h = raw.match(/^(#{1,6})\s+(.*)$/);
    var li = raw.match(/^([ \t]*)(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (h) {
      var lvl = h[1].length - 1;
      var txt = h[2].trim();
      if (!root) { root = mmNewNode(txt); stack = []; headBase = lvl; return; }
      attach(Math.max(1, lvl - headBase), mmNewNode(txt));
      return;
    }
    if (li) {
      if (!root) root = mmNewNode('중심 주제');
      var indent = li[1].replace(/\t/g, '    ').length;
      var body = li[2];
      var done = false;
      var cm = body.match(/^\[( |x|X)\]\s+(.*)$/);
      if (cm) { done = cm[1].toLowerCase() === 'x'; body = cm[2]; }
      var node = mmNewNode(body.trim());
      if (done) node.done = true;
      // 마지막 제목 아래로: 목록 level = 10 + 들여쓰기
      attach(10 + Math.floor(indent / 2), node);
      return;
    }
    // 일반 문단: 중심 주제가 아직 없으면 그것으로, 아니면 바로 위 노드의 노트에 덧붙임
    var t = raw.trim();
    if (!root) { root = mmNewNode(t); return; }
    var last = stack.length ? stack[stack.length - 1].node : root;
    last.note = last.note ? last.note + '\n' + t : t;
  });
  return root;
}

/* ═══ XMind 가져오기 (content.json — XMind 2020 이후 / content.xml 은 mindmap.js 가 같은 모양으로 바꿔 넘김) ═══ */
var MM_XMIND_TASK = {
  'task-start': 0, 'task-oct': 13, 'task-quarter': 25, 'task-3oct': 38, 'task-half': 50, 'task-5oct': 63, 'task-3quar': 75, 'task-7oct': 88, 'task-done': 100
};
function _mmXmindMarker(id, n) {
  id = String(id || '');
  var pm = /^priority-(\d)$/.exec(id);
  if (pm) return 'priority-' + pm[1];
  if (MM_XMIND_TASK[id] != null) { n.progress = MM_XMIND_TASK[id]; if (id === 'task-done') n.done = true; return null; }
  if (/^flag-/.test(id)) return 'flag';
  if (/^star-/.test(id)) return 'star';
  var sm = /^smiley-(\w+)/.exec(id);
  if (sm) return { smile: 'smile', laugh: 'smile', boring: 'meh', cry: 'sad', angry: 'angry', surprise: 'surprise' }[sm[1]] || 'smile';
  var ar = /^arrow-(up|down|left|right|refresh)/.exec(id);
  if (ar) return ar[1];
  if (/question/.test(id)) return 'question';
  if (/(attention|exclam|warning)/.test(id)) return 'warning';
  if (/(idea|bulb)/.test(id)) return 'idea';
  if (/(^|-)(ok|right|yes|check)/.test(id)) return 'check';
  if (/(wrong|cross)$|-no$/.test(id)) return 'cross';
  if (/(people|person|user)/.test(id)) return 'people';
  return null;
}
function _mmRange(r, len) {
  if (!r || r === 'master') return [0, len - 1, true];
  var m = /\((\d+)\s*,\s*(\d+)\)/.exec(String(r));
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), false] : [0, len - 1, true];
}

/** XMind 시트 배열(content.json) → { sheets }. 지원하지 않는 요소(떠있는 주제·이미지·서식)는 건너뜀 */
function mmFromXmindSheets(sheets) {
  var out = [];
  var count = 0;
  (sheets || []).slice(0, 20).forEach(function (sh, si) {
    if (!sh || !sh.rootTopic) return;
    var idMap = {};
    function conv(t, depth) {
      var n = mmNewNode(String(t.title || '').slice(0, 500));
      if (++count > 2000 || depth > 50) return n;
      if (t.id) idMap[t.id] = n.id;
      if (t.notes && t.notes.plain && t.notes.plain.content) n.note = String(t.notes.plain.content).slice(0, 5000);
      if (t.href && /^https?:\/\//i.test(t.href)) n.link = t.href;
      if (Array.isArray(t.labels) && t.labels.length) n.labels = t.labels.map(String).slice(0, 10);
      var ms = [];
      (t.markers || []).forEach(function (m) {
        var k = _mmXmindMarker(m && (m.markerId || m['marker-id']), n);
        if (k && ms.indexOf(k) < 0) ms.push(k);
      });
      if (ms.length) n.markers = ms;
      if (t.branch === 'folded') n.collapsed = true;
      var kids = (t.children && t.children.attached) || [];
      n.children = kids.map(function (c) { return conv(c, depth + 1); });
      // 경계: 전체(master)·하위 전체 → 이 주제, 일부 범위 → 해당 하위 주제마다
      (t.boundaries || []).forEach(function (bd) {
        var r = _mmRange(bd.range, n.children.length);
        var title = String(bd.title || '').slice(0, 100);
        if (r[2] || (r[0] === 0 && r[1] >= n.children.length - 1)) n.boundary = { title: title };
        else for (var i = r[0]; i <= r[1] && i < n.children.length; i++) n.children[i].boundary = { title: i === r[0] ? title : '' };
      });
      // 요약: 요약 주제(children.summary)의 제목을 이 주제의 요약으로 (범위는 하위 전체로 단순화)
      var sumTopics = (t.children && t.children.summary) || [];
      if ((t.summaries || []).length && sumTopics.length) {
        var texts = [];
        t.summaries.forEach(function (sm) {
          var st = sumTopics.filter(function (x) { return x.id === sm.topicId; })[0];
          if (st && st.title) texts.push(st.title);
        });
        if (texts.length) n.summary = { text: texts.join(' / ').slice(0, 200) };
      }
      return n;
    }
    var root = conv(sh.rootTopic, 0);
    var sc = String(sh.rootTopic.structureClass || '');
    var structure = /(logic\.right|tree\.right|timeline|fishbone)/.test(sc) ? 'right' : /(org-chart|org\.chart|tree\.down)/.test(sc) ? 'down' : 'balanced';
    var rel = [];
    (sh.relationships || []).forEach(function (r) {
      var a = idMap[r.end1Id], b = idMap[r.end2Id];
      if (a && b && a !== b) rel.push({ id: 'r-' + mmUid().slice(2), from: a, to: b, label: String(r.title || '').slice(0, 100) });
    });
    out.push({ id: 'sh-' + (si + 1), title: String(sh.title || ('시트 ' + (si + 1))).slice(0, 60), structure: structure, root: root, relations: rel });
  });
  return out.length ? { sheets: out } : null;
}

/** OPML 내보내기 */
function mmToOpml(root, title) {
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;'); }
  var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', '<head><title>' + esc(title || root.text) + '</title></head>', '<body>'];
  (function go(n, depth) {
    var ind = new Array(depth + 2).join('  ');
    var attrs = ' text="' + esc(n.text) + '"' + (n.note ? ' _note="' + esc(n.note) + '"' : '') + (n.done ? ' _complete="true"' : '');
    var kids = n.children || [];
    if (!kids.length) { out.push(ind + '<outline' + attrs + '/>'); return; }
    out.push(ind + '<outline' + attrs + '>');
    kids.forEach(function (c) { go(c, depth + 1); });
    out.push(ind + '</outline>');
  })(root, 0);
  out.push('</body>', '</opml>');
  return out.join('\n') + '\n';
}

/** { text, note?, done?, children: [...] } 단순 트리 → 노드 트리 (OPML 가져오기 공용) */
function mmFromPlainTree(t, depth) {
  depth = depth || 0;
  var n = mmNewNode(String((t && t.text) || '').slice(0, 500));
  if (t && t.note) n.note = String(t.note).slice(0, 5000);
  if (t && t.done) n.done = true;
  if (depth < 50) n.children = ((t && t.children) || []).map(function (c) { return mmFromPlainTree(c, depth + 1); });
  return n;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mmUid: mmUid, mmNewNode: mmNewNode, mmWalk: mmWalk, mmFind: mmFind, mmCount: mmCount,
    mmIsAncestor: mmIsAncestor, mmRemoveNode: mmRemoveNode, mmMoveNode: mmMoveNode, mmCloneBranch: mmCloneBranch,
    mmLayout: mmLayout, mmEdgePath: mmEdgePath, mmEdgeShape: mmEdgeShape, mmToMarkdown: mmToMarkdown, mmFromMarkdown: mmFromMarkdown,
    mmSubtreeBox: mmSubtreeBox, mmAlignSizes: mmAlignSizes, mmDecorations: mmDecorations, mmNumbering: mmNumbering, mmRelationPath: mmRelationPath,
    mmFromXmindSheets: mmFromXmindSheets, mmToOpml: mmToOpml, mmFromPlainTree: mmFromPlainTree
  };
}
