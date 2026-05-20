/**
 * 텔레그램 HTML 메시지용 이스케이프 헬퍼
 *
 * Telegram Bot API의 parse_mode='HTML'은 <b>, <i>, <a>, <code>, <pre> 등만 허용.
 * 사용자 입력에 `<`, `>`, `&`가 포함되면 메시지 전체가 거부되거나(400) 잘못 렌더됨.
 * 모든 사용자 발 입력은 메시지 본문/캡션/콜백 텍스트에 넣기 전에 escHtml()로 감싸야 함.
 *
 * 참고: https://core.telegram.org/bots/api#html-style
 *   The following characters must be replaced with the corresponding HTML entities
 *   (< with &lt;, > with &gt; and & with &amp;).
 */

function escHtml(value) {
  if (value === null || value === undefined) return '';
  var str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { escHtml: escHtml };
