/**
 * meeting-minutes.js — 회의록 문서(HTML) 한 벌 (v13.198)
 * 미리 보기(POST /api/meetings/:id/render)와 메일 본문(POST /api/meetings/:id/mail)이 같은 결과를 쓴다.
 * 메일 클라이언트에서도 깨지지 않도록 표(table) + 인라인 스타일만 사용. 모든 값은 이스케이프.
 * v13.320 — 노트 출력(notebook-print.js)과 같은 모양 3가지(기본 · 공문 · 간결) · 강조색 · 결재란 칸 · 회사 머리글 · 묶음(renderBundle)
 *           모양 값은 notebook-print.js THEMES/ACCENTS 와 맞춘다 (test/print-theme-sync.test.js)
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

/* ─── 모양 ─── 기본(basic)은 예전 회의록과 똑같은 글자 그대로 (메일로 이미 보낸 모양 유지) */
var THEMES = {
  basic: { line: '#cbd5e1', head: '#f1f5f9', headInk: '#334155', ink: '#0f172a', sub: '#64748b', accent: null, tfont: '' },
  formal: { line: '#6b7280', head: '#e5e7eb', headInk: '#111827', ink: '#111827', sub: '#4b5563', accent: '#111827', tfont: "'Batang','Nanum Myeongjo','AppleMyungjo',serif" },
  clean: { line: '#e5e7eb', head: '#ffffff', headInk: '#374151', ink: '#1f2937', sub: '#6b7280', accent: null, tfont: '' }
};
var ACCENTS = { blue: '#2563eb', teal: '#0f766e', indigo: '#4f46e5', slate: '#334155', red: '#b91c1c' };
var LEGACY_ACCENT = '#3b82f6';
var SIGN_DEFAULT = ['작성', '검토', '승인'];

/** 요청 본문 → 문서 설정 (모르는 값은 버림) */
function docOptions(b) {
  b = b || {};
  var o = { theme: THEMES[b.theme] ? b.theme : 'basic', accent: ACCENTS[b.accent] ? b.accent : '', docNo: b.docNo !== false, header: !!b.header };
  var signs = Array.isArray(b.signs) ? b.signs : (b.sign ? SIGN_DEFAULT : []);
  o.signs = signs.map(function (s) { return String(s || '').trim().slice(0, 10); }).filter(Boolean).slice(0, 6);
  return o;
}

