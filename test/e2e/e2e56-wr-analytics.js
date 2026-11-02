// 업무일지 › 주간 분석 › 📊 분석 (v13.312) — 숫자 · 지난 기간 비교 · 한눈에 · 시간 구성 · 날짜별 · 사람별 · 업체/수주 순위 · 월별 · 말풍선 · 휴대폰
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  try {
    var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
    await c.query("DELETE FROM work_records WHERE content LIKE 'E2E분석%'");
    async function put(d, n, no, h, ab, cl, nm, tt) {
      await c.query("INSERT INTO work_records (date, name, order_no, hours, abbr, task_type, content, oclient, ocmt, user_id, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [d, n, no, h, ab, tt || '업무', 'E2E분석 ' + n, cl, nm, adm.id, adm.tenant_id]);
    }
    // 지난주(09/07~11) · 이번 주(09/14~18) — 분석E1 이번 주 하루 10h(과부하) · E2 마지막 날 휴가 · E3 하루 5h(적음)
    var prev = ['20260907', '20260908', '20260909', '20260910', '20260911'], cur = ['20260914', '20260915', '20260916', '20260917', '20260918'];
    for (var i = 0; i < 5; i++) {
      await put(prev[i], '분석E1', 'EA-1', 8, 'D', 'X업체', '검사기');
      await put(prev[i], '분석E2', 'EA-1', 4, 'A', 'X업체', '검사기'); await put(prev[i], '분석E2', '공통', 4, 'G', '', '');
      await put(prev[i], '분석E3', 'EA-2', 5, 'M', 'Y업체', '양산 지원');
      await put(cur[i], '분석E1', 'EA-1', 10, 'D', 'X업체', '검사기');
      if (i < 4) { await put(cur[i], '분석E2', 'EA-1', 4, 'A', 'X업체', '검사기'); await put(cur[i], '분석E2', '공통', 4, 'G', '', ''); }
      else await put(cur[i], '분석E2', '', 8, 'V', '', '', '휴가');
      await put(cur[i], '분석E3', 'EA-2', 5, 'M', 'Y업체', '양산 지원');
    }
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading') && aD.length > 0; }, { timeout: 60000 });
    await page.evaluate(function () { setPage('team'); setMode('weekly'); deAll(); ['분석E1', '분석E2', '분석E3'].forEach(function (n) { togN(aN.indexOf(n)); }); });
    await wait(600);
    await page.evaluate(function () { document.getElementById('dateRangeFrom').value = '2026-09-14'; document.getElementById('dateRangeTo').value = '2026-09-18'; pickDateRange(); sTab('cht'); });
    await page.waitForSelector('#waBox .wa-tiles', { timeout: 8000 });
    var lbl = await page.$eval('#statsS .tab[data-t="cht"]', function (b) { return b.textContent; });
    check(/분석/.test(lbl), '탭 이름 📊 분석');
    var v = await page.evaluate(function () {
      var t = {}; document.querySelectorAll('#waBox .wa-t').forEach(function (x) { t[x.querySelector('.wa-tl').textContent] = { v: x.querySelector('.wa-tv').textContent, s: x.querySelector('.wa-ts').textContent }; });
      return { t: t, scope: document.querySelector('.wa-scope').textContent, find: Array.prototype.map.call(document.querySelectorAll('#waFindC li'), function (l) { return l.textContent; }) };
    });
    check(/09\/14 ~ 09\/18/.test(v.scope) && /지난 기간 09\/07 ~ 09\/11/.test(v.scope), '기간 · 지난 기간(지난주 월~금) ' + v.scope);
    check(v.t['업무 시간'].v === '107h' && /▲ 1\.9%/.test(v.t['업무 시간'].s) && /휴가 8h/.test(v.t['업무 시간'].s), '업무 시간 107h · ▲1.9% · 휴가 8h ' + JSON.stringify(v.t['업무 시간']));
    check(/^7\.6h/.test(v.t['인당 하루 평균'].v) && /14인·일/.test(v.t['인당 하루 평균'].s), '인당 하루 평균 7.6h (14인·일) ' + JSON.stringify(v.t['인당 하루 평균']));
    check(v.t['수주 투입률'].v === '85%', '수주 투입률 85% ' + v.t['수주 투입률'].v);
    check(v.t['업체 미지정'].v === '15%', '업체 미지정 15% ' + v.t['업체 미지정'].v);
    check(v.t['8h 미달'].v === '15h' && /5인·일/.test(v.t['8h 미달'].s), '8h 미달 15h (5인·일) ' + JSON.stringify(v.t['8h 미달']));
    check(v.find.some(function (f) { return /분석E1 하루 평균 10h — 과부하/.test(f); }) && v.find.some(function (f) { return /분석E3 하루 평균 5h — 기록이 빠졌는지/.test(f); }) && v.find.some(function (f) { return /업체 미지정 15%/.test(f); }), '한눈에 — 과부하 · 적음 · 미지정 ' + JSON.stringify(v.find));

    var mix = await page.evaluate(function () {
      var rows = Array.prototype.map.call(document.querySelectorAll('#waMixC tbody tr'), function (r) { return r.children[0].textContent + '=' + r.children[2].textContent; });
      var sum = Array.prototype.reduce.call(document.querySelectorAll('#waMixC tbody tr td:nth-child(3)'), function (s, td) { return s + parseFloat(td.textContent); }, 0);
      return { rows: rows, sum: Math.round(sum), segs: document.querySelectorAll('#waMixC .wa-sg').length };
    });
    check(mix.segs === mix.rows.length && Math.abs(mix.sum - 100) <= 1 && mix.rows.some(function (r) { return /8h 미달/.test(r); }), '시간 구성 — 막대 조각 = 표 줄 · 합 100% · 8h 미달 따로 ' + JSON.stringify(mix));
    var ppl = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('#waPplC .wa-pr'), function (r) { return r.querySelector('.wa-pn').textContent + ':' + r.querySelector('.wa-pv').textContent; }); });
    check(ppl[0] === '분석E1:▲10h' && ppl.indexOf('분석E3:▼5h') >= 0, '사람별 — 과부하 ▲ · 적음 ▼ ' + JSON.stringify(ppl));
    var day = await page.evaluate(function () { return { hits: document.querySelectorAll('#waDayC .wa-hit').length, cap: document.querySelectorAll('#waDayC .wa-cap').length, tbl: document.querySelectorAll('#waDayC details tbody tr').length }; });
    check(day.hits === 5 && day.cap === 5 && day.tbl === 5, '날짜별 — 5일 · 기준선 · 표로 보기 ' + JSON.stringify(day));
    // 말풍선
    await page.evaluate(function () { document.querySelector('#waDayC').scrollIntoView({ block: 'center' }); });
    await wait(100);
    var box = await page.$('#waDayC .wa-hit');
    var bb = await box.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await wait(150);
    var tip = await page.evaluate(function () { var t = document.getElementById('waTip'); return t && t.style.display !== 'none' ? t.textContent : null; });
    check(tip && /기준 24h/.test(tip) && /3명/.test(tip), '말풍선 — 합계 / 기준 · 인원 ' + tip);
    // 업체 순위 · 80% 선 · 수주로 바꾸기
    var rk = await page.evaluate(function () { return { rows: Array.prototype.map.call(document.querySelectorAll('#waTopC tbody tr'), function (r) { return r.children[0].textContent + ':' + r.children[2].textContent; }), cut: !!document.querySelector('#waTopC tr.wa-80') }; });
    check(rk.rows[0] === 'X업체:61.7%' && rk.cut, '업체 순위 1위 X업체 · 80% 선 ' + JSON.stringify(rk));
    await page.evaluate(function () { document.querySelector('[data-wa-dim="order"]').click(); });
    await wait(150);
    var ord = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('#waTopC tbody tr .wa-tn'), function (t) { return t.textContent; }); });
    check(ord.length === 2 && /검사기/.test(ord[0]) && /EA-1/.test(ord[0]), '수주 순위 ' + JSON.stringify(ord));
    // 월별 — 사람 · 3개월
    await page.evaluate(function () { document.querySelector('[data-wa-mdim="person"]').click(); });
    await wait(100);
    await page.evaluate(function () { document.querySelector('[data-wa-mn="3"]').click(); });
    await wait(150);
    var mo = await page.evaluate(function () { return { head: Array.prototype.map.call(document.querySelectorAll('#waMonC thead th'), function (t) { return t.textContent; }), rows: Array.prototype.map.call(document.querySelectorAll('#waMonC tbody tr .wa-tn'), function (t) { return t.textContent; }), heat: document.querySelectorAll('#waMonC td.wa-hm[style]').length }; });
    check(mo.head[0] === '사람' && mo.head.indexOf('9월') >= 0 && mo.rows.length === 3 && mo.heat >= 3, '월별 — 사람 · 3개월 ' + JSON.stringify(mo));
    check(await page.evaluate(function () { var s = JSON.parse(localStorage.getItem('wm-wa')); return s.dim === 'order' && s.mDim === 'person' && s.mN === 3; }), '보기 고른 것 기억');
    await page.screenshot({ path: path.join(__dirname, '.shots', 'wa-desk.png'), fullPage: true });
    // 다른 기간이 없으면 비교 생략 · 필터 바뀌면 다시 그림
    await page.evaluate(function () { document.getElementById('dateRangeFrom').value = '2026-09-07'; document.getElementById('dateRangeTo').value = '2026-09-11'; pickDateRange(); });
    await wait(400);
    var p2 = await page.evaluate(function () { return document.querySelector('.wa-scope').textContent + ' | ' + document.querySelector('.wa-t .wa-tv').textContent; });
    check(/09\/07 ~ 09\/11/.test(p2) && /105h/.test(p2), '필터 바꾸면 다시 그림 ' + p2);
    // 휴대폰
    await page.evaluate(function () { document.getElementById('dateRangeFrom').value = '2026-09-14'; document.getElementById('dateRangeTo').value = '2026-09-18'; pickDateRange(); });
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true });
    await wait(700);
    await page.evaluate(function () { rCht(); });
    await wait(300);
    var mob = await page.evaluate(function () {
      var wide = Array.prototype.filter.call(document.querySelectorAll('#waBox *'), function (e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.right > 404 && !e.closest('.wa-tw,.wa-chart'); }).slice(0, 5).map(function (e) { return (e.className && e.className.baseVal != null ? e.className.baseVal : e.className) + ':' + Math.round(e.getBoundingClientRect().right); });
      return { sw: document.documentElement.scrollWidth, wide: wide, tiles: getComputedStyle(document.querySelector('.wa-tiles')).gridTemplateColumns.split(' ').length };
    });
    check(mob.sw <= 402 && !mob.wide.length && mob.tiles === 2, '휴대폰 — 넘침 없음 · 숫자 2칸 ' + JSON.stringify(mob));
    await page.screenshot({ path: path.join(__dirname, '.shots', 'wa-phone.png'), fullPage: true });
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack);
  }
  try { await c.query("DELETE FROM work_records WHERE content LIKE 'E2E분석%'"); } catch (e) {}
  await c.end();
  await browser.close();
  console.log(fail ? ('FAILED ' + fail + ' / ' + (ok + fail)) : ('ALL PASS (' + ok + ')'));
  process.exit(fail ? 1 : 0);
})();
