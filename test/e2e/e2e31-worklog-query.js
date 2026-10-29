// 업무일지 조회 조건 — 주차 · 팀원 목록 팝업(여러 명) · ◀ ▶ · 상세 필터 접기 · 수주명 · 거래처 한 칸 (v13.264)
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
  try {
    // 세 주 · 세 사람 기록
    var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
    await c.query("DELETE FROM work_records WHERE content LIKE 'E2E조회%'");
    var days = ['20261013', '20261014', '20261020', '20261021', '20261027', '20261028'];
    var who = ['조회가', '조회나', '조회다'];
    for (var i = 0; i < days.length; i++) for (var j = 0; j < who.length; j++) {
      await c.query("INSERT INTO work_records (date, name, order_no, hours, abbr, content, oclient, ocmt, user_id, tenant_id) VALUES ($1, $2, 'E2E-Q1', 2, 'D', $3, '조회거래처', '조회수주명', $4, $5)", [days[i], who[j], 'E2E조회 ' + i + j, adm.id, adm.tenant_id]);
    }
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { localStorage.removeItem('wm-lastWeek'); localStorage.removeItem('wm-wq-filters'); localStorage.removeItem('wm-wd'); } catch (e) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await page.evaluate(function () { setPage('team'); setMode('weekly'); deAll(); pickWeek('20261025'); });
    await wait(400);

    // 주차 — 펼친 칩 대신 버튼 + 목록 팝업
    check(await page.$eval('#weekSelCount', function (e) { return /W\d+ · 10\/25 ~ 10\/31/.test(e.textContent); }), '주차 버튼에 고른 주 (W·날짜)');
    check(await page.$eval('#wqWeek .wq-pop', function (e) { return getComputedStyle(e).display === 'none'; }), '주차 목록은 닫혀 있음');
    await page.click('#wqWeek .wq-btn'); await wait(200);
    var wl = await page.evaluate(function () { return { open: getComputedStyle(document.querySelector('#wqWeek .wq-pop')).display !== 'none', rows: document.querySelectorAll('#weekSelectorChips .wq-row[data-wk]').length, grp: document.querySelectorAll('#weekSelectorChips .wq-grp').length, on: (document.querySelector('#weekSelectorChips .wq-row.on') || { getAttribute: function () { return null; } }).getAttribute('data-wk') }; });
    check(wl.open && wl.rows >= 3 && wl.grp >= 1 && wl.on === '20261025', '주차 목록 — 월별 묶음 · 고른 주 표시 ' + JSON.stringify(wl));
    await page.evaluate(function () { document.querySelector('#weekSelectorChips .wq-row[data-wk="20261018"]').click(); });
    await wait(200);
    check(await page.evaluate(function () { return selWeek.start === '20261018' && !document.querySelector('.wq-dd.open'); }), '목록에서 고르면 그 주 · 팝업 닫힘');
    await page.click('#wqWeek .wq-nav:first-child'); await wait(200);
    check(await page.evaluate(function () { return selWeek.start === '20261011'; }), '◀ 이전 주');
    await page.click('#wqWeek .wq-nav:last-child'); await wait(200);
    check(await page.evaluate(function () { return selWeek.start === '20261018'; }), '▶ 다음 주');

    // 팀원 — 체크 목록, 여러 명 · 만 · 찾기 · 태그 ×
    await page.click('#wqName .wq-btn'); await wait(200);
    var names = await page.evaluate(function () { return Array.from(document.querySelectorAll('#nameChips .wq-nm')).map(function (r) { return r.title; }); });
    check(['조회가', '조회나', '조회다'].every(function (n) { return names.indexOf(n) >= 0; }), '팀원 목록');
    var clickName = function (n) { return page.evaluate(function (n) { Array.from(document.querySelectorAll('#nameChips .wq-nm')).filter(function (r) { return r.title === n; })[0].click(); }, n); };
    await clickName('조회가'); await clickName('조회나');
    await wait(200);
    var ms = await page.evaluate(function () { return { sel: Array.from(sN).sort(), open: !!document.querySelector('#wqName.open'), sum: document.getElementById('nameSum').textContent, tags: document.querySelectorAll('#nameSel .wq-nt').length, rows: lastFiltered.length }; });
    check(ms.sel.join() === '조회가,조회나' && ms.open && ms.tags === 2, '여러 명 — 누르는 대로 더해지고 팝업 유지 ' + JSON.stringify(ms));
    check(ms.rows === 4, '두 사람 · 한 주 = 4건 (' + ms.rows + ')');
    await clickName('조회가'); await wait(150);
    check(await page.evaluate(function () { return sN.size === 1 && sN.has('조회나'); }), '다시 누르면 빠짐');
    await page.evaluate(function () { Array.from(document.querySelectorAll('#nameChips .wq-nm')).filter(function (r) { return r.title === '조회다'; })[0].querySelector('.wq-only').click(); });
    check(await page.evaluate(function () { return sN.size === 1 && sN.has('조회다'); }), "'만' — 그 사람만");
    await page.type('#nameFind', '조회가'); await wait(150);
    check(await page.evaluate(function () { var r = document.querySelectorAll('#nameChips .wq-nm'); return r.length === 1 && r[0].title === '조회가'; }), '이름 찾기');
    await page.evaluate(function () { var f = document.getElementById('nameFind'); f.value = ''; rNC(); });
    await page.mouse.click(1350, 860); await wait(150);
    check(await page.evaluate(function () { return !document.querySelector('.wq-dd.open'); }), '바깥 누르면 닫힘');
    await page.evaluate(function () { document.querySelector('#nameSel .wq-nt .tx').click(); });
    check(await page.evaluate(function () { return sN.size === 0; }), '고른 사람 태그 × 로 빼기');

    // 상세 필터 — 접혀 있다가 펼침, 거는 수 표시
    await page.evaluate(function () { selAll(); });
    check(await page.$eval('#wqFilters', function (e) { return e.classList.contains('hidden'); }), '상세 필터 기본 접힘');
    await page.click('#wqFilterBtn'); await wait(150);
    check(await page.$eval('#wqFilters', function (e) { return !e.classList.contains('hidden'); }), '상세 필터 펼침');
    await page.evaluate(function () { Array.from(document.querySelectorAll('#clLB .li')).filter(function (l) { return /조회거래처/.test(l.textContent); })[0].click(); });
    await wait(200);
    var ft = await page.evaluate(function () { return { n: document.getElementById('wqFilterN').textContent, tag: document.getElementById('afTags').textContent }; });
    check(ft.n === '1' && /거래처:조회거래처/.test(ft.tag), '필터 수 · 거래처 태그 ' + JSON.stringify(ft));
    await page.evaluate(function () { resetAll(); });
    check(await page.evaluate(function () { return sCL.size === 0 && selWeek && selWeek.start === '20261018'; }), '필터 초기화는 주차를 그대로 둠');

    // 상세 표 — 수주명 · 거래처 한 칸에 붙어서
    await page.evaluate(function () { wdSetGroup('none'); });   // v13.266 기본은 사람별 묶음 — 낱개로 펼쳐 놓고 확인
    var cell = await page.evaluate(function () { var td = document.querySelector('#tBody .oc-cell'); if (!td) return null; var a = td.querySelector('.oc-nm').getBoundingClientRect(), b = td.querySelector('.oc-cl').getBoundingClientRect(); return { span: td.colSpan, nm: td.querySelector('.oc-nm').textContent, cl: td.querySelector('.oc-cl').textContent, gap: Math.round(b.left - a.right) }; });
    check(cell && cell.span === 2 && cell.nm === '조회수주명' && cell.cl === '조회거래처' && cell.gap >= 0 && cell.gap <= 16, '수주명 바로 옆 거래처 ' + JSON.stringify(cell));
    await page.evaluate(function () { togEdit(); });
    check(await page.evaluate(function () { return !!document.querySelector('#tBody td[data-field="ocmt"]') && !!document.querySelector('#tBody td[data-field="oclient"]'); }), '편집 모드는 두 칸 따로 고침');
    await page.evaluate(function () { cancelEdits(); wdSetGroup('name'); });

    // 휴대폰 — 가로로 넘치지 않음
    await page.setViewport({ width: 390, height: 844 });
    await wait(300);
    check(await page.evaluate(function () { return document.documentElement.scrollWidth <= 392; }), '휴대폰 폭 넘침 없음');
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    await c.query("DELETE FROM work_records WHERE content LIKE 'E2E조회%'");
    await browser.close(); await c.end();
  }
})();
