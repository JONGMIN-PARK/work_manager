/**
 * 텔레그램에서 하는 일 — 버튼 · 답장 · 말로 등록이 모두 여기를 거친다 (v13.301)
 *   웹과 같은 권한 규칙 (이슈 _gateIssue · 프로젝트 편집권 · A/S 담당)
 *   웹과 같은 알림 (이슈 상태 변경 → 보고자 · 담당자)
 * 반환 { ok, toast, text } — toast 는 버튼 누른 자리의 짧은 안내, text 는 대화에 남길 메시지(HTML)
 */
var crypto = require('crypto');
var db = require('../config/db');
var pa = require('../lib/project-access');
var escHtml = require('./util/escape').escHtml;

function asReq(user) {
  return {
    user: { sub: user.user_id, role: user.role || 'member', departmentId: user.department_id || null, name: user.name || '' },
    tenant: { id: user.tenant_id },
    headers: { 'user-agent': 'telegram-bot' }, socket: { remoteAddress: 'telegram' }, query: {}, params: {}
  };
}
function no(msg) { return { ok: false, toast: msg, text: '⚠️ ' + msg }; }
function kstToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }

/* ── 이슈 ── 웹 routes/issues.js _gateIssue 와 같은 규칙 */
async function gateIssue(user, id, mode) {
  var r = await db.query('SELECT id, project_id, created_by, title, status, urgency, assignees, reporter_id FROM issues WHERE id = $1 AND tenant_id = $2', [id, user.tenant_id]);
  if (!r.rows.length) return null;
  var row = r.rows[0];
  var req = asReq(user);
  var mine = row.created_by === user.user_id || user.role === 'admin';
  var canRead = row.project_id ? await pa.canReadById(req, row.project_id) : null;
  if (canRead === null) return mine ? row : null;
  if (!canRead) return null;
  if (mode !== 'edit' || mine || await pa.canEditById(req, row.project_id)) return row;
  return false;   // 웹과 같게 — 프로젝트 편집권(관리자 · 임원 · 생성자 · 참여자) 또는 이슈 작성자만
}

var ISSUE_LABEL = { open: '접수', inProgress: '대응중', resolved: '해결', closed: '종결' };

async function notifyIssueStatus(user, row, toStatus) {
  try {
    var ns = require('../services/notification.service');
    var targets = new Set();
    if (row.reporter_id) targets.add(row.reporter_id);
    var names = typeof row.assignees === 'string' ? JSON.parse(row.assignees || '[]') : (row.assignees || []);
    if (names.length) {
      var uR = await db.query("SELECT id FROM users WHERE name = ANY($1) AND status = 'active' AND tenant_id = $2", [names, user.tenant_id]);
      uR.rows.forEach(function (u) { targets.add(u.id); });
    }
    targets.delete(user.user_id);   // 바꾼 본인에게는 다시 보내지 않음
    if (targets.size) {
      await ns.notify('issue_status_changed', { title: row.title, fromStatus: row.status, toStatus: toStatus, issueId: row.id, replyRef: { kind: 'issue', id: row.id } }, Array.from(targets));
    }
  } catch (e) { console.error('[tg-actions] notify', e.message); }
}

async function issueStatus(user, id, status) {
  var row = await gateIssue(user, id, 'edit');
  if (row === null) return no('이슈를 찾을 수 없습니다');
  if (row === false) return no('이 이슈를 바꿀 권한이 없습니다');
  if (row.status === status) return { ok: true, toast: '이미 ' + (ISSUE_LABEL[status] || status) + ' 상태입니다', text: '' };
  var sets = "status = $1, updated_at = NOW(), updated_by = $2, version = version + 1";
  var params = [status, user.user_id, id, user.tenant_id];
  if (status === 'resolved') { sets += ', resolved_date = $5'; params.push(kstToday()); }
  await db.query('UPDATE issues SET ' + sets + ' WHERE id = $3 AND tenant_id = $4', params);
  notifyIssueStatus(user, row, status);
  var icon = status === 'resolved' ? '✅' : '🔵';
  return { ok: true, toast: icon + ' ' + ISSUE_LABEL[status], text: icon + ' <b>' + escHtml(row.title) + '</b> — ' + ISSUE_LABEL[status] + '(으)로 바꿨습니다' };
}

