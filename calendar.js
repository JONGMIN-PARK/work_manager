/**
 * 업무 관리자 — 달력 뷰 모듈
 * 월간/주간 달력, 일정 등록/편집, 필터링, 드래그 이동
 *
 * v13.189 개편 — "그날 챙겨야 할 것"이 보이는 달력
 *  · 월간: 주(행) 단위 그리드. 여러 날 일정은 가로 막대(레인), 하루짜리(마일스톤·납기·이슈 기한·일정)는
 *    우선순위 칩(지연 → 납기 → 마일스톤 → 이슈 → 일정 → 착수, 완료는 뒤·흐리게). 앞뒤 달 날짜도 표시
 *  · 프로젝트 기간 막대는 기본 끔(매일 칸을 채워 정작 마감이 가려짐) — [기간 막대]로 켬
 *  · 오른쪽 패널: 기간 요약 타일(클릭 = 해당 종류만 강조) / 선택일 일정 / 처리 필요(지연·7일 내) / 담당자별 부하
 *  · 날짜 클릭 = 선택(패널에 그날 목록), 더블클릭 = 새 일정. 마일스톤은 패널에서 바로 [완료] 처리
 *  · 날짜 계산은 로컬 기준(dateToStr) — toISOString(UTC) 로 KST 오전에 하루 밀리던 문제 수정
 */

var calYear, calMonth, calViewMode = 'month';
var calWeekStart = null; // 주간 뷰 시작일 (일요일, 로컬 자정)
var calFilterAssignee = '', calFilterType = '';
var calFilterProjs = new Set();        // 다중 프로젝트 필터 (비어있으면 전체)
var _calProjPanelOpen = false;         // 프로젝트 선택 패널 열림 여부
var _calAllProjects = [];              // 최근 렌더된 전체 프로젝트(전체선택/해제용)
var calShowMs = true, calShowProj = true, calShowEvt = true;  // 항목 유형 표시 토글
var calShowSpans = false;              // 프로젝트 기간 막대 (기본 끔)
var calHideDone = false;               // 완료 항목 숨김
var calFocus = '';                     // 요약 타일 강조: '' | overdue | pend | ms | issue | evt
var calSelDate = '';                   // 선택한 날짜 (오른쪽 패널 일정 목록)
var calDragEvtId = null; // 드래그 중인 이벤트 ID
var _calRenderTimer;
var _calView = null;                   // 마지막 렌더 결과 (패널·액션용)
var CAL_DAY_MAX = 4;                   // 월간 칸당 칩 최대 개수
var CAL_SPAN_LANES = 3;                // 월간 주(행)당 기간 막대 최대 줄 수
var CAL_KIND = {
  pend:   { label: '납기',     icon: '🏁', ord: 1 },
  ms:     { label: '마일스톤', icon: '◆',  ord: 2 },
  issue:  { label: '이슈 기한', icon: '🎫', ord: 3 },
  evt:    { label: '일정',     icon: '🗓',  ord: 4 },
  pstart: { label: '착수',     icon: '▶',  ord: 5 },
  pspan:  { label: '기간',     icon: '▭',  ord: 6 }
};
function renderCalendarDebounced(){clearTimeout(_calRenderTimer);_calRenderTimer=setTimeout(renderCalendar,80)}

function _calAddDays(ymd, n) { return ymdAddDays(ymd, n); }
function _calDow(ymd) { return new Date(ymd + 'T00:00:00').getDay(); }
function _calMd(ymd) { return ymd ? (+ymd.slice(5, 7)) + '/' + (+ymd.slice(8, 10)) : ''; }
function _calPname(p) { return p ? (p.name || p.orderNo || '') : ''; }

/* ═══ 초기화 ═══ */
function initCalendar() {
  var today = new Date();
  calYear = today.getFullYear();
  calMonth = today.getMonth();
  renderCalendar();
}

/* 현재 보이는 범위 — 월간은 앞뒤 달을 포함한 6주 이내 그리드 전체 */
function _calViewRange() {
  if (calViewMode === 'month') {
    var first = dateToStr(new Date(calYear, calMonth, 1));
    var last = dateToStr(new Date(calYear, calMonth + 1, 0));
    return { start: _calAddDays(first, -_calDow(first)), end: _calAddDays(last, 6 - _calDow(last)), monthStart: first, monthEnd: last };
  }
  if (!calWeekStart) { var t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - t.getDay()); calWeekStart = t; }
  var ws = dateToStr(calWeekStart);
  return { start: ws, end: _calAddDays(ws, 6), monthStart: ws, monthEnd: _calAddDays(ws, 6) };
}

/* ═══ 메인 렌더 ═══ */
var _calRenderSeq = 0;   // 렌더 번호 — 월 이동 연타·저장 직후 재렌더가 겹칠 때 늦게 끝난 옛 렌더를 버린다
async function renderCalendar() {
  var wrap = document.getElementById('calendarWrap');
  if (!wrap) return;
  var seq = ++_calRenderSeq;

  // initCalendar()가 먼저 호출되지 않았을 때 방어 — calYear/calMonth 미설정 시 오늘 기준 초기화
  if (typeof calYear !== 'number' || isNaN(calYear) || typeof calMonth !== 'number' || isNaN(calMonth)) {
    var _t0 = new Date();
    calYear = _t0.getFullYear();
    calMonth = _t0.getMonth();
  }

  var _calData = await Promise.all([(typeof pmGetProjects === 'function' ? pmGetProjects() : projGetAll()), evtGetAll(), msGetAll(), typeof issueGetAll === 'function' ? issueGetAll() : Promise.resolve(null)]);
  if (seq !== _calRenderSeq) return;
  var projects = _calData[0] || [];
  var rawEvents = _calData[1] || [];
  var milestones = _calData[2] || [];
  var issues = (_calData[3] || []).filter(function (iss) { return iss.dueDate && iss.status !== 'resolved' && iss.status !== 'closed'; });

  var rg = _calViewRange();
  var events = expandRepeatingEvents(rawEvents, rg.start, rg.end);

  // 대시보드 렌더 (기다리지 않음 — 실패가 처리 안 된 rejection 으로 남지 않게 catch)
  var _dash = renderDashboard(projects);
  if (_dash && typeof _dash.catch === 'function') _dash.catch(function (e) { console.warn('[Calendar] dashboard', e); });

  // 필터 바
  renderCalFilter(wrap, projects);

  // 필터 적용 — 다중 프로젝트 (비어있으면 전체)
  if (calFilterProjs.size > 0) {
    projects = projects.filter(function (p) { return calFilterProjs.has(p.id); });
    events = events.filter(function (e) { return e.projectIds && e.projectIds.some(function (id) { return calFilterProjs.has(id); }); });
    milestones = milestones.filter(function (m) { return calFilterProjs.has(m.projectId); });
    issues = issues.filter(function (i) { return i.projectId && calFilterProjs.has(i.projectId); });
  }
  if (calFilterAssignee) {
    var a = calFilterAssignee;
    var projIn = {};
    projects.forEach(function (p) { if (p.assignees && p.assignees.includes(a)) projIn[p.id] = 1; });
    milestones = milestones.filter(function (m) { return (m.assignees && m.assignees.includes(a)) || projIn[m.projectId]; });
    projects = projects.filter(function (p) { return projIn[p.id]; });
    events = events.filter(function (e) { return e.assignees && e.assignees.includes(a); });
    issues = issues.filter(function (i) { return i.assignees && i.assignees.includes(a); });
  }
  if (calFilterType) {
    events = events.filter(function (e) { return e.type === calFilterType; });
  }

  var projMap = {};
  (_calData[0] || []).forEach(function (p) { projMap[p.id] = p; });
  var all = _calBuildItems(projects, events, milestones, issues, projMap);

  // Integration 9: 아카이브 요약 로드
  var archiveSummaries = [];
  if (typeof getWeeklyArchiveSummary === 'function') {
    try { archiveSummaries = await getWeeklyArchiveSummary(); } catch (e) { console.warn('[Calendar]', e); }
    if (seq !== _calRenderSeq) return;
  }

  // 보이는 범위와 겹치는 항목 (+ 표시 토글·완료 숨김)
  var visible = all.filter(function (it) {
    if (it.end < rg.start || it.date > rg.end) return false;
    if (it.kind === 'pspan') return calShowSpans && calShowProj;
    if ((it.kind === 'pend' || it.kind === 'pstart') && !calShowProj) return false;
    if (it.kind === 'ms' && !calShowMs) return false;
    if ((it.kind === 'evt' || it.kind === 'issue') && !calShowEvt) return false;
    if (calHideDone && it.done) return false;
    return true;
  });
  visible.sort(_calItemCmp);

  var today = localDate();
  if (!calSelDate || calSelDate < rg.start || calSelDate > rg.end) {
    calSelDate = (today >= rg.monthStart && today <= rg.monthEnd) ? today : rg.monthStart;
  }
  _calView = { range: rg, all: all, visible: visible, projMap: projMap, today: today, archive: archiveSummaries };

  if (calViewMode === 'month') renderMonthView(visible, rg, archiveSummaries);
  else renderWeekView(visible, rg, archiveSummaries);
  renderCalSide();
}

