/**
 * 업무 관리자 — 달력 뷰 모듈
 * 월간/주간 달력, 일정 등록/편집, 필터링, 드래그 이동
 */

var calYear, calMonth, calViewMode = 'month';
var calWeekStart = null; // 주간 뷰 시작일
var calFilterProj = '', calFilterAssignee = '', calFilterType = '';
var calDragEvtId = null; // 드래그 중인 이벤트 ID

/* ═══ 초기화 ═══ */
function initCalendar() {
  var today = new Date();
  calYear = today.getFullYear();
  calMonth = today.getMonth();
  renderCalendar();
}

/* ═══ 메인 렌더 ═══ */
async function renderCalendar() {
  var wrap = document.getElementById('calendarWrap');
  if (!wrap) return;

  var projects = await projGetAll();
  var rawEvents = await evtGetAll();
  var milestones = await msGetAll();

  // 반복 일정 확장 (현재 보이는 범위 기준)
  var viewStart, viewEnd;
  if (calViewMode === 'month') {
    viewStart = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-01';
    var mEnd = new Date(calYear, calMonth + 1, 0);
    viewEnd = mEnd.toISOString().slice(0, 10);
  } else {
    var ws = calWeekStart || new Date();
    if (!calWeekStart) { ws = new Date(); ws.setDate(ws.getDate() - ws.getDay()); }
    viewStart = ws.toISOString().slice(0, 10);
    var we = new Date(ws); we.setDate(we.getDate() + 6);
    viewEnd = we.toISOString().slice(0, 10);
  }
  var events = expandRepeatingEvents(rawEvents, viewStart, viewEnd);

  // 대시보드 렌더
  renderDashboard(projects);

  // 필터 바
  renderCalFilter(wrap, projects);

  // 필터 적용
  if (calFilterProj) {
    projects = projects.filter(function (p) { return p.id === calFilterProj; });
    events = events.filter(function (e) { return e.projectIds && e.projectIds.includes(calFilterProj); });
    milestones = milestones.filter(function (m) {
      return projects.some(function (p) { return p.id === m.projectId; });
    });
  }
  if (calFilterAssignee) {
    projects = projects.filter(function (p) { return p.assignees && p.assignees.includes(calFilterAssignee); });
    events = events.filter(function (e) { return e.assignees && e.assignees.includes(calFilterAssignee); });
  }
  if (calFilterType) {
    events = events.filter(function (e) { return e.type === calFilterType; });
  }

  // Integration 9: 아카이브 요약 로드
  var archiveSummaries = [];
  if (typeof getWeeklyArchiveSummary === 'function') {
    try { archiveSummaries = await getWeeklyArchiveSummary(); } catch (e) {}
  }

  if (calViewMode === 'month') {
    renderMonthView(wrap, projects, events, milestones, archiveSummaries);
  } else {
    renderWeekView(wrap, projects, events, milestones, archiveSummaries);
  }
}

/* ═══ 필터 바 ═══ */
function renderCalFilter(wrap, allProjects) {
  var fb = document.getElementById('calFilterBar');
  if (!fb) return;

  // 프로젝트 옵션
  var projOpts = '<option value="">전체 프로젝트</option>';
  allProjects.forEach(function (p) {
    var sel = calFilterProj === p.id ? ' selected' : '';
    projOpts += '<option value="' + p.id + '"' + sel + '>' + eH(p.name || p.orderNo) + '</option>';
  });

  // 담당자 옵션
  var assigneeSet = {};
  allProjects.forEach(function (p) { (p.assignees || []).forEach(function (a) { assigneeSet[a] = 1; }); });
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

  fb.innerHTML =
    '<select class="si" style="padding-left:8px;max-width:180px;font-size:11px" onchange="calFilterProj=this.value;renderCalendar()">' + projOpts + '</select>' +
    '<select class="si" style="padding-left:8px;max-width:140px;font-size:11px" onchange="calFilterAssignee=this.value;renderCalendar()">' + assOpts + '</select>' +
    '<select class="si" style="padding-left:8px;max-width:140px;font-size:11px" onchange="calFilterType=this.value;renderCalendar()">' + typeOpts + '</select>' +
    '<div style="display:flex;gap:3px">' +
      '<button class="btn btn-s ' + (calViewMode === 'month' ? 'btn-p' : 'btn-g') + '" onclick="calViewMode=\'month\';renderCalendar()">월간</button>' +
      '<button class="btn btn-s ' + (calViewMode === 'week' ? 'btn-p' : 'btn-g') + '" onclick="calViewMode=\'week\';renderCalendar()">주간</button>' +
    '</div>' +
    '<button class="btn btn-g btn-s" onclick="showGcalImportModal()" title="Google Calendar / ICS 가져오기">📅 가져오기</button>';
}

