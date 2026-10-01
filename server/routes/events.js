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

/* ── 일정 권한 (v13.213) ──────────────────────────────────────────────────
 *  보기:  목록과 같은 규칙 — 연결 프로젝트 중 하나라도 볼 수 있거나, 개인 일정이면 작성자
 *  수정/삭제: 관리자 · 작성자 · (프로젝트 일정이면) 연결 프로젝트 중 하나라도 편집 가능한 사람
 *  프로젝트 연결(생성·변경 시 새로 붙이는 것): 그 프로젝트를 모두 편집할 수 있어야 한다
 */
function _pids(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (typeof v === 'string') { try { var a = JSON.parse(v); return Array.isArray(a) ? a.filter(Boolean).map(String) : []; } catch (_) { return []; } }
  return [];
}

// 새로 연결하려는 프로젝트가 모두 이 테넌트에 있고 편집 가능한지. 실패 시 응답 후 false.
async function _gateLink(req, res, ids) {
  for (var i = 0; i < ids.length; i++) {
    var can = await ps.canEditById(req, ids[i]);
    if (can === null) { res.status(400).json({ error: 'BAD_REQUEST', message: '존재하지 않는 프로젝트가 포함되어 있습니다.' }); return false; }
    if (!can) { res.status(403).json({ error: 'FORBIDDEN', message: '편집 권한이 있는 프로젝트에만 일정을 연결할 수 있습니다.' }); return false; }
  }
  return true;
}

async function _canModifyEvent(req, ev) {
  if (req.user.role === 'admin') return true;
  if (ev.created_by === req.user.sub) return true;
  var ids = _pids(ev.project_ids);
  for (var i = 0; i < ids.length; i++) {
    if (await ps.canEditById(req, ids[i])) return true;
  }
  return false;
}

async function _canSeeEvent(req, ev) {
  var ids = _pids(ev.project_ids);
  if (!ids.length) return ev.created_by === req.user.sub || req.user.role === 'admin';
  for (var i = 0; i < ids.length; i++) {
    if (await ps.canReadById(req, ids[i])) return true;
  }
  return false;
}

// 수정/삭제 대상 일정 로드 + 권한 확인. 실패 시 응답 후 null.
async function _loadForModify(req, res) {
  var r = await db.query('SELECT id, created_by, project_ids FROM events WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
  if (!r.rows.length) { res.status(404).json({ error: 'NOT_FOUND' }); return null; }
  if (!await _canModifyEvent(req, r.rows[0])) {
    res.status(403).json({ error: 'FORBIDDEN', message: '작성자 또는 연결된 프로젝트의 참여자만 일정을 수정할 수 있습니다.' });
    return null;
  }
  return r.rows[0];
}

// GET /api/events — v13.34 가시성:
//   project_ids 배열에 접근 가능한 프로젝트가 하나라도 있으면 노출,
//   배열이 비어있으면(개인 일정) 작성자 본인만 노출
router.get('/', async function (req, res) {
  try {
    var where = [];
    var params = [];
    var idx = 1;

    where.push('tenant_id = $' + idx++);
    params.push(req.tenant.id);

    if (req.query.from && req.query.to) {
      where.push('start_date <= $' + idx++ + ' AND end_date >= $' + idx++);
      params.push(req.query.to, req.query.from);
    }
    // 가시성 절: JSONB 배열의 각 요소를 풀어 접근 가능 프로젝트와 매칭
    var meIdx = idx++;
    params.push(req.user.sub);
    var sub = ps.accessibleProjectsSubquery(req, idx);
    where.push(
      '(' +
        '(jsonb_array_length(COALESCE(project_ids, \'[]\'::jsonb)) = 0 AND created_by = $' + meIdx + ')' +
        ' OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(project_ids, \'[]\'::jsonb)) AS _pid WHERE _pid IN (' + sub.sql + '))' +
      ')'
    );
    params = params.concat(sub.params);
    idx = sub.nextIdx;

    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM events' + (where.length ? ' WHERE ' + where.join(' AND ') : '');

    var pg = parsePagination(req.query, 100);
    sql += ' ORDER BY start_date';
    sql += ' LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);
    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    httpErr.serverError(res, '[events/list]', e);
  }
});

// GET /api/events/:id
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM events WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!r.rows.length || !await _canSeeEvent(req, r.rows[0])) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[events/get]', e);
  }
});

// POST /api/events
router.post('/', async function (req, res) {
  try {
    var b = req.body;
    var pids = _pids(b.projectIds || b.project_ids);
    if (!await _gateLink(req, res, pids)) return;
    var id = b.id || ('evt-' + require('crypto').randomUUID().slice(0, 12));
    var r = await db.query(
      "INSERT INTO events (id, title, type, start_date, end_date, project_ids, assignees, color, memo, repeat, repeat_until, created_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
      [id, b.title || '', b.type || 'etc', b.startDate || b.start_date || '',
       b.endDate || b.end_date || '', JSON.stringify(pids),
       JSON.stringify(b.assignees || []), b.color || null, b.memo || '',
       b.repeat || null, b.repeatUntil || b.repeat_until || null, req.user.sub, req.tenant.id]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[events/create]', e);
  }
});

// PUT /api/events/:id
router.put('/:id', async function (req, res) {
  try {
    var b = req.body;
    var ev = await _loadForModify(req, res);
    if (!ev) return;
    var clean = {};
    if (b.title !== undefined) clean.title = b.title;
    if (b.type !== undefined) clean.type = b.type;
    if (b.startDate !== undefined || b.start_date !== undefined) clean.start_date = (b.startDate !== undefined ? b.startDate : b.start_date) || '';
    if (b.endDate !== undefined || b.end_date !== undefined) clean.end_date = (b.endDate !== undefined ? b.endDate : b.end_date) || '';
    var pidRaw = (b.projectIds !== undefined) ? b.projectIds : b.project_ids;
    if (pidRaw !== undefined) {
      var nextIds = _pids(pidRaw);
      var prevIds = _pids(ev.project_ids);
      // 새로 붙이는 프로젝트만 편집 권한 확인 (원래 연결돼 있던 건 그대로 둘 수 있다)
      if (!await _gateLink(req, res, nextIds.filter(function (x) { return prevIds.indexOf(x) < 0; }))) return;
      clean.project_ids = JSON.stringify(nextIds);
    }
    if (b.assignees !== undefined) clean.assignees = JSON.stringify(b.assignees);
    if (b.color !== undefined) clean.color = b.color;
    if (b.memo !== undefined) clean.memo = b.memo;
    if (b.repeat !== undefined) clean.repeat = b.repeat;
    if (b.repeatUntil !== undefined || b.repeat_until !== undefined) clean.repeat_until = (b.repeatUntil !== undefined ? b.repeatUntil : b.repeat_until);

    var result = await lock.optimisticUpdate(db, 'events', 'id', req.params.id, b.version, clean, undefined, { clause: 'AND tenant_id = $NEXT1', values: [req.tenant.id] });
    if (result.conflict) return lock.sendConflict(res, result.latest, result.yourVersion);
    if (!result.success) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: result.row });
  } catch (e) {
    httpErr.serverError(res, '[events/update]', e);
  }
});

// DELETE /api/events/:id
router.delete('/:id', async function (req, res) {
  try {
    if (!await _loadForModify(req, res)) return;
    var r = await db.query('DELETE FROM events WHERE id = $1 AND tenant_id = $2 RETURNING id', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[events/delete]', e);
  }
});

module.exports = router;
