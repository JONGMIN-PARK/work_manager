/**
 * AI 라우트 — 웹 프론트엔드 AI 요약/분석/자연어 질의
 */
var express = require('express');
var router = express.Router();
var config = require('../config');
var db = require('../config/db');
var aiService = require('../services/ai.service');
var aiProvider = require('../services/ai-provider');
var { authenticate } = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var planGate = require('../middleware/plan-gate');
var httpErr = require('../lib/http-errors');

router.use(authenticate);
router.use(tenant.tenantScope);

/** 플랜별 월간 AI 쿼리 한도 */
var PLAN_LIMITS = { free: 0, pro: 100, business: 500, enterprise: 999999 };

/** 이번 달 사용량 확인 — 테이블 없으면 0 반환 (v13.75 fail-safe) */
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

/** 사용량 기록 — 테이블 없으면 무시 (v13.75 fail-safe) */
async function logUsage(tenantId, userId, queryText, provider) {
  try {
    await db.query(
      'INSERT INTO ai_query_usage (tenant_id, user_id, query_text, provider) VALUES ($1, $2, $3, $4)',
      [tenantId, userId, (queryText || '').slice(0, 500), provider]
    );
  } catch (e) {
    if (/relation .* does not exist/i.test(e.message || '')) return; // 무시
    console.warn('[AI] logUsage 실패:', e.message);
  }
}

/** 테넌트 키 → AI_PROVIDER → 있는 키 순으로 골라 호출 (공용 ai-provider, v13.296)
 *  → { text, provider, model, note } · 키가 없으면 null */
function callAIWithPrompt(prompt, tenantId) {
  return aiProvider.generateText({ prompt: prompt, tenantId: tenantId });
}

/** 쿼리 한도 체크 미들웨어 */
async function checkAIQuota(req, res, next) {
  try {
    // v13.75: 단일 테넌트/관리자 환경에선 한도 체크 우회 가능
    if (process.env.AI_QUOTA_DISABLED === '1' || process.env.AI_QUOTA_DISABLED === 'true') {
      req.aiQuota = { used: 0, limit: 999999, plan: 'unlimited' };
      return next();
    }
    var planR = await db.query('SELECT plan FROM tenants WHERE id = $1', [req.tenant.id]);
    var plan = planR.rows.length ? planR.rows[0].plan : 'free';
    var limit = PLAN_LIMITS[plan] || 0;

    if (limit === 0) {
      return res.status(403).json({
        error: 'PLAN_REQUIRED',
        message: 'AI 기능은 Pro 플랜 이상에서 사용할 수 있습니다. (단일 테넌트 환경이면 서버에 AI_QUOTA_DISABLED=1 설정)'
      });
    }

    var usage = await getMonthlyUsage(req.tenant.id);
    if (usage >= limit) {
      return res.status(429).json({
        error: 'AI_QUOTA_EXCEEDED',
        message: '이번 달 AI 쿼리 한도(' + limit + '회)를 초과했습니다. 플랜 업그레이드를 고려하세요.',
        data: { used: usage, limit: limit }
      });
    }

    req.aiQuota = { used: usage, limit: limit, plan: plan };
    next();
  } catch (e) {
    next(); // 쿼리 실패 시 통과
  }
}

// ─── POST /api/ai/summary — AI 요약 ───
router.post('/summary', checkAIQuota, async function (req, res) {
  try {
    var prompt = req.body.prompt || '';
    if (!prompt) return res.status(400).json({ error: 'BAD_REQUEST', message: '프롬프트가 필요합니다.' });
    if (prompt.length > 15000) prompt = prompt.slice(0, 15000) + '\n...(이하 생략)';

    var out = await callAIWithPrompt(prompt, req.tenant.id);
    if (!out) return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI API 키가 설정되지 않았습니다. (GEMINI_API_KEY 또는 ANTHROPIC_API_KEY)' });

    await logUsage(req.tenant.id, req.user.sub, prompt, out.provider);
    var quota = req.aiQuota || {};
    var text = out.note ? '[ℹ️ ' + out.note + ']\n\n' + out.text : out.text;

    res.json({ data: { text: text, provider: aiProvider.label(out.provider), model: out.model, quota: { used: (quota.used || 0) + 1, limit: quota.limit } } });
  } catch (err) {
    aiProvider.sendAiError(res, '[AI Route] summary', err, 'AI 요약 실패');
  }
});

