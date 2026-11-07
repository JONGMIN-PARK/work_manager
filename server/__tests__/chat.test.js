/**
 * 💬 사내 메신저 (v13.315) — 방 · 권한 · 읽음 · 멘션 · 답글 · 공감 · 공지 · 전달 · 파일 · 카드 버튼 · 명령 · 프로젝트 현황 · 찾기 · 실시간
 */
process.env.CHAT_FALLBACK_MS = '200';
var h = require('./helpers');
var db = h.db;
var T = h.TEST_TENANT_ID;
var S = Date.now();
var hub = require('../lib/chat-hub');
var a, b, c, x;   // x = 다른 테넌트 사람이 아니라 방 밖 사람
function api(m, u, who) { return h.request(h.app)[m](u).set('Authorization', 'Bearer ' + who.token); }
var PID = 'chp-' + S, ISS = 'chi-' + S;

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('chat-' + S);
  a = await h.createTestUser({ email: 'ch-a-' + S + '@test.com', role: 'admin', name: '가나다' });
  b = await h.createTestUser({ email: 'ch-b-' + S + '@test.com', role: 'member', name: '라마바' });
  c = await h.createTestUser({ email: 'ch-c-' + S + '@test.com', role: 'member', name: '사아자' });
  x = await h.createTestUser({ email: 'ch-x-' + S + '@test.com', role: 'member', name: '차카타' });
  await db.query("INSERT INTO projects (id, name, status, progress, owner_id, visibility, tenant_id, start_date, end_date) VALUES ($1, '메신저 장비', 'active', 35, $2, 'private', $3, '2026-10-01', '2026-12-31')", [PID, a.user.id, T]);
  await db.query('INSERT INTO project_members (project_id, user_id, tenant_id) VALUES ($1, $2, $3)', [PID, b.user.id, T]).catch(function () {});
  await db.query("INSERT INTO issues (id, project_id, urgency, status, report_date, title, reporter_id, assignees, tags, created_by, updated_by, tenant_id) VALUES ($1,$2,'normal','open','2026-11-01','센서 오류',$3,'[]','[]',$3,$3,$4)", [ISS, PID, a.user.id, T]);
});
afterAll(async function () {
  await db.query('DELETE FROM my_todos WHERE tenant_id = $1', [T]).catch(function () {});
  await h.cleanup();
});

var dm, grp, prj;
test('1:1 방 — 같은 두 사람은 늘 같은 방 · 자기 자신 · 없는 사람 안 됨', async function () {
  var r1 = await api('post', '/api/chat/rooms', a).send({ kind: 'dm', userId: b.user.id });
  var r2 = await api('post', '/api/chat/rooms', b).send({ kind: 'dm', userId: a.user.id });
  expect(r1.status).toBe(201);
  expect(r2.body.data.id).toBe(r1.body.data.id);
  dm = r1.body.data.id;
  expect((await api('post', '/api/chat/rooms', a).send({ kind: 'dm', userId: a.user.id })).status).toBe(400);
});

test('보내기 · 받기 · 안 읽음 · 읽음 · 방 밖 사람은 못 봄', async function () {
  var s = await api('post', '/api/chat/rooms/' + dm + '/messages', a).send({ body: '안녕하세요 @라마바' });
  expect(s.status).toBe(201);
  expect(s.body.data.mentions).toEqual([b.user.id]);
  var rooms = await api('get', '/api/chat/rooms', b);
  var r = rooms.body.data.filter(function (x) { return x.id === dm; })[0];
  expect(r).toMatchObject({ kind: 'dm', name: '가나다', unread: 1, mentioned: 1 });
  expect((await api('get', '/api/chat/unread-count', b)).body.count).toBe(1);
  var rd = await api('post', '/api/chat/rooms/' + dm + '/read', b).send({ lastId: s.body.data.id });
  expect(rd.body.data.lastReadId).toBe(s.body.data.id);
  expect((await api('get', '/api/chat/unread-count', b)).body.count).toBe(0);
  expect((await api('get', '/api/chat/rooms/' + dm + '/messages', x)).status).toBe(403);
  var ms = await api('get', '/api/chat/rooms/' + dm + '/messages', b);
  expect(ms.body.data.map(function (m) { return m.body; })).toEqual(['안녕하세요 @라마바']);
  expect(ms.body.reads.filter(function (q) { return q.userId === b.user.id; })[0].id).toBe(s.body.data.id);
});

