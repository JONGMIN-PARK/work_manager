/**
 * project-access.js — 프로젝트 가시성/권한 규칙 단일 정의.
 *
 * 이전에는 같은 규칙이 여러 벌 따로 쓰여 있었다:
 *   - routes/projects.js     GET / 목록 SQL, canAccessProject, canEditProject, /reorder 인라인 SQL
 *   - routes/bootstrap.js    프로젝트 목록 SQL (admin 우회 누락 — 아래 "차이" 참고)
 *   - middleware/project-scope.js  accessibleProjectsSubquery / accessibleOrderNosSubquery
 *                            (milestones·issues·documents·events·checklists·meetings·dev-items·bootstrap)
 *   - routes/milestones.js   _canEditProject(projectId)
 *   - routes/comments.js     canAccessProject(projectId)  ← 더 좁은 "협업" 규칙
 *
 * ── 규칙 ─────────────────────────────────────────────────────────────────
 * 읽기(가시성, v13.31 + v13.113):
 *   admin                         → 테넌트 전체
 *   그 외                          → owner · 활성 project_members · visibility='tenant'
 *                                   · (visibility='dept' AND 부서 일치)
 *   운영자(operator_mode)          → canRead 는 허용. 목록 SQL 은 req._operatorAll 이 켜진
 *                                   경우에만 전체 (milestones GET 이 켠다; /api/projects/all 은 별도).
 * 편집(v13.145): admin · executive · owner · 활성 project_members  (가시성만으로는 편집 불가)
 * 협업(코멘트):   admin · 운영자 · owner · 활성 project_members  (가시성·executive 로는 불가)
 *
 * ── 복사본 사이의 차이와 결정 ─────────────────────────────────────────────
 *  1) bootstrap 프로젝트 목록만 admin 우회가 없었다. v13.113(638f32e)에서 GET /api/projects 와
 *     canAccessProject 에 admin 전체 접근을 넣을 때 bootstrap 이 누락된 것. 같은 bootstrap 응답의
 *     milestones/events 는 이미 admin 전체였고, admin 은 GET /api/projects 로 전체를 받을 수 있으므로
 *     새로 노출되는 데이터는 없다 → visibleProjectsSql 로 통일 (admin 은 bootstrap 에서도 전체).
 *  2) milestones._canEditProject 는 admin/executive 면 프로젝트 존재 확인 전에 true 를 돌려,
 *     POST /milestones/:id/transfer 가 존재하지 않거나 **다른 테넌트의** projectId 로 마일스톤을
 *     옮길 수 있었다 → canEditById 는 모든 역할에서 먼저 테넌트 내 존재를 확인한다(없으면 null).
 *  3) comments 의 규칙은 의도적으로 더 좁다(가시성 공개만으로 코멘트 불가) → canComment 로 분리 유지.
 *  4) PUT /projects/:id/specs 는 v13.160~195 동안 owner + admin/executive 만(멤버 제외)이었다.
 *     v13.196 표준 사양서부터 설계·전장·SW 가 함께 채우도록 canEdit(참여자 포함)으로 통일.
 */
var db = require('../config/db');
var operator = require('../middleware/operator');

function _deptId(req) { return (req.user && req.user.departmentId) || null; }

/**
 * 프로젝트 가시성 조건식 (WHERE 에 AND 로 붙인다). 테넌트 조건은 포함하지 않는다.
 *   var v = visibleProjectsSql(req, 'p', 3);
 *   sql = '... WHERE p.tenant_id = $1 AND ' + v.sql;  params = [tenantId, x].concat(v.params)
 *
 * @param {import('express').Request} req
 * @param {string} [alias='p'] projects 테이블 별칭
 * @param {number} [startIdx=1] 첫 placeholder 번호
 * @returns {{ sql: string, params: any[], nextIdx: number }}  admin/전체보기 운영자는 sql='TRUE'
 */
function visibleProjectsSql(req, alias, startIdx) {
  var a = alias || 'p';
  var idx = startIdx || 1;
  if (req.user.role === 'admin' || req._operatorAll === true) {
    return { sql: 'TRUE', params: [], nextIdx: idx };
  }
  var deptId = _deptId(req);
  var u = '$' + (idx++);
  var d = deptId ? '$' + (idx++) : null;
  var sql = '(' + a + '.owner_id = ' + u
    + ' OR ' + a + ".visibility = 'tenant'"
    + (d ? ' OR (' + a + ".visibility = 'dept' AND " + a + '.department_id = ' + d + ')' : '')
    + ' OR EXISTS (SELECT 1 FROM project_members _pm WHERE _pm.project_id = ' + a + '.id AND _pm.user_id = ' + u + ' AND _pm.released_at IS NULL)'
    + ')';
  return { sql: sql, params: deptId ? [req.user.sub, deptId] : [req.user.sub], nextIdx: idx };
}

/**
 * 편집 가능한 프로젝트 조건식 (canEdit 의 SQL 판). 테넌트 조건 미포함.
 * admin/executive 는 'TRUE'.
 */
