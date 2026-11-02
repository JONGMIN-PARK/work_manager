// 무거운 라이브러리 나중에 받기 (v13.310) — 첫 화면엔 없음 · 바로 눌러도 받고 나서 실행 · 한가할 때 뒤에서 모두 받음 · 문서 미리보기도
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0, heavyAtStart = [];
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var loggedIn = false;
  page.on('request', function (r) { if (!loggedIn && /xlsx\.full|mammoth|jspdf|pdf\.min|html2canvas|jszip/.test(r.url())) heavyAtStart.push(r.url().split('/').pop()); });
  try {
    await page.setViewport({ width: 1400, height: 900 });
    var cdp = await page.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: require('os').tmpdir() }).catch(function () {});
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    check(heavyAtStart.length === 0, '첫 화면(로그인 전)에 무거운 라이브러리 없음 ' + JSON.stringify(heavyAtStart));
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    loggedIn = true;
    // 1) 한가할 때 받기 전에 바로 엑셀 내보내기 → 받고 나서 실행
    var r1 = await page.evaluate(function () {
      var before = typeof XLSX !== 'undefined';
      var wrote = null; var done;
      var p = new Promise(function (res) { done = res; });
      var orig = null;
      (function hook() {
        if (typeof XLSX === 'undefined') return setTimeout(hook, 30);
        orig = XLSX.writeFile; XLSX.writeFile = function (wb, name) { wrote = name; XLSX.writeFile = orig; done(); };
      })();
      setPage('project'); setMode('issues');
      exportIssueExcel();
      return Promise.race([p, new Promise(function (r) { setTimeout(r, 15000); })]).then(function () { return { before: before, wrote: wrote }; });
    });
    check(r1.before === false && /^이슈대장_.*\.xlsx$/.test(r1.wrote || ''), '안 받은 상태에서 엑셀 내보내기 → 받고 나서 파일 만듦 ' + JSON.stringify(r1));
    // 2) 한가할 때 나머지도
    await page.waitForFunction(function () { return typeof JSZip !== 'undefined' && typeof html2canvas !== 'undefined' && typeof pdfjsLib !== 'undefined' && !!window.jspdf && typeof mammoth !== 'undefined'; }, { timeout: 30000 }).catch(function () {});
    var r2 = await page.evaluate(function () { return { jszip: typeof JSZip, h2c: typeof html2canvas, pdf: typeof pdfjsLib, jspdf: !!window.jspdf, mam: typeof mammoth, worker: pdfjsLib && pdfjsLib.GlobalWorkerOptions.workerSrc }; });
    check(r2.jszip === 'function' && r2.h2c === 'function' && r2.pdf === 'object' && r2.jspdf && r2.mam === 'object', '첫 화면 뒤 한가할 때 나머지 받아 둠 ' + JSON.stringify(r2));
    check(/pdf\.worker\.min\.js$/.test(r2.worker || ''), 'PDF 미리보기 일꾼 주소 설정');
    // 3) wmLibRetry — 이미 있으면 바로 실행(false), 같은 라이브러리를 두 번 받지 않음
    var r3 = await page.evaluate(function () { var n = 0; var res = wmLibRetry('xlsx', function () { n++; }, null, []); return { res: res, scripts: document.querySelectorAll('script[src*="xlsx.full"]').length }; });
    check(r3.res === false && r3.scripts === 1, '이미 있으면 바로 · 스크립트는 한 번만 ' + JSON.stringify(r3));
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack);
  }
  await browser.close();
  console.log(fail ? ('FAILED ' + fail + ' / ' + (ok + fail)) : ('ALL PASS (' + ok + ')'));
  process.exit(fail ? 1 : 0);
})();
