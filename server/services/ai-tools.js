/**
 * AI 조회 도구 — 통합 질의 2단계 (v13.298)
 *
 * AI 가 질문을 보고 "어떤 데이터를 어떤 조건으로 볼지" 고르면(planCalls), 서버가 아래 도구를 실행한다(runCalls).
 *   · 모두 읽기 전용 · 묻는 사람 권한 범위 안에서만 (ai.service 1단계 규칙과 같음)
 *     프로젝트·마일스톤 → lib/project-access · 이슈 → 프로젝트 가시성 + 프로젝트 없는 이슈는 본인 것
 *     업무일지 → lib/record-scope (관리자 전체 · 부서장 부서 · 그 외 본인) · 수주 · A/S → 회사 전체
 *   · 인자는 정해진 모양만 받음 (enum · 길이 · 날짜 검사) — AI 가 SQL 을 만들지 않는다
 *   · 각 행에 [P1] 같은 근거 키, 숫자 묶음은 차트(charts)로도 돌려준다
 * 도구 고르기가 실패하면 낱말 의도(analyzeQuery) 로 정한 기본 도구 묶음을 쓴다.
 */
var db = require('../config/db');
var pd = require('../lib/project-defaults');
var pa = require('../lib/project-access');
var rs = require('../lib/record-scope');

var AM = { A: 'A(CS현장)', B: 'B(수주)', D: 'D(개발)', G: 'G(공통)', M: 'M(양산)', R: 'R(제안)', S: 'S(영업지원)' };
var SCOPE_LABEL = { tenant: '회사 전체', department: '우리 부서', self: '본인 것만' };
var MAX_CALLS = 6;
var MAX_TEXT = 16000;

var PERIODS = ['this_week', 'last_week', 'this_month', 'last_month', 'last_30d', 'last_90d', 'this_year', 'custom'];
var PERIOD_LABEL = { this_week: '이번 주', last_week: '지난주', this_month: '이번 달', last_month: '지난달', last_30d: '최근 30일', last_90d: '최근 90일', this_year: '올해', custom: '지정 기간' };

/* ─── 도구 정의: args 모양 (AI 에게 보여 주는 설명 + 검사) ─── */
var TOOLS = {
  work_hours: {
    label: '업무일지 시간 집계',
    desc: '업무일지 투입 시간 합계. group_by 로 묶음 (person 사람 · abbr 업무분장 · order 수주번호 · week 주별 · month 월별 · day 일별). person/order_no/abbr 로 거를 수 있음.',
    args: { group_by: { e: ['person', 'abbr', 'order', 'week', 'month', 'day'] }, period: { e: PERIODS }, start: 'date', end: 'date', person: 'str', order_no: 'str', abbr: { e: ['A', 'B', 'D', 'G', 'M', 'R', 'S'] } }
  },
  work_search: {
    label: '업무일지 내용 찾기',
    desc: '업무일지 "업무 내용" 글에서 낱말을 찾아 날짜·사람·수주·시간·내용을 보여 줌. 무엇을 했는지 · 특정 작업/장비/고객 이력을 물을 때.',
    args: { keyword: 'str', period: { e: PERIODS }, start: 'date', end: 'date', person: 'str' }
  },
  projects: {
    label: '프로젝트 목록',
    desc: '프로젝트 목록 (상태 · 진행률 · 납기 · 담당). status: open(완료 아닌 것, 기본) · delayed(지연) · done(완료) · all. keyword 로 이름/수주번호 거르기.',
    args: { status: { e: ['open', 'delayed', 'done', 'all'] }, keyword: 'str' }
  },
  project_detail: {
    label: '프로젝트 상세',
    desc: '프로젝트 하나(이름 또는 수주번호)의 마일스톤 전체 · 미해결 이슈 · 사람별 투입 시간 · 최근 업무일지.',
    args: { project: 'str' }
  },
  milestones_due: {
    label: '마감 다가온 마일스톤',
    desc: '앞으로 days 일 안에 마감되거나 이미 마감이 지난 미완료 마일스톤 (기본 14일). overdue_only=true 면 지난 것만.',
    args: { days: { i: [1, 120] }, overdue_only: 'bool' }
  },
  issues: {
    label: '이슈 목록',
    desc: '이슈 목록 (긴급 먼저). status: open(미해결, 기본) · resolved(해결됨) · all. urgency: urgent 만. keyword · project 로 거르기.',
    args: { status: { e: ['open', 'resolved', 'all'] }, urgency: { e: ['urgent', 'normal', 'low'] }, keyword: 'str', project: 'str' }
  },
  person_overview: {
    label: '사람별 현황',
    desc: '한 사람의 담당 프로젝트 · 맡은 미해결 이슈 · 최근 8주 주별 투입 시간 · 수주별 시간.',
    args: { person: 'str' }
  },
  orders: {
    label: '수주 목록',
    desc: '수주 목록 (수주번호 · 고객 · 금액 · 담당 · 납품일). keyword 로 고객/품명/수주번호 거르기.',
    args: { keyword: 'str' }
  },
  as_tickets: {
    label: 'A/S 접수',
    desc: 'A/S 접수 건. status: open(진행 중, 기본) · all. keyword 로 고객/장비/증상 거르기. days 최근 며칠 (기본 90).',
    args: { status: { e: ['open', 'all'] }, keyword: 'str', days: { i: [1, 730] } }
  },
  as_repeats: {
    label: 'A/S 반복 장비',
    desc: '최근 days 일(기본 90) 동안 같은 장비·고객에 A/S 가 2건 이상인 것.',
    args: { days: { i: [7, 730] } }
  },
  events: {
    label: '일정',
    desc: '앞으로 days 일(기본 14) 안의 일정 (회의 · 출장 · 연차 등).',
    args: { days: { i: [1, 90] } }
  },
  weekly_report_trend: {
    label: '주간 업무 보고 분석',
    desc: '주간 업무 보고서를 주를 넘어 이어 붙인 분석 — 주별 완료율 · 새로/끝낸 일, 납기 지남 · 일정보다 뒤처짐 · 3주째 정체 · 납기 연기 · 사라진 일, 사람 · 분야 · 업체별 처리량 · 끝내는 데 걸린 주 · 기한 안 완료율. 주간 보고 · 팀 진척 · 목표 · 효율 · 누가 밀렸는지 물을 때. (관리자만)',
    args: { weeks: { i: [2, 52] }, team: 'str' }
  }
};

