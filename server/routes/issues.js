var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var rbac = require('../middleware/rbac');
var lock = require('../middleware/optimistic-lock');
var { parsePagination } = require('../middleware/pagination');

router.use(auth.authenticate);

// GET /api/issues
router.get('/', async function (req, res) {
  try {
    var q = req.query;
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM issues WHERE 1=1';
    var params = [];
    var idx = 1;

    if (q.projectId) { sql += ' AND project_id = $' + idx++; params.push(q.projectId); }
    if (q.orderNo) { sql += ' AND order_no = $' + idx++; params.push(q.orderNo); }
    if (q.status) { sql += ' AND status = $' + idx++; params.push(q.status); }
    if (q.urgency) { sql += ' AND urgency = $' + idx++; params.push(q.urgency); }
    if (q.phase) { sql += ' AND phase = $' + idx++; params.push(q.phase); }
    if (q.dept) { sql += ' AND dept = $' + idx++; params.push(q.dept); }

    var pg = parsePagination(req.query, 100);
    sql += ' ORDER BY created_at DESC LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);
    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    console.error('[issues/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/issues/:id
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM issues WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[issues/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/issues
router.post('/', rbac.checkPermission('issue.create'), async function (req, res) {
  try {
    var b = req.body;
    var id = b.id || ('iss-' + require('crypto').randomUUID().slice(0, 12));
    var r = await db.query(
      "INSERT INTO issues (id, project_id, order_no, phase, dept, type, urgency, status, report_date, due_date, title, description, reporter, reporter_id, assignees, tags, resolution, resolved_date, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19) RETURNING *",
      [id, b.projectId || b.project_id || null, b.orderNo || b.order_no || null,
       b.phase || null, b.dept || null, b.type || null,
       b.urgency || 'normal', b.status || 'open',
       b.reportDate || b.report_date || null, b.dueDate || b.due_date || null,
       b.title || '', b.description || '',
       b.reporter || null, req.user.sub,
       JSON.stringify(b.assignees || []), JSON.stringify(b.tags || []),
       b.resolution || null, b.resolvedDate || b.resolved_date || null,
       req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[issues/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/issues/:id
router.put('/:id', async function (req, res) {
  try {
    var b = req.body;
    var clean = {};
    var fields = ['project_id', 'order_no', 'phase', 'dept', 'type', 'urgency', 'status',
      'report_date', 'due_date', 'title', 'description', 'reporter', 'resolution', 'resolved_date'];
    var camelMap = {projectId:'project_id', orderNo:'order_no', reportDate:'report_date',
      dueDate:'due_date', resolvedDate:'resolved_date'};

    fields.forEach(function (f) {
      var camel = Object.keys(camelMap).find(function (k) { return camelMap[k] === f; });
      var val = b[f] !== undefined ? b[f] : (camel ? b[camel] : undefined);
      if (val !== undefined) clean[f] = val;
    });
    if (b.assignees !== undefined) clean.assignees = JSON.stringify(b.assignees);
    if (b.tags !== undefined) clean.tags = JSON.stringify(b.tags);

    var result = await lock.optimisticUpdate(db, 'issues', 'id', req.params.id, b.version, clean, req.user.sub);
    if (result.conflict) return lock.sendConflict(res, result.latest, result.yourVersion);
    if (!result.success) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: result.row });
  } catch (e) {
    console.error('[issues/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/issues/:id
router.delete('/:id', rbac.checkPermission('issue.delete'), async function (req, res) {
  try {
    var r = await db.query('WITH del_logs AS (DELETE FROM issue_logs WHERE issue_id = $1) DELETE FROM issues WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[issues/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── 이슈 대응 이력 ───

// GET /api/issues/:id/logs
router.get('/:id/logs', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM issue_logs WHERE issue_id = $1 ORDER BY date DESC, created_at DESC', [req.params.id]);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[issues/logs]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/issues/:id/logs
router.post('/:id/logs', async function (req, res) {
  try {
    var b = req.body;
    var id = b.id || ('il-' + require('crypto').randomUUID().slice(0, 12));
    var r = await db.query(
      "INSERT INTO issue_logs (id, issue_id, date, content, author, author_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *",
      [id, req.params.id, b.date || null, b.content || '', b.author || null, req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[issues/logs/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/issues/:id/logs/:logId
router.delete('/:id/logs/:logId', async function (req, res) {
  try {
    var r = await db.query('DELETE FROM issue_logs WHERE id = $1 AND issue_id = $2 RETURNING id', [req.params.logId, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[issues/logs/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
