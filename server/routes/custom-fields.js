var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ─── GET /api/custom-fields/definitions — 커스텀 필드 정의 목록 ───
router.get('/definitions', async function (req, res) {
  try {
    var where = ['tenant_id = $1'];
    var params = [req.tenant.id];
    var idx = 2;

    if (req.query.entityType) {
      where.push('entity_type = $' + idx++);
      params.push(req.query.entityType);
    }

    var r = await db.query(
      'SELECT * FROM custom_field_definitions WHERE ' + where.join(' AND ') + ' ORDER BY sort_order, created_at',
      params
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[custom-fields/definitions]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── POST /api/custom-fields/definitions — 커스텀 필드 생성 (admin) ───
router.post('/definitions', auth.requireRole('admin'), async function (req, res) {
  try {
    var b = req.body;
    if (!b.entity_type || !b.field_name || !b.field_key) {
      return res.status(400).json({ error: 'VALIDATION', message: 'entity_type, field_name, field_key는 필수입니다.' });
    }

    // field_key 형식 검증
    if (!/^[a-z][a-z0-9_]*$/.test(b.field_key)) {
      return res.status(400).json({ error: 'VALIDATION', message: 'field_key는 영문 소문자, 숫자, 밑줄만 사용할 수 있습니다.' });
    }

    var r = await db.query(
      'INSERT INTO custom_field_definitions (tenant_id, entity_type, field_name, field_key, field_type, options, required, sort_order) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [
        req.tenant.id, b.entity_type, b.field_name, b.field_key,
        b.field_type || 'text', JSON.stringify(b.options || []),
        b.required || false, b.sort_order || 0
      ]
    );

    res.status(201).json({ data: r.rows[0], message: '커스텀 필드가 생성되었습니다.' });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'CONFLICT', message: '이미 존재하는 field_key입니다.' });
    }
    console.error('[custom-fields/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── PUT /api/custom-fields/definitions/:id — 커스텀 필드 수정 ───
router.put('/definitions/:id', auth.requireRole('admin'), async function (req, res) {
  try {
    var b = req.body;
    var sets = [];
    var params = [];
    var idx = 1;

    if (b.field_name !== undefined) { sets.push('field_name = $' + idx++); params.push(b.field_name); }
    if (b.field_type !== undefined) { sets.push('field_type = $' + idx++); params.push(b.field_type); }
    if (b.options !== undefined) { sets.push('options = $' + idx++); params.push(JSON.stringify(b.options)); }
    if (b.required !== undefined) { sets.push('required = $' + idx++); params.push(b.required); }
    if (b.sort_order !== undefined) { sets.push('sort_order = $' + idx++); params.push(b.sort_order); }

    if (!sets.length) return res.status(400).json({ error: 'VALIDATION', message: '변경할 항목이 없습니다.' });

    sets.push('updated_at = now()');
    params.push(req.params.id, req.tenant.id);

    var r = await db.query(
      'UPDATE custom_field_definitions SET ' + sets.join(', ') + ' WHERE id = $' + idx++ + ' AND tenant_id = $' + idx + ' RETURNING *',
      params
    );

    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0], message: '커스텀 필드가 수정되었습니다.' });
  } catch (e) {
    console.error('[custom-fields/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── DELETE /api/custom-fields/definitions/:id — 커스텀 필드 삭제 ───
router.delete('/definitions/:id', auth.requireRole('admin'), async function (req, res) {
  try {
    var r = await db.query(
      'DELETE FROM custom_field_definitions WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '커스텀 필드가 삭제되었습니다.' });
  } catch (e) {
    console.error('[custom-fields/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── GET /api/custom-fields/values/:entityType/:entityId — 엔티티의 커스텀 필드 값 조회 ───
router.get('/values/:entityType/:entityId', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT v.*, d.field_name, d.field_key, d.field_type, d.options FROM custom_field_values v ' +
      'JOIN custom_field_definitions d ON v.field_id = d.id ' +
      'WHERE v.tenant_id = $1 AND v.entity_type = $2 AND v.entity_id = $3 ORDER BY d.sort_order',
      [req.tenant.id, req.params.entityType, req.params.entityId]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[custom-fields/values/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── PUT /api/custom-fields/values/:entityType/:entityId — 커스텀 필드 값 일괄 저장 ───
router.put('/values/:entityType/:entityId', async function (req, res) {
  try {
    var fields = req.body.fields; // [{ field_id, value }]
    if (!Array.isArray(fields)) {
      return res.status(400).json({ error: 'VALIDATION', message: 'fields 배열이 필요합니다.' });
    }

    var results = [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var r = await db.query(
        'INSERT INTO custom_field_values (tenant_id, field_id, entity_type, entity_id, value) ' +
        'VALUES ($1, $2, $3, $4, $5) ' +
        'ON CONFLICT (field_id, entity_id) DO UPDATE SET value = $5, updated_at = now() RETURNING *',
        [req.tenant.id, f.field_id, req.params.entityType, req.params.entityId, JSON.stringify(f.value)]
      );
      results.push(r.rows[0]);
    }

    res.json({ data: results, message: '커스텀 필드 값이 저장되었습니다.' });
  } catch (e) {
    console.error('[custom-fields/values/save]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
