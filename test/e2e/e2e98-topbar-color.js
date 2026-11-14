// 📱 휴대폰 맨 위 상태 표시줄 색 (v13.501) — theme-color 가 지금 테마의 머리 줄(반투명이면 겹친) 색을 따라감 · 테마 바꾸면 바로 · 대화방 전체 화면도
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
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
    await page.evaluate(function () { setPage('mywork'); }); await wait(1000);
    var meta = function () { return page.evaluate(function () { var m = document.querySelectorAll('meta[name="theme-color"]'); return { n: m.length, c: m[0] && m[0].content, media: m[0] && m[0].getAttribute('media') }; }); };
    // 머리 줄 맨 위 점의 실제 색을 화면 캡처로 읽어서 비교
    var px = async function () {
      var b64 = await page.screenshot({ clip: { x: 200, y: 1, width: 1, height: 1 }, encoding: 'base64' });
      return page.evaluate(function (d) { return new Promise(function (ok) { var im = new Image(); im.onload = function () { var c = document.createElement('canvas'); c.width = c.height = 1; var x = c.getContext('2d'); x.drawImage(im, 0, 0); var p = x.getImageData(0, 0, 1, 1).data; ok([p[0], p[1], p[2]]); }; im.src = 'data:image/png;base64,' + d; }); }, b64);
    };
    var hex2 = function (h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); };
    var near = function (a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 36; };   // 그라데이션 · 흐림은 평균 색이라 조금 차이
    var themes = await page.evaluate(function () { return TH.map(function (t) { return t.id; }).filter(function (id) { return id !== 'auto'; }); });
    var seen = {};
    for (var i = 0; i < themes.length; i++) {
      await page.evaluate(function (id) { aTh(id); }, themes[i]); await wait(1100);
      var m = await meta(), p = await px();
      seen[m.c] = 1;
      check(m.n === 1 && !m.media && /^#[0-9a-f]{6}$/.test(m.c) && near(hex2(m.c), p), themes[i] + ' — 상태 표시줄 색 ' + m.c + ' = 머리 줄 실제 색 rgb(' + p + ')');
    }
    check(Object.keys(seen).length >= 3, '테마마다 다른 색 ' + Object.keys(seen).join(','));
    // 어두운 테마 → 어두운 색, 밝은 테마 → 밝은 색
    await page.evaluate(function () { aTh('nova'); }); await wait(1100);
    var dk = hex2((await meta()).c);
    await page.evaluate(function () { aTh('pearl'); }); await wait(1100);
    var lt = hex2((await meta()).c);
    check(dk[0] + dk[1] + dk[2] < 150 && lt[0] + lt[1] + lt[2] > 600, '노바(어두움) ' + dk + ' · 펄(밝음) ' + lt);
    // 대화방 전체 화면 — 맨 위가 대화방 머리면 그 색
    await page.evaluate(function () { setPage('messages'); }); await wait(1500);
    var m2 = await meta(), p2 = await px();
    check(near(hex2(m2.c), p2), '메신저 화면에서도 맨 위 실제 색과 같음 ' + m2.c + ' rgb(' + p2 + ')');
    await page.screenshot({ path: path.join(SHOT, 'topbar-color.png'), clip: { x: 0, y: 0, width: 402, height: 120 } });
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  await browser.close();
  console.log(fail ? 'e2e98 FAIL ' + fail : 'e2e98-topbar-color.js ALL PASS ' + ok, '[]');
  process.exit(fail ? 1 : 0);
})();
