var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var operator = require('../middleware/operator');
var emailService = require('../services/email.service');
var notificationService = require('../services/notification.service');
var authService = require('../services/auth.service');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// HTML 이스케이프 (이메일 본문용)
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 대상의 project_id 결정. milestone이면 마일스톤에서 조회.
// 반환: { projectId, exists, tenantShared } / exists=false 면 대상 없음
//   tenantShared=true → 프로젝트에 속하지 않는 조직 공유 대상(사전검토·요소기술).
//   이 경우 프로젝트 권한 게이트를 건너뛰고 같은 테넌트 구성원이면 접근 가능.
async function resolveTarget(req, targetType, targetId) {
  if (targetType === 'project') {
    var pr = await db.query('SELECT id FROM projects WHERE id = $1 AND tenant_id = $2', [targetId, req.tenant.id]);
    if (!pr.rows.length) return { exists: false };
    return { exists: true, projectId: targetId };
  }
  if (targetType === 'tech') {
    // 요소기술은 조직 자산 — project_id 없음. 테넌트 구성원이 공유.
    var tr = await db.query('SELECT id FROM tech_assets WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [targetId, req.tenant.id]);
    if (!tr.rows.length) return { exists: false };
    return { exists: true, projectId: null, tenantShared: true };
  }
  if (targetType === 'prestudy') {
    // 사전검토는 프로젝트 이전 단계 — project_id 없음. 테넌트 구성원이 공유.
    var sr = await db.query('SELECT id FROM prestudies WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [targetId, req.tenant.id]);
    if (!sr.rows.length) return { exists: false };
    return { exists: true, projectId: null, tenantShared: true };
  }
  if (targetType === 'doc') {   // v13.542 📄 문서 댓글 — 프로젝트 문서만 (프로젝트 권한 그대로) · 개인 문서는 받지 않음
    var fr = await db.query('SELECT project_id, uploaded_by FROM project_files WHERE id = $1 AND tenant_id = $2', [targetId, req.tenant.id]);
    if (!fr.rows.length) return { exists: false };
    if (!fr.rows[0].project_id) return { exists: true, personal: true };
    return { exists: true, projectId: fr.rows[0].project_id, uploader: fr.rows[0].uploaded_by };
  }
  // milestone
  var mr = await db.query('SELECT project_id FROM milestones WHERE id = $1 AND tenant_id = $2', [targetId, req.tenant.id]);
  if (!mr.rows.length) return { exists: false };
  return { exists: true, projectId: mr.rows[0].project_id };
}

// 프로젝트에 대한 코멘트 접근/작성 권한 (admin · 운영자 · owner/PL/활성멤버)
// — lib/project-access.canComment. 가시성(tenant/dept 공개)만으로는 허용하지 않는 "협업" 규칙.
var canAccessProject = require('../lib/project-access').canComment;
var httpErr = require('../lib/http-errors');

// 자동 수신자 결정 (작성자 본인 제외) → [{userId, name, email}]
/** 본문의 @이름 → 사용자 (이름 · 표시명 · 등록 이름 · 다른 이름). 프로젝트 대상이면 생성자 · 활성 멤버 · 관리자만 (못 보는 사람에게 알리지 않음) */
async function resolveMentions(req, body, projectId, tgt) {
  var toks = [], re = /@([^\s@,，.!?()\[\]]{1,30})/g, m;
  while ((m = re.exec(body)) && toks.length < 20) if (toks.indexOf(m[1]) < 0) toks.push(m[1]);
  if (!toks.length) return [];
  var r = await db.query("SELECT id, name, display_name, reg_name, aliases, email, role FROM users WHERE tenant_id = $1 AND status = 'active'", [req.tenant.id]);
  var hit = r.rows.filter(function (u) {
    var names = [u.name, u.display_name, u.reg_name].concat(String(u.aliases || '').split(',')).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    return toks.some(function (t) { return names.indexOf(t) >= 0; });
  }).filter(function (u) { return u.id !== req.user.sub; });
  if (projectId && hit.length) {
    var p = (await db.query('SELECT owner_id FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, req.tenant.id])).rows[0] || {};
    var mem = (await db.query('SELECT user_id FROM project_members WHERE project_id = $1 AND released_at IS NULL', [projectId])).rows.map(function (x) { return x.user_id; });
    hit = hit.filter(function (u) { return u.role === 'admin' || u.id === p.owner_id || mem.indexOf(u.id) >= 0; });
  }
  return hit.map(function (u) { return { userId: u.id, name: u.display_name || u.name || '', email: u.email || null, mentioned: true }; });
}

async function resolveRecipients(req, targetType, targetId, projectId, recipientIds, tgt) {
  var rows = [];
  if (Array.isArray(recipientIds) && recipientIds.length > 0) {
    var ur = await db.query(
      'SELECT id, name, display_name, email FROM users WHERE id = ANY($1) AND tenant_id = $2',
      [recipientIds, req.tenant.id]
    );
    rows = ur.rows;
  } else if (targetType === 'tech') {
    // 요소기술 — 담당(owner) + 참여자(이름) 매칭
    var tcr = await db.query('SELECT owner_id, participants FROM tech_assets WHERE id = $1 AND tenant_id = $2', [targetId, req.tenant.id]);
    if (tcr.rows.length) {
      var tc = tcr.rows[0];
      var tNames = tc.participants;
      if (typeof tNames === 'string') { try { tNames = JSON.parse(tNames); } catch (_) { tNames = []; } }
      if (!Array.isArray(tNames)) tNames = [];
      var tOwner = tc.owner_id ? await db.query('SELECT id, name, display_name, email FROM users WHERE id = $1 AND tenant_id = $2', [tc.owner_id, req.tenant.id]) : { rows: [] };
      var tParts = tNames.length
        ? await db.query('SELECT id, name, display_name, email FROM users WHERE tenant_id = $1 AND (name = ANY($2) OR display_name = ANY($2))', [req.tenant.id, tNames])
        : { rows: [] };
      rows = tOwner.rows.concat(tParts.rows);
    }
  } else if (targetType === 'prestudy') {
    // 사전검토 — 담당(owner) + 참여자(이름) 매칭
    var psr = await db.query('SELECT owner_id, participants FROM prestudies WHERE id = $1 AND tenant_id = $2', [targetId, req.tenant.id]);
    if (psr.rows.length) {
      var ps = psr.rows[0];
      var pNames = ps.participants;
      if (typeof pNames === 'string') { try { pNames = JSON.parse(pNames); } catch (_) { pNames = []; } }
      if (!Array.isArray(pNames)) pNames = [];
      var byOwner = ps.owner_id ? await db.query('SELECT id, name, display_name, email FROM users WHERE id = $1 AND tenant_id = $2', [ps.owner_id, req.tenant.id]) : { rows: [] };
      var byNames = pNames.length
        ? await db.query('SELECT id, name, display_name, email FROM users WHERE tenant_id = $1 AND (name = ANY($2) OR display_name = ANY($2))', [req.tenant.id, pNames])
        : { rows: [] };
      rows = byOwner.rows.concat(byNames.rows);
    }
  } else if (targetType === 'doc') {
    // 📄 문서 — 올린 사람 (나머지는 @이름 으로 부름)
    if (tgt && tgt.uploader) rows = (await db.query('SELECT id, name, display_name, email FROM users WHERE id = $1 AND tenant_id = $2', [tgt.uploader, req.tenant.id])).rows;
  } else if (targetType === 'milestone') {
    // 마일스톤 assignee_targets 키(이름)들을 users.name/display_name로 매칭
    var msr = await db.query('SELECT assignee_targets FROM milestones WHERE id = $1 AND tenant_id = $2', [targetId, req.tenant.id]);
    var at = (msr.rows.length && msr.rows[0].assignee_targets) || {};
    var names = Object.keys(at);
    if (names.length > 0) {
      var nr = await db.query(
        'SELECT id, name, display_name, email FROM users WHERE tenant_id = $1 AND (name = ANY($2) OR display_name = ANY($2))',
        [req.tenant.id, names]
      );
      rows = nr.rows;
    }
  } else {
    // project — 활성 멤버
    var pmr = await db.query(
      'SELECT u.id, u.name, u.display_name, u.email FROM project_members pm ' +
      'JOIN users u ON pm.user_id = u.id ' +
      'WHERE pm.project_id = $1 AND pm.released_at IS NULL AND u.tenant_id = $2',
      [projectId, req.tenant.id]
    );
    rows = pmr.rows;
  }

  // 작성자 본인 제외 + 중복 제거
  var seen = {};
  var out = [];
  rows.forEach(function (r) {
    if (!r.id || r.id === req.user.sub) return;
    if (seen[r.id]) return;
    seen[r.id] = true;
    out.push({ userId: r.id, name: r.display_name || r.name || '', email: r.email || null });
  });
  return out;
}

// ─── POST /api/comments — 코멘트 작성 + 알림 발송 ───
/**
 * 댓글 등록 — 웹 POST / 와 텔레그램 답장(v13.302)이 같은 규칙 · 같은 알림을 쓴다.
 * onCreated(comment) 는 저장 직후(알림 전) 불림 → 웹은 여기서 응답. 반환 { status, body }
 */
async function createComment(req, b, onCreated) {
  {
    var targetType = b.targetType || b.target_type;
    var targetId = b.targetId || b.target_id;
    var body = (b.body != null) ? String(b.body).trim() : '';
    if (['project', 'milestone', 'prestudy', 'tech', 'doc'].indexOf(targetType) === -1) {
      return _r(400, { error: 'BAD_REQUEST', message: "targetType은 'project', 'milestone', 'prestudy', 'tech', 'doc' 중 하나여야 합니다." });
    }
    if (!targetId) return _r(400, { error: 'BAD_REQUEST', message: 'targetId 필수' });
    if (!body) return _r(400, { error: 'BAD_REQUEST', message: '본문은 비어 있을 수 없습니다.' });

    var tgt = await resolveTarget(req, targetType, targetId);
    if (!tgt.exists) return _r(404, { error: 'NOT_FOUND', message: '대상을 찾을 수 없습니다.' });
    if (tgt.personal) return _r(400, { error: 'BAD_REQUEST', message: '개인 문서에는 댓글을 달 수 없습니다 — 프로젝트로 옮긴 뒤 달아 주세요.' });
    var projectId = tgt.projectId;

    if (!tgt.tenantShared && !await canAccessProject(req, projectId)) {
      return _r(403, { error: 'FORBIDDEN', message: '이 프로젝트에 코멘트 권한이 없습니다.' });
    }

    var sendEmail = b.sendEmail !== false;
    var sendTelegram = b.sendTelegram !== false;
    var recipientIds = b.recipientIds || b.recipient_ids;

    var recipients = await resolveRecipients(req, targetType, targetId, projectId, recipientIds, tgt);
    // @이름 — 불린 사람도 받는 사람에 (그 프로젝트를 볼 수 있는 사람만 · v13.542)
    var mentioned = await resolveMentions(req, body, projectId, tgt);
    mentioned.forEach(function (m) { if (!recipients.some(function (r) { return r.userId === m.userId; })) recipients.push(m); });

    // 작성자명
    var authorName = req.user.name || '';
    try {
      var ar = await db.query('SELECT name, display_name FROM users WHERE id = $1', [req.user.sub]);
      if (ar.rows.length) authorName = ar.rows[0].display_name || ar.rows[0].name || authorName;
    } catch (_) {}

    var id = 'cmt-' + crypto.randomUUID().slice(0, 12);
    var ir = await db.query(
      'INSERT INTO comments (id, target_type, target_id, project_id, tenant_id, author_id, author_name, body, recipients, parent_id) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [id, targetType, targetId, projectId, req.tenant.id, req.user.sub, authorName, body,
       JSON.stringify(recipients), b.parentId || b.parent_id || null]
    );
    var comment = ir.rows[0];

    // 응답 먼저 (알림은 best-effort, 응답 차단 안 함)
    if (onCreated) onCreated(comment);

    // 대상 표시명 (이메일/텔레그램 제목용)
    var targetName = '';
    var orderNo = '';
    try {
      if (targetType === 'tech') {
        var tn = await db.query('SELECT name, code FROM tech_assets WHERE id = $1 AND tenant_id = $2', [targetId, req.tenant.id]);
        if (tn.rows.length) {
          targetName = (tn.rows[0].code ? '[' + tn.rows[0].code + '] ' : '') + (tn.rows[0].name || '');
        }
      } else if (targetType === 'prestudy') {
        // 사전검토는 프로젝트가 없음 — 검토 건 제목(업체)을 대상명으로 사용
        var psn = await db.query('SELECT title, client FROM prestudies WHERE id = $1 AND tenant_id = $2', [targetId, req.tenant.id]);
        if (psn.rows.length) {
          targetName = (psn.rows[0].client ? psn.rows[0].client + ' / ' : '') + (psn.rows[0].title || '');
        }
      } else {
        var pr = await db.query('SELECT name, order_no FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, req.tenant.id]);
        var projName = pr.rows.length ? (pr.rows[0].name || '') : '';
        orderNo = pr.rows.length ? (pr.rows[0].order_no || '') : '';
        if (targetType === 'doc') {
          var dfn = await db.query('SELECT name FROM project_files WHERE id = $1 AND tenant_id = $2', [targetId, req.tenant.id]);
          targetName = (projName ? projName + ' / ' : '') + '📄 ' + ((dfn.rows[0] && dfn.rows[0].name) || '문서');
        } else if (targetType === 'milestone') {
          var mnr = await db.query('SELECT name FROM milestones WHERE id = $1 AND tenant_id = $2', [targetId, req.tenant.id]);
          var msName = mnr.rows.length ? (mnr.rows[0].name || '') : '';
          targetName = (projName ? projName + ' / ' : '') + msName;
        } else {
          targetName = projName;
        }
      }
    } catch (_) {}

    // ─── 이메일 발송 (best-effort) ───
    if (sendEmail) {
      try {
        var typeLabel = targetType === 'milestone' ? '마일스톤' : targetType === 'doc' ? '문서' : (targetType === 'prestudy' ? '사전검토' : (targetType === 'tech' ? '요소기술' : '프로젝트'));
        var subject = (targetName || typeLabel) + ' 피드백';
        var html = '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:20px">' +
          '<h2 style="color:#3B82F6;margin:0 0 12px">새 피드백</h2>' +
          '<p style="margin:4px 0"><strong>대상:</strong> ' + esc(targetName) + '</p>' +
          '<p style="margin:4px 0"><strong>작성자:</strong> ' + esc(authorName) + '</p>' +
          '<div style="margin:16px 0;padding:12px 16px;background:#f4f4f5;border-radius:8px;white-space:pre-wrap">' +
          esc(body) + '</div>' +
          '<hr style="border:none;border-top:1px solid #eee;margin:16px 0">' +
          '<p style="font-size:12px;color:#888">업무 관리자 시스템</p>' +
          '</div>';
        recipients.forEach(function (r) {
          if (!r.email) return;
          emailService.sendMail(r.email, subject, html).catch(function () {});
        });
      } catch (e) {
        console.error('[comments/email]', e.message);
      }
    }

    // ─── 텔레그램 알림 (best-effort) ───
    if (sendTelegram) {
      try {
        var targetUserIds = recipients.map(function (r) { return r.userId; }).filter(Boolean);
        if (targetUserIds.length > 0) {
          notificationService.notify('comment_added', {
            targetName: targetName, orderNo: orderNo, authorName: authorName, body: body,
            replyRef: { kind: 'comment', id: comment.id }   // 텔레그램에서 이 알림에 답장하면 답글 (v13.302)
          }, targetUserIds).catch(function (e) { console.error('[comments/telegram]', e.message); });
        }
      } catch (e) {
        console.error('[comments/telegram]', e.message);
      }
    }

    // ─── 감사 로그 (best-effort) ───
    try {
      authService.auditLog(req.user.sub, 'comment.create', targetType, targetId,
        { project_id: projectId, recipients: recipients.length, bodyLength: body.length }, req
      ).catch(function () {});
    } catch (_) {}
  }
  return { status: 201, body: { data: comment } };
}
function _r(status, body) { return { status: status, body: body }; }

router.post('/', async function (req, res) {
  try {
    var sent = false;
    var out = await createComment(req, req.body || {}, function (c) { sent = true; res.status(201).json({ data: c }); });
    if (!sent) res.status(out.status).json(out.body);
  } catch (e) {
    if (!res.headersSent) httpErr.serverError(res, '[comments/create]', e);
    else console.error('[comments/create]', e.message);
  }
});

// ─── GET /api/comments?targetType=&targetId= — 코멘트 목록 ───
router.get('/', async function (req, res) {
  try {
    var targetType = req.query.targetType || req.query.target_type;
    var targetId = req.query.targetId || req.query.target_id;
    if (['project', 'milestone', 'prestudy', 'tech', 'doc'].indexOf(targetType) === -1) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: "targetType은 'project', 'milestone', 'prestudy', 'tech', 'doc' 중 하나여야 합니다." });
    }
    if (!targetId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'targetId 필수' });

    var tgt = await resolveTarget(req, targetType, targetId);
    if (!tgt.exists) return res.status(404).json({ error: 'NOT_FOUND', message: '대상을 찾을 수 없습니다.' });
    if (tgt.personal) return res.json({ data: [] });
    if (!tgt.tenantShared && !await canAccessProject(req, tgt.projectId)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: '이 프로젝트에 접근 권한이 없습니다.' });
    }

    var r = await db.query(
      'SELECT * FROM comments WHERE target_type = $1 AND target_id = $2 AND tenant_id = $3 ORDER BY created_at DESC LIMIT 200',
      [targetType, targetId, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[comments/list]', e);
  }
});

// ─── DELETE /api/comments/:id — 작성자 또는 admin만 ───
router.delete('/:id', async function (req, res) {
  try {
    var cr = await db.query('SELECT author_id FROM comments WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!cr.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '코멘트를 찾을 수 없습니다.' });
    if (cr.rows[0].author_id !== req.user.sub && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'FORBIDDEN', message: '작성자 또는 관리자만 삭제할 수 있습니다.' });
    }
    await db.query('DELETE FROM comments WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[comments/delete]', e);
  }
});

module.exports = router;
module.exports.createComment = createComment;
