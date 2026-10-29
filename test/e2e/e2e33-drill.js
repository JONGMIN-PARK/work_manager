// 업무일지 상세 결과 — 묶어 보기 · 부분 필터 · 열 거르기 · 정렬 · 결과 안 찾기 · 격자 · 위 조건으로 · 휴대폰 카드 (v13.266)
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
  var WHO = ['묶음가', '묶음나', '묶음다'], CL = ['가거래처', '나거래처'], OC = ['가수주명', '나수주명'];
  var setup = function () {
    return page.evaluate(function (WHO) {
      setPage('team'); setMode('weekly'); sTab('tbl');
      if (editMode) cancelEdits();
      pickWeek('20261025'); deAll(); WHO.forEach(function (n) { togN(aN.indexOf(n)); });
    }, WHO);
  };
  var S = function () { return page.evaluate(function () { return { g: document.querySelectorAll('#tBody tr.wd-g').length, s: document.querySelectorAll('#tBody tr.wd-s').length, r: document.querySelectorAll('#tBody tr:not(.wd-g):not(.wd-s) td.oc-cell').length, kpi: +document.getElementById('sC').textContent, wd: wdF.length, f: lastFiltered.length }; }); };
  try {
    var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
    await c.query("DELETE FROM work_records WHERE content LIKE 'E2E묶음%'");
    var days = ['20261026', '20261027', '20261028', '20261029', '20261030'];
    for (var i = 0; i < days.length; i++) for (var j = 0; j < WHO.length; j++) for (var k = 0; k < 2; k++) {
      await c.query("INSERT INTO work_records (date, name, order_no, hours, abbr, task_type, content, oclient, ocmt, user_id, tenant_id) VALUES ($1, $2, $3, $4, $5, '설계', $6, $7, $8, $9, $10)",
        [days[i], WHO[j], 'E2E-D' + k, j + 1 + k, k ? 'D' : 'M', 'E2E묶음 ' + i + j + k + (i === 2 && j === 1 && k === 0 ? ' 찾을말' : ''), CL[k], OC[k], adm.id, adm.tenant_id]);
    }
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { localStorage.removeItem('wm-wd'); } catch (e) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await ready();
    await setup(); await wait(300);

    // 묶어 보기 — 처음엔 사람마다 요약 한 줄
    var s0 = await S();
    check(s0.g === 3 && s0.r === 0 && s0.kpi === 30, '사람으로 묶음 — 요약 3줄만 ' + JSON.stringify(s0));
    var head = await page.$eval('#tBody tr.wd-g', function (tr) { return tr.textContent; });
    check(/5일 · 10건/.test(head) && /h/.test(head), '요약 줄에 일수 · 건수 · 시간 ' + head.replace(/\s+/g, ' ').slice(0, 60));
    await page.click('#tBody tr.wd-g'); await wait(200);
    var s1 = await S();
    check(s1.s === 5 && s1.r === 10, '누르면 펼침 — 날짜 구분 5줄 + 기록 10줄 ' + JSON.stringify(s1));
    check(await page.evaluate(function () { var tr = Array.from(document.querySelectorAll('#tBody tr')).filter(function (t) { return t.querySelector('td.oc-cell'); })[0]; return tr.children[0].textContent === '' && tr.children[1].textContent === ''; }), '펼친 안쪽은 이름 · 날짜 반복 생략');
    check(await page.evaluate(function () { return /날짜|📅/.test(document.querySelector('#tBody tr.wd-s').textContent) || /\(\S\)/.test(document.querySelector('#tBody tr.wd-s').textContent); }), '날짜 구분 줄에 그날 합계');

    // 값 눌러 좁히기 — 거래처 '이것만'
    await page.evaluate(function () { document.querySelector('#tBody .oc-cl[data-wv="나거래처"]').click(); });
    await wait(150);
    check(await page.$('#wdMenu') !== null, '값 누르면 메뉴');
    await page.evaluate(function () { document.querySelector('#wdMenu [data-act="only"]').click(); });
    await wait(250);
    var s2 = await S();
    check(s2.wd === 1 && s2.kpi === 15 && await page.evaluate(function () { return lastFiltered.every(function (r) { return (r.oclient || '') === '나거래처'; }); }), '이것만 — 15건, KPI도 따라감 ' + JSON.stringify(s2));
    await (await page.$('#tTbl')).screenshot({ path: path.join(__dirname, '.shots', 'e2e33-pc-drill.png'), captureBeyondViewport: false }).catch(function () {});
    check(await page.evaluate(function () { var p = document.getElementById('wdPath'); return !p.classList.contains('hidden') && /전체 30건/.test(p.textContent) && /나거래처/.test(p.textContent); }), '경로 — 전체 30건 › 🏢 나거래처');
    // 사람 빼기
    await page.evaluate(function () { var s = document.createElement('span'); s.dataset.wk = 'name'; s.dataset.wv = '묶음다'; document.body.appendChild(s); wdValMenu(s); document.querySelector('#wdMenu [data-act="not"]').click(); s.remove(); });
    await wait(200);
    check((await S()).kpi === 10, '이것 빼기 — 묶음다 빼고 10건');
    await page.keyboard.press('Backspace'); await wait(200);
    check((await S()).wd === 1, 'Backspace — 한 단계 뒤로');
    await page.evaluate(function () { wdClear(); }); await wait(150);
    check((await S()).kpi === 30 && await page.$eval('#wdPath', function (e) { return e.classList.contains('hidden'); }), '모두 풀기');

    // 열 머리 거르기 — 수주명 목록에서 고르기
    await page.evaluate(function () { document.querySelector('#wrTbl th.oc-th .wd-th').click(); }); await wait(150);
    var cm = await page.evaluate(function () { return Array.from(document.querySelectorAll('#wdMenu .wd-cm-row')).map(function (r) { return r.textContent; }); });
    check(cm.length === 2 && /15건/.test(cm[0]), '열 거르기 목록 — 값마다 건수 · 시간 ' + JSON.stringify(cm));
    await page.evaluate(function () { document.querySelector('#wdMenu .wd-cm-row input[value="가수주명"]').click(); document.querySelector('#wdMenu [data-act="ok"]').click(); });
    await wait(200);
    check((await S()).kpi === 15 && await page.$eval('#wrTbl th.oc-th', function (t) { return t.classList.contains('wd-filtered'); }), '목록에서 고른 값만 · 머리에 표시');
    await page.evaluate(function () { wdClear(); });

    // 정렬 — 시간 많은 순이면 많은 사람이 위로
    await page.evaluate(function () { document.querySelector('#wrTbl th[data-sk="hours"] .wd-sk').click(); }); await wait(200);
    var order = await page.evaluate(function () { return Array.from(document.querySelectorAll('#tBody tr.wd-g')).map(function (t) { return t.querySelector('b').textContent; }); });
    check(order[0] === '묶음다' && await page.evaluate(function () { return wdSort.k === 'hours' && wdSort.d === -1; }), '시간 많은 순 — 묶음 순서도 ' + order.join(','));
    await page.evaluate(function () { wdSetSort(''); });

    // 결과 안에서 찾기 — 줄은 그대로, 해당 묶음 펼치고 강조
    await page.evaluate(function () { wdOpenAll(false); });
    await page.type('#wdFind', '찾을말'); await wait(500);
    var fd = await page.evaluate(function () { return { n: document.getElementById('wdFindN').textContent, kpi: +document.getElementById('sC').textContent, hl: document.querySelectorAll('#tBody mark.wd-hl').length, cur: document.querySelectorAll('#tBody tr.wd-cur').length }; });
    check(fd.n === '1/1' && fd.kpi === 30 && fd.hl === 1 && fd.cur === 1, '결과 안 찾기 — 1/1 · 강조 · 줄 수 그대로 ' + JSON.stringify(fd));
    await page.evaluate(function () { var f = document.getElementById('wdFind'); f.value = ''; wdFindInput(''); }); await wait(300);

    // 날짜 · 낱개 묶음
    await page.evaluate(function () { wdSetGroup('date'); }); await wait(150);
    check((await S()).g === 5, '날짜로 묶음 — 5줄');
    await page.evaluate(function () { wdSetGroup('none'); }); await wait(150);
    var s3 = await page.evaluate(function () { return { r: document.querySelectorAll('#tBody td.oc-cell').length, sep: document.querySelectorAll('#tBody tr.wd-sep').length }; });
    check(s3.r >= 20 && s3.sep >= 1, '낱개 — 날짜 바뀌는 곳에 구분선 ' + JSON.stringify(s3));

    // 격자 — 칸 누르면 그 사람의 그날 업무
    await page.evaluate(function () { wdSetGroup('grid'); }); await wait(200);
    var gr = await page.evaluate(function () { return { rows: document.querySelectorAll('#wdGrid tbody tr').length, cols: document.querySelectorAll('#wdGrid thead th').length, tw: getComputedStyle(document.querySelector('#tTbl .tw')).display }; });
    check(gr.rows === 3 && gr.cols === 9 && gr.tw === 'none', '격자 — 3명 × 7일(+이름 · 합계), 표는 숨김 ' + JSON.stringify(gr));
    await page.evaluate(function () { document.querySelector('#wdGrid td.wd-gc[data-gn="묶음나"][data-gd="20261028"]').click(); }); await wait(250);
    var gs = await page.evaluate(function () { return { kpi: +document.getElementById('sC').textContent, rows: document.querySelectorAll('#tBody td.oc-cell').length, sel: document.querySelectorAll('#wdGrid td.sel').length, grid: document.querySelectorAll('#wdGrid tbody tr').length }; });
    await (await page.$('#tTbl')).screenshot({ path: path.join(__dirname, '.shots', 'e2e33-pc-grid.png') }).catch(function () {});
    check(gs.kpi === 2 && gs.rows === 2 && gs.sel === 1 && gs.grid === 3, '칸 → 그날 2건이 아래 표에, 격자는 그대로 ' + JSON.stringify(gs));

    // 위 조건으로 올리기
    await page.evaluate(function () { wdPromote(); }); await wait(300);
    var pr = await page.evaluate(function () { return { n: Array.from(sN).join(), wk: selWeek && selWeek.start + '~' + selWeek.end, wd: wdF.length, tags: document.getElementById('nameSel').textContent }; });
    check(pr.n === '묶음나' && pr.wk === '20261028~20261028' && pr.wd === 0, '위 조건으로 — 팀원 · 기간이 위로 ' + JSON.stringify(pr));

    // 내보내기 범위
    await setup(); await page.evaluate(function () { wdSetGroup('name'); wdAdd('client', '가거래처'); }); await wait(200);
    var ex = await page.evaluate(function () { var a = wdExportRows().length; wdExpAll = true; var b = wdExportRows().length; wdExpAll = false; return [a, b]; });
    check(ex[0] === 15 && ex[1] === 30, '내보내기 — 보이는 것만 15 / 위 조건 전체 30');

    // 편집 모드 — 좁힌 기록만 평평한 표로
    await page.evaluate(function () { togEdit(); }); await wait(200);
    var ed = await page.evaluate(function () { return { rows: document.querySelectorAll('#tBody td[data-field="ocmt"]').length, bar: getComputedStyle(document.getElementById('wdBar')).display }; });
    check(ed.rows === 15 && ed.bar === 'none', '편집 모드 — 좁힌 15건만 · 묶음 막대 숨김 ' + JSON.stringify(ed));
    await page.evaluate(function () { cancelEdits(); wdClear(); wdSetGroup('date'); }); await wait(300);

    // 묶음 기준 기억
    await page.reload({ waitUntil: 'networkidle2' }); await ready(); await setup(); await wait(300);
    check(await page.evaluate(function () { return wdGroup === 'date' && document.querySelector('#wdBar [data-g="date"]').classList.contains('on'); }), '묶음 기준 기억 (날짜)');
    await page.evaluate(function () { wdSetGroup('name'); });

    // 휴대폰 — 카드
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await ready(); await setup(); await wait(500);
    var mb = await page.evaluate(function () { return { cards: document.querySelectorAll('#wdCards .wdc-g').length, tw: getComputedStyle(document.querySelector('#tTbl .tw')).display, kpiH: document.getElementById('kpiSticky').offsetHeight, sw: document.documentElement.scrollWidth }; });
    check(mb.cards === 3 && mb.tw === 'none', '휴대폰 — 표 대신 사람 카드 3장 ' + JSON.stringify(mb));
    check(mb.kpiH < 80, 'KPI 한 줄 요약 바 (높이 ' + mb.kpiH + ')');
    check(mb.sw <= 392, '가로 넘침 없음 ' + mb.sw);
    await page.evaluate(function () { document.querySelector('#wdCards .wdc-g').click(); }); await wait(200);
    var mc = await page.evaluate(function () { return { r: document.querySelectorAll('#wdCards .wdc-r').length, s: document.querySelectorAll('#wdCards .wdc-s').length, cw: document.querySelector('#wdCards .wdc-r').offsetWidth }; });
    check(mc.r === 10 && mc.s === 5 && mc.cw <= 380, '카드 누르면 날짜별 업무 카드 ' + JSON.stringify(mc));
    await (await page.$('#tTbl')).screenshot({ path: path.join(__dirname, '.shots', 'e2e33-phone-cards.png') });
    // 길게 누르기 → 아래 메뉴
    await page.evaluate(function () {
      var el = document.querySelector('#wdCards .wdc-r .oc-cl'), r = el.getBoundingClientRect();
      var t = new Touch({ identifier: 1, target: el, clientX: r.left + 5, clientY: r.top + 5 });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true }));
    });
    await wait(650);
    check(await page.evaluate(function () { var m = document.getElementById('wdMenu'); return !!m && m.classList.contains('sheet') && !!document.getElementById('wdMenuBk'); }), '길게 누르면 아래에서 메뉴');
    await page.evaluate(function () { var el = document.querySelector('#wdCards .wdc-r .oc-cl'); var t = new Touch({ identifier: 1, target: el, clientX: 10, clientY: 10 }); el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true })); });
    await page.screenshot({ path: path.join(__dirname, '.shots', 'e2e33-phone-sheet.png') });
    await page.evaluate(function () { document.querySelector('#wdMenu [data-act="only"]').click(); }); await wait(300);
    check((await S()).wd === 1, '휴대폰에서도 이것만');
    // 왼쪽 끝에서 밀기 → 뒤로
    await page.evaluate(function () {
      var el = document.getElementById('wdCards');
      var a = new Touch({ identifier: 2, target: el, clientX: 5, clientY: 400 }), b = new Touch({ identifier: 2, target: el, clientX: 160, clientY: 405 });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [a], changedTouches: [a], bubbles: true }));
      el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [b], bubbles: true }));
    });
    await wait(300);
    check((await S()).wd === 0, '왼쪽 끝에서 밀면 한 단계 뒤로');
    // 휴대폰 격자
    await page.evaluate(function () { wdSetGroup('grid'); }); await wait(300);
    var mg = await page.evaluate(function () { var g = document.querySelector('#wdGrid .wd-gw'); return { rows: document.querySelectorAll('#wdGrid tbody tr').length, w: g.scrollWidth, cw: g.clientWidth }; });
    check(mg.rows === 3 && mg.w <= mg.cw + 2, '휴대폰 격자 — 한 화면에 ' + JSON.stringify(mg));
    await (await page.$('#tTbl')).screenshot({ path: path.join(__dirname, '.shots', 'e2e33-phone-grid.png') });
    await page.evaluate(function () { wdSetGroup('name'); });
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    await c.query("DELETE FROM work_records WHERE content LIKE 'E2E묶음%'");
    await browser.close(); await c.end();
  }
})();
