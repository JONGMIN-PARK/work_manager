/**
 * record-scope.js — 업무일지(work_records) 역할별 조회/수정/삭제 범위(WHERE 조건) 단일 정의.
 *
 * 정책 (v10.1 "사용자별 업무일지 분리" 이후):
 *   admin                              : 테넌트 전체
 *   manager / executive (부서 있음)     : 소속 부서 사용자들의 레코드 전체 (본인 포함)
 *   그 외 (member, 부서 없는 manager 등) : 본인 레코드만 (user_id = 본인)
 *
 * 사용처: routes/archives.js (GET /records, GET /records/count, PATCH /records/batch,
 *         DELETE /records/batch, DELETE /records), routes/bootstrap.js (최근 업무일지).
 *
 * 이전에는 위 6곳에 같은 분기가 복사되어 있었고 두 군데가 어긋나 있었다:
 *   1) DELETE /records/batch 의 member 분기에만 `OR user_id IS NULL` 이 남아 있었다.
 *      v10.1(675e804)에서 조회/수정 쪽은 이 조건을 지웠는데 삭제 쪽만 누락된 잔재로,
 *      member 가 볼 수도 수정할 수도 없는 테넌트의 "주인 없는" 레코드를 id 로 지울 수 있었다.
 *      → 버그로 판단해 제거 (모든 경로가 동일 범위).
 *   2) DELETE /records 는 ?scope=self (명시적 축소) 와 tenant_id 컬럼이 없는 구배포 폴백을
 *      지원한다 → 의도된 차이라 옵션 forceSelf / hasTenantColumn 으로 유지.
 *
 * @param {import('express').Request} req  req.user{role, sub, departmentId}, req.tenant.id 필요
 * @param {object} [opts]
 * @param {string}  [opts.alias]            테이블 별칭 (예: 'wr' → 'wr.tenant_id'). 기본 없음.
 * @param {number}  [opts.startIdx=1]       첫 placeholder 번호
 * @param {boolean} [opts.forceSelf=false]  역할과 무관하게 본인 레코드로 축소
 * @param {boolean} [opts.hasTenantColumn=true] false 면(구배포) 본인 레코드만, tenant 조건 없이
 * @returns {{ where: string, params: any[], nextIdx: number, scope: 'tenant'|'department'|'self' }}
 *   where 는 'WHERE' 키워드 없는 조건식. 호출부에서 'WHERE ' + where 또는 'AND ' + where 로 붙인다.
 */
function recordScope(req, opts) {
  opts = opts || {};
  var col = opts.alias ? function (c) { return opts.alias + '.' + c; } : function (c) { return c; };
  var idx = opts.startIdx || 1;
  var role = req.user && req.user.role;
  var deptId = (req.user && req.user.departmentId) || null;
  var tenantId = req.tenant && req.tenant.id;
  var userId = req.user && req.user.sub;
  var hasTenant = opts.hasTenantColumn !== false;
  var forceSelf = opts.forceSelf === true;

  if (!hasTenant) {
    return { where: col('user_id') + ' = $' + idx, params: [userId], nextIdx: idx + 1, scope: 'self' };
  }
  if (!forceSelf && role === 'admin') {
    return { where: col('tenant_id') + ' = $' + idx, params: [tenantId], nextIdx: idx + 1, scope: 'tenant' };
  }
  if (!forceSelf && (role === 'manager' || role === 'executive') && deptId) {
    return {
      where: col('tenant_id') + ' = $' + idx + ' AND ' + col('user_id') + ' IN (SELECT id FROM users WHERE department_id = $' + (idx + 1) + ')',
      params: [tenantId, deptId],
      nextIdx: idx + 2,
      scope: 'department'
    };
  }
  return {
    where: col('tenant_id') + ' = $' + idx + ' AND ' + col('user_id') + ' = $' + (idx + 1),
    params: [tenantId, userId],
    nextIdx: idx + 2,
    scope: 'self'
  };
}

module.exports = { recordScope: recordScope };
