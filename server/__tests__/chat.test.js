/**
 * 💬 사내 메신저 (v13.315) — 방 · 권한 · 읽음 · 멘션 · 답글 · 공감 · 공지 · 전달 · 파일 · 카드 버튼 · 명령 · 프로젝트 현황 · 찾기 · 실시간
 */
process.env.CHAT_FALLBACK_MS = '200';
process.env.CHAT_READ_MS = '100';
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

test('📌 게시판 · 🛠 요청함 (v13.358) — 글 · 상태 흐름 · 담당 · 고치기 권한 · 이슈로 · 방 밖 사람', async function () {
  var g = await api('post', '/api/chat/rooms', a).send({ kind: 'group', name: '장비-프로그램', userIds: [b.user.id, c.user.id] });
  var gid = g.body.data.id;
  expect((await api('post', '/api/chat/rooms/' + gid + '/posts', a).send({ cat: 'req', title: '' })).status).toBe(400);
  expect((await api('post', '/api/chat/rooms/' + gid + '/posts', a).send({ cat: 'req', title: 'x', assignee: x.user.id })).status).toBe(400);   // 방 밖 담당
  var p = await api('post', '/api/chat/rooms/' + gid + '/posts', a).send({ cat: 'req', title: 'PLC 통신 끊김', body: '현상: 10분마다 끊김\n```\nERR 0x21\n```', equip: '조립기 #3', urgency: 'urgent', assignee: b.user.id, due: '2026-11-10' });
  expect(p.status).toBe(201);
  var post = p.body.data;
  expect(post.kind).toBe('post');
  expect(post.post).toMatchObject({ title: 'PLC 통신 끊김', cat: 'req', status: 'open', equip: '조립기 #3', urgency: 'urgent', assignee: b.user.id, due: '2026-11-10' });
  expect(post.mentions).toEqual([b.user.id]);
  // 요청함
  var inbox = await api('get', '/api/chat/requests?open=1', b);
  expect(inbox.body.data.map(function (m) { return m.id; })).toContain(post.id);
  expect(inbox.body.data[0].roomName).toBe('장비-프로그램');
  expect((await api('get', '/api/chat/requests?who=mine', a)).body.data.map(function (m) { return m.id; })).toContain(post.id);
  expect((await api('get', '/api/chat/requests', x)).body.data.length).toBe(0);
  // 상태: 처리 중 → 완료 (방 사람 누구나) · 답글 줄기에 기록
  var s1 = await api('post', '/api/chat/messages/' + post.id + '/post', b).send({ status: 'doing' });
  expect(s1.body.data.post.status).toBe('doing');
  expect((await api('post', '/api/chat/messages/' + post.id + '/post', b).send({ status: 'solved' })).status).toBe(400);
  await api('post', '/api/chat/messages/' + post.id + '/post', c).send({ status: 'done' });
  var th = await api('get', '/api/chat/rooms/' + gid + '/messages?thread=' + post.id, a);
  expect(th.body.data.filter(function (m) { return m.kind === 'system'; }).map(function (m) { return m.body; }).join('|')).toMatch(/처리 중.*\|.*완료/);
  expect((await api('get', '/api/chat/requests?open=1', b)).body.data.map(function (m) { return m.id; })).not.toContain(post.id);
  // 고치기 — 쓴 사람만
  expect((await api('post', '/api/chat/messages/' + post.id + '/post', b).send({ title: '바꿈' })).status).toBe(403);
  var e1 = await api('post', '/api/chat/messages/' + post.id + '/post', a).send({ title: 'PLC 통신 끊김 (해결)', equip: '' });
  expect(e1.body.data.post).toMatchObject({ title: 'PLC 통신 끊김 (해결)', equip: null });
  // 방 밖 사람
  expect((await api('post', '/api/chat/messages/' + post.id + '/post', x).send({ status: 'open' })).status).toBe(403);
  expect((await api('get', '/api/chat/rooms/' + gid + '/posts', x)).status).toBe(403);
  // 목록 · 거르기 · 방 목록 미리보기
  await api('post', '/api/chat/rooms/' + gid + '/posts', c).send({ cat: 'qna', title: '펌웨어 버전?' });
  var all = await api('get', '/api/chat/rooms/' + gid + '/posts', a);
  expect(all.body.data.map(function (m) { return m.post.cat; })).toEqual(['qna', 'req']);
  expect((await api('get', '/api/chat/rooms/' + gid + '/posts?cat=req', a)).body.data.length).toBe(1);
  expect((await api('get', '/api/chat/rooms/' + gid + '/posts?open=1', a)).body.data.map(function (m) { return m.post.cat; })).toEqual(['qna']);
  var rl = (await api('get', '/api/chat/rooms', b)).body.data.filter(function (r) { return r.id === gid; })[0];
  expect(rl.last.body).toBe('📌 펌웨어 버전?');
  // 이슈로 — 프로젝트 방에서만
  expect((await api('post', '/api/chat/messages/' + post.id + '/post', a).send({ toIssue: true })).status).toBe(400);
});

