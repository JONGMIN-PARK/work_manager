/**
 * 업무 관리자 — 이슈 관리 모듈 (v8.2)
 * 이슈 대장 테이블, 등록/편집 모달, 상세 패널, 대응 이력, 통계
 */

/* ═══ 상태 변수 ═══ */
var _issueTrendChart = null;
var issueBulkSelected = {};
var issueSortKey = 'reportDate';
var issueSortAsc = false;
var issueFilterPhase = '';
var issueFilterDept = '';
var issueFilterType = '';
var issueFilterStatus = '';
var issueFilterUrgency = '';
var issueFilterProject = '';
var issueSearchKw = '';
var issueShowStats = false;

/* 대응 이력 유형 아이콘 */
var LOG_TYPE_ICON = {
  '접수': '📞', '원인분석': '🔍', '원격대응': '🖥️', '현장출동': '🔧',
  '부품교체': '🔩', '설계변경': '📐', '완료': '✅', '협의': '💬', '기타': '📝'
};
var LOG_TYPES = ['접수', '원인분석', '원격대응', '현장출동', '부품교체', '설계변경', '협의', '완료', '기타'];

/* ═══ 메인 렌더링 ═══ */
function renderIssues() {
  var wrap = document.getElementById('issuesWrap');
  if (!wrap) return;

  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  var depts = typeof DEPT !== 'undefined' ? DEPT : {};
  var types = typeof ISSUE_TYPE !== 'undefined' ? ISSUE_TYPE : {};
  var statuses = typeof ISSUE_STATUS !== 'undefined' ? ISSUE_STATUS : {};
  var urgencies = typeof ISSUE_URGENCY !== 'undefined' ? ISSUE_URGENCY : {};

  Promise.all([issueGetAll(), projGetAll(), orderGetAll()]).then(function (results) {
    var allIssues = results[0] || [];
    var projects = results[1] || [];
    var orders = results[2] || [];

    // 프로젝트 맵
    var projMap = {};
    projects.forEach(function (p) { projMap[p.id] = p; });

    // 필터 적용
    var issues = allIssues.filter(function (iss) {
      if (issueFilterPhase && iss.phase !== issueFilterPhase) return false;
      if (issueFilterDept && iss.dept !== issueFilterDept) return false;
      if (issueFilterType && iss.type !== issueFilterType) return false;
      if (issueFilterStatus && iss.status !== issueFilterStatus) return false;
      if (issueFilterUrgency && iss.urgency !== issueFilterUrgency) return false;
      if (issueFilterProject && iss.projectId !== issueFilterProject) return false;
      if (issueSearchKw) {
        var kw = issueSearchKw.toLowerCase();
        if ((iss.title || '').toLowerCase().indexOf(kw) < 0 &&
            (iss.description || '').toLowerCase().indexOf(kw) < 0) return false;
      }
      return true;
    });

    // 정렬
    issues.sort(function (a, b) {
      var va = a[issueSortKey] || '', vb = b[issueSortKey] || '';
      if (issueSortKey === 'urgency') {
        var uOrder = { urgent: 0, normal: 1, low: 2 };
        va = uOrder[va] !== undefined ? uOrder[va] : 9;
        vb = uOrder[vb] !== undefined ? uOrder[vb] : 9;
      }
      var cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return issueSortAsc ? cmp : -cmp;
    });

    // 통계 계산
    var openCnt = 0, urgentCnt = 0, inProgCnt = 0, resolvedCnt = 0;
    allIssues.forEach(function (iss) {
      if (iss.status === 'open') openCnt++;
      if (iss.status === 'inProgress') inProgCnt++;
      if (iss.status === 'resolved' || iss.status === 'closed') resolvedCnt++;
      if (iss.urgency === 'urgent' && iss.status !== 'closed' && iss.status !== 'resolved') urgentCnt++;
    });

    var html = '';

    // ─── 상단 컨트롤 바 ───
    html += '<div class="pnl" style="margin-bottom:12px;padding:14px 18px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
    html += '<div style="display:flex;align-items:center;gap:10px">';
    html += '<span style="font-size:13px;font-weight:700;color:var(--t2)">🎫 이슈 관리</span>';
    html += '<span style="font-size:11px;color:var(--t5)">전체 ' + allIssues.length + '건' + (issues.length !== allIssues.length ? ' (필터: ' + issues.length + '건)' : '') + '</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:6px">';
    html += '<button onclick="showIssueModal()" style="font-size:11px;padding:4px 12px;border:none;border-radius:6px;background:#6366F1;color:#fff;cursor:pointer;font-weight:600">+ 등록</button>';
    html += '<button onclick="issueToggleStats()" style="font-size:11px;padding:4px 12px;border:1px solid var(--bd);border-radius:6px;background:' + (issueShowStats ? 'var(--accent)' : 'var(--bg-i)') + ';color:' + (issueShowStats ? '#fff' : 'var(--t3)') + ';cursor:pointer">📊 통계</button>';
    html += '<button onclick="exportIssueExcel()" style="font-size:11px;padding:4px 12px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer">📥 내보내기</button>';
    html += '</div></div></div>';

    // ─── 요약 카드 ───
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">';
    html += issueStatCard('접수', openCnt, '#6366F1');
    html += issueStatCard('긴급', urgentCnt, '#EF4444');
    html += issueStatCard('대응중', inProgCnt, '#3B82F6');
    html += issueStatCard('해결/종결', resolvedCnt, '#10B981');
    html += '</div>';

    // ─── 필터 바 ───
    html += '<div class="pnl" style="margin-bottom:12px;padding:10px 14px">';
    html += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">';
    html += issueFilterSelect('단계', 'issueFilterPhase', issueFilterPhase, phases);
    html += issueFilterSelect('부서', 'issueFilterDept', issueFilterDept, depts);
    html += issueFilterSelect('유형', 'issueFilterType', issueFilterType, types);
    html += issueFilterSelect('상태', 'issueFilterStatus', issueFilterStatus, statuses);
    html += issueFilterSelect('긴급도', 'issueFilterUrgency', issueFilterUrgency, urgencies);
    // 프로젝트 필터
    html += '<select onchange="issueFilterProject=this.value;renderIssues()" style="font-size:10px;padding:3px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3)">';
    html += '<option value="">전체 프로젝트</option>';
    projects.forEach(function (p) {
      html += '<option value="' + p.id + '"' + (issueFilterProject === p.id ? ' selected' : '') + '>' + eH(p.name) + '</option>';
    });
    html += '</select>';
    // 키워드 검색
    html += '<input type="text" placeholder="🔍 검색..." value="' + eH(issueSearchKw) + '" oninput="issueSearchKw=this.value;renderIssues()" style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3);width:120px">';
    if (issueFilterPhase || issueFilterDept || issueFilterType || issueFilterStatus || issueFilterUrgency || issueFilterProject || issueSearchKw) {
      html += '<button onclick="issueClearFilters()" style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t5);cursor:pointer">✕ 초기화</button>';
    }
    html += '</div></div>';

    // ─── 테이블 ───
    html += '<div class="pnl" style="padding:0;overflow-x:auto">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="background:var(--bg-i);border-bottom:2px solid var(--bd)">';
    html += '<th style="padding:8px 6px;width:32px"><input type="checkbox" id="issueBulkAll" onclick="issueToggleAllBulk()" title="전체 선택"></th>';
    var cols = [
      { key: 'seq', label: '#', w: '40px' },
      { key: 'reportDate', label: '등록일', w: '75px' },
      { key: 'project', label: '프로젝트', w: '120px' },
      { key: 'phase', label: '단계', w: '60px' },
      { key: 'dept', label: '부서', w: '70px' },
      { key: 'type', label: '유형', w: '70px' },
      { key: 'urgency', label: '긴급도', w: '55px' },
      { key: 'status', label: '상태', w: '60px' },
      { key: 'title', label: '제목', w: '' },
      { key: 'actions', label: '', w: '60px' }
    ];
    cols.forEach(function (c) {
      var sortable = c.key !== 'seq' && c.key !== 'actions' && c.key !== 'project';
      var arrow = issueSortKey === c.key ? (issueSortAsc ? ' ▲' : ' ▼') : '';
      var cursor = sortable ? 'cursor:pointer' : '';
      var onclick = sortable ? ' onclick="issueSort(\'' + c.key + '\')"' : '';
      html += '<th style="padding:8px 6px;text-align:left;font-size:10px;color:var(--t5);font-weight:600;white-space:nowrap;' + (c.w ? 'width:' + c.w + ';' : '') + cursor + '"' + onclick + '>' + c.label + arrow + '</th>';
    });
    html += '</tr></thead><tbody>';

    if (issues.length === 0) {
      html += '<tr><td colspan="11" style="padding:40px;text-align:center;color:var(--t6)">';
      html += allIssues.length === 0 ? '등록된 이슈가 없습니다. <button onclick="showIssueModal()" style="border:none;background:none;color:#6366F1;cursor:pointer;text-decoration:underline">첫 이슈 등록</button>' : '필터 조건에 맞는 이슈가 없습니다.';
      html += '</td></tr>';
    }

    issues.forEach(function (iss, idx) {
      var proj = projMap[iss.projectId];
      var projName = proj ? proj.name : (iss.orderNo || '-');
      var ph = phases[iss.phase] || { label: iss.phase, icon: '', color: '#94A3B8' };
      var dp = depts[iss.dept] || { label: iss.dept, icon: '', color: '#94A3B8' };
      var tp = types[iss.type] || { label: iss.type, icon: '', color: '#94A3B8' };
      var ug = urgencies[iss.urgency] || { label: iss.urgency, icon: '', color: '#94A3B8' };
      var st = statuses[iss.status] || { label: iss.status, color: '#94A3B8' };
      var isUrgent = iss.urgency === 'urgent' && iss.status !== 'closed' && iss.status !== 'resolved';
      var rowBg = isUrgent ? 'rgba(239,68,68,.05)' : 'transparent';
      var safeId = iss.id.replace(/'/g, "\\'");

      var isChecked = issueBulkSelected[iss.id] ? ' checked' : '';
      html += '<tr style="border-bottom:1px solid var(--bd);background:' + rowBg + ';cursor:pointer" onclick="showIssueDetail(\'' + safeId + '\')" title="' + eH(iss.title) + '">';
      html += '<td style="padding:6px" onclick="event.stopPropagation()"><input type="checkbox" data-bulk-id="' + eH(iss.id) + '" onclick="issueToggleBulk(\'' + safeId + '\')" ' + isChecked + '></td>';
      html += '<td style="padding:6px;color:var(--t5);font-size:10px">' + (idx + 1) + '</td>';
      html += '<td style="padding:6px;color:var(--t3);white-space:nowrap">' + (iss.reportDate || '').slice(5) + '</td>';
      html += '<td style="padding:6px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2)">' + eH(projName) + '</td>';
      html += '<td style="padding:6px"><span style="font-size:10px;padding:1px 6px;border-radius:8px;background:' + ph.color + '22;color:' + ph.color + ';white-space:nowrap">' + ph.icon + ' ' + ph.label + '</span></td>';
      html += '<td style="padding:6px"><span style="font-size:10px;padding:1px 6px;border-radius:8px;background:' + dp.color + '22;color:' + dp.color + ';white-space:nowrap">' + dp.icon + ' ' + dp.label + '</span></td>';
      html += '<td style="padding:6px"><span style="font-size:10px;white-space:nowrap">' + tp.icon + ' ' + tp.label + '</span></td>';
      html += '<td style="padding:6px"><span style="font-size:10px;white-space:nowrap">' + ug.icon + ' ' + ug.label + '</span></td>';
      html += '<td style="padding:6px"><span style="font-size:10px;padding:1px 6px;border-radius:8px;background:' + st.color + '22;color:' + st.color + ';font-weight:600;white-space:nowrap">' + st.label + '</span></td>';
      html += '<td style="padding:6px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t1);font-weight:500">' + eH(iss.title) + '</td>';
      html += '<td style="padding:6px;white-space:nowrap" onclick="event.stopPropagation()">';
      html += '<button onclick="showIssueModal(\'' + safeId + '\')" style="font-size:10px;border:none;background:none;color:var(--t5);cursor:pointer" title="편집">✏️</button>';
      html += '<button onclick="confirmDeleteIssue(\'' + safeId + '\')" style="font-size:10px;border:none;background:none;color:var(--t5);cursor:pointer" title="삭제">🗑️</button>';
      html += '</td></tr>';
    });

    html += '</tbody></table></div>';

    // ─── 통계 패널 ───
    if (issueShowStats) {
      html += buildIssueStats(allIssues, projMap, phases, depts, types, statuses, urgencies);
      html += '<div class="pnl" style="margin-top:12px;padding:18px"><div style="font-size:13px;font-weight:700;color:var(--t2);margin-bottom:12px">📈 월별 이슈 트렌드 (최근 6개월)</div><canvas id="issueTrendCanvas" height="80"></canvas></div>';
    }

    wrap.innerHTML = html;

    // ─── 일괄 작업 바 렌더 ───
    renderIssueBulkBar();

    // ─── 트렌드 차트 렌더 ───
    if (issueShowStats && typeof Chart !== 'undefined') {
      if (_issueTrendChart) { _issueTrendChart.destroy(); _issueTrendChart = null; }
      renderIssueTrendChart(allIssues);
    }
  });
}

/* ═══ 이슈 트렌드 차트 ═══ */
function renderIssueTrendChart(issues) {
  var canvas = document.getElementById('issueTrendCanvas');
  if (!canvas) return;

  // 최근 6개월 레이블 생성
  var labels = [];
  var monthKeys = [];
  var today = new Date();
  for (var i = 5; i >= 0; i--) {
    var d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    monthKeys.push(key);
    labels.push(String(d.getMonth() + 1) + '월');
  }

  var openData = [];
  var closeData = [];
  monthKeys.forEach(function (mk) {
    var opened = 0, closed = 0;
    issues.forEach(function (iss) {
      if (iss.reportDate && iss.reportDate.slice(0, 7) === mk) opened++;
      if (iss.resolvedDate && iss.resolvedDate.slice(0, 7) === mk) closed++;
    });
    openData.push(opened);
    closeData.push(closed);
  });

  _issueTrendChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '접수',
          data: openData,
          borderColor: '#6366F1',
          backgroundColor: 'rgba(99,102,241,0.15)',
          tension: 0.3,
          fill: true,
          pointRadius: 4
        },
        {
          label: '해결',
          data: closeData,
          borderColor: '#10B981',
          backgroundColor: 'rgba(16,185,129,0.1)',
          tension: 0.3,
          fill: true,
          pointRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { font: { size: 11 }, color: '#94A3B8' } }
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94A3B8' }, grid: { color: 'rgba(148,163,184,0.15)' } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#94A3B8', stepSize: 1 }, grid: { color: 'rgba(148,163,184,0.15)' } }
      }
    }
  });
}