function styleOf(opt) {
  var name = THEMES[opt.theme] ? opt.theme : 'basic', T = THEMES[name], BD = T.line;
  // 기본 모양에 색을 고르지 않으면 예전 파랑 그대로, 다른 모양은 노트 출력과 같은 기본 파랑
  var ac = T.accent || ACCENTS[opt.accent] || (name === 'basic' ? LEGACY_ACCENT : ACCENTS.blue), clean = name === 'clean', formal = name === 'formal';
  var cell = clean ? 'border:0;border-bottom:1px solid ' + BD : 'border:1px solid ' + BD;
  return {
    name: name, T: T, BD: BD, ac: ac, clean: clean, formal: formal,
    th: clean ? 'color:' + T.headInk + ';font-weight:700;padding:7px 10px;border:0;border-bottom:2px solid ' + ac + ';vertical-align:top;white-space:nowrap;text-align:left'
      : 'background:' + T.head + ';color:' + T.headInk + ';font-weight:700;padding:7px 10px;border:1px solid ' + BD + ';vertical-align:top;white-space:nowrap;text-align:left',
    td: 'color:' + T.ink + ';padding:7px 10px;' + cell + ';vertical-align:top;line-height:1.6;word-break:keep-all;overflow-wrap:anywhere',
    ah: clean ? 'color:' + T.headInk + ';padding:6px 8px;border:0;border-bottom:2px solid ' + ac + ';text-align:left;white-space:nowrap;font-weight:700'
      : 'background:' + T.head + ';color:' + T.headInk + ';padding:6px 8px;border:1px solid ' + BD + ';text-align:left;white-space:nowrap;font-weight:700',
    ac2: 'padding:6px 8px;' + cell + ';color:' + T.ink + ';vertical-align:top;line-height:1.6;word-break:keep-all;overflow-wrap:anywhere',
    box: clean ? 'padding:4px 2px 6px;line-height:1.7;word-break:keep-all;overflow-wrap:anywhere;min-height:22px;page-break-inside:avoid;break-inside:avoid'
      : 'border:1px solid ' + BD + ';padding:8px 10px;line-height:1.7;word-break:keep-all;overflow-wrap:anywhere;min-height:22px;page-break-inside:avoid;break-inside:avoid',
    h2: function (n, label, extra) {
      var ex = extra ? ' <span style="font-size:12px;font-weight:400;color:' + T.sub + '">' + extra + '</span>' : '';
      var base = 'font-size:15px;font-weight:800;margin:18px 0 6px;page-break-after:avoid;break-after:avoid;', lab = (n ? n + '. ' : '') + label;
      if (formal) return '<div style="' + base + 'color:' + T.ink + '">■ ' + lab + ex + '</div>';
      if (clean) return '<div style="' + base + 'color:' + ac + '">' + lab + ex + '</div>';
      return '<div style="' + base + 'color:#0f172a;padding-left:8px;border-left:4px solid ' + ac + '">' + lab + ex + '</div>';
    }
  };
}
function companyBar(S, opt) {
  if (!opt.header || (!opt.company && !opt.logo)) return '';
  return '<table style="border-collapse:collapse;width:100%;margin:0 0 10px;border-bottom:' + (S.formal ? '3px double ' + S.T.ink : '2px solid ' + S.ac) + '"><tr>' +
    '<td style="padding:0 0 6px;vertical-align:bottom">' + (opt.logo ? '<img src="' + esc(opt.logo) + '" alt="" style="height:30px;max-width:180px;vertical-align:middle;margin-right:8px">' : '') +
    (opt.company ? '<span style="font-size:15px;font-weight:800;color:' + S.T.ink + ';vertical-align:middle">' + esc(opt.company) + '</span>' : '') + '</td></tr></table>';
}
/** 결재란 — 칸 이름들 → 오른쪽 표 칸(td). 없으면 '' */
function signCell(S, signs) {
  if (!signs.length) return '';
  var BD = S.BD;
  return '<td style="width:' + Math.max(160, signs.length * 66) + 'px;padding:0;vertical-align:top"><table style="border-collapse:collapse;width:100%;font-size:12px;table-layout:fixed"><tr>' +
    signs.map(function (l) { return '<th style="border:1px solid ' + BD + ';background:' + (S.clean ? '#fafafa' : S.T.head) + ';padding:3px;text-align:center;font-weight:700">' + esc(l) + '</th>'; }).join('') +
    '</tr><tr>' + signs.map(function () { return '<td style="border:1px solid ' + BD + ';height:48px"></td>'; }).join('') + '</tr></table></td>';
}
function docNoOf(m) { return 'MTG-' + String(m.meet_date || '').replace(/-/g, '') + (m.meet_date ? '-' : '') + String(m.id || '').replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase(); }

/**
 * @param {object} m   meetings 행 (+ action_items)
 * @param {object} [opt] { projectName, orderNo, message(메일 머리말), sender, sign(옛), signs[], theme, accent, docNo, header, company, logo, footer(false=바닥글 없음) }
 * @returns {{ subject: string, html: string, docNo: string }}
 */
