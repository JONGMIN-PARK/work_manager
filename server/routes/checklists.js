var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var lock = require('../middleware/optimistic-lock');
var { parsePagination } = require('../middleware/pagination');
var tenant = require('../middleware/tenant');
var ps = require('../lib/project-access');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// 쓰기는 프로젝트 편집 규칙(관리자·임원·생성자·참여자)을 따른다 — v13.213
var CHK_FORBIDDEN = '생성자·참여자·관리자만 체크리스트를 수정할 수 있습니다.';

// GET /api/checklists?projectId=xxx&phase=yyy — v13.34 가시성 적용
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM checklists WHERE 1=1';
    var params = [];
    var idx = 1;
    sql += ' AND tenant_id = $' + idx++; params.push(req.tenant.id);
    if (req.query.projectId) { sql += ' AND project_id = $' + idx++; params.push(req.query.projectId); }
    if (req.query.phase) { sql += ' AND phase = $' + idx++; params.push(req.query.phase); }
    // 접근 가능한 프로젝트로 제한 (v13.34)
    var sub = ps.accessibleProjectsSubquery(req, idx);
    sql += ' AND project_id IN (' + sub.sql + ')';
    params = params.concat(sub.params);
    idx = sub.nextIdx;

    var pg = parsePagination(req.query, 100);
    sql += ' ORDER BY created_at LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);
    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    httpErr.serverError(res, '[checklists/list]', e);
  }
});

// GET /api/checklists/:id
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM checklists WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!await ps.gateRead(req, res, r.rows[0].project_id)) return;
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[checklists/get]', e);
  }
});

// POST /api/checklists
router.post('/', async function (req, res) {
  try {
    var b = req.body;
    var projectId = b.projectId || b.project_id;
    if (!projectId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'projectId 필수' });
    if (!await ps.gateEdit(req, res, projectId, CHK_FORBIDDEN)) return;
    var id = b.id || ('chk-' + require('crypto').randomUUID().slice(0, 12));
    var r = await db.query(
      "INSERT INTO checklists (id, project_id, phase, items, created_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [id, projectId, b.phase || null, JSON.stringify(b.items || []), req.user.sub, req.tenant.id]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[checklists/create]', e);
  }
});

// PUT /api/checklists/:id
router.put('/:id', async function (req, res) {
  try {
    var b = req.body;
    var cur = await db.query('SELECT project_id, version FROM checklists WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!await ps.gateEdit(req, res, cur.rows[0].project_id, CHK_FORBIDDEN)) return;
    var sets = [];
    var params = [];
    var idx = 1;
    if (b.phase !== undefined) { sets.push('phase = $' + idx++); params.push(b.phase); }
    if (b.items !== undefined) { sets.push('items = $' + idx++); params.push(JSON.stringify(b.items)); }
    if (!sets.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '수정할 항목이 없습니다.' });
    sets.push('version = version + 1');
    params.push(req.params.id);
    var idIdx = idx++;
    params.push(req.tenant.id);
    var sql = 'UPDATE checklists SET ' + sets.join(', ') + ' WHERE id = $' + idIdx + ' AND tenant_id = $' + idx++;
    // v13.213: version 을 보내면 비교한다(items 배열 통째 저장이라 동시 편집 시 서로 덮어썼다). 안 보내면 예전처럼 무조건 저장.
    if (b.version != null) { sql += ' AND version = $' + idx++; params.push(Number(b.version)); }
    var r = await db.query(sql + ' RETURNING *', params);
    if (!r.rows.length) {
      var latest = await db.query('SELECT * FROM checklists WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
      if (!latest.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
      return lock.sendConflict(res, latest.rows[0], b.version);
    }
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[checklists/update]', e);
  }
});

// DELETE /api/checklists/:id
router.delete('/:id', async function (req, res) {
  try {
    var cur = await db.query('SELECT project_id FROM checklists WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!await ps.gateEdit(req, res, cur.rows[0].project_id, CHK_FORBIDDEN)) return;
    var r = await db.query('DELETE FROM checklists WHERE id = $1 AND tenant_id = $2 RETURNING id', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[checklists/delete]', e);
  }
});

module.exports = router;
