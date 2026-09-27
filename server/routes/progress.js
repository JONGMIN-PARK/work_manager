var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var { parsePagination } = require('../middleware/pagination');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// GET /api/progress?projectId=xxx
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM progress_history WHERE tenant_id = $1';
    var params = [req.tenant.id];
    if (req.query.projectId) {
      sql += ' AND project_id = $2';
      params.push(req.query.projectId);
    }

    var pg = parsePagination(req.query, 100);
    sql += ' ORDER BY date';
    var idx = params.length + 1;
    sql += ' LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);
    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    httpErr.serverError(res, '[progress/list]', e);
  }
});

// POST /api/progress
router.post('/', async function (req, res) {
  try {
    var b = req.body;
    var id = b.id || ((b.projectId || b.project_id) + '_' + (b.date || ''));
    var r = await db.query(
      "INSERT INTO progress_history (id, project_id, date, progress, actual_hours, created_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET progress=$4, actual_hours=$5 WHERE progress_history.tenant_id = EXCLUDED.tenant_id RETURNING *",
      [id, b.projectId || b.project_id, b.date || '', b.progress || 0, b.actualHours || b.actual_hours || 0, req.user.sub, req.tenant.id]
    );
    // id 가 다른 테넌트 행과 충돌하면 DO UPDATE 가드에 걸려 0행 — 덮어쓰지 않고 거절
    if (!r.rows.length) return res.status(409).json({ error: 'CONFLICT', message: '이미 사용 중인 ID입니다.' });
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[progress/create]', e);
  }
});

module.exports = router;
