/**
 * AI 구조화 응답 서비스 (A/S · 마인드맵) — v13.65, v13.296 Gemini 지원
 *
 * 어떤 AI 를 쓸지는 ai-provider.js 규칙(테넌트 키 → AI_PROVIDER → 있는 키).
 * Claude: 공식 SDK + 어댑티브 thinking + JSON 스키마 출력. Gemini: JSON 모드 + 스키마를 글로 안내.
 *
 * 기능:
 *   1) analyzeTicket({issueSummary, customerName, equipmentModel, categories})
 *      → { category, categoryConfidence, rcaDraft, preventionDraft, priority, summary }
 *   2) summarizeWeeklyStats(stats)
 *      → { headline, narrative, focus, actions }  (자연어 한국어 코멘트)
 *   3) recommendSimilarCases(current, candidates)
 *      → { top: [{ticketNo, score, reason}], summary }
 *
 * 모든 메서드는 사람이 검토할 "초안"을 반환. 자동 적용은 하지 않음.
 */

var config = require('../config');
var aiProvider = require('./ai-provider');

/* v13.296: Claude 전용이던 것을 공용 규칙(ai-provider)으로 — Gemini 키만 있어도 동작.
   테넌트 전용 키(관리 → AI 설정)도 따른다. */

// SDK lazy-load (의존성 미설치 시에도 서버 부팅에 영향 없도록) — 키마다 클라이언트 하나
var _clients = new Map();
var _sdk = null, _sdkErr = null;
function getClient(key) {
  if (!key) return null;
  if (_clients.has(key)) return _clients.get(key);
  if (_sdkErr) return null;
  try {
    if (!_sdk) _sdk = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    var c = new _sdk({ apiKey: key });
    _clients.set(key, c);
    return c;
  } catch (e) {
    _sdkErr = e;
    console.warn('[ai-claude] SDK 로드 실패:', e.message);
    return null;
  }
}

/** 환경변수 기준 사용 가능 여부 (테넌트 키까지 보려면 isReadyFor) */
function isReady() { return !!aiProvider.resolveEnv(); }
async function isReadyFor(tenantId) { return !!(await aiProvider.resolve(tenantId)); }
/** 지금 쓰일 AI 이름 (사용량 기록용) */
async function providerFor(tenantId) { var r = await aiProvider.resolve(tenantId); return r ? r.provider : ''; }
function providerName() { var r = aiProvider.resolveEnv(); return r ? r.provider : ''; }

/** 응답 글에서 JSON 꺼내기 (```json 울타리 · 앞뒤 군말 허용) */
function parseJsonText(t) {
  var s = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (_) { /* 아래에서 다시 */ }
  var a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { /* 아래 */ }
  }
  throw new Error('AI 답이 JSON 형식이 아닙니다');
}

function messagesText(messages) {
  return (messages || []).map(function (m) {
    return typeof m.content === 'string' ? m.content : (m.content || []).map(function (c) { return c.text || ''; }).join('\n');
  }).join('\n\n');
}

