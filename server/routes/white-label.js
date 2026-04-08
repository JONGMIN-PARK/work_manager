var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var planGate = require('../middleware/plan-gate');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ─── GET /api/white-label — 화이트라벨 설정 조회 ───
router.get('/', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT * FROM white_label_configs WHERE tenant_id = $1',
      [req.tenant.id]
    );
    res.json({ data: r.rows[0] || null });
  } catch (e) {
    console.error('[white-label/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── PUT /api/white-label — 화이트라벨 설정 저장 (admin, enterprise) ───
router.put('/', auth.requireRole('admin'), planGate('white_label'), async function (req, res) {
  try {
    var b = req.body;

    var r = await db.query(
      'INSERT INTO white_label_configs (tenant_id, logo_url, favicon_url, primary_color, app_name, custom_domain, custom_css) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7) ' +
      'ON CONFLICT (tenant_id) DO UPDATE SET ' +
      'logo_url = $2, favicon_url = $3, primary_color = $4, app_name = $5, custom_domain = $6, custom_css = $7, updated_at = now() ' +
      'RETURNING *',
      [
        req.tenant.id,
        b.logo_url || null, b.favicon_url || null,
        b.primary_color || '#3B82F6', b.app_name || null,
        b.custom_domain || null, b.custom_css || null
      ]
    );

    res.json({ data: r.rows[0], message: '화이트라벨 설정이 저장되었습니다.' });
  } catch (e) {
    console.error('[white-label/save]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
