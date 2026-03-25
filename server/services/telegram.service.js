/**
 * Telegram Bot API 서비스
 * - 메시지 발송, Webhook 설정, 봇 명령어 처리
 */
var config = require('../config');
var db = require('../config/db');
var aiService = require('./ai.service');

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

/* ── Command modules (lazy-initialized) ── */
var personalCmds, analysisCmds, scheduleCmds, projectCmds, docsCmds, teamCmds, utilityCmds, helpCmds;

function initCommands() {
  if (personalCmds) return;
  personalCmds = require('../telegram/commands/personal').create(sendMessage);
  analysisCmds = require('../telegram/commands/analysis').create(sendMessage);
  scheduleCmds = require('../telegram/commands/schedule').create(sendMessage);
  projectCmds  = require('../telegram/commands/project').create(sendMessage);
  docsCmds     = require('../telegram/commands/docs').create(sendMessage);
  teamCmds     = require('../telegram/commands/team').create(sendMessage);
  utilityCmds  = require('../telegram/commands/utility').create(sendMessage);
  helpCmds     = require('../telegram/commands/help').create(sendMessage);
}

/** 봇 명령어 자동완성 등록 (BotFather 대체) */
async function setMyCommands() {
  var commands = [
    { command: 'today', description: '오늘 브리핑' },
    { command: 'my', description: '내 현황 (이슈+납기)' },
    { command: 'issues', description: '미해결 이슈 목록' },
    { command: 'tasks', description: '미완료 작업' },
    { command: 'done', description: '작업 완료 처리' },
    { command: 'log', description: '업무일지 빠른 등록' },
    { command: 'summary', description: '금주 업무시간 요약' },
    { command: 'report', description: '월간 리포트' },
    { command: 'weekly_report', description: '주간보고 생성' },
    { command: 'my_stats', description: '내 월간 통계' },
    { command: 'overdue', description: '지연/긴급 현황' },
    { command: 'project', description: '프로젝트 현황' },
    { command: 'checklist', description: '체크리스트' },
    { command: 'calendar', description: '이번 주 일정' },
    { command: 'orders', description: '수주 목록' },
    { command: 'order', description: '수주 상세' },
    { command: 'deliveries', description: '납품 예정' },
    { command: 'team', description: '팀원별 금주 투입' },
    { command: 'remind', description: '리마인더 설정' },
    { command: 'vote', description: '팀 투표' },
    { command: 'docs', description: '문서 목록' },
    { command: 'search_doc', description: '문서 검색' },
    { command: 'help', description: '명령어 안내' },
    { command: 'unlink', description: '연동 해제' }
  ];
  var result = await callApi('setMyCommands', { commands: commands });
  if (result && result.ok) {
    console.log('[Telegram] Bot commands registered (' + commands.length + ')');
  } else {
    console.error('[Telegram] Failed to register commands:', result && result.description);
  }
  return result;
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
    // 명령어 자동완성도 등록
    await setMyCommands();
  }
  return result;
}

/* ── Auth layer ── */

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

/* ── Photo → Issue ── */

/** 사진 → 이슈 자동 등록 */
async function handlePhotoIssue(chatId, user, msg) {
  var caption = (msg.caption || '').trim();
  if (!caption) {
    return sendMessage(chatId, '📸 사진과 함께 설명을 입력하면 이슈로 등록됩니다.\n\n예: 사진 + "SK하이닉스 카메라 보정 불량"');
  }

  // 가장 큰 해상도의 사진 file_id
  var photo = msg.photo[msg.photo.length - 1];
  var fileId = photo.file_id;

  // 이슈 생성
  var crypto = require('crypto');
  var issueId = 'iss-' + crypto.randomUUID().slice(0, 12);
  var today = new Date().toISOString().slice(0, 10);

  await db.query(
    "INSERT INTO issues (id, title, description, urgency, status, report_date, reporter, reporter_id, assignees, tags, created_by, updated_by) VALUES ($1, $2, $3, 'normal', 'open', $4, $5, $6, $7, $8, $6, $6)",
    [issueId, caption, '텔레그램 사진 첨부 (file_id: ' + fileId + ')', today, user.name, user.user_id, JSON.stringify([user.name]), JSON.stringify(['telegram', 'photo'])]
  );

  var response = '📸 <b>이슈 등록 완료</b>\n\n' +
    '제목: ' + caption + '\n' +
    '상태: 접수 (open)\n' +
    '긴급도: 보통\n' +
    '등록자: ' + user.name + '\n' +
    '날짜: ' + today;

  return sendMessage(chatId, response, {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [
          { text: '🔴 긴급으로 변경', callback_data: 'issue_urgent:' + issueId },
          { text: '🔵 대응 시작', callback_data: 'issue_start:' + issueId }
        ]
      ]
    })
  });
}

