/**
 * 내 업무 · 업무 부하 (v13.248) — 할 일 모으기는 lib/my-work
 *   GET    /api/my-work?userId=          할 일 목록 (최근 7일 안에 끝낸 것 포함)
 *   GET    /api/my-work/people           볼 수 있는 사람 (관리자 · 임원 = 전체, 팀장 = 같은 부서, 그 외 = 나)
 *   PUT    /api/my-work/done             { src, id, userId, done } — 원래 자리에서 완료/되돌리기
 *   POST   /api/my-work/todos            { title, dueDate } 개인 할 일
 *   PUT    /api/my-work/todos/:id        { title?, dueDate?, done? }
 *   DELETE /api/my-work/todos/:id
 *   GET    /api/my-work/load?weeks=&deptId=   업무 부하 (관리자 · 임원 · 팀장)
 *   PUT    /api/my-work/reassign         { src, id, fromUserId, toUserId } — 담당 바꾸기 (관리자 · 임원 · 팀장)
 *   GET    /api/my-work/events?userId=&from=&to=   내 일정 (만든 것 · 담당에 내 이름) — 달력 보기용 (v13.252)
 *   PUT    /api/my-work/due              { src, id, userId, due } — 달력에서 끌어 마감 바꾸기 (todo · mindmap · issue · action)
 *   GET    /api/my-work/feed             내 .ics 구독 주소 (없으면 null)
 *   POST   /api/my-work/feed             구독 주소 만들기 · 다시 만들기 (옛 주소는 끊김)
 *   DELETE /api/my-work/feed             구독 끄기
 *   PUT    /api/my-work/priority         { src, id, userId, priority 1~4 } — 중요도, 원래 자리에 반영 (v13.253)
 *   PUT    /api/my-work/mark             { key, focus } — ⭐ 오늘 집중 (어느 출처든, 내 표시)
 *   PUT    /api/my-work/order            { keys: [...] } — 직접 순서
 *   GET    /api/my-work/directory        같은 회사 활성 사용자 이름 (참석자 · 담당 고르기)
 *
 * 완료 처리 · 담당 바꾸기는 본인 또는 관리자(완료) / 관리자 · 임원 · 팀장(담당)만.
 * 마인드맵 주제는 누가 그 맵을 편집 중이면 바꾸지 않는다 (편집 잠금).
 */
var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');
var myWork = require('../lib/my-work');
var myEvents = require('../lib/my-events');
var prio = require('../lib/priority');
var repeatNext = require('../lib/todo-repeat').repeatNext;

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var LEAD_ROLES = ['admin', 'executive', 'manager'];
var DONE_SRC = ['mindmap', 'issue', 'action', 'dev', 'todo'];
var MOVE_SRC = ['mindmap', 'issue', 'action', 'dev', 'prestudy'];
var DUE_SRC = ['todo', 'mindmap', 'issue', 'action'];

function genId() { return 'todo-' + crypto.randomUUID().slice(0, 12); }
function isLead(req) { return LEAD_ROLES.indexOf(req.user.role) >= 0; }

var USER_COLS = "u.id, u.name, COALESCE(NULLIF(u.display_name,''), u.name) AS display_name, u.department_id, d.name AS department_name, u.role";

/** 내가 볼 수 있는 사람들 (활성) */
async function viewablePeople(req) {
  var params = [req.tenant.id];
  var cond = '';
  if (req.user.role === 'manager') {
    if (!req.user.departmentId) cond = ' AND u.id = $2', params.push(req.user.sub);
    else cond = ' AND (u.department_id = $2 OR u.id = $3)', params.push(req.user.departmentId, req.user.sub);
  } else if (!isLead(req)) {
    cond = ' AND u.id = $2'; params.push(req.user.sub);
  }
  var r = await db.query('SELECT ' + USER_COLS + " FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.tenant_id = $1 AND u.status = 'active'" + cond + ' ORDER BY u.name', params);
  return r.rows;
}

/** 대상 한 사람 — 볼 수 없으면 null */
async function targetUser(req, userId) {
  var id = userId || req.user.sub;
  var people = await viewablePeople(req);
  return people.filter(function (u) { return u.id === id; })[0] || null;
}

