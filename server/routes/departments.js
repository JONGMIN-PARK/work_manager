var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var authService = require('../services/auth.service');

router.use(auth.authenticate);

// GET /api/departments — 전체 조직 트리
router.get('/', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM departments ORDER BY sort_order, name');
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[departments/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/departments — 부서 생성 (admin only)
router.post('/', auth.requireRole('admin'), async function (req, res) {
  try {
    var b = req.body;
    var r = await db.query(
      "INSERT INTO departments (name, parent_id, sort_order) VALUES ($1, $2, $3) RETURNING *",
      [b.name || '', b.parentId || b.parent_id || null, b.sortOrder || b.sort_order || 0]
    );
    await authService.auditLog(req.user.sub, 'create_department', 'department', r.rows[0].id, { name: b.name }, req);
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[departments/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/departments/:id — 부서 수정 (admin only)
router.put('/:id', auth.requireRole('admin'), async function (req, res) {
  try {
    var b = req.body;
    var r = await db.query(
      "UPDATE departments SET name = COALESCE($1, name), parent_id = $2, sort_order = COALESCE($3, sort_order) WHERE id = $4 RETURNING *",
      [b.name, b.parentId !== undefined ? b.parentId : b.parent_id, b.sortOrder || b.sort_order, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[departments/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/departments/:id — 부서 삭제 (admin only)
router.delete('/:id', auth.requireRole('admin'), async function (req, res) {
  try {
    // 소속 사용자가 있으면 부서 해제
    await db.query('UPDATE users SET department_id = NULL WHERE department_id = $1', [req.params.id]);
    // 하위 부서 parent 해제
    await db.query('UPDATE departments SET parent_id = NULL WHERE parent_id = $1', [req.params.id]);
    var r = await db.query('DELETE FROM departments WHERE id = $1 RETURNING id, name', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    await authService.auditLog(req.user.sub, 'delete_department', 'department', req.params.id, null, req);
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[departments/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/departments/:id/members — 부서 소속 사용자
router.get('/:id/members', async function (req, res) {
  try {
    var r = await db.query(
      "SELECT id, name, display_name, email, role, position, phone, status FROM users WHERE department_id = $1 AND status = 'active' ORDER BY name",
      [req.params.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[departments/members]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
