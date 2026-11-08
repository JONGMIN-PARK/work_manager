/**
 * 💬 사내 메신저 (v13.315) — /api/chat
 *   기본: 방(1:1 · 그룹 · 프로젝트) · 실시간(SSE) · 읽음 · @멘션 · 답글 스레드 · 파일 · 수정/삭제 · 검색 · 알림(못 보면 텔레그램)
 *   데이터: 업무 카드(통합 검색에서 고른 것 — 이슈는 카드 안 버튼으로 상태 처리) · 프로젝트 방 옆 현황(진척 · 이슈 · 마일스톤)
 *          /todo · /issue · /ai 질문(내 권한 데이터로 답) · /요약
 *   권한: 같은 테넌트 · 방 멤버만 읽고 씀. 프로젝트 방은 그 프로젝트를 볼 수 있으면 들어올 수 있음(들어오면 멤버)
 *   화면 공유 신호: POST /rooms/:id/rtc → 상대에게 그대로 전달(WebRTC offer · answer · ice)
 */
var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');
var hub = require('../lib/chat-hub');
var pa = require('../lib/project-access');

var MAX_BODY = 8000, MAX_FILE = 25 * 1024 * 1024, PAGE = 50;
var FALLBACK_MS = +(process.env.CHAT_FALLBACK_MS || 60000);   // 이만큼 지나도 안 읽으면 알림(텔레그램 · 앱 알림)

function rid(p) { return p + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 16); }
function me(req) { return req.user.sub; }
function actor(req) { return { user_id: req.user.sub, tenant_id: req.tenant.id, role: req.user.role, department_id: req.user.departmentId || null, name: req.user.name || '' }; }
function bad(res, msg, code) { return res.status(code || 400).json({ error: 'VALIDATION', message: msg }); }
function kstToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }

async function membership(tenantId, roomId, userId) {
  var r = await db.query(
    'SELECT r.*, m.last_read_id, m.muted, m.pinned, m.left_at, m.role, m.hist_from, m.joined_at FROM chat_rooms r LEFT JOIN chat_members m ON m.room_id = r.id AND m.user_id = $3 ' +
    'WHERE r.id = $1 AND r.tenant_id = $2', [roomId, tenantId, userId]);
  return r.rows[0] || null;
}
/** 방 멤버 확인 — 프로젝트 방은 볼 수 있으면 자동으로 들어옴 */
async function roomFor(req, res, roomId) {
  var room = await membership(req.tenant.id, roomId, me(req));
  if (!room) { res.status(404).json({ error: 'NOT_FOUND', message: '대화방이 없습니다.' }); return null; }
  var isMember = room.last_read_id != null && !room.left_at;
  if (!isMember && room.kind === 'project' && room.project_id && await pa.canReadById(req, room.project_id)) {
    await db.query('INSERT INTO chat_members (room_id, user_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL', [room.id, me(req), req.tenant.id]); _midDrop(room.id);
    return membership(req.tenant.id, roomId, me(req));
  }
  if (!isMember) { res.status(403).json({ error: 'FORBIDDEN', message: '이 대화방의 멤버가 아닙니다.' }); return null; }
  return room;
}
/** 읽기만 하는 멤버는 쓰기 막음 (v13.359) */
function readOnly(res, room) {
  if (room && room.role === 'readonly') { res.status(403).json({ error: 'READONLY', message: '읽기만 하는 멤버입니다 — 방장에게 말해 주세요.' }); return true; }
  return false;
}
/** 방 관리(역할 · 내보내기): 방장 · 관리자 · 방장이 없는 방은 만든 사람 */
async function canManage(req, room) {
  if (req.user.role === 'admin' || room.role === 'owner') return true;
  var o = await db.query("SELECT 1 FROM chat_members WHERE room_id = $1 AND role = 'owner' AND left_at IS NULL", [room.id]);
  return !o.rows.length && room.created_by === me(req);
}
/** 🎯 집중 중인 사람 (v13.363) → { uid: { until, allow } } */
async function focusOf(ids) {
  if (!ids || !ids.length) return {};
  var r = await db.query('SELECT user_id, focus_until, focus_allow FROM chat_user_state WHERE user_id = ANY($1) AND focus_until > now()', [ids]);
  var o = {}; r.rows.forEach(function (x) { o[x.user_id] = { until: x.focus_until, allow: x.focus_allow }; }); return o;
}
/** 집중 중이어도 받을 것: '받기' 켰고 @멘션이거나 나에게 온 긴급 요청 */
function focusPass(f, uid, msg, mentions) {
  if (!f) return true;
  if (!f.allow) return false;
  return (mentions || []).indexOf(uid) >= 0 || !!(msg && msg.post && msg.post.urgency === 'urgent' && msg.post.assignee === uid);
}
/* v13.366 100명+ — 방 멤버 목록은 메시지 · 읽음 · 입력 중마다 쓰므로 잠깐 담아 둠(멤버가 바뀌면 바로 지움) */
var MID = new Map(), MID_TTL = 15000;
async function memberIds(roomId) {
  var c = MID.get(roomId);
  if (c && c.exp > Date.now()) return c.ids.slice();
  var r = await db.query('SELECT user_id FROM chat_members WHERE room_id = $1 AND left_at IS NULL', [roomId]);
  var ids = r.rows.map(function (x) { return x.user_id; });
  MID.set(roomId, { ids: ids, exp: Date.now() + MID_TTL });
  if (MID.size > 5000) MID.delete(MID.keys().next().value);
  return ids.slice();
}
function _midDrop(roomId) { MID.delete(roomId); if (typeof FACL !== 'undefined') FACL.clear(); }
async function userNames(tenantId, ids) {
  if (!ids.length) return {};
  var r = await db.query('SELECT id, COALESCE(display_name, name) AS n FROM users WHERE id = ANY($1) AND tenant_id = $2', [ids, tenantId]);
  var o = {}; r.rows.forEach(function (u) { o[u.id] = u.n; }); return o;
}

/* ─── 메시지 모양 ─── */
var MSG_SQL = 'SELECT m.id, m.room_id, m.user_id, m.kind, m.body, m.cards, m.mentions, m.reply_to, m.edited_at, m.deleted_at, m.created_at, m.reactions, m.post, ' +
  'COALESCE(u.display_name, u.name) AS user_name, f.id AS f_id, f.name AS f_name, f.mime AS f_mime, f.size AS f_size, ' +
  "CASE WHEN m.post IS NULL THEN NULL ELSE (SELECT COALESCE(ua.display_name, ua.name) FROM users ua WHERE ua.id::text = m.post->>'assignee') END AS asg_name, " +
  "(f.annot->>'rot')::int AS f_rot, jsonb_array_length(COALESCE(f.annot->'shapes', '[]'::jsonb)) AS f_n, (f.annot->'crop') IS NOT NULL AND f.annot->>'crop' <> 'null' AS f_crop, " +
  'rp.replies, rp.last_reply_at ' +
  'FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN chat_files f ON f.id = m.file_id ' +
  'LEFT JOIN LATERAL (SELECT COUNT(*)::int AS replies, MAX(t.created_at) AS last_reply_at FROM chat_messages t WHERE t.reply_to = m.id AND t.deleted_at IS NULL) rp ON TRUE ';
function shape(r) {
  return { id: +r.id, roomId: r.room_id, userId: r.user_id, userName: r.user_name || (r.kind === 'ai' ? 'AI' : ''), kind: r.kind,
    body: r.deleted_at ? '' : r.body, deleted: !!r.deleted_at, edited: !!r.edited_at, cards: r.deleted_at ? null : r.cards, mentions: r.mentions || [],
    replyTo: r.reply_to ? +r.reply_to : null, replies: r.replies || 0, lastReplyAt: r.last_reply_at, reactions: r.deleted_at ? null : r.reactions || null,
    post: r.deleted_at || !r.post ? null : Object.assign({}, r.post, { assigneeName: r.asg_name || null }), file: r.f_id && !r.deleted_at ? annSum({ id: r.f_id, name: r.f_name, mime: r.f_mime, size: r.f_size }, r) : null, at: r.created_at };
}
// 사진 칠판 요약 — 목록에선 회전 · 표시 수 · 자름 여부만 (전체는 /files/:fid/annot)
function annSum(f, r) { if (r.f_rot || r.f_n || r.f_crop) f.annot = { rot: r.f_rot || 0, n: r.f_n || 0, crop: !!r.f_crop }; return f; }
async function loadMsg(id) { var r = await db.query(MSG_SQL + 'WHERE m.id = $1', [id]); return r.rows.length ? shape(r.rows[0]) : null; }

/* @이름 → 멤버 id */
async function findMentions(tenantId, roomId, body) {
  if (body.indexOf('@') < 0) return [];
  var r = await db.query('SELECT u.id, COALESCE(u.display_name, u.name) AS n, u.name FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = $1 AND m.left_at IS NULL AND u.tenant_id = $2', [roomId, tenantId]);
  var out = [];
  r.rows.forEach(function (u) { [u.n, u.name].forEach(function (nm) { if (nm && body.indexOf('@' + nm) >= 0 && out.indexOf(u.id) < 0) out.push(u.id); }); });
  if (/@(모두|all|everyone)\b/.test(body)) r.rows.forEach(function (u) { if (out.indexOf(u.id) < 0) out.push(u.id); });
  return out;
}

/* 업무 카드 — 통합 검색 결과 그대로 (최대 5) · 이슈는 서버에서 지금 상태로 */
var CARD_TYPES = ['project', 'milestone', 'issue', 'order', 'meeting', 'mindmap', 'doc', 'dev', 'checklist', 'as', 'todo', 'note', 'weekly', 'prestudy', 'tech', 'work', 'comment', 'member', 'message'];
async function cleanCards(req, cards) {
  if (!Array.isArray(cards) || !cards.length) return null;
  var out = [];
  for (var i = 0; i < cards.length && out.length < 5; i++) {
    var c = cards[i] || {};
    if (CARD_TYPES.indexOf(c.type) < 0 || !c.id) continue;
    var o = { type: c.type, id: String(c.id).slice(0, 100), title: String(c.title || '').slice(0, 200), sub: String(c.sub || '').slice(0, 200), nav: c.nav && typeof c.nav === 'object' ? JSON.parse(JSON.stringify(c.nav).slice(0, 600)) : null };
    if (c.type === 'issue') {
      var row = await require('../telegram/actions').gateIssue(actor(req), o.id, 'read');
      if (!row) continue;
      o.title = row.title; o.status = row.status; o.urgency = row.urgency;
    }
    out.push(o);
  }
  return out.length ? out : null;
}

/** 메시지 넣고 퍼뜨리기 — 텔레그램 답장 · 쪽지 옮김도 이 길로 */
async function postMessage(ctx, room, m) {
  var body = String(m.body || '').slice(0, MAX_BODY);
  var mentions = m.mentions || (m.kind === 'text' || !m.kind ? await findMentions(ctx.tenantId, room.id, body) : []);
  var ins = await db.query(
    'INSERT INTO chat_messages (room_id, tenant_id, user_id, kind, body, cards, file_id, mentions, reply_to, legacy_id, post) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
    [room.id, ctx.tenantId, m.userId || null, m.kind || 'text', body, m.cards ? JSON.stringify(m.cards) : null, m.fileId || null, JSON.stringify(mentions), m.replyTo || null, m.legacyId || null, m.post ? JSON.stringify(m.post) : null]);
  var id = +ins.rows[0].id;
  var par = await Promise.all([
    db.query('UPDATE chat_rooms SET last_msg_at = now() WHERE id = $1', [room.id]),
    m.userId ? db.query('UPDATE chat_members SET last_read_id = GREATEST(last_read_id, $3) WHERE room_id = $1 AND user_id = $2', [room.id, m.userId, id]) : null,
    loadMsg(id), memberIds(room.id)
  ]);
  var msg = par[2], ids = par[3];
  hub.publish(ids, 'msg', msg);
  if (m.replyTo) { var parent = await loadMsg(m.replyTo); if (parent) hub.publish(ids, 'upd', parent); }
  if (m.userId && (m.kind || 'text') !== 'system') pushOffline(room, msg, ids.filter(function (u) { return u !== m.userId; }), mentions);
  if (m.userId && (m.kind || 'text') !== 'system') scheduleFallback(ctx.tenantId, room, msg, ids.filter(function (u) { return u !== m.userId; }), mentions);
  return msg;
}

/* 📲 접속 안 한 사람에게 바로 휴대폰 푸시 (v13.359) — 음소거 방은 @멘션만 */
var PUSH_GATE = new Map(), PUSH_GAP_MS = +(process.env.CHAT_PUSH_GAP_MS || 60000);
function pushOffline(room, msg, others, mentions) {
  var off = others.filter(function (u) { return !hub.awake(u); });   // v13.371 접속해 있어도 화면을 내려 둔(가려진) 사람에게는 푸시
  if (!off.length) return;
  db.query('SELECT user_id FROM chat_members WHERE room_id = $1 AND user_id = ANY($2) AND left_at IS NULL AND (muted = FALSE OR user_id = ANY($3))', [room.id, off, mentions || []]).then(function (r) {
    var ids = r.rows.map(function (x) { return x.user_id; });
    if (room.kind !== 'dm') { var now = Date.now(); ids = ids.filter(function (u) { if ((mentions || []).indexOf(u) >= 0) return true; var k = room.id + ':' + u; if (PUSH_GATE.get(k) > now - PUSH_GAP_MS) return false; PUSH_GATE.set(k, now); return true; }); if (PUSH_GATE.size > 20000) PUSH_GATE.clear(); }   // v13.366
    if (!ids.length) return;
    return focusOf(ids).then(function (fo) {
    ids = ids.filter(function (u) { return focusPass(fo[u], u, msg, mentions); });   // 🎯 집중 중이면 미룸
    if (!ids.length) return;
    var who = msg.userName || 'AI';
    var body = msg.post ? '📌 ' + msg.post.title : msg.file && !msg.body ? '📎 ' + msg.file.name : String(msg.body || '').replace(/```[\s\S]*?```/g, '[코드]').slice(0, 200);
    return require('../services/push.service').sendToUsers(ids, { title: room.kind === 'dm' ? '💬 ' + who : '💬 ' + (room.name || '대화방') + ' · ' + who, body: body, tag: 'chat-' + room.id, go: 'chat:' + room.id });
    });
  }).catch(function (e) { console.error('[chat] push', e.message); });
}

/* 못 본 사람에게 알림 — 1:1 이거나 @멘션된 사람만, FALLBACK_MS 뒤에도 안 읽었으면 (음소거 방은 멘션만) */
function scheduleFallback(tenantId, room, msg, others, mentions) {
  var targets = others.filter(function (u) { return room.kind === 'dm' || mentions.indexOf(u) >= 0; });
  if (!targets.length) return;
  var t = setTimeout(async function () {
    try {
      var r = await db.query('SELECT user_id FROM chat_members WHERE room_id = $1 AND user_id = ANY($2) AND last_read_id < $3 AND left_at IS NULL AND (muted = FALSE OR user_id = ANY($4))',
        [room.id, targets, msg.id, mentions]);
      var ids = r.rows.map(function (x) { return x.user_id; });
      var fo = await focusOf(ids);
      ids = ids.filter(function (u) { return focusPass(fo[u], u, msg, mentions); });   // 🎯 집중 중이면 미룸
      if (!ids.length) return;
      var title = room.kind === 'dm' ? '' : (room.name || '');
      await require('../services/notification.service').notify('chat_message', {
        fromName: msg.userName, roomName: title, body: msg.body || (msg.file ? '📎 ' + msg.file.name : ''), mention: room.kind !== 'dm',
        roomId: room.id, replyRef: { kind: 'chat', id: room.id }
      }, ids);
    } catch (e) { console.error('[chat] fallback', e.message); }
  }, FALLBACK_MS);
  if (t.unref) t.unref();
}

/* ─── 실시간 스트림 ─── */
router.get('/stream', auth.authenticate, tenant.tenantScope, function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  var uid = me(req), wasOnline = hub.online(uid) || (LAST_OFF.get(uid) || 0) > Date.now() - PRESENCE_OFF_MS;
  res.wmCid = String(req.query.cid || '').slice(0, 40) || null; res.wmAway = req.query.away === '1';   // v13.371 이 화면(탭 · 앱) 표시
  var off = hub.add(uid, res);
  hub.write(res, 'hello', { at: Date.now() });
  if (!wasOnline) presence(req.tenant.id, uid, true);
  var ping = setInterval(function () { try { res.write(': ping\n\n'); if (res.flush) res.flush(); } catch (e) {} }, 25000);
  req.on('close', function () {
    clearInterval(ping); off();
    if (hub.online(uid)) return;
    LAST_OFF.set(uid, Date.now()); if (LAST_OFF.size > 5000) LAST_OFF.clear();
    var t = setTimeout(function () { if (!hub.online(uid)) presence(req.tenant.id, uid, false); }, PRESENCE_OFF_MS);   // v13.366 잠깐 끊김은 접속 그대로
    if (t.unref) t.unref();
  });
});
/* 접속 표시 — 같은 방을 쓰는 사람들에게 */
var PRESENCE_OFF_MS = +(process.env.CHAT_PRESENCE_OFF_MS || 8000), LAST_OFF = new Map();
async function presence(tenantId, uid, on) {
  try {
    if (!on) LAST_OFF.delete(uid);
    var r = await db.query('SELECT DISTINCT m2.user_id FROM chat_members m1 JOIN chat_members m2 ON m2.room_id = m1.room_id WHERE m1.user_id = $1 AND m1.tenant_id = $2 AND m2.left_at IS NULL AND m1.left_at IS NULL', [uid, tenantId]);
    hub.publish(r.rows.map(function (x) { return x.user_id; }).filter(function (x) { return x !== uid; }), 'presence', { userId: uid, online: on });
  } catch (e) {}
}

