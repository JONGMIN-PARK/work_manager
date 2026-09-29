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
    if (typeof g === 'string') return { text: g, done: false, note: '', result: '' };
    return { text: String((g && g.text) || ''), done: !!(g && g.done), note: String((g && g.note) || ''), result: String((g && g.result) || '') };
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
  var BD = '#cbd5e1';
  // 표 고정 레이아웃 — 긴 값 때문에 칸 폭이 흔들리지 않게. 한글은 단어 중간에서 끊지 않는다(keep-all).
  var th = 'background:#f1f5f9;color:#334155;font-weight:700;padding:7px 10px;border:1px solid ' + BD + ';vertical-align:top;white-space:nowrap;text-align:left';
  var td = 'color:#0f172a;padding:7px 10px;border:1px solid ' + BD + ';vertical-align:top;line-height:1.6;word-break:keep-all;overflow-wrap:anywhere';
  var tr = ' style="page-break-inside:avoid;break-inside:avoid"';
  var empty = '<span style="color:#94a3b8">—</span>';
  var nw = function (s) { return '<span style="white-space:nowrap">' + s + '</span>'; };
  var when = [m.meet_date || '', (f.timeStart || f.timeEnd) ? (f.timeStart || '') + (f.timeEnd ? ' ~ ' + f.timeEnd : '') : ''].filter(Boolean).join(' ');
  var att = Array.isArray(m.attendees) ? m.attendees.filter(Boolean) : [];
  var ag = agendaList(m.agenda);
  var acts = Array.isArray(m.action_items) ? m.action_items : [];
  var title = m.title || '회의';
  var docNo = 'MTG-' + String(m.meet_date || '').replace(/-/g, '') + (m.meet_date ? '-' : '') + String(m.id || '').replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase();
  var written = (m.updated_at ? new Date(m.updated_at).toISOString().slice(0, 10) : '') || m.meet_date || '';

  function tbl(cols, rows) {
    return '<table style="border-collapse:collapse;width:100%;font-size:13.5px;table-layout:fixed;margin:0 0 4px">' +
      '<colgroup>' + cols.map(function (w) { return '<col style="width:' + w + '">'; }).join('') + '</colgroup>' + rows + '</table>';
  }
  function pair(l1, v1, l2, v2) {
    return '<tr' + tr + '><th style="' + th + '">' + l1 + '</th><td style="' + td + '">' + (v1 || empty) + '</td><th style="' + th + '">' + l2 + '</th><td style="' + td + '">' + (v2 || empty) + '</td></tr>';
  }
  function full(label, value) { return '<tr' + tr + '><th style="' + th + '">' + label + '</th><td style="' + td + '" colspan="3">' + (value || empty) + '</td></tr>'; }
  function h2(n, label, extra) {
    return '<div style="font-size:15px;font-weight:800;color:#0f172a;margin:18px 0 6px;padding-left:8px;border-left:4px solid #3b82f6;page-break-after:avoid;break-after:avoid">' + n + '. ' + label +
      (extra ? ' <span style="font-size:12px;font-weight:400;color:#64748b">' + extra + '</span>' : '') + '</div>';
  }
  function boxText(v) { return '<div style="border:1px solid ' + BD + ';padding:8px 10px;line-height:1.7;word-break:keep-all;overflow-wrap:anywhere;min-height:22px;page-break-inside:avoid;break-inside:avoid">' + (v || empty) + '</div>'; }

  // 머리: 제목 + 문서번호·작성일 (+ 결재란)
  var sign = opt.sign
    ? '<td style="width:210px;padding:0;vertical-align:top"><table style="border-collapse:collapse;width:100%;font-size:12px;table-layout:fixed"><tr>' +
        ['작성', '검토', '승인'].map(function (l) { return '<th style="border:1px solid ' + BD + ';background:#f1f5f9;padding:3px;text-align:center;font-weight:700">' + l + '</th>'; }).join('') +
      '</tr><tr>' + ['', '', ''].map(function () { return '<td style="border:1px solid ' + BD + ';height:48px"></td>'; }).join('') + '</tr></table></td>'
    : '';
  var align = opt.sign ? 'left' : 'center';
  var head = '<table style="border-collapse:collapse;width:100%;margin-bottom:14px"><tr>' +
      '<td style="vertical-align:middle;padding:0 12px 0 0">' +
        '<div style="font-size:26px;font-weight:800;letter-spacing:14px;text-align:' + align + '">회의록</div>' +
        '<div style="font-size:12px;color:#64748b;margin-top:6px;text-align:' + align + '">' + nw('문서번호 ' + esc(docNo)) + ' &nbsp;·&nbsp; ' + nw('작성일 ' + esc(written)) + '</div>' +
      '</td>' + sign + '</tr></table>';

  // 1. 회의 개요
  var proj = [opt.projectName ? esc(opt.projectName) : '', opt.orderNo ? '<span style="color:#64748b;white-space:nowrap">(' + esc(opt.orderNo) + ')</span>' : ''].filter(Boolean).join(' ');
  // 참석자: 이름 하나는 끊지 않고 이름과 이름 사이에서만 줄바꿈 — 인원이 많아도 정돈되게
  var attHtml = att.map(function (n) { return '<span style="display:inline-block;white-space:nowrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:0 8px;margin:1px 4px 1px 0">' + esc(n) + '</span>'; }).join('');
  var overview = tbl(['14%', '36%', '14%', '36%'],
    full('회의명', '<b>' + esc(title) + '</b>') +
    full('프로젝트', proj) +
    pair('일시', when ? nw(esc(when)) : '', '장소', esc(f.place || '')) +
    pair('작성자', esc(f.writer || ''), '참석 인원', att.length ? att.length + '명' : '') +
    full('참석자', attHtml) +
    full('회의 목적', multiline(f.purpose || '')));

  // 2. 안건 및 논의 — 안건별 논의·결과가 하나라도 있으면 표, 없으면 번호 목록
  var anyNote = ag.some(function (g) { return g.note || g.result; });
  var ah = 'background:#f1f5f9;color:#334155;padding:6px 8px;border:1px solid ' + BD + ';text-align:left;white-space:nowrap;font-weight:700';
  var ac = 'padding:6px 8px;border:1px solid ' + BD + ';color:#0f172a;vertical-align:top;line-height:1.6;word-break:keep-all;overflow-wrap:anywhere';
  var doneTag = ' <span style="color:#10b981;white-space:nowrap;font-weight:400">(완료)</span>';
  var agendaHtml = !ag.length ? boxText('') : anyNote
    ? tbl(['7%', '25%', '42%', '26%'],
        '<tr><th style="' + ah + ';text-align:center">No</th><th style="' + ah + '">안건</th><th style="' + ah + '">논의 내용</th><th style="' + ah + '">결과</th></tr>' +
        ag.map(function (g, i) {
          return '<tr' + tr + '><td style="' + ac + ';text-align:center;white-space:nowrap">' + (i + 1) + '</td><td style="' + ac + ';font-weight:600">' + esc(g.text) + (g.done ? doneTag : '') + '</td>' +
            '<td style="' + ac + '">' + (g.note ? multiline(g.note) : empty) + '</td><td style="' + ac + '">' + (g.result ? multiline(g.result) : empty) + '</td></tr>';
        }).join(''))
    : boxText('<ol style="margin:0;padding-left:20px">' + ag.map(function (g) { return '<li style="word-break:keep-all">' + esc(g.text) + (g.done ? doneTag : '') + '</li>'; }).join('') + '</ol>');
  var etc = m.minutes ? '<div style="font-size:12.5px;font-weight:700;color:#334155;margin:8px 0 4px">기타 논의</div>' + boxText(multiline(m.minutes)) : '';

  // 4. 액션 아이템 — 번호·담당·기한·상태는 줄바꿈 없이 필요한 폭만(width:1% + nowrap), 나머지 폭은 내용
  var actsHtml = acts.length
    ? '<table style="border-collapse:collapse;width:100%;font-size:13px">' +
        '<tr><th style="' + ah + ';width:1%;text-align:center">No</th><th style="' + ah + '">내용</th><th style="' + ah + ';width:1%">담당</th><th style="' + ah + ';width:1%">기한</th><th style="' + ah + ';width:1%">상태</th></tr>' +
        acts.map(function (a, i) {
          var done = a.status === 'done';
          return '<tr' + tr + '><td style="' + ac + ';white-space:nowrap;text-align:center">' + (i + 1) + '</td>' +
            '<td style="' + ac + '">' + esc(a.title) + '</td>' +
            '<td style="' + ac + ';white-space:nowrap">' + esc(a.assignee_name || '') + '</td>' +
            '<td style="' + ac + ';white-space:nowrap">' + esc(a.due_date || '') + '</td>' +
            '<td style="' + ac + ';white-space:nowrap;color:' + (done ? '#10b981' : '#f59e0b') + ';font-weight:700">' + (done ? '완료' : '진행') + '</td></tr>';
        }).join('') + '</table>'
    : boxText('');

  var next = [f.nextDate ? nw(esc(f.nextDate)) : '', f.nextNote ? esc(f.nextNote) : ''].filter(Boolean).join(' · ');
  var openActs = acts.filter(function (a) { return a.status !== 'done'; }).length;
  var html =
    '<div style="font-family:\'Malgun Gothic\',\'Apple SD Gothic Neo\',sans-serif;max-width:760px;margin:0 auto;color:#0f172a;font-size:14px">' +
      (opt.message ? '<div style="padding:12px 14px;margin-bottom:16px;background:#f8fafc;border-left:3px solid #3b82f6;line-height:1.6;word-break:keep-all">' + multiline(opt.message) + '</div>' : '') +
      head +
      h2(1, '회의 개요') + overview +
      h2(2, '안건 및 논의', ag.length ? ag.length + '건' : '') + agendaHtml + etc +
      h2(3, '결정 사항') + boxText(multiline(f.decisions || '')) +
      h2(4, '액션 아이템', acts.length ? acts.length + '건 · 미완료 ' + openActs : '') + actsHtml +
      h2(5, '다음 회의') + boxText(next) +
      '<div style="margin-top:14px;font-size:11px;color:#94a3b8;text-align:right">업무 관리자' + (opt.sender ? ' · 보낸 사람 ' + esc(opt.sender) : '') + '</div>' +
    '</div>';
  var subject = '[회의록] ' + title + (m.meet_date ? ' (' + m.meet_date + ')' : '');
  return { subject: subject, html: html, docNo: docNo };
}

var EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
function isEmail(s) { return typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s); }

module.exports = { renderMinutes: renderMinutes, isEmail: isEmail, esc: esc };
