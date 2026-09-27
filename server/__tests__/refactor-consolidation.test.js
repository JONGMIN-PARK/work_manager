/**
 * 통합 테스트 — 공유 헬퍼로 합친 동작(lib/record-scope, lib/project-access), N+1 일괄화,
 * 052 마이그레이션 백필을 실제 DB 로 검증한다.
 *
 * 다른 테스트 파일과 섞이지 않도록 전용 테넌트 2개(X, Y)를 쓰고, 시작·끝에 모두 정리한다.
 */
var fs = require('fs');
var path = require('path');
var jwt = require('jsonwebtoken');
var h = require('./helpers');
var config = require('../config');
var pa = require('../lib/project-access');
var dispatch = require('../services/notification/dispatch');

var TX = '00000000-0000-0000-0000-0000000000a1';
var TY = '00000000-0000-0000-0000-0000000000a2';
var DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';
var HASH = '$2a$10$abcdefghijklmnopqrstuuM0dummyhashvalueforrefactortest00';
var db = h.db;

function todayCompact() {
  var t = new Date();
  return t.getFullYear() + String(t.getMonth() + 1).padStart(2, '0') + String(t.getDate()).padStart(2, '0');
}

async function cleanupAll() {
  var tenants = [TX, TY];
  async function q(sql, params) {
    try { await db.query(sql, params); } catch (e) { if (e.code !== '42P01') console.warn('[rf-cleanup]', e.message); }
  }
  await q("DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = ANY($1))", [tenants]);
  var byTenant = ['work_records', 'project_images', 'milestone_assignments', 'milestones',
    'project_members', 'checklists', 'user_settings', 'events'];
  for (var i = 0; i < byTenant.length; i++) await q('DELETE FROM ' + byTenant[i] + ' WHERE tenant_id = ANY($1)', [tenants]);
  await q('DELETE FROM projects WHERE tenant_id = ANY($1)', [tenants]);
  var byUser = ['audit_logs', 'refresh_tokens', 'in_app_notifications', 'notification_logs', 'notification_prefs', 'project_members'];
  for (var j = 0; j < byUser.length; j++) await q('DELETE FROM ' + byUser[j] + ' WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ANY($1))', [tenants]);
  await q('DELETE FROM users WHERE tenant_id = ANY($1)', [tenants]);
  await q('DELETE FROM departments WHERE tenant_id = ANY($1)', [tenants]);
  await q('DELETE FROM tenants WHERE id = ANY($1)', [tenants]);
}

var U = {};      // name → { id, role, dept, tenant, token }
var P = {};      // name → project id
var D1, D2;

async function mkUser(key, role, tenantId, deptId) {
  var r = await db.query(
    "INSERT INTO users (email, password_hash, name, role, status, tenant_id, department_id) VALUES ($1,$2,$3,$4,'active',$5,$6) RETURNING id",
    ['rf-' + key + '-' + Date.now() + '@test.com', HASH, 'RF_' + key, role, tenantId, deptId || null]
  );
  var id = r.rows[0].id;
  var token = jwt.sign({ sub: id, email: key + '@t', name: 'RF_' + key, role: role, departmentId: deptId || null, tenantId: tenantId },
    config.jwt.secret, { expiresIn: '1h' });
  U[key] = { id: id, role: role, dept: deptId || null, tenant: tenantId, token: token };
}
function reqFor(key) {
  var u = U[key];
  return { user: { sub: u.id, role: u.role, departmentId: u.dept, tenantId: u.tenant }, tenant: { id: u.tenant } };
}
function authz(key) { return 'Bearer ' + U[key].token; }
async function mkProject(key, id, tenantId, ownerKey, visibility, deptId, orderNo) {
  await db.query(
    "INSERT INTO projects (id, name, tenant_id, owner_id, visibility, department_id, order_no, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'active')",
    [id, 'RF ' + key, tenantId, U[ownerKey].id, visibility, deptId || null, orderNo || '']
  );
  P[key] = id;
}
async function addMember(projKey, userKey, released) {
  await db.query(
    "INSERT INTO project_members (project_id, user_id, role, tenant_id, released_at) VALUES ($1,$2,'assignee',$3,$4)",
    [P[projKey], U[userKey].id, U[userKey].tenant, released ? new Date() : null]
  );
}

