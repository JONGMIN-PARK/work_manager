/**
 * 업무 관리자 — 🧠 마인드맵 편집 동작 · 이벤트
 * 변경·되돌리기·자동 저장, 주제 추가·삭제·접기·마커, 인라인 편집(한글 IME — #mmSink), 방향키 이동,
 * 가지 복사·붙여넣기, 검색, 클릭·끌기·상자 선택·휠·오른쪽 클릭·파일 놓기, 키 입력(mindmap-keys.js 로), 집중 모드, 관계선 잇기.
 * 의존(전역): mindmap.js, mindmap-view.js, mindmap-layout.js, mindmap-keys.js · mindmap-media.js · mindmap-extra.js(있으면)
 */

/* ═══ 변경 · 되돌리기 · 저장 ═══ */
function _mmSnapshot() { return JSON.stringify({ sheets: _mm.doc.sheets, sel: _mm.sel, sheetIdx: _mm.sheetIdx }); }
function _mmMutate(fn, opts) {
  if (_mm.readOnly) return false;
  _mm.undo.push(_mmSnapshot());
  if (_mm.undo.length > 50) _mm.undo.shift();
  _mm.redo = [];
  fn();
  _mmMarkDirty();
  if (!opts || opts.paint !== false) _mmPaint();
  return true;
}
function _mmRestore(snap) {
  var s = JSON.parse(snap);
  _mm.doc.sheets = s.sheets;
  _mm.sheetIdx = s.sheetIdx || 0;
  _mm.sel = mmFind(_mmRoot(), s.sel) ? s.sel : _mmRoot().id;
  _mmMarkDirty();
  _mmPaintSheets();
  if (typeof _mmAiBar === 'function') _mmAiBar();
  _mmPaint();
  var stSel = _mmEl('mmStructure');
  if (stSel) stSel.value = _mmSheet().structure || 'balanced';
}
function mmUndo() {
  if (_mm.readOnly || !_mm.undo.length) return;
  _mm.redo.push(_mmSnapshot());
  _mmRestore(_mm.undo.pop());
}
function mmRedo() {
  if (_mm.readOnly || !_mm.redo.length) return;
  _mm.undo.push(_mmSnapshot());
  _mmRestore(_mm.redo.pop());
}

function _mmMarkDirty() {
  _mm.dirty = true;
  _mmStatus();
  clearTimeout(_mm.saveTimer);
  _mm.saveTimer = setTimeout(_mmSaveNow, 1500);
}

function _mmSaveNow(force) {
  clearTimeout(_mm.saveTimer);
  if (!_mm.mapId || !_mm.dirty || (_mm.readOnly && !force) || (_mm.conflict && !force)) return _mm.savePromise || Promise.resolve();
  if (_mm.saving) { _mm.saveAgain = true; return _mm.savePromise; }
  _mm.saving = true;
  _mm.dirty = false;
  _mmStatus();
  var mapId = _mm.mapId;
  var body = { version: _mm.version, doc: _mmDocForSave() };
  if (_mm.titleDirty) body.title = _mm.row.title;
  _mm.savePromise = apiFetch('/api/mindmaps/' + encodeURIComponent(mapId), { method: 'PUT', body: JSON.stringify(body), timeoutMs: 30000 })
    .then(function (r) {
      if (_mm.mapId !== mapId) return;
      _mm.version = r.data.version;
      _mm.titleDirty = false;
      _mm.lastSaved = new Date();
    })
    .catch(function (e) {
      if (_mm.mapId !== mapId) return;
      _mm.dirty = true;
      if (e && e.status === 409) { _mm.conflict = (e.data && e.data.latest) || {}; _mmBanner(); }
      else _mmToast('❌ 저장 실패 — ' + _mmErr(e) + ' (잠시 후 다시 시도)', 'error');
    })
    .then(function () {
      _mm.saving = false;
      _mmStatus();
      if (_mm.saveAgain) { _mm.saveAgain = false; return _mmSaveNow(); }
    });
  return _mm.savePromise;
}

/** 저장용 문서 — AI 미리보기(_ai) 노드 제외, 양 끝이 없는 관계선 제거 */
function _mmDocForSave() {
  var d = JSON.parse(JSON.stringify(_mm.doc));
  d.sheets.forEach(function (sh) {
    (function strip(n) {
      n.children = (n.children || []).filter(function (c) { return !c._ai; });
      n.children.forEach(strip);
    })(sh.root);
    var ids = {};
    mmWalk(sh.root, function (n) { ids[n.id] = true; });
    if (sh.relations) sh.relations = sh.relations.filter(function (r) { return ids[r.from] && ids[r.to]; });
  });
  return d;
}

