/**
 * Telegram Bot API 서비스
 * - 메시지 발송, Webhook 설정, 봇 명령어 처리
 */
var config = require('../config');
var db = require('../config/db');
var aiService = require('./ai.service');

var BASE = 'https://api.telegram.org/bot';

/** 업무분장 코드 매핑 */
var AM = { A: 'A(CS현장)', B: 'B(수주)', D: 'D(개발)', G: 'G(공통)', M: 'M(양산)', R: 'R(제안)', S: 'S(영업지원)' };

/** 텍스트 바 차트 생성 */
function textBar(value, max, width) {
  width = width || 16;
  var filled = max > 0 ? Math.round(value / max * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

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
    '<b>📋 개인</b>\n' +
    '/today — 오늘 브리핑\n' +
    '/my — 내 현황 (이슈 + 납기)\n' +
    '/issues — 미해결 이슈 목록\n' +
    '/tasks — 미완료 작업\n' +
    '/done &lt;번호&gt; — 작업 완료 처리\n' +
    '/log — 업무일지 빠른 등록\n' +
    '/my-stats — 내 월간 통계\n\n' +
    '<b>📊 분석</b>\n' +
    '/summary — 금주 업무시간 요약\n' +
    '/report — 월간 리포트\n' +
    '/overdue — 지연/긴급 현황\n' +
    '/project &lt;이름&gt; — 프로젝트 현황\n' +
    '/checklist &lt;이름&gt; — 체크리스트\n' +
    '/weekly-report — 주간보고 생성\n\n' +
    '<b>📅 일정/수주</b>\n' +
    '/calendar — 이번 주 일정\n' +
    '/orders — 수주 목록\n' +
    '/order &lt;번호&gt; — 수주 상세\n' +
    '/deliveries — 납품 예정\n' +
    '/remind &lt;시간&gt; &lt;내용&gt; — 리마인더\n' +
    '/vote — 팀 투표\n\n' +
    '<b>📁 문서</b>\n' +
    '/docs &lt;프로젝트&gt; — 문서 목록\n' +
    '/search-doc &lt;키워드&gt; — 문서 검색\n\n' +
    '<b>👥 팀 (관리자/팀장)</b>\n' +
    '/team — 팀원별 금주 투입\n\n' +
    '<b>⚙️ 설정</b>\n' +
    '/unlink — 연동 해제\n' +
    '/help — 명령어 안내\n\n' +
    '<b>💬 AI 질답</b>\n' +
    '명령어 없이 자연어로 질문하세요!\n' +
    '예: "이번 주 누가 제일 바빠?"\n' +
    '예: "SK하이닉스 프로젝트 요약해줘"\n' +
    '💡 "8h D B2024-001 업무내용" → 업무 등록';
  return sendMessage(chatId, msg);
}

/** 금주 월~일 날짜 범위 계산 (YYYYMMDD) */
function getWeekRange() {
  var now = new Date();
  var day = now.getDay();
  var diffMon = day === 0 ? -6 : 1 - day;
  var mon = new Date(now);
  mon.setDate(now.getDate() + diffMon);
  var sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  function fmt(d) { return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  return { start: fmt(mon), end: fmt(sun), monStr: mon.toLocaleDateString('ko'), sunStr: sun.toLocaleDateString('ko') };
}

/** 이번 달 날짜 범위 */
function getMonthRange() {
  var now = new Date();
  var y = now.getFullYear();
  var m = ('0' + (now.getMonth() + 1)).slice(-2);
  return { start: y + m + '01', end: y + m + '31', label: y + '년 ' + parseInt(m) + '월' };
}

/** 봇 명령어: /summary — 금주 업무시간 요약 */
async function cmdSummary(chatId, user) {
  var w = getWeekRange();

  // 내 금주 업무분장별 시간
  var abbrR = await db.query(
    'SELECT abbr, COALESCE(SUM(hours),0) as hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3 GROUP BY abbr ORDER BY hours DESC',
    [user.name, w.start, w.end]
  );
  // 일별 시간
  var dailyR = await db.query(
    'SELECT date, COALESCE(SUM(hours),0) as hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3 GROUP BY date ORDER BY date',
    [user.name, w.start, w.end]
  );
  // 수주별 시간 (상위 5)
  var orderR = await db.query(
    'SELECT order_no, COALESCE(SUM(hours),0) as hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3 GROUP BY order_no ORDER BY hours DESC LIMIT 5',
    [user.name, w.start, w.end]
  );

  var totalHours = abbrR.rows.reduce(function (s, r) { return s + parseFloat(r.hours); }, 0);
  var maxAbbr = abbrR.rows.length > 0 ? parseFloat(abbrR.rows[0].hours) : 1;
  var workDays = dailyR.rows.length;

  var msg = '📊 <b>금주 업무 요약</b>\n';
  msg += '<code>' + w.monStr + ' ~ ' + w.sunStr + '</code>\n\n';
  msg += '⏱ 총 <b>' + Math.round(totalHours * 10) / 10 + 'h</b> / ' + workDays + '일\n';
  if (workDays > 0) msg += '📈 일평균 <b>' + Math.round(totalHours / workDays * 10) / 10 + 'h</b>\n';
  msg += '\n';

  // 업무분장별 바 차트
  if (abbrR.rows.length > 0) {
    msg += '<b>업무분장별</b>\n';
    abbrR.rows.forEach(function (r) {
      var h = parseFloat(r.hours);
      var pct = totalHours > 0 ? Math.round(h / totalHours * 100) : 0;
      msg += '<code>' + textBar(h, maxAbbr, 12) + '</code> ' + (AM[r.abbr] || r.abbr) + ' <b>' + Math.round(h * 10) / 10 + 'h</b> (' + pct + '%)\n';
    });
    msg += '\n';
  }

  // 일별 근무시간
  if (dailyR.rows.length > 0) {
    var dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    var maxDay = Math.max.apply(null, dailyR.rows.map(function (r) { return parseFloat(r.hours); }));
    msg += '<b>일별 근무</b>\n';
    dailyR.rows.forEach(function (r) {
      var h = parseFloat(r.hours);
      var d = new Date(r.date.slice(0, 4) + '-' + r.date.slice(4, 6) + '-' + r.date.slice(6, 8));
      var dayName = dayNames[d.getDay()];
      var warn = h > 9 ? ' ⚠️' : '';
      msg += '<code>' + textBar(h, maxDay, 10) + '</code> ' + dayName + ' <b>' + Math.round(h * 10) / 10 + 'h</b>' + warn + '\n';
    });
    msg += '\n';
  }

  // 주요 수주
  if (orderR.rows.length > 0) {
    msg += '<b>주요 수주 (Top5)</b>\n';
    orderR.rows.forEach(function (r, i) {
      msg += (i + 1) + '. ' + (r.order_no || '(미지정)') + ' — <b>' + Math.round(parseFloat(r.hours) * 10) / 10 + 'h</b>\n';
    });
  }

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /project <이름> — 프로젝트 현황 */
async function cmdProject(chatId, user, query) {
  if (!query) {
    // 프로젝트 목록 표시
    var listR = await db.query(
      "SELECT name, status, progress, order_no FROM projects WHERE status NOT IN ('done') ORDER BY CASE status WHEN 'delayed' THEN 0 WHEN 'active' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END, name LIMIT 15"
    );
    if (listR.rows.length === 0) return sendMessage(chatId, '📁 진행중인 프로젝트가 없습니다.');

    var msg = '📁 <b>진행중 프로젝트</b>\n\n';
    listR.rows.forEach(function (r, i) {
      var statusIcon = r.status === 'delayed' ? '⚠️' : r.status === 'active' ? '🔵' : '⏳';
      var pct = r.progress || 0;
      msg += statusIcon + ' ' + r.name;
      if (r.order_no) msg += ' <code>[' + r.order_no + ']</code>';
      msg += '\n   <code>' + textBar(pct, 100, 10) + '</code> ' + pct + '%\n';
    });
    msg += '\n💡 상세 조회: /project 프로젝트명';
    return sendMessage(chatId, msg);
  }

  // 이름 검색
  var pR = await db.query(
    "SELECT * FROM projects WHERE name ILIKE $1 OR order_no ILIKE $1 LIMIT 1",
    ['%' + query + '%']
  );
  if (pR.rows.length === 0) return sendMessage(chatId, '❌ "' + query + '" 프로젝트를 찾을 수 없습니다.');

  var p = pR.rows[0];
  var statusMap = { waiting: '⏳ 대기', active: '🔵 진행중', delayed: '⚠️ 지연', done: '✅ 완료', hold: '⏸ 보류' };
  var pct = p.progress || 0;

  var msg = '📁 <b>' + p.name + '</b>\n\n';
  if (p.order_no) msg += '📋 수주: <code>' + p.order_no + '</code>\n';
  msg += '📊 상태: ' + (statusMap[p.status] || p.status) + '\n';
  msg += '📈 진행률: <code>' + textBar(pct, 100, 14) + '</code> <b>' + pct + '%</b>\n';
  if (p.start_date) msg += '📅 기간: ' + p.start_date + ' ~ ' + (p.end_date || '?') + '\n';

  // 담당자
  var assignees = [];
  try { assignees = typeof p.assignees === 'string' ? JSON.parse(p.assignees) : (p.assignees || []); } catch (_) {}
  if (assignees.length > 0) msg += '👤 담당: ' + assignees.join(', ') + '\n';

  // 투입시간
  if (p.order_no) {
    var hoursR = await db.query(
      'SELECT COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT name) as people FROM work_records WHERE order_no = $1',
      [p.order_no]
    );
    if (hoursR.rows[0]) {
      msg += '⏱ 투입: <b>' + Math.round(parseFloat(hoursR.rows[0].hours) * 10) / 10 + 'h</b> (' + hoursR.rows[0].people + '명)\n';
    }
  }

  // 미해결 이슈
  var issueR = await db.query(
    "SELECT COUNT(*) as cnt FROM issues WHERE project_id = $1 AND status NOT IN ('resolved','closed')",
    [p.id]
  );
  var issueCnt = parseInt(issueR.rows[0].cnt);
  if (issueCnt > 0) msg += '🔴 미해결 이슈: <b>' + issueCnt + '건</b>\n';

  // 마일스톤
  var msR = await db.query(
    "SELECT name, status, end_date FROM milestones WHERE project_id = $1 ORDER BY sort_order LIMIT 8",
    [p.id]
  );
  if (msR.rows.length > 0) {
    msg += '\n<b>마일스톤</b>\n';
    msR.rows.forEach(function (m) {
      var icon = m.status === 'done' ? '✅' : m.status === 'active' ? '🔵' : '⬜';
      msg += icon + ' ' + m.name;
      if (m.end_date) msg += ' (~ ' + m.end_date + ')';
      msg += '\n';
    });
  }

  if (p.memo) msg += '\n📝 ' + p.memo.slice(0, 200);

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /team — 팀원별 금주 투입시간 (관리자/팀장) */
async function cmdTeam(chatId, user) {
  if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'executive') {
    return sendMessage(chatId, '🔒 관리자/팀장만 사용 가능합니다.');
  }

  var w = getWeekRange();

  var r = await db.query(
    'SELECT name, COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT date) as days, COUNT(DISTINCT order_no) as orders FROM work_records WHERE date >= $1 AND date <= $2 GROUP BY name ORDER BY hours DESC',
    [w.start, w.end]
  );

  if (r.rows.length === 0) return sendMessage(chatId, '📊 금주 업무 기록이 없습니다.');

  var maxH = parseFloat(r.rows[0].hours);
  var totalH = r.rows.reduce(function (s, row) { return s + parseFloat(row.hours); }, 0);

  var msg = '👥 <b>팀원별 금주 투입</b>\n';
  msg += '<code>' + w.monStr + ' ~ ' + w.sunStr + '</code>\n';
  msg += '총 <b>' + r.rows.length + '명</b> / <b>' + Math.round(totalH * 10) / 10 + 'h</b>\n\n';

  r.rows.forEach(function (row, i) {
    var h = parseFloat(row.hours);
    var avgD = row.days > 0 ? Math.round(h / row.days * 10) / 10 : 0;
    var warn = avgD > 9 ? ' ⚠️' : '';
    msg += '<code>' + textBar(h, maxH, 10) + '</code> ' + row.name + ' <b>' + Math.round(h * 10) / 10 + 'h</b>';
    msg += ' (' + row.days + '일, 평균 ' + avgD + 'h)' + warn + '\n';
  });

  // 과부하/저투입 알림
  var overload = r.rows.filter(function (row) { return row.days > 0 && parseFloat(row.hours) / row.days > 9; });
  var underload = r.rows.filter(function (row) { return row.days >= 3 && parseFloat(row.hours) / row.days < 4; });

  if (overload.length > 0) {
    msg += '\n⚠️ <b>과부하 주의</b>: ' + overload.map(function (r) { return r.name; }).join(', ');
  }
  if (underload.length > 0) {
    msg += '\n💡 <b>저투입</b>: ' + underload.map(function (r) { return r.name; }).join(', ');
  }

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /report — 월간 리포트 */
async function cmdReport(chatId, user) {
  var m = getMonthRange();

  // 총계
  var totalR = await db.query(
    'SELECT COALESCE(SUM(hours),0) as hours, COUNT(*) as records, COUNT(DISTINCT name) as people, COUNT(DISTINCT order_no) as orders, COUNT(DISTINCT date) as days FROM work_records WHERE date >= $1 AND date <= $2',
    [m.start, m.end]
  );
  var t = totalR.rows[0];

  // 업무분장별
  var abbrR = await db.query(
    'SELECT abbr, COALESCE(SUM(hours),0) as hours FROM work_records WHERE date >= $1 AND date <= $2 GROUP BY abbr ORDER BY hours DESC',
    [m.start, m.end]
  );

  // 인원별 (Top 10)
  var peopleR = await db.query(
    'SELECT name, COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT date) as days FROM work_records WHERE date >= $1 AND date <= $2 GROUP BY name ORDER BY hours DESC LIMIT 10',
    [m.start, m.end]
  );

  // 프로젝트 현황
  var projR = await db.query(
    "SELECT status, COUNT(*) as cnt FROM projects WHERE status != 'done' GROUP BY status"
  );

  // 이슈 현황
  var issueR = await db.query(
    "SELECT status, COUNT(*) as cnt FROM issues GROUP BY status"
  );

  var totalHours = parseFloat(t.hours);
  var maxAbbr = abbrR.rows.length > 0 ? parseFloat(abbrR.rows[0].hours) : 1;
  var maxPeople = peopleR.rows.length > 0 ? parseFloat(peopleR.rows[0].hours) : 1;

  var msg = '📊 <b>' + m.label + ' 리포트</b>\n\n';

  // 핵심 수치
  msg += '<b>핵심 수치</b>\n';
  msg += '⏱ 총 투입: <b>' + Math.round(totalHours * 10) / 10 + 'h</b>\n';
  msg += '👥 참여 인원: <b>' + t.people + '명</b>\n';
  msg += '📋 수주 수: <b>' + t.orders + '건</b>\n';
  msg += '📅 근무일수: <b>' + t.days + '일</b>\n';
  if (t.people > 0) msg += '📈 인당 평균: <b>' + Math.round(totalHours / t.people * 10) / 10 + 'h</b>\n';
  msg += '\n';

  // 업무분장 분포
  if (abbrR.rows.length > 0) {
    msg += '<b>업무분장 분포</b>\n';
    abbrR.rows.forEach(function (r) {
      var h = parseFloat(r.hours);
      var pct = totalHours > 0 ? Math.round(h / totalHours * 100) : 0;
      msg += '<code>' + textBar(h, maxAbbr, 10) + '</code> ' + (AM[r.abbr] || r.abbr) + ' ' + Math.round(h * 10) / 10 + 'h (' + pct + '%)\n';
    });
    msg += '\n';
  }

  // 인원별 투입 Top10
  if (peopleR.rows.length > 0) {
    msg += '<b>인원별 투입 (Top10)</b>\n';
    peopleR.rows.forEach(function (r, i) {
      var h = parseFloat(r.hours);
      var avgD = r.days > 0 ? Math.round(h / r.days * 10) / 10 : 0;
      msg += '<code>' + textBar(h, maxPeople, 8) + '</code> ' + r.name + ' ' + Math.round(h * 10) / 10 + 'h (일평균 ' + avgD + 'h)\n';
    });
    msg += '\n';
  }

  // 프로젝트 현황
  if (projR.rows.length > 0) {
    var statusMap = { waiting: '⏳대기', active: '🔵진행', delayed: '⚠️지연', hold: '⏸보류' };
    msg += '<b>프로젝트 현황</b>\n';
    projR.rows.forEach(function (r) {
      msg += (statusMap[r.status] || r.status) + ': <b>' + r.cnt + '</b>  ';
    });
    msg += '\n\n';
  }

  // 이슈 현황
  if (issueR.rows.length > 0) {
    var issueMap = { open: '🟠접수', inProgress: '🔵대응중', resolved: '✅해결', closed: '⬜종결', hold: '⏸보류' };
    msg += '<b>이슈 현황</b>\n';
    issueR.rows.forEach(function (r) {
      msg += (issueMap[r.status] || r.status) + ': <b>' + r.cnt + '</b>  ';
    });
    msg += '\n';
  }

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /overdue — 지연 프로젝트 + 긴급 미해결 이슈 */
async function cmdOverdue(chatId, user) {
  // 지연 프로젝트
  var delayedR = await db.query(
    "SELECT name, order_no, end_date, progress FROM projects WHERE status = 'delayed' ORDER BY end_date LIMIT 10"
  );

  // 납기 지난 프로젝트
  var overdueR = await db.query(
    "SELECT name, order_no, end_date, progress FROM projects WHERE status NOT IN ('done','hold') AND end_date < $1 ORDER BY end_date LIMIT 10",
    [new Date().toISOString().slice(0, 10).replace(/-/g, '')]
  );

  // 긴급 미해결 이슈
  var urgentR = await db.query(
    "SELECT title, urgency, due_date, assignees FROM issues WHERE status NOT IN ('resolved','closed') AND urgency = 'urgent' ORDER BY due_date LIMIT 10"
  );

  // 기한 초과 이슈
  var overIssueR = await db.query(
    "SELECT title, urgency, due_date, assignees FROM issues WHERE status NOT IN ('resolved','closed') AND due_date IS NOT NULL AND due_date < $1 ORDER BY due_date LIMIT 10",
    [new Date().toISOString().slice(0, 10)]
  );

  var msg = '🚨 <b>지연/긴급 현황</b>\n\n';
  var hasContent = false;

  if (delayedR.rows.length > 0) {
    hasContent = true;
    msg += '⚠️ <b>지연 프로젝트 (' + delayedR.rows.length + ')</b>\n';
    delayedR.rows.forEach(function (r) {
      msg += '· ' + r.name;
      if (r.order_no) msg += ' [' + r.order_no + ']';
      msg += ' — ' + (r.progress || 0) + '%';
      if (r.end_date) msg += ', 납기 ' + r.end_date;
      msg += '\n';
    });
    msg += '\n';
  }

  if (overdueR.rows.length > 0) {
    hasContent = true;
    var today = new Date();
    msg += '🔴 <b>납기 초과 (' + overdueR.rows.length + ')</b>\n';
    overdueR.rows.forEach(function (r) {
      var endD = new Date(r.end_date.slice(0, 4) + '-' + r.end_date.slice(4, 6) + '-' + r.end_date.slice(6, 8));
      var diffDays = Math.floor((today - endD) / 86400000);
      msg += '· ' + r.name;
      if (r.order_no) msg += ' [' + r.order_no + ']';
      msg += ' — <b>+' + diffDays + '일</b> 초과\n';
    });
    msg += '\n';
  }

  if (urgentR.rows.length > 0) {
    hasContent = true;
    msg += '🔴 <b>긴급 이슈 (' + urgentR.rows.length + ')</b>\n';
    urgentR.rows.forEach(function (r) {
      var assignees = [];
      try { assignees = typeof r.assignees === 'string' ? JSON.parse(r.assignees) : (r.assignees || []); } catch (_) {}
      msg += '· ' + r.title;
      if (r.due_date) msg += ' (~ ' + r.due_date + ')';
      if (assignees.length > 0) msg += ' 👤' + assignees.join(',');
      msg += '\n';
    });
    msg += '\n';
  }

  if (overIssueR.rows.length > 0) {
    hasContent = true;
    msg += '⏰ <b>기한 초과 이슈 (' + overIssueR.rows.length + ')</b>\n';
    overIssueR.rows.forEach(function (r) {
      msg += '· ' + r.title + ' (기한 ' + r.due_date + ')\n';
    });
  }

  if (!hasContent) {
    msg += '✅ 지연 프로젝트 및 긴급 이슈가 없습니다!';
  }

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /calendar — 일정 조회 */
async function cmdCalendar(chatId, user, days) {
  days = days || 7;
  var today = new Date();
  var todayStr = today.toISOString().slice(0, 10);
  var endDate = new Date(today);
  endDate.setDate(today.getDate() + days - 1);
  var endStr = endDate.toISOString().slice(0, 10);

  var eventsR = await db.query(
    'SELECT id, title, type, start_date, end_date, assignees, memo FROM events WHERE start_date <= $1 AND end_date >= $2 ORDER BY start_date, end_date LIMIT 20',
    [endStr, todayStr]
  );

  if (eventsR.rows.length === 0) {
    return sendMessage(chatId, '📅 등록된 일정이 없습니다.');
  }

  var typeIcons = {
    milestone: '◆', meeting: '🤝', deadline: '🏁', trip: '✈️',
    fieldService: '🔧', periodicChk: '🛠️', dayoff: '🌴',
    amoff: '🌅', pmoff: '🌇', etc: '📌'
  };
  var dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  // Group events by date
  var grouped = {};
  eventsR.rows.forEach(function (ev) {
    var startD = new Date(ev.start_date);
    var endD = new Date(ev.end_date);
    var cursor = new Date(Math.max(startD.getTime(), today.getTime()));
    var limit = new Date(Math.min(endD.getTime(), endDate.getTime()));
    while (cursor <= limit) {
      var dateKey = cursor.toISOString().slice(0, 10);
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(ev);
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  var msg = '📅 <b>일정 (' + days + '일)</b>\n\n';
  var sortedDates = Object.keys(grouped).sort();
  sortedDates.forEach(function (dateKey) {
    var d = new Date(dateKey);
    var dayName = dayNames[d.getDay()];
    msg += '<b>' + dateKey.slice(5) + ' (' + dayName + ')</b>\n';
    grouped[dateKey].forEach(function (ev) {
      var icon = typeIcons[ev.type] || '📌';
      msg += icon + ' ' + ev.title + '\n';
    });
    msg += '\n';
  });

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /today — 오늘 브리핑 */
async function cmdToday(chatId, user) {
  var today = new Date().toISOString().slice(0, 10);
  var todayCompact = today.replace(/-/g, '');

  // 오늘 일정
  var eventsR = await db.query(
    'SELECT title, type FROM events WHERE start_date <= $1 AND end_date >= $1 ORDER BY start_date',
    [today]
  );

  // 긴급 미해결 이슈
  var issuesR = await db.query(
    "SELECT title, urgency, status FROM issues WHERE assignees::text LIKE $1 AND status NOT IN ('resolved','closed') ORDER BY CASE urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END LIMIT 3",
    ['%' + user.name + '%']
  );

  // 오늘 납기 프로젝트
  var deadlinesR = await db.query(
    "SELECT name, order_no FROM projects WHERE end_date = $1 AND status != 'done'",
    [todayCompact]
  );

  var hasContent = eventsR.rows.length > 0 || issuesR.rows.length > 0 || deadlinesR.rows.length > 0;

  if (!hasContent) {
    return sendMessage(chatId, '✨ 오늘은 특별한 일정이 없습니다. 좋은 하루 되세요!');
  }

  var typeIcons = {
    milestone: '◆', meeting: '🤝', deadline: '🏁', trip: '✈️',
    fieldService: '🔧', periodicChk: '🛠️', dayoff: '🌴',
    amoff: '🌅', pmoff: '🌇', etc: '📌'
  };

  var msg = '☀️ <b>' + user.name + '님, 오늘 브리핑</b>\n\n';

  if (eventsR.rows.length > 0) {
    msg += '📅 <b>오늘 일정</b>\n';
    eventsR.rows.forEach(function (r) {
      var icon = typeIcons[r.type] || '📌';
      msg += icon + ' ' + r.title + '\n';
    });
    msg += '\n';
  }

  if (issuesR.rows.length > 0) {
    msg += '🔴 <b>긴급 이슈</b>\n';
    issuesR.rows.forEach(function (r) {
      var icon = r.urgency === 'urgent' ? '🔴' : r.urgency === 'normal' ? '🟡' : '🟢';
      msg += icon + ' ' + r.title + ' [' + r.status + ']\n';
    });
    msg += '\n';
  }

  if (deadlinesR.rows.length > 0) {
    msg += '🏁 <b>오늘 납기</b>\n';
    deadlinesR.rows.forEach(function (r) {
      msg += '· ' + (r.order_no || '') + ' ' + r.name + '\n';
    });
  }

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /tasks — 미완료 작업 목록 */
async function cmdTasks(chatId, user) {
  var checklistsR = await db.query(
    'SELECT c.id, c.project_id, c.phase, c.items, p.name as project_name FROM checklists c LEFT JOIN projects p ON p.id = c.project_id WHERE p.assignees::text LIKE $1 OR c.created_by = $2 ORDER BY p.name',
    ['%' + user.name + '%', user.user_id]
  );

  var taskNum = 0;
  var grouped = {};

  checklistsR.rows.forEach(function (cl) {
    var items = [];
    try { items = typeof cl.items === 'string' ? JSON.parse(cl.items) : (cl.items || []); } catch (_) {}
    items.forEach(function (item) {
      if (item.done === true) return;
      taskNum++;
      var projName = cl.project_name || '(프로젝트 없음)';
      if (!grouped[projName]) grouped[projName] = [];
      grouped[projName].push({
        num: taskNum,
        title: item.title || item.text || item.name || '(제목없음)'
      });
    });
  });

  if (taskNum === 0) {
    return sendMessage(chatId, '✅ 미완료 작업이 없습니다!');
  }

  var msg = '📋 <b>미완료 작업 (' + taskNum + '건)</b>\n\n';
  var projNames = Object.keys(grouped);
  projNames.forEach(function (projName) {
    msg += '<b>' + projName + '</b>\n';
    grouped[projName].forEach(function (t) {
      msg += '⬜ ' + t.num + '. ' + t.title + '\n';
    });
    msg += '\n';
  });

  msg += '💡 완료: /done 번호';
  return sendMessage(chatId, msg);
}

/** 봇 명령어: /done <번호> — 작업 완료 처리 */
async function cmdDone(chatId, user, itemNumber) {
  if (!itemNumber || isNaN(itemNumber)) {
    return sendMessage(chatId, '사용법: /done <번호>\n\n/tasks 에서 번호를 확인하세요.');
  }

  var checklistsR = await db.query(
    'SELECT c.id, c.project_id, c.phase, c.items, p.name as project_name FROM checklists c LEFT JOIN projects p ON p.id = c.project_id WHERE p.assignees::text LIKE $1 OR c.created_by = $2 ORDER BY p.name',
    ['%' + user.name + '%', user.user_id]
  );

  var taskNum = 0;
  var targetCl = null;
  var targetItemIdx = -1;
  var targetTitle = '';

  checklistsR.rows.forEach(function (cl) {
    var items = [];
    try { items = typeof cl.items === 'string' ? JSON.parse(cl.items) : (cl.items || []); } catch (_) {}
    items.forEach(function (item, idx) {
      if (item.done === true) return;
      taskNum++;
      if (taskNum === itemNumber) {
        targetCl = cl;
        targetItemIdx = idx;
        targetTitle = item.title || item.text || item.name || '(제목없음)';
      }
    });
  });

  if (!targetCl || targetItemIdx < 0) {
    return sendMessage(chatId, '❌ 유효하지 않은 번호입니다.');
  }

  var items = [];
  try { items = typeof targetCl.items === 'string' ? JSON.parse(targetCl.items) : (targetCl.items || []); } catch (_) {}
  items[targetItemIdx].done = true;

  await db.query(
    'UPDATE checklists SET items = $1, version = version + 1 WHERE id = $2',
    [JSON.stringify(items), targetCl.id]
  );

  return sendMessage(chatId, '✅ 완료: ' + targetTitle);
}

/** 봇 명령어: /orders — 수주 목록 */
async function cmdOrders(chatId, user) {
  var ordersR = await db.query(
    'SELECT order_no, client, name, amount, manager, delivery, memo FROM orders ORDER BY delivery DESC NULLS LAST LIMIT 15'
  );

  if (ordersR.rows.length === 0) {
    return sendMessage(chatId, '📦 등록된 수주가 없습니다.');
  }

  var today = new Date();
  var msg = '📦 <b>수주 목록</b>\n\n';
  ordersR.rows.forEach(function (r, i) {
    msg += '<b>' + (i + 1) + '.</b> ';
    if (r.order_no) msg += '<code>' + r.order_no + '</code> ';
    msg += (r.name || r.client || '(미지정)');
    if (r.amount) {
      var amountStr = Number(r.amount).toLocaleString();
      msg += ' — ' + amountStr + '천원';
    }
    if (r.delivery) {
      msg += '\n   📅 납품: ' + r.delivery;
      var delivDate = new Date(r.delivery.slice(0, 4) + '-' + r.delivery.slice(4, 6) + '-' + r.delivery.slice(6, 8));
      if (isNaN(delivDate.getTime())) {
        delivDate = new Date(r.delivery);
      }
      var diffDays = Math.ceil((delivDate - today) / 86400000);
      if (diffDays >= 0 && diffDays <= 7) msg += ' ⚠️';
    }
    msg += '\n';
  });

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /order <검색어> — 수주 상세 */
async function cmdOrder(chatId, user, query) {
  if (!query) return cmdOrders(chatId, user);

  var orderR = await db.query(
    'SELECT * FROM orders WHERE order_no ILIKE $1 OR client ILIKE $1 OR name ILIKE $1 LIMIT 1',
    ['%' + query + '%']
  );

  if (orderR.rows.length === 0) {
    return sendMessage(chatId, '❌ 수주를 찾을 수 없습니다.');
  }

  var o = orderR.rows[0];
  var msg = '📦 <b>수주 상세</b>\n\n';
  if (o.order_no) msg += '📋 수주번호: <code>' + o.order_no + '</code>\n';
  if (o.client) msg += '🏢 고객: ' + o.client + '\n';
  if (o.name) msg += '📁 건명: ' + o.name + '\n';
  if (o.amount) {
    var amountStr = Number(o.amount).toLocaleString();
    msg += '💰 금액: ' + amountStr + '천원\n';
  }
  if (o.manager) msg += '👤 담당: ' + o.manager + '\n';
  if (o.delivery) msg += '📅 납품: ' + o.delivery + '\n';
  if (o.memo) msg += '📝 메모: ' + o.memo.slice(0, 200) + '\n';

  // 투입 시간 조회
  if (o.order_no) {
    var workR = await db.query(
      'SELECT COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT name) as people FROM work_records WHERE order_no = $1',
      [o.order_no]
    );
    if (workR.rows[0]) {
      msg += '\n⏱ 투입: <b>' + Math.round(parseFloat(workR.rows[0].hours) * 10) / 10 + 'h</b> (' + workR.rows[0].people + '명)';
    }
  }

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /deliveries — 이번 달 납품 예정 */
async function cmdDeliveries(chatId, user) {
  var now = new Date();
  var y = now.getFullYear();
  var m = ('0' + (now.getMonth() + 1)).slice(-2);
  var startYMD = y + '-' + m + '-01';
  var endYMD = y + '-' + m + '-31';
  var startCompact = y + m + '01';
  var endCompact = y + m + '31';

  // Try both date formats
  var ordersR = await db.query(
    'SELECT order_no, client, name, delivery, manager FROM orders WHERE (delivery >= $1 AND delivery <= $2) OR (delivery >= $3 AND delivery <= $4) ORDER BY delivery',
    [startYMD, endYMD, startCompact, endCompact]
  );

  if (ordersR.rows.length === 0) {
    return sendMessage(chatId, '📦 이번 달 납품 예정이 없습니다.');
  }

  var today = new Date();
  var msg = '📦 <b>' + y + '년 ' + parseInt(m) + '월 납품 예정</b>\n\n';
  ordersR.rows.forEach(function (r, i) {
    msg += '<b>' + (i + 1) + '.</b> ';
    if (r.order_no) msg += '<code>' + r.order_no + '</code> ';
    msg += (r.name || r.client || '(미지정)');
    if (r.delivery) {
      msg += '\n   📅 ' + r.delivery;
      var delivDate = new Date(r.delivery.slice(0, 4) + '-' + r.delivery.slice(4, 6) + '-' + r.delivery.slice(6, 8));
      if (isNaN(delivDate.getTime())) {
        delivDate = new Date(r.delivery);
      }
      var diffDays = Math.ceil((delivDate - today) / 86400000);
      if (diffDays < 0) {
        msg += ' (지남)';
      } else if (diffDays === 0) {
        msg += ' (오늘!)';
      } else {
        msg += ' (D-' + diffDays + ')';
      }
    }
    if (r.manager) msg += ' 👤' + r.manager;
    msg += '\n';
  });

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /my-stats — 내 월간 통계 */
async function cmdMyStats(chatId, user) {
  var m = getMonthRange();

  // 업무분장별 시간
  var abbrR = await db.query(
    'SELECT abbr, COALESCE(SUM(hours),0) as hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3 GROUP BY abbr ORDER BY hours DESC',
    [user.name, m.start, m.end]
  );

  // 주간별 시간
  var weeklyR = await db.query(
    'SELECT SUBSTRING(date,1,6) as ym, CEIL((CAST(SUBSTRING(date,7,2) AS INTEGER))::numeric / 7) as wk, COALESCE(SUM(hours),0) as hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3 GROUP BY ym, wk ORDER BY wk',
    [user.name, m.start, m.end]
  );

  // 관여 수주 수
  var orderCntR = await db.query(
    'SELECT COUNT(DISTINCT order_no) as cnt FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3',
    [user.name, m.start, m.end]
  );

  // 일별 근무일 수
  var daysCntR = await db.query(
    'SELECT COUNT(DISTINCT date) as days, COALESCE(SUM(hours),0) as hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3',
    [user.name, m.start, m.end]
  );

  var totalHours = parseFloat(daysCntR.rows[0].hours);
  var workDays = parseInt(daysCntR.rows[0].days);
  var dailyAvg = workDays > 0 ? Math.round(totalHours / workDays * 10) / 10 : 0;
  var orderCnt = parseInt(orderCntR.rows[0].cnt);
  var maxAbbr = abbrR.rows.length > 0 ? parseFloat(abbrR.rows[0].hours) : 1;

  var msg = '📊 <b>' + user.name + '님 ' + m.label + ' 통계</b>\n\n';
  msg += '⏱ 총 투입: <b>' + Math.round(totalHours * 10) / 10 + 'h</b>\n';
  msg += '📅 근무일: <b>' + workDays + '일</b>\n';
  msg += '📈 일평균: <b>' + dailyAvg + 'h</b>\n';
  msg += '📋 수주 수: <b>' + orderCnt + '건</b>\n\n';

  // 업무분장별 바 차트
  if (abbrR.rows.length > 0) {
    msg += '<b>업무분장별</b>\n';
    abbrR.rows.forEach(function (r) {
      var h = parseFloat(r.hours);
      var pct = totalHours > 0 ? Math.round(h / totalHours * 100) : 0;
      msg += '<code>' + textBar(h, maxAbbr, 12) + '</code> ' + (AM[r.abbr] || r.abbr) + ' <b>' + Math.round(h * 10) / 10 + 'h</b> (' + pct + '%)\n';
    });
    msg += '\n';
  }

  // 주간별
  if (weeklyR.rows.length > 0) {
    var maxWk = Math.max.apply(null, weeklyR.rows.map(function (r) { return parseFloat(r.hours); }));
    msg += '<b>주간별</b>\n';
    weeklyR.rows.forEach(function (r) {
      var h = parseFloat(r.hours);
      msg += '<code>' + textBar(h, maxWk, 10) + '</code> ' + r.wk + '주차 <b>' + Math.round(h * 10) / 10 + 'h</b>\n';
    });
  }

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /checklist — 체크리스트 조회 */
async function cmdChecklist(chatId, user, query) {
  if (!query) {
    // 체크리스트가 있는 프로젝트 목록
    var listR = await db.query(
      'SELECT DISTINCT p.name, p.id, COUNT(c.id) as cl_count FROM checklists c LEFT JOIN projects p ON p.id = c.project_id GROUP BY p.id, p.name ORDER BY p.name LIMIT 15'
    );
    if (listR.rows.length === 0) {
      return sendMessage(chatId, '📋 등록된 체크리스트가 없습니다.');
    }
    var msg = '📋 <b>체크리스트 프로젝트</b>\n\n';
    listR.rows.forEach(function (r, i) {
      msg += (i + 1) + '. ' + (r.name || '(프로젝트 없음)') + ' (' + r.cl_count + '개)\n';
    });
    msg += '\n💡 상세: /checklist 프로젝트명';
    return sendMessage(chatId, msg);
  }

  var clR = await db.query(
    'SELECT c.*, p.name as project_name FROM checklists c LEFT JOIN projects p ON p.id = c.project_id WHERE p.name ILIKE $1 ORDER BY c.phase',
    ['%' + query + '%']
  );

  if (clR.rows.length === 0) {
    return sendMessage(chatId, '❌ "' + query + '" 체크리스트를 찾을 수 없습니다.');
  }

  var msg = '📋 <b>' + (clR.rows[0].project_name || query) + ' 체크리스트</b>\n\n';

  clR.rows.forEach(function (cl) {
    var items = [];
    try { items = typeof cl.items === 'string' ? JSON.parse(cl.items) : (cl.items || []); } catch (_) {}
    var doneCount = items.filter(function (item) { return item.done === true; }).length;
    var totalCount = items.length;
    var pct = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;

    msg += '<b>' + (cl.phase || '기타') + '</b> (' + pct + '%)\n';
    items.forEach(function (item) {
      var icon = item.done === true ? '✅' : '⬜';
      msg += icon + ' ' + (item.title || item.text || item.name || '(항목)') + '\n';
    });
    msg += '\n';
  });

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /docs — 문서 목록 */
async function cmdDocs(chatId, user, query) {
  var docsR;
  if (!query) {
    docsR = await db.query(
      'SELECT pf.name, pf.ext, pf.size, pf.created_at, p.name as project_name FROM project_files pf LEFT JOIN projects p ON p.id = pf.project_id ORDER BY pf.created_at DESC LIMIT 10'
    );
  } else {
    docsR = await db.query(
      'SELECT pf.name, pf.ext, pf.size, pf.created_at, p.name as project_name FROM project_files pf LEFT JOIN projects p ON p.id = pf.project_id WHERE p.name ILIKE $1 OR pf.name ILIKE $1 ORDER BY pf.created_at DESC LIMIT 10',
      ['%' + query + '%']
    );
  }

  if (docsR.rows.length === 0) {
    return sendMessage(chatId, '📁 문서가 없습니다.' + (query ? ' (검색: ' + query + ')' : ''));
  }

  var msg = '📁 <b>문서 목록</b>' + (query ? ' — ' + query : '') + '\n\n';
  docsR.rows.forEach(function (r, i) {
    var sizeStr = '';
    if (r.size) {
      var sizeKB = r.size / 1024;
      sizeStr = sizeKB >= 1024 ? (Math.round(sizeKB / 1024 * 10) / 10) + 'MB' : Math.round(sizeKB) + 'KB';
    }
    var dateStr = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '';
    msg += (i + 1) + '. ' + r.name + (r.ext ? '.' + r.ext : '');
    if (sizeStr) msg += ' (' + sizeStr + ')';
    if (dateStr) msg += ' ' + dateStr;
    if (r.project_name) msg += '\n   📁 ' + r.project_name;
    msg += '\n';
  });

  return sendMessage(chatId, msg);
}

/** 봇 명령어: /search-doc — 문서 검색 */
async function cmdSearchDoc(chatId, user, query) {
  if (!query) {
    return sendMessage(chatId, '사용법: /search-doc <키워드>');
  }

  var docsR = await db.query(
    'SELECT pf.name, pf.ext, pf.size, pf.created_at, p.name as project_name FROM project_files pf LEFT JOIN projects p ON p.id = pf.project_id WHERE pf.name ILIKE $1 OR pf.tags::text ILIKE $1 ORDER BY pf.created_at DESC LIMIT 10',
    ['%' + query + '%']
  );

  if (docsR.rows.length === 0) {
    return sendMessage(chatId, '📁 "' + query + '" 검색 결과가 없습니다.');
  }

  var msg = '🔍 <b>문서 검색: ' + query + '</b>\n\n';
  docsR.rows.forEach(function (r, i) {
    var sizeStr = '';
    if (r.size) {
      var sizeKB = r.size / 1024;
      sizeStr = sizeKB >= 1024 ? (Math.round(sizeKB / 1024 * 10) / 10) + 'MB' : Math.round(sizeKB) + 'KB';
    }
    var dateStr = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '';
    msg += (i + 1) + '. ' + r.name + (r.ext ? '.' + r.ext : '');
    if (sizeStr) msg += ' (' + sizeStr + ')';
    if (dateStr) msg += ' ' + dateStr;
    if (r.project_name) msg += '\n   📁 ' + r.project_name;
    msg += '\n';
  });

  return sendMessage(chatId, msg);
}

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

/** 봇 명령어: /log — 업무일지 빠른 등록 */
async function cmdLog(chatId, user, text) {
  var match = text.match(/^\/?(log\s+)?(\d+\.?\d*)\s*h\s+([ABDGMRS])\s*([\w-]*\d[\w-]*)?\s*(.*)/i);
  if (!match) return sendMessage(chatId, '❌ 형식: 8h D B2024-001 업무내용\n예: 4.5h A 현장점검');
  var hours = parseFloat(match[2]);
  var abbr = match[3].toUpperCase();
  var orderNo = (match[4] || '').trim() || null;
  var content = (match[5] || '').trim() || '(내용 없음)';

  var today = new Date();
  var dateStr = today.getFullYear() + ('0' + (today.getMonth() + 1)).slice(-2) + ('0' + today.getDate()).slice(-2);
  var dateDisplay = today.toISOString().slice(0, 10);

  await db.query(
    'INSERT INTO work_records (date, name, hours, abbr, order_no, content, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
    [dateStr, user.name, hours, abbr, orderNo, content, user.user_id]
  );

  var totalR = await db.query(
    'SELECT COALESCE(SUM(hours),0) as total FROM work_records WHERE name = $1 AND date = $2',
    [user.name, dateStr]
  );
  var total = parseFloat(totalR.rows[0].total);

  var logMsg = '✅ 업무 등록 완료\n' +
    user.name + ' | ' + dateDisplay + ' | ' + (AM[abbr] || abbr) + ' ' + hours + 'h\n' +
    (orderNo ? orderNo + ' | ' : '') + content + '\n\n' +
    '📊 오늘 합계: ' + Math.round(total * 10) / 10 + 'h';

  return sendMessage(chatId, logMsg);
}

/** 봇 명령어: /remind — 리마인더 */
async function cmdRemind(chatId, user, text) {
  var match = text.match(/^(\d+)\s*(m|h|d)\s+(.*)/i);
  if (!match) return sendMessage(chatId, '사용법: /remind 2h 검수 서류 준비');
  var num = parseInt(match[1]);
  var unit = match[2].toLowerCase();
  var reminderMsg = match[3].trim();
  var ms = unit === 'm' ? num * 60000 : unit === 'h' ? num * 3600000 : num * 86400000;
  if (ms > 7 * 86400000) return sendMessage(chatId, '❌ 최대 7일까지 설정 가능합니다.');

  setTimeout(function() {
    sendMessage(chatId, '⏰ <b>리마인더</b>\n\n' + reminderMsg);
  }, ms);

  return sendMessage(chatId, '⏰ 리마인더 설정 완료\n' + num + unit + ' 후: ' + reminderMsg);
}

/** 봇 명령어: /vote — 팀 투표 */
async function cmdVote(chatId, user, text) {
  var parts = text.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
  if (parts.length < 2) {
    var qMatch = text.match(/^"([^"]+)"\s+(.*)/);
    if (qMatch) {
      parts = [qMatch[1]].concat(qMatch[2].split(/\s+/));
    }
  }
  if (parts.length < 2) return sendMessage(chatId, '사용법: /vote 질문\n옵션1\n옵션2\n옵션3');

  var question = parts[0];
  var options = parts.slice(1);

  var buttons = options.map(function(opt, i) {
    return [{ text: opt + ' (0)', callback_data: 'vote:' + chatId + ':' + i + ':' + opt }];
  });

  return sendMessage(chatId, '📊 <b>투표</b>\n\n' + question, {
    reply_markup: JSON.stringify({ inline_keyboard: buttons })
  });
}

/** 봇 명령어: /weekly-report — 주간보고 자동 생성 */
async function cmdWeeklyReport(chatId, user) {
  var w = getWeekRange();
  var records = await db.query(
    'SELECT abbr, order_no, content, hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3 ORDER BY date, abbr',
    [user.name, w.start, w.end]
  );

  if (records.rows.length === 0) return sendMessage(chatId, '📝 금주 업무 기록이 없습니다.');

  var totalHours = 0;
  var byAbbr = {};
  var byOrder = {};
  records.rows.forEach(function(r) {
    totalHours += parseFloat(r.hours);
    if (!byAbbr[r.abbr]) byAbbr[r.abbr] = { hours: 0, items: [] };
    byAbbr[r.abbr].hours += parseFloat(r.hours);
    var contentStr = r.content || '';
    if (contentStr && byAbbr[r.abbr].items.indexOf(contentStr) === -1) byAbbr[r.abbr].items.push(contentStr);
    if (r.order_no) {
      if (!byOrder[r.order_no]) byOrder[r.order_no] = 0;
      byOrder[r.order_no] += parseFloat(r.hours);
    }
  });

  var issues = await db.query(
    "SELECT title, status FROM issues WHERE assignees::text LIKE $1 AND status NOT IN ('resolved','closed') LIMIT 5",
    ['%' + user.name + '%']
  );

  var wrMsg = '📝 <b>주간 업무 보고</b>\n';
  wrMsg += '<code>' + w.monStr + ' ~ ' + w.sunStr + '</code>\n';
  wrMsg += '작성자: ' + user.name + '\n\n';

  wrMsg += '<b>1. 금주 실적</b> (총 ' + Math.round(totalHours * 10) / 10 + 'h)\n';
  Object.keys(byAbbr).sort().forEach(function(a) {
    var info = byAbbr[a];
    wrMsg += '\n<b>' + (AM[a] || a) + '</b> — ' + Math.round(info.hours * 10) / 10 + 'h\n';
    info.items.slice(0, 5).forEach(function(item) {
      wrMsg += '  · ' + item + '\n';
    });
  });

  if (Object.keys(byOrder).length > 0) {
    wrMsg += '\n<b>2. 수주별 투입</b>\n';
    Object.entries(byOrder).sort(function(a, b) { return b[1] - a[1]; }).forEach(function(entry) {
      wrMsg += '  · ' + entry[0] + ': ' + Math.round(entry[1] * 10) / 10 + 'h\n';
    });
  }

  if (issues.rows.length > 0) {
    wrMsg += '\n<b>3. 진행중 이슈</b>\n';
    issues.rows.forEach(function(r) {
      wrMsg += '  · ' + r.title + ' [' + r.status + ']\n';
    });
  }

  wrMsg += '\n<b>4. 차주 계획</b>\n  · (텔레그램에서 추가 입력 가능)\n';

  return sendMessage(chatId, wrMsg);
}

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
  if (text === '/summary') return cmdSummary(chatId, user);
  if (text === '/report') return cmdReport(chatId, user);
  if (text === '/overdue') return cmdOverdue(chatId, user);
  if (text === '/team') return cmdTeam(chatId, user);
  if (text.startsWith('/project')) {
    var projQuery = text.replace(/^\/project\s*/, '').trim();
    return cmdProject(chatId, user, projQuery || null);
  }
  if (text === '/today') return cmdToday(chatId, user);
  if (text.startsWith('/calendar')) {
    var calDays = parseInt(text.replace(/^\/calendar\s*/, '')) || 7;
    return cmdCalendar(chatId, user, calDays);
  }
  if (text === '/tasks') return cmdTasks(chatId, user);
  if (text.startsWith('/done')) {
    var doneNum = parseInt(text.replace(/^\/done\s*/, ''));
    return cmdDone(chatId, user, doneNum);
  }
  if (text === '/orders') return cmdOrders(chatId, user);
  if (text.startsWith('/order ') && !text.startsWith('/orders')) {
    var orderQuery = text.replace(/^\/order\s+/, '').trim();
    return cmdOrder(chatId, user, orderQuery);
  }
  if (text === '/deliveries') return cmdDeliveries(chatId, user);
  if (text === '/my-stats' || text === '/mystats') return cmdMyStats(chatId, user);
  if (text.startsWith('/checklist')) {
    var clQuery = text.replace(/^\/checklist\s*/, '').trim();
    return cmdChecklist(chatId, user, clQuery || null);
  }
  if (text.startsWith('/docs')) {
    var docQuery = text.replace(/^\/docs\s*/, '').trim();
    return cmdDocs(chatId, user, docQuery || null);
  }
  if (text.startsWith('/search-doc')) {
    var sdQuery = text.replace(/^\/search-doc\s*/, '').trim();
    return cmdSearchDoc(chatId, user, sdQuery || null);
  }
  // 업무일지 빠른 등록 (명령어 또는 패턴 매치)
  if (text.startsWith('/log ')) {
    return cmdLog(chatId, user, text.replace(/^\/log\s+/, ''));
  }
  if (/^\d+\.?\d*\s*h\s+[ABDGMRS]/i.test(text)) {
    return cmdLog(chatId, user, text);
  }
  if (text.startsWith('/remind ')) {
    return cmdRemind(chatId, user, text.replace(/^\/remind\s+/, ''));
  }
  if (text.startsWith('/vote')) {
    var voteText = text.replace(/^\/vote\s*/, '').trim();
    return cmdVote(chatId, user, voteText);
  }
  if (text === '/weekly-report' || text === '/weeklyreport') {
    return cmdWeeklyReport(chatId, user);
  }
  if (text === '/help') return cmdHelp(chatId);

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
  createAuthCode: createAuthCode,
  verifyAndLink: verifyAndLink,
  unlink: unlink,
  getLinkStatus: getLinkStatus,
  getUserByChatId: getUserByChatId,
  handleUpdate: handleUpdate,
  generateAuthCode: generateAuthCode,
  cmdCalendar: cmdCalendar,
  cmdToday: cmdToday,
  cmdTasks: cmdTasks,
  cmdDone: cmdDone,
  cmdOrders: cmdOrders,
  cmdOrder: cmdOrder,
  cmdDeliveries: cmdDeliveries,
  cmdMyStats: cmdMyStats,
  cmdChecklist: cmdChecklist,
  cmdDocs: cmdDocs,
  cmdSearchDoc: cmdSearchDoc,
  cmdLog: cmdLog,
  cmdRemind: cmdRemind,
  cmdVote: cmdVote,
  cmdWeeklyReport: cmdWeeklyReport
};
