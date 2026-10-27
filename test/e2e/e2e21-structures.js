// 마인드맵 구조 — 타임라인 · 피시본 · 매트릭스로 바꾸기 · 줄기/격자 그림 · 저장 후 유지 · 되돌리기 (v13.245)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setViewport({ width: 1500, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id; });
    await wait(500);
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmNewTpl');
    await page.select('#mmNewTpl', 'wbs');
    await page.type('#mmNewTitle', '장비 2호기');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    var mapId = await page.evaluate(function () { return _mm.mapId; });
    for (var st of ['timeline', 'fishbone', 'matrix']) {
      await page.select('#mmStructure', st);
      await wait(350);
      await page.evaluate(function () { _mmFit(); });
      await wait(200);
      var info = await page.evaluate(function () {
        var nodes = document.querySelectorAll('#mmStage .mm-node');
        var hidden = Array.prototype.filter.call(nodes, function (e) { return e.style.display === 'none'; }).length;
        return { st: _mmSheet().structure, n: nodes.length, hidden: hidden, spine: !!document.querySelector('#mmEdges .mm-spine'), grid: !!document.querySelector('#mmEdges .mm-grid'),
          edges: document.querySelectorAll('#mmEdges .mm-edge').length, cls: document.getElementById('mmStage').className };
      });
      check(info.st === st && info.n > 10 && info.hidden === 0, st + ' — 모든 주제 표시 (' + info.n + ')');
      if (st === 'matrix') check(info.grid && info.edges === 0, '매트릭스 — 격자 · 선 없음');
      else check(info.spine && info.edges > 10 && /mm-st-/.test(info.cls) && !/mm-ul-svg/.test(info.cls), st + ' — 줄기 · 선 ' + info.edges);
      await page.screenshot({ path: path.join(SHOT, 'st-' + st + '.png') });
    }
    // 저장 후 다시 열어도 매트릭스
    await page.evaluate(function () { return _mmSaveNow(); }); await wait(500);
    await page.evaluate(function (id) { mmOpen(id); }, mapId);
    await page.waitForFunction(function () { return _mm.doc && document.querySelector('#mmStage .mm-root'); });
    await wait(300);
    check(await page.evaluate(function () { return _mmSheet().structure === 'matrix' && !!document.querySelector('#mmEdges .mm-grid'); }), '저장 후 다시 열어도 매트릭스');
    await page.select('#mmStructure', 'balanced'); await wait(300);
    check(await page.evaluate(function () { return /mm-ul-svg/.test(document.getElementById('mmStage').className) && !document.querySelector('#mmEdges .mm-spine,#mmEdges .mm-grid'); }), '마인드맵으로 돌아오면 원래 그림');
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