/* ═══ 유틸 함수 ═══ */
function issueStatCard(label, count, color) {
  return '<div class="pnl" style="padding:12px;text-align:center">' +
    '<div style="font-size:22px;font-weight:700;color:' + color + '">' + count + '</div>' +
    '<div style="font-size:10px;color:var(--t5);margin-top:2px">' + label + '</div></div>';
}

function issueFilterSelect(label, varName, curVal, options) {
  var h = '<select onchange="' + varName + '=this.value;renderIssues()" style="font-size:10px;padding:3px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3)">';
  h += '<option value="">전체 ' + label + '</option>';
  var keys = Object.keys(options);
  keys.forEach(function (k) {
    var o = options[k];
    h += '<option value="' + k + '"' + (curVal === k ? ' selected' : '') + '>' + (o.icon || '') + ' ' + o.label + '</option>';
  });
  h += '</select>';
  return h;
}

function issueSort(key) {
  if (issueSortKey === key) { issueSortAsc = !issueSortAsc; }
  else { issueSortKey = key; issueSortAsc = key === 'title'; }
  renderIssues();
}

function issueClearFilters() {
  issueFilterPhase = '';
  issueFilterDept = '';
  issueFilterType = '';
  issueFilterStatus = '';
  issueFilterUrgency = '';
  issueFilterProject = '';
  issueSearchKw = '';
  renderIssues();
}

