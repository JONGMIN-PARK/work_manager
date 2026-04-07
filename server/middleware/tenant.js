/**
 * 테넌트 스코핑 미들웨어
 * - auth.authenticate 이후에 실행
 * - req.user.tenantId를 기반으로 req.tenant 설정
 * - 모든 DB 쿼리에 tenant_id 필터 추가를 위한 헬퍼 제공
 */

/**
 * tenantScope 미들웨어
 * req.user.tenantId가 존재하면 req.tenant를 설정하고,
 * 없으면 403 에러를 반환한다.
 */
function tenantScope(req, res, next) {
  if (!req.user || !req.user.tenantId) {
    return res.status(403).json({
      error: 'TENANT_REQUIRED',
      message: '테넌트 정보가 없습니다'
    });
  }

  var tenantId = req.user.tenantId;

  req.tenant = { id: tenantId };

  /**
   * SELECT/UPDATE/DELETE 쿼리에 tenant_id 필터를 추가하는 헬퍼
   * @param {object} query - { text, values } 또는 조건 객체
   * @returns {object} tenant_id 조건이 추가된 쿼리 파라미터
   *
   * 사용 예:
   *   var scoped = req.scopeQuery({ text: 'SELECT * FROM tasks WHERE status = $1', values: ['active'] });
   *   // => { text: 'SELECT * FROM tasks WHERE status = $1 AND tenant_id = $2', values: ['active', tenantId] }
   */
  req.scopeQuery = function scopeQuery(query) {
    var paramIndex = (query.values ? query.values.length : 0) + 1;
    var scopedText = query.text + ' AND tenant_id = $' + paramIndex;
    var scopedValues = (query.values || []).concat([tenantId]);
    return { text: scopedText, values: scopedValues };
  };

  next();
}

/**
 * INSERT 쿼리용 헬퍼 — tenant_id 컬럼과 값을 추가
 * @param {string} tenantId - 테넌트 ID
 * @param {object} data - 삽입할 데이터 객체
 * @returns {object} tenant_id가 추가된 데이터 객체
 *
 * 사용 예:
 *   var row = addTenantId(req.tenant.id, { name: 'Task 1', status: 'active' });
 *   // => { name: 'Task 1', status: 'active', tenant_id: tenantId }
 */
function addTenantId(tenantId, data) {
  var result = Object.assign({}, data);
  result.tenant_id = tenantId;
  return result;
}

module.exports = {
  tenantScope: tenantScope,
  addTenantId: addTenantId
};