/* 달력에 올릴 항목 통합 — { kind, id, date, end, title, proj, color, done, overdue, assignees, ... } */
function _calBuildItems(projects, events, milestones, issues, projMap) {
  var today = localDate();
  var items = [];
  projects.forEach(function (p) {
    var st = autoProjectStatus(p);
    var base = { proj: p, projectId: p.id, color: p.color || SEM_COLOR.info, assignees: p.assignees || [], done: p.status === 'done' };
    if (p.endDate) items.push(Object.assign({ kind: 'pend', id: 'pe_' + p.id, date: p.endDate, end: p.endDate, title: _calPname(p), overdue: st === 'delayed' }, base));
    if (p.startDate) items.push(Object.assign({ kind: 'pstart', id: 'ps_' + p.id, date: p.startDate, end: p.startDate, title: _calPname(p), overdue: false }, base));
    if (p.startDate && p.endDate && p.endDate > p.startDate) items.push(Object.assign({ kind: 'pspan', id: 'pp_' + p.id, date: p.startDate, end: p.endDate, title: _calPname(p), overdue: st === 'delayed' }, base));
  });
  milestones.forEach(function (ms) {
    if (!ms.endDate) return;
    var p = projMap[ms.projectId];
    var done = ms.status === 'done';
    items.push({ kind: 'ms', id: 'ms_' + ms.id, ref: ms, date: ms.endDate, end: ms.endDate, title: ms.name || '(이름 없음)', proj: p, projectId: ms.projectId,
      color: (p && p.color) || SEM_COLOR.purple, done: done, overdue: !done && ms.endDate < today, assignees: ms.assignees || (p && p.assignees) || [] });
  });
  issues.forEach(function (iss) {
    var urg = iss.urgency === 'urgent' ? SEM_COLOR.danger : iss.urgency === 'normal' ? SEM_COLOR.warn : '#64748B';
    items.push({ kind: 'issue', id: 'is_' + iss.id, ref: iss, date: iss.dueDate, end: iss.dueDate, title: iss.title || '(제목 없음)', proj: projMap[iss.projectId], projectId: iss.projectId,
      color: urg, done: false, overdue: iss.dueDate < today, assignees: iss.assignees || [] });
  });
  events.forEach(function (ev) {
    if (!ev.startDate) return;
    var t = EVT_TYPE[ev.type] || EVT_TYPE.etc;
    var pid = ev.projectIds && ev.projectIds[0];
    items.push({ kind: 'evt', id: 'ev_' + (ev._origId || ev.id) + '_' + ev.startDate, ref: ev, evtId: ev._origId || ev.id, date: ev.startDate, end: ev.endDate || ev.startDate,
      title: ev.title || t.label, icon: t.icon, typeLabel: t.label, repeat: !!(ev.repeat || ev._repeatInstance), proj: projMap[pid], projectId: pid,
      color: ev.color || t.color, done: false, overdue: false, assignees: ev.assignees || [] });
  });
  return items;
}
function _calItemCmp(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  var ka = CAL_KIND[a.kind].ord, kb = CAL_KIND[b.kind].ord;
  if (ka !== kb) return ka - kb;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}
function _calIcon(it) { return it.kind === 'evt' ? it.icon : CAL_KIND[it.kind].icon; }

