var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var rbac = require('../middleware/rbac');
var lock = require('../middleware/optimistic-lock');
var { parsePagination } = require('../middleware/pagination');
var notificationService = require('../services/notification.service');
var authService = require('../services/auth.service');
var tenant = require('../middleware/tenant');
var operator = require('../middleware/operator');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ─── 가시성 정책 (v13.31~) ───
// 정책: 기본 비공개. 생성자(owner) + project_members(active) + visibility 일치(tenant/dept)만 노출.
// admin/executive 역할도 동일 룰을 따름 — 우회 없음. (관리자는 명시 공유 또는 가시성 변경으로 접근권 획득)
//
// 단일 프로젝트 행에 대한 접근권 판정. 멤버 조회는 옵션(이미 캐시된 경우 전달).
async function canAccessProject(req, project, opts) {
  if (!project) return false;
  if (req.user.role === 'admin') return true;   // 관리자: 전체 프로젝트 접근/수정
  var userId = req.user.sub;
  var deptId = req.user.departmentId || null;
  if (project.owner_id === userId) return true;
  if (project.visibility === 'tenant') return true;
  if (project.visibility === 'dept' && deptId && project.department_id === deptId) return true;
  // project_members(active) 체크
  if (opts && opts.isMember === true) return true;
  // 부여된 운영자: 읽기 접근 허용 (멤버 아님 확정 전에 체크)
  try { if (operator && operator.isOperator && await operator.isOperator(req)) return true; } catch (_) {}
  if (opts && opts.isMember === false) return false; // 이미 부정 확인
  var mr = await db.query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND released_at IS NULL LIMIT 1', [project.id, userId]);
  return mr.rows.length > 0;
}

// ─── 편집/삭제 권한 (v13.145) ───
// 읽기(canAccessProject)는 가시성(공개)으로도 허용되지만, **편집/삭제는** 가시성만으로는 불가.
// 생성자(owner) · 참여자(project_members active) · 관리자(admin/executive)만 허용.
// (운영자·전체공개·부서공개 가시성은 편집권 부여 안 함 — 보기는 가능, 수정은 불가)
async function canEditProject(req, project) {
  if (!project) return false;
  var role = req.user.role;
  if (role === 'admin' || role === 'executive') return true;   // 관리자 계층
  if (project.owner_id === req.user.sub) return true;          // 생성자
  var mr = await db.query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND released_at IS NULL LIMIT 1', [project.id, req.user.sub]);
  return mr.rows.length > 0;                                    // 활성 참여자
}

