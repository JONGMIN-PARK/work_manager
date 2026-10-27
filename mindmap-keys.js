/**
 * 업무 관리자 — 🧠 마인드맵 단축키 · 명령 (v13.218)
 * 단축키 표 하나(MM_COMMANDS)로 키 입력 · 오른쪽 클릭 메뉴 · 명령 찾기(Ctrl+/) · 단축키 도움말(F1)을 모두 만든다.
 * 키 이름은 mmKeyName(e) — Ctrl(=⌘)·Alt·Shift + 글자는 e.code 기준(한/영 상태와 무관), 나머지는 e.key.
 * 브라우저가 먼저 가져가는 조합(Ctrl+T/W/N/L/P, Alt+D/E/F, Alt+←/→ 등)은 쓰지 않는다.
 * 의존(전역): mindmap.js(_mm · _mmMutate · _mmSelIds · _mmSelInfo · mmAddChild …), mindmap-extra.js, mindmap-layout.js
 */

/* ═══ 키 이름 ═══ */
var MM_CODE_KEYS = { BracketLeft: '[', BracketRight: ']', Slash: '/', Equal: '=', Minus: '-', Space: 'Space', Backquote: '`', Comma: ',', Period: '.' };
function mmKeyName(e) {
  var code = e.code || '';
  var base;
  if (/^Key[A-Z]$/.test(code)) base = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) base = code.slice(5);
  else if (MM_CODE_KEYS[code]) base = MM_CODE_KEYS[code];
  else if (e.key === ' ') base = 'Space';
  else base = (e.key && e.key.length === 1) ? e.key.toUpperCase() : (e.key || '');
  return ((e.ctrlKey || e.metaKey) ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + base;
}

/** 화면 표시용 키 이름 — Alt+ArrowUp → Alt+↑ */
var MM_KEY_LABEL = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', PageUp: 'PgUp', PageDown: 'PgDn', Backspace: '⌫' };
function mmKeyLabel(k) {
  return String(k || '').split('+').map(function (p) { return MM_KEY_LABEL[p] || p; }).join('+');
}

/* ═══ 동작 (여러 선택 대응) ═══ */
function _mmkNodes() {
  var root = _mmRoot();
  return _mmSelIds().map(function (id) { var f = mmFind(root, id); return f && f.node; }).filter(Boolean);
}
/** 선택한 주제마다 fn(node) — 한 번의 되돌리기로 */
function _mmkEach(fn) {
  var nodes = _mmkNodes();
  if (!nodes.length) return;
  _mmMutate(function () { nodes.forEach(fn); });
  if (_mm.multi.length) _mmPaintMulti();
}
function _mmkPriority(v) {
  _mmkEach(function (n) {
    var ms = (n.markers || []).filter(function (m) { return !/^priority-/.test(m); });
    if (v) ms.unshift('priority-' + v);
    if (ms.length) n.markers = ms; else delete n.markers;
  });
}
function _mmkSymbol(k) {
  var nodes = _mmkNodes();
  var on = !nodes.every(function (n) { return (n.markers || []).indexOf(k) >= 0; });   // 하나라도 없으면 모두 켬
  _mmkEach(function (n) {
    var ms = (n.markers || []).filter(function (m) { return m !== k; });
    if (on) ms.push(k);
    if (ms.length) n.markers = ms; else delete n.markers;
  });
}
function _mmkColor(key) {
  _mmkEach(function (n) { if (key) n.color = key; else delete n.color; });
}
function _mmkColorCycle() {
  var first = _mmkNodes()[0];
  if (!first) return;
  var keys = MM_COLORS.map(function (c) { return c.key; });
  _mmkColor(keys[(keys.indexOf(first.color || '') + 1) % keys.length]);
}
function _mmkDone() {
  var nodes = _mmkNodes();
  var on = !nodes.every(function (n) { return n.done; });
  _mmkEach(function (n) { if (on) n.done = true; else delete n.done; _mmStampDone(n); });
}
var MM_PROGRESS_STEPS = [null, 0, 25, 50, 75, 100];
function _mmkProgress() {
  var first = _mmkNodes()[0];
  if (!first) return;
  var cur = (first.progress == null || first.progress === '') ? null : parseInt(first.progress, 10);
  var i = MM_PROGRESS_STEPS.indexOf(cur);
  var next = MM_PROGRESS_STEPS[(i + 1) % MM_PROGRESS_STEPS.length];
  _mmkEach(function (n) { if (next == null) delete n.progress; else n.progress = next; });
}
function _mmkFold(collapse) {
  _mmkEach(function (n) { if ((n.children || []).length) { if (collapse) n.collapsed = true; else delete n.collapsed; } });
}
/** Shift+Space: 하위가 접힌 게 있으면 모두 펴고, 아니면 하위를 모두 접음 (선택 주제는 펼친 채) */
function _mmkFoldDeep() {
  var f = _mmSelInfo();
  if (!f) return;
  var anyClosed = false;
  mmWalk(f.node, function (n) { if (n !== f.node && n.collapsed) anyClosed = true; });
  var apply = function () {
    delete f.node.collapsed;
    mmWalk(f.node, function (n) {
      if (n === f.node || !(n.children || []).length) return;
      if (anyClosed) delete n.collapsed; else n.collapsed = true;
    });
  };
  if (_mm.readOnly) { apply(); _mmPaint(); } else _mmMutate(apply);
}

