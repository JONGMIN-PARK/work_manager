/**
 * 프로젝트 생애 정리 (v13.283)
 *  - lib/project-defaults 순수 함수 (상태 계산 · 정리 · 기본 단계/체크리스트)
 *  - 만들기 한 경로(insertProject): POST / · copy · 사전검토 전환 — 기본 체크리스트 · 담당 멤버 · 상태 정리
 *  - 상태 정리: PUT 프로젝트 waiting/delayed → active, 마일스톤 delayed → active · hold → waiting
 *  - GET /:id/delete-preview · DELETE 시 남는 연결 정리
 */
var pd = require('../lib/project-defaults');

describe('project-defaults (순수)', function () {
  test('computeStatus — 완료·보류 그대로, 종료일 지남 지연, 시작 전 대기', function () {
    var t = '2026-10-30';
    expect(pd.computeStatus({ status: 'done', end_date: '2026-01-01' }, t)).toBe('done');
    expect(pd.computeStatus({ status: 'hold', end_date: '2026-01-01' }, t)).toBe('hold');
    expect(pd.computeStatus({ status: 'active', end_date: '2026-10-29' }, t)).toBe('delayed');
    expect(pd.computeStatus({ status: 'active', end_date: '2026-10-30' }, t)).toBe('active');
    expect(pd.computeStatus({ status: 'active', startDate: '2026-11-01', endDate: '2026-12-01' }, t)).toBe('waiting');
    expect(pd.computeStatus({ status: 'waiting', start_date: '20261001', end_date: '20261029' }, t)).toBe('delayed');   // 옛 형식
    expect(pd.computeStatus({ status: 'delayed' }, t)).toBe('active');
  });
  test('normalizeStatus · normalizeMsStatus', function () {
    expect(['waiting', 'delayed', 'x', undefined, 'active'].map(pd.normalizeStatus)).toEqual(['active', 'active', 'active', 'active', 'active']);
    expect(pd.normalizeStatus('hold')).toBe('hold');
    expect(pd.normalizeStatus('done')).toBe('done');
    expect(['delayed', 'hold', 'x', undefined, 'waiting', 'active', 'done'].map(pd.normalizeMsStatus))
      .toEqual(['active', 'waiting', 'waiting', 'waiting', 'waiting', 'active', 'done']);
  });
  test('defaultPhases · defaultChecklists · PHASE_LABEL', function () {
    var ph = pd.defaultPhases('2026-10-01');
    expect(Object.keys(ph)).toEqual(['order', 'design', 'manufacture', 'inspect', 'deliver', 'done']);
    expect(ph.order).toEqual({ status: 'active', startDate: '2026-10-01', endDate: '' });
    expect(ph.design.status).toBe('waiting');
    expect(pd.defaultPhases('').order.status).toBe('waiting');
    var cl = pd.defaultChecklists();
    expect(cl.map(function (c) { return c.phase; })).toEqual(pd.PHASE_SEQ);
    expect(cl[0].items[0]).toMatchObject({ text: '견적서 발행', done: false, order: 0 });
    expect(pd.PHASE_LABEL.as).toBe('완료');
    expect(pd.PHASE_LABEL.manufacture).toBe('제작');
  });
});