function toUser(u) { return { id: u.id, name: u.display_name, dept: u.department_name || '', departmentId: u.department_id || null }; }

// GET /api/my-work/people
router.get('/people', async function (req, res) {
  try {
    var people = await viewablePeople(req);
    res.json({ data: people.map(toUser), canLoad: isLead(req) });
  } catch (e) { httpErr.serverError(res, '[my-work/people]', e); }
});

// GET /api/my-work?userId=
router.get('/', async function (req, res) {
  try {
    // v13.258: 표시(⭐ 집중 · 순서)는 볼 사람 id 만 알면 되므로 권한 확인 · 모으기와 동시에 (예전엔 셋을 차례로)
    var wantId = req.query.userId || req.user.sub;
    var mkP = db.query('SELECT item_key, focus_date, sort_order FROM my_work_marks WHERE user_id = $1 AND tenant_id = $2', [wantId, req.tenant.id]);
    mkP.catch(function () {});
    var u = await targetUser(req, req.query.userId);
    if (!u) return httpErr.sendError(res, 403, 'FORBIDDEN', '이 사람의 업무를 볼 권한이 없습니다.');
    var items = await myWork.collect(req, [u], { done: true });
    var self = u.id === req.user.sub;
    var canDone = self || req.user.role === 'admin';
    items.forEach(function (it) {
      it.canDone = canDone && DONE_SRC.indexOf(it.src) >= 0 && (it.src !== 'todo' || self);
      it.canPri = canDone && prio.SRC.indexOf(it.src) >= 0 && (it.src !== 'todo' || self);
    });
    // ⭐ 오늘 집중 · 직접 순서 — 그 사람 표시 (끝난 일의 표시는 정리)
    var mk = await mkP;
    var byKey = {};
    mk.rows.forEach(function (m) { byKey[m.item_key] = m; });
    items.forEach(function (it) {
      var m = byKey[it.src + ':' + it.id];
      if (!m) return;
      if (m.focus_date && !it.done) it.focus = m.focus_date;
      if (m.sort_order != null) it.order = m.sort_order;
    });
    res.json({ data: items, user: toUser(u), today: myWork.kstToday(), self: self });
  } catch (e) { httpErr.serverError(res, '[my-work/list]', e); }
});

/* ═══ 완료 처리 ═══ */
async function mapLockedByOther(req, mapId) {
  var r = await db.query(
    "SELECT user_name FROM edit_locks WHERE resource_type = 'mindmap' AND resource_id = $1 AND tenant_id = $2 AND user_id <> $3 AND expires_at > now()",
    [mapId, req.tenant.id, req.user.sub]
  );
  return r.rows[0] ? (r.rows[0].user_name || '다른 사용자') : null;
}

