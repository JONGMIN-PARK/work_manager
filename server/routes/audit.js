var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');

router.use(auth.authenticate);
router.use(auth.requireRole('admin'));

// GET /api/audit — 감사 로그 조회
router.get('/', async function (req, res) {
  try {
    var q = req.query;
    var where = [];
    var params = [];
    var idx = 1;

    if (q.userId) { where.push('a.user_id = $' + idx++); params.push(q.userId); }
    if (q.action) { where.push('a.action = $' + idx++); params.push(q.action); }
    if (q.targetType) { where.push('a.target_type = $' + idx++); params.push(q.targetType); }
    if (q.from) { where.push('a.created_at >= $' + idx++); params.push(q.from); }
    if (q.to) { where.push('a.created_at <= $' + idx++); params.push(q.to + 'T23:59:59Z'); }
    if (q.search) {
      where.push('(u.name ILIKE $' + idx + ' OR u.email ILIKE $' + idx + ' OR a.action ILIKE $' + idx + ')');
      params.push('%' + q.search + '%');
      idx++;
    }

    var limit = Math.min(parseInt(q.limit, 10) || 100, 500);
    var offset = parseInt(q.offset, 10) || 0;

    var sql = 'SELECT a.*, u.name as user_name, u.email as user_email FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id';
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
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
    console.error('[audit/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/audit/actions — 사용 가능한 액션 목록
router.get('/actions', async function (req, res) {
  try {
    var r = await db.query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
    res.json({ data: r.rows.map(function (row) { return row.action; }) });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
