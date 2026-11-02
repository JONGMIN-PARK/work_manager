/**
 * 📓 노트북 v13.317 (공유 · [[노트]] · 가리키는 노트 · 업무 칩 · 리포트) · v13.318 (✍️ 코치 기록 · 통계 · AI 답 읽기)
 */
var h = require('./helpers');
var db = h.db;
var S = Date.now();
var nbLib = require('../lib/notebook');
var a, b, c;
function api(m, u, who) { return h.request(h.app)[m](u).set('Authorization', 'Bearer ' + who.token); }
var PID = 'nbp-' + S, ISS = 'nbi-' + S;

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('nb317-' + S);
  a = await h.createTestUser({ email: 'nb3-a-' + S + '@test.com', role: 'member', name: '가노트' });
  b = await h.createTestUser({ email: 'nb3-b-' + S + '@test.com', role: 'member', name: '나노트' });
  c = await h.createTestUser({ email: 'nb3-c-' + S + '@test.com', role: 'member', name: '다노트' });
  await db.query("INSERT INTO projects (id, name, status, progress, owner_id, visibility, tenant_id, start_date, end_date) VALUES ($1, '노트 장비', 'active', 40, $2, 'private', $3, '2026-10-01', '2026-12-31')", [PID, a.user.id, h.TEST_TENANT_ID]);
  await db.query("INSERT INTO issues (id, project_id, urgency, status, report_date, title, reporter_id, assignees, tags, created_by, updated_by, tenant_id) VALUES ($1,$2,'urgent','open','2026-11-01','모터 소음',$3,'[]','[]',$3,$3,$4)", [ISS, PID, a.user.id, h.TEST_TENANT_ID]);
});
afterAll(async function () { await h.cleanup(); });

var n1, n2;
test('[[노트]] 제목 목록 · 가리키는 노트(제목 · wm:note)', async function () {
  n1 = (await api('post', '/api/notebook/notes', a).send({ title: '센서 사양', body: '사양 정리' })).body.data;
  n2 = (await api('post', '/api/notebook/notes', a).send({ title: '설치 계획', body: '먼저 [[센서 사양]] 을 보고\n[참고](wm:note:' + n1.id + ')' })).body.data;
  await api('post', '/api/notebook/notes', a).send({ title: '다른 글', body: '[[센서 사양|사양서]] 참고' });
  var t = (await api('get', '/api/notebook/titles', a)).body.data.map(function (x) { return x.title; });
  expect(t).toEqual(expect.arrayContaining(['센서 사양', '설치 계획', '다른 글']));
  expect((await api('get', '/api/notebook/titles', b)).body.data.length).toBe(0);
  var bl = (await api('get', '/api/notebook/notes/' + n1.id + '/backlinks', a)).body.data;
  expect(bl.map(function (x) { return x.title; }).sort()).toEqual(['다른 글', '설치 계획']);
  expect(bl[0].ctx.length).toBeGreaterThan(0);
  expect((await api('get', '/api/notebook/notes/' + n1.id + '/backlinks', b)).status).toBe(404);
});

test('🔗 업무 칩 상태 — 권한 그대로 (볼 수 없으면 locked)', async function () {
  var todo = await api('post', '/api/my-work/todos', a).send({ title: '도면 확인', dueDate: '2026-11-20' });
  var refs = [{ t: 'project', id: PID }, { t: 'issue', id: ISS }, { t: 'todo', id: todo.body.data.id }, { t: 'note', id: n1.id }, { t: 'issue', id: 'nope' }];
  var r = (await api('post', '/api/notebook/refs', a).send({ refs: refs })).body.data;
  expect(r['project:' + PID]).toMatchObject({ title: '노트 장비', progress: 40 });
  expect(r['issue:' + ISS]).toMatchObject({ title: '모터 소음', status: 'open', urgency: 'urgent', done: false });
  expect(r['todo:' + todo.body.data.id]).toMatchObject({ title: '도면 확인', done: false });
  expect(r['note:' + n1.id].title).toBe('센서 사양');
  expect(r['issue:nope']).toEqual({ missing: true });
  var rb = (await api('post', '/api/notebook/refs', b).send({ refs: refs })).body.data;
  expect(rb['project:' + PID]).toEqual({ locked: true });   // 비공개 프로젝트 — 남은 못 봄
  expect(rb['issue:' + ISS]).toEqual({ locked: true });
  expect(rb['todo:' + todo.body.data.id]).toEqual({ missing: true });   // 남의 할 일은 없는 것으로
  expect(rb['note:' + n1.id]).toEqual({ missing: true });
});