// ─── POST /api/ai/query — 자연어 질의 (RAG) ───
// 웹 "✨ AI에게 묻기" — 사용자당 시간당 60회
var queryLimiter = require('express-rate-limit')({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: function (req) { return (req.user && req.user.sub) || req.ip; },
  message: { error: 'RATE_LIMIT', message: 'AI 질문 한도(시간당 60회)를 넘었습니다. 잠시 후 다시 시도하세요.' },
  standardHeaders: true, legacyHeaders: false
});
router.post('/query', queryLimiter, checkAIQuota, async function (req, res) {
  try {
    var question = (req.body.question || '').trim();
    if (!question) return res.status(400).json({ error: 'BAD_REQUEST', message: '질문을 입력하세요.' });

    if (question.length > 1000) question = question.slice(0, 1000);

    // v13.297: 묻는 사람이 화면에서 볼 수 있는 것만 AI 에 넘김 (ai.service.gatherContext)
    var out = await aiService.answerWeb(question, {
      userId: req.user.sub, role: req.user.role, departmentId: req.user.departmentId || null,
      tenantId: req.tenant.id, name: req.user.name || '사용자'
    });
    if (!out) return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI API 키가 설정되지 않았습니다. (GEMINI_API_KEY 또는 ANTHROPIC_API_KEY)' });

    await logUsage(req.tenant.id, req.user.sub, question, out.provider);
    var quota = req.aiQuota || {};

    res.json({
      data: {
        answer: out.answer,
        note: out.note || '',
        sources: out.sources,
        context: out.context,
        intents: out.intents,
        provider: aiProvider.label(out.provider),
        model: out.model,
        quota: { used: (quota.used || 0) + 1, limit: quota.limit }
      }
    });
  } catch (err) {
    aiProvider.sendAiError(res, '[AI Route] query', err, 'AI 질의 실패');
  }
});

// ─── GET /api/ai/status — AI 상태 ───
router.get('/status', async function (req, res) {
  // v13.296: 실제로 쓰일 AI 를 공용 규칙으로 — 키가 하나뿐이어도 그쪽으로 잡힘
  var r = null;
  try { r = await aiProvider.resolve(req.tenant.id); } catch (_) { r = aiProvider.resolveEnv(); }
  var configured = !!r;
  var provider = r ? r.provider : (config.ai.provider || '');
  var modelInUse = r ? r.model : null;
  var keySource = r ? r.source : 'env';
  var tenantKey = keySource === 'tenant';
  var globalAnthropicKeySet = !!config.ai.anthropicKey;
  var globalGeminiKeySet = !!config.ai.geminiKey;

  var usage = 0;
  try { usage = await getMonthlyUsage(req.tenant.id); } catch (_) { }

  var planR = await db.query('SELECT plan FROM tenants WHERE id = $1', [req.tenant.id]);
  var plan = planR.rows.length ? planR.rows[0].plan : 'free';
  var limit = PLAN_LIMITS[plan] || 0;

  res.json({
    data: {
      configured: configured,
      provider: configured ? aiProvider.label(provider) : null,
      providerCode: provider,
      model: modelInUse,
      keySource: keySource,           // 'tenant' | 'env'
      tenantKey: tenantKey,
      envKeys: { anthropic: globalAnthropicKeySet, gemini: globalGeminiKeySet },
      quota: { used: usage, limit: limit, plan: plan },
      hint: (!configured ? 'ANTHROPIC_API_KEY 또는 GEMINI_API_KEY 환경변수 설정 후 서버 재시작 필요' :
            (limit === 0 ? 'Free 플랜은 AI 사용 불가 — Pro 이상 플랜 필요' : null))
    }
  });
});

// ─── GET /api/ai/config — 테넌트 AI 설정 조회 (admin) ───
router.get('/config', require('../middleware/auth').requireRole('admin'), async function (req, res) {
  try {
    var r = await db.query('SELECT id, provider, model, created_at FROM tenant_ai_configs WHERE tenant_id = $1', [req.tenant.id]);
    res.json({ data: r.rows[0] || null });
  } catch (e) {
    res.json({ data: null });
  }
});

// ─── PUT /api/ai/config — 테넌트 AI 설정 저장 (admin) ───
router.put('/config', require('../middleware/auth').requireRole('admin'), async function (req, res) {
  try {
    var b = req.body;
    var r = await db.query(
      'INSERT INTO tenant_ai_configs (tenant_id, provider, api_key, model) VALUES ($1, $2, $3, $4) ' +
      'ON CONFLICT (tenant_id) DO UPDATE SET provider = $2, api_key = $3, model = $4, updated_at = now() RETURNING id, provider, model',
      [req.tenant.id, b.provider || 'gemini', b.api_key || null, b.model || null]
    );
    aiProvider.clearTenantCache(req.tenant.id);
    res.json({ data: r.rows[0], message: 'AI 설정이 저장되었습니다.' });
  } catch (e) {
    httpErr.serverError(res, '[ai/config]', e);
  }
});

module.exports = router;
