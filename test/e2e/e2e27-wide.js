// 모든 탭이 창 너비 전체 (1920px 에서 .con = 1920, 가로 스크롤 없음) — v13.251
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  await page.setViewport({ width: 1920, height: 1000 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#loginEmail', { visible: true });
  await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
  await page.keyboard.press('Enter');
  await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id; });
  await wait(800);
  var out = [];
  var pages = ['team:weekly', 'team:archive', 'team:trend', 'project:pipeline', 'project:calendar', 'project:orders', 'project:issues', 'project:docs', 'project:as', 'mywork', 'workload', 'weekly_report', 'messages', 'useradmin', 'patchnotes', 'mindmap'];
  for (var i = 0; i < pages.length; i++) {
    var p = pages[i].split(':');
    await page.evaluate(function (pg, m) { setPage(pg); if (m) setMode(m); }, p[0], p[1] || null);
    await wait(900);
    var w = await page.evaluate(function () {
      var c = document.querySelector('.con'); var h = document.querySelector('.hdr-in');
      return { con: Math.round(c.getBoundingClientRect().width), hdr: Math.round(h.getBoundingClientRect().width), sx: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    out.push(pages[i] + ' con=' + w.con + ' hdr=' + w.hdr + (w.sx ? ' H-SCROLL' : ''));
    await page.screenshot({ path: path.join(SHOT, 'wide-' + pages[i].replace(':', '-') + '.png') });
  }
  console.log(out.join('\n'));
  console.log((out.some(function (x) { return /H-SCROLL/.test(x) || !/con=1920/.test(x); }) ? 'FAILED' : 'ALL PASS'), errs);
  await browser.close();
})();
