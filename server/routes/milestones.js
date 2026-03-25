var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var { parsePagination } = require('../middleware/pagination');
var notificationService = require('../services/notification.service');

router.use(auth.authenticate);

// GET /api/milestones?projectId=xxx
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM milestones';
    var params = [];
    if (req.query.projectId) {
      sql += ' WHERE project_id = $1';
      params.push(req.query.projectId);
    }

    var pg = parsePagination(req.query, 100);
    sql += ' ORDER BY sort_order, start_date';
    var idx = params.length + 1;
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
