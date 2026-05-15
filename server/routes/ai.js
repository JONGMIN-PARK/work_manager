/**
 * AI 라우트 — 웹 프론트엔드 AI 요약/분석/자연어 질의
 */
var express = require('express');
var router = express.Router();
var config = require('../config');
var db = require('../config/db');
var aiService = require('../services/ai.service');
var { authenticate } = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var planGate = require('../middleware/plan-gate');

router.use(authenticate);
router.use(tenant.tenantScope);

/** 플랜별 월간 AI 쿼리 한도 */
var PLAN_LIMITS = { free: 0, pro: 100, business: 500, enterprise: 999999 };

/** 이번 달 사용량 확인 */
async function getMonthlyUsage(tenantId) {
  var r = await db.query(
    "SELECT COUNT(*) as cnt FROM ai_query_usage WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())",
    [tenantId]
  );
  return parseInt(r.rows[0].cnt, 10);
}

/** 사용량 기록 */
async function logUsage(tenantId, userId, queryText, provider) {
  await db.query(
    'INSERT INTO ai_query_usage (tenant_id, user_id, query_text, provider) VALUES ($1, $2, $3, $4)',
    [tenantId, userId, (queryText || '').slice(0, 500), provider]
  );
}

/** 테넌트 AI 키 또는 글로벌 키로 AI 호출 */
async function callAIWithPrompt(prompt, tenantId) {
  // 1. 테넌트 전용 키 확인
  var tenantCfg = null;
  try {
    var tr = await db.query('SELECT * FROM tenant_ai_configs WHERE tenant_id = $1', [tenantId]);
    if (tr.rows.length && tr.rows[0].api_key) tenantCfg = tr.rows[0];
  } catch (_) { /* table may not exist */ }

  var provider = tenantCfg ? tenantCfg.provider : config.ai.provider;
  var apiKey = tenantCfg ? tenantCfg.api_key : (provider === 'anthropic' ? config.ai.anthropicKey : config.ai.geminiKey);
  var model = tenantCfg ? tenantCfg.model : (provider === 'anthropic' ? config.ai.anthropicModel : config.ai.geminiModel);

  if (!apiKey) return null;

  if (provider === 'anthropic') {
    // v13.71/72/73: 모델명 검증 + adaptive thinking text 추출 + 크레딧 부족 시 Gemini 자동 폴백
    var safeModel = model || 'claude-opus-4-7';
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: safeModel,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    var data = await res.json();
    if (data.error) {
      var em = (data.error && (data.error.message || data.error.type)) || 'Claude API 오류';
      // v13.73: 크레딧 부족 자동 감지 → Gemini 키 있으면 폴백
      if (/credit balance|insufficient.*credit|low.*balance/i.test(em)) {
        if (config.ai.geminiKey) {
          console.warn('[AI] Claude 크레딧 부족 → Gemini로 폴백');
          // Gemini로 재시도 (재귀 대신 직접 호출)
          var fallbackUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' +
            (config.ai.geminiModel || 'gemini-2.5-flash') + ':generateContent?key=' + config.ai.geminiKey;
          var fRes = await fetch(fallbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 8192, temperature: 0.3 } })
          });
          var fData = await fRes.json();
          if (fData.candidates && fData.candidates[0] && fData.candidates[0].content) {
            var text = fData.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('\n');
            return '[ℹ️ Claude 크레딧 부족 — Gemini로 자동 폴백]\n\n' + text;
          }
        }
        // Gemini도 없으면 친화적 에러
        var bErr = new Error('Anthropic API 크레딧이 부족합니다. Console → Plans & Billing에서 크레딧을 충전하거나 Gemini로 폴백 가능합니다(GEMINI_API_KEY 설정).');
        bErr.code = 'CREDIT_LOW';
        bErr.action = 'https://console.anthropic.com/settings/plans';
        throw bErr;
      }
      var hint = '';
      if (/not_found|model/i.test(em)) hint = ' — 모델명 확인 (현재 "' + safeModel + '"). 권장: claude-opus-4-7';
      else if (/authentication|invalid api key/i.test(em)) hint = ' — ANTHROPIC_API_KEY 확인';
      else if (/rate_limit/i.test(em)) hint = ' — 잠시 후 재시도';
      throw new Error(em + hint);
    }
    if (!data.content || !Array.isArray(data.content)) return null;
    // content 배열에서 text 블록만 추출 (thinking 블록 등 무시)
    var textParts = data.content
      .filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string'; })
      .map(function (b) { return b.text; });
    return textParts.length ? textParts.join('\n') : null;
  }

  // Gemini
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + (model || 'gemini-2.5-flash') + ':generateContent?key=' + apiKey;
  var res2 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 8192, temperature: 0.3 } })
  });
  var data2 = await res2.json();
  if (data2.candidates && data2.candidates[0] && data2.candidates[0].content) {
    return data2.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('\n');
  }
  if (data2.error) throw new Error(data2.error.message);
  return null;
}

