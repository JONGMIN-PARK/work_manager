// 마인드맵 주제 댓글 화면 — 패널에서 쓰기 · 💬 개수 · 해결 · 다시 열어도 유지 · 지워진 주제의 댓글 (v13.237)
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
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function badge(id) { return page.evaluate(function (id) { var b = document.querySelector('#mmStage .mm-node[data-id="' + id + '"] .mm-cmt'); return b ? b.textContent : null; }, id); }
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
    await page.type('#mmNewTitle', '댓글');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    var ids = await page.evaluate(function () {
      _mmMutate(function () { var r = _mmRoot(); r.children = [mmNewNode('기능 개발'), mmNewNode('지울 주제')]; });
      _mmFit();
      return { a: _mmRoot().children[0].id, b: _mmRoot().children[1].id, mapId: _mm.mapId };
    });
    await page.evaluate(function () { return _mmSaveNow(); }); await wait(400);
    await page.click('#mmStage .mm-node[data-id="' + ids.a + '"] .mm-txt'); await wait(200);
    check(await page.evaluate(function () { return !!document.getElementById('mmPnCmt') && !!document.getElementById('mmCmtIn'); }), '패널에 댓글 칸');
    await page.click('#mmCmtIn');
    await page.type('#mmCmtIn', '다음 주까지 가능할까요? @김팀원');
    await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
    await page.waitForFunction(function () { return document.querySelectorAll('#mmPnCmt .mm-cmt-item').length === 1; }, { timeout: 5000 });
    check((await badge(ids.a)) === '💬1', '주제에 💬1');
    check(await page.evaluate(function () { return document.querySelector('#mmPnCmt .mm-cmt-at').textContent === '@김팀원' && document.getElementById('mmCmtIn').value === ''; }), '@이름 강조 · 입력칸 비움');
    await page.screenshot({ path: path.join(SHOT, 'comments.png') });
    // 💬 마우스 올리면 미리보기 (v13.306) — 잠깐 머물러야 뜨고, 벗어나면 닫힘, 글자는 막힌 HTML
    await page.evaluate(function () { _mm.comments.push({ id: 'x-tip', node_id: _mm.comments[0].node_id, body: '<img src=x onerror=alert(1)> 두번째', resolved: false, created_at: new Date().toISOString(), author_name: '<b>홍</b>' }); });
    await page.mouse.move(5, 5); await wait(100);
    var nb = await page.evaluate(function (id) { var r = document.querySelector('#mmStage .mm-node[data-id="' + id + '"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, right: r.right }; }, ids.a);
    await page.mouse.move(nb.x, nb.y); await wait(120);
    check(!(await page.$('#mmCmtTip')), '바로는 안 뜸 (잠깐 머물러야)');
    await wait(450);
    var tip = await page.evaluate(function () {
      var t = document.getElementById('mmCmtTip'); if (!t) return null;
      var r = t.getBoundingClientRect();
      return { h: t.querySelector('.mm-tip-h').textContent, n: t.querySelectorAll('.mm-tip-i').length, first: t.querySelector('.mm-tip-b').textContent, img: !!t.querySelector('img'), boldName: !!t.querySelector('.mm-tip-a b b'), left: r.left, inView: r.right <= innerWidth && r.bottom <= innerHeight };
    });
    check(tip && /댓글 2/.test(tip.h) && tip.n === 2, '미리보기 — 댓글 2개 ' + JSON.stringify(tip));
    check(tip && !tip.img && !tip.boldName && tip.first.indexOf('<img') >= 0, '미리보기 글은 막힌 HTML · 최신이 먼저');
    check(tip && tip.left >= nb.right && tip.inView, '주제 오른쪽 · 화면 안');
    await page.mouse.move(5, 5); await wait(150);
    check(!(await page.$('#mmCmtTip')), '벗어나면 닫힘');
    await page.evaluate(function () { _mm.comments = _mm.comments.filter(function (c) { return c.id !== 'x-tip'; }); _mmPaint(); });
    // 지울 주제에 댓글 → 주제 삭제 → 중심 주제 패널에 모음
    await page.click('#mmStage .mm-node[data-id="' + ids.b + '"] .mm-txt'); await wait(200);
    await page.type('#mmCmtIn', '이건 빼죠');
    await page.click('#mmPnCmt [data-cmt-act="send"]');
    await page.waitForFunction(function () { return document.querySelectorAll('#mmPnCmt .mm-cmt-item').length === 1; }, { timeout: 5000 });
    // 해결 → 💬 사라짐
    await page.click('#mmStage .mm-node[data-id="' + ids.a + '"] .mm-txt'); await wait(200);
    await page.click('#mmPnCmt [data-cmt-act="resolve"]');
    await page.waitForFunction(function () { return !!document.querySelector('#mmPnCmt .mm-cmt-done'); }, { timeout: 5000 });
    check((await badge(ids.a)) === null, '해결 → 💬 사라짐');
    await page.evaluate(function (id) { _mmSelect(id); mmRunCommand('delete'); }, ids.b); await wait(200);
    await page.evaluate(function () { _mmSelect(_mmRoot().id); }); await wait(200);
    check(await page.evaluate(function () { var d = document.querySelector('#mmPnCmt .mm-cmt-orphan summary'); return d ? d.textContent : ''; }) === '지워진 주제의 댓글 1', '지워진 주제의 댓글 모음');
    // 다시 열어도 유지
    await page.evaluate(function () { return _mmSaveNow(); }); await wait(300);
    await page.evaluate(function (id) { mmOpen(id); }, ids.mapId);
    await page.waitForFunction(function () { return _mm.comments && _mm.comments.length === 2; }, { timeout: 8000 });
    check(true, '다시 열면 댓글 2개 불러옴');
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
