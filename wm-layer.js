/* wm-layer.js — 어떤 창이든 닫을 길을 보장 (v13.436)
 * 휴대폰 · 좁은 창에서 창(모달 · 옆 패널 · 전체 화면 보기)을 열었는데 ✕ 가 화면 밖으로 밀리거나 스크롤로 사라져
 * 빠져나올 수 없던 문제를 한곳에서 막는다. 창을 만드는 코드는 100곳이 넘어 하나씩 고치는 대신 화면을 보고 판단한다.
 *
 *   ① 떠 있는 ✕ — 맨 위 창에 '지금 누를 수 있는' 닫기 단추가 없으면 화면 오른쪽 위에 ✕ 를 띄운다 (좁은 화면 · 터치 화면만)
 *   ② 뒤로 가기 — 터치 기기에서 뒤로(안드로이드 단추 · 아이폰 밀기)를 누르면 앱을 나가지 않고 맨 위 창이 닫힌다
 *
 * 닫는 순서: [data-wm-close] → 창 머리의 ✕ → '닫기'·'취소' 단추 → createModal 의 닫기 → Esc → (마지막) 창 숨김.
 * 창이 가진 닫기 단추를 대신 눌러 주는 것이라 '저장 안 한 내용' 확인 같은 그 창의 처리는 그대로 탄다.
 * 새 창을 만들 때 닫기 단추에 data-wm-close 를 달아 두면 가장 먼저 쓰인다.
 *
 *   wmLayer.top()      맨 위 창 (없으면 null)
 *   wmLayer.probe()    { layer, cands, visible } — 점검 도구용
 *   wmLayer.closeTop() 맨 위 창 닫기 → 닫을 창이 있었으면 true
 */
