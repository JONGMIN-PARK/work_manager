// 📱 휴대폰 틀 고정 (v13.469) — 문서는 안 굴러가고 화면만 그 안에서 · 머리 줄 제자리 · window.scrollY/scrollTo 넘겨 주기 · PC 는 예전 그대로
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1');
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(800);
    // 굴릴 거리가 생기게 할 일을 넉넉히
    await page.evaluate(async function () { for (var i = 0; i < 28; i++) await apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: '틀시험 할 일 ' + i }) }); });
    var st = function () { return page.evaluate(function () {
      var h = document.querySelector('.hdr').getBoundingClientRect(), s = wmShellScroller(), b = document.body.getBoundingClientRect();
      return { shell: document.documentElement.classList.contains('wm-shell'), pos: getComputedStyle(document.body).position, bodyH: Math.round(b.height), ih: innerHeight, docH: document.documentElement.scrollHeight, hdrTop: Math.round(h.top), sid: s && s.id, sTop: s ? Math.round(s.scrollTop) : -1, sMax: s ? s.scrollHeight - s.clientHeight : -1, sBottom: s ? Math.round(s.getBoundingClientRect().bottom) : -1, wy: window.scrollY, sw: document.documentElement.scrollWidth };
    }); };
    var pages = ['mywork', 'team', 'project', 'notebook', 'mindmap', 'messages'];
    var a;
    for (var i = 0; i < pages.length; i++) {
      await page.evaluate(function (p) { setPage(p); }, pages[i]); await wait(1200);
      a = await st();
      check(a.shell && a.pos === 'fixed' && a.bodyH === a.ih && a.docH <= a.ih + 1 && a.hdrTop === 0 && a.sBottom <= a.ih + 1 && a.sw <= 404, pages[i] + ' — 틀이 화면에 꽉 · 문서 안 굴러감 ' + JSON.stringify(a));
    }
    // 화면 안에서만 굴림 — 머리 줄은 제자리 · window.scrollY 도 따라옴
    await page.evaluate(function () { setPage('mywork'); }); await wait(1500);
    await page.evaluate(function () { var g = document.querySelector('#mMyWork [data-grp="later"]'); if (g && g.classList.contains('mw-folded')) g.querySelector('[data-fold]').click(); document.querySelectorAll('#mMyWork [data-mw-more]').forEach(function (b) { b.click(); }); });
    await page.waitForFunction(function () { var g = document.querySelector('#mMyWork [data-grp="later"]'); if (g && g.classList.contains('mw-folded')) g.querySelector('[data-fold]').click(); document.querySelectorAll('#mMyWork [data-mw-more]').forEach(function (b) { b.click(); }); var s = wmShellScroller(); return s && s.id === 'mMyWork' && s.scrollHeight - s.clientHeight > 300; }, { timeout: 20000, polling: 300 });
    a = await st();
    check(a.sid === 'mMyWork' && a.sMax > 200, '내 업무 — 화면 안에 굴릴 거리 있음 ' + a.sMax);
    await page.evaluate(function () { wmShellScroller().scrollTop = 99999; }); await wait(300);
    a = await st();
    check(a.hdrTop === 0 && a.sTop > 150 && a.wy === a.sTop && a.docH <= a.ih + 1, '끝까지 굴려도 머리 줄 제자리 · window.scrollY = 화면 굴린 값 ' + JSON.stringify([a.hdrTop, a.sTop, a.wy]));
    var real = await page.evaluate(function () { return document.scrollingElement.scrollTop; });
    check(real === 0, '문서 자체는 0 그대로 ' + real);
    await page.evaluate(function () { window.scrollTo(0, 60); }); await wait(200);
    check((await st()).sTop === 60, 'window.scrollTo(0, 60) → 화면이 60 으로');
    await page.evaluate(function () { window.scrollTo({ top: 0 }); }); await wait(200);
    check((await st()).sTop === 0, 'window.scrollTo({top:0}) → 맨 위로');
    // 손가락으로 끌기(터치) — 틀은 그대로
    var cdp = await page.target().createCDPSession();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 700 }] });
    for (var y = 700; y >= 200; y -= 50) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(700);
    a = await st();
    check(a.hdrTop === 0 && a.sTop > 100, '손가락으로 끌어도 머리 줄 제자리 · 화면만 굴러감 ' + JSON.stringify([a.hdrTop, a.sTop]));
    // v13.470 세로 공간 — 아래로 굴리면 탭 줄 접힘 · 위로 굴리면 다시 · 접힐 때 내용이 튀지 않음 · 틀은 화면 맨 아래까지
    await page.evaluate(function () { wmShellScroller().scrollTop = 0; wmShellTabs(true); }); await wait(400);
    var tabsVis = function () { return page.evaluate(function () { var t = document.getElementById('pageTabs'); return !!(t && t.offsetParent); }); };
    check(await tabsVis(), '맨 위 — 탭 줄 보임');
    var before = await page.evaluate(function () { var s = wmShellScroller(), y = 0; return new Promise(function (res) { (function step() { y += 30; s.scrollTop = y; if (y < 240) setTimeout(step, 40); else setTimeout(function () { var r = document.querySelector('#mMyWork .mw-row'); res({ off: document.documentElement.classList.contains('wm-tabs-off'), sTop: Math.round(s.scrollTop), h: s.clientHeight }); }, 400); })(); }); });
    check(before.off && (await tabsVis()), '아래로 굴리면 접힘 상태(하위 탭만) — 대메뉴 줄은 그대로 ' + JSON.stringify(before));
    await page.evaluate(function () { var s = wmShellScroller(), y = s.scrollTop; return new Promise(function (res) { (function step(n) { y -= 20; s.scrollTop = y; if (n < 3) setTimeout(function () { step(n + 1); }, 40); else setTimeout(res, 400); })(0); }); });
    check(await tabsVis() && !(await page.evaluate(function () { return document.documentElement.classList.contains('wm-tabs-off'); })), '위로 조금 굴리면 접힘 풀림');
    var edge = await page.evaluate(function () { var b = document.body.getBoundingClientRect(), s = wmShellScroller().getBoundingClientRect(), cs = getComputedStyle(document.body); return { bottom: Math.round(b.bottom), sBottom: Math.round(s.bottom), ih: innerHeight, h: cs.height, kb: document.documentElement.classList.contains('wm-kb'), vh: document.documentElement.style.getPropertyValue('--wm-vh') }; });
    check(edge.bottom === edge.ih && edge.sBottom === edge.ih && !edge.kb && !edge.vh, '틀 · 화면이 맨 아래 끝까지 (키보드 없을 땐 높이를 따로 안 잡음) ' + JSON.stringify(edge));
    // 화면을 바꿔도 틀은 그대로 (굴린 채로 다른 화면 → 머리 줄 0)
    await page.evaluate(function () { wmShellScroller().scrollTop = 0; }); await wait(600);
    await page.evaluate(function () { var s = wmShellScroller(), y = 0; return new Promise(function (res) { (function step() { y += 30; s.scrollTop = y; if (y < 240) setTimeout(step, 40); else setTimeout(res, 400); })(); }); });
    check(await page.evaluate(function () { return document.documentElement.classList.contains('wm-tabs-off'); }), '(다시 아래로 굴려 접힘) ' + JSON.stringify(await page.evaluate(function () { var s = wmShellScroller(); return { id: s.id, top: s.scrollTop, max: s.scrollHeight - s.clientHeight, off: document.documentElement.classList.contains('wm-tabs-off'), act: document.activeElement && document.activeElement.id, kb: document.documentElement.classList.contains('wm-kb') }; })));
    await page.evaluate(function () { setPage('project'); }); await wait(1800);
    check((await st()).hdrTop === 0, '굴린 뒤 다른 화면으로 가도 머리 줄 제자리');
    check(await tabsVis() && await page.evaluate(function () { return !document.documentElement.classList.contains('wm-tabs-off') && document.getElementById('modeTabsProj').offsetHeight > 10; }), '다른 화면으로 가면 하위 탭 다시 보임');
    // v13.482 하위 탭만 접힘 — 대메뉴(내 업무 ~ 노트)는 제자리
    var sub = await page.evaluate(function () { var s = wmShellScroller(), pad = document.createElement('div'); pad.id = 'zzPad2'; pad.style.height = '3000px'; s.appendChild(pad); var y = 0; return new Promise(function (res) { (function step() { y += 30; s.scrollTop = y; if (y < 300) setTimeout(step, 40); else setTimeout(function () { var r = { off: document.documentElement.classList.contains('wm-tabs-off'), sub: document.getElementById('modeTabsProj').offsetHeight, page: document.getElementById('pageTabs').offsetHeight, pt: Math.round(document.getElementById('pageTabs').getBoundingClientRect().top), hb: Math.round(document.querySelector('.hdr').getBoundingClientRect().bottom) }; pad.remove(); res(r); }, 400); })(); }); });
    check(sub.off && sub.sub === 0 && sub.page > 20 && sub.pt >= sub.hb - 1, '휴대폰 — 굴리면 하위 탭만 접히고 대메뉴 줄은 제자리 ' + JSON.stringify(sub));
    // v13.482 새 버전 띠 — 아래쪽 · 큰 단추 · 누르면 바로 표시
    var upd = await page.evaluate(function () { try { localStorage.removeItem('wm-upd-later'); } catch (e) {} _wmUpdateShow({ build: 'zz-test', version: '99.0' }); var b = document.getElementById('wmUpd'), r = b.getBoundingClientRect(), g = b.querySelector('.wm-upd-go').getBoundingClientRect(), x = b.querySelector('.wm-upd-x').getBoundingClientRect(); var hit = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2); return { bottom: Math.round(innerHeight - r.bottom), gh: Math.round(g.height), xh: Math.round(x.height), gw: Math.round(g.width), hit: !!(hit && hit.closest('.wm-upd-go')), inside: r.left >= 0 && r.right <= innerWidth }; });
    check(upd.bottom >= 0 && upd.bottom < 60 && upd.gh >= 44 && upd.xh >= 44 && upd.hit && upd.inside, '휴대폰 — 새 버전 띠는 화면 아래 · 단추 44px 이상 · 가려지지 않음 ' + JSON.stringify(upd));
    var busy = await page.evaluate(function () { window.__zzReload = 0; window.__wmReload = function () { window.__zzReload++; }; var b = document.getElementById('wmUpd'); b.querySelector('.wm-upd-go').click(); var r = { busy: b.classList.contains('is-busy'), txt: b.querySelector('.wm-upd-go').textContent }; b.querySelector('.wm-upd-go').click(); return new Promise(function (res) { setTimeout(function () { r.n = window.__zzReload; delete window.__wmReload; b.remove(); res(r); }, 1200); }); });
    check(busy.busy && /새로 고치는 중/.test(busy.txt) && busy.n === 1, '새 버전 띠 — 누르자마자 「새로 고치는 중」 · 두 번 눌러도 한 번만 ' + JSON.stringify(busy));
    // 입력 칸 — 누른 뒤에도 문서는 0
    await page.evaluate(function () { setPage('mywork'); }); await wait(1000);
    await page.tap('#mwAddTitle'); await wait(600);
    a = await st(); real = await page.evaluate(function () { return document.scrollingElement.scrollTop; });
    check(a.hdrTop === 0 && real === 0, '입력 칸을 눌러도 틀 그대로 ' + JSON.stringify([a.hdrTop, real]));
    // PC 폭 — v13.480 PC 도 틀 고정 · v13.482 굴리면 하위 탭은 접히고 머리 줄(대메뉴)만 제자리
    await page.setViewport({ width: 1400, height: 700 });
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(800);
    await page.evaluate(function () { setPage('project'); setMode('pipeline'); }); await wait(700);
    var pc = await page.evaluate(function () {
      var s = wmShellScroller(), pad = document.createElement('div'); pad.id = 'zzPad'; pad.style.height = '3000px'; s.appendChild(pad);
      window.scrollTo(0, 900);
      var c = document.documentElement.classList, h = document.querySelector('.hdr').getBoundingClientRect(), t = document.getElementById('modeTabsProj').getBoundingClientRect(), on = document.querySelector('#modeTabsProj .tab.on');
      return { shell: c.contains('wm-shell'), pc: c.contains('wm-shell-pc'), off: c.contains('wm-tabs-off'), id: s.id, st: s.scrollTop, y: window.scrollY, doc: document.scrollingElement.scrollTop, hdr: Math.round(h.top), tabs: Math.round(t.top), tabsVis: t.height > 20 && t.top >= h.bottom - 1, on: on && on.dataset.m, scTop: Math.round(s.getBoundingClientRect().top), tabsBottom: Math.round(t.bottom), right: Math.round(s.getBoundingClientRect().right), iw: innerWidth };
    });
    check(pc.shell && pc.pc && pc.id === 'mPipeline', 'PC — 틀 고정 켜짐 ' + JSON.stringify(pc));
    check(pc.st === 900 && pc.y === 900 && pc.doc === 0, 'PC — 화면만 굴림(문서는 그대로) ' + JSON.stringify([pc.st, pc.y, pc.doc]));
    check(pc.hdr === 0 && pc.on === 'pipeline', 'PC — 굴려도 머리 줄 제자리 ' + JSON.stringify([pc.hdr, pc.tabs, pc.scTop]));
    check(pc.right === pc.iw, 'PC — 굴림 막대가 창 오른쪽 끝 ' + JSON.stringify([pc.right, pc.iw]));
    await page.evaluate(function () { var s = wmShellScroller(); s.scrollTop = 1500; }); await wait(400);
    var pc2 = await page.evaluate(function () { var p = document.getElementById('zzPad'); var r = { hdr: Math.round(document.querySelector('.hdr').getBoundingClientRect().top), menu: !!(document.querySelector('.hdr #pageTabs') && document.getElementById('pageTabs').offsetHeight > 10), off: document.documentElement.classList.contains('wm-tabs-off'), tabs: document.getElementById('modeTabsProj').offsetHeight > 20, ph: getComputedStyle(document.documentElement).getPropertyValue('--wm-ph'), ch: wmShellScroller().clientHeight }; return r; });
    check(pc2.off && !pc2.tabs && pc2.hdr === 0 && pc2.menu && parseInt(pc2.ph, 10) === pc2.ch, 'PC — 아래로 굴리면 하위 탭 접힘 · 머리 줄(대메뉴) 제자리 · 화면 높이(--wm-ph) 맞음 ' + JSON.stringify(pc2));
    await page.evaluate(function () { var s = wmShellScroller(); s.scrollTop = 1400; }); await wait(400);
    var pc3 = await page.evaluate(function () { var r = { off: document.documentElement.classList.contains('wm-tabs-off'), tabs: document.getElementById('modeTabsProj').offsetHeight > 20 }; var p = document.getElementById('zzPad'); if (p) p.remove(); return r; });
    check(!pc3.off && pc3.tabs, 'PC — 위로 굴리면 하위 탭 다시 ' + JSON.stringify(pc3));
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  await browser.close();
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
