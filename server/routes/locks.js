var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');

router.use(auth.authenticate);

// GET /api/locks?resourceType=project&resourceId=xxx — 잠금 조회
router.get('/', async function (req, res) {
  try {
    var type = req.query.resourceType || req.query.resource_type;
    var id = req.query.resourceId || req.query.resource_id;
    if (!type || !id) return res.json({ data: null });

    // 만료된 잠금 정리
    await db.query('DELETE FROM edit_locks WHERE expires_at < now()');

    var r = await db.query(
      'SELECT * FROM edit_locks WHERE resource_type = $1 AND resource_id = $2',
      [type, id]
    );
    res.json({ data: r.rows[0] || null });
  } catch (e) {
    console.error('[locks/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PATCH /api/locks — 편집 잠금 설정 (5분 만료)
router.patch('/', async function (req, res) {
  try {
    var b = req.body;
    var type = b.resourceType || b.resource_type;
    var id = b.resourceId || b.resource_id;
    if (!type || !id) return res.status(400).json({ error: 'VALIDATION', message: 'resourceType, resourceId 필수' });

    // 만료된 잠금 정리
    await db.query('DELETE FROM edit_locks WHERE expires_at < now()');

    var expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5분

    var r = await db.query(
      "INSERT INTO edit_locks (resource_type, resource_id, user_id, user_name, expires_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (resource_type, resource_id) DO UPDATE SET user_id=$3, user_name=$4, locked_at=now(), expires_at=$5 RETURNING *",
      [type, id, req.user.sub, req.user.name || '', expiresAt]
    );

    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[locks/set]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/locks — 편집 잠금 해제
router.delete('/', async function (req, res) {
  try {
    var type = req.query.resourceType || req.query.resource_type;
    var id = req.query.resourceId || req.query.resource_id;
    if (!type || !id) return res.status(400).json({ error: 'VALIDATION', message: 'resourceType, resourceId 필수' });

    // 본인의 잠금만 해제 (admin은 모두 해제 가능)
    var sql = 'DELETE FROM edit_locks WHERE resource_type = $1 AND resource_id = $2';
    var params = [type, id];
    if (req.user.role !== 'admin') {
      sql += ' AND user_id = $3';
      params.push(req.user.sub);
    }
    await db.query(sql, params);

    res.json({ message: '잠금 해제 완료' });
  } catch (e) {
    console.error('[locks/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