router.use(auth.authenticate);
router.use(tenant.tenantScope);

/* v13.371 이 화면이 가려졌다 · 다시 보인다 — 가려진 동안 새 메시지는 휴대폰 · 브라우저 푸시로 */
router.post('/away', function (req, res) {
  var b = req.body || {};
  var n = hub.setAway(me(req), String(b.cid || '').slice(0, 40), !!b.away);
  res.json({ data: { ok: true, conns: n } });
});

/* ─── 사람 목록 (새 대화 · 멘션) ─── */
router.get('/users', async function (req, res) {
  try {
    var r = await db.query("SELECT u.id, COALESCE(u.display_name, u.name) AS name, u.role, d.name AS dept FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.tenant_id = $1 AND u.status = 'active' ORDER BY 2", [req.tenant.id]);
    var on = hub.onlineSet(r.rows.map(function (u) { return u.id; }));
    res.json({ data: r.rows.map(function (u) { return { id: u.id, name: u.name, dept: u.dept || '', online: !!on[u.id], me: u.id === me(req) }; }) });
  } catch (e) { httpErr.serverError(res, '[chat/users]', e); }
});

/* ─── 방 목록 ─── */
router.get('/rooms', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT r.id, r.kind, r.name, r.project_id, r.last_msg_at, m.last_read_id, m.muted, m.pinned, p.name AS project_name, ' +
      '(SELECT COUNT(*)::int FROM chat_messages x WHERE x.room_id = r.id AND x.id > m.last_read_id AND x.deleted_at IS NULL AND (x.user_id IS NULL OR x.user_id <> $1) AND x.reply_to IS NULL AND x.kind <> \'system\') AS unread, ' +
      '(SELECT COUNT(*)::int FROM chat_messages x WHERE x.room_id = r.id AND x.id > m.last_read_id AND x.deleted_at IS NULL AND x.mentions @> to_jsonb($1::text)) AS mentioned, ' +
      '(SELECT row_to_json(l) FROM (SELECT x.id, x.kind, x.body, x.user_id, x.deleted_at, x.file_id, x.post->>\'title\' AS ptitle, COALESCE(u.display_name, u.name) AS user_name FROM chat_messages x LEFT JOIN users u ON u.id = x.user_id WHERE x.room_id = r.id AND x.reply_to IS NULL ORDER BY x.id DESC LIMIT 1) l) AS last, ' +
      "(SELECT json_agg(json_build_object('id', u2.id, 'name', COALESCE(u2.display_name, u2.name))) FROM chat_members m2 JOIN users u2 ON u2.id = m2.user_id WHERE m2.room_id = r.id AND m2.left_at IS NULL AND m2.user_id <> $1) AS others " +
      'FROM chat_members m JOIN chat_rooms r ON r.id = m.room_id LEFT JOIN projects p ON p.id = r.project_id ' +
      'WHERE m.user_id = $1 AND m.tenant_id = $2 AND m.left_at IS NULL AND r.archived_at IS NULL ORDER BY m.pinned DESC, r.last_msg_at DESC LIMIT 300', [me(req), req.tenant.id]);
    var all = [];
    r.rows.forEach(function (x) { (x.others || []).forEach(function (o) { all.push(o.id); }); });
    var on = hub.onlineSet(all), fo = await focusOf(all);
    res.json({ data: r.rows.map(function (x) {
      var others = x.others || [];
      var name = x.kind === 'dm' ? (others[0] ? others[0].name : '(나간 사람)') : x.kind === 'project' ? (x.name || x.project_name || '프로젝트') : (x.name || others.map(function (o) { return o.name; }).slice(0, 4).join(', '));
      var l = x.last;
      return { id: x.id, kind: x.kind, name: name, projectId: x.project_id, unread: x.unread, mentioned: x.mentioned, muted: x.muted, pinned: x.pinned, lastAt: x.last_msg_at,
        peerId: x.kind === 'dm' && others[0] ? others[0].id : null, peerFocus: x.kind === 'dm' && others[0] && fo[others[0].id] ? fo[others[0].id].until : null, online: x.kind === 'dm' && others[0] ? !!on[others[0].id] : others.some(function (o) { return on[o.id]; }), members: others.length + 1,
        lastId: l ? +l.id : 0, readId: +x.last_read_id, last: l ? { userName: l.user_name || '', body: l.deleted_at ? '(지운 메시지)' : l.ptitle ? '📌 ' + l.ptitle : l.file_id && !l.body ? '📎 파일' : (l.body || '').slice(0, 120), mine: l.user_id === me(req), kind: l.kind } : null };
    }) });
  } catch (e) { httpErr.serverError(res, '[chat/rooms]', e); }
});

/** 1:1 방 찾기 · 만들기 */
async function dmRoom(tenantId, a, b, by) {
  var key = [a, b].sort().join(':');
  var f = await db.query('SELECT * FROM chat_rooms WHERE tenant_id = $1 AND dm_key = $2', [tenantId, key]);
  var room = f.rows[0];
  if (!room) {
    var ins = await db.query("INSERT INTO chat_rooms (id, tenant_id, kind, dm_key, created_by) VALUES ($1,$2,'dm',$3,$4) ON CONFLICT DO NOTHING RETURNING *", [rid('dm'), tenantId, key, by]);
    room = ins.rows[0] || (await db.query('SELECT * FROM chat_rooms WHERE tenant_id = $1 AND dm_key = $2', [tenantId, key])).rows[0];
  }
  for (var u of [a, b]) await db.query('INSERT INTO chat_members (room_id, user_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL', [room.id, u, tenantId]); _midDrop(room.id);
  return room;
}

router.post('/rooms', async function (req, res) {
  try {
    var b = req.body || {}, t = req.tenant.id;
    if (b.kind === 'dm') {
      if (!b.userId || b.userId === me(req)) return bad(res, '대화할 사람을 고르세요.');
      var ok = await db.query("SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND status = 'active'", [b.userId, t]);
      if (!ok.rows.length) return bad(res, '같은 회사 사용자가 아닙니다.');
      var room = await dmRoom(t, me(req), b.userId, me(req));
      return res.status(201).json({ data: { id: room.id } });
    }
    if (b.kind === 'group') {
      var ids = (Array.isArray(b.userIds) ? b.userIds : []).filter(function (x) { return x && x !== me(req); }).slice(0, 200);
      if (!ids.length) return bad(res, '함께할 사람을 한 명 이상 고르세요.');
      var v = await db.query("SELECT id FROM users WHERE id = ANY($1) AND tenant_id = $2 AND status = 'active'", [ids, t]);
      ids = v.rows.map(function (x) { return x.id; });
      var id = rid('grp');
      await db.query("INSERT INTO chat_rooms (id, tenant_id, kind, name, created_by) VALUES ($1,$2,'group',$3,$4)", [id, t, String(b.name || '').trim().slice(0, 120) || null, me(req)]);
      for (var u of [me(req)].concat(ids)) await db.query('INSERT INTO chat_members (room_id, user_id, tenant_id, role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [id, u, t, u === me(req) ? 'owner' : 'member']); _midDrop(id);
      var r0 = (await db.query('SELECT * FROM chat_rooms WHERE id = $1', [id])).rows[0];
      await postMessage({ tenantId: t }, r0, { kind: 'system', body: (req.user.name || '') + ' 님이 대화방을 만들었습니다' });
      return res.status(201).json({ data: { id: id } });
    }
    if (b.kind === 'project') {
      if (!b.projectId || !await pa.canReadById(req, b.projectId)) return bad(res, '볼 수 있는 프로젝트가 아닙니다.', 403);
      var p = (await db.query('SELECT id, name, owner_id FROM projects WHERE id = $1 AND tenant_id = $2', [b.projectId, t])).rows[0];
      if (!p) return bad(res, '프로젝트가 없습니다.', 404);
      var ex = (await db.query('SELECT * FROM chat_rooms WHERE tenant_id = $1 AND project_id = $2', [t, p.id])).rows[0];
      var created = false;
      if (!ex) {
        var ins = await db.query("INSERT INTO chat_rooms (id, tenant_id, kind, name, project_id, created_by) VALUES ($1,$2,'project',$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *", [rid('prj'), t, p.name, p.id, me(req)]);
        ex = ins.rows[0] || (await db.query('SELECT * FROM chat_rooms WHERE tenant_id = $1 AND project_id = $2', [t, p.id])).rows[0];
        created = !!ins.rows[0];
        // 프로젝트 담당 · 참여자를 처음부터 멤버로
        var pm = await db.query('SELECT user_id FROM project_members WHERE project_id = $1 AND released_at IS NULL', [p.id]).catch(function () { return { rows: [] }; });
        var mem = pm.rows.map(function (x) { return x.user_id; }).concat([p.owner_id, me(req)]).filter(Boolean);
        for (var mu of mem.filter(function (x, i, a) { return a.indexOf(x) === i; })) await db.query('INSERT INTO chat_members (room_id, user_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [ex.id, mu, t]); _midDrop(ex.id);
      }
      await db.query('INSERT INTO chat_members (room_id, user_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL', [ex.id, me(req), t]); _midDrop(ex.id);
      if (created) await postMessage({ tenantId: t }, ex, { kind: 'system', body: '📁 프로젝트 방이 열렸습니다 — 진척 · 이슈 · 마일스톤이 오른쪽에 보이고, /issue 로 바로 이슈를 올릴 수 있어요' });
      return res.status(201).json({ data: { id: ex.id } });
    }
    bad(res, 'kind 는 dm · group · project');
  } catch (e) { httpErr.serverError(res, '[chat/rooms/post]', e); }
});

/* 방 정보 · 멤버 */
router.get('/rooms/:id', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    // v13.372 한꺼번에 — 멤버(집중 상태 같이) · 공지 · 방장 여부를 차례로 묻던 것(DB 왕복 3~5번)을 동시에
    var all = await Promise.all([
      db.query('SELECT m.user_id, m.role, m.last_read_id, COALESCE(u.display_name, u.name) AS name, d.name AS dept, CASE WHEN s.focus_until > now() THEN s.focus_until END AS focus_until FROM chat_members m JOIN users u ON u.id = m.user_id LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN chat_user_state s ON s.user_id = m.user_id WHERE m.room_id = $1 AND m.left_at IS NULL ORDER BY 4', [room.id]),
      room.notice_id ? loadMsg(room.notice_id) : null,
      room.kind !== 'dm' ? canManage(req, room) : false,
      // v13.375 들어오기 전 대화 — 최근 30일 안에 들어왔으면 그 앞 대화 수 (👋 요약 · 처음부터 읽기 띠)
      room.kind !== 'dm' && room.joined_at && Date.now() - new Date(room.joined_at) < 30 * 864e5 ?
        db.query("SELECT COUNT(*)::int AS n, MAX(id) AS up FROM chat_messages WHERE room_id = $1 AND created_at < $2 AND kind <> 'system' AND reply_to IS NULL AND deleted_at IS NULL", [room.id, room.joined_at]) : null
    ]);
    var m = all[0], notice = all[1], pr = all[3] && all[3].rows[0];
    var on = hub.onlineSet(m.rows.map(function (x) { return x.user_id; }));
    res.json({ data: { id: room.id, kind: room.kind, name: room.name, projectId: room.project_id, muted: room.muted, pinned: room.pinned, lastReadId: +room.last_read_id, notice: notice && !notice.deleted && !(room.hist_from && notice.id <= +room.hist_from) ? notice : null,
      myRole: room.role || 'member', equipKey: room.equip_key || null, canManage: !!all[2], histFrom: room.hist_from ? +room.hist_from : null, prior: pr && pr.n ? { n: pr.n, upTo: +pr.up, joinedAt: room.joined_at } : null,
      members: m.rows.map(function (x) { return { id: x.user_id, name: x.name, dept: x.dept || '', role: x.role, online: !!on[x.user_id], focusUntil: x.focus_until || null, readId: +x.last_read_id, me: x.user_id === me(req) }; }) } });
  } catch (e) { httpErr.serverError(res, '[chat/room]', e); }
});
router.put('/rooms/:id', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var b = req.body || {};
    if ('muted' in b || 'pinned' in b) await db.query('UPDATE chat_members SET muted = COALESCE($3, muted), pinned = COALESCE($4, pinned) WHERE room_id = $1 AND user_id = $2', [room.id, me(req), 'muted' in b ? !!b.muted : null, 'pinned' in b ? !!b.pinned : null]);
    if (b.name != null && room.kind === 'group') {
      var nm = String(b.name).trim().slice(0, 120);
      await db.query('UPDATE chat_rooms SET name = $2 WHERE id = $1', [room.id, nm || null]);
      await postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: (req.user.name || '') + ' 님이 방 이름을 "' + nm + '"(으)로 바꿨습니다' });
    }
    res.json({ data: { ok: true } });
  } catch (e) { httpErr.serverError(res, '[chat/room/put]', e); }
});
router.post('/rooms/:id/members', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (room.kind === 'dm') return bad(res, '1:1 대화에는 사람을 더할 수 없습니다 — 새 그룹 대화를 만드세요.');
    if (readOnly(res, room)) return;
    var ids = Array.isArray((req.body || {}).userIds) ? req.body.userIds.slice(0, 100) : [];
    var hist = true;   // v13.375 업무용 — 들어온 사람도 늘 처음부터 봄 (예전 '이전 대화 안 보여 주기' 없앰)
    var mx = (await db.query('SELECT COALESCE(MAX(id),0) AS mx FROM chat_messages WHERE room_id = $1', [room.id])).rows[0].mx;
    var v = await db.query("SELECT id, COALESCE(display_name, name) AS n FROM users WHERE id = ANY($1) AND tenant_id = $2 AND status = 'active'", [ids, req.tenant.id]);
    for (var u of v.rows) await db.query("INSERT INTO chat_members (room_id, user_id, tenant_id, last_read_id, hist_from, role) VALUES ($1,$2,$3,$4,$5,'member') " +
      'ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL, hist_from = NULL, joined_at = CASE WHEN chat_members.left_at IS NOT NULL THEN now() ELSE chat_members.joined_at END, last_read_id = GREATEST(chat_members.last_read_id, EXCLUDED.last_read_id)',
      [room.id, u.id, req.tenant.id, mx, hist ? null : mx]); _midDrop(room.id);
    if (v.rows.length) await postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: (req.user.name || '') + ' 님이 ' + v.rows.map(function (u) { return u.n; }).join(', ') + ' 님을 초대했습니다' + (hist ? '' : ' (이전 대화는 안 보임)') });
    res.json({ data: { added: v.rows.length } });
  } catch (e) { httpErr.serverError(res, '[chat/members]', e); }
});
/* 👑 역할 바꾸기 — owner(방장) · member · readonly(읽기만) (v13.359) */
router.put('/rooms/:id/members/:uid', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (room.kind === 'dm') return bad(res, '1:1 대화에는 역할이 없습니다.');
    if (!await canManage(req, room)) return res.status(403).json({ error: 'FORBIDDEN', message: '방장만 역할을 바꿀 수 있습니다.' });
    var role = (req.body || {}).role;
    if (['owner', 'member', 'readonly'].indexOf(role) < 0) return bad(res, '모르는 역할입니다.');
    var t = await db.query('SELECT m.role, COALESCE(u.display_name, u.name) AS n FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = $1 AND m.user_id = $2 AND m.left_at IS NULL', [room.id, req.params.uid]);
    if (!t.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '이 방 사람이 아닙니다.' });
    if (t.rows[0].role === 'owner' && role !== 'owner') {
      var o = await db.query("SELECT COUNT(*)::int AS n FROM chat_members WHERE room_id = $1 AND role = 'owner' AND left_at IS NULL", [room.id]);
      if (o.rows[0].n <= 1) return bad(res, '방장이 한 명은 있어야 합니다 — 다른 사람을 먼저 방장으로.');
    }
    await db.query('UPDATE chat_members SET role = $3 WHERE room_id = $1 AND user_id = $2', [room.id, req.params.uid, role]);
    await postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: (req.user.name || '') + ' 님이 ' + t.rows[0].n + ' 님을 ' + ({ owner: '👑 방장', member: '멤버', readonly: '👁 읽기만' })[role] + '(으)로 바꿨습니다' });
    hub.publish(await memberIds(room.id), 'room', { roomId: room.id });
    res.json({ ok: true });
  } catch (e) { httpErr.serverError(res, '[chat/role]', e); }
});
/* 내보내기 — 방장만 */
router.delete('/rooms/:id/members/:uid', async function (req, res, next) {
  if (req.params.uid === 'me') return next();
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (room.kind === 'dm') return bad(res, '1:1 대화에서는 내보낼 수 없습니다.');
    if (!await canManage(req, room)) return res.status(403).json({ error: 'FORBIDDEN', message: '방장만 내보낼 수 있습니다.' });
    if (req.params.uid === me(req)) return bad(res, '나가기를 쓰세요.');
    var t = await db.query('SELECT COALESCE(u.display_name, u.name) AS n FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = $1 AND m.user_id = $2 AND m.left_at IS NULL', [room.id, req.params.uid]);
    if (!t.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '이 방 사람이 아닙니다.' });
    var ids = await memberIds(room.id);
    await db.query('UPDATE chat_members SET left_at = now() WHERE room_id = $1 AND user_id = $2', [room.id, req.params.uid]); _midDrop(room.id);
    await postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: (req.user.name || '') + ' 님이 ' + t.rows[0].n + ' 님을 내보냈습니다' });
    hub.publish(ids, 'room', { roomId: room.id, removed: req.params.uid });
    res.json({ ok: true });
  } catch (e) { httpErr.serverError(res, '[chat/kick]', e); }
});
router.delete('/rooms/:id/members/me', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (room.kind === 'dm') { await db.query('UPDATE chat_members SET pinned = FALSE WHERE room_id = $1 AND user_id = $2', [room.id, me(req)]); return bad(res, '1:1 대화는 나갈 수 없습니다 — 알림 끄기를 쓰세요.'); }
    await db.query('UPDATE chat_members SET left_at = now() WHERE room_id = $1 AND user_id = $2', [room.id, me(req)]); _midDrop(room.id);
    await postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: (req.user.name || '') + ' 님이 나갔습니다' });
    res.json({ data: { ok: true } });
  } catch (e) { httpErr.serverError(res, '[chat/leave]', e); }
});

