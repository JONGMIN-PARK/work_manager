/* wm-shell.js — 📱 휴대폰 틀 고정 (v13.469)
 *   예전: 문서 한 장이 통째로 굴러감(머리 줄 · 탭도 같이) → 아이폰에서 굴린 뒤 · 키보드 뒤 · 끝에서 튕긴 뒤 틀 전체가 위로 올라가 있음.
 *   지금: 휴대폰(폭 768px 이하 터치)에서는 문서가 아예 안 굴러감 —
 *     body = 화면 높이에 고정(position:fixed · 높이 --wm-vh) · 세로로 [머리 줄][탭 줄들][화면]
 *     화면(#mXxx) 하나하나가 남은 높이를 채우고 '그 안에서만' 굴림 (style.css html.wm-shell)
 *   문서 굴림을 쓰던 코드(window.scrollY · scrollTo · 'scroll' 이벤트)는 그대로 돌게 지금 보이는 화면으로 넘겨 줌.
 *   키보드: 보이는 높이(visualViewport)에 맞춰 틀 높이만 줄이고, iOS 가 문서를 밀어 올렸으면 바로 되돌림.
 *   머리(head)에서 바로 읽힘 — 첫 그림 전에 html.wm-shell 을 붙여 깜빡임 없이. 대화 전용 창 · 프로젝트 창(PC)은 해당 없음. */
(function () {
  var docEl = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(max-width:768px) and (pointer:coarse)') : null;
  var realScrollTo = window.scrollTo.bind(window), realScrollBy = window.scrollBy.bind(window);
  var dY = Object.getOwnPropertyDescriptor(window, 'scrollY') || Object.getOwnPropertyDescriptor(Window.prototype, 'scrollY');
  function realY() { try { return dY && dY.get ? dY.get.call(window) : 0; } catch (e) { return 0; } }
  function on() { return docEl.classList.contains('wm-shell'); }
  /** 지금 보이는 화면(굴리는 칸) — 없으면 null */
  function scroller() {
    var c = document.querySelector('.con'); if (!c) return null;
    for (var i = 0; i < c.children.length; i++) {
      var e = c.children[i];
      if (e.id && /^m[A-Z]/.test(e.id) && !e.classList.contains('hidden') && e.offsetParent !== null) return e;
    }
    return null;
  }
  window.wmShellOn = on; window.wmShellScroller = scroller; window.wmRealScrollTo = realScrollTo;

  function apply() {
    var want = !!(mq && mq.matches) && !window.WM_SOLO && !window.WM_PDWIN;
    if (want !== on()) docEl.classList.toggle('wm-shell', want);
    if (want) fit(); else docEl.style.removeProperty('--wm-vh');
  }
  /* 틀 높이 = 지금 보이는 높이(키보드가 올라오면 그만큼 줄어듦) · iOS 가 문서를 밀어 올렸으면 되돌림 */
  function fit() {
    if (!on()) return;
    var vv = window.visualViewport, h = vv ? vv.height : window.innerHeight;
    if (h > 100) docEl.style.setProperty('--wm-vh', Math.round(h) + 'px');
    if (realY() > 0 || (vv && vv.offsetTop > 0)) realScrollTo(0, 0);
  }

  // 문서 굴림을 쓰던 코드 → 지금 보이는 화면으로
  window.scrollTo = window.scroll = function (x, y) {
    if (!on()) return realScrollTo.apply(window, arguments);
    var s = scroller(); if (!s) return;
    if (x && typeof x === 'object') s.scrollTo(x); else s.scrollTo(+x || 0, +y || 0);
  };
  window.scrollBy = function (x, y) {
    if (!on()) return realScrollBy.apply(window, arguments);
    var s = scroller(); if (!s) return;
    if (x && typeof x === 'object') s.scrollBy(x); else s.scrollBy(+x || 0, +y || 0);
  };
  ['scrollY', 'pageYOffset'].forEach(function (k) {
    try { Object.defineProperty(window, k, { configurable: true, get: function () { if (!on()) return realY(); var s = scroller(); return s ? s.scrollTop : 0; } }); } catch (e) {}
  });
  // 화면이 굴러가면 예전처럼 window 'scroll' 도 알림 (굴린 자리 기억 등)
  document.addEventListener('scroll', function (e) {
    var t = e.target;
    if (on() && t && t.nodeType === 1 && t.parentElement && t.parentElement.classList.contains('con')) { try { window.dispatchEvent(new Event('scroll')); } catch (x) {} }
  }, true);

  if (mq) { if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply); }
  apply();
  var soon = function () { fit(); setTimeout(fit, 120); setTimeout(fit, 400); };
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', soon); window.visualViewport.addEventListener('scroll', fit); }
  window.addEventListener('resize', soon);
  window.addEventListener('orientationchange', soon);
  window.addEventListener('pageshow', soon);
  document.addEventListener('focusout', function () { setTimeout(fit, 100); setTimeout(fit, 450); });
  // 입력 칸을 누르면 — 키보드가 올라온 뒤(틀 높이가 줄어든 뒤) 그 칸이 보이게 화면 안에서만 굴림
  document.addEventListener('focusin', function (e) {
    var t = e.target; if (!on() || !t || !t.matches || !t.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]),textarea,select,[contenteditable="true"]')) return;
    setTimeout(function () {
      fit();
      var s = scroller(); if (!s || !s.contains(t) || document.activeElement !== t) return;
      var r = t.getBoundingClientRect(), b = s.getBoundingClientRect();
      if (r.bottom > b.bottom - 8 || r.top < b.top + 8) { try { t.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (x) {} fit(); }
    }, 350);
  });
})();
