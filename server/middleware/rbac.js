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

    var projectId = getResourceId ? getResourceId(req) : (req.params.projectId || req.params.id || req.body.projectId || req.body.project_id);
    var pl = projectId ? await isProjectPL(userId, projectId) : false;
    var member = projectId ? await isProjectMember(userId, projectId) : false;

    var allowed = false;

    switch (action) {
      // 프로젝트
      case 'project.create':
        allowed = role === 'manager';
        break;
      case 'project.edit':
        allowed = role === 'manager' || pl;
        break;
      case 'project.delete':
        allowed = role === 'manager';
        break;
      case 'project.read':
        allowed = role === 'executive' || role === 'manager' || pl || member;
        break;
      case 'project.assign':
        allowed = role === 'manager' || pl;
        break;
      case 'pl.assign':
        allowed = role === 'manager';
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
        allowed = role === 'manager';
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
  isProjectMember: isProjectMember
};
