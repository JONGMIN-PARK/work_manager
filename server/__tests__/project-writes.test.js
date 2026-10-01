/**
 * 프로젝트 하위 데이터 쓰기 권한·정합성 (v13.213)
 *  - 마일스톤·체크리스트·진척·일정 쓰기는 프로젝트 편집 규칙(관리자·임원·생성자·참여자)을 따른다
 *  - 체크리스트 PUT version 충돌 → 409
 *  - 마일스톤 이관 시 담당 배정·작업노트도 함께 이동
 *  - /full 이 부서·사양을 저장, 빈 PUT 은 500 이 아니라 현재 행
 *  - 목록 can_edit, 프로젝트 삭제 시 문서 파일 메타데이터도 삭제
 */
var h = require('./helpers');
var db = h.db;
var T = h.TEST_TENANT_ID;
var S = Date.now();

var admin, owner, viewer;
var PV = 'pw-vis-' + S;     // owner 소유, 전체 공개 (viewer 는 보기만)
var PO = 'pw-own-' + S;     // owner 소유, 이관 대상
var MS = 'pw-ms-' + S;
var CHK = 'pw-chk-' + S;

function api(method, url, who) {
  return h.request(h.app)[method](url).set('Authorization', 'Bearer ' + who.token);
}

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('pw-' + S);
  admin = await h.createTestUser({ email: 'pw-admin-' + S + '@test.com', role: 'admin' });
  owner = await h.createTestUser({ email: 'pw-owner-' + S + '@test.com', role: 'member' });
  viewer = await h.createTestUser({ email: 'pw-viewer-' + S + '@test.com', role: 'member' });
  await db.query("INSERT INTO projects (id, tenant_id, name, owner_id, visibility) VALUES ($1,$2,'공개',$3,'tenant')", [PV, T, owner.user.id]);
  await db.query("INSERT INTO projects (id, tenant_id, name, owner_id, visibility) VALUES ($1,$2,'이관 대상',$3,'private')", [PO, T, owner.user.id]);
  await db.query("INSERT INTO milestones (id, tenant_id, project_id, name) VALUES ($1,$2,$3,'설계')", [MS, T, PV]);
  await db.query("INSERT INTO checklists (id, tenant_id, project_id, phase, items) VALUES ($1,$2,$3,'order',$4)", [CHK, T, PV, JSON.stringify([{ text: 'a' }])]);
});

afterAll(async function () {
  for (var t of ['milestone_progress_logs', 'milestone_assignments', 'progress_history', 'project_files', 'project_folders']) {
    await db.query('DELETE FROM ' + t + ' WHERE tenant_id = $1', [T]).catch(function () {});
  }
  await h.cleanup();
});