async function issueUrgent(user, id) {
  var row = await gateIssue(user, id, 'edit');
  if (row === null) return no('이슈를 찾을 수 없습니다');
  if (row === false) return no('이 이슈를 바꿀 권한이 없습니다');
  if (row.urgency === 'urgent') return { ok: true, toast: '이미 긴급입니다', text: '' };
  await db.query("UPDATE issues SET urgency = 'urgent', updated_at = NOW(), updated_by = $1, version = version + 1 WHERE id = $2 AND tenant_id = $3", [user.user_id, id, user.tenant_id]);
  return { ok: true, toast: '🔴 긴급으로 변경', text: '🔴 <b>' + escHtml(row.title) + '</b> — 긴급으로 바꿨습니다' };
}

/** 이슈 대응 이력 한 줄 (답장 · 사진) */
async function issueLog(user, id, content, attachmentNote) {
  var row = await gateIssue(user, id, 'read');
  if (!row) return no('이 이슈를 볼 수 없습니다');
  var d = new Date(Date.now() + 9 * 3600000);
  await db.query(
    "INSERT INTO issue_logs (id, issue_id, date, content, author, author_id, created_by, tenant_id, log_time, type, attachment_note) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10)",
    ['il-' + crypto.randomUUID().slice(0, 12), id, kstToday(), String(content || '').slice(0, 4000), user.name, user.user_id, user.tenant_id,
      d.toISOString().slice(11, 16), null, attachmentNote || null]
  );
  return { ok: true, toast: '기록했습니다', text: '📝 <b>' + escHtml(row.title) + '</b> 대응 이력에 남겼습니다' };
}

/* ── 체크리스트 · 회의 액션 · 개발 아이템 — 프로젝트 편집권 (또는 본인 담당) ── */
async function checklistDone(user, clId, idx) {
  var r = await db.query('SELECT items, project_id FROM checklists WHERE id = $1 AND tenant_id = $2', [clId, user.tenant_id]);
  if (!r.rows.length) return no('체크리스트를 찾을 수 없습니다');
  if (r.rows[0].project_id && !await pa.canEditById(asReq(user), r.rows[0].project_id)) return no('이 프로젝트를 바꿀 권한이 없습니다');
  var items = typeof r.rows[0].items === 'string' ? JSON.parse(r.rows[0].items) : (r.rows[0].items || []);
  var it = items[idx];
  if (!it) return no('항목을 찾을 수 없습니다');
  var label = it.title || it.text || it.name || '항목';
  if (it.done) return { ok: true, toast: '이미 완료입니다', text: '' };
  it.done = true;
  await db.query('UPDATE checklists SET items = $1, version = version + 1 WHERE id = $2 AND tenant_id = $3', [JSON.stringify(items), clId, user.tenant_id]);
  return { ok: true, toast: '✅ 완료', text: '✅ <b>' + escHtml(label) + '</b> 완료 처리했습니다' };
}

async function actionDone(user, actId) {
  var r = await db.query(
    'SELECT a.title, a.status, a.assignee_id, m.project_id FROM meeting_action_items a JOIN meetings m ON m.id = a.meeting_id WHERE a.id = $1 AND a.tenant_id = $2',
    [actId, user.tenant_id]);
  if (!r.rows.length) return no('항목을 찾을 수 없습니다');
  var a = r.rows[0];
  var ok = a.assignee_id === user.user_id || user.role === 'admin' || (a.project_id && await pa.canEditById(asReq(user), a.project_id));
  if (!ok) return no('담당자 · 프로젝트 참여자만 완료할 수 있습니다');
  if (a.status === 'done') return { ok: true, toast: '이미 완료입니다', text: '' };
  await db.query("UPDATE meeting_action_items SET status = 'done' WHERE id = $1 AND tenant_id = $2", [actId, user.tenant_id]);
  return { ok: true, toast: '✅ 완료', text: '✅ <b>' + escHtml(a.title) + '</b> 완료 처리했습니다' };
}

