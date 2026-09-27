/**
 * 알림 서비스
 * - 이벤트 발생 → 수신자 결정 → 텔레그램 + 이메일 + 인앱 알림 발송
 *
 * 구현은 services/notification/ 아래로 나뉘어 있고, 기존 require('../services/notification.service')
 * 호출부가 그대로 동작하도록 여기서 같은 이름으로 다시 내보낸다.
 *   templates.js — TEMPLATES / EVENT_TITLES / 텔레그램 버튼 (순수)
 *   dispatch.js  — notify / notifyAdmins / notifyProjectStakeholders
 *   jobs.js      — 스케줄 작업 (send*)
 *   groups.js    — notifyGroup (그룹 채팅방)
 */
var templates = require('./notification/templates');
var dispatch = require('./notification/dispatch');
var jobs = require('./notification/jobs');
var groups = require('./notification/groups');

module.exports = {
  notify: dispatch.notify,
  notifyAdmins: dispatch.notifyAdmins,
  notifyProjectStakeholders: dispatch.notifyProjectStakeholders,
  notifyGroup: groups.notifyGroup,
  sendDeadlineReminders: jobs.sendDeadlineReminders,
  sendDailyBriefing: jobs.sendDailyBriefing,
  sendOrderDeliveryReminders: jobs.sendOrderDeliveryReminders,
  sendWeeklyDigest: jobs.sendWeeklyDigest,
  sendProgressWarnings: jobs.sendProgressWarnings,
  sendOverloadWarnings: jobs.sendOverloadWarnings,
  sendActionItemReminders: jobs.sendActionItemReminders,
  sendPrestudyReminders: jobs.sendPrestudyReminders,
  sendTechStaleReminders: jobs.sendTechStaleReminders,
  TEMPLATES: templates.TEMPLATES
};
