var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var { parsePagination } = require('../middleware/pagination');
var notificationService = require('../services/notification.service');
var authService = require('../services/auth.service');
var tenant = require('../middleware/tenant');
var ps = require('../middleware/project-scope');
var operator = require('../middleware/operator');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// GET /api/milestones?projectId=xxx — v13.34 가시성 적용: 접근 가능한 프로젝트의 마일스톤만
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM milestones WHERE tenant_id = $1';
    var params = [req.tenant.id];
    var idx = 2;
    if (req.query.projectId) {
      sql += ' AND project_id = $' + idx++;
      params.push(req.query.projectId);
    }
    // 운영자(전체보기)는 가시성 우회 — 전체 마일스톤 표시
    if (req.user.role !== 'admin') { try { if (await operator.isOperator(req)) req._operatorAll = true; } catch (_) {} }
    // 접근 가능한 프로젝트로 제한 (v13.34, admin/운영자는 전체)
    var sub = ps.accessibleProjectsSubquery(req, idx);
    sql += ' AND project_id IN (' + sub.sql + ')';
    params = params.concat(sub.params);
    idx = sub.nextIdx;

    var pg = parsePagination(req.query, 100);
    sql += ' ORDER BY sort_order, start_date';
    sql += ' LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);
    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    console.error('[milestones/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/milestones
router.post('/', async function (req, res) {
  try {
    var b = req.body;
    var id = b.id || ('ms-' + require('crypto').randomUUID().slice(0, 12));
    var atIns = b.assigneeTargets || b.assignee_targets || {};
    var r = await db.query(
      "INSERT INTO milestones (id, project_id, name, start_date, end_date, status, sort_order, assignee_targets, created_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [id, b.projectId || b.project_id, b.name || '', b.startDate || b.start_date || '',
       b.endDate || b.end_date || '', b.status || 'waiting', b.order || b.sort_order || 0, JSON.stringify(atIns), req.user.sub, req.tenant.id]
    );
    res.status(201).json({ data: r.rows[0] });
    try { authService.auditLog(req.user.sub, 'milestone.create', 'milestone', id, { name: r.rows[0] && r.rows[0].name, projectId: r.rows[0] && r.rows[0].project_id }, req); } catch (_) {}
  } catch (e) {
    console.error('[milestones/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/milestones/:id
router.put('/:id', async function (req, res) {
  try {
    var b = req.body;
    // sort_order=0 도 유효한 값 → falsy(||) 대신 null 체크로 보존 (첫 번째 마일스톤 순서 저장 누락 방지)
    var sortOrder = (b.order != null) ? b.order : (b.sort_order != null ? b.sort_order : null);
    // assignee_targets: 명시적으로 전달된 경우에만 갱신(미전달 시 COALESCE로 보존)
    var atRaw = (b.assigneeTargets !== undefined) ? b.assigneeTargets : b.assignee_targets;
    var atParam = (atRaw !== undefined) ? JSON.stringify(atRaw || {}) : null;
    var r = await db.query(
      "UPDATE milestones SET name=COALESCE($1,name), start_date=COALESCE($2,start_date), end_date=COALESCE($3,end_date), status=COALESCE($4,status), sort_order=COALESCE($5,sort_order), assignee_targets=COALESCE($8::jsonb,assignee_targets) WHERE id=$6 AND tenant_id=$7 RETURNING *",
      [b.name, b.startDate || b.start_date, b.endDate || b.end_date, b.status, sortOrder, req.params.id, req.tenant.id, atParam]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
    try { authService.auditLog(req.user.sub, 'milestone.update', 'milestone', req.params.id, { name: r.rows[0] && r.rows[0].name, status: r.rows[0] && r.rows[0].status, projectId: r.rows[0] && r.rows[0].project_id }, req); } catch (_) {}

    // 텔레그램 알림: 마일스톤 완료
    try {
      if (b.status === 'done' && r.rows[0]) {
        var ms = r.rows[0];
        var projR = await db.query('SELECT name, order_no FROM projects WHERE id = $1', [ms.project_id]);
        var proj = projR.rows[0];
        if (proj) {
          notificationService.notifyProjectStakeholders('milestone_complete', {
            milestoneName: ms.name, orderNo: proj.order_no
          }, ms.project_id).catch(function(e) { console.error('[noti]', e.message); });
        }
      }
    } catch (_) { /* 알림 실패 무시 */ }
  } catch (e) {
    console.error('[milestones/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// 프로젝트 쓰기 권한 체크 (owner / 활성 멤버 / admin·executive)
async function _canEditProject(req, projectId) {
  var role = req.user.role;
  if (role === 'admin' || role === 'executive') return true;
  var pr = await db.query('SELECT owner_id FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, req.tenant.id]);
  if (!pr.rows.length) return null; // 프로젝트 자체가 없음
  if (pr.rows[0].owner_id === req.user.sub) return true;
  var mr = await db.query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND released_at IS NULL', [projectId, req.user.sub]);
  return mr.rows.length > 0;
}

// 휴지통 복구·완전삭제는 관리자(admin/executive) 전용
function _isAdminRole(req) {
  var r = req.user && req.user.role;
  return r === 'admin' || r === 'executive';
}

// 프로젝트 진척률 롤업 — 마일스톤 보고 진척률을 목표시간(assignee_targets) 가중평균.
// 보고 이력이 하나도 없으면 손대지 않음(시간기반 자동 진척률 폴백 유지).
async function _rollupProjectProgress(projectId, tenantId) {
  var mr = await db.query(
    'SELECT progress, assignee_targets, progress_updated_at FROM milestones WHERE project_id = $1 AND tenant_id = $2',
    [projectId, tenantId]
  );
  if (!mr.rows.length) return;
  var anyReported = mr.rows.some(function (m) { return m.progress_updated_at != null; });
  if (!anyReported) return;
  var wsum = 0, psum = 0, psimple = 0, cnt = 0;
  mr.rows.forEach(function (m) {
    var at = m.assignee_targets || {};
    var w = 0;
    Object.keys(at).forEach(function (k) { w += Number(at[k]) || 0; });
    var prog = Number(m.progress) || 0;
    wsum += w; psum += prog * w; psimple += prog; cnt++;
  });
  var proj = wsum > 0 ? Math.round(psum / wsum) : Math.round(psimple / Math.max(cnt, 1));
  proj = Math.max(0, Math.min(100, proj));
  await db.query('UPDATE projects SET progress = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [proj, projectId, tenantId]);
}

// GET /api/milestones/:id/logs — 마일스톤 작업 노트 + 진척률 이력 (최신순)
router.get('/:id/logs', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT id, milestone_id, project_id, author_id, author_name, progress, note, hours, created_at ' +
      'FROM milestone_progress_logs WHERE milestone_id = $1 AND tenant_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100',
      [req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[milestones/logs]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/milestones/:id/logs — 진척률 + 작업 노트 업데이트 (활성 멤버만)
router.post('/:id/logs', async function (req, res) {
  try {
    var b = req.body || {};
    var progress = parseInt(b.progress, 10);
    if (isNaN(progress)) progress = 0;
    progress = Math.max(0, Math.min(100, progress));
    var note = (b.note != null) ? String(b.note) : '';
    var hours = parseFloat(b.hours);
    if (isNaN(hours) || hours < 0) hours = 0;

    var msr = await db.query('SELECT id, project_id FROM milestones WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!msr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '마일스톤을 찾을 수 없습니다.' });
    var ms = msr.rows[0];

    // 권한: 프로젝트 활성 멤버 (owner/admin/executive 포함)
    var can = await _canEditProject(req, ms.project_id);
    if (!can) return res.status(403).json({ error: 'FORBIDDEN', message: '프로젝트 멤버만 진척률을 업데이트할 수 있습니다.' });

    // 작성자명 조회
    var authorName = '';
    try {
      var ur = await db.query('SELECT name FROM users WHERE id = $1', [req.user.sub]);
      if (ur.rows.length) authorName = ur.rows[0].name || '';
    } catch (_) { /* ignore */ }

    var logId = 'mpl-' + require('crypto').randomUUID().slice(0, 12);
    await db.query(
      'INSERT INTO milestone_progress_logs (id, milestone_id, project_id, tenant_id, author_id, author_name, progress, note, hours) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [logId, ms.id, ms.project_id, req.tenant.id, req.user.sub, authorName, progress, note, hours]
    );
    // 마일스톤 denormalize 재동기화 (최신 진척률 + 보고 투입시간 합) + 프로젝트 진척률 롤업
    await _resyncMilestoneProgress(ms.id, req.tenant.id);
    await _rollupProjectProgress(ms.project_id, req.tenant.id);

    res.status(201).json({ data: { id: logId, milestoneId: ms.id, projectId: ms.project_id, authorName: authorName, progress: progress, note: note, hours: hours } });

    // 감사 로그 (best-effort)
    try {
      authService.auditLog(req.user.sub, 'milestone.progress', 'milestone', ms.id, { progress: progress, hours: hours }, req).catch(function () {});
    } catch (_) {}

    // 마일스톤 진척 보고 알림 — 관리자에게만 발송 (추적용)
    try {
      var fullMs = await db.query('SELECT name FROM milestones WHERE id = $1 AND tenant_id = $2', [ms.id, req.tenant.id]);
      var msName = fullMs.rows.length ? (fullMs.rows[0].name || '') : '';
      var projR2 = await db.query('SELECT name FROM projects WHERE id = $1 AND tenant_id = $2', [ms.project_id, req.tenant.id]);
      var projName2 = projR2.rows.length ? (projR2.rows[0].name || '') : '';
      notificationService.notifyAdmins('milestone_progress', {
        projectName: projName2, milestoneName: msName, progress: progress, hours: hours, authorName: authorName,
        note: (note || '').slice(0, 200)
      }).catch(function (e) { console.error('[noti]', e.message); });
    } catch (_) { /* 알림 실패 무시 */ }
  } catch (e) {
    console.error('[milestones/log-add]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// 마일스톤 denormalize 재동기화 — 최신 진척률(로그) + 보고 투입시간 합(reported_hours). 로그 없으면 초기화.
async function _resyncMilestoneProgress(mid, tenantId) {
  var agg = await db.query(
    'SELECT COALESCE(SUM(hours),0) AS sum_h FROM milestone_progress_logs WHERE milestone_id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [mid, tenantId]
  );
  var sumH = Number(agg.rows[0].sum_h) || 0;
  var lr = await db.query(
    'SELECT progress, note, author_name, created_at FROM milestone_progress_logs WHERE milestone_id = $1 AND tenant_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1',
    [mid, tenantId]
  );
  if (lr.rows.length) {
    var l = lr.rows[0];
    await db.query(
      'UPDATE milestones SET progress = $1, progress_note = $2, progress_updated_at = $3, progress_updated_by = $4, reported_hours = $5 WHERE id = $6 AND tenant_id = $7',
      [l.progress, l.note, l.created_at, l.author_name, sumH, mid, tenantId]
    );
  } else {
    await db.query(
      'UPDATE milestones SET progress = 0, progress_note = NULL, progress_updated_at = NULL, progress_updated_by = NULL, reported_hours = 0 WHERE id = $1 AND tenant_id = $2',
      [mid, tenantId]
    );
  }
}

// DELETE /api/milestones/:id/logs/:logId — 진척률 이력 1건 삭제 (부분)
router.delete('/:id/logs/:logId', async function (req, res) {
  try {
    var msr = await db.query('SELECT id, project_id FROM milestones WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!msr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '마일스톤을 찾을 수 없습니다.' });
    var ms = msr.rows[0];
    var can = await _canEditProject(req, ms.project_id);
    if (!can) return res.status(403).json({ error: 'FORBIDDEN', message: '프로젝트 멤버만 삭제할 수 있습니다.' });
    // soft delete: 휴지통으로 이동(deleted_at 표시). 영구 보관 — 관리자가 복구/완전삭제 가능.
    var dr = await db.query(
      'UPDATE milestone_progress_logs SET deleted_at = NOW(), deleted_by = $4 ' +
      'WHERE id = $1 AND milestone_id = $2 AND tenant_id = $3 AND deleted_at IS NULL RETURNING id',
      [req.params.logId, ms.id, req.tenant.id, req.user.sub]
    );
    if (!dr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '이력이 없거나 이미 휴지통에 있습니다.' });
    await _resyncMilestoneProgress(ms.id, req.tenant.id);
    await _rollupProjectProgress(ms.project_id, req.tenant.id);
    res.json({ message: '휴지통으로 이동되었습니다.', mode: 'soft' });
  } catch (e) {
    console.error('[milestones/log-del]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/milestones/:id/logs — 진척률 이력 전체 삭제
router.delete('/:id/logs', async function (req, res) {
  try {
    var msr = await db.query('SELECT id, project_id FROM milestones WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!msr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '마일스톤을 찾을 수 없습니다.' });
    var ms = msr.rows[0];
    var can = await _canEditProject(req, ms.project_id);
    if (!can) return res.status(403).json({ error: 'FORBIDDEN', message: '프로젝트 멤버만 삭제할 수 있습니다.' });
    // soft delete: 활성 이력 일괄 휴지통 이동 (영구 보관)
    var dr = await db.query(
      'UPDATE milestone_progress_logs SET deleted_at = NOW(), deleted_by = $3 ' +
      'WHERE milestone_id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id',
      [ms.id, req.tenant.id, req.user.sub]
    );
    await _resyncMilestoneProgress(ms.id, req.tenant.id);
    await _rollupProjectProgress(ms.project_id, req.tenant.id);
    res.json({ message: '전체 휴지통으로 이동되었습니다.', mode: 'soft', deleted: dr.rows.length });
  } catch (e) {
    console.error('[milestones/logs-clear]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/milestones/:id/logs/trash — 휴지통(삭제된 투입실적 이력) 목록. 관리자 전용.
router.get('/:id/logs/trash', async function (req, res) {
  try {
    if (!_isAdminRole(req)) return res.status(403).json({ error: 'FORBIDDEN', message: '관리자만 휴지통을 볼 수 있습니다.' });
    var r = await db.query(
      'SELECT l.id, l.milestone_id, l.project_id, l.author_id, l.author_name, l.progress, l.note, l.hours, l.created_at, l.deleted_at, l.deleted_by, u.name AS deleted_by_name ' +
      'FROM milestone_progress_logs l LEFT JOIN users u ON u.id = l.deleted_by ' +
      'WHERE l.milestone_id = $1 AND l.tenant_id = $2 AND l.deleted_at IS NOT NULL ORDER BY l.deleted_at DESC LIMIT 200',
      [req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[milestones/logs-trash]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/milestones/:id/logs/:logId/restore — 휴지통에서 복구. 관리자 전용.
router.post('/:id/logs/:logId/restore', async function (req, res) {
  try {
    if (!_isAdminRole(req)) return res.status(403).json({ error: 'FORBIDDEN', message: '관리자만 복구할 수 있습니다.' });
    var msr = await db.query('SELECT id, project_id FROM milestones WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!msr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '마일스톤을 찾을 수 없습니다.' });
    var ms = msr.rows[0];
    var dr = await db.query(
      'UPDATE milestone_progress_logs SET deleted_at = NULL, deleted_by = NULL ' +
      'WHERE id = $1 AND milestone_id = $2 AND tenant_id = $3 AND deleted_at IS NOT NULL RETURNING id',
      [req.params.logId, ms.id, req.tenant.id]
    );
    if (!dr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '대상이 없거나 휴지통에 없습니다.' });
    await _resyncMilestoneProgress(ms.id, req.tenant.id);
    await _rollupProjectProgress(ms.project_id, req.tenant.id);
    res.json({ message: '복구되었습니다.', mode: 'restore' });
    try { authService.auditLog(req.user.sub, 'milestone.log.restore', 'milestone', ms.id, { logId: req.params.logId }, req).catch(function () {}); } catch (_) {}
  } catch (e) {
    console.error('[milestones/log-restore]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/milestones/:id/logs/:logId/hard — 완전 삭제(복구 불가). 관리자 전용. 휴지통에 있는 것만.
router.delete('/:id/logs/:logId/hard', async function (req, res) {
  try {
    if (!_isAdminRole(req)) return res.status(403).json({ error: 'FORBIDDEN', message: '관리자만 완전 삭제할 수 있습니다.' });
    var msr = await db.query('SELECT id, project_id FROM milestones WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!msr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '마일스톤을 찾을 수 없습니다.' });
    var ms = msr.rows[0];
    var dr = await db.query(
      'DELETE FROM milestone_progress_logs WHERE id = $1 AND milestone_id = $2 AND tenant_id = $3 AND deleted_at IS NOT NULL RETURNING id',
      [req.params.logId, ms.id, req.tenant.id]
    );
    if (!dr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '대상이 없거나 휴지통에 없습니다. (완전삭제는 휴지통 항목만 가능)' });
    res.json({ message: '완전 삭제 완료', mode: 'hard' });
    try { authService.auditLog(req.user.sub, 'milestone.log.purge', 'milestone', ms.id, { logId: req.params.logId }, req).catch(function () {}); } catch (_) {}
  } catch (e) {
    console.error('[milestones/log-hard-del]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/milestones/:id/logs/trash/empty — 휴지통 비우기(일괄 완전삭제). 관리자 전용.
router.delete('/:id/logs/trash/empty', async function (req, res) {
  try {
    if (!_isAdminRole(req)) return res.status(403).json({ error: 'FORBIDDEN', message: '관리자만 휴지통을 비울 수 있습니다.' });
    var msr = await db.query('SELECT id FROM milestones WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!msr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '마일스톤을 찾을 수 없습니다.' });
    var dr = await db.query(
      'DELETE FROM milestone_progress_logs WHERE milestone_id = $1 AND tenant_id = $2 AND deleted_at IS NOT NULL RETURNING id',
      [req.params.id, req.tenant.id]
    );
    res.json({ message: '휴지통을 비웠습니다.', mode: 'hard', deleted: dr.rows.length });
    try { authService.auditLog(req.user.sub, 'milestone.log.trash-empty', 'milestone', req.params.id, { deleted: dr.rows.length }, req).catch(function () {}); } catch (_) {}
  } catch (e) {
    console.error('[milestones/log-trash-empty]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/milestones/:id/logs/:logId/toggle-check — 작업노트 N번째 체크박스 토글(저장).
//  body: { index } (0-based, source order). 프로젝트 멤버 가능. 최신 로그면 progress_note 동기화.
router.post('/:id/logs/:logId/toggle-check', async function (req, res) {
  try {
    var idx = parseInt((req.body || {}).index, 10);
    if (isNaN(idx) || idx < 0) return res.status(400).json({ error: 'BAD_REQUEST', message: 'index 필수' });
    var msr = await db.query('SELECT id, project_id FROM milestones WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!msr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '마일스톤을 찾을 수 없습니다.' });
    var ms = msr.rows[0];
    var can = await _canEditProject(req, ms.project_id);
    if (!can) return res.status(403).json({ error: 'FORBIDDEN', message: '프로젝트 멤버만 가능합니다.' });
    var lr = await db.query(
      'SELECT note FROM milestone_progress_logs WHERE id = $1 AND milestone_id = $2 AND tenant_id = $3 AND deleted_at IS NULL',
      [req.params.logId, ms.id, req.tenant.id]
    );
    if (!lr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '이력을 찾을 수 없습니다.' });
    var note = lr.rows[0].note || '';
    // 클라이언트와 동일한 순서로 줄 시작 체크박스(- [ ] / - [x])를 세어 idx번째를 토글
    var n = -1, toggled = false;
    var newNote = note.replace(/(^|\n)(\s*[-*]\s)\[( |x|X)\]/g, function (full, pre, bullet, mark) {
      n++;
      if (n === idx) { toggled = true; return pre + bullet + '[' + (mark.toLowerCase() === 'x' ? ' ' : 'x') + ']'; }
      return full;
    });
    if (!toggled) return res.status(400).json({ error: 'BAD_REQUEST', message: '체크박스를 찾을 수 없습니다.' });
    await db.query('UPDATE milestone_progress_logs SET note = $1 WHERE id = $2 AND tenant_id = $3', [newNote, req.params.logId, req.tenant.id]);
    await _resyncMilestoneProgress(ms.id, req.tenant.id);   // 최신 로그면 progress_note 갱신
    res.json({ data: { id: req.params.logId, note: newNote } });
  } catch (e) {
    console.error('[milestones/log-toggle-check]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/milestones/:id/transfer — 다른 프로젝트로 마일스톤 이관
//  body: { targetProjectId }
//  src · dst 양쪽에 쓰기 권한 필요
router.post('/:id/transfer', async function (req, res) {
  try {
    var b = req.body || {};
    var targetProjectId = b.targetProjectId || b.target_project_id;
    if (!targetProjectId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'targetProjectId 필수' });

    var msr = await db.query('SELECT id, project_id FROM milestones WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!msr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '마일스톤을 찾을 수 없습니다.' });
    var ms = msr.rows[0];
    if (ms.project_id === targetProjectId) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: '동일 프로젝트로는 이관할 수 없습니다.' });
    }

    var canSrc = await _canEditProject(req, ms.project_id);
    var canDst = await _canEditProject(req, targetProjectId);
    if (canDst === null) return res.status(404).json({ error: 'NOT_FOUND', message: '대상 프로젝트를 찾을 수 없습니다.' });
    if (!canSrc || !canDst) return res.status(403).json({ error: 'FORBIDDEN', message: '양쪽 프로젝트의 쓰기 권한이 필요합니다.' });

    var ur = await db.query('UPDATE milestones SET project_id = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *', [targetProjectId, ms.id, req.tenant.id]);
    res.json({ data: ur.rows[0], message: '이관 완료' });
  } catch (e) {
    console.error('[milestones/transfer]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/milestones/:id
router.delete('/:id', async function (req, res) {
  try {
    var r = await db.query('DELETE FROM milestones WHERE id = $1 AND tenant_id = $2 RETURNING id, project_id, name', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
    try { authService.auditLog(req.user.sub, 'milestone.delete', 'milestone', req.params.id, { name: r.rows[0] && r.rows[0].name, projectId: r.rows[0] && r.rows[0].project_id }, req); } catch (_) {}
  } catch (e) {
    console.error('[milestones/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   마일스톤 담당 배정(assignment) — 변경(교체)/대체(임시)/원복  (037 migration)
   사람은 user_id로 묶음(이관 안전). 과거 이력(author_name 등)은 보존.
   "오늘 유효" 필터: released_at NULL + valid_from/until 윈도우 내.
   ═══════════════════════════════════════════════════════════════════════ */
// valid_from/until 은 'YYYY-MM-DD' 텍스트 → 사전식 비교가 곧 시간순(텍스트 to_char(CURRENT_DATE))
var _TODAY_TXT = "to_char(CURRENT_DATE,'YYYY-MM-DD')";

function _assignToday() { return new Date().toISOString().slice(0, 10); }

// 마일스톤 → project_id 확인 + 쓰기 권한 게이트. 반환: projectId 또는 null(권한/부재)
async function _msEditGate(req, res) {
  var msr = await db.query('SELECT project_id FROM milestones WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
  if (!msr.rows.length) { res.status(404).json({ error: 'NOT_FOUND', message: '마일스톤을 찾을 수 없습니다.' }); return null; }
  var projectId = msr.rows[0].project_id;
  if (!await _canEditProject(req, projectId)) { res.status(403).json({ error: 'FORBIDDEN', message: '담당 배정 권한이 없습니다.' }); return null; }
  return projectId;
}

// GET /api/milestones/:id/assignments[?all=1] — 유효 배정(기본) 또는 전체(이력 포함)
router.get('/:id/assignments', async function (req, res) {
  try {
    var projectId = await _msEditGate(req, res);
    if (projectId === null) return;
    var where = (req.query.all === '1') ? '' :
      " AND a.released_at IS NULL AND (a.valid_from IS NULL OR a.valid_from <= " + _TODAY_TXT + ") AND (a.valid_until IS NULL OR a.valid_until >= " + _TODAY_TXT + ")";
    var r = await db.query(
      'SELECT a.*, u.name AS user_name, u.display_name AS user_display, c.name AS covers_name ' +
      'FROM milestone_assignments a JOIN users u ON a.user_id = u.id ' +
      'LEFT JOIN users c ON a.covers_user_id = c.id ' +
      'WHERE a.milestone_id = $1 AND a.tenant_id = $2' + where +
      " ORDER BY (a.role='primary') DESC, a.created_at",
      [req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[ms/assign/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/milestones/:id/assignments — 배정 추가 {userId, role, targetHours, validFrom, validUntil, coversUserId}
router.post('/:id/assignments', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.userId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'userId 필수' });
    var projectId = await _msEditGate(req, res);
    if (projectId === null) return;
    var role = (b.role === 'deputy') ? 'deputy' : 'primary';
    var id = 'msa-' + require('crypto').randomUUID().slice(0, 12);
    var r = await db.query(
      'INSERT INTO milestone_assignments (id, tenant_id, milestone_id, project_id, user_id, role, target_hours, valid_from, valid_until, covers_user_id, created_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [id, req.tenant.id, req.params.id, projectId, b.userId, role,
       (b.targetHours != null ? b.targetHours : null), b.validFrom || null, b.validUntil || null, b.coversUserId || null, req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
    try { authService.auditLog(req.user.sub, 'assignment.add', 'milestone', req.params.id, { userId: b.userId, role: role }, req); } catch (_) {}
  } catch (e) {
    console.error('[ms/assign/add]', e);
    if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/milestones/:id/assignments/handover — 변경(교체)/대체
//  body: { mode:'replace'|'cover', fromUserId?, toUserId, targetHours?, validFrom?, validUntil?, role? }
router.post('/:id/assignments/handover', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.toUserId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'toUserId 필수' });
    var mode = (b.mode === 'cover') ? 'cover' : 'replace';
    var projectId = await _msEditGate(req, res);
    if (projectId === null) return;
    var crypto = require('crypto');

    if (mode === 'replace') {
      // 구 담당(fromUserId) 활성 배정 해제(이력 보존) + 신 담당 primary 생성(목표시간 승계)
      var oldTargets = null, oldRole = 'primary';
      if (b.fromUserId) {
        var ar = await db.query(
          'SELECT target_hours, role FROM milestone_assignments WHERE milestone_id=$1 AND tenant_id=$2 AND user_id=$3 AND released_at IS NULL ORDER BY created_at DESC LIMIT 1',
          [req.params.id, req.tenant.id, b.fromUserId]
        );
        if (ar.rows.length) { oldTargets = ar.rows[0].target_hours; oldRole = ar.rows[0].role; }
        await db.query(
          'UPDATE milestone_assignments SET released_at=now() WHERE milestone_id=$1 AND tenant_id=$2 AND user_id=$3 AND released_at IS NULL',
          [req.params.id, req.tenant.id, b.fromUserId]
        );
      }
      var th = (b.targetHours != null) ? b.targetHours : oldTargets;
      var nid = 'msa-' + crypto.randomUUID().slice(0, 12);
      var nr = await db.query(
        'INSERT INTO milestone_assignments (id, tenant_id, milestone_id, project_id, user_id, role, target_hours, created_by) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [nid, req.tenant.id, req.params.id, projectId, b.toUserId, (b.role === 'deputy' ? 'deputy' : oldRole), th, req.user.sub]
      );
      res.status(201).json({ data: nr.rows[0] });
    } else {
      // 임시대체 — deputy 배정 + 기간 + covers_user_id(원담당은 그대로)
      var vf = b.validFrom || _assignToday();
      var nid2 = 'msa-' + crypto.randomUUID().slice(0, 12);
      var nr2 = await db.query(
        'INSERT INTO milestone_assignments (id, tenant_id, milestone_id, project_id, user_id, role, target_hours, valid_from, valid_until, covers_user_id, created_by) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
        [nid2, req.tenant.id, req.params.id, projectId, b.toUserId, 'deputy',
         (b.targetHours != null ? b.targetHours : null), vf, b.validUntil || null, b.fromUserId || null, req.user.sub]
      );
      res.status(201).json({ data: nr2.rows[0] });
    }
    try { authService.auditLog(req.user.sub, 'assignment.handover', 'milestone', req.params.id, { mode: mode, from: b.fromUserId, to: b.toUserId }, req); } catch (_) {}
  } catch (e) {
    console.error('[ms/assign/handover]', e);
    if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/milestones/:id/assignments/restore — 원복
//  body: { assignmentId, restoreUserId? }
//   - 대체 원복: assignmentId(대체배정) 해제 → 원담당 자동 복귀
//   - 교체 원복: assignmentId(신 담당) 해제 + restoreUserId(구 담당) 가장 최근 해제 배정 되살림
router.post('/:id/assignments/restore', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.assignmentId && !b.restoreUserId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'assignmentId 또는 restoreUserId 필요' });
    var projectId = await _msEditGate(req, res);
    if (projectId === null) return;
    if (b.assignmentId) {
      await db.query(
        'UPDATE milestone_assignments SET released_at=now() WHERE id=$1 AND milestone_id=$2 AND tenant_id=$3 AND released_at IS NULL',
        [b.assignmentId, req.params.id, req.tenant.id]
      );
    }
    if (b.restoreUserId) {
      await db.query(
        'UPDATE milestone_assignments SET released_at=NULL WHERE id=(' +
        'SELECT id FROM milestone_assignments WHERE milestone_id=$1 AND tenant_id=$2 AND user_id=$3 AND released_at IS NOT NULL ' +
        'ORDER BY released_at DESC LIMIT 1)',
        [req.params.id, req.tenant.id, b.restoreUserId]
      );
    }
    res.json({ message: '원복 완료' });
    try { authService.auditLog(req.user.sub, 'assignment.restore', 'milestone', req.params.id, { assignmentId: b.assignmentId, restoreUserId: b.restoreUserId }, req); } catch (_) {}
  } catch (e) {
    console.error('[ms/assign/restore]', e);
    if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/milestones/:id/assignments/:aid — 배정 해제(소프트, 이력 보존)
router.delete('/:id/assignments/:aid', async function (req, res) {
  try {
    var projectId = await _msEditGate(req, res);
    if (projectId === null) return;
    await db.query(
      'UPDATE milestone_assignments SET released_at=now() WHERE id=$1 AND milestone_id=$2 AND tenant_id=$3 AND released_at IS NULL',
      [req.params.aid, req.params.id, req.tenant.id]
    );
    res.json({ message: '해제 완료' });
    try { authService.auditLog(req.user.sub, 'assignment.release', 'milestone', req.params.id, { assignmentId: req.params.aid }, req); } catch (_) {}
  } catch (e) {
    console.error('[ms/assign/del]', e);
    if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