(function () {
  if (window.wmLayer) return;
  var SKIP = '#loginOverlay,#initLoading,.wm-splash,#wmProgOverlay,#dropOverlay,#wmLayerX,.hdr';
  // 화면(.con) 안의 것은 창이 아니라 화면 자체(예: 휴대폰 대화방) — 전체 화면 모드(집중 · 발표)만 창으로 본다
  var IN_CON = '.mm-ed.mm-zen,.mm-ed.mm-pitch,.nb.nb-focus';
  // 이름으로 아는 닫기 단추
  var KNOWN = '[data-wm-close],.mm-zen-exit,.mm-pitch-x,.nb.nb-focus [data-nb="focus"],.cb-x,[data-mwt-close]';
  var X_RE = /^[✕✖×╳xX]$/, WORD_RE = /^(닫기|취소|✕ 닫기|닫기 ✕|← 뒤로|‹ 뒤로|뒤로|나가기)$/, BAD_RE = /삭제|제거|지우|지움|빼기|해제/;
  var coarse = false, btn = null;
  try { coarse = window.matchMedia('(pointer:coarse)').matches; } catch (e) {}
  var W = function () { return document.documentElement.clientWidth || window.innerWidth; };
  var H = function () { return window.innerHeight; };
  /** 좁은 화면이거나 터치 화면일 때만 일한다 — 넓은 PC 화면은 건드리지 않음 */
  function active() { return coarse || W() <= 820 || H() <= 520; }

  function shown(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  /** (x, y) 에 있는 것의 바깥쪽 fixed 조상 — 화면을 60% 넘게 덮는 것만 창으로 본다 */
  function layerAt(x, y) {
    var el = document.elementFromPoint(x, y), found = null;
    for (var n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') found = n;
    }
    if (!found || found.closest(SKIP)) return null;
    if (found.closest('.con') && !found.matches(IN_CON)) return null;
    var r = found.getBoundingClientRect();
    if (r.width < W() * 0.6 || r.height < H() * 0.6) return null;
    return found;
  }
  function top() {
    var w = W(), h = H();
    if (btn && btn.style.pointerEvents !== 'none') { btn.style.pointerEvents = 'none'; try { return top(); } finally { btn.style.pointerEvents = ''; } }
    return layerAt(w / 2, h / 2) || layerAt(w / 2, h * 0.25) || layerAt(w / 2, h * 0.75);
  }
  /** 창 안의 닫기 후보 — 순서대로 [data-wm-close] · 머리의 ✕ · '닫기'/'취소' 글자 단추 */
  function cands(L) {
    var out = [], lr = L.getBoundingClientRect();
    L.querySelectorAll(KNOWN).forEach(function (e) { out.push({ el: e, k: shown(e) ? 0 : 3 }); });   // 숨어 있는 것(좁은 화면에서 가려진 나가기 단추)도 대신 눌러 줄 수는 있음
    var list = L.querySelectorAll('button,[role="button"],a,span,div,i,b');
    for (var i = 0; i < list.length && i < 6000; i++) {
      var e = list[i];
      if (e.childElementCount > 1 || e.matches(KNOWN)) continue;
      var t = (e.textContent || '').trim();
      if (t.length > 6) continue;
      var lab = (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '');
      if (BAD_RE.test(lab)) continue;
      var isX = X_RE.test(t) || (t.length <= 2 && /닫기|close/i.test(lab));
      var isWord = WORD_RE.test(t);
      if (!isX && !isWord) continue;
      if (e.tagName !== 'BUTTON' && e.tagName !== 'A' && !e.onclick && !e.hasAttribute('onclick') && !e.hasAttribute('role') && getComputedStyle(e).cursor !== 'pointer') continue;
      if (e.disabled || !shown(e)) continue;
      if (isX) {
        // 목록 줄의 ✕(지우기)를 잘못 누르지 않게 — 창 머리(스크롤 안쪽 기준 위에서 110px 안)에 있는 것만
        var sp = e.parentElement;
        while (sp && sp !== L && !(/(auto|scroll)/.test(getComputedStyle(sp).overflowY) && sp.scrollHeight > sp.clientHeight + 2)) sp = sp.parentElement;
        sp = sp || L;
        var bx = e; while (bx.parentElement && bx.parentElement !== L) bx = bx.parentElement;
        var base = sp === L ? Math.max(lr.top, bx.getBoundingClientRect().top) : sp.getBoundingClientRect().top - sp.scrollTop;
        var er = e.getBoundingClientRect();
        if (er.top - base > 110) continue;
      }
      out.push({ el: e, k: isX ? 1 : 2 });
    }
    out.sort(function (a, b) { return a.k - b.k; });
    return out;
  }
  /** 지금 화면 안에 있고 다른 것에 가려지지 않아 바로 누를 수 있는가 */
  function tappable(e) {
    var r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 2 || y < 2 || x > W() - 2 || y > H() - 2) return false;
    var hit = document.elementFromPoint(x, y);
    return !!hit && (hit === e || e.contains(hit) || hit.contains(e) && hit.getBoundingClientRect().width < r.width + 40);
  }
  function probe() {
    if (btn) btn.style.pointerEvents = 'none';
    try { return probe0(); } finally { if (btn) btn.style.pointerEvents = ''; }
  }
  function probe0() {
    var L = top();
    if (!L) return { layer: null, cands: [], visible: null };
    var c = cands(L), vis = null;
    for (var i = 0; i < c.length; i++) if (tappable(c[i].el)) { vis = c[i].el; break; }
    return { layer: L, cands: c, visible: vis };
  }
  function hide(L) {
    if (!L.isConnected) return;
    var had = false;
    ['on', 'open', 'show', 'active', 'visible'].forEach(function (c) { if (L.classList.contains(c)) { L.classList.remove(c); had = true; } });
    if (had && !shown(L)) return;
    if (L.style.display && L.style.display !== 'none' && L.id) { L.style.display = 'none'; return; }
    L.remove();
  }
  function closeTop() {
    var p = probe(), L = p.layer;
    if (!L) return false;
    if (!L.childElementCount) { L.click(); return true; }           // 빈 배경막 — 누르면 닫히는 것
    var c = p.visible ? [{ el: p.visible }] : p.cands;
    if (c.length) { c[0].el.click(); return true; }
    try { L.click(); } catch (e) {}                                   // 배경을 누르면 닫히는 창 (그 창의 닫기 처리를 그대로 타게)
    if (!L.isConnected || !shown(L)) return true;
    if (typeof L._wmClose === 'function') { L._wmClose(); return true; }
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true })); } catch (e) {}
    setTimeout(function () { if (L.isConnected && shown(L) && top() === L) hide(L); }, 80);
    return true;
  }

  /* ── ① 떠 있는 ✕ ── */
  function ensureBtn() {
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'wmLayerX'; btn.type = 'button';
    btn.setAttribute('aria-label', '창 닫기'); btn.title = '창 닫기';
    btn.textContent = '✕';
    btn.style.cssText = 'position:fixed;top:calc(6px + env(safe-area-inset-top,0px));right:calc(6px + env(safe-area-inset-right,0px));z-index:2147483600;width:40px;height:40px;border-radius:50%;' +
      'border:1px solid rgba(255,255,255,.4);background:rgba(17,22,38,.86);color:#fff;font-size:17px;font-weight:700;line-height:1;cursor:pointer;display:none;align-items:center;justify-content:center;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.35);-webkit-tap-highlight-color:transparent;padding:0';
    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); btn.style.display = 'none'; closeTop(); schedule(); });
    return btn;
  }
  /* ── ② 뒤로 가기 ── */
  var pushed = false, skip = false;
  function hist(has) {
    if (!coarse) return;
    if (has && !pushed) { pushed = true; try { history.pushState({ wmLayer: 1 }, ''); } catch (e) { pushed = false; } }
    else if (!has && pushed) { pushed = false; skip = true; try { history.back(); } catch (e) { skip = false; } }
  }
  window.addEventListener('popstate', function (e) {
    if (skip) { skip = false; e.stopImmediatePropagation(); return; }
    if (!pushed) return;
    pushed = false;
    if (top()) { e.stopImmediatePropagation(); closeTop(); schedule(); }
  });

  /* v13.440 굴리는 동안은 쉬기 — 점검(화면 위 요소 찾기 · 스타일 읽기)은 화면 배치를 다시 계산하게 해서,
   *   굴릴 때마다(0.14초마다) 돌면 휴대폰에서 굴림이 끊긴다. 열린 창이 없으면 굴림이 멎은 뒤에 한 번만 본다.
   *   창이 열려 있을 때는 예전처럼 바로 (✕ 가 굴려서 사라졌는지 봐야 하므로) */
  var timer = null, hasLayer = false, lastScroll = 0;
  function scan() {
    timer = null;
    if (!document.body) return;
    if (!active()) { hasLayer = false; if (btn) btn.style.display = 'none'; hist(false); return; }
    if (!hasLayer && Date.now() - lastScroll < 300) { schedule(); return; }
    var p = probe();
    hasLayer = !!p.layer;
    hist(!!p.layer);
    var need = !!p.layer && !p.visible && p.layer.childElementCount > 0;
    if (!need) { if (btn) btn.style.display = 'none'; return; }
    var b = ensureBtn();
    if (b.parentNode !== document.body || b.nextSibling) document.body.appendChild(b);
    b.style.display = 'flex';
  }
  function schedule() { if (!timer) timer = setTimeout(scan, hasLayer ? 140 : 320); }
  function start() {
    try {
      new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) if (ms[i].target !== btn) { schedule(); return; }
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    } catch (e) {}
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    document.addEventListener('scroll', function () { lastScroll = Date.now(); if (hasLayer) schedule(); }, { capture: true, passive: true });
    schedule();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  window.wmLayer = { top: top, probe: probe, closeTop: closeTop, scan: scan };
})();
