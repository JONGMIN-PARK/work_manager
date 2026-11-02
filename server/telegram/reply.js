/**
 * 알림에 답장하기 (v13.302)
 *   이슈 알림 ← 답장: 대응 이력 · 사진 · 파일: 문서관리에 저장하고 대응 이력에 첨부 표시
 *   쪽지 알림 ← 답장: 보낸 사람에게 쪽지
 *   피드백 알림 ← 답장: 그 피드백에 답글
 * 알림을 받은 본인의 답장만 받는다 (telegram_refs.user_id).
 */
var refs = require('./refs');
var actions = require('./actions');
var files = require('./files');
var escHtml = require('./util/escape').escHtml;

/**
 * @param {object} c { chatId, user, msg, text, send }  text 는 글 · 사진 설명 · 음성을 글로 바꾼 것
 * @returns {Promise<boolean>} 답장으로 처리했으면 true
 */
async function handle(c) {
  var rt = c.msg && c.msg.reply_to_message;
  if (!rt || !rt.from || !rt.from.is_bot) return false;
  var ref = await refs.findByMessage(c.chatId, rt.message_id);
  if (!ref) return false;
  if (ref.user_id && ref.user_id !== c.user.user_id) {
    await c.send(c.chatId, '🔒 이 알림을 받은 사람만 답장으로 처리할 수 있습니다.');
    return true;
  }
  var text = String(c.text || '').trim();
  var file = files.pickFile(c.msg);
  var out;

  if (ref.kind === 'issue') {
    if (file) {
      var row = await actions.gateIssue(c.user, ref.ref_id, 'read');
      if (!row) { await c.send(c.chatId, '⚠️ 이 이슈를 볼 수 없습니다.'); return true; }
      var saved = await files.saveToDocs(c.user, file, row.project_id, '이슈 첨부 — ' + (row.title || ''));
      var note = saved.ok ? '📎 ' + saved.name + ' (문서관리)' : '📎 텔레그램 ' + (file.kind === 'photo' ? '사진' : '파일') + ' — ' + files.failText(saved.reason);
      out = await actions.issueLog(c.user, ref.ref_id, text || (file.kind === 'photo' ? '사진 첨부' : '파일 첨부'), note);
      if (out.ok) out.text += '\n' + escHtml(note);
    } else if (text) {
      out = await actions.issueLog(c.user, ref.ref_id, text);
    } else return false;
  } else if (ref.kind === 'message') {
    if (!text) { await c.send(c.chatId, '✉️ 쪽지에는 글만 보낼 수 있습니다.'); return true; }
    out = await actions.sendMessage(c.user, ref.ref_id, text);
  } else if (ref.kind === 'chat') {   // v13.315 메신저 알림에 답장 → 그 대화방으로
    if (!text) { await c.send(c.chatId, '💬 메신저에는 글로 답장해 주세요.'); return true; }
    out = await actions.chatReply(c.user, ref.ref_id, text);
  } else if (ref.kind === 'comment') {
    if (!text) { await c.send(c.chatId, '💬 답글은 글로 적어 주세요.'); return true; }
    out = await actions.replyComment(c.user, ref.ref_id, text);
  } else return false;

  await c.send(c.chatId, out.text || out.toast, { reply_to_message_id: c.msg.message_id });
  return true;
}

module.exports = { handle: handle };
