var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var rbac = require('../middleware/rbac');
var { parsePagination } = require('../middleware/pagination');

router.use(auth.authenticate);

// ─── 업무일지 레코드 (workRecords) ───
// 주의: /:id 보다 먼저 정의해야 /records가 :id로 매칭되지 않음

// GET /api/archives/records
router.get('/records', async function (req, res) {
  try {
    var where = 'WHERE 1=1';
    var params = [];
    var idx = 1;
    if (req.query.date) { where += ' AND date = $' + idx++; params.push(req.query.date); }
    if (req.query.startDate) { where += ' AND date >= $' + idx++; params.push(req.query.startDate); }
    if (req.query.endDate) { where += ' AND date <= $' + idx++; params.push(req.query.endDate); }
    if (req.query.name) { where += ' AND name = $' + idx++; params.push(req.query.name); }
    if (req.query.orderNo) { where += ' AND order_no = $' + idx++; params.push(req.query.orderNo); }

    // 부서 필터 (manager/member는 자기 부서만)
    var role = req.user.role;
    var deptId = req.user.departmentId;
    if (deptId && role !== 'admin' && role !== 'executive') {
      where += ' AND (user_id IN (SELECT id FROM users WHERE department_id = $' + idx++ + ') OR user_id IS NULL)';
      params.push(deptId);
    }

    var pg = parsePagination(req.query, 200);

    // total은 요청 시에만 계산 (성능)
    var total = 0;
    if (req.query.withTotal === 'true' || pg.offset === 0) {
      var countR = await db.query('SELECT COUNT(*) as cnt FROM work_records ' + where, params.slice(0, idx - 1));
      total = parseInt(countR.rows[0].cnt, 10);
    }

    var dataSql = 'SELECT * FROM work_records ' + where +
      ' ORDER BY date DESC, name, order_no LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);
    var r = await db.query(dataSql, params);

    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
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
    var pg = parsePagination(req.query, 100);
    var r = await db.query('SELECT *, COUNT(*) OVER() AS _total FROM work_archives ORDER BY saved_at DESC LIMIT $1 OFFSET $2', [pg.limit, pg.offset]);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
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
