// 마인드맵 보기 거르기 — 담당자별 · 지연 · 이번 주 마감 · 진행률 미입력 · 완료 흐리게 (v13.233)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function ds(k) { var d = new Date(); d.setDate(d.getDate() + k); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
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
    await page.type('#mmNewTitle', '거르기');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await page.select('#mmStructure', 'right');
    var hidden0 = await page.evaluate(function () { return _mmEl('mmFbar').classList.contains('hidden'); });
    check(hidden0, '작업이 없으면 막대 숨김');
    var D = { late: ds(-3), week: ds(2), far: ds(30) };
    var ids = await page.evaluate(function (D) {
      _mmMutate(function () {
        var r = _mmRoot();
        var a = mmNewNode('TSE'); a.assigneeId = currentUser.id;
        var a1 = mmNewNode('드릴'); a1.assigneeId = currentUser.id; a1.dueDate = D.late; a1.progress = 40;
        var a2 = mmNewNode('해치'); a2.assigneeName = '외주'; a2.dueDate = D.week;
        var a3 = mmNewNode('리페어'); a3.assigneeName = '외주'; a3.done = true;
        a.children = [a1, a2, a3];
        var b = mmNewNode('대덕'); b.collapsed = true;
        var b1 = mmNewNode('연동'); b1.assigneeName = '외주'; b1.dueDate = D.late;
        b.children = [b1];
        r.children = [a, b];
      });
      _mmFit();
      var r = _mmRoot(); return { a: r.children[0].id, a1: r.children[0].children[0].id, a2: r.children[0].children[1].id, a3: r.children[0].children[2].id, b: r.children[1].id, b1: r.children[1].children[0].id };
    }, D);
    await wait(200);
    var chips = await page.evaluate(function () { var o = {}; document.querySelectorAll('#mmFbar [data-vf-st]').forEach(function (b) { o[b.getAttribute('data-vf-st')] = b.querySelector('b').textContent; }); return o; });
    check(chips.late === '2' && chips.week === '1' && chips.noprog === '2', '칩 숫자 ' + JSON.stringify(chips));   // 지연 a1 · b1, 미입력 a2 · b1
    // 지연 → 첫 주제 선택 · 나머지 흐림
    await page.click('#mmFbar [data-vf-st="late"]'); await wait(250);
    var s1 = await page.evaluate(function (ids) {
      function dim(id) { var e = document.querySelector('#mmStage .mm-node[data-id="' + id + '"]'); return e ? e.classList.contains('mm-dim') : 'none'; }
      return { sel: _mm.sel, a1: dim(ids.a1), a2: dim(ids.a2), a: dim(ids.a), cnt: document.querySelector('.mm-fcount').textContent };
    }, ids);
    check(s1.sel === ids.a1 && s1.a1 === false && s1.a2 === true && s1.a === false, '지연: 첫 주제 선택 · 다른 것 흐림 · 위 단계 또렷 ' + JSON.stringify(s1));
    // 다시 누르면 다음 (접힌 대덕 펼쳐짐)
    await page.click('#mmFbar [data-vf-st="late"]'); await wait(250);
    var s2 = await page.evaluate(function (ids) { return { sel: _mm.sel, open: !mmFind(_mmRoot(), ids.b).node.collapsed, cnt: document.querySelector('.mm-fcount').textContent }; }, ids);
    check(s2.sel === ids.b1 && s2.open && s2.cnt === '2/2개', '다시 누르면 다음 · 접힌 곳 펼침 ' + JSON.stringify(s2));
    // 사람별 목록 → 외주
    await page.click('#mmFbar [data-vf-act="people"]'); await wait(150);
    var rows = await page.evaluate(function () { return Array.from(document.querySelectorAll('#mmFpeople .mm-fp-row')).map(function (r) { return r.textContent; }); });
    check(rows.length === 3 && /외주3건/.test(rows.join('|')) && /지연 1/.test(rows.join('|')), '사람별 목록 ' + JSON.stringify(rows));
    await page.screenshot({ path: path.join(SHOT, 'filter-people.png') });
    await page.evaluate(function () { document.querySelector('#mmFpeople [data-vf-who="외주"]').click(); }); await wait(250);
    var s3 = await page.evaluate(function () { var o = {}; document.querySelectorAll('#mmFbar [data-vf-st]').forEach(function (b) { o[b.getAttribute('data-vf-st')] = b.querySelector('b').textContent; }); return { chips: o, hits: _mm.vfHits.length, who: _mm.vf.who }; });
    check(s3.who === '외주' && s3.hits === 1 && s3.chips.late === '1', '담당 외주 + 지연 함께 ' + JSON.stringify(s3));   // b1
    // 지우기 → 흐림 없음
    await page.click('#mmFbar [data-vf-act="clear"]'); await wait(200);
    var dimN = await page.evaluate(function () { return document.querySelectorAll('#mmStage .mm-dim').length; });
    check(dimN === 0, '거르기 끄기');
    // 완료 흐리게
    await page.click('#mmFbar [data-vf-act="dimdone"]'); await wait(200);
    var dd = await page.evaluate(function (ids) { return document.querySelector('#mmStage .mm-node[data-id="' + ids.a3 + '"]').classList.contains('mm-dim') && !document.querySelector('#mmStage .mm-node[data-id="' + ids.a2 + '"]').classList.contains('mm-dim'); }, ids);
    check(dd, '완료 흐리게');
    await page.click('#mmFbar [data-vf-st="noprog"]'); await wait(250);
    await page.screenshot({ path: path.join(SHOT, 'filter.png') });
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