test('📁 내 폴더 (v13.358) — 만들기 · 담기 · 보기 · 남은 못 봄 · 방에서 나가면 안 보임 · 지우기', async function () {
  var g = await api('post', '/api/chat/rooms', a).send({ kind: 'group', name: '폴더시험', userIds: [b.user.id] });
  var gid = g.body.data.id;
  var m1 = (await api('post', '/api/chat/rooms/' + gid + '/messages', a).send({ body: '배선도 최종본은 이것' })).body.data;
  expect((await api('post', '/api/chat/folders', b).send({ name: ' ' })).status).toBe(400);
  var f = (await api('post', '/api/chat/folders', b).send({ name: '조립기 자료', icon: '🛠' })).body.data;
  expect(f).toMatchObject({ name: '조립기 자료', icon: '🛠', n: 0 });
  expect((await api('post', '/api/chat/folders/' + f.id + '/items', b).send({ messageId: m1.id, note: '최종' })).status).toBe(201);
  expect((await api('post', '/api/chat/folders/' + f.id + '/items', b).send({ messageId: m1.id })).status).toBe(201);   // 두 번 담아도 하나
  var items = (await api('get', '/api/chat/folders/' + f.id + '/items', b)).body.data;
  expect(items.length).toBe(1);
  expect(items[0]).toMatchObject({ id: m1.id, body: '배선도 최종본은 이것', roomName: '폴더시험', savedNote: '최종' });
  expect((await api('get', '/api/chat/messages/' + m1.id + '/folders', b)).body.data).toEqual([f.id]);
  expect((await api('get', '/api/chat/folders', b)).body.data[0].n).toBe(1);
  // 남의 폴더 · 방 밖 메시지
  expect((await api('get', '/api/chat/folders/' + f.id + '/items', a)).status).toBe(404);
  expect((await api('post', '/api/chat/folders/' + f.id + '/items', a).send({ messageId: m1.id })).status).toBe(404);
  var fx = (await api('post', '/api/chat/folders', x).send({ name: '엿보기' })).body.data;
  expect((await api('post', '/api/chat/folders/' + fx.id + '/items', x).send({ messageId: m1.id })).status).toBe(403);
  // 이름 바꾸기 · 방에서 나가면 안 보임 · 빼기 · 폴더 지우기
  await api('put', '/api/chat/folders/' + f.id, b).send({ name: '조립기 #3' });
  expect((await api('get', '/api/chat/folders', b)).body.data[0].name).toBe('조립기 #3');
  await api('delete', '/api/chat/rooms/' + gid + '/members/me', b);
  expect((await api('get', '/api/chat/folders/' + f.id + '/items', b)).body.data.length).toBe(0);
  expect((await api('get', '/api/chat/folders', b)).body.data[0].n).toBe(0);
  await api('delete', '/api/chat/folders/' + f.id + '/items/' + m1.id, b);
  expect((await api('delete', '/api/chat/folders/' + f.id, b)).status).toBe(200);
  expect((await api('get', '/api/chat/folders', b)).body.data.length).toBe(0);
});

test('👥 참여자 (v13.359 · v13.375) — 초대해도 처음부터 다 봄 · 들어오기 전 대화 · 앞으로 읽기 · 방장 · 읽기만 · 내보내기', async function () {
  var g = (await api('post', '/api/chat/rooms', a).send({ kind: 'group', name: '참여자시험', userIds: [b.user.id] })).body.data.id;
  var old = (await api('post', '/api/chat/rooms/' + g + '/messages', a).send({ body: '예전 비밀 이야기' })).body.data;
  await api('post', '/api/chat/rooms/' + g + '/posts', a).send({ cat: 'req', title: '예전 요청', assignee: b.user.id });
  // v13.375 업무용 — '이전 대화 안 보여 주기'를 보내도 무시, 들어온 사람도 처음부터 다 봄
  await new Promise(function (r) { setTimeout(r, 30); });
  await api('post', '/api/chat/rooms/' + g + '/members', a).send({ userIds: [c.user.id], history: false });
  await api('post', '/api/chat/rooms/' + g + '/members', a).send({ userIds: [x.user.id] });
  var cm = (await api('get', '/api/chat/rooms/' + g + '/messages', c)).body.data.map(function (m) { return m.body; });
  expect(cm).toContain('예전 비밀 이야기');
  expect((await api('get', '/api/chat/rooms/' + g + '/posts', c)).body.data.length).toBe(1);
  expect((await api('get', '/api/chat/search?q=' + encodeURIComponent('예전 비밀'), c)).body.data.length).toBe(1);
  var info = (await api('get', '/api/chat/rooms/' + g, c)).body.data;
  expect(info).toMatchObject({ myRole: 'member', canManage: false, histFrom: null });
  expect(info.prior).toMatchObject({ n: 2 });   // 들어오기 전 대화 (글 · 게시판 글)
  expect(info.prior.upTo).toBeGreaterThanOrEqual(old.id);
  expect((await api('get', '/api/chat/rooms/' + g, a)).body.data.prior).toBeNull();   // 만든 사람은 들어오기 전 대화 없음
  // 앞으로 읽기 — after=0 은 오래된 순, more
  var fw = (await api('get', '/api/chat/rooms/' + g + '/messages?after=0&limit=2', c)).body;
  expect(fw.data.length).toBe(2); expect(fw.more).toBe(true);
  expect(fw.data[0].id).toBeLessThan(fw.data[1].id);
  var fw2 = (await api('get', '/api/chat/rooms/' + g + '/messages?after=' + fw.data[1].id + '&limit=200', c)).body;
  expect(fw2.data[0].id).toBeGreaterThan(fw.data[1].id); expect(fw2.more).toBe(false);
  // 들어오기 전 대화 정리 (AI 없으면 규칙)
  var pc = (await api('post', '/api/chat/rooms/' + g + '/catchup', c).send({ upTo: info.prior.upTo })).body.data;
  expect(pc.count).toBeGreaterThanOrEqual(2);
  var ia = (await api('get', '/api/chat/rooms/' + g, a)).body.data;
  expect(ia).toMatchObject({ myRole: 'owner', canManage: true });
  // 역할: 방장만 · 읽기만은 못 씀
  expect((await api('put', '/api/chat/rooms/' + g + '/members/' + c.user.id, b).send({ role: 'readonly' })).status).toBe(403);
  expect((await api('put', '/api/chat/rooms/' + g + '/members/' + c.user.id, a).send({ role: 'king' })).status).toBe(400);
  expect((await api('put', '/api/chat/rooms/' + g + '/members/' + c.user.id, a).send({ role: 'readonly' })).status).toBe(200);
  var ro = await api('post', '/api/chat/rooms/' + g + '/messages', c).send({ body: '써도 되나요' });
  expect(ro.status).toBe(403);
  expect(ro.body.error).toBe('READONLY');
  expect((await api('post', '/api/chat/rooms/' + g + '/posts', c).send({ cat: 'qna', title: 'q' })).status).toBe(403);
  expect((await api('get', '/api/chat/rooms/' + g + '/messages', c)).status).toBe(200);   // 읽기는 됨
  // 방장 넘기기 · 마지막 방장은 못 내림
  expect((await api('put', '/api/chat/rooms/' + g + '/members/' + a.user.id, a).send({ role: 'member' })).status).toBe(400);
  await api('put', '/api/chat/rooms/' + g + '/members/' + b.user.id, a).send({ role: 'owner' });
  expect((await api('put', '/api/chat/rooms/' + g + '/members/' + a.user.id, b).send({ role: 'member' })).status).toBe(200);
  expect((await api('get', '/api/chat/rooms/' + g, a)).body.data.canManage).toBe(true);   // a 는 관리자(admin)라 여전히
  // 내보내기
  expect((await api('delete', '/api/chat/rooms/' + g + '/members/' + x.user.id, c)).status).toBe(403);
  expect((await api('delete', '/api/chat/rooms/' + g + '/members/' + x.user.id, b)).status).toBe(200);
  expect((await api('get', '/api/chat/rooms/' + g + '/messages', x)).status).toBe(403);
  var sys = (await api('get', '/api/chat/rooms/' + g + '/messages', b)).body.data.filter(function (m) { return m.kind === 'system'; }).map(function (m) { return m.body; }).join('|');
  expect(sys).toMatch(/읽기만/); expect(sys).toMatch(/내보냈습니다/);
  expect((await api('delete', '/api/chat/rooms/' + dm + '/members/' + b.user.id, a)).status).toBe(400);   // 1:1 은 안 됨
});

