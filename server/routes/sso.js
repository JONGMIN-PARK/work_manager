var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var planGate = require('../middleware/plan-gate');
var authService = require('../services/auth.service');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ─── GET /api/sso/config — SSO 설정 조회 (admin) ───
router.get('/config', auth.requireRole('admin'), async function (req, res) {
  try {
    var r = await db.query(
      'SELECT id, provider, enabled, entity_id, sso_url, metadata_url, settings, created_at, updated_at FROM sso_configs WHERE tenant_id = $1',
      [req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[sso/config]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── POST /api/sso/config — SSO 설정 생성/수정 (admin, enterprise only) ───
router.post('/config', auth.requireRole('admin'), planGate('sso'), async function (req, res) {
  try {
    var b = req.body;
    if (!b.provider || !b.sso_url) {
      return res.status(400).json({ error: 'VALIDATION', message: 'provider와 sso_url은 필수입니다.' });
    }

    var r = await db.query(
      "INSERT INTO sso_configs (tenant_id, provider, enabled, entity_id, sso_url, certificate, metadata_url, settings) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) " +
      "ON CONFLICT (tenant_id, provider) DO UPDATE SET " +
      "enabled = $3, entity_id = $4, sso_url = $5, certificate = $6, metadata_url = $7, settings = $8, updated_at = now() " +
      "RETURNING *",
      [
        req.tenant.id, b.provider, b.enabled !== false,
        b.entity_id || null, b.sso_url, b.certificate || null,
        b.metadata_url || null, JSON.stringify(b.settings || {})
      ]
    );

    await authService.auditLog(req.user.sub, 'sso_config_update', 'sso_config', r.rows[0].id, { provider: b.provider }, req);
    res.json({ data: r.rows[0], message: 'SSO 설정이 저장되었습니다.' });
  } catch (e) {
    console.error('[sso/config/save]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── DELETE /api/sso/config/:id — SSO 설정 삭제 ───
router.delete('/config/:id', auth.requireRole('admin'), async function (req, res) {
  try {
    var r = await db.query(
      'DELETE FROM sso_configs WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: 'SSO 설정이 삭제되었습니다.' });
  } catch (e) {
    console.error('[sso/config/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── POST /api/sso/saml/login — SAML 로그인 시작 ───
router.post('/saml/login', async function (req, res) {
  try {
    var ssoConfig = await db.query(
      "SELECT * FROM sso_configs WHERE tenant_id = $1 AND provider = 'saml' AND enabled = true",
      [req.tenant.id]
    );
    if (!ssoConfig.rows.length) {
      return res.status(404).json({ error: 'SSO_NOT_CONFIGURED', message: 'SAML SSO가 설정되지 않았습니다.' });
    }
    var cfg = ssoConfig.rows[0];

    // SAML AuthnRequest 생성
    var requestId = '_' + crypto.randomBytes(16).toString('hex');
    var issueInstant = new Date().toISOString();
    var entityId = cfg.entity_id || ('urn:workmanager:tenant:' + req.tenant.id);

    var samlRequest = '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ' +
      'xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ' +
      'ID="' + requestId + '" Version="2.0" IssueInstant="' + issueInstant + '" ' +
      'Destination="' + cfg.sso_url + '" ' +
      'AssertionConsumerServiceURL="' + (req.protocol + '://' + req.get('host') + '/api/sso/saml/callback') + '" ' +
      'ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">' +
      '<saml:Issuer>' + entityId + '</saml:Issuer>' +
      '<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>' +
      '</samlp:AuthnRequest>';

    var encoded = Buffer.from(samlRequest).toString('base64');

    res.json({
      data: {
        redirectUrl: cfg.sso_url + '?SAMLRequest=' + encodeURIComponent(encoded),
        requestId: requestId
      }
    });
  } catch (e) {
    console.error('[sso/saml/login]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── POST /api/sso/saml/callback — SAML 응답 처리 (JIT 프로비저닝) ───
router.post('/saml/callback', async function (req, res) {
  try {
    var samlResponse = req.body.SAMLResponse;
    if (!samlResponse) {
      return res.status(400).json({ error: 'VALIDATION', message: 'SAMLResponse가 필요합니다.' });
    }

    // Base64 디코딩
    var xml = Buffer.from(samlResponse, 'base64').toString('utf8');

    // 간단한 XML 파싱 (이메일, 이름 추출)
    var emailMatch = xml.match(/<(?:saml:)?NameID[^>]*>([^<]+)<\/(?:saml:)?NameID>/);
    var nameMatch = xml.match(/<(?:saml:)?Attribute\s+Name="(?:http:\/\/schemas\.xmlsoap\.org\/ws\/2005\/05\/identity\/claims\/)?(?:displayname|name|givenname)"[^>]*>\s*<(?:saml:)?AttributeValue[^>]*>([^<]+)/i);

    if (!emailMatch) {
      return res.status(400).json({ error: 'SAML_PARSE_ERROR', message: 'SAML 응답에서 이메일을 추출할 수 없습니다.' });
    }

    var email = emailMatch[1].toLowerCase().trim();
    var displayName = nameMatch ? nameMatch[1].trim() : email.split('@')[0];

    // SSO 설정에서 tenant_id 확인
    var ssoConfig = await db.query(
      "SELECT sc.*, t.id as tid FROM sso_configs sc JOIN tenants t ON sc.tenant_id = t.id WHERE sc.tenant_id = $1 AND sc.provider = 'saml' AND sc.enabled = true",
      [req.tenant.id]
    );
    if (!ssoConfig.rows.length) {
      return res.status(400).json({ error: 'SSO_NOT_CONFIGURED' });
    }

    // JIT 프로비저닝: 사용자 조회 또는 자동 생성
    var user = await authService.findUserByEmail(email);
    if (!user) {
      // 신규 사용자 자동 생성
      var randomPw = crypto.randomBytes(32).toString('hex');
      var hash = await authService.hashPassword(randomPw);

      var result = await db.query(
        "INSERT INTO users (email, password_hash, name, display_name, status, tenant_id) VALUES ($1, $2, $3, $4, 'active', $5) RETURNING *",
        [email, hash, displayName, displayName, req.tenant.id]
      );
      user = result.rows[0];

      await authService.auditLog(user.id, 'sso_jit_provision', 'user', user.id, { email: email, provider: 'saml' }, req);
    } else {
      // 기존 사용자 — tenant_id 확인/업데이트
      if (!user.tenant_id) {
        await db.query('UPDATE users SET tenant_id = $1 WHERE id = $2', [req.tenant.id, user.id]);
      }
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'INACTIVE', message: '비활성화된 계정입니다.' });
    }

    // JWT 발급
    var accessToken = await authService.signAccessToken(user);
    var refreshToken = authService.signRefreshToken(user);
    await authService.saveRefreshToken(user.id, refreshToken, 'saml-sso');

    await authService.auditLog(user.id, 'login_sso', 'user', user.id, { provider: 'saml' }, req);

    // 프론트엔드로 토큰 전달
    res.redirect('/?ssoAuth=' + encodeURIComponent(JSON.stringify({
      accessToken: accessToken,
      refreshToken: refreshToken
    })));
  } catch (e) {
    console.error('[sso/saml/callback]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