function _mmkMoveSibling(dir) {
  var f = _mmSelInfo();
  if (!f || !f.parent) return;
  var j = f.index + dir;
  if (j < 0 || j >= f.parent.children.length) return;
  _mmMutate(function () {
    var arr = f.parent.children;
    arr.splice(f.index, 1);
    arr.splice(j, 0, f.node);
  });
  _mmEnsureVisible(f.node.id);
}
/** 들여쓰기: 바로 앞 형제의 마지막 하위로 */
function _mmkIndent() {
  var f = _mmSelInfo();
  if (!f || !f.parent || f.index === 0) return;
  var prev = f.parent.children[f.index - 1];
  _mmMutate(function () { delete prev.collapsed; mmMoveNode(_mmRoot(), f.node.id, prev.id); });
  _mmEnsureVisible(f.node.id);
}
/** 내어쓰기: 부모 바로 뒤 형제로 */
function _mmkOutdent() {
  var root = _mmRoot();
  var f = _mmSelInfo();
  if (!f || !f.parent || f.parent === root) return;
  var gp = mmFind(root, f.parent.id);
  var side = gp.parent === root ? f.parent.side : null;
  _mmMutate(function () {
    mmMoveNode(root, f.node.id, gp.parent.id, gp.index + 1);
    if (side) f.node.side = side;
  });
  _mmEnsureVisible(f.node.id);
}
function _mmkAddBefore() {
  var f = _mmSelInfo();
  if (!f) return;
  if (!f.parent) { mmAddChild(); return; }
  var n = mmNewNode(f.depth === 1 ? '주요 주제' : '하위 주제');
  var curSide = _mm.layout && _mm.layout.pos[f.node.id] && _mm.layout.pos[f.node.id].side;
  if (f.depth === 1 && (curSide === 'left' || curSide === 'right')) n.side = curSide;
  if (!_mmMutate(function () { f.parent.children.splice(f.index, 0, n); _mm.sel = n.id; })) return;
  _mmEdit(n.id, null);
}
function _mmkDuplicate() {
  var root = _mmRoot();
  var ids = _mmSelIds().filter(function (id) { return id !== root.id; });
  if (!ids.length) return;
  var made = [];
  _mmMutate(function () {
    ids.forEach(function (id) {
      var f = mmFind(root, id);
      if (!f) return;
      var c = mmCloneBranch(f.node);
      f.parent.children.splice(f.parent.children.indexOf(f.node) + 1, 0, c);
      made.push(c.id);
    });
    _mm.multi = made.length > 1 ? made : [];
    _mm.sel = made[0];
  });
  _mmEnsureVisible(_mm.sel);
}
/* ── 여러 줄 주제 ↔ 하위 주제 ── */
function _mmkLines() { var f = _mmSelInfo(); return f ? mmSplitLineItems(f.node.text).length : 0; }
/** 담당 이름 → 사용자와 같으면 assigneeId, 아니면 assigneeName */
function _mmkSetWho(n, who) {
  if (!who) return;
  var u = (_mm.members || []).filter(function (m) { return m.name === who; })[0];
  delete n.assigneeId; delete n.assigneeName;
  if (u) n.assigneeId = u.id; else n.assigneeName = who;
}
function _mmkItemNode(it) { var c = mmNewNode(it.text); _mmkSetWho(c, it.who); return c; }
/** 첫 줄은 주제 이름으로 두고, 둘째 줄부터 하위 주제로 (기존 하위 앞에) */
function _mmkSplitToChildren() {
  var f = _mmSelInfo();
  if (!f) return;
  var lines = String(f.node.text || '').replace(/\r\n?/g, '\n').split('\n');
  var first = lines.shift().trim();
  var items = mmSplitLineItems(lines.join('\n'));
  if (!items.length) { _mmToast('나눌 줄이 없습니다 (둘째 줄부터 하위 주제가 됩니다)', 'warning'); return; }
  _mmMutate(function () {
    f.node.text = first;
    f.node.children = items.map(_mmkItemNode).concat(f.node.children || []);
    delete f.node.collapsed;
  });
  _mmToast('줄 ' + items.length + '개를 하위 주제로 나눴습니다 — Ctrl+Z 로 되돌리기', 'success');
}
/** 줄마다 같은 단계 주제로 — 이 주제는 첫 줄이 되고(하위 · 속성 유지), 나머지 줄은 바로 뒤에 */
function _mmkSplitToSiblings() {
  var f = _mmSelInfo();
  if (!f || !f.parent) return;
  var items = mmSplitLineItems(f.node.text);
  if (items.length < 2) { _mmToast('두 줄 이상인 주제만 나눌 수 있습니다', 'warning'); return; }
  _mmMutate(function () {
    f.node.text = items[0].text;
    _mmkSetWho(f.node, items[0].who);
    var at = f.parent.children.indexOf(f.node) + 1;
    Array.prototype.splice.apply(f.parent.children, [at, 0].concat(items.slice(1).map(_mmkItemNode)));
  });
  _mmToast('주제 ' + items.length + '개로 나눴습니다 — Ctrl+Z 로 되돌리기', 'success');
}
var MM_LOSSY = ['assigneeId', 'assigneeName', 'startDate', 'dueDate', 'progress', 'done', 'note', 'link', 'ref', 'markers', 'labels', 'blocks', 'color', 'boundary', 'summary'];
/** 하위 주제를 이 주제의 줄로 합치기 (하위의 하위가 있으면 못 함) */
function _mmkMergeChildren() {
  var f = _mmSelInfo();
  if (!f) return;
  var kids = f.node.children || [];
  if (!kids.length) return;
  if (kids.some(function (k) { return (k.children || []).length; })) { _mmToast('하위의 하위가 있는 주제는 줄로 합칠 수 없습니다', 'warning'); return; }
  var lossy = kids.filter(function (k) {
    return MM_LOSSY.some(function (p) { var v = k[p]; return v != null && v !== '' && v !== false && !(Array.isArray(v) && !v.length); });
  }).length;
  if (lossy && !confirm('담당 · 진행률 · 일정 · 메모 같은 정보가 있는 하위 주제 ' + lossy + '개가 있습니다.\n줄로 합치면 그 정보는 사라집니다 (Ctrl+Z 로 되돌릴 수 있음). 합칠까요?')) return;
  var ids = kids.map(function (k) { return k.id; });
  _mmMutate(function () {
    var text = String(f.node.text || '').replace(/\s+$/, '');
    f.node.text = (text ? text + '\n' : '') + kids.map(function (k) { return String(k.text || '').trim(); }).filter(Boolean).join('\n');
    f.node.children = [];
    delete f.node.collapsed; delete f.node.summary; delete f.node.numbering; delete f.node.alignLevels;
    var sh = _mmSheet();
    if (sh.relations) sh.relations = sh.relations.filter(function (r) { return ids.indexOf(r.from) < 0 && ids.indexOf(r.to) < 0; });
    _mm.sel = f.node.id;
  });
}

