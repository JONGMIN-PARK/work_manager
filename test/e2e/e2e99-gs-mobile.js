// 📱 휴대폰 통합 검색 (v13.501) — 🔎 누르면 펼침 · 키보드를 내려도(입력 칸에서 커서가 빠져도) 결과 목록이 화면 폭 그대로 · 결과를 누르면 그리로
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1');
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!'); await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    var S = 'GSM' + Date.now();
    await page.evaluate(function (t) { return apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: t + ' 검색 시험 할 일' }) }); }, S);
    await page.evaluate(function () { setPage('team'); }); await wait(1000);
    var r = await page.evaluate(function () { var i = document.getElementById('globalSearchInput').getBoundingClientRect(); return [i.left + i.width / 2, i.top + i.height / 2, i.width]; });
    check(r[2] <= 40, '처음엔 🔎 만 ' + Math.round(r[2]));
    await page.touchscreen.tap(r[0], r[1]); await wait(400);
    var w = await page.evaluate(function () { return document.getElementById('globalSearchWrap').getBoundingClientRect().width; });
    check(w > 300, '누르면 머리 줄 폭으로 펼침 ' + Math.round(w));
    await page.keyboard.type(S);
    await page.waitForFunction(function () { return document.querySelector('#globalSearchDropdown .gs-item'); }, { timeout: 15000 });
    // 키보드 내림 = 입력 칸에서 커서가 빠짐
    await page.evaluate(function () { document.activeElement.blur(); }); await wait(400);
    var st = await page.evaluate(function () { var w = document.getElementById('globalSearchWrap').getBoundingClientRect(), d = document.getElementById('globalSearchDropdown'), dr = d.getBoundingClientRect(); return { w: w.width, dw: dr.width, disp: d.style.display }; });
    check(st.disp === 'flex' && st.w > 300 && st.dw > 300, '키보드를 내려도 결과 목록이 화면 폭 그대로 ' + JSON.stringify(st));
    var it = await page.evaluate(function () { var e = document.querySelector('#globalSearchDropdown .gs-item'); e.scrollIntoView({ block: 'center' }); var b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    await page.touchscreen.tap(it[0], it[1]); await wait(1200);
    var after = await page.evaluate(function () { return { page: typeof curPage !== 'undefined' && curPage, dd: document.getElementById('globalSearchDropdown').style.display, open: document.getElementById('globalSearchWrap').classList.contains('gs-open'), w: document.getElementById('globalSearchWrap').getBoundingClientRect().width }; });
    check(after.page === 'mywork' && after.dd === 'none' && !after.open && after.w <= 40, '결과를 누르면 그 화면으로 가고 검색 칸은 접힘 ' + JSON.stringify(after));
    // 바깥을 누르면 닫히고 접힘
    await page.touchscreen.tap(r[0], r[1]); await wait(300); await page.keyboard.type(S); await wait(1500);
    await page.evaluate(function () { document.activeElement.blur(); }); await page.touchscreen.tap(200, 600); await wait(400);
    var out = await page.evaluate(function () { return { dd: document.getElementById('globalSearchDropdown').style.display, w: document.getElementById('globalSearchWrap').getBoundingClientRect().width }; });
    check(out.dd === 'none' && out.w <= 40, '바깥을 누르면 닫히고 🔎 로 ' + JSON.stringify(out));
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  await browser.close();
  console.log(fail ? 'e2e99 FAIL ' + fail : 'e2e99-gs-mobile.js ALL PASS ' + ok, '[]');
  process.exit(fail ? 1 : 0);
})();
