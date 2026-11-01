/**
 * AI 사용 한도 · 사용량 기록 — 웹(/api/ai/*)과 텔레그램이 같은 규칙을 쓴다 (v13.301)
 *   · 월 한도: 회사 플랜별 (AI_QUOTA_DISABLED=1 이면 끔)
 *   · 시간당 한도: 사람마다 60회 (텔레그램 — 웹은 express-rate-limit 이 따로 센다)
 *   · 사용량 기록: ai_query_usage (표가 없으면 조용히 건너뜀)
 */
var db = require('../config/db');

/** 플랜별 월간 AI 쿼리 한도 */
var PLAN_LIMITS = { free: 0, pro: 100, business: 500, enterprise: 999999 };
var HOURLY = 60;

function quotaDisabled() {
  return process.env.AI_QUOTA_DISABLED === '1' || process.env.AI_QUOTA_DISABLED === 'true';
}

/** 이번 달 사용량 — 테이블 없으면 0 (v13.75 fail-safe) */
async function getMonthlyUsage(tenantId) {
  try {
    var r = await db.query(
      "SELECT COUNT(*) as cnt FROM ai_query_usage WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())",
      [tenantId]
    );
    return parseInt(r.rows[0].cnt, 10);
  } catch (e) {
    if (/relation .* does not exist/i.test(e.message || '')) {
      console.warn('[AI] ai_query_usage 테이블 미생성 — 029 마이그레이션 적용 필요. 사용량 추적 비활성');
      return 0;
    }
    throw e;
  }
}

/** 사용량 기록 — 테이블 없으면 무시 */
async function logUsage(tenantId, userId, queryText, provider) {
  try {
    await db.query(
      'INSERT INTO ai_query_usage (tenant_id, user_id, query_text, provider) VALUES ($1, $2, $3, $4)',
      [tenantId, userId, (queryText || '').slice(0, 500), provider]
    );
  } catch (e) {
    if (/relation .* does not exist/i.test(e.message || '')) return;
    console.warn('[AI] logUsage 실패:', e.message);
  }
}

/**
 * 월 한도 확인 → { ok: true, used, limit, plan } | { ok: false, status, error, message, used?, limit? }
 * 조회 자체가 실패하면 막지 않는다 (예전 미들웨어와 같음).
 */
async function checkQuota(tenantId) {
  if (quotaDisabled()) return { ok: true, used: 0, limit: 999999, plan: 'unlimited' };
  try {
    var planR = await db.query('SELECT plan FROM tenants WHERE id = $1', [tenantId]);
    var plan = planR.rows.length ? planR.rows[0].plan : 'free';
    var limit = PLAN_LIMITS[plan] || 0;
    if (limit === 0) {
      return { ok: false, status: 403, error: 'PLAN_REQUIRED', message: 'AI 기능은 Pro 플랜 이상에서 사용할 수 있습니다. (단일 테넌트 환경이면 서버에 AI_QUOTA_DISABLED=1 설정)' };
    }
    var used = await getMonthlyUsage(tenantId);
    if (used >= limit) {
      return { ok: false, status: 429, error: 'AI_QUOTA_EXCEEDED', message: '이번 달 AI 쿼리 한도(' + limit + '회)를 초과했습니다. 플랜 업그레이드를 고려하세요.', used: used, limit: limit };
    }
    return { ok: true, used: used, limit: limit, plan: plan };
  } catch (_) {
    return { ok: true, used: 0, limit: null, plan: null };
  }
}

/* 시간당 한도 (메모리 · 사람마다) — 서버를 다시 켜면 비워진다 */
var _hits = new Map();
/** 이번 호출을 세고, 한 시간에 HOURLY 번을 넘으면 false */
function takeHourly(userId, now) {
  now = now || Date.now();
  var key = String(userId || '');
  var arr = (_hits.get(key) || []).filter(function (t) { return now - t < 3600000; });
  if (arr.length >= HOURLY) { _hits.set(key, arr); return false; }
  arr.push(now);
  _hits.set(key, arr);
  if (_hits.size > 5000) {   // 오래 안 쓴 사람 정리
    _hits.forEach(function (v, k) { if (!v.length || now - v[v.length - 1] > 3600000) _hits.delete(k); });
  }
  return true;
}
function _resetHourly() { _hits.clear(); }

module.exports = {
  PLAN_LIMITS: PLAN_LIMITS,
  HOURLY: HOURLY,
  getMonthlyUsage: getMonthlyUsage,
  logUsage: logUsage,
  checkQuota: checkQuota,
  takeHourly: takeHourly,
  _resetHourly: _resetHourly
};