/* ═══ 필터 바 ═══ */
function renderCalFilter(wrap, allProjects) {
  var fb = document.getElementById('calFilterBar');
  if (!fb) return;
  _calAllProjects = allProjects || [];

  // 프로젝트 다중 선택 패널 (체크박스 드롭다운)
  var selCount = calFilterProjs.size;
  var projBtnLabel = selCount === 0 ? '📁 전체 프로젝트' : '📁 프로젝트 ' + selCount + '개';
  var projPanel = '';
  if (_calProjPanelOpen) {
    var items = allProjects.map(function (p) {
      var ck = calFilterProjs.has(p.id) ? ' checked' : '';
      return '<label style="display:flex;align-items:center;gap:6px;padding:4px 6px;font-size:11px;cursor:pointer;white-space:nowrap;border-radius:5px"' +
        ' onmouseover="this.style.background=\'var(--bg-hv)\'" onmouseout="this.style.background=\'\'">' +
        '<input type="checkbox"' + ck + ' onchange="calToggleProj(\'' + p.id + '\',this.checked)" style="cursor:pointer">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + p.color + ';flex-shrink:0"></span>' +
        '<span style="overflow:hidden;text-overflow:ellipsis;max-width:260px">' + eH(p.name || p.orderNo) + '</span></label>';
    }).join('') || '<div style="padding:8px;font-size:11px;color:var(--t6)">프로젝트가 없습니다</div>';
    projPanel = '<div style="position:absolute;top:100%;left:0;margin-top:4px;background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:6px;max-height:340px;overflow:auto;z-index:60;box-shadow:0 6px 20px rgba(0,0,0,.35);min-width:220px">' +
      '<div style="display:flex;gap:4px;padding:0 2px 6px;border-bottom:1px solid var(--bd);margin-bottom:4px">' +
        '<button class="btn btn-g btn-s" style="font-size:10px;flex:1" onclick="calSelectAllProj(true)">전체 선택</button>' +
        '<button class="btn btn-g btn-s" style="font-size:10px;flex:1" onclick="calSelectAllProj(false)">전체 해제</button>' +
        '<button class="btn btn-p btn-s" style="font-size:10px" onclick="_calProjPanelOpen=false;renderCalendarDebounced()">닫기</button>' +
      '</div>' + items + '</div>';
  }

  // 담당자 옵션
  var assigneeSet = {};
  allProjects.forEach(function (p) { (p.assignees || []).forEach(function (a) { assigneeSet[a] = 1; }); });
  if (calFilterAssignee) assigneeSet[calFilterAssignee] = 1;
  var assOpts = '<option value="">전체 담당자</option>';
  Object.keys(assigneeSet).sort().forEach(function (a) {
    var sel = calFilterAssignee === a ? ' selected' : '';
    assOpts += '<option value="' + eH(a) + '"' + sel + '>' + eH(typeof shortName === 'function' ? shortName(a) : a) + '</option>';
  });

  // 유형 옵션
  var typeOpts = '<option value="">전체 유형</option>';
  Object.keys(EVT_TYPE).forEach(function (k) {
    var sel = calFilterType === k ? ' selected' : '';
    typeOpts += '<option value="' + k + '"' + sel + '>' + EVT_TYPE[k].icon + ' ' + EVT_TYPE[k].label + '</option>';
  });

  // 항목 유형 표시 토글 칩
  var chip = function (on, label, kind, title) {
    return '<label title="' + (title || '') + '" style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer;padding:3px 8px;border-radius:12px;border:1px solid ' + (on ? 'var(--ac)' : 'var(--bd-i)') + ';background:' + (on ? 'var(--ac-g)' : 'var(--bg-i)') + ';color:' + (on ? 'var(--ac-t)' : 'var(--t5)') + '">' +
      '<input type="checkbox"' + (on ? ' checked' : '') + ' onchange="calToggleItem(\'' + kind + '\',this.checked)" style="cursor:pointer;width:12px;height:12px;margin:0">' + label + '</label>';
  };

  fb.innerHTML =
    '<div style="position:relative">' +
      '<button class="btn ' + (selCount ? 'btn-p' : 'btn-g') + ' btn-s" style="font-size:11px" onclick="_calProjPanelOpen=!_calProjPanelOpen;renderCalendarDebounced()">' + projBtnLabel + ' ▾</button>' +
      projPanel +
    '</div>' +
    (selCount ? '<button class="btn btn-g btn-s" style="font-size:10px" onclick="calFilterProjs.clear();renderCalendarDebounced()" title="프로젝트 필터 해제">✕</button>' : '') +
    '<select class="si" style="padding-left:8px;max-width:140px;font-size:11px" onchange="calFilterAssignee=this.value;renderCalendarDebounced()">' + assOpts + '</select>' +
    '<select class="si" style="padding-left:8px;max-width:140px;font-size:11px" onchange="calFilterType=this.value;renderCalendarDebounced()">' + typeOpts + '</select>' +
    '<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap" title="달력에 표시할 항목 유형">' +
      chip(calShowProj, '🏁 납기·착수', 'proj', '프로젝트 납기일·착수일') +
      chip(calShowMs, '◆ 마일스톤', 'ms') +
      chip(calShowEvt, '🗓 일정·이슈', 'evt', '등록 일정 + 미해결 이슈 대응기한') +
      chip(calShowSpans, '▭ 기간 막대', 'span', '프로젝트 진행 기간을 가로 막대로 (많으면 복잡해짐)') +
      chip(calHideDone, '완료 숨김', 'done') +
    '</div>' +
    '<div style="display:flex;gap:3px">' +
      '<button class="btn btn-s ' + (calViewMode === 'month' ? 'btn-p' : 'btn-g') + '" onclick="calViewMode=\'month\';renderCalendar()">월간</button>' +
      '<button class="btn btn-s ' + (calViewMode === 'week' ? 'btn-p' : 'btn-g') + '" onclick="calViewMode=\'week\';renderCalendar()">주간</button>' +
    '</div>' +
    '<button class="btn btn-g btn-s" onclick="showGcalImportModal()" title="Google Calendar / ICS 가져오기">📅 가져오기</button>';
}

/* 프로젝트 다중 선택/항목 토글 핸들러 */
function calToggleProj(id, on) {
  if (on) calFilterProjs.add(id); else calFilterProjs.delete(id);
  renderCalendarDebounced();
}
function calSelectAllProj(on) {
  if (on) _calAllProjects.forEach(function (p) { calFilterProjs.add(p.id); });
  else calFilterProjs.clear();
  renderCalendarDebounced();
}
function calToggleItem(kind, on) {
  if (kind === 'ms') calShowMs = on;
  else if (kind === 'proj') calShowProj = on;
  else if (kind === 'evt') calShowEvt = on;
  else if (kind === 'span') calShowSpans = on;
  else if (kind === 'done') calHideDone = on;
  renderCalendarDebounced();
}

/* 칩 하나 — 월간/주간/패널 공용 */
function _calChipHtml(it, opt) {
  opt = opt || {};
  var cls = 'calm-chip k-' + it.kind + (it.overdue ? ' is-overdue' : '') + (it.done ? ' is-done' : '');
  var drag = it.kind === 'evt' ? ' draggable="true" data-evt-id="' + eH(it.evtId) + '"' : '';
  var sub = it.proj && it.kind !== 'pend' && it.kind !== 'pstart' && it.kind !== 'pspan' ? ' [' + _calPname(it.proj) + ']' : '';
  var tip = CAL_KIND[it.kind].label + (it.kind === 'evt' ? '·' + it.typeLabel : '') + ' — ' + it.title + sub
    + (it.end !== it.date ? ' (' + _calMd(it.date) + '~' + _calMd(it.end) + ')' : '')
    + (it.overdue ? ' · 지연' : '') + (it.done ? ' · 완료' : '');
  var style = it.kind === 'evt' || it.kind === 'issue'
    ? 'color:' + it.color + ';background:' + it.color + '1f;border-left-color:' + it.color
    : 'border-left-color:' + it.color;
  return '<div class="' + cls + '"' + drag + ' data-cal-item="' + eH(it.id) + '" style="' + style + '" title="' + eH(tip) + '">'
    + '<span class="calm-ic">' + _calIcon(it) + '</span>'
    + (it.repeat ? '<span class="calm-ic">🔁</span>' : '')
    + '<span class="calm-tx">' + eH(it.title) + (opt.withProj && sub ? '<span class="calm-sub">' + eH(sub) + '</span>' : '') + '</span></div>';
}

