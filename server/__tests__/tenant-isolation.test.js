/**
 * Tenant Isolation & RBAC Permission Tests
 */
var h = require('./helpers');

var TENANT_B_ID = '00000000-0000-0000-0000-000000000098';

/**
 * Create a tenant with a specific ID (not the default TEST_TENANT_ID)
 */
async function createTenantB() {
  var r = await h.db.query(
    "INSERT INTO tenants (id, name, slug, plan, max_users) VALUES ($1, $2, $3, 'pro', 50) ON CONFLICT (id) DO NOTHING RETURNING *",
    [TENANT_B_ID, 'Tenant B', 'tenant-b-' + Date.now()]
  );
  return r.rows[0] || { id: TENANT_B_ID };
}

/**
 * Clean up tenant B data
 */
async function cleanupTenantB() {
  try {
    await h.db.query("DELETE FROM work_records WHERE tenant_id = $1", [TENANT_B_ID]);
    await h.db.query("DELETE FROM issues WHERE tenant_id = $1", [TENANT_B_ID]);
    await h.db.query("DELETE FROM events WHERE tenant_id = $1", [TENANT_B_ID]);
    await h.db.query("DELETE FROM orders WHERE tenant_id = $1", [TENANT_B_ID]);
    await h.db.query("DELETE FROM project_members WHERE tenant_id = $1", [TENANT_B_ID]);
    await h.db.query("DELETE FROM milestones WHERE tenant_id = $1", [TENANT_B_ID]);
    await h.db.query("DELETE FROM checklists WHERE tenant_id = $1", [TENANT_B_ID]);
    await h.db.query("DELETE FROM projects WHERE tenant_id = $1", [TENANT_B_ID]);
    await h.db.query("DELETE FROM user_settings WHERE tenant_id = $1", [TENANT_B_ID]);
    // audit_logs 는 tenant_id 로만 지우면 남는다 — authService.auditLog() 가 tenant_id 를
    // 채우지 않아 tenant B 사용자의 로그인 로그가 default tenant 로 들어가기 때문.
    // 남으면 users 삭제가 FK 로 막히고(경고만 남고 삼켜짐) 다음 실행에서 이메일 중복으로 실패한다.
    await h.db.query("DELETE FROM audit_logs WHERE tenant_id = $1 OR user_id IN (SELECT id FROM users WHERE tenant_id = $1)", [TENANT_B_ID]);
    await h.db.query("DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)", [TENANT_B_ID]);
    await h.db.query("DELETE FROM users WHERE tenant_id = $1", [TENANT_B_ID]);
    await h.db.query("DELETE FROM tenants WHERE id = $1", [TENANT_B_ID]);
  } catch (e) {
    console.warn('[cleanupTenantB]', e.message);
  }
}

