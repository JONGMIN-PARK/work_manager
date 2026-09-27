/* ═══ ui-helpers.js — 작은 공용 UI 헬퍼 (동기 로드, project-data.js 다음) ═══ */

/**
 * 재렌더로 새로 그려진 입력창에 포커스·캐럿을 되돌린다.
 * 검색창 디바운스 렌더 뒤 입력이 끊기지 않게 하는 용도.
 *   id    — 입력창 id
 *   caret — 캐럿 위치 (생략하면 끝). 값 길이를 넘으면 끝으로 맞춤
 * 반환: 입력 요소 (없으면 null)
 */
function wmRestoreFocus(id, caret) {
  var el = document.getElementById(id);
  if (!el) return null;
  el.focus();
  var n = (el.value || '').length;
  var pos = caret == null ? n : Math.min(caret, n);
  try { el.setSelectionRange(pos, pos); } catch (e) { /* 캐럿을 지원하지 않는 input type */ }
  return el;
}
