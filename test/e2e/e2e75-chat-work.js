// 💬 대화를 업무로 (v13.423) — ④ 메시지 → 이슈 · A/S · 일정 (칸 채운 등록 창) ⑤ 대화 → 정한 것 · 할 일 · 남은 질문 → 등록 · 확인 요청
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function kst(n) { var d = new Date(Date.now() + 9 * 3600000 + (n || 0) * 86400000); return d.toISOString().slice(0, 10); }
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id, COALESCE(display_name, name) AS n FROM users WHERE email = 'admin@t.com'")).rows[0];
  var kim = (await c.query("SELECT id, COALESCE(display_name, name) AS n FROM users WHERE email = 'kim@t.com'")).rows[0];
  await c.query('DELETE FROM chat_rooms WHERE tenant_id = $1', [adm.tenant_id]);
  require('fs').mkdirSync(SHOT, { recursive: true });
  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var b;
  try {
    b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-w' + Date.now()) });
    var a = (await b.pages())[0] || await b.newPage();
    a.on('pageerror', function (e) { errs.push(e.message); });
    a.on('dialog', function (d) { d.accept(); });
    await a.setViewport({ width: 1400, height: 900 });
    await a.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await a.waitForSelector('#loginEmail', { visible: true });
    await a.type('#loginEmail', 'admin@t.com'); await a.type('#loginPw', 'Test1234!'); await a.keyboard.press('Enter');
    await a.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    var pid = await a.evaluate(function () { return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name: '라인2 검사기 개조', orderNo: 'SO-2026-888', status: 'active', currentPhase: 'design' }) }).then(function (r) { return r.data.id; }); });
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '업무로 시험', userIds: [uid] }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.evaluate(function (r) { if (typeof setPage === 'function') setPage('messages'); chatOpenRoom(r); }, room);
    check(await until(a, function () { return CX.info && document.getElementById('cxIn'); }, null, 15000), '방 열림');
    async function say(t) {
      await a.evaluate(function (t) { return _cxSend(t); }, t);
      await until(a, function (t) { return CX.msgs.some(function (m) { return m.body === t && typeof m.id === 'number'; }); }, t, 8000);
      return a.evaluate(function (t) { return CX.msgs.filter(function (m) { return m.body === t; }).pop().id; }, t);
    }

    // ④-1 이슈로 — 메뉴에 있음 · 칸 채움(제목 · 긴급 · 마감) · 만들면 원문 답장으로 카드
    var m1 = await say('라인2 검사기 개조 카메라 초점이 계속 흔들려요 긴급\nS/N CAM-2231 내일까지 봐 주세요');
    await a.evaluate(function (id) { var el = document.querySelector('#cxMsgs .cx-m[data-mid="' + id + '"] [data-a="more"]'); _cxMsgMenu(el, _cxFindMsg(id)); }, m1);
    var menu = await a.evaluate(function () { var x = document.getElementById('cxMenu'); return x ? x.textContent : ''; });
    check(/이슈로/.test(menu) && /A\/S 접수로/.test(menu) && /일정으로/.test(menu), '메시지 메뉴에 이슈로 · A/S 접수로 · 일정으로');
    await a.keyboard.press('Escape'); await a.evaluate(function () { var x = document.getElementById('cxMenu'); if (x) x.remove(); var k = document.getElementById('cxMenuBk'); if (k) k.remove(); });
    await a.evaluate(function (id) { chatToWork(_cxFindMsg(id), 'issue', { ai: false }); }, m1);
    check(await until(a, function () { return document.querySelector('#chatWorkModal [data-k="title"]'); }, null, 10000), '이슈 등록 창 — 칸 채워서 열림');
    var f1 = await a.evaluate(function () { var q = function (k) { var x = document.querySelector('#chatWorkModal [data-k="' + k + '"]'); return x.type === 'checkbox' ? x.checked : x.value; }; return { title: q('title'), urgent: q('urgent'), due: q('dueDate'), pid: q('projectId'), tag: document.querySelector('#chatWorkModal .cs-tag').textContent }; });
    check(/카메라 초점/.test(f1.title) && f1.urgent === true && f1.due === kst(1), '제목 · 긴급 · 마감(내일) 채움 ' + JSON.stringify(f1));
    check(f1.pid === pid, '글 속 프로젝트 이름 → 프로젝트 기본 선택');
    check(/자동으로 채움/.test(f1.tag), 'AI 없으면 "자동으로 채움" 꼬리표');
    await a.screenshot({ path: path.join(SHOT, 'e2e75-issue.png') });
    await a.click('#chatWorkModal [data-go]');
    check(await until(a, function () { return !document.getElementById('chatWorkModal') && CX.msgs.some(function (m) { return m.quote && m.cards && m.cards[0] && m.cards[0].type === 'issue'; }); }, null, 10000), '만들면 원문 답장 + 이슈 카드');
    var iss = (await c.query("SELECT title, urgency, project_id, due_date::text AS d FROM issues WHERE tenant_id = $1 AND title LIKE '%카메라 초점%' ORDER BY created_at DESC LIMIT 1", [adm.tenant_id])).rows[0];
    check(iss && iss.urgency === 'urgent' && iss.project_id === pid && String(iss.d).slice(0, 10) === kst(1), '이슈 실제로 생김 (긴급 · 프로젝트 · 마감) ' + JSON.stringify(iss));

    // ④-2 A/S 접수 — 시리얼 · P1 · 고객사 비면 막음
    await a.evaluate(function (id) { chatToWork(_cxFindMsg(id), 'as', { ai: false }); }, m1);
    await until(a, function () { return document.querySelector('#chatWorkModal [data-k="serialNo"]'); }, null, 10000);
    var f2 = await a.evaluate(function () { var q = function (k) { return document.querySelector('#chatWorkModal [data-k="' + k + '"]').value; }; return { sn: q('serialNo'), pr: q('priority'), sum: q('issueSummary') }; });
    check(f2.sn === 'CAM-2231' && f2.pr === 'P1' && /카메라 초점/.test(f2.sum), 'A/S — 시리얼 · P1 · 증상 채움 ' + JSON.stringify(f2));
    await a.click('#chatWorkModal [data-go]');
    await wait(300);
    check(await a.evaluate(function () { return !!document.getElementById('chatWorkModal'); }), '고객사 비었으면 안 만들어짐');
    await a.type('#chatWorkModal [data-k="customerName"]', '코아비스');
    await a.click('#chatWorkModal [data-go]');
    check(await until(a, function () { return CX.msgs.some(function (m) { return m.cards && m.cards[0] && m.cards[0].type === 'as'; }); }, null, 10000), 'A/S 카드 답장');
    var as = (await c.query("SELECT customer_name, serial_no, priority, project_id, ticket_no FROM as_tickets WHERE tenant_id = $1 AND serial_no = 'CAM-2231'", [adm.tenant_id])).rows[0];
    check(as && as.customer_name === '코아비스' && as.priority === 'P1' && as.project_id === pid, 'A/S 실제로 접수 ' + JSON.stringify(as));

    // ④-3 일정으로 — 날짜 · 시간
    var m3 = await say('금요일 14:00 고객 입회 시운전');
    await a.evaluate(function (id) { chatToWork(_cxFindMsg(id), 'event', { ai: false }); }, m3);
    await until(a, function () { return document.querySelector('#chatWorkModal [data-k="startDate"]'); }, null, 10000);
    var f3 = await a.evaluate(function () { var q = function (k) { return document.querySelector('#chatWorkModal [data-k="' + k + '"]').value; }; return { t: q('title'), d: q('startDate'), s: q('startTime') }; });
    var fri = new Date(kst(0) + 'T00:00:00Z'); fri.setUTCDate(fri.getUTCDate() + ((5 - fri.getUTCDay() + 7) % 7)); fri = fri.toISOString().slice(0, 10);
    check(/입회 시운전/.test(f3.t) && f3.d === fri && f3.s === '14:00', '일정 — 금요일 · 14:00 ' + JSON.stringify(f3));
    await a.click('#chatWorkModal [data-go]');
    check(await until(a, function () { return CX.msgs.some(function (m) { return m.cards && m.cards[0] && m.cards[0].type === 'event'; }); }, null, 10000), '일정 카드 답장');
    var ev = (await c.query("SELECT start_date, start_time FROM events WHERE tenant_id = $1 AND title LIKE '%입회 시운전%'", [adm.tenant_id])).rows[0];
    check(ev && String(ev.start_date).slice(0, 10) === fri && String(ev.start_time).slice(0, 5) === '14:00', '일정 실제로 생김 ' + JSON.stringify(ev));

    // ⑤ 정한 것 · 할 일 · 남은 질문
    var ins = async function (uid, body) { await c.query("INSERT INTO chat_messages (tenant_id, room_id, user_id, kind, body) VALUES ($1,$2,$3,'text',$4)", [adm.tenant_id, room, uid, body]); };
    await ins(adm.id, '다음 주 화요일 출하로 결정했습니다');
    await ins(kim.id, '제가 내일까지 체크리스트 정리할게요');
    await ins(adm.id, '@' + kim.n + ' 견적서 금요일까지 보내 주세요');
    await ins(kim.id, '포장 업체는 어디로 하죠?');
    await a.evaluate(function () { chatDigest({ ai: false }); });
    check(await until(a, function () { return document.querySelectorAll('#chatDigestModal .cw-td').length >= 2; }, null, 15000), '정리 창 — 할 일 줄');
    var dg = await a.evaluate(function () {
      var M = document.getElementById('chatDigestModal');
      return { txt: M.textContent, todos: Array.from(M.querySelectorAll('.cw-td')).map(function (r) { return { who: r.querySelector('[data-who]').value, what: r.querySelector('[data-what]').value, due: r.querySelector('[data-due]').value }; }) };
    });
    check(/출하로 결정/.test(dg.txt), '정한 것 — 출하 결정');
    check(/포장 업체/.test(dg.txt), '남은 질문 — 포장 업체');
    var tCk = dg.todos.filter(function (t) { return /체크리스트/.test(t.what); })[0], tQt = dg.todos.filter(function (t) { return /견적서/.test(t.what); })[0];
    check(tCk && tCk.who === kim.n && tCk.due === kst(1), '할 일 — 김 · 체크리스트 · 내일 ' + JSON.stringify(tCk));
    check(tQt && tQt.who === kim.n && tQt.due === fri && !/@/.test(tQt.what), '할 일 — @부른 사람 · 견적서 · 금요일 ' + JSON.stringify(tQt));
    await a.screenshot({ path: path.join(SHOT, 'e2e75-digest.png') });
    // 견적서는 내가 맡기로 바꾸고, 나머지는 그대로 → 내 할 일 1 + 김에게 확인 요청 1
    await a.evaluate(function (me) {
      var rows = Array.from(document.querySelectorAll('#chatDigestModal .cw-td'));
      rows.forEach(function (r) { var w = r.querySelector('[data-what]').value; r.querySelector('[data-ck]').checked = /견적서|체크리스트/.test(w); if (/견적서/.test(w)) r.querySelector('[data-who]').value = me; });
    }, adm.n);
    await a.click('#chatDigestModal [data-reg]');
    check(await until(a, function () { return !document.getElementById('chatDigestModal'); }, null, 10000), '등록하면 창 닫힘');
    var td = (await c.query("SELECT title, due_date FROM my_todos WHERE user_id = $1 AND title LIKE '%견적서%'", [adm.id])).rows[0];
    check(td && String(td.due_date).slice(0, 10) === fri, '내 할 일 — 견적서 · 금요일 ' + JSON.stringify(td));
    check(await until(a, function (n) { return CX.msgs.some(function (m) { return m.body && m.body.indexOf('@' + n + ' 할 일') === 0 && /체크리스트/.test(m.body) && m.ack; }); }, kim.n, 10000), '김에게 @부르고 ✔ 확인 요청 메시지');

    // /정리 명령 → 창
    await a.focus('#cxIn'); await a.keyboard.type('/정리');
    await a.evaluate(function () { var s = document.querySelector('[data-sugg]'); if (s) s.hidden = true; });
    await a.keyboard.press('Enter');
    check(await until(a, function () { return document.getElementById('chatDigestModal'); }, null, 8000), '/정리 → 정리 창');
    check(await a.evaluate(function () { return !CX.msgs.some(function (m) { return m.body === '/정리'; }); }), '/정리 는 대화에 안 남음');
    await until(a, function () { return document.querySelector('#chatDigestModal [data-post]'); }, null, 15000);
    await a.click('#chatDigestModal [data-post]');
    check(await until(a, function () { return CX.msgs.some(function (m) { return /^📋 대화 정리/.test(m.body || '') && /■ 정한 것/.test(m.body); }); }, null, 8000), '📌 방에 올리기 — 정리 글');

    // 휴대폰 폭 — 정리 창
    await a.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await wait(800);
    await a.evaluate(function (r) { chatOpenRoom(r); }, room);
    await until(a, function () { return CX.info && document.getElementById('cxMsgs'); }, null, 10000);
    await a.evaluate(function () { chatDigest({ ai: false }); });
    await until(a, function () { return document.querySelectorAll('#chatDigestModal .cw-td').length >= 1; }, null, 15000);
    check(await a.evaluate(function () { return !/·\s*다음 주 화요일/.test(document.getElementById('chatDigestModal').textContent); }), '방에 올린 정리 글은 다시 안 뽑힘');
    var ov = await a.evaluate(function () { var bx = document.querySelector('#chatDigestModal .wa-modal-box'); return bx.scrollWidth - bx.clientWidth; });
    check(ov <= 1, '휴대폰 — 정리 창 옆으로 안 넘침 (' + ov + ')');
    await a.screenshot({ path: path.join(SHOT, 'e2e75-phone.png') });
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL', e.stack || e); }
  finally { if (b) await b.close(); await c.end(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
