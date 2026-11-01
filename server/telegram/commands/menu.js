/**
 * /menu — 버튼으로 고르는 메뉴 (v13.305). 명령어를 외우지 않아도 되게.
 *   버튼 callback_data 'mn:<키>' → run(키) 가 해당 명령을 실행
 */
var ITEMS = [
  [['mywork', '🎯 내 업무'], ['rec', '💡 지금 할 일']],
  [['today', '📅 오늘'], ['cal', '🗓 이번 주']],
  [['todos', '✏️ 할 일 목록'], ['myproj', '📁 내 프로젝트']],
  [['issues', '🎫 내 이슈'], ['overdue', '⚠️ 지연 · 긴급']],
  [['summary', '⏱ 이번 주 시간'], ['team', '👥 팀 투입']],
  [['howto', '📝 등록하는 법'], ['help', '❓ 전체 명령']]
];

function keyboard() {
  return { inline_keyboard: ITEMS.map(function (row) {
    return row.map(function (it) { return { text: it[1], callback_data: 'mn:' + it[0] }; });
  }) };
}

var HOWTO = '📝 <b>그냥 말로 쓰면 됩니다</b>\n\n' +
  '• "내일 3시 SK 미팅" → 📅 일정\n' +
  '• "금요일까지 견적서 보내기 !긴급" → ✏️ 할 일\n' +
  '• "B2024-001 배선 작업 3시간" → ⏱ 업무일지\n' +
  '• 🎙 음성 메모도 됩니다 (글로 받아 적음)\n' +
  '→ 미리보기에서 <b>✅ 등록</b>을 눌러야 저장됩니다.\n\n' +
  '• "이번 주 누가 제일 바빠?" 처럼 물으면 🤖 AI 가 답합니다.\n' +
  '• 알림에 <b>답장</b>하면: 이슈 → 대응 이력 · 쪽지 → 쪽지 답장 · 피드백 → 답글\n' +
  '• 사진 + 설명 → 이슈 등록 (프로젝트방이면 그 프로젝트로)';

function create(sendMessage) {
  function cmdMenu(chatId) {
    return sendMessage(chatId, '📋 <b>메뉴</b> — 누르면 바로 보여 드립니다', { reply_markup: JSON.stringify(keyboard()) });
  }
  return { cmdMenu: cmdMenu, HOWTO: HOWTO };
}

module.exports = { create: create, keyboard: keyboard, HOWTO: HOWTO, ITEMS: ITEMS };