var mailSpy;
beforeAll(async function () {
  // 알림 발송 경로가 실제 SMTP 로 나가지 않도록 (tenant-isolation.test 와 같은 방식)
  mailSpy = jest.spyOn(require('../services/email.service'), 'sendMail').mockResolvedValue(true);
  await cleanupAll();
  await db.query("INSERT INTO tenants (id, name, slug, plan, max_users) VALUES ($1,'RF X',$2,'pro',50), ($3,'RF Y',$4,'pro',50)",
    [TX, 'rf-x-' + Date.now(), TY, 'rf-y-' + Date.now()]);
  D1 = (await db.query("INSERT INTO departments (name, tenant_id) VALUES ('RF D1', $1) RETURNING id", [TX])).rows[0].id;
  D2 = (await db.query("INSERT INTO departments (name, tenant_id) VALUES ('RF D2', $1) RETURNING id", [TX])).rows[0].id;

  await mkUser('adminX', 'admin', TX, null);
  await mkUser('mgrX', 'manager', TX, D1);
  await mkUser('execX', 'executive', TX, D1);
  await mkUser('mgrNoDept', 'manager', TX, null);
  await mkUser('memX1', 'member', TX, D1);
  await mkUser('memX2', 'member', TX, D2);
  await mkUser('memX3', 'member', TX, null);
  await mkUser('adminY', 'admin', TY, null);

  await mkProject('priv', 'rf-p-priv', TX, 'memX1', 'private');
  await mkProject('tenantVis', 'rf-p-tenant', TX, 'memX2', 'tenant');
  await mkProject('deptD1', 'rf-p-dept1', TX, 'memX2', 'dept', D1);
  await mkProject('deptD2', 'rf-p-dept2', TX, 'memX1', 'dept', D2);
  await mkProject('member', 'rf-p-member', TX, 'memX2', 'private');
  await mkProject('released', 'rf-p-released', TX, 'memX2', 'private');
  await mkProject('y', 'rf-p-y', TY, 'adminY', 'tenant');
  await addMember('member', 'memX3');
  await addMember('released', 'memX3', true);
}, 60000);

afterAll(async function () {
  // fire-and-forget 알림(인앱·메일)이 끝날 시간을 준 뒤 정리
  await new Promise(function (r) { setTimeout(r, 300); });
  await cleanupAll();
  mailSpy.mockRestore();
});

var X_PROJECTS = ['rf-p-priv', 'rf-p-tenant', 'rf-p-dept1', 'rf-p-dept2', 'rf-p-member', 'rf-p-released'];
var EXPECTED_VISIBLE = {
  adminX: X_PROJECTS,
  mgrX: ['rf-p-tenant', 'rf-p-dept1'],
  execX: ['rf-p-tenant', 'rf-p-dept1'],
  mgrNoDept: ['rf-p-tenant'],
  memX1: ['rf-p-priv', 'rf-p-tenant', 'rf-p-dept1', 'rf-p-dept2'],
  memX2: ['rf-p-tenant', 'rf-p-dept1', 'rf-p-dept2', 'rf-p-member', 'rf-p-released'],
  memX3: ['rf-p-tenant', 'rf-p-member']
};
function rf(ids) { return ids.filter(function (id) { return /^rf-p-/.test(id); }).sort(); }