describe('프로젝트 만들기 · 복사 · 전환 · 삭제 (DB)', function () {
  var h = require('./helpers');
  var db = h.db;
  var T = h.TEST_TENANT_ID;
  var owner, mate, outsider;
  var stamp = Date.now();

  beforeAll(async function () {
    await h.cleanup();
    await h.createTestTenant('plc-' + stamp);
    owner = await h.createTestUser({ email: 'plc-owner-' + stamp + '@test.com', role: 'member', name: '소유자' + stamp });
    mate = await h.createTestUser({ email: 'plc-mate-' + stamp + '@test.com', role: 'member', name: '동료' + stamp });
    outsider = await h.createTestUser({ email: 'plc-out-' + stamp + '@test.com', role: 'member', name: '외부' + stamp });
  });
  afterAll(async function () {
    await db.query('DELETE FROM mindmaps WHERE tenant_id = $1', [T]).catch(function () {});
    await db.query('DELETE FROM as_tickets WHERE tenant_id = $1', [T]).catch(function () {});
    await db.query('DELETE FROM my_work_marks WHERE tenant_id = $1', [T]).catch(function () {});
    await h.cleanup();
  });

  function auth(u) { return { Authorization: 'Bearer ' + u.token }; }

  var P;
  test('POST — 상태 정리 · 기본 단계 · 기본 체크리스트 6단계 · 담당자 이름 → 멤버', async function () {
    var r = await h.request(h.app).post('/api/projects').set(auth(owner))
      .send({ name: '새 프로젝트', status: 'waiting', startDate: '2026-10-01', endDate: '2026-12-31', assignees: [mate.user.name, '없는 사람'] });
    expect(r.status).toBe(201);
    P = r.body.data;
    expect(P.status).toBe('active');
    expect(P.current_phase).toBe('order');
    expect(P.phases.order.startDate).toBe('2026-10-01');
    var cl = await db.query('SELECT phase, items FROM checklists WHERE project_id = $1 ORDER BY phase', [P.id]);
    expect(cl.rows.length).toBe(6);
    var mem = await db.query('SELECT user_id, role, tenant_id FROM project_members WHERE project_id = $1', [P.id]);
    expect(mem.rows).toEqual([{ user_id: mate.user.id, role: 'assignee', tenant_id: T }]);
  });

  test('PUT — waiting/delayed 는 active 로 저장, 완료 연동 유지', async function () {
    var r = await h.request(h.app).put('/api/projects/' + P.id).set(auth(owner)).send({ status: 'delayed' });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('active');
    r = await h.request(h.app).put('/api/projects/' + P.id).set(auth(owner)).send({ status: 'done' });
    expect(r.body.data.status).toBe('done');
    expect(r.body.data.current_phase).toBe('done');
    await h.request(h.app).put('/api/projects/' + P.id).set(auth(owner)).send({ status: 'active' });
  });

  test('마일스톤 상태 정리 — delayed → active, hold → waiting', async function () {
    var r = await h.request(h.app).post('/api/milestones').set(auth(owner)).send({ projectId: P.id, name: '설계', status: 'delayed', startDate: '2026-10-01', endDate: '2026-10-20' });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('active');
    var r2 = await h.request(h.app).put('/api/milestones/' + r.body.data.id).set(auth(owner)).send({ status: 'hold' });
    expect(r2.body.data.status).toBe('waiting');
  });

  test('copy — 진행중 · 수주 단계 · 단계 날짜 없음 · 마일스톤 대기 · 체크 풀림 · 사양서 · 멤버', async function () {
    var c = await db.query("SELECT id, items FROM checklists WHERE project_id = $1 AND phase = 'order'", [P.id]);
    var items = c.rows[0].items; items[0].done = true; items[0].doneBy = 'x';
    await db.query('UPDATE checklists SET items = $1 WHERE id = $2', [JSON.stringify(items), c.rows[0].id]);
    await db.query("UPDATE projects SET specs = '{\"a\":1}', status = 'done', current_phase = 'done' WHERE id = $1", [P.id]);
    await db.query("UPDATE milestones SET status = 'done' WHERE project_id = $1", [P.id]);
    var r = await h.request(h.app).post('/api/projects/' + P.id + '/copy').set(auth(owner)).send({ name: '사본' });
    expect(r.status).toBe(201);
    var cp = r.body.data;
    expect(cp.name).toBe('사본');
    expect(cp.status).toBe('active');
    expect(cp.current_phase).toBe('order');
    expect(cp.progress).toBe(0);
    expect(cp.phases.order.startDate).toBe('');
    expect(cp.specs).toEqual({ a: 1 });
    var ms = await db.query('SELECT status, end_date FROM milestones WHERE project_id = $1', [cp.id]);
    expect(ms.rows).toEqual([{ status: 'waiting', end_date: '2026-10-20' }]);
    var cl = await db.query("SELECT items FROM checklists WHERE project_id = $1 AND phase = 'order'", [cp.id]);
    expect(cl.rows.length).toBe(1);
    expect(cl.rows[0].items[0]).toMatchObject({ text: '견적서 발행', done: false, doneBy: null });
    var mem = await db.query('SELECT user_id FROM project_members WHERE project_id = $1', [cp.id]);
    expect(mem.rows.map(function (x) { return x.user_id; })).toEqual([mate.user.id]);
  });

  test('사전검토 전환 — insertProject 경로 (진행중 · 종료일 +90일 · 기본 체크리스트 · 담당 PL · tenant_id)', async function () {
    var psId = 'plc-ps-' + stamp;
    await db.query("INSERT INTO prestudies (id, tenant_id, title, owner_id, created_by) VALUES ($1,$2,'검토 건',$3,$3)", [psId, T, mate.user.id]);
    var r = await h.request(h.app).post('/api/prestudies/' + psId + '/convert').set(auth(owner)).send({ target: 'project' });
    expect(r.status).toBe(201);
    var pj = r.body.data.created;
    expect(pj.status).toBe('active');
    expect(pj.current_phase).toBe('order');
    expect(Date.parse(pj.end_date) - Date.parse(pj.start_date)).toBe(90 * 86400000);
    expect((await db.query('SELECT count(*)::int n FROM checklists WHERE project_id = $1', [pj.id])).rows[0].n).toBe(6);
    var mem = await db.query('SELECT user_id, role, tenant_id FROM project_members WHERE project_id = $1', [pj.id]);
    expect(mem.rows).toEqual([{ user_id: mate.user.id, role: 'pl', tenant_id: T }]);
    var again = await h.request(h.app).post('/api/prestudies/' + psId + '/convert').set(auth(owner)).send({ target: 'project' });
    expect(again.status).toBe(409);
    // 삭제하면 사전검토 연결이 풀린다 (다시 전환 가능)
    var d = await h.request(h.app).delete('/api/projects/' + pj.id).set(auth(owner));
    expect(d.status).toBe(200);
    var ps = await db.query('SELECT linked_project_id, status FROM prestudies WHERE id = $1', [psId]);
    expect(ps.rows[0]).toEqual({ linked_project_id: null, status: 'won' });
  });

  test('delete-preview 개수 · 권한, DELETE 가 남는 연결 정리', async function () {
    var msR = await db.query('SELECT id FROM milestones WHERE project_id = $1', [P.id]);
    await db.query("INSERT INTO issues (id, tenant_id, project_id, title) VALUES ($1,$2,$3,'이슈')", ['plc-iss-' + stamp, T, P.id]);
    await db.query("INSERT INTO mindmaps (id, tenant_id, title, scope, owner_id, project_id) VALUES ($1,$2,'맵','project',$3,$4)", ['plc-mm-' + stamp, T, owner.user.id, P.id]);
    await db.query("INSERT INTO as_tickets (id, tenant_id, ticket_no, customer_name, issue_summary, project_id) VALUES ($1,$2,'AS-T-1','고객','증상',$3)", ['plc-as-' + stamp, T, P.id]);
    await db.query("INSERT INTO comments (id, tenant_id, target_type, target_id, project_id, body) VALUES ($1,$2,'project',$3,$3,'코멘트')", ['plc-cm-' + stamp, T, P.id]);
    await db.query('INSERT INTO my_work_marks (user_id, item_key, tenant_id) VALUES ($1,$2,$3)', [owner.user.id, 'milestone:' + msR.rows[0].id, T]);

    var no = await h.request(h.app).get('/api/projects/' + P.id + '/delete-preview').set(auth(outsider));
    expect(no.status).toBe(403);
    var r = await h.request(h.app).get('/api/projects/' + P.id + '/delete-preview').set(auth(owner));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ milestones: 1, issues: 1, docFiles: 0, docFolders: 0, meetings: 0, mindmaps: 1, asTickets: 1 });

    var d = await h.request(h.app).delete('/api/projects/' + P.id).set(auth(owner));
    expect(d.status).toBe(200);
    var mm = await db.query('SELECT project_id, scope FROM mindmaps WHERE id = $1', ['plc-mm-' + stamp]);
    expect(mm.rows[0]).toEqual({ project_id: null, scope: 'personal' });
    expect((await db.query('SELECT project_id FROM as_tickets WHERE id = $1', ['plc-as-' + stamp])).rows[0].project_id).toBeNull();
    expect((await db.query('SELECT count(*)::int n FROM comments WHERE project_id = $1', [P.id])).rows[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int n FROM my_work_marks WHERE user_id = $1', [owner.user.id])).rows[0].n).toBe(0);
  });
});
