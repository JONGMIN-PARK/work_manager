/**
 * 📓 노트북 (v13.316) — 만들기 · 목록(보기 · 폴더 · 태그 · 찾기) · 충돌(rev) · 고친 기록 · 휴지통 · 폴더 · 첨부 · 일일 노트 · 양식 · 낙서장 · 본인만
 */
var h = require('./helpers');
var db = h.db;
var S = Date.now();
var nbLib = require('../lib/notebook');
var a, b;
function api(m, u, who) { return h.request(h.app)[m](u).set('Authorization', 'Bearer ' + who.token); }

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('nb-' + S);
  a = await h.createTestUser({ email: 'nb-a-' + S + '@test.com', role: 'member', name: '노트가' });
  b = await h.createTestUser({ email: 'nb-b-' + S + '@test.com', role: 'member', name: '노트나' });
});
afterAll(async function () { await h.cleanup(); });

var n1, fld;
test('만들기 · 읽기 · 남의 노트는 안 보임', async function () {
  var r = await api('post', '/api/notebook/notes', a).send({ title: '설비 점검', body: '# 점검\n- [ ] 센서 확인\n**중요** 내용', tags: ['#점검', '점검', '설비'] });
  expect(r.status).toBe(201);
  n1 = r.body.data;
  expect(n1).toMatchObject({ title: '설비 점검', rev: 1, inbox: false, tags: ['점검', '설비'] });
  expect(n1.words).toBeGreaterThan(5);
  expect((await api('get', '/api/notebook/notes/' + n1.id, a)).body.data.body).toContain('센서 확인');
  expect((await api('get', '/api/notebook/notes/' + n1.id, b)).status).toBe(404);
  expect((await api('put', '/api/notebook/notes/' + n1.id, b).send({ body: 'x' })).status).toBe(404);
});

test('고치기 — rev 가 오르고, 엇갈리면 409 · force 로 덮기', async function () {
  var r = await api('put', '/api/notebook/notes/' + n1.id, a).send({ body: '# 점검\n- [x] 센서 확인', baseRev: 1 });
  expect(r.status).toBe(200);
  expect(r.body.data.rev).toBe(2);
  var c = await api('put', '/api/notebook/notes/' + n1.id, a).send({ body: '옛 창에서 고침', baseRev: 1 });
  expect(c.status).toBe(409);
  expect(c.body.data.body).toContain('[x] 센서');
  var f = await api('put', '/api/notebook/notes/' + n1.id, a).send({ body: '옛 창에서 고침', baseRev: 1, force: true });
  expect(f.body.data.rev).toBe(3);
  // 고정 · 즐겨찾기는 rev 를 올리지 않음 (다른 창 편집과 엇갈리지 않게)
  var p = await api('put', '/api/notebook/notes/' + n1.id, a).send({ pinned: true, starred: true });
  expect(p.body.data).toMatchObject({ pinned: true, starred: true, rev: 3 });
});

test('고친 기록 — 고치기 전 모습이 남고 · 이름 붙여 남기기 · 되돌리기', async function () {
  var v = await api('get', '/api/notebook/notes/' + n1.id + '/versions', a);
  expect(v.body.data.length).toBe(1);   // 10분 안 연속 고침은 한 번만
  var one = await api('get', '/api/notebook/notes/' + n1.id + '/versions/' + v.body.data[0].id, a);
  expect(one.body.data.body).toContain('**중요** 내용');
  var named = await api('post', '/api/notebook/notes/' + n1.id + '/versions', a).send({ label: '고객 전달본' });
  expect(named.status).toBe(201);
  var back = await api('post', '/api/notebook/notes/' + n1.id + '/versions/' + v.body.data[0].id + '/restore', a);
  expect(back.body.data.body).toContain('**중요** 내용');
  var after = await api('get', '/api/notebook/notes/' + n1.id + '/versions', a);
  expect(after.body.data.map(function (x) { return x.label; })).toEqual(expect.arrayContaining(['고객 전달본', '되돌리기 전']));
  expect((await api('get', '/api/notebook/notes/' + n1.id + '/versions', b)).status).toBe(404);
});

