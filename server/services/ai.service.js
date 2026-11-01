/**
 * AI 질의 서비스 — 웹 "✨ AI에게 묻기" · 텔레그램 자연어 질답
 * 질문 분석 → 관련 DB 데이터 조회 (RAG) → AI 응답 생성
 *
 * v13.297: 묻는 사람이 화면에서 볼 수 있는 것만 AI 에 넘긴다 (예전엔 회사 전체를 넘김).
 *   프로젝트 · 마일스톤 → lib/project-access (화면 목록과 같은 가시성)
 *   이슈 → 프로젝트 가시성 + 프로젝트 없는 이슈는 본인 것만 (통합 검색과 같음)
 *   업무일지 → lib/record-scope (관리자 전체 · 부서장 부서 · 그 외 본인)
 *   일정 → 접근 가능한 프로젝트의 일정 + 본인 개인 일정 (일정 목록과 같음)
 *   수주 · A/S → 회사 전체 (목록 화면과 같음)
 * 각 행에는 [P1] 같은 근거 표시를 붙여, 답에서 그 표시를 근거 링크로 바꾼다.
 * v13.298: AI 가 먼저 조회할 도구 · 조건을 고르고(ai-tools.planPrompt) 서버가 실행 → 그 데이터로 답.
 *   이어 묻기(history) · 차트(charts) · 추천 질문(followups). 고르기 실패 · AI_QUERY_PLANNER=0 이면 낱말 의도 묶음.
 */
var pd = require('../lib/project-defaults');
var aiProvider = require('./ai-provider');
var aiTools = require('./ai-tools');

var CITE_RE = /\[((?:[PMIOA]\d+)(?:\s*,\s*[PMIOA]\d+)*)\]/g;

/** AI 를 쓸 수 있는지 (환경변수 키 기준 — 하나만 있어도 됨, v13.296) */
function isConfigured() { return !!aiProvider.resolveEnv(); }

/** 질문에서 키워드/의도 추출 */
function analyzeQuery(text) {
  var intents = [];
  if (/누가|인원|팀원|과부하|바빠|바쁜|업무량|투입|부하/.test(text)) intents.push('people');
  if (/프로젝트|진행|지연|현황|상태|위험|리스크/.test(text)) intents.push('projects');
  if (/마일스톤|마감|기한|데드라인|일정\s*지연|늦/.test(text)) intents.push('milestones');
  if (/이슈|문제|장애|버그|긴급|미해결/.test(text)) intents.push('issues');
  if (/수주|납품|납기|주문|업체|고객|거래처/.test(text)) intents.push('orders');
  if (/A\/S|\bAS\b|에이에스|고장|수리|클레임|불량|서비스/i.test(text)) intents.push('as');
  if (/시간|통계|분석|비교|추이|평균|합계|요약/.test(text)) intents.push('stats');
  if (/일정|회의|출장|연차|스케줄|캘린더/.test(text)) intents.push('events');
  if (/이번\s*주|금주/.test(text)) intents.push('this_week');
  if (/이번\s*달|이달|이번달/.test(text)) intents.push('this_month');
  if (/지난\s*주|저번\s*주/.test(text)) intents.push('last_week');
  if (/지난\s*달|저번\s*달/.test(text)) intents.push('last_month');
  if (!intents.some(function (i) { return ['people', 'projects', 'milestones', 'issues', 'orders', 'as', 'stats', 'events'].indexOf(i) >= 0; })) intents.push('general');
  return intents;
}

/**
 * 의도에 따라 DB 데이터 수집 — 묻는 사람 권한 범위 안에서만 (도구 고르기를 못 할 때 쓰는 기본 묶음)
 * @param {string[]} intents
 * @param {{ userId, role, departmentId, tenantId, name }} actor
 * @returns {Promise<{ text, sources, charts, ran }>}
 */
async function gatherContext(intents, actor) {
  return aiTools.runCalls(aiTools.callsForIntents(intents), actor);
}

/** 도구 고르기 쓸지 — AI_QUERY_PLANNER=0 이면 끔 (낱말 의도만) */
function plannerOn() { return !/^(0|false|off)$/i.test(process.env.AI_QUERY_PLANNER || ''); }

/**
 * 질문 → 조회할 도구 고르기 (AI) → 실행. 고르기가 실패하면 낱말 의도 묶음.
 * @returns {Promise<{ ctx, intents, planned: boolean }>}
 */
async function collect(question, actor, history) {
  var intents = analyzeQuery(question);
  var calls = null;
  if (plannerOn()) {
    try {
      var p = await aiProvider.generateText({ prompt: aiTools.planPrompt(question, actor, history), tenantId: actor.tenantId, maxTokens: 2048, json: true });
      calls = p && aiTools.parsePlan(p.text);
    } catch (e) {
      console.warn('[AI] 도구 고르기 실패 → 기본 묶음:', e.message);
      // 키 · 크레딧 문제는 답 단계에서도 똑같이 나므로 그대로 올림
      if (e.code === 'CREDIT_LOW' || e.code === 'AI_KEY_INVALID') throw e;
    }
  }
  var ctx = await aiTools.runCalls(calls || aiTools.callsForIntents(intents), actor);
  return { ctx: ctx, intents: intents, planned: !!calls };
}

