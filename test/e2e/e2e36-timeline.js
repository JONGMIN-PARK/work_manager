// 🕒 내 업무 타임라인 · 옆 달력 — 줌(주 · 월 · 년 · Ctrl+휠) · 끌어 이동 · 키보드 · 안내선 · 🔗 연동(마우스 자리 ↔ 달력, 누르면 고정 + 그날 목록)
//    · 연동 끄기 · ◆ 끌어 마감 · 막대 양 끝 · 빈 날 두 번 → 할 일 · 누르면 패널 · 줄 나누기 · 접기 · 기억 · 업무 부하 팀 타임라인 · 휴대폰 (v13.271)
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
    await c.query('DELETE FROM my_todos WHERE user_id = $1', [me.id]);
    await c.query('DELETE FROM my_work_marks WHERE user_id = $1', [me.id]);
    await c.query('DELETE FROM my_work_categories WHERE user_id = $1', [me.id]);
    await c.query("DELETE FROM events WHERE id LIKE 'tl-%'");
    await c.query("DELETE FROM milestone_assignments WHERE id LIKE 'tl-%'");
    await c.query("DELETE FROM milestones WHERE id LIKE 'tl-%'");
    await c.query("DELETE FROM projects WHERE id LIKE 'tl-%'");
  }
  await clean();
  var ins = function (id, title, start, due, pri) { return c.query('INSERT INTO my_todos (id, tenant_id, user_id, title, start_date, due_date, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, tid, me.id, title, start, due, pri || 3]); };
  await ins('todo-tl1', '타임 견적', null, kst(2), 2);
  await ins('todo-tl2', '타임 지연', null, kst(-1), 3);
  await ins('todo-tl3', '타임 설계 기간', kst(4), kst(8), 3);
  await ins('todo-tl4', '타임 다음달', null, kst(40), 3);
  await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('tl-p1', '타임 프로젝트', 'active', 'tenant', $1, $2)", [me.id, tid]);
  await c.query("INSERT INTO milestones (id, project_id, name, start_date, end_date, status, tenant_id) VALUES ('tl-ms1', 'tl-p1', '타임 마일스톤', $1, $2, 'progress', $3)", [kst(1), kst(12), tid]);
  await c.query("INSERT INTO milestone_assignments (id, tenant_id, milestone_id, project_id, user_id) VALUES ('tl-ma1', $1, 'tl-ms1', 'tl-p1', $2)", [tid, me.id]);
  await c.query("INSERT INTO events (id, title, type, start_date, end_date, start_time, end_time, project_ids, assignees, created_by, tenant_id) VALUES ('tl-e1', '타임 회의', 'meeting', $1, $1, '14:00', '15:00', '[]', '[]', $2, $3)", [kst(1), me.id, tid]);
  await c.query("INSERT INTO events (id, title, type, start_date, end_date, project_ids, assignees, created_by, tenant_id) VALUES ('tl-e2', '타임 출장', 'trip', $1, $2, '[]', '[]', $3, $4)", [kst(5), kst(7), me.id, tid]);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function until(fn, arg, ms) { return page.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var tl = function (fn, arg) { return page.evaluate(fn, arg); };
  function itemBox(title) { return tl(function (t) { var x = Array.from(document.querySelectorAll('#mwTimeline .mtl-it')).filter(function (e) { return e.textContent.indexOf(t) >= 0; })[0]; if (!x) return null; var sc = _mtlMain.sc, lr = x.closest('.mtl-lane'); if (lr.offsetTop + lr.offsetHeight > sc.scrollTop + sc.clientHeight || lr.offsetTop < sc.scrollTop + 36) sc.scrollTop = Math.max(0, lr.offsetTop - 40); var r = x.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, key: x.getAttribute('data-tk'), cls: x.className }; }, title); }
  // 타임라인 안 날짜 d 의 화면 x (가운데)
  function dayX(d) { return tl(function (d) { var t = _mtlMain, r = t.sc.getBoundingClientRect(); return r.left + t.X(_mtlNum(d)) - t.sc.scrollLeft + t.st.ppd / 2; }, d); }
  function laneY(id) { return tl(function (id) { var l = document.querySelector('#mwTimeline .mtl-lane[data-lane="' + id + '"]') || document.querySelector('#mwTimeline .mtl-lane'); var r = l.getBoundingClientRect(); return r.bottom - 5; }, id); }
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { Object.keys(localStorage).filter(function (k) { return /^(mw|mtl)/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); } catch (_) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(400);
    await page.click('#tabMyWork');
    await page.waitForSelector('#mwTimeline .mtl-lane');
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(function () {});
    await until(function () { return /타임 회의/.test(document.getElementById('mwTimeline').textContent); });

    // 1. 자리 · 기본 모양
    check(await tl(function () { var t = document.getElementById('mwTimeline'), ch = document.querySelector('#mMyWork .mw-chips'); return !!t && !!ch && (t.compareDocumentPosition(ch) & Node.DOCUMENT_POSITION_FOLLOWING); }), '타임라인은 위 머리 바로 아래 (출처 칩 위)');
    check(await tl(function () { return document.querySelector('#mwTimeline [data-t="lv"][data-v="month"]').classList.contains('on') && !!document.querySelector('#mwTimeline .mtl-cal .mtl-cal-d'); }), '처음 — 월 줌 · 옆 달력');
    var bx = { quote: await itemBox('타임 견적'), late: await itemBox('타임 지연'), range: await itemBox('타임 설계 기간'), ms: await itemBox('타임 마일스톤'), mt: await itemBox('타임 회의'), trip: await itemBox('타임 출장') };
    check(bx.quote && /mtl-pt/.test(bx.quote.cls) && bx.late && /is-late/.test(bx.late.cls), '마감만 = ◆, 지연은 빨강');
    check(bx.range && /mtl-bar/.test(bx.range.cls) && bx.range.w > 100 && bx.ms && /mtl-bar/.test(bx.ms.cls) && bx.trip && /mtl-bar/.test(bx.trip.cls), '시작일 있는 할 일 · 마일스톤 · 출장 = 막대 ' + JSON.stringify(bx));
    check(await tl(function () { return !!document.querySelector('#mwTimeline .mtl-tail') && !!document.querySelector('#mwTimeline .mtl-now') && !!document.querySelector('#mwTimeline .mtl-lane[data-lane="__ev"]'); }), '지연 꼬리 · 오늘 선 · 일정 줄');
    check(await tl(function () { var a = Array.from(document.querySelectorAll('#mwTimeline .mtl-lane')).map(function (l) { return l.querySelector('.mtl-ln').textContent; }).join('|'); return /지금 하기/.test(a) && /계획하기/.test(a); }), '줄 = 칸 (보드 카테고리)');
    // 같은 날 3개 넘으면 묶음 하나 — 누르면 그날 고정 · 달력 목록
    var cl = await tl(function () { var b = document.querySelector('#mwTimeline .mtl-cl'); if (!b) return null; b.click(); return { d: b.getAttribute('data-cl'), n: +b.querySelector('b').textContent }; });
    check(cl && cl.n >= 3 && await tl(function (c) { return _mtlMain.pick === c.d && document.querySelectorAll('#mwTimeline .mtl-dli').length >= c.n; }, cl), '같은 날 많은 ◆ → 묶음 ' + (cl && cl.n) + '개 · 누르면 그날 목록');
    check(await tl(function () { return document.querySelector('#mwTimeline .mtl-hd').children.length <= 9 && !document.querySelector('#mwTimeline select'); }), '머리는 짧게 (줄 · 달력 · 날짜는 ⋯ 메뉴)');
    await page.click('#mwTimeline [data-t="today"]');
    await page.screenshot({ path: path.join(SHOT, 'timeline.png') });

    // 2. 줌
    await page.click('#mwTimeline [data-t="lv"][data-v="week"]');
    check(await tl(function () { return _mtlMain.st.ppd === 120 && /14:00|1\/|월|화|수|목|금|토|일/.test(document.querySelector('#mwTimeline .mtl-ax').textContent); }), '주 줌');
    var mtW = await itemBox('타임 회의');
    check(mtW && mtW.w >= 4 && mtW.w < 20, '주 줌 — 회의는 14~15시 짧은 막대 ' + (mtW && Math.round(mtW.w)));
    await page.screenshot({ path: path.join(SHOT, 'timeline-week.png') });
    await page.click('#mwTimeline [data-t="lv"][data-v="year"]');
    check(await tl(function () { return _mtlMain.st.ppd < 6 && document.querySelectorAll('#mwTimeline .mtl-agg').length > 0 && !!document.querySelector('#mwTimeline .mtl-cal-y'); }), '년 줌 — 주마다 ●n · 달력은 12달');
    await page.screenshot({ path: path.join(SHOT, 'timeline-year.png') });
    await page.click('#mwTimeline .mtl-agg');
    check(await tl(function () { return _mtlMain.st.ppd === 30; }), '●n 누르면 월 줌으로');
    var p0 = await tl(function () { return _mtlMain.st.ppd; });
    var sr = await tl(function () { var r = _mtlMain.sc.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 80 }; });
    await page.mouse.move(sr.x, sr.y);
    await page.keyboard.down('Control'); await page.mouse.wheel({ deltaY: -300 }); await page.keyboard.up('Control');
    await wait(200);
    check(await tl(function (p) { return _mtlMain.st.ppd > p * 1.3; }, p0), 'Ctrl+휠 확대');

    // 3. 이동 — 빈 곳 끌기 · 키보드
    await page.click('#mwTimeline [data-t="lv"][data-v="month"]');
    var s0 = await tl(function () { return _mtlMain.sc.scrollLeft; });
    var ey = await tl(function () { var a = document.querySelector('#mwTimeline .mtl-ax').getBoundingClientRect(); return a.bottom + 3; });
    await page.mouse.move(sr.x, ey); await page.mouse.down(); await page.mouse.move(sr.x - 150, ey, { steps: 5 }); await page.mouse.up();
    var s1 = await tl(function () { return _mtlMain.sc.scrollLeft; });
    check(s1 - s0 > 100, '빈 곳 끌기 → 가로 이동 ' + Math.round(s1 - s0));
    await page.focus('#mwTimeline .mtl-sc'); await page.keyboard.press('ArrowLeft'); await wait(100);
    check(await tl(function (s) { return _mtlMain.sc.scrollLeft < s; }, s1), '← 키로 이동');
    await page.click('#mwTimeline [data-t="today"]');

    // 4. 안내선 · 🔗 연동
    check(await tl(function () { return document.querySelector('#mwTimeline [data-t="link"]').checked; }), '연동 처음엔 켜짐');
    var nx = await dayX(kst(40));
    if (nx > sr.x * 2) { await tl(function (d) { _mtlMain.goDate(d); }, kst(30)); nx = await dayX(kst(40)); }
    await page.mouse.move(nx, ey + 4);
    await wait(400);
    var at = await tl(function () { return document.querySelector('#mwTimeline .mtl-guide.is-hover span').textContent; });
    var mon40 = String(+kst(40).slice(5, 7));
    check(new RegExp(mon40 + '/' + (+kst(40).slice(8, 10))).test(at), '마우스 자리 날짜 표시 — ' + at);
    check(await tl(function (ym) { return _mtlMain.calBase() === ym && !!document.querySelector('#mwTimeline .mtl-cd.is-hover'); }, kst(40).slice(0, 7)), '연동 — 머물면 달력이 그 달 · 그날 표시');
    await page.mouse.click(nx, ey + 4);
    await wait(200);
    check(await tl(function (d) { return _mtlMain.pick === d && !!document.querySelector('#mwTimeline .mtl-cd.is-pick[data-cd="' + d + '"]') && /타임 다음달/.test(document.querySelector('#mwTimeline .mtl-dl').textContent); }, kst(40)), '누르면 그날 고정 · 달력 표시 · 그날 목록');
    // 달력 → 타임라인
    await page.click('#mwTimeline .mtl-cd[data-cd="' + kst(41) + '"]').catch(async function () { await tl(function (d) { document.querySelector('#mwTimeline [data-cd="' + d + '"]').click(); }, kst(41)); });
    await wait(200);
    check(await tl(function (d) { var v = _mtlMain.view(); return _mtlMain.pick === d && Math.abs(v.c - (_mtlNum(d) + 0.5)) < 1; }, kst(41)), '달력 날짜 누르면 타임라인이 그날로');
    // 그날 목록에서 열기
    await tl(function () { document.querySelector('#mwTimeline [data-cd="' + _mtlMain.pick + '"]'); });
    // 연동 끄기
    await page.click('#mwTimeline [data-t="link"]');
    await tl(function () { _mtlMain.calMonth = null; _mtlMain.drawCal(); });
    var base = await tl(function () { return _mtlMain.calBase(); });
    await page.click('#mwTimeline [data-t="today"]');
    var nToday = await dayX(kst(0));
    await page.mouse.move(nToday + 200, ey + 4); await wait(400);
    check(await tl(function (b) { return !_mtlMain.st.link && !document.querySelector('#mwTimeline .mtl-cd.is-hover'); }, base), '연동 끄면 달력은 안 따라감');
    await page.click('#mwTimeline [data-t="link"]');

    // 5. ◆ 끌어 마감 바꾸기 · 막대 끝 끌기
    await page.click('#mwTimeline [data-t="today"]');
    await wait(150);
    var q = await itemBox('타임 견적');
    var ppd = await tl(function () { return _mtlMain.st.ppd; });
    await page.mouse.move(q.x + 7, q.y + q.h / 2); await page.mouse.down(); await page.mouse.move(q.x + 7 + ppd * 3, q.y + q.h / 2, { steps: 6 }); await page.mouse.up();
    await wait(700);
    check((await c.query("SELECT due_date FROM my_todos WHERE id = 'todo-tl1'")).rows[0].due_date === kst(5), '◆ 끌어 +3일 → 마감 바뀜');
    check(await tl(function () { return /마감/.test(document.getElementById('mwUndo').textContent); }), '되돌리기 알림');
    var rg = await itemBox('타임 설계 기간');
    await page.mouse.move(rg.x + rg.w - 2, rg.y + rg.h / 2); await page.mouse.down(); await page.mouse.move(rg.x + rg.w - 2 + ppd * 2, rg.y + rg.h / 2, { steps: 5 }); await page.mouse.up();
    await wait(600);
    var r2 = (await c.query("SELECT start_date, due_date FROM my_todos WHERE id = 'todo-tl3'")).rows[0];
    check(r2.start_date === kst(4) && r2.due_date === kst(10), '막대 오른쪽 끝 끌기 → 마감만 +2 ' + JSON.stringify(r2));
    rg = await itemBox('타임 설계 기간');
    await page.mouse.move(rg.x + 2, rg.y + rg.h / 2); await page.mouse.down(); await page.mouse.move(rg.x + 2 - ppd * 1, rg.y + rg.h / 2, { steps: 5 }); await page.mouse.up();
    await wait(600);
    r2 = (await c.query("SELECT start_date, due_date FROM my_todos WHERE id = 'todo-tl3'")).rows[0];
    check(r2.start_date === kst(3) && r2.due_date === kst(10), '왼쪽 끝 끌기 → 시작만 −1 ' + JSON.stringify(r2));
    rg = await itemBox('타임 설계 기간');
    await page.mouse.move(rg.x + rg.w / 2, rg.y + rg.h / 2); await page.mouse.down(); await page.mouse.move(rg.x + rg.w / 2 + ppd * 1, rg.y + rg.h / 2, { steps: 5 }); await page.mouse.up();
    await wait(600);
    r2 = (await c.query("SELECT start_date, due_date FROM my_todos WHERE id = 'todo-tl3'")).rows[0];
    check(r2.start_date === kst(4) && r2.due_date === kst(11), '가운데 끌기 → 통째로 +1 ' + JSON.stringify(r2));
    check((await c.query("SELECT end_date FROM milestones WHERE id = 'tl-ms1'")).rows[0].end_date === kst(12) && !/can-drag/.test((await itemBox('타임 마일스톤')).cls), '마일스톤 막대는 못 끌음 (원래 화면에서)');

    // 6. 빈 날 두 번 → 할 일 · 누르면 패널
    var x9 = await dayX(kst(9)), y9 = await laneY('none');
    await page.mouse.click(x9, ey + 6, { clickCount: 2 });
    await page.waitForSelector('#mwtQa input');
    await page.type('#mwtQa input', '타임 바로 추가');
    await page.keyboard.press('Enter');
    check(await until(function () { return /타임 바로 추가/.test(document.getElementById('mwTimeline').textContent) && !document.querySelector('#mwTimeline .is-pending'); }), '빈 날 두 번 → 그날 마감 할 일 (바로 그림)');
    check((await c.query("SELECT due_date FROM my_todos WHERE title = '타임 바로 추가'")).rows[0].due_date === kst(9), '마감 = 누른 날');
    void y9;
    var qb = await itemBox('타임 견적');
    await page.mouse.click(qb.x + 20, qb.y + qb.h / 2);
    check(await until(function () { var p = document.getElementById('mwPanel'); return p && p.classList.contains('on') && !!document.getElementById('mwpStart'); }), '누르면 상세 패널 · 할 일엔 시작일 칸');
    await wait(350);
    await page.evaluate(function (d) { var i = document.getElementById('mwpStart'); i.value = d; i.dispatchEvent(new Event('change', { bubbles: true })); }, kst(1));
    await wait(1200);
    check((await c.query("SELECT start_date FROM my_todos WHERE id = 'todo-tl1'")).rows[0].start_date === kst(1) && /mtl-bar/.test((await itemBox('타임 견적')).cls), '패널에서 시작일 → 막대로');
    await page.click('#mwPanel [data-p="close"]');

    // 7. 줄 나누기 · 접기 · 기억
    await page.click('#mwTimeline [data-t="more"]');
    await page.waitForSelector('#mwtMore [data-v="g:src"]');
    await page.click('#mwtMore [data-v="g:src"]');
    check(await tl(function () { return !!document.querySelector('#mwTimeline .mtl-lane[data-lane="todo"]') && !!document.querySelector('#mwTimeline .mtl-lane[data-lane="milestone"]'); }), '줄: 출처');
    await page.click('#mwTimeline [data-t="fold"]');
    check(await tl(function () { var t = document.getElementById('mwTimeline'); return t.classList.contains('is-collapsed') && document.querySelectorAll('#mwTimeline .mtl-dc').length >= 50; }), '접기 → 8주 밀도 막대');
    await page.click('#mwTimeline [data-t="fold"]');
    await page.click('#mwTimeline [data-t="lv"][data-v="week"]');
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await page.click('#tabMyWork');
    await page.waitForSelector('#mwTimeline .mtl-lane');
    check(await tl(function () { return _mtlMain.st.ppd === 120 && _mtlMain.st.group === 'src'; }), '새로 열어도 줌 · 줄 그대로');
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 10000 }).catch(function () {});
    // 목록이 다시 그려져도 띠는 그대로 (같은 요소 · 위치)
    var sBefore = await tl(function () { window._tlEl = document.getElementById('mwTimeline'); return _mtlMain.sc.scrollLeft; });
    await tl(function () { _mwPaint(); });
    check(await tl(function (s) { return document.getElementById('mwTimeline') === window._tlEl && Math.abs(_mtlMain.sc.scrollLeft - s) < 2; }, sBefore), '목록을 다시 그려도 타임라인 위치 그대로');
    await tl(function () { _mtlMain.st.group = 'cat'; _mtlMain.zoomTo(30); });

    // 8. 업무 부하 — 팀 타임라인
    await page.click('#pageTabs [data-page="team"]'); await page.click('#tabWorkload');   // v13.280 업무 관리 › 업무 부하
    await page.waitForSelector('#mWorkload [data-lv="tl"]');
    await page.click('#mWorkload [data-lv="tl"]');
    check(await until(function () { var t = document.getElementById('mwLoadTimeline'); return t && t.querySelectorAll('.mtl-lane').length >= 2 && /타임/.test(t.textContent); }), '업무 부하 → 팀 타임라인 (사람마다 줄)');
    check(await tl(function () { return !document.querySelector('#mwLoadTimeline .mtl-cal') && !document.querySelector('#mwLoadTimeline .can-drag'); }), '팀 타임라인 — 달력 없음 · 읽기 전용');
    await page.screenshot({ path: path.join(SHOT, 'timeline-team.png') });
    await page.click('#mWorkload [data-lv="table"]');
    await page.click('#tabMyWork');
    await page.waitForSelector('#mwTimeline .mtl-lane');

    // 9. 휴대폰
    await page.setViewport({ width: 390, height: 860, isMobile: true, hasTouch: true });
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    if (!(await page.$('#mwTimeline'))) { await page.click('#tabMyWork').catch(function () {}); await page.waitForSelector('#mwTimeline .mtl-lane'); }
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 10000 }).catch(function () {});
    await page.evaluate(function () { if (mwPanelIsOpen()) mwPanelClose(); });   // v13.286 — 앞에서 연 상세 패널이 탭을 오가도 복원되므로, 휴대폰 달력을 가리지 않게 닫음
    await tl(function () { _mtlMain.update(); });
    check(await tl(function () { return document.querySelectorAll('#mwTimeline .mtl-cd').length === 7 && _mtlMain.L === 92; }), '휴대폰 — 달력은 한 주 줄');
    await page.click('#mwTimeline [data-cn="open"]');
    check(await tl(function () { return document.querySelectorAll('#mwTimeline .mtl-cd').length === 42; }), '펼치면 한 달');
    check(await tl(function () { return document.documentElement.scrollWidth <= window.innerWidth + 1; }), '휴대폰 — 가로 스크롤 없음');
    await page.screenshot({ path: path.join(SHOT, 'timeline-mobile.png') });
    await page.evaluate(function () { try { Object.keys(localStorage).filter(function (k) { return /^(mw|mtl)-/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); } catch (_) {} });
    check(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) {
    fail++; console.log('FAIL', e.message);
    await page.screenshot({ path: path.join(SHOT, 'timeline-fail.png') }).catch(function () {});
  } finally {
    await browser.close();
    await clean();
    await c.end();
  }
  console.log(fail ? '\nFAIL ' + fail + ' / ok ' + ok : '\nALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERR', e.message, e.stack); process.exit(1); });
