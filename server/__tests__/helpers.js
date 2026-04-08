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
  var email = opts.email || ('test-' + Date.now() + '@test.com');
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
  try {
    await db.query("DELETE FROM work_records WHERE tenant_id = $1", [TEST_TENANT_ID]);
    await db.query("DELETE FROM issues WHERE tenant_id = $1", [TEST_TENANT_ID]);
    await db.query("DELETE FROM events WHERE tenant_id = $1", [TEST_TENANT_ID]);
    await db.query("DELETE FROM orders WHERE tenant_id = $1", [TEST_TENANT_ID]);
    await db.query("DELETE FROM project_members WHERE tenant_id = $1", [TEST_TENANT_ID]);
    await db.query("DELETE FROM milestones WHERE tenant_id = $1", [TEST_TENANT_ID]);
    await db.query("DELETE FROM checklists WHERE tenant_id = $1", [TEST_TENANT_ID]);
    await db.query("DELETE FROM projects WHERE tenant_id = $1", [TEST_TENANT_ID]);
    await db.query("DELETE FROM user_settings WHERE tenant_id = $1", [TEST_TENANT_ID]);
    await db.query("DELETE FROM audit_logs WHERE tenant_id = $1", [TEST_TENANT_ID]);
    await db.query("DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)", [TEST_TENANT_ID]);
    await db.query("DELETE FROM users WHERE tenant_id = $1", [TEST_TENANT_ID]);
    await db.query("DELETE FROM tenants WHERE id = $1", [TEST_TENANT_ID]);
  } catch (e) {
    console.warn('[cleanup]', e.message);
  }
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
