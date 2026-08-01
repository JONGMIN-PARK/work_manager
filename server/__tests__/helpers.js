/**
 * 테스트 헬퍼 — 공통 유틸리티
 */
var request = require('supertest');
var app = require('../app');
var db = require('../config/db');
var bcrypt = require('bcryptjs');

var DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
var TEST_TENANT_ID = '00000000-0000-0000-0000-000000000099';

/**
 * 테스트 테넌트 생성
 */
async function createTestTenant(slug) {
  slug = slug || 'test-tenant-' + Date.now();
  var r = await db.query(
    "INSERT INTO tenants (id, name, slug, plan, max_users) VALUES ($1, $2, $3, 'pro', 50) ON CONFLICT (id) DO NOTHING RETURNING *",
    [TEST_TENANT_ID, 'Test Tenant', slug]
  );
  return r.rows[0] || { id: TEST_TENANT_ID };
}

/**
 * 테스트 사용자 생성 + 로그인 토큰 반환
 */
async function createTestUser(opts) {
  opts = opts || {};
  // 이메일은 회원가입 라우트와 동일하게 정규화한다.
  // /api/auth/register 는 trim().toLowerCase() 후 저장하고 /api/auth/login 도
  // 같은 정규화 후 `WHERE email = $1` 로 조회한다. 여기서 대문자를 그대로 넣으면
  // (예: iso-adminA@test.com) 사용자는 만들어지지만 로그인이 401 이 되어
  // token 이 null 이 되고, 이후 모든 요청이 'Bearer null' 로 401 이 된다.
  var email = (opts.email || ('test-' + Date.now() + '@test.com')).trim().toLowerCase();
  var name = opts.name || 'TestUser';
  var role = opts.role || 'member';
  var tenantId = opts.tenantId || TEST_TENANT_ID;
  var password = opts.password || 'Test1234!';

  var hash = await bcrypt.hash(password, 10);

  var r = await db.query(
    "INSERT INTO users (email, password_hash, name, role, status, tenant_id) VALUES ($1, $2, $3, $4, 'active', $5) RETURNING *",
    [email, hash, name, role, tenantId]
  );
  var user = r.rows[0];

  // 로그인하여 토큰 획득
  var loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: email, password: password });

  return {
    user: user,
    token: loginRes.body.data ? loginRes.body.data.accessToken : null,
    refreshToken: loginRes.body.data ? loginRes.body.data.refreshToken : null,
    email: email,
    password: password
  };
}

/**
 * 테스트 데이터 정리
 */
async function cleanup() {
  // 각 문장을 개별 격리 실행한다.
  //  - 테이블이 없는 환경(구버전 DB)에서도 나머지 정리가 계속되도록
  //  - 한 건 실패가 뒤따르는 users/tenants 삭제를 막지 않도록
  async function tryDel(sql) {
    try { await db.query(sql, [TEST_TENANT_ID]); }
    catch (e) { if (e.code !== '42P01') console.warn('[cleanup]', e.message); }  // 42P01 = 테이블 없음
  }

  // 1) 테넌트 스코프 자식 데이터
  var byTenant = [
    'work_records', 'issues', 'events', 'orders', 'project_members',
    'milestones', 'checklists', 'user_settings',
    // 이번 확장에서 추가된 테이블들 — users 를 참조하므로 users 삭제 전에 비워야 함
    'tech_logs', 'tech_usages', 'tech_assets',
    'meeting_action_items', 'meetings', 'project_dev_items', 'prestudies', 'comments'
  ];
  for (var i = 0; i < byTenant.length; i++) {
    await tryDel('DELETE FROM ' + byTenant[i] + ' WHERE tenant_id = $1');
  }
  await tryDel('DELETE FROM projects WHERE tenant_id = $1');

  // 2) users 를 FK로 참조하는 로그성 테이블 —
  //    tenant_id 가 NULL이거나 다른 값인 행이 남아 users 삭제를 막던 원인.
  //    tenant_id 조건이 아니라 user_id 로 지운다.
  var byUser = ['audit_logs', 'refresh_tokens', 'in_app_notifications', 'notification_logs', 'notification_prefs'];
  for (var j = 0; j < byUser.length; j++) {
    await tryDel('DELETE FROM ' + byUser[j] + ' WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)');
  }
  await tryDel('DELETE FROM audit_logs WHERE tenant_id = $1');

  // 3) 마지막에 users → tenants
  await tryDel('DELETE FROM users WHERE tenant_id = $1');
  try { await db.query('DELETE FROM tenants WHERE id = $1', [TEST_TENANT_ID]); }
  catch (e) { console.warn('[cleanup/tenants]', e.message); }
}

module.exports = {
  app: app,
  db: db,
  request: request,
  DEFAULT_TENANT_ID: DEFAULT_TENANT_ID,
  TEST_TENANT_ID: TEST_TENANT_ID,
  createTestTenant: createTestTenant,
  createTestUser: createTestUser,
  cleanup: cleanup
};
