// 마인드맵 주제 댓글 API — 권한(공유 안 됨 404 · 보기 공유도 쓰기) · 고치기/해결/지우기 권한 · 알림 대상 (v13.237)
var B = 'http://localhost:3000';
var pg = require(require('path').join(__dirname, '../../server/node_modules/pg'));
async function login(email) {
  var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) });
  return (await r.json()).data.accessToken;
}
function api(tok) {
  return async function (method, url, body) {
    var r = await fetch(B + url, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
    var j = null; try { j = await r.json(); } catch (_) {}
    return { s: r.status, d: j };
  };
}
var n = 0;
function check(name, c, x) { if (!c) { console.log('FAIL', name, JSON.stringify(x, null, 1).slice(0, 1500)); process.exit(1); } n++; console.log('✔', name); }
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

(async function () {
  var c = new pg.Client('postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com')), L = api(await login('lee@t.com'));
  var kimId = (await K('GET', '/api/auth/me')).d.data.id;
  var leeId = (await L('GET', '/api/auth/me')).d.data.id;
  await A('PUT', '/api/mindmaps/access/users/' + kimId, { enabled: true });
  await A('PUT', '/api/mindmaps/access/users/' + leeId, { enabled: true });
  var m = (await K('POST', '/api/mindmaps', { title: '댓글 시험', scope: 'personal' })).d.data;
  var U = '/api/mindmaps/' + m.id;
  check('빈 목록', (await K('GET', U + '/comments')).d.data.length === 0);
  check('공유 안 된 사람 404', (await L('GET', U + '/comments')).s === 404);
  check('공유 안 된 사람 쓰기 404', (await L('POST', U + '/comments', { nodeId: 'n1', body: '가' })).s === 404);
  check('빈 내용 400', (await K('POST', U + '/comments', { nodeId: 'n1', body: '  ' })).s === 400);
  check('너무 긴 내용 400', (await K('POST', U + '/comments', { nodeId: 'n1', body: 'x'.repeat(2001) })).s === 400);
  // 보기만 공유 → 쓰기 가능
  await K('PUT', U, { version: m.version, viewers: [leeId] });
  var t0 = new Date();
  var c1 = await L('POST', U + '/comments', { nodeId: 'n1', body: '일정 괜찮나요? @김팀원', nodeText: '기능 개발' });
  check('보기 공유 → 쓰기 201 · 작성자 이름', c1.s === 201 && c1.d.data.author_name === '이팀원' && c1.d.data.node_id === 'n1', c1);
  await wait(500);
  var nt = await c.query("SELECT user_id, event_type, body FROM in_app_notifications WHERE event_type = 'mindmap_comment' AND created_at >= $1", [t0]);
  check('알림 → 김(멘션 · 소유자), 쓴 사람 제외', nt.rows.length === 1 && nt.rows[0].user_id === kimId && /댓글 시험/.test(nt.rows[0].body), nt.rows);
  // 개인 맵은 공유 안 된 사람에게 멘션해도 알림 안 감
  var t1 = new Date();
  await K('POST', U + '/comments', { nodeId: 'n1', body: '@관리자 보세요' });
  await wait(500);
  var nt2 = await c.query("SELECT user_id FROM in_app_notifications WHERE event_type = 'mindmap_comment' AND created_at >= $1", [t1]);
  check('개인 맵: 공유 안 된 관리자는 알림 제외, 같은 주제에 쓴 이씨는 받음', nt2.rows.length === 1 && nt2.rows[0].user_id === leeId, nt2.rows);
  var cid = c1.d.data.id;
  check('남의 댓글 고치기 403', (await K('PUT', U + '/comments/' + cid, { body: '바꿈' })).s === 403);
  var ed = await L('PUT', U + '/comments/' + cid, { body: '일정 확인 부탁드립니다' });
  check('내 댓글 고치기', ed.s === 200 && ed.d.data.body === '일정 확인 부탁드립니다' && !!ed.d.data.updated_at, ed);
  var rs = await K('PUT', U + '/comments/' + cid, { resolved: true });
  check('편집 권한(소유자) → 해결 처리', rs.s === 200 && rs.d.data.resolved === true, rs);
  var c3 = (await L('POST', U + '/comments', { nodeId: 'n2', body: '두 번째' })).d.data;
  var c4 = (await K('POST', U + '/comments', { nodeId: 'n2', body: '김의 댓글' })).d.data;
  check('보기 공유자: 남의 댓글 해결 403', (await L('PUT', U + '/comments/' + c4.id, { resolved: true })).s === 403);
  check('보기 공유자: 남의 댓글 지우기 404', (await L('DELETE', U + '/comments/' + c4.id)).s === 404);
  check('소유자: 남의 댓글 지우기', (await K('DELETE', U + '/comments/' + c3.id)).s === 200);
  var list = (await K('GET', U + '/comments')).d.data;
  check('목록 — 오래된 순', list.length === 3 && list[0].id === cid && list[2].id === c4.id, list);
  // 맵을 지우면(행 삭제) 댓글도
  await c.query('DELETE FROM mindmaps WHERE id = $1', [m.id]);
  check('맵 행 삭제 → 댓글도 삭제', (await c.query('SELECT COUNT(*)::int AS n FROM mindmap_comments WHERE map_id = $1', [m.id])).rows[0].n === 0);
  await c.end();
  console.log('\nALL PASS ' + n);
})().catch(function (e) { console.log('ERR', e.message); process.exit(1); });
