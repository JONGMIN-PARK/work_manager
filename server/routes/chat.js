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
var config = require('../config');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');
var hub = require('../lib/chat-hub');
var pa = require('../lib/project-access');
var cxx = require('../lib/chat-extra');   // v13.378 링크 미리보기 · 달력 상태

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
  'COALESCE(u.display_name, u.name) AS user_name, f.id AS f_id, f.name AS f_name, f.mime AS f_mime, f.size AS f_size, f.dur AS f_dur, f.transcript AS f_tx, f.w AS f_w, f.h AS f_h, ' +
  "CASE WHEN m.post IS NULL THEN NULL ELSE (SELECT COALESCE(ua.display_name, ua.name) FROM users ua WHERE ua.id::text = m.post->>'assignee') END AS asg_name, " +
  "(f.annot->>'rot')::real AS f_rot, jsonb_array_length(COALESCE(f.annot->'shapes', '[]'::jsonb)) AS f_n, (f.annot->'crop') IS NOT NULL AND f.annot->>'crop' <> 'null' AS f_crop, f.annot_at AS f_at, " +
  'rp.replies, rp.last_reply_at, ' +
  // v13.376 인용 답장 — 원문 한 줄 (지웠으면 표시만)
  "m.grp, m.link, m.poll, m.ack, m.quote_id, qm.body AS q_body, qm.deleted_at AS q_del, qm.kind AS q_kind, qm.post->>'title' AS q_ptitle, COALESCE(qu.display_name, qu.name) AS q_user, qf.id AS q_fid, qf.name AS q_fname, qf.mime AS q_fmime " +
  'FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN chat_files f ON f.id = m.file_id ' +
  'LEFT JOIN chat_messages qm ON qm.id = m.quote_id LEFT JOIN users qu ON qu.id = qm.user_id LEFT JOIN chat_files qf ON qf.id = qm.file_id ' +
  'LEFT JOIN LATERAL (SELECT COUNT(*)::int AS replies, MAX(t.created_at) AS last_reply_at FROM chat_messages t WHERE t.reply_to = m.id AND t.deleted_at IS NULL) rp ON TRUE ';
function shape(r) {
  return { id: +r.id, roomId: r.room_id, userId: r.user_id, userName: r.user_name || (r.kind === 'ai' ? 'AI' : ''), kind: r.kind,
    body: r.deleted_at ? '' : r.body, deleted: !!r.deleted_at, edited: !!r.edited_at, cards: r.deleted_at ? null : r.cards, mentions: r.mentions || [],
    replyTo: r.reply_to ? +r.reply_to : null, replies: r.replies || 0, lastReplyAt: r.last_reply_at, reactions: r.deleted_at ? null : r.reactions || null,
    post: r.deleted_at || !r.post ? null : Object.assign({}, r.post, { assigneeName: r.asg_name || null }), file: r.f_id && !r.deleted_at ? annSum(Object.assign({ id: r.f_id, name: r.f_name, mime: r.f_mime, size: r.f_size }, r.f_dur ? { dur: +r.f_dur } : {}, r.f_tx ? { transcript: r.f_tx } : {}, r.f_w && r.f_h ? { w: r.f_w, h: r.f_h } : {}), r) : null, at: r.created_at,
    grp: r.grp || null, link: r.deleted_at ? null : r.link || null, poll: r.deleted_at ? null : r.poll || null, ack: r.deleted_at ? null : r.ack || null,
    quote: r.quote_id && !r.deleted_at ? { id: +r.quote_id, userName: r.q_user || (r.q_kind === 'ai' ? 'AI' : ''), deleted: !!r.q_del, body: r.q_del ? '' : String(r.q_ptitle ? '📌 ' + r.q_ptitle : r.q_body || '').slice(0, 200), file: r.q_fid && !r.q_del ? { id: r.q_fid, name: r.q_fname, mime: r.q_fmime } : null } : null };
}
// 사진 칠판 요약 — 목록에선 회전 · 표시 수 · 자름 여부만 (전체는 /files/:fid/annot)
function annSum(f, r) { if (r.f_rot || r.f_n || r.f_crop) f.annot = { rot: Math.round((r.f_rot || 0) * 10) / 10, n: r.f_n || 0, crop: !!r.f_crop, at: r.f_at ? new Date(r.f_at).getTime() : 0 }; return f; }   // v13.451 at — 표시를 고친 시각 (미리보기 다시 만들지 판단)
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
var CARD_TYPES = ['project', 'milestone', 'issue', 'order', 'meeting', 'mindmap', 'doc', 'dev', 'checklist', 'as', 'todo', 'note', 'weekly', 'prestudy', 'tech', 'work', 'comment', 'member', 'message', 'event'];
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
    'INSERT INTO chat_messages (room_id, tenant_id, user_id, kind, body, cards, file_id, mentions, reply_to, legacy_id, post, quote_id, grp, poll, ack) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id',
    [room.id, ctx.tenantId, m.userId || null, m.kind || 'text', body, m.cards ? JSON.stringify(m.cards) : null, m.fileId || null, JSON.stringify(mentions), m.replyTo || null, m.legacyId || null, m.post ? JSON.stringify(m.post) : null, m.quoteId || null, m.grp || null, m.poll ? JSON.stringify(m.poll) : null, m.ack ? JSON.stringify(m.ack) : null]);
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
  if ((m.kind || 'text') === 'text' && m.userId) linkLater(room, id, body);   // v13.378 🔗 미리보기는 뒤에서
  if (m.userId && (m.kind || 'text') !== 'system') scheduleFallback(ctx.tenantId, room, msg, ids.filter(function (u) { return u !== m.userId; }), mentions);
  return msg;
}

