/**
 * 📓 노트북 v13.330 — 동시 저장이 서로를 덮지 않음 · 휴지통 노트 저장 거절 · 큰 글 413 · 손글씨 기록 · 이름 붙인 기록 상한
 *   · 공유 한 묶음 · 첨부 정리 · 위험한 첨부는 내려받기로 · 날짜 검사 · AI 시간당 한도
 */
var h = require('./helpers');
var db = h.db;
var S = Date.now();
var nbLib = require('../lib/notebook');
var a, b;
function api(m, u, who) { return h.request(h.app)[m](u).set('Authorization', 'Bearer ' + who.token); }

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('nb330-' + S);
  a = await h.createTestUser({ email: 'nb330-a-' + S + '@test.com', role: 'member', name: '노트가' });
  b = await h.createTestUser({ email: 'nb330-b-' + S + '@test.com', role: 'member', name: '노트나' });
});
afterAll(async function () { await h.cleanup(); });

test('같은 baseRev 로 두 창이 동시에 저장 — 하나만 들어가고 다른 하나는 409 (말없이 덮지 않음)', async function () {
  var n = (await api('post', '/api/notebook/notes', a).send({ title: '동시', body: '처음' })).body.data;
  var rs = await Promise.all([
    api('put', '/api/notebook/notes/' + n.id, a).send({ body: '창 A', baseRev: 1 }),
    api('put', '/api/notebook/notes/' + n.id, a).send({ body: '창 B', baseRev: 1 })
  ]);
  var codes = rs.map(function (r) { return r.status; }).sort();
  expect(codes).toEqual([200, 409]);
  var won = rs.filter(function (r) { return r.status === 200; })[0].body.data;
  var lost = rs.filter(function (r) { return r.status === 409; })[0].body.data;
  expect(won.rev).toBe(2);
  var now = (await api('get', '/api/notebook/notes/' + n.id, a)).body.data;
  expect(now.rev).toBe(2);
  expect(lost.body).toBe(now.body);   // 409 는 지금 서버 모습을 돌려줌
});

test('휴지통에 간 노트 — 내용 · 태그 · 폴더 저장은 410, 되살리면 다시 됨', async function () {
  var n = (await api('post', '/api/notebook/notes', a).send({ body: '지울 노트' })).body.data;
  await api('delete', '/api/notebook/notes/' + n.id, a);
  expect((await api('put', '/api/notebook/notes/' + n.id, a).send({ body: '다른 창 자동 저장', baseRev: 1 })).status).toBe(410);
  expect((await api('put', '/api/notebook/notes/' + n.id, a).send({ tags: ['x'] })).status).toBe(410);
  expect((await api('get', '/api/notebook/notes/' + n.id, a)).body.data.body).toBe('지울 노트');
  await api('post', '/api/notebook/notes/' + n.id + '/restore', a);
  expect((await api('put', '/api/notebook/notes/' + n.id, a).send({ body: '되살린 뒤', baseRev: 1 })).status).toBe(200);
});

test('40만 자 넘는 글 — 만들기 · 사본도 말없이 자르지 않고 413', async function () {
  var big = 'x'.repeat(nbLib.MAX_BODY + 1);
  var r = await api('post', '/api/notebook/notes', a).send({ body: big });
  expect(r.status).toBe(413);
  var ok = await api('post', '/api/notebook/notes', a).send({ body: 'y'.repeat(nbLib.MAX_BODY) });
  expect(ok.status).toBe(201);
  expect((await api('get', '/api/notebook/notes/' + ok.body.data.id, a)).body.data.body.length).toBe(nbLib.MAX_BODY);
});

test('손글씨만 고쳐도 고친 기록이 남음 (지우개로 다 지워도 되돌릴 수 있게)', async function () {
  var ink = { blocks: { k1: { h: 200, s: [{ t: 'pen', c: '#111111', w: 3, p: [1, 2, 0.5, 3, 4, 0.5] }] } } };
  var n = (await api('post', '/api/notebook/notes', a).send({ body: '::ink[k1]', ink: ink })).body.data;
  var r = await api('put', '/api/notebook/notes/' + n.id, a).send({ ink: { blocks: { k1: { h: 200, s: [] } } }, baseRev: 1 });
  expect(r.status).toBe(200);
  var vs = (await api('get', '/api/notebook/notes/' + n.id + '/versions', a)).body.data;
  expect(vs.length).toBe(1);
  var v = (await api('get', '/api/notebook/notes/' + n.id + '/versions/' + vs[0].id, a)).body.data;
  expect(v.ink.blocks.k1.s.length).toBe(1);
});

