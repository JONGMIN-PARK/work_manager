// 마인드맵 발표 모드 — 개요 → 주요 주제 장면 · 키로 넘기기 · 장면 밖 흐리게 · 끝내면 원래대로 (v13.242)
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
  function st() {
    return page.evaluate(function () {
      var info = document.getElementById('mmPitchInfo');
      return { info: info ? info.textContent : null, zoom: _mm.zoom, off: document.querySelectorAll('#mmStage .mm-pitch-off').length, pitch: !!_mm.pitch,
        top: getComputedStyle(document.querySelector('.mm-top')).display };
    });
  }
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
    await page.type('#mmNewTitle', '발표');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(300);
    var z0 = await page.evaluate(function () { return [_mm.zoom, _mm.panX, _mm.panY]; });
    check(!(await page.$('.mm-top > [data-act="pitch"]')), '발표 단추는 더보기 메뉴 안');
    await page.click('[data-menu="mmMoreMenu"]'); await wait(120);
    await page.click('#mmMoreMenu [data-act="pitch"]');
    await wait(800);
    var s1 = await st();
    check(s1.pitch && /^1 \/ 6/.test(s1.info) && s1.off === 0 && s1.top === 'none', '시작 — 1/6 개요 · 도구 숨김 ' + JSON.stringify(s1));
    await page.keyboard.press('ArrowRight'); await wait(700);
    var s2 = await st();
    check(/^2 \/ 6 기획 · 사양/.test(s2.info) && s2.zoom > s1.zoom && s2.off > 0, '→ 2/6 첫 주요 주제 확대 · 나머지 흐림 ' + JSON.stringify(s2));
    await page.screenshot({ path: path.join(SHOT, 'pitch.png') });
    await page.keyboard.press('End'); await wait(600);
    check(/^6 \/ 6/.test((await st()).info), 'End → 마지막');
    await page.keyboard.press('ArrowRight'); await wait(300);
    check(/^6 \/ 6/.test((await st()).info), '마지막에서 → 그대로');
    await page.click('#mmPitchHud [data-pitch="prev"]'); await wait(600);
    check(/^5 \/ 6/.test((await st()).info), '◀ 단추');
    await page.keyboard.press('Escape'); await wait(400);
    var s3 = await st();
    var z1 = await page.evaluate(function () { return [_mm.zoom, _mm.panX, _mm.panY]; });
    check(!s3.pitch && s3.info === null && s3.off === 0 && s3.top !== 'none', 'Esc → 끝, 도구 다시 보임');
    check(JSON.stringify(z0) === JSON.stringify(z1), '원래 확대 · 위치로');
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
