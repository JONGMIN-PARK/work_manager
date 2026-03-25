/**
 * AI 서비스 — 텔레그램 자연어 질답
 * 질문 분석 → 관련 DB 데이터 조회 (RAG) → AI 응답 생성
 */
var config = require('../config');
var db = require('../config/db');

var AM = { A: 'A(CS현장)', B: 'B(수주)', D: 'D(개발)', G: 'G(공통)', M: 'M(양산)', R: 'R(제안)', S: 'S(영업지원)' };

function isConfigured() {
  var ai = config.ai;
  if (ai.provider === 'gemini') return !!ai.geminiKey;
  if (ai.provider === 'anthropic') return !!ai.anthropicKey;
  return false;
}

/** 질문에서 키워드/의도 추출 */
function analyzeQuery(text) {
  var lower = text.toLowerCase();
  var intents = [];

  // 인원/팀 관련
  if (/누가|인원|팀원|과부하|바빠|업무량|투입/.test(text)) intents.push('people');
  // 프로젝트 관련
  if (/프로젝트|진행|지연|현황|상태/.test(text)) intents.push('projects');
  // 이슈 관련
  if (/이슈|문제|장애|버그|긴급|미해결/.test(text)) intents.push('issues');
  // 수주/납품 관련
  if (/수주|납품|납기|주문|업체|고객|거래처/.test(text)) intents.push('orders');
  // 시간/통계 관련
  if (/시간|통계|분석|비교|추이|평균|합계|요약/.test(text)) intents.push('stats');
  // 일정 관련
  if (/일정|회의|출장|연차|스케줄|캘린더/.test(text)) intents.push('events');
  // 기간 관련
  if (/이번\s*주|금주/.test(text)) intents.push('this_week');
  if (/이번\s*달|이달|이번달/.test(text)) intents.push('this_month');
  if (/지난\s*주|저번\s*주/.test(text)) intents.push('last_week');
  if (/지난\s*달|저번\s*달/.test(text)) intents.push('last_month');

  if (intents.length === 0) intents.push('general');

  return intents;
}

/** 의도에 따라 DB 데이터 수집 */
async function gatherContext(intents, userName) {
  var context = [];

  // 기간 계산
  var now = new Date();
  var day = now.getDay();
  var diffMon = day === 0 ? -6 : 1 - day;

  function fmt(d) { return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  function fmtISO(d) { return d.toISOString().slice(0, 10); }

  var weekStart = new Date(now); weekStart.setDate(now.getDate() + diffMon);
  var weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  var monthStart = now.getFullYear() + ('0' + (now.getMonth() + 1)).slice(-2) + '01';
  var monthEnd = now.getFullYear() + ('0' + (now.getMonth() + 1)).slice(-2) + '31';

  // 기간 결정
  var dateStart = fmt(weekStart);
  var dateEnd = fmt(weekEnd);
  if (intents.includes('this_month') || intents.includes('last_month')) {
    dateStart = monthStart;
    dateEnd = monthEnd;
  }
  if (intents.includes('last_week')) {
    var lwStart = new Date(weekStart); lwStart.setDate(lwStart.getDate() - 7);
    var lwEnd = new Date(weekStart); lwEnd.setDate(lwEnd.getDate() - 1);
    dateStart = fmt(lwStart);
    dateEnd = fmt(lwEnd);
  }
  if (intents.includes('last_month')) {
    var lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    dateStart = fmt(lm);
    dateEnd = fmt(lmEnd);
  }

  try {
    // 인원/통계 데이터
    if (intents.includes('people') || intents.includes('stats') || intents.includes('general')) {
      var peopleR = await db.query(
        'SELECT name, COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT date) as days, COUNT(DISTINCT order_no) as orders FROM work_records WHERE date >= $1 AND date <= $2 GROUP BY name ORDER BY hours DESC LIMIT 15',
        [dateStart, dateEnd]
      );
      if (peopleR.rows.length > 0) {
        context.push('[인원별 투입시간 (' + dateStart + '~' + dateEnd + ')]\n' +
          peopleR.rows.map(function (r) {
            var avg = r.days > 0 ? Math.round(parseFloat(r.hours) / r.days * 10) / 10 : 0;
            return r.name + ': ' + Math.round(parseFloat(r.hours) * 10) / 10 + 'h (' + r.days + '일, 일평균 ' + avg + 'h, 수주 ' + r.orders + '건)';
          }).join('\n'));
      }

      // 업무분장별
      var abbrR = await db.query(
        'SELECT abbr, COALESCE(SUM(hours),0) as hours FROM work_records WHERE date >= $1 AND date <= $2 GROUP BY abbr ORDER BY hours DESC',
        [dateStart, dateEnd]
      );
      if (abbrR.rows.length > 0) {
        context.push('[업무분장별 시간]\n' +
          abbrR.rows.map(function (r) { return (AM[r.abbr] || r.abbr) + ': ' + Math.round(parseFloat(r.hours) * 10) / 10 + 'h'; }).join(', '));
      }
    }

    // 프로젝트 데이터
    if (intents.includes('projects') || intents.includes('general')) {
      var projR = await db.query(
        "SELECT name, order_no, status, progress, end_date, assignees FROM projects WHERE status NOT IN ('done') ORDER BY CASE status WHEN 'delayed' THEN 0 WHEN 'active' THEN 1 ELSE 2 END LIMIT 10"
      );
      if (projR.rows.length > 0) {
        context.push('[진행중 프로젝트]\n' +
          projR.rows.map(function (r) {
            var assignees = [];
            try { assignees = typeof r.assignees === 'string' ? JSON.parse(r.assignees) : (r.assignees || []); } catch (_) {}
            return (r.order_no || '') + ' ' + r.name + ' | 상태:' + r.status + ' | 진행률:' + (r.progress || 0) + '% | 납기:' + (r.end_date || '-') + ' | 담당:' + assignees.join(',');
          }).join('\n'));
      }
    }

    // 이슈 데이터
    if (intents.includes('issues') || intents.includes('general')) {
      var issR = await db.query(
        "SELECT title, urgency, status, assignees, due_date FROM issues WHERE status NOT IN ('resolved','closed') ORDER BY CASE urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END LIMIT 10"
      );
      if (issR.rows.length > 0) {
        context.push('[미해결 이슈]\n' +
          issR.rows.map(function (r) {
            var assignees = [];
            try { assignees = typeof r.assignees === 'string' ? JSON.parse(r.assignees) : (r.assignees || []); } catch (_) {}
            return '[' + r.urgency + '] ' + r.title + ' | 상태:' + r.status + ' | 담당:' + assignees.join(',') + (r.due_date ? ' | 기한:' + r.due_date : '');
          }).join('\n'));
      }
    }

    // 수주 데이터
    if (intents.includes('orders')) {
      var ordR = await db.query(
        'SELECT order_no, client, name, amount, manager, delivery FROM orders ORDER BY delivery DESC NULLS LAST LIMIT 10'
      );
      if (ordR.rows.length > 0) {
        context.push('[수주 목록]\n' +
          ordR.rows.map(function (r) {
            return (r.order_no || '-') + ' | ' + (r.client || r.name || '-') + ' | 금액:' + (r.amount || '-') + ' | 담당:' + (r.manager || '-') + ' | 납품:' + (r.delivery || '-');
          }).join('\n'));
      }
    }

    // 일정 데이터
    if (intents.includes('events')) {
      var evtR = await db.query(
        'SELECT title, type, start_date, end_date, assignees FROM events WHERE end_date >= $1 ORDER BY start_date LIMIT 10',
        [fmtISO(now)]
      );
      if (evtR.rows.length > 0) {
        context.push('[예정 일정]\n' +
          evtR.rows.map(function (r) {
            return r.start_date + ' ~ ' + r.end_date + ' | ' + r.type + ' | ' + r.title;
          }).join('\n'));
      }
    }

  } catch (err) {
    console.error('[AI] Context gathering error:', err.message);
  }

  return context.join('\n\n');
}

/** Gemini API 호출 */
async function callGemini(prompt) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + config.ai.geminiModel + ':generateContent?key=' + config.ai.geminiKey;
  var res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1000, temperature: 0.3 }
    })
  });
  var data = await res.json();
  if (data.candidates && data.candidates[0] && data.candidates[0].content) {
    return data.candidates[0].content.parts[0].text;
  }
  if (data.error) throw new Error(data.error.message);
  return null;
}

