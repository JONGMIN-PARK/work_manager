// 마인드맵 진행률 막대 · 하위 평균(반영 개수) · 담당 직접 입력 (v13.228~230)
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
  function check(c, m) { if (c) ok++; else { fail++; console.log('FAIL', m); } }
  try {
    await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
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
    await page.type('#mmNewTitle', '진행률');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await page.select('#mmStructure', 'right');
    var ids = await page.evaluate(function () {
      _mmMutate(function () {
        var r = _mmRoot();
        var a = mmNewNode('LOTCES'); var b = mmNewNode('기능 개발'); b.assigneeId = currentUser.id;
        var c1 = mmNewNode('A1 검증'); c1.progress = 80; var c2 = mmNewNode('이니셜 프로세스'); c2.done = true; var c3 = mmNewNode('레시피');
        b.children = [c1, c2, c3]; a.children = [b];
        var d = mmNewNode('[SDC] 글라스 챔퍼링'); d.progress = 30; d.children = [mmNewNode('대구경 셋업')];
        r.children = [a, d];
      });
      _mmFit();
      var r = _mmRoot(); return { a: r.children[0].id, b: r.children[0].children[0].id, c3: r.children[0].children[0].children[2].id, d: r.children[1].id };
    });
    await wait(300);
    var t = await page.evaluate(function (ids) {
      function pg(id) { var e = document.querySelector('#mmStage .mm-node[data-id="' + id + '"] .mm-pg b'); return e ? e.textContent : null; }
      function cnt(id) { var e = document.querySelector('#mmStage .mm-node[data-id="' + id + '"] .mm-pg-cnt'); return e ? e.textContent : null; }
      return { a: pg(ids.a), b: pg(ids.b), d: pg(ids.d), c3: pg(ids.c3), bc: cnt(ids.b), ac: cnt(ids.a), who: document.querySelector('#mmStage .mm-node[data-id="' + ids.b + '"] .mm-meta').textContent };
    }, ids);
    check(t.b === '90%', 'b rollup ' + t.b); check(t.a === '90%', 'a ' + t.a); check(t.d === '30%', 'd ' + t.d); check(t.c3 === null, 'c3 none'); check(t.bc === '2/3', 'b count ' + t.bc); check(t.ac === null, 'a full count ' + t.ac);
    check(/관리자/.test(t.who), 'member name ' + t.who);
    // 담당 직접 입력
    await page.screenshot({ path: path.join(SHOT, 'prog-cnt.png'), clip: { x: 500, y: 380, width: 520, height: 320 } });
    await page.click('#mmStage .mm-node[data-id="' + ids.c3 + '"] .mm-txt'); await wait(200);
    await page.click('#mmPnAssignee', { clickCount: 3 }); await page.type('#mmPnAssignee', '외주 김기사'); await page.keyboard.press('Tab'); await wait(300);
    var n3 = await page.evaluate(function (id) { var n = mmFind(_mmRoot(), id).node; return { id: n.assigneeId || null, nm: n.assigneeName || null, meta: (document.querySelector('#mmStage .mm-node[data-id="' + id + '"] .mm-meta') || {}).textContent }; }, ids.c3);
    check(n3.nm === '외주 김기사' && !n3.id && /외주 김기사/.test(n3.meta), 'free name ' + JSON.stringify(n3));
    // 목록 이름 입력 → 사용자 id
    var mname = await page.evaluate(function () { return (_mm.members || [])[0] && _mm.members[0].name; });
    await page.click('#mmPnAssignee', { clickCount: 3 }); await page.type('#mmPnAssignee', mname); await page.keyboard.press('Tab'); await wait(300);
    n3 = await page.evaluate(function (id) { var n = mmFind(_mmRoot(), id).node; return { id: n.assigneeId || null, nm: n.assigneeName || null }; }, ids.c3);
    check(n3.id && !n3.nm, 'member pick ' + JSON.stringify(n3));
    // 진행률 빠른 단추 50 → 부모 평균 (80+100+50)/3=77
    await page.click('.mm-pg-quick [data-v="50"]'); await wait(300);
    var bb2 = await page.evaluate(function (id) { return document.querySelector('#mmStage .mm-node[data-id="' + id + '"] .mm-pg b').textContent; }, ids.b);
    check(bb2 === '77%', 'after quick ' + bb2);
    check(await page.evaluate(function (id) { return !document.querySelector('#mmStage .mm-node[data-id="' + id + '"] .mm-pg-cnt'); }, ids.b), 'count gone when all filled');  // (80 + 100 + 50) / 3
    await page.click('.mm-pg-quick [data-v="0"]'); await wait(300);
    var z = await page.evaluate(function (id) { return mmFind(_mmRoot(), id).node.progress; }, ids.c3);
    check(z === 0, 'zero kept ' + z);
    await page.screenshot({ path: path.join(SHOT, 'prog.png') });
    var pn = await (await page.$('.mm-panel')).boundingBox();
    var row = await (await page.$('#mmPnProg')).boundingBox();
    await page.screenshot({ path: path.join(SHOT, 'prog-panel.png'), clip: { x: pn.x, y: row.y - 140, width: pn.width, height: 220 } });
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log(e.message); } finally { await browser.close(); }
})();