/* ── 서식 복사 · 붙여넣기 (색 · 굵게 · 글자 크기) ── */
function _mmkCopyStyle() {
  var f = _mmSelInfo();
  if (!f) return;
  var st = {};
  MM_STYLE_KEYS.forEach(function (k) { if (f.node[k] != null && f.node[k] !== '' && f.node[k] !== false) st[k] = f.node[k]; });
  _mm.styleClip = st;
  _mmToast('서식을 복사했습니다 — 붙일 주제를 고르고 Alt+Shift+V', 'success');
}
function _mmkPasteStyle() {
  var st = _mm.styleClip;
  if (!st) { _mmToast('먼저 서식을 복사하세요 (Alt+Shift+C)', 'warning'); return; }
  _mmkEach(function (n) { MM_STYLE_KEYS.forEach(function (k) { if (st[k] != null) n[k] = st[k]; else delete n[k]; }); });
}
function _mmkBold() { var all = _mmkNodes().every(function (n) { return n.bold; }); _mmkEach(function (n) { if (all) delete n.bold; else n.bold = true; }); }
function _mmkFontSize(step) {
  var order = ['s', '', 'l'];
  _mmkEach(function (n) {
    var i = Math.max(0, Math.min(2, order.indexOf(n.fs || '') + step));
    if (order[i]) n.fs = order[i]; else delete n.fs;
  });
}

function _mmkToggleBoundary() {
  var nodes = _mmkNodes();
  var on = !nodes.every(function (n) { return n.boundary; });
  _mmkEach(function (n) { if (on) n.boundary = n.boundary || { title: '' }; else delete n.boundary; });
}
function _mmkToggleSummary() {
  var f = _mmSelInfo();
  if (!f) return;
  if (!(f.node.children || []).length) { _mmToast('하위 주제가 있어야 요약을 붙일 수 있습니다'); return; }
  var on = !f.node.summary;
  _mmMutate(function () { if (on) { f.node.summary = { text: '요약' }; delete f.node.collapsed; } else delete f.node.summary; });
  if (on) _mmkFocusPanel('mmPnSumText');
}
function _mmkToggleNumbering() {
  _mmkEach(function (n) { if (n.numbering) delete n.numbering; else if ((n.children || []).length) n.numbering = true; });
}
/** 속성 패널의 입력칸으로 (여러 선택이면 하나로 줄임) */
function _mmkFocusPanel(id) {
  if (_mm.multi.length) _mmClearMulti();
  _mmPaintPanel();
  var el = _mmEl(id);
  if (!el) return;
  if (typeof _mmPnUnfoldFor === 'function') _mmPnUnfoldFor(el);
  el.focus();
  if (el.select) el.select();
}
function _mmkSelectAll() {
  var ids = Object.keys((_mm.layout && _mm.layout.pos) || {});
  if (ids.length < 2) return;
  _mm.multi = ids;
  _mmPaintMulti();
  _mmPaintPanel();
}
/** Esc: 관계 잇기 → 여러 선택 → 집중 모드 순으로 끔. 끌 게 없으면 false */
function _mmkEscape() {
  if (_mm.relFrom) { mmCancelRelation(); return true; }
  if (_mm.multi.length) { _mmClearMulti(); return true; }
  if (_mm.zen) { _mmSetZen(false); return true; }
  return false;
}
function _mmkSheetStep(d) {
  var n = _mm.doc.sheets.length;
  if (n > 1) mmSwitchSheet((_mm.sheetIdx + d + n) % n);
}
function _mmkStructure() {
  var order = MM_STRUCTURES.map(function (s) { return s.k; });
  var next = order[(order.indexOf(_mmSheet().structure || 'balanced') + 1) % order.length];
  if (_mmMutate(function () { _mmSheet().structure = next; })) { var sel = _mmEl('mmStructure'); if (sel) sel.value = next; _mmFit(); }
}
/** 같은 단계 맞춤 켜기/끄기 — 선택 주제(중심 주제면 맵 전체) */
function _mmkAlign() {
  var nodes = _mmkNodes().filter(function (n) { return (n.children || []).length; });
  if (!nodes.length) { _mmToast('하위 주제가 있는 주제에서 쓸 수 있습니다'); return; }
  var on = !nodes.every(function (n) { return n.alignLevels; });
  _mmkEach(function (n) { if (!(n.children || []).length) return; if (on) n.alignLevels = true; else delete n.alignLevels; });
  _mmToast(on ? '같은 단계를 맞췄습니다' : '같은 단계 맞춤을 껐습니다');
}
function _mmkAlignAll() {
  var root = _mmRoot();
  var on = !root.alignLevels;
  _mmMutate(function () { if (on) root.alignLevels = true; else delete root.alignLevels; });
  _mmToast(on ? '맵 전체의 같은 단계를 맞췄습니다' : '맵 전체 맞춤을 껐습니다');
}
function _mmkTextAlign(k) {
  _mmMutate(function () { var sh = _mmSheet(); if (k === 'auto') delete sh.textAlign; else sh.textAlign = k; });
}
function _mmkSingle(fn) { return function () { if (_mm.multi.length) _mmClearMulti(); fn(); }; }
function _mmkHasKids() { var f = _mmSelInfo(); return !!(f && (f.node.children || []).length); }
function _mmkNotRoot() { var f = _mmSelInfo(); return !!(f && f.parent); }
function _mmkFree() { var f = _mmSelInfo(); return !!(f && !f.node.ref); }

/* ═══ 단축키 표 ═══
 * { id, label, group, keys, run, edit(편집 권한 필요), when(보일 조건) } */
