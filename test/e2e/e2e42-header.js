// 상단 헤더 정리 (v13.287) — 🎨 화면 설정 · 사용자 메뉴 · ✉️ 메시지 · 업무일지 데이터 도구 · 휴대폰 한 줄
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
  // 헤더가 화면 밖으로 넘치지 않는지 · 한 줄인지
  function hdrFit() {
    return page.evaluate(function () {
      var h = document.querySelector('.hdr-in'), r = h.getBoundingClientRect(), vw = document.documentElement.clientWidth;
      var kids = Array.prototype.slice.call(document.querySelectorAll('.hdr-in h1, .hdr-ctl > *')).filter(function (e) { return e.offsetParent; });
      var tops = kids.map(function (e) { return Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2); });
      return { over: kids.some(function (e) { var b = e.getBoundingClientRect(); return b.right > vw + 1 || b.left < -1; }), oneLine: Math.max.apply(null, tops) - Math.min.apply(null, tops) < 12, h: Math.round(r.height) };
    });
  }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await login('admin@t.com');
    var s = await page.evaluate(function () {
      return {
        msgTab: !!document.querySelector('#pageTabs [data-page="messages"]'),
        msgBtn: !!document.querySelector('.hdr #hdrMsgBtn #msgBadge'),
        oldMore: !!document.querySelector('.hdr-more, .hdr-more-tg, #fontBarWrap'),
        dataTools: !!document.querySelector('.hdr [onclick*="resetAllData"], .hdr [onclick*="deduplicateRecords"]'),
        wrTools: !!document.querySelector('#mainArea #wrToolsWrap [onclick*="resetAllData"]'),
        fileInfo: !!document.querySelector('#mainArea #fileInfo'),
        user: document.getElementById('authUserInfo').textContent,
        pn: document.getElementById('tabPatchNotes').style.display
      };
    });
    check(!s.msgTab && s.msgBtn, '메시지 — 상위 탭 없음 · 헤더 아이콘 · 배지');
    check(!s.oldMore && !s.dataTools, '헤더 — 옛 ⋯ 접기 · 데이터 도구 없음');
    check(s.wrTools && s.fileInfo, '주간 분석 툴바 — 데이터 도구 · 파일 정보');
    check(/관리자/.test(s.user), '사용자 버튼 — 이름 · 역할 ' + s.user);
    check(s.pn !== 'none', '관리자 — 사용자 메뉴에 패치노트');
    var f = await hdrFit();
    check(!f.over && f.oneLine, 'PC 헤더 한 줄 · 넘침 없음 ' + JSON.stringify(f));

    // 🎨 화면 설정
    await page.click('#hdrLookWrap > .hdr-ic'); await wait(200);
    var look = await page.evaluate(function () {
      var m = document.querySelector('#hdrLookWrap .hdr-pop-menu'), r = m.getBoundingClientRect();
      return { open: getComputedStyle(m).display !== 'none', chips: document.querySelectorAll('#themeBar .thc').length, groups: document.querySelectorAll('#themeBar .thg-t').length, fonts: document.querySelectorAll('#fontBar .fnd').length, inView: r.left >= 0 && r.right <= innerWidth };
    });
    check(look.open && look.chips === TH_N() && look.groups === 4 && look.fonts > 5 && look.inView, '🎨 열림 — 테마 칸 · 무리 4 · 글씨체 목록 ' + JSON.stringify(look));
    await page.screenshot({ path: path.join(SHOTS, 'hdr-pc-look.png') });
    await page.hover('#themeBar .thc[title="포레스트"]'); await wait(100);
    check(await page.evaluate(function () { return document.documentElement.getAttribute('data-theme') === 'forest' && cTh !== 'forest'; }), '올리면 미리 보기 (저장 안 함)');
    await page.click('#themeBar .thc[title="페이퍼"]'); await wait(150);
    var t1 = await page.evaluate(function () { return { th: cTh, attr: document.documentElement.getAttribute('data-theme'), open: document.getElementById('hdrLookWrap').classList.contains('open'), on: (document.querySelector('#themeBar .thc.on') || {}).title }; });
    check(t1.th === 'paper' && t1.attr === 'paper' && t1.open && t1.on === '페이퍼', '누르면 적용 · 창은 열린 채 ' + JSON.stringify(t1));
    await page.click('#fontBar .fnd[title^="프리텐다드"]'); await wait(150);
    check(await page.evaluate(function () { return cFnt === 'pretendard' && document.getElementById('hdrLookWrap').classList.contains('open'); }), '글씨체 적용 · 창 유지');
    await page.keyboard.press('Escape'); await wait(100);
    check(await page.evaluate(function () { return !document.querySelector('.hdr-pop.open'); }), 'Esc 로 닫힘');

    // 사용자 메뉴 — 하나만 열림 · 바깥 누르면 닫힘
    await page.click('#hdrLookWrap > .hdr-ic'); await page.click('.hdr-user-btn'); await wait(150);
    var um = await page.evaluate(function () { return { open: [].map.call(document.querySelectorAll('.hdr-pop.open'), function (e) { return e.id; }), head: document.getElementById('hdrUserHead').textContent }; });
    check(um.open.join() === 'hdrUserWrap' && um.head, '사용자 메뉴 — 하나만 열림 ' + JSON.stringify(um));
    await page.screenshot({ path: path.join(SHOTS, 'hdr-pc-user.png') });
    await page.click('#hdrUserWrap [onclick*="showBackupRestoreModal"]'); await wait(400);
    check(await page.evaluate(function () { return !!document.getElementById('backupOverlay') && !document.querySelector('.hdr-pop.open'); }), '백업 · 복원 창 열림 · 메뉴 닫힘');
    await page.evaluate(function () { var o = document.getElementById('backupOverlay'); if (o) o.remove(); });
    await page.mouse.click(700, 600);

    // 주간 분석 툴바 ⋯ — 아래 패널에 가리지 않음
    var wt = await page.evaluate(function () {
      if (document.getElementById('mainArea').classList.contains('hidden')) return { skip: true };
      wmHdrPop('wrToolsWrap');
      var m = document.querySelector('#wrToolsWrap .hdr-pop-menu'), r = m.getBoundingClientRect();
      var hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 8);
      var res = { top: m.contains(hit), inView: r.left >= 0 && r.right <= innerWidth };
      wmHdrPopClose(); return res;
    });
    check(wt.skip || (wt.top && wt.inView), '주간 분석 ⋯ 메뉴 — 맨 위 · 화면 안 ' + JSON.stringify(wt));

    // ✉️ 메시지 — 헤더 아이콘 눌러 이동 · 표시 · 복원
    await page.click('#hdrMsgBtn'); await wait(300);
    check(await page.evaluate(function () { return curPage === 'messages' && document.getElementById('hdrMsgBtn').classList.contains('on') && !document.getElementById('mMessages').classList.contains('hidden') && !document.querySelector('#pageTabs .tab.on'); }), '✉️ 누르면 메시지 화면 · 아이콘 표시');
    await page.reload({ waitUntil: 'networkidle2' }); await ready(); await wait(500);
    check(await page.evaluate(function () { return curPage === 'messages'; }), '새로고침 — 메시지 화면 그대로 복원');
    await page.click('#pageTabs [data-page="team"]'); await wait(300);
    check(await page.evaluate(function () { return !document.getElementById('hdrMsgBtn').classList.contains('on'); }), '다른 탭으로 가면 ✉️ 표시 꺼짐');

    // 패드 세로 · 휴대폰
    await page.setViewport({ width: 820, height: 1180 }); await wait(300);
    f = await hdrFit();
    check(!f.over && f.oneLine, '패드 헤더 한 줄 ' + JSON.stringify(f));
    await page.screenshot({ path: path.join(SHOTS, 'hdr-pad.png'), clip: { x: 0, y: 0, width: 820, height: 200 } });
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true }); await wait(300);
    f = await hdrFit();
    check(!f.over && f.oneLine, '휴대폰 헤더 한 줄 ' + JSON.stringify(f));
    await page.screenshot({ path: path.join(SHOTS, 'hdr-phone.png'), clip: { x: 0, y: 0, width: 402, height: 200 } });
    await page.focus('#globalSearchInput'); await page.keyboard.type('a'); await wait(600);
    var sr = await page.evaluate(function () { var r = document.getElementById('globalSearchInput').getBoundingClientRect(); return { w: Math.round(r.width), left: Math.round(r.left) }; });
    check(sr.w > 300 && sr.left >= 0, '휴대폰 🔎 — 누르면 헤더 폭으로 ' + JSON.stringify(sr));
    await page.screenshot({ path: path.join(SHOTS, 'hdr-phone-search.png'), clip: { x: 0, y: 0, width: 402, height: 500 } });
    await page.evaluate(function () { var i = document.getElementById('globalSearchInput'); i.value = ''; i.blur(); document.getElementById('globalSearchDropdown').style.display = 'none'; });
    await page.evaluate(function () { wmHdrPop('hdrLookWrap'); }); await wait(200);
    var pm = await page.evaluate(function () { var r = document.querySelector('#hdrLookWrap .hdr-pop-menu').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), b: Math.round(r.bottom) }; });
    check(pm.l >= 0 && pm.r <= 402 && pm.b <= 874, '휴대폰 🎨 — 화면 안 ' + JSON.stringify(pm));
    await page.screenshot({ path: path.join(SHOTS, 'hdr-phone-look.png') });
    await page.evaluate(function () { wmHdrPopClose(); });

    // 팀원 — 패치노트 없음
    await page.setViewport({ width: 1400, height: 900 });
    await page.evaluate(function () { if (typeof authLogout === 'function') return authLogout(); });
    await login('kim@t.com');
    check(await page.evaluate(function () { return document.getElementById('tabPatchNotes').style.display === 'none' && /팀원|팀장|임원/.test(document.getElementById('authUserInfo').textContent); }), '팀원 — 사용자 메뉴에 패치노트 없음');
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    await browser.close();
  }
  function TH_N() { return 18; }
})();
