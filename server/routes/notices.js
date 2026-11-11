/**
 * 📢 공지사항 (v13.444)
 *   쓰기 · 고치기 · 게시 · 내리기 · 지우기 = 관리자 또는 지정된 작성자(notice_writers). 작성자는 자기가 쓴 것만, 관리자는 모두.
 *   게시하면 ① 접속 중인 사람에게 실시간(SSE 'wmnotice') ② 휴대폰 · 브라우저 푸시 ③ 사람마다 읽음 기록(notice_reads)
 *
 *   GET    /api/notices             내가 볼 공지(게시 중) + 안 읽은 수 · ?manage=1 (작성자) 임시 · 끝난 것 포함 + 읽은 사람 수
 *   GET    /api/notices/summary     안 읽은 수 · 아직 안 읽은 '중요' 공지 (로그인 직후 가볍게)
 *   POST   /api/notices             새 공지 { title, body, level, pinned, expiresAt, publish }
 *   PUT    /api/notices/:id         고치기 (같은 칸) · notify:true 면 다시 알림(모두 안 읽음으로)
 *   POST   /api/notices/:id/publish · /unpublish
 *   DELETE /api/notices/:id
 *   POST   /api/notices/:id/read    읽음 · POST /api/notices/read-all
 *   GET    /api/notices/:id/readers 읽은 사람 · 안 읽은 사람 (작성자)
 *   GET    /api/notices/writers     작성자 지정 화면용 사용자 목록 (관리자) · PUT /api/notices/writers { userIds }
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');
var hub = require('../lib/chat-hub');
var push = require('../services/push.service');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var LEVELS = ['normal', 'important'];
function me(req) { return req.user.sub; }
function isAdmin(req) { return req.user.role === 'admin'; }
async function canWrite(req) {
  if (isAdmin(req)) return true;
  var r = await db.query('SELECT 1 FROM notice_writers WHERE tenant_id = $1 AND user_id = $2', [req.tenant.id, me(req)]);
  return r.rows.length > 0;
}
async function myName(req) {
  var r = await db.query('SELECT COALESCE(display_name, name) AS n FROM users WHERE id = $1', [me(req)]);
  return (r.rows[0] && r.rows[0].n) || req.user.name || '';
}
async function allUserIds(tenantId) {
  var r = await db.query("SELECT id FROM users WHERE tenant_id = $1 AND status = 'active'", [tenantId]);
  return r.rows.map(function (x) { return x.id; });
}
function clean(b) {
  var o = {};
  if (b.title !== undefined) o.title = String(b.title || '').trim().slice(0, 200);
  if (b.body !== undefined) o.body = String(b.body || '').slice(0, 20000);
  if (b.level !== undefined) o.level = LEVELS.indexOf(b.level) >= 0 ? b.level : 'normal';
  if (b.pinned !== undefined) o.pinned = !!b.pinned;
  if (b.expiresAt !== undefined) { var d = b.expiresAt ? new Date(b.expiresAt) : null; o.expiresAt = d && !isNaN(d) ? d : null; }
  return o;
}
function row(r) {
  var o = {
    id: Number(r.id), title: r.title, body: r.body, level: r.level, pinned: r.pinned, status: r.status,
    publishedAt: r.published_at, expiresAt: r.expires_at, authorId: r.author_id, authorName: r.author_name,
    createdAt: r.created_at, updatedAt: r.updated_at,
    ended: !!(r.expires_at && new Date(r.expires_at) <= new Date())
  };
  if (r.is_read !== undefined) o.read = !!r.is_read;
  if (r.read_n !== undefined) o.readCount = Number(r.read_n) || 0;
  return o;
}
var LIVE = "n.status = 'published' AND (n.expires_at IS NULL OR n.expires_at > now())";
async function unreadOf(req) {
  var r = await db.query('SELECT COUNT(*) AS c FROM notices n WHERE n.tenant_id = $1 AND ' + LIVE +
    ' AND NOT EXISTS (SELECT 1 FROM notice_reads x WHERE x.notice_id = n.id AND x.user_id = $2)', [req.tenant.id, me(req)]);
  return Number(r.rows[0].c) || 0;
}
/** 게시 알림 — 실시간 + 푸시 (쓴 사람은 푸시 빼고) */
async function announce(req, n, op) {
  try {
    var ids = await allUserIds(req.tenant.id);
    hub.publish(ids, 'wmnotice', { op: op, id: Number(n.id), title: n.title, level: n.level, by: me(req) });
    if (op === 'publish') {
      var body = String(n.body || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      push.sendToUsers(ids.filter(function (u) { return u !== me(req); }), { title: (n.level === 'important' ? '📢 [중요] ' : '📢 공지 — ') + n.title, body: body, tag: 'notice-' + n.id, go: 'notice:' + n.id });
    }
  } catch (e) { console.error('[notices/announce]', e.message); }
}
async function loadOwn(req, res) {
  var r = await db.query('SELECT * FROM notices WHERE id = $1 AND tenant_id = $2', [parseInt(req.params.id, 10) || 0, req.tenant.id]);
  var n = r.rows[0];
  if (!n) { res.status(404).json({ error: 'NOT_FOUND', message: '공지를 찾을 수 없습니다.' }); return null; }
  if (!(await canWrite(req))) { res.status(403).json({ error: 'FORBIDDEN', message: '공지를 관리할 권한이 없습니다.' }); return null; }
  if (!isAdmin(req) && n.author_id !== me(req)) { res.status(403).json({ error: 'FORBIDDEN', message: '내가 쓴 공지만 고칠 수 있습니다.' }); return null; }
  return n;
}

// ─── 목록 ───
router.get('/', async function (req, res) {
  try {
    var writer = await canWrite(req), manage = writer && req.query.manage === '1';
    var sql = 'SELECT n.*, EXISTS (SELECT 1 FROM notice_reads x WHERE x.notice_id = n.id AND x.user_id = $2) AS is_read' +
      (manage ? ', (SELECT COUNT(*) FROM notice_reads x WHERE x.notice_id = n.id) AS read_n' : '') +
      ' FROM notices n WHERE n.tenant_id = $1 AND ' + (manage ? (isAdmin(req) ? 'TRUE' : "(n.author_id = $2 OR (" + LIVE + '))') : LIVE) +
      ' ORDER BY ' + (manage ? '' : 'n.pinned DESC, ') + "COALESCE(n.published_at, n.updated_at) DESC LIMIT 200";
    var r = await db.query(sql, [req.tenant.id, me(req)]);
    var out = { data: r.rows.map(row), unread: await unreadOf(req), canWrite: writer, isAdmin: isAdmin(req) };
    if (manage) out.total = (await allUserIds(req.tenant.id)).length;
    res.json(out);
  } catch (e) { httpErr.serverError(res, '[notices/list]', e); }
});

router.get('/summary', async function (req, res) {
  try {
    var r = await db.query('SELECT n.id, n.title, n.body, n.level, n.pinned, n.published_at, n.author_name FROM notices n WHERE n.tenant_id = $1 AND ' + LIVE +
      " AND n.level = 'important' AND NOT EXISTS (SELECT 1 FROM notice_reads x WHERE x.notice_id = n.id AND x.user_id = $2) ORDER BY n.published_at DESC LIMIT 5", [req.tenant.id, me(req)]);
    res.json({ data: { unread: await unreadOf(req), important: r.rows.map(function (x) { return { id: Number(x.id), title: x.title, body: x.body, level: x.level, pinned: x.pinned, publishedAt: x.published_at, authorName: x.author_name }; }), canWrite: await canWrite(req) } });
  } catch (e) { httpErr.serverError(res, '[notices/summary]', e); }
});

// ─── 작성자 지정 (관리자) — '/:id' 보다 먼저 ───
router.get('/writers', async function (req, res) {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'FORBIDDEN', message: '관리자만 지정할 수 있습니다.' });
    var r = await db.query("SELECT u.id, COALESCE(u.display_name, u.name) AS name, u.role, d.name AS dept, (w.user_id IS NOT NULL) AS writer FROM users u " +
      "LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN notice_writers w ON w.user_id = u.id AND w.tenant_id = u.tenant_id " +
      "WHERE u.tenant_id = $1 AND u.status = 'active' ORDER BY name", [req.tenant.id]);
    res.json({ data: r.rows.map(function (u) { return { id: u.id, name: u.name, role: u.role, dept: u.dept || '', writer: u.role === 'admin' || !!u.writer, fixed: u.role === 'admin' }; }) });
  } catch (e) { httpErr.serverError(res, '[notices/writers]', e); }
});
router.put('/writers', async function (req, res) {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'FORBIDDEN', message: '관리자만 지정할 수 있습니다.' });
    var ids = Array.isArray(req.body.userIds) ? req.body.userIds.map(String).slice(0, 500) : null;
    if (!ids) return res.status(400).json({ error: 'VALIDATION', message: 'userIds 필수' });
    var ok = ids.length ? (await db.query("SELECT id FROM users WHERE tenant_id = $1 AND status = 'active' AND id::text = ANY($2)", [req.tenant.id, ids])).rows.map(function (x) { return x.id; }) : [];
    await db.query('DELETE FROM notice_writers WHERE tenant_id = $1', [req.tenant.id]);
    for (var i = 0; i < ok.length; i++) await db.query('INSERT INTO notice_writers (tenant_id, user_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.tenant.id, ok[i], me(req)]);
    hub.publish(await allUserIds(req.tenant.id), 'wmnotice', { op: 'writers' });
    res.json({ data: { userIds: ok } });
  } catch (e) { httpErr.serverError(res, '[notices/writers-put]', e); }
});

