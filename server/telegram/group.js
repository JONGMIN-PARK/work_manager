/**
 * 그룹방 = 프로젝트방 (v13.304)
 *   연결: 웹 프로젝트 → [텔레그램 그룹방 연결] → 봇을 그룹에 추가하는 링크(t.me/봇?startgroup=코드)
 *         → 그룹에 "/start 코드" 가 오면 연결 (코드 30분 · 한 번). 그룹에서 /linkgroup 코드 도 됨.
 *   그룹에서: /project(이 프로젝트 요약) · /issues(열린 이슈) · /vote · /closevote · /unlinkgroup · /help
 *             사진 + 설명 → 이 프로젝트 이슈로 등록 (사진은 문서관리에 저장)
 *   알림: 이 프로젝트 알림(진척 · 수정 · 이슈 …)이 그룹방에도 온다 (notification/groups.js)
 *   사람 확인은 보낸 사람(from.id)으로 — 그룹방 번호는 사람이 아니다. 연동 안 한 사람의 명령은 받지 않는다.
 */
var crypto = require('crypto');
var db = require('../config/db');
var pa = require('../lib/project-access');
var refs = require('./refs');
var files = require('./files');
var escHtml = require('./util/escape').escHtml;

function asReq(user) { return files.asReq(user); }
function kstToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }

async function linkOf(chatId) {
  var r = await db.query("SELECT * FROM telegram_group_links WHERE chat_id = $1 AND is_active = TRUE", [chatId]);
  return r.rows[0] || null;
}

/** 코드로 연결 — 보낸 사람이 같은 회사 · 그 프로젝트 편집권이 있어야 */
async function linkByCode(c, code) {
  if (!c.user) return c.send(c.chatId, '🔒 이 그룹방을 연결하려면 먼저 봇과 1:1 대화에서 계정을 연동하세요.');
  var got = await refs.takeGroupCode(code);
  if (!got || !got.data || !got.data.projectId) return c.send(c.chatId, '❌ 연결 코드가 맞지 않거나 30분이 지났습니다. 웹에서 다시 만들어 주세요.');
  if (got.tenant_id !== c.user.tenant_id) return c.send(c.chatId, '❌ 다른 회사의 연결 코드입니다.');
  var pid = got.data.projectId;
  if (!await pa.canEditById(asReq(c.user), pid)) return c.send(c.chatId, '❌ 이 프로젝트의 참여자 · 관리자만 그룹방을 연결할 수 있습니다.');
  var pr = await db.query('SELECT name, order_no FROM projects WHERE id = $1 AND tenant_id = $2', [pid, c.user.tenant_id]);
  if (!pr.rows.length) return c.send(c.chatId, '❌ 프로젝트를 찾을 수 없습니다.');
  await db.query('DELETE FROM telegram_group_links WHERE chat_id = $1', [c.chatId]);
  await db.query(
    "INSERT INTO telegram_group_links (chat_id, tenant_id, link_type, link_id, linked_by, title, is_active) VALUES ($1,$2,'project',$3,$4,$5,TRUE)",
    [c.chatId, c.user.tenant_id, pid, c.user.user_id, String((c.msg.chat && c.msg.chat.title) || '').slice(0, 200)]
  );
  var p = pr.rows[0];
  return c.send(c.chatId, '✅ <b>프로젝트방 연결 완료</b>\n' + (p.order_no ? '[' + escHtml(p.order_no) + '] ' : '') + escHtml(p.name) +
    '\n\n이제 이 방에서:\n• 이 프로젝트 알림(진척 · 수정 · 이슈)을 받습니다\n• 사진 + 설명을 올리면 이 프로젝트 이슈로 등록됩니다\n• /project 요약 · /issues 열린 이슈 · /vote 투표\n\n<i>명령은 봇과 계정을 연동한 사람만 쓸 수 있습니다.</i>');
}

