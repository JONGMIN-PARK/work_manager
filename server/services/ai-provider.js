/**
 * ai-provider.js — AI 연결 공용 (v13.296)
 *
 * 업무 관리(/api/ai) · 텔레그램 질답 · 마인드맵 · A/S AI 가 모두 같은 규칙으로 AI 를 고르고 부른다.
 * 예전에는 기능마다 따로 골라서, 키가 하나만 있으면 어떤 기능은 되고 어떤 기능은 꺼져 있었다.
 *
 * 고르는 순서
 *   1) 테넌트 전용 키 (관리 → AI 설정, tenant_ai_configs)
 *   2) AI_PROVIDER 로 정한 쪽의 키가 있으면 그쪽
 *   3) 아니면 있는 키 (Claude → Gemini 순)
 *
 * 모델은 환경변수로 바꾼다: GEMINI_MODEL (예: gemini-2.5-pro) · ANTHROPIC_MODEL.
 * Gemini 가 붐비면(503/429) 잠깐 쉬고 다시, 그래도 안 되면 예비 모델(GEMINI_FALLBACK_MODEL)로.
 */
var config = require('../config');
var db = require('../config/db');

/* ─── 테넌트 전용 키 — 1분 기억 ─── */
var _tenantCache = new Map();
async function loadTenantCfg(tenantId) {
  if (!tenantId) return null;
  var hit = _tenantCache.get(tenantId);
  if (hit && hit.at > Date.now() - 60000) return hit.cfg;
  var cfg = null;
  try {
    var r = await db.query('SELECT provider, api_key, model FROM tenant_ai_configs WHERE tenant_id = $1', [tenantId]);
    if (r.rows.length && r.rows[0].api_key) cfg = r.rows[0];
  } catch (_) { /* 테이블 없으면 무시 */ }
  _tenantCache.set(tenantId, { at: Date.now(), cfg: cfg });
  return cfg;
}
function clearTenantCache(tenantId) { if (tenantId) _tenantCache.delete(tenantId); else _tenantCache.clear(); }

function defaultModel(provider) {
  return provider === 'anthropic' ? (config.ai.anthropicModel || 'claude-opus-4-7') : (config.ai.geminiModel || 'gemini-2.5-flash');
}

/** 환경변수만 보고 고르기 → { provider, key, model, source } | null */
function resolveEnv() {
  var ai = config.ai;
  var pref = String(ai.provider || '').toLowerCase();
  var pick = null;
  if (pref === 'gemini' && ai.geminiKey) pick = 'gemini';
  else if (pref === 'anthropic' && ai.anthropicKey) pick = 'anthropic';
  else if (ai.anthropicKey) pick = 'anthropic';
  else if (ai.geminiKey) pick = 'gemini';
  if (!pick) return null;
  return { provider: pick, key: pick === 'anthropic' ? ai.anthropicKey : ai.geminiKey, model: defaultModel(pick), source: 'env' };
}

/** 테넌트 키 우선 → 환경변수 */
async function resolve(tenantId) {
  var t = await loadTenantCfg(tenantId);
  if (t) {
    var p = t.provider === 'anthropic' ? 'anthropic' : 'gemini';
    return { provider: p, key: t.api_key, model: t.model || defaultModel(p), source: 'tenant' };
  }
  return resolveEnv();
}

function label(provider) { return provider === 'anthropic' ? 'Claude' : provider === 'gemini' ? 'Gemini' : 'AI'; }

