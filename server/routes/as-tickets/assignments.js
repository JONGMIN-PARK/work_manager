/**
 * A/S 부서 할당 (as_assignments)
 * routes/as-tickets.js 가 /api/as-tickets 아래(인증·테넌트 미들웨어 뒤)에 마운트한다.
 */
var express = require('express');
var router = express.Router();
var db = require('../../config/db');
var notificationService = require('../../services/notification.service');
var httpErr = require('../../lib/http-errors');

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
    httpErr.serverError(res, '[as-assignments/list]', e);
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
    httpErr.serverError(res, '[as-assignments/create]', e);
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
    httpErr.serverError(res, '[as-assignments/update]', e);
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
    httpErr.serverError(res, '[as-assignments/delete]', e);
  }
});


module.exports = router;
