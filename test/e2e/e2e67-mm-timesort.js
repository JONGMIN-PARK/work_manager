// 마인드맵 타임라인 시간 순 정렬 — 날짜 넣으면 자동 · 되돌리기 · 자동 끄기 · 손으로 정렬 · 구조 바꿀 때 (v13.324)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function order() { return page.evaluate(function () { return _mmRoot().children.map(function (c) { return c.text; }).join(','); }); }
  async function setDate(text, field, v) {
    await page.evaluate(function (text) { _mm.sel = _mmRoot().children.filter(function (c) { return c.text === text; })[0].id; _mmPaint(); _mmPaintPanel(); }, text);
    await wait(150);
    await page.evaluate(function (field, v) { var el = document.getElementById(field); el.value = v; el.dispatchEvent(new Event('change')); }, field, v);
    await wait(200);
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
    await page.type('#mmNewTitle', '시간 순 정렬 확인');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await page.select('#mmStructure', 'timeline'); await wait(300);
    await page.evaluate(function () {
      _mmMutate(function () { _mmRoot().children = ['가', '나', '다', '메모'].map(function (t) { return mmNewNode(t); }); });
    });
    await setDate('가', 'mmPnStart', '2026-05-01');
    check(await order() === '가,나,다,메모', '날짜 하나뿐이면 그대로');
    await setDate('다', 'mmPnStart', '2026-02-01');
    check(await order() === '다,나,가,메모', '날짜 넣으면 자동 정렬 (날짜 없는 나 · 메모는 제자리) — ' + await order());
    await setDate('나', 'mmPnDue', '2026-03-15');
    check(await order() === '다,나,가,메모', '마감만 있는 주제도 그 날짜로 — ' + await order());
    await setDate('가', 'mmPnStart', '2026-01-01');
    check(await order() === '가,다,나,메모', '날짜 바꾸면 다시 정렬 — ' + await order());
    await page.evaluate(function () { mmUndo(); }); await wait(200);
    check(await order() === '다,나,가,메모', '되돌리기는 날짜 · 순서 함께 — ' + await order());
    // 손으로 옮긴 순서는 날짜를 안 바꾸면 그대로
    await page.evaluate(function () { _mmMutate(function () { var k = _mmRoot().children; k.push(k.shift()); }); }); await wait(150);
    check(await order() === '나,가,메모,다', '끌어서 옮긴 순서는 유지 — ' + await order());
    // 정렬 메뉴: 손으로 정렬
    await page.click('[data-menu="mmAlignMenu"], #mmAlignMenu').catch(function () {});
    await page.evaluate(function () { _mmPaintAlignMenu(); });
    check(await page.evaluate(function () { return !!document.querySelector('#mmAlignMenu [data-cmd="timeSort"]') && !!document.querySelector('#mmAlignMenu [data-cmd="timeSortAuto"]'); }), '정렬 메뉴에 시간 순 정렬 · 자동 켜기');
    await page.evaluate(function () { document.querySelector('#mmAlignMenu [data-cmd="timeSort"]').click(); }); await wait(200);
    check(await order() === '다,나,메모,가', '손으로 시간 순 정렬 — ' + await order());
    // 자동 끄기
    await page.evaluate(function () { mmRunCommand('timeSortAuto'); }); await wait(150);
    check(await page.evaluate(function () { return _mmSheet().timeSort === false; }), '자동 정렬 끄기');
    await setDate('나', 'mmPnDue', '2025-01-01');
    check(await order() === '다,나,메모,가', '끄면 날짜 바꿔도 그대로 — ' + await order());
    await page.evaluate(function () { mmRunCommand('timeSortAuto'); }); await wait(150);
    check(await order() === '나,다,메모,가', '다시 켜면 바로 정렬 — ' + await order());
    // 다른 구조에선 자동 안 함, 타임라인으로 바꾸면 정렬
    await page.select('#mmStructure', 'balanced'); await wait(200);
    await setDate('가', 'mmPnStart', '2024-01-01');
    check(await order() === '나,다,메모,가', '마인드맵 구조는 자동 정렬 안 함');
    await page.select('#mmStructure', 'timeline'); await wait(200);
    check(await order() === '가,나,메모,다', '타임라인으로 바꾸면 정렬 — ' + await order());
    // 저장 후에도
    await page.evaluate(function () { return _mmSaveNow(); }); await wait(400);
    var mapId = await page.evaluate(function () { return _mm.mapId; });
    await page.evaluate(function (id) { mmOpen(id); }, mapId);
    await page.waitForFunction(function () { return _mm.doc && document.querySelector('#mmStage .mm-root'); }); await wait(300);
    check(await order() === '가,나,메모,다', '저장 후 다시 열어도 순서 유지');
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message, errs); } finally { await browser.close(); }
})();
