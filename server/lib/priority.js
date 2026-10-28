/**
 * 중요도 4단계 (v13.253) — 1 긴급 · 2 높음 · 3 보통 · 4 낮음
 * 출처마다 원래 값이 달라 여기서 바꿔 읽고 쓴다. 내 업무에서 바꾸면 원래 자리 값이 바뀐다.
 *   issue.urgency · project_dev_items.priority · prestudies.priority  'urgent' · 'high' · 'normal' · 'low'
 *   meeting_action_items.priority  1~4 (비면 보통)
 *   마인드맵 주제  markers 의 'priority-N' (N 1~9, 없으면 보통 · 4 이상은 낮음)
 *   my_todos.priority  1~4
 *   마일스톤  중요도 없음 (보통, 바꿀 수 없음)
 */
var WORDS = ['urgent', 'high', 'normal', 'low'];
var LABEL = { 1: '긴급', 2: '높음', 3: '보통', 4: '낮음' };
var SRC = ['todo', 'issue', 'action', 'dev', 'prestudy', 'mindmap'];   // 바꿀 수 있는 출처

function clamp(p) { p = parseInt(p, 10); return p >= 1 && p <= 4 ? p : null; }
function fromWord(w) { var i = WORDS.indexOf(w); return i >= 0 ? i + 1 : 3; }
function toWord(p) { return WORDS[(clamp(p) || 3) - 1]; }
function fromInt(v) { return clamp(v) || 3; }
function fromMarkers(markers) {
  var p = null;
  (markers || []).some(function (m) { var x = /^priority-(\d)$/.exec(m); if (x) { p = +x[1]; return true; } return false; });
  return p == null ? 3 : Math.min(4, p);
}
/** 맵 주제 markers 에 중요도 쓰기 — 보통이면 표시를 뺌 */
function setMarkers(node, p) {
  var ms = (node.markers || []).filter(function (m) { return !/^priority-\d$/.test(m); });
  if (p !== 3) ms.unshift('priority-' + p);
  if (ms.length) node.markers = ms; else delete node.markers;
}

module.exports = { WORDS: WORDS, LABEL: LABEL, SRC: SRC, clamp: clamp, fromWord: fromWord, toWord: toWord, fromInt: fromInt, fromMarkers: fromMarkers, setMarkers: setMarkers };
