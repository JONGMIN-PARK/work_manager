/**
 * 유틸리티 명령어 모듈: /remind, /vote
 *
 * P1 영속화:
 *  - /remind: setTimeout 기반 → DB(telegram_reminders) 영속화 (1분 워커가 fire_at 도래분을 발송)
 *  - /vote: 클릭 echo만 있던 구조 → DB(telegram_votes/telegram_vote_responses) 영속화 + 집계
 */

var db = require('../../config/db');
var escHtml = require('../util/escape').escHtml;

function create(sendMessage) {
  /** 봇 명령어: /remind — 리마인더 (DB 영속화, 1분 워커가 발송) */
  async function cmdRemind(chatId, user, text) {
    var match = text.match(/^(\d+)\s*(m|h|d)\s+(.*)/i);
    if (!match) return sendMessage(chatId, '사용법: /remind 2h 검수 서류 준비');
    var num = parseInt(match[1]);
    var unit = match[2].toLowerCase();
    var reminderMsg = match[3].trim();
    var ms = unit === 'm' ? num * 60000 : unit === 'h' ? num * 3600000 : num * 86400000;
    if (ms > 7 * 86400000) return sendMessage(chatId, '❌ 최대 7일까지 설정 가능합니다.');

    // DB에 pending 리마인더 INSERT — 워커가 fire_at <= NOW() 도래분을 발송
    var fireAt = new Date(Date.now() + ms);
    await db.query(
      "INSERT INTO telegram_reminders (tenant_id, user_id, chat_id, message, fire_at) VALUES ($1, $2, $3, $4, $5)",
      [user.tenant_id || null, user.user_id || null, chatId, reminderMsg, fireAt]
    );

    return sendMessage(chatId, '⏰ 리마인더 설정 완료\n' + num + unit + ' 후: ' + escHtml(reminderMsg));
  }

  /** 봇 명령어: /vote — 팀 투표 (DB 영속화 + 집계) */
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

    // 1) 투표 행 INSERT — voteId 확보
    var voteR = await db.query(
      "INSERT INTO telegram_votes (tenant_id, chat_id, created_by, question, options) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [user.tenant_id || null, chatId, user.user_id || null, question, JSON.stringify(options)]
    );
    var voteId = voteR.rows[0].id;

    // 2) 인라인 버튼: callback_data를 voteId 기반으로 단순화 (vote:{voteId}:{optionIndex})
    //    버튼 label은 텔레그램이 plain text로 처리하므로 escHtml 불필요
    var buttons = options.map(function(opt, i) {
      return [{ text: opt + ' (0)', callback_data: 'vote:' + voteId + ':' + i }];
    });

    // 3) 메시지 발송 — 본문 내 사용자 입력은 escHtml 필수 (parse_mode=HTML)
    var sent = await sendMessage(chatId, '📊 <b>투표</b>\n\n' + escHtml(question), {
      reply_markup: JSON.stringify({ inline_keyboard: buttons })
    });

    // 4) 텔레그램이 반환한 message_id 저장 — 콜백에서 editMessageReplyMarkup용
    if (sent && sent.ok && sent.result && sent.result.message_id) {
      await db.query(
        "UPDATE telegram_votes SET message_id = $1 WHERE id = $2",
        [sent.result.message_id, voteId]
      );
    }

    return sent;
  }

  /** 봇 명령어: /cancelremind — 내가 등록한 pending 리마인더 취소 */
  async function cmdCancelRemind(chatId, user, text) {
    var arg = (text || '').trim();
    // 인자 없음 → 내 pending 리마인더 목록
    if (!arg) {
      var listR = await db.query(
        "SELECT id, message, fire_at FROM telegram_reminders " +
        "WHERE chat_id = $1 AND tenant_id = $2 AND status = 'pending' " +
        "ORDER BY fire_at LIMIT 20",
        [chatId, user.tenant_id || null]
      );
      if (listR.rows.length === 0) {
        return sendMessage(chatId, '⏰ 대기 중인 리마인더가 없습니다.');
      }
      var msg = '⏰ <b>대기 중인 리마인더</b>\n\n';
      listR.rows.forEach(function (r) {
        var when = new Date(r.fire_at).toLocaleString('ko-KR', { hour12: false });
        msg += '#' + r.id + ' · ' + when + '\n  ' + escHtml(r.message) + '\n\n';
      });
      msg += '사용법: /cancelremind &lt;ID&gt;  (또는 /cancelremind all)';
      return sendMessage(chatId, msg);
    }
    // 전체 취소
    if (arg === 'all') {
      var allR = await db.query(
        "UPDATE telegram_reminders SET status = 'cancelled' " +
        "WHERE chat_id = $1 AND tenant_id = $2 AND status = 'pending' RETURNING id",
        [chatId, user.tenant_id || null]
      );
      return sendMessage(chatId, '🔓 대기 리마인더 ' + allR.rowCount + '건을 취소했습니다.');
    }
    // 단건 취소
    var rid = parseInt(arg);
    if (isNaN(rid)) {
      return sendMessage(chatId, '사용법: /cancelremind &lt;ID&gt; (목록은 /cancelremind)');
    }
    var oneR = await db.query(
      "UPDATE telegram_reminders SET status = 'cancelled' " +
      "WHERE id = $1 AND chat_id = $2 AND tenant_id = $3 AND status = 'pending' RETURNING id",
      [rid, chatId, user.tenant_id || null]
    );
    if (oneR.rowCount === 0) {
      return sendMessage(chatId, '❌ 해당 ID의 대기 리마인더를 찾을 수 없습니다.');
    }
    return sendMessage(chatId, '🔓 리마인더 #' + rid + ' 취소됨.');
  }

  /** 봇 명령어: /closevote — 같은 채팅의 최근 활성 투표 종료(또는 ID 지정) */
  async function cmdCloseVote(chatId, user, text) {
    var arg = (text || '').trim();
    var voteId;
    if (arg) {
      voteId = parseInt(arg);
      if (isNaN(voteId)) {
        return sendMessage(chatId, '사용법: /closevote (가장 최근 투표) · /closevote &lt;ID&gt;');
      }
    } else {
      // 같은 채팅의 가장 최근 활성 투표
      var latestR = await db.query(
        "SELECT id FROM telegram_votes " +
        "WHERE chat_id = $1 AND tenant_id = $2 AND is_closed = FALSE " +
        "ORDER BY created_at DESC LIMIT 1",
        [chatId, user.tenant_id || null]
      );
      if (latestR.rows.length === 0) {
        return sendMessage(chatId, '📊 종료할 활성 투표가 없습니다.');
      }
      voteId = latestR.rows[0].id;
    }

    // 권한: 작성자 본인이거나 admin/manager만
    var vR = await db.query(
      "SELECT id, question, options, created_by, message_id FROM telegram_votes " +
      "WHERE id = $1 AND chat_id = $2 AND tenant_id = $3",
      [voteId, chatId, user.tenant_id || null]
    );
    if (vR.rows.length === 0) {
      return sendMessage(chatId, '❌ 해당 투표를 찾을 수 없습니다.');
    }
    var v = vR.rows[0];
    if (v.created_by !== user.user_id && user.role !== 'admin' && user.role !== 'manager') {
      return sendMessage(chatId, '🔒 투표 작성자나 관리자/팀장만 종료할 수 있습니다.');
    }

    await db.query("UPDATE telegram_votes SET is_closed = TRUE WHERE id = $1", [voteId]);

    // 집계
    var options = v.options;
    if (typeof options === 'string') options = JSON.parse(options);
    var aggR = await db.query(
      "SELECT option_index, COUNT(*)::int AS c FROM telegram_vote_responses " +
      "WHERE vote_id = $1 GROUP BY option_index ORDER BY c DESC",
      [voteId]
    );
    var counts = {};
    aggR.rows.forEach(function (r) { counts[r.option_index] = r.c; });
    var total = aggR.rows.reduce(function (s, r) { return s + r.c; }, 0);

    var resultMsg = '📊 <b>투표 종료</b>\n\n' +
      escHtml(v.question) + '\n\n';
    options.forEach(function (opt, i) {
      var c = counts[i] || 0;
      var pct = total > 0 ? Math.round(c * 100 / total) : 0;
      resultMsg += '· ' + escHtml(opt) + ' — <b>' + c + '</b> (' + pct + '%)\n';
    });
    resultMsg += '\n총 ' + total + '표';

    // 기존 인라인 키보드 제거(편집)
    if (v.message_id) {
      var telegramService = require('../../services/telegram.service');
      await telegramService.callApi('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: v.message_id,
        reply_markup: { inline_keyboard: [] }
      }).catch(function () {});
    }
    return sendMessage(chatId, resultMsg);
  }

  return {
    cmdRemind: cmdRemind,
    cmdVote: cmdVote,
    cmdCancelRemind: cmdCancelRemind,
    cmdCloseVote: cmdCloseVote
  };
}

module.exports = { create: create };
