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
      return { page: curPage, mode: curMode, pageTab: on('#pageTabs'), projTab: on('#modeTabsProj'), teamTab: on('#modeTabs'), tl: !document.getElementById('mTimeline').classList.contains('hidden'), wr: !document.getElementById('mWeeklyReport').classList.contains('hidden') };
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

    // 토큰 갱신이 동시에 불려도 요청 하나 — 한 번 쓰면 바뀌는 refresh 토큰이라 둘이 따로 가면 하나가 실패해 로그아웃됐다
    var rf = await page.evaluate(async function () { var n = 0, of = window.fetch; window.fetch = function (u) { if (/\/auth\/refresh/.test(String(u))) n++; return of.apply(this, arguments); }; var r = await Promise.all([_tryRefresh(), _tryRefresh(), _tryRefresh()]); window.fetch = of; var me = await apiFetch('/api/auth/me'); return { r: r, n: n, me: !!(me && me.data) }; });
    check(rf.r.every(Boolean) && rf.n === 1 && rf.me, '동시 토큰 갱신 — 요청 1번 · 로그인 유지 ' + JSON.stringify(rf));

    // 업무 관리 › 주간 업무 (v13.280 상위 탭에서 옮김)
    await page.click('#pageTabs [data-page="team"]'); await page.click('#modeTabs [data-m="weekly_report"]'); await wait(500);
    await page.reload({ waitUntil: 'networkidle2' });
    await ready();
    var v2 = await view();
    check(v2.page === 'team' && v2.mode === 'weekly_report' && v2.wr && v2.pageTab === 'team' && v2.teamTab === 'weekly_report', '새로고침 → 업무 관리 › 주간 업무 ' + JSON.stringify(v2));

    // 메뉴 순서 (v13.280) · 예전 저장값 — 업무 부하가 상위 탭이던 때 기억한 것도 업무 관리 › 업무 부하로
    var order = await page.evaluate(function () { return Array.from(document.querySelectorAll('#pageTabs .tab')).map(function (t) { return t.dataset.page; }).join(','); });
    check(order === 'mywork,mindmap,team,project,messages,useradmin,patchnotes', '메뉴 순서 ' + order);
    check(/업무 관리/.test(await page.$eval('#pageTabs [data-page="team"]', function (e) { return e.textContent; })), '업무일지 → 업무 관리 이름');
    await page.evaluate(function () { localStorage.setItem('wm-last-view', JSON.stringify({ page: 'workload' })); });
    await page.reload({ waitUntil: 'networkidle2' });
    await ready();
    var v4 = await page.evaluate(function () { return { page: curPage, mode: curMode, wl: !document.getElementById('mWorkload').classList.contains('hidden'), wk: !document.getElementById('mWeekly').classList.contains('hidden') }; });
    check(v4.page === 'team' && v4.mode === 'workload' && v4.wl && !v4.wk, '예전 저장값 workload → 업무 관리 › 업무 부하 ' + JSON.stringify(v4));
    await page.click('#modeTabs [data-m="weekly"]'); await wait(300);
    check(await page.evaluate(function () { return document.getElementById('mWorkload').classList.contains('hidden') && !document.getElementById('mWeekly').classList.contains('hidden'); }), '하위 탭 주간 분석으로 옮기면 업무 부하 숨김');

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
    check(v3.page === 'team' && v3.mode === 'weekly' && !v3.wr, '권한 없는 탭은 복원 안 함 → 기본 화면 ' + JSON.stringify(v3));
    // 패치노트 — 관리자만 (v13.263)
    var pn = await page.evaluate(function () { setPage('patchnotes'); return { tab: document.getElementById('tabPatchNotes').style.display, page: curPage }; });
    check(pn.tab === 'none' && pn.page !== 'patchnotes', '팀원 — 패치노트 탭 숨김 · 열리지 않음 ' + JSON.stringify(pn));
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); try { console.log('STATE', JSON.stringify(await page.evaluate(function () { var on = document.querySelector('#wmSpSteps li.on'); return { splash: !!document.getElementById('initLoading'), step: on && on.dataset.k, user: !!(typeof currentUser !== 'undefined' && currentUser), tok: typeof _accessToken !== 'undefined' && !!_accessToken, initDone: typeof _initDone !== 'undefined' && _initDone, page: curPage, login: (document.getElementById('loginOverlay') || {}).style && document.getElementById('loginOverlay').style.display, url: location.href }; }))); } catch (e2) { console.log('STATE?', e2.message); } } finally {
    await browser.close();
  }
})();
