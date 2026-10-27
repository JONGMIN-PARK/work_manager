// 주제 입력칸 폭 E2E — 실행: node e2e5.js
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
var ok = 0, errs = [];
function check(name, cond, extra) { if (!cond) throw new Error('FAIL: ' + name + ' ' + JSON.stringify(extra === undefined ? '' : extra)); ok++; console.log('✔', name); }
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  try {
    await page.setViewport({ width: 1500, height: 900 });
    page.on('pageerror', function (e) { errs.push(e.message); });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com');
    await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id; });
    await wait(500);
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmNewTitle');
    await page.type('#mmNewTitle', '입력칸 테스트');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(300);
    await page.click('#mmStage .mm-root');
    await page.keyboard.press('Tab');
    await page.waitForSelector('#mmCanvas textarea.mm-inline');
    var w0 = await page.$eval('#mmCanvas textarea.mm-inline', function (t) { return t.offsetWidth; });
    check('입력칸 최소 폭 260px', w0 >= 260, w0);
    await page.keyboard.type('아주 긴 하위 주제 이름을 입력해서 입력칸이 글자만큼 넓어지는지 확인합니다');
    var w1 = await page.$eval('#mmCanvas textarea.mm-inline', function (t) { return t.offsetWidth; });
    check('쓰는 만큼 넓어짐 (480px 까지)', w1 > w0 && w1 <= 480, [w0, w1]);
    var fs = await page.$eval('#mmCanvas textarea.mm-inline', function (t) { return getComputedStyle(t).fontSize; });
    check('글씨 크기는 주제와 같게 (주요 주제 13.5px)', fs === '13.5px', fs);
    await page.screenshot({ path: path.join(SHOT, '6-inline-wide.png') });
    await page.keyboard.press('Enter');
    await wait(150);
    // 왼쪽 가지: 오른쪽 끝 고정
    await page.evaluate(function () { _mmMutate(function () { _mmRoot().children[0].side = 'left'; }); });
    await wait(150);
    var id = await page.evaluate(function () { return _mmRoot().children[0].id; });
    await page.click('#mmStage .mm-node[data-id="' + id + '"] .mm-txt');
    await page.keyboard.press('F2');
    await page.waitForSelector('#mmCanvas textarea.mm-inline');
    var r = await page.evaluate(function (id) {
      var ta = document.querySelector('#mmCanvas textarea.mm-inline').getBoundingClientRect();
      var el = document.querySelector('#mmStage .mm-node[data-id="' + id + '"]').getBoundingClientRect();
      return { taR: Math.round(ta.right), elR: Math.round(el.right) };
    }, id);
    check('왼쪽 가지는 오른쪽 끝을 맞춰 왼쪽으로 넓어짐', Math.abs(r.taR - r.elR) <= 2, r);
    await page.keyboard.press('Escape');
    check('측정용 요소 정리', (await page.$$('.mm-inline-meas')).length === 0);
    console.log('\nALL PASS', ok);
  } catch (e) {
    console.log(e.message); process.exitCode = 1;
  } finally {
    if (errs.length) console.log('PAGE ERRORS:\n' + errs.join('\n'));
    await browser.close();
  }
})();
