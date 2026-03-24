/**
 * 업무일지 분석기 — 타임라인(간트) 뷰 모듈
 */

var tlScale = 'day'; // day, week, month, quarter
var tlScrollLeft = 0;
var tlHideDone = false; // 완료 프로젝트 숨기기
var tlEditMode = false; // 기간 조정/이동 모드
var tlRangeStart = null; // 현재 렌더 기준 rangeStart (드래그용)
var tlUnits = null; // 현재 렌더 units (드래그용)
var tlLabelW = 0; // 현재 렌더 labelW (드래그용)
var showCriticalPath = false; // Feature 8: 크리티컬 패스 토글

/* ═══ 초기화 ═══ */
function initTimeline() {
  renderTimeline();
}

/* ═══ 메인 렌더 ═══ */
async function renderTimeline() {
  var wrap = document.getElementById('timelineWrap');
  if (!wrap) return;

  var _tlData = await Promise.all([projGetAll(), msGetAll()]);
  var allProjects = _tlData[0];
  var milestones = _tlData[1];

  // 프로젝트 리스트 패널 렌더
  renderTlProjectList(allProjects);

  // 완료 숨기기 필터 적용
  var projects = tlHideDone ? allProjects.filter(function (p) { return autoProjectStatus(p) !== 'done'; }) : allProjects;

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

  // 표시 대상 프로젝트 ID 집합 (마일스톤 필터용)
  var visibleProjIds = {};
  projects.forEach(function (p) { visibleProjIds[p.id] = true; });
  milestones = milestones.filter(function (m) { return visibleProjIds[m.projectId]; });

  // 날짜 범위 결정
  var allDates = [];
  projects.forEach(function (p) {
    if (p.startDate) allDates.push(p.startDate);
    if (p.endDate) allDates.push(p.endDate);
  });
  allDates.sort();

  var rangeStart = new Date(allDates[0]);
  var rangeEnd = new Date(allDates[allDates.length - 1]);

  // 여유 추가
  rangeStart.setDate(rangeStart.getDate() - 14);
  rangeEnd.setDate(rangeEnd.getDate() + 30);

  var todayStr = localDate();

  // 스케일별 단위 계산
  var units = getTimeUnits(rangeStart, rangeEnd, tlScale);
  var totalWidth = units.length * getUnitWidth();

  // 레이블 최대 폭 계산: 프로젝트명 + 마일스톤명 전부 측정
  var labelW = calcLabelWidth(projects, milestones);

  // 드래그용 렌더 컨텍스트 저장
  tlRangeStart = rangeStart;
  tlUnits = units;
  tlLabelW = labelW;

  // 컨트롤 바
  document.getElementById('tlControls').innerHTML =
    '<button class="btn btn-p btn-s" onclick="showProjectModal()">➕ 프로젝트</button>' +
    '<div style="display:flex;gap:3px;align-items:center">' +
      '<span style="font-size:11px;color:var(--t4);margin-right:4px">스케일:</span>' +
      ['day','week','month','quarter'].map(function (s) {
        var labels = { day: '일', week: '주', month: '월', quarter: '분기' };
        return '<button class="btn btn-s ' + (tlScale === s ? 'btn-p' : 'btn-g') + '" onclick="tlScale=\'' + s + '\';renderTimeline()">' + labels[s] + '</button>';
      }).join('') +
    '</div>' +
    '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:' + (tlEditMode ? '#FCD34D' : 'var(--t5)') + ';cursor:pointer;background:' + (tlEditMode ? 'rgba(245,158,11,.12)' : 'var(--bg-i)') + ';padding:3px 8px;border-radius:5px;border:1px solid ' + (tlEditMode ? 'rgba(245,158,11,.4)' : 'var(--bd-i)') + '"><input type="checkbox" id="tlEditModeTog" onchange="tlEditMode=this.checked;renderTimeline()"' + (tlEditMode ? ' checked' : '') + '> ✏️ 기간 조정</label>' +
    '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--t5);cursor:pointer;background:var(--bg-i);padding:3px 8px;border-radius:5px;border:1px solid var(--bd-i)"><input type="checkbox" id="tlHideDoneTog" onchange="tlHideDone=this.checked;renderTimeline()"' + (tlHideDone ? ' checked' : '') + '> 완료 숨기기</label>' +
    '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:' + (showCriticalPath ? '#EF4444' : 'var(--t5)') + ';cursor:pointer;background:' + (showCriticalPath ? 'rgba(239,68,68,.12)' : 'var(--bg-i)') + ';padding:3px 8px;border-radius:5px;border:1px solid ' + (showCriticalPath ? 'rgba(239,68,68,.4)' : 'var(--bd-i)') + '"><input type="checkbox" id="tlCriticalPathTog" onchange="showCriticalPath=this.checked;renderTimeline()"' + (showCriticalPath ? ' checked' : '') + '> 🔴 크리티컬 패스</label>' +
    '<button class="btn btn-g btn-s" onclick="exportProjectsJSON()">📥 내보내기</button>';

  // 헤더 (기간 표시)
  var headerHtml = '<div class="tl-header" style="width:' + totalWidth + 'px">';
  units.forEach(function (u) {
    var w = getUnitWidth();
    var isNow = u.contains && u.contains(todayStr);
    headerHtml += '<div class="tl-unit' + (isNow ? ' tl-unit-now' : '') + '" style="width:' + w + 'px">' + u.label + '</div>';
  });
  headerHtml += '</div>';

  // Today line 위치
  var todayPos = getTodayPosition(rangeStart, units);

  // Feature 8: 크리티컬 패스 계산
  var criticalPathIds = {};
  if (showCriticalPath) {
    criticalPathIds = calcCriticalPath(projects);
  }

  // 프로젝트 행
  var rowsHtml = '';
  projects.forEach(function (p) {
    var st = autoProjectStatus(p);
    var pMs = milestones.filter(function (m) { return m.projectId === p.id; }).sort(function (a, b) { return a.order - b.order; });

    // 프로젝트 바 위치
    var barStyle = getBarStyle(p.startDate, p.endDate, rangeStart, units);

    rowsHtml += '<div class="tl-row" data-proj-id="' + p.id + '">';
    // 레이블
    rowsHtml += '<div class="tl-label" style="width:' + labelW + 'px;min-width:' + labelW + 'px;max-width:' + labelW + 'px" onclick="showProjectDetail(\'' + p.id + '\')">' +
      '<div style="display:flex;align-items:center;gap:6px">' +
        '<span class="dot" style="background:' + p.color + ';width:8px;height:8px;border-radius:50%;flex-shrink:0"></span>' +
        '<span style="font-size:12px;font-weight:600;color:var(--t1);white-space:nowrap">' + eH(p.name || p.orderNo) + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:4px;margin-top:2px">' +
        '<span class="badge" style="background:' + PROJ_STATUS[st].bg + ';color:' + PROJ_STATUS[st].color + '">' + PROJ_STATUS[st].icon + ' ' + PROJ_STATUS[st].label + '</span>' +
        (p.progress ? '<span style="font-size:9px;color:var(--t5)">' + p.progress + '%</span>' : '') +
      '</div>' +
    '</div>';

    // 바 영역
    rowsHtml += '<div class="tl-bars" style="width:' + totalWidth + 'px">';
    // 그리드 라인
    units.forEach(function (u, idx) {
      rowsHtml += '<div class="tl-grid-line" style="left:' + (idx * getUnitWidth()) + 'px;width:' + getUnitWidth() + 'px"></div>';
    });

    // 프로젝트 바
    var barCls = 'tl-bar' + (st === 'delayed' ? ' tl-bar-delayed' : '') + (st === 'done' ? ' tl-bar-done' : '') + (tlEditMode ? ' tl-bar-editable' : '');
    var criticalStyle = (showCriticalPath && criticalPathIds[p.id]) ? 'box-shadow:0 0 0 2px #EF4444,0 0 8px rgba(239,68,68,.5);z-index:3;' : '';
    rowsHtml += '<div class="' + barCls + '" data-type="proj" data-id="' + p.id + '" style="' + barStyle + 'background:' + p.color + ';' + criticalStyle + '" title="' + eH(p.name) + ' (' + p.startDate + ' ~ ' + p.endDate + ')"' + (showCriticalPath && criticalPathIds[p.id] ? ' data-critical="1"' : '') + '>';
    // 단계 밴드 오버레이
    if (p.phases && p.startDate && p.endDate) {
      rowsHtml += buildPhaseBands(p, rangeStart, units);
    }
    if (p.progress > 0) {
      rowsHtml += '<div class="tl-bar-progress" style="width:' + Math.min(p.progress, 100) + '%;background:' + p.color + ';filter:brightness(1.3)"></div>';
    }
    if (tlEditMode) {
      rowsHtml += '<div class="tl-handle tl-handle-l" data-handle="left"></div>';
      rowsHtml += '<div class="tl-handle tl-handle-r" data-handle="right"></div>';
    }
    rowsHtml += '<span class="tl-bar-text">' + eH(p.name) + '</span></div>';

    // 마일스톤 마커
    pMs.forEach(function (ms) {
      if (ms.endDate) {
        var msPos = getDatePosition(ms.endDate, rangeStart, units);
        if (msPos >= 0) {
          var msSt = ms.status === 'done' ? '#10B981' : '#8B5CF6';
          rowsHtml += '<div class="tl-ms-marker" style="left:' + msPos + 'px;color:' + msSt + '" title="' + eH(ms.name) + '">◆</div>';
        }
      }
    });

    // Today line
    if (todayPos >= 0) {
      rowsHtml += '<div class="tl-today-line" style="left:' + todayPos + 'px"></div>';
    }

    rowsHtml += '</div>'; // tl-bars
    rowsHtml += '</div>'; // tl-row

    // 마일스톤 하위 행
    pMs.forEach(function (ms) {
      var msBarStyle = getBarStyle(ms.startDate, ms.endDate, rangeStart, units);
      var msSt = ms.status || 'waiting';
      var msStInfo = PROJ_STATUS[msSt] || PROJ_STATUS.waiting;
      var msBarBg = msSt === 'done' ? '#10B98180' : msSt === 'delayed' ? '#EF444480' : msSt === 'active' ? p.color + '90' : p.color + '40';
      var msBarCls = 'tl-bar tl-bar-ms' + (msSt === 'delayed' ? ' tl-bar-delayed' : '') + (msSt === 'done' ? ' tl-bar-done' : '');
      rowsHtml += '<div class="tl-row tl-row-sub">';
      rowsHtml += '<div class="tl-label tl-label-sub" style="width:' + labelW + 'px;min-width:' + labelW + 'px;max-width:' + labelW + 'px">' +
        '<span style="color:var(--t5);font-size:11px;display:flex;align-items:center;gap:4px;white-space:nowrap">└ ' + eH(ms.name) +
        ' <span class="badge" style="background:' + msStInfo.bg + ';color:' + msStInfo.color + ';font-size:8px;padding:1px 4px">' + msStInfo.label + '</span>' +
        '</span></div>';
      rowsHtml += '<div class="tl-bars" style="width:' + totalWidth + 'px">';
      units.forEach(function (u, idx) {
        rowsHtml += '<div class="tl-grid-line" style="left:' + (idx * getUnitWidth()) + 'px;width:' + getUnitWidth() + 'px"></div>';
      });
      var msEditCls = tlEditMode ? ' tl-bar-editable' : '';
      rowsHtml += '<div class="' + msBarCls + msEditCls + '" data-type="ms" data-id="' + ms.id + '" style="' + msBarStyle + 'background:' + msBarBg + '">';
      if (tlEditMode) {
        rowsHtml += '<div class="tl-handle tl-handle-l" data-handle="left"></div>';
        rowsHtml += '<div class="tl-handle tl-handle-r" data-handle="right"></div>';
      }
      rowsHtml += '</div>';
      if (todayPos >= 0) rowsHtml += '<div class="tl-today-line" style="left:' + todayPos + 'px"></div>';
      rowsHtml += '</div></div>';
    });
  });

  content.innerHTML =
    '<div class="tl-container" style="position:relative">' +
      '<div class="tl-scroll" id="tlScroll">' +
        '<div class="tl-header-row">' +
          '<div class="tl-label-header" style="width:' + labelW + 'px;min-width:' + labelW + 'px;max-width:' + labelW + 'px">프로젝트</div>' +
          headerHtml +
        '</div>' +
        rowsHtml +
      '</div>' +
    '</div>';

  // 오늘 날짜를 스크롤 영역 중앙에 배치
  if (todayPos >= 0) {
    var scrollEl = document.getElementById('tlScroll');
    if (scrollEl) {
      var viewW = scrollEl.clientWidth - labelW;
      scrollEl.scrollLeft = todayPos - viewW / 2;
    }
  }

  // 편집 모드일 때 드래그 이벤트 바인딩
  if (tlEditMode) {
    bindBarDrag();
  }

  // 의존관계 화살표 렌더
  drawDependencyArrows(projects, rangeStart, units, labelW);
}