var MM_COMMANDS = [
  // 주제 추가 · 편집
  { id: 'addChild', group: '주제', label: '하위 주제 추가', keys: ['Tab', 'Insert'], edit: true, run: _mmkSingle(function () { mmAddChild(); }) },
  { id: 'addSibling', group: '주제', label: '형제 주제 추가 (아래)', keys: ['Enter'], edit: true, run: _mmkSingle(function () { mmAddSibling(); }) },
  { id: 'addBefore', group: '주제', label: '형제 주제 추가 (위)', keys: ['Shift+Enter'], edit: true, run: _mmkSingle(_mmkAddBefore) },
  { id: 'addParent', group: '주제', label: '부모 주제 끼워 넣기', keys: ['Ctrl+Enter'], edit: true, when: _mmkNotRoot, run: _mmkSingle(function () { mmAddParent(); }) },
  { id: 'edit', group: '주제', label: '주제 글 고치기', keys: ['F2'], edit: true, run: _mmkSingle(function () { _mmEdit(_mm.sel, null); }) },
  { id: 'duplicate', group: '주제', label: '가지 복제', keys: ['Ctrl+D'], edit: true, when: _mmkNotRoot, run: _mmkDuplicate },
  { id: 'delete', group: '주제', label: '삭제 (하위 포함)', keys: ['Delete', 'Backspace'], edit: true, when: _mmkNotRoot, run: function () { mmDeleteSel(); } },
  { id: 'moveUp', group: '주제', label: '위로 옮기기 (형제 순서)', keys: ['Alt+ArrowUp'], edit: true, when: _mmkNotRoot, run: _mmkSingle(function () { _mmkMoveSibling(-1); }) },
  { id: 'moveDown', group: '주제', label: '아래로 옮기기 (형제 순서)', keys: ['Alt+ArrowDown'], edit: true, when: _mmkNotRoot, run: _mmkSingle(function () { _mmkMoveSibling(1); }) },
  { id: 'indent', group: '주제', label: '들여쓰기 (앞 주제의 하위로)', keys: ['Ctrl+]'], edit: true, when: _mmkNotRoot, run: _mmkSingle(_mmkIndent) },
  { id: 'outdent', group: '주제', label: '내어쓰기 (한 단계 위로)', keys: ['Ctrl+['], edit: true, when: _mmkNotRoot, run: _mmkSingle(_mmkOutdent) },
  { id: 'addFloating', group: '주제', label: '떠있는 주제 추가 (빈 곳 더블클릭도)', keys: ['Alt+Shift+F'], edit: true, run: function () { mmAddFloating(); } },
  { id: 'toggleFloat', group: '주제', label: '떠 있게 하기 / 중심에 붙이기', keys: [], edit: true, when: _mmkNotRoot, run: _mmkSingle(function () { mmToggleFloat(); }) },
  { id: 'splitChildren', group: '주제', label: '줄을 하위 주제로 나누기 (첫 줄은 주제 이름)', keys: [], edit: true, when: function () { return _mmkLines() >= 2; }, run: _mmkSingle(_mmkSplitToChildren) },
  { id: 'splitSiblings', group: '주제', label: '줄마다 같은 단계 주제로 나누기', keys: [], edit: true, when: function () { return _mmkNotRoot() && _mmkLines() >= 2; }, run: _mmkSingle(_mmkSplitToSiblings) },
  { id: 'mergeChildren', group: '주제', label: '하위 주제를 줄로 합치기', keys: [], edit: true, when: _mmkHasKids, run: _mmkSingle(_mmkMergeChildren) },
  { id: 'undo', group: '주제', label: '되돌리기', keys: ['Ctrl+Z'], edit: true, run: function () { mmUndo(); } },
  { id: 'redo', group: '주제', label: '다시 실행', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], edit: true, run: function () { mmRedo(); } },
  // 선택 · 이동
  { id: 'navLeft', group: '선택 · 이동', label: '왼쪽 주제로', keys: ['ArrowLeft'], hidden: true, run: _mmkSingle(function () { _mmNav('left'); }) },
  { id: 'navRight', group: '선택 · 이동', label: '오른쪽 주제로', keys: ['ArrowRight'], hidden: true, run: _mmkSingle(function () { _mmNav('right'); }) },
  { id: 'navUp', group: '선택 · 이동', label: '위 주제로', keys: ['ArrowUp'], hidden: true, run: _mmkSingle(function () { _mmNav('up'); }) },
  { id: 'navDown', group: '선택 · 이동', label: '아래 주제로', keys: ['ArrowDown'], hidden: true, run: _mmkSingle(function () { _mmNav('down'); }) },
  { id: 'home', group: '선택 · 이동', label: '중심 주제로', keys: ['Home'], run: _mmkSingle(function () { _mmSelect(_mmRoot().id); }) },
  { id: 'selectAll', group: '선택 · 이동', label: '보이는 주제 모두 선택', keys: ['Ctrl+A'], run: _mmkSelectAll },
  { id: 'escape', group: '선택 · 이동', label: '선택 해제 · 관계 잇기 취소 · 집중 모드 끄기', keys: ['Escape'], hidden: true, run: _mmkEscape },
  { id: 'fold', group: '선택 · 이동', label: '접기 / 펴기', keys: ['Space'], when: _mmkHasKids, run: function () { if (_mm.multi.length) { var n = _mmkNodes(); _mmkFold(!n.every(function (x) { return x.collapsed; })); } else mmToggleFold(); } },
  { id: 'foldDeep', group: '선택 · 이동', label: '하위 모두 접기 / 펴기', keys: ['Shift+Space'], when: _mmkHasKids, run: _mmkSingle(_mmkFoldDeep) },
  { id: 'foldLevel1', group: '선택 · 이동', label: '1단계만 보기', keys: [], run: function () { _mmFoldAll(1); } },
  { id: 'unfoldAll', group: '선택 · 이동', label: '모두 펴기', keys: [], run: function () { _mmFoldAll(null); } },
  // 꾸미기
  { id: 'copyStyle', group: '꾸미기', label: '서식 복사 (색 · 굵게 · 글자 크기)', keys: ['Alt+Shift+C'], run: _mmkSingle(_mmkCopyStyle) },
  { id: 'pasteStyle', group: '꾸미기', label: '서식 붙여넣기 (여러 주제 가능)', keys: ['Alt+Shift+V'], edit: true, run: _mmkPasteStyle },
  { id: 'bold', group: '꾸미기', label: '굵게 켜기 / 끄기', keys: ['Ctrl+B'], edit: true, run: _mmkBold },
  { id: 'fontUp', group: '꾸미기', label: '글자 크게', keys: ['Alt+Shift+.'], edit: true, run: function () { _mmkFontSize(1); } },
  { id: 'fontDown', group: '꾸미기', label: '글자 작게', keys: ['Alt+Shift+,'], edit: true, run: function () { _mmkFontSize(-1); } },
  { id: 'colorCycle', group: '꾸미기', label: '색 바꾸기 (차례로)', keys: ['Alt+C'], edit: true, run: _mmkColorCycle },
  { id: 'done', group: '꾸미기', label: '완료 표시 켜기 / 끄기', keys: ['Alt+K'], edit: true, run: _mmkDone },
  { id: 'progress', group: '꾸미기', label: '진척 바꾸기 (0 → 25 → … → 100%)', keys: ['Alt+P'], edit: true, run: _mmkProgress },
  { id: 'priorityClear', group: '꾸미기', label: '우선순위 지우기', keys: ['Alt+0'], edit: true, run: function () { _mmkPriority(null); } },
  { id: 'note', group: '꾸미기', label: '노트 쓰기', keys: ['Alt+M'], edit: true, run: function () { _mmkFocusPanel('mmPnNote'); } },
  { id: 'labels', group: '꾸미기', label: '라벨 쓰기', keys: ['Alt+T'], edit: true, run: function () { _mmkFocusPanel('mmPnLabels'); } },
  { id: 'dueDate', group: '꾸미기', label: '마감일 넣기', keys: [], edit: true, run: function () { _mmkFocusPanel('mmPnDue'); } },
  { id: 'assignee', group: '꾸미기', label: '담당자 넣기', keys: [], edit: true, run: function () { _mmkFocusPanel('mmPnAssignee'); } },
  { id: 'addImage', group: '꾸미기', label: '이미지 줄 넣기 (캡처는 Ctrl+V · 파일은 끌어다 놓기)', keys: ['Alt+I'], edit: true, run: _mmkSingle(function () { if (typeof mmPickImage === 'function') mmPickImage(); }) },
  { id: 'addLine', group: '꾸미기', label: '글 줄 넣기 (주제 안 둘째 줄부터)', keys: [], edit: true, run: _mmkSingle(function () { if (typeof mmAddTextLine === 'function') mmAddTextLine(); }) },
  // 구조
  { id: 'relation', group: '구조', label: '관계선 잇기', keys: ['Alt+R'], edit: true, run: _mmkSingle(function () { mmStartRelation(); }) },
  { id: 'boundary', group: '구조', label: '경계 켜기 / 끄기', keys: ['Alt+B'], edit: true, run: _mmkToggleBoundary },
  { id: 'summary', group: '구조', label: '요약 켜기 / 끄기', keys: ['Alt+S'], edit: true, when: _mmkHasKids, run: _mmkSingle(_mmkToggleSummary) },
  { id: 'numbering', group: '구조', label: '하위 번호 켜기 / 끄기', keys: ['Alt+N'], edit: true, when: _mmkHasKids, run: _mmkToggleNumbering },
  { id: 'alignLevels', group: '구조', label: '같은 단계 맞춤 켜기 / 끄기 (선택 가지 · 중심 주제면 맵 전체)', keys: ['Alt+G'], edit: true, when: _mmkHasKids, run: _mmkAlign },
  { id: 'alignAll', group: '구조', label: '맵 전체 같은 단계 맞춤', keys: [], edit: true, run: _mmkAlignAll },
  { id: 'textAlign:auto', group: '구조', label: '글자 정렬 — 자동 (오른쪽 가지 왼쪽 · 왼쪽 가지 오른쪽)', keys: [], edit: true, run: function () { _mmkTextAlign('auto'); } },
  { id: 'textAlign:left', group: '구조', label: '글자 정렬 — 왼쪽', keys: [], edit: true, run: function () { _mmkTextAlign('left'); } },
  { id: 'textAlign:center', group: '구조', label: '글자 정렬 — 가운데', keys: [], edit: true, run: function () { _mmkTextAlign('center'); } },
  { id: 'textAlign:right', group: '구조', label: '글자 정렬 — 오른쪽', keys: [], edit: true, run: function () { _mmkTextAlign('right'); } },
  { id: 'structure', group: '구조', label: '맵 구조 바꾸기 (마인드맵 → 논리도 → 조직도)', keys: ['Ctrl+Shift+L'], edit: true, run: _mmkStructure },
  // 앱 데이터
  { id: 'linkRef', group: '앱 데이터', label: '앱 데이터 연결 (프로젝트·이슈·팀원…)', keys: ['Alt+L'], edit: true, when: _mmkFree, run: _mmkSingle(function () { if (typeof mmLinkModal === 'function') mmLinkModal(); }) },
  { id: 'openRef', group: '앱 데이터', label: '연결된 항목 열기', keys: ['Alt+Enter'], when: function () { var f = _mmSelInfo(); return !!(f && f.node.ref); }, run: _mmkSingle(function () { var f = _mmSelInfo(); if (f && f.node.ref && typeof mmOpenRef === 'function') mmOpenRef(f.node.ref); }) },
  { id: 'promoteMs', group: '앱 데이터', label: '마일스톤으로 만들기', keys: [], edit: true, when: _mmkFree, run: _mmkSingle(function () { if (typeof mmPromoteModal === 'function') mmPromoteModal('milestone'); }) },
  { id: 'promoteIssue', group: '앱 데이터', label: '이슈로 만들기', keys: [], edit: true, when: _mmkFree, run: _mmkSingle(function () { if (typeof mmPromoteModal === 'function') mmPromoteModal('issue'); }) },
  { id: 'riskCheck', group: '앱 데이터', label: '🩺 리스크 점검 (지연 · 담당 없음 · 몰림 · 선후 역전 · 진척 정체)', keys: [], run: function () { if (typeof mmRiskModal === 'function') mmRiskModal(); } },
  { id: 'weeklyReport', group: '앱 데이터', label: '주간 업무 보고 문장 만들기 (지난주 기록과 비교)', keys: [], run: function () { if (typeof mmWeeklyReportModal === 'function') mmWeeklyReportModal(); } },
  { id: 'refsRefresh', group: '앱 데이터', label: '연결 항목 상태 새로고침', keys: [], run: function () { _mm.refs = {}; _mmResolveRefs(); } },
  { id: 'resync', group: '앱 데이터', label: '원본과 맞추기 (자동 생성 맵)', keys: [], edit: true, when: function () { return !!(_mm.doc.meta && _mm.doc.meta.gen); }, run: function () { if (typeof mmResync === 'function') mmResync(); } },
  // AI
  { id: 'aiExpand', group: 'AI', label: '✨ 하위 주제 제안', keys: ['Alt+A'], edit: true, when: function () { return !!_mm.aiReady; }, run: _mmkSingle(function () { if (typeof mmAiExpand === 'function') mmAiExpand(); }) },
  { id: 'aiSummary', group: 'AI', label: '✨ 가지 요약', keys: [], edit: true, when: function () { return !!_mm.aiReady && _mmkHasKids(); }, run: _mmkSingle(function () { if (typeof mmAiSummary === 'function') mmAiSummary(); }) },
  { id: 'aiText', group: 'AI', label: '✨ 글로 가지 만들기', keys: [], edit: true, when: function () { return !!_mm.aiReady; }, run: _mmkSingle(function () { if (typeof mmAiTextModal === 'function') mmAiTextModal(); }) },
  { id: 'aiWbs', group: 'AI', label: '✨ WBS 초안', keys: [], edit: true, when: function () { return !!_mm.aiReady; }, run: _mmkSingle(function () { if (typeof mmAiWbsModal === 'function') mmAiWbsModal(); }) },
  // 보기
  { id: 'zoomIn', group: '보기', label: '확대', keys: ['Ctrl+=', 'Ctrl+Shift+='], run: function () { _mmZoomAt(1.1); } },
  { id: 'zoomOut', group: '보기', label: '축소', keys: ['Ctrl+-'], run: function () { _mmZoomAt(1 / 1.1); } },
  { id: 'fit', group: '보기', label: '화면 맞춤', keys: ['Ctrl+0'], run: function () { _mmFit(); } },
  { id: 'search', group: '보기', label: '맵에서 찾기', keys: ['Ctrl+F'], run: function () { var s = _mmEl('mmSearch'); if (s) { s.focus(); s.select(); } } },
  { id: 'pitch', group: '보기', label: '발표 모드 (개요 → 주요 주제 한 장씩)', keys: ['Alt+Shift+P'], run: function () { if (typeof mmPitchStart === 'function') mmPitchStart(); } },
  { id: 'zen', group: '보기', label: '집중 모드', keys: ['Ctrl+Shift+F'], run: function () { _mmSetZen(!_mm.zen); } },
  { id: 'outline', group: '보기', label: '맵 ↔ 아웃라인 보기', keys: ['Alt+O'], run: function () { _mmSetOutline(!_mm.outline); } },
  { id: 'gantt', group: '보기', label: '간트 보기 (일정 막대)', keys: ['Alt+J'], run: function () { _mmSetView(_mm.gantt ? 'map' : 'gantt'); } },
  { id: 'history', group: '보기', label: '버전 기록', keys: ['Ctrl+Shift+H'], run: function () { mmHistToggle(); } },
  { id: 'sheetPrev', group: '보기', label: '이전 시트', keys: ['Alt+PageUp'], run: function () { _mmkSheetStep(-1); } },
  { id: 'sheetNext', group: '보기', label: '다음 시트', keys: ['Alt+PageDown'], run: function () { _mmkSheetStep(1); } },
  { id: 'addSheet', group: '보기', label: '새 시트', keys: [], edit: true, run: function () { mmAddSheet(); } },
  // 맵
  { id: 'save', group: '맵', label: '바로 저장 (평소엔 자동 저장)', keys: ['Ctrl+S'], run: function () { _mmSaveNow(); } },
  { id: 'exportPng', group: '맵', label: 'PNG 이미지로 내보내기', keys: [], run: function () { mmExportPng(); } },
  { id: 'exportMd', group: '맵', label: 'Markdown 으로 내보내기', keys: [], run: function () { mmExportMarkdown(); } },
  { id: 'exportOpml', group: '맵', label: 'OPML 로 내보내기', keys: [], run: function () { if (typeof mmExportOpml === 'function') mmExportOpml(); } },
  { id: 'share', group: '맵', label: '공유 설정', keys: [], when: function () { return !!(_mm.row && (_mm.row.is_owner || _mmIsAdmin())); }, run: function () { mmShareModal(); } },
  { id: 'palette', group: '맵', label: '명령 찾기', keys: ['Ctrl+/'], run: function () { mmPalette(); } },
  { id: 'help', group: '맵', label: '단축키 보기', keys: ['F1'], run: function () { mmHelpModal(); } }
];
// 우선순위 1~9 · 색 · 마커 (명령 찾기·패널에서도 쓰도록 표에 넣음)
[1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (i) {
  MM_COMMANDS.push({ id: 'priority:' + i, group: '꾸미기', label: '우선순위 ' + i, keys: ['Alt+' + i], edit: true, hidden: i > 1, run: function () { _mmkPriority(String(i)); } });
});
MM_COLORS.forEach(function (c) {
  MM_COMMANDS.push({ id: 'color:' + (c.key || 'auto'), group: '꾸미기', label: '색 — ' + (c.key ? { blue: '파랑', green: '초록', amber: '주황', rose: '빨강', purple: '보라', cyan: '청록', slate: '회색' }[c.key] || c.key : '자동'), keys: [], edit: true, run: function () { _mmkColor(c.key); } });
});
MM_SYMBOLS.forEach(function (sy) {
  MM_COMMANDS.push({ id: 'symbol:' + sy.k, group: '꾸미기', label: '마커 ' + sy.g + ' ' + sy.l, keys: [], edit: true, run: function () { _mmkSymbol(sy.k); } });
});