describe('project visibility — 한 규칙, 모든 경로', function () {
  test.each(Object.keys(EXPECTED_VISIBLE))('%s: visibleProjectsSql = 기대 집합 = canRead', async function (key) {
    var req = reqFor(key);
    var v = pa.visibleProjectsSql(req, 'p', 2);
    var r = await db.query('SELECT p.* FROM projects p WHERE p.tenant_id = $1 AND ' + v.sql, [TX].concat(v.params));
    var sqlIds = rf(r.rows.map(function (x) { return x.id; }));
    expect(sqlIds).toEqual(EXPECTED_VISIBLE[key].slice().sort());

    var all = (await db.query('SELECT * FROM projects WHERE tenant_id = $1', [TX])).rows;
    var jsIds = [];
    for (var i = 0; i < all.length; i++) if (await pa.canRead(req, all[i])) jsIds.push(all[i].id);
    expect(rf(jsIds)).toEqual(sqlIds);
  });

  test.each(Object.keys(EXPECTED_VISIBLE))('%s: GET /api/projects 와 /api/bootstrap 의 프로젝트 집합이 같다', async function (key) {
    var list = await h.request(h.app).get('/api/projects?limit=500').set('Authorization', authz(key));
    expect(list.status).toBe(200);
    var boot = await h.request(h.app).get('/api/bootstrap').set('Authorization', authz(key));
    expect(boot.status).toBe(200);
    var a = rf(list.body.data.map(function (p) { return p.id; }));
    var b = rf(boot.body.projects.map(function (p) { return p.id; }));
    expect(a).toEqual(EXPECTED_VISIBLE[key].slice().sort());
    expect(b).toEqual(a);   // 변경점: 예전 bootstrap 은 admin 에게도 가시성 룰을 적용했다
    expect(list.body.data.some(function (p) { return p.id === 'rf-p-y'; })).toBe(false);
  });

  test('GET /api/projects total 은 가시 집합 크기', async function () {
    var list = await h.request(h.app).get('/api/projects?limit=1').set('Authorization', authz('memX3'));
    expect(list.body.data.length).toBe(1);
    expect(list.body.total).toBe(2);
  });

  test('milestones 목록은 접근 가능한 프로젝트의 것만', async function () {
    await db.query("INSERT INTO milestones (id, project_id, name, tenant_id) VALUES ('rf-ms-vis1','rf-p-priv','v1',$1), ('rf-ms-vis2','rf-p-tenant','v2',$1)", [TX]);
    var r = await h.request(h.app).get('/api/milestones?limit=500').set('Authorization', authz('memX3'));
    var ids = r.body.data.map(function (m) { return m.id; });
    expect(ids).toContain('rf-ms-vis2');
    expect(ids).not.toContain('rf-ms-vis1');
    await db.query("DELETE FROM milestones WHERE id IN ('rf-ms-vis1','rf-ms-vis2')");
  });
});

