var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');

// ─── POST /api/license/activate — 라이선스 키 활성화 ───
router.post('/activate', auth.authenticate, tenant.tenantScope, auth.requireRole('admin'), async function (req, res) {
  try {
    var key = (req.body.license_key || '').trim();
    if (!key) {
      return res.status(400).json({ error: 'VALIDATION', message: '라이선스 키를 입력해 주세요.' });
    }

    // 라이선스 조회
    var lr = await db.query(
      "SELECT * FROM licenses WHERE license_key = $1 AND status = 'active'",
      [key]
    );
    if (!lr.rows.length) {
      return res.status(404).json({ error: 'INVALID_LICENSE', message: '유효하지 않은 라이선스 키입니다.' });
    }

    var license = lr.rows[0];

    // 만료 확인
    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      await db.query("UPDATE licenses SET status = 'expired' WHERE id = $1", [license.id]);
      return res.status(400).json({ error: 'LICENSE_EXPIRED', message: '만료된 라이선스 키입니다.' });
    }

    // 이미 다른 테넌트에 활성화된 경우
    if (license.tenant_id && license.tenant_id !== req.tenant.id) {
      return res.status(409).json({ error: 'ALREADY_ACTIVATED', message: '이미 다른 조직에서 사용 중인 라이선스입니다.' });
    }

    // 라이선스 활성화
    await db.query(
      'UPDATE licenses SET tenant_id = $1, activated_at = now() WHERE id = $2',
      [req.tenant.id, license.id]
    );

    // 테넌트 플랜 업데이트
    await db.query(
      'UPDATE tenants SET plan = $1, max_users = GREATEST(max_users, $2), updated_at = now() WHERE id = $3',
      [license.plan, license.max_users, req.tenant.id]
    );

    res.json({
      data: {
        plan: license.plan,
        max_users: license.max_users,
        features: license.features,
        expires_at: license.expires_at
      },
      message: '라이선스가 활성화되었습니다.'
    });
  } catch (e) {
    console.error('[license/activate]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── GET /api/license/status — 현재 라이선스 상태 ───
router.get('/status', auth.authenticate, tenant.tenantScope, async function (req, res) {
  try {
    var r = await db.query(
      "SELECT l.*, t.plan as tenant_plan, t.max_users as tenant_max_users FROM licenses l " +
      "JOIN tenants t ON l.tenant_id = t.id WHERE l.tenant_id = $1 AND l.status = 'active' ORDER BY l.activated_at DESC LIMIT 1",
      [req.tenant.id]
    );

    if (!r.rows.length) {
      return res.json({ data: { licensed: false, plan: 'free' } });
    }

    var license = r.rows[0];
    var isExpired = license.expires_at && new Date(license.expires_at) < new Date();

    res.json({
      data: {
        licensed: !isExpired,
        plan: license.plan,
        max_users: license.max_users,
        features: license.features,
        expires_at: license.expires_at,
        activated_at: license.activated_at,
        expired: isExpired
      }
    });
  } catch (e) {
    console.error('[license/status]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── POST /api/license/generate — 라이선스 키 생성 (시스템 관리자용) ───
router.post('/generate', auth.authenticate, auth.requireRole('admin'), async function (req, res) {
  try {
    var b = req.body;
    var key = 'WM-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' +
              crypto.randomBytes(4).toString('hex').toUpperCase() + '-' +
              crypto.randomBytes(4).toString('hex').toUpperCase() + '-' +
              crypto.randomBytes(4).toString('hex').toUpperCase();

    var r = await db.query(
      'INSERT INTO licenses (license_key, plan, max_users, features, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [
        key, b.plan || 'enterprise',
        b.max_users || 100, JSON.stringify(b.features || ['sso', 'white_label', 'api_access', 'ai', 'telegram']),
        b.expires_at || null
      ]
    );

    res.status(201).json({ data: r.rows[0], message: '라이선스 키가 생성되었습니다.' });
  } catch (e) {
    console.error('[license/generate]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
