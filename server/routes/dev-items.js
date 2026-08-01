/**
 * 프로젝트 개발 백로그 (칸반) 라우트 — PRD_프로젝트관리_확장 모듈 C
 * 계획된 개발 작업. 이슈(사후 장애/CS)와 분리.
 * 규약: 인증 + 테넌트 격리 + 접근가능 프로젝트 제한 + 낙관적 락(version) + 소프트 삭제.
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var ps = require('../middleware/project-scope');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var CATEGORIES = ['feature', 'improve', 'change', 'refactor', 'chore'];
var STATUSES = ['backlog', 'todo', 'doing', 'review', 'done'];
var PRIORITIES = ['high', 'normal', 'low'];

function genId() { return 'dev-' + require('crypto').randomUUID().slice(0, 12); }
function clampEnum(v, allowed, fallback) { return allowed.indexOf(v) >= 0 ? v : fallback; }
function toNum(v) { var n = parseFloat(v); return isNaN(n) || n < 0 ? 0 : n; }

// GET /api/dev-items?projectId=&status=&assigneeId=&mine=true
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM project_dev_items WHERE deleted_at IS NULL';
    var params = [];
    var idx = 1;
    sql += ' AND tenant_id = $' + idx++; params.push(req.tenant.id);
    if (req.query.projectId) { sql += ' AND project_id = $' + idx++; params.push(req.query.projectId); }
    if (req.query.status) { sql += ' AND status = $' + idx++; params.push(req.query.status); }
    if (req.query.assigneeId) { sql += ' AND assignee_id = $' + idx++; params.push(req.query.assigneeId); }
    if (req.query.mine === 'true') { sql += ' AND assignee_id = $' + idx++; params.push(req.user.sub); }
    // 접근 가능한 프로젝트로 제한
    var sub = ps.accessibleProjectsSubquery(req, idx);
    sql += ' AND project_id IN (' + sub.sql + ')';
    params = params.concat(sub.params);
    idx = sub.nextIdx;

    sql += ' ORDER BY status, sort_order, created_at';
    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function (row) { delete row._total; });
    res.json({ data: r.rows, total: total });
  } catch (e) {
    console.error('[dev-items/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/dev-items/:id
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM project_dev_items WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[dev-items/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/dev-items
router.post('/', async function (req, res) {
  try {
    var b = req.body;
    var projectId = b.projectId || b.project_id;
    if (!projectId || !b.title) return res.status(400).json({ error: 'VALIDATION', message: 'projectId·title 필수' });
    // 프로젝트가 호출자 테넌트 소속인지 확인
    var pR = await db.query('SELECT id FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, req.tenant.id]);
    if (!pR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });

    var id = b.id || genId();
    var r = await db.query(
      "INSERT INTO project_dev_items " +
      "(id, tenant_id, project_id, milestone_id, title, description, category, status, priority, assignee_id, estimate_h, actual_h, sort_order, created_by, updated_by) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *",
      [
        id, req.tenant.id, projectId, b.milestoneId || b.milestone_id || null,
        b.title, b.description || null,
        clampEnum(b.category, CATEGORIES, 'feature'),
        clampEnum(b.status, STATUSES, 'backlog'),
        clampEnum(b.priority, PRIORITIES, 'normal'),
        b.assigneeId || b.assignee_id || null,
        toNum(b.estimateH || b.estimate_h), toNum(b.actualH || b.actual_h),
        parseInt(b.sortOrder || b.sort_order, 10) || 0,
        req.user.sub
      ]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[dev-items/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/dev-items/:id — 필드 수정
router.put('/:id', async function (req, res) {
  try {
    var b = req.body;
    var sets = [];
    var params = [];
    var idx = 1;
    function set(col, val) { sets.push(col + ' = $' + idx++); params.push(val); }

    if (b.title !== undefined) set('title', b.title);
    if (b.description !== undefined) set('description', b.description);
    if (b.category !== undefined) set('category', clampEnum(b.category, CATEGORIES, 'feature'));
    if (b.status !== undefined) set('status', clampEnum(b.status, STATUSES, 'backlog'));
    if (b.priority !== undefined) set('priority', clampEnum(b.priority, PRIORITIES, 'normal'));
    if (b.assigneeId !== undefined || b.assignee_id !== undefined) set('assignee_id', b.assigneeId || b.assignee_id || null);
    if (b.milestoneId !== undefined || b.milestone_id !== undefined) set('milestone_id', b.milestoneId || b.milestone_id || null);
    if (b.estimateH !== undefined || b.estimate_h !== undefined) set('estimate_h', toNum(b.estimateH || b.estimate_h));
    if (b.actualH !== undefined || b.actual_h !== undefined) set('actual_h', toNum(b.actualH || b.actual_h));
    if (b.sortOrder !== undefined || b.sort_order !== undefined) set('sort_order', parseInt(b.sortOrder || b.sort_order, 10) || 0);
    if (!sets.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '수정할 항목이 없습니다.' });

    sets.push('updated_by = $' + idx++); params.push(req.user.sub);
    sets.push('updated_at = now()');
    sets.push('version = version + 1');
    params.push(req.params.id);
    var idIdx = idx++;
    params.push(req.tenant.id);
    var sql = 'UPDATE project_dev_items SET ' + sets.join(', ') + ' WHERE id = $' + idIdx + ' AND tenant_id = $' + idx + ' AND deleted_at IS NULL RETURNING *';
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[dev-items/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/dev-items/:id/move — 칸반 이동 (status + sort_order)
router.put('/:id/move', async function (req, res) {
  try {
    var status = clampEnum(req.body.status, STATUSES, null);
    if (!status) return res.status(400).json({ error: 'VALIDATION', message: 'status 필수 (' + STATUSES.join('/') + ')' });
    var sortOrder = parseInt(req.body.sortOrder || req.body.sort_order, 10) || 0;
    var r = await db.query(
      'UPDATE project_dev_items SET status = $1, sort_order = $2, updated_by = $3, updated_at = now(), version = version + 1 ' +
      'WHERE id = $4 AND tenant_id = $5 AND deleted_at IS NULL RETURNING *',
      [status, sortOrder, req.user.sub, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[dev-items/move]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/dev-items/:id — 소프트 삭제
router.delete('/:id', async function (req, res) {
  try {
    var r = await db.query(
      'UPDATE project_dev_items SET deleted_at = now(), deleted_by = $1 WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL RETURNING id',
      [req.user.sub, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[dev-items/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