test('폴더 · 목록 보기 (모든 · 고정 · 폴더 · 태그 · 찾기 · 낙서장) · 개수', async function () {
  var f = await api('post', '/api/notebook/folders', a).send({ name: '고객 미팅', color: '#16a34a' });
  expect(f.status).toBe(201);
  fld = f.body.data.id;
  await api('put', '/api/notebook/notes/' + n1.id, a).send({ folderId: fld });
  var n2 = (await api('post', '/api/notebook/notes', a).send({ title: '', body: '견적 회신 메모 https://a.com', inbox: true, source: 'quick' })).body.data;
  expect(n2.source).toBe('quick');
  expect((await api('put', '/api/notebook/notes/' + n2.id, a).send({ folderId: 'nbf-없음' })).status).toBe(400);
  var all = (await api('get', '/api/notebook/notes?view=all', a)).body.data.map(function (x) { return x.id; });
  expect(all).toEqual([n1.id]);   // 낙서장은 '모든 노트' 에 안 섞임
  expect((await api('get', '/api/notebook/notes?view=inbox', a)).body.data.map(function (x) { return x.id; })).toEqual([n2.id]);
  expect((await api('get', '/api/notebook/notes?view=folder&folder=' + fld, a)).body.data.length).toBe(1);
  expect((await api('get', '/api/notebook/notes?view=tagged&tag=' + encodeURIComponent('설비'), a)).body.data.length).toBe(1);
  var s = (await api('get', '/api/notebook/notes?view=search&q=' + encodeURIComponent('견적'), a)).body.data;
  expect(s.length).toBe(1);
  expect(s[0].hit).toContain('견적');
  expect((await api('get', '/api/notebook/notes?view=search&q=' + encodeURIComponent('견적'), b)).body.data.length).toBe(0);
  var m = (await api('get', '/api/notebook/meta', a)).body.data;
  expect(m.counts).toMatchObject({ all: 1, inbox: 1, pinned: 1, starred: 1, trash: 0 });
  expect(m.folders[0]).toMatchObject({ name: '고객 미팅', n: 1 });
  expect(m.tags.map(function (t) { return t.tag; })).toEqual(expect.arrayContaining(['점검', '설비']));
  // 폴더를 지우면 노트는 남고 폴더만 빠짐
  await api('delete', '/api/notebook/folders/' + fld, a);
  expect((await api('get', '/api/notebook/notes/' + n1.id, a)).body.data.folderId).toBeNull();
});

test('휴지통 — 옮기기 · 되살리기 · 영구 삭제 · 비우기 · 사본', async function () {
  var d = (await api('post', '/api/notebook/notes/' + n1.id + '/duplicate', a)).body.data;
  expect(d.title).toBe('설비 점검 (사본)');
  await api('delete', '/api/notebook/notes/' + d.id, a);
  expect((await api('get', '/api/notebook/notes?view=trash', a)).body.data.map(function (x) { return x.id; })).toEqual([d.id]);
  await api('post', '/api/notebook/notes/' + d.id + '/restore', a);
  expect((await api('get', '/api/notebook/notes?view=trash', a)).body.data.length).toBe(0);
  await api('delete', '/api/notebook/notes/' + d.id, a);
  var pg = await api('delete', '/api/notebook/notes/' + d.id + '?purge=1', a);
  expect(pg.body.data.purged).toBe(true);
  expect((await api('get', '/api/notebook/notes/' + d.id, a)).status).toBe(404);
  var e = (await api('post', '/api/notebook/notes', a).send({ body: '버릴 것' })).body.data;
  await api('delete', '/api/notebook/notes/' + e.id, a);
  expect((await api('post', '/api/notebook/trash/empty', a)).body.data.n).toBe(1);
});