function editableProjectsSql(req, alias, startIdx) {
  var a = alias || 'p';
  var idx = startIdx || 1;
  var role = req.user.role;
  if (role === 'admin' || role === 'executive') return { sql: 'TRUE', params: [], nextIdx: idx };
  var u = '$' + (idx++);
  return {
    sql: '(' + a + '.owner_id = ' + u + ' OR EXISTS (SELECT 1 FROM project_members _pm WHERE _pm.project_id = ' + a + '.id AND _pm.user_id = ' + u + ' AND _pm.released_at IS NULL))',
    params: [req.user.sub],
    nextIdx: idx
  };
}

/**
 * 접근 가능한 projects.id 서브쿼리 (테넌트 조건 포함). 기존 middleware/project-scope 와 같은 계약.
 *   var sub = accessibleProjectsSubquery(req, 2);
 *   sql += ' AND project_id IN (' + sub.sql + ')'; params = params.concat(sub.params); idx = sub.nextIdx;
 */
function accessibleProjectsSubquery(req, startIdx) {
  var idx = startIdx;
  var t = '$' + (idx++);
  var v = visibleProjectsSql(req, 'p', idx);
  return {
    sql: 'SELECT p.id FROM projects p WHERE p.tenant_id = ' + t + ' AND ' + v.sql,
    params: [req.tenant.id].concat(v.params),
    nextIdx: v.nextIdx
  };
}

/** 접근 가능한 프로젝트의 order_no 서브쿼리 (수주 가시성 — orders 는 order_no 로 연결). */
function accessibleOrderNosSubquery(req, startIdx) {
  var idx = startIdx;
  var t = '$' + (idx++);
  var v = visibleProjectsSql(req, 'p', idx);
  return {
    sql: "SELECT DISTINCT p.order_no FROM projects p WHERE p.tenant_id = " + t
      + " AND p.order_no IS NOT NULL AND p.order_no <> '' AND " + v.sql,
    params: [req.tenant.id].concat(v.params),
    nextIdx: v.nextIdx
  };
}

async function _isActiveMember(projectId, userId) {
  var mr = await db.query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND released_at IS NULL LIMIT 1', [projectId, userId]);
  return mr.rows.length > 0;
}

/**
 * 단일 프로젝트 행 읽기 권한. project 는 같은 테넌트에서 조회한 행 {id, owner_id, visibility, department_id}.
 * @param {object} [opts] { isMember: true|false } — 멤버 여부를 이미 알면 DB 조회 생략
 */
async function canRead(req, project, opts) {
  if (!project) return false;
  if (req.user.role === 'admin') return true;   // 관리자: 전체 프로젝트 접근 (v13.113)
  var userId = req.user.sub;
  var deptId = _deptId(req);
  if (project.owner_id === userId) return true;
  if (project.visibility === 'tenant') return true;
  if (project.visibility === 'dept' && deptId && project.department_id === deptId) return true;
  if (opts && opts.isMember === true) return true;
  // 부여된 운영자: 읽기 접근 허용 (멤버 아님 확정 전에 체크)
  try { if (await operator.isOperator(req)) return true; } catch (_) {}
  if (opts && opts.isMember === false) return false;
  return _isActiveMember(project.id, userId);
}

/**
 * 단일 프로젝트 행 편집/삭제/멤버관리 권한 (v13.145): admin · executive · owner · 활성 멤버.
 */
async function canEdit(req, project) {
  if (!project) return false;
  var role = req.user.role;
  if (role === 'admin' || role === 'executive') return true;
  if (project.owner_id === req.user.sub) return true;
  return _isActiveMember(project.id, req.user.sub);
}

/**
 * projectId 로 편집 권한 판정. 반환: true / false / null(이 테넌트에 프로젝트 없음).
 * 모든 역할에서 존재 확인을 먼저 한다 (차이 2 참고).
 */
async function canEditById(req, projectId) {
  if (!projectId) return null;
  var pr = await db.query('SELECT id, owner_id FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, req.tenant.id]);
  if (!pr.rows.length) return null;
  return canEdit(req, pr.rows[0]);
}

/**
 * 코멘트 접근/작성 권한 (협업 규칙): admin · 운영자 · owner · 활성 멤버.
 * 가시성 공개(tenant/dept)나 executive 만으로는 허용하지 않는다 — routes/comments.js 기존 규칙 그대로.
 */
async function canComment(req, projectId) {
  if (!projectId) return false;
  if (req.user.role === 'admin') return true;
  try { if (await operator.isOperator(req)) return true; } catch (_) {}
  var pr = await db.query('SELECT owner_id FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, req.tenant.id]);
  if (!pr.rows.length) return false;
  if (pr.rows[0].owner_id === req.user.sub) return true;
  return _isActiveMember(projectId, req.user.sub);
}

module.exports = {
  visibleProjectsSql: visibleProjectsSql,
  editableProjectsSql: editableProjectsSql,
  accessibleProjectsSubquery: accessibleProjectsSubquery,
  accessibleOrderNosSubquery: accessibleOrderNosSubquery,
  canRead: canRead,
  canEdit: canEdit,
  canEditById: canEditById,
  canComment: canComment
};