/* ─── 메시지 ─── */
router.get('/rooms/:id/messages', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var lim = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE, 1), 200);
    var where = ['m.room_id = $1'], params = [room.id];
    if (room.hist_from) { params.push(+room.hist_from); where.push('m.id > $' + params.length); }   // 초대 때 이전 대화 안 보여 줌
    if (req.query.thread) { params.push(+req.query.thread); where.push('(m.reply_to = $' + params.length + ' OR m.id = $' + params.length + ')'); }
    else where.push('m.reply_to IS NULL');
    if (req.query.before) { params.push(+req.query.before); where.push('m.id < $' + params.length); }
    if (req.query.around) { params.push(+req.query.around + 25); where.push('m.id <= $' + params.length); }
    var fwd = req.query.after != null && req.query.after !== '';   // v13.375 앞으로 읽기 — after 다음부터 오래된 순
    if (fwd) { params.push(Math.max(0, +req.query.after || 0)); where.push('m.id > $' + params.length); }
    params.push(lim);
    var both = await Promise.all([   // v13.372 메시지 · 읽은 위치 동시에
      db.query(MSG_SQL + 'WHERE ' + where.join(' AND ') + ' ORDER BY m.id ' + (fwd ? 'ASC' : 'DESC') + ' LIMIT $' + params.length, params),
      db.query('SELECT user_id, last_read_id FROM chat_members WHERE room_id = $1 AND left_at IS NULL', [room.id])
    ]);
    var r = both[0], reads = both[1];
    var rows = r.rows.map(shape); if (!fwd) rows.reverse();
    res.json({ data: rows, more: r.rows.length === lim, reads: reads.rows.map(function (x) { return { userId: x.user_id, id: +x.last_read_id }; }) });
  } catch (e) { httpErr.serverError(res, '[chat/messages]', e); }
});

router.post('/rooms/:id/messages', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (readOnly(res, room)) return;
    var b = req.body || {}, body = String(b.body || '').trim();
    var cards = await cleanCards(req, b.cards);
    if (!body && !cards) return bad(res, '내용을 적으세요.');
    if (body.length > MAX_BODY) return bad(res, '너무 깁니다 (' + MAX_BODY + '자까지).');
    var replyTo = null;
    if (b.replyTo) {
      var pr = await db.query('SELECT id, reply_to FROM chat_messages WHERE id = $1 AND room_id = $2', [+b.replyTo, room.id]);
      if (!pr.rows.length) return bad(res, '답글을 달 메시지가 없습니다.');
      replyTo = pr.rows[0].reply_to || +pr.rows[0].id;   // 답글의 답글은 같은 줄기로
    }
    if (body[0] === '/' && !cards) { var cmd = await runCommand(req, room, body, replyTo); if (cmd) return res.status(201).json({ data: cmd }); }
    var msg = await postMessage({ tenantId: req.tenant.id }, room, { userId: me(req), kind: 'text', body: body, cards: cards, replyTo: replyTo });
    res.status(201).json({ data: msg });
  } catch (e) { httpErr.serverError(res, '[chat/send]', e); }
});

async function ownMsg(req, res) {
  var r = await db.query('SELECT m.*, r.kind AS room_kind FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id WHERE m.id = $1 AND m.tenant_id = $2', [+req.params.mid, req.tenant.id]);
  var m = r.rows[0];
  if (!m) { res.status(404).json({ error: 'NOT_FOUND', message: '메시지가 없습니다.' }); return null; }
  if (m.user_id !== me(req) && req.user.role !== 'admin') { res.status(403).json({ error: 'FORBIDDEN', message: '내가 쓴 메시지만 바꿀 수 있습니다.' }); return null; }
  return m;
}
router.put('/messages/:mid', async function (req, res) {
  try {
    var m = await ownMsg(req, res); if (!m) return;
    if (m.user_id !== me(req)) return bad(res, '내가 쓴 메시지만 고칠 수 있습니다.', 403);
    var body = String((req.body || {}).body || '').trim();
    if (!body) return bad(res, '내용을 적으세요.');
    await db.query('UPDATE chat_messages SET body = $2, edited_at = now(), mentions = $3 WHERE id = $1', [m.id, body.slice(0, MAX_BODY), JSON.stringify(await findMentions(req.tenant.id, m.room_id, body))]);
    var msg = await loadMsg(m.id);
    hub.publish(await memberIds(m.room_id), 'upd', msg);
    res.json({ data: msg });
  } catch (e) { httpErr.serverError(res, '[chat/edit]', e); }
});
router.delete('/messages/:mid', async function (req, res) {
  try {
    var m = await ownMsg(req, res); if (!m) return;
    await db.query('UPDATE chat_messages SET deleted_at = now() WHERE id = $1', [m.id]);
    var msg = await loadMsg(m.id);
    hub.publish(await memberIds(m.room_id), 'upd', msg);
    res.json({ data: msg });
  } catch (e) { httpErr.serverError(res, '[chat/del]', e); }
});

/* 공감 — 같은 이모지를 다시 누르면 취소 (카톡 공감처럼) */
var REACTS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '✅', '👀'];
router.post('/messages/:mid/react', async function (req, res) {
  try {
    var e = String((req.body || {}).emoji || '');
    if (REACTS.indexOf(e) < 0) return bad(res, '쓸 수 없는 공감입니다.');
    var r = await db.query('SELECT id, room_id, reactions FROM chat_messages WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [+req.params.mid, req.tenant.id]);
    var m = r.rows[0]; if (!m) return res.status(404).json({ error: 'NOT_FOUND', message: '메시지가 없습니다.' });
    if (!await roomFor(req, res, m.room_id)) return;
    var rx = m.reactions || {}, list = rx[e] || [], i = list.indexOf(me(req));
    if (i >= 0) list.splice(i, 1); else list.push(me(req));
    if (list.length) rx[e] = list; else delete rx[e];
    await db.query('UPDATE chat_messages SET reactions = $2 WHERE id = $1', [m.id, Object.keys(rx).length ? JSON.stringify(rx) : null]);
    var msg = await loadMsg(m.id);
    hub.publish(await memberIds(m.room_id), 'upd', msg);
    res.json({ data: msg });
  } catch (e2) { httpErr.serverError(res, '[chat/react]', e2); }
});
/* 공지 — 방 위에 고정 (아무 멤버나 · 다시 누르면 내림) */
router.post('/rooms/:id/notice', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var mid = (req.body || {}).messageId ? +req.body.messageId : null;
    if (mid) { var ok = await db.query('SELECT 1 FROM chat_messages WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL', [mid, room.id]); if (!ok.rows.length) return bad(res, '메시지가 없습니다.'); }
    await db.query('UPDATE chat_rooms SET notice_id = $2 WHERE id = $1', [room.id, mid]);
    var notice = mid ? await loadMsg(mid) : null;
    hub.publish(await memberIds(room.id), 'notice', { roomId: room.id, notice: notice });
    await postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: (req.user.name || '') + (mid ? ' 님이 공지를 올렸습니다' : ' 님이 공지를 내렸습니다') });
    res.json({ data: { notice: notice } });
  } catch (e) { httpErr.serverError(res, '[chat/notice]', e); }
});
/* 전달 — 다른 방(들)로 (파일은 같은 파일을 가리킴) */
router.post('/messages/:mid/forward', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM chat_messages WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [+req.params.mid, req.tenant.id]);
    var m = r.rows[0]; if (!m) return res.status(404).json({ error: 'NOT_FOUND', message: '메시지가 없습니다.' });
    if (!await roomFor(req, res, m.room_id)) return;
    var ids = Array.isArray((req.body || {}).roomIds) ? req.body.roomIds.slice(0, 10) : [], sent = 0;
    for (var id of ids) {
      var room = await membership(req.tenant.id, id, me(req));
      if (!room || room.last_read_id == null || room.left_at) continue;
      var fid = null;
      if (m.file_id) {
        fid = rid('cf');
        await db.query('INSERT INTO chat_files (id, tenant_id, room_id, user_id, name, mime, size, storage_key, data) SELECT $1, tenant_id, $2, $3, name, mime, size, storage_key, data FROM chat_files WHERE id = $4', [fid, room.id, me(req), m.file_id]);
      }
      await postMessage({ tenantId: req.tenant.id }, room, { userId: me(req), kind: m.kind === 'file' ? 'file' : 'text', body: m.body, cards: m.cards, fileId: fid });
      sent++;
    }
    res.json({ data: { sent: sent } });
  } catch (e) { httpErr.serverError(res, '[chat/forward]', e); }
});

/* v13.366 100명 방 — 메시지 하나에 100명이 읽으면 읽음 알림이 100×100 번 → 방마다 READ_MS 동안 모아 한 번('reads')만 */
var READQ = new Map(), READ_MS = +(process.env.CHAT_READ_MS || 1000);
function readQueue(roomId, uid, id) {
  var q = READQ.get(roomId);
  if (!q) {
    // v13.372 작은 방(20명 이하)은 거의 바로(0.1초) — 보낸 사람 화면의 "1" 이 늦게 사라지던 것. 큰 방은 그대로 모아서
    var c = MID.get(roomId), small = c && c.exp > Date.now() && c.ids.length <= 20;
    q = { list: {} }; READQ.set(roomId, q); q.t = setTimeout(function () { readFlush(roomId); }, small ? Math.min(READ_MS, 100) : READ_MS); if (q.t.unref) q.t.unref();
  }
  q.list[uid] = Math.max(q.list[uid] || 0, id);
}
async function readFlush(roomId) {
  var q = READQ.get(roomId); READQ.delete(roomId); if (!q) return;
  var list = Object.keys(q.list).map(function (u) { return { userId: u, id: q.list[u] }; });
  try { hub.publish(await memberIds(roomId), 'reads', { roomId: roomId, list: list }); } catch (e) {}
}
router.post('/rooms/:id/read', async function (req, res) {
  try {
    // v13.372 빠른 길 — 멤버면 한 문장으로 바로 (예전: 방 확인 + 고치기 = DB 왕복 2번)
    var lid = +((req.body || {}).lastId) || 0;
    var f = await db.query('WITH o AS (SELECT last_read_id FROM chat_members WHERE room_id = $1 AND user_id = $2 AND tenant_id = $4 AND left_at IS NULL) ' +
      'UPDATE chat_members SET last_read_id = GREATEST(last_read_id, LEAST($3, (SELECT COALESCE(MAX(id),0) FROM chat_messages WHERE room_id = $1))) ' +
      'WHERE room_id = $1 AND user_id = $2 AND tenant_id = $4 AND left_at IS NULL RETURNING last_read_id, (SELECT last_read_id FROM o) AS old', [req.params.id, me(req), lid, req.tenant.id]);
    if (f.rows.length) {
      var nw = +f.rows[0].last_read_id, old = +f.rows[0].old;
      if (nw > old) { var rid0 = req.params.id, u0 = me(req); memberIds(rid0).then(function () { readQueue(rid0, u0, nw); }, function () { readQueue(rid0, u0, nw); }); }   // 방 크기를 알고 나서 (보통 담아 둔 것)
      return res.json({ data: { lastReadId: nw } });
    }
    var room = await roomFor(req, res, req.params.id); if (!room) return;   // 멤버가 아니면(프로젝트 방 자동 가입 · 403) 원래 길
    var id = +((req.body || {}).lastId) || 0;
    if (id <= +room.last_read_id) return res.json({ data: { lastReadId: +room.last_read_id } });   // v13.366 이미 읽음 — DB · 알림 없이
    var r = await db.query('UPDATE chat_members SET last_read_id = GREATEST(last_read_id, LEAST($3, (SELECT COALESCE(MAX(id),0) FROM chat_messages WHERE room_id = $1))) WHERE room_id = $1 AND user_id = $2 RETURNING last_read_id', [room.id, me(req), id]);
    var lr = r.rows.length ? +r.rows[0].last_read_id : 0;
    if (lr > +room.last_read_id) readQueue(room.id, me(req), lr);
    res.json({ data: { lastReadId: lr } });
  } catch (e) { httpErr.serverError(res, '[chat/read]', e); }
});

/* 입력 중 … (보내기만, 저장 안 함) */
var TYPING = new Map();
router.post('/rooms/:id/typing', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var tk = room.id + ':' + me(req), now = Date.now();
    if (TYPING.get(tk) > now - 2500) return res.json({ data: { ok: true } });   // v13.366 너무 잦으면 건너뜀
    TYPING.set(tk, now); if (TYPING.size > 5000) TYPING.clear();
    hub.publish((await memberIds(room.id)).filter(function (u) { return u !== me(req); }), 'typing', { roomId: room.id, userId: me(req), name: req.user.name || '' });
    res.json({ data: { ok: true } });
  } catch (e) { httpErr.serverError(res, '[chat/typing]', e); }
});

/* ─── 파일 — 본문 그대로 받아 GCS(켜져 있으면) 또는 DB 에 ─── */
router.post('/rooms/:id/files', express.raw({ type: function () { return true; }, limit: MAX_FILE }), async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (readOnly(res, room)) return;
    var buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return bad(res, '파일이 비었습니다.');
    var name = String(req.query.name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200) || 'file';
    var mime = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120);
    if (/^(text\/html|application\/x-msdownload)/i.test(mime) || /\.(exe|bat|cmd|com|scr|js|vbs|ps1|msi)$/i.test(name)) return bad(res, '실행 파일 · 스크립트는 올릴 수 없습니다.');
    var fid = rid('cf'), key = null, gcs = require('../services/gcs.service');
    if (gcs.isEnabled() && gcs.uploadBuffer) {
      key = 'tenants/' + req.tenant.id + '/chat/' + room.id + '/' + fid + (/\.[A-Za-z0-9]{1,8}$/.exec(name) || [''])[0].toLowerCase();
      await gcs.uploadBuffer(key, buf, mime);
    }
    await db.query('INSERT INTO chat_files (id, tenant_id, room_id, user_id, name, mime, size, storage_key, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [fid, req.tenant.id, room.id, me(req), name, mime, buf.length, key, key ? null : buf]);
    var caption = String(req.query.caption || '').slice(0, 2000);
    var msg = await postMessage({ tenantId: req.tenant.id }, room, { userId: me(req), kind: 'file', body: caption, fileId: fid, replyTo: req.query.replyTo ? +req.query.replyTo : null });
    res.status(201).json({ data: msg });
  } catch (e) {
    if (e && e.type === 'entity.too.large') return bad(res, '25MB 까지 올릴 수 있습니다.', 413);
    httpErr.serverError(res, '[chat/file]', e);
  }
});
/* 파일 + 방 멤버 확인을 한 번에 (v13.373). cols 를 주면 그 칸만 — 사진 칠판은 파일 본문(data, 수 MB)을 안 읽음
 *   f._room = { id, role } (읽기만 확인용). 멤버가 아니면 원래 길(roomFor — 프로젝트 방 자동 가입 · 403) */
