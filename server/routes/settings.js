var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

/* ─── 회사 공통 설정 (v13.521) — 모두 읽고, 관리자만 바꿈. 정해 둔 열쇠만 ───
   aw_auto { on, min } : 애니웍스 수주 · 업무일지 자동 갱신 (PC 앱이 켜져 있는 동안 min 분마다) */
var ORG_KEYS = {
  aw_auto: {
    def: { on: true, min: 5 },
    clean: function (v) {
      var min = Math.round(Number(v && v.min));
      if (!isFinite(min) || min < 1 || min > 720) return null;
      return { on: !(v && v.on === false), min: min };
    }
  }
};
router.get('/org/:key', async function (req, res) {
  var k = ORG_KEYS[req.params.key];
  if (!k) return res.status(404).json({ error: 'NOT_FOUND', message: '없는 설정입니다.' });
  try {
    var r = await db.query('SELECT value FROM tenant_settings WHERE tenant_id = $1 AND key = $2', [req.tenant.id, req.params.key]);
    var v = r.rows.length ? k.clean(r.rows[0].value) : null;
    res.json({ data: v || k.def });
  } catch (e) { httpErr.serverError(res, '[settings/org-get]', e); }
});
router.put('/org/:key', auth.requireRole('admin'), async function (req, res) {
  var k = ORG_KEYS[req.params.key];
  if (!k) return res.status(404).json({ error: 'NOT_FOUND', message: '없는 설정입니다.' });
  var v = k.clean(req.body && req.body.value);
  if (!v) return res.status(400).json({ error: 'INVALID', message: '값을 확인해 주세요 (주기는 1 ~ 720분).' });
  try {
    await db.query('INSERT INTO tenant_settings (tenant_id, key, value, updated_by, updated_at) VALUES ($1, $2, $3, $4, NOW()) ' +
      'ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3, updated_by = $4, updated_at = NOW()', [req.tenant.id, req.params.key, JSON.stringify(v), req.user.sub]);
    res.json({ data: v });
  } catch (e) { httpErr.serverError(res, '[settings/org-put]', e); }
});

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
    httpErr.serverError(res, '[settings/get]', e);
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
      else return res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' });
    }
  }
});

// PUT /api/settings/:key — 특정 키 저장 (upsert, DB 콜드스타트 재시도)
// v13.467 권한 열쇠는 본인이 못 바꿈 — 관리자가 /api/users/:id/... 로만 (예전엔 이 주소로 자기 권한을 켤 수 있었음)
var RESERVED_KEYS = ['operator_mode', 'mindmap_access', 'worklog_manager'];
router.put('/:key', async function (req, res) {
  if (RESERVED_KEYS.indexOf(req.params.key) >= 0) return res.status(403).json({ error: 'FORBIDDEN', message: '이 설정은 관리자만 바꿀 수 있습니다.' });
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
      else return res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' });
    }
  }
});

module.exports = router;
