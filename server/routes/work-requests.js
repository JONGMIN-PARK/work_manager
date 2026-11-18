/**
 * 📨 업무 요청 (v13.525) — 프로젝트 · 내 할 일 · 일정에서 사람에게 보내기
 *   POST /api/work-requests                { toUserIds[], type, title, body?, dueDate?, dueTime?, endTime?, location?, projectId?, srcKey? }
 *        type: order 업무 지시 · transfer 업무 이관 · forward 업무 전달 · event 일정 · todo 할 일
 *        받는 사람마다 한 건 + 1:1 메신저 방에 📨 카드(chat_messages.wreq)
 *   GET  /api/work-requests?box=in|out&open=1    받은 · 보낸 요청 (open=1 이면 끝나지 않은 것만)
 *   GET  /api/work-requests/count          받은 것 중 아직 답하지 않은 수
 *   POST /api/work-requests/:id/accept     받은 사람 — 할 일(일정 요청은 일정)로 등록 · 이관이면 보낸 사람의 원래 할 일을 닫음
 *   POST /api/work-requests/:id/decline    { reply } 받은 사람 — 돌려보냄
 *   POST /api/work-requests/:id/done       받은 사람 — 끝냄(수락한 것) · 수락하지 않고 바로 끝내도 됨(전달 확인 등)
 *   POST /api/work-requests/:id/cancel     보낸 사람 — 아직 답이 없을 때 거두기
 *  받은 할 일을 내 업무에서 끝내면(lib/my-work-done · PUT /my-work/todos/:id) 요청도 '완료' — onTodoDone
 *  상태가 바뀌면 카드가 바뀌고, 같은 방에 한 줄(시스템 글)로 알림
 */
var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');
var pa = require('../lib/project-access');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var TYPES = {
  order: { icon: '📋', label: '업무 지시' },
  transfer: { icon: '🔁', label: '업무 이관' },
  forward: { icon: '📤', label: '업무 전달' },
  event: { icon: '📅', label: '일정' },
  todo: { icon: '✅', label: '할 일' }
};
var STATUS_LABEL = { sent: '답을 기다림', accepted: '수락', declined: '반려', done: '완료', canceled: '거둠' };

