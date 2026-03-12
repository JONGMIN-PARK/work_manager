var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var authService = require('../services/auth.service');

router.use(auth.authenticate);

// GET /api/profile — 내 프로필 상세
router.get('/', async function (req, res) {
  try {
    var r = await db.query(
      "SELECT u.id, u.email, u.name, u.display_name, u.role, u.department_id, d.name as department_name, u.position, u.phone, u.status, u.password_changed_at, u.created_at, u.last_login_at FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.id = $1",
      [req.user.sub]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[profile/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/profile — 내 프로필 수정 (이름, 표시명, 연락처)
router.put('/', async function (req, res) {
  try {
    var b = req.body;
    var sets = [];
    var params = [];
    var idx = 1;

    if (b.name !== undefined) { sets.push('name = $' + idx++); params.push(b.name.trim()); }
    if (b.displayName !== undefined || b.display_name !== undefined) {
      sets.push('display_name = $' + idx++);
      params.push((b.displayName || b.display_name || '').trim());
    }
    if (b.phone !== undefined) { sets.push('phone = $' + idx++); params.push(b.phone.trim()); }
    if (b.position !== undefined) { sets.push('position = $' + idx++); params.push(b.position.trim()); }

    if (!sets.length) return res.status(400).json({ error: 'VALIDATION', message: '변경할 항목이 없습니다.' });

    sets.push('updated_at = now()');
    params.push(req.user.sub);

    var sql = 'UPDATE users SET ' + sets.join(', ') + ' WHERE id = $' + idx + ' RETURNING id, email, name, display_name, role, department_id, position, phone';
    var r = await db.query(sql, params);

    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });

    await authService.auditLog(req.user.sub, 'update_profile', 'user', req.user.sub, b, req);
    res.json({ data: r.rows[0], message: '프로필이 수정되었습니다.' });
  } catch (e) {
    console.error('[profile/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/profile/password-status — 비밀번호 변경 안내
router.get('/password-status', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT password_changed_at FROM users WHERE id = $1',
      [req.user.sub]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });

    var changedAt = r.rows[0].password_changed_at;
    var daysSince = changedAt ? Math.floor((Date.now() - new Date(changedAt).getTime()) / 86400000) : 999;
    var needsChange = daysSince >= 90;

    res.json({ data: { passwordChangedAt: changedAt, daysSinceChange: daysSince, needsChange: needsChange } });
  } catch (e) {
    console.error('[profile/password-status]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
