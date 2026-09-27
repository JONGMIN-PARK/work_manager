/**
 * 텔레그램 그룹 채팅방 알림 (telegram_group_links). notification.service.js 가 다시 내보낸다.
 */
var db = require('../../config/db');
var telegramService = require('../telegram.service');

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

module.exports = { notifyGroup: notifyGroup };
