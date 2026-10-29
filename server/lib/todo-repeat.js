/**
 * 반복 개인 할 일 (v13.253) — 끝내면 다음 회차를 만든다. 웹(routes/my-work) · 텔레그램(/todo done) 공용
 *   daily 매일 · weekdays 평일(월~금) · weekly 매주 · monthly 매월 (31일은 그 달 말일)
 */
var crypto = require('crypto');
var db = require('../config/db');
var myWork = require('./my-work');
var myEvents = require('./my-events');

function genId() { return 'todo-' + crypto.randomUUID().slice(0, 12); }

/** 반복 할 일 — 다음 마감 */
function nextDue(due, rep) {
  var d = due || myWork.kstToday();
  if (rep === 'daily') return myEvents.addDays(d, 1);
  if (rep === 'weekly') return myEvents.addDays(d, 7);
  if (rep === 'weekdays') {
    var n = myEvents.addDays(d, 1);
    while ([0, 6].indexOf(new Date(n + 'T00:00:00Z').getUTCDay()) >= 0) n = myEvents.addDays(n, 1);
    return n;
  }
  if (rep === 'monthly') {
    var day = +d.slice(8, 10);
    var t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 1));
    var last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(day, last));
    return t.toISOString().slice(0, 10);
  }
  return null;
}
/**
 * 반복 할 일을 끝내면 다음 회차를 만든다 (같은 회차가 이미 있으면 안 만듦 — 완료를 되돌렸다 다시 해도 하나)
 * @param {object} [row] 방금 끝낸 행 (있으면 다시 읽지 않음)
 * @returns {Promise<object|null>} 다음 회차 행 (새로 만들었거나 이미 있던 것)
 */
async function repeatNext(req, id, row) {
  var t = row;
  if (!t) {
    var r = await db.query('SELECT * FROM my_todos WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL', [id, req.tenant.id, req.user.sub]);
    t = r.rows[0];
  }
  if (!t || !t.repeat) return null;
  var due = nextDue(t.due_date, t.repeat);
  // 시작일이 있으면 같은 간격으로 (v13.271) — 시작 3일 전 마감이면 다음 회차도 3일 전 시작
  var start = null;
  if (t.start_date && t.due_date && due && t.start_date <= t.due_date) {
    var gap = Math.round((Date.parse(t.due_date + 'T00:00:00Z') - Date.parse(t.start_date + 'T00:00:00Z')) / 86400000);
    start = new Date(Date.parse(due + 'T00:00:00Z') - gap * 86400000).toISOString().slice(0, 10);
  }
  var cl = (Array.isArray(t.checklist) ? t.checklist : []).map(function (c) { return { id: c.id, t: c.t, d: false }; });
  // 같은 회차가 없을 때만 넣기 — 확인과 넣기를 한 문장으로 (v13.270)
  var ins = await db.query(
    'INSERT INTO my_todos (id, tenant_id, user_id, title, due_date, due_time, priority, memo, repeat, estimate_h, checklist, start_date) ' +
    'SELECT $1::varchar, $2::uuid, $3::uuid, $4::varchar, $5::varchar, $6::varchar, $7::smallint, $8::text, $9::varchar, $10::numeric, $11::jsonb, $12::varchar ' +
    'WHERE NOT EXISTS (SELECT 1 FROM my_todos WHERE tenant_id = $2::uuid AND user_id = $3::uuid AND title = $4::varchar AND due_date = $5::varchar AND done_at IS NULL AND deleted_at IS NULL) RETURNING *',
    [genId(), req.tenant.id, req.user.sub, t.title, due, t.due_time, t.priority, t.memo, t.repeat, t.estimate_h, JSON.stringify(cl), start]);
  if (ins.rows.length) return ins.rows[0];
  var dup = await db.query('SELECT * FROM my_todos WHERE tenant_id = $1 AND user_id = $2 AND title = $3 AND due_date = $4 AND done_at IS NULL AND deleted_at IS NULL LIMIT 1', [req.tenant.id, req.user.sub, t.title, due]);
  return dup.rows[0] || null;
}

module.exports = { nextDue: nextDue, repeatNext: repeatNext };