/** 예전 방식 /linkgroup project <id> — 관리자 · 팀장 + 프로젝트 편집권 */
async function linkById(c, type, id) {
  if (!c.user) return c.send(c.chatId, '🔒 먼저 봇과 1:1 대화에서 계정을 연동하세요.');
  if (['admin', 'manager'].indexOf(c.user.role) < 0) return c.send(c.chatId, '🔒 관리자 · 팀장만 연결할 수 있습니다. 웹 프로젝트 화면의 [텔레그램 그룹방 연결]을 쓰세요.');
  if (type === 'project') {
    if (!id || !await pa.canEditById(asReq(c.user), id)) return c.send(c.chatId, '❌ 해당 프로젝트에 대한 권한이 없습니다.');
  } else if (type === 'team') {
    var d = await db.query('SELECT id FROM departments WHERE id = $1 AND tenant_id = $2', [id, c.user.tenant_id]);
    if (!d.rows.length) return c.send(c.chatId, '❌ 해당 부서에 대한 권한이 없습니다.');
  } else if (type !== 'announce') {
    return c.send(c.chatId, '사용법: 웹 프로젝트 화면 → [텔레그램 그룹방 연결] (권장)\n또는 /linkgroup project &lt;프로젝트ID&gt;');
  }
  await db.query('DELETE FROM telegram_group_links WHERE chat_id = $1', [c.chatId]);
  await db.query(
    'INSERT INTO telegram_group_links (chat_id, tenant_id, link_type, link_id, linked_by, title, is_active) VALUES ($1,$2,$3,$4,$5,$6,TRUE)',
    [c.chatId, c.user.tenant_id, type, id || null, c.user.user_id, String((c.msg.chat && c.msg.chat.title) || '').slice(0, 200)]
  );
  return c.send(c.chatId, '✅ 그룹 연동 완료! (' + escHtml(type) + ')');
}

async function unlink(c, link) {
  if (!c.user || !link || link.tenant_id !== c.user.tenant_id) return c.send(c.chatId, '🔒 이 방을 연결한 회사의 연동된 사람만 해제할 수 있습니다.');
  var ok = ['admin', 'manager'].indexOf(c.user.role) >= 0 || link.linked_by === c.user.user_id ||
    (link.link_type === 'project' && await pa.canEditById(asReq(c.user), link.link_id));
  if (!ok) return c.send(c.chatId, '🔒 연결한 사람 · 프로젝트 참여자 · 관리자만 해제할 수 있습니다.');
  await db.query('DELETE FROM telegram_group_links WHERE chat_id = $1', [c.chatId]);
  return c.send(c.chatId, '🔓 그룹 연동이 해제되었습니다.');
}

/** 이 방의 프로젝트를 볼 수 있는 사람인지 → 프로젝트 행 */
async function projectFor(c, link) {
  if (!link || link.link_type !== 'project' || !c.user || link.tenant_id !== c.user.tenant_id) return null;
  if (!await pa.canReadById(asReq(c.user), link.link_id)) return null;
  var r = await db.query('SELECT id, name, order_no, status, progress, start_date, end_date FROM projects WHERE id = $1 AND tenant_id = $2', [link.link_id, link.tenant_id]);
  return r.rows[0] || null;
}