/* ─── 공용 ─── */
function parseArr(v) {
  if (Array.isArray(v)) return v;
  try { var a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch (_) { return []; }
}
function likePat(s) { return '%' + String(s).replace(/[\\%_]/g, function (c) { return '\\' + c; }) + '%'; }
function r1(n) { return Math.round(parseFloat(n || 0) * 10) / 10; }
function ymd(d) { return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
function isoOf(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

/** 기간 → { start, end (YYYYMMDD), label } — 한국 날짜 기준 */
function resolvePeriod(period, start, end, today) {
  today = today || pd.todayKST();
  var now = new Date(today + 'T00:00:00');
  if (period === 'custom' || (!period && (start || end))) {
    var s = /^\d{4}-\d{2}-\d{2}$/.test(start || '') ? start.replace(/-/g, '') : ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    var e = /^\d{4}-\d{2}-\d{2}$/.test(end || '') ? end.replace(/-/g, '') : ymd(now);
    if (s > e) { var t = s; s = e; e = t; }
    return { start: s, end: e, label: s + '~' + e };
  }
  var day = now.getDay();
  var ws = new Date(now); ws.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
  var we = new Date(ws); we.setDate(ws.getDate() + 6);
  var p;
  switch (period) {
    case 'last_week': { var ls = new Date(ws); ls.setDate(ls.getDate() - 7); var le = new Date(ws); le.setDate(le.getDate() - 1); p = [ls, le]; break; }
    case 'this_month': p = [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0)]; break;
    case 'last_month': p = [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0)]; break;
    case 'last_30d': { var a = new Date(now); a.setDate(a.getDate() - 29); p = [a, now]; break; }
    case 'last_90d': { var b = new Date(now); b.setDate(b.getDate() - 89); p = [b, now]; break; }
    case 'this_year': p = [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 11, 31)]; break;
    default: period = 'this_week'; p = [ws, we];
  }
  return { start: ymd(p[0]), end: ymd(p[1]), label: PERIOD_LABEL[period] };
}

/** AI 가 준 인자 → 정해진 모양만 남김 */
function cleanArgs(tool, args) {
  var spec = TOOLS[tool] && TOOLS[tool].args, out = {};
  if (!spec || !args || typeof args !== 'object') return out;
  Object.keys(spec).forEach(function (k) {
    var v = args[k], s = spec[k];
    if (v == null || v === '') return;
    if (s === 'str') { v = String(v).trim().slice(0, 60); if (v) out[k] = v; }
    else if (s === 'date') { v = String(v).trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = v; else if (/^\d{8}$/.test(v)) out[k] = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6); }
    else if (s === 'bool') out[k] = v === true || v === 'true';
    else if (s.e) { if (s.e.indexOf(v) >= 0) out[k] = v; }
    else if (s.i) { var n = parseInt(v, 10); if (!isNaN(n)) out[k] = Math.min(s.i[1], Math.max(s.i[0], n)); }
  });
  return out;
}

/** 실행 바구니 — 근거 키 · 글 묶음 · 차트 */
function makeCtx(actor) {
  var c = {
    actor: actor,
    req: { user: { sub: actor.userId, role: actor.role || 'member', departmentId: actor.departmentId || null }, tenant: { id: actor.tenantId } },
    today: pd.todayKST(),
    sections: [], sources: [], charts: [], ran: [],
    seq: { P: 0, M: 0, I: 0, O: 0, A: 0 },
    seen: {}
  };
  /** 근거 키 — 같은 대상은 같은 키 */
  c.src = function (prefix, type, id, title, sub, nav) {
    var sk = type + ':' + id;
    if (c.seen[sk]) return '[' + c.seen[sk] + '] ';
    var key = prefix + (++c.seq[prefix]);
    c.seen[sk] = key;
    c.sources.push({ key: key, type: type, id: id, title: title || '', sub: sub || '', nav: nav });
    return '[' + key + '] ';
  };
  c.add = function (head, lines) { if (lines && lines.length) c.sections.push('[' + head + ']\n' + lines.join('\n')); };
  c.chart = function (title, rows, unit) {
    rows = (rows || []).filter(function (x) { return x && x.value > 0; });
    if (rows.length >= 2 && c.charts.length < 3) c.charts.push({ title: title, unit: unit || 'h', rows: rows.slice(0, 20) });
  };
  return c;
}

