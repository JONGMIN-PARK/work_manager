/**
 * 텔레그램 연동 라우트
 * - Webhook 수신 (봇 메시지 처리)
 * - 인증코드 발급/연동상태/해제 API
 * - 알림 설정 조회/변경
 */
var express = require('express');
var router = express.Router();
var config = require('../config');
var telegramService = require('../services/telegram.service');
var db = require('../config/db');
var { authenticate } = require('../middleware/auth');

/**
 * POST /api/telegram/webhook
 * Telegram이 호출하는 Webhook 엔드포인트 (인증 불필요)
 */
router.post('/webhook', function (req, res) {
  // secret_token 검증
  if (config.telegram.webhookSecret) {
    var token = req.headers['x-telegram-bot-api-secret-token'];
    if (token !== config.telegram.webhookSecret) {
      return res.sendStatus(403);
    }
  }

  // 비동기 처리 (Telegram에 즉시 200 응답)
  res.sendStatus(200);

  telegramService.handleUpdate(req.body).catch(function (err) {
    console.error('[Telegram Webhook] Error:', err.message);
  });
});

/**
 * POST /api/telegram/auth-code
 * 인증코드 발급 (로그인 사용자 전용)
 */
router.post('/auth-code', authenticate, async function (req, res) {
  try {
    if (!telegramService.isConfigured()) {
      return res.status(503).json({ error: 'TELEGRAM_NOT_CONFIGURED', message: '텔레그램 봇이 설정되지 않았습니다.' });
    }

    var code = await telegramService.createAuthCode(req.user.sub);
    var botUsername = config.telegram.botUsername;
    var deepLink = botUsername ? 'https://t.me/' + botUsername + '?start=' + code : null;

    res.json({
      data: {
        code: code,
        deepLink: deepLink,
        botUsername: botUsername,
        expiresInSeconds: 300
      }
    });
  } catch (err) {
    console.error('[Telegram] auth-code error:', err);

    // 테이블 미존재 시 자동 생성 시도
    if (err.message && err.message.includes('does not exist')) {
      try {
        var fs = require('fs');
        var path = require('path');
        var migrationPath = path.join(__dirname, '..', 'migrations', '003_telegram.sql');
        var sql = fs.readFileSync(migrationPath, 'utf8');
        await db.query(sql);
        console.log('[Telegram] Auto-created telegram tables');

        // 재시도
        var code = await telegramService.createAuthCode(req.user.sub);
        var botUsername = config.telegram.botUsername;
        var deepLink = botUsername ? 'https://t.me/' + botUsername + '?start=' + code : null;
        return res.json({ data: { code: code, deepLink: deepLink, botUsername: botUsername, expiresInSeconds: 300 } });
      } catch (migErr) {
        console.error('[Telegram] Auto-migration failed:', migErr.message);
        return res.status(500).json({ error: 'DB_ERROR', message: '텔레그램 테이블 생성 실패: ' + migErr.message });
      }
    }

    res.status(500).json({ error: 'SERVER_ERROR', message: '인증코드 생성 실패: ' + err.message });
  }
});

/**
 * GET /api/telegram/status
 * 연동 상태 조회
 */
router.get('/status', authenticate, async function (req, res) {
  try {
    var configured = telegramService.isConfigured();
    var link = null;
    if (configured) {
      try {
        link = await telegramService.getLinkStatus(req.user.sub);
      } catch (dbErr) {
        // 테이블 미생성 등 DB 오류 → 미연동 취급
        console.warn('[Telegram] DB query failed (table may not exist):', dbErr.message);
      }
    }
    res.json({
      data: {
        configured: configured,
        linked: !!link,
        username: link ? link.username : null,
        linkedAt: link ? link.linked_at : null,
        isActive: link ? link.is_active : false
      }
    });
  } catch (err) {
    console.error('[Telegram] status error:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: '상태 조회 실패' });
  }
});

/**
 * DELETE /api/telegram/unlink
 * 연동 해제
 */
router.delete('/unlink', authenticate, async function (req, res) {
  try {
    await telegramService.unlink(req.user.sub);
    res.json({ message: '텔레그램 연동이 해제되었습니다.' });
  } catch (err) {
    console.error('[Telegram] unlink error:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: '연동 해제 실패' });
  }
});

/**
 * GET /api/telegram/prefs
 * 알림 설정 조회
 */
router.get('/prefs', authenticate, async function (req, res) {
  try {
    var r = await db.query(
      'SELECT event_type, is_enabled FROM notification_prefs WHERE user_id = $1 AND channel = \'telegram\'',
      [req.user.sub]
    );
    var prefs = {};
    r.rows.forEach(function (row) { prefs[row.event_type] = row.is_enabled; });
    res.json({ data: prefs });
  } catch (err) {
    res.status(500).json({ error: 'SERVER_ERROR', message: '설정 조회 실패' });
  }
});

/**
 * PUT /api/telegram/prefs
 * 알림 설정 변경
 * body: { event_type: string, is_enabled: boolean }
 */
router.put('/prefs', authenticate, async function (req, res) {
  try {
    var eventType = req.body.event_type;
    var isEnabled = !!req.body.is_enabled;

    if (!eventType) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'event_type 필수' });
    }

    await db.query(
      'INSERT INTO notification_prefs (user_id, channel, event_type, is_enabled) VALUES ($1, \'telegram\', $2, $3) ON CONFLICT (user_id, channel, event_type) DO UPDATE SET is_enabled = $3',
      [req.user.sub, eventType, isEnabled]
    );

    res.json({ message: '설정이 변경되었습니다.', data: { event_type: eventType, is_enabled: isEnabled } });
  } catch (err) {
    res.status(500).json({ error: 'SERVER_ERROR', message: '설정 변경 실패' });
  }
});

module.exports = router;
