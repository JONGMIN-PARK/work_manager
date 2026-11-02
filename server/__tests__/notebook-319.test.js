/**
 * 🖨 v13.319 출력 — 회사 머리글(관리자만 고침) · 묶어 출력(일일 노트 · 내 노트, 기간 · 폴더 · 태그)
 */
var h = require('./helpers');
var db = h.db;
var S = Date.now();
var admin, a, b;
function api(m, u, who) { return h.request(h.app)[m](u).set('Authorization', 'Bearer ' + who.token); }
var LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('nb319-' + S);
  admin = await h.createTestUser({ email: 'nb9-ad-' + S + '@test.com', role: 'admin', name: '관리' });
  a = await h.createTestUser({ email: 'nb9-a-' + S + '@test.com', role: 'member', name: '가출력' });
  b = await h.createTestUser({ email: 'nb9-b-' + S + '@test.com', role: 'member', name: '나출력' });
});
afterAll(async function () { await h.cleanup(); });

test('🏢 회사 머리글 — 누구나 읽고 관리자만 저장 · 로고는 그림 data URL 만', async function () {
  var r0 = (await api('get', '/api/notebook/print-settings', a)).body.data;
  expect(r0).toMatchObject({ company: '', logo: '', canEdit: false });
  expect((await api('put', '/api/notebook/print-settings', a).send({ company: 'X' })).status).toBe(403);
  expect((await api('put', '/api/notebook/print-settings', admin).send({ company: 'A', logo: 'data:text/html;base64,PHNjcmlwdD4=' })).status).toBe(400);
  expect((await api('put', '/api/notebook/print-settings', admin).send({ company: 'A', logo: 'javascript:alert(1)' })).status).toBe(400);
  var ok = await api('put', '/api/notebook/print-settings', admin).send({ company: '  (주)애니모션  ', logo: LOGO });
  expect(ok.status).toBe(200);
  var r1 = (await api('get', '/api/notebook/print-settings', a)).body.data;
  expect(r1).toMatchObject({ company: '(주)애니모션', logo: LOGO, canEdit: false });
  expect((await api('get', '/api/notebook/print-settings', admin)).body.data.canEdit).toBe(true);
  await api('put', '/api/notebook/print-settings', admin).send({ company: '(주)애니모션', logo: '' });
  expect((await api('get', '/api/notebook/print-settings', b)).body.data.logo).toBe('');
});

test('📚 묶어 출력 — 일일 노트: 기간 안 · 본인 것만 · 날짜 순 · 빈 노트 제외', async function () {
  var T = h.TEST_TENANT_ID;
  var ins = function (u, d, ref, body) { return db.query('INSERT INTO my_notes (user_id, note_date, ref, tenant_id, body) VALUES ($1,$2,$3,$4,$5)', [u.user.id, d, ref, T, body]); };
  await ins(a, '2026-11-03', '', '## 할 일\n- [x] 둘째 날');
  await ins(a, '2026-11-02', '', '## 할 일\n- [ ] 첫날');
  await ins(a, '2026-11-02', 'ev:e1', '회의 메모');
  await ins(a, '2026-11-04', '', '');
  await ins(a, '2026-10-20', '', '기간 밖');
  await ins(b, '2026-11-02', '', '남의 것');
  var r = (await api('get', '/api/notebook/bundle?src=daily&from=2026-11-01&to=2026-11-07', a)).body.data;
  expect(r.map(function (x) { return x.date + '|' + x.ref; })).toEqual(['2026-11-02|', '2026-11-02|ev:e1', '2026-11-03|']);
  expect(r[0]).toMatchObject({ kind: 'daily', body: '## 할 일\n- [ ] 첫날' });
  expect((await api('get', '/api/notebook/bundle?src=daily&from=2026-11-07&to=2026-11-01', a)).status).toBe(400);
  expect((await api('get', '/api/notebook/bundle?src=daily&from=2026-01-01&to=2026-11-01', a)).status).toBe(400);
  expect((await api('get', '/api/notebook/bundle?src=daily&from=x&to=2026-11-01', a)).status).toBe(400);
});

test('📚 묶어 출력 — 내 노트: 고친 날(KST) · 폴더 · 태그 · 휴지통 제외', async function () {
  var f = (await api('post', '/api/notebook/folders', a).send({ name: '회의' })).body.data;
  var n1 = (await api('post', '/api/notebook/notes', a).send({ title: '회의록 1', body: '## 결정 사항\n- A', folderId: f.id, tags: ['주간'] })).body.data;
  var n2 = (await api('post', '/api/notebook/notes', a).send({ title: '메모', body: 'x', tags: ['주간'] })).body.data;
  var n3 = (await api('post', '/api/notebook/notes', a).send({ title: '지운 것', body: 'y' })).body.data;
  await api('delete', '/api/notebook/notes/' + n3.id, a);
  await api('post', '/api/notebook/notes', b).send({ title: '남의 노트', body: 'z' });
  // 고친 시각을 KST 경계로 — 11/02 23:30 KST = 11/02 14:30 UTC, 11/03 00:30 KST = 11/02 15:30 UTC
  await db.query("UPDATE nb_notes SET updated_at = '2026-11-02T14:30:00Z' WHERE id = $1", [n1.id]);
  await db.query("UPDATE nb_notes SET updated_at = '2026-11-02T15:30:00Z' WHERE id = $1", [n2.id]);
  var day2 = (await api('get', '/api/notebook/bundle?src=notes&from=2026-11-02&to=2026-11-02', a)).body.data;
  expect(day2.map(function (x) { return x.title; })).toEqual(['회의록 1']);
  expect(day2[0]).toMatchObject({ kind: 'note', date: '2026-11-02', tags: ['주간'] });
  var both = (await api('get', '/api/notebook/bundle?src=notes&from=2026-11-02&to=2026-11-03', a)).body.data;
  expect(both.map(function (x) { return x.title + '|' + x.date; })).toEqual(['회의록 1|2026-11-02', '메모|2026-11-03']);
  var byF = (await api('get', '/api/notebook/bundle?src=notes&from=2026-11-01&to=2026-11-05&folderId=' + f.id, a)).body.data;
  expect(byF.map(function (x) { return x.title; })).toEqual(['회의록 1']);
  var byT = (await api('get', '/api/notebook/bundle?src=notes&from=2026-11-01&to=2026-11-05&tag=' + encodeURIComponent('주간'), a)).body.data;
  expect(byT.length).toBe(2);
});
