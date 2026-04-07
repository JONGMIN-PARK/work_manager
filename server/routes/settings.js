var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// GET /api/settings — 현재 사용자의 모든 설정 조회
router.get('/', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT key, value FROM user_settings WHERE user_id = $1 AND tenant_id = $2',
      [req.user.sub, req.tenant.id]
    );
    var settings = {};
    r.rows.forEach(function (row) { settings[row.key] = row.value; });
    res.json({ data: settings });
  } catch (e) {
    console.error('[settings/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/settings/:key — 특정 키 조회 (DB 콜드스타트 재시도)
router.get('/:key', async function (req, res) {
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var r = await db.query(
        'SELECT value FROM user_settings WHERE user_id = $1 AND key = $2 AND tenant_id = $3',
        [req.user.sub, req.params.key, req.tenant.id]
      );
      return res.json({ data: r.rows.length ? r.rows[0].value : null });
    } catch (e) {
      console.error('[settings/get-key] attempt', attempt + 1, e.message);
      if (attempt < 2) await new Promise(function (r) { setTimeout(r, 1000); });
      else return res.status(500).json({ error: 'SERVER_ERROR', message: e.message || '서버 오류' });
    }
  }
});

// PUT /api/settings/:key — 특정 키 저장 (upsert, DB 콜드스타트 재시도)
router.put('/:key', async function (req, res) {
  var value = req.body.value;
  if (value === undefined) return res.status(400).json({ error: 'INVALID', message: 'value 필수' });
  var sql = 'INSERT INTO user_settings (user_id, key, value, updated_at, tenant_id) VALUES ($1, $2, $3, NOW(), $4) ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = NOW()';
  var params = [req.user.sub, req.params.key, JSON.stringify(value), req.tenant.id];
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      await db.query(sql, params);
      return res.json({ data: { key: req.params.key, value: value } });
    } catch (e) {
      console.error('[settings/put] attempt', attempt + 1, e.message);
      if (attempt < 2) await new Promise(function (r) { setTimeout(r, 1000); });
      else return res.status(500).json({ error: 'SERVER_ERROR', message: e.message || '서버 오류' });
    }
  }
});

module.exports = router;
