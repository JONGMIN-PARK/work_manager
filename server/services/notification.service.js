/**
 * 알림 서비스
 * - 이벤트 발생 → 수신자 결정 → 텔레그램 발송
 */
var db = require('../config/db');
var telegramService = require('./telegram.service');

/** 이벤트 메시지 템플릿 */
var TEMPLATES = {
  issue_assigned: function (p) {
    var icon = p.urgency === 'urgent' ? '🔴' : p.urgency === 'normal' ? '🟡' : '🟢';
    return icon + ' <b>이슈 배정</b>\n' +
      (p.projectName ? p.projectName + '\n' : '') +
      '제목: ' + p.title + '\n' +
      '담당: ' + (p.assignee || '-');
  },
  issue_status_changed: function (p) {
    return '🔵 <b>이슈 상태 변경</b>\n' +
      p.title + '\n' +
      p.fromStatus + ' → ' + p.toStatus;
  },
  project_delayed: function (p) {
    return '⚠️ <b>프로젝트 지연</b>\n' +
      (p.orderNo ? '[' + p.orderNo + '] ' : '') + p.name + '\n' +
      '예정 납기: ' + (p.endDate || '-');
  },
  deadline_d3: function (p) {
    return '⏰ <b>납기 D-3</b>\n' +
      (p.orderNo ? '[' + p.orderNo + '] ' : '') + p.name + '\n' +
      '납기일: ' + p.endDate;
  },
  deadline_d1: function (p) {
    return '🔔 <b>내일 납기!</b>\n' +
      (p.orderNo ? '[' + p.orderNo + '] ' : '') + p.name + '\n' +
      '납기일: ' + p.endDate;
  },
  deadline_today: function (p) {
    return '🏁 <b>오늘 납기일</b>\n' +
      (p.orderNo ? '[' + p.orderNo + '] ' : '') + p.name;
  },
  user_pending: function (p) {
    return '👤 <b>신규 가입 승인 요청</b>\n' +
      '이름: ' + p.userName + '\n' +
      (p.department ? '부서: ' + p.department : '');
  },
  milestone_complete: function (p) {
    return '✅ <b>마일스톤 완료</b>\n' +
      (p.orderNo ? '[' + p.orderNo + '] ' : '') + p.milestoneName;
  }
};

/**
 * 알림 발송
 * @param {string} eventType - 이벤트 유형
 * @param {object} payload - 이벤트 데이터
 * @param {number[]} targetUserIds - 수신 대상 user_id 배열
 */
async function notify(eventType, payload, targetUserIds) {
  if (!telegramService.isConfigured()) return;
  if (!targetUserIds || targetUserIds.length === 0) return;

  var template = TEMPLATES[eventType];
  if (!template) {
    console.warn('[Notification] Unknown event type:', eventType);
    return;
  }

  var text = template(payload);

  for (var i = 0; i < targetUserIds.length; i++) {
    var userId = targetUserIds[i];
    try {
      // 알림 설정 확인
      var prefR = await db.query(
        'SELECT is_enabled FROM notification_prefs WHERE user_id = $1 AND channel = \'telegram\' AND event_type = $2',
        [userId, eventType]
      );
      // 설정이 없으면 기본 발송, 있으면 is_enabled 확인
      if (prefR.rows.length > 0 && !prefR.rows[0].is_enabled) continue;

      // 텔레그램 연동 확인
      var linkR = await db.query(
        'SELECT chat_id FROM telegram_links WHERE user_id = $1 AND is_active = TRUE',
        [userId]
      );
      if (linkR.rows.length === 0) continue;

      var chatId = linkR.rows[0].chat_id;

      // 중복 발송 방지 (동일 이벤트 5분 이내)
      var dupR = await db.query(
        "SELECT id FROM notification_logs WHERE user_id = $1 AND event_type = $2 AND payload = $3 AND status = 'sent' AND created_at > NOW() - INTERVAL '5 minutes'",
        [userId, eventType, JSON.stringify(payload)]
      );
      if (dupR.rows.length > 0) continue;

      // 발송
      var result = await telegramService.sendMessage(chatId, text);
      var status = (result && result.ok) ? 'sent' : 'failed';
      var errorDetail = (result && !result.ok) ? result.description : null;

      // 403 (봇 차단) → 비활성화
      if (result && result.error_code === 403) {
        await db.query('UPDATE telegram_links SET is_active = FALSE WHERE chat_id = $1', [chatId]);
        status = 'failed';
        errorDetail = 'Bot blocked by user';
      }

      // 로그 기록
      await db.query(
        'INSERT INTO notification_logs (user_id, chat_id, event_type, payload, status, error_detail) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, chatId, eventType, JSON.stringify(payload), status, errorDetail]
      );

      // 실패 시 1회 재시도
      if (status === 'failed' && errorDetail !== 'Bot blocked by user') {
        var retry = await telegramService.sendMessage(chatId, text);
        if (retry && retry.ok) {
          await db.query(
            'INSERT INTO notification_logs (user_id, chat_id, event_type, payload, status) VALUES ($1, $2, $3, $4, \'sent\')',
            [userId, chatId, eventType, JSON.stringify(payload)]
          );
        }
      }
    } catch (err) {
      console.error('[Notification] Error sending to user', userId, err.message);
      try {
        await db.query(
          'INSERT INTO notification_logs (user_id, chat_id, event_type, payload, status, error_detail) VALUES ($1, NULL, $2, $3, \'failed\', $4)',
          [userId, eventType, JSON.stringify(payload), err.message]
        );
      } catch (_) { /* ignore log failure */ }
    }
  }
}

/** 관리자 전원에게 알림 */
async function notifyAdmins(eventType, payload) {
  var r = await db.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  var ids = r.rows.map(function (row) { return row.id; });
  return notify(eventType, payload, ids);
}

/** 프로젝트 PL + 관리자에게 알림 */
async function notifyProjectStakeholders(eventType, payload, projectId) {
  var ids = new Set();
  // PL 조회
  var plR = await db.query(
    "SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'pl' AND released_at IS NULL",
    [projectId]
  );
  plR.rows.forEach(function (r) { ids.add(r.user_id); });

  // 관리자
  var adminR = await db.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  adminR.rows.forEach(function (r) { ids.add(r.id); });

  return notify(eventType, payload, Array.from(ids));
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

module.exports = {
  notify: notify,
  notifyAdmins: notifyAdmins,
  notifyProjectStakeholders: notifyProjectStakeholders,
  sendDeadlineReminders: sendDeadlineReminders,
  TEMPLATES: TEMPLATES
};
