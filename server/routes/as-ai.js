/**
 * A/S AI 보조 라우터 (Claude opus-4-7 기반) — v13.65
 *
 * POST /api/as-ai/analyze              — 신고 내용 → 카테고리·RCA·재발방지 초안
 * POST /api/as-ai/similar/:ticketId    — 유사 과거 사례 추천 (SQL 후보 + AI 점수)
 * GET  /api/as-ai/weekly-insight       — 주간 통계 자연어 코멘트
 *
 * Rate-limit: 사용자당 시간당 30회 (AI 호출 비용 보호)
 * 감사 로그: action='as.ai_<kind>' 기록
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var rateLimit = require('express-rate-limit');
var aiClaude = require('../services/ai-claude.service');
var authService = require('../services/auth.service');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// AI 호출 보호 — 사용자당 시간당 30회
var aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: function (req) { return (req.user && req.user.sub) || req.ip; },
  message: { error: 'RATE_LIMIT', message: 'AI 호출 한도(30/시간)를 초과했습니다. 잠시 후 다시 시도하세요.' },
  standardHeaders: true, legacyHeaders: false
});

function checkReady(res) {
  if (!aiClaude.isReady()) {
    res.status(503).json({
      error: 'AI_NOT_READY',
      message: 'AI 기능 미설정 — 서버의 ANTHROPIC_API_KEY 환경변수를 채운 뒤 재시작하세요.'
    });
    return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────
// POST /api/as-ai/analyze — 신고 내용 → 카테고리·RCA·재발방지 초안
// body: { issueSummary, customerName?, equipmentModel?, priority?, reproduction?, frequency?, frequencyCount?, impactScope? }
// ────────────────────────────────────────────────────────────
router.post('/analyze', aiLimiter, async function (req, res) {
  try {
    if (!checkReady(res)) return;
    var b = req.body || {};
    if (!b.issueSummary || !b.issueSummary.trim()) {
      return res.status(400).json({ error: 'VALIDATION', message: '신고 내용(issueSummary)을 입력하세요.' });
    }

    // 현재 테넌트의 활성 카테고리 목록 (AI 추정에 사용)
    var catR = await db.query(
      "SELECT code, label FROM as_categories WHERE tenant_id = $1 AND active = TRUE ORDER BY sort_order ASC LIMIT 30",
      [req.tenant.id]
    );

    var result = await aiClaude.analyzeTicket({
      issueSummary: b.issueSummary,
      customerName: b.customerName,
      equipmentModel: b.equipmentModel,
      priority: b.priority,
      reproduction: b.reproduction,
      frequency: b.frequency,
      frequencyCount: b.frequencyCount,
      impactScope: b.impactScope,
      categories: catR.rows
    });

    // audit (실패해도 응답엔 영향 없음)
    authService.auditLog(
      req.user.sub, 'as.ai_analyze', 'as_ticket', null,
      { len: b.issueSummary.length, usage: result.usage }, req
    ).catch(function () {});

    res.json({ data: result.data, usage: result.usage });
  } catch (e) {
    console.error('[as-ai/analyze]', e);
    res.status(500).json({ error: 'AI_FAILED', message: 'AI 분석 실패: ' + (e.message || '') });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/as-ai/similar/:ticketId — 유사 과거 사례 추천
// 1) SQL로 후보 10건 (같은 customer 또는 equipment 또는 카테고리, 종결된 것 우선)
// 2) Claude로 Top 3 점수·이유 부여
// ────────────────────────────────────────────────────────────
router.post('/similar/:ticketId', aiLimiter, async function (req, res) {
  try {
    if (!checkReady(res)) return;
    var tR = await db.query(
      "SELECT id, ticket_no, customer_name, equipment_model, category, issue_summary, serial_no, equipment_no " +
      "FROM as_tickets WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
      [req.params.ticketId, req.tenant.id]
    );
    if (!tR.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var t = tR.rows[0];

    // SQL 후보 — 우선순위: 같은 serial > 같은 equipment_no > 같은 customer+카테고리 > 같은 카테고리
    var candR = await db.query(
      "SELECT id, ticket_no, customer_name, equipment_model, category, issue_summary, rca, closure, " +
      "  CASE " +
      "    WHEN serial_no = $3 AND serial_no IS NOT NULL THEN 4 " +
      "    WHEN equipment_no = $4 AND equipment_no IS NOT NULL THEN 3 " +
      "    WHEN customer_name = $5 AND category = $6 THEN 2 " +
      "    WHEN category = $6 THEN 1 " +
      "    ELSE 0 END AS rank " +
      "FROM as_tickets " +
      "WHERE tenant_id = $1 AND id <> $2 AND deleted_at IS NULL " +
      "  AND (serial_no = $3 OR equipment_no = $4 OR customer_name = $5 OR category = $6) " +
      "ORDER BY rank DESC, status = 'closed' DESC, received_at DESC LIMIT 10",
      [req.tenant.id, t.id, t.serial_no, t.equipment_no, t.customer_name, t.category]
    );

    if (!candR.rows.length) {
      return res.json({ data: { top: [], summary: '같은 장비/고객/카테고리의 과거 사례가 없습니다 — 첫 사례입니다.' }, usage: null });
    }

    var result = await aiClaude.recommendSimilarCases(
      {
        ticketNo: t.ticket_no,
        customerName: t.customer_name,
        equipmentModel: t.equipment_model,
        category: t.category,
        issueSummary: t.issue_summary
      },
      candR.rows.map(function (c) {
        return {
          ticketNo: c.ticket_no,
          customerName: c.customer_name,
          equipmentModel: c.equipment_model,
          category: c.category,
          issueSummary: c.issue_summary,
          rca: c.rca,
          closure: c.closure
        };
      })
    );

    authService.auditLog(
      req.user.sub, 'as.ai_similar', 'as_ticket', t.id,
      { candidates: candR.rows.length, usage: result.usage }, req
    ).catch(function () {});

    res.json({ data: result.data, candidates: candR.rows.length, usage: result.usage });
  } catch (e) {
    console.error('[as-ai/similar]', e);
    res.status(500).json({ error: 'AI_FAILED', message: 'AI 유사 사례 분석 실패: ' + (e.message || '') });
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/as-ai/weekly-insight — 통계 데이터 → 자연어 코멘트
// 캐싱: 같은 테넌트는 1시간 캐시 (AI 비용 절감)
// ────────────────────────────────────────────────────────────
var ttlCache = require('../services/ttl-cache.service');
var _insightCache = ttlCache.create({ ttlMs: 60 * 60 * 1000, max: 50 });

router.get('/weekly-insight', aiLimiter, async function (req, res) {
  try {
    if (!checkReady(res)) return;
    var ck = req.tenant.id + '|' + (req.query.from || '') + '|' + (req.query.to || '');
    var cached = _insightCache.get(ck);
    if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(cached); }
    res.setHeader('X-Cache', 'MISS');

    // 통계 데이터는 as-stats 라우터를 호출하지 않고 직접 모음
    var now = new Date();
    var weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    var twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
    var BASE = "tenant_id = $1 AND deleted_at IS NULL";

    var [curR, prevR, catR, custR, openR] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS new_count, COUNT(*) FILTER (WHERE status='closed')::int AS closed_count, " +
        "COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - received_at))/3600.0) FILTER (WHERE status='closed' AND closed_at IS NOT NULL),0)::numeric(10,2) AS mttr_h " +
        "FROM as_tickets WHERE " + BASE + " AND received_at >= $2 AND received_at <= $3",
        [req.tenant.id, weekAgo.toISOString(), now.toISOString()]),
      db.query("SELECT COUNT(*)::int AS new_count, " +
        "COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - received_at))/3600.0) FILTER (WHERE status='closed' AND closed_at IS NOT NULL),0)::numeric(10,2) AS mttr_h " +
        "FROM as_tickets WHERE " + BASE + " AND received_at >= $2 AND received_at <= $3",
        [req.tenant.id, twoWeeksAgo.toISOString(), weekAgo.toISOString()]),
      db.query("SELECT category, COUNT(*)::int AS c FROM as_tickets WHERE " + BASE + " AND received_at >= $2 GROUP BY category ORDER BY c DESC LIMIT 5",
        [req.tenant.id, weekAgo.toISOString()]),
      db.query("SELECT customer_name, COUNT(*)::int AS c FROM as_tickets WHERE " + BASE + " AND received_at >= $2 AND customer_name <> '' GROUP BY customer_name ORDER BY c DESC LIMIT 5",
        [req.tenant.id, weekAgo.toISOString()]),
      db.query("SELECT ticket_no, priority, customer_name, received_at FROM as_tickets WHERE " + BASE + " AND status NOT IN ('closed','cancelled') AND priority IN ('P1','P2') ORDER BY received_at ASC LIMIT 5",
        [req.tenant.id])
    ]);

    var stats = {
      period: { from: weekAgo.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
      this_week: curR.rows[0],
      last_week: prevR.rows[0],
      top_categories: catR.rows,
      top_customers: custR.rows,
      p1p2_open: openR.rows
    };

    var result = await aiClaude.summarizeWeeklyStats(stats);
    var payload = { data: result.data, stats: stats, usage: result.usage, generatedAt: new Date().toISOString() };
    _insightCache.set(ck, payload);

    authService.auditLog(req.user.sub, 'as.ai_weekly_insight', null, null, { usage: result.usage }, req).catch(function () {});

    res.json(payload);
  } catch (e) {
    console.error('[as-ai/weekly-insight]', e);
    res.status(500).json({ error: 'AI_FAILED', message: 'AI 코멘트 생성 실패: ' + (e.message || '') });
  }
});

// 상태 확인 (관리자 디버그용)
router.get('/_status', function (req, res) {
  res.json({
    ready: aiClaude.isReady(),
    model: require('../config').ai.anthropicModel,
    cacheStats: _insightCache.stats()
  });
});

module.exports = router;