async function cmdProject(c, p) {
  var ms = await db.query(
    "SELECT name, end_date, progress, status FROM milestones WHERE tenant_id = $1 AND project_id = $2 AND COALESCE(status,'') <> 'done' ORDER BY end_date NULLS LAST LIMIT 3",
    [c.user.tenant_id, p.id]);
  var iss = await db.query(
    "SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE urgency = 'urgent')::int AS u FROM issues WHERE tenant_id = $1 AND project_id = $2 AND status NOT IN ('resolved','closed')",
    [c.user.tenant_id, p.id]);
  var today = kstToday();
  var late = p.status !== 'done' && p.end_date && String(p.end_date).slice(0, 10) < today;
  var msg = '📁 <b>' + (p.order_no ? '[' + escHtml(p.order_no) + '] ' : '') + escHtml(p.name) + '</b>\n' +
    '진행률 ' + (p.progress || 0) + '% · ' + (p.start_date || '-') + ' ~ ' + (p.end_date || '-') + (late ? ' ⚠️ 납기 지남' : '') + '\n' +
    '열린 이슈 ' + iss.rows[0].n + '건' + (iss.rows[0].u ? ' (🔴 긴급 ' + iss.rows[0].u + ')' : '');
  if (ms.rows.length) {
    msg += '\n\n<b>다가오는 마일스톤</b>\n' + ms.rows.map(function (m) {
      var mLate = m.end_date && String(m.end_date).slice(0, 10) < today;
      return '• ' + escHtml(m.name) + ' — ' + (m.end_date || '-') + (mLate ? ' ⚠️' : '') + ' · ' + (m.progress || 0) + '%';
    }).join('\n');
  }
  return c.send(c.chatId, msg);
}

async function cmdIssues(c, p) {
  var r = await db.query(
    "SELECT id, title, urgency, status FROM issues WHERE tenant_id = $1 AND project_id = $2 AND status NOT IN ('resolved','closed') " +
    "ORDER BY CASE urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at DESC LIMIT 10",
    [c.user.tenant_id, p.id]);
  if (!r.rows.length) return c.send(c.chatId, '🎉 ' + escHtml(p.name) + ' — 열린 이슈가 없습니다.');
  var icon = { urgent: '🔴', normal: '🟡', low: '🟢' };
  return c.send(c.chatId, '🎫 <b>' + escHtml(p.name) + ' 열린 이슈 ' + r.rows.length + '건</b>\n' + r.rows.map(function (i) {
    return (icon[i.urgency] || '•') + ' ' + escHtml(i.title) + (i.status === 'inProgress' ? ' <i>(대응중)</i>' : '');
  }).join('\n'));
}

/**
 * 사진 · 파일 → 이슈 (개인 대화는 프로젝트 없이, 프로젝트방은 그 프로젝트로)
 * @returns 보낸 메시지
 */
async function photoIssue(c, projectId, caption) {
  var file = files.pickFile(c.msg);
  var issueId = 'iss-' + crypto.randomUUID().slice(0, 12);
  var today = kstToday();
  var saved = file ? await files.saveToDocs(c.user, file, projectId, '이슈 사진 — ' + caption) : null;
  var note = !file ? '' : saved && saved.ok ? '📎 ' + saved.name + ' (문서관리)' : '📎 텔레그램 사진 — ' + files.failText(saved && saved.reason);
  await db.query(
    "INSERT INTO issues (id, tenant_id, project_id, title, description, urgency, status, report_date, reporter, reporter_id, assignees, tags, created_by, updated_by) " +
    "VALUES ($1,$2,$3,$4,$5,'normal','open',$6,$7,$8,$9,$10,$8,$8)",
    [issueId, c.user.tenant_id, projectId || null, caption.slice(0, 500), '텔레그램에서 등록' + (note ? '\n' + note : ''), today, c.user.name, c.user.user_id,
      JSON.stringify([c.user.name]), JSON.stringify(['telegram', 'photo'])]
  );
  var sent = await c.send(c.chatId, '📸 <b>이슈 등록 완료</b>\n\n제목: ' + escHtml(caption) + '\n상태: 접수 · 긴급도: 보통\n등록자: ' + escHtml(c.user.name) +
    (note ? '\n' + escHtml(note) : '') + '\n\n<i>↩️ 이 메시지에 답장하면 대응 이력으로 남습니다</i>', {
    reply_markup: JSON.stringify({ inline_keyboard: [[
      { text: '🔴 긴급으로 변경', callback_data: 'issue_urgent:' + issueId },
      { text: '🔵 대응 시작', callback_data: 'issue_start:' + issueId }
    ]] })
  });
  await refs.remember(sent, { tenantId: c.user.tenant_id, userId: c.chatId > 0 ? c.user.user_id : null, kind: 'issue', refId: issueId });
  return sent;
}

