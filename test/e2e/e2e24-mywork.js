// 🎯 내 업무 · 👥 업무 부하 화면 — 묶음 · 개인 할 일 · 완료 체크 · 맵 주제로 바로 열기 · 칸 누르기 · 담당 바꾸기 (v13.248)
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var U = {};
  (await c.query("SELECT id, email, tenant_id FROM users WHERE email IN ('admin@t.com','kim@t.com')")).rows.forEach(function (r) { U[r.email.split('@')[0]] = r; });
  var tid = U.admin.tenant_id, me = U.admin.id;
  await c.query("DELETE FROM my_todos WHERE user_id = $1", [me]);
  await c.query("DELETE FROM mindmaps WHERE title LIKE '내업무%' OR title LIKE '알림 시험%'");
  await c.query("DELETE FROM issues WHERE id LIKE 'mwu-%'");
  await c.query("DELETE FROM meetings WHERE id LIKE 'mwu-%'");
  await c.query("DELETE FROM projects WHERE id LIKE 'mwu-%'");
  await c.query("DELETE FROM edit_locks WHERE resource_type = 'mindmap'");
  await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('mwu-p1', '화면 프로젝트', 'active', 'tenant', $1, $2)", [me, tid]);
  await c.query("INSERT INTO issues (id, project_id, title, status, urgency, due_date, assignees, tenant_id) VALUES ('mwu-i1', 'mwu-p1', '지연된 이슈', 'open', 'urgent', $1, '[\"관리자\"]', $2)", [kst(-3), tid]);
  await c.query("INSERT INTO meetings (id, project_id, title, meet_date, tenant_id) VALUES ('mwu-m1', 'mwu-p1', '화면회의', $1, $2)", [kst(0), tid]);
  await c.query("INSERT INTO meeting_action_items (id, meeting_id, title, assignee_id, assignee_name, due_date, status, tenant_id) VALUES ('mwu-a1', 'mwu-m1', '오늘 할 회신', $1, '관리자', $2, 'open', $3)", [me, kst(0), tid]);
  var mapId = 'mm-mwu1';
  var doc = { sheets: [{ id: 's1', title: '시트', structure: 'balanced', root: { id: 'r', text: '내업무 화면 맵', children: [
    { id: 'g', text: '설계', collapsed: true, children: [{ id: 'nx', text: '접힌 곳의 주제', assigneeId: me, dueDate: kst(1), progress: 25, children: [] }] }
  ] } }] };
  await c.query("INSERT INTO mindmaps (id, tenant_id, title, scope, owner_id, doc, node_count, version) VALUES ($1, $2, '내업무 화면 맵', 'org', $3, $4, 3, 1)", [mapId, tid, me, JSON.stringify(doc)]);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id; });
    await wait(500);
    check(await page.evaluate(function () { var t = document.getElementById('tabWorkload'); return t && t.style.display !== 'none'; }), '관리자에게 업무 부하 탭 보임');
    await page.click('#tabMyWork');
    await page.waitForSelector('#mMyWork .mw-grp');
    var g = await page.evaluate(function () {
      var o = {};
      document.querySelectorAll('#mMyWork .mw-grp').forEach(function (s) { o[s.getAttribute('data-grp')] = Array.from(s.querySelectorAll('.mw-title')).map(function (x) { return x.textContent; }); });
      return o;
    });
    check(g.late && g.late.some(function (t) { return /지연된 이슈/.test(t); }), '지연 묶음에 이슈 ' + JSON.stringify(g.late));
    check(g.today && g.today.indexOf('오늘 할 회신') >= 0, '오늘 묶음에 회의 액션');
    check(await page.evaluate(function () { var r = Array.from(document.querySelectorAll('#mMyWork .mw-g-late .mw-row')).filter(function (x) { return /지연된 이슈/.test(x.textContent); })[0]; return r && /D\+3/.test(r.querySelector('.mw-due').textContent); }), '지연 일수 D+3');
    // 개인 할 일 추가
    await page.type('#mwAddTitle', '견적 양식 정리');
    await page.click('#mwAdd button[type=submit]');
    await page.waitForFunction(function () { return Array.from(document.querySelectorAll('#mMyWork .mw-title')).some(function (x) { return x.textContent === '견적 양식 정리'; }); });
    check(await page.evaluate(function () { return !!document.querySelector('#mMyWork [data-grp="nodue"]'); }), '마감 없는 할 일 → 마감 없음 묶음');
    // 완료 체크 → 원래 자리 반영
    var key = await page.evaluate(function () { return _mw.data.data.filter(function (x) { return x.src === 'action'; })[0].key; });
    await page.click('#mMyWork input[data-done="' + key + '"]');
    await page.waitForFunction(function (k) { var s = document.querySelector('#mMyWork [data-grp="done"]'); return s && s.querySelector('[data-key="' + k + '"]'); }, {}, key);
    check((await c.query("SELECT status FROM meeting_action_items WHERE id = 'mwu-a1'")).rows[0].status === 'done', '체크 → 회의 액션 완료 · 다 한 것 으로');
    // 출처 거르기
    await page.click('#mMyWork .mw-chip[data-src="issue"]');
    check(await page.evaluate(function () { return Array.from(document.querySelectorAll('#mMyWork .mw-row')).every(function (r) { return /이슈/.test(r.querySelector('.mw-src').textContent); }); }), '출처 거르기 — 이슈만');
    await page.click('#mMyWork .mw-chip[data-src="all"]');
    await page.screenshot({ path: path.join(SHOT, 'mywork.png') });
    // 맵 주제 → 그 주제로 바로 열기 (접힌 위 단계 펴기)
    await page.evaluate(function () { var it = _mw.data.data.filter(function (x) { return x.nodeId === 'nx'; })[0]; document.querySelector('#mMyWork [data-open="' + it.key + '"]').click(); });
    await page.waitForFunction(function () { return _mm.view === 'editor' && document.querySelector('#mmStage .mm-node[data-id="nx"]'); }, { timeout: 8000 });
    await wait(200);
    check(await page.evaluate(function () { return _mm.sel === 'nx' && !!document.querySelector('#mmStage .mm-node.mm-sel[data-id="nx"]'); }), '맵이 열리고 그 주제가 골라짐 (접힌 위 단계 폄)');
    // 업무 부하
    await page.click('#tabWorkload');
    await page.waitForSelector('#mWorkload table.mw-load');
    var rowTxt = await page.evaluate(function (id) { var th = document.querySelector('#mWorkload th[data-drop="' + id + '"]'); return th && th.parentNode.textContent; }, me);
    check(!!rowTxt, '업무 부하 표에 내 줄');
    await page.click('#mWorkload td[data-cell="' + me + '|late"]');
    await page.waitForSelector('#mwLoadList .mw-ll-row');
    check(await page.evaluate(function () { return /지연된 이슈/.test(document.getElementById('mwLoadList').textContent); }), '지연 칸 → 목록에 이슈');
    await page.screenshot({ path: path.join(SHOT, 'workload.png') });
    // 담당 바꾸기 (고르기)
    await page.click('#mWorkload td[data-cell="' + me + '|all"]');
    await page.waitForFunction(function () { return /접힌 곳의 주제/.test(document.getElementById('mwLoadList').textContent); });
    var mk = await page.evaluate(function () { return _mw.load.items.filter(function (x) { return x.nodeId === 'nx'; })[0].key; });
    await page.select('#mWorkload select[data-move="' + mk + '"]', U.kim.id);
    await page.waitForFunction(function () { return _mw.load.items.some(function (x) { return x.nodeId === 'nx' && x.userId !== currentUser.id; }); }, { timeout: 8000 });
    var nx = (await c.query('SELECT doc FROM mindmaps WHERE id = $1', [mapId])).rows[0].doc.sheets[0].root.children[0].children[0];
    check(nx.assigneeId === U.kim.id, '담당 바꾸기 → 맵 문서 반영');
    // 휴대폰 폭
    await page.setViewport({ width: 390, height: 800 });
    await page.click('#tabMyWork');
    await wait(600);
    check(await page.evaluate(function () { return document.documentElement.scrollWidth <= 392; }), '휴대폰 폭에서 가로 넘침 없음');
    await page.screenshot({ path: path.join(SHOT, 'mywork-mobile.png') });
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); await c.end(); }
})();
