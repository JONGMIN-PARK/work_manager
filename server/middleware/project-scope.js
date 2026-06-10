/**
 * project-scope.js
 *
 * 프로젝트 가시성 정책(v13.31)을 다른 라우트(마일스톤·체크리스트·이슈·문서·일정·수주 등)에서도
 * 일관되게 적용하기 위한 공유 헬퍼.
 *
 * 가시성 룰: owner / project_members(active) / visibility='tenant' / (visibility='dept' AND 부서 일치)
 * — admin/executive 우회 없음.
 */

/**
 * 사용자가 접근 가능한 projects.id 들의 SQL 서브쿼리 + 파라미터를 반환.
 *
 * 사용 예:
 *   var ps = require('../middleware/project-scope');
 *   var sub = ps.accessibleProjectsSubquery(req, 1);  // $2부터 시작
 *   var sql = "SELECT * FROM milestones WHERE tenant_id = $1 "
 *           + "AND project_id IN (" + sub.sql + ")";
 *   var params = [req.tenant.id].concat(sub.params);
 *   // 추가 조건은 sub.nextIdx 부터 사용
 *
 * @param {Request} req — express request (req.user, req.tenant 필요)
 * @param {number} startIdx — 서브쿼리에 사용할 첫 placeholder 번호 ($N)
 * @returns {{ sql: string, params: any[], nextIdx: number }}
 */
function accessibleProjectsSubquery(req, startIdx) {
  var userId = req.user.sub;
  var tenantId = req.tenant.id;
  var deptId = req.user.departmentId || null;
  var idx = startIdx;
  // admin 또는 운영자(전체보기): 가시성 우회 — 테넌트 전체 프로젝트
  if (req.user.role === 'admin' || req._operatorAll === true) {
    var tAll = '$' + (idx++);
    return { sql: "SELECT p.id FROM projects p WHERE p.tenant_id = " + tAll, params: [tenantId], nextIdx: idx };
  }
  var u = '$' + (idx++);
  var t = '$' + (idx++);
  var d = deptId ? '$' + (idx++) : null;

  var sql = "SELECT DISTINCT p.id FROM projects p "
    + "LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = " + u + " AND pm.released_at IS NULL "
    + "WHERE p.tenant_id = " + t
    + " AND (p.owner_id = " + u + " OR pm.user_id IS NOT NULL OR p.visibility = 'tenant'"
    + (d ? " OR (p.visibility = 'dept' AND p.department_id = " + d + ")" : "")
    + ")";

  var params = deptId ? [userId, tenantId, deptId] : [userId, tenantId];
  return { sql: sql, params: params, nextIdx: idx };
}

/**
 * 접근 가능한 프로젝트의 order_no 들의 SQL 서브쿼리.
 * 수주(orders) 가시성 — 수주 자체는 project_id 컬럼이 없고 order_no로 프로젝트와 연결됨.
 */
function accessibleOrderNosSubquery(req, startIdx) {
  var userId = req.user.sub;
  var tenantId = req.tenant.id;
  var deptId = req.user.departmentId || null;
  var idx = startIdx;
  // admin 또는 운영자(전체보기): 가시성 우회 — 테넌트 전체 수주번호
  if (req.user.role === 'admin' || req._operatorAll === true) {
    var tAll = '$' + (idx++);
    return { sql: "SELECT DISTINCT p.order_no FROM projects p WHERE p.tenant_id = " + tAll + " AND p.order_no IS NOT NULL AND p.order_no <> ''", params: [tenantId], nextIdx: idx };
  }
  var u = '$' + (idx++);
  var t = '$' + (idx++);
  var d = deptId ? '$' + (idx++) : null;

  var sql = "SELECT DISTINCT p.order_no FROM projects p "
    + "LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = " + u + " AND pm.released_at IS NULL "
    + "WHERE p.tenant_id = " + t + " AND p.order_no IS NOT NULL AND p.order_no <> '' "
    + "AND (p.owner_id = " + u + " OR pm.user_id IS NOT NULL OR p.visibility = 'tenant'"
    + (d ? " OR (p.visibility = 'dept' AND p.department_id = " + d + ")" : "")
    + ")";

  var params = deptId ? [userId, tenantId, deptId] : [userId, tenantId];
  return { sql: sql, params: params, nextIdx: idx };
}

module.exports = {
  accessibleProjectsSubquery: accessibleProjectsSubquery,
  accessibleOrderNosSubquery: accessibleOrderNosSubquery
};
