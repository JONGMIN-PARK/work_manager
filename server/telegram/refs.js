/**
 * telegram_refs — 봇이 보낸 메시지와 업무 항목을 잇는 표 (v13.302)
 *   kind 'issue'   ref_id = 이슈 id           → 답장은 대응 이력, 사진 · 파일은 첨부
 *   kind 'message' ref_id = 보낸 사람 user id  → 답장은 쪽지 답장
 *   kind 'comment' ref_id = 댓글 id            → 답장은 그 댓글에 답글
 *   kind 'draft'   ref_id = 짧은 키            → 말로 등록 확인 대기 (data = 등록할 내용)
 *   kind 'grouplink' ref_id = 연결 코드        → 그룹방 ↔ 프로젝트 연결 (data = { projectId })
 * 30일 지난 행은 cleanup() 이 지운다.
 */
var crypto = require('crypto');
var db = require('../config/db');

/** 보낸 메시지에 항목 연결을 남김 (실패해도 알림은 그대로) */
async function save(o) {
  try {
    await db.query(
      'INSERT INTO telegram_refs (tenant_id, user_id, chat_id, message_id, kind, ref_id, data) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [o.tenantId || null, o.userId || null, o.chatId || null, o.messageId || null, o.kind, o.refId == null ? null : String(o.refId),
        o.data ? JSON.stringify(o.data) : null]
    );
  } catch (e) {
    if (e.code !== '42P01') console.warn('[tg-refs] save', e.message);
  }
}

/** sendMessage 결과로 바로 남김 */
function remember(sent, o) {
  if (!sent || !sent.ok || !sent.result) return Promise.resolve();
  return save(Object.assign({}, o, { chatId: sent.result.chat && sent.result.chat.id, messageId: sent.result.message_id }));
}

/** 어떤 메시지에 대한 답장인지 — 그 메시지에 연결된 항목 (없으면 null) */
async function findByMessage(chatId, messageId) {
  if (!chatId || !messageId) return null;
  var r = await db.query(
    "SELECT * FROM telegram_refs WHERE chat_id = $1 AND message_id = $2 AND kind IN ('issue','message','comment','chat') ORDER BY id DESC LIMIT 1",
    [chatId, messageId]
  );
  return r.rows[0] || null;
}

function _key() { return crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || String(Date.now()); }

/** 확인 대기 항목 — 키 돌려줌 (버튼 callback_data 에 담김) */
async function putDraft(user, chatId, data) {
  var key = _key();
  await save({ tenantId: user.tenant_id, userId: user.user_id, chatId: chatId, kind: 'draft', refId: key, data: data });
  return key;
}

/** 확인 대기 항목 꺼내기 — 같은 사람 · 24시간 안 · 한 번만 (두 번 눌러도 한 번 등록) */
async function takeDraft(user, key) {
  var r = await db.query(
    "UPDATE telegram_refs SET used_at = now() WHERE kind = 'draft' AND ref_id = $1 AND user_id = $2 AND used_at IS NULL " +
    "AND created_at > now() - INTERVAL '24 hours' RETURNING data",
    [key, user.user_id]
  );
  return r.rows.length ? r.rows[0].data : null;
}
async function peekDraft(user, key) {
  var r = await db.query(
    "SELECT data FROM telegram_refs WHERE kind = 'draft' AND ref_id = $1 AND user_id = $2 AND used_at IS NULL AND created_at > now() - INTERVAL '24 hours'",
    [key, user.user_id]
  );
  return r.rows.length ? r.rows[0].data : null;
}
async function dropDraft(user, key) {
  await db.query("UPDATE telegram_refs SET used_at = now() WHERE kind = 'draft' AND ref_id = $1 AND user_id = $2 AND used_at IS NULL", [key, user.user_id]);
}

/** 그룹방 연결 코드 (30분) */
async function putGroupCode(user, projectId, projectName) {
  var code = 'G' + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
  await save({ tenantId: user.tenantId, userId: user.userId, kind: 'grouplink', refId: code, data: { projectId: projectId, name: projectName || '' } });
  return code;
}
async function takeGroupCode(code) {
  var r = await db.query(
    "UPDATE telegram_refs SET used_at = now() WHERE kind = 'grouplink' AND ref_id = $1 AND used_at IS NULL " +
    "AND created_at > now() - INTERVAL '30 minutes' RETURNING tenant_id, user_id, data",
    [String(code || '').toUpperCase()]
  );
  return r.rows[0] || null;
}

async function cleanup() {
  try { await db.query("DELETE FROM telegram_refs WHERE created_at < now() - INTERVAL '30 days'"); }
  catch (e) { if (e.code !== '42P01') console.warn('[tg-refs] cleanup', e.message); }
}

module.exports = {
  save: save, remember: remember, findByMessage: findByMessage,
  putDraft: putDraft, takeDraft: takeDraft, peekDraft: peekDraft, dropDraft: dropDraft,
  putGroupCode: putGroupCode, takeGroupCode: takeGroupCode, cleanup: cleanup
};
