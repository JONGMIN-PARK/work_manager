/**
 * 👥 그룹(TFT) (v13.535) — 고정된 사람 묶음 + 그룹 전용 대화방
 *   GET    /api/groups                 내가 낀 그룹 (구성원 이름 · 대화방) — ?all=1 이면 보관한 것까지
 *   POST   /api/groups                 { name, icon?, purpose?, memberIds[], projectId? } — 만든 사람 = 리더, 대화방(👥 이름) 함께
 *   PUT    /api/groups/:id             { name?, icon?, purpose?, memberIds?, projectId? } — 리더 · 관리자만. 구성원이 바뀌면 대화방도 맞춤
 *   DELETE /api/groups/:id             보관(리더 · 관리자) · POST /api/groups/:id/restore 되살리기
 *   POST   /api/groups/:id/leave       나 빠지기 (리더는 못 빠짐 — 리더를 넘기거나 보관)
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

function bad(res, m, c) { return httpErr.sendError(res, c || 400, 'VALIDATION', m); }
async function names(tid, ids) {
  if (!ids.length) return {};
  var r = await db.query("SELECT id, COALESCE(NULLIF(display_name,''), name) AS n, name AS reg FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tid, ids]);
  var o = {}; r.rows.forEach(function (u) { o[u.id] = u.n; }); return o;
}
function shape(g, nm, pname) {
  return { id: g.id, name: g.name, icon: g.icon || '👥', purpose: g.purpose || '', ownerId: g.owner_id, ownerName: nm[g.owner_id] || '',
    members: (g.members || []).map(function (u) { return { id: u, name: nm[u] || '' }; }), projectId: g.project_id, projectName: pname || '', roomId: g.room_id,
    archived: !!g.archived_at, createdAt: g.created_at };
}
async function cleanMembers(req, ids, ownerId) {
  var list = (Array.isArray(ids) ? ids : []).filter(function (x, i, a) { return typeof x === 'string' && x && a.indexOf(x) === i; }).slice(0, 200);
  if (list.indexOf(ownerId) < 0) list.unshift(ownerId);
  var ok = await db.query("SELECT id FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'", [req.tenant.id, list]);
  if (ok.rows.length !== list.length) return null;
  return list;
}
async function load(req, res, id, lead) {
  var g = (await db.query('SELECT * FROM work_groups WHERE id = $1 AND tenant_id = $2', [id, req.tenant.id])).rows[0];
  var me = req.user.sub, admin = req.user.role === 'admin' || req.user.role === 'executive';
  if (!g || ((g.members || []).indexOf(me) < 0 && g.owner_id !== me && !admin)) { httpErr.sendError(res, 404, 'NOT_FOUND', '그룹을 찾을 수 없습니다.'); return null; }
  if (lead && g.owner_id !== me && !admin) { httpErr.sendError(res, 403, 'FORBIDDEN', '그룹 리더만 바꿀 수 있습니다.'); return null; }
  return g;
}
async function out(req, rows) {
  var ids = []; rows.forEach(function (g) { [g.owner_id].concat(g.members || []).forEach(function (u) { if (ids.indexOf(u) < 0) ids.push(u); }); });
  var nm = await names(req.tenant.id, ids);
  var pids = rows.map(function (g) { return g.project_id; }).filter(Boolean), pn = {};
  if (pids.length) (await db.query('SELECT id, name FROM projects WHERE tenant_id = $1 AND id = ANY($2)', [req.tenant.id, pids])).rows.forEach(function (p) { pn[p.id] = p.name; });
  return rows.map(function (g) { return shape(g, nm, pn[g.project_id]); });
}

router.get('/', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM work_groups WHERE tenant_id = $1 AND ($2 = ANY(members) OR owner_id = $2)' + (req.query.all === '1' ? '' : ' AND archived_at IS NULL') + ' ORDER BY archived_at NULLS FIRST, name', [req.tenant.id, req.user.sub]);
    res.json({ data: await out(req, r.rows) });
  } catch (e) { httpErr.serverError(res, '[groups/list]', e); }
});

router.post('/', async function (req, res) {
  try {
    var b = req.body || {}, tid = req.tenant.id, me = req.user.sub;
    var name = String(b.name || '').trim().slice(0, 100);
    if (!name) return bad(res, '그룹 이름을 적으세요.');
    var members = await cleanMembers(req, b.memberIds, me);
    if (!members) return bad(res, '같은 회사 사용자만 넣을 수 있습니다.');
    if (members.length < 2) return bad(res, '나 말고 한 명 이상 넣으세요.');
    var pid = b.projectId ? String(b.projectId).slice(0, 100) : null;
    if (pid && !(await pa.canReadById(req, pid))) pid = null;
    var icon = String(b.icon || '👥').slice(0, 16);
    // 그룹 대화방
    var rid = 'grp-' + crypto.randomUUID().slice(0, 12);
    await db.query("INSERT INTO chat_rooms (id, tenant_id, kind, name, created_by) VALUES ($1,$2,'group',$3,$4)", [rid, tid, (icon + ' ' + name).slice(0, 120), me]);
    var chat = require('./chat');
    await chat.setRoomMembers(tid, rid, members, me);
    var id = 'wg-' + crypto.randomUUID().slice(0, 12);
    var r = await db.query('INSERT INTO work_groups (id, tenant_id, name, icon, purpose, owner_id, members, project_id, room_id) VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8,$9) RETURNING *',
      [id, tid, name, icon, String(b.purpose || '').trim().slice(0, 2000) || null, me, members, pid, rid]);
    var room = (await db.query('SELECT * FROM chat_rooms WHERE id = $1', [rid])).rows[0];
    await chat.postMessage({ tenantId: tid }, room, { userId: me, kind: 'text', mentions: members.filter(function (u) { return u !== me; }),
      body: icon + ' 그룹 「' + name + '」을 만들었어요' + (b.purpose ? ' — ' + String(b.purpose).trim().slice(0, 200) : '') + '\n업무 보내기 · 함께 하기 · 같이 담당에서 「' + name + '」 하나로 모두를 고를 수 있어요' });
    res.status(201).json({ data: (await out(req, r.rows))[0] });
  } catch (e) { httpErr.serverError(res, '[groups/create]', e); }
});

router.put('/:id', async function (req, res) {
  try {
    var g = await load(req, res, req.params.id, true); if (!g) return;
    var b = req.body || {}, sets = [], vals = [g.id];
    var push = function (col, v) { vals.push(v); sets.push(col + ' = $' + vals.length); };
    if (b.name !== undefined) { var n = String(b.name || '').trim().slice(0, 100); if (!n) return bad(res, '그룹 이름을 적으세요.'); push('name', n); }
    if (b.icon !== undefined) push('icon', String(b.icon || '👥').slice(0, 16));
    if (b.purpose !== undefined) push('purpose', String(b.purpose || '').trim().slice(0, 2000) || null);
    if (b.projectId !== undefined) { var pid = b.projectId ? String(b.projectId).slice(0, 100) : null; if (pid && !(await pa.canReadById(req, pid))) pid = null; push('project_id', pid); }
    var members = null;
    if (b.memberIds !== undefined) {
      members = await cleanMembers(req, b.memberIds, g.owner_id);
      if (!members) return bad(res, '같은 회사 사용자만 넣을 수 있습니다.');
      vals.push(members); sets.push('members = $' + vals.length + '::uuid[]');
    }
    if (!sets.length) return bad(res, '바꿀 내용이 없습니다.');
    var r = await db.query('UPDATE work_groups SET ' + sets.join(', ') + ', updated_at = now() WHERE id = $1 RETURNING *', vals);
    var ng = r.rows[0];
    if (ng.room_id) {
      var chat = require('./chat');
      if (members) {
        var ch = await chat.setRoomMembers(req.tenant.id, ng.room_id, members, ng.owner_id);
        if (ch.added.length || ch.removed.length) {
          var nm = await names(req.tenant.id, ch.added.concat(ch.removed));
          var room = (await db.query('SELECT * FROM chat_rooms WHERE id = $1', [ng.room_id])).rows[0];
          if (room) await chat.postMessage({ tenantId: req.tenant.id }, room, { kind: 'system', body: (req.user.name || '') + ' 님이 그룹 구성원을 바꿨습니다' +
            (ch.added.length ? ' — 들어옴: ' + ch.added.map(function (u) { return nm[u]; }).join(', ') : '') + (ch.removed.length ? ' — 빠짐: ' + ch.removed.map(function (u) { return nm[u]; }).join(', ') : '') });
        }
      }
      if (b.name !== undefined || b.icon !== undefined) await db.query('UPDATE chat_rooms SET name = $2 WHERE id = $1', [ng.room_id, ((ng.icon || '👥') + ' ' + ng.name).slice(0, 120)]);
    }
    res.json({ data: (await out(req, [ng]))[0] });
  } catch (e) { httpErr.serverError(res, '[groups/update]', e); }
});

router.delete('/:id', async function (req, res) {
  try {
    var g = await load(req, res, req.params.id, true); if (!g) return;
    await db.query('UPDATE work_groups SET archived_at = now(), updated_at = now() WHERE id = $1', [g.id]);
    res.json({ data: { id: g.id, archived: true } });
  } catch (e) { httpErr.serverError(res, '[groups/archive]', e); }
});
router.post('/:id/restore', async function (req, res) {
  try {
    var g = await load(req, res, req.params.id, true); if (!g) return;
    var r = await db.query('UPDATE work_groups SET archived_at = NULL, updated_at = now() WHERE id = $1 RETURNING *', [g.id]);
    res.json({ data: (await out(req, r.rows))[0] });
  } catch (e) { httpErr.serverError(res, '[groups/restore]', e); }
});
router.post('/:id/leave', async function (req, res) {
  try {
    var g = await load(req, res, req.params.id, false); if (!g) return;
    if (g.owner_id === req.user.sub) return bad(res, '리더는 빠질 수 없습니다 — 리더를 넘기거나 그룹을 보관하세요.', 409);
    var members = (g.members || []).filter(function (u) { return u !== req.user.sub; });
    await db.query('UPDATE work_groups SET members = $2::uuid[], updated_at = now() WHERE id = $1', [g.id, members]);
    if (g.room_id) await require('./chat').setRoomMembers(req.tenant.id, g.room_id, members, g.owner_id);
    res.json({ data: { id: g.id, left: true } });
  } catch (e) { httpErr.serverError(res, '[groups/leave]', e); }
});

module.exports = router;
