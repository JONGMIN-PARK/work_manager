/**
 * 업무일지 분석기 — 타임라인(간트) 뷰 모듈
 */

/* ═══ 메모 HTML 헬퍼 (v13.35~) — timeline.js 와 project-detail.js 가 공유 ═══
   (예전 core-logic.js 에 있던 것 — 그 파일은 로드된 적이 없어 v13.189 에 삭제) */
function isHtmlMemo(memo) {
  return /<(img|br|p|div|span|b|i|u|strong|em|a|ul|ol|li|h[1-6]|blockquote|code|pre)\b/i.test(memo || '');
}
function plainToHtml(text) {
  if (!text) return '';
  var d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML.replace(/\n/g, '<br>');
}
function sanitizeMemo(html) {
  if (!html) return '';
  var ALLOWED = { IMG:1, BR:1, P:1, DIV:1, SPAN:1, B:1, I:1, U:1, STRONG:1, EM:1, A:1, UL:1, OL:1, LI:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, BLOCKQUOTE:1, CODE:1, PRE:1, HR:1 };
  var SRC_OK = /^(https?:|data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp);)/i;
  var HREF_OK = /^(https?:|mailto:|tel:|#)/i;
  var doc = new DOMParser().parseFromString('<div id="_root">' + html + '</div>', 'text/html');
  var root = doc.getElementById('_root');
  function walk(node) {
    if (!node) return;
    var children = Array.prototype.slice.call(node.childNodes);
    children.forEach(function (c) { walk(c); });
    if (node.nodeType !== 1 || node === root) return;
    var tag = node.tagName;
    if (!ALLOWED[tag]) {
      var p = node.parentNode;
      while (node.firstChild) p.insertBefore(node.firstChild, node);
      p.removeChild(node);
      return;
    }
    var attrs = Array.prototype.slice.call(node.attributes);
    attrs.forEach(function (a) {
      var n = a.name.toLowerCase();
      var v = a.value;
      if (n.indexOf('on') === 0) { node.removeAttribute(a.name); return; }
      if (tag === 'IMG' && n === 'src') { if (!SRC_OK.test(v)) node.removeAttribute(a.name); return; }
      if (tag === 'A' && n === 'href') { if (!HREF_OK.test(v)) node.removeAttribute(a.name); return; }
      if (n === 'alt' || n === 'title') return;
      if (n === 'style') {
        var safe = String(v).replace(/javascript:|expression\s*\(|url\s*\(|@import/gi, '');
        node.setAttribute('style', safe);
        return;
      }
      if (n === 'class' || n === 'id' || n === 'target' || n === 'rel') return;
      node.removeAttribute(a.name);
    });
    if (tag === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
  walk(root);
  return root.innerHTML;
}
function memoToHtml(memo) {
  if (!memo) return '';
  return isHtmlMemo(memo) ? sanitizeMemo(memo) : plainToHtml(memo);
}

var tlScale = 'day'; // day, week, month, quarter
var tlScrollLeft = 0;
var tlHideDone = false; // 완료 프로젝트 숨기기
var tlEditMode = false; // 기간 조정/이동 모드
var tlMsReorder = false; // v13.136: 마일스톤 순서 변경 모드 — 체크 시에만 드래그 재배열 허용(평상시 순서 고정)
var tlRangeStart = null; // 현재 렌더 기준 rangeStart (드래그용)
var tlUnits = null; // 현재 렌더 units (드래그용)
var tlLabelW = 0; // 현재 렌더 labelW (드래그용)
var showCriticalPath = false; // Feature 8: 크리티컬 패스 토글
var _tlJumpDate = null; // 다음 렌더에서 이 날짜를 중앙으로 (오늘/날짜 이동). 범위에 포함시켜 재렌더
// ─── v13.133 타임라인 관리/측정 상태변수 ───
var tlDensity = localStorage.getItem('tlDensity') || 'comfortable'; // 'comfortable' | 'compact'
var tlFilterStatus = 'all'; // 'all' | 'waiting' | 'active' | 'delayed' | 'done' | 'hold'
var tlFilterAssignee = 'all'; // 'all' | 담당자 이름
// v13.154: 정렬/그룹 선택을 localStorage에 저장 → 새로고침 후에도 유지
var tlSort = (typeof lsGet === 'function') ? lsGet('tlSort', 'default') : 'default'; // default|name|name_desc|created|created_desc|deadline|progress|status
var tlGroupBy = (typeof lsGet === 'function') ? lsGet('tlGroupBy', 'none') : 'none'; // none|status
// v13.156 프로젝트 라벨에 대표 이미지 썸네일 상시 표시(기본 on)
var tlShowThumb = (typeof lsGet === 'function') ? (lsGet('tlShowThumb', '1') !== '0') : true;
// v13.158 썸네일 크기 선택(px) — 56|84|108|140
var tlThumbSize = (typeof lsGet === 'function') ? (parseInt(lsGet('tlThumbSize', '108'), 10) || 108) : 108;
function _tlThumbColW() { return tlShowThumb ? (tlThumbSize + 8) : 0; } // 라벨 예약폭 = 썸네일 + gap
var tlCollapsed = new Set(); // 접힌 프로젝트 ID 모음
var tlDayOffset = (localStorage.getItem('tlDayOffset') === 'true'); // D-Day 배지 표시 토글
var _tlMsWorkH = null, _tlMsWorkHSrc = null; // v13.137 마일스톤 투입시간 집계 메모(archive 캐시 참조 기준)
var _tlArchiveData = null; // v13.162 마지막으로 받은 업무일지(archive) — 재렌더가 재조회를 기다리지 않도록

/* 현재 렌더 범위 안이면 가로 스크롤만 즉시 이동(세로 위치 유지·재렌더 없음). 범위 밖이면 false. */
function _tlScrollToDate(dateStr) {
  var scrollEl = document.getElementById('tlScroll');
  if (!scrollEl || !tlUnits || tlRangeStart == null || typeof getDatePosition !== 'function') return false;
  var pos = getDatePosition(dateStr, tlRangeStart, tlUnits);
  if (pos < 0) return false;   // 현재 범위 밖
  var viewW = scrollEl.clientWidth - (tlLabelW || 0);
  var left = Math.max(0, pos - viewW / 2);
  // 가로만 이동 — 현재 scrollTop 유지(맨 위로 튐 방지)
  if (scrollEl.scrollTo) scrollEl.scrollTo({ left: left, top: scrollEl.scrollTop, behavior: 'smooth' });
  else scrollEl.scrollLeft = left;
  return true;
}

/* 오늘로 이동 — 범위 안이면 가로 스크롤만 즉시, 범위 밖이면 재렌더로 처리 */
function tlGoToday() {
  var d = (typeof localDate === 'function') ? localDate() : '';
  if (_tlScrollToDate(d)) return;
  tlGoToDate(d);
}
/* 지정 날짜로 이동 — 범위 안이면 가로 스크롤만(세로 유지), 범위 밖이면 범위 확장 후 재렌더 */
function tlGoToDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return;
  dateStr = dateStr.slice(0, 10);
  if (_tlScrollToDate(dateStr)) return;   // 현재 범위 안 → 즉시 가로 스크롤
  _tlJumpDate = dateStr;                   // 범위 밖 → 재렌더(범위 확장 후 중앙)
  renderTimeline();
}

/* ═══ v13.133 타임라인 관리/측정 헬퍼 ═══ */
// 밀도 토글
function tlSetDensity(isCompact) {
  tlDensity = isCompact ? 'compact' : 'comfortable';
  localStorage.setItem('tlDensity', tlDensity);
}
// v13.161 컴팩트는 데이터 변화 없음 → 전체 재렌더 대신 컨테이너 클래스만 토글(즉시)
function tlToggleDensityFast(isCompact) {
  tlSetDensity(isCompact);
  var c = document.querySelector('.tl-container');
  if (c) c.classList.toggle('tl-compact', isCompact);
  else renderTimeline();
}
// 상태/담당자/정렬 setter
// 마일스톤 접기/펼치기 — v13.139 전체 재렌더 없이 해당 하위 행만 즉시 show/hide (체감 지연 제거)
function _tlSelEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); }
// 한 프로젝트의 하위 행 표시/숨김 + 토글 버튼 아이콘·타이틀 갱신 (DOM만 조작)
function _tlApplyCollapse(projId, collapsed) {
  var sel = '.tl-row-sub[data-proj-id="' + _tlSelEsc(projId) + '"]';
  var rows = document.querySelectorAll(sel);
  for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('tl-row-collapsed', collapsed);
  var btn = document.querySelector('.tl-collapse-toggle[data-collapse-proj="' + _tlSelEsc(projId) + '"]');
  if (btn) { btn.textContent = collapsed ? '▸' : '▾'; btn.title = '마일스톤 ' + (collapsed ? '펼치기' : '접기'); }
  return rows.length;
}
function tlToggleCollapse(projId) {
  var collapsed = !tlCollapsed.has(projId);
  if (collapsed) tlCollapsed.add(projId); else tlCollapsed.delete(projId);
  _tlApplyCollapse(projId, collapsed);
}
function tlCollapseAll() {
  // 하위 행이 실제로 존재하는(마일스톤 보유) 프로젝트만 접기
  var projRows = document.querySelectorAll('.tl-row-proj[data-proj-id]');
  projRows.forEach(function (row) {
    var projId = row.getAttribute('data-proj-id');
    if (!projId || tlCollapsed.has(projId)) return;
    if (document.querySelector('.tl-row-sub[data-proj-id="' + _tlSelEsc(projId) + '"]')) {
      tlCollapsed.add(projId);
      _tlApplyCollapse(projId, true);
    }
  });
}
function tlExpandAll() {
  var ids = [];
  tlCollapsed.forEach(function (id) { ids.push(id); });
  tlCollapsed.clear();
  ids.forEach(function (id) { _tlApplyCollapse(id, false); });
}
// D-Day 배지 토글
function tlToggleDayOffset(val) {
  tlDayOffset = val;
  localStorage.setItem('tlDayOffset', tlDayOffset ? 'true' : 'false');
  renderTimeline();
}

/* ═══ 초기화 ═══ */
function initTimeline() {
  renderTimeline();
}

/* ═══ 메인 렌더 ═══
   데이터 로드 → 필터/정렬(순수) → 범위/단위(순수) → 컨트롤·헤더·행 HTML → 마운트 후처리 */
async function renderTimeline() {
  var wrap = document.getElementById('timelineWrap');
  if (!wrap) return;

  var data = await _tlLoadData();
  var allProjects = data.allProjects;

  // 프로젝트 리스트 패널 렌더
  renderTlProjectList(allProjects);

  var f = _tlFilterSort(allProjects, data.milestones, {
    hideDone: tlHideDone, status: tlFilterStatus, assignee: tlFilterAssignee, sort: tlSort, groupBy: tlGroupBy
  });
  var projects = f.projects;

  // 프로젝트가 없으면 빈 상태
  var content = document.getElementById('tlContent');
  if (!allProjects.length) {
    content.innerHTML = '<div style="text-align:center;color:var(--t6);padding:40px;font-size:13px">등록된 프로젝트가 없습니다.<br><button class="btn btn-p" style="margin-top:12px" onclick="showProjectModal()">➕ 첫 프로젝트 등록</button></div>';
    return;
  }
  if (!projects.length) {
    content.innerHTML = '<div style="text-align:center;color:var(--t6);padding:30px;font-size:12px">표시할 프로젝트가 없습니다. (완료 ' + allProjects.length + '건 숨김)</div>';
    return;
  }

  var rg = _tlComputeRange(projects, _tlJumpDate, tlScale);
  var units = rg.units, rangeStart = rg.rangeStart;

  // 레이블 최대 폭 계산: 프로젝트명 + 마일스톤명 전부 측정
  var labelW = calcLabelWidth(projects, f.milestones, data.msWorkH);

  // 드래그용 렌더 컨텍스트 저장
  tlRangeStart = rangeStart;
  tlUnits = units;
  tlLabelW = labelW;

  // 컨트롤 바
  document.getElementById('tlControls').innerHTML = _tlRenderControls(f.assigneeList);

  // 헤더 (기간 표시)
  var headerHtml = _tlRenderHeader(units, rg.totalWidth, rg.unitW, rg.todayStr);

  // Today line 위치
  var todayPos = getTodayPosition(rangeStart, units);

  var ctx = {
    projects: projects, milestones: f.milestones, groupHeads: f.groupHeads, msWorkH: data.msWorkH,
    rangeStart: rangeStart, units: units, totalWidth: rg.totalWidth, labelW: labelW,
    todayStr: rg.todayStr, todayPos: todayPos,
    // Feature 8: 크리티컬 패스 계산
    criticalPathIds: showCriticalPath ? calcCriticalPath(projects) : {}
  };

  // 프로젝트 행
  var rowsHtml = _tlRenderRows(ctx);

  // 재렌더 시 스크롤 위치 보존 (마일스톤 업데이트 후 등) — 기존 #tlScroll 위치 캡처
  var _tlPrevScrollEl = document.getElementById('tlScroll');
  var _tlPrevScroll = _tlPrevScrollEl ? { left: _tlPrevScrollEl.scrollLeft, top: _tlPrevScrollEl.scrollTop } : null;

  content.innerHTML =
    '<div class="tl-container' + (tlDensity === 'compact' ? ' tl-compact' : '') + '" style="position:relative;--tl-thumb-sz:' + tlThumbSize + 'px;' + _tlBarsVars(units, todayPos, rg.todayStr, rg.unitW, tlScale) + '">' +
      '<div class="tl-scroll" id="tlScroll">' +
        '<div class="tl-header-row">' +
          '<div class="tl-label-header" style="width:' + labelW + 'px;min-width:' + labelW + 'px;max-width:' + labelW + 'px">프로젝트</div>' +
          headerHtml +
        '</div>' +
        rowsHtml +
      '</div>' +
    '</div>';

  _tlAfterMount(ctx, _tlPrevScroll);
}

/* 프로젝트·마일스톤 + 마일스톤별 업무일지 투입시간 집계 로드 */
async function _tlLoadData() {
  // v13.162 업무일지(archive)는 마일스톤 툴팁 실적(참고)에만 쓰임 → 렌더를 막지 않음.
  //   ARCHIVE_CACHE_TTL(5s) 만료 시 readAllArchiveRecords 가 전체(최대 5만건) 재조회하며 버튼 재렌더가 5초+ 지연되던 문제.
  //   첫 로드만 await, 이후 렌더는 마지막으로 받은 archive 재사용 + 백그라운드 갱신(다음 렌더에 반영).
  var _tlData = await Promise.all([
    (typeof pmGetProjects === 'function' ? pmGetProjects() : projGetAll()),
    msGetAll()
  ]);
  var _arch;
  if (_tlArchiveData) {
    _arch = _tlArchiveData; // 즉시(재렌더 비차단)
    if (typeof readAllArchiveRecords === 'function') readAllArchiveRecords().then(function (r) { _tlArchiveData = r || []; }).catch(function () {});
  } else if (typeof readAllArchiveRecords === 'function') {
    _arch = await readAllArchiveRecords().catch(function () { return []; }); // 최초 1회만 대기
    _tlArchiveData = _arch;
  } else { _arch = []; }
  // 마일스톤별 업무일지 투입시간(태깅 기준) 집계 — 툴팁 실적 표시용
  // v13.137 archive 캐시 배열 참조가 동일하면(뷰 전용 재렌더) 집계 재사용 — O(records) 루프 생략
  var msWorkH;
  if (_arch === _tlMsWorkHSrc && _tlMsWorkH) {
    msWorkH = _tlMsWorkH;
  } else {
    msWorkH = {};
    _arch.forEach(function (r) { if (r.milestoneId) msWorkH[r.milestoneId] = (msWorkH[r.milestoneId] || 0) + (r.hours || 0); });
    _tlMsWorkH = msWorkH; _tlMsWorkHSrc = _arch;
  }
  return { allProjects: _tlData[0], milestones: _tlData[1], msWorkH: msWorkH };
}

/* [순수] 완료 숨김·상태·담당자 필터 → 정렬/그룹 평탄화 → 표시 프로젝트의 마일스톤만.
   opt: { hideDone, status, assignee, sort, groupBy }
   반환: { assigneeList, projects, groupHeads(그룹 첫 프로젝트 id → 그룹), milestones } */
function _tlFilterSort(allProjects, milestones, opt) {
  // 담당자 합집합 (담당자 필터 드롭다운용)
  var _allAssignees = {};
  allProjects.forEach(function (p) {
    (p.assignees || []).forEach(function (a) { if (a) _allAssignees[a] = true; });
  });
  var assigneeList = Object.keys(_allAssignees).sort();

  // 완료 숨기기 필터 적용
  var projects = opt.hideDone ? allProjects.filter(function (p) { return autoProjectStatus(p) !== 'done'; }) : allProjects;
  // v13.133 상태 필터 적용
  if (opt.status !== 'all') {
    projects = projects.filter(function (p) { return autoProjectStatus(p) === opt.status; });
  }
  // v13.133 담당자 필터 적용
  if (opt.assignee !== 'all') {
    projects = projects.filter(function (p) {
      var asg = p.assignees || [];
      return asg.indexOf(opt.assignee) >= 0;
    });
  }
  // v13.151 정렬 + 그룹화 (좌측 목록과 동일한 _tlGroupProjects 사용 → 일치)
  var groups = _tlGroupProjects(projects, opt);
  var groupHeads = {};   // 각 그룹의 첫 프로젝트 id → 그룹 메타(상태 그룹 모드일 때만 헤더 렌더)
  var flat = [];
  groups.forEach(function (g) {
    if (opt.groupBy === 'status' && g.items.length) groupHeads[g.items[0].id] = g;
    g.items.forEach(function (p) { flat.push(p); });
  });

  // 표시 대상 프로젝트 ID 집합 (마일스톤 필터용)
  var visibleProjIds = {};
  flat.forEach(function (p) { visibleProjIds[p.id] = true; });
  var ms = (milestones || []).filter(function (m) { return visibleProjIds[m.projectId]; });

  return { assigneeList: assigneeList, projects: flat, groupHeads: groupHeads, milestones: ms };
}

/* [순수] 날짜 범위(여유 −14/+30일)·스케일 단위·전체 폭. jumpDate 는 범위 밖이어도 포함.
   반환: { rangeStart, rangeEnd, units, unitW, totalWidth, todayStr } */
function _tlComputeRange(projects, jumpDate, scale) {
  // 날짜 범위 결정 — 유효한 YYYY-MM-DD 값만 수집
  var DATE_RX = /^\d{4}-\d{2}-\d{2}/;
  var allDates = [];
  projects.forEach(function (p) {
    if (p.startDate && DATE_RX.test(p.startDate)) allDates.push(p.startDate.slice(0, 10));
    if (p.endDate && DATE_RX.test(p.endDate)) allDates.push(p.endDate.slice(0, 10));
  });
  // 날짜 이동 대상이 범위 밖이어도 보이도록 범위에 포함
  if (jumpDate && DATE_RX.test(jumpDate)) allDates.push(jumpDate);
  allDates.sort();

  // 모든 프로젝트에 유효 날짜가 없으면 오늘 기준 ±30일 폴백
  var rangeStart, rangeEnd;
  if (allDates.length === 0) {
    var _today = new Date();
    rangeStart = new Date(_today); rangeStart.setDate(rangeStart.getDate() - 7);
    rangeEnd = new Date(_today); rangeEnd.setDate(rangeEnd.getDate() + 30);
  } else {
    rangeStart = new Date(allDates[0]);
    rangeEnd = new Date(allDates[allDates.length - 1]);
    if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
      var _today2 = new Date();
      rangeStart = new Date(_today2); rangeStart.setDate(rangeStart.getDate() - 7);
      rangeEnd = new Date(_today2); rangeEnd.setDate(rangeEnd.getDate() + 30);
    }
  }

  // 여유 추가
  rangeStart.setDate(rangeStart.getDate() - 14);
  rangeEnd.setDate(rangeEnd.getDate() + 30);

  // 스케일별 단위 계산
  var units = getTimeUnits(rangeStart, rangeEnd, scale);
  var unitW = _tlUnitWidthFor(scale);
  return { rangeStart: rangeStart, rangeEnd: rangeEnd, units: units, unitW: unitW, totalWidth: units.length * unitW, todayStr: localDate() };
}

