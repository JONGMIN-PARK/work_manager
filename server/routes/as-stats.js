/**
 * A/S 통계·트렌드 분석 API
 *  - GET /api/as-stats           : 단일 통합 엔드포인트 (모든 차트 데이터 한방)
 *  - GET /api/as-stats/weekly-digest?send=1 : 주간 요약 + 텔레그램 발사
 *
 * 기간 필터: ?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=day|week|month
 *           생략 시 from=최근 90일 전, to=오늘, groupBy=auto (90일 이하면 week, 그 외 month)
 *
 * 응답 디자인:
 *   data.kpi.{key} 는 보통 {value, prev, deltaPct} 형태(증감 화살표용)
 *   labels/values 모두 정렬 보장
 *
 * SLA 기준: AS_PRIORITY[priority].closeDays 초과 + status≠closed = breach
 */

var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var notificationService = require('../services/notification.service');
var ttlCache = require('../services/ttl-cache.service');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// v13.59: A/S 통계 응답 메모리 캐시 (5분 TTL, 테넌트+필터+기간 키)
// 같은 조건으로 다수 사용자가 통계 화면을 보면 DB 쿼리 0회로 응답.
// 티켓 mutation 발생 시 해당 테넌트 캐시 일괄 무효화 (라우터 외부에서 호출).
var STATS_CACHE_TTL_MS = parseInt(process.env.AS_STATS_CACHE_MS, 10) || (5 * 60 * 1000);
var statsCache = ttlCache.create({ ttlMs: STATS_CACHE_TTL_MS, max: 200 });

function _cacheKey(tenantId, q) {
  return tenantId + '|' + (q.from || '') + '|' + (q.to || '') + '|' + (q.groupBy || '') +
         '|c=' + (q.category || '') + '|p=' + (q.priority || '') + '|cu=' + (q.customer || '');
}

// 외부에서 호출 가능 — 티켓 CUD 시 해당 테넌트 통계 무효화
function invalidateStats(tenantId) {
  return statsCache.invalidate(tenantId + '|');
}
router.invalidateStats = invalidateStats;

// ─── SLA 정책 (config.js AS_PRIORITY와 동일) ───
var SLA = {
  P1: { responseH: 1,  visitH: 24,  closeDays: 3,  color: '#EF4444', label: 'P1 긴급' },
  P2: { responseH: 4,  visitH: 72,  closeDays: 7,  color: '#F97316', label: 'P2 높음' },
  P3: { responseH: 8,  visitH: 168, closeDays: 14, color: '#F59E0B', label: 'P3 보통' },
  P4: { responseH: 24, visitH: null, closeDays: 30, color: '#10B981', label: 'P4 낮음' }
};
var STATUS_COLORS = {
  received: '#6366F1', assigned: '#0EA5E9', in_progress: '#3B82F6',
  reporting: '#8B5CF6', approved: '#A855F7', customer_wait: '#F59E0B',
  closed: '#10B981', hold: '#94A3B8', cancelled: '#64748B'
};
var WARRANTY_COLORS = { '보증 내': '#10B981', '보증 종료': '#EF4444', '확인 필요': '#94A3B8' };
var METHOD_COLORS = { 원격지원: '#3B82F6', 출장: '#F59E0B', RMA: '#EF4444', 가이드제공: '#06B6D4', 자료송부: '#8B5CF6' };

// ─── 헬퍼: 기간/이전 기간 ───
function parsePeriod(q) {
  var to = q.to ? new Date(q.to + 'T23:59:59') : new Date();
  if (isNaN(to.getTime())) to = new Date();
  var from = q.from ? new Date(q.from + 'T00:00:00') : new Date(to.getTime() - 90 * 24 * 3600 * 1000);
  if (isNaN(from.getTime())) from = new Date(to.getTime() - 90 * 24 * 3600 * 1000);
  // 이전 동일 길이
  var lenMs = to.getTime() - from.getTime();
  var prevTo = new Date(from.getTime() - 1000);
  var prevFrom = new Date(prevTo.getTime() - lenMs);
  // groupBy 자동 결정
  var days = Math.ceil(lenMs / (24 * 3600 * 1000));
  var groupBy = (q.groupBy || '').toLowerCase();
  if (!['day', 'week', 'month'].includes(groupBy)) {
    groupBy = days <= 31 ? 'day' : (days <= 120 ? 'week' : 'month');
  }
  return { from: from, to: to, prevFrom: prevFrom, prevTo: prevTo, groupBy: groupBy, days: days };
}

