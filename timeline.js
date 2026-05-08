/**
 * 업무일지 분석기 — 타임라인(간트) 뷰 모듈
 */

/* ═══ 메모 HTML 헬퍼 (v13.35~) — timeline.js 와 project-detail.js 가 공유 ═══
   주의: core-logic.js 는 현재 HTML 에서 로드되지 않으므로 여기에 정의. */
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

  // 날짜 범위 결정 — 유효한 YYYY-MM-DD 값만 수집
  var DATE_RX = /^\d{4}-\d{2}-\d{2}/;
  var allDates = [];
  projects.forEach(function (p) {
    if (p.startDate && DATE_RX.test(p.startDate)) allDates.push(p.startDate.slice(0, 10));
    if (p.endDate && DATE_RX.test(p.endDate)) allDates.push(p.endDate.slice(0, 10));
  });
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
  window._projMsOrigIds = projMs.map(function (m) { return m.id; });

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
      return '<div class="proj-ms-row" data-msid="' + m.id + '" style="display:grid;grid-template-columns:1fr 110px 110px 90px 30px 30px;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--bd)">' +
        '<input type="text" class="si ms-name" value="' + eH(m.name) + '" style="padding:4px 8px;font-size:11px;padding-left:8px">' +
        '<input type="date" class="si ms-start" value="' + m.startDate + '" style="padding:4px 6px;font-size:10px;padding-left:6px">' +
        '<input type="date" class="si ms-end" value="' + m.endDate + '" style="padding:4px 6px;font-size:10px;padding-left:6px">' +
        '<select class="si ms-status" style="padding:4px 6px;font-size:10px;padding-left:6px">' + Object.keys(PROJ_STATUS).map(function (k) { return '<option value="' + k + '"' + (m.status === k ? ' selected' : '') + '>' + PROJ_STATUS[k].label + '</option>'; }).join('') + '</select>' +
        '<button class="btn btn-g btn-s" title="다른 프로젝트로 이관" onclick="showMilestoneTransferModal(\'' + m.id + '\')" style="padding:2px 4px;font-size:11px">↪</button>' +
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
      // 가시성: 본인만(private) / 부서(dept) / 테넌트 전체(tenant)
      '<div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;align-items:end">' +
        '<div><label class="fl">가시성</label><select class="si" id="projVisibility" style="padding-left:8px;font-size:11px">' +
          ['private','dept','tenant'].map(function (v) {
            var labels = { 'private':'🔒 비공개 (본인+공유 사용자)', 'dept':'🏢 부서 공개', 'tenant':'🌐 전체 공개' };
            var cur = proj && proj.visibility ? proj.visibility : 'private';
            return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + labels[v] + '</option>';
          }).join('') +
        '</select></div>' +
        (proj ? '<div style="display:flex;gap:6px;justify-content:flex-end">' +
          '<button class="btn btn-g btn-s" style="font-size:10px" onclick="showProjectShareModal(\'' + proj.id + '\')">👥 공유 관리</button>' +
          '<button class="btn btn-g btn-s" style="font-size:10px" onclick="showProjectTransferModal(\'' + proj.id + '\')">↪ 소유권 이관</button>' +
        '</div>' : '<div style="font-size:10px;color:var(--t6);align-self:center">등록 후 공유 사용자 추가 가능</div>') +
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
      // 메모 — contenteditable로 인라인 이미지 지원 (v13.35~)
      '<div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
          '<label class="fl" style="margin:0">메모</label>' +
          '<div style="display:flex;gap:4px">' +
            '<button type="button" class="btn btn-g btn-s" style="font-size:10px;padding:3px 8px" onclick="memoInsertImagePicker()" title="이미지 파일 선택">🖼 이미지 추가</button>' +
            '<span style="font-size:9px;color:var(--t6);align-self:center" title="붙여넣기/드래그로도 가능. 이미지당 5MB 이하 권장">붙여넣기·드래그 가능</span>' +
          '</div>' +
        '</div>' +
        '<div id="projMemo" contenteditable="true" class="si" ' +
          'onpaste="memoPasteHandler(event)" ondragover="event.preventDefault();this.style.borderColor=\'var(--ac)\'" ondragleave="this.style.borderColor=\'\'" ondrop="memoDropHandler(event)" ' +
          'style="padding:10px;resize:vertical;min-height:240px;max-height:500px;overflow:auto;white-space:pre-wrap;word-break:break-word"' +
        '>' + (proj ? memoToHtml(proj.memo) : '') + '</div>' +
      '</div>' +
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
  var orderNo = document.getElementById('projOrderNo').value.trim();
  // 프로젝트명이 없으면 수주번호로 대체, 둘 다 없으면 '미정'
  if (!name) name = orderNo || '미정 프로젝트';

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
    memo: (function () {
      var el = document.getElementById('projMemo');
      if (!el) return '';
      // contenteditable의 innerHTML을 sanitize 후 저장. 비어있으면 빈 문자열.
      var html = (el.innerHTML || '').trim();
      // <br> 또는 빈 <div> 만 있는 경우 빈 문자열로 정규화
      if (/^(<br\s*\/?>|<div><br\s*\/?><\/div>|&nbsp;|\s)*$/i.test(html)) return '';
      return typeof sanitizeMemo === 'function' ? sanitizeMemo(html) : html;
    })(),
    visibility: visibilityEl ? visibilityEl.value : 'private'
  };

  var projId;
  try {
    if (existingId) {
      await updateProject(existingId, data);
      projId = existingId;
    } else {
      var p = await createProject(data);
      if (!p || !p.id) { showToast('프로젝트 저장 실패: DB 연결을 확인하세요.','warn'); return; }
      projId = p.id;
    }

    // 마일스톤 diff 기반 동기화 (destroy-recreate 제거 → 중복 방지)
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
      if (existingMsId && origIds.indexOf(existingMsId) >= 0) {
        keptIds[existingMsId] = true;
        msPromises.push(msPut({ id: existingMsId, projectId: projId, name: msName, startDate: msStart, endDate: msEnd, status: msStatus, order: i }));
      } else {
        msPromises.push(createMilestone({ projectId: projId, name: msName, startDate: msStart, endDate: msEnd, status: msStatus, order: i }));
      }
    }
    // 제거된 마일스톤 삭제
    origIds.forEach(function (id) { if (!keptIds[id]) msPromises.push(msDel(id).catch(function () {})); });
    await Promise.all(msPromises);
    window._projMsOrigIds = null;

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
    var detail = '';
    if (err && err.data) {
      if (err.data.error === 'CONFLICT') detail = '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.';
      else detail = err.data.message || err.data.error || '';
    }
    var msg = detail || err.message || String(err);
    showToast('프로젝트 저장 실패: ' + msg + (err && err.status ? ' (HTTP ' + err.status + ')' : ''), 'error');
  }
}