/* [순수] v13.137 그리드/음영을 .tl-bars 배경 그라디언트로 1회 처리 (행×단위 div 제거) — CSS 변수 문자열 */
function _tlBarsVars(units, todayPos, todayStr, uw, scale) {
  var pastW; // 과거(오늘 이전) 음영 폭 — 오늘이 속한 단위 시작점까지
  if (todayPos >= 0) {
    pastW = Math.floor((todayPos + 0.5) / uw) * uw;
  } else {
    var lastU = units[units.length - 1];
    var lastEnd = lastU ? (lastU.endDate || lastU.date || '') : '';
    pastW = (lastEnd && todayStr > lastEnd) ? (units.length * uw) : 0; // 오늘이 범위 뒤면 전체 과거
  }
  var dow0 = (units[0] && units[0].date) ? new Date(units[0].date + 'T00:00:00').getDay() : 0;
  var satX = ((6 - dow0 + 7) % 7) * uw; // 첫 토요일 x (일 스케일)
  var sunX = ((7 - dow0) % 7) * uw;     // 첫 일요일 x (일 스케일)
  return '--tl-uw:' + uw + 'px;--tl-pastw:' + pastW + 'px;' +
    (scale === 'day' ? ('--tl-sat:' + satX + 'px;--tl-sun:' + sunX + 'px;--tl-wkw:' + uw + 'px;') : '--tl-wkw:0px;');
}

/* 컨트롤 바 HTML (스케일·이동·토글·필터·정렬) */
function _tlRenderControls(assigneeList) {
  return '<button class="btn btn-p btn-s" onclick="showProjectModal()">➕ 프로젝트</button>' +
    '<div style="display:flex;gap:3px;align-items:center">' +
      '<span style="font-size:11px;color:var(--t4);margin-right:4px">스케일:</span>' +
      ['hour','day','week','month','quarter'].map(function (s) {
        var labels = { hour: '시간', day: '일', week: '주', month: '월', quarter: '분기' };
        return '<button class="btn btn-s ' + (tlScale === s ? 'btn-p' : 'btn-g') + '" onclick="tlScale=\'' + s + '\';renderTimeline()">' + labels[s] + '</button>';
      }).join('') +
    '</div>' +
    '<div style="display:flex;gap:4px;align-items:center">' +
      '<button class="btn btn-g btn-s" onclick="tlGoToday()" title="오늘 날짜를 중앙으로">📍 오늘</button>' +
      '<input type="date" onchange="if(this.value)tlGoToDate(this.value)" title="지정 날짜로 이동" style="font-size:10px;padding:2px 5px;border:1px solid var(--bd-i);border-radius:5px;background:var(--bg-i);color:var(--t3)">' +
    '</div>' +
    '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:' + (tlEditMode ? '#FCD34D' : 'var(--t5)') + ';cursor:pointer;background:' + (tlEditMode ? 'rgba(245,158,11,.12)' : 'var(--bg-i)') + ';padding:3px 8px;border-radius:5px;border:1px solid ' + (tlEditMode ? 'rgba(245,158,11,.4)' : 'var(--bd-i)') + '"><input type="checkbox" id="tlEditModeTog" onchange="tlEditMode=this.checked;renderTimeline()"' + (tlEditMode ? ' checked' : '') + '> ✏️ 기간 조정</label>' +
    // v13.136 마일스톤 순서 변경 모드 — 체크 시에만 드래그 재배열 허용
    '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:' + (tlMsReorder ? '#A78BFA' : 'var(--t5)') + ';cursor:pointer;background:' + (tlMsReorder ? 'rgba(139,92,246,.12)' : 'var(--bg-i)') + ';padding:3px 8px;border-radius:5px;border:1px solid ' + (tlMsReorder ? 'rgba(139,92,246,.4)' : 'var(--bd-i)') + '" title="체크 시에만 마일스톤을 드래그하여 순서를 바꿀 수 있습니다 (평상시엔 순서 고정)"><input type="checkbox" id="tlMsReorderTog" onchange="tlMsReorder=this.checked;renderTimeline()"' + (tlMsReorder ? ' checked' : '') + '> ↕️ 순서 변경</label>' +
    '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--t5);cursor:pointer;background:var(--bg-i);padding:3px 8px;border-radius:5px;border:1px solid var(--bd-i)"><input type="checkbox" id="tlHideDoneTog" onchange="tlHideDone=this.checked;renderTimeline()"' + (tlHideDone ? ' checked' : '') + '> 완료 숨기기</label>' +
    '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:' + (showCriticalPath ? SEM_COLOR.danger : 'var(--t5)') + ';cursor:pointer;background:' + (showCriticalPath ? 'rgba(239,68,68,.12)' : 'var(--bg-i)') + ';padding:3px 8px;border-radius:5px;border:1px solid ' + (showCriticalPath ? 'rgba(239,68,68,.4)' : 'var(--bd-i)') + '"><input type="checkbox" id="tlCriticalPathTog" onchange="showCriticalPath=this.checked;renderTimeline()"' + (showCriticalPath ? ' checked' : '') + '> 🔴 크리티컬 패스</label>' +
    // v13.133 컴팩트 밀도 토글
    '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--t5);cursor:pointer;background:var(--bg-i);padding:3px 8px;border-radius:5px;border:1px solid var(--bd-i)"><input type="checkbox" id="tlDensityTog" onchange="tlToggleDensityFast(this.checked)"' + (tlDensity === 'compact' ? ' checked' : '') + '> 🔳 컴팩트</label>' +
    // v13.156 라벨 대표 이미지 썸네일 상시 표시 토글
    '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:' + (tlShowThumb ? '#22D3EE' : 'var(--t5)') + ';cursor:pointer;background:' + (tlShowThumb ? 'rgba(34,211,238,.12)' : 'var(--bg-i)') + ';padding:3px 8px;border-radius:5px;border:1px solid ' + (tlShowThumb ? 'rgba(34,211,238,.4)' : 'var(--bd-i)') + '" title="프로젝트 라벨에 대표 이미지 썸네일 상시 표시"><input type="checkbox" id="tlThumbTog" onchange="tlShowThumb=this.checked;if(typeof lsSet===\'function\')lsSet(\'tlShowThumb\',this.checked?\'1\':\'0\');renderTimeline()"' + (tlShowThumb ? ' checked' : '') + '> 🖼 썸네일</label>' +
    (tlShowThumb ? '<select class="si" id="tlThumbSizeSel" onchange="tlThumbSize=parseInt(this.value,10)||108;if(typeof lsSet===\'function\')lsSet(\'tlThumbSize\',String(tlThumbSize));renderTimeline()" style="max-width:96px;padding:3px 5px;font-size:10px" title="썸네일 크기">' +
      [['56','작게'],['84','보통'],['108','크게'],['140','아주크게']].map(function(o){ return '<option value="' + o[0] + '"' + (tlThumbSize === parseInt(o[0],10) ? ' selected' : '') + '>🖼 ' + o[1] + '</option>'; }).join('') +
    '</select>' : '') +
    // v13.133 D-Day 표시 토글
    '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:' + (tlDayOffset ? '#10B981' : 'var(--t5)') + ';cursor:pointer;background:' + (tlDayOffset ? 'rgba(16,185,129,.12)' : 'var(--bg-i)') + ';padding:3px 8px;border-radius:5px;border:1px solid ' + (tlDayOffset ? 'rgba(16,185,129,.4)' : 'var(--bd-i)') + '"><input type="checkbox" id="tlDayOffsetTog" onchange="tlToggleDayOffset(this.checked)"' + (tlDayOffset ? ' checked' : '') + '> 📏 D-Day 표시</label>' +
    // v13.133 마일스톤 모두접기/펼치기
    '<button class="btn btn-g btn-s" onclick="tlCollapseAll()" title="모든 프로젝트의 마일스톤 접기">⊟ 모두접기</button>' +
    '<button class="btn btn-g btn-s" onclick="tlExpandAll()" title="모든 프로젝트의 마일스톤 펼치기">⊞ 모두펼치기</button>' +
    // v13.133 상태/담당자 필터 + 정렬
    '<div style="display:flex;gap:4px;align-items:center">' +
      '<select class="si" id="tlFilterStatus" onchange="tlFilterStatus=this.value;renderTimeline()" style="max-width:140px;padding:4px 6px;font-size:10px">' +
        _tlOpts([['all','모든 상태'],['waiting','대기'],['active','진행중'],['delayed','지연'],['done','완료'],['hold','보류']], tlFilterStatus) +
      '</select>' +
      '<select class="si" id="tlFilterAssignee" onchange="tlFilterAssignee=this.value;renderTimeline()" style="max-width:140px;padding:4px 6px;font-size:10px">' +
        '<option value="all"' + (tlFilterAssignee === 'all' ? ' selected' : '') + '>모든 담당자</option>' +
        assigneeList.map(function (a) { return '<option value="' + eH(a) + '"' + (tlFilterAssignee === a ? ' selected' : '') + '>' + eH(a) + '</option>'; }).join('') +
      '</select>' +
      '<select class="si" id="tlSortBy" onchange="tlSort=this.value;if(typeof lsSet===\'function\')lsSet(\'tlSort\',this.value);renderTimeline()" style="max-width:150px;padding:4px 6px;font-size:10px" title="정렬 기준 (좌측 목록·타임라인 공통, 선택은 새로고침 후에도 유지)">' +
        _tlOpts([['default','사용자 지정 순서(파이프라인 연동)'],['name','이름순 가나다 ↑'],['name_desc','이름순 가나다 ↓'],['created','최초등록 오래된순 ↑'],['created_desc','최초등록 최신순 ↓'],['deadline','마감임박순'],['progress','진척률 높은순'],['status','상태순']], tlSort) +
      '</select>' +
      '<select class="si" id="tlGroupBy" onchange="tlGroupBy=this.value;if(typeof lsSet===\'function\')lsSet(\'tlGroupBy\',this.value);renderTimeline()" style="max-width:120px;padding:4px 6px;font-size:10px" title="그룹으로 묶기 — 묶은 그룹 안에서 위 정렬 기준 적용 (선택은 유지)">' +
        _tlOpts([['none','그룹 없음'],['status','상태별 묶기']], tlGroupBy) +
      '</select>' +
    '</div>' +
    '<button class="btn btn-g btn-s" onclick="exportProjectsJSON()">📥 내보내기</button>' +
    '<button class="btn btn-g btn-s" onclick="tlCompressAllMemoImages()" title="모든 프로젝트의 메모에 들어간 큰 이미지를 일괄 압축·축소(편집 권한 있는 프로젝트만)">🗜 메모이미지 일괄압축</button>';
}
// [순수] [[value,label],...] → <option> 목록 (cur 와 같으면 selected)
function _tlOpts(pairs, cur) {
  return pairs.map(function (o) { return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
}

/* [순수] 기간 헤더 (단위 라벨, 오늘 포함 단위 강조) */
function _tlRenderHeader(units, totalWidth, uw, todayStr) {
  var headerHtml = '<div class="tl-header" style="width:' + totalWidth + 'px">';
  units.forEach(function (u) {
    var isNow = u.contains && u.contains(todayStr);
    headerHtml += '<div class="tl-unit' + (isNow ? ' tl-unit-now' : '') + '" style="width:' + uw + 'px">' + u.label + '</div>';
  });
  headerHtml += '</div>';
  return headerHtml;
}

/* 프로젝트 행 + 마일스톤 하위 행 HTML. ctx: renderTimeline 의 렌더 컨텍스트 */
function _tlRenderRows(ctx) {
  var rowsHtml = '';
  ctx.projects.forEach(function (p, _pi) {
    // v13.151 상태 그룹 헤더 행 (그룹의 첫 프로젝트 앞에 삽입)
    if (ctx.groupHeads[p.id]) rowsHtml += _tlGroupRowHtml(ctx.groupHeads[p.id], ctx.labelW, ctx.totalWidth);
    var st = autoProjectStatus(p);
    // 편집 모달과 동일 비교자 — order 우선, 동률이면 createdAt (양쪽 표시 순서 일치 보장)
    var pMs = ctx.milestones.filter(function (m) { return m.projectId === p.id; }).sort(function (a, b) { return ((a.order || 0) - (b.order || 0)) || (a.createdAt || '').localeCompare(b.createdAt || ''); });

    rowsHtml += '<div class="tl-row tl-row-proj' + (st === 'delayed' ? ' tl-row-delayed' : '') + (_pi % 2 === 1 ? ' tl-proj-alt' : '') + '" data-proj-id="' + p.id + '">';
    rowsHtml += _tlProjLabelHtml(p, st, pMs, ctx.labelW);
    rowsHtml += _tlProjBarsHtml(p, st, pMs, ctx);
    rowsHtml += '</div>'; // tl-row

    // 마일스톤 하위 행 — 항상 렌더하되 접힘 시 .tl-row-collapsed(display:none)로 토글 (v13.139 즉시 반응)
    var _msRowCollapsed = tlCollapsed.has(p.id) ? ' tl-row-collapsed' : '';
    pMs.forEach(function (ms) { rowsHtml += _tlMsRowHtml(ms, p, _pi, _msRowCollapsed, ctx); });
  });
  return rowsHtml;
}

// 상태 그룹 헤더 행
function _tlGroupRowHtml(gh, labelW, totalWidth) {
  return '<div class="tl-row tl-group-row">' +
    '<div class="tl-label tl-group-label" style="width:' + labelW + 'px;min-width:' + labelW + 'px;max-width:' + labelW + 'px;border-left:3px solid ' + (gh.color || 'var(--ac)') + '">' +
      '<span style="font-size:11px;font-weight:800;color:' + (gh.color || 'var(--t2)') + '">' + gh.label + '</span>' +
      '<span style="font-size:9px;color:var(--t6);margin-left:6px;font-weight:700">' + gh.items.length + '</span>' +
    '</div>' +
    '<div class="tl-bars" style="width:' + totalWidth + 'px"></div>' +
  '</div>';
}

// 프로젝트 라벨 — 이름/상태/기간·D-Day(v13.43)/담당자(v13.44)/라이프사이클(v13.45). window._tlOv(호버 프리뷰) 갱신 포함
function _tlProjLabelHtml(p, st, pMs, labelW) {
  var _period = _tlFmtPeriod(p);
  var _dday = _tlFmtDday(p, st);
  // v13.147 호버 프리뷰용 개요 맵 (v13.149 메모 내 이미지도 프리뷰에 노출) — _tlLabelThumb 보다 먼저 채움
  if (window._tlOv) window._tlOv[p.id] = {
    name: p.name || p.orderNo || '',
    color: p.color,
    statusLabel: (PROJ_STATUS[st] ? PROJ_STATUS[st].icon + ' ' + PROJ_STATUS[st].label : ''),
    period: _period || '',
    progress: (p.progress != null ? Math.round(p.progress) : null),
    assignees: (p.assignees || []).join(', '),
    memoImgs: _tlMemoImgs(p.memo)
  };
  var thirdLine = '';
  if (_period || _dday) {
    thirdLine = '<div style="display:flex;align-items:center;gap:6px;margin-top:1px;font-size:9px;color:var(--t5);white-space:nowrap">' +
      (_period ? '<span title="시작일 ~ 종료일">' + _period + '</span>' : '') +
      (_dday ? '<span style="color:' + _dday.color + ';font-weight:600">' + _dday.label + '</span>' : '') +
    '</div>';
  }
  // 완료(done) dim은 내부 콘텐츠에만 적용 — 라벨 배경은 불투명 유지(뒤의 오늘선/날짜선 비침 방지)
  return '<div class="tl-label" style="width:' + labelW + 'px;min-width:' + labelW + 'px;max-width:' + labelW + 'px' + (tlShowThumb ? ';display:flex;align-items:center;gap:7px' : '') + '" onclick="showProjectDetail(\'' + p.id + '\')">' +
    (tlShowThumb ? _tlLabelThumb(p) : '') +
    '<div style="' + (tlShowThumb ? 'flex:1;min-width:0;' : '') + (st === 'done' ? 'opacity:.5' : '') + '">' +
    '<div style="display:flex;align-items:center;gap:6px">' +
      '<span class="dot" style="background:' + p.color + ';width:8px;height:8px;border-radius:50%;flex-shrink:0"></span>' +
      (pMs.length > 0 ? '<button class="tl-collapse-toggle" data-collapse-proj="' + p.id + '" onclick="event.stopPropagation();tlToggleCollapse(\'' + p.id + '\')" style="background:none;border:none;padding:0;cursor:pointer;font-size:10px;color:var(--t4);width:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0" title="마일스톤 ' + (tlCollapsed.has(p.id) ? '펼치기' : '접기') + '">' + (tlCollapsed.has(p.id) ? '▸' : '▾') + '</button>' : '<span style="width:16px;flex-shrink:0"></span>') +
      '<span style="font-size:12px;font-weight:600;color:var(--t1);white-space:nowrap' + (st === 'done' ? ';text-decoration:line-through;text-decoration-thickness:1px;text-decoration-color:var(--t5)' : '') + '">' + eH(p.name || p.orderNo) + '</span>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:4px;margin-top:2px">' +
      '<span class="badge" style="background:' + stBg(st) + ';color:' + stColor(st) + '">' + PROJ_STATUS[st].icon + ' ' + PROJ_STATUS[st].label + '</span>' +
      (p.progress ? '<span style="font-size:9px;color:var(--t5)">' + p.progress + '%</span>' : '') +
    '</div>' +
    thirdLine +
    _tlAssigneeLineHtml(p) +
    _tlPhaseStepsHtml(p) +
    '</div>' +
  '</div>';
}

// 담당자 4행 — 1~3명은 풀 표시, 4명 이상은 "이름 외 N명" + title hover
function _tlAssigneeLineHtml(p) {
  var _assignees = (p.assignees || []).filter(Boolean);
  if (!_assignees.length) return '';
  var _shortFn = (typeof shortName === 'function') ? shortName : function(n){return n;};
  var _shortList = _assignees.map(_shortFn);
  var _label, _full = _assignees.join(', ');
  if (_shortList.length <= 3) {
    _label = _shortList.join(', ');
  } else {
    _label = _shortList.slice(0, 2).join(', ') + ' 외 ' + (_shortList.length - 2) + '명';
  }
  return '<div style="display:flex;align-items:center;gap:4px;margin-top:1px;font-size:9px;color:var(--t4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + eH(_full) + '">' +
    '<span style="opacity:.7">👤</span>' +
    '<span style="overflow:hidden;text-overflow:ellipsis">' + eH(_label) + '</span>' +
  '</div>';
}

// 라이프사이클 5행 — v13.45: 6단계 미니 step-icon (수주/설계/제작/검수/납품/A/S)
function _tlPhaseStepsHtml(p) {
  if (typeof PROJ_PHASE === 'undefined') return '';
  var _phaseKeys = Object.keys(PROJ_PHASE).sort(function(a,b){
    return (PROJ_PHASE[a].seq || 0) - (PROJ_PHASE[b].seq || 0);
  });
  var _curPhase = p.currentPhase || _phaseKeys[0];
  var _curIdx = _phaseKeys.indexOf(_curPhase);
  var _curLabel = (PROJ_PHASE[_curPhase] && PROJ_PHASE[_curPhase].label) || _curPhase;
  var _stepIcons = _phaseKeys.map(function (pk, idx) {
    var ph = PROJ_PHASE[pk];
    var phStatus = (p.phases && p.phases[pk] && p.phases[pk].status) || '';
    var isCurrent = pk === _curPhase;
    var isDone = phStatus === 'done' || (idx < _curIdx);
    var bg, fg, brd;
    if (isCurrent)   { bg = ph.color + '33'; fg = ph.color; brd = '1.5px solid ' + ph.color; }
    else if (isDone) { bg = ph.color;        fg = '#fff';   brd = '1px solid ' + ph.color; }
    else             { bg = 'transparent';   fg = 'var(--t6)'; brd = '1px solid var(--bd)'; }
    return '<span title="' + ph.label + (isCurrent ? ' (현재)' : isDone ? ' (완료)' : '') + '" '
      + 'style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;font-size:8px;line-height:1;background:' + bg + ';color:' + fg + ';border:' + brd + ';box-sizing:border-box;flex-shrink:0">' + ph.icon + '</span>';
  }).join('');
  return '<div style="display:flex;align-items:center;gap:3px;margin-top:3px;font-size:9px;color:var(--t5);white-space:nowrap" title="라이프사이클 — 현재: ' + _curLabel + '">' + _stepIcons + '</div>';
}

// [순수] v13.133 D-Day 배지 (막대 클릭 가로채지 않음 — pointer-events:none). 기준일 없으면 ''
function _tlDdayBadgeHtml(refDate, todayStr) {
  if (!refDate || refDate.length < 10) return '';
  var daysTo = daysDiff(todayStr, refDate);
  var label, cls;
  if (daysTo === 0) { label = 'D-day'; cls = 'tl-dday-now'; }
  else if (daysTo > 0) { label = '+' + daysTo + ' days'; cls = 'tl-dday-future'; }
  else { label = daysTo + ' days'; cls = 'tl-dday-past'; }
  return '<div class="tl-dday-badge ' + cls + '" title="오늘로부터 ' + daysTo + '일">' + label + '</div>';
}

// 프로젝트 행의 바 영역 — 프로젝트 막대(단계 밴드·진척·핸들·D-Day) + 마일스톤 ◆ + 오늘선
// (그리드/주말·과거 음영은 .tl-bars 배경 그라디언트로 처리 — v13.137 DOM 절감)
function _tlProjBarsHtml(p, st, pMs, ctx) {
  var h = '<div class="tl-bars" style="width:' + ctx.totalWidth + 'px">';
  var barStyle = getBarStyle(p.startDate, p.endDate, ctx.rangeStart, ctx.units);
  var isCritical = showCriticalPath && ctx.criticalPathIds[p.id];
  var barCls = 'tl-bar' + (st === 'delayed' ? ' tl-bar-delayed' : '') + (st === 'done' ? ' tl-bar-done' : '') + (tlEditMode ? ' tl-bar-editable' : '');
  var criticalStyle = isCritical ? 'box-shadow:0 0 0 2px ' + SEM_COLOR.danger + ',0 0 8px rgba(239,68,68,.5);z-index:3;' : '';
  h += '<div class="' + barCls + '" data-type="proj" data-id="' + p.id + '" style="' + barStyle + 'background:' + p.color + ';' + criticalStyle + '" title="' + eH(p.name) + ' (' + p.startDate + ' ~ ' + p.endDate + ')"' + (isCritical ? ' data-critical="1"' : '') + '>';  // v13.191: 기간 막대 hover 장비 사진 미리보기 제거 (막대 위에서 작업할 때 가림)
  // 단계 밴드 오버레이
  if (p.phases && p.startDate && p.endDate) {
    h += buildPhaseBands(p, ctx.rangeStart, ctx.units);
  }
  if (p.progress > 0) {
    var prominentCls = (p.progress > 30) ? ' prominent' : '';
    h += '<div class="tl-bar-progress' + prominentCls + '" style="width:' + Math.min(p.progress, 100) + '%;background:' + p.color + '"></div>';
  }
  if (tlEditMode) {
    h += '<div class="tl-handle tl-handle-l" data-handle="left"></div>';
    h += '<div class="tl-handle tl-handle-r" data-handle="right"></div>';
  }
  // v13.133 진척률 % 표시 (v13.140 100%는 ✓)
  var pctSpan = (p.progress > 0) ? ' <span class="tl-bar-pct">' + (p.progress >= 100 ? '✓' : Math.round(p.progress) + '%') + '</span>' : '';
  h += '<span class="tl-bar-text">' + eH(p.name) + pctSpan + '</span>';
  if (tlDayOffset) h += _tlDdayBadgeHtml(p.endDate || p.startDate, ctx.todayStr);
  h += '</div>';

  // 마일스톤 마커
  pMs.forEach(function (ms) {
    if (ms.endDate) {
      var msPos = getDatePosition(ms.endDate, ctx.rangeStart, ctx.units);
      if (msPos >= 0) {
        var msCol = ms.status === 'done' ? stColor('done') : SEM_COLOR.purple;
        h += '<div class="tl-ms-marker" style="left:' + msPos + 'px;color:' + msCol + '" title="' + eH(ms.name) + '">◆</div>';
      }
    }
  });

  // Today line
  if (ctx.todayPos >= 0) {
    h += '<div class="tl-today-line" style="left:' + ctx.todayPos + 'px"></div>';
  }
  h += '</div>'; // tl-bars
  return h;
}

// [순수] 마일스톤 한 줄 툴팁 (프로젝트 막대와 동일 형태) — 이름 · 기간 · 일수 · D-day · 실적(보고 투입/목표 + %, 업무일지는 참고)
function _tlMsTitle(ms, msSt, msWorkH) {
  var _msDays = (ms.startDate && ms.endDate && ms.startDate.length >= 10 && ms.endDate.length >= 10) ? (daysDiff(ms.startDate, ms.endDate) + 1) : null;
  var _msDday = (typeof _tlFmtDday === 'function') ? _tlFmtDday({ endDate: ms.endDate }, msSt) : null;
  var _msTgt = 0; var _mat = ms.assigneeTargets || {}; Object.keys(_mat).forEach(function (k) { _msTgt += Number(_mat[k]) || 0; });
  _msTgt = Math.round(_msTgt * 10) / 10;
  var _msAct = Math.round((Number(ms.reportedHours) || 0) * 10) / 10;        // 보고 투입(누적)
  var _msWork = Math.round(((msWorkH[ms.id] || 0)) * 10) / 10;               // 업무일지(참고)
  var _HPD = (typeof MS_HOURS_PER_DAY === 'number' && MS_HOURS_PER_DAY) ? MS_HOURS_PER_DAY : 8;
  var _msActD = Math.round((_msAct / _HPD) * 10) / 10;
  var _msTgtD = Math.round((_msTgt / _HPD) * 10) / 10;
  var _msPerf = ' · 실적 ' + _msAct + 'h' + (_msTgt > 0 ? '/' + _msTgt + 'h (' + Math.round(_msAct / _msTgt * 100) + '%)' : '') +
    ' (' + _msActD + (_msTgt > 0 ? '/' + _msTgtD : '') + 'd, 8h=1일)' +
    (_msWork > 0 ? ' · 업무일지 ' + _msWork + 'h(참고)' : '');
  return (ms.name || '') + ' · ' + (ms.startDate || '?') + ' ~ ' + (ms.endDate || '?') + (_msDays != null ? ' · ' + _msDays + '일' : '') + (_msDday ? ' · ' + _msDday.label : '') + _msPerf;
}

// 마일스톤 하위 행 (라벨 + 막대)
function _tlMsRowHtml(ms, p, _pi, collapsedCls, ctx) {
  var labelW = ctx.labelW;
  var msBarStyle = getBarStyle(ms.startDate, ms.endDate, ctx.rangeStart, ctx.units);
  var msSt = ms.status || 'waiting';
  var msStInfo = PROJ_STATUS[msSt] || PROJ_STATUS.waiting;
  var msBarBg = msSt === 'done' ? stColor('done') + '80' : msSt === 'delayed' ? stColor('delayed') + '80' : msSt === 'active' ? p.color + '90' : p.color + '40';
  var msBarCls = 'tl-bar tl-bar-ms' + (msSt === 'delayed' ? ' tl-bar-delayed' : '') + (msSt === 'done' ? ' tl-bar-done' : '');
  var msTitle = _tlMsTitle(ms, msSt, ctx.msWorkH);
  var _perf = (typeof _tlMsPerf === 'function') ? _tlMsPerf(ms, ctx.msWorkH) : { text: '', html: '' };
  var _msProg = Number(ms.progress) || 0;
  var h = '<div class="tl-row tl-row-sub' + (_pi % 2 === 1 ? ' tl-proj-alt' : '') + collapsedCls + '" data-ms-id="' + ms.id + '" data-proj-id="' + p.id + '"' + (tlMsReorder ? ' ondragover="tlMsDragOver(event)" ondragleave="tlMsDragLeave(event)" ondrop="tlMsDrop(event)"' : '') + '>';
  h += '<div class="tl-label tl-label-sub"' + (tlMsReorder ? ' draggable="true" ondragstart="tlMsDragStart(event,\'' + ms.id + '\',\'' + p.id + '\')" ondragend="tlMsDragEnd(event)"' : '') +
    ' title="' + eH(msTitle) + ' — 클릭: 진척률·작업노트 업데이트"' +
    ' onclick="tlMsOpenUpdate(event,\'' + ms.id + '\',\'' + p.id + '\',' + _msProg + ')"' +
    ' style="width:' + labelW + 'px;min-width:' + labelW + 'px;max-width:' + labelW + 'px;cursor:pointer">' +
    '<span style="color:var(--t5);font-size:11px;display:flex;align-items:center;gap:4px;white-space:nowrap">' + (tlMsReorder ? '<span class="tl-ms-grip" style="opacity:.6;cursor:grab" title="드래그하여 순서 변경">⠿</span>' : '') + eH(ms.name) +
    ' <span class="badge" style="background:' + msStInfo.bg + ';color:' + msStInfo.color + ';font-size:8px;padding:1px 4px">' + msStInfo.label + '</span>' + _perf.html +
    '</span></div>';
  h += '<div class="tl-bars" style="width:' + ctx.totalWidth + 'px">';
  var msEditCls = tlEditMode ? ' tl-bar-editable' : '';
  h += '<div class="' + msBarCls + msEditCls + '" data-type="ms" data-id="' + ms.id + '"' +
    ' title="' + eH(msTitle) + (tlEditMode ? '' : ' — 클릭: 업데이트') + '"' +
    (tlEditMode ? '' : ' onclick="tlMsOpenUpdate(event,\'' + ms.id + '\',\'' + p.id + '\',' + _msProg + ')"') +
    ' style="' + msBarStyle + 'background:' + msBarBg + (tlEditMode ? '' : ';cursor:pointer') + '">';
  // v13.140 마일스톤 달성률 시각화 — 진척률 채움 바(프로젝트 막대와 동일 패턴) + 완료 시 ✓
  if (_msProg > 0) {
    var _msFillCol = _msProg >= 100 ? SEM_COLOR.ok : p.color;
    h += '<div class="tl-bar-progress' + (_msProg > 30 ? ' prominent' : '') + '" style="width:' + Math.min(_msProg, 100) + '%;background:' + _msFillCol + '"></div>';
  }
  if (tlEditMode) {
    h += '<div class="tl-handle tl-handle-l" data-handle="left"></div>';
    h += '<div class="tl-handle tl-handle-r" data-handle="right"></div>';
  }
  // v13.133 마일스톤 진척률 % 표시 (v13.140 100%는 ✓)
  if (_msProg > 0) {
    h += '<span class="tl-bar-pct small">' + (_msProg >= 100 ? '✓' : Math.round(_msProg) + '%') + '</span>';
  }
  if (tlDayOffset) h += _tlDdayBadgeHtml(ms.endDate || ms.startDate, ctx.todayStr);
  h += '</div>';
  if (ctx.todayPos >= 0) h += '<div class="tl-today-line" style="left:' + ctx.todayPos + 'px"></div>';
  h += '</div></div>';
  return h;
}

/* 마운트 후처리 — 썸네일 지연 로드, 스크롤 위치(날짜 이동/이전 위치/오늘 중앙), 드래그 잔재 정리·바인딩, 의존 화살표 */
function _tlAfterMount(ctx, prevScroll) {
  // v13.156 라벨 썸네일 — 메모 이미지 없는 행은 참고이미지 커버 지연 로드
  if (tlShowThumb) tlFillThumbs();

  // 날짜 이동(오늘/지정)이 있으면 그 날짜를 중앙으로, 아니면 재렌더는 이전 위치 복원, 첫 렌더는 오늘 중앙
  var scrollEl = document.getElementById('tlScroll');
  if (scrollEl) {
    if (_tlJumpDate) {
      var jpos = getDatePosition(_tlJumpDate, ctx.rangeStart, ctx.units);
      _tlJumpDate = null;
      if (jpos >= 0) {
        var jview = scrollEl.clientWidth - ctx.labelW;
        scrollEl.scrollLeft = Math.max(0, jpos - jview / 2);
      } else if (prevScroll) {
        scrollEl.scrollLeft = prevScroll.left; scrollEl.scrollTop = prevScroll.top;
      }
    } else if (prevScroll) {
      scrollEl.scrollLeft = prevScroll.left;
      scrollEl.scrollTop = prevScroll.top;
    } else if (ctx.todayPos >= 0) {
      var viewW = scrollEl.clientWidth - ctx.labelW;
      scrollEl.scrollLeft = ctx.todayPos - viewW / 2;
    }
  }

  // 재렌더 시 비정상 종료된 막대 드래그 툴팁 잔재 정리
  var _orphanDrag = document.querySelectorAll('.tl-drag-tooltip');
  for (var _od = 0; _od < _orphanDrag.length; _od++) _orphanDrag[_od].remove();

  // 편집 모드일 때 드래그 이벤트 바인딩
  if (tlEditMode) {
    bindBarDrag();
  }

  // 의존관계 화살표 렌더
  drawDependencyArrows(ctx.projects, ctx.rangeStart, ctx.units, ctx.labelW);
}

/* ═══ 정렬/그룹 공통 (v13.151) — 좌측 목록과 타임라인 행을 동일 순서로 일치화 ═══ */
var TL_STATUS_GROUP_ORDER = ['delayed', 'active', 'waiting', 'hold', 'done'];
// [순수] 정렬 모드별 비교자
function _tlProjCmpBy(sort) {
  return function (a, b) {
    var an = (a.name || a.orderNo || ''), bn = (b.name || b.orderNo || '');
    switch (sort) {
      case 'name': return an.localeCompare(bn, 'ko');            // 가나다·abc 정순
      case 'name_desc': return bn.localeCompare(an, 'ko');       // 역순
      case 'created': return (a.createdAt || '').localeCompare(b.createdAt || '');       // 최초등록 오래된순
      case 'created_desc': return (b.createdAt || '').localeCompare(a.createdAt || '');  // 최신순
      case 'deadline': return (a.endDate || '9999-12-31').localeCompare(b.endDate || '9999-12-31');
      case 'progress': return (Number(b.progress) || 0) - (Number(a.progress) || 0);
      case 'status': {
        var so = { delayed: 0, active: 1, waiting: 2, hold: 3, done: 4 };
        var sa = so[autoProjectStatus(a)]; if (sa == null) sa = 9;
        var sb = so[autoProjectStatus(b)]; if (sb == null) sb = 9;
        return (sa - sb) || an.localeCompare(bn, 'ko');
      }
      default: { // 사용자 지정 순서(전역 sort_order) — 파이프라인 드래그와 통일. 미지정은 뒤(최신 등록 먼저)
        var oa = a.sortOrder, ob = b.sortOrder, noa = (oa == null), nob = (ob == null);
        if (noa && nob) return (b.createdAt || '').localeCompare(a.createdAt || '');
        if (noa) return 1;
        if (nob) return -1;
        return oa - ob;
      }
    }
  };
}
// 반환: [{ key, label, color, bg, items[] }]. 그룹 모드 아니면 단일 그룹(label 빈값).
// opt: { sort, groupBy } — 생략 시 현재 전역(tlSort/tlGroupBy)
function _tlGroupProjects(list, opt) {
  var sort = (opt && opt.sort != null) ? opt.sort : tlSort;
  var groupBy = (opt && opt.groupBy != null) ? opt.groupBy : tlGroupBy;
  var cmp = _tlProjCmpBy(sort);
  var arr = (list || []).slice();
  if (groupBy !== 'status') { arr.sort(cmp); return [{ key: '', label: '', items: arr }]; }
  var groups = {};
  arr.forEach(function (p) { var k = autoProjectStatus(p); (groups[k] = groups[k] || []).push(p); });
  var keys = TL_STATUS_GROUP_ORDER.filter(function (k) { return groups[k]; })
    .concat(Object.keys(groups).filter(function (k) { return TL_STATUS_GROUP_ORDER.indexOf(k) < 0; }));
  return keys.map(function (k) {
    var info = (typeof PROJ_STATUS !== 'undefined' && PROJ_STATUS[k]) || (typeof PROJ_STATUS !== 'undefined' ? PROJ_STATUS.waiting : { icon: '', label: k, color: 'var(--t3)', bg: 'var(--bg-i)' });
    return { key: k, label: info.icon + ' ' + info.label, color: info.color, bg: info.bg, items: groups[k].sort(cmp) };
  });
}

/* ═══ 프로젝트 리스트 패널 ═══ */
function renderTlProjectList(allProjects) {
  var el = document.getElementById('tlProjList');
  if (!el) return;

  if (!allProjects.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--t6);padding:16px;font-size:11px">등록된 프로젝트가 없습니다.</div>';
    return;
  }

  // v13.151 타임라인과 동일한 정렬/그룹(_tlGroupProjects) 적용 → 좌측 목록·타임라인 순서 일치
  var groups = _tlGroupProjects(allProjects);
  var grouped = (tlGroupBy === 'status');
  function itemHtml(p) {
    var st = autoProjectStatus(p);
    var stInfo = PROJ_STATUS[st] || PROJ_STATUS.waiting;
    var isDone = st === 'done';
    var _pr = Number(p.progress) || 0;
    var _prc = _pr >= 100 ? SEM_COLOR.ok : _pr >= 50 ? 'var(--ac)' : _pr > 0 ? SEM_COLOR.warn : 'var(--t6)';
    return '<div class="tl-list-item' + (isDone ? ' tl-list-done' : '') + (grouped ? ' tl-list-grouped' : '') + '" onclick="tlScrollToProject(\'' + p.id + '\')" title="' + eH((p.startDate || '') + ' ~ ' + (p.endDate || '')) + ' · 진행률 ' + _pr + '%">' +
      '<span class="tl-list-dot" style="background:' + p.color + '"></span>' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(p.name || p.orderNo) + '</span>' +
      '<span style="font-size:9px;font-weight:700;color:' + _prc + ';flex-shrink:0;min-width:26px;text-align:right">' + _pr + '%</span>' +
      (grouped ? '' : '<span class="badge" style="background:' + stInfo.bg + ';color:' + stInfo.color + ';font-size:8px;padding:1px 5px;flex-shrink:0">' + stInfo.label + '</span>') +
    '</div>';
  }
  var html = '';
  groups.forEach(function (g) {
    if (grouped && g.label) {
      html += '<div class="tl-list-group" style="border-left:3px solid ' + (g.color || 'var(--ac)') + ';color:' + (g.color || 'var(--t3)') + '">' +
        '<span>' + g.label + '</span><span class="tl-list-group-n">' + g.items.length + '</span></div>';
    }
    g.items.forEach(function (p) { html += itemHtml(p); });
  });

  el.innerHTML = html;
}

function tlScrollToProject(projId) {
  // 완료 숨기기 중이면 자동 해제
  if (tlHideDone) {
    tlHideDone = false;
    var tog = document.getElementById('tlHideDoneTog');
    if (tog) tog.checked = false;
    // 재렌더 후 스크롤 실행
    renderTimeline().then(function () {
      doTlScroll(projId);
    }).catch(function (err) {
        console.error('[tlScrollToProject]', err);
        if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
    });
    return;
  }
  doTlScroll(projId);
}

function doTlScroll(projId) {
  var scrollEl = document.getElementById('tlScroll');
  if (!scrollEl) return;

  // 해당 프로젝트 행 찾기
  var row = scrollEl.querySelector('[data-proj-id="' + projId + '"]');
  if (!row) return;

  // 세로 스크롤: 해당 행을 뷰 상단으로
  var headerH = scrollEl.querySelector('.tl-header-row');
  var offsetTop = row.offsetTop - (headerH ? headerH.offsetHeight : 0);
  scrollEl.scrollTop = Math.max(offsetTop - 8, 0);

  // 가로 스크롤: Today Line 중앙 배치
  var todayLine = row.querySelector('.tl-today-line');
  if (todayLine) {
    var labelW = row.querySelector('.tl-label');
    var lw = labelW ? labelW.offsetWidth : 180;
    var viewW = scrollEl.clientWidth - lw;
    scrollEl.scrollLeft = todayLine.offsetLeft - viewW / 2;
  }

  // 하이라이트 효과
  row.style.outline = '2px solid var(--ac)';
  row.style.outlineOffset = '-1px';
  row.style.borderRadius = '4px';
  setTimeout(function () {
    row.style.outline = '';
    row.style.outlineOffset = '';
    row.style.borderRadius = '';
  }, 1500);
}

/* ═══ 레이블 최대 폭 측정 ═══ */
var _measureCache={};
function measureTextCached(ctx, text){
  var key=ctx.font+'|'+text;
  if(_measureCache[key]!==undefined)return _measureCache[key];
  var w=ctx.measureText(text).width;
  _measureCache[key]=w;
  return w;
}
/* 메모 HTML에서 이미지 src 추출 — 호버 프리뷰 폴백용 (v13.149). 최대 12장 */
function _tlMemoImgs(memo) {
  if (!memo || typeof memo !== 'string' || memo.indexOf('<img') < 0) return [];
  var out = [], re = /<img[^>]+src\s*=\s*"([^"]+)"/gi, m, n = 0;
  while ((m = re.exec(memo)) && n < 12) { out.push(m[1]); n++; }
  return out;
}