/* ─── 도구 실행 ─── */
var RUN = {};

RUN.work_hours = async function (c, a) {
  var sc = rs.recordScope(c.req);
  var per = resolvePeriod(a.period, a.start, a.end, c.today);
  var params = sc.params.concat([per.start, per.end]);
  var w = sc.where + ' AND date >= $' + sc.nextIdx + ' AND date <= $' + (sc.nextIdx + 1);
  var filt = [];
  if (a.person) { params.push(likePat(a.person)); w += ' AND name ILIKE $' + params.length; filt.push(a.person); }
  if (a.order_no) { params.push(likePat(a.order_no)); w += ' AND order_no ILIKE $' + params.length; filt.push(a.order_no); }
  if (a.abbr) { params.push(a.abbr); w += ' AND abbr = $' + params.length; filt.push(AM[a.abbr]); }
  var g = a.group_by || 'person';
  var head = per.label + ' ' + per.start + '~' + per.end + ' · 범위: ' + SCOPE_LABEL[sc.scope] + (filt.length ? ' · 조건: ' + filt.join(', ') : '');
  if (g === 'person') {
    var r = await db.query('SELECT name, COALESCE(SUM(hours),0) AS hours, COUNT(DISTINCT date) AS days, COUNT(DISTINCT order_no) AS orders FROM work_records WHERE ' + w +
      ' GROUP BY name ORDER BY hours DESC LIMIT 25', params);
    c.add('인원별 투입시간 · ' + head, r.rows.map(function (x) {
      var avg = x.days > 0 ? r1(parseFloat(x.hours) / x.days) : 0;
      return x.name + ': ' + r1(x.hours) + 'h (' + x.days + '일, 일평균 ' + avg + 'h, 수주 ' + x.orders + '건)';
    }));
    c.chart('사람별 시간 · ' + per.label, r.rows.map(function (x) { return { label: x.name, value: r1(x.hours) }; }));
    return r.rows.length;
  }
  var col, order = 'hours DESC', extra = '';
  if (g === 'abbr') col = 'abbr';
  else if (g === 'order') { col = 'order_no'; extra = " AND order_no IS NOT NULL AND order_no <> ''"; }
  else if (g === 'week') { col = "to_char(to_date(substr(date,1,8),'YYYYMMDD'),'IYYY-\"W\"IW')"; order = 'label'; extra = " AND date ~ '^[0-9]{8}'"; }
  else if (g === 'month') { col = "substr(date,1,4) || '-' || substr(date,5,2)"; order = 'label'; extra = " AND date ~ '^[0-9]{8}'"; }
  else { col = 'substr(date,1,8)'; order = 'label'; }
  var q = await db.query('SELECT ' + col + ' AS label, COALESCE(SUM(hours),0) AS hours, COUNT(DISTINCT name) AS people FROM work_records WHERE ' + w + extra +
    ' GROUP BY 1 ORDER BY ' + order + ' LIMIT 40', params);
  var GL = { abbr: '업무분장별', order: '수주번호별', week: '주별', month: '월별', day: '일별' };
  c.add(GL[g] + ' 투입시간 · ' + head, q.rows.map(function (x) {
    return (g === 'abbr' ? (AM[x.label] || x.label) : x.label) + ': ' + r1(x.hours) + 'h (' + x.people + '명)';
  }));
  c.chart(GL[g] + ' 시간 · ' + per.label, q.rows.map(function (x) { return { label: g === 'abbr' ? (AM[x.label] || x.label) : String(x.label), value: r1(x.hours) }; }));
  return q.rows.length;
};

RUN.work_search = async function (c, a) {
  if (!a.keyword) return 0;
  var sc = rs.recordScope(c.req);
  var per = resolvePeriod(a.period || 'last_90d', a.start, a.end, c.today);
  var params = sc.params.concat([per.start, per.end, likePat(a.keyword)]);
  var w = sc.where + ' AND date >= $' + sc.nextIdx + ' AND date <= $' + (sc.nextIdx + 1) +
    ' AND (content ILIKE $' + (sc.nextIdx + 2) + ' OR order_no ILIKE $' + (sc.nextIdx + 2) + ')';
  if (a.person) { params.push(likePat(a.person)); w += ' AND name ILIKE $' + params.length; }
  var r = await db.query('SELECT date, name, order_no, hours, content FROM work_records WHERE ' + w + ' ORDER BY date DESC LIMIT 25', params);
  var t = await db.query('SELECT COUNT(*)::int AS n, COALESCE(SUM(hours),0) AS hours FROM work_records WHERE ' + w, params);
  var tot = t.rows[0] || { n: 0, hours: 0 };
  c.add('업무일지 "' + a.keyword + '" 찾기 · ' + per.label + ' ' + per.start + '~' + per.end + ' · 범위: ' + SCOPE_LABEL[sc.scope] + ' · 모두 ' + tot.n + '건 ' + r1(tot.hours) + 'h' + (tot.n > 25 ? ' (최근 25건만)' : ''),
    r.rows.map(function (x) {
      return x.date + ' ' + x.name + ' | ' + (x.order_no || '-') + ' | ' + r1(x.hours) + 'h | ' + String(x.content || '').replace(/\s+/g, ' ').slice(0, 120);
    }));
  return r.rows.length;
};

