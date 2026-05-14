/**
 * Claude AI 서비스 (A/S 모듈 전용) — v13.65
 *
 * 공식 Anthropic SDK 사용. 모델: claude-opus-4-7 (config로 override 가능).
 * 어댑티브 thinking + 응답 캐싱(prompt cache) 적용.
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

// SDK lazy-load (의존성 미설치 시에도 서버 부팅에 영향 없도록)
var _client = null;
var _clientLoadErr = null;
function getClient() {
  if (_client) return _client;
  if (_clientLoadErr) return null;
  try {
    var Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    if (!config.ai.anthropicKey) {
      _clientLoadErr = new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.');
      return null;
    }
    _client = new Anthropic({ apiKey: config.ai.anthropicKey });
    return _client;
  } catch (e) {
    _clientLoadErr = e;
    console.warn('[ai-claude] SDK 로드 실패:', e.message);
    return null;
  }
}

function isReady() { return !!getClient(); }

// ───────────────────────────────────────────────────────────────
// 공통: JSON 구조화 응답 helper
// ───────────────────────────────────────────────────────────────
async function callJson(opts) {
  var client = getClient();
  if (!client) throw new Error('Claude API 미연결 (ANTHROPIC_API_KEY 또는 SDK 누락)');
  var resp = await client.messages.create({
    model: config.ai.anthropicModel || 'claude-opus-4-7',
    max_tokens: opts.maxTokens || 4096,
    thinking: { type: 'adaptive' },
    system: opts.system,
    messages: opts.messages,
    output_config: {
      format: {
        type: 'json_schema',
        schema: opts.schema
      }
    }
  });
  // 첫 번째 text 블록을 파싱 (output_config.format이 JSON을 보장)
  var textBlock = resp.content.find(function (b) { return b.type === 'text'; });
  if (!textBlock) throw new Error('AI 응답에 텍스트 블록이 없습니다.');
  try {
    return { data: JSON.parse(textBlock.text), usage: resp.usage };
  } catch (e) {
    throw new Error('AI JSON 파싱 실패: ' + e.message);
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
    system: system,
    messages: [{ role: 'user', content: userText }],
    schema: schema,
    maxTokens: 3072
  });
}

// ───────────────────────────────────────────────────────────────
// 2) 주간 통계 → 자연어 인사이트
// ───────────────────────────────────────────────────────────────
async function summarizeWeeklyStats(stats) {
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
    system: system,
    messages: [{ role: 'user', content: userText }],
    schema: schema,
    maxTokens: 2048
  });
}

// ───────────────────────────────────────────────────────────────
// 3) 유사 사례 추천 — SQL 후보를 받아서 점수·이유 부여
// ───────────────────────────────────────────────────────────────
async function recommendSimilarCases(current, candidates) {
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
    system: system,
    messages: [{ role: 'user', content: userText }],
    schema: schema,
    maxTokens: 2048
  });
}

module.exports = {
  isReady: isReady,
  analyzeTicket: analyzeTicket,
  summarizeWeeklyStats: summarizeWeeklyStats,
  recommendSimilarCases: recommendSimilarCases
};
