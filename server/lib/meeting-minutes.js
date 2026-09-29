/**
 * meeting-minutes.js — 회의록 문서(HTML) 한 벌 (v13.198)
 * 미리 보기(POST /api/meetings/:id/render)와 메일 본문(POST /api/meetings/:id/mail)이 같은 결과를 쓴다.
 * 메일 클라이언트에서도 깨지지 않도록 표(table) + 인라인 스타일만 사용. 모든 값은 이스케이프.
 */
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function multiline(s) { return esc(s).replace(/\r?\n/g, '<br>'); }

function agendaList(agenda) {
  return (Array.isArray(agenda) ? agenda : []).map(function (g) {
    return typeof g === 'string' ? { text: g, done: false } : { text: String((g && g.text) || ''), done: !!(g && g.done) };
  }).filter(function (g) { return g.text; });
}

/**
 * @param {object} m   meetings 행 (+ action_items)
 * @param {object} [opt] { projectName, orderNo, message(메일 머리말), sender }
 * @returns {{ subject: string, html: string }}
 */
function renderMinutes(m, opt) {
  opt = opt || {};
  var f = (m && m.form && typeof m.form === 'object') ? m.form : {};
  var th = 'background:#f1f5f9;color:#334155;font-weight:700;padding:8px 10px;border:1px solid #cbd5e1;width:96px;vertical-align:top;white-space:nowrap';
  var td = 'color:#0f172a;padding:8px 10px;border:1px solid #cbd5e1;vertical-align:top;line-height:1.6';
  var when = [m.meet_date || '', (f.timeStart || f.timeEnd) ? (f.timeStart || '') + (f.timeEnd ? ' ~ ' + f.timeEnd : '') : ''].filter(Boolean).join(' ');
  var att = Array.isArray(m.attendees) ? m.attendees.filter(Boolean) : [];
  var ag = agendaList(m.agenda);
  var acts = Array.isArray(m.action_items) ? m.action_items : [];
  var empty = '<span style="color:#94a3b8">—</span>';
  function row(label, value, value2Label, value2) {
    if (value2Label) {
      return '<tr><th style="' + th + '">' + label + '</th><td style="' + td + '">' + (value || empty) + '</td>' +
        '<th style="' + th + '">' + value2Label + '</th><td style="' + td + '">' + (value2 || empty) + '</td></tr>';
    }
    return '<tr><th style="' + th + '">' + label + '</th><td style="' + td + '" colspan="3">' + (value || empty) + '</td></tr>';
  }
  var agendaHtml = ag.length ? '<ol style="margin:0;padding-left:20px">' + ag.map(function (g) { return '<li>' + esc(g.text) + (g.done ? ' <span style="color:#10b981">(완료)</span>' : '') + '</li>'; }).join('') + '</ol>' : '';
  var actsHtml = acts.length
    ? '<table style="border-collapse:collapse;width:100%;font-size:13px"><tr>' +
        ['No', '내용', '담당', '기한', '상태'].map(function (h) { return '<th style="background:#f8fafc;color:#475569;padding:5px 8px;border:1px solid #e2e8f0;text-align:left">' + h + '</th>'; }).join('') + '</tr>' +
        acts.map(function (a, i) {
          var c = 'padding:5px 8px;border:1px solid #e2e8f0;color:#0f172a';
          return '<tr><td style="' + c + '">' + (i + 1) + '</td><td style="' + c + '">' + esc(a.title) + '</td><td style="' + c + '">' + esc(a.assignee_name || '') + '</td>' +
            '<td style="' + c + ';white-space:nowrap">' + esc(a.due_date || '') + '</td><td style="' + c + ';white-space:nowrap">' + (a.status === 'done' ? '완료' : '진행') + '</td></tr>';
        }).join('') + '</table>'
    : '';
  var next = [f.nextDate || '', f.nextNote || ''].filter(Boolean).map(esc).join(' · ');
  var title = m.title || '회의';
  var html =
    '<div style="font-family:\'Malgun Gothic\',\'Apple SD Gothic Neo\',sans-serif;max-width:760px;margin:0 auto;color:#0f172a;font-size:14px">' +
      (opt.message ? '<div style="padding:12px 14px;margin-bottom:16px;background:#f8fafc;border-left:3px solid #3b82f6;line-height:1.6">' + multiline(opt.message) + '</div>' : '') +
      '<h1 style="text-align:center;font-size:24px;letter-spacing:12px;margin:8px 0 18px">회의록</h1>' +
      '<table style="border-collapse:collapse;width:100%;font-size:14px">' +
        row('회의명', esc(title), '프로젝트', esc([opt.projectName || '', opt.orderNo ? '(' + opt.orderNo + ')' : ''].filter(Boolean).join(' '))) +
        row('일시', esc(when), '장소', esc(f.place || '')) +
        row('작성자', esc(f.writer || ''), '참석자', esc(att.join(', '))) +
        row('안건', agendaHtml) +
        row('논의 내용', multiline(m.minutes || '')) +
        row('결정 사항', multiline(f.decisions || '')) +
        row('액션 아이템', actsHtml) +
        row('다음 회의', next) +
      '</table>' +
      '<div style="margin-top:14px;font-size:11px;color:#94a3b8;text-align:right">업무 관리자' + (opt.sender ? ' · 보낸 사람 ' + esc(opt.sender) : '') + '</div>' +
    '</div>';
  var subject = '[회의록] ' + title + (m.meet_date ? ' (' + m.meet_date + ')' : '');
  return { subject: subject, html: html };
}

var EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
function isEmail(s) { return typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s); }

module.exports = { renderMinutes: renderMinutes, isEmail: isEmail, esc: esc };
