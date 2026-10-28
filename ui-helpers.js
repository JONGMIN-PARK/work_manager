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

/**
 * 터치 → 마우스 끌기 (v13.257). 마우스 전용으로 짠 끌기 코드를 손가락으로도 쓰게 한다.
 * 한 손가락으로 끌면 처음 누른 자리에 mousedown, 움직일 때 mousemove, 뗄 때 mouseup 을 보낸다.
 * 끌지 않고 톡 누르면 아무것도 안 함 — 브라우저가 보내는 원래 클릭이 그대로 간다.
 *   opt.hold    — ms. 이만큼 누르고 있어야 끌기 시작 (그 전에 움직이면 화면 스크롤). 스크롤 상자 안 막대용
 *   opt.onPinch — function(배율, 중심x, 중심y, 중심 이동x, 이동y). 두 손가락 확대·이동
 * 요소에 CSS touch-action:none 이 있어야 iOS 가 화면을 같이 밀지 않는다 (hold 쓰는 곳은 제외).
 */
function wmTouchDrag(el, opt) {
  if (!el || el._wmTouch || !('ontouchstart' in window)) return;
  el._wmTouch = true;
  opt = opt || {};
  var st = null, pin = null;
  function fire(type, target, x, y) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 }));
  }
  function two(e) {
    var a = e.touches[0], b = e.touches[1];
    return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
  }
  el.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2 && opt.onPinch) {
      if (st && st.started) fire('mouseup', st.target, st.lx, st.ly);
      st = null;
      pin = two(e);
      return;
    }
    if (e.touches.length !== 1) { st = null; return; }
    var t = e.touches[0];
    st = { x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY, target: e.target, started: false, ready: !opt.hold };
    if (opt.hold) {
      var me = st;
      me.timer = setTimeout(function () { if (st === me) { me.ready = true; if (navigator.vibrate) navigator.vibrate(10); } }, opt.hold);
    }
  }, { passive: true });
  el.addEventListener('touchmove', function (e) {
    if (pin && e.touches.length === 2) {
      e.preventDefault();
      var p = two(e);
      opt.onPinch(p.d / pin.d, p.cx, p.cy, p.cx - pin.cx, p.cy - pin.cy);
      pin = p;
      return;
    }
    if (!st || e.touches.length !== 1) return;
    var t = e.touches[0];
    if (!st.ready) { clearTimeout(st.timer); st = null; return; }   // 길게 누르기 전에 움직임 → 스크롤
    e.preventDefault();
    if (!st.started) {
      if (Math.abs(t.clientX - st.x) + Math.abs(t.clientY - st.y) < 6) return;
      st.started = true;
      fire('mousedown', st.target, st.x, st.y);
    }
    st.lx = t.clientX; st.ly = t.clientY;
    fire('mousemove', st.target, t.clientX, t.clientY);
  }, { passive: false });
  function end(e) {
    if (pin) { if (e.touches.length < 2) pin = null; return; }
    if (!st) return;
    clearTimeout(st.timer);
    if (st.started) { e.preventDefault(); fire('mouseup', st.target, st.lx, st.ly); }
    st = null;
  }
  el.addEventListener('touchend', end, { passive: false });
  el.addEventListener('touchcancel', end, { passive: false });
}