describe('project edit / comment rules', function () {
  test('canEdit: owner·활성멤버·admin·executive 만', async function () {
    var rows = {};
    (await db.query('SELECT * FROM projects WHERE tenant_id = $1', [TX])).rows.forEach(function (p) { rows[p.id] = p; });
    expect(await pa.canEdit(reqFor('memX3'), rows['rf-p-member'])).toBe(true);     // 활성 멤버
    expect(await pa.canEdit(reqFor('memX3'), rows['rf-p-released'])).toBe(false);  // 해제된 멤버
    expect(await pa.canEdit(reqFor('memX3'), rows['rf-p-tenant'])).toBe(false);    // 공개 가시성만으론 불가
    expect(await pa.canEdit(reqFor('mgrX'), rows['rf-p-dept1'])).toBe(false);      // 부서 공개 + manager 도 불가
    expect(await pa.canEdit(reqFor('execX'), rows['rf-p-priv'])).toBe(true);
    expect(await pa.canEdit(reqFor('adminX'), rows['rf-p-priv'])).toBe(true);
  });

  test('canEditById: 모든 역할에서 테넌트 내 존재를 먼저 확인 (없으면 null)', async function () {
    expect(await pa.canEditById(reqFor('adminX'), 'rf-p-y')).toBeNull();
    expect(await pa.canEditById(reqFor('execX'), 'rf-nope')).toBeNull();
    expect(await pa.canEditById(reqFor('adminX'), 'rf-p-priv')).toBe(true);
    expect(await pa.canEditById(reqFor('memX3'), 'rf-p-member')).toBe(true);
    expect(await pa.canEditById(reqFor('memX3'), 'rf-p-tenant')).toBe(false);
  });

  test('canComment: 가시성 공개·executive 만으로는 불가', async function () {
    expect(await pa.canComment(reqFor('memX1'), 'rf-p-tenant')).toBe(false);
    expect(await pa.canComment(reqFor('execX'), 'rf-p-tenant')).toBe(false);
    expect(await pa.canComment(reqFor('memX2'), 'rf-p-tenant')).toBe(true);   // owner
    expect(await pa.canComment(reqFor('memX3'), 'rf-p-member')).toBe(true);   // 멤버
    expect(await pa.canComment(reqFor('adminX'), 'rf-p-priv')).toBe(true);
  });

  test('PUT /api/projects/:id — 편집권 없는 가시 사용자는 403, 멤버는 200', async function () {
    var bad = await h.request(h.app).put('/api/projects/rf-p-tenant').set('Authorization', authz('memX3')).send({ memo: 'x' });
    expect(bad.status).toBe(403);
    expect(bad.body.error).toBe('FORBIDDEN');
    var ok = await h.request(h.app).put('/api/projects/rf-p-member').set('Authorization', authz('memX3')).send({ memo: 'edited' });
    expect(ok.status).toBe(200);
  });

  test('POST /api/milestones/:id/transfer — admin 도 다른 테넌트/없는 프로젝트로는 이관 불가 (404)', async function () {
    await db.query("INSERT INTO milestones (id, project_id, name, tenant_id) VALUES ('rf-ms-tr','rf-p-priv','tr',$1)", [TX]);
    var foreign = await h.request(h.app).post('/api/milestones/rf-ms-tr/transfer').set('Authorization', authz('adminX')).send({ targetProjectId: 'rf-p-y' });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe('NOT_FOUND');
    var none = await h.request(h.app).post('/api/milestones/rf-ms-tr/transfer').set('Authorization', authz('execX')).send({ targetProjectId: 'rf-nope' });
    expect(none.status).toBe(404);
    var still = await db.query("SELECT project_id FROM milestones WHERE id = 'rf-ms-tr'");
    expect(still.rows[0].project_id).toBe('rf-p-priv');
    var ok = await h.request(h.app).post('/api/milestones/rf-ms-tr/transfer').set('Authorization', authz('adminX')).send({ targetProjectId: 'rf-p-tenant' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.project_id).toBe('rf-p-tenant');
    await db.query("DELETE FROM milestones WHERE id = 'rf-ms-tr'");
  });
});

describe('POST /api/projects/reorder (단일 UPDATE)', function () {
  test('편집 가능한 행만, 중복 id 는 마지막 값, updated 는 예전 루프와 같은 합계', async function () {
    var r = await h.request(h.app).post('/api/projects/reorder').set('Authorization', authz('memX3')).send({
      items: [{ id: 'rf-p-member', sortOrder: 5 }, { id: 'rf-p-tenant', sortOrder: 6 }, { id: 'rf-p-member', sortOrder: 7 }, { sortOrder: 1 }]
    });
    expect(r.status).toBe(200);
    expect(r.body.updated).toBe(2);
    var rows = (await db.query("SELECT id, sort_order FROM projects WHERE id IN ('rf-p-member','rf-p-tenant')")).rows;
    var m = {}; rows.forEach(function (x) { m[x.id] = x.sort_order; });
    expect(m['rf-p-member']).toBe(7);
    expect(m['rf-p-tenant']).toBeNull();
    var bad = await h.request(h.app).post('/api/projects/reorder').set('Authorization', authz('memX3')).send({ items: [] });
    expect(bad.status).toBe(400);
  });

  test('executive 는 모든 행 갱신', async function () {
    var r = await h.request(h.app).post('/api/projects/reorder').set('Authorization', authz('execX')).send({
      items: [{ id: 'rf-p-priv', sortOrder: 1 }, { id: 'rf-p-y', sortOrder: 1 }]
    });
    expect(r.body.updated).toBe(1);   // 다른 테넌트 행은 제외
  });
});

describe('POST /api/projects/:id/copy (일괄 INSERT) · transfer', function () {
  test('멤버·마일스톤·담당배정·이미지를 복사하고 멤버 행에 tenant_id 를 기록', async function () {
    await addMember('priv', 'memX3');
    await db.query("INSERT INTO milestones (id, project_id, name, start_date, end_date, sort_order, assignee_targets, tenant_id) VALUES " +
      "('rf-ms-c1','rf-p-priv','c1','20260101','20260110',0,'{\"a\":3}',$1), ('rf-ms-c2','rf-p-priv','c2',NULL,NULL,1,'{}',$1)", [TX]);
    await db.query("INSERT INTO milestone_assignments (id, tenant_id, milestone_id, project_id, user_id, role, target_hours) VALUES " +
      "('rf-msa-1',$1,'rf-ms-c1','rf-p-priv',$2,'primary',12.5)", [TX, U.memX3.id]);
    await db.query("INSERT INTO project_images (id, tenant_id, project_id, src, caption, sort_order) VALUES ('rf-img-1',$1,'rf-p-priv','data:x','cap',3)", [TX]);

    var r = await h.request(h.app).post('/api/projects/rf-p-priv/copy').set('Authorization', authz('memX1')).send({ name: 'RF copy' });
    expect(r.status).toBe(201);
    var nid = r.body.data.id;
    expect(r.body.data.owner_id).toBe(U.memX1.id);

    var mem = (await db.query('SELECT user_id, tenant_id, role FROM project_members WHERE project_id = $1', [nid])).rows;
    expect(mem).toEqual([{ user_id: U.memX3.id, tenant_id: TX, role: 'assignee' }]);

    var ms = (await db.query('SELECT id, name, start_date, sort_order, assignee_targets, tenant_id, progress FROM milestones WHERE project_id = $1 ORDER BY sort_order', [nid])).rows;
    expect(ms.map(function (m) { return m.name; })).toEqual(['c1', 'c2']);
    expect(ms[0].start_date).toBe('20260101');
    expect(ms[0].assignee_targets).toEqual({ a: 3 });
    expect(ms[1].start_date).toBeNull();
    expect(ms.every(function (m) { return m.tenant_id === TX && m.id !== 'rf-ms-c1' && m.id !== 'rf-ms-c2'; })).toBe(true);

    var asg = (await db.query('SELECT milestone_id, user_id, role, target_hours, tenant_id FROM milestone_assignments WHERE project_id = $1', [nid])).rows;
    expect(asg.length).toBe(1);
    expect(asg[0].milestone_id).toBe(ms[0].id);
    expect(asg[0].user_id).toBe(U.memX3.id);
    expect(Number(asg[0].target_hours)).toBe(12.5);

    var img = (await db.query('SELECT src, caption, sort_order FROM project_images WHERE project_id = $1', [nid])).rows;
    expect(img).toEqual([{ src: 'data:x', caption: 'cap', sort_order: 3 }]);
  });

  test('소유권 이관 시 이전 소유자 멤버 행에 tenant_id 기록', async function () {
    await mkProject('transfer', 'rf-p-transfer', TX, 'memX2', 'private');
    var r = await h.request(h.app).post('/api/projects/rf-p-transfer/transfer').set('Authorization', authz('memX2')).send({ newOwnerId: U.memX3.id });
    expect(r.status).toBe(200);
    var pm = (await db.query('SELECT tenant_id, released_at FROM project_members WHERE project_id = $1 AND user_id = $2', ['rf-p-transfer', U.memX2.id])).rows;
    expect(pm.length).toBe(1);
    expect(pm[0].tenant_id).toBe(TX);
    expect(pm[0].released_at).toBeNull();
  });
});

describe('work records scope (lib/record-scope) — 모든 경로 동일', function () {
  var ids = {};
  beforeAll(async function () {
    var d = todayCompact();
    async function rec(key, userKey, tenant) {
      var r = await db.query(
        "INSERT INTO work_records (date, name, order_no, hours, task_type, abbr, content, user_id, tenant_id) VALUES ($1,$2,'RF-WR',1,'t','A',$3,$4,$5) RETURNING id",
        [d, 'RF ' + key, 'orig-' + key, userKey ? U[userKey].id : null, tenant]
      );
      ids[key] = r.rows[0].id;
    }
    await rec('x1a', 'memX1', TX);
    await rec('x1b', 'memX1', TX);
    await rec('x2', 'memX2', TX);
    await rec('mgr', 'mgrX', TX);
    await rec('orphan', null, TX);
    await rec('y', 'adminY', TY);
  });

  var EXPECTED_COUNT = { adminX: 5, mgrX: 3, execX: 3, mgrNoDept: 0, memX1: 2, memX2: 1, memX3: 0, adminY: 1 };

  test.each(Object.keys(EXPECTED_COUNT))('%s: /records/count = /records 행 수 = bootstrap archives', async function (key) {
    var c = await h.request(h.app).get('/api/archives/records/count').set('Authorization', authz(key));
    expect(c.status).toBe(200);
    expect(c.body.data.count).toBe(EXPECTED_COUNT[key]);
    var l = await h.request(h.app).get('/api/archives/records?all=true&limit=1000').set('Authorization', authz(key));
    expect(l.body.data.length).toBe(EXPECTED_COUNT[key]);
    var b = await h.request(h.app).get('/api/bootstrap').set('Authorization', authz(key));
    expect(b.body.archives.data.length).toBe(EXPECTED_COUNT[key]);
  });

  test('manager(부서): 부서원 레코드는 보이고 다른 부서·주인 없는 레코드는 안 보인다', async function () {
    var l = await h.request(h.app).get('/api/archives/records?all=true&limit=1000').set('Authorization', authz('mgrX'));
    var got = l.body.data.map(function (r) { return r.id; }).sort(function (a, b) { return a - b; });
    expect(got).toEqual([ids.x1a, ids.x1b, ids.mgr].sort(function (a, b) { return a - b; }));
  });

  test('PATCH /records/batch: 범위 밖 행은 무시, 중복 id 는 마지막 값, count = id 있는 항목 수', async function () {
    function upd(id, content) { return { id: id, date: todayCompact(), name: 'RF upd', orderNo: 'RF-WR', hours: 2, taskType: 't', abbr: 'A', content: content }; }
    var r = await h.request(h.app).patch('/api/archives/records/batch').set('Authorization', authz('memX1'))
      .send({ updates: [upd(ids.x1b, 'first'), upd(ids.x1b, 'last'), upd(ids.x2, 'hack'), { content: 'no id' }] });
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(3);
    var rows = {};
    (await db.query('SELECT id, content, hours FROM work_records WHERE id = ANY($1)', [[ids.x1b, ids.x2]])).rows.forEach(function (x) { rows[x.id] = x; });
    expect(rows[ids.x1b].content).toBe('last');
    expect(Number(rows[ids.x1b].hours)).toBe(2);
    expect(rows[ids.x2].content).toBe('orig-x2');

    var m = await h.request(h.app).patch('/api/archives/records/batch').set('Authorization', authz('mgrX'))
      .send({ updates: [upd(ids.x1b, 'by-mgr'), upd(ids.x2, 'by-mgr')] });
    expect(m.body.count).toBe(2);
    var after = (await db.query('SELECT id, content FROM work_records WHERE id = ANY($1) ORDER BY id', [[ids.x1b, ids.x2]])).rows;
    var byId = {}; after.forEach(function (x) { byId[x.id] = x.content; });
    expect(byId[ids.x1b]).toBe('by-mgr');   // 같은 부서
    expect(byId[ids.x2]).toBe('orig-x2');   // 다른 부서

    var empty = await h.request(h.app).patch('/api/archives/records/batch').set('Authorization', authz('memX1')).send({ updates: [] });
    expect(empty.status).toBe(200);
    expect(empty.body.count).toBe(0);
  });

  test('DELETE /records/batch: member 는 주인 없는(user_id NULL) 레코드를 지울 수 없다 (변경점)', async function () {
    var r = await h.request(h.app).delete('/api/archives/records/batch').set('Authorization', authz('memX1'))
      .send({ ids: [ids.orphan, ids.x2, ids.y, ids.x1a] });
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(1);
    var left = (await db.query('SELECT id FROM work_records WHERE id = ANY($1)', [[ids.orphan, ids.x2, ids.y, ids.x1a]])).rows.map(function (x) { return x.id; });
    expect(left.sort()).toEqual([ids.orphan, ids.x2, ids.y].sort());
    var admin = await h.request(h.app).delete('/api/archives/records/batch').set('Authorization', authz('adminX')).send({ ids: [ids.orphan, ids.y] });
    expect(admin.body.count).toBe(1);   // admin 은 테넌트 전체(주인 없는 행 포함), 다른 테넌트 행은 불가
  });

  test('DELETE /records: ?scope=self 는 manager 도 본인만, 응답 scope 라벨 유지', async function () {
    var r = await h.request(h.app).delete('/api/archives/records?scope=self').set('Authorization', authz('mgrX'));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ message: '전체 삭제 완료', deleted: 1, scope: 'self' });
    var m3 = await h.request(h.app).delete('/api/archives/records').set('Authorization', authz('memX3'));
    expect(m3.body.scope).toBe('self');
    expect(m3.body.deleted).toBe(0);
    var mgr = await h.request(h.app).delete('/api/archives/records').set('Authorization', authz('mgrX'));
    expect(mgr.body.scope).toBe('department');
    expect(mgr.body.deleted).toBe(1);   // 남은 부서원 레코드 x1b
    var y = (await db.query('SELECT 1 FROM work_records WHERE id = $1', [ids.y])).rows.length;
    expect(y).toBe(1);
  });
});

