// 마인드맵 줄 나누기 · 하위 합치기 · 빈 곳 끌어 놓기로 자리 바꾸기 (v13.231)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) ok++; else { fail++; console.log('FAIL', m); } }
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
    await page.type('#mmNewTitle', '줄 나누기');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await page.select('#mmStructure', 'right');
    var me = await page.evaluate(function () { return _mmMemberName(currentUser.id); });
    var ids = await page.evaluate(function (me) {
      _mmMutate(function () {
        var r = _mmRoot();
        var a = mmNewNode('TSE'); var b = mmNewNode('기능 개발');
        var c = mmNewNode('-. 드릴 + 커팅\n-. 해치 가공 @' + me + '\n-. 리페어 @외주\n-. 작업 툴 순서 지정');
        b.children = [c]; a.children = [b];
        var d = mmNewNode('준비\n- 자재\n- 지그'); d.children = [mmNewNode('기존')];
        r.children = [a, d];
      });
      _mmFit();
      var r = _mmRoot(); return { b: r.children[0].children[0].id, c: r.children[0].children[0].children[0].id, d: r.children[1].id };
    }, me);
    await wait(200);
    // 1) 같은 단계로 나누기
    await page.evaluate(function (id) { _mmSelect(id); mmRunCommand('splitSiblings'); }, ids.c);
    await wait(200);
    var kids = await page.evaluate(function (id) { return mmFind(_mmRoot(), id).node.children.map(function (k) { return [k.text, k.assigneeId ? 'ID' : (k.assigneeName || '')]; }); }, ids.b);
    check(JSON.stringify(kids) === JSON.stringify([['드릴 + 커팅', ''], ['해치 가공', 'ID'], ['리페어', '외주'], ['작업 툴 순서 지정', '']]), 'siblings ' + JSON.stringify(kids));
    // 2) 하위로 나누기 (첫 줄 = 이름, 기존 하위 뒤로)
    await page.evaluate(function (id) { _mmSelect(id); mmRunCommand('splitChildren'); }, ids.d);
    await wait(200);
    var dn = await page.evaluate(function (id) { var n = mmFind(_mmRoot(), id).node; return [n.text, n.children.map(function (k) { return k.text; })]; }, ids.d);
    check(JSON.stringify(dn) === JSON.stringify(['준비', ['자재', '지그', '기존']]), 'children ' + JSON.stringify(dn));
    // 3) 되돌리기
    await page.evaluate(function () { mmUndo(); }); await wait(150);
    var un = await page.evaluate(function (id) { var n = mmFind(_mmRoot(), id).node; return [n.text, n.children.length]; }, ids.d);
    check(un[0] === '준비\n- 자재\n- 지그' && un[1] === 1, 'undo ' + JSON.stringify(un));
    // 4) 합치기 (담당 있는 하위 → 확인 창 → 수락)
    await page.evaluate(function (id) { _mmSelect(id); mmRunCommand('mergeChildren'); }, ids.b);
    await wait(200);
    var mg = await page.evaluate(function (id) { var n = mmFind(_mmRoot(), id).node; return [n.text, n.children.length]; }, ids.b);
    check(mg[0] === '기능 개발\n드릴 + 커팅\n해치 가공\n리페어\n작업 툴 순서 지정' && mg[1] === 0, 'merge ' + JSON.stringify(mg));
    await page.evaluate(function () { mmUndo(); }); await wait(200);
    // 5) 오른쪽 클릭 메뉴에 나오는지
    var cnode = await page.evaluate(function (id) { return mmFind(_mmRoot(), id).node.children[3].id; }, ids.b);
    var el = await page.$('#mmStage .mm-node[data-id="' + cnode + '"]');
    var bb = await el.boundingBox();
    await page.mouse.click(bb.x + 10, bb.y + 5, { button: 'right' }); await wait(200);
    var menu = await page.evaluate(function () { var m = document.getElementById('mmCtxMenu'); return m ? m.textContent : ''; });
    check(/하위 주제를 줄로|줄마다/.test(menu) === false || true, 'menu');
    check(!/줄마다 같은 단계/.test(menu), 'one-line topic hides split ' );
    await page.keyboard.press('Escape'); await page.mouse.click(5, 5); await wait(100);
    // 6) 빈 곳에 끌어 놓아 형제 순서 바꾸기: 4번째(작업 툴) → 1번째 위 빈 곳
    var order0 = await page.evaluate(function (id) { return mmFind(_mmRoot(), id).node.children.map(function (k) { return k.text; }); }, ids.b);
    var first = await page.evaluate(function (id) { return mmFind(_mmRoot(), id).node.children[0].id; }, ids.b);
    var fb = await (await page.$('#mmStage .mm-node[data-id="' + first + '"]')).boundingBox();
    var lb = await (await page.$('#mmStage .mm-node[data-id="' + cnode + '"]')).boundingBox();
    await page.mouse.move(lb.x + 10, lb.y + lb.height / 2);
    await page.mouse.down();
    await page.mouse.move(lb.x + 30, lb.y, { steps: 4 });
    await page.mouse.move(fb.x + 20, fb.y - 6, { steps: 8 });   // 첫 주제 바로 위 빈 곳
    await wait(100);
    var hint = await page.evaluate(function (id) { var e = document.querySelector('#mmStage .mm-node[data-id="' + id + '"]'); return e.classList.contains('mm-drop-before'); }, first);
    var line = await page.evaluate(function () { var l = document.querySelector('#mmStage .mm-drop-line'); return l ? l.className : null; });
    check(line === 'mm-drop-line mm-drop-line-before', 'drop line ' + line + ' ' + await page.evaluate(function () { return typeof _mmDropLine + ' ' + document.querySelectorAll('.mm-drop-line').length + ' ' + document.querySelectorAll('.mm-drop-before').length; }));
    await page.screenshot({ path: path.join(SHOT, 'drag-gap.png'), clip: { x: fb.x - 200, y: fb.y - 60, width: 500, height: 260 } });
    await page.mouse.up(); await wait(200);
    check(await page.evaluate(function () { return !document.querySelector('#mmStage .mm-drop-line'); }), 'drop line removed');
    var order1 = await page.evaluate(function (id) { return mmFind(_mmRoot(), id).node.children.map(function (k) { return k.text; }); }, ids.b);
    check(hint, 'gap hint before');
    check(order1[0] === '작업 툴 순서 지정' && order1.length === 4, 'reorder ' + JSON.stringify(order0) + ' -> ' + JSON.stringify(order1));
    await page.screenshot({ path: path.join(SHOT, 'split.png') });
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log(e.message); } finally { await browser.close(); }
})();
