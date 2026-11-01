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
var httpErr = require('../lib/http-errors');

/**
 * 인라인 버튼 콜백 처리 (v13.301 다시 짬)
 *   누른 사람 = query.from (예전엔 메시지가 있던 방으로 찾아 그룹방 투표 · 버튼이 안 됐다)
 *   이슈 · 체크리스트 · 액션 · 개발 · A/S 는 telegram/actions.js — 웹과 같은 권한 확인 · 같은 알림
 *   바뀐 게 없으면 "이미 …" 로 답한다 (예전엔 없는 항목도 "완료!")
 */
var tgActions = require('../telegram/actions');

function answer(callbackId, text) {
  return telegramService.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: String(text || '').slice(0, 190) });
}

async function handleCallbackQuery(query) {
  if (!query || !query.message) return;
  var chatId = query.message.chat.id;
  var data = query.data || '';
  var callbackId = query.id;

  var user = query.from ? await telegramService.getUserByChatId(query.from.id) : null;
  if (!user) {
    await answer(callbackId, '계정 연동이 필요합니다 — 봇과 1:1 대화에서 연동하세요.');
    return;
  }

  var parts = data.split(':');
  var action = parts[0];

  try {
    // 내 업무 ✅ 완료 · 목록 · 추천 · 프로젝트 버튼 (v13.274)
    if (/^mw[dlrp]/.test(data)) {
      await require('../telegram/commands/mywork').handleCallback(telegramService, chatId, user, data, callbackId);
      return;
    }
    // 📋 메뉴 (v13.305) — 누른 사람의 1:1 대화에서만
    if (action === 'mn') {
      await answer(callbackId, '');
      if (query.message.chat.type !== 'private') return;
      await telegramService.runMenu(parts[1], chatId, user);
      return;
    }
    // 📝 말로 등록 확인 (v13.303) — cp:<ok|x|todo|event|log|ask>:<키>
    if (action === 'cp') {
      var mid = query.message.message_id;
      var toast = await require('../telegram/compose').onButton({
        chatId: chatId, user: user, messageId: mid, action: parts[1], key: parts[2],
        send: telegramService.sendMessage,
        edit: function (text, markup) {
          return telegramService.callApi('editMessageText', {
            chat_id: chatId, message_id: mid, text: text, parse_mode: 'HTML',
            reply_markup: markup ? JSON.stringify(markup) : JSON.stringify({ inline_keyboard: [] })
          });
        },
        run: telegramService.composeRun()
      });
      await answer(callbackId, toast);
      return;
    }

    var out = null;
    if (action === 'issue_start') out = await tgActions.issueStatus(user, parts[1], 'inProgress');
    else if (action === 'issue_resolve') out = await tgActions.issueStatus(user, parts[1], 'resolved');
    else if (action === 'issue_urgent') out = await tgActions.issueUrgent(user, parts[1]);
    else if (action === 'checklist_done') out = await tgActions.checklistDone(user, parts[1], parseInt(parts[2], 10));
    else if (action === 'dev_start') out = await tgActions.devStart(user, parts[1]);
    else if (action === 'action_done') out = await tgActions.actionDone(user, parts[1]);
    else if (action === 'asg_start') out = await tgActions.asAssign(user, parts[1], 'start');
    else if (action === 'asg_done') out = await tgActions.asAssign(user, parts[1], 'done');
    if (out) {
      await answer(callbackId, out.toast);
      if (out.text) await telegramService.sendMessage(chatId, out.text);
      return;
    }

    if (action === 'approve_user' || action === 'reject_user') {
      if (user.role !== 'admin') {
        await answer(callbackId, '관리자만 처리할 수 있습니다.');
        return;
      }
      var approve = action === 'approve_user';
      // 테넌트 격리 + 대기 중인 사람만 (이미 처리된 것은 그대로)
      var ur = await db.query(
        approve
          ? "UPDATE users SET status = 'active', role = 'member', approved_by = $1, approved_at = NOW(), updated_at = NOW() WHERE id = $2 AND status = 'pending' AND tenant_id = $3 RETURNING name"
          : "UPDATE users SET status = 'rejected', approved_by = $1, approved_at = NOW(), updated_at = NOW() WHERE id = $2 AND status = 'pending' AND tenant_id = $3 RETURNING name",
        [user.user_id, parts[1], user.tenant_id]);
      if (!ur.rows.length) {
        await answer(callbackId, '이미 처리된 가입 요청입니다.');
        return;
      }
      var nm = escHtmlTg(ur.rows[0].name || '?');
      await answer(callbackId, (approve ? '✅ 승인: ' : '❌ 반려: ') + ur.rows[0].name);
      await telegramService.sendMessage(chatId, approve ? '✅ <b>' + nm + '</b>님의 가입을 승인했습니다.' : '❌ <b>' + nm + '</b>님의 가입을 반려했습니다.');
      return;
    }

    if (action === 'vote') {
      // vote:{voteId}:{optionIndex} — DB(telegram_votes) 기반 영속 투표
      var voteId = parts[1];
      var optIdx = parseInt(parts[2], 10);
      if (!voteId || isNaN(optIdx)) {
        await answer(callbackId, '잘못된 투표 형식');
        return;
      }
      // 테넌트 격리: 다른 테넌트 투표 접근 차단
      var vR = await db.query(
        "SELECT question, options, is_closed, chat_id, message_id FROM telegram_votes WHERE id = $1 AND tenant_id = $2",
        [voteId, user.tenant_id]
      );
      if (vR.rows.length === 0) {
        await answer(callbackId, '투표를 찾을 수 없습니다.');
        return;
      }
      if (vR.rows[0].is_closed) {
        await answer(callbackId, '종료된 투표입니다.');
        return;
      }
      var options = vR.rows[0].options;
      if (typeof options === 'string') options = JSON.parse(options);
      if (optIdx < 0 || optIdx >= options.length) {
        await answer(callbackId, '잘못된 옵션');
        return;
      }
      // 1인 1표(같은 vote 내 갱신) — UNIQUE(vote_id, user_id)
      await db.query(
        "INSERT INTO telegram_vote_responses (vote_id, user_id, user_name, option_index) VALUES ($1, $2, $3, $4) ON CONFLICT (vote_id, user_id) DO UPDATE SET option_index = $4, voted_at = NOW()",
        [voteId, user.user_id, user.name, optIdx]
      );
      var aggR = await db.query(
        "SELECT option_index, COUNT(*)::int AS c FROM telegram_vote_responses WHERE vote_id = $1 GROUP BY option_index",
        [voteId]
      );
      var counts = {};
      aggR.rows.forEach(function (row) { counts[row.option_index] = row.c; });
      var keyboard = options.map(function (opt, i) {
        return [{ text: opt + ' (' + (counts[i] || 0) + ')', callback_data: 'vote:' + voteId + ':' + i }];
      });
      if (vR.rows[0].message_id) {
        await telegramService.callApi('editMessageReplyMarkup', {
          chat_id: vR.rows[0].chat_id,
          message_id: vR.rows[0].message_id,
          reply_markup: { inline_keyboard: keyboard }
        });
      }
      await answer(callbackId, '✅ 투표 완료');
      return;
    }

    await answer(callbackId, '알 수 없는 버튼입니다');
  } catch (err) {
    console.error('[Callback]', err.message);
    await answer(callbackId, '처리하지 못했습니다. 잠시 후 다시 눌러 주세요.');
  }
}

