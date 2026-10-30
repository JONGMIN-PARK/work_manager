/**
 * routes/as-tickets/* 하위 라우터가 함께 쓰는 상수·헬퍼.
 */
var db = require('../../config/db');
var asStatsRouter = require('../as-stats');  // invalidateStats 헬퍼

// ─── 첨부 검증 상수 (모듈 스코프) ───
// A/S 티켓 첨부는 사진·문서·로그 위주 → 화이트리스트 기반 MIME 허용
var ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.ms-excel', // xls
  'application/msword', // doc
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'application/vnd.ms-powerpoint' // ppt
];
// 실행/스크립트/SVG·HTML(XSS 운반체) 등 위험 확장자 차단
var DENY_EXT = /\.(svg|html?|js|mjs|jsx|ts|tsx|vbs|bat|sh|exe|dll|jar|com|cmd|ps1|psm1|app|deb|rpm|dmg|pkg)$/i;
// 첨부 사이즈 상한 (10MB) — express.json limit과 정합
var MAX_FILE_BYTES = 10 * 1024 * 1024;

// 헬퍼: 티켓 변경 시 통계 캐시 무효화 (실패해도 응답엔 영향 없음)
function _invalidateStatsCache(tenantId) {
  try {
    if (asStatsRouter && typeof asStatsRouter.invalidateStats === 'function') {
      asStatsRouter.invalidateStats(tenantId);
    }
  } catch (e) { /* 무시 */ }
}

// ─── 채번 헬퍼: AS-YYYY-MM-### (테넌트별 월별 순번) ───
async function nextTicketNo(tenantId) {
  var now = new Date();
  var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  var prefix = 'AS-' + ym + '-';
  var r = await db.query(
    // 문자열 정렬은 'AS-..-1000' 을 '-999' 보다 작게 본다 → 길이 먼저 비교(같은 접두사라 길수록 큰 순번)
    "SELECT ticket_no FROM as_tickets WHERE tenant_id=$1 AND ticket_no LIKE $2 ORDER BY length(ticket_no) DESC, ticket_no DESC LIMIT 1",
    [tenantId, prefix + '%']
  );
  var nextSeq = 1;
  if (r.rows.length) {
    var last = r.rows[0].ticket_no;
    var tail = parseInt(last.slice(prefix.length), 10);
    if (!isNaN(tail)) nextSeq = tail + 1;
  }
  return prefix + String(nextSeq).padStart(3, '0');
}

// 티켓이 이 테넌트 소유인지 — 하위 항목(할당·로그·부품·첨부·서명) 만들기 전에 확인. 없으면 404 응답 후 false
async function assertTicket(req, res) {
  var r = await db.query('SELECT 1 FROM as_tickets WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
  if (!r.rows.length) { res.status(404).json({ error: 'NOT_FOUND', message: '접수를 찾을 수 없습니다.' }); return false; }
  return true;
}

module.exports = {
  ALLOWED_MIME: ALLOWED_MIME,
  DENY_EXT: DENY_EXT,
  MAX_FILE_BYTES: MAX_FILE_BYTES,
  _invalidateStatsCache: _invalidateStatsCache,
  nextTicketNo: nextTicketNo,
  assertTicket: assertTicket
};
