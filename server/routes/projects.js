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
var pa = require('../lib/project-access');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ─── 가시성·편집 정책 — lib/project-access 에 단일 정의 ───
// 읽기(canAccessProject = pa.canRead): admin 전체 / owner · 활성 멤버 · visibility tenant·dept 일치 / 운영자
// 편집(canEditProject = pa.canEdit, v13.145): admin·executive · owner · 활성 멤버 (가시성만으로는 불가)
var canAccessProject = pa.canRead;
var canEditProject = pa.canEdit;
var gcs = require('../services/gcs.service');

/**
 * 프로젝트 1행 INSERT (POST / 와 POST /full 공용, v13.213).
 *  예전엔 두 곳에 INSERT 가 따로 있었고 /full 쪽은 department_id·specs 를 빠뜨려,
 *  /full 로 만든 visibility='dept' 프로젝트는 부서원에게 보이지 않았다.
 * @param q db 또는 트랜잭션 client
 */
async function insertProject(q, req, b) {
  var id = b.id || ('proj-' + require('crypto').randomUUID().slice(0, 12));
  var deptId = b.departmentId || b.department_id || req.user.departmentId || null;
  var visibility = b.visibility || 'private';
  if (['private','dept','tenant'].indexOf(visibility) === -1) visibility = 'private';
  var ownerId = b.ownerId || b.owner_id || req.user.sub;
  if (ownerId !== req.user.sub) {
    // 다른 사람을 생성자로 지정하면 같은 테넌트 사용자인지 확인 — 아니면 본인으로
    var ur = await q.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2', [ownerId, req.tenant.id]);
    if (!ur.rows.length) ownerId = req.user.sub;
  }
  var r = await q.query(
    "INSERT INTO projects (id, order_no, name, start_date, end_date, status, progress, estimated_hours, assignees, dependencies, color, memo, current_phase, phases, created_by, updated_by, department_id, tenant_id, owner_id, visibility, specs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17,$18,$19,$20) RETURNING *",
    [id, b.orderNo || b.order_no || '', b.name || '', b.startDate || b.start_date || '', b.endDate || b.end_date || '',
     b.status || 'active', b.progress || 0, b.estimatedHours || b.estimated_hours || 0,
     JSON.stringify(b.assignees || []), JSON.stringify(b.dependencies || []),
     b.color || '#3B82F6', b.memo || '', b.currentPhase || b.current_phase || 'order',
     JSON.stringify(b.phases || {}), req.user.sub, deptId, req.tenant.id, ownerId, visibility, JSON.stringify(b.specs || {})]
  );
  var row = r.rows[0];
  if (row) row.can_edit = req.user.role === 'admin' || req.user.role === 'executive' || row.owner_id === req.user.sub;
  return row;
}

function _afterProjectCreate(req, row) {
  // 감사 로그 + 이해관계자 알림 (best-effort)
  try {
    authService.auditLog(req.user.sub, 'project.create', 'project', row.id, { name: row.name }, req).catch(function () {});
  } catch (_) {}
  try {
    notificationService.notifyAdmins('project_created', {
      projectName: row.name, orderNo: row.order_no
    }, req.tenant.id).catch(function (e) { console.error('[noti]', e.message); });
  } catch (_) {}
}

// ─── GET /api/projects ───
router.get('/', async function (req, res) {
  try {
    var pg = parsePagination(req.query, 100);

    // 가시성 룰 (lib/project-access). 관리자(admin)는 테넌트 전체 접근.
    var vis = pa.visibleProjectsSql(req, 'p', 2);
    // can_edit: 화면이 편집 컨트롤(드래그·체크·삭제)을 숨길지 판단 (v13.213)
    var ed = pa.editableProjectsSql(req, 'p', vis.nextIdx);
    var r = await db.query(
      "SELECT p.*, (" + ed.sql + ") AS can_edit, COUNT(*) OVER() AS _total FROM projects p "
      + "WHERE p.tenant_id = $1 AND " + vis.sql
      + " ORDER BY p.sort_order ASC NULLS LAST, p.created_at DESC LIMIT $" + ed.nextIdx + " OFFSET $" + (ed.nextIdx + 1),
      [req.tenant.id].concat(vis.params, ed.params, [pg.limit, pg.offset])
    );

    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    httpErr.serverError(res, '[projects/list]', e);
  }
});

