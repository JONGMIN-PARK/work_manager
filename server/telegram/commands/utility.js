/**
 * 유틸리티 명령어 모듈: /remind, /vote
 */

function create(sendMessage) {
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

  return {
    cmdRemind: cmdRemind,
    cmdVote: cmdVote
  };
}

module.exports = { create: create };
