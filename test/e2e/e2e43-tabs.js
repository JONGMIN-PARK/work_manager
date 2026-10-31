// 탭 메뉴 정리 (v13.288) — 하위 탭 묶음 · 관리자 화면은 사용자 메뉴 ⚙️ 관리
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var SHOTS = path.join(__dirname, '.shots');
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.dismiss(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function ready() {
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
  }
  async function login(email) {
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { localStorage.removeItem('wm-last-view'); } catch (e) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', email); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await ready();
  }
  // 보이는 항목만 차례대로 — 묶음 이름은 '#이름', 구분선은 '|'
  function bar(sel) {
    return page.evaluate(function (sel) {
      return Array.from(document.querySelector(sel).children).filter(function (e) { return e.offsetParent && !e.classList.contains('hidden'); }).map(function (e) {
        return e.classList.contains('tab-sep') ? '|' : e.classList.contains('tab-grp') ? '#' + e.textContent : (e.dataset.m || e.dataset.page);
      }).join(' ');
    }, sel);
  }
  var shown = function (id) { return page.evaluate(function (id) { var e = document.getElementById(id); return !!e && e.style.display !== 'none'; }, id); };
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await login('admin@t.com');
    check(await bar('#pageTabs') === 'mywork mindmap team project', '상위 탭 4개 ' + await bar('#pageTabs'));
    var team = await bar('#modeTabs');
    check(team === '#업무일지 weekly archive trend | #보고 · 부하 weekly_report workload', '업무 관리 묶음 ' + team);
    await page.click('#pageTabs [data-page="project"]'); await wait(400);
    var proj = await bar('#modeTabsProj');
    check(proj === '#보기 pipeline timeline calendar | #관리 orders issues docs as | #준비 prestudy tech', '프로젝트 묶음 · 순서 · 운영자 숨김 ' + proj);
    await page.screenshot({ path: path.join(SHOTS, 'tabs-pc.png'), clip: { x: 0, y: 0, width: 1400, height: 200 } });

    // ⚙️ 관리 — 사용자 메뉴
    await page.click('.hdr-user-btn'); await wait(150);
    var adm = await page.evaluate(function () {
      return Array.from(document.querySelectorAll('#hdrUserWrap .hdr-pop-menu > *')).filter(function (e) { return e.offsetParent; }).map(function (e) { return e.id || e.className.split(' ').pop(); }).join(',');
    });
    check(/hdr-mi-grp,tabUserAdmin,hdrOperatorItem,tabPatchNotes/.test(adm), '관리자 — ⚙️ 관리 묶음 3개 ' + adm);
    await page.screenshot({ path: path.join(SHOTS, 'tabs-pc-admin.png'), clip: { x: 1000, y: 0, width: 400, height: 420 } });
    await page.click('#hdrOperatorItem'); await wait(600);
    var op = await page.evaluate(function () { var t = document.querySelector('#modeTabsProj [data-m="operator"]'); return { page: curPage, mode: curMode, tab: !t.classList.contains('hidden') && t.classList.contains('on'), item: document.getElementById('hdrOperatorItem').classList.contains('on'), view: !document.getElementById('mOperator').classList.contains('hidden'), pipe: document.getElementById('mPipeline').classList.contains('hidden') }; });
    check(op.page === 'project' && op.mode === 'operator' && op.tab && op.item && op.view && op.pipe, '🛡️ 운영자 — 프로젝트 › 운영자 바로 · 탭 보임 ' + JSON.stringify(op));
    await page.reload({ waitUntil: 'networkidle2' }); await ready(); await wait(400);
    check(await page.evaluate(function () { return curPage === 'project' && curMode === 'operator'; }), '새로고침 — 운영자 화면 복원');
    await page.click('#modeTabsProj [data-m="timeline"]'); await wait(400);
    check(await page.evaluate(function () { return document.querySelector('#modeTabsProj [data-m="operator"]').classList.contains('hidden') && !document.getElementById('hdrOperatorItem').classList.contains('on'); }), '다른 하위 탭으로 가면 운영자 탭 숨김');
    await page.click('.hdr-user-btn'); await page.click('#tabUserAdmin'); await wait(500);
    var ua = await page.evaluate(function () { return { page: curPage, view: !document.getElementById('mUserAdmin').classList.contains('hidden'), on: document.getElementById('tabUserAdmin').classList.contains('on'), sub: document.getElementById('modeTabs').classList.contains('hidden') && document.getElementById('modeTabsProj').classList.contains('hidden'), pageOn: !!document.querySelector('#pageTabs .tab.on') }; });
    check(ua.page === 'useradmin' && ua.view && ua.on && ua.sub && !ua.pageOn, '👤 사용자 관리 — 메뉴에서 열림 ' + JSON.stringify(ua));
    await page.reload({ waitUntil: 'networkidle2' }); await ready(); await wait(400);
    check(await page.evaluate(function () { return curPage === 'useradmin'; }), '새로고침 — 사용자 관리 복원');
    await page.click('#pageTabs [data-page="mywork"]'); await wait(300);
    check(await page.evaluate(function () { return !document.getElementById('tabUserAdmin').classList.contains('on'); }), '다른 탭으로 가면 메뉴 표시 꺼짐');

    // 휴대폰 — 하위 탭 한 줄 가로 밀기
    await page.click('#pageTabs [data-page="project"]'); await wait(300);
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true }); await wait(300);
    var mb = await page.evaluate(function () { var b = document.getElementById('modeTabsProj'); return { h: Math.round(b.getBoundingClientRect().height), scroll: b.scrollWidth > b.clientWidth, over: document.documentElement.scrollWidth > innerWidth + 1 }; });
    check(mb.h < 60 && mb.scroll && !mb.over, '휴대폰 — 하위 탭 한 줄 · 가로 밀기 · 화면 넘침 없음 ' + JSON.stringify(mb));
    await page.screenshot({ path: path.join(SHOTS, 'tabs-phone.png'), clip: { x: 0, y: 0, width: 402, height: 220 } });

    // 팀원 — 관리 묶음 · 보고 묶음 없음
    await page.setViewport({ width: 1400, height: 900 }); await wait(300); await ready();  // isMobile 을 바꾸면 puppeteer 가 페이지를 다시 불러옴 — 다 뜬 뒤 로그아웃
    await page.evaluate(function () { if (typeof authLogout === 'function') return authLogout(); });
    await login('kim@t.com');
    var role = await page.evaluate(function () { return currentUser.role; });
    var grp = await page.evaluate(function () { return Array.from(document.querySelectorAll('[data-grp="admin"]')).every(function (e) { return e.style.display === 'none'; }); });
    check(grp && !(await shown('tabUserAdmin')) && !(await shown('hdrOperatorItem')), '팀원(' + role + ') — ⚙️ 관리 묶음 숨김');
    var team2 = await bar('#modeTabs');
    var expect = role === 'member' ? '#업무일지 weekly archive trend' : null;
    check(expect ? team2 === expect : /#업무일지/.test(team2), '팀원 업무 관리 탭 ' + team2);
    await page.evaluate(function () { wmOpenOperator(); });
    check(await page.evaluate(function () { return curMode !== 'operator'; }), '권한 없으면 운영자 안 열림');
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    await browser.close();
  }
})();
