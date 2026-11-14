/* wm-island.js — 📱 휴대폰 맨 위 '아일랜드' 빠른 메뉴 (v13.501)
 *   아이폰 다이내믹 아일랜드처럼 머리 줄 왼쪽의 검은 캡슐 하나 — 평소엔 지금 화면 · 안 읽은 메시지 · 알림 · 새 버전을 작게 보여 주고,
 *   누르면 그 자리에서 커지며 빠른 메뉴(화면 바로 가기 · 검색 · 알림 · 메신저 · 밝게/어둡게 · 맨 위로 · 새로 고침)가 펼쳐짐.
 *   상태 표시줄 자체(진짜 아일랜드 옆)는 웹 화면이 그릴 수 없음 — 아이폰 설치형은 status-bar-style default 라서(v13.476 높이 문제).
 *   휴대폰(폭 600px 이하 · 터치)에서만. 제목(업무 관리자) 자리를 대신함. */
(function () {
  var mq = window.matchMedia ? window.matchMedia('(max-width:600px) and (pointer:coarse)') : null;
  var docEl = document.documentElement, cap = null, panel = null, back = null, t = 0;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function badge(id) { var b = $(id); if (!b || b.style.display === 'none') return 0; return parseInt(b.textContent, 10) || 0; }
  /** 지금 화면 — 대메뉴의 켜진 탭 (메신저 · 패치노트처럼 탭에 없는 화면은 이름으로) */
  function curInfo() {
    var p = typeof curPage !== 'undefined' ? curPage : '';
    var tab = document.querySelector('#pageTabs .tab.on');
    if (p === 'messages') return { ic: '💬', nm: '메신저' };
    if (p === 'patchnotes') return { ic: '📜', nm: '패치노트' };
    if (tab) { var m = /^(\S+)\s+(.+)$/.exec(tab.textContent.trim()); if (m) return { ic: m[1], nm: m[2] }; }
    return { ic: '◆', nm: '업무 관리자' };
  }
  function status() {
    return { msg: badge('msgBadge'), noti: badge('notifBadge'), notice: badge('noticeBadge'), upd: !!$('wmUpd') };
  }
  function chips(s, big) {
    var h = '';
    if (s.upd) h += '<i class="wm-isl-c up" title="새 버전">⬆' + (big ? ' 새 버전' : '') + '</i>';
    if (s.msg) h += '<i class="wm-isl-c msg" title="안 읽은 메시지">💬' + s.msg + '</i>';
    if (s.noti) h += '<i class="wm-isl-c" title="알림">🔔' + s.noti + '</i>';
    return h;
  }
  function draw() {
    t = 0;
    if (!cap) return;
    var c = curInfo(), s = status();
    var html = '<span class="wm-isl-ic" aria-hidden="true">' + esc(c.ic) + '</span><span class="wm-isl-t">' + esc(c.nm) + '</span>' + chips(s);
    if (cap.innerHTML !== html) cap.innerHTML = html;
    cap.classList.toggle('has-c', !!(s.upd || s.msg || s.noti));
    cap.setAttribute('aria-label', '빠른 메뉴 — 지금 ' + c.nm + (s.msg ? ' · 안 읽은 메시지 ' + s.msg : '') + (s.upd ? ' · 새 버전 있음' : ''));
    if (panel) fill();
  }
  function soon() { if (!t) t = setTimeout(draw, 80); }

  function isDark() { return /dark/.test(getComputedStyle(docEl).colorScheme || ''); }
  function fill() {
    var s = status(), cur = typeof curPage !== 'undefined' ? curPage : '';
    var pages = Array.prototype.filter.call(document.querySelectorAll('#pageTabs .tab[data-page]'), function (b) { return b.style.display !== 'none' && !b.hidden; })
      .map(function (b) { var m = /^(\S+)\s+(.+)$/.exec(b.textContent.trim()) || [0, '•', b.textContent.trim()]; return { p: b.dataset.page, ic: m[1], nm: m[2] }; });
    pages.push({ p: 'messages', ic: '💬', nm: '메신저', n: s.msg });
    var ver = typeof WM_VERSION !== 'undefined' ? 'v' + WM_VERSION : '';
    var h = '<div class="wm-islp-h"><b>업무 관리자</b><span>' + esc(ver) + '</span>' + chips(s, true) + '<button type="button" class="wm-islp-x" data-isl="close" aria-label="닫기">✕</button></div>';
    h += '<div class="wm-islp-g">' + pages.map(function (x) {
      return '<button type="button" data-isl-page="' + esc(x.p) + '"' + (x.p === cur ? ' class="on" aria-current="page"' : '') + '><em>' + esc(x.ic) + '</em><span>' + esc(x.nm) + '</span>' + (x.n ? '<i>' + x.n + '</i>' : '') + '</button>';
    }).join('') + '</div>';
    h += '<div class="wm-islp-a">' +
      '<button type="button" data-isl="search"><em>🔎</em>검색</button>' +
      '<button type="button" data-isl="noti"><em>🔔</em>알림' + (s.noti ? '<i>' + s.noti + '</i>' : '') + '</button>' +
      '<button type="button" data-isl="theme"><em>' + (isDark() ? '☀️' : '🌙') + '</em>' + (isDark() ? '밝게' : '어둡게') + '</button>' +
      '<button type="button" data-isl="top"><em>⤒</em>맨 위로</button>' +
      '<button type="button" data-isl="reload"' + (s.upd ? ' class="up"' : '') + '><em>' + (s.upd ? '⬆' : '🔄') + '</em>' + (s.upd ? '업데이트' : '새로 고침') + '</button>' +
      '</div>';
    if (panel.innerHTML !== h) panel.innerHTML = h;
  }
  function open() {
    if (panel) return close();
    var r = cap.getBoundingClientRect();
    back = document.createElement('div'); back.className = 'wm-islp-bk';
    back.addEventListener('click', close);
    panel = document.createElement('div'); panel.className = 'wm-islp'; panel.id = 'wmIslandPanel';
    panel.setAttribute('role', 'menu'); panel.setAttribute('aria-label', '빠른 메뉴');
    document.body.appendChild(back); document.body.appendChild(panel);
    fill();
    // 캡슐 자리에서 커지는 것처럼 — 시작점을 캡슐 가운데로
    var pr = panel.getBoundingClientRect();
    panel.style.transformOrigin = Math.round(r.left + r.width / 2 - pr.left) + 'px ' + Math.round(r.top + r.height / 2 - pr.top) + 'px';
    panel.addEventListener('click', act);
    cap.setAttribute('aria-expanded', 'true'); cap.classList.add('open');
    requestAnimationFrame(function () { if (panel) panel.classList.add('in'); if (back) back.classList.add('in'); });
    document.addEventListener('keydown', key, true);
  }
  function close() {
    if (!panel) return;
    var p = panel, b = back; panel = null; back = null;
    p.classList.remove('in'); b.classList.remove('in');
    setTimeout(function () { p.remove(); b.remove(); }, 220);
    if (cap) { cap.setAttribute('aria-expanded', 'false'); cap.classList.remove('open'); }
    document.removeEventListener('keydown', key, true);
  }
  function key(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); cap && cap.focus(); } }
  function act(e) {
    var b = e.target.closest('button'); if (!b) return;
    var pg = b.getAttribute('data-isl-page'), a = b.getAttribute('data-isl');
    if (pg) { close(); if (typeof setPage === 'function') setPage(pg); return; }
    if (a === 'close') return close();
    close();
    if (a === 'search') { var i = $('globalSearchInput'); if (i) setTimeout(function () { i.focus(); if (typeof gsOnFocus === 'function') gsOnFocus(i.value); }, 60); }
    else if (a === 'noti') { if (typeof toggleNotifPanel === 'function') setTimeout(toggleNotifPanel, 60); }
    else if (a === 'theme') { if (typeof aTh === 'function') aTh(isDark() ? 'pearl' : 'nova', true); }
    else if (a === 'top') { var s = typeof wmShellScroller === 'function' && wmShellScroller(); if (s) s.scrollTo({ top: 0, behavior: 'smooth' }); else window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (a === 'reload') { if (typeof wmUpdateApply === 'function') wmUpdateApply(); else location.reload(); }
  }

  function mount() {
    var brand = document.querySelector('.hdr-brand');
    if (!brand) return;
    var want = !!(mq && mq.matches) && !window.WM_SOLO && !window.WM_PDWIN;
    if (want && !cap) {
      cap = document.createElement('button'); cap.type = 'button'; cap.id = 'wmIsland'; cap.className = 'wm-isl';
      cap.setAttribute('aria-haspopup', 'menu'); cap.setAttribute('aria-expanded', 'false');
      cap.addEventListener('click', function (e) { e.stopPropagation(); open(); });
      brand.appendChild(cap);
      docEl.classList.add('wm-isl-on');
      draw();
    } else if (!want && cap) {
      close(); cap.remove(); cap = null; docEl.classList.remove('wm-isl-on');
    }
  }
  window.wmIsland = { open: open, close: close, refresh: draw };

  function start() {
    mount();
    if (mq) { if (mq.addEventListener) mq.addEventListener('change', mount); else if (mq.addListener) mq.addListener(mount); }
    // 화면 바뀜 · 배지 바뀜 · 새 버전 띠 — 가볍게 지켜봄
    try {
      var mo = new MutationObserver(soon);
      var tabs = $('pageTabs'); if (tabs) mo.observe(tabs, { attributes: true, subtree: true, attributeFilter: ['class'] });
      ['msgBadge', 'notifBadge', 'noticeBadge'].forEach(function (id) { var b = $(id); if (b) mo.observe(b, { attributes: true, childList: true, characterData: true, subtree: true }); });
      mo.observe(document.body, { childList: true });   // #wmUpd 띠
    } catch (e) {}
    document.addEventListener('click', function () { setTimeout(soon, 120); }, true);   // 메신저처럼 탭에 없는 화면
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