// ─── GET /api/projects/all — 운영자 전용 전체 프로젝트 (가시성 우회) ───
//  (반드시 /:id 보다 먼저 정의 — /all 이 /:id 로 매칭되지 않도록)
router.get('/all', operator.requireOperator, async function (req, res) {
  try {
    var ed = pa.editableProjectsSql(req, 'p', 2);
    var r = await db.query('SELECT p.*, (' + ed.sql + ') AS can_edit FROM projects p WHERE p.tenant_id = $1 ORDER BY p.sort_order ASC NULLS LAST, p.created_at DESC', [req.tenant.id].concat(ed.params));
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[projects/all]', e);
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
    httpErr.serverError(res, '[projects/members/all]', e);
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
    p.can_edit = await canEditProject(req, p);
    res.json({ data: p });
  } catch (e) {
    httpErr.serverError(res, '[projects/get]', e);
  }
});

// ─── POST /api/projects ───
router.post('/', rbac.checkPermission('project.create'), async function (req, res) {
  try {
    var row = await insertProject(db, req, req.body);
    res.status(201).json({ data: row });
    _afterProjectCreate(req, row);
  } catch (e) {
    httpErr.serverError(res, '[projects/create]', e);
  }
});

// ─── PUT /api/projects/:id ───
router.put('/:id', rbac.checkPermission('project.edit'), async function (req, res) {
  try {
    // 가시성 사전 체크 — RBAC 권한이 있어도 보이지 않는 프로젝트는 편집 불가.
    // 같은 조회로 변경 비교용 이전 값도 얻는다(실제 변경된 필드만 알림 → 무의미 중복 방지)
    var preR = await db.query('SELECT id, owner_id, visibility, department_id, status, name, order_no, end_date, start_date, progress, estimated_hours, current_phase, assignees, memo FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!preR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
    if (!await canEditProject(req, preR.rows[0])) return res.status(403).json({ error: 'FORBIDDEN', message: '생성자·참여자·관리자만 프로젝트를 편집할 수 있습니다.' });
    var prev = preR.rows[0];

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
      specs: b.specs !== undefined ? JSON.stringify(b.specs) : undefined,
      visibility: (function () {
        var v = b.visibility;
        if (v === undefined) return undefined;
        return ['private','dept','tenant'].indexOf(v) !== -1 ? v : undefined;
      })()
    };
    // undefined 제거
    var clean = {};
    for (var k in updates) { if (updates[k] !== undefined) clean[k] = updates[k]; }

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
        }, req.tenant.id).catch(function (e) { console.error('[noti]', e.message); });
      }
    } catch (_) {}
  } catch (e) {
    httpErr.serverError(res, '[projects/update]', e);
  }
});