/**
 * 그룹방 메시지 처리
 * @param {object} c { chatId, user|null, msg, text, send, cmds: { vote, closeVote, help } }
 */
async function handle(c) {
  var text = c.text || '';
  var link = await linkOf(c.chatId);

  if (/^\/(start|linkgroup)\s+G[0-9A-F]{8}$/i.test(text)) return linkByCode(c, text.split(/\s+/)[1]);
  if (/^\/linkgroup(\s|$)/.test(text)) {
    var a = text.replace(/^\/linkgroup\s*/, '').trim().split(/\s+/);
    return linkById(c, a[0] || '', a[1] || '');
  }
  if (text === '/start') return c.send(c.chatId, '👋 이 방을 프로젝트방으로 쓰려면 웹 프로젝트 화면 → [텔레그램 그룹방 연결]을 누르세요.');
  if (text === '/unlinkgroup') return unlink(c, link);

  var isCmd = text.charAt(0) === '/';
  var hasPhoto = (c.msg.photo && c.msg.photo.length) || c.msg.document;
  if (!isCmd && !hasPhoto) return null;   // 그룹 대화는 봇이 끼어들지 않음
  if (!c.user) {
    return isCmd ? c.send(c.chatId, '🔒 봇 명령은 계정을 연동한 사람만 쓸 수 있습니다 — 봇과 1:1 대화에서 연동하세요.') : null;
  }
  if (link && link.tenant_id && link.tenant_id !== c.user.tenant_id) return null;

  if (/^\/help(\s|$)/.test(text)) {
    return c.send(c.chatId, '👥 <b>그룹방에서 쓰는 명령</b>\n/project — 이 프로젝트 요약\n/issues — 열린 이슈\n/vote 질문 + 줄마다 선택지 — 투표\n/closevote — 투표 종료\n/unlinkgroup — 연결 해제\n📸 사진 + 설명 — 이 프로젝트 이슈로 등록\n\n<i>내 업무 · 할 일 · 업무일지는 봇과 1:1 대화에서 쓰세요.</i>');
  }
  if (/^\/vote(\s|$)/.test(text)) return c.cmds.vote(c.chatId, c.user, text.replace(/^\/vote\s*/, ''));
  if (/^\/closevote(\s|$)/.test(text)) return c.cmds.closeVote(c.chatId, c.user, text.replace(/^\/closevote\s*/, ''));

  var p = await projectFor(c, link);
  if (/^\/(project|issues|progress)(\s|$)/.test(text)) {
    if (!link || link.link_type !== 'project') return c.send(c.chatId, '이 방은 아직 프로젝트와 연결되지 않았습니다 — 웹 프로젝트 화면 → [텔레그램 그룹방 연결]');
    if (!p) return c.send(c.chatId, '🔒 이 프로젝트를 볼 권한이 없습니다.');
    return /^\/issues/.test(text) ? cmdIssues(c, p) : cmdProject(c, p);
  }
  if (hasPhoto && !isCmd) {
    if (!p) return null;   // 연결 안 된 방의 사진은 그냥 둠
    if (!await pa.canEditById(asReq(c.user), p.id)) return null;
    var caption = String(c.msg.caption || '').trim();
    if (!caption) return null;   // 설명 없는 사진은 대화로 보고 그냥 둠
    return photoIssue(c, p.id, caption);
  }
  if (isCmd) return c.send(c.chatId, '이 명령은 봇과 1:1 대화에서 쓰세요. 그룹방 명령: /help');
  return null;
}

module.exports = { handle: handle, linkOf: linkOf, linkByCode: linkByCode, photoIssue: photoIssue, cmdProject: cmdProject, cmdIssues: cmdIssues };
