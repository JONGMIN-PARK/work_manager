var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var { parsePagination } = require('../middleware/pagination');

router.use(auth.authenticate);

// GET /api/milestones?projectId=xxx
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT * FROM milestones';
    var params = [];
    if (req.query.projectId) {
      sql += ' WHERE project_id = $1';
      params.push(req.query.projectId);
    }
    var countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as cnt');
    var countResult = await db.query(countSql, params);

    var pg = parsePagination(req.query, 100);
    sql += ' ORDER BY sort_order, start_date';
    var idx = params.length + 1;
    sql += ' LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);
    var r = await db.query(sql, params);
    res.json({ data: r.rows, total: parseInt(countResult.rows[0].cnt, 10), limit: pg.limit, offset: pg.offset });
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
      "INSERT INTO milestones (id, project_id, name, start_date, end_date, status, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [id, b.projectId || b.project_id, b.name || '', b.startDate || b.start_date || '',
       b.endDate || b.end_date || '', b.status || 'waiting', b.order || b.sort_order || 0, req.user.sub]
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
      "UPDATE milestones SET name=COALESCE($1,name), start_date=COALESCE($2,start_date), end_date=COALESCE($3,end_date), status=COALESCE($4,status), sort_order=COALESCE($5,sort_order) WHERE id=$6 RETURNING *",
      [b.name, b.startDate || b.start_date, b.endDate || b.end_date, b.status, b.order || b.sort_order, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[milestones/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/milestones/:id
router.delete('/:id', async function (req, res) {
  try {
    var r = await db.query('DELETE FROM milestones WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[milestones/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