function _mmConflictOverwrite() {
  var id = _mm.mapId;
  apiFetch('/api/mindmaps/' + encodeURIComponent(id)).then(function (r) {
    if (_mm.mapId !== id) return;
    _mm.version = r.data.version;
    _mm.conflict = null;
    _mm.dirty = true;
    _mmBanner();
    return _mmSaveNow();
  }).catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
}

/* ═══ 노드 편집 동작 ═══ */
function _mmSelInfo() { return _mm.doc ? mmFind(_mmRoot(), _mm.sel) : null; }

function mmAddChild() {
  var f = _mmSelInfo();
  if (!f) return;
  var n = mmNewNode(f.depth === 0 ? '주요 주제' : '하위 주제');
  if (!_mmMutate(function () {
    f.node.collapsed = false;
    (f.node.children || (f.node.children = [])).push(n);
    _mm.sel = n.id;
  })) return;
  _mmEdit(n.id, null);
}
function mmAddSibling() {
  var f = _mmSelInfo();
  if (!f) return;
  if (!f.parent) { mmAddChild(); return; }
  var n = mmNewNode(f.depth === 1 ? '주요 주제' : '하위 주제');
  // 1단계 주제는 지금 보이는 쪽(왼쪽/오른쪽)에 이어서 생기도록
  var curSide = _mm.layout && _mm.layout.pos[f.node.id] && _mm.layout.pos[f.node.id].side;
  if (f.depth === 1 && (curSide === 'left' || curSide === 'right')) n.side = curSide;
  if (!_mmMutate(function () { f.parent.children.splice(f.index + 1, 0, n); _mm.sel = n.id; })) return;
  _mmEdit(n.id, null);
}
function mmAddParent() {
  var f = _mmSelInfo();
  if (!f || !f.parent) return;
  var n = mmNewNode('주제');
  if (!_mmMutate(function () {
    if (f.node.side) { n.side = f.node.side; delete f.node.side; }
    f.parent.children.splice(f.index, 1, n);
    n.children.push(f.node);
    _mm.sel = n.id;
  })) return;
  _mmEdit(n.id, null);
}
function mmDeleteSel() {
  var root = _mmRoot();
  var ids = _mmSelIds().filter(function (id) { return id !== root.id; });
  if (!ids.length) return;
  // 다른 선택 주제의 하위는 같이 지워지므로 빼고, 지운 뒤엔 첫 주제의 이웃(없으면 부모)을 선택
  ids = ids.filter(function (id) { return !ids.some(function (o) { return o !== id && mmIsAncestor(root, o, id); }); });
  var f = mmFind(root, ids[0]);
  var sibs = f.parent.children;
  var next = sibs.filter(function (c) { return ids.indexOf(c.id) < 0; })[0] || f.parent;
  _mmMutate(function () {
    ids.forEach(function (id) { mmRemoveNode(root, id); });
    _mm.multi = [];
    _mm.sel = next.id;
  });
}
function mmToggleFold(id) {
  var f = mmFind(_mmRoot(), id || _mm.sel);
  if (!f || !(f.node.children || []).length) return;
  // 접기는 보기 상태라 보기 전용에서도 허용 (저장은 하지 않음)
  if (_mm.readOnly) { f.node.collapsed = !f.node.collapsed; _mmPaint(); return; }
  _mmMutate(function () { f.node.collapsed = !f.node.collapsed; });
}
function _mmFoldAll(level) {
  var apply = function () {
    mmWalk(_mmRoot(), function (n, parent, depth) {
      if ((n.children || []).length) n.collapsed = level != null && depth >= level;
    });
  };
  if (_mm.readOnly) { apply(); _mmPaint(); } else _mmMutate(apply);
  // 숨겨진 노드가 선택돼 있으면 가장 가까운 보이는 조상으로
  if (_mm.layout && !_mm.layout.pos[_mm.sel]) {
    var cur = _mmSelInfo();
    while (cur && cur.parent && !_mm.layout.pos[cur.node.id]) cur = mmFind(_mmRoot(), cur.parent.id);
    _mmSelect(cur ? cur.node.id : _mmRoot().id);
  }
  _mmFit();
}
function _mmSetMarker(kind, value) {
  var f = _mmSelInfo();
  if (!f) return;
  _mmMutate(function () {
    var ms = (f.node.markers || []).slice();
    if (kind === 'priority') {
      ms = ms.filter(function (m) { return !/^priority-/.test(m); });
      if (value) ms.unshift('priority-' + value);
    } else {
      var i = ms.indexOf(value);
      if (i >= 0) ms.splice(i, 1); else ms.push(value);
    }
    if (ms.length) f.node.markers = ms; else delete f.node.markers;
  });
}
function _mmSetProp(key, value) {
  var f = _mmSelInfo();
  if (!f) return;
  _mmMutate(function () {
    if (value === '' || value == null || value === false || (Array.isArray(value) && !value.length)) delete f.node[key];
    else f.node[key] = value;
  });
}