function projLine(c, x) {
  return c.src('P', 'project', x.id, x.name, x.order_no, { projectId: x.id }) + (x.order_no ? x.order_no + ' ' : '') + x.name +
    ' | 상태:' + x.status + ' | 진행률:' + (x.progress || 0) + '% | 기간:' + (x.start_date || '-') + '~' + (x.end_date || '-') + ' | 담당:' + parseArr(x.assignees).join(',');
}

RUN.projects = async function (c, a) {
  var v = pa.visibleProjectsSql(c.req, 'p', 3);
  var st = pd.computeStatusSql('p', '$1');
  var params = [c.today, c.actor.tenantId].concat(v.params);
  var w = 'WHERE p.tenant_id = $2 AND ' + v.sql;
  var s = a.status || 'open';
  if (s === 'open') w += " AND p.status NOT IN ('done')";
  else if (s === 'delayed') w += ' AND ' + st + " = 'delayed'";
  else if (s === 'done') w += " AND p.status = 'done'";
  if (a.keyword) { params.push(likePat(a.keyword)); w += ' AND (p.name ILIKE $' + params.length + ' OR p.order_no ILIKE $' + params.length + ')'; }
  var r = await db.query('SELECT p.id, p.name, p.order_no, ' + st + ' AS status, p.progress, p.start_date, p.end_date, p.assignees FROM projects p ' + w +
    ' ORDER BY CASE ' + st + " WHEN 'delayed' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, p.end_date NULLS LAST LIMIT 25", params);
  var SL = { open: '진행 중 프로젝트', delayed: '지연 프로젝트', done: '완료 프로젝트', all: '프로젝트' };
  c.add(SL[s] + (a.keyword ? ' · "' + a.keyword + '"' : ''), r.rows.map(function (x) { return projLine(c, x); }));
  return r.rows.length;
};

/** 이름·수주번호로 볼 수 있는 프로젝트 찾기 (정확히 같은 것 먼저) */
async function findProjects(c, text, limit) {
  var v = pa.visibleProjectsSql(c.req, 'p', 4);
  var st = pd.computeStatusSql('p', '$1');
  var r = await db.query('SELECT p.id, p.name, p.order_no, ' + st + ' AS status, p.progress, p.start_date, p.end_date, p.assignees FROM projects p ' +
    'WHERE p.tenant_id = $2 AND ' + v.sql + ' AND (p.name ILIKE $3 OR p.order_no ILIKE $3) ' +
    'ORDER BY (p.name = $' + (4 + v.params.length) + ' OR p.order_no = $' + (4 + v.params.length) + ') DESC, p.updated_at DESC NULLS LAST LIMIT ' + (limit || 2),
    [c.today, c.actor.tenantId, likePat(text)].concat(v.params).concat([text]));
  return r.rows;
}

RUN.project_detail = async function (c, a) {
  if (!a.project) return 0;
  var ps = await findProjects(c, a.project, 2);
  if (!ps.length) { c.add('프로젝트 "' + a.project + '"', ['(볼 수 있는 프로젝트 중 해당 이름/수주번호가 없습니다)']); return 0; }
  for (var i = 0; i < ps.length; i++) {
    var p = ps[i], lines = [projLine(c, p)];
    var ms = await db.query("SELECT id, name, start_date, end_date, progress, status FROM milestones WHERE tenant_id = $1 AND project_id = $2 ORDER BY end_date NULLS LAST, sort_order NULLS LAST LIMIT 25", [c.actor.tenantId, p.id]);
    ms.rows.forEach(function (m) {
      var late = m.status !== 'done' && m.end_date && m.end_date < c.today ? ' ⚠️마감 지남' : '';
      lines.push('  ' + c.src('M', 'milestone', m.id, m.name, p.name, { projectId: p.id }) + '마일스톤 ' + m.name + ' | ' + (m.start_date || '-') + '~' + (m.end_date || '-') + late + ' | 진행률:' + (m.progress || 0) + '% | 상태:' + (m.status || '-'));
    });
    var iss = await db.query("SELECT id, title, urgency, status, assignees, due_date FROM issues WHERE tenant_id = $1 AND project_id = $2 AND status NOT IN ('resolved','closed') ORDER BY CASE urgency WHEN 'urgent' THEN 0 ELSE 1 END, created_at DESC LIMIT 10", [c.actor.tenantId, p.id]);
    iss.rows.forEach(function (x) {
      lines.push('  ' + c.src('I', 'issue', x.id, x.title, p.name, { issueId: x.id }) + '이슈 [' + x.urgency + '] ' + x.title + ' | 상태:' + x.status + ' | 담당:' + parseArr(x.assignees).join(',') + (x.due_date ? ' | 기한:' + x.due_date : ''));
    });
    if (p.order_no) {
      var sc = rs.recordScope(c.req);
      var wr = await db.query('SELECT name, COALESCE(SUM(hours),0) AS hours, MAX(date) AS last FROM work_records WHERE ' + sc.where + ' AND order_no = $' + sc.nextIdx +
        ' GROUP BY name ORDER BY hours DESC LIMIT 10', sc.params.concat([p.order_no]));
      if (wr.rows.length) lines.push('  투입 시간(' + SCOPE_LABEL[sc.scope] + '): ' + wr.rows.map(function (x) { return x.name + ' ' + r1(x.hours) + 'h(마지막 ' + x.last + ')'; }).join(', '));
      var rc = await db.query('SELECT date, name, hours, content FROM work_records WHERE ' + sc.where + ' AND order_no = $' + sc.nextIdx + ' ORDER BY date DESC LIMIT 6', sc.params.concat([p.order_no]));
      rc.rows.forEach(function (x) { lines.push('  최근 업무 ' + x.date + ' ' + x.name + ' ' + r1(x.hours) + 'h: ' + String(x.content || '').replace(/\s+/g, ' ').slice(0, 100)); });
    }
    c.add('프로젝트 상세 · ' + p.name, lines);
  }
  return ps.length;
};

