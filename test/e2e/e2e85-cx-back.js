// 메신저 좁은 창 ← 이전 화면 (v13.462) — 다른 화면에서 곧장 연 방은 ← 가 그 화면으로 · 목록에서 연 방은 목록으로 · 목록 위 ← 이전 화면
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0; function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  await page.setViewport({ width: 700, height: 820 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#loginEmail', { visible: true });
  await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!'); await page.keyboard.press('Enter');
  await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
  var rid = await page.evaluate(async function () {
    var us = (await apiFetch('/api/chat/users')).data, kim = us.filter(function (u) { return /김/.test(u.name); })[0];
    var r = await apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: kim.id }) });
    for (var i = 0; i < 5; i++) await apiFetch('/api/chat/rooms/' + r.data.id + '/messages', { method: 'POST', body: JSON.stringify({ body: '좁은 창 메시지 ' + i }) });
    return r.data.id;
  });
  var st = function () { return page.evaluate(function () { return { page: curPage, full: document.documentElement.classList.contains('cx-full'), room: CX.room, tabs: !!document.getElementById('pageTabs').offsetParent }; }); };
  try {
    await page.evaluate(function () { setPage('mywork'); }); await wait(600);
    await page.evaluate(function (id) { chatOpenRoom(id); }, rid);
    await page.waitForSelector('#cxMsgs .cx-m', { timeout: 15000 }); await wait(500);
    var a = await st();
    check(a.page === 'messages' && a.full && !a.tabs, '내 업무에서 곧장 연 방 — 화면 전체 ' + JSON.stringify(a));
    check(await page.evaluate(function () { return document.querySelector('#cxHead [data-h="back"]').getAttribute('aria-label') === '이전 화면으로'; }), '← 단추 이름 = 이전 화면으로');
    await page.click('#cxHead [data-h="back"]'); await wait(700);
    a = await st();
    check(a.page === 'mywork' && !a.full && !a.room && a.tabs, '← 누르면 내 업무로 돌아감 ' + JSON.stringify(a));
    // 목록에서 고른 방은 ← 가 목록으로
    await page.evaluate(function () { setPage('messages'); }); await wait(800);
    await page.click('#mMessages .cx-r[data-room="' + rid + '"]');
    await page.waitForSelector('#cxMsgs .cx-m', { timeout: 15000 }); await wait(400);
    check(await page.evaluate(function () { return document.querySelector('#cxHead [data-h="back"]').getAttribute('aria-label') === '목록으로'; }), '목록에서 연 방 — ← 는 목록으로');
    await page.click('#cxHead [data-h="back"]'); await wait(500);
    a = await st();
    check(a.page === 'messages' && !a.room && a.tabs, '← 누르면 목록 ' + JSON.stringify(a));
    var vis = await page.evaluate(function () { var b = document.getElementById('cxSideBack'); return !!(b && b.offsetParent); });
    check(vis, '좁은 창 목록 위 ← 이전 화면 단추 보임');
    await page.click('#cxSideBack'); await wait(600);
    a = await st();
    check(a.page === 'mywork', '목록 ← 이전 화면 = 내 업무 ' + JSON.stringify(a));
    // 넓은 창 — 목록 ← 단추 안 보임
    await page.setViewport({ width: 1300, height: 820 }); await page.evaluate(function () { setPage('messages'); }); await wait(800);
    check(await page.evaluate(function () { var b = document.getElementById('cxSideBack'); return !b || !b.offsetParent; }), '넓은 창 — 목록 ← 없음');
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  await browser.close();
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
