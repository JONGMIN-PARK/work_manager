var express = require('express');
var router = express.Router();
var db = require('../config/db');
var authService = require('../services/auth.service');
var authMiddleware = require('../middleware/auth');
var emailService = require('../services/email.service');

var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');

// 모든 라우트에 인증 필요
router.use(authMiddleware.authenticate);
router.use(tenant.tenantScopeOptional);

// 호출자 테넌트 ID. 테넌트가 없는 계정은 어떤 행과도 매칭되지 않는 nil UUID 를 쓴다
// (tenantScope 와 동일한 규칙). 이 라우터의 모든 by-id 조회/변경은 이 값으로 스코프한다 —
// 플랫폼 수준(테넌트 횡단) 관리자 역할은 존재하지 않으며 'admin' 은 테넌트 관리자다.
var NIL_TENANT = '00000000-0000-0000-0000-000000000000';
function callerTenant(req) { return (req.tenant && req.tenant.id) || NIL_TENANT; }

// 부서 ID 가 호출자 테넌트 소속인지 (null/빈 값은 '부서 없음'으로 허용)
async function deptInTenant(req, departmentId) {
  if (!departmentId) return true;
  var r = await db.query('SELECT 1 FROM departments WHERE id = $1 AND tenant_id = $2', [departmentId, callerTenant(req)]);
  return r.rows.length > 0;
}

