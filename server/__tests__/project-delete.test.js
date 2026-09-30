/**
 * DELETE /api/projects/:id — 딸린 데이터 정리를 권한 확인 뒤 한 트랜잭션으로 (v13.205)
 *  - 권한 없는 사용자(403)는 아무것도 지우지 못한다 (예전엔 화면이 자식부터 지워 403 이어도 이미 삭제됨)
 *  - 성공 시: 마일스톤(CASCADE)·이슈·대응 이력 삭제, 일정 project_ids·다른 프로젝트 dependencies 에서 참조 제거
 * + PUT /api/milestones/:id 의 날짜 '' = 비우기 (예전엔 `||` 로 옛 날짜가 남았다)
 */
var h = require('./helpers');
var db = h.db;
var T = h.TEST_TENANT_ID;

var admin, outsider;
var P1 = 'pdel-p1-' + Date.now(), P2 = 'pdel-p2-' + Date.now();

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('pdel-' + Date.now());
  admin = await h.createTestUser({ email: 'pdel-admin-' + Date.now() + '@test.com', role: 'admin' });
  outsider = await h.createTestUser({ email: 'pdel-out-' + Date.now() + '@test.com', role: 'member' });

  await db.query("INSERT INTO projects (id, tenant_id, name, owner_id, visibility, dependencies) VALUES ($1,$2,'삭제 대상',$3,'tenant','[]')", [P1, T, admin.user.id]);
  await db.query("INSERT INTO projects (id, tenant_id, name, owner_id, visibility, dependencies) VALUES ($1,$2,'남는 프로젝트',$3,'tenant',$4)", [P2, T, admin.user.id, JSON.stringify([P1])]);
  await db.query("INSERT INTO milestones (id, tenant_id, project_id, name) VALUES ($1,$2,$3,'설계')", ['pdel-ms-' + Date.now(), T, P1]);
  await db.query("INSERT INTO issues (id, tenant_id, project_id, title) VALUES ('pdel-iss',$1,$2,'이슈')", [T, P1]);
  await db.query("INSERT INTO issue_logs (id, tenant_id, issue_id, content) VALUES ('pdel-log',$1,'pdel-iss','대응')", [T]);
  await db.query("INSERT INTO events (id, tenant_id, title, project_ids) VALUES ('pdel-evt',$1,'회의',$2)", [T, JSON.stringify([P1, P2])]);
});

afterAll(async function () {
  await db.query("DELETE FROM events WHERE id = 'pdel-evt'").catch(function () {});
  await h.cleanup();
});

function count(sql, params) { return db.query(sql, params).then(function (r) { return Number(r.rows[0].n); }); }

test('권한 없는 사용자 → 403, 딸린 데이터 그대로', async function () {
  var r = await h.request(h.app).delete('/api/projects/' + P1).set('Authorization', 'Bearer ' + outsider.token);
  expect(r.status).toBe(403);
  expect(await count('SELECT count(*) n FROM milestones WHERE project_id = $1', [P1])).toBe(1);
  expect(await count("SELECT count(*) n FROM issues WHERE project_id = $1", [P1])).toBe(1);
  var ev = await db.query("SELECT project_ids FROM events WHERE id = 'pdel-evt'");
  expect(ev.rows[0].project_ids).toEqual([P1, P2]);
});

test('삭제 → 마일스톤·이슈·대응 이력 삭제, 일정·의존관계 참조 제거', async function () {
  var r = await h.request(h.app).delete('/api/projects/' + P1).set('Authorization', 'Bearer ' + admin.token);
  expect(r.status).toBe(200);
  expect(await count('SELECT count(*) n FROM projects WHERE id = $1', [P1])).toBe(0);
  expect(await count('SELECT count(*) n FROM milestones WHERE project_id = $1', [P1])).toBe(0);
  expect(await count("SELECT count(*) n FROM issues WHERE project_id = $1", [P1])).toBe(0);
  expect(await count("SELECT count(*) n FROM issue_logs WHERE id = 'pdel-log'")).toBe(0);
  var ev = await db.query("SELECT project_ids FROM events WHERE id = 'pdel-evt'");
  expect(ev.rows[0].project_ids).toEqual([P2]);
  var p2 = await db.query('SELECT dependencies FROM projects WHERE id = $1', [P2]);
  expect(p2.rows[0].dependencies).toEqual([]);
});

test("마일스톤 PUT: startDate '' 는 비우기, 안 보낸 칸은 그대로", async function () {
  var mid = 'pdel-ms2-' + Date.now();
  await db.query("INSERT INTO milestones (id, tenant_id, project_id, name, start_date, end_date) VALUES ($1,$2,$3,'제작','2026-10-01','2026-10-10')", [mid, T, P2]);
  var r = await h.request(h.app).put('/api/milestones/' + mid).set('Authorization', 'Bearer ' + admin.token).send({ startDate: '' });
  expect(r.status).toBe(200);
  expect(r.body.data.start_date || '').toBe('');
  expect(r.body.data.end_date).toBe('2026-10-10');
});
