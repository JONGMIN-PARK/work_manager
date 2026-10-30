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
    await c.query('DELETE FROM my_work_categories WHERE user_id = $1', [me.id]);
  }
  await clean();
  await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('twu-p1', '할일화면 프로젝트', 'active', 'tenant', $1, $2)", [me.id, tid]);
  await c.query("INSERT INTO issues (id, project_id, title, status, urgency, due_date, assignees, tenant_id) VALUES ('twu-i1', 'twu-p1', '할일화면 이슈', 'open', 'normal', $1, '[\"관리자\"]', $2)", [kst(5), tid]);
  await c.query("INSERT INTO events (id, title, type, start_date, end_date, start_time, end_time, project_ids, assignees, created_by, tenant_id) VALUES ('evt-twu1', '할일화면 기존회의', 'meeting', $1, $1, '15:00', '16:00', '[]', '[]', $2, $3)", [kst(2), me.id, tid]);
  await c.query("INSERT INTO events (id, title, type, start_date, end_date, project_ids, assignees, created_by, tenant_id) VALUES ('evt-twu2', '할일화면 연차', 'dayoff', $1, $1, '[]', '[]', $2, $3)", [mondayOf(kst(7)), me.id, tid]);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var dialogs = [];
  page.on('dialog', function (d) { dialogs.push(d.message()); d.accept(); });
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
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(400);
    await page.click('#tabMyWork');
    await page.waitForSelector('#mwAddTitle');

    // 1. 한 줄 입력
    await page.type('#mwAddTitle', '내일 15:00 !긴급 할일화면 견적');
    await page.keyboard.press('Enter');
    check(await until(function () { return Array.from(document.querySelectorAll('#mMyWork .mw-title')).some(function (x) { return x.textContent === '할일화면 견적'; }) && !document.querySelector('#mMyWork .is-pending'); }), '한 줄 입력 → 제목만 남음');
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
    await page.click('#mwPriMenu [data-v="2"]');
    await wait(600);
    check((await c.query("SELECT urgency FROM issues WHERE id = 'twu-i1'")).rows[0].urgency === 'high' && /높음/.test((await rowOf('할일화면 이슈')).txt), '이슈 → 높음 (urgency high)');

    // 3. ⭐ 오늘 집중
    await page.click('#mMyWork [data-focus="' + ik + '"]');
    await wait(500);
    check((await rowOf('할일화면 이슈')).grp === 'focus' && await page.evaluate(function () { return document.querySelector('#mMyWork .mw-grp').getAttribute('data-grp') === 'focus'; }), '⭐ → 오늘 집중 묶음이 맨 위');

    // 4. 상세 패널 — 자동 저장 (v13.254)
    async function openTitle(t) { await page.evaluate(function (x) { Array.from(document.querySelectorAll('#mMyWork .mw-title')).filter(function (e) { return e.textContent === x; })[0].click(); }, t); await page.waitForSelector('#mwPanel.on #mwpSave'); await wait(350); }
    async function saved() { return until(function () { var s = document.getElementById('mwpSave'); return s && /저장됨/.test(s.textContent); }); }
    await openTitle('할일화면 견적');
    check(await page.evaluate(function () { return !document.querySelector('.wa-modal-overlay') && !!document.querySelector('#mMyWork .mw-row.mw-picked'); }), '패널은 목록을 가리지 않고 · 고른 줄 표시');
    await page.click('#mwPanel [data-st-v="waiting"]');
    await page.type('#mwpWait', '고객 회신');
    await page.type('#mwpClAdd', '견적서 작성'); await page.keyboard.press('Enter');
    await page.type('#mwpClAdd', '단가 확인'); await page.keyboard.press('Enter');
    await page.click('#mwpCl [data-cchk="0"]');
    await page.type('#mwpMemo', '담당: 영업팀');
    await page.select('#mwpRep', 'weekly');
    await page.type('#mwpEst', '3');
    check(await saved(), '자동 저장 — "저장됨" 표시 (저장 버튼 없음)');
    await page.screenshot({ path: path.join(SHOT, 'tasks-panel.png') });
    var te = (await c.query("SELECT status, waiting_for, memo, repeat, estimate_h, checklist FROM my_todos WHERE title = '할일화면 견적'")).rows[0];
    check(te.status === 'waiting' && te.waiting_for === '고객 회신' && te.memo === '담당: 영업팀' && te.repeat === 'weekly' && Number(te.estimate_h) === 3 && te.checklist.length === 2 && te.checklist[0].d, '패널에서 바로 저장 ' + JSON.stringify(te));
    var r2 = await rowOf('할일화면 견적');
    check(/대기 · 고객 회신/.test(r2.txt) && /☑ 1\/2/.test(r2.txt) && /📝/.test(r2.txt) && /🔁/.test(r2.txt), '목록 줄도 바로 바뀜 ' + r2.txt);

    // 4-2. 하위 항목 다루기 — 한글 조합 Enter · 여러 줄 붙여넣기 · 빈 줄 Backspace · 끌기
    var ime = await page.evaluate(function () {
      var inp = document.getElementById('mwpClAdd');
      inp.value = '조합중';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true }));
      var r = { n: document.querySelectorAll('#mwpCl .mwp-cli').length, v: inp.value };
      inp.value = '';
      return r;
    });
    check(ime.n === 2 && ime.v === '조합중', '한글 조합 중 Enter 는 넣지 않음 ' + JSON.stringify(ime));
    await page.evaluate(function () {
      var inp = document.getElementById('mwpClAdd'), dt = new DataTransfer();
      dt.setData('text/plain', '- 도면 확인\n- 납기 협의\n\n3) 계약서');
      inp.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await saved(); await wait(500);
    var cl = (await c.query("SELECT checklist FROM my_todos WHERE title = '할일화면 견적'")).rows[0].checklist;
    check(cl.length === 5 && cl[2].t === '도면 확인' && cl[4].t === '계약서', '여러 줄 붙여넣기 → 하위 항목 3개 (기호 · 번호 떼고) ' + JSON.stringify(cl.map(function (x) { return x.t; })));
    // 줄에서 Enter → 다음 줄 생기고 커서, 비운 채 Backspace → 지워짐
    await page.click('#mwpCl [data-ct="1"]');
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    var mid = await page.evaluate(function () { return { n: document.querySelectorAll('#mwpCl .mwp-cli').length, f: document.activeElement && document.activeElement.getAttribute('data-ct') }; });
    await page.keyboard.press('Backspace');
    var back = await page.evaluate(function () { return { n: document.querySelectorAll('#mwpCl .mwp-cli').length, f: document.activeElement && document.activeElement.getAttribute('data-ct') }; });
    check(mid.n === 6 && mid.f === '2' && back.n === 5 && back.f === '1', 'Enter 다음 줄 · 빈 줄 Backspace 지우기 ' + JSON.stringify([mid, back]));
    // 끌어서 순서 — 마지막(계약서)을 맨 위로
    await page.evaluate(function () {
      var rows = document.querySelectorAll('#mwpCl .mwp-cli'), dt = new DataTransfer();
      rows[4].querySelector('.mwp-grip').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      rows[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      rows[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await saved(); await wait(500);
    cl = (await c.query("SELECT checklist FROM my_todos WHERE title = '할일화면 견적'")).rows[0].checklist;
    check(cl[0].t === '계약서' && cl[0].d === false, '하위 항목 끌어서 순서');
    // 제목 고치기 · Esc 로 닫아도 저장됨
    await page.click('#mwpTitle', { clickCount: 3 });
    await page.keyboard.type('할일화면 견적 수정');
    await page.keyboard.press('Escape');
    await wait(900);
    check(!(await page.$('#mwPanel.on')) && (await c.query("SELECT COUNT(*)::int AS n FROM my_todos WHERE title = '할일화면 견적 수정'")).rows[0].n === 1, 'Esc 로 닫아도 고친 제목은 저장됨');
    await c.query("UPDATE my_todos SET title = '할일화면 견적' WHERE title = '할일화면 견적 수정'");
    await page.evaluate(function () { renderMyWork(); });
    await until(function () { return Array.from(document.querySelectorAll('#mMyWork .mw-title')).some(function (x) { return x.textContent === '할일화면 견적'; }); });

    // 4-3. 다른 출처도 같은 패널 — 이슈: 중요도 · 마감 빨리 고르기 · 원래 화면 열기
    await openTitle('할일화면 이슈');
    var ip = await page.evaluate(function () { var p = document.getElementById('mwPanel'); return { ro: !!p.querySelector('.mwp-title.mwp-ro'), src: !!p.querySelector('[data-p="source"]'), pri: !!p.querySelector('[data-pri-v]'), quick: p.querySelectorAll('[data-due-v]').length, cl: !!p.querySelector('#mwpCl') }; });
    check(ip.ro && ip.src && ip.pri && ip.quick === 5 && !ip.cl, '이슈 패널 — 제목 읽기 · 중요도 · 마감 빨리 고르기 · [이슈 화면에서 열기] ' + JSON.stringify(ip));
    await page.evaluate(function () { document.querySelector('#mwPanel [data-due-v]').click(); });   // 오늘
    await wait(700);
    check((await c.query("SELECT due_date FROM issues WHERE id = 'twu-i1'")).rows[0].due_date === kst(0), '마감 [오늘] → 이슈 마감 바뀜');
    check(await until(function () { var u = document.getElementById('mwUndo'); return u && /이슈에도 반영/.test(u.textContent) && u.querySelector('button'); }), '되돌리기 알림');
    await page.click('#mwUndo button');
    await wait(800);
    check((await c.query("SELECT due_date FROM issues WHERE id = 'twu-i1'")).rows[0].due_date === kst(5), '되돌리기 → 원래 마감');
    await page.keyboard.press('Escape');

    // 4-4. 달력 칩 · 끝낸 일도 같은 패널
    await page.click('#mMyWork [data-mwc-view="month"]');
    await page.waitForSelector('#mMyWork .mwc-month');
    await page.evaluate(function () { Array.from(document.querySelectorAll('.mwc-chip.mwc-task')).filter(function (x) { return /할일화면 견적/.test(x.textContent); })[0].click(); });
    check(await until(function () { var p = document.getElementById('mwPanel'); return p && p.classList.contains('on') && document.getElementById('mwpTitle').value === '할일화면 견적'; }), '월 보기 할 일 칩 → 패널');
    await wait(350);
    await page.click('#mwPanel [data-p="close"]');
    await page.click('#mMyWork [data-mwc-view="list"]');
    await page.waitForSelector('#mwAddTitle');
    await page.type('#mwAddTitle', '할일화면 끝낸 일');
    await page.keyboard.press('Enter');
    await until(function () { return Array.from(document.querySelectorAll('#mMyWork .mw-title')).some(function (x) { return x.textContent === '할일화면 끝낸 일'; }) && !document.querySelector('#mMyWork .is-pending'); });
    var dk = (await rowOf('할일화면 끝낸 일')).key;
    await page.evaluate(function (k) { var g = document.querySelector('#mMyWork [data-grp="nodue"]'); if (g && g.classList.contains('mw-folded')) g.querySelector('[data-fold]').click(); document.querySelector('#mMyWork input[data-done="' + k + '"]').click(); }, dk);
    check(await until(function () { var u = document.getElementById('mwUndo'); return u && /완료/.test(u.textContent); }), '완료 → 되돌리기 알림');
    await wait(400);
    await page.evaluate(function () { var d = document.querySelector('#mMyWork [data-grp="done"]'); if (d && d.classList.contains('mw-folded')) d.querySelector('[data-fold]').click(); });
    await openTitle('할일화면 끝낸 일');
    check(await page.evaluate(function () { return document.querySelector('#mwPanel [data-p="done"]').checked; }), '다 한 것의 할 일도 패널로 열림 (완료 표시)');
    await page.keyboard.press('Escape');

    // 4-5. 단축키 — ↓ 고르기 · 2 중요도 · Delete 지우기 → 되돌리기
    await page.evaluate(function () { document.activeElement && document.activeElement.blur(); _mw.sel = Array.from(document.querySelectorAll('#mMyWork .mw-row')).filter(function (r) { return /할일화면 견적/.test(r.textContent); })[0].getAttribute('data-key'); });
    await page.keyboard.press('2');
    await wait(600);
    check((await c.query("SELECT priority FROM my_todos WHERE title = '할일화면 견적'")).rows[0].priority === 2, '단축키 2 → 중요도 높음');
    await page.keyboard.press('1');
    await wait(500);
    await page.keyboard.press('Delete');
    await wait(600);
    check((await c.query("SELECT COUNT(*)::int AS n FROM my_todos WHERE title = '할일화면 견적' AND deleted_at IS NOT NULL")).rows[0].n === 1, 'Delete → 휴지통으로 (묻지 않음)');
    check(!(await rowOf('할일화면 견적')), '휴지통 항목은 목록에서 빠짐');
    await page.click('#mwUndo button');
    check(await until(function () { return Array.from(document.querySelectorAll('#mMyWork .mw-title')).some(function (x) { return x.textContent === '할일화면 견적'; }); }), '되돌리기 → 되살림');
    var back2 = (await c.query("SELECT priority, repeat, memo, checklist FROM my_todos WHERE title = '할일화면 견적'")).rows[0];
    check(back2 && back2.priority === 1 && back2.repeat === 'weekly' && back2.memo === '담당: 영업팀' && back2.checklist.length === 5, '되살린 할 일 내용 그대로 ' + JSON.stringify(back2 && { p: back2.priority, r: back2.repeat }));
    await page.keyboard.press('?');
    check(!!(await page.waitForSelector('#mwKeys', { timeout: 3000 }).catch(function () { return null; })), '? → 단축키 도움말');
    await page.keyboard.press('Escape');

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

    // 7. 보드 (v13.268 — 예전 4칸, 기본 칸은 중요 × 급함 자동)
    await page.click('#mMyWork [data-mwc-view="matrix"]');
    await page.waitForSelector('#mMyWork .mwb');
    var q = await page.evaluate(function () { var o = {}; document.querySelectorAll('.mwb-c[data-col]').forEach(function (s) { o[s.querySelector('.mwb-name').textContent] = s.textContent; }); return o; });
    check(/할일화면 견적/.test(q['🔥 지금 하기']) && /할일화면 이슈/.test(q['📅 계획하기']), '보드 기본 칸 — 긴급·내일 = 지금 하기, 높음·5일 뒤 = 계획하기 ' + Object.keys(q).join(','));
    await page.screenshot({ path: path.join(SHOT, 'tasks-matrix.png') });
    // 계획하기 → 나중에 로 끌면 그 칸에 고정 (중요도는 그대로)
    var qk = await page.evaluate(function () { var x = Array.from(document.querySelectorAll('[data-qk]')).filter(function (e) { return /할일화면 이슈/.test(e.textContent); })[0]; return x.getAttribute('data-qk'); });
    await page.evaluate(function (k) {
      var dst = Array.from(document.querySelectorAll('.mwb-c')).filter(function (s) { return /나중에/.test(s.querySelector('.mwb-name').textContent); })[0].querySelector('.mwb-l');
      var src = document.querySelector('[data-qk="' + k + '"]'), dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, qk);
    await wait(700);
    check((await c.query("SELECT urgency FROM issues WHERE id = 'twu-i1'")).rows[0].urgency === 'high', '보드에서 끌어도 중요도는 그대로');
    var pin = (await c.query("SELECT k.name FROM my_work_marks m JOIN my_work_categories k ON k.id = m.category_id WHERE m.user_id = $1 AND m.item_key = 'issue:twu-i1'", [me.id])).rows[0];
    check(pin && /나중에/.test(pin.name), '끌어 놓은 칸에 고정 ' + JSON.stringify(pin));
    check(await page.evaluate(function (k) { var c = document.querySelector('[data-qk="' + k + '"]').closest('.mwb-c'); return /나중에/.test(c.querySelector('.mwb-name').textContent) && !!c.querySelector('[data-qk="' + k + '"] .mwb-pin'); }, qk), '화면에서도 나중에 칸 · 📌 표시');

    // 8. 주 보기 — 마감 시각 있는 할 일은 시간 칸에
    await page.click('#mMyWork [data-mwc-view="week"]');
    await page.waitForSelector('#mMyWork .mwc-week');
    check(await page.evaluate(function (d) { var col = document.querySelector('.mwc-tcol[data-tday="' + d + '"]'); return !!col && Array.from(col.querySelectorAll('.mwc-blk')).some(function (b) { return /할일화면 견적/.test(b.textContent) && /15:00/.test(b.textContent); }); }, kst(1)), '주 보기 시간 칸에 마감 15:00 할 일');
    await page.click('#mMyWork [data-mwc-view="list"]');

    // 9. 업무 부하 — 휴가
    await page.click('#pageTabs [data-page="team"]'); await page.click('#tabWorkload');   // v13.280 업무 관리 › 업무 부하
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
