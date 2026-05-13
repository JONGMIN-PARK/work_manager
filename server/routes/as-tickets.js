var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var rbac = require('../middleware/rbac');
var lock = require('../middleware/optimistic-lock');
var { parsePagination } = require('../middleware/pagination');
var tenant = require('../middleware/tenant');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ─── 채번 헬퍼: AS-YYYY-MM-### (테넌트별 월별 순번) ───
async function nextTicketNo(tenantId) {
  var now = new Date();
  var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  var prefix = 'AS-' + ym + '-';
  var r = await db.query(
    "SELECT ticket_no FROM as_tickets WHERE tenant_id=$1 AND ticket_no LIKE $2 ORDER BY ticket_no DESC LIMIT 1",
    [tenantId, prefix + '%']
  );
  var nextSeq = 1;
  if (r.rows.length) {
    var last = r.rows[0].ticket_no;
    var tail = parseInt(last.slice(prefix.length), 10);
    if (!isNaN(tail)) nextSeq = tail + 1;
  }
  return prefix + String(nextSeq).padStart(3, '0');
}

// GET /api/as-tickets — 목록
router.get('/', async function (req, res) {
  try {
    var q = req.query;
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM as_tickets WHERE tenant_id = $1';
    var params = [req.tenant.id];
    var idx = 2;
    if (q.status)    { sql += ' AND status = $' + idx++;    params.push(q.status); }
    if (q.priority)  { sql += ' AND priority = $' + idx++;  params.push(q.priority); }
    if (q.category)  { sql += ' AND category = $' + idx++;  params.push(q.category); }
    if (q.customer)  { sql += ' AND customer_name ILIKE $' + idx++; params.push('%' + q.customer + '%'); }
    if (q.orderNo)   { sql += ' AND order_no = $' + idx++;  params.push(q.orderNo); }
    if (q.projectId) { sql += ' AND project_id = $' + idx++; params.push(q.projectId); }
    if (q.kw) {
      sql += ' AND (ticket_no ILIKE $' + idx + ' OR customer_name ILIKE $' + idx +
             ' OR equipment_model ILIKE $' + idx + ' OR serial_no ILIKE $' + idx +
             ' OR issue_summary ILIKE $' + idx + ')';
      params.push('%' + q.kw + '%'); idx++;
    }

    var pg = parsePagination(req.query, 100);
    sql += ' ORDER BY received_at DESC LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);

    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function (row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    console.error('[as-tickets/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/as-tickets/:id — 단건
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM as_tickets WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-tickets/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/as-tickets — 신규 접수
// 모든 인증 사용자 허용 (CS 담당자 누구나 접수 가능)
router.post('/', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.customerName && !b.customer_name) {
      return res.status(400).json({ error: 'VALIDATION', message: '고객사명을 입력하세요.' });
    }
    if (!b.issueSummary && !b.issue_summary) {
      return res.status(400).json({ error: 'VALIDATION', message: '신고 내용(증상)을 입력하세요.' });
    }

    var id = b.id || ('as-' + require('crypto').randomUUID().slice(0, 12));
    var ticketNo = await nextTicketNo(req.tenant.id);

    var r = await db.query(
      'INSERT INTO as_tickets ' +
      '(id, ticket_no, tenant_id, customer_name, site_line, customer_contact, ' +
      ' equipment_no, equipment_model, serial_no, install_date, warranty_status, ' +
      ' received_at, received_by, channel, priority, category, method, ' +
      ' issue_summary, reproduction, frequency, frequency_count, impact_scope, initial_analysis, ' +
      ' status, project_id, order_no, created_by, updated_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,' +
      'COALESCE($12, NOW()),$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$27) ' +
      'RETURNING *',
      [
        id, ticketNo, req.tenant.id,
        b.customerName || b.customer_name,
        b.siteLine || b.site_line || null,
        b.customerContact || b.customer_contact || null,
        b.equipmentNo || b.equipment_no || null,
        b.equipmentModel || b.equipment_model || null,
        b.serialNo || b.serial_no || null,
        b.installDate || b.install_date || null,
        b.warrantyStatus || b.warranty_status || null,
        b.receivedAt || b.received_at || null,
        req.user.sub,
        b.channel || null,
        b.priority || 'P3',
        b.category || null,
        b.method || null,
        b.issueSummary || b.issue_summary,
        b.reproduction || null,
        b.frequency || null,
        b.frequencyCount != null ? b.frequencyCount : (b.frequency_count != null ? b.frequency_count : null),
        b.impactScope || b.impact_scope || null,
        b.initialAnalysis || b.initial_analysis || null,
        b.status || 'received',
        b.projectId || b.project_id || null,
        b.orderNo || b.order_no || null,
        req.user.sub
      ]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-tickets/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/as-tickets/:id — 수정 (optimistic-lock)
router.put('/:id', async function (req, res) {
  try {
    var b = req.body || {};
    var fields = [
      'customer_name', 'site_line', 'customer_contact',
      'equipment_no', 'equipment_model', 'serial_no', 'install_date', 'warranty_status',
      'channel', 'priority', 'category', 'method',
      'issue_summary', 'reproduction', 'frequency', 'frequency_count', 'impact_scope', 'initial_analysis',
      'status', 'project_id', 'order_no'
    ];
    var camelMap = {
      customerName: 'customer_name', siteLine: 'site_line', customerContact: 'customer_contact',
      equipmentNo: 'equipment_no', equipmentModel: 'equipment_model', serialNo: 'serial_no',
      installDate: 'install_date', warrantyStatus: 'warranty_status',
      issueSummary: 'issue_summary', frequencyCount: 'frequency_count',
      impactScope: 'impact_scope', initialAnalysis: 'initial_analysis',
      projectId: 'project_id', orderNo: 'order_no'
    };
    var clean = {};
    fields.forEach(function (f) {
      var camel = Object.keys(camelMap).find(function (k) { return camelMap[k] === f; });
      var val = b[f] !== undefined ? b[f] : (camel ? b[camel] : undefined);
      if (val !== undefined) clean[f] = val;
    });

    var result = await lock.optimisticUpdate(
      db, 'as_tickets', 'id', req.params.id, b.version, clean, req.user.sub,
      { clause: 'AND tenant_id = $NEXT1', values: [req.tenant.id] }
    );
    if (result.conflict) return lock.sendConflict(res, result.latest, result.yourVersion);
    if (!result.success) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: result.row });
  } catch (e) {
    console.error('[as-tickets/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/as-tickets/:id — 관리자 전용
router.delete('/:id', rbac.checkPermission('issue.delete'), async function (req, res) {
  try {
    var r = await db.query('DELETE FROM as_tickets WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[as-tickets/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
