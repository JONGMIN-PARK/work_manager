/**
 * 이메일 서비스 — Nodemailer (Gmail SMTP)
 * 가입 승인/거절 알림, 비밀번호 재설정 등
 */

var config = require('../config');

var transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  try {
    var nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass
      }
    });
    return transporter;
  } catch (e) {
    console.warn('[EMAIL] nodemailer 사용 불가:', e.message);
    return null;
  }
}

// opts: { attachments?: [{filename, content (Buffer|base64 string), encoding?, contentType?}], subjectPrefix?: string|null }
async function sendMail(to, subject, html, opts) {
  opts = opts || {};
  var t = getTransporter();
  if (!t) {
    console.log('[EMAIL] 전송 스킵 (SMTP 미설정):', to, subject);
    return false;
  }

  var prefix = (opts.subjectPrefix === null || opts.subjectPrefix === '') ? '' :
               (opts.subjectPrefix || '[업무 관리자] ');
  var msg = {
    from: config.smtp.from || config.smtp.user,
    to: to,
    subject: prefix + subject,
    html: html
  };
  if (Array.isArray(opts.attachments) && opts.attachments.length) {
    msg.attachments = opts.attachments;
  }
  if (opts.bcc) {
    msg.bcc = Array.isArray(opts.bcc) ? opts.bcc.filter(Boolean).join(',') : opts.bcc;
  }
  if (opts.cc) {
    msg.cc = Array.isArray(opts.cc) ? opts.cc.filter(Boolean).join(',') : opts.cc;
  }
  if (opts.replyTo) {
    msg.replyTo = opts.replyTo;
  }

  try {
    await t.sendMail(msg);
    console.log('[EMAIL] 전송 완료:', to, subject);
    return true;
  } catch (e) {
    console.error('[EMAIL] 전송 실패:', e.message);
    throw e;
  }
}

// ─── 템플릿 ───

function approvalEmail(userName, role) {
  var roleLabels = { admin: '관리자', executive: '임원', manager: '팀장', member: '팀원' };
  return {
    subject: '가입이 승인되었습니다',
    html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">' +
      '<h2 style="color:#3B82F6">가입 승인 완료</h2>' +
      '<p>' + userName + '님, 업무 관리자 가입이 승인되었습니다.</p>' +
      '<p>역할: <strong>' + (roleLabels[role] || role) + '</strong></p>' +
      '<p>지금 바로 로그인하여 시작하세요.</p>' +
      '<hr style="border:none;border-top:1px solid #eee;margin:16px 0">' +
      '<p style="font-size:12px;color:#888">업무 관리자 시스템</p>' +
      '</div>'
  };
}

function rejectionEmail(userName, reason) {
  return {
    subject: '가입 요청이 거절되었습니다',
    html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">' +
      '<h2 style="color:#EF4444">가입 거절</h2>' +
      '<p>' + userName + '님, 가입 요청이 거절되었습니다.</p>' +
      (reason ? '<p>사유: ' + reason + '</p>' : '') +
      '<p>문의사항이 있으시면 관리자에게 연락하세요.</p>' +
      '<hr style="border:none;border-top:1px solid #eee;margin:16px 0">' +
      '<p style="font-size:12px;color:#888">업무 관리자 시스템</p>' +
      '</div>'
  };
}

function passwordResetEmail(userName, tempPassword) {
  return {
    subject: '비밀번호가 초기화되었습니다',
    html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">' +
      '<h2 style="color:#F59E0B">비밀번호 초기화</h2>' +
      '<p>' + userName + '님, 관리자에 의해 비밀번호가 초기화되었습니다.</p>' +
      '<p>임시 비밀번호: <strong style="font-family:monospace;font-size:16px;background:#f4f4f5;padding:4px 8px;border-radius:4px">' + tempPassword + '</strong></p>' +
      '<p style="color:#EF4444">로그인 후 반드시 비밀번호를 변경하세요.</p>' +
      '<hr style="border:none;border-top:1px solid #eee;margin:16px 0">' +
      '<p style="font-size:12px;color:#888">업무 관리자 시스템</p>' +
      '</div>'
  };
}

module.exports = {
  sendMail: sendMail,
  approvalEmail: approvalEmail,
  rejectionEmail: rejectionEmail,
  passwordResetEmail: passwordResetEmail
};
