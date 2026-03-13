var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var rbac = require('../middleware/rbac');
var lock = require('../middleware/optimistic-lock');

router.use(auth.authenticate);

// GET /api/orders
router.get('/', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM orders ORDER BY date DESC, order_no');
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[orders/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/orders/bulk — 일괄 저장 (upsert)
router.post('/bulk', rbac.checkPermission('order.edit'), async function (req, res) {
  try {
    var records = req.body.records || [];
    if (!records.length) return res.json({ data: [], count: 0 });
    var results = [];
    for (var i = 0; i < records.length; i++) {
      var b = records[i];
      var r = await db.query(
        "INSERT INTO orders (order_no, date, client, name, amount, manager, delivery, memo, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (order_no) DO UPDATE SET date=$2, client=$3, name=$4, amount=$5, manager=$6, delivery=$7, version=orders.version+1 RETURNING *",
        [b.orderNo || b.order_no, b.date || '', b.client || '', b.name || '', b.amount || 0, b.manager || '', b.delivery || '', b.memo || '', req.user.sub]
      );
      results.push(r.rows[0]);
    }
    res.status(201).json({ data: results, count: results.length });
  } catch (e) {
    console.error('[orders/bulk]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/orders/:orderNo
router.get('/:orderNo', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM orders WHERE order_no = $1', [req.params.orderNo]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[orders/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/orders
router.post('/', rbac.checkPermission('order.edit'), async function (req, res) {
  try {
    var b = req.body;
    var r = await db.query(
      "INSERT INTO orders (order_no, date, client, name, amount, manager, delivery, memo, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (order_no) DO UPDATE SET date=$2, client=$3, name=$4, amount=$5, manager=$6, delivery=$7, memo=$8, version=orders.version+1 RETURNING *",
      [b.orderNo || b.order_no, b.date || '', b.client || '', b.name || '', b.amount || 0, b.manager || '', b.delivery || '', b.memo || '', req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[orders/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/orders/:orderNo
router.put('/:orderNo', rbac.checkPermission('order.edit'), async function (req, res) {
  try {
    var b = req.body;
    var clean = {};
    if (b.date !== undefined) clean.date = b.date;
    if (b.client !== undefined) clean.client = b.client;
    if (b.name !== undefined) clean.name = b.name;
    if (b.amount !== undefined) clean.amount = b.amount;
    if (b.manager !== undefined) clean.manager = b.manager;
    if (b.delivery !== undefined) clean.delivery = b.delivery;
    if (b.memo !== undefined) clean.memo = b.memo;

    var result = await lock.optimisticUpdate(db, 'orders', 'order_no', req.params.orderNo, b.version, clean, req.user.sub);
    if (result.conflict) return lock.sendConflict(res, result.latest, result.yourVersion);
    if (!result.success) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: result.row });
  } catch (e) {
    console.error('[orders/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/orders/:orderNo
router.delete('/:orderNo', rbac.checkPermission('order.edit'), async function (req, res) {
  try {
    var r = await db.query('DELETE FROM orders WHERE order_no = $1 RETURNING order_no', [req.params.orderNo]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[orders/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