/* ── Message dispatcher ── */

/** Webhook으로 들어온 메시지 처리 */
async function handleUpdate(update) {
  if (!update.message) return;
  if (!update.message.text && !update.message.photo) return;

  var msg = update.message;
  var chatId = msg.chat.id;

  // 사진 → 이슈 등록
  if (msg.photo && msg.photo.length > 0) {
    var user = await getUserByChatId(chatId);
    if (!user) return sendMessage(chatId, '🔒 먼저 계정 연동이 필요합니다.');
    return handlePhotoIssue(chatId, user, msg);
  }

  var text = msg.text || '';
  if (!text) return;
  text = text.trim();
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
      return sendMessage(chatId, '✅ <b>연동 완료!</b>\n\n' +
        result.userName + '님, 환영합니다! 🎉\n\n' +
        '<b>🚀 바로 시작해보세요</b>\n' +
        '/today — 오늘 할 일 한눈에\n' +
        '/issues — 내 이슈 확인\n' +
        '/tasks — 미완료 작업\n\n' +
        '<b>⚡ 빠른 업무 등록</b>\n' +
        '<code>8h D B2024-001 업무내용</code>\n' +
        '→ 바로 업무일지 등록!\n\n' +
        '<b>💬 AI에게 물어보세요</b>\n' +
        '"이번 주 누가 제일 바빠?"\n' +
        '"SK하이닉스 프로젝트 요약해줘"\n\n' +
        '💡 /help 로 전체 명령어, /help log 로 상세 설명');
    } else {
      return sendMessage(chatId, '❌ 인증코드가 만료되었거나 유효하지 않습니다.\n웹에서 새 코드를 발급받아 주세요.');
    }
  }

  // 연동된 사용자만 사용 가능한 명령어
  var user = await getUserByChatId(chatId);
  if (!user) {
    return sendMessage(chatId, '🔒 먼저 계정 연동이 필요합니다.\n웹 → 프로필 → 텔레그램 연동에서 QR코드를 스캔해주세요.');
  }

  // Initialize command modules on first use
  initCommands();

  // Command dispatch
  if (text === '/my') return personalCmds.cmdMy(chatId, user);
  if (text === '/issues') return personalCmds.cmdIssues(chatId, user);
  if (text === '/summary') return analysisCmds.cmdSummary(chatId, user);
  if (text === '/report') return analysisCmds.cmdReport(chatId, user);
  if (text === '/overdue') return analysisCmds.cmdOverdue(chatId, user);
  if (text === '/team') return teamCmds.cmdTeam(chatId, user);
  if (text.startsWith('/project')) {
    var projQuery = text.replace(/^\/project\s*/, '').trim();
    return projectCmds.cmdProject(chatId, user, projQuery || null);
  }
  if (text === '/today') return scheduleCmds.cmdToday(chatId, user);
  if (text.startsWith('/calendar')) {
    var calDays = parseInt(text.replace(/^\/calendar\s*/, '')) || 7;
    return scheduleCmds.cmdCalendar(chatId, user, calDays);
  }
  if (text === '/tasks') return personalCmds.cmdTasks(chatId, user);
  if (text.startsWith('/done')) {
    var doneNum = parseInt(text.replace(/^\/done\s*/, ''));
    return personalCmds.cmdDone(chatId, user, doneNum);
  }
  if (text === '/orders') return scheduleCmds.cmdOrders(chatId, user);
  if (text.startsWith('/order ') && !text.startsWith('/orders')) {
    var orderQuery = text.replace(/^\/order\s+/, '').trim();
    return scheduleCmds.cmdOrder(chatId, user, orderQuery);
  }
  if (text === '/deliveries') return scheduleCmds.cmdDeliveries(chatId, user);
  if (text === '/my-stats' || text === '/mystats' || text === '/my_stats') return personalCmds.cmdMyStats(chatId, user);
  if (text.startsWith('/checklist')) {
    var clQuery = text.replace(/^\/checklist\s*/, '').trim();
    return projectCmds.cmdChecklist(chatId, user, clQuery || null);
  }
  if (text.startsWith('/docs')) {
    var docQuery = text.replace(/^\/docs\s*/, '').trim();
    return docsCmds.cmdDocs(chatId, user, docQuery || null);
  }
  if (text.startsWith('/search-doc') || text.startsWith('/search_doc')) {
    var sdQuery = text.replace(/^\/(search-doc|search_doc)\s*/, '').trim();
    return docsCmds.cmdSearchDoc(chatId, user, sdQuery || null);
  }
  // 업무일지 빠른 등록 (명령어 또는 패턴 매치)
  if (text.startsWith('/log ')) {
    return personalCmds.cmdLog(chatId, user, text.replace(/^\/log\s+/, ''));
  }
  if (/^\d+\.?\d*\s*h\s+[ABDGMRS]/i.test(text)) {
    return personalCmds.cmdLog(chatId, user, text);
  }
  if (text.startsWith('/remind ')) {
    return utilityCmds.cmdRemind(chatId, user, text.replace(/^\/remind\s+/, ''));
  }
  if (text.startsWith('/vote')) {
    var voteText = text.replace(/^\/vote\s*/, '').trim();
    return utilityCmds.cmdVote(chatId, user, voteText);
  }
  if (text === '/weekly-report' || text === '/weeklyreport' || text === '/weekly_report') {
    return analysisCmds.cmdWeeklyReport(chatId, user);
  }
  if (text === '/help' || text.startsWith('/help ')) {
    var helpArg = text.replace(/^\/help\s*/, '').trim();
    return helpCmds.cmdHelp(chatId, helpArg || null);
  }

  if (text === '/unlink') {
    await unlink(user.user_id);
    return sendMessage(chatId, '🔓 연동이 해제되었습니다.\n다시 연동하려면 웹에서 QR코드를 스캔해주세요.');
  }

  // 그룹 채팅방 연동 (관리자 전용)
  if (text.startsWith('/linkgroup') && msg.chat.type !== 'private') {
    if (user.role !== 'admin' && user.role !== 'manager') {
      return sendMessage(chatId, '🔒 관리자/팀장만 그룹 연동이 가능합니다.');
    }
    var lgParts = text.replace(/^\/linkgroup\s*/, '').trim().split(/\s+/);
    var lgType = lgParts[0] || '';
    var lgId = lgParts[1] || '';
    if (!lgType || !['project', 'team', 'announce'].includes(lgType)) {
      return sendMessage(chatId, '사용법: /linkgroup project &lt;프로젝트ID&gt;\n/linkgroup team &lt;부서ID&gt;\n/linkgroup announce');
    }
    try {
      await db.query('DELETE FROM telegram_group_links WHERE chat_id = $1', [chatId]);
      await db.query(
        'INSERT INTO telegram_group_links (chat_id, link_type, link_id, linked_by) VALUES ($1, $2, $3, $4)',
        [chatId, lgType, lgId || null, user.user_id]
      );
      return sendMessage(chatId, '✅ 그룹 연동 완료! (' + lgType + (lgId ? ': ' + lgId : '') + ')');
    } catch (e) {
      return sendMessage(chatId, '❌ 그룹 연동 실패: ' + e.message);
    }
  }

  if (text === '/unlinkgroup' && msg.chat.type !== 'private') {
    await db.query('DELETE FROM telegram_group_links WHERE chat_id = $1', [chatId]);
    return sendMessage(chatId, '🔓 그룹 연동이 해제되었습니다.');
  }

  // 알 수 없는 명령어
  if (text.startsWith('/')) {
    return sendMessage(chatId, '❓ 알 수 없는 명령어입니다.\n/help 로 사용 가능한 명령어를 확인하세요.');
  }

  // 자연어 → 명령어 매핑
  var nlMap = [
    { patterns: [/내\s*이슈/, /이슈\s*보여/, /이슈\s*목록/, /이슈\s*뭐/], cmd: function() { return personalCmds.cmdIssues(chatId, user); } },
    { patterns: [/내\s*현황/, /나\s*현황/, /내\s*상태/], cmd: function() { return personalCmds.cmdMy(chatId, user); } },
    { patterns: [/오늘\s*일정/, /오늘\s*뭐/, /오늘\s*브리핑/], cmd: function() { return scheduleCmds.cmdToday(chatId, user); } },
    { patterns: [/할\s*일/, /미완료/, /남은\s*작업/], cmd: function() { return personalCmds.cmdTasks(chatId, user); } },
    { patterns: [/이번\s*주\s*일정/, /주간\s*일정/, /캘린더/], cmd: function() { return scheduleCmds.cmdCalendar(chatId, user, 7); } },
    { patterns: [/수주\s*목록/, /수주\s*현황/, /수주\s*보여/], cmd: function() { return scheduleCmds.cmdOrders(chatId, user); } },
    { patterns: [/납품\s*예정/, /납품\s*일정/], cmd: function() { return scheduleCmds.cmdDeliveries(chatId, user); } },
    { patterns: [/주간\s*보고/, /주간\s*리포트/], cmd: function() { return analysisCmds.cmdWeeklyReport(chatId, user); } },
    { patterns: [/월간\s*보고/, /월간\s*리포트/, /월간\s*통계/], cmd: function() { return analysisCmds.cmdReport(chatId, user); } },
    { patterns: [/내\s*통계/, /나\s*통계/, /개인\s*통계/], cmd: function() { return personalCmds.cmdMyStats(chatId, user); } },
    { patterns: [/지연/, /긴급\s*현황/, /오버듀/], cmd: function() { return analysisCmds.cmdOverdue(chatId, user); } },
    { patterns: [/팀\s*현황/, /팀원\s*투입/, /누가\s*바빠/], cmd: function() { return teamCmds.cmdTeam(chatId, user); } },
    { patterns: [/도움말/, /명령어\s*목록/, /뭐\s*할\s*수/, /사용법/], cmd: function() { return helpCmds.cmdHelp(chatId, null); } }
  ];

  for (var ni = 0; ni < nlMap.length; ni++) {
    var nl = nlMap[ni];
    for (var pi = 0; pi < nl.patterns.length; pi++) {
      if (nl.patterns[pi].test(text)) {
        return nl.cmd();
      }
    }
  }

  // 일반 텍스트 → AI 자연어 질답
  if (text.length >= 2) {
    await sendMessage(chatId, '🤖 분석 중...');
    try {
      var answer = await aiService.answerQuestion(text, user.name);
      return sendMessage(chatId, answer);
    } catch (aiErr) {
      console.error('[AI] Error:', aiErr.message);
      return sendMessage(chatId, '🤖 AI 응답 생성에 실패했습니다.\n' + aiErr.message);
    }
  }
}

