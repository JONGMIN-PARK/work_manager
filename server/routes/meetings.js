/**
 * 회의 관리 라우트 — PRD_프로젝트관리_확장 모듈 B
 * - 회의 CRUD (+ events(type=meeting) 자동 발행/동기화)
 * - 액션아이템 CRUD + 이슈/개발아이템 전환
 * 규약: 인증 + 테넌트 격리 + 접근가능 프로젝트 제한 + 낙관적 락.
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var crypto = require('crypto');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var ps = require('../middleware/project-scope');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

function genId(prefix) { return prefix + '-' + crypto.randomUUID().slice(0, 12); }
function today() { return new Date().toISOString().slice(0, 10); }

/** 회의 → events(type=meeting) 자동 발행/동기화. event_id 반환. */
async function syncMeetingEvent(meeting, tenantId, userId) {
  if (!meeting.meet_date) return meeting.event_id || null;
  var projectIds = meeting.project_id ? JSON.stringify([meeting.project_id]) : '[]';
  if (meeting.event_id) {
    await db.query(
      "UPDATE events SET title = $1, start_date = $2, end_date = $2, project_ids = $3 WHERE id = $4 AND tenant_id = $5",
      [meeting.title, meeting.meet_date, projectIds, meeting.event_id, tenantId]
    );
    return meeting.event_id;
  }
  var evId = genId('evt');
  await db.query(
    "INSERT INTO events (id, title, type, start_date, end_date, project_ids, created_by, tenant_id) VALUES ($1,$2,'meeting',$3,$3,$4,$5,$6)",
    [evId, meeting.title, meeting.meet_date, projectIds, userId, tenantId]
  );
  return evId;
}

/** 이름 → user_id 해석 (테넌트 내 정확매칭, 없으면 null) */
async function resolveUserId(name, tenantId) {
  if (!name) return null;
  try {
    var r = await db.query("SELECT id FROM users WHERE name = $1 AND tenant_id = $2 AND status = 'active' LIMIT 1", [name, tenantId]);
    return r.rows.length ? r.rows[0].id : null;
  } catch (_) { return null; }
}

/** 회의에 액션아이템 배열 첨부 */
async function attachActions(meetings, tenantId) {
  if (!meetings.length) return meetings;
  var ids = meetings.map(function (m) { return m.id; });
  var r = await db.query(
    'SELECT * FROM meeting_action_items WHERE meeting_id = ANY($1) AND tenant_id = $2 ORDER BY sort_order, created_at',
    [ids, tenantId]
  );
  var byMeeting = {};
  r.rows.forEach(function (a) { (byMeeting[a.meeting_id] = byMeeting[a.meeting_id] || []).push(a); });
  meetings.forEach(function (m) { m.action_items = byMeeting[m.id] || []; });
  return meetings;
}