function pctDelta(curr, prev) {
  if (prev == null || prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;  // 소수 첫째자리
}

// ────────────────────────────────────────────────────────────
// GET /api/as-stats — 통합 응답
// ────────────────────────────────────────────────────────────
router.get('/', async function (req, res) {
  try {
    var p = parsePeriod(req.query);
    var tid = req.tenant.id;

    // 캐시 hit 체크 (?nocache=1 이면 우회)
    var ck = _cacheKey(tid, req.query);
    var bypass = (req.query.nocache === '1' || req.query.nocache === 'true');
    if (!bypass) {
      var cached = statsCache.get(ck);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }
    }
    res.setHeader('X-Cache', bypass ? 'BYPASS' : 'MISS');

    // 다중 필터 (v13.55 C) — category / priority / customer
    var extraWhere = '';
    var paramsFull = [tid, p.from.toISOString(), p.to.toISOString()];
    var paramsPrev = [tid, p.prevFrom.toISOString(), p.prevTo.toISOString()];
    var idx = 4;
    var addFilter = function (col, val, useLike) {
      if (val == null || val === '') return;
      var vals = String(val).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!vals.length) return;
      if (useLike) {
        extraWhere += " AND " + col + " ILIKE $" + idx;
        paramsFull.push('%' + vals[0] + '%');
        paramsPrev.push('%' + vals[0] + '%');
        idx++;
      } else {
        var placeholders = vals.map(function () { return '$' + idx++; }).join(',');
        extraWhere += " AND " + col + " IN (" + placeholders + ")";
        vals.forEach(function (v) { paramsFull.push(v); paramsPrev.push(v); });
      }
    };
    addFilter('category', req.query.category, false);
    addFilter('priority', req.query.priority, false);
    addFilter('customer_name', req.query.customer, true);

    var BASE_WHERE = "tenant_id = $1 AND deleted_at IS NULL" + extraWhere;

    // SLA breach CASE 식 (priority별 closeDays)
    var SLA_BREACH_EXPR =
      "CASE " +
      "  WHEN status NOT IN ('closed','cancelled') AND priority='P1' AND received_at < NOW() - INTERVAL '3 days' THEN 1 " +
      "  WHEN status NOT IN ('closed','cancelled') AND priority='P2' AND received_at < NOW() - INTERVAL '7 days' THEN 1 " +
      "  WHEN status NOT IN ('closed','cancelled') AND priority='P3' AND received_at < NOW() - INTERVAL '14 days' THEN 1 " +
      "  WHEN status NOT IN ('closed','cancelled') AND priority='P4' AND received_at < NOW() - INTERVAL '30 days' THEN 1 " +
      "  WHEN status='closed' AND priority='P1' AND closed_at - received_at > INTERVAL '3 days' THEN 1 " +
      "  WHEN status='closed' AND priority='P2' AND closed_at - received_at > INTERVAL '7 days' THEN 1 " +
      "  WHEN status='closed' AND priority='P3' AND closed_at - received_at > INTERVAL '14 days' THEN 1 " +
      "  WHEN status='closed' AND priority='P4' AND closed_at - received_at > INTERVAL '30 days' THEN 1 " +
      "  ELSE 0 END";

    // ─── 병렬 쿼리 ───
    var sqls = {
      // KPI (현재 기간)
      kpiCurr: {
        sql:
          "SELECT " +
          "  COUNT(*)::int AS new_count, " +
          "  COUNT(*) FILTER (WHERE status NOT IN ('closed','cancelled'))::int AS in_progress, " +
          "  COUNT(*) FILTER (WHERE status='closed')::int AS closed_count, " +
          "  COUNT(*) FILTER (WHERE status NOT IN ('closed','cancelled') AND priority IN ('P1','P2'))::int AS open_critical, " +
          "  COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - received_at))/3600.0) FILTER (WHERE status='closed' AND closed_at IS NOT NULL),0)::numeric(10,2) AS mttr_h, " +
          "  COALESCE(SUM(" + SLA_BREACH_EXPR + "),0)::int AS sla_breach, " +
          "  COUNT(*) FILTER (WHERE priority IN ('P1','P2','P3','P4'))::int AS sla_total " +
          "FROM as_tickets WHERE " + BASE_WHERE + " AND received_at >= $2 AND received_at <= $3",
        params: paramsFull
      },
      // KPI (이전 기간) — 비교
      kpiPrev: {
        sql:
          "SELECT " +
          "  COUNT(*)::int AS new_count, " +
          "  COUNT(*) FILTER (WHERE status='closed')::int AS closed_count, " +
          "  COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - received_at))/3600.0) FILTER (WHERE status='closed' AND closed_at IS NOT NULL),0)::numeric(10,2) AS mttr_h, " +
          "  COALESCE(SUM(" + SLA_BREACH_EXPR + "),0)::int AS sla_breach " +
          "FROM as_tickets WHERE " + BASE_WHERE + " AND received_at >= $2 AND received_at <= $3",
        params: paramsPrev
      },
      // CSAT 평균 (현재/이전)
      csatCurr: {
        sql:
          "SELECT " +
          "  AVG(CASE c.csat_overall WHEN 'very_satisfied' THEN 5 WHEN 'satisfied' THEN 4 WHEN 'neutral' THEN 3 WHEN 'unsatisfied' THEN 2 WHEN 'very_unsatisfied' THEN 1 END)::numeric(10,2) AS overall_avg, " +
          "  AVG(CASE c.csat_speed WHEN 'very_satisfied' THEN 5 WHEN 'satisfied' THEN 4 WHEN 'neutral' THEN 3 WHEN 'unsatisfied' THEN 2 WHEN 'very_unsatisfied' THEN 1 END)::numeric(10,2) AS speed_avg, " +
          "  AVG(CASE c.csat_quality WHEN 'very_satisfied' THEN 5 WHEN 'satisfied' THEN 4 WHEN 'neutral' THEN 3 WHEN 'unsatisfied' THEN 2 WHEN 'very_unsatisfied' THEN 1 END)::numeric(10,2) AS quality_avg, " +
          "  COUNT(*) FILTER (WHERE c.csat_overall IS NOT NULL)::int AS resp_count " +
          "FROM as_signatures c JOIN as_tickets t ON c.ticket_id = t.id " +
          "WHERE c.tenant_id = $1 AND t.deleted_at IS NULL AND c.role='customer_field' AND c.signed_at >= $2 AND c.signed_at <= $3",
        params: paramsFull
      },
      csatPrev: {
        sql:
          "SELECT AVG(CASE c.csat_overall WHEN 'very_satisfied' THEN 5 WHEN 'satisfied' THEN 4 WHEN 'neutral' THEN 3 WHEN 'unsatisfied' THEN 2 WHEN 'very_unsatisfied' THEN 1 END)::numeric(10,2) AS overall_avg " +
          "FROM as_signatures c JOIN as_tickets t ON c.ticket_id = t.id " +
          "WHERE c.tenant_id = $1 AND t.deleted_at IS NULL AND c.role='customer_field' AND c.signed_at >= $2 AND c.signed_at <= $3",
        params: paramsPrev
      },
      // 부품 비용 합계
      partsTotal: {
        sql:
          "SELECT COALESCE(SUM(qty*unit_price),0)::numeric(14,0) AS total " +
          "FROM as_parts p JOIN as_tickets t ON p.ticket_id = t.id " +
          "WHERE p.tenant_id = $1 AND t.deleted_at IS NULL AND COALESCE(p.used_at, t.received_at) >= $2 AND COALESCE(p.used_at, t.received_at) <= $3",
        params: paramsFull
      },
      // 트렌드 (group by 기간)
      trend: {
        sql:
          "SELECT date_trunc('" + p.groupBy + "', received_at) AS bucket, " +
          "  COUNT(*)::int AS new_count, " +
          "  COUNT(*) FILTER (WHERE status='closed')::int AS closed_count, " +
          "  COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - received_at))/3600.0) FILTER (WHERE status='closed' AND closed_at IS NOT NULL),0)::numeric(10,2) AS mttr_h " +
          "FROM as_tickets WHERE " + BASE_WHERE + " AND received_at >= $2 AND received_at <= $3 " +
          "GROUP BY bucket ORDER BY bucket ASC",
        params: paramsFull
      },
      // 분포: 카테고리
      distCategory: {
        sql:
          "SELECT COALESCE(t.category, 'etc') AS code, c.label, c.icon, COUNT(*)::int AS value " +
          "FROM as_tickets t LEFT JOIN as_categories c ON c.code = t.category AND c.tenant_id = t.tenant_id " +
          "WHERE t." + BASE_WHERE + " AND t.received_at >= $2 AND t.received_at <= $3 " +
          "GROUP BY t.category, c.label, c.icon ORDER BY value DESC",
        params: paramsFull
      },
      // 분포: 긴급도
      distPriority: {
        sql:
          "SELECT priority AS code, COUNT(*)::int AS value " +
          "FROM as_tickets WHERE " + BASE_WHERE + " AND received_at >= $2 AND received_at <= $3 " +
          "GROUP BY priority ORDER BY priority ASC",
        params: paramsFull
      },
      // 분포: 상태
      distStatus: {
        sql:
          "SELECT status AS code, COUNT(*)::int AS value " +
          "FROM as_tickets WHERE " + BASE_WHERE + " AND received_at >= $2 AND received_at <= $3 " +
          "GROUP BY status ORDER BY value DESC",
        params: paramsFull
      },
      // 분포: 보증여부
      distWarranty: {
        sql:
          "SELECT COALESCE(NULLIF(warranty_status,''),'미지정') AS code, COUNT(*)::int AS value " +
          "FROM as_tickets WHERE " + BASE_WHERE + " AND received_at >= $2 AND received_at <= $3 " +
          "GROUP BY warranty_status ORDER BY value DESC",
        params: paramsFull
      },
      // 분포: 처리방식
      distMethod: {
        sql:
          "SELECT COALESCE(NULLIF(method,''),'미지정') AS code, COUNT(*)::int AS value " +
          "FROM as_tickets WHERE " + BASE_WHERE + " AND received_at >= $2 AND received_at <= $3 " +
          "GROUP BY method ORDER BY value DESC",
        params: paramsFull
      },
      // 부서별 처리 부하 (Activity Log 소요시간 합계 + 티켓 수)
      deptLoad: {
        sql:
          "SELECT l.dept, " +
          "  COALESCE(SUM(l.duration_h),0)::numeric(10,2) AS hours, " +
          "  COUNT(DISTINCT l.ticket_id)::int AS ticket_count " +
          "FROM as_activity_logs l JOIN as_tickets t ON l.ticket_id = t.id " +
          "WHERE l.tenant_id = $1 AND t.deleted_at IS NULL AND l.worked_at >= $2 AND l.worked_at <= $3 " +
          "GROUP BY l.dept ORDER BY hours DESC",
        params: paramsFull
      },
      // SLA 준수율 (긴급도별)
      slaByPriority: {
        sql:
          "SELECT priority, " +
          "  COUNT(*)::int AS total, " +
          "  SUM(" + SLA_BREACH_EXPR + ")::int AS breached " +
          "FROM as_tickets WHERE " + BASE_WHERE + " AND received_at >= $2 AND received_at <= $3 " +
          "GROUP BY priority ORDER BY priority ASC",
        params: paramsFull
      },
      // Top 고객 (Pareto)
      topCustomers: {
        sql:
          "SELECT customer_name, COUNT(*)::int AS value, " +
          "  COUNT(*) FILTER (WHERE priority IN ('P1','P2'))::int AS urgent_count " +
          "FROM as_tickets WHERE " + BASE_WHERE + " AND received_at >= $2 AND received_at <= $3 " +
          "AND customer_name IS NOT NULL AND customer_name <> '' " +
          "GROUP BY customer_name ORDER BY value DESC LIMIT 10",
        params: paramsFull
      },
      // Top 장비모델
      topEquipment: {
        sql:
          "SELECT equipment_model, COUNT(*)::int AS value " +
          "FROM as_tickets WHERE " + BASE_WHERE + " AND received_at >= $2 AND received_at <= $3 " +
          "AND equipment_model IS NOT NULL AND equipment_model <> '' " +
          "GROUP BY equipment_model ORDER BY value DESC LIMIT 10",
        params: paramsFull
      },
      // RCA·완료분류 분포
      rcaDist: {
        sql:
          "SELECT COALESCE(NULLIF(closure,''),'미지정') AS code, COUNT(*)::int AS value " +
          "FROM as_tickets WHERE " + BASE_WHERE + " AND status='closed' AND closed_at >= $2 AND closed_at <= $3 " +
          "GROUP BY closure ORDER BY value DESC",
        params: paramsFull
      },
      // CSAT 추이
      csatTrend: {
        sql:
          "SELECT date_trunc('" + p.groupBy + "', c.signed_at) AS bucket, " +
          "  AVG(CASE c.csat_overall WHEN 'very_satisfied' THEN 5 WHEN 'satisfied' THEN 4 WHEN 'neutral' THEN 3 WHEN 'unsatisfied' THEN 2 WHEN 'very_unsatisfied' THEN 1 END)::numeric(10,2) AS overall_avg, " +
          "  AVG(CASE c.csat_speed WHEN 'very_satisfied' THEN 5 WHEN 'satisfied' THEN 4 WHEN 'neutral' THEN 3 WHEN 'unsatisfied' THEN 2 WHEN 'very_unsatisfied' THEN 1 END)::numeric(10,2) AS speed_avg, " +
          "  AVG(CASE c.csat_quality WHEN 'very_satisfied' THEN 5 WHEN 'satisfied' THEN 4 WHEN 'neutral' THEN 3 WHEN 'unsatisfied' THEN 2 WHEN 'very_unsatisfied' THEN 1 END)::numeric(10,2) AS quality_avg " +
          "FROM as_signatures c JOIN as_tickets t ON c.ticket_id = t.id " +
          "WHERE c.tenant_id = $1 AND t.deleted_at IS NULL AND c.role='customer_field' " +
          "AND c.signed_at >= $2 AND c.signed_at <= $3 " +
          "GROUP BY bucket ORDER BY bucket ASC",
        params: paramsFull
      },
      // 부품 청구구분별
      partsByBilling: {
        sql:
          "SELECT COALESCE(NULLIF(p.billing,''),'check') AS billing, COALESCE(SUM(p.qty*p.unit_price),0)::numeric(14,0) AS total " +
          "FROM as_parts p JOIN as_tickets t ON p.ticket_id = t.id " +
          "WHERE p.tenant_id = $1 AND t.deleted_at IS NULL AND COALESCE(p.used_at, t.received_at) >= $2 AND COALESCE(p.used_at, t.received_at) <= $3 " +
          "GROUP BY p.billing ORDER BY total DESC",
        params: paramsFull
      },
      // 부품 월별 추이
      partsByMonth: {
        sql:
          "SELECT date_trunc('" + p.groupBy + "', COALESCE(p.used_at, t.received_at)) AS bucket, " +
          "  COALESCE(NULLIF(p.billing,''),'check') AS billing, " +
          "  COALESCE(SUM(p.qty*p.unit_price),0)::numeric(14,0) AS total " +
          "FROM as_parts p JOIN as_tickets t ON p.ticket_id = t.id " +
          "WHERE p.tenant_id = $1 AND t.deleted_at IS NULL AND COALESCE(p.used_at, t.received_at) >= $2 AND COALESCE(p.used_at, t.received_at) <= $3 " +
          "GROUP BY bucket, p.billing ORDER BY bucket ASC",
        params: paramsFull
      }
    };

    // 모든 쿼리 병렬 실행
    var keys = Object.keys(sqls);
    var rows = await Promise.all(keys.map(function (k) {
      return db.query(sqls[k].sql, sqls[k].params);
    }));
    var R = {};
    keys.forEach(function (k, i) { R[k] = rows[i].rows; });

    // ─── KPI 조립 ───
    var kc = R.kpiCurr[0] || {};
    var kp = R.kpiPrev[0] || {};
    var cc = R.csatCurr[0] || {};
    var cp = R.csatPrev[0] || {};
    var pt = R.partsTotal[0] || {};
    var slaPct = kc.sla_total ? Math.round((kc.sla_breach * 1000.0) / kc.sla_total) / 10 : 0;
    var prevSlaPct = kp.sla_breach != null && R.kpiPrev[0] && R.kpiPrev[0].new_count
      ? Math.round((kp.sla_breach * 1000.0) / R.kpiPrev[0].new_count) / 10 : null;

    var kpi = {
      newCount:     { value: kc.new_count || 0,      prev: kp.new_count || 0,      deltaPct: pctDelta(kc.new_count || 0, kp.new_count || 0) },
      closedCount:  { value: kc.closed_count || 0,   prev: kp.closed_count || 0,   deltaPct: pctDelta(kc.closed_count || 0, kp.closed_count || 0) },
      inProgress:   { value: kc.in_progress || 0 },
      openCritical: { value: kc.open_critical || 0 },
      mttrHours:    { value: Number(kc.mttr_h || 0), prev: Number(kp.mttr_h || 0), deltaPct: pctDelta(Number(kc.mttr_h || 0), Number(kp.mttr_h || 0)) },
      slaBreachPct: { value: slaPct, prev: prevSlaPct, deltaPct: pctDelta(slaPct, prevSlaPct) },
      slaBreachCount: { value: kc.sla_breach || 0 },
      csatOverall:  { value: Number(cc.overall_avg || 0), prev: Number(cp.overall_avg || 0), deltaPct: pctDelta(Number(cc.overall_avg || 0), Number(cp.overall_avg || 0)), respCount: cc.resp_count || 0 },
      csatSpeed:    { value: Number(cc.speed_avg || 0) },
      csatQuality:  { value: Number(cc.quality_avg || 0) },
      partsCost:    { value: Number(pt.total || 0) }
    };

    // ─── 트렌드 ───
    var trend = {
      labels: R.trend.map(function (r) { return r.bucket; }),
      newCount: R.trend.map(function (r) { return r.new_count; }),
      closedCount: R.trend.map(function (r) { return r.closed_count; }),
      mttrHours: R.trend.map(function (r) { return Number(r.mttr_h); })
    };

    // ─── 분포: 카테고리 ───
    var distCategory = R.distCategory.map(function (r) {
      return { code: r.code, label: r.label || r.code, icon: r.icon || '', value: r.value };
    });
    var distPriority = R.distPriority.map(function (r) {
      var s = SLA[r.code] || {};
      return { code: r.code, label: s.label || r.code, color: s.color || '#94A3B8', value: r.value };
    });
    var distStatus = R.distStatus.map(function (r) {
      return { code: r.code, color: STATUS_COLORS[r.code] || '#94A3B8', value: r.value };
    });
    var distWarranty = R.distWarranty.map(function (r) {
      return { code: r.code, color: WARRANTY_COLORS[r.code] || '#94A3B8', value: r.value };
    });
    var distMethod = R.distMethod.map(function (r) {
      return { code: r.code, color: METHOD_COLORS[r.code] || '#94A3B8', value: r.value };
    });

    // ─── 부서별 부하 ───
    var deptLoad = R.deptLoad.map(function (r) {
      return { dept: r.dept, hours: Number(r.hours), ticketCount: r.ticket_count };
    });

    // ─── SLA ───
    var slaByPriority = R.slaByPriority.map(function (r) {
      var withinSla = r.total - r.breached;
      var breachPct = r.total ? Math.round((r.breached * 1000) / r.total) / 10 : 0;
      return {
        priority: r.priority,
        color: (SLA[r.priority] || {}).color || '#94A3B8',
        total: r.total, breached: r.breached, withinSla: withinSla, breachPct: breachPct
      };
    });

    // ─── Top ───
    var topCustomers = R.topCustomers.map(function (r) {
      return { name: r.customer_name, value: r.value, urgentCount: r.urgent_count };
    });
    var topEquipment = R.topEquipment.map(function (r) {
      return { name: r.equipment_model, value: r.value };
    });

    // ─── RCA ───
    var rca = R.rcaDist.map(function (r) {
      return { code: r.code, value: r.value };
    });

    // ─── CSAT 추이 ───
    var csat = {
      labels: R.csatTrend.map(function (r) { return r.bucket; }),
      overall: R.csatTrend.map(function (r) { return Number(r.overall_avg || 0); }),
      speed: R.csatTrend.map(function (r) { return Number(r.speed_avg || 0); }),
      quality: R.csatTrend.map(function (r) { return Number(r.quality_avg || 0); })
    };

    // ─── 부품 ───
    var partsByBilling = R.partsByBilling.map(function (r) { return { billing: r.billing, total: Number(r.total) }; });
    var partsByMonthMap = {};
    R.partsByMonth.forEach(function (r) {
      var k = r.bucket && r.bucket.toISOString ? r.bucket.toISOString() : String(r.bucket);
      if (!partsByMonthMap[k]) partsByMonthMap[k] = { bucket: r.bucket, warranty: 0, paid: 0, goodwill: 0, check: 0 };
      partsByMonthMap[k][r.billing || 'check'] = Number(r.total);
    });
    var partsByMonthArr = Object.keys(partsByMonthMap).map(function (k) { return partsByMonthMap[k]; })
      .sort(function (a, b) { return a.bucket < b.bucket ? -1 : 1; });
    var parts = {
      byBilling: partsByBilling,
      labels: partsByMonthArr.map(function (r) { return r.bucket; }),
      warranty: partsByMonthArr.map(function (r) { return r.warranty; }),
      paid: partsByMonthArr.map(function (r) { return r.paid; }),
      goodwill: partsByMonthArr.map(function (r) { return r.goodwill; }),
      check: partsByMonthArr.map(function (r) { return r.check; })
    };

    // ─── 자동 인사이트 ───
    var insights = buildInsights(kpi, { topCustomers: topCustomers, distCategory: distCategory, deptLoad: deptLoad, slaByPriority: slaByPriority });

    // ─── 건강 점수 (Health Score) — 0~100 단일 KPI ───
    // 가중치: SLA 50% + MTTR 25% + CSAT 25% (CSAT 데이터 없으면 SLA 70% + MTTR 30%)
    var hasCsat = kpi.csatOverall.respCount >= 1;
    var slaScore  = Math.max(0, 100 - (kpi.slaBreachPct.value || 0) * 4);            // 위반 0%=100점, 25%=0점
    var mttrTarget = 24;  // 24시간 이내가 만점
    var mttrScore = kpi.mttrHours.value > 0 ? Math.max(0, Math.min(100, 100 - (kpi.mttrHours.value - mttrTarget) * 2)) : 100;
    var csatScore = hasCsat ? (kpi.csatOverall.value / 5) * 100 : 0;
    var health;
    if (hasCsat) {
      health = Math.round(slaScore * 0.5 + mttrScore * 0.25 + csatScore * 0.25);
    } else {
      health = Math.round(slaScore * 0.7 + mttrScore * 0.3);
    }
    var healthGrade = health >= 90 ? 'A' : health >= 75 ? 'B' : health >= 60 ? 'C' : health >= 45 ? 'D' : 'E';
    var healthColor = health >= 90 ? '#10B981' : health >= 75 ? '#3B82F6' : health >= 60 ? '#F59E0B' : health >= 45 ? '#F97316' : '#EF4444';
    kpi.healthScore = {
      value: health,
      grade: healthGrade,
      color: healthColor,
      breakdown: {
        sla: Math.round(slaScore),
        mttr: Math.round(mttrScore),
        csat: hasCsat ? Math.round(csatScore) : null
      }
    };

    var payload = {
      data: {
        period: { from: p.from.toISOString(), to: p.to.toISOString(), groupBy: p.groupBy, days: p.days,
                  prevFrom: p.prevFrom.toISOString(), prevTo: p.prevTo.toISOString() },
        kpi: kpi,
        trend: trend,
        distribution: {
          category: distCategory, priority: distPriority, status: distStatus,
          warranty: distWarranty, method: distMethod
        },
        deptLoad: deptLoad,
        sla: { byPriority: slaByPriority },
        topCustomers: topCustomers,
        topEquipment: topEquipment,
        rca: rca,
        csat: csat,
        parts: parts,
        insights: insights,
        cachedAt: new Date().toISOString()
      }
    };
    // 결과 캐시 (다음 5분간 같은 조건 호출은 DB 안 감)
    if (!bypass) statsCache.set(ck, payload);
    res.json(payload);
  } catch (e) {
    console.error('[as-stats]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '통계 조회 실패: ' + (e.message || '') });
  }
});