var FILE_META = 'f.id, f.room_id, f.tenant_id, f.name, f.mime, f.size, f.storage_key, f.annot, f.annot_at, f.annot_by, COALESCE(ab.display_name, ab.name) AS annot_by_name';
async function fileFor(req, res, cols) {
  var r = await db.query('SELECT ' + (cols || 'f.*') + ', m.role AS m_role, m.left_at AS m_left, m.last_read_id AS m_lr FROM chat_files f ' +
    'LEFT JOIN chat_members m ON m.room_id = f.room_id AND m.user_id = $3 ' + (cols === FILE_META ? 'LEFT JOIN users ab ON ab.id = f.annot_by ' : '') +
    'WHERE f.id = $1 AND f.tenant_id = $2', [req.params.fid, req.tenant.id, me(req)]);
  var f = r.rows[0];
  if (!f) { res.status(404).json({ error: 'NOT_FOUND', message: '파일이 없습니다.' }); return null; }
  if (f.m_lr != null && !f.m_left) { f._room = { id: f.room_id, role: f.m_role }; return f; }
  var room = await roomFor(req, res, f.room_id); if (!room) return null;
  f._room = room; return f;
}
/* 칠판 손가락 · 그리는 중 — 0.1초마다 오므로 권한 · 이름은 잠깐 담아 둠 (멤버가 바뀌면 _midDrop 이 비움) */
var FACL = new Map(), NAMEC = new Map();
async function myName(req) {
  var uid = me(req), c = NAMEC.get(uid);
  if (c && c.exp > Date.now()) return c.n;
  var n = (await userNames(req.tenant.id, [uid]))[uid] || req.user.name || '';
  NAMEC.set(uid, { n: n, exp: Date.now() + 600000 }); if (NAMEC.size > 5000) NAMEC.clear();
  return n;
}
router.get('/files/:fid', async function (req, res) {
  try {
    var f = await fileFor(req, res); if (!f) return;
    if (f.storage_key) {
      var url = await require('../services/gcs.service').signDownloadUrl(f.storage_key, req.query.dl ? f.name : null, 10 * 60 * 1000);
      return res.json({ data: { url: url } });
    }
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', (req.query.dl ? 'attachment' : 'inline') + "; filename*=UTF-8''" + encodeURIComponent(f.name));
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(f.data);
  } catch (e) { httpErr.serverError(res, '[chat/file/get]', e); }
});
/* ─── 🖼 사진 칠판 (v13.356) — 원본은 그대로, 표시 · 자르기 · 회전은 따로 · 방 사람 모두 같이 그림 ─── */
var ANN_TYPES = ['pen', 'hl', 'text', 'arrow', 'line', 'rect', 'ellipse', 'blur', 'box'];
var ANN_MAX = 600, ANN_BYTES = 400000;
function annNum(v) { v = +v; return isFinite(v) ? Math.round(v * 10) / 10 : 0; }
function annShape(s, uid) {
  if (!s || ANN_TYPES.indexOf(s.t) < 0) return null;
  var o = { id: String(s.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || rid('s'), t: s.t, by: uid,
    c: /^#[0-9a-fA-F]{3,8}$/.test(s.c || '') ? s.c : '#EF4444', w: Math.max(1, Math.min(200, annNum(s.w) || 4)) };
  if (s.t === 'pen' || s.t === 'hl') {
    if (!Array.isArray(s.p) || s.p.length < 2) return null;
    o.p = s.p.slice(0, 8000).map(annNum);
  } else {
    o.x = annNum(s.x); o.y = annNum(s.y); o.x2 = annNum(s.x2); o.y2 = annNum(s.y2);
  }
  if (s.t === 'text') { o.s = String(s.s || '').slice(0, 500); if (!o.s.trim()) return null; o.fs = Math.max(8, Math.min(400, annNum(s.fs) || 32)); }
  if (s.fill) o.fill = true;
  return o;
}
function annRect(c) {
  if (!c || typeof c !== 'object') return null;
  var o = { x: annNum(c.x), y: annNum(c.y), w: annNum(c.w), h: annNum(c.h) };
  return o.w > 4 && o.h > 4 ? o : null;
}
router.get('/files/:fid/annot', async function (req, res) {
  try {
    var f = await fileFor(req, res, FILE_META); if (!f) return;   // v13.373 본문 없이 · 이름 같이 (DB 한 번)
    res.json({ data: f.annot || { rot: 0, crop: null, shapes: [] }, at: f.annot_at, byName: f.annot_by_name || '' });
  } catch (e) { httpErr.serverError(res, '[chat/annot/get]', e); }
});
/* 바꾸기: { add:[shape], remove:[id], rot, crop(null=풀기), clear } — 여럿이 같이 그려도 서로 안 지우게 '바뀐 것만' 보냄 */
router.post('/files/:fid/annot', async function (req, res) {
  try {
    var f = await fileFor(req, res, FILE_META); if (!f) return;
    if (!/^image\//i.test(f.mime || '')) return bad(res, '사진에만 표시할 수 있습니다.');
    if (readOnly(res, f._room)) return;
    var b = req.body || {}, uid = me(req);
    var add = (Array.isArray(b.add) ? b.add : []).slice(0, 50).map(function (s) { return annShape(s, uid); }).filter(Boolean);
    var remove = (Array.isArray(b.remove) ? b.remove : []).slice(0, 600).map(String);
    var op = { add: add, remove: remove };
    async function apply(a0, write) {
      var a = a0 ? JSON.parse(JSON.stringify(a0)) : { rot: 0, crop: null, shapes: [] };
      a.shapes = Array.isArray(a.shapes) ? a.shapes : [];
      if (b.clear) { a.shapes = []; op.clear = true; }
      if (remove.length) a.shapes = a.shapes.filter(function (s) { return remove.indexOf(s.id) < 0; });
      add.forEach(function (s) { a.shapes = a.shapes.filter(function (x) { return x.id !== s.id; }); a.shapes.push(s); });
      if (b.rot != null) { a.rot = ((Math.round((+b.rot || 0) / 90) * 90) % 360 + 360) % 360; op.rot = a.rot; }
      if ('crop' in b) { a.crop = annRect(b.crop); op.crop = a.crop; }
      if (a.shapes.length > ANN_MAX) throw Object.assign(new Error('표시는 ' + ANN_MAX + '개까지입니다.'), { status: 400 });
      var json = JSON.stringify(a);
      if (json.length > ANN_BYTES) throw Object.assign(new Error('표시가 너무 많습니다. 몇 개 지워 주세요.'), { status: 400 });
      return (await write(json)) ? a : null;
    }
    // v13.373 보통은 한 문장 — 읽은 그대로일 때만 바꿈(그사이 누가 바꿨으면 0줄 → 예전처럼 잠그고 다시)
    var out = await apply(f.annot, async function (json) {
      var u = await db.query('UPDATE chat_files SET annot = $2, annot_at = now(), annot_by = $3 WHERE id = $1 AND annot IS NOT DISTINCT FROM $4::jsonb', [f.id, json, uid, f.annot == null ? null : JSON.stringify(f.annot)]);
      return u.rowCount > 0;
    });
    if (!out) out = await db.transaction(async function (cl) {
      var r = await cl.query('SELECT annot FROM chat_files WHERE id = $1 FOR UPDATE', [f.id]);
      return apply(r.rows[0].annot, async function (json) { await cl.query('UPDATE chat_files SET annot = $2, annot_at = now(), annot_by = $3 WHERE id = $1', [f.id, json, uid]); return true; });
    });
    hub.publish(await memberIds(f.room_id), 'annot', { fileId: f.id, roomId: f.room_id, by: uid, byName: await myName(req), op: op, sum: { rot: out.rot || 0, n: out.shapes.length, crop: !!out.crop } });
    res.json({ data: { rot: out.rot || 0, crop: out.crop || null, n: out.shapes.length } });
  } catch (e) {
    if (e && e.status === 400) return bad(res, e.message);
    httpErr.serverError(res, '[chat/annot]', e);
  }
});
/* 칠판에서 같이 보는 중 — 누가 어디를 가리키는지 (저장 안 함, 그대로 전달) */
router.post('/files/:fid/cursor', async function (req, res) {
  try {
    // v13.373 권한은 처음 한 번만 DB 로 (60초 담아 둠) — 예전엔 0.14초마다 파일 본문까지 읽음
    var uid = me(req), k = uid + '|' + req.params.fid, c = FACL.get(k);
    if (!c || c.exp < Date.now()) {
      var f = await fileFor(req, res, 'f.id, f.room_id'); if (!f) return;
      c = { room: f.room_id, ro: f._room && f._room.role === 'readonly', exp: Date.now() + 60000 }; FACL.set(k, c); if (FACL.size > 20000) FACL.clear();
    }
    var b = req.body || {};
    var ids = (await memberIds(c.room)).filter(function (u) { return u !== uid; });
    // 끝낸 표시 · 지우기 같은 바뀐 것(op)도 같이 — 받는 쪽이 저장을 기다리지 않고 바로 그림(저장 뒤 'annot' 는 같은 내용이라 겹쳐도 그대로)
    var op = null;
    if (b.op && typeof b.op === 'object' && !c.ro) {
      op = { add: (Array.isArray(b.op.add) ? b.op.add : []).slice(0, 50).map(function (s) { return annShape(s, uid); }).filter(Boolean), remove: (Array.isArray(b.op.remove) ? b.op.remove : []).slice(0, 600).map(String) };
      if (b.op.clear) op.clear = true;
      if (b.op.rot != null) op.rot = ((Math.round((+b.op.rot || 0) / 90) * 90) % 360 + 360) % 360;
      if ('crop' in b.op) op.crop = annRect(b.op.crop);
    }
    var live = null, from = 0;
    if (Array.isArray(b.live)) { live = b.live.slice(0, 2000).map(annNum); from = Math.max(0, Math.min(20000, parseInt(b.from, 10) || 0)); }
    hub.publish(ids, 'annot-cur', { fileId: req.params.fid, by: uid, byName: await myName(req), x: annNum(b.x), y: annNum(b.y), live: live, from: from, lid: typeof b.lid === 'string' ? b.lid.slice(0, 40) : null, lt: ANN_TYPES.indexOf(b.lt) >= 0 ? b.lt : null, c: /^#[0-9a-fA-F]{3,8}$/.test(b.c || '') ? b.c : null, w: annNum(b.w), bye: !!b.bye, op: op });
    res.json({ ok: true });
  } catch (e) { httpErr.serverError(res, '[chat/annot/cur]', e); }
});

/* 방의 파일 모음 */
router.get('/rooms/:id/files', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var r = await db.query('SELECT f.id, f.name, f.mime, f.size, f.created_at, COALESCE(u.display_name, u.name) AS user_name FROM chat_files f LEFT JOIN users u ON u.id = f.user_id WHERE f.room_id = $1 ' +
      'AND ($2::bigint IS NULL OR EXISTS (SELECT 1 FROM chat_messages x WHERE x.file_id = f.id AND x.id > $2)) ORDER BY f.created_at DESC LIMIT 200', [room.id, room.hist_from || null]);
    res.json({ data: r.rows.map(function (f) { return { id: f.id, name: f.name, mime: f.mime, size: f.size, at: f.created_at, userName: f.user_name }; }) });
  } catch (e) { httpErr.serverError(res, '[chat/files]', e); }
});
/* 파일 → 프로젝트 문서 (GCS 필요 — 문서관리가 GCS 를 씀) */
router.post('/files/:fid/to-docs', async function (req, res) {
  try {
    var f = await fileFor(req, res); if (!f) return;
    var pid = (req.body || {}).projectId || null;
    if (pid && !await pa.canEditById(req, pid)) return bad(res, '이 프로젝트에 문서를 넣을 권한이 없습니다.', 403);
    var gcs = require('../services/gcs.service');
    if (!gcs.isEnabled()) return bad(res, '문서 저장소(GCS)가 설정되지 않아 문서로 보낼 수 없습니다.', 503);
    var ext = ((/\.([A-Za-z0-9]{1,8})$/.exec(f.name) || [])[1] || '').toLowerCase();
    var key = 'tenants/' + req.tenant.id + '/docs/' + crypto.randomUUID() + (ext ? '.' + ext : '');
    if (f.storage_key) await gcs.copyObject(f.storage_key, key); else await gcs.uploadBuffer(key, f.data, f.mime);
    var id = 'pf-' + crypto.randomUUID().slice(0, 12);
    await db.query("INSERT INTO project_files (id, project_id, folder_id, name, ext, size, mime_type, storage_key, tags, memo, summary_history, version_history, uploaded_by, tenant_id) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,'[]','[]',$10,$11)",
      [id, pid, f.name, ext, f.size, f.mime, key, JSON.stringify(['메신저']), '메신저에서 보냄', me(req), req.tenant.id]);
    res.status(201).json({ data: { id: id, projectId: pid } });
  } catch (e) { httpErr.serverError(res, '[chat/to-docs]', e); }
});

/* ─── 업무 카드 버튼 — 이슈 상태 · 긴급 (텔레그램과 같은 처리 · 같은 권한) ─── */
router.post('/messages/:mid/action', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM chat_messages WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [+req.params.mid, req.tenant.id]);
    var m = r.rows[0]; if (!m) return res.status(404).json({ error: 'NOT_FOUND', message: '메시지가 없습니다.' });
    var room = await roomFor(req, res, m.room_id); if (!room) return;
    var b = req.body || {}, cards = m.cards || [], ci = +b.card || 0, card = cards[ci];
    if (!card || card.type !== 'issue') return bad(res, '처리할 수 있는 카드가 아닙니다.');
    var acts = require('../telegram/actions'), out;
    if (b.action === 'urgent') out = await acts.issueUrgent(actor(req), card.id);
    else if (['open', 'inProgress', 'resolved', 'closed'].indexOf(b.action) >= 0) out = await acts.issueStatus(actor(req), card.id, b.action);
    else return bad(res, '모르는 처리입니다.');
    if (!out.ok) return bad(res, out.toast || '처리하지 못했습니다.', 403);
    var row = await acts.gateIssue(actor(req), card.id, 'read');
    if (row) { card.status = row.status; card.urgency = row.urgency; cards[ci] = card; await db.query('UPDATE chat_messages SET cards = $2 WHERE id = $1', [m.id, JSON.stringify(cards)]); }
    var upd = await loadMsg(m.id);
    hub.publish(await memberIds(room.id), 'upd', upd);
    await postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: (req.user.name || '') + ' 님이 이슈 "' + (card.title || '') + '" — ' + String(out.toast || '').replace(/<[^>]+>/g, ''), replyTo: m.reply_to || null });
    res.json({ data: upd });
  } catch (e) { httpErr.serverError(res, '[chat/action]', e); }
});