// GET /api/meetings?projectId=
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT * FROM meetings WHERE tenant_id = $1';
    var params = [req.tenant.id];
    var idx = 2;
    if (req.query.projectId) { sql += ' AND project_id = $' + idx++; params.push(req.query.projectId); }
    var sub = ps.accessibleProjectsSubquery(req, idx);
    // project_id NULL(일반 회의)은 작성자 본인만
    sql += ' AND (project_id IN (' + sub.sql + ') OR (project_id IS NULL AND created_by = $' + sub.nextIdx + '))';
    params = params.concat(sub.params);
    params.push(req.user.sub);
    sql += ' ORDER BY meet_date DESC NULLS LAST, created_at DESC';
    var r = await db.query(sql, params);
    await attachActions(r.rows, req.tenant.id);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[meetings/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/meetings/:id
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM meetings WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    await attachActions(r.rows, req.tenant.id);
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[meetings/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/meetings
router.post('/', async function (req, res) {
  try {
    var b = req.body;
    if (!b.title) return res.status(400).json({ error: 'VALIDATION', message: 'title 필수' });
    var projectId = b.projectId || b.project_id || null;
    if (projectId) {
      var pR = await db.query('SELECT id FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, req.tenant.id]);
      if (!pR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
    }
    var id = b.id || genId('mtg');
    var meetDate = b.meetDate || b.meet_date || null;
    var r = await db.query(
      "INSERT INTO meetings (id, tenant_id, project_id, title, meet_date, agenda, minutes, attendees, created_by, updated_by) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *",
      [id, req.tenant.id, projectId, b.title, meetDate,
       JSON.stringify(b.agenda || []), b.minutes || null, JSON.stringify(b.attendees || []), req.user.sub]
    );
    var meeting = r.rows[0];
    // 일정 자동 발행
    if (meetDate) {
      var evId = await syncMeetingEvent(meeting, req.tenant.id, req.user.sub);
      if (evId && evId !== meeting.event_id) {
        await db.query('UPDATE meetings SET event_id = $1 WHERE id = $2 AND tenant_id = $3', [evId, id, req.tenant.id]);
        meeting.event_id = evId;
      }
    }
    meeting.action_items = [];
    res.status(201).json({ data: meeting });
  } catch (e) {
    console.error('[meetings/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/meetings/:id
router.put('/:id', async function (req, res) {
  try {
    var b = req.body;
    var sets = [];
    var params = [];
    var idx = 1;
    function set(col, val) { sets.push(col + ' = $' + idx++); params.push(val); }
    if (b.title !== undefined) set('title', b.title);
    if (b.meetDate !== undefined || b.meet_date !== undefined) set('meet_date', b.meetDate || b.meet_date || null);
    if (b.agenda !== undefined) set('agenda', JSON.stringify(b.agenda || []));
    if (b.minutes !== undefined) set('minutes', b.minutes || null);
    if (b.attendees !== undefined) set('attendees', JSON.stringify(b.attendees || []));
    if (!sets.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '수정할 항목이 없습니다.' });
    sets.push('updated_by = $' + idx++); params.push(req.user.sub);
    sets.push('updated_at = now()');
    sets.push('version = version + 1');
    params.push(req.params.id);
    var idIdx = idx++;
    params.push(req.tenant.id);
    var sql = 'UPDATE meetings SET ' + sets.join(', ') + ' WHERE id = $' + idIdx + ' AND tenant_id = $' + idx + ' RETURNING *';
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var meeting = r.rows[0];
    // 일정 동기화 (제목/일자 변경 반영, meet_date 새로 생기면 발행)
    var evId = await syncMeetingEvent(meeting, req.tenant.id, req.user.sub);
    if (evId && evId !== meeting.event_id) {
      await db.query('UPDATE meetings SET event_id = $1 WHERE id = $2 AND tenant_id = $3', [evId, meeting.id, req.tenant.id]);
      meeting.event_id = evId;
    }
    await attachActions([meeting], req.tenant.id);
    res.json({ data: meeting });
  } catch (e) {
    console.error('[meetings/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/meetings/:id — 연동 일정 함께 삭제, 액션아이템 CASCADE
router.delete('/:id', async function (req, res) {
  try {
    var mR = await db.query('SELECT event_id FROM meetings WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!mR.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var eventId = mR.rows[0].event_id;
    await db.query('DELETE FROM meetings WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (eventId) await db.query('DELETE FROM events WHERE id = $1 AND tenant_id = $2', [eventId, req.tenant.id]);
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[meetings/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

/* ── 액션아이템 ── */

// POST /api/meetings/:id/actions
router.post('/:id/actions', async function (req, res) {
  try {
    var mR = await db.query('SELECT id FROM meetings WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!mR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '회의를 찾을 수 없습니다.' });
    var b = req.body;
    if (!b.title) return res.status(400).json({ error: 'VALIDATION', message: 'title 필수' });
    var assigneeName = b.assigneeName || b.assignee_name || null;
    var assigneeId = await resolveUserId(assigneeName, req.tenant.id);
    var id = genId('act');
    var r = await db.query(
      "INSERT INTO meeting_action_items (id, tenant_id, meeting_id, title, assignee_name, assignee_id, due_date, status, sort_order) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8) RETURNING *",
      [id, req.tenant.id, req.params.id, b.title, assigneeName, assigneeId, b.dueDate || b.due_date || null, parseInt(b.sortOrder || b.sort_order, 10) || 0]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[meetings/action/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/meetings/:id/actions/:aid
router.put('/:id/actions/:aid', async function (req, res) {
  try {
    var b = req.body;
    var sets = [];
    var params = [];
    var idx = 1;
    function set(col, val) { sets.push(col + ' = $' + idx++); params.push(val); }
    if (b.title !== undefined) set('title', b.title);
    if (b.dueDate !== undefined || b.due_date !== undefined) set('due_date', b.dueDate || b.due_date || null);
    if (b.status !== undefined) set('status', b.status === 'done' ? 'done' : 'open');
    if (b.assigneeName !== undefined || b.assignee_name !== undefined) {
      var an = b.assigneeName || b.assignee_name || null;
      set('assignee_name', an);
      set('assignee_id', await resolveUserId(an, req.tenant.id));
    }
    if (!sets.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '수정할 항목이 없습니다.' });
    params.push(req.params.aid);
    var aidIdx = idx++;
    params.push(req.params.id);
    var midIdx = idx++;
    params.push(req.tenant.id);
    var sql = 'UPDATE meeting_action_items SET ' + sets.join(', ') + ' WHERE id = $' + aidIdx + ' AND meeting_id = $' + midIdx + ' AND tenant_id = $' + idx + ' RETURNING *';
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[meetings/action/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/meetings/:id/actions/:aid
router.delete('/:id/actions/:aid', async function (req, res) {
  try {
    var r = await db.query('DELETE FROM meeting_action_items WHERE id = $1 AND meeting_id = $2 AND tenant_id = $3 RETURNING id', [req.params.aid, req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[meetings/action/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/meetings/:id/actions/:aid/convert — 이슈/개발아이템 전환 (body: { target: 'issue' | 'dev' })
router.post('/:id/actions/:aid/convert', async function (req, res) {
  try {
    var target = req.body.target === 'dev' ? 'dev' : 'issue';
    var aR = await db.query(
      'SELECT a.*, m.project_id FROM meeting_action_items a JOIN meetings m ON m.id = a.meeting_id AND m.tenant_id = a.tenant_id ' +
      'WHERE a.id = $1 AND a.meeting_id = $2 AND a.tenant_id = $3',
      [req.params.aid, req.params.id, req.tenant.id]
    );
    if (!aR.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var action = aR.rows[0];
    if (!action.project_id) return res.status(400).json({ error: 'VALIDATION', message: '프로젝트에 연결된 회의만 전환할 수 있습니다.' });

    var created;
    if (target === 'dev') {
      if (action.linked_dev_item_id) return res.status(409).json({ error: 'CONFLICT', message: '이미 개발 아이템으로 전환됨' });
      var devId = genId('dev');
      var dR = await db.query(
        "INSERT INTO project_dev_items (id, tenant_id, project_id, title, category, status, priority, assignee_id, created_by, updated_by) " +
        "VALUES ($1,$2,$3,$4,'feature','todo','normal',$5,$6,$6) RETURNING *",
        [devId, req.tenant.id, action.project_id, action.title, action.assignee_id || null, req.user.sub]
      );
      created = dR.rows[0];
      await db.query('UPDATE meeting_action_items SET linked_dev_item_id = $1 WHERE id = $2 AND tenant_id = $3', [devId, action.id, req.tenant.id]);
    } else {
      if (action.linked_issue_id) return res.status(409).json({ error: 'CONFLICT', message: '이미 이슈로 전환됨' });
      var issId = genId('iss');
      var assignees = action.assignee_name ? JSON.stringify([action.assignee_name]) : '[]';
      var iR = await db.query(
        "INSERT INTO issues (id, project_id, urgency, status, report_date, due_date, title, description, reporter_id, assignees, tags, created_by, updated_by, tenant_id) " +
        "VALUES ($1,$2,'normal','open',$3,$4,$5,$6,$7,$8,$9,$7,$7,$10) RETURNING *",
        [issId, action.project_id, today(), action.due_date || null, action.title, '회의 액션아이템에서 생성', req.user.sub, assignees, JSON.stringify(['meeting']), req.tenant.id]
      );
      created = iR.rows[0];
      await db.query('UPDATE meeting_action_items SET linked_issue_id = $1 WHERE id = $2 AND tenant_id = $3', [issId, action.id, req.tenant.id]);
    }
    res.status(201).json({ data: { target: target, created: created } });
  } catch (e) {
    console.error('[meetings/action/convert]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
