var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var { parsePagination } = require('../middleware/pagination');

router.use(auth.authenticate);

// GET /api/progress?projectId=xxx
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM progress_history';
    var params = [];
    if (req.query.projectId) {
      sql += ' WHERE project_id = $1';
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
    console.error('[progress/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/progress
router.post('/', async function (req, res) {
  try {
    var b = req.body;
    var id = b.id || ((b.projectId || b.project_id) + '_' + (b.date || ''));
    var r = await db.query(
      "INSERT INTO progress_history (id, project_id, date, progress, actual_hours, created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET progress=$4, actual_hours=$5 RETURNING *",
      [id, b.projectId || b.project_id, b.date || '', b.progress || 0, b.actualHours || b.actual_hours || 0, req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[progress/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
