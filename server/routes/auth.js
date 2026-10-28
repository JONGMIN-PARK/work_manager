var express = require('express');
var router = express.Router();
var db = require('../config/db');
var authService = require('../services/auth.service');
var authMiddleware = require('../middleware/auth');
var mindmapAccess = require('../middleware/mindmap-access');
var config = require('../config');
var notificationService = require('../services/notification.service');
var httpErr = require('../lib/http-errors');

// ─── POST /api/auth/register ───
router.post('/register', async function (req, res) {
  try {
    var body = req.body;
    var email = (body.email || '').trim().toLowerCase();
    var password = body.password || '';
    var name = (body.name || '').trim();
    var position = (body.position || '').trim();
    var phone = (body.phone || '').trim();

    if (!email || !name) {
      return res.status(400).json({ error: 'VALIDATION', message: '이메일과 이름은 필수입니다.' });
    }

    var pwErr = authService.validatePassword(password);
    if (pwErr) {
      return res.status(400).json({ error: 'VALIDATION', message: pwErr });
    }

    // 이메일 중복 검사
    var existing = await authService.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'DUPLICATE', message: '이미 등록된 이메일입니다.' });
    }

    var hash = await authService.hashPassword(password);

    var result = await db.query(
      'INSERT INTO users (email, password_hash, name, position, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, role, status, created_at, tenant_id',
      [email, hash, name, position || null, phone || null]
    );
    var user = result.rows[0];
    var newUserTenantId = user.tenant_id;
    delete user.tenant_id;  // 응답 형태는 기존과 동일하게 유지

    // 비밀번호 이력 저장
    await db.query(
      'INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)',
      [user.id, hash]
    );

    await authService.auditLog(user.id, 'register', 'user', user.id, { email: email }, req);

    // 관리자에게 텔레그램 알림
    notificationService.notifyAdmins('user_pending', {
      userName: name,
      pendingUserId: user.id
    }, newUserTenantId).catch(function(e) { console.error('[noti]', e.message); });

    res.status(201).json({
      data: user,
      message: '가입 요청이 접수되었습니다. 관리자 승인을 기다려 주세요.'
    });
  } catch (e) {
    httpErr.serverError(res, '[auth/register]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── POST /api/auth/login ───
router.post('/login', async function (req, res) {
  try {
    var body = req.body;
    var email = (body.email || '').trim().toLowerCase();
    var password = body.password || '';
    var deviceInfo = body.deviceInfo || req.headers['user-agent'] || 'unknown';

    if (!email || !password) {
      return res.status(400).json({ error: 'VALIDATION', message: '이메일과 비밀번호를 입력하세요.' });
    }

    var user = await authService.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'AUTH_FAILED', message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    // 계정 상태 확인
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'PENDING', message: '관리자 승인 대기 중입니다.' });
    }
    if (user.status === 'inactive') {
      return res.status(403).json({ error: 'INACTIVE', message: '비활성화된 계정입니다. 관리자에게 문의하세요.' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ error: 'REJECTED', message: '가입이 거절된 계정입니다.' });
    }

    // 계정 잠금 체크
    if (authService.isLocked(user)) {
      var lockedUntil = new Date(user.locked_until);
      var remainSec = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
      return res.status(423).json({
        error: 'LOCKED',
        message: '로그인 시도 횟수 초과로 계정이 잠겼습니다. ' + Math.ceil(remainSec / 60) + '분 후 다시 시도하세요.',
        lockedUntil: lockedUntil.toISOString()
      });
    }

    // 비밀번호 확인
    var valid = await authService.verifyPassword(password, user.password_hash);
    if (!valid) {
      var failCount = await authService.incrementLoginFail(user.id);
      var maxAttempts = (require('../config').loginLock && require('../config').loginLock.maxAttempts) || 5;
      var remaining = Math.max(0, maxAttempts - failCount);
      var msg = '이메일 또는 비밀번호가 올바르지 않습니다.';
      if (remaining > 0 && remaining <= 2) {
        msg += ' (남은 시도: ' + remaining + '회)';
      } else if (remaining === 0) {
        // 마지막 시도였고 이번 호출에서 잠겼을 가능성
        msg = '로그인 시도 횟수 초과로 계정이 잠겼습니다. 잠시 후 다시 시도하세요.';
        return res.status(423).json({ error: 'LOCKED', message: msg });
      }
      return res.status(401).json({
        error: 'AUTH_FAILED',
        message: msg,
        attemptsRemaining: remaining
      });
    }

    // 로그인 성공
    await authService.resetLoginFail(user.id);

    var accessToken = await authService.signAccessToken(user);
    var refreshToken = authService.signRefreshToken(user);
    await authService.saveRefreshToken(user.id, refreshToken, deviceInfo);

    await authService.auditLog(user.id, 'login', 'user', user.id, null, req);

    res.json({
      data: {
        user: authService.sanitizeUser(user),
        accessToken: accessToken,
        refreshToken: refreshToken
      },
      message: '로그인 성공'
    });
  } catch (e) {
    httpErr.serverError(res, '[auth/login]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── POST /api/auth/refresh ───
router.post('/refresh', async function (req, res) {
  try {
    var refreshToken = req.body.refreshToken;
    if (!refreshToken) {
      return res.status(400).json({ error: 'VALIDATION', message: 'Refresh token이 필요합니다.' });
    }

    // v13.258: 서명 확인(DB 없음)을 먼저 하고, 토큰 · 사용자 조회와 새 토큰 저장 · 내 정보를 동시에 —
    //   예전엔 쿼리 5~6번을 차례로 해 운영(서버 미국 · DB 싱가포르)에서 1초 가까이 걸렸다. 응답 순서 · 오류 코드는 그대로
    var decoded = null;
    try { decoded = authService.verifyRefreshToken(refreshToken); } catch (e) { decoded = null; }
    var got = await Promise.all([
      authService.findRefreshToken(refreshToken),
      decoded ? authService.findUserById(decoded.sub) : null
    ]);
    var stored = got[0], user = got[1];
    if (!stored) {
      return res.status(401).json({ error: 'INVALID_TOKEN', message: '유효하지 않은 refresh token입니다.' });
    }
    if (!decoded) {
      await authService.deleteRefreshToken(refreshToken);
      return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Refresh token이 만료되었습니다.' });
    }
    if (!user || user.status !== 'active') {
      await authService.deleteRefreshToken(refreshToken);
      return res.status(401).json({ error: 'INVALID_USER', message: '유효하지 않은 사용자입니다.' });
    }

    // 기존 토큰 삭제 + 새 토큰 발급 (토큰 로테이션). 화면이 /me 를 따로 부르지 않게 내 정보도 함께
    var newRefreshToken = authService.signRefreshToken(user);
    var done = await Promise.all([
      authService.deleteRefreshToken(refreshToken),
      authService.signAccessToken(user),
      authService.saveRefreshToken(user.id, newRefreshToken, stored.device_info),
      _meData(user).catch(function () { return null; })
    ]);

    res.json({
      data: {
        accessToken: done[1],
        refreshToken: newRefreshToken,
        user: done[3]
      }
    });
  } catch (e) {
    httpErr.serverError(res, '[auth/refresh]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── POST /api/auth/logout ───
router.post('/logout', authMiddleware.authenticate, async function (req, res) {
  try {
    var refreshToken = req.body.refreshToken;
    if (refreshToken) {
      await authService.deleteRefreshToken(refreshToken);
    }
    await authService.auditLog(req.user.sub, 'logout', 'user', req.user.sub, null, req);
    res.json({ message: '로그아웃 되었습니다.' });
  } catch (e) {
    httpErr.serverError(res, '[auth/logout]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── GET /api/auth/me ───
// 내 정보 (/me 와 /refresh 가 같이 씀) — PL 프로젝트 · 운영자 모드 · 마인드맵 권한을 동시에 조회 (v13.258)
async function _meData(user) {
  var r = await Promise.all([
    // PL 프로젝트 목록 (project_members 테이블이 아직 없으면 빈 배열)
    db.query("SELECT project_id FROM project_members WHERE user_id = $1 AND role = 'pl' AND released_at IS NULL", [user.id])
      .then(function (x) { return x.rows.map(function (row) { return row.project_id; }); }, function () { return []; }),
    // 운영자 모드 (admin 자동 또는 user_settings 'operator_mode' 부여)
    user.role === 'admin' ? true : db.query("SELECT value FROM user_settings WHERE user_id = $1 AND key = 'operator_mode'", [user.id])
      .then(function (x) { return !!(x.rows.length && x.rows[0].value && x.rows[0].value.enabled); }, function () { return false; }),
    // 마인드맵 사용 권한 (admin 자동 또는 user_settings 'mindmap_access' 부여)
    mindmapAccess.hasMindmapAccessByUser(user.id, user.role)
  ]);
  var sanitized = authService.sanitizeUser(user);
  sanitized.plProjects = r[0];
  sanitized.operatorMode = r[1];
  sanitized.mindmapAccess = r[2];
  return sanitized;
}

router.get('/me', authMiddleware.authenticate, async function (req, res) {
  try {
    var user = await authService.findUserById(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
    }

    var sanitized = await _meData(user);
    res.json({ data: sanitized });
  } catch (e) {
    httpErr.serverError(res, '[auth/me]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── PUT /api/auth/change-password ───
router.put('/change-password', authMiddleware.authenticate, async function (req, res) {
  try {
    var body = req.body;
    var currentPassword = body.currentPassword || '';
    var newPassword = body.newPassword || '';

    var user = await authService.findUserById(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
    }

    // 현재 비밀번호 확인
    var valid = await authService.verifyPassword(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'AUTH_FAILED', message: '현재 비밀번호가 올바르지 않습니다.' });
    }

    // 새 비밀번호 정책 검사
    var pwErr = authService.validatePassword(newPassword);
    if (pwErr) {
      return res.status(400).json({ error: 'VALIDATION', message: pwErr });
    }

    // 최근 3개 비밀번호 재사용 검사
    var histRes = await db.query(
      'SELECT password_hash FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3',
      [user.id]
    );
    for (var i = 0; i < histRes.rows.length; i++) {
      var reused = await authService.verifyPassword(newPassword, histRes.rows[i].password_hash);
      if (reused) {
        return res.status(400).json({ error: 'VALIDATION', message: '최근 사용한 비밀번호는 재사용할 수 없습니다.' });
      }
    }

    var hash = await authService.hashPassword(newPassword);
    await db.query(
      'UPDATE users SET password_hash = $1, password_changed_at = now(), updated_at = now() WHERE id = $2',
      [hash, user.id]
    );
    await db.query(
      'INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)',
      [user.id, hash]
    );

    // 모든 세션 무효화 (재로그인 유도)
    await authService.deleteAllUserTokens(user.id);

    await authService.auditLog(user.id, 'change_password', 'user', user.id, null, req);

    res.json({ message: '비밀번호가 변경되었습니다. 다시 로그인해 주세요.' });
  } catch (e) {
    httpErr.serverError(res, '[auth/change-password]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── GET /api/auth/google — Google OAuth2 시작 ───
router.get('/google', function (req, res) {
  if (!config.google.clientId) {
    return res.status(501).json({ error: 'NOT_CONFIGURED', message: 'Google OAuth2가 설정되지 않았습니다.' });
  }

  var params = [
    'client_id=' + encodeURIComponent(config.google.clientId),
    'redirect_uri=' + encodeURIComponent(config.google.callbackUrl),
    'response_type=code',
    'scope=' + encodeURIComponent('openid email profile'),
    'access_type=offline',
    'prompt=select_account'
  ].join('&');

  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params);
});

// ─── GET /api/auth/google/callback — Google 콜백 ───
router.get('/google/callback', async function (req, res) {
  try {
    var code = req.query.code;
    if (!code) {
      return res.redirect('/?error=google_auth_failed');
    }

    // 1) Authorization code → tokens
    var tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: [
        'code=' + encodeURIComponent(code),
        'client_id=' + encodeURIComponent(config.google.clientId),
        'client_secret=' + encodeURIComponent(config.google.clientSecret),
        'redirect_uri=' + encodeURIComponent(config.google.callbackUrl),
        'grant_type=authorization_code'
      ].join('&')
    });
    var tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error('[google/callback] token error:', tokenData);
      return res.redirect('/?error=google_token_failed');
    }

    // 2) 사용자 정보 조회
    var profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
    });
    var profile = await profileRes.json();

    if (!profile.email) {
      return res.redirect('/?error=google_no_email');
    }

    var email = profile.email.toLowerCase();
    var name = profile.name || email.split('@')[0];

    // 3) 기존 사용자 확인 또는 신규 생성
    var user = await authService.findUserByEmail(email);

    if (!user) {
      // 신규 가입 — Google 사용자는 바로 active (비밀번호 없이)
      var randomPw = require('crypto').randomBytes(32).toString('hex');
      var hash = await authService.hashPassword(randomPw);

      var result = await db.query(
        "INSERT INTO users (email, password_hash, name, display_name, status, google_id) VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING *",
        [email, hash, name, profile.name || '', profile.id || '']
      );
      user = result.rows[0];

      await authService.auditLog(user.id, 'register_google', 'user', user.id, { email: email }, req);

      // pending 상태면 안내 후 리다이렉트
      return res.redirect('/?info=google_pending');
    }

    // 기존 사용자 상태 확인
    if (user.status === 'pending') {
      return res.redirect('/?info=google_pending');
    }
    if (user.status !== 'active') {
      return res.redirect('/?error=google_inactive');
    }

    // google_id 업데이트 (처음 Google 연동 시)
    if (!user.google_id && profile.id) {
      await db.query('UPDATE users SET google_id = $1 WHERE id = $2', [profile.id, user.id]);
    }

    // 4) JWT 발급
    await authService.resetLoginFail(user.id);
    var accessToken = await authService.signAccessToken(user);
    var refreshToken = authService.signRefreshToken(user);
    await authService.saveRefreshToken(user.id, refreshToken, 'google-oauth');

    await authService.auditLog(user.id, 'login_google', 'user', user.id, null, req);

    // 5) 프론트엔드로 토큰 전달 (URL fragment)
    res.redirect('/?googleAuth=' + encodeURIComponent(JSON.stringify({
      accessToken: accessToken,
      refreshToken: refreshToken
    })));

  } catch (e) {
    console.error('[google/callback]', e);
    res.redirect('/?error=google_server_error');
  }
});

module.exports = router;