/* ═══ 프로젝트 라벨 대표 이미지 썸네일 (v13.156) — 메모 이미지 즉시, 참고이미지 지연 로드 ═══ */
var _tlThumbCache = {}; // pid → 첫 이미지 src 또는 false(없음)
function _tlLabelThumb(p) {
  var memo = (window._tlOv && window._tlOv[p.id] && window._tlOv[p.id].memoImgs) || _tlMemoImgs(p.memo);
  var inner = (memo && memo.length) ? ('<img src="' + memo[0] + '" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover">') : '';
  return '<div class="tl-thumb" data-proj-thumb="' + p.id + '" onclick="event.stopPropagation();tlThumbClick(\'' + p.id + '\')" title="대표 이미지 — 클릭하여 크게 보기">' + inner + '</div>';
}
function tlThumbClick(pid) {
  var memo = (window._tlOv && window._tlOv[pid] && window._tlOv[pid].memoImgs) || [];
  function openMemo() {
    if (memo.length && typeof pimgOpenViewer === 'function') pimgOpenViewer(memo.map(function (s) { return { src: s }; }), 0);
    else if (typeof showToast === 'function') showToast('등록된 이미지가 없습니다.');
  }
  if (typeof projImagesGet === 'function') {
    projImagesGet(pid).then(function (list) { if (list && list.length && typeof pimgOpenViewer === 'function') pimgOpenViewer(list, 0); else openMemo(); }).catch(openMemo);
  } else openMemo();
}
// 렌더 후: 메모 이미지가 없는 행은 참고이미지(project_images) 커버를 지연 로드(캐시)
function tlFillThumbs() {
  if (!tlShowThumb || typeof projImagesGet !== 'function') return;
  var boxes = document.querySelectorAll('.tl-thumb[data-proj-thumb]');
  for (var i = 0; i < boxes.length; i++) {
    var box = boxes[i];
    if (box.querySelector('img')) continue;                 // 메모 이미지 이미 표시됨
    var pid = box.getAttribute('data-proj-thumb');
    if (_tlThumbCache[pid] === false) continue;             // 이미지 없음 확인됨
    if (_tlThumbCache[pid]) { box.innerHTML = '<img src="' + _tlThumbCache[pid] + '" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover">'; continue; }
    (function (box2, pid2) {
      projImagesGet(pid2).then(function (list) {
        if (list && list.length) { _tlThumbCache[pid2] = list[0].src; box2.innerHTML = '<img src="' + list[0].src + '" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover">'; }
        else { _tlThumbCache[pid2] = false; }
      }).catch(function () {});
    })(box, pid);
  }
}