describe('POST /api/archives/records/auto-tag-milestones (단일 UPDATE)', function () {
  var recIds = {};
  beforeAll(async function () {
    await mkProject('tag', 'rf-p-tag', TX, 'memX1', 'private', null, 'RF-TAG-1');
    await db.query("INSERT INTO milestones (id, project_id, name, start_date, end_date, sort_order, tenant_id) VALUES " +
      "('rf-ms-A','rf-p-tag','A','20260101','20260103',0,$1), ('rf-ms-B','rf-p-tag','B','20260102','20260104',1,$1), ('rf-ms-C','rf-p-tag','C','20260101',NULL,2,$1)", [TX]);
    var dates = ['20260101', '20260102', '20260103', '20260104', '20260105'];
    for (var i = 0; i < dates.length; i++) {
      var r = await db.query("INSERT INTO work_records (date, name, order_no, hours, user_id, tenant_id) VALUES ($1,'RF tag','RF-TAG-1',1,$2,$3) RETURNING id", [dates[i], U.memX1.id, TX]);
      recIds[dates[i]] = r.rows[0].id;
    }
    recIds.y = (await db.query("INSERT INTO work_records (date, name, order_no, hours, user_id, tenant_id) VALUES ('20260102','RF tag','RF-TAG-1',1,$1,$2) RETURNING id", [U.adminY.id, TY])).rows[0].id;
  });
  async function tags() {
    var m = {};
    (await db.query('SELECT id, milestone_id FROM work_records WHERE id = ANY($1)', [Object.values(recIds)])).rows.forEach(function (r) { m[r.id] = r.milestone_id; });
    return {
      d1: m[recIds['20260101']], d2: m[recIds['20260102']], d3: m[recIds['20260103']], d4: m[recIds['20260104']], d5: m[recIds['20260105']], y: m[recIds.y]
    };
  }
  function call(overwrite) {
    return h.request(h.app).post('/api/archives/records/auto-tag-milestones').set('Authorization', authz('memX1')).send({ projectId: 'rf-p-tag', overwrite: overwrite });
  }

  test('overwrite=false: 겹치는 구간은 먼저(sort_order) 마일스톤, 빈 것만 태깅', async function () {
    var r = await call(false);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ tagged: 4, milestones: 2 });
    expect(await tags()).toEqual({ d1: 'rf-ms-A', d2: 'rf-ms-A', d3: 'rf-ms-A', d4: 'rf-ms-B', d5: null, y: null });
    var again = await call(false);
    expect(again.body.data.tagged).toBe(0);
  });

  test('overwrite=true: 마지막 마일스톤이 이기고 tagged 는 덮어쓴 횟수 합계 (예전 루프와 동일)', async function () {
    var r = await call(true);
    expect(r.body.data).toEqual({ tagged: 6, milestones: 2 });
    expect(await tags()).toEqual({ d1: 'rf-ms-A', d2: 'rf-ms-B', d3: 'rf-ms-B', d4: 'rf-ms-B', d5: null, y: null });
  });

  test('다른 테넌트 프로젝트 → 404, projectId 없음 → 400', async function () {
    var r = await h.request(h.app).post('/api/archives/records/auto-tag-milestones').set('Authorization', authz('memX1')).send({ projectId: 'rf-p-y' });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'NOT_FOUND', message: '프로젝트 없음' });
    var b = await h.request(h.app).post('/api/archives/records/auto-tag-milestones').set('Authorization', authz('memX1')).send({});
    expect(b.status).toBe(400);
  });
});