function renderMinutes(m, opt) {
  opt = opt || {};
  var o = docOptions(opt);
  var S = styleOf(o), T = S.T;
  var f = (m && m.form && typeof m.form === 'object') ? m.form : {};
  // 표 고정 레이아웃 — 긴 값 때문에 칸 폭이 흔들리지 않게. 한글은 단어 중간에서 끊지 않는다(keep-all).
  var th = S.th, td = S.td;
  var tr = ' style="page-break-inside:avoid;break-inside:avoid"';
  var empty = '<span style="color:#94a3b8">—</span>';
  var nw = function (s) { return '<span style="white-space:nowrap">' + s + '</span>'; };
  var when = [m.meet_date || '', (f.timeStart || f.timeEnd) ? (f.timeStart || '') + (f.timeEnd ? ' ~ ' + f.timeEnd : '') : ''].filter(Boolean).join(' ');
  var att = Array.isArray(m.attendees) ? m.attendees.filter(Boolean) : [];
  var ag = agendaList(m.agenda);
  var acts = Array.isArray(m.action_items) ? m.action_items : [];
  var title = m.title || '회의';
  var docNo = docNoOf(m);
  var written = (m.updated_at ? new Date(m.updated_at).toISOString().slice(0, 10) : '') || m.meet_date || '';

  function tbl(cols, rows) {
    return '<table style="border-collapse:collapse;width:100%;font-size:13.5px;table-layout:fixed;margin:0 0 4px">' +
      '<colgroup>' + cols.map(function (w) { return '<col style="width:' + w + '">'; }).join('') + '</colgroup>' + rows + '</table>';
  }
  function pair(l1, v1, l2, v2) {
    return '<tr' + tr + '><th style="' + th + '">' + l1 + '</th><td style="' + td + '">' + (v1 || empty) + '</td><th style="' + th + '">' + l2 + '</th><td style="' + td + '">' + (v2 || empty) + '</td></tr>';
  }
  function full(label, value) { return '<tr' + tr + '><th style="' + th + '">' + label + '</th><td style="' + td + '" colspan="3">' + (value || empty) + '</td></tr>'; }
  function boxText(v, accentLeft) { return '<div style="' + S.box + (accentLeft && v ? ';border-left:4px solid ' + S.ac : '') + '">' + (v || empty) + '</div>'; }

  // 머리: (회사 머리글) 제목 + 문서번호·작성일 (+ 결재란)
  var sign = signCell(S, o.signs);
  var align = sign ? 'left' : 'center';
  var meta = [o.docNo ? nw('문서번호 ' + esc(docNo)) : '', nw('작성일 ' + esc(written))].filter(Boolean).join(' &nbsp;·&nbsp; ');
  var head = companyBar(S, { header: o.header, company: opt.company, logo: opt.logo }) +
    '<table style="border-collapse:collapse;width:100%;margin-bottom:14px"><tr>' +
      '<td style="vertical-align:middle;padding:0 12px 0 0">' +
        '<div style="' + (T.tfont ? 'font-family:' + T.tfont + ';' : '') + 'font-size:26px;font-weight:800;letter-spacing:' + (sign ? 8 : 14) + 'px;text-align:' + align + '">회의록</div>' +
        '<div style="font-size:12px;color:#64748b;margin-top:6px;text-align:' + align + '">' + meta + '</div>' +
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
  var ah = S.ah, ac = S.ac2;
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
      (opt.message ? '<div style="padding:12px 14px;margin-bottom:16px;background:#f8fafc;border-left:3px solid ' + S.ac + ';line-height:1.6;word-break:keep-all">' + multiline(opt.message) + '</div>' : '') +
      head +
      S.h2(1, '회의 개요') + overview +
      S.h2(2, '안건 및 논의', ag.length ? ag.length + '건' : '') + agendaHtml + etc +
      S.h2(3, '결정 사항') + boxText(multiline(f.decisions || ''), S.name !== 'basic') +
      S.h2(4, '액션 아이템', acts.length ? acts.length + '건 · 미완료 ' + openActs : '') + actsHtml +
      S.h2(5, '다음 회의') + boxText(next) +
      (opt.footer === false ? '' : '<div style="margin-top:14px;font-size:11px;color:#94a3b8;text-align:right">' + (opt.company ? esc(opt.company) + ' · ' : '') + '업무 관리자' + (opt.sender ? ' · 보낸 사람 ' + esc(opt.sender) : '') + '</div>') +
    '</div>';
  var subject = '[회의록] ' + title + (m.meet_date ? ' (' + m.meet_date + ')' : '');
  return { subject: subject, html: html, docNo: docNo };
}

/**
 * 회의록 묶음 — 표지(기간 · 건수 · 미완료 액션) · 목차 + 회의마다 새 쪽 (또는 이어 붙이기)
 * @param {Array<{m, projectName, orderNo}>} list  날짜 순
 * @param {object} opt  renderMinutes 설정 + { perPage, toc, title }
 */