/** 🎤 음성 메시지 받아쓰기 (v13.379) — AI(Gemini) 있으면 글로 붙이고 'upd'. 없으면 그냥 소리만 */
function transcribeLater(tenantId, room, mid, fid, buf, mime) {
  require('../services/ai-provider').transcribe({ tenantId: tenantId, data: buf.toString('base64'), mimeType: String(mime).split(';')[0] }).then(async function (t) {
    if (!t || !t.text) return;
    await db.query('UPDATE chat_files SET transcript = $2 WHERE id = $1', [fid, t.text.slice(0, 4000)]);
    var msg = await loadMsg(mid); if (msg) hub.publish(await memberIds(room.id), 'upd', msg);
  }).catch(function (e) { console.warn('[chat] transcribe', e.message); });
}
/** 🔗 링크 미리보기 (v13.378) — 보낸 뒤 뒤에서 읽어 붙이고 'upd' 로 알림 */
function linkLater(room, id, body) {
  var u = cxx.firstUrl(body); if (!u) return;
  cxx.linkPreview(u).then(async function (v) {
    if (!v) return;
    await db.query('UPDATE chat_messages SET link = $2 WHERE id = $1 AND deleted_at IS NULL', [id, JSON.stringify(v)]);
    var msg = await loadMsg(id); if (msg) hub.publish(await memberIds(room.id), 'upd', msg);
  }).catch(function (e) { console.warn('[chat] link', e.message); });
}
/* 🙂 상태 (v13.378) — 내가 정한 것(기한 안) 이 먼저, 없으면 오늘 달력 */
async function statusOf(tenantId, ids, rows0) {
  if (!ids || !ids.length) return {};
  cxx.calRows(tenantId);   // v13.382 달력은 사용자와 동시에
  var r = rows0 ? { rows: rows0 } : await db.query('SELECT u.id, u.name, u.display_name, s.status_emoji, s.status_text, s.status_until FROM users u LEFT JOIN chat_user_state s ON s.user_id = u.id ' +
    'WHERE u.id = ANY($1) AND u.tenant_id = $2', [ids, tenantId]);
  var out = {}, cal = await cxx.calStatus(tenantId, r.rows.map(function (u) { return { id: u.id, names: [u.name, u.display_name] }; }));
  r.rows.forEach(function (u) {
    if ((u.status_text || u.status_emoji) && (!u.status_until || new Date(u.status_until) > new Date())) out[u.id] = { icon: u.status_emoji || '', label: u.status_text || '', until: u.status_until || null, auto: false };
    else if (cal[u.id]) out[u.id] = cal[u.id];
  });
  return out;
}
/** 같은 방 사람들에게 알림 (상태 · 프로필 사진) */
async function peersPublish(tenantId, uid, ev, data) {
  try {
    var r = await db.query('SELECT DISTINCT m2.user_id FROM chat_members m1 JOIN chat_members m2 ON m2.room_id = m1.room_id WHERE m1.user_id = $1 AND m1.tenant_id = $2 AND m2.left_at IS NULL AND m1.left_at IS NULL', [uid, tenantId]);
    hub.publish(r.rows.map(function (x) { return x.user_id; }).concat([uid]), ev, data);
  } catch (e) {}
}
/** 인용할 원문 — 같은 방 메시지만 (v13.376) */
async function quoteOk(room, qid) {
  qid = +qid || 0; if (!qid) return null;
  var r = await db.query('SELECT id FROM chat_messages WHERE id = $1 AND room_id = $2', [qid, room.id]);
  return r.rows.length ? qid : null;
}
/* 📲 접속 안 한 사람에게 바로 휴대폰 푸시 (v13.359) — 음소거 방은 @멘션만 */
var PUSH_GATE = new Map(), PUSH_GAP_MS = +(process.env.CHAT_PUSH_GAP_MS || 60000);
function pushOffline(room, msg, others, mentions0) {
  var off = others.filter(function (u) { return !hub.awake(u); });   // v13.371 접속해 있어도 화면을 내려 둔(가려진) 사람에게는 푸시
  if (!off.length) return;
  var mentions = (mentions0 || []).slice();
  keywordHits(off, msg.body).then(function (kw) { kw.forEach(function (u) { if (mentions.indexOf(u) < 0) mentions.push(u); }); return db.query('SELECT user_id FROM chat_members WHERE room_id = $1 AND user_id = ANY($2) AND left_at IS NULL AND (muted = FALSE OR user_id = ANY($3))', [room.id, off, mentions]); }).then(function (r) {
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
/** 🔑 키워드 알림 (v13.380) — 이 사람들 중 글에 자기 키워드가 있는 사람 */
async function keywordHits(ids, body) {
  var t = String(body || '').toLowerCase(); if (!t || !ids.length) return [];
  var r = await db.query("SELECT user_id, keywords FROM chat_user_state WHERE user_id = ANY($1) AND keywords IS NOT NULL AND jsonb_array_length(keywords) > 0", [ids]).catch(function () { return { rows: [] }; });
  return r.rows.filter(function (x) { return (x.keywords || []).some(function (k) { k = String(k || '').trim().toLowerCase(); return k.length >= 2 && t.indexOf(k) >= 0; }); }).map(function (x) { return x.user_id; });
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
  var ping = setInterval(function () { try { res.write(': ping\n\n'); if (res.flush) res.flush(); } catch (e) {} }, 15000);   // v13.400 25초 → 15초 — 휴대폰이 죽은 연결을 40초 안에 알아채게
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

/* v13.386 시험용 가짜 GCS 이어 올리기 — NODE_ENV=test 이고 GCS 가 꺼져 있을 때만. GCS 세션 주소처럼 토큰만으로 받음
 *   PUT Content-Range: bytes a-b/total → 끝이면 200, 아니면 308 + Range · bytes * /total 은 지금까지 받은 양 묻기 */
var FAKEUP = new Map();
function fakeGcsOn() { return process.env.NODE_ENV === 'test' && !require('../services/gcs.service').isEnabled(); }
router.put('/_fakeup/:tok', express.raw({ type: function () { return true; }, limit: 64 * 1024 * 1024 }), function (req, res) {
  var u = fakeGcsOn() && FAKEUP.get(req.params.tok); if (!u) return res.status(404).end();
  if (process.env.CHAT_FAKEUP_FAIL_ONCE && !u.failed && u.got > 0) { u.failed = true; return res.status(503).end(); }   // 잠깐 오류 흉내 (이어 올리기 시험)
  var cr = /^bytes (\*|(\d+)-(\d+))\/(\d+)$/.exec(String(req.headers['content-range'] || ''));
  if (!cr) return res.status(400).end();
  if (cr[1] !== '*') {
    var a = +cr[2], b = +cr[3], buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (a !== u.got || b - a + 1 !== buf.length) return res.status(400).end();
    u.parts.push(buf); u.got += buf.length;
  }
  if (u.got >= +cr[4]) return res.status(200).json({ size: u.got });
  if (u.got) res.setHeader('Range', 'bytes=0-' + (u.got - 1));
  res.status(308).end();
});

router.use(auth.authenticate);
router.use(tenant.tenantScope);

/* v13.371 이 화면이 가려졌다 · 다시 보인다 — 가려진 동안 새 메시지는 휴대폰 · 브라우저 푸시로 */
router.post('/away', function (req, res) {
  var b = req.body || {};
  var n = hub.setAway(me(req), String(b.cid || '').slice(0, 40), !!b.away);
  res.json({ data: { ok: true, conns: n } });
});

/* ─── 🙂 내 상태 · 🖼 프로필 사진 (v13.378) ─── */
router.get('/me/profile', async function (req, res) {
  try {
    var r = await db.query('SELECT s.status_emoji, s.status_text, s.status_until, a.v FROM users u LEFT JOIN chat_user_state s ON s.user_id = u.id LEFT JOIN chat_avatars a ON a.user_id = u.id WHERE u.id = $1', [me(req)]);
    var x = r.rows[0] || {}, st = await statusOf(req.tenant.id, [me(req)]);
    res.json({ data: { emoji: x.status_emoji || '', text: x.status_text || '', until: x.status_until || null, avatarV: x.v || 0, now: st[me(req)] || null } });
  } catch (e) { httpErr.serverError(res, '[chat/me]', e); }
});
router.put('/me/status', async function (req, res) {
  try {
    var b = req.body || {}, emoji = String(b.emoji || '').slice(0, 16), text = String(b.text || '').trim().slice(0, 60);
    var until = b.until ? new Date(b.until) : null; if (until && (isNaN(until) || until < new Date())) until = null;
    await db.query('INSERT INTO chat_user_state (user_id, tenant_id, status_emoji, status_text, status_until, updated_at) VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (user_id) DO UPDATE SET status_emoji = EXCLUDED.status_emoji, status_text = EXCLUDED.status_text, status_until = EXCLUDED.status_until, updated_at = now()',
      [me(req), req.tenant.id, emoji || null, text || null, until]);
    var st = (await statusOf(req.tenant.id, [me(req)]))[me(req)] || null;
    peersPublish(req.tenant.id, me(req), 'status', { userId: me(req), status: st });
    res.json({ data: { status: st } });
  } catch (e) { httpErr.serverError(res, '[chat/status]', e); }
});
router.get('/me/keywords', async function (req, res) {
  try { var r = await db.query('SELECT keywords FROM chat_user_state WHERE user_id = $1', [me(req)]); res.json({ data: (r.rows[0] && r.rows[0].keywords) || [] }); }
  catch (e) { httpErr.serverError(res, '[chat/kw]', e); }
});
router.put('/me/keywords', async function (req, res) {
  try {
    var list = (Array.isArray((req.body || {}).keywords) ? req.body.keywords : []).map(function (k) { return String(k || '').trim().slice(0, 30); }).filter(function (k) { return k.length >= 2; });
    list = list.filter(function (k, i) { return list.indexOf(k) === i; }).slice(0, 20);
    await db.query('INSERT INTO chat_user_state (user_id, tenant_id, keywords, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (user_id) DO UPDATE SET keywords = EXCLUDED.keywords, updated_at = now()', [me(req), req.tenant.id, JSON.stringify(list)]);
    res.json({ data: list });
  } catch (e) { httpErr.serverError(res, '[chat/kw/put]', e); }
});
router.get('/avatars', async function (req, res) {
  try {
    var r = await db.query('SELECT user_id, v FROM chat_avatars WHERE tenant_id = $1', [req.tenant.id]);
    var o = {}; r.rows.forEach(function (x) { o[x.user_id] = x.v; });
    res.json({ data: o });
  } catch (e) { httpErr.serverError(res, '[chat/avatars]', e); }
});
router.get('/avatar/:uid', async function (req, res) {
  try {
    var r = await db.query('SELECT img FROM chat_avatars WHERE user_id = $1 AND tenant_id = $2', [req.params.uid, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '사진이 없습니다.' });
    res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');   // 주소에 ?v= 버전
    res.end(r.rows[0].img);
  } catch (e) { httpErr.serverError(res, '[chat/avatar]', e); }
});
router.post('/me/avatar', express.raw({ type: function () { return true; }, limit: 120 * 1024 }), async function (req, res) {
  try {
    var buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 100 || buf[0] !== 0xFF || buf[1] !== 0xD8) return bad(res, 'JPEG 사진만 받습니다.');
    var r = await db.query('INSERT INTO chat_avatars (user_id, tenant_id, img, v, updated_at) VALUES ($1,$2,$3,1,now()) ON CONFLICT (user_id) DO UPDATE SET img = EXCLUDED.img, v = chat_avatars.v + 1, updated_at = now() RETURNING v', [me(req), req.tenant.id, buf]);
    peersPublish(req.tenant.id, me(req), 'avatar', { userId: me(req), v: r.rows[0].v });
    res.json({ data: { v: r.rows[0].v } });
  } catch (e) {
    if (e && e.type === 'entity.too.large') return bad(res, '사진이 너무 큽니다.', 413);
    httpErr.serverError(res, '[chat/avatar/put]', e);
  }
});
router.delete('/me/avatar', async function (req, res) {
  try {
    await db.query('DELETE FROM chat_avatars WHERE user_id = $1', [me(req)]);
    peersPublish(req.tenant.id, me(req), 'avatar', { userId: me(req), v: 0 });
    res.json({ data: { v: 0 } });
  } catch (e) { httpErr.serverError(res, '[chat/avatar/del]', e); }
});
/* 🔗 링크 미리보기 사진 — 바깥 사진은 화면 보안 정책상 바로 못 띄워 서버가 대신 받음. 내가 볼 수 있는 방의 미리보기 사진만 */
router.get('/link-img', async function (req, res) {
  try {
    var u = String(req.query.u || '').slice(0, 600);
    var ok = await db.query("SELECT 1 FROM chat_messages m JOIN chat_members cm ON cm.room_id = m.room_id AND cm.user_id = $2 AND cm.left_at IS NULL WHERE m.tenant_id = $3 AND m.link->>'image' = $1 LIMIT 1", [u, me(req), req.tenant.id]);
    if (!ok.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '사진이 없습니다.' });
    var img = await cxx.linkImage(u);
    if (!img) return res.status(404).json({ error: 'NOT_FOUND', message: '사진을 가져오지 못했습니다.' });
    res.setHeader('Content-Type', img.type); res.setHeader('Cache-Control', 'private, max-age=86400'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(img.buf);
  } catch (e) { httpErr.serverError(res, '[chat/link-img]', e); }
});

/* ─── 사람 목록 (새 대화 · 멘션) ─── */
router.get('/users', async function (req, res) {
  try {
    var r = await db.query("SELECT u.id, COALESCE(u.display_name, u.name) AS name, u.role, d.name AS dept FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.tenant_id = $1 AND u.status = 'active' ORDER BY 2", [req.tenant.id]);
    var on = hub.onlineSet(r.rows.map(function (u) { return u.id; }));
    var st = await statusOf(req.tenant.id, r.rows.map(function (u) { return u.id; }));
    res.json({ data: r.rows.map(function (u) { return { id: u.id, name: u.name, dept: u.dept || '', role: u.role, online: !!on[u.id], status: st[u.id] || null, me: u.id === me(req) }; }) });
  } catch (e) { httpErr.serverError(res, '[chat/users]', e); }
});

/* ─── 방 목록 ─── */
router.get('/rooms', async function (req, res) {
  try {
    cxx.calRows(req.tenant.id);   // v13.382 상태용 달력은 목록과 동시에
    var r = await db.query(
      'SELECT r.id, r.kind, r.name, r.project_id, r.last_msg_at, r.dm_key, m.last_read_id, m.muted, m.pinned, p.name AS project_name, ' +
      '(SELECT COUNT(*)::int FROM chat_messages x WHERE x.room_id = r.id AND x.id > m.last_read_id AND x.deleted_at IS NULL AND (x.user_id IS NULL OR x.user_id <> $1) AND x.reply_to IS NULL AND x.kind <> \'system\') AS unread, ' +
      '(SELECT COUNT(*)::int FROM chat_messages x WHERE x.room_id = r.id AND x.id > m.last_read_id AND x.deleted_at IS NULL AND x.mentions @> to_jsonb($1::text)) AS mentioned, ' +
      '(SELECT row_to_json(l) FROM (SELECT x.id, x.kind, x.body, x.user_id, x.deleted_at, x.file_id, x.post->>\'title\' AS ptitle, COALESCE(u.display_name, u.name) AS user_name, xf.mime AS fmime FROM chat_messages x LEFT JOIN users u ON u.id = x.user_id LEFT JOIN chat_files xf ON xf.id = x.file_id WHERE x.room_id = r.id AND x.reply_to IS NULL ORDER BY x.id DESC LIMIT 1) l) AS last, ' +
      "(SELECT json_agg(json_build_object('id', u2.id, 'name', COALESCE(u2.display_name, u2.name))) FROM chat_members m2 JOIN users u2 ON u2.id = m2.user_id WHERE m2.room_id = r.id AND m2.left_at IS NULL AND m2.user_id <> $1) AS others " +
      'FROM chat_members m JOIN chat_rooms r ON r.id = m.room_id LEFT JOIN projects p ON p.id = r.project_id ' +
      'WHERE m.user_id = $1 AND m.tenant_id = $2 AND m.left_at IS NULL AND r.archived_at IS NULL ORDER BY m.pinned DESC, r.last_msg_at DESC LIMIT 300', [me(req), req.tenant.id]);
    var all = [];
    r.rows.forEach(function (x) { (x.others || []).forEach(function (o) { all.push(o.id); }); });
    var dmPeers = r.rows.filter(function (x) { return x.kind === 'dm' && x.others && x.others[0]; }).map(function (x) { return x.others[0].id; });
    var on = hub.onlineSet(all), fp = await Promise.all([focusOf(all), statusOf(req.tenant.id, dmPeers)]), fo = fp[0], pst = fp[1];   // v13.382 동시에
    res.json({ data: r.rows.map(function (x) {
      var others = x.others || [];
      var name = x.kind === 'dm' ? (others[0] ? others[0].name : '(나간 사람)') : x.kind === 'project' ? (x.name || x.project_name || '프로젝트') : (x.name || others.map(function (o) { return o.name; }).slice(0, 4).join(', '));
      var l = x.last;
      return { id: x.id, kind: x.kind, name: name, self: !!(x.dm_key && x.dm_key.indexOf('self:') === 0), projectId: x.project_id, unread: x.unread, mentioned: x.mentioned, muted: x.muted, pinned: x.pinned, lastAt: x.last_msg_at,
        peerId: x.kind === 'dm' && others[0] ? others[0].id : null, peerFocus: x.kind === 'dm' && others[0] && fo[others[0].id] ? fo[others[0].id].until : null, peerStatus: x.kind === 'dm' && others[0] ? pst[others[0].id] || null : null, online: x.kind === 'dm' && others[0] ? !!on[others[0].id] : others.some(function (o) { return on[o.id]; }), members: others.length + 1,
        lastId: l ? +l.id : 0, readId: +x.last_read_id, last: l ? { userName: l.user_name || '', body: l.deleted_at ? '(지운 메시지)' : l.ptitle ? '📌 ' + l.ptitle : l.file_id && !l.body ? (/^image\//.test(l.fmime || '') ? '📷 사진' : /^audio\//.test(l.fmime || '') ? '🎤 음성 메시지' : '📎 파일') : (l.body || '').slice(0, 120), mine: l.user_id === me(req), kind: l.kind } : null };
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

/* v13.425 1:1 → 새 그룹 방 "지금까지 대화도 같이 보이기" (기본은 안 보임 · 고른 사람만)
 *   조건: 내가 그 1:1 방 사람 · 1:1 두 사람이 모두 새 방에 있음. 최근 n개(최대 200) 글만 — 사진 · 파일은 이름만(원래 방에서만 열림)
 *   앞뒤로 "여기부터 / 여기까지 이전 1:1 대화" 줄. 옮긴 글은 모두 읽은 것으로 */
async function copyDmHistory(req, room, memberIds, opt) {
  try {
    var t = req.tenant.id, dmId = String(opt.roomId || ''), n = Math.min(Math.max(parseInt(opt.n, 10) || 50, 1), 200);
    var dm = (await db.query("SELECT r.id, r.kind FROM chat_rooms r JOIN chat_members m ON m.room_id = r.id AND m.user_id = $2 AND m.left_at IS NULL WHERE r.id = $1 AND r.tenant_id = $3", [dmId, me(req), t])).rows[0];
    if (!dm || dm.kind !== 'dm') return 0;
    var both = (await db.query('SELECT user_id FROM chat_members WHERE room_id = $1', [dm.id])).rows.map(function (x) { return x.user_id; });
    if (!both.every(function (u) { return memberIds.indexOf(u) >= 0; })) return 0;   // 상대가 빠진 방엔 안 옮김
    var rows = (await db.query("SELECT m.user_id, m.kind, m.body, m.cards, m.created_at, f.name AS fname, f.mime FROM chat_messages m LEFT JOIN chat_files f ON f.id = m.file_id WHERE m.room_id = $1 AND m.deleted_at IS NULL AND m.reply_to IS NULL AND m.kind IN ('text','file') ORDER BY m.id DESC LIMIT $2", [dm.id, n])).rows.reverse();
    if (!rows.length) return 0;
    var nm = await userNames(t, both);
    await postMessage({ tenantId: t }, room, { kind: 'system', body: '🔓 여기부터 이전 1:1 대화 (' + both.map(function (u) { return nm[u] || ''; }).join(' ↔ ') + ' · 최근 ' + rows.length + '개) — ' + (req.user.name || '') + ' 님이 함께 보이기로 함' });
    for (var i = 0; i < rows.length; i++) {
      var x = rows[i], body = x.body || '';
      if (x.fname) body = (body ? body + '\n' : '') + (/^image\//.test(x.mime || '') ? '📷 사진 ' : '📎 ') + x.fname + ' (원래 1:1 방에서만 열림)';
      await db.query("INSERT INTO chat_messages (room_id, tenant_id, user_id, kind, body, cards, created_at) VALUES ($1,$2,$3,'text',$4,$5,$6)", [room.id, t, x.user_id, body.slice(0, MAX_BODY), x.cards ? JSON.stringify(x.cards) : null, x.created_at]);
    }
    await postMessage({ tenantId: t }, room, { kind: 'system', body: '🔒 여기까지 이전 1:1 대화 — 이 아래부터 새 대화' });
    var mx = (await db.query('SELECT MAX(id) AS mx FROM chat_messages WHERE room_id = $1', [room.id])).rows[0].mx;
    await db.query('UPDATE chat_members SET last_read_id = GREATEST(COALESCE(last_read_id, 0), $2) WHERE room_id = $1', [room.id, mx]); _midDrop(room.id);
    return rows.length;
  } catch (e) { console.error('[chat/copyDm]', e.message); return 0; }
}
router.post('/rooms', async function (req, res) {
  try {
    var b = req.body || {}, t = req.tenant.id;
    if (b.kind === 'self') {   // v13.380 📝 나와의 채팅 — PC ↔ 휴대폰 옮기기 · 메모 (나만 있는 방, 맨 위 고정)
      var sk = 'self:' + me(req);
      var ex0 = (await db.query('SELECT id FROM chat_rooms WHERE tenant_id = $1 AND dm_key = $2', [t, sk])).rows[0];
      if (ex0) { await db.query('UPDATE chat_members SET left_at = NULL WHERE room_id = $1 AND user_id = $2', [ex0.id, me(req)]); return res.json({ data: { id: ex0.id } }); }
      var sid = rid('grp');
      await db.query("INSERT INTO chat_rooms (id, tenant_id, kind, name, dm_key, created_by) VALUES ($1,$2,'group','나와의 채팅',$3,$4) ON CONFLICT DO NOTHING", [sid, t, sk, me(req)]);
      var got = (await db.query('SELECT id FROM chat_rooms WHERE tenant_id = $1 AND dm_key = $2', [t, sk])).rows[0];
      await db.query("INSERT INTO chat_members (room_id, user_id, tenant_id, role, pinned) VALUES ($1,$2,$3,'owner',TRUE) ON CONFLICT DO NOTHING", [got.id, me(req), t]); _midDrop(got.id);
      return res.status(201).json({ data: { id: got.id } });
    }
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
      var copied = b.fromDm ? await copyDmHistory(req, r0, [me(req)].concat(ids), b.fromDm) : 0;
      return res.status(201).json({ data: { id: id, copied: copied } });
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
      db.query('SELECT m.user_id, m.role, m.last_read_id, COALESCE(u.display_name, u.name) AS name, u.name AS uname, u.display_name, s.status_emoji, s.status_text, s.status_until, d.name AS dept, CASE WHEN s.focus_until > now() THEN s.focus_until END AS focus_until FROM chat_members m JOIN users u ON u.id = m.user_id LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN chat_user_state s ON s.user_id = m.user_id WHERE m.room_id = $1 AND m.left_at IS NULL ORDER BY 4', [room.id]),
      room.notice_id ? loadMsg(room.notice_id) : null,
      room.kind !== 'dm' ? canManage(req, room) : false,
      // v13.375 들어오기 전 대화 — 최근 30일 안에 들어왔으면 그 앞 대화 수 (👋 요약 · 처음부터 읽기 띠)
      room.kind !== 'dm' && room.joined_at && Date.now() - new Date(room.joined_at) < 30 * 864e5 ?
        db.query("SELECT COUNT(*)::int AS n, MAX(id) AS up FROM chat_messages WHERE room_id = $1 AND created_at < $2 AND kind <> 'system' AND reply_to IS NULL AND deleted_at IS NULL", [room.id, room.joined_at]) : null,
      cxx.calRows(req.tenant.id)   // v13.382 상태용 달력도 같이 (예전엔 멤버 다음에 상태 · 달력을 차례로 — DB 왕복 2번 더)
    ]);
    var m = all[0], notice = all[1], pr = all[3] && all[3].rows[0];
    var on = hub.onlineSet(m.rows.map(function (x) { return x.user_id; }));
    var st = await statusOf(req.tenant.id, m.rows.map(function (x) { return x.user_id; }), m.rows.map(function (x) { return { id: x.user_id, name: x.uname, display_name: x.display_name, status_emoji: x.status_emoji, status_text: x.status_text, status_until: x.status_until }; }));
    res.json({ data: { id: room.id, kind: room.kind, name: room.name, self: !!(room.dm_key && room.dm_key.indexOf('self:') === 0), projectId: room.project_id, muted: room.muted, pinned: room.pinned, lastReadId: +room.last_read_id, notice: notice && !notice.deleted && !(room.hist_from && notice.id <= +room.hist_from) ? notice : null,
      myRole: room.role || 'member', equipKey: room.equip_key || null, canManage: !!all[2], histFrom: room.hist_from ? +room.hist_from : null, prior: pr && pr.n ? { n: pr.n, upTo: +pr.up, joinedAt: room.joined_at } : null,
      members: m.rows.map(function (x) { return { id: x.user_id, name: x.name, dept: x.dept || '', role: x.role, online: !!on[x.user_id], focusUntil: x.focus_until || null, status: st[x.user_id] || null, readId: +x.last_read_id, me: x.user_id === me(req) }; }) } });
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
    var msg = await postMessage({ tenantId: req.tenant.id }, room, { userId: me(req), kind: 'text', body: body, cards: cards, replyTo: replyTo, quoteId: replyTo ? null : await quoteOk(room, b.quoteId), ack: b.ack && !replyTo ? { req: true, by: {} } : null });
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
    if ((req.body || {}).messageId && !Number.isInteger(mid)) return bad(res, '공지로 올릴 수 없는 글입니다 (나만 보기 글 등).');
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
    var name = safeName(req.query.name);
    var mime = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120);
    if (blockedFile(name, mime)) return bad(res, '실행 파일 · 스크립트는 올릴 수 없습니다.');
    var fid = rid('cf'), key = null, gcs = require('../services/gcs.service');
    if (gcs.isEnabled() && gcs.uploadBuffer) {
      key = 'tenants/' + req.tenant.id + '/chat/' + room.id + '/' + fid + (/\.[A-Za-z0-9]{1,8}$/.exec(name) || [''])[0].toLowerCase();
      await gcs.uploadBuffer(key, buf, mime);
    }
    var msg = await fileSaved(req, room, { fid: fid, name: name, mime: mime, size: buf.length, key: key, buf: key ? null : buf, q: req.query });
    res.status(201).json({ data: msg });
    if (/^audio\//i.test(mime) && buf.length < 8 * 1024 * 1024) transcribeLater(req.tenant.id, room, msg.id, fid, buf, mime);   // 받아쓰기는 뒤에서
  } catch (e) {
    if (e && e.type === 'entity.too.large') return bad(res, '25MB 까지 올릴 수 있습니다.', 413);
    httpErr.serverError(res, '[chat/file]', e);
  }
});
/** 올린 파일 저장 + 방에 메시지 (예전 경로 · 직접 올리기 같이 씀). q: caption · grp · replyTo · quoteId · dur */
async function fileSaved(req, room, o) {
  var q = o.q || {}, audio = /^audio\//i.test(o.mime), dur = audio ? Math.max(0, Math.min(900, +q.dur || 0)) || null : null;   // v13.379 🎤 음성 메시지 길이
  await db.query('INSERT INTO chat_files (id, tenant_id, room_id, user_id, name, mime, size, storage_key, data, dur) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [o.fid, req.tenant.id, room.id, me(req), o.name, o.mime, o.size, o.key, o.buf || null, dur]);
  return postMessage({ tenantId: req.tenant.id }, room, { userId: me(req), kind: 'file', body: String(q.caption || '').slice(0, 2000), fileId: o.fid, grp: /^[A-Za-z0-9_-]{4,40}$/.test(q.grp || '') ? q.grp : null, replyTo: q.replyTo ? +q.replyTo : null, quoteId: q.replyTo ? null : await quoteOk(room, q.quoteId) });
}
function safeName(n) { return String(n || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200) || 'file'; }
function blockedFile(name, mime) { return /^(text\/html|application\/x-msdownload)/i.test(mime) || /\.(exe|bat|cmd|com|scr|js|vbs|ps1|msi)$/i.test(name); }

/* v13.386 📦 큰 파일 — 브라우저가 GCS 에 바로(서버를 안 거침) · 8MB 씩 나눠 · 끊기면 이어서. 서버는 허가(이어 올리기 세션)와 마무리만
 *   1) POST /rooms/:id/files/init { name, mime, size } → { fid, url, chunk }   (GCS 가 꺼져 있으면 { direct: false } — 예전 25MB 경로로)
 *   2) 브라우저가 url 에 PUT (Content-Range) — 308 이면 다음 조각, 끊기면 bytes * /size 로 받은 양 묻고 이어서
 *   3) POST /rooms/:id/files/:fid/done { caption, grp, replyTo, quoteId } → 크기 확인 후 방에 메시지
 *   한도: CHAT_MAX_FILE_MB (기본 2048MB) */
var MAX_DIRECT = (+process.env.CHAT_MAX_FILE_MB || 2048) * 1024 * 1024, UPS = new Map();
function upOrigin(req) {
  var o = String(req.headers.origin || ''); if (!o) return null;
  try { var u = new URL(o); if (u.host === req.get('host')) return o; } catch (e) { return null; }
  return String(config.cors.origin || '').split(',').map(function (x) { return x.trim(); }).indexOf(o) >= 0 ? o : null;
}
router.post('/rooms/:id/files/init', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (readOnly(res, room)) return;
    var b = req.body || {}, name = safeName(b.name), mime = String(b.mime || 'application/octet-stream').slice(0, 120), size = Math.floor(+b.size || 0);
    if (!size) return bad(res, '파일이 비었습니다.');
    if (blockedFile(name, mime)) return bad(res, '실행 파일 · 스크립트는 올릴 수 없습니다.');
    if (size > MAX_DIRECT) return bad(res, Math.round(MAX_DIRECT / 1048576) + 'MB 까지 올릴 수 있습니다.', 413);
    var gcs = require('../services/gcs.service'), fid = rid('cf'), url, key = null;
    if (gcs.isEnabled() && gcs.createResumable) {
      key = 'tenants/' + req.tenant.id + '/chat/' + room.id + '/' + fid + (/\.[A-Za-z0-9]{1,8}$/.exec(name) || [''])[0].toLowerCase();
      var origin = upOrigin(req);
      await gcs.ensureCors(origin);
      url = await gcs.createResumable(key, mime, origin);
    } else if (fakeGcsOn()) {
      var tok = crypto.randomBytes(16).toString('hex');
      FAKEUP.set(tok, { got: 0, parts: [] });
      url = (req.protocol + '://' + req.get('host')) + '/api/chat/_fakeup/' + tok; key = 'fake:' + tok;
    } else return res.json({ data: { direct: false } });
    UPS.forEach(function (v, k) { if (Date.now() - v.at > 24 * 3600000) UPS.delete(k); });   // 하루 지난 것 정리
    UPS.set(fid, { room: room.id, user: me(req), tenant: req.tenant.id, name: name, mime: mime, size: size, key: key, at: Date.now() });
    res.status(201).json({ data: { direct: true, fid: fid, url: url, chunk: 8 * 1024 * 1024 } });
  } catch (e) { httpErr.serverError(res, '[chat/file-init]', e); }
});
router.post('/rooms/:id/files/:fid/done', async function (req, res) {
  try {
    var u = UPS.get(req.params.fid);
    if (!u || u.user !== me(req) || u.room !== req.params.id || u.tenant !== req.tenant.id) return bad(res, '올리던 파일을 찾지 못했습니다 — 다시 보내 주세요.', 404);
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var buf = null, size;
    if (/^fake:/.test(u.key)) {
      var f = FAKEUP.get(u.key.slice(5)); size = f ? f.got : 0; buf = f ? Buffer.concat(f.parts) : null;
    } else size = await require('../services/gcs.service').objectSize(u.key).catch(function () { return 0; });
    if (size !== u.size) return bad(res, '파일이 다 올라가지 않았습니다 (' + size + ' / ' + u.size + ' 바이트) — 다시 보내 주세요.');
    UPS.delete(req.params.fid); if (/^fake:/.test(u.key)) FAKEUP.delete(u.key.slice(5));
    var msg = await fileSaved(req, room, { fid: req.params.fid, name: u.name, mime: u.mime, size: size, key: /^fake:/.test(u.key) ? null : u.key, buf: buf, q: req.body || {} });
    res.status(201).json({ data: msg });
  } catch (e) { httpErr.serverError(res, '[chat/file-done]', e); }
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
    if (req.query.thumb) {   // v13.377 대화 속 사진은 작은 미리보기 — 본문(수 MB)은 안 읽음
      var ft = await fileFor(req, res, 'f.id, f.room_id, f.mime, f.thumb'); if (!ft) return;
      if (ft.thumb) {
        res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('X-Thumb', '1');
        res.setHeader('Cache-Control', 'private, max-age=2592000');   // v13.436 미리보기는 바뀌지 않음 — 30일
        return res.end(ft.thumb);
      }
    }
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
/* v13.409 회전은 0.1° 단위 (비스듬히 찍힌 사진 바로잡기) — 0 이상 360 미만 */
function annAng(v) { v = Math.round((+v || 0) * 10) / 10; v = ((v % 360) + 360) % 360; return v >= 359.95 ? 0 : Math.round(v * 10) / 10; }
function annRect(c) {
  if (!c || typeof c !== 'object') return null;
  var o = { x: annNum(c.x), y: annNum(c.y), w: annNum(c.w), h: annNum(c.h) };
  return o.w > 4 && o.h > 4 ? o : null;
}
router.get('/files/:fid/annot', async function (req, res) {
  try {
    var f = await fileFor(req, res, FILE_META); if (!f) return;   // v13.373 본문 없이 · 이름 같이 (DB 한 번)
    var v = await db.query('SELECT angle, fill FROM chat_file_views WHERE user_id = $1 AND file_id = $2', [me(req), f.id]);
    res.json({ data: f.annot || { rot: 0, crop: null, shapes: [] }, at: f.annot_at, byName: f.annot_by_name || '', mine: v.rows[0] ? { a: annAng(v.rows[0].angle), f: v.rows[0].fill } : null });
  } catch (e) { httpErr.serverError(res, '[chat/annot/get]', e); }
});
/* v13.451 표시 묶어 받기 — 대화 한 쪽의 표시 있는 사진을 한 번에 (사진마다 따로 받던 것) · 40장씩 */
router.post('/annots', async function (req, res) {
  try {
    var ids = Array.isArray((req.body || {}).ids) ? req.body.ids.filter(function (x) { return typeof x === 'string' && x.length <= 40; }).slice(0, 40) : [];
    if (!ids.length) return res.json({ data: {} });
    var r = await db.query('SELECT f.id, f.annot, f.annot_at FROM chat_files f JOIN chat_members m ON m.room_id = f.room_id AND m.user_id = $3 AND m.left_at IS NULL ' +
      'WHERE f.id = ANY($1) AND f.tenant_id = $2 AND f.annot IS NOT NULL', [ids, req.tenant.id, me(req)]);
    var out = {}; r.rows.forEach(function (x) { out[x.id] = { a: x.annot, at: x.annot_at ? new Date(x.annot_at).getTime() : 0 }; });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: out });
  } catch (e) { httpErr.serverError(res, '[chat/annots]', e); }
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
      if (b.rot != null) { a.rot = annAng(b.rot); op.rot = a.rot; }
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
    hub.publish(await memberIds(f.room_id), 'annot', { fileId: f.id, roomId: f.room_id, by: uid, byName: await myName(req), op: op, sum: { rot: out.rot || 0, n: out.shapes.length, crop: !!out.crop, at: Date.now() } });
    res.json({ data: { rot: out.rot || 0, crop: out.crop || null, n: out.shapes.length } });
  } catch (e) {
    if (e && e.status === 400) return bad(res, e.message);
    httpErr.serverError(res, '[chat/annot]', e);
  }
});
/* 🖼 나만 보는 회전 (v13.409) — 남의 화면은 그대로. angle 이 null 이면 지움(같이 쓰는 회전을 따름) */
router.put('/files/:fid/view', async function (req, res) {
  try {
    var f = await fileFor(req, res, 'f.id, f.room_id, f.mime'); if (!f) return;
    if (!/^image\//i.test(f.mime || '')) return bad(res, '사진만 돌릴 수 있습니다.');
    var b = req.body || {};
    if (b.angle == null) { await db.query('DELETE FROM chat_file_views WHERE user_id = $1 AND file_id = $2', [me(req), f.id]); return res.json({ data: null }); }
    var a = annAng(b.angle), fill = !!b.fill;
    await db.query('INSERT INTO chat_file_views (user_id, file_id, tenant_id, angle, fill) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, file_id) DO UPDATE SET angle = EXCLUDED.angle, fill = EXCLUDED.fill, updated_at = now()',
      [me(req), f.id, req.tenant.id, a, fill]);
    res.json({ data: { a: a, f: fill } });
  } catch (e) { httpErr.serverError(res, '[chat/view]', e); }
});
/* 내가 돌려 둔 사진 전부 (앱 켤 때 한 번) — 내 것만이라 방 권한은 필요 없음 */
router.get('/my-views', async function (req, res) {
  try {
    var r = await db.query('SELECT file_id, angle, fill FROM chat_file_views WHERE user_id = $1 AND tenant_id = $2 ORDER BY updated_at DESC LIMIT 5000', [me(req), req.tenant.id]);
    var out = {}; r.rows.forEach(function (v) { out[v.file_id] = { a: annAng(v.angle), f: v.fill }; });
    res.json({ data: out });
  } catch (e) { httpErr.serverError(res, '[chat/my-views]', e); }
});
/* v13.436 🖼 사진 크기 적어 두기 — 처음 본 사람이 알려 줌(예전 사진) · 올린 사람이 바로 알려 줌(새 사진). 이미 있으면 그대로 */
router.post('/files/:fid/dim', async function (req, res) {
  try {
    var f = await fileFor(req, res, 'f.id, f.room_id, f.mime, f.w'); if (!f) return;
    var w = Math.round(+(req.body || {}).w), h = Math.round(+(req.body || {}).h);
    if (!/^image\//i.test(f.mime || '') || !(w >= 1 && w <= 30000 && h >= 1 && h <= 30000)) return bad(res, '사진 크기가 올바르지 않습니다.');
    if (!f.w) await db.query('UPDATE chat_files SET w = $2, h = $3 WHERE id = $1 AND w IS NULL', [f.id, w, h]);
    res.json({ data: { ok: true } });
  } catch (e) { httpErr.serverError(res, '[chat/dim]', e); }
});
/* v13.436 🖼 미리보기 여러 장 한 번에 — 사진마다 따로 받으면 장마다 왕복이라 옛 대화를 올려 볼 때 느렸다. 내가 들어가 있는 방의 것만 */
router.post('/thumbs', async function (req, res) {
  try {
    var ids = Array.isArray((req.body || {}).ids) ? req.body.ids.filter(function (x) { return typeof x === 'string' && x.length <= 40; }).slice(0, 40) : [];
    if (!ids.length) return res.json({ data: {} });
    var r = await db.query('SELECT f.id, f.thumb FROM chat_files f JOIN chat_members m ON m.room_id = f.room_id AND m.user_id = $3 AND m.left_at IS NULL ' +
      'WHERE f.id = ANY($1) AND f.tenant_id = $2 AND f.thumb IS NOT NULL', [ids, req.tenant.id, me(req)]);
    var out = {}; r.rows.forEach(function (x) { out[x.id] = x.thumb.toString('base64'); });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: out });
  } catch (e) { httpErr.serverError(res, '[chat/thumbs]', e); }
});
/* 🖼 작은 미리보기 올리기 (v13.377) — 서버에 사진 줄이는 도구가 없어 브라우저가 만들어 올림. 이미 있으면 보낸 사람만 바꿈 */
router.post('/files/:fid/thumb', express.raw({ type: function () { return true; }, limit: 300 * 1024 }), async function (req, res) {
  try {
    var f = await fileFor(req, res, 'f.id, f.room_id, f.mime, f.user_id, (f.thumb IS NOT NULL) AS has_thumb'); if (!f) return;
    if (!/^image\//i.test(f.mime || '')) return bad(res, '사진에만 미리보기를 붙입니다.');
    var buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 100 || buf[0] !== 0xFF || buf[1] !== 0xD8) return bad(res, 'JPEG 미리보기만 받습니다.');
    if (f.has_thumb && f.user_id !== me(req)) return res.json({ data: { ok: true, kept: true } });
    await db.query('UPDATE chat_files SET thumb = $2 WHERE id = $1', [f.id, buf]);
    res.json({ data: { ok: true } });
  } catch (e) {
    if (e && e.type === 'entity.too.large') return bad(res, '미리보기가 너무 큽니다.', 413);
    httpErr.serverError(res, '[chat/thumb]', e);
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
      if (b.op.rot != null) op.rot = annAng(b.op.rot);
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

/* ─── v13.423 ④ 메시지 → 업무 (AI 가 칸 채움) · ⑤ 대화 → 정한 것 · 할 일 · 남은 질문 ───
 * AI 가 없거나(키 · 한도) 실패하면 규칙으로 — 첫 줄 = 제목, 날짜 말(내일 · 11/14 · 금요일 …) = 날짜, '긴급' = 긴급.
 * body.ai === false 면 처음부터 규칙만 (시험 · 한도 아끼기) */
function aiJson(text) {
  var s = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  var a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}
async function aiAsk(req, prompt, tag, useAi) {
  if (useAi === false) return null;
  var ai = require('../lib/ai-usage'), t = req.tenant.id;
  try {
    var quota = await ai.checkQuota(t); if (!quota.ok || !ai.takeHourly(me(req))) return null;
    var g = await require('../services/ai-provider').generateText({ prompt: prompt.slice(0, 15000), tenantId: t, json: true, maxTokens: 1500 });
    if (!g) return null;
    await ai.logUsage(t, me(req), tag, g.provider);
    return aiJson(g.text);
  } catch (e) { console.warn('[chat/' + tag + ']', e.message); return null; }
}
function qpDay(text) {   // '내일까지' · '금요일에' 처럼 붙은 말도 날짜로
  var QP = require('../../quick-parse');
  var s = String(text || '').replace(/(오늘|내일|모레|[일월화수목금토]요일|\d{1,2}\/\d{1,2}|\d{1,2}일)(까지|에|중|쯤|전에|부터)/g, '$1 ');
  return QP.parse(s, kstToday());
}
function firstLine(s, n) { return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean)[0] ? String(s).split('\n').map(function (x) { return x.trim(); }).filter(Boolean)[0].slice(0, n || 80) : ''; }
var DRAFT_KINDS = {
  issue: { ask: '{"title":"이슈 제목(40자 이내, 명사형)","description":"무슨 문제인지 · 어디서 · 언제 (원문 근거만)","urgency":"urgent 또는 normal","dueDate":"YYYY-MM-DD 또는 빈칸"}' },
  as: { ask: '{"customerName":"고객사","siteLine":"현장 · 라인","equipmentModel":"장비 모델","serialNo":"시리얼","issueSummary":"증상 한 줄","reproduction":"재현 조건 · 빈도","priority":"P1(긴급·라인 정지) · P2(높음) · P3(보통) · P4(낮음) 중 하나"}' },
  event: { ask: '{"title":"일정 제목","startDate":"YYYY-MM-DD","startTime":"HH:MM 또는 빈칸","endTime":"HH:MM 또는 빈칸","location":"장소 또는 빈칸"}' },
  todo: { ask: '{"title":"할 일(동사로 끝나게)","dueDate":"YYYY-MM-DD 또는 빈칸","dueTime":"HH:MM 또는 빈칸","priority":"1(긴급)~4(낮음)"}' }
};
function draftRule(kind, body) {
  var q = qpDay(body), urgent = /긴급|급함|급해|빨리|asap|!{1,2}(\s|$)/i.test(body), line = firstLine(body, 80);
  var title = (firstLine(qpDay(line).title, 80) || line).replace(/(^|\s)(긴급|급함|!+)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').replace(/[.!?。\s]+$/, '').trim() || line;
  if (kind === 'issue') return { title: title, description: body.slice(0, 2000), urgency: urgent ? 'urgent' : 'normal', dueDate: q.due || '' };
  if (kind === 'as') return { customerName: '', siteLine: '', equipmentModel: '', serialNo: ((/\b(?:S\/?N|시리얼)[:\s-]*([A-Za-z0-9-]{3,})/i.exec(body) || [])[1] || ''), issueSummary: title, reproduction: '', priority: urgent ? 'P1' : 'P3' };
  if (kind === 'event') return { title: title, startDate: q.due || kstToday(), startTime: q.time || '', endTime: q.timeEnd || '', location: '' };
  return { title: title, dueDate: q.due || '', dueTime: q.time || '', priority: urgent ? 1 : (q.priority || 3) };
}
router.post('/messages/:mid/draft', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM chat_messages WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [+req.params.mid, req.tenant.id]);
    var m = r.rows[0]; if (!m) return res.status(404).json({ error: 'NOT_FOUND', message: '메시지가 없습니다.' });
    var room = await roomFor(req, res, m.room_id); if (!room) return;
    var b = req.body || {}, kind = DRAFT_KINDS[b.kind] ? b.kind : 'issue', body = String(m.body || '').slice(0, 3000);
    // 앞뒤 대화 몇 줄 — AI 가 고객사 · 장비 같은 걸 앞에서 찾을 수 있게
    var ctx = await db.query("SELECT COALESCE(u.display_name, u.name, 'AI') AS n, m.body FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.room_id = $1 AND m.id < $2 AND m.id > $2 - 400 AND m.deleted_at IS NULL AND m.kind IN ('text','ai') AND m.reply_to IS NOT DISTINCT FROM $3 ORDER BY m.id DESC LIMIT 6", [room.id, m.id, m.reply_to]);
    var pj = room.project_id ? (await db.query('SELECT name, order_no FROM projects WHERE id = $1 AND tenant_id = $2', [room.project_id, req.tenant.id])).rows[0] : null;
    var prompt = '사내 메신저 메시지를 업무 등록 양식으로 옮깁니다. 오늘은 ' + kstToday() + ' (한국 시간).\n' +
      (pj ? '이 방은 프로젝트 "' + pj.name + '"' + (pj.order_no ? ' (수주 ' + pj.order_no + ')' : '') + ' 의 방입니다.\n' : '') +
      '원문에 없는 것은 지어내지 말고 빈칸("")으로. JSON 하나만 답하세요:\n' + DRAFT_KINDS[kind].ask + '\n\n' +
      (ctx.rows.length ? '## 앞 대화 (참고)\n' + ctx.rows.reverse().map(function (x) { return x.n + ': ' + String(x.body || '').slice(0, 300); }).join('\n') + '\n\n' : '') +
      '## 옮길 메시지\n' + body;
    var rule = draftRule(kind, body), got = await aiAsk(req, prompt, 'draft-' + kind, b.ai), out = rule;
    if (got) {
      out = {};
      Object.keys(rule).forEach(function (k) { var v = got[k]; out[k] = v == null || v === '' ? rule[k] : typeof rule[k] === 'number' ? (+v || rule[k]) : String(v).slice(0, k === 'description' ? 2000 : 300); });
      ['dueDate', 'startDate'].forEach(function (k) { if (out[k] && !/^\d{4}-\d{2}-\d{2}$/.test(out[k])) out[k] = rule[k]; });
      if (out.priority != null && kind === 'as' && !/^P[1-4]$/.test(out.priority)) out.priority = rule.priority;
      if (kind === 'issue' && out.urgency !== 'urgent') out.urgency = 'normal';
      ['startTime', 'endTime', 'dueTime'].forEach(function (k) { if (out[k] && !/^\d{2}:\d{2}$/.test(out[k])) out[k] = rule[k] || ''; });
    }
    // 프로젝트 고르기 — 이 방 프로젝트 · 내가 고칠 수 있는 최근 프로젝트
    var ed = pa.editableProjectsSql ? pa.editableProjectsSql(req, 'p', 2) : null, projects = [];
    if (ed) projects = (await db.query("SELECT p.id, p.name, p.order_no FROM projects p WHERE p.tenant_id = $1 AND COALESCE(p.status, '') <> 'done' AND " + ed.sql + ' ORDER BY p.updated_at DESC NULLS LAST LIMIT 40', [req.tenant.id].concat(ed.params))).rows;
    var pid0 = room.project_id || null;
    if (!pid0) { try { var u0 = await peekUnfurl(req, [{ k: 'm', t: body }]); var p0 = (u0.m || []).filter(function (x) { return x.type === 'project'; })[0]; if (p0) pid0 = p0.id; } catch (_) {} }   // 글 속 프로젝트 이름 · 수주번호
    res.json({ data: { kind: kind, fields: out, ai: !!got, projectId: pid0, projects: projects.map(function (p) { return { id: p.id, name: p.name, orderNo: p.order_no || '' }; }) } });
  } catch (e) { httpErr.serverError(res, '[chat/draft]', e); }
});

/* ⑤ 이 방 최근 대화 → 요점 · 정한 것 · 할 일(누가 · 무엇 · 언제) · 남은 질문 */
function digestRule(rows, names) {
  var out = { points: [], decisions: [], todos: [], questions: [] };
  rows.forEach(function (x) {
    var b = String(x.body || '').trim(); if (!b || b[0] === '/') return;
    b.split('\n').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (s) {
      if (/(하기로|으로 결정|로 결정|확정|정했|결정했|로 가죠|로 갑시다|진행하기로)/.test(s)) out.decisions.push(s.slice(0, 160));
      else if (/[?？]\s*$/.test(s) && !/(해 ?주실 수|해 ?줄 수|가능할까요|부탁)/.test(s)) out.questions.push({ who: x.n, text: s.slice(0, 160) });
      if (/(할게요|하겠습니다|해 ?둘게요|해 ?드릴게요|챙길게요|보낼게요|올릴게요|부탁(드립니다|해요|합니다)?|해 ?주세요|해 ?주실 수|까지\s*(해|보내|올려|부탁|완료))/.test(s)) {
        var at = /@(\S+)/.exec(s), who = at && names.indexOf(at[1]) >= 0 ? at[1] : /(부탁|해 ?주세요|해 ?주실 수)/.test(s) ? '' : x.n;
        var q = qpDay(s.replace(/@\S+/g, ''));
        out.todos.push({ who: who, what: (q.title || s).replace(/^(제가|저는|내가|저희가)\s+/, '').replace(/\s*(할게요|하겠습니다|해 ?둘게요|해 ?드릴게요|부탁드립니다|부탁해요|부탁합니다)[.!]?$/, '').slice(0, 120), due: q.due || '' });
      }
    });
  });
  out.todos = out.todos.slice(0, 15); out.decisions = out.decisions.slice(0, 10); out.questions = out.questions.slice(-8);
  return out;
}
router.post('/rooms/:id/digest', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var b = req.body || {}, n = Math.min(Math.max(parseInt(b.n, 10) || 80, 10), 200);
    var hist = await db.query("SELECT COALESCE(u.display_name, u.name, 'AI') AS n, m.user_id, m.body, m.created_at FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.room_id = $1 AND m.deleted_at IS NULL AND m.reply_to IS NULL AND m.kind IN ('text','ai') AND m.body <> '' ORDER BY m.id DESC LIMIT $2", [room.id, n]);
    var rows = hist.rows.reverse().filter(function (x) { return !/^📋 대화 정리/.test(x.body || '') && !/^@\S+ 할 일 — /.test(x.body || ''); });   // 정리 · 확인 요청으로 올린 글은 다시 안 뽑음
    if (!rows.length) return res.json({ data: { points: [], decisions: [], todos: [], questions: [], ai: false, n: 0 } });
    var mem = (await db.query('SELECT u.id, COALESCE(u.display_name, u.name) AS n FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = $1 AND m.left_at IS NULL', [room.id])).rows;
    var names = mem.map(function (u) { return u.n; });
    var lines = rows.map(function (x) { return '[' + new Date(x.created_at).toISOString().slice(5, 16).replace('T', ' ') + '] ' + x.n + ': ' + String(x.body).slice(0, 400); }).join('\n');
    var prompt = '다음은 사내 메신저 대화입니다. 오늘은 ' + kstToday() + ' (한국 시간). 방 사람: ' + names.join(', ') + '\n' +
      '대화에 실제로 나온 것만 뽑으세요 (지어내지 말 것). JSON 하나만:\n' +
      '{"points":["요점 3개 이내"],"decisions":["정한 것"],"todos":[{"who":"맡은 사람 이름(방 사람 중, 모르면 빈칸)","what":"할 일","due":"YYYY-MM-DD 또는 빈칸"}],"questions":[{"who":"물은 사람","text":"아직 답이 없는 질문"}]}\n\n' + lines;
    var got = await aiAsk(req, prompt, 'digest', b.ai), out = digestRule(rows, names);
    if (got) {
      out = {
        points: (Array.isArray(got.points) ? got.points : []).map(String).slice(0, 5),
        decisions: (Array.isArray(got.decisions) ? got.decisions : []).map(String).slice(0, 10),
        todos: (Array.isArray(got.todos) ? got.todos : []).filter(function (x) { return x && x.what; }).map(function (x) { return { who: names.indexOf(String(x.who || '')) >= 0 ? String(x.who) : '', what: String(x.what).slice(0, 160), due: /^\d{4}-\d{2}-\d{2}$/.test(x.due || '') ? x.due : '' }; }).slice(0, 15),
        questions: (Array.isArray(got.questions) ? got.questions : []).map(function (x) { return typeof x === 'string' ? { who: '', text: x } : { who: String(x.who || ''), text: String(x.text || '') }; }).filter(function (x) { return x.text; }).slice(0, 8)
      };
    }
    out.ai = !!got; out.n = rows.length;
    out.members = mem.map(function (u) { return { id: u.id, name: u.n }; });
    out.projectId = room.project_id || null;
    res.json({ data: out });
  } catch (e) { httpErr.serverError(res, '[chat/digest]', e); }
});

/* ─── v13.422 업무 카드 지금 상태 · 글 속 번호 · 이름 자동 펼침 ───
 * POST /api/chat/peek { refs: [{type,id}], texts: [{k, t, skip:['type:id']}] }
 *   → { live: { 'type:id': {...} | null }, unf: { k: [card] } }
 * 보는 사람 권한으로만 — 프로젝트 계열은 lib/project-access, 이슈는 gateIssue, 할 일은 본인 것만, 수주 · A/S 는 테넌트 전체(목록 화면과 같음) */
var PEEK_TYPES = ['project', 'milestone', 'issue', 'order', 'as', 'todo'];
var PEEK_PH = { order: '수주', design: '설계', manufacture: '제작', inspect: '검수', deliver: '납품', done: '완료' };
var PEEK_PH_SEQ = ['order', 'design', 'manufacture', 'inspect', 'deliver', 'done'];
var PEEK_MS = { waiting: '대기', active: '진행', done: '완료' };
var PEEK_PJ = { active: '진행', hold: '보류', done: '완료' };
var PEEK_AS = { received: '접수', assigned: '배정', in_progress: '진행 중', reporting: '보고서', approved: '승인', customer_wait: '고객 대기', closed: '종결', hold: '보류', cancelled: '취소' };
var PEEK_IS = { open: '접수', inProgress: '대응중', resolved: '해결', closed: '종결' };
function peekDay(d) {
  if (!d) return null;
  if (d instanceof Date) { if (isNaN(d)) return null; return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var s = String(d).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function peekNames(v) {
  var a = v; if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { a = [a]; } }
  if (!Array.isArray(a)) return '';
  a = a.map(function (x) { return typeof x === 'string' ? x : (x && (x.name || x.email)) || ''; }).filter(Boolean);
  return a.slice(0, 2).join(', ') + (a.length > 2 ? ' 외 ' + (a.length - 2) : '');
}
async function peekRefs(req, refs) {
  var out = {}, by = {};
  (refs || []).slice(0, 60).forEach(function (r) {
    if (!r || PEEK_TYPES.indexOf(r.type) < 0 || r.id == null || r.id === '') return;
    var id = String(r.id).slice(0, 100); (by[r.type] = by[r.type] || []).push(id); out[r.type + ':' + id] = null;
  });
  var t = req.tenant.id, pa = require('../lib/project-access'), q;
  if (by.project) {
    var v = pa.visibleProjectsSql(req, 'p', 3);
    q = await db.query('SELECT p.id, p.name, p.order_no, p.status, p.current_phase, p.progress, p.end_date, p.assignees, p.owner_id FROM projects p WHERE p.tenant_id = $1 AND p.id::text = ANY($2) AND ' + v.sql, [t, by.project].concat(v.params));
    for (var i = 0; i < q.rows.length; i++) {
      var p = q.rows[i], ph = p.current_phase, k = PEEK_PH_SEQ.indexOf(ph), nx = p.status !== 'done' && k >= 0 && k < PEEK_PH_SEQ.length - 1 ? PEEK_PH_SEQ[k + 1] : null;
      out['project:' + p.id] = { title: p.name, sub: p.order_no || '', st: PEEK_PH[ph] || PEEK_PJ[p.status] || '', stc: p.status === 'done' ? 'done' : p.status === 'hold' ? 'hold' : 'active',
        pct: p.progress == null ? null : Math.round(+p.progress), due: peekDay(p.end_date), who: peekNames(p.assignees), next: nx, nextL: nx ? PEEK_PH[nx] : null, ed: await pa.canEdit(req, p), nav: { projectId: p.id } };
    }
  }
  if (by.milestone) {
    var v2 = pa.visibleProjectsSql(req, 'p', 3);
    q = await db.query('SELECT m.id, m.name, m.status, m.progress, m.end_date, m.project_id, p.name AS pn, p.owner_id FROM milestones m JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id WHERE m.tenant_id = $1 AND m.id::text = ANY($2) AND ' + v2.sql, [t, by.milestone].concat(v2.params));
    for (var j = 0; j < q.rows.length; j++) {
      var m = q.rows[j];
      out['milestone:' + m.id] = { title: m.name, sub: m.pn || '', st: PEEK_MS[m.status] || m.status || '', stc: m.status, pct: m.progress == null ? null : Math.round(+m.progress), due: peekDay(m.end_date),
        ed: await pa.canEdit(req, { id: m.project_id, owner_id: m.owner_id }), nav: { projectId: m.project_id, tab: 'work' } };
    }
  }
  if (by.issue) {
    var acts = require('../telegram/actions');
    for (var x = 0; x < by.issue.length && x < 15; x++) {
      var row = await acts.gateIssue(actor(req), by.issue[x], 'read');
      if (row) out['issue:' + row.id] = { title: row.title, st: PEEK_IS[row.status] || row.status, stc: row.status, urg: row.urgency === 'urgent', who: peekNames(row.assignees), nav: { issueId: row.id } };
    }
  }
  if (by.order) {
    q = await db.query('SELECT order_no, name, client, manager, date FROM orders WHERE tenant_id = $1 AND order_no = ANY($2)', [t, by.order]);
    q.rows.forEach(function (o) { out['order:' + o.order_no] = { title: o.name || o.order_no, sub: [o.order_no, o.client].filter(Boolean).join(' · '), st: '수주', stc: 'order', who: o.manager || '', nav: { orderNo: o.order_no } }; });
  }
  if (by.as) {
    q = await db.query("SELECT a.id, a.ticket_no, a.issue_summary, a.customer_name, a.status, a.priority, a.promised_visit_at, " +
      "(SELECT string_agg(COALESCE(u.display_name, u.name), ', ') FROM as_assignments g JOIN users u ON u.id = g.assignee_id WHERE g.ticket_id = a.id AND g.tenant_id = a.tenant_id AND g.status NOT IN ('completed','cancelled')) AS who " +
      'FROM as_tickets a WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND (a.id::text = ANY($2) OR a.ticket_no = ANY($2))', [t, by.as]);
    q.rows.forEach(function (a) {
      var info = { title: a.issue_summary || a.ticket_no, sub: [a.ticket_no, a.customer_name].filter(Boolean).join(' · '), st: PEEK_AS[a.status] || a.status, stc: a.status, urg: a.priority === 'P1' || a.priority === 'urgent', who: a.who || '', due: peekDay(a.promised_visit_at), id: a.id, ed: true, nav: { asId: a.id } };
      out['as:' + a.id] = info; if (by.as.indexOf(a.ticket_no) >= 0) out['as:' + a.ticket_no] = info;
    });
  }
  if (by.todo) {
    q = await db.query('SELECT id, title, due_date, done_at, priority FROM my_todos WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL AND id::text = ANY($3)', [t, me(req), by.todo]);
    q.rows.forEach(function (d) { out['todo:' + d.id] = { title: d.title, st: d.done_at ? '완료' : '할 일', stc: d.done_at ? 'done' : 'open', due: peekDay(d.due_date), mine: true, ed: true, nav: { todoId: d.id } }; });
  }
  return out;
}
/* 글 속 A/S 번호 · 수주번호 · 프로젝트 이름 → 카드 (메시지마다 3개까지) */
var UNF_AS = /\bAS-\d{4}-\d{2}-\d{3,}\b/g, UNF_NO = /\b[A-Za-z]{1,5}-?\d{3,}(?:-\d{1,6}){0,2}\b/g;
async function peekUnfurl(req, texts) {
  var items = (texts || []).slice(0, 40).filter(function (x) { return x && x.k != null && typeof x.t === 'string' && x.t.trim(); })
    .map(function (x) { return { k: String(x.k).slice(0, 40), t: x.t.slice(0, 2000), skip: Array.isArray(x.skip) ? x.skip.map(String) : [] }; });
  var res = {}, asNos = [], nos = [];
  if (!items.length) return res;
  items.forEach(function (it) {
    res[it.k] = [];
    it.as = (it.t.match(UNF_AS) || []).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 3);
    it.no = (it.t.replace(UNF_AS, ' ').match(UNF_NO) || []).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 4);
    asNos = asNos.concat(it.as); nos = nos.concat(it.no);
  });
  var t = req.tenant.id, pa = require('../lib/project-access');
  var asMap = {}, pjByNo = {}, ordMap = {}, q;
  if (asNos.length) {
    q = await db.query('SELECT id, ticket_no, issue_summary, customer_name FROM as_tickets WHERE tenant_id = $1 AND deleted_at IS NULL AND ticket_no = ANY($2)', [t, asNos]);
    q.rows.forEach(function (a) { asMap[a.ticket_no] = { type: 'as', id: String(a.id), title: a.issue_summary || a.ticket_no, sub: [a.ticket_no, a.customer_name].filter(Boolean).join(' · '), nav: { asId: a.id } }; });
  }
  if (nos.length) {
    var v = pa.visibleProjectsSql(req, 'p', 3);
    q = await db.query('SELECT p.id, p.name, p.order_no FROM projects p WHERE p.tenant_id = $1 AND p.order_no = ANY($2) AND ' + v.sql + ' ORDER BY p.updated_at DESC NULLS LAST', [t, nos].concat(v.params));
    q.rows.forEach(function (p) { if (!pjByNo[p.order_no]) pjByNo[p.order_no] = { type: 'project', id: String(p.id), title: p.name, sub: p.order_no, nav: { projectId: p.id } }; });
    var rest = nos.filter(function (n) { return !pjByNo[n]; });
    if (rest.length) {
      q = await db.query('SELECT order_no, name, client FROM orders WHERE tenant_id = $1 AND order_no = ANY($2)', [t, rest]);
      q.rows.forEach(function (o) { ordMap[o.order_no] = { type: 'order', id: o.order_no, title: o.name || o.order_no, sub: [o.order_no, o.client].filter(Boolean).join(' · '), nav: { orderNo: o.order_no } }; });
    }
  }
  // 프로젝트 이름 — 4글자 이상 이름이 글에 그대로 들어 있으면 (긴 이름부터)
  var v3 = pa.visibleProjectsSql(req, 'p', 4);
  q = await db.query('SELECT x.k, p.id, p.name, p.order_no FROM unnest($2::text[], $3::text[]) AS x(k, txt) JOIN projects p ON p.tenant_id = $1 AND length(p.name) >= 4 AND strpos(lower(x.txt), lower(p.name)) > 0 AND ' + v3.sql +
    ' ORDER BY length(p.name) DESC', [t, items.map(function (i) { return i.k; }), items.map(function (i) { return i.t; })].concat(v3.params));
  var byName = {};
  q.rows.forEach(function (r) { (byName[r.k] = byName[r.k] || []).push({ type: 'project', id: String(r.id), title: r.name, sub: r.order_no || '', nav: { projectId: r.id } }); });
  items.forEach(function (it) {
    var list = [], seen = it.skip.slice();
    function add(c) { if (!c || list.length >= 3) return; var key = c.type + ':' + c.id; if (seen.indexOf(key) >= 0) return; seen.push(key); list.push(c); }
    it.as.forEach(function (n) { add(asMap[n]); });
    it.no.forEach(function (n) { add(pjByNo[n] || ordMap[n]); });
    (byName[it.k] || []).forEach(function (c) { if (!list.some(function (l) { return l.type === 'project' && l.title.indexOf(c.title) >= 0; })) add(c); });
    res[it.k] = list;
  });
  return res;
}
router.post('/peek', async function (req, res) {
  try {
    var b = req.body || {};
    var unf = await peekUnfurl(req, b.texts);
    var refs = (Array.isArray(b.refs) ? b.refs : []).slice(0, 60);
    Object.keys(unf).forEach(function (k) { unf[k].forEach(function (c) { refs.push({ type: c.type, id: c.id }); }); });
    res.json({ data: { live: await peekRefs(req, refs), unf: unf } });
  } catch (e) { httpErr.serverError(res, '[chat/peek]', e); }
});
/* 카드에서 처리한 뒤(실제 바꾸기는 각 화면과 같은 API · 같은 권한) — 지금 상태를 다시 읽어 카드에 반영하고 방에 한 줄 남김 */
var PEEK_ICON = { project: '📁', milestone: '🚩', issue: '🐞', order: '📦', as: '🔧', todo: '✅' };
router.post('/messages/:mid/acted', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM chat_messages WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [+req.params.mid, req.tenant.id]);
    var m = r.rows[0]; if (!m) return res.status(404).json({ error: 'NOT_FOUND', message: '메시지가 없습니다.' });
    var room = await roomFor(req, res, m.room_id); if (!room) return;
    var b = req.body || {};
    if (PEEK_TYPES.indexOf(b.type) < 0 || b.id == null) return bad(res, '처리할 수 있는 카드가 아닙니다.');
    var key = b.type + ':' + String(b.id).slice(0, 100), live = (await peekRefs(req, [{ type: b.type, id: b.id }]))[key];
    if (!live) return res.status(404).json({ error: 'NOT_FOUND', message: '볼 수 없는 항목입니다.' });
    var cards = m.cards || [], ci = b.card == null ? -1 : +b.card, card = cards[ci];
    if (card && card.type === b.type && String(card.id) === String(b.id)) {
      card.title = live.title || card.title;
      if (b.type === 'issue') { card.status = live.stc; card.urgency = live.urg ? 'urgent' : card.urgency; }
      await db.query('UPDATE chat_messages SET cards = $2 WHERE id = $1', [m.id, JSON.stringify(cards)]);
      hub.publish(await memberIds(room.id), 'upd', await loadMsg(m.id));
    }
    var what = String(b.what || '').replace(/[<>]/g, '').slice(0, 40);
    if (live.nav && live.nav.projectId) try { require('../services/notification/change-feed').quietChat(req.tenant.id, live.nav.projectId, me(req)); } catch (_) {}   // 방에 이미 한 줄 — 프로젝트 방 소식 겹치지 않게
    await postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: (req.user.name || '') + ' 님이 ' + (PEEK_ICON[b.type] || '') + ' "' + String(live.title || '').slice(0, 60) + '" — ' + (what || live.st || '처리'),
      cards: [{ type: b.type, id: String(b.id).slice(0, 100), title: String(live.title || '').slice(0, 200), sub: '' }], replyTo: m.reply_to || null });
    res.json({ data: { live: live } });
  } catch (e) { httpErr.serverError(res, '[chat/acted]', e); }
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
/* ─── 🗳 투표 · 📅 약속 잡기 (v13.381) ───
 *   poll = { q, kind:'vote'|'time', multi, opts:[{id, t, at?(YYYY-MM-DD), from?, to?, busy?}], votes:{optId:[uid]}, until?, closed?, pick? }
 *   약속 잡기(time): 후보 시간마다 그때 일정(회의 · 출장 · 연차 …)이 있는 방 사람 수를 붙여 줌 · 정하면 달력 일정으로 */
function pollId() { return 'o' + crypto.randomBytes(4).toString('hex'); }
async function busyFor(tenantId, roomId, opt) {
  var ms = await db.query('SELECT u.id, u.name, u.display_name FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = $1 AND m.left_at IS NULL', [roomId]);
  var ev = await db.query("SELECT type, start_time, end_time, assignees FROM events WHERE tenant_id = $1 AND start_date <= $2 AND COALESCE(NULLIF(end_date, ''), start_date) >= $2", [tenantId, opt.at]).catch(function () { return { rows: [] }; });
  var busy = [];
  ms.rows.forEach(function (u) {
    var names = [u.name, u.display_name].filter(Boolean);
    var hit = ev.rows.some(function (e) {
      var as = Array.isArray(e.assignees) ? e.assignees : [];
      if (!as.some(function (a) { return names.indexOf(String(a && a.name || a).trim()) >= 0 || a === u.id; })) return false;
      if (!e.start_time || !e.end_time || !opt.from) return true;   // 하루 종일 · 시각 없는 일정은 그날 내내
      return e.start_time < (opt.to || '23:59') && e.end_time > opt.from;
    });
    if (hit) busy.push(u.display_name || u.name);
  });
  return busy;
}
router.post('/rooms/:id/polls', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (readOnly(res, room)) return;
    var b = req.body || {}, q = String(b.q || '').trim().slice(0, 200), kind = b.kind === 'time' ? 'time' : 'vote';
    var opts = (Array.isArray(b.opts) ? b.opts : []).slice(0, 12).map(function (o) {
      if (kind === 'time') {
        var at = /^\d{4}-\d{2}-\d{2}$/.test(o.at || '') ? o.at : null, from = /^\d{2}:\d{2}$/.test(o.from || '') ? o.from : null, to = /^\d{2}:\d{2}$/.test(o.to || '') ? o.to : null;
        if (!at) return null;
        return { id: pollId(), at: at, from: from, to: to && from && to > from ? to : null, t: at + (from ? ' ' + from + (to && to > from ? '~' + to : '') : '') };
      }
      var t = String(o && o.t != null ? o.t : o || '').trim().slice(0, 100); return t ? { id: pollId(), t: t } : null;
    }).filter(Boolean);
    if (!q) return bad(res, '물을 내용을 적으세요.');
    if (opts.length < 2) return bad(res, kind === 'time' ? '후보 시간을 두 개 이상 넣으세요.' : '고를 것을 두 개 이상 넣으세요.');
    if (kind === 'time') for (var i = 0; i < opts.length; i++) opts[i].busy = await busyFor(req.tenant.id, room.id, opts[i]);
    var until = b.until ? new Date(b.until) : null; if (until && isNaN(until)) until = null;
    var poll = { q: q, kind: kind, multi: !!b.multi || kind === 'time', opts: opts, votes: {}, until: until ? until.toISOString() : null, closed: false, by: me(req) };
    var msg = await postMessage({ tenantId: req.tenant.id }, room, { userId: me(req), kind: 'text', body: (kind === 'time' ? '📅 약속 잡기: ' : '🗳 투표: ') + q, poll: poll });
    res.status(201).json({ data: msg });
  } catch (e) { httpErr.serverError(res, '[chat/poll]', e); }
});
async function pollMsg(req, res) {
  var r = await db.query('SELECT id, room_id, user_id, poll, deleted_at FROM chat_messages WHERE id = $1 AND tenant_id = $2', [+req.params.mid, req.tenant.id]);
  var m = r.rows[0];
  if (!m || !m.poll || m.deleted_at) { res.status(404).json({ error: 'NOT_FOUND', message: '투표가 없습니다.' }); return null; }
  var room = await roomFor(req, res, m.room_id); if (!room) return null;
  m._room = room; return m;
}
router.post('/messages/:mid/vote', async function (req, res) {
  try {
    var m = await pollMsg(req, res); if (!m) return;
    if (readOnly(res, m._room)) return;
    var pick = (Array.isArray((req.body || {}).opts) ? req.body.opts : []).map(String);
    var out = await db.transaction(async function (cl) {
      var p = (await cl.query('SELECT poll FROM chat_messages WHERE id = $1 FOR UPDATE', [m.id])).rows[0].poll;
      if (p.closed || (p.until && new Date(p.until) < new Date())) throw Object.assign(new Error('마감된 투표입니다.'), { status: 400 });
      var ids = p.opts.map(function (o) { return o.id; }); pick = pick.filter(function (x) { return ids.indexOf(x) >= 0; });
      if (!p.multi) pick = pick.slice(0, 1);
      var uid = me(req); p.votes = p.votes || {};
      ids.forEach(function (id) { var l = (p.votes[id] || []).filter(function (u) { return u !== uid; }); if (pick.indexOf(id) >= 0) l.push(uid); p.votes[id] = l; });
      await cl.query('UPDATE chat_messages SET poll = $2 WHERE id = $1', [m.id, JSON.stringify(p)]);
      return p;
    });
    var msg = await loadMsg(m.id); hub.publish(await memberIds(m.room_id), 'upd', msg);
    res.json({ data: msg });
  } catch (e) { if (e && e.status === 400) return bad(res, e.message); httpErr.serverError(res, '[chat/vote]', e); }
});
/* 마감 — 만든 사람 · 방장. 약속 잡기는 고른 시간을 달력 일정으로 (참여 = 그 시간에 표 준 사람) */
router.post('/messages/:mid/poll-close', async function (req, res) {
  try {
    var m = await pollMsg(req, res); if (!m) return;
    if (m.poll.by !== me(req) && !(await canManage(req, m._room))) return res.status(403).json({ error: 'FORBIDDEN', message: '만든 사람만 마감할 수 있습니다.' });
    var p = m.poll, b = req.body || {}, ev = null;
    p.closed = true;
    if (p.kind === 'time' && b.pick) {
      var o = p.opts.filter(function (x) { return x.id === b.pick; })[0];
      if (!o) return bad(res, '고른 시간이 없습니다.');
      p.pick = o.id;
      if (b.toCalendar !== false) {
        var voters = (p.votes[o.id] || []).concat([me(req)]).filter(function (u, i, a) { return a.indexOf(u) === i; });
        var nm = await userNames(req.tenant.id, voters);
        var id = 'evt-' + crypto.randomUUID().slice(0, 12);
        var er = await db.query("INSERT INTO events (id, title, type, start_date, end_date, project_ids, assignees, memo, created_by, tenant_id, start_time, end_time) VALUES ($1,$2,'meeting',$3,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
          [id, p.q.slice(0, 255), o.at, JSON.stringify(m._room.project_id ? [m._room.project_id] : []), JSON.stringify(voters.map(function (u) { return nm[u]; }).filter(Boolean)), '💬 메신저 약속 잡기에서', me(req), req.tenant.id, o.from || null, o.to || null]);
        ev = er.rows[0].id; p.eventId = ev;
      }
    }
    await db.query('UPDATE chat_messages SET poll = $2 WHERE id = $1', [m.id, JSON.stringify(p)]);
    var msg = await loadMsg(m.id); hub.publish(await memberIds(m.room_id), 'upd', msg);
    if (p.pick) { var po = p.opts.filter(function (x) { return x.id === p.pick; })[0]; await postMessage({ tenantId: req.tenant.id }, m._room, { kind: 'system', body: '📅 약속이 정해졌습니다 — ' + p.q + ' · ' + po.t + (ev ? ' (달력에 넣음)' : '') }); }
    res.json({ data: msg, eventId: ev });
  } catch (e) { httpErr.serverError(res, '[chat/poll-close]', e); }
});
/* ─── ✔ 확인 요청 (v13.381) — 받은 사람마다 "확인했어요" ─── */
router.post('/messages/:mid/ack', async function (req, res) {
  try {
    var r = await db.query('SELECT id, room_id, ack, deleted_at FROM chat_messages WHERE id = $1 AND tenant_id = $2', [+req.params.mid, req.tenant.id]);
    var m = r.rows[0];
    if (!m || !m.ack || m.deleted_at) return res.status(404).json({ error: 'NOT_FOUND', message: '확인 요청이 없습니다.' });
    if (!await roomFor(req, res, m.room_id)) return;
    await db.query("UPDATE chat_messages SET ack = jsonb_set(COALESCE(ack, '{}'::jsonb), ARRAY['by', $2::text], to_jsonb(now()::text), true) WHERE id = $1", [m.id, me(req)]);
    var msg = await loadMsg(m.id); hub.publish(await memberIds(m.room_id), 'upd', msg);
    res.json({ data: msg });
  } catch (e) { httpErr.serverError(res, '[chat/ack]', e); }
});
/** 아침 9시 — 어제까지 확인 요청 중 안 누른 사람에게 한 번 (chat-timers 가 시간마다 부름) */
async function ackNudge() {
  var kh = new Date(Date.now() + 9 * 36e5).getUTCHours(); if (kh !== 9 && process.env.NODE_ENV !== 'test') return 0;
  var r = await db.query("SELECT m.id, m.room_id, m.tenant_id, m.user_id, m.body, m.ack, COALESCE(rr.name, '') AS room_name FROM chat_messages m JOIN chat_rooms rr ON rr.id = m.room_id " +
    "WHERE m.ack IS NOT NULL AND (m.ack->>'nudged') IS NULL AND m.deleted_at IS NULL AND m.created_at < now() - interval '12 hours' AND m.created_at > now() - interval '7 days' LIMIT 100");
  var n = 0;
  for (var i = 0; i < r.rows.length; i++) {
    var m = r.rows[i], by = (m.ack && m.ack.by) || {};
    var u = await db.query("UPDATE chat_messages SET ack = jsonb_set(ack, '{nudged}', to_jsonb(now()::text)) WHERE id = $1 AND (ack->>'nudged') IS NULL RETURNING id", [m.id]);
    if (!u.rows.length) continue;
    var miss = (await memberIds(m.room_id)).filter(function (x) { return x !== m.user_id && !by[x]; });
    if (!miss.length) continue;
    var fn = (await userNames(m.tenant_id, [m.user_id]))[m.user_id] || '';
    await require('../services/notification.service').notify('chat_remind', { roomId: m.room_id, roomName: m.room_name, note: '✔ 확인 요청 — 아직 확인 안 함', fromName: fn, body: m.body }, miss).catch(function () {});
    n++;
  }
  return n;
}
router._ackNudge = ackNudge;
/* ─── 📤 대화 내보내기 (v13.381) — 기간 · 텍스트 (답글 줄기 · 파일 이름 · 투표 · 게시판 글 포함) ─── */
router.get('/rooms/:id/export', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    var from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null, to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
    var prm = [room.id], w = ['m.room_id = $1', 'm.deleted_at IS NULL'];
    if (from) { prm.push(from); w.push("m.created_at >= ($" + prm.length + "::date - interval '9 hours')"); }
    if (to) { prm.push(to); w.push("m.created_at < ($" + prm.length + "::date + interval '15 hours')"); }
    var r = await db.query(MSG_SQL + 'WHERE ' + w.join(' AND ') + ' ORDER BY m.id LIMIT 20000', prm);
    var rows = r.rows.map(shape), info = await db.query("SELECT COALESCE(r.name, p.name) AS name FROM chat_rooms r LEFT JOIN projects p ON p.id = r.project_id WHERE r.id = $1", [room.id]);
    function kst(d) { var x = new Date(new Date(d).getTime() + 9 * 36e5).toISOString(); return x.slice(0, 10) + ' ' + x.slice(11, 16); }
    var lines = ['💬 ' + ((info.rows[0] && info.rows[0].name) || '대화방') + ' — 대화 내보내기', '기간: ' + (from || '처음') + ' ~ ' + (to || '지금') + ' · ' + rows.length + '개 · 내보낸 사람 ' + (req.user.name || '') + ' · ' + kst(new Date()), ''];
    var day = '';
    rows.forEach(function (m) {
      var d = kst(m.at); if (d.slice(0, 10) !== day) { day = d.slice(0, 10); lines.push('', '──── ' + day + ' ────'); }
      var who = m.kind === 'system' ? '·' : (m.userName || 'AI');
      var body = m.post ? '[📌 ' + m.post.title + '] ' + (m.body || '') : m.body || '';
      if (m.file) body += (body ? ' ' : '') + '[📎 ' + m.file.name + (m.file.transcript ? ' — "' + m.file.transcript + '"' : '') + ']';
      if (m.poll) body += ' [' + m.poll.opts.map(function (o) { return o.t + ' ' + ((m.poll.votes || {})[o.id] || []).length + '표'; }).join(' · ') + ']';
      if (m.quote) body = '↩ ' + (m.quote.userName || '') + ': "' + String(m.quote.body || '').slice(0, 40) + '" ' + body;
      lines.push(d.slice(11) + ' ' + (m.replyTo ? '  └ ' : '') + who + ': ' + body.replace(/\n/g, '\n      '));
    });
    var name = ((info.rows[0] && info.rows[0].name) || 'chat').replace(/[\\/:*?"<>|]/g, '_') + '_' + (from || 'all') + '.txt';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
    res.end('\ufeff' + lines.join('\r\n'));
  } catch (e) { httpErr.serverError(res, '[chat/export]', e); }
});

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
      'WHERE m.tenant_id = $2 AND m.deleted_at IS NULL AND (cm.hist_from IS NULL OR m.id > cm.hist_from) AND (m.body ILIKE $3 OR f.name ILIKE $3 OR f.transcript ILIKE $3)' + ex + ' ORDER BY m.id DESC LIMIT 60', prm);
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

