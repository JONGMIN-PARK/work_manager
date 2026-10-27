// 같은 단계 맞춤 · 글자 정렬 E2E — 실행: node e2e4.js
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var ok = 0, errs = [];
function check(name, cond, extra) { if (!cond) throw new Error('FAIL: ' + name + ' ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 1200)); ok++; console.log('✔', name); }
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
    await page.waitForSelector('#mmNewTpl');
    await page.select('#mmNewTpl', 'wbs');
    await page.type('#mmNewTitle', '정렬 테스트');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(300);
    // 한 주제를 길게
    await page.evaluate(function () { _mmMutate(function () { _mmRoot().children[1].text = '설계 — 기구 · 전장 · SW 상세 검토'; _mmRoot().children[1].children[0].text = '기구 설계 (프레임 · 커버 · 치구)'; }); });
    var cols = function () {
      return page.evaluate(function () {
        var P = _mm.layout.pos, r = _mmRoot(), out = { d1: [], d2: [] };
        r.children.forEach(function (c) { out.d1.push([P[c.id].x, P[c.id].w]); (c.children || []).forEach(function (g) { out.d2.push([P[g.id].x, P[g.id].w]); }); });
        return out;
      });
    };
    var before = await cols();
    check('맞춤 전: 2단계 x 가 들쭉날쭉', new Set(before.d2.map(function (x) { return x[0]; })).size > 1);
    await page.screenshot({ path: path.join(SHOT, '1-before.png') });
    // Alt+G (중심 주제 선택) → 맵 전체
    await page.click('#mmStage .mm-root');
    await page.keyboard.down('Alt'); await page.keyboard.press('KeyG'); await page.keyboard.up('Alt');
    await wait(250);
    var after = await cols();
    var same = function (arr, i) { return new Set(arr.map(function (x) { return Math.round(x[i]); })).size === 1; };
    check('Alt+G 맵 전체: 1단계 x·폭 같음', same(after.d1, 0) && same(after.d1, 1), after.d1);
    check('2단계(하위)도 x·폭 같음', same(after.d2, 0) && same(after.d2, 1), after.d2);
    check('폭은 가장 넓은 주제 기준', Math.round(after.d2[0][1]) === Math.max.apply(null, before.d2.map(function (x) { return Math.round(x[1]); })), [after.d2[0][1], before.d2]);
    check('DOM 폭 반영', await page.evaluate(function () { var c = _mmRoot().children[0]; var el = document.querySelector('#mmStage .mm-node[data-id="' + c.id + '"]'); return Math.abs(el.offsetWidth - _mm.layout.pos[c.id].w) < 1; }));
    await page.screenshot({ path: path.join(SHOT, '2-aligned-right.png') });
    // 글자 정렬 메뉴 → 오른쪽
    await page.click('[data-act="menu"][data-menu="mmAlignMenu"]');
    await page.waitForSelector('#mmAlignMenu [data-cmd="textAlign:right"]');
    check('정렬 메뉴: 맵 전체 ✓', /✓맵 전체/.test(await page.$eval('#mmAlignMenu', function (e) { return e.textContent; })));
    await page.click('#mmAlignMenu [data-cmd="textAlign:right"]');
    await wait(150);
    check('글자 오른쪽 정렬', await page.evaluate(function () { var el = document.querySelector('#mmStage .mm-node.mm-main'); return getComputedStyle(el).textAlign === 'right' && getComputedStyle(el.querySelector('.mm-line')).justifyContent === 'flex-end'; }));
    // 마인드맵(좌우) + 자동 정렬: 왼쪽 가지는 오른쪽 정렬
    await page.select('#mmStructure', 'balanced');
    await page.evaluate(function () { mmRunCommand('textAlign:auto'); });
    await wait(250);
    var al = await page.evaluate(function () {
      var o = {}; document.querySelectorAll('#mmStage .mm-node.mm-main').forEach(function (el) { o[el.getAttribute('data-side')] = getComputedStyle(el).textAlign; }); return o;
    });
    check('자동: 오른쪽 가지 왼쪽 정렬 · 왼쪽 가지 오른쪽 정렬', al.right === 'left' && al.left === 'right', al);
    var lr = await page.evaluate(function () {
      var P = _mm.layout.pos, L = [], R = [];
      _mmRoot().children.forEach(function (c) { (P[c.id].side === 'left' ? L : R).push(P[c.id]); });
      return { L: L.map(function (p) { return [Math.round(p.x + p.w), Math.round(p.w)]; }), R: R.map(function (p) { return [Math.round(p.x), Math.round(p.w)]; }) };
    });
    check('좌우 따로 열 맞춤', new Set(lr.L.map(function (x) { return x.join(); })).size === 1 && new Set(lr.R.map(function (x) { return x.join(); })).size === 1, lr);
    await page.screenshot({ path: path.join(SHOT, '3-balanced-auto.png') });
    // 조직도: 같은 줄 높이도 맞춤
    await page.select('#mmStructure', 'down');
    await wait(250);
    var rows = await page.evaluate(function () { var P = _mm.layout.pos; return _mmRoot().children.map(function (c) { return [P[c.id].y, P[c.id].h, P[c.id].w]; }); });
    check('조직도: 같은 줄 y·높이·폭 같음', new Set(rows.map(function (r) { return r.join(); })).size === 1, rows);
    await page.screenshot({ path: path.join(SHOT, '4-down.png') });
    // 맵 전체 끄고 → 한 가지만
    await page.click('#mmStage .mm-root');
    await page.keyboard.down('Alt'); await page.keyboard.press('KeyG'); await page.keyboard.up('Alt');
    await page.select('#mmStructure', 'right');
    await wait(200);
    var br = await page.evaluate(function () { return _mmRoot().children[1].id; });
    await page.click('#mmStage .mm-node[data-id="' + br + '"] .mm-txt');
    await page.click('#mmPnAlign');
    await wait(200);
    var part = await page.evaluate(function () {
      var P = _mm.layout.pos, r = _mmRoot();
      return { mine: r.children[1].children.map(function (g) { return Math.round(P[g.id].w); }), other: r.children[2].children.map(function (g) { return Math.round(P[g.id].w); }) };
    });
    check('패널 "하위 같은 단계 맞춤" → 그 가지만', new Set(part.mine).size === 1 && new Set(part.other).size > 1, part);
    await page.screenshot({ path: path.join(SHOT, '5-branch.png') });
    // 저장 유지
    await page.waitForFunction(function () { return !_mm.dirty && !_mm.saving; }, { timeout: 10000 });
    var doc = await page.evaluate(function () { return apiFetch('/api/mindmaps/' + _mm.mapId).then(function (r) { return r.data.doc.sheets[0]; }); });
    check('저장: alignLevels · textAlign', doc.root.children[1].alignLevels === true && !doc.root.alignLevels && !doc.textAlign, { a: doc.root.children[1].alignLevels, t: doc.textAlign });
    console.log('\nALL PASS', ok);
  } catch (e) {
    console.log(e.message);
    try { await page.screenshot({ path: path.join(SHOT, 'fail.png') }); } catch (_) {}
    process.exitCode = 1;
  } finally {
    if (errs.length) console.log('PAGE ERRORS:\n' + errs.join('\n'));
    await browser.close();
  }
})();