/**
 * POST /api/telegram/webhook
 * Telegram이 호출하는 Webhook 엔드포인트 (인증 불필요)
 */
router.post('/webhook', function (req, res) {
  // 비밀값 검사 — 환경변수가 없어도 봇 토큰에서 만든 값으로 (v13.301, telegram.service.webhookSecret)
  if (telegramService.secretActive()) {
    var token = req.headers['x-telegram-bot-api-secret-token'];
    if (token !== telegramService.webhookSecret()) {
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
    httpErr.serverError(res, '[Telegram] status error:', err, '상태 조회 실패');
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
    httpErr.serverError(res, '[Telegram] unlink error:', err, '연동 해제 실패');
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
    var lk = await db.query('SELECT remind_lead, rec_slots, quiet_start, quiet_end FROM telegram_links WHERE user_id = $1 AND is_active = TRUE LIMIT 1', [req.user.sub]);
    var l0 = lk.rows[0] || {};
    res.json({ data: prefs, remindLead: lk.rows.length ? l0.remind_lead : 30, recSlots: lk.rows.length ? l0.rec_slots : null, quietStart: l0.quiet_start || '', quietEnd: l0.quiet_end || '' });
  } catch (err) {
    httpErr.serverError(res, '[telegram]', err, '설정 조회 실패');
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
    httpErr.serverError(res, '[telegram]', err, '설정 변경 실패');
  }
});

/** PUT /api/telegram/prefs/lead — { minutes: 10 | 30 | 60 } 일정 · 할 일 미리 알림 시점 (v13.256) */
router.put('/prefs/lead', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
  try {
    var m = parseInt(req.body && req.body.minutes, 10);
    if ([10, 30, 60].indexOf(m) < 0) return res.status(400).json({ error: 'BAD_REQUEST', message: '10 · 30 · 60 분 중 하나' });
    var r = await db.query('UPDATE telegram_links SET remind_lead = $1 WHERE user_id = $2 RETURNING user_id', [m, req.user.sub]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '텔레그램 연동이 없습니다.' });
    res.json({ data: { remindLead: m } });
  } catch (err) {
    httpErr.serverError(res, '[telegram]', err, '설정 변경 실패');
  }
});