test('👥 공유 — 읽기 전용 · 목록 · 첨부 · 메신저 카드 · 끄기', async function () {
  var up = await api('post', '/api/notebook/files?name=p.png', a).set('Content-Type', 'image/png').send(Buffer.from([1, 2, 3]));
  var fid = up.body.data.id;
  await api('put', '/api/notebook/notes/' + n1.id, a).send({ body: '사양 정리\n![p](nbf:' + fid + ')' });
  expect((await api('get', '/api/notebook/notes/' + n1.id, b)).status).toBe(404);
  expect((await api('get', '/api/notebook/files/' + fid, b)).status).toBe(404);
  var s = await api('put', '/api/notebook/notes/' + n1.id + '/shares', a).send({ userIds: [b.user.id, a.user.id, 'x'], message: '봐 주세요' });
  expect(s.body.data).toMatchObject({ userIds: [b.user.id], added: 1 });
  var g = (await api('get', '/api/notebook/notes/' + n1.id, b)).body.data;
  expect(g).toMatchObject({ readOnly: true, ownerName: '가노트', title: '센서 사양' });
  expect((await api('get', '/api/notebook/files/' + fid, b)).status).toBe(200);
  expect((await api('put', '/api/notebook/notes/' + n1.id, b).send({ body: '고침' })).status).toBe(404);   // 고치기는 안 됨
  var list = (await api('get', '/api/notebook/notes?view=shared', b)).body.data;
  expect(list.map(function (x) { return x.id; })).toEqual([n1.id]);
  expect((await api('get', '/api/notebook/meta', b)).body.data.counts.shared).toBe(1);
  expect((await api('get', '/api/notebook/notes/' + n1.id, a)).body.data.shareN).toBe(1);
  expect((await api('get', '/api/notebook/notes/' + n1.id + '/shares', a)).body.data.map(function (x) { return x.name; })).toEqual(['나노트']);
  // 메신저 1:1 에 노트 카드
  var msg = await db.query("SELECT m.body, m.cards FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id WHERE r.tenant_id = $1 AND m.user_id = $2 ORDER BY m.id DESC LIMIT 1", [h.TEST_TENANT_ID, a.user.id]);
  expect(msg.rows[0].body).toContain('봐 주세요');
  expect(msg.rows[0].cards[0]).toMatchObject({ type: 'note', id: n1.id, nav: { nbId: n1.id } });
  // 다시 저장해도 이미 받은 사람에게는 또 알리지 않음
  expect((await api('put', '/api/notebook/notes/' + n1.id + '/shares', a).send({ userIds: [b.user.id, c.user.id] })).body.data.added).toBe(1);
  await api('put', '/api/notebook/notes/' + n1.id + '/shares', a).send({ userIds: [] });
  expect((await api('get', '/api/notebook/notes/' + n1.id, b)).status).toBe(404);
  expect((await api('put', '/api/notebook/notes/' + n1.id + '/shares', b).send({ userIds: [c.user.id] })).status).toBe(404);
});

test('📊 리포트 — 그대로 모으기 (기간 · 폴더 · 일일 노트) · 빈 기간 · AI 프롬프트', async function () {
  var today = nbLib.kstToday();
  await api('put', '/api/my-work/notes', a).send({ date: today, ref: '', body: '오늘 메모 ⟦todo-x⟧' });
  var r = await api('post', '/api/notebook/report', a).send({ from: today, to: today, style: 'raw', daily: true });
  expect(r.status).toBe(200);
  expect(r.body.data.count).toBe(4);
  expect(r.body.data.body).toContain('### 센서 사양');
  expect(r.body.data.body).toContain('일일 노트');
  expect(r.body.data.body).not.toContain('⟦');
  var f = (await api('post', '/api/notebook/folders', a).send({ name: '현장' })).body.data;
  await api('put', '/api/notebook/notes/' + n2.id, a).send({ folderId: f.id });
  var rf = (await api('post', '/api/notebook/report', a).send({ from: today, to: today, folderId: f.id, daily: true })).body.data;
  expect(rf.count).toBe(1);   // 폴더를 고르면 일일 노트는 안 섞음
  expect((await api('post', '/api/notebook/report', a).send({ from: '2020-01-01', to: '2020-01-02' })).status).toBe(400);
  expect((await api('post', '/api/notebook/report', a).send({ from: today, to: '2020-01-01' })).status).toBe(400);
  expect(nbLib.reportPrompt('weekly', 'x', { from: today, to: today })).toContain('[개발]');
  expect(nbLib.reportPrompt('raw', 'x', {})).toBeNull();
});

test('✍️ 코치 기록 · 📈 통계 · AI 답 읽기', async function () {
  expect((await api('post', '/api/notebook/coach', a).send({ text: '짧음' })).status).toBe(400);
  var l = await api('post', '/api/notebook/coach/log', a).send({ noteId: n1.id, kind: 'meeting', counts: { long: 2, filler: 3, bad: -1 }, scores: { clarity: 70, concise: 60, structure: 80, evidence: 50, total: 65 }, chars: 900 });
  expect(l.status).toBe(200);
  await api('post', '/api/notebook/coach/log', a).send({ noteId: n1.id, kind: 'meeting', counts: { long: 1 }, scores: { total: 75 }, chars: 950 });   // 같은 날 · 같은 노트 → 덮어씀
  await api('post', '/api/notebook/coach/log', a).send({ noteId: 'weekly-2026-11-02', kind: 'weekly', counts: { vague: 4 }, scores: { total: 55 }, chars: 400 });
  var st = (await api('get', '/api/notebook/coach/stats', a)).body.data;
  expect(st.weeks.length).toBe(1);
  expect(st.weeks[0]).toMatchObject({ n: 2, chars: 1350, total: 65 });
  var hb = {}; st.habits.forEach(function (x) { hb[x.k] = x.now; });
  expect(hb).toEqual({ long: 1, vague: 4 });
  expect((await api('get', '/api/notebook/coach/stats', b)).body.data.weeks.length).toBe(0);
  var p = nbLib.parseCoach('```json\n{"scores":{"clarity":80,"concise":"70","structure":200,"evidence":null},"summary":"좋음","items":[{"quote":"사양 정리","issue":"모호","why":"w","hint":"h","example":"e"},{"quote":"없는 말","issue":"x"}],"task":"결론 먼저"}\n```', '사양 정리 끝');
  expect(p.scores).toEqual({ clarity: 80, concise: 70, structure: 100, evidence: null, total: 83 });
  expect(p.items.map(function (x) { return x.found; })).toEqual([true, false]);
  expect(p.task).toBe('결론 먼저');
  expect(nbLib.parseCoach('엉뚱한 답', 'x')).toBeNull();
  expect(nbLib.coachPrompt('글', 'meeting', ['긴 문장: 92자'])).toContain('회의록');
});
