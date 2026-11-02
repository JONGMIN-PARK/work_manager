/**
 * 💡 자동 인사이트 — 통합 질의 3단계 (v13.299)
 *
 * AI 를 부르지 않고 규칙으로 "지금 볼 만한 것"을 카드로 뽑는다 (비용 0 · 빠름).
 *   지연 프로젝트 · 마감 지난 마일스톤 · 7일 안 마감인데 진행률 낮은 마일스톤 · 긴급 이슈 · 오래된 이슈 ·
 *   지난주 과부하 · 2주째 기록 없는 진행 중 프로젝트 · 오래 걸리는 A/S · A/S 반복 장비
 * 묻는 사람 권한 범위 안에서만 (ai-tools 와 같은 규칙). 카드마다 "AI 에게 더 묻기" 질문(ask)을 붙인다.
 * 쓰는 곳: GET /api/ai/insights (✨ AI 창 첫 화면) · 월요일 텔레그램 브리핑(notification/jobs.sendAiInsightBrief)
 */
var db = require('../config/db');
var pd = require('../lib/project-defaults');
var pa = require('../lib/project-access');
var rs = require('../lib/record-scope');

var OVERLOAD_H = 52;   // 지난주 이 시간 넘으면 과부하

function ymd(d) { return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
function isoOf(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function addDays(iso, n) { var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d; }
function r1(n) { return Math.round(parseFloat(n || 0) * 10) / 10; }

/**
 * @param {{ userId, role, departmentId, tenantId, name }} actor
 * @returns {Promise<Array<{ id, level: 'risk'|'warn'|'info', icon, title, detail, items: Array<{label, sub, nav}>, ask }>>}
 */
async function computeInsights(actor) {
  if (!actor || !actor.tenantId || !actor.userId) return [];
  var req = { user: { sub: actor.userId, role: actor.role || 'member', departmentId: actor.departmentId || null }, tenant: { id: actor.tenantId } };
  var today = pd.todayKST();
  var cards = [];
  async function safe(label, fn) {
    try { await fn(); } catch (e) { console.error('[AI 인사이트] ' + label + ' 실패:', e.message); }
  }

  // 1) 지연 프로젝트 (종료일 지남 · 완료/보류 아님)
  await safe('delayed', async function () {
    var v = pa.visibleProjectsSql(req, 'p', 3);
    var st = pd.computeStatusSql('p', '$1');
    var r = await db.query('SELECT p.id, p.name, p.order_no, p.end_date, p.progress FROM projects p WHERE p.tenant_id = $2 AND ' + v.sql +
      ' AND ' + st + " = 'delayed' ORDER BY p.end_date NULLS LAST", [today, actor.tenantId].concat(v.params));
    if (!r.rows.length) return;
    cards.push({
      id: 'delayed', level: 'risk', icon: '🔴', title: '지연 프로젝트 ' + r.rows.length + '건',
      detail: '종료일이 지났는데 끝나지 않았습니다.',
      items: r.rows.slice(0, 5).map(function (x) { return { label: x.name, sub: '종료 ' + (x.end_date || '-') + ' · ' + (x.progress || 0) + '%', nav: { projectId: x.id } }; }),
      ask: '지연된 프로젝트들의 현재 상황과 남은 마일스톤, 대응 방안을 정리해줘'
    });
  });

  // 2) 마감 지난 마일스톤 · 7일 안 마감인데 진행률 50% 미만
  await safe('milestones', async function () {
    var v = pa.visibleProjectsSql(req, 'p', 3);
    var r = await db.query('SELECT m.id, m.name, m.end_date, m.progress, m.project_id, p.name AS proj_name FROM milestones m ' +
      'JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id ' +
      "WHERE m.tenant_id = $1 AND " + v.sql + " AND COALESCE(m.status,'') <> 'done' AND p.status NOT IN ('done','hold') " +
      "AND m.end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND m.end_date <= $2 ORDER BY m.end_date",
      [actor.tenantId, isoOf(addDays(today, 7))].concat(v.params));
    var over = r.rows.filter(function (x) { return x.end_date < today; });
    var soon = r.rows.filter(function (x) { return x.end_date >= today && (x.progress || 0) < 50; });
    var item = function (x) { return { label: x.proj_name + ' › ' + x.name, sub: '마감 ' + x.end_date + ' · ' + (x.progress || 0) + '%', nav: { projectId: x.project_id } }; };
    if (over.length) cards.push({
      id: 'ms-overdue', level: 'risk', icon: '⏰', title: '마감 지난 마일스톤 ' + over.length + '건',
      detail: '마감일이 지났는데 완료되지 않았습니다.', items: over.slice(0, 5).map(item),
      ask: '마감이 지난 마일스톤들을 프로젝트별로 정리하고 무엇부터 처리해야 할지 알려줘'
    });
    if (soon.length) cards.push({
      id: 'ms-soon', level: 'warn', icon: '⚡', title: '7일 안 마감 · 진행률 낮음 ' + soon.length + '건',
      detail: '일주일 안에 마감인데 진행률이 50% 미만입니다.', items: soon.slice(0, 5).map(item),
      ask: '이번 주와 다음 주에 마감되는 마일스톤 중 위험한 것은?'
    });
  });

  // 3) 긴급 이슈 · 14일 넘게 안 풀린 이슈
  await safe('issues', async function () {
    var sub = pa.accessibleProjectsSubquery(req, 3);
    var r = await db.query("SELECT id, title, urgency, status, created_at, order_no FROM issues WHERE tenant_id = $1 AND status NOT IN ('resolved','closed') " +
      'AND ((project_id IS NULL AND created_by = $2) OR project_id IN (' + sub.sql + ')) ORDER BY created_at', [actor.tenantId, actor.userId].concat(sub.params));
    var urgent = r.rows.filter(function (x) { return x.urgency === 'urgent'; });
    var stale = r.rows.filter(function (x) { return x.urgency !== 'urgent' && x.created_at && (Date.now() - new Date(x.created_at).getTime()) > 14 * 86400000; });
    var item = function (x) {
      var age = x.created_at ? Math.floor((Date.now() - new Date(x.created_at).getTime()) / 86400000) : 0;
      return { label: x.title, sub: (x.order_no ? x.order_no + ' · ' : '') + age + '일째', nav: { issueId: x.id } };
    };
    if (urgent.length) cards.push({
      id: 'urgent', level: 'risk', icon: '🚨', title: '긴급 이슈 ' + urgent.length + '건 미해결',
      detail: '긴급으로 등록된 이슈가 아직 열려 있습니다.', items: urgent.slice(0, 5).map(item),
      ask: '긴급 이슈들의 담당자와 상태, 해결 우선순위를 정리해줘'
    });
    if (stale.length) cards.push({
      id: 'stale', level: 'warn', icon: '🐢', title: '2주 넘게 열린 이슈 ' + stale.length + '건',
      detail: '등록한 지 14일이 지났는데 해결되지 않았습니다.', items: stale.slice(0, 5).map(item),
      ask: '오래 열려 있는 이슈들을 정리하고 닫을 수 있는 것과 도움이 필요한 것을 나눠줘'
    });
  });

  // 4) 지난주 과부하 · 2주째 기록 없는 진행 중 프로젝트 (업무일지 범위 안에서)
  await safe('work', async function () {
    var sc = rs.recordScope(req);
    var now = new Date(today + 'T00:00:00'), day = now.getDay();
    var ws = new Date(now); ws.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
    var ls = new Date(ws); ls.setDate(ls.getDate() - 7);
    var le = new Date(ws); le.setDate(le.getDate() - 1);
    var r = await db.query('SELECT name, COALESCE(SUM(hours),0) AS hours, COUNT(DISTINCT date) AS days FROM work_records WHERE ' + sc.where +
      ' AND date >= $' + sc.nextIdx + ' AND date <= $' + (sc.nextIdx + 1) + ' GROUP BY name HAVING SUM(hours) > ' + OVERLOAD_H + ' ORDER BY hours DESC',
      sc.params.concat([ymd(ls), ymd(le)]));
    if (r.rows.length) cards.push({
      id: 'overload', level: 'warn', icon: '🔥', title: '지난주 ' + OVERLOAD_H + '시간 넘게 일한 사람 ' + r.rows.length + '명',
      detail: '지난주(' + ymd(ls) + '~' + ymd(le) + ') 업무일지 기준입니다.',
      items: r.rows.slice(0, 6).map(function (x) { return { label: x.name, sub: r1(x.hours) + 'h · ' + x.days + '일', nav: { name: x.name } }; }),
      ask: '지난주 업무 시간이 많았던 사람들이 어떤 일에 시간을 썼는지 알려줘'
    });
    // 회사 전체를 보는 사람만 — 범위가 좁으면 "기록 없음"이 사실과 다를 수 있음
    if (sc.scope !== 'tenant') return;
    var v = pa.visibleProjectsSql(req, 'p', 4);
    var st = pd.computeStatusSql('p', '$1');
    var since = new Date(now); since.setDate(since.getDate() - 14);
    var q = await db.query('SELECT p.id, p.name, p.order_no FROM projects p WHERE p.tenant_id = $2 AND ' + v.sql + ' AND ' + st + " = 'active' " +
      "AND COALESCE(p.order_no,'') <> '' AND p.start_date <= $1 " +
      'AND NOT EXISTS (SELECT 1 FROM work_records w WHERE w.tenant_id = p.tenant_id AND w.order_no = p.order_no AND w.date >= $3) ORDER BY p.end_date NULLS LAST',
      [today, actor.tenantId, ymd(since)].concat(v.params));
    if (q.rows.length) cards.push({
      id: 'idle', level: 'info', icon: '💤', title: '2주째 업무 기록 없는 진행 중 프로젝트 ' + q.rows.length + '건',
      detail: '진행 중인데 최근 14일 동안 그 수주번호로 쓴 업무일지가 없습니다.',
      items: q.rows.slice(0, 5).map(function (x) { return { label: x.name, sub: x.order_no, nav: { projectId: x.id } }; }),
      ask: '최근 2주 동안 업무 기록이 없는 진행 중 프로젝트들의 상태를 알려줘'
    });
  });

  // 5) A/S — 7일 넘게 진행 중 · 90일 동안 같은 장비·고객 3건 이상
  await safe('as', async function () {
    var r = await db.query("SELECT id, ticket_no, customer_name, issue_summary, received_at FROM as_tickets WHERE tenant_id = $1 AND deleted_at IS NULL " +
      "AND status NOT IN ('closed','cancelled','resolved') AND received_at < now() - interval '7 days' ORDER BY received_at", [actor.tenantId]);
    if (r.rows.length) cards.push({
      id: 'as-old', level: 'warn', icon: '🛠️', title: '7일 넘게 진행 중인 A/S ' + r.rows.length + '건',
      detail: '접수한 지 일주일이 지났는데 끝나지 않았습니다.',
      items: r.rows.slice(0, 5).map(function (x) {
        var age = Math.floor((Date.now() - new Date(x.received_at).getTime()) / 86400000);
        return { label: x.customer_name + ' · ' + String(x.issue_summary || x.ticket_no).slice(0, 40), sub: x.ticket_no + ' · ' + age + '일째', nav: { asId: x.id } };
      }),
      ask: '오래 걸리고 있는 A/S 건들의 상황과 원인을 정리해줘'
    });
    var c = await db.query("SELECT COALESCE(NULLIF(equipment_model,''),'(모델 없음)') AS model, customer_name, COUNT(*)::int AS n FROM as_tickets " +
      "WHERE tenant_id = $1 AND deleted_at IS NULL AND received_at >= now() - interval '90 days' GROUP BY 1, 2 HAVING COUNT(*) >= 3 ORDER BY n DESC", [actor.tenantId]);
    if (c.rows.length) cards.push({
      id: 'as-repeat', level: 'info', icon: '🔁', title: '90일 동안 A/S 3번 이상 ' + c.rows.length + '곳',
      detail: '같은 장비 · 고객에서 A/S 가 반복됩니다.',
      items: c.rows.slice(0, 5).map(function (x) { return { label: x.model + ' · ' + x.customer_name, sub: x.n + '건', nav: null }; }),
      ask: '최근 90일 A/S 가 반복되는 장비와 고객, 공통 증상을 분석해줘'
    });
  });

  // 10) 주간 업무 보고 경과 (관리자 — 주간 보고는 관리자 화면, v13.310) — 보고서를 주를 넘어 이어 붙여 본 납기 지남 · 정체 · 뒤처짐
  if (actor.role === 'admin') await safe('weekly-report', async function () {
    var wi = require('../lib/weekly-insights');
    var w = wi.compute(await wi.load(db, actor.tenantId, { weeks: 8 }));
    if (!w.weekly.length) return;
    var bad = w.risks.overdue.concat(w.risks.stalled, w.risks.atRisk);
    if (!bad.length) return;
    var k = w.kpi;
    cards.push({
      id: 'weekly-report', level: k.overdue ? 'risk' : 'warn', icon: '📅',
      title: '주간 보고 — ' + [k.overdue ? '납기 지남 ' + k.overdue : '', k.stalled ? '정체 ' + k.stalled : '', k.atRisk ? '뒤처짐 ' + k.atRisk : ''].filter(Boolean).join(' · '),
      detail: '최근 8주 주간 업무 보고를 이어 본 결과 — 📅 주간 업무 › 📈 분석에서 자세히.',
      items: bad.slice(0, 5).map(function (i) {
        return { label: i.client + ' ' + i.name, sub: ({ overdue: '납기 지남', stalled: '정체', at_risk: '뒤처짐' }[i.state] || '') + (i.members.length ? ' · ' + i.members.join(',') : '') + (i.pct != null ? ' · ' + i.pct + '%' : ''), nav: null };
      }),
      ask: '최근 주간 업무 보고에서 납기가 지났거나 정체된 일들의 원인과 다음 주 목표를 정리해줘'
    });
  });

  var RANK = { risk: 0, warn: 1, info: 2 };
  return cards.sort(function (a, b) { return RANK[a.level] - RANK[b.level]; });
}

/** 텔레그램 브리핑 글 (HTML) — 카드가 없으면 '' */
function briefText(cards, name, esc) {
  if (!cards || !cards.length) return '';
  esc = esc || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var s = '💡 <b>이번 주 살펴볼 것</b>' + (name ? ' · ' + esc(name) : '') + '\n<i>' + pd.todayKST() + ' · 볼 수 있는 범위 기준</i>\n';
  cards.slice(0, 7).forEach(function (c) {
    s += '\n' + c.icon + ' <b>' + esc(c.title) + '</b>\n';
    c.items.slice(0, 3).forEach(function (it) { s += '  • ' + esc(it.label) + (it.sub ? ' <i>(' + esc(it.sub) + ')</i>' : '') + '\n'; });
    if (c.items.length > 3) s += '  … 외 ' + (c.items.length - 3) + '건\n';
  });
  s += '\n자세한 내용은 웹 검색창의 ✨ AI에게 묻기 또는 여기서 질문으로 물어보세요.';
  return s;
}

module.exports = { computeInsights: computeInsights, briefText: briefText, OVERLOAD_H: OVERLOAD_H };
