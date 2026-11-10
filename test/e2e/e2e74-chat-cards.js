// 💬 업무 카드 살리기 (v13.422) — ① # 로 업무 부르기 ② 글 속 수주번호 · A/S 번호 · 프로젝트 이름 펼침 ③ 카드에서 바로 처리
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var kim = (await c.query("SELECT id FROM users WHERE email = 'kim@t.com'")).rows[0];
  await c.query('DELETE FROM chat_rooms WHERE tenant_id = $1', [adm.tenant_id]);
  require('fs').mkdirSync(SHOT, { recursive: true });
  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var b;
  try {
    b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-k' + Date.now()) });
    var a = (await b.pages())[0] || await b.newPage();
    a.on('pageerror', function (e) { errs.push(e.message); });
    a.on('dialog', function (d) { d.accept(); });
    await a.setViewport({ width: 1400, height: 900 });
    await a.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await a.waitForSelector('#loginEmail', { visible: true });
    await a.type('#loginEmail', 'admin@t.com'); await a.type('#loginPw', 'Test1234!'); await a.keyboard.press('Enter');
    await a.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });

    // 표본 — 프로젝트(수주번호) · 마일스톤 · A/S · 할 일
    var S = await a.evaluate(async function () {
      var o = {};
      var p = await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name: '코아비스 비전 검사기 설치', orderNo: 'SO-2026-777', status: 'active', currentPhase: 'design', startDate: '2026-10-01', endDate: '2026-12-20', progress: 35 }) });
      o.pid = p.data.id;
      var m = await apiFetch('/api/milestones', { method: 'POST', body: JSON.stringify({ projectId: o.pid, name: '설계 검토 회의', startDate: '2026-11-01', endDate: '2026-11-14', status: 'active' }) });
      o.mid = m.data.id;
      var t = await apiFetch('/api/as-tickets', { method: 'POST', body: JSON.stringify({ customerName: '코아비스', issueSummary: '검사기 카메라 초점 흔들림', priority: 'high' }) });
      o.asid = t.data.id; o.tno = t.data.ticket_no;
      var d = await apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: '견적서 회신 보내기', dueDate: new Date().toISOString().slice(0, 10) }) });
      o.tid = d.data.id;
      return o;
    });
    check(S.pid && S.mid && S.asid && /^AS-\d{4}-\d{2}-\d{3}$/.test(S.tno || '') && S.tid, '표본 만듦 (' + S.tno + ')');
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '카드 시험', userIds: [uid] }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.evaluate(function (r) { if (typeof setPage === 'function') setPage('messages'); chatOpenRoom(r); }, room);
    check(await until(a, function () { return CX.info && document.getElementById('cxIn'); }, null, 15000), '방 열림');

    // ① # 로 부르기 → 카드 칩
    await a.focus('#cxIn'); await a.keyboard.type('설치 일정 확인 부탁 #코아비스');
    check(await until(a, function () { var s = document.querySelector('[data-sugg]'); return s && !s.hidden && /업무 카드/.test(s.textContent) && /코아비스 비전 검사기 설치/.test(s.textContent); }), '# 치면 업무 자동완성 (프로젝트 보임)');
    await a.screenshot({ path: path.join(SHOT, 'e2e74-hash.png') });
    var it = await a.evaluate(function () { var bs = Array.from(document.querySelectorAll('[data-sugg] [data-si]')); var i = bs.findIndex(function (x) { return /코아비스 비전 검사기 설치/.test(x.textContent) && /프로젝트/.test(x.textContent); }); return i; });
    for (var k = 0; k < it; k++) await a.keyboard.press('ArrowDown');
    await a.keyboard.press('Enter');
    var st1 = await a.evaluate(function () { return { v: document.getElementById('cxIn').value, cards: CX.cards.map(function (x) { return x.type + ':' + x.title; }) }; });
    check(st1.v.trim() === '설치 일정 확인 부탁' && st1.cards.length === 1 && st1.cards[0] === 'project:코아비스 비전 검사기 설치', '고르면 #글자는 빠지고 카드 칩으로 (' + JSON.stringify(st1) + ')');
    await a.keyboard.press('Enter');
    check(await until(a, function () { return Array.from(document.querySelectorAll('#cxMsgs .cx-card')).some(function (x) { return /코아비스 비전 검사기 설치/.test(x.textContent) && x.querySelector('.cx-lv'); }); }, null, 10000), '보낸 카드에 지금 상태 줄 (단계 · 진행률 · 마감)');
    var lv = await a.evaluate(function () { var x = Array.from(document.querySelectorAll('#cxMsgs .cx-cards:not(.cx-unf) .cx-card')).pop(); return { t: x.querySelector('.cx-lv').textContent, btn: (x.querySelector('[data-kact]') || {}).textContent || '' }; });
    check(/설계/.test(lv.t) && /35%/.test(lv.t) && /제작 단계로/.test(lv.btn), '프로젝트 카드 — 설계 · 35% · ▸ 제작 단계로 (' + lv.t + ' / ' + lv.btn + ')');
    check(await a.evaluate(function () { return !/#코아/.test(CX.msgs[CX.msgs.length - 1].body); }), '보낸 글에 #검색어 안 남음');

    // ② 글 속 A/S 번호 · 수주번호 → 펼침
    await a.focus('#cxIn'); await a.keyboard.type('SO-2026-777 건이랑 ' + S.tno + ' 같이 봐 주세요');
    await a.keyboard.press('Enter');
    check(await until(a, function () { var u = document.querySelectorAll('#cxMsgs .cx-unf .cx-card'); return u.length === 2; }, null, 10000), '글 속 수주번호 · A/S 번호가 카드 2장으로 펼쳐짐');
    var unf = await a.evaluate(function () { return Array.from(document.querySelectorAll('#cxMsgs .cx-unf .cx-card')).map(function (x) { return x.textContent; }); });
    check(/검사기 카메라 초점/.test(unf.join('|')) && /비전 검사기 설치/.test(unf.join('|')), '펼친 카드 — A/S 와 프로젝트 (' + unf.join(' | ').slice(0, 160) + ')');
    check(/접수/.test(unf.join('')) && /진행 시작/.test(unf.join('')), 'A/S 카드 — 접수 상태 + 진행 시작 단추');
    await a.focus('#cxIn'); await a.keyboard.type('코아비스 비전 검사기 설치 관련해서 회의해요');
    await a.keyboard.press('Enter');
    check(await until(a, function () { var ms = document.querySelectorAll('#cxMsgs .cx-m'); var l = ms[ms.length - 1]; return l && l.querySelectorAll('.cx-unf .cx-card').length === 1; }, null, 10000), '프로젝트 이름만 써도 펼침');
    await a.focus('#cxIn'); await a.keyboard.type('#1 안건 먼저');
    await wait(600);
    check(await a.evaluate(function () { var s = document.querySelector('[data-sugg]'); return !s || s.hidden; }), '#1 처럼 숫자만은 자동완성 안 뜸');
    await a.evaluate(function () { var t = document.getElementById('cxIn'); t.value = ''; t.dispatchEvent(new Event('input')); });

    // ③ 카드에서 처리 — A/S 진행 시작 (펼친 카드)
    await a.evaluate(function () { var x = Array.from(document.querySelectorAll('#cxMsgs .cx-unf [data-kact="as_go"]'))[0]; x.click(); });
    check(await until(a, function () { return Array.from(document.querySelectorAll('#cxMsgs .cx-sys')).some(function (x) { return /검사기 카메라 초점/.test(x.textContent) && /진행 시작/.test(x.textContent); }); }, null, 10000), '방에 "진행 시작" 한 줄');
    var asSt = (await c.query('SELECT status FROM as_tickets WHERE id = $1', [S.asid])).rows[0].status;
    check(asSt === 'in_progress', 'A/S 실제로 진행 중 (' + asSt + ')');
    check(await until(a, function () { return Array.from(document.querySelectorAll('#cxMsgs .cx-unf .cx-card')).some(function (x) { return /진행 중/.test(x.textContent) && !x.querySelector('[data-kact="as_go"]'); }); }, null, 8000), '카드도 진행 중으로 · 진행 시작 단추 사라짐');

    // 마일스톤 · 할 일 카드 (API 로 붙여 보냄)
    await a.evaluate(function (S) { return _cxSend('이번 주 챙길 것', null, [{ type: 'milestone', id: S.mid, title: '설계 검토 회의', sub: '' }, { type: 'todo', id: S.tid, title: '견적서 회신 보내기', sub: '' }]); }, S);
    check(await until(a, function () { return document.querySelector('#cxMsgs [data-kact="ms_done"]') && document.querySelector('#cxMsgs [data-kact="td_done"]'); }, null, 10000), '마일스톤 ✓ 완료 · 할 일 ✓ 완료 단추');
    await a.screenshot({ path: path.join(SHOT, 'e2e74-cards.png') });
    await a.click('#cxMsgs [data-kact="ms_done"]');
    check(await until(a, function () { return document.querySelector('#cxMsgs [data-kact="ms_open"]'); }, null, 10000), '마일스톤 완료 → 다시 열기 단추');
    check((await c.query('SELECT status FROM milestones WHERE id = $1', [S.mid])).rows[0].status === 'done', '마일스톤 실제로 완료');
    await a.click('#cxMsgs [data-kact="td_tmr"]');
    await until(a, function () { return Array.from(document.querySelectorAll('#cxMsgs .cx-sys')).some(function (x) { return /내일로/.test(x.textContent); }); }, null, 8000);
    var due = (await c.query("SELECT left(due_date::text, 10) AS d FROM my_todos WHERE id = $1", [S.tid])).rows[0].d;
    check(due > new Date().toISOString().slice(0, 10) || due === new Date(Date.now() + 86400000).toISOString().slice(0, 10), '할 일 내일로 (' + due + ')');
    await a.click('#cxMsgs [data-kact="td_done"]');
    check(await until(a, function () { return document.querySelector('#cxMsgs [data-kact="td_undo"]'); }, null, 10000), '할 일 완료 → 되돌리기 단추');
    check(!!(await c.query('SELECT done_at FROM my_todos WHERE id = $1', [S.tid])).rows[0].done_at, '할 일 실제로 완료');

    // 프로젝트 다음 단계 (확인 창 → 예)
    await a.evaluate(function () { Array.from(document.querySelectorAll('#cxMsgs .cx-cards:not(.cx-unf) [data-kact="phase"]'))[0].click(); });
    await until(a, function () { return Array.from(document.querySelectorAll('#cxMsgs .cx-sys')).some(function (x) { return /제작 단계로/.test(x.textContent); }); }, null, 10000);
    check((await c.query('SELECT current_phase FROM projects WHERE id = $1', [S.pid])).rows[0].current_phase === 'manufacture', '프로젝트 단계 설계 → 제작');
    check(await until(a, function () { return Array.from(document.querySelectorAll('#cxMsgs [data-kact="phase"]')).every(function (x) { return /검수 단계로/.test(x.textContent); }); }, null, 8000), '모든 카드가 다음 단계(검수)로 바뀜');

    // 권한 — 다른 사람 할 일은 상태도 단추도 없음 (peek 이 null)
    var other = await c.query("INSERT INTO my_todos (id, tenant_id, user_id, title) VALUES ('td-e2e74-x', $1, $2, '남의 할 일') RETURNING id", [adm.tenant_id, kim.id]).then(function (r) { return r.rows[0].id; }, function (e) { return 'ERR ' + e.message; });
    var pk = await a.evaluate(function (id) { return apiFetch('/api/chat/peek', { method: 'POST', body: JSON.stringify({ refs: [{ type: 'todo', id: id }] }) }).then(function (r) { return r.data.live; }); }, other);
    check(pk && pk['todo:' + other] === null, '남의 할 일은 볼 수 없음 (' + JSON.stringify(pk) + ')');
    await a.screenshot({ path: path.join(SHOT, 'e2e74-done.png') });

    // 휴대폰 폭
    await a.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await wait(800);
    await a.evaluate(function (r) { chatOpenRoom(r); }, room);
    await until(a, function () { return document.querySelectorAll('#cxMsgs .cx-unf .cx-card').length >= 3; }, null, 10000);
    await wait(500);
    var ov = await a.evaluate(function () { var bx = document.getElementById('cxMsgs'); return Array.from(bx.querySelectorAll('.cx-card')).filter(function (x) { var r = x.getBoundingClientRect(); return r.width && r.right > innerWidth + 1; }).length; });
    check(ov === 0, '휴대폰 — 카드가 화면 밖으로 안 나감');
    await a.screenshot({ path: path.join(SHOT, 'e2e74-phone.png') });
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL', e.stack || e); }
  finally { if (b) await b.close(); await c.end(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
