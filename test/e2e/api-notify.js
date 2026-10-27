// 마인드맵 알림 — 공유받으면 알림 · 주제 마감(오늘 · 내일 · 지연 3일째) 하루 한 번 묶음 알림 (v13.238)
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var B = 'http://localhost:3000';
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
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
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }

(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  await c.query("DELETE FROM mindmaps WHERE title LIKE '알림 시험%' OR title LIKE '내업무%'");   // 담당 · 마감 주제가 있는 다른 시험 맵도 (알림 수가 달라짐)   // 지난 실행이 남긴 맵 — 알림 묶음이 15건을 넘지 않게
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com'));
  var kimId = (await K('GET', '/api/auth/me')).d.data.id;
  var adminId = (await A('GET', '/api/auth/me')).d.data.id;
  // 공유 알림
  var m = (await A('POST', '/api/mindmaps', { title: '알림 시험', scope: 'personal' })).d.data;
  var U = '/api/mindmaps/' + m.id;
  var t0 = new Date();
  var r1 = await A('PUT', U, { version: m.version, editors: [kimId] });
  check('편집 공유', r1.s === 200, r1);
  await wait(500);
  var s1 = await c.query("SELECT user_id, body FROM in_app_notifications WHERE event_type = 'mindmap_shared' AND created_at >= $1", [t0]);
  check('공유받은 김에게 알림 (편집)', s1.rows.length === 1 && s1.rows[0].user_id === kimId && /알림 시험/.test(s1.rows[0].body) && /편집할 수 있게/.test(s1.rows[0].body), s1.rows);
  var t1 = new Date();
  await A('PUT', U, { version: r1.d.data.version, editors: [kimId], title: '알림 시험2' });
  await wait(400);
  check('이미 공유된 사람은 다시 알림 없음', (await c.query("SELECT 1 FROM in_app_notifications WHERE event_type = 'mindmap_shared' AND created_at >= $1", [t1])).rows.length === 0);
  // 마감 알림 — 김 담당 주제 오늘 · 내일 · 3일 지남 · 2일 지남(안 보냄) · 완료(안 보냄)
  var doc = { sheets: [{ id: 's1', title: '시트', structure: 'balanced', root: { id: 'r', text: '루트', children: [
    { id: 'a', text: '오늘 할 일', assigneeId: kimId, dueDate: kst(0), children: [] },
    { id: 'b', text: '내일 할 일', assigneeId: kimId, dueDate: kst(1), children: [] },
    { id: 'c', text: '사흘 지남', assigneeId: kimId, dueDate: kst(-3), children: [] },
    { id: 'd', text: '이틀 지남', assigneeId: kimId, dueDate: kst(-2), children: [] },
    { id: 'e', text: '끝난 일', assigneeId: kimId, dueDate: kst(0), done: true, children: [] },
    { id: 'f', text: '관리자 일', assigneeId: adminId, dueDate: kst(1), children: [] }
  ] } }] };
  var cur = (await A('GET', U)).d.data;
  check('문서 저장', (await A('PUT', U, { version: cur.version, doc: doc })).s === 200);
  var t2 = new Date();
  var jobs = require(path.join(__dirname, '../../server/services/notification/jobs'));
  await jobs.sendMindmapDueReminders();
  await wait(500);
  var s2 = await c.query("SELECT user_id, body FROM in_app_notifications WHERE event_type = 'mindmap_due' AND created_at >= $1 ORDER BY user_id", [t2]);
  var kimRow = s2.rows.filter(function (x) { return x.user_id === kimId; })[0];
  check('사람마다 한 통 (김 · 관리자)', s2.rows.length === 2, s2.rows);
  check('김: 오늘 · 내일 · 지연 3일, 2일 지남 · 완료 제외',
    kimRow && /\[오늘 마감\] 오늘 할 일/.test(kimRow.body) && /\[내일 마감\] 내일 할 일/.test(kimRow.body) && /\[지연 3일\] 사흘 지남/.test(kimRow.body) &&
    !/이틀 지남/.test(kimRow.body) && !/끝난 일/.test(kimRow.body), kimRow);
  await c.end();
  console.log('\nALL PASS ' + n);
  process.exit(0);
})().catch(function (e) { console.log('ERR', e.message); process.exit(1); });
