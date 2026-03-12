var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var lock = require('../middleware/optimistic-lock');

router.use(auth.authenticate);

// GET /api/events
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT * FROM events';
    var params = [];
    if (req.query.from && req.query.to) {
      sql += ' WHERE start_date <= $1 AND end_date >= $2';
      params.push(req.query.to, req.query.from);
    }
    sql += ' ORDER BY start_date';
    var r = await db.query(sql, params);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[events/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/events/:id
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[events/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/events
router.post('/', async function (req, res) {
  try {
    var b = req.body;
    var id = b.id || ('evt-' + require('crypto').randomUUID().slice(0, 12));
    var r = await db.query(
      "INSERT INTO events (id, title, type, start_date, end_date, project_ids, assignees, color, memo, repeat, repeat_until, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
      [id, b.title || '', b.type || 'etc', b.startDate || b.start_date || '',
       b.endDate || b.end_date || '', JSON.stringify(b.projectIds || b.project_ids || []),
       JSON.stringify(b.assignees || []), b.color || null, b.memo || '',
       b.repeat || null, b.repeatUntil || b.repeat_until || null, req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[events/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/events/:id
router.put('/:id', async function (req, res) {
  try {
    var b = req.body;
    var clean = {};
    if (b.title !== undefined) clean.title = b.title;
    if (b.type !== undefined) clean.type = b.type;
    if (b.startDate !== undefined || b.start_date !== undefined) clean.start_date = b.startDate || b.start_date;
    if (b.endDate !== undefined || b.end_date !== undefined) clean.end_date = b.endDate || b.end_date;
    if (b.projectIds !== undefined) clean.project_ids = JSON.stringify(b.projectIds);
    if (b.assignees !== undefined) clean.assignees = JSON.stringify(b.assignees);
    if (b.color !== undefined) clean.color = b.color;
    if (b.memo !== undefined) clean.memo = b.memo;
    if (b.repeat !== undefined) clean.repeat = b.repeat;
    if (b.repeatUntil !== undefined) clean.repeat_until = b.repeatUntil;

    var result = await lock.optimisticUpdate(db, 'events', 'id', req.params.id, b.version, clean);
    if (result.conflict) return lock.sendConflict(res, result.latest, result.yourVersion);
    if (!result.success) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: result.row });
  } catch (e) {
    console.error('[events/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/events/:id
router.delete('/:id', async function (req, res) {
  try {
    var r = await db.query('DELETE FROM events WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[events/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
