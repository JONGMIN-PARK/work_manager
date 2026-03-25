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
  },
  event_today: function (p) {
    return '☀️ <b>오늘 브리핑</b>\n\n' + p.content;
  },
  order_delivery_d7: function (p) {
    return '📦 <b>납품 D-7</b>\n' +
      (p.orderNo ? '[' + p.orderNo + '] ' : '') + (p.client || '') + '\n' +
      '납품일: ' + p.delivery;
  },
  order_delivery_d3: function (p) {
    return '📦 <b>납품 D-3!</b>\n' +
      (p.orderNo ? '[' + p.orderNo + '] ' : '') + (p.client || '') + '\n' +
      '납품일: ' + p.delivery;
  },
  weekly_digest: function (p) {
    return '📊 <b>주간 다이제스트</b>\n\n' + p.content;
  },
  progress_warning: function (p) {
    return '📉 <b>진행률 경고</b>\n' +
      (p.orderNo ? '[' + p.orderNo + '] ' : '') + p.name + '\n' +
      '현재 ' + p.progress + '% (기대 ' + p.expected + '%)';
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

/** 일일 브리핑 (매일 08:30 KST 실행) */
async function sendDailyBriefing() {
  var today = new Date().toISOString().slice(0, 10);
  var todayCompact = today.replace(/-/g, '');

  // 연동된 활성 사용자 조회
  var users = await db.query(
    "SELECT tl.chat_id, tl.user_id, u.name FROM telegram_links tl JOIN users u ON u.id = tl.user_id WHERE tl.is_active = TRUE AND u.status = 'active'"
  );

  for (var i = 0; i < users.rows.length; i++) {
    var usr = users.rows[i];
    try {
      // 알림 설정 확인
      var prefR = await db.query(
        "SELECT is_enabled FROM notification_prefs WHERE user_id = $1 AND channel = 'telegram' AND event_type = 'event_today'",
        [usr.user_id]
      );
      if (prefR.rows.length > 0 && !prefR.rows[0].is_enabled) continue;

      var msg = '';

      // 오늘 일정
      var evtR = await db.query(
        "SELECT title, type FROM events WHERE start_date <= $1 AND end_date >= $1 ORDER BY start_date LIMIT 5",
        [today]
      );
      var typeIcons = { milestone:'◆', meeting:'🤝', deadline:'🏁', trip:'✈️', fieldService:'🔧', periodicChk:'🛠️', dayoff:'🌴', amoff:'🌅', pmoff:'🌇', etc:'📌' };
      if (evtR.rows.length > 0) {
        msg += '📅 <b>오늘 일정</b>\n';
        evtR.rows.forEach(function(e) {
          msg += '  ' + (typeIcons[e.type] || '📌') + ' ' + e.title + '\n';
        });
        msg += '\n';
      }

      // 미해결 이슈
      var issR = await db.query(
        "SELECT title, urgency FROM issues WHERE assignees::text LIKE $1 AND status NOT IN ('resolved','closed') AND urgency = 'urgent' LIMIT 3",
        ['%' + usr.name + '%']
      );
      if (issR.rows.length > 0) {
        msg += '🔴 <b>긴급 이슈 ' + issR.rows.length + '건</b>\n';
        issR.rows.forEach(function(r) { msg += '  · ' + r.title + '\n'; });
        msg += '\n';
      }

      // 오늘 납기
      var dlR = await db.query(
        "SELECT name, order_no FROM projects WHERE end_date = $1 AND status != 'done'",
        [todayCompact]
      );
      if (dlR.rows.length > 0) {
        msg += '🏁 <b>오늘 납기</b>\n';
        dlR.rows.forEach(function(r) { msg += '  · ' + (r.order_no || '') + ' ' + r.name + '\n'; });
        msg += '\n';
      }

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

  var content = '⏱ 팀 총 투입: <b>' + Math.round(parseFloat(t.hours) * 10) / 10 + 'h</b> (' + t.people + '명)\n';
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

module.exports = {
  notify: notify,
  notifyAdmins: notifyAdmins,
  notifyProjectStakeholders: notifyProjectStakeholders,
  sendDeadlineReminders: sendDeadlineReminders,
  sendDailyBriefing: sendDailyBriefing,
  sendOrderDeliveryReminders: sendOrderDeliveryReminders,
  sendWeeklyDigest: sendWeeklyDigest,
  TEMPLATES: TEMPLATES
};
