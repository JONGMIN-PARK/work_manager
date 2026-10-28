// 🎯 내 업무 할 일 관리 화면 — 한 줄 입력 · 중요도 메뉴(원래 자리 반영) · ⭐ 집중 · 할 일 편집 창 · 직접 순서 · 거르기 · 종류별 등록 창 · 겹침 경고 · 4칸 보기 · 시간 칸 할 일 · 휴가 표시 (v13.253)
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
function mondayOf(d) { var t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - (t.getUTCDay() + 6) % 7); return t.toISOString().slice(0, 10); }
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var me = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var tid = me.tenant_id;
  async function clean() {
    await c.query('DELETE FROM my_todos WHERE user_id = $1', [me.id]);
    await c.query("DELETE FROM events WHERE title LIKE '화면%' OR title LIKE '할일화면%' OR type IN ('amoff') AND created_by = $1", [me.id]);
    await c.query("DELETE FROM meetings WHERE title LIKE '할일화면%'");
    await c.query("DELETE FROM issues WHERE id LIKE 'twu-%'");
    await c.query("DELETE FROM projects WHERE id LIKE 'twu-%'");
    await c.query('DELETE FROM my_work_marks WHERE user_id = $1', [me.id]);
  }
  await clean();
  await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('twu-p1', '할일화면 프로젝트', 'active', 'tenant', $1, $2)", [me.id, tid]);
  await c.query("INSERT INTO issues (id, project_id, title, status, urgency, due_date, assignees, tenant_id) VALUES ('twu-i1', 'twu-p1', '할일화면 이슈', 'open', 'normal', $1, '[\"관리자\"]', $2)", [kst(5), tid]);
  await c.query("INSERT INTO events (id, title, type, start_date, end_date, start_time, end_time, project_ids, assignees, created_by, tenant_id) VALUES ('evt-twu1', '할일화면 기존회의', 'meeting', $1, $1, '15:00', '16:00', '[]', '[]', $2, $3)", [kst(2), me.id, tid]);
  await c.query("INSERT INTO events (id, title, type, start_date, end_date, project_ids, assignees, created_by, tenant_id) VALUES ('evt-twu2', '할일화면 연차', 'dayoff', $1, $1, '[]', '[]', $2, $3)", [mondayOf(kst(7)), me.id, tid]);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function until(fn, arg, ms) { return page.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  function rowOf(title) { return page.evaluate(function (t) { var r = Array.from(document.querySelectorAll('#mMyWork .mw-row')).filter(function (x) { return x.querySelector('.mw-title') && x.querySelector('.mw-title').textContent === t; })[0]; return r ? { key: r.getAttribute('data-key'), txt: r.textContent, grp: r.closest('[data-grp]') && r.closest('[data-grp]').getAttribute('data-grp') } : null; }, title); }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { ['mw-view', 'mw-sort', 'mw-prif'].forEach(function (k) { localStorage.removeItem(k); }); } catch (_) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id; });
    await wait(400);
    await page.click('#tabMyWork');
    await page.waitForSelector('#mwAddTitle');

    // 1. 한 줄 입력
    await page.type('#mwAddTitle', '내일 15:00 !긴급 할일화면 견적');
    await page.keyboard.press('Enter');
    check(await until(function () { return Array.from(document.querySelectorAll('#mMyWork .mw-title')).some(function (x) { return x.textContent === '할일화면 견적'; }); }), '한 줄 입력 → 제목만 남음');
    var tq = (await c.query("SELECT due_date, due_time, priority FROM my_todos WHERE title = '할일화면 견적'")).rows[0];
    check(tq && tq.due_date === kst(1) && tq.due_time === '15:00' && tq.priority === 1, '마감 · 시각 · 긴급 저장 ' + JSON.stringify(tq));
    var r1 = await rowOf('할일화면 견적');
    check(r1 && /긴급/.test(r1.txt) && /15:00/.test(r1.txt), '줄에 긴급 · 15:00 표시');

    // 2. 중요도 메뉴 → 이슈 원래 자리
    var ik = (await rowOf('할일화면 이슈')).key;
    await page.click('#mMyWork [data-pri="' + ik + '"]');
    await page.waitForSelector('#mwPriMenu');
    check(await page.evaluate(function () { return /이슈에도 반영/.test(document.getElementById('mwPriMenu').textContent); }), '메뉴에 "이슈에도 반영" 안내');
    await page.screenshot({ path: path.join(SHOT, 'tasks-primenu.png') });
    await page.click('#mwPriMenu [data-p="2"]');
    await wait(600);
    check((await c.query("SELECT urgency FROM issues WHERE id = 'twu-i1'")).rows[0].urgency === 'high' && /높음/.test((await rowOf('할일화면 이슈')).txt), '이슈 → 높음 (urgency high)');

    // 3. ⭐ 오늘 집중
    await page.click('#mMyWork [data-focus="' + ik + '"]');
    await wait(500);
    check((await rowOf('할일화면 이슈')).grp === 'focus' && await page.evaluate(function () { return document.querySelector('#mMyWork .mw-grp').getAttribute('data-grp') === 'focus'; }), '⭐ → 오늘 집중 묶음이 맨 위');

    // 4. 할 일 편집 창
    await page.evaluate(function () { Array.from(document.querySelectorAll('#mMyWork .mw-title')).filter(function (x) { return x.textContent === '할일화면 견적'; })[0].click(); });
    await page.waitForSelector('#mwTodoModal #mwtTitle');
    await page.click('#mwtSt [data-v="waiting"]');
    await page.type('#mwtWait', '고객 회신');
    await page.type('#mwtClIn', '견적서 작성'); await page.keyboard.press('Enter');
    await page.type('#mwtClIn', '단가 확인'); await page.keyboard.press('Enter');
    await page.click('#mwtCl [data-ci="0"]');
    await page.type('#mwtMemo', '담당: 영업팀');
    await page.select('#mwtRep', 'weekly');
    await page.type('#mwtEst', '3');
    await page.screenshot({ path: path.join(SHOT, 'tasks-edit.png') });
    await page.click('#mwtForm button[type=submit]');
    await until(function () { return !document.getElementById('mwTodoModal'); });
    await wait(600);
    var te = (await c.query("SELECT status, waiting_for, memo, repeat, estimate_h, checklist FROM my_todos WHERE title = '할일화면 견적'")).rows[0];
    check(te.status === 'waiting' && te.waiting_for === '고객 회신' && te.memo === '담당: 영업팀' && te.repeat === 'weekly' && Number(te.estimate_h) === 3 && te.checklist.length === 2 && te.checklist[0].d, '편집 창 저장 ' + JSON.stringify(te));
    var r2 = await rowOf('할일화면 견적');
    check(/대기 · 고객 회신/.test(r2.txt) && /☑ 1\/2/.test(r2.txt) && /📝/.test(r2.txt) && /🔁/.test(r2.txt), '줄에 대기 · 1/2 · 메모 · 반복 ' + r2.txt);

    // 5. 거르기 · 정렬
    await page.select('#mwPriF', 'urgent');
    await wait(200);
    check(await page.evaluate(function () { var rs = Array.from(document.querySelectorAll('#mMyWork .mw-row:not(.mw-done)')); return rs.length > 0 && rs.every(function (r) { return r.querySelector('.mw-pri1'); }); }), '거르기 긴급만');
    await page.select('#mwPriF', 'all');
    await page.select('#mwSort', 'manual');
    await wait(200);
    check(await page.evaluate(function () { return document.querySelectorAll('#mMyWork .mw-row[data-ord][draggable="true"]').length > 1; }), '직접 순서 — 줄을 끌 수 있음');
    // 같은 묶음 두 줄 순서 바꾸기
    var swapped = await page.evaluate(function () {
      var g = Array.from(document.querySelectorAll('#mMyWork .mw-grp')).filter(function (s) { return s.querySelectorAll('.mw-row[data-ord]').length >= 2; })[0];
      if (!g) return null;
      var rows = g.querySelectorAll('.mw-row[data-ord]'), a = rows[0], b = rows[1];
      var dt = new DataTransfer(), rb = b.getBoundingClientRect();
      a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: rb.bottom - 2 }));
      a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return [a.getAttribute('data-key'), b.getAttribute('data-key')];
    });
    await wait(700);
    if (swapped) {
      var ord = (await c.query('SELECT item_key, sort_order FROM my_work_marks WHERE user_id = $1 AND sort_order IS NOT NULL ORDER BY sort_order', [me.id])).rows;
      check(ord.length >= 2 && ord[0].item_key.indexOf(swapped[1].split(':').slice(0, 2).join(':')) === 0, '끌어 바꾼 순서 저장 ' + JSON.stringify(ord.slice(0, 2)));
    } else check(false, '직접 순서 시험할 묶음 없음');
    await page.select('#mwSort', 'due');

    // 6. 종류별 등록 창 — 회의 (한 줄 읽기 · 참석자 · 장소 · 회의록)
    await page.click('#mMyWork [data-mwt="new"]');
    await page.waitForSelector('#mwRegModal #mwrTitle');
    await page.click('#mwrKinds [data-k="meeting"]');
    await page.type('#mwrTitle', '모레 오후 3시 할일화면 고객 미팅');
    await page.keyboard.press('Enter');
    await wait(200);
    var rv = await page.evaluate(function () { return { t: document.getElementById('mwrTitle').value, d: document.getElementById('mwrDate').value, t1: document.getElementById('mwrT1').value, t2: document.getElementById('mwrT2').value, hint: document.getElementById('mwrHint').textContent }; });
    check(rv.t === '할일화면 고객 미팅' && rv.d === kst(2) && rv.t1 === '15:00' && rv.t2 === '16:00' && /읽음/.test(rv.hint), '제목에서 날짜 · 시각 읽음 (+1시간) ' + JSON.stringify(rv));
    check(await until(function () { var w = document.getElementById('mwrWarn'); return w && !w.hidden && /할일화면 기존회의/.test(w.textContent); }), '겹침 경고 — 같은 시각 기존 회의');
    await page.select('#mwrPick', '김팀원');
    await page.type('#mwrPlace', '2층 회의실');
    await page.click('#mwrMin');
    await page.screenshot({ path: path.join(SHOT, 'tasks-register.png') });
    await page.click('#mwrForm button[type=submit]');
    await until(function () { return !document.getElementById('mwRegModal'); });
    await wait(500);
    var mt = (await c.query("SELECT m.id, m.attendees, e.start_time, e.end_time, e.location, e.assignees FROM meetings m JOIN events e ON e.id = m.event_id WHERE m.title = '할일화면 고객 미팅'")).rows[0];
    check(mt && JSON.stringify(mt.attendees) === '["김팀원"]' && mt.start_time === '15:00' && mt.end_time === '16:00' && mt.location === '2층 회의실' && JSON.stringify(mt.assignees) === '["김팀원"]', '회의 + 회의록 — 참석자 · 장소 · 시각 ' + JSON.stringify(mt));
    // 오전반차 — 시각 자동, 제목 없어도
    await page.click('#mMyWork [data-mwt="new"]');
    await page.waitForSelector('#mwRegModal #mwrTitle');
    await page.click('#mwrKinds [data-k="amoff"]');
    check(await page.evaluate(function () { return document.querySelector('[data-f="time"]').hidden && /09:00 ~ 13:00/.test(document.getElementById('mwrHalf').textContent) && document.querySelector('[data-f="people"]').hidden; }), '오전반차 — 시각 칸 대신 09:00~13:00');
    await page.evaluate(function (d) { document.getElementById('mwrDate').value = d; }, kst(3));
    await page.click('#mwrForm button[type=submit]');
    await until(function () { return !document.getElementById('mwRegModal'); });
    await wait(300);
    var am = (await c.query("SELECT title, start_time, end_time FROM events WHERE type = 'amoff' AND created_by = $1 AND start_date = $2", [me.id, kst(3)])).rows[0];
    check(am && am.title === '오전반차' && am.start_time === '09:00' && am.end_time === '13:00', '오전반차 저장 ' + JSON.stringify(am));

    // 7. 4칸 보기
    await page.click('#mMyWork [data-mwc-view="matrix"]');
    await page.waitForSelector('#mMyWork .mwq');
    var q = await page.evaluate(function () { var o = {}; document.querySelectorAll('[data-quad]').forEach(function (s) { o[s.getAttribute('data-quad')] = s.textContent; }); return o; });
    check(/할일화면 견적/.test(q[1]) && /할일화면 이슈/.test(q[2]), '4칸 — 긴급·내일 = 지금 하기, 높음·5일 뒤 = 계획하기');
    await page.screenshot({ path: path.join(SHOT, 'tasks-matrix.png') });
    // 계획하기 → 나중에 로 끌면 보통
    var qk = await page.evaluate(function () { var x = Array.from(document.querySelectorAll('[data-qk]')).filter(function (e) { return /할일화면 이슈/.test(e.textContent); })[0]; return x.getAttribute('data-qk'); });
    await page.evaluate(function (k) {
      var src = document.querySelector('[data-qk="' + k + '"]'), dst = document.querySelector('[data-quad="4"] .mwq-l'), dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, qk);
    await wait(700);
    check((await c.query("SELECT urgency FROM issues WHERE id = 'twu-i1'")).rows[0].urgency === 'normal', '4칸에서 덜 중요 칸으로 끌기 → 보통');

    // 8. 주 보기 — 마감 시각 있는 할 일은 시간 칸에
    await page.click('#mMyWork [data-mwc-view="week"]');
    await page.waitForSelector('#mMyWork .mwc-week');
    check(await page.evaluate(function (d) { var col = document.querySelector('.mwc-tcol[data-tday="' + d + '"]'); return !!col && Array.from(col.querySelectorAll('.mwc-blk')).some(function (b) { return /할일화면 견적/.test(b.textContent) && /15:00/.test(b.textContent); }); }, kst(1)), '주 보기 시간 칸에 마감 15:00 할 일');
    await page.click('#mMyWork [data-mwc-view="list"]');

    // 9. 업무 부하 — 휴가
    await page.click('#tabWorkload');
    await page.waitForSelector('#mWorkload table.mw-load');
    check(await page.evaluate(function (id) { var th = document.querySelector('#mWorkload th[data-drop="' + id + '"]'); return th && /🌴/.test(th.parentNode.textContent); }, me.id), '업무 부하에 🌴 휴가');
    await page.screenshot({ path: path.join(SHOT, 'tasks-load.png') });
    await page.click('#tabMyWork');
    await page.waitForSelector('#mMyWork .mw-grp');
    await page.screenshot({ path: path.join(SHOT, 'tasks-list.png') });
    // 어두운 테마 · 휴대폰
    var theme = await page.evaluate(function () { var t = document.documentElement.getAttribute('data-theme'); document.documentElement.setAttribute('data-theme', 'dark'); return t; });
    await wait(200);
    await page.screenshot({ path: path.join(SHOT, 'tasks-list-dark.png') });
    await page.evaluate(function (t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }, theme);
    await page.setViewport({ width: 390, height: 800 });
    await wait(300);
    check(await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth + 1; }), '휴대폰 폭 목록 — 가로 스크롤 없음');
    await page.screenshot({ path: path.join(SHOT, 'tasks-list-mobile.png') });
    await page.click('#mMyWork [data-mwc-view="matrix"]');
    await wait(300);
    check(await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth + 1; }), '휴대폰 폭 4칸 — 가로 스크롤 없음');
    await page.evaluate(function () { try { ['mw-view', 'mw-sort', 'mw-prif'].forEach(function (k) { localStorage.removeItem(k); }); } catch (_) {} });
    check(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) {
    fail++; console.log('FAIL', e.message);
    await page.screenshot({ path: path.join(SHOT, 'tasks-fail.png') }).catch(function () {});
  } finally {
    await browser.close();
    await clean();
    await c.query("DELETE FROM events WHERE id IN ('evt-twu1','evt-twu2')");
    await c.end();
  }
  console.log(fail ? '\nFAIL ' + fail + ' / ok ' + ok : '\nALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERR', e.message, e.stack); process.exit(1); });