/* ─── 📌 방 게시판 (v13.358) — 공지 · 자료 · 질문 · 🛠 요청(장비 ↔ 프로그래머) · 댓글은 답글 줄기 ─── */
var POST_CATS = { notice: '📢 공지', data: '📎 자료', qna: '❓ 질문', req: '🛠 요청' };
var POST_STATUS = { req: ['open', 'doing', 'done'], qna: ['open', 'solved'] };
var POST_ST_NAME = { open: '접수', doing: '처리 중', done: '완료', solved: '해결됨' };
function cleanDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null; }
async function memberOf(roomId, uid) {
  if (!uid) return false;
  var r = await db.query('SELECT 1 FROM chat_members WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL', [roomId, uid]);
  return !!r.rows.length;
}
router.post('/rooms/:id/posts', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (readOnly(res, room)) return;
    var b = req.body || {};
    var cat = POST_CATS[b.cat] ? b.cat : 'data';
    var title = String(b.title || '').trim().slice(0, 200), body = String(b.body || '').slice(0, MAX_BODY);
    if (!title) return bad(res, '제목을 적으세요.');
    var post = { title: title, cat: cat, urgency: b.urgency === 'urgent' ? 'urgent' : 'normal' };
    if (POST_STATUS[cat]) post.status = 'open';
    if (cat === 'req') {
      post.equip = String(b.equip || '').trim().slice(0, 120) || null;
      if (b.equipId) {   // v13.365 🏭 장비 마스터와 이어 둠
        var em = (await db.query('SELECT id, serial_no, equipment_model FROM as_equipment_master WHERE id = $1 AND tenant_id = $2', [String(b.equipId), req.tenant.id])).rows[0];
        if (em) { post.equipId = em.id; if (!post.equip) post.equip = [em.equipment_model, em.serial_no].filter(Boolean).join(' · ').slice(0, 120); }
      }
      post.due = cleanDate(b.due);
      if (b.assignee) {
        if (!await memberOf(room.id, b.assignee)) return bad(res, '담당자는 이 방 사람이어야 합니다.');
        post.assignee = b.assignee;
      }
    }
    post.history = [{ s: post.status || 'open', by: me(req), at: new Date().toISOString() }];
    var mentions = await findMentions(req.tenant.id, room.id, body);
    if (post.assignee && mentions.indexOf(post.assignee) < 0) mentions.push(post.assignee);
    if (cat === 'notice') (await memberIds(room.id)).forEach(function (u) { if (u !== me(req) && mentions.indexOf(u) < 0) mentions.push(u); });   // 공지는 모두에게 알림
    var msg = await postMessage({ tenantId: req.tenant.id }, room, { userId: me(req), kind: 'post', body: body, post: post, mentions: mentions });
    res.status(201).json({ data: msg });
  } catch (e) { httpErr.serverError(res, '[chat/posts]', e); }
});
router.get('/rooms/:id/posts', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var where = ['m.room_id = $1', 'm.post IS NOT NULL', 'm.deleted_at IS NULL'], params = [room.id];
    if (room.hist_from) { params.push(+room.hist_from); where.push('m.id > $' + params.length); }
    if (POST_CATS[req.query.cat]) { params.push(req.query.cat); where.push("m.post->>'cat' = $" + params.length); }
    if (req.query.open) where.push("COALESCE(m.post->>'status', 'open') NOT IN ('done', 'solved')");
    var r = await db.query(MSG_SQL + 'WHERE ' + where.join(' AND ') + ' ORDER BY m.id DESC LIMIT 300', params);
    res.json({ data: r.rows.map(shape) });
  } catch (e) { httpErr.serverError(res, '[chat/posts/list]', e); }
});
/* 요청함 — 여러 방에 걸친 🛠 요청 (나에게 온 것 · 내가 올린 것) */
router.get('/requests', async function (req, res) {
  try {
    var who = req.query.who === 'mine' ? 'mine' : 'me';
    var params = [me(req), req.tenant.id];
    var where = ["m.post->>'cat' = 'req'", 'm.deleted_at IS NULL', 'm.tenant_id = $2',
      'EXISTS (SELECT 1 FROM chat_members cm WHERE cm.room_id = m.room_id AND cm.user_id = $1 AND cm.left_at IS NULL AND (cm.hist_from IS NULL OR m.id > cm.hist_from))',
      who === 'mine' ? 'm.user_id = $1' : "m.post->>'assignee' = $1::text"];
    if (req.query.open) where.push("COALESCE(m.post->>'status', 'open') <> 'done'");
    var r = await db.query(MSG_SQL.replace('FROM chat_messages m', ', COALESCE(rr.name, pp.name) AS room_name, rr.kind AS room_kind FROM chat_messages m JOIN chat_rooms rr ON rr.id = m.room_id LEFT JOIN projects pp ON pp.id = rr.project_id') +
      'WHERE ' + where.join(' AND ') + " ORDER BY (m.post->>'status' = 'done'), (m.post->>'urgency' = 'urgent') DESC, m.id DESC LIMIT 300", params);
    res.json({ data: r.rows.map(function (x) { var o = shape(x); o.roomName = x.room_name || (x.room_kind === 'dm' ? '1:1 대화' : '대화방'); return o; }) });
  } catch (e) { httpErr.serverError(res, '[chat/requests]', e); }
});
/* 글 바꾸기 — 상태(방 사람 누구나) · 담당 · 제목/내용(쓴 사람) · 🐞 이슈로(프로젝트 방) */
router.post('/messages/:mid/post', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM chat_messages WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND post IS NOT NULL', [+req.params.mid, req.tenant.id]);
    var m = r.rows[0]; if (!m) return res.status(404).json({ error: 'NOT_FOUND', message: '글이 없습니다.' });
    var room = await roomFor(req, res, m.room_id); if (!room) return;
    if (readOnly(res, room)) return;
    var b = req.body || {}, post = m.post, notes = [], body = m.body, cards = m.cards;
    var mineOrAdmin = m.user_id === me(req) || req.user.role === 'admin';
    if (b.status != null) {
      var ok = POST_STATUS[post.cat] || [];
      if (ok.indexOf(b.status) < 0) return bad(res, '바꿀 수 없는 상태입니다.');
      if (b.status !== post.status) {
        post.status = b.status;
        post.history = (post.history || []).concat([{ s: b.status, by: me(req), at: new Date().toISOString() }]).slice(-50);
        if (b.status === 'doing' && post.cat === 'req' && !post.assignee) post.assignee = me(req);   // 처리 시작한 사람이 담당
        notes.push('상태 → ' + POST_ST_NAME[b.status]);
      }
    }
    if ('assignee' in b) {
      if (b.assignee && !await memberOf(room.id, b.assignee)) return bad(res, '담당자는 이 방 사람이어야 합니다.');
      if ((b.assignee || null) !== (post.assignee || null)) {
        post.assignee = b.assignee || null;
        var nm = post.assignee ? (await userNames(req.tenant.id, [post.assignee]))[post.assignee] : '';
        notes.push(post.assignee ? '담당 → ' + nm : '담당 비움');
      }
    }
    if (b.title != null || b.body != null || b.equip !== undefined || b.due !== undefined || b.urgency != null) {
      if (!mineOrAdmin) return res.status(403).json({ error: 'FORBIDDEN', message: '쓴 사람만 고칠 수 있습니다.' });
      if (b.title != null) { var t = String(b.title).trim().slice(0, 200); if (!t) return bad(res, '제목을 적으세요.'); post.title = t; }
      if (b.body != null) body = String(b.body).slice(0, MAX_BODY);
      if (b.equip !== undefined) post.equip = String(b.equip || '').trim().slice(0, 120) || null;
      if (b.due !== undefined) post.due = cleanDate(b.due);
      if (b.urgency != null) post.urgency = b.urgency === 'urgent' ? 'urgent' : 'normal';
    }
    if (b.toIssue) {
      if (room.kind !== 'project' || !room.project_id) return bad(res, '이슈는 프로젝트 방에서 올립니다.');
      if (!await pa.canEditById(req, room.project_id)) return res.status(403).json({ error: 'FORBIDDEN', message: '이 프로젝트에 이슈를 올릴 권한이 없습니다.' });
      if ((cards || []).some(function (c) { return c.type === 'issue'; })) return bad(res, '이미 이슈로 올렸습니다.');
      var iid = 'iss-' + crypto.randomUUID().slice(0, 12), urg = post.urgency === 'urgent' ? 'urgent' : 'normal';
      await db.query("INSERT INTO issues (id, project_id, urgency, status, report_date, title, description, reporter_id, assignees, tags, created_by, updated_by, tenant_id) VALUES ($1,$2,$3,'open',$4,$5,$6,$7,$8,$9,$7,$7,$10)",
        [iid, room.project_id, urg, kstToday(), post.title, (post.equip ? '장비: ' + post.equip + '\n' : '') + body + '\n\n💬 메신저 요청에서 올림', me(req), JSON.stringify(post.assignee ? [post.assignee] : []), JSON.stringify(['메신저', '요청']), req.tenant.id]);
      cards = (cards || []).concat([{ type: 'issue', id: iid, title: post.title, sub: urg === 'urgent' ? '긴급' : '', status: 'open', urgency: urg, nav: { issueId: iid } }]);
      notes.push('🐞 이슈로 올림');
    }
    await db.query('UPDATE chat_messages SET post = $2, body = $3, cards = $4, edited_at = CASE WHEN $3 <> body THEN now() ELSE edited_at END WHERE id = $1', [m.id, JSON.stringify(post), body, cards ? JSON.stringify(cards) : null]);
    var upd = await loadMsg(m.id);
    hub.publish(await memberIds(room.id), 'upd', upd);
    if (notes.length) await postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: (req.user.name || '') + ' 님 · "' + post.title + '" ' + notes.join(' · '), replyTo: m.id });
    res.json({ data: upd });
  } catch (e) { httpErr.serverError(res, '[chat/post/upd]', e); }
});

/* ─── 📁 폴더 (v13.358 내 폴더 · v13.359 방 폴더) — 메시지 · 사진 · 파일 · 글을 모아 둠
 *   내 폴더(room_id 없음): 나만 봄 · 방 폴더(room_id): 그 방 사람 모두가 같이 담고 봄 (그 방 메시지만)
 *   방에서 나가면 그 방 것은 안 보임 · 초대 때 '이전 대화 안 보여 주기'면 그 앞 메시지도 안 보임 */