RUN.milestones_due = async function (c, a) {
  var v = pa.visibleProjectsSql(c.req, 'p', 4);
  var days = a.days || 14;
  var until = new Date(c.today + 'T00:00:00'); until.setDate(until.getDate() + days);
  var untilStr = a.overdue_only ? c.today : isoOf(until);
  var r = await db.query('SELECT m.id, m.name, m.end_date, m.progress, m.project_id, p.name AS proj_name FROM milestones m ' +
    'JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id ' +
    "WHERE m.tenant_id = $1 AND " + v.sql + " AND COALESCE(m.status,'') <> 'done' AND p.status NOT IN ('done','hold') " +
    "AND m.end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND m.end_date " + (a.overdue_only ? '<' : '<=') + " $2 AND $3::text IS NOT NULL ORDER BY m.end_date LIMIT 25",
    [c.actor.tenantId, untilStr, c.today].concat(v.params));
  c.add((a.overdue_only ? '마감 지난 마일스톤' : days + '일 안 마감 · 마감 지난 마일스톤') + ' (오늘 ' + c.today + ')', r.rows.map(function (x) {
    var late = x.end_date < c.today ? ' ⚠️마감 지남' : '';
    return c.src('M', 'milestone', x.id, x.name, x.proj_name, { projectId: x.project_id }) + x.proj_name + ' › ' + x.name +
      ' | 마감:' + x.end_date + late + ' | 진행률:' + (x.progress || 0) + '%';
  }));
  return r.rows.length;
};

RUN.issues = async function (c, a) {
  var sub = pa.accessibleProjectsSubquery(c.req, 3);
  var params = [c.actor.tenantId, c.actor.userId].concat(sub.params);
  var w = 'WHERE tenant_id = $1 AND ((project_id IS NULL AND created_by = $2) OR project_id IN (' + sub.sql + '))';
  var s = a.status || 'open';
  if (s === 'open') w += " AND status NOT IN ('resolved','closed')";
  else if (s === 'resolved') w += " AND status IN ('resolved','closed')";
  if (a.urgency) { params.push(a.urgency); w += ' AND urgency = $' + params.length; }
  if (a.keyword) { params.push(likePat(a.keyword)); w += ' AND (title ILIKE $' + params.length + ' OR COALESCE(description,\'\') ILIKE $' + params.length + ')'; }
  if (a.project) {
    var ps = await findProjects(c, a.project, 3);
    if (!ps.length) { c.add('이슈 · 프로젝트 "' + a.project + '"', ['(볼 수 있는 프로젝트 중 해당 이름이 없습니다)']); return 0; }
    params.push(ps.map(function (p) { return p.id; })); w += ' AND project_id = ANY($' + params.length + ')';
  }
  var r = await db.query('SELECT id, title, urgency, status, assignees, due_date, order_no, created_at FROM issues ' + w +
    " ORDER BY CASE urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at DESC LIMIT 25", params);
  var SL = { open: '미해결 이슈', resolved: '해결된 이슈', all: '이슈' };
  c.add(SL[s] + (a.urgency ? ' · ' + a.urgency : '') + (a.keyword ? ' · "' + a.keyword + '"' : ''), r.rows.map(function (x) {
    var age = x.created_at ? Math.floor((Date.now() - new Date(x.created_at).getTime()) / 86400000) : null;
    return c.src('I', 'issue', x.id, x.title, x.order_no, { issueId: x.id }) + '[' + x.urgency + '] ' + x.title + ' | 상태:' + x.status +
      ' | 담당:' + parseArr(x.assignees).join(',') + (x.due_date ? ' | 기한:' + x.due_date : '') + (age != null ? ' | 등록 ' + age + '일 전' : '');
  }));
  return r.rows.length;
};

