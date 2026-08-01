/**
 * 알림 서비스
 * - 이벤트 발생 → 수신자 결정 → 텔레그램 + 이메일 + 인앱 알림 발송
 */
var db = require('../config/db');
var telegramService = require('./telegram.service');
var emailService = require('./email.service');
var escHtml = require('../telegram/util/escape').escHtml;

/* 작업 노트 경량 서식(마크다운 일부) → 텔레그램 HTML. 웹 표시(wmRichNote)와 동일 규칙.
   체크박스 ☐/☑, **굵게**, ~~취소선~~, ==형광==(텍스트), [중요]등 배지(텍스트), 글머리표 •. */
function noteToTgHtml(note) {
  if (note == null) return '';
  var lines = escHtml(String(note)).split('\n');
  var out = lines.map(function (ln) {
    var cm = ln.match(/^(\s*)[-*]\s\[( |x|X)\]\s?(.*)$/);
    if (cm) return (cm[2].toLowerCase() === 'x' ? '☑ ' : '☐ ') + cm[3];
    var lm = ln.match(/^(\s*)[-*]\s+(.*)$/);
    if (lm) return lm[1] + '• ' + lm[2];
    return ln;
  });
  return out.join('\n')
    .replace(/\*\*([^\n*]+)\*\*/g, '<b>$1</b>')
    .replace(/~~([^\n~]+)~~/g, '<s>$1</s>')
    .replace(/==([^\n=]+)==/g, '$1')
    .replace(/`([^\n`]+)`/g, '<code>$1</code>')
    .replace(/\[(중요|긴급|주의|완료|진행)\]/g, '【$1】');
}

/** 이벤트 메시지 템플릿
 *  사용자 발 필드는 모두 escHtml()로 감싸 텔레그램 HTML 파서가 깨지지 않도록 함.
 *  단, p.content 류(event_today / weekly_digest / as_weekly_digest)는 호출자가 이미
 *  <b>/<code> 등 마크업을 안전하게 조립한 HTML이므로 raw 유지(이중 escape 회피).
 *  분기 비교용 enum(p.urgency, p.priority)도 raw 유지.
 */
var TEMPLATES = {
  issue_assigned: function (p) {
    var icon = p.urgency === 'urgent' ? '🔴' : p.urgency === 'normal' ? '🟡' : '🟢';
    return icon + ' <b>이슈 배정</b>\n' +
      (p.projectName ? escHtml(p.projectName) + '\n' : '') +
      '제목: ' + escHtml(p.title) + '\n' +
      '담당: ' + (p.assignee ? escHtml(p.assignee) : '-');
  },
  issue_status_changed: function (p) {
    return '🔵 <b>이슈 상태 변경</b>\n' +
      escHtml(p.title) + '\n' +
      escHtml(p.fromStatus) + ' → ' + escHtml(p.toStatus);
  },
  project_delayed: function (p) {
    return '⚠️ <b>프로젝트 지연</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.name) + '\n' +
      '예정 납기: ' + (p.endDate ? escHtml(p.endDate) : '-');
  },
  deadline_d3: function (p) {
    return '⏰ <b>납기 D-3</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.name) + '\n' +
      '납기일: ' + escHtml(p.endDate);
  },
  deadline_d1: function (p) {
    return '🔔 <b>내일 납기!</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.name) + '\n' +
      '납기일: ' + escHtml(p.endDate);
  },
  deadline_today: function (p) {
    return '🏁 <b>오늘 납기일</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.name);
  },
  user_pending: function (p) {
    return '👤 <b>신규 가입 승인 요청</b>\n' +
      '이름: ' + escHtml(p.userName) + '\n' +
      (p.department ? '부서: ' + escHtml(p.department) : '');
  },
  milestone_complete: function (p) {
    return '✅ <b>마일스톤 완료</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.milestoneName);
  },
  weekly_report_uploaded: function (p) {
    return '📋 <b>주간업무보고 등록</b>\n' +
      escHtml(p.team || '(팀 미지정)') + (p.weekLabel ? ' <code>' + escHtml(p.weekLabel) + '</code>' : '') + '\n' +
      '총 ' + escHtml(p.count) + '건' +
      (p.done != null ? ' (완료 ' + escHtml(p.done) + ')' : '') +
      (p.uploader ? ' · 작성 ' + escHtml(p.uploader) : '') + '\n' +
      '💡 /wr 로 확인';
  },
  dev_item_assigned: function (p) {
    return '🧩 <b>개발 아이템 배정</b>\n' +
      (p.projectName ? escHtml(p.projectName) + '\n' : '') +
      escHtml(p.title);
  },
  action_item_assigned: function (p) {
    return '📌 <b>액션아이템 배정</b>\n' +
      (p.meetingTitle ? '[' + escHtml(p.meetingTitle) + '] ' : '') + escHtml(p.title) +
      (p.dueDate ? '\n기한: ' + escHtml(p.dueDate) : '');
  },
  action_item_due: function (p) {
    return '⏰ <b>액션아이템 기한 D-1</b>\n' +
      (p.meetingTitle ? '[' + escHtml(p.meetingTitle) + '] ' : '') + escHtml(p.title) +
      '\n기한: ' + escHtml(p.dueDate);
  },
  prestudy_assigned: function (p) {
    return '🔍 <b>사전검토 배정</b>\n' +
      (p.client ? '[' + escHtml(p.client) + '] ' : '') + escHtml(p.title) +
      (p.dueDate ? '\n회신기한: ' + escHtml(p.dueDate) : '');
  },
  prestudy_due: function (p) {
    return '⏰ <b>사전검토 회신기한 D-1</b>\n' +
      (p.client ? '[' + escHtml(p.client) + '] ' : '') + escHtml(p.title) +
      '\n기한: ' + escHtml(p.dueDate);
  },
  prestudy_won: function (p) {
    return '🎉 <b>사전검토 확정</b>\n' +
      (p.client ? '[' + escHtml(p.client) + '] ' : '') + escHtml(p.title) +
      '\n프로젝트/수주로 전환되었습니다.';
  },
  tech_assigned: function (p) {
    return '🧪 <b>요소기술 담당 배정</b>\n' +
      (p.code ? '<code>' + escHtml(p.code) + '</code> ' : '') + escHtml(p.name);
  },
  tech_log_added: function (p) {
    return '📓 <b>요소기술 개발일지</b>\n' +
      (p.code ? '<code>' + escHtml(p.code) + '</code> ' : '') + escHtml(p.name) + '\n' +
      (p.authorName ? '작성: ' + escHtml(p.authorName) : '') +
      (p.progress != null ? ' · 진척 ' + escHtml(p.progress) + '%' : '') +
      (p.content ? '\n📝 ' + noteToTgHtml(String(p.content).slice(0, 300)) : '');
  },
  tech_status_changed: function (p) {
    return '🔄 <b>요소기술 상태 변경</b>\n' +
      (p.code ? '<code>' + escHtml(p.code) + '</code> ' : '') + escHtml(p.name) + '\n' +
      escHtml(p.fromLabel) + ' → <b>' + escHtml(p.toLabel) + '</b>' +
      (p.trl != null ? ' (TRL ' + escHtml(p.trl) + ')' : '');
  },
  tech_stale: function (p) {
    return '🕸 <b>요소기술 일지 미작성</b>\n' +
      (p.code ? '<code>' + escHtml(p.code) + '</code> ' : '') + escHtml(p.name) + '\n' +
      escHtml(p.days) + '일간 개발일지가 없습니다.';
  },
  event_today: function (p) {
    // p.content는 호출자가 조립한 사전-안전 HTML — raw 유지
    return '☀️ <b>오늘 브리핑</b>\n\n' + (p.content || '');
  },
  order_delivery_d7: function (p) {
    return '📦 <b>납품 D-7</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + (p.client ? escHtml(p.client) : '') + '\n' +
      '납품일: ' + escHtml(p.delivery);
  },
  order_delivery_d3: function (p) {
    return '📦 <b>납품 D-3!</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + (p.client ? escHtml(p.client) : '') + '\n' +
      '납품일: ' + escHtml(p.delivery);
  },
  weekly_digest: function (p) {
    // p.content는 호출자가 조립한 사전-안전 HTML — raw 유지
    return '📊 <b>주간 다이제스트</b>\n\n' + (p.content || '');
  },
  progress_warning: function (p) {
    return '📉 <b>진행률 경고</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.name) + '\n' +
      '현재 ' + escHtml(p.progress) + '% (기대 ' + escHtml(p.expected) + '%)';
  },
  // ─── A/S 모듈 (v13.49) ───
  as_received: function (p) {
    var icon = p.priority === 'P1' ? '🚨' : p.priority === 'P2' ? '🔴' : '🟡';
    return icon + ' <b>A/S 신규 접수</b>\n' +
      '[' + escHtml(p.ticketNo) + '] ' + escHtml(p.priority) + ' · ' + (p.customerName ? escHtml(p.customerName) : '') + '\n' +
      (p.equipmentModel ? escHtml(p.equipmentModel) + '\n' : '') +
      '카테고리: ' + (p.categoryLabel ? escHtml(p.categoryLabel) : (p.category ? escHtml(p.category) : '-')) + '\n' +
      '증상: ' + escHtml((p.summary || '').slice(0, 100));
  },
  as_assigned: function (p) {
    return '📌 <b>A/S 할당</b>\n' +
      '[' + escHtml(p.ticketNo) + '] ' + escHtml(p.priority) + ' · ' + (p.customerName ? escHtml(p.customerName) : '') + '\n' +
      '담당: ' + (p.assignee ? escHtml(p.assignee) : '-') + ' (' + (p.deptLabel ? escHtml(p.deptLabel) : (p.dept ? escHtml(p.dept) : '')) + ')' +
      (p.promisedAt ? '\n약속: ' + escHtml(p.promisedAt) : '');
  },
  as_sla_breach: function (p) {
    return '⏰ <b>A/S SLA 초과</b>\n' +
      '[' + escHtml(p.ticketNo) + '] ' + escHtml(p.priority) + ' · ' + (p.customerName ? escHtml(p.customerName) : '') + '\n' +
      '경과 ' + escHtml(p.elapsedH) + 'h (' + escHtml(p.priority) + ' 목표 ' + escHtml(p.slaH) + 'h)';
  },
  as_customer_wait: function (p) {
    return '📞 <b>A/S 고객 확인 D+3 미회신</b>\n' +
      '[' + escHtml(p.ticketNo) + '] ' + (p.customerName ? escHtml(p.customerName) : '');
  },
  as_report_issued: function (p) {
    return '📄 <b>A/S 보고서 발행</b>\n' +
      '[' + escHtml(p.ticketNo) + '] ' + (p.customerName ? escHtml(p.customerName) : '') + '\n' +
      '발행자: ' + (p.author ? escHtml(p.author) : '-');
  },
  as_weekly_digest: function (p) {
    // p.content는 호출자가 조립한 사전-안전 HTML — raw 유지
    return p.content || '📊 <b>A/S 주간 요약</b>';
  },
  // ─── 코멘트/프로젝트 이벤트 (v13.x) ───
  comment_added: function (p) {
    return '💬 <b>새 피드백</b>\n' +
      (p.targetName ? escHtml(p.targetName) + '\n' : '') +
      (p.authorName ? '작성: ' + escHtml(p.authorName) + '\n' : '') +
      escHtml((p.body || '').slice(0, 300));
  },
  message_received: function (p) {
    return '✉️ <b>새 메시지</b>\n' +
      (p.fromName ? escHtml(p.fromName) + ' 님\n' : '') +
      escHtml((p.body || '').slice(0, 300));
  },
  project_created: function (p) {
    return '🆕 <b>프로젝트 생성</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.projectName || p.name);
  },
  project_updated: function (p) {
    return '✏️ <b>프로젝트 수정</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.projectName || p.name) +
      (p.summary ? '\n' + escHtml(p.summary) : '');
  },
  milestone_progress: function (p) {
    return '📈 <b>마일스톤 진척 보고</b>\n' +
      (p.projectName ? escHtml(p.projectName) + '\n' : '') +
      (p.milestoneName ? escHtml(p.milestoneName) + '\n' : '') +
      '진척률: ' + escHtml(p.progress) + '%' +
      (p.hours ? ' · 투입 ' + escHtml(p.hours) + 'h' : '') +
      (p.authorName ? '\n보고: ' + escHtml(p.authorName) : '') +
      (p.note ? '\n📝 ' + noteToTgHtml(p.note) : '');
  }
};

/**
 * 알림 발송
 * @param {string} eventType - 이벤트 유형
 * @param {object} payload - 이벤트 데이터
 * @param {number[]} targetUserIds - 수신 대상 user_id 배열
 */
/** 인앱 알림 생성 */
async function createInAppNotification(userId, eventType, title, body, link, tenantId) {
  try {
    await db.query(
      'INSERT INTO in_app_notifications (tenant_id, user_id, event_type, title, body, link) VALUES ($1, $2, $3, $4, $5, $6)',
      [tenantId || null, userId, eventType, title, body || null, link || null]
    );
  } catch (e) {
    // 테이블이 없으면 무시
    if (e.code !== '42P01') console.error('[InApp] Error:', e.message);
  }
}

/** 이메일 알림 발송 */
async function sendEmailNotification(userId, eventType, payload, tenantId) {
  try {
    // 이메일 알림 설정 확인 — tenant_id가 제공되면 격리 필터 추가
    var prefR;
    if (tenantId) {
      prefR = await db.query(
        "SELECT is_enabled FROM notification_prefs WHERE user_id = $1 AND channel = 'email' AND event_type = $2 AND tenant_id = $3",
        [userId, eventType, tenantId]
      );
    } else {
      prefR = await db.query(
        "SELECT is_enabled FROM notification_prefs WHERE user_id = $1 AND channel = 'email' AND event_type = $2",
        [userId, eventType]
      );
    }
    if (prefR.rows.length > 0 && !prefR.rows[0].is_enabled) return;

    var userR = await db.query('SELECT email, name FROM users WHERE id = $1', [userId]);
    if (!userR.rows.length || !userR.rows[0].email) return;

    var template = TEMPLATES[eventType];
    if (!template) return;

    var text = template(payload);
    // HTML 태그를 이메일 호환으로 변환
    var htmlBody = text.replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>')
      .replace(/\n/g, '<br>');

    var subject = EVENT_TITLES[eventType] || eventType;
    await emailService.sendMail(userR.rows[0].email, subject, htmlBody);
  } catch (e) {
    console.error('[EmailNotify] Error:', e.message);
  }
}

/** 이벤트별 제목 (이메일/인앱용) */
var EVENT_TITLES = {
  message_received: '새 메시지가 도착했습니다',
  issue_assigned: '이슈가 배정되었습니다',
  issue_status_changed: '이슈 상태가 변경되었습니다',
  project_delayed: '프로젝트가 지연되고 있습니다',
  deadline_d3: '납기 D-3 알림',
  deadline_d1: '내일 납기일입니다',
  deadline_today: '오늘 납기일입니다',
  user_pending: '신규 가입 승인 요청',
  milestone_complete: '마일스톤이 완료되었습니다',
  weekly_report_uploaded: '주간업무보고가 등록되었습니다',
  dev_item_assigned: '개발 아이템이 배정되었습니다',
  action_item_assigned: '액션아이템이 배정되었습니다',
  action_item_due: '액션아이템 기한이 임박했습니다',
  prestudy_assigned: '사전검토가 배정되었습니다',
  prestudy_due: '사전검토 회신기한이 임박했습니다',
  prestudy_won: '사전검토가 확정되었습니다',
  tech_assigned: '요소기술 담당으로 배정되었습니다',
  tech_log_added: '요소기술 개발일지가 등록되었습니다',
  tech_status_changed: '요소기술 상태가 변경되었습니다',
  tech_stale: '요소기술 개발일지가 오래 비어 있습니다',
  order_delivery_d7: '납품 D-7 알림',
  order_delivery_d3: '납품 D-3 알림',
  weekly_digest: '주간 다이제스트',
  progress_warning: '진행률 경고',
  as_received: 'A/S 신규 접수',
  as_assigned: 'A/S 할당',
  as_sla_breach: 'A/S SLA 초과',
  as_customer_wait: 'A/S 고객 확인 미회신',
  as_report_issued: 'A/S 보고서 발행',
  as_weekly_digest: 'A/S 주간 요약',
  comment_added: '새 피드백이 등록되었습니다',
  project_created: '프로젝트가 생성되었습니다',
  project_updated: '프로젝트가 수정되었습니다',
  milestone_progress: '마일스톤 진척이 보고되었습니다'
};

// 이벤트별 텔레그램 인라인 버튼 옵션 — 순수 함수 (side-effect 없음)
function buildTelegramSendOpts(eventType, payload) {
  var sendOpts = {};
  if (eventType === 'issue_assigned' && payload.issueId) {
    sendOpts.reply_markup = JSON.stringify({
      inline_keyboard: [
        [
          { text: '🔵 대응 시작', callback_data: 'issue_start:' + payload.issueId },
          { text: '✅ 해결 완료', callback_data: 'issue_resolve:' + payload.issueId }
        ]
      ]
    });
  }
  if (eventType === 'dev_item_assigned' && payload.devItemId) {
    sendOpts.reply_markup = JSON.stringify({
      inline_keyboard: [[{ text: '🔵 진행 시작', callback_data: 'dev_start:' + payload.devItemId }]]
    });
  }
  if ((eventType === 'action_item_assigned' || eventType === 'action_item_due') && payload.actionId) {
    sendOpts.reply_markup = JSON.stringify({
      inline_keyboard: [[{ text: '✅ 완료', callback_data: 'action_done:' + payload.actionId }]]
    });
  }
  if (eventType === 'user_pending' && payload.pendingUserId) {
    sendOpts.reply_markup = JSON.stringify({
      inline_keyboard: [
        [
          { text: '✅ 승인', callback_data: 'approve_user:' + payload.pendingUserId },
          { text: '❌ 반려', callback_data: 'reject_user:' + payload.pendingUserId }
        ]
      ]
    });
  }
  return sendOpts;
}

// 텔레그램 발송 대상 해석 — 알림설정/연동/중복 배치 조회 후 맵 반환
// userTenantMap: { [userId]: tenant_id } — 단일 테넌트면 SQL에 직접 강제 필터, 다중이면 user_id 기반 + 결과 검증
async function resolveTelegramTargets(targetUserIds, eventType, payloadStr, userTenantMap) {
  // user_id가 곧 tenant 결합 키이므로 user_id ANY 조회는 그 자체로 격리됨.
  // 다만 방어적으로 결과 row의 tenant_id가 userTenantMap[user_id]와 일치하는지 검증.
  function tenantOk(userId, rowTenantId) {
    if (!userTenantMap) return true; // 레거시 호환
    var expected = userTenantMap[userId];
    if (!expected) return true; // 누락 사용자는 통과 (레거시 데이터)
    if (!rowTenantId) return true; // 행에 tenant_id 미설정(레거시 row) → 통과
    return rowTenantId === expected;
  }

  var prefR = await db.query(
    'SELECT user_id, is_enabled, tenant_id FROM notification_prefs WHERE user_id = ANY($1) AND channel = \'telegram\' AND event_type = $2',
    [targetUserIds, eventType]
  );
  var disabledSet = {};
  prefR.rows.forEach(function (r) {
    if (!tenantOk(r.user_id, r.tenant_id)) return;
    if (!r.is_enabled) disabledSet[r.user_id] = true;
  });

  var linkR = await db.query(
    'SELECT user_id, chat_id, tenant_id FROM telegram_links WHERE user_id = ANY($1) AND is_active = TRUE',
    [targetUserIds]
  );
  var chatMap = {};
  linkR.rows.forEach(function (r) {
    if (!tenantOk(r.user_id, r.tenant_id)) return;
    chatMap[r.user_id] = r.chat_id;
  });

  var dupR = await db.query(
    "SELECT user_id, tenant_id FROM notification_logs WHERE user_id = ANY($1) AND event_type = $2 AND payload = $3 AND status = 'sent' AND created_at > NOW() - INTERVAL '5 minutes'",
    [targetUserIds, eventType, payloadStr]
  );
  var dupSet = {};
  dupR.rows.forEach(function (r) {
    if (!tenantOk(r.user_id, r.tenant_id)) return;
    dupSet[r.user_id] = true;
  });

  return { disabledSet: disabledSet, chatMap: chatMap, dupSet: dupSet };
}

async function notify(eventType, payload, targetUserIds) {
  if (!targetUserIds || targetUserIds.length === 0) return;

  var template = TEMPLATES[eventType];
  if (!template) {
    console.warn('[Notification] Unknown event type:', eventType);
    return;
  }

  var text = template(payload);
  var inAppTitle = EVENT_TITLES[eventType] || eventType;
  var plainText = text.replace(/<[^>]+>/g, '');
  var payloadStr = JSON.stringify(payload);

  // ─── P0-1: 사용자별 tenant_id 매핑 1회 조회 (멀티테넌트 격리) ───
  var userTenantMap = {};
  try {
    var uR = await db.query('SELECT id, tenant_id FROM users WHERE id = ANY($1)', [targetUserIds]);
    uR.rows.forEach(function (r) { userTenantMap[r.id] = r.tenant_id; });
  } catch (e) {
    console.error('[Notification] tenant map query error:', e.message);
  }

  // 인앱 + 이메일은 fire-and-forget (응답 차단 안 함)
  targetUserIds.forEach(function (userId) {
    var tId = userTenantMap[userId] || null;
    createInAppNotification(userId, eventType, inAppTitle, plainText, null, tId);
    sendEmailNotification(userId, eventType, payload, tId);
  });

  // 텔레그램 미설정 시 스킵
  if (!telegramService.isConfigured()) return;

  // 배치 쿼리: 알림 설정 + 텔레그램 연동 + 중복 체크를 한 번에
  try {
    var targets = await resolveTelegramTargets(targetUserIds, eventType, payloadStr, userTenantMap);
    var disabledSet = targets.disabledSet;
    var chatMap = targets.chatMap;
    var dupSet = targets.dupSet;

    // 인라인 버튼 생성 (이벤트별)
    var sendOpts = buildTelegramSendOpts(eventType, payload);

    // 병렬 발송
    var sendPromises = targetUserIds.map(function (userId) {
      if (disabledSet[userId]) return Promise.resolve();
      var chatId = chatMap[userId];
      if (!chatId) return Promise.resolve();
      if (dupSet[userId]) return Promise.resolve();
      var tId = userTenantMap[userId] || null;

      return telegramService.sendMessage(chatId, text, sendOpts).then(function (result) {
        var status = (result && result.ok) ? 'sent' : 'failed';
        var errorDetail = (result && !result.ok) ? result.description : null;

        // 403 (봇 차단) → 비활성화
        if (result && result.error_code === 403) {
          db.query('UPDATE telegram_links SET is_active = FALSE WHERE chat_id = $1', [chatId]);
          status = 'failed';
          errorDetail = 'Bot blocked by user';
        }

        // 로그 기록 (tenant_id 포함, 마이그레이션으로 nullable 컬럼 추가됨)
        db.query(
          'INSERT INTO notification_logs (user_id, chat_id, event_type, payload, status, error_detail, tenant_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [userId, chatId, eventType, payloadStr, status, errorDetail, tId]
        );

        // ─── P0-5: 실패는 telegram.service.callApi에서 429/5xx 1회 재시도까지 완료된 결과.
        //         여기서 추가 재시도하지 않음 (큐/DLQ는 P1 작업).
      }).catch(function (err) {
        console.error('[Notification] Error sending to user', userId, err.message);
        db.query(
          'INSERT INTO notification_logs (user_id, chat_id, event_type, payload, status, error_detail, tenant_id) VALUES ($1, NULL, $2, $3, \'failed\', $4, $5)',
          [userId, eventType, payloadStr, err.message, tId]
        ).catch(function () {});
      });
    });

    await Promise.allSettled(sendPromises);
  } catch (err) {
    console.error('[Notification] Batch query error:', err.message);
  }
}

/** 관리자 전원에게 알림 */
async function notifyAdmins(eventType, payload) {
  var r = await db.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  var ids = r.rows.map(function (row) { return row.id; });
  return notify(eventType, payload, ids);
}

/** 프로젝트 이해관계자(활성 멤버 전체 + 소유자) + 관리자에게 알림 */
async function notifyProjectStakeholders(eventType, payload, projectId) {
  var ids = new Set();
  // 활성 프로젝트 멤버 전체 (PL·assignee 포함)
  var memR = await db.query(
    "SELECT user_id FROM project_members WHERE project_id = $1 AND released_at IS NULL",
    [projectId]
  );
  memR.rows.forEach(function (r) { ids.add(r.user_id); });

  // 프로젝트 소유자
  try {
    var ownR = await db.query('SELECT owner_id FROM projects WHERE id = $1', [projectId]);
    if (ownR.rows[0] && ownR.rows[0].owner_id) ids.add(ownR.rows[0].owner_id);
  } catch (e) { /* owner_id 없을 수 있음 */ }

  // 관리자
  var adminR = await db.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  adminR.rows.forEach(function (r) { ids.add(r.id); });

  await notify(eventType, payload, Array.from(ids));

  // 프로젝트 그룹 채팅방에도 발송 (P0-1: tenant_id 격리 — 프로젝트 행의 tenant_id 사용)
  if (projectId) {
    var template = TEMPLATES[eventType];
    if (template) {
      var projTenantId = null;
      try {
        var pTR = await db.query('SELECT tenant_id FROM projects WHERE id = $1', [projectId]);
        projTenantId = pTR.rows.length ? pTR.rows[0].tenant_id : null;
      } catch (e) {
        console.error('[Notification] project tenant lookup error:', e.message);
      }
      notifyGroup('project', projectId, template(payload), projTenantId).catch(function (e) {
        console.error('[Notification] Group notify error:', e.message);
      });
    }
  }
}

/** 납기 리마인더 (매일 실행) */
async function sendDeadlineReminders() {
  var today = new Date().toISOString().slice(0, 10);

  var checks = [
    { days: 3, event: 'deadline_d3' },
    { days: 1, event: 'deadline_d1' },
    { days: 0, event: 'deadline_today' }
  ];

  for (var i = 0; i < checks.length; i++) {
    var c = checks[i];
    var targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + c.days);
    var dateStr = targetDate.toISOString().slice(0, 10);

    var projects = await db.query(
      "SELECT id, name, order_no, end_date, assignees, created_by FROM projects WHERE end_date = $1 AND status NOT IN ('done', 'hold')",
      [dateStr]
    );

    for (var j = 0; j < projects.rows.length; j++) {
      var p = projects.rows[j];
      var payload = { name: p.name, orderNo: p.order_no, endDate: p.end_date };
      await notifyProjectStakeholders(c.event, payload, p.id);
    }
  }

  console.log('[Notification] Deadline reminders sent for', today);
}

/** 일일 브리핑 (매일 08:30 KST 실행) */
async function sendDailyBriefing() {
  // tenant_id는 user_id 단위로 자연 격리됨 (users.tenant_id 결합). notification_prefs/telegram_links는 user_id로 필터.
  var today = new Date().toISOString().slice(0, 10);
  var todayCompact = today.replace(/-/g, '');

  // 연동된 활성 사용자 조회
  var users = await db.query(
    "SELECT tl.chat_id, tl.user_id, u.name FROM telegram_links tl JOIN users u ON u.id = tl.user_id WHERE tl.is_active = TRUE AND u.status = 'active'"
  );
  if (!users.rows.length) {
    console.log('[Notification] Daily briefing — no active linked users');
    return;
  }

  // ─── N+1 제거: 사용자 무관 쿼리는 루프 밖에서 1회만 실행 ───
  // 1) 오늘 일정 / 오늘 납기는 모든 사용자에게 동일 → 1회 조회
  var evtR = await db.query(
    "SELECT title, type FROM events WHERE start_date <= $1 AND end_date >= $1 ORDER BY start_date LIMIT 5",
    [today]
  );
  var dlR = await db.query(
    "SELECT name, order_no FROM projects WHERE end_date = $1 AND status != 'done'",
    [todayCompact]
  );
  // 2) 알림 설정: telegram/event_today 행을 한 번에 받아 user_id → is_enabled 맵
  var prefRows = await db.query(
    "SELECT user_id, is_enabled FROM notification_prefs WHERE channel = 'telegram' AND event_type = 'event_today'"
  );
  var prefMap = {};
  prefRows.rows.forEach(function(p) { prefMap[p.user_id] = p.is_enabled; });
  // 3) 사용자별 긴급 미해결 이슈 매핑 — issue_assignees(매핑 테이블) 활용으로 N+1/메모리 필터 제거
  //    user_id 매칭이 우선이고, 누락 시 assignee_name 폴백. 백필 누락 row는 결과 제외 (동명이인 제거).
  var userIds = users.rows.map(function (u) { return u.user_id; });
  var userNames = users.rows.map(function (u) { return u.name; });
  var iaR = await db.query(
    "SELECT i.id, i.title, ia.user_id, ia.assignee_name " +
    "FROM issues i " +
    "JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.tenant_id = i.tenant_id " +
    "WHERE i.status NOT IN ('resolved','closed') AND i.urgency = 'urgent' " +
    "  AND (ia.user_id = ANY($1) OR ia.assignee_name = ANY($2))",
    [userIds, userNames]
  );
  var urgentByUser = {}; // user_id → [{id, title}]
  iaR.rows.forEach(function (r) {
    // user_id 매칭이 정확 — 우선 그것으로 매핑
    if (r.user_id) {
      (urgentByUser[r.user_id] = urgentByUser[r.user_id] || []).push({ id: r.id, title: r.title });
    }
  });
  // user_id 매핑이 없는 case는 assignee_name으로 폴백 매핑
  var byName = {};
  iaR.rows.forEach(function (r) {
    if (!r.user_id && r.assignee_name) {
      (byName[r.assignee_name] = byName[r.assignee_name] || []).push({ id: r.id, title: r.title });
    }
  });
  users.rows.forEach(function (u) {
    if ((!urgentByUser[u.user_id] || urgentByUser[u.user_id].length === 0) && byName[u.name]) {
      urgentByUser[u.user_id] = byName[u.name];
    }
  });

  // 공통 메시지 조각 — 일정/납기는 사용자 공통이므로 미리 조립
  var typeIcons = { milestone:'◆', meeting:'🤝', deadline:'🏁', trip:'✈️', fieldService:'🔧', periodicChk:'🛠️', dayoff:'🌴', amoff:'🌅', pmoff:'🌇', etc:'📌' };
  var evtBlock = '';
  if (evtR.rows.length > 0) {
    evtBlock += '📅 <b>오늘 일정</b>\n';
    evtR.rows.forEach(function(e) {
      evtBlock += '  ' + (typeIcons[e.type] || '📌') + ' ' + e.title + '\n';
    });
    evtBlock += '\n';
  }
  var dlBlock = '';
  if (dlR.rows.length > 0) {
    dlBlock += '🏁 <b>오늘 납기</b>\n';
    dlR.rows.forEach(function(r) { dlBlock += '  · ' + (r.order_no || '') + ' ' + r.name + '\n'; });
    dlBlock += '\n';
  }

  for (var i = 0; i < users.rows.length; i++) {
    var usr = users.rows[i];
    try {
      // 알림 설정 확인 (행이 존재하고 비활성인 경우만 스킵 — 기존 동작 유지)
      if (Object.prototype.hasOwnProperty.call(prefMap, usr.user_id) && !prefMap[usr.user_id]) continue;

      var msg = '';

      // 오늘 일정 (공통)
      msg += evtBlock;

      // 미해결 긴급 이슈 — issue_assignees 기반 사전 매핑에서 직접 조회 (최대 3건)
      var userIssues = (urgentByUser[usr.user_id] || []).slice(0, 3);
      if (userIssues.length > 0) {
        msg += '🔴 <b>긴급 이슈 ' + userIssues.length + '건</b>\n';
        userIssues.forEach(function(r) { msg += '  · ' + escHtml(r.title) + '\n'; });
        msg += '\n';
      }

      // 오늘 납기 (공통)
      msg += dlBlock;

      if (!msg) {
        msg = '✨ 오늘은 특별한 일정이 없습니다. 좋은 하루 되세요!';
      }

      var fullMsg = '☀️ <b>' + usr.name + '님, 좋은 아침입니다!</b>\n\n' + msg;
      await telegramService.sendMessage(usr.chat_id, fullMsg);

    } catch (err) {
      console.error('[DailyBriefing] Error for user', usr.name, err.message);
    }
  }
  console.log('[Notification] Daily briefing sent for', today);
}

/** 수주 납품 리마인더 (매일 실행) */
async function sendOrderDeliveryReminders() {
  var checks = [
    { days: 7, event: 'order_delivery_d7' },
    { days: 3, event: 'order_delivery_d3' }
  ];

  for (var i = 0; i < checks.length; i++) {
    var c = checks[i];
    var targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + c.days);
    // Try multiple date formats
    var dateISO = targetDate.toISOString().slice(0, 10);
    var dateCompact = dateISO.replace(/-/g, '');

    var orders = await db.query(
      "SELECT order_no, client, name, delivery, manager FROM orders WHERE delivery = $1 OR delivery = $2",
      [dateISO, dateCompact]
    );

    for (var j = 0; j < orders.rows.length; j++) {
      var o = orders.rows[j];
      // manager가 있으면 해당 사용자에게, 없으면 관리자에게
      if (o.manager) {
        var uR = await db.query("SELECT id FROM users WHERE name = $1 AND status = 'active'", [o.manager]);
        if (uR.rows.length > 0) {
          await notify(c.event, { orderNo: o.order_no, client: o.client || o.name, delivery: o.delivery }, [uR.rows[0].id]);
        }
      } else {
        await notifyAdmins(c.event, { orderNo: o.order_no, client: o.client || o.name, delivery: o.delivery });
      }
    }
  }
  console.log('[Notification] Order delivery reminders sent');
}

/** 주간 다이제스트 (매주 월요일 실행) */
async function sendWeeklyDigest() {
  // tenant_id는 user_id 단위로 자연 격리됨 (users.tenant_id 결합).
  // 지난주 범위
  var now = new Date();
  var day = now.getDay();
  var lastMon = new Date(now);
  lastMon.setDate(now.getDate() - (day === 0 ? 13 : day + 6));
  var lastSun = new Date(lastMon);
  lastSun.setDate(lastMon.getDate() + 6);

  function fmt(d) { return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  var start = fmt(lastMon);
  var end = fmt(lastSun);

  // 팀 통계
  var totalR = await db.query(
    'SELECT COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT name) as people FROM work_records WHERE date >= $1 AND date <= $2',
    [start, end]
  );
  var t = totalR.rows[0];

  // 이슈 통계
  var newIssues = await db.query("SELECT COUNT(*) as cnt FROM issues WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '7 days')", [lastMon.toISOString().slice(0,10)]);
  var resolvedIssues = await db.query("SELECT COUNT(*) as cnt FROM issues WHERE resolved_date >= $1 AND resolved_date <= $2", [start, end]);

  // 지연 프로젝트
  var delayed = await db.query("SELECT COUNT(*) as cnt FROM projects WHERE status = 'delayed'");

  // 요소기술 — 지난주 개발일지 활동 (모듈 미적용 시 조용히 스킵)
  var techLine = '';
  try {
    var techR = await db.query(
      "SELECT COUNT(DISTINCT tech_id)::int AS techs, COUNT(*)::int AS logs, COALESCE(SUM(hours),0) AS hours " +
      "FROM tech_logs WHERE deleted_at IS NULL AND created_at >= $1::date AND created_at < ($1::date + INTERVAL '7 days')",
      [lastMon.toISOString().slice(0, 10)]
    );
    var tg = techR.rows[0];
    if (tg && tg.logs > 0) {
      techLine = '🧪 요소기술: <b>' + tg.techs + '건</b> 진행 (일지 ' + tg.logs + '건 · ' +
        Math.round(parseFloat(tg.hours) * 10) / 10 + 'h)\n';
    }
  } catch (e) {
    if (e.code !== '42P01') console.error('[WeeklyDigest/tech]', e.message);
  }

  var content = '⏱ 팀 총 투입: <b>' + Math.round(parseFloat(t.hours) * 10) / 10 + 'h</b> (' + t.people + '명)\n';
  content += techLine;
  content += '✅ 해결 이슈: <b>' + resolvedIssues.rows[0].cnt + '건</b>\n';
  content += '🔴 신규 이슈: <b>' + newIssues.rows[0].cnt + '건</b>\n';
  if (parseInt(delayed.rows[0].cnt) > 0) {
    content += '⚠️ 지연 프로젝트: <b>' + delayed.rows[0].cnt + '건</b>\n';
  }

  // 모든 연동 사용자에게 발송
  var users = await db.query(
    "SELECT tl.chat_id, tl.user_id, u.name FROM telegram_links tl JOIN users u ON u.id = tl.user_id WHERE tl.is_active = TRUE AND u.status = 'active'"
  );

  for (var i = 0; i < users.rows.length; i++) {
    var usr = users.rows[i];
    try {
      var prefR = await db.query(
        "SELECT is_enabled FROM notification_prefs WHERE user_id = $1 AND channel = 'telegram' AND event_type = 'weekly_digest'",
        [usr.user_id]
      );
      if (prefR.rows.length > 0 && !prefR.rows[0].is_enabled) continue;

      var msg = '📊 <b>주간 다이제스트</b>\n' +
        '<code>' + lastMon.toLocaleDateString('ko') + ' ~ ' + lastSun.toLocaleDateString('ko') + '</code>\n\n' + content;
      await telegramService.sendMessage(usr.chat_id, msg);
    } catch (err) {
      console.error('[WeeklyDigest] Error for user', usr.name, err.message);
    }
  }
  console.log('[Notification] Weekly digest sent');
}

/** 진행률 경고 (매일 실행) — 기대 진행률보다 20%p 이상 뒤처진 프로젝트 */
async function sendProgressWarnings() {
  var today = new Date();
  var projects = await db.query(
    "SELECT id, name, order_no, start_date, end_date, progress FROM projects WHERE status = 'active' AND start_date IS NOT NULL AND end_date IS NOT NULL"
  );

  for (var i = 0; i < projects.rows.length; i++) {
    var p = projects.rows[i];
    try {
      var startD = new Date(p.start_date.slice(0, 4) + '-' + p.start_date.slice(4, 6) + '-' + p.start_date.slice(6, 8));
      var endD = new Date(p.end_date.slice(0, 4) + '-' + p.end_date.slice(4, 6) + '-' + p.end_date.slice(6, 8));
      var totalDays = Math.max((endD - startD) / 86400000, 1);
      var elapsed = Math.max((today - startD) / 86400000, 0);
      var expected = Math.min(Math.round(elapsed / totalDays * 100), 100);
      var actual = p.progress || 0;

      if (expected - actual >= 20) {
        await notifyProjectStakeholders('progress_warning', {
          name: p.name, orderNo: p.order_no, progress: actual, expected: expected
        }, p.id);
      }
    } catch (_) { /* skip */ }
  }
  console.log('[Notification] Progress warnings sent');
}

/** 과부하 경고 (매일 18:00 실행) — 금주 일평균 9h 초과 */
async function sendOverloadWarnings() {
  var now = new Date();
  var day = now.getDay();
  var diffMon = day === 0 ? -6 : 1 - day;
  var mon = new Date(now);
  mon.setDate(now.getDate() + diffMon);
  function fmt(d) { return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  var start = fmt(mon);
  var end = fmt(now);

  var r = await db.query(
    'SELECT name, COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT date) as days FROM work_records WHERE date >= $1 AND date <= $2 GROUP BY name HAVING COUNT(DISTINCT date) >= 3',
    [start, end]
  );

  var overloaded = r.rows.filter(function (row) {
    return row.days > 0 && parseFloat(row.hours) / row.days > 9;
  });

  if (overloaded.length > 0) {
    var msg = '⚠️ <b>과부하 경고</b>\n\n';
    overloaded.forEach(function (row) {
      var avg = Math.round(parseFloat(row.hours) / row.days * 10) / 10;
      msg += '· ' + row.name + ' — 일평균 <b>' + avg + 'h</b> (' + row.days + '일간 ' + Math.round(parseFloat(row.hours) * 10) / 10 + 'h)\n';
    });

    // 관리자에게 알림
    var admins = await db.query("SELECT id FROM users WHERE role IN ('admin','manager') AND status = 'active'");
    var adminIds = admins.rows.map(function (a) { return a.id; });

    for (var i = 0; i < adminIds.length; i++) {
      var linkR = await db.query('SELECT chat_id FROM telegram_links WHERE user_id = $1 AND is_active = TRUE', [adminIds[i]]);
      if (linkR.rows.length > 0) {
        await telegramService.sendMessage(linkR.rows[0].chat_id, msg);
      }
    }
  }
  console.log('[Notification] Overload warnings sent');
}

/** 회의 액션아이템 기한 D-1 리마인더 (매일 실행) */
async function sendActionItemReminders() {
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var dateStr = tomorrow.toISOString().slice(0, 10);

  var r = await db.query(
    "SELECT a.id, a.title, a.assignee_id, a.due_date, m.title AS meeting_title " +
    "FROM meeting_action_items a JOIN meetings m ON m.id = a.meeting_id AND m.tenant_id = a.tenant_id " +
    "WHERE a.status <> 'done' AND a.assignee_id IS NOT NULL AND a.due_date = $1",
    [dateStr]
  );
  for (var i = 0; i < r.rows.length; i++) {
    var a = r.rows[i];
    try {
      await notify('action_item_due', {
        actionId: a.id, title: a.title, meetingTitle: a.meeting_title, dueDate: a.due_date
      }, [a.assignee_id]);
    } catch (e) {
      console.error('[ActionReminder]', a.id, e.message);
    }
  }
  console.log('[Notification] Action item D-1 reminders checked:', r.rows.length);
}

/** 사전검토 회신기한 D-1 리마인더 (매일 실행) */
async function sendPrestudyReminders() {
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var dateStr = tomorrow.toISOString().slice(0, 10);

  var r = await db.query(
    "SELECT id, title, client, owner_id, due_date FROM prestudies " +
    "WHERE deleted_at IS NULL AND owner_id IS NOT NULL AND due_date = $1 " +
    "  AND status NOT IN ('won','dropped')",
    [dateStr]
  );
  for (var i = 0; i < r.rows.length; i++) {
    var p = r.rows[i];
    try {
      await notify('prestudy_due', { prestudyId: p.id, title: p.title, client: p.client, dueDate: p.due_date }, [p.owner_id]);
    } catch (e) {
      console.error('[PrestudyReminder]', p.id, e.message);
    }
  }
  console.log('[Notification] Prestudy D-1 reminders checked:', r.rows.length);
}

/**
 * 요소기술 일지 미작성 리마인더 (주 1회 실행)
 * 진행중(developing/verifying)인데 STALE_DAYS 이상 개발일지가 없는 기술 → 담당자.
 * 일지가 한 건도 없으면 기술 생성일 기준으로 판단한다.
 */
async function sendTechStaleReminders() {
  var STALE_DAYS = 30;
  var r = await db.query(
    "SELECT t.id, t.code, t.name, t.owner_id, " +
    "  GREATEST(0, EXTRACT(DAY FROM (NOW() - COALESCE(l.last_at, t.created_at)))::int) AS days " +
    "FROM tech_assets t " +
    "LEFT JOIN (SELECT tech_id, MAX(created_at) AS last_at FROM tech_logs WHERE deleted_at IS NULL GROUP BY tech_id) l " +
    "  ON l.tech_id = t.id " +
    "WHERE t.deleted_at IS NULL AND t.owner_id IS NOT NULL " +
    "  AND t.status IN ('developing','verifying') " +
    "  AND COALESCE(l.last_at, t.created_at) < NOW() - INTERVAL '" + STALE_DAYS + " days'"
  );
  for (var i = 0; i < r.rows.length; i++) {
    var t = r.rows[i];
    try {
      await notify('tech_stale', { code: t.code, name: t.name, days: t.days }, [t.owner_id]);
    } catch (e) {
      console.error('[TechStale]', t.id, e.message);
    }
  }
  console.log('[Notification] Tech stale reminders checked:', r.rows.length);
}

/** 그룹 채팅방에 알림 발송 — P0-1: tenantId 필수 (멀티테넌트 격리) */
async function notifyGroup(linkType, linkId, text, tenantId) {
  if (!tenantId) {
    console.warn('[Notification] notifyGroup called without tenantId — skipped', linkType, linkId);
    return;
  }
  try {
    var r = await db.query(
      'SELECT chat_id FROM telegram_group_links WHERE link_type = $1 AND link_id = $2 AND tenant_id = $3 AND is_active = TRUE',
      [linkType, linkId, tenantId]
    );
    for (var i = 0; i < r.rows.length; i++) {
      await telegramService.sendMessage(r.rows[i].chat_id, text);
    }
  } catch (err) {
    console.error('[Notification] Group send error:', err.message);
  }
}

module.exports = {
  notify: notify,
  notifyAdmins: notifyAdmins,
  notifyProjectStakeholders: notifyProjectStakeholders,
  notifyGroup: notifyGroup,
  sendDeadlineReminders: sendDeadlineReminders,
  sendDailyBriefing: sendDailyBriefing,
  sendOrderDeliveryReminders: sendOrderDeliveryReminders,
  sendWeeklyDigest: sendWeeklyDigest,
  sendProgressWarnings: sendProgressWarnings,
  sendOverloadWarnings: sendOverloadWarnings,
  sendActionItemReminders: sendActionItemReminders,
  sendPrestudyReminders: sendPrestudyReminders,
  sendTechStaleReminders: sendTechStaleReminders,
  TEMPLATES: TEMPLATES
};
