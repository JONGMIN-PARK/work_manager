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
var tenant = require('../middleware/tenant');
var planGate = require('../middleware/plan-gate');
var escHtmlTg = require('../telegram/util/escape').escHtml;

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
      // 이슈 상태 → inProgress (테넌트 격리 가드)
      var issueId = parts[1];
      await db.query("UPDATE issues SET status = 'inProgress', updated_at = NOW(), updated_by = $1, version = version + 1 WHERE id = $2 AND tenant_id = $3", [user.user_id, issueId, user.tenant_id]);
      await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '✅ 대응 시작!' });
      await telegramService.sendMessage(chatId, '🔵 이슈 상태가 <b>대응중</b>으로 변경되었습니다.');
    }
    else if (action === 'issue_resolve') {
      var issueId2 = parts[1];
      await db.query("UPDATE issues SET status = 'resolved', resolved_date = $1, updated_at = NOW(), updated_by = $2, version = version + 1 WHERE id = $3 AND tenant_id = $4", [new Date().toISOString().slice(0,10), user.user_id, issueId2, user.tenant_id]);
      await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '✅ 해결 완료!' });
      await telegramService.sendMessage(chatId, '✅ 이슈가 <b>해결</b> 처리되었습니다.');
    }
    else if (action === 'checklist_done') {
      var clId = parts[1];
      var itemIdx = parseInt(parts[2]);
      // 테넌트 격리 가드: 호출자 테넌트 소속 체크리스트만 조회/수정
      var clR = await db.query('SELECT items FROM checklists WHERE id = $1 AND tenant_id = $2', [clId, user.tenant_id]);
      if (clR.rows.length > 0) {
        var items = typeof clR.rows[0].items === 'string' ? JSON.parse(clR.rows[0].items) : clR.rows[0].items;
        if (items[itemIdx]) {
          items[itemIdx].done = true;
          await db.query('UPDATE checklists SET items = $1, version = version + 1 WHERE id = $2 AND tenant_id = $3', [JSON.stringify(items), clId, user.tenant_id]);
          await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '✅ 완료!' });
          await telegramService.sendMessage(chatId, '✅ <b>' + (items[itemIdx].title || items[itemIdx].text || items[itemIdx].name || '항목') + '</b> 완료 처리됨');
        }
      }
    }
    else if (action === 'approve_user') {
      var pendingId = parts[1];
      if (user.role !== 'admin') {
        await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '관리자만 승인 가능합니다.' });
        return;
      }
      // 테넌트 격리: 다른 테넌트의 pending 사용자를 승인하지 못하도록 가드
      await db.query("UPDATE users SET status = 'active', role = 'member', approved_by = $1, approved_at = NOW(), updated_at = NOW() WHERE id = $2 AND status = 'pending' AND tenant_id = $3", [user.user_id, pendingId, user.tenant_id]);
      var approvedUser = await db.query('SELECT name FROM users WHERE id = $1 AND tenant_id = $2', [pendingId, user.tenant_id]);
      var approvedName = approvedUser.rows[0] ? approvedUser.rows[0].name : '?';
      await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '✅ ' + approvedName + ' 승인 완료!' });
      await telegramService.sendMessage(chatId, '✅ <b>' + approvedName + '</b>님의 가입이 승인되었습니다.');
    }
    else if (action === 'reject_user') {
      var rejectId = parts[1];
      if (user.role !== 'admin') {
        await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '관리자만 반려 가능합니다.' });
        return;
      }
      // 테넌트 격리: 다른 테넌트의 pending 사용자를 반려하지 못하도록 가드
      await db.query("UPDATE users SET status = 'rejected', approved_by = $1, approved_at = NOW(), updated_at = NOW() WHERE id = $2 AND status = 'pending' AND tenant_id = $3", [user.user_id, rejectId, user.tenant_id]);
      var rejectedUser = await db.query('SELECT name FROM users WHERE id = $1 AND tenant_id = $2', [rejectId, user.tenant_id]);
      var rejectedName = rejectedUser.rows[0] ? rejectedUser.rows[0].name : '?';
      await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '❌ ' + rejectedName + ' 반려' });
      await telegramService.sendMessage(chatId, '❌ <b>' + rejectedName + '</b>님의 가입이 반려되었습니다.');
    }
    else if (action === 'dev_start') {
      // 개발 아이템 → 진행(doing) (테넌트 격리)
      var devId = parts[1];
      var dR = await db.query("UPDATE project_dev_items SET status = 'doing', updated_by = $1, updated_at = NOW(), version = version + 1 WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL RETURNING title", [user.user_id, devId, user.tenant_id]);
      if (dR.rows.length) {
        await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '🔵 진행 시작!' });
        await telegramService.sendMessage(chatId, '🔵 <b>' + escHtmlTg(dR.rows[0].title) + '</b> — 진행중으로 변경');
      } else {
        await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '항목을 찾을 수 없습니다.' });
      }
    }
    else if (action === 'action_done') {
      // 회의 액션아이템 → 완료 (테넌트 격리)
      var actId = parts[1];
      var aR = await db.query("UPDATE meeting_action_items SET status = 'done' WHERE id = $1 AND tenant_id = $2 RETURNING title", [actId, user.tenant_id]);
      if (aR.rows.length) {
        await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '✅ 완료!' });
        await telegramService.sendMessage(chatId, '✅ <b>' + escHtmlTg(aR.rows[0].title) + '</b> — 완료 처리됨');
      } else {
        await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '항목을 찾을 수 없습니다.' });
      }
    }
    else if (action === 'issue_urgent') {
      var urgentIssueId = parts[1];
      await db.query("UPDATE issues SET urgency = 'urgent', updated_at = NOW(), updated_by = $1, version = version + 1 WHERE id = $2 AND tenant_id = $3", [user.user_id, urgentIssueId, user.tenant_id]);
      await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '🔴 긴급으로 변경!' });
      await telegramService.sendMessage(chatId, '🔴 이슈 긴급도가 <b>긴급</b>으로 변경되었습니다.');
    }
    else if (action === 'vote') {
      // vote:{voteId}:{optionIndex} — DB(telegram_votes) 기반 영속 투표
      var voteId = parts[1];
      var optIdx = parseInt(parts[2]);
      if (!voteId || isNaN(optIdx)) {
        await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '잘못된 투표 형식' });
        return;
      }
      // 테넌트 격리: 다른 테넌트 투표 접근 차단
      var vR = await db.query(
        "SELECT question, options, is_closed, chat_id, message_id FROM telegram_votes WHERE id = $1 AND tenant_id = $2",
        [voteId, user.tenant_id]
      );
      if (vR.rows.length === 0) {
        await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '투표를 찾을 수 없습니다.' });
        return;
      }
      if (vR.rows[0].is_closed) {
        await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '종료된 투표입니다.' });
        return;
      }
      var options = vR.rows[0].options;
      if (typeof options === 'string') options = JSON.parse(options);
      if (optIdx < 0 || optIdx >= options.length) {
        await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '잘못된 옵션' });
        return;
      }
      // 1인 1표(같은 vote 내 갱신) — UNIQUE(vote_id, user_id)
      await db.query(
        "INSERT INTO telegram_vote_responses (vote_id, user_id, user_name, option_index) VALUES ($1, $2, $3, $4) ON CONFLICT (vote_id, user_id) DO UPDATE SET option_index = $4, voted_at = NOW()",
        [voteId, user.user_id, user.name, optIdx]
      );
      // 집계 후 inline keyboard 갱신 (스팸 방지: 별도 채팅 메시지는 발송하지 않음)
      var aggR = await db.query(
        "SELECT option_index, COUNT(*)::int AS c FROM telegram_vote_responses WHERE vote_id = $1 GROUP BY option_index",
        [voteId]
      );
      var counts = {};
      aggR.rows.forEach(function(row){ counts[row.option_index] = row.c; });
      var keyboard = options.map(function(opt, i){
        return [{ text: opt + ' (' + (counts[i] || 0) + ')', callback_data: 'vote:' + voteId + ':' + i }];
      });
      if (vR.rows[0].message_id) {
        await telegramService.callApi('editMessageReplyMarkup', {
          chat_id: vR.rows[0].chat_id,
          message_id: vR.rows[0].message_id,
          reply_markup: { inline_keyboard: keyboard }
        });
      }
      await telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: '✅ 투표 완료' });
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
router.post('/auth-code', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
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
    return res.status(500).json({ error: 'DB_ERROR', message: '인증코드 발급 실패. 관리자에게 문의하세요.' });
  }
});