test('손글씨(ink) 저장 · 목록에 ✍️ · 첨부 받기는 본인만', async function () {
  var ink = { blocks: { k1: { h: 300, s: [{ t: 'pen', c: '#000', w: 4, p: [1, 2, 50, 3, 4, 60] }] } } };
  var r = await api('put', '/api/notebook/notes/' + n1.id, a).send({ body: '그림\n::ink[k1]', ink: ink });
  expect(r.status).toBe(200);
  expect((await api('get', '/api/notebook/notes/' + n1.id, a)).body.data.ink.blocks.k1.s[0].p).toEqual([1, 2, 50, 3, 4, 60]);
  var l = (await api('get', '/api/notebook/notes?view=all', a)).body.data.filter(function (x) { return x.id === n1.id; })[0];
  expect(l.hasInk).toBe(true);
  var up = await api('post', '/api/notebook/files?name=' + encodeURIComponent('사진.png') + '&noteId=' + n1.id, a).set('Content-Type', 'image/png').send(Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  expect(up.status).toBe(201);
  var fid = up.body.data.id;
  var g = await api('get', '/api/notebook/files/' + fid, a);
  expect(g.status).toBe(200);
  expect(g.headers['content-type']).toContain('image/png');
  expect((await api('get', '/api/notebook/files/' + fid, b)).status).toBe(404);
  expect((await api('post', '/api/notebook/files?name=x.exe', a).set('Content-Type', 'application/octet-stream').send(Buffer.from('MZ'))).status).toBe(400);
  await api('put', '/api/notebook/notes/' + n1.id, a).send({ body: '![사진](nbf:' + fid + ')\n그림' });
  var l2 = (await api('get', '/api/notebook/notes?view=all', a)).body.data.filter(function (x) { return x.id === n1.id; })[0];
  expect(l2.thumb).toBe(fid);
});

test('📅 일일 노트 목록 · 데이터로 채운 일일 업무 양식', async function () {
  await api('put', '/api/my-work/notes', a).send({ date: '2026-11-02', ref: '', body: '오늘 메모\n- [x] 견적 ⟦todo-1⟧' });
  var d = (await api('get', '/api/notebook/daily', a)).body.data;
  expect(d[0]).toMatchObject({ date: '2026-11-02', ref: '' });
  expect(d[0].snippet).not.toContain('⟦');
  expect((await api('get', '/api/notebook/daily', b)).body.data.length).toBe(0);
  expect((await api('get', '/api/notebook/meta', a)).body.data.counts.daily).toBe(1);
  await db.query("INSERT INTO my_todos (id, tenant_id, user_id, title, due_date, priority) VALUES ($1, $2, $3, '도면 검토', '2026-11-02', 2)", ['todo-nb-' + S, h.TEST_TENANT_ID, a.user.id]);
  var t = (await api('get', '/api/notebook/template/daily?date=2026-11-02', a)).body.data;
  expect(t.title).toContain('11/02');
  expect(t.body).toContain('## 🎯 오늘 할 일');
  expect(t.body).toContain('도면 검토');
  await db.query('DELETE FROM my_todos WHERE id = $1', ['todo-nb-' + S]);
});

test('낙서장 lib(텔레그램 /memo · 메신저) · 통합 검색에 노트북도', async function () {
  var n = await nbLib.addInbox(h.TEST_TENANT_ID, a.user.id, '텔레그램 메모 — 출하 일정 확인', 'telegram');
  expect(n.inbox).toBe(true);
  expect(nbLib.titleFrom('## 제목줄\n본문')).toBe('제목줄');
  var s = await api('get', '/api/search?q=' + encodeURIComponent('출하 일정'), a);
  expect(s.status).toBe(200);
  var notes = (s.body.data || s.body.results || []);
  var flat = JSON.stringify(s.body);
  expect(flat).toContain(n.id);
  expect(JSON.stringify((await api('get', '/api/search?q=' + encodeURIComponent('출하 일정'), b)).body)).not.toContain(n.id);
  void notes;
});

test('AI 글 도구 — 프롬프트 · 메일 제목 나누기 · 빈 글 거절', async function () {
  expect(nbLib.aiPrompt('mail', '납기 지연', { tone: 'brief', to: '구매팀' })).toContain('구매팀');
  expect(nbLib.aiPrompt('translate', 'x', { lang: 'ja' })).toContain('일본어');
  expect(nbLib.aiPrompt('nope', 'x')).toBeNull();
  expect(nbLib.parseMail('제목: 납기 안내\n\n안녕하세요.\n본문')).toEqual({ subject: '납기 안내', body: '안녕하세요.\n본문' });
  expect(nbLib.parseMail('**Subject: Delivery**\n\nHello')).toEqual({ subject: 'Delivery', body: 'Hello' });
  expect((await api('post', '/api/notebook/ai', a).send({ action: 'mail', text: '' })).status).toBe(400);
  expect((await api('post', '/api/notebook/ai', a).send({ action: 'nope', text: 'x' })).status).toBe(400);
});
