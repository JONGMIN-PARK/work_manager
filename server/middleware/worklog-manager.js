// 업무 데이터 담당 (v13.481) — 업무일지(work_records)는 회사(테넌트)가 함께 보는 한 벌.
//   보기: 로그인한 모든 사용자 · 넣기/고치기/지우기: 관리자 + 관리자가 지정한 사용자(user_settings 'worklog_manager'.enabled)
var db = require('../config/db');

async function isWorklogManagerByUser(userId, role) {
  if (role === 'admin') return true;
  if (!userId) return false;
  try {
    var r = await db.query("SELECT value FROM user_settings WHERE user_id = $1 AND key = 'worklog_manager'", [userId]);
    return !!(r.rows.length && r.rows[0].value && r.rows[0].value.enabled);
  } catch (e) {
    return false;
  }
}
function isWorklogManager(req) {
  if (!req || !req.user) return Promise.resolve(false);
  return isWorklogManagerByUser(req.user.sub, req.user.role);
}
async function requireWorklogManager(req, res, next) {
  try {
    if (await isWorklogManager(req)) return next();
    return res.status(403).json({ error: 'FORBIDDEN', message: '업무 데이터는 관리자와 지정된 담당자만 넣거나 지울 수 있습니다.' });
  } catch (e) {
    console.error('[worklog-manager/guard]', e);
    return res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
}

module.exports = { isWorklogManager: isWorklogManager, isWorklogManagerByUser: isWorklogManagerByUser, requireWorklogManager: requireWorklogManager };
