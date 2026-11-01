/**
 * Telegram Bot API 서비스
 * - 메시지 발송, Webhook 설정, 봇 명령어 처리
 */
var config = require('../config');
var db = require('../config/db');
var aiService = require('./ai.service');
var escHtml = require('../telegram/util/escape').escHtml;

var BASE = 'https://api.telegram.org/bot';

function getUrl(method) {
  return BASE + config.telegram.botToken + '/' + method;
}

function isConfigured() {
  return !!config.telegram.botToken;
}

/** Telegram Bot API 호출 (429 retry-after / 5xx 백오프 1회 재시도) */
async function callApi(method, body, _retry) {
  if (!isConfigured()) return null;
  var res = await fetch(getUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  var data = await res.json();
  if (!data.ok) {
    // 429 Too Many Requests — retry_after 만큼 대기 후 1회 재시도
    if (res.status === 429 && data.parameters && data.parameters.retry_after && !_retry) {
      var wait = Math.min(parseInt(data.parameters.retry_after) || 1, 30) * 1000;
      await new Promise(function (r) { setTimeout(r, wait); });
      return callApi(method, body, true);
    }
    // 5xx — 짧은 백오프 1회 재시도
    if (res.status >= 500 && res.status < 600 && !_retry) {
      await new Promise(function (r) { setTimeout(r, 500); });
      return callApi(method, body, true);
    }
    console.error('[Telegram] API error:', method, data.description || ('HTTP ' + res.status));
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
var menuCmds, myWorkCmds, personalCmds, analysisCmds, scheduleCmds, projectCmds, docsCmds, teamCmds, utilityCmds, helpCmds, weeklyCmds, pmextCmds, techCmds;

function initCommands() {
  if (personalCmds) return;
  personalCmds = require('../telegram/commands/personal').create(sendMessage);
  myWorkCmds   = require('../telegram/commands/mywork').create(sendMessage);
  analysisCmds = require('../telegram/commands/analysis').create(sendMessage);
  scheduleCmds = require('../telegram/commands/schedule').create(sendMessage);
  projectCmds  = require('../telegram/commands/project').create(sendMessage);
  docsCmds     = require('../telegram/commands/docs').create(sendMessage);
  teamCmds     = require('../telegram/commands/team').create(sendMessage);
  utilityCmds  = require('../telegram/commands/utility').create(sendMessage);
  helpCmds     = require('../telegram/commands/help').create(sendMessage);
  weeklyCmds   = require('../telegram/commands/weekly').create(sendMessage);
  pmextCmds    = require('../telegram/commands/pmext').create(sendMessage);
  techCmds     = require('../telegram/commands/tech').create(sendMessage);
  menuCmds     = require('../telegram/commands/menu').create(sendMessage);
}

/** 봇 명령어 자동완성 등록 (BotFather 대체) */
async function setMyCommands() {
  // v13.305: 자주 쓰는 것만 (예전 44개는 고르기 어려웠다). 나머지는 /menu · /help 에서. 그룹방은 그룹 전용 목록
  var commands = [
    { command: 'menu', description: '📋 버튼 메뉴' },
    { command: 'today', description: '오늘 브리핑' },
    { command: 'mywork', description: '🎯 내 업무 (지연 · 오늘 · 이번 주)' },
    { command: 'rec', description: '💡 지금 하면 좋은 일' },
    { command: 'todo', description: '할 일 등록 (내일 14:00 !긴급 …)' },
    { command: 'todos', description: '내 할 일 목록' },
    { command: 'event', description: '일정 등록 (#회의 금요일 3시 …)' },
    { command: 'log', description: '업무일지 (8h D B2024-001 내용)' },
    { command: 'issues', description: '내 이슈' },
    { command: 'myproj', description: '📁 내 프로젝트' },
    { command: 'overdue', description: '지연 · 긴급 현황' },
    { command: 'summary', description: '이번 주 업무시간' },
    { command: 'help', description: '전체 명령어' }
  ];
  var groupCommands = [
    { command: 'project', description: '이 프로젝트 요약' },
    { command: 'issues', description: '이 프로젝트 열린 이슈' },
    { command: 'vote', description: '투표 (질문 + 줄마다 선택지)' },
    { command: 'closevote', description: '투표 종료' },
    { command: 'help', description: '그룹방 명령' }
  ];
  await callApi('setMyCommands', { commands: groupCommands, scope: { type: 'all_group_chats' } });
  var result = await callApi('setMyCommands', { commands: commands });
  if (result && result.ok) {
    console.log('[Telegram] Bot commands registered (' + commands.length + ')');
  } else {
    console.error('[Telegram] Failed to register commands:', result && result.description);
  }
  return result;
}

/**
 * 웹훅 비밀값 (v13.301) — TELEGRAM_WEBHOOK_SECRET 이 없으면 봇 토큰에서 만든다.
 * 예전엔 비밀값이 없으면 누구나 /webhook 에 가짜 메시지를 보내 연동된 직원 행세를 할 수 있었다.
 * 만든 값은 setWebhook 이 성공해 텔레그램이 그 값을 붙여 보내기 시작한 뒤에만 검사한다 (secretActive).
 */
var _secretRegistered = false;
function webhookSecret() {
  if (config.telegram.webhookSecret) return config.telegram.webhookSecret;
  if (!config.telegram.botToken) return '';
  return require('crypto').createHash('sha256').update('wm-telegram-webhook:' + config.telegram.botToken).digest('hex').slice(0, 48);
}
function secretActive() { return !!config.telegram.webhookSecret || _secretRegistered; }

/** Webhook 등록 */
async function setWebhook() {
  if (!config.telegram.webhookUrl) {
    console.log('[Telegram] TELEGRAM_WEBHOOK_URL not set, skipping webhook setup');
    return null;
  }
  var body = { url: config.telegram.webhookUrl, secret_token: webhookSecret(), allowed_updates: ['message', 'callback_query'] };
  var result = await callApi('setWebhook', body);
  if (result && result.ok) {
    _secretRegistered = true;
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

/** 인증코드 발급 → DB 저장 (5분 만료) — tenant_id 전파 */
async function createAuthCode(userId) {
  // 기존 미사용 코드 삭제
  await db.query('DELETE FROM telegram_auth_codes WHERE user_id = $1 AND used = FALSE', [userId]);
  // 멀티테넌트 격리: 사용자의 tenant_id 조회 후 함께 저장
  var uR = await db.query('SELECT tenant_id FROM users WHERE id = $1', [userId]);
  var tenantId = uR.rows.length ? uR.rows[0].tenant_id : null;
  var code = generateAuthCode();
  await db.query(
    "INSERT INTO telegram_auth_codes (code, user_id, tenant_id, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')",
    [code, userId, tenantId]
  );
  return code;
}

/** 인증코드 검증 + 계정 연동 — tenant_id 전파 */
async function verifyAndLink(code, chatId, tgUsername) {
  var r = await db.query(
    'SELECT user_id, tenant_id FROM telegram_auth_codes WHERE code = $1 AND used = FALSE AND expires_at > NOW()',
    [code]
  );
  if (r.rows.length === 0) return { ok: false, reason: 'invalid_or_expired' };

  var userId = r.rows[0].user_id;
  var tenantId = r.rows[0].tenant_id;

  // 코드 사용 처리
  await db.query('UPDATE telegram_auth_codes SET used = TRUE WHERE code = $1', [code]);

  // 기존 연동 해제 (같은 user 또는 같은 chat_id)
  await db.query('DELETE FROM telegram_links WHERE user_id = $1 OR chat_id = $2', [userId, chatId]);

  // 새 연동 저장 (tenant_id 포함)
  await db.query(
    'INSERT INTO telegram_links (user_id, chat_id, username, tenant_id, is_active) VALUES ($1, $2, $3, $4, TRUE)',
    [userId, chatId, tgUsername || null, tenantId]
  );

  // 기본 알림 설정 생성 (tenant_id 포함)
  var defaultEvents = ['issue_assigned', 'issue_status_changed', 'project_delayed', 'deadline_d3', 'deadline_d1', 'deadline_today', 'user_pending', 'weekly_report_uploaded', 'milestone_progress', 'dev_item_assigned', 'action_item_assigned', 'action_item_due', 'prestudy_assigned', 'prestudy_due', 'prestudy_won', 'tech_assigned', 'tech_log_added', 'tech_status_changed', 'tech_stale'];
  for (var i = 0; i < defaultEvents.length; i++) {
    await db.query(
      "INSERT INTO notification_prefs (user_id, tenant_id, channel, event_type, is_enabled) VALUES ($1, $2, 'telegram', $3, TRUE) ON CONFLICT (user_id, channel, event_type) DO NOTHING",
      [userId, tenantId, defaultEvents[i]]
    );
  }

  // 사용자 이름 조회
  var userR = await db.query('SELECT name FROM users WHERE id = $1', [userId]);
  return { ok: true, userId: userId, userName: userR.rows[0] ? userR.rows[0].name : '' };
}

/** 연동 해제 */
async function unlink(userId) {
  // 알림 설정은 남겨 둔다 — 다시 연결하면 예전 설정 그대로 (예전엔 지워져 처음 상태로 돌아갔다)
  await db.query('DELETE FROM telegram_links WHERE user_id = $1', [userId]);
}

/** 연동 상태 조회 */
async function getLinkStatus(userId) {
  var r = await db.query('SELECT chat_id, username, linked_at, is_active FROM telegram_links WHERE user_id = $1', [userId]);
  return r.rows[0] || null;
}

/** chat_id로 user_id 조회 — tenant_id 포함 반환 */
async function getUserByChatId(chatId) {
  var r = await db.query(
    'SELECT tl.user_id, tl.tenant_id, u.name, u.role, u.department_id FROM telegram_links tl JOIN users u ON u.id = tl.user_id WHERE tl.chat_id = $1 AND tl.is_active = TRUE',
    [chatId]
  );
  return r.rows[0] || null;
}

/* ── 메시지 처리 (v13.301 다시 짬) ──
 * 사람 확인은 보낸 사람(from.id)으로 — 예전엔 대화방 번호(chat.id)로 찾아 그룹방에서는 아무 명령도 안 됐다.
 * 1:1 대화: 답장 → 명령 → 자연어 바로가기 → 말로 등록(②) → AI 질답
 * 그룹방: telegram/group.js (프로젝트방)
 */
var BOT_SUFFIX_RE = /^(\/[A-Za-z0-9_가-힣]+)@[A-Za-z0-9_]+/;

/** "/help@MyBot 인자" → "/help 인자" */
function stripBotName(text) {
  return String(text || '').replace(BOT_SUFFIX_RE, '$1');
}

var AI_ERR_SHOW = { CREDIT_LOW: 1, AI_KEY_INVALID: 1, AI_OVERLOADED: 1 };
function aiErrText(e) {
  if (e && AI_ERR_SHOW[e.code]) return '🤖 ' + escHtml(e.message);
  return '🤖 AI 응답을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

/** AI 한도 확인 (월 · 시간당) → 막히면 안내 문구, 통과하면 null */
async function aiGate(user) {
  var aiUsage = require('../lib/ai-usage');
  if (!aiUsage.takeHourly(user.user_id)) return '⏳ AI 질문은 한 시간에 ' + aiUsage.HOURLY + '번까지입니다. 잠시 후 다시 물어보세요.';
  var q = await aiUsage.checkQuota(user.tenant_id);
  if (!q.ok) return '🤖 ' + escHtml(q.message);
  return null;
}

/** AI 질답 — 웹과 같은 권한 범위 · 같은 한도 · 사용량 기록 */
async function askAi(chatId, user, text) {
  var blocked = await aiGate(user);
  if (blocked) return sendMessage(chatId, blocked);
  await sendMessage(chatId, '🤖 분석 중...');
  try {
    var answer = await aiService.answerQuestion(text, user);
    require('../lib/ai-usage').logUsage(user.tenant_id, user.user_id, text, 'telegram');
    return sendMessage(chatId, answer);
  } catch (aiErr) {
    console.error('[AI] Error:', aiErr.message);
    return sendMessage(chatId, aiErrText(aiErr));
  }
}

/** 말로 등록 — AI 로 종류 고르기 (한도 안에서만, 아니면 AI 없이 규칙으로) */
async function proposeEntry(chatId, user, text) {
  var compose = require('../telegram/compose');
  var aiProvider = require('./ai-provider');
  var blocked = await aiGate(user);
  return compose.propose({
    chatId: chatId, user: user, text: text, send: sendMessage,
    ai: blocked ? null : async function (prompt) {
      var out = await aiProvider.generateText({ prompt: prompt, tenantId: user.tenant_id, maxTokens: 512, json: true });
      if (out) require('../lib/ai-usage').logUsage(user.tenant_id, user.user_id, '[등록] ' + text, out.provider);
      return out ? out.text : null;
    }
  });
}

/** 말로 등록 확인 버튼이 실제로 부르는 것 */
function composeRun() {
  initCommands();
  return {
    todo: function (chatId, user, t) { return myWorkCmds.cmdTodo(chatId, user, t); },
    event: function (chatId, user, t) { return myWorkCmds.cmdEvent(chatId, user, t); },
    log: function (chatId, user, e) { return personalCmds.logEntry(chatId, user, e); },
    ask: function (chatId, user, t) { return askAi(chatId, user, t); }
  };
}

/** 메뉴 버튼(mn:키) → 명령 */
function runMenu(key, chatId, user) {
  initCommands();
  switch (key) {
    case 'mywork': return myWorkCmds.cmdMyWork(chatId, user, '');
    case 'rec': return myWorkCmds.cmdRec(chatId, user, '');
    case 'today': return scheduleCmds.cmdToday(chatId, user);
    case 'cal': return scheduleCmds.cmdCalendar(chatId, user, 7);
    case 'todos': return myWorkCmds.cmdTodos(chatId, user);
    case 'myproj': return myWorkCmds.cmdMyProj(chatId, user, '');
    case 'issues': return personalCmds.cmdIssues(chatId, user);
    case 'overdue': return analysisCmds.cmdOverdue(chatId, user);
    case 'summary': return analysisCmds.cmdSummary(chatId, user);
    case 'team': return teamCmds.cmdTeam(chatId, user);
    case 'howto': return sendMessage(chatId, menuCmds.HOWTO);
    case 'help': return helpCmds.cmdHelp(chatId, null);
    case 'menu': return menuCmds.cmdMenu(chatId);
    default: return sendMessage(chatId, '❓ 알 수 없는 메뉴입니다. /menu');
  }
}

/** 음성 메모 → 글 (Gemini). 실패하면 null 과 안내 */
async function voiceToText(chatId, user, msg) {
  var v = msg.voice || msg.audio;
  if (!v) return null;
  if (v.duration && v.duration > 300) { await sendMessage(chatId, '🎙 5분 넘는 음성은 받지 않습니다.'); return null; }
  var blocked = await aiGate(user);
  if (blocked) { await sendMessage(chatId, blocked); return null; }
  try {
    var got = await require('../telegram/files').download(v.file_id);
    var t = await require('./ai-provider').transcribe({ tenantId: user.tenant_id, data: got.buf.toString('base64'), mimeType: v.mime_type || 'audio/ogg' });
    if (!t) { await sendMessage(chatId, '🎙 음성을 글로 바꾸려면 Gemini 키(GEMINI_API_KEY)가 필요합니다.'); return null; }
    require('../lib/ai-usage').logUsage(user.tenant_id, user.user_id, '[음성]', 'gemini');
    if (!t.text) { await sendMessage(chatId, '🎙 알아듣지 못했습니다. 다시 말씀해 주세요.'); return null; }
    await sendMessage(chatId, '🎙 <i>' + escHtml(t.text) + '</i>');
    return t.text;
  } catch (e) {
    console.error('[Telegram] voice', e.message);
    await sendMessage(chatId, e.code === 'TOO_BIG' ? '🎙 파일이 너무 큽니다 (20MB 이하).' : aiErrText(e));
    return null;
  }
}

/** /start 코드 — 1:1 대화에서만 계정 연동 */
async function handleStart(msg, chatId, text, isPrivate) {
  var parts = text.split(/\s+/);
  if (!isPrivate) {
    if (parts[1] && /^G[0-9A-F]{8}$/i.test(parts[1])) return null;   // 그룹방 연결 코드 → group.js
    // 그룹방에서 계정 코드를 받으면 그 방 전체가 한 사람 계정이 된다 → 거부
    return sendMessage(chatId, '🔒 계정 연동은 봇과의 1:1 대화에서만 할 수 있습니다.');
  }
  if (parts.length < 2) {
    return sendMessage(chatId, '🔗 Work Manager 연동을 시작하려면 웹에서 QR코드를 스캔하거나 인증코드를 입력해주세요.\n\n사용법: /start &lt;인증코드&gt;');
  }
  // 브루트포스 방어: 같은 chat_id가 최근 10분간 실패 5회 이상이면 거부
  var attR = await db.query(
    "SELECT COUNT(*)::int AS c FROM telegram_auth_attempts WHERE chat_id = $1 AND success = FALSE AND attempted_at > NOW() - INTERVAL '10 minutes'",
    [chatId]
  );
  if (attR.rows[0].c >= 5) {
    return sendMessage(chatId, '⏸ 잠시 후 다시 시도해주세요. (10분간 5회 실패)');
  }
  var code = parts[1].toUpperCase();
  var result = await verifyAndLink(code, chatId, msg.from ? msg.from.username : null);
  try {
    await db.query('INSERT INTO telegram_auth_attempts (chat_id, code_input, success) VALUES ($1, $2, $3)', [chatId, code, !!result.ok]);
  } catch (logErr) {
    console.error('[Telegram] auth attempt log error:', logErr.message);
  }
  if (!result.ok) return sendMessage(chatId, '❌ 인증코드가 만료되었거나 유효하지 않습니다.\n웹에서 새 코드를 발급받아 주세요.');
  return sendMessage(chatId, '✅ <b>연동 완료!</b>\n\n' + escHtml(result.userName) + '님, 환영합니다! 🎉\n\n' +
    '<b>📋 /menu</b> — 버튼으로 고르기\n\n' +
    '<b>📝 그냥 말로 쓰세요</b>\n' +
    '"내일 3시 SK 미팅" → 일정 · "금요일까지 견적 회신" → 할 일\n' +
    '"B2024-001 배선 3시간" → 업무일지 (✅ 눌러야 저장)\n\n' +
    '<b>💬 물어보세요</b>\n"이번 주 누가 제일 바빠?"\n\n' +
    '<b>↩️ 알림에 답장</b>하면 이슈 대응 이력 · 쪽지 답장 · 피드백 답글로 남습니다.', { reply_markup: JSON.stringify(require('../telegram/commands/menu').keyboard()) });
}

/** Webhook으로 들어온 메시지 처리 */
async function handleUpdate(update) {
  var msg = update && update.message;
  if (!msg || !msg.chat) return;
  var chatId = msg.chat.id;
  var isPrivate = msg.chat.type === 'private';
  var fromId = msg.from && !msg.from.is_bot ? msg.from.id : null;
  var text = stripBotName(String(msg.text || '').trim());
  var hasFile = !!((msg.photo && msg.photo.length) || msg.document);
  var hasVoice = !!(msg.voice || msg.audio);
  if (!text && !hasFile && !hasVoice && !msg.caption) return;

  if (/^\/start(\s|$)/.test(text)) {
    var st = await handleStart(msg, chatId, text, isPrivate);
    if (st !== null) return st;
  }

  // 보낸 사람 = 연동된 계정 (1:1 대화방 번호 = 그 사람 번호)
  var user = fromId ? await getUserByChatId(fromId) : null;
  initCommands();

  if (!isPrivate) {
    return require('../telegram/group').handle({
      chatId: chatId, user: user, msg: msg, text: text, send: sendMessage,
      cmds: { vote: utilityCmds.cmdVote, closeVote: utilityCmds.cmdCloseVote }
    });
  }

  if (!user) {
    return sendMessage(chatId, '🔒 먼저 계정 연동이 필요합니다.\n웹 → 프로필 → 텔레그램 연동에서 QR코드를 스캔해주세요.');
  }

  // 음성 → 글 (그 글로 아래를 그대로 진행)
  if (hasVoice) {
    var said = await voiceToText(chatId, user, msg);
    if (!said) return;
    text = said;
  }

  // ↩️ 알림에 답장 (명령이 아닌 글 · 사진 · 파일 · 음성)
  if (msg.reply_to_message && text.charAt(0) !== '/') {
    var done = await require('../telegram/reply').handle({ chatId: chatId, user: user, msg: msg, text: text || msg.caption || '', send: sendMessage });
    if (done) return;
  }

  // 사진 · 파일
  if (hasFile && !text) {
    var caption = String(msg.caption || '').trim();
    if (msg.photo && msg.photo.length) {
      if (!caption) return sendMessage(chatId, '📸 사진과 함께 설명을 입력하면 이슈로 등록됩니다.\n\n예: 사진 + "SK하이닉스 카메라 보정 불량"\n<i>알림에 답장으로 보내면 그 이슈에 첨부됩니다.</i>');
      return require('../telegram/group').photoIssue({ chatId: chatId, user: user, msg: msg, send: sendMessage }, null, caption);
    }
    var file = require('../telegram/files').pickFile(msg);
    var saved = await require('../telegram/files').saveToDocs(user, file, null, caption || '텔레그램에서 올림');
    return sendMessage(chatId, saved.ok
      ? '📎 <b>' + escHtml(saved.name) + '</b> — 문서관리(내 문서)에 저장했습니다.\n<i>이슈 알림에 답장으로 보내면 그 이슈에 붙습니다.</i>'
      : '⚠️ ' + require('../telegram/files').failText(saved.reason));
  }

  // Command dispatch
  if (text === '/menu' || text === '/메뉴') return menuCmds.cmdMenu(chatId);
  if (text === '/my') return personalCmds.cmdMy(chatId, user);
  // 내 업무 (v13.253) — /todos 를 /todo 보다 먼저
  if (text === '/todos' || text === '/할일목록') return myWorkCmds.cmdTodos(chatId, user);
  if (text === '/todo' || text.startsWith('/todo ') || text === '/할일' || text.startsWith('/할일 ')) return myWorkCmds.cmdTodo(chatId, user, text.replace(/^\/(todo|할일)\s*/, ''));
  if (text === '/event' || text.startsWith('/event ') || text === '/일정' || text.startsWith('/일정 ')) return myWorkCmds.cmdEvent(chatId, user, text.replace(/^\/(event|일정)\s*/, ''));
  // 내 업무 조회 · 추천 (v13.274)
  if (/^\/(mywork|내업무)(\s|$)/.test(text)) return myWorkCmds.cmdMyWork(chatId, user, text.replace(/^\/(mywork|내업무)\s*/, ''));
  if (/^\/(myproj|내프로젝트)(\s|$)/.test(text)) return myWorkCmds.cmdMyProj(chatId, user, text.replace(/^\/(myproj|내프로젝트)\s*/, ''));
  if (/^\/(board|보드)$/.test(text)) return myWorkCmds.cmdBoard(chatId, user);
  if (/^\/(rec|추천)(\s|$)/.test(text)) return myWorkCmds.cmdRec(chatId, user, text.replace(/^\/(rec|추천)\s*/, ''));
  if (text === '/issues') return personalCmds.cmdIssues(chatId, user);
  if (text === '/summary') return analysisCmds.cmdSummary(chatId, user);
  if (text === '/report') return analysisCmds.cmdReport(chatId, user);
  if (text === '/overdue') return analysisCmds.cmdOverdue(chatId, user);
  if (text === '/team') return teamCmds.cmdTeam(chatId, user);
  if (/^\/project(\s|$)/.test(text)) {
    var projQuery = text.replace(/^\/project\s*/, '').trim();
    return projectCmds.cmdProject(chatId, user, projQuery || null);
  }
  if (text === '/today') return scheduleCmds.cmdToday(chatId, user);
  if (/^\/calendar(\s|$)/.test(text)) {
    var calDays = parseInt(text.replace(/^\/calendar\s*/, '')) || 7;
    return scheduleCmds.cmdCalendar(chatId, user, calDays);
  }
  if (text === '/tasks') return personalCmds.cmdTasks(chatId, user);
  if (/^\/done(\s|$)/.test(text)) {
    var doneNum = parseInt(text.replace(/^\/done\s*/, ''));
    return personalCmds.cmdDone(chatId, user, doneNum);
  }
  if (text === '/orders') return scheduleCmds.cmdOrders(chatId, user);
  if (text.startsWith('/order ')) {
    var orderQuery = text.replace(/^\/order\s+/, '').trim();
    return scheduleCmds.cmdOrder(chatId, user, orderQuery);
  }
  if (text === '/deliveries') return scheduleCmds.cmdDeliveries(chatId, user);
  if (text === '/my-stats' || text === '/mystats' || text === '/my_stats') return personalCmds.cmdMyStats(chatId, user);
  if (/^\/checklist(\s|$)/.test(text)) {
    var clQuery = text.replace(/^\/checklist\s*/, '').trim();
    return projectCmds.cmdChecklist(chatId, user, clQuery || null);
  }
  if (/^\/docs(\s|$)/.test(text)) {
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
  if (/^\d+\.?\d*\s*h\s+[ABDGMRSV](\s|$)/i.test(text)) {
    return personalCmds.cmdLog(chatId, user, text);
  }
  if (text.startsWith('/remind ')) {
    return utilityCmds.cmdRemind(chatId, user, text.replace(/^\/remind\s+/, ''));
  }
  if (text.startsWith('/cancelremind')) {
    return utilityCmds.cmdCancelRemind(chatId, user, text.replace(/^\/cancelremind\s*/, '').trim());
  }
  if (text.startsWith('/closevote')) {
    return utilityCmds.cmdCloseVote(chatId, user, text.replace(/^\/closevote\s*/, '').trim());
  }
  if (/^\/vote(\s|$)/.test(text)) {
    return utilityCmds.cmdVote(chatId, user, text.replace(/^\/vote\s*/, '').trim());
  }
  if (text === '/weekly-report' || text === '/weeklyreport' || text === '/weekly_report') {
    return analysisCmds.cmdWeeklyReport(chatId, user);
  }
  // 주간업무보고(팀) — weekly_reports 테이블 기반
  if (text === '/wr-stats' || text === '/wr_stats' || text === '/wrstats') return weeklyCmds.cmdWeeklyStats(chatId, user);
  if (text === '/wr-me' || text === '/wr_me' || text === '/wrme') return weeklyCmds.cmdWeeklyMine(chatId, user);
  if (text === '/wr' || text.startsWith('/wr ') || text === '/주간업무보고' || text.startsWith('/주간업무보고 ')) {
    var wrArg = text.replace(/^\/(wr|주간업무보고)\s*/, '').trim();
    return weeklyCmds.cmdWeekly(chatId, user, wrArg || null);
  }
  // 프로젝트 진척률 (마일스톤 달성률)
  if (text === '/progress' || text.startsWith('/progress ')) {
    return projectCmds.cmdProgress(chatId, user, text.replace(/^\/progress\s*/, '').trim() || null);
  }
  // 프로젝트 관리 확장 (개발/검토/액션/회의)
  if (text === '/devitems' || text === '/devs' || text === '/dev') return pmextCmds.cmdDevItems(chatId, user);
  if (text === '/prestudy' || text === '/prestudies' || text.startsWith('/prestudy ')) {
    return pmextCmds.cmdPrestudy(chatId, user, text.replace(/^\/prestud(y|ies)\s*/, '').trim() || null);
  }
  if (text === '/actions' || text === '/action') return pmextCmds.cmdActions(chatId, user);
  if (text === '/meeting' || text === '/meetings' || text.startsWith('/meeting ')) {
    return pmextCmds.cmdMeeting(chatId, user, text.replace(/^\/meetings?\s*/, '').trim() || null);
  }
  // 요소기술 — /mytech·/techlog 를 /tech 보다 먼저 매칭(접두어 충돌 방지)
  if (text === '/mytech' || text === '/my-tech' || text === '/my_tech') return techCmds.cmdMyTech(chatId, user);
  if (text === '/techlog' || text.startsWith('/techlog ')) {
    return techCmds.cmdTechLog(chatId, user, text.replace(/^\/techlog\s*/, '').trim() || null);
  }
  if (text === '/tech' || text.startsWith('/tech ')) {
    return techCmds.cmdTech(chatId, user, text.replace(/^\/tech\s*/, '').trim() || null);
  }
  if (text === '/help' || text.startsWith('/help ')) {
    var helpArg = text.replace(/^\/help\s*/, '').trim();
    return helpCmds.cmdHelp(chatId, helpArg || null);
  }

  if (text === '/unlink') {
    await unlink(user.user_id);
    return sendMessage(chatId, '🔓 연동이 해제되었습니다.\n다시 연동하려면 웹에서 QR코드를 스캔해주세요.');
  }
  if (/^\/(linkgroup|unlinkgroup)/.test(text)) {
    return sendMessage(chatId, '👥 그룹방 연결은 그룹방 안에서 합니다 — 웹 프로젝트 화면 → [텔레그램 그룹방 연결]을 누르면 봇을 그룹에 넣는 링크가 나옵니다.');
  }

  // 알 수 없는 명령어
  if (text.startsWith('/')) {
    return sendMessage(chatId, '❓ 알 수 없는 명령어입니다.\n/menu 로 버튼 메뉴, /help 로 전체 명령어를 확인하세요.');
  }

  // 자연어 → 명령어 바로가기 (짧고 분명한 말만 — 긴 글은 등록 · 질문으로)
  if (text.length <= 20) {
    for (var ni = 0; ni < NL_MAP.length; ni++) {
      for (var pi = 0; pi < NL_MAP[ni][0].length; pi++) {
        if (NL_MAP[ni][0][pi].test(text)) return runMenu(NL_MAP[ni][1], chatId, user);
      }
    }
  }

  if (text.length < 2) return;
  // 📝 말로 등록 (②) — 등록처럼 보이면 미리보기 + 확인 버튼, 아니면 AI 질답
  if (require('../telegram/compose').classify(text) === 'entry') {
    try {
      var proposed = await proposeEntry(chatId, user, text);
      if (proposed) return;
    } catch (e) {
      console.error('[Telegram] compose', e.message);
      return sendMessage(chatId, aiErrText(e));
    }
  }
  return askAi(chatId, user, text);
}

/* 짧은 말 → 메뉴 키 (예전 nlMap 을 runMenu 로 통일 — 긴 글은 말로 등록 · AI 질답이 받는다) */
var NL_MAP = [
  [[/^(내\s*)?이슈(\s*(보여|목록|뭐))?/], 'issues'],
  [[/^오늘\s*(일정|뭐|브리핑)/], 'today'],
  [[/^(이번\s*주\s*일정|주간\s*일정|캘린더)/], 'cal'],
  [[/^(할\s*일\s*(목록)?|미완료|남은\s*작업)$/], 'todos'],
  [[/^내\s*업무/], 'mywork'],
  [[/^(지연|긴급\s*현황|오버듀)/], 'overdue'],
  [[/^(팀\s*현황|팀원\s*투입)/], 'team'],
  [[/^(메뉴|도움말|명령어\s*목록|사용법)/], 'menu']
];

/* ── Metrics ── */

/**
 * 텔레그램 발송 메트릭 집계 (notification_logs 기반)
 * @param {string} tenantId - 테넌트 ID (필수). null이면 전역 집계
 * @returns {Promise<object>} { day1: {sent, failed, rate, byEvent}, day7: {...}, lastError }
 */
async function getMetrics(tenantId) {
  var params = tenantId ? [tenantId] : [];
  var tenantFilter = tenantId ? 'tenant_id = $1 AND ' : '';

  // 24시간 / 7일 발송 카운트
  var dayR = await db.query(
    "SELECT " +
      "COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day' AND status = 'sent')::int AS sent_1d, " +
      "COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day' AND status = 'failed')::int AS failed_1d, " +
      "COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days' AND status = 'sent')::int AS sent_7d, " +
      "COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days' AND status = 'failed')::int AS failed_7d " +
    "FROM notification_logs WHERE " + tenantFilter + "created_at > NOW() - INTERVAL '7 days'",
    params
  );
  var d = dayR.rows[0];

  // 이벤트별 1일 카운트
  var evtR = await db.query(
    "SELECT event_type, status, COUNT(*)::int AS c FROM notification_logs " +
    "WHERE " + tenantFilter + "created_at > NOW() - INTERVAL '1 day' " +
    "GROUP BY event_type, status ORDER BY c DESC LIMIT 20",
    params
  );
  var byEvent = {};
  evtR.rows.forEach(function (r) {
    if (!byEvent[r.event_type]) byEvent[r.event_type] = { sent: 0, failed: 0 };
    byEvent[r.event_type][r.status] = r.c;
  });

  // 최근 에러
  var lastErrR = await db.query(
    "SELECT event_type, error_detail, created_at FROM notification_logs " +
    "WHERE " + tenantFilter + "status = 'failed' AND error_detail IS NOT NULL " +
    "ORDER BY created_at DESC LIMIT 5",
    params
  );

  function rate(s, f) { var tot = s + f; return tot ? Math.round(s * 1000 / tot) / 10 : null; }

  return {
    day1: { sent: d.sent_1d, failed: d.failed_1d, successRate: rate(d.sent_1d, d.failed_1d), byEvent: byEvent },
    day7: { sent: d.sent_7d, failed: d.failed_7d, successRate: rate(d.sent_7d, d.failed_7d) },
    lastErrors: lastErrR.rows
  };
}

module.exports = {
  isConfigured: isConfigured,
  sendMessage: sendMessage,
  setWebhook: setWebhook,
  webhookSecret: webhookSecret,
  secretActive: secretActive,
  setMyCommands: setMyCommands,
  createAuthCode: createAuthCode,
  verifyAndLink: verifyAndLink,
  unlink: unlink,
  getLinkStatus: getLinkStatus,
  getUserByChatId: getUserByChatId,
  handleUpdate: handleUpdate,
  stripBotName: stripBotName,
  askAi: askAi,
  composeRun: composeRun,
  runMenu: runMenu,
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
  cmdCancelRemind: function(chatId, user, t) { initCommands(); return utilityCmds.cmdCancelRemind(chatId, user, t); },
  cmdCloseVote: function(chatId, user, t) { initCommands(); return utilityCmds.cmdCloseVote(chatId, user, t); },
  cmdWeeklyReport: function(chatId, user) { initCommands(); return analysisCmds.cmdWeeklyReport(chatId, user); },
  cmdWeekly: function(chatId, user, arg) { initCommands(); return weeklyCmds.cmdWeekly(chatId, user, arg); },
  cmdWeeklyStats: function(chatId, user) { initCommands(); return weeklyCmds.cmdWeeklyStats(chatId, user); },
  cmdWeeklyMine: function(chatId, user) { initCommands(); return weeklyCmds.cmdWeeklyMine(chatId, user); },
  cmdProgress: function(chatId, user, arg) { initCommands(); return projectCmds.cmdProgress(chatId, user, arg); },
  callApi: callApi,
  getMetrics: getMetrics
};
