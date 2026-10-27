// 마인드맵 사용 권한 — admin 자동 + user_settings 'mindmap_access'.enabled 부여 사용자 (PRD_마인드맵 2.1)
// operator.js 와 같은 패턴
var db = require('../config/db');

async function hasMindmapAccessByUser(userId, role) {
  if (role === 'admin') return true;
  if (!userId) return false;
  try {
    var r = await db.query(
      "SELECT value FROM user_settings WHERE user_id = $1 AND key = 'mindmap_access'",
      [userId]
    );
    return !!(r.rows.length && r.rows[0].value && r.rows[0].value.enabled);
  } catch (e) {
    return false;
  }
}

// req.user 기준 사용 권한 여부
function hasMindmapAccess(req) {
  if (!req || !req.user) return Promise.resolve(false);
  return hasMindmapAccessByUser(req.user.sub, req.user.role);
}

async function requireMindmapAccess(req, res, next) {
  try {
    if (await hasMindmapAccess(req)) return next();
    return res.status(403).json({ error: 'FORBIDDEN', message: '마인드맵 사용 권한이 없습니다. 관리자에게 요청하세요.' });
  } catch (e) {
    console.error('[mindmap-access/guard]', e);
    return res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
}

module.exports = {
  hasMindmapAccess: hasMindmapAccess,
  hasMindmapAccessByUser: hasMindmapAccessByUser,
  requireMindmapAccess: requireMindmapAccess
};
