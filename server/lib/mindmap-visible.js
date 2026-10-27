/**
 * 마인드맵 가시성 조건식 — 목록(GET /api/mindmaps)과 내 업무(/api/my-work)가 같은 규칙을 쓴다.
 * v13.249: 소유자 + 보낸 사람(editors · viewers)만. 관리자도 남의 맵은 못 본다. 범위(scope)는 프로젝트 연결 표시용일 뿐.
 * 테넌트 조건은 포함하지 않는다. 별칭은 m.
 *   var v = visibleMapsSql(req, 3);   // $3 부터
 *   sql = '... WHERE m.tenant_id = $1 AND ' + v.sql;  params = [tenantId, x].concat(v.params)
 */
function visibleMapsSql(req, startIdx) {
  var me = '$' + (startIdx || 1);
  return {
    sql: '(m.owner_id = ' + me + ' OR m.editors ? ' + me + '::text OR m.viewers ? ' + me + '::text)',
    params: [req.user.sub],
    nextIdx: (startIdx || 1) + 1
  };
}

module.exports = { visibleMapsSql: visibleMapsSql };
