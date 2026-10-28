// 주간 분석 마지막 상태 되살리기 · 휴대폰 상세 표 좁게 (v13.265)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var ready = function () { return page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading') && aD.length > 0; }, { timeout: 60000 }); };
  var STATE = function () { return page.evaluate(function () { var t = document.querySelector('#statsS .tabs .tab.on'); return { n: Array.from(sN).sort().join(), cl: Array.from(sCL).join(), kw: cKw, wk: selWeek ? selWeek.start + '~' + selWeek.end : null, tab: t && t.dataset.t, cmp: cmpMode, rows: gF().length, search: document.getElementById('cSearch').value }; }); };
  try {
    var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
    await c.query("DELETE FROM work_records WHERE content LIKE 'E2E상태%'");
    var days = ['20261013', '20261014', '20261020', '20261021', '20261027'];
    var who = ['상태가', '상태나', '상태다'];
    for (var i = 0; i < days.length; i++) for (var j = 0; j < who.length; j++) {
      await c.query("INSERT INTO work_records (date, name, order_no, hours, abbr, task_type, content, oclient, ocmt, user_id, tenant_id) VALUES ($1, $2, 'E2E-S1', 2, 'D', '설계', $3, $4, '상태수주명', $5, $6)", [days[i], who[j], 'E2E상태 ' + i + j + (j === 0 ? ' 키워드' : ''), j === 2 ? '다른거래처' : '상태거래처', adm.id, adm.tenant_id]);
    }
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await ready();
    // 고르기 — 날짜 범위 · 두 사람 · 거래처 필터 · 검색 · 차트 탭 · 인원 비교
    await page.evaluate(function () {
      setPage('team'); setMode('weekly');
      document.getElementById('dateRangeFrom').value = '2026-10-13'; document.getElementById('dateRangeTo').value = '2026-10-21'; pickDateRange();
      deAll(); ['상태가', '상태나'].forEach(function (n) { togN(aN.indexOf(n)); });
      togCL('상태거래처');
      document.getElementById('cSearch').value = '키워드'; onSI();
      document.getElementById('cmpTog').checked = true; togCompare();
      sTab('cht');
    });
    await wait(800);
    var before = await STATE();
    check(before.rows === 4 && before.tab === 'cht' && before.cmp, '고른 상태 ' + JSON.stringify(before));
    await page.reload({ waitUntil: 'networkidle2' });
    await ready(); await wait(400);
    var after = await STATE();
    check(after.n === '상태가,상태나', '팀원 되살림 ' + after.n);
    check(after.wk === '20261013~20261021', '날짜 범위 되살림 ' + after.wk);
    check(after.cl === '상태거래처', '거래처 필터 되살림');
    check(after.kw === '키워드' && after.search === '키워드', '검색어 되살림');
    check(after.tab === 'cht', '차트 탭 되살림 ' + after.tab);
    check(after.cmp === true, '인원 비교 되살림');
    check(after.rows === before.rows, '같은 결과 ' + after.rows);
    check(await page.evaluate(function () { return /거래처:상태거래처/.test(document.getElementById('afTags').textContent) && document.getElementById('nameSel').querySelectorAll('.wq-nt').length === 2; }), '태그도 그대로');
    // 한 주 · 전체
    await page.evaluate(function () { pickWeek('20261018'); resetAll(); sTab('tbl'); });
    await wait(600);
    await page.reload({ waitUntil: 'networkidle2' }); await ready(); await wait(400);
    var s2 = await STATE();
    check(s2.wk === '20261018~20261024' && s2.tab === 'tbl' && !s2.cl && !s2.kw, '한 주 · 필터 푼 상태 ' + JSON.stringify(s2));
    await page.evaluate(function () { pickWeek(null); });
    await wait(600);
    await page.reload({ waitUntil: 'networkidle2' }); await ready(); await wait(400);
    check((await STATE()).wk === null, '전체 기간 되살림');
    // 기록에 없는 사람은 빼고
    await page.evaluate(function () { var k = 'wm-wv-state:' + currentUser.id; var o = JSON.parse(localStorage.getItem(k)); o.n.push('없는사람'); localStorage.setItem(k, JSON.stringify(o)); });
    await page.reload({ waitUntil: 'networkidle2' }); await ready(); await wait(400);
    check(await page.evaluate(function () { return !sN.has('없는사람') && sN.has('상태가'); }), '없는 사람은 빼고 되살림');

    // 휴대폰 상세 표
    await page.evaluate(function () { pickWeek('20261011'); });
    await wait(500);
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await ready(); await wait(600);
    var m = await page.evaluate(function () {
      setPage('team'); setMode('weekly'); sTab('tbl');
      var t = document.getElementById('wrTbl'), td = document.querySelector('#tBody tr td.mono'), task = document.querySelector('#wrTbl th.c-task');
      return { w: t.offsetWidth, task: getComputedStyle(task).display, date: td && td.innerText.trim(), rows: document.querySelectorAll('#tBody tr').length, sw: document.documentElement.scrollWidth };
    });
    check(m.w <= 640 && m.w >= 600, '휴대폰 표 폭 ' + m.w + ' (전엔 1040)');
    check(m.task === 'none', '업무분장 칸 숨김 (약자 배지로 대신)');
    check(/^\d\d-\d\d$/.test(m.date || ''), '날짜는 월-일 ' + m.date);
    check(m.sw <= 392, '화면 자체는 옆으로 안 넘침 ' + m.sw);
    await page.screenshot({ path: path.join(__dirname, '.shots', 'e2e32-phone-table.png') });
    await page.evaluate(function () { togEdit(); });
    check(await page.evaluate(function () { return document.getElementById('wrTbl').offsetWidth >= 1000; }), '편집 모드는 넓은 표 그대로');
    await page.evaluate(function () { cancelEdits(); });
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    await c.query("DELETE FROM work_records WHERE content LIKE 'E2E상태%'");
    await browser.close(); await c.end();
  }
})();
