/* 📝 애니웍스 공수 등록 (v13.512) — 날짜별 초안 · 등록 기록은 본인 것만 */
var h = require('./helpers');
var db = h.db;
var T = h.TEST_TENANT_ID;
var S = Date.now();
var a, b;
function api(m, u, who) { return h.request(h.app)[m](u).set('Authorization', 'Bearer ' + who.token); }
var ROW = { orderno: 'B26031', prodspec: 'PICAligner', hours: 6.5, divi: '사내', job: '개발', memo: '구현' };

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('gs-' + S);
  a = await h.createTestUser({ email: 'gs-a-' + S + '@test.com', role: 'member', name: '가' + S });
  b = await h.createTestUser({ email: 'gs-b-' + S + '@test.com', role: 'member', name: '나' + S });
});
afterAll(async function () { await db.query('DELETE FROM gongsu_days WHERE tenant_id = $1', [T]); await h.cleanup(); });

test('로그인 없이는 안 됨', async function () {
  var r = await h.request(h.app).get('/api/gongsu?from=2026-11-01&to=2026-11-30');
  expect(r.status).toBe(401);
});

test('초안 저장 → 다시 읽기 (날짜는 글자 그대로)', async function () {
  var r = await api('put', '/api/gongsu/2026-11-17', a).send({ items: [ROW, { orderno: ' 공통업무 ', hours: 'x', divi: '?', job: '없음', memo: '  회의 ' }] });
  expect(r.status).toBe(200);
  expect(r.body.data.day).toBe('2026-11-17');
  expect(r.body.data.status).toBe('draft');
  expect(r.body.data.items[0]).toEqual(ROW);
  expect(r.body.data.items[1]).toEqual({ orderno: '공통업무', prodspec: '', hours: 0, divi: '', job: '', memo: '회의' });
  var g = await api('get', '/api/gongsu?from=2026-11-17&to=2026-11-17', a);
  expect(g.body.data.length).toBe(1);
  expect(g.body.data[0].day).toBe('2026-11-17');
  expect(g.body.data[0].items.length).toBe(2);
});

test('남의 것은 보이지 않고 건드릴 수 없음', async function () {
  var g = await api('get', '/api/gongsu?from=2026-11-01&to=2026-11-30', b);
  expect(g.body.data).toEqual([]);
  var c = await api('post', '/api/gongsu/2026-11-17/checked', b);
  expect(c.status).toBe(404);
  await api('delete', '/api/gongsu/2026-11-17', b);
  var mine = await api('get', '/api/gongsu?from=2026-11-17&to=2026-11-17', a);
  expect(mine.body.data.length).toBe(1);
});

test('잘못된 날짜 · 16행 이상은 거절', async function () {
  expect((await api('put', '/api/gongsu/2026-13-99', a).send({ items: [] })).status).toBe(400);
  expect((await api('get', '/api/gongsu?from=x&to=y', a)).status).toBe(400);
  var many = []; for (var i = 0; i < 16; i++) many.push(ROW);
  expect((await api('put', '/api/gongsu/2026-11-18', a).send({ items: many })).status).toBe(400);
  expect((await api('post', '/api/gongsu/2026-11-18/sent', a).send({ items: [] })).status).toBe(400);
});

test('등록함 → 올린 그대로 남고, 초안을 고쳐도 올린 것은 그대로 · 확인 표시', async function () {
  var s = await api('post', '/api/gongsu/2026-11-17/sent', a).send({ items: [ROW], message: '등록되었습니다' });
  expect(s.status).toBe(200);
  expect(s.body.data.status).toBe('sent');
  expect(s.body.data.sentAt).toBeTruthy();
  expect(s.body.data.sentItems).toEqual([ROW]);
  expect(s.body.data.sentMsg).toBe('등록되었습니다');
  expect(s.body.data.checkedAt).toBeNull();
  var p = await api('put', '/api/gongsu/2026-11-17', a).send({ items: [Object.assign({}, ROW, { memo: '고침' })] });
  expect(p.body.data.status).toBe('sent');
  expect(p.body.data.sentItems[0].memo).toBe('구현');
  expect(p.body.data.items[0].memo).toBe('고침');
  var c = await api('post', '/api/gongsu/2026-11-17/checked', a);
  expect(c.body.data.checkedAt).toBeTruthy();
});

test('최근 수주번호 — 자주 쓴 순', async function () {
  await api('put', '/api/gongsu/2026-11-16', a).send({ items: [ROW, { orderno: '공통업무', prodspec: '업무', hours: 1, divi: '사내', job: '공통', memo: '회의' }] });
  var today = new Date().toISOString().slice(0, 10);
  await api('put', '/api/gongsu/' + today, a).send({ items: [ROW] });
  var r = await api('get', '/api/gongsu/orders', a);
  expect(r.status).toBe(200);
  expect(r.body.data.length).toBeGreaterThan(0);
  expect(r.body.data[0].orderno).toBe('B26031');
  expect(r.body.data[0].job).toBe('개발');
  expect((await api('get', '/api/gongsu/orders', b)).body.data).toEqual([]);
});

test('지우기', async function () {
  expect((await api('delete', '/api/gongsu/2026-11-16', a)).status).toBe(200);
  var g = await api('get', '/api/gongsu?from=2026-11-16&to=2026-11-16', a);
  expect(g.body.data).toEqual([]);
});
