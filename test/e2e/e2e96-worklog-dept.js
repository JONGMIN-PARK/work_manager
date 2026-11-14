// 🏢 업무일지 사업부 (v13.498) — 서버가 내려 줄 때 사업부를 붙임(저장된 것 → 없으면 작성자 부서) · 주간 분석 🏢 사업부 단추 · 고르면 그 사업부 사람만
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var adm = (await c.query("SELECT id, tenant_id, name, department_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var kim = (await c.query("SELECT id, name, department_id FROM users WHERE email = 'kim@t.com'")).rows[0];
  var T = adm.tenant_id, S = Date.now(), made = [], keepDept = [[adm.id, adm.department_id], [kim.id, kim.department_id]];
  var browser;
  try {
    var d1 = (await c.query('INSERT INTO departments (name, tenant_id) VALUES ($1, $2) RETURNING id', ['장비사업부' + S, T])).rows[0].id;
    var d2 = (await c.query('INSERT INTO departments (name, tenant_id) VALUES ($1, $2) RETURNING id', ['모션사업부' + S, T])).rows[0].id;
    made = [d1, d2];
    await c.query('UPDATE users SET department_id = $1 WHERE id = $2', [d1, adm.id]);
    await c.query('UPDATE users SET department_id = $1 WHERE id = $2', [d2, kim.id]);
    await c.query("DELETE FROM work_records WHERE content LIKE 'E2EDEPT%'");
    var recs = [[adm.name, null], [kim.name, null], ['외부작성자' + S, '기술연구소' + S]];   // 마지막은 파일에서 고른 사업부가 저장된 것
    for (var i = 0; i < recs.length; i++) {
      await c.query("INSERT INTO work_records (date, name, order_no, hours, abbr, content, dept, user_id, tenant_id) VALUES ('20261110', $1, 'E2E-D', 4, 'D', $2, $3, $4, $5)",
        [recs[i][0], 'E2EDEPT 작업 ' + i, recs[i][1], adm.id, T]);
    }
    browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + S) });
    var page = (await browser.pages())[0] || await browser.newPage();
    page.on('pageerror', function (e) { errs.push(e.message); });
    await page.setViewport({ width: 1500, height: 950 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'kim@t.com'); await page.type('#loginPw', 'Test1234!');   // 팀원으로 — 다른 사업부 것도 보여야 함
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    var api = await page.evaluate(function () {
      return apiFetch('/api/archives/records?startDate=20261110&endDate=20261110&all=true&limit=500').then(function (r) {
        return r.data.filter(function (x) { return /^E2EDEPT/.test(x.content); }).map(function (x) { return x.name + '=' + (x.dept || ''); });
      });
    });
    check(api.length === 3, '팀원도 다른 사업부 업무일지까지 3건 모두 받음 ' + api.length);
    check(api.indexOf(adm.name + '=장비사업부' + S) >= 0 && api.indexOf(kim.name + '=모션사업부' + S) >= 0, '저장된 사업부가 없으면 작성자의 부서로 붙음 ' + JSON.stringify(api));
    check(api.indexOf('외부작성자' + S + '=기술연구소' + S) >= 0, '파일에서 고른(저장된) 사업부가 먼저');
    // 주간 분석 — 🏢 단추
    await page.waitForFunction(function () { return typeof aD !== 'undefined' && aD.some(function (r) { return /^E2EDEPT/.test(r.content); }); }, { timeout: 15000 }).catch(function () {});
    await page.evaluate(function () { if (typeof setPage === 'function') setPage('team'); if (typeof setMode === 'function') setMode('weekly'); if (typeof renderDeptBtns === 'function') renderDeptBtns(); });
    await wait(500);
    var btns = await page.evaluate(function () { return Array.from(document.querySelectorAll('#deptQuickBtns button')).map(function (b) { return b.textContent.trim(); }); });
    check(btns.some(function (t) { return t.indexOf('장비사업부' + S) === 0; }) && btns.some(function (t) { return t.indexOf('모션사업부' + S) === 0; }) && btns[0] === '전체', '주간 분석에 🏢 사업부 단추 ' + JSON.stringify(btns.slice(0, 6)));
    await page.evaluate(function (d) { selDept(d); }, '모션사업부' + S);
    var sel = await page.evaluate(function () { return Array.from(sN); });
    check(sel.indexOf(kim.name) >= 0 && sel.indexOf(adm.name) < 0, '사업부를 고르면 그 사업부 사람만 ' + JSON.stringify(sel));
    await page.screenshot({ path: path.join(SHOT, 'worklog-dept.png') });
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack || e);
  } finally {
    try {
      for (var k = 0; k < keepDept.length; k++) await c.query('UPDATE users SET department_id = $1 WHERE id = $2', [keepDept[k][1], keepDept[k][0]]);
      await c.query("DELETE FROM work_records WHERE content LIKE 'E2EDEPT%'");
      if (made.length) await c.query('DELETE FROM departments WHERE id = ANY($1::uuid[])', [made]);
    } catch (e) { console.log('cleanup', e.message); }
    await c.end();
    if (browser) await browser.close();
    console.log(fail ? 'e2e96 FAIL ' + fail : 'e2e96-worklog-dept.js ALL PASS ' + ok, '[]');
    process.exit(fail ? 1 : 0);
  }
})();