describe('마일스톤', function () {
  test('보기만 가능한 사용자: 추가·수정·삭제 403, 데이터 그대로', async function () {
    expect((await api('post', '/api/milestones', viewer).send({ projectId: PV, name: 'x' })).status).toBe(403);
    expect((await api('put', '/api/milestones/' + MS, viewer).send({ name: '바꿈' })).status).toBe(403);
    expect((await api('delete', '/api/milestones/' + MS, viewer)).status).toBe(403);
    var r = await db.query('SELECT name FROM milestones WHERE id = $1', [MS]);
    expect(r.rows[0].name).toBe('설계');
  });

  test('없는(다른 테넌트) 프로젝트로 추가 → 404 (예전엔 FK 만 통과하면 들어갔다)', async function () {
    expect((await api('post', '/api/milestones', admin).send({ projectId: 'nope-' + S, name: 'x' })).status).toBe(404);
  });

  test('생성자는 추가 가능, order 0 보존', async function () {
    var r = await api('post', '/api/milestones', owner).send({ projectId: PV, name: '제작', order: 0, sort_order: 5 });
    expect(r.status).toBe(201);
    expect(r.body.data.sort_order).toBe(0);
  });

  test('비공개 프로젝트 작업노트는 보기 권한 없으면 404', async function () {
    var mid = 'pw-ms-priv-' + S;
    await db.query("INSERT INTO milestones (id, tenant_id, project_id, name) VALUES ($1,$2,$3,'비공개')", [mid, T, PO]);
    expect((await api('get', '/api/milestones/' + mid + '/logs', viewer)).status).toBe(404);
    expect((await api('get', '/api/milestones/' + mid + '/logs', owner)).status).toBe(200);
  });

  test('작업노트 추가 → 마일스톤·프로젝트 진척 동기화(트랜잭션)', async function () {
    var r = await api('post', '/api/milestones/' + MS + '/logs', owner).send({ progress: 40, hours: 2, note: 'n' });
    expect(r.status).toBe(201);
    var m = await db.query('SELECT progress, reported_hours FROM milestones WHERE id = $1', [MS]);
    expect(m.rows[0].progress).toBe(40);
    expect(Number(m.rows[0].reported_hours)).toBe(2);
  });

  test('이관: 작업노트·담당 배정의 project_id 도 함께 이동', async function () {
    await db.query("INSERT INTO milestone_assignments (id, tenant_id, milestone_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5,'primary')",
      ['pw-asg-' + S, T, MS, PV, owner.user.id]);
    var r = await api('post', '/api/milestones/' + MS + '/transfer', owner).send({ targetProjectId: PO });
    expect(r.status).toBe(200);
    var lg = await db.query('SELECT DISTINCT project_id FROM milestone_progress_logs WHERE milestone_id = $1', [MS]);
    expect(lg.rows.map(function (x) { return x.project_id; })).toEqual([PO]);
    var as = await db.query('SELECT project_id FROM milestone_assignments WHERE milestone_id = $1', [MS]);
    expect(as.rows[0].project_id).toBe(PO);
  });

  test('담당 배정: 다른 테넌트/없는 사용자 → 400', async function () {
    var r = await api('post', '/api/milestones/' + MS + '/assignments', owner).send({ userId: '00000000-0000-0000-0000-00000000dead' });
    expect(r.status).toBe(400);
  });
});

describe('체크리스트', function () {
  test('보기만 가능한 사용자: 수정·삭제·추가 403', async function () {
    expect((await api('put', '/api/checklists/' + CHK, viewer).send({ items: [] })).status).toBe(403);
    expect((await api('delete', '/api/checklists/' + CHK, viewer)).status).toBe(403);
    expect((await api('post', '/api/checklists', viewer).send({ projectId: PV, phase: 'x', items: [] })).status).toBe(403);
  });

  test('version 이 다르면 409 + 최신본, 맞으면 저장', async function () {
    var cur = (await db.query('SELECT version FROM checklists WHERE id = $1', [CHK])).rows[0].version;
    var bad = await api('put', '/api/checklists/' + CHK, owner).send({ items: [{ text: 'b' }], version: cur + 7 });
    expect(bad.status).toBe(409);
    expect(bad.body.latest.items).toEqual([{ text: 'a' }]);
    var ok = await api('put', '/api/checklists/' + CHK, owner).send({ items: [{ text: 'b' }], version: cur });
    expect(ok.status).toBe(200);
    expect(ok.body.data.version).toBe(cur + 1);
  });
});

describe('진척 이력', function () {
  test('기록은 편집 권한 필요, 목록은 볼 수 있는 프로젝트만', async function () {
    expect((await api('post', '/api/progress', viewer).send({ projectId: PV, date: '2026-01-01', progress: 10 })).status).toBe(403);
    expect((await api('post', '/api/progress', owner).send({ projectId: PO, date: '2026-01-01', progress: 10 })).status).toBe(201);
    var r = await api('get', '/api/progress?projectId=' + PO, viewer);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(0);   // 비공개 프로젝트 이력은 안 보인다
  });
});

