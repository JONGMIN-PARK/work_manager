var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var authService = require('../services/auth.service');
var notificationService = require('../services/notification.service');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// 같은 테넌트 사용자만 메시지 대상 허용
async function _peerInTenant(req, userId) {
  if (!userId) return false;
  var r = await db.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2', [userId, req.tenant.id]);
  return r.rows.length > 0;
}

// GET /api/messages/unread-count — 내 미읽음 총합 (메뉴 뱃지용)
router.get('/unread-count', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT COUNT(*)::int AS n FROM messages WHERE tenant_id = $1 AND to_user_id = $2 AND read_at IS NULL',
      [req.tenant.id, req.user.sub]
    );
    res.json({ count: (r.rows[0] && r.rows[0].n) || 0 });
  } catch (e) {
    httpErr.serverError(res, '[messages/unread]', e);
  }
});

// GET /api/messages/threads — 대화 목록(상대별 최신 메시지 + 미읽음 수)
router.get('/threads', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT t.peer, u.name AS peer_name, u.display_name AS peer_display, t.body, t.created_at, t.from_user_id, ' +
      '(SELECT COUNT(*)::int FROM messages m WHERE m.tenant_id = $2 AND m.to_user_id = $1 AND m.from_user_id = t.peer AND m.read_at IS NULL) AS unread ' +
      'FROM ( ' +
      '  SELECT DISTINCT ON (peer) peer, body, created_at, from_user_id FROM ( ' +
      '    SELECT CASE WHEN from_user_id = $1 THEN to_user_id ELSE from_user_id END AS peer, body, created_at, from_user_id ' +
      '    FROM messages WHERE tenant_id = $2 AND (from_user_id = $1 OR to_user_id = $1) ' +
      '  ) s ORDER BY peer, created_at DESC ' +
      ') t JOIN users u ON u.id = t.peer ORDER BY t.created_at DESC',
      [req.user.sub, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[messages/threads]', e);
  }
});

// GET /api/messages?withUserId=xxx — 특정 상대와의 대화(시간순) + 받은 메시지 읽음 처리
router.get('/', async function (req, res) {
  try {
    var peer = req.query.withUserId || req.query.with_user_id;
    if (!peer) return res.status(400).json({ error: 'BAD_REQUEST', message: 'withUserId 필수' });
    var r = await db.query(
      'SELECT m.*, fu.name AS from_name, fu.display_name AS from_display FROM messages m ' +
      'JOIN users fu ON fu.id = m.from_user_id ' +
      'WHERE m.tenant_id = $2 AND ((m.from_user_id = $1 AND m.to_user_id = $3) OR (m.from_user_id = $3 AND m.to_user_id = $1)) ' +
      'ORDER BY m.created_at ASC LIMIT 300',
      [req.user.sub, req.tenant.id, peer]
    );
    // 상대→나 메시지 읽음 처리
    await db.query(
      'UPDATE messages SET read_at = now() WHERE tenant_id = $1 AND to_user_id = $2 AND from_user_id = $3 AND read_at IS NULL',
      [req.tenant.id, req.user.sub, peer]
    );
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[messages/thread]', e);
  }
});

// POST /api/messages — 메시지 전송 {toUserId, body, contextType?, contextId?}
/**
 * 쪽지 보내기 — 웹 POST / 와 텔레그램 답장(v13.302)이 같이 쓴다. 반환 { status, body }
 * 받는 사람 알림에는 replyRef 를 실어, 텔레그램에서 그 알림에 답장하면 다시 쪽지로 돌아온다.
 */
async function sendSiteMessage(req, b) {
  b = b || {};
  var toUserId = b.toUserId || b.to_user_id;
  var body = (b.body != null) ? String(b.body).trim() : '';
  if (!toUserId) return { status: 400, body: { error: 'BAD_REQUEST', message: 'toUserId 필수' } };
  if (!body) return { status: 400, body: { error: 'BAD_REQUEST', message: '내용은 비어 있을 수 없습니다.' } };
  if (toUserId === req.user.sub) return { status: 400, body: { error: 'BAD_REQUEST', message: '자신에게는 보낼 수 없습니다.' } };
  if (!await _peerInTenant(req, toUserId)) return { status: 404, body: { error: 'NOT_FOUND', message: '대상 사용자를 찾을 수 없습니다.' } };

  var fromName = req.user.name || '';
  try {
    var ar = await db.query('SELECT name, display_name FROM users WHERE id = $1', [req.user.sub]);
    if (ar.rows.length) fromName = ar.rows[0].display_name || ar.rows[0].name || fromName;
  } catch (_) {}

  var id = 'msg-' + crypto.randomUUID().slice(0, 12);
  var r = await db.query(
    'INSERT INTO messages (id, tenant_id, from_user_id, to_user_id, body, context_type, context_id) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [id, req.tenant.id, req.user.sub, toUserId, body, b.contextType || b.context_type || null, b.contextId || b.context_id || null]
  );
  // v13.315 쪽지는 메신저 1:1 방에도 (화면은 메신저) — 알림도 메신저가 (못 보면 텔레그램) · legacy_id 로 다음 기동 옮김과 겹치지 않게
  try {
    var chat = require('./chat');
    var room = await chat.dmRoom(req.tenant.id, req.user.sub, toUserId, req.user.sub);
    await chat.postMessage({ tenantId: req.tenant.id }, room, { userId: req.user.sub, kind: 'text', body: body, legacyId: id });
  } catch (e) {
    console.error('[messages→chat]', e.message);
    notificationService.notify('message_received', {
      fromName: fromName, body: body, fromUserId: req.user.sub,
      replyRef: { kind: 'message', id: req.user.sub }
    }, [toUserId]).catch(function (e2) { console.error('[messages/notify]', e2.message); });
  }
  try { authService.auditLog(req.user.sub, 'message.send', 'user', toUserId, { len: body.length }, req).catch(function () {}); } catch (_) {}
  return { status: 201, body: { data: r.rows[0] } };
}

router.post('/', async function (req, res) {
  try {
    var out = await sendSiteMessage(req, req.body || {});
    return res.status(out.status).json(out.body);
  } catch (e) {
    return httpErr.serverError(res, '[messages/send]', e);
  }
});

// POST /api/messages/read — 특정 상대로부터 받은 메시지 전체 읽음 {fromUserId}
router.post('/read', async function (req, res) {
  try {
    var b = req.body || {};
    var fromUserId = b.fromUserId || b.from_user_id;
    if (!fromUserId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'fromUserId 필수' });
    await db.query(
      'UPDATE messages SET read_at = now() WHERE tenant_id = $1 AND to_user_id = $2 AND from_user_id = $3 AND read_at IS NULL',
      [req.tenant.id, req.user.sub, fromUserId]
    );
    res.json({ message: '읽음 처리 완료' });
  } catch (e) {
    httpErr.serverError(res, '[messages/read]', e);
  }
});

module.exports = router;
module.exports.sendSiteMessage = sendSiteMessage;
