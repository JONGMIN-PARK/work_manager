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
  /* v13.480 🖥 PC 도 틀 고정(html.wm-shell-pc) — 머리 줄(대메뉴) · 하위 탭은 제자리, 그 아래 화면만 굴림. 휴대폰 전용 동작(키보드 · 탭 줄 접기)은 PC 에선 안 함 */
  function pcOn() { return docEl.classList.contains('wm-shell-pc'); }
  var printing = false;
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
  /* 아이폰 설치형 맨 아래 빈칸(v13.469~476 기록) — iOS 18.7 은 상태 표시줄 방식이 black-translucent 면 화면(874) 대신 812(= 874 − 위 안전 영역 62)를
     '화면 전체' 로 잡고 그 아래는 웹 화면이 그릴 수 없음(틀을 늘려도 · 넘침을 풀어도 안 그려지고 입력 줄만 밖으로 나감).
     해결 = <meta apple-mobile-web-app-status-bar-style content="default"> + 홈 화면 바로가기 다시 만들기(만들 때 값이 저장됨). 화면 안에서 높이를 늘리는 시도는 하지 말 것 */
  /* v13.473 📐 화면 진단 — 아이폰이 알려 주는 높이 값들과, 맨 아래에 그려지는지 보는 색 띠 3개 (🎨 화면 설정 › 화면 진단). 찍어서 보내면 정확히 맞출 수 있음 */
  window.wmShellDiag = function () {
    var old = document.querySelectorAll('.wm-diag,.wm-diag-p'); if (old.length) { old.forEach(function (e) { e.remove(); }); return; }
    function unit(u) { var d = document.createElement('div'); d.style.cssText = 'position:fixed;left:-9px;top:0;width:1px;height:' + u + ';visibility:hidden'; document.body.appendChild(d); var h = d.getBoundingClientRect().height; d.remove(); return Math.round(h * 10) / 10; }
    function inset(side) { var d = document.createElement('div'); d.style.cssText = 'position:fixed;left:-9px;top:0;width:1px;visibility:hidden;padding-top:env(safe-area-inset-' + side + ',0px)'; document.body.appendChild(d); var h = d.getBoundingClientRect().height; d.remove(); return Math.round(h * 10) / 10; }
    var vv = window.visualViewport, b = document.body.getBoundingClientRect(), s = scroller(), sr = s ? s.getBoundingClientRect() : null;
    var cx = document.querySelector('#mMessages .cx'), cr = cx && cx.offsetParent !== null ? cx.getBoundingClientRect() : null;
    var L = [
      '<b>📐 화면 진단</b> v' + (typeof WM_VERSION !== 'undefined' ? WM_VERSION : '?'),
      'standalone=' + window.navigator.standalone + ' dm=' + (window.matchMedia && matchMedia('(display-mode: standalone)').matches),
      'screen=' + screen.width + 'x' + screen.height + ' avail=' + screen.availWidth + 'x' + screen.availHeight + ' dpr=' + window.devicePixelRatio,
      'inner=' + window.innerWidth + 'x' + window.innerHeight + ' outer=' + window.outerWidth + 'x' + window.outerHeight,
      'client=' + docEl.clientWidth + 'x' + docEl.clientHeight + ' scrollH=' + docEl.scrollHeight,
      'vv=' + (vv ? Math.round(vv.width) + 'x' + Math.round(vv.height * 10) / 10 + ' off=' + Math.round(vv.offsetTop) + ' sc=' + vv.scale : '-'),
      'vh=' + unit('100vh') + ' lvh=' + unit('100lvh') + ' svh=' + unit('100svh') + ' dvh=' + unit('100dvh') + ' 100%=' + unit('100%'),
      'inset t=' + inset('top') + ' b=' + inset('bottom') + ' l=' + inset('left') + ' r=' + inset('right'),
      'fixed inset0=' + (function () { var d = document.createElement('div'); d.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none'; docEl.appendChild(d); var r = d.getBoundingClientRect(); d.remove(); return Math.round(r.top) + '~' + Math.round(r.bottom * 10) / 10; })() + ' html=' + Math.round(docEl.getBoundingClientRect().height * 10) / 10,
      'realY=' + realY() + ' body=' + Math.round(b.top) + '~' + Math.round(b.bottom) + ' pos=' + getComputedStyle(document.body).position,
      'page=' + (s ? s.id + ' ' + Math.round(sr.top) + '~' + Math.round(sr.bottom) : '-') + (cr ? ' cx=' + Math.round(cr.top) + '~' + Math.round(cr.bottom) : ''),
      'bar=' + ((document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]') || {}).content || '-'),
      'htmlOv=' + getComputedStyle(docEl).overflowY,
      'kb=' + docEl.classList.contains('wm-kb') + ' full=' + docEl.classList.contains('cx-full') + ' ua=' + navigator.userAgent.replace(/^.*?(iPhone OS [\d_]+).*?(Version\/[\d.]+)?.*$/, '$1 $2'),
      '색 띠: 빨강=고정 맨 아래 · 파랑=고정 +inset 아래 · 초록=100vh 끝 · 노랑=100lvh 끝',
      '→ 이 화면을 찍어 보내 주세요 (맨 아래까지 나오게)'
    ];
    var box = document.createElement('div'); box.className = 'wm-diag';
    box.innerHTML = L.join('\n') + '\n<button type="button" onclick="wmShellDiag()">닫기</button>';
    document.body.appendChild(box);
    var it = inset('top');
    [['#DC2626', 'bottom:0', '빨강 fixed bottom:0'], ['#2563EB', 'bottom:' + (-it) + 'px', '파랑 fixed bottom:-' + it], ['#16A34A', 'top:calc(100vh - 14px)', '초록 100vh'], ['#CA8A04', 'top:calc(100lvh - 28px)', '노랑 100lvh-14']].forEach(function (x, i) {
      var d = document.createElement('div'); d.className = 'wm-diag-p'; d.style.cssText = 'background:' + x[0] + ';' + x[1] + ';left:' + (i * 25) + '%;width:25%'; d.textContent = x[2]; docEl.appendChild(d);
    });
  };

  function apply() {
    var want = !window.WM_SOLO && !window.WM_PDWIN && !printing, pc = want && !(mq && mq.matches);
    if (want !== on()) docEl.classList.toggle('wm-shell', want);
    if (pc !== pcOn()) docEl.classList.toggle('wm-shell-pc', pc);
    if (!want || pc) { docEl.style.removeProperty('--wm-vh'); docEl.classList.remove('wm-kb'); }
    if (!want) docEl.classList.remove('wm-tabs-off');
    if (want) fit();
    pageH();
  }
  /* PC — 화면(굴리는 칸) 높이를 --wm-ph 로 알려 줌: 옆에 붙어 따라오는 칸(.mw-side · .cal-side · .wr-src)이 창 높이(100vh) 대신 이 높이에 맞춤 */
  function pageH() {
    if (!pcOn()) { docEl.style.removeProperty('--wm-ph'); return; }
    var s = scroller(); if (s && s.clientHeight > 0) docEl.style.setProperty('--wm-ph', s.clientHeight + 'px');
  }
  /* 틀 높이 = 지금 보이는 높이(키보드가 올라오면 그만큼 줄어듦) · iOS 가 문서를 밀어 올렸으면 되돌림 */
  /* v13.470 평소엔 틀을 화면 위아래 끝에 그대로 붙임(top:0 · bottom:0) — 홈 화면 바로가기(설치형)에서 아이폰이 '보이는 높이' 를
     실제 화면보다 짧게 알려 줘 맨 아래(둥근 모서리)까지 안 닿던 것. 키보드가 올라왔을 때만(html.wm-kb) 보이는 높이로 줄임 */
  function fit() {
    if (!on()) return;
    if (pcOn()) { if (realY() > 0) realScrollTo(0, 0); pageH(); return; }
    var vv = window.visualViewport, h = vv ? vv.height : window.innerHeight;
    var full = Math.max(window.innerHeight || 0, docEl.clientHeight || 0);
    var a = document.activeElement, typing = !!(a && a.matches && a.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]),textarea,[contenteditable="true"]'));
    var kb = typing && h > 100 && full - h > 120;   // 입력 중이고 보이는 높이가 눈에 띄게 줄었을 때만
    docEl.classList.toggle('wm-kb', kb);
    if (kb) docEl.style.setProperty('--wm-vh', Math.round(h) + 'px'); else docEl.style.removeProperty('--wm-vh');
    if (realY() > 0 || (vv && vv.offsetTop > 0 && !kb) || (kb && vv && vv.offsetTop > 0)) realScrollTo(0, 0);
  }
  /* 세로 공간 — 아래로 굴리면 탭 줄들을 접고(html.wm-tabs-off), 위로 조금 굴리거나 맨 위면 다시. 접고 펼 때 내용이 튀지 않게 굴린 값을 맞춤 */
  var tS = null, tY = 0, tAcc = 0, tLock = 0;
  function tabsSet(off, s) {
    if (docEl.classList.contains('wm-tabs-off') === off) return;
    var t0 = s ? s.getBoundingClientRect().top : 0;
    docEl.classList.toggle('wm-tabs-off', off);
    if (s) { var d = s.getBoundingClientRect().top - t0; if (d) s.scrollTop += d; tY = s.scrollTop; }
    tAcc = 0; tLock = Date.now() + 250; pageH();
  }
  /* v13.482 접는 것은 하위 탭만(대메뉴 줄은 늘 제자리) · PC 도 같이 */
  function tabsOnScroll(s) {
    var y = s.scrollTop;
    if (s !== tS) { tS = s; tY = y; tAcc = 0; tabsSet(false, null); return; }
    var d = y - tY; tY = y; if (!d || Date.now() < tLock) return;
    tAcc = (d > 0) === (tAcc > 0) ? tAcc + d : d;
    var off = docEl.classList.contains('wm-tabs-off');
    if (!off && tAcc > 48 && y > 90 && s.scrollHeight - s.clientHeight > 260) tabsSet(true, s);   // 굴릴 거리가 넉넉할 때만 접음
    else if (off && (tAcc < -28 || y < 24)) tabsSet(false, s);
  }
  window.wmShellTabs = function (show) { tabsSet(!show, scroller()); };

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
    if (on() && t && t.nodeType === 1 && t.parentElement && t.parentElement.classList.contains('con')) { tabsOnScroll(t); try { window.dispatchEvent(new Event('scroll')); } catch (x) {} }
  }, true);

  // 화면이 바뀌었으면(머리 줄 단추 · 알림 · 바로 가기) 탭 줄을 다시 — 접힌 채 남아 다른 화면으로 못 가는 일이 없게
  function tabsCheck() { if (!on() || !docEl.classList.contains('wm-tabs-off')) return; var s = scroller(); if (s !== tS || !s || s.scrollTop < 24 || s.scrollHeight - s.clientHeight < 120) { tS = s; tY = s ? s.scrollTop : 0; tabsSet(false, null); } }
  document.addEventListener('click', function () { setTimeout(tabsCheck, 60); setTimeout(tabsCheck, 500); }, true);
  setInterval(function () { tabsCheck(); pageH(); }, 1500);
  document.addEventListener('click', function () { setTimeout(pageH, 80); }, true);
  // 인쇄 — 틀을 풀어 문서 전체가 나오게
  window.addEventListener('beforeprint', function () { printing = true; apply(); });
  window.addEventListener('afterprint', function () { printing = false; apply(); });
  document.addEventListener('DOMContentLoaded', function () {
    pageH(); if (!window.ResizeObserver) return;
    var ro = new ResizeObserver(pageH), c = document.querySelector('.con'); if (!c) return;
    for (var i = 0; i < c.children.length; i++) if (/^m[A-Z]/.test(c.children[i].id || '')) ro.observe(c.children[i]);
  });
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
    var t = e.target; if (!on() || pcOn() || !t || !t.matches || !t.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]),textarea,select,[contenteditable="true"]')) return;
    setTimeout(function () {
      fit();
      var s = scroller(); if (!s || !s.contains(t) || document.activeElement !== t) return;
      var r = t.getBoundingClientRect(), b = s.getBoundingClientRect();
      if (r.bottom > b.bottom - 8 || r.top < b.top + 8) { try { t.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (x) {} fit(); }
    }, 350);
  });
})();