async function folderFor(req, res, write) {
  var r = await db.query('SELECT f.*, m.role AS my_role, m.hist_from AS my_hist FROM chat_folders f LEFT JOIN chat_members m ON m.room_id = f.room_id AND m.user_id = $2 AND m.left_at IS NULL WHERE f.id = $1 AND f.tenant_id = $3', [req.params.fid, me(req), req.tenant.id]);
  var f = r.rows[0];
  var ok = f && (f.room_id ? f.my_role != null : f.user_id === me(req));
  if (!ok) { res.status(404).json({ error: 'NOT_FOUND', message: '폴더가 없습니다.' }); return null; }
  if (write && f.room_id && f.my_role === 'readonly') { res.status(403).json({ error: 'FORBIDDEN', message: '읽기만 하는 멤버입니다.' }); return null; }
  return f;
}
function folderShape(f) { return { id: f.id, name: f.name, icon: f.icon || (f.room_id ? '🗂' : '📁'), n: f.n || 0, roomId: f.room_id || null, roomName: f.room_id ? (f.room_name || '대화방') : null, mine: f.user_id === f.me }; }
router.get('/folders', async function (req, res) {
  try {
    var params = [me(req), req.tenant.id], where = '(f.user_id = $1 AND f.room_id IS NULL)';
    if (req.query.room) { params.push(String(req.query.room)); where = 'f.room_id = $3'; }
    else if (req.query.shared !== '0') where += ' OR f.room_id IN (SELECT room_id FROM chat_members WHERE user_id = $1 AND left_at IS NULL)';
    var r = await db.query('SELECT f.*, $1::uuid AS me, COALESCE(rr.name, pp.name, CASE WHEN rr.kind = \'dm\' THEN \'1:1 대화\' END) AS room_name, ' +
      '(SELECT COUNT(*)::int FROM chat_saved s JOIN chat_messages m ON m.id = s.msg_id JOIN chat_members cm ON cm.room_id = m.room_id AND cm.user_id = $1 AND cm.left_at IS NULL WHERE s.folder_id = f.id AND m.deleted_at IS NULL AND (cm.hist_from IS NULL OR m.id > cm.hist_from)) AS n ' +
      'FROM chat_folders f LEFT JOIN chat_rooms rr ON rr.id = f.room_id LEFT JOIN projects pp ON pp.id = rr.project_id ' +
      'WHERE f.tenant_id = $2 AND (' + where + ') AND (f.room_id IS NULL OR EXISTS (SELECT 1 FROM chat_members x WHERE x.room_id = f.room_id AND x.user_id = $1 AND x.left_at IS NULL)) ORDER BY (f.room_id IS NOT NULL), f.sort, f.created_at', params);
    res.json({ data: r.rows.map(folderShape) });
  } catch (e) { httpErr.serverError(res, '[chat/folders]', e); }
});
router.post('/folders', async function (req, res) {
  try {
    var b = req.body || {}, name = String(b.name || '').trim().slice(0, 80);
    if (!name) return bad(res, '폴더 이름을 적으세요.');
    var roomId = null, roomName = null;
    if (b.roomId) {
      var room = await roomFor(req, res, String(b.roomId)); if (!room) return;
      if (room.role === 'readonly') return res.status(403).json({ error: 'FORBIDDEN', message: '읽기만 하는 멤버입니다.' });
      roomId = room.id; roomName = room.name;
    }
    var c = await db.query('SELECT COUNT(*)::int AS n, COALESCE(MAX(sort), 0) AS mx FROM chat_folders WHERE ' + (roomId ? 'room_id = $1' : 'user_id = $1 AND room_id IS NULL'), [roomId || me(req)]);
    if (c.rows[0].n >= 100) return bad(res, '폴더는 100개까지 만들 수 있습니다.');
    var id = rid('fd'), icon = String(b.icon || (roomId ? '🗂' : '📁')).slice(0, 16);
    await db.query('INSERT INTO chat_folders (id, tenant_id, user_id, name, icon, sort, room_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, req.tenant.id, me(req), name, icon, c.rows[0].mx + 1, roomId]);
    if (roomId) hub.publish(await memberIds(roomId), 'folder', { roomId: roomId, folderId: id });
    res.status(201).json({ data: { id: id, name: name, icon: icon, n: 0, roomId: roomId, roomName: roomName, mine: true } });
  } catch (e) { httpErr.serverError(res, '[chat/folders/new]', e); }
});
/* 이름 · 지우기: 내 폴더는 나, 방 폴더는 만든 사람 · 방장 · 관리자 */
async function folderManage(req, res) {
  var f = await folderFor(req, res, true); if (!f) return null;
  if (f.room_id && f.user_id !== me(req) && f.my_role !== 'owner' && req.user.role !== 'admin') { res.status(403).json({ error: 'FORBIDDEN', message: '방 폴더는 만든 사람이나 방장만 바꿀 수 있습니다.' }); return null; }
  return f;
}
router.put('/folders/:fid', async function (req, res) {
  try {
    var f = await folderManage(req, res); if (!f) return;
    var b = req.body || {}, name = b.name != null ? String(b.name).trim().slice(0, 80) : f.name;
    if (!name) return bad(res, '폴더 이름을 적으세요.');
    await db.query('UPDATE chat_folders SET name = $2, icon = $3, sort = $4 WHERE id = $1', [f.id, name, b.icon != null ? String(b.icon).slice(0, 16) : f.icon, b.sort != null ? +b.sort || 0 : f.sort]);
    if (f.room_id) hub.publish(await memberIds(f.room_id), 'folder', { roomId: f.room_id, folderId: f.id });
    res.json({ ok: true });
  } catch (e) { httpErr.serverError(res, '[chat/folders/put]', e); }
});
router.delete('/folders/:fid', async function (req, res) {
  try {
    var f = await folderManage(req, res); if (!f) return;
    await db.query('DELETE FROM chat_folders WHERE id = $1', [f.id]);
    if (f.room_id) hub.publish(await memberIds(f.room_id), 'folder', { roomId: f.room_id, folderId: f.id, gone: true });
    res.json({ ok: true });
  } catch (e) { httpErr.serverError(res, '[chat/folders/del]', e); }
});
router.get('/folders/:fid/items', async function (req, res) {
  try {
    var f = await folderFor(req, res); if (!f) return;
    var r = await db.query(MSG_SQL.replace('FROM chat_messages m', ', s.note AS saved_note, s.created_at AS saved_at, COALESCE(us.display_name, us.name) AS saved_by, COALESCE(rr.name, pp.name) AS room_name, rr.kind AS room_kind FROM chat_saved s JOIN chat_messages m ON m.id = s.msg_id JOIN chat_rooms rr ON rr.id = m.room_id LEFT JOIN projects pp ON pp.id = rr.project_id LEFT JOIN users us ON us.id = s.user_id') +
      'JOIN chat_members cm ON cm.room_id = m.room_id AND cm.user_id = $2 AND cm.left_at IS NULL ' +
      'WHERE s.folder_id = $1 AND m.deleted_at IS NULL AND (cm.hist_from IS NULL OR m.id > cm.hist_from) ORDER BY s.created_at DESC LIMIT 500', [f.id, me(req)]);
    res.json({ data: r.rows.map(function (x) { var o = shape(x); o.roomName = x.room_name || (x.room_kind === 'dm' ? '1:1 대화' : '대화방'); o.savedNote = x.saved_note || ''; o.savedAt = x.saved_at; o.savedBy = x.saved_by || ''; return o; }) });
  } catch (e) { httpErr.serverError(res, '[chat/folders/items]', e); }
});
router.post('/folders/:fid/items', async function (req, res) {
  try {
    var f = await folderFor(req, res, true); if (!f) return;
    var mid = +(req.body || {}).messageId;
    var r = await db.query('SELECT id, room_id FROM chat_messages WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [mid, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '메시지가 없습니다.' });
    var room = await roomFor(req, res, r.rows[0].room_id); if (!room) return;
    if (room.hist_from && mid <= +room.hist_from) return res.status(404).json({ error: 'NOT_FOUND', message: '메시지가 없습니다.' });
    if (f.room_id && f.room_id !== room.id) return bad(res, '방 폴더에는 그 방 메시지만 담을 수 있습니다.');
    await db.query('INSERT INTO chat_saved (folder_id, msg_id, user_id, tenant_id, note) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (folder_id, msg_id) DO UPDATE SET note = COALESCE(EXCLUDED.note, chat_saved.note)',
      [f.id, mid, me(req), req.tenant.id, (req.body || {}).note ? String(req.body.note).slice(0, 500) : null]);
    if (f.room_id) hub.publish(await memberIds(f.room_id), 'folder', { roomId: f.room_id, folderId: f.id });
    res.status(201).json({ ok: true });
  } catch (e) { httpErr.serverError(res, '[chat/folders/add]', e); }
});
router.delete('/folders/:fid/items/:mid', async function (req, res) {
  try {
    var f = await folderFor(req, res, true); if (!f) return;
    await db.query('DELETE FROM chat_saved WHERE folder_id = $1 AND msg_id = $2', [f.id, +req.params.mid]);
    if (f.room_id) hub.publish(await memberIds(f.room_id), 'folder', { roomId: f.room_id, folderId: f.id });
    res.json({ ok: true });
  } catch (e) { httpErr.serverError(res, '[chat/folders/rm]', e); }
});
/* 이 메시지가 담긴 폴더 (메뉴에 ✓) — 내 폴더 + 그 방 폴더 */
router.get('/messages/:mid/folders', async function (req, res) {
  try {
    var r = await db.query('SELECT s.folder_id FROM chat_saved s JOIN chat_folders f ON f.id = s.folder_id JOIN chat_messages m ON m.id = s.msg_id ' +
      'WHERE s.msg_id = $1 AND f.tenant_id = $3 AND ((f.room_id IS NULL AND f.user_id = $2) OR (f.room_id = m.room_id AND EXISTS (SELECT 1 FROM chat_members x WHERE x.room_id = f.room_id AND x.user_id = $2 AND x.left_at IS NULL)))', [+req.params.mid, me(req), req.tenant.id]);
    res.json({ data: r.rows.map(function (x) { return x.folder_id; }) });
  } catch (e) { httpErr.serverError(res, '[chat/msg/folders]', e); }
});

/* ─── 📝 방 공동 문서 (v13.360) — 방 사람 모두가 같이 고침 · rev 로 겹침 확인(409 → 클라가 세 갈래 합치기) · 실시간 'doc' ─── */
var DOC_MAX = 200000;
function docShape(d, names) {
  return { id: d.id, roomId: d.room_id, title: d.title || '', body: d.body, rev: d.rev, chars: (d.body || '').length,
    updatedAt: d.updated_at, updatedBy: d.updated_by, updatedByName: (names || {})[d.updated_by] || d.ub_name || '', createdBy: d.created_by };
}
async function docFor(req, res, write) {
  var r = await db.query('SELECT * FROM chat_docs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [req.params.did, req.tenant.id]);
  var d = r.rows[0];
  if (!d) { res.status(404).json({ error: 'NOT_FOUND', message: '문서가 없습니다.' }); return null; }
  var room = await roomFor(req, res, d.room_id); if (!room) return null;
  if (room.hist_from) {   // 초대 전 문서는 '이전 대화 안 보여 주기'면 안 보임
    var first = await db.query("SELECT 1 FROM chat_messages WHERE room_id = $1 AND id <= $2 AND cards @> $3::jsonb LIMIT 1", [room.id, +room.hist_from, JSON.stringify([{ type: 'cdoc', id: d.id }])]);
    if (first.rows.length) { res.status(404).json({ error: 'NOT_FOUND', message: '문서가 없습니다.' }); return null; }
  }
  if (write && readOnly(res, room)) return null;
  d._room = room;
  return d;
}
router.get('/rooms/:id/docs', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var r = await db.query('SELECT d.id, d.room_id, d.title, LEFT(d.body, 200) AS body, LENGTH(d.body) AS len, d.rev, d.updated_at, d.updated_by, d.created_by, COALESCE(u.display_name, u.name) AS ub_name FROM chat_docs d LEFT JOIN users u ON u.id = d.updated_by ' +
      'WHERE d.room_id = $1 AND d.deleted_at IS NULL ' + (room.hist_from ? "AND NOT EXISTS (SELECT 1 FROM chat_messages x WHERE x.room_id = d.room_id AND x.id <= $2 AND x.cards @> jsonb_build_array(jsonb_build_object('type', 'cdoc', 'id', d.id))) " : '') +
      'ORDER BY d.updated_at DESC LIMIT 200', room.hist_from ? [room.id, +room.hist_from] : [room.id]);
    res.json({ data: r.rows.map(function (d) { var o = docShape(d); o.chars = +d.len; o.preview = (d.body || '').replace(/\s+/g, ' ').slice(0, 120); delete o.body; return o; }) });
  } catch (e) { httpErr.serverError(res, '[chat/docs]', e); }
});
router.post('/rooms/:id/docs', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (readOnly(res, room)) return;
    var b = req.body || {}, title = String(b.title || '').trim().slice(0, 200) || '제목 없는 문서', body = String(b.body || '').slice(0, DOC_MAX);
    var id = rid('doc');
    await db.query('INSERT INTO chat_docs (id, tenant_id, room_id, title, body, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6)', [id, req.tenant.id, room.id, title, body, me(req)]);
    // 방에 카드로 알림 — 누르면 같이 고치기
    await postMessage({ tenantId: req.tenant.id }, room, { userId: me(req), kind: 'text', body: '📝 공동 문서를 만들었습니다 — 같이 고쳐요', cards: [{ type: 'cdoc', id: id, title: title, sub: '📝 공동 문서 · 방 사람 모두 고칠 수 있음' }] });
    var d = (await db.query('SELECT * FROM chat_docs WHERE id = $1', [id])).rows[0];
    res.status(201).json({ data: docShape(d, await userNames(req.tenant.id, [me(req)])) });
  } catch (e) { httpErr.serverError(res, '[chat/docs/new]', e); }
});
router.get('/docs/:did', async function (req, res) {
  try {
    var d = await docFor(req, res); if (!d) return;
    res.json({ data: Object.assign(docShape(d, await userNames(req.tenant.id, [d.updated_by])), { readOnly: d._room.role === 'readonly' }) });
  } catch (e) { httpErr.serverError(res, '[chat/doc]', e); }
});
router.put('/docs/:did', async function (req, res) {
  try {
    var d = await docFor(req, res, true); if (!d) return;
    var b = req.body || {};
    if (b.body != null && String(b.body).length > DOC_MAX) return bad(res, '문서는 20만 자까지입니다.', 413);
    var title = b.title != null ? String(b.title).trim().slice(0, 200) || '제목 없는 문서' : d.title;
    var body = b.body != null ? String(b.body) : d.body;
    if (title === d.title && body === d.body) return res.json({ data: docShape(d, await userNames(req.tenant.id, [d.updated_by])) });
    if (b.baseRev == null || +b.baseRev !== d.rev) return res.status(409).json({ error: 'CONFLICT', message: '다른 사람이 먼저 고쳤습니다 — 합쳐서 다시 저장합니다.', data: docShape(d, await userNames(req.tenant.id, [d.updated_by])) });
    // 10분에 한 번, 다른 사람이 고친 글이면 바로 — 고치기 전 모습을 남김
    var last = await db.query('SELECT created_at, by_user FROM chat_doc_versions WHERE doc_id = $1 ORDER BY id DESC LIMIT 1', [d.id]);
    var lv = last.rows[0];
    if (d.body && (!lv || Date.now() - new Date(lv.created_at).getTime() > 600000 || d.updated_by !== me(req))) {
      await db.query('INSERT INTO chat_doc_versions (doc_id, rev, title, body, by_user) VALUES ($1,$2,$3,$4,$5)', [d.id, d.rev, d.title, d.body, d.updated_by]);
      await db.query('DELETE FROM chat_doc_versions WHERE doc_id = $1 AND id NOT IN (SELECT id FROM chat_doc_versions WHERE doc_id = $1 ORDER BY id DESC LIMIT 100)', [d.id]);
    }
    var u = await db.query('UPDATE chat_docs SET title = $2, body = $3, rev = rev + 1, updated_by = $4, updated_at = now() WHERE id = $1 AND rev = $5 RETURNING *', [d.id, title, body, me(req), d.rev]);
    if (!u.rows.length) { var now = (await db.query('SELECT * FROM chat_docs WHERE id = $1', [d.id])).rows[0]; return res.status(409).json({ error: 'CONFLICT', message: '다른 사람이 먼저 고쳤습니다.', data: docShape(now, await userNames(req.tenant.id, [now.updated_by])) }); }
    var out = docShape(u.rows[0], await userNames(req.tenant.id, [me(req)]));
    hub.publish(await memberIds(d.room_id), 'doc', Object.assign({ clientId: String(b.clientId || '').slice(0, 40) }, out));
    res.json({ data: out });
  } catch (e) { httpErr.serverError(res, '[chat/doc/put]', e); }
});
router.delete('/docs/:did', async function (req, res) {
  try {
    var d = await docFor(req, res, true); if (!d) return;
    if (d.created_by !== me(req) && d._room.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({ error: 'FORBIDDEN', message: '만든 사람이나 방장만 지울 수 있습니다.' });
    await db.query('UPDATE chat_docs SET deleted_at = now() WHERE id = $1', [d.id]);
    hub.publish(await memberIds(d.room_id), 'doc', { id: d.id, roomId: d.room_id, gone: true });
    res.json({ ok: true });
  } catch (e) { httpErr.serverError(res, '[chat/doc/del]', e); }
});
router.get('/docs/:did/versions', async function (req, res) {
  try {
    var d = await docFor(req, res); if (!d) return;
    var r = await db.query('SELECT v.id, v.rev, v.title, LENGTH(v.body) AS len, v.created_at, COALESCE(u.display_name, u.name) AS by_name FROM chat_doc_versions v LEFT JOIN users u ON u.id = v.by_user WHERE v.doc_id = $1 ORDER BY v.id DESC LIMIT 100', [d.id]);
    res.json({ data: r.rows.map(function (v) { return { id: +v.id, rev: v.rev, title: v.title, chars: +v.len, at: v.created_at, byName: v.by_name || '' }; }) });
  } catch (e) { httpErr.serverError(res, '[chat/doc/versions]', e); }
});
router.get('/docs/:did/versions/:vid', async function (req, res) {
  try {
    var d = await docFor(req, res); if (!d) return;
    var r = await db.query('SELECT id, rev, title, body, created_at FROM chat_doc_versions WHERE id = $1 AND doc_id = $2', [+req.params.vid, d.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '없는 기록입니다.' });
    res.json({ data: r.rows[0] });
  } catch (e) { httpErr.serverError(res, '[chat/doc/version]', e); }
});
/* 누가 어디(몇째 줄)를 고치는 중인지 — 저장 안 함, 그대로 전달 */
router.post('/docs/:did/cursor', async function (req, res) {
  try {
    var d = await docFor(req, res); if (!d) return;
    var b = req.body || {}, nm = await userNames(req.tenant.id, [me(req)]);
    hub.publish((await memberIds(d.room_id)).filter(function (u) { return u !== me(req); }), 'doc-cur', { id: d.id, by: me(req), byName: nm[me(req)] || '', line: Math.max(0, parseInt(b.line, 10) || 0), bye: !!b.bye });
    res.json({ ok: true });
  } catch (e) { httpErr.serverError(res, '[chat/doc/cur]', e); }
});

/* ─── ⏰ 예약 보내기 · 다시 알림 (v13.362) — 타이머는 lib/chat-timers.js (메모리 + 한 시간에 한 번 DB) ─── */
var timers = require('../lib/chat-timers');
function whenOk(v, maxDays) {
  var t = new Date(v); if (isNaN(t)) return null;
  if (t.getTime() < Date.now() + 30000 || t.getTime() > Date.now() + maxDays * 86400000) return null;
  return t;
}
function schedShape(x) { return { id: +x.id, roomId: x.room_id, roomName: x.room_name || null, body: x.body, sendAt: x.send_at, createdAt: x.created_at }; }
router.post('/rooms/:id/scheduled', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (readOnly(res, room)) return;
    var b = req.body || {}, body = String(b.body || '').trim();
    if (!body) return bad(res, '보낼 글을 적으세요.');
    if (body.length > MAX_BODY) return bad(res, '너무 깁니다.');
    var at = whenOk(b.sendAt, 60); if (!at) return bad(res, '보낼 때는 지금부터 60일 안이어야 합니다.');
    var n = await db.query('SELECT COUNT(*)::int AS n FROM chat_scheduled WHERE user_id = $1 AND sent_at IS NULL AND canceled_at IS NULL', [me(req)]);
    if (n.rows[0].n >= 100) return bad(res, '예약은 100개까지입니다.');
    var r = await db.query('INSERT INTO chat_scheduled (tenant_id, room_id, user_id, body, send_at) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.tenant.id, room.id, me(req), body, at]);
    timers.arm('s', r.rows[0]);
    res.status(201).json({ data: schedShape(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[chat/sched]', e); }
});
/* 내 예약 — 이 방(room=) 또는 전체 */
router.get('/scheduled', async function (req, res) {
  try {
    var p = [me(req), req.tenant.id], w = '';
    if (req.query.room) { p.push(String(req.query.room)); w = ' AND s.room_id = $3'; }
    var r = await db.query('SELECT s.*, COALESCE(rr.name, pp.name) AS room_name FROM chat_scheduled s JOIN chat_rooms rr ON rr.id = s.room_id LEFT JOIN projects pp ON pp.id = rr.project_id WHERE s.user_id = $1 AND s.tenant_id = $2 AND s.sent_at IS NULL AND s.canceled_at IS NULL' + w + ' ORDER BY s.send_at LIMIT 200', p);
    res.json({ data: r.rows.map(schedShape) });
  } catch (e) { httpErr.serverError(res, '[chat/sched/list]', e); }
});
router.put('/scheduled/:sid', async function (req, res) {
  try {
    var b = req.body || {}, set = [], p = [+req.params.sid, me(req)];
    if (b.body != null) { var body = String(b.body).trim(); if (!body) return bad(res, '보낼 글을 적으세요.'); p.push(body.slice(0, MAX_BODY)); set.push('body = $' + p.length); }
    if (b.sendAt != null) { var at = whenOk(b.sendAt, 60); if (!at) return bad(res, '보낼 때는 지금부터 60일 안이어야 합니다.'); p.push(at); set.push('send_at = $' + p.length); }
    if (!set.length) return bad(res, '바꿀 것이 없습니다.');
    var r = await db.query('UPDATE chat_scheduled SET ' + set.join(', ') + ' WHERE id = $1 AND user_id = $2 AND sent_at IS NULL AND canceled_at IS NULL RETURNING *', p);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '예약이 없습니다 (이미 보냈거나 취소).' });
    timers.disarm('s', r.rows[0].id); timers.arm('s', r.rows[0]);
    res.json({ data: schedShape(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[chat/sched/put]', e); }
});
router.delete('/scheduled/:sid', async function (req, res) {
  try {
    var r = await db.query('UPDATE chat_scheduled SET canceled_at = now() WHERE id = $1 AND user_id = $2 AND sent_at IS NULL AND canceled_at IS NULL RETURNING id', [+req.params.sid, me(req)]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '예약이 없습니다.' });
    timers.disarm('s', +req.params.sid);
    res.json({ ok: true });
  } catch (e) { httpErr.serverError(res, '[chat/sched/del]', e); }
});
/* 지금 바로 보내기 */
router.post('/scheduled/:sid/now', async function (req, res) {
  try {
    var own = await db.query('SELECT id FROM chat_scheduled WHERE id = $1 AND user_id = $2', [+req.params.sid, me(req)]);
    if (!own.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '예약이 없습니다.' });
    timers.disarm('s', +req.params.sid);
    var msg = await timers.fireScheduled(+req.params.sid);
    if (!msg) return bad(res, '보낼 수 없습니다 (이미 보냈거나 방에서 나감).');
    res.json({ data: msg });
  } catch (e) { httpErr.serverError(res, '[chat/sched/now]', e); }
});

router.post('/messages/:mid/remind', async function (req, res) {
  try {
    var m = (await db.query('SELECT id, room_id FROM chat_messages WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [+req.params.mid, req.tenant.id])).rows[0];
    if (!m) return res.status(404).json({ error: 'NOT_FOUND', message: '메시지가 없습니다.' });
    var room = await roomFor(req, res, m.room_id); if (!room) return;
    if (room.hist_from && m.id <= +room.hist_from) return res.status(404).json({ error: 'NOT_FOUND', message: '메시지가 없습니다.' });
    var at = whenOk((req.body || {}).at, 365); if (!at) return bad(res, '알릴 때는 지금부터 1년 안이어야 합니다.');
    var n = await db.query('SELECT COUNT(*)::int AS n FROM chat_reminders WHERE user_id = $1 AND done_at IS NULL', [me(req)]);
    if (n.rows[0].n >= 200) return bad(res, '다시 알림은 200개까지입니다.');
    var r = await db.query('INSERT INTO chat_reminders (tenant_id, user_id, room_id, msg_id, remind_at, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.tenant.id, me(req), m.room_id, m.id, at, String((req.body || {}).note || '').slice(0, 300) || null]);
    timers.arm('r', r.rows[0]);
    res.status(201).json({ data: { id: +r.rows[0].id, remindAt: r.rows[0].remind_at } });
  } catch (e) { httpErr.serverError(res, '[chat/remind]', e); }
});
router.get('/reminders', async function (req, res) {
  try {
    var r = await db.query("SELECT x.id, x.remind_at, x.note, x.msg_id, x.room_id, COALESCE(rr.name, pp.name) AS room_name, m.body, m.post->>'title' AS ptitle, COALESCE(u.display_name, u.name) AS who " +
      'FROM chat_reminders x JOIN chat_messages m ON m.id = x.msg_id JOIN chat_rooms rr ON rr.id = x.room_id LEFT JOIN projects pp ON pp.id = rr.project_id LEFT JOIN users u ON u.id = m.user_id ' +
      'WHERE x.user_id = $1 AND x.tenant_id = $2 AND x.done_at IS NULL ORDER BY x.remind_at LIMIT 200', [me(req), req.tenant.id]);
    res.json({ data: r.rows.map(function (x) { return { id: +x.id, remindAt: x.remind_at, note: x.note || '', msgId: +x.msg_id, roomId: x.room_id, roomName: x.room_name || '', body: x.ptitle ? '📌 ' + x.ptitle : x.body || '', who: x.who || '' }; }) });
  } catch (e) { httpErr.serverError(res, '[chat/reminders]', e); }
});
router.delete('/reminders/:rid', async function (req, res) {
  try {
    var r = await db.query('UPDATE chat_reminders SET done_at = now() WHERE id = $1 AND user_id = $2 AND done_at IS NULL RETURNING id', [+req.params.rid, me(req)]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '알림이 없습니다.' });
    timers.disarm('r', +req.params.rid);
    res.json({ ok: true });
  } catch (e) { httpErr.serverError(res, '[chat/reminders/del]', e); }
});
/* 📣 요청 다시 알림 — 담당자에게 (같은 글은 한 시간에 한 번) */
router.post('/messages/:mid/nudge', async function (req, res) {
  try {
    var m = (await db.query("SELECT * FROM chat_messages WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND post->>'cat' = 'req'", [+req.params.mid, req.tenant.id])).rows[0];
    if (!m) return res.status(404).json({ error: 'NOT_FOUND', message: '요청 글이 없습니다.' });
    var room = await roomFor(req, res, m.room_id); if (!room) return;
    if (readOnly(res, room)) return;
    var p = m.post;
    if (!p.assignee) return bad(res, '담당자가 없습니다 — 먼저 담당을 정하세요.');
    if (p.status === 'done') return bad(res, '이미 완료된 요청입니다.');
    if (p.assignee === me(req)) return bad(res, '내가 담당입니다.');
    if (p.nudgedAt && Date.now() - new Date(p.nudgedAt).getTime() < 3600000) return bad(res, '한 시간 안에 이미 알렸습니다.', 429);
    await db.query("UPDATE chat_messages SET post = jsonb_set(post, '{nudgedAt}', to_jsonb(now()::text)) WHERE id = $1", [m.id]);
    await require('../services/notification.service').notify('chat_req_nudge', { roomId: room.id, roomName: room.name || '', title: p.title, equip: p.equip, fromName: req.user.name || '' }, [p.assignee]);
    await postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: '📣 ' + (req.user.name || '') + ' 님이 담당자에게 다시 알렸습니다', replyTo: m.id });
    res.json({ ok: true });
  } catch (e) { httpErr.serverError(res, '[chat/nudge]', e); }
});

/* ─── ✨ AI 정리 (v13.364) — 결과는 부른 사람에게만 · AI 없으면 규칙으로 (lib/chat-ai.js) ─── */
var chatAi = require('../lib/chat-ai');
function aiCtx(req) { return { tenantId: req.tenant.id, userId: me(req), name: req.user.name || '나' }; }
router.post('/rooms/:id/catchup', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var since = Math.max(+(req.body || {}).sinceId || 0, room.hist_from ? +room.hist_from : 0), upTo = +(req.body || {}).upTo || 0;
    // v13.375 upTo — 들어오기 전 대화(그때까지 최근 300개) 정리
    var r = upTo ? await db.query('SELECT * FROM (' + MSG_SQL + 'WHERE m.room_id = $1 AND m.id <= $2 AND m.reply_to IS NULL AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 300) z ORDER BY id', [room.id, upTo])
      : await db.query(MSG_SQL + 'WHERE m.room_id = $1 AND m.id > $2 AND m.reply_to IS NULL AND m.deleted_at IS NULL AND (m.user_id IS NULL OR m.user_id <> $3) ORDER BY m.id LIMIT 300', [room.id, since, me(req)]);
    var rows = r.rows.map(shape).map(function (m) { return { who: m.userName || 'AI', body: m.body, kind: m.kind, post: m.post, file: m.file && m.file.name, at: m.at, mentionsMe: (m.mentions || []).indexOf(me(req)) >= 0 }; });
    if (!rows.filter(function (x) { return x.kind !== 'system'; }).length) return res.json({ data: { text: '새 메시지가 없습니다.', ai: false, count: 0 } });
    var out = await chatAi.catchup(aiCtx(req), rows);
    res.json({ data: Object.assign(out, { count: rows.length }) });
  } catch (e) { httpErr.serverError(res, '[chat/catchup]', e); }
});
router.post('/posts/suggest', async function (req, res) {
  try {
    var text = String((req.body || {}).text || '').slice(0, 8000);
    if (!text.trim()) return bad(res, '내용을 먼저 적으세요.');
    res.json({ data: await chatAi.suggest(aiCtx(req), text) });
  } catch (e) { httpErr.serverError(res, '[chat/suggest]', e); }
});
router.get('/requests/brief', async function (req, res) {
  try {
    var r = await db.query(MSG_SQL.replace('FROM chat_messages m', ', COALESCE(rr.name, pp.name) AS room_name, rr.kind AS room_kind FROM chat_messages m JOIN chat_rooms rr ON rr.id = m.room_id LEFT JOIN projects pp ON pp.id = rr.project_id') +
      "WHERE m.post->>'cat' = 'req' AND m.deleted_at IS NULL AND m.tenant_id = $2 AND m.post->>'assignee' = $1::text AND COALESCE(m.post->>'status', 'open') <> 'done' " +
      'AND EXISTS (SELECT 1 FROM chat_members cm WHERE cm.room_id = m.room_id AND cm.user_id = $1::uuid AND cm.left_at IS NULL AND (cm.hist_from IS NULL OR m.id > cm.hist_from)) ORDER BY m.id DESC LIMIT 100', [me(req), req.tenant.id]);
    var items = r.rows.map(function (x) { var o = shape(x); o.roomName = x.room_name || (x.room_kind === 'dm' ? '1:1 대화' : '대화방'); return o; });
    res.json({ data: Object.assign(await chatAi.brief(aiCtx(req), items), { count: items.length }) });
  } catch (e) { httpErr.serverError(res, '[chat/brief]', e); }
});

/* ─── 🏭 장비 단위 연결 (v13.365) — 장비마다 요청 · A/S 이력 · 문서 · 사진 · 언급 · 장비 방을 한데 ─── */
function eqNorm(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 120); }
function eqLike(s) { return '%' + String(s).replace(/[\\%_]/g, function (c) { return '\\' + c; }) + '%'; }
// 내가 볼 수 있는 메시지 (방 멤버 · 초대 전 대화 가림)
var EQ_VIS = 'EXISTS (SELECT 1 FROM chat_members cm WHERE cm.room_id = m.room_id AND cm.user_id = $1 AND cm.left_at IS NULL AND (cm.hist_from IS NULL OR m.id > cm.hist_from))';
async function eqResolve(req, key) {
  key = String(key || '');
  if (/^m:/.test(key)) {
    var r = await db.query('SELECT * FROM as_equipment_master WHERE id = $1 AND tenant_id = $2', [key.slice(2), req.tenant.id]);
    var m = r.rows[0]; if (!m) return null;
    var label = [m.equipment_model, m.serial_no].filter(Boolean).join(' · ') || m.serial_no;
    return { key: 'm:' + m.id, master: m, label: label, names: [m.serial_no, m.equipment_no, m.equipment_model].filter(function (x) { return x && String(x).trim().length >= 3; }).map(eqNorm) };
  }
  if (/^n:/.test(key) && eqNorm(key.slice(2)).length >= 2) { var n = eqNorm(key.slice(2)); return { key: 'n:' + n, master: null, label: key.slice(2).trim(), names: [n] }; }
  return null;
}
router.get('/equipment', async function (req, res) {
  try {
    var q = String(req.query.q || '').trim(), out = [];
    var mp = [req.tenant.id], mw = '';
    if (q) { mp.push(eqLike(q)); mw = ' AND (serial_no ILIKE $2 OR equipment_no ILIKE $2 OR equipment_model ILIKE $2 OR customer_name ILIKE $2 OR site_line ILIKE $2)'; }
    var ms = await db.query('SELECT id, serial_no, equipment_no, equipment_model, customer_name, site_line, warranty_status FROM as_equipment_master WHERE tenant_id = $1 AND active = TRUE' + mw + ' ORDER BY updated_at DESC LIMIT 30', mp);
    ms.rows.forEach(function (m) { out.push({ key: 'm:' + m.id, type: 'master', label: [m.equipment_model, m.serial_no].filter(Boolean).join(' · '), sub: [m.customer_name, m.site_line, m.equipment_no].filter(Boolean).join(' · '), warranty: m.warranty_status || '' }); });
    // 요청 글에 적힌 장비 이름 (내가 볼 수 있는 것) — 남은 · 전체 수
    var np = [me(req), req.tenant.id], nw = '';
    if (q) { np.push(eqLike(q)); nw = " AND m.post->>'equip' ILIKE $3"; }
    var ns = await db.query("SELECT lower(trim(m.post->>'equip')) AS k, MIN(trim(m.post->>'equip')) AS label, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE COALESCE(m.post->>'status', 'open') <> 'done')::int AS open, MAX(m.post->>'equipId') AS eid, MAX(m.created_at) AS last " +
      "FROM chat_messages m WHERE m.post IS NOT NULL AND m.deleted_at IS NULL AND m.tenant_id = $2 AND COALESCE(m.post->>'equip', '') <> '' AND " + EQ_VIS + nw + ' GROUP BY 1 ORDER BY MAX(m.created_at) DESC LIMIT 40', np);
    ns.rows.forEach(function (x) {
      var hit = x.eid && out.filter(function (o) { return o.key === 'm:' + x.eid; })[0];
      if (hit) { hit.open = (hit.open || 0) + x.open; hit.n = (hit.n || 0) + x.n; return; }
      out.push({ key: 'n:' + x.k, type: 'name', label: x.label, sub: '요청 ' + x.n + '개', open: x.open, n: x.n, last: x.last });
    });
    res.json({ data: out });
  } catch (e) { httpErr.serverError(res, '[chat/equip]', e); }
});
router.get('/equipment/card', async function (req, res) {
  try {
    var eq = await eqResolve(req, req.query.key);
    if (!eq) return res.status(404).json({ error: 'NOT_FOUND', message: '장비를 찾지 못했습니다.' });
    var uid = me(req), t = req.tenant.id, names = eq.names, likes = names.map(eqLike);
    // 🛠 요청 (장비 마스터 연결 · 이름 같음)
    var rq = await db.query(MSG_SQL.replace('FROM chat_messages m', ', COALESCE(rr.name, pp.name) AS room_name, rr.kind AS room_kind FROM chat_messages m JOIN chat_rooms rr ON rr.id = m.room_id LEFT JOIN projects pp ON pp.id = rr.project_id') +
      "WHERE m.post IS NOT NULL AND m.deleted_at IS NULL AND m.tenant_id = $2 AND ((m.post->>'equipId') = $3 OR lower(trim(m.post->>'equip')) = ANY($4)) AND " + EQ_VIS +
      " ORDER BY (COALESCE(m.post->>'status', 'open') IN ('done', 'solved')), m.id DESC LIMIT 60", [uid, t, eq.master ? eq.master.id : '-', names]);
    var reqs = rq.rows.map(function (x) { var o = shape(x); o.roomName = x.room_name || (x.room_kind === 'dm' ? '1:1 대화' : '대화방'); return o; });
    // 🔧 A/S 이력
    var asr = { rows: [] };
    if (likes.length) {
      var ap = [t], aw = [];
      if (eq.master) { ap.push(eq.master.serial_no); aw.push('serial_no = $2'); if (eq.master.equipment_no) { ap.push(eq.master.equipment_no); aw.push('equipment_no = $' + ap.length); } }
      else { ap.push(likes); aw.push('(equipment_model ILIKE ANY($2) OR serial_no ILIKE ANY($2) OR equipment_no ILIKE ANY($2) OR site_line ILIKE ANY($2))'); }
      asr = await db.query('SELECT id, ticket_no, customer_name, equipment_model, serial_no, issue_summary, status, priority, received_at, project_id FROM as_tickets WHERE tenant_id = $1 AND deleted_at IS NULL AND (' + aw.join(' OR ') + ') ORDER BY received_at DESC LIMIT 30', ap);
    }
    // 📝 공동 문서 · 🖼 사진 · 💬 언급
    var reqIds = reqs.map(function (r) { return r.id; });
    var docs = await db.query('SELECT d.id, d.title, d.room_id, d.updated_at, COALESCE(rr.name, pp.name) AS room_name FROM chat_docs d JOIN chat_rooms rr ON rr.id = d.room_id LEFT JOIN projects pp ON pp.id = rr.project_id ' +
      'WHERE d.tenant_id = $2 AND d.deleted_at IS NULL AND (d.title ILIKE ANY($3) OR d.body ILIKE ANY($3)) AND EXISTS (SELECT 1 FROM chat_members cm WHERE cm.room_id = d.room_id AND cm.user_id = $1 AND cm.left_at IS NULL) ORDER BY d.updated_at DESC LIMIT 12', [uid, t, likes]);
    var photos = await db.query(MSG_SQL + "WHERE m.deleted_at IS NULL AND m.tenant_id = $2 AND f.mime LIKE 'image/%' AND (m.body ILIKE ANY($3) OR m.reply_to = ANY($4::bigint[])) AND " + EQ_VIS + ' ORDER BY m.id DESC LIMIT 12', [uid, t, likes, reqIds]);
    var talk = await db.query(MSG_SQL.replace('FROM chat_messages m', ', COALESCE(rr.name, pp.name) AS room_name FROM chat_messages m JOIN chat_rooms rr ON rr.id = m.room_id LEFT JOIN projects pp ON pp.id = rr.project_id') +
      "WHERE m.deleted_at IS NULL AND m.tenant_id = $2 AND m.post IS NULL AND m.kind IN ('text', 'ai') AND m.body ILIKE ANY($3) AND " + EQ_VIS + ' ORDER BY m.id DESC LIMIT 15', [uid, t, likes]);
    var room = await db.query('SELECT r.id, (SELECT COUNT(*)::int FROM chat_members x WHERE x.room_id = r.id AND x.left_at IS NULL) AS n, EXISTS (SELECT 1 FROM chat_members x WHERE x.room_id = r.id AND x.user_id = $3 AND x.left_at IS NULL) AS mine FROM chat_rooms r WHERE r.tenant_id = $1 AND r.equip_key = $2', [t, eq.key, uid]);
    var m = eq.master;
    res.json({ data: {
      key: eq.key, label: eq.label,
      master: m ? { id: m.id, serial: m.serial_no, no: m.equipment_no, model: m.equipment_model, customer: m.customer_name, line: m.site_line, installDate: m.install_date, warrantyUntil: m.warranty_until, warranty: m.warranty_status, note: m.note } : null,
      requests: reqs,
      as: asr.rows.map(function (a) { return { id: a.id, no: a.ticket_no, summary: a.issue_summary, status: a.status, priority: a.priority, at: a.received_at, customer: a.customer_name, model: a.equipment_model, serial: a.serial_no, projectId: a.project_id }; }),
      docs: docs.rows.map(function (d) { return { id: d.id, title: d.title, roomId: d.room_id, roomName: d.room_name || '', at: d.updated_at }; }),
      photos: photos.rows.map(shape),
      mentions: talk.rows.map(function (x) { var o = shape(x); o.roomName = x.room_name || ''; return o; }),
      room: room.rows[0] ? { id: room.rows[0].id, members: room.rows[0].n, mine: room.rows[0].mine } : null
    } });
  } catch (e) { httpErr.serverError(res, '[chat/equip/card]', e); }
});
/* 💬 장비 방 — 장비마다 하나. 없으면 만들고(나 + 이 장비 요청을 올리거나 맡은 사람), 있으면 들어감 */
router.post('/equipment/room', async function (req, res) {
  try {
    var eq = await eqResolve(req, (req.body || {}).key);
    if (!eq) return res.status(404).json({ error: 'NOT_FOUND', message: '장비를 찾지 못했습니다.' });
    var t = req.tenant.id, uid = me(req);
    var ex = (await db.query('SELECT * FROM chat_rooms WHERE tenant_id = $1 AND equip_key = $2', [t, eq.key])).rows[0];
    if (ex) {
      await db.query("INSERT INTO chat_members (room_id, user_id, tenant_id, last_read_id, role) VALUES ($1,$2,$3,0,'member') ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL", [ex.id, uid, t]); _midDrop(ex.id);
      return res.json({ data: { id: ex.id, created: false } });
    }
    var ppl = await db.query("SELECT DISTINCT u FROM (SELECT m.user_id AS u FROM chat_messages m WHERE m.tenant_id = $1 AND m.post IS NOT NULL AND ((m.post->>'equipId') = $2 OR lower(trim(m.post->>'equip')) = ANY($3)) " +
      "UNION SELECT (m.post->>'assignee')::uuid FROM chat_messages m WHERE m.tenant_id = $1 AND m.post IS NOT NULL AND m.post->>'assignee' IS NOT NULL AND ((m.post->>'equipId') = $2 OR lower(trim(m.post->>'equip')) = ANY($3))) z JOIN users us ON us.id = z.u AND us.status = 'active' LIMIT 30", [t, eq.master ? eq.master.id : '-', eq.names]);
    var id = rid('grp');
    await db.query("INSERT INTO chat_rooms (id, tenant_id, kind, name, created_by, equip_key) VALUES ($1,$2,'group',$3,$4,$5)", [id, t, '🏭 ' + eq.label.slice(0, 100), uid, eq.key]);
    var ids = [uid].concat(ppl.rows.map(function (x) { return x.u; }).filter(function (x) { return x && x !== uid; }));
    for (var u of ids) await db.query('INSERT INTO chat_members (room_id, user_id, tenant_id, role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [id, u, t, u === uid ? 'owner' : 'member']); _midDrop(id);
    var room = (await db.query('SELECT * FROM chat_rooms WHERE id = $1', [id])).rows[0];
    await postMessage({ tenantId: t }, room, { kind: 'system', body: '🏭 ' + eq.label + ' 장비 방이 열렸습니다 — 이 장비의 요청 · A/S · 문서 · 사진은 옆 칸 🏭 장비 탭에서' });
    res.status(201).json({ data: { id: id, created: true, members: ids.length } });
  } catch (e) { httpErr.serverError(res, '[chat/equip/room]', e); }
});

/* ─── 🎯 집중 모드 (v13.363) ─── */
router.get('/focus', async function (req, res) {
  try {
    var r = await db.query('SELECT focus_until, focus_allow FROM chat_user_state WHERE user_id = $1', [me(req)]);
    var x = r.rows[0];
    res.json({ data: x && x.focus_until && new Date(x.focus_until) > new Date() ? { until: x.focus_until, allow: x.focus_allow } : { until: null, allow: x ? x.focus_allow : true } });
  } catch (e) { httpErr.serverError(res, '[chat/focus]', e); }
});
router.put('/focus', async function (req, res) {
  try {
    var b = req.body || {}, until = null;
    if (!b.off) {
      if (b.minutes) until = new Date(Date.now() + Math.max(5, Math.min(24 * 60, +b.minutes || 0)) * 60000);
      else if (b.until) { until = new Date(b.until); if (isNaN(until) || until < new Date() || until > new Date(Date.now() + 7 * 86400000)) return bad(res, '집중은 지금부터 7일 안까지입니다.'); }
      else return bad(res, '얼마나 집중할지 고르세요.');
    }
    var allow = b.allow !== false;
    await db.query('INSERT INTO chat_user_state (user_id, tenant_id, focus_until, focus_allow, updated_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT (user_id) DO UPDATE SET focus_until = EXCLUDED.focus_until, focus_allow = EXCLUDED.focus_allow, updated_at = now()', [me(req), req.tenant.id, until, allow]);
    // 같은 방 사람들 화면에 '🎯 집중 중' 표시
    var peers = await db.query('SELECT DISTINCT m2.user_id FROM chat_members m1 JOIN chat_members m2 ON m2.room_id = m1.room_id AND m2.left_at IS NULL WHERE m1.user_id = $1 AND m1.left_at IS NULL LIMIT 2000', [me(req)]);
    hub.publish(peers.rows.map(function (x) { return x.user_id; }), 'focus', { userId: me(req), until: until });
    res.json({ data: { until: until, allow: allow } });
  } catch (e) { httpErr.serverError(res, '[chat/focus/put]', e); }
});

/* ─── 프로젝트 방 옆 현황 (데이터 기반) ─── */
router.get('/rooms/:id/context', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (room.kind !== 'project' || !room.project_id) return res.json({ data: null });
    var t = req.tenant.id, pid = room.project_id, today = kstToday();
    var p = (await db.query('SELECT id, name, status, progress, start_date, end_date, order_no FROM projects WHERE id = $1 AND tenant_id = $2', [pid, t])).rows[0];
    if (!p) return res.json({ data: null });
    var iss = await db.query("SELECT id, title, status, urgency, due_date FROM issues WHERE project_id = $1 AND tenant_id = $2 AND status IN ('open','inProgress') ORDER BY (urgency = 'urgent') DESC, due_date NULLS LAST, created_at DESC LIMIT 6", [pid, t]);
    var issN = await db.query("SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE due_date < $3)::int AS late FROM issues WHERE project_id = $1 AND tenant_id = $2 AND status IN ('open','inProgress')", [pid, t, today]).catch(function () { return { rows: [{ n: 0, late: 0 }] }; });
    var ms = await db.query("SELECT id, name, end_date, status, progress FROM milestones WHERE project_id = $1 AND tenant_id = $2 AND COALESCE(status,'') NOT IN ('done','completed') ORDER BY end_date NULLS LAST LIMIT 6", [pid, t]).catch(function () { return { rows: [] }; });
    res.json({ data: {
      project: { id: p.id, name: p.name, status: p.status, progress: p.progress, start: p.start_date, end: p.end_date, orderNo: p.order_no },
      issues: { open: issN.rows[0].n, late: issN.rows[0].late, top: iss.rows },
      milestones: ms.rows.map(function (x) { return { id: x.id, name: x.name, end: x.end_date, status: x.status, progress: x.progress, late: !!(x.end_date && String(x.end_date).slice(0, 10) < today) }; })
    } });
  } catch (e) { httpErr.serverError(res, '[chat/context]', e); }
});

