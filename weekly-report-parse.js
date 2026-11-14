/* weekly-report-parse.js — 주간 업무 보고 텍스트 파서 (브라우저 · 서버 공용, v13.250 · v13.353 정리)
 * 브라우저: window.WeeklyReportParse  ·  서버: require('../../weekly-report-parse.js')
 * 예전엔 weekly-report-admin.js(미리보기)와 server/services/weekly-report-parser.js(저장)에 같은 파서가 두 벌 있어
 * 항목 이름 공백 처리 등이 어긋났다 — 이제 한 곳만 고친다.
 *
 * 형식:
 *   [개발]                                  ← 섹션 (개발 · 셋업 · C/S(CS) · 기타). 괄호는 [] ［］ 【】
 *   - [사이트] 업무명 ~MM/DD 50% @담당 #진행중  ← 항목 (앞 도형 생략 가능)
 *     : 세부 내용 #완료                       ← 세부 (':' '-.' 각종 도형 · 번호 1. 1) ① · 들여쓴 맨 글)
 *       └ 하위 세부                           ← 하위 (└ ↳ → 또는 4칸 이상 들여쓰기)
 *
 * v13.353 정리:
 *   · 진행률 맨 글 '50%' 는 꼬리에 있을 때만 — 이름 속 '불량률 30% 개선' 은 이름에 남김
 *   · 기한 ~12/4 · ~12.04 · ~12-04 · ~12/04(목) → ~12/04 로 맞춤
 *   · 낱말 '완료' 는 띄어 쓴 낱말일 때만 (미완료 · 완료율 · '완료 예정' 은 아님) · #예정 태그
 *   · '@김민수,@박종민' · '@김민수/박종민' 처럼 붙여 쓴 담당 나눔
 *   · 들여쓰기 없는 맨 글 줄: 앞 줄이 쉼표 · 및 · / 등으로 끝나면 이어 붙이고, 아니면 세부 한 줄 (예전엔 버려졌다)
 *   · 섹션 머리 없이 쓴 항목은 '기타' 로 · 탭 · CRLF · 줄바꿈 없는 공백(nbsp) 처리
 *   · ownStatus: 업무 줄에 직접 붙은 상태 (세부에서 올린 status 와 구분 — 태그 없는 세부 줄은 ownStatus 를 따름)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WeeklyReportParse = api;
})(this, function () {
  'use strict';

  var SECTION_KEYS = ['dev', 'setup', 'cs', 'etc'];
  var SECTION_LABELS = { dev: '개발', setup: '셋업', cs: 'C/S', etc: '기타' };
  // 섹션 머리 글자 → key ('[C/S 및 유지보수]' 처럼 앞뒤가 붙어도 포함되면 인정)
  var SECTION_ALIAS = { '개발': 'dev', '셋업': 'setup', 'C/S': 'cs', 'CS': 'cs', '기타': 'etc' };

  // 괄호는 반각 [] · 전각 ［］ · 【】 모두 (v13.353 — 다른 문서에서 붙여 넣으면 전각이 흔함)
  var BULLET = '[-–—*+·•∙◦○●◯□■▪▫▶►◆◇>＞]';
  var ITEM_LINE_RE = new RegExp('^(?:' + BULLET + '\\s*)?[\\[［【]([^\\]］】]+)[\\]］】]\\s*(.*)$');
  // 세부 줄 머리: ':' · '-.' · 도형 · 화살표 · 번호(1. 1) ①)
  var DETAIL_LINE_RE = /^(?::|[-–—]\.|[-–—*+·•∙◦○●◯□■▪▫▶►◆◇>＞]|[└┗┕ㄴ↳➔→⇒]|\d{1,2}[.)](?=\s)|[①-⑳])\s*(.*)$/;
  var SUB_MARK_RE = /^[└┗┕ㄴ↳➔→⇒]/;

  function isSubLine(raw, line) {
    return SUB_MARK_RE.test(line) || /^(?: {4,}|\t{2,})/.test(raw);
  }

  /** '[개발]' 같은 단독 줄이면 섹션 key, 알 수 없는 [xxx] 면 '?', 섹션 줄이 아니면 null */
  function sectionOfLine(line) {
    var m = String(line).trim().match(/^[\[［【]([^\]］】]+)[\]］】]$/);
    if (!m) return null;
    var k = Object.keys(SECTION_ALIAS).filter(function (a) { return m[1].indexOf(a) >= 0; })[0];
    return k ? SECTION_ALIAS[k] : '?';
  }

  /** @담당 — '@김민수,@박종민' · '@김민수/박종민' · '@김민수·박종민' 처럼 붙여 써도 사람마다 나눔. 끝 문장부호는 뗌 */
  var MEMBER_RE = /@([^\s@]+)/g;
  function extractMembers(text) {
    var out = [];
    (String(text).match(MEMBER_RE) || []).forEach(function (t) {
      t.slice(1).split(/[,，/·、;]+/).forEach(function (n) {
        n = n.replace(/^[^\w가-힣]+|[^\w가-힣]+$/g, '');
        if (n && out.indexOf(n) < 0) out.push(n);
      });
    });
    return out;
  }

  /** 상태 — 태그가 먼저(#완료 · #진행/#진행중 · #예정), 없으면 낱말 '완료'
   *  낱말 '완료'는 앞뒤가 띄어진 낱말일 때만: '미완료' · '완료율' 은 아님. 같은 줄에 예정 · 계획 · 목표가 있으면 아직 안 끝난 것 ('완료 보고 예정') */
  function detectStatus(text) {
    text = String(text || '');
    if (/#완료/.test(text)) return 'done';
    if (/#진행/.test(text)) return 'in_progress';
    if (/#예정/.test(text)) return 'none';
    if (/(?:^|[\s(\[])완료(?=$|[\s)\].,!])/.test(text) && !/예정|계획|목표/.test(text)) return 'done';
    return 'none';
  }

  /** v13.487 보고 표시 — #지연 · #이슈 · #위험 · #문제 = 주의(빨강, 상태와 따로) · #중요 · ★ = 핵심(맨 위 · ★) */
  var RISK_RE = /#(지연|이슈|위험|문제)/;
  var FLAG_STRIP_RE = /#(?:지연|이슈|위험|문제|중요)|★/g;
  function flagsOf(text) {
    text = String(text || '');
    var m = text.match(RISK_RE);
    return { risk: m ? m[1] : '', star: /#중요|★/.test(text) };
  }

  /** 기한 '~12/04' · '~12/4' · '~12.4' · '~12-04' · '~ 12/04(목)' → '~12/04' (없으면 '') */
  var DEADLINE_RE = /~\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\s*\([^)]{1,3}\))?/;
  function normDeadline(m) {
    var mo = parseInt(m[1], 10), d = parseInt(m[2], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return '~' + pad(mo) + '/' + pad(d);
  }

  /** 항목 한 줄의 뒷부분 → 이름 · 기한 · 진행률 · 담당 · 상태
   *  진행률: '#%50' 은 어디 있어도, 맨 글 '50%' 는 꼬리(이름 뒤 · 기한/담당/태그 사이)에 있을 때만 —
   *  '불량률 30% 개선' 처럼 이름 속 % 는 이름에 남김 (예전엔 이름에서 지우고 진행률로 잘못 잡았다) */
  function splitMeta(rest) {
    var s = String(rest || '');
    var members = extractMembers(s);
    var status = detectStatus(s);
    var fl = flagsOf(s);
    var dl = s.match(DEADLINE_RE);
    var deadline = dl ? normDeadline(dl) : '';
    var pct = -1;
    var tagPct = s.match(/#%(\d{1,3})/);
    if (tagPct) pct = parseInt(tagPct[1], 10);
    var name = s
      .replace(/@[^\s@]+/g, ' ')
      .replace(new RegExp(DEADLINE_RE.source, 'g'), ' ')
      .replace(/#%\d{1,3}/g, ' ')
      .replace(/#완료|#진행중?|#예정/g, ' ')
      .replace(FLAG_STRIP_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // 꼬리의 맨 글 진행률 (뒤에서부터 하나)
    var tail = name.match(/(?:^|\s)(\d{1,3})\s*%$/);
    if (tail) {
      if (pct < 0) pct = parseInt(tail[1], 10);
      name = name.slice(0, tail.index).trim();
    }
    if (pct > 100) pct = 100;
    return { name: name, deadline: deadline, pct: pct, members: members, status: status, risk: fl.risk, star: fl.star };
  }

  // 들여쓰기 없이 이어진 줄을 앞 줄에 붙일지 — 앞 줄이 이어지는 꼴로 끝날 때 (쉼표 · 및 · / · 여는 괄호 · 하이픈 등)
  var CONT_TAIL_RE = /(?:[,，·\/&+(（\-–]|및|와|과|또는)$/;

  function parseText(text) {
    var sections = [], items = [];
    if (!text) return { sections: sections, items: items };
    var cur = null, item = null, last = null;   // last: 마지막으로 글을 넣은 곳 ({ kind: 'item'|'detail', ref })
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    function ensureSection() {   // 섹션 머리 없이 항목부터 쓰면 '기타' 로 (예전엔 통째로 버려졌다)
      if (!cur) { cur = { type: 'etc', label: SECTION_LABELS.etc, items: [], implicit: true }; sections.push(cur); }
      return cur;
    }
    function addDetail(raw, dt) {
      var dMembers = extractMembers(dt);
      var fl = flagsOf(dt);
      var d = { text: dt, members: dMembers, status: detectStatus(dt), sub: isSubLine(raw, raw.trim()), risk: fl.risk, star: fl.star };
      item.details.push(d);
      dMembers.forEach(function (m) { if (item.members.indexOf(m) < 0) item.members.push(m); });
      last = { kind: 'detail', ref: d };
    }
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].replace(/\t/g, '    ').replace(/ /g, ' ');
      var line = raw.trim();
      if (!line) { last = null; continue; }   // 빈 줄 다음은 이어 붙이지 않음
      var sec = sectionOfLine(line);
      if (sec && sec !== '?') {
        cur = { type: sec, label: line.slice(1, -1), items: [] };
        sections.push(cur);
        item = null; last = null;
        continue;
      }
      if (sec === '?') { last = null; continue; } // 알 수 없는 [xxx] 단독 줄(섹션 오타 등)은 항목으로 오인하지 않음

      var im = line.match(ITEM_LINE_RE);
      if (im) {
        ensureSection();
        var meta = splitMeta(im[2]);
        item = {
          section: cur.type,
          sectionLabel: cur.label,
          client: im[1].trim(),
          name: meta.name,
          deadline: meta.deadline,
          pct: meta.pct,
          members: meta.members,
          status: meta.status,
          risk: meta.risk,
          star: meta.star,
          ownStatus: meta.status,   // 업무 줄에 직접 붙은 상태 — 태그 없는 세부 줄은 이것만 따름 (아래에서 세부로부터 올린 status 와 구분)
          details: [],
          raw: line
        };
        cur.items.push(item);
        items.push(item);
        last = { kind: 'item', ref: item };
        continue;
      }
      if (!item) continue;

      var dmk = line.match(DETAIL_LINE_RE);
      if (dmk) { if (dmk[1].trim()) addDetail(raw, dmk[1].trim()); continue; }
      if (/^\s/.test(raw)) { addDetail(raw, line); continue; }   // 들여 쓴 맨 글 = 세부
      // 들여쓰기 없는 맨 글 — 앞 줄이 이어지는 꼴로 끝났으면 그 줄에 붙이고, 아니면 세부 한 줄로 (예전엔 버려졌다)
      var prev = last && (last.kind === 'detail' ? last.ref.text : last.ref.name);
      if (last && CONT_TAIL_RE.test(prev)) {
        if (last.kind === 'detail') {
          last.ref.text = prev + ' ' + line;
          if (last.ref.status === 'none') last.ref.status = detectStatus(line);
          var lf = flagsOf(line); if (!last.ref.risk) last.ref.risk = lf.risk; if (lf.star) last.ref.star = true;
          extractMembers(line).forEach(function (m) { if (item.members.indexOf(m) < 0) item.members.push(m); if (last.ref.members.indexOf(m) < 0) last.ref.members.push(m); });
        } else {
          var more = splitMeta(line);
          item.name = (item.name + ' ' + more.name).trim();
          if (!item.deadline) item.deadline = more.deadline;
          if (item.pct < 0) item.pct = more.pct;
          if (item.status === 'none') item.status = item.ownStatus = more.status;
          if (!item.risk) item.risk = more.risk; if (more.star) item.star = true;
          more.members.forEach(function (m) { if (item.members.indexOf(m) < 0) item.members.push(m); });
        }
        continue;
      }
      addDetail(raw, line);
    }
    // 항목에 상태가 없으면 세부에서 올린다 — 세부가 전부 완료일 때만 완료, 일부만 끝났거나 진행이 있으면 진행
    //   (예전엔 완료 한 줄만 있어도 업무 전체가 완료가 되어 태그 없는 세부 줄까지 완료로 보였다)
    items.forEach(function (it) {
      if (it.status !== 'none' || !it.details.length) return;
      var lines = it.details.filter(function (d) { return !d.sub; });
      if (!lines.length) lines = it.details;
      var done = lines.filter(function (d) { return d.status === 'done'; }).length;
      var prog = lines.some(function (d) { return d.status === 'in_progress'; });
      if (done === lines.length) it.status = 'done';
      else if (prog || done) it.status = 'in_progress';
    });
    return { sections: sections, items: items };
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // 이름 → 주차 정보.  "소프트웨어팀_26W17_04/20~04/24_R1" → { team, weekLabel: '26W17', weekStart: '2026-04-20', weekEnd: '2026-04-24' }
  function parseName(name) {
    if (!name) return {};
    var clean = String(name).replace(/\.json$/i, '').replace(/\s*\(\d+\)\s*$/, '');
    var m = clean.match(/^(.+?)_(\d{2})W(\d{1,2})_(\d{2})[_\/](\d{2})~(\d{2})[_\/](\d{2})(?:_R\d+)?/);
    if (!m) {
      var weekOnly = clean.match(/(\d{2})W(\d{1,2})/);
      return weekOnly ? { weekLabel: weekOnly[0] } : {};
    }
    var year = 2000 + parseInt(m[2], 10);
    var sm = parseInt(m[4], 10), em = parseInt(m[6], 10);
    if (sm === 12 && parseInt(m[3], 10) <= 1) year--; // 25W01 = 2024-12-30 월요일부터 (ISO 주차의 해 ≠ 시작일의 해)
    return {
      team: m[1].trim(),
      weekLabel: m[2] + 'W' + m[3],
      weekStart: year + '-' + pad(sm) + '-' + pad(parseInt(m[5], 10)),
      // 12/30~01/03 처럼 해를 넘기는 주
      weekEnd: (em < sm ? year + 1 : year) + '-' + pad(em) + '-' + pad(parseInt(m[7], 10))
    };
  }

  /** 'YYYY-MM-DD' 두 개 → 이름 앞부분 '팀_26W17_04/20~04/24' (ISO 주차). 시간대 영향 없게 문자열로만 계산 */
  function namePrefix(team, weekStart, weekEnd) {
    var s = String(weekStart || '').split('-').map(Number);
    var e = String(weekEnd || '').split('-').map(Number);
    if (s.length !== 3 || e.length !== 3 || s.some(isNaN) || e.some(isNaN)) return null;
    var d = new Date(Date.UTC(s[0], s[1] - 1, s[2]));
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var isoYear = d.getUTCFullYear();
    var weekNo = Math.ceil((((d - Date.UTC(isoYear, 0, 1)) / 86400000) + 1) / 7);
    return {
      weekLabel: pad(isoYear % 100) + 'W' + pad(weekNo),
      prefix: team + '_' + pad(isoYear % 100) + 'W' + pad(weekNo) + '_' + pad(s[1]) + '/' + pad(s[2]) + '~' + pad(e[1]) + '/' + pad(e[2])
    };
  }

  function tally(items) {
    var byStatus = { done: 0, in_progress: 0, none: 0 };
    var byMember = {}, byClient = {}, bySection = {};
    var pctSum = 0, pctCount = 0;
    items.forEach(function (it) {
      byStatus[it.status] = (byStatus[it.status] || 0) + 1;
      bySection[it.section] = (bySection[it.section] || 0) + 1;
      if (it.client) byClient[it.client] = (byClient[it.client] || 0) + 1;
      (it.members || []).forEach(function (m) { byMember[m] = (byMember[m] || 0) + 1; });
      if (typeof it.pct === 'number' && it.pct >= 0) { pctSum += it.pct; pctCount++; }
    });
    return {
      total: items.length, byStatus: byStatus, byMember: byMember, byClient: byClient, bySection: bySection,
      avgPct: pctCount ? Math.round(pctSum / pctCount) : null
    };
  }

  // 업로드 JSON { name, lastText, curText } → 저장용 parsed
  function buildParsed(payload) {
    var cur = parseText(payload.curText || '');
    var last = parseText(payload.lastText || '');
    return {
      meta: parseName(payload.name || ''),
      cur: cur,
      last: last,
      stats: { cur: tally(cur.items), last: tally(last.items) }
    };
  }

  return {
    SECTION_KEYS: SECTION_KEYS,
    SECTION_LABELS: SECTION_LABELS,
    SECTION_ALIAS: SECTION_ALIAS,
    ITEM_LINE_RE: ITEM_LINE_RE,
    DETAIL_LINE_RE: DETAIL_LINE_RE,
    isSubLine: isSubLine,
    sectionOfLine: sectionOfLine,
    detectStatus: detectStatus,
    flagsOf: flagsOf,
    FLAG_STRIP_RE: FLAG_STRIP_RE,
    extractMembers: extractMembers,
    splitMeta: splitMeta,
    parseText: parseText,
    parseName: parseName,
    namePrefix: namePrefix,
    buildParsed: buildParsed
  };
});