/* ─── Gemini ─── */
function geminiFallbackModel(primary) {
  if (process.env.GEMINI_FALLBACK_MODEL) return process.env.GEMINI_FALLBACK_MODEL;
  return primary === 'gemini-2.5-flash' ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash';
}
function isRetryable(status, msg) {
  return status === 503 || status === 429 || status === 500 || /overloaded|high demand|unavailable|rate.*limit|busy|resource.*exhausted/i.test(msg || '');
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/**
 * Gemini 호출 → { text, model, fellBack, usage }
 * opts: { key, model, system, prompt, json(bool), maxTokens }
 * maxOutputTokens 는 넉넉하게 — 2.5 · 3 모델은 생각(thinking) 토큰도 여기서 빠져서, 작게 잡으면 답이 비어 온다.
 */
async function geminiGenerate(opts) {
  var primary = opts.model || defaultModel('gemini');
  var fallback = geminiFallbackModel(primary);
  var models = primary === fallback ? [primary] : [primary, fallback];
  var lastErr = null;
  for (var mi = 0; mi < models.length; mi++) {
    var model = models[mi];
    var gen = { maxOutputTokens: Math.max(opts.maxTokens || 0, 32768) };
    // Gemini 3 는 temperature 기본값(1.0) 유지 권장 — 낮추면 답이 맴돌 수 있음
    if (!/^gemini-3/.test(model)) gen.temperature = 0.3;
    if (opts.json) gen.responseMimeType = 'application/json';
    var parts = [{ text: opts.prompt }];
    if (opts.inline && opts.inline.data) parts.push({ inline_data: { mime_type: opts.inline.mimeType, data: opts.inline.data } });   // 음성 · 사진 (v13.303)
    var body = { contents: [{ role: 'user', parts: parts }], generationConfig: gen };
    if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
    for (var attempt = 0; attempt < 3; attempt++) {
      var status = 0, msg = '';
      try {
        var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.key },
          body: JSON.stringify(body)
        });
        status = res.status;
        var data = await res.json().catch(function () { return {}; });
        var cand = data.candidates && data.candidates[0];
        var text = cand && cand.content && cand.content.parts
          ? cand.content.parts.filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join('')
          : '';
        if (text.trim()) {
          var u = data.usageMetadata || {};
          return { text: text, model: model, fellBack: mi > 0, usage: { input_tokens: u.promptTokenCount, output_tokens: u.candidatesTokenCount, thinking_tokens: u.thoughtsTokenCount } };
        }
        if (data.error) msg = data.error.message || data.error.status || 'Gemini 오류';
        else if (cand && cand.finishReason) msg = cand.finishReason === 'MAX_TOKENS' ? '답이 너무 길어 잘렸습니다 (MAX_TOKENS)' : cand.finishReason === 'SAFETY' ? '안전 필터에 걸려 답을 받지 못했습니다' : 'Gemini 응답 중단 (' + cand.finishReason + ')';
        else if (data.promptFeedback && data.promptFeedback.blockReason) msg = '요청이 차단되었습니다 (' + data.promptFeedback.blockReason + ')';
        else msg = 'Gemini 응답이 비어 있습니다';
        if (data.error && data.error.code) status = data.error.code;
      } catch (e) {
        msg = (e && e.message) || 'Gemini 연결 실패';
        status = 503;   // 네트워크 오류는 다시 시도
      }
      lastErr = new Error(msg);
      lastErr.status = status;
      if (status === 404 || /not found|not supported/i.test(msg)) {
        lastErr = new Error('Gemini 모델 "' + model + '" 을(를) 찾을 수 없습니다 — GEMINI_MODEL 값을 확인하세요. (' + msg + ')');
        break;   // 다음 모델로
      }
      if (/api key|permission|unauthenticated/i.test(msg) || status === 401 || status === 403) {
        var ke = new Error('Gemini API 키가 올바르지 않습니다 — GEMINI_API_KEY 를 확인하세요. (' + msg + ')');
        ke.code = 'AI_KEY_INVALID';
        throw ke;
      }
      if (!isRetryable(status, msg)) throw lastErr;
      if (attempt < 2) {
        console.warn('[Gemini] ' + model + ' ' + msg + ' — 다시 시도 (' + (attempt + 1) + '/3)');
        await sleep(500 * Math.pow(3, attempt));
      }
    }
  }
  var fe = new Error('Gemini 응답 실패 — 잠시 후 다시 시도하세요. (시도한 모델: ' + models.join(', ') + (lastErr ? ' · ' + lastErr.message : '') + ')');
  fe.code = lastErr && isRetryable(lastErr.status, lastErr.message) ? 'AI_OVERLOADED' : 'AI_ERROR';
  throw fe;
}

