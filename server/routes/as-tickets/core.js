/**
 * A/S 티켓 본체 — 목록/조회/생성/수정/휴지통(soft delete)/완전삭제/복구
 * routes/as-tickets.js 가 /api/as-tickets 아래(인증·테넌트 미들웨어 뒤)에 마운트한다.
 */
var express = require('express');
var router = express.Router();
var db = require('../../config/db');
var rbac = require('../../middleware/rbac');
var lock = require('../../middleware/optimistic-lock');
var { parsePagination } = require('../../middleware/pagination');
var notificationService = require('../../services/notification.service');
var shared = require('./_shared');
var httpErr = require('../../lib/http-errors');
var _invalidateStatsCache = shared._invalidateStatsCache;
var nextTicketNo = shared.nextTicketNo;

// GET /api/as-tickets — 목록
// 기본: 활성(deleted_at IS NULL)만. ?trashed=1 이면 휴지통(deleted_at IS NOT NULL)만.
router.get('/', async function (req, res) {
  try {
    var q = req.query;
    var trashed = (q.trashed === '1' || q.trashed === 'true');
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM as_tickets WHERE tenant_id = $1';
    sql += trashed ? ' AND deleted_at IS NOT NULL' : ' AND deleted_at IS NULL';
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
    // 내 큐: 현재 사용자에게 할당된 active 할당이 있는 ticket만
    if (q.myQueue === '1' || q.myQueue === 'true') {
      sql += ' AND EXISTS (SELECT 1 FROM as_assignments a WHERE a.ticket_id = as_tickets.id ' +
             'AND a.tenant_id = as_tickets.tenant_id AND a.assignee_id = $' + idx + ' ' +
             "AND a.status NOT IN ('completed','cancelled'))";
      params.push(req.user.sub); idx++;
    }

    var pg = parsePagination(req.query, 100);
    sql += trashed
      ? ' ORDER BY deleted_at DESC LIMIT $' + idx++ + ' OFFSET $' + idx++
      : ' ORDER BY received_at DESC LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);

    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function (row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    httpErr.serverError(res, '[as-tickets/list]', e);
  }
});

// GET /api/as-tickets/:id — 단건 (?expand=1 시 children 동봉)
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM as_tickets WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var data = r.rows[0];
    if (req.query.expand === '1' || req.query.expand === 'true') {
      var [a, l, p, att, sig] = await Promise.all([
        db.query('SELECT * FROM as_assignments WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY role ASC, created_at ASC',
          [req.params.id, req.tenant.id]),
        db.query('SELECT * FROM as_activity_logs WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY worked_at ASC, seq ASC',
          [req.params.id, req.tenant.id]),
        db.query('SELECT * FROM as_parts WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY used_at ASC, created_at ASC',
          [req.params.id, req.tenant.id]),
        db.query('SELECT * FROM as_attachments WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY uploaded_at DESC',
          [req.params.id, req.tenant.id]),
        db.query('SELECT * FROM as_signatures WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY role ASC',
          [req.params.id, req.tenant.id])
      ]);
      data.assignments = a.rows;
      data.activityLogs = l.rows;
      data.parts = p.rows;
      data.attachments = att.rows;
      data.signatures = sig.rows;
    }
    res.json({ data: data });
  } catch (e) {
    httpErr.serverError(res, '[as-tickets/get]', e);
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
    _invalidateStatsCache(req.tenant.id);

    // 장비/컨택 마스터 자동 upsert (비동기, 실패 시 무시) — A1: 자연 누적
    var created = r.rows[0];
    (async function () {
      try {
        if (created.serial_no) {
          await db.query(
            "INSERT INTO as_equipment_master " +
            "(id, tenant_id, serial_no, equipment_no, equipment_model, customer_name, site_line, install_date, warranty_status, created_by, updated_by) " +
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) " +
            "ON CONFLICT (tenant_id, serial_no) DO UPDATE SET " +
            "  equipment_no = COALESCE(EXCLUDED.equipment_no, as_equipment_master.equipment_no), " +
            "  equipment_model = COALESCE(EXCLUDED.equipment_model, as_equipment_master.equipment_model), " +
            "  customer_name = COALESCE(EXCLUDED.customer_name, as_equipment_master.customer_name), " +
            "  site_line = COALESCE(EXCLUDED.site_line, as_equipment_master.site_line), " +
            "  install_date = COALESCE(EXCLUDED.install_date, as_equipment_master.install_date), " +
            "  warranty_status = COALESCE(EXCLUDED.warranty_status, as_equipment_master.warranty_status), " +
            "  updated_at = NOW(), updated_by = EXCLUDED.updated_by",
            ['eqp-' + require('crypto').randomUUID().slice(0, 12),
             req.tenant.id, created.serial_no, created.equipment_no, created.equipment_model,
             created.customer_name, created.site_line, created.install_date, created.warranty_status,
             req.user.sub]
          );
        }
        // customer_contact 안에 이메일 포함됐을 수 있음 — 간단 추출
        var contact = created.customer_contact || '';
        var emailMatch = contact.match(/[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}/);
        if (created.customer_name && emailMatch) {
          await db.query(
            "INSERT INTO as_customer_contacts " +
            "(id, tenant_id, customer_name, contact_name, email, phone, created_by, updated_by) " +
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$7) " +
            "ON CONFLICT DO NOTHING",
            ['ctc-' + require('crypto').randomUUID().slice(0, 12),
             req.tenant.id, created.customer_name, null, emailMatch[0], null, req.user.sub]
          );
        }
      } catch (e) { console.warn('[as/master-upsert]', e.message); }
    })();

    // 텔레그램: P1/P2 신규 접수 알림 — 관리자에게 (비동기, 실패 시 무시)
    if (created.priority === 'P1' || created.priority === 'P2') {
      (async function () {
        try {
          var admR = await db.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND tenant_id = $1", [req.tenant.id]);
          var targets = admR.rows.map(function (u) { return u.id; });
          if (targets.length) {
            notificationService.notify('as_received', {
              ticketNo: created.ticket_no,
              priority: created.priority,
              customerName: created.customer_name,
              equipmentModel: created.equipment_model,
              category: created.category,
              summary: created.issue_summary
            }, targets).catch(function (e) { console.error('[as/noti]', e.message); });
          }
        } catch (e) { /* 무시 */ }
      })();
    }
  } catch (e) {
    httpErr.serverError(res, '[as-tickets/create]', e);
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
      'status', 'project_id', 'order_no', 'linked_issue_id',
      'rca', 'prevention', 'final_equip_status', 'monitoring', 'closure', 'closed_at',
      'promised_response_at', 'promised_visit_at'
    ];
    var camelMap = {
      customerName: 'customer_name', siteLine: 'site_line', customerContact: 'customer_contact',
      equipmentNo: 'equipment_no', equipmentModel: 'equipment_model', serialNo: 'serial_no',
      installDate: 'install_date', warrantyStatus: 'warranty_status',
      issueSummary: 'issue_summary', frequencyCount: 'frequency_count',
      impactScope: 'impact_scope', initialAnalysis: 'initial_analysis',
      projectId: 'project_id', orderNo: 'order_no', linkedIssueId: 'linked_issue_id',
      finalEquipStatus: 'final_equip_status', closedAt: 'closed_at',
      promisedResponseAt: 'promised_response_at', promisedVisitAt: 'promised_visit_at'
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
    _invalidateStatsCache(req.tenant.id);
    res.json({ data: result.row });
  } catch (e) {
    httpErr.serverError(res, '[as-tickets/update]', e);
  }
});

