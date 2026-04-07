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
    var where = 'WHERE 1=1';
    var params = [];
    var role = req.user.role;
    var deptId = req.user.departmentId;
    if (deptId && role !== 'admin' && role !== 'executive') {
      where += ' AND (user_id IN (SELECT id FROM users WHERE department_id = $1) OR user_id IS NULL)';
      params.push(deptId);
    }
    var r = await db.query('SELECT COUNT(*) as cnt FROM work_records ' + where, params);
    res.json({ data: { count: parseInt(r.rows[0].cnt, 10) } });
  } catch (e) {
    console.error('[work-records/count]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/archives/records/bulk — 일괄 저장 (해당 사용자 레코드만 삭제 후 삽입, 트랜잭션)
router.post('/records/bulk', rbac.checkPermission('archive.manage'), async function (req, res) {
  var client;
  try {
    client = await db.pool.connect();
  } catch (connErr) {
    console.error('[work-records/bulk] DB connect failed:', connErr);
    return res.status(503).json({ error: 'DB_UNAVAILABLE', message: 'DB 연결 실패' });
  }
  try {
    var records = req.body.records || [];
    var userId = req.user.sub;
    if (!records.length) { client.release(); return res.json({ data: [], count: 0 }); }

    await client.query('BEGIN');

    // 전체 레코드 삭제 후 재삽입 (팀 공유 데이터 — 전체 교체)
    await client.query('DELETE FROM work_records');

    // 배치 삽입 (PostgreSQL 파라미터 한도 대비 500건씩, user_id 포함)
    var BATCH = 500;
    var totalInserted = 0;
    for (var b = 0; b < records.length; b += BATCH) {
      var chunk = records.slice(b, b + BATCH);
      var values = [];
      var params = [];
      var idx = 1;
      chunk.forEach(function (r) {
        values.push('($' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ')');
        params.push(r.date || '', r.name || '', r.orderNo || r.order_no || '', r.hours || 0, r.taskType || r.task_type || '', r.abbr || '', r.content || '', r.ocmt || null, r.oclient || null, userId);
      });
      var sql = 'INSERT INTO work_records (date, name, order_no, hours, task_type, abbr, content, ocmt, oclient, user_id) VALUES ' + values.join(',');
      await client.query(sql, params);
      totalInserted += chunk.length;
    }

    await client.query('COMMIT');
    res.status(201).json({ data: [], count: totalInserted });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (rbErr) { console.error('[ROLLBACK failed]', rbErr); }
    console.error('[work-records/bulk]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message || '서버 오류' });
  } finally {
    if (client) client.release();
  }
});

// PATCH /api/archives/records/batch — 변경된 레코드 배치 업데이트 (단일 쿼리)
router.patch('/records/batch', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    var updates = req.body.updates || [];
    if (!updates.length) return res.json({ data: [], count: 0 });

    // 유효한 업데이트만 필터
    var valid = updates.filter(function (u) { return u.id; });
    if (!valid.length) return res.json({ data: [], count: 0 });

    // 배치 UPDATE: unnest 배열로 단일 쿼리 실행
    var ids = [], dates = [], names = [], orderNos = [], hours = [], taskTypes = [], abbrs = [], contents = [], ocmts = [], oclients = [];
    valid.forEach(function (u) {
      ids.push(u.id);
      dates.push(u.date !== undefined ? u.date : null);
      names.push(u.name !== undefined ? u.name : null);
      orderNos.push(u.orderNo || u.order_no || null);
      hours.push(u.hours !== undefined ? u.hours : null);
      taskTypes.push(u.taskType || u.task_type || null);
      abbrs.push(u.abbr !== undefined ? u.abbr : null);
      contents.push(u.content !== undefined ? u.content : null);
      ocmts.push(u.ocmt !== undefined ? u.ocmt : null);
      oclients.push(u.oclient !== undefined ? u.oclient : null);
    });

    var sql = `UPDATE work_records AS w SET
      date = COALESCE(v.date, w.date),
      name = COALESCE(v.name, w.name),
      order_no = COALESCE(v.order_no, w.order_no),
      hours = COALESCE(v.hours, w.hours),
      task_type = COALESCE(v.task_type, w.task_type),
      abbr = COALESCE(v.abbr, w.abbr),
      content = COALESCE(v.content, w.content),
      ocmt = COALESCE(v.ocmt, w.ocmt),
      oclient = COALESCE(v.oclient, w.oclient)
      FROM (SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS date, unnest($3::text[]) AS name,
        unnest($4::text[]) AS order_no, unnest($5::numeric[]) AS hours, unnest($6::text[]) AS task_type,
        unnest($7::text[]) AS abbr, unnest($8::text[]) AS content, unnest($9::text[]) AS ocmt, unnest($10::text[]) AS oclient
      ) AS v WHERE w.id = v.id`;

    await db.query(sql, [ids, dates, names, orderNos, hours, taskTypes, abbrs, contents, ocmts, oclients]);
    res.json({ data: [], count: valid.length });
  } catch (e) {
    console.error('[work-records/batch-update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message || '서버 오류' });
  }
});

// POST /api/archives/records — 단일 레코드 수동 추가
router.post('/records', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    var r = req.body;
    if (!r.date || !r.name) return res.status(400).json({ error: 'INVALID', message: 'date, name 필수' });
    var result = await db.query(
      'INSERT INTO work_records (date, name, order_no, hours, task_type, abbr, content, ocmt, oclient, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [r.date || '', r.name || '', r.orderNo || r.order_no || '', r.hours || 0, r.taskType || r.task_type || '', r.abbr || '', r.content || '', r.ocmt || null, r.oclient || null, req.user.sub]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (e) {
    console.error('[work-records/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message || '서버 오류' });
  }
});

// DELETE /api/archives/records/batch — 선택 삭제 (ID 배열)
router.delete('/records/batch', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    var ids = req.body.ids || [];
    if (!ids.length) return res.json({ count: 0 });
    var placeholders = ids.map(function (_, i) { return '$' + (i + 1); });
    var userIdx = ids.length + 1;
    var result = await db.query('DELETE FROM work_records WHERE id IN (' + placeholders.join(',') + ') AND (user_id = $' + userIdx + ' OR user_id IS NULL)', ids.concat([req.user.sub]));
    res.json({ count: result.rowCount });
  } catch (e) {
    console.error('[work-records/batch-delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/archives/records — 전체 삭제 (해당 사용자 레코드만)
router.delete('/records', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    await db.query('DELETE FROM work_records WHERE user_id = $1', [req.user.sub]);
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
