/**
 * 🎯 목표 분장 비율 /api/wa-targets (v13.460) — 쓰기는 관리자 · 임원 · 팀장 · 팀원은 팀 · 부서 + 본인 것만 · 합 100 넘으면 거절 · 비우면 지움
 */
var h = require('./helpers');
var db = h.db;
var T = h.TEST_TENANT_ID;
var S = Date.now();
var admin, mgr, member;
function api(m, u, who) { return h.request(h.app)[m](u).set('Authorization', 'Bearer ' + who.token); }

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('wat-' + S);
  admin = await h.createTestUser({ email: 'wat-a-' + S + '@test.com', role: 'admin', name: '관리' + S });
  mgr = await h.createTestUser({ email: 'wat-g-' + S + '@test.com', role: 'manager', name: '팀장' + S });
  member = await h.createTestUser({ email: 'wat-m-' + S + '@test.com', role: 'member', name: '팀원' + S });
});
afterAll(async function () {
  await db.query('DELETE FROM wa_targets WHERE tenant_id = $1', [T]);
  await h.cleanup();
});

test('팀원은 못 씀 · 팀장은 씀', async function () {
  var r = await api('put', '/api/wa-targets', member).send({ scope: 'team', key: '*', mix: { D: 50 } });
  expect(r.status).toBe(403);
  r = await api('put', '/api/wa-targets', mgr).send({ scope: 'team', key: 'x', mix: { D: 50, A: '20', G: 0, 'bad key!': 10 } });
  expect(r.status).toBe(200);
  expect(r.body.data.key).toBe('*');                      // 팀은 늘 '*'
  expect(r.body.data.mix).toEqual({ D: 50, A: 20 });       // 0 · 이상한 약자는 버림
  expect(r.body.data.updatedName).toBe('팀장' + S);
});

test('합 100 넘으면 거절 · scope 확인', async function () {
  var r = await api('put', '/api/wa-targets', admin).send({ scope: 'dept', key: '개발팀', mix: { D: 70, A: 40 } });
  expect(r.status).toBe(400);
  r = await api('put', '/api/wa-targets', admin).send({ scope: 'what', key: 'a', mix: { D: 10 } });
  expect(r.status).toBe(400);
  r = await api('put', '/api/wa-targets', admin).send({ scope: 'person', key: '', mix: { D: 10 } });
  expect(r.status).toBe(400);
});

test('팀원은 팀 · 부서 + 본인 목표만 읽음', async function () {
  await api('put', '/api/wa-targets', admin).send({ scope: 'dept', key: '개발팀', mix: { D: 60 } }).expect(200);
  await api('put', '/api/wa-targets', admin).send({ scope: 'person', key: '팀원' + S, mix: { D: 80, G: 20 } }).expect(200);
  await api('put', '/api/wa-targets', admin).send({ scope: 'person', key: '남' + S, mix: { B: 90 } }).expect(200);
  var r = await api('get', '/api/wa-targets', member);
  expect(r.status).toBe(200);
  expect(r.body.canEdit).toBe(false);
  var ks = r.body.data.map(function (x) { return x.scope + ':' + x.key; }).sort();
  expect(ks).toEqual(['dept:개발팀', 'person:팀원' + S, 'team:*']);
  r = await api('get', '/api/wa-targets', mgr);
  expect(r.body.canEdit).toBe(true);
  expect(r.body.data.length).toBe(4);
});

test('비우면 지움', async function () {
  var r = await api('put', '/api/wa-targets', admin).send({ scope: 'person', key: '남' + S, mix: {} });
  expect(r.status).toBe(200);
  expect(r.body.data).toBe(null);
  var n = await db.query("SELECT count(*)::int AS n FROM wa_targets WHERE tenant_id = $1 AND scope = 'person' AND key = $2", [T, '남' + S]);
  expect(n.rows[0].n).toBe(0);
  r = await api('get', '/api/wa-targets', admin);
  expect(r.body.data.length).toBe(3);
});