/* ─── Claude (글 답) ─── */
async function anthropicText(opts) {
  var model = opts.model || defaultModel('anthropic');
  var body = { model: model, max_tokens: opts.maxTokens || 4096, messages: [{ role: 'user', content: opts.prompt }] };
  if (opts.system) body.system = opts.system;
  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': opts.key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  var data = await res.json().catch(function () { return {}; });
  if (data.error || !res.ok) {
    var em = (data.error && (data.error.message || data.error.type)) || ('Claude API 오류 (' + res.status + ')');
    var err = new Error(em);
    if (isCreditLow(em)) err.code = 'CREDIT_LOW';
    else if (/not_found|model/i.test(em)) err.message = em + ' — ANTHROPIC_MODEL 확인 (현재 "' + model + '")';
    else if (/authentication|invalid.*api.*key/i.test(em)) { err.message = em + ' — ANTHROPIC_API_KEY 확인'; err.code = 'AI_KEY_INVALID'; }
    else if (res.status === 429 || res.status === 529 || /rate_limit|overloaded/i.test(em)) err.code = 'AI_OVERLOADED';
    throw err;
  }
  var text = (data.content || []).filter(function (b) { return b && b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
  if (!text.trim()) throw new Error('Claude 응답이 비어 있습니다' + (data.stop_reason ? ' (' + data.stop_reason + ')' : ''));
  return { text: text, model: model, usage: data.usage };
}

function isCreditLow(msg) { return /credit balance|insufficient.*credit|low.*balance/i.test(msg || ''); }

/**
 * 글 답 받기 — 업무 관리 요약 · 질의 · 텔레그램
 * → { text, provider, model, note } · 키가 없으면 null
 * Claude 크레딧이 부족하면 Gemini 키(환경변수)로 넘긴다.
 */
async function generateText(opts) {
  var r = await resolve(opts.tenantId);
  if (!r) return null;
  if (r.provider === 'anthropic') {
    try {
      var a = await anthropicText({ key: r.key, model: r.model, system: opts.system, prompt: opts.prompt, maxTokens: opts.maxTokens });
      return { text: a.text, provider: 'anthropic', model: a.model, usage: a.usage, note: '' };
    } catch (e) {
      if (e.code === 'CREDIT_LOW' && config.ai.geminiKey) {
        console.warn('[AI] Claude 크레딧 부족 → Gemini 로 폴백');
        var g0 = await geminiGenerate({ key: config.ai.geminiKey, model: defaultModel('gemini'), system: opts.system, prompt: opts.prompt, json: opts.json });
        return { text: g0.text, provider: 'gemini', model: g0.model, usage: g0.usage, note: 'Claude 크레딧 부족 — Gemini 로 대신 답했습니다' };
      }
      if (e.code === 'CREDIT_LOW') {
        e.message = 'Anthropic API 크레딧이 부족합니다. Console → Plans & Billing 에서 충전하거나 GEMINI_API_KEY 를 설정하세요.';
        e.action = 'https://console.anthropic.com/settings/plans';
      }
      throw e;
    }
  }
  var g = await geminiGenerate({ key: r.key, model: r.model, system: opts.system, prompt: opts.prompt, maxTokens: opts.maxTokens, json: opts.json });
  return { text: g.text, provider: 'gemini', model: g.model, usage: g.usage, note: g.fellBack ? r.model + ' 이(가) 붐벼 ' + g.model + ' 로 답했습니다' : '' };
}

/**
 * 음성 → 글 (텔레그램 음성 메모, v13.303). Gemini 만 들을 수 있다 — 회사 Gemini 키 → 환경변수 Gemini 키.
 * Gemini 키가 없으면 null.
 */
async function transcribe(opts) {
  var t = await loadTenantCfg(opts.tenantId);
  var key = t && t.provider !== 'anthropic' && t.api_key ? t.api_key : config.ai.geminiKey;
  var model = t && t.provider !== 'anthropic' && t.model ? t.model : defaultModel('gemini');
  if (!key) return null;
  var g = await geminiGenerate({
    key: key, model: model, maxTokens: 2048,
    prompt: '이 음성 메모를 한국어 글로 그대로 받아 적으세요. 말한 내용만 적고 설명 · 따옴표 · 머리말은 붙이지 마세요. 들리지 않으면 빈 줄.',
    inline: { mimeType: opts.mimeType || 'audio/ogg', data: opts.data }
  });
  return { text: String(g.text || '').trim(), model: g.model, provider: 'gemini' };
}

/**
 * AI 오류 → 응답. 화면에서 왜 안 됐는지 알 수 있게 원인을 그대로 보여 준다.
 * DB 오류(e.severity 있음)는 내용을 숨기고 일반 문구로.
 */
function sendAiError(res, tag, e, prefix) {
  console.error(tag, (e && e.message) || e);
  if (res.headersSent) return undefined;
  var code = (e && e.code) || '';
  var msg = (e && !e.severity && e.message) ? e.message : '';
  var head = prefix || 'AI 요청 실패';
  if (code === 'AI_NOT_READY') return res.status(503).json({ error: code, message: msg });
  if (code === 'CREDIT_LOW') return res.status(402).json({ error: code, message: msg, action: e.action ? { label: 'Anthropic Console 열기', url: e.action } : undefined });
  if (code === 'AI_OVERLOADED') return res.status(503).json({ error: code, message: msg || 'AI 가 붐빕니다. 잠시 후 다시 시도하세요.' });
  if (code === 'AI_KEY_INVALID') return res.status(502).json({ error: code, message: msg });
  return res.status(500).json({ error: 'AI_ERROR', message: head + (msg ? ': ' + msg : '') });
}

module.exports = {
  sendAiError: sendAiError,
  resolve: resolve,
  resolveEnv: resolveEnv,
  loadTenantCfg: loadTenantCfg,
  clearTenantCache: clearTenantCache,
  defaultModel: defaultModel,
  label: label,
  geminiGenerate: geminiGenerate,
  anthropicText: anthropicText,
  generateText: generateText,
  transcribe: transcribe,
  isCreditLow: isCreditLow
};
