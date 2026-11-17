/* 🔄 회사 공통 설정 (v13.521) — aw_auto { on, min } : 모두 읽고 관리자만 바꿈 */
var h = require('./helpers');
var db = h.db;
var T = h.TEST_TENANT_ID;
var S = Date.now();
var admin, member;
function api(m, u, who) { return h.request(h.app)[m](u).set('Authorization', 'Bearer ' + who.token); }

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('so-' + S);
  admin = await h.createTestUser({ email: 'so-a-' + S + '@test.com', role: 'admin', name: '관' + S });
  member = await h.createTestUser({ email: 'so-m-' + S + '@test.com', role: 'member', name: '원' + S });
  await db.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [T]);
});
afterAll(async function () { await db.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [T]); await h.cleanup(); });

test('로그인 없이는 안 됨', async function () {
  var r = await h.request(h.app).get('/api/settings/org/aw_auto');
  expect(r.status).toBe(401);
});

test('정한 적 없으면 기본값 — 켜짐 · 5분', async function () {
  var r = await api('get', '/api/settings/org/aw_auto', member);
  expect(r.status).toBe(200);
  expect(r.body.data).toEqual({ on: true, min: 5 });
});

test('관리자가 아니면 못 바꿈', async function () {
  var r = await api('put', '/api/settings/org/aw_auto', member).send({ value: { on: true, min: 1 } });
  expect(r.status).toBe(403);
  var g = await api('get', '/api/settings/org/aw_auto', admin);
  expect(g.body.data.min).toBe(5);
});

test('관리자가 바꾸면 모두에게 보임', async function () {
  var r = await api('put', '/api/settings/org/aw_auto', admin).send({ value: { on: false, min: 12.4 } });
  expect(r.status).toBe(200);
  expect(r.body.data).toEqual({ on: false, min: 12 });
  var g = await api('get', '/api/settings/org/aw_auto', member);
  expect(g.body.data).toEqual({ on: false, min: 12 });
});

test('주기는 1 ~ 720분 · 모르는 열쇠는 없음', async function () {
  for (var bad of [0, 721, 'x', null]) {
    var r = await api('put', '/api/settings/org/aw_auto', admin).send({ value: { on: true, min: bad } });
    expect(r.status).toBe(400);
  }
  expect((await api('put', '/api/settings/org/aw_auto', admin).send({})).status).toBe(400);
  expect((await api('get', '/api/settings/org/nope', admin)).status).toBe(404);
  expect((await api('put', '/api/settings/org/nope', admin).send({ value: 1 })).status).toBe(404);
  // 사람마다 따로인 설정은 그대로 (org 가 아닌 열쇠)
  expect((await api('put', '/api/settings/some_key', member).send({ value: 1 })).status).toBe(200);
});
