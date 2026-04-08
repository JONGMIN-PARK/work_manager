var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var rbac = require('../middleware/rbac');
var lock = require('../middleware/optimistic-lock');
var { parsePagination } = require('../middleware/pagination');
var notificationService = require('../services/notification.service');
var tenant = require('../middleware/tenant');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ─── GET /api/projects ───
router.get('/', async function (req, res) {
  try {
    var role = req.user.role;
    var userId = req.user.sub;
    var pg = parsePagination(req.query, 100);
    var r;

    var deptId = req.user.departmentId || null;
    if (role === 'admin' || role === 'executive') {
      // admin/executive: 전체 프로젝트
      r = await db.query('SELECT *, COUNT(*) OVER() AS _total FROM projects WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [req.tenant.id, pg.limit, pg.offset]);
    } else if (role === 'manager') {
      // manager: 소속 부서 프로젝트 + 본인이 멤버/PL인 프로젝트
      var mgrWhere = deptId
        ? "(p.department_id = $3 OR pm.user_id IS NOT NULL OR p.department_id IS NULL)"
        : "(pm.user_id IS NOT NULL OR p.department_id IS NULL)";
      var mgrParams = deptId
        ? [userId, req.tenant.id, deptId, pg.limit, pg.offset]
        : [userId, req.tenant.id, pg.limit, pg.offset];
      r = await db.query(
        "SELECT DISTINCT p.*, COUNT(*) OVER() AS _total FROM projects p LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $1 AND pm.released_at IS NULL WHERE p.tenant_id = $2 AND " + mgrWhere + " ORDER BY p.created_at DESC LIMIT $" + (deptId ? 4 : 3) + " OFFSET $" + (deptId ? 5 : 4),
        mgrParams
      );
    } else {
      // member: 소속 부서 프로젝트(읽기) + 배정된 프로젝트
      var memWhere = deptId
        ? "(p.department_id = $3 OR pm.user_id IS NOT NULL)"
        : "(pm.user_id IS NOT NULL OR p.department_id IS NULL)";
      var memParams = deptId
        ? [userId, req.tenant.id, deptId, pg.limit, pg.offset]
        : [userId, req.tenant.id, pg.limit, pg.offset];
      r = await db.query(
        "SELECT DISTINCT p.*, COUNT(*) OVER() AS _total FROM projects p LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $1 AND pm.released_at IS NULL WHERE p.tenant_id = $2 AND " + memWhere + " ORDER BY p.created_at DESC LIMIT $" + (deptId ? 4 : 3) + " OFFSET $" + (deptId ? 5 : 4),
        memParams
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
    var r = await db.query('SELECT * FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
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
    var deptId = b.departmentId || b.department_id || req.user.departmentId || null;
    var r = await db.query(
      "INSERT INTO projects (id, order_no, name, start_date, end_date, status, progress, estimated_hours, assignees, dependencies, color, memo, current_phase, phases, created_by, updated_by, department_id, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17) RETURNING *",
      [id, b.orderNo || b.order_no || '', b.name || '', b.startDate || b.start_date || '', b.endDate || b.end_date || '',
       b.status || 'active', b.progress || 0, b.estimatedHours || b.estimated_hours || 0,
       JSON.stringify(b.assignees || []), JSON.stringify(b.dependencies || []),
       b.color || '#3B82F6', b.memo || '', b.currentPhase || b.current_phase || 'order',
       JSON.stringify(b.phases || {}), req.user.sub, deptId, req.tenant.id]
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

    // 상태 변경 추적을 위해 이전 상태 조회
    var prevR = clean.status ? await db.query('SELECT status, name, order_no, end_date FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]) : null;
    var prev = prevR && prevR.rows[0] ? prevR.rows[0] : null;

    var result = await lock.optimisticUpdate(db, 'projects', 'id', req.params.id, b.version, clean, req.user.sub, { clause: 'AND tenant_id = $NEXT1', values: [req.tenant.id] });

    if (result.conflict) return lock.sendConflict(res, result.latest, result.yourVersion);
    if (!result.success) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });

    res.json({ data: result.row });

    // 텔레그램 알림: 프로젝트 지연
    try {
      if (clean.status === 'delayed' && prev && prev.status !== 'delayed') {
        notificationService.notifyProjectStakeholders('project_delayed', {
          name: prev.name, orderNo: prev.order_no, endDate: prev.end_date
        }, req.params.id).catch(function(e) { console.error('[noti]', e.message); });
      }
    } catch (_) { /* 알림 실패 무시 */ }
  } catch (e) {
    console.error('[projects/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── POST /api/projects/full — 프로젝트+마일스톤+체크리스트 일괄 생성 (트랜잭션) ───
router.post('/full', rbac.checkPermission('project.create'), async function (req, res) {
  try {
    var b = req.body;
    var projId = b.id || ('proj-' + require('crypto').randomUUID().slice(0, 12));
    var result = await db.transaction(async function (client) {
      // 1. 프로젝트 생성
      var pr = await client.query(
        "INSERT INTO projects (id, order_no, name, start_date, end_date, status, progress, estimated_hours, assignees, dependencies, color, memo, current_phase, phases, created_by, updated_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16) RETURNING *",
        [projId, b.orderNo || b.order_no || '', b.name || '', b.startDate || b.start_date || '', b.endDate || b.end_date || '',
         b.status || 'active', b.progress || 0, b.estimatedHours || b.estimated_hours || 0,
         JSON.stringify(b.assignees || []), JSON.stringify(b.dependencies || []),
         b.color || '#3B82F6', b.memo || '', b.currentPhase || b.current_phase || 'order',
         JSON.stringify(b.phases || {}), req.user.sub, req.tenant.id]
      );
      // 2. 마일스톤 일괄 생성
      var milestones = b.milestones || [];
      for (var i = 0; i < milestones.length; i++) {
        var m = milestones[i];
        var msId = m.id || ('ms-' + require('crypto').randomUUID().slice(0, 12));
        await client.query(
          "INSERT INTO milestones (id, project_id, name, start_date, end_date, status, sort_order, created_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [msId, projId, m.name || '', m.startDate || m.start_date || '', m.endDate || m.end_date || '', m.status || 'waiting', m.order || m.sort_order || i, req.user.sub, req.tenant.id]
        );
      }
      // 3. 체크리스트 일괄 생성
      var checklists = b.checklists || [];
      for (var j = 0; j < checklists.length; j++) {
        var c = checklists[j];
        var chkId = c.id || ('chk-' + require('crypto').randomUUID().slice(0, 12));
        await client.query(
          "INSERT INTO checklists (id, project_id, phase, items, created_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6)",
          [chkId, projId, c.phase || null, JSON.stringify(c.items || []), req.user.sub, req.tenant.id]
        );
      }
      return pr.rows[0];
    });
    res.status(201).json({ data: result });
  } catch (e) {
    console.error('[projects/full]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── DELETE /api/projects/:id ───
router.delete('/:id', rbac.checkPermission('project.delete'), async function (req, res) {
  try {
    var r = await db.query('DELETE FROM projects WHERE id = $1 AND tenant_id = $2 RETURNING id', [req.params.id, req.tenant.id]);
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