/* ─── v13.424 ⑦ 프로젝트 방 자동 소식 · ⑧ ☀️ 아침 브리핑 · ⑩ /meet 빈 시간 ─── */
/** 프로젝트 방이 있으면 한 줄(시스템) — 없으면 만들지 않음. cards 는 show:true 로 줄 아래에 보임 */
async function projectNote(tenantId, projectId, body, cards) {
  try {
    if (!projectId) return null;
    var r = await db.query("SELECT * FROM chat_rooms WHERE tenant_id = $1 AND project_id = $2 AND kind = 'project' LIMIT 1", [tenantId, projectId]);
    if (!r.rows.length) return null;
    return await postMessage({ tenantId: tenantId }, r.rows[0], { kind: 'system', body: String(body).slice(0, 1500), cards: cards && cards.length ? cards.map(function (c) { return Object.assign({ show: true }, c); }) : null });
  } catch (e) { console.error('[chat/projectNote]', e.message); return null; }
}
/** 나와의 채팅 방 (없으면 만듦) */
async function selfRoom(tenantId, uid) {
  var sk = 'self:' + uid;
  var ex = (await db.query('SELECT * FROM chat_rooms WHERE tenant_id = $1 AND dm_key = $2', [tenantId, sk])).rows[0];
  if (!ex) {
    await db.query("INSERT INTO chat_rooms (id, tenant_id, kind, name, dm_key, created_by) VALUES ($1,$2,'group','나와의 채팅',$3,$4) ON CONFLICT DO NOTHING", [rid('grp'), tenantId, sk, uid]);
    ex = (await db.query('SELECT * FROM chat_rooms WHERE tenant_id = $1 AND dm_key = $2', [tenantId, sk])).rows[0];
  }
  await db.query("INSERT INTO chat_members (room_id, user_id, tenant_id, role, pinned) VALUES ($1,$2,$3,'owner',TRUE) ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL", [ex.id, uid, tenantId]); _midDrop(ex.id);
  return ex;
}
/** 하루 한 번 표시 — 처음이면 true (서버 여러 대 · 재시작에도 한 번) */
async function dailyOnce(k) {
  var r = await db.query('INSERT INTO chat_daily (k) VALUES ($1) ON CONFLICT DO NOTHING RETURNING k', [String(k).slice(0, 160)]);
  return r.rows.length > 0;
}
/* ⑧ 아침 브리핑 — 오늘 할 일 · 오늘 일정 · 늦은 이슈 · 내 A/S · 이번 주 마감 마일스톤 → 나와의 채팅 */
async function briefFor(tenantId, uid) {
  var today = kstToday(), u = (await db.query("SELECT id, name, display_name, role, department_id FROM users WHERE id = $1 AND tenant_id = $2 AND COALESCE(status, 'active') = 'active'", [uid, tenantId])).rows[0];
  if (!u) return null;
  var names = [u.name, u.display_name].filter(Boolean), cards = [], L = [], wk = new Date(Date.now() + 9 * 36e5 + 6 * 864e5).toISOString().slice(0, 10);
  var req = { user: { sub: uid, role: u.role, departmentId: u.department_id }, tenant: { id: tenantId } };
  var td = (await db.query("SELECT id, title, due_date, due_time FROM my_todos WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL AND done_at IS NULL AND due_date IS NOT NULL AND due_date <> '' AND left(due_date::text, 10) <= $3 ORDER BY due_date, due_time NULLS LAST LIMIT 8", [tenantId, uid, today])).rows;
  var ev = (await db.query("SELECT id, title, start_time, location FROM events WHERE tenant_id = $1 AND start_date <= $2 AND COALESCE(NULLIF(end_date, ''), start_date) >= $2 AND (created_by = $3 OR assignees ?| $4::text[] OR assignees @> to_jsonb(ARRAY[$3::text])) ORDER BY start_time NULLS FIRST LIMIT 8", [tenantId, today, uid, names]).catch(function () { return { rows: [] }; })).rows;
  var sub = pa.accessibleProjectsSubquery(req, 3);
  var is = (await db.query("SELECT id, title, status, urgency, due_date FROM issues WHERE tenant_id = $1 AND status IN ('open','inProgress') AND (assignees ?| $2::text[]) AND (project_id IS NULL OR project_id IN (" + sub.sql + ')) ORDER BY (urgency = \'urgent\') DESC, due_date NULLS LAST LIMIT 6', [tenantId, names].concat(sub.params)).catch(function () { return { rows: [] }; })).rows;
  var as = (await db.query("SELECT DISTINCT a.id, a.ticket_no, a.issue_summary, a.customer_name, a.status, a.priority FROM as_tickets a JOIN as_assignments g ON g.ticket_id = a.id AND g.tenant_id = a.tenant_id WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND g.assignee_id = $2 AND g.status NOT IN ('completed','cancelled') AND a.status NOT IN ('closed','cancelled') LIMIT 6", [tenantId, uid]).catch(function () { return { rows: [] }; })).rows;
  var ed = pa.editableProjectsSql(req, 'p', 4);
  var ms = (await db.query("SELECT m.id, m.name, m.end_date, p.name AS pn FROM milestones m JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id WHERE m.tenant_id = $1 AND COALESCE(m.status, '') <> 'done' AND m.end_date IS NOT NULL AND left(m.end_date::text, 10) BETWEEN $2 AND $3 AND COALESCE(p.status, '') <> 'done' AND " + ed.sql + ' ORDER BY m.end_date LIMIT 6', [tenantId, today, wk].concat(ed.params)).catch(function () { return { rows: [] }; })).rows;
  var late = td.filter(function (x) { return String(x.due_date).slice(0, 10) < today; }).length;
  L.push('☀️ ' + (u.display_name || u.name) + ' 님, 좋은 아침이에요 — ' + today.slice(5).replace('-', '/') + ' 오늘 챙길 것');
  L.push('', '✅ 할 일 ' + td.length + (late ? ' (지난 것 ' + late + ')' : '') + ' · 📅 일정 ' + ev.length + ' · 🐞 내 이슈 ' + is.length + ' · 🔧 내 A/S ' + as.length + ' · 🚩 이번 주 마감 ' + ms.length);
  if (ev.length) { L.push('', '📅 오늘 일정'); ev.forEach(function (e) { L.push('· ' + (e.start_time ? String(e.start_time).slice(0, 5) + ' ' : '') + e.title + (e.location ? ' — ' + e.location : '')); }); }
  if (ms.length) { L.push('', '🚩 이번 주 마감'); ms.forEach(function (m) { L.push('· ' + String(m.end_date).slice(5, 10).replace('-', '/') + ' ' + m.name + ' (' + m.pn + ')'); }); }
  if (!td.length && !ev.length && !is.length && !as.length && !ms.length) L.push('', '오늘은 급한 게 없어요 — 좋은 하루 보내세요 🙂');
  td.slice(0, 4).forEach(function (x) { cards.push({ type: 'todo', id: x.id, title: x.title, sub: String(x.due_date).slice(0, 10) + (x.due_time ? ' ' + x.due_time : ''), nav: { todoId: x.id } }); });
  is.slice(0, 3).forEach(function (x) { cards.push({ type: 'issue', id: x.id, title: x.title, sub: x.urgency === 'urgent' ? '긴급' : '', status: x.status, urgency: x.urgency, nav: { issueId: x.id } }); });
  as.slice(0, 3).forEach(function (x) { cards.push({ type: 'as', id: String(x.id), title: x.issue_summary || x.ticket_no, sub: [x.ticket_no, x.customer_name].filter(Boolean).join(' · '), nav: { asId: x.id } }); });
  var room = await selfRoom(tenantId, uid);
  return postMessage({ tenantId: tenantId }, room, { kind: 'ai', body: L.join('\n'), cards: cards.length ? cards : null });
}
/* ⑦ 내일 마감 마일스톤 → 그 프로젝트 방 */
async function msDueNotes() {
  var tmr = new Date(Date.now() + 9 * 36e5 + 864e5).toISOString().slice(0, 10), n = 0;
  var r = await db.query("SELECT m.id, m.name, m.progress, m.tenant_id, m.project_id FROM milestones m JOIN chat_rooms cr ON cr.project_id = m.project_id AND cr.tenant_id = m.tenant_id AND cr.kind = 'project' WHERE COALESCE(m.status, '') <> 'done' AND left(m.end_date::text, 10) = $1 LIMIT 300", [tmr]).catch(function () { return { rows: [] }; });
  for (var i = 0; i < r.rows.length; i++) {
    var m = r.rows[i];
    if (!await dailyOnce('msdue:' + m.id + ':' + tmr)) continue;
    await projectNote(m.tenant_id, m.project_id, '🚩 내일 마감 — "' + m.name + '"' + (m.progress != null ? ' · 진행 ' + Math.round(m.progress) + '%' : ''), [{ type: 'milestone', id: String(m.id), title: m.name, sub: '내일 마감', nav: { projectId: m.project_id, tab: 'work' } }]);
    n++;
  }
  return n;
}
/** 한 시간마다(chat-timers) — 평일 아침 8시대에만. force 면 지금 (관리자 · 시험) */
async function dailyRun(force) {
  var k = new Date(Date.now() + 9 * 36e5), h = k.getUTCHours(), dow = k.getUTCDay(), today = k.toISOString().slice(0, 10);
  if (!force && (h !== 8 || dow === 0 || dow === 6)) return { skipped: true };
  var out = { brief: 0, msdue: 0 };
  var us = await db.query('SELECT user_id, tenant_id FROM chat_user_state WHERE brief_on = TRUE LIMIT 2000').catch(function () { return { rows: [] }; });
  for (var i = 0; i < us.rows.length; i++) {
    var x = us.rows[i];
    try { if (await dailyOnce('brief:' + x.user_id + ':' + today)) { await briefFor(x.tenant_id, x.user_id); out.brief++; } } catch (e) { console.error('[chat/brief]', e.message); }
  }
  out.msdue = await msDueNotes();
  return out;
}
router._dailyRun = dailyRun;
router.get('/brief', async function (req, res) {
  try { var r = await db.query('SELECT brief_on FROM chat_user_state WHERE user_id = $1', [me(req)]); res.json({ data: { on: !!(r.rows[0] && r.rows[0].brief_on) } }); }
  catch (e) { httpErr.serverError(res, '[chat/brief]', e); }
});
router.put('/brief', async function (req, res) {
  try {
    var on = !!(req.body || {}).on;
    await db.query('INSERT INTO chat_user_state (user_id, tenant_id, brief_on) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET brief_on = $3, updated_at = now()', [me(req), req.tenant.id, on]);
    res.json({ data: { on: on } });
  } catch (e) { httpErr.serverError(res, '[chat/brief-put]', e); }
});
router.post('/brief/now', async function (req, res) {
  try { var m = await briefFor(req.tenant.id, me(req)); res.status(201).json({ data: m }); }
  catch (e) { httpErr.serverError(res, '[chat/brief-now]', e); }
});
router.post('/daily-run', async function (req, res) {
  try { if (req.user.role !== 'admin') return res.status(403).json({ error: 'FORBIDDEN', message: '관리자만' }); res.json({ data: await dailyRun(true) }); }
  catch (e) { httpErr.serverError(res, '[chat/daily-run]', e); }
});