test('같은 모습이면 기록을 또 남기지 않음 · 이름 붙인 기록은 노트마다 50개까지', async function () {
  var n = (await api('post', '/api/notebook/notes', a).send({ body: '기록' })).body.data;
  var row = (await db.query('SELECT * FROM nb_notes WHERE id = $1', [n.id])).rows[0];
  expect(await nbLib.snapshot(row)).not.toBeNull();
  expect(await nbLib.snapshot(row)).toBeNull();   // 바로 또 — 같은 모습
  for (var i = 0; i < 53; i++) await nbLib.snapshot(row, '직접 ' + i, true);
  var c = (await db.query('SELECT COUNT(*) FILTER (WHERE label IS NOT NULL)::int AS named, COUNT(*) FILTER (WHERE label IS NULL)::int AS auto FROM nb_versions WHERE note_id = $1', [n.id])).rows[0];
  expect(c.named).toBe(50);
  expect(c.auto).toBe(1);   // 자동 기록은 이름 붙인 기록에 밀려 지워지지 않음
  var newest = (await db.query('SELECT label FROM nb_versions WHERE note_id = $1 AND label IS NOT NULL ORDER BY id DESC LIMIT 1', [n.id])).rows[0];
  expect(newest.label).toBe('직접 52');
});

test('공유 바꾸기 — 한 묶음으로 넣고 빼기 · 남은 사람만', async function () {
  var n = (await api('post', '/api/notebook/notes', a).send({ body: '공유할 노트' })).body.data;
  var r = await api('put', '/api/notebook/notes/' + n.id + '/shares', a).send({ userIds: [b.user.id, a.user.id, 'not-a-user'], notify: false });
  expect(r.status).toBe(200);
  var s = (await db.query('SELECT user_id FROM nb_shares WHERE note_id = $1', [n.id])).rows;
  expect(s.map(function (x) { return x.user_id; })).toEqual([b.user.id]);
  expect((await api('get', '/api/notebook/notes/' + n.id, b)).body.data.readOnly).toBe(true);
  await api('put', '/api/notebook/notes/' + n.id + '/shares', a).send({ userIds: [], notify: false });
  expect((await db.query('SELECT COUNT(*)::int AS n FROM nb_shares WHERE note_id = $1', [n.id])).rows[0].n).toBe(0);
  expect((await api('get', '/api/notebook/notes/' + n.id, b)).status).toBe(404);
});

test('첨부 — .json 파일도 그대로 올라감 · svg 는 내려받기로 · 안 쓰는 첨부는 휴지통 비울 때 정리', async function () {
  var j = await api('post', '/api/notebook/files?name=data.json', a).set('Content-Type', 'application/json').send(Buffer.from('{"a":1}'));
  expect(j.status).toBe(201);
  var svg = await api('post', '/api/notebook/files?name=x.svg', a).set('Content-Type', 'image/svg+xml').send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  expect(svg.status).toBe(201);
  var g = await api('get', '/api/notebook/files/' + svg.body.data.id, a);
  expect(g.headers['content-type']).toMatch(/octet-stream/);
  expect(g.headers['content-disposition']).toMatch(/^attachment/);
  expect(g.headers['content-security-policy']).toMatch(/sandbox/);
  var png = await api('post', '/api/notebook/files?name=p.png', a).set('Content-Type', 'image/png').send(Buffer.from([137, 80, 78, 71]));
  expect((await api('get', '/api/notebook/files/' + png.body.data.id, a)).headers['content-disposition']).toMatch(/^inline/);
  // 쓰는 노트 하나(png) · 안 쓰는 첨부 둘(json · svg) — 1시간 지난 걸로 만들고 휴지통 비우기
  var keep = (await api('post', '/api/notebook/notes', a).send({ body: '![사진](nbf:' + png.body.data.id + ')' })).body.data;
  var gone = (await api('post', '/api/notebook/notes', a).send({ body: '[파일](nbf:' + j.body.data.id + ')' })).body.data;
  await db.query("UPDATE nb_files SET created_at = NOW() - INTERVAL '2 hours' WHERE user_id = $1", [a.user.id]);
  await api('delete', '/api/notebook/notes/' + gone.id, a);
  var e = await api('post', '/api/notebook/trash/empty', a);
  expect(e.body.data.files).toBeGreaterThanOrEqual(2);
  var left = (await db.query('SELECT id FROM nb_files WHERE user_id = $1', [a.user.id])).rows.map(function (x) { return x.id; });
  expect(left).toContain(png.body.data.id);
  expect(left).not.toContain(j.body.data.id);
  expect(left).not.toContain(svg.body.data.id);
  expect(keep.id).toBeTruthy();
});

test('리포트 · 묶어 출력 — 있을 수 없는 날짜는 400 (500 이 아님)', async function () {
  expect((await api('post', '/api/notebook/report', a).send({ from: '2026-13-45', to: '2026-13-46' })).status).toBe(400);
  expect((await api('get', '/api/notebook/bundle?src=notes&from=2026-02-30&to=2026-03-01', a)).status).toBe(400);
  expect((await api('get', '/api/notebook/bundle?src=notes&from=2026-02-01&to=2026-03-01', a)).status).toBe(200);
});

test('✨ AI — 사람마다 시간당 한도를 넘으면 429 (AI 를 부르기 전에)', async function () {
  var ai = require('../lib/ai-usage');
  for (var i = 0; i < 80; i++) ai.takeHourly(b.user.id);
  var r = await api('post', '/api/notebook/spell', b).send({ text: '맞춤법 검사할 글' });
  expect(r.status).toBe(429);
  expect(r.body.error).toBe('AI_RATE');
  ai._resetHourly && ai._resetHourly();
});