/** 맵 주제 하나 고치기 — fn(node) 가 false 를 돌려주면 안 고침. 버전이 맞을 때만 저장 */
async function editMapNode(req, res, mapId, nodeId, fn) {
  var who = await mapLockedByOther(req, mapId);
  if (who) { httpErr.sendError(res, 409, 'LOCKED', who + ' 님이 이 맵을 편집 중입니다. 맵에서 직접 바꾸거나 잠시 뒤에 다시 해 주세요.'); return false; }
  var r = await db.query('SELECT id, doc, version FROM mindmaps WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [mapId, req.tenant.id]);
  if (!r.rows.length) { httpErr.sendError(res, 404, 'NOT_FOUND'); return false; }
  var row = r.rows[0];
  var doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc;
  var node = null;
  ((doc && doc.sheets) || []).some(function (sh) {
    (function walk(n) { if (node || !n) return; if (n.id === nodeId) { node = n; return; } (n.children || []).forEach(walk); })(sh.root);
    return !!node;
  });
  if (!node) { httpErr.sendError(res, 404, 'NOT_FOUND', '주제를 찾을 수 없습니다.'); return false; }
  if (fn(node) === false) { httpErr.sendError(res, 403, 'FORBIDDEN', '이 주제를 바꿀 수 없습니다.'); return false; }
  var u = await db.query('UPDATE mindmaps SET doc = $1, version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $3 AND tenant_id = $4 AND version = $5 RETURNING version',
    [JSON.stringify(doc), req.user.sub, mapId, req.tenant.id, row.version]);
  if (!u.rows.length) { httpErr.sendError(res, 409, 'CONFLICT', '맵이 방금 바뀌었습니다. 다시 해 주세요.'); return false; }
  return true;
}

function splitMapId(id) { var i = String(id).indexOf(':'); return i > 0 ? { mapId: id.slice(0, i), nodeId: id.slice(i + 1) } : null; }

// PUT /api/my-work/done { src, id, userId, done }
router.put('/done', async function (req, res) {
  try {
    var b = req.body || {};
    var done = !!b.done;
    if (DONE_SRC.indexOf(b.src) < 0 || !b.id) return httpErr.sendError(res, 400, 'VALIDATION', '완료로 바꿀 수 없는 항목입니다.');
    var userId = b.userId || req.user.sub;
    if (userId !== req.user.sub && req.user.role !== 'admin') return httpErr.sendError(res, 403, 'FORBIDDEN', '본인 업무만 완료로 바꿀 수 있습니다.');
    if (b.src === 'todo' && userId !== req.user.sub) return httpErr.sendError(res, 403, 'FORBIDDEN');
    // 그 사람 담당이 맞는지 — 목록을 다시 모아 확인 (권한 · 가시성 규칙을 한 곳에)
    var u = await targetUser(req, userId);
    if (!u) return httpErr.sendError(res, 403, 'FORBIDDEN');
    var items = await myWork.collect(req, [u], { done: true, sources: [b.src] });
    var it = items.filter(function (x) { return x.id === b.id; })[0];
    if (!it) return httpErr.sendError(res, 404, 'NOT_FOUND', '담당 업무에서 찾을 수 없습니다.');
    var tid = req.tenant.id;
    var today = myWork.kstToday();
    var next = null;   // 반복 할 일의 다음 회차
    if (b.src === 'issue') {
      await db.query(
        "UPDATE issues SET status = $1::varchar, resolved_date = CASE WHEN $1::varchar = 'resolved' THEN COALESCE(NULLIF(resolved_date, ''), $2::varchar) ELSE resolved_date END, updated_by = $3, updated_at = now() WHERE id = $4 AND tenant_id = $5",
        [done ? 'resolved' : 'inProgress', today, req.user.sub, b.id, tid]);
    } else if (b.src === 'action') {
      await db.query(done
        ? "UPDATE meeting_action_items SET status = 'done', done_at = COALESCE(done_at, now()) WHERE id = $1 AND tenant_id = $2"
        : "UPDATE meeting_action_items SET status = 'open', done_at = NULL WHERE id = $1 AND tenant_id = $2", [b.id, tid]);
    } else if (b.src === 'dev') {
      await db.query('UPDATE project_dev_items SET status = $1, version = version + 1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4',
        [done ? 'done' : 'doing', req.user.sub, b.id, tid]);
    } else if (b.src === 'todo') {
      await db.query('UPDATE my_todos SET done_at = ' + (done ? 'COALESCE(done_at, now())' : 'NULL') + ', updated_at = now() WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [b.id, tid, req.user.sub]);
      if (done) next = await repeatNext(req, b.id);
    } else if (b.src === 'mindmap') {
      var mp = splitMapId(b.id);
      var ok = await editMapNode(req, res, mp.mapId, mp.nodeId, function (n) {
        if (n.assigneeId !== userId) return false;
        if (done) { n.done = true; n.doneAt = n.doneAt || new Date().toISOString(); }
        else { delete n.done; delete n.doneAt; if (parseInt(n.progress, 10) >= 100) delete n.progress; }
      });
      if (!ok) return;
    }
    res.json({ data: { src: b.src, id: b.id, done: done, next: next || null } });
  } catch (e) { httpErr.serverError(res, '[my-work/done]', e); }
});

/* ═══ 개인 할 일 ═══ */
function cleanDue(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
function cleanTime(v) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  return m && +m[1] <= 23 && +m[2] <= 59 ? (m[1].length === 1 ? '0' : '') + m[1] + ':' + m[2] : null;
}
var TODO_STATUS = ['todo', 'doing', 'waiting'];
var TODO_REPEAT = ['daily', 'weekdays', 'weekly', 'monthly'];
function cleanChecklist(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 50).map(function (c, i) {
    var t = String((c && c.t) || '').trim().slice(0, 200);
    return t ? { id: String((c && c.id) || ('c' + Date.now().toString(36) + i)).slice(0, 30), t: t, d: !!(c && c.d) } : null;
  }).filter(Boolean);
}
/** 본문 → 고칠 칸들 [[sql, value]] — 잘못된 값은 VALIDATION 오류 문자열 */
function todoFields(b) {
  var f = [];
  if (b.title !== undefined) {
    var t = String(b.title || '').trim().slice(0, 500);
    if (!t) return '할 일을 입력하세요.';
    f.push(['title', t]);
  }
  if (b.dueDate !== undefined) f.push(['due_date', cleanDue(b.dueDate)]);
  if (b.dueTime !== undefined) f.push(['due_time', cleanTime(b.dueTime)]);
  if (b.priority !== undefined) {
    if (!prio.clamp(b.priority)) return '중요도는 1~4 입니다.';
    f.push(['priority', prio.clamp(b.priority)]);
  }
  if (b.status !== undefined) {
    if (TODO_STATUS.indexOf(b.status) < 0) return '상태 값이 맞지 않습니다.';
    f.push(['status', b.status]);
  }
  if (b.waitingFor !== undefined) f.push(['waiting_for', String(b.waitingFor || '').trim().slice(0, 100) || null]);
  if (b.memo !== undefined) f.push(['memo', String(b.memo || '').slice(0, 5000) || null]);
  if (b.repeat !== undefined) {
    if (b.repeat && TODO_REPEAT.indexOf(b.repeat) < 0) return '반복 값이 맞지 않습니다.';
    f.push(['repeat', b.repeat || null]);
  }
  if (b.estimateH !== undefined) {
    var h = b.estimateH === null || b.estimateH === '' ? null : Number(b.estimateH);
    if (h !== null && (isNaN(h) || h < 0 || h > 999)) return '예상 시간이 맞지 않습니다.';
    f.push(['estimate_h', h ? Math.round(h * 10) / 10 : null]);
  }
  if (b.checklist !== undefined) f.push(['checklist', JSON.stringify(cleanChecklist(b.checklist))]);
  return f;
}

router.post('/todos', async function (req, res) {
  try {
    var b = req.body || {};
    if (!String(b.title || '').trim()) return httpErr.sendError(res, 400, 'VALIDATION', '할 일을 입력하세요.');
    var f = todoFields(b);
    if (typeof f === 'string') return httpErr.sendError(res, 400, 'VALIDATION', f);
    var n = await db.query('SELECT COUNT(*)::int AS n FROM my_todos WHERE tenant_id = $1 AND user_id = $2 AND done_at IS NULL', [req.tenant.id, req.user.sub]);
    if (n.rows[0].n >= 300) return httpErr.sendError(res, 400, 'VALIDATION', '끝나지 않은 개인 할 일은 300개까지입니다.');
    var cols = ['id', 'tenant_id', 'user_id'], vals = [genId(), req.tenant.id, req.user.sub];
    f.forEach(function (x) { cols.push(x[0]); vals.push(x[1]); });
    var r = await db.query('INSERT INTO my_todos (' + cols.join(', ') + ') VALUES (' + vals.map(function (_, i) { return '$' + (i + 1); }).join(',') + ') RETURNING *', vals);
    res.status(201).json({ data: r.rows[0] });
  } catch (e) { httpErr.serverError(res, '[my-work/todo-create]', e); }
});

router.put('/todos/:id', async function (req, res) {
  try {
    var b = req.body || {};
    var f = todoFields(b);
    if (typeof f === 'string') return httpErr.sendError(res, 400, 'VALIDATION', f);
    var sets = [], params = [];
    f.forEach(function (x) { params.push(x[1]); sets.push(x[0] + ' = $' + params.length); });
    if (b.done !== undefined) sets.push(b.done ? 'done_at = COALESCE(done_at, now())' : 'done_at = NULL');
    if (!sets.length) return httpErr.sendError(res, 400, 'VALIDATION', '바꿀 내용이 없습니다.');
    params.push(req.params.id, req.tenant.id, req.user.sub);
    var r = await db.query('UPDATE my_todos SET ' + sets.join(', ') + ', updated_at = now() WHERE id = $' + (params.length - 2) + ' AND tenant_id = $' + (params.length - 1) + ' AND user_id = $' + params.length + ' RETURNING *', params);
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var next = b.done ? await repeatNext(req, req.params.id) : null;
    res.json({ data: r.rows[0], next: next });
  } catch (e) { httpErr.serverError(res, '[my-work/todo-update]', e); }
});

router.delete('/todos/:id', async function (req, res) {
  try {
    var r = await db.query('DELETE FROM my_todos WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [req.params.id, req.tenant.id, req.user.sub]);
    if (!r.rowCount) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: { id: req.params.id } });
  } catch (e) { httpErr.serverError(res, '[my-work/todo-delete]', e); }
});

