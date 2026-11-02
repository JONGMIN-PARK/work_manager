/* ═══════════════════════════════════════════════════════════════════════
   notebook-md.js — 📓 노트북 마크다운 (v13.316)
   ─────────────────────────────────────────────────────────────────────
   안전: 원문을 먼저 모두 escape 한 뒤 마크다운 기호만 태그로 바꿈 → 원문 HTML 은 절대 그대로 나가지 않음
         링크는 http(s) · mailto · tel · #앵커 · nbf:(첨부) 만
   지원: 제목 1~6 · 굵게 · 기울임 · 취소선 · ==형광펜== · `코드` · 코드 블록(언어) · 인용 · 알림 상자(> [!NOTE] TIP WARNING IMPORTANT CAUTION)
         목록(들여쓰기 중첩) · 번호 목록 · 체크리스트(누르면 원문 줄을 바꿈) · 표(정렬) · 구분선 · 링크 · 자동 링크 · 사진 · 첨부
         ::ink[id] — ✍️ 손글씨 칸 자리 · 일일 노트의 '- [x] 제목 ⟦할 일 id⟧'
   블록마다 data-line (원문 줄 번호, 0부터) — 미리보기 ↔ 편집 위치 맞추기 · 체크 토글
   전역: NbMd.render(src) → { html, toc } · NbMd.toggleTask(src, line) · NbMd.slug · NbMd.esc
   ═══════════════════════════════════════════════════════════════════════ */