/* ═══ 라벨 셋째 줄용 — 기간/D-Day 포맷 헬퍼 (v13.43) ═══ */
function _tlFmtPeriod(p) {
  var s = p.startDate || '', e = p.endDate || '';
  if (!s && !e) return '';
  function md(d) {
    if (!d || d.length < 10) return d || '';
    return parseInt(d.slice(5,7),10) + '/' + parseInt(d.slice(8,10),10);
  }
  var thisYr = String(new Date().getFullYear()).slice(2);
  var sy = s ? s.slice(2,4) : '', ey = e ? e.slice(2,4) : '';
  var sameYear = (s && e) ? sy === ey : true;
  function fmtOne(d, y) {
    if (!d) return '';
    if (sameYear && (y === thisYr || y === ey)) return md(d);
    return "'" + y + '.' + md(d);
  }
  var sf = fmtOne(s, sy), ef = fmtOne(e, ey);
  if (s && e) return sf + ' ~ ' + ef;
  if (s) return sf + ' ~';
  return '~ ' + ef;
}
function _tlFmtDday(p, st) {
  if (!p.endDate || p.endDate.length < 10) return null;
  if (st === 'done' || st === 'closed') return null;
  var t = new Date(); t.setHours(0,0,0,0);
  var ed = new Date(p.endDate); if (isNaN(ed.getTime())) return null;
  var diff = Math.round((ed - t) / 86400000);
  var label, color;
  if (diff > 7) { label = 'D-' + diff; color = 'var(--t5)'; }
  else if (diff > 0) { label = 'D-' + diff; color = SEM_COLOR.warn; }
  else if (diff === 0) { label = 'D-Day'; color = SEM_COLOR.warn; }
  else { label = 'D+' + Math.abs(diff); color = SEM_COLOR.danger; }
  return { label: label, color: color };
}

/* 마일스톤 라벨용 실적 표시 — 보고 투입/목표h · 진척률% (업무일지는 연동 안 함). text=폭측정용, html=렌더용 */
function _tlMsPerf(ms, msWorkH) {
  var prog = Number(ms.progress) || 0;
  var tgt = 0; var mat = ms.assigneeTargets || {};
  Object.keys(mat).forEach(function (k) { tgt += Number(mat[k]) || 0; });
  tgt = Math.round(tgt * 10) / 10;
  var act = Math.round((Number(ms.reportedHours) || 0) * 10) / 10;   // 보고 투입만
  // v13.143 시간(h) + 일(d, 8h=1일) 병기
  var _hpd = (typeof MS_HOURS_PER_DAY === 'number' && MS_HOURS_PER_DAY) ? MS_HOURS_PER_DAY : 8;
  var hoursTxt = '';
  if (act > 0 || tgt > 0) {
    var _hPart = act + (tgt > 0 ? '/' + tgt : '') + 'h';
    var _actD = Math.round((act / _hpd) * 10) / 10;
    var _tgtD = Math.round((tgt / _hpd) * 10) / 10;
    hoursTxt = _hPart + ' (' + _actD + (tgt > 0 ? '/' + _tgtD : '') + 'd)';
  }
  var progTxt = (prog > 0 || ms.progressUpdatedAt) ? (prog + '%') : '';
  if (!hoursTxt && !progTxt) return { text: '', html: '' };
  var text = [hoursTxt, progTxt].filter(Boolean).join(' · ');
  var col = prog >= 100 ? SEM_COLOR.ok : (prog >= 50 ? SEM_COLOR.purple : (prog > 0 ? SEM_COLOR.warn : 'var(--t6)'));
  var html = ' <span style="font-size:8px;font-weight:600;white-space:nowrap">' +
    (hoursTxt ? '<span style="color:var(--t6)">' + hoursTxt + '</span>' : '') +
    (hoursTxt && progTxt ? '<span style="color:var(--t6)"> · </span>' : '') +
    (progTxt ? '<span style="color:' + col + '">' + progTxt + '</span>' : '') +
    '</span>';
  return { text: text, html: html };
}

/* 타임라인 마일스톤 클릭 → 진척률·작업노트 업데이트 모달 (표준 가드된 pdMsProgressUpdate 재사용) */
function tlMsOpenUpdate(ev, msId, projId, prog) {
  if (tlEditMode) return;   // 기간 조정(편집) 모드에선 드래그/리사이즈 우선
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  if (typeof pdMsProgressUpdate !== 'function') {
    if (typeof showToast === 'function') showToast('업데이트 기능을 사용할 수 없습니다.', 'error');
    return;
  }
  pdMsProgressUpdate(msId, projId, Number(prog) || 0, {
    onSaved: function () { if (typeof renderTimeline === 'function') renderTimeline(); }
  });
}

var _tlMeasureCanvas = null;
function calcLabelWidth(projects, milestones, msWorkH) {
  // 숨겨진 캔버스로 텍스트 폭 측정 (v13.137 모듈 레벨 캔버스 재사용)
  if (!_tlMeasureCanvas) _tlMeasureCanvas = document.createElement('canvas');
  var ctx = _tlMeasureCanvas.getContext('2d');

  var maxW = 0;

  // 프로젝트: dot(8) + gap(6) + 이름 + padding(24)
  ctx.font = '600 12px "Noto Sans KR", sans-serif';
  projects.forEach(function (p) {
    var nameW = measureTextCached(ctx, p.name || p.orderNo);
    var w = 8 + 6 + nameW + 24;
    if (w > maxW) maxW = w;
  });

  // 프로젝트 하단 뱃지 행: 뱃지아이콘+라벨 + gap + 진척률
  ctx.font = '600 10px "Noto Sans KR", sans-serif';
  projects.forEach(function (p) {
    var st = autoProjectStatus(p);
    var stInfo = PROJ_STATUS[st] || PROJ_STATUS.waiting;
    var badgeW = measureTextCached(ctx, stInfo.icon + ' ' + stInfo.label) + 14; // badge padding
    var progW = p.progress ? measureTextCached(ctx, p.progress + '%') + 8 : 0;
    var w = badgeW + progW + 24; // padding
    if (w > maxW) maxW = w;
  });
  // v13.43: 셋째 줄 — 기간 + D-Day 폭도 반영해 라벨 폭이 너무 좁아 잘리지 않도록
  // v13.44: 넷째 줄 — 담당자 표시 (이름 외 N명 형태) 폭도 반영
  ctx.font = '400 9px "Noto Sans KR", sans-serif';
  var _shortFn2 = (typeof shortName === 'function') ? shortName : function(n){return n;};
  projects.forEach(function (p) {
    var st = autoProjectStatus(p);
    var period = _tlFmtPeriod(p);
    var dd = _tlFmtDday(p, st);
    var combined = period + (dd ? '  ' + dd.label : '');
    if (combined) {
      var w = measureTextCached(ctx, combined) + 24;
      if (w > maxW) maxW = w;
    }
    // 담당자 행 폭
    var asg = (p.assignees || []).filter(Boolean);
    if (asg.length > 0) {
      var sl = asg.map(_shortFn2);
      var lbl = sl.length <= 3 ? sl.join(', ') : (sl.slice(0,2).join(', ') + ' 외 ' + (sl.length-2) + '명');
      var aw = measureTextCached(ctx, '👤 ' + lbl) + 24;
      if (aw > maxW) maxW = aw;
    }
    // v13.45: 라이프사이클 step-icon 행 — 6 × 15px + gap(3px×5) + padding(24)
    if (typeof PROJ_PHASE !== 'undefined') {
      var stepCount = Object.keys(PROJ_PHASE).length;
      var lcW = stepCount * 15 + (stepCount - 1) * 3 + 24;
      if (lcW > maxW) maxW = lcW;
    }
  });

  // 마일스톤: indent(24) + "└ " + 이름 + gap(4) + 뱃지 + padding(12)
  ctx.font = '400 11px "Noto Sans KR", sans-serif';
  milestones.forEach(function (ms) {
    var nameW = measureTextCached(ctx, '└ ' + ms.name);
    var msSt = ms.status || 'waiting';
    var msStInfo = PROJ_STATUS[msSt] || PROJ_STATUS.waiting;
    ctx.font = '600 8px "Noto Sans KR", sans-serif';
    var badgeW = measureTextCached(ctx, msStInfo.label) + 10; // badge padding
    var perf = (typeof _tlMsPerf === 'function') ? _tlMsPerf(ms, msWorkH) : { text: '' };
    var perfW = perf.text ? measureTextCached(ctx, perf.text) + 10 : 0;
    ctx.font = '400 11px "Noto Sans KR", sans-serif';
    var w = 24 + nameW + 4 + badgeW + perfW + 12;
    if (w > maxW) maxW = w;
  });

  // 최소 160px, 최대 400px (+ 썸네일 컬럼)
  var base = Math.max(160, Math.min(Math.ceil(maxW), 400));
  base += _tlThumbColW();
  return base;
}

/* ═══ 스케일별 단위 생성 ═══ */
function getTimeUnits(start, end, scale) {
  var units = [];
  var d = new Date(start);

  if (scale === 'hour') {
    // 시간 단위 — 프로젝트/마일스톤 데이터는 날짜 단위라 막대는 자정 경계에 정렬됨.
    // 라벨은 과밀 방지: 자정=날짜(M/D), 그 외엔 6시간 간격(6/12/18시)만 표기.
    d.setHours(0, 0, 0, 0); // 로컬 자정에 정렬 — 날짜 경계가 0시 컬럼에 오도록
    while (d <= end) {
      var hh = d.getHours();
      var hds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      var hlabel = (hh === 0) ? ((d.getMonth() + 1) + '/' + d.getDate()) : (hh % 6 === 0 ? (hh + '시') : '');
      (function (hds2, hh2) {
        units.push({ label: hlabel, date: hds2, hour: hh2, contains: function (dt) { return dt === hds2 && hh2 === 0; } });
      })(hds, hh);
      d.setHours(d.getHours() + 1);
    }
  } else if (scale === 'day') {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate()); // 로컬 자정 — 날짜 문자열은 dateToStr(로컬)로
    while (d <= end) {
      var ds = dateToStr(d);
      (function (ds2) {
        units.push({ label: (d.getMonth() + 1) + '/' + d.getDate(), date: ds2, contains: function (dt) { return dt === ds2; } });
      })(ds);
      d.setDate(d.getDate() + 1);
    }
  } else if (scale === 'week') {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()); // 일요일 시작 (로컬 자정)
    while (d <= end) {
      var ws = dateToStr(d);
      var weStr = ymdAddDays(ws, 6);
      (function (ws2, we2) {
        units.push({
          label: (d.getMonth() + 1) + '/' + d.getDate(),
          startDate: ws2, endDate: we2,
          contains: function (dt) { return dt >= ws2 && dt <= we2; }
        });
      })(ws, weStr);
      d.setDate(d.getDate() + 7);
    }
  } else if (scale === 'month') {
    d = new Date(d.getFullYear(), d.getMonth(), 1);
    while (d <= end) {
      var ms = dateToStr(d);
      var mlStr = monthEndYmd(d.getFullYear(), d.getMonth() + 1);
      (function (ms2, ml2) {
        units.push({
          label: d.getFullYear() + '.' + (d.getMonth() + 1),
          startDate: ms2, endDate: ml2,
          contains: function (dt) { return dt >= ms2 && dt <= ml2; }
        });
      })(ms, mlStr);
      d.setMonth(d.getMonth() + 1);
    }
  } else { // quarter
    d = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
    while (d <= end) {
      var qs = dateToStr(d);
      var q = Math.floor(d.getMonth() / 3) + 1;
      var qeStr = monthEndYmd(d.getFullYear(), d.getMonth() + 3);
      (function (qs2, qe2) {
        units.push({
          label: d.getFullYear() + ' Q' + q,
          startDate: qs2, endDate: qe2,
          contains: function (dt) { return dt >= qs2 && dt <= qe2; }
        });
      })(qs, qeStr);
      d.setMonth(d.getMonth() + 3);
    }
  }
  return units;
}

function getUnitWidth() { return _tlUnitWidthFor(tlScale); }
// [순수] 스케일별 단위 폭(px)
function _tlUnitWidthFor(scale) {
  if (scale === 'hour') return 18;
  if (scale === 'day') return 32;
  if (scale === 'week') return 60;
  if (scale === 'month') return 120;
  return 180;
}

function getDatePosition(dateStr, rangeStart, units) {
  if (!units || !units.length) return -1;
  var w = getUnitWidth();
  // 시간 스케일: 날짜 단위 데이터는 자정(hour 0)에 정렬 → 시 단위 인덱스 산술 O(1)
  if (tlScale === 'hour') {
    if (!units[0].date) return -1;
    var hIdx = daysDiff(units[0].date, String(dateStr).slice(0, 10)) * 24 - (units[0].hour || 0);
    if (hIdx < 0 || hIdx >= units.length) return -1;
    return hIdx * w;
  }
  // 일 스케일: 균등 1일 단위 → 산술 O(1)
  if (units[0].date) {
    var idx = daysDiff(units[0].date, dateStr);
    if (idx < 0 || idx >= units.length) return -1;
    return idx * w;
  }
  // 주/월/분기: startDate 기준 이진 탐색 O(log n)
  var lo = 0, hi = units.length - 1, found = -1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    var u = units[mid];
    if (dateStr < u.startDate) hi = mid - 1;
    else if (dateStr > u.endDate) lo = mid + 1;
    else { found = mid; break; }
  }
  if (found < 0) return -1;
  var uf = units[found];
  var total = daysDiff(uf.startDate, uf.endDate) || 1;
  var offset = daysDiff(uf.startDate, dateStr);
  return found * w + (offset / total) * w;
}

function getTodayPosition(rangeStart, units) {
  return getDatePosition(localDate(), rangeStart, units);
}

/* ═══ 단계 밴드 오버레이 (프로젝트 바 위에 단계별 색상 구간 표시) ═══ */
function buildPhaseBands(proj, rangeStart, units) {
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  var phaseKeys = Object.keys(phases).sort(function (a, b) { return (phases[a].seq || 0) - (phases[b].seq || 0); });
  if (!phaseKeys.length || !proj.phases) return '';

  // 프로젝트 바의 left/width 계산
  var barLeft = getDatePosition(proj.startDate, rangeStart, units);
  var barRight = getDatePosition(ymdAddDays(proj.endDate, 1), rangeStart, units);
  if (barLeft < 0) barLeft = 0;
  if (barRight < 0) return '';
  var barWidth = Math.max(barRight - barLeft, 20);

  var html = '';
  phaseKeys.forEach(function (k) {
    var ph = proj.phases[k];
    if (!ph || ph.status === 'waiting') return;
    var phColor = phases[k].color || '#888';
    var phStart = ph.startDate || proj.startDate;
    var phEnd = ph.endDate || (ph.status === 'active' ? localDate() : null);
    if (!phStart || !phEnd) return;

    var pLeft = getDatePosition(phStart, rangeStart, units);
    var pRight = getDatePosition(ymdAddDays(phEnd, 1), rangeStart, units);

    // 바 내부 상대 위치 (%)
    var relLeft = Math.max(0, (pLeft - barLeft) / barWidth * 100);
    var relWidth = Math.min(100 - relLeft, (pRight - pLeft) / barWidth * 100);
    if (relWidth <= 0) return;

    html += '<div style="position:absolute;left:' + relLeft.toFixed(1) + '%;width:' + relWidth.toFixed(1) + '%;top:0;bottom:0;background:' + phColor + ';opacity:0.35;z-index:0;pointer-events:none" title="' + phases[k].icon + ' ' + phases[k].label + '"></div>';
  });
  return html;
}

function getBarStyle(startDate, endDate, rangeStart, units) {
  if (!startDate || !endDate) return 'display:none;';
  var left = getDatePosition(startDate, rangeStart, units);
  // 종료일의 끝 지점: 종료일 다음날 위치를 구해서 종료일 하루 전체를 포함
  var right = getDatePosition(ymdAddDays(endDate, 1), rangeStart, units);
  if (left < 0) left = 0;
  if (right < 0) right = left + getUnitWidth();
  var width = Math.max(right - left, 20);
  return 'left:' + left + 'px;width:' + width + 'px;';
}

/* ═══ 타임라인 모달 프레임 — 공용 createModal 위에 기존 수제 오버레이와 같은 모양으로 ═══
   제목/닫기 헤더는 각 모달 html 이 직접 그린다(✕ 닫기 버튼·푸터 레이아웃 유지) → title 없이 호출.
   o: { id, z, html, box(박스 css — padding/폭/높이), bg(오버레이 배경), blur, cls(박스에 덧붙일 class) }
   backdrop 클릭·Esc 로 닫히지 않음(v13.62/63 — 편집 중 실수로 데이터 유실 방지). */
function _tlModal(o) {
  var m = createModal({
    id: o.id, z: o.z, html: o.html,
    overlayStyle: 'padding:0;background:' + (o.bg || 'rgba(0,0,0,.6)') + ';backdrop-filter:blur(' + (o.blur || '4px') + ')',
    // createModal 기본 박스(그림자·글자색·width:100%·max-height:85vh·overflow-y)를 수제 오버레이 시절 값으로 되돌린 뒤 o.box 적용
    boxStyle: 'box-shadow:none;color:inherit;width:auto;max-height:none;overflow-y:visible;' + o.box
  });
  if (o.cls) m.box.className += ' ' + o.cls;
  return m;
}

/* ═══ 프로젝트 등록/편집 모달 ═══ */
async function showProjectModal(projId) {
  var existing = document.getElementById('projModal');
  if (existing) existing.remove();
  // 메모 이미지 선택 상태 초기화 (이전 모달 잔재 방지)
  if (typeof _memoSelectedImg !== 'undefined') _memoSelectedImg = null;

  var loaded = await _projModalLoad(projId);
  var proj = loaded.proj;
  _projModalResetStaging(loaded.projMs);

  // v13.62: backdrop 클릭으로 닫히지 않도록 — 편집 중 실수 클릭으로 데이터 유실 방지.
  //         반드시 [✕ 닫기] 또는 [💾 등록/수정] 버튼으로만 닫힘.
  _tlModal({
    id: 'projModal', z: 9999, cls: 'pm-modal',
    box: 'padding:20px;max-width:880px;width:95%;max-height:90vh;overflow:auto',
    html: _projModalFormHtml(proj, loaded.projMs, loaded.allProjects)
  });

  // Integration 2: 기존 담당자가 있으면 부하 표시 초기화
  if (proj && proj.assignees && proj.assignees.length) {
    renderAssigneeWorkload(proj.id);
  }
  // v13.147 참고 이미지 섹션 — 신규 등록 시 이전 스테이징 초기화
  if (!proj && typeof pimgResetStaging === 'function') pimgResetStaging();
  if (typeof renderProjImages === 'function') renderProjImages(proj ? proj.id : '');
}

