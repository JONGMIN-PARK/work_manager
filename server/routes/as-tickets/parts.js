/**
 * A/S 사용 부품 (as_parts)
 * routes/as-tickets.js 가 /api/as-tickets 아래(인증·테넌트 미들웨어 뒤)에 마운트한다.
 */
var express = require('express');
var router = express.Router();
var db = require('../../config/db');
var httpErr = require('../../lib/http-errors');

// ────────────────────────────────────────────────────────────
// ── 사용 부품 (as_parts) ──
// ────────────────────────────────────────────────────────────

router.get('/:id/parts', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT * FROM as_parts WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY used_at ASC, created_at ASC',
      [req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[as-parts/list]', e);
  }
});

router.post('/:id/parts', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.itemName && !b.item_name) return res.status(400).json({ error: 'VALIDATION', message: '품목명을 입력하세요.' });

    var id = b.id || ('asp-' + require('crypto').randomUUID().slice(0, 12));
    var r = await db.query(
      'INSERT INTO as_parts ' +
      '(id, ticket_id, tenant_id, used_at, item_name, part_no, qty, unit_price, ' +
      ' replaced_sn, warranty, billing, note, created_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [id, req.params.id, req.tenant.id,
       b.usedAt || b.used_at || null,
       b.itemName || b.item_name,
       b.partNo || b.part_no || null,
       b.qty != null ? b.qty : 1,
       b.unitPrice != null ? b.unitPrice : (b.unit_price != null ? b.unit_price : 0),
       b.replacedSn || b.replaced_sn || null,
       b.warranty != null ? !!b.warranty : null,
       b.billing || 'warranty',
       b.note || null,
       req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[as-parts/create]', e);
  }
});

router.put('/:id/parts/:pid', async function (req, res) {
  try {
    var b = req.body || {};
    var map = {
      usedAt: 'used_at', used_at: 'used_at',
      itemName: 'item_name', item_name: 'item_name',
      partNo: 'part_no', part_no: 'part_no',
      qty: 'qty',
      unitPrice: 'unit_price', unit_price: 'unit_price',
      replacedSn: 'replaced_sn', replaced_sn: 'replaced_sn',
      warranty: 'warranty', billing: 'billing', note: 'note'
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
    params.push(req.params.pid, req.params.id, req.tenant.id);
    var sql = 'UPDATE as_parts SET ' + fields.join(', ') +
      ' WHERE id = $' + idx++ + ' AND ticket_id = $' + idx++ + ' AND tenant_id = $' + idx++ + ' RETURNING *';
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[as-parts/update]', e);
  }
});

router.delete('/:id/parts/:pid', async function (req, res) {
  try {
    var r = await db.query(
      'DELETE FROM as_parts WHERE id = $1 AND ticket_id = $2 AND tenant_id = $3 RETURNING id',
      [req.params.pid, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[as-parts/delete]', e);
  }
});


module.exports = router;