router.post('/read-all', async function (req, res) {
  try {
    await db.query('INSERT INTO notice_reads (notice_id, user_id) SELECT n.id, $2 FROM notices n WHERE n.tenant_id = $1 AND ' + LIVE + ' ON CONFLICT DO NOTHING', [req.tenant.id, me(req)]);
    res.json({ data: { unread: 0 } });
  } catch (e) { httpErr.serverError(res, '[notices/read-all]', e); }
});

// ─── 쓰기 ───
router.post('/', async function (req, res) {
  try {
    if (!(await canWrite(req))) return res.status(403).json({ error: 'FORBIDDEN', message: '공지를 쓸 권한이 없습니다.' });
    var c = clean(req.body || {});
    if (!c.title) return res.status(400).json({ error: 'VALIDATION', message: '제목을 적어 주세요.' });
    var pub = !!req.body.publish;
    var r = await db.query('INSERT INTO notices (tenant_id, title, body, level, pinned, status, published_at, expires_at, author_id, author_name, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9) RETURNING *',
      [req.tenant.id, c.title, c.body || '', c.level || 'normal', !!c.pinned, pub ? 'published' : 'draft', pub ? new Date() : null, c.expiresAt || null, me(req), await myName(req)]);
    var n = r.rows[0];
    if (pub) { await db.query('INSERT INTO notice_reads (notice_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [n.id, me(req)]); await announce(req, n, 'publish'); }
    res.status(201).json({ data: row(n) });
  } catch (e) { httpErr.serverError(res, '[notices/create]', e); }
});

router.put('/:id', async function (req, res) {
  try {
    var n = await loadOwn(req, res); if (!n) return;
    var c = clean(req.body || {});
    if (c.title !== undefined && !c.title) return res.status(400).json({ error: 'VALIDATION', message: '제목을 적어 주세요.' });
    var r = await db.query('UPDATE notices SET title = $2, body = $3, level = $4, pinned = $5, expires_at = $6, updated_by = $7, updated_at = now() WHERE id = $1 RETURNING *',
      [n.id, c.title !== undefined ? c.title : n.title, c.body !== undefined ? c.body : n.body, c.level !== undefined ? c.level : n.level, c.pinned !== undefined ? c.pinned : n.pinned, c.expiresAt !== undefined ? c.expiresAt : n.expires_at, me(req)]);
    var u = r.rows[0];
    if (u.status === 'published') {
      if (req.body.notify) {   // 다시 알림 — 모두 안 읽음으로 (고친 사람만 읽음)
        await db.query('DELETE FROM notice_reads WHERE notice_id = $1 AND user_id <> $2', [u.id, me(req)]);
        await db.query('UPDATE notices SET published_at = now() WHERE id = $1', [u.id]);
        await announce(req, u, 'publish');
      } else await announce(req, u, 'update');
    }
    res.json({ data: row(u) });
  } catch (e) { httpErr.serverError(res, '[notices/update]', e); }
});

router.post('/:id/publish', async function (req, res) {
  try {
    var n = await loadOwn(req, res); if (!n) return;
    if (n.status === 'published') return res.json({ data: row(n) });
    var r = await db.query("UPDATE notices SET status = 'published', published_at = now(), updated_by = $2, updated_at = now() WHERE id = $1 RETURNING *", [n.id, me(req)]);
    await db.query('INSERT INTO notice_reads (notice_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [n.id, me(req)]);
    await announce(req, r.rows[0], 'publish');
    res.json({ data: row(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[notices/publish]', e); }
});
router.post('/:id/unpublish', async function (req, res) {
  try {
    var n = await loadOwn(req, res); if (!n) return;
    var r = await db.query("UPDATE notices SET status = 'draft', updated_by = $2, updated_at = now() WHERE id = $1 RETURNING *", [n.id, me(req)]);
    await db.query('DELETE FROM notice_reads WHERE notice_id = $1', [n.id]);   // 다시 게시하면 새 공지처럼
    await announce(req, r.rows[0], 'remove');
    res.json({ data: row(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[notices/unpublish]', e); }
});
router.delete('/:id', async function (req, res) {
  try {
    var n = await loadOwn(req, res); if (!n) return;
    await db.query('DELETE FROM notices WHERE id = $1', [n.id]);
    if (n.status === 'published') await announce(req, n, 'remove');
    res.json({ data: { id: Number(n.id) } });
  } catch (e) { httpErr.serverError(res, '[notices/delete]', e); }
});

router.post('/:id/read', async function (req, res) {
  try {
    var r = await db.query('SELECT n.id FROM notices n WHERE n.id = $1 AND n.tenant_id = $2 AND ' + LIVE, [parseInt(req.params.id, 10) || 0, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '공지를 찾을 수 없습니다.' });
    await db.query('INSERT INTO notice_reads (notice_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.rows[0].id, me(req)]);
    res.json({ data: { unread: await unreadOf(req) } });
  } catch (e) { httpErr.serverError(res, '[notices/read]', e); }
});

router.get('/:id/readers', async function (req, res) {
  try {
    var n = await loadOwn(req, res); if (!n) return;
    var r = await db.query("SELECT u.id, COALESCE(u.display_name, u.name) AS name, d.name AS dept, x.read_at FROM users u LEFT JOIN departments d ON d.id = u.department_id " +
      "LEFT JOIN notice_reads x ON x.user_id = u.id AND x.notice_id = $2 WHERE u.tenant_id = $1 AND u.status = 'active' ORDER BY (x.read_at IS NULL), x.read_at DESC, name", [req.tenant.id, n.id]);
    res.json({ data: r.rows.map(function (u) { return { id: u.id, name: u.name, dept: u.dept || '', readAt: u.read_at }; }) });
  } catch (e) { httpErr.serverError(res, '[notices/readers]', e); }
});

module.exports = router;
