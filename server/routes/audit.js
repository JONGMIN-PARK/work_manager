var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScopeOptional);
router.use(auth.requireRole('admin'));

// GET /api/audit — 감사 로그 조회
router.get('/', async function (req, res) {
  try {
    var q = req.query;
    var where = [];
    var params = [];
    var idx = 1;

    if (req.tenant) {
      where.push('a.tenant_id = $' + idx++);
      params.push(req.tenant.id);
    }

    if (q.userId) { where.push('a.user_id = $' + idx++); params.push(q.userId); }
    if (q.action) { where.push('a.action = $' + idx++); params.push(q.action); }
    if (q.targetType) { where.push('a.target_type = $' + idx++); params.push(q.targetType); }
    // v13.435 날짜 조회는 대한민국 하루 기준 (00:00~23:59:59 KST)
    var isDay = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v)); };
    if (q.from) { where.push('a.created_at >= $' + idx++); params.push(isDay(q.from) ? q.from + 'T00:00:00+09:00' : q.from); }
    if (q.to) { where.push('a.created_at <= $' + idx++); params.push(isDay(q.to) ? q.to + 'T23:59:59.999+09:00' : q.to); }
    if (q.search) {
      where.push('(u.name ILIKE $' + idx + ' OR u.email ILIKE $' + idx + ' OR a.action ILIKE $' + idx + ')');
      params.push('%' + q.search + '%');
      idx++;
    }

    var limit = Math.min(parseInt(q.limit, 10) || 100, 500);
    var offset = parseInt(q.offset, 10) || 0;

    var sql = 'SELECT a.*, u.name as user_name, u.email as user_email FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id';
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    else sql += ' WHERE 1=1';
    sql += ' ORDER BY a.created_at DESC LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(limit, offset);

    var countSql = 'SELECT COUNT(*) as total FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id';
    if (where.length) countSql += ' WHERE ' + where.join(' AND ');

    var r = await db.query(sql, params);
    var countR = await db.query(countSql, params.slice(0, params.length - 2));

    res.json({
      data: r.rows,
      total: parseInt(countR.rows[0].total, 10),
      limit: limit,
      offset: offset
    });
  } catch (e) {
    httpErr.serverError(res, '[audit/list]', e);
  }
});

// GET /api/audit/actions — 사용 가능한 액션 목록
router.get('/actions', async function (req, res) {
  try {
    var actSql = 'SELECT DISTINCT action FROM audit_logs';
    var actParams = [];
    if (req.tenant) { actSql += ' WHERE tenant_id = $1'; actParams.push(req.tenant.id); }
    actSql += ' ORDER BY action';
    var r = await db.query(actSql, actParams);
    res.json({ data: r.rows.map(function (row) { return row.action; }) });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