// 캐시 상태 조회 (admin 디버그용)
router.get('/_cache/stats', function (req, res) {
  res.json({ data: statsCache.stats(), ttlMs: STATS_CACHE_TTL_MS });
});

// 강제 무효화 (admin)
router.post('/_cache/invalidate', function (req, res) {
  var n = invalidateStats(req.tenant.id);
  res.json({ message: '캐시 무효화 완료', removed: n });
});

// ────────────────────────────────────────────────────────────
// 자동 인사이트 — 규칙 기반 코멘트 ("어디가 변했는가" 자동 추출)
// ────────────────────────────────────────────────────────────
function buildInsights(kpi, ctx) {
  var out = [];
  function fmtPct(x) { return (x > 0 ? '+' : '') + x + '%'; }

  // 신규 접수 변화
  if (kpi.newCount.deltaPct != null) {
    var d = kpi.newCount.deltaPct;
    if (Math.abs(d) >= 20) {
      out.push({
        kind: d > 0 ? 'warn' : 'good',
        icon: d > 0 ? '📈' : '📉',
        text: '신규 접수 ' + fmtPct(d) + ' (' + kpi.newCount.prev + '건 → ' + kpi.newCount.value + '건). ' +
              (d > 0 ? '발생 빈도 급증 — 카테고리·고객별 패턴 확인 권장' : '감소세 — 안정화 추세')
      });
    }
  }

  // MTTR 변화
  if (kpi.mttrHours.value > 0 && kpi.mttrHours.deltaPct != null) {
    var dm = kpi.mttrHours.deltaPct;
    if (Math.abs(dm) >= 10) {
      out.push({
        kind: dm > 0 ? 'warn' : 'good',
        icon: dm > 0 ? '⏱️' : '⚡',
        text: '평균 처리시간 ' + fmtPct(dm) + ' (' + kpi.mttrHours.prev.toFixed(1) + 'h → ' + kpi.mttrHours.value.toFixed(1) + 'h). ' +
              (dm > 0 ? '병목 지점·부족 인력 점검 필요' : '응답 속도 개선')
      });
    }
  }

  // SLA 위반
  if (kpi.slaBreachPct.value >= 10) {
    out.push({
      kind: 'critical',
      icon: '🚨',
      text: 'SLA 위반율 ' + kpi.slaBreachPct.value + '% (' + kpi.slaBreachCount.value + '건). ' +
            '긴급도 P1/P2 약속 시간 준수 점검 시급'
    });
  } else if (kpi.slaBreachPct.value > 0) {
    out.push({
      kind: 'info',
      icon: '⏰',
      text: 'SLA 위반 ' + kpi.slaBreachCount.value + '건 (' + kpi.slaBreachPct.value + '%). 추적 권장'
    });
  }

  // CSAT
  if (kpi.csatOverall.respCount >= 3) {
    if (kpi.csatOverall.value < 3.5) {
      out.push({ kind: 'critical', icon: '😟', text: 'CSAT 평균 ' + kpi.csatOverall.value.toFixed(1) + '/5 — 만족도 저하. 응답·품질 항목 세부 확인' });
    } else if (kpi.csatOverall.value >= 4.5) {
      out.push({ kind: 'good', icon: '😄', text: 'CSAT 평균 ' + kpi.csatOverall.value.toFixed(1) + '/5 — 우수' });
    }
  }

  // Top 고객 Pareto
  if (ctx.topCustomers && ctx.topCustomers.length >= 1) {
    var t0 = ctx.topCustomers[0];
    var totalTop = ctx.topCustomers.reduce(function (s, x) { return s + x.value; }, 0);
    if (kpi.newCount.value > 0 && (t0.value / kpi.newCount.value) >= 0.3) {
      out.push({
        kind: 'info',
        icon: '🎯',
        text: '최다 발생: ' + t0.name + ' (' + t0.value + '건, 전체의 ' + Math.round(t0.value / kpi.newCount.value * 100) + '%)' +
              (t0.urgentCount > 0 ? ', P1·P2 ' + t0.urgentCount + '건 포함' : '')
      });
    }
  }

  // 카테고리 Top
  if (ctx.distCategory && ctx.distCategory.length >= 1 && kpi.newCount.value >= 5) {
    var c0 = ctx.distCategory[0];
    if (c0.value / kpi.newCount.value >= 0.3) {
      out.push({
        kind: 'info',
        icon: c0.icon || '🏷️',
        text: '주요 카테고리: ' + c0.label + ' (' + c0.value + '건, ' + Math.round(c0.value / kpi.newCount.value * 100) + '%). 재발방지 우선 검토'
      });
    }
  }

  // 부서 부하
  if (ctx.deptLoad && ctx.deptLoad.length >= 1) {
    var d0 = ctx.deptLoad[0];
    if (d0.hours >= 40) {
      out.push({
        kind: 'warn',
        icon: '👥',
        text: '최대 부하 부서: ' + d0.dept + ' (' + d0.hours.toFixed(0) + 'h, ' + d0.ticketCount + '건). 인력 재배치 검토'
      });
    }
  }

  // 긴급도 — P1/P2 미해결
  if (kpi.openCritical.value >= 3) {
    out.push({
      kind: 'critical',
      icon: '🔴',
      text: 'P1/P2 진행 중 ' + kpi.openCritical.value + '건. 우선 처리 필요'
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────
// GET /api/as-stats/weekly-digest?send=1 — 주간 요약 (텔레그램 자동 발사)
//   send=1 이면 admin들에게 텔레그램 발송
//   그 외엔 요약 텍스트만 반환 (cron 호환/디버깅용)
// ────────────────────────────────────────────────────────────
router.get('/weekly-digest', async function (req, res) {
  try {
    var tid = req.tenant.id;
    var now = new Date();
    var weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    var twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);

    var BASE = "tenant_id = $1 AND deleted_at IS NULL";

    var SLA_BREACH_EXPR =
      "CASE " +
      "  WHEN status NOT IN ('closed','cancelled') AND priority='P1' AND received_at < NOW() - INTERVAL '3 days' THEN 1 " +
      "  WHEN status NOT IN ('closed','cancelled') AND priority='P2' AND received_at < NOW() - INTERVAL '7 days' THEN 1 " +
      "  WHEN status NOT IN ('closed','cancelled') AND priority='P3' AND received_at < NOW() - INTERVAL '14 days' THEN 1 " +
      "  WHEN status NOT IN ('closed','cancelled') AND priority='P4' AND received_at < NOW() - INTERVAL '30 days' THEN 1 " +
      "  ELSE 0 END";

    var [curR, prevR, topCatR, topCustR, openCritR] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS new_count, " +
        "COUNT(*) FILTER (WHERE status='closed')::int AS closed_count, " +
        "COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - received_at))/3600.0) FILTER (WHERE status='closed' AND closed_at IS NOT NULL),0)::numeric(10,2) AS mttr_h, " +
        "COALESCE(SUM(" + SLA_BREACH_EXPR + "),0)::int AS sla_breach " +
        "FROM as_tickets WHERE " + BASE + " AND received_at >= $2 AND received_at <= $3",
        [tid, weekAgo.toISOString(), now.toISOString()]),
      db.query("SELECT COUNT(*)::int AS new_count, " +
        "COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - received_at))/3600.0) FILTER (WHERE status='closed' AND closed_at IS NOT NULL),0)::numeric(10,2) AS mttr_h " +
        "FROM as_tickets WHERE " + BASE + " AND received_at >= $2 AND received_at <= $3",
        [tid, twoWeeksAgo.toISOString(), weekAgo.toISOString()]),
      db.query("SELECT category, COUNT(*)::int AS c FROM as_tickets " +
        "WHERE " + BASE + " AND received_at >= $2 AND category IS NOT NULL GROUP BY category ORDER BY c DESC LIMIT 3",
        [tid, weekAgo.toISOString()]),
      db.query("SELECT customer_name, COUNT(*)::int AS c FROM as_tickets " +
        "WHERE " + BASE + " AND received_at >= $2 AND customer_name <> '' GROUP BY customer_name ORDER BY c DESC LIMIT 3",
        [tid, weekAgo.toISOString()]),
      db.query("SELECT ticket_no, priority, customer_name FROM as_tickets " +
        "WHERE " + BASE + " AND status NOT IN ('closed','cancelled') AND priority IN ('P1','P2') ORDER BY received_at ASC LIMIT 5",
        [tid])
    ]);

    var c = curR.rows[0] || {};
    var pr = prevR.rows[0] || {};
    var dPct = pctDelta(c.new_count || 0, pr.new_count || 0);

    var lines = [];
    lines.push('📊 <b>A/S 주간 요약</b> (' + weekAgo.toISOString().slice(0, 10) + ' ~ ' + now.toISOString().slice(0, 10) + ')');
    lines.push('');
    lines.push('🆕 신규 ' + (c.new_count || 0) + '건' + (dPct != null ? ' (전주 대비 ' + (dPct > 0 ? '+' : '') + dPct + '%)' : ''));
    lines.push('✅ 종결 ' + (c.closed_count || 0) + '건');
    if (c.mttr_h) lines.push('⏱️ 평균 처리 ' + Number(c.mttr_h).toFixed(1) + 'h' + (pr.mttr_h ? ' (전주 ' + Number(pr.mttr_h).toFixed(1) + 'h)' : ''));
    lines.push('🚨 SLA 위반 ' + (c.sla_breach || 0) + '건');

    if (topCatR.rows.length) {
      lines.push('');
      lines.push('<b>📌 주요 카테고리</b>');
      topCatR.rows.forEach(function (r) { lines.push('  • ' + (r.category || '-') + ' ' + r.c + '건'); });
    }
    if (topCustR.rows.length) {
      lines.push('');
      lines.push('<b>🎯 최다 발생 고객</b>');
      topCustR.rows.forEach(function (r) { lines.push('  • ' + r.customer_name + ' ' + r.c + '건'); });
    }
    if (openCritR.rows.length) {
      lines.push('');
      lines.push('<b>🔴 P1/P2 미해결 (최대 5건)</b>');
      openCritR.rows.forEach(function (r) {
        lines.push('  • [' + r.ticket_no + '] ' + r.priority + ' · ' + (r.customer_name || '-'));
      });
    }

    var content = lines.join('\n');
    var send = (req.query.send === '1' || req.query.send === 'true');
    var sentTo = 0;
    if (send) {
      var adminR = await db.query(
        "SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' AND status = 'active'",
        [tid]
      );
      var ids = adminR.rows.map(function (u) { return u.id; });
      if (ids.length) {
        await notificationService.notify('as_weekly_digest', { content: content }, ids);
        sentTo = ids.length;
      }
    }

    res.json({
      data: { content: content, sentTo: sentTo, send: send },
      message: send ? '주간 요약을 ' + sentTo + '명에게 발송했습니다.' : '주간 요약 텍스트 생성됨 (send=1 옵션으로 텔레그램 발송 가능)'
    });
  } catch (e) {
    console.error('[as-stats/weekly-digest]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
});

module.exports = router;