/* 편집 대상 로드 — 프로젝트·마일스톤(정렬, 중복은 DB에서 정리)·전체 프로젝트(의존관계 후보) */
async function _projModalLoad(projId) {
  var proj = null;
  var projMs = [];
  var allProjects = await projGetAll();
  if (projId) {
    proj = await projGet(projId);
    projMs = await msGetByProject(projId);
    projMs.sort(function (a, b) { return (a.order - b.order) || (a.createdAt || '').localeCompare(b.createdAt || ''); });
    // 중복 정리 — (name|startDate|endDate) 키로 먼저 등장한 것만 유지, 나머지는 DB에서 삭제
    var seen = {};
    var uniq = [];
    var dupIds = [];
    projMs.forEach(function (m) {
      var key = (m.name || '').trim() + '|' + (m.startDate || '') + '|' + (m.endDate || '');
      if (seen[key]) { dupIds.push(m.id); } else { seen[key] = true; uniq.push(m); }
    });
    if (dupIds.length) {
      projMs = uniq;
      Promise.all(dupIds.map(function (id) { return msDel(id).catch(function () {}); }))
        .then(function () { if (typeof showToast === 'function') showToast('중복 마일스톤 ' + dupIds.length + '개 정리됨', 'warn'); });
    }
  }
  return { proj: proj, projMs: projMs, allProjects: allProjects };
}

/* 모달 스테이징 초기화 — 원래 마일스톤 id(삭제 diff 기준) + 마일스톤별 인원 목표시간(assigneeTargets) */
function _projModalResetStaging(projMs) {
  window._projMsOrigIds = projMs.map(function (m) { return m.id; });
  _msTargetStaging = {};
  _msRowKeySeq = 0;
  projMs.forEach(function (m) { _msTargetStaging[m.id] = Object.assign({}, m.assigneeTargets || {}); });
}

/* [순수] 마일스톤 편집 리스트 (#msRows 내용) — 드래그 순서 변경·이관·삭제 버튼 */
function _projMsEditRowsHtml(projMs) {
  if (!projMs.length) return '';
  return projMs.map(function (m) {
    return '<div class="proj-ms-row" data-msid="' + m.id + '" data-rowkey="' + m.id + '" ondragover="msRowDragOver(event)" ondrop="msRowDrop(event)" style="display:grid;grid-template-columns:18px 1fr 110px 110px 90px 30px 30px;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--bd)">' +
      '<span class="ms-drag-handle" draggable="true" ondragstart="msRowDragStart(event)" ondragend="msRowDragEnd(event)" title="드래그하여 순서 변경">⠿</span>' +
      '<input type="text" class="si ms-name" value="' + eH(m.name) + '" style="padding:4px 8px;font-size:11px;padding-left:8px">' +
      '<input type="date" class="si ms-start" value="' + m.startDate + '" style="padding:4px 6px;font-size:10px;padding-left:6px">' +
      '<input type="date" class="si ms-end" value="' + m.endDate + '" style="padding:4px 6px;font-size:10px;padding-left:6px">' +
      '<select class="si ms-status" style="padding:4px 6px;font-size:10px;padding-left:6px">' + Object.keys(PROJ_STATUS).map(function (k) { return '<option value="' + k + '"' + (m.status === k ? ' selected' : '') + '>' + PROJ_STATUS[k].label + '</option>'; }).join('') + '</select>' +
      '<button class="btn btn-g btn-s" title="다른 프로젝트로 이관" onclick="showMilestoneTransferModal(\'' + m.id + '\')" style="padding:2px 4px;font-size:11px">↪</button>' +
      '<button class="btn btn-d btn-s" onclick="this.closest(\'.proj-ms-row\').remove()" style="padding:2px 6px">✕</button>' +
    '</div>';
  }).join('');
}

/* [순수] 등록/편집 폼 전체 HTML (헤더·입력·메모·참고이미지·마일스톤·푸터) */
function _projModalFormHtml(proj, projMs, allProjects) {
  // order.js 수주번호 목록
  var orderOpts = '<option value="">직접 입력</option>';
  if (typeof ORDER_MAP !== 'undefined') {
    Object.keys(ORDER_MAP).forEach(function (k) {
      var sel = proj && proj.orderNo === k ? ' selected' : '';
      var oName = typeof ORDER_MAP[k] === 'object' ? (ORDER_MAP[k].name || '') : (ORDER_MAP[k] || '');
      orderOpts += '<option value="' + eH(k) + '"' + sel + '>' + eH(k) + ' - ' + eH(oName) + '</option>';
    });
  }

  var statusOpts = Object.keys(PROJ_STATUS).map(function (k) {
    var sel = proj && proj.status === k ? ' selected' : '';
    return '<option value="' + k + '"' + sel + '>' + PROJ_STATUS[k].icon + ' ' + PROJ_STATUS[k].label + '</option>';
  }).join('');

  return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
      '<h3 style="font-size:14px;font-weight:700;color:var(--t1)">' + (proj ? '📝 프로젝트 편집' : '➕ 프로젝트 등록') + '</h3>' +
      '<button class="btn btn-g btn-s" onclick="document.getElementById(\'projModal\').remove()">✕ 닫기</button>' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label class="fl">수주번호</label><select class="si" id="projOrderSel" style="padding-left:8px;font-size:11px" onchange="var v=this.value;if(v){document.getElementById(\'projOrderNo\').value=v;var oi=typeof ORDER_MAP!==\'undefined\'?ORDER_MAP[v]:null;var n=oi?(typeof oi===\'object\'?oi.name||\'\':(oi||\'\')):\'\';;if(n)document.getElementById(\'projName\').value=n}">' + orderOpts + '</select>' +
          '<input type="text" class="si" id="projOrderNo" value="' + eH(proj ? proj.orderNo : '') + '" placeholder="수주번호 직접 입력..." style="margin-top:4px;padding-left:10px;font-size:11px"></div>' +
        '<div><label class="fl">프로젝트명</label><input type="text" class="si" id="projName" value="' + eH(proj ? proj.name : '') + '" placeholder="프로젝트명..." style="padding-left:10px"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +
        '<div><label class="fl">시작일</label><input type="date" class="si" id="projStart" value="' + (proj ? proj.startDate : '') + '" style="padding-left:10px" onchange="_projUpdateEstimatedHours()"></div>' +
        '<div><label class="fl">종료일</label><input type="date" class="si" id="projEnd" value="' + (proj ? proj.endDate : '') + '" style="padding-left:10px" onchange="_projUpdateEstimatedHours()"></div>' +
        '<div><label class="fl">상태</label><select class="si" id="projStatus" style="padding-left:8px">' + statusOpts + '</select></div>' +
      '</div>' +
      _projVisibilityRowHtml(proj) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label class="fl">예상 총 투입시간 (h)</label><input type="number" class="si" id="projEstHours" value="' + (proj ? proj.estimatedHours : '') + '" placeholder="시작일·종료일 선택 시 자동 계산" style="padding-left:10px" min="0"><div id="projEstHoursHint" style="font-size:10px;color:var(--t5);margin-top:3px">날짜 변경 시 주말·대한민국 공휴일을 제외하고 하루 8시간으로 계산합니다.</div></div>' +
        '<div><label class="fl">담당자 <span style="font-size:9px;color:var(--t6)">(쉼표로 구분)</span></label><input type="text" class="si" id="projAssignees" value="' + eH(proj ? (proj.assignees || []).join(', ') : '') + '" placeholder="홍길동, 김철수..." style="padding-left:10px" oninput="renderAssigneeWorkload(\'' + (proj ? proj.id : '') + '\')">' +
          _projAssigneeGroupHtml(proj) +
          '<div id="assigneeWorkloadArea" style="margin-top:4px"></div></div>' +
      '</div>' +
      _projDepChecksHtml(proj, allProjects) +
      _projMemoEditorHtml(proj) +
      // v13.147 참고 이미지(장비 사진 등) 섹션
      '<div id="projImagesSection" style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px"></div>' +
      // 마일스톤 섹션
      '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px">' +
        '<div class="pm-ms-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;row-gap:8px;margin-bottom:8px">' +
          '<span style="font-size:12px;font-weight:600;color:var(--t4)">◆ 마일스톤 (하위 단계)</span>' +
          '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">' +
            (proj && proj.orderNo ? '<button class="btn btn-g btn-s" style="font-size:10px" onclick="runSuggestMilestones(\'' + eH(proj.orderNo) + '\')">🤖 마일스톤 제안</button>' : '') +
            '<button class="btn btn-g btn-s" style="font-size:10px" onclick="editMsTargetsMatrix()" title="담당자별·마일스톤별 목표시간 배분">🎯 목표 배분</button>' +
            '<button class="btn btn-g btn-s" onclick="addMsRow()">+ 추가</button>' +
          '</div>' +
        '</div>' +
        '<div id="msRows">' + _projMsEditRowsHtml(projMs) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="pm-footer" style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;flex-wrap:wrap">' +
      (proj ? '<button class="btn btn-d btn-s" onclick="deleteProjectUI(\'' + proj.id + '\')">🗑 삭제</button>' : '') +
      '<button class="btn btn-p" onclick="saveProjectUI(\'' + (proj ? proj.id : '') + '\')">' + (proj ? '💾 수정' : '➕ 등록') + '</button>' +
    '</div>';
}

// 가시성: 본인만(private) / 부서(dept) / 테넌트 전체(tenant) + 공유·복사·이관 버튼(편집 시)
function _projVisibilityRowHtml(proj) {
  return '<div class="pm-vis-row" style="display:grid;grid-template-columns:1fr 2fr;gap:10px;align-items:end">' +
    '<div><label class="fl">가시성</label><select class="si" id="projVisibility" style="padding-left:8px;font-size:11px">' +
      ['private','dept','tenant'].map(function (v) {
        var labels = { 'private':'🔒 비공개 (본인+공유 사용자)', 'dept':'🏢 부서 공개', 'tenant':'🌐 전체 공개' };
        var cur = proj && proj.visibility ? proj.visibility : 'private';
        return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + labels[v] + '</option>';
      }).join('') +
    '</select></div>' +
    (proj ? '<div class="pm-share-btns" style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">' +
      '<button class="btn btn-g btn-s" style="font-size:10px" onclick="showProjectShareModal(\'' + proj.id + '\')">👥 공유 관리</button>' +
      '<button class="btn btn-g btn-s" style="font-size:10px" onclick="showProjectCopyModal(\'' + proj.id + '\')" title="이 프로젝트를 다른 이름으로 복사(내용·인원·마일스톤 동일)">📋 복사</button>' +
      '<button class="btn btn-g btn-s" style="font-size:10px" onclick="showProjectTransferModal(\'' + proj.id + '\')">↪ 소유권 이관</button>' +
    '</div>' : '<div style="font-size:10px;color:var(--t6);align-self:center">등록 후 공유 사용자 추가·복사 가능</div>') +
  '</div>';
}

// Integration 6: 그룹에서 가져오기 dropdown + 그룹 저장 버튼
function _projAssigneeGroupHtml(proj) {
  var groups = typeof memberGroups !== 'undefined' ? memberGroups : [];
  var grpOpts = '<option value="">👥 그룹에서 가져오기...</option>';
  groups.forEach(function (g) {
    grpOpts += '<option value="' + eH(g.id) + '">' + eH(g.name) + ' (' + g.members.length + '명)</option>';
  });
  return '<div style="display:flex;gap:4px;margin-top:4px;align-items:center">' +
    '<select class="si" style="flex:1;padding:3px 6px;padding-left:6px;font-size:10px" onchange="if(this.value){var g=typeof getGroup===\'function\'?getGroup(this.value):null;if(g){document.getElementById(\'projAssignees\').value=g.members.join(\', \');if(typeof renderAssigneeWorkload===\'function\')renderAssigneeWorkload(\'' + (proj ? proj.id : '') + '\')}this.value=\'\'}">' + grpOpts + '</select>' +
    '<button class="btn btn-g btn-s" style="font-size:9px;white-space:nowrap;padding:3px 6px" onclick="saveAssigneesAsGroup()" title="현재 담당자를 그룹으로 저장">💾 그룹 저장</button>' +
  '</div>';
}

// 의존관계 (선행 프로젝트) 체크 목록 — 후보(자기 자신 제외)가 없으면 ''
function _projDepChecksHtml(proj, allProjects) {
  var allP = allProjects || [];
  var deps = proj ? (proj.dependencies || []) : [];
  var others = allP.filter(function (op) { return !proj || op.id !== proj.id; });
  if (!others.length) return '';
  var depChecks = others.map(function (op) {
    var chk = deps.includes(op.id) ? ' checked' : '';
    return '<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--t3);cursor:pointer"><input type="checkbox" class="proj-dep-chk" value="' + op.id + '"' + chk + '><span class="dot" style="background:' + op.color + ';width:6px;height:6px;border-radius:50%;display:inline-block"></span>' + eH(op.name || op.orderNo) + '</label>';
  }).join('');
  return '<div><label class="fl">선행 프로젝트 (의존관계)</label><div style="display:flex;flex-wrap:wrap;gap:8px;max-height:80px;overflow:auto;padding:6px;background:var(--bg-i);border-radius:6px">' + depChecks + '</div></div>';
}

// 메모 — contenteditable로 인라인 이미지 지원 (v13.35~) + 다중 + 삭제 (v13.37~)
function _projMemoEditorHtml(proj) {
  return '<div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:6px">' +
      '<label class="fl" style="margin:0">메모</label>' +
      '<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">' +
        '<button type="button" class="btn btn-g btn-s" style="font-size:10px;padding:3px 8px" onclick="memoInsertImagePicker()" title="이미지 파일 선택 (여러 개 동시 가능)">🖼 이미지 추가</button>' +
        '<button type="button" class="btn btn-g btn-s" style="font-size:10px;padding:3px 8px" onclick="memoCompressImages()" title="이 메모에 이미 넣은 큰 이미지들을 압축·축소">🗜 이미지 압축</button>' +
        '<button type="button" id="memoDelImgBtn" class="btn btn-d btn-s" style="font-size:10px;padding:3px 8px;opacity:.45;cursor:not-allowed" disabled onclick="memoDeleteSelectedImage()" title="에디터에서 이미지 클릭 후 이 버튼으로 삭제">🗑 선택 이미지 삭제</button>' +
        '<span style="font-size:9px;color:var(--t6);align-self:center" title="여러 이미지 동시 선택/붙여넣기/드래그 가능. 5MB 이하 권장">다중·붙여넣기·드래그</span>' +
      '</div>' +
    '</div>' +
    '<div id="projMemo" contenteditable="true" class="si" ' +
      'onclick="memoEditorClickHandler(event)" onkeydown="memoEditorKeyHandler(event)" ' +
      'onpaste="memoPasteHandler(event)" ondragover="event.preventDefault();this.style.borderColor=\'var(--ac)\'" ondragleave="this.style.borderColor=\'\'" ondrop="memoDropHandler(event)" ' +
      'style="padding:10px;resize:vertical;min-height:240px;max-height:500px;overflow:auto;white-space:pre-wrap;word-break:break-word"' +
    '>' + (proj ? memoToHtml(proj.memo) : '') + '</div>' +
  '</div>';
}

/* ═══ Integration 2: 담당자 부하 경고 ═══ */
function checkAssigneeWorkload(assignees, excludeProjId) {
  return projGetAll().then(function (projects) {
    var result = {};
    assignees.forEach(function (name) {
      if (!name) return;
      var count = 0;
      var projNames = [];
      projects.forEach(function (p) {
        if (excludeProjId && p.id === excludeProjId) return;
        var st = autoProjectStatus(p);
        if (st === 'done' || st === 'hold') return;
        if (p.assignees && p.assignees.indexOf(name) >= 0) {
          count++;
          projNames.push(p.name || p.orderNo);
        }
      });
      result[name] = { count: count, projects: projNames };
    });
    return result;
  });
}