/* ── 인라인 편집 ── */
function _mmEdit(id, initial, useSink) {
  if (_mm.readOnly || _mm.editing) return;
  var stage = _mmEl('mmStage'), cv = _mmEl('mmCanvas');
  var f = mmFind(_mmRoot(), id);
  if (!stage || !cv || !f) return;
  _mmSelect(id);
  var p = _mm.layout && _mm.layout.pos[id];
  if (!p) return;
  var el = stage.querySelector('.mm-node[data-id="' + id + '"]');
  // 입력칸은 캔버스 좌표에 겹쳐 띄운다 (확대 배율만큼 scale). 한글 입력은 키 받는 칸(mmSink) 자체가
  // 그대로 입력칸이 된다 — 조합 중에 다른 칸으로 포커스를 옮기면 첫 글자가 깨지기 때문
  var ta = useSink ? _mmEl('mmSink') : document.createElement('textarea');
  if (!ta) return;
  ta.classList.add('mm-inline');
  if (!useSink) ta.value = initial != null ? initial : (f.node.text || '');
  // 입력칸은 넉넉하게(최소 260px), 쓰는 만큼 480px 까지 넓어짐. 글씨는 주제와 같게.
  // 왼쪽 가지는 오른쪽 끝을, 조직도는 가운데를 고정해 부모 쪽을 가리지 않게
  var MIN_W = Math.max(p.w, 260), MAX_W = Math.max(p.w, 480);
  if (el) {
    var cs = getComputedStyle(el);
    ta.style.fontSize = cs.fontSize;
    ta.style.fontWeight = cs.fontWeight;
    ta.style.textAlign = cs.textAlign;
  }
  var meas = document.createElement('span');
  meas.className = 'mm-inline-meas';
  meas.style.font = ta.style.fontWeight + ' ' + (ta.style.fontSize || '12.5px') + ' ' + getComputedStyle(cv).fontFamily;
  document.body.appendChild(meas);
  function place(w) {
    var x = p.x;
    if (p.side === 'left') x = p.x + p.w - w;
    else if (p.side === 'down' || p.side === 'root') x = p.x + p.w / 2 - w / 2;
    ta.style.width = w + 'px';
    ta.style.left = (_mm.panX + x * _mm.zoom) + 'px';
  }
  function fitWidth() {
    var longest = 0;
    String(ta.value || '').split(/\n/).forEach(function (line) { meas.textContent = line || ' '; longest = Math.max(longest, meas.offsetWidth); });
    place(Math.min(MAX_W, Math.max(MIN_W, Math.ceil(longest) + 34)));
  }
  ta.style.top = (_mm.panY + p.y * _mm.zoom) + 'px';
  ta.style.minHeight = p.h + 'px';
  ta.style.transform = 'scale(' + _mm.zoom + ')';
  place(MIN_W);
  if (el) el.style.visibility = 'hidden';
  if (!useSink) cv.appendChild(ta);
  _mm.editing = true;
  var done = false;
  function grow() { fitWidth(); ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  function onKey(e) {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;   // 한글 조합 중 Enter 는 조합 확정
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Tab') { e.preventDefault(); finish(true, mmAddChild); }
  }
  function onBlur() { finish(true); }
  function onDown(e) { e.stopPropagation(); }
  function finish(commit, then) {
    if (done) return;
    done = true;
    var v = ta.value.replace(/\s+$/, '');
    ta.removeEventListener('input', grow);
    ta.removeEventListener('keydown', onKey);
    ta.removeEventListener('blur', onBlur);
    ta.removeEventListener('mousedown', onDown);
    meas.remove();
    if (useSink) { ta.classList.remove('mm-inline'); ta.removeAttribute('style'); ta.value = ''; }
    else ta.remove();
    _mm.editing = false;
    if (el) el.style.visibility = '';
    if (commit && v !== (f.node.text || '')) _mmMutate(function () { f.node.text = v; });
    else _mmPaint();
    _mmFocusCanvas();
    if (then) then();
  }
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', onKey);
  ta.addEventListener('blur', onBlur);
  ta.addEventListener('mousedown', onDown);
  if (!useSink) {
    ta.focus();
    if (initial == null) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  grow();
}

/* ── 방향키 이동 (화면 위치 기준 — 모든 구조에서 같은 감각) ── */
function _mmNav(dir) {
  var lay = _mm.layout;
  var cur = lay && lay.pos[_mm.sel];
  if (!cur) { _mmSelect(_mmRoot().id); return; }
  var cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
  var best = null, bestScore = Infinity;
  Object.keys(lay.pos).forEach(function (id) {
    if (id === _mm.sel) return;
    var p = lay.pos[id];
    var dx = p.x + p.w / 2 - cx, dy = p.y + p.h / 2 - cy;
    var main, cross;
    if (dir === 'left') { main = -dx; cross = dy; }
    else if (dir === 'right') { main = dx; cross = dy; }
    else if (dir === 'up') { main = -dy; cross = dx; }
    else { main = dy; cross = dx; }
    if (main <= 4) return;
    var score = main + Math.abs(cross) * 2.5;
    if (score < bestScore) { bestScore = score; best = id; }
  });
  if (best) _mmSelect(best);
}

/* ── 가지 복사 · 붙여넣기 ── */
function _mmCopy(e, cut) {
  var root = _mmRoot();
  var ids = _mmSelIds();
  ids = ids.filter(function (id) { return !ids.some(function (o) { return o !== id && mmIsAncestor(root, o, id); }); });
  var nodes = ids.map(function (id) { var f = mmFind(root, id); return f && f.node; }).filter(Boolean);
  if (!nodes.length) return;
  // 가지를 Markdown 목록으로 — 다른 앱(메모·XMind)에 붙여넣어도 같은 모양
  var out = [];
  nodes.forEach(function (node) {
    mmWalk(node, function (n, parent, depth) {
      out.push(new Array(depth + 1).join('  ') + '- ' + (n.done ? '[x] ' : '') + String(n.text || '').replace(/\n/g, ' '));
    });
  });
  var md = out.join('\n') + '\n';
  _mm.clip = JSON.stringify(nodes);
  _mm.clipText = md;
  if (e && e.clipboardData) { e.clipboardData.setData('text/plain', md); e.preventDefault(); }
  if (cut && !_mm.readOnly) mmDeleteSel();
  _mmToast((cut ? '잘라냈습니다' : '복사했습니다') + (nodes.length > 1 ? ' (' + nodes.length + '개 가지)' : ''));
}
function _mmPaste(e) {
  if (_mm.readOnly) return;
  if (e && e.clipboardData && typeof mmPasteImages === 'function' && mmPasteImages(e)) return;   // 캡처 이미지 붙여넣기
  var f = _mmSelInfo();
  if (!f) return;
  var text = e && e.clipboardData ? e.clipboardData.getData('text/plain') : '';
  if (e) e.preventDefault();
  var nodes = [];
  if (_mm.clip && (!text || text === _mm.clipText)) {
    var clip = JSON.parse(_mm.clip);
    nodes = (Array.isArray(clip) ? clip : [clip]).map(mmCloneBranch);
  } else if (text && text.trim()) {
    var lines = text.trim().split(/\r?\n/);
    if (lines.length === 1) nodes = [mmNewNode(lines[0].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())];
    else {
      var parsed = mmFromMarkdown(text);
      if (parsed) nodes = parsed.text === '중심 주제' && !/^#/.test(text.trim()) ? parsed.children : [parsed];
    }
  }
  if (!nodes.length) return;
  _mmMutate(function () {
    f.node.collapsed = false;
    nodes.forEach(function (n) { delete n.side; (f.node.children || (f.node.children = [])).push(n); });
    _mm.sel = nodes[0].id;
  });
  _mmEnsureVisible(_mm.sel);
}

/* ── 검색 ── */
function _mmSearch(q, jump, step) {
  q = (q || '').trim().toLowerCase();
  _mm.search = q;
  var hits = [];
  if (q) mmWalk(_mmRoot(), function (n) {
    var lines = (n.blocks || []).map(function (b) { return b.t === 'text' ? b.v || '' : ''; }).join(' ');
    var hay = ((n.text || '') + ' ' + lines + ' ' + (n.note || '') + ' ' + (n.labels || []).join(' ')).toLowerCase();
    if (hay.indexOf(q) >= 0) hits.push(n.id);
  });
  var changed = hits.join() !== _mm.hits.join();
  _mm.hits = hits;
  if (!jump) { _mm.hitIdx = -1; if (changed || !q) _mmPaint(); return; }
  if (!hits.length) { _mmToast('찾는 내용이 없습니다'); return; }
  _mm.hitIdx = (_mm.hitIdx + (step || 1) + hits.length) % hits.length;
  var id = hits[_mm.hitIdx];
  // 접힌 조상 펼치기 (보기 상태 — 저장 대상은 아님)
  var f = mmFind(_mmRoot(), id), opened = false;
  while (f && f.parent) {
    if (f.parent.collapsed) { f.parent.collapsed = false; opened = true; }
    f = mmFind(_mmRoot(), f.parent.id);
  }
  _mm.sel = id;
  _mmPaint();
  if (opened && !_mm.readOnly) _mmMarkDirty();
  _mmSelect(id);
  var s = _mmEl('mmStatus');
  if (s) s.textContent = '검색 ' + (_mm.hitIdx + 1) + '/' + hits.length;
}

/* ═══ 이벤트 ═══ */
function _mmEdClick(e) {
  var t = e.target.closest('[data-act]');
  var act = t && this.contains(t) ? t.getAttribute('data-act') : null;
  // 열린 메뉴는 다른 곳을 누르면 닫음
  document.querySelectorAll('#mindmapWrap .mm-menu').forEach(function (m) {
    if (!(act === 'menu' && t.getAttribute('data-menu') === m.id)) m.classList.add('hidden');
  });
  if (!act) return;
  switch (act) {
    case 'menu':
      var mEl = _mmEl(t.getAttribute('data-menu'));
      if (mEl && mEl.id === 'mmAlignMenu') _mmPaintAlignMenu();
      if (mEl) mEl.classList.toggle('hidden');
      return;
    case 'sheet':
      var si = parseInt(t.getAttribute('data-i'), 10);
      if (si === _mm.sheetIdx && e.detail >= 2) mmRenameSheet(); else mmSwitchSheet(si);
      return;
    case 'sheet-add': e.stopPropagation(); mmAddSheet(); return;
    case 'sheet-del': e.stopPropagation(); mmDeleteSheet(parseInt(t.getAttribute('data-i'), 10)); return;
    case 'relation': mmStartRelation(); return;
    case 'rel-del': _mmMutate(function () { var id = t.getAttribute('data-rel'); _mmSheet().relations = (_mmSheet().relations || []).filter(function (r) { return r.id !== id; }); }); return;
    case 'refs-refresh': _mm.refs = {}; _mmPaint(); _mmResolveRefs().then(function () { _mmToast('연결 항목 상태를 새로 불러왔습니다'); }); return;
    case 'link-ref': if (typeof mmLinkModal === 'function') mmLinkModal(); return;
    case 'ref-open': var rf = _mmSelInfo(); if (rf && rf.node.ref && typeof mmOpenRef === 'function') mmOpenRef(rf.node.ref); return;
    case 'ref-unlink': _mmSetProp('ref', null); return;
    case 'promote': if (typeof mmPromoteModal === 'function') mmPromoteModal(t.getAttribute('data-kind')); return;
    case 'resync': if (typeof mmResync === 'function') mmResync(); return;
    case 'export-opml': if (typeof mmExportOpml === 'function') mmExportOpml(); return;
    case 'ai-expand': if (typeof mmAiExpand === 'function') mmAiExpand(); return;
    case 'ai-summary': if (typeof mmAiSummary === 'function') mmAiSummary(); return;
    case 'ai-text': if (typeof mmAiTextModal === 'function') mmAiTextModal(); return;
    case 'ai-wbs': if (typeof mmAiWbsModal === 'function') mmAiWbsModal(); return;
    case 'ai-accept': if (typeof mmAiAccept === 'function') mmAiAccept(); return;
    case 'ai-discard': if (typeof mmAiDiscard === 'function') mmAiDiscard(); return;
    case 'back': mmBack(); return;
    case 'child': mmAddChild(); return;
    case 'sibling': mmAddSibling(); return;
    case 'parent': mmAddParent(); return;
    case 'del': mmDeleteSel(); break;
    case 'undo': mmUndo(); break;
    case 'redo': mmRedo(); break;
    case 'fold': mmToggleFold(); break;
    case 'fold-all': _mmFoldAll(1); break;
    case 'unfold-all': _mmFoldAll(null); break;
    case 'zoom-in': _mmZoomAt(1.2); break;
    case 'zoom-out': _mmZoomAt(1 / 1.2); break;
    case 'fit': _mmFit(); break;
    case 'minimap': mmToggleMinimap(); break;
    case 'zen': _mmSetZen(!_mm.zen); break;
    case 'view-map': _mmSetOutline(false); return;
    case 'view-outline': _mmSetOutline(true); return;
    case 'export-png': mmExportPng(); return;
    case 'export-md': mmExportMarkdown(); return;
    case 'share': mmShareModal(); return;
    case 'help': if (typeof mmHelpModal === 'function') mmHelpModal(); return;
    case 'palette': if (typeof mmPalette === 'function') mmPalette(); return;
    case 'cmd': if (typeof mmRunCommand === 'function') mmRunCommand(t.getAttribute('data-cmd')); break;
    case 'take-lock':
      if (!confirm((_mm.lockedBy || '다른 사용자') + ' 님이 아직 편집 중일 수 있습니다.\n가져오면 그분이 마지막으로 저장한 내용부터 이어서 편집하고, 그분 화면은 보기 전용으로 바뀝니다.\n가져올까요?')) return;
      _mmLockAcquire(true); return;
    case 'conflict-reload': _mm.conflict = null; _mm.dirty = false; mmOpen(_mm.mapId); return;
    case 'conflict-overwrite': _mmConflictOverwrite(); return;
    case 'color': _mmSetProp('color', t.getAttribute('data-v')); return;
    case 'priority': _mmSetMarker('priority', t.getAttribute('data-v')); return;
    case 'symbol': _mmSetMarker('symbol', t.getAttribute('data-v')); return;
    default: return;
  }
  _mmFocusCanvas();
}

function _mmBindCanvas() {
  var cv = _mmEl('mmCanvas');
  if (!cv) return;
  var drag = null;   // { mode: 'pan'|'node', sx, sy, px, py, id, moved, ghost, target }

  cv.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || _mm.editing) return;
    var fold = e.target.closest('.mm-fold');
    if (fold) { e.preventDefault(); mmToggleFold(fold.getAttribute('data-fold')); return; }
    if (e.target.closest('.mm-zoom, .mm-zen-exit, a')) return;
    if (e.target.closest('.mm-minimap')) {
      // 미니맵 누른 채 끌면 계속 이동
      e.preventDefault();
      _mmMiniPan(e);
      var mv = function (ev) { _mmMiniPan(ev); };
      var up = function () { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
      return;
    }
    var node = e.target.closest('.mm-node');
    _mmFocusCanvas();
    var relLb = e.target.closest('.mm-rel-label');
    if (relLb) {
      // 관계선 라벨 → 출발 주제를 선택하고 패널의 관계 칸으로
      var rel = (_mmSheet().relations || []).filter(function (r) { return r.id === relLb.getAttribute('data-rel'); })[0];
      if (rel) { _mmSelect(rel.from); var ri = document.querySelector('#mmPanel [data-rel-label="' + rel.id + '"]'); if (ri) ri.focus(); }
      e.preventDefault();
      return;
    }
    if (node && _mm.relFrom) {
      mmFinishRelation(node.getAttribute('data-id'));
      e.preventDefault();
      return;
    }
    if (node && e.target.closest('[data-open-ref]')) {
      var rn = mmFind(_mmRoot(), node.getAttribute('data-id'));
      _mmSelect(rn.node.id, { scroll: false });
      if (rn && rn.node.ref && typeof mmOpenRef === 'function') mmOpenRef(rn.node.ref);
      e.preventDefault();
      return;
    }
    if (node && (e.ctrlKey || e.metaKey)) {
      _mmToggleMulti(node.getAttribute('data-id'));
      e.preventDefault();
      return;
    }
    if (node) {
      var id = node.getAttribute('data-id');
      if (_mm.multi.indexOf(id) < 0) _mmClearMulti();
      _mmSelect(id, { scroll: false });
      drag = { mode: 'node', sx: e.clientX, sy: e.clientY, id: id, moved: false };
    } else if (e.shiftKey) {
      // Shift+끌기: 상자 안 주제 여러 개 선택
      var cr = cv.getBoundingClientRect();
      var box = document.createElement('div');
      box.className = 'mm-selbox';
      cv.appendChild(box);
      drag = { mode: 'box', sx: e.clientX, sy: e.clientY, ox: cr.left, oy: cr.top, box: box };
    } else {
      _mmClearMulti();
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: _mm.panX, py: _mm.panY };
      cv.classList.add('mm-panning');
    }
    e.preventDefault();
  });
  function onMove(e) {
    if (!drag) return;
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (drag.mode === 'pan') {
      _mm.panX = drag.px + dx; _mm.panY = drag.py + dy;
      _mmApplyTransform();
      return;
    }
    if (drag.mode === 'box') {
      var x1 = Math.min(drag.sx, e.clientX) - drag.ox, y1 = Math.min(drag.sy, e.clientY) - drag.oy;
      drag.box.style.cssText = 'left:' + x1 + 'px;top:' + y1 + 'px;width:' + Math.abs(dx) + 'px;height:' + Math.abs(dy) + 'px';
      return;
    }
    if (_mm.readOnly || drag.id === _mmRoot().id) return;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      var src = _mmEl('mmStage').querySelector('.mm-node[data-id="' + drag.id + '"]');
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'mm-ghost';
      drag.ghost.textContent = src ? (src.querySelector('.mm-txt') || src).textContent : '';
      document.body.appendChild(drag.ghost);
      if (src) src.classList.add('mm-dragging');
    }
    drag.ghost.style.left = (e.clientX + 12) + 'px';
    drag.ghost.style.top = (e.clientY + 8) + 'px';
    var under = document.elementFromPoint(e.clientX, e.clientY);
    var tn = under && under.closest && under.closest('.mm-node');
    document.querySelectorAll('.mm-drop-child,.mm-drop-before,.mm-drop-after').forEach(function (x) { x.classList.remove('mm-drop-child', 'mm-drop-before', 'mm-drop-after'); });
    drag.target = null;
    if (tn) {
      var tid = tn.getAttribute('data-id');
      if (tid !== drag.id && !mmIsAncestor(_mmRoot(), drag.id, tid)) {
        var r = tn.getBoundingClientRect();
        var down = (_mmSheet().structure === 'down');
        var rel = down ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
        var zone = tid === _mmRoot().id ? 'child' : rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : 'child';
        tn.classList.add('mm-drop-' + zone);
        drag.target = { id: tid, zone: zone };
      }
    }
  }
  function onUp(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    cv.classList.remove('mm-panning');
    if (d.mode === 'box') {
      d.box.remove();
      // 화면 좌표 → 스테이지 좌표로 바꿔 겹치는 주제 선택
      var bx1 = (Math.min(d.sx, e.clientX) - d.ox - _mm.panX) / _mm.zoom, by1 = (Math.min(d.sy, e.clientY) - d.oy - _mm.panY) / _mm.zoom;
      var bx2 = (Math.max(d.sx, e.clientX) - d.ox - _mm.panX) / _mm.zoom, by2 = (Math.max(d.sy, e.clientY) - d.oy - _mm.panY) / _mm.zoom;
      var hit = Object.keys(_mm.layout ? _mm.layout.pos : {}).filter(function (id) {
        var p = _mm.layout.pos[id];
        return p.x < bx2 && p.x + p.w > bx1 && p.y < by2 && p.y + p.h > by1;
      });
      if (hit.length === 1) { _mm.multi = []; _mmSelect(hit[0]); }
      else if (hit.length) { _mm.multi = hit; _mm.sel = hit[0]; _mmPaintMulti(); _mmPaintPanel(); }
      return;
    }
    if (d.ghost) d.ghost.remove();
    document.querySelectorAll('.mm-dragging,.mm-drop-child,.mm-drop-before,.mm-drop-after').forEach(function (x) { x.classList.remove('mm-dragging', 'mm-drop-child', 'mm-drop-before', 'mm-drop-after'); });
    if (d.mode !== 'node' || !d.moved) return;
    var root = _mmRoot();
    if (d.target) {
      var t = d.target;
      _mmMutate(function () {
        if (t.zone === 'child') { mmMoveNode(root, d.id, t.id); var tf = mmFind(root, t.id); if (tf) tf.node.collapsed = false; }
        else {
          var tf2 = mmFind(root, t.id);
          var targetSide = _mm.layout && _mm.layout.pos[t.id] && _mm.layout.pos[t.id].side;
          mmMoveNode(root, d.id, tf2.parent.id, tf2.index + (t.zone === 'after' ? 1 : 0));
          if (tf2.parent === root && (targetSide === 'left' || targetSide === 'right')) mmFind(root, d.id).node.side = targetSide;
        }
      });
      return;
    }
    // 빈 곳에 놓음: 마인드맵 구조의 1단계 주제는 루트 기준 왼쪽/오른쪽으로 옮김
    var f = mmFind(root, d.id);
    if (f && f.parent === root && (_mmSheet().structure || 'balanced') === 'balanced') {
      var cvr = cv.getBoundingClientRect();
      var wx = (e.clientX - cvr.left - _mm.panX) / _mm.zoom;
      var side = wx < 0 ? 'left' : 'right';
      if (f.node.side !== side) _mmMutate(function () { f.node.side = side; });
    }
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  // 편집기를 다시 그리면 이전 캔버스의 리스너는 정리
  cv._mmCleanup = function () { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  if (_mmBindCanvas._prev && _mmBindCanvas._prev !== cv && _mmBindCanvas._prev._mmCleanup) _mmBindCanvas._prev._mmCleanup();
  _mmBindCanvas._prev = cv;

  cv.addEventListener('dblclick', function (e) {
    var imgEl = e.target.closest('.mm-blk-img[data-img]');
    if (imgEl && typeof mmImageView === 'function') { mmImageView(imgEl.getAttribute('data-img')); return; }
    var node = e.target.closest('.mm-node');
    if (node && !e.target.closest('.mm-fold')) _mmEdit(node.getAttribute('data-id'), null);
    else if (!node && !_mm.readOnly && _mmSheet().root) { _mmSelect(_mmRoot().id); }
  });
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      var r = cv.getBoundingClientRect();
      _mmZoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    } else {
      _mm.panX -= e.shiftKey ? e.deltaY : e.deltaX;
      _mm.panY -= e.shiftKey ? 0 : e.deltaY;
      _mmApplyTransform();
    }
  }, { passive: false });
  cv.addEventListener('keydown', _mmKey);
  // 이미지 파일 끌어다 놓기 → 놓은 주제(없으면 선택 주제)에 이미지 줄
  // (페이지 전체 파일 놓기 = 업무일지 가져오기 — app-init.js 의 body 핸들러로 올라가지 않게 막는다)
  function hasFiles(e) { return !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0); }
  cv.addEventListener('dragover', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!_mm.readOnly) cv.classList.add('mm-dropping');
  });
  cv.addEventListener('dragleave', function () { cv.classList.remove('mm-dropping'); });
  cv.addEventListener('drop', function (e) {
    cv.classList.remove('mm-dropping');
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    var ov = document.getElementById('dropOverlay');
    if (ov) ov.remove();
    if (_mm.readOnly) { _mmToast('보기 전용 맵에는 이미지를 넣을 수 없습니다'); return; }
    if (!e.dataTransfer.files.length || typeof mmAddImageFiles !== 'function') return;
    var under = document.elementFromPoint(e.clientX, e.clientY);
    var nd = under && under.closest && under.closest('.mm-node');
    mmAddImageFiles(e.dataTransfer.files, nd ? nd.getAttribute('data-id') : _mm.sel);
  });
  cv.addEventListener('contextmenu', function (e) {
    if (_mm.editing || typeof mmContextMenu !== 'function') return;
    e.preventDefault();
    var node = e.target.closest('.mm-node');
    if (node) {
      var id = node.getAttribute('data-id');
      if (_mm.multi.indexOf(id) < 0) { _mmClearMulti(); _mmSelect(id, { scroll: false }); }
    }
    _mmFocusCanvas();
    mmContextMenu(e.clientX, e.clientY, node ? 'node' : 'canvas');
  });
  var sink = _mmEl('mmSink');
  if (sink) {
    sink.addEventListener('compositionstart', function () {
      if (!_mm.editing && !_mm.readOnly) _mmEdit(_mm.sel, null, true);
    });
    sink.addEventListener('input', function () { if (!_mm.editing) sink.value = ''; });
  }
  cv.addEventListener('copy', function (e) { if (!_mm.editing) _mmCopy(e, false); });
  cv.addEventListener('cut', function (e) { if (!_mm.editing && !_mm.readOnly) _mmCopy(e, true); });
  cv.addEventListener('paste', function (e) { if (!_mm.editing) _mmPaste(e); });
}

