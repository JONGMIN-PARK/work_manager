/**
 * Telegram Bot API 서비스
 * - 메시지 발송, Webhook 설정, 봇 명령어 처리
 */
var config = require('../config');
var db = require('../config/db');

var BASE = 'https://api.telegram.org/bot';

function getUrl(method) {
  return BASE + config.telegram.botToken + '/' + method;
}

function isConfigured() {
  return !!config.telegram.botToken;
}

/** Telegram Bot API 호출 */
async function callApi(method, body) {
  if (!isConfigured()) return null;
  var res = await fetch(getUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  var data = await res.json();
  if (!data.ok) {
    console.error('[Telegram] API error:', method, data.description);
  }
  return data;
}

/** 메시지 전송 (MarkdownV2) */
async function sendMessage(chatId, text, opts) {
  return callApi('sendMessage', Object.assign({
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  }, opts || {}));
}

/** Webhook 등록 */
async function setWebhook() {
  if (!config.telegram.webhookUrl) {
    console.log('[Telegram] TELEGRAM_WEBHOOK_URL not set, skipping webhook setup');
    return null;
  }
  var body = { url: config.telegram.webhookUrl };
  if (config.telegram.webhookSecret) {
    body.secret_token = config.telegram.webhookSecret;
  }
  var result = await callApi('setWebhook', body);
  if (result && result.ok) {
    console.log('[Telegram] Webhook registered:', config.telegram.webhookUrl);
  }
  return result;
}

/** 인증코드 생성 (8자리 영숫자) */
function generateAuthCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/** 인증코드 발급 → DB 저장 (5분 만료) */
async function createAuthCode(userId) {
  // 기존 미사용 코드 삭제
  await db.query('DELETE FROM telegram_auth_codes WHERE user_id = $1 AND used = FALSE', [userId]);
  var code = generateAuthCode();
  await db.query(
    'INSERT INTO telegram_auth_codes (code, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'5 minutes\')',
    [code, userId]
  );
  return code;
}

/** 인증코드 검증 + 계정 연동 */
async function verifyAndLink(code, chatId, tgUsername) {
  var r = await db.query(
    'SELECT user_id FROM telegram_auth_codes WHERE code = $1 AND used = FALSE AND expires_at > NOW()',
    [code]
  );
  if (r.rows.length === 0) return { ok: false, reason: 'invalid_or_expired' };

  var userId = r.rows[0].user_id;

  // 코드 사용 처리
  await db.query('UPDATE telegram_auth_codes SET used = TRUE WHERE code = $1', [code]);

  // 기존 연동 해제 (같은 user 또는 같은 chat_id)
  await db.query('DELETE FROM telegram_links WHERE user_id = $1 OR chat_id = $2', [userId, chatId]);

  // 새 연동 저장
  await db.query(
    'INSERT INTO telegram_links (user_id, chat_id, username, is_active) VALUES ($1, $2, $3, TRUE)',
    [userId, chatId, tgUsername || null]
  );

  // 기본 알림 설정 생성
  var defaultEvents = ['issue_assigned', 'issue_status_changed', 'project_delayed', 'deadline_d3', 'deadline_d1', 'deadline_today', 'user_pending'];
  for (var i = 0; i < defaultEvents.length; i++) {
    await db.query(
      'INSERT INTO notification_prefs (user_id, channel, event_type, is_enabled) VALUES ($1, \'telegram\', $2, TRUE) ON CONFLICT (user_id, channel, event_type) DO NOTHING',
      [userId, defaultEvents[i]]
    );
  }

  // 사용자 이름 조회
  var userR = await db.query('SELECT name FROM users WHERE id = $1', [userId]);
  return { ok: true, userId: userId, userName: userR.rows[0] ? userR.rows[0].name : '' };
}

/** 연동 해제 */
async function unlink(userId) {
  await db.query('DELETE FROM telegram_links WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM notification_prefs WHERE user_id = $1 AND channel = \'telegram\'', [userId]);
}

/** 연동 상태 조회 */
async function getLinkStatus(userId) {
  var r = await db.query('SELECT chat_id, username, linked_at, is_active FROM telegram_links WHERE user_id = $1', [userId]);
  return r.rows[0] || null;
}

/** chat_id로 user_id 조회 */
async function getUserByChatId(chatId) {
  var r = await db.query(
    'SELECT tl.user_id, u.name, u.role FROM telegram_links tl JOIN users u ON u.id = tl.user_id WHERE tl.chat_id = $1 AND tl.is_active = TRUE',
    [chatId]
  );
  return r.rows[0] || null;
}

/** 봇 명령어: /my — 오늘 할 일 요약 */
async function cmdMy(chatId, user) {
  var today = new Date().toISOString().slice(0, 10);
  // 미해결 이슈
  var issues = await db.query(
    "SELECT title, urgency, status FROM issues WHERE assignees::text LIKE $1 AND status NOT IN ('resolved','closed') ORDER BY CASE urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END LIMIT 5",
    ['%' + user.name + '%']
  );
  // 임박 납기 (7일 이내)
  var deadlines = await db.query(
    "SELECT name, order_no, end_date FROM projects WHERE (assignees::text LIKE $1 OR created_by = $2) AND end_date BETWEEN $3 AND ($3::date + INTERVAL '7 days')::text AND status != 'done' ORDER BY end_date LIMIT 5",
    ['%' + user.name + '%', user.user_id, today]
  );

  var msg = '📋 <b>' + user.name + '님의 현황</b>\n\n';

  if (issues.rows.length > 0) {
    msg += '🔴 <b>미해결 이슈</b>\n';
    issues.rows.forEach(function (r) {
      var icon = r.urgency === 'urgent' ? '🔴' : r.urgency === 'normal' ? '🟡' : '🟢';
      msg += icon + ' ' + r.title + ' [' + r.status + ']\n';
    });
    msg += '\n';
  } else {
    msg += '✅ 미해결 이슈 없음\n\n';
  }

  if (deadlines.rows.length > 0) {
    msg += '⏰ <b>임박 납기 (7일 이내)</b>\n';
    deadlines.rows.forEach(function (r) {
      msg += '· ' + (r.order_no || '') + ' ' + r.name + ' → ' + r.end_date + '\n';
    });
  } else {
    msg += '📅 임박 납기 없음\n';
  }

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /issues — 미해결 이슈 목록 */
async function cmdIssues(chatId, user) {
  var issues = await db.query(
    "SELECT title, urgency, status, due_date FROM issues WHERE assignees::text LIKE $1 AND status NOT IN ('resolved','closed') ORDER BY CASE urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END LIMIT 10",
    ['%' + user.name + '%']
  );

  if (issues.rows.length === 0) {
    return sendMessage(chatId, '✅ 배정된 미해결 이슈가 없습니다.');
  }

  var msg = '📌 <b>미해결 이슈 (' + issues.rows.length + '건)</b>\n\n';
  issues.rows.forEach(function (r, i) {
    var icon = r.urgency === 'urgent' ? '🔴' : r.urgency === 'normal' ? '🟡' : '🟢';
    msg += (i + 1) + '. ' + icon + ' ' + r.title;
    if (r.due_date) msg += ' (~ ' + r.due_date + ')';
    msg += '\n';
  });

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /help */
async function cmdHelp(chatId) {
  var msg = '🤖 <b>Work Manager Bot</b>\n\n' +
    '/my — 오늘 할 일 요약\n' +
    '/issues — 미해결 이슈 목록\n' +
    '/unlink — 텔레그램 연동 해제\n' +
    '/help — 명령어 안내';
  return sendMessage(chatId, msg);
}

/** Webhook으로 들어온 메시지 처리 */
async function handleUpdate(update) {
  if (!update.message || !update.message.text) return;

  var msg = update.message;
  var chatId = msg.chat.id;
  var text = msg.text.trim();
  var tgUsername = msg.from ? msg.from.username : null;

  // /start <인증코드>
  if (text.startsWith('/start')) {
    var parts = text.split(/\s+/);
    if (parts.length < 2) {
      return sendMessage(chatId, '🔗 Work Manager 연동을 시작하려면 웹에서 QR코드를 스캔하거나 인증코드를 입력해주세요.\n\n사용법: /start <인증코드>');
    }
    var code = parts[1].toUpperCase();
    var result = await verifyAndLink(code, chatId, tgUsername);
    if (result.ok) {
      return sendMessage(chatId, '✅ <b>연동 완료!</b>\n\n' + result.userName + '님의 계정과 연결되었습니다.\n업무 알림을 이 채팅으로 받을 수 있습니다.\n\n/help 로 사용 가능한 명령어를 확인하세요.');
    } else {
      return sendMessage(chatId, '❌ 인증코드가 만료되었거나 유효하지 않습니다.\n웹에서 새 코드를 발급받아 주세요.');
    }
  }

  // 연동된 사용자만 사용 가능한 명령어
  var user = await getUserByChatId(chatId);
  if (!user) {
    return sendMessage(chatId, '🔒 먼저 계정 연동이 필요합니다.\n웹 → 프로필 → 텔레그램 연동에서 QR코드를 스캔해주세요.');
  }

  if (text === '/my') return cmdMy(chatId, user);
  if (text === '/issues') return cmdIssues(chatId, user);
  if (text === '/help') return cmdHelp(chatId);

  if (text === '/unlink') {
    await unlink(user.user_id);
    return sendMessage(chatId, '🔓 연동이 해제되었습니다.\n다시 연동하려면 웹에서 QR코드를 스캔해주세요.');
  }

  // 알 수 없는 명령어
  if (text.startsWith('/')) {
    return sendMessage(chatId, '❓ 알 수 없는 명령어입니다.\n/help 로 사용 가능한 명령어를 확인하세요.');
  }
}

module.exports = {
  isConfigured: isConfigured,
  sendMessage: sendMessage,
  setWebhook: setWebhook,
  createAuthCode: createAuthCode,
  verifyAndLink: verifyAndLink,
  unlink: unlink,
  getLinkStatus: getLinkStatus,
  getUserByChatId: getUserByChatId,
  handleUpdate: handleUpdate,
  generateAuthCode: generateAuthCode
};
