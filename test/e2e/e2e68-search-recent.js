// 통합 검색 최근 검색어 지우기 (v13.325) — ✕ 하나씩 · Delete 키 · 골라서 지우기 · 모두 지우기 · 10개 기억
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
  var recent = function () { return page.evaluate(function () { return lsGetJSON('wm-gs-recent', []); }); };
  var shown = function () { return page.evaluate(function () { var d = document.getElementById('globalSearchDropdown'); return { open: d.style.display === 'flex', qs: Array.prototype.map.call(d.querySelectorAll('.gs-recent .gs-item'), function (e) { return e.dataset.q; }) }; }); };
  async function openEmpty() {
    await page.evaluate(function () { var i = document.getElementById('globalSearchInput'); i.value = ''; i.blur(); document.getElementById('globalSearchDropdown').style.display = 'none'; });
    await page.click('#globalSearchInput');
    await page.waitForSelector('#globalSearchDropdown .gs-recent', { visible: true, timeout: 5000 });
  }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);

    // 12개 기억시키면 최근 10개만
    await page.evaluate(function () { lsSetJSON('wm-gs-recent', []); for (var i = 1; i <= 12; i++) gsRemember('검색' + i); });
    var r = await recent();
    check(r.length === 10 && r[0] === '검색12' && r[9] === '검색3', '최근 검색어 10개까지 · 최신이 위 (' + r.length + ')');

    // 1. ✕ 하나 지우기 — 창은 그대로 열려 있고 목록만 줄어듦
    await openEmpty();
    var s = await shown();
    check(s.qs.length === 10, '빈 칸 포커스 → 최근 검색 10줄');
    await page.hover('#globalSearchDropdown .gs-recent .gs-item[data-q="검색11"]');
    await page.click('#globalSearchDropdown .gs-recent .gs-item[data-q="검색11"] .gs-rx');
    await wait(150);
    s = await shown(); r = await recent();
    check(s.open && s.qs.indexOf('검색11') < 0 && s.qs.length === 9, '✕ → 그 줄만 지워지고 창은 열린 채');
    check(r.indexOf('검색11') < 0 && r.length === 9, '✕ → 저장된 목록에서도 지움');
    var v = await page.evaluate(function () { return document.getElementById('globalSearchInput').value; });
    check(v === '', '✕ 눌러도 그 검색어로 검색하지 않음');

    // 2. Delete 키 — ↓ 로 고르고 지우기
    await page.focus('#globalSearchInput');
    var items0 = await page.evaluate(function () { return document.querySelectorAll('#globalSearchDropdown .gs-item').length; });
    var aiRows = await page.evaluate(function () { return document.querySelectorAll('#globalSearchDropdown .gs-item.gs-ai').length; });
    for (var k = 0; k < aiRows + 2; k++) await page.keyboard.press('ArrowDown');   // 최근 검색 두 번째 줄 (검색10 · 검색9 …)
    var target = await page.evaluate(function () { return document.querySelectorAll('#globalSearchDropdown .gs-item')[_gsActiveIdx].dataset.q; });
    await page.keyboard.press('Delete');
    await wait(150);
    r = await recent(); s = await shown();
    check(target === '검색10' && r.indexOf('검색10') < 0 && r.length === 8, 'Delete 키 → 고른 줄 지움 (' + target + ')');
    var act = await page.evaluate(function () { var it = document.querySelectorAll('#globalSearchDropdown .gs-item')[_gsActiveIdx]; return it && it.dataset.q; });
    check(act === '검색9', 'Delete 뒤 다음 줄이 골라진 채 (' + act + ')');
    check(s.open, 'Delete 뒤에도 창 열림');

    // 3. 골라서 지우기
    await page.click('#globalSearchDropdown .gs-rtool[onclick="gsRecentSelMode(true)"]');
    await wait(100);
    var chk = await page.evaluate(function () { return { chk: document.querySelectorAll('#globalSearchDropdown .gs-rchk').length, x: document.querySelectorAll('#globalSearchDropdown .gs-rx').length, dis: document.querySelector('#globalSearchDropdown .gs-rdel').disabled }; });
    check(chk.chk === 8 && chk.x === 0 && chk.dis, '골라서 지우기 → 체크칸 8개 · ✕ 숨김 · 선택 삭제는 아직 꺼짐');
    await page.click('#globalSearchDropdown .gs-recent .gs-item[data-q="검색9"]');
    await page.click('#globalSearchDropdown .gs-recent .gs-item[data-q="검색5"]');
    await page.click('#globalSearchDropdown .gs-recent .gs-item[data-q="검색4"]');
    await page.click('#globalSearchDropdown .gs-recent .gs-item[data-q="검색4"]');   // 다시 누르면 풀림
    var btn = await page.evaluate(function () { return document.querySelector('#globalSearchDropdown .gs-rdel').textContent; });
    check(/\(2\)/.test(btn), '두 줄 고름 → 선택 삭제 (2) [' + btn + ']');
    v = await page.evaluate(function () { return document.getElementById('globalSearchInput').value; });
    check(v === '', '고르는 동안 검색하지 않음');
    await page.click('#globalSearchDropdown .gs-rdel');
    await wait(150);
    r = await recent(); s = await shown();
    check(r.length === 6 && r.indexOf('검색9') < 0 && r.indexOf('검색5') < 0 && r.indexOf('검색4') >= 0, '선택 삭제 → 고른 2개만 지움 ' + JSON.stringify(r));
    check(s.open && !(await page.$('#globalSearchDropdown .gs-rchk')), '지운 뒤 보통 목록으로 돌아옴');

    // 전체 체크 → 취소(Esc) 는 안 지움
    await page.click('#globalSearchDropdown .gs-rtool[onclick="gsRecentSelMode(true)"]');
    await page.click('#globalSearchDropdown .gs-rhead input[type=checkbox]');
    btn = await page.evaluate(function () { return document.querySelector('#globalSearchDropdown .gs-rdel').textContent; });
    check(/\(6\)/.test(btn), '전체 체크 → 6개 [' + btn + ']');
    await page.focus('#globalSearchInput');
    await page.keyboard.press('Escape');
    await wait(100);
    r = await recent(); s = await shown();
    check(r.length === 6 && s.open && !(await page.$('#globalSearchDropdown .gs-rchk')), 'Esc → 고르기만 그만 · 지우지 않음 · 창 열림');

    // 4. 모두 지우기 (확인 창 수락)
    await page.click('#globalSearchDropdown .gs-rdel');
    await wait(150);
    r = await recent(); s = await shown();
    check(r.length === 0 && s.qs.length === 0, '모두 지우기 → 비움');

    // 5. 고른 최근 검색어로 검색은 그대로
    await page.evaluate(function () { gsRemember('검색어테스트'); });
    await page.bringToFront();   // 확인 창 뒤 headless 창 포커스가 빠지면 focus 이벤트가 안 옴
    await openEmpty();
    await page.click('#globalSearchDropdown .gs-recent .gs-item[data-q="검색어테스트"] .gs-name');
    await page.waitForFunction(function () { return document.getElementById('globalSearchInput').value === '검색어테스트'; }, { timeout: 3000 }).catch(function () {});
    v = await page.evaluate(function () { return document.getElementById('globalSearchInput').value; });
    check(v === '검색어테스트', '줄 누르면 그 검색어로 검색 (예전 그대로)');
    await page.evaluate(function () { lsSetJSON('wm-gs-recent', []); });

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  await browser.close();
  console.log(fail ? 'FAILED ' + fail + ' (ok ' + ok + ')' : 'ALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})();
