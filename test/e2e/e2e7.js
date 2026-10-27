// 접기 버튼이 주제 글자와 겹치지 않는지 — 실행: node e2e7.js
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
var ok = 0;
function check(name, cond, extra) { if (!cond) throw new Error('FAIL: ' + name + ' ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 800)); ok++; console.log('✔', name); }
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  try {
    await page.setViewport({ width: 1500, height: 900 });
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
    await page.type('#mmNewTitle', '접기 버튼 확인');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(300);
    // 하위 주제에도 하위를 하나 달아 접기 버튼이 생기게
    await page.evaluate(function () { _mmMutate(function () { var a = _mmRoot().children[1].children[0]; a.children.push(mmNewNode('프레임 상세')); }); });
    for (var st of ['right', 'balanced', 'down']) {
      await page.select('#mmStructure', st);
      await wait(250);
      var bad = await page.evaluate(function () {
        var out = [];
        document.querySelectorAll('#mmStage .mm-node').forEach(function (el) {
          var f = el.querySelector(':scope > .mm-fold');
          if (!f || el.style.display === 'none') return;
          var a = el.getBoundingClientRect(), b = f.getBoundingClientRect();
          // 접기 버튼이 주제 칸 안으로 들어오면 겹침
          var inter = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          if (inter > 0) out.push(el.textContent.slice(0, 10));
          // 다른 주제와도 겹치면 안 됨
          document.querySelectorAll('#mmStage .mm-node').forEach(function (o) {
            if (o === el || o.style.display === 'none') return;
            var c = o.getBoundingClientRect();
            if (b.left < c.right && c.left < b.right && b.top < c.bottom && c.top < b.bottom) out.push('→' + o.textContent.slice(0, 10));
          });
        });
        return out;
      });
      check(st + ': 접기 버튼이 글자·다른 주제와 겹치지 않음', bad.length === 0, bad);
      await page.screenshot({ path: path.join(SHOT, '8-fold-' + st + '.png') });
    }
    console.log('\nALL PASS', ok);
  } catch (e) { console.log(e.message); process.exitCode = 1; } finally { await browser.close(); }
})();