/* ⑩ /meet — 방 사람(또는 @부른 사람)의 달력에서 빈 시간 4개 → 📅 약속 잡기 투표 */
var MEET_HOURS = ['10:00', '14:00', '11:00', '15:00', '16:00', '09:30', '13:30', '16:30', '09:00', '10:30', '14:30', '15:30', '11:30', '17:00'];
function hmAdd(hm, min) { var t = +hm.slice(0, 2) * 60 + +hm.slice(3, 5) + min; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); }
async function meetSlots(tenantId, people, dur, fromDay, days) {
  var dates = [], d = new Date(fromDay + 'T00:00:00Z');
  while (dates.length < days) { var w = d.getUTCDay(); if (w !== 0 && w !== 6) dates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  var ev = (await db.query("SELECT start_date, COALESCE(NULLIF(end_date, ''), start_date) AS end_date, start_time, end_time, assignees, created_by FROM events WHERE tenant_id = $1 AND start_date <= $3 AND COALESCE(NULLIF(end_date, ''), start_date) >= $2", [tenantId, dates[0], dates[dates.length - 1]]).catch(function () { return { rows: [] }; })).rows;
  var nowK = new Date(Date.now() + 9 * 36e5), todayK = nowK.toISOString().slice(0, 10), nowHm = nowK.toISOString().slice(11, 16);
  function busyAt(p, at, from, to) {
    return ev.some(function (e) {
      if (String(e.start_date).slice(0, 10) > at || String(e.end_date).slice(0, 10) < at) return false;
      var as = Array.isArray(e.assignees) ? e.assignees : [];
      if (!(e.created_by === p.id || as.some(function (a) { var s = String(a && a.name || a).trim(); return s === p.id || p.names.indexOf(s) >= 0; }))) return false;
      if (!e.start_time || !e.end_time) return true;
      return String(e.start_time).slice(0, 5) < to && String(e.end_time).slice(0, 5) > from;
    });
  }
  var cands = [];
  dates.forEach(function (at, di) {
    MEET_HOURS.forEach(function (from, hi) {
      var to = hmAdd(from, dur);
      if (to > '18:00' || (from < '13:00' && to > '12:00')) return;   // 점심(12~13)에 걸치면 빼기
      if (at === todayK && from <= nowHm) return;
      var busy = people.filter(function (p) { return busyAt(p, at, from, to); }).map(function (p) { return p.n; });
      cands.push({ at: at, from: from, to: to, busy: busy, di: di, hi: hi });
    });
  });
  cands.sort(function (a, b) { return a.busy.length - b.busy.length || a.di - b.di || a.hi - b.hi; });
  var pick = [], perDay = {};
  [1, 2].forEach(function (cap) { cands.forEach(function (c) { if (pick.length < 4 && (perDay[c.at] || 0) < cap && pick.indexOf(c) < 0 && (!pick.length || c.busy.length <= pick[0].busy.length)) { pick.push(c); perDay[c.at] = (perDay[c.at] || 0) + 1; } }); });
  if (pick.length < 2) cands.forEach(function (c) { if (pick.length < 4 && pick.indexOf(c) < 0) pick.push(c); });
  return pick.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : a.from < b.from ? -1 : 1; });
}
async function meetCommand(req, room, arg, replyTo) {
  var t = req.tenant.id;
  var mem = (await db.query('SELECT u.id, u.name, u.display_name FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = $1 AND m.left_at IS NULL', [room.id])).rows;
  var people = mem.map(function (u) { return { id: u.id, n: u.display_name || u.name, names: [u.name, u.display_name].filter(Boolean) }; });
  var named = people.filter(function (p) { return p.names.some(function (n) { return arg.indexOf('@' + n) >= 0; }); });
  if (named.length) people = named.concat(people.filter(function (p) { return p.id === me(req) && named.indexOf(p) < 0; }));
  var dm = /(\d+)\s*(분|시간|h|m)(?![A-Za-z])/.exec(arg), dur = 60;
  if (dm) dur = /시간|h/.test(dm[2]) ? +dm[1] * 60 : +dm[1];
  dur = Math.min(Math.max(Math.round(dur / 30) * 30 || 60, 30), 240);
  var today = kstToday(), from = today, days = 5;
  if (/다음\s*주/.test(arg)) { var d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); from = d.toISOString().slice(0, 10); }
  else if (/내일/.test(arg)) { var d2 = new Date(today + 'T00:00:00Z'); d2.setUTCDate(d2.getUTCDate() + 1); from = d2.toISOString().slice(0, 10); days = 3; }
  var title = arg.replace(/@\S+/g, ' ').replace(/(\d+)\s*(분|시간|h|m)(?![A-Za-z])/, ' ').replace(/다음\s*주|이번\s*주|내일/g, ' ').replace(/\s+/g, ' ').trim() || '회의';
  var slots = await meetSlots(t, people, dur, from, days);
  if (slots.length < 2) return { eph: [ephMake(req, room, 'system', '⚠️ 빈 시간을 찾지 못했습니다 — 기간이나 길이를 바꿔 보세요')] };
  var opts = slots.map(function (s) { return { id: pollId(), at: s.at, from: s.from, to: s.to, t: s.at + ' ' + s.from + '~' + s.to, busy: s.busy }; });
  var poll = { q: title + ' (' + (dur % 60 ? dur + '분' : dur / 60 + '시간') + ')', kind: 'time', multi: true, opts: opts, votes: {}, until: null, closed: false, by: me(req), meet: { people: people.map(function (p) { return p.n; }), dur: dur } };
  return postMessage({ tenantId: t }, room, { userId: me(req), kind: 'text', body: '📅 약속 잡기: ' + poll.q + ' — ' + people.map(function (p) { return p.n; }).join(', ') + ' 의 달력에서 빈 시간 ' + opts.length + '개', poll: poll, replyTo: replyTo });
}