/** 이전 대화 정리 — 최근 3개, 길이 제한 */
function cleanHistory(h) {
  if (!Array.isArray(h)) return [];
  return h.filter(function (x) { return x && x.q && x.a; }).slice(-3).map(function (x) {
    return { q: String(x.q).slice(0, 300), a: String(x.a).replace(/\[(?:[PMIOA]\d+)(?:\s*,\s*[PMIOA]\d+)*\]/g, '').slice(0, 800) };
  });
}

/** 프롬프트 — web 은 마크다운 + 근거 표시 + 이어 물을 질문, telegram 은 짧게 · 표시 없이 */
function buildPrompt(question, ctx, actor, mode, history) {
  var web = mode !== 'telegram';
  var s = '당신은 "업무 관리자"라는 업무 관리 시스템의 AI 어시스턴트입니다.\n' +
    '아래 실제 데이터만 근거로 질문에 한국어로 답하세요. 오늘은 ' + pd.todayKST() + ' 입니다.\n' +
    '데이터에 없는 내용은 추측하지 말고 "해당 데이터가 없습니다"라고 답하세요. 데이터는 질문자가 볼 수 있는 범위만 들어 있습니다.\n' +
    '숫자는 데이터에 있는 값을 그대로 쓰고, 합계 · 비율 · 차이를 계산했다면 계산했다고 밝히세요.\n';
  if (web) {
    s += '먼저 핵심 결론을 2~3줄로, 필요하면 그 아래 "## " 소제목과 "- " 목록으로 정리하세요. 표·코드블록은 쓰지 마세요.\n' +
      '근거가 된 데이터 행 앞의 [P1] · [M2] · [I3] · [O4] · [A5] 같은 표시를 해당 문장 끝에 그대로 붙이세요 (예: "설비 A 프로젝트가 지연 중입니다 [P1]"). 없는 표시를 만들지 마세요.\n' +
      '맨 마지막 줄에는 이어서 물어볼 만한 짧은 질문 2~3개를 "이어서: 질문1 | 질문2 | 질문3" 형식으로 쓰세요.\n';
  } else {
    s += '텔레그램 메시지이므로 300자 이내로 핵심만 답하세요.\n' +
      '서식 규칙: 마크다운 제목(#), 표(|), 코드블록(```)은 절대 쓰지 마세요. 강조는 **굵게**만, 목록은 "- "로 시작.\n' +
      '데이터 행 앞의 [P1] 같은 표시는 답에 쓰지 마세요.\n';
  }
  s += '\n질문자: ' + (actor.name || '사용자') + '\n\n';
  if (history && history.length) {
    s += '=== 이전 대화 (이번 질문이 이어지는 질문이면 참고) ===\n' + history.map(function (h) { return 'Q: ' + h.q + '\nA: ' + h.a; }).join('\n\n') + '\n=== 이전 대화 끝 ===\n\n';
  }
  s += ctx.text ? '=== 현재 데이터 ===\n' + ctx.text + '\n=== 데이터 끝 ===\n\n' : '(관련 데이터가 없습니다)\n\n';
  return s + '질문: ' + question;
}

/** 답에서 인용된 근거 키 */
function citedKeys(answer) {
  var keys = {};
  String(answer || '').replace(CITE_RE, function (_m, g) { g.split(/\s*,\s*/).forEach(function (k) { keys[k] = true; }); return _m; });
  return keys;
}

/** 답 끝 "이어서: a | b | c" → { text(그 줄 뺀 것), followups } */
function splitFollowups(text) {
  var follow = [];
  var out = String(text || '').replace(/\n?[ \t]*(?:\*\*)?이어서(?:\*\*)?\s*[:：]\s*(.+?)\s*$/, function (_m, list) {
    follow = list.split(/\s*\|\s*/).map(function (q) { return q.replace(/^[-*\d.\s"“]+|["”]+$/g, '').trim().slice(0, 80); })
      .filter(function (q) { return q.length >= 2; }).slice(0, 3);
    return '';
  });
  return { text: out.replace(/\s+$/, ''), followups: follow };
}

/**
 * 웹 질의 — { answer, sources(인용된 것 먼저 · cited 표시), charts, tools, followups, context, intents, provider, model, note } · 키 없으면 null
 * opts.history: [{ q, a }] 이전 대화 (이어 묻기)
 */
