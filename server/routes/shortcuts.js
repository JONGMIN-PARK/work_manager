/**
 * 🔖 바로가기 (v13.528) — 본인 것만
 *   GET    /api/shortcuts?trash=1         목록 (휴지통이면 지운 것)
 *   POST   /api/shortcuts                 { title, menu, part, item, icon, target } — 같은 곳이 이미 있으면 그것을 돌려줌(맨 위로)
 *   PUT    /api/shortcuts/:id             { title?, menu?, part? }
 *   PUT    /api/shortcuts/order           { ids: [...] } — 보이는 순서대로
 *   DELETE /api/shortcuts/:id             휴지통으로 (되살리기 POST /:id/restore)
 *   DELETE /api/shortcuts/:id?hard=1      휴지통에서 영구 삭제 · DELETE /api/shortcuts/trash 비우기
 *  한 사람 300개까지(휴지통 빼고)
 */
var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var CTX_K = ['project', 'note', 'map', 'room', 'doc', 'docview'];
function str(v, n) { v = v == null ? '' : String(v).trim(); return v.slice(0, n) || null; }
function cleanTarget(t) {
  if (!t || typeof t !== 'object') return null;
  var page = str(t.page, 40);
  if (!page || !/^[a-z_]+$/.test(page)) return null;
  var out = { page: page };
  var mode = str(t.mode, 40); if (mode && /^[a-z_]+$/.test(mode)) out.mode = mode;
  var c = t.ctx;
  if (c && typeof c === 'object' && CTX_K.indexOf(c.k) >= 0 && c.id) {
    out.ctx = { k: c.k, id: String(c.id).slice(0, 120) };
    if (c.pid) out.ctx.pid = String(c.pid).slice(0, 120);
  }
  return out;
}
function shape(r) {
  return { id: r.id, title: r.title, menu: r.menu || '', part: r.part || '', item: r.item || '', icon: r.icon || '', target: r.target, order: r.sort_order, deletedAt: r.deleted_at, createdAt: r.created_at };
}
var me = function (req) { return [req.tenant.id, req.user.sub]; };

router.get('/', async function (req, res) {
  try {
    var trash = req.query.trash === '1';
    var r = await db.query('SELECT * FROM user_shortcuts WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS ' + (trash ? 'NOT NULL ORDER BY deleted_at DESC' : 'NULL ORDER BY sort_order, created_at') + ' LIMIT 500', me(req));
    var n = trash ? null : (await db.query('SELECT COUNT(*)::int AS n FROM user_shortcuts WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NOT NULL', me(req))).rows[0].n;
    res.json({ data: r.rows.map(shape), trashCount: n });
  } catch (e) { httpErr.serverError(res, '[shortcuts/list]', e); }
});

router.post('/', async function (req, res) {
  try {
    var b = req.body || {}, target = cleanTarget(b.target);
    if (!target) return httpErr.sendError(res, 400, 'VALIDATION', '바로가기 위치가 맞지 않습니다.');
    var title = str(b.title, 200) || str(b.item, 200) || str(b.part, 200) || str(b.menu, 200);
    if (!title) return httpErr.sendError(res, 400, 'VALIDATION', '이름을 적으세요.');
    // 같은 곳 — 새로 만들지 않고 맨 위로(휴지통에 있으면 되살림)
    var same = await db.query('SELECT * FROM user_shortcuts WHERE tenant_id = $1 AND user_id = $2 AND target = $3::jsonb', me(req).concat([JSON.stringify(target)]));
    var top = (await db.query('SELECT COALESCE(MIN(sort_order), 0) - 1 AS o FROM user_shortcuts WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL', me(req))).rows[0].o;
    if (same.rows.length) {
      var u = await db.query('UPDATE user_shortcuts SET deleted_at = NULL, sort_order = $2, updated_at = now() WHERE id = $1 RETURNING *', [same.rows[0].id, top]);
      return res.json({ data: shape(u.rows[0]), existed: true });
    }
    var cnt = (await db.query('SELECT COUNT(*)::int AS n FROM user_shortcuts WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL', me(req))).rows[0].n;
    if (cnt >= 300) return httpErr.sendError(res, 400, 'VALIDATION', '바로가기는 300개까지입니다. 안 쓰는 것을 휴지통으로 보내 주세요.');
    var r = await db.query(
      'INSERT INTO user_shortcuts (id, tenant_id, user_id, title, menu, part, item, icon, target, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      ['sc-' + crypto.randomUUID().slice(0, 12), req.tenant.id, req.user.sub, title, str(b.menu, 60), str(b.part, 60), str(b.item, 300), str(b.icon, 16), JSON.stringify(target), top]);
    res.status(201).json({ data: shape(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[shortcuts/create]', e); }
});

router.put('/order', async function (req, res) {
  try {
    var ids = Array.isArray((req.body || {}).ids) ? req.body.ids.filter(function (x) { return typeof x === 'string'; }).slice(0, 500) : [];
    if (!ids.length) return httpErr.sendError(res, 400, 'VALIDATION', 'ids 가 필요합니다.');
    await db.query('UPDATE user_shortcuts s SET sort_order = t.o, updated_at = now() FROM unnest($3::text[]) WITH ORDINALITY AS t(id, o) WHERE s.id = t.id AND s.tenant_id = $1 AND s.user_id = $2', me(req).concat([ids]));
    res.json({ data: { n: ids.length } });
  } catch (e) { httpErr.serverError(res, '[shortcuts/order]', e); }
});

router.put('/:id', async function (req, res) {
  try {
    var b = req.body || {}, sets = [], vals = [req.params.id].concat(me(req));
    if (b.title !== undefined) { var t = str(b.title, 200); if (!t) return httpErr.sendError(res, 400, 'VALIDATION', '이름을 적으세요.'); vals.push(t); sets.push('title = $' + vals.length); }
    if (b.menu !== undefined) { vals.push(str(b.menu, 60)); sets.push('menu = $' + vals.length); }
    if (b.part !== undefined) { vals.push(str(b.part, 60)); sets.push('part = $' + vals.length); }
    if (!sets.length) return httpErr.sendError(res, 400, 'VALIDATION', '바꿀 내용이 없습니다.');
    var r = await db.query('UPDATE user_shortcuts SET ' + sets.join(', ') + ', updated_at = now() WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING *', vals);
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: shape(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[shortcuts/update]', e); }
});


router.delete('/trash', async function (req, res) {
  try {
    var r = await db.query('DELETE FROM user_shortcuts WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NOT NULL', me(req));
    res.json({ data: { n: r.rowCount } });
  } catch (e) { httpErr.serverError(res, '[shortcuts/empty]', e); }
});

router.delete('/:id', async function (req, res) {
  try {
    var hard = req.query.hard === '1';
    var r = hard
      ? await db.query('DELETE FROM user_shortcuts WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NOT NULL RETURNING id', [req.params.id].concat(me(req)))
      : await db.query('UPDATE user_shortcuts SET deleted_at = now(), updated_at = now() WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL RETURNING id', [req.params.id].concat(me(req)));
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: { id: req.params.id, hard: hard } });
  } catch (e) { httpErr.serverError(res, '[shortcuts/delete]', e); }
});
router.post('/:id/restore', async function (req, res) {
  try {
    var top = (await db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS o FROM user_shortcuts WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL', me(req))).rows[0].o;
    var r = await db.query('UPDATE user_shortcuts SET deleted_at = NULL, sort_order = $4, updated_at = now() WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NOT NULL RETURNING *', [req.params.id].concat(me(req)).concat([top]));
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: shape(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[shortcuts/restore]', e); }
});

module.exports = router;
