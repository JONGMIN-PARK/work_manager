var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var { parsePagination } = require('../middleware/pagination');
var notificationService = require('../services/notification.service');
var tenant = require('../middleware/tenant');
var ps = require('../middleware/project-scope');

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
    // 접근 가능한 프로젝트로 제한 (v13.34)
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
    var r = await db.query(
      "INSERT INTO milestones (id, project_id, name, start_date, end_date, status, sort_order, created_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [id, b.projectId || b.project_id, b.name || '', b.startDate || b.start_date || '',
       b.endDate || b.end_date || '', b.status || 'waiting', b.order || b.sort_order || 0, req.user.sub, req.tenant.id]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[milestones/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/milestones/:id
router.put('/:id', async function (req, res) {
  try {
    var b = req.body;
    var r = await db.query(
      "UPDATE milestones SET name=COALESCE($1,name), start_date=COALESCE($2,start_date), end_date=COALESCE($3,end_date), status=COALESCE($4,status), sort_order=COALESCE($5,sort_order) WHERE id=$6 AND tenant_id=$7 RETURNING *",
      [b.name, b.startDate || b.start_date, b.endDate || b.end_date, b.status, b.order || b.sort_order, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });

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
    var r = await db.query('DELETE FROM milestones WHERE id = $1 AND tenant_id = $2 RETURNING id', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[milestones/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