/* ═══ 월간 뷰 ═══ */
function renderMonthView(items, rg, archiveSummaries) {
  var grid = document.getElementById('calGrid');
  if (!grid) return;
  grid.className = 'calm' + (calFocus ? ' cal-focus-' + calFocus : '');
  grid.style.position = '';
  var today = localDate();

  document.getElementById('calNav').innerHTML =
    '<button class="btn btn-g btn-s" onclick="calMonth--;if(calMonth<0){calMonth=11;calYear--}renderCalendar()">◀</button>' +
    '<span style="font-size:16px;font-weight:700;color:var(--t1);min-width:140px;text-align:center">' + calYear + '년 ' + (calMonth + 1) + '월</span>' +
    '<button class="btn btn-g btn-s" onclick="calMonth++;if(calMonth>11){calMonth=0;calYear++}renderCalendar()">▶</button>' +
    '<button class="btn btn-g btn-s" style="margin-left:8px" onclick="var t=new Date();calYear=t.getFullYear();calMonth=t.getMonth();calSelDate=\'\';renderCalendar()">오늘</button>';

  var dows = ['일', '월', '화', '수', '목', '금', '토'];
  var html = '<div class="calm-dows">' + dows.map(function (d, i) { return '<div class="calm-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + d + '</div>'; }).join('') + '</div>';

  var spans = items.filter(function (it) { return it.end > it.date; });
  var singles = items.filter(function (it) { return it.end === it.date; });
  // 날짜별로 한 번만 묶는다 — 칸마다(42일 × 2회) 전체를 거르지 않게. items 가 정렬돼 있어 순서는 유지된다
  var singlesByDate = {};
  singles.forEach(function (it) { (singlesByDate[it.date] = singlesByDate[it.date] || []).push(it); });

  for (var ws = rg.start; ws <= rg.end; ws = _calAddDays(ws, 7)) {
    var we = _calAddDays(ws, 6);
    var days = [];
    for (var i = 0; i < 7; i++) days.push(_calAddDays(ws, i));

    // 기간 막대: 이 주와 겹치는 것 → 레인 배정 (먼저 시작·긴 것 우선)
    var wk = spans.filter(function (it) { return it.date <= we && it.end >= ws; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (b.end > a.end ? 1 : -1); });
    var lanes = [], placed = [], hiddenSpans = 0;
    wk.forEach(function (it) {
      var s = it.date < ws ? 0 : _calDow(it.date), e = it.end > we ? 6 : _calDow(it.end);
      for (var l = 0; l < CAL_SPAN_LANES; l++) {
        lanes[l] = lanes[l] || [];
        if (!lanes[l].some(function (x) { return !(e < x[0] || s > x[1]); })) { lanes[l].push([s, e]); placed.push({ it: it, s: s, e: e, lane: l, cont: it.date < ws, more: it.end > we }); return; }
      }
      hiddenSpans++;
    });
    var nLanes = Math.max(0, lanes.filter(function (l) { return l && l.length; }).length);

    html += '<div class="calm-week" style="grid-template-rows:24px' + (nLanes ? ' repeat(' + nLanes + ',19px)' : '') + ' minmax(' + (CAL_DAY_MAX * 19 + 4) + 'px,auto)">';
    days.forEach(function (d, i) {
      var inMonth = d >= rg.monthStart && d <= rg.monthEnd;
      var dayItems = singlesByDate[d] || [];
      var od = dayItems.filter(function (it) { return it.overdue; }).length;
      var arch = '';
      (archiveSummaries || []).forEach(function (as) {
        if (d === as.startDate || (d >= as.startDate && d <= as.endDate && i === 1)) arch = '<span class="calm-arch" title="' + eH(as.label || '') + '">📊 ' + Math.round(as.totalHours) + 'h/' + as.memberCount + '명</span>';
      });
      html += '<div class="calm-day' + (inMonth ? '' : ' out') + (d === today ? ' today' : '') + (d === calSelDate ? ' sel' : '') + (i === 0 || i === 6 ? ' wkend' : '') + '" data-date="' + d + '" style="grid-column:' + (i + 1) + ';grid-row:1/-1">'
        + '<div class="calm-dhead"><span class="calm-dnum">' + (+d.slice(8)) + '</span>'
        + (od ? '<span class="calm-od" title="지연 ' + od + '건">⚠' + od + '</span>' : '')
        + arch
        + (dayItems.length ? '<span class="calm-cnt">' + dayItems.length + '</span>' : '')
        + '</div></div>';
    });
    placed.forEach(function (p) {
      var it = p.it;
      var cls = 'calm-span k-' + it.kind + (it.overdue ? ' is-overdue' : '') + (it.done ? ' is-done' : '') + (p.cont ? ' cont-l' : '') + (p.more ? ' cont-r' : '');
      var drag = it.kind === 'evt' ? ' draggable="true" data-evt-id="' + eH(it.evtId) + '"' : '';
      var bg = it.kind === 'pspan' ? it.color + '55' : it.color;
      html += '<div class="' + cls + '"' + drag + ' data-cal-item="' + eH(it.id) + '" style="grid-column:' + (p.s + 1) + '/' + (p.e + 2) + ';grid-row:' + (p.lane + 2) + ';background:' + bg + '" title="' + eH(_calIcon(it) + ' ' + it.title + ' (' + _calMd(it.date) + '~' + _calMd(it.end) + ')') + '">'
        + (p.cont ? '◂ ' : '') + _calIcon(it) + ' ' + eH(it.title) + '</div>';
    });
    days.forEach(function (d, i) {
      var dayItems = singlesByDate[d] || [];
      var show = dayItems.slice(0, CAL_DAY_MAX);
      var rest = dayItems.length - show.length;
      html += '<div class="calm-chips" data-date="' + d + '" style="grid-column:' + (i + 1) + ';grid-row:' + (nLanes + 2) + '">'
        + show.map(function (it) { return _calChipHtml(it); }).join('')
        + (rest > 0 ? '<div class="calm-more" data-cal-more="' + d + '">+' + rest + '건</div>' : '')
        + (i === 6 && hiddenSpans ? '<div class="calm-more" title="표시 줄 수를 넘은 기간 일정">기간 +' + hiddenSpans + '</div>' : '')
        + '</div>';
    });
    html += '</div>';
  }

  grid.innerHTML = html;
  _calBindGrid(grid);
  bindCalDrag(grid);
}

/* 그리드 이벤트 위임 — 날짜 클릭 = 선택, 더블클릭 = 새 일정, 항목 클릭 = 열기, 드롭 = 일정 이동 */
function _calBindGrid(grid) {
  if (grid._calBound) return;
  grid._calBound = true;
  grid.addEventListener('click', function (e) {
    var itEl = e.target.closest('[data-cal-item]');
    if (itEl) { e.stopPropagation(); calOpenItem(itEl.dataset.calItem); return; }
    var more = e.target.closest('[data-cal-more]');
    var dEl = more || e.target.closest('[data-date]');
    if (dEl) calSelectDay(more ? more.dataset.calMore : dEl.dataset.date);
  });
  grid.addEventListener('dblclick', function (e) {
    if (e.target.closest('[data-cal-item]')) return;
    var dEl = e.target.closest('[data-date]');
    if (dEl) showEventModal(null, dEl.dataset.date);
  });
  grid.addEventListener('dragover', function (e) {
    var dEl = e.target.closest('[data-date]');
    if (!dEl || !calDragEvtId) return;
    e.preventDefault();
    grid.querySelectorAll('.cal-drop-over').forEach(function (c) { if (c !== dEl) c.classList.remove('cal-drop-over'); });
    dEl.classList.add('cal-drop-over');
  });
  grid.addEventListener('drop', function (e) {
    var dEl = e.target.closest('[data-date]');
    if (!dEl) return;
    calDropEvt({ preventDefault: function () { e.preventDefault(); }, stopPropagation: function () { e.stopPropagation(); }, currentTarget: dEl, dataTransfer: e.dataTransfer }, dEl.dataset.date);
  });
}

function calSelectDay(d) {
  calSelDate = d;
  var grid = document.getElementById('calGrid');
  if (grid) grid.querySelectorAll('.calm-day.sel,.cal-week-cell.sel').forEach(function (c) { c.classList.remove('sel'); });
  if (grid) grid.querySelectorAll('.calm-day[data-date="' + d + '"],.cal-week-cell[data-date="' + d + '"]').forEach(function (c) { c.classList.add('sel'); });
  renderCalSide();
}

function _calFindItem(id) {
  if (!_calView) return null;
  for (var i = 0; i < _calView.all.length; i++) if (_calView.all[i].id === id) return _calView.all[i];
  return null;
}
/* 항목 열기 — 종류별 상세 */
function calOpenItem(id) {
  var it = _calFindItem(id);
  if (!it) return;
  if (it.kind === 'evt') return showEventModal(it.evtId);
  if (it.kind === 'issue') {
    if (typeof showIssueDetail === 'function') return showIssueDetail(it.ref.id);
    return setMode('issues');
  }
  if (it.projectId && typeof showProjectDetail === 'function') return showProjectDetail(it.projectId);
}
/* 마일스톤 완료 처리 (패널에서) */
async function calMsDone(id) {
  var it = _calFindItem(id);
  if (!it || it.kind !== 'ms') return;
  if (!confirm('마일스톤 "' + it.title + '" 을(를) 완료 처리할까요?')) return;
  try {
    var ms = Object.assign({}, it.ref, { status: 'done' });
    await msPut(ms);
    if (typeof showToast === 'function') showToast('✅ 완료 처리: ' + it.title);
    await renderCalendar();
  } catch (err) {
    console.error('[calMsDone]', err);
    if (typeof showToast === 'function') showToast('❌ 완료 처리 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  }
}
function calSetFocus(k) {
  calFocus = calFocus === k ? '' : k;
  var grid = document.getElementById('calGrid');
  if (grid) {
    grid.className = grid.className.replace(/\s*cal-focus-\w+/g, '') + (calFocus ? ' cal-focus-' + calFocus : '');
  }
  renderCalSide();
}
function calSetAssignee(a) {
  calFilterAssignee = calFilterAssignee === a ? '' : a;
  renderCalendarDebounced();
}

/* ═══ 오른쪽 패널 — 요약 / 선택일 / 처리 필요 / 담당자별 ═══ */
function renderCalSide() {
  var side = document.getElementById('calSide');
  if (!side || !_calView) return;
  var v = _calView, rg = v.range, today = v.today;
  var inPeriod = v.visible.filter(function (it) { return it.kind !== 'pspan' && it.date >= rg.monthStart && it.date <= rg.monthEnd; });
  function cnt(f) { return inPeriod.filter(f).length; }
  var msAll = cnt(function (it) { return it.kind === 'ms'; }), msDone = cnt(function (it) { return it.kind === 'ms' && it.done; });
  var tiles = [
    { k: 'overdue', label: '지연', val: cnt(function (it) { return it.overdue; }), color: SEM_COLOR.danger },
    { k: 'pend', label: '납기', val: cnt(function (it) { return it.kind === 'pend'; }), color: '#F97316' },
    { k: 'ms', label: '마일스톤', val: msDone + '/' + msAll, color: SEM_COLOR.purple, sub: '완료/전체' },
    { k: 'issue', label: '이슈 기한', val: cnt(function (it) { return it.kind === 'issue'; }), color: SEM_COLOR.warn },
    { k: 'evt', label: '일정', val: cnt(function (it) { return it.kind === 'evt'; }), color: '#06B6D4' }
  ];
  var periodLabel = calViewMode === 'month' ? (calMonth + 1) + '월' : '이번 주';
  var h = '<div class="cal-side-sec"><div class="cal-side-h">📊 ' + periodLabel + ' 요약 <span class="cal-side-hint">타일 클릭 = 달력에서 강조</span></div>'
    + '<div class="cal-tiles">' + tiles.map(function (t) {
        return '<button class="cal-tile' + (calFocus === t.k ? ' on' : '') + '" onclick="calSetFocus(\'' + t.k + '\')" style="--tc:' + t.color + '">'
          + '<span class="cal-tile-v">' + t.val + '</span><span class="cal-tile-l">' + t.label + '</span></button>';
      }).join('') + '</div></div>';

  // 선택일
  var sel = calSelDate;
  var onDay = v.visible.filter(function (it) { return it.date <= sel && it.end >= sel; });
  // 진행 중 프로젝트 기간 막대는 목록을 덮으므로 건수만
  var running = onDay.filter(function (it) { return it.kind === 'pspan'; }).length;
  var dayItems = onDay.filter(function (it) { return it.kind !== 'pspan'; });
  var dw = ['일', '월', '화', '수', '목', '금', '토'][_calDow(sel)];
  h += '<div class="cal-side-sec"><div class="cal-side-h">📅 ' + _calMd(sel) + ' (' + dw + ')' + (sel === today ? ' <span class="cal-side-today">오늘</span>' : '')
    + '<span style="flex:1"></span><button class="btn btn-p btn-s" style="font-size:10px" onclick="showEventModal(null,\'' + sel + '\')">＋ 일정</button></div>'
    + (dayItems.length ? dayItems.map(function (it) { return _calRowHtml(it, false); }).join('') : '<div class="cal-side-empty">이 날 항목이 없습니다</div>')
    + (running ? '<div class="cal-side-hint" style="margin-top:4px">▭ 진행 중 프로젝트 ' + running + '건</div>' : '')
    + '</div>';

  // 처리 필요 — 지연(기간 무관) + 7일 내 임박. 완료·일정·착수는 제외
  var soonEnd = _calAddDays(today, 7);
  var act = v.all.filter(function (it) {
    if (it.done || it.kind === 'pspan' || it.kind === 'pstart' || it.kind === 'evt') return false;
    return it.overdue || (it.date >= today && it.date <= soonEnd);
  }).sort(function (a, b) { return a.overdue !== b.overdue ? (a.overdue ? -1 : 1) : (a.date < b.date ? -1 : a.date > b.date ? 1 : 0); });
  var nOver = act.filter(function (it) { return it.overdue; }).length;
  h += '<div class="cal-side-sec"><div class="cal-side-h">⚠️ 처리 필요 <span class="cal-side-hint">지연 ' + nOver + ' · 7일 내 ' + (act.length - nOver) + '</span></div>'
    + (act.length ? '<div class="cal-side-list">' + act.slice(0, 40).map(function (it) { return _calRowHtml(it, true); }).join('') + (act.length > 40 ? '<div class="cal-side-empty">… 외 ' + (act.length - 40) + '건</div>' : '') + '</div>'
      : '<div class="cal-side-empty">지연되거나 임박한 항목이 없습니다 👍</div>')
    + '</div>';

  // 담당자별 부하 (기간 내 납기·마일스톤·이슈·일정 건수)
  var load = {};
  inPeriod.forEach(function (it) {
    if (it.done || it.kind === 'pstart') return;
    (it.assignees || []).forEach(function (a) {
      var o = load[a] = load[a] || { n: 0, od: 0 };
      o.n++; if (it.overdue) o.od++;
    });
  });
  var people = Object.keys(load).sort(function (a, b) { return load[b].n - load[a].n; });
  var mx = people.length ? load[people[0]].n : 1;
  h += '<div class="cal-side-sec"><div class="cal-side-h">👥 담당자별 ' + periodLabel + ' <span class="cal-side-hint">클릭 = 담당자 필터</span></div>'
    + (people.length ? people.slice(0, 15).map(function (a) {
        var o = load[a];
        return '<button class="cal-load' + (calFilterAssignee === a ? ' on' : '') + '" data-a="' + eH(a) + '" onclick="calSetAssignee(this.dataset.a)">'
          + '<span class="cal-load-n">' + eH(typeof shortName === 'function' ? shortName(a) : a) + '</span>'
          + '<span class="cal-load-bar"><i style="width:' + Math.round(o.n / mx * 100) + '%"></i></span>'
          + '<span class="cal-load-c">' + o.n + (o.od ? ' <b>⚠' + o.od + '</b>' : '') + '</span></button>';
      }).join('') : '<div class="cal-side-empty">담당자 지정 항목 없음</div>')
    + '</div>';

  side.innerHTML = h;
}

function _calRowHtml(it, withDate) {
  var dd = it.overdue && it.date < _calView.today ? daysDiff(it.date, _calView.today) : 0;
  var when = withDate ? '<span class="cal-row-d' + (it.overdue ? ' od' : '') + '">' + (dd ? 'D+' + dd : it.date === _calView.today ? '오늘' : _calMd(it.date)) + '</span>' : '';
  var sub = it.proj && it.kind !== 'pend' && it.kind !== 'pstart' && it.kind !== 'pspan' ? _calPname(it.proj) : (it.kind === 'pend' ? '납기' : it.kind === 'pstart' ? '착수' : it.kind === 'pspan' ? _calMd(it.date) + '~' + _calMd(it.end) : '');
  if (it.kind === 'evt') sub = it.typeLabel + (it.end !== it.date ? ' · ' + _calMd(it.date) + '~' + _calMd(it.end) : '') + (it.proj ? ' · ' + _calPname(it.proj) : '');
  var who = (it.assignees || []).slice(0, 3).map(function (a) { return typeof shortName === 'function' ? shortName(a) : a; }).join(', ');
  return '<div class="cal-row k-' + it.kind + (it.overdue ? ' is-overdue' : '') + (it.done ? ' is-done' : '') + '" style="--rc:' + it.color + '">'
    + when
    + '<span class="cal-row-ic">' + _calIcon(it) + '</span>'
    + '<span class="cal-row-main" data-id="' + eH(it.id) + '" onclick="calOpenItem(this.dataset.id)" title="열기"><span class="cal-row-t">' + eH(it.title) + '</span>'
    + '<span class="cal-row-s">' + eH(sub) + (who ? ' · 👤 ' + eH(who) : '') + '</span></span>'
    + (it.kind === 'ms' && !it.done ? '<button class="cal-row-btn" data-id="' + eH(it.id) + '" onclick="calMsDone(this.dataset.id)" title="완료 처리">✓ 완료</button>' : '')
    + '</div>';
}

/* ═══ 주간 뷰 ═══ */
function renderWeekView(items, rg, archiveSummaries) {
  var grid = document.getElementById('calGrid');
  if (!grid) return;
  grid.className = 'calw' + (calFocus ? ' cal-focus-' + calFocus : '');
  grid.style.position = '';
  var todayStr = localDate();
  var days = [];
  for (var i = 0; i < 7; i++) days.push(_calAddDays(rg.start, i));

  document.getElementById('calNav').innerHTML =
    '<button class="btn btn-g btn-s" onclick="calWeekStart.setDate(calWeekStart.getDate()-7);renderCalendar()">◀</button>' +
    '<span style="font-size:14px;font-weight:700;color:var(--t1);min-width:200px;text-align:center">' +
      rg.start.replace(/-/g, '. ') + ' ~ ' + _calMd(rg.end) +
    '</span>' +
    '<button class="btn btn-g btn-s" onclick="calWeekStart.setDate(calWeekStart.getDate()+7);renderCalendar()">▶</button>' +
    '<button class="btn btn-g btn-s" style="margin-left:8px" onclick="calWeekStart=null;calSelDate=\'\';renderCalendar()">이번주</button>';

  var dowNames = ['일', '월', '화', '수', '목', '금', '토'];
  var html = '';
  days.forEach(function (dateStr, idx) {
    var cls = 'cal-week-cell' + (dateStr === todayStr ? ' cal-today' : '') + (dateStr === calSelDate ? ' sel' : '');
    var dayItems = items.filter(function (it) { return it.date <= dateStr && it.end >= dateStr; });
    html += '<div class="' + cls + '" data-date="' + dateStr + '">' +
      '<div class="cal-week-hdr"><span class="cal-week-dow">' + dowNames[idx] + '</span><span class="cal-date">' + _calMd(dateStr) + '</span></div>' +
      '<div class="cal-week-items">' + dayItems.map(function (it) { return _calChipHtml(it, { withProj: true }); }).join('') + '</div>' +
    '</div>';
  });

  // Integration 9: 주간 뷰 상단 아카이브 요약 바
  var archWeekBar = '';
  (archiveSummaries || []).forEach(function (as) {
    if (as.startDate <= rg.end && as.endDate >= rg.start) {
      archWeekBar += '<div style="padding:4px 10px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:6px;font-size:11px;color:#3B82F6;display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
        '<span>&#128202;</span> <span style="font-weight:600">아카이브:</span> ' + Math.round(as.totalHours) + 'h / ' + as.memberCount + '명' +
        (as.label ? ' <span style="color:var(--t5);font-size:10px">(' + eH(as.label) + ')</span>' : '') +
      '</div>';
    }
  });

  grid.innerHTML = archWeekBar + '<div class="cal-week-scroll"><div class="cal-week-grid">' + html + '</div></div>';
  _calBindGrid(grid);
  bindCalDrag(grid);
}

/* ═══ 일정 등록/편집 모달 ═══ */
async function showEventModal(evtId, defaultDate) {
  var existing = document.getElementById('evtModal');
  if (existing) existing.remove();

  var evt = null;
  if (evtId) evt = await evtGet(evtId);

  var projects = await projGetAll();

  // v13.63: backdrop 클릭 닫기 비활성화 — 데이터 유실 방지 (✕ 버튼만 닫기)

  // 반복 인스턴스인 경우 원본 로드
  if (evt && evt._repeatInstance && evt._origId) {
    evt = await evtGet(evt._origId);
    if (!evt) return;
    evtId = evt.id;
  }

  var title = evt ? evt.title : '';
  var type = evt ? evt.type : 'etc';
  var start = evt ? evt.startDate : (defaultDate || localDate());
  var end = evt ? evt.endDate : start;
  var memo = evt ? evt.memo : '';
  var repeatVal = evt ? (evt.repeat || '') : '';
  var repeatUntil = evt ? (evt.repeatUntil || '') : '';
  var selProjs = evt ? (evt.projectIds || []) : [];
  var selAssignees = evt ? (evt.assignees || []) : [];

  // 프로젝트 체크박스
  var projChecks = projects.map(function (p) {
    var chk = selProjs.includes(p.id) ? ' checked' : '';
    return '<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--t3);cursor:pointer"><input type="checkbox" class="evt-proj-chk" value="' + p.id + '"' + chk + '><span class="dot" style="background:' + p.color + ';width:6px;height:6px;border-radius:50%;display:inline-block"></span>' + eH(p.name || p.orderNo) + '</label>';
  }).join('');

  // 유형 옵션
  var typeOpts = Object.keys(EVT_TYPE).map(function (k) {
    return '<option value="' + k + '"' + (type === k ? ' selected' : '') + '>' + EVT_TYPE[k].icon + ' ' + EVT_TYPE[k].label + '</option>';
  }).join('');

  // 담당자 입력
  var assVal = selAssignees.join(', ');

  var modal = createModal({ id: 'evtModal', width: '480px', boxStyle: 'padding:20px;width:90%;max-height:85vh;overflow:auto', html: '' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
      '<h3 style="font-size:14px;font-weight:700;color:var(--t1)">' + (evt ? '📝 일정 편집' : '➕ 일정 등록') + '</h3>' +
      '<button class="btn btn-g btn-s" onclick="document.getElementById(\'evtModal\').remove()">✕ 닫기</button>' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div><label class="fl">제목</label><input type="text" class="si" id="evtTitle" value="' + eH(title) + '" placeholder="일정 제목..." style="padding-left:10px"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label class="fl">유형</label><select class="si" id="evtType" style="padding-left:8px">' + typeOpts + '</select></div>' +
        '<div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label class="fl">시작일</label><input type="date" class="si" id="evtStart" value="' + start + '" style="padding-left:10px"></div>' +
        '<div><label class="fl">종료일</label><input type="date" class="si" id="evtEnd" value="' + end + '" style="padding-left:10px"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label class="fl">반복</label><select class="si" id="evtRepeat" style="padding-left:8px"><option value="">없음</option><option value="weekly"' + (repeatVal === 'weekly' ? ' selected' : '') + '>매주</option><option value="biweekly"' + (repeatVal === 'biweekly' ? ' selected' : '') + '>격주</option><option value="monthly"' + (repeatVal === 'monthly' ? ' selected' : '') + '>매월</option></select></div>' +
        '<div><label class="fl">반복 종료일</label><input type="date" class="si" id="evtRepeatUntil" value="' + repeatUntil + '" style="padding-left:10px"></div>' +
      '</div>' +
      '<div><label class="fl">담당자 <span style="font-size:9px;color:var(--t6)">(쉼표로 구분)</span></label><input type="text" class="si" id="evtAssignees" value="' + eH(assVal) + '" placeholder="홍길동, 김철수..." style="padding-left:10px"></div>' +
      (projChecks ? '<div><label class="fl">연관 프로젝트</label><div style="display:flex;flex-wrap:wrap;gap:8px;max-height:100px;overflow:auto;padding:6px;background:var(--bg-i);border-radius:6px">' + projChecks + '</div></div>' : '') +
      '<div><label class="fl">메모</label><textarea class="si" id="evtMemo" rows="2" style="padding-left:10px;resize:vertical" placeholder="상세 내용...">' + eH(memo) + '</textarea></div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">' +
      (evt ? '<button class="btn btn-d btn-s" onclick="deleteEventUI(\'' + evt.id + '\')">🗑 삭제</button>' : '') +
      '<button class="btn btn-p" onclick="saveEventUI(\'' + (evt ? evt.id : '') + '\')">' + (evt ? '💾 수정' : '➕ 등록') + '</button>' +
    '</div>' +
  '' }).overlay;
}

/* ═══ Integration 3: 이벤트-업무 충돌 감지 ═══ */
async function checkEventConflicts(assignees, startDate, endDate, excludeEvtId) {
  if (!assignees || !assignees.length || !startDate) return [];
  var eDate = endDate || startDate;
  var warnings = [];

  var _ccData = await Promise.all([projGetAll(), evtGetAll()]);
  var projects = _ccData[0];
  var events = _ccData[1];

  assignees.forEach(function (name) {
    if (!name) return;
    var overlaps = [];

    // 프로젝트 겹침
    projects.forEach(function (p) {
      var st = autoProjectStatus(p);
      if (st === 'done' || st === 'hold') return;
      if (!p.assignees || p.assignees.indexOf(name) < 0) return;
      if (!p.startDate || !p.endDate) return;
      if (p.startDate <= eDate && p.endDate >= startDate) {
        overlaps.push(p.name || p.orderNo);
      }
    });

    // 이벤트 겹침
    events.forEach(function (ev) {
      if (excludeEvtId && ev.id === excludeEvtId) return;
      if (!ev.assignees || ev.assignees.indexOf(name) < 0) return;
      var evEnd = ev.endDate || ev.startDate;
      if (ev.startDate <= eDate && evEnd >= startDate) {
        overlaps.push(ev.title);
      }
    });

    if (overlaps.length >= 3) {
      warnings.push({ name: name, count: overlaps.length, items: overlaps });
    }
  });

  return warnings;
}

async function saveEventUI(existingId) {
  var title = document.getElementById('evtTitle').value.trim();
  if (!title) { showToast('제목을 입력하세요.','warn'); return; }

  var evtStartVal = document.getElementById('evtStart').value;
  var evtEndVal = document.getElementById('evtEnd').value || evtStartVal;
  if (!evtStartVal) { showToast('시작일을 입력하세요.','warn'); return; }
  if (evtEndVal < evtStartVal) { showToast('종료일이 시작일보다 앞설 수 없습니다.','warn'); return; }

  var projIds = [];
  document.querySelectorAll('.evt-proj-chk:checked').forEach(function (c) { projIds.push(c.value); });

  var assigneesStr = document.getElementById('evtAssignees').value;
  var assignees = assigneesStr ? assigneesStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];

  // Integration 3: 충돌 감지 — 다수 confirm 대신 한 번 요약 토스트 (저장은 진행)
  if (assignees.length) {
    var conflicts = await checkEventConflicts(assignees, evtStartVal, evtEndVal, existingId || null);
    if (conflicts.length) {
      var totalCnt = conflicts.reduce(function (s, c) { return s + c.count; }, 0);
      var who = conflicts.slice(0, 3).map(function (c) { return c.name; }).join(', ');
      if (conflicts.length > 3) who += ' 외 ' + (conflicts.length - 3);
      if (typeof showToast === 'function') {
        showToast('⚠️ 일정 충돌: ' + who + ' (총 ' + totalCnt + '건). 그래도 저장됨', 'warn');
      }
    }
  }

  var repeatSel = document.getElementById('evtRepeat').value;
  var data = {
    title: title,
    type: document.getElementById('evtType').value,
    startDate: document.getElementById('evtStart').value,
    endDate: document.getElementById('evtEnd').value || document.getElementById('evtStart').value,
    projectIds: projIds,
    assignees: assignees,
    memo: document.getElementById('evtMemo').value.trim(),
    repeat: repeatSel || null,
    repeatUntil: repeatSel ? (document.getElementById('evtRepeatUntil').value || '') : ''
  };

  try {
    if (existingId) {
      await updateEvent(existingId, data);
    } else {
      await createEvent(data);
    }

    document.getElementById('evtModal').remove();
    await renderCalendar();
    showToast(existingId ? '일정이 수정되었습니다' : '일정이 등록되었습니다');
  } catch (err) {
    console.error('[saveEventUI]', err);
    if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  }
}

async function deleteEventUI(id) {
  try {
    var ev = await evtGet(id);
    var msg = '이 일정을 삭제하시겠습니까?';
    if (ev && ev.repeat) msg = '이 반복 일정의 모든 인스턴스가 삭제됩니다. 계속하시겠습니까?';
    if (!confirm(msg)) return;
    await evtDel(id);
    document.getElementById('evtModal').remove();
    await renderCalendar();
    showToast('일정이 삭제되었습니다', 'warn');
  } catch (err) {
    console.error('[deleteEventUI]', err);
    if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  }
}

/* ═══ Google Calendar / ICS 가져오기 ═══ */
function showGcalImportModal() {
  var existing = document.getElementById('gcalModal');
  if (existing) existing.remove();

  // v13.63: backdrop 클릭 닫기 비활성화 — 데이터 유실 방지 (✕ 버튼만 닫기)

  var modal = createModal({ id: 'gcalModal', width: '480px', boxStyle: 'padding:20px;width:90%;max-height:85vh;overflow:auto', html: '' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
      '<h3 style="font-size:14px;font-weight:700;color:var(--t1)">📅 Google Calendar 가져오기</h3>' +
      '<button class="btn btn-g btn-s" onclick="document.getElementById(\'gcalModal\').remove()">✕</button>' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:12px">' +
      // ICS 파일 가져오기
      '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px">' +
        '<div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:6px">📁 ICS 파일 가져오기</div>' +
        '<div style="font-size:10px;color:var(--t5);margin-bottom:8px">Google Calendar > 설정 > 내보내기 에서 ICS 파일을 다운로드 후 가져옵니다.</div>' +
        '<input type="file" id="icsFileInput" accept=".ics,.ical" style="display:none" onchange="importICSFile(this.files[0])">' +
        '<button class="btn btn-p btn-s" onclick="document.getElementById(\'icsFileInput\').click()">📂 ICS 파일 선택</button>' +
      '</div>' +
      // JSON 가져오기 (다른 앱 호환)
      '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px">' +
        '<div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:6px">📋 JSON 일정 가져오기</div>' +
        '<div style="font-size:10px;color:var(--t5);margin-bottom:8px">외부에서 생성된 JSON 일정 데이터를 가져옵니다.</div>' +
        '<button class="btn btn-g btn-s" onclick="importProjectsJSON()">📂 JSON 파일 선택</button>' +
      '</div>' +
      // 가져오기 결과
      '<div id="gcalImportResult" style="font-size:11px;color:var(--t5)"></div>' +
    '</div>' +
  '' }).overlay;
}

async function importICSFile(file) {
  if (!file) return;
  var resultEl = document.getElementById('gcalImportResult');
  if (resultEl) resultEl.innerHTML = '<div class="sld"><div class="sp"></div>파싱 중...</div>';

  try {
    var text = await file.text();
    var events = parseICS(text);

    if (!events.length) {
      if (resultEl) resultEl.innerHTML = '<div style="color:#EF4444">파싱된 일정이 없습니다. ICS 형식을 확인하세요.</div>';
      return;
    }

    var imported = 0;
    for (var i = 0; i < events.length; i++) {
      await createEvent(events[i]);
      imported++;
    }

    if (resultEl) resultEl.innerHTML = '<div style="color:#10B981;font-weight:600">✅ ' + imported + '건 일정 가져오기 완료!</div>';
    await renderCalendar();
  } catch (err) {
    if (resultEl) resultEl.innerHTML = '<div style="color:#EF4444">⚠️ 오류: ' + eH(err.message) + '</div>';
  }
}

function parseICS(text) {
  var events = [];
  var blocks = text.split('BEGIN:VEVENT');

  for (var i = 1; i < blocks.length; i++) {
    var block = blocks[i].split('END:VEVENT')[0];
    var ev = {};

    // SUMMARY
    var sumMatch = block.match(/SUMMARY[^:]*:(.*)/);
    if (sumMatch) ev.title = sumMatch[1].trim().replace(/\\n/g, ' ').replace(/\\,/g, ',');

    // DTSTART
    var startMatch = block.match(/DTSTART[^:]*:(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2}))?/);
    if (startMatch) {
      ev.startDate = startMatch[1] + '-' + startMatch[2] + '-' + startMatch[3];
    }

    // DTEND
    var endMatch = block.match(/DTEND[^:]*:(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2}))?/);
    if (endMatch) {
      ev.endDate = endMatch[1] + '-' + endMatch[2] + '-' + endMatch[3];
      // 종일 이벤트: DTEND는 exclusive이므로 하루 빼기
      if (!endMatch[4]) {
        ev.endDate = _calAddDays(ev.endDate, -1);
      }
    } else {
      ev.endDate = ev.startDate;
    }

    // DESCRIPTION
    var descMatch = block.match(/DESCRIPTION[^:]*:([\s\S]*?)(?=\r?\n[A-Z])/);
    if (descMatch) ev.memo = descMatch[1].trim().replace(/\\n/g, '\n').replace(/\\,/g, ',').slice(0, 500);

    // LOCATION
    var locMatch = block.match(/LOCATION[^:]*:(.*)/);
    if (locMatch) {
      var loc = locMatch[1].trim().replace(/\\,/g, ',');
      ev.memo = (ev.memo || '') + (loc ? '\n장소: ' + loc : '');
    }

    // RRULE → repeat
    var rruleMatch = block.match(/RRULE[^:]*:(.+)/);
    if (rruleMatch) {
      var rrule = rruleMatch[1];
      if (rrule.indexOf('FREQ=WEEKLY') >= 0) {
        if (rrule.indexOf('INTERVAL=2') >= 0) ev.repeat = 'biweekly';
        else ev.repeat = 'weekly';
      } else if (rrule.indexOf('FREQ=MONTHLY') >= 0) {
        ev.repeat = 'monthly';
      }
      var untilMatch = rrule.match(/UNTIL=(\d{4})(\d{2})(\d{2})/);
      if (untilMatch) ev.repeatUntil = untilMatch[1] + '-' + untilMatch[2] + '-' + untilMatch[3];
    }

    if (ev.title && ev.startDate) {
      // 유형 추론
      var titleLower = (ev.title || '').toLowerCase();
      if (titleLower.indexOf('회의') >= 0 || titleLower.indexOf('meeting') >= 0 || titleLower.indexOf('미팅') >= 0) ev.type = 'meeting';
      else if (titleLower.indexOf('출장') >= 0 || titleLower.indexOf('trip') >= 0) ev.type = 'trip';
      else ev.type = 'etc';

      events.push(ev);
    }
  }

  return events;
}

