// 내 업무 할 일 관리 API — 중요도 4단계(원래 자리 반영) · 할 일 상세 · 반복 · 오늘 집중 · 순서 · 사람 목록 · 휴가 · 장소 · 텔레그램 /todo /event · 브리핑 · 마감 시각 알림 (v13.253)
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var B = 'http://localhost:3000';
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
async function login(email) {
  var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) });
  return (await r.json()).data.accessToken;
}
function api(tok) {
  return async function (method, url, body) {
    var r = await fetch(B + url, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
    var j = null; try { j = await r.json(); } catch (_) {}
    return { s: r.status, d: j };
  };
}
var n = 0;
function check(name, c, x) { if (!c) { console.log('FAIL', name, JSON.stringify(x, null, 1).slice(0, 1500)); throw new Error('FAIL ' + name); } n++; console.log('✔', name); }
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
function mondayOf(d) { var t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - (t.getUTCDay() + 6) % 7); return t.toISOString().slice(0, 10); }

(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var U = {};
  (await c.query("SELECT id, email, tenant_id FROM users WHERE email IN ('admin@t.com','kim@t.com','lee@t.com')")).rows.forEach(function (r) { U[r.email.split('@')[0]] = r; });
  var tid = U.kim.tenant_id, kim = U.kim.id, lee = U.lee.id, adm = U.admin.id;
  async function clean() {
    await c.query("DELETE FROM my_todos WHERE title LIKE '업무%'");
    await c.query("DELETE FROM mindmaps WHERE title LIKE '업무%'");
    await c.query("DELETE FROM events WHERE title LIKE '업무%'");
    await c.query("DELETE FROM meetings WHERE id LIKE 'tk-%' OR title LIKE '업무%'");
    await c.query("DELETE FROM issues WHERE id LIKE 'tk-%'");
    await c.query("DELETE FROM prestudies WHERE id LIKE 'tk-%'");
    await c.query("DELETE FROM project_dev_items WHERE id LIKE 'tk-%'");
    await c.query("DELETE FROM milestone_assignments WHERE id LIKE 'tk-%'");
    await c.query("DELETE FROM milestones WHERE id LIKE 'tk-%'");
    await c.query("DELETE FROM projects WHERE id LIKE 'tk-%'");
    await c.query('DELETE FROM my_work_marks');
    await c.query("DELETE FROM edit_locks WHERE resource_type = 'mindmap'");
  }
  await clean();
  await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('tk-p1', '업무 프로젝트', 'active', 'tenant', $1, $2)", [adm, tid]);
  await c.query("INSERT INTO issues (id, project_id, title, status, urgency, due_date, assignees, tenant_id) VALUES ('tk-i1', 'tk-p1', '업무 이슈', 'open', 'low', $1, '[\"김팀원\"]', $2)", [kst(2), tid]);
  await c.query("INSERT INTO meetings (id, project_id, title, meet_date, tenant_id) VALUES ('tk-m1', 'tk-p1', '업무회의', $1, $2)", [kst(0), tid]);
  await c.query("INSERT INTO meeting_action_items (id, meeting_id, title, assignee_id, assignee_name, due_date, status, tenant_id) VALUES ('tk-a1', 'tk-m1', '업무 액션', $1, '김팀원', $2, 'open', $3)", [kim, kst(1), tid]);
  await c.query("INSERT INTO prestudies (id, title, client, owner_id, due_date, status, priority, tenant_id) VALUES ('tk-s1', '업무 사전검토', 'B사', $1, $2, 'reviewing', 'high', $3)", [kim, kst(3), tid]);
  await c.query("INSERT INTO milestones (id, project_id, name, end_date, status, tenant_id) VALUES ('tk-ms1', 'tk-p1', '업무 마일스톤', $1, 'progress', $2)", [kst(10), tid]);
  await c.query("INSERT INTO milestone_assignments (id, tenant_id, milestone_id, project_id, user_id) VALUES ('tk-ma1', $1, 'tk-ms1', 'tk-p1', $2)", [tid, kim]);
  await c.query("INSERT INTO project_dev_items (id, tenant_id, project_id, milestone_id, title, status, priority, assignee_id) VALUES ('tk-d1', $1, 'tk-p1', 'tk-ms1', '업무 개발', 'todo', 'urgent', $2)", [tid, kim]);
  var doc = { sheets: [{ id: 's1', title: '시트', root: { id: 'r', text: '업무 맵', children: [
    { id: 'n1', text: '업무 맵 주제', assigneeId: kim, dueDate: kst(1), markers: ['priority-1', 'flag-red'], children: [] },
    { id: 'n2', text: '업무 맵 낮음', assigneeId: kim, dueDate: kst(1), markers: ['priority-7'], children: [] }
  ] } }] };
  await c.query("INSERT INTO mindmaps (id, tenant_id, title, scope, owner_id, doc, node_count, version) VALUES ('mm-tk1', $1, '업무 맵', 'org', $2, $3, 3, 1)", [tid, adm, JSON.stringify(doc)]);

  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com')), L = api(await login('lee@t.com'));
  try {
    // ── 1. 원래 값 → 4단계 읽기 ──
    var items = (await K('GET', '/api/my-work')).d.data;
    var by = {}; items.forEach(function (x) { by[x.src + ':' + x.id] = x; });
    check('읽기 — 이슈 low → 낮음(4)', by['issue:tk-i1'].pri === 4, by['issue:tk-i1']);
    check('읽기 — 사전검토 high → 높음(2) · 개발 urgent → 긴급(1)', by['prestudy:tk-s1'].pri === 2 && by['dev:tk-d1'].pri === 1 && by['dev:tk-d1'].urgent === true);
    check('읽기 — 맵 priority-1 → 긴급 (예전엔 늘 빠지던 것) · priority-7 → 낮음', by['mindmap:mm-tk1:n1'].pri === 1 && by['mindmap:mm-tk1:n1'].urgent === true && by['mindmap:mm-tk1:n2'].pri === 4);
    check('읽기 — 액션 · 마일스톤 보통(3), 마일스톤은 못 바꿈', by['action:tk-a1'].pri === 3 && by['milestone:tk-ms1'].pri === 3 && by['milestone:tk-ms1'].canPri === false && by['issue:tk-i1'].canPri === true);

    // ── 2. 중요도 바꾸기 → 원래 자리 ──
    var P = function (src, id, p, who) { return (who || K)('PUT', '/api/my-work/priority', { src: src, id: id, priority: p }); };
    check('이슈 → 높음 = urgency high', (await P('issue', 'tk-i1', 2)).s === 200 && (await c.query("SELECT urgency FROM issues WHERE id = 'tk-i1'")).rows[0].urgency === 'high');
    check('액션 → 긴급 = priority 1', (await P('action', 'tk-a1', 1)).s === 200 && (await c.query("SELECT priority FROM meeting_action_items WHERE id = 'tk-a1'")).rows[0].priority === 1);
    check('개발 → 낮음 = low', (await P('dev', 'tk-d1', 4)).s === 200 && (await c.query("SELECT priority FROM project_dev_items WHERE id = 'tk-d1'")).rows[0].priority === 'low');
    check('사전검토 → 긴급 = urgent', (await P('prestudy', 'tk-s1', 1)).s === 200 && (await c.query("SELECT priority FROM prestudies WHERE id = 'tk-s1'")).rows[0].priority === 'urgent');
    await P('mindmap', 'mm-tk1:n1', 2);
    var n1 = (await c.query("SELECT doc FROM mindmaps WHERE id = 'mm-tk1'")).rows[0].doc.sheets[0].root.children[0];
    check('맵 → 높음 = priority-2 (다른 표시는 그대로)', JSON.stringify(n1.markers) === '["priority-2","flag-red"]', n1.markers);
    await P('mindmap', 'mm-tk1:n1', 3);
    n1 = (await c.query("SELECT doc FROM mindmaps WHERE id = 'mm-tk1'")).rows[0].doc.sheets[0].root.children[0];
    check('맵 → 보통 = 중요도 표시 뺌', JSON.stringify(n1.markers) === '["flag-red"]', n1.markers);
    check('마일스톤은 400', (await P('milestone', 'tk-ms1', 1)).s === 400);
    check('1~4 밖은 400', (await P('issue', 'tk-i1', 5)).s === 400 && (await P('issue', 'tk-i1', 0)).s === 400);
    check('남의 것은 403', (await L('PUT', '/api/my-work/priority', { src: 'issue', id: 'tk-i1', userId: kim, priority: 1 })).s === 403);
    check('담당 아니면 404', (await P('issue', 'tk-i1', 1, L)).s === 404);
    await c.query("INSERT INTO edit_locks (resource_type, resource_id, user_id, user_name, tenant_id, expires_at) VALUES ('mindmap', 'mm-tk1', $1, '관리자', $2, now() + interval '5 minutes')", [adm, tid]);
    check('맵 편집 중이면 409', (await P('mindmap', 'mm-tk1:n2', 1)).s === 409);
    await c.query("DELETE FROM edit_locks WHERE resource_type = 'mindmap'");
    var ma = await A('PUT', '/api/meetings/tk-m1/actions/tk-a1', { priority: 3 });
    check('회의 화면에서 보통으로 = null', ma.s === 200 && ma.d.data.priority === null, ma.d);

    // ── 3. 할 일 상세 ──
    var t1 = await K('POST', '/api/my-work/todos', { title: '업무 상세', dueDate: kst(0), dueTime: '9:30', priority: 1, status: 'waiting', waitingFor: '고객 회신', memo: '메모 내용', estimateH: 6, checklist: [{ t: '하나', d: true }, { t: '둘' }, { t: '  ' }] });
    var tr = t1.d.data;
    check('할 일 만들기 — 칸 저장 · 빈 하위 항목 빠짐', t1.s === 201 && tr.priority === 1 && tr.status === 'waiting' && tr.due_time === '09:30' && Number(tr.estimate_h) === 6 && tr.checklist.length === 2 && tr.checklist[0].d === true, tr);
    check('잘못된 값 400 — 중요도 · 상태 · 반복 · 예상 시간', (await K('POST', '/api/my-work/todos', { title: '업무 x', priority: 9 })).s === 400 && (await K('PUT', '/api/my-work/todos/' + tr.id, { status: 'zzz' })).s === 400 &&
      (await K('PUT', '/api/my-work/todos/' + tr.id, { repeat: 'yearly' })).s === 400 && (await K('PUT', '/api/my-work/todos/' + tr.id, { estimateH: -1 })).s === 400);
    var me = (await K('GET', '/api/my-work')).d.data.filter(function (x) { return x.id === tr.id; })[0];
    check('목록 — 상태 · 대기 · 메모 · 시각 · 하위 항목 진행률 50%', me.todoStatus === 'waiting' && me.waitingFor === '고객 회신' && me.memo === '메모 내용' && me.dueTime === '09:30' && me.checkDone === 1 && me.checkTotal === 2 && me.progress === 50, me);
    check('남은 양 — 6시간(1.5) × 남은 50% = 0.75', me.weight === 0.75, me.weight);
    var other = (await A('GET', '/api/my-work?userId=' + kim)).d.data.filter(function (x) { return x.id === tr.id; })[0];
    check('남의 개인 할 일은 목록에 안 나옴', other === undefined, other);

    // ── 4. 반복 ──
    var rp = (await K('POST', '/api/my-work/todos', { title: '업무 주간보고', dueDate: kst(0), repeat: 'weekly', priority: 2, checklist: [{ t: '작성', d: true }] })).d.data;
    var dn = await K('PUT', '/api/my-work/done', { src: 'todo', id: rp.id, done: true });
    var nx = (await c.query("SELECT * FROM my_todos WHERE title = '업무 주간보고' AND done_at IS NULL")).rows;
    check('반복 끝내면 다음 회차 (+7일, 중요도 · 하위 항목 초기화)', dn.d.data.next && nx.length === 1 && nx[0].due_date === kst(7) && nx[0].priority === 2 && nx[0].checklist[0].d === false, nx);
    await K('PUT', '/api/my-work/done', { src: 'todo', id: rp.id, done: false });
    await K('PUT', '/api/my-work/done', { src: 'todo', id: rp.id, done: true });
    check('되돌렸다 다시 끝내도 다음 회차는 하나', (await c.query("SELECT COUNT(*)::int AS n FROM my_todos WHERE title = '업무 주간보고' AND done_at IS NULL")).rows[0].n === 1);
    var rep = require(path.join(__dirname, '../../server/lib/todo-repeat'));
    check('다음 마감 — 평일(금→월) · 매월(1/31→2/28) · 매일', rep.nextDue('2026-10-30', 'weekdays') === '2026-11-02' && rep.nextDue('2026-01-31', 'monthly') === '2026-02-28' && rep.nextDue('2026-12-31', 'daily') === '2027-01-01');

    // ── 5. 오늘 집중 · 순서 ──
    check('⭐ 집중', (await K('PUT', '/api/my-work/mark', { key: 'issue:tk-i1', focus: true })).s === 200);
    await K('PUT', '/api/my-work/order', { keys: ['action:tk-a1', 'issue:tk-i1', 'todo:' + tr.id] });
    items = (await K('GET', '/api/my-work')).d.data; by = {}; items.forEach(function (x) { by[x.src + ':' + x.id] = x; });
    check('목록에 집중 · 순서', by['issue:tk-i1'].focus === kst(0) && by['action:tk-a1'].order === 0 && by['issue:tk-i1'].order === 1 && by['todo:' + tr.id].order === 2, [by['issue:tk-i1'], by['action:tk-a1'].order]);
    check('잘못된 키 400', (await K('PUT', '/api/my-work/mark', { key: 'nope' })).s === 400 && (await K('PUT', '/api/my-work/order', { keys: [] })).s === 400);
    await K('PUT', '/api/my-work/done', { src: 'issue', id: 'tk-i1', done: true });
    items = (await K('GET', '/api/my-work')).d.data;
    check('끝낸 일은 집중 표시 안 함', !items.filter(function (x) { return x.id === 'tk-i1'; })[0].focus);
    await K('PUT', '/api/my-work/done', { src: 'issue', id: 'tk-i1', done: false });

    // ── 6. 사람 목록 · 휴가 · 장소 ──
    var dir = (await K('GET', '/api/my-work/directory')).d.data;
    check('사람 목록 — 같은 회사 활성 (팀원도)', dir.some(function (u) { return u.name === '이팀원'; }) && dir.some(function (u) { return u.name === '관리자'; }) && dir.every(function (u) { return u.email === undefined; }), dir);
    var mon = mondayOf(kst(0));
    await K('POST', '/api/events', { title: '업무 연차', type: 'dayoff', startDate: mon, endDate: mon, projectIds: [] });
    await A('POST', '/api/events', { title: '업무 반차', type: 'pmoff', startDate: mon, endDate: mon, startTime: '14:00', endTime: '18:00', projectIds: ['tk-p1'], assignees: ['이팀원'] });
    var ld = (await A('GET', '/api/my-work/load?weeks=4')).d.data.leaves;
    check('업무 부하 — 휴가 (만든 사람 · 담당 이름)', ld[kim] && ld[kim][0].date === mon && ld[kim][0].type === 'dayoff' && ld[lee] && ld[lee][0].type === 'pmoff', ld);
    var ev = (await K('POST', '/api/events', { title: '업무 외근', type: 'fieldService', startDate: kst(1), endDate: kst(1), startTime: '10:00', location: '  A사 2공장  ', projectIds: [] })).d.data;
    check('일정 장소 저장', ev.location === 'A사 2공장', ev);
    var mt = (await A('POST', '/api/meetings', { title: '업무 장소회의', projectId: 'tk-p1', meetDate: kst(2), form: { timeStart: '10:00', place: '3층 회의실' } })).d.data;
    check('회의 장소 → 일정 장소', (await c.query('SELECT location FROM events WHERE id = $1', [mt.event_id])).rows[0].location === '3층 회의실');
    var ics = require(path.join(__dirname, '../../server/lib/ics'));
    check('.ics LOCATION', /LOCATION:A사 2공장/.test(ics.build('t', [], [Object.assign({}, ev, { project_ids: [], assignees: [] })], 'h')));

    // ── 7. 텔레그램 /todo /todos /event ──
    var sent = [];
    var cmds = require(path.join(__dirname, '../../server/telegram/commands/mywork')).create(async function (chat, msg) { sent.push(msg); return { ok: true }; });
    var tgUser = { user_id: kim, tenant_id: tid, name: '김팀원' };
    await cmds.cmdTodo(1, tgUser, '내일 15:00 !긴급 업무 텔레그램 할 일');
    var tg = (await c.query("SELECT * FROM my_todos WHERE title = '업무 텔레그램 할 일'")).rows[0];
    check('/todo — 날짜 · 시각 · 중요도 읽어 저장', tg && tg.due_date === kst(1) && tg.due_time === '15:00' && tg.priority === 1 && /할 일 추가/.test(sent[0]), [tg, sent[0]]);
    await cmds.cmdTodos(1, tgUser);
    check('/todos — 중요도 순 (긴급 먼저)', /1\. 🔴 업무 상세|1\. 🔴 업무 텔레그램/.test(sent[1]), sent[1]);
    var list = (await c.query("SELECT id, title FROM my_todos WHERE user_id = $1 AND done_at IS NULL ORDER BY priority, COALESCE(NULLIF(due_date, ''), '9999'), due_time NULLS LAST, created_at", [kim])).rows;
    var pos = list.map(function (x) { return x.title; }).indexOf('업무 주간보고') + 1;
    await cmds.cmdTodo(1, tgUser, 'done ' + pos);
    check('/todo done N — 완료 + 반복 다음 회차', /완료 — 업무 주간보고/.test(sent[2]) && /다음 회차/.test(sent[2]), sent[2]);
    await cmds.cmdEvent(1, tgUser, '모레 #오후반차');
    var hv = (await c.query("SELECT * FROM events WHERE created_by = $1 AND type = 'pmoff' AND start_date = $2", [kim, kst(2)])).rows[0];
    check('/event #오후반차 — 14:00~18:00 자동', hv && hv.start_time === '14:00' && hv.end_time === '18:00', hv);
    await c.query('DELETE FROM events WHERE id = $1', [hv.id]);
    await cmds.cmdEvent(1, tgUser, '내일 오후 3시~4시 #회의 업무 텔레그램 회의');
    var tm = (await c.query("SELECT * FROM events WHERE title = '업무 텔레그램 회의'")).rows[0];
    check('/event #회의 — 시각 · 종류', tm && tm.type === 'meeting' && tm.start_time === '15:00' && tm.end_time === '16:00' && tm.start_date === kst(1), tm);

    // ── 8. 브리핑 · 마감 시각 알림 ──
    await K('PUT', '/api/my-work/mark', { key: 'todo:' + tr.id, focus: true });
    var jobs = require(path.join(__dirname, '../../server/services/notification/jobs'));
    var blk = await jobs._myWorkBlock({ user_id: kim, name: '김팀원', tenant_id: tid }, kst(0));
    check('브리핑 — ⭐ 집중 먼저 · 긴급 표시', /⭐ 업무 상세 🔴\n  ⭐ 업무 이슈 🟠/.test(blk) && /집중 2/.test(blk) && blk.indexOf('⭐') < blk.indexOf('⚠️'), blk);
    var tgs = require(path.join(__dirname, '../../server/services/telegram.service'));
    var orig = tgs.sendMessage, got = [];
    tgs.sendMessage = async function (chat, msg) { got.push({ chat: String(chat), msg: msg }); return { ok: true }; };
    try {
      var nowK = new Date(Date.now() + 9 * 3600 * 1000), soon = new Date(nowK.getTime() + 10 * 60000);
      if (soon.toISOString().slice(0, 10) === kst(0)) {
        await c.query('INSERT INTO telegram_links (user_id, chat_id, is_active) VALUES ($1, 990011, TRUE) ON CONFLICT (user_id) DO UPDATE SET chat_id = 990011, is_active = TRUE', [kim]);
        var st = (await K('POST', '/api/my-work/todos', { title: '업무 곧 마감', dueDate: kst(0), dueTime: soon.toISOString().slice(11, 16), priority: 2 })).d.data;
        await jobs.sendEventSoonReminders();
        await jobs.sendEventSoonReminders();
        var mine = got.filter(function (x) { return /업무 곧 마감/.test(x.msg); });
        check('마감 시각 30분 전 알림 — 한 번만', mine.length === 1 && /🟠 높음/.test(mine[0].msg), got);
        await c.query('DELETE FROM event_reminder_sent WHERE event_id = $1', ['todo:' + st.id]);
        await c.query('DELETE FROM telegram_links WHERE chat_id = 990011');
      } else console.log('· 자정 가까워 마감 알림 시험 건너뜀');
    } finally { tgs.sendMessage = orig; }
  } finally {
    await clean();
  }
  await c.end();
  console.log('\nALL PASS ' + n);
  process.exit(0);
})().catch(function (e) { console.log('ERR', e.message, e.stack); process.exit(1); });
