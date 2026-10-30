/**
 * A/S 도메인 정책 상수 — SLA 기준 및 색상 매핑.
 *
 * 정책(응답/방문/마감 시간, 색상)을 통계 로직(as-stats.js)에서 분리.
 * 변경 시 이 파일만 수정. 프론트엔드 config.js 의 AS_PRIORITY 와 값을 동일하게 유지할 것.
 *
 * SLA[priority]:
 *   responseH  — 1차 응답 SLA (시간)
 *   visitH     — 방문 SLA (시간, null = 방문 SLA 없음)
 *   closeDays  — 마감 SLA (일). 초과 + status≠closed = breach
 *   color/label — 표시용
 */
var SLA = {
  P1: { responseH: 1,  visitH: 24,  closeDays: 3,  color: '#EF4444', label: 'P1 긴급' },
  P2: { responseH: 4,  visitH: 72,  closeDays: 7,  color: '#F97316', label: 'P2 높음' },
  P3: { responseH: 8,  visitH: 168, closeDays: 14, color: '#F59E0B', label: 'P3 보통' },
  P4: { responseH: 24, visitH: null, closeDays: 30, color: '#10B981', label: 'P4 낮음' }
};

var STATUS_COLORS = {
  received: '#6366F1', assigned: '#0EA5E9', in_progress: '#3B82F6',
  reporting: '#8B5CF6', approved: '#A855F7', customer_wait: '#F59E0B',
  closed: '#10B981', hold: '#94A3B8', cancelled: '#64748B'
};

var WARRANTY_COLORS = { '보증 내': '#10B981', '보증 종료': '#EF4444', '확인 필요': '#94A3B8' };

var METHOD_COLORS = { 원격지원: '#3B82F6', 출장: '#F59E0B', RMA: '#EF4444', 가이드제공: '#06B6D4', 자료송부: '#8B5CF6' };

/** SLA 위반 판정 CASE 식 — SLA[].closeDays 로 만든다(통계·주간 요약·스케줄러 공용).
 *  includeClosed: 종결 건도 (종결-접수) 가 기한을 넘었으면 위반으로 센다 */
function slaBreachExpr(includeClosed) {
  var w = [];
  Object.keys(SLA).forEach(function (p) {
    var d = parseInt(SLA[p].closeDays, 10); if (!d) return;
    w.push("WHEN status NOT IN ('closed','cancelled') AND priority='" + p + "' AND received_at < NOW() - INTERVAL '" + d + " days' THEN 1");
  });
  if (includeClosed) Object.keys(SLA).forEach(function (p) {
    var d = parseInt(SLA[p].closeDays, 10); if (!d) return;
    w.push("WHEN status='closed' AND priority='" + p + "' AND closed_at - received_at > INTERVAL '" + d + " days' THEN 1");
  });
  return 'CASE ' + w.join(' ') + ' ELSE 0 END';
}

module.exports = {
  SLA: SLA,
  slaBreachExpr: slaBreachExpr,
  STATUS_COLORS: STATUS_COLORS,
  WARRANTY_COLORS: WARRANTY_COLORS,
  METHOD_COLORS: METHOD_COLORS
};
