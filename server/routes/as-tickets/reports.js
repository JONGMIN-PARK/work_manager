/**
 * A/S 재발 이력 (recurrences) + 보고서 메일 발송 (email-report)
 * routes/as-tickets.js 가 /api/as-tickets 아래(인증·테넌트 미들웨어 뒤)에 마운트한다.
 */
var express = require('express');
var router = express.Router();
var db = require('../../config/db');
var emailService = require('../../services/email.service');
var authService = require('../../services/auth.service');
var rateLimit = require('express-rate-limit');
var httpErr = require('../../lib/http-errors');

// 보고서 메일 발송 — 사용자당 시간당 20건 제한 (스팸·오·악용 방지)
var emailReportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: function (req) { return (req.user && req.user.sub) || req.ip; },
  message: { error: 'RATE_LIMIT', message: '시간당 메일 발송 한도(20건)를 초과했습니다. 잠시 후 다시 시도하세요.' },
  standardHeaders: true,
  legacyHeaders: false
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
    httpErr.serverError(res, '[as-tickets/recurrences]', e, '서버 오류가 발생했습니다.');
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
      msg = '메일 발송 실패';
    }
    res.status(500).json({ error: 'EMAIL_FAILED', message: msg });
  }
});


module.exports = router;
