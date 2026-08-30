// 주간업무보고 텍스트 파서 (서버용)
// JSON의 lastText / curText 형식을 항목 배열로 변환

var SECTION_MAP = { '개발': 'dev', '셋업': 'setup', 'C/S': 'cs', 'CS': 'cs', '기타': 'etc' };

// 줄머리 기본 도형 — weekly-report-admin.js(클라 프리뷰)와 동일 유지 (parity 테스트로 강제)
var ITEM_LINE_RE = /^(?:[-–—*+·•∙◦○●◯□■▪▫▶►◆◇>＞]\s*)?\[([^\]]+)\]\s*(.*)$/;
var DETAIL_LINE_RE = /^(?::|[-–—]\.|[-–—*+·•∙◦○●◯□■▪▫▶►◆◇>＞]|[└┗┕ㄴ↳➔→⇒])\s*(.*)$/;

// 하위 세부 줄: └ ↳ → 로 시작하거나 4칸(탭 2회) 이상 들여쓴 줄
function isSubLine(raw, line) {
  return /^[└┗┕ㄴ↳➔→⇒]/.test(line) || /^(?: {4,}|\t{2,})/.test(raw);
}

// 줄머리 기본 도형 — weekly-report-admin.js(클라 프리뷰)와 반드시 동일하게 유지
var ITEM_LINE_RE = /^(?:[-–—*+·•∙◦○●◯□■▪▫▶►◆◇>＞]\s*)?\[([^\]]+)\]\s*(.*)$/;
var DETAIL_LINE_RE = /^(?::|[-–—]\.|[-–—*+·•∙◦○●◯□■▪▫▶►◆◇>＞]|[└┗┕ㄴ↳➔→⇒])\s*(.*)$/;

// 하위 세부 줄: └ ↳ → 로 시작하거나 4칸(탭 2회) 이상 들여쓴 줄
function isSubLine(raw, line) {
  return /^[└┗┕ㄴ↳➔→⇒]/.test(line) || /^(?: {4,}|\t{2,})/.test(raw);
}

function extractMembers(text) {
  var tags = text.match(/@([^\s@]+)/g) || [];
  return tags.map(function (t) { return t.slice(1); });
}

