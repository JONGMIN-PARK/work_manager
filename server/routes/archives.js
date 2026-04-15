var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var rbac = require('../middleware/rbac');
var { parsePagination } = require('../middleware/pagination');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ─── 업무일지 레코드 (workRecords) ───
// 주의: /:id 보다 먼저 정의해야 /records가 :id로 매칭되지 않음

// GET /api/archives/records
router.get('/records', async function (req, res) {
  try {
    var role = req.user.role;
    var deptId = req.user.departmentId;
    var where, params, idx;

    if ((role === 'manager' || role === 'executive') && deptId) {
      // 팀장/임원: 소속 부서 전체 업무일지 조회
      where = 'WHERE tenant_id = $1 AND user_id IN (SELECT id FROM users WHERE department_id = $2)';
      params = [req.tenant.id, deptId];
      idx = 3;
    } else if (role === 'admin') {
      // 관리자: 전체
      where = 'WHERE tenant_id = $1';
      params = [req.tenant.id];
      idx = 2;
    } else {
      // member: 본인만
      where = 'WHERE tenant_id = $1 AND user_id = $2';
      params = [req.tenant.id, req.user.sub];
      idx = 3;
    }
    if (req.query.date) { where += ' AND date = $' + idx++; params.push(req.query.date); }
    if (req.query.startDate) { where += ' AND date >= $' + idx++; params.push(req.query.startDate); }
    if (req.query.endDate) { where += ' AND date <= $' + idx++; params.push(req.query.endDate); }
    if (req.query.name) { where += ' AND name = $' + idx++; params.push(req.query.name); }
    if (req.query.orderNo) { where += ' AND order_no = $' + idx++; params.push(req.query.orderNo); }
    if (req.query.milestoneId) { where += ' AND milestone_id = $' + idx++; params.push(req.query.milestoneId); }

    var pg = parsePagination(req.query, 200);

    // total은 실제로 필요한 경우에만 계산. 벌크 로드(all=true)는 total 불필요 → 불필요한 COUNT 제거.
    var total = 0;
    if (req.query.withTotal === 'true' || (pg.offset === 0 && req.query.all !== 'true')) {
      var countR = await db.query('SELECT COUNT(*) as cnt FROM work_records ' + where, params.slice(0, idx - 1));
      total = parseInt(countR.rows[0].cnt, 10);
    }

    // milestone_id 컬럼이 아직 없는 배포 환경도 허용 (migration 미적용 폴백)
    var colCheck = await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='work_records' AND column_name='milestone_id'");
    var hasMs = colCheck.rows.length > 0;
    var cols = 'id, date, name, order_no, hours, task_type, abbr, content, ocmt, oclient' + (hasMs ? ', milestone_id' : '');
    var dataSql = 'SELECT ' + cols + ' FROM work_records ' + where +
      ' ORDER BY date DESC, name, order_no LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);
    var r = await db.query(dataSql, params);

    // ETag 기반 캐싱: 데이터 변경 없으면 304 반환
    var etag = '"wr-' + r.rows.length + '-' + (r.rows.length > 0 ? r.rows[0].id : 0) + '-' + (r.rows.length > 0 ? r.rows[r.rows.length - 1].id : 0) + '"';
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    console.error('[work-records/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/archives/records/count
router.get('/records/count', async function (req, res) {
  try {
    var role = req.user.role;
    var deptId = req.user.departmentId;
    var sql, params;
    if ((role === 'manager' || role === 'executive') && deptId) {
      sql = 'SELECT COUNT(*) as cnt FROM work_records WHERE tenant_id = $1 AND user_id IN (SELECT id FROM users WHERE department_id = $2)';
      params = [req.tenant.id, deptId];
    } else if (role === 'admin') {
      sql = 'SELECT COUNT(*) as cnt FROM work_records WHERE tenant_id = $1';
      params = [req.tenant.id];
    } else {
      sql = 'SELECT COUNT(*) as cnt FROM work_records WHERE tenant_id = $1 AND user_id = $2';
      params = [req.tenant.id, req.user.sub];
    }
    var r = await db.query(sql, params);
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

    // 해당 사용자의 레코드만 삭제 후 재삽입 (사용자별 데이터 분리)
    await client.query('DELETE FROM work_records WHERE user_id = $1 AND tenant_id = $2', [userId, req.tenant.id]);

    // 배치 삽입 (PostgreSQL 파라미터 한도 대비 500건씩, user_id 포함)
    var BATCH = 500;
    var totalInserted = 0;
    for (var b = 0; b < records.length; b += BATCH) {
      var chunk = records.slice(b, b + BATCH);
      var values = [];
      var params = [];
      var idx = 1;
      chunk.forEach(function (r) {
        values.push('($' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ')');
        params.push(r.date || '', r.name || '', r.orderNo || r.order_no || '', r.hours || 0, r.taskType || r.task_type || '', r.abbr || '', r.content || '', r.ocmt || null, r.oclient || null, r.milestoneId || r.milestone_id || null, userId, req.tenant.id);
      });
      var sql = 'INSERT INTO work_records (date, name, order_no, hours, task_type, abbr, content, ocmt, oclient, milestone_id, user_id, tenant_id) VALUES ' + values.join(',');
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

// PATCH /api/archives/records/batch — 변경된 레코드 배치 업데이트
router.patch('/records/batch', rbac.checkPermission('archive.manage'), async function (req, res) {
  var client;
  try {
    client = await db.pool.connect();
  } catch (connErr) {
    console.error('[work-records/batch-update] DB connect failed:', connErr);
    return res.status(503).json({ error: 'DB_UNAVAILABLE', message: 'DB 연결 실패' });
  }
  try {
    var updates = req.body.updates || [];
    if (!updates.length) { client.release(); return res.json({ data: [], count: 0 }); }

    await client.query('BEGIN');
    // 전체 필드를 명시적으로 SET (COALESCE 없이 직접 덮어쓰기)
    var promises = [];
    var count = 0;
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      if (!u.id) continue;
      promises.push(client.query(
        'UPDATE work_records SET date=$1, name=$2, order_no=$3, hours=$4, task_type=$5, abbr=$6, content=$7, ocmt=$8, oclient=$9, milestone_id=$10 WHERE id=$11 AND user_id=$12 AND tenant_id=$13',
        [u.date || '', u.name || '', u.orderNo || u.order_no || '', u.hours || 0, u.taskType || u.task_type || '', u.abbr || '', u.content || '', u.ocmt || null, u.oclient || null, u.milestoneId !== undefined ? (u.milestoneId || null) : (u.milestone_id !== undefined ? (u.milestone_id || null) : null), u.id, req.user.sub, req.tenant.id]
      ));
      count++;
    }
    await Promise.all(promises);
    await client.query('COMMIT');
    res.json({ data: [], count: count });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (rbErr) { console.error('[ROLLBACK failed]', rbErr); }
    console.error('[work-records/batch-update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message || '서버 오류' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/archives/records — 단일 레코드 수동 추가
router.post('/records', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    var r = req.body;
    if (!r.date || !r.name) return res.status(400).json({ error: 'INVALID', message: 'date, name 필수' });
    var result = await db.query(
      'INSERT INTO work_records (date, name, order_no, hours, task_type, abbr, content, ocmt, oclient, milestone_id, user_id, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
      [r.date || '', r.name || '', r.orderNo || r.order_no || '', r.hours || 0, r.taskType || r.task_type || '', r.abbr || '', r.content || '', r.ocmt || null, r.oclient || null, r.milestoneId || r.milestone_id || null, req.user.sub, req.tenant.id]
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
    var tenantIdx = ids.length + 2;
    var result = await db.query('DELETE FROM work_records WHERE id IN (' + placeholders.join(',') + ') AND (user_id = $' + userIdx + ' OR user_id IS NULL) AND tenant_id = $' + tenantIdx, ids.concat([req.user.sub, req.tenant.id]));
    res.json({ count: result.rowCount });
  } catch (e) {
    console.error('[work-records/batch-delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/archives/records/auto-tag-milestones — 프로젝트의 work_records를 마일스톤 날짜 구간으로 자동 태깅
// body: { projectId, overwrite?: boolean }  (overwrite=false면 milestone_id 가 null인 것만 태깅)
router.post('/records/auto-tag-milestones', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    var projectId = req.body.projectId;
    var overwrite = !!req.body.overwrite;
    if (!projectId) return res.status(400).json({ error: 'INVALID', message: 'projectId 필수' });

    // 프로젝트 orderNo + 마일스톤들 조회
    var projR = await db.query('SELECT order_no FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, req.tenant.id]);
    if (!projR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트 없음' });
    var orderNo = (projR.rows[0].order_no || '').trim();
    if (!orderNo) return res.json({ data: { tagged: 0, reason: '프로젝트에 수주번호가 없습니다.' } });

    var msR = await db.query('SELECT id, start_date, end_date FROM milestones WHERE project_id = $1 AND tenant_id = $2 ORDER BY sort_order', [projectId, req.tenant.id]);
    var milestones = msR.rows.filter(function (m) { return m.start_date && m.end_date; });
    if (!milestones.length) return res.json({ data: { tagged: 0, reason: '날짜가 설정된 마일스톤이 없습니다.' } });

    var whereMs = overwrite ? '' : ' AND milestone_id IS NULL';
    var tagged = 0;
    for (var i = 0; i < milestones.length; i++) {
      var ms = milestones[i];
      var r = await db.query(
        'UPDATE work_records SET milestone_id = $1 WHERE order_no = $2 AND date >= $3 AND date <= $4 AND tenant_id = $5' + whereMs,
        [ms.id, orderNo, ms.start_date, ms.end_date, req.tenant.id]
      );
      tagged += r.rowCount || 0;
    }
    res.json({ data: { tagged: tagged, milestones: milestones.length } });
  } catch (e) {
    console.error('[work-records/auto-tag]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message || '서버 오류' });
  }
});

// DELETE /api/archives/records — 전체 삭제 (해당 사용자 레코드만)
router.delete('/records', rbac.checkPermission('archive.manage'), async function (req, res) {
  var client;
  try {
    client = await db.pool.connect();
  } catch (connErr) {
    console.error('[work-records/clear] DB connect failed:', connErr);
    return res.status(503).json({ error: 'DB_UNAVAILABLE', message: 'DB 연결 실패' });
  }
  try {
    await client.query('SET statement_timeout = 25000');
    // tenant_id 컬럼 존재 여부 확인 후 쿼리 분기
    var colCheck = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name='work_records' AND column_name='tenant_id'");
    var result;
    if (colCheck.rows.length > 0) {
      result = await client.query('DELETE FROM work_records WHERE user_id = $1 AND tenant_id = $2', [req.user.sub, req.tenant.id]);
    } else {
      result = await client.query('DELETE FROM work_records WHERE user_id = $1', [req.user.sub]);
    }
    res.json({ message: '전체 삭제 완료', deleted: result.rowCount });
  } catch (e) {
    console.error('[work-records/clear]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message || '서버 오류' });
  } finally {
    if (client) client.release();
  }
});

// ─── 업무일지 아카이브 (weeks) ───

// GET /api/archives
router.get('/', async function (req, res) {
  try {
    var pg = parsePagination(req.query, 100);
    var r = await db.query('SELECT *, COUNT(*) OVER() AS _total FROM work_archives WHERE tenant_id = $1 ORDER BY saved_at DESC LIMIT $2 OFFSET $3', [req.tenant.id, pg.limit, pg.offset]);
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
    var r = await db.query('SELECT * FROM work_archives WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
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
      "INSERT INTO work_archives (id, label, date_range, selected_names, total_hours, data, saved_at, uploaded_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET label=$2, date_range=$3, selected_names=$4, total_hours=$5, data=$6, saved_at=$7 RETURNING *",
      [b.id, b.label || '', JSON.stringify(b.dateRange || b.date_range || []),
       JSON.stringify(b.selectedNames || b.selected_names || []),
       b.totalHours || b.total_hours || 0,
       JSON.stringify(b.data || []),
       b.savedAt || b.saved_at || new Date().toISOString(),
       req.user.sub, req.tenant.id]
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
    var r = await db.query('DELETE FROM work_archives WHERE id = $1 AND tenant_id = $2 RETURNING id', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[archives/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