// ─── GET /api/projects ───
router.get('/', async function (req, res) {
  try {
    var userId = req.user.sub;
    var deptId = req.user.departmentId || null;
    var pg = parsePagination(req.query, 100);

    // 가시성 룰을 SQL에 인라인. 관리자(admin)는 테넌트 전체 접근.
    var visClause = (req.user.role === 'admin')
      ? "TRUE"
      : ("(p.owner_id = $1 OR pm.user_id IS NOT NULL OR p.visibility = 'tenant'"
        + (deptId ? " OR (p.visibility = 'dept' AND p.department_id = $3)" : "")
        + ")");
    var params = deptId
      ? [userId, req.tenant.id, deptId, pg.limit, pg.offset]
      : [userId, req.tenant.id, pg.limit, pg.offset];
    var r = await db.query(
      "SELECT DISTINCT p.*, COUNT(*) OVER() AS _total FROM projects p "
      + "LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $1 AND pm.released_at IS NULL "
      + "WHERE p.tenant_id = $2 AND " + visClause
      + " ORDER BY p.created_at DESC LIMIT $" + (deptId ? 4 : 3) + " OFFSET $" + (deptId ? 5 : 4),
      params
    );

    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    console.error('[projects/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── GET /api/projects/all — 운영자 전용 전체 프로젝트 (가시성 우회) ───
//  (반드시 /:id 보다 먼저 정의 — /all 이 /:id 로 매칭되지 않도록)
router.get('/all', operator.requireOperator, async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM projects WHERE tenant_id = $1 ORDER BY created_at DESC', [req.tenant.id]);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[projects/all]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── GET /api/projects/members/all — 테넌트 전체 활성 멤버 (project_id, user_name) 일괄 조회 ───
//  (반드시 /:id 보다 먼저 정의 — 경로 충돌 방지)
router.get('/members/all', async function (req, res) {
  try {
    var r = await db.query(
      "SELECT pm.project_id, u.name AS user_name FROM project_members pm " +
      "JOIN users u ON pm.user_id = u.id " +
      "JOIN projects p ON pm.project_id = p.id " +
      "WHERE p.tenant_id = $1 AND pm.released_at IS NULL",
      [req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[projects/members/all]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── GET /api/projects/:id ───
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
    var p = r.rows[0];
    var allowed = await canAccessProject(req, p);
    if (!allowed) return res.status(403).json({ error: 'FORBIDDEN', message: '이 프로젝트에 접근 권한이 없습니다.' });
    res.json({ data: p });
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
    var visibility = b.visibility || 'private';
    if (['private','dept','tenant'].indexOf(visibility) === -1) visibility = 'private';
    var ownerId = b.ownerId || b.owner_id || req.user.sub;
    var r = await db.query(
      "INSERT INTO projects (id, order_no, name, start_date, end_date, status, progress, estimated_hours, assignees, dependencies, color, memo, current_phase, phases, created_by, updated_by, department_id, tenant_id, owner_id, visibility) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17,$18,$19) RETURNING *",
      [id, b.orderNo || b.order_no || '', b.name || '', b.startDate || b.start_date || '', b.endDate || b.end_date || '',
       b.status || 'active', b.progress || 0, b.estimatedHours || b.estimated_hours || 0,
       JSON.stringify(b.assignees || []), JSON.stringify(b.dependencies || []),
       b.color || '#3B82F6', b.memo || '', b.currentPhase || b.current_phase || 'order',
       JSON.stringify(b.phases || {}), req.user.sub, deptId, req.tenant.id, ownerId, visibility]
    );
    res.status(201).json({ data: r.rows[0] });

    // 감사 로그 + 이해관계자 알림 (best-effort)
    try {
      authService.auditLog(req.user.sub, 'project.create', 'project', r.rows[0].id, { name: r.rows[0].name }, req).catch(function () {});
    } catch (_) {}
    try {
      notificationService.notifyAdmins('project_created', {
        projectName: r.rows[0].name, orderNo: r.rows[0].order_no
      }).catch(function (e) { console.error('[noti]', e.message); });
    } catch (_) {}
  } catch (e) {
    console.error('[projects/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── PUT /api/projects/:id ───
router.put('/:id', rbac.checkPermission('project.edit'), async function (req, res) {
  try {
    // 가시성 사전 체크 — RBAC 권한이 있어도 보이지 않는 프로젝트는 편집 불가
    var preR = await db.query('SELECT id, owner_id, visibility, department_id FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!preR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
    if (!await canEditProject(req, preR.rows[0])) return res.status(403).json({ error: 'FORBIDDEN', message: '생성자·참여자·관리자만 프로젝트를 편집할 수 있습니다.' });

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
      phases: b.phases !== undefined ? JSON.stringify(b.phases) : undefined,
      visibility: (function () {
        var v = b.visibility;
        if (v === undefined) return undefined;
        return ['private','dept','tenant'].indexOf(v) !== -1 ? v : undefined;
      })()
    };
    // undefined 제거
    var clean = {};
    for (var k in updates) { if (updates[k] !== undefined) clean[k] = updates[k]; }

    // 변경 비교용 이전 값 조회 (실제 변경된 필드만 알림 → 무의미 중복 방지)
    var prev = null;
    try {
      var prevR = await db.query('SELECT status, name, order_no, end_date, start_date, progress, estimated_hours, current_phase, visibility, assignees, memo FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
      prev = prevR.rows[0] || null;
    } catch (e) { /* ignore */ }

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

    // 실제 변경된 필드만 추려 감사 로그 + 수정 알림 (best-effort, 무의미 중복 방지)
    try {
      var updRow = result.row || {};
      var _labels = { status: '상태', progress: '진척률', start_date: '시작일', end_date: '종료일', estimated_hours: '예상시간', current_phase: '단계', name: '이름', visibility: '가시성', order_no: '수주번호' };
      var _changes = [];
      if (prev) {
        Object.keys(_labels).forEach(function (k) {
          if (clean[k] === undefined) return;
          var nv = (clean[k] == null ? '' : String(clean[k]));
          var ov = (prev[k] == null ? '' : String(prev[k]));
          if (nv !== ov) _changes.push(_labels[k] + ' ' + (ov ? ov + '→' : '') + nv);
        });
        if (clean.assignees !== undefined) {
          var _nA = clean.assignees;  // 이미 JSON.stringify 됨
          var _oA = prev.assignees == null ? '[]' : (typeof prev.assignees === 'string' ? prev.assignees : JSON.stringify(prev.assignees));
          if (_nA !== _oA) _changes.push('담당자 변경');
        }
        if (clean.memo !== undefined && String(clean.memo || '') !== String(prev.memo || '')) _changes.push('메모 변경');
      } else {
        _changes = Object.keys(clean).map(function (k) { return _labels[k] || k; });
      }
      // 실제 변경이 있을 때만 로그·알림 (no-op 저장은 스킵)
      if (_changes.length) {
        try { authService.auditLog(req.user.sub, 'project.update', 'project', req.params.id, { changes: _changes }, req).catch(function () {}); } catch (_e) {}
        notificationService.notifyAdmins('project_updated', {
          projectName: updRow.name, orderNo: updRow.order_no, summary: _changes.join(' · ')
        }).catch(function (e) { console.error('[noti]', e.message); });
      }
    } catch (_) {}
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
      var fullVisibility = b.visibility || 'private';
      if (['private','dept','tenant'].indexOf(fullVisibility) === -1) fullVisibility = 'private';
      var fullOwnerId = b.ownerId || b.owner_id || req.user.sub;
      var pr = await client.query(
        "INSERT INTO projects (id, order_no, name, start_date, end_date, status, progress, estimated_hours, assignees, dependencies, color, memo, current_phase, phases, created_by, updated_by, tenant_id, owner_id, visibility) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17,$18) RETURNING *",
        [projId, b.orderNo || b.order_no || '', b.name || '', b.startDate || b.start_date || '', b.endDate || b.end_date || '',
         b.status || 'active', b.progress || 0, b.estimatedHours || b.estimated_hours || 0,
         JSON.stringify(b.assignees || []), JSON.stringify(b.dependencies || []),
         b.color || '#3B82F6', b.memo || '', b.currentPhase || b.current_phase || 'order',
         JSON.stringify(b.phases || {}), req.user.sub, req.tenant.id, fullOwnerId, fullVisibility]
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
    // 가시성 사전 체크 — RBAC 권한이 있어도 보이지 않는 프로젝트는 삭제 불가
    var preR = await db.query('SELECT id, owner_id, visibility, department_id FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!preR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
    if (!await canEditProject(req, preR.rows[0])) return res.status(403).json({ error: 'FORBIDDEN', message: '생성자·참여자·관리자만 프로젝트를 삭제할 수 있습니다.' });

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

// POST /api/projects/:id/transfer — 프로젝트 소유권 이관
//  - body: { newOwnerId, keepPrevAsMember? = true }
//  - 호출자는 현재 owner 또는 admin/executive 만 가능
router.post('/:id/transfer', async function (req, res) {
  try {
    var b = req.body || {};
    var newOwnerId = b.newOwnerId || b.new_owner_id;
    if (!newOwnerId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'newOwnerId 필수' });
    var keepPrev = b.keepPrevAsMember !== false;

    var pr = await db.query('SELECT id, owner_id, tenant_id, visibility, department_id FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!pr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
    var proj = pr.rows[0];

    // 소유권 이관은 현재 owner만 가능 — admin/executive 우회 제거 (v13.31)
    if (proj.owner_id !== req.user.sub) {
      return res.status(403).json({ error: 'FORBIDDEN', message: '현재 소유자만 이관할 수 있습니다.' });
    }

    // 신규 소유자가 같은 테넌트 사용자인지 확인
    var ur = await db.query('SELECT id FROM users WHERE id = $1 AND tenant_id = $2', [newOwnerId, req.tenant.id]);
    if (!ur.rows.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '대상 사용자가 없습니다.' });

    var prevOwner = proj.owner_id;
    await db.transaction(async function (client) {
      await client.query('UPDATE projects SET owner_id = $1, updated_by = $2, updated_at = now(), version = COALESCE(version,1) + 1 WHERE id = $3', [newOwnerId, req.user.sub, proj.id]);
      // 신규 소유자가 멤버로 들어가 있었다면 release 처리(중복 제거)
      await client.query("UPDATE project_members SET released_at = now() WHERE project_id = $1 AND user_id = $2 AND released_at IS NULL", [proj.id, newOwnerId]);
      // 기존 소유자를 assignee 멤버로 보존(옵션)
      if (keepPrev && prevOwner && prevOwner !== newOwnerId) {
        await client.query(
          "INSERT INTO project_members (project_id, user_id, role, assigned_by) VALUES ($1, $2, 'assignee', $3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'assignee', released_at = NULL, assigned_by = $3, assigned_at = now()",
          [proj.id, prevOwner, req.user.sub]
        );
      }
    });
    res.json({ message: '이관 완료', data: { id: proj.id, ownerId: newOwnerId, prevOwnerId: prevOwner } });
  } catch (e) {
    console.error('[projects/transfer]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── POST /api/projects/:id/copy — 프로젝트 사본 생성 (v13.146) ───
//  body: { name(필수), orderNo? }
//  내용·인원(활성 멤버)·마일스톤·목표시간·담당배정(정/부)을 동일하게 복사.
//  실행 실적(진척률/보고시간/이력/코멘트)은 초기화 — 새 진행을 위한 깨끗한 사본.
//  복사자가 새 프로젝트의 owner. 원본은 읽기 권한만 있으면 복사 가능.
router.post('/:id/copy', rbac.checkPermission('project.create'), async function (req, res) {
  try {
    var b = req.body || {};
    var newName = (b.name != null) ? String(b.name).trim() : '';
    if (!newName) return res.status(400).json({ error: 'BAD_REQUEST', message: '새 프로젝트 이름이 필요합니다.' });

    var srcR = await db.query('SELECT * FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!srcR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '원본 프로젝트를 찾을 수 없습니다.' });
    var src = srcR.rows[0];
    if (!await canAccessProject(req, src)) return res.status(403).json({ error: 'FORBIDDEN', message: '이 프로젝트에 접근 권한이 없습니다.' });

    var crypto = require('crypto');
    var newId = 'proj-' + crypto.randomUUID().slice(0, 12);
    var meId = req.user.sub;
    var deptId = req.user.departmentId || src.department_id || null;

    var copyResult = await db.transaction(async function (client) {
      // 1) 프로젝트 행 — 진척률은 0으로 초기화, 나머지 내용 동일. owner/생성자 = 복사자.
      await client.query(
        "INSERT INTO projects (id, order_no, name, start_date, end_date, status, progress, estimated_hours, assignees, dependencies, color, memo, current_phase, phases, created_by, updated_by, department_id, tenant_id, owner_id, visibility) " +
        "VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,$14,$17)",
        [newId, (b.orderNo != null ? String(b.orderNo) : ''), newName, src.start_date, src.end_date, src.status || 'active', src.estimated_hours || 0,
         JSON.stringify(src.assignees || []), JSON.stringify(src.dependencies || []), src.color || '#3B82F6', src.memo || '', src.current_phase || 'order',
         JSON.stringify(src.phases || {}), meId, deptId, req.tenant.id, src.visibility || 'private']
      );
      // 2) 활성 멤버(인원 할당) 복사
      var mem = await client.query('SELECT user_id, role FROM project_members WHERE project_id = $1 AND released_at IS NULL', [src.id]);
      for (var i = 0; i < mem.rows.length; i++) {
        await client.query(
          "INSERT INTO project_members (project_id, user_id, role, assigned_by) VALUES ($1,$2,$3,$4) ON CONFLICT (project_id, user_id) DO NOTHING",
          [newId, mem.rows[i].user_id, mem.rows[i].role || 'assignee', meId]
        );
      }
      // 3) 마일스톤 복사(진척 초기화) — old→new id 매핑
      var ms = await client.query('SELECT * FROM milestones WHERE project_id = $1 AND tenant_id = $2 ORDER BY sort_order', [src.id, req.tenant.id]);
      var idMap = {};
      for (var j = 0; j < ms.rows.length; j++) {
        var m = ms.rows[j];
        var nmid = 'ms-' + crypto.randomUUID().slice(0, 12);
        idMap[m.id] = nmid;
        await client.query(
          "INSERT INTO milestones (id, project_id, name, start_date, end_date, status, sort_order, assignee_targets, created_by, tenant_id) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [nmid, newId, m.name, m.start_date, m.end_date, m.status || 'waiting', m.sort_order || 0, JSON.stringify(m.assignee_targets || {}), meId, req.tenant.id]
        );
      }
      return { newId: newId, idMap: idMap };
    });

    // 4) 마일스톤 담당 배정(정/부) 복사 — best-effort(037 미배포 환경 호환). 임시대체(기간/covers)는 제외.
    try {
      var asg = await db.query(
        "SELECT milestone_id, user_id, role, target_hours FROM milestone_assignments WHERE project_id = $1 AND tenant_id = $2 AND released_at IS NULL AND covers_user_id IS NULL",
        [src.id, req.tenant.id]
      );
      for (var k = 0; k < asg.rows.length; k++) {
        var a = asg.rows[k];
        var nm = copyResult.idMap[a.milestone_id];
        if (!nm) continue;
        await db.query(
          "INSERT INTO milestone_assignments (id, tenant_id, milestone_id, project_id, user_id, role, target_hours, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          ['msa-' + require('crypto').randomUUID().slice(0, 12), req.tenant.id, nm, copyResult.newId, a.user_id, a.role || 'primary', a.target_hours, meId]
        );
      }
    } catch (e2) { console.warn('[projects/copy] 담당배정 복사 건너뜀:', e2.message); }

    // 5) 참고 이미지 복사 — best-effort(039 미배포 환경 호환)
    try {
      var imgs = await db.query('SELECT src, caption, sort_order FROM project_images WHERE project_id = $1 AND tenant_id = $2 ORDER BY sort_order, created_at', [src.id, req.tenant.id]);
      for (var ii = 0; ii < imgs.rows.length; ii++) {
        var im = imgs.rows[ii];
        await db.query(
          'INSERT INTO project_images (id, tenant_id, project_id, src, caption, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          ['pimg-' + require('crypto').randomUUID().slice(0, 12), req.tenant.id, copyResult.newId, im.src, im.caption, im.sort_order || ii, meId]
        );
      }
    } catch (e3) { console.warn('[projects/copy] 이미지 복사 건너뜀:', e3.message); }

    var nr = await db.query('SELECT * FROM projects WHERE id = $1 AND tenant_id = $2', [copyResult.newId, req.tenant.id]);
    res.status(201).json({ data: nr.rows[0] });
    try { authService.auditLog(req.user.sub, 'project.copy', 'project', copyResult.newId, { from: src.id, name: newName }, req); } catch (_) {}
  } catch (e) {
    console.error('[projects/copy]', e);
    if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── POST /api/projects/reorder — 표시 순서 일괄 갱신 (v13.152) ───
//  body: { items: [{ id, sortOrder }] }. 편집 권한(생성자·멤버·admin/executive) 있는 행만 반영(WHERE 인라인 enforce).
router.post('/reorder', async function (req, res) {
  try {
    var items = (req.body && req.body.items) || [];
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'BAD_REQUEST', message: 'items 필수' });
    var isAdmin = (req.user.role === 'admin' || req.user.role === 'executive');
    var n = 0;
    await db.transaction(async function (client) {
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.id) continue;
        var r = await client.query(
          "UPDATE projects SET sort_order = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3 " +
          "AND ($4 OR owner_id = $5 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $2 AND pm.user_id = $5 AND pm.released_at IS NULL))",
          [(it.sortOrder != null ? it.sortOrder : 0), it.id, req.tenant.id, isAdmin, req.user.sub]
        );
        n += r.rowCount || 0;
      }
    });
    res.json({ updated: n });
  } catch (e) {
    console.error('[projects/reorder]', e);
    if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   프로젝트 참고 이미지 (v13.147) — 장비 사진 등. 별도 테이블 project_images.
   읽기: canAccessProject(가시성 포함) / 쓰기: canEditProject(생성자·멤버·관리자)
   ═══════════════════════════════════════════════════════════════════════ */
var _IMG_MAX = 4 * 1024 * 1024; // src 1장 최대 4MB(다운스케일 후 data URI 기준)

async function _imgGate(req, res, needEdit) {
  var pr = await db.query('SELECT id, owner_id, visibility, department_id FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
  if (!pr.rows.length) { res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' }); return null; }
  var ok = needEdit ? await canEditProject(req, pr.rows[0]) : await canAccessProject(req, pr.rows[0]);
  if (!ok) { res.status(403).json({ error: 'FORBIDDEN', message: needEdit ? '생성자·참여자·관리자만 이미지를 변경할 수 있습니다.' : '접근 권한이 없습니다.' }); return null; }
  return pr.rows[0];
}

// GET /api/projects/:id/images — 참고 이미지 목록(순서대로)
router.get('/:id/images', async function (req, res) {
  try {
    if (await _imgGate(req, res, false) === null) return;
    var r = await db.query('SELECT id, project_id, src, caption, sort_order, created_at FROM project_images WHERE project_id = $1 AND tenant_id = $2 ORDER BY sort_order, created_at', [req.params.id, req.tenant.id]);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[projects/images/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/projects/:id/images — 이미지 추가(여러 장). body: { images:[{src, caption?}] }
router.post('/:id/images', async function (req, res) {
  try {
    if (await _imgGate(req, res, true) === null) return;
    var b = req.body || {};
    var arr = Array.isArray(b.images) ? b.images : (b.src ? [{ src: b.src, caption: b.caption }] : []);
    if (!arr.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '이미지가 없습니다.' });
    // 현재 최대 sort_order
    var mr = await db.query('SELECT COALESCE(MAX(sort_order), -1) AS mx FROM project_images WHERE project_id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    var ord = (mr.rows[0] && mr.rows[0].mx != null) ? (parseInt(mr.rows[0].mx, 10) + 1) : 0;
    var crypto = require('crypto');
    var saved = [];
    for (var i = 0; i < arr.length; i++) {
      var src = arr[i] && arr[i].src ? String(arr[i].src) : '';
      if (!src) continue;
      if (src.length > _IMG_MAX) return res.status(413).json({ error: 'TOO_LARGE', message: '이미지가 너무 큽니다(1장 4MB 이하).' });
      var id = 'pimg-' + crypto.randomUUID().slice(0, 12);
      var ir = await db.query(
        'INSERT INTO project_images (id, tenant_id, project_id, src, caption, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, project_id, caption, sort_order, created_at',
        [id, req.tenant.id, req.params.id, src, (arr[i].caption || null), ord++, req.user.sub]
      );
      saved.push(ir.rows[0]);
    }
    res.status(201).json({ data: saved });
    try { authService.auditLog(req.user.sub, 'project.image.add', 'project', req.params.id, { count: saved.length }, req); } catch (_) {}
  } catch (e) {
    console.error('[projects/images/add]', e);
    if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/projects/:id/images/:imgId
router.delete('/:id/images/:imgId', async function (req, res) {
  try {
    if (await _imgGate(req, res, true) === null) return;
    await db.query('DELETE FROM project_images WHERE id = $1 AND project_id = $2 AND tenant_id = $3', [req.params.imgId, req.params.id, req.tenant.id]);
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[projects/images/del]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
