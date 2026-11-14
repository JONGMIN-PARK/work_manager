// 📱 아일랜드 빠른 메뉴 (v13.501) — 휴대폰 머리 줄 왼쪽 캡슐(지금 화면 · 안 읽은 수 · 새 버전) → 누르면 커지는 메뉴 · ⬆ 새 버전 알림을 누르면 바로 새로 고침
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!'); await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await page.evaluate(function () { setPage('mywork'); }); await wait(800);
    var c = await page.evaluate(function () {
      var cap = document.getElementById('wmIsland'), h1 = document.querySelector('.hdr-brand h1'), r = cap && cap.getBoundingClientRect(), ctl = document.querySelector('.hdr-ctl').getBoundingClientRect();
      return { has: !!cap, txt: cap && cap.textContent, h1: h1 && getComputedStyle(h1).display, right: r && r.right, ctlL: ctl.left, top: r && r.top, sw: document.documentElement.scrollWidth, bg: cap && getComputedStyle(cap).backgroundColor };
    });
    check(c.has && /내 업무/.test(c.txt) && c.h1 === 'none', '휴대폰 — 제목 대신 캡슐 · 지금 화면 ' + JSON.stringify(c.txt));
    check(c.right <= c.ctlL + 1 && c.sw <= 391, '머리 줄 단추와 안 겹침 · 옆으로 안 넘침 ' + JSON.stringify(c));
    // 안 읽은 메시지 · 새 버전 표시
    await page.evaluate(function () { var b = document.getElementById('msgBadge'); b.textContent = '3'; b.style.display = ''; _wmUpdBar({ title: '새 버전', go: function () {} }); });
    await wait(300);
    var c2 = await page.evaluate(function () { return document.getElementById('wmIsland').innerHTML; });
    check(/💬3/.test(c2) && /⬆/.test(c2), '안 읽은 메시지 수 · 새 버전 표시 ' + c2.replace(/<[^>]+>/g, ' '));
    // 누르면 펼침
    var r = await page.evaluate(function () { var b = document.getElementById('wmIsland').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    await page.touchscreen.tap(r[0], r[1]); await wait(500);
    var p = await page.evaluate(function () {
      var el = document.getElementById('wmIslandPanel'); if (!el) return null; var b = el.getBoundingClientRect();
      return { pages: Array.from(el.querySelectorAll('[data-isl-page]')).map(function (x) { return x.dataset.islPage + (x.classList.contains('on') ? '*' : ''); }), acts: el.querySelectorAll('[data-isl]').length, w: b.width, l: b.left, r: b.right, op: getComputedStyle(el).opacity, upd: !!el.querySelector('[data-isl="reload"].up') };
    });
    check(p && p.pages.indexOf('mywork*') >= 0 && p.pages.indexOf('messages') >= 0 && p.acts >= 6 && p.op === '1' && p.l >= 7 && p.r <= 383, '누르면 메뉴가 펼쳐짐 — 화면 바로 가기 · 지금 화면 표시 · 동작 ' + JSON.stringify(p));
    check(p && p.upd, '새 버전이 있으면 ⬆ 업데이트 단추');
    await page.screenshot({ path: path.join(SHOT, 'island-open.png') });
    // 화면 고르기 → 이동 · 닫힘 · 캡슐 이름 바뀜
    var b = await page.evaluate(function () { var x = document.querySelector('#wmIslandPanel [data-isl-page="project"]').getBoundingClientRect(); return [x.left + x.width / 2, x.top + x.height / 2]; });
    await page.touchscreen.tap(b[0], b[1]); await wait(900);
    var a = await page.evaluate(function () { return { page: curPage, panel: !!document.getElementById('wmIslandPanel'), txt: document.getElementById('wmIsland').textContent }; });
    check(a.page === 'project' && !a.panel && /프로젝트/.test(a.txt), '화면을 고르면 그리로 · 메뉴 닫힘 · 캡슐도 바뀜 ' + JSON.stringify(a));
    // 바깥 누르면 닫힘
    await page.touchscreen.tap(r[0], r[1]); await wait(450);
    var dbg = await page.evaluate(function () { var e = document.elementFromPoint(195, 560); return { open: !!document.getElementById('wmIslandPanel'), at: e && (e.id || e.className) }; });
    await page.touchscreen.tap(195, 560); await wait(400);
    check(dbg.open && !(await page.evaluate(function () { return !!document.getElementById('wmIslandPanel'); })), '바깥을 누르면 닫힘 ' + JSON.stringify(dbg));
    // 🔎 검색 → 검색 칸 펼침
    await page.touchscreen.tap(r[0], r[1]); await wait(450);
    await page.evaluate(function () { document.querySelector('#wmIslandPanel [data-isl="search"]').click(); }); await wait(500);
    check(await page.evaluate(function () { return document.activeElement && document.activeElement.id === 'globalSearchInput' && document.getElementById('globalSearchWrap').getBoundingClientRect().width > 300; }), '🔎 검색 → 검색 칸이 펼쳐지고 바로 입력');
    await page.evaluate(function () { document.activeElement.blur(); document.body.click(); });
    // ⬆ 새 버전 알림을 눌러 들어옴 → 옛 화면이면 묻지 않고 새로 고침
    var re = await page.evaluate(function () {
      return new Promise(function (ok) {
        document.getElementById('wmUpd') && document.getElementById('wmUpd').remove();
        WMU.mine = 'old-build'; WMU.t = 0; window.__wmReload = function () { ok('reloaded'); };
        wmDeepGo('update'); setTimeout(function () { ok('no'); }, 12000);
      });
    });
    check(re === 'reloaded', '⬆ 알림을 누르면 새 화면으로 다시 엶 ' + re);
    // PC 폭 — 캡슐 없음
    await page.setViewport({ width: 1400, height: 900, isMobile: false, hasTouch: false }); await wait(600);
    check(await page.evaluate(function () { return !document.getElementById('wmIsland') && getComputedStyle(document.querySelector('.hdr-brand h1')).display !== 'none'; }), 'PC 폭 — 캡슐 없이 원래 제목');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  await browser.close();
  console.log(fail ? 'e2e100 FAIL ' + fail : 'e2e100-island.js ALL PASS ' + ok, '[]');
  process.exit(fail ? 1 : 0);
})();