/** 쿼리 한도 체크 미들웨어 */
async function checkAIQuota(req, res, next) {
  try {
    var planR = await db.query('SELECT plan FROM tenants WHERE id = $1', [req.tenant.id]);
    var plan = planR.rows.length ? planR.rows[0].plan : 'free';
    var limit = PLAN_LIMITS[plan] || 0;

    if (limit === 0) {
      return res.status(403).json({ error: 'PLAN_REQUIRED', message: 'AI 기능은 Pro 플랜 이상에서 사용할 수 있습니다.' });
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

    var answer = await callAIWithPrompt(prompt, req.tenant.id);
    if (!answer) return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI API 키가 설정되지 않았습니다.' });

    await logUsage(req.tenant.id, req.user.sub, prompt, config.ai.provider);
    var quota = req.aiQuota || {};

    res.json({ data: { text: answer, provider: config.ai.provider, quota: { used: (quota.used || 0) + 1, limit: quota.limit } } });
  } catch (err) {
    console.error('[AI Route] summary error:', err.message);
    // v13.73: 크레딧 부족은 402(Payment Required) + action URL
    if (err.code === 'CREDIT_LOW') {
      return res.status(402).json({
        error: 'CREDIT_LOW',
        message: err.message,
        action: { label: 'Anthropic Console 열기', url: err.action }
      });
    }
    res.status(500).json({ error: 'AI_ERROR', message: 'AI 요약 실패: ' + err.message });
  }
});

// ─── POST /api/ai/query — 자연어 질의 (RAG) ───
router.post('/query', checkAIQuota, async function (req, res) {
  try {
    var question = (req.body.question || '').trim();
    if (!question) return res.status(400).json({ error: 'BAD_REQUEST', message: '질문을 입력하세요.' });

    // RAG: 의도 분석 → DB 데이터 수집 → AI 응답
    var intents = aiService.analyzeQuery(question);
    var contextData = await aiService.gatherContext(intents, req.user.name || '사용자');

    var systemPrompt = '당신은 "Work Manager"라는 업무 관리 시스템의 AI 어시스턴트입니다.\n' +
      '아래 실제 데이터를 기반으로 사용자의 질문에 한국어로 답변하세요.\n' +
      '마크다운 포맷을 사용할 수 있습니다.\n' +
      '데이터에 없는 내용은 추측하지 말고 "해당 데이터가 없습니다"라고 답하세요.\n\n';

    if (contextData) {
      systemPrompt += '=== 현재 데이터 ===\n' + contextData + '\n=== 데이터 끝 ===\n\n';
    }

    systemPrompt += '질문: ' + question;

    var answer = await callAIWithPrompt(systemPrompt, req.tenant.id);
    if (!answer) return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI API 키가 설정되지 않았습니다.' });

    await logUsage(req.tenant.id, req.user.sub, question, config.ai.provider);
    var quota = req.aiQuota || {};

    res.json({
      data: {
        answer: answer,
        intents: intents,
        provider: config.ai.provider,
        quota: { used: (quota.used || 0) + 1, limit: quota.limit }
      }
    });
  } catch (err) {
    console.error('[AI Route] query error:', err.message);
    res.status(500).json({ error: 'AI_ERROR', message: 'AI 질의 실패: ' + err.message });
  }
});

// ─── GET /api/ai/status — AI 상태 ───
router.get('/status', async function (req, res) {
  // v13.71: 진단 정보 풍부화 — 어떤 provider/model/key 출처가 사용되는지 명확히
  var provider = config.ai.provider || 'gemini';
  var configured = aiService.isConfigured();
  var modelInUse = provider === 'anthropic' ? config.ai.anthropicModel : config.ai.geminiModel;
  var keySource = 'env';
  var globalAnthropicKeySet = !!config.ai.anthropicKey;
  var globalGeminiKeySet = !!config.ai.geminiKey;

  // 테넌트 전용 키 확인
  var tenantKey = false;
  try {
    var tr = await db.query('SELECT provider, model FROM tenant_ai_configs WHERE tenant_id = $1 AND api_key IS NOT NULL', [req.tenant.id]);
    if (tr.rows.length) {
      tenantKey = true;
      provider = tr.rows[0].provider;
      if (tr.rows[0].model) modelInUse = tr.rows[0].model;
      configured = true;
      keySource = 'tenant';
    }
  } catch (_) { }

  var usage = 0;
  try { usage = await getMonthlyUsage(req.tenant.id); } catch (_) { }

  var planR = await db.query('SELECT plan FROM tenants WHERE id = $1', [req.tenant.id]);
  var plan = planR.rows.length ? planR.rows[0].plan : 'free';
  var limit = PLAN_LIMITS[plan] || 0;

  res.json({
    data: {
      configured: configured,
      provider: configured ? (provider === 'anthropic' ? 'Claude' : 'Gemini') : null,
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
    res.json({ data: r.rows[0], message: 'AI 설정이 저장되었습니다.' });
  } catch (e) {
    console.error('[ai/config]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
