// 마인드맵 색 테마 · 글자 서식(굵게 · 크기) · 서식 복사/붙여넣기 (v13.240)
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
    await page.type('#mmNewTitle', '테마');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    var ids = await page.evaluate(function () { var r = _mmRoot(); return { a: r.children[0].id, b: r.children[1].id, c: r.children[2].id, a1: r.children[0].children[0].id }; });
    function mc(id) { return page.evaluate(function (id) { return document.querySelector('#mmStage .mm-node[data-id="' + id + '"]').style.getPropertyValue('--mm-c'); }, id); }
    await page.click('[data-menu="mmBgMenu"]'); await wait(120);
    check(await page.evaluate(function () { return document.querySelectorAll('#mmBgMenu .mm-thsw').length; }) === 6, '테마 6종');
    await page.click('#mmBgMenu [data-v="vivid"]'); await wait(200);
    check((await mc(ids.a)) === '#2563EB' && (await mc(ids.b)) === '#16A34A' && (await mc(ids.a1)) === '#2563EB', '선명 테마 — 가지 색 · 하위는 물려받음');
    check(await page.evaluate(function () { return _mmSheet().theme; }) === 'vivid', '시트에 저장');
    // 직접 고른 색이 테마보다 먼저
    await page.evaluate(function (id) { _mmSelect(id); _mmSetProp('color', 'slate'); }, ids.b); await wait(150);
    check((await mc(ids.b)) === '#64748B', '직접 고른 색 우선');
    // 굵게 · 크게 → 서식 복사 → 다른 두 주제에 붙여넣기
    await page.evaluate(function (id) { _mmSelect(id); }, ids.b);
    await page.click('#mmPanel [data-act="bold"]'); await wait(100);
    await page.click('#mmPanel [data-act="fs"][data-v="l"]'); await wait(100);
    var b = await page.evaluate(function (id) { var n = mmFind(_mmRoot(), id).node; var el = document.querySelector('#mmStage .mm-node[data-id="' + id + '"]'); return { bold: n.bold, fs: n.fs, cls: el.className }; }, ids.b);
    check(b.bold === true && b.fs === 'l' && /mm-bold/.test(b.cls) && /mm-fs-l/.test(b.cls), '굵게 · 크게');
    await page.evaluate(function () { mmRunCommand('copyStyle'); });
    await page.evaluate(function (ids) { _mm.multi = [ids.a, ids.c]; _mm.sel = ids.a; _mmPaintMulti(); mmRunCommand('pasteStyle'); }, ids); await wait(150);
    var pasted = await page.evaluate(function (ids) { return [ids.a, ids.c].map(function (id) { var n = mmFind(_mmRoot(), id).node; return [n.color, n.bold, n.fs].join(','); }); }, ids);
    check(pasted.join('|') === 'slate,true,l|slate,true,l', '서식 붙여넣기 (여러 주제) ' + pasted.join('|'));
    await page.evaluate(function () { mmUndo(); }); await wait(100);
    check(await page.evaluate(function (id) { var n = mmFind(_mmRoot(), id).node; return !n.color && !n.bold; }, ids.a), '되돌리기');
    await page.evaluate(function () { mmRedo(); _mm.multi = []; _mmPaint(); }); await wait(100);
    await page.screenshot({ path: path.join(SHOT, 'theme.png') });
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
