/**
 * 텔레그램 봇 유틸리티
 */

/** 텍스트 바 차트 */
function textBar(value, max, width) {
  width = width || 16;
  var filled = max > 0 ? Math.round(value / max * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** JSON 필드 안전 파싱 */
function parseJson(value, fallback) {
  if (fallback === undefined) fallback = [];
  try {
    return typeof value === 'string' ? JSON.parse(value) : (value || fallback);
  } catch (_) {
    return fallback;
  }
}

/** 날짜 → YYYYMMDD */
function fmtCompact(d) {
  return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
}

/** 날짜 → YYYY-MM-DD */
function fmtISO(d) {
  return d.toISOString().slice(0, 10);
}

/** 금주 월~일 범위 { start, end, monStr, sunStr } */
function getWeekRange() {
  var now = new Date();
  var day = now.getDay();
  var diffMon = day === 0 ? -6 : 1 - day;
  var mon = new Date(now);
  mon.setDate(now.getDate() + diffMon);
  var sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: fmtCompact(mon), end: fmtCompact(sun), monStr: mon.toLocaleDateString('ko'), sunStr: sun.toLocaleDateString('ko') };
}

/** 이번 달 범위 { start, end, label } */
function getMonthRange() {
  var now = new Date();
  var y = now.getFullYear();
  var m = ('0' + (now.getMonth() + 1)).slice(-2);
  return { start: y + m + '01', end: y + m + '31', label: y + '년 ' + parseInt(m) + '월' };
}

/** 숫자 콤마 포맷 */
function formatNumber(n) {
  if (!n && n !== 0) return '-';
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 긴급도 아이콘 */
function urgencyIcon(urgency) {
  var map = { urgent: '🔴', normal: '🟡', low: '🟢' };
  return map[urgency] || '🟢';
}

module.exports = {
  textBar: textBar,
  parseJson: parseJson,
  fmtCompact: fmtCompact,
  fmtISO: fmtISO,
  getWeekRange: getWeekRange,
  getMonthRange: getMonthRange,
  formatNumber: formatNumber,
  urgencyIcon: urgencyIcon
};