test('그룹 · 답글 줄기 · 수정 · 지우기(내 것만) · 공감 · 공지 · 전달', async function () {
  var g = await api('post', '/api/chat/rooms', a).send({ kind: 'group', name: '설비팀', userIds: [b.user.id, c.user.id] });
  grp = g.body.data.id;
  var p = await api('post', '/api/chat/rooms/' + grp + '/messages', a).send({ body: '내일 점검합니다' });
  var r1 = await api('post', '/api/chat/rooms/' + grp + '/messages', b).send({ body: '몇 시요?', replyTo: p.body.data.id });
  var r2 = await api('post', '/api/chat/rooms/' + grp + '/messages', c).send({ body: '저도요', replyTo: r1.body.data.id });   // 답글의 답글 → 같은 줄기
  expect(r2.body.data.replyTo).toBe(p.body.data.id);
  var top = await api('get', '/api/chat/rooms/' + grp + '/messages', c);
  var parent = top.body.data.filter(function (m) { return m.id === p.body.data.id; })[0];
  expect(parent.replies).toBe(2);
  expect(top.body.data.some(function (m) { return m.body === '몇 시요?'; })).toBe(false);   // 답글은 줄기에만
  var th = await api('get', '/api/chat/rooms/' + grp + '/messages?thread=' + p.body.data.id, c);
  expect(th.body.data.map(function (m) { return m.body; })).toEqual(['내일 점검합니다', '몇 시요?', '저도요']);
  expect((await api('put', '/api/chat/messages/' + p.body.data.id, b).send({ body: '바꿈' })).status).toBe(403);
  var ed = await api('put', '/api/chat/messages/' + r1.body.data.id, b).send({ body: '몇 시예요?' });
  expect(ed.body.data).toMatchObject({ body: '몇 시예요?', edited: true });
  var rx = await api('post', '/api/chat/messages/' + p.body.data.id + '/react', c).send({ emoji: '👍' });
  expect(rx.body.data.reactions).toEqual({ '👍': [c.user.id] });
  rx = await api('post', '/api/chat/messages/' + p.body.data.id + '/react', c).send({ emoji: '👍' });
  expect(rx.body.data.reactions).toBeNull();
  expect((await api('post', '/api/chat/messages/' + p.body.data.id + '/react', c).send({ emoji: '💩' })).status).toBe(400);
  await api('post', '/api/chat/rooms/' + grp + '/notice', b).send({ messageId: p.body.data.id });
  expect((await api('get', '/api/chat/rooms/' + grp, c)).body.data.notice.body).toBe('내일 점검합니다');
  var fw = await api('post', '/api/chat/messages/' + p.body.data.id + '/forward', a).send({ roomIds: [dm] });
  expect(fw.body.data.sent).toBe(1);
  var dl = await api('delete', '/api/chat/messages/' + r2.body.data.id, c);
  expect(dl.body.data).toMatchObject({ deleted: true, body: '' });
  var lv = await api('delete', '/api/chat/rooms/' + grp + '/members/me', c);
  expect(lv.status).toBe(200);
  expect((await api('get', '/api/chat/rooms/' + grp + '/messages', c)).status).toBe(403);
});

test('파일 — 올리기(DB 저장) · 받기 · 방 밖 못 받음 · 실행 파일 막음 · 파일 모음', async function () {
  var up = await api('post', '/api/chat/rooms/' + dm + '/files?name=' + encodeURIComponent('도면.txt') + '&caption=' + encodeURIComponent('확인 부탁'), a).set('Content-Type', 'text/plain').send(Buffer.from('hello 도면'));
  expect(up.status).toBe(201);
  expect(up.body.data).toMatchObject({ kind: 'file', body: '확인 부탁' });
  expect(up.body.data.file).toMatchObject({ name: '도면.txt', size: Buffer.byteLength('hello 도면') });
  var g = await api('get', '/api/chat/files/' + up.body.data.file.id, b);
  expect(g.status).toBe(200);
  expect(g.text || (g.body && g.body.toString())).toBe('hello 도면');
  expect((await api('get', '/api/chat/files/' + up.body.data.file.id, x)).status).toBe(403);
  expect((await api('post', '/api/chat/rooms/' + dm + '/files?name=run.exe', a).set('Content-Type', 'application/octet-stream').send(Buffer.from('MZ'))).status).toBe(400);
  var list = await api('get', '/api/chat/rooms/' + dm + '/files', b);
  expect(list.body.data[0].name).toBe('도면.txt');
});

