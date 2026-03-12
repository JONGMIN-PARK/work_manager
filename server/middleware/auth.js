var authService = require('../services/auth.service');

// JWT 인증 미들웨어
function authenticate(req, res, next) {
  var authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: '인증이 필요합니다.' });
  }

  var token = authHeader.slice(7);
  try {
    var decoded = authService.verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'TOKEN_EXPIRED', message: '토큰이 만료되었습니다.' });
    }
    return res.status(401).json({ error: 'INVALID_TOKEN', message: '유효하지 않은 토큰입니다.' });
  }
}

// 역할 검사 미들웨어 (시스템 등급)
function requireRole() {
  var roles = Array.prototype.slice.call(arguments);
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: '인증이 필요합니다.' });
    }
    if (roles.indexOf(req.user.role) < 0) {
      return res.status(403).json({ error: 'FORBIDDEN', message: '권한이 없습니다.' });
    }
    next();
  };
}

module.exports = {
  authenticate: authenticate,
  requireRole: requireRole
};
