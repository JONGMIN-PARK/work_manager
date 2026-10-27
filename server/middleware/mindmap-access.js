// 마인드맵 사용 권한 — v13.249 부터 로그인한 모든 사용자 (맵마다 볼 수 있는 사람은 소유자 + 보낸 사람 — routes/mindmaps permsOf)
// 예전 user_settings 'mindmap_access' 값은 남아 있지만 더 이상 보지 않는다.

async function hasMindmapAccessByUser(userId) {
  return !!userId;
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