test('프로젝트 방 — 볼 수 있으면 들어옴 · 못 보면 403 · 옆 현황 · /issue · 카드 버튼으로 상태', async function () {
  expect((await api('post', '/api/chat/rooms', x).send({ kind: 'project', projectId: PID })).status).toBe(403);
  var pr = await api('post', '/api/chat/rooms', b).send({ kind: 'project', projectId: PID });
  expect(pr.status).toBe(201);
  prj = pr.body.data.id;
  var info = await api('get', '/api/chat/rooms/' + prj, a);
  expect(info.body.data.members.map(function (m) { return m.name; }).sort()).toEqual(['가나다', '라마바']);
  var ctx = await api('get', '/api/chat/rooms/' + prj + '/context', a);
  expect(ctx.body.data.project).toMatchObject({ name: '메신저 장비', progress: 35 });
  expect(ctx.body.data.issues.open).toBe(1);
  expect(ctx.body.data.issues.top[0].title).toBe('센서 오류');
  // 이슈 카드를 붙여 보냄 → 서버가 지금 상태로
  var cd = await api('post', '/api/chat/rooms/' + prj + '/messages', a).send({ body: '이거 봐 주세요', cards: [{ type: 'issue', id: ISS, title: '아무거나' }] });
  expect(cd.body.data.cards[0]).toMatchObject({ type: 'issue', id: ISS, title: '센서 오류', status: 'open' });
  var act = await api('post', '/api/chat/messages/' + cd.body.data.id + '/action', b).send({ card: 0, action: 'inProgress' });
  expect(act.status).toBe(200);
  expect(act.body.data.cards[0].status).toBe('inProgress');
  expect((await db.query('SELECT status FROM issues WHERE id = $1', [ISS])).rows[0].status).toBe('inProgress');
  // /issue
  var ni = await api('post', '/api/chat/rooms/' + prj + '/messages', b).send({ body: '/issue 진공 펌프 소음 !' });
  expect(ni.status).toBe(201);
  expect(ni.body.data.cards[0]).toMatchObject({ type: 'issue', title: '진공 펌프 소음', urgency: 'urgent' });
  expect((await db.query('SELECT urgency, project_id FROM issues WHERE id = $1', [ni.body.data.cards[0].id])).rows[0]).toMatchObject({ urgency: 'urgent', project_id: PID });
  // /issue 는 프로젝트 방에서만
  var no = await api('post', '/api/chat/rooms/' + dm + '/messages', a).send({ body: '/issue 아무거나' });
  expect(no.body.data).toMatchObject({ kind: 'system' });
});

test('/todo → 내 할 일 + 카드 · 모르는 명령은 그냥 글', async function () {
  var r = await api('post', '/api/chat/rooms/' + dm + '/messages', b).send({ body: '/todo 견적서 회신' });
  expect(r.body.data.cards[0]).toMatchObject({ type: 'todo', title: '견적서 회신' });
  expect((await db.query('SELECT user_id FROM my_todos WHERE id = $1', [r.body.data.cards[0].id])).rows[0].user_id).toBe(b.user.id);
  var t = await api('post', '/api/chat/rooms/' + dm + '/messages', b).send({ body: '/없는명령 그대로' });
  expect(t.body.data).toMatchObject({ kind: 'text', body: '/없는명령 그대로' });
});

test('찾기 — 내가 들어간 방만', async function () {
  var r = await api('get', '/api/chat/search?q=' + encodeURIComponent('점검'), b);
  expect(r.body.data.length).toBeGreaterThan(0);
  expect((await api('get', '/api/chat/search?q=' + encodeURIComponent('점검'), x)).body.data).toEqual([]);
});

test('실시간 — 방 멤버에게만 msg 이벤트 · 화면 공유 신호는 지정한 사람에게', async function () {
  var got = { a: [], x: [] };
  function fake(k) { return { write: function (s) { got[k].push(s); } }; }
  var offA = hub.add(a.user.id, fake('a')), offX = hub.add(x.user.id, fake('x'));
  await api('post', '/api/chat/rooms/' + dm + '/messages', b).send({ body: '실시간 확인' });
  await api('post', '/api/chat/rooms/' + dm + '/rtc', b).send({ type: 'offer', to: a.user.id, sid: 's1', data: { sdp: 'x' } });
  offA(); offX();
  expect(got.a.some(function (s) { return /event: msg/.test(s) && /실시간 확인/.test(s); })).toBe(true);
  expect(got.a.some(function (s) { return /event: rtc/.test(s) && /"offer"/.test(s); })).toBe(true);
  expect(got.x.length).toBe(0);
});

