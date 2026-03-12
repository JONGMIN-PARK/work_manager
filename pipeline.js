/**
 * 업무 관리자 — 파이프라인 뷰 (칸반 보드)
 * 프로젝트를 라이프사이클 단계별로 칸반 레인에 표시
 */

/* ═══ 파이프라인 렌더링 ═══ */
function renderPipeline() {
  var wrap = document.getElementById('pipelineWrap');
  if (!wrap) return;

  var chkAllPromise = typeof pipelineLoadAllChecklists === 'function' ? pipelineLoadAllChecklists() : Promise.resolve({});
  var issAllPromise = typeof issueGetAll === 'function' ? issueGetAll() : Promise.resolve([]);
  Promise.all([projGetAll(), msGetAll(), orderGetAll(), chkAllPromise, issAllPromise]).then(function (results) {
    var projects = results[0] || [];
    var milestones = results[1] || [];
    var orders = results[2] || [];
    var chkProgress = results[3] || {};
    var allIssues = results[4] || [];

    // 프로젝트별 미해결 이슈 카운트
    var issueCount = {};
    allIssues.forEach(function (iss) {
      if (iss.projectId && iss.status !== 'resolved' && iss.status !== 'closed') {
        issueCount[iss.projectId] = (issueCount[iss.projectId] || 0) + 1;
      }
    });
    var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
    var phaseKeys = Object.keys(phases).sort(function (a, b) { return (phases[a].seq || 0) - (phases[b].seq || 0); });

    // 프로젝트를 단계별로 분류
    var buckets = {};
    phaseKeys.forEach(function (k) { buckets[k] = []; });

    projects.forEach(function (p) {
      var phase = p.currentPhase || guessPhase(p);
      if (!buckets[phase]) phase = phaseKeys[0];
      buckets[phase].push(p);
    });

    // 수주 대장에 있지만 프로젝트가 없는 수주 → '수주' 레인에 표시
    var projOrderNos = {};
    projects.forEach(function (p) { if (p.orderNo) projOrderNos[p.orderNo] = true; });

    var html = '';

    // 상단 요약 카드
    html += '<div class="pnl" style="margin-bottom:14px;padding:14px 18px">';
    html += '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">';
    html += '<span style="font-size:13px;font-weight:700;color:var(--t2)">🔀 파이프라인</span>';
    html += '<span style="font-size:11px;color:var(--t5)">전체 ' + projects.length + '건</span>';
    html += '<button onclick="exportProjectReport()" style="font-size:10px;padding:3px 10px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer;margin-left:auto">📊 보고서</button>';
    phaseKeys.forEach(function (k) {
      var ph = phases[k];
      var cnt = buckets[k].length;
      html += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:' + ph.color + '22;color:' + ph.color + ';font-weight:600">' + ph.icon + ' ' + ph.label + ' ' + cnt + '</span>';
    });
    html += '</div></div>';

    // 칸반 보드
    html += '<div style="display:grid;grid-template-columns:repeat(' + phaseKeys.length + ',1fr);gap:10px;min-height:400px">';

    phaseKeys.forEach(function (k) {
      var ph = phases[k];
      var items = buckets[k];

      html += '<div class="pipeline-lane" data-phase="' + k + '" ondragover="pipelineDragOver(event)" ondrop="pipelineDrop(event,\'' + k + '\')" ondragenter="pipelineDragEnter(event)" ondragleave="pipelineDragLeave(event)" style="background:var(--bg-i);border:1px solid var(--bd);border-radius:10px;padding:12px;display:flex;flex-direction:column;transition:border-color .2s">';
      // 레인 헤더
      html += '<div style="text-align:center;margin-bottom:10px;padding-bottom:10px;border-bottom:2px solid ' + ph.color + '">';
      html += '<div style="font-size:20px;margin-bottom:4px">' + ph.icon + '</div>';
      html += '<div style="font-size:11px;font-weight:700;color:' + ph.color + ';letter-spacing:-.2px">' + ph.label + '</div>';
      html += '<div style="font-size:10px;color:var(--t5);margin-top:3px;font-weight:600">' + items.length + '건</div>';
      html += '</div>';

      // 카드들
      html += '<div style="display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;max-height:500px">';
      if (items.length === 0) {
        html += '<div style="text-align:center;color:var(--t6);font-size:10px;padding:20px 0">—</div>';
      }
      items.forEach(function (p) {
        var st = typeof PROJ_STATUS !== 'undefined' && PROJ_STATUS[p.status] ? PROJ_STATUS[p.status] : { label: p.status, color: '#94A3B8', icon: '' };
        var isDelayed = p.status === 'delayed' || (p.endDate && p.endDate < localDate() && p.status !== 'done');
        var borderColor = isDelayed ? '#EF4444' : 'var(--bd)';
        var borderStyle = isDelayed ? '2px solid ' + borderColor : '1px solid ' + borderColor;
        var progress = p.progress || 0;

        // 현재 단계 체크리스트 완료율
        var chkInfo = chkProgress[p.id] && chkProgress[p.id][k] ? chkProgress[p.id][k] : null;
        var chkTotal = chkInfo ? chkInfo.total : 0;
        var chkDone = chkInfo ? chkInfo.done : 0;
        var chkPct = chkTotal > 0 ? Math.round(chkDone / chkTotal * 100) : -1;

        html += '<div class="pipeline-card" draggable="true" ondragstart="pipelineDragStart(event,\'' + p.id + '\')" style="background:var(--bg-p);border:' + borderStyle + ';border-radius:8px;padding:10px 12px;cursor:pointer;transition:transform .15s,box-shadow .15s" onmouseenter="this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 3px 8px rgba(0,0,0,.1)\'" onmouseleave="this.style.transform=\'\';this.style.boxShadow=\'\'" onclick="pipelineCardClick(\'' + p.id + '\')" title="' + eH(p.name) + '">';

        // 프로젝트명
        html += '<div style="font-size:12px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(p.name) + '</div>';

        // 수주번호 + 거래처
        if (p.orderNo) {
          var client = '';
          if (typeof ORDER_MAP !== 'undefined' && ORDER_MAP[p.orderNo]) {
            var oi = ORDER_MAP[p.orderNo];
            client = typeof oi === 'object' ? (oi.client || '') : '';
          }
          html += '<div style="font-size:9px;color:var(--t5);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(p.orderNo) + (client ? ' · ' + eH(client) : '') + '</div>';
        }

        // 상태 + 진척률
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">';
        html += '<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:' + st.color + '22;color:' + st.color + '">' + st.icon + ' ' + st.label + '</span>';
        html += '<span style="font-size:9px;color:var(--t5);font-weight:600">' + progress + '%</span>';
        html += '</div>';

        // 진척률 바
        html += '<div style="margin-top:4px;height:3px;background:var(--bd);border-radius:2px;overflow:hidden">';
        html += '<div style="height:100%;width:' + progress + '%;background:' + (p.color || '#3B82F6') + ';border-radius:2px"></div>';
        html += '</div>';

        // 체크리스트 완료율
        if (chkPct >= 0) {
          var chkColor = chkPct === 100 ? '#10B981' : chkPct >= 50 ? '#F59E0B' : '#94A3B8';
          html += '<div style="display:flex;align-items:center;gap:4px;margin-top:4px">';
          html += '<span style="font-size:9px;color:' + chkColor + '">☑ ' + chkDone + '/' + chkTotal + '</span>';
          html += '<div style="flex:1;height:2px;background:var(--bd);border-radius:1px;overflow:hidden"><div style="height:100%;width:' + chkPct + '%;background:' + chkColor + '"></div></div>';
          html += '<span style="font-size:9px;color:' + chkColor + ';font-weight:600">' + chkPct + '%</span>';
          html += '</div>';
        }

        // 이슈 배지
        var pIssueN = issueCount[p.id] || 0;
        if (pIssueN > 0) {
          html += '<div style="font-size:9px;color:#EF4444;margin-top:4px;font-weight:600">🎫 미해결 이슈 ' + pIssueN + '건</div>';
        }

        // 담당자
        if (p.assignees && p.assignees.length) {
          html += '<div style="font-size:9px;color:var(--t5);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">👤 ' + p.assignees.map(function (a) { return typeof displayName === 'function' ? displayName(a) : a; }).join(', ') + '</div>';
        }

        // 지연 경고
        if (isDelayed && p.endDate) {
          var overDays = daysDiff(p.endDate, localDate());
          html += '<div style="font-size:9px;color:#EF4444;font-weight:600;margin-top:3px">⚠️ ' + overDays + '일 초과</div>';
        }

        html += '</div>'; // card end
      });
      html += '</div>'; // cards container end
      html += '</div>'; // lane end
    });

    html += '</div>'; // grid end

    wrap.innerHTML = html;
  });
}

