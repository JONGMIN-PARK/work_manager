// 떠있는 주제 — 빈 곳 더블클릭으로 만들기 · 연결선 없음 · 끌어 옮기기 · 다른 주제에 놓으면 붙음 · 저장 후 유지 (v13.246)
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
    await page.type('#mmNewTitle', '떠있는');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await page.evaluate(function () { _mmMutate(function () { _mmRoot().children = [mmNewNode('가'), mmNewNode('나')]; }); _mmFit(); });
    await wait(200);
    var cvb = await (await page.$('#mmCanvas')).boundingBox();
    // 빈 곳 더블클릭 → 떠있는 주제 + 이름 입력
    await page.mouse.click(cvb.x + 180, cvb.y + 120, { clickCount: 2 });
    await page.waitForSelector('#mmCanvas textarea.mm-inline', { timeout: 5000 });
    await page.keyboard.type('메모 아이디어');
    await page.keyboard.press('Enter');
    await wait(300);
    var f = await page.evaluate(function () {
      var n = _mmRoot().children.filter(function (c) { return c.float; })[0];
      if (!n) return null;
      var el = document.querySelector('#mmStage .mm-node[data-id="' + n.id + '"]');
      return { id: n.id, text: n.text, fx: n.float.x, fy: n.float.y, cls: el.className, edge: !!document.querySelector('#mmEdges [data-e="' + n.id + '"]') };
    });
    check(f && f.text === '메모 아이디어' && /mm-float/.test(f.cls), '더블클릭 → 떠있는 주제 ' + JSON.stringify(f));
    check(f && !f.edge, '중심과 연결선 없음');
    // 끌어서 옮기기
    var el = await page.$('#mmStage .mm-node[data-id="' + f.id + '"]');
    var bb = await el.boundingBox();
    await page.mouse.move(bb.x + 10, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + 40, bb.y + bb.height / 2 + 20, { steps: 4 });
    await page.mouse.move(bb.x + 110, bb.y + bb.height / 2 + 70, { steps: 6 });
    await page.mouse.up();
    await wait(300);
    var moved = await page.evaluate(function (id) { var n = mmFind(_mmRoot(), id).node; return n.float; }, f.id);
    var z = await page.evaluate(function () { return _mm.zoom; });
    check(moved && Math.abs(moved.x - (f.fx + 100 / z)) <= 2 && Math.abs(moved.y - (f.fy + 70 / z)) <= 2, '끌어서 옮김 ' + JSON.stringify(moved));
    await page.screenshot({ path: path.join(SHOT, 'floating.png') });
    // 저장 → 다시 열기
    var mapId = await page.evaluate(function () { return _mm.mapId; });
    await page.evaluate(function () { return _mmSaveNow(); }); await wait(500);
    await page.evaluate(function (id) { mmOpen(id); }, mapId);
    await page.waitForFunction(function () { return _mm.doc && document.querySelector('#mmStage .mm-root'); });
    await wait(300);
    check(await page.evaluate(function (id) { var n = mmFind(_mmRoot(), id); return !!(n && n.node.float && document.querySelector('#mmStage .mm-node.mm-float[data-id="' + id + '"]')); }, f.id), '저장 후 다시 열어도 유지');
    // 다른 주제 위에 놓으면 붙음
    var ga = await page.evaluate(function () { return _mmRoot().children[0].id; });
    el = await page.$('#mmStage .mm-node[data-id="' + f.id + '"]'); bb = await el.boundingBox();
    var tb = await (await page.$('#mmStage .mm-node[data-id="' + ga + '"]')).boundingBox();
    await page.mouse.move(bb.x + 10, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + 30, bb.y + 20, { steps: 3 });
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 10 });
    await page.mouse.up();
    await wait(300);
    var at = await page.evaluate(function (ids) { var r = mmFind(_mmRoot(), ids.f); return { parent: r.parent.id, float: !!r.node.float, edge: !!document.querySelector('#mmEdges [data-e="' + ids.f + '"]') }; }, { f: f.id });
    check(at.parent === ga && !at.float && at.edge, '다른 주제 위에 놓으면 하위로 붙음 · 선 생김');
    // 명령으로 다시 떠 있게
    await page.evaluate(function (id) { _mmSelect(id); mmRunCommand('toggleFloat'); }, f.id); await wait(200);
    check(await page.evaluate(function (id) { var r = mmFind(_mmRoot(), id); return r.parent === _mmRoot() && !!r.node.float; }, f.id), '떠 있게 하기 명령');
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