RUN.person_overview = async function (c, a) {
  if (!a.person) return 0;
  var pat = likePat(a.person), lines = [];
  var v = pa.visibleProjectsSql(c.req, 'p', 4);
  var st = pd.computeStatusSql('p', '$1');
  var pr = await db.query('SELECT p.id, p.name, p.order_no, ' + st + ' AS status, p.progress, p.start_date, p.end_date, p.assignees FROM projects p ' +
    "WHERE p.tenant_id = $2 AND " + v.sql + " AND p.status NOT IN ('done') AND p.assignees::text ILIKE $3 ORDER BY p.end_date NULLS LAST LIMIT 15",
    [c.today, c.actor.tenantId, pat].concat(v.params));
  pr.rows.forEach(function (x) { lines.push('담당 프로젝트 ' + projLine(c, x)); });
  var sub = pa.accessibleProjectsSubquery(c.req, 4);
  var is = await db.query("SELECT id, title, urgency, status, due_date, order_no FROM issues WHERE tenant_id = $1 AND status NOT IN ('resolved','closed') AND assignees::text ILIKE $3 " +
    'AND ((project_id IS NULL AND created_by = $2) OR project_id IN (' + sub.sql + ')) ORDER BY created_at DESC LIMIT 15',
    [c.actor.tenantId, c.actor.userId, pat].concat(sub.params));
  is.rows.forEach(function (x) { lines.push('맡은 이슈 ' + c.src('I', 'issue', x.id, x.title, x.order_no, { issueId: x.id }) + '[' + x.urgency + '] ' + x.title + ' | 상태:' + x.status + (x.due_date ? ' | 기한:' + x.due_date : '')); });
  var sc = rs.recordScope(c.req);
  var from = new Date(c.today + 'T00:00:00'); from.setDate(from.getDate() - 55);
  var wk = await db.query("SELECT to_char(to_date(substr(date,1,8),'YYYYMMDD'),'IYYY-\"W\"IW') AS label, COALESCE(SUM(hours),0) AS hours FROM work_records WHERE " + sc.where +
    ' AND name ILIKE $' + sc.nextIdx + ' AND date >= $' + (sc.nextIdx + 1) + " AND date ~ '^[0-9]{8}' GROUP BY 1 ORDER BY 1", sc.params.concat([pat, ymd(from)]));
  if (wk.rows.length) {
    lines.push('최근 8주 주별 시간(' + SCOPE_LABEL[sc.scope] + '): ' + wk.rows.map(function (x) { return x.label + ' ' + r1(x.hours) + 'h'; }).join(', '));
    c.chart(a.person + ' · 주별 시간', wk.rows.map(function (x) { return { label: x.label, value: r1(x.hours) }; }));
  }
  var od = await db.query('SELECT order_no, COALESCE(SUM(hours),0) AS hours FROM work_records WHERE ' + sc.where + ' AND name ILIKE $' + sc.nextIdx + ' AND date >= $' + (sc.nextIdx + 1) +
    " AND order_no IS NOT NULL AND order_no <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 8", sc.params.concat([pat, ymd(from)]));
  if (od.rows.length) lines.push('최근 8주 수주별 시간: ' + od.rows.map(function (x) { return x.order_no + ' ' + r1(x.hours) + 'h'; }).join(', '));
  if (!lines.length) lines.push('(볼 수 있는 범위에 "' + a.person + '" 관련 데이터가 없습니다)');
  c.add('사람별 현황 · ' + a.person, lines);
  return lines.length;
};

RUN.orders = async function (c, a) {
  var params = [c.actor.tenantId], w = 'WHERE tenant_id = $1';
  if (a.keyword) { params.push(likePat(a.keyword)); w += ' AND (order_no ILIKE $2 OR client ILIKE $2 OR name ILIKE $2 OR manager ILIKE $2)'; }
  var r = await db.query('SELECT order_no, client, name, amount, manager, delivery FROM orders ' + w + ' ORDER BY delivery DESC NULLS LAST LIMIT 20', params);
  c.add('수주 목록' + (a.keyword ? ' · "' + a.keyword + '"' : ''), r.rows.map(function (x) {
    return c.src('O', 'order', x.order_no, x.name || x.order_no, x.client, { orderNo: x.order_no }) + (x.order_no || '-') + ' | ' + (x.client || '-') + ' | ' + (x.name || '-') +
      ' | 금액:' + (x.amount || '-') + ' | 담당:' + (x.manager || '-') + ' | 납품:' + (x.delivery || '-');
  }));
  return r.rows.length;
};

RUN.as_tickets = async function (c, a) {
  var params = [c.actor.tenantId, a.days || 90];
  var w = "WHERE tenant_id = $1 AND deleted_at IS NULL AND received_at >= now() - ($2::int * interval '1 day')";
  if ((a.status || 'open') === 'open') w += " AND status NOT IN ('closed','cancelled')";
  if (a.keyword) { params.push(likePat(a.keyword)); w += ' AND (customer_name ILIKE $3 OR equipment_model ILIKE $3 OR issue_summary ILIKE $3 OR ticket_no ILIKE $3)'; }
  var r = await db.query('SELECT id, ticket_no, customer_name, equipment_model, issue_summary, priority, status, received_at FROM as_tickets ' + w +
    ' ORDER BY priority, received_at DESC LIMIT 20', params);
  c.add(((a.status || 'open') === 'open' ? '진행 중 A/S' : 'A/S 접수') + ' · 최근 ' + (a.days || 90) + '일' + (a.keyword ? ' · "' + a.keyword + '"' : ''), r.rows.map(function (x) {
    return c.src('A', 'as', x.id, x.issue_summary || x.ticket_no, x.ticket_no + ' · ' + x.customer_name, { asId: x.id }) + x.ticket_no + ' [' + x.priority + '] ' +
      x.customer_name + ' / ' + (x.equipment_model || '-') + ' | ' + String(x.issue_summary || '').slice(0, 80) + ' | 상태:' + x.status +
      ' | 접수:' + (x.received_at ? isoOf(new Date(x.received_at)) : '-');
  }));
  return r.rows.length;
};