/**
 * GET /api/telegram/status
 * 연동 상태 조회
 */
router.get('/status', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
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
router.delete('/unlink', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
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
router.get('/prefs', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
  try {
    var r = await db.query(
      'SELECT event_type, is_enabled FROM notification_prefs WHERE user_id = $1 AND channel = \'telegram\' AND tenant_id = $2',
      [req.user.sub, req.tenant.id]
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
router.put('/prefs', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
  try {
    var eventType = req.body.event_type;
    var isEnabled = !!req.body.is_enabled;

    if (!eventType) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'event_type 필수' });
    }

    await db.query(
      'INSERT INTO notification_prefs (user_id, channel, event_type, is_enabled, tenant_id) VALUES ($1, \'telegram\', $2, $3, $4) ON CONFLICT (user_id, channel, event_type) DO UPDATE SET is_enabled = $3',
      [req.user.sub, eventType, isEnabled, req.tenant.id]
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
router.get('/debug', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
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
      await db.query('SELECT 1 FROM telegram_links WHERE tenant_id = $1 LIMIT 0', [req.tenant.id]);
      result.tables = 'OK';
    } catch (e) {
      result.tables = 'ERROR: ' + e.message;
    }

    // 발송 메트릭 (notification_logs 기반 — 테넌트 격리)
    try {
      result.metrics = await telegramService.getMetrics(req.tenant.id);
    } catch (e) {
      result.metrics = { error: e.message };
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
router.post('/setup-webhook', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
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
