var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var rbac = require('../middleware/rbac');
var { parsePagination } = require('../middleware/pagination');
var { recordScope } = require('../lib/record-scope');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ─── 업무일지 레코드 (workRecords) ───
// 주의: /:id 보다 먼저 정의해야 /records가 :id로 매칭되지 않음

// GET /api/archives/records
router.get('/records', async function (req, res) {
  try {
    // 역할별 범위: admin=테넌트 / manager·executive(부서)=부서 / 그 외=본인 (lib/record-scope)
    var sc = recordScope(req);
    var where = 'WHERE ' + sc.where;
    var params = sc.params;
    var idx = sc.nextIdx;
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
    httpErr.serverError(res, '[work-records/list]', e);
  }
});

// GET /api/archives/records/count
router.get('/records/count', async function (req, res) {
  try {
    var sc = recordScope(req);
    var r = await db.query('SELECT COUNT(*) as cnt FROM work_records WHERE ' + sc.where, sc.params);
    res.json({ data: { count: parseInt(r.rows[0].cnt, 10) } });
  } catch (e) {
    httpErr.serverError(res, '[work-records/count]', e);
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
    if (!records.length) return res.json({ data: [], count: 0 });   // release 는 finally 에서 1회만

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
    httpErr.serverError(res, '[work-records/bulk]', e, '서버 오류가 발생했습니다.');
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
    if (!updates.length) return res.json({ data: [], count: 0 });   // release 는 finally 에서 1회만

    // 전체 필드를 명시적으로 SET (COALESCE 없이 직접 덮어쓰기).
    // 행마다 UPDATE 하던 N회 왕복 → unnest 배열로 단일 UPDATE ... FROM (1회 왕복).
    //  - 같은 id 가 여러 번 오면 예전처럼 "마지막 값이 이김" 이 되도록 JS 에서 마지막 것만 남긴다
    //    (UPDATE ... FROM 은 중복 조인 행 중 임의의 것을 고르므로).
    //  - 응답 count 는 예전과 같이 "id 가 있는 요청 항목 수" (실제 갱신 행 수 아님).
    var count = 0;
    var byId = new Map();
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      if (!u.id) continue;
      count++;
      byId.set(String(u.id), [
        u.id, u.date || '', u.name || '', u.orderNo || u.order_no || '', u.hours || 0,
        u.taskType || u.task_type || '', u.abbr || '', u.content || '', u.ocmt || null, u.oclient || null,
        u.milestoneId !== undefined ? (u.milestoneId || null) : (u.milestone_id !== undefined ? (u.milestone_id || null) : null)
      ]);
    }
    var cols = [[], [], [], [], [], [], [], [], [], [], []];
    byId.forEach(function (row) { for (var c = 0; c < row.length; c++) cols[c].push(row[c] == null ? null : String(row[c])); });

    // role별 스코프 — GET /records와 동일 정책 (lib/record-scope). 배열 11개 뒤($12~)에 붙는다.
    var sc = recordScope(req, { alias: 'w', startIdx: 12 });

    await client.query('BEGIN');
    if (byId.size) {
      await client.query(
        'UPDATE work_records w SET date=u.date, name=u.name, order_no=u.order_no, hours=u.hours::numeric, task_type=u.task_type, ' +
        'abbr=u.abbr, content=u.content, ocmt=u.ocmt, oclient=u.oclient, milestone_id=u.milestone_id ' +
        'FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[]) ' +
        'AS u(id, date, name, order_no, hours, task_type, abbr, content, ocmt, oclient, milestone_id) ' +
        'WHERE w.id = u.id::integer AND ' + sc.where,
        cols.concat(sc.params)
      );
    }
    await client.query('COMMIT');
    res.json({ data: [], count: count });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (rbErr) { console.error('[ROLLBACK failed]', rbErr); }
    httpErr.serverError(res, '[work-records/batch-update]', e, '서버 오류가 발생했습니다.');
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
    httpErr.serverError(res, '[work-records/create]', e, '서버 오류가 발생했습니다.');
  }
});

