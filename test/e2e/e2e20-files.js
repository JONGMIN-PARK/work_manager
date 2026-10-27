// 마인드맵 첨부 파일 — API 권한 · 크기 제한 · 패널 올리기/내려받기/지우기 · 주제에 끌어다 놓기 · 📎 표시 (v13.244)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var B = 'http://localhost:3000';
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function login(email) {
  var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) });
  return (await r.json()).data.accessToken;
}
function api(tok) {
  return async function (method, url, body) {
    var r = await fetch(B + url, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
    var j = null; try { j = await r.json(); } catch (_) {}
    return { s: r.status, d: j };
  };
}
(async function () {
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  // ── API ──
  var A = api(await login('admin@t.com')), L = api(await login('lee@t.com'));
  var leeId = (await L('GET', '/api/auth/me')).d.data.id;
  var m = (await A('POST', '/api/mindmaps', { title: '첨부 API', scope: 'personal' })).d.data;
  var U = '/api/mindmaps/' + m.id;
  var up = await A('POST', U + '/files', { nodeId: 'n1', name: '견적서.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 hello').toString('base64') });
  check(up.s === 201 && up.d.data.size === 14 && up.d.data.name === '견적서.pdf', '올리기 ' + up.s);
  check((await A('POST', U + '/files', { nodeId: 'n1', name: 'big.bin', data: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') })).s === 400, '5MB 넘으면 400');
  check((await L('GET', U + '/files')).s === 404, '공유 안 된 사람 404');
  await A('PUT', U, { version: m.version, viewers: [leeId] });
  var g = await L('GET', U + '/files/' + up.d.data.id);
  check(g.s === 200 && Buffer.from(g.d.data.data, 'base64').toString() === '%PDF-1.4 hello', '보기 공유 → 내려받기');
  check((await L('POST', U + '/files', { nodeId: 'n1', name: 'x.txt', data: 'eA==' })).s === 403, '보기 공유 → 올리기 403');
  check((await L('DELETE', U + '/files/' + up.d.data.id)).s === 403, '보기 공유 → 지우기 403');
  check((await A('DELETE', U + '/files/' + up.d.data.id)).s === 200 && (await A('GET', U + '/files')).d.data.length === 0, '편집 권한 → 지우기');

  // ── 화면 ──
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  try {
    await page.setViewport({ width: 1500, height: 900 });
    await page.goto(B + '/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id; });
    await wait(500);
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmNewTpl');
    await page.type('#mmNewTitle', '첨부');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    var a = await page.evaluate(function () { _mmMutate(function () { _mmRoot().children = [mmNewNode('설계')]; }); _mmFit(); return _mmRoot().children[0].id; });
    await wait(200);
    // 패널 [＋ 파일] (파일 고르기)
    await page.click('#mmStage .mm-node[data-id="' + a + '"] .mm-txt'); await wait(200);
    var tmp = path.join(require('os').tmpdir(), '도면 메모.txt');
    require('fs').writeFileSync(tmp, '치수 확인 필요');
    var [chooser] = await Promise.all([page.waitForFileChooser(), page.click('#mmPnFiles [data-file-act="add"]')]);
    await chooser.accept([tmp]);
    await page.waitForFunction(function () { return document.querySelectorAll('#mmPnFiles .mm-file').length === 1; }, { timeout: 8000 });
    check(await page.evaluate(function (id) { var b = document.querySelector('#mmStage .mm-node[data-id="' + id + '"] .mm-filebadge'); return b && b.textContent; }, a) === '📎1', '패널에서 올리기 → 📎1');
    // 주제에 끌어다 놓기 (이미지가 아닌 파일 → 첨부)
    await page.evaluate(function (id) {
      var el = document.querySelector('#mmStage .mm-node[data-id="' + id + '"]');
      var r = el.getBoundingClientRect();
      var dt = new DataTransfer();
      dt.items.add(new File(['a,b\n1,2'], '측정값.csv', { type: 'text/csv' }));
      ['dragover', 'drop'].forEach(function (t) {
        _mmEl('mmCanvas').dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 10, clientY: r.top + 10 }));
      });
    }, a);
    await page.waitForFunction(function () { return (_mm.files || []).length === 2; }, { timeout: 8000 });
    await wait(200);
    check(await page.evaluate(function (id) { return document.querySelector('#mmStage .mm-node[data-id="' + id + '"] .mm-filebadge').textContent; }, a) === '📎2', '끌어다 놓기 → 📎2');
    // 내려받기 (가로채서 내용 확인)
    var got = await page.evaluate(function () {
      return new Promise(function (resolve) {
        window._mmDownload = function (name, blob) { blob.text().then(function (t) { resolve(name + '|' + t); }); };
        document.querySelector('#mmPnFiles [data-file-act="get"]').click();
      });
    });
    check(got === '도면 메모.txt|치수 확인 필요', '내려받기 ' + got);
    await page.screenshot({ path: path.join(SHOT, 'files.png') });
    // 지우기
    await page.click('#mmPnFiles [data-file-act="del"]');
    await page.waitForFunction(function () { return (_mm.files || []).length === 1; }, { timeout: 8000 });
    check(true, '지우기');
  } catch (e) { fail++; console.log('ERR', e.message); } finally { await browser.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, '[]');
  process.exit(0);
})().catch(function (e) { console.log('ERR', e.message); process.exit(1); });
