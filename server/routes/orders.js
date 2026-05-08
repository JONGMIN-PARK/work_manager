var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var rbac = require('../middleware/rbac');
var lock = require('../middleware/optimistic-lock');
var { parsePagination } = require('../middleware/pagination');
var tenant = require('../middleware/tenant');
var ps = require('../middleware/project-scope');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// GET /api/orders — v13.34 가시성:
//   본인이 생성한 수주 + 접근 가능한 프로젝트의 order_no 와 매칭되는 수주만
router.get('/', async function (req, res) {
  try {
    var pg = parsePagination(req.query, 100);
    var idx = 1;
    var params = [req.tenant.id]; idx++;
    var meIdx = idx++;
    params.push(req.user.sub);
    var sub = ps.accessibleOrderNosSubquery(req, idx);
    params = params.concat(sub.params);
    idx = sub.nextIdx;
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM orders WHERE tenant_id = $1 '
      + 'AND (created_by = $' + meIdx + ' OR order_no IN (' + sub.sql + ')) '
      + 'ORDER BY date DESC, order_no LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);
    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
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
    var values = [];
    var params = [];
    var idx = 1;
    records.forEach(function (b) {
      values.push('($' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ')');
      params.push(b.orderNo || b.order_no, b.date || '', b.client || '', b.name || '', b.amount || 0, b.manager || '', b.delivery || '', b.memo || '', req.user.sub, req.tenant.id);
    });
    var sql = 'INSERT INTO orders (order_no, date, client, name, amount, manager, delivery, memo, created_by, tenant_id) VALUES ' + values.join(',') + ' ON CONFLICT (order_no) DO UPDATE SET date=EXCLUDED.date, client=EXCLUDED.client, name=EXCLUDED.name, amount=EXCLUDED.amount, manager=EXCLUDED.manager, delivery=EXCLUDED.delivery, version=orders.version+1 RETURNING *';
    var result = await db.query(sql, params);
    res.status(201).json({ data: result.rows, count: result.rows.length });
  } catch (e) {
    console.error('[orders/bulk]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/orders/:orderNo
router.get('/:orderNo', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM orders WHERE order_no = $1 AND tenant_id = $2', [req.params.orderNo, req.tenant.id]);
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
      "INSERT INTO orders (order_no, date, client, name, amount, manager, delivery, memo, created_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (order_no) DO UPDATE SET date=$2, client=$3, name=$4, amount=$5, manager=$6, delivery=$7, memo=$8, version=orders.version+1 RETURNING *",
      [b.orderNo || b.order_no, b.date || '', b.client || '', b.name || '', b.amount || 0, b.manager || '', b.delivery || '', b.memo || '', req.user.sub, req.tenant.id]
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

    var result = await lock.optimisticUpdate(db, 'orders', 'order_no', req.params.orderNo, b.version, clean, req.user.sub, { clause: 'AND tenant_id = $NEXT1', values: [req.tenant.id] });
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
    var r = await db.query('DELETE FROM orders WHERE order_no = $1 AND tenant_id = $2 RETURNING order_no', [req.params.orderNo, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[orders/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
