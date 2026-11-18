/**
 * 🤝 함께 하기 — 페어 세션 (v13.534)
 *   POST /api/pair                 { title, itemKey?, projectId?, userIds[] } — 방(1명이면 1:1, 여럿이면 그룹) · 📝 공동 메모 · 세션 기록을 한 번에
 *   GET  /api/pair?active=1        내가 낀 세션 (진행 중만 / 없으면 최근 50)
 *   POST /api/pair/:id/join        참여 표시(처음 들어온 시각)
 *   POST /api/pair/:id/end         { summary?, addPartners? } — 누구든 끝냄: 걸린 시간 · 요약을 방에, 연결된 할 일 메모에,
 *                                   참여자 모두의 그날 노트(📝 일일 노트)에 한 줄. addPartners 면 연결된 할 일에 🤝 같이 담당으로
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

var TEMPLATE = function (title) {
  return '# 🤝 ' + title + '\n\n## 오늘 할 것\n- [ ] \n\n## 메모\n\n\n## 정한 것\n- \n\n## 다음 할 일 (누가 · 언제)\n- [ ] \n';
};
function kst(d) { return new Date((d ? new Date(d).getTime() : Date.now()) + 9 * 3600000); }
function hm(d) { return kst(d).toISOString().slice(11, 16); }
async function names(tid, ids) {
  var r = await db.query("SELECT id, COALESCE(NULLIF(display_name,''), name) AS n FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tid, ids]);
  var o = {}; r.rows.forEach(function (u) { o[u.id] = u.n; }); return o;
}
function shape(s, nm) {
  return { id: s.id, title: s.title, itemKey: s.item_key, projectId: s.project_id, roomId: s.room_id, docId: s.doc_id, startedBy: s.started_by,
    members: (s.members || []).map(function (u) { return { id: u, name: (nm && nm[u]) || '', joined: !!(s.joined && s.joined[u]) }; }),
    startedAt: s.started_at, endedAt: s.ended_at, minutes: s.minutes, summary: s.summary || '' };
}
async function mine(req, id) {
  var r = await db.query('SELECT * FROM pair_sessions WHERE id = $1 AND tenant_id = $2 AND $3 = ANY(members)', [id, req.tenant.id, req.user.sub]);
  return r.rows[0] || null;
}

router.post('/', async function (req, res) {
  try {
    var b = req.body || {}, tid = req.tenant.id, me = req.user.sub;
    var title = String(b.title || '').trim().slice(0, 200);
    if (!title) return httpErr.sendError(res, 400, 'VALIDATION', '무엇을 함께 할지 적으세요.');
    var others = (Array.isArray(b.userIds) ? b.userIds : []).filter(function (x, i, a) { return typeof x === 'string' && x && x !== me && a.indexOf(x) === i; }).slice(0, 10);
    if (!others.length) return httpErr.sendError(res, 400, 'VALIDATION', '함께 할 사람을 고르세요.');
    var ok = await db.query("SELECT id FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'", [tid, others]);
    if (ok.rows.length !== others.length) return httpErr.sendError(res, 400, 'VALIDATION', '같은 회사 사용자만 고를 수 있습니다.');
    var pid = b.projectId ? String(b.projectId).slice(0, 100) : null;
    if (pid && !(await pa.canReadById(req, pid))) pid = null;
    var itemKey = b.itemKey ? String(b.itemKey).slice(0, 160) : null;
    var chat = require('./chat');
    var room;
    if (others.length === 1) room = await chat.dmRoom(tid, me, others[0], me);
    else {
      var rid = 'grp-' + crypto.randomUUID().slice(0, 12);
      await db.query("INSERT INTO chat_rooms (id, tenant_id, kind, name, created_by) VALUES ($1,$2,'group',$3,$4)", [rid, tid, ('🤝 ' + title).slice(0, 120), me]);
      for (var u of [me].concat(others)) await db.query('INSERT INTO chat_members (room_id, user_id, tenant_id, role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [rid, u, tid, u === me ? 'owner' : 'member']);
      room = (await db.query('SELECT * FROM chat_rooms WHERE id = $1', [rid])).rows[0];
    }
    // 📝 공동 메모 — 방 공동 문서(같이 고치기 · 줄 단위 합치기)
    var did = 'doc-' + crypto.randomUUID().slice(0, 12);
    await db.query('INSERT INTO chat_docs (id, tenant_id, room_id, title, body, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6)', [did, tid, room.id, ('🤝 ' + title).slice(0, 200), TEMPLATE(title), me]);
    var id = 'pair-' + crypto.randomUUID().slice(0, 12), members = [me].concat(others), joined = {}; joined[me] = new Date().toISOString();
    var r = await db.query('INSERT INTO pair_sessions (id, tenant_id, title, item_key, project_id, room_id, doc_id, started_by, members, joined) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],$10) RETURNING *',
      [id, tid, title, itemKey, pid, room.id, did, me, members, JSON.stringify(joined)]);
    var nm = await names(tid, members);
    await chat.postMessage({ tenantId: tid }, room, { userId: me, kind: 'text', mentions: others,
      body: '🤝 함께 하기를 시작했어요: ' + title + ' — 아래 📝 공동 메모를 같이 고치고, 필요하면 📞 통화 · 화면 공유로',
      cards: [{ type: 'cdoc', id: did, title: '🤝 ' + title, sub: '📝 공동 메모 · 같이 고치기' }] });
    res.status(201).json({ data: shape(r.rows[0], nm) });
  } catch (e) { httpErr.serverError(res, '[pair/start]', e); }
});

router.get('/', async function (req, res) {
  try {
    var active = req.query.active === '1';
    var r = await db.query('SELECT * FROM pair_sessions WHERE tenant_id = $1 AND $2 = ANY(members)' + (active ? ' AND ended_at IS NULL' : '') + ' ORDER BY started_at DESC LIMIT 50', [req.tenant.id, req.user.sub]);
    var ids = []; r.rows.forEach(function (s) { (s.members || []).forEach(function (u) { if (ids.indexOf(u) < 0) ids.push(u); }); });
    var nm = ids.length ? await names(req.tenant.id, ids) : {};
    res.json({ data: r.rows.map(function (s) { return shape(s, nm); }) });
  } catch (e) { httpErr.serverError(res, '[pair/list]', e); }
});

router.post('/:id/join', async function (req, res) {
  try {
    var s = await mine(req, req.params.id); if (!s) return httpErr.sendError(res, 404, 'NOT_FOUND');
    if (s.ended_at) return httpErr.sendError(res, 409, 'ENDED', '이미 끝난 세션입니다.');
    var r = await db.query("UPDATE pair_sessions SET joined = joined || jsonb_build_object($2::text, now()::text) WHERE id = $1 AND NOT (joined ? $2::text) RETURNING *", [s.id, req.user.sub]);
    res.json({ data: shape(r.rows[0] || s, await names(req.tenant.id, s.members)) });
  } catch (e) { httpErr.serverError(res, '[pair/join]', e); }
});

router.post('/:id/end', async function (req, res) {
  try {
    var s = await mine(req, req.params.id); if (!s) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var b = req.body || {}, tid = req.tenant.id;
    var summary = String(b.summary || '').trim().slice(0, 1000);
    var up = await db.query("UPDATE pair_sessions SET ended_at = now(), ended_by = $2, summary = $3, minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (now() - started_at)) / 60))::int WHERE id = $1 AND ended_at IS NULL RETURNING *", [s.id, req.user.sub, summary || null]);
    if (!up.rows.length) return httpErr.sendError(res, 409, 'ENDED', '이미 끝난 세션입니다.');
    s = up.rows[0];
    var nm = await names(tid, s.members);
    var who = s.members.map(function (u) { return nm[u]; }).filter(Boolean).join(' · ');
    var line = '🤝 ' + hm(s.started_at) + '~' + hm(s.ended_at) + ' (' + s.minutes + '분) ' + s.title + ' — ' + who + (summary ? ' · ' + summary : '');
    res.json({ data: shape(s, nm) });
    // 뒤처리 (실패해도 끝남은 그대로)
    try {
      var chat = require('./chat');
      var room = (await db.query('SELECT * FROM chat_rooms WHERE id = $1', [s.room_id])).rows[0];
      if (room) await chat.postMessage({ tenantId: tid }, room, { kind: 'system', body: '🤝 함께 하기 끝 — ' + s.minutes + '분' + (summary ? ' · ' + summary : '') });
    } catch (e) { console.warn('[pair/end chat]', e.message); }
    try {   // 참여자 모두 그날 노트에 한 줄
      var day = kst(s.ended_at).toISOString().slice(0, 10);
      for (var i = 0; i < s.members.length; i++) {
        await db.query("INSERT INTO my_notes (user_id, note_date, ref, tenant_id, body) VALUES ($1,$2,'',$3,$4) ON CONFLICT (user_id, note_date, ref) DO UPDATE SET body = LEFT(my_notes.body || E'\\n' || EXCLUDED.body, 20000), updated_at = now()",
          [s.members[i], day, tid, line]);
      }
    } catch (e) { console.warn('[pair/end notes]', e.message); }
    var m = /^todo:(.+)$/.exec(s.item_key || '');
    if (m) try {   // 연결된 할 일 — 메모에 한 줄 · 원하면 같이 담당
      await db.query("UPDATE my_todos SET memo = LEFT(COALESCE(memo,'') || CASE WHEN COALESCE(memo,'') = '' THEN '' ELSE E'\\n' END || $3, 5000), updated_at = now()" +
        (b.addPartners ? ', partners = ARRAY(SELECT DISTINCT x FROM unnest(partners || $4::uuid[]) x WHERE x <> user_id)' : '') +
        ' WHERE id = $1 AND tenant_id = $2', b.addPartners ? [m[1], tid, line, s.members] : [m[1], tid, line]);
    } catch (e) { console.warn('[pair/end todo]', e.message); }
  } catch (e) { httpErr.serverError(res, '[pair/end]', e); }
});

module.exports = router;