var _mmKeyMap = null;
function _mmCommandByKey(name) {
  if (!_mmKeyMap) {
    _mmKeyMap = {};
    MM_COMMANDS.forEach(function (c) { (c.keys || []).forEach(function (k) { _mmKeyMap[k] = c; }); });
  }
  return _mmKeyMap[name] || null;
}
function _mmCommand(id) {
  for (var i = 0; i < MM_COMMANDS.length; i++) if (MM_COMMANDS[i].id === id) return MM_COMMANDS[i];
  return null;
}
function _mmCommandOk(c) {
  if (!c) return false;
  if (c.edit && _mm.readOnly) return false;
  if (c.when && !c.when()) return false;
  return true;
}

/** 캔버스 keydown → 단축키면 실행하고 true (기본 동작 막음). 복사·붙여넣기는 copy/paste 이벤트로 넘김 */
function mmHandleKey(e) {
  var name = mmKeyName(e);
  if (name === 'Ctrl+C' || name === 'Ctrl+X' || name === 'Ctrl+V') return false;
  var c = _mmCommandByKey(name);
  if (!c) return false;
  if (c.edit && _mm.readOnly) return true;   // 보기 전용: 키는 먹되 아무것도 안 함 (Tab 이 포커스를 빼앗지 않게)
  if (c.when && !c.when()) return true;
  var r = c.run();
  return r !== false;
}

