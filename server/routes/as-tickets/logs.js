/**
 * A/S 활동 로그 (as_activity_logs) + 이슈관리 양방향 연계 (link-issue)
 * routes/as-tickets.js 가 /api/as-tickets 아래(인증·테넌트 미들웨어 뒤)에 마운트한다.
 */
var express = require('express');
var router = express.Router();
var db = require('../../config/db');
var httpErr = require('../../lib/http-errors');

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
    httpErr.serverError(res, '[as-logs/list]', e);
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
    httpErr.serverError(res, '[as-logs/create]', e);
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
    httpErr.serverError(res, '[as-logs/update]', e);
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
    httpErr.serverError(res, '[as-logs/delete]', e);
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
    httpErr.serverError(res, '[as/link-issue]', e);
  }
});


module.exports = router;
