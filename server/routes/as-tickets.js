var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var rbac = require('../middleware/rbac');
var lock = require('../middleware/optimistic-lock');
var { parsePagination } = require('../middleware/pagination');
var tenant = require('../middleware/tenant');
var notificationService = require('../services/notification.service');
var emailService = require('../services/email.service');
var authService = require('../services/auth.service');
var rateLimit = require('express-rate-limit');
var asStatsRouter = require('./as-stats');  // invalidateStats 헬퍼

// 헬퍼: 티켓 변경 시 통계 캐시 무효화 (실패해도 응답엔 영향 없음)
function _invalidateStatsCache(tenantId) {
  try {
    if (asStatsRouter && typeof asStatsRouter.invalidateStats === 'function') {
      asStatsRouter.invalidateStats(tenantId);
    }
  } catch (e) { /* 무시 */ }
}

// 보고서 메일 발송 — 사용자당 시간당 20건 제한 (스팸·오·악용 방지)
var emailReportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: function (req) { return (req.user && req.user.sub) || req.ip; },
  message: { error: 'RATE_LIMIT', message: '시간당 메일 발송 한도(20건)를 초과했습니다. 잠시 후 다시 시도하세요.' },
  standardHeaders: true,
  legacyHeaders: false
});

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
    console.error('[as-tickets/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
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
    console.error('[as-tickets/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
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
    console.error('[as-tickets/delete-soft]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
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
    console.error('[as-tickets/delete-hard]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
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
    console.error('[as-tickets/restore]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ────────────────────────────────────────────────────────────
// ── 부서 할당 (as_assignments) ──
// ────────────────────────────────────────────────────────────

// GET /api/as-tickets/:id/assignments
router.get('/:id/assignments', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT * FROM as_assignments WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY role ASC, created_at ASC',
      [req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[as-assignments/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/as-tickets/:id/assignments — 신규 할당
router.post('/:id/assignments', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.dept) return res.status(400).json({ error: 'VALIDATION', message: '부서를 지정하세요.' });

    var id = b.id || ('asg-' + require('crypto').randomUUID().slice(0, 12));
    var role = b.role === 'primary' ? 'primary' : 'support';
    var r = await db.query(
      'INSERT INTO as_assignments ' +
      '(id, ticket_id, tenant_id, dept, role, assignee_id, assignee_name, ' +
      ' method, promised_at, status, created_by, updated_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *',
      [id, req.params.id, req.tenant.id, b.dept, role,
       b.assigneeId || b.assignee_id || null,
       b.assigneeName || b.assignee_name || null,
       b.method || null,
       b.promisedAt || b.promised_at || null,
       b.status || 'pending',
       req.user.sub]
    );

    // 상태 자동 전이: 첫 할당이면 ticket을 'assigned'로
    await db.query(
      "UPDATE as_tickets SET status = 'assigned', updated_at = NOW(), updated_by = $3 " +
      "WHERE id = $1 AND tenant_id = $2 AND status = 'received'",
      [req.params.id, req.tenant.id, req.user.sub]
    );

    res.status(201).json({ data: r.rows[0] });

    // 텔레그램: 담당자에게 할당 알림
    var asg = r.rows[0];
    if (asg.assignee_id) {
      (async function () {
        try {
          var tR = await db.query('SELECT ticket_no, priority, customer_name FROM as_tickets WHERE id = $1', [req.params.id]);
          var t = tR.rows[0] || {};
          notificationService.notify('as_assigned', {
            ticketNo: t.ticket_no, priority: t.priority, customerName: t.customer_name,
            assignee: asg.assignee_name || '-', dept: asg.dept,
            promisedAt: asg.promised_at ? new Date(asg.promised_at).toISOString().replace('T', ' ').slice(0, 16) : null
          }, [asg.assignee_id]).catch(function (e) { console.error('[as/noti]', e.message); });
        } catch (e) { /* 무시 */ }
      })();
    }
  } catch (e) {
    if (e && e.code === '23505') {
      return res.status(409).json({ error: 'DUPLICATE', message: '이 부서는 이미 주관으로 등록되어 있습니다.' });
    }
    console.error('[as-assignments/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/as-tickets/:id/assignments/:aid
router.put('/:id/assignments/:aid', async function (req, res) {
  try {
    var b = req.body || {};
    var fields = [];
    var params = [];
    var idx = 1;
    var map = {
      dept: 'dept', role: 'role',
      assigneeId: 'assignee_id', assignee_id: 'assignee_id',
      assigneeName: 'assignee_name', assignee_name: 'assignee_name',
      method: 'method',
      promisedAt: 'promised_at', promised_at: 'promised_at',
      startedAt: 'started_at', started_at: 'started_at',
      completedAt: 'completed_at', completed_at: 'completed_at',
      status: 'status', resultNote: 'result_note', result_note: 'result_note'
    };
    Object.keys(map).forEach(function (k) {
      if (b[k] === undefined) return;
      var col = map[k];
      // 중복 컬럼 스킵
      if (fields.some(function (f) { return f.indexOf(col + ' =') === 0; })) return;
      fields.push(col + ' = $' + idx++);
      params.push(b[k]);
    });
    if (!fields.length) return res.status(400).json({ error: 'VALIDATION', message: '변경할 필드가 없습니다.' });

    // 상태가 completed로 바뀌면 completed_at 자동 채움
    if (b.status === 'completed' && b.completedAt === undefined && b.completed_at === undefined) {
      fields.push('completed_at = NOW()');
    }
    if (b.status === 'in_progress' && b.startedAt === undefined && b.started_at === undefined) {
      fields.push('started_at = COALESCE(started_at, NOW())');
    }

    fields.push('updated_at = NOW()');
    fields.push('updated_by = $' + idx++);
    params.push(req.user.sub);
    params.push(req.params.aid);
    params.push(req.params.id);
    params.push(req.tenant.id);

    var sql = 'UPDATE as_assignments SET ' + fields.join(', ') +
      ' WHERE id = $' + idx++ + ' AND ticket_id = $' + idx++ + ' AND tenant_id = $' + idx++ + ' RETURNING *';
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });

    // 모든 할당이 completed면 ticket을 'reporting'로 자동 승격
    if (b.status === 'completed') {
      var pendR = await db.query(
        "SELECT COUNT(*)::int AS n FROM as_assignments WHERE ticket_id=$1 AND tenant_id=$2 AND status <> 'completed' AND status <> 'cancelled'",
        [req.params.id, req.tenant.id]
      );
      if (pendR.rows[0].n === 0) {
        await db.query(
          "UPDATE as_tickets SET status = 'reporting', updated_at=NOW(), updated_by=$3 " +
          "WHERE id = $1 AND tenant_id = $2 AND status IN ('assigned','in_progress')",
          [req.params.id, req.tenant.id, req.user.sub]
        );
      }
    }

    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-assignments/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/as-tickets/:id/assignments/:aid
router.delete('/:id/assignments/:aid', async function (req, res) {
  try {
    var r = await db.query(
      'DELETE FROM as_assignments WHERE id = $1 AND ticket_id = $2 AND tenant_id = $3 RETURNING id',
      [req.params.aid, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[as-assignments/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ────────────────────────────────────────────────────────────
// ── 활동 로그 (as_activity_logs) ──
// ────────────────────────────────────────────────────────────

// GET /api/as-tickets/:id/logs
router.get('/:id/logs', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT * FROM as_activity_logs WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY worked_at ASC, seq ASC',
      [req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[as-logs/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/as-tickets/:id/logs
router.post('/:id/logs', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.dept) return res.status(400).json({ error: 'VALIDATION', message: '부서를 지정하세요.' });
    if (!b.workType && !b.work_type) return res.status(400).json({ error: 'VALIDATION', message: '작업 유형을 지정하세요.' });
    if (!b.actionTaken && !b.action_taken) return res.status(400).json({ error: 'VALIDATION', message: '조치 내용을 입력하세요.' });

    // 다음 seq
    var seqR = await db.query(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM as_activity_logs WHERE ticket_id = $1',
      [req.params.id]
    );
    var nextSeq = seqR.rows[0].next_seq;

    var id = b.id || ('asl-' + require('crypto').randomUUID().slice(0, 12));
    var r = await db.query(
      'INSERT INTO as_activity_logs ' +
      '(id, ticket_id, assignment_id, tenant_id, seq, worked_at, dept, ' +
      ' author_id, author_name, work_type, problem, action_taken, duration_h, status, followup, created_by) ' +
      'VALUES ($1,$2,$3,$4,$5,COALESCE($6, NOW()),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',
      [id, req.params.id,
       b.assignmentId || b.assignment_id || null,
       req.tenant.id, nextSeq,
       b.workedAt || b.worked_at || null,
       b.dept,
       req.user.sub,
       b.authorName || b.author_name || null,
       b.workType || b.work_type,
       b.problem || null,
       b.actionTaken || b.action_taken,
       b.durationH != null ? b.durationH : (b.duration_h != null ? b.duration_h : 0),
       b.status || 'in_progress',
       b.followup || null,
       req.user.sub]
    );

    // 첫 로그면 assignment를 in_progress로, ticket을 in_progress로 자동 전이
    if (b.assignmentId || b.assignment_id) {
      var aid = b.assignmentId || b.assignment_id;
      await db.query(
        "UPDATE as_assignments SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), updated_at=NOW(), updated_by=$3 " +
        "WHERE id = $1 AND tenant_id = $2 AND status = 'pending'",
        [aid, req.tenant.id, req.user.sub]
      );
    }
    await db.query(
      "UPDATE as_tickets SET status = 'in_progress', updated_at=NOW(), updated_by=$3 " +
      "WHERE id = $1 AND tenant_id = $2 AND status IN ('received','assigned')",
      [req.params.id, req.tenant.id, req.user.sub]
    );

    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-logs/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/as-tickets/:id/logs/:lid
router.put('/:id/logs/:lid', async function (req, res) {
  try {
    var b = req.body || {};
    var map = {
      assignmentId: 'assignment_id', assignment_id: 'assignment_id',
      workedAt: 'worked_at', worked_at: 'worked_at',
      dept: 'dept',
      authorName: 'author_name', author_name: 'author_name',
      workType: 'work_type', work_type: 'work_type',
      problem: 'problem',
      actionTaken: 'action_taken', action_taken: 'action_taken',
      durationH: 'duration_h', duration_h: 'duration_h',
      status: 'status', followup: 'followup'
    };
    var fields = [];
    var params = [];
    var idx = 1;
    Object.keys(map).forEach(function (k) {
      if (b[k] === undefined) return;
      var col = map[k];
      if (fields.some(function (f) { return f.indexOf(col + ' =') === 0; })) return;
      fields.push(col + ' = $' + idx++);
      params.push(b[k]);
    });
    if (!fields.length) return res.status(400).json({ error: 'VALIDATION', message: '변경할 필드가 없습니다.' });

    params.push(req.params.lid);
    params.push(req.params.id);
    params.push(req.tenant.id);

    var sql = 'UPDATE as_activity_logs SET ' + fields.join(', ') +
      ' WHERE id = $' + idx++ + ' AND ticket_id = $' + idx++ + ' AND tenant_id = $' + idx++ + ' RETURNING *';
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-logs/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/as-tickets/:id/logs/:lid
router.delete('/:id/logs/:lid', async function (req, res) {
  try {
    var r = await db.query(
      'DELETE FROM as_activity_logs WHERE id = $1 AND ticket_id = $2 AND tenant_id = $3 RETURNING id',
      [req.params.lid, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[as-logs/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ────────────────────────────────────────────────────────────
// ── 이슈관리 양방향 연계 (PRD §10) ──
// ────────────────────────────────────────────────────────────

// POST /api/as-tickets/:id/link-issue
// body: { issueId? } — issueId 있으면 기존 이슈에 연결, 없으면 새 이슈 자동 생성
router.post('/:id/link-issue', async function (req, res) {
  try {
    var tR = await db.query('SELECT * FROM as_tickets WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenant.id]);
    if (!tR.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var t = tR.rows[0];

    var b = req.body || {};
    var issueId = b.issueId || b.issue_id;

    if (!issueId) {
      // 새 이슈 자동 생성
      issueId = 'iss-' + require('crypto').randomUUID().slice(0, 12);
      var title = '[AS ' + t.ticket_no + '] ' + (t.customer_name || '') +
                  ' / ' + (t.equipment_model || '') + ' — ' + (t.category || '');
      var description = (t.issue_summary || '') +
        (t.rca ? '\n\n[RCA] ' + t.rca : '') +
        (t.prevention ? '\n[재발방지] ' + t.prevention : '');
      // 카테고리 → 이슈 type 매핑 (간단)
      var typeMap = { hw_fault: 'fault', sw_error: 'fault', process: 'performance',
                      sensor: 'fault', motion: 'fault', consumable: 'periodic',
                      misuse: 'inquiry', install: 'change', improve: 'improve' };
      var issueType = typeMap[t.category] || 'etc';
      var urgency = (t.priority === 'P1' || t.priority === 'P2') ? 'urgent' :
                    (t.priority === 'P3' ? 'normal' : 'low');

      var todayStr = new Date().toISOString().slice(0, 10);
      await db.query(
        'INSERT INTO issues (id, project_id, order_no, phase, dept, type, urgency, status, report_date, ' +
        ' title, description, reporter, reporter_id, assignees, tags, created_by, updated_by, tenant_id) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$17)',
        [issueId, t.project_id, t.order_no, 'as', null, issueType, urgency, 'open',
         todayStr, title, description, t.customer_name || null, req.user.sub,
         JSON.stringify([]), JSON.stringify(['from-as', t.ticket_no]),
         req.user.sub, req.tenant.id]
      );
    } else {
      // 기존 이슈 존재 검증
      var iR = await db.query('SELECT id FROM issues WHERE id = $1 AND tenant_id = $2',
        [issueId, req.tenant.id]);
      if (!iR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '대상 이슈가 없습니다.' });
    }

    await db.query(
      'UPDATE as_tickets SET linked_issue_id = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 AND tenant_id = $4',
      [issueId, req.user.sub, req.params.id, req.tenant.id]
    );

    var freshR = await db.query('SELECT * FROM as_tickets WHERE id = $1', [req.params.id]);
    res.json({ data: freshR.rows[0], issueId: issueId });
  } catch (e) {
    console.error('[as/link-issue]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

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
    console.error('[as-parts/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
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
    console.error('[as-parts/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
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
    console.error('[as-parts/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
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
    console.error('[as-parts/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ────────────────────────────────────────────────────────────
// ── 첨부 (as_attachments) ──
// ────────────────────────────────────────────────────────────

router.get('/:id/attachments', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT * FROM as_attachments WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY uploaded_at DESC',
      [req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[as-attachments/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST — 메타데이터 등록. file_url은 외부 URL 또는 data URL 가정 (v1)
router.post('/:id/attachments', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.fileName && !b.file_name) return res.status(400).json({ error: 'VALIDATION', message: '파일 이름 필수' });
    if (!b.fileUrl && !b.file_url) return res.status(400).json({ error: 'VALIDATION', message: '파일 URL 필수' });

    var id = b.id || ('asa-' + require('crypto').randomUUID().slice(0, 12));
    var r = await db.query(
      'INSERT INTO as_attachments ' +
      '(id, ticket_id, tenant_id, category, file_name, file_url, file_size, mime_type, note, uploaded_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [id, req.params.id, req.tenant.id,
       b.category || 'etc',
       b.fileName || b.file_name,
       b.fileUrl || b.file_url,
       b.fileSize != null ? b.fileSize : (b.file_size != null ? b.file_size : null),
       b.mimeType || b.mime_type || null,
       b.note || null,
       req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-attachments/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

router.delete('/:id/attachments/:aid', async function (req, res) {
  try {
    var r = await db.query(
      'DELETE FROM as_attachments WHERE id = $1 AND ticket_id = $2 AND tenant_id = $3 RETURNING id',
      [req.params.aid, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[as-attachments/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ────────────────────────────────────────────────────────────
// ── 서명·CSAT (as_signatures) ──
// ────────────────────────────────────────────────────────────

router.get('/:id/signatures', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT * FROM as_signatures WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY role ASC',
      [req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[as-signatures/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST — UPSERT (role 기준)
router.post('/:id/signatures', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.role) return res.status(400).json({ error: 'VALIDATION', message: '서명 역할 필수' });

    var id = b.id || ('ass-' + require('crypto').randomUUID().slice(0, 12));
    // UPSERT
    var r = await db.query(
      'INSERT INTO as_signatures ' +
      '(id, ticket_id, tenant_id, role, signer_name, signer_id, signed_at, signature_url, ' +
      ' csat_speed, csat_quality, csat_overall, comment, created_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,NOW()),$8,$9,$10,$11,$12,$13) ' +
      'ON CONFLICT (ticket_id, role) DO UPDATE SET ' +
      '  signer_name = EXCLUDED.signer_name, signer_id = EXCLUDED.signer_id, ' +
      '  signed_at = EXCLUDED.signed_at, signature_url = EXCLUDED.signature_url, ' +
      '  csat_speed = EXCLUDED.csat_speed, csat_quality = EXCLUDED.csat_quality, ' +
      '  csat_overall = EXCLUDED.csat_overall, comment = EXCLUDED.comment ' +
      'RETURNING *',
      [id, req.params.id, req.tenant.id, b.role,
       b.signerName || b.signer_name || null,
       b.signerId || b.signer_id || null,
       b.signedAt || b.signed_at || null,
       b.signatureUrl || b.signature_url || null,
       b.csatSpeed || b.csat_speed || null,
       b.csatQuality || b.csat_quality || null,
       b.csatOverall || b.csat_overall || null,
       b.comment || null,
       req.user.sub]
    );

    // 고객 현장 서명이 들어오면 status를 customer_wait → approved → closed 보조 자동 전이
    if (b.role === 'customer_field') {
      await db.query(
        "UPDATE as_tickets SET status = 'customer_wait', updated_at = NOW(), updated_by = $3 " +
        "WHERE id = $1 AND tenant_id = $2 AND status IN ('reporting','approved')",
        [req.params.id, req.tenant.id, req.user.sub]
      );
    }

    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-signatures/upsert]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

router.delete('/:id/signatures/:sid', async function (req, res) {
  try {
    var r = await db.query(
      'DELETE FROM as_signatures WHERE id = $1 AND ticket_id = $2 AND tenant_id = $3 RETURNING id',
      [req.params.sid, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[as-signatures/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ────────────────────────────────────────────────────────────
// ── 재발 이력 (Serial No. / 장비번호 기준 과거 A/S) ──
// 편집 모달 사이드바에서 "이 장비의 과거 A/S" 자동 표시용
// ────────────────────────────────────────────────────────────
router.get('/:id/recurrences', async function (req, res) {
  try {
    // 현재 ticket의 serial_no / equipment_no / customer_name 가져옴
    var tR = await db.query(
      "SELECT serial_no, equipment_no, equipment_model, customer_name FROM as_tickets WHERE id = $1 AND tenant_id = $2",
      [req.params.id, req.tenant.id]
    );
    if (!tR.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var cur = tR.rows[0];

    // serial_no 또는 equipment_no가 일치하는 과거 A/S (현재 제외)
    var clauses = [];
    var params = [req.tenant.id, req.params.id];
    var idx = 3;
    if (cur.serial_no) {
      clauses.push('serial_no = $' + idx++);
      params.push(cur.serial_no);
    }
    if (cur.equipment_no) {
      clauses.push('equipment_no = $' + idx++);
      params.push(cur.equipment_no);
    }
    if (!clauses.length) return res.json({ data: [], context: cur });

    var sql =
      "SELECT id, ticket_no, received_at, status, priority, category, " +
      "       issue_summary, rca, closure, closed_at, customer_name, equipment_model " +
      "FROM as_tickets " +
      "WHERE tenant_id = $1 AND id <> $2 AND deleted_at IS NULL " +
      "  AND (" + clauses.join(' OR ') + ") " +
      "ORDER BY received_at DESC LIMIT 20";
    var r = await db.query(sql, params);
    res.json({ data: r.rows, context: cur, total: r.rows.length });
  } catch (e) {
    console.error('[as-tickets/recurrences]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
});

// ────────────────────────────────────────────────────────────
// ── 보고서 메일 발송 (PDF 첨부) — 4단 보안 보강
//   1) 권한: 해당 ticket의 담당자(assignment에 본인) 또는 admin만 발송 가능
//   2) 본문 푸터에 발신자 강제 표기 (회사 명의 사칭 방지)
//   3) 발신자 본인 + tenant admin 자동 BCC (추적성)
//   4) audit_logs 기록 + 시간당 20건 rate-limit
// ────────────────────────────────────────────────────────────
router.post('/:id/email-report', emailReportLimiter, async function (req, res) {
  try {
    var b = req.body || {};
    var to = (b.to || '').trim();
    var subject = (b.subject || '').trim();
    var message = (b.message || '').trim();
    var pdfBase64 = b.pdfBase64 || '';
    var fileName = (b.fileName || 'AS_Report.pdf').replace(/[\\/:*?"<>|]/g, '_');

    if (!to) return res.status(400).json({ error: 'VALIDATION', message: '받는 사람을 입력하세요.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return res.status(400).json({ error: 'VALIDATION', message: '올바른 이메일 형식이 아닙니다.' });
    }
    if (!pdfBase64) return res.status(400).json({ error: 'VALIDATION', message: 'PDF 데이터가 비었습니다.' });

    // ticket 존재·테넌트 검증
    var tR = await db.query('SELECT ticket_no, customer_name FROM as_tickets WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [req.params.id, req.tenant.id]);
    if (!tR.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var t = tR.rows[0];

    // ─── 권한 게이트 ───
    var uR = await db.query("SELECT id, name, email, role FROM users WHERE id = $1 AND tenant_id = $2",
      [req.user.sub, req.tenant.id]);
    var me = uR.rows[0];
    if (!me) return res.status(401).json({ error: 'UNAUTHORIZED' });

    var isAdmin = (me.role === 'admin');
    var canSend = isAdmin;
    if (!canSend) {
      // 이 ticket의 active assignment에 본인이 있는가?
      var aR = await db.query(
        "SELECT 1 FROM as_assignments WHERE ticket_id = $1 AND tenant_id = $2 AND assignee_id = $3 LIMIT 1",
        [req.params.id, req.tenant.id, req.user.sub]
      );
      if (aR.rows.length) canSend = true;
    }
    if (!canSend) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: '이 접수의 담당자 또는 관리자만 메일을 발송할 수 있습니다.'
      });
    }

    // ─── BCC: 발신자 본인 + tenant admin 메일 자동 추가 ───
    var bccSet = {};
    if (me.email) bccSet[me.email.toLowerCase()] = me.email;
    var admR = await db.query(
      "SELECT email FROM users WHERE tenant_id = $1 AND role = 'admin' AND status = 'active' AND email IS NOT NULL AND email <> ''",
      [req.tenant.id]
    );
    admR.rows.forEach(function (u) { if (u.email) bccSet[u.email.toLowerCase()] = u.email; });
    // To와 중복되면 제거
    delete bccSet[(to || '').toLowerCase()];
    var bccList = Object.keys(bccSet).map(function (k) { return bccSet[k]; });

    if (!subject) subject = 'A/S 작업 보고서 ' + t.ticket_no + ' — ' + (t.customer_name || '');

    var safeMessage = (message || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\r?\n/g, '<br>');
    var senderName = (me.name || '').replace(/[<>"&]/g, '');
    var senderEmail = (me.email || '').replace(/[<>"&]/g, '');
    var ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    var nowKst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    // ─── 본문 — 푸터에 발신자 강제 표기 ───
    var html =
      '<div style="font-family:Malgun Gothic,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1F2937">' +
      '<h2 style="color:#F59E0B;border-bottom:2px solid #F59E0B;padding-bottom:8px">🛠️ A/S 작업 보고서</h2>' +
      '<p style="font-size:13px;line-height:1.7">' +
      '<strong>접수번호:</strong> ' + t.ticket_no + '<br>' +
      '<strong>고객사:</strong> ' + (t.customer_name || '-') + '<br>' +
      '</p>' +
      (safeMessage ? '<div style="background:#F9FAFB;border-left:3px solid #F59E0B;padding:10px 14px;margin:14px 0;font-size:12px;white-space:pre-wrap">' + safeMessage + '</div>' : '') +
      '<p style="font-size:12px;color:#6B7280">상세 내용은 첨부 PDF를 확인하세요.</p>' +
      '<hr style="border:none;border-top:1px solid #eee;margin:18px 0">' +
      '<div style="font-size:11px;color:#6B7280;line-height:1.6">' +
      '<strong>보낸 사람:</strong> ' + senderName + ' &lt;' + senderEmail + '&gt;<br>' +
      '<strong>발송 시각:</strong> ' + nowKst + (ip ? ' (IP ' + ip + ')' : '') + '<br>' +
      '<span style="color:#9CA3AF">본 메일은 회사 업무 관리자 시스템에서 위 담당자가 발송한 메일입니다. 회신은 위 담당자 주소로 직접 부탁드립니다.</span>' +
      '</div>' +
      '</div>';

    // data URL이면 prefix 제거
    var cleanB64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');

    await emailService.sendMail(to, subject, html, {
      subjectPrefix: '',  // 사용자가 제공한 subject 그대로
      bcc: bccList,
      replyTo: senderEmail || undefined,  // 회신은 발신자 본인에게
      attachments: [{
        filename: fileName,
        content: cleanB64,
        encoding: 'base64',
        contentType: 'application/pdf'
      }]
    });

    // ─── audit log (실패해도 발송은 성공으로 응답) ───
    try {
      await authService.auditLog(
        req.user.sub,
        'as.email_report',
        'as_ticket',
        req.params.id,
        {
          ticketNo: t.ticket_no,
          to: to,
          bccCount: bccList.length,
          fileName: fileName,
          subject: subject.slice(0, 200),
          pdfSize: Math.floor(cleanB64.length * 0.75)  // base64 → 대략 바이트
        },
        req
      );
    } catch (auditErr) {
      console.warn('[as-tickets/email-report/audit]', auditErr.message);
    }

    res.json({
      message: '메일이 발송되었습니다.',
      to: to,
      bccCount: bccList.length
    });
  } catch (e) {
    console.error('[as-tickets/email-report]', e);
    var raw = (e && e.message) || '';
    var msg = '메일 발송 실패';
    if (/Missing credentials/i.test(raw)) {
      msg = 'SMTP 자격증명 미설정 — 서버의 SMTP_USER / SMTP_PASS 환경변수를 채운 뒤 서버를 재시작하세요. (Gmail은 앱 비밀번호 필요)';
    } else if (/Invalid login|Username and Password not accepted/i.test(raw)) {
      msg = 'SMTP 로그인 실패 — Gmail은 일반 비밀번호 대신 앱 비밀번호가 필요합니다. 2단계 인증 활성화 후 myaccount.google.com/apppasswords 에서 발급하세요.';
    } else if (/ETIMEDOUT|ECONNREFUSED|connect/i.test(raw)) {
      msg = 'SMTP 서버 연결 실패 — SMTP_HOST / SMTP_PORT 설정 또는 방화벽을 확인하세요.';
    } else if (/SMTP|auth/i.test(raw)) {
      msg = '메일 발송 실패 (SMTP 설정을 확인하세요): ' + raw;
    } else {
      msg = '메일 발송 실패: ' + raw;
    }
    res.status(500).json({ error: 'EMAIL_FAILED', message: msg });
  }
});

module.exports = router;