/* ═══ 월간 뷰 ═══ */
function renderMonthView(wrap, projects, events, milestones, archiveSummaries) {
  var grid = document.getElementById('calGrid');
  if (!grid) return;
  grid.className = 'cal-month-mode';

  var todayStr = localDate();
  var firstDay = new Date(calYear, calMonth, 1);
  var lastDay = new Date(calYear, calMonth + 1, 0);
  var startDow = firstDay.getDay(); // 0=일
  var totalDays = lastDay.getDate();

  // 네비게이션
  document.getElementById('calNav').innerHTML =
    '<button class="btn btn-g btn-s" onclick="calMonth--;if(calMonth<0){calMonth=11;calYear--}renderCalendar()">◀</button>' +
    '<span style="font-size:16px;font-weight:700;color:var(--t1);min-width:140px;text-align:center">' + calYear + '년 ' + (calMonth + 1) + '월</span>' +
    '<button class="btn btn-g btn-s" onclick="calMonth++;if(calMonth>11){calMonth=0;calYear++}renderCalendar()">▶</button>' +
    '<button class="btn btn-g btn-s" style="margin-left:8px" onclick="var t=new Date();calYear=t.getFullYear();calMonth=t.getMonth();renderCalendar()">오늘</button>';

  // 요일 헤더
  var html = '<div class="cal-dow">일</div><div class="cal-dow">월</div><div class="cal-dow">화</div><div class="cal-dow">수</div><div class="cal-dow">목</div><div class="cal-dow">금</div><div class="cal-dow">토</div>';

  // 빈 셀
  for (var b = 0; b < startDow; b++) html += '<div class="cal-cell cal-empty"></div>';

  // 날짜 셀
  for (var d = 1; d <= totalDays; d++) {
    var dateStr = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var isToday = dateStr === todayStr;
    var cls = 'cal-cell' + (isToday ? ' cal-today' : '');

    // 해당 날짜의 프로젝트 바
    var bars = '';
    projects.forEach(function (p) {
      if (p.startDate <= dateStr && p.endDate >= dateStr) {
        var isStart = p.startDate === dateStr;
        var isEnd = p.endDate === dateStr;
        var st = autoProjectStatus(p);
        var barCls = 'cal-bar' + (isStart ? ' cal-bar-start' : '') + (isEnd ? ' cal-bar-end' : '') + (st === 'delayed' ? ' cal-bar-delayed' : '');
        bars += '<div class="' + barCls + '" style="background:' + p.color + '" onclick="event.stopPropagation();showProjectDetail(\'' + p.id + '\')" title="' + eH(p.name) + '">' + (isStart ? eH(p.name) : '') + '</div>';
      }
    });

    // 해당 날짜의 이벤트
    events.forEach(function (ev) {
      if (ev.startDate <= dateStr && ev.endDate >= dateStr) {
        var t = EVT_TYPE[ev.type] || EVT_TYPE.etc;
        bars += '<div class="cal-evt" draggable="true" data-evt-id="' + ev.id + '" style="background:' + ev.color + '20;color:' + ev.color + ';border-left:2px solid ' + ev.color + '" onclick="event.stopPropagation();showEventModal(\'' + (ev._origId || ev.id) + '\')">' + t.icon + (ev.repeat || ev._repeatInstance ? ' 🔁' : '') + ' ' + eH(ev.title) + '</div>';
      }
    });

    // 마일스톤 마커
    milestones.forEach(function (ms) {
      if (ms.endDate === dateStr) {
        var msProj = projects.find(function (p) { return p.id === ms.projectId; });
        var msSt = PROJ_STATUS[ms.status] || PROJ_STATUS.waiting;
        var msLabel = ms.name + (msProj ? ' [' + (msProj.name || msProj.orderNo) + ']' : '');
        bars += '<div class="cal-ms" style="color:' + msSt.color + '" title="' + eH(ms.name) + (msProj ? ' (' + eH(msProj.name || msProj.orderNo) + ')' : '') + ' — ' + msSt.label + '">' + msSt.icon + ' ' + eH(msLabel) + '</div>';
      }
    });

    // Integration 9: 아카이브 주간 요약 뱃지 (해당 날짜가 아카이브 시작일과 일치하거나 아카이브 주의 월요일이면 표시)
    var archBadge = '';
    if (archiveSummaries && archiveSummaries.length) {
      archiveSummaries.forEach(function (as) {
        if (dateStr === as.startDate || (dateStr >= as.startDate && dateStr <= as.endDate && new Date(dateStr).getDay() === 1)) {
          archBadge += '<div style="font-size:8px;padding:1px 4px;background:rgba(59,130,246,.12);color:#3B82F6;border-radius:3px;text-align:center;margin-top:1px;white-space:nowrap" title="' + eH(as.label) + '">&#128202; ' + Math.round(as.totalHours) + 'h/' + as.memberCount + '명</div>';
        }
      });
    }

    // 더보기 처리: 최대 3개 표시
    var barItems = bars.split('</div>').filter(function (b) { return b.trim(); }).map(function (b) { return b + '</div>'; });
    var maxShow = 3;
    var visibleBars = barItems.slice(0, maxShow).join('');
    var hiddenCount = barItems.length - maxShow;
    var moreBtn = hiddenCount > 0 ? '<div class="cal-more" onclick="event.stopPropagation();this.parentElement.classList.toggle(\'cal-bars-expand\')" style="font-size:9px;color:var(--ac-t);cursor:pointer;text-align:center;padding:1px 0;background:var(--ac-bg);border-radius:3px;margin-top:1px">+' + hiddenCount + '건 더보기</div>' : '';
    var allBars = bars;

    html += '<div class="' + cls + '" data-date="' + dateStr + '" onclick="showEventModal(null,\'' + dateStr + '\')" ondragover="event.preventDefault();this.classList.add(\'cal-drop-over\')" ondragleave="this.classList.remove(\'cal-drop-over\')" ondrop="calDropEvt(event,\'' + dateStr + '\')">' +
      '<div class="cal-date">' + d + '</div>' +
      '<div class="cal-bars">' + (hiddenCount > 0 ? '<div class="cal-bars-limited">' + visibleBars + moreBtn + '</div><div class="cal-bars-all" style="display:none">' + allBars + '</div>' : bars) + '</div>' +
      archBadge +
    '</div>';
  }

  // 나머지 빈 셀
  var remain = (7 - (startDow + totalDays) % 7) % 7;
  for (var r = 0; r < remain; r++) html += '<div class="cal-cell cal-empty"></div>';

  grid.innerHTML = html;

  // 빈 상태 안내
  var hasContent = projects.length || events.length || milestones.length;
  if (!hasContent) {
    grid.innerHTML += '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:var(--t6);font-size:13px;pointer-events:auto;z-index:1">등록된 일정이 없습니다.<br><button class=\"btn btn-p\" style=\"margin-top:10px\" onclick=\"showEventModal()\">➕ 첫 일정 등록</button><br><button class=\"btn btn-g btn-s\" style=\"margin-top:6px\" onclick=\"setPage(\'project\');setMode(\'timeline\');showProjectModal()\">➕ 프로젝트 등록</button></div>';
    grid.style.position = 'relative';
  }

  bindCalDrag(grid);
}