function renderBundle(list, opt) {
  opt = opt || {};
  var o = docOptions(opt), S = styleOf(o), T = S.T;
  var BRK = '<div class="pg-brk" style="break-before:page;page-break-before:always;height:0"></div>';
  var perPage = opt.perPage !== false, toc = opt.toc !== false && list.length > 1;
  var dates = list.map(function (x) { return x.m.meet_date; }).filter(Boolean).sort();
  var html = '';
  if (toc) {
    var openAll = 0, actsAll = 0;
    list.forEach(function (x) { (x.m.action_items || []).forEach(function (a) { actsAll++; if (a.status !== 'done') openAll++; }); });
    var th = S.ah + ';text-align:center', td = S.ac2;
    html += '<div style="font-family:\'Malgun Gothic\',\'Apple SD Gothic Neo\',sans-serif;max-width:760px;margin:0 auto;color:#0f172a;font-size:14px">' +
      companyBar(S, { header: o.header, company: opt.company, logo: opt.logo }) +
      '<table style="border-collapse:collapse;width:100%;margin-bottom:14px"><tr><td style="vertical-align:middle;padding:0 12px 0 0;text-align:' + (o.signs.length ? 'left' : 'center') + '">' +
        '<div style="' + (T.tfont ? 'font-family:' + T.tfont + ';' : '') + 'font-size:' + (String(opt.title || '').length > 12 ? 22 : 26) + 'px;font-weight:800;letter-spacing:' + (String(opt.title || '').length > 8 ? 1 : 4) + 'px;margin:6px 0 4px;word-break:keep-all">' + esc(opt.title || '회의록 모음') + '</div>' +
        '<div style="font-size:12px;color:#64748b">' + (dates.length ? esc(dates[0]) + ' ~ ' + esc(dates[dates.length - 1]) + ' · ' : '') + list.length + '건</div>' +
      '</td>' + signCell(S, o.signs) + '</tr></table>' +
      '<table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:12px"><tr><th style="' + th + '">회의</th><th style="' + th + '">액션 아이템</th><th style="' + th + '">미완료</th></tr>' +
      '<tr><td style="' + td + ';text-align:center;font-size:18px;font-weight:800">' + list.length + '</td><td style="' + td + ';text-align:center;font-size:18px;font-weight:800">' + actsAll + '</td><td style="' + td + ';text-align:center;font-size:18px;font-weight:800;color:' + (openAll ? '#d97706' : '#059669') + '">' + openAll + '</td></tr></table>' +
      S.h2(0, '목차') +
      '<table style="border-collapse:collapse;width:100%;font-size:13px"><tr><th style="' + S.ah + ';width:1%;text-align:center">No</th><th style="' + S.ah + ';width:1%">날짜</th><th style="' + S.ah + '">회의</th><th style="' + S.ah + '">프로젝트</th><th style="' + S.ah + ';width:1%">액션</th></tr>' +
      list.map(function (x, i) {
        var a = x.m.action_items || [], op = a.filter(function (q) { return q.status !== 'done'; }).length;
        return '<tr style="page-break-inside:avoid"><td style="' + td + ';text-align:center">' + (i + 1) + '</td><td style="' + td + ';white-space:nowrap">' + esc(x.m.meet_date || '—') + '</td><td style="' + td + '">' + esc(x.m.title || '회의') + '</td>' +
          '<td style="' + td + '">' + esc(x.projectName || '') + '</td><td style="' + td + ';white-space:nowrap">' + (a.length ? (a.length - op) + ' / ' + a.length : '—') + '</td></tr>';
      }).join('') + '</table></div>';
  }
  list.forEach(function (x, i) {
    if (i || toc) html += perPage ? BRK : '<div style="border-top:2px dashed ' + S.BD + ';margin:26px auto 20px;max-width:760px"></div>';
    var oo = Object.assign({}, opt, { projectName: x.projectName, orderNo: x.orderNo, footer: false, message: '' });
    if (toc || (!perPage && i)) { oo.signs = []; oo.sign = false; oo.header = false; }   // 표지가 있으면 결재란 · 머리글은 표지에만
    html += renderMinutes(x.m, oo).html;
  });
  html += '<div style="margin:14px auto 0;max-width:760px;font-size:11px;color:#94a3b8;text-align:right">' + (opt.company ? esc(opt.company) + ' · ' : '') + '업무 관리자</div>';
  return { subject: opt.title || '회의록 모음', html: html };
}

var EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
function isEmail(s) { return typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s); }

module.exports = { renderMinutes: renderMinutes, renderBundle: renderBundle, docOptions: docOptions, isEmail: isEmail, esc: esc, THEMES: THEMES, ACCENTS: ACCENTS };
