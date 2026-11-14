/**
 * ⬆ 새 버전 알림 푸시 (v13.501) — 버전이 바뀐 서버가 켜질 때 한 번만 · 처음은 적어 두기만 · 같은 버전 다시 켜도 조용히
 */
var h = require('./helpers');
var db = h.db;
var push = require('../services/push.service');
var ua = require('../services/update-announce');
var S = Date.now(), sent = [], u;

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('upd-' + S);
  u = await h.createTestUser({ email: 'upd-' + S + '@test.com', role: 'member', name: '업데이트' });
  await db.query("DELETE FROM app_keys WHERE name = 'last_version'");
  await db.query("INSERT INTO push_subs (endpoint, user_id, tenant_id, p256dh, auth) VALUES ($1, $2, $3, 'p', 'a')", ['https://push.example/' + S, u.user.id, h.TEST_TENANT_ID]);
  push._setSender(function (sub, body) { sent.push(JSON.parse(body)); return Promise.resolve(); });
});
afterAll(async function () {
  push._setSender(null);
  await db.query("DELETE FROM push_subs WHERE endpoint = $1", ['https://push.example/' + S]);
  await db.query("DELETE FROM app_keys WHERE name = 'last_version'");
  await h.cleanup();
});

test('처음 켜짐 — 적어 두기만 (보내지 않음)', async function () {
  expect((await ua.announce({ version: '1.0.0' })).skip).toBe('first');
  expect(sent.length).toBe(0);
});
test('같은 버전 다시 켜짐(재시작 · 여러 대) — 조용히', async function () {
  expect((await ua.announce({ version: '1.0.0' })).skip).toBe('same');
  expect(sent.length).toBe(0);
});
test('새 버전 — 구독한 기기 모두에 한 번 · 누르면 새로 고침(go=update) · PC 앱 버전도', async function () {
  var r = await Promise.all([ua.announce({ version: '1.0.1', desktop: { version: '9.9.9' } }), ua.announce({ version: '1.0.1' })]);   // 두 대가 동시에 켜져도
  expect(r.filter(function (x) { return x.sent; }).length).toBe(1);
  expect(sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ go: 'update', tag: 'wm-update', kind: 'update' });
  expect(sent[0].title).toContain('v1.0.1');
  expect(sent[0].body).toContain('PC 앱 v9.9.9');
});
test('버전 없음 — 건너뜀', async function () {
  expect((await ua.announce({ version: '' })).skip).toBe('no-version');
});
