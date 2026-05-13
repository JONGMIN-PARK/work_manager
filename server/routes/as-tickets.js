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
    // 내 큐: 현재 사용자에게 할당된 active 할당이 있는 ticket만
    if (q.myQueue === '1' || q.myQueue === 'true') {
      sql += ' AND EXISTS (SELECT 1 FROM as_assignments a WHERE a.ticket_id = as_tickets.id ' +
             'AND a.tenant_id = as_tickets.tenant_id AND a.assignee_id = $' + idx + ' ' +
             "AND a.status NOT IN ('completed','cancelled'))";
      params.push(req.user.sub); idx++;
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

// GET /api/as-tickets/:id — 단건 (?expand=1 시 children 동봉)
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM as_tickets WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var data = r.rows[0];
    if (req.query.expand === '1' || req.query.expand === 'true') {
      var [a, l] = await Promise.all([
        db.query('SELECT * FROM as_assignments WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY role ASC, created_at ASC',
          [req.params.id, req.tenant.id]),
        db.query('SELECT * FROM as_activity_logs WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY worked_at ASC, seq ASC',
          [req.params.id, req.tenant.id])
      ]);
      data.assignments = a.rows;
      data.activityLogs = l.rows;
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

module.exports = router;
