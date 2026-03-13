var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var rbac = require('../middleware/rbac');
var lock = require('../middleware/optimistic-lock');
var { parsePagination } = require('../middleware/pagination');

router.use(auth.authenticate);

// ─── GET /api/projects ───
router.get('/', async function (req, res) {
  try {
    var role = req.user.role;
    var userId = req.user.sub;
    var pg = parsePagination(req.query, 100);
    var r;

    if (role === 'admin' || role === 'executive' || role === 'manager') {
      r = await db.query('SELECT *, COUNT(*) OVER() AS _total FROM projects ORDER BY created_at DESC LIMIT $1 OFFSET $2', [pg.limit, pg.offset]);
    } else {
      // member: 배정된 프로젝트만
      r = await db.query(
        "SELECT p.*, COUNT(*) OVER() AS _total FROM projects p INNER JOIN project_members pm ON p.id = pm.project_id WHERE pm.user_id = $1 AND pm.released_at IS NULL ORDER BY p.created_at DESC LIMIT $2 OFFSET $3",
        [userId, pg.limit, pg.offset]
      );
    }

    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    console.error('[projects/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── GET /api/projects/:id ───
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[projects/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── POST /api/projects ───
router.post('/', rbac.checkPermission('project.create'), async function (req, res) {
  try {
    var b = req.body;
    var id = b.id || ('proj-' + require('crypto').randomUUID().slice(0, 12));
    var r = await db.query(
      "INSERT INTO projects (id, order_no, name, start_date, end_date, status, progress, estimated_hours, assignees, dependencies, color, memo, current_phase, phases, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *",
      [id, b.orderNo || b.order_no || '', b.name || '', b.startDate || b.start_date || '', b.endDate || b.end_date || '',
       b.status || 'active', b.progress || 0, b.estimatedHours || b.estimated_hours || 0,
       JSON.stringify(b.assignees || []), JSON.stringify(b.dependencies || []),
       b.color || '#3B82F6', b.memo || '', b.currentPhase || b.current_phase || 'order',
       JSON.stringify(b.phases || {}), req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[projects/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── PUT /api/projects/:id ───
router.put('/:id', rbac.checkPermission('project.edit'), async function (req, res) {
  try {
    var b = req.body;
    var updates = {
      order_no: b.orderNo !== undefined ? b.orderNo : b.order_no,
      name: b.name,
      start_date: b.startDate !== undefined ? b.startDate : b.start_date,
      end_date: b.endDate !== undefined ? b.endDate : b.end_date,
      status: b.status,
      progress: b.progress,
      estimated_hours: b.estimatedHours !== undefined ? b.estimatedHours : b.estimated_hours,
      actual_hours: b.actualHours !== undefined ? b.actualHours : b.actual_hours,
      assignees: b.assignees !== undefined ? JSON.stringify(b.assignees) : undefined,
      dependencies: b.dependencies !== undefined ? JSON.stringify(b.dependencies) : undefined,
      color: b.color,
      memo: b.memo,
      current_phase: b.currentPhase !== undefined ? b.currentPhase : b.current_phase,
      phases: b.phases !== undefined ? JSON.stringify(b.phases) : undefined
    };
    // undefined 제거
    var clean = {};
    for (var k in updates) { if (updates[k] !== undefined) clean[k] = updates[k]; }

    var result = await lock.optimisticUpdate(db, 'projects', 'id', req.params.id, b.version, clean, req.user.sub);

    if (result.conflict) return lock.sendConflict(res, result.latest, result.yourVersion);
    if (!result.success) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });

    res.json({ data: result.row });
  } catch (e) {
    console.error('[projects/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── DELETE /api/projects/:id ───
router.delete('/:id', rbac.checkPermission('project.delete'), async function (req, res) {
  try {
    var r = await db.query('DELETE FROM projects WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[projects/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── 프로젝트 멤버 관리 ───

// GET /api/projects/:id/members
router.get('/:id/members', async function (req, res) {
  try {
    var r = await db.query(
      "SELECT pm.*, u.name as user_name, u.email, u.role as system_role FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = $1 AND pm.released_at IS NULL ORDER BY pm.role DESC, u.name",
      [req.params.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[projects/members]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/projects/:id/members — 멤버 추가
router.post('/:id/members', rbac.checkPermission('project.assign'), async function (req, res) {
  try {
    var b = req.body;
    var r = await db.query(
      "INSERT INTO project_members (project_id, user_id, role, assigned_by) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3, released_at = NULL, assigned_by = $4, assigned_at = now() RETURNING *",
      [req.params.id, b.userId, b.role || 'assignee', req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[projects/members/add]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/projects/:id/members/:userId — 멤버 해제
router.delete('/:id/members/:userId', rbac.checkPermission('project.assign'), async function (req, res) {
  try {
    await db.query(
      "UPDATE project_members SET released_at = now() WHERE project_id = $1 AND user_id = $2 AND released_at IS NULL",
      [req.params.id, req.params.userId]
    );
    res.json({ message: '멤버 해제 완료' });
  } catch (e) {
    console.error('[projects/members/remove]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