function mmRunCommand(id) {
  var c = _mmCommand(id);
  if (!_mmCommandOk(c)) return;
  c.run();
}

/* ═══ 오른쪽 클릭 메뉴 ═══ */
var MM_CTX_NODE = ['addChild', 'addSibling', 'addBefore', 'addParent', 'edit', 'duplicate', 'delete', '|',
  'moveUp', 'moveDown', 'indent', 'outdent', 'splitSiblings', 'splitChildren', 'mergeChildren', 'toggleFloat', '|', 'relation', 'boundary', 'summary', 'numbering', 'alignLevels', '|',
  'linkRef', 'openRef', 'promoteMs', 'promoteIssue', '|', 'addImage', 'addLine', 'done', 'colorCycle', 'copyStyle', 'pasteStyle', 'progress', 'note', 'fold', 'foldDeep', '|', 'aiExpand', 'aiSummary'];
var MM_CTX_MULTI = ['delete', 'duplicate', '|', 'done', 'colorCycle', 'pasteStyle', 'bold', 'progress', 'boundary', 'alignLevels', 'fold', '|', 'priority:1', 'priorityClear'];
var MM_CTX_CANVAS = ['addFloating', 'fit', 'unfoldAll', 'foldLevel1', 'selectAll', '|', 'alignAll', 'textAlign:auto', 'textAlign:left', 'textAlign:right', '|', 'addSheet', 'outline', 'zen', 'structure', '|', 'palette', 'help'];

