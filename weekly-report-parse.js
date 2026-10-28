/* weekly-report-parse.js — 주간 업무 보고 텍스트 파서 (브라우저 · 서버 공용, v13.250)
 * 브라우저: window.WeeklyReportParse  ·  서버: require('../../weekly-report-parse.js')
 * 예전엔 weekly-report-admin.js(미리보기)와 server/services/weekly-report-parser.js(저장)에 같은 파서가 두 벌 있어
 * 항목 이름 공백 처리 등이 어긋났다 — 이제 한 곳만 고친다.
 *
 * 형식:
 *   [개발]                                  ← 섹션 (개발 · 셋업 · C/S(CS) · 기타)
 *   - [사이트] 업무명 ~MM/DD 50% @담당 #진행중  ← 항목 (앞 도형 생략 가능)
 *     : 세부 내용 #완료                       ← 세부 (':' '-.' 각종 도형 · 들여쓴 맨 글)
 *       └ 하위 세부                           ← 하위 (└ ↳ → 또는 4칸 이상 들여쓰기)
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

  var ITEM_LINE_RE = /^(?:[-–—*+·•∙◦○●◯□■▪▫▶►◆◇>＞]\s*)?\[([^\]]+)\]\s*(.*)$/;
  var DETAIL_LINE_RE = /^(?::|[-–—]\.|[-–—*+·•∙◦○●◯□■▪▫▶►◆◇>＞]|[└┗┕ㄴ↳➔→⇒])\s*(.*)$/;

  function isSubLine(raw, line) {
    return /^[└┗┕ㄴ↳➔→⇒]/.test(line) || /^(?: {4,}|\t{2,})/.test(raw);
  }

  /** '[개발]' 같은 단독 줄이면 섹션 key, 알 수 없는 [xxx] 면 '?', 섹션 줄이 아니면 null */
  function sectionOfLine(line) {
    var m = String(line).trim().match(/^\[([^\]]+)\]$/);
    if (!m) return null;
    var k = Object.keys(SECTION_ALIAS).filter(function (a) { return m[1].indexOf(a) >= 0; })[0];
    return k ? SECTION_ALIAS[k] : '?';
  }

  function extractMembers(text) {
    return (String(text).match(/@([^\s@]+)/g) || []).map(function (t) { return t.slice(1); });
  }

  function detectStatus(text) {
    if (/#완료/.test(text)) return 'done';
    if (/#진행중?/.test(text)) return 'in_progress';
    if (/완료/.test(text)) return 'done'; // 태그 없는 '완료'도 완료로
    return 'none';
  }

  function parseText(text) {
    var sections = [], items = [];
    if (!text) return { sections: sections, items: items };
    var cur = null, item = null;
    var lines = String(text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var line = raw.trim();
      if (!line) continue;
      var sec = sectionOfLine(line);
      if (sec && sec !== '?') {
        cur = { type: sec, label: line.slice(1, -1), items: [] };
        sections.push(cur);
        item = null;
        continue;
      }
      if (!cur) continue;
      if (sec === '?') continue; // 알 수 없는 [xxx] 단독 줄(섹션 오타 등)은 항목으로 오인하지 않음

      var im = line.match(ITEM_LINE_RE);
      if (im) {
        var rest = im[2].trim();
        var dm = rest.match(/(~\d{2}\/\d{2})/);
        var pm = rest.match(/(\d+)%/) || rest.match(/#%(\d+)/);
        // 상태 태그는 이름에서 뺀다 — 상태는 도형으로 따로 그리고, 이름이 말줄임될 때 태그가 잘려 사라지지 않게
        var name = rest
          .replace(/@[^\s@]+/g, '')
          .replace(/(~\d{2}\/\d{2})/g, '')
          .replace(/\d+%/g, '')
          .replace(/#%\d+/g, '')
          .replace(/#완료|#진행중?/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        item = {
          section: cur.type,
          sectionLabel: cur.label,
          client: im[1].trim(),
          name: name,
          deadline: dm ? dm[1] : '',
          pct: pm ? parseInt(pm[1], 10) : -1,
          members: extractMembers(rest),
          status: detectStatus(rest),
          details: [],
          raw: line
        };
        cur.items.push(item);
        items.push(item);
        continue;
      }

      if (item) {
        var dmk = line.match(DETAIL_LINE_RE);
        var dt = dmk ? dmk[1].trim() : (/^\s/.test(raw) ? line : null);
        if (dt) {
          var dMembers = extractMembers(dt);
          item.details.push({ text: dt, members: dMembers, status: detectStatus(dt), sub: isSubLine(raw, line) });
          dMembers.forEach(function (m) { if (item.members.indexOf(m) < 0) item.members.push(m); });
        }
      }
    }
    // 항목에 상태가 없으면 세부에서 올린다
    items.forEach(function (it) {
      if (it.status !== 'none' || !it.details.length) return;
      var hasDone = it.details.some(function (d) { return d.status === 'done'; });
      var hasProg = it.details.some(function (d) { return d.status === 'in_progress'; });
      if (hasProg) it.status = 'in_progress';
      else if (hasDone) it.status = 'done';
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
    parseText: parseText,
    parseName: parseName,
    namePrefix: namePrefix,
    buildParsed: buildParsed
  };
});
