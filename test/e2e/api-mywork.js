// 내 업무 · 업무 부하 API — 여섯 곳에서 모으기 · 원래 자리에 완료 반영 · 개인 할 일 · 권한 · 담당 바꾸기 · 편집 잠금 · 아침 브리핑 (v13.248)
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
function check(name, c, x) { if (!c) { console.log('FAIL', name, JSON.stringify(x, null, 1).slice(0, 1500)); throw new Error('FAIL ' + name); } n++; console.log('✔', name); }   // throw — finally 에서 사람 설정을 되돌리도록
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }

(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var U = {};
  (await c.query("SELECT id, email, tenant_id FROM users WHERE email IN ('admin@t.com','kim@t.com','lee@t.com')")).rows.forEach(function (r) { U[r.email.split('@')[0]] = r; });
  var tid = U.kim.tenant_id, kim = U.kim.id, lee = U.lee.id;
  // 지난 실행 정리
  await c.query("DELETE FROM my_todos WHERE title LIKE '내업무%'");
  await c.query("DELETE FROM mindmaps WHERE title LIKE '내업무%' OR title LIKE '알림 시험%'");   // 알림 시험(api-notify)도 김 담당 주제가 있음
  await c.query("DELETE FROM issues WHERE id LIKE 'mw-%'");
  await c.query("DELETE FROM meetings WHERE id LIKE 'mw-%'");
  await c.query("DELETE FROM prestudies WHERE id LIKE 'mw-%'");
  await c.query("DELETE FROM project_dev_items WHERE id LIKE 'mw-%'");
  await c.query("DELETE FROM milestones WHERE id LIKE 'mw-%'");
  await c.query("DELETE FROM projects WHERE id LIKE 'mw-%'");
  await c.query("DELETE FROM edit_locks WHERE resource_type = 'mindmap'");
  // 이팀원 = 팀장, 김 · 이 같은 부서
  var orig = (await c.query('SELECT id, role, department_id FROM users WHERE id = ANY($1)', [[kim, lee]])).rows;   // 다른 테스트(e2e2 설계팀)가 쓰는 값 — 끝나면 되돌림
  await c.query("DELETE FROM departments WHERE name = '내업무부서' AND NOT EXISTS (SELECT 1 FROM users WHERE department_id = departments.id)");
  var dep = (await c.query("INSERT INTO departments (name) VALUES ('내업무부서') RETURNING id")).rows[0].id;
  await c.query("UPDATE users SET role = 'manager', department_id = $1 WHERE id = $2", [dep, lee]);
  await c.query('UPDATE users SET department_id = $1 WHERE id = $2', [dep, kim]);
  try {
    // 여섯 곳에 김 담당 일 심기
    await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('mw-p1', '내업무 프로젝트', 'active', 'tenant', $1, $2)", [U.admin.id, tid]);
    await c.query("INSERT INTO issues (id, project_id, title, status, urgency, due_date, assignees, tenant_id) VALUES ('mw-i1', 'mw-p1', '모터 소음 재현', 'open', 'urgent', $1, '[\"김팀원\"]', $2)", [kst(-2), tid]);
    await c.query("INSERT INTO meetings (id, project_id, title, meet_date, tenant_id) VALUES ('mw-m1', 'mw-p1', '주간회의', $1, $2)", [kst(-1), tid]);
    await c.query("INSERT INTO meeting_action_items (id, meeting_id, title, assignee_id, assignee_name, due_date, status, tenant_id) VALUES ('mw-a1', 'mw-m1', '견적서 회신', $1, '김팀원', $2, 'open', $3)", [kim, kst(0), tid]);
    await c.query("INSERT INTO prestudies (id, title, client, owner_id, due_date, status, tenant_id) VALUES ('mw-s1', '신규 설비 문의', 'A사', $1, $2, 'reviewing', $3)", [kim, kst(3), tid]);
    await c.query("INSERT INTO milestones (id, project_id, name, end_date, status, tenant_id) VALUES ('mw-ms1', 'mw-p1', '설계 검토', $1, 'progress', $2)", [kst(10), tid]);
    await c.query("INSERT INTO milestone_assignments (id, tenant_id, milestone_id, project_id, user_id) VALUES ('mw-ma1', $1, 'mw-ms1', 'mw-p1', $2)", [tid, kim]);
    await c.query("INSERT INTO project_dev_items (id, tenant_id, project_id, milestone_id, title, status, assignee_id) VALUES ('mw-d1', $1, 'mw-p1', 'mw-ms1', 'PLC 로직', 'todo', $2)", [tid, kim]);
    var A = api(await login('admin@t.com'));
    var m = (await A('POST', '/api/mindmaps', { title: '내업무 맵', editors: [kim, lee] })).d.data;   // 김 · 이에게 보낸 맵
    var doc = { sheets: [{ id: 's1', title: '시트', structure: 'balanced', root: { id: 'r', text: '루트', children: [
      { id: 'g', text: '설계', children: [{ id: 'n1', text: '배선도 검토', assigneeId: kim, dueDate: kst(1), progress: 50, children: [] }] },
      { id: 'n2', text: '끝난 일', assigneeId: kim, dueDate: kst(-1), done: true, children: [] },
      { id: 'n3', text: '이 사람 일', assigneeId: lee, children: [] }
    ] } }] };
    var sv = await A('PUT', '/api/mindmaps/' + m.id, { version: m.version, doc: doc });
    check('맵 저장', sv.s === 200, sv);

    var K = api(await login('kim@t.com')), L = api(await login('lee@t.com'));
    var r = await K('GET', '/api/my-work');
    check('내 업무 읽기', r.s === 200 && r.d.self === true, r);
    var by = {};
    r.d.data.forEach(function (it) { if (/^mw-/.test(it.id) || it.mapId === m.id) by[it.src] = it; });   // 다른 테스트가 남긴 일은 빼고
    check('여섯 곳에서 모음 (맵 · 이슈 · 회의 · 사전검토 · 일정 · 개발)', ['mindmap', 'issue', 'action', 'prestudy', 'milestone', 'dev'].every(function (s) { return by[s]; }), Object.keys(by));
    check('맵 주제 — 위 단계 · 진행률 · 남은 양', by.mindmap.ctx === '내업무 맵 › 설계' && by.mindmap.progress === 50 && by.mindmap.weight === 0.5 && by.mindmap.mapOpen && by.mindmap.due === kst(1), by.mindmap);
    check('완료 시각 없는 끝난 주제 · 남의 주제는 빠짐', !r.d.data.some(function (it) { return /끝난 일|이 사람 일/.test(it.title); }));
    check('이슈 긴급 · 지연 마감', by.issue.urgent && by.issue.due === kst(-2) && by.issue.ctx === '내업무 프로젝트', by.issue);
    check('개발 작업 마감 = 마일스톤 종료일', by.dev.due === kst(10), by.dev);
    check('완료 체크 가능 — 맵 · 이슈 · 회의 · 개발 (사전검토 · 일정은 아님)', by.mindmap.canDone && by.issue.canDone && by.action.canDone && by.dev.canDone && !by.prestudy.canDone && !by.milestone.canDone);

    // 개인 할 일
    var t = await K('POST', '/api/my-work/todos', { title: '내업무 메모', dueDate: kst(2) });
    check('개인 할 일 추가', t.s === 201 && t.d.data.title === '내업무 메모', t);
    check('빈 할 일 거절', (await K('POST', '/api/my-work/todos', { title: '  ' })).s === 400);
    var tu = await K('PUT', '/api/my-work/done', { src: 'todo', id: t.d.data.id, done: true });
    check('할 일 완료', tu.s === 200, tu);
    r = await K('GET', '/api/my-work');
    var td = r.d.data.filter(function (x) { return x.src === 'todo'; })[0];
    check('끝낸 할 일은 다 한 것 으로', td && td.done && td.doneAt, td);

    // 완료 — 원래 자리에 반영
    await K('PUT', '/api/my-work/done', { src: 'action', id: 'mw-a1', done: true });
    var act = (await c.query("SELECT status, done_at FROM meeting_action_items WHERE id = 'mw-a1'")).rows[0];
    check('회의 액션 완료 → 상태 done · 완료 시각', act.status === 'done' && act.done_at, act);
    var md = await K('PUT', '/api/my-work/done', { src: 'mindmap', id: by.mindmap.id, done: true });
    check('맵 주제 완료', md.s === 200, md);
    var row = (await c.query('SELECT doc, version FROM mindmaps WHERE id = $1', [m.id])).rows[0];
    var n1 = row.doc.sheets[0].root.children[0].children[0];
    check('맵 문서에 done · doneAt · 버전 올림', n1.done === true && !!n1.doneAt && row.version === sv.d.data.version + 1, { n1: n1, v: row.version });
    r = await K('GET', '/api/my-work');
    check('끝낸 주제 · 액션은 다 한 것 으로', r.d.data.some(function (x) { return x.src === 'mindmap' && x.done; }) && r.d.data.some(function (x) { return x.src === 'action' && x.done; }));
    await K('PUT', '/api/my-work/done', { src: 'mindmap', id: by.mindmap.id, done: false });
    n1 = (await c.query('SELECT doc FROM mindmaps WHERE id = $1', [m.id])).rows[0].doc.sheets[0].root.children[0].children[0];
    check('되돌리기 — done · doneAt 지움', !n1.done && !n1.doneAt && n1.progress === 50, n1);
    await K('PUT', '/api/my-work/done', { src: 'issue', id: 'mw-i1', done: true });
    var iss = (await c.query("SELECT status, resolved_date FROM issues WHERE id = 'mw-i1'")).rows[0];
    check('이슈 완료 → 해결 · 해결일', iss.status === 'resolved' && iss.resolved_date === kst(0), iss);
    await K('PUT', '/api/my-work/done', { src: 'issue', id: 'mw-i1', done: false });
    check('이슈 되돌리기 → 대응중', (await c.query("SELECT status FROM issues WHERE id = 'mw-i1'")).rows[0].status === 'inProgress');
    check('남의 일은 완료 못 함', (await K('PUT', '/api/my-work/done', { src: 'mindmap', id: m.id + ':n3', userId: lee, done: true })).s === 403);
    check('사전검토는 완료 체크 안 됨', (await K('PUT', '/api/my-work/done', { src: 'prestudy', id: 'mw-s1', done: true })).s === 400);

    // 편집 잠금 — 누가 맵을 편집 중이면 바꾸지 않음
    await A('PATCH', '/api/locks', { resourceType: 'mindmap', resourceId: m.id });
    var lk = await K('PUT', '/api/my-work/done', { src: 'mindmap', id: by.mindmap.id, done: true });
    check('편집 중인 맵은 409 LOCKED', lk.s === 409 && lk.d.error === 'LOCKED' && /편집 중/.test(lk.d.message), lk);
    await A('DELETE', '/api/locks?resourceType=mindmap&resourceId=' + m.id);
    await c.query("DELETE FROM edit_locks WHERE resource_type = 'mindmap'");

    // 권한
    check('팀원은 남의 업무 못 봄', (await K('GET', '/api/my-work?userId=' + lee)).s === 403);
    check('팀원은 업무 부하 못 봄', (await K('GET', '/api/my-work/load')).s === 403);
    var pk = await K('GET', '/api/my-work/people');
    check('팀원이 볼 수 있는 사람 = 나', pk.d.data.length === 1 && pk.d.data[0].id === kim && pk.d.canLoad === false, pk.d);
    var lk2 = await L('GET', '/api/my-work?userId=' + kim);
    check('팀장은 같은 부서 업무 봄 — 개인 할 일 빼고, 완료 체크 못 함', lk2.s === 200 && !lk2.d.self && !lk2.d.data.some(function (x) { return x.src === 'todo'; }) && lk2.d.data.every(function (x) { return !x.canDone; }), lk2.d);
    var ad = await A('GET', '/api/my-work?userId=' + kim);
    check('관리자는 볼 수 있고 완료 체크 가능', ad.s === 200 && ad.d.data.some(function (x) { return x.canDone; }), ad.d);

    // 업무 부하
    var ld = await L('GET', '/api/my-work/load?weeks=4');
    check('업무 부하 읽기 (팀장)', ld.s === 200 && ld.d.data.weeks.length === 4, ld);
    var D = ld.d.data;
    check('같은 부서만 (김 · 이)', D.users.length === 2 && D.users.some(function (u) { return u.id === kim; }) && D.users.some(function (u) { return u.id === lee; }), D.users);
    var kr = D.rows[kim];
    check('김 — 지연 1(이슈) · 합계 5 (끝낸 액션 · 할 일 빼고)', kr && kr.late.n === 1 && kr.total.n === 5 && kr.nodue.n === 0, kr);
    check('맵 주제는 남은 양 0.5 로 셈', D.items.some(function (x) { return x.src === 'mindmap' && x.userId === kim && x.weight === 0.5; }));
    check('이 — 마감 없는 맵 주제 1', D.rows[lee] && D.rows[lee].nodue.n === 1, D.rows[lee]);
    check('개인 할 일은 제목 없이', !D.items.some(function (x) { return x.src === 'todo' && x.title !== '개인 할 일'; }));

    // 담당 바꾸기
    var mv = await L('PUT', '/api/my-work/reassign', { src: 'mindmap', id: by.mindmap.id, fromUserId: kim, toUserId: lee });
    check('맵 주제 담당 바꾸기', mv.s === 200, mv);
    n1 = (await c.query('SELECT doc FROM mindmaps WHERE id = $1', [m.id])).rows[0].doc.sheets[0].root.children[0].children[0];
    check('문서의 assigneeId 바뀜', n1.assigneeId === lee, n1);
    await L('PUT', '/api/my-work/reassign', { src: 'issue', id: 'mw-i1', fromUserId: kim, toUserId: lee });
    var ia = (await c.query("SELECT assignees FROM issues WHERE id = 'mw-i1'")).rows[0].assignees;
    check('이슈 담당 이름 바꿈', JSON.stringify(ia) === '["이팀원"]', ia);
    check('끝낸 일은 담당 못 바꿈', (await L('PUT', '/api/my-work/reassign', { src: 'action', id: 'mw-a1', fromUserId: kim, toUserId: lee })).s === 404);
    await K('PUT', '/api/my-work/done', { src: 'action', id: 'mw-a1', done: false });
    await L('PUT', '/api/my-work/reassign', { src: 'action', id: 'mw-a1', fromUserId: kim, toUserId: lee });
    check('회의 액션 담당 바꿈', (await c.query("SELECT assignee_id FROM meeting_action_items WHERE id = 'mw-a1'")).rows[0].assignee_id === lee);
    check('팀원은 담당 못 바꿈', (await K('PUT', '/api/my-work/reassign', { src: 'dev', id: 'mw-d1', fromUserId: kim, toUserId: lee })).s === 403);
    check('다른 사람 일이 아니면 404', (await L('PUT', '/api/my-work/reassign', { src: 'dev', id: 'mw-d1', fromUserId: lee, toUserId: kim })).s === 404);
    var lr = (await L('GET', '/api/my-work?userId=' + lee)).d.data;
    check('바꾼 일이 이팀원 목록에', lr.some(function (x) { return x.src === 'mindmap' && x.title === '배선도 검토'; }) && lr.some(function (x) { return x.src === 'issue'; }));

    // 아침 브리핑 조각
    var jobs = require(path.join(__dirname, '../../server/services/notification/jobs'));
    var blk = await jobs._myWorkBlock({ user_id: lee, name: '이팀원', tenant_id: tid }, kst(0));
    check('브리핑 — 내 할 일 · 지연 · 제목', /내 할 일/.test(blk) && /지연 2일 — 모터 소음 재현/.test(blk) && /오늘 — 견적서 회신/.test(blk), blk);
    var none = await jobs._myWorkBlock({ user_id: '00000000-0000-0000-0000-0000000000ff', name: '없는사람', tenant_id: tid }, kst(0));
    check('할 일 없으면 조각 없음', none === '', none);
  } finally {
    await c.query("DELETE FROM mindmaps WHERE title LIKE '내업무%'");   // 마감 알림 시험(api-notify)에 섞이지 않게
    for (var oi = 0; oi < orig.length; oi++) await c.query('UPDATE users SET role = $1, department_id = $2 WHERE id = $3', [orig[oi].role, orig[oi].department_id, orig[oi].id]);
    await c.query('DELETE FROM departments WHERE id = $1', [dep]);
  }
  await c.end();
  console.log('\nALL PASS ' + n);
  process.exit(0);
})().catch(function (e) { console.log('ERR', e.message, e.stack); process.exit(1); });