function renderAssigneeWorkload(excludeProjId) {
  var area = document.getElementById('assigneeWorkloadArea');
  if (!area) return;
  var input = document.getElementById('projAssignees');
  if (!input) return;

  var names = input.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!names.length) { area.innerHTML = ''; return; }

  checkAssigneeWorkload(names, excludeProjId || '').then(function (result) {
    var html = '<div style="display:flex;flex-wrap:wrap;gap:4px">';
    names.forEach(function (name) {
      var info = result[name];
      if (!info) return;
      var c = info.count;
      var color, bg, label;
      if (c <= 1) { color = SEM_COLOR.ok; bg = 'rgba(16,185,129,.12)'; label = '여유'; }
      else if (c === 2) { color = SEM_COLOR.info; bg = 'rgba(59,130,246,.12)'; label = '적정'; }
      else if (c === 3) { color = SEM_COLOR.warn; bg = 'rgba(245,158,11,.12)'; label = '주의'; }
      else { color = SEM_COLOR.danger; bg = 'rgba(239,68,68,.12)'; label = '과부하'; }
      var displayN = typeof shortName === 'function' ? shortName(name) : name;
      var title = info.projects.length ? name + ': ' + info.projects.join(', ') : name + ': 배정 프로젝트 없음';
      html += '<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:' + bg + ';color:' + color + ';border:1px solid ' + color + '30;cursor:help" title="' + eH(title) + '">' + eH(displayN) + ' ' + c + '건 <b>' + label + '</b></span>';
    });
    html += '</div>';
    if (names.some(function (n) { return result[n] && result[n].count >= 3; })) {
      html += '<div style="font-size:10px;color:' + SEM_COLOR.warn + ';margin-top:3px">⚠️ 3건 이상 배정된 담당자가 있습니다</div>';
    }
    area.innerHTML = html;
  }).catch(function (err) {
      console.error('[renderAssigneeWorkload]', err);
      if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

function addMsRow() {
  var container = document.getElementById('msRows');
  var statusOpts = Object.keys(PROJ_STATUS).map(function (k) {
    return '<option value="' + k + '">' + PROJ_STATUS[k].label + '</option>';
  }).join('');

  var row = document.createElement('div');
  row.className = 'proj-ms-row';
  row.setAttribute('data-rowkey', 'new-' + (++_msRowKeySeq));
  row.setAttribute('ondragover', 'msRowDragOver(event)');
  row.setAttribute('ondrop', 'msRowDrop(event)');
  row.style.cssText = 'display:grid;grid-template-columns:18px 1fr 110px 110px 90px 30px;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--bd)';
  row.innerHTML =
    '<span class="ms-drag-handle" draggable="true" ondragstart="msRowDragStart(event)" ondragend="msRowDragEnd(event)" title="드래그하여 순서 변경">⠿</span>' +
    '<input type="text" class="si ms-name" value="" placeholder="단계명..." style="padding:4px 8px;font-size:11px;padding-left:8px">' +
    '<input type="date" class="si ms-start" value="" style="padding:4px 6px;font-size:10px;padding-left:6px">' +
    '<input type="date" class="si ms-end" value="" style="padding:4px 6px;font-size:10px;padding-left:6px">' +
    '<select class="si ms-status" style="padding:4px 6px;font-size:10px;padding-left:6px">' + statusOpts + '</select>' +
    '<button class="btn btn-d btn-s" onclick="this.closest(\'.proj-ms-row\').remove()" style="padding:2px 6px">✕</button>';
  container.appendChild(row);
}

/* ═══ 마일스톤 편집 행 드래그 순서 변경 (편집 모달) ═══
   saveProjectUI 가 #msRows 의 DOM 순서대로 order:i 를 저장하므로,
   여기서는 DOM 순서만 재배열하면 [저장] 시 자동 영속화된다. */
var _msDragRow = null;
// 마일스톤별 인원 목표시간 스테이징: { rowKey: { 이름: 목표h } }. 편집 모달 열 때 초기화. (저장은 항상 시간 단위)
var _msTargetStaging = {};
var _msRowKeySeq = 0;
var MS_HOURS_PER_DAY = 8;       // 일 단위 입력 시 1일 = 8시간(실작업) 환산
var _msTargetUnit = 'h';        // 목표 배분 매트릭스 입력 단위 ('h' 시간 | 'd' 일)
function msRowDragStart(e) {
  _msDragRow = e.target.closest('.proj-ms-row');
  if (!_msDragRow) return;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', _msDragRow.getAttribute('data-msid') || 'new'); } catch (_) {}
  _msDragRow.style.opacity = '0.4';
}
function msRowDragEnd() {
  if (_msDragRow) _msDragRow.style.opacity = '';
  _msDragRow = null;
}
function msRowDragOver(e) {
  if (!_msDragRow) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var row = e.currentTarget;
  if (row === _msDragRow) return;
  var container = row.parentNode;
  if (!container) return;
  var rect = row.getBoundingClientRect();
  var after = e.clientY > rect.top + rect.height / 2;
  container.insertBefore(_msDragRow, after ? row.nextSibling : row);
}
function msRowDrop(e) {
  e.preventDefault();
  if (_msDragRow) _msDragRow.style.opacity = '';
  _msDragRow = null;
}

/* ═══ 마일스톤 × 담당자 목표시간 배분 매트릭스 (편집 모달) ═══
   담당자(#projAssignees)와 현재 마일스톤 행을 읽어 매트릭스 입력을 띄운다.
   값은 _msTargetStaging[rowKey][name]에 스테이징되고, 프로젝트 저장 시 각 마일스톤에 반영된다. */
function editMsTargetsMatrix() {
  _msTargetUnit = 'h';   // 열 때마다 시간 단위로 시작 (저장값=시간 그대로 표시)
  var aEl = document.getElementById('projAssignees');
  var assignees = aEl ? aEl.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
  var seenA = {};
  assignees = assignees.filter(function (n) { if (seenA[n]) return false; seenA[n] = true; return true; });
  if (!assignees.length) { if (typeof showToast === 'function') showToast('담당자를 먼저 입력하세요.', 'warn'); return; }

  var rows = [];
  document.querySelectorAll('#msRows .proj-ms-row').forEach(function (r) {
    var rk = r.getAttribute('data-rowkey');
    var nmEl = r.querySelector('.ms-name');
    var nm = (nmEl && nmEl.value.trim()) || '(이름 없음)';
    if (rk) rows.push({ rk: rk, name: nm });
  });
  if (!rows.length) { if (typeof showToast === 'function') showToast('마일스톤을 먼저 추가하세요.', 'warn'); return; }

  var th = '<th style="text-align:left;padding:6px 8px;font-size:10px;color:var(--t4);position:sticky;left:0;background:var(--bg-p)">마일스톤 \\ 담당자</th>';
  assignees.forEach(function (n) {
    var dn = typeof shortName === 'function' ? shortName(n) : n;
    th += '<th style="padding:6px 6px;font-size:10px;color:var(--t3);min-width:62px" title="' + eH(n) + '">' + eH(dn) + '</th>';
  });
  th += '<th style="padding:6px 8px;font-size:10px;color:var(--t4);text-align:right">합계</th>';

  var body = '';
  rows.forEach(function (row) {
    var stg = _msTargetStaging[row.rk] || {};
    body += '<tr>';
    body += '<td style="padding:4px 8px;font-size:11px;color:var(--t2);white-space:nowrap;position:sticky;left:0;background:var(--bg-p);max-width:160px;overflow:hidden;text-overflow:ellipsis" title="' + eH(row.name) + '">' + eH(row.name) + '</td>';
    assignees.forEach(function (n) {
      var v = (stg[n] != null) ? stg[n] : '';
      body += '<td style="padding:2px 4px;text-align:center"><input type="number" min="0" step="0.5" class="si msTgtCell" data-rk="' + eH(row.rk) + '" data-nm="' + eH(n) + '" value="' + v + '" style="width:54px;padding:4px 4px;font-size:11px;text-align:center" oninput="msTargetsRecalc()"></td>';
    });
    body += '<td class="msTgtRowSum" style="padding:4px 8px;font-size:11px;color:var(--ac);font-weight:600;text-align:right">0h</td>';
    body += '</tr>';
  });

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<h3 style="font-size:14px;font-weight:700;color:var(--t1)">🎯 인원별 목표시간 배분</h3>' +
      '<button class="btn btn-g btn-s" onclick="document.getElementById(\'msTargetsModal\').remove()">✕ 닫기</button>' +
    '</div>' +
    '<div style="font-size:10px;color:var(--t5);margin-bottom:8px;line-height:1.5">마일스톤 × 담당자별 목표를 <b>시간(h)</b> 또는 <b>일(d)</b> 단위로 입력하세요. 일 단위는 <b>1일=8시간</b>으로 자동 환산되어 저장됩니다(합계는 시간 기준). [배분 저장] 후 프로젝트 <b>[수정/등록]</b>을 눌러야 최종 반영됩니다.</div>' +
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">' +
      '<span style="font-size:11px;color:var(--t4);font-weight:600">입력 단위</span>' +
      '<button type="button" id="msUnitH" class="btn btn-s btn-p" style="font-size:11px" onclick="msTargetsSetUnit(\'h\')">시간(h)</button>' +
      '<button type="button" id="msUnitD" class="btn btn-s btn-g" style="font-size:11px" onclick="msTargetsSetUnit(\'d\')">일(d) ×8h</button>' +
    '</div>' +
    '<div style="overflow:auto;max-height:60vh"><table style="border-collapse:collapse;width:100%">' +
      '<thead><tr style="border-bottom:1px solid var(--bd)">' + th + '</tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '<tfoot><tr style="border-top:1px solid var(--bd)">' +
        '<td style="padding:6px 8px;font-size:10px;color:var(--t4);position:sticky;left:0;background:var(--bg-p);font-weight:700">담당자 합계</td>' +
        assignees.map(function () { return '<td class="msTgtColSum" style="padding:6px 6px;font-size:10px;color:var(--t3);text-align:center;font-weight:600">0h</td>'; }).join('') +
        '<td class="msTgtGrand" style="padding:6px 8px;font-size:11px;color:var(--ac);font-weight:700;text-align:right">0h</td>' +
      '</tr></tfoot>' +
    '</table></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button class="btn btn-g btn-s" onclick="document.getElementById(\'msTargetsModal\').remove()">취소</button>' +
      '<button class="btn btn-p" onclick="saveMsTargetsMatrix()">💾 배분 저장</button>' +
    '</div>';
  _tlModal({ id: 'msTargetsModal', z: 10001, box: 'padding:20px;max-width:90%;max-height:88vh;overflow:auto', html: html });
  msTargetsRecalc();
}

/* 입력 단위 전환 (시간 ↔ 일). 셀 값을 변환하고 합계 재계산. 저장은 항상 시간. */
function msTargetsSetUnit(unit) {
  var modal = document.getElementById('msTargetsModal');
  if (!modal || (unit !== 'h' && unit !== 'd') || unit === _msTargetUnit) return;
  var oldToHours = (_msTargetUnit === 'd') ? MS_HOURS_PER_DAY : 1;   // 현재 표시값 → 시간
  modal.querySelectorAll('.msTgtCell').forEach(function (inp) {
    if (inp.value === '') return;
    var raw = parseFloat(inp.value);
    if (isNaN(raw)) return;
    var hours = raw * oldToHours;
    var nv = (unit === 'd') ? (hours / MS_HOURS_PER_DAY) : hours;
    inp.value = (nv === 0) ? '' : String(Math.round(nv * 100) / 100);
  });
  _msTargetUnit = unit;
  var bh = document.getElementById('msUnitH'), bd = document.getElementById('msUnitD');
  if (bh) bh.className = 'btn btn-s ' + (unit === 'h' ? 'btn-p' : 'btn-g');
  if (bd) bd.className = 'btn btn-s ' + (unit === 'd' ? 'btn-p' : 'btn-g');
  msTargetsRecalc();
}

function msTargetsRecalc() {
  var modal = document.getElementById('msTargetsModal');
  if (!modal) return;
  var factor = (_msTargetUnit === 'd') ? MS_HOURS_PER_DAY : 1;   // 표시값 → 시간
  // 합계도 현재 입력 단위로 표시 (일이면 d, 시간이면 h)
  var fmtSum = function (hours) {
    return (_msTargetUnit === 'd') ? (Math.round((hours / MS_HOURS_PER_DAY) * 100) / 100) + 'd' : (Math.round(hours * 10) / 10) + 'h';
  };
  var bodyRows = modal.querySelectorAll('tbody tr');
  var colSums = [];
  var grand = 0;
  bodyRows.forEach(function (tr) {
    var inputs = tr.querySelectorAll('.msTgtCell');
    var rowSum = 0;
    inputs.forEach(function (inp, ci) {
      var v = (parseFloat(inp.value) || 0) * factor;
      rowSum += v;
      colSums[ci] = (colSums[ci] || 0) + v;
    });
    var rs = tr.querySelector('.msTgtRowSum');
    if (rs) rs.textContent = fmtSum(rowSum);
    grand += rowSum;
  });
  var colCells = modal.querySelectorAll('.msTgtColSum');
  colCells.forEach(function (c, i) { c.textContent = fmtSum(colSums[i] || 0); });
  var g = modal.querySelector('.msTgtGrand');
  if (g) g.textContent = fmtSum(grand);
}

function saveMsTargetsMatrix() {
  var modal = document.getElementById('msTargetsModal');
  if (!modal) return;
  var cells = modal.querySelectorAll('.msTgtCell');
  var factor = (_msTargetUnit === 'd') ? MS_HOURS_PER_DAY : 1;   // 일 입력이면 시간으로 환산
  cells.forEach(function (c) {
    var rk = c.getAttribute('data-rk');
    var nm = c.getAttribute('data-nm');
    var v = (parseFloat(c.value) || 0) * factor;
    v = Math.round(v * 100) / 100;
    if (!_msTargetStaging[rk]) _msTargetStaging[rk] = {};
    if (v > 0) _msTargetStaging[rk][nm] = v;
    else delete _msTargetStaging[rk][nm];
  });
  modal.remove();
  if (typeof showToast === 'function') showToast('목표 배분 저장됨 — 프로젝트 [수정/등록]을 눌러 반영하세요');
}

async function saveProjectUI(existingId) {
  var form = _projFormRead(existingId);
  if (!form) return;   // 검증 실패 (토스트 표시됨)
  var data = form.data, assignees = form.assignees;

  var projId;
  try {
    if (existingId) {
      await updateProject(existingId, data);
      projId = existingId;
    } else {
      var p = await createProject(data);
      if (!p || !p.id) { showToast('프로젝트 저장 실패: DB 연결을 확인하세요.','warn'); return; }
      projId = p.id;
      // 신규 등록 시 스테이징된 참고 이미지 업로드 (best-effort)
      if (typeof pimgFlushStaging === 'function') { try { await pimgFlushStaging(projId); } catch (_) {} }
    }

    await _projSyncMilestones(projId, existingId);

    // 담당자 이름 → project_members 자동 동기화 (additive, best-effort)
    if (typeof syncAssigneesToMembers === 'function' && assignees.length) {
      try { await syncAssigneesToMembers(projId, assignees); } catch (_) { /* ignore */ }
    }

    document.getElementById('projModal').remove();
    await renderTimeline();
    if (typeof renderCalendar === 'function') await renderCalendar();
    showToast(existingId ? '프로젝트가 수정되었습니다' : '프로젝트가 등록되었습니다');

    // 신규 등록 + 비공개 + 담당자 없음 → 동료가 못 보는 상태이므로 공유 모달 자동 오픈
    if (!existingId && data.visibility === 'private' && (!assignees || !assignees.length)) {
      setTimeout(function () { if (typeof showProjectShareModal === 'function') showProjectShareModal(projId); }, 200);
    }
  } catch (err) {
    console.error('[saveProjectUI] 저장 실패:', err, err && err.data);
    showToast('프로젝트 저장 실패: ' + _projSaveErrMsg(err), 'error');
  }
}

/* 편집 폼 읽기 + 검증. 실패 시 토스트 후 null. 반환: { data(저장 페이로드), assignees } */
var _projHolidayCache = {};
var _projEstimateRequest = 0;
async function _projUpdateEstimatedHours() {
  var request = ++_projEstimateRequest;
  var start = document.getElementById('projStart').value;
  var end = document.getElementById('projEnd').value;
  var hint = document.getElementById('projEstHoursHint');
  if (!start || !end || start > end) return;
  hint.textContent = '공휴일을 확인하는 중...';
  try {
    var firstYear = Number(start.slice(0, 4)), lastYear = Number(end.slice(0, 4));
    var years = [];
    for (let year = firstYear; year <= lastYear; year++) {
      if (!_projHolidayCache[year]) {
        _projHolidayCache[year] = fetch('https://date.nager.at/api/v3/PublicHolidays/' + year + '/KR')
          .then(function (response) { if (!response.ok) throw new Error('holiday service'); return response.json(); })
          .then(function (items) { return items.map(function (item) { return item.date; }); })
          .catch(function (error) { delete _projHolidayCache[year]; throw error; });
      }
      years.push(_projHolidayCache[year]);
    }
    var holidayLists = await Promise.all(years);
    if (request !== _projEstimateRequest || !hint.isConnected) return;
    var holidays = new Set([].concat.apply([], holidayLists));
    var day = new Date(start + 'T00:00:00Z');
    var last = new Date(end + 'T00:00:00Z');
    var workdays = 0;
    while (day <= last) {
      var weekday = day.getUTCDay();
      if (weekday !== 0 && weekday !== 6 && !holidays.has(day.toISOString().slice(0, 10))) workdays++;
      day.setUTCDate(day.getUTCDate() + 1);
    }
    document.getElementById('projEstHours').value = workdays * 8;
    hint.textContent = workdays + '근무일 × 8시간 = ' + (workdays * 8) + '시간 (주말·공휴일 제외, 직접 수정 가능)';
  } catch (error) {
    if (request !== _projEstimateRequest || !hint.isConnected) return;
    hint.textContent = '공휴일 정보를 불러오지 못했습니다. 예상 시간을 직접 입력해 주세요.';
    showToast('공휴일 정보를 불러오지 못했습니다. 예상 시간을 직접 입력해 주세요.', 'warn');
  }
}

function _projFormRead(existingId) {
  var name = document.getElementById('projName').value.trim();
  var orderNo = document.getElementById('projOrderNo').value.trim();
  // 프로젝트명이 없으면 수주번호로 대체, 둘 다 없으면 '미정'
  if (!name) name = orderNo || '미정 프로젝트';

  var startDate = document.getElementById('projStart').value;
  var endDate = document.getElementById('projEnd').value;
  if (!startDate || !endDate) { showToast('시작일과 종료일을 입력하세요.','warn'); return null; }
  if (startDate > endDate) { showToast('종료일이 시작일보다 앞설 수 없습니다.','warn'); return null; }
  var _estHint = document.getElementById('projEstHoursHint');   // 힌트 요소가 없는 폼(구버전 모달 등)에서도 저장되게
  if (_estHint && _estHint.textContent === '공휴일을 확인하는 중...') {
    showToast('예상 시간 계산이 끝난 뒤 저장해 주세요.','warn'); return null;
  }

  var assigneesStr = document.getElementById('projAssignees').value;
  var assignees = assigneesStr ? assigneesStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];

  var depIds = [];
  document.querySelectorAll('.proj-dep-chk:checked').forEach(function (c) { depIds.push(c.value); });

  // 순환 의존 방지
  if (existingId && depIds.includes(existingId)) { showToast('자기 자신을 선행 프로젝트로 지정할 수 없습니다.','warn'); return null; }

  var visibilityEl = document.getElementById('projVisibility');
  var data = {
    orderNo: orderNo,
    name: name,
    startDate: startDate,
    endDate: endDate,
    status: document.getElementById('projStatus').value,
    estimatedHours: parseFloat(document.getElementById('projEstHours').value) || 0,
    assignees: assignees,
    dependencies: depIds,
    memo: _projMemoRead(),
    // 셀렉트가 없으면 visibility 미전송 → 서버가 기존 값 보존 (수정 시 private 리셋 방지)
    visibility: visibilityEl ? visibilityEl.value : undefined
  };
  return { data: data, assignees: assignees };
}

// 메모 에디터(contenteditable) innerHTML → sanitize. 비어있으면 빈 문자열.
function _projMemoRead() {
  var el = document.getElementById('projMemo');
  if (!el) return '';
  var html = (el.innerHTML || '').trim();
  // <br> 또는 빈 <div> 만 있는 경우 빈 문자열로 정규화
  if (/^(<br\s*\/?>|<div><br\s*\/?><\/div>|&nbsp;|\s)*$/i.test(html)) return '';
  return typeof sanitizeMemo === 'function' ? sanitizeMemo(html) : html;
}

/* 마일스톤 diff 기반 동기화 (destroy-recreate 제거 → 중복 방지)
   #msRows DOM 순서 = order. 기존 id 는 msPut, 새 행은 createMilestone, 빠진 원래 id 는 msDel */
async function _projSyncMilestones(projId, existingId) {
  var msRows = document.querySelectorAll('#msRows .proj-ms-row');
  var origIds = (existingId && Array.isArray(window._projMsOrigIds)) ? window._projMsOrigIds.slice() : [];
  var keptIds = {};
  var seenKeys = {};
  var msPromises = [];
  for (var i = 0; i < msRows.length; i++) {
    var row = msRows[i];
    var msName = row.querySelector('.ms-name').value.trim();
    if (!msName) continue;
    var msStart = row.querySelector('.ms-start').value;
    var msEnd = row.querySelector('.ms-end').value;
    var msStatus = row.querySelector('.ms-status').value;
    // 같은 모달 내 중복 입력도 차단
    var dupKey = msName + '|' + msStart + '|' + msEnd;
    if (seenKeys[dupKey]) continue;
    seenKeys[dupKey] = true;
    var existingMsId = row.getAttribute('data-msid');
    var rowKey = row.getAttribute('data-rowkey');
    var msTargets = (rowKey && _msTargetStaging[rowKey]) || {};
    if (existingMsId && origIds.indexOf(existingMsId) >= 0) {
      keptIds[existingMsId] = true;
      msPromises.push(msPut({ id: existingMsId, projectId: projId, name: msName, startDate: msStart, endDate: msEnd, status: msStatus, order: i, assigneeTargets: msTargets }));
    } else {
      msPromises.push(createMilestone({ projectId: projId, name: msName, startDate: msStart, endDate: msEnd, status: msStatus, order: i, assigneeTargets: msTargets }));
    }
  }
  // 제거된 마일스톤 삭제
  origIds.forEach(function (id) { if (!keptIds[id]) msPromises.push(msDel(id).catch(function () {})); });
  await Promise.all(msPromises);
  window._projMsOrigIds = null;
}

// [순수] 저장 실패 메시지 — 서버 CONFLICT/메시지 우선, HTTP 상태 덧붙임
function _projSaveErrMsg(err) {
  var detail = '';
  if (err && err.data) {
    if (err.data.error === 'CONFLICT') detail = '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.';
    else detail = err.data.message || err.data.error || '';
  }
  var msg = detail || err.message || String(err);
  return msg + (err && err.status ? ' (HTTP ' + err.status + ')' : '');
}

/* ═══ 프로젝트 사본(복사) 모달 — 내용·인원·마일스톤 동일 복사 (v13.146) ═══ */
function showProjectCopyModal(projId) {
  if (typeof projCopy !== 'function' || typeof projGet !== 'function') { if (typeof showToast === 'function') showToast('복사 기능을 사용할 수 없습니다.', 'error'); return; }
  projGet(projId).then(function (p) {
    var base = (p && (p.name || p.orderNo)) || '프로젝트';
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="font-size:13px;font-weight:700;color:var(--t1)">📋 프로젝트 사본 만들기</h3><button class="btn btn-g btn-s" onclick="document.getElementById(\'projCopyModal\').remove()">✕</button></div>' +
      '<div style="font-size:10px;color:var(--t6);margin-bottom:10px;line-height:1.6">원본: <b>' + eH(base) + '</b><br>내용·인원 할당·마일스톤·담당(정/부)을 동일하게 복사합니다. (진척률·보고시간 등 실적은 초기화)</div>' +
      '<label class="fl" style="font-size:11px">새 프로젝트 이름</label><input id="projCopyName" class="si" style="width:100%;box-sizing:border-box;margin-bottom:8px" value="' + eH(base + ' (사본)') + '">' +
      '<label class="fl" style="font-size:11px">수주번호(선택)</label><input id="projCopyOrder" class="si" style="width:100%;box-sizing:border-box;margin-bottom:12px" placeholder="비우면 빈 값">' +
      '<div style="display:flex;gap:8px"><button class="btn btn-g" style="flex:1" onclick="document.getElementById(\'projCopyModal\').remove()">취소</button><button class="btn btn-p" style="flex:1" id="projCopyOk" onclick="submitProjectCopy(\'' + projId + '\')">사본 생성</button></div>';
    _tlModal({ id: 'projCopyModal', z: 10002, bg: 'rgba(0,0,0,.55)', blur: '3px', box: 'border-radius:12px;padding:18px;width:360px;max-width:94%', html: html });
    var ni = document.getElementById('projCopyName'); if (ni) { ni.focus(); ni.select(); }
  }).catch(function () { if (typeof showToast === 'function') showToast('원본 정보를 불러오지 못했습니다.', 'error'); });
}
function submitProjectCopy(projId) {
  var nameEl = document.getElementById('projCopyName');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { if (typeof showToast === 'function') showToast('새 프로젝트 이름을 입력하세요', 'warn'); if (nameEl) nameEl.focus(); return; }
  var orderEl = document.getElementById('projCopyOrder');
  var orderNo = orderEl ? (orderEl.value || '').trim() : '';
  var btn = document.getElementById('projCopyOk'); if (btn) { btn.disabled = true; btn.textContent = '생성 중...'; }
  projCopy(projId, { name: name, orderNo: orderNo }).then(function () {
    var cm = document.getElementById('projCopyModal'); if (cm) cm.remove();
    var pm = document.getElementById('projModal'); if (pm) pm.remove();
    if (typeof showToast === 'function') showToast('사본 생성됨: ' + name);
    if (typeof renderTimeline === 'function') renderTimeline();
    if (typeof renderCalendar === 'function') renderCalendar();
  }).catch(function (err) {
    if (btn) { btn.disabled = false; btn.textContent = '사본 생성'; }
    var msg = (err && err.status === 403) ? '복사 권한이 없습니다.' : (err && err.status === 404) ? '서버 배포 후 사용 가능합니다.' : ((err && err.data && err.data.message) || (err && err.message) || '복사 실패');
    if (typeof showToast === 'function') showToast('❌ ' + msg, 'error');
  });
}

/* ═══ 프로젝트 공유 관리 모달 ═══ */
async function showProjectShareModal(projId) {
  // v13.63: backdrop 클릭 닫기 비활성화 — 데이터 유실 방지 (✕ 버튼만 닫기)
  _tlModal({
    id: 'projShareModal', z: 10000, box: 'padding:20px;width:520px;max-width:95%;max-height:80vh;overflow:auto',
    html: '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<h3 style="font-size:14px;font-weight:700;color:var(--t1)">👥 공유 사용자 관리</h3>' +
        '<button class="btn btn-g btn-s" onclick="document.getElementById(\'projShareModal\').remove()">✕</button>' +
      '</div>' +
      '<div id="projShareBody" style="font-size:11px;color:var(--t4)">로딩 중...</div>'
  });

  try {
    var pair = await Promise.all([projMembersGet(projId), userLookup()]);
    var members = pair[0], users = pair[1];
    var memberSet = {};
    members.forEach(function (m) { memberSet[m.userId] = m; });

    var html = '<div style="margin-bottom:10px;padding:8px;background:var(--bg-i);border-radius:6px">' +
      '<div style="font-size:11px;font-weight:600;color:var(--t3);margin-bottom:6px">현재 공유 사용자 (' + members.length + ')</div>' +
      (members.length ? members.map(function (m) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:11px">' +
          '<span>' + eH(m.userName || m.displayName || m.email) + ' <span style="color:var(--t6);font-size:10px">(' + (m.role || 'assignee') + ')</span></span>' +
          '<button class="btn btn-d btn-s" style="font-size:10px;padding:2px 6px" onclick="projShareRemoveUI(\'' + projId + '\',\'' + m.userId + '\')">제거</button>' +
        '</div>';
      }).join('') : '<div style="color:var(--t6);font-size:11px">공유된 사용자가 없습니다.</div>') +
    '</div>';

    var available = users.filter(function (u) { return !memberSet[u.id]; });
    html += '<div style="display:flex;gap:6px;align-items:end">' +
      '<div style="flex:1"><label class="fl">추가할 사용자</label>' +
        '<select id="projShareUser" class="si" style="padding-left:8px;font-size:11px">' +
          '<option value="">선택...</option>' +
          available.map(function (u) { return '<option value="' + u.id + '">' + eH(u.displayName || u.name) + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div><label class="fl">역할</label><select id="projShareRole" class="si" style="padding-left:8px;font-size:11px">' +
        '<option value="assignee">참여자</option><option value="pl">PL</option>' +
      '</select></div>' +
      '<button class="btn btn-p btn-s" onclick="projShareAddUI(\'' + projId + '\')">+ 추가</button>' +
    '</div>';

    document.getElementById('projShareBody').innerHTML = html;
  } catch (err) {
    document.getElementById('projShareBody').innerHTML = '<div style="color:' + SEM_COLOR.danger + '">로드 실패: ' + (err && err.message ? err.message : err) + '</div>';
  }
}

async function projShareAddUI(projId) {
  var sel = document.getElementById('projShareUser');
  var roleSel = document.getElementById('projShareRole');
  if (!sel || !sel.value) { showToast('사용자를 선택하세요.', 'warn'); return; }
  try {
    await projShareAdd(projId, sel.value, roleSel ? roleSel.value : 'assignee');
    showToast('공유 사용자가 추가되었습니다');
    showProjectShareModal(projId);
  } catch (err) {
    showToast('추가 실패: ' + (err && err.message ? err.message : err), 'error');
  }
}

async function projShareRemoveUI(projId, userId) {
  if (!confirm('이 사용자의 공유를 해제하시겠습니까?')) return;
  try {
    await projShareRemove(projId, userId);
    showToast('공유가 해제되었습니다');
    showProjectShareModal(projId);
  } catch (err) {
    showToast('해제 실패: ' + (err && err.message ? err.message : err), 'error');
  }
}

/* ═══ 프로젝트 소유권 이관 모달 ═══ */
async function showProjectTransferModal(projId) {
  // v13.63: backdrop 클릭 닫기 비활성화 — 데이터 유실 방지 (✕ 버튼만 닫기)
  _tlModal({
    id: 'projTransferModal', z: 10000, box: 'padding:20px;width:480px;max-width:95%',
    html: '<h3 style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:12px">↪ 소유권 이관</h3>' +
      '<div id="projTransferBody" style="font-size:11px;color:var(--t4)">로딩 중...</div>'
  });

  try {
    var users = await userLookup();
    var html =
      '<div style="margin-bottom:10px;color:var(--t4);font-size:11px;line-height:1.55">' +
        '· 소유자가 변경됩니다. 기존 소유자는 자동으로 공유 사용자(참여자)로 보존됩니다.<br>' +
        '· 새 소유자가 공유 멤버였다면 공유 목록에서 제거되고 소유자로 승격됩니다.' +
      '</div>' +
      '<label class="fl">새 소유자</label>' +
      '<select id="projTransferUser" class="si" style="padding-left:8px;font-size:11px">' +
        '<option value="">선택...</option>' +
        users.map(function (u) { return '<option value="' + u.id + '">' + eH(u.displayName || u.name) + '</option>'; }).join('') +
      '</select>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t3);margin-top:10px;cursor:pointer">' +
        '<input type="checkbox" id="projTransferKeep" checked> 기존 소유자를 공유 사용자로 유지' +
      '</label>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
        '<button class="btn btn-g btn-s" onclick="document.getElementById(\'projTransferModal\').remove()">취소</button>' +
        '<button class="btn btn-p btn-s" onclick="projTransferDoUI(\'' + projId + '\')">이관 실행</button>' +
      '</div>';
    document.getElementById('projTransferBody').innerHTML = html;
  } catch (err) {
    document.getElementById('projTransferBody').innerHTML = '<div style="color:' + SEM_COLOR.danger + '">로드 실패: ' + (err && err.message ? err.message : err) + '</div>';
  }
}

async function projTransferDoUI(projId) {
  var sel = document.getElementById('projTransferUser');
  if (!sel || !sel.value) { showToast('새 소유자를 선택하세요.', 'warn'); return; }
  var keep = document.getElementById('projTransferKeep').checked;
  if (!confirm('정말 소유권을 이관하시겠습니까?')) return;
  try {
    await projTransfer(projId, sel.value, { keepPrevAsMember: keep });
    showToast('소유권이 이관되었습니다');
    document.getElementById('projTransferModal').remove();
    var pm = document.getElementById('projModal'); if (pm) pm.remove();
    if (typeof renderTimeline === 'function') await renderTimeline();
  } catch (err) {
    showToast('이관 실패: ' + (err && err.message ? err.message : err), 'error');
  }
}

/* ═══ 마일스톤 이관 모달 ═══ */
async function showMilestoneTransferModal(msId) {
  // v13.63: backdrop 클릭 닫기 비활성화 — 데이터 유실 방지 (✕ 버튼만 닫기)
  _tlModal({
    id: 'msTransferModal', z: 10000, box: 'padding:20px;width:480px;max-width:95%',
    html: '<h3 style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:12px">↪ 마일스톤 이관</h3>' +
      '<div id="msTransferBody" style="font-size:11px;color:var(--t4)">로딩 중...</div>'
  });

  try {
    var projects = await projGetAll();
    var html =
      '<div style="margin-bottom:10px;color:var(--t4);font-size:11px">현재 마일스톤을 다른 프로젝트로 이동합니다. 양쪽 프로젝트에 쓰기 권한이 있어야 합니다.</div>' +
      '<label class="fl">대상 프로젝트</label>' +
      '<select id="msTransferProj" class="si" style="padding-left:8px;font-size:11px">' +
        '<option value="">선택...</option>' +
        (projects || []).map(function (p) { return '<option value="' + p.id + '">' + eH(p.name || p.orderNo) + '</option>'; }).join('') +
      '</select>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
        '<button class="btn btn-g btn-s" onclick="document.getElementById(\'msTransferModal\').remove()">취소</button>' +
        '<button class="btn btn-p btn-s" onclick="msTransferDoUI(\'' + msId + '\')">이관 실행</button>' +
      '</div>';
    document.getElementById('msTransferBody').innerHTML = html;
  } catch (err) {
    document.getElementById('msTransferBody').innerHTML = '<div style="color:' + SEM_COLOR.danger + '">로드 실패: ' + (err && err.message ? err.message : err) + '</div>';
  }
}

async function msTransferDoUI(msId) {
  var sel = document.getElementById('msTransferProj');
  if (!sel || !sel.value) { showToast('대상 프로젝트를 선택하세요.', 'warn'); return; }
  try {
    await msTransfer(msId, sel.value);
    showToast('마일스톤이 이관되었습니다');
    document.getElementById('msTransferModal').remove();
    var pm = document.getElementById('projModal'); if (pm) pm.remove();
    if (typeof renderTimeline === 'function') await renderTimeline();
  } catch (err) {
    showToast('이관 실패: ' + (err && err.message ? err.message : err), 'error');
  }
}

async function deleteProjectUI(id) {
  if (!confirm('이 프로젝트와 모든 마일스톤을 삭제하시겠습니까?')) return;
  try {
    await deleteProjectCascade(id);
    document.getElementById('projModal').remove();
    await renderTimeline();
    if (typeof renderCalendar === 'function') await renderCalendar();
    showToast('프로젝트가 삭제되었습니다', 'warn');
  } catch (err) {
    console.error('[deleteProjectUI]', err);
    if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  }
}

/* ═══ 프로젝트 상세 보기 ═══ */
/* ═══ 프로젝트 상세 패널은 project-detail.js 로 분리 ═══ */

/* ═══ 프로젝트 데이터 내보내기 ═══ */
async function exportProjectsJSON() {
  var _expData = await Promise.all([projGetAll(), msGetAll(), evtGetAll()]);
  var projects = _expData[0];
  var milestones = _expData[1];
  var events = _expData[2];

  var data = { projects: projects, milestones: milestones, events: events, exportedAt: new Date().toISOString() };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'project-data-' + localDate() + '.json';
  a.click();
}

/* ═══ 프로젝트 데이터 가져오기 ═══ */
function importProjectsJSON() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var text = await file.text();
    try {
      var data = JSON.parse(text);
      if (data.projects) {
        for (var i = 0; i < data.projects.length; i++) await projPut(data.projects[i]);
      }
      if (data.milestones) {
        for (var j = 0; j < data.milestones.length; j++) await msPut(data.milestones[j]);
      }
      if (data.events) {
        for (var k = 0; k < data.events.length; k++) await evtPut(data.events[k]);
      }
      showToast('가져오기 완료!');
      renderTimeline();
      renderCalendar();
    } catch (err) {
      showToast('JSON 파일 형식 오류: ' + err.message,'error');
    }
  };
  input.click();
}

