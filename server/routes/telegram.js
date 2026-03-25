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

/** 인라인 버튼 콜백 처리 */
async function handleCallbackQuery(query) {
  var chatId = query.message.chat.id;
  var data = query.data || '';
  var callbackId = query.id;

  var user = await telegramService.getUserByChatId(chatId);
  if (!user) {
    await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '계정 연동이 필요합니다.' });
    return;
  }

  var parts = data.split(':');
  var action = parts[0];

  try {
    if (action === 'issue_start') {
      // 이슈 상태 → inProgress
      var issueId = parts[1];
      await db.query("UPDATE issues SET status = 'inProgress', updated_at = NOW(), updated_by = $1, version = version + 1 WHERE id = $2", [user.user_id, issueId]);
      await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '✅ 대응 시작!' });
      await telegramService.sendMessage(chatId, '🔵 이슈 상태가 <b>대응중</b>으로 변경되었습니다.');
    }
    else if (action === 'issue_resolve') {
      var issueId2 = parts[1];
      await db.query("UPDATE issues SET status = 'resolved', resolved_date = $1, updated_at = NOW(), updated_by = $2, version = version + 1 WHERE id = $3", [new Date().toISOString().slice(0,10), user.user_id, issueId2]);
      await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '✅ 해결 완료!' });
      await telegramService.sendMessage(chatId, '✅ 이슈가 <b>해결</b> 처리되었습니다.');
    }
    else if (action === 'checklist_done') {
      var clId = parts[1];
      var itemIdx = parseInt(parts[2]);
      var clR = await db.query('SELECT items FROM checklists WHERE id = $1', [clId]);
      if (clR.rows.length > 0) {
        var items = typeof clR.rows[0].items === 'string' ? JSON.parse(clR.rows[0].items) : clR.rows[0].items;
        if (items[itemIdx]) {
          items[itemIdx].done = true;
          await db.query('UPDATE checklists SET items = $1, version = version + 1 WHERE id = $2', [JSON.stringify(items), clId]);
          await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '✅ 완료!' });
          await telegramService.sendMessage(chatId, '✅ <b>' + (items[itemIdx].title || items[itemIdx].text || items[itemIdx].name || '항목') + '</b> 완료 처리됨');
        }
      }
    }
    else {
      await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '알 수 없는 액션' });
    }
  } catch (err) {
    console.error('[Callback]', err.message);
    await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '오류 발생: ' + err.message });
  }
}

/**
 * POST /api/telegram/webhook
 * Telegram이 호출하는 Webhook 엔드포인트 (인증 불필요)
 */
router.post('/webhook', function (req, res) {
  if (config.telegram.webhookSecret) {
    var token = req.headers['x-telegram-bot-api-secret-token'];
    if (token !== config.telegram.webhookSecret) {
      return res.sendStatus(403);
    }
  }
  res.sendStatus(200);

  // 일반 메시지
  if (req.body.message) {
    telegramService.handleUpdate(req.body).catch(function (err) {
      console.error('[Telegram Webhook] Error:', err.message);
    });
  }

  // 인라인 버튼 콜백
  if (req.body.callback_query) {
    handleCallbackQuery(req.body.callback_query).catch(function (err) {
      console.error('[Telegram Callback] Error:', err.message);
    });
  }
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

    // DB 오류 시 테이블 재생성 시도 (타입 불일치 또는 미존재)
    try {
      console.log('[Telegram] Attempting table recreation...');
      // 기존 잘못된 테이블 삭제 후 재생성
      await db.query('DROP TABLE IF EXISTS telegram_auth_codes CASCADE');
      await db.query('DROP TABLE IF EXISTS notification_logs CASCADE');
      await db.query('DROP TABLE IF EXISTS notification_prefs CASCADE');
      await db.query('DROP TABLE IF EXISTS telegram_links CASCADE');

      var fs = require('fs');
      var path = require('path');
      var migrationPath = path.join(__dirname, '..', 'migrations', '003_telegram.sql');
      var sql = fs.readFileSync(migrationPath, 'utf8');
      await db.query(sql);
      console.log('[Telegram] Tables recreated successfully');

      // 재시도
      var code = await telegramService.createAuthCode(req.user.sub);
      var botUsername = config.telegram.botUsername;
      var deepLink = botUsername ? 'https://t.me/' + botUsername + '?start=' + code : null;
      return res.json({ data: { code: code, deepLink: deepLink, botUsername: botUsername, expiresInSeconds: 300 } });
    } catch (migErr) {
      console.error('[Telegram] Table recreation failed:', migErr.message);
      return res.status(500).json({ error: 'DB_ERROR', message: '테이블 재생성 실패: ' + migErr.message });
    }
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

/**
 * GET /api/telegram/debug
 * 봇 상태 + Webhook 상태 진단 (관리자 전용)
 */
router.get('/debug', authenticate, async function (req, res) {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'FORBIDDEN', message: '관리자만 접근 가능' });
    }

    var result = { configured: telegramService.isConfigured() };

    if (!result.configured) {
      result.error = 'TELEGRAM_BOT_TOKEN 환경변수가 설정되지 않았습니다.';
      return res.json({ data: result });
    }

    // 봇 정보 확인 (getMe)
    var meRes = await fetch('https://api.telegram.org/bot' + config.telegram.botToken + '/getMe');
    var me = await meRes.json();
    result.bot = me.ok ? { username: me.result.username, name: me.result.first_name, id: me.result.id } : { error: me.description };

    // Webhook이 비어있으면 자동 등록 시도
    var whInfoRes = await fetch('https://api.telegram.org/bot' + config.telegram.botToken + '/getWebhookInfo');
    var whInfo = await whInfoRes.json();

    if (whInfo.ok && !whInfo.result.url && config.telegram.webhookUrl) {
      // Webhook 자동 등록
      var setBody = { url: config.telegram.webhookUrl };
      if (config.telegram.webhookSecret) setBody.secret_token = config.telegram.webhookSecret;
      var setRes = await fetch('https://api.telegram.org/bot' + config.telegram.botToken + '/setWebhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setBody)
      });
      var setResult = await setRes.json();
      result.webhookSetup = setResult;

      // 등록 후 다시 확인
      var whRes2 = await fetch('https://api.telegram.org/bot' + config.telegram.botToken + '/getWebhookInfo');
      whInfo = await whRes2.json();
    }

    if (whInfo.ok) {
      result.webhook = {
        url: whInfo.result.url,
        hasCustomCert: whInfo.result.has_custom_certificate,
        pendingUpdates: whInfo.result.pending_update_count,
        lastError: whInfo.result.last_error_message || null,
        lastErrorDate: whInfo.result.last_error_date ? new Date(whInfo.result.last_error_date * 1000).toISOString() : null
      };
    }

    // 설정값 (시크릿은 마스킹)
    result.config = {
      webhookUrl: config.telegram.webhookUrl || '(미설정)',
      botUsername: config.telegram.botUsername || '(미설정)',
      webhookSecret: config.telegram.webhookSecret ? '****' + config.telegram.webhookSecret.slice(-4) : '(미설정)'
    };

    // 테이블 존재 여부
    try {
      await db.query('SELECT 1 FROM telegram_links LIMIT 0');
      result.tables = 'OK';
    } catch (e) {
      result.tables = 'ERROR: ' + e.message;
    }

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

/**
 * POST /api/telegram/setup-webhook
 * Webhook 수동 재등록 (관리자 전용)
 */
router.post('/setup-webhook', authenticate, async function (req, res) {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'FORBIDDEN', message: '관리자만 접근 가능' });
    }
    var result = await telegramService.setWebhook();
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

module.exports = router;