/** Claude API 호출 */
async function callAnthropic(prompt) {
  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ai.anthropicKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.ai.anthropicModel,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  var data = await res.json();
  if (data.content && data.content[0]) return data.content[0].text;
  if (data.error) throw new Error(data.error.message);
  return null;
}

/** AI 응답 생성 */
async function callAI(prompt) {
  if (config.ai.provider === 'anthropic' && config.ai.anthropicKey) {
    return callAnthropic(prompt);
  }
  if (config.ai.geminiKey) {
    return callGemini(prompt);
  }
  return null;
}

/**
 * 텔레그램 자연어 질문 처리
 * @param {string} question - 사용자 질문
 * @param {string} userName - 질문자 이름
 * @returns {string} AI 응답 텍스트
 */
async function answerQuestion(question, userName) {
  if (!isConfigured()) {
    return '🤖 AI 기능을 사용하려면 관리자가 GEMINI_API_KEY 또는 ANTHROPIC_API_KEY를 설정해야 합니다.';
  }

  // 1. 의도 분석
  var intents = analyzeQuery(question);

  // 2. 관련 데이터 수집
  var contextData = await gatherContext(intents, userName);

  // 3. 프롬프트 구성
  var systemPrompt = '당신은 "Work Manager"라는 업무 관리 시스템의 AI 어시스턴트입니다.\n' +
    '아래 실제 데이터를 기반으로 사용자의 질문에 한국어로 간결하게 답변하세요.\n' +
    '텔레그램 메시지이므로 300자 이내로 핵심만 답하세요.\n' +
    'HTML 태그(<b>, <i>, <code>)를 사용할 수 있습니다.\n' +
    '데이터에 없는 내용은 추측하지 말고 "해당 데이터가 없습니다"라고 답하세요.\n\n' +
    '질문자: ' + userName + '\n\n';

  if (contextData) {
    systemPrompt += '=== 현재 데이터 ===\n' + contextData + '\n=== 데이터 끝 ===\n\n';
  } else {
    systemPrompt += '(관련 데이터가 없습니다)\n\n';
  }

  systemPrompt += '질문: ' + question;

  // 4. AI 호출
  var answer = await callAI(systemPrompt);
  if (!answer) return '🤖 AI 응답을 생성할 수 없습니다. 잠시 후 다시 시도해주세요.';

  // 텔레그램 메시지 길이 제한
  if (answer.length > 3800) {
    answer = answer.slice(0, 3800) + '\n\n... (응답이 길어 생략됨)';
  }

  return '🤖 ' + answer;
}

module.exports = {
  isConfigured: isConfigured,
  answerQuestion: answerQuestion,
  analyzeQuery: analyzeQuery,
  gatherContext: gatherContext
};
