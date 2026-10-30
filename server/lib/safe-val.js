/* safe-val.js — 화면이 속성(style · onclick)에 그대로 넣는 값 검사 (저장형 XSS 막기)
 *   safeColor : #rgb · #rrggbb(aa) · rgb()/hsl() · 영문 색 이름만. 아니면 fb
 *   safeId    : 영문 · 숫자 · _ . : - (100자) 만. 아니면 새로 만든 id (gen) */
function safeColor(v, fb) {
  if (v == null || v === '') return fb;
  var s = String(v).trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s) || /^(rgb|hsl)a?\([\d\s.,%]+\)$/i.test(s) || /^[a-z]{3,20}$/i.test(s)) return s;
  return fb;
}
function safeId(v, gen) {
  return (typeof v === 'string' && /^[\w.:-]{1,100}$/.test(v)) ? v : gen();
}
module.exports = { safeColor: safeColor, safeId: safeId };
