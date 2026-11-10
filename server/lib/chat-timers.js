/**
 * ⏰ 메신저 예약 보내기 · 다시 알림 · 요청 자동 재알림 (v13.362)
 *   DB 를 1분마다 보지 않는다(Neon 컴퓨트가 계속 깨어 있음 — 2026-06 사고). 대신
 *   - 켤 때 한 번 + 한 시간에 한 번: 앞으로 70분 안에 올 것만 읽어 메모리 타이머(setTimeout)에 건다
 *   - 새로 만든 것이 70분 안이면 그 자리에서 바로 타이머
 *   - 한 시간에 한 번: 올린 지 4시간 넘게 '접수'인 🛠 요청은 담당자에게 한 번 다시 알림
 *   서버가 여러 대면 같은 것을 두 번 보내지 않게 보낼 때 UPDATE … WHERE sent_at IS NULL RETURNING 으로 한 번만 집는다
 */
var db = require('../config/db');
var WINDOW = 70 * 60000, timers = {}, started = false, hourly = null;

function arm(kind, row) {
  var key = kind + ':' + row.id, at = new Date(row.at || row.send_at || row.remind_at).getTime(), wait = Math.max(0, at - Date.now());
  if (wait > WINDOW || timers[key]) return;
  timers[key] = setTimeout(function () { delete timers[key]; (kind === 's' ? fireScheduled : fireReminder)(row.id).catch(function (e) { console.error('[chat-timers]', kind, e.message); }); }, wait);
  if (timers[key].unref) timers[key].unref();
}
function disarm(kind, id) { var key = kind + ':' + id; if (timers[key]) { clearTimeout(timers[key]); delete timers[key]; } }

/** 앞으로 70분 안 + 이미 지난 것(서버가 꺼져 있던 사이) */
async function loadDue() {
  var until = new Date(Date.now() + WINDOW);
  var s = await db.query('SELECT id, send_at FROM chat_scheduled WHERE sent_at IS NULL AND canceled_at IS NULL AND send_at <= $1 ORDER BY send_at LIMIT 500', [until]);
  s.rows.forEach(function (r) { arm('s', r); });
  var m = await db.query('SELECT id, remind_at FROM chat_reminders WHERE done_at IS NULL AND remind_at <= $1 ORDER BY remind_at LIMIT 500', [until]);
  m.rows.forEach(function (r) { arm('r', r); });
}

async function fireScheduled(id) {
  var r = await db.query('UPDATE chat_scheduled SET sent_at = now() WHERE id = $1 AND sent_at IS NULL AND canceled_at IS NULL RETURNING *', [id]);
  var s = r.rows[0]; if (!s) return null;
  var chat = require('../routes/chat');
  var room = await chat.membership(s.tenant_id, s.room_id, s.user_id);
  if (!room || room.last_read_id == null || room.left_at || room.role === 'readonly') {
    await db.query("UPDATE chat_scheduled SET fail = $2 WHERE id = $1", [id, !room || room.left_at ? '방에서 나감' : '읽기만 멤버']);
    return null;
  }
  var msg = await chat.postMessage({ tenantId: s.tenant_id }, room, { userId: s.user_id, kind: 'text', body: s.body });
  await db.query('UPDATE chat_scheduled SET sent_msg_id = $2 WHERE id = $1', [id, msg.id]);
  require('./chat-hub').publish([s.user_id], 'sched', { roomId: s.room_id, id: +s.id, sent: true });
  return msg;
}

async function fireReminder(id) {
  var r = await db.query('UPDATE chat_reminders SET done_at = now() WHERE id = $1 AND done_at IS NULL RETURNING *', [id]);
  var x = r.rows[0]; if (!x) return null;
  var m = (await db.query("SELECT m.id, m.body, m.post, m.room_id, COALESCE(u.display_name, u.name) AS who, COALESCE(rr.name, pp.name) AS room_name, f.name AS fname FROM chat_messages m JOIN chat_rooms rr ON rr.id = m.room_id LEFT JOIN projects pp ON pp.id = rr.project_id LEFT JOIN users u ON u.id = m.user_id LEFT JOIN chat_files f ON f.id = m.file_id WHERE m.id = $1", [x.msg_id])).rows[0];
  if (!m) return null;
  var body = m.post ? '📌 ' + m.post.title : m.body || (m.fname ? '📎 ' + m.fname : '');
  var payload = { roomId: m.room_id, roomName: m.room_name || '', fromName: m.who || '', body: body, note: x.note || '', msgId: +m.id };
  require('./chat-hub').publish([x.user_id], 'remind', Object.assign({ id: +x.id }, payload));
  await require('../services/notification.service').notify('chat_remind', payload, [x.user_id]);
  return payload;
}

/** 4시간 넘게 '접수'인 🛠 요청 — 담당자에게 한 번 (post.autoNudged 표시) */
async function nudgeStaleRequests() {
  var r = await db.query("SELECT m.id, m.room_id, m.post, COALESCE(rr.name, pp.name) AS room_name FROM chat_messages m JOIN chat_rooms rr ON rr.id = m.room_id LEFT JOIN projects pp ON pp.id = rr.project_id " +
    "WHERE m.post->>'cat' = 'req' AND m.post->>'status' = 'open' AND m.post->>'assignee' IS NOT NULL AND m.deleted_at IS NULL AND (m.post->>'autoNudged') IS NULL " +
    "AND m.created_at < now() - interval '4 hours' AND m.created_at > now() - interval '7 days' LIMIT 200");
  for (var i = 0; i < r.rows.length; i++) {
    var m = r.rows[i], p = m.post;
    var u = await db.query("UPDATE chat_messages SET post = jsonb_set(post, '{autoNudged}', to_jsonb(now()::text)) WHERE id = $1 AND (post->>'autoNudged') IS NULL RETURNING id", [m.id]);
    if (!u.rows.length) continue;
    await require('../services/notification.service').notify('chat_req_nudge', { roomId: m.room_id, roomName: m.room_name || '', title: p.title, equip: p.equip, auto: true, hours: 4 }, [p.assignee]).catch(function () {});
  }
  return r.rows.length;
}

function start() {
  if (started || process.env.NODE_ENV === 'test') return;
  started = true;
  setTimeout(function () { loadDue().catch(function (e) { console.error('[chat-timers] load', e.message); }); }, 5000);
  hourly = setInterval(function () {
    loadDue().catch(function (e) { console.error('[chat-timers] load', e.message); });
    nudgeStaleRequests().catch(function (e) { console.error('[chat-timers] nudge', e.message); });
    try { var dr = require('../routes/chat')._dailyRun; if (dr) dr().catch(function (e) { console.error('[chat-timers] daily', e.message); }); } catch (e) {}   // v13.424 ☀️ 아침 브리핑 · 🚩 내일 마감 (평일 8시대)
    try { var ak = require('../routes/chat')._ackNudge; if (ak) ak().catch(function (e) { console.error('[chat-timers] ack', e.message); }); } catch (e) {}   // v13.381 ✔ 확인 요청 아침 알림
  }, 3600000);
  if (hourly.unref) hourly.unref();
}

module.exports = { start: start, arm: arm, disarm: disarm, loadDue: loadDue, fireScheduled: fireScheduled, fireReminder: fireReminder, nudgeStaleRequests: nudgeStaleRequests, _timers: timers };
