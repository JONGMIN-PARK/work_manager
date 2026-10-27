// XMind 내보내기 — 내보내기 메뉴 → .xmind(zip: content.json · metadata · manifest) → 다시 가져오기 왕복 (v13.241)
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
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id; });
    await wait(500);
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmNewTpl');
    await page.select('#mmNewTpl', 'wbs');
    await page.type('#mmNewTitle', '내보내기 시험');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await page.evaluate(function () {
      _mmMutate(function () {
        var a = _mmRoot().children[0];
        a.markers = ['priority-1', 'star']; a.progress = 75; a.note = '메모'; a.assigneeId = currentUser.id;
        _mmSheet().relations = [{ id: 'r1', from: a.id, to: _mmRoot().children[1].id, label: '다음' }];
      });
      // 내려받기를 가로채 blob 을 잡아 둔다
      window.__dl = null;
      window._mmDownload = function (name, blob) { window.__dl = { name: name, blob: blob }; };
    });
    await page.click('[data-menu="mmExportMenu"]'); await wait(120);
    await page.click('#mmExportMenu [data-act="export-xmind"]');
    await page.waitForFunction(function () { return !!window.__dl; }, { timeout: 8000 });
    var res = await page.evaluate(function () {
      var dl = window.__dl;
      return JSZip.loadAsync(dl.blob).then(function (zip) {
        var names = Object.keys(zip.files).sort();
        return zip.file('content.json').async('string').then(function (t) {
          var file = new File([dl.blob], dl.name);
          return mmReadImportFile(file).then(function (imp) {
            var a = imp.doc.sheets[0].root.children[0];
            return { name: dl.name, names: names, json: JSON.parse(t), root: imp.doc.sheets[0].root.text, kids: imp.doc.sheets[0].root.children.length, a: a, rel: imp.doc.sheets[0].relations.length };
          });
        });
      });
    });
    check(res.name === '내보내기 시험.xmind', '파일 이름 ' + res.name);
    check(res.names.join() === 'content.json,manifest.json,metadata.json', 'zip 구성 ' + res.names.join());
    check(res.json[0].rootTopic.title === '내보내기 시험' && res.json[0].rootTopic.structureClass === 'org.xmind.ui.logic.right', 'content.json 루트 · 구조(WBS 틀 = 논리도)');
    check(res.kids === 5 && res.root === '내보내기 시험', '다시 가져오기 — 주제 수');
    check(res.a.markers.join() === 'priority-1,star' && res.a.progress === 75 && res.a.note === '메모' && res.a.labels.join() === '담당 관리자', '마커 · 진척 · 노트 · 담당(라벨) ' + JSON.stringify([res.a.markers, res.a.progress, res.a.labels]));
    check(res.rel === 1, '관계선');
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