async function devStart(user, devId) {
  var r = await db.query('SELECT title, status, project_id FROM project_dev_items WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [devId, user.tenant_id]);
  if (!r.rows.length) return no('항목을 찾을 수 없습니다');
  var d = r.rows[0];
  if (d.project_id && !await pa.canEditById(asReq(user), d.project_id)) return no('이 프로젝트를 바꿀 권한이 없습니다');
  if (d.status === 'doing') return { ok: true, toast: '이미 진행중입니다', text: '' };
  await db.query("UPDATE project_dev_items SET status = 'doing', updated_by = $1, updated_at = NOW(), version = version + 1 WHERE id = $2 AND tenant_id = $3", [user.user_id, devId, user.tenant_id]);
  return { ok: true, toast: '🔵 진행 시작', text: '🔵 <b>' + escHtml(d.title) + '</b> — 진행중으로 바꿨습니다' };
}

/* ── A/S 배정 — 본인 담당 · 관리자 · 팀장 ── */
async function asAssign(user, asgId, what) {
  var r = await db.query(
    'SELECT a.id, a.ticket_id, a.status, a.assignee_id, t.ticket_no FROM as_assignments a JOIN as_tickets t ON t.id = a.ticket_id AND t.tenant_id = a.tenant_id WHERE a.id = $1 AND a.tenant_id = $2',
    [asgId, user.tenant_id]);
  if (!r.rows.length) return no('A/S 배정을 찾을 수 없습니다');
  var a = r.rows[0];
  if (a.assignee_id !== user.user_id && ['admin', 'manager'].indexOf(user.role) < 0) return no('담당자만 바꿀 수 있습니다');
  var to = what === 'done' ? 'completed' : 'in_progress';
  if (a.status === to) return { ok: true, toast: '이미 ' + (to === 'completed' ? '완료' : '진행중') + '입니다', text: '' };
  var col = to === 'completed' ? 'completed_at' : 'started_at';
  await db.query('UPDATE as_assignments SET status = $1, ' + col + ' = COALESCE(' + col + ', NOW()), updated_at = NOW(), updated_by = $2 WHERE id = $3 AND tenant_id = $4',
    [to, user.user_id, asgId, user.tenant_id]);
  if (to === 'in_progress') {
    await db.query("UPDATE as_tickets SET status = 'in_progress', updated_at = NOW(), updated_by = $3 WHERE id = $1 AND tenant_id = $2 AND status IN ('received','assigned')",
      [a.ticket_id, user.tenant_id, user.user_id]).catch(function () {});
  }
  try { require('../routes/as-tickets/_shared')._invalidateStatsCache(user.tenant_id); } catch (_) {}
  var label = to === 'completed' ? '✅ 완료' : '🛠 작업 시작';
  return { ok: true, toast: label, text: label + ' — A/S <b>' + escHtml(a.ticket_no || '') + '</b> 내 배정' };
}

/* ── 쪽지 · 댓글 답장 — 웹 라우트와 같은 함수 ── */
async function sendMessage(user, toUserId, body) {
  var out = await require('../routes/messages').sendSiteMessage(asReq(user), { toUserId: toUserId, body: body });
  if (out.status !== 201) return no((out.body && out.body.message) || '보내지 못했습니다');
  var nm = await db.query('SELECT COALESCE(display_name, name) AS n FROM users WHERE id = $1', [toUserId]);
  return { ok: true, toast: '보냈습니다', text: '✉️ ' + escHtml(nm.rows.length ? nm.rows[0].n : '') + ' 님께 쪽지를 보냈습니다' };
}

async function replyComment(user, commentId, body) {
  var c = await db.query('SELECT id, target_type, target_id, parent_id, author_id FROM comments WHERE id = $1 AND tenant_id = $2', [commentId, user.tenant_id]);
  if (!c.rows.length) return no('피드백을 찾을 수 없습니다');
  var row = c.rows[0];
  var recips = row.author_id && row.author_id !== user.user_id ? [row.author_id] : undefined;
  var out = await require('../routes/comments').createComment(asReq(user), {
    targetType: row.target_type, targetId: row.target_id, body: body, parentId: row.parent_id || row.id,
    recipientIds: recips, sendEmail: false
  });
  if (out.status !== 201) return no((out.body && out.body.message) || '남기지 못했습니다');
  return { ok: true, toast: '남겼습니다', text: '💬 피드백에 답글을 남겼습니다' };
}

module.exports = {
  asReq: asReq, gateIssue: gateIssue,
  issueStatus: issueStatus, issueUrgent: issueUrgent, issueLog: issueLog,
  checklistDone: checklistDone, actionDone: actionDone, devStart: devStart, asAssign: asAssign,
  sendMessage: sendMessage, replyComment: replyComment
};
