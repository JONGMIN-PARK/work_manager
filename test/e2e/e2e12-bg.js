// 마인드맵 캔버스 배경 고르기 — 묶음 · 저장 · 어두운 배경 글자색 · 저장 후 다시 열기 (v13.235)
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
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmNewTpl');
    await page.select('#mmNewTpl', 'wbs');
    await page.type('#mmNewTitle', '배경');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    var mapId = await page.evaluate(function () { return _mm.mapId; });
    check(await page.evaluate(function () { return _mmEl('mmCanvas').getAttribute('data-mmbg'); }) === 'dots', '기본은 점');
    await page.click('[data-menu="mmBgMenu"]'); await wait(150);
    var tiles = await page.evaluate(function () { return { n: document.querySelectorAll('#mmBgMenu .mm-bgsw').length, groups: Array.from(document.querySelectorAll('#mmBgMenu .mm-menu-h')).map(function (h) { return h.textContent; }), on: document.querySelector('#mmBgMenu .mm-bgsw.on').getAttribute('data-v') }; });
    check(tiles.n === 13 && tiles.groups.slice(1).join() === '깨끗한,무늬,색감,어둡게' && tiles.on === 'dots', '메뉴 묶음 · 13종 ' + JSON.stringify(tiles));
    await page.screenshot({ path: path.join(SHOT, 'bg-menu.png'), clip: { x: 700, y: 140, width: 560, height: 520 } });
    await page.click('#mmBgMenu [data-v="blueprint"]'); await wait(250);
    var bp = await page.evaluate(function () {
      var cv = _mmEl('mmCanvas'), txt = document.querySelector('#mmStage .mm-topic2 .mm-txt');
      return { attr: cv.getAttribute('data-mmbg'), sheet: _mmSheet().bg, bg: getComputedStyle(cv).backgroundColor, color: txt ? getComputedStyle(txt).color : '' };
    });
    check(bp.attr === 'blueprint' && bp.sheet === 'blueprint' && bp.bg === 'rgb(18, 50, 87)', '청사진 적용 · 시트에 저장 ' + JSON.stringify(bp));
    var rgb = (bp.color.match(/\d+/g) || []).map(Number);
    check(rgb.length >= 3 && rgb[0] > 180 && rgb[1] > 180, '어두운 배경 → 글자 밝게 ' + bp.color);
    await page.mouse.click(5, 5); await wait(100);
    await page.screenshot({ path: path.join(SHOT, 'bg-blueprint.png') });
    // 되돌리기 → 점
    await page.evaluate(function () { mmUndo(); }); await wait(200);
    check(await page.evaluate(function () { return _mmEl('mmCanvas').getAttribute('data-mmbg') === 'dots' && !_mmSheet().bg; }), '되돌리기');
    await page.evaluate(function () { mmRedo(); }); await wait(200);
    // 아이보리 → 저장 → 다시 열기
    await page.click('[data-menu="mmBgMenu"]'); await wait(120);
    await page.click('#mmBgMenu [data-v="ivory"]'); await wait(200);
    await page.screenshot({ path: path.join(SHOT, 'bg-ivory.png') });
    await page.evaluate(function () { return _mmSaveNow(); }); await wait(800);
    await page.evaluate(function (id) { mmOpen(id); }, mapId);
    await page.waitForFunction(function () { return _mm.doc && _mmEl('mmCanvas'); });
    await wait(500);
    check(await page.evaluate(function () { return _mmEl('mmCanvas').getAttribute('data-mmbg'); }) === 'ivory', '저장 후 다시 열어도 유지');
    // 단색 · 흰 종이 · 칠판
    for (var k of ['plain', 'white', 'slate']) {
      await page.click('[data-menu="mmBgMenu"]'); await wait(120);
      await page.click('#mmBgMenu [data-v="' + k + '"]'); await wait(200);
      await page.mouse.click(5, 5); await wait(80);
      await page.screenshot({ path: path.join(SHOT, 'bg-' + k + '.png') });
    }
    check(await page.evaluate(function () { return _mmSheet().bg; }) === 'slate', '칠판');
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