/* 프로젝트의 현재 단계 추정 (currentPhase 없을 때 폴백) */
function guessPhase(proj) {
  if (proj.currentPhase) return proj.currentPhase;
  var s = proj.status;
  if (s === 'done') return 'as';
  if (s === 'waiting') return 'order';
  // 진행중/지연/보류 → 중간 단계로 추정
  return 'manufacture';
}

/* 파이프라인 카드 클릭 → 프로젝트 상세 */
function pipelineCardClick(projId) {
  // timeline.js의 showProjectModal 활용
  if (typeof showProjectModal === 'function') {
    showProjectModal(projId);
  }
}

/* ═══ 파이프라인 드래그 앤 드롭 ═══ */
var pipelineDragId = '';

function pipelineDragStart(e, projId) {
  pipelineDragId = projId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', projId);
  e.target.style.opacity = '0.5';
}

function pipelineDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function pipelineDragEnter(e) {
  e.preventDefault();
  var lane = e.currentTarget;
  if (lane) lane.style.borderColor = 'var(--accent, #6366F1)';
}

function pipelineDragLeave(e) {
  var lane = e.currentTarget;
  if (lane) lane.style.borderColor = 'var(--bd)';
}

function pipelineDrop(e, targetPhase) {
  e.preventDefault();
  var lane = e.currentTarget;
  if (lane) lane.style.borderColor = 'var(--bd)';
  var projId = pipelineDragId || e.dataTransfer.getData('text/plain');
  if (!projId) return;
  pipelineDragId = '';

  // 현재 단계와 동일하면 무시
  projGet(projId).then(function (proj) {
    if (!proj) return;
    var curPhase = proj.currentPhase || guessPhase(proj);
    if (curPhase === targetPhase) return;

    // 게이트 체크
    if (typeof advancePhase === 'function') {
      advancePhase(projId, targetPhase).then(function (result) {
        if (!result) return;
        if (result.gatePass === false) {
          if (!confirm('현재 단계 체크리스트가 미완료입니다 (' + result.currentPct + '%). 강제로 ' + getPhaseName(targetPhase) + ' 단계로 이동하시겠습니까?')) return;
        }
        executePhaseTransition(projId, targetPhase).then(function () {
          showToast(getPhaseName(targetPhase) + ' 단계로 이동했습니다.');
          renderPipeline();
        });
      });
    } else {
      // advancePhase 없으면 직접 전환
      executePhaseTransition(projId, targetPhase).then(function () {
        showToast(getPhaseName(targetPhase) + ' 단계로 이동했습니다.');
        renderPipeline();
      });
    }
  });
}

