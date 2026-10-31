// 프로젝트 상세 패널 탭 정리 (v13.290) — 순서 · 개수 · 개요 전용 아래 부분 · 마지막 탭 기억 · 폭은 ⋯ 안
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var SHOTS = path.join(__dirname, '.shots');
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function ready() {
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
  }
  var cnt = function () { return page.evaluate(function () { var o = {}; document.querySelectorAll('#projDetailPanel [data-pd-n]').forEach(function (e) { o[e.dataset.pdN] = e.textContent; }); return o; }); };
  var made = { issue: null, dev: null };
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { localStorage.removeItem('wm-last-view'); localStorage.removeItem('pd-last-tab'); } catch (e) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await ready();
    // 이슈 1(미해결) · 개발 2(1개 완료) 를 단 프로젝트 하나
    var pid = await page.evaluate(function () {
      return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'E2E 탭 개수 ' + Date.now(), orderNo: 'TAB-' + Date.now() }) }).then(function (r) { return r.data.id; });
    });
    made.issue = await page.evaluate(function (pid) { return issuePut({ projectId: pid, title: 'E2E 탭 이슈', status: 'open' }).then(function (x) { return x && x.id; }); }, pid);
    await page.evaluate(function (pid) { return devItemCreate({ projectId: pid, title: 'E2E 개발 A' }).then(function () { return devItemCreate({ projectId: pid, title: 'E2E 개발 B' }); }).then(function (b) { return devItemMove(b.id, 'done'); }); }, pid).catch(function () {});
    await page.evaluate(function () { setPage('project'); setMode('pipeline'); });
    await page.evaluate(function (pid) { return showProjectDetail(pid); }, pid); await wait(1500);

    var order = await page.$$eval('#projDetailPanel .pd-tab', function (a) { return a.map(function (b) { return b.id.replace('pdTab', '') + ':' + b.childNodes[1].textContent; }).join(','); });
    check(order === 'Overview:개요,Lifecycle:단계,Issues:이슈,Dev:개발,Meeting:회의,Work:투입,Spec:사양', '탭 순서 · 이름 ' + order);
    var c0 = await cnt();
    check(c0.issues === '1' && c0.dev === '1' && c0.meeting === '' && c0.lifecycle !== undefined, '탭 개수 — 이슈 미해결 1 · 개발 미완료 1 · 회의 0은 숨김 ' + JSON.stringify(c0));
    var head = await page.evaluate(function () { var h = document.querySelector('#projDetailPanel .pd-sticky'); return { sizeOut: !!h.querySelector('.pd-size:not(.pd-more-menu .pd-size)'), sizeIn: !!h.querySelector('.pd-more-menu .pd-size [data-pd-size]'), gen: Array.from(document.querySelectorAll('#projDetailPanel button')).filter(function (b) { return /^📋 체크리스트 생성$/.test(b.textContent.trim()); }).length }; });
    check(!head.sizeOut && head.sizeIn && head.gen === 0, '폭 버튼은 ⋯ 안 · 겹치던 [체크리스트 생성] 없음 ' + JSON.stringify(head));
    await page.screenshot({ path: path.join(SHOTS, 'pd-tabs-overview.png'), clip: { x: 924, y: 0, width: 476, height: 900 } });
    // ⋯ › 패널 폭
    await page.click('#projDetailPanel .pd-more > button'); await wait(150);
    await page.click('#projDetailPanel .pd-more-menu [data-pd-size="0.5"]'); await wait(200);
    var w = await page.evaluate(function () { return Math.round(document.getElementById('projDetailPanel').getBoundingClientRect().width); });
    check(w === 700, '⋯ › 패널 폭 보통 → 700px ' + w);
    await page.evaluate(function () { pdSetPanelSize(0.34); pdCloseMore(); });

    // 아래 부분(진척 히스토리 · 코멘트 · 맵)은 개요에만
    var foot = function () { return page.evaluate(function () { var f = document.getElementById('pdOvFoot'); return f && f.style.display !== 'none' && !!f.querySelector('#pdCommentsSection'); }); };
    check(await foot(), '개요 — 아래 부분 보임');
    await page.click('#pdTabDev'); await wait(1200);
    check(!(await foot()) && await page.evaluate(function () { return document.getElementById('pdTabDev').classList.contains('on'); }), '개발 탭 — 아래 부분 숨김 · 탭 표시');
    var addRow = await page.evaluate(function () { var r = document.querySelector('#pdDev .pd-dev-add'); return r && Math.round(r.getBoundingClientRect().height); });
    check(addRow && addRow < 40, '개발 추가 칸 한 줄 ' + addRow + 'px');
    await page.screenshot({ path: path.join(SHOTS, 'pd-tabs-dev.png'), clip: { x: 924, y: 0, width: 476, height: 500 } });
    // 개발 추가 → 개수 바로
    await page.type('#pdDevTitle', 'E2E 개발 C'); await page.keyboard.press('Enter'); await wait(1500);
    check((await cnt()).dev === '2', '개발 추가 → 탭 개수 2');

    // 마지막 탭 기억 — 닫고 다시 열면 개발 탭
    await page.evaluate(function () { pdCloseDetail(); });
    await page.evaluate(function (pid) { return showProjectDetail(pid); }, pid); await wait(1500);
    var re = await page.evaluate(function () { return { on: document.querySelector('#projDetailPanel .pd-tab.on').id, dev: document.getElementById('pdDev').style.display !== 'none', loaded: !/로딩 중/.test(document.getElementById('pdDev').textContent) }; });
    check(re.on === 'pdTabDev' && re.dev && re.loaded, '다시 열면 마지막 탭(개발) ' + JSON.stringify(re));
    // 다른 곳에서 탭을 지정해 열면 그 탭 (타임라인 · 알림 경로)
    await page.evaluate(function (pid) { pdCloseDetail(); return showProjectDetail(pid).then(function () { pdSwitchTab('lifecycle'); }); }, pid); await wait(500);
    check(await page.evaluate(function () { return document.getElementById('pdTabLifecycle').classList.contains('on') && document.getElementById('pdLifecycle').style.display !== 'none'; }), '지정 탭(단계)으로 열기 — projId 없이도');
    await page.click('#pdTabOverview'); await wait(300);

    // 좁은 패널 · 휴대폰 — 탭 줄 한 줄
    var tb = await page.evaluate(function () { var t = document.querySelector('#projDetailPanel .pd-tabs'); return { h: Math.round(t.getBoundingClientRect().height), sw: t.scrollWidth, cw: t.clientWidth }; });
    check(tb.h < 40 && tb.sw <= tb.cw + 1, '좁은 패널 — 탭 한 줄 · 7개 다 보임 ' + JSON.stringify(tb));
    await page.evaluate(function () { pdCloseDetail(); });
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true }); await wait(300); await ready();
    await page.evaluate(function (pid) { setPage('project'); return showProjectDetail(pid); }, pid); await wait(1500);
    var ph = await page.evaluate(function () { var p = document.getElementById('projDetailPanel').getBoundingClientRect(), t = document.querySelector('#projDetailPanel .pd-tabs').getBoundingClientRect(); return { pw: Math.round(p.width), th: Math.round(t.height), over: document.documentElement.scrollWidth > innerWidth + 1 }; });
    check(ph.pw === 402 && ph.th < 40 && !ph.over, '휴대폰 — 화면 전체 · 탭 한 줄 ' + JSON.stringify(ph));
    await page.screenshot({ path: path.join(SHOTS, 'pd-tabs-phone.png'), clip: { x: 0, y: 0, width: 402, height: 400 } });
    await page.evaluate(function () { pdCloseDetail(); });

    // 정리
    await page.evaluate(function (pid) { return apiFetch('/api/projects/' + pid, { method: 'DELETE' }).catch(function () {}); }, pid);
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    await browser.close();
  }
})();
