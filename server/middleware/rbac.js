/**
 * RBAC 미들웨어 — 시스템 등급 + 프로젝트 역할 이중 판정
 */
var db = require('../config/db');

// 프로젝트 PL 여부 확인
async function isProjectPL(userId, projectId) {
  if (!userId || !projectId) return false;
  try {
    var res = await db.query(
      "SELECT 1 FROM project_members WHERE user_id = $1 AND project_id = $2 AND role = 'pl' AND released_at IS NULL LIMIT 1",
      [userId, projectId]
    );
    return res.rows.length > 0;
  } catch (e) {
    return false;
  }
}

// 같은 부서 여부 확인
async function isSameDept(userDeptId, resourceDeptId) {
  if (!userDeptId || !resourceDeptId) return false;
  return userDeptId === resourceDeptId;
}

// 프로젝트 참여자 여부 확인
async function isProjectMember(userId, projectId) {
  if (!userId || !projectId) return false;
  try {
    var res = await db.query(
      "SELECT 1 FROM project_members WHERE user_id = $1 AND project_id = $2 AND released_at IS NULL LIMIT 1",
      [userId, projectId]
    );
    return res.rows.length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * 권한 검사 미들웨어 팩토리
 * @param {string} action — 'project.create', 'project.edit', 'issue.create' 등
 * @param {Function} [getResourceId] — req → projectId 추출 함수 (없으면 req.params.id 또는 req.params.projectId)
 */
function checkPermission(action, getResourceId) {
  return async function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: '인증이 필요합니다.' });
    }

    var role = req.user.role;
    var userId = req.user.sub;

    // admin은 모든 권한
    if (role === 'admin') return next();

    var body = req.body || {};
    var projectId = getResourceId ? getResourceId(req) : (req.params.projectId || req.params.id || body.projectId || body.project_id);
    var pl = projectId ? await isProjectPL(userId, projectId) : false;
    var member = projectId ? await isProjectMember(userId, projectId) : false;

    var allowed = false;

    switch (action) {
      // 프로젝트 (v13.32~ 가시성 정책 도입 후 RBAC 완화)
      // 생성은 모든 인증 사용자 허용. 편집/삭제/멤버 관리는 라우트 핸들러의
      // canAccessProject + owner_id 검사가 실질 게이트 역할 — RBAC는 통과 허용.
      case 'project.create':
        allowed = true;
        break;
      case 'project.edit':
        allowed = true; // 라우트의 canAccessProject 사전 체크에 위임
        break;
      case 'project.delete':
        allowed = true; // 라우트의 canAccessProject 사전 체크에 위임
        break;
      case 'project.read':
        allowed = true; // 가시성 룰은 GET 핸들러 SQL에서 적용
        break;
      case 'project.assign':
        allowed = true; // 멤버 관리 — 라우트에서 owner/PL 추가 검사 필요 시 분기
        break;
      case 'pl.assign':
        allowed = role === 'admin' || role === 'manager' || pl;
        break;

      // 이슈
      case 'issue.create':
        allowed = true; // 모든 인증 사용자
        break;
      case 'issue.edit':
        allowed = role === 'manager' || pl;
        break;
      case 'issue.delete':
        allowed = role === 'manager';
        break;

      // 수주
      case 'order.edit':
        allowed = true; // 모든 인증 사용자 허용
        break;

      // 이벤트
      case 'event.edit':
        allowed = role === 'manager' || role === 'executive' || pl;
        break;

      // 파일
      case 'file.upload':
        allowed = true;
        break;
      case 'file.delete':
        allowed = role === 'manager' || pl;
        break;

      // 업무일지
      case 'archive.manage':
        allowed = true; // 모든 인증 사용자 허용
        break;

      default:
        allowed = false;
    }

    if (!allowed) {
      return res.status(403).json({ error: 'FORBIDDEN', message: '이 작업에 대한 권한이 없습니다.' });
    }

    // 컨텍스트에 추가 정보 보관
    req.rbac = { pl: pl, member: member, projectId: projectId };
    next();
  };
}

module.exports = {
  checkPermission: checkPermission,
  isProjectPL: isProjectPL,
  isProjectMember: isProjectMember,
  isSameDept: isSameDept
};
