var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var authService = require('../services/auth.service');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScopeOptional);

// GET /api/profile — 내 프로필 상세
router.get('/', async function (req, res) {
  try {
    var sql, params;
    if (req.tenant) {
      sql = "SELECT u.id, u.email, u.name, u.display_name, u.role, u.department_id, d.name as department_name, u.position, u.phone, u.aliases, u.status, u.password_changed_at, u.created_at, u.last_login_at FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.id = $1 AND u.tenant_id = $2";
      params = [req.user.sub, req.tenant.id];
    } else {
      sql = "SELECT u.id, u.email, u.name, u.display_name, u.role, u.department_id, d.name as department_name, u.position, u.phone, u.aliases, u.status, u.password_changed_at, u.created_at, u.last_login_at FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.id = $1";
      params = [req.user.sub];
    }
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[profile/get]', e);
  }
});

// PUT /api/profile — 내 프로필 수정 (이름, 표시명, 연락처)
router.put('/', async function (req, res) {
  try {
    var b = req.body;
    var sets = [];
    var params = [];
    var idx = 1;

    // 처음 이름은 남김 — 바꾸기 전 이름을 reg_name 에 (이미 있으면 그대로, v13.530). SET 안의 name 은 바꾸기 전 값
    if (b.name !== undefined) { sets.push("reg_name = COALESCE(NULLIF(reg_name, ''), name)"); sets.push('name = $' + idx++); params.push(b.name.trim()); }
    if (b.displayName !== undefined || b.display_name !== undefined) {
      sets.push('display_name = $' + idx++);
      params.push((b.displayName || b.display_name || '').trim());
    }
    if (b.phone !== undefined) { sets.push('phone = $' + idx++); params.push(b.phone.trim()); }
    if (b.position !== undefined) { sets.push('position = $' + idx++); params.push(b.position.trim()); }
    // 다른 이름 (v13.540) — 쉼표 · 공백 구분, '@' 떼고 5개 · 이름마다 30자
    if (b.aliases !== undefined) {
      var al = String(b.aliases || '').split(/[,，\n]+/).map(function (x) { return x.trim().replace(/^@+/, '').trim().slice(0, 30); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).slice(0, 5);
      sets.push('aliases = $' + idx++); params.push(al.join(', ') || null);
    }

    if (!sets.length) return res.status(400).json({ error: 'VALIDATION', message: '변경할 항목이 없습니다.' });

    sets.push('updated_at = now()');
    params.push(req.user.sub);
    var userIdx = idx++;

    var sql = 'UPDATE users SET ' + sets.join(', ') + ' WHERE id = $' + userIdx;
    if (req.tenant) {
      params.push(req.tenant.id);
      sql += ' AND tenant_id = $' + idx;
    }
    sql += ' RETURNING id, email, name, display_name, role, department_id, position, phone, aliases';
    var r = await db.query(sql, params);

    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });

    await authService.auditLog(req.user.sub, 'update_profile', 'user', req.user.sub, b, req);
    res.json({ data: r.rows[0], message: '프로필이 수정되었습니다.' });
  } catch (e) {
    httpErr.serverError(res, '[profile/update]', e);
  }
});

// GET /api/profile/password-status — 비밀번호 변경 안내
router.get('/password-status', async function (req, res) {
  try {
    var pwSql = 'SELECT password_changed_at FROM users WHERE id = $1';
    var pwParams = [req.user.sub];
    if (req.tenant) { pwSql += ' AND tenant_id = $2'; pwParams.push(req.tenant.id); }
    var r = await db.query(pwSql, pwParams);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });

    var changedAt = r.rows[0].password_changed_at;
    var daysSince = changedAt ? Math.floor((Date.now() - new Date(changedAt).getTime()) / 86400000) : 999;
    var needsChange = daysSince >= 90;

    res.json({ data: { passwordChangedAt: changedAt, daysSinceChange: daysSince, needsChange: needsChange } });
  } catch (e) {
    httpErr.serverError(res, '[profile/password-status]', e);
  }
});

module.exports = router;