test('못 본 1:1 메시지 → 잠시 뒤 알림 (읽었으면 안 감)', async function () {
  await db.query("DELETE FROM in_app_notifications WHERE user_id = $1", [a.user.id]).catch(function () {});
  var s = await api('post', '/api/chat/rooms/' + dm + '/messages', b).send({ body: '확인 부탁드려요' });
  await new Promise(function (r) { setTimeout(r, 600); });
  var n = await db.query("SELECT title, body FROM in_app_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [a.user.id]);
  expect(n.rows[0].body).toMatch(/확인 부탁드려요/);
  await api('post', '/api/chat/rooms/' + dm + '/read', a).send({ lastId: s.body.data.id + 100 });
  await db.query("DELETE FROM in_app_notifications WHERE user_id = $1", [a.user.id]);
  await api('post', '/api/chat/rooms/' + dm + '/messages', b).send({ body: '두 번째' });
  await api('post', '/api/chat/rooms/' + dm + '/read', a).send({ lastId: 99999999 });
  await new Promise(function (r) { setTimeout(r, 600); });
  expect((await db.query("SELECT COUNT(*)::int AS n FROM in_app_notifications WHERE user_id = $1", [a.user.id])).rows[0].n).toBe(0);
});

test('🖼 사진 칠판 (v13.356) — 표시 더하기 · 지우기 · 회전 · 자르기 · 다듬기 · 방 밖 사람 · 사진만 · 실시간', async function () {
  var png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  var up = await api('post', '/api/chat/rooms/' + dm + '/files?name=p.png', a).set('Content-Type', 'image/png').send(png);
  expect(up.status).toBe(201);
  var fid = up.body.data.file.id;
  var got = [], conn = { write: function (s) { got.push(s); }, on: function () {}, setHeader: function () {}, flushHeaders: function () {} };
  var off = hub.add(b.user.id, conn);
  var r = await api('post', '/api/chat/files/' + fid + '/annot', b).send({ add: [
    { id: 'x1', t: 'pen', c: '#ff0000', w: 3, p: [1, 2, 3, 4], by: 'someone-else' },
    { id: 'x2', t: 'text', c: 'red; background:url(x)', s: '  ', x: 1, y: 1 },     // 빈 글자 → 버림
    { id: 'x3', t: 'script', x: 1 },                                              // 모르는 종류 → 버림
    { id: 'x4', t: 'rect', c: '#00ff00', x: 0, y: 0, x2: 10, y2: 10, w: 9999 }
  ], rot: 91 });
  expect(r.status).toBe(200);
  expect(r.body.data).toMatchObject({ rot: 90, n: 2 });
  var g = await api('get', '/api/chat/files/' + fid + '/annot', a);
  expect(g.body.data.shapes.map(function (s) { return s.id; })).toEqual(['x1', 'x4']);
  expect(g.body.data.shapes[0].by).toBe(b.user.id);          // 누가 그렸는지는 서버가
  expect(g.body.data.shapes[1].w).toBe(200);                  // 굵기 한도
  expect(g.body.byName).toBe('라마바');
  await api('post', '/api/chat/files/' + fid + '/annot', a).send({ remove: ['x1'], crop: { x: 0, y: 0, w: 50, h: 40 } });
  var g2 = (await api('get', '/api/chat/files/' + fid + '/annot', b)).body.data;
  expect(g2.shapes.map(function (s) { return s.id; })).toEqual(['x4']);
  expect(g2.crop).toEqual({ x: 0, y: 0, w: 50, h: 40 });
  // 메시지 목록에 요약
  var ms = await api('get', '/api/chat/rooms/' + dm + '/messages', b);
  var fm = ms.body.data.filter(function (m) { return m.file && m.file.id === fid; })[0];
  expect(fm.file.annot).toEqual({ rot: 90, n: 1, crop: true });
  // 방 밖 사람 · 사진 아닌 파일
  expect((await api('post', '/api/chat/files/' + fid + '/annot', x).send({ add: [] })).status).toBe(403);
  expect((await api('get', '/api/chat/files/' + fid + '/annot', x)).status).toBe(403);
  expect((await api('post', '/api/chat/files/' + fid + '/cursor', x).send({ x: 1, y: 1 })).status).toBe(403);
  var txt = await api('post', '/api/chat/rooms/' + dm + '/files?name=t.txt', a).set('Content-Type', 'text/plain').send(Buffer.from('t'));
  expect((await api('post', '/api/chat/files/' + txt.body.data.file.id + '/annot', a).send({ add: [] })).status).toBe(400);
  // 실시간 — 받는 사람에게 바뀐 것만
  expect(got.join('')).toMatch(/event: annot\n/);
  await api('post', '/api/chat/files/' + fid + '/cursor', a).send({ x: 5, y: 6, live: [1, 2, 3, 4], lt: 'pen', c: '#123456', w: 2 });
  expect(got.join('')).toMatch(/event: annot-cur\n.*"x":5/);
  off();
  // 모두 지우기
  await api('post', '/api/chat/files/' + fid + '/annot', b).send({ clear: true });
  expect((await api('get', '/api/chat/files/' + fid + '/annot', a)).body.data.shapes).toEqual([]);
});