/* v13.426 / 명령 결과는 나만 보기 — 방에 저장하지 않고 보낸 사람에게만 돌려줌 (새로 고치면 사라짐)
 *   AI 답(/ai · /요약)은 토큰을 서버 메모리에 6시간 — "📢 방에 공유" 를 누르면 그 내용 그대로 방에 (내용을 바꿔 AI 인 척 못 함) */
var EPH = new Map(), EPH_TTL = 6 * 3600000;
function ephMake(req, room, kind, body, cards, extra) {
  var o = { id: 'e' + crypto.randomBytes(6).toString('hex'), eph: true, roomId: room.id, kind: kind, userId: null, userName: kind === 'ai' ? 'AI' : '', body: String(body || '').slice(0, MAX_BODY), cards: cards || null, at: new Date().toISOString(), q: (extra && extra.q) || null };
  if (kind === 'ai') {
    o.tok = o.id;
    EPH.set(o.id, { uid: me(req), roomId: room.id, body: o.body, cards: o.cards, q: o.q, at: Date.now() });
    EPH.forEach(function (v, k) { if (Date.now() - v.at > EPH_TTL) EPH.delete(k); });
    while (EPH.size > 3000) EPH.delete(EPH.keys().next().value);
  }
  return o;
}
router.post('/rooms/:id/eph-share', async function (req, res) {
  try {
    var room = await roomFor(req, res, req.params.id); if (!room) return;
    if (readOnly(res, room)) return;
    var tok = String((req.body || {}).tok || ''), e = EPH.get(tok);
    if (!e || e.uid !== me(req) || e.roomId !== room.id) return bad(res, '공유할 수 없습니다 — 오래돼서 사라졌을 수 있어요. 다시 물어봐 주세요.', 410);
    var head = '📢 ' + (req.user.name || '') + ' 님이 공유한 AI 답' + (e.q ? ' — ' + (e.q === '/요약' ? '대화 요약' : '질문: ' + e.q) : '');
    var msg = await postMessage({ tenantId: req.tenant.id }, room, { kind: 'ai', body: (head + '\n\n' + e.body).slice(0, MAX_BODY), cards: e.cards });
    EPH.delete(tok);
    res.status(201).json({ data: msg });
  } catch (e) { httpErr.serverError(res, '[chat/eph-share]', e); }
});

