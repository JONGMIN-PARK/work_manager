/**
 * 마인드맵 가시성 조건식 — 목록(GET /api/mindmaps)과 내 업무(/api/my-work)가 같은 규칙을 쓴다.
 * 테넌트 조건은 포함하지 않는다. 별칭은 m.
 *   var v = visibleMapsSql(req, 3);   // $3 부터
 *   sql = '... WHERE m.tenant_id = $1 AND ' + v.sql;  params = [tenantId, x].concat(v.params)
 */
var pa = require('./project-access');

function visibleMapsSql(req, startIdx) {
  var idx = startIdx || 1;
  var params = [req.user.sub];
  var me = '$' + idx++;
  var sub = pa.accessibleProjectsSubquery(req, idx);
  params = params.concat(sub.params);
  idx = sub.nextIdx;
  var deptCond = '';
  if (req.user.departmentId) { params.push(req.user.departmentId); deptCond = " OR (m.scope = 'dept' AND m.department_id = $" + idx++ + ')'; }
  var sql = '(m.owner_id = ' + me + ' OR m.editors ? ' + me + '::text OR m.viewers ? ' + me + '::text' +
    " OR m.scope = 'org'" + deptCond +
    " OR (m.scope = 'project' AND m.project_id IN (" + sub.sql + '))' +
    (req.user.role === 'admin' ? " OR m.scope <> 'personal'" : '') + ')';
  return { sql: sql, params: params, nextIdx: idx };
}

module.exports = { visibleMapsSql: visibleMapsSql };
