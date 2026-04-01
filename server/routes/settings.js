var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');

router.use(auth.authenticate);

// GET /api/settings — 현재 사용자의 모든 설정 조회
router.get('/', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT key, value FROM user_settings WHERE user_id = $1',
      [req.user.sub]
    );
    var settings = {};
    r.rows.forEach(function (row) { settings[row.key] = row.value; });
    res.json({ data: settings });
  } catch (e) {
    console.error('[settings/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/settings/:key — 특정 키 조회
router.get('/:key', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT value FROM user_settings WHERE user_id = $1 AND key = $2',
      [req.user.sub, req.params.key]
    );
    res.json({ data: r.rows.length ? r.rows[0].value : null });
  } catch (e) {
    console.error('[settings/get-key]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/settings/:key — 특정 키 저장 (upsert)
router.put('/:key', async function (req, res) {
  try {
    var value = req.body.value;
    if (value === undefined) return res.status(400).json({ error: 'INVALID', message: 'value 필수' });
    await db.query(
      'INSERT INTO user_settings (user_id, key, value, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = NOW()',
      [req.user.sub, req.params.key, JSON.stringify(value)]
    );
    res.json({ data: { key: req.params.key, value: value } });
  } catch (e) {
    console.error('[settings/put]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