// DELETE /api/archives/records/batch — 선택 삭제 (ID 배열) — role 스코프 적용
router.delete('/records/batch', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    var ids = req.body.ids || [];
    if (!ids.length) return res.json({ count: 0 });
    // 범위는 GET/PATCH 와 동일 (lib/record-scope). 예전 member 분기의 `OR user_id IS NULL`
    // (조회·수정 불가한 주인 없는 레코드까지 삭제 허용하던 잔재)은 제거됨 — record-scope.js 주석 참고.
    var sc = recordScope(req, { startIdx: 2 });
    var result = await db.query(
      'DELETE FROM work_records WHERE id = ANY($1::int[]) AND ' + sc.where,
      [ids.map(function (v) { return v == null ? null : String(v); })].concat(sc.params)
    );
    res.json({ count: result.rowCount });
  } catch (e) {
    httpErr.serverError(res, '[work-records/batch-delete]', e);
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

    // 마일스톤마다 UPDATE 하던 N회 왕복 → 단일 UPDATE. 예전 순차 루프와 같은 결과가 되도록:
    //  - overwrite=false: 루프에서는 먼저(sort_order 앞) 태깅한 마일스톤이 milestone_id 를 채우면
    //    뒤 마일스톤은 IS NULL 조건에 걸려 건너뛰었다 → 겹치는 구간은 "첫 마일스톤" 이 이긴다.
    //  - overwrite=true : 매번 덮어써 "마지막 마일스톤" 이 이긴다.
    //  - tagged 는 루프의 rowCount 합계 — overwrite 일 때 겹친 행은 덮어쓴 횟수만큼 셌으므로 hits 합.
    var ids = [], starts = [], ends = [], ords = [];
    milestones.forEach(function (m, i) { ids.push(m.id); starts.push(m.start_date); ends.push(m.end_date); ords.push(i); });
    var r = await db.query(
      'WITH ms AS (SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[]) AS t(id, s, e, ord)), ' +
      'pick AS (' +
      '  SELECT DISTINCT ON (wr.id) wr.id AS wr_id, ms.id AS ms_id, COUNT(*) OVER (PARTITION BY wr.id) AS hits ' +
      '  FROM work_records wr JOIN ms ON wr.date >= ms.s AND wr.date <= ms.e ' +
      '  WHERE wr.order_no = $5 AND wr.tenant_id = $6' + (overwrite ? '' : ' AND wr.milestone_id IS NULL') +
      '  ORDER BY wr.id, ms.ord ' + (overwrite ? 'DESC' : 'ASC') +
      ') ' +
      'UPDATE work_records w SET milestone_id = pick.ms_id FROM pick WHERE w.id = pick.wr_id RETURNING pick.hits',
      [ids, starts, ends, ords, orderNo, req.tenant.id]
    );
    var tagged = overwrite
      ? r.rows.reduce(function (s, row) { return s + (parseInt(row.hits, 10) || 0); }, 0)
      : (r.rowCount || 0);
    res.json({ data: { tagged: tagged, milestones: milestones.length } });
  } catch (e) {
    httpErr.serverError(res, '[work-records/auto-tag]', e, '서버 오류가 발생했습니다.');
  }
});

// DELETE /api/archives/records — 역할별 스코프로 삭제
// admin       : 테넌트 전체
// manager/executive (부서 있음) : 소속 부서 전체 (본인 포함)
// member 또는 부서 없음        : 본인 레코드만
// query ?scope=self 면 강제로 본인만 삭제 (명시적 축소)
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
    // tenant_id 컬럼 존재 여부 (구배포 호환)
    var colCheck = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name='work_records' AND column_name='tenant_id'");
    var hasTenant = colCheck.rows.length > 0;
    // ?scope=self → 본인으로 축소, tenant_id 없는 구배포 → 본인만(tenant 조건 없이)
    var sc = recordScope(req, { forceSelf: req.query.scope === 'self', hasTenantColumn: hasTenant });
    var result = await client.query('DELETE FROM work_records WHERE ' + sc.where, sc.params);
    res.json({ message: '전체 삭제 완료', deleted: result.rowCount, scope: sc.scope });
  } catch (e) {
    httpErr.serverError(res, '[work-records/clear]', e, '서버 오류가 발생했습니다.');
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
    httpErr.serverError(res, '[archives/list]', e);
  }
});

// GET /api/archives/:id
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM work_archives WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[archives/get]', e);
  }
});

// POST /api/archives
router.post('/', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    var b = req.body;
    var r = await db.query(
      "INSERT INTO work_archives (id, label, date_range, selected_names, total_hours, data, saved_at, uploaded_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET label=$2, date_range=$3, selected_names=$4, total_hours=$5, data=$6, saved_at=$7 WHERE work_archives.tenant_id = EXCLUDED.tenant_id RETURNING *",
      [b.id, b.label || '', JSON.stringify(b.dateRange || b.date_range || []),
       JSON.stringify(b.selectedNames || b.selected_names || []),
       b.totalHours || b.total_hours || 0,
       JSON.stringify(b.data || []),
       b.savedAt || b.saved_at || new Date().toISOString(),
       req.user.sub, req.tenant.id]
    );
    // id 가 다른 테넌트 행과 충돌하면 DO UPDATE 가드에 걸려 0행 — 덮어쓰지 않고 거절
    if (!r.rows.length) return res.status(409).json({ error: 'CONFLICT', message: '이미 사용 중인 ID입니다.' });
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[archives/create]', e);
  }
});

// DELETE /api/archives/:id
router.delete('/:id', rbac.checkPermission('archive.manage'), async function (req, res) {
  try {
    var r = await db.query('DELETE FROM work_archives WHERE id = $1 AND tenant_id = $2 RETURNING id', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[archives/delete]', e);
  }
});

module.exports = router;