describe('notification — 이해관계자 일괄 해석', function () {
  test('resolveStakeholders = 단건 규칙 (활성 멤버 + 소유자 + 같은 테넌트 admin)', async function () {
    var m = await dispatch.resolveStakeholders(['rf-p-member', 'rf-p-y', 'rf-p-released']);
    var mem = m.get('rf-p-member');
    expect(mem.tenantId).toBe(TX);
    expect(mem.ids.slice().sort()).toEqual([U.memX3.id, U.memX2.id, U.adminX.id].sort());
    expect(mem.ids).not.toContain(U.adminY.id);
    var rel = m.get('rf-p-released');
    expect(rel.ids).not.toContain(U.memX3.id);   // 해제된 멤버 제외
    expect(m.get('rf-p-y').ids).toEqual([U.adminY.id]);
    expect((await dispatch.resolveStakeholders([])).size).toBe(0);
  });

  test('notifyProjectStakeholders (pre 유무 무관) 인앱 알림은 같은 테넌트에만', async function () {
    var tag = 'rf-noti-' + Date.now();
    var pre = (await dispatch.resolveStakeholders(['rf-p-member'])).get('rf-p-member');
    await dispatch.notifyProjectStakeholders('project_delayed', { name: tag, orderNo: '', endDate: '' }, 'rf-p-member', pre);
    await dispatch.notifyProjectStakeholders('project_delayed', { name: tag + 'b', orderNo: '', endDate: '' }, 'rf-p-member');
    var got = [];
    for (var i = 0; i < 30 && got.length < 6; i++) {
      await new Promise(function (r) { setTimeout(r, 100); });
      got = (await db.query('SELECT user_id FROM in_app_notifications WHERE body LIKE $1', ['%' + tag + '%'])).rows;
    }
    var users = got.map(function (r) { return r.user_id; });
    expect(users.length).toBe(6);
    expect(users).not.toContain(U.adminY.id);
  });
});

