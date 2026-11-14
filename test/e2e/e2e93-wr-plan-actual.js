// 주간 업무 › 🎯 계획 대비 실적 (v13.492) — 계획 ↔ 실적 짝짓기 · KPI · 부족 요인 · 차트 툴팁 · 거르기(인원) · 조합 저장 · 좁은 화면
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(d.defaultValue() || '조합 시험'); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var team = 'PA팀' + Date.now();
  var made = [];
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  try {
    var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
    await c.query("DELETE FROM work_records WHERE content LIKE 'E2EPA%'");
    var hrs = [['20261007', '이', 'C사', 'A', 8], ['20261006', '홍', 'A사', 'D', 46], ['20261014', '홍', 'A사', 'D', 30], ['20261008', '김', '', 'V', 8]];
    for (var i = 0; i < hrs.length; i++) {
      await c.query("INSERT INTO work_records (date, name, order_no, hours, abbr, content, oclient, ocmt, user_id, tenant_id) VALUES ($1,$2,'E2EPA',$5,$4,'E2EPA 작업',$3,'시험',$6,$7)",
        [hrs[i][0], hrs[i][1], hrs[i][2], hrs[i][3], hrs[i][4], adm.id, adm.tenant_id]);
    }
    await page.setViewport({ width: 1500, height: 1000 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    made = await page.evaluate(async function (team) {
      async function put(ws, we, last, cur) { var r = await apiFetch('/api/weekly-reports', { method: 'POST', body: JSON.stringify({ autoName: { team: team, weekStart: ws, weekEnd: we }, lastText: last, curText: cur }) }); return r.data[0].id; }
      return [
        await put('2026-10-05', '2026-10-09', '', '[개발]\n- [A사] 검사기 UI ~12/30 20% @홍\n- [B사] 비전 모듈 @김\n[C/S]\n- [C사] 통신 점검 @이\n[기타]\n- [D사] 교육 @박'),
        await put('2026-10-12', '2026-10-16', '[개발]\n- [A사] 검사기 UI ~12/30 40% @홍\n- [B사] 비전 모듈 #완료 @김\n[C/S]\n- [E사] 긴급 A/S #완료 @김', '[개발]\n- [A사] 검사기 UI ~12/30 40% @홍\n- [B사] 비전 모듈 2차 @김'),
        await put('2026-10-19', '2026-10-23', '[개발]\n- [A사] 검사기 UI ~12/30 40% @홍\n- [B사] 비전 모듈 2차 #진행중 @김', '[개발]\n- [A사] 검사기 UI ~12/30 50% @홍')
      ];
    }, team);
    await page.evaluate(function () { try { localStorage.removeItem('wr-pa-state'); localStorage.removeItem('wr-pa-sets'); } catch (e) {} });
    await page.click('#pageTabs [data-page="team"]'); await page.click('#tabWeeklyReport');
    await page.waitForSelector('#wrSubTabs [data-wt="pa"]');
    await page.click('#wrSubTabs [data-wt="pa"]');
    await page.waitForSelector('#wpaTeam');
    await page.waitForFunction(function (t) { return Array.from(document.querySelectorAll('#wpaTeam option')).some(function (o) { return o.value === t; }); }, { timeout: 8000 }, team);
    await page.select('#wpaTeam', team);
    await page.click('#wpaWeeks [data-w="custom"]');
    await page.$eval('#wpaFrom', function (e) { e.value = '2026-10-05'; });
    await page.$eval('#wpaTo', function (e) { e.value = '2026-10-19'; e.dispatchEvent(new Event('change')); });
    // 팀을 고를 때 한 번 · 기간을 바꿀 때 한 번 조회 — 두 번째가 끝나 그려질 때까지
    await page.waitForFunction(function () { var b = document.getElementById('wpaBody'); return b && !b.classList.contains('wpa-loading') && /10\/05 ~ 10\/12/.test((document.querySelector('.wpa-head') || {}).textContent || ''); }, { timeout: 8000 }).catch(function () {});
    await wait(300);
    var k = await page.evaluate(function () {
      return { head: document.querySelector('.wpa-head').textContent, tiles: Array.from(document.querySelectorAll('.wpa-kpi')).map(function (t) { return t.textContent; }),
        diag: Array.from(document.querySelectorAll('.wpa-d b')).map(function (b) { return b.textContent; }), charts: document.querySelectorAll('.wpa-chart svg').length,
        people: Array.from(document.querySelectorAll('.wpa-t tbody tr')).map(function (r) { return r.textContent; }).join(' | ') };
    });
    check(/10\/05 ~ 10\/12 주 · 2주 비교/.test(k.head) && /실적 보고 대기: 10\/19/.test(k.head), '비교 주 · 실적 대기 주 ' + k.head);
    check(/이행률66\.7%/.test(k.tiles[0]) && /완료율16\.7%/.test(k.tiles[1]), 'KPI 이행률 66.7% · 완료율 16.7% ' + k.tiles.slice(0, 2));
    check(/계획 6건1 \/ 3 \/ 1 \/ 1/.test(k.tiles[2]), '계획 결과 완료/진척/정체/못 함 ' + k.tiles[2]);
    check(k.diag.indexOf('보고 누락 의심') >= 0 && k.diag.indexOf('일부 인원 과부하') >= 0, '부족 요인 — 보고 누락 · 과부하 ' + k.diag.join(','));
    check(k.charts === 3, '차트 3개');
    check(/홍/.test(k.people) && /🔥|76h/.test(k.people), '사람별 표에 시간');
    // 툴팁
    var hit = await page.$('.wpa-chart .wpa-hit');
    var bb = await hit.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await wait(150);
    var tip = await page.$eval('.wpa-chart .wpa-tip', function (e) { return e.hidden ? '' : e.textContent; });
    check(/10\/05 주/.test(tip) && /이행률 75%/.test(tip), '차트에 마우스 → 그 주 값 ' + JSON.stringify(tip));
    await page.screenshot({ path: path.join(SHOT, 'wr-plan-actual.png'), fullPage: true });
    // 거르기 — 인원: 김
    await page.click('[data-fopen="members"]');
    await page.waitForSelector('#wpaPopL input');
    await page.evaluate(function () { var c = Array.from(document.querySelectorAll('#wpaPopL input')).filter(function (x) { return x.value === '김'; })[0]; c.click(); });
    await page.click('#wpaPop [data-papply]');
    await page.waitForFunction(function () { return /거른 결과/.test((document.querySelector('.wpa-head') || {}).textContent || ''); }, { timeout: 8000 }).catch(function () {});
    var kim = await page.evaluate(function () { return { t: document.querySelector('.wpa-kpi').textContent, chips: document.getElementById('wpaFbar').textContent }; });
    check(/이행률100%/.test(kim.t) && /👤 김/.test(kim.chips), '인원 김으로 거르면 이행률 100% ' + JSON.stringify(kim));
    // 조합 저장 → 지우고 → 불러오기
    await page.click('#wpaSave');
    await wait(400);
    var sets = await page.evaluate(function () { return JSON.parse(localStorage.getItem('wr-pa-sets') || '[]').map(function (x) { return x.name; }); });
    check(sets.length === 1, '⭐ 조합 저장 ' + JSON.stringify(sets));
    await page.click('#wpaFbar [data-fclear]');
    await page.waitForFunction(function () { return !/거른 결과/.test((document.querySelector('.wpa-head') || {}).textContent || ''); }, { timeout: 8000 }).catch(function () {});
    await page.select('#wpaSets', '0');
    await page.waitForFunction(function () { return /거른 결과/.test((document.querySelector('.wpa-head') || {}).textContent || ''); }, { timeout: 8000 }).catch(function () {});
    check(/👤 김/.test(await page.$eval('#wpaFbar', function (e) { return e.textContent; })), '저장한 조합 불러오기');
    // 표 이름 눌러 거르기 추가 (업체)
    await page.click('#wpaFbar [data-fclear]'); await wait(600);
    await page.evaluate(function () { var b = Array.from(document.querySelectorAll('.wpa-link[data-add="clients"]')).filter(function (x) { return x.dataset.v === 'A사'; })[0]; b.click(); });
    await page.waitForFunction(function () { return /🏢 A사/.test(document.getElementById('wpaFbar').textContent); }, { timeout: 8000 }).catch(function () {});
    var a = await page.$eval('.wpa-kpi', function (e) { return e.textContent; });
    check(/이행률50%/.test(a), '업체 A사 이름 눌러 거르기 → 이행률 50% ' + a);
    // 좁은 화면 — 가로로 넘치지 않음
    await page.setViewport({ width: 390, height: 860 });
    await wait(400);
    // 문서뿐 아니라 화면 안 카드 · 막대가 오른쪽으로 잘리지 않는지 (바깥 틀이 넘침을 숨겨도 잡게)
    var ov = await page.evaluate(function () {
      var W = window.innerWidth, worst = document.documentElement.scrollWidth - W;
      document.querySelectorAll('.wpa-kpi, .wpa-card, .wpa-fbar, .wpa-bar, .wpa-d').forEach(function (e) { worst = Math.max(worst, Math.round(e.getBoundingClientRect().right - W)); });
      return worst;
    });
    check(ov <= 1, '390px — 가로 넘침 없음 (' + ov + ')');
    await page.screenshot({ path: path.join(SHOT, 'wr-plan-actual-390.png'), fullPage: true });
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack || e);
  } finally {
    try {
      await c.query('DELETE FROM weekly_reports WHERE id = ANY($1::uuid[])', [made]);
      await c.query("DELETE FROM work_records WHERE content LIKE 'E2EPA%'");
    } catch (e) {}
    await c.end();
    await browser.close();
    console.log(fail ? 'e2e93 FAIL ' + fail : 'e2e93-wr-plan-actual.js ALL PASS ' + ok, '[]');
    process.exit(fail ? 1 : 0);
  }
})();
