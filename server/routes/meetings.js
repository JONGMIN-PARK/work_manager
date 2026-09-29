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
var ps = require('../lib/project-access');
var notificationService = require('../services/notification.service');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

/** 액션아이템 배정 알림 (fire-and-forget) — 배정자 본인 제외 */
async function notifyActionAssigned(action, meetingTitle, actorId) {
  try {
    if (!action || !action.assignee_id || action.assignee_id === actorId) return;
    await notificationService.notify('action_item_assigned', {
      actionId: action.id, title: action.title, meetingTitle: meetingTitle, dueDate: action.due_date
    }, [action.assignee_id]);
  } catch (e) { console.error('[meetings/notify]', e.message); }
}

/** 회의록 양식 칸 (v13.198) — 알려진 키만, 빈 값 제외, 각 4000자. 화면 PMT_FORM_KEYS 와 맞춘다(test/meeting-form-keys.test.js) */
var FORM_KEYS = ['timeStart', 'timeEnd', 'place', 'writer', 'purpose', 'decisions', 'nextDate', 'nextNote', 'completedAt', 'completedBy'];
function _formOf(f) {
  var out = {};
  FORM_KEYS.forEach(function (k) { if (f && f[k] != null && String(f[k]).trim() !== '') out[k] = String(f[k]).slice(0, 4000); });
  return out;
}

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

/** 회의 한 건 + 권한 (v13.202) — 프로젝트 회의: 읽기 canRead · 쓰기 canEdit(생성자·참여자·관리자·임원), 일반 회의: 작성자만.
 *  실패 시 응답(404/403)을 보내고 null. 성공 시 { m, proj } */
async function _meetingGate(req, res, needEdit, meetingId) {
  var r = await db.query('SELECT * FROM meetings WHERE id = $1 AND tenant_id = $2', [meetingId || req.params.id, req.tenant.id]);
  if (!r.rows.length) { res.status(404).json({ error: 'NOT_FOUND', message: '회의를 찾을 수 없습니다.' }); return null; }
  var m = r.rows[0], proj = null;
  if (m.project_id) {
    var pr = await db.query('SELECT id, name, order_no, owner_id, visibility, department_id FROM projects WHERE id = $1 AND tenant_id = $2', [m.project_id, req.tenant.id]);
    proj = pr.rows[0] || null;
    var ok = proj && (needEdit ? await ps.canEdit(req, proj) : await ps.canRead(req, proj));
    if (!ok) { res.status(403).json({ error: 'FORBIDDEN', message: needEdit ? '프로젝트 생성자·참여자·관리자만 회의를 수정할 수 있습니다.' : '접근 권한이 없습니다.' }); return null; }
  } else if (m.created_by !== req.user.sub) {
    res.status(403).json({ error: 'FORBIDDEN', message: '접근 권한이 없습니다.' }); return null;
  }
  return { m: m, proj: proj };
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
    // 프로젝트 회의 목록이면 이 사용자가 회의를 등록·수정할 수 있는지 함께 (화면이 편집 버튼을 숨기는 데 사용, v13.204)
    var out = { data: r.rows };
    if (req.query.projectId) out.canEdit = (await ps.canEditById(req, req.query.projectId)) === true;
    res.json(out);
  } catch (e) {
    httpErr.serverError(res, '[meetings/list]', e);
  }
});

// GET /api/meetings/:id
router.get('/:id', async function (req, res) {
  try {
    var x = await _meetingGate(req, res, false); if (!x) return;
    await attachActions([x.m], req.tenant.id);
    res.json({ data: x.m });
  } catch (e) {
    httpErr.serverError(res, '[meetings/get]', e);
  }
});

