/**
 * 플랜별 기능 게이팅 미들웨어
 *
 * Usage: router.post('/ai/summary', planGate('ai'), handler)
 *
 * Features and required plans:
 * - 'ai': pro, business, enterprise
 * - 'telegram': pro, business, enterprise
 * - 'unlimited_history': pro, business, enterprise (free = 30 days)
 * - 'api_access': business, enterprise
 * - 'sso': enterprise
 * - 'white_label': enterprise
 */

var db = require('../config/db');

var FEATURE_PLANS = {
  ai: ['pro', 'business', 'enterprise'],
  telegram: ['pro', 'business', 'enterprise'],
  unlimited_history: ['pro', 'business', 'enterprise'],
  api_access: ['business', 'enterprise'],
  sso: ['enterprise'],
  white_label: ['enterprise']
};

/**
 * planGate 미들웨어 팩토리
 * @param {string} feature - 기능 이름 (FEATURE_PLANS 키)
 * @returns {Function} Express 미들웨어
 */
function planGate(feature) {
  var allowedPlans = FEATURE_PLANS[feature];
  if (!allowedPlans) {
    throw new Error('[plan-gate] Unknown feature: ' + feature);
  }

  return async function (req, res, next) {
    try {
      var tenantId = req.tenant && req.tenant.id;
      if (!tenantId) {
        return res.status(403).json({
          error: 'TENANT_REQUIRED',
          message: '테넌트 정보가 없습니다.'
        });
      }

      // req.tenant.plan이 이미 있으면 재사용, 없으면 DB 조회
      var plan = req.tenant.plan;
      if (!plan) {
        var r = await db.query('SELECT plan FROM tenants WHERE id = $1', [tenantId]);
        plan = r.rows.length ? r.rows[0].plan : 'free';
        req.tenant.plan = plan;
      }

      if (allowedPlans.indexOf(plan) < 0) {
        return res.status(403).json({
          error: 'PLAN_REQUIRED',
          message: '이 기능은 ' + allowedPlans.join(', ') + ' 플랜에서 사용할 수 있습니다. 현재 플랜: ' + plan
        });
      }

      next();
    } catch (e) {
      console.error('[plan-gate]', e);
      res.status(500).json({ error: 'SERVER_ERROR', message: '플랜 확인 중 오류가 발생했습니다.' });
    }
  };
}

module.exports = planGate;