/* ═══ 프로젝트 공유 관리 모달 ═══ */
async function showProjectShareModal(projId) {
  var existing = document.getElementById('projShareModal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'projShareModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
  modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
  modal.innerHTML = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;width:520px;max-width:95%;max-height:80vh;overflow:auto">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
      '<h3 style="font-size:14px;font-weight:700;color:var(--t1)">👥 공유 사용자 관리</h3>' +
      '<button class="btn btn-g btn-s" onclick="document.getElementById(\'projShareModal\').remove()">✕</button>' +
    '</div>' +
    '<div id="projShareBody" style="font-size:11px;color:var(--t4)">로딩 중...</div>' +
  '</div>';
  document.body.appendChild(modal);

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
    document.getElementById('projShareBody').innerHTML = '<div style="color:#EF4444">로드 실패: ' + (err && err.message ? err.message : err) + '</div>';
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
  var existing = document.getElementById('projTransferModal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'projTransferModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
  modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
  modal.innerHTML = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;width:480px;max-width:95%">' +
    '<h3 style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:12px">↪ 소유권 이관</h3>' +
    '<div id="projTransferBody" style="font-size:11px;color:var(--t4)">로딩 중...</div>' +
  '</div>';
  document.body.appendChild(modal);

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
    document.getElementById('projTransferBody').innerHTML = '<div style="color:#EF4444">로드 실패: ' + (err && err.message ? err.message : err) + '</div>';
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
  var existing = document.getElementById('msTransferModal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'msTransferModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
  modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
  modal.innerHTML = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;width:480px;max-width:95%">' +
    '<h3 style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:12px">↪ 마일스톤 이관</h3>' +
    '<div id="msTransferBody" style="font-size:11px;color:var(--t4)">로딩 중...</div>' +
  '</div>';
  document.body.appendChild(modal);

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
    document.getElementById('msTransferBody').innerHTML = '<div style="color:#EF4444">로드 실패: ' + (err && err.message ? err.message : err) + '</div>';
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
      }).catch(function (err) {
          console.error('[startBarDrag:proj]', err);
          if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
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
        if (!isNaN(esDate.getTime())) {
          esDate.setDate(esDate.getDate() + dur);
          ef[p.id] = esDate.toISOString().slice(0, 10);
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
        if (!isNaN(esDate.getTime())) {
          esDate.setDate(esDate.getDate() + dur);
          ef[pid] = esDate.toISOString().slice(0, 10);
        }
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
        if (!isNaN(lfDate.getTime())) {
          lfDate.setDate(lfDate.getDate() - dur);
          ls[pid] = lfDate.toISOString().slice(0, 10);
        }
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
  }).catch(function (err) {
      console.error('[runSuggestMilestones]', err);
      if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

/* ═══ 메모 이미지 삽입 핸들러 (v13.35~) ═══ */
var MEMO_IMG_MAX_BYTES = 5 * 1024 * 1024; // 5MB per image (base64 임베드)

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

function _memoInsertImageFromFile(file) {
  if (!file || !/^image\//.test(file.type)) {
    if (typeof showToast === 'function') showToast('이미지 파일이 아닙니다', 'warn');
    return;
  }
  if (file.size > MEMO_IMG_MAX_BYTES) {
    if (typeof showToast === 'function') showToast('이미지가 너무 큽니다 (' + Math.round(file.size / 1024 / 1024) + 'MB) — 5MB 이하 권장', 'warn');
  }
  var reader = new FileReader();
  reader.onload = function (e) {
    var dataUrl = e.target.result;
    var alt = (file.name || 'image').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    _memoInsertHtmlAtCursor('<img src="' + dataUrl + '" alt="' + alt + '" style="max-width:100%;border-radius:4px;display:block;margin:6px 0">');
  };
  reader.onerror = function () {
    if (typeof showToast === 'function') showToast('이미지 읽기 실패', 'error');
  };
  reader.readAsDataURL(file);
}

function memoInsertImagePicker() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = function (e) {
    var files = e.target.files || [];
    for (var i = 0; i < files.length; i++) _memoInsertImageFromFile(files[i]);
  };
  input.click();
}

function memoPasteHandler(e) {
  var items = (e.clipboardData && e.clipboardData.items) || [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf('image/') === 0) {
      var f = items[i].getAsFile();
      if (f) {
        e.preventDefault();
        _memoInsertImageFromFile(f);
        return;
      }
    }
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
  for (var i = 0; i < files.length; i++) {
    if (/^image\//.test(files[i].type)) _memoInsertImageFromFile(files[i]);
  }
}