/* ─── v13.426 🔒 채팅 잠금 — PIN(4~8자리 숫자)은 scrypt 해시로 · 자동 잠금 분 · 틀리면 5번마다 1분 쉬기
 *   화면 가리개(사생활 보호)이지 권한 경계는 아님 — 잠겨도 로그인 세션은 그대로. PIN 을 잊으면 로그아웃 → 다시 로그인하면 풀림 */
var LOCK_FAIL = new Map();
function pinHash(pin) { var salt = crypto.randomBytes(12).toString('hex'); return salt + ':' + crypto.scryptSync(String(pin), salt, 32).toString('hex'); }
function pinOk(pin, stored) {
  if (!stored || stored.indexOf(':') < 0) return false;
  var sp = stored.split(':'), h = crypto.scryptSync(String(pin), sp[0], 32);
  return crypto.timingSafeEqual(h, Buffer.from(sp[1], 'hex'));
}
function pinValid(pin) { return /^\d{4,8}$/.test(String(pin || '')); }
async function lockRow(uid) { return (await db.query('SELECT lock_pin, lock_auto FROM chat_user_state WHERE user_id = $1', [uid])).rows[0] || {}; }
function lockWait(uid) { var f = LOCK_FAIL.get(uid); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; }
function lockMiss(uid) { var f = LOCK_FAIL.get(uid) || { n: 0, until: 0 }; f.n++; if (f.n % 5 === 0) f.until = Date.now() + 60000; LOCK_FAIL.set(uid, f); return f; }
router.get('/lock', async function (req, res) {
  try { var r = await lockRow(me(req)); res.json({ data: { hasPin: !!r.lock_pin, auto: +r.lock_auto || 0 } }); }
  catch (e) { httpErr.serverError(res, '[chat/lock]', e); }
});
router.put('/lock', async function (req, res) {
  try {
    var b = req.body || {}, uid = me(req), r = await lockRow(uid), w = lockWait(uid);
    if (r.lock_pin && (b.pin !== undefined || b.off)) {   // 바꾸기 · 끄기는 지금 PIN 확인
      if (w) return bad(res, w + '초 뒤에 다시 해 보세요.', 429);
      if (!pinOk(b.oldPin, r.lock_pin)) { lockMiss(uid); return bad(res, '지금 PIN 이 맞지 않습니다.', 403); }
      LOCK_FAIL.delete(uid);
    }
    if (b.pin !== undefined && !b.off && !pinValid(b.pin)) return bad(res, 'PIN 은 숫자 4~8자리로 정해 주세요.');
    var auto = b.auto === undefined ? (+r.lock_auto || 0) : Math.max(0, Math.min(240, parseInt(b.auto, 10) || 0));
    var hash = b.off ? null : b.pin !== undefined ? pinHash(b.pin) : (r.lock_pin || null);
    if (!hash) auto = 0;
    await db.query('INSERT INTO chat_user_state (user_id, tenant_id, lock_pin, lock_auto) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET lock_pin = $3, lock_auto = $4, updated_at = now()', [uid, req.tenant.id, hash, auto]);
    res.json({ data: { hasPin: !!hash, auto: auto } });
  } catch (e) { httpErr.serverError(res, '[chat/lock-put]', e); }
});
router.post('/lock/verify', async function (req, res) {
  try {
    var uid = me(req), w = lockWait(uid);
    if (w) return res.status(429).json({ error: 'WAIT', message: w + '초 뒤에 다시 해 보세요.', wait: w });
    var r = await lockRow(uid);
    if (!r.lock_pin) return res.json({ data: { ok: true } });
    if (!pinOk((req.body || {}).pin, r.lock_pin)) { var f = lockMiss(uid); return res.status(403).json({ error: 'WRONG', message: 'PIN 이 맞지 않습니다' + (f.until > Date.now() ? ' — 1분 뒤에 다시' : ' (' + (5 - f.n % 5) + '번 남음)'), wait: lockWait(uid) }); }
    LOCK_FAIL.delete(uid);
    res.json({ data: { ok: true } });
  } catch (e) { httpErr.serverError(res, '[chat/lock-verify]', e); }
});