RUN.as_repeats = async function (c, a) {
  var days = a.days || 90;
  var r = await db.query("SELECT COALESCE(NULLIF(equipment_model,''),'(모델 없음)') AS model, customer_name, COUNT(*)::int AS n FROM as_tickets " +
    "WHERE tenant_id = $1 AND deleted_at IS NULL AND received_at >= now() - ($2::int * interval '1 day') GROUP BY 1, 2 HAVING COUNT(*) >= 2 ORDER BY n DESC LIMIT 15", [c.actor.tenantId, days]);
  c.add('최근 ' + days + '일 A/S 2건 이상 (장비 · 고객)', r.rows.map(function (x) { return x.model + ' · ' + x.customer_name + ': ' + x.n + '건'; }));
  c.chart('A/S 반복 · 최근 ' + days + '일', r.rows.map(function (x) { return { label: x.model + ' · ' + x.customer_name, value: x.n }; }), '건');
  return r.rows.length;
};

RUN.events = async function (c, a) {
  var sub = pa.accessibleProjectsSubquery(c.req, 5);
  var until = new Date(c.today + 'T00:00:00'); until.setDate(until.getDate() + (a.days || 14));
  var r = await db.query('SELECT title, type, start_date, end_date FROM events WHERE tenant_id = $1 AND end_date >= $3 AND start_date <= $4 AND (' +
    "(jsonb_array_length(COALESCE(project_ids, '[]'::jsonb)) = 0 AND created_by = $2)" +
    " OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(project_ids, '[]'::jsonb)) AS _pid WHERE _pid IN (" + sub.sql + ')))' +
    ' ORDER BY start_date LIMIT 20', [c.actor.tenantId, c.actor.userId, c.today, isoOf(until)].concat(sub.params));
  c.add('예정 일정 · ' + (a.days || 14) + '일 안', r.rows.map(function (x) { return x.start_date + ' ~ ' + x.end_date + ' | ' + x.type + ' | ' + x.title; }));
  return r.rows.length;
};

RUN.weekly_report_trend = async function (c, a) {
  if (c.actor.role !== 'admin') { c.add('주간 업무 보고 분석', ['(주간 업무 보고는 관리자만 볼 수 있어 조회하지 않았습니다)']); return 0; }
  var wi = require('../lib/weekly-insights');
  var rows = await wi.load(db, c.actor.tenantId, { weeks: a.weeks || 12, team: a.team || '' });
  var out = wi.compute(rows, { links: await wi.loadLinks(db, c.actor.tenantId), goals: await wi.loadGoals(db, c.actor.tenantId, a.team || '') });   // 손으로 묶은 것 · 목표도 (v13.311)
  if (!out.weekly.length) { c.add('주간 업무 보고 분석', ['(이 기간에 저장된 주간 보고가 없음)']); return 0; }
  c.add('주간 업무 보고 분석 · 최근 ' + (a.weeks || 12) + '주' + (a.team ? ' · ' + a.team : ''), wi.toText(out).split('\n').concat(out.findings.map(function (f) { return '결론: ' + f.text; })));
  c.chart('주별 완료율', out.weekly.map(function (w) { return { label: w.week.slice(5), value: w.completionRate }; }), '%');
  return out.weekly.length;
};

/* ─── 실행 ─── */
/**
 * @param {Array<{tool, args}>} calls
 * @param {{ userId, role, departmentId, tenantId, name }} actor
 * @returns {Promise<{ text, sources, charts, ran: Array<{tool,label,args,rows}> }>}
 */
async function runCalls(calls, actor) {
  if (!actor || !actor.tenantId || !actor.userId) return { text: '', sources: [], charts: [], ran: [] };
  var c = makeCtx(actor), done = {};
  var list = (calls || []).filter(function (x) { return x && RUN[x.tool]; }).slice(0, MAX_CALLS);
  for (var i = 0; i < list.length; i++) {
    var call = list[i], args = cleanArgs(call.tool, call.args);
    var key = call.tool + JSON.stringify(args);
    if (done[key]) continue;
    done[key] = true;
    var rows = 0;
    try { rows = await RUN[call.tool](c, args); } catch (e) { console.error('[AI] 도구 실패 (' + call.tool + '):', e.message); rows = -1; }
    c.ran.push({ tool: call.tool, label: TOOLS[call.tool].label, args: args, rows: rows });
  }
  var text = c.sections.join('\n\n');
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '\n...(이하 생략)';
  return { text: text, sources: c.sources, charts: c.charts, ran: c.ran };
}