function _mmCloseCtx() {
  var m = document.getElementById('mmCtxMenu');
  if (m) m.remove();
  document.removeEventListener('mousedown', _mmCtxOutside, true);
  document.removeEventListener('keydown', _mmCtxKey, true);
}
function _mmCtxOutside(e) { var m = document.getElementById('mmCtxMenu'); if (m && !m.contains(e.target)) _mmCloseCtx(); }
function _mmCtxKey(e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); _mmCloseCtx(); _mmFocusCanvas(); } }

function mmContextMenu(x, y, kind) {
  _mmCloseCtx();
  var ids = kind === 'canvas' ? MM_CTX_CANVAS : (_mm.multi.length > 1 ? MM_CTX_MULTI : MM_CTX_NODE);
  var rows = [];
  ids.forEach(function (id) {
    if (id === '|') { if (rows.length && rows[rows.length - 1] !== '|') rows.push('|'); return; }
    var c = _mmCommand(id);
    if (_mmCommandOk(c)) rows.push(c);
  });
  while (rows[rows.length - 1] === '|') rows.pop();
  if (!rows.length) return;
  var m = document.createElement('div');
  m.id = 'mmCtxMenu';
  m.className = 'mm-ctx';
  m.innerHTML = (_mm.multi.length > 1 && kind !== 'canvas' ? '<div class="mm-ctx-head">' + _mm.multi.length + '개 선택</div>' : '') +
    rows.map(function (c) {
      if (c === '|') return '<div class="mm-ctx-sep"></div>';
      return '<button data-cmd="' + c.id + '"><span>' + _mmEsc(c.label) + '</span>' + (c.keys && c.keys[0] ? '<kbd>' + _mmEsc(mmKeyLabel(c.keys[0])) + '</kbd>' : '') + '</button>';
    }).join('');
  document.body.appendChild(m);
  // 화면 밖으로 나가지 않게
  var r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
  m.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cmd]');
    if (!b) return;
    var id = b.getAttribute('data-cmd');
    _mmCloseCtx();
    _mmFocusCanvas();
    mmRunCommand(id);
  });
  setTimeout(function () {
    document.addEventListener('mousedown', _mmCtxOutside, true);
    document.addEventListener('keydown', _mmCtxKey, true);
  }, 0);
}

/* ═══ 여러 주제 선택 — 속성 패널 ═══ */
function mmMultiPanelHtml() {
  var ro = _mm.readOnly ? ' disabled' : '';
  var btn = function (id, html, title) { return '<button class="mm-mkbtn" data-act="cmd" data-cmd="' + id + '"' + ro + (title ? ' title="' + title + '"' : '') + '>' + html + '</button>'; };
  return '<div class="mm-pn-sec"><div class="mm-pn-h">' + _mm.multi.length + '개 선택</div>' +
    '<div class="mm-hint">Ctrl+클릭으로 더하거나 빼고, Esc 로 해제합니다. 아래 동작은 선택한 주제 모두에 적용됩니다.</div></div>' +
    '<div class="mm-pn-sec"><div class="mm-pn-h">색상</div><div class="mm-swatches">' + MM_COLORS.map(function (c) {
      return '<button class="mm-sw" data-act="cmd" data-cmd="color:' + (c.key || 'auto') + '"' + ro + ' style="' + (c.c ? 'background:' + c.c : '') + '">' + (c.c ? '' : 'A') + '</button>';
    }).join('') + '</div></div>' +
    '<div class="mm-pn-sec"><div class="mm-pn-h">우선순위</div><div class="mm-swatches">' + btn('priorityClear', '—') +
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) { return btn('priority:' + i, '<span class="mm-pri mm-pri' + i + '">' + i + '</span>'); }).join('') + '</div></div>' +
    '<div class="mm-pn-sec"><div class="mm-pn-h">마커</div>' + _mmSymbolGroupsHtml(function (s) { return btn('symbol:' + s.k, s.g, s.l); }) + '</div>' +
    '<div class="mm-pn-sec"><div class="mm-pn-h">한 번에</div><div class="mm-swatches">' +
    btn('done', '✓ 완료', 'Alt+K') + btn('progress', '◔ 진척', 'Alt+P') + btn('boundary', '▭ 경계', 'Alt+B') + btn('fold', '접기', 'Space') +
    btn('duplicate', '복제', 'Ctrl+D') + btn('delete', '🗑 삭제', 'Delete') + '</div></div>';
}

