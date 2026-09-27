/**
 * 알림 발송 — 수신자 결정 → 텔레그램 + 이메일 + 인앱.
 * notify / notifyAdmins / notifyProjectStakeholders. notification.service.js 가 다시 내보낸다.
 */
var db = require('../../config/db');
var telegramService = require('../telegram.service');
var emailService = require('../email.service');
var templates = require('./templates');
var groups = require('./groups');

var TEMPLATES = templates.TEMPLATES;
var EVENT_TITLES = templates.EVENT_TITLES;
var buildTelegramSendOpts = templates.buildTelegramSendOpts;
function notifyGroup(linkType, linkId, text, tenantId) { return groups.notifyGroup(linkType, linkId, text, tenantId); }

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

/** 관리자 전원에게 알림 — 해당 테넌트의 관리자만 (tenantId 필수) */
async function notifyAdmins(eventType, payload, tenantId) {
  if (!tenantId) {
    // 테넌트를 모르면 보내지 않는다. 예전에는 모든 테넌트 관리자에게 발송되어
    // 다른 회사의 프로젝트명·가입자명 등이 새어 나갔다.
    console.warn('[Notification] notifyAdmins called without tenantId — skipped (' + eventType + ')');
    return;
  }
  var r = await db.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND tenant_id = $1", [tenantId]);
  var ids = r.rows.map(function (row) { return row.id; });
  return notify(eventType, payload, ids);
}

/**
 * 여러 프로젝트의 이해관계자를 한 번에 해석 (쿼리 3회, 프로젝트 수와 무관).
 * 반환 Map(projectId → { ids: [활성 멤버..., 소유자, 같은 테넌트 admin...], tenantId })
 * — 순서·구성은 notifyProjectStakeholders 의 단건 조회와 같다. 스케줄 작업(납기·진행률 경고)의 N+1 제거용.
 */
async function resolveStakeholders(projectIds) {
  var out = new Map();
  if (!projectIds || !projectIds.length) return out;
  projectIds.forEach(function (pid) { out.set(pid, { ids: new Set(), tenantId: null }); });
  var memR = await db.query(
    "SELECT project_id, user_id FROM project_members WHERE project_id = ANY($1) AND released_at IS NULL",
    [projectIds]
  );
  memR.rows.forEach(function (r) { var e = out.get(r.project_id); if (e) e.ids.add(r.user_id); });
  var pR = await db.query('SELECT id, owner_id, tenant_id FROM projects WHERE id = ANY($1)', [projectIds]);
  pR.rows.forEach(function (r) {
    var e = out.get(r.id); if (!e) return;
    if (r.owner_id) e.ids.add(r.owner_id);
    e.tenantId = r.tenant_id || null;
  });
  var adminR = await db.query(
    "SELECT p.id AS project_id, u.id FROM users u JOIN projects p ON p.tenant_id = u.tenant_id " +
    "WHERE p.id = ANY($1) AND u.role = 'admin' AND u.status = 'active'",
    [projectIds]
  );
  adminR.rows.forEach(function (r) { var e = out.get(r.project_id); if (e) e.ids.add(r.id); });
  out.forEach(function (e) { e.ids = Array.from(e.ids); });
  return out;
}

/**
 * 프로젝트 이해관계자(활성 멤버 전체 + 소유자) + 관리자에게 알림
 * @param {object} [pre] resolveStakeholders() 결과 항목 { ids, tenantId } — 주면 DB 조회 생략
 */
async function notifyProjectStakeholders(eventType, payload, projectId, pre) {
  var ids;
  var projTenantId = null;
  var haveTenant = false;
  if (pre) {
    ids = pre.ids;
    projTenantId = pre.tenantId;
    haveTenant = true;
  } else {
    var idSet = new Set();
    // 활성 프로젝트 멤버 전체 (PL·assignee 포함)
    var memR = await db.query(
      "SELECT user_id FROM project_members WHERE project_id = $1 AND released_at IS NULL",
      [projectId]
    );
    memR.rows.forEach(function (r) { idSet.add(r.user_id); });

    // 프로젝트 소유자 (+ 그룹 발송용 tenant_id 를 같은 조회로)
    try {
      var ownR = await db.query('SELECT owner_id, tenant_id FROM projects WHERE id = $1', [projectId]);
      if (ownR.rows[0] && ownR.rows[0].owner_id) idSet.add(ownR.rows[0].owner_id);
      projTenantId = ownR.rows.length ? ownR.rows[0].tenant_id : null;
      haveTenant = true;
    } catch (e) { /* owner_id 없을 수 있음 */ }

    // 관리자 — 프로젝트와 같은 테넌트의 관리자만
    var adminR = await db.query(
      "SELECT u.id FROM users u JOIN projects p ON p.tenant_id = u.tenant_id " +
      "WHERE p.id = $1 AND u.role = 'admin' AND u.status = 'active'",
      [projectId]
    );
    adminR.rows.forEach(function (r) { idSet.add(r.id); });
    ids = Array.from(idSet);
  }

  await notify(eventType, payload, ids);

  // 프로젝트 그룹 채팅방에도 발송 (P0-1: tenant_id 격리 — 프로젝트 행의 tenant_id 사용)
  if (projectId) {
    var template = TEMPLATES[eventType];
    if (template) {
      if (!haveTenant) {
        try {
          var pTR = await db.query('SELECT tenant_id FROM projects WHERE id = $1', [projectId]);
          projTenantId = pTR.rows.length ? pTR.rows[0].tenant_id : null;
        } catch (e) {
          console.error('[Notification] project tenant lookup error:', e.message);
        }
      }
      notifyGroup('project', projectId, template(payload), projTenantId).catch(function (e) {
        console.error('[Notification] Group notify error:', e.message);
      });
    }
  }
}

module.exports = {
  notify: notify,
  notifyAdmins: notifyAdmins,
  notifyProjectStakeholders: notifyProjectStakeholders,
  resolveStakeholders: resolveStakeholders,
  createInAppNotification: createInAppNotification,
  sendEmailNotification: sendEmailNotification,
  resolveTelegramTargets: resolveTelegramTargets
};