function _mmKey(e) {
  if (_mm.editing) return;
  // 한글 등 IME 입력(keyCode 229)은 compositionstart 에서 mmSink 를 입력칸으로 바꿔 처리
  if (e.isComposing || e.keyCode === 229) return;
  // 단축키 — 표는 mindmap-keys.js (MM_COMMANDS). 복사·잘라내기·붙여넣기는 copy/cut/paste 이벤트로
  if (typeof mmHandleKey === 'function' && mmHandleKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
  var k = e.key;
  if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !_mm.readOnly) {
    // XMind 처럼: 주제를 고른 채 바로 타이핑하면 내용을 바꿔 씀
    e.preventDefault();
    _mmClearMulti();
    _mmEdit(_mm.sel, k);
  }
}

/* 페이지 단위 리스너 (1회) — 나가기 전 저장 경고 · 집중 모드 Esc */
function _mmBindGlobal() {
  if (_mmBindGlobal._done) return;
  _mmBindGlobal._done = true;
  window.addEventListener('beforeunload', function (e) {
    if (_mm.view === 'editor' && (_mm.dirty || _mm.saving)) {
      _mmSaveNow();
      e.preventDefault();
      e.returnValue = '';
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _mm.zen && !_mm.editing && !document.querySelector('.wa-modal-overlay')) _mmSetZen(false);
  });
}

