// Phase 2 API — 참조 해석 · 검색 · 자동 생성 · 역참조 · 팀 맵 · AI 미설정
var B = 'http://localhost:3000';
var pg = require(require('path').join(__dirname, '../../server/node_modules/pg'));
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
function check(name, c, x) { if (!c) { console.log('FAIL', name, JSON.stringify(x, null, 1).slice(0, 1500)); process.exit(1); } n++; console.log('✔', name); }

(async function () {
  var c = new pg.Client('postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var T = '00000000-0000-0000-0000-000000000001';
  // 부서: 김·이 = 설계팀, 관리자 = 없음
  var d = await c.query("INSERT INTO departments (name, tenant_id) VALUES ('설계팀', $1) RETURNING id", [T]).catch(async function () { return c.query("SELECT id FROM departments WHERE name='설계팀'"); });
  var deptId = d.rows[0].id;
  await c.query("UPDATE users SET department_id = $1 WHERE email IN ('kim@t.com','lee@t.com')", [deptId]);
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com')), L = api(await login('lee@t.com'));
  var ids = {};
  for (var e of ['kim', 'lee']) ids[e] = (await (e === 'kim' ? K : L)('GET', '/api/auth/me')).d.data.id;
  await A('PUT', '/api/mindmaps/access/users/' + ids.kim, { enabled: true });
  await A('PUT', '/api/mindmaps/access/users/' + ids.lee, { enabled: true });

  // 프로젝트 2개: P1(공개 tenant), P2(비공개, 김 미참여)
  var p1 = (await A('POST', '/api/projects', { name: '검사기 1호기', visibility: 'tenant', orderNo: 'A-100' })).d.data;
  var p2 = (await A('POST', '/api/projects', { name: '비밀 프로젝트', visibility: 'private' })).d.data;
  var m1 = (await A('POST', '/api/milestones', { projectId: p1.id, name: '설계 완료', startDate: '2026-10-01', endDate: '2026-10-20', status: 'active' })).d.data;
  var m2 = (await A('POST', '/api/milestones', { projectId: p2.id, name: '비밀 마일스톤' })).d.data;
  var i1 = (await A('POST', '/api/issues', { projectId: p1.id, title: '카메라 보정 오류', assignees: ['김팀원'] })).d.data;
  await A('POST', '/api/checklists', { projectId: p1.id, phase: 'design', items: [{ text: '도면 검토', done: true }, { text: '부품표', done: false }] });
  await c.query("INSERT INTO milestone_assignments (id, tenant_id, milestone_id, project_id, user_id, role) VALUES ('ma-' || md5(random()::text),$1,$2,$3,$4,'assignee')", [T, m1.id, p1.id, ids.kim]).catch(function (e) { console.log('  ms assign', e.message); });
  await c.query("INSERT INTO issue_assignees (issue_id, assignee_name, user_id, tenant_id) VALUES ($1,'김팀원',$2,$3)", [i1.id, ids.kim, T]).catch(function (e) { console.log('  issue assign', e.message); });
  check('시드 생성', p1 && p2 && m1 && m2 && i1, { p1: p1, m1: m1, i1: i1 });

  // resolve — 김: P1 계열은 보이고 P2 계열은 잠김, 없는 건 missing
  var rs = await K('POST', '/api/mindmaps/resolve', { refs: [
    { type: 'project', id: p1.id }, { type: 'milestone', id: m1.id }, { type: 'issue', id: i1.id },
    { type: 'project', id: p2.id }, { type: 'milestone', id: m2.id }, { type: 'issue', id: 'nope' }, { type: 'user', id: ids.kim }
  ] });
  var R = rs.d.data;
  check('resolve 프로젝트 요약', R['project:' + p1.id].title === '검사기 1호기' && R['project:' + p1.id].orderNo === 'A-100', R);
  check('resolve 마일스톤 담당·진행', R['milestone:' + m1.id].status === 'active' && R['milestone:' + m1.id].people.indexOf('김팀원') >= 0 && R['milestone:' + m1.id].projectName === '검사기 1호기', R['milestone:' + m1.id]);
  check('resolve 이슈', R['issue:' + i1.id].title === '카메라 보정 오류' && R['issue:' + i1.id].done === false);
  check('resolve 권한 밖 → locked (제목 노출 없음)', R['project:' + p2.id].locked === true && !R['project:' + p2.id].title && R['milestone:' + m2.id].locked === true, R);
  check('resolve 없는 항목 → missing', R['issue:nope'].missing === true);
  check('resolve 사용자 담당 건수', R['user:' + ids.kim].msCount >= 1 && R['user:' + ids.kim].issueCount >= 1 && R['user:' + ids.kim].dept === '설계팀', R['user:' + ids.kim]);

  // search — 권한 밖 제외
  var sp = (await K('GET', '/api/mindmaps/search-refs?type=project&q=')).d.data;
  check('검색: 공개 프로젝트만', sp.some(function (x) { return x.id === p1.id; }) && !sp.some(function (x) { return x.id === p2.id; }), sp);
  var sm = (await K('GET', '/api/mindmaps/search-refs?type=milestone&q=' + encodeURIComponent('마일'))).d.data;
  check('검색: 비공개 마일스톤 제외', !sm.some(function (x) { return x.id === m2.id; }));
  check('검색: 잘못된 종류 400', (await K('GET', '/api/mindmaps/search-refs?type=xx&q=a')).s === 400);

  // generate
  var gp = await K('POST', '/api/mindmaps/generate', { kind: 'project', projectId: p1.id });
  var root = gp.d.data.root;
  var flat = []; (function w(x) { flat.push(x); (x.children || []).forEach(w); })(root);
  check('구조도: 루트=프로젝트 참조', root.ref.type === 'project' && root.ref.id === p1.id);
  check('구조도: 마일스톤·이슈 참조 + 체크리스트 완료 표시', flat.some(function (x) { return x.ref && x.ref.id === m1.id; }) && flat.some(function (x) { return x.ref && x.ref.id === i1.id; }) && flat.some(function (x) { return x.text === '도면 검토' && x.done === true; }), flat.map(function (x) { return x.text; }));
  check('구조도: 권한 밖 프로젝트 404', (await K('POST', '/api/mindmaps/generate', { kind: 'project', projectId: p2.id })).s === 404);
  var gt = (await K('POST', '/api/mindmaps/generate', { kind: 'team' })).d.data;
  check('팀원 업무 지도: 설계팀 · 김의 마일스톤/이슈', gt.root.text === '설계팀 업무 지도' && JSON.stringify(gt.root).indexOf(m1.id) >= 0 && JSON.stringify(gt.root).indexOf(i1.id) >= 0 && gt.root.children.length === 2, gt.root);
  check('팀원 업무 지도: 다른 부서는 관리자만', (await K('POST', '/api/mindmaps/generate', { kind: 'team', departmentId: '00000000-0000-0000-0000-000000000000' })).s === 404);
  var gm = (await K('POST', '/api/mindmaps/generate', { kind: 'mine' })).d.data;
  check('내 업무: 할 일·아이디어 가지 포함', /할 일/.test(JSON.stringify(gm.root)) && JSON.stringify(gm.root).indexOf(m1.id) >= 0);

  // 팀(부서) 맵 — 같은 부서 읽기, 편집은 소유자
  var tm = await K('POST', '/api/mindmaps', { title: '설계팀 맵', scope: 'dept', doc: { sheets: [{ id: 'sh-1', title: '시트 1', structure: gt.structure, root: gt.root }] } });
  check('팀 맵 생성 (부서 자동)', tm.s === 201 && tm.d.data.department_id === deptId, tm.d);
  var lr = await L('GET', '/api/mindmaps/' + tm.d.data.id);
  check('같은 부서 이팀원 읽기 · 편집 불가', lr.s === 200 && lr.d.data.can_edit === false);
  check('같은 부서 목록에 표시 + 부서명', (await L('GET', '/api/mindmaps')).d.data.some(function (m) { return m.id === tm.d.data.id && m.department_name === '설계팀'; }));
  check('관리자(부서 없음) 팀 맵 생성 → 부서 지정 필요', (await A('POST', '/api/mindmaps', { title: 'x', scope: 'dept' })).s === 400);
  check('관리자는 부서 지정해 생성', (await A('POST', '/api/mindmaps', { title: 'x', scope: 'dept', departmentId: deptId })).s === 201);

  // 역참조
  var bl = (await K('GET', '/api/mindmaps/by-link?type=milestone&id=' + m1.id)).d.data;
  check('역참조: 마일스톤이 들어간 맵', bl.some(function (m) { return m.id === tm.d.data.id; }), bl);
  var pmap = (await A('POST', '/api/mindmaps', { title: '프로젝트 소속 맵', scope: 'project', projectId: p1.id })).d.data;
  var bp = (await K('GET', '/api/mindmaps/by-link?type=project&id=' + p1.id)).d.data;
  check('역참조: 프로젝트 소속 맵도 포함', bp.some(function (m) { return m.id === pmap.id; }) && bp.some(function (m) { return m.id === tm.d.data.id; }), bp);
  // 참조 제거 후 저장 → 역참조에서 빠짐
  var cur = (await K('GET', '/api/mindmaps/' + tm.d.data.id)).d.data;
  cur.doc.sheets[0].root.children = [];
  await K('PUT', '/api/mindmaps/' + tm.d.data.id, { version: cur.version, doc: cur.doc });
  var bl2 = (await K('GET', '/api/mindmaps/by-link?type=milestone&id=' + m1.id)).d.data;
  check('참조 지우고 저장 → 역참조 갱신', !bl2.some(function (m) { return m.id === tm.d.data.id; }));
  // 개인 맵의 역참조는 남에게 안 보임
  await K('POST', '/api/mindmaps', { title: '내 비밀', scope: 'personal', doc: { sheets: [{ id: 's', title: 's', structure: 'balanced', root: { id: 'r', text: 'r', children: [{ id: 'a', text: 'a', ref: { type: 'project', id: p1.id }, children: [] }] } }] } });
  var bp2 = (await L('GET', '/api/mindmaps/by-link?type=project&id=' + p1.id)).d.data;
  check('역참조: 남의 개인 맵은 안 보임', !bp2.some(function (m) { return m.title === '내 비밀'; }));
  // 시트 개수 제한
  var many = { sheets: [] }; for (var i = 0; i < 21; i++) many.sheets.push({ id: 's' + i, title: 's', root: { id: 'r' + i, text: 'r', children: [] } });
  check('시트 21개 → 400', (await K('POST', '/api/mindmaps', { title: 'm', doc: many })).s === 400);
  // AI — 키 없음
  check('AI 상태 ready=false', (await K('GET', '/api/mindmaps/ai/status')).d.data.ready === false);
  check('AI 미설정 503', (await K('POST', '/api/mindmaps/ai', { action: 'expand', path: ['a'] })).s === 503);
  await c.end();
  console.log('\nALL PASS', n);
})().catch(function (e) { console.error(e); process.exit(1); });