/* ═══ 명령 찾기 (Ctrl+/) ═══ */
function mmPalette() {
  return wmGuardedModal('mmPalette', function () {
    var html = '<input id="mmPalQ" class="mm-input mm-pal-q" placeholder="무엇을 할까요? (예: 경계, 마일스톤, 내보내기)" autocomplete="off">' +
      '<div class="mm-pal-list" id="mmPalList"></div>';
    var md = createModal({ id: 'mmPaletteModal', titleText: '⌘ 명령 찾기', html: html, width: '520px', closeOnEsc: true, closeOnOverlay: true,
      boxStyle: 'align-self:flex-start;margin-top:12vh', onClose: function () { setTimeout(_mmFocusCanvas, 0); } });
    var q = _mmEl('mmPalQ'), list = _mmEl('mmPalList');
    var items = [], cur = 0;
    function paint() {
      var s = q.value.trim().toLowerCase();
      items = MM_COMMANDS.filter(function (c) {
        if (!_mmCommandOk(c) || c.id === 'palette') return false;
        if (c.hidden && !s) return false;
        if (!s) return true;
        return (c.label + ' ' + c.group + ' ' + (c.keys || []).join(' ')).toLowerCase().indexOf(s) >= 0;
      });
      cur = Math.min(cur, Math.max(0, items.length - 1));
      list.innerHTML = items.length ? items.map(function (c, i) {
        return '<button class="mm-pal-row' + (i === cur ? ' on' : '') + '" data-i="' + i + '"><span class="mm-pal-g">' + _mmEsc(c.group) + '</span><span class="mm-pal-l">' + _mmEsc(c.label) + '</span>' +
          (c.keys && c.keys[0] ? '<kbd>' + _mmEsc(mmKeyLabel(c.keys[0])) + '</kbd>' : '') + '</button>';
      }).join('') : '<div class="mm-empty">찾는 명령이 없습니다</div>';
      var on = list.querySelector('.mm-pal-row.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }
    function run(i) {
      var c = items[i];
      if (!c) return;
      md.close();
      setTimeout(function () { _mmFocusCanvas(); mmRunCommand(c.id); }, 0);
    }
    q.oninput = function () { cur = 0; paint(); };
    q.onkeydown = function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(items.length - 1, cur + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, cur - 1); paint(); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(cur); }
    };
    list.onclick = function (e) { var b = e.target.closest('[data-i]'); if (b) run(parseInt(b.getAttribute('data-i'), 10)); };
    paint();
  }, 'mmPaletteModal', { onOpen: function () { var q = _mmEl('mmPalQ'); if (q) q.focus(); } });
}

/* ═══ 단축키 도움말 (F1) — 표에서 자동 생성 ═══ */
function mmHelpModal() {
  return wmGuardedModal('mmHelp', function () {
    var groups = [];
    var by = {};
    MM_COMMANDS.forEach(function (c) {
      if (!(c.keys || []).length || c.hidden || /^(priority|color|symbol):/.test(c.id)) return;
      if (!by[c.group]) { by[c.group] = []; groups.push(c.group); }
      by[c.group].push(c);
    });
    var extra = {
      '주제': [['바로 타이핑 · 더블클릭', '주제 글 바꿔 쓰기 (편집 중 Shift+Enter 줄바꿈 · Tab 확정 후 하위 추가)'], ['Ctrl+C / X / V', '가지 복사 · 잘라내기 · 붙여넣기 (Markdown 목록도 붙여넣기)']],
      '선택 · 이동': [['↑ ↓ ← →', '화면에서 가까운 주제로'], ['Ctrl+클릭 · Shift+끌기', '여러 주제 선택'], ['Esc', '선택 해제 · 관계 잇기 취소 · 집중 모드 끄기']],
      '꾸미기': [['Alt+1 ~ 9', '우선순위']],
      '보기': [['Ctrl+휠 · 휠 · 빈 곳 끌기', '확대·축소 · 화면 이동']]
    };
    var mouse = [['주제 끌어 놓기', '다른 주제의 하위(가운데) · 앞/뒤(위/아래 가장자리) · 빈 곳(좌우 바꾸기)'], ['오른쪽 클릭', '주제 · 빈 곳 메뉴'], ['연결 아이콘 클릭', '연결된 항목 열기']];
    var html = '<div class="mm-help-grid">' + groups.map(function (g) {
      var rows = by[g].map(function (c) { return [c.keys.map(mmKeyLabel).join(' · '), c.label]; }).concat(extra[g] || []);
      return '<div class="mm-help-sec"><div class="mm-pn-h">' + _mmEsc(g) + '</div><table class="mm-help">' +
        rows.map(function (r) { return '<tr><td><kbd>' + _mmEsc(r[0]) + '</kbd></td><td>' + _mmEsc(r[1]) + '</td></tr>'; }).join('') + '</table></div>';
    }).join('') +
      '<div class="mm-help-sec"><div class="mm-pn-h">마우스</div><table class="mm-help">' +
      mouse.map(function (r) { return '<tr><td><kbd>' + _mmEsc(r[0]) + '</kbd></td><td>' + _mmEsc(r[1]) + '</td></tr>'; }).join('') + '</table></div></div>' +
      '<div class="mm-hint" style="margin-top:10px">Ctrl+/ 로 모든 명령을 이름으로 찾아 실행할 수 있습니다. Mac 은 Ctrl 대신 ⌘.</div>';
    createModal({ id: 'mmHelpModal', title: '⌨️ 마인드맵 단축키', html: html, width: '860px', closeOnEsc: true, closeOnOverlay: true, onClose: function () { setTimeout(_mmFocusCanvas, 0); } });
  }, 'mmHelpModal');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mmKeyName: mmKeyName, mmKeyLabel: mmKeyLabel, MM_COMMANDS: MM_COMMANDS };
}