/** Gemini 로 JSON 구조화 응답 — 스키마는 글로 넣고 JSON 모드로 받음. 형식이 틀리면 한 번 더 */
async function callGeminiJson(key, model, opts) {
  var prompt = messagesText(opts.messages) +
    '\n\n## 답 형식\n아래 JSON 스키마를 따르는 JSON 객체 하나만 답하세요. 설명 글이나 ``` 는 쓰지 마세요.\n' + JSON.stringify(opts.schema);
  var lastErr = null;
  for (var i = 0; i < 2; i++) {
    var g = await aiProvider.geminiGenerate({ key: key, model: model, system: opts.system, prompt: prompt, json: true, maxTokens: opts.maxTokens });
    try {
      return { data: parseJsonText(g.text), usage: Object.assign({ model: g.model, provider: 'gemini' }, g.usage) };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** Claude 로 JSON 구조화 응답 */
async function callClaudeJson(key, model, opts) {
  var client = getClient(key);
  if (!client) throw new Error('Claude SDK 를 불러오지 못했습니다' + (_sdkErr ? ' (' + _sdkErr.message + ')' : ''));
  var resp;
  try {
    resp = await client.messages.create({
      model: model,
      // 어댑티브 thinking 은 생각 토큰도 max_tokens 에서 빠짐 — 작게 잡으면 답(text)이 비어 온다
      max_tokens: Math.max(opts.maxTokens || 0, 16000),
      thinking: { type: 'adaptive' },
      system: opts.system,
      messages: opts.messages,
      output_config: { format: { type: 'json_schema', schema: opts.schema } }
    });
  } catch (e) {
    var em = (e && e.message) || 'Claude API 오류';
    var err = new Error(em);
    if (aiProvider.isCreditLow(em)) err.code = 'CREDIT_LOW';
    else if (e && (e.status === 429 || e.status === 529)) err.code = 'AI_OVERLOADED';
    else if (e && e.status === 401) { err.code = 'AI_KEY_INVALID'; err.message = em + ' — ANTHROPIC_API_KEY 확인'; }
    throw err;
  }
  var textBlock = (resp.content || []).find(function (b) { return b.type === 'text'; });
  if (!textBlock) throw new Error('AI 응답이 비어 있습니다' + (resp.stop_reason ? ' (' + resp.stop_reason + ')' : ''));
  return { data: parseJsonText(textBlock.text), usage: Object.assign({ model: model, provider: 'anthropic' }, resp.usage) };
}

// ───────────────────────────────────────────────────────────────
// 공통: JSON 구조화 응답 helper — opts: { system, messages, schema, maxTokens, tenantId? }
// ───────────────────────────────────────────────────────────────
async function callJson(opts) {
  var r = await aiProvider.resolve(opts.tenantId);
  if (!r) {
    var ne = new Error('AI 미설정 — 서버의 GEMINI_API_KEY 또는 ANTHROPIC_API_KEY 를 채운 뒤 재시작하세요.');
    ne.code = 'AI_NOT_READY';
    throw ne;
  }
  if (r.provider === 'gemini') return callGeminiJson(r.key, r.model, opts);
  try {
    return await callClaudeJson(r.key, r.model, opts);
  } catch (e) {
    // Claude 크레딧 부족 → Gemini 키가 있으면 넘김 (업무 관리 AI 와 같은 동작)
    if (e.code === 'CREDIT_LOW' && config.ai.geminiKey) {
      console.warn('[ai-claude] Claude 크레딧 부족 → Gemini 로 폴백');
      return callGeminiJson(config.ai.geminiKey, aiProvider.defaultModel('gemini'), opts);
    }
    throw e;
  }
}

// ───────────────────────────────────────────────────────────────
// 1) 신고 내용 → 카테고리·RCA·재발방지 초안
// ───────────────────────────────────────────────────────────────
async function analyzeTicket(input) {
  var categoryList = (input.categories || []).map(function (c) {
    return '- ' + c.code + ': ' + c.label;
  }).join('\n');

  var system =
    '당신은 산업 장비 A/S(After-Service) 분석 전문가입니다. ' +
    '신고 내용을 분석해 카테고리·근본원인(RCA)·재발방지 대책 초안을 한국어로 작성합니다. ' +
    '제조·반도체·디스플레이·로봇·자동화 장비 도메인 지식을 활용하세요. ' +
    '추측이 필요한 경우 confidence를 낮추고, 정보 부족 시 추가 확인할 항목을 명시하세요.';

  var userText =
    '## 가용 카테고리 (코드: 라벨)\n' + (categoryList || '(없음)') + '\n\n' +
    '## 접수 정보\n' +
    '- 고객사: ' + (input.customerName || '-') + '\n' +
    '- 장비모델: ' + (input.equipmentModel || '-') + '\n' +
    '- 긴급도: ' + (input.priority || '-') + '\n' +
    '- 재현여부: ' + (input.reproduction || '-') + '\n' +
    (input.frequency ? '- 발생빈도: ' + input.frequency + (input.frequencyCount ? ' ' + input.frequencyCount + '회' : '') + '\n' : '') +
    (input.impactScope ? '- 영향범위: ' + input.impactScope + '\n' : '') +
    '\n## 고객 신고 내용 (원문)\n' + (input.issueSummary || '') + '\n';

  var schema = {
    type: 'object',
    properties: {
      category: { type: 'string', description: '가장 가능성 높은 카테고리 코드 (가용 카테고리 중 하나, 없으면 "etc")' },
      categoryConfidence: { type: 'number', description: '0~1 사이 신뢰도' },
      priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'], description: '제안 긴급도' },
      summary: { type: 'string', description: '신고 내용 요약 1~2문장' },
      rcaDraft: { type: 'string', description: '근본원인(RCA) 초안 — 가능성 높은 원인 2~3개를 우선순위로 나열' },
      preventionDraft: { type: 'string', description: '재발방지 대책 초안 — 구체적 액션 2~3개' },
      checkPoints: {
        type: 'array',
        items: { type: 'string' },
        description: '현장 확인이 필요한 추가 점검 항목 (선택, 최대 5개)'
      }
    },
    required: ['category', 'categoryConfidence', 'priority', 'summary', 'rcaDraft', 'preventionDraft'],
    additionalProperties: false
  };

  return callJson({
    tenantId: input.tenantId,
    system: system,
    messages: [{ role: 'user', content: userText }],
    schema: schema,
    maxTokens: 3072
  });
}

// ───────────────────────────────────────────────────────────────
// 2) 주간 통계 → 자연어 인사이트
// ───────────────────────────────────────────────────────────────
async function summarizeWeeklyStats(stats, tenantId) {
  var system =
    '당신은 A/S 운영 데이터를 분석하는 시니어 매니저입니다. ' +
    '주간 통계 숫자를 보고 한국어로 핵심 인사이트와 다음 주 액션을 작성합니다. ' +
    '단순 숫자 나열은 피하고, "왜 이렇게 됐는지" "어디를 봐야 하는지" 관점으로 작성하세요.';

  var statsText = JSON.stringify(stats, null, 2);
  var userText =
    '아래는 이번 주 A/S 통계입니다. 헤드라인 1줄, 분석 코멘트 2~3문장, ' +
    '집중 관찰 영역, 추천 액션을 작성해 주세요.\n\n' +
    '```json\n' + statsText + '\n```\n';

  var schema = {
    type: 'object',
    properties: {
      headline: { type: 'string', description: '한 줄 헤드라인 (예: "이번 주 SW 오류 급증, A 고객 집중 케어 필요")' },
      narrative: { type: 'string', description: '2~3문장 자연어 분석 — 숫자보다 의미 중심' },
      focus: { type: 'array', items: { type: 'string' }, description: '집중 관찰 영역 1~3개 (예: "신규 P1 추세", "B 고객 재발")' },
      actions: { type: 'array', items: { type: 'string' }, description: '다음 주 추천 액션 2~4개 (구체적이고 행동 가능한 것)' }
    },
    required: ['headline', 'narrative', 'focus', 'actions'],
    additionalProperties: false
  };

  return callJson({
    tenantId: tenantId,
    system: system,
    messages: [{ role: 'user', content: userText }],
    schema: schema,
    maxTokens: 2048
  });
}

// ───────────────────────────────────────────────────────────────
// 3) 유사 사례 추천 — SQL 후보를 받아서 점수·이유 부여
// ───────────────────────────────────────────────────────────────
async function recommendSimilarCases(current, candidates, tenantId) {
  if (!candidates || !candidates.length) return { data: { top: [], summary: '비교할 과거 사례가 없습니다.' }, usage: null };

  var system =
    '당신은 A/S 사례 검색 전문가입니다. ' +
    '현재 신고와 과거 사례들을 비교해 가장 유사한 3건을 선정하고 점수(0~100)와 이유를 부여합니다. ' +
    '단순 키워드 일치보다 "원인이 같을 가능성"을 우선합니다.';

  var curText =
    '## 현재 신고\n' +
    '- 접수번호: ' + (current.ticketNo || '(신규)') + '\n' +
    '- 고객사: ' + (current.customerName || '-') + '\n' +
    '- 장비모델: ' + (current.equipmentModel || '-') + '\n' +
    '- 카테고리: ' + (current.category || '-') + '\n' +
    '- 신고 내용: ' + (current.issueSummary || '') + '\n';

  var candText = candidates.map(function (c, i) {
    return '### 사례 #' + (i + 1) + ' (' + c.ticketNo + ')\n' +
      '- 고객사: ' + (c.customerName || '-') + '\n' +
      '- 장비모델: ' + (c.equipmentModel || '-') + '\n' +
      '- 카테고리: ' + (c.category || '-') + '\n' +
      '- 신고: ' + (c.issueSummary || '').slice(0, 200) + '\n' +
      (c.rca ? '- RCA: ' + c.rca.slice(0, 200) + '\n' : '') +
      (c.closure ? '- 종결: ' + c.closure + '\n' : '');
  }).join('\n');

  var userText = curText + '\n## 과거 사례 (' + candidates.length + '건)\n' + candText +
    '\n현재 신고와 가장 유사한 3건을 선정하고, 각 사례별 score(0~100)와 reason을 작성하세요. ' +
    '마지막에 종합 summary를 한 문단으로 작성하세요.';

  var schema = {
    type: 'object',
    properties: {
      top: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ticketNo: { type: 'string' },
            score: { type: 'number', description: '0~100 유사도 점수' },
            reason: { type: 'string', description: '유사하다고 판단한 이유 (1~2문장)' }
          },
          required: ['ticketNo', 'score', 'reason'],
          additionalProperties: false
        }
      },
      summary: { type: 'string', description: '종합 코멘트 — 과거 사례를 어떻게 활용할지 1~2문장' }
    },
    required: ['top', 'summary'],
    additionalProperties: false
  };

  return callJson({
    tenantId: tenantId,
    system: system,
    messages: [{ role: 'user', content: userText }],
    schema: schema,
    maxTokens: 2048
  });
}

module.exports = {
  isReady: isReady,
  isReadyFor: isReadyFor,
  providerFor: providerFor,
  providerName: providerName,
  parseJsonText: parseJsonText,
  callJson: callJson,
  analyzeTicket: analyzeTicket,
  summarizeWeeklyStats: summarizeWeeklyStats,
  recommendSimilarCases: recommendSimilarCases
};