/* ═══ 업무 부하 ═══ */
// GET /api/my-work/load?weeks=8&deptId=
router.get('/load', async function (req, res) {
  try {
    if (!isLead(req)) return httpErr.sendError(res, 403, 'FORBIDDEN', '관리자 · 임원 · 팀장만 볼 수 있습니다.');
    var weeks = Math.max(2, Math.min(12, parseInt(req.query.weeks, 10) || 8));
    var people = await viewablePeople(req);
    if (req.query.deptId) people = people.filter(function (u) { return u.department_id === req.query.deptId; });
    // v13.258: 주 칸은 오늘만으로 정해지므로 휴가 조회를 모으기와 동시에
    var w0 = myWork.loadGrid([], weeks).weeks[0];
    var got = await Promise.all([myWork.collect(req, people, { load: true }), leaveDays(req, people, w0, myEvents.addDays(w0, weeks * 7 - 1))]);
    var items = got[0], leaves = got[1];
    var grid = myWork.loadGrid(items, weeks);
    // 칸을 누르면 볼 목록 — 개인 할 일은 제목 없이
    res.json({ data: { users: people.map(toUser), weeks: grid.weeks, today: grid.today, rows: grid.rows, items: items, leaves: leaves } });
  } catch (e) { httpErr.serverError(res, '[my-work/load]', e); }
});

