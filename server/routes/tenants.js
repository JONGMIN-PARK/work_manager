var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../config/db');
var auth = require('../middleware/auth');

router.use(auth.authenticate);

// ─── 초대 테이블 자동 생성 ───
(async function () {
  try {
    await db.query(
      "CREATE TABLE IF NOT EXISTS tenant_invites (" +
      "  id UUID PRIMARY KEY DEFAULT gen_random_uuid()," +
      "  tenant_id UUID NOT NULL REFERENCES tenants(id)," +
      "  token VARCHAR(128) UNIQUE NOT NULL," +
      "  created_by UUID NOT NULL REFERENCES users(id)," +
      "  expires_at TIMESTAMPTZ NOT NULL," +
      "  used_by UUID REFERENCES users(id)," +
      "  used_at TIMESTAMPTZ," +
      "  created_at TIMESTAMPTZ DEFAULT now()" +
      ")"
    );
  } catch (e) {
    console.error('[tenants] tenant_invites 테이블 생성 실패:', e.message);
  }
})();

// POST /api/tenants — 새 테넌트 생성 (조직 가입)
router.post('/', async function (req, res) {
  try {
    var b = req.body;
    if (!b.name || !b.slug) {
      return res.status(400).json({ error: 'VALIDATION', message: 'name과 slug는 필수입니다.' });
    }

    // slug 형식 검증 (영문 소문자, 숫자, 하이픈만 허용)
    if (!/^[a-z0-9-]+$/.test(b.slug)) {
      return res.status(400).json({ error: 'VALIDATION', message: 'slug는 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.' });
    }

    // slug 중복 검사
    var existing = await db.query('SELECT id FROM tenants WHERE slug = $1', [b.slug]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'CONFLICT', message: '이미 사용 중인 slug입니다.' });
    }

    var result = await db.transaction(async function (client) {
      // 테넌트 생성
      var tr = await client.query(
        "INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING *",
        [b.name.trim(), b.slug.trim()]
      );
      var tenant = tr.rows[0];

      // 요청 사용자를 admin으로 설정하고 tenant_id 연결
      await client.query(
        "UPDATE users SET tenant_id = $1, role = 'admin' WHERE id = $2",
        [tenant.id, req.user.sub]
      );

      return tenant;
    });

    res.status(201).json({ data: result });
  } catch (e) {
    console.error('[tenants/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/tenants/me — 현재 사용자의 테넌트 정보
router.get('/me', async function (req, res) {
  try {
    var r = await db.query(
      "SELECT t.* FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE u.id = $1",
      [req.user.sub]
    );
    if (!r.rows.length) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '소속 테넌트가 없습니다.' });
    }
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[tenants/me]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/tenants/me — 테넌트 정보 수정 (admin only)
router.put('/me', auth.requireRole('admin'), async function (req, res) {
  try {
    var b = req.body;
    var sets = [];
    var params = [];
    var idx = 1;

    if (b.name !== undefined) { sets.push('name = $' + idx++); params.push(b.name.trim()); }
    if (b.settings !== undefined) { sets.push('settings = $' + idx++); params.push(JSON.stringify(b.settings)); }

    if (!sets.length) {
      return res.status(400).json({ error: 'VALIDATION', message: '변경할 항목이 없습니다.' });
    }

    sets.push('updated_at = now()');

    // 현재 사용자의 tenant_id 조회
    var ur = await db.query('SELECT tenant_id FROM users WHERE id = $1', [req.user.sub]);
    if (!ur.rows.length || !ur.rows[0].tenant_id) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '소속 테넌트가 없습니다.' });
    }
    params.push(ur.rows[0].tenant_id);

    var sql = 'UPDATE tenants SET ' + sets.join(', ') + ' WHERE id = $' + idx + ' RETURNING *';
    var r = await db.query(sql, params);

    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0], message: '테넌트 정보가 수정되었습니다.' });
  } catch (e) {
    console.error('[tenants/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/tenants/invite — 초대 링크 생성 (admin, manager)
router.post('/invite', auth.requireRole('admin', 'manager'), async function (req, res) {
  try {
    // 현재 사용자의 tenant_id 조회
    var ur = await db.query('SELECT tenant_id FROM users WHERE id = $1', [req.user.sub]);
    if (!ur.rows.length || !ur.rows[0].tenant_id) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '소속 테넌트가 없습니다.' });
    }
    var tenantId = ur.rows[0].tenant_id;

    // 48시간 유효한 토큰 생성
    var token = crypto.randomBytes(32).toString('hex');
    var expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await db.query(
      "INSERT INTO tenant_invites (tenant_id, token, created_by, expires_at) VALUES ($1, $2, $3, $4)",
      [tenantId, token, req.user.sub, expiresAt]
    );

    var inviteUrl = '/api/tenants/join/' + token;
    res.status(201).json({ data: { token: token, inviteUrl: inviteUrl, expiresAt: expiresAt } });
  } catch (e) {
    console.error('[tenants/invite]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/tenants/join/:token — 초대 토큰으로 테넌트 참여
router.post('/join/:token', async function (req, res) {
  try {
    var token = req.params.token;

    // 유효한 초대 토큰 조회
    var ir = await db.query(
      "SELECT * FROM tenant_invites WHERE token = $1 AND used_by IS NULL AND expires_at > now()",
      [token]
    );
    if (!ir.rows.length) {
      return res.status(400).json({ error: 'INVALID_TOKEN', message: '유효하지 않거나 만료된 초대 링크입니다.' });
    }
    var invite = ir.rows[0];

    // 사용자 수 제한 확인
    var tenant = await db.query('SELECT * FROM tenants WHERE id = $1', [invite.tenant_id]);
    if (!tenant.rows.length) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '테넌트를 찾을 수 없습니다.' });
    }
    var memberCount = await db.query(
      'SELECT COUNT(*)::int as cnt FROM users WHERE tenant_id = $1',
      [invite.tenant_id]
    );
    if (memberCount.rows[0].cnt >= tenant.rows[0].max_users) {
      return res.status(403).json({ error: 'LIMIT_EXCEEDED', message: '테넌트 최대 사용자 수를 초과했습니다.' });
    }

    await db.transaction(async function (client) {
      // 사용자 tenant_id 업데이트
      await client.query(
        'UPDATE users SET tenant_id = $1 WHERE id = $2',
        [invite.tenant_id, req.user.sub]
      );
      // 초대 토큰 사용 처리
      await client.query(
        'UPDATE tenant_invites SET used_by = $1, used_at = now() WHERE id = $2',
        [req.user.sub, invite.id]
      );
    });

    res.json({ data: { tenantId: invite.tenant_id }, message: '테넌트에 참여했습니다.' });
  } catch (e) {
    console.error('[tenants/join]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