/** PUT /api/telegram/prefs/rec — { slots: '10:00,13:30' | '' (끄기) } 💡 내 업무 추천 받을 시각 (v13.274, 평일) */
router.put('/prefs/rec', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
  try {
    var raw = req.body && req.body.slots;
    var slots = raw === '' || raw === null ? '' : require('../telegram/commands/mywork').parseSlots(String(raw || ''));
    if (slots === null) return res.status(400).json({ error: 'BAD_REQUEST', message: '시각이 맞지 않습니다 (07:00~21:55, 5분 단위, 4개까지).' });
    var r = await db.query('UPDATE telegram_links SET rec_slots = $1 WHERE user_id = $2 AND is_active = TRUE RETURNING user_id', [slots, req.user.sub]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '텔레그램 연동이 없습니다.' });
    res.json({ data: { recSlots: slots } });
  } catch (err) {
    httpErr.serverError(res, '[telegram]', err, '설정 변경 실패');
  }
});

/** POST /api/telegram/mywork-send — { kind: 'rec' | 'list' } 내 업무 추천 · 목록을 지금 텔레그램으로 (연동 확인 겸, v13.274) */
router.post('/mywork-send', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
  try {
    if (!telegramService.isConfigured()) return res.status(503).json({ error: 'NOT_CONFIGURED', message: '서버에 텔레그램 봇이 설정되어 있지 않습니다.' });
    var kind = (req.body && req.body.kind) === 'list' ? 'list' : 'rec';
    var r = await db.query('SELECT tl.chat_id, tl.user_id, tl.tenant_id, u.name, u.role, u.department_id FROM telegram_links tl JOIN users u ON u.id = tl.user_id WHERE tl.user_id = $1 AND tl.is_active = TRUE LIMIT 1', [req.user.sub]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_LINKED', message: '텔레그램 연동이 없습니다 — 프로필 → 텔레그램 연동에서 먼저 연결하세요.' });
    var u = r.rows[0];
    var cmds = require('../telegram/commands/mywork').create(telegramService.sendMessage);
    var out = kind === 'list' ? await cmds.cmdMyWork(u.chat_id, u, '') : await cmds.cmdRec(u.chat_id, u, '');
    if (out && out.ok === false) return res.status(502).json({ error: 'TELEGRAM_FAILED', message: '텔레그램이 받지 않았습니다 — ' + (out.description || '봇을 차단했거나 대화가 끊겼을 수 있습니다') });
    res.json({ data: { sent: true, kind: kind } });
  } catch (err) {
    httpErr.serverError(res, '[telegram/mywork-send]', err, '보내지 못했습니다');
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
      result.webhookSetup = await telegramService.setWebhook();   // 비밀값 · 명령 목록 함께

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
      webhookSecret: config.telegram.webhookSecret ? '****' + config.telegram.webhookSecret.slice(-4) : (telegramService.secretActive() ? '(봇 토큰에서 자동 생성 — 사용 중)' : '(자동 생성 — 웹훅 재등록 후 사용)')
    };

    // 테이블 존재 여부
    try {
      await db.query('SELECT 1 FROM telegram_links WHERE tenant_id = $1 LIMIT 0', [req.tenant.id]);
      result.tables = 'OK';
    } catch (e) {
      console.error('[telegram/status/tables]', e); result.tables = 'ERROR';
    }

    // 발송 메트릭 (notification_logs 기반 — 테넌트 격리)
    try {
      result.metrics = await telegramService.getMetrics(req.tenant.id);
    } catch (e) {
      console.error('[telegram/status/metrics]', e); result.metrics = { error: 'unavailable' };
    }

    res.json({ data: result });
  } catch (err) {
    httpErr.serverError(res, '[telegram]', err, '서버 오류가 발생했습니다.');
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
    httpErr.serverError(res, '[telegram]', err, '서버 오류가 발생했습니다.');
  }
});