// ─── POST /api/projects/full — 프로젝트+마일스톤+체크리스트 일괄 생성 (트랜잭션) ───
router.post('/full', rbac.checkPermission('project.create'), async function (req, res) {
  try {
    var b = req.body;
    var result = await db.transaction(async function (client) {
      // 1. 프로젝트 생성 (POST / 와 같은 INSERT)
      var proj = await insertProject(client, req, b);
      var projId = proj.id;
      // 2. 마일스톤 일괄 생성
      var milestones = b.milestones || [];
      for (var i = 0; i < milestones.length; i++) {
        var m = milestones[i];
        var msId = m.id || ('ms-' + require('crypto').randomUUID().slice(0, 12));
        await client.query(
          "INSERT INTO milestones (id, project_id, name, start_date, end_date, status, sort_order, created_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [msId, projId, m.name || '', m.startDate || m.start_date || '', m.endDate || m.end_date || '', m.status || 'waiting',
           (m.order != null ? m.order : (m.sort_order != null ? m.sort_order : i)), req.user.sub, req.tenant.id]
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
      return proj;
    });
    res.status(201).json({ data: result });
    _afterProjectCreate(req, result);
  } catch (e) {
    httpErr.serverError(res, '[projects/full]', e);
  }
});

// ─── DELETE /api/projects/:id ───
router.delete('/:id', rbac.checkPermission('project.delete'), async function (req, res) {
  try {
    // 가시성 사전 체크 — RBAC 권한이 있어도 보이지 않는 프로젝트는 삭제 불가
    var preR = await db.query('SELECT id, owner_id, visibility, department_id FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!preR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
    if (!await canEditProject(req, preR.rows[0])) return res.status(403).json({ error: 'FORBIDDEN', message: '생성자·참여자·관리자만 프로젝트를 삭제할 수 있습니다.' });

    // 딸린 데이터 정리를 권한 확인 뒤 한 트랜잭션으로 — 예전엔 화면이 이슈·마일스톤·일정·의존관계를
    // 한 건씩 지우고 고친 다음에 여기로 와서, 403 이 나도 자식 데이터는 이미 지워져 있었다.
    // 마일스톤·체크리스트·멤버 등은 FK ON DELETE CASCADE. issues.project_id 는 FK 가 없어 직접 지운다(대응 이력 issue_logs 는 issues 에서 CASCADE).
    // v13.213: 문서 파일·폴더도 여기서 지운다 — 예전엔 화면이 권한 확인 전에 파일(GCS)부터 지웠다.
    //  project_files/project_folders 는 projects 와 FK 가 없어 직접 지우고, GCS 원본은 커밋 뒤 best-effort.
    var id = req.params.id, tid = req.tenant.id;
    var storageKeys = [];
    var r = await db.transaction(async function (client) {
      var fr = await client.query('DELETE FROM project_files WHERE project_id = $1 AND tenant_id = $2 RETURNING storage_key', [id, tid]);
      storageKeys = fr.rows.map(function (x) { return x.storage_key; }).filter(Boolean);
      await client.query('DELETE FROM project_folders WHERE project_id = $1 AND tenant_id = $2', [id, tid]);
      await client.query('DELETE FROM issues WHERE project_id = $1 AND tenant_id = $2', [id, tid]);
      await client.query('UPDATE events SET project_ids = project_ids - $1::text WHERE tenant_id = $2 AND project_ids ? $1::text', [id, tid]);
      await client.query('UPDATE projects SET dependencies = dependencies - $1::text WHERE tenant_id = $2 AND dependencies ? $1::text', [id, tid]);
      return client.query('DELETE FROM projects WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, tid]);
    });
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
    res.json({ message: '삭제 완료', deletedFiles: storageKeys.length });
    if (storageKeys.length && gcs.isEnabled()) {
      storageKeys.forEach(function (sk) {
        gcs.deleteObject(sk).catch(function (e) { console.warn('[projects/delete] GCS delete failed:', e.message); });
      });
    }
  } catch (e) {
    httpErr.serverError(res, '[projects/delete]', e);
  }
});

// ─── 프로젝트 멤버 관리 ───

// GET /api/projects/:id/members
router.get('/:id/members', async function (req, res) {
  try {
    // 테넌트 소속 확인 — 다른 테넌트 프로젝트의 멤버 목록(이메일 포함) 노출 차단
    var own = await db.query('SELECT 1 FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!own.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
    var r = await db.query(
      "SELECT pm.*, u.name as user_name, u.email, u.role as system_role FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = $1 AND pm.released_at IS NULL ORDER BY pm.role DESC, u.name",
      [req.params.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[projects/members]', e);
  }
});

// POST /api/projects/:id/members — 멤버 추가
// 멤버 추가/해제 공통 게이트: 같은 테넌트 프로젝트 + 편집권(생성자·참여자·admin/executive).
// PUT/DELETE /:id 와 동일한 canEditProject 규칙을 따른다. 통과 시 project 행 반환, 실패 시 응답 후 null.
async function _memberGate(req, res) {
  var preR = await db.query('SELECT id, owner_id, visibility, department_id FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
  if (!preR.rows.length) { res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' }); return null; }
  if (!await canEditProject(req, preR.rows[0])) { res.status(403).json({ error: 'FORBIDDEN', message: '생성자·참여자·관리자만 멤버를 관리할 수 있습니다.' }); return null; }
  return preR.rows[0];
}

router.post('/:id/members', rbac.checkPermission('project.assign'), async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.userId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'userId 필수' });
    if (!await _memberGate(req, res)) return;
    // 추가 대상도 같은 테넌트 사용자여야 한다
    var ur = await db.query('SELECT id FROM users WHERE id = $1 AND tenant_id = $2', [b.userId, req.tenant.id]);
    if (!ur.rows.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '대상 사용자가 없습니다.' });
    var r = await db.query(
      "INSERT INTO project_members (project_id, user_id, role, assigned_by, tenant_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3, released_at = NULL, assigned_by = $4, assigned_at = now() RETURNING *",
      [req.params.id, b.userId, b.role || 'assignee', req.user.sub, req.tenant.id]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[projects/members/add]', e);
  }
});

// DELETE /api/projects/:id/members/:userId — 멤버 해제
router.delete('/:id/members/:userId', rbac.checkPermission('project.assign'), async function (req, res) {
  try {
    if (!await _memberGate(req, res)) return;
    await db.query(
      "UPDATE project_members SET released_at = now() WHERE project_id = $1 AND user_id = $2 AND released_at IS NULL",
      [req.params.id, req.params.userId]
    );
    res.json({ message: '멤버 해제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[projects/members/remove]', e);
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
          "INSERT INTO project_members (project_id, user_id, role, assigned_by, tenant_id) VALUES ($1, $2, 'assignee', $3, $4) ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'assignee', released_at = NULL, assigned_by = $3, assigned_at = now(), tenant_id = EXCLUDED.tenant_id",
          [proj.id, prevOwner, req.user.sub, req.tenant.id]
        );
      }
    });
    res.json({ message: '이관 완료', data: { id: proj.id, ownerId: newOwnerId, prevOwnerId: prevOwner } });
  } catch (e) {
    httpErr.serverError(res, '[projects/transfer]', e);
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
      //    행마다 INSERT 하던 루프 → INSERT ... SELECT 한 번. tenant_id 도 기록(예전엔 누락되어 DEFAULT 테넌트로 들어감).
      await client.query(
        "INSERT INTO project_members (project_id, user_id, role, assigned_by, tenant_id) " +
        "SELECT $1, user_id, COALESCE(NULLIF(role, ''), 'assignee'), $2, $3 FROM project_members WHERE project_id = $4 AND released_at IS NULL " +
        "ON CONFLICT (project_id, user_id) DO NOTHING",
        [newId, meId, req.tenant.id, src.id]
      );
      // 3) 마일스톤 복사(진척 초기화) — old→new id 매핑
      //    마일스톤별 INSERT 루프 → unnest 다중 행 INSERT 한 번 (새 id 는 JS 에서 생성해 매핑 유지)
      var ms = await client.query('SELECT * FROM milestones WHERE project_id = $1 AND tenant_id = $2 ORDER BY sort_order', [src.id, req.tenant.id]);
      var idMap = {};
      var mIds = [], mNames = [], mStarts = [], mEnds = [], mStatus = [], mSort = [], mTargets = [];
      for (var j = 0; j < ms.rows.length; j++) {
        var m = ms.rows[j];
        var nmid = 'ms-' + crypto.randomUUID().slice(0, 12);
        idMap[m.id] = nmid;
        mIds.push(nmid); mNames.push(m.name); mStarts.push(m.start_date); mEnds.push(m.end_date);
        mStatus.push(m.status || 'waiting'); mSort.push(m.sort_order || 0); mTargets.push(JSON.stringify(m.assignee_targets || {}));
      }
      if (mIds.length) {
        await client.query(
          "INSERT INTO milestones (id, project_id, name, start_date, end_date, status, sort_order, assignee_targets, created_by, tenant_id) " +
          "SELECT t.id, $8, t.name, t.s, t.e, t.status, t.ord, t.at::jsonb, $9, $10 " +
          "FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[]) WITH ORDINALITY AS t(id, name, s, e, status, ord, at, n) ORDER BY t.n",
          [mIds, mNames, mStarts, mEnds, mStatus, mSort, mTargets, newId, meId, req.tenant.id]
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
      // 행마다 INSERT 하던 루프 → unnest 다중 행 INSERT 한 번
      var aIds = [], aMs = [], aUsers = [], aRoles = [], aHours = [];
      for (var k = 0; k < asg.rows.length; k++) {
        var a = asg.rows[k];
        var nm = copyResult.idMap[a.milestone_id];
        if (!nm) continue;
        aIds.push('msa-' + require('crypto').randomUUID().slice(0, 12)); aMs.push(nm); aUsers.push(a.user_id);
        aRoles.push(a.role || 'primary'); aHours.push(a.target_hours == null ? null : String(a.target_hours));
      }
      if (aIds.length) {
        await db.query(
          "INSERT INTO milestone_assignments (id, tenant_id, milestone_id, project_id, user_id, role, target_hours, created_by) " +
          "SELECT t.id, $6, t.ms, $7, t.uid, t.role, t.hrs::numeric, $8 FROM unnest($1::text[], $2::text[], $3::uuid[], $4::text[], $5::text[]) AS t(id, ms, uid, role, hrs)",
          [aIds, aMs, aUsers, aRoles, aHours, req.tenant.id, copyResult.newId, meId]
        );
      }
    } catch (e2) { console.warn('[projects/copy] 담당배정 복사 건너뜀:', e2.message); }

    // 5) 참고 이미지 복사 — best-effort(039 미배포 환경 호환)
    try {
      var imgs = await db.query('SELECT src, caption, sort_order FROM project_images WHERE project_id = $1 AND tenant_id = $2 ORDER BY sort_order, created_at', [src.id, req.tenant.id]);
      // 행마다 INSERT 하던 루프 → unnest 다중 행 INSERT 한 번
      var iIds = [], iSrc = [], iCap = [], iOrd = [];
      for (var ii = 0; ii < imgs.rows.length; ii++) {
        var im = imgs.rows[ii];
        iIds.push('pimg-' + require('crypto').randomUUID().slice(0, 12)); iSrc.push(im.src); iCap.push(im.caption); iOrd.push(im.sort_order || ii);
      }
      if (iIds.length) {
        await db.query(
          'INSERT INTO project_images (id, tenant_id, project_id, src, caption, sort_order, created_by) ' +
          'SELECT t.id, $5, $6, t.src, t.cap, t.ord, $7 FROM unnest($1::text[], $2::text[], $3::text[], $4::int[]) AS t(id, src, cap, ord)',
          [iIds, iSrc, iCap, iOrd, req.tenant.id, copyResult.newId, meId]
        );
      }
    } catch (e3) { console.warn('[projects/copy] 이미지 복사 건너뜀:', e3.message); }

    var nr = await db.query('SELECT * FROM projects WHERE id = $1 AND tenant_id = $2', [copyResult.newId, req.tenant.id]);
    res.status(201).json({ data: nr.rows[0] });
    try { authService.auditLog(req.user.sub, 'project.copy', 'project', copyResult.newId, { from: src.id, name: newName }, req); } catch (_) {}
  } catch (e) {
    httpErr.serverError(res, '[projects/copy]', e);
  }
});

// ─── PUT /api/projects/:id/specs — 사양서 저장 (v13.160, v13.196 표준 사양서) ───
//  body: { specs }. 최종 수정자/시각 기록.
//  v13.196: 설계·전장·SW 가 함께 채우도록 참여자(멤버)도 편집 가능 — canEditProject(생성자·참여자·관리자·임원).
//  (v13.160~195 는 생성자 + admin/executive 만이었다)
var _SPECS_MAX = 2 * 1024 * 1024;
router.put('/:id/specs', async function (req, res) {
  try {
    var pr = await db.query('SELECT id, owner_id FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!pr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
    if (!(await canEditProject(req, pr.rows[0]))) {
      return res.status(403).json({ error: 'FORBIDDEN', message: '생성자·참여자·관리자만 사양서를 수정할 수 있습니다.' });
    }
    var specs = (req.body && req.body.specs) || {};
    if (typeof specs !== 'object' || Array.isArray(specs)) return res.status(400).json({ error: 'VALIDATION', message: '사양서 형식 오류' });
    if (JSON.stringify(specs).length > _SPECS_MAX) return res.status(413).json({ error: 'TOO_LARGE', message: '사양서가 너무 큽니다(2MB 이하).' });
    // 수정자명
    var byName = req.user.name || '';
    try { var ar = await db.query('SELECT name, display_name FROM users WHERE id = $1', [req.user.sub]); if (ar.rows.length) byName = ar.rows[0].display_name || ar.rows[0].name || byName; } catch (_) {}
    var r = await db.query(
      'UPDATE projects SET specs = $1, specs_updated_by = $2, specs_updated_at = now(), updated_at = now() WHERE id = $3 AND tenant_id = $4 RETURNING specs, specs_updated_by, specs_updated_at',
      [JSON.stringify(specs), byName, req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows[0], message: '사양이 저장되었습니다.' });
    try { authService.auditLog(req.user.sub, 'project.specs.update', 'project', req.params.id, {}, req); } catch (_) {}
  } catch (e) {
    httpErr.serverError(res, '[projects/specs/update]', e);
  }
});

// ─── POST /api/projects/reorder — 표시 순서 일괄 갱신 (v13.152) ───
//  body: { items: [{ id, sortOrder }] }. 편집 권한(생성자·멤버·admin/executive) 있는 행만 반영(WHERE 인라인 enforce).
router.post('/reorder', async function (req, res) {
  try {
    var items = (req.body && req.body.items) || [];
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'BAD_REQUEST', message: 'items 필수' });
    // 항목마다 UPDATE 하던 루프 → unnest 로 단일 UPDATE ... FROM (트랜잭션 유지).
    // 같은 id 가 여러 번 오면 예전 순차 루프처럼 마지막 값이 이기도록 JS 에서 마지막 것만 남긴다.
    // updated 는 예전처럼 "갱신된 행 수의 합" — 중복 id 는 루프에서 매번 셌으므로 등장 횟수만큼 더한다.
    var last = new Map();
    var times = new Map();
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.id) continue;
      var key = String(it.id);
      last.set(key, it.sortOrder != null ? it.sortOrder : 0);
      times.set(key, (times.get(key) || 0) + 1);
    }
    var ids = Array.from(last.keys());
    var orders = ids.map(function (k) { return String(last.get(k)); });
    var n = 0;
    if (ids.length) {
      // 편집 권한(생성자·멤버·admin/executive) 있는 행만 반영 — lib/project-access.editableProjectsSql
      var ed = pa.editableProjectsSql(req, 'p', 4);
      await db.transaction(async function (client) {
        var r = await client.query(
          "UPDATE projects p SET sort_order = u.ord::int, updated_at = now() " +
          "FROM unnest($1::text[], $2::text[]) AS u(id, ord) " +
          "WHERE p.id = u.id AND p.tenant_id = $3 AND " + ed.sql + " RETURNING p.id",
          [ids, orders, req.tenant.id].concat(ed.params)
        );
        r.rows.forEach(function (row) { n += times.get(String(row.id)) || 1; });
      });
    }
    res.json({ updated: n });
  } catch (e) {
    httpErr.serverError(res, '[projects/reorder]', e);
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
    httpErr.serverError(res, '[projects/images/list]', e);
  }
});

