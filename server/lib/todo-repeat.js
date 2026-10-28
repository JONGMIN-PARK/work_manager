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
/** 반복 할 일을 끝내면 다음 회차를 만든다 (같은 회차가 이미 있으면 안 만듦 — 완료를 되돌렸다 다시 해도 하나) */
async function repeatNext(req, id) {
  var r = await db.query('SELECT * FROM my_todos WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [id, req.tenant.id, req.user.sub]);
  var t = r.rows[0];
  if (!t || !t.repeat) return null;
  var due = nextDue(t.due_date, t.repeat);
  var dup = await db.query('SELECT id FROM my_todos WHERE tenant_id = $1 AND user_id = $2 AND title = $3 AND due_date = $4 AND done_at IS NULL', [req.tenant.id, req.user.sub, t.title, due]);
  if (dup.rows.length) return dup.rows[0].id;
  var cl = (Array.isArray(t.checklist) ? t.checklist : []).map(function (c) { return { id: c.id, t: c.t, d: false }; });
  var nid = genId();
  await db.query(
    'INSERT INTO my_todos (id, tenant_id, user_id, title, due_date, due_time, priority, memo, repeat, estimate_h, checklist) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [nid, req.tenant.id, req.user.sub, t.title, due, t.due_time, t.priority, t.memo, t.repeat, t.estimate_h, JSON.stringify(cl)]);
  return nid;
}

module.exports = { nextDue: nextDue, repeatNext: repeatNext };
