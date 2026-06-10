// 운영자(Operator) 판정 — admin 자동 + user_settings 'operator_mode'.enabled 부여 사용자
var db = require('../config/db');

// req.user 기준 운영자 여부 (admin 또는 부여된 사용자)
async function isOperator(req) {
  if (!req || !req.user) return false;
  if (req.user.role === 'admin') return true;
  try {
    var r = await db.query(
      "SELECT value FROM user_settings WHERE user_id = $1 AND key = 'operator_mode'",
      [req.user.sub]
    );
    return !!(r.rows.length && r.rows[0].value && r.rows[0].value.enabled);
  } catch (e) {
    return false;
  }
}

// 운영자만 통과시키는 미들웨어
async function requireOperator(req, res, next) {
  try {
    if (await isOperator(req)) return next();
    return res.status(403).json({ error: 'FORBIDDEN', message: '운영자 권한이 필요합니다.' });
  } catch (e) {
    console.error('[operator/guard]', e);
    return res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
}

module.exports = { isOperator: isOperator, requireOperator: requireOperator };
