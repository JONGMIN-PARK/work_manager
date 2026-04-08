var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ─── GET /api/notifications — 인앱 알림 목록 ───
router.get('/', async function (req, res) {
  try {
    var limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    var offset = parseInt(req.query.offset, 10) || 0;
    var unreadOnly = req.query.unread === 'true';

    var where = ['user_id = $1'];
    var params = [req.user.sub];
    var idx = 2;

    if (unreadOnly) {
      where.push('is_read = false');
    }

    var sql = 'SELECT * FROM in_app_notifications WHERE ' + where.join(' AND ') +
      ' ORDER BY created_at DESC LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(limit, offset);

    var countSql = 'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_read = false) as unread FROM in_app_notifications WHERE user_id = $1';

    var r = await db.query(sql, params);
    var countR = await db.query(countSql, [req.user.sub]);

    res.json({
      data: r.rows,
      total: parseInt(countR.rows[0].total, 10),
      unread: parseInt(countR.rows[0].unread, 10)
    });
  } catch (e) {
    console.error('[notifications/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── GET /api/notifications/unread-count — 읽지 않은 알림 수 ───
router.get('/unread-count', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT COUNT(*) as count FROM in_app_notifications WHERE user_id = $1 AND is_read = false',
      [req.user.sub]
    );
    res.json({ data: { count: parseInt(r.rows[0].count, 10) } });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── PUT /api/notifications/:id/read — 알림 읽음 처리 ───
router.put('/:id/read', async function (req, res) {
  try {
    var r = await db.query(
      'UPDATE in_app_notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.sub]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '읽음 처리되었습니다.' });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── PUT /api/notifications/read-all — 전체 읽음 처리 ───
router.put('/read-all', async function (req, res) {
  try {
    await db.query(
      'UPDATE in_app_notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [req.user.sub]
    );
    res.json({ message: '전체 읽음 처리되었습니다.' });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── DELETE /api/notifications/:id — 알림 삭제 ───
router.delete('/:id', async function (req, res) {
  try {
    await db.query(
      'DELETE FROM in_app_notifications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.sub]
    );
    res.json({ message: '삭제되었습니다.' });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── GET /api/notifications/preferences — 알림 환경설정 조회 ───
router.get('/preferences', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT event_type, channel, is_enabled FROM notification_prefs WHERE user_id = $1 ORDER BY event_type, channel',
      [req.user.sub]
    );
    res.json({ data: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── PUT /api/notifications/preferences — 알림 환경설정 저장 ───
router.put('/preferences', async function (req, res) {
  try {
    var prefs = req.body.preferences; // [{ event_type, channel, is_enabled }]
    if (!Array.isArray(prefs)) {
      return res.status(400).json({ error: 'VALIDATION', message: 'preferences 배열이 필요합니다.' });
    }

    for (var i = 0; i < prefs.length; i++) {
      var p = prefs[i];
      await db.query(
        'INSERT INTO notification_prefs (user_id, event_type, channel, is_enabled) VALUES ($1, $2, $3, $4) ' +
        'ON CONFLICT (user_id, event_type, channel) DO UPDATE SET is_enabled = $4',
        [req.user.sub, p.event_type, p.channel, p.is_enabled]
      );
    }

    res.json({ message: '알림 설정이 저장되었습니다.' });
  } catch (e) {
    console.error('[notifications/preferences]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