/* ═══ 달력 드래그 앤 드롭 ═══ */
function bindCalDrag(container) {
  var draggables = container.querySelectorAll('[draggable="true"][data-evt-id]');
  draggables.forEach(function (el) {
    el.addEventListener('dragstart', function (e) {
      calDragEvtId = el.dataset.evtId;
      e.dataTransfer.setData('text/plain', calDragEvtId);
      e.dataTransfer.effectAllowed = 'move';
      el.style.opacity = '0.5';
      // 드래그 중임을 표시
      setTimeout(function () {
        document.querySelectorAll('[data-date]').forEach(function (c) {
          c.classList.add('cal-drop-target');
        });
      }, 0);
    });
    el.addEventListener('dragend', function () {
      el.style.opacity = '';
      calDragEvtId = null;
      document.querySelectorAll('.cal-drop-target,.cal-drop-over').forEach(function (c) {
        c.classList.remove('cal-drop-target', 'cal-drop-over');
      });
    });
  });
}

async function calDropEvt(e, targetDate) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('cal-drop-over');

  var evtId = e.dataTransfer.getData('text/plain') || calDragEvtId;
  if (!evtId) return;

  try {
    var evt = await evtGet(evtId);
    if (!evt) return;

    // 날짜 차이 계산하여 시작일/종료일 동시 이동
    var duration = daysDiff(evt.startDate, evt.endDate) || 0;
    var newStart = targetDate;
    var newEnd = _calAddDays(targetDate, duration);

    await updateEvent(evtId, { startDate: newStart, endDate: newEnd });
    showToast('일정을 ' + targetDate + '로 이동했습니다');
    calDragEvtId = null;
    await renderCalendar();
  } catch (err) {
    console.error('[calDropEvt]', err);
    if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  }
}