/* ═══ 주간 뷰 ═══ */
function renderWeekView(wrap, projects, events, milestones, archiveSummaries) {
  var grid = document.getElementById('calGrid');
  if (!grid) return;
  grid.className = '';

  if (!calWeekStart) {
    var t = new Date();
    var dow = t.getDay();
    calWeekStart = new Date(t);
    calWeekStart.setDate(t.getDate() - dow);
  }

  var todayStr = localDate();
  var days = [];
  for (var i = 0; i < 7; i++) {
    var dd = new Date(calWeekStart);
    dd.setDate(calWeekStart.getDate() + i);
    days.push(dd.toISOString().slice(0, 10));
  }

  var weekEnd = new Date(calWeekStart);
  weekEnd.setDate(calWeekStart.getDate() + 6);

  document.getElementById('calNav').innerHTML =
    '<button class="btn btn-g btn-s" onclick="calWeekStart.setDate(calWeekStart.getDate()-7);renderCalendar()">◀</button>' +
    '<span style="font-size:14px;font-weight:700;color:var(--t1);min-width:200px;text-align:center">' +
      calWeekStart.toLocaleDateString('ko') + ' ~ ' + weekEnd.toLocaleDateString('ko') +
    '</span>' +
    '<button class="btn btn-g btn-s" onclick="calWeekStart.setDate(calWeekStart.getDate()+7);renderCalendar()">▶</button>' +
    '<button class="btn btn-g btn-s" style="margin-left:8px" onclick="calWeekStart=null;renderCalendar()">이번주</button>';

  var dowNames = ['일', '월', '화', '수', '목', '금', '토'];
  var html = '';

  days.forEach(function (dateStr, idx) {
    var isToday = dateStr === todayStr;
    var cls = 'cal-week-cell' + (isToday ? ' cal-today' : '');
    var dd = new Date(dateStr);

    var items = '';

    // 프로젝트
    projects.forEach(function (p) {
      if (p.startDate <= dateStr && p.endDate >= dateStr) {
        var st = autoProjectStatus(p);
        items += '<div class="cal-week-item" style="border-left:3px solid ' + p.color + ';background:' + p.color + '15" onclick="showProjectDetail(\'' + p.id + '\')">' +
          '<span style="font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis">' + eH(p.name) + '</span>' +
          '<span class="badge" style="background:' + (PROJ_STATUS[st] || {}).bg + ';color:' + (PROJ_STATUS[st] || {}).color + '">' + (PROJ_STATUS[st] || {}).label + '</span>' +
        '</div>';
      }
    });

    // 이벤트
    events.forEach(function (ev) {
      if (ev.startDate <= dateStr && ev.endDate >= dateStr) {
        var t = EVT_TYPE[ev.type] || EVT_TYPE.etc;
        items += '<div class="cal-week-item" draggable="true" data-evt-id="' + (ev._origId || ev.id) + '" style="border-left:3px solid ' + ev.color + ';background:' + ev.color + '15" onclick="showEventModal(\'' + (ev._origId || ev.id) + '\')">' +
          t.icon + (ev.repeat || ev._repeatInstance ? ' 🔁' : '') + ' ' + eH(ev.title) +
        '</div>';
      }
    });

    // 마일스톤
    milestones.forEach(function (ms) {
      if (ms.endDate === dateStr) {
        var msProj = projects.find(function (p) { return p.id === ms.projectId; });
        var msSt = PROJ_STATUS[ms.status] || PROJ_STATUS.waiting;
        items += '<div class="cal-week-item" style="border-left:3px solid ' + msSt.color + ';background:' + msSt.bg + '">' +
          msSt.icon + ' ' + eH(ms.name) +
          (msProj ? ' <span style="color:var(--t6);font-size:10px">[' + eH(msProj.name || msProj.orderNo) + ']</span>' : '') +
          ' <span class="badge" style="background:' + msSt.bg + ';color:' + msSt.color + ';font-size:9px;padding:1px 4px">' + msSt.label + '</span>' +
        '</div>';
      }
    });

    html += '<div class="' + cls + '" data-date="' + dateStr + '" onclick="showEventModal(null,\'' + dateStr + '\')" ondragover="event.preventDefault();this.classList.add(\'cal-drop-over\')" ondragleave="this.classList.remove(\'cal-drop-over\')" ondrop="calDropEvt(event,\'' + dateStr + '\')">' +
      '<div class="cal-week-hdr"><span class="cal-week-dow">' + dowNames[idx] + '</span><span class="cal-date">' + (dd.getMonth() + 1) + '/' + dd.getDate() + '</span></div>' +
      '<div class="cal-week-items">' + items + '</div>' +
    '</div>';
  });

  // Integration 9: 주간 뷰 상단 아카이브 요약 바
  var archWeekBar = '';
  if (archiveSummaries && archiveSummaries.length && days.length) {
    var weekStartStr = days[0];
    var weekEndStr = days[days.length - 1];
    archiveSummaries.forEach(function (as) {
      // 아카이브 기간이 현재 주간과 겹치면 표시
      if (as.startDate <= weekEndStr && as.endDate >= weekStartStr) {
        archWeekBar += '<div style="padding:4px 10px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:6px;font-size:11px;color:#3B82F6;display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
          '<span>&#128202;</span> <span style="font-weight:600">아카이브:</span> ' + Math.round(as.totalHours) + 'h / ' + as.memberCount + '명' +
          (as.label ? ' <span style="color:var(--t5);font-size:10px">(' + eH(as.label) + ')</span>' : '') +
        '</div>';
      }
    });
  }

  var weekHtml = archWeekBar + '<div class="cal-week-scroll"><div class="cal-week-grid">' + html + '</div></div>';
  grid.innerHTML = weekHtml;
  bindCalDrag(grid);
}