async function answerWeb(question, actor, opts) {
  if (!(await aiProvider.resolve(actor.tenantId))) return null;
  var history = cleanHistory(opts && opts.history);
  var got = await collect(question, actor, history);
  var ctx = got.ctx;
  var out = await aiProvider.generateText({ prompt: buildPrompt(question, ctx, actor, 'web', history), tenantId: actor.tenantId, maxTokens: 4096 });
  if (!out) return null;
  var sp = splitFollowups(out.text);
  var keys = citedKeys(sp.text);
  var valid = {};
  ctx.sources.forEach(function (s) { valid[s.key] = true; });
  // 없는 표시(지어낸 것)는 지움
  var answer = sp.text.replace(CITE_RE, function (m, g) {
    var ok = g.split(/\s*,\s*/).filter(function (k) { return valid[k]; });
    return ok.length ? '[' + ok.join(', ') + ']' : '';
  });
  var sources = ctx.sources.map(function (s) { return Object.assign({ cited: !!keys[s.key] }, s); })
    .sort(function (a, b) { return (b.cited ? 1 : 0) - (a.cited ? 1 : 0); });
  return {
    answer: answer, sources: sources, charts: ctx.charts || [], followups: sp.followups,
    tools: (ctx.ran || []).map(function (r) { return { tool: r.tool, label: r.label, args: r.args, rows: r.rows }; }),
    planned: got.planned, context: ctx.text, intents: got.intents, provider: out.provider, model: out.model, note: out.note
  };
}

/**
 * 텔레그램 자연어 질문 처리
 * @param {string} question
 * @param {{ user_id, role, department_id, tenant_id, name }} tgUser  telegram getUserByChatId 결과
 * @returns {Promise<string>} 텔레그램 HTML 답
 */
async function answerQuestion(question, tgUser) {
  var actor = { userId: tgUser && tgUser.user_id, role: tgUser && tgUser.role, departmentId: tgUser && tgUser.department_id, tenantId: tgUser && tgUser.tenant_id, name: tgUser && tgUser.name };
  if (!(await aiProvider.resolve(actor.tenantId))) {
    return '🤖 AI 기능을 사용하려면 관리자가 GEMINI_API_KEY 또는 ANTHROPIC_API_KEY를 설정해야 합니다.';
  }
  var got = await collect(question, actor, []);
  var out = await aiProvider.generateText({ prompt: buildPrompt(question, got.ctx, actor, 'telegram'), tenantId: actor.tenantId, maxTokens: 2048 });
  var answer = out && out.text;
  if (!answer) return '🤖 AI 응답을 생성할 수 없습니다. 잠시 후 다시 시도해주세요.';
  answer = formatForTelegram(answer.replace(/\s*\[(?:[PMIOA]\d+)(?:\s*,\s*[PMIOA]\d+)*\]/g, ''));
  if (answer.length > 3800) answer = answer.slice(0, 3800) + '\n\n... (응답이 길어 생략됨)';
  return '🤖 ' + answer;
}

/* AI 마크다운 응답 → 깔끔한 텔레그램 HTML 변환
   (parse_mode=HTML 기준. AI는 마크다운만 출력하도록 지시 → raw 태그 없음 가정하여 escape 우선) */
function formatForTelegram(md) {
  if (md == null) return '';
  var s = String(md).replace(/\r\n/g, '\n');
  // 1) HTML 특수문자 escape (메시지 거부/오렌더 방지)
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 2) 코드펜스 ```...``` → <pre>
  s = s.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, function (_m, c) { return '<pre>' + c.replace(/\n+$/, '') + '</pre>'; });
  // 3) 마크다운 제목(#~######) → 굵게 (해시 "태그" 제거)
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, '<b>$1</b>');
  // 4) 굵게 **x** / __x__
  s = s.replace(/\*\*([^\n*]+)\*\*/g, '<b>$1</b>').replace(/__([^\n_]+)__/g, '<b>$1</b>');
  // 5) 인라인 코드 `x`
  s = s.replace(/`([^\n`]+)`/g, '<code>$1</code>');
  // 6) 링크 [텍스트](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  // 7) 글머리표 -,*,+ → •
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, '• ');
  // 8) 인용(> → escape 후 &gt;)·수평선(---) 제거
  s = s.replace(/^[ \t]*(?:&gt;|>)[ \t]?/gm, '').replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '');
  // 9) 과도한 빈 줄 축소
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

module.exports = {
  isConfigured: isConfigured,
  answerQuestion: answerQuestion,
  answerWeb: answerWeb,
  analyzeQuery: analyzeQuery,
  gatherContext: gatherContext,
  buildPrompt: buildPrompt,
  citedKeys: citedKeys,
  splitFollowups: splitFollowups,
  cleanHistory: cleanHistory,
  collect: collect,
  splitFollowups: splitFollowups,
  cleanHistory: cleanHistory,
  formatForTelegram: formatForTelegram
};