// POST /api/meetings
router.post('/', async function (req, res) {
  try {
    var b = req.body;
    if (!b.title) return res.status(400).json({ error: 'VALIDATION', message: 'title 필수' });
    var projectId = b.projectId || b.project_id || null;
    if (projectId) {
      var can = await ps.canEditById(req, projectId);
      if (can === null) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
      if (!can) return res.status(403).json({ error: 'FORBIDDEN', message: '프로젝트 생성자·참여자·관리자만 회의를 등록할 수 있습니다.' });
    }
    var id = b.id || genId('mtg');
    var meetDate = b.meetDate || b.meet_date || null;
    var r = await db.query(
      "INSERT INTO meetings (id, tenant_id, project_id, title, meet_date, agenda, minutes, attendees, form, created_by, updated_by) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *",
      [id, req.tenant.id, projectId, b.title, meetDate,
       JSON.stringify(b.agenda || []), b.minutes || null, JSON.stringify(b.attendees || []), JSON.stringify(_formOf(b.form)), req.user.sub]
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
    httpErr.serverError(res, '[meetings/create]', e);
  }
});

// PUT /api/meetings/:id — body.version 을 주면 낙관적 락: 그사이 다른 사람이 저장했으면 409 + 최신 회의(data)
router.put('/:id', async function (req, res) {
  try {
    var x = await _meetingGate(req, res, true); if (!x) return;
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
    if (b.form !== undefined) set('form', JSON.stringify(_formOf(b.form)));   // 회의록 양식 칸 (v13.198)
    if (!sets.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '수정할 항목이 없습니다.' });
    sets.push('updated_by = $' + idx++); params.push(req.user.sub);
    sets.push('updated_at = now()');
    sets.push('version = version + 1');
    params.push(req.params.id);
    var idIdx = idx++;
    params.push(req.tenant.id);
    var where = ' WHERE id = $' + idIdx + ' AND tenant_id = $' + idx++;
    var ver = b.version != null ? parseInt(b.version, 10) : NaN;
    if (!isNaN(ver)) { where += ' AND version = $' + idx; params.push(ver); }
    var r = await db.query('UPDATE meetings SET ' + sets.join(', ') + where + ' RETURNING *', params);
    if (!r.rows.length) {
      var cur = await db.query('SELECT * FROM meetings WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
      if (!cur.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
      await attachActions(cur.rows, req.tenant.id);
      return res.status(409).json({ error: 'CONFLICT', message: '다른 사람이 먼저 이 회의를 저장했습니다.', data: cur.rows[0] });
    }
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
    httpErr.serverError(res, '[meetings/update]', e);
  }
});

// DELETE /api/meetings/:id — 연동 일정 함께 삭제, 액션아이템 CASCADE
router.delete('/:id', async function (req, res) {
  try {
    var x = await _meetingGate(req, res, true); if (!x) return;
    var eventId = x.m.event_id;
    await db.query('DELETE FROM meetings WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (eventId) await db.query('DELETE FROM events WHERE id = $1 AND tenant_id = $2', [eventId, req.tenant.id]);
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[meetings/delete]', e);
  }
});

/* ── 회의록 문서: 미리 보기 · 받는 사람 · 메일 (v13.198) ── */
var minutesDoc = require('../lib/meeting-minutes');
var emailService = require('../services/email.service');

/** 회의 + 액션 + 프로젝트 이름. 프로젝트 회의는 프로젝트 읽기 권한, 일반 회의는 작성자만. 실패 시 응답 후 null */
async function _meetingForDoc(req, res) {
  var x = await _meetingGate(req, res, false); if (!x) return null;
  await attachActions([x.m], req.tenant.id);
  return x;
}
/** 참석자 이름(name·display_name) → 계정 메일. 이름 → 주소 (처음 찾은 것) */
async function _emailsByName(tenantId, names) {
  var found = {};
  if (!names.length) return found;
  var u = await db.query("SELECT name, display_name, email FROM users WHERE tenant_id = $1 AND status = 'active' AND (name = ANY($2) OR display_name = ANY($2)) AND email IS NOT NULL", [tenantId, names]);
  u.rows.forEach(function (row) { [row.name, row.display_name].forEach(function (n) { if (n && names.indexOf(n) >= 0 && !found[n]) found[n] = row.email; }); });
  return found;
}
/** 공유(발송) 기록 — 서버 발송·메일 앱·Outlook 초안 공통 */
function _markMailed(req, byName, to) {
  return db.query('UPDATE meetings SET mailed_at = now(), mailed_by_name = $1, mailed_to = $2 WHERE id = $3 AND tenant_id = $4', [byName, JSON.stringify(to), req.params.id, req.tenant.id]);
}
async function _senderName(req) {
  try { var u = await db.query('SELECT name, display_name, email FROM users WHERE id = $1', [req.user.sub]); if (u.rows.length) return u.rows[0]; } catch (_) {}
  return { name: req.user.name || '', email: null };
}

// POST /api/meetings/:id/render — 회의록 문서 HTML (저장된 내용 기준). body: { message? }
router.post('/:id/render', async function (req, res) {
  try {
    var x = await _meetingForDoc(req, res); if (!x) return;
    var doc = minutesDoc.renderMinutes(x.m, { projectName: x.proj && x.proj.name, orderNo: x.proj && x.proj.order_no, message: (req.body && req.body.message) || '', sign: !!(req.body && req.body.sign) });
    var smtpCfg = require('../config').smtp || {};
    res.json({ data: { subject: doc.subject, html: doc.html, docNo: doc.docNo, mailedAt: x.m.mailed_at, mailedByName: x.m.mailed_by_name, mailedTo: x.m.mailed_to || [], smtp: !!(smtpCfg.user && smtpCfg.pass) } });
  } catch (e) {
    httpErr.serverError(res, '[meetings/render]', e);
  }
});

// GET /api/meetings/:id/mail-recipients — 참석자 이름 → 계정 메일 주소
//  v13.199: 메일 앱으로 보내기(mailto·.eml)는 브라우저가 주소를 알아야 하므로 실제 주소도 준다.
//  _meetingForDoc 가 프로젝트 읽기 권한(일반 회의는 작성자)을 확인한 뒤에만 응답한다.
router.get('/:id/mail-recipients', async function (req, res) {
  try {
    var x = await _meetingForDoc(req, res); if (!x) return;
    var names = (Array.isArray(x.m.attendees) ? x.m.attendees : []).filter(Boolean).map(String);
    var found = await _emailsByName(req.tenant.id, names);
    function mask(e) { var p = String(e).split('@'); return (p[0].length <= 2 ? p[0][0] + '*' : p[0].slice(0, 2) + '***') + '@' + p[1]; }
    res.json({ data: names.map(function (n) { return { name: n, hasEmail: !!found[n], masked: found[n] ? mask(found[n]) : null, email: found[n] || null }; }) });
  } catch (e) {
    httpErr.serverError(res, '[meetings/mail-recipients]', e);
  }
});

// POST /api/meetings/:id/mail — 회의록 메일 발송
//  body: { attendees: string[] (메일로 보낼 참석자 이름), emails: string[] (직접 입력 주소), message?, ccMe? }
router.post('/:id/mail', async function (req, res) {
  try {
    var x = await _meetingForDoc(req, res); if (!x) return;
    var b = req.body || {};
    var pickNames = (Array.isArray(b.attendees) ? b.attendees : []).map(String).filter(function (n) { return (x.m.attendees || []).indexOf(n) >= 0; });
    var extra = (Array.isArray(b.emails) ? b.emails : []).map(function (e) { return String(e).trim(); }).filter(Boolean);
    var bad = extra.filter(function (e) { return !minutesDoc.isEmail(e); });
    if (bad.length) return res.status(400).json({ error: 'VALIDATION', message: '메일 주소 형식 오류: ' + bad.slice(0, 3).join(', ') });
    var byName = await _emailsByName(req.tenant.id, pickNames);
    var to = pickNames.map(function (n) { return byName[n]; }).filter(minutesDoc.isEmail);
    extra.forEach(function (e) { to.push(e); });
    var seen = {}; to = to.filter(function (e) { var k = e.toLowerCase(); if (seen[k]) return false; seen[k] = true; return true; });
    if (!to.length) return res.status(400).json({ error: 'VALIDATION', message: '받는 사람이 없습니다.' });
    if (to.length > 50) return res.status(400).json({ error: 'VALIDATION', message: '받는 사람은 50명 이하로 지정하세요.' });
    var smtp = require('../config').smtp || {};
    if (!smtp.user || !smtp.pass) return res.status(503).json({ error: 'MAIL_DISABLED', message: '메일 서버(SMTP)가 설정되지 않아 보낼 수 없습니다. 관리자에게 SMTP 설정을 요청하세요.' });
    var me = await _senderName(req);
    var sender = me.display_name || me.name || '';
    var doc = minutesDoc.renderMinutes(x.m, { projectName: x.proj && x.proj.name, orderNo: x.proj && x.proj.order_no, message: String(b.message || '').slice(0, 2000), sender: sender });
    var opts = { subjectPrefix: '' };
    if (me.email && minutesDoc.isEmail(me.email)) { opts.replyTo = me.email; if (b.ccMe) opts.cc = [me.email]; }
    // 받는 사람끼리 주소가 보이지 않게 — 본인(또는 첫 주소)을 To, 나머지는 BCC
    var primary = (me.email && minutesDoc.isEmail(me.email)) ? me.email : to[0];
    opts.bcc = to.filter(function (e) { return e !== primary; });
    if (opts.cc && opts.cc[0] === primary) delete opts.cc;
    var sent;
    try { sent = await emailService.sendMail(primary, doc.subject, doc.html, opts); }
    catch (se) { return res.status(502).json({ error: 'MAIL_FAILED', message: '메일 전송에 실패했습니다: ' + se.message }); }
    if (sent === false) return res.status(503).json({ error: 'MAIL_DISABLED', message: '메일 서버(SMTP)가 설정되지 않아 보낼 수 없습니다.' });
    await _markMailed(req, sender, to);
    res.json({ data: { sent: to.length, mailedAt: new Date().toISOString() }, message: to.length + '명에게 보냈습니다.' });
  } catch (e) {
    httpErr.serverError(res, '[meetings/mail]', e);
  }
});

// POST /api/meetings/:id/mail-log — 메일 앱(mailto·.eml)으로 보낸 경우의 기록. body: { to: string[], method: 'app'|'eml' }
//  실제 발송 여부는 서버가 알 수 없으므로 "공유함" 기록만 남긴다.
router.post('/:id/mail-log', async function (req, res) {
  try {
    var x = await _meetingForDoc(req, res); if (!x) return;
    var to = (Array.isArray(req.body && req.body.to) ? req.body.to : []).map(function (e) { return String(e).trim(); }).filter(minutesDoc.isEmail).slice(0, 50);
    var me = await _senderName(req);
    var by = (me.display_name || me.name || '') + ((req.body && req.body.method) === 'eml' ? ' (Outlook 초안)' : ' (메일 앱)');
    await _markMailed(req, by, to);
    res.json({ data: { mailedAt: new Date().toISOString() } });
  } catch (e) {
    httpErr.serverError(res, '[meetings/mail-log]', e);
  }
});

/* ── 액션아이템 ── */

// POST /api/meetings/:id/actions
router.post('/:id/actions', async function (req, res) {
  try {
    var x = await _meetingGate(req, res, true); if (!x) return;
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
    notifyActionAssigned(r.rows[0], x.m.title, req.user.sub);
  } catch (e) {
    httpErr.serverError(res, '[meetings/action/create]', e);
  }
});

// PUT /api/meetings/:id/actions/:aid
router.put('/:id/actions/:aid', async function (req, res) {
  try {
    var x = await _meetingGate(req, res, true); if (!x) return;
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
    // 담당자를 명시적으로 (재)지정한 경우 배정 알림
    if ((b.assigneeName !== undefined || b.assignee_name !== undefined) && r.rows[0].assignee_id) {
      notifyActionAssigned(r.rows[0], x.m.title, req.user.sub);
    }
  } catch (e) {
    httpErr.serverError(res, '[meetings/action/update]', e);
  }
});

// DELETE /api/meetings/:id/actions/:aid
router.delete('/:id/actions/:aid', async function (req, res) {
  try {
    var x = await _meetingGate(req, res, true); if (!x) return;
    var r = await db.query('DELETE FROM meeting_action_items WHERE id = $1 AND meeting_id = $2 AND tenant_id = $3 RETURNING id', [req.params.aid, req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[meetings/action/delete]', e);
  }
});

// POST /api/meetings/:id/actions/:aid/convert — 이슈/개발아이템 전환 (body: { target: 'issue' | 'dev' })
router.post('/:id/actions/:aid/convert', async function (req, res) {
  try {
    var gate = await _meetingGate(req, res, true); if (!gate) return;
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
    httpErr.serverError(res, '[meetings/action/convert]', e);
  }
});

module.exports = router;