/* ═══ 픽셀 → 날짜 변환 ═══ */
function positionToDate(px) {
  if (!tlUnits || !tlUnits.length) return null;
  var w = getUnitWidth();
  var idx = Math.floor(px / w);
  if (idx < 0) idx = 0;
  if (idx >= tlUnits.length) idx = tlUnits.length - 1;
  var u = tlUnits[idx];
  var uStart = u.startDate || u.date;
  var uEnd = u.endDate || u.date;
  var totalDays = daysDiff(uStart, uEnd) || 1;
  var frac = (px - idx * w) / w;
  var dayOffset = Math.round(frac * totalDays);
  return ymdAddDays(uStart, dayOffset);
}

/* ═══ 바 드래그 바인딩 ═══ */
function bindBarDrag() {
  var scrollEl = document.getElementById('tlScroll');
  if (!scrollEl) return;

  var bars = scrollEl.querySelectorAll('.tl-bar-editable');
  bars.forEach(function (bar) {
    // 핸들 드래그 (리사이즈)
    var handles = bar.querySelectorAll('.tl-handle');
    handles.forEach(function (h) {
      h.addEventListener('mousedown', function (e) {
        e.stopPropagation();
        e.preventDefault();
        startBarDrag(bar, h.dataset.handle, e);
      });
    });
    // 바 중앙 드래그 (이동)
    bar.addEventListener('mousedown', function (e) {
      if (e.target.classList.contains('tl-handle')) return;
      e.preventDefault();
      startBarDrag(bar, 'move', e);
    });
  });
}

/* ═══ 타임라인 마일스톤 하위 행 드래그 순서 변경 ═══
   같은 프로젝트 내에서만 재배열 가능. order 재계산 → 변경분만 msPut → 재렌더.
   (다른 프로젝트로 옮기려면 편집 모달의 ↪ 이관 버튼 사용) */
var _tlMsDrag = null;
function tlMsDragStart(e, msId, projId) {
  if (!tlMsReorder) { try { e.preventDefault(); } catch (_) {} return; } // 순서 변경 모드 OFF: 드래그 차단
  _tlMsDrag = { id: msId, projId: projId };
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', msId); } catch (_) {}
  var row = e.currentTarget.closest('.tl-row-sub');
  if (row) row.style.opacity = '0.4';
}
function tlMsDragEnd(e) {
  var row = e.currentTarget.closest('.tl-row-sub');
  if (row) row.style.opacity = '';
  var dz = document.querySelectorAll('.tl-row-sub.tl-ms-dropzone');
  for (var i = 0; i < dz.length; i++) dz[i].classList.remove('tl-ms-dropzone');
  _tlMsDrag = null;
}
function tlMsDragOver(e) {
  if (!_tlMsDrag) return;
  var row = e.currentTarget;
  // 다른 프로젝트의 마일스톤 위로는 드롭 불가 (preventDefault 안 하면 drop 미발생)
  if (row.getAttribute('data-proj-id') !== _tlMsDrag.projId) return;
  if (row.getAttribute('data-ms-id') === _tlMsDrag.id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  row.classList.add('tl-ms-dropzone');
}
function tlMsDragLeave(e) {
  e.currentTarget.classList.remove('tl-ms-dropzone');
}
function tlMsDrop(e) {
  if (!_tlMsDrag) return;
  var row = e.currentTarget;
  var projId = row.getAttribute('data-proj-id');
  var targetId = row.getAttribute('data-ms-id');
  if (projId !== _tlMsDrag.projId) return;
  e.preventDefault();
  row.classList.remove('tl-ms-dropzone');
  var dragId = _tlMsDrag.id;
  var rect = row.getBoundingClientRect();
  var after = e.clientY > rect.top + rect.height / 2;
  _tlMsDrag = null;
  if (!dragId || dragId === targetId) return;
  _tlReorderMs(projId, dragId, targetId, after);
}
function _tlReorderMs(projId, dragId, targetId, after) {
  return msGetByProject(projId).then(function (list) {
    list.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var fromIdx = -1, i;
    for (i = 0; i < list.length; i++) { if (list[i].id === dragId) { fromIdx = i; break; } }
    if (fromIdx < 0) return;
    var moved = list.splice(fromIdx, 1)[0];
    var insertIdx = list.length; // 타겟을 못 찾으면 맨 뒤
    for (i = 0; i < list.length; i++) { if (list[i].id === targetId) { insertIdx = i; break; } }
    if (after) insertIdx += 1;
    list.splice(insertIdx, 0, moved);
    var puts = [];
    list.forEach(function (m, idx) {
      if (m.order !== idx) {
        m.order = idx;
        puts.push(msPut({ id: m.id, projectId: projId, name: m.name, startDate: m.startDate, endDate: m.endDate, status: m.status, order: idx }));
      }
    });
    return Promise.all(puts);
  }).then(function () {
    return renderTimeline();
  }).then(function () {
    if (typeof showToast === 'function') showToast('마일스톤 순서 변경됨');
  }).catch(function (err) {
    console.error('[tlMsDrop]', err);
    if (typeof showToast === 'function') showToast('순서 변경 실패', 'error');
  });
}

/* ═══ 의존관계 화살표 ═══ */
function drawDependencyArrows(projects, rangeStart, units, labelW) {
  var scrollEl = document.getElementById('tlScroll');
  if (!scrollEl) return;

  // 기존 SVG 제거
  var oldSvg = scrollEl.querySelector('.tl-dep-svg');
  if (oldSvg) oldSvg.remove();

  // 의존관계가 있는 프로젝트 찾기
  var hasDeps = false;
  var _depProjMap = {};
  projects.forEach(function (p) { _depProjMap[p.id] = p; if (p.dependencies && p.dependencies.length) hasDeps = true; });
  if (!hasDeps) return;

  // 프로젝트 행 위치 맵핑 — 프로젝트 막대가 있는 행만. 마일스톤 행도 data-proj-id 를 가지므로
  // 예전엔 마지막 마일스톤 행이 프로젝트 행을 덮어써, 마일스톤 있는 프로젝트는 화살표가 안 그려졌다
  var projRows = {};
  var rows = scrollEl.querySelectorAll('.tl-row[data-proj-id]');
  rows.forEach(function (row) {
    var pid = row.dataset.projId;
    if (!projRows[pid] && row.querySelector('.tl-bar[data-type="proj"]')) projRows[pid] = row;
  });

  // SVG 생성
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tl-dep-svg');
  var scrollH = scrollEl.scrollHeight;
  var scrollW = scrollEl.scrollWidth;
  svg.setAttribute('width', scrollW);
  svg.setAttribute('height', scrollH);
  svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:5;overflow:visible';
  // SVG 가 스크롤 콘텐츠와 함께 움직이도록 스크롤 박스를 기준 상자로 — 예전엔 바깥 .tl-container 기준이라
  // 가로 스크롤한 만큼(scrollLeft) 화살표가 막대에서 어긋났다. tlScroll 안의 다른 absolute 요소는 모두 .tl-bars 기준이라 영향 없음
  if (getComputedStyle(scrollEl).position === 'static') scrollEl.style.position = 'relative';
  var _scR = scrollEl.getBoundingClientRect();

  // 화살표 마커 정의
  var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'depArrow');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto');
  var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', '0 0, 8 3, 0 6');
  poly.setAttribute('fill', SEM_COLOR.warn);
  marker.appendChild(poly);
  defs.appendChild(marker);
  svg.appendChild(defs);

  projects.forEach(function (p) {
    if (!p.dependencies || !p.dependencies.length) return;
    var toRow = projRows[p.id];
    if (!toRow) return;

    p.dependencies.forEach(function (depId) {
      var fromRow = projRows[depId];
      if (!fromRow) return;
      var fromProj = _depProjMap[depId];
      if (!fromProj) return;

      // 선행 프로젝트 끝 → 후행 프로젝트 시작
      var fromBar = fromRow.querySelector('.tl-bar[data-type="proj"]');
      var toBar = toRow.querySelector('.tl-bar[data-type="proj"]');
      if (!fromBar || !toBar) return;

      // 좌표는 스크롤 콘텐츠 기준(getBoundingClientRect + scroll 오프셋) — offsetParent/라벨 폭 가정에 의존하지 않음
      var fr = fromBar.getBoundingClientRect(), tr = toBar.getBoundingClientRect();
      var fromX = fr.right - _scR.left + scrollEl.scrollLeft;
      var fromY = fr.top + fr.height / 2 - _scR.top + scrollEl.scrollTop;
      var toX = tr.left - _scR.left + scrollEl.scrollLeft;
      var toY = tr.top + tr.height / 2 - _scR.top + scrollEl.scrollTop;

      // 곡선 경로
      var midX = fromX + (toX - fromX) / 2;
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M ' + fromX + ' ' + fromY + ' C ' + midX + ' ' + fromY + ' ' + midX + ' ' + toY + ' ' + toX + ' ' + toY);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', SEM_COLOR.warn);
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-dasharray', '4,3');
      path.setAttribute('marker-end', 'url(#depArrow)');
      path.setAttribute('opacity', '0.7');
      svg.appendChild(path);
    });
  });

  scrollEl.appendChild(svg);
}

