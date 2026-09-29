/**
 * spec-patch.js — 사양서(projects.specs, v:2) 변경분 병합 (v13.196)
 *
 * 여러 사람이 같은 사양서를 동시에 고쳐도 서로의 입력을 지우지 않도록, 클라이언트는 "처음 불러온 값(from) → 바꾼 값(to)"
 * 목록만 보낸다. 서버는 현재 값이
 *   - from 과 같으면 적용 (그 사이 아무도 안 바꿈)
 *   - to 와 같으면 이미 같은 값 (적용할 것 없음)
 *   - 둘 다 아니면 충돌 — 다른 사람이 먼저 바꿨다. 현재 값을 유지하고 충돌로 돌려준다.
 *
 * 경로(path):
 *   []                                  문서 전체 (이전 형식 → v2 첫 변환)
 *   ['templateId'] | ['templateVersion']
 *   ['values', itemKey]                 일반 항목 값
 *   ['values', itemKey, rowId]          표 행 추가(from=null)·삭제(to=null)
 *   ['values', itemKey, rowId, colKey]  표 칸 — 같은 표의 다른 칸은 서로 독립적으로 병합된다
 *   ['remarks', itemKey] | ['status', itemKey]
 *   ['extra', discipline]               기타 사양(분야별 목록 통째)
 *   ['diagram']                         하드웨어 구성도 편집(위치·이름·화살표) 통째 (v13.200)
 */
var ROOTS = { templateId: 1, templateVersion: 1, values: 1, remarks: 1, status: 1, extra: 1, diagram: 1 };
var MAX_CHANGES = 2000;

function _isBlank(v) { return v === undefined || v === null || v === ''; }
function equal(a, b) {
  if (_isBlank(a) && _isBlank(b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return String(a) === String(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

function _rowIndex(arr, id) {
  for (var i = 0; i < arr.length; i++) if (arr[i] && String(arr[i].id) === String(id)) return i;
  return -1;
}

function getAt(doc, path) {
  if (!path.length) return doc;
  var root = doc[path[0]];
  if (path.length === 1) return root;
  if (root == null || typeof root !== 'object') return undefined;
  var v = root[path[1]];
  if (path.length === 2) return v;
  if (!Array.isArray(v)) return undefined;
  var i = _rowIndex(v, path[2]);
  if (i < 0) return undefined;
  if (path.length === 3) return v[i];
  return v[i][path[3]];
}

function setAt(doc, path, val) {
  if (path.length === 1) { if (_isBlank(val)) delete doc[path[0]]; else doc[path[0]] = val; return; }
  if (doc[path[0]] == null || typeof doc[path[0]] !== 'object' || Array.isArray(doc[path[0]])) doc[path[0]] = {};
  var root = doc[path[0]];
  if (path.length === 2) {
    if (_isBlank(val) && path[0] !== 'extra') delete root[path[1]]; else root[path[1]] = val;
    return;
  }
  if (!Array.isArray(root[path[1]])) root[path[1]] = [];
  var arr = root[path[1]], i = _rowIndex(arr, path[2]);
  if (path.length === 3) {                       // 행 추가·교체·삭제
    if (val == null) { if (i >= 0) arr.splice(i, 1); return; }
    var row = Object.assign({}, val, { id: path[2] });
    if (i >= 0) arr[i] = row; else arr.push(row);
    return;
  }
  if (i < 0) { arr.push({ id: path[2] }); i = arr.length - 1; }  // 다른 사람이 행을 지웠어도 내가 고친 칸은 살린다
  arr[i][path[3]] = _isBlank(val) ? '' : val;
}

/** 형식 검사 — 오류 메시지 또는 null */
function validate(changes) {
  if (!Array.isArray(changes)) return 'changes 는 배열이어야 합니다.';
  if (changes.length > MAX_CHANGES) return '한 번에 바꿀 수 있는 항목 수를 넘었습니다.';
  for (var i = 0; i < changes.length; i++) {
    var c = changes[i];
    if (!c || !Array.isArray(c.path) || c.path.length > 4) return '경로 오류';
    if (c.path.length === 0) { if (changes.length !== 1) return '전체 교체는 단독으로만 보낼 수 있습니다.'; continue; }
    if (!ROOTS[c.path[0]]) return '경로 오류: ' + c.path[0];
    for (var j = 0; j < c.path.length; j++) if (typeof c.path[j] !== 'string' || !c.path[j] || c.path[j].length > 80 || c.path[j] === '__proto__' || c.path[j] === 'constructor' || c.path[j] === 'prototype') return '경로 오류';
    if (c.path.length > 2 && c.path[0] !== 'values') return '경로 오류';
    if (c.path[0] === 'diagram' && c.path.length !== 1) return '경로 오류';   // 구성도는 통째로만
    if (c.path.length === 1 && c.path[0] !== 'templateId' && c.path[0] !== 'templateVersion' && c.path[0] !== 'diagram') return '경로 오류';
  }
  return null;
}

/**
 * @returns {{ doc, applied: Array, conflicts: Array, stale: boolean }}
 *   stale: 현재 문서가 v2 가 아닌데 부분 변경이 왔다 — 클라이언트가 새로 불러와야 한다.
 */
function applyChanges(current, changes) {
  var doc = JSON.parse(JSON.stringify(current || {}));
  var applied = [], conflicts = [];
  if (changes.length === 1 && changes[0].path.length === 0) {
    var c0 = changes[0];
    if (equal(doc, c0.from) || (doc.v !== 2 && !Object.keys(doc).length)) { doc = JSON.parse(JSON.stringify(c0.to || {})); applied.push(c0); }
    else conflicts.push({ path: [], label: c0.label || '사양서 전체', mine: null, theirs: null });
    return { doc: doc, applied: applied, conflicts: conflicts, stale: false };
  }
  if (doc.v !== 2) {
    if (Object.keys(doc).some(function (k) { return Array.isArray(doc[k]) && doc[k].length; })) return { doc: doc, applied: [], conflicts: [], stale: true };
    doc = { v: 2, templateId: null, templateVersion: null, values: {}, remarks: {}, extra: {} };
  }
  changes.forEach(function (c) {
    var cur = getAt(doc, c.path);
    if (equal(cur, c.from)) { setAt(doc, c.path, c.to); applied.push(c); }
    else if (equal(cur, c.to)) { /* 이미 같은 값 */ }
    else conflicts.push({ path: c.path, label: c.label || c.path.join('.'), mine: c.to === undefined ? null : c.to, theirs: cur === undefined ? null : cur });
  });
  return { doc: doc, applied: applied, conflicts: conflicts, stale: false };
}

module.exports = { applyChanges: applyChanges, validate: validate, getAt: getAt, setAt: setAt, equal: equal };