var NbMd = (function () {
  'use strict';
  var CALLOUT = { NOTE: ['ℹ️', '참고'], TIP: ['💡', '팁'], IMPORTANT: ['📌', '중요'], WARNING: ['⚠️', '주의'], CAUTION: ['⛔', '경고'], TODO: ['☑️', '할 일'], QUESTION: ['❓', '질문'], DONE: ['✅', '완료'] };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function slug(s) { return 'h-' + String(s).toLowerCase().replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^\w가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }

  /** 이미 escape 된 주소 — 허용된 것만 */
  function safeUrl(u) {
    u = String(u || '').trim();
    if (/^(https?:|mailto:|tel:)/i.test(u) || /^#[\w가-힣-]*$/.test(u) || /^nbf:[A-Za-z0-9-]+$/.test(u)) return u;
    if (/^www\./i.test(u)) return 'https://' + u;
    return null;
  }

  /* ─── 줄 안 꾸밈 (입력은 escape 전 원문) ─── */
  function inline(src) {
    var codes = [];
    var s = esc(String(src).replace(/[\u0000\u0001]/g, ''));
    // `코드` 먼저 빼 두기 — 안의 기호는 그대로
    s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, function (_, t, c) { codes.push('<code>' + c.trim() + '</code>'); return '\u0000' + (codes.length - 1) + '\u0000'; });
    // 사진 ![alt](url "title")
    s = s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+&quot;([^)]*)&quot;)?\s*\)/g, function (m, alt, url, ttl) {
      var u = safeUrl(url); if (!u) return m;
      if (/^nbf:/.test(u)) return '<img class="nb-img" data-nbf="' + u.slice(4) + '" alt="' + alt + '"' + (ttl ? ' title="' + ttl + '"' : '') + ' loading="lazy">';
      return '<img class="nb-img" src="' + u + '" alt="' + alt + '"' + (ttl ? ' title="' + ttl + '"' : '') + ' loading="lazy" referrerpolicy="no-referrer">';
    });
    // 링크 [글](url)
    s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/g, function (m, t, url) {
      var u = safeUrl(url); if (!u) return m;
      if (/^nbf:/.test(u)) return '<a class="nb-file" data-nbf="' + u.slice(4) + '" href="#">' + t + '</a>';
      if (u.charAt(0) === '#') return '<a href="' + u + '" data-anchor="1">' + t + '</a>';
      return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>';
    });
    // 자동 링크 (이미 a/img 안의 것은 건너뜀)
    s = s.replace(/(<a [^>]*>[\s\S]*?<\/a>|<img [^>]*>)|(\bhttps?:\/\/(?:(?!&(?:quot|lt|gt|#39);)[^\s<])*(?:(?!&(?:quot|lt|gt|#39);)[^\s<.,;:!?)\]]))/g, function (m, tag, url) {
      if (tag) return tag;
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
    // 만든 태그의 속성(주소 안 _ * == 등)은 꾸밈에서 빼 두기
    var tags = [];
    s = s.replace(/<(?:a|img) [^>]*>/g, function (t) { tags.push(t); return '\u0001' + (tags.length - 1) + '\u0001'; });
    s = s.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w가-힣])_([^_\s][^_\n]*?)_(?![_\w가-힣])/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+?)~~/g, '<del>$1</del>')
      .replace(/==([^=\n]+?)==/g, '<mark>$1</mark>');
    // 일일 노트 할 일 표시 ⟦id⟧
    s = s.replace(/\s?⟦([^⟧]{1,80})⟧/g, function (_, id) { return ' <a class="nb-todo-ref" data-todo="' + id + '" href="#" title="할 일 열기">↗</a>'; });
    s = s.replace(/\u0001(\d+)\u0001/g, function (_, i) { return tags[+i]; });
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[+i]; });
    return s;
  }

  /* ─── 표 ─── */
  function splitRow(l) {
    var t = l.trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [], cur = '', code = false;
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (ch === '`') code = !code;
      if (ch === '\\' && t.charAt(i + 1) === '|') { cur += '|'; i++; continue; }
      if (ch === '|' && !code) { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }
  var SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  /* ─── 목록 ─── */
  var LI_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  function renderList(lines, start, base) {
    // lines[start] 부터 같은 목록 묶음 — 들여쓰기로 중첩
    var items = [], i = start;
    var first = LI_RE.exec(lines[i]);
    var indent = first[1].replace(/\t/g, '    ').length;
    var ordered = /\d/.test(first[2]);
    while (i < lines.length) {
      var m = LI_RE.exec(lines[i]);
      var ind = m ? m[1].replace(/\t/g, '    ').length : -1;
      if (!m) {
        // 이어지는 줄(들여쓴 글) — 앞 항목에 붙임
        if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1].text += '\n' + lines[i].trim(); i++; continue; }
        break;
      }
      if (ind < indent) break;
      if (ind > indent) {
        var sub = renderList(lines, i, base);
        if (items.length) items[items.length - 1].sub += sub.html; else items.push({ text: '', sub: sub.html, line: i });
        i = sub.next; continue;
      }
      if (/\d/.test(m[2]) !== ordered) break;
      items.push({ text: m[3], sub: '', line: i, num: ordered ? parseInt(m[2], 10) : null });
      i++;
    }
    // 모두 체크일 때만 글머리 없앰 (섞이면 체크 줄만)
    var task = items.length > 0 && items.every(function (it) { return /^\[[ xX]\]\s/.test(it.text); });
    var h = '<' + (ordered ? 'ol' : 'ul') + (task ? ' class="nb-tasks"' : '') + (ordered && items[0] && items[0].num > 1 ? ' start="' + items[0].num + '"' : '') + '>';
    items.forEach(function (it) {
      var tm = /^\[([ xX])\]\s+([\s\S]*)$/.exec(it.text);
      if (tm) {
        var on = tm[1] !== ' ';
        h += '<li class="nb-task' + (on ? ' done' : '') + '" data-line="' + (it.line + base) + '"><label class="nb-chk"><input type="checkbox"' + (on ? ' checked' : '') + ' data-task="' + (it.line + base) + '"><span></span></label><div>' + inline(tm[2]).replace(/\n/g, '<br>') + it.sub + '</div></li>';
      } else {
        h += '<li data-line="' + (it.line + base) + '">' + inline(it.text).replace(/\n/g, '<br>') + it.sub + '</li>';
      }
    });
    return { html: h + '</' + (ordered ? 'ol' : 'ul') + '>', next: i };
  }

  /* ─── 블록 ─── */
  function blocks(lines, base, toc) {
    var h = '', i = 0, para = [], paraLine = 0;
    function flush() {
      if (!para.length) return;
      h += '<p data-line="' + (paraLine + base) + '">' + para.map(inline).join('<br>') + '</p>';
      para = [];
    }
    while (i < lines.length) {
      var l = lines[i], m;
      // 코드 블록
      if ((m = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(l))) {
        flush();
        var fence = m[1], lang = m[2], buf = [], s0 = i;
        i++;
        while (i < lines.length && lines[i].trim().indexOf(fence) !== 0) { buf.push(lines[i]); i++; }
        i++;
        h += '<div class="nb-code" data-line="' + (s0 + base) + '">' + (lang ? '<span class="nb-code-lang">' + esc(lang) + '</span>' : '') +
          '<button class="nb-code-copy" type="button" title="복사">복사</button><pre><code>' + esc(buf.join('\n')) + '</code></pre></div>';
        continue;
      }
      // 손글씨 칸
      if ((m = /^::ink\[([A-Za-z0-9_-]{1,40})\]\s*$/.exec(l))) { flush(); h += '<div class="nb-ink" data-ink="' + m[1] + '" data-line="' + (i + base) + '"></div>'; i++; continue; }
      if (!l.trim()) { flush(); i++; continue; }
      // 제목
      if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) {
        flush();
        var lv = m[1].length, inner = inline(m[2]), id = slug(inner);
        var dup = toc.filter(function (t) { return t.id === id || t.id.indexOf(id + '-') === 0; }).length;
        if (dup) id += '-' + dup;
        toc.push({ level: lv, text: inner.replace(/<[^>]*>/g, ''), id: id, line: i + base });
        h += '<h' + lv + ' id="' + id + '" data-line="' + (i + base) + '">' + inner + '</h' + lv + '>';
        i++; continue;
      }
      // 구분선
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); h += '<hr data-line="' + (i + base) + '">'; i++; continue; }
      // 인용 · 알림 상자
      if (/^\s*>/.test(l)) {
        flush();
        var q = [], q0 = i;
        while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        var cm = /^\[!([A-Za-z]+)\]\s*(.*)$/.exec(q[0] || '');
        if (cm && CALLOUT[cm[1].toUpperCase()]) {
          var k = cm[1].toUpperCase(), c = CALLOUT[k];
          h += '<div class="nb-callout nb-co-' + k.toLowerCase() + '" data-line="' + (q0 + base) + '"><div class="nb-co-t">' + c[0] + ' ' + (cm[2] ? inline(cm[2]) : c[1]) + '</div>' + blocks(q.slice(1), q0 + 1 + base, toc) + '</div>';
        } else {
          h += '<blockquote data-line="' + (q0 + base) + '">' + blocks(q, q0 + base, toc) + '</blockquote>';
        }
        continue;
      }
      // 표
      if (l.indexOf('|') >= 0 && i + 1 < lines.length && SEP_RE.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        flush();
        var head = splitRow(l), al = splitRow(lines[i + 1]).map(function (x) { return /^:-+:$/.test(x) ? 'center' : /-+:$/.test(x) ? 'right' : /^:-/.test(x) ? 'left' : ''; });
        var t0 = i;
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) { rows.push(splitRow(lines[i])); i++; }
        function td(tag, c, j) { return '<' + tag + (al[j] ? ' style="text-align:' + al[j] + '"' : '') + '>' + inline(c || '') + '</' + tag + '>'; }
        h += '<div class="nb-tbl" data-line="' + (t0 + base) + '"><table><thead><tr>' + head.map(function (c, j) { return td('th', c, j); }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + head.map(function (_, j) { return td('td', r[j], j); }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
        continue;
      }
      // 목록
      if (LI_RE.test(l)) {
        flush();
        var L = renderList(lines, i, base);
        h += L.html; i = L.next; continue;
      }
      if (!para.length) paraLine = i;
      para.push(l);
      i++;
    }
    flush();
    return h;
  }

  function render(src) {
    var toc = [];
    var html = blocks(String(src || '').replace(/\r\n?/g, '\n').split('\n'), 0, toc);
    return { html: html, toc: toc };
  }

  /** 체크 줄 바꾸기 — 미리보기에서 눌렀을 때 */
  function toggleTask(src, line) {
    var lines = String(src || '').split('\n');
    var l = lines[line];
    if (l == null) return src;
    var m = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\](\s)/.exec(l);
    if (!m) return src;
    lines[line] = m[1] + '[' + (m[2] === ' ' ? 'x' : ' ') + ']' + m[3] + l.slice(m[0].length);
    return lines.join('\n');
  }

  return { render: render, toggleTask: toggleTask, slug: slug, esc: esc, inline: inline, CALLOUT: CALLOUT };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NbMd;
