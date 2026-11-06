/* ═══ 주간 업무 보고 — 관리자 페이지 ═══
 * 업로드/검색/통계/목록 4개 서브탭으로 /api/weekly-reports 호출
 * apiFetch (auth.js) 사용 — 자동 JWT 첨부
 */

(function () {
  // ── 섹션 설정: 라벨/번호/색상/파싱 별칭의 단일 소스 ──
  var SECTIONS = {
    // v13.346 색 새로 — 라이트 · 다크 둘 다에서 글자로 읽히는 중간 밝기
    dev:   { label: '개발', num: '01', main: '#3366E0', bg: 'rgba(51,102,224,.11)',  bar: 'linear-gradient(90deg,#3366E0,#7FA2F0)' },
    setup: { label: '셋업', num: '02', main: '#8B44E0', bg: 'rgba(139,68,224,.11)',  bar: 'linear-gradient(90deg,#8B44E0,#BC93F0)' },
    cs:    { label: 'C/S',  num: '03', main: '#E0670F', bg: 'rgba(224,103,15,.12)',  bar: 'linear-gradient(90deg,#E0670F,#F2A566)' },
    etc:   { label: '기타', num: '04', main: '#64788F', bg: 'rgba(100,120,143,.14)', bar: 'linear-gradient(90deg,#64788F,#9AA8BA)' }
  };
  // 텍스트 파서는 서버와 같은 파일 (weekly-report-parse.js → 전역 WeeklyReportParse)
  var WRP = WeeklyReportParse;
  var SECTION_KEYS = WRP.SECTION_KEYS;
  function secOf(t) { return SECTIONS[t] || SECTIONS.dev; }
  function secLabel(t) { return (SECTIONS[t] || {}).label || t; }

  // ── 상태/진행률 상수 (색·크기·임계값 단일 소스) ──
  var STATUS_COLORS = { planned: '#3B82F6', in_progress: '#E5484D', done: '#16A34A' };
  var ICON_PX = 13; // 상태 아이콘 지름(px)
  var HEAT = { midAt: 30, highAt: 70, low: '#E5484D', mid: '#D97706', high: '#16A34A' };
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
    // 기한엔 해가 없다 — 반년 넘게 차이 나면 해를 넘긴 것으로 (12월에 본 ~01/05 = D-몇, 1월에 본 ~12/20 = 지난해)
    if (diff > 183) { target.setFullYear(target.getFullYear() - 1); diff = Math.round((target - today) / 86400000); }
    else if (diff < -183) { target.setFullYear(target.getFullYear() + 1); diff = Math.round((target - today) / 86400000); }
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
    return '<span class="wrp-dd" style="font-family:ui-monospace,monospace;font-size:10px;font-weight:800;color:' + d.color + ';background:' + d.bg + ';border-radius:9px;padding:1px 7px;white-space:nowrap;margin-left:4px;line-height:15px">' + esc(d.label) + '</span>';
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
  var ICON_SLOT = 14; // 상태 아이콘 고정 슬롯(px) — 이름/세부 시작 위치 정렬

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
    return '<span style="flex-shrink:0;width:' + ICON_SLOT + 'px;height:1.45em;display:inline-flex;align-items:center;justify-content:flex-start">' + inner + '</span>';
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
  // ── 미리보기 v13.346 — 절마다 카드 하나 · 항목은 가는 줄로 나눔 · 오른쪽 담당자 칸 고정 · 진행 막대 줄 ──
  //   격자: [사이트 --sw] [상태 14px] [이름 1fr] [담당 auto]
  //   · 이름이 길어도 담당자는 첫 줄 오른쪽 그 자리 (예전엔 칸이 모자라면 담당 · 날짜가 통째로 다음 줄로 밀렸다)
  //   · 기한 · 진행률이 있는 항목만 이름 아래 '진행 줄' — 막대 · % · 기한 · D-day 를 한 줄에 (우연히 꺾이는 줄 대신 정해진 자리)
  //   · 세부 줄은 상태 칸부터 — 다른 항목의 상태 · 이름 시작과 오와 열이 맞음
  //   · 절 머리: 번호 · 이름 · 건수 + 완료/진행/예정 비율 막대
  // 선 아이콘(SVG) — 이모지는 컴퓨터마다 모양 · 색이 달라(보라 👤 등) 붙여 넣은 곳에서 튐. currentColor 로 글자색을 따름
  function svgIco(w, body, fill) {
    return '<svg class="wrp-ico" width="' + w + '" height="' + w + '" viewBox="0 0 16 16" ' + (fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"') + ' aria-hidden="true">' + body + '</svg>';
  }
  var ICO = {
    user: svgIco(11, '<circle cx="8" cy="4.8" r="3"/><path d="M2.2 14.5c0-3.3 2.6-5.3 5.8-5.3s5.8 2 5.8 5.3z"/>', true),
    cal: svgIco(11, '<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.8h12M5.2 1.6v2.8M10.8 1.6v2.8"/>'),
    // 절 아이콘: 개발 </> · 셋업 렌치 · C/S 헤드셋 · 기타 점 셋
    dev: svgIco(14, '<path d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4M9.2 2.8L6.8 13.2"/>'),
    setup: svgIco(14, '<path d="M10.6 1.9a3.6 3.6 0 0 0-3.4 4.8L2.4 11.5a1.4 1.4 0 0 0 2 2l4.8-4.8a3.6 3.6 0 0 0 4.8-3.4l-2 2-2-.6-.6-2z"/>'),
    cs: svgIco(14, '<path d="M2.8 9.5V8a5.2 5.2 0 0 1 10.4 0v1.5"/><rect x="1.8" y="9" width="3" height="4.6" rx="1.2"/><rect x="11.2" y="9" width="3" height="4.6" rx="1.2"/><path d="M13 13.6c0 1-1.2 1.6-3.4 1.6"/>'),
    etc: svgIco(14, '<circle cx="3.2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="12.8" cy="8" r="1.5"/>', true)
  };
  function membersText(ms) {
    ms = ms || [];
    if (!ms.length) return '';
    return ms.length > 2 ? ms[0] + ' 외 ' + (ms.length - 1) : ms.join('·');
  }
  // 세부 한 줄: 상태 도형(무태그=항목 상태, 없으면 예정) · 하위 줄(└ ↳ → 또는 들여쓰기)은 └
  function renderDetail(d, di, itemStatus) {
    var dText = String(d.text || '').replace(/@[^\s@]+/g, '').replace(/#완료/g, '').replace(/#진행중?/g, '').trim();
    var own = (d.status && d.status !== 'none') ? d.status : null;
    var lineSt = own || (d.sub ? 'none' : (itemStatus === 'none' ? 'planned' : itemStatus));
    var inner = statusIcon(lineSt) || '<span style="color:var(--t6);font-size:11px">└</span>';
    return '<div class="wrp-dl' + (d.sub ? ' sub' : '') + (lineSt === 'done' ? ' dn' : '') + '">'
      + '<span class="wrp-dic">' + inner + '</span>'
      + '<span class="wrp-dt" title="' + esc(dText) + '">' + inlineMarkup(dText) + '</span>'
      + '</div>';
  }
  // 진행 줄: [막대] 40% · ~12/04 ········ D-28
  function progressLine(it, pct) {
    if (!it.deadline && pct === null) return '';
    var h = '<div class="wrp-pg">';
    if (pct !== null) {
      var heat = heatColor(pct);
      h += '<span class="wrp-bar"><span style="width:' + pct + '%;background:' + heat + '"></span></span>'
        + '<span class="wrp-pct" style="color:' + heat + '">' + pct + '%</span>';
    }
    if (it.deadline) h += '<span class="wrp-due">' + ICO.cal + esc(it.deadline) + '</span>' + ddayBadge(it.deadline);
    return h + '</div>';
  }
  function itemState(it) {
    if (it.status === 'done' || it.status === 'in_progress') return it.status;
    var ds = (it.details || []).map(function (d) { return d.status; });
    if (ds.length && ds.every(function (s) { return s === 'done'; })) return 'done';
    if (ds.some(function (s) { return s === 'in_progress' || s === 'done'; })) return 'in_progress';
    return 'planned';
  }
  // 절 머리: 01 개발  3건 ━━━━━━ 완료 2 · 진행 1
  function renderSectionHeader(sec) {
    var cl = secOf(sec.type), items = sec.items || [];
    var n = { done: 0, in_progress: 0, planned: 0 };
    items.forEach(function (it) { n[itemState(it)]++; });
    var tot = items.length || 1;
    var seg = function (k) { return n[k] ? '<span style="width:' + (n[k] * 100 / tot) + '%;background:' + STATUS_COLORS[k] + '"></span>' : ''; };
    var txt = [];
    if (n.done) txt.push('<b style="color:' + STATUS_COLORS.done + '">완료 ' + n.done + '</b>');
    if (n.in_progress) txt.push('<b style="color:' + STATUS_COLORS.in_progress + '">진행 ' + n.in_progress + '</b>');
    if (n.planned) txt.push('<b style="color:' + STATUS_COLORS.planned + '">예정 ' + n.planned + '</b>');
    return '<div class="wrp-sh">'
      + '<span class="wrp-no" style="background:' + cl.main + '">' + cl.num + '</span>'
      + '<span class="wrp-sl"><span class="wrp-sic" style="color:' + cl.main + '">' + (ICO[sec.type] || ICO.etc) + '</span>' + esc(secLabel(sec.type)) + '</span>'
      + '<span class="wrp-cnt">' + items.length + '건</span>'
      + '<span class="wrp-sbar" title="완료 ' + n.done + ' · 진행 ' + n.in_progress + ' · 예정 ' + n.planned + '">' + seg('done') + seg('in_progress') + seg('planned') + '</span>'
      + '<span class="wrp-stx">' + txt.join('<i>·</i>') + '</span>'
      + '</div>';
  }
  function renderItemRow(it, cl, uniformSiteW) {
    var pct = (typeof it.pct === 'number' && it.pct >= 0) ? it.pct : null;
    var ms = it.members || [];
    var hasDetails = !!(it.details && it.details.length);
    var detailsHtml = hasDetails ? it.details.map(function (d, di) { return renderDetail(d, di, it.status); }).join('') : '';
    var st = it.status === 'none' ? 'planned' : it.status;
    // 기한(=D-day)이 박힌 항목은 제목을 굵게 — 날짜가 걸린 일이 목록에서 먼저 눈에 띄도록
    var titleWeight = it.deadline ? '700' : '500';
    return '<div class="wrp-it' + (hasDetails ? ' has-d' : '') + (!hasDetails && st === 'done' ? ' dn' : '') + '"' + (uniformSiteW ? ' style="--sw:' + uniformSiteW + 'px"' : '') + '>'
      +   '<span class="wrp-site" title="' + esc(it.client || '') + '" style="background:' + cl.bg + ';color:' + cl.main + '">' + esc(it.client || '') + '</span>'
      +   (hasDetails ? '' : '<span class="wrp-ic">' + statusIcon(st) + '</span>')
      +   '<span class="wrp-name" style="font-weight:' + titleWeight + '" title="' + esc(it.name || '') + '">' + inlineMarkup(it.name || '') + '</span>'
      +   '<span class="wrp-mem"' + (ms.length ? ' title="담당자: ' + esc(ms.map(function (m) { return '@' + m; }).join(', ')) + '"' : '') + '>' + (ms.length ? ICO.user : '') + esc(membersText(ms)) + '</span>'
      +   (progressLine(it, pct) ? '<div class="wrp-pgw">' + progressLine(it, pct) + '</div>' : '')
      +   (hasDetails ? '<div class="wrp-det">' + detailsHtml + '</div>' : '')
      + '</div>';
  }
  // 미리보기 모양 — 내보내기 HTML 에도 그대로 들어감 (var(--…) 는 inlineThemeVars 가 색으로 바꿈)
  //   줄 · 옅은 바탕은 테마와 상관없이 보이게 반투명 회색 (라이트 · 다크 · 다른 페이지에 붙여도 같음)
  var PREVIEW_CSS = '<style>'
    + '.wrp{font-size:13px;line-height:1.45}'
    + '.wrp-sec{margin-bottom:12px}'
    + '.wrp-sh{display:flex;align-items:center;gap:7px;margin:0 0 5px;min-width:0}'
    + '.wrp-no{color:#fff;font:800 10px/1 ui-monospace,Consolas,monospace;padding:3px 5px;border-radius:5px;flex-shrink:0}'
    + '.wrp-ico{display:inline-block;vertical-align:-1px;flex-shrink:0}'
    + '.wrp-sl{font-size:13.5px;font-weight:800;color:var(--t2);white-space:nowrap;display:inline-flex;align-items:center;gap:5px}'
    + '.wrp-sic{display:inline-flex}.wrp-sic .wrp-ico{vertical-align:0}'
    + '.wrp-cnt{font-size:11px;color:var(--t5);white-space:nowrap}'
    + '.wrp-sbar{flex:1;min-width:30px;height:5px;border-radius:3px;background:rgba(127,127,127,.16);overflow:hidden;display:flex}'
    + '.wrp-sbar>span{display:block;height:100%}'
    + '.wrp-stx{font-size:10.5px;white-space:nowrap;flex-shrink:0}.wrp-stx b{font-weight:700}.wrp-stx i{font-style:normal;color:var(--t6);margin:0 3px}'
    + '.wrp-card{background:var(--bg-p);border:1px solid var(--bd);border-left:3px solid;border-radius:7px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.05)}'
    + '.wrp-it{display:grid;grid-template-columns:var(--sw,auto) 14px minmax(0,1fr) auto;column-gap:7px;row-gap:2px;align-items:start;padding:5px 9px 5px 8px}'
    + '.wrp-it+.wrp-it{border-top:1px solid rgba(127,127,127,.16)}'
    + '.wrp-site{grid-column:1;grid-row:1;max-width:100px;font-size:12px;font-weight:700;line-height:20px;padding:0 7px;border-radius:5px;box-sizing:border-box;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default}'
    + '.wrp-ic{grid-column:2;grid-row:1;height:20px;display:flex;align-items:center}'
    // v13.348 이름은 늘 한 줄 — 넘치면 … (전체는 마우스를 올리면 title 로)
    + '.wrp-name{grid-column:3;grid-row:1;min-width:0;font-size:13px;color:var(--t2);line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.wrp-it.has-d .wrp-name{grid-column:2/4}'
    + '.wrp-it.dn .wrp-name{color:var(--t3)}'
    + '.wrp-mem{grid-column:4;grid-row:1;font-size:11px;color:var(--t5);line-height:20px;white-space:nowrap;max-width:96px;overflow:hidden;text-overflow:ellipsis;text-align:right}'
    + '.wrp-mem .wrp-ico,.wrp-due .wrp-ico{margin-right:3px;opacity:.75}'
    + '.wrp-pgw{grid-column:2/5;grid-row:2;min-width:0}'
    + '.wrp-pg{display:flex;align-items:center;gap:6px;height:18px;font-size:10.5px}'
    + '.wrp-bar{width:84px;height:6px;border-radius:3px;background:rgba(127,127,127,.18);overflow:hidden;flex-shrink:0}'
    + '.wrp-bar>span{display:block;height:100%;border-radius:3px}'
    + '.wrp-pct{font:800 11px/1 ui-monospace,Consolas,monospace;min-width:30px}'
    + '.wrp-due{color:var(--t5);font-family:ui-monospace,Consolas,monospace;margin-left:auto}'
    + '.wrp-pg .wrp-dd{margin-left:0}'
    + '.wrp-det{grid-column:2/5;min-width:0}'
    + '.wrp-dl{display:flex;align-items:flex-start;gap:7px;font-size:12.5px;color:var(--t2);line-height:19px}'
    + '.wrp-dl.sub{padding-left:14px}.wrp-dl.dn .wrp-dt{color:var(--t3)}'
    + '.wrp-dic{flex-shrink:0;width:14px;height:19px;display:inline-flex;align-items:center}'
    + '.wrp-dt{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:keep-all;overflow-wrap:anywhere}'
    + '@media (max-width:600px){.wrp-it{grid-template-columns:min(var(--sw,90px),27vw) 14px minmax(0,1fr) auto;padding:5px 7px}.wrp-stx{display:none}}'
    + '</style>';
  // 사이트명 표시 폭 근사(배지 12px/700 기준 — 한글/전각 ≈ 12.5px, 그 외 ≈ 7.6px) — 배지 폭 통일용
  function siteWidth(s) {
    var w = 0; s = String(s || '');
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      w += ((c >= 0x1100 && c <= 0x11FF) || (c >= 0x2E80 && c <= 0xD7A3) || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFF00 && c <= 0xFFEF)) ? 12.5 : 7.6;
    }
    return w;
  }

  // 파싱된 sections/items 배열을 보기용 HTML로 빌드
  function buildPreviewHTML(parsedPane) {
    if (!parsedPane || !parsedPane.sections || !parsedPane.sections.length) {
      return '<div class="wr-msg">내용 없음</div>';
    }
    // 전 섹션에서 사이트명 최대 폭 → 배지 폭 통일(이름 시작 위치 정렬) — 너무 긴 이름은 100px 에서 … (전체는 title)
    var maxSiteW = 0;
    parsedPane.sections.forEach(function (sec) {
      (sec.items || []).forEach(function (it) { maxSiteW = Math.max(maxSiteW, siteWidth(it.client)); });
    });
    var uniformSiteW = maxSiteW ? Math.min(100, Math.ceil(maxSiteW) + 16) : 0; // 좌우 패딩 14 + 여유 2
    return PREVIEW_CSS + '<div class="wrp">' + parsedPane.sections.map(function (sec) {
      var cl = secOf(sec.type);
      return '<div class="wrp-sec">'
        + renderSectionHeader(sec)
        + '<div class="wrp-card" style="border-left-color:' + cl.main + '">'
        + (sec.items || []).map(function (it) { return renderItemRow(it, cl, uniformSiteW); }).join('')
        + '</div></div>';
    }).join('') + '</div>';
  }

  function shell() {
    return ''
      // v13.289 공통 툴바(.wm-tb) — 제목 + 보기 전환(작성 · 검색 · 통계 · 목록 · 업로드)
      + '<div class="wm-tb">'
      +   '<h3 class="wm-tb-t">📅 주간 업무</h3><span class="wm-tb-n">작성 · 취합 (관리자)</span>'
      +   '<span class="wm-seg" id="wrSubTabs" role="tablist">'
      +     '<button class="tab on" data-wt="author" role="tab">✍️ 작성</button>'
      +     '<button class="tab" data-wt="search" role="tab">🔍 검색</button>'
      +     '<button class="tab" data-wt="stats" role="tab" title="보고서를 주를 넘어 이어 붙여 추세 · 경과 · 효율">📈 분석</button>'
      +     '<button class="tab" data-wt="list" role="tab">🗂️ 목록</button>'
      +     '<button class="tab" data-wt="upload" role="tab">📤 업로드</button>'
      +   '</span>'
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
  /* 📓 노트북 리포트 → 주간 업무 작성 금주 칸 커서 자리에 넣기 (v13.317) */
  window.wrAuthorInsert = function (text) {
    STATE.tab = 'author';
    if (typeof setPage === 'function') setPage('weekly_report');
    var tries = 0;
    (function put() {
      var id = _authorState.viewMode === 'compare' ? 'wrAuEditorCur' : 'wrAuEditor';
      if ($(id) && STATE.tab === 'author') {
        if (_authorState.viewMode !== 'compare' && _authorState.editPane !== 'cur') { _authorState.editPane = 'cur'; renderAuthor(); }
        var ta = $(id), v = ta.value;
        if (ta.selectionStart === 0 && ta.selectionEnd === 0 && v) ta.setSelectionRange(v.length, v.length);   // 커서가 없으면 끝에
        insertAtCursor(id, (v && !/\n$/.test(v.slice(0, ta.selectionStart)) ? '\n' : '') + String(text || '').replace(/\n*$/, '\n'));
        return;
      }
      if (++tries < 40) setTimeout(put, 150);
    })();
  };

  function setTab(name) {
    STATE.tab = name;
    var bar = $('wrSubTabs'); if (!bar) return;
    bar.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('on', t.dataset.wt === name);
      t.setAttribute('aria-selected', t.dataset.wt === name);
    });
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
          return '<tr>' + td(esc(r.file)) + td(esc((r.saved && r.saved.week_label) || '-')) + td('<span class="wr-ok">저장됨 · ' + esc((r.saved && r.saved.name) || '') + '</span>') + '</tr>';
        }).join('')
      + fail.map(function (r) {
          return '<tr>' + td(esc(r.file)) + td('-') + td('<span class="wr-bad">실패: ' + esc(r.error) + '</span>') + '</tr>';
        }).join('');
    box.innerHTML = ''
      + '<div class="wr-card">'
      +   '<div class="wr-card-h">처리 결과 — 성공 ' + ok.length + ' / 실패 ' + fail.length + '</div>'
      +   '<table class="wr-tbl"><thead><tr>' + th('파일') + th('주차') + th('상태') + '</tr></thead>'
      +   '<tbody>' + rows + '</tbody></table>'
      + '</div>';
    if (typeof showToast === 'function') {
      showToast('업로드 완료 — 성공 ' + ok.length + ' / 실패 ' + fail.length, fail.length ? 'warn' : 'ok');
    }
  }

  /* ─── 검색 ─── */
  function renderSearch() {
    $('wrPanel').innerHTML = ''
      + '<div class="wr-card wr-mb">'
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
    return '<input id="' + id + '" type="' + type + '" placeholder="' + esc(ph) + '" class="wr-inp">';
  }
  function selectCell(id, opts) {
    return '<select id="' + id + '" class="wr-inp">'
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
    box.innerHTML = '<div class="wr-msg">⏳ 검색 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports/search?' + qs);
      var rows = r.data || [];
      $('wrSearchCount').textContent = rows.length + '건';
      if (!rows.length) {
        box.innerHTML = '<div class="wr-msg wr-box">결과 없음</div>';
        return;
      }
      var html = '<div class="wr-card wr-tbl-wrap">'
        + '<table class="wr-tbl">'
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
      box.innerHTML = '<div class="wr-err">검색 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  function th(t) { return '<th>' + t + '</th>'; }
  function td(html) { return '<td>' + html + '</td>'; }

  /* ─── 📈 분석 (v13.310) — 보고서를 주를 넘어 이어 붙여 추세 · 경과 · 효율 · 목표 (server/lib/weekly-insights) ─── */
  var WRI = { weeks: 12, team: '', risk: 'overdue', data: null, q: '', sel: {} };
  var WRI_STATE = {
    done: ['✅', '완료', '#1a8a40'], done_late: ['✅', '늦게 완료', '#c8730a'], overdue: ['⛔', '납기 지남', '#d21f1f'],
    at_risk: ['⚠️', '뒤처짐', '#c8730a'], stalled: ['⏸', '정체', '#7c5cff'], on_track: ['🟢', '순조', '#1a8a40'], open: ['•', '진행', 'var(--t5)'], dropped: ['❔', '사라짐', 'var(--t5)']
  };
  var WRI_RISK = [['overdue', '⛔ 납기 지남'], ['atRisk', '⚠️ 뒤처짐'], ['stalled', '⏸ 정체'], ['slipped', '📅 납기 연기'], ['dropped', '❔ 사라짐'], ['all', '📋 모든 일']];

  function renderStats() {
    $('wrPanel').innerHTML = ''
      + '<div class="wri-bar">'
      +   '<select id="wriTeam" class="wr-inp" title="팀"><option value="">모든 팀</option></select>'
      +   '<span class="wm-seg" id="wriWeeks">' + [4, 8, 12, 26, 52].map(function (n) { return '<button data-w="' + n + '"' + (n === WRI.weeks ? ' class="on"' : '') + '>' + (n >= 52 ? '1년' : n + '주') + '</button>'; }).join('') + '</span>'
      +   '<span style="flex:1"></span>'
      +   '<button class="btn btn-g btn-s" id="wriAi" title="숫자를 AI 가 읽고 원인 · 다음 주 목표 · 개선점을 정리">✨ AI 해석</button>'
      +   '<button class="btn btn-g btn-s" id="wriCsv" title="일 목록 전체 — 엑셀에서 열기">⬇ CSV</button>'
      + '</div>'
      + '<div id="wriBody"><div class="wr-msg">⏳ 분석 중...</div></div>';
    $('wriTeam').addEventListener('change', function () { WRI.team = this.value; runStats(); });
    $('wriWeeks').addEventListener('click', function (e) {
      var b = e.target.closest('[data-w]'); if (!b) return;
      WRI.weeks = +b.dataset.w;
      this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      runStats();
    });
    $('wriAi').addEventListener('click', runInsightAi);
    $('wriCsv').addEventListener('click', downloadInsightCsv);
    runStats();
  }

  function insightQs(withItems) {
    return '?weeks=' + WRI.weeks + (WRI.team ? '&team=' + encodeURIComponent(WRI.team) : '') + (withItems ? '&items=1' : '');
  }

  async function runStats() {
    var box = $('wriBody'); if (!box) return;
    box.innerHTML = '<div class="wr-msg">⏳ 분석 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports/insights' + insightQs(true));
      var d = WRI.data = r.data;
      var sel = $('wriTeam');
      if (sel && sel.options.length <= 1) (d.teams || []).forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = t; if (t === WRI.team) o.selected = true; sel.appendChild(o); });
      if (!d.weekly || !d.weekly.length) {
        box.innerHTML = '<div class="wr-msg wr-box">이 기간에 저장된 주간 보고가 없습니다 — 기간을 늘리거나 ✍️ 작성 · 📤 업로드로 보고서를 넣어 주세요</div>';
        return;
      }
      WRI.sel = {};
      box.innerHTML = insightHtml(d);
      var ge = $('wriGoalEdit'); if (ge) ge.addEventListener('click', openGoalEditor);
      box.querySelectorAll('[data-risk]').forEach(function (b) {
        b.addEventListener('click', function () {
          WRI.risk = b.dataset.risk;
          var rb = $('wriRisk'); if (rb) rb.outerHTML = riskHtml(WRI.data);
          var el = $('wriRisk'); if (el && b.classList.contains('wri-k')) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          bindRiskTabs();
        });
      });
      bindRiskTabs();
    } catch (e) {
      box.innerHTML = '<div class="wr-err">분석 실패: ' + esc((e && e.data && e.data.message) || e.message || e) + '</div>';
    }
  }
  function bindRiskTabs() {
    var el = $('wriRisk'); if (!el) return;
    el.querySelectorAll('[data-rt]').forEach(function (b) {
      b.addEventListener('click', function () { WRI.risk = b.dataset.rt; el.outerHTML = riskHtml(WRI.data); bindRiskTabs(); });
    });
    // 일 누르기 → 주별 경과 (v13.311)
    el.querySelectorAll('.wri-ri[data-key]').forEach(function (r) {
      r.addEventListener('click', function (e) { if (e.target.closest('input,button,label')) return; openItemHistory(r.dataset.key); });
    });
    var q = $('wriQ');
    if (q) q.addEventListener('input', function () {
      WRI.q = q.value; var pos = q.selectionStart;
      var box = $('wriRisk'); box.outerHTML = riskHtml(WRI.data); bindRiskTabs();
      var q2 = $('wriQ'); if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (x) {} }
    });
    el.querySelectorAll('input[data-sel]').forEach(function (c) {
      c.addEventListener('change', function () { if (c.checked) WRI.sel[c.dataset.sel] = true; else delete WRI.sel[c.dataset.sel]; drawMergeBar(); });
    });
    var mb = $('wriMerge'); if (mb) mb.addEventListener('click', mergeSelected);
    var mc = $('wriMergeClr'); if (mc) mc.addEventListener('click', function () { WRI.sel = {}; el.querySelectorAll('input[data-sel]').forEach(function (c) { c.checked = false; }); drawMergeBar(); });
    drawMergeBar();
  }
  function drawMergeBar() {
    var bar = $('wriMergeBar'); if (!bar) return;
    var n = Object.keys(WRI.sel).length;
    bar.hidden = n < 1;
    var t = $('wriMergeN'); if (t) t.textContent = n + '개 고름' + (n < 2 ? ' — 하나 더 고르세요' : '');
    var mb = $('wriMerge'); if (mb) mb.disabled = n < 2;
  }
  /* 같은 일로 묶기 — 가장 먼저 나온 일을 기준으로, 나머지(자동으로 이어 붙은 이름까지)를 그쪽으로 */
  async function mergeSelected() {
    var d = WRI.data; if (!d || !d.items) return;
    var picked = d.items.filter(function (i) { return WRI.sel[i.key]; });
    if (picked.length < 2) return;
    if (picked.some(function (i) { return i.team !== picked[0].team; })) { if (typeof showToast === 'function') showToast('같은 팀의 일끼리만 묶을 수 있습니다', 'warn'); return; }
    picked.sort(function (a, b) { return a.firstWeek < b.firstWeek ? -1 : a.firstWeek > b.firstWeek ? 1 : 0; });
    var target = picked[0], keys = [];
    picked.slice(1).forEach(function (i) { (i.variants || [{ key: i.key }]).forEach(function (v) { keys.push(v.key); }); });
    if (!confirm('아래 ' + picked.length + '개를 같은 일로 셉니다 (경과가 이어지고 납기 연기도 셈)\n\n' + picked.map(function (i) { return '· [' + i.client + '] ' + i.name + ' (' + i.firstWeek.slice(5) + '~)'; }).join('\n') + '\n\n나중에 일을 눌러 [따로 세기]로 되돌릴 수 있습니다.')) return;
    try {
      await apiFetch('/api/weekly-reports/item-links', { method: 'POST', body: JSON.stringify({ kind: 'merge', keys: keys, target: target.key }) });
      if (typeof showToast === 'function') showToast('🔗 같은 일로 묶었습니다', 'ok');
      WRI.sel = {};
      runStats();
    } catch (e) { if (typeof showToast === 'function') showToast('묶기 실패: ' + ((e && e.data && e.data.message) || e.message || e), 'error'); }
  }

  /* ─── 🎯 목표 (v13.311) — 정해 둔 값과 이 기간 실적 ─── */
  var WRI_METRICS = {
    throughput: ['주당 끝낸 일', '건', 'ge', true], completionRate: ['완료율 (최근 4주 평균)', '%', 'ge', false], onTimeRate: ['기한 안 완료율', '%', 'ge', true],
    cycle: ['끝내는 데 걸린 주 (평균)', '주', 'le', true], overdue: ['납기 지난 일', '건', 'le', true], stalled: ['정체된 일', '건', 'le', true], active: ['동시에 진행 중', '건', 'le', true]
  };
  function goalHtml(d) {
    var gs = d.goals || [];
    var h = '<div class="wr-card wri-sec" id="wriGoals"><div class="wri-h">🎯 목표 <span class="wri-ks">' + esc(WRI.team || '모든 팀') + ' · 이 기간 실적과 비교</span>'
      + '<button class="btn btn-g btn-s wri-gedit" id="wriGoalEdit" type="button">✏️ 목표 정하기</button></div>';
    if (!gs.length) return h + '<div class="wri-ks">주당 끝낼 일 · 기한 안 완료율 · 한 사람이 동시에 맡을 일 수 같은 목표를 정해 두면 여기서 실적과 비교합니다.</div></div>';
    var okN = gs.filter(function (g) { return g.ok; }).length;
    h = h.replace('이 기간 실적과 비교</span>', '이 기간 실적과 비교 · 달성 ' + okN + '/' + gs.length + '</span>');
    return h + '<div class="wri-goals">' + gs.map(function (g) {
      var col = g.ok == null ? 'var(--t5)' : g.ok ? '#1a8a40' : g.ratio >= 80 ? '#c8730a' : '#d21f1f';
      return '<div class="wri-g"><div class="wri-g1"><span class="wri-gl">' + (g.member ? '👤 ' + esc(g.member) + ' · ' : '') + esc(g.label) + '</span>'
        + '<b style="color:' + col + '">' + (g.actual == null ? '-' : esc(String(g.actual)) + g.unit) + '</b>'
        + '<span class="wri-ks">목표 ' + (g.dir === 'ge' ? '≥ ' : '≤ ') + esc(String(g.target)) + g.unit + (g.ok == null ? '' : g.ok ? ' ✅' : ' ❌') + '</span></div>'
        + '<div class="wri-gbar"><i style="width:' + (g.ratio || 0) + '%;background:' + col + '"></i></div></div>';
    }).join('') + '</div></div>';
  }
  function openGoalEditor() {
    var d = WRI.data || {};
    var members = (d.byMember || []).map(function (m) { return m.key; }).filter(function (k) { return k && k !== '(담당 없음)'; });
    var rows = (d.goals || []).map(function (g) { return { member: g.member, metric: g.metric, target: g.target }; });
    if (!rows.length) rows = [{ member: '', metric: 'throughput', target: '' }, { member: '', metric: 'onTimeRate', target: 80 }];
    return wmGuardedModal('wriGoals', function () {
      var m = createModal({ id: 'wriGoalModal', title: '🎯 목표 정하기 — ' + esc(WRI.team || '모든 팀'), width: '560px', closeOnEsc: true,
        html: '<div class="wri-ks" style="margin:-6px 0 8px">분석 탭에서 고른 기간의 실적과 비교합니다. 팀을 바꾸면 그 팀 목표를 따로 정합니다.</div>'
          + '<div id="wriGoalRows" class="wri-grs"></div>'
          + '<button type="button" class="btn btn-g btn-s" id="wriGoalAdd">＋ 목표 추가</button>'
          + '<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:12px"><button type="button" class="btn btn-g" id="wriGoalCancel">취소</button><button type="button" class="wm-pri" id="wriGoalSave">💾 저장</button></div>' });
      function rowHtml(g, i) {
        var mem = '<select data-f="member" class="wr-inp"><option value="">팀 전체</option>' + members.concat(g.member && members.indexOf(g.member) < 0 ? [g.member] : []).map(function (n) { return '<option' + (n === g.member ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>';
        var met = '<select data-f="metric" class="wr-inp">' + Object.keys(WRI_METRICS).map(function (k) { var x = WRI_METRICS[k]; return '<option value="' + k + '"' + (k === g.metric ? ' selected' : '') + (g.member && !x[3] ? ' disabled' : '') + '>' + x[0] + '</option>'; }).join('') + '</select>';
        var u = WRI_METRICS[g.metric] || WRI_METRICS.throughput;
        return '<div class="wri-gr" data-i="' + i + '">' + mem + met + '<span class="wri-gv"><span class="wri-gop">' + (u[2] === 'ge' ? '≥' : '≤') + '</span>'
          + '<input data-f="target" class="wr-inp" type="number" min="0" step="0.1" inputmode="decimal" value="' + esc(g.target === '' || g.target == null ? '' : String(g.target)) + '"><span class="wri-gu">' + u[1] + '</span>'
          + '<button type="button" class="btn btn-g btn-s" data-del="' + i + '" title="빼기">✕</button></span></div>';
      }
      function read() {
        rows = [].map.call(document.querySelectorAll('#wriGoalRows .wri-gr'), function (r) {
          return { member: r.querySelector('[data-f=member]').value, metric: r.querySelector('[data-f=metric]').value, target: r.querySelector('[data-f=target]').value };
        });
      }
      function draw() {
        var box = $('wriGoalRows'); if (!box) return;
        box.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<div class="wri-ks">목표가 없습니다 — 저장하면 모두 지웁니다</div>';
        box.querySelectorAll('select').forEach(function (s) { s.addEventListener('change', function () { read(); if (s.dataset.f === 'member' && s.value) rows.forEach(function (r) { if (r.member && WRI_METRICS[r.metric] && !WRI_METRICS[r.metric][3]) r.metric = 'throughput'; }); draw(); }); });
        box.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { read(); rows.splice(+b.dataset.del, 1); draw(); }); });
      }
      draw();
      $('wriGoalAdd').addEventListener('click', function () { read(); rows.push({ member: '', metric: 'throughput', target: '' }); draw(); });
      $('wriGoalCancel').addEventListener('click', m.close);
      $('wriGoalSave').addEventListener('click', async function () {
        read();
        var list = rows.filter(function (r) { return String(r.target).trim() !== ''; });
        var b = this; b.disabled = true;
        try {
          await apiFetch('/api/weekly-reports/goals', { method: 'PUT', body: JSON.stringify({ team: WRI.team || '', goals: list }) });
          m.close();
          if (typeof showToast === 'function') showToast('🎯 목표 저장', 'ok');
          runStats();
        } catch (e) {
          b.disabled = false;
          if (typeof showToast === 'function') showToast('저장 실패: ' + ((e && e.data && e.data.message) || e.message || e), 'error');
        }
      });
    }, 'wriGoalModal');
  }

  /* ─── 일 하나의 주별 경과 (v13.311) — 이름 · 진행률 · 납기 · 세부가 주마다 어떻게 바뀌었나 ─── */
  function openItemHistory(key) {
    return wmGuardedModal('wriItem', async function () {
      var r = await apiFetch('/api/weekly-reports/insights/item?key=' + encodeURIComponent(key) + '&weeks=' + Math.max(WRI.weeks, 26));
      var it = r.data;
      var st = WRI_STATE[it.state] || WRI_STATE.open;
      var m = createModal({ id: 'wriItemModal', width: '760px', closeOnEsc: true, closeOnOverlay: true,
        title: '<span style="color:' + st[2] + ';font-size:12px">' + st[0] + ' ' + st[1] + '</span> <b>' + esc(it.client) + '</b> ' + esc(it.name),
        html: itemHistHtml(it) });
      m.box.querySelectorAll('[data-lk]').forEach(function (b) {
        b.addEventListener('click', async function () {
          var kind = b.dataset.lk, k = b.dataset.k;
          if (kind === 'split' && !confirm('[' + (b.dataset.n || '') + '] 을(를) 이 일과 따로 셉니다. 계속할까요?')) return;
          try {
            await apiFetch('/api/weekly-reports/item-links', { method: 'POST', body: JSON.stringify({ kind: kind, key: k }) });
            m.close();
            if (typeof showToast === 'function') showToast(kind === 'split' ? '✂ 따로 셉니다' : '↺ 자동 잇기로 되돌렸습니다', 'ok');
            runStats();
          } catch (e) { if (typeof showToast === 'function') showToast('실패: ' + ((e && e.data && e.data.message) || e.message || e), 'error'); }
        });
      });
    }, 'wriItemModal');
  }
  function itemHistHtml(it) {
    function md(s) { return s ? s.slice(5).replace('-', '/') : '-'; }
    var dl = it.deadline ? (it.deadlineFirst && it.deadlineFirst !== it.deadline ? '<s>' + md(it.deadlineFirst) + '</s> → ' : '') + md(it.deadline) : '-';
    var h = '<div class="wri-ih">'
      + '<span>👤 ' + esc(it.members.join(' · ') || '-') + '</span><span>📅 ' + dl + (it.slips ? ' <em>연기 ' + it.slips + '번</em>' : '') + '</span>'
      + '<span>⏱ ' + md(it.firstWeek) + ' ~ ' + md(it.lastWeek) + ' · ' + it.weeks + '주' + (it.cycleWeeks ? ' · ' + it.cycleWeeks + '주 만에 끝냄' : '') + '</span>'
      + '<span>' + esc(it.sectionLabel) + '</span>'
      + (it.expected != null && !it.doneWeek ? '<span>진행률 ' + (it.pct == null ? '-' : it.pct + '%') + ' · 일정상 ' + it.expected + '%</span>' : '') + '</div>';
    h += histChart(it);
    var prev = null;
    h += '<div class="wri-hl">' + it.hist.map(function (x) {
      var chg = [];
      if (prev) {
        if (x.name !== prev.name || x.client !== prev.client) chg.push('이름 바뀜');
        if (x.deadline && prev.deadline && x.deadline !== prev.deadline) chg.push('납기 ' + esc(prev.deadline) + ' → ' + esc(x.deadline));
        if (x.pct != null && prev.pct != null && x.pct === prev.pct && x.status !== 'done') chg.push('진행률 그대로');
      }
      prev = x;
      var row = '<div class="wri-hr"><div class="wri-hw">' + md(x.w) + '<span>' + (x.kind === 'result' ? '결과' : '계획') + '</span></div><div class="wri-hb">'
        + '<div class="wri-h1">' + iconSlot(statusIcon(x.status === 'none' ? 'planned' : x.status)) + '<span class="wri-hn">' + esc(x.name) + '</span>'
        + (x.pct != null ? pctBadge(x.pct) : '') + (x.deadline ? '<span class="wri-hd">' + esc(x.deadline) + '</span>' : '')
        + (x.members.length ? '<span class="wri-hm">@' + esc(x.members.join(' @')) + '</span>' : '') + '</div>'
        + (chg.length ? '<div class="wri-hc">' + chg.map(function (c) { return '<em>' + c + '</em>'; }).join('') + '</div>' : '')
        + (x.details.length ? '<ul class="wri-hdt">' + x.details.map(function (dd) { return '<li>' + esc(dd.text) + (dd.status === 'done' ? ' ✓' : '') + '</li>'; }).join('') + '</ul>' : '')
        + '</div></div>';
      return row;
    }).reverse().join('') + '</div>';
    // 이어 붙인 이름 · 묶기 / 나누기
    var v = it.variants || [];
    if (v.length > 1 || it.split) {
      h += '<div class="wri-vs"><div class="wri-h" style="font-size:12px">🔗 이 일로 센 이름 ' + (it.linked === 'manual' ? '<span class="wri-ks">손으로 묶음 포함</span>' : it.linked === 'auto' ? '<span class="wri-ks">이름이 비슷해서 자동으로 이음</span>' : '') + '</div>';
      v.forEach(function (x) {
        h += '<div class="wri-v"><span>' + esc(x.name) + (x.key === it.key ? ' <span class="wri-ks">(기준)</span>' : '') + '</span>'
          + (x.key === it.key ? '' : '<button type="button" class="btn btn-g btn-s" data-lk="split" data-k="' + esc(x.key) + '" data-n="' + esc(x.name) + '">✂ 따로 세기</button>') + '</div>';
      });
      if (it.split) h += '<div class="wri-v"><span class="wri-ks">이 일은 비슷한 이름과 잇지 않고 따로 셉니다</span><button type="button" class="btn btn-g btn-s" data-lk="reset" data-k="' + esc(it.key) + '">↺ 자동 잇기로</button></div>';
      h += '</div>';
    } else {
      h += '<div class="wri-ks" style="margin-top:8px">이름을 크게 바꿔 다른 일로 세어졌다면 — 📋 모든 일 탭에서 두 일을 골라 [🔗 같은 일로 묶기]</div>';
    }
    return h;
  }
  /* 경과 그림 — 진행률(실선) · 일정상 진행률(점선) · 납기 바뀐 주 */
  function histChart(it) {
    var hs = it.hist.filter(function (x) { return x.pct != null; });
    if (hs.length < 2) return '';
    var W = 680, H = 110, L = 28, R = 8, T = 8, B = 20, n = it.hist.length, cw = W - L - R, ch = H - T - B;
    function xOf(i) { return L + (n === 1 ? cw / 2 : i / (n - 1) * cw); }
    function yOf(p) { return T + ch - p / 100 * ch; }
    var s = '<div class="wri-chart"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px;height:auto">';
    [0, 50, 100].forEach(function (g) { s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yOf(g) + '" y2="' + yOf(g) + '" stroke="var(--bd)" stroke-dasharray="3 3"/><text x="' + (L - 4) + '" y="' + (yOf(g) + 3) + '" font-size="9" text-anchor="end" fill="var(--t5)">' + g + '</text>'; });
    var pts = [];
    it.hist.forEach(function (x, i) {
      if (x.pct != null) pts.push(xOf(i).toFixed(1) + ',' + yOf(x.pct).toFixed(1));
      s += '<text x="' + xOf(i).toFixed(1) + '" y="' + (H - 6) + '" font-size="9" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '" fill="var(--t5)">' + x.w.slice(5).replace('-', '/') + '</text>';
    });
    // 일정상 — 처음 주 0% 에서 마지막 납기 100% 까지 곧게
    if (it.deadline && it.firstWeek < it.deadline) {
      var t0 = Date.parse(it.firstWeek), span = Date.parse(it.deadline) - t0;
      var ep = it.hist.map(function (x, i) { return xOf(i).toFixed(1) + ',' + yOf(Math.max(0, Math.min(100, (Date.parse(x.w) - t0) / span * 100))).toFixed(1); });
      s += '<polyline points="' + ep.join(' ') + '" fill="none" stroke="#c8730a" stroke-width="1.4" stroke-dasharray="4 3"><title>일정상 진행률</title></polyline>';
    }
    (it.dlHist || []).slice(1).forEach(function (dh) {
      var i = it.hist.map(function (x) { return x.w; }).indexOf(dh.w); if (i < 0) return;
      s += '<line x1="' + xOf(i) + '" x2="' + xOf(i) + '" y1="' + T + '" y2="' + (T + ch) + '" stroke="#d21f1f" stroke-width="1" opacity=".5"><title>납기 → ' + dh.d + '</title></line>';
    });
    s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--ac)" stroke-width="2.2"/>';
    pts.forEach(function (p) { var xy = p.split(','); s += '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="2.6" fill="var(--ac)"/>'; });
    return s + '</svg></div><div class="wri-ks">실선 = 진행률 · 주황 점선 = 일정상(처음 본 주 → 납기) · 빨간 세로선 = 납기 바뀐 주</div>';
  }

  function kpiTile(label, val, sub, color, risk) {
    return '<div class="wri-k' + (risk ? ' wri-k-go' : '') + '"' + (risk ? ' data-risk="' + risk + '" title="눌러서 목록 보기"' : '') + '>'
      + '<div class="wri-kv"' + (color ? ' style="color:' + color + '"' : '') + '>' + esc(String(val == null ? '-' : val)) + '</div>'
      + '<div class="wri-kl">' + esc(label) + '</div>' + (sub ? '<div class="wri-ks">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function insightHtml(d) {
    var k = d.kpi;
    var h = '<div class="wri-range">' + esc(d.range.from) + ' ~ ' + esc(d.range.to) + ' · ' + d.range.weeks + '주 · 보고서 ' + d.range.reports + '개 · 일 ' + k.items + '개</div>';
    h += '<div class="wri-kpis">'
      + kpiTile('진행 중', k.active, '평균 ' + k.wipAvg + '건/주')
      + kpiTile('주당 끝냄', k.throughput, '모두 ' + k.done + '건', '#1a8a40')
      + kpiTile('끝내는 데', k.cycleMedian == null ? '-' : k.cycleMedian + '주', '중앙값 · 평균 ' + (k.cycleAvg == null ? '-' : k.cycleAvg + '주'))
      + kpiTile('기한 안 완료', k.onTimeRate == null ? '-' : k.onTimeRate + '%', '납기 있던 일', k.onTimeRate == null ? '' : k.onTimeRate >= 80 ? '#1a8a40' : k.onTimeRate >= 60 ? '#c8730a' : '#d21f1f')
      + kpiTile('납기 지남', k.overdue, '', k.overdue ? '#d21f1f' : '', 'overdue')
      + kpiTile('뒤처짐', k.atRisk, '일정 대비 -20%p', k.atRisk ? '#c8730a' : '', 'atRisk')
      + kpiTile('정체', k.stalled, '3주째 그대로', k.stalled ? '#7c5cff' : '', 'stalled')
      + kpiTile('납기 연기', k.slipped, k.slipsTotal ? '모두 ' + k.slipsTotal + '번' : '', k.slipped ? '#c8730a' : '', 'slipped')
      + '</div>';
    h += goalHtml(d);
    if (d.findings && d.findings.length) {
      var dot = { risk: '#d21f1f', warn: '#c8730a', good: '#1a8a40', info: 'var(--t5)' };
      h += '<div class="wr-card wri-sec"><div class="wri-h">🔎 결론</div><ul class="wri-find">'
        + d.findings.map(function (f) { return '<li><span style="background:' + (dot[f.level] || dot.info) + '"></span>' + esc(f.text) + '</li>'; }).join('')
        + '</ul><div id="wriAiOut"></div></div>';
    } else h += '<div id="wriAiOut"></div>';
    h += '<div class="wr-card wri-sec"><div class="wri-h">📊 주별 추세 <span class="wri-legend"><i style="background:#1a8a40"></i>완료 <i style="background:#d21f1f"></i>진행 <i style="background:#8fa7d8"></i>예정 <i class="ln"></i>완료율' + (goalRate(d) != null ? ' <i class="ln gl"></i>목표' : '') + '</span></div>' + trendSvg(d.weekly, goalRate(d)) + '</div>';
    h += riskHtml(d);
    h += '<div class="wr-card wri-sec"><div class="wri-h">👤 사람별 효율</div><div class="wr-tbl-wrap"><table class="wr-tbl wri-tbl"><thead><tr>'
      + ['담당', '전체', '끝냄', '진행', '지남', '정체', '뒤처짐', '끝내는 데', '기한 안', '주당'].map(th).join('') + '</tr></thead><tbody>'
      + d.byMember.map(function (m) {
          return '<tr>' + td('<b>' + esc(m.key) + '</b>') + td(m.items) + td(m.done) + td(m.active)
            + td(m.overdue ? '<span class="wri-bad">' + m.overdue + '</span>' : '0') + td(m.stalled ? '<span class="wri-warn">' + m.stalled + '</span>' : '0')
            + td(m.atRisk ? '<span class="wri-warn">' + m.atRisk + '</span>' : '0')
            + td(m.cycleAvg == null ? '-' : m.cycleAvg + '주') + td(m.onTimeRate == null ? '-' : m.onTimeRate + '%') + td(m.throughput) + '</tr>';
        }).join('') + '</tbody></table></div></div>';
    h += '<div class="wri-2">' + barList('🧩 분야별', d.bySection.map(function (s) { return { k: s.label, n: s.items, d: s.done, c: s.cycleAvg }; }))
      + barList('🏢 업체별 (많은 순)', d.byClient.map(function (s) { return { k: s.key, n: s.items, d: s.done, c: s.cycleAvg }; })) + '</div>';
    return h;
  }

  function barList(title, rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.n; }).concat([1]));
    return '<div class="wr-card wri-sec"><div class="wri-h">' + title + '</div>' + rows.map(function (r) {
      return '<div class="wri-bl"><span class="wri-bk" title="' + esc(r.k) + '">' + esc(r.k) + '</span><span class="wri-bb"><i style="width:' + Math.round(r.n / max * 100) + '%"></i><i class="d" style="width:' + Math.round(r.d / max * 100) + '%"></i></span>'
        + '<span class="wri-bn">' + r.d + '/' + r.n + (r.c != null ? ' · ' + r.c + '주' : '') + '</span></div>';
    }).join('') + '<div class="wri-ks" style="margin-top:4px">진한 색 = 끝낸 일 · 숫자 = 끝냄/전체 · 끝내는 데 걸린 평균 주</div></div>';
  }

  function goalRate(d) {
    var g = (d.goals || []).filter(function (x) { return x.metric === 'completionRate' && !x.member; })[0];
    return g ? g.target : null;
  }
  function riskList(d) {
    if (WRI.risk !== 'all') return d.risks[WRI.risk] || [];
    var q = String(WRI.q || '').trim().toLowerCase();
    var ord = { overdue: 0, at_risk: 1, stalled: 2, on_track: 3, open: 4, dropped: 5, done_late: 6, done: 7 };
    return (d.items || []).filter(function (i) { return !q || (i.client + ' ' + i.name + ' ' + i.members.join(' ')).toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return (ord[a.state] - ord[b.state]) || (a.lastWeek < b.lastWeek ? 1 : a.lastWeek > b.lastWeek ? -1 : 0); });
  }
  function riskHtml(d) {
    var all = WRI.risk === 'all', list = riskList(d);
    var h = '<div class="wr-card wri-sec" id="wriRisk"><div class="wri-h">🚦 경과 체크 <span class="wri-ks">일을 누르면 주별 경과</span></div><div class="wri-rtabs">'
      + WRI_RISK.map(function (r) { var n = r[0] === 'all' ? (d.items || []).length : (d.risks[r[0]] || []).length; return '<button data-rt="' + r[0] + '" class="' + (WRI.risk === r[0] ? 'on' : '') + '">' + r[1] + ' <b>' + n + '</b></button>'; }).join('') + '</div>';
    if (all) h += '<div class="wri-allbar"><input id="wriQ" class="wr-inp" type="search" placeholder="업체 · 일 · 담당 찾기" value="' + esc(WRI.q || '') + '">'
      + '<span class="wri-ks">이름을 크게 바꿔 둘로 세어진 일은 둘 다 고르고 묶으세요</span></div>'
      + '<div class="wri-merge" id="wriMergeBar" hidden><span id="wriMergeN"></span><button type="button" class="wm-pri" id="wriMerge">🔗 같은 일로 묶기</button><button type="button" class="btn btn-g btn-s" id="wriMergeClr">고르기 취소</button></div>';
    if (!list.length) return h + '<div class="wr-msg">' + (all && WRI.q ? '찾는 일이 없습니다' : '해당 없음 👍') + '</div></div>';
    var more = all && list.length > 200 ? list.length - 200 : 0;
    h += '<div class="wri-rl">' + list.slice(0, all ? 200 : list.length).map(function (i) {
      var st = WRI_STATE[i.state] || WRI_STATE.open;
      var dl = i.deadline ? (i.deadlineFirst && i.deadlineFirst !== i.deadline ? '<s>' + esc(i.deadlineFirst.slice(5)) + '</s> → ' : '') + esc(i.deadline.slice(5)) : '-';
      return '<div class="wri-ri" data-key="' + esc(i.key) + '" title="눌러서 주별 경과">'
        + '<div class="wri-r1">' + (all ? '<input type="checkbox" data-sel="' + esc(i.key) + '"' + (WRI.sel[i.key] ? ' checked' : '') + ' aria-label="묶을 일로 고르기">' : '')
        + '<span class="wri-st" style="color:' + st[2] + '">' + st[0] + ' ' + st[1] + '</span><b class="wri-cl">' + esc(i.client) + '</b><span class="wri-nm">' + esc(i.name) + '</span>'
        + (i.linked ? '<span class="wri-lk" title="' + (i.linked === 'manual' ? '손으로 묶은 이름 포함' : '비슷한 이름을 자동으로 이음') + '">🔗' + (i.variants ? i.variants.length : '') + '</span>' : '') + '</div>'
        + '<div class="wri-r2">' + (i.members.length ? '<span>👤 ' + esc(i.members.join('·')) + '</span>' : '')
        + '<span>📅 ' + dl + (i.slips ? ' <em>연기 ' + i.slips + '번</em>' : '') + '</span>'
        + '<span>' + spark(i.pctHist) + (i.pct == null ? '' : ' ' + i.pct + '%') + (i.expected != null && ['at_risk', 'stalled', 'on_track', 'open'].indexOf(i.state) >= 0 ? ' <em title="처음 본 주부터 납기까지 고르게 했다면 지금쯤">일정상 ' + i.expected + '%</em>' : '') + '</span>'
        + '<span>⏱ ' + i.weeks + '주째 · ' + esc(i.sectionLabel) + '</span></div></div>';
    }).join('') + '</div>' + (more ? '<div class="wri-ks" style="margin-top:4px">… ' + more + '개 더 — 찾기로 좁혀 보세요</div>' : '') + '</div>';
    return h;
  }

  /* 진행률 흐름 — 작은 선 */
  function spark(hist) {
    if (!hist || hist.length < 2) return '';
    var w = 56, h = 14, n = hist.length;
    var pts = hist.map(function (p, i) { return Math.round(i / (n - 1) * w) + ',' + Math.round(h - p.p / 100 * h); }).join(' ');
    return '<svg class="wri-spk" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline points="' + pts + '" fill="none" stroke="var(--ac)" stroke-width="1.6"/></svg>';
  }

  /* 주별 막대(완료 · 진행 · 예정) + 완료율 선 + 새로/끝냄 */
  function trendSvg(ws, goal) {
    // 늘려 그리면 글자가 찌그러진다 → 지금 칸 폭을 재서 그 폭에 맞게 (좁으면 옆으로 밀어 봄)
    var box = $('wriBody'), avail = box ? box.clientWidth - 28 : 600;
    var n = ws.length, W = Math.max(avail, n * 44, 280), H = 170, top = 14, bot = 34, ch = H - top - bot;
    var max = Math.max.apply(null, ws.map(function (w) { return w.total; }).concat([1]));
    var bw = Math.min(26, W / n * 0.55), step = W / n;
    var s = '<div class="wri-chart"><svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">';
    [0.5, 1].forEach(function (g) { var y = top + ch - g * ch; s += '<line x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="var(--bd)" stroke-dasharray="3 3"/>'; });
    var line = [];
    ws.forEach(function (w, i) {
      var x = i * step + (step - bw) / 2, y = top + ch;
      [['done', '#1a8a40'], ['doing', '#d21f1f'], ['planned', '#8fa7d8']].forEach(function (p) {
        var hh = w[p[0]] / max * ch; if (!hh) return;
        y -= hh; s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hh.toFixed(1) + '" fill="' + p[1] + '" rx="2"><title>' + w.week + ' ' + p[0] + ' ' + w[p[0]] + '</title></rect>';
      });
      line.push((i * step + step / 2).toFixed(1) + ',' + (top + ch - w.completionRate / 100 * ch).toFixed(1));
      s += '<text x="' + (i * step + step / 2).toFixed(1) + '" y="' + (H - 18) + '" text-anchor="middle" font-size="10" fill="var(--t5)">' + w.week.slice(5).replace('-', '/') + '</text>';
      s += '<text x="' + (i * step + step / 2).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="9.5" fill="var(--t5)">+' + w.newItems + ' ✓' + w.closed + '</text>';
    });
    if (goal != null) {   // 🎯 완료율 목표선
      var gy = (top + ch - goal / 100 * ch).toFixed(1);
      s += '<line x1="0" x2="' + W + '" y1="' + gy + '" y2="' + gy + '" stroke="#1a8a40" stroke-width="1.4" stroke-dasharray="6 4"/><text x="' + (W - 2) + '" y="' + (gy - 3) + '" text-anchor="end" font-size="9.5" fill="#1a8a40">목표 ' + goal + '%</text>';
    }
    if (line.length > 1) s += '<polyline points="' + line.join(' ') + '" fill="none" stroke="var(--ac)" stroke-width="2"/>';
    line.forEach(function (p, i) { var xy = p.split(','); s += '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="2.6" fill="var(--ac)"><title>완료율 ' + ws[i].completionRate + '%</title></circle>'; });
    return s + '</svg></div><div class="wri-ks">막대 = 그 주 일 수 · 선 = 완료율 · 아래 +새로 생긴 일 ✓끝낸 일</div>';
  }

  /* ✨ AI 해석 — 숫자 요약을 AI 에게 (내용은 서버가 만든 요약 글 · 같은 AI 한도) */
  async function runInsightAi() {
    var out = $('wriAiOut'), d = WRI.data; if (!out || !d) return;
    var btn = $('wriAi'); if (btn) btn.disabled = true;
    out.innerHTML = '<div class="wr-msg">✨ AI 가 읽는 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports/insights' + insightQs(false) + '&text=1');
      var prompt = '다음은 우리 팀 주간 업무 보고를 주를 넘어 이어 붙여 계산한 분석 결과입니다. 숫자에 근거해서만 한국어로 답하세요.\n' +
        '1) 핵심 3줄 (정해 둔 목표가 있으면 달성 · 미달 먼저)  2) 위험한 일과 그 원인 추정(정체 · 연기 · 지남)  3) 다음 주 목표 제안 — 사람 · 일 이름을 넣어 구체적으로 3~5개  4) 효율을 높일 방법 2~3개\n' +
        '소제목은 ## 로, 목록은 - 로. 모르는 것은 지어내지 마세요.\n\n' + (r.data.text || '');
      var a = await apiFetch('/api/ai/summary', { method: 'POST', body: JSON.stringify({ prompt: prompt }) });
      var t = (a && a.data && a.data.text) || '';
      out.innerHTML = '<div class="wri-ai"><div class="wri-h">✨ AI 해석 <span class="wri-ks">' + esc((a.data.provider || '') + ' ' + (a.data.model || '')) + '</span></div>'
        + (typeof rMD === 'function' ? rMD(esc(t)) : esc(t).replace(/\n/g, '<br>')) + '</div>';
    } catch (e) {
      out.innerHTML = '<div class="wr-err">AI 해석 실패: ' + esc((e && e.data && e.data.message) || e.message || e) + '</div>';
    } finally { if (btn) btn.disabled = false; }
  }

  function downloadInsightCsv() {
    var d = WRI.data; if (!d) return;
    apiFetch('/api/weekly-reports/insights' + insightQs(true)).then(function (r) {
      var rows = [['팀', '분야', '업체', '일', '담당', '처음 주', '마지막 주', '주 수', '상태', '진행률', '일정상 진행률', '처음 납기', '지금 납기', '연기', '끝낸 주', '걸린 주', '기한 안']];
      (r.data.items || []).forEach(function (i) {
        rows.push([i.team, i.sectionLabel, i.client, i.name, i.members.join(' '), i.firstWeek, i.lastWeek, i.weeks, (WRI_STATE[i.state] || [])[1] || i.state,
          i.pct == null ? '' : i.pct, i.expected == null ? '' : i.expected, i.deadlineFirst || '', i.deadline || '', i.slips, i.doneWeek || '', i.cycleWeeks == null ? '' : i.cycleWeeks,
          i.onTime == null ? '' : (i.onTime ? 'Y' : 'N')]);
      });
      var csv = '﻿' + rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = '주간업무_분석_' + (d.range.to || '') + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
    }).catch(function (e) { if (typeof showToast === 'function') showToast('CSV 실패: ' + (e.message || e), 'error'); });
  }


  /* ─── 목록 ─── */
  async function renderList() {
    var box = $('wrPanel');
    box.innerHTML = '<div class="wr-msg">⏳ 불러오는 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports');
      var rows = r.data || [];
      if (!rows.length) {
        box.innerHTML = '<div class="wr-msg wr-box">업로드된 보고서가 없습니다</div>';
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
        + '<div class="wr-card wr-tbl-wrap">'
        +   '<table class="wr-tbl">'
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
      box.innerHTML = '<div class="wr-err">조회 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  /* ─── 미리보기 ─── */
  var _previewState = { id: null, pane: 'cur', data: null };
  async function renderPreview(id) {
    var box = $('wrPanel');
    box.innerHTML = '<div class="wr-msg">⏳ 불러오는 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports/' + encodeURIComponent(id));
      _previewState.id = id;
      _previewState.data = r.data;
      _previewState.pane = 'cur';
      drawPreview();
    } catch (e) {
      box.innerHTML = '<div class="wr-err">불러오기 실패: ' + esc(e.message || e) + '</div>';
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
     작성 탭 — 편집기 + 라이브 프리뷰 + 업무일지 데이터 인서트
     ═══════════════════════════════════════════════════════════ */

  function clientParseText(text) { return WRP.parseText(text); }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var LS_SHOW_PV = 'wr-author-show-pv';
  var LS_SRC_WIDTH = 'wr-src-width';
  var LS_SRC_COLLAPSED = 'wr-src-collapsed';
  var SRC_W_DEFAULT = 440, SRC_W_MIN = 320, SRC_W_MAX = 960;
  function clampSrcWidth(w) { return Math.max(SRC_W_MIN, Math.min(SRC_W_MAX, w || SRC_W_DEFAULT)); }

  // 작성 탭 상태
  var _authorState = {
    team: '소프트웨어팀',   // 기본 팀 — 업무일지 패널도 같은 이름의 그룹을 고른다
    weekStart: '',
    weekEnd: '',
    lastText: '',
    curText: '',
    editPane: 'cur',
    previewPane: 'cur',
    viewMode: 'compare', // 'compare' = 지난주+금주 동시, 'single' = 토글
    loadedId: null,
    loadedName: '',
    loadedVersion: null,   // 덮어쓰기 충돌 확인용 (서버 version)
    savedSig: '\u0000',    // 마지막으로 불러오거나 저장한 내용 — 다르면 '저장 안 한 변경'
    showPreview: lsGet(LS_SHOW_PV) !== '0',
    workRecords: [],
    workRecordsKey: '',
    // 우측 업무일지 패널 — 지난주 업무를 팀/팀원으로 골라 요약·삽입
    src: {
      range: 'cur',         // cur = 작성 주차(기본) · prev = 작성 주차의 전주 · custom
      start: '', end: '',   // custom 일 때만 사용
      groupId: null,        // null = 아직 안 정함(작성 팀명과 같은 그룹 자동 선택) · '' = 전체
      members: null,        // null = 팀 전원 · [이름…] = 고른 팀원만
      q: '',
      view: 'raw',          // summary | raw (기본 원본)
      sumBy: 'order',       // order = 수주별(보고서 형태) · person = 담당자별
      rawBy: 'date',        // name | oclient | date | none (기본 날짜)
      target: 'cur',        // 삽입할 편집창 — 직접 고르기 전까지 기간을 따라감 (작성 주차 → 금주 · 지난주 → 지난주)
      targetAuto: true,
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
      + '<div class="wr-card wr-mb10">'
      +   '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      +     '<label style="font-size:11px;color:var(--t5)">팀</label>'
      +     '<input id="wrAuTeam" type="text" placeholder="소프트웨어팀" value="' + esc(_authorState.team) + '" class="wr-inp wr-inp-sm" style="width:140px">'
      +     '<label style="font-size:11px;color:var(--t5);margin-left:6px">주차</label>'
      +     '<input id="wrAuStart" type="date" value="' + esc(_authorState.weekStart) + '" class="wr-inp wr-inp-sm">'
      +     '<span style="color:var(--t6)">~</span>'
      +     '<input id="wrAuEnd" type="date" value="' + esc(_authorState.weekEnd) + '" class="wr-inp wr-inp-sm">'
      +     '<span class="wm-seg" title="뷰 모드">'
      +       '<button class="' + (_authorState.viewMode === 'compare' ? 'on' : '') + '" data-vm="compare" title="지난주 · 금주를 위아래로">비교</button>'
      +       '<button class="' + (_authorState.viewMode === 'single'  ? 'on' : '') + '" data-vm="single">단일</button>'
      +     '</span>'
      +     '<span class="wm-seg"><button id="wrAuPvToggle" class="' + (_authorState.showPreview ? 'on' : '') + '" title="미리보기를 숨기면 편집창이 전체 폭을 씁니다">👁 미리보기</button></span>'
      +     '<div class="wm-tb-sp"></div>'
      +     '<span id="wrAuStatusBadge" style="font-size:11px;color:var(--t5);flex:1 1 120px;min-width:0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>'
      +     '<button id="wrAuLoadList" class="btn btn-g" title="저장된 보고서 열기">📂 불러오기</button>'
      +     '<button id="wrAuOverwrite" class="btn btn-g" style="display:none">💾 덮어쓰기</button>'
      +     '<button id="wrAuSave" class="wm-pri">💾 저장 (R+1)</button>'
      +     '<div class="hdr-pop" id="wrAuMoreWrap">'
      +       '<button class="btn btn-g wm-more" onclick="wmHdrPop(\'wrAuMoreWrap\')" title="새로 만들기 · 지난주에서 가져오기 · HTML" aria-haspopup="true" aria-expanded="false">⋯</button>'
      +       '<div class="hdr-pop-menu" role="menu">'
      +         '<button id="wrAuNew" class="hdr-mi" role="menuitem">📋 새로 만들기</button>'
      +         '<button id="wrAuLoadPrev" class="hdr-mi" role="menuitem" title="가장 최근 주의 curText를 lastText로 복사">⬅ 지난주에서 가져오기</button>'
      +         '<div class="hdr-mi-sep"></div>'
      +         '<button id="wrAuExport" class="hdr-mi" role="menuitem" title="iframe 임베드용 HTML 복사/다운로드">📋 HTML 내보내기</button>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div id="wrAuExportPanel" style="display:none;margin-top:8px;padding:10px;background:var(--bg-i);border:1px solid var(--bd);border-radius:6px"></div>'
      +   '<div id="wrAuLoadDropdown" style="display:none;margin-top:8px"></div>'
      + '</div>'
      + '<div id="wrAuCheck"></div>'
      + '<div id="wrAuWork" class="wr-au-work' + (_authorState.src.collapsed ? ' src-off' : '') + '" style="--wr-src-w:' + _authorState.src.width + 'px">'
      +   '<div id="wrAuEditArea" class="wr-au-edit">' + (_authorState.viewMode === 'compare' ? renderAuthorCompare() : renderAuthorSingle()) + '</div>'
      +   '<div id="wrSrcResizer" class="wr-src-resizer" title="드래그: 패널 폭 조절 · 더블클릭: 기본 폭"></div>'
      +   '<aside id="wrSrc" class="wr-src">' + renderSrcShell() + '</aside>'
      + '</div>';

    applyResponsiveAuthor();

    $('wrAuTeam').addEventListener('input', function (e) { _authorTouch(); _authorState.team = e.target.value.trim(); scheduleCheck(); });
    $('wrAuStart').addEventListener('change', function (e) { _authorTouch(); _authorState.weekStart = e.target.value; loadWorkRecords(); scheduleCheck(300); });
    $('wrAuEnd').addEventListener('change', function (e) { _authorTouch(); _authorState.weekEnd = e.target.value; loadWorkRecords(); });

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
    drawCheck(); scheduleCheck(400);
    // 마지막 보고서를 불러올 거면 그 주차로 한 번만 읽는다 (예전엔 이번 주를 읽고 곧바로 다시 읽음)
    var pending = autoLoadIfEmpty();
    if (pending) pending.then(function (loaded) { if (!loaded) ensureSrcRecords(); });
    else ensureSrcRecords();
  }

  function ensureSrcRecords() {
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
        +     paneDirtyBadge(key)
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
      +       '<button class="tab' + (_authorState.editPane === 'last' ? ' on' : '') + '" data-ep="last">지난주' + paneDirtyBadge('last', true) + '</button>'
      +       '<button class="tab' + (_authorState.editPane === 'cur'  ? ' on' : '') + '" data-ep="cur">금주' + paneDirtyBadge('cur', true) + '</button>'
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
      _authorTouch();
      var p = ed.dataset.pane || paneKey;
      _authorState[p === 'last' ? 'lastText' : 'curText'] = ed.value;
      _authorState.editPane = p; // 마지막 편집 페인 추적 (툴바 타겟 추정용)
      updatePaneDirtyBadges();   // 제목 '변경 중'은 바로 (미리보기만 디바운스)
      clearTimeout(debounceT);
      debounceT = setTimeout(function () { updateAuthorPreview(p); updateAuthorStatusBadge(); if (p === _authorState.src.target) refreshSrcMarks(); }, 200);
      scheduleCheck();
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

  // 지난주/금주 제목 옆 '● 변경 중' — 마지막으로 불러오거나 저장한 내용(savedSig)과 다르면 표시
  function paneDirtyBadge(pane, compact) {
    return '<span class="wr-dirty wr-pane-dirty" data-dirty-pane="' + pane + '" title="저장하지 않은 변경이 있습니다"'
      + ' style="font-size:10.5px;margin-left:' + (compact ? '4' : '0') + 'px;display:' + (isPaneDirty(pane) ? '' : 'none') + '">'
      + (compact ? '●' : '● 변경 중') + '</span>';
  }
  function isPaneDirty(pane) {
    var sig = _authorState.savedSig || '', i = sig.indexOf('\u0000');
    var saved = pane === 'last' ? sig.slice(0, i) : sig.slice(i + 1);
    return (_authorState[pane === 'last' ? 'lastText' : 'curText'] || '') !== saved;
  }
  function updatePaneDirtyBadges() {
    document.querySelectorAll('#wrAuEditArea [data-dirty-pane]').forEach(function (b) {
      b.style.display = isPaneDirty(b.dataset.dirtyPane) ? '' : 'none';
    });
  }

  function updateAuthorStatusBadge() {
    var el = $('wrAuStatusBadge');
    if (!el) return;
    var dirty = isDirty() ? ' <span class="wr-dirty" title="Ctrl+S 로 덮어쓰기">● 저장 안 됨</span>' : '';
    updatePaneDirtyBadges();
    if (_authorState.loadedId) {
      el.innerHTML = '✏️ 편집 중: <strong style="color:var(--t3)">' + esc(_authorState.loadedName) + '</strong>' + dirty;
      el.title = '편집 중: ' + _authorState.loadedName;
      var ow = $('wrAuOverwrite'); if (ow) ow.style.display = '';
    } else {
      el.innerHTML = '<span style="color:var(--t6)">새 보고서 (저장 시 자동 R 부여)</span>' + dirty;
      var ow2 = $('wrAuOverwrite'); if (ow2) ow2.style.display = 'none';
    }
  }

  function authorNew() {
    if (isDirty() && !confirm('저장하지 않은 내용이 사라집니다. 새로 만드시겠습니까?')) return;
    _authorState.lastText = '';
    _authorState.curText = '';
    _authorState.loadedId = null;
    _authorState.loadedName = '';
    _authorState.loadedVersion = null;
    _authorState.savedSig = textSig();
    forgetLoaded();
    renderAuthor();
  }

  // 작성 주차 바로 전(같은 팀 우선)의 가장 최근 버전 '금주' → 이번 '지난주'.
  // 예전엔 주차를 보지 않고 최근 10건 중 첫 건을 골라, 이번 주 보고서를 이미 저장했으면 자기 자신을 가져왔다
  async function authorLoadFromPrevWeek() {
    try {
      var before = _authorState.weekStart ? isoDate(new Date(mondayOf(_authorState.weekStart).getTime() - 86400000)) : '';
      var qs = '?limit=1' + (before ? '&to=' + before : '');
      var r = _authorState.team ? await apiFetch('/api/weekly-reports' + qs + '&team=' + encodeURIComponent(_authorState.team)) : { data: [] };
      if (!(r.data || []).length) r = await apiFetch('/api/weekly-reports' + qs);
      var match = (r.data || [])[0];
      if (!match) { alert('이 주차 전에 저장된 보고서가 없습니다.'); return; }
      var d = await apiFetch('/api/weekly-reports/' + encodeURIComponent(match.id));
      var prevCur = d.data && d.data.cur_text || '';
      if (!prevCur) { alert('이전 주 금주 텍스트가 비어있습니다.'); return; }
      if (_authorState.lastText && !confirm('현재 [지난주] 텍스트를 덮어씁니다. 진행할까요?')) return;
      _authorState.lastText = prevCur;
      _authorState.editPane = 'last';
      renderAuthor();
      if (typeof showToast === 'function') showToast('지난주 ← ' + match.name, 'ok');
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
          if (isDirty() && !confirm('저장하지 않은 내용이 있습니다. 버리고 불러올까요?')) return;
          try { await authorLoadById(b.dataset.loadId); $('wrAuLoadDropdown').style.display = 'none'; }
          catch (e) { alert('불러오기 실패: ' + (e.message || e)); }
        });
      });
    } catch (e) {
      dd.innerHTML = '<div style="color:#d03030;padding:6px;font-size:12px">조회 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  // v13.342 사용자가 팀 · 주차 · 글을 건드린 횟수 — 처음 열 때 자동 불러오기가 늦게 오면 그사이 바꾼 것을 덮지 않게
  function _authorTouch() { _authorState._touch = (_authorState._touch || 0) + 1; }
  async function authorLoadById(id, stillOk) {
    var r = await apiFetch('/api/weekly-reports/' + encodeURIComponent(id));
    if (stillOk && !stillOk()) return false;
    var d = r.data;
    // 주차는 이름(팀_26W17_04/20~04/24)에서 읽는다 — DATE 칼럼은 서버 시간대에 따라 하루 밀려 올 수 있다
    var meta = WRP.parseName(d.name);
    _authorState.loadedId = d.id;
    _authorState.loadedName = d.name;
    _authorState.loadedVersion = d.version;
    _authorState.team = d.team || _authorState.team;
    _authorState.weekStart = meta.weekStart || (d.week_start ? String(d.week_start).slice(0, 10) : _authorState.weekStart);
    _authorState.weekEnd = meta.weekEnd || (d.week_end ? String(d.week_end).slice(0, 10) : _authorState.weekEnd);
    _authorState.lastText = d.last_text || '';
    _authorState.curText = d.cur_text || '';
    _authorState.savedSig = textSig();
    rememberLoaded(d.id);
    renderAuthor();
  }

  // 새 버전(R+1)은 서버가 빈 번호를 골라 넣고, 덮어쓰기는 불러온 버전과 같을 때만 — 그 사이 남이 저장했으면 409
  var _saving = false;
  async function saveAuthor(asNewVersion) {
    if (_saving) return;
    syncAuthorEditorsToState();
    var overwrite = !asNewVersion && !!_authorState.loadedName;
    if (!overwrite) {
      if (!_authorState.team) { alert('팀명을 입력하세요.'); return; }
      if (!_authorState.weekStart || !_authorState.weekEnd) { alert('주차를 선택하세요.'); return; }
    }
    var sig = textSig();
    var payload = {
      savedAt: new Date().toISOString(),
      lastText: _authorState.lastText || '',
      curText: _authorState.curText || ''
    };
    if (overwrite) { payload.name = _authorState.loadedName; payload.baseVersion = _authorState.loadedVersion; }
    else payload.autoName = { team: _authorState.team, weekStart: _authorState.weekStart, weekEnd: _authorState.weekEnd };

    _saving = true;
    try {
      var resp = await apiFetch('/api/weekly-reports', { method: 'POST', body: JSON.stringify(payload) });
      var saved = resp.data && resp.data[0];
      if (!saved) throw new Error('응답이 비었습니다.');
      _authorState.loadedId = saved.id;
      _authorState.loadedName = saved.name;
      _authorState.loadedVersion = saved.version;
      _authorState.savedSig = sig;
      rememberLoaded(saved.id);
      if (typeof showToast === 'function') showToast('저장됨: ' + saved.name, 'ok');
      updateAuthorStatusBadge();
    } catch (e) {
      if (e && e.status === 409) {
        var by = (e.data && e.data.data && e.data.data.by) || '다른 사용자';
        if (confirm(by + ' 님이 그 사이 [' + _authorState.loadedName + '] 을(를) 저장했습니다.\n\n'
          + '덮어쓰면 그 내용이 사라집니다. 내 내용을 새 버전(R+1)으로 따로 저장할까요?')) {
          _saving = false;
          return await saveAuthor(true);
        }
      } else {
        alert('저장 실패: ' + (e.message || e));
      }
    } finally {
      _saving = false;
    }
  }

  /* ─── v13.311 작성 중 점검 — 분석 탭에서 보기 전에, 쓰는 순간 잡는다 ───
   * 바로 앞 주 보고서에 있던 일이 빠짐(끝냈나요?) · 납기 지남 · 3주째 정체 · 뒤처짐 · 이번에 납기 미룸 · 납기/담당 없음
   * 서버 POST /api/weekly-reports/check (분석과 같은 계산 · 손으로 묶은 것 반영) */
  var WRC = { seq: 0, t: null, data: null, open: lsGet('wr.chk.open') !== '0' };
  var WRC_KIND = { missing: ['❔', '빠짐', '#7a6a2a'], overdue: ['⛔', '납기 지남', '#d21f1f'], stalled: ['⏸', '정체', '#7c5cff'], at_risk: ['⚠️', '뒤처짐', '#c8730a'], slipped: ['📅', '납기 연기', '#c8730a'], quality: ['✎', '빠진 정보', 'var(--t5)'] };
  function scheduleCheck(ms) { clearTimeout(WRC.t); WRC.t = setTimeout(runCheck, ms == null ? 1200 : ms); }
  async function runCheck() {
    if (!$('wrAuCheck')) return;
    syncAuthorEditorsToState();
    var st = _authorState;
    if ((!(st.lastText || '').trim() && !(st.curText || '').trim()) || !st.weekStart) { WRC.data = null; drawCheck(); return; }
    var my = ++WRC.seq;
    try {
      var r = await apiFetch('/api/weekly-reports/check', { method: 'POST', body: JSON.stringify({ team: st.team, weekStart: st.weekStart, lastText: st.lastText || '', curText: st.curText || '' }) });
      if (my !== WRC.seq) return;
      WRC.data = r.data;
    } catch (e) { if (my !== WRC.seq) return; WRC.data = null; }
    drawCheck();
  }
  function wrcRow(kind, i, idx, acts) {
    var k = WRC_KIND[kind];
    return '<div class="wrc-r" data-wrc-go="' + idx + '" title="눌러서 편집창의 그 줄로">'
      + '<span class="wrc-k" style="color:' + k[2] + '">' + k[0] + ' ' + k[1] + '</span>'
      + '<span class="wrc-n"><b>' + esc(i.client) + '</b> ' + esc(i.name) + '</span>'
      + '<span class="wrc-t">' + esc(i.text || '') + '</span>' + (acts || '') + '</div>';
  }
  function drawCheck() {
    var box = $('wrAuCheck'); if (!box) return;
    var d = WRC.data;
    if (!d) { box.innerHTML = ''; return; }
    var go = WRC.go = [];
    var cnt = { missing: d.missing.length, quality: d.quality.length };
    d.flags.forEach(function (f) { cnt[f.kind] = (cnt[f.kind] || 0) + 1; });
    // ✍️ 글쓰기 — 📓 노트북 코치와 같은 규칙 (v13.318) · 진척 · 빠진 칸은 위 점검이 보므로 빼고 문장만
    var wr = typeof NbCoach !== 'undefined' ? NbCoach.check(_authorState.curText || '', { kind: 'weekly' }) : null;
    var wf = WRC.wf = wr ? wr.findings.filter(function (f) { return ['long', 'filler', 'passive', 'vague', 'double', 'spell', 'repeat'].indexOf(f.k) >= 0; }) : [];
    if (wr && wr.chars >= 30) wrCoachLog(wr, wf);
    var total = d.missing.length + d.flags.length + d.quality.length + wf.length;
    if (!total) {
      box.innerHTML = d.prevWeeks ? '<div class="wrc wrc-ok">✅ 점검 — 앞 주 보고서와 비교해 빠진 일 · 납기 · 정체 문제 없음</div>' : '';
      return;
    }
    var chips = ['missing', 'overdue', 'stalled', 'at_risk', 'slipped', 'quality'].filter(function (k) { return cnt[k]; }).map(function (k) {
      return '<span class="wrc-c" style="color:' + WRC_KIND[k][2] + '">' + WRC_KIND[k][0] + ' ' + WRC_KIND[k][1] + ' <b>' + cnt[k] + '</b></span>';
    }).join('') + (wf.length ? '<span class="wrc-c" style="color:var(--ac)">✍️ 글쓰기 <b>' + wf.length + '</b></span>' : '');
    var h = '<div class="wrc' + (WRC.open ? ' open' : '') + '"><button type="button" class="wrc-sum" data-wrc-tog aria-expanded="' + WRC.open + '">'
      + '<span class="wrc-ttl">🔎 점검</span>' + chips + '<span class="wrc-car">' + (WRC.open ? '▴' : '▾') + '</span></button>';
    if (WRC.open) {
      h += '<div class="wrc-body">';
      if (d.missing.length) {
        h += '<div class="wrc-g">' + (d.lastEmpty ? '지난주 칸이 비어 있어요 — 앞 주 보고서에 있던 일이 금주에도 없습니다. 끝냈으면 완료로, 계속하면 다시 넣으세요' : '앞 주 보고서에 있던 일이 이번 보고서에 없습니다 — 끝냈나요?') + '</div>';
        d.missing.forEach(function (m, n) {
          go.push(null);
          h += wrcRow('missing', { client: m.client, name: m.name, text: [m.pct != null ? m.pct + '%' : '', m.deadline ? '~' + m.deadline.slice(5).replace('-', '/') : '', (m.members || []).join('·')].filter(Boolean).join(' · ') }, go.length - 1,
            '<span class="wrc-acts"><button type="button" class="btn btn-g btn-s" data-wrc-done="' + n + '" title="지난주 칸에 #완료 로 넣기">✅ 완료로</button>'
            + '<button type="button" class="btn btn-g btn-s" data-wrc-keep="' + n + '" title="금주 칸에 그대로 다시 넣기">↩ 금주에</button></span>');
        });
      }
      d.flags.forEach(function (f) { go.push(f); h += wrcRow(f.kind, f, go.length - 1); });
      d.quality.forEach(function (q) { go.push(q); h += wrcRow('quality', q, go.length - 1); });
      if (wf.length) {
        h += '<div class="wrc-g">✍️ 글쓰기 — 누르면 금주 칸의 그 자리로 · 왜 그런지는 <a href="#" onclick="event.preventDefault();if(window.nbWriteStart)nbWriteStart()">✍️ 코치와 글쓰기 (Alt+W)</a></div>';
        wf.slice(0, 15).forEach(function (f, i) {
          var L = NbCoach.LABELS[f.k] || ['•', f.k];
          h += '<div class="wrc-r" data-wrc-w="' + i + '" title="' + esc(f.why + ' → ' + f.hint) + '"><span class="wrc-k">' + L[0] + ' ' + esc(L[1]) + '</span><b>' + esc(f.msg) + '</b>'
            + (f.quote ? '<span class="wrc-t">“' + esc(f.quote) + '”</span>' : '') + '</div>';
        });
      }
      h += '</div>';
    }
    box.innerHTML = h + '</div>';
    box.querySelector('[data-wrc-tog]').addEventListener('click', function () { WRC.open = !WRC.open; lsSet('wr.chk.open', WRC.open ? '1' : '0'); drawCheck(); });
    box.querySelectorAll('[data-wrc-done],[data-wrc-keep]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var done = b.hasAttribute('data-wrc-done'), m = d.missing[+(done ? b.dataset.wrcDone : b.dataset.wrcKeep)]; if (!m) return;
        var o = {}; o[SECTIONS[m.section] ? m.section : 'etc'] = [m.line + (done ? ' #완료' : '')];
        insertBlocksBySection(done ? 'last' : 'cur', o);
        runCheck();
      });
    });
    box.querySelectorAll('[data-wrc-go]').forEach(function (r) {
      r.addEventListener('click', function (e) { if (e.target.closest('button')) return; var f = go[+r.dataset.wrcGo]; if (f) jumpToItem(f.client, f.name); });
    });
    box.querySelectorAll('[data-wrc-w]').forEach(function (r) {
      r.addEventListener('click', function () {
        var f = WRC.wf[+r.dataset.wrcW]; if (!f) return;
        syncAuthorEditorsToState();
        var id = _authorState.viewMode === 'compare' ? 'wrAuEditorCur' : 'wrAuEditor';
        if (_authorState.viewMode !== 'compare' && _authorState.editPane !== 'cur') { _authorState.editPane = 'cur'; renderAuthor(); }
        var ta = $(id); if (!ta) return;
        var at = ta.value.indexOf(f.quote.slice(0, 30)), end = at >= 0 ? at + (f.end - f.start) : -1;
        if (at < 0) { at = f.start; end = f.end; }
        ta.focus(); ta.setSelectionRange(at, Math.min(end, ta.value.length));
        var lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
        ta.scrollTop = Math.max(0, (ta.value.slice(0, at).split('\n').length - 4) * lh);
        if (typeof showToast === 'function') showToast('✍️ ' + f.hint, 'info');
      });
    });
  }
  // 주간 업무 글쓰기 버릇도 📈 나의 글쓰기에 (1분에 한 번 · 바뀌었을 때)
  function wrCoachLog(wr, wf) {
    var cnt = {}; wf.forEach(function (f) { cnt[f.k] = (cnt[f.k] || 0) + 1; });
    var sig = JSON.stringify(cnt) + wr.chars;
    if (sig === WRC.logSig) return;
    clearTimeout(WRC.logT);
    WRC.logT = setTimeout(function () {
      WRC.logSig = sig;
      apiFetch('/api/notebook/coach/log', { method: 'POST', body: JSON.stringify({ noteId: 'weekly-' + (_authorState.weekStart || ''), kind: 'weekly', counts: cnt, scores: NbCoach.score(cnt, wr.chars, null), chars: wr.chars }) }).catch(function () {});
    }, 60000);
  }
  // 편집창에서 그 일의 줄을 찾아 고르기 (금주 칸 먼저)
  function jumpToItem(client, name) {
    syncAuthorEditorsToState();
    var pane = null, idx = -1;
    ['cur', 'last'].some(function (p) {
      var lines = String(_authorState[paneKeyText(p)] || '').split('\n');
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf(name) >= 0 && (!client || lines[i].indexOf(client) >= 0)) { pane = p; idx = i; return true; }
      }
      return false;
    });
    if (!pane) { if (typeof showToast === 'function') showToast('편집창에서 그 줄을 찾지 못했습니다', 'warn'); return; }
    var id = _authorState.viewMode === 'compare' ? (pane === 'last' ? 'wrAuEditorLast' : 'wrAuEditorCur') : 'wrAuEditor';
    if (_authorState.viewMode !== 'compare' && _authorState.editPane !== pane) { _authorState.editPane = pane; renderAuthor(); }
    var ta = $(id); if (!ta) return;
    var lines = ta.value.split('\n'), s = 0;
    for (var j = 0; j < idx; j++) s += lines[j].length + 1;
    ta.focus();
    ta.setSelectionRange(s, s + (lines[idx] || '').length);
    var lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (idx - 3) * lh);
    ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // 저장 안 한 변경 — 불러오기 · 새로 만들기 · 창 닫기 전에 묻는다
  function textSig() { return (_authorState.lastText || '') + '\u0000' + (_authorState.curText || ''); }
  function isDirty() { syncAuthorEditorsToState(); return textSig() !== _authorState.savedSig; }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', function (e) {
      if (!$('wrAuWork') || !isDirty()) return;
      e.preventDefault(); e.returnValue = '';
    });
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

  // 시도하면 Promise(불러왔으면 true), 시도할 게 없으면 null
  function autoLoadIfEmpty() {
    if (_authorState.loadedId || _authorState.lastText || _authorState.curText) return null;
    if (_authorState._autoLoadTried) return null;
    _authorState._autoLoadTried = true;
    var stored = null;
    try { stored = localStorage.getItem(LS_LAST_ID); } catch (e) {}
    var t0 = _authorState._touch || 0, stillOk = function () { return (_authorState._touch || 0) === t0; };
    return (async function () {
      try {
        if (stored) {
          try { return (await authorLoadById(stored, stillOk)) !== false; }
          catch (e) { forgetLoaded(); }
        }
        var r = await apiFetch('/api/weekly-reports?limit=1');
        if (!stillOk()) return false;
        if (r.data && r.data.length) return (await authorLoadById(r.data[0].id, stillOk)) !== false;
      } catch (e) { /* silent */ }
      return false;
    })();
  }

  /* ═══════════════════════════════════════════════════════════════
   * 우측 업무일지 패널 — 지난주 업무를 팀/팀원으로 골라 나열·요약하고 편집창에 삽입
   *   · 기간: 작성 주차(기본) / 작성 주차의 전주 / 직접 지정
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
      // 띄어쓰기 · 끝의 '팀' 차이는 같은 팀으로 본다 ("소프트웨어 팀" · "소프트웨어")
      var norm = function (v) { return String(v || '').replace(/\s+/g, '').replace(/팀$/, ''); };
      var hit = t ? (srcGroups().filter(function (g) { return g.name === t; })[0]
        || srcGroups().filter(function (g) { return norm(g.name) === norm(t); })[0]) : null;
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

  // 이미 넣은 항목 표시 — 대상 편집창에 같은 '- [사이트] 제목' 으로 시작하는 줄이 있으면 들어간 것으로 본다
  function lineHead(s) { return String(s || '').split('\n')[0].replace(/\s+/g, ' ').trim(); }
  function summaryHead(it) { return lineHead('- [' + reportSafe(it.site) + '] ' + reportSafe(it.title)); }
  function paneHasHead(lines, head) {
    for (var i = 0; i < lines.length; i++) { if (lines[i] === head || lines[i].indexOf(head + ' ') === 0) return true; }
    return false;
  }
  function paneLines(pane) {
    return (_authorState[paneKeyText(pane)] || '').split('\n').map(lineHead).filter(function (l) { return l.charAt(0) === '-'; });
  }
  function refreshSrcMarks() {
    var body = $('wrSrcBody');
    if (!body) return;
    var lines = paneLines(_authorState.src.target);
    body.querySelectorAll('[data-head]').forEach(function (b) {
      var on = paneHasHead(lines, b.getAttribute('data-head'));
      if (b.classList.contains('wr-ins-done') === on) return;
      b.classList.toggle('wr-ins-done', on);
      b.textContent = on ? '✓' : '＋';
      b.title = on ? '이미 ' + paneLabel(_authorState.src.target) + ' 편집창에 있음 — 누르면 한 번 더 넣음'
        : paneLabel(_authorState.src.target) + ' 편집창의 해당 섹션에 삽입';
    });
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
    updateAuthorStatusBadge();
  }

  // 섹션 인식 삽입 — { dev: [블록…], … } 를 대상 편집창의 해당 섹션 끝에 붙인다. 섹션이 없으면 새로 만든다
  function insertBlocksBySection(pane, bySec, skipped) {
    syncAuthorEditorsToState();
    var key = paneKeyText(pane);
    var lines = (_authorState[key] || '').split('\n');
    var added = 0;
    var headerType = WRP.sectionOfLine;
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
    refreshSrcMarks();
    if (typeof showToast === 'function') showToast(paneLabel(pane) + ' 편집창에 ' + added + '개 항목 삽입' + (skipped ? ' · ' + skipped + '개는 이미 있어 건너뜀' : ''), 'ok');
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
      $('wrSrcReload').addEventListener('click', function () { loadWorkRecords(true); });
      box.querySelectorAll('[data-src-range]').forEach(function (b) {
        b.addEventListener('click', function () { setSrcRange(b.dataset.srcRange); });
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
            if (p[1] === 'target') s.targetAuto = false;
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

  function setSrcRange(range) {
    var s = _authorState.src;
    if (s.range === range) return;
    if (range === 'custom') { var cr = srcRange(); s.start = cr.start; s.end = cr.end; }
    else if (s.targetAuto) s.target = range === 'prev' ? 'last' : 'cur';
    s.range = range;
    rerenderSrcShell();
    loadWorkRecords();
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
    if (typeof wmTouchDrag === 'function') wmTouchDrag(h);   // 패드 — 손가락으로 폭 조절 (v13.257)
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

  // 기간별로 기억 — 지난주 ↔ 작성 주차를 오가도 다시 받지 않는다 (↻ 는 새로 받음)
  var _recCache = {}, _recCacheKeys = [], REC_CACHE_MAX = 6, _recGen = 0;  // _recGen: 업무일지 변경 세대 — 변경 전에 시작한 조회는 캐시하지 않음
  function recCachePut(key, rows) {
    if (!_recCache[key]) _recCacheKeys.push(key);
    _recCache[key] = rows;
    while (_recCacheKeys.length > REC_CACHE_MAX) delete _recCache[_recCacheKeys.shift()];
  }

  // 업무일지가 바뀌면(업무일지 탭 다른파일 병합 등) 기간 캐시를 비운다 — 지금 보고 있으면 바로, 아니면 다음 진입 때 새로 받음
  if (typeof wmDataBus !== 'undefined') wmDataBus.on('workRecord', function () {
    _recCache = {}; _recCacheKeys = []; _recGen++;
    _authorState.workRecordsKey = '';
    if (typeof curPage !== 'undefined' && curPage === 'team' && curMode === 'weekly_report' && STATE.tab === 'author' && $('wrSrcBody')) loadWorkRecords(true);
  });

  async function loadWorkRecords(force) {
    var rg = srcRange();
    var body = $('wrSrcBody');
    if (!rg.start || !rg.end) { _authorState.workRecords = []; _authorState.workRecordsKey = ''; renderSrcDynamic(); return; }
    var key = rg.start + '~' + rg.end;
    _authorState.workRecordsKey = key;
    // 기간 입력칸이 prev/cur 모드면 작성 주차 변경을 따라가도록 갱신
    var si = $('wrSrcStart'), ei = $('wrSrcEnd');
    if (si && _authorState.src.range !== 'custom') { si.value = rg.start; ei.value = rg.end; }
    if (force !== true && _recCache[key]) { _authorState.workRecords = _recCache[key]; renderSrcDynamic(); return; }
    if (body) body.innerHTML = '<div class="wr-src-empty">⏳ 로드 중...</div>';
    var gen = _recGen;
    try {
      var r = await apiFetch('/api/archives/records?startDate=' + rg.start.replace(/-/g, '') + '&endDate=' + rg.end.replace(/-/g, '') + '&all=true&limit=5000');
      var rows = (r && r.data) || [];
      if (gen !== _recGen) return;                      // 그 사이 업무일지가 바뀜 — 새 조회가 이어서 그림
      recCachePut(key, rows);
      if (_authorState.workRecordsKey !== key) return; // 그 사이 기간이 바뀜
      _authorState.workRecords = rows;
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
      // 작성 주차 초반엔 아직 기록이 없다 — 지난주로 바로 넘어가는 버튼
      var toPrev = !_authorState.workRecords.length && s.range === 'cur'
        ? '<div style="margin-top:10px"><button class="tab" id="wrSrcToPrev">지난주 업무일지 보기</button></div>' : '';
      body.innerHTML = aiHtml + '<div class="wr-src-empty">' + (_authorState.workRecords.length ? '조건에 맞는 기록이 없습니다' : '이 기간의 업무일지가 없습니다') + toPrev + '</div>';
      bindSrcAiCard();
      var tp = $('wrSrcToPrev');
      if (tp) tp.addEventListener('click', function () { setSrcRange('prev'); });
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
    syncAuthorEditorsToState();
    refreshSrcMarks();
  }

  var _srcSummaryCache = [];
  // 여러 개 넣기는 이미 들어간 항목을 건너뛴다 (한 개씩 ＋ 는 그래도 넣을 수 있음)
  function insertSummaryItems(items) {
    if (!items.length) { alert('삽입할 항목이 없습니다.'); return; }
    var target = _authorState.src.target;
    syncAuthorEditorsToState();
    var lines = paneLines(target);
    var fresh = items.filter(function (it) { return !paneHasHead(lines, summaryHead(it)); });
    if (!fresh.length) { if (typeof showToast === 'function') showToast('모두 이미 ' + paneLabel(target) + ' 편집창에 있습니다', 'ok'); return; }
    var bySec = {};
    fresh.forEach(function (it) { (bySec[it.sec] = bySec[it.sec] || []).push(summaryItemText(it)); });
    insertBlocksBySection(target, bySec, items.length - fresh.length);
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
        +   '<button class="tab" data-sum-idx="' + idx + '" data-head="' + esc(summaryHead(it)) + '" title="' + paneLabel(s.target) + ' 편집창의 해당 섹션에 삽입">＋</button>'
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
              + '<button class="tab" data-src-sec="' + (srcSectionOf(r) || 'etc') + '" data-src-add="' + esc(inj) + '" data-head="' + esc(lineHead(inj)) + '" title="' + paneLabel(s.target) + ' 편집창의 해당 섹션에 삽입">＋</button>'
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
      var k = WRP.sectionOfLine(l);
      if (k && k !== '?') { flush(); cur = k; } else buf.push(l);
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
})();