/* ─── 찾기 — 내가 들어간 방의 메시지 ─── */
router.get('/search', async function (req, res) {
  try {
    var q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ data: [] });
    var like = '%' + q.replace(/[\\%_]/g, function (c) { return '\\' + c; }) + '%';
    var prm = [me(req), req.tenant.id, like], ex = '';
    if (req.query.room) { prm.push(String(req.query.room)); ex += ' AND m.room_id = $' + prm.length; }   // v13.366 이 방에서만
    if (req.query.from) { prm.push(String(req.query.from)); ex += ' AND m.user_id = $' + prm.length; }   // 보낸 사람
    if (req.query.has === 'file') ex += ' AND m.file_id IS NOT NULL';
    var r = await db.query(MSG_SQL + 'JOIN chat_members cm ON cm.room_id = m.room_id AND cm.user_id = $1 AND cm.left_at IS NULL ' +
      'WHERE m.tenant_id = $2 AND m.deleted_at IS NULL AND (cm.hist_from IS NULL OR m.id > cm.hist_from) AND (m.body ILIKE $3 OR f.name ILIKE $3)' + ex + ' ORDER BY m.id DESC LIMIT 60', prm);
    res.json({ data: r.rows.map(shape) });
  } catch (e) { httpErr.serverError(res, '[chat/search]', e); }
});