/* ─── / 명령 ─── */
var HELP = [
  '/todo 내용 — 내 할 일로 (예: /todo 내일 15:00 견적 회신 !)',
  '/issue 제목 — 이 프로젝트에 이슈 올리기 (프로젝트 방)',
  '/ai 질문 — 내가 볼 수 있는 데이터로 AI 가 답함 (예: /ai 이번 주 지연 이슈)',
  '/요약 — 이 방 최근 대화를 AI 가 정리 (결정 · 할 일 · 남은 질문)',
  '/정리 — 정한 것 · 할 일 뽑아 등록 · 확인 요청',
  '/meet 제목 [30분|1시간] [@사람] [내일|다음주] — 달력에서 빈 시간 4개 찾아 약속 잡기'
].join('\n');
async function runCommand(req, room, body, replyTo) {
  var m = /^\/(\S+)\s*([\s\S]*)$/.exec(body); if (!m) return null;
  var cmd = m[1].toLowerCase(), arg = m[2].trim(), t = req.tenant.id;
  var E = [], priv = function (kind, text, cards, extra) { E.push(ephMake(req, room, kind, text, cards, extra)); return { eph: E }; };   // v13.426 나만 보기
  var self = function (text, kind, cards) { return postMessage({ tenantId: t }, room, { userId: kind === 'ai' ? null : me(req), kind: kind || 'text', body: text, cards: cards || null, replyTo: replyTo }); };
  if (cmd === 'help' || cmd === '도움' || cmd === '?') { return priv('system', HELP); }
  if (cmd === 'todo' || cmd === '할일') {
    if (!arg) return priv('system', '✏️ /todo 다음에 할 일을 적어 주세요');
    var QP = require('../../quick-parse'), q = QP.parse(arg, kstToday()), title = q.title.slice(0, 500), id = 'todo-' + crypto.randomUUID().slice(0, 12);
    await db.query('INSERT INTO my_todos (id, tenant_id, user_id, title, due_date, due_time, priority, memo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, t, me(req), title, q.due, q.due ? q.time : null, q.priority || 3, '💬 메신저에서']);
    return priv('text', '✅ 내 할 일에 넣었습니다 — ' + title + (q.due ? ' (' + q.due.slice(5).replace('-', '/') + (q.time ? ' ' + q.time : '') + ')' : ''), [{ type: 'todo', id: id, title: title, sub: q.due || '', nav: { todoId: id } }]);
  }
  if (cmd === 'issue' || cmd === '이슈') {
    if (room.kind !== 'project' || !room.project_id) return priv('system', '⚠️ /issue 는 프로젝트 방에서 씁니다');
    if (!arg) return priv('system', '✏️ /issue 다음에 이슈 제목을 적어 주세요');
    if (!await pa.canEditById(req, room.project_id)) return priv('system', '⚠️ 이 프로젝트에 이슈를 올릴 권한이 없습니다');
    var iid = 'iss-' + crypto.randomUUID().slice(0, 12);
    var urgent = /(^|\s)!(\s|$)|긴급/.test(arg), ttl = arg.replace(/(^|\s)!(\s|$)/, ' ').trim().slice(0, 300);
    await db.query("INSERT INTO issues (id, project_id, urgency, status, report_date, title, description, reporter_id, assignees, tags, created_by, updated_by, tenant_id) VALUES ($1,$2,$3,'open',$4,$5,$6,$7,'[]',$8,$7,$7,$9)",
      [iid, room.project_id, urgent ? 'urgent' : 'normal', kstToday(), ttl, '💬 메신저 프로젝트 방에서 올림', me(req), JSON.stringify(['메신저']), t]);
    projectNote(t, room.project_id, '🐞 새 이슈' + (urgent ? ' (긴급)' : '') + ' — ' + ttl + ' (' + (req.user.name || '') + ')', [{ type: 'issue', id: iid, title: ttl, sub: urgent ? '긴급' : '', status: 'open', urgency: urgent ? 'urgent' : 'normal', nav: { issueId: iid } }]);   // 이슈는 프로젝트 사람 모두의 일 — 방에 소식
    return priv('text', '🐞 이슈를 올렸습니다 — 방에도 알렸어요', [{ type: 'issue', id: iid, title: ttl, sub: urgent ? '긴급' : '', status: 'open', urgency: urgent ? 'urgent' : 'normal', nav: { issueId: iid } }]);
  }
  if (cmd === 'meet' || cmd === '약속' || cmd === '회의') return meetCommand(req, room, arg, replyTo);   // v13.424 ⑩
  if (cmd === 'ai' || cmd === '요약' || cmd === 'summary') {
    var ai = require('../lib/ai-usage');
    var quota = await ai.checkQuota(t);
    if (!quota.ok) return priv('system', '⚠️ ' + quota.message);
    if (!ai.takeHourly(me(req))) return priv('system', '⚠️ AI 질문 한도(시간당 60회)를 넘었습니다');
    hub.publish([me(req)], 'typing', { roomId: room.id, userId: 'ai', name: 'AI' });   // 나만 보기 — 쓰는 중도 나에게만
    var text = '', aiCards = null;
    try {
      if (cmd === 'ai') {
        if (!arg) return priv('system', '✏️ /ai 다음에 질문을 적어 주세요');
        var out = await require('../services/ai.service').answerWeb(arg.slice(0, 1000), { userId: me(req), role: req.user.role, departmentId: req.user.departmentId || null, tenantId: t, name: req.user.name || '사용자' }, { history: [] });
        if (!out) return priv('system', '⚠️ AI 가 설정되지 않았습니다');
        text = out.answer || '';
        // v13.424 ⑨ 답에 쓴 근거 → 카드 (누르면 그 화면 · 지금 상태 줄)
        aiCards = (out.sources || []).filter(function (s) { return s.cited && s.id != null && ['project', 'milestone', 'issue', 'order', 'as'].indexOf(s.type) >= 0; }).slice(0, 5)
          .map(function (s) { return { type: s.type, id: String(s.id), title: String(s.title || '').slice(0, 200), sub: String(s.sub || '').slice(0, 200), nav: s.nav || null }; });
        if (!aiCards.length) aiCards = null;
        await ai.logUsage(t, me(req), arg, out.provider);
      } else {
        var n = Math.min(Math.max(parseInt(arg, 10) || 80, 10), 200);
        var hist = await db.query("SELECT COALESCE(u.display_name, u.name, 'AI') AS n, m.body, m.created_at FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.room_id = $1 AND m.deleted_at IS NULL AND m.kind IN ('text','file','ai') ORDER BY m.id DESC LIMIT $2", [room.id, n]);
        var lines = hist.rows.reverse().map(function (x) { return '[' + new Date(x.created_at).toISOString().slice(5, 16).replace('T', ' ') + '] ' + x.n + ': ' + String(x.body || '').slice(0, 400); }).join('\n');
        var prompt = '다음은 사내 메신저 대화입니다. 한국어로 짧게 정리하세요.\n## 요점 (3줄 이내)\n## 정한 것\n## 할 일 (누가 · 무엇을 · 언제)\n## 아직 답이 없는 질문\n없는 항목은 "없음". 지어내지 마세요.\n\n' + lines;
        var g = await require('../services/ai-provider').generateText({ prompt: prompt.slice(0, 15000), tenantId: t });
        if (!g) return priv('system', '⚠️ AI 가 설정되지 않았습니다');
        text = g.text || '';
        await ai.logUsage(t, me(req), '/요약', g.provider);
      }
    } catch (e) {
      return priv('system', '⚠️ AI 응답 실패: ' + (e.message || e));
    }
    hub.publish([me(req)], 'typing', { roomId: room.id, userId: 'ai', name: 'AI', done: true });
    return priv('ai', text, aiCards, { q: cmd === 'ai' ? arg.slice(0, 120) : '/요약' });
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
module.exports.projectNote = projectNote;
module.exports.dmRoom = dmRoom;
module.exports.membership = membership;