// POST /api/projects/:id/images — 이미지 추가(여러 장). body: { images:[{src, caption?}] }
router.post('/:id/images', async function (req, res) {
  try {
    if (await _imgGate(req, res, true) === null) return;
    var b = req.body || {};
    var arr = Array.isArray(b.images) ? b.images : (b.src ? [{ src: b.src, caption: b.caption }] : []);
    arr = arr.filter(function (x) { return x && x.src; });
    if (!arr.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '이미지가 없습니다.' });
    // v13.213: 크기 검사를 저장 전에 전부 — 예전엔 2번째가 크면 1번째만 저장된 채 413 이 났다
    if (arr.some(function (x) { return String(x.src).length > _IMG_MAX; })) {
      return res.status(413).json({ error: 'TOO_LARGE', message: '이미지가 너무 큽니다(1장 4MB 이하).' });
    }
    // 현재 최대 sort_order
    var mr = await db.query('SELECT COALESCE(MAX(sort_order), -1) AS mx FROM project_images WHERE project_id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    var ord = (mr.rows[0] && mr.rows[0].mx != null) ? (parseInt(mr.rows[0].mx, 10) + 1) : 0;
    var crypto = require('crypto');
    var saved = await db.transaction(async function (q) {
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var id = 'pimg-' + crypto.randomUUID().slice(0, 12);
        var ir = await q.query(
          'INSERT INTO project_images (id, tenant_id, project_id, src, caption, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, project_id, caption, sort_order, created_at',
          [id, req.tenant.id, req.params.id, String(arr[i].src), (arr[i].caption || null), ord++, req.user.sub]
        );
        out.push(ir.rows[0]);
      }
      return out;
    });
    res.status(201).json({ data: saved });
    try { authService.auditLog(req.user.sub, 'project.image.add', 'project', req.params.id, { count: saved.length }, req); } catch (_) {}
  } catch (e) {
    httpErr.serverError(res, '[projects/images/add]', e);
  }
});

// DELETE /api/projects/:id/images/:imgId
router.delete('/:id/images/:imgId', async function (req, res) {
  try {
    if (await _imgGate(req, res, true) === null) return;
    await db.query('DELETE FROM project_images WHERE id = $1 AND project_id = $2 AND tenant_id = $3', [req.params.imgId, req.params.id, req.tenant.id]);
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[projects/images/del]', e);
  }
});

module.exports = router;
