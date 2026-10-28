// 큰 맵 성능 — 주제 1,000 · 3,000개에서 그리기 · 고치기 · 고르기 · 거르기 · 저장 시간을 재고, 상한을 넘으면 실패
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
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
    await page.type('#mmNewTitle', '큰 맵');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    // [주제 수, 그리기 상한 ms] — 상한은 느린 PC 를 생각해 넉넉히
    for (var c of [[1000, 1500], [3000, 4500]]) {
      var r = await page.evaluate(function (N) {
        // 1단계 10개 × 2단계 10개 × 나머지 3단계 (담당 · 진행률 · 마감 섞음)
        var root = _mmRoot(), made = 0, per = Math.ceil((N - 110) / 100);
        root.children = [];
        for (var i = 0; i < 10; i++) {
          var a = mmNewNode('분야 ' + i); root.children.push(a); made++;
          for (var j = 0; j < 10; j++) {
            var b = mmNewNode('작업 ' + i + '-' + j + ' 조금 긴 이름'); a.children.push(b); made++;
            for (var k = 0; k < per && made < N; k++) {
              var d = mmNewNode('세부 ' + k); made++;
              if (k % 3 === 0) d.progress = (k * 7) % 100;
              if (k % 4 === 0) d.dueDate = '2026-11-0' + (1 + k % 9);
              if (k % 5 === 0) d.assigneeName = '담당' + (k % 3);
              b.children.push(d);
            }
          }
        }
        function t(fn) { var s = performance.now(); fn(); return Math.round(performance.now() - s); }
        var paint = t(function () { _mmPaint(); });
        var paint2 = t(function () { _mmPaint(); });
        var target = root.children[5].children[5].children[0];
        var edit = t(function () { _mmMutate(function () { target.text = '바뀐 이름'; }); });
        var sel = t(function () { _mmSelect(target.id); });
        var snap = _mmSnapshot().length;
        return { n: document.querySelectorAll('#mmStage .mm-node').length, paint: paint, paint2: paint2, edit: edit, sel: sel, kb: Math.round(snap / 1024) };
      }, c[0]);
      // 저장 (서버 왕복 포함)
      var save = await page.evaluate(function () { var s = performance.now(); _mm.dirty = true; return _mmSaveNow().then(function () { return Math.round(performance.now() - s); }); });
      // 거르기 — 담당자 하나로
      var flt = await page.evaluate(function () {
        var s = performance.now();
        _mmVf().who = '담당1'; _mmPaint();
        var ms = Math.round(performance.now() - s);
        _mmVf().who = null; _mmPaint();
        return ms;
      });
      console.log('  주제 ' + r.n + ' · 그리기 ' + r.paint + 'ms(다시 ' + r.paint2 + ') · 고치기 ' + r.edit + 'ms · 고르기 ' + r.sel + 'ms · 거르기 ' + flt + 'ms · 저장 ' + save + 'ms · 문서 ' + r.kb + 'KB');
      check(r.n >= c[0] && r.paint2 < c[1] && r.edit < c[1] * 1.3, c[0] + '개 — 그리기 · 고치기 ' + c[1] + 'ms 안');
      check(r.sel < 100, c[0] + '개 — 고르기 100ms 안');
      check(save < 3000, c[0] + '개 — 저장 3초 안');
    }
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