test('🗂 방 폴더 (v13.359) — 방 사람 모두 같이 · 그 방 메시지만 · 만든 사람/방장만 지움 · 밖 사람 못 봄', async function () {
  var g = (await api('post', '/api/chat/rooms', a).send({ kind: 'group', name: '방폴더', userIds: [b.user.id, c.user.id] })).body.data.id;
  var m1 = (await api('post', '/api/chat/rooms/' + g + '/messages', a).send({ body: '도면 v3' })).body.data;
  var other = (await api('post', '/api/chat/rooms/' + dm + '/messages', a).send({ body: '다른 방' })).body.data;
  var f = (await api('post', '/api/chat/folders', b).send({ name: '도면', roomId: g })).body.data;
  expect(f).toMatchObject({ roomId: g, roomName: '방폴더', icon: '🗂' });
  expect((await api('post', '/api/chat/folders', x).send({ name: '몰래', roomId: g })).status).toBe(403);
  expect((await api('post', '/api/chat/folders/' + f.id + '/items', c).send({ messageId: m1.id })).status).toBe(201);   // 다른 멤버도 담음
  expect((await api('post', '/api/chat/folders/' + f.id + '/items', b).send({ messageId: other.id })).status).toBe(400);   // 다른 방 메시지
  var la = (await api('get', '/api/chat/folders', a)).body.data.filter(function (z) { return z.id === f.id; })[0];
  expect(la).toMatchObject({ n: 1, roomId: g });
  var items = (await api('get', '/api/chat/folders/' + f.id + '/items', a)).body.data;
  expect(items[0]).toMatchObject({ body: '도면 v3', savedBy: '사아자' });
  expect((await api('get', '/api/chat/folders/' + f.id + '/items', x)).status).toBe(404);
  expect((await api('get', '/api/chat/folders?room=' + g, c)).body.data.map(function (z) { return z.id; })).toEqual([f.id]);
  expect((await api('get', '/api/chat/messages/' + m1.id + '/folders', a)).body.data).toEqual([f.id]);
  expect((await api('put', '/api/chat/folders/' + f.id, c).send({ name: '바꿈' })).status).toBe(403);   // 만든 사람 · 방장만
  expect((await api('put', '/api/chat/folders/' + f.id, a).send({ name: '도면 모음' })).status).toBe(200);   // a = 방장
  expect((await api('delete', '/api/chat/folders/' + f.id, b)).status).toBe(200);   // 만든 사람
});

