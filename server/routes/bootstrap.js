/**
 * GET /api/bootstrap?recentDays=60
 *
 * 초기 페이지 로드 시 필요한 여러 리소스(projects, milestones, events, recent archives)를
 * 단일 응답으로 반환하여 N × RTT → 1 × RTT 로 압축.
 * 각 쿼리는 서버에서 Promise.all로 병렬 실행됨.
 * 기존 개별 엔드포인트는 그대로 유지 (후속 캐시 무효화 시 부분 재조회용).
 */

var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var ps = require('../middleware/project-scope');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

router.get('/', async function (req, res) {
  try {
    var recentDays = Math.max(1, Math.min(365, parseInt(req.query.recentDays, 10) || 60));
    var role = req.user.role;
    var userId = req.user.sub;
    var deptId = req.user.departmentId || null;
    var tenantId = req.tenant.id;

    // cutoff: YYYYMMDD
    var t = new Date(); t.setDate(t.getDate() - recentDays);
    var cutoff = t.getFullYear() + String(t.getMonth() + 1).padStart(2, '0') + String(t.getDate()).padStart(2, '0');

    // ── projects (가시성 정책 v13.31~ — 모든 role에 동일 룰 적용) ──
    // owner / project_members(active) / visibility='tenant' / (visibility='dept' AND 부서 일치)
    var projVis = "(p.owner_id = $1 OR pm.user_id IS NOT NULL OR p.visibility = 'tenant'"
      + (deptId ? " OR (p.visibility = 'dept' AND p.department_id = $3)" : "")
      + ")";
    var projParams = deptId ? [userId, tenantId, deptId] : [userId, tenantId];
    var projQ = db.query(
      'SELECT DISTINCT p.* FROM projects p LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $1 AND pm.released_at IS NULL ' +
      'WHERE p.tenant_id = $2 AND ' + projVis + ' ORDER BY p.created_at DESC LIMIT 500',
      projParams
    );

    // ── milestones (v13.34 가시성: 접근 가능한 프로젝트만) ──
    var msSub = ps.accessibleProjectsSubquery(req, 2);
    var msQ = db.query(
      'SELECT * FROM milestones WHERE tenant_id = $1 AND project_id IN (' + msSub.sql + ') ORDER BY sort_order, start_date LIMIT 2000',
      [tenantId].concat(msSub.params)
    );
    // ── events (v13.34 가시성: project_ids에 접근 가능 항목 있거나 본인이 만든 개인 일정) ──
    // params 구성: $1=tenantId, $2=userId, $3..=accessible subquery 파라미터
    var evSub = ps.accessibleProjectsSubquery(req, 3);
    var evSql = 'SELECT * FROM events WHERE tenant_id = $1 AND ('
      + '(jsonb_array_length(COALESCE(project_ids, \'[]\'::jsonb)) = 0 AND created_by = $2)'
      + ' OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(project_ids, \'[]\'::jsonb)) AS _pid WHERE _pid IN (' + evSub.sql + '))'
      + ') ORDER BY start_date DESC LIMIT 2000';
    var evQ = db.query(evSql, [tenantId, userId].concat(evSub.params));

    // ── recent archives (role-aware, date cutoff) ──
    var arWhere, arParams;
    if ((role === 'manager' || role === 'executive') && deptId) {
      arWhere = 'WHERE tenant_id = $1 AND user_id IN (SELECT id FROM users WHERE department_id = $2) AND date >= $3';
      arParams = [tenantId, deptId, cutoff];
    } else if (role === 'admin') {
      arWhere = 'WHERE tenant_id = $1 AND date >= $2';
      arParams = [tenantId, cutoff];
    } else {
      arWhere = 'WHERE tenant_id = $1 AND user_id = $2 AND date >= $3';
      arParams = [tenantId, userId, cutoff];
    }
    // milestone_id 컬럼 존재 여부 (마이그레이션 전 배포 호환)
    var colCheckQ = db.query("SELECT 1 FROM information_schema.columns WHERE table_name='work_records' AND column_name='milestone_id'");

    var colCheck = await colCheckQ;
    var hasMs = colCheck.rows.length > 0;
    var cols = 'id, date, name, order_no, hours, task_type, abbr, content, ocmt, oclient' + (hasMs ? ', milestone_id' : '');
    var arQ = db.query('SELECT ' + cols + ' FROM work_records ' + arWhere + ' ORDER BY date DESC LIMIT 50000', arParams);

    var results = await Promise.all([projQ, msQ, evQ, arQ]);

    res.setHeader('Cache-Control', 'private, no-cache');
    res.json({
      projects: results[0].rows,
      milestones: results[1].rows,
      events: results[2].rows,
      archives: { data: results[3].rows, cutoff: cutoff, recentDays: recentDays }
    });
  } catch (e) {
    console.error('[bootstrap]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
