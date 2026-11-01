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
 */
var db = require('../config/db');
var pd = require('../lib/project-defaults');
var pa = require('../lib/project-access');
var rs = require('../lib/record-scope');
var aiProvider = require('./ai-provider');

var AM = { A: 'A(CS현장)', B: 'B(수주)', D: 'D(개발)', G: 'G(공통)', M: 'M(양산)', R: 'R(제안)', S: 'S(영업지원)' };
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

/** 묻는 사람 → 권한 함수들이 쓰는 req 모양 { user: { sub, role, departmentId }, tenant: { id } } */
function actorReq(actor) {
  return { user: { sub: actor.userId, role: actor.role || 'member', departmentId: actor.departmentId || null }, tenant: { id: actor.tenantId } };
}

function parseArr(v) {
  if (Array.isArray(v)) return v;
  try { var a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch (_) { return []; }
}

/** 기간 계산 — 한국 날짜 기준. 업무일지 date 는 YYYYMMDD */
function periodOf(intents) {
  var today = pd.todayKST();
  var now = new Date(today + 'T00:00:00');
  function fmt(d) { return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  var day = now.getDay();
  var ws = new Date(now); ws.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
  var we = new Date(ws); we.setDate(ws.getDate() + 6);
  var p = { start: fmt(ws), end: fmt(we), label: '이번 주' };
  if (intents.indexOf('this_month') >= 0) {
    var ms = new Date(now.getFullYear(), now.getMonth(), 1), me = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    p = { start: fmt(ms), end: fmt(me), label: '이번 달' };
  }
  if (intents.indexOf('last_week') >= 0) {
    var ls = new Date(ws); ls.setDate(ls.getDate() - 7);
    var le = new Date(ws); le.setDate(le.getDate() - 1);
    p = { start: fmt(ls), end: fmt(le), label: '지난주' };
  }
  if (intents.indexOf('last_month') >= 0) {
    var lm = new Date(now.getFullYear(), now.getMonth() - 1, 1), lme = new Date(now.getFullYear(), now.getMonth(), 0);
    p = { start: fmt(lm), end: fmt(lme), label: '지난달' };
  }
  p.today = today;
  return p;
}

var SCOPE_LABEL = { tenant: '회사 전체', department: '우리 부서', self: '본인 것만' };

/**
 * 의도에 따라 DB 데이터 수집 — 묻는 사람 권한 범위 안에서만
 * @param {string[]} intents
 * @param {{ userId, role, departmentId, tenantId, name }} actor
 * @returns {Promise<{ text: string, sources: Array<{ key, type, title, sub, nav }> }>}
 */
async function gatherContext(intents, actor) {
  if (!actor || !actor.tenantId || !actor.userId) return { text: '', sources: [] };
  var req = actorReq(actor);
  var has = function (k) { return intents.indexOf(k) >= 0 || intents.indexOf('general') >= 0; };
  var per = periodOf(intents);
  var context = [], sources = [];
  var seq = { P: 0, M: 0, I: 0, O: 0, A: 0 };
  function src(prefix, type, title, sub, nav) {
    var key = prefix + (++seq[prefix]);
    sources.push({ key: key, type: type, title: title || '', sub: sub || '', nav: nav });
    return '[' + key + '] ';
  }
  async function safe(label, fn) {
    try { await fn(); } catch (e) { console.error('[AI] 데이터 수집 실패 (' + label + '):', e.message); }
  }

  // 업무일지 — 인원별 · 분장별 시간
  if (has('people') || has('stats')) await safe('work', async function () {
    var sc = rs.recordScope(req);
    var w = sc.where + ' AND date >= $' + sc.nextIdx + ' AND date <= $' + (sc.nextIdx + 1);
    var params = sc.params.concat([per.start, per.end]);
    var r = await db.query('SELECT name, COALESCE(SUM(hours),0) AS hours, COUNT(DISTINCT date) AS days, COUNT(DISTINCT order_no) AS orders FROM work_records WHERE ' + w +
      ' GROUP BY name ORDER BY hours DESC LIMIT 20', params);
    if (r.rows.length) {
      context.push('[인원별 투입시간 · ' + per.label + ' ' + per.start + '~' + per.end + ' · 범위: ' + SCOPE_LABEL[sc.scope] + ']\n' + r.rows.map(function (x) {
        var h = Math.round(parseFloat(x.hours) * 10) / 10;
        var avg = x.days > 0 ? Math.round(parseFloat(x.hours) / x.days * 10) / 10 : 0;
        return x.name + ': ' + h + 'h (' + x.days + '일, 일평균 ' + avg + 'h, 수주 ' + x.orders + '건)';
      }).join('\n'));
    }
    var a = await db.query('SELECT abbr, COALESCE(SUM(hours),0) AS hours FROM work_records WHERE ' + w + ' GROUP BY abbr ORDER BY hours DESC', params);
    if (a.rows.length) {
      context.push('[업무분장별 시간]\n' + a.rows.map(function (x) { return (AM[x.abbr] || x.abbr) + ': ' + Math.round(parseFloat(x.hours) * 10) / 10 + 'h'; }).join(', '));
    }
    var o = await db.query('SELECT order_no, COALESCE(SUM(hours),0) AS hours, COUNT(DISTINCT name) AS people FROM work_records WHERE ' + w +
      " AND order_no IS NOT NULL AND order_no <> '' GROUP BY order_no ORDER BY hours DESC LIMIT 10", params);
    if (o.rows.length) {
      context.push('[수주번호별 투입시간]\n' + o.rows.map(function (x) { return x.order_no + ': ' + Math.round(parseFloat(x.hours) * 10) / 10 + 'h (' + x.people + '명)'; }).join('\n'));
    }
  });

  // 프로젝트 — 지연 먼저
  if (has('projects')) await safe('projects', async function () {
    var v = pa.visibleProjectsSql(req, 'p', 3);
    var st = pd.computeStatusSql('p', '$1');
    var r = await db.query('SELECT p.id, p.name, p.order_no, ' + st + ' AS status, p.progress, p.end_date, p.assignees FROM projects p ' +
      "WHERE p.tenant_id = $2 AND " + v.sql + " AND p.status NOT IN ('done') " +
      'ORDER BY CASE ' + st + " WHEN 'delayed' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, p.end_date NULLS LAST LIMIT 15",
      [per.today, actor.tenantId].concat(v.params));
    if (r.rows.length) {
      context.push('[진행 중 프로젝트]\n' + r.rows.map(function (x) {
        return src('P', 'project', x.name, x.order_no, { projectId: x.id }) + (x.order_no ? x.order_no + ' ' : '') + x.name +
          ' | 상태:' + x.status + ' | 진행률:' + (x.progress || 0) + '% | 납기:' + (x.end_date || '-') + ' | 담당:' + parseArr(x.assignees).join(',');
      }).join('\n'));
    }
  });

  // 마일스톤 — 2주 안 마감 · 이미 지난 것 (완료 제외)
  if (has('milestones') || has('projects')) await safe('milestones', async function () {
    var v = pa.visibleProjectsSql(req, 'p', 3);
    var until = new Date(per.today + 'T00:00:00'); until.setDate(until.getDate() + 14);
    var untilStr = until.toISOString().slice(0, 10);
    var r = await db.query('SELECT m.id, m.name, m.end_date, m.progress, m.project_id, p.name AS proj_name FROM milestones m ' +
      'JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id ' +
      "WHERE m.tenant_id = $1 AND " + v.sql + " AND COALESCE(m.status,'') <> 'done' AND p.status NOT IN ('done','hold') " +
      "AND m.end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND m.end_date <= $2 ORDER BY m.end_date LIMIT 15",
      [actor.tenantId, untilStr].concat(v.params));
    if (r.rows.length) {
      context.push('[2주 안 마감 · 마감 지난 마일스톤 (오늘 ' + per.today + ')]\n' + r.rows.map(function (x) {
        var late = x.end_date < per.today ? ' ⚠️마감 지남' : '';
        return src('M', 'milestone', x.name, x.proj_name, { projectId: x.project_id }) + x.proj_name + ' › ' + x.name +
          ' | 마감:' + x.end_date + late + ' | 진행률:' + (x.progress || 0) + '%';
      }).join('\n'));
    }
  });

  // 이슈 — 미해결, 긴급 먼저
  if (has('issues')) await safe('issues', async function () {
    var sub = pa.accessibleProjectsSubquery(req, 3);
    var r = await db.query("SELECT id, title, urgency, status, assignees, due_date, order_no FROM issues WHERE tenant_id = $1 AND status NOT IN ('resolved','closed') " +
      'AND ((project_id IS NULL AND created_by = $2) OR project_id IN (' + sub.sql + ')) ' +
      "ORDER BY CASE urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at DESC LIMIT 15",
      [actor.tenantId, actor.userId].concat(sub.params));
    if (r.rows.length) {
      context.push('[미해결 이슈]\n' + r.rows.map(function (x) {
        return src('I', 'issue', x.title, x.order_no, { issueId: x.id }) + '[' + x.urgency + '] ' + x.title + ' | 상태:' + x.status +
          ' | 담당:' + parseArr(x.assignees).join(',') + (x.due_date ? ' | 기한:' + x.due_date : '');
      }).join('\n'));
    }
  });

  // 수주 — 회사 전체 (수주 목록 화면과 같음)
  if (intents.indexOf('orders') >= 0) await safe('orders', async function () {
    var r = await db.query('SELECT order_no, client, name, amount, manager, delivery FROM orders WHERE tenant_id = $1 ORDER BY delivery DESC NULLS LAST LIMIT 15', [actor.tenantId]);
    if (r.rows.length) {
      context.push('[수주 목록]\n' + r.rows.map(function (x) {
        return src('O', 'order', x.name || x.order_no, x.client, { orderNo: x.order_no }) + (x.order_no || '-') + ' | ' + (x.client || x.name || '-') +
          ' | 금액:' + (x.amount || '-') + ' | 담당:' + (x.manager || '-') + ' | 납품:' + (x.delivery || '-');
      }).join('\n'));
    }
  });

  // A/S — 회사 전체 (A/S 목록 화면과 같음): 진행 중 + 최근 90일 장비별 건수
  if (intents.indexOf('as') >= 0) await safe('as', async function () {
    var r = await db.query("SELECT id, ticket_no, customer_name, equipment_model, issue_summary, priority, status, received_at FROM as_tickets " +
      "WHERE tenant_id = $1 AND deleted_at IS NULL AND status NOT IN ('closed','cancelled') ORDER BY priority, received_at DESC LIMIT 15", [actor.tenantId]);
    if (r.rows.length) {
      context.push('[진행 중 A/S]\n' + r.rows.map(function (x) {
        return src('A', 'as', x.issue_summary || x.ticket_no, x.ticket_no + ' · ' + x.customer_name, { asId: x.id }) + x.ticket_no + ' [' + x.priority + '] ' +
          x.customer_name + ' / ' + (x.equipment_model || '-') + ' | ' + String(x.issue_summary || '').slice(0, 80) + ' | 상태:' + x.status;
      }).join('\n'));
    }
    var c = await db.query("SELECT COALESCE(NULLIF(equipment_model,''),'(모델 없음)') AS model, customer_name, COUNT(*)::int AS n FROM as_tickets " +
      "WHERE tenant_id = $1 AND deleted_at IS NULL AND received_at >= now() - interval '90 days' GROUP BY 1, 2 HAVING COUNT(*) >= 2 ORDER BY n DESC LIMIT 10", [actor.tenantId]);
    if (c.rows.length) {
      context.push('[최근 90일 A/S 2건 이상 (장비 · 고객)]\n' + c.rows.map(function (x) { return x.model + ' · ' + x.customer_name + ': ' + x.n + '건'; }).join('\n'));
    }
  });

  // 일정 — 접근 가능한 프로젝트 일정 + 본인 개인 일정
  if (intents.indexOf('events') >= 0) await safe('events', async function () {
    var sub = pa.accessibleProjectsSubquery(req, 4);
    var r = await db.query('SELECT title, type, start_date, end_date FROM events WHERE tenant_id = $1 AND end_date >= $3 AND (' +
      "(jsonb_array_length(COALESCE(project_ids, '[]'::jsonb)) = 0 AND created_by = $2)" +
      " OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(project_ids, '[]'::jsonb)) AS _pid WHERE _pid IN (" + sub.sql + ')))' +
      ' ORDER BY start_date LIMIT 15', [actor.tenantId, actor.userId, per.today].concat(sub.params));
    if (r.rows.length) {
      context.push('[예정 일정]\n' + r.rows.map(function (x) { return x.start_date + ' ~ ' + x.end_date + ' | ' + x.type + ' | ' + x.title; }).join('\n'));
    }
  });

  var text = context.join('\n\n');
  if (text.length > 14000) text = text.slice(0, 14000) + '\n...(이하 생략)';
  return { text: text, sources: sources };
}

/** 프롬프트 — web 은 마크다운 + 근거 표시, telegram 은 짧게 · 표시 없이 */
function buildPrompt(question, ctx, actor, mode) {
  var web = mode !== 'telegram';
  var s = '당신은 "업무 관리자"라는 업무 관리 시스템의 AI 어시스턴트입니다.\n' +
    '아래 실제 데이터만 근거로 질문에 한국어로 답하세요. 오늘은 ' + pd.todayKST() + ' 입니다.\n' +
    '데이터에 없는 내용은 추측하지 말고 "해당 데이터가 없습니다"라고 답하세요. 데이터는 질문자가 볼 수 있는 범위만 들어 있습니다.\n';
  if (web) {
    s += '먼저 핵심 결론을 2~3줄로, 필요하면 그 아래 "## " 소제목과 "- " 목록으로 정리하세요. 표·코드블록은 쓰지 마세요.\n' +
      '근거가 된 데이터 행 앞의 [P1] · [M2] · [I3] · [O4] · [A5] 같은 표시를 해당 문장 끝에 그대로 붙이세요 (예: "설비 A 프로젝트가 지연 중입니다 [P1]"). 없는 표시를 만들지 마세요.\n';
  } else {
    s += '텔레그램 메시지이므로 300자 이내로 핵심만 답하세요.\n' +
      '서식 규칙: 마크다운 제목(#), 표(|), 코드블록(```)은 절대 쓰지 마세요. 강조는 **굵게**만, 목록은 "- "로 시작.\n' +
      '데이터 행 앞의 [P1] 같은 표시는 답에 쓰지 마세요.\n';
  }
  s += '\n질문자: ' + (actor.name || '사용자') + '\n\n';
  s += ctx.text ? '=== 현재 데이터 ===\n' + ctx.text + '\n=== 데이터 끝 ===\n\n' : '(관련 데이터가 없습니다)\n\n';
  return s + '질문: ' + question;
}

/** 답에서 인용된 근거 키 */
function citedKeys(answer) {
  var keys = {};
  String(answer || '').replace(CITE_RE, function (_m, g) { g.split(/\s*,\s*/).forEach(function (k) { keys[k] = true; }); return _m; });
  return keys;
}

/**
 * 웹 질의 — { answer, sources(인용된 것 먼저 · cited 표시), context, intents, provider, model, note } · 키 없으면 null
 */
async function answerWeb(question, actor) {
  var intents = analyzeQuery(question);
  var ctx = await gatherContext(intents, actor);
  var out = await aiProvider.generateText({ prompt: buildPrompt(question, ctx, actor, 'web'), tenantId: actor.tenantId, maxTokens: 4096 });
  if (!out) return null;
  var keys = citedKeys(out.text);
  var valid = {};
  ctx.sources.forEach(function (s) { valid[s.key] = true; });
  // 없는 표시(지어낸 것)는 지움
  var answer = out.text.replace(CITE_RE, function (m, g) {
    var ok = g.split(/\s*,\s*/).filter(function (k) { return valid[k]; });
    return ok.length ? '[' + ok.join(', ') + ']' : '';
  });
  var sources = ctx.sources.map(function (s) { return Object.assign({ cited: !!keys[s.key] }, s); })
    .sort(function (a, b) { return (b.cited ? 1 : 0) - (a.cited ? 1 : 0); });
  return { answer: answer, sources: sources, context: ctx.text, intents: intents, provider: out.provider, model: out.model, note: out.note };
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
  var ctx = await gatherContext(analyzeQuery(question), actor);
  var out = await aiProvider.generateText({ prompt: buildPrompt(question, ctx, actor, 'telegram'), tenantId: actor.tenantId, maxTokens: 2048 });
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
  formatForTelegram: formatForTelegram
};