/** 휴가 (연차 · 반차 일정) — { userId: [{ date, type }] } 주말 · 반복 회차 포함. 일정의 담당(이름) 또는 만든 사람(개인 일정) */
async function leaveDays(req, people, from, to) {
  var names = people.map(function (u) { return u.name; });
  var byName = {}, out = {};
  people.forEach(function (u) { byName[u.name] = u.id; });
  var r = await db.query(
    "SELECT * FROM events WHERE tenant_id = $1 AND type IN ('dayoff','amoff','pmoff') AND start_date <= $2 " +
    "AND (COALESCE(NULLIF(end_date, ''), start_date) >= $3 OR (repeat IN ('weekly','biweekly','monthly') AND (COALESCE(repeat_until, '') = '' OR repeat_until >= $3))) " +
    "AND (created_by = ANY($4) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(assignees, '[]'::jsonb)) a WHERE a = ANY($5)))",
    [req.tenant.id, to, from, people.map(function (u) { return u.id; }), names]);
  r.rows.forEach(function (ev) {
    var who = (Array.isArray(ev.assignees) ? ev.assignees : []).map(function (n) { return byName[n]; }).filter(Boolean);
    if (!who.length && people.some(function (u) { return u.id === ev.created_by; })) who = [ev.created_by];
    myEvents.occurrences(ev, from, to).forEach(function (o) {
      for (var d = o.date; d <= o.end; d = myEvents.addDays(d, 1)) {
        if (d < from || d > to) continue;
        var w = new Date(d + 'T00:00:00Z').getUTCDay();
        if (w === 0 || w === 6) continue;
        who.forEach(function (uid) { (out[uid] = out[uid] || []).push({ date: d, type: ev.type }); });
      }
    });
  });
  return out;
}