/* ─── 화면 공유 신호 (WebRTC) — 저장하지 않고 그 사람에게 전달만 ─── */
router.post('/rooms/:id/rtc', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var b = req.body || {}, ids = await memberIds(room.id);
    if (['offer', 'answer', 'ice', 'join', 'leave', 'stop', 'ctl-req', 'ctl-ok', 'ctl-no', 'ctl-end', 'call', 'call-join', 'call-leave', 'call-no'].indexOf(b.type) < 0) return bad(res, '모르는 신호');
    var payload = { roomId: room.id, from: me(req), fromName: req.user.name || '', type: b.type, sid: String(b.sid || '').slice(0, 60), data: b.data || null };
    if (JSON.stringify(payload).length > 60000) return bad(res, '신호가 너무 큽니다.');
    var to = b.to ? [b.to].filter(function (u) { return ids.indexOf(u) >= 0; }) : ids.filter(function (u) { return u !== me(req); });
    if (/^call/.test(b.type) && !/^call-[a-z0-9]{6,40}$/.test(payload.sid)) return bad(res, '통화 번호가 올바르지 않습니다.');
    hub.publish(to, 'rtc', payload);
    if (/^call/.test(b.type)) await callTrack(req, room, b, payload, ids);   // v13.361 📞 통화 — 누가 들어와 있는지 · 시작/끝 기록 · 푸시
    // v13.360 🖱 원격 제어 — 허락 · 끝은 방에 남김 (누가 누구 화면을 조작했는지)
    if ((b.type === 'ctl-ok' || b.type === 'ctl-end') && to.length === 1) {
      var nm = await userNames(req.tenant.id, [to[0]]);
      await postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: b.type === 'ctl-ok' ? '🖱 ' + (req.user.name || '') + ' 님이 ' + (nm[to[0]] || '') + ' 님에게 화면 제어를 허락했습니다' : '🖱 화면 제어가 끝났습니다 (' + (req.user.name || '') + ')' });
    }
    res.json({ data: { ok: true } });
  } catch (e) { httpErr.serverError(res, '[chat/rtc]', e); }
});
/* ─── 📞 통화 (v13.361) — 영상 · 음성은 브라우저끼리(WebRTC). 서버는 누가 들어와 있는지만 기억(메모리)하고 시작 · 끝을 방에 남김 ─── */
var CALLS = {};   // callId → { roomId, video, by, at, users: { uid: true }, msgId }
function callOf(roomId) { var k = Object.keys(CALLS).filter(function (id) { return CALLS[id].roomId === roomId; })[0]; return k ? Object.assign({ id: k }, CALLS[k], { users: Object.keys(CALLS[k].users) }) : null; }
async function callTrack(req, room, b, p, ids) {
  Object.keys(CALLS).forEach(function (k) { if (Date.now() - CALLS[k].at > 12 * 3600000) delete CALLS[k]; });   // 끊긴 채 남은 것 정리
  var c = CALLS[p.sid], uid = me(req);
  if (b.type === 'call') {
    if (c) { c.users[uid] = true; return; }
    if (Object.keys(CALLS).length > 500) return;
    c = CALLS[p.sid] = { roomId: room.id, video: !!(b.data && b.data.video), by: uid, at: Date.now(), users: {} };
    c.users[uid] = true;
    var m = await postMessage({ tenantId: req.tenant.id }, room, { userId: uid, kind: 'text', body: (c.video ? '🎥 영상' : '📞 음성') + ' 통화를 시작했습니다', cards: [{ type: 'call', id: p.sid, on: true, video: c.video, from: uid }] });
    c.msgId = m.id;
    // 접속 안 한 사람에게 휴대폰 푸시
    var off = ids.filter(function (u) { return u !== uid && !hub.online(u); });
    if (off.length) require('../services/push.service').sendToUsers(off, { title: (c.video ? '🎥 ' : '📞 ') + (req.user.name || '') + ' 님의 통화', body: (room.kind === 'dm' ? '' : (room.name || '대화방') + ' — ') + '눌러서 받기', tag: 'call-' + p.sid, go: 'chat:' + room.id }).catch(function () {});
  } else if (b.type === 'call-join' && c) c.users[uid] = true;
  else if (b.type === 'call-leave' && c) {
    delete c.users[uid];
    if (!Object.keys(c.users).length) {   // 마지막 사람이 나감 → 끝
      delete CALLS[p.sid];
      var mins = Math.max(1, Math.round((Date.now() - c.at) / 60000));
      if (c.msgId) {
        await db.query('UPDATE chat_messages SET cards = $2 WHERE id = $1', [c.msgId, JSON.stringify([{ type: 'call', id: p.sid, on: false, video: c.video, from: c.by, mins: mins }])]);
        var upd = await loadMsg(c.msgId); if (upd) hub.publish(await memberIds(room.id), 'upd', upd);
      }
      await postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: (c.video ? '🎥' : '📞') + ' 통화가 끝났습니다 · ' + mins + '분' });
    }
  }
}
router.get('/rooms/:id/call', async function (req, res) {
  try { var room = await roomFor(req, res, req.params.id); if (!room) return; res.json({ data: callOf(room.id) }); }
  catch (e) { httpErr.serverError(res, '[chat/call]', e); }
});

/* 화면 공유 시작 · 끝 알림 메시지 (누르면 보기) */
router.post('/rooms/:id/share', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var b = req.body || {}, sid = String(b.sid || '').slice(0, 60);
    if (!sid) return bad(res, 'sid 필요');
    if (b.on === false) {   // 시작 카드의 [보기] 를 끄기 — 나중에 들어온 사람이 끝난 공유를 누르지 않게
      var st = await db.query("SELECT id FROM chat_messages WHERE room_id = $1 AND kind = 'share' AND cards @> $2::jsonb", [room.id, JSON.stringify([{ type: 'share', id: sid }])]);
      for (var s0 of st.rows) {
        await db.query("UPDATE chat_messages SET cards = jsonb_set(cards, '{0,on}', 'false'::jsonb) WHERE id = $1", [s0.id]);
        hub.publish(await memberIds(room.id), 'upd', await loadMsg(s0.id));
      }
    }
    var msg = await postMessage({ tenantId: req.tenant.id }, room, { userId: me(req), kind: 'share', body: b.on === false ? '🖥 화면 공유를 마쳤습니다' : '🖥 화면 공유를 시작했습니다', cards: [{ type: 'share', id: sid, on: b.on !== false, from: me(req) }] });
    res.status(201).json({ data: msg });
  } catch (e) { httpErr.serverError(res, '[chat/share]', e); }
});

/* ─── / 명령 ─── */
var HELP = [
  '/todo 내용 — 내 할 일로 (예: /todo 내일 15:00 견적 회신 !)',
  '/issue 제목 — 이 프로젝트에 이슈 올리기 (프로젝트 방)',
  '/ai 질문 — 내가 볼 수 있는 데이터로 AI 가 답함 (예: /ai 이번 주 지연 이슈)',
  '/요약 — 이 방 최근 대화를 AI 가 정리 (결정 · 할 일 · 남은 질문)'
].join('\n');
async function runCommand(req, room, body, replyTo) {
  var m = /^\/(\S+)\s*([\s\S]*)$/.exec(body); if (!m) return null;
  var cmd = m[1].toLowerCase(), arg = m[2].trim(), t = req.tenant.id;
  var self = function (text, kind, cards) { return postMessage({ tenantId: t }, room, { userId: kind === 'ai' ? null : me(req), kind: kind || 'text', body: text, cards: cards || null, replyTo: replyTo }); };
  if (cmd === 'help' || cmd === '도움' || cmd === '?') { await self(body); return postMessage({ tenantId: t }, room, { kind: 'system', body: HELP, replyTo: replyTo }); }
  if (cmd === 'todo' || cmd === '할일') {
    if (!arg) return postMessage({ tenantId: t }, room, { kind: 'system', body: '✏️ /todo 다음에 할 일을 적어 주세요', replyTo: replyTo });
    var QP = require('../../quick-parse'), q = QP.parse(arg, kstToday()), title = q.title.slice(0, 500), id = 'todo-' + crypto.randomUUID().slice(0, 12);
    await db.query('INSERT INTO my_todos (id, tenant_id, user_id, title, due_date, due_time, priority, memo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, t, me(req), title, q.due, q.due ? q.time : null, q.priority || 3, '💬 메신저에서']);
    return self('✅ 내 할 일 — ' + title + (q.due ? ' (' + q.due.slice(5).replace('-', '/') + (q.time ? ' ' + q.time : '') + ')' : ''), 'text', [{ type: 'todo', id: id, title: title, sub: q.due || '', nav: { todoId: id } }]);
  }
  if (cmd === 'issue' || cmd === '이슈') {
    if (room.kind !== 'project' || !room.project_id) return postMessage({ tenantId: t }, room, { kind: 'system', body: '⚠️ /issue 는 프로젝트 방에서 씁니다', replyTo: replyTo });
    if (!arg) return postMessage({ tenantId: t }, room, { kind: 'system', body: '✏️ /issue 다음에 이슈 제목을 적어 주세요', replyTo: replyTo });
    if (!await pa.canEditById(req, room.project_id)) return postMessage({ tenantId: t }, room, { kind: 'system', body: '⚠️ 이 프로젝트에 이슈를 올릴 권한이 없습니다', replyTo: replyTo });
    var iid = 'iss-' + crypto.randomUUID().slice(0, 12);
    var urgent = /(^|\s)!(\s|$)|긴급/.test(arg), ttl = arg.replace(/(^|\s)!(\s|$)/, ' ').trim().slice(0, 300);
    await db.query("INSERT INTO issues (id, project_id, urgency, status, report_date, title, description, reporter_id, assignees, tags, created_by, updated_by, tenant_id) VALUES ($1,$2,$3,'open',$4,$5,$6,$7,'[]',$8,$7,$7,$9)",
      [iid, room.project_id, urgent ? 'urgent' : 'normal', kstToday(), ttl, '💬 메신저 프로젝트 방에서 올림', me(req), JSON.stringify(['메신저']), t]);
    return self('🐞 이슈를 올렸습니다', 'text', [{ type: 'issue', id: iid, title: ttl, sub: urgent ? '긴급' : '', status: 'open', urgency: urgent ? 'urgent' : 'normal', nav: { issueId: iid } }]);
  }
  if (cmd === 'ai' || cmd === '요약' || cmd === 'summary') {
    var ai = require('../lib/ai-usage');
    var quota = await ai.checkQuota(t);
    if (!quota.ok) return postMessage({ tenantId: t }, room, { kind: 'system', body: '⚠️ ' + quota.message, replyTo: replyTo });
    if (!ai.takeHourly(me(req))) return postMessage({ tenantId: t }, room, { kind: 'system', body: '⚠️ AI 질문 한도(시간당 60회)를 넘었습니다', replyTo: replyTo });
    await self(body);
    hub.publish(await memberIds(room.id), 'typing', { roomId: room.id, userId: 'ai', name: 'AI' });
    var text = '';
    try {
      if (cmd === 'ai') {
        if (!arg) return postMessage({ tenantId: t }, room, { kind: 'system', body: '✏️ /ai 다음에 질문을 적어 주세요', replyTo: replyTo });
        var out = await require('../services/ai.service').answerWeb(arg.slice(0, 1000), { userId: me(req), role: req.user.role, departmentId: req.user.departmentId || null, tenantId: t, name: req.user.name || '사용자' }, { history: [] });
        if (!out) return postMessage({ tenantId: t }, room, { kind: 'system', body: '⚠️ AI 가 설정되지 않았습니다', replyTo: replyTo });
        text = out.answer || '';
        await ai.logUsage(t, me(req), arg, out.provider);
      } else {
        var n = Math.min(Math.max(parseInt(arg, 10) || 80, 10), 200);
        var hist = await db.query("SELECT COALESCE(u.display_name, u.name, 'AI') AS n, m.body, m.created_at FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.room_id = $1 AND m.deleted_at IS NULL AND m.kind IN ('text','file','ai') ORDER BY m.id DESC LIMIT $2", [room.id, n]);
        var lines = hist.rows.reverse().map(function (x) { return '[' + new Date(x.created_at).toISOString().slice(5, 16).replace('T', ' ') + '] ' + x.n + ': ' + String(x.body || '').slice(0, 400); }).join('\n');
        var prompt = '다음은 사내 메신저 대화입니다. 한국어로 짧게 정리하세요.\n## 요점 (3줄 이내)\n## 정한 것\n## 할 일 (누가 · 무엇을 · 언제)\n## 아직 답이 없는 질문\n없는 항목은 "없음". 지어내지 마세요.\n\n' + lines;
        var g = await require('../services/ai-provider').generateText({ prompt: prompt.slice(0, 15000), tenantId: t });
        if (!g) return postMessage({ tenantId: t }, room, { kind: 'system', body: '⚠️ AI 가 설정되지 않았습니다', replyTo: replyTo });
        text = g.text || '';
        await ai.logUsage(t, me(req), '/요약', g.provider);
      }
    } catch (e) {
      return postMessage({ tenantId: t }, room, { kind: 'system', body: '⚠️ AI 응답 실패: ' + (e.message || e), replyTo: replyTo });
    }
    return postMessage({ tenantId: t }, room, { kind: 'ai', body: text.slice(0, MAX_BODY), replyTo: replyTo });
  }
  return null;   // 모르는 명령 — 그냥 글로
}

router.get('/unread-count', async function (req, res) {
  try {
    var r = await db.query('SELECT COALESCE(SUM((SELECT COUNT(*) FROM chat_messages x WHERE x.room_id = m.room_id AND x.id > m.last_read_id AND x.deleted_at IS NULL AND (x.user_id IS NULL OR x.user_id <> $1) AND x.reply_to IS NULL AND x.kind <> \'system\')), 0)::int AS n FROM chat_members m WHERE m.user_id = $1 AND m.tenant_id = $2 AND m.left_at IS NULL AND m.muted = FALSE', [me(req), req.tenant.id]);
    res.json({ count: r.rows[0].n });
  } catch (e) { httpErr.serverError(res, '[chat/unread]', e); }
});

module.exports = router;
module.exports.postMessage = postMessage;
module.exports.dmRoom = dmRoom;
module.exports.membership = membership;