/** 낱말 의도 → 기본 도구 묶음 (도구 고르기 실패 · 끔 상태에서 사용) */
function callsForIntents(intents) {
  var has = function (k) { return intents.indexOf(k) >= 0 || intents.indexOf('general') >= 0; };
  var period = intents.indexOf('last_month') >= 0 ? 'last_month' : intents.indexOf('last_week') >= 0 ? 'last_week' : intents.indexOf('this_month') >= 0 ? 'this_month' : 'this_week';
  var calls = [];
  if (has('people') || has('stats')) {
    calls.push({ tool: 'work_hours', args: { group_by: 'person', period: period } });
    calls.push({ tool: 'work_hours', args: { group_by: 'abbr', period: period } });
    calls.push({ tool: 'work_hours', args: { group_by: 'order', period: period } });
  }
  if (has('projects')) calls.push({ tool: 'projects', args: { status: 'open' } });
  if (has('milestones') || has('projects')) calls.push({ tool: 'milestones_due', args: { days: 14 } });
  if (has('issues')) calls.push({ tool: 'issues', args: { status: 'open' } });
  if (intents.indexOf('orders') >= 0) calls.push({ tool: 'orders', args: {} });
  if (intents.indexOf('as') >= 0) { calls.push({ tool: 'as_tickets', args: { status: 'open' } }); calls.push({ tool: 'as_repeats', args: {} }); }
  if (intents.indexOf('events') >= 0) calls.push({ tool: 'events', args: { days: 14 } });
  if (intents.indexOf('weekly') >= 0) calls.unshift({ tool: 'weekly_report_trend', args: { weeks: 8 } });   // v13.310
  return calls.slice(0, 8);
}

/** AI 에게 보여 줄 도구 설명 */
function catalog() {
  return Object.keys(TOOLS).map(function (k) {
    var t = TOOLS[k];
    var args = Object.keys(t.args).map(function (a) {
      var s = t.args[a];
      return a + (s === 'str' ? ':글' : s === 'date' ? ':YYYY-MM-DD' : s === 'bool' ? ':true/false' : s.e ? ':' + s.e.join('|') : ':' + s.i[0] + '~' + s.i[1]);
    }).join(', ');
    return '- ' + k + '(' + args + ') — ' + t.desc;
  }).join('\n');
}

/** 도구 고르기 프롬프트 */
function planPrompt(question, actor, history) {
  var s = '당신은 업무 관리 시스템에서 질문에 답하려면 어떤 데이터를 조회해야 하는지 정하는 계획 담당입니다.\n' +
    '오늘은 ' + pd.todayKST() + ' 이고, 질문자는 ' + (actor.name || '사용자') + ' 입니다. 질문자가 "나/내"라고 하면 person 에 "' + (actor.name || '') + '" 을 넣으세요.\n' +
    '아래 도구 중 필요한 것을 1~' + MAX_CALLS + '개 고르고 인자를 정하세요. 같은 도구를 다른 인자로 여러 번 써도 됩니다.\n' +
    '기간은 period 로 (지정 날짜면 period=custom + start/end). 비교 질문이면 두 기간을 각각 조회하세요.\n' +
    '반드시 JSON 만 출력: {"calls":[{"tool":"도구이름","args":{...}}]}\n\n' +
    '도구:\n' + catalog() + '\n';
  if (history && history.length) {
    s += '\n이전 대화 (이어지는 질문이면 참고):\n' + history.map(function (h) { return 'Q: ' + h.q + '\nA: ' + h.a.slice(0, 300); }).join('\n') + '\n';
  }
  return s + '\n질문: ' + question;
}

/** AI 답(JSON 글) → calls (검사된 것만) · 실패하면 null */
function parsePlan(text) {
  if (!text) return null;
  var t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  // 앞뒤에 글이 붙어 와도 읽게 — 배열([..])이 먼저 나오면 배열, 아니면 객체({..})
  var ia = t.indexOf('['), io = t.indexOf('{');
  var arrFirst = ia >= 0 && (io < 0 || ia < io);
  var i = arrFirst ? ia : io, j = t.lastIndexOf(arrFirst ? ']' : '}');
  if (i < 0 || j <= i) return null;
  var obj;
  try { obj = JSON.parse(t.slice(i, j + 1)); } catch (_) { return null; }
  var arr = Array.isArray(obj) ? obj : obj && Array.isArray(obj.calls) ? obj.calls : null;
  if (!arr) return null;
  var calls = arr.filter(function (x) { return x && typeof x.tool === 'string' && RUN[x.tool]; })
    .map(function (x) { return { tool: x.tool, args: cleanArgs(x.tool, x.args) }; })
    .slice(0, MAX_CALLS);
  return calls.length ? calls : null;
}

module.exports = {
  TOOLS: TOOLS,
  runCalls: runCalls,
  callsForIntents: callsForIntents,
  planPrompt: planPrompt,
  parsePlan: parsePlan,
  cleanArgs: cleanArgs,
  resolvePeriod: resolvePeriod,
  catalog: catalog,
  likePat: likePat,
  makeCtx: makeCtx
};
