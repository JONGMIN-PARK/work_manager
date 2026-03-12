var bcrypt = require('bcryptjs');
var jwt = require('jsonwebtoken');
var crypto = require('crypto');
var config = require('../config');
var db = require('../config/db');

// ─── 비밀번호 ───
function hashPassword(plain) {
  return bcrypt.hash(plain, config.bcryptRounds);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// 비밀번호 정책: 8자 이상, 영문+숫자+특수문자 중 2종 이상
function validatePassword(pw) {
  if (!pw || pw.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  var types = 0;
  if (/[a-zA-Z]/.test(pw)) types++;
  if (/[0-9]/.test(pw)) types++;
  if (/[^a-zA-Z0-9]/.test(pw)) types++;
  if (types < 2) return '영문, 숫자, 특수문자 중 2종 이상 포함해야 합니다.';
  return null;
}

// ─── JWT ───
function signAccessToken(user) {
  var payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    departmentId: user.department_id || null
  };
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.accessExpiresIn });
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

function signRefreshToken(user) {
  var payload = { sub: user.id, type: 'refresh' };
  return jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

// ─── Refresh Token DB 관리 ───
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function saveRefreshToken(userId, token, deviceInfo) {
  var tokenHash = hashToken(token);
  var expiresAt = new Date(Date.now() + config.jwt.refreshExpiresInMs);

  // 디바이스 수 제한 — 초과 시 가장 오래된 것 삭제
  var countRes = await db.query(
    'SELECT COUNT(*) as cnt FROM refresh_tokens WHERE user_id = $1',
    [userId]
  );
  var cnt = parseInt(countRes.rows[0].cnt, 10);
  if (cnt >= config.maxDevices) {
    await db.query(
      'DELETE FROM refresh_tokens WHERE id = (SELECT id FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1)',
      [userId]
    );
  }

  await db.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, device_info, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, tokenHash, deviceInfo || 'unknown', expiresAt]
  );
}

async function findRefreshToken(token) {
  var tokenHash = hashToken(token);
  var res = await db.query(
    'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now()',
    [tokenHash]
  );
  return res.rows[0] || null;
}

async function deleteRefreshToken(token) {
  var tokenHash = hashToken(token);
  await db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
}

async function deleteAllUserTokens(userId) {
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}

// ─── 사용자 조회 ───
async function findUserByEmail(email) {
  var res = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return res.rows[0] || null;
}

async function findUserById(id) {
  var res = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return res.rows[0] || null;
}

// ─── 로그인 실패 잠금 ───
async function incrementLoginFail(userId) {
  var res = await db.query(
    'UPDATE users SET login_fail_count = login_fail_count + 1, updated_at = now() WHERE id = $1 RETURNING login_fail_count',
    [userId]
  );
  var count = res.rows[0].login_fail_count;
  if (count >= config.loginLock.maxAttempts) {
    var until = new Date(Date.now() + config.loginLock.lockMinutes * 60 * 1000);
    await db.query(
      'UPDATE users SET locked_until = $1, updated_at = now() WHERE id = $2',
      [until, userId]
    );
  }
  return count;
}

async function resetLoginFail(userId) {
  await db.query(
    'UPDATE users SET login_fail_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now() WHERE id = $1',
    [userId]
  );
}

function isLocked(user) {
  return user.locked_until && new Date(user.locked_until) > new Date();
}

// ─── 감사 로그 ───
async function auditLog(userId, action, targetType, targetId, detail, req) {
  var ip = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '') : '';
  var ua = req ? (req.headers['user-agent'] || '') : '';
  await db.query(
    'INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, ip_address, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [userId, action, targetType, targetId, detail ? JSON.stringify(detail) : null, ip, ua]
  );
}

// ─── 사용자 정보 정제 (비밀번호 제거) ───
function sanitizeUser(user) {
  if (!user) return null;
  var u = Object.assign({}, user);
  delete u.password_hash;
  return u;
}

module.exports = {
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  validatePassword: validatePassword,
  signAccessToken: signAccessToken,
  verifyAccessToken: verifyAccessToken,
  signRefreshToken: signRefreshToken,
  verifyRefreshToken: verifyRefreshToken,
  hashToken: hashToken,
  saveRefreshToken: saveRefreshToken,
  findRefreshToken: findRefreshToken,
  deleteRefreshToken: deleteRefreshToken,
  deleteAllUserTokens: deleteAllUserTokens,
  findUserByEmail: findUserByEmail,
  findUserById: findUserById,
  incrementLoginFail: incrementLoginFail,
  resetLoginFail: resetLoginFail,
  isLocked: isLocked,
  auditLog: auditLog,
  sanitizeUser: sanitizeUser
};
