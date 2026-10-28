// 마지막 위치 기억 — 다시 들어오면 데이터를 받은 뒤 마지막으로 보던 페이지 · 하위 탭으로 (v13.261)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  // 시작이 끝나 복원까지 된 상태 (로딩 표시가 사라진 뒤)
  async function ready() {
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
  }
  function view() {
    return page.evaluate(function () {
      var on = function (sel) { var t = document.querySelector(sel + ' .tab.on'); return t ? (t.dataset.page || t.dataset.m) : null; };
      return { page: curPage, mode: curMode, pageTab: on('#pageTabs'), projTab: on('#modeTabsProj'), tl: !document.getElementById('mTimeline').classList.contains('hidden'), wr: !document.getElementById('mWeeklyReport').classList.contains('hidden') };
    });
  }
  async function login(email) {
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', email); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await ready();
  }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await login('admin@t.com');
    check(await page.$eval('#tabPatchNotes', function (e) { return e.style.display !== 'none'; }), '관리자 — 패치노트 탭 보임');
    var v0 = await view();
    check(v0.page === 'team' && v0.mode === 'weekly', '처음 방문 — 기본 업무일지 탭 ' + JSON.stringify(v0));

    // 프로젝트 관리 › 타임라인 → 새로고침 → 그대로 · 처음 그려 새로 받음
    await page.click('#pageTabs [data-page="project"]'); await wait(300);
    await page.click('#modeTabsProj [data-m="timeline"]'); await wait(500);
    await page.reload({ waitUntil: 'networkidle2' });
    await ready();
    var v1 = await view();
    check(v1.page === 'project' && v1.mode === 'timeline' && v1.pageTab === 'project' && v1.projTab === 'timeline' && v1.tl, '새로고침 → 프로젝트 관리 › 타임라인 ' + JSON.stringify(v1));
    check(await page.evaluate(function () { return !!document.querySelector('#mTimeline .tl-label, #mTimeline [class*="tl-"]'); }), '타임라인 내용이 그려짐');
    check(await page.evaluate(function () { return !document.querySelector('#modeTabsProj .tab.on[data-m="pipeline"]'); }), '파이프라인을 먼저 그리지 않음 (하위 탭 하나만)');

    // 하위 탭 없는 페이지 — 주간 업무
    await page.click('#pageTabs [data-page="weekly_report"]'); await wait(500);
    await page.reload({ waitUntil: 'networkidle2' });
    await ready();
    var v2 = await view();
    check(v2.page === 'weekly_report' && v2.wr && v2.pageTab === 'weekly_report', '새로고침 → 주간 업무 ' + JSON.stringify(v2));

    // 로딩 중에 사용자가 탭을 누르면 그쪽을 따름 (복원이 끌고 가지 않음)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(function () { return typeof setPage === 'function' && document.querySelector('#pageTabs [data-page="messages"]'); });
    await page.evaluate(function () { setPage('messages'); });
    await ready();
    check((await view()).page === 'messages', '로딩 중 직접 고른 탭 유지');

    // 지금 계정에 없는 탭이면 기본 화면 — 관리자 전용 '주간 업무' 를 기억한 채 팀원으로 로그인
    await page.evaluate(function () { setPage('weekly_report'); });
    await page.evaluate(function () { if (typeof authLogout === 'function') return authLogout(); });
    await wait(800);
    await login('kim@t.com');
    var v3 = await view();
    check(v3.page === 'team' && !v3.wr, '권한 없는 탭은 복원 안 함 → 기본 화면 ' + JSON.stringify(v3));
    // 패치노트 — 관리자만 (v13.263)
    var pn = await page.evaluate(function () { setPage('patchnotes'); return { tab: document.getElementById('tabPatchNotes').style.display, page: curPage }; });
    check(pn.tab === 'none' && pn.page !== 'patchnotes', '팀원 — 패치노트 탭 숨김 · 열리지 않음 ' + JSON.stringify(pn));
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    await browser.close();
  }
})();
