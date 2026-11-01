/**
 * AI 라우트 — 웹 프론트엔드 AI 요약/분석/자연어 질의
 */
var express = require('express');
var router = express.Router();
var config = require('../config');
var db = require('../config/db');
var aiService = require('../services/ai.service');
var aiProvider = require('../services/ai-provider');
var aiInsights = require('../services/ai-insights');
var { authenticate } = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var planGate = require('../middleware/plan-gate');
var httpErr = require('../lib/http-errors');

router.use(authenticate);
router.use(tenant.tenantScope);

/* 한도 · 사용량 기록은 텔레그램과 같은 규칙 (lib/ai-usage, v13.301) */
var aiUsage = require('../lib/ai-usage');
var PLAN_LIMITS = aiUsage.PLAN_LIMITS;
var getMonthlyUsage = aiUsage.getMonthlyUsage;
var logUsage = aiUsage.logUsage;

/** 테넌트 키 → AI_PROVIDER → 있는 키 순으로 골라 호출 (공용 ai-provider, v13.296)
 *  → { text, provider, model, note } · 키가 없으면 null */
function callAIWithPrompt(prompt, tenantId) {
  return aiProvider.generateText({ prompt: prompt, tenantId: tenantId });
}

/** 쿼리 한도 체크 미들웨어 */
async function checkAIQuota(req, res, next) {
  var q = await aiUsage.checkQuota(req.tenant.id);
  if (!q.ok) {
    var body = { error: q.error, message: q.message };
    if (q.used != null) body.data = { used: q.used, limit: q.limit };
    return res.status(q.status).json(body);
  }
  req.aiQuota = { used: q.used, limit: q.limit, plan: q.plan };
  next();
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
    }, { history: Array.isArray(req.body.history) ? req.body.history.slice(-3) : [] });
    if (!out) return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI API 키가 설정되지 않았습니다. (GEMINI_API_KEY 또는 ANTHROPIC_API_KEY)' });

    await logUsage(req.tenant.id, req.user.sub, question, out.provider);
    var quota = req.aiQuota || {};

    res.json({
      data: {
        answer: out.answer,
        note: out.note || '',
        sources: out.sources,
        charts: out.charts,
        tools: out.tools,
        followups: out.followups,
        planned: out.planned,
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

// ─── GET /api/ai/insights — 💡 자동 인사이트 카드 (v13.299, AI 호출 없음 · 묻는 사람 권한 범위) ───
router.get('/insights', async function (req, res) {
  try {
    var cards = await aiInsights.computeInsights({
      userId: req.user.sub, role: req.user.role, departmentId: req.user.departmentId || null,
      tenantId: req.tenant.id, name: req.user.name || ''
    });
    res.json({ data: cards });
  } catch (e) {
    httpErr.serverError(res, '[ai/insights]', e);
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
