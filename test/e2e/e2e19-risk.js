// 마인드맵 리스크 점검 — 거르기 막대 [🩺 점검] → 종류별 목록 · 누르면 그 주제로 · AI 의견(응답 흉내) (v13.243)
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
  var aiBody = null;
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    if (req.method() === 'POST' && /\/api\/mindmaps\/ai$/.test(req.url())) {
      aiBody = JSON.parse(req.postData() || '{}');
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { summary: '조립 지연이 출하를 막고 있습니다', risks: [{ title: '조립 지연', why: '조립이 5일 늦음', action: '외주 인력 추가' }] } }) });
    }
    req.continue();
  });
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
    await page.type('#mmNewTitle', '점검');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    var ids = await page.evaluate(function (D) {
      _mmMutate(function () {
        var r = _mmRoot();
        var a = mmNewNode('제작'); a.collapsed = true;
        var a1 = mmNewNode('조립'); a1.assigneeName = '외주'; a1.dueDate = D.late; a1.progress = 50;
        var a2 = mmNewNode('배선'); a2.dueDate = D.next;
        a.children = [a1, a2];
        r.children = [a];
      });
      _mm.aiReady = true;
      _mmFit();
      return { a1: _mmRoot().children[0].children[0].id, a2: _mmRoot().children[0].children[1].id };
    }, { late: ds(-5), next: ds(10) });
    await wait(200);
    await page.click('#mmFbar [data-vf-act="risk"]');
    await page.waitForSelector('#mmRiskModal .mm-risk-g', { timeout: 8000 });
    var g = await page.evaluate(function () {
      var o = {}; document.querySelectorAll('#mmRiskModal .mm-risk-g summary').forEach(function (s) { o[s.childNodes[0].textContent.trim()] = s.querySelector('b').textContent; }); return o;
    });
    check(g['지연'] === '1' && g['담당 없음'] === '1', '종류별 ' + JSON.stringify(g));
    await page.click('#mmRiskModal [data-risk-node="' + ids.a1 + '"]'); await wait(250);
    var sel = await page.evaluate(function (id) { return { sel: _mm.sel, open: !_mmRoot().children[0].collapsed, shown: !!document.querySelector('#mmStage .mm-node[data-id="' + id + '"]') }; }, ids.a1);
    check(sel.sel === ids.a1 && sel.open && sel.shown, '누르면 그 주제 선택 · 접힌 가지 펼침');
    check(await page.evaluate(function () { return !document.getElementById('mmRiskModal'); }), '창 닫힘');
    await page.click('#mmFbar [data-vf-act="risk"]');
    await page.waitForSelector('#mmRiskAi', { timeout: 8000 });
    await page.click('#mmRiskAi');
    await page.waitForFunction(function () { return /조립 지연/.test((document.getElementById('mmRiskAiOut') || {}).textContent || ''); }, { timeout: 8000 });
    check(aiBody && aiBody.action === 'risk' && /\[지연\] 조립/.test(aiBody.findings) && /제작/.test(aiBody.outline), 'AI 요청에 점검 결과 · 맵 개요');
    check(await page.evaluate(function () { return /외주 인력 추가/.test(document.getElementById('mmRiskAiOut').textContent); }), 'AI 의견 표시');
    await page.screenshot({ path: path.join(SHOT, 'risk.png') });
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