describe('migration 052 — 재실행 안전 + project_members.tenant_id 백필', function () {
  test('기본 테넌트로 잘못 들어간 멤버 행을 프로젝트 테넌트로 고치고, 두 번 실행해도 안전', async function () {
    await db.query("UPDATE project_members SET tenant_id = $1 WHERE project_id = 'rf-p-member' AND user_id = $2", [DEFAULT_TENANT, U.memX3.id]);
    var sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '052_scope_indexes_pm_tenant_backfill.sql'), 'utf8');
    await db.query(sql);
    await db.query(sql);
    var r = await db.query("SELECT tenant_id FROM project_members WHERE project_id = 'rf-p-member' AND user_id = $1", [U.memX3.id]);
    expect(r.rows[0].tenant_id).toBe(TX);
    var idx = (await db.query("SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_wr_tenant_order_date','idx_projects_end_date_status') ORDER BY 1")).rows.map(function (x) { return x.indexname; });
    expect(idx).toEqual(['idx_projects_end_date_status', 'idx_wr_tenant_order_date']);
  });
});

describe('error response shape (lib/http-errors)', function () {
  test('sendError: message 생략 시 키 없음 / serverError: 일반화된 500', function () {
    var httpErr = require('../lib/http-errors');
    function fakeRes() {
      return { headersSent: false, statusCode: 0, body: null,
        status: function (s) { this.statusCode = s; return this; },
        json: function (b) { this.body = b; return this; } };
    }
    var a = fakeRes(); httpErr.sendError(a, 404, 'NOT_FOUND');
    expect(a.statusCode).toBe(404); expect(a.body).toEqual({ error: 'NOT_FOUND' });
    var b = fakeRes(); httpErr.sendError(b, 409, 'CONFLICT', 'x', { latest: 1 });
    expect(b.body).toEqual({ error: 'CONFLICT', message: 'x', latest: 1 });
    var spy = jest.spyOn(console, 'error').mockImplementation(function () {});
    var c = fakeRes(); httpErr.serverError(c, '[t]', new Error('secret sql detail'));
    expect(c.statusCode).toBe(500); expect(c.body).toEqual({ error: 'SERVER_ERROR', message: '서버 오류' });
    var d = fakeRes(); httpErr.serverError(d, '[t]', new Error('e'), '서버 오류가 발생했습니다.');
    expect(d.body.message).toBe('서버 오류가 발생했습니다.');
    var e = fakeRes(); e.headersSent = true; httpErr.serverError(e, '[t]', new Error('e'));
    expect(e.statusCode).toBe(0);
    expect(spy).toHaveBeenCalledWith('[t]', expect.any(Error));
    spy.mockRestore();
  });
});