module.exports = {
  isConfigured: isConfigured,
  sendMessage: sendMessage,
  setWebhook: setWebhook,
  setMyCommands: setMyCommands,
  createAuthCode: createAuthCode,
  verifyAndLink: verifyAndLink,
  unlink: unlink,
  getLinkStatus: getLinkStatus,
  getUserByChatId: getUserByChatId,
  handleUpdate: handleUpdate,
  generateAuthCode: generateAuthCode,
  cmdCalendar: function(chatId, user, days) { initCommands(); return scheduleCmds.cmdCalendar(chatId, user, days); },
  cmdToday: function(chatId, user) { initCommands(); return scheduleCmds.cmdToday(chatId, user); },
  cmdTasks: function(chatId, user) { initCommands(); return personalCmds.cmdTasks(chatId, user); },
  cmdDone: function(chatId, user, num) { initCommands(); return personalCmds.cmdDone(chatId, user, num); },
  cmdOrders: function(chatId, user) { initCommands(); return scheduleCmds.cmdOrders(chatId, user); },
  cmdOrder: function(chatId, user, q) { initCommands(); return scheduleCmds.cmdOrder(chatId, user, q); },
  cmdDeliveries: function(chatId, user) { initCommands(); return scheduleCmds.cmdDeliveries(chatId, user); },
  cmdMyStats: function(chatId, user) { initCommands(); return personalCmds.cmdMyStats(chatId, user); },
  cmdChecklist: function(chatId, user, q) { initCommands(); return projectCmds.cmdChecklist(chatId, user, q); },
  cmdDocs: function(chatId, user, q) { initCommands(); return docsCmds.cmdDocs(chatId, user, q); },
  cmdSearchDoc: function(chatId, user, q) { initCommands(); return docsCmds.cmdSearchDoc(chatId, user, q); },
  cmdLog: function(chatId, user, t) { initCommands(); return personalCmds.cmdLog(chatId, user, t); },
  cmdRemind: function(chatId, user, t) { initCommands(); return utilityCmds.cmdRemind(chatId, user, t); },
  cmdVote: function(chatId, user, t) { initCommands(); return utilityCmds.cmdVote(chatId, user, t); },
  cmdWeeklyReport: function(chatId, user) { initCommands(); return analysisCmds.cmdWeeklyReport(chatId, user); }
};