function startBarDrag(bar, mode, startEvt) {
  var type = bar.dataset.type; // 'proj' or 'ms'
  var id = bar.dataset.id;
  var scrollEl = document.getElementById('tlScroll');

  var origLeft = parseFloat(bar.style.left) || 0;
  var origWidth = bar.offsetWidth;
  var startX = startEvt.clientX + scrollEl.scrollLeft;

  // 툴팁
  var tooltip = document.createElement('div');
  tooltip.className = 'tl-drag-tooltip';
  document.body.appendChild(tooltip);

  // 원래 날짜 계산
  var origStartDate = positionToDate(origLeft);
  var origEndDate = positionToDate(origLeft + origWidth - 1);

  var newLeft = origLeft;
  var newWidth = origWidth;

  function onMove(e) {
    var dx = (e.clientX + scrollEl.scrollLeft) - startX;

    if (mode === 'left') {
      newLeft = Math.max(0, origLeft + dx);
      newWidth = origWidth - (newLeft - origLeft);
      if (newWidth < 10) { newWidth = 10; newLeft = origLeft + origWidth - 10; }
      bar.style.left = newLeft + 'px';
      bar.style.width = newWidth + 'px';
    } else if (mode === 'right') {
      newWidth = Math.max(10, origWidth + dx);
      bar.style.width = newWidth + 'px';
      newLeft = origLeft;
    } else { // move
      newLeft = Math.max(0, origLeft + dx);
      bar.style.left = newLeft + 'px';
      newWidth = origWidth;
    }

    // 툴팁 표시
    var s = positionToDate(newLeft);
    var eDate = positionToDate(newLeft + newWidth - 1);
    tooltip.textContent = (s || '?') + ' ~ ' + (eDate || '?');
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY - 28) + 'px';
  }

  function onUp(e) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    tooltip.remove();

    var newStart = positionToDate(newLeft);
    var newEnd = positionToDate(newLeft + newWidth - 1);
    if (!newStart || !newEnd || (newStart === origStartDate && newEnd === origEndDate)) return;

    // DB 업데이트 후 리렌더
    if (type === 'proj') {
      updateProject(id, { startDate: newStart, endDate: newEnd }).then(function () {
        renderTimeline();
        if (typeof renderCalendar === 'function') renderCalendar();
        showToast('기간이 변경되었습니다');
      }).catch(function (err) {
          console.error('[startBarDrag:proj]', err);
          if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
      });
    } else if (type === 'ms') {
      // 마일스톤: get → update → put (서버 모드 — 과거 IndexedDB db.transaction 잔존 코드 제거)
      msGetAll().then(function (list) {
        var ms = null;
        for (var i = 0; i < (list || []).length; i++) { if (list[i].id === id) { ms = list[i]; break; } }
        if (!ms) return;
        ms.startDate = newStart;
        ms.endDate = newEnd;
        return msPut(ms);
      }).then(function () {
        renderTimeline();
        if (typeof renderCalendar === 'function') renderCalendar();
        showToast('기간이 변경되었습니다');
      }).catch(function (err) {
          console.error('[startBarDrag:ms]', err);
          if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
      });
    }
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ═══ Feature 8: 크리티컬 패스 계산 ═══ */
/* YYYY-MM-DD ± n일 (UTC 기준 — 이 함수 안의 다른 날짜 계산과 같은 기준) */
function _cpAddDays(ymd, n) {
  var d = new Date(ymd + 'T00:00:00Z');
  if (isNaN(d.getTime())) return ymd;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function calcCriticalPath(projects) {
  // 프로젝트 맵
  var projMap = {};
  projects.forEach(function (p) { projMap[p.id] = p; });

  // 의존관계가 있는지 확인
  var hasDeps = false;
  projects.forEach(function (p) {
    if (p.dependencies && p.dependencies.length) hasDeps = true;
  });

  var criticalIds = {};

  if (hasDeps) {
    // 위상 정렬 기반 최장경로 알고리즘
    // ES(Earliest Start) = max(predecessor EF)
    // EF(Earliest Finish) = ES + duration
    var es = {}, ef = {};

    // 초기화
    projects.forEach(function (p) {
      es[p.id] = p.startDate || '';
      var dur = (p.startDate && p.endDate) ? daysDiff(p.startDate, p.endDate) : 0;
      // EF = 날짜 문자열로 계산
      if (p.startDate) {
        if (!isNaN(new Date(p.startDate).getTime())) {
          ef[p.id] = _cpAddDays(p.startDate, dur);
        } else { ef[p.id] = p.endDate || ''; }
      } else {
        ef[p.id] = p.endDate || '';
      }
    });

    // 위상 정렬
    var inDeg = {};
    projects.forEach(function (p) { inDeg[p.id] = (p.dependencies || []).length; });
    var queue = [];
    projects.forEach(function (p) { if (inDeg[p.id] === 0) queue.push(p.id); });
    var sorted = [];
    while (queue.length) {
      var cur = queue.shift();
      sorted.push(cur);
      // 이 프로젝트가 선행인 프로젝트들 찾기
      projects.forEach(function (p) {
        if ((p.dependencies || []).indexOf(cur) >= 0) {
          inDeg[p.id]--;
          if (inDeg[p.id] === 0) queue.push(p.id);
        }
      });
    }

    // 최장 경로 계산: ES 업데이트
    sorted.forEach(function (pid) {
      var p = projMap[pid];
      if (!p) return;
      var dur = (p.startDate && p.endDate) ? daysDiff(p.startDate, p.endDate) : 0;
      // 선행 프로젝트들의 EF 중 최대값 "다음 날"이 이 프로젝트의 ES
      // (날짜는 포함 구간 — 종료일까지 일하므로 후행은 그 다음 날 시작. 예전엔 같은 날로 봐서
      //  선행마다 하루 여유가 생겨, 단순 체인에서 마지막 프로젝트만 크리티컬로 잡혔다)
      var latestPreEF = '';
      (p.dependencies || []).forEach(function (depId) {
        if (ef[depId] && (!latestPreEF || ef[depId] > latestPreEF)) {
          latestPreEF = ef[depId];
        }
      });
      if (latestPreEF) latestPreEF = _cpAddDays(latestPreEF, 1);
      if (latestPreEF && (!es[pid] || latestPreEF > es[pid])) {
        es[pid] = latestPreEF;
      }
      // EF 재계산
      if (es[pid] && !isNaN(new Date(es[pid]).getTime())) ef[pid] = _cpAddDays(es[pid], dur);
    });

    // 최대 EF 찾기 (프로젝트 종단)
    var maxEF = '';
    projects.forEach(function (p) {
      if (ef[p.id] && (!maxEF || ef[p.id] > maxEF)) maxEF = ef[p.id];
    });

    // 역추적: 최대 EF에서 역방향으로 크리티컬 패스 탐색
    // LS(Latest Start) = LF - duration
    // LF(Latest Finish): 종단이면 maxEF, 아니면 후행자의 LS 중 최소
    var lf = {}, ls = {};
    projects.forEach(function (p) { lf[p.id] = maxEF; });

    // 역위상 순서로 LF 계산
    var reverseSorted = sorted.slice().reverse();
    reverseSorted.forEach(function (pid) {
      var p = projMap[pid];
      if (!p) return;
      var dur = (p.startDate && p.endDate) ? daysDiff(p.startDate, p.endDate) : 0;
      // 이 프로젝트를 선행으로 가지는 프로젝트들의 LS 중 최소값 "전날"이 LF (위 ES 와 대칭)
      var minSuccLS = '';
      projects.forEach(function (succ) {
        if ((succ.dependencies || []).indexOf(pid) >= 0 && ls[succ.id]) {
          if (!minSuccLS || ls[succ.id] < minSuccLS) minSuccLS = ls[succ.id];
        }
      });
      if (minSuccLS) lf[pid] = _cpAddDays(minSuccLS, -1);
      // LS = LF - duration
      if (lf[pid] && !isNaN(new Date(lf[pid]).getTime())) ls[pid] = _cpAddDays(lf[pid], -dur);
    });

    // 크리티컬: ES == LS (여유시간 0)
    projects.forEach(function (p) {
      if (es[p.id] && ls[p.id] && es[p.id] === ls[p.id]) {
        criticalIds[p.id] = true;
      }
    });

    // 크리티컬 패스 없으면 폴백
    if (!Object.keys(criticalIds).length) {
      criticalIds = calcCriticalPathByDuration(projects);
    }
  } else {
    // 의존관계 없음: 기간이 긴 상위 프로젝트들 하이라이트
    criticalIds = calcCriticalPathByDuration(projects);
  }

  return criticalIds;
}

function calcCriticalPathByDuration(projects) {
  var result = {};
  var durations = [];
  projects.forEach(function (p) {
    if (p.startDate && p.endDate) {
      var dur = daysDiff(p.startDate, p.endDate);
      durations.push({ id: p.id, dur: dur });
    }
  });
  if (!durations.length) return result;
  durations.sort(function (a, b) { return b.dur - a.dur; });
  // 상위 30% 또는 최소 1개
  var topN = Math.max(1, Math.ceil(durations.length * 0.3));
  for (var i = 0; i < topN; i++) {
    result[durations[i].id] = true;
  }
  return result;
}

/* ═══ Integration 6: 현재 담당자를 그룹으로 저장 ═══ */
function saveAssigneesAsGroup() {
  var inp = document.getElementById('projAssignees');
  if (!inp || !inp.value.trim()) { showToast('담당자를 먼저 입력하세요.','warn'); return; }
  var members = inp.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!members.length) { showToast('담당자를 먼저 입력하세요.','warn'); return; }
  var name = prompt('새 그룹 이름을 입력하세요:', '');
  if (!name || !name.trim()) return;
  if (typeof createGroup === 'function') {
    createGroup(name.trim(), members);
    showToast('"' + name.trim() + '" 그룹 저장 (' + members.length + '명)');
  } else {
    showToast('설정 모듈(settings.js)이 로드되지 않았습니다.','error');
  }
}

/* ═══ Integration 8: 마일스톤 제안 실행 ═══ */
function runSuggestMilestones(orderNo) {
  if (typeof suggestMilestones !== 'function') { showToast('project-data.js가 로드되지 않았습니다.','error'); return; }

  suggestMilestones(orderNo).then(function (suggestions) {
    if (!suggestions.length) {
      showToast('해당 수주번호의 아카이브 데이터가 없습니다', 'warn');
      return;
    }
    var container = document.getElementById('msRows');
    if (!container) return;
    container.innerHTML = '';

    suggestions.forEach(function (s) {
      var row = document.createElement('div');
      row.className = 'proj-ms-row';
      row.style.cssText = 'display:grid;grid-template-columns:1fr 110px 110px 90px 30px;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--bd)';
      var statusOpts = Object.keys(PROJ_STATUS).map(function (k) {
        return '<option value="' + k + '"' + (s.status === k ? ' selected' : '') + '>' + PROJ_STATUS[k].label + '</option>';
      }).join('');
      row.innerHTML =
        '<input type="text" class="si ms-name" value="' + eH(s.name) + '" style="padding:4px 8px;font-size:11px;padding-left:8px">' +
        '<input type="date" class="si ms-start" value="' + s.startDate + '" style="padding:4px 6px;font-size:10px;padding-left:6px">' +
        '<input type="date" class="si ms-end" value="' + s.endDate + '" style="padding:4px 6px;font-size:10px;padding-left:6px">' +
        '<select class="si ms-status" style="padding:4px 6px;font-size:10px;padding-left:6px">' + statusOpts + '</select>' +
        '<button class="btn btn-d btn-s" onclick="this.closest(\'.proj-ms-row\').remove()" style="padding:2px 6px">✕</button>';
      container.appendChild(row);
    });

    showToast(suggestions.length + '개 마일스톤 제안 완료');
  }).catch(function (err) {
      console.error('[runSuggestMilestones]', err);
      if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

/* ═══ 메모 이미지 삽입/선택/삭제 핸들러 (v13.35~, v13.37 다중 순서 + 삭제) ═══ */
var MEMO_IMG_MAX_BYTES = 5 * 1024 * 1024; // 5MB per image (base64 임베드)
var _memoSelectedImg = null; // 현재 선택된 이미지 element 참조

function _memoInsertHtmlAtCursor(html) {
  var el = document.getElementById('projMemo');
  if (!el) return;
  el.focus();
  var sel = window.getSelection && window.getSelection();
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var frag = document.createDocumentFragment();
    var lastNode;
    while (tmp.firstChild) { lastNode = frag.appendChild(tmp.firstChild); }
    range.insertNode(frag);
    if (lastNode) {
      range = range.cloneRange();
      range.setStartAfter(lastNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } else {
    el.insertAdjacentHTML('beforeend', html);
  }
}

/* FileReader → 단일 이미지 삽입 (Promise 기반 — 다중 삽입 시 순서 보장용)
   v13.149: 원본 그대로 넣지 않고 다운스케일(압축) + 메모에선 작게 auto-size 표시.
   - 저장 용량/크롬 OOM 크래시 방지(원본 대용량 임베드 제거)
   - 표시는 max 240×200 auto-size 썸네일(클릭하면 라이트박스 확대) */
var MEMO_IMG_DISPLAY = 'max-width:240px;max-height:200px;width:auto;height:auto;border-radius:6px;display:block;margin:6px 0;cursor:zoom-in;border:1px solid var(--bd)';
function _memoInsertImageFromFile(file) {
  return new Promise(function (resolve) {
    if (!file || !/^image\//.test(file.type)) {
      if (typeof showToast === 'function') showToast('이미지 파일이 아닙니다', 'warn');
      resolve(false); return;
    }
    var alt = (file.name || 'image').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    function insert(dataUrl) {
      _memoInsertHtmlAtCursor('<img src="' + dataUrl + '" alt="' + alt + '" style="' + MEMO_IMG_DISPLAY + '">');
      resolve(true);
    }
    // 압축 우선 — project-images.js 의 다운스케일(최대 1280px JPEG) 재사용
    if (typeof pimgDownscale === 'function') {
      pimgDownscale(file, 1280, 0.8).then(insert).catch(function () { _memoRawInsert(file, insert, resolve); });
    } else {
      _memoRawInsert(file, insert, resolve);
    }
  });
}
/* 압축 불가 시 원본 폴백(단, 과대 파일은 경고) */
function _memoRawInsert(file, insert, resolve) {
  if (file.size > MEMO_IMG_MAX_BYTES && typeof showToast === 'function') {
    showToast('이미지가 너무 큽니다 (' + Math.round(file.size / 1024 / 1024) + 'MB) — 5MB 이하 권장', 'warn');
  }
  var reader = new FileReader();
  reader.onload = function (e) { insert(e.target.result); };
  reader.onerror = function () { if (typeof showToast === 'function') showToast('이미지 읽기 실패', 'error'); resolve(false); };
  reader.readAsDataURL(file);
}

/* 다중 파일을 순서대로 삽입 — Promise chain */
function _memoInsertManyFiles(files) {
  var imgs = [];
  for (var i = 0; i < files.length; i++) {
    if (/^image\//.test(files[i].type)) imgs.push(files[i]);
  }
  if (!imgs.length) return Promise.resolve(0);
  var p = Promise.resolve();
  var ok = 0;
  imgs.forEach(function (f) {
    p = p.then(function () { return _memoInsertImageFromFile(f); }).then(function (r) { if (r) ok++; });
  });
  return p.then(function () {
    if (imgs.length > 1 && typeof showToast === 'function') showToast('🖼 ' + ok + '개 이미지 추가');
    return ok;
  });
}

/* 현재 메모(#projMemo)의 이미 삽입된 큰 이미지들을 압축·축소 (저장 눌러야 영속) — v13.150 */
function memoCompressImages() {
  var el = document.getElementById('projMemo');
  if (!el) return;
  if (typeof pimgCompressMemoHtml !== 'function') { if (typeof showToast === 'function') showToast('압축 기능을 사용할 수 없습니다(새로고침 후 재시도).', 'error'); return; }
  var html = el.innerHTML || '';
  if (html.indexOf('<img') < 0 || html.indexOf('data:image') < 0) { if (typeof showToast === 'function') showToast('압축할 임베드 이미지가 없습니다.'); return; }
  if (typeof showToast === 'function') showToast('🗜 이미지 압축 중...');
  pimgCompressMemoHtml(html).then(function (r) {
    if (r.changed || r.after < r.before) {
      el.innerHTML = r.html;
      if (typeof showToast === 'function') showToast('압축 완료 — ' + Math.round(r.before / 1024) + 'KB → ' + Math.round(r.after / 1024) + 'KB. [수정/등록]을 눌러 저장하세요.', 'success');
    } else if (typeof showToast === 'function') showToast('이미 충분히 작거나 더 줄일 수 없습니다.');
  });
}

/* 모든 프로젝트의 메모 이미지를 일괄 압축·축소 후 저장 (편집 권한 있는 것만) — v13.150 */
function tlCompressAllMemoImages() {
  if (typeof projGetAll !== 'function' || typeof pimgCompressMemoHtml !== 'function' || typeof updateProject !== 'function') {
    if (typeof showToast === 'function') showToast('압축 기능을 사용할 수 없습니다.', 'error'); return;
  }
  if (!confirm('모든 프로젝트의 메모에 들어간 큰 이미지를 압축·축소하고 저장합니다.\n(편집 권한이 있는 프로젝트만 반영, 시간이 걸릴 수 있음)\n\n진행할까요?')) return;
  projGetAll().then(function (list) {
    var targets = (list || []).filter(function (p) { return p.memo && typeof p.memo === 'string' && p.memo.indexOf('data:image') >= 0; });
    if (!targets.length) { if (typeof showToast === 'function') showToast('압축할 메모 이미지가 있는 프로젝트가 없습니다.'); return; }
    if (typeof showToast === 'function') showToast('🗜 ' + targets.length + '개 프로젝트 압축 시작...');
    var done = 0, saved = 0, savedBytes = 0, fail = 0;
    var chain = Promise.resolve();
    targets.forEach(function (p) {
      chain = chain.then(function () {
        return pimgCompressMemoHtml(p.memo).then(function (r) {
          done++;
          if (typeof showToast === 'function' && (done % 3 === 0 || done === targets.length)) showToast('압축 중... ' + done + '/' + targets.length);
          if (!r.changed && r.after >= r.before) return;
          return updateProject(p.id, { memo: r.html })
            .then(function () { saved++; savedBytes += Math.max(0, r.before - r.after); })
            .catch(function () { fail++; });
        }).catch(function () { fail++; });
      });
    });
    chain.then(function () {
      if (typeof showToast === 'function') showToast('완료 — ' + saved + '개 프로젝트 압축, 약 ' + Math.round(savedBytes / 1024) + 'KB 절감' + (fail ? (' / 권한·실패 ' + fail + '건') : ''), saved ? 'success' : 'info');
      if (typeof renderTimeline === 'function') renderTimeline();
    });
  }).catch(function () { if (typeof showToast === 'function') showToast('프로젝트 목록 로드 실패', 'error'); });
}

function memoInsertImagePicker() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = function (e) {
    _memoInsertManyFiles(e.target.files || []);
  };
  input.click();
}

function memoPasteHandler(e) {
  var items = (e.clipboardData && e.clipboardData.items) || [];
  var imgFiles = [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf('image/') === 0) {
      var f = items[i].getAsFile();
      if (f) imgFiles.push(f);
    }
  }
  if (imgFiles.length) {
    e.preventDefault();
    _memoInsertManyFiles(imgFiles);
    return;
  }
  // 텍스트 붙여넣기는 평문으로 정규화 — HTML/스타일 오염 방지
  var text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (text !== undefined && text !== null && text !== '') {
    e.preventDefault();
    document.execCommand('insertText', false, text);
  }
}

function memoDropHandler(e) {
  e.preventDefault();
  var el = document.getElementById('projMemo');
  if (el) el.style.borderColor = '';
  var files = (e.dataTransfer && e.dataTransfer.files) || [];
  _memoInsertManyFiles(files);
}

/* 이미지 클릭 → 선택 상태로 표시 + 삭제 버튼 활성화 */
function memoEditorClickHandler(e) {
  var prev = _memoSelectedImg;
  if (prev && prev !== e.target) {
    prev.style.outline = '';
    _memoSelectedImg = null;
  }
  var t = e.target;
  if (t && t.tagName === 'IMG' && t.closest && t.closest('#projMemo')) {
    e.stopPropagation();
    _memoSelectedImg = t;
    t.style.outline = '3px solid var(--ac, #5B8DEF)';
    t.style.outlineOffset = '2px';
    var btn = document.getElementById('memoDelImgBtn');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
  } else {
    var btn2 = document.getElementById('memoDelImgBtn');
    if (btn2) { btn2.disabled = true; btn2.style.opacity = '.45'; btn2.style.cursor = 'not-allowed'; }
  }
}

/* Delete/Backspace로 선택된 이미지 삭제 */
function memoEditorKeyHandler(e) {
  if (!_memoSelectedImg) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    memoDeleteSelectedImage();
  } else if (e.key === 'Escape') {
    // 선택 해제만
    if (_memoSelectedImg) _memoSelectedImg.style.outline = '';
    _memoSelectedImg = null;
    var btn = document.getElementById('memoDelImgBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '.45'; btn.style.cursor = 'not-allowed'; }
  }
}

function memoDeleteSelectedImage() {
  if (!_memoSelectedImg) return;
  var img = _memoSelectedImg;
  if (img.parentNode) img.parentNode.removeChild(img);
  _memoSelectedImg = null;
  var btn = document.getElementById('memoDelImgBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '.45'; btn.style.cursor = 'not-allowed'; }
  if (typeof showToast === 'function') showToast('이미지 삭제됨');
}