/** PUT /api/telegram/prefs/quiet — { start: '22:00', end: '07:00' } · 둘 다 '' 이면 끔 (v13.305)
 *  방해 금지 시간에는 알림이 소리 없이 온다 (빠지지는 않음) */
router.put('/prefs/quiet', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
  try {
    var b = req.body || {};
    var st = String(b.start || ''), en = String(b.end || '');
    var hm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!(st === '' && en === '') && !(hm.test(st) && hm.test(en) && st !== en)) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: '시작 · 끝 시각을 HH:MM 으로 (서로 다르게) 넣거나 둘 다 비우세요.' });
    }
    var r = await db.query('UPDATE telegram_links SET quiet_start = $1, quiet_end = $2 WHERE user_id = $3 AND is_active = TRUE RETURNING user_id', [st || null, en || null, req.user.sub]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '텔레그램 연동이 없습니다.' });
    res.json({ data: { quietStart: st, quietEnd: en } });
  } catch (err) {
    httpErr.serverError(res, '[telegram/quiet]', err, '설정 변경 실패');
  }
});

/* ── 그룹방 = 프로젝트방 (v13.304) ── 프로젝트 편집권(관리자 · 임원 · 생성자 · 참여자)이 있어야 연결 · 해제 */
var pa = require('../lib/project-access');

/** POST /api/telegram/group-code { projectId } → { code, link } — 봇을 그룹에 추가하면서 연결하는 링크 (30분) */
router.post('/group-code', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
  try {
    if (!telegramService.isConfigured()) return res.status(503).json({ error: 'TELEGRAM_NOT_CONFIGURED', message: '텔레그램 봇이 설정되지 않았습니다.' });
    var pid = req.body && (req.body.projectId || req.body.project_id);
    if (!await pa.gateEdit(req, res, pid, '프로젝트 참여자 · 관리자만 그룹방을 연결할 수 있습니다.')) return;
    var pr = await db.query('SELECT name FROM projects WHERE id = $1 AND tenant_id = $2', [pid, req.tenant.id]);
    var code = await require('../telegram/refs').putGroupCode({ tenantId: req.tenant.id, userId: req.user.sub }, pid, pr.rows.length ? pr.rows[0].name : '');
    var bot = config.telegram.botUsername;
    res.json({ data: {
      code: code, botUsername: bot || null, expiresInSeconds: 1800,
      link: bot ? 'https://t.me/' + bot + '?startgroup=' + code : null
    } });
  } catch (err) {
    httpErr.serverError(res, '[telegram/group-code]', err, '연결 코드를 만들지 못했습니다');
  }
});

/** GET /api/telegram/groups?projectId= — 이 프로젝트에 연결된 그룹방 (볼 수 있는 사람) */
router.get('/groups', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
  try {
    var pid = req.query.projectId;
    if (!await pa.gateRead(req, res, pid)) return;
    var r = await db.query(
      "SELECT g.id, g.title, g.linked_at, u.name AS linked_by_name FROM telegram_group_links g LEFT JOIN users u ON u.id = g.linked_by " +
      "WHERE g.tenant_id = $1 AND g.link_type = 'project' AND g.link_id = $2 AND g.is_active = TRUE ORDER BY g.linked_at",
      [req.tenant.id, pid]);
    var canEdit = await pa.canEditById(req, pid);
    res.json({ data: r.rows, canEdit: !!canEdit, configured: telegramService.isConfigured() });
  } catch (err) {
    httpErr.serverError(res, '[telegram/groups]', err);
  }
});

/** DELETE /api/telegram/groups/:id?projectId= — 연결 해제 (편집권) */
router.delete('/groups/:id', authenticate, tenant.tenantScope, planGate('telegram'), async function (req, res) {
  try {
    var g = await db.query("SELECT id, link_id, chat_id FROM telegram_group_links WHERE id = $1 AND tenant_id = $2 AND link_type = 'project'", [req.params.id, req.tenant.id]);
    if (!g.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!await pa.gateEdit(req, res, g.rows[0].link_id, '프로젝트 참여자 · 관리자만 해제할 수 있습니다.')) return;
    await db.query('DELETE FROM telegram_group_links WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    telegramService.sendMessage(g.rows[0].chat_id, '🔓 웹에서 이 방의 프로젝트 연결을 해제했습니다.').catch(function () {});
    res.json({ data: { removed: true } });
  } catch (err) {
    httpErr.serverError(res, '[telegram/groups/delete]', err);
  }
});

module.exports = router;
module.exports.handleCallbackQuery = handleCallbackQuery;
