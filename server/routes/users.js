var express = require('express');
var router = express.Router();
var db = require('../config/db');
var authService = require('../services/auth.service');
var authMiddleware = require('../middleware/auth');
var emailService = require('../services/email.service');

// 모든 라우트에 인증 필요
router.use(authMiddleware.authenticate);

// ─── GET /api/users ───
router.get('/', async function (req, res) {
  try {
    var role = req.user.role;
    var sql, params;

    if (role === 'admin') {
      sql = "SELECT id, email, name, display_name, role, department_id, position, phone, status, created_at, last_login_at FROM users ORDER BY created_at DESC";
      params = [];
    } else if (role === 'manager') {
      sql = "SELECT id, email, name, display_name, role, department_id, position, phone, status, created_at, last_login_at FROM users WHERE department_id = $1 ORDER BY name";
      params = [req.user.departmentId];
    } else if (role === 'executive') {
      sql = "SELECT id, email, name, display_name, role, department_id, position, status, created_at FROM users WHERE status = 'active' ORDER BY name";
      params = [];
    } else {
      return res.status(403).json({ error: 'FORBIDDEN', message: '권한이 없습니다.' });
    }

    var result = await db.query(sql, params);
    res.json({ data: result.rows });
  } catch (e) {
    console.error('[users/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' });
  }
});

// ─── GET /api/users/pending ─── (admin only)
router.get('/pending', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var result = await db.query(
      "SELECT id, email, name, position, phone, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC"
    );
    res.json({ data: result.rows });
  } catch (e) {
    console.error('[users/pending]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' });
  }
});

// ─── PUT /api/users/:id/approve ─── (admin only)
router.put('/:id/approve', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var userId = req.params.id;
    var body = req.body;
    var role = body.role || 'member';
    var departmentId = body.departmentId || null;

    var validRoles = ['admin', 'executive', 'manager', 'member'];
    if (validRoles.indexOf(role) < 0) {
      return res.status(400).json({ error: 'VALIDATION', message: '유효하지 않은 역할입니다.' });
    }

    var result = await db.query(
      "UPDATE users SET status = 'active', role = $1, department_id = $2, approved_by = $3, approved_at = now(), updated_at = now() WHERE id = $4 AND status = 'pending' RETURNING id, email, name, role, status",
      [role, departmentId, req.user.sub, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '승인 대기 중인 사용자를 찾을 수 없습니다.' });
    }

    await authService.auditLog(req.user.sub, 'approve_user', 'user', userId, { role: role }, req);

    // 이메일 알림 (비동기, 실패해도 승인은 유지)
    var approved = result.rows[0];
    var tpl = emailService.approvalEmail(approved.name, role);
    emailService.sendMail(approved.email, tpl.subject, tpl.html).catch(function () {});

    res.json({ data: approved, message: '사용자가 승인되었습니다.' });
  } catch (e) {
    console.error('[users/approve]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' });
  }
});

// ─── PUT /api/users/:id/reject ─── (admin only)
router.put('/:id/reject', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var userId = req.params.id;
    var reason = (req.body.reason || '').trim();

    var result = await db.query(
      "UPDATE users SET status = 'rejected', reject_reason = $1, approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $3 AND status = 'pending' RETURNING id, email, name, status",
      [reason || null, req.user.sub, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '승인 대기 중인 사용자를 찾을 수 없습니다.' });
    }

    await authService.auditLog(req.user.sub, 'reject_user', 'user', userId, { reason: reason }, req);

    // 이메일 알림
    var rejected = result.rows[0];
    var tpl = emailService.rejectionEmail(rejected.name, reason);
    emailService.sendMail(rejected.email, tpl.subject, tpl.html).catch(function () {});

    res.json({ data: rejected, message: '가입이 거절되었습니다.' });
  } catch (e) {
    console.error('[users/reject]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' });
  }
});

