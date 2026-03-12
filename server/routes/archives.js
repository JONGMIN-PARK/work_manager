var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var rbac = require('../middleware/rbac');

router.use(auth.authenticate);

// ─── 업무일지 레코드 (workRecords) ───
// 주의: /:id 보다 먼저 정의해야 /records가 :id로 매칭되지 않음

// GET /api/archives/records
router.get('/records', async function (req, res) {
  try {
    var sql = 'SELECT * FROM work_records WHERE 1=1';
    var params = [];
    var idx = 1;
    if (req.query.date) { sql += ' AND date = $' + idx++; params.push(req.query.date); }
    if (req.query.name) { sql += ' AND name = $' + idx++; params.push(req.query.name); }
    if (req.query.orderNo) { sql += ' AND order_no = $' + idx++; params.push(req.query.orderNo); }
    sql += ' ORDER BY date DESC, name, order_no';
    var r = await db.query(sql, params);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[work-records/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/archives/records/count
router.get('/records/count', async function (req, res) {
  try {
    var r = await db.query('SELECT COUNT(*) as cnt FROM work_records');
    res.json({ data: { count: parseInt(r.rows[0].cnt, 10) } });
  } catch (e) {
    console.error('[work-records/count]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/archives/records/bulk — 일괄 저장
router.post('/records/bulk', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    var records = req.body.records || [];
    if (!records.length) return res.json({ data: [], count: 0 });

    var values = [];
    var params = [];
    var idx = 1;
    records.forEach(function (r) {
      values.push('($' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ')');
      params.push(r.date || '', r.name || '', r.orderNo || r.order_no || '', r.hours || 0, r.taskType || r.task_type || '', r.abbr || '', r.content || '');
    });

    var sql = 'INSERT INTO work_records (date, name, order_no, hours, task_type, abbr, content) VALUES ' + values.join(',') + ' RETURNING id';
    var result = await db.query(sql, params);
    res.status(201).json({ data: result.rows, count: result.rows.length });
  } catch (e) {
    console.error('[work-records/bulk]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/archives/records — 전체 삭제
router.delete('/records', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    await db.query('DELETE FROM work_records');
    res.json({ message: '전체 삭제 완료' });
  } catch (e) {
    console.error('[work-records/clear]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── 업무일지 아카이브 (weeks) ───

// GET /api/archives
router.get('/', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM work_archives ORDER BY saved_at DESC');
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[archives/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/archives/:id
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM work_archives WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[archives/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/archives
router.post('/', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    var b = req.body;
    var r = await db.query(
      "INSERT INTO work_archives (id, label, date_range, selected_names, total_hours, data, saved_at, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET label=$2, date_range=$3, selected_names=$4, total_hours=$5, data=$6, saved_at=$7 RETURNING *",
      [b.id, b.label || '', JSON.stringify(b.dateRange || b.date_range || []),
       JSON.stringify(b.selectedNames || b.selected_names || []),
       b.totalHours || b.total_hours || 0,
       JSON.stringify(b.data || []),
       b.savedAt || b.saved_at || new Date().toISOString(),
       req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[archives/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/archives/:id
router.delete('/:id', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    var r = await db.query('DELETE FROM work_archives WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[archives/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