function _mmSetZen(on) {
  _mm.zen = !!on;
  var ed = _mmEl('mmEd');
  if (!ed) return;
  ed.classList.toggle('mm-zen', _mm.zen);
  document.body.classList.toggle('mm-zen-body', _mm.zen);
  setTimeout(function () { _mmFit(); _mmFocusCanvas(); }, 30);
}

/* ═══ 관계선 ═══ */
function mmStartRelation() {
  if (_mm.readOnly || !_mm.sel) return;
  _mm.relFrom = _mm.sel;
  _mmPaint();
  var s = _mmEl('mmStatus');
  if (s) s.textContent = '↔ 이을 주제를 클릭하세요 (Esc 취소)';
  _mmFocusCanvas();
}
function mmCancelRelation() {
  _mm.relFrom = null;
  _mmPaint();
  _mmStatus();
}
function mmFinishRelation(toId) {
  var from = _mm.relFrom;
  _mm.relFrom = null;
  if (!from || from === toId) { _mmPaint(); _mmStatus(); return; }
  var dup = (_mmSheet().relations || []).some(function (r) { return (r.from === from && r.to === toId) || (r.from === toId && r.to === from); });
  if (dup) { _mmToast('이미 이어진 주제입니다'); _mmPaint(); _mmStatus(); return; }
  _mmMutate(function () {
    var sh = _mmSheet();
    (sh.relations || (sh.relations = [])).push({ id: 'r-' + mmUid().slice(2), from: from, to: toId, label: '' });
    _mm.sel = from;
  });
  _mmStatus();
  var inp = document.querySelector('#mmPanel .mm-rel-in');
  if (inp) inp.focus();
}