// ─── PUT /api/users/:id/role ─── (admin only)
router.put('/:id/role', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var userId = req.params.id;
    var role = req.body.role;

    var validRoles = ['admin', 'executive', 'manager', 'member'];
    if (!role || validRoles.indexOf(role) < 0) {
      return res.status(400).json({ error: 'VALIDATION', message: '유효하지 않은 역할입니다.' });
    }

    // 자기 자신의 역할은 변경 불가
    if (userId === req.user.sub) {
      return res.status(400).json({ error: 'VALIDATION', message: '본인의 역할은 변경할 수 없습니다.' });
    }

    var result = await db.query(
      "UPDATE users SET role = $1, updated_at = now() WHERE id = $2 AND status = 'active' RETURNING id, email, name, role",
      [role, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
    }

    await authService.auditLog(req.user.sub, 'change_role', 'user', userId, { newRole: role }, req);

    res.json({ data: result.rows[0], message: '역할이 변경되었습니다.' });
  } catch (e) {
    console.error('[users/role]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' });
  }
});

// ─── PUT /api/users/:id/status ─── (admin only)
router.put('/:id/status', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var userId = req.params.id;
    var status = req.body.status;

    if (!status || ['active', 'inactive'].indexOf(status) < 0) {
      return res.status(400).json({ error: 'VALIDATION', message: '유효하지 않은 상태입니다.' });
    }

    if (userId === req.user.sub) {
      return res.status(400).json({ error: 'VALIDATION', message: '본인 계정은 비활성화할 수 없습니다.' });
    }

    var result = await db.query(
      'UPDATE users SET status = $1, updated_at = now() WHERE id = $2 RETURNING id, email, name, status',
      [status, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
    }

    // 비활성화 시 모든 세션 만료
    if (status === 'inactive') {
      await authService.deleteAllUserTokens(userId);
    }

    await authService.auditLog(req.user.sub, 'change_status', 'user', userId, { newStatus: status }, req);

    res.json({ data: result.rows[0], message: '상태가 변경되었습니다.' });
  } catch (e) {
    console.error('[users/status]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' });
  }
});

// ─── PUT /api/users/:id/department ─── (admin only)
router.put('/:id/department', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var userId = req.params.id;
    var departmentId = req.body.departmentId || null;

    var result = await db.query(
      'UPDATE users SET department_id = $1, updated_at = now() WHERE id = $2 RETURNING id, email, name, department_id',
      [departmentId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
    }

    await authService.auditLog(req.user.sub, 'change_department', 'user', userId, { departmentId: departmentId }, req);

    res.json({ data: result.rows[0], message: '부서가 변경되었습니다.' });
  } catch (e) {
    console.error('[users/department]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' });
  }
});

// ─── POST /api/users/:id/reset-password ─── (admin only)
router.post('/:id/reset-password', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var userId = req.params.id;
    // 임시 비밀번호 생성 (8자 랜덤)
    var crypto = require('crypto');
    var tempPw = crypto.randomBytes(4).toString('hex') + '!A1';

    var hash = await authService.hashPassword(tempPw);
    var result = await db.query(
      'UPDATE users SET password_hash = $1, password_changed_at = now(), updated_at = now() WHERE id = $2 RETURNING id, email, name',
      [hash, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
    }

    await db.query(
      'INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)',
      [userId, hash]
    );

    // 세션 전부 삭제
    await authService.deleteAllUserTokens(userId);

    await authService.auditLog(req.user.sub, 'reset_password', 'user', userId, null, req);

    // 이메일로 임시 비밀번호 전달
    var resetUser = result.rows[0];
    var tpl = emailService.passwordResetEmail(resetUser.name, tempPw);
    emailService.sendMail(resetUser.email, tpl.subject, tpl.html).catch(function () {});

    res.json({
      data: { user: resetUser, temporaryPassword: tempPw },
      message: '비밀번호가 초기화되었습니다. 임시 비밀번호를 사용자에게 전달하세요.'
    });
  } catch (e) {
    console.error('[users/reset-password]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' });
  }
});

// ─── GET /api/users/departments ─── (admin, manager)
router.get('/departments', async function (req, res) {
  try {
    var result = await db.query(
      'SELECT id, name, parent_id, sort_order FROM departments ORDER BY sort_order, name'
    );
    res.json({ data: result.rows });
  } catch (e) {
    console.error('[users/departments]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