// DELETE /api/as-tickets/:id — soft delete (휴지통 이동)
// 이미 휴지통이면 404. 완전삭제는 DELETE /:id/hard 별도 엔드포인트.
router.delete('/:id', async function (req, res) {
  try {
    var rs = await db.query(
      'UPDATE as_tickets SET deleted_at = NOW(), deleted_by = $3, updated_at = NOW(), updated_by = $3 ' +
      'WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id, ticket_no',
      [req.params.id, req.tenant.id, req.user.sub]
    );
    if (!rs.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '대상이 없거나 이미 휴지통에 있습니다.' });
    _invalidateStatsCache(req.tenant.id);
    res.json({ message: '휴지통으로 이동되었습니다.', mode: 'soft', ticketNo: rs.rows[0].ticket_no });
  } catch (e) {
    httpErr.serverError(res, '[as-tickets/delete-soft]', e);
  }
});

// DELETE /api/as-tickets/:id/hard — 완전 삭제 (자식 cascade). issue.delete 권한 필요.
router.delete('/:id/hard', rbac.checkPermission('issue.delete'), async function (req, res) {
  try {
    var rh = await db.query('DELETE FROM as_tickets WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenant.id]);
    if (!rh.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    _invalidateStatsCache(req.tenant.id);
    res.json({ message: '완전 삭제 완료', mode: 'hard' });
  } catch (e) {
    httpErr.serverError(res, '[as-tickets/delete-hard]', e);
  }
});

// POST /api/as-tickets/:id/restore — 휴지통에서 복구
router.post('/:id/restore', async function (req, res) {
  try {
    var r = await db.query(
      'UPDATE as_tickets SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW(), updated_by = $3 ' +
      'WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NOT NULL RETURNING *',
      [req.params.id, req.tenant.id, req.user.sub]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '대상이 없거나 휴지통에 없습니다.' });
    _invalidateStatsCache(req.tenant.id);
    res.json({ data: r.rows[0], message: '복구되었습니다.' });
  } catch (e) {
    httpErr.serverError(res, '[as-tickets/restore]', e);
  }
});


module.exports = router;
