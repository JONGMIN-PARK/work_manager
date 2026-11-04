/**
 * v13.333 — 📝 일일 노트(my_notes) 동시 편집: base 가 다르면 409 + 지금 글 · 같은 글 다시 보내기는 통과 · base 없으면 예전처럼
 *   · 📓 노트 목록 쪽 나누기 (limit · offset · more)
 */
var h = require('./helpers');
var S = Date.now();
var a;
function api(m, u, who) { return h.request(h.app)[m](u).set('Authorization', 'Bearer ' + who.token); }
var D = '2026-10-21';

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('nb333-' + S);
  a = await h.createTestUser({ email: 'nb333-a-' + S + '@test.com', role: 'member', name: '노트가' });
});
afterAll(async function () { await h.cleanup(); });

test('일일 노트 — base 가 지금 글과 다르면 409 와 지금 글 · 맞으면 저장', async function () {
  expect((await api('put', '/api/my-work/notes', a).send({ date: D, ref: '', body: '첫 글', base: '' })).status).toBe(200);
  // 다른 곳이 base '' 로 또 만들려 함 → 이미 있음
  var r = await api('put', '/api/my-work/notes', a).send({ date: D, ref: '', body: '다른 창 글', base: '' });
  expect(r.status).toBe(409);
  expect(r.body.data.body).toBe('첫 글');
  expect((await api('put', '/api/my-work/notes', a).send({ date: D, ref: '', body: '첫 글\n둘째 줄', base: '첫 글' })).status).toBe(200);
  // 시간 초과 뒤 같은 글을 옛 base 로 다시 보냄 → 통과
  expect((await api('put', '/api/my-work/notes', a).send({ date: D, ref: '', body: '첫 글\n둘째 줄', base: '첫 글' })).status).toBe(200);
  // 옛 base 로 다른 글 → 409
  expect((await api('put', '/api/my-work/notes', a).send({ date: D, ref: '', body: '옛 글로 덮기', base: '첫 글' })).status).toBe(409);
  // 비우기도 base 확인
  expect((await api('put', '/api/my-work/notes', a).send({ date: D, ref: '', body: '', base: '첫 글' })).status).toBe(409);
  // base 없이 보내면 예전처럼 덮음 (텔레그램 · 옛 화면)
  expect((await api('put', '/api/my-work/notes', a).send({ date: D, ref: '', body: '덮은 글' })).status).toBe(200);
  var g = (await api('get', '/api/my-work/notes?date=' + D, a)).body.data.notes.filter(function (n) { return n.ref === ''; })[0];
  expect(g.body).toBe('덮은 글');
  expect((await api('put', '/api/my-work/notes', a).send({ date: D, ref: '', body: '', base: '덮은 글' })).status).toBe(200);
});

test('노트 목록 쪽 나누기 — limit · offset · more, 겹치거나 빠지지 않음', async function () {
  for (var i = 0; i < 7; i++) await api('post', '/api/notebook/notes', a).send({ title: '쪽 ' + i, body: 'x' });
  var p1 = (await api('get', '/api/notebook/notes?view=all&limit=3&offset=0', a)).body;
  var p2 = (await api('get', '/api/notebook/notes?view=all&limit=3&offset=3', a)).body;
  var p3 = (await api('get', '/api/notebook/notes?view=all&limit=3&offset=6', a)).body;
  expect(p1.data.length).toBe(3); expect(p1.more).toBe(true);
  expect(p2.data.length).toBe(3); expect(p2.more).toBe(true);
  expect(p3.data.length).toBe(1); expect(p3.more).toBe(false);
  var ids = p1.data.concat(p2.data, p3.data).map(function (x) { return x.id; });
  expect(new Set(ids).size).toBe(7);
});