test('📲 푸시 (v13.359) — 구독 · 접속 안 한 사람에게 바로 · 음소거는 멘션만 · 만료 구독 지움 · 다른 알림도', async function () {
  var push = require('../services/push.service');
  var sent = [];
  push._setSender(function (sub, body) { sent.push({ ep: sub.endpoint, body: JSON.parse(body) }); if (/gone/.test(sub.endpoint)) { var e = new Error('gone'); e.statusCode = 410; throw e; } });
  var k = await api('get', '/api/push/key', b);
  expect(k.body.data.publicKey.length).toBeGreaterThan(60);
  expect((await api('get', '/api/push/key', c)).body.data.publicKey).toBe(k.body.data.publicKey);   // 같은 키
  expect((await api('post', '/api/push/subscribe', b).send({ subscription: { endpoint: 'http://x' } })).status).toBe(400);
  var sub = { endpoint: 'https://push.example/b-' + S, keys: { p256dh: 'P', auth: 'A' } };
  expect((await api('post', '/api/push/subscribe', b).send({ subscription: sub })).status).toBe(201);
  await api('post', '/api/push/subscribe', c).send({ subscription: { endpoint: 'https://push.example/gone-' + S, keys: { p256dh: 'P', auth: 'A' } } });
  // 1:1 — b 는 접속 안 함 → 바로
  await api('post', '/api/chat/rooms/' + dm + '/messages', a).send({ body: '내일 10시 점검 가능?' });
  await new Promise(function (r) { setTimeout(r, 300); });
  var got = sent.filter(function (s) { return s.ep === sub.endpoint; });
  expect(got.length).toBe(1);
  expect(got[0].body).toMatchObject({ title: '💬 가나다', body: '내일 10시 점검 가능?', go: 'chat:' + dm });
  // 접속 중이면 안 보냄
  sent.length = 0;
  var off = hub.add(b.user.id, { write: function () {}, on: function () {} });
  await api('post', '/api/chat/rooms/' + dm + '/messages', a).send({ body: '접속 중' });
  await new Promise(function (r) { setTimeout(r, 300); });
  expect(sent.length).toBe(0);
  off();
  // v13.371 접속은 살아 있어도 화면을 내려 둔(가려진) 연결뿐이면 보냄 · 다시 보이면 안 보냄
  var awayConn = { write: function () {}, on: function () {}, wmCid: 'cid-away-' + S };
  off = hub.add(b.user.id, awayConn);
  expect((await api('post', '/api/chat/away', b).send({ cid: 'cid-away-' + S, away: true })).body.data.conns).toBe(1);
  await api('post', '/api/chat/rooms/' + dm + '/messages', a).send({ body: '앱 내려 둠' });
  await new Promise(function (r) { setTimeout(r, 300); });
  expect(sent.filter(function (s) { return s.ep === sub.endpoint; }).length).toBe(1);
  sent.length = 0;
  await api('post', '/api/chat/away', b).send({ cid: 'cid-away-' + S, away: false });
  await api('post', '/api/chat/rooms/' + dm + '/messages', a).send({ body: '다시 봄' });
  await new Promise(function (r) { setTimeout(r, 300); });
  expect(sent.length).toBe(0);
  off();
  // 만료 구독은 지움
  var g = (await api('post', '/api/chat/rooms', a).send({ kind: 'group', name: '푸시', userIds: [c.user.id] })).body.data.id;
  await api('post', '/api/chat/rooms/' + g + '/messages', a).send({ body: 'hi' });
  await new Promise(function (r) { setTimeout(r, 400); });
  expect((await db.query('SELECT COUNT(*)::int AS n FROM push_subs WHERE user_id = $1', [c.user.id])).rows[0].n).toBe(0);
  // 다른 알림(notify)도 푸시로
  sent.length = 0;
  await require('../services/notification.service').notify('issue_assigned', { issueId: 'i1', projectName: 'P', title: '센서', assigneeName: 'x' }, [b.user.id]);
  await new Promise(function (r) { setTimeout(r, 300); });
  expect(sent.length).toBe(1);
  expect(sent[0].body.go).toBe('issue:i1');
  // 해지
  await api('post', '/api/push/unsubscribe', b).send({ endpoint: sub.endpoint });
  expect((await api('get', '/api/push/key', b)).body.data.subs).toBe(0);
  push._setSender(null);
});

test('📝 공동 문서 (v13.360) — 만들기 · 카드 · 같이 고치기 · 겹치면 409 · 실시간 · 기록 · 권한', async function () {
  var g = (await api('post', '/api/chat/rooms', a).send({ kind: 'group', name: '문서방', userIds: [b.user.id] })).body.data.id;
  var got = [], off = hub.add(b.user.id, { write: function (s) { got.push(s); }, on: function () {} });
  var d = (await api('post', '/api/chat/rooms/' + g + '/docs', a).send({ title: '조립기 #3 시운전 체크리스트', body: '1. 전원\n2. 통신\n' })).body.data;
  expect(d).toMatchObject({ title: '조립기 #3 시운전 체크리스트', rev: 1 });
  var ms = (await api('get', '/api/chat/rooms/' + g + '/messages', b)).body.data;
  expect(ms.some(function (m) { return (m.cards || []).some(function (c) { return c.type === 'cdoc' && c.id === d.id; }); })).toBe(true);
  // b 가 고침 (rev 1 → 2) · 실시간
  var p1 = await api('put', '/api/chat/docs/' + d.id, b).send({ body: '1. 전원 ✔\n2. 통신\n', baseRev: 1, clientId: 'tabB' });
  expect(p1.body.data).toMatchObject({ rev: 2, updatedByName: '라마바' });
  var docEv = got.join('').split('\n\n').filter(function (x) { return /event: doc\n/.test(x); })[0] || '';
  expect(docEv).toMatch(/"rev":2/); expect(docEv).toMatch(/"clientId":"tabB"/);
  // a 는 예전 rev 로 → 409 + 지금 글
  var p2 = await api('put', '/api/chat/docs/' + d.id, a).send({ body: '1. 전원\n2. 통신\n3. 비상 정지\n', baseRev: 1 });
  expect(p2.status).toBe(409);
  expect(p2.body.data).toMatchObject({ rev: 2, body: '1. 전원 ✔\n2. 통신\n' });
  // 합친 글로 다시 → rev 3 · 고치기 전 모습 기록
  expect((await api('put', '/api/chat/docs/' + d.id, a).send({ body: '1. 전원 ✔\n2. 통신\n3. 비상 정지\n', baseRev: 2 })).body.data.rev).toBe(3);
  var vs = (await api('get', '/api/chat/docs/' + d.id + '/versions', b)).body.data;
  expect(vs.length).toBeGreaterThanOrEqual(1);
  var v = (await api('get', '/api/chat/docs/' + d.id + '/versions/' + vs[0].id, b)).body.data;
  expect(v.body).toBe('1. 전원 ✔\n2. 통신\n');
  // 목록 · 방 밖 · 읽기만 · 지우기 권한
  var list = (await api('get', '/api/chat/rooms/' + g + '/docs', b)).body.data;
  expect(list[0]).toMatchObject({ id: d.id, rev: 3 });
  expect(list[0].body).toBeUndefined();
  expect((await api('get', '/api/chat/docs/' + d.id, x)).status).toBe(403);
  expect((await api('put', '/api/chat/docs/' + d.id, b).send({ body: 'x'.repeat(200001), baseRev: 3 })).status).toBe(413);
  await api('put', '/api/chat/rooms/' + g + '/members/' + b.user.id, a).send({ role: 'readonly' });
  expect((await api('put', '/api/chat/docs/' + d.id, b).send({ body: 'y', baseRev: 3 })).status).toBe(403);
  expect((await api('get', '/api/chat/docs/' + d.id, b)).body.data.readOnly).toBe(true);
  expect((await api('delete', '/api/chat/docs/' + d.id, b)).status).toBe(403);
  // v13.375 나중에 초대된 c 도 그 앞 문서를 봄 (history:false 는 무시)
  await api('post', '/api/chat/rooms/' + g + '/members', a).send({ userIds: [c.user.id], history: false });
  expect((await api('get', '/api/chat/docs/' + d.id, c)).status).toBe(200);
  expect((await api('get', '/api/chat/rooms/' + g + '/docs', c)).body.data.length).toBe(1);
  // 손가락(줄) 전달
  got.length = 0;
  await api('post', '/api/chat/docs/' + d.id + '/cursor', a).send({ line: 7 });
  expect(got.join('')).toMatch(/event: doc-cur\ndata: [^\n]*"line":7/);
  expect((await api('delete', '/api/chat/docs/' + d.id, a)).status).toBe(200);
  expect((await api('get', '/api/chat/docs/' + d.id, a)).status).toBe(404);
  off();
});