describe('일정', function () {
  var EP = 'pw-evt-personal-' + S;
  test('개인 일정은 작성자만 수정·삭제, 다른 사람은 GET 도 404', async function () {
    var c = await api('post', '/api/events', owner).send({ id: EP, title: '개인', startDate: '2026-02-01', projectIds: [] });
    expect(c.status).toBe(201);
    expect((await api('get', '/api/events/' + EP, viewer)).status).toBe(404);
    expect((await api('put', '/api/events/' + EP, viewer).send({ title: 'x' })).status).toBe(403);
    expect((await api('delete', '/api/events/' + EP, viewer)).status).toBe(403);
    expect((await api('put', '/api/events/' + EP, owner).send({ title: '개인2' })).status).toBe(200);
  });

  test('편집 권한 없는 프로젝트에 연결 → 403, 없는 프로젝트 → 400', async function () {
    expect((await api('post', '/api/events', viewer).send({ title: 'x', startDate: '2026-02-01', projectIds: [PV] })).status).toBe(403);
    expect((await api('post', '/api/events', owner).send({ title: 'x', startDate: '2026-02-01', projectIds: ['nope-' + S] })).status).toBe(400);
  });

  test('프로젝트 일정: 연결 프로젝트 편집자는 남이 만든 일정도 수정 가능', async function () {
    var c = await api('post', '/api/events', admin).send({ title: '회의', startDate: '2026-02-02', projectIds: [PV] });
    expect(c.status).toBe(201);
    expect((await api('put', '/api/events/' + c.body.data.id, owner).send({ memo: 'm' })).status).toBe(200);
    expect((await api('put', '/api/events/' + c.body.data.id, viewer).send({ memo: 'v' })).status).toBe(403);
  });

  test('바꿀 필드 없이 version 만 보내면 500 이 아니라 현재 행', async function () {
    var row = (await db.query('SELECT version FROM events WHERE id = $1', [EP])).rows[0];
    var r = await api('put', '/api/events/' + EP, owner).send({ version: row.version });
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBe(EP);
  });
});

describe('프로젝트', function () {
  test('목록 can_edit: 생성자 true, 보기만 false', async function () {
    var o = await api('get', '/api/projects', owner);
    var v = await api('get', '/api/projects', viewer);
    expect(o.body.data.find(function (p) { return p.id === PV; }).can_edit).toBe(true);
    expect(v.body.data.find(function (p) { return p.id === PV; }).can_edit).toBe(false);
  });

  test('/full: 부서·사양 저장 (POST / 와 같은 INSERT)', async function () {
    var dept = (await db.query("INSERT INTO departments (name, tenant_id) VALUES ('설계팀',$1) RETURNING id", [T]).catch(function () { return { rows: [] }; })).rows[0];
    var body = { name: 'full', visibility: 'dept', specs: { design: [{ k: 'v' }] }, milestones: [{ name: 'm', order: 0 }], checklists: [] };
    if (dept) body.departmentId = dept.id;
    var r = await api('post', '/api/projects/full', admin).send(body);
    expect(r.status).toBe(201);
    expect(r.body.data.specs).toEqual({ design: [{ k: 'v' }] });
    if (dept) expect(r.body.data.department_id).toBe(dept.id);
    var ms = await db.query('SELECT sort_order FROM milestones WHERE project_id = $1', [r.body.data.id]);
    expect(ms.rows[0].sort_order).toBe(0);
    await db.query('DELETE FROM projects WHERE id = $1', [r.body.data.id]);
    if (dept) await db.query('DELETE FROM departments WHERE id = $1', [dept.id]);
  });

  test('삭제 시 문서 파일·폴더 메타데이터도 서버가 지운다', async function () {
    var pid = 'pw-del-' + S;
    await db.query("INSERT INTO projects (id, tenant_id, name, owner_id, visibility) VALUES ($1,$2,'삭제',$3,'private')", [pid, T, owner.user.id]);
    await db.query("INSERT INTO project_folders (id, tenant_id, project_id, name) VALUES ($1,$2,$3,'f')", ['pw-fd-' + S, T, pid]);
    await db.query("INSERT INTO project_files (id, tenant_id, project_id, name) VALUES ($1,$2,$3,'a.pdf')", ['pw-fl-' + S, T, pid]);
    expect((await api('delete', '/api/projects/' + pid, viewer)).status).toBe(403);
    expect((await db.query('SELECT 1 FROM project_files WHERE project_id = $1', [pid])).rows.length).toBe(1);
    expect((await api('delete', '/api/projects/' + pid, owner)).status).toBe(200);
    expect((await db.query('SELECT 1 FROM project_files WHERE project_id = $1', [pid])).rows.length).toBe(0);
    expect((await db.query('SELECT 1 FROM project_folders WHERE project_id = $1', [pid])).rows.length).toBe(0);
  });
});
