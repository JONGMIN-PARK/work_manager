// 마인드맵 → 주간 업무 보고 문장 — 지난 기록과 비교 · 구분 · 업로드용 이름 (v13.236)
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
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setViewport({ width: 1500, height: 950 });
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
    await page.type('#mmNewTitle', '주간 현황');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    // 지난주 상태 → 저장 → 기록
    await page.evaluate(function () {
      _mmMutate(function () {
        var r = _mmRoot();
        var a = mmNewNode('TSE');
        var t1 = mmNewNode('기능 개발\n-. 드릴 + 커팅'); t1.id = 'T1'; t1.assigneeId = currentUser.id; t1.progress = 30; t1.dueDate = '2026-12-05';
        var d1 = mmNewNode('A1 검증'); d1.id = 'D1'; t1.children = [d1];
        a.children = [t1];
        var b = mmNewNode('[SDC] 글라스 챔퍼링'); b.id = 'M2'; b.children = [mmNewNode('대구경 셋업')];
        r.children = [a, b];
      });
    });
    await page.evaluate(function () { return _mmSaveNow(); }); await wait(600);
    var snap = await page.evaluate(function () { return apiFetch('/api/mindmaps/' + _mm.mapId + '/snapshots', { method: 'POST', body: JSON.stringify({ label: '지난주' }) }).then(function (r) { return r.data && r.data.id; }); });
    check(!!snap, '기록 저장');
    // 이번 주: 진척 오름 · 완료 · 새 작업
    await page.evaluate(function () {
      _mmMutate(function () {
        var t1 = mmFind(_mmRoot(), 'T1').node; t1.progress = 70;
        mmFind(_mmRoot(), 'D1').node.done = true;
        var m2 = mmFind(_mmRoot(), 'M2').node; var n = mmNewNode('비전 QC'); n.dueDate = '2026-01-05'; n.assigneeName = '외주'; m2.children.push(n);
      });
    });
    await page.click('[data-menu="mmExportMenu"]'); await wait(120);
    await page.click('#mmExportMenu [data-act="weekly-report"]');
    await page.waitForSelector('#mmWeeklyModal');
    await page.waitForFunction(function () { return /지난 기록 이후 변화/.test((document.getElementById('mmWrDiff') || {}).textContent || ''); }, { timeout: 8000 });
    var st = await page.evaluate(function () {
      var g = {}; document.querySelectorAll('#mmWrDiff .mm-wr-g').forEach(function (d) { g[d.querySelector('summary').childNodes[0].textContent.trim()] = d.querySelector('b').textContent; });
      return { cur: _mmEl('mmWrCur').value, last: _mmEl('mmWrLast').value, g: g, name: _mmEl('mmWrName').textContent, snapSel: _mmEl('mmWrSnap').value };
    });
    console.log(st.cur);
    check(/^\[개발\]/.test(st.cur) && /- \[TSE\] 기능 개발 ~12\/05 70% @관리자 #진행중/.test(st.cur), '이번 주 항목 줄');
    check(/  : 드릴 \+ 커팅/.test(st.cur) && /  : A1 검증 #완료/.test(st.cur), '세부 줄');
    check(/- \[SDC\] 글라스 챔퍼링 비전 QC ~01\/05 @외주/.test(st.cur), '[사이트] 앞머리 · 담당 직접 입력');
    check(/30%/.test(st.last) && !/비전 QC/.test(st.last), '지난주 문장은 기록 기준');
    check(st.g['완료'] === '1' && st.g['진척 오름'] === '1' && st.g['새 작업'] === '1' && st.g['지연'] === '1', '변화 ' + JSON.stringify(st.g));
    check(/_\d\dW\d\d_\d\d\/\d\d~\d\d\/\d\d_R1$/.test(st.name) && st.snapSel === snap, '업로드 이름 ' + st.name);
    // 구분 바꾸기 → [셋업]
    await page.evaluate(function () { var s = document.querySelector('#mmWeeklyModal [data-wr-main="M2"]'); s.value = 'setup'; s.onchange(); });
    await wait(300);
    var cur2 = await page.evaluate(function () { return _mmEl('mmWrCur').value; });
    check(/\[셋업\]\n- \[SDC\]/.test(cur2), '구분 바꾸기');
    await page.screenshot({ path: path.join(SHOT, 'weekly.png') });
    // 다시 열어도 구분 기억
    await page.keyboard.press('Escape'); await wait(200);
    await page.evaluate(function () { mmRunCommand('weeklyReport'); });
    await page.waitForSelector('#mmWeeklyModal');
    await wait(300);
    check(await page.evaluate(function () { return document.querySelector('#mmWeeklyModal [data-wr-main="M2"]').value; }) === 'setup', '구분 기억');
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