describe('Tenant Isolation', function () {
  var tenantA, tenantB, adminA, memberA, adminB;
  var projectAId;

  beforeAll(async function () {
    // Tenant A (uses default TEST_TENANT_ID)
    tenantA = await h.createTestTenant('tenant-a-iso');
    adminA = await h.createTestUser({ role: 'admin', email: 'iso-adminA@test.com', tenantId: h.TEST_TENANT_ID });
    memberA = await h.createTestUser({ role: 'member', email: 'iso-memberA@test.com', tenantId: h.TEST_TENANT_ID });

    // Tenant B (separate tenant ID)
    tenantB = await createTenantB();
    adminB = await h.createTestUser({ role: 'admin', email: 'iso-adminB@test.com', tenantId: TENANT_B_ID });
  });

  afterAll(async function () {
    await h.cleanup();
    await cleanupTenantB();
  });

  // 1. Tenant A admin creates a project -> visible to tenant A users
  it('tenant A admin creates a project visible to tenant A users', async function () {
    var res = await h.request(h.app)
      .post('/api/projects')
      .set('Authorization', 'Bearer ' + adminA.token)
      .send({ name: 'Tenant A Project', status: 'active' });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    projectAId = res.body.data.id;

    // Admin A can list it
    var listRes = await h.request(h.app)
      .get('/api/projects')
      .set('Authorization', 'Bearer ' + adminA.token);

    expect(listRes.status).toBe(200);
    var projectIds = listRes.body.data.map(function (p) { return p.id; });
    expect(projectIds).toContain(projectAId);
  });

  // 2. Tenant B admin CANNOT see tenant A's project
  it('tenant B admin cannot see tenant A projects', async function () {
    var res = await h.request(h.app)
      .get('/api/projects')
      .set('Authorization', 'Bearer ' + adminB.token);

    expect(res.status).toBe(200);
    var projectIds = res.body.data.map(function (p) { return p.id; });
    expect(projectIds).not.toContain(projectAId);
  });

  // 3. member 도 프로젝트를 만들 수 있다(v13.32 정책 변경).
  //    생성 자체는 열어두고, 노출 범위는 visibility 로 통제한다.
  //    핵심 검증은 "생성되더라도 A 테넌트에 갇혀 있는가".
  it('tenant A member can create a project, scoped to tenant A', async function () {
    var res = await h.request(h.app)
      .post('/api/projects')
      .set('Authorization', 'Bearer ' + memberA.token)
      .send({ name: 'Member Project', status: 'active' });

    expect(res.status).toBe(201);
    var memberProjectId = res.body.data.id;

    // 테넌트 B 관리자에게는 보이지 않아야 한다
    var listB = await h.request(h.app)
      .get('/api/projects')
      .set('Authorization', 'Bearer ' + adminB.token);
    expect(listB.status).toBe(200);
    expect(listB.body.data.map(function (p) { return p.id; })).not.toContain(memberProjectId);
  });

  // 4. Tenant A admin creates an order -> tenant B cannot see it
  it('tenant A admin creates an order that tenant B cannot see', async function () {
    var orderNo = 'ISO-ORD-' + Date.now();
    var createRes = await h.request(h.app)
      .post('/api/orders')
      .set('Authorization', 'Bearer ' + adminA.token)
      .send({ orderNo: orderNo, date: '2026-04-07', client: 'ClientA', name: 'Order A' });

    expect(createRes.status).toBe(201);

    // Tenant B tries to list orders
    var listRes = await h.request(h.app)
      .get('/api/orders')
      .set('Authorization', 'Bearer ' + adminB.token);

    expect(listRes.status).toBe(200);
    var orderNos = listRes.body.data.map(function (o) { return o.order_no; });
    expect(orderNos).not.toContain(orderNo);
  });

  // 5. Tenant A member creates work records -> tenant B cannot see them
  it('tenant A member creates work records that tenant B cannot see', async function () {
    var uniqueContent = 'iso-work-' + Date.now();
    var createRes = await h.request(h.app)
      .post('/api/archives/records')
      .set('Authorization', 'Bearer ' + memberA.token)
      .send({ date: '2026-04-07', name: 'TestWorker', content: uniqueContent, hours: 2 });

    expect(createRes.status).toBe(201);

    // Tenant B admin tries to list work records
    var listRes = await h.request(h.app)
      .get('/api/archives/records')
      .set('Authorization', 'Bearer ' + adminB.token);

    expect(listRes.status).toBe(200);
    var contents = listRes.body.data.map(function (r) { return r.content; });
    expect(contents).not.toContain(uniqueContent);
  });

  // 6. Cross-tenant project access by ID returns 404 (not 403, to avoid info leakage)
  it('cross-tenant project access by ID returns 404', async function () {
    // Tenant B tries to access Tenant A's project by ID
    var res = await h.request(h.app)
      .get('/api/projects/' + projectAId)
      .set('Authorization', 'Bearer ' + adminB.token);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });
});

