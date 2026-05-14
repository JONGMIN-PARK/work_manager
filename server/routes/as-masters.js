/**
 * A/S 마스터 데이터 라우터
 *  - 장비 마스터:     /api/as-equipment
 *  - 고객 컨택 마스터: /api/as-contacts
 *
 * v13.55 A1: 재발 이력 자동 노출 + 접수 시 자동 채움 + 메일 To 드롭다운
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var crypto = require('crypto');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ────────────────────────────────────────────────────────────
// 장비 마스터 — /api/as-equipment
// ────────────────────────────────────────────────────────────

// GET ?kw=&customer=&limit=20
router.get('/equipment', async function (req, res) {
  try {
    var q = req.query;
    var sql = "SELECT * FROM as_equipment_master WHERE tenant_id = $1 AND active = TRUE";
    var params = [req.tenant.id];
    var idx = 2;
    if (q.serial) { sql += " AND serial_no = $" + idx++; params.push(q.serial); }
    if (q.customer) { sql += " AND customer_name ILIKE $" + idx++; params.push('%' + q.customer + '%'); }
    if (q.kw) {
      sql += " AND (serial_no ILIKE $" + idx + " OR equipment_model ILIKE $" + idx +
             " OR equipment_no ILIKE $" + idx + " OR customer_name ILIKE $" + idx + ")";
      params.push('%' + q.kw + '%'); idx++;
    }
    var limit = Math.min(parseInt(q.limit, 10) || 20, 200);
    sql += " ORDER BY updated_at DESC LIMIT $" + idx++;
    params.push(limit);
    var r = await db.query(sql, params);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[as-equipment/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
});

// GET /equipment/by-serial/:serial
router.get('/equipment/by-serial/:serial', async function (req, res) {
  try {
    var r = await db.query(
      "SELECT * FROM as_equipment_master WHERE tenant_id = $1 AND serial_no = $2 LIMIT 1",
      [req.tenant.id, req.params.serial]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-equipment/by-serial]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
});

// POST /equipment — 신규
router.post('/equipment', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.serialNo && !b.serial_no) {
      return res.status(400).json({ error: 'VALIDATION', message: 'Serial No.가 필요합니다.' });
    }
    var id = b.id || ('eqp-' + crypto.randomUUID().slice(0, 12));
    var r = await db.query(
      "INSERT INTO as_equipment_master " +
      "(id, tenant_id, serial_no, equipment_no, equipment_model, customer_name, site_line, " +
      " install_date, warranty_until, warranty_status, note, created_by, updated_by) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) " +
      "ON CONFLICT (tenant_id, serial_no) DO UPDATE SET " +
      "  equipment_no = COALESCE(EXCLUDED.equipment_no, as_equipment_master.equipment_no), " +
      "  equipment_model = COALESCE(EXCLUDED.equipment_model, as_equipment_master.equipment_model), " +
      "  customer_name = COALESCE(EXCLUDED.customer_name, as_equipment_master.customer_name), " +
      "  site_line = COALESCE(EXCLUDED.site_line, as_equipment_master.site_line), " +
      "  install_date = COALESCE(EXCLUDED.install_date, as_equipment_master.install_date), " +
      "  warranty_until = COALESCE(EXCLUDED.warranty_until, as_equipment_master.warranty_until), " +
      "  warranty_status = COALESCE(EXCLUDED.warranty_status, as_equipment_master.warranty_status), " +
      "  note = COALESCE(EXCLUDED.note, as_equipment_master.note), " +
      "  updated_at = NOW(), updated_by = EXCLUDED.updated_by " +
      "RETURNING *",
      [id, req.tenant.id,
       b.serialNo || b.serial_no,
       b.equipmentNo || b.equipment_no || null,
       b.equipmentModel || b.equipment_model || null,
       b.customerName || b.customer_name || null,
       b.siteLine || b.site_line || null,
       b.installDate || b.install_date || null,
       b.warrantyUntil || b.warranty_until || null,
       b.warrantyStatus || b.warranty_status || null,
       b.note || null,
       req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-equipment/upsert]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
});

// PUT /equipment/:id
router.put('/equipment/:id', async function (req, res) {
  try {
    var b = req.body || {};
    var map = {
      equipmentNo: 'equipment_no', equipment_no: 'equipment_no',
      equipmentModel: 'equipment_model', equipment_model: 'equipment_model',
      customerName: 'customer_name', customer_name: 'customer_name',
      siteLine: 'site_line', site_line: 'site_line',
      installDate: 'install_date', install_date: 'install_date',
      warrantyUntil: 'warranty_until', warranty_until: 'warranty_until',
      warrantyStatus: 'warranty_status', warranty_status: 'warranty_status',
      note: 'note', active: 'active'
    };
    var fields = []; var params = []; var idx = 1;
    Object.keys(map).forEach(function (k) {
      if (b[k] === undefined) return;
      var col = map[k];
      if (fields.some(function (f) { return f.indexOf(col + ' =') === 0; })) return;
      fields.push(col + ' = $' + idx++);
      params.push(b[k]);
    });
    if (!fields.length) return res.status(400).json({ error: 'VALIDATION', message: '변경할 필드가 없습니다.' });
    fields.push('updated_at = NOW()');
    fields.push('updated_by = $' + idx++);
    params.push(req.user.sub);
    params.push(req.params.id);
    params.push(req.tenant.id);
    var sql = "UPDATE as_equipment_master SET " + fields.join(', ') +
              " WHERE id = $" + idx++ + " AND tenant_id = $" + idx++ + " RETURNING *";
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-equipment/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
});

router.delete('/equipment/:id', async function (req, res) {
  try {
    var r = await db.query(
      "UPDATE as_equipment_master SET active = FALSE, updated_at = NOW(), updated_by = $3 WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [req.params.id, req.tenant.id, req.user.sub]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '비활성화 완료' });
  } catch (e) {
    console.error('[as-equipment/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
});

// ────────────────────────────────────────────────────────────
// 고객 컨택 마스터 — /api/as-contacts
// ────────────────────────────────────────────────────────────

router.get('/contacts', async function (req, res) {
  try {
    var q = req.query;
    var sql = "SELECT * FROM as_customer_contacts WHERE tenant_id = $1 AND active = TRUE";
    var params = [req.tenant.id];
    var idx = 2;
    if (q.customer) { sql += " AND customer_name ILIKE $" + idx++; params.push('%' + q.customer + '%'); }
    if (q.kw) {
      sql += " AND (customer_name ILIKE $" + idx + " OR contact_name ILIKE $" + idx +
             " OR email ILIKE $" + idx + " OR phone ILIKE $" + idx + ")";
      params.push('%' + q.kw + '%'); idx++;
    }
    var limit = Math.min(parseInt(q.limit, 10) || 50, 500);
    sql += " ORDER BY is_primary DESC, customer_name ASC, contact_name ASC LIMIT $" + idx++;
    params.push(limit);
    var r = await db.query(sql, params);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[as-contacts/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
});

router.post('/contacts', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.customerName && !b.customer_name) {
      return res.status(400).json({ error: 'VALIDATION', message: '고객사명을 입력하세요.' });
    }
    var id = b.id || ('ctc-' + crypto.randomUUID().slice(0, 12));
    var r = await db.query(
      "INSERT INTO as_customer_contacts " +
      "(id, tenant_id, customer_name, contact_name, email, phone, role, is_primary, note, created_by, updated_by) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *",
      [id, req.tenant.id,
       b.customerName || b.customer_name,
       b.contactName || b.contact_name || null,
       b.email || null,
       b.phone || null,
       b.role || null,
       b.isPrimary === true || b.is_primary === true || false,
       b.note || null,
       req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-contacts/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
});

router.put('/contacts/:id', async function (req, res) {
  try {
    var b = req.body || {};
    var map = {
      customerName: 'customer_name', customer_name: 'customer_name',
      contactName: 'contact_name', contact_name: 'contact_name',
      email: 'email', phone: 'phone', role: 'role',
      isPrimary: 'is_primary', is_primary: 'is_primary',
      note: 'note', active: 'active'
    };
    var fields = []; var params = []; var idx = 1;
    Object.keys(map).forEach(function (k) {
      if (b[k] === undefined) return;
      var col = map[k];
      if (fields.some(function (f) { return f.indexOf(col + ' =') === 0; })) return;
      fields.push(col + ' = $' + idx++);
      params.push(b[k]);
    });
    if (!fields.length) return res.status(400).json({ error: 'VALIDATION', message: '변경할 필드가 없습니다.' });
    fields.push('updated_at = NOW()');
    fields.push('updated_by = $' + idx++);
    params.push(req.user.sub);
    params.push(req.params.id);
    params.push(req.tenant.id);
    var sql = "UPDATE as_customer_contacts SET " + fields.join(', ') +
              " WHERE id = $" + idx++ + " AND tenant_id = $" + idx++ + " RETURNING *";
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-contacts/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
});

router.delete('/contacts/:id', async function (req, res) {
  try {
    var r = await db.query(
      "UPDATE as_customer_contacts SET active = FALSE, updated_at = NOW(), updated_by = $3 WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [req.params.id, req.tenant.id, req.user.sub]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '비활성화 완료' });
  } catch (e) {
    console.error('[as-contacts/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
});

module.exports = router;