function issueToggleStats() {
  issueShowStats = !issueShowStats;
  renderIssues();
}

/* ═══ 이슈 등록/편집 모달 ═══ */
function showIssueModal(editId) {
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  var depts = typeof DEPT !== 'undefined' ? DEPT : {};
  var types = typeof ISSUE_TYPE !== 'undefined' ? ISSUE_TYPE : {};
  var urgencies = typeof ISSUE_URGENCY !== 'undefined' ? ISSUE_URGENCY : {};

  Promise.all([projGetAll(), editId ? issueGet(editId) : Promise.resolve(null)]).then(function (results) {
    var projects = results[0] || [];
    var existing = results[1];
    var isEdit = !!existing;
    var iss = existing || {};

    var overlay = document.createElement('div');
    overlay.id = 'issueModalOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

    var dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-p);border-radius:12px;padding:24px;max-width:600px;width:90%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)';

    var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    h += '<span style="font-size:14px;font-weight:700;color:var(--t1)">' + (isEdit ? '이슈 편집' : '이슈 등록') + '</span>';
    h += '<button onclick="document.getElementById(\'issueModalOverlay\').remove()" style="border:none;background:none;font-size:18px;cursor:pointer;color:var(--t5)">✕</button>';
    h += '</div>';

    // 프로젝트
    h += '<div style="margin-bottom:10px"><label style="font-size:10px;color:var(--t5);font-weight:600">프로젝트 *</label>';
    h += '<select id="issModalProj" onchange="issueModalAutoPhase()" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;margin-top:4px">';
    h += '<option value="">선택...</option>';
    projects.forEach(function (p) {
      var sel = iss.projectId === p.id ? ' selected' : '';
      h += '<option value="' + p.id + '" data-phase="' + (p.currentPhase || 'order') + '" data-orderno="' + eH(p.orderNo || '') + '"' + sel + '>' + eH(p.name) + (p.orderNo ? ' (' + eH(p.orderNo) + ')' : '') + '</option>';
    });
    h += '</select></div>';

    // 단계 + 부서 (2열)
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
    h += '<div><label style="font-size:10px;color:var(--t5);font-weight:600">단계 *</label>';
    h += '<select id="issModalPhase" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;margin-top:4px">';
    Object.keys(phases).forEach(function (k) {
      var sel = (iss.phase || 'order') === k ? ' selected' : '';
      h += '<option value="' + k + '"' + sel + '>' + phases[k].icon + ' ' + phases[k].label + '</option>';
    });
    h += '</select></div>';
    h += '<div><label style="font-size:10px;color:var(--t5);font-weight:600">부서 *</label>';
    h += '<select id="issModalDept" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;margin-top:4px">';
    h += '<option value="">선택...</option>';
    Object.keys(depts).forEach(function (k) {
      var sel = iss.dept === k ? ' selected' : '';
      h += '<option value="' + k + '"' + sel + '>' + depts[k].icon + ' ' + depts[k].label + '</option>';
    });
    h += '</select></div></div>';

    // 유형 + 긴급도 (2열)
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
    h += '<div><label style="font-size:10px;color:var(--t5);font-weight:600">유형 *</label>';
    h += '<select id="issModalType" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;margin-top:4px">';
    Object.keys(types).forEach(function (k) {
      var sel = (iss.type || 'etc') === k ? ' selected' : '';
      h += '<option value="' + k + '"' + sel + '>' + types[k].icon + ' ' + types[k].label + '</option>';
    });
    h += '</select></div>';
    h += '<div><label style="font-size:10px;color:var(--t5);font-weight:600">긴급도 *</label>';
    h += '<select id="issModalUrgency" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;margin-top:4px">';
    Object.keys(urgencies).forEach(function (k) {
      var sel = (iss.urgency || 'normal') === k ? ' selected' : '';
      h += '<option value="' + k + '"' + sel + '>' + urgencies[k].icon + ' ' + urgencies[k].label + '</option>';
    });
    h += '</select></div></div>';

    // 등록일 + 대응기한 (2열)
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
    h += '<div><label style="font-size:10px;color:var(--t5);font-weight:600">등록일 *</label>';
    h += '<input type="date" id="issModalDate" value="' + (iss.reportDate || localDate()) + '" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;margin-top:4px"></div>';
    h += '<div><label style="font-size:10px;color:var(--t5);font-weight:600">대응기한</label>';
    h += '<input type="date" id="issModalDueDate" value="' + (iss.dueDate || '') + '" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;margin-top:4px"></div>';
    h += '</div>';

    // 제목
    h += '<div style="margin-bottom:10px"><label style="font-size:10px;color:var(--t5);font-weight:600">제목 *</label>';
    h += '<input type="text" id="issModalTitle" value="' + eH(iss.title || '') + '" placeholder="이슈 제목" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;margin-top:4px;box-sizing:border-box"></div>';

    // 상세 내용
    h += '<div style="margin-bottom:10px"><label style="font-size:10px;color:var(--t5);font-weight:600">상세 내용</label>';
    h += '<textarea id="issModalDesc" rows="3" placeholder="증상, 재현 방법, 영향 범위 등" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;margin-top:4px;resize:vertical;box-sizing:border-box">' + eH(iss.description || '') + '</textarea></div>';

    // 보고자 + 담당자 (2열)
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
    h += '<div><label style="font-size:10px;color:var(--t5);font-weight:600">보고자</label>';
    h += '<input type="text" id="issModalReporter" value="' + eH(iss.reporter || '') + '" placeholder="발견자" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;margin-top:4px;box-sizing:border-box"></div>';
    h += '<div><label style="font-size:10px;color:var(--t5);font-weight:600">담당자</label>';
    h += '<input type="text" id="issModalAssignees" value="' + eH((iss.assignees || []).join(', ')) + '" placeholder="쉼표로 구분" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;margin-top:4px;box-sizing:border-box"></div>';
    h += '</div>';

    // 태그
    h += '<div style="margin-bottom:16px"><label style="font-size:10px;color:var(--t5);font-weight:600">태그</label>';
    h += '<input type="text" id="issModalTags" value="' + eH((iss.tags || []).join(', ')) + '" placeholder="키워드 태그 (쉼표 구분)" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;margin-top:4px;box-sizing:border-box"></div>';

    // 저장 버튼
    h += '<div style="display:flex;gap:8px;justify-content:flex-end">';
    h += '<button onclick="document.getElementById(\'issueModalOverlay\').remove()" style="padding:8px 16px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer;font-size:11px">취소</button>';
    h += '<button onclick="saveIssueModal(' + (isEdit ? 'true' : 'false') + ',\'' + (isEdit ? editId.replace(/'/g, "\\'") : '') + '\')" style="padding:8px 16px;border:none;border-radius:6px;background:#6366F1;color:#fff;cursor:pointer;font-size:11px;font-weight:600">' + (isEdit ? '수정' : '등록') + '</button>';
    h += '</div>';

    dialog.innerHTML = h;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

function issueModalAutoPhase() {
  var sel = document.getElementById('issModalProj');
  if (!sel) return;
  var opt = sel.options[sel.selectedIndex];
  if (opt && opt.dataset.phase) {
    var phSel = document.getElementById('issModalPhase');
    if (phSel) phSel.value = opt.dataset.phase;
  }
}

function saveIssueModal(isEdit, editId) {
  var projId = document.getElementById('issModalProj').value;
  var phase = document.getElementById('issModalPhase').value;
  var dept = document.getElementById('issModalDept').value;
  var type = document.getElementById('issModalType').value;
  var urgency = document.getElementById('issModalUrgency').value;
  var reportDate = document.getElementById('issModalDate').value;
  var dueDate = document.getElementById('issModalDueDate').value;
  var title = document.getElementById('issModalTitle').value.trim();
  var description = document.getElementById('issModalDesc').value.trim();
  var reporter = document.getElementById('issModalReporter').value.trim();
  var assigneesStr = document.getElementById('issModalAssignees').value.trim();
  var tagsStr = document.getElementById('issModalTags').value.trim();

  if (!projId) { alert('프로젝트를 선택하세요.'); return; }
  if (!dept) { alert('부서를 선택하세요.'); return; }
  if (!title) { alert('제목을 입력하세요.'); return; }

  var assignees = assigneesStr ? assigneesStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
  var tags = tagsStr ? tagsStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];

  // orderNo 가져오기
  var projSel = document.getElementById('issModalProj');
  var opt = projSel.options[projSel.selectedIndex];
  var orderNo = opt ? (opt.dataset.orderno || '') : '';

  var data = {
    projectId: projId, orderNo: orderNo, phase: phase, dept: dept,
    type: type, urgency: urgency, reportDate: reportDate, dueDate: dueDate || '',
    title: title, description: description, reporter: reporter,
    assignees: assignees, tags: tags
  };

  var promise;
  if (isEdit && editId) {
    promise = updateIssue(editId, data);
  } else {
    promise = createIssue(data);
  }

  promise.then(function (savedIssue) {
    var overlay = document.getElementById('issueModalOverlay');
    if (overlay) overlay.remove();
    showToast(isEdit ? '이슈가 수정되었습니다.' : '이슈가 등록되었습니다.');
    // 반복 이슈 감지
    if (!isEdit && savedIssue) {
      detectRepeatIssue(savedIssue);
    }
    renderIssues();
  });
}

function confirmDeleteIssue(id) {
  if (!confirm('이 이슈와 모든 대응 이력을 삭제하시겠습니까?')) return;
  deleteIssueCascade(id).then(function () {
    showToast('이슈가 삭제되었습니다.');
    // 상세 패널도 닫기
    var panel = document.getElementById('issueDetailPanel');
    if (panel) panel.remove();
    renderIssues();
  });
}

/* ═══ 이슈 상세 패널 ═══ */
function showIssueDetail(id) {
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  var depts = typeof DEPT !== 'undefined' ? DEPT : {};
  var types = typeof ISSUE_TYPE !== 'undefined' ? ISSUE_TYPE : {};
  var statuses = typeof ISSUE_STATUS !== 'undefined' ? ISSUE_STATUS : {};
  var urgencies = typeof ISSUE_URGENCY !== 'undefined' ? ISSUE_URGENCY : {};

  Promise.all([issueGet(id), issueLogGetByIssue(id), projGetAll()]).then(function (results) {
    var iss = results[0];
    var logs = results[1] || [];
    var projects = results[2] || [];
    if (!iss) return;

    var projMap = {};
    projects.forEach(function (p) { projMap[p.id] = p; });
    var proj = projMap[iss.projectId];
    var projName = proj ? proj.name : (iss.orderNo || '-');

    var ph = phases[iss.phase] || { label: iss.phase, icon: '', color: '#94A3B8' };
    var dp = depts[iss.dept] || { label: iss.dept, icon: '', color: '#94A3B8' };
    var tp = types[iss.type] || { label: iss.type, icon: '', color: '#94A3B8' };
    var ug = urgencies[iss.urgency] || { label: iss.urgency, icon: '', color: '#94A3B8' };
    var st = statuses[iss.status] || { label: iss.status, color: '#94A3B8' };

    // 기존 패널 제거
    var old = document.getElementById('issueDetailPanel');
    if (old) old.remove();

    var panel = document.createElement('div');
    panel.id = 'issueDetailPanel';
    panel.style.cssText = 'position:fixed;right:0;top:0;height:100vh;width:520px;max-width:95vw;background:var(--bg-p);border-left:1px solid var(--bd);z-index:9998;overflow-y:auto;box-shadow:-4px 0 20px rgba(0,0,0,.15);animation:slideIn .2s ease';

    var safeId = id.replace(/'/g, "\\'");
    var h = '';

    // 헤더
    h += '<div style="padding:16px 18px;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;align-items:flex-start">';
    h += '<div style="flex:1;min-width:0">';
    h += '<div style="font-size:13px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + eH(iss.title) + '">' + eH(iss.title) + '</div>';
    var projLinkHtml = proj
      ? '<span onclick="if(typeof showProjectDetail===\'function\')showProjectDetail(\'' + (proj.id || '').replace(/'/g,"\\'") + '\')" style="cursor:pointer;text-decoration:underline;color:var(--ac,#6366F1)" title="프로젝트 상세 보기">' + eH(projName) + '</span>'
      : eH(projName);
    h += '<div style="font-size:10px;color:var(--t5);margin-top:4px">' + projLinkHtml + (iss.orderNo ? ' (' + eH(iss.orderNo) + ')' : '') + '</div>';
    h += '</div>';
    h += '<div style="display:flex;gap:6px;flex-shrink:0">';
    h += '<button onclick="showIssueModal(\'' + safeId + '\')" style="font-size:10px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3);cursor:pointer;padding:4px 8px">편집</button>';
    h += '<button onclick="document.getElementById(\'issueDetailPanel\').remove()" style="font-size:16px;border:none;background:none;color:var(--t5);cursor:pointer">✕</button>';
    h += '</div></div>';

    // 메타 정보
    h += '<div style="padding:14px 18px;border-bottom:1px solid var(--bd)">';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    h += issueDetailField('단계', '<span style="padding:2px 8px;border-radius:8px;background:' + ph.color + '22;color:' + ph.color + '">' + ph.icon + ' ' + ph.label + '</span>');
    h += issueDetailField('부서', '<span style="padding:2px 8px;border-radius:8px;background:' + dp.color + '22;color:' + dp.color + '">' + dp.icon + ' ' + dp.label + '</span>');
    h += issueDetailField('유형', tp.icon + ' ' + tp.label);
    h += issueDetailField('긴급도', ug.icon + ' ' + ug.label);
    h += issueDetailField('상태', '<span style="padding:2px 8px;border-radius:8px;background:' + st.color + '22;color:' + st.color + ';font-weight:600">' + st.label + '</span>');
    h += issueDetailField('등록일', iss.reportDate || '-');
    if (iss.dueDate) {
      var overdue = iss.dueDate < localDate() && iss.status !== 'resolved' && iss.status !== 'closed';
      h += issueDetailField('대응기한', '<span style="color:' + (overdue ? '#EF4444;font-weight:700' : 'var(--t2)') + '">' + (overdue ? '⚠️ ' : '') + iss.dueDate + '</span>');
    }
    if (iss.reporter) h += issueDetailField('보고자', eH(iss.reporter));
    if (iss.assignees && iss.assignees.length) h += issueDetailField('담당자', iss.assignees.map(function (a) { return eH(a); }).join(', '));
    if (iss.resolvedDate) h += issueDetailField('해결일', iss.resolvedDate);
    h += '</div>';
    if (iss.description) {
      h += '<div style="margin-top:10px;padding:8px;background:var(--bg-i);border-radius:6px;font-size:11px;color:var(--t3);white-space:pre-wrap">' + eH(iss.description) + '</div>';
    }
    if (iss.tags && iss.tags.length) {
      h += '<div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">';
      iss.tags.forEach(function (t) {
        h += '<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:var(--bg-i);color:var(--t5)">#' + eH(t) + '</span>';
      });
      h += '</div>';
    }
    // 해결방안 (resolution)
    h += '<div style="margin-top:10px"><span style="font-size:10px;color:var(--t5)">조치 결과</span>';
    h += '<div style="display:flex;gap:4px;margin-top:4px">';
    h += '<input type="text" id="issResolution" value="' + eH(iss.resolution || '') + '" placeholder="조치 결과 요약 입력..." style="flex:1;padding:5px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t2);font-size:10px">';
    h += '<button onclick="issueSaveResolution(\'' + safeId + '\')" style="font-size:10px;padding:4px 10px;border:none;border-radius:4px;background:#10B981;color:#fff;cursor:pointer">저장</button>';
    h += '</div></div>';
    h += '</div>';

    // 빠른 상태 변경
    h += '<div style="padding:10px 18px;border-bottom:1px solid var(--bd)">';
    h += '<div style="font-size:10px;color:var(--t5);font-weight:600;margin-bottom:6px">상태 변경</div>';
    h += '<div style="display:flex;gap:4px;flex-wrap:wrap">';
    Object.keys(statuses).forEach(function (sk) {
      var s = statuses[sk];
      var isCur = iss.status === sk;
      h += '<button onclick="issueQuickStatus(\'' + safeId + '\',\'' + sk + '\')" style="font-size:10px;padding:3px 10px;border-radius:12px;border:1px solid ' + s.color + ';background:' + (isCur ? s.color : 'transparent') + ';color:' + (isCur ? '#fff' : s.color) + ';cursor:pointer;font-weight:' + (isCur ? '700' : '400') + '">' + s.label + '</button>';
    });
    h += '</div></div>';

    // 대응 이력
    h += '<div style="padding:14px 18px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:10px">대응 이력 (' + logs.length + ')</div>';

    if (logs.length === 0) {
      h += '<div style="text-align:center;color:var(--t6);font-size:11px;padding:20px 0">아직 대응 이력이 없습니다.</div>';
    } else {
      h += '<div style="border-left:2px solid var(--bd);margin-left:8px;padding-left:14px">';
      logs.forEach(function (log) {
        var logDp = depts[log.dept] || { label: log.dept || '', icon: '', color: '#94A3B8' };
        var icon = LOG_TYPE_ICON[log.type] || '📝';
        var safeLogId = log.id.replace(/'/g, "\\'");
        h += '<div style="position:relative;margin-bottom:12px">';
        h += '<div style="position:absolute;left:-21px;top:2px;width:10px;height:10px;border-radius:50%;background:var(--bg-p);border:2px solid var(--bd)"></div>';
        h += '<div style="font-size:10px;color:var(--t5)">' + (log.date || '') + ' ' + (log.time || '') + '</div>';
        h += '<div style="font-size:11px;color:var(--t2);margin-top:2px">';
        h += icon + ' <strong>' + eH(log.type) + '</strong>';
        if (log.author) h += ' — ' + eH(log.author);
        if (log.dept) h += '<span style="font-size:10px;color:' + logDp.color + '">(' + logDp.label + ')</span>';
        h += '</div>';
        h += '<div style="font-size:11px;color:var(--t3);margin-top:2px">' + eH(log.content) + '</div>';
        h += '<button onclick="issueDeleteLog(\'' + safeLogId + '\',\'' + safeId + '\')" style="font-size:10px;border:none;background:none;color:var(--t6);cursor:pointer;margin-top:2px" title="삭제">🗑️</button>';
        h += '</div>';
      });
      h += '</div>';
    }

    // 이력 추가 폼
    h += '<div style="margin-top:14px;padding:12px;background:var(--bg-i);border-radius:8px">';
    h += '<div style="font-size:10px;font-weight:600;color:var(--t5);margin-bottom:8px">+ 기록 추가</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 80px 1fr 1fr;gap:6px;margin-bottom:6px">';
    h += '<input type="date" id="issLogDate" value="' + localDate() + '" style="padding:4px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-p);color:var(--t2);font-size:10px">';
    h += '<input type="time" id="issLogTime" value="' + new Date().toTimeString().slice(0, 5) + '" style="padding:4px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-p);color:var(--t2);font-size:10px">';
    h += '<select id="issLogType" style="padding:4px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-p);color:var(--t2);font-size:10px">';
    LOG_TYPES.forEach(function (t) {
      h += '<option value="' + t + '">' + (LOG_TYPE_ICON[t] || '') + ' ' + t + '</option>';
    });
    h += '</select>';
    h += '<select id="issLogDept" style="padding:4px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-p);color:var(--t2);font-size:10px">';
    h += '<option value="">부서</option>';
    Object.keys(depts).forEach(function (k) {
      h += '<option value="' + k + '">' + depts[k].label + '</option>';
    });
    h += '</select>';
    h += '</div>';
    h += '<div style="display:grid;grid-template-columns:100px 1fr;gap:6px;margin-bottom:6px">';
    h += '<input type="text" id="issLogAuthor" placeholder="작성자" style="padding:4px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-p);color:var(--t2);font-size:10px">';
    h += '<input type="text" id="issLogContent" placeholder="대응 내용" style="padding:4px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-p);color:var(--t2);font-size:10px">';
    h += '</div>';
    h += '<button onclick="issueAddLog(\'' + safeId + '\')" style="padding:4px 12px;border:none;border-radius:4px;background:#6366F1;color:#fff;cursor:pointer;font-size:10px;font-weight:600">추가</button>';
    h += '</div>';

    h += '</div>';

    panel.innerHTML = h;
    document.body.appendChild(panel);
  });
}

function issueDetailField(label, value) {
  return '<div><span style="font-size:10px;color:var(--t5)">' + label + '</span><div style="font-size:11px;color:var(--t2);margin-top:2px">' + value + '</div></div>';
}

function issueQuickStatus(id, newStatus) {
  var updates = { status: newStatus };
  if (newStatus === 'resolved' || newStatus === 'closed') {
    updates.resolvedDate = localDate();
  }
  updateIssue(id, updates).then(function () {
    showToast('상태가 변경되었습니다.');
    showIssueDetail(id);
    renderIssues();
  });
}

function issueAddLog(issueId) {
  var date = document.getElementById('issLogDate').value;
  var time = document.getElementById('issLogTime').value;
  var type = document.getElementById('issLogType').value;
  var dept = document.getElementById('issLogDept').value;
  var author = document.getElementById('issLogAuthor').value.trim();
  var content = document.getElementById('issLogContent').value.trim();

  if (!content) { alert('대응 내용을 입력하세요.'); return; }

  createIssueLog({
    issueId: issueId, date: date, time: time,
    type: type, dept: dept, author: author, content: content
  }).then(function () {
    // 현장출동/정기점검 → 달력 이벤트 자동 생성
    if ((type === '현장출동' || type === '정기점검') && typeof createEvent === 'function') {
      return issueGet(issueId).then(function (iss) {
        if (!iss) return;
        var evtType = type === '현장출동' ? 'fieldService' : 'periodicChk';
        return createEvent({
          title: (type === '현장출동' ? '🔧 ' : '🛠️ ') + iss.title + (author ? ' (' + author + ')' : ''),
          type: evtType,
          startDate: date,
          endDate: date,
          projectIds: iss.projectId ? [iss.projectId] : [],
          assignees: author ? [author] : [],
          memo: '이슈 #' + iss.id + ' 대응: ' + content
        });
      });
    }
  }).then(function () {
    // 완료 유형이면 자동으로 해결 상태로
    if (type === '완료') {
      return updateIssue(issueId, { status: 'resolved', resolvedDate: localDate() });
    }
    // 접수 이외 유형이면 대응중으로
    if (type !== '접수') {
      return issueGet(issueId).then(function (iss) {
        if (iss && iss.status === 'open') {
          return updateIssue(issueId, { status: 'inProgress' });
        }
      });
    }
  }).then(function () {
    showToast('대응 이력이 추가되었습니다.');
    showIssueDetail(issueId);
    renderIssues();
  });
}

function issueSaveResolution(id) {
  var input = document.getElementById('issResolution');
  if (!input) return;
  updateIssue(id, { resolution: input.value.trim() }).then(function () {
    showToast('조치 결과가 저장되었습니다.');
  });
}

function issueDeleteLog(logId, issueId) {
  if (!confirm('이 대응 이력을 삭제하시겠습니까?')) return;
  issueLogDel(logId).then(function () {
    showToast('이력이 삭제되었습니다.');
    showIssueDetail(issueId);
  });
}

/* ═══ 반복 이슈 감지 ═══ */
function detectRepeatIssue(newIssue) {
  issueGetAll().then(function (allIssues) {
    var similar = allIssues.filter(function (iss) {
      if (iss.id === newIssue.id) return false;
      if (iss.projectId !== newIssue.projectId) return false;
      if (iss.dept !== newIssue.dept) return false;
      // 키워드 유사도: 제목 단어 2개 이상 겹침
      var newWords = (newIssue.title || '').split(/[\s,./]+/).filter(function (w) { return w.length >= 2; });
      var oldWords = (iss.title || '').split(/[\s,./]+/).filter(function (w) { return w.length >= 2; });
      var overlap = newWords.filter(function (w) { return oldWords.indexOf(w) >= 0; }).length;
      return overlap >= 2;
    });
    if (similar.length > 0) {
      var msg = '⚠️ 반복 이슈 감지!\n동일 프로젝트+부서에서 유사한 이슈가 ' + similar.length + '건 있습니다:\n';
      similar.slice(0, 3).forEach(function (iss) {
        msg += '- ' + iss.title + ' (' + (iss.reportDate || '') + ')\n';
      });
      msg += '\n근본 원인 분석이 필요할 수 있습니다.';
      alert(msg);
    }
  });
}

/* ═══ 이슈 통계 ═══ */
function buildIssueStats(issues, projMap, phases, depts, types, statuses, urgencies) {
  var h = '<div class="pnl" style="margin-top:12px;padding:18px">';
  h += '<div style="font-size:13px;font-weight:700;color:var(--t2);margin-bottom:14px">📊 이슈 통계</div>';

  // 1. 부서 × 상태 히트맵
  var deptKeys = Object.keys(depts);
  var statusKeys = Object.keys(statuses);

  var heatmap = {};
  var maxCell = 1;
  deptKeys.forEach(function (dk) { heatmap[dk] = {}; statusKeys.forEach(function (sk) { heatmap[dk][sk] = 0; }); });
  issues.forEach(function (iss) {
    if (heatmap[iss.dept] && heatmap[iss.dept][iss.status] !== undefined) {
      heatmap[iss.dept][iss.status]++;
      if (heatmap[iss.dept][iss.status] > maxCell) maxCell = heatmap[iss.dept][iss.status];
    }
  });

  h += '<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:600;color:var(--t3);margin-bottom:8px">부서 x 상태</div>';
  h += '<table style="width:100%;border-collapse:collapse;font-size:10px">';
  h += '<thead><tr><th style="padding:4px 6px;text-align:left;color:var(--t5)">부서</th>';
  statusKeys.forEach(function (sk) {
    h += '<th style="padding:4px 6px;text-align:center;color:' + statuses[sk].color + '">' + statuses[sk].label + '</th>';
  });
  h += '<th style="padding:4px 6px;text-align:center;color:var(--t5)">합계</th></tr></thead><tbody>';
  deptKeys.forEach(function (dk) {
    var total = 0;
    h += '<tr style="border-top:1px solid var(--bd)">';
    h += '<td style="padding:4px 6px;color:var(--t2)">' + depts[dk].icon + ' ' + depts[dk].label + '</td>';
    statusKeys.forEach(function (sk) {
      var cnt = heatmap[dk][sk];
      total += cnt;
      var intensity = cnt > 0 ? Math.max(0.1, cnt / maxCell * 0.6) : 0;
      var color = statuses[sk].color;
      h += '<td style="padding:4px 6px;text-align:center;background:rgba(' + hexToRgb(color) + ',' + intensity + ');font-weight:' + (cnt > 0 ? '600' : '400') + ';color:' + (cnt > 0 ? color : 'var(--t6)') + '">' + cnt + '</td>';
    });
    h += '<td style="padding:4px 6px;text-align:center;font-weight:700;color:var(--t2)">' + total + '</td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';

  // 2. 단계별 분포
  var phaseKeys = Object.keys(phases).sort(function (a, b) { return (phases[a].seq || 0) - (phases[b].seq || 0); });
  var phaseCounts = {};
  var maxPhaseCnt = 1;
  phaseKeys.forEach(function (k) { phaseCounts[k] = 0; });
  issues.forEach(function (iss) { if (phaseCounts[iss.phase] !== undefined) { phaseCounts[iss.phase]++; if (phaseCounts[iss.phase] > maxPhaseCnt) maxPhaseCnt = phaseCounts[iss.phase]; } });

  h += '<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:600;color:var(--t3);margin-bottom:8px">단계별 이슈 분포</div>';
  phaseKeys.forEach(function (k) {
    var cnt = phaseCounts[k];
    var pct = Math.round(cnt / maxPhaseCnt * 100);
    h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
    h += '<span style="width:50px;font-size:10px;color:' + phases[k].color + ';text-align:right">' + phases[k].icon + ' ' + phases[k].label + '</span>';
    h += '<div style="flex:1;height:14px;background:var(--bd);border-radius:4px;overflow:hidden">';
    h += '<div style="height:100%;width:' + pct + '%;background:' + phases[k].color + ';border-radius:4px;min-width:' + (cnt > 0 ? '2px' : '0') + '"></div>';
    h += '</div>';
    h += '<span style="width:30px;font-size:10px;color:var(--t3);font-weight:600">' + cnt + '</span>';
    h += '</div>';
  });
  h += '</div>';

  // 3. 프로젝트별 이슈 빈도 TOP5
  var projCounts = {};
  issues.forEach(function (iss) {
    var pId = iss.projectId || 'unknown';
    projCounts[pId] = (projCounts[pId] || 0) + 1;
  });
  var projRank = Object.keys(projCounts).map(function (pId) {
    var p = projMap[pId];
    return { name: p ? p.name : '(알수없음)', count: projCounts[pId] };
  }).sort(function (a, b) { return b.count - a.count; }).slice(0, 5);

  if (projRank.length > 0) {
    h += '<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:600;color:var(--t3);margin-bottom:8px">프로젝트별 이슈 빈도 TOP5</div>';
    projRank.forEach(function (r, i) {
      h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;font-size:10px">';
      h += '<span style="width:16px;color:var(--t5);text-align:right">' + (i + 1) + '.</span>';
      h += '<span style="flex:1;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(r.name) + '</span>';
      h += '<span style="font-weight:600;color:var(--t2)">' + r.count + '건</span>';
      h += '</div>';
    });
    h += '</div>';
  }

  // 4. 평균 해결 시간 (부서별)
  var deptResTime = {};
  deptKeys.forEach(function (dk) { deptResTime[dk] = { total: 0, count: 0 }; });
  issues.forEach(function (iss) {
    if ((iss.status === 'resolved' || iss.status === 'closed') && iss.resolvedDate && iss.reportDate) {
      var days = daysBetween(iss.reportDate, iss.resolvedDate);
      if (deptResTime[iss.dept]) {
        deptResTime[iss.dept].total += days;
        deptResTime[iss.dept].count++;
      }
    }
  });

  var hasResData = deptKeys.some(function (dk) { return deptResTime[dk].count > 0; });
  if (hasResData) {
    h += '<div><div style="font-size:11px;font-weight:600;color:var(--t3);margin-bottom:8px">부서별 평균 해결일</div>';
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap">';
    deptKeys.forEach(function (dk) {
      var d = deptResTime[dk];
      if (d.count === 0) return;
      var avg = Math.round(d.total / d.count * 10) / 10;
      h += '<div class="pnl" style="padding:8px 12px;text-align:center;min-width:70px">';
      h += '<div style="font-size:10px;color:' + depts[dk].color + '">' + depts[dk].icon + ' ' + depts[dk].label + '</div>';
      h += '<div style="font-size:16px;font-weight:700;color:var(--t1);margin-top:2px">' + avg + '</div>';
      h += '<div style="font-size:10px;color:var(--t5)">일</div></div>';
    });
    h += '</div></div>';
  }

  h += '</div>';
  return h;
}

/* ═══ 엑셀 내보내기 ═══ */
function exportIssueExcel() {
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  var depts = typeof DEPT !== 'undefined' ? DEPT : {};
  var types = typeof ISSUE_TYPE !== 'undefined' ? ISSUE_TYPE : {};
  var statuses = typeof ISSUE_STATUS !== 'undefined' ? ISSUE_STATUS : {};
  var urgencies = typeof ISSUE_URGENCY !== 'undefined' ? ISSUE_URGENCY : {};

  Promise.all([issueGetAll(), projGetAll()]).then(function (results) {
    var issues = results[0] || [];
    var projects = results[1] || [];
    var projMap = {};
    projects.forEach(function (p) { projMap[p.id] = p; });

    var rows = [['번호', '등록일', '대응기한', '프로젝트', '수주번호', '단계', '부서', '유형', '긴급도', '상태', '제목', '상세내용', '보고자', '담당자', '해결일', '태그']];
    issues.forEach(function (iss, i) {
      var proj = projMap[iss.projectId];
      rows.push([
        i + 1,
        iss.reportDate || '',
        iss.dueDate || '',
        proj ? proj.name : '',
        iss.orderNo || '',
        phases[iss.phase] ? phases[iss.phase].label : iss.phase,
        depts[iss.dept] ? depts[iss.dept].label : iss.dept,
        types[iss.type] ? types[iss.type].label : iss.type,
        urgencies[iss.urgency] ? urgencies[iss.urgency].label : iss.urgency,
        statuses[iss.status] ? statuses[iss.status].label : iss.status,
        iss.title || '',
        iss.description || '',
        iss.reporter || '',
        (iss.assignees || []).join(', '),
        iss.resolvedDate || '',
        (iss.tags || []).join(', ')
      ]);
    });

    if (typeof XLSX !== 'undefined') {
      var ws = XLSX.utils.aoa_to_sheet(rows);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '이슈대장');
      XLSX.writeFile(wb, '이슈대장_' + localDate() + '.xlsx');
      showToast('이슈 대장을 엑셀로 저장했습니다.');
    } else {
      alert('SheetJS(xlsx) 라이브러리를 불러올 수 없습니다.');
    }
  });
}

/* ═══ 일괄 작업 (Bulk Operations) ═══ */
function issueToggleBulk(id) {
  if (issueBulkSelected[id]) {
    delete issueBulkSelected[id];
  } else {
    issueBulkSelected[id] = true;
  }
  renderIssueBulkBar();
  // 전체선택 체크박스 동기화
  var allChk = document.getElementById('issueBulkAll');
  if (allChk) {
    var rowChks = document.querySelectorAll('[data-bulk-id]');
    var checkedCount = Object.keys(issueBulkSelected).length;
    allChk.checked = rowChks.length > 0 && checkedCount === rowChks.length;
    allChk.indeterminate = checkedCount > 0 && checkedCount < rowChks.length;
  }
}

function issueToggleAllBulk() {
  var allChk = document.getElementById('issueBulkAll');
  var rowChks = document.querySelectorAll('[data-bulk-id]');
  issueBulkSelected = {};
  if (allChk && allChk.checked) {
    rowChks.forEach(function (el) { issueBulkSelected[el.dataset.bulkId] = true; });
  }
  rowChks.forEach(function (el) { el.checked = !!(allChk && allChk.checked); });
  renderIssueBulkBar();
}

function renderIssueBulkBar() {
  var old = document.getElementById('issueBulkBar');
  if (old) old.remove();
  var ids = Object.keys(issueBulkSelected);
  if (ids.length === 0) return;

  var statuses = typeof ISSUE_STATUS !== 'undefined' ? ISSUE_STATUS : {};
  var bar = document.createElement('div');
  bar.id = 'issueBulkBar';
  bar.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9990;background:var(--bg-p);border:1px solid var(--bd);border-radius:12px;padding:10px 18px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,.25);font-size:11px';

  var statusOpts = '<option value="">상태 선택</option>';
  Object.keys(statuses).forEach(function (k) {
    statusOpts += '<option value="' + k + '">' + statuses[k].label + '</option>';
  });

  bar.innerHTML =
    '<span style="font-weight:700;color:var(--t2)">' + ids.length + '건 선택</span>' +
    '<select id="bulkStatusSel" style="font-size:10px;padding:3px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3)">' + statusOpts + '</select>' +
    '<button onclick="issueBulkAction(\'status\')" style="font-size:10px;padding:3px 10px;border:none;border-radius:4px;background:#6366F1;color:#fff;cursor:pointer">상태 변경</button>' +
    '<input type="text" id="bulkAssigneeInput" placeholder="담당자 일괄 지정" style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t2);width:110px">' +
    '<button onclick="issueBulkAction(\'assignee\')" style="font-size:10px;padding:3px 10px;border:none;border-radius:4px;background:#3B82F6;color:#fff;cursor:pointer">담당자 지정</button>' +
    '<button onclick="issueBulkAction(\'delete\')" style="font-size:10px;padding:3px 10px;border:none;border-radius:4px;background:#EF4444;color:#fff;cursor:pointer">🗑 삭제</button>' +
    '<button onclick="issueBulkSelected={};renderIssues()" style="font-size:10px;padding:3px 10px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t5);cursor:pointer">취소</button>';

  document.body.appendChild(bar);
}

function issueBulkAction(action) {
  var ids = Object.keys(issueBulkSelected);
  if (ids.length === 0) return;

  if (action === 'delete') {
    if (!confirm(ids.length + '건의 이슈를 삭제하시겠습니까?')) return;
    var delPromises = ids.map(function (id) {
      return typeof deleteIssueCascade === 'function' ? deleteIssueCascade(id) : deleteIssue(id);
    });
    Promise.all(delPromises).then(function () {
      issueBulkSelected = {};
      showToast(ids.length + '건 삭제 완료');
      renderIssues();
    });
    return;
  }

  if (action === 'status') {
    var sel = document.getElementById('bulkStatusSel');
    var newStatus = sel ? sel.value : '';
    if (!newStatus) { alert('상태를 선택하세요.'); return; }
    var updates = { status: newStatus };
    if (newStatus === 'resolved' || newStatus === 'closed') updates.resolvedDate = localDate();
    var stPromises = ids.map(function (id) { return updateIssue(id, updates); });
    Promise.all(stPromises).then(function () {
      issueBulkSelected = {};
      showToast(ids.length + '건 상태 변경 완료');
      renderIssues();
    });
    return;
  }

  if (action === 'assignee') {
    var inp = document.getElementById('bulkAssigneeInput');
    var assigneeStr = inp ? inp.value.trim() : '';
    if (!assigneeStr) { alert('담당자를 입력하세요.'); return; }
    var assignees = assigneeStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var aPromises = ids.map(function (id) { return updateIssue(id, { assignees: assignees }); });
    Promise.all(aPromises).then(function () {
      issueBulkSelected = {};
      showToast(ids.length + '건 담당자 지정 완료');
      renderIssues();
    });
    return;
  }
}

/* ═══ 헬퍼 ═══ */
function hexToRgb(hex) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return r + ',' + g + ',' + b;
}

function daysBetween(d1, d2) {
  var a = new Date(d1);
  var b = new Date(d2);
  return Math.max(0, Math.round((b - a) / 86400000));
}

/* ═══ eH / localDate / daysDiff 폴백 ═══ */
if (typeof eH === 'undefined') {
  function eH(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
}
if (typeof localDate === 'undefined') {
  function localDate() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
}
if (typeof daysDiff === 'undefined') {
  function daysDiff(d1, d2) { return Math.max(0, Math.round((new Date(d2) - new Date(d1)) / 86400000)); }
}
