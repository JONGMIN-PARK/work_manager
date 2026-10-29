// 📁 내 업무 · 내 프로젝트 — 띠 · ＋ 프로젝트 · 패널 자동 저장 · 바로 할 일 · 목록 표 · 타임라인 막대 · 👁 · 전체 끄기 · 프로젝트별 줄
//    · 달력 띠 · 연계 후보 · 마일스톤 · 보드 ⋯ 프로젝트로 · 상세 패널 프로젝트 칸 · 완료 · 지우기 되돌리기 · 휴대폰 (v13.273)
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
  var me = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var tid = me.tenant_id;
  async function clean() {
    await c.query('DELETE FROM my_work_marks WHERE user_id = $1 AND project_id IS NOT NULL', [me.id]);
    await c.query('DELETE FROM my_projects WHERE user_id = $1', [me.id]);
    await c.query("DELETE FROM my_todos WHERE user_id = $1 AND title LIKE '프로젝트화면%'", [me.id]);
    await c.query("DELETE FROM milestones WHERE id LIKE 'mpe-%'");
    await c.query("DELETE FROM projects WHERE id LIKE 'mpe-%'");
  }
  await clean();
  // 후보가 이것 하나만 보이게 — 시드의 다른 진행 중 프로젝트는 시험 동안 잠깐 '끝남'으로
  var seedOpen = (await c.query("SELECT id, status FROM projects WHERE tenant_id = $1 AND COALESCE(status, '') NOT IN ('done','completed','cancelled') AND id NOT LIKE 'mpe-%' AND (owner_id = $2 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = projects.id AND m.user_id = $2 AND m.released_at IS NULL))", [tid, me.id])).rows;
  if (seedOpen.length) await c.query("UPDATE projects SET status = 'done' WHERE id = ANY($1)", [seedOpen.map(function (r) { return r.id; })]);
  await c.query("INSERT INTO projects (id, name, start_date, end_date, status, progress, visibility, owner_id, tenant_id) VALUES ('mpe-p1', '프로젝트화면 설비 B', $1, $2, 'active', 20, 'tenant', $3, $4)", [kst(-5), kst(45), me.id, tid]);
  await c.query("INSERT INTO milestones (id, project_id, name, end_date, status, tenant_id) VALUES ('mpe-ms1', 'mpe-p1', '프로젝트화면 출하', $1, 'progress', $2)", [kst(20), tid]);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function until(fn, arg, ms) { return page.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var ev = function (fn, arg) { return page.evaluate(fn, arg); };
  // 띠 · 보드는 응답이 올 때마다 다시 그려짐 — 잠잠해진 뒤 그 순간의 요소를 누름
  async function tap(sel) {
    await page.waitForNetworkIdle({ idleTime: 250, timeout: 5000 }).catch(function () {});
    await page.waitForSelector(sel);
    await ev(function (s) { document.querySelector(s).click(); }, sel);
  }
  async function row() { return (await c.query('SELECT * FROM my_projects WHERE user_id = $1 AND link_project_id IS NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [me.id])).rows[0]; }
  async function login() {
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(400);
  }
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { Object.keys(localStorage).filter(function (k) { return /^(mw|mtl)/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); } catch (_) {} });
    await login();
    await page.click('#tabMyWork');
    await page.waitForSelector('#mwjStrip');
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 10000 }).catch(function () {});

    // 1. 띠 — 비어 있으면 안내 · 연계 후보
    check(await ev(function () { var s = document.getElementById('mwjStrip'); return /몇 주/.test(s.textContent) && /연계 후보\s*1/.test(s.querySelector('[data-mwj="cands"]').textContent); }), '📁 띠 — 빈 안내 · 🔗 연계 후보 1');

    // 2. ＋ 프로젝트 → 패널 · 이름부터
    await tap('#mMyWork [data-mwj="new"]');
    check(await until(function () { var p = document.getElementById('mwjPanel'); return p && p.classList.contains('on') && document.activeElement && document.activeElement.id === 'mwjTitle'; }), '＋ 프로젝트 → 오른쪽 패널 · 이름 칸에 커서');
    await wait(350);
    await page.keyboard.type('프로젝트화면 신제품');
    check(await until(function () { return /저장됨/.test(document.getElementById('mwjSave').textContent); }, null, 5000), '이름 자동 저장');
    var r1 = await row();
    check(r1 && r1.title === '프로젝트화면 신제품' && r1.start_date === kst(0) && r1.end_date === kst(27), '기본 기간 오늘 ~ 4주 · 이름 저장 ' + JSON.stringify(r1 && [r1.title, r1.start_date, r1.end_date]));
    var pid = r1.id;
    check(await until(function (id) { var c = document.querySelector('#mwjStrip .mwj-c[data-pj="' + id + '"]'); return c && /프로젝트화면 신제품/.test(c.textContent) && c.classList.contains('mw-picked'); }, pid), '카드에 바로 반영 · 고른 표시');

    // 3. 패널에서 바로 할 일
    await page.click('#mwjAdd input');
    await page.keyboard.type('프로젝트화면 시안 검토 내일');
    await page.keyboard.press('Enter');
    check(await until(function () { return Array.from(document.querySelectorAll('#mwjPanel .mwj-its-t')).some(function (x) { return x.textContent === '프로젝트화면 시안 검토'; }); }), '패널 항목 목록에 바로');
    check(await until(function () { return Array.from(document.querySelectorAll('#mMyWork .mw-row')).some(function (r) { return /프로젝트화면 시안 검토/.test(r.textContent) && r.querySelector('.mwj-tag') && /신제품/.test(r.querySelector('.mwj-tag').textContent); }); }), '목록 줄에 📁 프로젝트 표');
    await wait(500);
    var mk = (await c.query("SELECT m.project_id, t.due_date FROM my_work_marks m JOIN my_todos t ON m.item_key = 'todo:' || t.id WHERE m.user_id = $1 AND t.title = '프로젝트화면 시안 검토'", [me.id])).rows[0];
    check(mk && mk.project_id === pid && mk.due_date === kst(1), '서버에도 소속 · 마감 내일');
    check(await ev(function (id) { var c = document.querySelector('#mwjStrip .mwj-c[data-pj="' + id + '"]'); return /☐ 1/.test(c.textContent) && /0%/.test(c.textContent); }, pid), '카드 — 남은 1 · 진행 0%');

    // 4. 타임라인 막대 · 👁 · 전체 끄기
    var bar = '.mtl-lane[data-lane="__pj"] .mtl-proj[data-tk="pj:' + pid + '"]';
    check(await until(function (s) { return !!document.querySelector(s); }, bar), '타임라인 맨 위 📁 프로젝트 줄에 기간 막대');
    await tap('#mwjStrip .mwj-c[data-pj="' + pid + '"] [data-pjeye]');
    check(await until(function (s) { return !document.querySelector(s) && document.querySelector('.mwj-c.is-hidden'); }, bar), '👁 → 타임라인에서 숨김 · 카드 흐림');
    await wait(400);
    check((await row()).visible === false, '숨김 서버에 저장');
    check(await until(function () { return !!document.getElementById('mwUndo'); }), '되돌리기 알림');
    await page.click('#mwUndo button');
    check(await until(function (s) { return !!document.querySelector(s); }, bar), '되돌리기 → 다시 보임');
    await tap('#mwjStrip [data-mwj="band"]');
    check(await until(function () { return !document.querySelector('.mtl-lane[data-lane="__pj"]'); }), '전체 끄기 → 프로젝트 줄 없음');
    await tap('#mwjStrip [data-mwj="band"]');
    check(await until(function (s) { return !!document.querySelector(s); }, bar), '다시 켜기');

    // 5. 프로젝트별 줄
    await ev(function () { _mtlMain.st.group = 'proj'; _mtlMain.save(true); _mtlMain.update(); });
    check(await until(function (id) { var l = document.querySelector('.mtl-lane[data-lane="pj:' + id + '"]'); return l && l.querySelector('.mtl-proj') && /시안 검토/.test(l.textContent) && document.querySelector('.mtl-lane[data-lane="__nopj"]'); }, pid), '줄 나누기 프로젝트별 — 막대 + 소속 할 일 · 프로젝트 없음 줄');
    // 막대 누르면 패널
    await ev(function () { mwProjClose(); });
    await page.click('.mtl-lane[data-lane="pj:' + pid + '"] .mtl-proj');
    check(await until(function () { return document.getElementById('mwjPanel').classList.contains('on'); }), '막대 누르면 프로젝트 패널');
    await ev(function () { mwProjClose(); _mtlMain.st.group = 'cat'; _mtlMain.save(true); _mtlMain.update(); });

    // 6. 달력 띠
    await tap('#mMyWork [data-mwc-view="month"]');
    check(await until(function () { return document.querySelectorAll('.mwc-month .mwc-proj').length >= 7 && document.querySelector('.mwc-month .mwc-proj.is-s') && document.querySelector('.mwc-month .mwc-proj.is-cont'); }), '월 달력 — 기간 띠 (시작 날 이름 · 이어지는 날 띠)');
    await page.click('.mwc-month .mwc-proj.is-s');
    check(await until(function () { return document.getElementById('mwjPanel').classList.contains('on'); }), '달력 띠 누르면 프로젝트 패널');
    await ev(function () { mwProjClose(); });
    await tap('#mMyWork [data-mwc-view="list"]');
    await page.waitForSelector('#mwjStrip');

    // 7. 연계 후보 → 연결 · 마일스톤
    await tap('#mwjStrip [data-mwj="cands"]');
    await page.waitForSelector('.mwb-pop button[data-v="mpe-p1"]');
    await page.click('.mwb-pop button[data-v="mpe-p1"]');
    check(await until(function () { var p = document.getElementById('mwjPanel'); return p.classList.contains('on') && /프로젝트화면 설비 B/.test(p.querySelector('.mwj-lk').textContent) && /프로젝트화면 출하/.test(p.textContent) && /프로젝트 관리 기간을 따릅니다/.test(p.textContent); }), '연계 후보 → 연결 · 패널에 프로젝트 관리 기간 · 마일스톤');
    check(await ev(function () { return !document.querySelector('#mwjStrip [data-mwj="cands"]') && document.querySelector('#mwjStrip .mwj-link'); }), '후보 사라지고 카드에 🔗');
    var lid = (await c.query("SELECT id FROM my_projects WHERE user_id = $1 AND link_project_id = 'mpe-p1'", [me.id])).rows[0].id;
    check(await ev(function (id) { return !document.querySelector('.mtl-proj[data-tk="pj:' + id + '"]').classList.contains('can-drag'); }, lid), '연계 막대는 끌기 없음 (프로젝트 관리에서 바꿈)');
    await ev(function () { mwProjClose(); _mtlMain.st.group = 'proj'; _mtlMain.update(); });
    check(await until(function (id) { var l = document.querySelector('.mtl-lane[data-lane="pj:' + id + '"]'); return l && l.querySelector('[data-tk="pjms:mpe-ms1"]'); }, lid), '프로젝트별 줄에 연계 마일스톤 ◆');
    await ev(function () { _mtlMain.st.group = 'cat'; _mtlMain.save(true); _mtlMain.update(); });

    // 8. 보드 ⋯ 프로젝트로 · 상세 패널 프로젝트 칸
    await page.click('#mwAddTitle');
    await page.keyboard.type('프로젝트화면 보드 할 일');
    await page.keyboard.press('Enter');
    await until(function () { return Array.from(document.querySelectorAll('#mMyWork .mw-row:not(.is-pending)')).some(function (r) { return /보드 할 일/.test(r.textContent); }); });
    await tap('#mMyWork [data-mwc-view="matrix"]');
    await page.waitForSelector('#mMyWork .mwb');
    var key = await ev(function () { var x = (_mw.data.data || []).filter(function (i) { return i.title === '프로젝트화면 보드 할 일'; })[0]; return x && x.key; });
    await tap('#mMyWork [data-qk="' + key + '"] [data-bmenu]');
    await page.waitForSelector('.mwb-pop button[data-v="__pj:' + pid + '"]');
    await page.click('.mwb-pop button[data-v="__pj:' + pid + '"]');
    check(await until(function (k) { var cd = document.querySelector('#mMyWork [data-qk="' + k + '"]'); return cd && cd.querySelector('.mwj-tag') && /신제품/.test(cd.querySelector('.mwj-tag').textContent); }, key), '보드 ⋯ 프로젝트로 → 카드에 표');
    await tap('#mMyWork [data-qk="' + key + '"] .mwb-t');
    await page.waitForSelector('#mwpProj');
    check(await ev(function (id) { return document.getElementById('mwpProj').value === id; }, pid), '상세 패널 프로젝트 칸에 지금 프로젝트');
    await page.select('#mwpProj', '');
    check(await until(function (k) { var cd = document.querySelector('#mMyWork [data-qk="' + k + '"]'); return cd && !cd.querySelector('.mwj-tag'); }, key), '프로젝트 칸 (없음) → 빠짐');
    await wait(400);
    check(!(await c.query('SELECT project_id FROM my_work_marks WHERE user_id = $1 AND item_key = $2', [me.id, key])).rows[0].project_id, '서버에도 빠짐');
    await ev(function () { mwPanelClose(); });
    // 카드 끌어 넣기 (보드 카드 → 프로젝트 카드)
    await ev(function (a) {
      var src = document.querySelector('#mMyWork [data-qk="' + a.k + '"]'), dst = document.querySelector('#mwjStrip .mwj-c[data-pj="' + a.p + '"]');
      var dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    }, { k: key, p: pid });
    check(await until(function (k) { var cd = document.querySelector('#mMyWork [data-qk="' + k + '"]'); return cd && cd.querySelector('.mwj-tag'); }, key), '보드 카드를 프로젝트 카드로 끌어 넣기');

    // 9. 완료 → 끝난 것으로 · 지우기 → 되돌리기
    await tap('#mwjStrip .mwj-c[data-pj="' + pid + '"]');
    await page.waitForSelector('#mwjPanel.on [data-jst="done"]');
    await wait(350);
    await page.click('#mwjPanel [data-jst="done"]');
    check(await until(function (id) { return !document.querySelector('#mwjStrip .mwj-c[data-pj="' + id + '"]') && /끝난 것 1/.test(document.getElementById('mwjStrip').textContent); }, pid), '완료 → 띠에서 빠지고 "끝난 것 1"');
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(function () {});
    await ev(function () { document.querySelector('#mwjStrip [data-mwj="done"]').click(); });
    check(await until(function (id) { var cd = document.querySelector('#mwjStrip .mwj-c[data-pj="' + id + '"]'); return cd && cd.classList.contains('is-done') && /완료/.test(cd.textContent); }, pid), '끝난 것 보기 → 완료 카드');
    await page.click('#mwjPanel [data-jp="delete"]');
    check(await until(function (id) { return !document.querySelector('#mwjStrip .mwj-c[data-pj="' + id + '"]') && !document.getElementById('mwjPanel').classList.contains('on'); }, pid), '지우기 → 카드 · 패널 닫힘');
    await wait(400);
    check((await c.query('SELECT deleted_at FROM my_projects WHERE id = $1', [pid])).rows[0].deleted_at, '서버 — 지움 표시');
    await page.click('#mwUndo button');
    check(await until(function (id) { return !!document.querySelector('#mwjStrip .mwj-c[data-pj="' + id + '"]'); }, pid), '되돌리기 → 다시 나옴');
    await tap('#mMyWork [data-mwc-view="list"]');
    await page.screenshot({ path: path.join(SHOT, 'myproj.png') });

    // 10. 휴대폰
    await page.setViewport({ width: 390, height: 860, isMobile: true, hasTouch: true });
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    if (!(await page.$('#mwjStrip'))) await page.click('#tabMyWork').catch(function () {});
    await page.waitForSelector('#mwjStrip');
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 10000 }).catch(function () {});
    check(await ev(function () { return document.documentElement.scrollWidth <= window.innerWidth + 1; }), '휴대폰 — 가로 스크롤 없음 (카드는 띠 안에서만 넘김)');
    await ev(function (id) { mwProjOpen(id); }, lid);
    check(await until(function () { var n = document.getElementById('mwjPanel'); return n.classList.contains('on') && Math.abs(n.getBoundingClientRect().width - window.innerWidth) < 2; }), '휴대폰 — 프로젝트 패널이 화면 전체');
    await wait(350);
    await page.screenshot({ path: path.join(SHOT, 'myproj-mobile.png') });
    check(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) {
    fail++; console.log('FAIL', e.message);
    await page.screenshot({ path: path.join(SHOT, 'myproj-fail.png') }).catch(function () {});
  } finally {
    await browser.close();
    await clean();
    for (var i = 0; i < seedOpen.length; i++) await c.query('UPDATE projects SET status = $1 WHERE id = $2', [seedOpen[i].status, seedOpen[i].id]);
    await c.end();
  }
  console.log(fail ? '\nFAIL ' + fail + ' / ok ' + ok : '\nALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERR', e.message, e.stack); process.exit(1); });