function bad(res, msg, code) { return httpErr.sendError(res, code || 400, 'VALIDATION', msg); }
function cleanDate(v) { v = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
function cleanTime(v) { v = String(v || '').trim(); return /^\d{2}:\d{2}$/.test(v) ? v : null; }
function rid() { return 'wrq-' + crypto.randomUUID().slice(0, 12); }

/* 표시 이름 — 바꾼 이름이 있으면 '바꾼 이름(등록 이름)' (v13.530, 예: Alex(박종민)). label=false 면 이름 맞추기용 원래 값 */
var LABEL_SQL = function (t) {
  // 보이는 이름 = 표시명 || 이름. 괄호 = 그와 다른 이름(이름, 없으면 등록 이름) — 예: Alex(박종민) · Alex(관리자)
  var shown = "COALESCE(NULLIF(" + t + ".display_name,''), " + t + ".name)";
  var other = "CASE WHEN " + t + ".name IS DISTINCT FROM " + shown + " THEN " + t + ".name WHEN COALESCE(" + t + ".reg_name,'') <> '' AND " + t + ".reg_name IS DISTINCT FROM " + shown + " THEN " + t + ".reg_name END";
  return "(" + shown + " || COALESCE('(' || " + other + " || ')', ''))";
};
async function names(tenantId, ids, label) {
  var r = await db.query("SELECT u.id, " + (label ? LABEL_SQL('u') : "COALESCE(NULLIF(u.display_name,''), u.name)") + " AS n FROM users u WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[])", [tenantId, ids]);
  var o = {}; r.rows.forEach(function (u) { o[u.id] = u.n; }); return o;
}

/* 카드에 싣는 모양 — 메신저가 그대로 그린다 */
function snap(w, nm) {
  return { id: w.id, type: w.type, title: w.title, body: w.body || '', due: w.due_date || '', time: w.due_time || '', endTime: w.end_time || '', location: w.location || '',
    projectId: w.project_id || null, projectName: w.project_name || '', status: w.status, reply: w.reply || '', resultKey: w.result_key || null,
    from: w.from_user_id, to: w.to_user_id, toName: (nm && nm[w.to_user_id]) || '', fromName: (nm && nm[w.from_user_id]) || '' };
}
function shapeRow(w) {
  return { id: w.id, type: w.type, title: w.title, body: w.body || '', dueDate: w.due_date || '', dueTime: w.due_time || '', endTime: w.end_time || '', location: w.location || '',
    projectId: w.project_id || null, projectName: w.project_name || '', status: w.status, reply: w.reply || '', resultKey: w.result_key || null, srcKey: w.src_key || null,
    fromUserId: w.from_user_id, toUserId: w.to_user_id, fromName: w.from_name || '', toName: w.to_name || '', chatMsgId: w.chat_msg_id ? +w.chat_msg_id : null,
    createdAt: w.created_at, respondedAt: w.responded_at, doneAt: w.done_at };
}

/* 카드 고치고 방에 한 줄 */
async function syncCard(tenantId, w, line) {
  if (!w.chat_msg_id) return;
  try {
    var chat = require('./chat');
    var nm = await names(tenantId, [w.from_user_id, w.to_user_id], true);
    await db.query('UPDATE chat_messages SET wreq = $2 WHERE id = $1', [w.chat_msg_id, JSON.stringify(snap(w, nm))]);
    await chat.refreshMsg(+w.chat_msg_id);
    if (line) {
      var room = (await db.query('SELECT * FROM chat_rooms WHERE id = (SELECT room_id FROM chat_messages WHERE id = $1)', [w.chat_msg_id])).rows[0];
      if (room) await chat.postMessage({ tenantId: tenantId }, room, { kind: 'system', body: line, replyTo: null });
    }
  } catch (e) { console.error('[wreq/card]', e.message); }
}
function lineOf(w, nm, what) {
  var t = TYPES[w.type] || TYPES.order;
  return t.icon + ' ' + (nm || '') + ' 님이 ' + t.label + ' "' + String(w.title).slice(0, 60) + '" — ' + what;
}

/* 받는 사람 쪽에 만들기 — 일정 요청은 일정, 나머지는 할 일 */
async function makeResult(req, w) {
  var t = TYPES[w.type] || TYPES.order;
  var me = req.user.name || '';
  if (w.type === 'event') {
    var pids = [];
    if (w.project_id && await pa.canReadById(req, w.project_id)) pids.push(w.project_id);
    var eid = 'evt-' + crypto.randomUUID().slice(0, 12);
    var nm = await names(req.tenant.id, [w.from_user_id]);
    var assignees = [me]; if (nm[w.from_user_id] && assignees.indexOf(nm[w.from_user_id]) < 0) assignees.push(nm[w.from_user_id]);
    await db.query(
      "INSERT INTO events (id, title, type, start_date, end_date, project_ids, assignees, memo, created_by, tenant_id, start_time, end_time, location) VALUES ($1,$2,'meeting',$3,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [eid, w.title, w.due_date || require('../lib/my-work').kstToday(), JSON.stringify(pids), JSON.stringify(assignees),
       (w.body ? w.body + '\n\n' : '') + '📨 ' + (nm[w.from_user_id] || '') + ' 님이 보낸 일정', req.user.sub, req.tenant.id, w.due_time || null, w.end_time || null, w.location || null]);
    return 'event:' + eid;
  }
  var from = (await names(req.tenant.id, [w.from_user_id], true))[w.from_user_id] || '';
  var memo = [t.icon + ' ' + from + ' 님의 ' + t.label + (w.project_name ? ' · 📁 ' + w.project_name : ''), w.body || ''].filter(Boolean).join('\n\n');
  var tid = 'todo-' + crypto.randomUUID().slice(0, 12);
  await db.query(
    'INSERT INTO my_todos (id, tenant_id, user_id, title, due_date, due_time, memo, priority) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [tid, req.tenant.id, req.user.sub, w.title.slice(0, 500), w.due_date || null, w.due_time || null, memo.slice(0, 5000), w.type === 'order' ? 2 : 3]);
  return 'todo:' + tid;
}

/* 이관 — 보낸 사람의 원래 할 일을 '이관됨'으로 닫음 */
async function closeSource(w, toName) {
  var m = /^todo:(.+)$/.exec(w.src_key || '');
  if (!m || w.type !== 'transfer') return;
  await db.query("UPDATE my_todos SET done_at = COALESCE(done_at, now()), memo = LEFT(COALESCE(memo,'') || $4, 5000), updated_at = now() WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL",
    [m[1], w.tenant_id, w.from_user_id, '\n\n🔁 ' + (toName || '') + ' 님에게 이관됨']);
}

/* ─── 보내기 ─── */
router.post('/', async function (req, res) {
  try {
    var b = req.body || {};
    var type = TYPES[b.type] ? b.type : null;
    if (!type) return bad(res, '요청 종류를 고르세요.');
    var title = String(b.title || '').trim().slice(0, 300);
    if (!title) return bad(res, '제목을 적으세요.');
    var to = (Array.isArray(b.toUserIds) ? b.toUserIds : [b.toUserId]).filter(function (x, i, a) { return x && typeof x === 'string' && a.indexOf(x) === i; }).slice(0, 30);
    to = to.filter(function (x) { return x !== req.user.sub; });
    if (!to.length) return bad(res, '받는 사람을 고르세요 (나 말고).');
    var nm = await names(req.tenant.id, to.concat([req.user.sub]), true);
    if (to.some(function (x) { return !nm[x]; })) return bad(res, '받는 사람을 찾을 수 없습니다.', 404);
    if (type === 'transfer' && to.length > 1) return bad(res, '이관은 한 사람에게만 할 수 있습니다.');
    var due = cleanDate(b.dueDate), tm = cleanTime(b.dueTime), et = cleanTime(b.endTime);
    if (type === 'event' && !due) return bad(res, '일정 날짜를 고르세요.');
    var pid = b.projectId ? String(b.projectId).slice(0, 100) : null, pname = '';
    if (pid) {
      if (!await pa.canReadById(req, pid)) return bad(res, '프로젝트를 볼 수 없습니다.', 403);
      var pr = await db.query('SELECT name, order_no FROM projects WHERE id = $1 AND tenant_id = $2', [pid, req.tenant.id]);
      pname = pr.rows[0] ? (pr.rows[0].name || pr.rows[0].order_no || '') : '';
    }
    var srcKey = b.srcKey ? String(b.srcKey).slice(0, 120) : null;
    if (srcKey && /^todo:/.test(srcKey)) {   // 내 할 일에서 보낼 때 — 내 것인지
      var own = await db.query('SELECT 1 FROM my_todos WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [srcKey.slice(5), req.tenant.id, req.user.sub]);
      if (!own.rows.length) srcKey = null;
    }
    var body = String(b.body || '').trim().slice(0, 4000);
    var chat = require('./chat');
    var out = [];
    for (var i = 0; i < to.length; i++) {
      var r = await db.query(
        'INSERT INTO work_requests (id, tenant_id, from_user_id, to_user_id, type, title, body, due_date, due_time, end_time, location, project_id, project_name, src_key) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',
        [rid(), req.tenant.id, req.user.sub, to[i], type, title, body || null, due, tm, et, String(b.location || '').trim().slice(0, 255) || null, pid, pname || null, srcKey]);
      var w = r.rows[0], t = TYPES[type];
      try {
        var room = await chat.dmRoom(req.tenant.id, req.user.sub, to[i], req.user.sub);
        var text = t.icon + ' ' + t.label + ': ' + title + (due ? ' (' + due + (tm ? ' ' + tm : '') + ')' : '');
        var msg = await chat.postMessage({ tenantId: req.tenant.id }, room, { userId: req.user.sub, kind: 'text', body: text, wreq: snap(w, nm), mentions: [] });
        if (msg) { await db.query('UPDATE work_requests SET chat_msg_id = $2 WHERE id = $1', [w.id, msg.id]); w.chat_msg_id = msg.id; }
      } catch (e) { console.error('[wreq/send→chat]', e.message); }
      out.push(shapeRow(Object.assign({}, w, { from_name: nm[req.user.sub], to_name: nm[to[i]] })));
    }
    res.status(201).json({ data: out });
  } catch (e) { httpErr.serverError(res, '[wreq/send]', e); }
});

/* ─── 목록 ─── */
router.get('/', async function (req, res) {
  try {
    var box = req.query.box === 'out' ? 'out' : 'in';
    var cond = box === 'out' ? 'w.from_user_id = $2' : 'w.to_user_id = $2';
    if (req.query.open === '1') cond += " AND w.status IN ('sent','accepted')";
    var r = await db.query(
      "SELECT w.*, " + LABEL_SQL('fu') + " AS from_name, " + LABEL_SQL('tu') + " AS to_name FROM work_requests w " +
      'JOIN users fu ON fu.id = w.from_user_id JOIN users tu ON tu.id = w.to_user_id WHERE w.tenant_id = $1 AND ' + cond +
      " ORDER BY (w.status IN ('sent','accepted')) DESC, w.created_at DESC LIMIT 300", [req.tenant.id, req.user.sub]);
    res.json({ data: r.rows.map(shapeRow) });
  } catch (e) { httpErr.serverError(res, '[wreq/list]', e); }
});
router.get('/count', async function (req, res) {
  try {
    var r = await db.query("SELECT COUNT(*)::int AS n FROM work_requests WHERE tenant_id = $1 AND to_user_id = $2 AND status = 'sent'", [req.tenant.id, req.user.sub]);
    res.json({ count: r.rows[0].n });
  } catch (e) { httpErr.serverError(res, '[wreq/count]', e); }
});

/* ─── 답하기 ─── */
async function load(req, res, who) {
  var r = await db.query('SELECT * FROM work_requests WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
  var w = r.rows[0];
  if (!w || (who === 'to' ? w.to_user_id : w.from_user_id) !== req.user.sub) { httpErr.sendError(res, 404, 'NOT_FOUND', '요청을 찾을 수 없습니다.'); return null; }
  return w;
}
async function setStatus(w, status, extra) {
  var sets = ['status = $2', 'updated_at = now()'], vals = [w.id, status];
  Object.keys(extra || {}).forEach(function (k) { vals.push(extra[k]); sets.push(k + ' = $' + vals.length); });
  if (status === 'accepted' || status === 'declined') sets.push('responded_at = COALESCE(responded_at, now())');
  if (status === 'done') sets.push('done_at = now()', 'responded_at = COALESCE(responded_at, now())');
  var r = await db.query('UPDATE work_requests SET ' + sets.join(', ') + ' WHERE id = $1 RETURNING *', vals);
  return r.rows[0];
}

router.post('/:id/accept', async function (req, res) {
  try {
    var w = await load(req, res, 'to'); if (!w) return;
    if (w.status !== 'sent') return bad(res, '이미 ' + (STATUS_LABEL[w.status] || w.status) + ' 처리된 요청입니다.', 409);
    // 먼저 상태를 잡아 두 번 눌러도 할 일이 두 개 생기지 않게
    var claim = await db.query("UPDATE work_requests SET status = 'accepted', updated_at = now(), responded_at = now() WHERE id = $1 AND status = 'sent' RETURNING *", [w.id]);
    if (!claim.rows.length) return bad(res, '이미 처리된 요청입니다.', 409);
    var key = await makeResult(req, w);
    w = await setStatus(w, 'accepted', { result_key: key });
    await closeSource(w, req.user.name);
    res.json({ data: shapeRow(w) });
    await syncCard(req.tenant.id, w, lineOf(w, req.user.name, w.type === 'event' ? '수락 · 일정에 넣음' : '수락 · 할 일에 넣음'));
  } catch (e) { httpErr.serverError(res, '[wreq/accept]', e); }
});
router.post('/:id/decline', async function (req, res) {
  try {
    var w = await load(req, res, 'to'); if (!w) return;
    if (w.status !== 'sent') return bad(res, '이미 처리된 요청입니다.', 409);
    var reply = String((req.body || {}).reply || '').trim().slice(0, 1000);
    w = await setStatus(w, 'declined', { reply: reply || null });
    res.json({ data: shapeRow(w) });
    await syncCard(req.tenant.id, w, lineOf(w, req.user.name, '반려' + (reply ? ' — ' + reply.slice(0, 120) : '')));
  } catch (e) { httpErr.serverError(res, '[wreq/decline]', e); }
});
router.post('/:id/done', async function (req, res) {
  try {
    var w = await load(req, res, 'to'); if (!w) return;
    if (w.status !== 'sent' && w.status !== 'accepted') return bad(res, '이미 ' + (STATUS_LABEL[w.status] || w.status) + ' 처리된 요청입니다.', 409);
    var m = /^todo:(.+)$/.exec(w.result_key || '');
    if (m) await db.query('UPDATE my_todos SET done_at = COALESCE(done_at, now()), updated_at = now() WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [m[1], req.tenant.id, req.user.sub]);
    var wasSent = w.status === 'sent';
    w = await setStatus(w, 'done');
    if (wasSent) await closeSource(w, req.user.name);
    res.json({ data: shapeRow(w) });
    await syncCard(req.tenant.id, w, lineOf(w, req.user.name, w.type === 'forward' && wasSent ? '확인함' : '완료 ✅'));
  } catch (e) { httpErr.serverError(res, '[wreq/done]', e); }
});
router.post('/:id/cancel', async function (req, res) {
  try {
    var w = await load(req, res, 'from'); if (!w) return;
    if (w.status !== 'sent') return bad(res, '이미 답한 요청은 거둘 수 없습니다.', 409);
    w = await setStatus(w, 'canceled');
    res.json({ data: shapeRow(w) });
    await syncCard(req.tenant.id, w, lineOf(w, req.user.name, '거둠'));
  } catch (e) { httpErr.serverError(res, '[wreq/cancel]', e); }
});

/** 받은 할 일을 끝냄(내 업무 · 텔레그램) → 요청도 완료. 되돌리면 다시 수락 상태로 */
async function onTodoDone(tenantId, userId, todoId, done, userName) {
  try {
    var r = await db.query(
      "UPDATE work_requests SET status = $4, done_at = " + (done ? 'now()' : 'NULL') + ", updated_at = now() WHERE tenant_id = $1 AND to_user_id = $2 AND result_key = $3 AND status = $5 RETURNING *",
      [tenantId, userId, 'todo:' + todoId, done ? 'done' : 'accepted', done ? 'accepted' : 'done']);
    for (var i = 0; i < r.rows.length; i++) await syncCard(tenantId, r.rows[i], lineOf(r.rows[i], userName, done ? '완료 ✅' : '완료를 되돌림'));
  } catch (e) { console.error('[wreq/todo-done]', e.message); }
}

module.exports = router;
module.exports.onTodoDone = onTodoDone;
module.exports.TYPES = TYPES;