// PUT /api/my-work/reassign { src, id, fromUserId, toUserId }
router.put('/reassign', async function (req, res) {
  try {
    if (!isLead(req)) return httpErr.sendError(res, 403, 'FORBIDDEN', '관리자 · 임원 · 팀장만 담당을 바꿀 수 있습니다.');
    var b = req.body || {};
    if (MOVE_SRC.indexOf(b.src) < 0 || !b.id) return httpErr.sendError(res, 400, 'VALIDATION', '담당을 바꿀 수 없는 항목입니다.');
    var people = await viewablePeople(req);
    var by = {};
    people.forEach(function (u) { by[u.id] = u; });
    var from = by[b.fromUserId], to = by[b.toUserId];
    if (!from || !to) return httpErr.sendError(res, 403, 'FORBIDDEN', '담당을 바꿀 수 없는 사람입니다.');
    if (from.id === to.id) return res.json({ data: { id: b.id } });
    var items = await myWork.collect(req, [from], { sources: [b.src], load: true });
    if (!items.some(function (x) { return x.id === b.id; })) return httpErr.sendError(res, 404, 'NOT_FOUND', '그 사람의 업무에서 찾을 수 없습니다.');
    var tid = req.tenant.id;
    if (b.src === 'issue') {
      var cur = await db.query('SELECT assignees FROM issues WHERE id = $1 AND tenant_id = $2', [b.id, tid]);
      var list = cur.rows[0] && cur.rows[0].assignees;
      if (typeof list === 'string') { try { list = JSON.parse(list); } catch (_) { list = []; } }
      list = (Array.isArray(list) ? list : []).filter(function (n) { return n !== from.name; });
      if (list.indexOf(to.name) < 0) list.push(to.name);
      await db.query('UPDATE issues SET assignees = $1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [JSON.stringify(list), req.user.sub, b.id, tid]);
    } else if (b.src === 'action') {
      await db.query('UPDATE meeting_action_items SET assignee_id = $1, assignee_name = $2 WHERE id = $3 AND tenant_id = $4', [to.id, to.name, b.id, tid]);
    } else if (b.src === 'dev') {
      await db.query('UPDATE project_dev_items SET assignee_id = $1, version = version + 1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [to.id, req.user.sub, b.id, tid]);
    } else if (b.src === 'prestudy') {
      await db.query('UPDATE prestudies SET owner_id = $1, version = version + 1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [to.id, req.user.sub, b.id, tid]);
    } else if (b.src === 'mindmap') {
      var mp = splitMapId(b.id);
      var ok = await editMapNode(req, res, mp.mapId, mp.nodeId, function (n) {
        if (n.assigneeId !== from.id) return false;
        n.assigneeId = to.id; delete n.assigneeName;
      });
      if (!ok) return;
    }
    res.json({ data: { src: b.src, id: b.id, userId: to.id } });
  } catch (e) { httpErr.serverError(res, '[my-work/reassign]', e); }
});

/* ═══ 달력 (v13.252) ═══ */
function cleanYmd(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }

// GET /api/my-work/events?userId=&from=&to=
router.get('/events', async function (req, res) {
  try {
    var u = await targetUser(req, req.query.userId);
    if (!u) return httpErr.sendError(res, 403, 'FORBIDDEN', '이 사람의 일정을 볼 권한이 없습니다.');
    var today = myWork.kstToday();
    var from = cleanYmd(req.query.from) || myEvents.addDays(today, -31);
    var to = cleanYmd(req.query.to) || myEvents.addDays(today, 62);
    if (myWork.daysBetween(from, to) > 400) return httpErr.sendError(res, 400, 'VALIDATION', '기간이 너무 깁니다.');
    var rows = await myEvents.eventsFor(req, u, from, to);
    await myEvents.markCanModify(req, rows);
    res.json({ data: rows, from: from, to: to });
  } catch (e) { httpErr.serverError(res, '[my-work/events]', e); }
});

// PUT /api/my-work/due { src, id, userId, due } — 마감 바꾸기 (due 가 null 이면 마감 없앰)
router.put('/due', async function (req, res) {
  try {
    var b = req.body || {};
    if (DUE_SRC.indexOf(b.src) < 0 || !b.id) return httpErr.sendError(res, 400, 'VALIDATION', '여기서 마감을 바꿀 수 없는 항목입니다. 원래 화면에서 바꿔 주세요.');
    var due = b.due == null || b.due === '' ? null : cleanYmd(b.due);
    if (b.due && !due) return httpErr.sendError(res, 400, 'VALIDATION', '날짜 형식이 맞지 않습니다.');
    var userId = b.userId || req.user.sub;
    if (userId !== req.user.sub && req.user.role !== 'admin') return httpErr.sendError(res, 403, 'FORBIDDEN', '본인 업무만 마감을 바꿀 수 있습니다.');
    if (b.src === 'todo' && userId !== req.user.sub) return httpErr.sendError(res, 403, 'FORBIDDEN');
    var u = await targetUser(req, userId);
    if (!u) return httpErr.sendError(res, 403, 'FORBIDDEN');
    var items = await myWork.collect(req, [u], { done: true, sources: [b.src] });
    if (!items.some(function (x) { return x.id === b.id; })) return httpErr.sendError(res, 404, 'NOT_FOUND', '담당 업무에서 찾을 수 없습니다.');
    var tid = req.tenant.id;
    if (b.src === 'todo') {
      await db.query('UPDATE my_todos SET due_date = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3 AND user_id = $4', [due, b.id, tid, req.user.sub]);
    } else if (b.src === 'issue') {
      await db.query('UPDATE issues SET due_date = $1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [due, req.user.sub, b.id, tid]);
    } else if (b.src === 'action') {
      await db.query('UPDATE meeting_action_items SET due_date = $1 WHERE id = $2 AND tenant_id = $3', [due, b.id, tid]);
    } else if (b.src === 'mindmap') {
      var mp = splitMapId(b.id);
      var ok = await editMapNode(req, res, mp.mapId, mp.nodeId, function (n) {
        if (n.assigneeId !== userId) return false;
        if (due) n.dueDate = due; else delete n.dueDate;
      });
      if (!ok) return;
    }
    res.json({ data: { src: b.src, id: b.id, due: due } });
  } catch (e) { httpErr.serverError(res, '[my-work/due]', e); }
});

/* ═══ 중요도 · 오늘 집중 · 순서 (v13.253) ═══ */
// PUT /api/my-work/priority { src, id, userId, priority }
router.put('/priority', async function (req, res) {
  try {
    var b = req.body || {};
    var p = prio.clamp(b.priority);
    if (prio.SRC.indexOf(b.src) < 0 || !b.id) return httpErr.sendError(res, 400, 'VALIDATION', '중요도를 바꿀 수 없는 항목입니다.');
    if (!p) return httpErr.sendError(res, 400, 'VALIDATION', '중요도는 1~4 입니다.');
    var userId = b.userId || req.user.sub;
    if (userId !== req.user.sub && req.user.role !== 'admin') return httpErr.sendError(res, 403, 'FORBIDDEN', '본인 업무만 중요도를 바꿀 수 있습니다.');
    if (b.src === 'todo' && userId !== req.user.sub) return httpErr.sendError(res, 403, 'FORBIDDEN');
    var u = await targetUser(req, userId);
    if (!u) return httpErr.sendError(res, 403, 'FORBIDDEN');
    var items = await myWork.collect(req, [u], { done: true, sources: [b.src] });
    if (!items.some(function (x) { return x.id === b.id; })) return httpErr.sendError(res, 404, 'NOT_FOUND', '담당 업무에서 찾을 수 없습니다.');
    var tid = req.tenant.id;
    if (b.src === 'todo') {
      await db.query('UPDATE my_todos SET priority = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3 AND user_id = $4', [p, b.id, tid, req.user.sub]);
    } else if (b.src === 'issue') {
      await db.query('UPDATE issues SET urgency = $1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [prio.toWord(p), req.user.sub, b.id, tid]);
    } else if (b.src === 'action') {
      await db.query('UPDATE meeting_action_items SET priority = $1 WHERE id = $2 AND tenant_id = $3', [p, b.id, tid]);
    } else if (b.src === 'dev') {
      await db.query('UPDATE project_dev_items SET priority = $1, version = version + 1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [prio.toWord(p), req.user.sub, b.id, tid]);
    } else if (b.src === 'prestudy') {
      await db.query('UPDATE prestudies SET priority = $1, version = version + 1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [prio.toWord(p), req.user.sub, b.id, tid]);
    } else if (b.src === 'mindmap') {
      var mp = splitMapId(b.id);
      var ok = await editMapNode(req, res, mp.mapId, mp.nodeId, function (n) {
        if (n.assigneeId !== userId) return false;
        prio.setMarkers(n, p);
      });
      if (!ok) return;
    }
    res.json({ data: { src: b.src, id: b.id, priority: p } });
  } catch (e) { httpErr.serverError(res, '[my-work/priority]', e); }
});

function cleanKey(k) { return typeof k === 'string' && /^[a-z]+:[^\s]{1,190}$/.test(k) ? k : null; }

// PUT /api/my-work/mark { key, focus } — 내 표시만
router.put('/mark', async function (req, res) {
  try {
    var b = req.body || {};
    var key = cleanKey(b.key);
    if (!key) return httpErr.sendError(res, 400, 'VALIDATION', '항목이 맞지 않습니다.');
    var focus = b.focus ? myWork.kstToday() : null;
    await db.query(
      'INSERT INTO my_work_marks (user_id, item_key, tenant_id, focus_date) VALUES ($1, $2, $3, $4) ' +
      'ON CONFLICT (user_id, item_key) DO UPDATE SET focus_date = EXCLUDED.focus_date, updated_at = now()',
      [req.user.sub, key, req.tenant.id, focus]);
    res.json({ data: { key: key, focus: focus } });
  } catch (e) { httpErr.serverError(res, '[my-work/mark]', e); }
});

// PUT /api/my-work/order { keys: [...] } — 이 순서대로 0,1,2…
router.put('/order', async function (req, res) {
  try {
    var keys = ((req.body || {}).keys || []).map(cleanKey);
    if (!keys.length || keys.length > 500 || keys.some(function (k) { return !k; })) return httpErr.sendError(res, 400, 'VALIDATION', '항목이 맞지 않습니다.');
    await db.query(
      'INSERT INTO my_work_marks (user_id, item_key, tenant_id, sort_order) SELECT $1, k, $2, (o - 1)::int FROM unnest($3::text[]) WITH ORDINALITY AS t(k, o) ' +
      'ON CONFLICT (user_id, item_key) DO UPDATE SET sort_order = EXCLUDED.sort_order, updated_at = now()',
      [req.user.sub, req.tenant.id, keys]);
    res.json({ data: { n: keys.length } });
  } catch (e) { httpErr.serverError(res, '[my-work/order]', e); }
});

// GET /api/my-work/directory — 같은 회사 활성 사용자 (이름 · 부서만)
router.get('/directory', async function (req, res) {
  try {
    var r = await db.query('SELECT ' + USER_COLS + " FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.tenant_id = $1 AND u.status = 'active' ORDER BY u.name", [req.tenant.id]);
    res.json({ data: r.rows.map(function (u) { return { id: u.id, name: u.name, display: u.display_name, dept: u.department_name || '' }; }) });
  } catch (e) { httpErr.serverError(res, '[my-work/directory]', e); }
});

/* ═══ .ics 구독 주소 ═══ */
function feedUrl(req, token) {
  var proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  var host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return proto + '://' + host + '/api/ics/' + token + '.ics';
}

router.get('/feed', async function (req, res) {
  try {
    var r = await db.query('SELECT token, created_at, last_used_at FROM calendar_feeds WHERE user_id = $1 AND tenant_id = $2', [req.user.sub, req.tenant.id]);
    var f = r.rows[0];
    res.json({ data: f ? { url: feedUrl(req, f.token), createdAt: f.created_at, lastUsedAt: f.last_used_at } : null });
  } catch (e) { httpErr.serverError(res, '[my-work/feed]', e); }
});

router.post('/feed', async function (req, res) {
  try {
    var token = crypto.randomBytes(24).toString('hex');
    await db.query(
      'INSERT INTO calendar_feeds (user_id, tenant_id, token) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, tenant_id = EXCLUDED.tenant_id, created_at = now(), last_used_at = NULL',
      [req.user.sub, req.tenant.id, token]);
    res.json({ data: { url: feedUrl(req, token), createdAt: new Date().toISOString(), lastUsedAt: null } });
  } catch (e) { httpErr.serverError(res, '[my-work/feed-create]', e); }
});

router.delete('/feed', async function (req, res) {
  try {
    await db.query('DELETE FROM calendar_feeds WHERE user_id = $1 AND tenant_id = $2', [req.user.sub, req.tenant.id]);
    res.json({ data: null });
  } catch (e) { httpErr.serverError(res, '[my-work/feed-delete]', e); }
});

module.exports = router;