/* ═══ 프로젝트 리스트 패널 ═══ */
function renderTlProjectList(allProjects) {
  var el = document.getElementById('tlProjList');
  if (!el) return;

  if (!allProjects.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--t6);padding:16px;font-size:11px">등록된 프로젝트가 없습니다.</div>';
    return;
  }

  // 상태별 정렬: 지연 > 진행중 > 대기 > 보류 > 완료
  var statusOrder = { delayed: 0, active: 1, waiting: 2, hold: 3, done: 4 };
  var sorted = allProjects.slice().sort(function (a, b) {
    var sa = statusOrder[autoProjectStatus(a)] || 9;
    var sb = statusOrder[autoProjectStatus(b)] || 9;
    return sa - sb;
  });

  var html = '';
  sorted.forEach(function (p) {
    var st = autoProjectStatus(p);
    var stInfo = PROJ_STATUS[st] || PROJ_STATUS.waiting;
    var isDone = st === 'done';
    html += '<div class="tl-list-item' + (isDone ? ' tl-list-done' : '') + '" onclick="tlScrollToProject(\'' + p.id + '\')" title="' + eH(p.startDate + ' ~ ' + p.endDate) + '">' +
      '<span class="tl-list-dot" style="background:' + p.color + '"></span>' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(p.name || p.orderNo) + '</span>' +
      '<span class="badge" style="background:' + stInfo.bg + ';color:' + stInfo.color + ';font-size:8px;padding:1px 5px;flex-shrink:0">' + stInfo.label + '</span>' +
    '</div>';
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
function calcLabelWidth(projects, milestones) {
  // 숨겨진 캔버스로 텍스트 폭 측정
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');

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

  // 마일스톤: indent(24) + "└ " + 이름 + gap(4) + 뱃지 + padding(12)
  ctx.font = '400 11px "Noto Sans KR", sans-serif';
  milestones.forEach(function (ms) {
    var nameW = measureTextCached(ctx, '└ ' + ms.name);
    var msSt = ms.status || 'waiting';
    var msStInfo = PROJ_STATUS[msSt] || PROJ_STATUS.waiting;
    ctx.font = '600 8px "Noto Sans KR", sans-serif';
    var badgeW = measureTextCached(ctx, msStInfo.label) + 10; // badge padding
    ctx.font = '400 11px "Noto Sans KR", sans-serif';
    var w = 24 + nameW + 4 + badgeW + 12;
    if (w > maxW) maxW = w;
  });

  // 최소 160px, 최대 400px
  return Math.max(160, Math.min(Math.ceil(maxW), 400));
}

/* ═══ 스케일별 단위 생성 ═══ */
function getTimeUnits(start, end, scale) {
  var units = [];
  var d = new Date(start);

  if (scale === 'day') {
    while (d <= end) {
      var ds = d.toISOString().slice(0, 10);
      (function (ds2) {
        units.push({ label: (d.getMonth() + 1) + '/' + d.getDate(), date: ds2, contains: function (dt) { return dt === ds2; } });
      })(ds);
      d.setDate(d.getDate() + 1);
    }
  } else if (scale === 'week') {
    d.setDate(d.getDate() - d.getDay()); // 일요일 시작
    while (d <= end) {
      var ws = d.toISOString().slice(0, 10);
      var we = new Date(d);
      we.setDate(we.getDate() + 6);
      var weStr = we.toISOString().slice(0, 10);
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
    d.setDate(1);
    while (d <= end) {
      var ms = d.toISOString().slice(0, 10);
      var ml = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      var mlStr = ml.toISOString().slice(0, 10);
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
    d.setMonth(Math.floor(d.getMonth() / 3) * 3);
    d.setDate(1);
    while (d <= end) {
      var qs = d.toISOString().slice(0, 10);
      var q = Math.floor(d.getMonth() / 3) + 1;
      var qe = new Date(d.getFullYear(), d.getMonth() + 3, 0);
      var qeStr = qe.toISOString().slice(0, 10);
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

function getUnitWidth() {
  if (tlScale === 'day') return 32;
  if (tlScale === 'week') return 60;
  if (tlScale === 'month') return 120;
  return 180;
}

function getDatePosition(dateStr, rangeStart, units) {
  var w = getUnitWidth();
  for (var i = 0; i < units.length; i++) {
    if (units[i].contains && units[i].contains(dateStr)) {
      // 단위 내 비율
      var uStart = units[i].startDate || units[i].date;
      var uEnd = units[i].endDate || units[i].date;
      var total = daysDiff(uStart, uEnd) || 1;
      var offset = daysDiff(uStart, dateStr);
      return i * w + (offset / total) * w;
    }
  }
  return -1;
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
  var nextDay = new Date(proj.endDate);
  nextDay.setDate(nextDay.getDate() + 1);
  var barRight = getDatePosition(nextDay.toISOString().slice(0, 10), rangeStart, units);
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
    var pNextDay = new Date(phEnd);
    pNextDay.setDate(pNextDay.getDate() + 1);
    var pRight = getDatePosition(pNextDay.toISOString().slice(0, 10), rangeStart, units);

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
  var nextDay = new Date(endDate);
  nextDay.setDate(nextDay.getDate() + 1);
  var right = getDatePosition(nextDay.toISOString().slice(0, 10), rangeStart, units);
  if (left < 0) left = 0;
  if (right < 0) right = left + getUnitWidth();
  var width = Math.max(right - left, 20);
  return 'left:' + left + 'px;width:' + width + 'px;';
}

/* ═══ 프로젝트 등록/편집 모달 ═══ */
async function showProjectModal(projId) {
  var existing = document.getElementById('projModal');
  if (existing) existing.remove();

  var proj = null;
  var projMs = [];
  var allProjects = await projGetAll();
  if (projId) {
    proj = await projGet(projId);
    projMs = await msGetByProject(projId);
    projMs.sort(function (a, b) { return a.order - b.order; });
  }

  var modal = document.createElement('div');
  modal.id = 'projModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
  modal.onclick = function (e) { if (e.target === modal) modal.remove(); };

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

  // 마일스톤 편집 리스트
  var msHtml = '';
  if (projMs.length) {
    msHtml = projMs.map(function (m, idx) {
      return '<div class="proj-ms-row" data-msid="' + m.id + '" style="display:grid;grid-template-columns:1fr 110px 110px 90px 30px;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--bd)">' +
        '<input type="text" class="si ms-name" value="' + eH(m.name) + '" style="padding:4px 8px;font-size:11px;padding-left:8px">' +
        '<input type="date" class="si ms-start" value="' + m.startDate + '" style="padding:4px 6px;font-size:10px;padding-left:6px">' +
        '<input type="date" class="si ms-end" value="' + m.endDate + '" style="padding:4px 6px;font-size:10px;padding-left:6px">' +
        '<select class="si ms-status" style="padding:4px 6px;font-size:10px;padding-left:6px">' + Object.keys(PROJ_STATUS).map(function (k) { return '<option value="' + k + '"' + (m.status === k ? ' selected' : '') + '>' + PROJ_STATUS[k].label + '</option>'; }).join('') + '</select>' +
        '<button class="btn btn-d btn-s" onclick="this.closest(\'.proj-ms-row\').remove()" style="padding:2px 6px">✕</button>' +
      '</div>';
    }).join('');
  }

  modal.innerHTML = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;max-width:640px;width:95%;max-height:90vh;overflow:auto">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
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
        '<div><label class="fl">시작일</label><input type="date" class="si" id="projStart" value="' + (proj ? proj.startDate : '') + '" style="padding-left:10px"></div>' +
        '<div><label class="fl">종료일</label><input type="date" class="si" id="projEnd" value="' + (proj ? proj.endDate : '') + '" style="padding-left:10px"></div>' +
        '<div><label class="fl">상태</label><select class="si" id="projStatus" style="padding-left:8px">' + statusOpts + '</select></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label class="fl">예상 총 투입시간 (h)</label><input type="number" class="si" id="projEstHours" value="' + (proj ? proj.estimatedHours : '') + '" placeholder="0" style="padding-left:10px" min="0"></div>' +
        '<div><label class="fl">담당자 <span style="font-size:9px;color:var(--t6)">(쉼표로 구분)</span></label><input type="text" class="si" id="projAssignees" value="' + eH(proj ? (proj.assignees || []).join(', ') : '') + '" placeholder="홍길동, 김철수..." style="padding-left:10px" oninput="renderAssigneeWorkload(\'' + (proj ? proj.id : '') + '\')">' +
          // Integration 6: 그룹에서 가져오기 dropdown + 그룹 저장 버튼
          (function () {
            var groups = typeof memberGroups !== 'undefined' ? memberGroups : [];
            var grpOpts = '<option value="">👥 그룹에서 가져오기...</option>';
            groups.forEach(function (g) {
              grpOpts += '<option value="' + eH(g.id) + '">' + eH(g.name) + ' (' + g.members.length + '명)</option>';
            });
            return '<div style="display:flex;gap:4px;margin-top:4px;align-items:center">' +
              '<select class="si" style="flex:1;padding:3px 6px;padding-left:6px;font-size:10px" onchange="if(this.value){var g=typeof getGroup===\'function\'?getGroup(this.value):null;if(g){document.getElementById(\'projAssignees\').value=g.members.join(\', \');if(typeof renderAssigneeWorkload===\'function\')renderAssigneeWorkload(\'' + (proj ? proj.id : '') + '\')}this.value=\'\'}">' + grpOpts + '</select>' +
              '<button class="btn btn-g btn-s" style="font-size:9px;white-space:nowrap;padding:3px 6px" onclick="saveAssigneesAsGroup()" title="현재 담당자를 그룹으로 저장">💾 그룹 저장</button>' +
            '</div>';
          })() +
          '<div id="assigneeWorkloadArea" style="margin-top:4px"></div></div>' +
      '</div>' +
      // 의존관계 (선행 프로젝트)
      (function () {
        var allP = allProjects || [];
        var deps = proj ? (proj.dependencies || []) : [];
        var others = allP.filter(function (op) { return !proj || op.id !== proj.id; });
        if (!others.length) return '';
        var depChecks = others.map(function (op) {
          var chk = deps.includes(op.id) ? ' checked' : '';
          return '<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--t3);cursor:pointer"><input type="checkbox" class="proj-dep-chk" value="' + op.id + '"' + chk + '><span class="dot" style="background:' + op.color + ';width:6px;height:6px;border-radius:50%;display:inline-block"></span>' + eH(op.name || op.orderNo) + '</label>';
        }).join('');
        return '<div><label class="fl">선행 프로젝트 (의존관계)</label><div style="display:flex;flex-wrap:wrap;gap:8px;max-height:80px;overflow:auto;padding:6px;background:var(--bg-i);border-radius:6px">' + depChecks + '</div></div>';
      })() +
      '<div><label class="fl">메모</label><textarea class="si" id="projMemo" rows="2" style="padding-left:10px;resize:vertical">' + eH(proj ? proj.memo : '') + '</textarea></div>' +
      // 마일스톤 섹션
      '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
          '<span style="font-size:12px;font-weight:600;color:var(--t4)">◆ 마일스톤 (하위 단계)</span>' +
          '<div style="display:flex;gap:4px">' +
            (proj && proj.orderNo ? '<button class="btn btn-g btn-s" style="font-size:10px" onclick="runSuggestMilestones(\'' + eH(proj.orderNo) + '\')">🤖 마일스톤 제안</button>' : '') +
            '<button class="btn btn-g btn-s" onclick="addMsRow()">+ 추가</button>' +
          '</div>' +
        '</div>' +
        '<div id="msRows">' + msHtml + '</div>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">' +
      (proj ? '<button class="btn btn-d btn-s" onclick="deleteProjectUI(\'' + proj.id + '\')">🗑 삭제</button>' : '') +
      '<button class="btn btn-p" onclick="saveProjectUI(\'' + (proj ? proj.id : '') + '\')">' + (proj ? '💾 수정' : '➕ 등록') + '</button>' +
    '</div>' +
  '</div>';

  document.body.appendChild(modal);

  // Integration 2: 기존 담당자가 있으면 부하 표시 초기화
  if (proj && proj.assignees && proj.assignees.length) {
    renderAssigneeWorkload(proj.id);
  }
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
      if (c <= 1) { color = '#10B981'; bg = 'rgba(16,185,129,.12)'; label = '여유'; }
      else if (c === 2) { color = '#3B82F6'; bg = 'rgba(59,130,246,.12)'; label = '적정'; }
      else if (c === 3) { color = '#F59E0B'; bg = 'rgba(245,158,11,.12)'; label = '주의'; }
      else { color = '#EF4444'; bg = 'rgba(239,68,68,.12)'; label = '과부하'; }
      var displayN = typeof shortName === 'function' ? shortName(name) : name;
      var title = info.projects.length ? name + ': ' + info.projects.join(', ') : name + ': 배정 프로젝트 없음';
      html += '<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:' + bg + ';color:' + color + ';border:1px solid ' + color + '30;cursor:help" title="' + eH(title) + '">' + eH(displayN) + ' ' + c + '건 <b>' + label + '</b></span>';
    });
    html += '</div>';
    if (names.some(function (n) { return result[n] && result[n].count >= 3; })) {
      html += '<div style="font-size:10px;color:#F59E0B;margin-top:3px">⚠️ 3건 이상 배정된 담당자가 있습니다</div>';
    }
    area.innerHTML = html;
  });
}

function addMsRow() {
  var container = document.getElementById('msRows');
  var statusOpts = Object.keys(PROJ_STATUS).map(function (k) {
    return '<option value="' + k + '">' + PROJ_STATUS[k].label + '</option>';
  }).join('');

  var row = document.createElement('div');
  row.className = 'proj-ms-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 110px 110px 90px 30px;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--bd)';
  row.innerHTML =
    '<input type="text" class="si ms-name" value="" placeholder="단계명..." style="padding:4px 8px;font-size:11px;padding-left:8px">' +
    '<input type="date" class="si ms-start" value="" style="padding:4px 6px;font-size:10px;padding-left:6px">' +
    '<input type="date" class="si ms-end" value="" style="padding:4px 6px;font-size:10px;padding-left:6px">' +
    '<select class="si ms-status" style="padding:4px 6px;font-size:10px;padding-left:6px">' + statusOpts + '</select>' +
    '<button class="btn btn-d btn-s" onclick="this.closest(\'.proj-ms-row\').remove()" style="padding:2px 6px">✕</button>';
  container.appendChild(row);
}

async function saveProjectUI(existingId) {
  var name = document.getElementById('projName').value.trim();
  if (!name) { showToast('프로젝트명을 입력하세요.','warn'); return; }

  var startDate = document.getElementById('projStart').value;
  var endDate = document.getElementById('projEnd').value;
  if (!startDate || !endDate) { showToast('시작일과 종료일을 입력하세요.','warn'); return; }
  if (startDate > endDate) { showToast('종료일이 시작일보다 앞설 수 없습니다.','warn'); return; }

  var assigneesStr = document.getElementById('projAssignees').value;
  var assignees = assigneesStr ? assigneesStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];

  var depIds = [];
  document.querySelectorAll('.proj-dep-chk:checked').forEach(function (c) { depIds.push(c.value); });

  // 순환 의존 방지
  if (existingId && depIds.includes(existingId)) { showToast('자기 자신을 선행 프로젝트로 지정할 수 없습니다.','warn'); return; }

  var data = {
    orderNo: document.getElementById('projOrderNo').value.trim(),
    name: name,
    startDate: startDate,
    endDate: endDate,
    status: document.getElementById('projStatus').value,
    estimatedHours: parseFloat(document.getElementById('projEstHours').value) || 0,
    assignees: assignees,
    dependencies: depIds,
    memo: document.getElementById('projMemo').value.trim()
  };

  var projId;
  try {
    if (existingId) {
      await updateProject(existingId, data);
      projId = existingId;
      // 기존 마일스톤 삭제 후 새로 저장
      await msDelByProject(existingId);
    } else {
      var p = await createProject(data);
      if (!p || !p.id) { showToast('프로젝트 저장 실패: DB 연결을 확인하세요.','warn'); return; }
      projId = p.id;
    }

    // 마일스톤 저장
    var msRows = document.querySelectorAll('#msRows .proj-ms-row');
    for (var i = 0; i < msRows.length; i++) {
      var row = msRows[i];
      var msName = row.querySelector('.ms-name').value.trim();
      if (!msName) continue;
      await createMilestone({
        projectId: projId,
        name: msName,
        startDate: row.querySelector('.ms-start').value,
        endDate: row.querySelector('.ms-end').value,
        status: row.querySelector('.ms-status').value,
        order: i
      });
    }

    document.getElementById('projModal').remove();
    await renderTimeline();
    if (typeof renderCalendar === 'function') await renderCalendar();
    showToast(existingId ? '프로젝트가 수정되었습니다' : '프로젝트가 등록되었습니다');
  } catch (err) {
    console.error('[saveProjectUI] 저장 실패:', err);
    showToast('프로젝트 저장 중 오류 발생: ' + (err.message || err), 'warn');
  }
}

async function deleteProjectUI(id) {
  if (!confirm('이 프로젝트와 모든 마일스톤을 삭제하시겠습니까?')) return;
  await deleteProjectCascade(id);
  document.getElementById('projModal').remove();
  await renderTimeline();
  if (typeof renderCalendar === 'function') await renderCalendar();
  showToast('프로젝트가 삭제되었습니다', 'warn');
}

/* ═══ 프로젝트 상세 보기 ═══ */
async function showProjectDetail(id) {
  var existing = document.getElementById('projDetailPanel');
  if (existing) existing.remove();
  var existingBd = document.getElementById('projDetailBackdrop');
  if (existingBd) existingBd.remove();

  var proj = await projGet(id);
  if (!proj) return;
  var projMs = await msGetByProject(id);
  projMs.sort(function (a, b) { return a.order - b.order; });
  var st = autoProjectStatus(proj);
  var stInfo = PROJ_STATUS[st] || PROJ_STATUS.waiting;
  var allChk = typeof chkGetByProject === 'function' ? await chkGetByProject(id) : [];
  var phaseProgress = {};
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  var phaseKeys = Object.keys(phases).sort(function (a, b) { return (phases[a].seq || 0) - (phases[b].seq || 0); });
  phaseKeys.forEach(function (pk) {
    var items = allChk.filter(function (c) { return c.phase === pk; });
    var done = items.filter(function (c) { return c.done; }).length;
    phaseProgress[pk] = { total: items.length, done: done, pct: items.length ? Math.round(done / items.length * 100) : 0 };
  });

  var panel = document.createElement('div');
  panel.id = 'projDetailPanel';
  panel.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:420px;max-width:92vw;background:var(--bg-p);border-left:1px solid var(--bd);z-index:9998;overflow-y:auto;box-shadow:-4px 0 20px rgba(0,0,0,.15);padding:20px;animation:slideIn .2s ease';

  // 헤더
  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
    '<h3 style="font-size:15px;font-weight:700;color:var(--t1);display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span style="background:' + proj.color + ';width:10px;height:10px;border-radius:50%;display:inline-block;flex-shrink:0"></span>' + eH(proj.name) + '</h3>' +
    '<button class="btn btn-g btn-s" onclick="document.getElementById(\'projDetailPanel\').remove();var bd=document.getElementById(\'projDetailBackdrop\');if(bd)bd.remove()">✕</button>' +
  '</div>';

  // 상태 배지
  html += '<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">' +
    '<span class="badge" style="background:' + stInfo.bg + ';color:' + stInfo.color + '">' + stInfo.icon + ' ' + stInfo.label + '</span>' +
    (proj.orderNo ? '<span class="badge" style="background:var(--bg-i);color:var(--t4)">' + eH(proj.orderNo) + '</span>' : '') +
  '</div>';

  // 탭 (개요 / 라이프사이클 / 이슈 / 투입실적)
  var pdTabStyle = 'padding:6px 10px;font-size:11px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--t5);font-weight:600;background:none;cursor:pointer';
  var pdTabActiveStyle = 'padding:6px 10px;font-size:11px;border:none;border-bottom:2px solid var(--ac);margin-bottom:-2px;color:var(--ac);font-weight:700;background:none;cursor:pointer';
  html += '<div style="display:flex;gap:0;margin-bottom:14px;border-bottom:2px solid var(--bd)">' +
    '<button class="btn" id="pdTabOverview" style="' + pdTabActiveStyle + '" onclick="pdSwitchTab(\'overview\')">개요</button>' +
    '<button class="btn" id="pdTabLifecycle" style="' + pdTabStyle + '" onclick="pdSwitchTab(\'lifecycle\')">라이프사이클</button>' +
    '<button class="btn" id="pdTabIssues" style="' + pdTabStyle + '" onclick="pdSwitchTab(\'issues\',\'' + id + '\')">이슈</button>' +
    '<button class="btn" id="pdTabWork" style="' + pdTabStyle + '" onclick="pdSwitchTab(\'work\',\'' + id + '\')">투입실적</button>' +
  '</div>';

  // ── 개요 탭 ──
  html += '<div id="pdOverview">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">' +
    '<div style="font-size:10px;color:var(--t5)">시작일<div style="font-size:12px;color:var(--t2);font-weight:600;margin-top:2px">' + (proj.startDate || '-') + '</div></div>' +
    '<div style="font-size:10px;color:var(--t5)">종료일<div style="font-size:12px;color:var(--t2);font-weight:600;margin-top:2px">' + (proj.endDate || '-') + '</div></div>' +
  '</div>';

  // 진척률 바
  if (proj.progress > 0) {
    html += '<div style="margin:10px 0"><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t5);margin-bottom:3px"><span>진척률</span><span>' + proj.progress + '%' + (proj.actualHours ? ' (' + proj.actualHours + 'h / ' + proj.estimatedHours + 'h)' : '') + '</span></div><div style="height:6px;background:var(--bg-i);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + Math.min(proj.progress, 100) + '%;background:' + proj.color + ';border-radius:3px"></div></div></div>';
  }

  // 담당자
  var assigneeHtml = (proj.assignees || []).length ?
    (proj.assignees || []).map(function (a) {
      var dn = typeof shortName === 'function' ? shortName(a) : a;
      return '<span style="font-size:10px;padding:2px 8px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:4px;color:var(--t3)">' + eH(dn) + '</span>';
    }).join(' ') : '<span style="font-size:11px;color:var(--t6)">미지정</span>';
  html += '<div style="margin-bottom:12px"><div style="font-size:10px;color:var(--t5);margin-bottom:4px">담당자</div>' + assigneeHtml + '</div>';

  // 수주 정보 (orderNo가 있는 경우)
  if (proj.orderNo && typeof getOrderInfo === 'function') {
    var orderInfo = getOrderInfo(proj.orderNo);
    if (orderInfo) {
      html += '<div style="margin-bottom:12px"><div style="font-size:10px;color:var(--t5);margin-bottom:6px">수주 정보</div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px;background:var(--bg-i);border-radius:8px;border:1px solid var(--bd)">';
      html += '<div style="font-size:10px;color:var(--t5)">수주번호<div style="font-size:11px;color:var(--t2);font-weight:600;margin-top:1px">' + eH(proj.orderNo) + '</div></div>';
      if (orderInfo.date) html += '<div style="font-size:10px;color:var(--t5)">수주일<div style="font-size:11px;color:var(--t2);font-weight:600;margin-top:1px">' + eH(orderInfo.date) + '</div></div>';
      if (orderInfo.client) html += '<div style="font-size:10px;color:var(--t5)">거래처<div style="font-size:11px;color:var(--t2);font-weight:600;margin-top:1px">' + eH(orderInfo.client) + '</div></div>';
      if (orderInfo.delivery) html += '<div style="font-size:10px;color:var(--t5)">납품예정<div style="font-size:11px;color:var(--t2);font-weight:600;margin-top:1px">' + eH(orderInfo.delivery) + '</div></div>';
      html += '</div></div>';
    }
  }

  if (proj.memo) {
    html += '<div style="margin-bottom:12px"><div style="font-size:10px;color:var(--t5);margin-bottom:4px">메모</div><div style="font-size:11px;color:var(--t3);padding:8px;background:var(--bg-i);border-radius:6px;white-space:pre-wrap">' + eH(proj.memo) + '</div></div>';
  }

  // 마일스톤 (기존)
  var msHoursData = {};
  if (projMs.length && typeof calcHoursByMilestone === 'function') {
    try { msHoursData = await calcHoursByMilestone(id); } catch (e) { console.warn('[Timeline]', e); }
  }
  var msHtml = projMs.length ?
    projMs.map(function (m) {
      var mSt = PROJ_STATUS[m.status] || PROJ_STATUS.waiting;
      var msH = msHoursData[m.id];
      var hoursInfo = msH && msH.hours > 0 ? '<span style="font-size:9px;color:var(--ac-t);background:var(--ac-bg);padding:1px 5px;border-radius:3px;margin-left:4px">' + msH.hours + 'h</span>' : '';
      return '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--bd)">' +
        '<span style="font-size:10px">' + mSt.icon + '</span>' +
        '<span style="flex:1;font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(m.name) + hoursInfo + '</span>' +
        '<span style="font-size:9px;color:var(--t6)">' + (m.endDate || '') + '</span>' +
        '<span class="badge" style="background:' + mSt.bg + ';color:' + mSt.color + ';font-size:8px;padding:1px 4px">' + mSt.label + '</span></div>';
    }).join('') : '<div style="font-size:11px;color:var(--t6)">마일스톤 없음</div>';
  html += '<div style="margin-bottom:12px"><div style="font-size:10px;color:var(--t5);margin-bottom:6px">마일스톤 (' + projMs.length + ')</div>' + msHtml + '</div>';
  html += '</div>'; // end pdOverview

  // ── 라이프사이클 탭 ──
  html += '<div id="pdLifecycle" style="display:none">';

  // 단계 진행 바
  var curPhase = proj.currentPhase || 'order';
  html += '<div style="display:flex;align-items:center;gap:2px;margin-bottom:16px;padding:8px 0">';
  phaseKeys.forEach(function (pk, idx) {
    var ph = phases[pk];
    var phs = proj.phases && proj.phases[pk] ? proj.phases[pk].status : 'waiting';
    var isCur = pk === curPhase;
    var isDone = phs === 'done';
    var bg = isDone ? ph.color : isCur ? ph.color + '44' : 'var(--bg-i)';
    var textColor = isDone ? '#fff' : isCur ? ph.color : 'var(--t6)';
    var border = isCur ? '2px solid ' + ph.color : '1px solid var(--bd)';
    html += '<div style="flex:1;text-align:center;padding:6px 2px;border-radius:6px;background:' + bg + ';border:' + border + ';cursor:pointer" onclick="pdShowPhase(\'' + id + '\',\'' + pk + '\')" title="' + ph.label + '">';
    html += '<div style="font-size:14px">' + (isDone ? '✅' : isCur ? '🔄' : ph.icon) + '</div>';
    html += '<div style="font-size:9px;color:' + textColor + ';font-weight:' + (isCur ? '700' : '500') + ';margin-top:2px">' + ph.label + '</div>';
    var pp = phaseProgress[pk];
    if (pp && pp.total > 0) {
      html += '<div style="font-size:8px;color:' + textColor + ';margin-top:1px">' + pp.done + '/' + pp.total + '</div>';
    }
    html += '</div>';
    if (idx < phaseKeys.length - 1) html += '<div style="color:var(--t6);font-size:10px">→</div>';
  });
  html += '</div>';

  // 단계 전환 버튼
  var curIdx = phaseKeys.indexOf(curPhase);
  var nextPhase = curIdx < phaseKeys.length - 1 ? phaseKeys[curIdx + 1] : null;
  if (nextPhase) {
    var nextPh = phases[nextPhase];
    html += '<div style="text-align:center;margin-bottom:14px">';
    html += '<button class="btn btn-p btn-s" onclick="pdAdvancePhase(\'' + id + '\',\'' + nextPhase + '\')" style="font-size:11px">➡️ ' + nextPh.label + ' 단계로 전환</button>';
    html += '</div>';
  }

  // 현재 단계 체크리스트 (기본 표시)
  html += '<div id="pdPhaseChecklists">';
  html += buildPhaseChecklistHtml(id, curPhase, allChk, phases);
  html += '</div>';

  html += '</div>'; // end pdLifecycle

  // ── 이슈 탭 ──
  html += '<div id="pdIssues" style="display:none"><div style="text-align:center;color:var(--t6);font-size:11px;padding:20px 0">로딩 중...</div></div>';

  // ── 투입실적 탭 ──
  html += '<div id="pdWork" style="display:none"><div style="text-align:center;color:var(--t6);font-size:11px;padding:20px 0">로딩 중...</div></div>';

  // 하단 버튼
  html += '<div style="display:flex;gap:8px;margin-top:16px">' +
    '<button class="btn btn-p btn-s" onclick="document.getElementById(\'projDetailPanel\').remove();var bd=document.getElementById(\'projDetailBackdrop\');if(bd)bd.remove();showProjectModal(\'' + id + '\')">✏️ 편집</button>' +
    '<button class="btn btn-g btn-s" onclick="pdGenerateChecklists(\'' + id + '\')">📋 체크리스트 생성</button>' +
    '<button class="btn btn-d btn-s" onclick="document.getElementById(\'projDetailPanel\').remove();var bd=document.getElementById(\'projDetailBackdrop\');if(bd)bd.remove();deleteProjectUI(\'' + id + '\')">🗑 삭제</button>' +
  '</div>' +
  '<div id="progressHistorySection" style="margin-top:16px"></div>';

  panel.innerHTML = html;
  document.body.appendChild(panel);

  if (typeof getProgressHistory === 'function') {
    renderProgressHistoryChart(id, proj);
  }

  var backdrop = document.createElement('div');
  backdrop.id = 'projDetailBackdrop';
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:9997;background:rgba(0,0,0,.3)';
  backdrop.onclick = function () { panel.remove(); backdrop.remove(); };
  document.body.appendChild(backdrop);
}

/* ═══ 프로젝트 상세 패널: 탭 전환 ═══ */
function pdSwitchTab(tab, projId) {
  var tabs = ['overview', 'lifecycle', 'issues', 'work'];
  var ids = { overview: 'pdOverview', lifecycle: 'pdLifecycle', issues: 'pdIssues', work: 'pdWork' };
  var btnIds = { overview: 'pdTabOverview', lifecycle: 'pdTabLifecycle', issues: 'pdTabIssues', work: 'pdTabWork' };
  tabs.forEach(function (t) {
    var el = document.getElementById(ids[t]);
    var btn = document.getElementById(btnIds[t]);
    if (el) el.style.display = t === tab ? '' : 'none';
    if (btn) {
      btn.style.borderBottomColor = t === tab ? 'var(--ac)' : 'transparent';
      btn.style.color = t === tab ? 'var(--ac)' : 'var(--t5)';
      btn.style.fontWeight = t === tab ? '700' : '600';
    }
  });
  // 이슈 탭 로딩
  if (tab === 'issues' && projId) pdLoadIssues(projId);
  // 투입실적 탭 로딩
  if (tab === 'work' && projId) pdLoadWork(projId);
}

/* ═══ 프로젝트 상세: 이슈 목록 로딩 ═══ */
function pdLoadIssues(projId) {
  var wrap = document.getElementById('pdIssues');
  if (!wrap) return;
  if (typeof issueGetByProject !== 'function') {
    wrap.innerHTML = '<div style="text-align:center;color:var(--t6);font-size:11px;padding:20px 0">이슈 관리 모듈이 로드되지 않았습니다.</div>';
    return;
  }
  issueGetByProject(projId).then(function (issues) {
    if (!issues || issues.length === 0) {
      wrap.innerHTML = '<div style="text-align:center;color:var(--t6);font-size:11px;padding:20px 0">등록된 이슈가 없습니다.' +
        '<br><button class="btn btn-g btn-s" style="margin-top:8px;font-size:10px" onclick="document.getElementById(\'projDetailPanel\').remove();var bd=document.getElementById(\'projDetailBackdrop\');if(bd)bd.remove();if(typeof showIssueModal===\'function\')showIssueModal()">+ 이슈 등록</button></div>';
      return;
    }
    var statuses = typeof ISSUE_STATUS !== 'undefined' ? ISSUE_STATUS : {};
    var urgencies = typeof ISSUE_URGENCY !== 'undefined' ? ISSUE_URGENCY : {};
    var types = typeof ISSUE_TYPE !== 'undefined' ? ISSUE_TYPE : {};

    // 요약 카운트
    var open = issues.filter(function (i) { return i.status !== 'resolved' && i.status !== 'closed'; }).length;
    var urgent = issues.filter(function (i) { return i.urgency === 'urgent' && i.status !== 'resolved' && i.status !== 'closed'; }).length;
    var h = '<div style="display:flex;gap:6px;margin-bottom:10px">' +
      '<span class="badge" style="background:var(--bg-i);color:var(--t3);font-size:10px">전체 ' + issues.length + '</span>' +
      '<span class="badge" style="background:rgba(59,130,246,.15);color:#3B82F6;font-size:10px">미해결 ' + open + '</span>' +
      (urgent > 0 ? '<span class="badge" style="background:rgba(239,68,68,.15);color:#EF4444;font-size:10px">긴급 ' + urgent + '</span>' : '') +
    '</div>';

    // 이슈 목록
    issues.sort(function (a, b) {
      var uOrd = { urgent: 0, normal: 1, low: 2 };
      var sOrd = { open: 0, inProgress: 1, hold: 2, resolved: 3, closed: 4 };
      var us = (uOrd[a.urgency] || 1) - (uOrd[b.urgency] || 1);
      if (us !== 0) return us;
      return (sOrd[a.status] || 0) - (sOrd[b.status] || 0);
    });
    issues.forEach(function (iss) {
      var st = statuses[iss.status] || { label: iss.status, color: '#94A3B8' };
      var urg = urgencies[iss.urgency] || { label: '', icon: '', color: '#94A3B8' };
      var tp = types[iss.type] || { label: '', icon: '', color: '#64748B' };
      var resolved = iss.status === 'resolved' || iss.status === 'closed';
      h += '<div style="padding:6px 0;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:6px;' + (resolved ? 'opacity:.5' : '') + ';cursor:pointer" onclick="if(typeof showIssueDetail===\'function\')showIssueDetail(\'' + iss.id + '\')">';
      h += '<span style="font-size:11px" title="' + tp.label + '">' + (tp.icon || '') + '</span>';
      h += '<span style="flex:1;font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(iss.title) + '</span>';
      if (iss.urgency === 'urgent') h += '<span style="font-size:9px;color:#EF4444">🔴</span>';
      h += '<span class="badge" style="background:' + st.color + '22;color:' + st.color + ';font-size:8px;padding:1px 4px">' + st.label + '</span>';
      h += '</div>';
    });

    wrap.innerHTML = h;
  });
}

/* ═══ 프로젝트 상세: 투입실적 로딩 ═══ */
function pdLoadWork(projId) {
  var wrap = document.getElementById('pdWork');
  if (!wrap) return;
  if (typeof calcHoursByMilestone !== 'function') {
    wrap.innerHTML = '<div style="text-align:center;color:var(--t6);font-size:11px;padding:20px 0">투입실적 데이터를 가져올 수 없습니다.</div>';
    return;
  }
  Promise.all([
    calcHoursByMilestone(projId),
    projGet(projId),
    msGetByProject(projId)
  ]).then(function (results) {
    var msHours = results[0];
    var proj = results[1];
    var milestones = results[2];
    milestones.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    var totalH = 0;
    var personMap = {};
    Object.keys(msHours).forEach(function (mid) {
      var m = msHours[mid];
      totalH += m.hours || 0;
      if (m.people) {
        Object.keys(m.people).forEach(function (p) {
          personMap[p] = (personMap[p] || 0) + m.people[p];
        });
      }
    });

    var h = '';
    // 총 투입시간
    h += '<div style="display:flex;gap:8px;margin-bottom:12px">';
    h += '<div style="flex:1;padding:10px;background:var(--bg-i);border-radius:8px;text-align:center">';
    h += '<div style="font-size:20px;font-weight:700;color:var(--ac)">' + totalH + '<span style="font-size:11px;color:var(--t5)">h</span></div>';
    h += '<div style="font-size:10px;color:var(--t5)">총 투입시간</div></div>';
    if (proj && proj.estimatedHours) {
      var pct = totalH > 0 ? Math.round(totalH / proj.estimatedHours * 100) : 0;
      h += '<div style="flex:1;padding:10px;background:var(--bg-i);border-radius:8px;text-align:center">';
      h += '<div style="font-size:20px;font-weight:700;color:' + (pct > 100 ? '#EF4444' : 'var(--t2)') + '">' + pct + '<span style="font-size:11px;color:var(--t5)">%</span></div>';
      h += '<div style="font-size:10px;color:var(--t5)">예상 대비 (' + proj.estimatedHours + 'h)</div></div>';
    }
    h += '</div>';

    // 인원별 투입
    var persons = Object.keys(personMap).sort(function (a, b) { return personMap[b] - personMap[a]; });
    if (persons.length > 0) {
      h += '<div style="font-size:10px;color:var(--t5);margin-bottom:6px">인원별 투입</div>';
      var maxH = personMap[persons[0]] || 1;
      persons.forEach(function (p) {
        var pH = personMap[p];
        var barW = Math.round(pH / maxH * 100);
        var dn = typeof shortName === 'function' ? shortName(p) : p;
        h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
        h += '<span style="font-size:10px;color:var(--t3);min-width:50px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(dn) + '</span>';
        h += '<div style="flex:1;height:6px;background:var(--bg-i);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + barW + '%;background:var(--ac);border-radius:3px"></div></div>';
        h += '<span style="font-size:10px;color:var(--t5);min-width:30px;text-align:right">' + pH + 'h</span>';
        h += '</div>';
      });
    }

    // 마일스톤별 투입
    if (milestones.length > 0) {
      h += '<div style="font-size:10px;color:var(--t5);margin:12px 0 6px">마일스톤별 투입</div>';
      milestones.forEach(function (m) {
        var mH = msHours[m.id];
        var hrs = mH ? mH.hours : 0;
        var mSt = (typeof PROJ_STATUS !== 'undefined' ? PROJ_STATUS[m.status] : null) || { icon: '⏳', label: m.status, color: '#94A3B8', bg: 'rgba(148,163,184,.15)' };
        h += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--bd)">';
        h += '<span style="font-size:10px">' + mSt.icon + '</span>';
        h += '<span style="flex:1;font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(m.name) + '</span>';
        h += '<span style="font-size:10px;color:var(--ac);font-weight:600">' + hrs + 'h</span>';
        h += '</div>';
      });
    }

    if (totalH === 0 && milestones.length === 0) {
      h = '<div style="text-align:center;color:var(--t6);font-size:11px;padding:20px 0">투입실적 데이터가 없습니다.</div>';
    }

    wrap.innerHTML = h;
  });
}

/* ═══ 단계별 체크리스트 HTML 빌드 ═══ */
function buildPhaseChecklistHtml(projId, phase, allChk, phases) {
  var ph = phases && phases[phase] ? phases[phase] : { label: phase, icon: '', color: '#94A3B8' };
  var items = allChk.filter(function (c) { return c.phase === phase; });
  items.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  var done = items.filter(function (c) { return c.done; }).length;
  var pct = items.length ? Math.round(done / items.length * 100) : 0;

  var h = '<div style="margin-bottom:12px">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
  h += '<span style="font-size:12px;font-weight:700;color:var(--t2)">' + ph.icon + ' ' + ph.label + ' 단계</span>';
  if (items.length > 0) {
    h += '<span style="font-size:10px;color:' + ph.color + ';font-weight:600">' + done + '/' + items.length + ' (' + pct + '%)</span>';
  }
  h += '</div>';

  // 진행률 바
  if (items.length > 0) {
    h += '<div style="height:4px;background:var(--bg-i);border-radius:2px;overflow:hidden;margin-bottom:10px"><div style="height:100%;width:' + pct + '%;background:' + ph.color + ';border-radius:2px;transition:width .3s"></div></div>';
  }

  // 항목들
  if (items.length === 0) {
    h += '<div style="text-align:center;color:var(--t6);font-size:11px;padding:16px 0">체크리스트 항목이 없습니다.<br><button class="btn btn-g btn-s" style="margin-top:6px;font-size:10px" onclick="pdGenerateChecklists(\'' + projId + '\')">기본 체크리스트 생성</button></div>';
  } else {
    h += '<div id="pdChkList" data-projid="' + projId + '" data-phase="' + phase + '">';
    items.forEach(function (item, idx) {
      var checkStyle = item.done ? 'text-decoration:line-through;color:var(--t6)' : 'color:var(--t2)';
      h += '<div class="pdChkItem" draggable="true" data-chkid="' + item.id + '" data-idx="' + idx + '" style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--bd);cursor:grab" ondragstart="pdChkDragStart(event)" ondragover="pdChkDragOver(event)" ondrop="pdChkDrop(event)">';
      h += '<span style="color:var(--t6);font-size:10px;cursor:grab;flex-shrink:0" title="드래그하여 순서 변경">⠿</span>';
      h += '<input type="checkbox" ' + (item.done ? 'checked' : '') + ' onchange="pdToggleCheck(\'' + projId + '\',\'' + item.id + '\')" style="cursor:pointer;flex-shrink:0">';
      h += '<span style="flex:1;font-size:11px;' + checkStyle + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + eH(item.text) + '">' + eH(item.text) + '</span>';
      if (item.doneDate) {
        h += '<span style="font-size:9px;color:var(--t6);white-space:nowrap">' + item.doneDate + '</span>';
      }
      if (item.dueDate && !item.done) {
        var overdue = item.dueDate < localDate();
        h += '<span style="font-size:9px;color:' + (overdue ? '#EF4444' : 'var(--t6)') + ';white-space:nowrap">' + (overdue ? '⚠️' : '') + item.dueDate + '</span>';
      }
      h += '<button style="background:none;border:none;color:var(--t6);cursor:pointer;font-size:10px;padding:0 2px;flex-shrink:0" onclick="pdDeleteCheck(\'' + projId + '\',\'' + item.id + '\')" title="삭제">✕</button>';
      h += '</div>';
    });
    h += '</div>';
  }

  // 항목 추가
  h += '<div style="margin-top:8px;display:flex;gap:4px">';
  h += '<input type="text" id="pdNewChkText" placeholder="새 항목 추가..." style="flex:1;font-size:11px;padding:4px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t2)" onkeydown="if(event.key===\'Enter\')pdAddCheck(\'' + projId + '\',\'' + phase + '\')">';
  h += '<button class="btn btn-g btn-s" style="font-size:10px;padding:4px 8px" onclick="pdAddCheck(\'' + projId + '\',\'' + phase + '\')">추가</button>';
  h += '</div>';

  h += '</div>';
  return h;
}

/* ═══ 체크리스트 인터랙션 ═══ */
function pdToggleCheck(projId, chkId) {
  toggleCheckItem(chkId).then(function () {
    showProjectDetail(projId).then(function () { pdSwitchTab('lifecycle'); });
  });
}

function pdDeleteCheck(projId, chkId) {
  chkDel(chkId).then(function () {
    showProjectDetail(projId).then(function () { pdSwitchTab('lifecycle'); });
  });
}

function pdAddCheck(projId, phase) {
  var inp = document.getElementById('pdNewChkText');
  var text = inp ? inp.value.trim() : '';
  if (!text) return;
  chkGetByPhase(projId, phase).then(function (items) {
    return createCheckItem({ projectId: projId, phase: phase, text: text, order: items.length });
  }).then(function () {
    showProjectDetail(projId).then(function () { pdSwitchTab('lifecycle'); });
  });
}

function pdShowPhase(projId, phase) {
  chkGetByProject(projId).then(function (allChk) {
    var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
    var el = document.getElementById('pdPhaseChecklists');
    if (el) el.innerHTML = buildPhaseChecklistHtml(projId, phase, allChk, phases);
  });
}

function pdGenerateChecklists(projId) {
  chkGetByProject(projId).then(function (existing) {
    if (existing.length > 0) {
      if (!confirm('이미 ' + existing.length + '개 항목이 있습니다. 기본 체크리스트를 추가 생성하시겠습니까?')) return Promise.reject('cancel');
    }
    return createDefaultChecklists(projId);
  }).then(function () {
    showToast('📋 기본 체크리스트 생성 완료', 'success');
    showProjectDetail(projId).then(function () { pdSwitchTab('lifecycle'); });
  }).catch(function (e) { if (e !== 'cancel') console.error(e); });
}

/* ═══ 체크리스트 드래그 순서 변경 ═══ */
var _pdChkDragId = null;

function pdChkDragStart(e) {
  _pdChkDragId = e.currentTarget.getAttribute('data-chkid');
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.4';
  setTimeout(function () { if (e.currentTarget) e.currentTarget.style.opacity = ''; }, 200);
}

function pdChkDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function pdChkDrop(e) {
  e.preventDefault();
  var targetId = e.currentTarget.getAttribute('data-chkid');
  if (!_pdChkDragId || _pdChkDragId === targetId) return;
  var list = document.getElementById('pdChkList');
  if (!list) return;
  var projId = list.getAttribute('data-projid');
  var phase = list.getAttribute('data-phase');

  var items = list.querySelectorAll('.pdChkItem');
  var ids = [];
  for (var i = 0; i < items.length; i++) ids.push(items[i].getAttribute('data-chkid'));
  var fromIdx = ids.indexOf(_pdChkDragId);
  var toIdx = ids.indexOf(targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, _pdChkDragId);

  // 순서 업데이트: 전체 항목 로드 후 매칭
  chkGetByPhase(projId, phase).then(function (allItems) {
    var itemMap = {};
    allItems.forEach(function (it) { itemMap[it.id] = it; });
    var updates = ids.map(function (cid, idx) {
      var item = itemMap[cid];
      if (item) { item.order = idx; return chkPut(item); }
      return Promise.resolve();
    });
    return Promise.all(updates);
  }).then(function () {
    showProjectDetail(projId).then(function () { pdSwitchTab('lifecycle'); });
  });
  _pdChkDragId = null;
}

/* ═══ 단계 전환 (게이트 체크) ═══ */
function pdAdvancePhase(projId, targetPhase) {
  advancePhase(projId, targetPhase).then(function (result) {
    if (!result) return;
    var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
    var toPh = phases[targetPhase] ? phases[targetPhase].label : targetPhase;

    if (!result.gatePass) {
      var prog = result.progress;
      var fromPh = phases[result.fromPhase] ? phases[result.fromPhase].label : result.fromPhase;
      if (!confirm(fromPh + ' 단계 체크리스트가 미완료입니다 (' + prog.done + '/' + prog.total + ').\n그래도 ' + toPh + ' 단계로 전환하시겠습니까?')) return;
    }

    executePhaseTransition(projId, targetPhase).then(function () {
      showToast('➡️ ' + toPh + ' 단계로 전환 완료', 'success');
      showProjectDetail(projId).then(function () { pdSwitchTab('lifecycle'); });
      if (typeof renderPipeline === 'function') renderPipeline();
      if (typeof renderTimeline === 'function') renderTimeline();
    });
  });
}

/* ═══ Integration 5: 진척률 히스토리 차트 ═══ */
var _progressChart = null;

function renderProgressHistoryChart(projectId, proj) {
  getProgressHistory(projectId).then(function (history) {
    var section = document.getElementById('progressHistorySection');
    if (!section) return;

    if (!history.length) {
      section.innerHTML = '<div style="padding:8px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:6px">' +
        '<div style="font-size:10px;color:var(--t5);margin-bottom:4px">📈 진척률 히스토리</div>' +
        '<div style="font-size:10px;color:var(--t6)">아직 기록된 진척률 변화가 없습니다. 아카이브 데이터가 반영되면 자동으로 기록됩니다.</div>' +
      '</div>';
      return;
    }

    var labels = history.map(function (h) { return h.date.slice(5); }); // MM-DD
    var progressData = history.map(function (h) { return h.progress; });
    var hoursData = history.map(function (h) { return h.actualHours || 0; });

    section.innerHTML = '<div style="padding:10px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:6px">' +
      '<div style="font-size:10px;font-weight:600;color:var(--t4);margin-bottom:6px">📈 진척률 히스토리 (' + history.length + '개 기록)</div>' +
      '<canvas id="progressHistoryCanvas" width="340" height="160" style="max-width:100%"></canvas>' +
    '</div>';

    // Chart.js가 로드되었는지 확인
    if (typeof Chart === 'undefined') return;

    var ctx = document.getElementById('progressHistoryCanvas');
    if (!ctx) return;

    // 기존 차트 제거
    if (_progressChart) { try { _progressChart.destroy(); } catch (e) { console.warn('[Timeline]', e); } }

    _progressChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: '진척률 (%)',
            data: progressData,
            borderColor: proj.color || '#3B82F6',
            backgroundColor: (proj.color || '#3B82F6') + '20',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: proj.color || '#3B82F6',
            yAxisID: 'y'
          },
          {
            label: '투입시간 (h)',
            data: hoursData,
            borderColor: '#F59E0B',
            backgroundColor: '#F59E0B20',
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            pointBackgroundColor: '#F59E0B',
            borderDash: [4, 3],
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { font: { size: 9 }, padding: 6, boxWidth: 12 } }
        },
        scales: {
          x: { ticks: { font: { size: 9 }, maxRotation: 45 }, grid: { display: false } },
          y: { min: 0, max: 100, position: 'left', ticks: { font: { size: 9 }, callback: function (v) { return v + '%'; } }, grid: { color: 'rgba(128,128,128,.1)' } },
          y1: { min: 0, position: 'right', ticks: { font: { size: 9 }, callback: function (v) { return v + 'h'; } }, grid: { display: false } }
        }
      }
    });
  });
}

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
  a.download = 'project-data-' + new Date().toISOString().slice(0, 10) + '.json';
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
  var d = new Date(uStart);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
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

  // 프로젝트 행 위치 맵핑
  var projRows = {};
  var rows = scrollEl.querySelectorAll('.tl-row[data-proj-id]');
  rows.forEach(function (row) {
    var pid = row.dataset.projId;
    projRows[pid] = row;
  });

  // SVG 생성
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tl-dep-svg');
  var scrollH = scrollEl.scrollHeight;
  var scrollW = scrollEl.scrollWidth;
  svg.setAttribute('width', scrollW);
  svg.setAttribute('height', scrollH);
  svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:5;overflow:visible';

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
  poly.setAttribute('fill', '#F59E0B');
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

      var fromX = fromBar.offsetLeft + fromBar.offsetWidth + labelW;
      var fromY = fromRow.offsetTop + fromRow.offsetHeight / 2;
      var toX = toBar.offsetLeft + labelW;
      var toY = toRow.offsetTop + toRow.offsetHeight / 2;

      // 곡선 경로
      var midX = fromX + (toX - fromX) / 2;
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M ' + fromX + ' ' + fromY + ' C ' + midX + ' ' + fromY + ' ' + midX + ' ' + toY + ' ' + toX + ' ' + toY);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#F59E0B');
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
      });
    } else if (type === 'ms') {
      // 마일스톤: get → update → put
      (new Promise(function (res, rej) {
        var tx = db.transaction('milestones', 'readonly');
        var req = tx.objectStore('milestones').get(id);
        req.onsuccess = function () { res(req.result); };
        req.onerror = function (e) { rej(e); };
      })).then(function (ms) {
        if (!ms) return;
        ms.startDate = newStart;
        ms.endDate = newEnd;
        return msPut(ms);
      }).then(function () {
        renderTimeline();
        if (typeof renderCalendar === 'function') renderCalendar();
        showToast('기간이 변경되었습니다');
      });
    }
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ═══ Feature 8: 크리티컬 패스 계산 ═══ */
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
        var esDate = new Date(p.startDate);
        esDate.setDate(esDate.getDate() + dur);
        ef[p.id] = esDate.toISOString().slice(0, 10);
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
      // 선행 프로젝트들의 EF 중 최대값이 이 프로젝트의 ES
      var latestPreEF = '';
      (p.dependencies || []).forEach(function (depId) {
        if (ef[depId] && (!latestPreEF || ef[depId] > latestPreEF)) {
          latestPreEF = ef[depId];
        }
      });
      if (latestPreEF && (!es[pid] || latestPreEF > es[pid])) {
        es[pid] = latestPreEF;
      }
      // EF 재계산
      if (es[pid]) {
        var esDate = new Date(es[pid]);
        esDate.setDate(esDate.getDate() + dur);
        ef[pid] = esDate.toISOString().slice(0, 10);
      }
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
      // 이 프로젝트를 선행으로 가지는 프로젝트들의 LS
      var minSuccLS = '';
      projects.forEach(function (succ) {
        if ((succ.dependencies || []).indexOf(pid) >= 0 && ls[succ.id]) {
          if (!minSuccLS || ls[succ.id] < minSuccLS) minSuccLS = ls[succ.id];
        }
      });
      if (minSuccLS) lf[pid] = minSuccLS;
      // LS = LF - duration
      if (lf[pid]) {
        var lfDate = new Date(lf[pid]);
        lfDate.setDate(lfDate.getDate() - dur);
        ls[pid] = lfDate.toISOString().slice(0, 10);
      }
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
  });
}
