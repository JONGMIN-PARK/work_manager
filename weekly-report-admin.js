/* ═══ 주간 업무 보고 — 관리자 페이지 ═══
 * 업로드/검색/통계/목록 4개 서브탭으로 /api/weekly-reports 호출
 * apiFetch (auth.js) 사용 — 자동 JWT 첨부
 */

(function () {
  // ── 섹션 설정: 라벨/번호/색상/파싱 별칭의 단일 소스 ──
  var SECTIONS = {
    dev:   { label: '개발', num: '01', main: '#3a6ab0', bg: 'rgba(58,106,176,.12)', bar: 'linear-gradient(90deg,#3a6ab0,#7aaade)' },
    setup: { label: '셋업', num: '02', main: '#7030b0', bg: 'rgba(112,48,176,.12)', bar: 'linear-gradient(90deg,#7030b0,#a878d6)' },
    cs:    { label: 'C/S',  num: '03', main: '#c06000', bg: 'rgba(192,96,0,.12)',   bar: 'linear-gradient(90deg,#c06000,#e09850)' },
    etc:   { label: '기타', num: '04', main: '#506070', bg: 'rgba(80,96,112,.12)',  bar: 'linear-gradient(90deg,#506070,#80909a)' }
  };
  var SECTION_KEYS = ['dev', 'setup', 'cs', 'etc'];
  var SECTION_ALIAS = { 'CS': 'cs' }; // 라벨→key (파싱용). 나머지는 SECTIONS에서 파생
  SECTION_KEYS.forEach(function (k) { SECTION_ALIAS[SECTIONS[k].label] = k; });
  function secOf(t) { return SECTIONS[t] || SECTIONS.dev; }
  function secLabel(t) { return (SECTIONS[t] || {}).label || t; }

  // ── 줄머리 기본 도형 (서버 weekly-report-parser.js와 동일 유지 — parity 테스트로 강제) ──
  // 항목 줄: (도형 생략 가능) [사이트] 업무명 …
  var ITEM_LINE_RE = /^(?:[-–—*+·•∙◦○●◯□■▪▫▶►◆◇>＞]\s*)?\[([^\]]+)\]\s*(.*)$/;
  // 세부 줄: ':' '-.' 또는 각종 기본 도형·하위 도형(└ ↳ → 등)
  var DETAIL_LINE_RE = /^(?::|[-–—]\.|[-–—*+·•∙◦○●◯□■▪▫▶►◆◇>＞]|[└┗┕ㄴ↳➔→⇒])\s*(.*)$/;
  // 하위 세부 줄: └ ↳ → 로 시작하거나 4칸(탭 2회) 이상 들여쓴 줄
  function isSubLine(raw, line) {
    return /^[└┗┕ㄴ↳➔→⇒]/.test(line) || /^(?: {4,}|\t{2,})/.test(raw);
  }

  // ── 상태/진행률 상수 (색·크기·임계값 단일 소스) ──
  var STATUS_COLORS = { planned: '#4f74c9', in_progress: '#d03030', done: '#1a8a40' };
  var ICON_PX = 12; // 상태 아이콘 지름(px)
  var HEAT = { midAt: 30, highAt: 70, low: '#d21f1f', mid: '#c8730a', high: '#1a8a40' };
  function heatColor(p) { return p >= HEAT.highAt ? HEAT.high : (p >= HEAT.midAt ? HEAT.mid : HEAT.low); }

  // ── D-day 임계값·색 (기한 임박도) ──
  var DDAY = {
    soonAt: 3, nearAt: 7,
    dday: { color: '#fff', bg: '#c05000' },
    soon: { color: '#e03030', bg: 'rgba(224,48,48,.22)' },
    near: { color: '#c05000', bg: 'rgba(192,80,0,.18)' },
    far:  { color: '#6070a0', bg: 'rgba(96,112,160,.10)' },
    over: { color: '#fff', bg: '#d03030' }
  };

  var STATE = { tab: 'author', searchResults: null, stats: null, list: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function statusPill(st) {
    if (st === 'done') return '<span style="color:#1a8a40;background:rgba(26,138,64,.12);padding:1px 6px;border-radius:4px;font-size:11px">● 완료</span>';
    if (st === 'in_progress') return '<span style="color:#d03030;background:rgba(208,48,48,.12);padding:1px 6px;border-radius:4px;font-size:11px">● 진행중</span>';
    return '';
  }
  // D-day 계산 (deadline = "~05/29" 형식)
  function dday(deadline) {
    if (!deadline) return null;
    var m = String(deadline).match(/~?(\d{1,2})\/(\d{1,2})/);
    if (!m) return null;
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var target = new Date(now.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    var diff = Math.round((target - today) / 86400000);
    if (diff === 0) return { label: 'D-DAY', color: DDAY.dday.color, bg: DDAY.dday.bg };
    if (diff > 0) {
      var t = diff <= DDAY.soonAt ? DDAY.soon : (diff <= DDAY.nearAt ? DDAY.near : DDAY.far);
      return { label: 'D-' + diff, color: t.color, bg: t.bg };
    }
    return { label: 'D+' + Math.abs(diff), color: DDAY.over.color, bg: DDAY.over.bg };
  }
  function ddayBadge(deadline) {
    var d = dday(deadline);
    if (!d) return '';
    return '<span style="font-family:ui-monospace,monospace;font-size:9.5px;font-weight:700;color:' + d.color + ';background:' + d.bg + ';border-radius:4px;padding:1px 5px;white-space:nowrap;margin-left:4px">' + esc(d.label) + '</span>';
  }

  // 인라인 마크업 (=y{...}, **bold**, ~~strike~~, {bold})
  function inlineMarkup(text) {
    if (!text) return '';
    var out = esc(text);
    var hlBg = { y: 'rgba(255,224,80,.45)', r: 'rgba(255,140,140,.45)', g: 'rgba(140,220,160,.45)', b: '#d0e4ff', p: '#e8d8f8' };
    out = out.replace(/=([yrgbp])\{([^}]*)\}/g, function (_, c, t) {
      return '<span style="background:' + (hlBg[c] || hlBg.y) + ';padding:1px 4px;border-radius:3px">' + t + '</span>';
    });
    var fc = { r: '#d03030', g: '#1a8a40', b: '#2060c0', p: '#7030b0', o: '#c06000' };
    out = out.replace(/#([rgbpo])\{([^}]*)\}/g, function (_, c, t) {
      return '<span style="color:' + (fc[c] || fc.r) + '">' + t + '</span>';
    });
    out = out.replace(/\{([^}]*)\}/g, '<strong>$1</strong>');
    out = out.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/~~(.*?)~~/g, '<del>$1</del>');
    // #완료/#진행중 도형만 (원본 정책 — 라벨 제거)
    out = out.replace(/#완료/g, '<span style="display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;background:#1a8a40;border-radius:50%;vertical-align:middle;margin:0 2px"><svg width="8" height="6" viewBox="0 0 9 7"><path d="M1 3.5L3.5 6L8 1" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>');
    out = out.replace(/#진행중?/g, '<span style="display:inline-block;width:8px;height:8px;background:#d03030;border-radius:50%;box-shadow:0 0 0 2px rgba(208,48,48,.2);vertical-align:middle;margin:0 4px"></span>');
    out = out.replace(/#%(\d+)/g, function (_, p) {
      var v = Math.min(100, Math.max(0, parseInt(p, 10)));
      return '<span style="display:inline-flex;align-items:center;gap:4px;padding:1px 5px;border:1px solid var(--bd);border-radius:10px;font-size:10px;color:var(--ac);vertical-align:middle;margin:0 3px"><span style="font-weight:700">' + v + '%</span><span style="width:14px;height:4px;background:var(--bd);border-radius:2px;overflow:hidden;display:inline-block"><span style="display:block;height:100%;width:' + v + '%;background:linear-gradient(90deg,var(--ac),#7aaade)"></span></span></span>';
    });
    return out;
  }

  // iframe 임베드용 자립 HTML — CSS 변수와 폰트를 인라인 포함
  var THEME_VARS = {
    light: { bgPage: '#F4F5FB', bgP: '#FFFFFF', bgI: '#E2E5F0', bd: '#C8CDE0', ac: '#5865F2', t2: '#2A3048', t3: '#424862', t5: '#8890A6', t6: '#B0B6C8' },
    dark:  { bgPage: '#0B0E14', bgP: '#111620', bgI: '#0D1018', bd: '#222C44', ac: '#5B8DEF', t2: '#D8DEE8', t3: '#B8C0D4', t5: '#6070A0', t6: '#404C70' }
  };
  // CSS 변수명 ↔ THEME_VARS 키 매핑 (단일 소스). :root 생성·치환 모두 여기서 파생
  var CSS_VARS = { '--bg': 'bgPage', '--bg-p': 'bgP', '--bg-i': 'bgI', '--bd': 'bd', '--ac': 'ac', '--t2': 't2', '--t3': 't3', '--t5': 't5', '--t6': 't6' };
  function themeRootCss(v) {
    return ':root{' + Object.keys(CSS_VARS).map(function (n) { return n + ':' + v[CSS_VARS[n]]; }).join(';') + '}';
  }
  function buildStandaloneHTML(parsedPane, opts) {
    opts = opts || {};
    var theme = opts.theme === 'dark' ? 'dark' : 'light';
    var v = THEME_VARS[theme];
    var title = opts.title || '주간 업무 보고';
    var headerHtml = '';
    if (opts.headerLabel) {
      headerHtml = '<div style="margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--bd)">'
        + '<div style="font-size:14px;font-weight:700;color:var(--t2)">' + esc(opts.headerLabel) + '</div>'
        + (opts.headerSub ? '<div style="font-size:11px;color:var(--t5);margin-top:2px">' + esc(opts.headerSub) + '</div>' : '')
        + '</div>';
    }
    var body = '';
    if (Array.isArray(parsedPane)) {
      // 둘 다 모드: 각 페인을 헤더 함께 출력
      parsedPane.forEach(function (p, i) {
        body += (i > 0 ? '<div style="margin:10px 0;border-top:1px dashed var(--bd)"></div>' : '')
          + (p.label ? '<div style="font-size:12px;font-weight:700;color:var(--ac);margin-bottom:6px">' + esc(p.label) + '</div>' : '')
          + buildPreviewHTML(p.parsed);
      });
    } else {
      body = buildPreviewHTML(parsedPane);
    }
    return ''
      + '<!DOCTYPE html>\n'
      + '<html lang="ko" data-theme="' + theme + '">\n'
      + '<head>\n'
      + '<meta charset="UTF-8">\n'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
      + '<title>' + esc(title) + '</title>\n'
      + '<style>\n'
      + "@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css');\n"
      + themeRootCss(v) + '\n'
      + 'html,body{margin:0;padding:0;background:var(--bg);color:var(--t2);font-family:"Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR","Malgun Gothic",sans-serif;font-size:13px;line-height:1.6;-webkit-font-smoothing:antialiased}\n'
      + 'body{padding:10px;box-sizing:border-box}\n'
      + 'code{font-family:ui-monospace,Consolas,monospace;background:var(--bg-i);padding:1px 5px;border-radius:3px;font-size:11.5px}\n'
      + 'strong{font-weight:700;color:var(--t2)}\n'
      + 'svg{display:inline-block;vertical-align:middle}\n'
      + '</style>\n'
      + '</head>\n'
      + '<body>\n'
      + headerHtml
      + body
      + '\n</body>\n</html>';
  }

  // 프리뷰 HTML의 var(--xxx)를 실제 색상값으로 치환 — 외부 페이지 임베드용
  function inlineThemeVars(html, theme) {
    var v = THEME_VARS[theme === 'dark' ? 'dark' : 'light'];
    Object.keys(CSS_VARS).forEach(function (n) {
      html = html.replace(new RegExp('var\\(' + n + '\\)', 'g'), v[CSS_VARS[n]]);
    });
    return html;
  }

  // ── 미리보기 렌더 헬퍼 (buildPreviewHTML 구성요소) ──
  var ICON_SLOT = 12; // 상태 아이콘 고정 슬롯(px) — 이름/세부 시작 위치 정렬

  // 상태 아이콘(도형): 예정=파랑 빈 원, 진행중=빨간 원, 완료=녹색 체크. 3종 동일 크기 원
  function statusIcon(st) {
    var base = 'display:inline-flex;align-items:center;justify-content:center;width:' + ICON_PX + 'px;height:' + ICON_PX + 'px;border-radius:50%;box-sizing:border-box';
    if (st === 'done') return '<span style="' + base + ';background:' + STATUS_COLORS.done + '"><svg width="7" height="5.5" viewBox="0 0 9 7"><path d="M1 3.5L3.5 6L8 1" stroke="white" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>';
    if (st === 'in_progress') return '<span style="' + base + ';background:' + STATUS_COLORS.in_progress + '"></span>';
    if (st === 'planned') return '<span style="' + base + ';border:2px solid ' + STATUS_COLORS.planned + '"></span>';
    return '';
  }
  // 상태/마커를 고정폭 슬롯에 담아 뒤 텍스트 시작 위치를 통일
  function iconSlot(inner) {
    return '<span style="flex-shrink:0;width:' + ICON_SLOT + 'px;display:inline-flex;align-items:center;justify-content:flex-start">' + inner + '</span>';
  }
  // 완료율: 세로 바(아래→위로 채움) + % 숫자. 구간별 히트색으로 대비 강화
  function pctBadge(pct) {
    if (pct === null) return '';
    var heat = heatColor(pct);
    return '<span style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0">'
      + '<span style="width:5px;height:15px;background:var(--bd);border-radius:2px;overflow:hidden;display:inline-flex;align-items:flex-end"><span style="display:block;width:100%;height:' + pct + '%;background:' + heat + '"></span></span>'
      + '<span style="font-size:11.5px;font-weight:800;font-family:ui-monospace,monospace;color:' + heat + '">' + pct + '%</span>'
      + '</span>';
  }
  // 우측 메타 3열(날짜·진행률·D-day) 고정폭 — 행 간 오와열 정렬. 하나라도 있으면 3열 모두 예약
  // 실측 기준 최소 폭(+여유 2px): 날짜 '~09/15' 38px · 진행률 '100%'+바 37px · D-day 'D-365'/'D+123' 43px.
  // 이보다 좁히면 날짜가 두 줄로 접혀 행 높이가 튄다.
  var META_W = { date: 40, pct: 40, dday: 44, gap: 4 };
  function metaCols(it, pct) {
    if (!it.deadline && pct === null) return '';
    var dateCell = '<span style="width:' + META_W.date + 'px;flex-shrink:0;text-align:right;font-size:10.5px;color:var(--t5);font-family:ui-monospace,monospace;white-space:nowrap">' + (it.deadline ? esc(it.deadline) : '') + '</span>';
    var pctCell = '<span style="width:' + META_W.pct + 'px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:flex-end">' + pctBadge(pct) + '</span>';
    var ddayCell = '<span style="width:' + META_W.dday + 'px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:flex-end">' + (it.deadline ? ddayBadge(it.deadline) : '') + '</span>';
    return '<span style="display:inline-flex;align-items:center;gap:' + META_W.gap + 'px;flex-shrink:0">' + dateCell + pctCell + ddayCell + '</span>';
  }
  // 세부 한 줄: 앞에 고정폭 슬롯(상태 아이콘/└), 텍스트 말줄임.
  // 기본 도형(무태그=항목 상태, 없으면 예정)은 첫 줄뿐 아니라 모든 세부 줄에 적용.
  // 하위 줄(└ ↳ → 또는 4칸 이상 들여쓰기)만 계층 마커 └ 로 표시 — 자체 태그가 있으면 그 도형 우선.
  function renderDetail(d, di, itemStatus) {
    var dText = String(d.text || '').replace(/@[^\s@]+/g, '').replace(/#완료/g, '').replace(/#진행중?/g, '').trim();
    var own = (d.status && d.status !== 'none') ? d.status : null;
    var lineSt = own || (d.sub ? 'none' : (itemStatus === 'none' ? 'planned' : itemStatus));
    var inner = statusIcon(lineSt) || '<span style="color:var(--t6)">└</span>';
    return '<div style="display:flex;align-items:center;gap:5px;font-size:13px;color:var(--t2);line-height:1.45;padding:0 0 0 ' + (d.sub ? '14' : '2') + 'px">'
      + iconSlot(inner)
      + '<span style="flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word" title="' + esc(dText) + '">' + inlineMarkup(dText) + '</span>'
      + '</div>';
  }
  // 섹션 헤더: 번호 배지 + 라벨
  function renderSectionHeader(sec) {
    var cl = secOf(sec.type);
    return '<div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">'
      + '<span style="background:' + cl.main + ';color:#fff;font-weight:800;font-size:10px;padding:2px 6px;border-radius:4px;font-family:ui-monospace,monospace">' + cl.num + '</span>'
      + '<span style="font-size:13px;font-weight:800;color:var(--t2)">' + esc(secLabel(sec.type)) + '</span>'
      + '</div>';
  }
  // 항목 한 줄: [사이트] 이름 … 기한 · 진행바% · D-day (+ 세부). 담당자는 배지 hover 툴팁
  function renderItemRow(it, cl, uniformSiteW) {
    var pct = (typeof it.pct === 'number' && it.pct >= 0) ? it.pct : null;
    var memberTip = (it.members || []).map(function (m) { return '@' + m; }).join(', ');
    var hasDetails = !!(it.details && it.details.length);
    var detailsHtml = hasDetails ? it.details.map(function (d, di) { return renderDetail(d, di, it.status); }).join('') : '';
    // 사이트 배지 폭을 전 섹션 최대치로 통일 → 모든 항목 이름 시작 위치 정렬(시인성)
    var badgeStyle = 'background:' + cl.bg + ';color:' + cl.main + ';font-size:13px;font-weight:800;padding:1px 6px;border-radius:4px;flex-shrink:0';
    if (uniformSiteW) badgeStyle += ';box-sizing:border-box;width:' + uniformSiteW + 'px;text-align:left;white-space:nowrap;overflow:hidden';
    // 기한(=D-day)이 박힌 항목은 제목을 굵게 — 날짜가 걸린 일이 목록에서 먼저 눈에 띄도록.
    // deadline 은 파서가 항목에만 붙인다(세부 줄에는 없음) → 항목 제목만 대상.
    var titleWeight = it.deadline ? '700' : '400';
    return '<div style="background:var(--bg-p);border:1px solid var(--bd);border-left:3px solid ' + cl.main + ';border-radius:4px;padding:3px 8px;margin-bottom:2px">'
      + '<div style="display:flex;align-items:center;gap:6px;min-width:0">'
      +   '<span style="' + badgeStyle + ';cursor:default"' + (memberTip ? ' title="담당자: ' + esc(memberTip) + '"' : '') + '>' + esc(it.client || '') + '</span>'
      +   (hasDetails ? '' : iconSlot(statusIcon(it.status === 'none' ? 'planned' : it.status)))
      +   '<span style="font-size:13px;font-weight:' + titleWeight + ';color:var(--t2);line-height:1.35;flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word" title="' + esc(it.name || '') + '">' + inlineMarkup(it.name || '') + '</span>'
      +   metaCols(it, pct)
      + '</div>'
      + detailsHtml
      + '</div>';
  }
  // 사이트명 표시 폭 근사(배지 폰트 13px/800 기준 — 한글/전각 ≈ 13px, 그 외 ≈ 8px) — 배지 폭 통일용
  function siteWidth(s) {
    var w = 0; s = String(s || '');
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      w += ((c >= 0x1100 && c <= 0x11FF) || (c >= 0x2E80 && c <= 0xD7A3) || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFF00 && c <= 0xFFEF)) ? 13 : 8;
    }
    return w;
  }

  // 파싱된 sections/items 배열을 보기용 HTML로 빌드
  function buildPreviewHTML(parsedPane) {
    if (!parsedPane || !parsedPane.sections || !parsedPane.sections.length) {
      return '<div style="padding:24px;text-align:center;color:var(--t5)">내용 없음</div>';
    }
    // 전 섹션에서 사이트명 최대 폭 → 배지 폭 통일(이름 시작 위치 정렬)
    var maxSiteW = 0;
    parsedPane.sections.forEach(function (sec) {
      (sec.items || []).forEach(function (it) { maxSiteW = Math.max(maxSiteW, siteWidth(it.client)); });
    });
    var uniformSiteW = maxSiteW ? Math.ceil(maxSiteW) + 14 : 0; // 좌우 패딩 12 + 여유 2
    return parsedPane.sections.map(function (sec) {
      var cl = secOf(sec.type);
      return '<div style="margin-bottom:9px">'
        + renderSectionHeader(sec)
        + (sec.items || []).map(function (it) { return renderItemRow(it, cl, uniformSiteW); }).join('')
        + '</div>';
    }).join('');
  }

  function shell() {
    return ''
      + '<div style="margin-bottom:14px">'
      +   '<h2 style="margin:0 0 4px;font-size:18px">📅 주간 업무 보고</h2>'
      +   '<p class="sub" style="margin:0;font-size:12px;color:var(--t5)">JSON을 누적 적재하여 검색·통계로 활용합니다 (관리자 전용)</p>'
      + '</div>'
      + '<div class="tabs sub-tabs" id="wrSubTabs" role="tablist" style="margin-bottom:14px">'
      +   '<button class="tab on" data-wt="author" role="tab">✍️ 작성</button>'
      +   '<button class="tab" data-wt="search" role="tab">🔍 검색</button>'
      +   '<button class="tab" data-wt="stats" role="tab">📊 통계</button>'
      +   '<button class="tab" data-wt="list" role="tab">🗂️ 목록</button>'
      +   '<button class="tab" data-wt="upload" role="tab">📤 업로드</button>'
      + '</div>'
      + '<div id="wrPanel"></div>';
  }

  function renderWeeklyReportPage() {
    var root = $('mWeeklyReport');
    if (!root) return;
    if (!root.dataset.init) {
      root.innerHTML = shell();
      root.dataset.init = '1';
      var bar = $('wrSubTabs');
      bar.querySelectorAll('.tab').forEach(function (t) {
        t.addEventListener('click', function () { setTab(t.dataset.wt); });
      });
    }
    setTab(STATE.tab);
  }
  window.renderWeeklyReportPage = renderWeeklyReportPage;

  function setTab(name) {
    STATE.tab = name;
    var bar = $('wrSubTabs'); if (!bar) return;
    bar.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('on', t.dataset.wt === name);
      t.setAttribute('aria-selected', t.dataset.wt === name);
    });
    // 작성 탭은 편집·미리보기·업무일지 패널이 나란히 서므로 1400px 캡을 풀어 창 너비를 다 쓴다
    if (typeof _applyWideMode === 'function') _applyWideMode(name === 'author');
    if (name === 'author') renderAuthor();
    else if (name === 'upload') renderUpload();
    else if (name === 'search') renderSearch();
    else if (name === 'stats') renderStats();
    else if (name === 'list') renderList();
  }

  /* ─── 업로드 ─── */
  function renderUpload() {
    $('wrPanel').innerHTML = ''
      + '<div id="wrDrop" style="border:2px dashed var(--bd);border-radius:10px;padding:32px;text-align:center;cursor:pointer;color:var(--t5);transition:all .15s">'
      +   '<div style="font-size:36px;margin-bottom:8px">📄</div>'
      +   '<div style="font-weight:700;color:var(--t2);margin-bottom:4px">JSON 파일을 드롭하거나 클릭하여 선택</div>'
      +   '<div style="font-size:12px">여러 개 동시 선택 가능 · 같은 이름이면 덮어씀</div>'
      +   '<input id="wrFileInput" type="file" accept=".json,application/json" multiple style="display:none">'
      + '</div>'
      + '<div id="wrUploadResult" style="margin-top:14px"></div>';

    var dz = $('wrDrop');
    var fi = $('wrFileInput');
    dz.addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function (e) { handleFiles(e.target.files); fi.value = ''; });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.style.borderColor = 'var(--ac)'; dz.style.background = 'var(--ac-bg)'; });
    dz.addEventListener('dragleave', function () { dz.style.borderColor = 'var(--bd)'; dz.style.background = ''; });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.style.borderColor = 'var(--bd)'; dz.style.background = '';
      handleFiles(e.dataTransfer.files);
    });
  }

  async function handleFiles(files) {
    if (!files || !files.length) return;
    var box = $('wrUploadResult');
    box.innerHTML = '<div style="color:var(--t5);font-size:12px">⏳ 업로드 중... ' + files.length + '개</div>';
    var ok = [], fail = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try {
        var text = await f.text();
        var json = JSON.parse(text);
        var r = await apiFetch('/api/weekly-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json)
        });
        ok.push({ file: f.name, saved: r.data && r.data[0] });
      } catch (e) {
        fail.push({ file: f.name, error: (e && e.message) || String(e) });
      }
    }
    var rows = ''
      + ok.map(function (r) {
          var wk = (r.saved && r.saved.week_label) || '-';
          return '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--bd)">' + esc(r.file) + '</td>'
            + '<td style="padding:6px 8px;border-bottom:1px solid var(--bd)">' + esc(wk) + '</td>'
            + '<td style="padding:6px 8px;border-bottom:1px solid var(--bd);color:#1a8a40">저장됨</td></tr>';
        }).join('')
      + fail.map(function (r) {
          return '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--bd)">' + esc(r.file) + '</td>'
            + '<td style="padding:6px 8px;border-bottom:1px solid var(--bd)">-</td>'
            + '<td style="padding:6px 8px;border-bottom:1px solid var(--bd);color:#d03030">실패: ' + esc(r.error) + '</td></tr>';
        }).join('');
    box.innerHTML = ''
      + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px">'
      +   '<div style="font-size:12px;margin-bottom:8px;color:var(--t3)">처리 결과 — 성공 ' + ok.length + ' / 실패 ' + fail.length + '</div>'
      +   '<table style="width:100%;border-collapse:collapse;font-size:12px">'
      +     '<thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);color:var(--t5);font-weight:600">파일</th>'
      +     '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);color:var(--t5);font-weight:600">주차</th>'
      +     '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);color:var(--t5);font-weight:600">상태</th></tr></thead>'
      +     '<tbody>' + rows + '</tbody>'
      +   '</table>'
      + '</div>';
    if (typeof showToast === 'function') {
      showToast('업로드 완료 — 성공 ' + ok.length + ' / 실패 ' + fail.length, fail.length ? 'warn' : 'ok');
    }
  }

  /* ─── 검색 ─── */
  function renderSearch() {
    $('wrPanel').innerHTML = ''
      + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px;margin-bottom:12px">'
      +   '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">'
      +     inputCell('wrSQ', 'text', '키워드 (이름/세부)')
      +     inputCell('wrSAssignee', 'text', '담당자 (예: 박종민)')
      +     inputCell('wrSClient', 'text', '사이트 (예: 디케이티)')
      +     selectCell('wrSStatus', [['','상태 전체'],['done','완료'],['in_progress','진행중'],['none','미표시']])
      +     selectCell('wrSSection', [['', '섹션 전체']].concat(SECTION_KEYS.map(function (k) { return [k, SECTIONS[k].label]; })))
      +     selectCell('wrSPane', [['cur','금주'],['last','지난주']])
      +     inputCell('wrSFrom', 'date', '')
      +     inputCell('wrSTo', 'date', '')
      +   '</div>'
      +   '<div style="margin-top:10px;display:flex;gap:8px;align-items:center">'
      +     '<button id="wrSearchBtn" class="tab on" style="padding:7px 18px">검색</button>'
      +     '<button id="wrSearchReset" class="tab" style="padding:7px 14px">초기화</button>'
      +     '<span id="wrSearchCount" style="font-size:12px;color:var(--t5)"></span>'
      +   '</div>'
      + '</div>'
      + '<div id="wrSearchResult"></div>';

    $('wrSearchBtn').addEventListener('click', runSearch);
    $('wrSearchReset').addEventListener('click', function () {
      ['wrSQ','wrSAssignee','wrSClient','wrSStatus','wrSSection','wrSFrom','wrSTo'].forEach(function (k) { var el = $(k); if (el) el.value = ''; });
      $('wrSPane').value = 'cur';
      $('wrSearchResult').innerHTML = '';
      $('wrSearchCount').textContent = '';
    });
    ['wrSQ','wrSAssignee','wrSClient'].forEach(function (k) {
      $(k).addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
    });
  }

  function inputCell(id, type, ph) {
    return '<input id="' + id + '" type="' + type + '" placeholder="' + esc(ph) + '" '
      + 'style="padding:7px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit">';
  }
  function selectCell(id, opts) {
    return '<select id="' + id + '" style="padding:7px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit">'
      + opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('')
      + '</select>';
  }

  async function runSearch() {
    var f = {
      q: $('wrSQ').value.trim(),
      assignee: $('wrSAssignee').value.trim(),
      client: $('wrSClient').value.trim(),
      status: $('wrSStatus').value,
      section: $('wrSSection').value,
      pane: $('wrSPane').value,
      from: $('wrSFrom').value,
      to: $('wrSTo').value
    };
    var qs = Object.keys(f).filter(function (k) { return f[k]; }).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(f[k]);
    }).join('&');
    var box = $('wrSearchResult');
    box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5)">⏳ 검색 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports/search?' + qs);
      var rows = r.data || [];
      $('wrSearchCount').textContent = rows.length + '건';
      if (!rows.length) {
        box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5);background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">결과 없음</div>';
        return;
      }
      var html = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;overflow:auto">'
        + '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        +   '<thead><tr>'
        +     th('주차') + th('섹션') + th('사이트') + th('업무') + th('D-day') + th('%') + th('담당자') + th('상태')
        +   '</tr></thead><tbody>'
        + rows.map(function (m) {
            var it = m.item || {};
            var details = (it.details || []).map(function (d) {
              return '<div style="color:var(--t5);font-size:11px;margin-top:2px">: ' + esc(d.text) + '</div>';
            }).join('');
            var members = (it.members || []).map(function (mm) {
              return '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;background:var(--bg-i);color:var(--t5);margin:1px 2px 1px 0">@' + esc(mm) + '</span>';
            }).join('');
            return '<tr>'
              + td('<div style="font-weight:600">' + esc(m.week_label || '-') + '</div><div style="font-size:10px;color:var(--t6)">' + esc(m.team || '') + '</div>')
              + td(esc(secLabel(it.section) || ''))
              + td('<strong>' + esc(it.client || '') + '</strong>')
              + td(esc(it.name || '') + details)
              + td(esc(it.deadline || ''))
              + td(it.pct >= 0 ? esc(it.pct + '%') : '')
              + td(members)
              + td(statusPill(it.status))
              + '</tr>';
          }).join('')
        + '</tbody></table></div>';
      box.innerHTML = html;
    } catch (e) {
      box.innerHTML = '<div style="padding:14px;color:#d03030;background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">검색 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  function th(t) { return '<th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:11px;color:var(--t5);font-weight:600;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap">' + t + '</th>'; }
  function td(html) { return '<td style="padding:8px 10px;border-bottom:1px solid var(--bd);vertical-align:top">' + html + '</td>'; }

  /* ─── 통계 ─── */
  function renderStats() {
    $('wrPanel').innerHTML = ''
      + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px;margin-bottom:12px">'
      +   '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      +     inputCell('wrStTeam', 'text', '팀 (예: 소프트웨어팀)')
      +     inputCell('wrStFrom', 'date', '')
      +     inputCell('wrStTo', 'date', '')
      +     '<button id="wrStatsBtn" class="tab on" style="padding:7px 18px">조회</button>'
      +   '</div>'
      + '</div>'
      + '<div id="wrStatsResult"></div>';
    $('wrStatsBtn').addEventListener('click', runStats);
    runStats();
  }

  async function runStats() {
    var f = { team: $('wrStTeam').value.trim(), from: $('wrStFrom').value, to: $('wrStTo').value };
    var qs = Object.keys(f).filter(function (k) { return f[k]; }).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(f[k]);
    }).join('&');
    var box = $('wrStatsResult');
    box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5)">⏳ 조회 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports/stats' + (qs ? '?' + qs : ''));
      var d = r.data;
      if (!d || !d.weekly || !d.weekly.length) {
        box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5);background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">데이터 없음 — 먼저 업로드 탭에서 JSON을 올려주세요</div>';
        return;
      }
      var totals = d.totals;
      var stHtml = ''
        + statCard('주차 수', totals.weeks)
        + statCard('총 항목', totals.items)
        + statCard('완료', totals.byStatus.done, '#1a8a40')
        + statCard('진행중', totals.byStatus.in_progress, '#d03030')
        + statCard('완료율', totals.completion_rate + '%');
      var weeklyRows = d.weekly.map(function (w) {
        return '<tr>'
          + td('<strong>' + esc(w.week_label || '-') + '</strong> <span style="color:var(--t6);font-size:11px">' + esc(w.week_start || '') + '</span>')
          + td(String(w.total))
          + td('<span style="color:#1a8a40">' + w.done + '</span>')
          + td('<span style="color:#d03030">' + w.in_progress + '</span>')
          + td('<div>' + w.completion_rate + '%</div><div style="height:5px;background:var(--bd);border-radius:3px;margin-top:4px;overflow:hidden"><div style="height:100%;width:' + w.completion_rate + '%;background:linear-gradient(90deg,var(--ac),#7aaade)"></div></div>')
          + td(w.avg_pct == null ? '-' : (w.avg_pct + '%'))
          + '</tr>';
      }).join('');
      var memHtml = (d.byMember || []).slice(0, 15).map(function (m) {
        return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px"><span>@' + esc(m.key) + '</span><span style="color:var(--t5)">' + m.count + '건</span></div>';
      }).join('');
      var cliHtml = (d.byClient || []).slice(0, 15).map(function (c) {
        return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px"><span>' + esc(c.key) + '</span><span style="color:var(--t5)">' + c.count + '건</span></div>';
      }).join('');
      box.innerHTML = ''
        + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">' + stHtml + '</div>'
        + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px;margin-bottom:12px">'
        +   '<div style="font-size:13px;font-weight:600;margin-bottom:10px">주차별 진행</div>'
        +   '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        +     '<thead><tr>' + th('주차') + th('총') + th('완료') + th('진행중') + th('완료율') + th('평균%') + '</tr></thead>'
        +     '<tbody>' + weeklyRows + '</tbody>'
        +   '</table>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">'
        +   '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px">'
        +     '<div style="font-size:13px;font-weight:600;margin-bottom:8px">담당자별 (상위 15)</div>' + memHtml
        +   '</div>'
        +   '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px">'
        +     '<div style="font-size:13px;font-weight:600;margin-bottom:8px">사이트별 (상위 15)</div>' + cliHtml
        +   '</div>'
        + '</div>';
    } catch (e) {
      box.innerHTML = '<div style="padding:14px;color:#d03030;background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">조회 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  function statCard(label, val, color) {
    return '<div style="flex:1 1 140px;background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px">'
      +   '<div style="font-size:11px;color:var(--t6);text-transform:uppercase;letter-spacing:.5px">' + esc(label) + '</div>'
      +   '<div style="font-size:22px;font-weight:700;margin-top:4px' + (color ? ';color:' + color : '') + '">' + esc(String(val)) + '</div>'
      + '</div>';
  }

  /* ─── 목록 ─── */
  async function renderList() {
    var box = $('wrPanel');
    box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5)">⏳ 불러오는 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports');
      var rows = r.data || [];
      if (!rows.length) {
        box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5);background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">업로드된 보고서가 없습니다</div>';
        return;
      }
      var bodyRows = rows.map(function (it) {
        var st = (it.stats && it.stats.cur) || {};
        var bs = st.byStatus || {};
        return '<tr>'
          + td('<strong>' + esc(it.week_label || '-') + '</strong>')
          + td(esc(it.team || '-'))
          + td('<span style="font-size:11px;color:var(--t5)">' + esc(it.name) + '</span>')
          + td(esc(it.week_start || '-') + ' ~ ' + esc(it.week_end || '-'))
          + td('<span style="color:#1a8a40">' + (bs.done || 0) + '</span> / <span style="color:#d03030">' + (bs.in_progress || 0) + '</span> / ' + (st.total || 0))
          + td('<span style="font-size:11px;color:var(--t6)">' + esc(it.saved_at ? new Date(it.saved_at).toLocaleString('ko-KR') : '-') + '</span>')
          + td('<button class="tab" data-prev="' + esc(it.id) + '" style="padding:4px 10px;font-size:11px;color:var(--ac);border:1px solid var(--ac);background:transparent;margin-right:4px">미리보기</button>'
              + '<button class="tab" data-del="' + esc(it.id) + '" style="padding:4px 10px;font-size:11px;color:#d03030;border:1px solid #d03030;background:transparent">삭제</button>')
          + '</tr>';
      }).join('');
      box.innerHTML = ''
        + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;overflow:auto">'
        +   '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        +     '<thead><tr>'
        +       th('주차') + th('팀') + th('이름') + th('기간') + th('완료/진행/총') + th('저장') + th('')
        +     '</tr></thead>'
        +     '<tbody>' + bodyRows + '</tbody>'
        +   '</table>'
        + '</div>';
      box.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () { deleteReport(b.dataset.del); });
      });
      box.querySelectorAll('[data-prev]').forEach(function (b) {
        b.addEventListener('click', function () { renderPreview(b.dataset.prev); });
      });
    } catch (e) {
      box.innerHTML = '<div style="padding:14px;color:#d03030;background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">조회 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  /* ─── 미리보기 ─── */
  var _previewState = { id: null, pane: 'cur', data: null };
  async function renderPreview(id) {
    var box = $('wrPanel');
    box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5)">⏳ 불러오는 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports/' + encodeURIComponent(id));
      _previewState.id = id;
      _previewState.data = r.data;
      _previewState.pane = 'cur';
      drawPreview();
    } catch (e) {
      box.innerHTML = '<div style="padding:14px;color:#d03030;background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">불러오기 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  function drawPreview() {
    var box = $('wrPanel');
    var d = _previewState.data;
    if (!d) return;
    var parsed = d.parsed || {};
    var pane = _previewState.pane;
    var paneData = parsed[pane];
    var meta = parsed.meta || {};
    box.innerHTML = ''
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
      +   '<button id="wrPrevBack" class="tab" style="padding:6px 12px">← 목록</button>'
      +   '<div style="flex:1">'
      +     '<div style="font-size:15px;font-weight:700">' + esc(meta.weekLabel || d.week_label || '-') + ' · ' + esc(meta.team || d.team || '') + '</div>'
      +     '<div style="font-size:11px;color:var(--t5)">' + esc(d.name) + ' · ' + esc(d.week_start || '') + ' ~ ' + esc(d.week_end || '') + '</div>'
      +   '</div>'
      +   '<div class="tabs sub-tabs" style="margin:0">'
      +     '<button class="tab' + (pane === 'last' ? ' on' : '') + '" data-pp="last">지난주</button>'
      +     '<button class="tab' + (pane === 'cur'  ? ' on' : '') + '" data-pp="cur">금주</button>'
      +   '</div>'
      + '</div>'
      + '<div id="wrPrevBody" style="background:var(--bg-i);border:1px solid var(--bd);border-radius:8px;padding:16px">'
      +   buildPreviewHTML(paneData)
      + '</div>';
    $('wrPrevBack').addEventListener('click', function () { renderList(); });
    box.querySelectorAll('[data-pp]').forEach(function (b) {
      b.addEventListener('click', function () { _previewState.pane = b.dataset.pp; drawPreview(); });
    });
  }

  async function deleteReport(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await apiFetch('/api/weekly-reports/' + encodeURIComponent(id), { method: 'DELETE' });
      if (typeof showToast === 'function') showToast('삭제됨', 'ok');
      renderList();
    } catch (e) {
      alert('삭제 실패: ' + (e.message || e));
    }
  }

  /* ═══════════════════════════════════════════════════════════
     작성 탭 — 편집기 + 라이브 프리뷰 + 팀관리 데이터 인서트
     ═══════════════════════════════════════════════════════════ */

  // 클라이언트 사이드 텍스트 파서 (서버와 동일 로직)
  function clientParseText(text) {
    var SEC_MAP = SECTION_ALIAS;
    if (!text) return { sections: [] };
    var sections = [], cur = null, item = null;
    var lines = text.split('\n');
    // 서버(weekly-report-parser.js)와 동일 로직 유지 — parity 테스트로 강제
    function detectStatus(t) {
      if (/#완료/.test(t)) return 'done';
      if (/#진행중?/.test(t)) return 'in_progress';
      if (/완료/.test(t)) return 'done'; // 태그 없는 '완료'도 완료로 (서버와 동일)
      return 'none';
    }
    function members(t) {
      return (t.match(/@([^\s@]+)/g) || []).map(function (s) { return s.slice(1); });
    }
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var line = raw.trim();
      if (!line) continue;
      var sm = line.match(/^\[([^\]]+)\]$/);
      if (sm) {
        var k = Object.keys(SEC_MAP).find(function (key) { return sm[1].indexOf(key) >= 0; });
        if (k) { cur = { type: SEC_MAP[k], label: sm[1], items: [] }; sections.push(cur); item = null; continue; }
      }
      if (!cur) continue;
      // 알 수 없는 [xxx] 단독 줄(섹션 오타 등)은 항목으로 오인하지 않고 건너뜀
      if (sm) continue;
      var im = line.match(ITEM_LINE_RE);
      if (im) {
        var rest = im[2].trim();
        var dm = rest.match(/(~\d{2}\/\d{2})/);
        var pm = rest.match(/(\d+)%/) || rest.match(/#%(\d+)/);
        // 상태 태그(#완료/#진행중)는 이름에서 제거 — 상태는 줄 끝 배지로 항상 표시하고,
        // 이름이 말줄임될 때 태그가 잘려 사라지는 것을 방지
        var name = rest.replace(/@[^\s@]+/g, '').replace(/(~\d{2}\/\d{2})/g, '').replace(/\d+%/g, '').replace(/#%\d+/g, '').replace(/#완료/g, '').replace(/#진행중?/g, '').replace(/\s+/g, ' ').trim();
        item = {
          section: cur.type,
          client: im[1].trim(),
          name: name,
          deadline: dm ? dm[1] : '',
          pct: pm ? parseInt(pm[1], 10) : -1,
          members: members(rest),
          status: detectStatus(rest),
          details: []
        };
        cur.items.push(item);
        continue;
      }
      if (item) {
        // 세부 줄: 도형(:, -., -, ·, •, ○, └ …) 또는 들여쓴 맨텍스트 모두 허용
        var dmk = line.match(DETAIL_LINE_RE);
        var dt = dmk ? dmk[1].trim() : (/^\s/.test(raw) ? line : null);
        if (dt) {
          var dMembers = members(dt);
          item.details.push({ text: dt, members: dMembers, status: detectStatus(dt), sub: isSubLine(raw, line) });
          dMembers.forEach(function (m) { if (item.members.indexOf(m) < 0) item.members.push(m); });
        }
      }
    }
    sections.forEach(function (sec) {
      sec.items.forEach(function (it) {
        if (it.status === 'none' && it.details.length) {
          var hasDone = it.details.some(function (x) { return x.status === 'done'; });
          var hasProg = it.details.some(function (x) { return x.status === 'in_progress'; });
          if (hasDone && !hasProg) it.status = 'done';
          else if (hasProg) it.status = 'in_progress';
        }
      });
    });
    return { sections: sections };
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var LS_SHOW_PV = 'wr-author-show-pv';
  var LS_SRC_WIDTH = 'wr-src-width';
  var LS_SRC_COLLAPSED = 'wr-src-collapsed';
  var SRC_W_DEFAULT = 440, SRC_W_MIN = 320, SRC_W_MAX = 960;
  function clampSrcWidth(w) { return Math.max(SRC_W_MIN, Math.min(SRC_W_MAX, w || SRC_W_DEFAULT)); }

  // 작성 탭 상태
  var _authorState = {
    team: '',
    weekStart: '',
    weekEnd: '',
    lastText: '',
    curText: '',
    editPane: 'cur',
    previewPane: 'cur',
    viewMode: 'compare', // 'compare' = 지난주+금주 동시, 'single' = 토글
    loadedId: null,
    loadedName: '',
    showPreview: lsGet(LS_SHOW_PV) !== '0',
    workRecords: [],
    workRecordsKey: '',
    // 우측 업무일지 패널 — 지난주 업무를 팀/팀원으로 골라 요약·삽입
    src: {
      range: 'prev',        // prev = 작성 주차의 전주 · cur = 작성 주차 · custom
      start: '', end: '',   // custom 일 때만 사용
      groupId: null,        // null = 아직 안 정함(작성 팀명과 같은 그룹 자동 선택) · '' = 전체
      members: null,        // null = 팀 전원 · [이름…] = 고른 팀원만
      q: '',
      view: 'summary',      // summary | raw
      sumBy: 'order',       // order = 수주별(보고서 형태) · person = 담당자별
      rawBy: 'name',        // name | oclient | date | none
      target: 'last',       // 삽입할 편집창
      collapsed: lsGet(LS_SRC_COLLAPSED) === '1',
      width: clampSrcWidth(parseInt(lsGet(LS_SRC_WIDTH), 10)),
      aiText: '', aiBusy: false
    }
  };

  function defaultWeekRange() {
    var now = new Date();
    var day = now.getDay();
    var diffToMon = (day === 0 ? -6 : 1 - day);
    var mon = new Date(now); mon.setDate(now.getDate() + diffToMon);
    var fri = new Date(mon); fri.setDate(mon.getDate() + 4);
    function toIso(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    return { start: toIso(mon), end: toIso(fri) };
  }

  function renderAuthor() {
    if (!_authorState.weekStart) {
      var d = defaultWeekRange();
      _authorState.weekStart = d.start;
      _authorState.weekEnd = d.end;
    }
    var box = $('wrPanel');
    box.innerHTML = ''
      + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px;margin-bottom:10px">'
      +   '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      +     '<label style="font-size:11px;color:var(--t5)">팀</label>'
      +     '<input id="wrAuTeam" type="text" placeholder="소프트웨어팀" value="' + esc(_authorState.team) + '" style="padding:6px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit;width:140px">'
      +     '<label style="font-size:11px;color:var(--t5);margin-left:6px">주차</label>'
      +     '<input id="wrAuStart" type="date" value="' + esc(_authorState.weekStart) + '" style="padding:6px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit">'
      +     '<span style="color:var(--t6)">~</span>'
      +     '<input id="wrAuEnd" type="date" value="' + esc(_authorState.weekEnd) + '" style="padding:6px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit">'
      +     '<button id="wrAuLoadList" class="tab" style="padding:6px 12px">📂 불러오기</button>'
      +     '<button id="wrAuLoadPrev" class="tab" style="padding:6px 12px" title="가장 최근 주의 curText를 lastText로 복사">⬅ 지난주에서 가져오기</button>'
      +     '<button id="wrAuNew" class="tab" style="padding:6px 12px">📋 새로 만들기</button>'
      +     '<div class="tabs sub-tabs" style="margin:0 0 0 8px" title="뷰 모드">'
      +       '<button class="tab' + (_authorState.viewMode === 'compare' ? ' on' : '') + '" data-vm="compare">비교</button>'
      +       '<button class="tab' + (_authorState.viewMode === 'single'  ? ' on' : '') + '" data-vm="single">단일</button>'
      +     '</div>'
      +     '<button id="wrAuPvToggle" class="tab' + (_authorState.showPreview ? ' on' : '') + '" style="padding:6px 10px" title="미리보기를 숨기면 편집창이 전체 폭을 씁니다">👁 미리보기</button>'
      +     '<div style="flex:1"></div>'
      +     '<span id="wrAuStatusBadge" style="font-size:11px;color:var(--t5)"></span>'
      +     '<button id="wrAuExport" class="tab" style="padding:6px 12px" title="iframe 임베드용 HTML 복사/다운로드">📋 HTML</button>'
      +     '<button id="wrAuSave" class="tab on" style="padding:6px 14px">💾 저장 (R+1)</button>'
      +     '<button id="wrAuOverwrite" class="tab" style="padding:6px 12px;display:none">💾 덮어쓰기</button>'
      +   '</div>'
      +   '<div id="wrAuExportPanel" style="display:none;margin-top:8px;padding:10px;background:var(--bg-i);border:1px solid var(--bd);border-radius:6px"></div>'
      +   '<div id="wrAuLoadDropdown" style="display:none;margin-top:8px"></div>'
      + '</div>'
      + '<div id="wrAuWork" class="wr-au-work' + (_authorState.src.collapsed ? ' src-off' : '') + '" style="--wr-src-w:' + _authorState.src.width + 'px">'
      +   '<div id="wrAuEditArea" class="wr-au-edit">' + (_authorState.viewMode === 'compare' ? renderAuthorCompare() : renderAuthorSingle()) + '</div>'
      +   '<div id="wrSrcResizer" class="wr-src-resizer" title="드래그: 패널 폭 조절 · 더블클릭: 기본 폭"></div>'
      +   '<aside id="wrSrc" class="wr-src">' + renderSrcShell() + '</aside>'
      + '</div>';

    applyResponsiveAuthor();

    $('wrAuTeam').addEventListener('input', function (e) { _authorState.team = e.target.value.trim(); });
    $('wrAuStart').addEventListener('change', function (e) { _authorState.weekStart = e.target.value; loadWorkRecords(); });
    $('wrAuEnd').addEventListener('change', function (e) { _authorState.weekEnd = e.target.value; loadWorkRecords(); });

    box.querySelectorAll('[data-vm]').forEach(function (b) {
      b.addEventListener('click', function () { syncAuthorEditorsToState(); _authorState.viewMode = b.dataset.vm; renderAuthor(); });
    });
    box.querySelectorAll('[data-ep]').forEach(function (b) {
      b.addEventListener('click', function () {
        syncAuthorEditorsToState();
        _authorState.editPane = b.dataset.ep;
        renderAuthor();
      });
    });
    box.querySelectorAll('[data-pv]').forEach(function (b) {
      b.addEventListener('click', function () { _authorState.previewPane = b.dataset.pv; renderAuthor(); });
    });
    box.querySelectorAll('[data-pv-copy]').forEach(function (b) {
      b.addEventListener('click', function () { copyPreviewInner(b.dataset.pvCopy, b.dataset.pvTheme); });
    });

    bindAuthorEditor('wrAuEditorLast', 'last');
    bindAuthorEditor('wrAuEditorCur', 'cur');
    bindAuthorEditor('wrAuEditor', _authorState.editPane);

    box.querySelectorAll('[data-insert]').forEach(function (b) {
      b.addEventListener('click', function () {
        var targetId = b.dataset.target || pickInsertTarget();
        insertAtCursor(targetId, b.dataset.insert);
      });
    });

    $('wrAuNew').addEventListener('click', authorNew);
    $('wrAuLoadList').addEventListener('click', toggleLoadDropdown);
    $('wrAuLoadPrev').addEventListener('click', authorLoadFromPrevWeek);
    $('wrAuExport').addEventListener('click', toggleExportPanel);
    $('wrAuSave').addEventListener('click', function () { saveAuthor(true); });
    $('wrAuOverwrite').addEventListener('click', function () { saveAuthor(false); });

    var pvT = $('wrAuPvToggle');
    if (pvT) pvT.addEventListener('click', function () {
      syncAuthorEditorsToState();
      _authorState.showPreview = !_authorState.showPreview;
      lsSet(LS_SHOW_PV, _authorState.showPreview ? '1' : '0');
      renderAuthor();
    });

    bindSrcPanel();

    updateAuthorPreview();
    updateAuthorStatusBadge();
    autoLoadIfEmpty();
    var rg = srcRange();
    if (rg.start && rg.end && _authorState.workRecordsKey !== rg.start + '~' + rg.end) loadWorkRecords();
    else renderSrcDynamic();
  }

  // 편집|미리보기 2열은 창 너비가 아니라 "편집 영역" 너비로 판단 — 사이드 패널 폭을 바꿔도 맞춰진다
  function applyResponsiveAuthor() {
    function check() {
      var area = $('wrAuEditArea');
      var w = area ? area.getBoundingClientRect().width : window.innerWidth;
      var two = _authorState.showPreview && w >= 760;
      ['wrAuMain', 'wrAuMainLast', 'wrAuMainCur'].forEach(function (id) {
        var m = $(id); if (m) m.style.gridTemplateColumns = two ? '1fr 1fr' : '1fr';
      });
    }
    check();
    if (!window._wrAuRz) {
      window.addEventListener('resize', function () { if (window._wrAuCheckCols) window._wrAuCheckCols(); });
      window._wrAuRz = true;
    }
    window._wrAuCheckCols = check;
  }

  function authorToolbar(targetId) {
    var t = targetId ? ' data-target="' + targetId + '"' : '';
    function btn(label, insert, title) {
      return '<button class="tab"' + t + ' data-insert="' + esc(insert) + '" title="' + esc(title || '') + '" style="padding:4px 8px;font-size:11px">' + esc(label) + '</button>';
    }
    return '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">'
      + btn('[개발]', '\n[개발]\n')
      + btn('[셋업]', '\n[셋업]\n')
      + btn('[C/S]', '\n[C/S]\n')
      + btn('[기타]', '\n[기타]\n')
      + '<span style="width:8px"></span>'
      + btn('- 항목', '- [사이트] 업무명 ~MM/DD 50% @담당자\n')
      + btn(': 세부', '  : ')
      + '<span style="width:8px"></span>'
      + btn('#완료', ' #완료 ')
      + btn('#진행중', ' #진행중 ')
      + btn('#%50', ' #%50 ')
      + '<span style="width:8px"></span>'
      + btn('{굵게}', '{}')
      + btn('=y{형광}', '=y{}')
      + '</div>';
  }

  // 비교 뷰: 위(지난주) / 아래(금주) 2행 × (편집 | 프리뷰) 2열
  function renderAuthorCompare() {
    function row(key, title) {
      var edId = 'wrAuEditor' + (key === 'last' ? 'Last' : 'Cur');
      var pvId = 'wrAuPreview' + (key === 'last' ? 'Last' : 'Cur');
      var color = key === 'last' ? '#506070' : 'var(--ac)';
      return '<div id="wrAuMain' + (key === 'last' ? 'Last' : 'Cur') + '" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'
        + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-left:3px solid ' + color + ';border-radius:8px;padding:10px;display:flex;flex-direction:column;min-height:340px">'
        +   '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
        +     '<span style="font-size:11px;font-weight:700;color:' + color + ';background:rgba(58,106,176,.08);padding:2px 8px;border-radius:4px">' + title + '</span>'
        +     '<div style="font-size:11px;color:var(--t5)">✏️ 편집</div>'
        +   '</div>'
        +   authorToolbar(edId)
        +   '<textarea id="' + edId + '" data-pane="' + key + '" spellcheck="false" placeholder="[개발]\n- [사이트] 업무명 ~MM/DD 50% @담당자\n  : 세부내용 #진행중\n..." style="flex:1;width:100%;min-height:240px;padding:10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12.5px;font-family:ui-monospace,Consolas,monospace;line-height:1.6;resize:vertical"></textarea>'
        + '</div>'
        + (!_authorState.showPreview ? '' : '<div style="background:var(--bg-p);border:1px solid var(--bd);border-left:3px solid ' + color + ';border-radius:8px;padding:10px;min-height:340px">'
        +   '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
        +     '<span style="font-size:11px;font-weight:700;color:' + color + ';background:rgba(58,106,176,.08);padding:2px 8px;border-radius:4px">' + title + '</span>'
        +     '<div style="font-size:11px;color:var(--t5)">👁 미리보기</div>'
        +     previewCopyButtons(key)
        +   '</div>'
        +   '<div id="' + pvId + '" style="background:var(--bg-i);border:1px solid var(--bd);border-radius:6px;padding:12px;min-height:260px;max-height:560px;overflow:auto"></div>'
        + '</div>')
        + '</div>';
    }
    return row('last', '지난주') + row('cur', '금주')
      + '<div style="font-size:10.5px;color:var(--t6);margin:-4px 0 8px;line-height:1.5">'
      +   '섹션: <code>[개발][셋업][C/S][기타]</code> · 항목: <code>- [사이트] 이름 ~MM/DD 50% @담당자</code> · 세부: <code>: 세부내용</code> · 태그: <code>#완료 #진행중 #%70 {bold} =y{형광}</code>'
      + '</div>';
  }

  // 단일 뷰: 좌(편집) | 우(프리뷰), 각자 토글
  function renderAuthorSingle() {
    return '<div id="wrAuMain" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'
      + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:10px;display:flex;flex-direction:column;min-height:480px">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
      +     '<div style="font-size:12px;font-weight:600;color:var(--t3)">✏️ 편집</div>'
      +     '<div class="tabs sub-tabs" style="margin:0">'
      +       '<button class="tab' + (_authorState.editPane === 'last' ? ' on' : '') + '" data-ep="last">지난주</button>'
      +       '<button class="tab' + (_authorState.editPane === 'cur'  ? ' on' : '') + '" data-ep="cur">금주</button>'
      +     '</div>'
      +   '</div>'
      +   authorToolbar('wrAuEditor')
      +   '<textarea id="wrAuEditor" data-pane="' + _authorState.editPane + '" spellcheck="false" placeholder="[개발]\n- [사이트] 업무명 ~MM/DD 50% @담당자\n..." style="flex:1;width:100%;min-height:380px;padding:10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12.5px;font-family:ui-monospace,Consolas,monospace;line-height:1.6;resize:vertical"></textarea>'
      +   '<div style="font-size:10.5px;color:var(--t6);margin-top:6px;line-height:1.5">'
      +     '섹션: <code>[개발][셋업][C/S][기타]</code> · 항목: <code>- [사이트] 이름 ~MM/DD 50% @담당자</code> · 태그: <code>#완료 #진행중 #%70 {bold} =y{형광}</code>'
      +   '</div>'
      + '</div>'
      + (!_authorState.showPreview ? '' : '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:10px;min-height:480px">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:6px;flex-wrap:wrap">'
      +     '<div style="font-size:12px;font-weight:600;color:var(--t3)">👁 미리보기</div>'
      +     '<div style="display:flex;align-items:center;gap:6px">'
      +       previewCopyButtons(_authorState.previewPane)
      +       '<div class="tabs sub-tabs" style="margin:0">'
      +         '<button class="tab' + (_authorState.previewPane === 'last' ? ' on' : '') + '" data-pv="last">지난주</button>'
      +         '<button class="tab' + (_authorState.previewPane === 'cur'  ? ' on' : '') + '" data-pv="cur">금주</button>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div id="wrAuPreview" style="background:var(--bg-i);border:1px solid var(--bd);border-radius:6px;padding:12px;min-height:380px;overflow:auto"></div>'
      + '</div>')
      + '</div>';
  }

  // 프리뷰 헤더에 들어가는 인라인 복사 버튼 (라이트/다크)
  function previewCopyButtons(paneKey) {
    return '<button class="tab" data-pv-copy="' + paneKey + '" data-pv-theme="light" title="라이트 테마 HTML 내용 복사" style="padding:3px 8px;font-size:10.5px">📋 라이트</button>'
      + '<button class="tab" data-pv-copy="' + paneKey + '" data-pv-theme="dark" title="다크 테마 HTML 내용 복사" style="padding:3px 8px;font-size:10.5px">📋 다크</button>';
  }

  async function copyPreviewInner(paneKey, theme) {
    syncAuthorEditorsToState();
    var text = paneKey === 'last' ? _authorState.lastText : _authorState.curText;
    if (!text || !text.trim()) {
      alert('내용이 없습니다.');
      return;
    }
    var raw = buildPreviewHTML(clientParseText(text));
    var html = inlineThemeVars(raw, theme);
    try {
      await navigator.clipboard.writeText(html);
      if (typeof showToast === 'function') showToast('미리보기 HTML 복사됨 (' + (paneKey === 'last' ? '지난주' : '금주') + ' · ' + theme + ')', 'ok');
    } catch (e) {
      alert('복사 실패: ' + (e.message || e));
    }
  }

  // 모든 textarea 값을 state로 동기화 (모드 전환/탭 클릭 전 호출)
  function syncAuthorEditorsToState() {
    var elL = $('wrAuEditorLast'); if (elL) _authorState.lastText = elL.value;
    var elC = $('wrAuEditorCur'); if (elC) _authorState.curText = elC.value;
    var ed = $('wrAuEditor'); if (ed) {
      var p = ed.dataset.pane || _authorState.editPane;
      _authorState[p === 'last' ? 'lastText' : 'curText'] = ed.value;
    }
  }

  // 단일 뷰에서 툴바 버튼이 어느 textarea에 삽입할지 (단일 textarea면 그것, 비교 모드면 마지막 포커스/금주)
  function pickInsertTarget() {
    if (_authorState.viewMode === 'single') return 'wrAuEditor';
    return _authorState.editPane === 'last' ? 'wrAuEditorLast' : 'wrAuEditorCur';
  }

  // 한 textarea에 입력/단축키/디바운스 프리뷰 바인딩
  function bindAuthorEditor(id, paneKey) {
    var ed = $(id);
    if (!ed) return;
    if (id === 'wrAuEditor') ed.value = _authorState.editPane === 'last' ? _authorState.lastText : _authorState.curText;
    else ed.value = paneKey === 'last' ? _authorState.lastText : _authorState.curText;
    var debounceT = null;
    ed.addEventListener('input', function () {
      var p = ed.dataset.pane || paneKey;
      _authorState[p === 'last' ? 'lastText' : 'curText'] = ed.value;
      _authorState.editPane = p; // 마지막 편집 페인 추적 (툴바 타겟 추정용)
      clearTimeout(debounceT);
      debounceT = setTimeout(function () { updateAuthorPreview(p); }, 200);
    });
    ed.addEventListener('focus', function () {
      var p = ed.dataset.pane || paneKey;
      _authorState.editPane = p;
    });
    ed.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveAuthor(false); }
    });
  }

  function insertAtCursor(taId, text) {
    var ta = $(taId);
    if (!ta) return;
    var s = ta.selectionStart, e = ta.selectionEnd;
    var v = ta.value;
    ta.value = v.slice(0, s) + text + v.slice(e);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = s + text.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function updateAuthorPreview(paneKey) {
    function fillOne(pvId, text) {
      var pv = $(pvId);
      if (!pv) return;
      if (!text || !text.trim()) {
        pv.innerHTML = '<div style="color:var(--t6);text-align:center;padding:32px">내용을 입력하면 여기에 미리보기가 표시됩니다</div>';
      } else {
        pv.innerHTML = buildPreviewHTML(clientParseText(text));
      }
    }
    if (_authorState.viewMode === 'compare') {
      if (!paneKey || paneKey === 'last') fillOne('wrAuPreviewLast', _authorState.lastText);
      if (!paneKey || paneKey === 'cur')  fillOne('wrAuPreviewCur',  _authorState.curText);
    } else {
      var text = _authorState.previewPane === 'last' ? _authorState.lastText : _authorState.curText;
      fillOne('wrAuPreview', text);
    }
  }

  function updateAuthorStatusBadge() {
    var el = $('wrAuStatusBadge');
    if (!el) return;
    if (_authorState.loadedId) {
      el.innerHTML = '✏️ 편집 중: <strong style="color:var(--t3)">' + esc(_authorState.loadedName) + '</strong>';
      var ow = $('wrAuOverwrite'); if (ow) ow.style.display = '';
    } else {
      el.innerHTML = '<span style="color:var(--t6)">새 보고서 (저장 시 자동 R 부여)</span>';
      var ow2 = $('wrAuOverwrite'); if (ow2) ow2.style.display = 'none';
    }
  }

  function authorNew() {
    if (_authorState.lastText || _authorState.curText) {
      if (!confirm('현재 작성 내용이 사라집니다. 새로 만드시겠습니까?')) return;
    }
    _authorState.lastText = '';
    _authorState.curText = '';
    _authorState.loadedId = null;
    _authorState.loadedName = '';
    forgetLoaded();
    renderAuthor();
  }

  async function authorLoadFromPrevWeek() {
    try {
      var r = await apiFetch('/api/weekly-reports?limit=10');
      var rows = r.data || [];
      if (!rows.length) { alert('저장된 보고서가 없습니다.'); return; }
      var match = _authorState.team ? rows.filter(function (x) { return x.team === _authorState.team; })[0] : rows[0];
      if (!match) match = rows[0];
      var d = await apiFetch('/api/weekly-reports/' + encodeURIComponent(match.id));
      var prevCur = d.data && d.data.cur_text || '';
      if (!prevCur) { alert('이전 주 금주 텍스트가 비어있습니다.'); return; }
      if (_authorState.lastText && !confirm('현재 [지난주] 텍스트를 덮어씁니다. 진행할까요?')) return;
      _authorState.lastText = prevCur;
      _authorState.editPane = 'last';
      renderAuthor();
    } catch (e) {
      alert('가져오기 실패: ' + (e.message || e));
    }
  }

  async function toggleLoadDropdown() {
    var dd = $('wrAuLoadDropdown');
    if (dd.style.display === 'block') { dd.style.display = 'none'; return; }
    dd.innerHTML = '<div style="color:var(--t5);padding:6px;font-size:12px">⏳ 목록 로드...</div>';
    dd.style.display = 'block';
    try {
      var r = await apiFetch('/api/weekly-reports?limit=50');
      var rows = r.data || [];
      if (!rows.length) { dd.innerHTML = '<div style="color:var(--t5);padding:6px;font-size:12px">저장된 보고서가 없습니다.</div>'; return; }
      dd.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:6px">'
        + rows.map(function (it) {
            return '<button class="tab" data-load-id="' + esc(it.id) + '" style="padding:5px 10px;font-size:11px;text-align:left">'
              + esc(it.week_label || '-') + ' · ' + esc(it.team || '') + ' <span style="color:var(--t6);margin-left:6px">' + esc(it.name) + '</span>'
              + '</button>';
          }).join('')
        + '</div>';
      dd.querySelectorAll('[data-load-id]').forEach(function (b) {
        b.addEventListener('click', async function () {
          try { await authorLoadById(b.dataset.loadId); $('wrAuLoadDropdown').style.display = 'none'; }
          catch (e) { alert('불러오기 실패: ' + (e.message || e)); }
        });
      });
    } catch (e) {
      dd.innerHTML = '<div style="color:#d03030;padding:6px;font-size:12px">조회 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  async function authorLoadById(id) {
    try {
      var r = await apiFetch('/api/weekly-reports/' + encodeURIComponent(id));
      var d = r.data;
      _authorState.loadedId = d.id;
      _authorState.loadedName = d.name;
      _authorState.team = d.team || _authorState.team;
      _authorState.weekStart = d.week_start ? String(d.week_start).slice(0, 10) : _authorState.weekStart;
      _authorState.weekEnd = d.week_end ? String(d.week_end).slice(0, 10) : _authorState.weekEnd;
      _authorState.lastText = d.last_text || '';
      _authorState.curText = d.cur_text || '';
      rememberLoaded(d.id);
      renderAuthor();
    } catch (e) {
      throw e;
    }
  }

  async function saveAuthor(asNewVersion) {
    if (!_authorState.team) { alert('팀명을 입력하세요.'); return; }
    if (!_authorState.weekStart || !_authorState.weekEnd) { alert('주차를 선택하세요.'); return; }
    syncAuthorEditorsToState();

    var name;
    if (asNewVersion || !_authorState.loadedName) {
      try {
        var r = await apiFetch('/api/weekly-reports/next-name?team=' + encodeURIComponent(_authorState.team)
          + '&weekStart=' + encodeURIComponent(_authorState.weekStart)
          + '&weekEnd=' + encodeURIComponent(_authorState.weekEnd));
        name = r.data && r.data.nextName;
      } catch (e) { alert('이름 조회 실패: ' + (e.message || e)); return; }
    } else {
      name = _authorState.loadedName;
    }
    if (!name) { alert('이름 생성 실패'); return; }

    var payload = {
      version: 1,
      name: name,
      savedAt: new Date().toLocaleString('ko-KR'),
      lastText: _authorState.lastText || '',
      curText: _authorState.curText || ''
    };

    try {
      var resp = await apiFetch('/api/weekly-reports', { method: 'POST', body: JSON.stringify(payload) });
      var saved = resp.data && resp.data[0];
      _authorState.loadedId = saved && saved.id;
      _authorState.loadedName = name;
      rememberLoaded(_authorState.loadedId);
      if (typeof showToast === 'function') showToast('저장됨: ' + name, 'ok');
      else alert('저장됨: ' + name);
      updateAuthorStatusBadge();
    } catch (e) {
      alert('저장 실패: ' + (e.message || e));
    }
  }

  /* ─── HTML 복사 / 다운로드 (iframe 임베드용) ─── */
  function toggleExportPanel() {
    var p = $('wrAuExportPanel');
    if (!p) return;
    if (p.style.display === 'block') { p.style.display = 'none'; return; }
    syncAuthorEditorsToState();
    var hasLast = !!(_authorState.lastText && _authorState.lastText.trim());
    var hasCur = !!(_authorState.curText && _authorState.curText.trim());
    if (!hasLast && !hasCur) {
      p.style.display = 'block';
      p.innerHTML = '<div style="color:var(--t6);text-align:center;padding:8px">내용이 없습니다.</div>';
      return;
    }
    p.style.display = 'block';
    p.innerHTML = ''
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
      +   '<span style="font-size:11.5px;color:var(--t5);margin-right:6px">테마</span>'
      +   '<select id="wrAuExpTheme" style="padding:5px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-p);color:var(--t2);font-size:11.5px">'
      +     '<option value="light">라이트</option>'
      +     '<option value="dark">다크</option>'
      +   '</select>'
      +   '<span style="width:6px"></span>'
      +   (hasCur  ? '<button class="tab" data-exp="cur"   data-act="copy" style="padding:5px 12px">📋 복사 (금주)</button>' : '')
      +   (hasLast ? '<button class="tab" data-exp="last"  data-act="copy" style="padding:5px 12px">📋 복사 (지난주)</button>' : '')
      +   ((hasCur && hasLast) ? '<button class="tab" data-exp="both" data-act="copy" style="padding:5px 12px">📋 복사 (둘 다)</button>' : '')
      +   '<span style="width:6px"></span>'
      +   (hasCur  ? '<button class="tab" data-exp="cur"   data-act="dl" style="padding:5px 12px">💾 다운로드 (금주)</button>' : '')
      +   (hasLast ? '<button class="tab" data-exp="last"  data-act="dl" style="padding:5px 12px">💾 다운로드 (지난주)</button>' : '')
      +   ((hasCur && hasLast) ? '<button class="tab" data-exp="both" data-act="dl" style="padding:5px 12px">💾 다운로드 (둘 다)</button>' : '')
      + '</div>'
      + '<div id="wrAuExpStatus" style="margin-top:6px;font-size:11.5px;color:var(--t5)"></div>';
    p.querySelectorAll('[data-exp]').forEach(function (b) {
      b.addEventListener('click', function () {
        var theme = $('wrAuExpTheme').value;
        runExport(b.dataset.exp, b.dataset.act, theme);
      });
    });
  }

  function buildExportFor(which, theme) {
    var headerLabel = (_authorState.team || '주간업무') + ' · ' + (_authorState.weekStart || '') + ' ~ ' + (_authorState.weekEnd || '');
    var headerSub = _authorState.loadedName || '';
    if (which === 'both') {
      var arr = [];
      if (_authorState.lastText) arr.push({ label: '지난주', parsed: clientParseText(_authorState.lastText) });
      if (_authorState.curText)  arr.push({ label: '금주',   parsed: clientParseText(_authorState.curText) });
      return buildStandaloneHTML(arr, { theme: theme, title: headerLabel, headerLabel: headerLabel, headerSub: headerSub });
    }
    var text = which === 'last' ? _authorState.lastText : _authorState.curText;
    var label = which === 'last' ? '지난주' : '금주';
    return buildStandaloneHTML(clientParseText(text), { theme: theme, title: headerLabel + ' (' + label + ')', headerLabel: headerLabel + ' — ' + label, headerSub: headerSub });
  }

  async function runExport(which, action, theme) {
    var html = buildExportFor(which, theme);
    var status = $('wrAuExpStatus');
    if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(html);
        if (status) status.innerHTML = '<span style="color:#1a8a40">✓ 복사됨 — ' + html.length.toLocaleString() + '자. iframe srcdoc 또는 .html로 붙여넣기 가능</span>';
        if (typeof showToast === 'function') showToast('HTML 복사됨', 'ok');
      } catch (e) {
        if (status) status.innerHTML = '<span style="color:#d03030">복사 실패: ' + esc(e.message || e) + '</span>';
      }
    } else {
      var fname = (_authorState.loadedName || ((_authorState.team || 'report') + '_' + (_authorState.weekStart || '')))
        + (which === 'both' ? '' : ('_' + which)) + '.html';
      var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = fname; document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
      if (status) status.innerHTML = '<span style="color:#1a8a40">✓ 다운로드: ' + esc(fname) + '</span>';
    }
  }

  /* ─── 자동 마지막 작업 복원 ─── */
  var LS_LAST_ID = 'wr-author-last-id';
  function rememberLoaded(id) { try { if (id) localStorage.setItem(LS_LAST_ID, id); } catch (e) {} }
  function forgetLoaded() { try { localStorage.removeItem(LS_LAST_ID); } catch (e) {} }

  async function autoLoadIfEmpty() {
    if (_authorState.loadedId || _authorState.lastText || _authorState.curText) return;
    if (_authorState._autoLoadTried) return;
    _authorState._autoLoadTried = true;
    var stored = null;
    try { stored = localStorage.getItem(LS_LAST_ID); } catch (e) {}
    try {
      if (stored) {
        try { await authorLoadById(stored); return; }
        catch (e) { forgetLoaded(); }
      }
      var r = await apiFetch('/api/weekly-reports?limit=1');
      if (r.data && r.data.length) await authorLoadById(r.data[0].id);
    } catch (e) { /* silent */ }
  }

  /* ═══════════════════════════════════════════════════════════════
   * 우측 업무일지 패널 — 지난주 업무를 팀/팀원으로 골라 나열·요약하고 편집창에 삽입
   *   · 기간: 작성 주차의 전주(기본) / 작성 주차 / 직접 지정
   *   · 팀: 설정 > 팀원 그룹(memberGroups) — 주간분석·트렌드와 같은 그룹
   *   · 요약: 규칙 기반(수주별/담당자별, 즉시) + AI 초안(/api/ai/summary)
   *   · 삽입: 요약 항목·원본 줄 모두 대상 편집창의 해당 섹션 끝에 (섹션이 없으면 표준 순서 자리에 생성)
   * ═══════════════════════════════════════════════════════════════ */

  // 업무분장 코드 → 보고서 섹션. 목록에 없는 코드는 [기타], V(휴가)는 요약에서 제외
  var ABBR_SECTION = { D: 'dev', M: 'setup', A: 'cs' };
  var SUM_MAX_DETAILS = 4;   // 항목당 세부 줄 최대 개수 (시간 많은 순)
  var SUM_DETAIL_MAX_LEN = 120;
  var AI_MAX_CHARS = 12000;  // 서버 상한 15000자 — 지시문 여유분을 뺀 값

  function srcSectionOf(r) {
    var a = String(r.abbr || '').trim().toUpperCase().charAt(0);
    if (a === 'V') return null;
    return ABBR_SECTION[a] || 'etc';
  }
  function isoDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function mondayOf(iso) {
    var d = iso ? new Date(iso + 'T00:00:00') : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  }
  // 조회 기간 — 주말 작업도 잡히도록 월~일
  function srcRange() {
    var s = _authorState.src;
    if (s.range === 'custom') return { start: s.start, end: s.end };
    var mon = mondayOf(_authorState.weekStart);
    if (s.range === 'prev') mon.setDate(mon.getDate() - 7);
    var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { start: isoDate(mon), end: isoDate(sun) };
  }
  function mmdd(v) {
    var t = String(v || '').replace(/-/g, '');
    return t.length >= 8 ? t.slice(4, 6) + '/' + t.slice(6, 8) : String(v || '');
  }
  function srcGroups() {
    return (typeof memberGroups !== 'undefined' && Array.isArray(memberGroups)) ? memberGroups : [];
  }
  function srcTeam() {
    var id = _authorState.src.groupId;
    if (id === null) {
      // 처음 열 때: 작성 중인 팀명과 이름이 같은 그룹이 있으면 그 그룹으로
      var t = (_authorState.team || '').trim();
      var hit = t ? srcGroups().filter(function (g) { return g.name === t; })[0] : null;
      _authorState.src.groupId = hit ? hit.id : '';
      id = _authorState.src.groupId;
    }
    return id ? (srcGroups().filter(function (g) { return g.id === id; })[0] || null) : null;
  }
  function recOrderTitle(r) {
    var t = String(r.ocmt || '').trim();
    if (!t && r.order_no && typeof getOCmt === 'function') { try { t = getOCmt(r.order_no) || ''; } catch (e) {} }
    return t || r.order_no || '미지정';
  }
  function recSite(r) {
    var t = String(r.oclient || '').trim();
    if (!t && r.order_no && typeof getOClient === 'function') { try { t = getOClient(r.order_no) || ''; } catch (e) {} }
    return t || '미정';
  }
  function normContent(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  // 보고서 문법과 충돌하는 문자 무력화 — 본문의 '@'는 담당자 태그로 파싱된다
  function reportSafe(s) { return String(s).replace(/@/g, '＠'); }

  // 팀 필터까지만 적용 (팀원 칩 목록의 모집단)
  function srcTeamRows() {
    var team = srcTeam();
    var rows = _authorState.workRecords;
    if (team && Array.isArray(team.members)) {
      var set = {}; team.members.forEach(function (n) { set[n] = 1; });
      rows = rows.filter(function (r) { return set[r.name]; });
    }
    return rows;
  }
  // 팀 + 팀원 + 키워드
  function srcRows() {
    var s = _authorState.src;
    var rows = srcTeamRows();
    if (s.members) {
      var set = {}; s.members.forEach(function (n) { set[n] = 1; });
      rows = rows.filter(function (r) { return set[r.name]; });
    }
    if (s.q) {
      var q = s.q.toLowerCase();
      rows = rows.filter(function (r) {
        return [r.content, r.name, r.oclient, r.ocmt, r.order_no].join(' ').toLowerCase().indexOf(q) >= 0;
      });
    }
    return rows;
  }

  // 규칙 기반 요약 — 같은 수주(담당자별이면 담당자+수주)의 여러 날 기록을 한 항목으로 묶는다
  function buildSrcSummary(rows, by) {
    var map = {}, order = [];
    rows.forEach(function (r) {
      var sec = srcSectionOf(r);
      if (!sec) return;
      var ok = r.order_no || ('site:' + recSite(r));
      var key = (by === 'person' ? (r.name || '') + '|' : '') + sec + '|' + ok;
      var it = map[key];
      if (!it) {
        it = map[key] = { key: key, sec: sec, site: recSite(r), title: recOrderTitle(r), orderNo: r.order_no || '',
          person: by === 'person' ? (r.name || '미지정') : '', members: [], hours: 0, dmin: '', dmax: '', details: {}, detOrder: [] };
        order.push(key);
      }
      var h = Number(r.hours) || 0;
      it.hours += h;
      if (r.name && it.members.indexOf(r.name) < 0) it.members.push(r.name);
      var d = String(r.date || '');
      if (d && (!it.dmin || d < it.dmin)) it.dmin = d;
      if (d && (!it.dmax || d > it.dmax)) it.dmax = d;
      var c = normContent(r.content);
      if (c) {
        var dt = it.details[c];
        if (!dt) { dt = it.details[c] = { text: c, hours: 0, names: [] }; it.detOrder.push(c); }
        dt.hours += h;
        if (r.name && dt.names.indexOf(r.name) < 0) dt.names.push(r.name);
      }
    });
    var items = order.map(function (k) {
      var it = map[k];
      it.hours = Math.round(it.hours * 10) / 10;
      it.detailList = it.detOrder.map(function (c) { return it.details[c]; })
        .sort(function (a, b) { return b.hours - a.hours; });
      return it;
    });
    items.sort(function (a, b) {
      if (by === 'person' && a.person !== b.person) return a.person < b.person ? -1 : 1;
      var sa = SECTION_KEYS.indexOf(a.sec), sb = SECTION_KEYS.indexOf(b.sec);
      return sa !== sb ? sa - sb : b.hours - a.hours;
    });
    return items;
  }

  // 요약 항목 → 보고서 문법 텍스트 (- [사이트] 수주명 @담당자 / : 세부)
  function summaryItemText(it) {
    var line = '- [' + reportSafe(it.site) + '] ' + reportSafe(it.title)
      + it.members.map(function (n) { return ' @' + n; }).join('');
    var multi = it.members.length > 1;
    it.detailList.slice(0, SUM_MAX_DETAILS).forEach(function (d) {
      var t = d.text.length > SUM_DETAIL_MAX_LEN ? d.text.slice(0, SUM_DETAIL_MAX_LEN - 1) + '…' : d.text;
      line += '\n  : ' + reportSafe(t) + (multi && d.names.length === 1 ? ' @' + d.names[0] : '');
    });
    return line;
  }

  function paneKeyText(pane) { return pane === 'last' ? 'lastText' : 'curText'; }
  function paneLabel(pane) { return pane === 'last' ? '지난주' : '금주'; }

  // 편집창 textarea 를 state 값으로 다시 채우고 미리보기 갱신
  function refreshPaneEditors(pane) {
    var txt = _authorState[paneKeyText(pane)];
    var el = $(pane === 'last' ? 'wrAuEditorLast' : 'wrAuEditorCur');
    if (el) el.value = txt;
    var single = $('wrAuEditor');
    if (single && (single.dataset.pane || _authorState.editPane) === pane) single.value = txt;
    updateAuthorPreview(_authorState.viewMode === 'compare' ? pane : undefined);
  }

  // 섹션 인식 삽입 — { dev: [블록…], … } 를 대상 편집창의 해당 섹션 끝에 붙인다. 섹션이 없으면 새로 만든다
  function insertBlocksBySection(pane, bySec) {
    syncAuthorEditorsToState();
    var key = paneKeyText(pane);
    var lines = (_authorState[key] || '').split('\n');
    var added = 0;
    function headerType(l) {
      var m = l.trim().match(/^\[([^\]]+)\]$/);
      if (!m) return null;
      var k = Object.keys(SECTION_ALIAS).filter(function (a) { return m[1].indexOf(a) >= 0; })[0];
      return k ? SECTION_ALIAS[k] : '?';
    }
    SECTION_KEYS.forEach(function (sk) {
      var blocks = bySec[sk];
      if (!blocks || !blocks.length) return;
      var add = blocks.join('\n').split('\n');
      added += blocks.length;
      var hi = -1;
      for (var i = 0; i < lines.length; i++) { if (headerType(lines[i]) === sk) { hi = i; break; } }
      if (hi < 0) {
        // 섹션이 없으면 표준 순서(개발→셋업→C/S→기타)상 뒤에 오는 첫 섹션 앞에 새로 만든다
        var myOrd = SECTION_KEYS.indexOf(sk), at = -1;
        for (var q = 0; q < lines.length; q++) {
          var ht = headerType(lines[q]);
          if (ht && ht !== '?' && SECTION_KEYS.indexOf(ht) > myOrd) { at = q; break; }
        }
        var block = ['[' + SECTIONS[sk].label + ']'].concat(add);
        if (at < 0) {
          while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
          if (lines.length) lines.push('');
          Array.prototype.push.apply(lines, block);
        } else {
          Array.prototype.splice.apply(lines, [at, 0].concat(block, ['']));
        }
        return;
      }
      var end = lines.length;
      for (var j = hi + 1; j < lines.length; j++) { if (headerType(lines[j])) { end = j; break; } }
      while (end > hi + 1 && !lines[end - 1].trim()) end--;
      Array.prototype.splice.apply(lines, [end, 0].concat(add));
    });
    _authorState[key] = lines.join('\n');
    _authorState.editPane = pane;
    refreshPaneEditors(pane);
    if (typeof showToast === 'function') showToast(paneLabel(pane) + ' 편집창에 ' + added + '개 항목 삽입', 'ok');
  }

  /* ─── 패널 틀 (한 번만 그림 — 입력 중인 검색어가 재렌더로 끊기지 않게) ─── */
  function segBtns(attr, cur, opts) {
    return '<div class="tabs sub-tabs wr-src-seg">' + opts.map(function (o) {
      return '<button class="tab' + (cur === o[0] ? ' on' : '') + '" ' + attr + '="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function renderSrcShell() {
    var s = _authorState.src;
    if (s.collapsed) {
      return '<button id="wrSrcExpand" class="wr-src-rail" title="업무일지 패널 펼치기">⟨<span>📋 업무일지</span></button>';
    }
    var rg = srcRange();
    return ''
      + '<div class="wr-src-h">'
      +   '<strong>📋 업무일지</strong><span id="wrSrcCount" class="wr-src-muted"></span>'
      +   '<span style="flex:1"></span>'
      +   '<button id="wrSrcReload" class="tab" title="새로고침">↻</button>'
      +   '<button id="wrSrcCollapse" class="tab" title="패널 접기 — 편집 영역을 넓게">⟩</button>'
      + '</div>'
      + '<div class="wr-src-f">'
      +   '<div class="wr-src-row">'
      +     segBtns('data-src-range', s.range, [['prev', '지난주'], ['cur', '작성 주차'], ['custom', '직접']])
      +     '<input id="wrSrcStart" type="date" value="' + esc(rg.start) + '"' + (s.range === 'custom' ? '' : ' disabled') + '>'
      +     '<span class="wr-src-muted">~</span>'
      +     '<input id="wrSrcEnd" type="date" value="' + esc(rg.end) + '"' + (s.range === 'custom' ? '' : ' disabled') + '>'
      +   '</div>'
      +   '<div id="wrSrcTeams" class="wr-src-chips"></div>'
      +   '<div id="wrSrcMembers" class="wr-src-chips"></div>'
      +   '<input id="wrSrcQ" type="search" placeholder="🔍 내용·사이트·수주 검색" value="' + esc(s.q) + '">'
      +   '<div class="wr-src-row">'
      +     segBtns('data-src-view', s.view, [['summary', '요약'], ['raw', '원본']])
      +     (s.view === 'summary'
            ? segBtns('data-src-sumby', s.sumBy, [['order', '수주별'], ['person', '담당자별']])
            : segBtns('data-src-rawby', s.rawBy, [['name', '담당자'], ['oclient', '사이트'], ['date', '날짜'], ['none', '없음']]))
      +     '<span style="flex:1"></span>'
      +     '<span class="wr-src-muted">삽입 →</span>'
      +     segBtns('data-src-target', s.target, [['last', '지난주'], ['cur', '금주']])
      +   '</div>'
      + '</div>'
      + '<div id="wrSrcBody" class="wr-src-body"></div>'
      + '<div class="wr-src-foot">'
      +   '<button id="wrSrcInsertAll" class="tab on" title="보이는 요약 항목 전체를 섹션별로 삽입">＋ 요약 전체 삽입</button>'
      +   '<button id="wrSrcAi" class="tab" title="선택된 업무일지를 AI 가 주간보고 문법으로 정리">🤖 AI 초안</button>'
      + '</div>';
  }

  function bindSrcPanel() {
    var box = $('wrSrc');
    if (!box) return;
    var s = _authorState.src;
    var ex = $('wrSrcExpand');
    if (ex) {
      ex.addEventListener('click', function () { setSrcCollapsed(false); });
    } else {
      $('wrSrcCollapse').addEventListener('click', function () { setSrcCollapsed(true); });
      $('wrSrcReload').addEventListener('click', loadWorkRecords);
      box.querySelectorAll('[data-src-range]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (s.range === b.dataset.srcRange) return;
          if (b.dataset.srcRange === 'custom') { var cr = srcRange(); s.start = cr.start; s.end = cr.end; }
          s.range = b.dataset.srcRange;
          rerenderSrcShell();
          loadWorkRecords();
        });
      });
      ['wrSrcStart', 'wrSrcEnd'].forEach(function (id) {
        $(id).addEventListener('change', function (e) {
          s[id === 'wrSrcStart' ? 'start' : 'end'] = e.target.value;
          if (s.start && s.end) loadWorkRecords();
        });
      });
      var qT = null;
      $('wrSrcQ').addEventListener('input', function (e) {
        clearTimeout(qT);
        qT = setTimeout(function () { s.q = e.target.value.trim(); renderSrcDynamic(); }, 150);
      });
      [['data-src-view', 'view'], ['data-src-sumby', 'sumBy'], ['data-src-rawby', 'rawBy'], ['data-src-target', 'target']].forEach(function (p) {
        box.querySelectorAll('[' + p[0] + ']').forEach(function (b) {
          b.addEventListener('click', function () {
            s[p[1]] = b.getAttribute(p[0]);
            if (p[1] === 'view') rerenderSrcShell();
            else {
              box.querySelectorAll('[' + p[0] + ']').forEach(function (x) { x.classList.toggle('on', x === b); });
              renderSrcBody(); // target 도 버튼 툴팁·AI 삽입 라벨에 쓰이므로 다시 그림
            }
          });
        });
      });
      $('wrSrcInsertAll').addEventListener('click', insertAllSummary);
      $('wrSrcAi').addEventListener('click', runSrcAi);
    }
    bindSrcResizer();
  }

  function rerenderSrcShell() {
    var box = $('wrSrc');
    if (!box) return;
    box.innerHTML = renderSrcShell();
    bindSrcPanel();
    renderSrcDynamic();
  }

  function setSrcCollapsed(on) {
    _authorState.src.collapsed = on;
    lsSet(LS_SRC_COLLAPSED, on ? '1' : '0');
    var work = $('wrAuWork');
    if (work) work.classList.toggle('src-off', on);
    rerenderSrcShell();
    if (window._wrAuCheckCols) window._wrAuCheckCols();
  }

  // 패널 왼쪽 경계 드래그로 폭 조절 — 편집 영역은 최소 420px 남긴다
  function bindSrcResizer() {
    var h = $('wrSrcResizer'), work = $('wrAuWork');
    if (!h || !work || h.dataset.bound) return;
    h.dataset.bound = '1';
    function setW(w, save) {
      var rect = work.getBoundingClientRect();
      w = clampSrcWidth(Math.min(w, rect.width - 420));
      _authorState.src.width = w;
      work.style.setProperty('--wr-src-w', w + 'px');
      if (window._wrAuCheckCols) window._wrAuCheckCols();
      if (save) lsSet(LS_SRC_WIDTH, String(w));
    }
    h.addEventListener('mousedown', function (e) {
      if (_authorState.src.collapsed) return;
      e.preventDefault();
      h.classList.add('drag');
      document.body.style.userSelect = 'none';
      function mv(ev) { setW(work.getBoundingClientRect().right - ev.clientX, false); }
      function up() {
        h.classList.remove('drag');
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        lsSet(LS_SRC_WIDTH, String(_authorState.src.width));
      }
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
    h.addEventListener('dblclick', function () { setW(SRC_W_DEFAULT, true); });
  }

  async function loadWorkRecords() {
    var rg = srcRange();
    var body = $('wrSrcBody');
    if (!rg.start || !rg.end) { _authorState.workRecords = []; _authorState.workRecordsKey = ''; renderSrcDynamic(); return; }
    var key = rg.start + '~' + rg.end;
    _authorState.workRecordsKey = key;
    // 기간 입력칸이 prev/cur 모드면 작성 주차 변경을 따라가도록 갱신
    var si = $('wrSrcStart'), ei = $('wrSrcEnd');
    if (si && _authorState.src.range !== 'custom') { si.value = rg.start; ei.value = rg.end; }
    if (body) body.innerHTML = '<div class="wr-src-empty">⏳ 로드 중...</div>';
    try {
      var r = await apiFetch('/api/archives/records?startDate=' + rg.start.replace(/-/g, '') + '&endDate=' + rg.end.replace(/-/g, '') + '&all=true&limit=5000');
      if (_authorState.workRecordsKey !== key) return; // 그 사이 기간이 바뀜
      _authorState.workRecords = (r && r.data) || [];
      renderSrcDynamic();
    } catch (e) {
      if (_authorState.workRecordsKey === key) _authorState.workRecordsKey = '';
      if (body) body.innerHTML = '<div class="wr-src-empty" style="color:#d03030">로드 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  function renderSrcDynamic() {
    renderSrcChips();
    renderSrcBody();
  }

  function renderSrcChips() {
    var s = _authorState.src;
    var tBox = $('wrSrcTeams'), mBox = $('wrSrcMembers');
    if (!tBox || !mBox) return;
    var team = srcTeam();
    var groups = srcGroups();
    tBox.innerHTML = '<span class="wr-src-lbl">팀</span>'
      + '<button class="wr-chip' + (!team ? ' on' : '') + '" data-src-team="">전체</button>'
      + groups.map(function (g) {
          return '<button class="wr-chip' + (team && team.id === g.id ? ' on' : '') + '" data-src-team="' + esc(g.id) + '"'
            + (g.color ? ' style="--chip-c:' + esc(g.color) + '"' : '') + '>' + esc(g.name) + '</button>';
        }).join('')
      + (groups.length ? '' : '<span class="wr-src-muted" title="설정 > 팀원 그룹에서 팀을 만들면 여기서 고를 수 있습니다">그룹 없음</span>');

    // 팀원 칩: 기간 내 기록이 있는 사람 + 시간 (팀 선택 시 그 팀만)
    var hrs = {};
    srcTeamRows().forEach(function (r) { var n = r.name || '미지정'; hrs[n] = (hrs[n] || 0) + (Number(r.hours) || 0); });
    var names = Object.keys(hrs).sort();
    if (s.members) s.members = s.members.filter(function (n) { return hrs[n] !== undefined; });
    var sel = s.members;
    mBox.innerHTML = '<span class="wr-src-lbl">팀원</span>'
      + (names.length ? names.map(function (n) {
          var on = !sel || sel.indexOf(n) >= 0;
          return '<button class="wr-chip' + (on ? ' on' : '') + '" data-src-mem="' + esc(n) + '">' + esc(n)
            + ' <small>' + Math.round(hrs[n] * 10) / 10 + 'h</small></button>';
        }).join('')
        + '<button class="wr-chip wr-chip-ghost" data-src-mem-all="1">전체</button>'
        + '<button class="wr-chip wr-chip-ghost" data-src-mem-none="1">해제</button>'
        : '<span class="wr-src-muted">기록 없음</span>');

    tBox.querySelectorAll('[data-src-team]').forEach(function (b) {
      b.addEventListener('click', function () { s.groupId = b.dataset.srcTeam; s.members = null; renderSrcDynamic(); });
    });
    mBox.querySelectorAll('[data-src-mem]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        var n = b.dataset.srcMem;
        if (e.ctrlKey || e.metaKey) {
          s.members = [n];                // Ctrl+클릭: 이 사람만
        } else {
          var cur = s.members ? s.members.slice() : names.slice();
          var i = cur.indexOf(n);
          if (i >= 0) cur.splice(i, 1); else cur.push(n);
          s.members = cur.length === names.length ? null : cur;
        }
        renderSrcDynamic();
      });
    });
    var all = mBox.querySelector('[data-src-mem-all]');
    if (all) all.addEventListener('click', function () { s.members = null; renderSrcDynamic(); });
    var none = mBox.querySelector('[data-src-mem-none]');
    if (none) none.addEventListener('click', function () { s.members = []; renderSrcDynamic(); });
  }

  function renderSrcBody() {
    var body = $('wrSrcBody');
    if (!body) return;
    var s = _authorState.src;
    var rows = srcRows();
    var cnt = $('wrSrcCount');
    var rg = srcRange();
    if (cnt) {
      var th = rows.reduce(function (a, r) { return a + (Number(r.hours) || 0); }, 0);
      cnt.textContent = mmdd(rg.start) + '~' + mmdd(rg.end) + ' · ' + rows.length + '건 · ' + Math.round(th * 10) / 10 + 'h';
    }
    var aiHtml = renderSrcAiCard();
    if (!rows.length) {
      body.innerHTML = aiHtml + '<div class="wr-src-empty">' + (_authorState.workRecords.length ? '조건에 맞는 기록이 없습니다' : '이 기간의 업무일지가 없습니다') + '</div>';
      bindSrcAiCard();
      return;
    }
    body.innerHTML = aiHtml + (s.view === 'summary' ? renderSummaryHtml(rows) : renderRawHtml(rows));
    bindSrcAiCard();
    body.querySelectorAll('[data-sum-idx]').forEach(function (b) {
      b.addEventListener('click', function () {
        var it = _srcSummaryCache[+b.dataset.sumIdx];
        if (!it) return;
        var o = {}; o[it.sec] = [summaryItemText(it)];
        insertBlocksBySection(s.target, o);
      });
    });
    body.querySelectorAll('[data-sum-grp]').forEach(function (b) {
      b.addEventListener('click', function () {
        var g = b.dataset.sumGrp;
        insertSummaryItems(_srcSummaryCache.filter(function (it) { return (s.sumBy === 'person' ? it.person : it.sec) === g; }));
      });
    });
    body.querySelectorAll('[data-src-add]').forEach(function (b) {
      // 원본 줄도 섹션을 찾아 넣는다 — 섹션 머리 없이 들어간 줄은 파서가 무시해 미리보기에 안 보인다
      b.addEventListener('click', function () {
        var o = {}; o[b.dataset.srcSec] = [b.dataset.srcAdd];
        insertBlocksBySection(s.target, o);
      });
    });
  }

  var _srcSummaryCache = [];
  function insertSummaryItems(items) {
    if (!items.length) { alert('삽입할 항목이 없습니다.'); return; }
    var bySec = {};
    items.forEach(function (it) { (bySec[it.sec] = bySec[it.sec] || []).push(summaryItemText(it)); });
    insertBlocksBySection(_authorState.src.target, bySec);
  }
  function insertAllSummary() {
    insertSummaryItems(buildSrcSummary(srcRows(), 'order'));
  }

  function renderSummaryHtml(rows) {
    var s = _authorState.src;
    var items = buildSrcSummary(rows, s.sumBy);
    _srcSummaryCache = items;
    if (!items.length) return '<div class="wr-src-empty">요약할 기록이 없습니다 (휴가만 있음)</div>';
    var html = '', curG = null;
    items.forEach(function (it, idx) {
      var g = s.sumBy === 'person' ? it.person : it.sec;
      if (g !== curG) {
        if (curG !== null) html += '</div>';
        curG = g;
        var gh = items.filter(function (x) { return (s.sumBy === 'person' ? x.person : x.sec) === g; })
          .reduce(function (a, x) { return a + x.hours; }, 0);
        var label = s.sumBy === 'person' ? '👤 ' + esc(g) : '[' + esc(SECTIONS[g].label) + ']';
        var color = s.sumBy === 'person' ? 'var(--t3)' : SECTIONS[g].main;
        html += '<div class="wr-sum-grp"><div class="wr-sum-gh" style="color:' + color + '">' + label
          + ' <span class="wr-src-muted">' + Math.round(gh * 10) / 10 + 'h</span><span style="flex:1"></span>'
          + '<button class="tab" data-sum-grp="' + esc(g) + '" title="이 묶음 전체 삽입">＋ 묶음</button></div>';
      }
      var range = it.dmin === it.dmax ? mmdd(it.dmin) : mmdd(it.dmin) + '~' + mmdd(it.dmax);
      html += '<div class="wr-sum-it">'
        + '<div class="wr-sum-top">'
        +   (s.sumBy === 'person' ? '<span class="wr-sum-sec" style="color:' + SECTIONS[it.sec].main + ';background:' + SECTIONS[it.sec].bg + '">' + esc(SECTIONS[it.sec].label) + '</span>' : '')
        +   '<span class="wr-sum-site">[' + esc(it.site) + ']</span>'
        +   '<span class="wr-sum-title" title="' + esc(it.orderNo) + '">' + esc(it.title) + '</span>'
        +   '<button class="tab" data-sum-idx="' + idx + '" title="' + paneLabel(s.target) + ' 편집창의 해당 섹션에 삽입">＋</button>'
        + '</div>'
        + '<div class="wr-sum-meta">' + esc(it.members.join(', ')) + ' · ' + it.hours + 'h · ' + esc(range)
        +   (it.orderNo ? ' · <span style="font-family:ui-monospace,monospace">' + esc(it.orderNo) + '</span>' : '') + '</div>'
        + it.detailList.slice(0, SUM_MAX_DETAILS).map(function (d) {
            return '<div class="wr-sum-det" title="' + esc(d.text) + '">: ' + esc(d.text)
              + (it.members.length > 1 ? ' <span class="wr-src-muted">' + esc(d.names.join(', ')) + '</span>' : '') + '</div>';
          }).join('')
        + (it.detailList.length > SUM_MAX_DETAILS ? '<div class="wr-src-muted" style="padding-left:10px">… 외 ' + (it.detailList.length - SUM_MAX_DETAILS) + '건 (삽입 시 제외)</div>' : '')
        + '</div>';
    });
    return html + '</div>';
  }

  function renderRawHtml(rows) {
    var s = _authorState.src;
    var grouped = {};
    if (s.rawBy === 'none') grouped['전체'] = rows;
    else rows.forEach(function (r) {
      var k = s.rawBy === 'date' ? mmdd(r.date) : (r[s.rawBy] || '미지정') + '';
      (grouped[k] = grouped[k] || []).push(r);
    });
    var keys = Object.keys(grouped).sort();
    if (s.rawBy === 'date') keys.reverse();
    return keys.map(function (k) {
      var gh = grouped[k].reduce(function (a, r) { return a + (Number(r.hours) || 0); }, 0);
      return '<details open class="wr-raw-grp"><summary>' + esc(k) + ' <span class="wr-src-muted">(' + grouped[k].length + ' · ' + Math.round(gh * 10) / 10 + 'h)</span></summary>'
        + grouped[k].map(function (r) {
            var content = normContent(r.content);
            var inj = '- [' + reportSafe(recSite(r)) + '] ' + reportSafe(content) + (r.name ? ' @' + r.name : '');
            return '<div class="wr-raw-row">'
              + '<span class="wr-raw-d">' + esc(mmdd(r.date)) + '</span>'
              + '<span class="wr-raw-n">' + esc(r.name || '') + '</span>'
              + '<span class="wr-raw-c"><span style="color:var(--ac)">' + esc(r.oclient || '') + '</span> ' + esc(content)
              +   ' <span class="wr-src-muted">' + (Number(r.hours) || 0) + 'h' + (r.abbr ? ' · ' + esc(r.abbr) : '') + '</span></span>'
              + '<button class="tab" data-src-sec="' + (srcSectionOf(r) || 'etc') + '" data-src-add="' + esc(inj) + '" title="' + paneLabel(s.target) + ' 편집창의 해당 섹션에 삽입">＋</button>'
              + '</div>';
          }).join('')
        + '</details>';
    }).join('');
  }

  /* ─── AI 초안 ─── */
  function renderSrcAiCard() {
    var s = _authorState.src;
    if (!s.aiBusy && !s.aiText) return '';
    if (s.aiBusy) return '<div class="wr-ai-card"><div class="wr-src-muted">🤖 AI 가 업무일지를 정리하고 있습니다… (10~30초)</div></div>';
    return '<div class="wr-ai-card">'
      + '<div class="wr-sum-gh"><span>🤖 AI 초안</span><span style="flex:1"></span>'
      +   '<button class="tab on" id="wrAiIns">＋ ' + paneLabel(s.target) + '에 삽입</button>'
      +   '<button class="tab" id="wrAiCopy">📋</button>'
      +   '<button class="tab" id="wrAiClose" title="닫기">✕</button></div>'
      + '<textarea id="wrAiText" spellcheck="false">' + esc(s.aiText) + '</textarea>'
      + '<div class="wr-src-muted">삽입 전에 여기서 고칠 수 있습니다. 섹션 머리([개발] 등)가 있으면 편집창의 같은 섹션 끝에 들어갑니다.</div>'
      + '</div>';
  }
  function bindSrcAiCard() {
    var s = _authorState.src;
    var ta = $('wrAiText');
    if (ta) ta.addEventListener('input', function () { s.aiText = ta.value; });
    var ins = $('wrAiIns');
    if (ins) ins.addEventListener('click', function () { insertReportText(s.target, s.aiText); });
    var cp = $('wrAiCopy');
    if (cp) cp.addEventListener('click', async function () {
      try { await navigator.clipboard.writeText(s.aiText); if (typeof showToast === 'function') showToast('AI 초안 복사됨', 'ok'); }
      catch (e) { alert('복사 실패: ' + (e.message || e)); }
    });
    var cl = $('wrAiClose');
    if (cl) cl.addEventListener('click', function () { s.aiText = ''; renderSrcBody(); });
  }

  // 섹션 머리가 섞인 보고서 텍스트를 섹션별로 쪼개 삽입. 머리 없는 앞부분은 [기타]로
  function insertReportText(pane, text) {
    var bySec = {}, cur = 'etc', buf = [];
    function flush() {
      var t = buf.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
      if (t) (bySec[cur] = bySec[cur] || []).push(t);
      buf = [];
    }
    String(text || '').split('\n').forEach(function (l) {
      var m = l.trim().match(/^\[([^\]]+)\]$/);
      var k = m ? Object.keys(SECTION_ALIAS).filter(function (a) { return m[1].indexOf(a) >= 0; })[0] : null;
      if (k) { flush(); cur = SECTION_ALIAS[k]; } else buf.push(l);
    });
    flush();
    if (!Object.keys(bySec).length) { alert('삽입할 내용이 없습니다.'); return; }
    insertBlocksBySection(pane, bySec);
  }

  function buildAiPrompt(rows) {
    var rg = srcRange();
    var lines = rows.slice().sort(function (a, b) {
      return (a.name || '') < (b.name || '') ? -1 : (a.name || '') > (b.name || '') ? 1 : String(a.date) < String(b.date) ? -1 : 1;
    }).map(function (r) {
      return [mmdd(r.date), r.name || '', r.abbr || '', recSite(r), recOrderTitle(r), (Number(r.hours) || 0) + 'h', normContent(r.content)].join(' | ');
    });
    var data = '', cut = 0;
    for (var i = 0; i < lines.length; i++) {
      if (data.length + lines[i].length + 1 > AI_MAX_CHARS) { cut = lines.length - i; break; }
      data += lines[i] + '\n';
    }
    return [
      '다음은 ' + mmdd(rg.start) + '~' + mmdd(rg.end) + ' 기간 팀원들의 업무일지입니다. 이를 팀 주간업무 보고서 초안으로 정리하세요.',
      '',
      '## 출력 형식 (반드시 이 문법만, 설명·코드블록 없이 본문만 출력)',
      '[개발]',
      '- [사이트] 업무명 @담당자 @담당자',
      '  : 핵심 진행 내용 한 줄',
      '[셋업]',
      '[C/S]',
      '[기타]',
      '',
      '## 규칙',
      '- 섹션은 업무분장 코드로 나눕니다: D=개발, M=셋업, A=C/S, 그 외=기타. V(휴가)는 제외.',
      '- 같은 사이트·수주의 여러 날 기록은 한 항목으로 묶고, 세부 줄은 항목당 1~3개로 핵심만(무엇을 했고 어디까지 왔는지).',
      '- 담당자는 실제 기록한 사람만 @이름 으로 붙입니다. 시간(h)·날짜는 쓰지 않습니다.',
      '- 완료된 일은 세부 줄 끝에 #완료, 진행 중이면 #진행중 을 붙입니다. 판단이 어려우면 생략.',
      '- 내용이 없는 섹션은 생략합니다. 추측으로 내용을 만들지 마세요.',
      '',
      '## 업무일지 (날짜 | 담당자 | 분장 | 사이트 | 수주명 | 시간 | 내용)',
      data + (cut ? '...(분량 제한으로 ' + cut + '건 생략)' : '')
    ].join('\n');
  }

  async function runSrcAi() {
    var s = _authorState.src;
    if (s.aiBusy) return;
    var rows = srcRows().filter(function (r) { return srcSectionOf(r); });
    if (!rows.length) { alert('AI 로 정리할 업무일지가 없습니다.'); return; }
    s.aiBusy = true; s.aiText = '';
    renderSrcBody();
    try {
      var r = await apiFetch('/api/ai/summary', { method: 'POST', body: JSON.stringify({ prompt: buildAiPrompt(rows) }), timeoutMs: 120000 });
      var text = (r && r.data && r.data.text) || '';
      s.aiText = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '').trim();
      if (!s.aiText) alert('AI 응답이 비어 있습니다.');
    } catch (e) {
      alert('AI 초안 실패: ' + (e.message || e));
    } finally {
      s.aiBusy = false;
      renderSrcBody();
    }
  }

  // 패널 스타일 — 한 번만 주입
  (function injectSrcStyle() {
    if (typeof document === 'undefined' || !document.head || document.getElementById('wrSrcStyle')) return;
    var st = document.createElement('style');
    st.id = 'wrSrcStyle';
    st.textContent = ''
      + '.wr-au-work{display:grid;grid-template-columns:minmax(0,1fr) 10px var(--wr-src-w,440px);align-items:start;margin-bottom:10px}'
      + '.wr-au-work.src-off{grid-template-columns:minmax(0,1fr) 10px 34px}'
      + '.wr-au-edit{min-width:0}'
      + '.wr-src-resizer{align-self:stretch;cursor:col-resize;position:relative;min-height:200px}'
      + '.wr-src-resizer::after{content:"";position:absolute;left:4px;top:0;bottom:0;width:2px;border-radius:2px;background:transparent;transition:background .15s}'
      + '.wr-src-resizer:hover::after,.wr-src-resizer.drag::after{background:var(--ac)}'
      + '.src-off .wr-src-resizer{cursor:default}.src-off .wr-src-resizer::after{display:none}'
      + '.wr-src{position:sticky;top:8px;height:calc(100vh - 16px);min-height:480px;display:flex;flex-direction:column;background:var(--bg-ps,var(--bg-p));border:1px solid var(--bd);border-radius:8px;min-width:0;overflow:hidden}'
      + '.wr-src-rail{flex:1;border:0;background:transparent;color:var(--t4);cursor:pointer;font:inherit;font-size:12px;display:flex;flex-direction:column;align-items:center;gap:10px;padding:12px 0}'
      + '.wr-src-rail span{writing-mode:vertical-rl;letter-spacing:2px}.wr-src-rail:hover{background:var(--bg-i);color:var(--ac)}'
      + '.wr-src-h{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:13px}'
      + '.wr-src-h .tab{padding:3px 9px;font-size:12px}'
      + '.wr-src-f{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--bd)}'
      + '.wr-src-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}'
      + '.wr-src-f input[type=date],.wr-src-f input[type=search]{padding:4px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:11.5px;font-family:inherit}'
      + '.wr-src-f input[type=search]{width:100%;box-sizing:border-box;padding:6px 10px}'
      + '.wr-src-f input:disabled{opacity:.6}'
      + '.wr-src-seg{margin:0!important}.wr-src-seg .tab{padding:3px 8px;font-size:11px}'
      + '.wr-src-chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center;max-height:92px;overflow:auto}'
      + '.wr-src-lbl{font-size:10.5px;color:var(--t5);width:28px;flex-shrink:0}'
      + '.wr-chip{--chip-c:var(--ac);border:1px solid var(--bd);background:var(--bg-i);color:var(--t4);border-radius:12px;padding:2px 9px;font-size:11px;font-family:inherit;cursor:pointer;line-height:1.5}'
      + '.wr-chip small{color:var(--t6);font-size:10px}'
      + '.wr-chip.on{border-color:var(--chip-c);color:var(--t1);background:color-mix(in srgb,var(--chip-c) 16%,transparent);font-weight:600}'
      + '.wr-chip-ghost{border-style:dashed;color:var(--t5)}'
      + '.wr-src-muted{color:var(--t6);font-size:11px;font-weight:400}'
      + '.wr-src-body{flex:1;overflow:auto;padding:8px 10px;min-height:0}'
      + '.wr-src-empty{color:var(--t6);padding:24px 8px;text-align:center;font-size:12px}'
      + '.wr-src-foot{display:flex;gap:6px;padding:8px 10px;border-top:1px solid var(--bd)}.wr-src-foot .tab{flex:1;padding:6px 8px;font-size:12px}'
      + '.wr-sum-grp{margin-bottom:10px}'
      + '.wr-sum-gh{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:4px 0;border-bottom:1px solid var(--bd);margin-bottom:4px}'
      + '.wr-sum-gh .tab,.wr-sum-top .tab,.wr-raw-row .tab{padding:1px 8px;font-size:11px;flex-shrink:0}'
      + '.wr-sum-it{padding:5px 6px;border-radius:6px;margin-bottom:2px}.wr-sum-it:hover{background:var(--bg-i)}'
      + '.wr-sum-top{display:flex;align-items:center;gap:5px;font-size:12px}'
      + '.wr-sum-site{color:var(--ac);flex-shrink:0}'
      + '.wr-sum-title{flex:1;min-width:0;font-weight:600;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.wr-sum-sec{font-size:10px;font-weight:700;padding:0 5px;border-radius:3px;flex-shrink:0}'
      + '.wr-sum-meta{font-size:10.5px;color:var(--t5);margin:1px 0 2px}'
      + '.wr-sum-det{font-size:11.5px;color:var(--t3);padding-left:10px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}'
      + '.wr-raw-grp{margin-bottom:6px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i)}'
      + '.wr-raw-grp summary{cursor:pointer;padding:5px 8px;font-size:12px;font-weight:600;color:var(--t3)}'
      + '.wr-raw-row{display:flex;gap:6px;padding:4px 8px;border-top:1px solid var(--bd);font-size:11.5px;align-items:flex-start}'
      + '.wr-raw-d{color:var(--t6);font-family:ui-monospace,monospace;flex-shrink:0;width:38px}'
      + '.wr-raw-n{color:var(--t5);flex-shrink:0;width:48px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.wr-raw-c{flex:1;min-width:0;color:var(--t3);word-break:break-word}'
      + '.wr-ai-card{border:1px solid var(--ac);border-radius:8px;padding:8px;margin-bottom:10px;background:var(--bg-i)}'
      + '.wr-ai-card textarea{width:100%;box-sizing:border-box;min-height:220px;margin:6px 0 4px;padding:8px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-p);color:var(--t2);font-size:12px;font-family:ui-monospace,Consolas,monospace;line-height:1.55;resize:vertical}'
      + '@media (max-width:1100px){.wr-au-work,.wr-au-work.src-off{grid-template-columns:1fr}.wr-src-resizer{display:none}.wr-src{position:static;height:auto;min-height:0;margin-top:10px}.wr-src-body{max-height:560px}.wr-src-rail{flex-direction:row;justify-content:center}.wr-src-rail span{writing-mode:horizontal-tb}}';
    document.head.appendChild(st);
  })();
})();