function detectStatus(text) {
  if (/#완료/.test(text)) return 'done';
  if (/#진행중?/.test(text)) return 'in_progress';
  if (/완료/.test(text)) return 'done';
  return 'none';
}

function parseText(text) {
  if (!text) return { sections: [], items: [] };
  var sections = [];
  var allItems = [];
  var cur = null;
  var item = null;
  var lines = text.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    var line = raw.trim();
    if (!line) continue;

    var sm = line.match(/^\[([^\]]+)\]$/);
    if (sm) {
      var key = Object.keys(SECTION_MAP).find(function (k) { return sm[1].indexOf(k) >= 0; });
      if (key) {
        cur = { type: SECTION_MAP[key], label: sm[1], items: [] };
        sections.push(cur);
        item = null;
        continue;
      }
    }
    if (!cur) continue;
    // 알 수 없는 [xxx] 단독 줄(섹션 오타 등)은 항목으로 오인하지 않고 건너뜀
    if (sm) continue;

    var im = line.match(ITEM_LINE_RE);
    if (im) {
      var rest = im[2].trim();
      var dm = rest.match(/(~\d{2}\/\d{2})/);
      var pm = rest.match(/(\d+)%/) || rest.match(/#%(\d+)/);
      var members = extractMembers(rest);
      var name = rest
        .replace(/@[^\s@]+/g, '')
        .replace(/(~\d{2}\/\d{2})/g, '')
        .replace(/\d+%/g, '')
        .replace(/#%\d+/g, '')
        .replace(/#완료|#진행중?/g, '')
        .trim();
      item = {
        section: cur.type,
        sectionLabel: cur.label,
        client: im[1].trim(),
        name: name,
        deadline: dm ? dm[1] : '',
        pct: pm ? parseInt(pm[1], 10) : -1,
        members: members,
        status: detectStatus(rest),
        details: [],
        raw: line,
      };
      cur.items.push(item);
      allItems.push(item);
      continue;
    }

    if (item) {
      // 세부 줄: 도형(:, -., -, ·, •, ○, └ …) 또는 들여쓴 맨텍스트 모두 허용
      var dmk = line.match(DETAIL_LINE_RE);
      var detailText = dmk ? dmk[1].trim() : (/^\s/.test(raw) ? line : null);
      if (detailText) {
        var detMembers = extractMembers(detailText);
        item.details.push({
          text: detailText,
          members: detMembers,
          status: detectStatus(detailText),
          sub: isSubLine(raw, line),
        });
        if (detMembers.length) {
          for (var k = 0; k < detMembers.length; k++) {
            if (item.members.indexOf(detMembers[k]) < 0) item.members.push(detMembers[k]);
          }
        }
      }
    }
  }

  // 항목 자체에 상태가 없으면 세부내용에서 롤업
  for (var n = 0; n < allItems.length; n++) {
    var ai = allItems[n];
    if (ai.status === 'none' && ai.details.length) {
      var hasDone = ai.details.some(function (dt) { return dt.status === 'done'; });
      var hasProg = ai.details.some(function (dt) { return dt.status === 'in_progress'; });
      if (hasDone && !hasProg) ai.status = 'done';
      else if (hasProg) ai.status = 'in_progress';
    }
  }

  return { sections: sections, items: allItems };
}

// 파일명/JSON.name 에서 주차 정보 추출
// 예: "소프트웨어팀_26W17_04/20~04/24_R1" → { team: "소프트웨어팀", week: "26W17", start: "04/20", end: "04/24" }
function parseName(name) {
  if (!name) return {};
  var clean = name.replace(/\.json$/i, '').replace(/\s*\(\d+\)\s*$/, '');
  var m = clean.match(/^(.+?)_(\d{2})W(\d{1,2})_(\d{2})[_\/](\d{2})~(\d{2})[_\/](\d{2})(?:_R\d+)?/);
  if (!m) {
    var weekOnly = clean.match(/(\d{2})W(\d{1,2})/);
    return weekOnly ? { weekLabel: weekOnly[0] } : {};
  }
  var yy = parseInt(m[2], 10);
  var year = 2000 + yy;
  var startMonth = parseInt(m[4], 10);
  var startDay = parseInt(m[5], 10);
  var endMonth = parseInt(m[6], 10);
  var endDay = parseInt(m[7], 10);
  function pad(n) { return String(n).padStart(2, '0'); }
  return {
    team: m[1].trim(),
    weekLabel: m[2] + 'W' + m[3],
    weekStart: year + '-' + pad(startMonth) + '-' + pad(startDay),
    weekEnd: year + '-' + pad(endMonth) + '-' + pad(endDay),
  };
}

// JSON 페이로드(version/name/savedAt/lastText/curText) 를 DB 저장용으로 변환
function buildParsed(payload) {
  var meta = parseName(payload.name || '');
  var cur = parseText(payload.curText || '');
  var last = parseText(payload.lastText || '');

  var stats = computeStats(cur.items, last.items);

  return {
    meta: meta,
    cur: cur,
    last: last,
    stats: stats,
  };
}

function computeStats(curItems, lastItems) {
  function tally(items) {
    var byStatus = { done: 0, in_progress: 0, none: 0 };
    var byMember = {};
    var byClient = {};
    var bySection = {};
    var pctSum = 0, pctCount = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      byStatus[it.status] = (byStatus[it.status] || 0) + 1;
      bySection[it.section] = (bySection[it.section] || 0) + 1;
      if (it.client) byClient[it.client] = (byClient[it.client] || 0) + 1;
      var mem = it.members || [];
      for (var j = 0; j < mem.length; j++) {
        byMember[mem[j]] = (byMember[mem[j]] || 0) + 1;
      }
      if (typeof it.pct === 'number' && it.pct >= 0) { pctSum += it.pct; pctCount++; }
    }
    return {
      total: items.length,
      byStatus: byStatus,
      byMember: byMember,
      byClient: byClient,
      bySection: bySection,
      avgPct: pctCount ? Math.round(pctSum / pctCount) : null,
    };
  }
  return { cur: tally(curItems), last: tally(lastItems) };
}

module.exports = {
  parseText: parseText,
  parseName: parseName,
  buildParsed: buildParsed,
};
