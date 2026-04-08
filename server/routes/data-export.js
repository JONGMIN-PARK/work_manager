var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');

router.use(auth.authenticate);
router.use(tenant.tenantScope);
router.use(auth.requireRole('admin'));

// ─── GET /api/data-export/audit — 감사 로그 내보내기 (CSV) ───
router.get('/audit', async function (req, res) {
  try {
    var q = req.query;
    var where = ['a.tenant_id = $1'];
    var params = [req.tenant.id];
    var idx = 2;

    if (q.from) { where.push('a.created_at >= $' + idx++); params.push(q.from); }
    if (q.to) { where.push('a.created_at <= $' + idx++); params.push(q.to + 'T23:59:59Z'); }
    if (q.action) { where.push('a.action = $' + idx++); params.push(q.action); }

    var sql = 'SELECT a.id, u.name as user_name, u.email as user_email, a.action, a.target_type, a.target_id, ' +
      'a.ip_address, a.user_agent, a.created_at FROM audit_logs a ' +
      'LEFT JOIN users u ON a.user_id = u.id WHERE ' + where.join(' AND ') +
      ' ORDER BY a.created_at DESC LIMIT 10000';

    var r = await db.query(sql, params);

    var format = q.format || 'csv';

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="audit_logs_' + new Date().toISOString().slice(0, 10) + '.json"');
      return res.json({ data: r.rows });
    }

    // CSV
    var header = 'ID,사용자,이메일,액션,대상유형,대상ID,IP,일시\n';
    var csv = r.rows.map(function (row) {
      return [
        row.id,
        '"' + (row.user_name || '').replace(/"/g, '""') + '"',
        row.user_email || '',
        row.action,
        row.target_type || '',
        row.target_id || '',
        row.ip_address || '',
        row.created_at
      ].join(',');
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit_logs_' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.send('\uFEFF' + header + csv); // BOM for Excel
  } catch (e) {
    console.error('[data-export/audit]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── GET /api/data-export/users — 사용자 데이터 내보내기 (GDPR) ───
router.get('/users', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT id, email, name, display_name, role, position, phone, status, last_login_at, created_at FROM users WHERE tenant_id = $1 ORDER BY name',
      [req.tenant.id]
    );

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="users_' + new Date().toISOString().slice(0, 10) + '.json"');
    res.json({ data: r.rows, exported_at: new Date().toISOString(), tenant_id: req.tenant.id });
  } catch (e) {
    console.error('[data-export/users]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── GET /api/data-export/full — 전체 데이터 내보내기 (GDPR 대응) ───
router.get('/full', async function (req, res) {
  try {
    var tid = req.tenant.id;

    var users = await db.query('SELECT id, email, name, role, status, created_at FROM users WHERE tenant_id = $1', [tid]);
    var projects = await db.query('SELECT * FROM projects WHERE tenant_id = $1', [tid]);
    var issues = await db.query('SELECT * FROM issues WHERE tenant_id = $1', [tid]);
    var orders = await db.query('SELECT * FROM orders WHERE tenant_id = $1', [tid]);
    var auditLogs = await db.query('SELECT * FROM audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5000', [tid]);

    var exportData = {
      exported_at: new Date().toISOString(),
      tenant_id: tid,
      users: users.rows,
      projects: projects.rows,
      issues: issues.rows,
      orders: orders.rows,
      audit_logs: auditLogs.rows
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="full_export_' + new Date().toISOString().slice(0, 10) + '.json"');
    res.json(exportData);
  } catch (e) {
    console.error('[data-export/full]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── GET /api/data-export/access-report — 접근 기록 리포트 ───
router.get('/access-report', async function (req, res) {
  try {
    var days = parseInt(req.query.days, 10) || 30;

    // 사용자별 로그인/활동 요약
    var r = await db.query(
      "SELECT u.id, u.name, u.email, u.last_login_at, " +
      "COUNT(CASE WHEN a.action = 'login' THEN 1 END) as login_count, " +
      "COUNT(CASE WHEN a.action = 'login_sso' THEN 1 END) as sso_login_count, " +
      "COUNT(a.id) as total_actions, " +
      "MAX(a.created_at) as last_activity, " +
      "COUNT(DISTINCT a.ip_address) as unique_ips " +
      "FROM users u LEFT JOIN audit_logs a ON u.id = a.user_id AND a.created_at >= now() - interval '" + days + " days' " +
      "WHERE u.tenant_id = $1 GROUP BY u.id, u.name, u.email, u.last_login_at ORDER BY total_actions DESC",
      [req.tenant.id]
    );

    res.json({ data: r.rows, period_days: days });
  } catch (e) {
    console.error('[data-export/access-report]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── GET /api/data-export/retention — 데이터 보관 정책 조회 ───
router.get('/retention', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM data_retention_policies WHERE tenant_id = $1', [req.tenant.id]);
    res.json({
      data: r.rows[0] || {
        audit_logs_days: 365,
        archives_days: 0,
        deleted_data_days: 30,
        auto_purge: false
      }
    });
  } catch (e) {
    console.error('[data-export/retention]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── PUT /api/data-export/retention — 데이터 보관 정책 설정 ───
router.put('/retention', async function (req, res) {
  try {
    var b = req.body;

    var r = await db.query(
      'INSERT INTO data_retention_policies (tenant_id, audit_logs_days, archives_days, deleted_data_days, auto_purge) ' +
      'VALUES ($1, $2, $3, $4, $5) ' +
      'ON CONFLICT (tenant_id) DO UPDATE SET ' +
      'audit_logs_days = $2, archives_days = $3, deleted_data_days = $4, auto_purge = $5, updated_at = now() RETURNING *',
      [
        req.tenant.id,
        b.audit_logs_days != null ? b.audit_logs_days : 365,
        b.archives_days != null ? b.archives_days : 0,
        b.deleted_data_days != null ? b.deleted_data_days : 30,
        b.auto_purge || false
      ]
    );

    res.json({ data: r.rows[0], message: '데이터 보관 정책이 저장되었습니다.' });
  } catch (e) {
    console.error('[data-export/retention]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