test('⏰ 예약 보내기 · 다시 알림 · 요청 재알림 (v13.362)', async function () {
  var timers = require('../lib/chat-timers');
  var g = (await api('post', '/api/chat/rooms', a).send({ kind: 'group', name: '예약방', userIds: [b.user.id] })).body.data.id;
  var soon = new Date(Date.now() + 3600000).toISOString();
  expect((await api('post', '/api/chat/rooms/' + g + '/scheduled', a).send({ body: 'x', sendAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);   // 지난 때
  expect((await api('post', '/api/chat/rooms/' + g + '/scheduled', a).send({ body: '', sendAt: soon })).status).toBe(400);
  var s1 = (await api('post', '/api/chat/rooms/' + g + '/scheduled', a).send({ body: '내일 아침 점검 시작합니다', sendAt: soon })).body.data;
  expect(s1).toMatchObject({ roomId: g, body: '내일 아침 점검 시작합니다' });
  expect(timers._timers['s:' + s1.id]).toBeDefined();   // 70분 안이면 바로 메모리 타이머
  timers.disarm('s', s1.id);   // 시험에선 아래에서 직접 부름
  var mine = (await api('get', '/api/chat/scheduled?room=' + g, a)).body.data;
  expect(mine.map(function (x) { return x.id; })).toEqual([s1.id]);
  expect((await api('get', '/api/chat/scheduled', b)).body.data.length).toBe(0);   // 남의 예약은 안 보임
  expect((await api('delete', '/api/chat/scheduled/' + s1.id, b)).status).toBe(404);
  // 고치기 → 때가 되면 보냄 (타이머 대신 직접 부름) → 한 번만
  await api('put', '/api/chat/scheduled/' + s1.id, a).send({ body: '내일 아침 9시 점검 시작합니다' });
  var sent = await timers.fireScheduled(s1.id);
  expect(sent).toMatchObject({ userId: a.user.id, body: '내일 아침 9시 점검 시작합니다', roomId: g });
  expect(await timers.fireScheduled(s1.id)).toBeNull();
  expect((await api('get', '/api/chat/scheduled?room=' + g, a)).body.data.length).toBe(0);
  // 지금 바로 · 취소
  var s2 = (await api('post', '/api/chat/rooms/' + g + '/scheduled', a).send({ body: '바로', sendAt: soon })).body.data;
  expect((await api('post', '/api/chat/scheduled/' + s2.id + '/now', a)).body.data.body).toBe('바로');
  var s3 = (await api('post', '/api/chat/rooms/' + g + '/scheduled', a).send({ body: '취소할 것', sendAt: soon })).body.data;
  expect((await api('delete', '/api/chat/scheduled/' + s3.id, a)).status).toBe(200);
  expect(await timers.fireScheduled(s3.id)).toBeNull();
  // 방에서 나가면 안 보냄
  var s4 = (await api('post', '/api/chat/rooms/' + g + '/scheduled', b).send({ body: '나가면 안 감', sendAt: soon })).body.data;
  await api('delete', '/api/chat/rooms/' + g + '/members/me', b);
  expect(await timers.fireScheduled(s4.id)).toBeNull();
  expect((await db.query('SELECT fail FROM chat_scheduled WHERE id = $1', [s4.id])).rows[0].fail).toBe('방에서 나감');
  await api('post', '/api/chat/rooms/' + g + '/members', a).send({ userIds: [b.user.id] });

  // ⏰ 다시 알림 — 나에게만 · 인앱 알림 · 실시간
  var m = (await api('post', '/api/chat/rooms/' + g + '/messages', a).send({ body: '견적서 금요일까지 회신' })).body.data;
  expect((await api('post', '/api/chat/messages/' + m.id + '/remind', x).send({ at: soon })).status).toBe(403);
  var rm = (await api('post', '/api/chat/messages/' + m.id + '/remind', b).send({ at: soon, note: '견적 확인' })).body.data;
  var list = (await api('get', '/api/chat/reminders', b)).body.data;
  expect(list[0]).toMatchObject({ id: rm.id, note: '견적 확인', body: '견적서 금요일까지 회신', who: '가나다', roomName: '예약방' });
  var got = [], off = hub.add(b.user.id, { write: function (s) { got.push(s); }, on: function () {} });
  await db.query('DELETE FROM in_app_notifications WHERE user_id = $1', [b.user.id]).catch(function () {});
  var fired = await timers.fireReminder(rm.id);
  expect(fired).toMatchObject({ roomId: g, body: '견적서 금요일까지 회신', note: '견적 확인' });
  expect(got.join('')).toMatch(/event: remind\n/);
  var ia = await db.query("SELECT body FROM in_app_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [b.user.id]);
  expect(ia.rows[0].body).toMatch(/견적 확인/);
  expect(await timers.fireReminder(rm.id)).toBeNull();
  expect((await api('get', '/api/chat/reminders', b)).body.data.length).toBe(0);
  off();

  // 📣 요청 다시 알림 — 담당에게 · 한 시간에 한 번 · 자동(4시간 넘은 접수)
  var post = (await api('post', '/api/chat/rooms/' + g + '/posts', a).send({ cat: 'req', title: '비전 검사기 캘리브레이션', assignee: b.user.id })).body.data;
  expect((await api('post', '/api/chat/messages/' + post.id + '/nudge', b)).status).toBe(400);   // 내가 담당
  expect((await api('post', '/api/chat/messages/' + post.id + '/nudge', a)).status).toBe(200);
  expect((await api('post', '/api/chat/messages/' + post.id + '/nudge', a)).status).toBe(429);
  await db.query("UPDATE chat_messages SET created_at = now() - interval '5 hours' WHERE id = $1", [post.id]);
  expect(await timers.nudgeStaleRequests()).toBeGreaterThanOrEqual(1);
  var pp = (await db.query('SELECT post FROM chat_messages WHERE id = $1', [post.id])).rows[0].post;
  expect(pp.autoNudged).toBeTruthy();
  expect(await timers.nudgeStaleRequests()).toBe(0);   // 한 번만
});

test('🎯 집중 모드 (v13.363) — 푸시 미룸 · @멘션은 받기 · 받기 끔 · 상대에게 표시 · 끄기', async function () {
  var push = require('../services/push.service'), sent = [];
  push._setSender(function (sub, body) { sent.push(JSON.parse(body)); });
  await db.query('DELETE FROM push_subs WHERE user_id = $1', [b.user.id]);
  await api('post', '/api/push/subscribe', b).send({ subscription: { endpoint: 'https://push.example/focus-' + S, keys: { p256dh: 'P', auth: 'A' } } });
  expect((await api('put', '/api/chat/focus', b).send({})).status).toBe(400);
  var f = (await api('put', '/api/chat/focus', b).send({ minutes: 60 })).body.data;
  expect(new Date(f.until) - Date.now()).toBeGreaterThan(55 * 60000);
  expect((await api('get', '/api/chat/focus', b)).body.data.allow).toBe(true);
  var g = (await api('post', '/api/chat/rooms', a).send({ kind: 'group', name: '집중방', userIds: [b.user.id] })).body.data.id;
  var wait = function () { return new Promise(function (r) { setTimeout(r, 800); }); };   // 푸시는 응답 뒤에 따로 감
  sent.length = 0;
  await api('post', '/api/chat/rooms/' + dm + '/messages', a).send({ body: '집중 중엔 안 감' }); await wait();
  expect(sent.length).toBe(0);
  await api('post', '/api/chat/rooms/' + g + '/messages', a).send({ body: '@라마바 급해요' }); await wait();
  expect(sent.length).toBe(1);   // @멘션은 받기
  // 상대 화면 표시
  var info = (await api('get', '/api/chat/rooms/' + g, a)).body.data;
  expect(info.members.filter(function (m) { return m.id === b.user.id; })[0].focusUntil).toBeTruthy();
  var rl = (await api('get', '/api/chat/rooms', a)).body.data.filter(function (r) { return r.id === dm; })[0];
  expect(rl.peerFocus).toBeTruthy();
  // 받기 끔 → 멘션도 미룸
  await api('put', '/api/chat/focus', b).send({ minutes: 30, allow: false });
  sent.length = 0;
  await api('post', '/api/chat/rooms/' + g + '/messages', a).send({ body: '@라마바 그래도?' }); await wait();
  expect(sent.length).toBe(0);
  // 끄기 → 다시 옴
  expect((await api('put', '/api/chat/focus', b).send({ off: true })).body.data.until).toBeNull();
  await api('post', '/api/chat/rooms/' + dm + '/messages', a).send({ body: '이제 감' }); await wait();
  expect(sent.length).toBe(1);
  expect((await api('get', '/api/chat/rooms', a)).body.data.filter(function (r) { return r.id === dm; })[0].peerFocus).toBeNull();
  push._setSender(null);
});

test('✨ AI 정리 (v13.364) — 안 읽은 요약 · 요청 채우기 · 오늘 정리 (AI 없으면 규칙)', async function () {
  var g = (await api('post', '/api/chat/rooms', a).send({ kind: 'group', name: '요약방', userIds: [b.user.id] })).body.data.id;
  var since = (await api('get', '/api/chat/rooms/' + g + '/messages', b)).body.data.slice(-1)[0].id;
  await api('post', '/api/chat/rooms/' + g + '/messages', a).send({ body: '오늘 오후에 라인 B 점검합니다' });
  await api('post', '/api/chat/rooms/' + g + '/messages', a).send({ body: '@라마바 펌웨어 버전 확인해 줄 수 있나요?' });
  await api('post', '/api/chat/rooms/' + g + '/posts', a).send({ cat: 'req', title: '조립기 #3 토크 재설정', assignee: b.user.id, urgency: 'urgent', due: new Date(Date.now() - 86400000).toISOString().slice(0, 10) });
  var cu = (await api('post', '/api/chat/rooms/' + g + '/catchup', b).send({ sinceId: since })).body.data;
  expect(cu.count).toBe(3);
  expect(typeof cu.ai).toBe('boolean');
  if (!cu.ai) {
    expect(cu.text).toMatch(/메시지 3개/);
    expect(cu.text).toMatch(/나를 부른 것[\s\S]*펌웨어/);
    expect(cu.text).toMatch(/조립기 #3 토크 재설정 \(🔴 긴급\)/);
    expect(cu.text).toMatch(/질문[\s\S]*확인해 줄 수 있나요/);
  }
  expect((await api('post', '/api/chat/rooms/' + g + '/catchup', x).send({})).status).toBe(403);
  // 요청 채우기
  var sg = (await api('post', '/api/chat/posts/suggest', b).send({ text: '2호기 사출기 온도 알람이 계속 떠서 라인 정지했습니다' })).body.data;
  if (!sg.ai) expect(sg).toMatchObject({ cat: 'req', equip: '2호기 사출기', urgency: 'urgent' });
  expect((await api('post', '/api/chat/posts/suggest', b).send({ text: ' ' })).status).toBe(400);
  // 오늘 정리 — 긴급 · 기한 지난 것 먼저
  await api('post', '/api/chat/rooms/' + g + '/posts', a).send({ cat: 'req', title: '여유 있는 일', assignee: b.user.id });
  var brr = await api('get', '/api/chat/requests/brief', b); if (!brr.body.data) console.log('BRIEF', brr.status, JSON.stringify(brr.body)); var br = brr.body.data;
  expect(br.count).toBeGreaterThanOrEqual(2);
  if (!br.ai) {
    expect(br.text).toMatch(/1\. 🔴 조립기 #3 토크 재설정/);
    expect(br.text).toMatch(/기한 지남 1/);
  }
});

test('🏭 장비 단위 연결 (v13.365) — 마스터 · 이름 · 요청 · A/S · 문서 · 언급 · 장비 방 · 권한', async function () {
  var eid = 'eqm-' + S;
  await db.query("INSERT INTO as_equipment_master (id, tenant_id, serial_no, equipment_no, equipment_model, customer_name, site_line, warranty_status) VALUES ($1,$2,$3,'PRJ-77','VS-200 비전검사기','한빛전자','2라인','보증내')", [eid, T, 'SN-' + S]);
  await db.query("INSERT INTO as_tickets (id, ticket_no, tenant_id, customer_name, serial_no, equipment_model, issue_summary, status, priority) VALUES ($1,$2,$3,'한빛전자',$4,'VS-200 비전검사기','조명 깜빡임','received','P2')", ['ast-' + S, 'AS-T-' + String(S).slice(-4), T, 'SN-' + S]);
  var g = (await api('post', '/api/chat/rooms', a).send({ kind: 'group', name: '설비팀2', userIds: [b.user.id] })).body.data.id;
  var p1 = (await api('post', '/api/chat/rooms/' + g + '/posts', a).send({ cat: 'req', title: '조명 밝기 재설정', equipId: eid, assignee: b.user.id })).body.data;
  expect(p1.post).toMatchObject({ equipId: eid, equip: 'VS-200 비전검사기 · SN-' + S });
  await api('post', '/api/chat/rooms/' + g + '/posts', a).send({ cat: 'req', title: '온도 알람', equip: '2호기 사출기' });
  await api('post', '/api/chat/rooms/' + g + '/messages', a).send({ body: '2호기 사출기 히터 교체했어요' });
  await api('post', '/api/chat/rooms/' + g + '/docs', a).send({ title: '2호기 사출기 점검표' });
  // 목록 · 찾기
  var list = (await api('get', '/api/chat/equipment', b)).body.data;
  var m = list.filter(function (x) { return x.key === 'm:' + eid; })[0];
  expect(m).toMatchObject({ type: 'master', open: 1 });
  expect(list.some(function (x) { return x.key === 'n:2호기 사출기' && x.open === 1; })).toBe(true);
  expect((await api('get', '/api/chat/equipment?q=' + encodeURIComponent('한빛'), b)).body.data.map(function (x) { return x.key; })).toContain('m:' + eid);
  expect((await api('get', '/api/chat/equipment', x)).body.data.some(function (z) { return z.type === 'name'; })).toBe(false);   // 방 밖 사람은 이름(글) 안 보임
  // 마스터 카드
  var cm = (await api('get', '/api/chat/equipment/card?key=' + encodeURIComponent('m:' + eid), b)).body.data;
  expect(cm.master).toMatchObject({ model: 'VS-200 비전검사기', customer: '한빛전자', line: '2라인' });
  expect(cm.requests.map(function (r) { return r.post.title; })).toEqual(['조명 밝기 재설정']);
  expect(cm.as.map(function (r) { return r.summary; })).toEqual(['조명 깜빡임']);
  // 이름 카드
  var cn = (await api('get', '/api/chat/equipment/card?key=' + encodeURIComponent('n:2호기 사출기'), b)).body.data;
  expect(cn.requests.length).toBe(1);
  expect(cn.docs.map(function (d) { return d.title; })).toEqual(['2호기 사출기 점검표']);
  expect(cn.mentions.map(function (z) { return z.body; })).toContain('2호기 사출기 히터 교체했어요');
  expect(cn.room).toBeNull();
  var cx = (await api('get', '/api/chat/equipment/card?key=' + encodeURIComponent('n:2호기 사출기'), x)).body.data;
  expect(cx.requests.length + cx.docs.length + cx.mentions.length).toBe(0);   // 방 밖 사람
  expect((await api('get', '/api/chat/equipment/card?key=zz', b)).status).toBe(404);
  // 장비 방 — 만들고(글 쓴 사람 · 담당 같이) · 두 번째는 같은 방
  var r1 = (await api('post', '/api/chat/equipment/room', b).send({ key: 'm:' + eid })).body.data;
  expect(r1.created).toBe(true);
  var info = (await api('get', '/api/chat/rooms/' + r1.id, a)).body.data;
  expect(info).toMatchObject({ kind: 'group', equipKey: 'm:' + eid });
  expect(info.members.map(function (z) { return z.id; }).sort()).toEqual([a.user.id, b.user.id].sort());
  var r2 = (await api('post', '/api/chat/equipment/room', c).send({ key: 'm:' + eid })).body.data;
  expect(r2).toMatchObject({ id: r1.id, created: false });
  expect((await api('get', '/api/chat/equipment/card?key=' + encodeURIComponent('m:' + eid), c)).body.data.room).toMatchObject({ id: r1.id, mine: true });
});

test('⚡ 100명+ 대비 (v13.366) — 읽음 모아 보내기 · 같은 읽음 무시 · 입력 중 줄이기 · 내보낸 사람 바로 끊김 · 방 안 찾기 · 시스템 메시지 안 셈', async function () {
  var g = (await api('post', '/api/chat/rooms', a).send({ kind: 'group', name: '규모방', userIds: [b.user.id, c.user.id] })).body.data.id;
  var got = { a: [], c: [] };
  function fake(k) { return { write: function (s) { got[k].push(s); } }; }
  var offA = hub.add(a.user.id, fake('a')), offC = hub.add(c.user.id, fake('c'));
  var m1 = (await api('post', '/api/chat/rooms/' + g + '/messages', a).send({ body: '규모 확인 메시지' })).body.data;
  got.a = [];
  // b · c 가 읽음 → 1번만 'reads' (둘 다 담김)
  await api('post', '/api/chat/rooms/' + g + '/read', b).send({ lastId: m1.id });
  await api('post', '/api/chat/rooms/' + g + '/read', c).send({ lastId: m1.id });
  await new Promise(function (r) { setTimeout(r, 250); });
  var reads = got.a.filter(function (s) { return /event: reads/.test(s); });
  expect(reads.length).toBe(1);
  var pl = JSON.parse(reads[0].split('data: ')[1]);
  expect(pl.list.map(function (z) { return z.userId; }).sort()).toEqual([b.user.id, c.user.id].sort());
  // 같은 위치 다시 읽음 → 알림 없음
  got.a = [];
  await api('post', '/api/chat/rooms/' + g + '/read', b).send({ lastId: m1.id });
  await new Promise(function (r) { setTimeout(r, 250); });
  expect(got.a.some(function (s) { return /event: reads?\n/.test(s) || /event: reads/.test(s); })).toBe(false);
  // 입력 중 — 곧바로 두 번이면 한 번만
  got.a = [];
  await api('post', '/api/chat/rooms/' + g + '/typing', b).send({});
  await api('post', '/api/chat/rooms/' + g + '/typing', b).send({});
  expect(got.a.filter(function (s) { return /event: typing/.test(s); }).length).toBe(1);
  // 내보내면 바로 안 받음 (멤버 목록 담아 둔 것 지움)
  await api('delete', '/api/chat/rooms/' + g + '/members/' + c.user.id, a);
  got.c = [];
  await api('post', '/api/chat/rooms/' + g + '/messages', a).send({ body: '내보낸 뒤 메시지' });
  expect(got.c.some(function (s) { return /내보낸 뒤 메시지/.test(s); })).toBe(false);
  offA(); offC();
  // 방 안 찾기 — 방 · 보낸 사람 · 파일만
  await api('post', '/api/chat/rooms/' + g + '/messages', b).send({ body: '규모 확인 답장' });
  var all = (await api('get', '/api/chat/search?q=' + encodeURIComponent('규모 확인'), a)).body.data;
  expect(all.length).toBeGreaterThanOrEqual(2);
  var inRoom = (await api('get', '/api/chat/search?q=' + encodeURIComponent('규모 확인') + '&room=' + g + '&from=' + b.user.id, a)).body.data;
  expect(inRoom.map(function (m) { return m.body; })).toEqual(['규모 확인 답장']);
  expect((await api('get', '/api/chat/search?q=' + encodeURIComponent('규모 확인') + '&room=' + g + '&has=file', a)).body.data.length).toBe(0);
  // 방 목록 안 읽음 — 시스템 메시지(초대 · 내보냄)는 안 셈
  await api('post', '/api/chat/rooms/' + g + '/read', b).send({ lastId: 99999999 });
  await api('post', '/api/chat/rooms/' + g + '/members', a).send({ userIds: [x.user.id] });
  var rb = (await api('get', '/api/chat/rooms', b)).body.data.filter(function (r) { return r.id === g; })[0];
  expect(rb.unread).toBe(0);
});
