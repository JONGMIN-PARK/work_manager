/* notebook-print.js — 🖨 출력 미리 보기 · 양식 (v13.319)
   ─ 순수 부분 NbPrint (node 시험 가능) ─
     NbPrint.build(items, opts) → { inner, title, docNo, forms, pages? }   items: [{ kind:'note'|'daily', title, body, date, id, ref, ink, tags }]
     NbPrint.page(inner, opts, title, docNo) → 인쇄용 HTML 한 장(@page 머리글 · 쪽 번호)
     NbPrint.word(inner, opts, title) → Word(.doc) HTML
     NbPrint.parseMeeting(md, title, date) · NbPrint.parseDaily(md, date) · NbPrint.detectForm(item)
   양식: doc(문서) · meeting(회의록) · daily(일일 업무 보고) · memo(간단 메모)
   모양: basic(기본) · formal(공문) · clean(간결)
   모든 글은 이스케이프(NbMd) — 메일 · Word 에 붙여도 깨지지 않게 스타일은 요소마다 인라인 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NbPrint = api;
})(typeof window !== 'undefined' ? window : this, function (root) {
  var Md = (root && root.NbMd) || (typeof require === 'function' ? require('./notebook-md.js') : null);
  function esc(s) { return Md.esc(String(s == null ? '' : s)); }

  var THEMES = {
    basic: { name: '기본', font: "'Malgun Gothic','Apple SD Gothic Neo','Pretendard',sans-serif", tfont: '', ink: '#0f172a', sub: '#64748b', line: '#cbd5e1', head: '#f1f5f9', headInk: '#334155' },
    formal: { name: '공문', font: "'Malgun Gothic','Apple SD Gothic Neo',sans-serif", tfont: "'Batang','Nanum Myeongjo','AppleMyungjo',serif", ink: '#111827', sub: '#4b5563', line: '#6b7280', head: '#e5e7eb', headInk: '#111827', accent: '#111827' },
    clean: { name: '간결', font: "'Pretendard','Malgun Gothic','Apple SD Gothic Neo',sans-serif", tfont: '', ink: '#1f2937', sub: '#6b7280', line: '#e5e7eb', head: '#ffffff', headInk: '#374151' }
  };
  var ACCENTS = { blue: '#2563eb', teal: '#0f766e', indigo: '#4f46e5', slate: '#334155', red: '#b91c1c' };
  var FORMS = { auto: '자동', doc: '문서', meeting: '회의록', daily: '일일 업무', memo: '간단 메모' };
  var SIGNS = { '': '없음', '작성,승인': '작성 · 승인', '작성,검토,승인': '작성 · 검토 · 승인', '담당,팀장,부서장': '담당 · 팀장 · 부서장', '담당,팀장,부서장,대표': '담당 · 팀장 · 부서장 · 대표' };
  var DEF = { form: 'auto', theme: 'basic', accent: 'blue', size: 'm', landscape: false, margin: 'normal', header: true, docNo: true, pageNo: true, sign: '', ink: true,
    writer: '', dept: '', company: '', logo: '', perPage: true, toc: true, now: '' };

  function norm(o) {
    var x = {}; o = o || {};
    Object.keys(DEF).forEach(function (k) { x[k] = o[k] != null ? o[k] : DEF[k]; });
    if (!THEMES[x.theme]) x.theme = 'basic';
    if (!FORMS[x.form]) x.form = 'auto';
    x.signs = String(x.sign || '').split(/[,·]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 6);
    return x;
  }

  /* ─── 모양(인라인 스타일 묶음) ─── */
  function sty(o) {
    var T = THEMES[o.theme], ac = T.accent || ACCENTS[o.accent] || ACCENTS.blue;
    var fs = { s: 12.5, m: 13.5, l: 15 }[o.size] || 13.5, L = T.line, clean = o.theme === 'clean', formal = o.theme === 'formal';
    var S = { T: T, ac: ac, fs: fs, font: T.font, ink: T.ink, sub: T.sub, line: L, theme: o.theme };
    S.th = clean
      ? 'color:' + T.headInk + ';font-weight:700;padding:6px 8px;border:0;border-bottom:2px solid ' + ac + ';vertical-align:top;text-align:left;white-space:nowrap'
      : 'background:' + T.head + ';color:' + T.headInk + ';font-weight:700;padding:6px 9px;border:1px solid ' + L + ';vertical-align:top;text-align:left;white-space:nowrap';
    S.td = (clean ? 'padding:6px 8px;border:0;border-bottom:1px solid ' + L + ';' : 'padding:6px 9px;border:1px solid ' + L + ';') +
      'vertical-align:top;line-height:1.6;word-break:keep-all;overflow-wrap:anywhere;color:' + T.ink;
    S.tbl = 'border-collapse:collapse;width:100%;font-size:' + (fs - .5) + 'px;margin:0 0 4px';
    S.box = clean ? 'padding:2px 2px 4px;line-height:1.7;word-break:keep-all;overflow-wrap:anywhere'
      : 'border:1px solid ' + L + ';padding:8px 11px;line-height:1.7;word-break:keep-all;overflow-wrap:anywhere;min-height:20px';
    S.h2 = function (n, label, extra) {
      var lab = (n ? n + '. ' : '') + esc(label), ex = extra ? ' <span style="font-size:' + (fs - 1.5) + 'px;font-weight:400;color:' + T.sub + '">' + esc(extra) + '</span>' : '';
      var base = 'font-size:' + (fs + 2) + 'px;font-weight:800;margin:18px 0 6px;page-break-after:avoid;break-after:avoid;color:';
      if (formal) return '<div style="' + base + T.ink + '">■ ' + lab + ex + '</div>';
      if (clean) return '<div style="' + base + ac + ';letter-spacing:.2px">' + lab + ex + '</div>';
      return '<div style="' + base + T.ink + ';padding-left:8px;border-left:4px solid ' + ac + '">' + lab + ex + '</div>';
    };
    S.empty = '<span style="color:#94a3b8">—</span>';
    return S;
  }
  function tbl(S, cols, rows) {
    return '<table style="' + S.tbl + ';table-layout:fixed"><colgroup>' + cols.map(function (w) { return '<col style="width:' + w + '">'; }).join('') + '</colgroup>' + rows + '</table>';
  }
  function tr(cells) { return '<tr style="page-break-inside:avoid;break-inside:avoid">' + cells + '</tr>'; }

  /* ─── 마크다운 → 인라인 스타일 HTML ─── */
  function mdHtml(md, S, o, inkBlocks) {
    if (!String(md || '').trim()) return '';
    var h = Md.render(md).html;
    h = h.replace(/<div class="nb-ink" data-ink="([^"]+)"[^>]*><\/div>/g, function (_, id) {
      if (!o.ink) return '';
      var b = inkBlocks && inkBlocks[id], Ink = root && root.NbInk;
      if (!b || !Ink) return '<div style="color:#94a3b8;font-size:11px;margin:4px 0">[손글씨]</div>';
      return '<div style="border:1px solid ' + S.line + ';border-radius:6px;margin:8px 0;break-inside:avoid;page-break-inside:avoid">' + Ink.svg(b, {}).replace('<svg ', '<svg style="width:100%;height:auto;display:block" ') + '</div>';
    });
    if (!o.ink) h = h.replace(/<img class="nb-img"[^>]*>/g, '');
    return styleMd(h, S);
  }
  var REF_ICON = { project: '📁', issue: '🐞', milestone: '🏁', meeting: '🤝', todo: '✏️', note: '📓' };
  function styleMd(h, S) {
    var L = S.line, fs = S.fs;
    var CO = { note: ['#3b82f6', '#f8fafc'], tip: ['#10b981', '#ecfdf5'], done: ['#10b981', '#ecfdf5'], important: ['#8b5cf6', '#f5f3ff'], warning: ['#f59e0b', '#fffbeb'], caution: ['#ef4444', '#fef2f2'] };
    return h.replace(/ data-line="\d+"/g, '')
      .replace(/<button[^>]*>[\s\S]*?<\/button>/g, '')
      .replace(/<span class="nb-code-lang">[^<]*<\/span>/g, '')
      .replace(/<label class="nb-chk"><input type="checkbox" checked[^>]*><span><\/span><\/label>/g, '<span style="color:' + S.ac + ';font-weight:700">☑</span> ')
      .replace(/<label class="nb-chk"><input type="checkbox"[^>]*><span><\/span><\/label>/g, '<span style="color:#64748b">☐</span> ')
      .replace(/(☑|☐)(<\/span> )<div>/g, '$1$2<div style="display:inline">')
      .replace(/<li class="nb-task done">/g, '<li style="list-style:none;color:#94a3b8">')
      .replace(/<li class="nb-task">/g, '<li style="list-style:none">')
      .replace(/ ?<a class="nb-todo-ref"[^>]*>[^<]*<\/a>/g, '')
      .replace(/<a class="nb-wl"[^>]*>([\s\S]*?)<\/a>/g, '<span style="border-bottom:1px dotted ' + S.sub + '">$1</span>')
      .replace(/<a class="nb-ref" data-ref="([a-z]+):[^"]*"[^>]*>([\s\S]*?)<\/a>/g, function (_, k, t) {
        return '<span style="display:inline-block;border:1px solid ' + L + ';border-radius:10px;padding:0 7px;font-size:.92em;white-space:nowrap">' + (/^\s*[☀-⟿\ud83c-\udbff]/.test(t) ? '' : (REF_ICON[k] || '🔗') + ' ') + t + '</span>';
      })
      .replace(/<a class="nb-file"[^>]*>([\s\S]*?)<\/a>/g, '📎 $1')
      .replace(/<a data-anchor="1" href="[^"]*">([\s\S]*?)<\/a>/g, '$1').replace(/<a href="#[^"]*" data-anchor="1">([\s\S]*?)<\/a>/g, '$1')
      .replace(/<a href=/g, '<a style="color:' + S.ac + '" href=')
      .replace(/<h([1-6])( id="[^"]*")?>/g, function (_, n) {
        var sz = { 1: fs + 7, 2: fs + 4, 3: fs + 2 }[n] || fs + 1;
        return '<h' + n + ' style="font-size:' + sz + 'px;margin:' + (n < 3 ? 16 : 12) + 'px 0 6px;color:' + S.ink + (n === '1' ? ';border-bottom:1px solid ' + L + ';padding-bottom:4px' : '') + ';page-break-after:avoid;break-after:avoid">';
      })
      .replace(/<p>/g, '<p style="margin:0 0 6px">')
      .replace(/<ul class="nb-tasks">/g, '<ul style="margin:2px 0 6px;padding-left:4px">')
      .replace(/<(ul|ol)( start="\d+")?>/g, '<$1$2 style="margin:2px 0 6px;padding-left:22px">')
      .replace(/<li>/g, '<li style="margin:1px 0">')
      .replace(/<div class="nb-tbl">/g, '<div>')
      .replace(/<table>/g, '<table style="border-collapse:collapse;width:100%;margin:6px 0;font-size:' + (fs - .5) + 'px">')
      .replace(/<(th|td)( style="text-align:(\w+)")?>/g, function (_, t, x, al) { return '<' + t + ' style="' + (t === 'th' ? S.th : S.td) + (al ? ';text-align:' + al : '') + '">'; })
      .replace(/<thead>|<\/thead>|<tbody>|<\/tbody>/g, '')
      .replace(/<div class="nb-callout nb-co-(\w+)">/g, function (_, k) { var c = CO[k] || CO.note; return '<div style="border:1px solid ' + L + ';border-left:4px solid ' + c[0] + ';background:' + c[1] + ';border-radius:6px;padding:6px 12px;margin:8px 0;page-break-inside:avoid;break-inside:avoid">'; })
      .replace(/<div class="nb-co-t">/g, '<div style="font-weight:700;margin-bottom:2px">')
      .replace(/<blockquote>/g, '<blockquote style="border-left:3px solid ' + L + ';margin:6px 0;padding:2px 12px;color:' + S.sub + '">')
      .replace(/<div class="nb-code">/g, '<div>')
      .replace(/<pre>/g, '<pre style="background:#f8fafc;border:1px solid ' + L + ';border-radius:6px;padding:8px 10px;white-space:pre-wrap;word-break:break-all;font-size:' + (fs - 1.5) + 'px;page-break-inside:avoid">')
      .replace(/<code>/g, '<code style="font-family:Consolas,monospace;background:#f1f5f9;padding:0 4px;border-radius:3px;font-size:.92em">')
      .replace(/<mark>/g, '<mark style="background:#fef08a;color:inherit">')
      .replace(/<hr>/g, '<hr style="border:0;border-top:1px solid ' + L + ';margin:12px 0">')
      .replace(/<img class="nb-img"/g, '<img class="nb-img" style="max-width:100%;border-radius:4px;margin:4px 0"');
  }
  function inl(s, S) { return styleMd(Md.render(String(s || '').replace(/\s*⟦[^⟧]*⟧/g, '')).html, S).replace(/^<p style="margin:0 0 6px">|<\/p>$/g, ''); }

  /* ─── 나누기 — 맨 위 # 제목 · 가장 높은 단계 제목으로 칸 ─── */
  var HEAD_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  function sections(md) {
    var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n'), fence = false, hs = [];
    lines.forEach(function (l, i) {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      var m = !fence && HEAD_RE.exec(l); if (m) hs.push({ i: i, lv: m[1].length, text: m[2] });
    });
    var out = { title: '', pre: [], list: [] }, skip = -1;
    var firstText = lines.findIndex(function (l) { return l.trim(); });
    if (hs.length && hs[0].lv === 1 && hs[0].i === firstText) { out.title = hs[0].text; skip = hs[0].i; hs.shift(); }
    var top = hs.reduce(function (m, h) { return Math.min(m, h.lv); }, 9);
    var cuts = hs.filter(function (h) { return h.lv === top; });
    var start = cuts.length ? cuts[0].i : lines.length;
    out.pre = lines.slice(0, start).filter(function (_, i) { return i !== skip; });
    cuts.forEach(function (c, k) { out.list.push({ head: c.text, key: '', lines: lines.slice(c.i + 1, k + 1 < cuts.length ? cuts[k + 1].i : lines.length) }); });
    return out;
  }
  function plainHead(h) { return String(h || '').replace(/[*_`~=]/g, '').replace(/[^0-9A-Za-z가-힣\s-]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function keyOf(head, map) { var t = plainHead(head); for (var i = 0; i < map.length; i++) if (map[i][1].test(t)) return map[i][0]; return ''; }
  function nonEmpty(lines) { return lines.some(function (l) { return l.trim() && !/^\s*[-*+]\s*(\[[ xX]\])?\s*$/.test(l) && !/^\s*\d+[.)]\s*$/.test(l) && !/^\s*>\s*(\[!\w+\].*)?$/.test(l) && !/^\|[\s|]*\|$/.test(l.trim()) && !/^\s*\|?\s*:?-{2,}/.test(l); }); }
  function trimLines(lines) { var a = lines.slice(); while (a.length && !a[0].trim()) a.shift(); while (a.length && !a[a.length - 1].trim()) a.pop(); return a; }

  var LI = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  function listItems(lines) {
    var out = [];
    lines.forEach(function (l) {
      var m = LI.exec(l);
      if (m) {
        var t = m[3], done = null, tm = /^\[([ xX])\]\s*(.*)$/.exec(t);
        if (tm) { done = tm[1] !== ' '; t = tm[2]; }
        out.push({ text: t.trim(), done: done, indent: m[1].replace(/\t/g, '    ').length });
      } else if (out.length && /^\s{2,}\S/.test(l)) out[out.length - 1].text += ' ' + l.trim();
    });
    return out.filter(function (x) { return x.text; });
  }
  function splitRow(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }
  function tableOf(lines) {
    for (var i = 0; i + 1 < lines.length; i++) {
      if (lines[i].indexOf('|') >= 0 && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        var head = splitRow(lines[i]), rows = [];
        for (var j = i + 2; j < lines.length && lines[j].indexOf('|') >= 0 && lines[j].trim(); j++) rows.push(splitRow(lines[j]));
        return { head: head, rows: rows.filter(function (r) { return r.some(function (c) { return c; }); }), from: i, to: j };
      }
    }
    return null;
  }

  /* ─── 회의록 ─── */
  var MEET_KEYS = [['overview', /개요|기본 ?정보|회의 ?정보|overview/i], ['agenda', /안건|의제|agenda/i], ['decide', /결정|합의|결론|decision/i],
    ['todo', /할 ?일|액션|action|후속|조치|todo|to-do|과제/i], ['next', /다음 ?회의|차기|next/i], ['discuss', /논의|토의|회의 ?내용|discussion|내용/i]];
  var FIELD_KEYS = [['when', /^(일시|날짜|일자|시간|date|when)$/i], ['place', /^(장소|위치|회의실|place|where|room)$/i], ['att', /^(참석|참석자|참석 ?인원|attendees?|participants?)$/i],
    ['writer', /^(작성|작성자|기록|서기|writer)$/i], ['purpose', /^(목적|회의 ?목적|purpose|목표)$/i], ['host', /^(주관|주최|진행|사회|host)$/i], ['project', /^(프로젝트|project|과제명)$/i]];
  var FIELD_RE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?([^:：*_|\/]{1,14}?)(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*(.*)$/;
  function fieldsOf(lines, loose) {
    var f = {}, extra = [], rest = [];
    lines.forEach(function (l) {
      var m = FIELD_RE.exec(l), k = '';
      if (m && !/^\/\//.test(m[2])) {
        var lab = m[1].trim();
        for (var i = 0; i < FIELD_KEYS.length; i++) if (FIELD_KEYS[i][1].test(lab)) { k = FIELD_KEYS[i][0]; break; }
        if (k) { f[k] = m[2].trim(); return; }
        if (loose && LI.test(l)) { extra.push([lab, m[2].trim()]); return; }
      }
      rest.push(l);
    });
    return { f: f, extra: extra, rest: rest };
  }
  function splitPeople(s) { return String(s || '').split(/\s*[,、，\/·]\s*|\s{2,}/).map(function (x) { return x.replace(/[*_]/g, '').trim(); }).filter(Boolean).slice(0, 60); }
  /** '2026-11-03 14:00~15:30' · '11/3(월) 14:00' · '2026.11.3' → { date, start, end } */
  function parseWhen(s, base) {
    s = String(s || ''); var y = String(base || '').slice(0, 4) || String(new Date().getFullYear()), d = null, m;
    if ((m = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(s))) d = m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    else if ((m = /(?:^|[^\d])(\d{1,2})\s*[/.월]\s*(\d{1,2})(?!\d)/.exec(s)) && +m[1] >= 1 && +m[1] <= 12) d = y + '-' + pad(m[1]) + '-' + pad(m[2]);
    var t = s.match(/(\d{1,2}):(\d{2})/g) || [];
    return { date: d, start: t[0] ? pad(t[0].split(':')[0]) + ':' + t[0].split(':')[1] : null, end: t[1] ? pad(t[1].split(':')[0]) + ':' + t[1].split(':')[1] : null };
  }
  function pad(n) { return ('0' + String(n).trim()).slice(-2); }
  /** 할 일 한 줄 — '@김 ~11/15' · '(담당: 김, 기한 11/15)' · '11/15까지' */
  function todoOf(text, done) {
    var who = '', due = '', t = String(text || '').replace(/\s*⟦[^⟧]*⟧/g, '');
    t = t.replace(/(?:^|\s)@([^\s,()@]+)/, function (_, w) { who = w; return ' '; });
    t = t.replace(/(?:담당자?|책임)\s*[:：]?\s*([^,)·\]]+?)\s*(?=[,)·\]]|$)/, function (_, w) { if (!who) who = w.trim(); return ''; });
    t = t.replace(/(?:~\s*|(?:기한|마감|납기|due)\s*[:：]?\s*)(\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[/.]\d{1,2})(\s*까지)?/i, function (_, d) { due = d; return ''; });
    if (!due) t = t.replace(/(\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[/.]\d{1,2})\s*까지/, function (_, d) { due = d; return ''; });
    t = t.replace(/\(\s*[,·]?\s*\)|\[\s*\]/g, '').replace(/\s*[,·—-]\s*$/, '').replace(/\s{2,}/g, ' ').trim();
    return { title: t, who: who, due: due, done: !!done };
  }
  function parseMeeting(md, title, date) {
    var sc = sections(md), r = { title: String(title || sc.title || '').replace(/^\s*회의록\s*[—–:-]?\s*/, '').trim() || '회의', fields: {}, extra: [], agenda: [], discuss: '', decide: '', todos: [], next: '', others: [], intro: '' };
    var pre = fieldsOf(sc.pre, false); Object.assign(r.fields, pre.f); r.intro = trimLines(pre.rest).join('\n');
    sc.list.forEach(function (s) {
      var k = keyOf(s.head, MEET_KEYS);
      if (k === 'overview') { var x = fieldsOf(s.lines, true); Object.keys(x.f).forEach(function (q) { if (!r.fields[q]) r.fields[q] = x.f[q]; }); r.extra = r.extra.concat(x.extra); if (nonEmpty(x.rest)) r.others.push({ head: '개요 메모', md: trimLines(x.rest).join('\n') }); }
      else if (k === 'agenda') { var it = listItems(s.lines).filter(function (a) { return a.indent === 0 || true; }); if (it.length) r.agenda = r.agenda.concat(it.filter(function (a) { return a.indent === 0; }).map(function (a) { return { text: a.text, done: !!a.done }; })); else if (nonEmpty(s.lines)) r.agenda.push({ text: trimLines(s.lines).join(' '), done: false }); }
      else if (k === 'todo') {
        var tb = tableOf(s.lines);
        if (tb) {
          var ci = function (re) { for (var i = 0; i < tb.head.length; i++) if (re.test(plainHead(tb.head[i]))) return i; return -1; };
          var cT = ci(/할 ?일|내용|항목|액션|업무|task|item|action/i), cW = ci(/담당|책임|owner|who/i), cD = ci(/기한|마감|일정|납기|due|date/i), cS = ci(/상태|status|완료/i);
          if (cT < 0) cT = 0;
          tb.rows.forEach(function (row) {
            var t = (row[cT] || '').trim(); if (!t) return;
            var x = todoOf(t, cS >= 0 && /완료|done|✅|☑|x/i.test(row[cS] || ''));
            r.todos.push({ title: x.title, who: (cW >= 0 ? row[cW] : '') || x.who, due: (cD >= 0 ? row[cD] : '') || x.due, done: x.done });
          });
        }
        listItems(tb ? s.lines.slice(0, tb.from).concat(s.lines.slice(tb.to)) : s.lines).forEach(function (a) { var x = todoOf(a.text, a.done); if (x.title) r.todos.push(x); });
      }
      else if (k && nonEmpty(s.lines)) r[k] = (r[k] ? r[k] + '\n\n' : '') + trimLines(s.lines).join('\n');
      else if (!k && nonEmpty(s.lines)) r.others.push({ head: s.head, md: trimLines(s.lines).join('\n') });
    });
    // 결정 사항이 강조 상자 하나뿐이면 상자를 풀어 본문만 (양식 쪽 상자와 겹치지 않게)
    if (/^>\s*\[!\w+\]/.test(r.decide) && r.decide.split('\n').every(function (l) { return /^>/.test(l) || !l.trim(); })) {
      r.decide = r.decide.split('\n').slice(1).map(function (l) { return l.replace(/^>\s?/, ''); }).join('\n').trim();
    }
    r.att = splitPeople(r.fields.att);
    r.when = parseWhen(r.fields.when, date);
    if (!r.when.date && date) r.when.date = date;
    return r;
  }

  /* ─── 일일 업무 ─── */
  var DAY_KEYS = [['late', /밀린|지연|overdue|늦은/i], ['tomorrow', /내일|이어서|다음 ?날|tomorrow|익일/i], ['done', /끝낸|완료|한 ?일|실적|done|처리/i],
    ['schedule', /일정|schedule|미팅/i], ['plan', /할 ?일|계획|plan|목표|focus|집중|업무/i], ['memo', /메모|특이|비고|이슈|note|기타/i]];
  function parseDaily(md, date) {
    var sc = sections(md), r = { title: sc.title, date: date || '', schedule: [], plan: [], done: [], late: [], tomorrow: [], memo: '', others: [], free: '' };
    if (!r.date) { var dm = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(sc.title || ''); if (dm) r.date = dm[1] + '-' + pad(dm[2]) + '-' + pad(dm[3]); }
    if (nonEmpty(sc.pre)) r.free = trimLines(sc.pre).join('\n');
    sc.list.forEach(function (s) {
      var k = keyOf(s.head, DAY_KEYS);
      if (!k) { if (nonEmpty(s.lines)) r.others.push({ head: s.head, md: trimLines(s.lines).join('\n') }); return; }
      if (k === 'memo') { if (nonEmpty(s.lines)) r.memo = (r.memo ? r.memo + '\n' : '') + trimLines(s.lines).join('\n'); return; }
      var items = listItems(s.lines).filter(function (a) { return !/^(없음|-|—)$/.test(a.text); });
      if (k === 'schedule') {
        items.forEach(function (a) { var m = /^(?:\*\*)?(\d{1,2}:\d{2})(?:\s*[~-]\s*(\d{1,2}:\d{2}))?(?:\*\*)?\s*(.*)$/.exec(a.text); r.schedule.push(m ? { time: m[1] + (m[2] ? '~' + m[2] : ''), text: m[3] } : { time: '', text: a.text }); });
        return;
      }
      if (!items.length && nonEmpty(s.lines)) { r.others.push({ head: s.head, md: trimLines(s.lines).join('\n') }); return; }
      items.forEach(function (a) { r[k].push({ text: a.text, done: k === 'done' ? true : !!a.done, sub: a.indent > 0 }); });
    });
    // 제목 없는 자유 메모의 체크 줄도 셈
    if (r.free && !sc.list.length) {
      listItems(sc.pre).forEach(function (a) { if (a.done !== null) r.plan.push({ text: a.text, done: a.done, sub: a.indent > 0, fromFree: true }); });
      if (r.plan.length) r.free = trimLines(sc.pre.filter(function (l) { return !/^\s*[-*+]\s+\[[ xX]\]/.test(l); })).join('\n');   // 표로 옮긴 체크 줄은 메모에서 뺌
    }
    var all = r.done.concat(r.plan);
    r.stats = { done: all.filter(function (a) { return a.done; }).length, open: r.plan.filter(function (a) { return !a.done; }).length + r.late.length, late: r.late.length, events: r.schedule.length };
    return r;
  }

  function detectForm(it) {
    var t = String(it.title || ''), tags = (it.tags || []).join(' ');
    if (it.kind === 'daily') return it.ref ? 'memo' : 'daily';
    if (/일일 ?업무|업무 ?일지|daily/i.test(t + ' ' + tags)) return 'daily';
    if (/회의|미팅|meeting|minutes/i.test(t + ' ' + tags)) return 'meeting';
    var hs = sections(it.body).list.map(function (s) { return keyOf(s.head, MEET_KEYS); }).filter(Boolean);
    if (hs.indexOf('decide') >= 0 && (hs.indexOf('agenda') >= 0 || hs.indexOf('overview') >= 0)) return 'meeting';
    return 'doc';
  }

  /* ─── 문서 머리 — 회사 머리글 · 제목 · 문서 번호 · 결재란 ─── */
  var WD = '일월화수목금토';
  function dayLabel(d) { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return d || ''; return d.replace(/-/g, '.') + ' (' + WD[new Date(d + 'T00:00:00Z').getUTCDay()] + ')'; }
  function docNoOf(prefix, date, id) {
    var tail = String(id || '').replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase();
    return prefix + '-' + String(date || '').replace(/-/g, '') + (tail ? '-' + tail : '');
  }
  function companyBar(S, o) {
    if (!o.header || (!o.company && !o.logo)) return '';
    var right = [o.dept, o.writer].filter(Boolean).map(esc).join(' · ');
    return '<table style="border-collapse:collapse;width:100%;margin:0 0 10px;border-bottom:' + (S.theme === 'formal' ? '3px double ' + S.ink : '2px solid ' + S.ac) + '"><tr>' +
      '<td style="padding:0 0 6px;vertical-align:bottom">' + (o.logo ? '<img src="' + esc(o.logo) + '" alt="" style="height:30px;max-width:180px;vertical-align:middle;margin-right:8px">' : '') +
      (o.company ? '<span style="font-size:' + (S.fs + 1) + 'px;font-weight:800;color:' + S.ink + ';vertical-align:middle">' + esc(o.company) + '</span>' : '') + '</td>' +
      '<td style="padding:0 0 6px;vertical-align:bottom;text-align:right;font-size:' + (S.fs - 2) + 'px;color:' + S.sub + '">' + right + '</td></tr></table>';
  }
  function signBox(S, o) {
    if (!o.signs.length) return '';
    return '<td style="width:' + (o.signs.length * 66) + 'px;padding:0;vertical-align:top"><table style="border-collapse:collapse;width:100%;font-size:11.5px;table-layout:fixed"><tr>' +
      o.signs.map(function (l) { return '<th style="border:1px solid ' + S.line + ';background:' + (S.theme === 'clean' ? '#fafafa' : S.T.head) + ';padding:3px;text-align:center;font-weight:700;color:' + S.T.headInk + '">' + esc(l) + '</th>'; }).join('') +
      '</tr><tr>' + o.signs.map(function () { return '<td style="border:1px solid ' + S.line + ';height:46px"></td>'; }).join('') + '</tr></table></td>';
  }
  function titleBlock(S, o, big, metaLine, spaced) {
    var sign = signBox(S, o), align = sign || !spaced ? 'left' : 'center';
    var tf = S.T.tfont ? 'font-family:' + S.T.tfont + ';' : '';
    if (spaced) spaced = big.replace(/\s/g, '').length <= 4 ? (sign ? 8 : 14) : 2;   // '회의록' 처럼 짧을 때만 넓게
    return '<table style="border-collapse:collapse;width:100%;margin:0 0 12px"><tr><td style="vertical-align:middle;padding:0 12px 0 0">' +
      '<div style="' + tf + 'font-size:' + (spaced ? 26 : 22) + 'px;font-weight:800;color:' + S.ink + ';text-align:' + align + (spaced ? ';letter-spacing:' + spaced + 'px' : '') + ';line-height:1.3;word-break:keep-all">' + big + '</div>' +
      (metaLine ? '<div style="font-size:' + (S.fs - 2) + 'px;color:' + S.sub + ';margin-top:6px;text-align:' + align + '">' + metaLine + '</div>' : '') +
      '</td>' + sign + '</tr></table>';
  }
  function nw(s) { return '<span style="white-space:nowrap">' + s + '</span>'; }
  function metaJoin(a) { return a.filter(Boolean).map(nw).join(' &nbsp;·&nbsp; '); }

  /* ─── 양식별 ─── */
  function renderMeeting(it, S, o, head) {
    var p = parseMeeting(it.body, it.title, it.date), f = p.fields;
    var date = p.when.date || it.date || '';
    var docNo = docNoOf('MTG', date, it.id);
    var h = head ? companyBar(S, o) : '';
    h += titleBlock(S, head ? o : noSign(o), '회의록', metaJoin([o.docNo ? '문서번호 ' + esc(docNo) : '', '작성일 ' + esc(o.now.slice(0, 10) || date)]), true);
    var when = f.when || [date, p.when.start ? p.when.start + (p.when.end ? ' ~ ' + p.when.end : '') : ''].filter(Boolean).join(' ');
    var attHtml = p.att.map(function (n) { return '<span style="display:inline-block;white-space:nowrap;border:1px solid ' + S.line + ';border-radius:10px;padding:0 8px;margin:1px 4px 1px 0">' + esc(n) + '</span>'; }).join('');
    var full = function (l, v) { return tr('<th style="' + S.th + '">' + l + '</th><td style="' + S.td + '" colspan="3">' + (v || S.empty) + '</td>'); };
    var pair = function (l1, v1, l2, v2) { return tr('<th style="' + S.th + '">' + l1 + '</th><td style="' + S.td + '">' + (v1 || S.empty) + '</td><th style="' + S.th + '">' + l2 + '</th><td style="' + S.td + '">' + (v2 || S.empty) + '</td>'); };
    var rows = full('회의명', '<b>' + esc(p.title) + '</b>') + (f.project ? full('프로젝트', inl(f.project, S)) : '') +
      pair('일시', when ? nw(esc(when)) : '', '장소', inl(f.place || '', S)) +
      pair('작성자', esc(f.writer || o.writer || ''), '참석 인원', p.att.length ? p.att.length + '명' : '') +
      (f.host ? full('주관', inl(f.host, S)) : '') + full('참석자', attHtml) + (f.purpose ? full('회의 목적', inl(f.purpose, S)) : '') +
      p.extra.map(function (x) { return full(esc(x[0]), inl(x[1], S)); }).join('');
    var n = 0;
    h += S.h2(++n, '회의 개요') + tbl(S, ['14%', '36%', '14%', '36%'], rows);
    if (p.intro.trim()) h += '<div style="' + S.box + ';margin-top:6px">' + mdHtml(p.intro, S, o, inkOf(it)) + '</div>';
    if (p.agenda.length) h += S.h2(++n, '안건', p.agenda.length + '건') + '<div style="' + S.box + '"><ol style="margin:0;padding-left:20px">' + p.agenda.map(function (a) { return '<li style="margin:1px 0;word-break:keep-all">' + inl(a.text, S) + (a.done ? ' <span style="color:#10b981">(완료)</span>' : '') + '</li>'; }).join('') + '</ol></div>';
    h += S.h2(++n, '논의 내용') + '<div style="' + S.box + '">' + (mdHtml(p.discuss, S, o, inkOf(it)) || S.empty) + '</div>';
    h += S.h2(++n, '결정 사항') + '<div style="' + S.box + (p.decide ? ';border-left:4px solid ' + S.ac : '') + '">' + (mdHtml(p.decide, S, o, inkOf(it)) || S.empty) + '</div>';
    var open = p.todos.filter(function (t) { return !t.done; }).length;
    h += S.h2(++n, '할 일', p.todos.length ? p.todos.length + '건 · 남은 일 ' + open : '');
    h += p.todos.length
      ? '<table style="' + S.tbl + '">' + tr('<th style="' + S.th + ';width:1%;text-align:center">No</th><th style="' + S.th + '">내용</th><th style="' + S.th + ';width:1%">담당</th><th style="' + S.th + ';width:1%">기한</th><th style="' + S.th + ';width:1%">상태</th>') +
        p.todos.map(function (t, i) {
          return tr('<td style="' + S.td + ';text-align:center;white-space:nowrap">' + (i + 1) + '</td><td style="' + S.td + '">' + inl(t.title, S) + '</td>' +
            '<td style="' + S.td + ';white-space:nowrap">' + esc(t.who) + '</td><td style="' + S.td + ';white-space:nowrap">' + esc(t.due) + '</td>' +
            '<td style="' + S.td + ';white-space:nowrap;font-weight:700;color:' + (t.done ? '#059669' : '#d97706') + '">' + (t.done ? '완료' : '진행') + '</td>');
        }).join('') + '</table>'
      : '<div style="' + S.box + '">' + S.empty + '</div>';
    if (p.next) h += S.h2(++n, '다음 회의') + '<div style="' + S.box + '">' + mdHtml(p.next, S, o, inkOf(it)) + '</div>';
    p.others.forEach(function (x) { h += S.h2(++n, plainHead(x.head) || '기타') + '<div style="' + S.box + '">' + mdHtml(x.md, S, o, inkOf(it)) + '</div>'; });
    return { html: h, docNo: docNo, title: '회의록 — ' + p.title, date: date, parsed: p };
  }
  function renderDaily(it, S, o, head) {
    var p = parseDaily(it.body, it.date), date = p.date || it.date || '';
    var docNo = docNoOf('DLY', date, '');
    var h = head ? companyBar(S, o) : '';
    h += titleBlock(S, head ? o : noSign(o), '일일 업무 보고', metaJoin([o.docNo ? '문서번호 ' + esc(docNo) : '', '작성일 ' + esc(o.now.slice(0, 10) || date)]), true);
    var st = p.stats, total = st.done + st.open;
    var pair = function (l1, v1, l2, v2) { return tr('<th style="' + S.th + '">' + l1 + '</th><td style="' + S.td + '">' + (v1 || S.empty) + '</td><th style="' + S.th + '">' + l2 + '</th><td style="' + S.td + '">' + (v2 || S.empty) + '</td>'); };
    var bar = total ? '<span style="display:inline-block;width:90px;height:7px;background:#e5e7eb;border-radius:4px;vertical-align:middle;margin-right:6px;overflow:hidden"><span style="display:block;height:7px;width:' + Math.round(st.done / total * 100) + '%;background:' + S.ac + '"></span></span>' : '';
    h += tbl(S, ['14%', '36%', '14%', '36%'],
      pair('일자', nw(esc(dayLabel(date))), '작성자', esc(o.writer || '')) +
      pair('부서', esc(o.dept || ''), '실적', total ? bar + nw('완료 ' + st.done + ' / ' + total + (st.late ? ' · 밀린 일 ' + st.late : '')) : ''));
    var n = 0;
    var chk = function (a) { return a.done ? '<span style="color:#059669;font-weight:700">✔ 완료</span>' : '<span style="color:#d97706;font-weight:700">○ 진행</span>'; };
    var taskTable = function (list, lateMark) {
      return '<table style="' + S.tbl + '">' + tr('<th style="' + S.th + ';width:1%;text-align:center">No</th><th style="' + S.th + '">업무</th><th style="' + S.th + ';width:1%">상태</th>') +
        list.map(function (a, i) { return tr('<td style="' + S.td + ';text-align:center;white-space:nowrap">' + (i + 1) + '</td><td style="' + S.td + (a.sub ? ';padding-left:22px' : '') + (a.done ? ';color:' + S.sub : '') + '">' + inl(a.text, S) + '</td><td style="' + S.td + ';white-space:nowrap">' + (lateMark ? '<span style="color:#dc2626;font-weight:700">⚠ 밀림</span>' : chk(a)) + '</td>'); }).join('') + '</table>';
    };
    if (p.schedule.length) h += S.h2(++n, '오늘 일정', p.schedule.length + '건') + '<table style="' + S.tbl + '">' + tr('<th style="' + S.th + ';width:1%">시간</th><th style="' + S.th + '">내용</th>') +
      p.schedule.map(function (e) { return tr('<td style="' + S.td + ';white-space:nowrap">' + esc(e.time || '종일') + '</td><td style="' + S.td + '">' + inl(e.text, S) + '</td>'); }).join('') + '</table>';
    var work = p.done.concat(p.plan.filter(function (a) { return p.done.every(function (d) { return d.text !== a.text; }); }));
    if (work.length) h += S.h2(++n, '업무 실적', '완료 ' + st.done + ' · 진행 ' + (st.open - st.late)) + taskTable(work);
    if (p.late.length) h += S.h2(++n, '밀린 일', p.late.length + '건') + taskTable(p.late, true);
    if (p.free) h += S.h2(++n, work.length ? '업무 메모' : '업무 내용') + '<div style="' + S.box + '">' + mdHtml(p.free, S, o, inkOf(it)) + '</div>';
    if (p.memo) h += S.h2(++n, '특이 사항 · 메모') + '<div style="' + S.box + '">' + mdHtml(p.memo, S, o, inkOf(it)) + '</div>';
    p.others.forEach(function (x) { h += S.h2(++n, plainHead(x.head) || '기타') + '<div style="' + S.box + '">' + mdHtml(x.md, S, o, inkOf(it)) + '</div>'; });
    if (p.tomorrow.length) h += S.h2(++n, '내일 계획') + '<div style="' + S.box + '"><ul style="margin:0;padding-left:20px">' + p.tomorrow.map(function (a) { return '<li style="margin:1px 0">' + inl(a.text, S) + '</li>'; }).join('') + '</ul></div>';
    if (!n) h += '<div style="' + S.box + '">' + S.empty + '</div>';
    return { html: h, docNo: docNo, title: '일일 업무 보고 ' + dayLabel(date), date: date, stats: st };
  }
  function renderDoc(it, S, o, head) {
    var sc = sections(it.body), title = it.title || sc.title || '노트', date = it.date || '';
    var docNo = docNoOf('DOC', date, it.id);
    var body = String(it.body || '');
    if (sc.title && plainHead(sc.title) === plainHead(title)) body = body.replace(/^\s*#\s+[^\n]*\n?/, '');   // 맨 위 # 제목은 문서 제목으로
    var h = head ? companyBar(S, o) : '';
    h += titleBlock(S, head ? o : noSign(o), esc(title), metaJoin([o.docNo ? '문서번호 ' + esc(docNo) : '', date ? '작성일 ' + esc(date) : '', !o.header && o.writer ? '작성 ' + esc(o.writer) : '']), false);
    h += '<div style="border-top:' + (S.theme === 'formal' ? '2px solid ' + S.ink : '1px solid ' + S.line) + ';margin:-4px 0 12px"></div>';
    h += mdHtml(body, S, o, inkOf(it)) || S.empty;
    return { html: h, docNo: docNo, title: title, date: date };
  }
  function renderMemo(it, S, o) {
    var title = it.title || sections(it.body).title || '메모', date = it.date || '';
    var h = '<div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid ' + S.ac + ';padding-bottom:4px;margin-bottom:10px">' +
      '<b style="font-size:' + (S.fs + 4) + 'px;color:' + S.ink + '">' + esc(title) + '</b><span style="font-size:' + (S.fs - 2) + 'px;color:' + S.sub + '">' + esc([dayLabel(date), o.writer].filter(Boolean).join(' · ')) + '</span></div>';
    h += mdHtml(String(it.body || '').replace(/^\s*#\s+[^\n]*\n?/, ''), S, o, inkOf(it)) || S.empty;
    return { html: h, docNo: '', title: title, date: date };
  }
  function inkOf(it) { return it && it.ink && it.ink.blocks ? it.ink.blocks : null; }
  function noSign(o) { var x = Object.assign({}, o); x.signs = []; return x; }

  /* ─── 묶음 표지 · 목차 ─── */
  function cover(items, docs, S, o) {
    var dates = docs.map(function (d) { return d.date; }).filter(Boolean).sort();
    var daily = items.every(function (it) { return it.kind === 'daily'; });
    var h = companyBar(S, o) + titleBlock(S, o, daily ? '일일 업무 보고 모음' : '노트 모음',
      metaJoin([dates.length ? esc(dayLabel(dates[0])) + ' ~ ' + esc(dayLabel(dates[dates.length - 1])) : '', docs.length + '건', o.writer ? '작성 ' + esc(o.writer) : '']), true);
    if (daily) {
      var sd = 0, so = 0, sl = 0;
      docs.forEach(function (d) { if (d.stats) { sd += d.stats.done; so += d.stats.open; sl += d.stats.late; } });
      h += '<table style="' + S.tbl + ';margin-bottom:10px">' + tr(['기록한 날', '끝낸 일', '남은 일', '밀린 일'].map(function (l) { return '<th style="' + S.th + ';text-align:center">' + l + '</th>'; }).join('')) +
        tr([docs.length + '일', sd, so, sl].map(function (v) { return '<td style="' + S.td + ';text-align:center;font-size:' + (S.fs + 4) + 'px;font-weight:800">' + v + '</td>'; }).join('')) + '</table>';
    }
    h += S.h2(0, '목차') + '<table style="' + S.tbl + '">' + tr('<th style="' + S.th + ';width:1%;text-align:center">No</th><th style="' + S.th + ';width:1%">날짜</th><th style="' + S.th + '">제목</th><th style="' + S.th + ';width:1%">' + (daily ? '실적' : '양식') + '</th>') +
      docs.map(function (d, i) {
        return tr('<td style="' + S.td + ';text-align:center">' + (i + 1) + '</td><td style="' + S.td + ';white-space:nowrap">' + esc(dayLabel(d.date)) + '</td><td style="' + S.td + '">' + esc(d.title) + '</td>' +
          '<td style="' + S.td + ';white-space:nowrap">' + (d.stats ? '완료 ' + d.stats.done + ' / ' + (d.stats.done + d.stats.open) : esc(FORMS[d.form] || '')) + '</td>');
      }).join('') + '</table>';
    return h;
  }

  var BRK = '<div class="pg-brk" style="break-before:page;page-break-before:always;height:0"></div>';
  function build(items, opts) {
    var o = norm(opts), S = sty(o);
    if (!o.now) { var d = new Date(Date.now() + 9 * 3600000); o.now = d.toISOString().slice(0, 16).replace('T', ' '); }
    items = (items || []).filter(Boolean);
    var many = items.length > 1;
    var docs = items.map(function (it, i) {
      var form = o.form === 'auto' ? detectForm(it) : o.form;
      var head = !many || o.perPage || (i === 0 && !o.toc);
      var oo = many && o.toc ? noSign(o) : o;   // 표지가 있으면 결재란은 표지에만
      var r = form === 'meeting' ? renderMeeting(it, S, oo, head) : form === 'daily' ? renderDaily(it, S, oo, head) : form === 'memo' ? renderMemo(it, S, oo) : renderDoc(it, S, oo, head);
      r.form = form; return r;
    });
    var inner = '';
    if (many && o.toc) inner += cover(items, docs, S, o);
    docs.forEach(function (d, i) {
      if (i || (many && o.toc)) inner += o.perPage ? BRK : '<div style="border-top:2px dashed ' + S.line + ';margin:26px 0 20px"></div>';
      inner += d.html;
    });
    inner += '<div style="margin-top:16px;font-size:10.5px;color:#94a3b8;text-align:right">' + esc([o.company, '출력 ' + o.now].filter(Boolean).join(' · ')) + '</div>';
    var title = many ? (items.every(function (it) { return it.kind === 'daily'; }) ? '일일 업무 보고 모음' : '노트 모음') : (docs[0] ? docs[0].title : '노트');
    return { inner: inner, title: title, docNo: many ? '' : (docs[0] && docs[0].docNo) || '', forms: docs.map(function (d) { return d.form; }), docs: docs, opts: o };
  }

  /* ─── 종이 한 장 ─── */
  var MARGIN = { narrow: [10, 10], normal: [16, 14], wide: [24, 22] };
  function cssStr(s) { return String(s || '').replace(/[\\"]/g, ' ').replace(/[\r\n]+/g, ' ').slice(0, 70); }
  function mm(v) { return Math.round(v * 3.7795); }
  function page(inner, opts, title, docNo) {
    var o = norm(opts), S = sty(o), M = MARGIN[o.margin] || MARGIN.normal, mb = '';
    if (o.header && (o.company || title)) mb += '@top-left{content:"' + cssStr([o.company, title].filter(Boolean).join(' · ')) + '";font-size:8pt;color:#94a3b8}';
    if (o.docNo && docNo) mb += '@top-right{content:"' + cssStr(docNo) + '";font-size:8pt;color:#94a3b8}';
    if (o.pageNo) mb += '@bottom-center{content:counter(page) " / " counter(pages);font-size:8.5pt;color:#64748b}';
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + esc(title || '노트') + '</title><style>' +
      '@page{size:A4 ' + (o.landscape ? 'landscape' : 'portrait') + ';margin:' + M[0] + 'mm ' + M[1] + 'mm;' + mb + '}' +
      'html,body{margin:0;background:#fff}body{font-family:' + S.font + ';color:' + S.ink + ';font-size:' + S.fs + 'px;line-height:1.65;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '@media screen{body{padding:' + mm(M[0]) + 'px ' + mm(M[1]) + 'px;position:relative}}' +
      'tr,img,svg{break-inside:avoid;page-break-inside:avoid}' +
      '.pv-guide{position:absolute;left:0;right:0;height:0;border-top:1px dashed #f43f5e;pointer-events:none}.pv-guide span{position:absolute;right:6px;top:-9px;background:#fff1f2;color:#e11d48;font:600 10px sans-serif;padding:1px 6px;border-radius:8px}' +
      '@media print{.pv-guide{display:none}}' +
      '</style></head><body>' + inner + '</body></html>';
  }
  function word(inner, opts, title) {
    var o = norm(opts), S = sty(o), M = MARGIN[o.margin] || MARGIN.normal;
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>' + esc(title || '노트') + '</title><style>' +
      '@page Section1{size:' + (o.landscape ? '29.7cm 21cm;mso-page-orientation:landscape' : '21cm 29.7cm') + ';margin:' + M[0] + 'mm ' + M[1] + 'mm}div.Section1{page:Section1}' +
      'body{font-family:' + S.font + ';color:' + S.ink + ';font-size:' + (S.fs * .75).toFixed(1) + 'pt;line-height:1.6}</style></head><body><div class="Section1">' +
      inner.replace(/<div class="pg-brk"[^>]*><\/div>/g, '<br clear="all" style="page-break-before:always">') + '</div></body></html>';
  }
  /** 메일 · 메신저 붙여넣기 — 겉 글꼴만 씌움 */
  function rich(inner, opts) { var o = norm(opts), S = sty(o); return '<div style="font-family:' + S.font + ';color:' + S.ink + ';font-size:' + S.fs + 'px;line-height:1.65">' + inner.replace(/<div class="pg-brk"[^>]*><\/div>/g, '<hr>') + '</div>'; }

  return { build: build, page: page, word: word, rich: rich, parseMeeting: parseMeeting, parseDaily: parseDaily, parseWhen: parseWhen, todoOf: todoOf, detectForm: detectForm,
    sections: sections, THEMES: THEMES, ACCENTS: ACCENTS, FORMS: FORMS, SIGNS: SIGNS, MARGIN: MARGIN, DEF: DEF, mm: mm };
});