// ─── GET /api/users ───
router.get('/', async function (req, res) {
  try {
    var role = req.user.role;
    var sql, params;
    var tid = callerTenant(req);

    if (role === 'admin') {
      sql = "SELECT id, email, name, display_name, role, department_id, position, phone, status, created_at, last_login_at FROM users WHERE tenant_id = $1 ORDER BY created_at DESC";
      params = [tid];
    } else if (role === 'manager') {
      sql = "SELECT id, email, name, display_name, role, department_id, position, phone, status, created_at, last_login_at FROM users WHERE department_id = $1 AND tenant_id = $2 ORDER BY name";
      params = [req.user.departmentId, tid];
    } else if (role === 'executive') {
      sql = "SELECT id, email, name, display_name, role, department_id, position, status, created_at FROM users WHERE status = 'active' AND tenant_id = $1 ORDER BY name";
      params = [tid];
    } else {
      return res.status(403).json({ error: 'FORBIDDEN', message: '권한이 없습니다.' });
    }

    var result = await db.query(sql, params);
    res.json({ data: result.rows });
  } catch (e) {
    httpErr.serverError(res, '[users/list]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── GET /api/users/lookup ─── 공유/이관용 (id, name만 반환, 인증된 모든 사용자)
router.get('/lookup', async function (req, res) {
  try {
    if (!req.tenant || !req.tenant.id) return res.json({ data: [] });
    var r = await db.query(
      "SELECT id, name, display_name FROM users WHERE tenant_id = $1 AND status = 'active' ORDER BY name",
      [req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[users/lookup]', e);
  }
});

// ─── GET /api/users/pending ─── (admin only)
router.get('/pending', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var result = await db.query(
      "SELECT id, email, name, position, phone, created_at FROM users WHERE status = 'pending' AND tenant_id = $1 ORDER BY created_at ASC",
      [callerTenant(req)]
    );
    res.json({ data: result.rows });
  } catch (e) {
    httpErr.serverError(res, '[users/pending]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── GET /api/users/operator-list ─── 운영자 부여 현황 (admin only)
router.get('/operator-list', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var r = await db.query(
      "SELECT u.id, u.name, u.display_name, u.email, u.role, u.status, " +
      "COALESCE((s.value->>'enabled')::boolean, false) AS operator_enabled " +
      "FROM users u LEFT JOIN user_settings s ON s.user_id = u.id AND s.key = 'operator_mode' " +
      "WHERE u.status = 'active' AND u.tenant_id = $1 ORDER BY u.role, u.name",
      [callerTenant(req)]
    );
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[users/operator-list]', e);
  }
});

// ─── PUT /api/users/:id/operator-mode ─── 운영자 모드 부여/회수 (admin only)
router.put('/:id/operator-mode', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var enabled = !!(req.body && req.body.enabled);
    var ur = await db.query('SELECT id, tenant_id FROM users WHERE id = $1 AND tenant_id = $2', [req.params.id, callerTenant(req)]);
    if (!ur.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
    var tid = ur.rows[0].tenant_id || '00000000-0000-0000-0000-000000000001';
    await db.query(
      "INSERT INTO user_settings (user_id, key, value, updated_at, tenant_id) VALUES ($1, 'operator_mode', $2, NOW(), $3) " +
      "ON CONFLICT (user_id, key) DO UPDATE SET value = $2, updated_at = NOW()",
      [req.params.id, JSON.stringify({ enabled: enabled }), tid]
    );
    res.json({ data: { userId: req.params.id, enabled: enabled } });
  } catch (e) {
    httpErr.serverError(res, '[users/operator-mode]', e);
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
    if (!await deptInTenant(req, departmentId)) {
      return res.status(400).json({ error: 'VALIDATION', message: '유효하지 않은 부서입니다.' });
    }

    var result = await db.query(
      "UPDATE users SET status = 'active', role = $1, department_id = $2, approved_by = $3, approved_at = now(), updated_at = now() WHERE id = $4 AND status = 'pending' AND tenant_id = $5 RETURNING id, email, name, role, status",
      [role, departmentId, req.user.sub, userId, callerTenant(req)]
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
    httpErr.serverError(res, '[users/approve]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── PUT /api/users/:id/reject ─── (admin only)
router.put('/:id/reject', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var userId = req.params.id;
    var reason = (req.body.reason || '').trim();

    var result = await db.query(
      "UPDATE users SET status = 'rejected', reject_reason = $1, approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $3 AND status = 'pending' AND tenant_id = $4 RETURNING id, email, name, status",
      [reason || null, req.user.sub, userId, callerTenant(req)]
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
    httpErr.serverError(res, '[users/reject]', e, '서버 오류가 발생했습니다.');
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
      "UPDATE users SET role = $1, updated_at = now() WHERE id = $2 AND status = 'active' AND tenant_id = $3 RETURNING id, email, name, role",
      [role, userId, callerTenant(req)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
    }

    await authService.auditLog(req.user.sub, 'change_role', 'user', userId, { newRole: role }, req);

    res.json({ data: result.rows[0], message: '역할이 변경되었습니다.' });
  } catch (e) {
    httpErr.serverError(res, '[users/role]', e, '서버 오류가 발생했습니다.');
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
      'UPDATE users SET status = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3 RETURNING id, email, name, status',
      [status, userId, callerTenant(req)]
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
    httpErr.serverError(res, '[users/status]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── PUT /api/users/:id/department ─── (admin only)
router.put('/:id/department', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var userId = req.params.id;
    var departmentId = req.body.departmentId || null;
    if (!await deptInTenant(req, departmentId)) {
      return res.status(400).json({ error: 'VALIDATION', message: '유효하지 않은 부서입니다.' });
    }

    var result = await db.query(
      'UPDATE users SET department_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3 RETURNING id, email, name, department_id',
      [departmentId, userId, callerTenant(req)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
    }

    await authService.auditLog(req.user.sub, 'change_department', 'user', userId, { departmentId: departmentId }, req);

    res.json({ data: result.rows[0], message: '부서가 변경되었습니다.' });
  } catch (e) {
    httpErr.serverError(res, '[users/department]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── POST /api/users/:id/reset-password ─── (admin only)
router.post('/:id/reset-password', authMiddleware.requireRole('admin'), async function (req, res) {
  try {
    var userId = req.params.id;
    // 대상이 호출자 테넌트 소속인지 먼저 확인 — 해시 계산 전에 거르고, UPDATE 에도 조건을 건다
    var tgt = await db.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2', [userId, callerTenant(req)]);
    if (!tgt.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
    // 임시 비밀번호 생성 (8자 랜덤)
    var crypto = require('crypto');
    var tempPw = crypto.randomBytes(4).toString('hex') + '!A1';

    var hash = await authService.hashPassword(tempPw);
    var result = await db.query(
      'UPDATE users SET password_hash = $1, password_changed_at = now(), updated_at = now() WHERE id = $2 AND tenant_id = $3 RETURNING id, email, name',
      [hash, userId, callerTenant(req)]
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
    httpErr.serverError(res, '[users/reset-password]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── GET /api/users/departments ─── (admin, manager)
router.get('/departments', async function (req, res) {
  try {
    var result = await db.query(
      'SELECT id, name, parent_id, sort_order FROM departments WHERE tenant_id = $1 ORDER BY sort_order, name',
      [callerTenant(req)]
    );
    res.json({ data: result.rows });
  } catch (e) {
    httpErr.serverError(res, '[users/departments]', e, '서버 오류가 발생했습니다.');
  }
});

module.exports = router;