/* ═══ 일정 등록/편집 모달 ═══ */
async function showEventModal(evtId, defaultDate) {
  var existing = document.getElementById('evtModal');
  if (existing) existing.remove();

  var evt = null;
  if (evtId) evt = await evtGet(evtId);

  var projects = await projGetAll();

  var modal = document.createElement('div');
  modal.id = 'evtModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
  modal.onclick = function (e) { if (e.target === modal) modal.remove(); };

  // 반복 인스턴스인 경우 원본 로드
  if (evt && evt._repeatInstance && evt._origId) {
    evt = await evtGet(evt._origId);
    if (!evt) return;
    evtId = evt.id;
  }

  var title = evt ? evt.title : '';
  var type = evt ? evt.type : 'etc';
  var start = evt ? evt.startDate : (defaultDate || new Date().toISOString().slice(0, 10));
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

  modal.innerHTML = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;max-width:480px;width:90%;max-height:85vh;overflow:auto">' +
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
  '</div>';

  document.body.appendChild(modal);
}

/* ═══ Integration 3: 이벤트-업무 충돌 감지 ═══ */
async function checkEventConflicts(assignees, startDate, endDate, excludeEvtId) {
  if (!assignees || !assignees.length || !startDate) return [];
  var eDate = endDate || startDate;
  var warnings = [];

  var projects = await projGetAll();
  var events = await evtGetAll();

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
  if (!title) { alert('제목을 입력하세요.'); return; }

  var evtStartVal = document.getElementById('evtStart').value;
  var evtEndVal = document.getElementById('evtEnd').value || evtStartVal;
  if (!evtStartVal) { alert('시작일을 입력하세요.'); return; }
  if (evtEndVal < evtStartVal) { alert('종료일이 시작일보다 앞설 수 없습니다.'); return; }

  var projIds = [];
  document.querySelectorAll('.evt-proj-chk:checked').forEach(function (c) { projIds.push(c.value); });

  var assigneesStr = document.getElementById('evtAssignees').value;
  var assignees = assigneesStr ? assigneesStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];

  // Integration 3: 충돌 감지
  if (assignees.length) {
    var conflicts = await checkEventConflicts(assignees, evtStartVal, evtEndVal, existingId || null);
    if (conflicts.length) {
      var msgs = conflicts.map(function (c) {
        return c.name + ' 님이 해당 기간에 ' + c.count + '건의 프로젝트/일정이 있습니다.';
      });
      if (!confirm('⚠️ ' + msgs.join('\n') + '\n계속하시겠습니까?')) return;
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

  if (existingId) {
    await updateEvent(existingId, data);
  } else {
    await createEvent(data);
  }

  document.getElementById('evtModal').remove();
  await renderCalendar();
  showToast(existingId ? '일정이 수정되었습니다' : '일정이 등록되었습니다');
}

async function deleteEventUI(id) {
  var ev = await evtGet(id);
  var msg = '이 일정을 삭제하시겠습니까?';
  if (ev && ev.repeat) msg = '이 반복 일정의 모든 인스턴스가 삭제됩니다. 계속하시겠습니까?';
  if (!confirm(msg)) return;
  await evtDel(id);
  document.getElementById('evtModal').remove();
  await renderCalendar();
  showToast('일정이 삭제되었습니다', 'warn');
}

/* ═══ Google Calendar / ICS 가져오기 ═══ */
function showGcalImportModal() {
  var existing = document.getElementById('gcalModal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'gcalModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
  modal.onclick = function (e) { if (e.target === modal) modal.remove(); };

  modal.innerHTML = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;max-width:480px;width:90%;max-height:85vh;overflow:auto">' +
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
  '</div>';

  document.body.appendChild(modal);
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
        var d = new Date(ev.endDate);
        d.setDate(d.getDate() - 1);
        ev.endDate = d.toISOString().slice(0, 10);
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

  var evt = await evtGet(evtId);
  if (!evt) return;

  // 날짜 차이 계산하여 시작일/종료일 동시 이동
  var duration = daysDiff(evt.startDate, evt.endDate) || 0;
  var newStart = targetDate;
  var nd = new Date(targetDate);
  nd.setDate(nd.getDate() + duration);
  var newEnd = nd.toISOString().slice(0, 10);

  await updateEvent(evtId, { startDate: newStart, endDate: newEnd });
  showToast('일정을 ' + targetDate + '로 이동했습니다');
  calDragEvtId = null;
  await renderCalendar();
}