function getPhaseName(phaseKey) {
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  return phases[phaseKey] ? phases[phaseKey].label : phaseKey;
}

/* ═══ 전체 체크리스트 로드 (파이프라인용) ═══ */
function pipelineLoadAllChecklists() {
  return new Promise(function (res) {
    if (typeof db === 'undefined' || !db) { res({}); return; }
    try {
      var tx = db.transaction('checklists', 'readonly');
      var req = tx.objectStore('checklists').getAll();
      req.onsuccess = function () {
        var items = req.result || [];
        var map = {}; // { projectId: { phase: { total, done } } }
        items.forEach(function (it) {
          if (!it.projectId || !it.phase) return;
          if (!map[it.projectId]) map[it.projectId] = {};
          if (!map[it.projectId][it.phase]) map[it.projectId][it.phase] = { total: 0, done: 0 };
          map[it.projectId][it.phase].total++;
          if (it.done) map[it.projectId][it.phase].done++;
        });
        res(map);
      };
      req.onerror = function () { res({}); };
    } catch (e) { res({}); }
  });
}

/* ═══ 프로젝트 보고서 엑셀 내보내기 ═══ */
function exportProjectReport() {
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  var depts = typeof DEPT !== 'undefined' ? DEPT : {};
  var phaseKeys = Object.keys(phases).sort(function (a, b) { return (phases[a].seq || 0) - (phases[b].seq || 0); });

  var issPromise = typeof issueGetAll === 'function' ? issueGetAll() : Promise.resolve([]);
  var chkPromise2 = typeof pipelineLoadAllChecklists === 'function' ? pipelineLoadAllChecklists() : Promise.resolve({});

  Promise.all([projGetAll(), msGetAll(), orderGetAll(), issPromise, chkPromise2]).then(function (results) {
    var projects = results[0] || [];
    var milestones = results[1] || [];
    var orders = results[2] || [];
    var issues = results[3] || [];
    var chkMap = results[4] || {};

    if (typeof XLSX === 'undefined') { alert('SheetJS(xlsx) 라이브러리를 불러올 수 없습니다.'); return; }

    var wb = XLSX.utils.book_new();

    // Sheet 1: 프로젝트 현황
    var projRows = [['프로젝트명', '수주번호', '거래처', '시작일', '종료일', '상태', '현재단계', '진척률', '담당자']];
    projects.forEach(function (p) {
      var phaseName = p.currentPhase && phases[p.currentPhase] ? phases[p.currentPhase].label : '-';
      var client = '';
      if (typeof ORDER_MAP !== 'undefined' && ORDER_MAP[p.orderNo]) {
        var oi = ORDER_MAP[p.orderNo];
        client = typeof oi === 'object' ? (oi.client || '') : '';
      }
      var stLabel = typeof PROJ_STATUS !== 'undefined' && PROJ_STATUS[p.status] ? PROJ_STATUS[p.status].label : p.status;
      projRows.push([p.name || '', p.orderNo || '', client, p.startDate || '', p.endDate || '', stLabel, phaseName, (p.progress || 0) + '%', (p.assignees || []).join(', ')]);
    });

    // 단계별 체크리스트 완료율 열 추가
    projRows[0] = projRows[0].concat(phaseKeys.map(function (k) { return phases[k].label + ' 체크리스트'; }));
    projects.forEach(function (p, i) {
      var chkCols = phaseKeys.map(function (k) {
        var info = chkMap[p.id] && chkMap[p.id][k] ? chkMap[p.id][k] : null;
        if (!info || info.total === 0) return '-';
        return info.done + '/' + info.total + ' (' + Math.round(info.done / info.total * 100) + '%)';
      });
      projRows[i + 1] = projRows[i + 1].concat(chkCols);
    });

    var ws1 = XLSX.utils.aoa_to_sheet(projRows);
    XLSX.utils.book_append_sheet(wb, ws1, '프로젝트현황');

    // Sheet 2: 이슈 요약
    if (issues.length) {
      var issTypes = typeof ISSUE_TYPE !== 'undefined' ? ISSUE_TYPE : {};
      var issUrgencies = typeof ISSUE_URGENCY !== 'undefined' ? ISSUE_URGENCY : {};
      var issStatuses = typeof ISSUE_STATUS !== 'undefined' ? ISSUE_STATUS : {};
      var projMap = {};
      projects.forEach(function (p) { projMap[p.id] = p; });

      var issRows = [['번호', '등록일', '프로젝트', '단계', '부서', '유형', '긴급도', '상태', '제목', '담당자', '해결일']];
      issues.forEach(function (iss, i) {
        var proj = projMap[iss.projectId];
        issRows.push([
          i + 1, iss.reportDate || '',
          proj ? proj.name : '', phases[iss.phase] ? phases[iss.phase].label : iss.phase,
          depts[iss.dept] ? depts[iss.dept].label : iss.dept,
          issTypes[iss.type] ? issTypes[iss.type].label : iss.type,
          issUrgencies[iss.urgency] ? issUrgencies[iss.urgency].label : iss.urgency,
          issStatuses[iss.status] ? issStatuses[iss.status].label : iss.status,
          iss.title || '', (iss.assignees || []).join(', '), iss.resolvedDate || ''
        ]);
      });
      var ws2 = XLSX.utils.aoa_to_sheet(issRows);
      XLSX.utils.book_append_sheet(wb, ws2, '이슈대장');
    }

    // Sheet 3: 마일스톤
    if (milestones.length) {
      var msRows = [['프로젝트', '마일스톤', '시작일', '종료일', '상태']];
      var projMap2 = {};
      projects.forEach(function (p) { projMap2[p.id] = p; });
      milestones.forEach(function (m) {
        var proj = projMap2[m.projectId];
        var msSt = typeof PROJ_STATUS !== 'undefined' && PROJ_STATUS[m.status] ? PROJ_STATUS[m.status].label : m.status;
        msRows.push([proj ? proj.name : '', m.name || '', m.startDate || '', m.endDate || '', msSt]);
      });
      var ws3 = XLSX.utils.aoa_to_sheet(msRows);
      XLSX.utils.book_append_sheet(wb, ws3, '마일스톤');
    }

    XLSX.writeFile(wb, '프로젝트_보고서_' + localDate() + '.xlsx');
    showToast('프로젝트 보고서를 엑셀로 저장했습니다.');
  });
}

/* ═══ eH 폴백 (HTML 이스케이프) ═══ */
if (typeof eH === 'undefined') {
  function eH(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
}
