var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var lock = require('../middleware/optimistic-lock');
var { parsePagination } = require('../middleware/pagination');

router.use(auth.authenticate);

// GET /api/checklists?projectId=xxx&phase=yyy
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM checklists WHERE 1=1';
    var params = [];
    var idx = 1;
    if (req.query.projectId) { sql += ' AND project_id = $' + idx++; params.push(req.query.projectId); }
    if (req.query.phase) { sql += ' AND phase = $' + idx++; params.push(req.query.phase); }

    var pg = parsePagination(req.query, 100);
    sql += ' ORDER BY created_at LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);
    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    console.error('[checklists/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/checklists
router.post('/', async function (req, res) {
  try {
    var b = req.body;
    var id = b.id || ('chk-' + require('crypto').randomUUID().slice(0, 12));
    var r = await db.query(
      "INSERT INTO checklists (id, project_id, phase, items, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [id, b.projectId || b.project_id, b.phase || null, JSON.stringify(b.items || []), req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[checklists/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/checklists/:id
router.put('/:id', async function (req, res) {
  try {
    var b = req.body;
    var clean = {};
    if (b.phase !== undefined) clean.phase = b.phase;
    if (b.items !== undefined) clean.items = JSON.stringify(b.items);

    var result = await lock.optimisticUpdate(db, 'checklists', 'id', req.params.id, b.version, clean);
    if (result.conflict) return lock.sendConflict(res, result.latest, result.yourVersion);
    if (!result.success) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: result.row });
  } catch (e) {
    console.error('[checklists/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/checklists/:id
router.delete('/:id', async function (req, res) {
  try {
    var r = await db.query('DELETE FROM checklists WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[checklists/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
