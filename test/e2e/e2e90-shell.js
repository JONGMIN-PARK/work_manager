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
    await wait(500);
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
    // 화면을 바꿔도 틀은 그대로 (굴린 채로 다른 화면 → 머리 줄 0)
    await page.evaluate(function () { setPage('project'); }); await wait(800);
    check((await st()).hdrTop === 0, '굴린 뒤 다른 화면으로 가도 머리 줄 제자리');
    // 입력 칸 — 누른 뒤에도 문서는 0
    await page.evaluate(function () { setPage('mywork'); }); await wait(1000);
    await page.tap('#mwAddTitle'); await wait(600);
    a = await st(); real = await page.evaluate(function () { return document.scrollingElement.scrollTop; });
    check(a.hdrTop === 0 && real === 0, '입력 칸을 눌러도 틀 그대로 ' + JSON.stringify([a.hdrTop, real]));
    // PC 폭 — 예전 그대로(문서 굴림)
    await page.setViewport({ width: 1400, height: 900 });
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(800);
    var pc = await page.evaluate(function () { return { shell: document.documentElement.classList.contains('wm-shell'), pos: getComputedStyle(document.body).position, y: (window.scrollTo(0, 0), window.scrollY) }; });
    check(!pc.shell && pc.pos !== 'fixed', 'PC — 틀 고정 안 함(예전 그대로) ' + JSON.stringify(pc));
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  await browser.close();
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