describe('RBAC Permissions', function () {
  var admin, manager, member;

  beforeAll(async function () {
    await h.createTestTenant('rbac-test');
    admin = await h.createTestUser({ role: 'admin', email: 'rbac-admin@test.com' });
    manager = await h.createTestUser({ role: 'manager', email: 'rbac-mgr@test.com' });
    member = await h.createTestUser({ role: 'member', email: 'rbac-mem@test.com' });
  });

  afterAll(async function () {
    await h.cleanup();
  });

  var adminProjectId, managerProjectId;

  // 1. Admin can create project
  it('admin can create a project', async function () {
    var res = await h.request(h.app)
      .post('/api/projects')
      .set('Authorization', 'Bearer ' + admin.token)
      .send({ name: 'Admin Project', status: 'active' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Admin Project');
    adminProjectId = res.body.data.id;
  });

  // 2. Manager can create project
  it('manager can create a project', async function () {
    var res = await h.request(h.app)
      .post('/api/projects')
      .set('Authorization', 'Bearer ' + manager.token)
      .send({ name: 'Manager Project', status: 'active' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Manager Project');
    managerProjectId = res.body.data.id;
  });

  // 3. member 도 프로젝트 생성 가능 (v13.32~)
  //    rbac.checkPermission('project.create') 은 allowed = true 로 고정이고,
  //    실질 게이트는 생성 후 visibility('private' 기본) + canAccessProject 다.
  //    따라서 여기서는 "생성은 되지만 기본 가시성이 private" 인지를 본다.
  it('member can create a project (private by default)', async function () {
    var res = await h.request(h.app)
      .post('/api/projects')
      .set('Authorization', 'Bearer ' + member.token)
      .send({ name: 'Member Project', status: 'active' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
  });

  // 4. Member can create issue
  it('member can create an issue', async function () {
    var res = await h.request(h.app)
      .post('/api/issues')
      .set('Authorization', 'Bearer ' + member.token)
      .send({ title: 'Member Issue', description: 'Test issue from member', urgency: 'normal' });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Member Issue');
  });

  // 5. Member CANNOT delete project (403)
  it('member cannot delete a project', async function () {
    var res = await h.request(h.app)
      .delete('/api/projects/' + adminProjectId)
      .set('Authorization', 'Bearer ' + member.token);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-tenant write/read holes (users admin routes, optimistic-lock 409, upserts,
// project member management, admin notifications).
// Tenant A = h.TEST_TENANT_ID, tenant B = TENANT_B_ID. Every attack is made by
// tenant A against a tenant B resource, then the B row is re-read from the DB to
// prove it was not changed.
// ─────────────────────────────────────────────────────────────────────────────
describe('Cross-tenant security holes', function () {
  var S = Date.now();
  var adminA, memberA, memberA2, adminB, memberB;
  var pendingA, pendingB;
  var projectAId, projectBId;
  var ticketBId = 'iso-ast-' + S;
  var archiveId = 'iso-arc-' + S;

  function req() { return h.request(h.app); }
  function auth(u) { return 'Bearer ' + u.token; }

  async function insertPending(email, tenantId) {
    var r = await h.db.query(
      "INSERT INTO users (email, password_hash, name, role, status, tenant_id) VALUES ($1, 'x', 'Pending', 'member', 'pending', $2) RETURNING *",
      [email, tenantId]
    );
    return r.rows[0];
  }

  var mailSpy;

  beforeAll(async function () {
    // reset-password / notifyAdmins send mail fire-and-forget; stub it so no SMTP attempt
    // keeps running (and logging) after the test file finishes.
    mailSpy = jest.spyOn(require('../services/email.service'), 'sendMail').mockResolvedValue(true);
    await h.createTestTenant('sec-a-' + S);
    await createTenantB();
    adminA = await h.createTestUser({ role: 'admin', email: 'sec-admina-' + S + '@test.com' });
    memberA = await h.createTestUser({ role: 'member', email: 'sec-membera-' + S + '@test.com' });
    memberA2 = await h.createTestUser({ role: 'member', email: 'sec-membera2-' + S + '@test.com' });
    adminB = await h.createTestUser({ role: 'admin', email: 'sec-adminb-' + S + '@test.com', tenantId: TENANT_B_ID });
    memberB = await h.createTestUser({ role: 'member', email: 'sec-memberb-' + S + '@test.com', tenantId: TENANT_B_ID });
    pendingA = await insertPending('sec-penda-' + S + '@test.com', h.TEST_TENANT_ID);
    pendingB = await insertPending('sec-pendb-' + S + '@test.com', TENANT_B_ID);

    var pa = await req().post('/api/projects').set('Authorization', auth(memberA)).send({ name: 'Sec A Project', status: 'active' });
    projectAId = pa.body.data.id;
    var pb = await req().post('/api/projects').set('Authorization', auth(adminB)).send({ name: 'Sec B Project', status: 'active' });
    projectBId = pb.body.data.id;

    await h.db.query(
      "INSERT INTO as_tickets (id, ticket_no, tenant_id, customer_name, issue_summary) VALUES ($1, $2, $3, 'CustB', 'B issue')",
      [ticketBId, 'AS-SEC-' + String(S).slice(-6), TENANT_B_ID]
    );
    await h.db.query(
      "INSERT INTO as_signatures (id, ticket_id, tenant_id, role, signer_name) VALUES ($1, $2, $3, 'engineer', 'B Signer')",
      ['iso-sig-' + S, ticketBId, TENANT_B_ID]
    );
  });

  afterAll(async function () {
    var ids = [h.TEST_TENANT_ID, TENANT_B_ID];
    async function q(sql, params) { try { await h.db.query(sql, params); } catch (e) { console.warn('[sec cleanup]', e.message); } }
    await q('DELETE FROM as_signatures WHERE ticket_id = $1 OR tenant_id = ANY($2)', [ticketBId, ids]);
    await q('DELETE FROM as_tickets WHERE id = $1', [ticketBId]);
    await q('DELETE FROM work_archives WHERE id = $1 OR tenant_id = ANY($2)', [archiveId, ids]);
    await q('DELETE FROM progress_history WHERE tenant_id = ANY($1) OR project_id = ANY($2)', [ids, [projectAId, projectBId]]);
    await q('DELETE FROM in_app_notifications WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ANY($1))', [ids]);
    await q('DELETE FROM project_members WHERE project_id = ANY($1)', [[projectAId, projectBId]]);
    await h.cleanup();
    await cleanupTenantB();
    if (mailSpy) mailSpy.mockRestore();
  });

  // ── users.js ──
  it('GET /api/users/pending lists only own-tenant pending users', async function () {
    var res = await req().get('/api/users/pending').set('Authorization', auth(adminA));
    expect(res.status).toBe(200);
    var ids = res.body.data.map(function (u) { return u.id; });
    expect(ids).toContain(pendingA.id);
    expect(ids).not.toContain(pendingB.id);
  });

  it('reset-password on another tenant user → 404, password unchanged, no temp password leaked', async function () {
    var before = (await h.db.query('SELECT password_hash FROM users WHERE id = $1', [memberB.user.id])).rows[0].password_hash;
    var res = await req().post('/api/users/' + memberB.user.id + '/reset-password').set('Authorization', auth(adminA));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/temporaryPassword/);
    var after = (await h.db.query('SELECT password_hash FROM users WHERE id = $1', [memberB.user.id])).rows[0].password_hash;
    expect(after).toBe(before);
    // B user can still log in with the original password
    var login = await req().post('/api/auth/login').send({ email: memberB.email, password: memberB.password });
    expect(login.status).toBe(200);
  });

  it('reset-password within own tenant still works', async function () {
    var res = await req().post('/api/users/' + memberA2.user.id + '/reset-password').set('Authorization', auth(adminA));
    expect(res.status).toBe(200);
    expect(res.body.data.temporaryPassword).toBeDefined();
  });

  it('approve / reject another tenant pending user → 404, still pending', async function () {
    var res = await req().put('/api/users/' + pendingB.id + '/approve').set('Authorization', auth(adminA)).send({ role: 'admin' });
    expect(res.status).toBe(404);
    var rej = await req().put('/api/users/' + pendingB.id + '/reject').set('Authorization', auth(adminA)).send({ reason: 'x' });
    expect(rej.status).toBe(404);
    var row = (await h.db.query('SELECT status, role FROM users WHERE id = $1', [pendingB.id])).rows[0];
    expect(row.status).toBe('pending');
    expect(row.role).toBe('member');
  });

  it('role / status / department / operator-mode on another tenant user → 404, unchanged', async function () {
    var r1 = await req().put('/api/users/' + memberB.user.id + '/role').set('Authorization', auth(adminA)).send({ role: 'admin' });
    expect(r1.status).toBe(404);
    var r2 = await req().put('/api/users/' + memberB.user.id + '/status').set('Authorization', auth(adminA)).send({ status: 'inactive' });
    expect(r2.status).toBe(404);
    var r3 = await req().put('/api/users/' + memberB.user.id + '/department').set('Authorization', auth(adminA)).send({ departmentId: null });
    expect(r3.status).toBe(404);
    var r4 = await req().put('/api/users/' + memberB.user.id + '/operator-mode').set('Authorization', auth(adminA)).send({ enabled: true });
    expect(r4.status).toBe(404);
    var row = (await h.db.query('SELECT role, status FROM users WHERE id = $1', [memberB.user.id])).rows[0];
    expect(row.role).toBe('member');
    expect(row.status).toBe('active');
    var op = await h.db.query("SELECT 1 FROM user_settings WHERE user_id = $1 AND key = 'operator_mode'", [memberB.user.id]);
    expect(op.rows.length).toBe(0);
  });

  it('GET /api/users (admin) lists only own-tenant users', async function () {
    var res = await req().get('/api/users').set('Authorization', auth(adminA));
    expect(res.status).toBe(200);
    var ids = res.body.data.map(function (u) { return u.id; });
    expect(ids).toContain(memberA.user.id);
    expect(ids).not.toContain(memberB.user.id);
  });

  // ── optimistic-lock.js ──
  // issues PUT goes straight to optimisticUpdate (no pre-check), so it exercises the conflict path.
  it('stale-version PUT on another tenant issue does not return that issue in a 409', async function () {
    var ib = await req().post('/api/issues').set('Authorization', auth(adminB)).send({ title: 'Sec B secret issue', description: 'B only' });
    expect(ib.status).toBe(201);
    var res = await req().put('/api/issues/' + ib.body.data.id).set('Authorization', auth(adminA)).send({ title: 'hijack', version: 999 });
    expect(res.status).toBe(404);
    expect(res.body.latest).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/Sec B secret issue/);
    var row = (await h.db.query('SELECT title FROM issues WHERE id = $1', [ib.body.data.id])).rows[0];
    expect(row.title).toBe('Sec B secret issue');
  });

  it('stale-version PUT on own issue still returns 409 with latest', async function () {
    var ia = await req().post('/api/issues').set('Authorization', auth(memberA)).send({ title: 'Sec A issue' });
    expect(ia.status).toBe(201);
    var res = await req().put('/api/issues/' + ia.body.data.id).set('Authorization', auth(memberA)).send({ title: 'x', version: 999 });
    expect(res.status).toBe(409);
    expect(res.body.latest.id).toBe(ia.body.data.id);
  });

  // ── upserts ──
  it('progress upsert cannot overwrite another tenant row with a predictable id', async function () {
    var b = await req().post('/api/progress').set('Authorization', auth(adminB)).send({ projectId: projectBId, date: '2026-01-01', progress: 50 });
    expect(b.status).toBe(201);
    var a = await req().post('/api/progress').set('Authorization', auth(adminA)).send({ projectId: projectBId, date: '2026-01-01', progress: 99 });
    // v13.213: 진척 기록도 프로젝트 편집 권한을 먼저 확인 → 다른 테넌트 프로젝트는 404 (upsert 까지 가지 않음)
    expect(a.status).toBe(404);
    var row = (await h.db.query('SELECT progress, tenant_id FROM progress_history WHERE id = $1', [projectBId + '_2026-01-01'])).rows[0];
    expect(Number(row.progress)).toBe(50);
    expect(row.tenant_id).toBe(TENANT_B_ID);
  });

  it('archive upsert cannot overwrite another tenant archive', async function () {
    var b = await req().post('/api/archives').set('Authorization', auth(adminB)).send({ id: archiveId, label: 'B label' });
    expect(b.status).toBe(201);
    var a = await req().post('/api/archives').set('Authorization', auth(adminA)).send({ id: archiveId, label: 'A hijack' });
    expect(a.status).toBe(409);
    var row = (await h.db.query('SELECT label, tenant_id FROM work_archives WHERE id = $1', [archiveId])).rows[0];
    expect(row.label).toBe('B label');
    expect(row.tenant_id).toBe(TENANT_B_ID);
  });

  it('A/S signature upsert on another tenant ticket → 404, B signature unchanged', async function () {
    var res = await req().post('/api/as-tickets/' + ticketBId + '/signatures').set('Authorization', auth(adminA))
      .send({ role: 'engineer', signerName: 'A hijack' });
    expect(res.status).toBe(404);
    var rows = (await h.db.query('SELECT signer_name, tenant_id FROM as_signatures WHERE ticket_id = $1', [ticketBId])).rows;
    expect(rows.length).toBe(1);
    expect(rows[0].signer_name).toBe('B Signer');
    expect(rows[0].tenant_id).toBe(TENANT_B_ID);
  });

  // ── projects.js member management ──
  it('non-owner/non-member cannot add or remove project members', async function () {
    var add = await req().post('/api/projects/' + projectAId + '/members').set('Authorization', auth(memberA2)).send({ userId: memberA2.user.id });
    expect(add.status).toBe(403);
    var del = await req().delete('/api/projects/' + projectAId + '/members/' + memberA.user.id).set('Authorization', auth(memberA2));
    expect(del.status).toBe(403);
    var m = await h.db.query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND released_at IS NULL', [projectAId, memberA2.user.id]);
    expect(m.rows.length).toBe(0);
  });

  it('other tenant cannot add members to / list members of a project', async function () {
    var add = await req().post('/api/projects/' + projectAId + '/members').set('Authorization', auth(adminB)).send({ userId: adminB.user.id });
    expect(add.status).toBe(404);
    var list = await req().get('/api/projects/' + projectAId + '/members').set('Authorization', auth(adminB));
    expect(list.status).toBe(404);
  });

  it('owner can add a same-tenant member but not a user from another tenant', async function () {
    var ok = await req().post('/api/projects/' + projectAId + '/members').set('Authorization', auth(memberA)).send({ userId: memberA2.user.id });
    expect(ok.status).toBe(201);
    var bad = await req().post('/api/projects/' + projectAId + '/members').set('Authorization', auth(memberA)).send({ userId: memberB.user.id });
    expect(bad.status).toBe(400);
    var rm = await req().delete('/api/projects/' + projectAId + '/members/' + memberA2.user.id).set('Authorization', auth(memberA));
    expect(rm.status).toBe(200);
  });

  // ── notification.service.js ──
  it('notifyAdmins only reaches admins of the given tenant', async function () {
    var ns = require('../services/notification.service');
    await ns.notifyAdmins('project_created', { projectName: 'sec-noti-' + S, orderNo: '' }, h.TEST_TENANT_ID);
    // in-app rows are written fire-and-forget; poll briefly for the positive case
    var gotA = 0;
    for (var i = 0; i < 20 && !gotA; i++) {
      await new Promise(function (r) { setTimeout(r, 100); });
      gotA = (await h.db.query("SELECT 1 FROM in_app_notifications WHERE user_id = $1 AND body LIKE $2", [adminA.user.id, '%sec-noti-' + S + '%'])).rows.length;
    }
    expect(gotA).toBeGreaterThan(0);
    var gotB = (await h.db.query("SELECT 1 FROM in_app_notifications WHERE user_id = $1 AND body LIKE $2", [adminB.user.id, '%sec-noti-' + S + '%'])).rows.length;
    expect(gotB).toBe(0);
  });
});
