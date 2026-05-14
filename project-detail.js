/**
 * 프로젝트 상세 패널 — showProjectDetail 및 관련 pd* 헬퍼
 * (timeline.js에서 분리 — 렌더링/체크리스트/이슈/투입실적/진척 차트)
 */

async function showProjectDetail(id) {
  var existing = document.getElementById('projDetailPanel');
  if (existing) existing.remove();
  var existingBd = document.getElementById('projDetailBackdrop');
  if (existingBd) existingBd.remove();

  var [proj, projMs, allChk] = await Promise.all([
    projGet(id),
    msGetByProject(id),
    typeof chkGetByProject === 'function' ? chkGetByProject(id) : Promise.resolve([])
  ]);
  if (!proj) return;
  projMs.sort(function (a, b) { return a.order - b.order; });
  var st = autoProjectStatus(proj);
  var stInfo = PROJ_STATUS[st] || PROJ_STATUS.waiting;
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
    // v13.35~ 메모는 HTML(이미지 인라인 가능). plain text 호환은 memoToHtml 헬퍼가 처리.
    var _memoHtml = (typeof memoToHtml === 'function') ? memoToHtml(proj.memo) : eH(proj.memo);
    html += '<div style="margin-bottom:12px"><div style="font-size:10px;color:var(--t5);margin-bottom:4px">메모</div><div class="memo-body" style="font-size:11px;color:var(--t3);padding:8px;background:var(--bg-i);border-radius:6px;white-space:normal;word-break:break-word">' + _memoHtml + '</div></div>';
  }

  // 마일스톤 — v13.61: 패널 즉시 표시. 시간 집계는 백그라운드에서 채움 (await 제거)
  var msHtml = projMs.length ?
    projMs.map(function (m) {
      var mSt = PROJ_STATUS[m.status] || PROJ_STATUS.waiting;
      return '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--bd)">' +
        '<span style="font-size:10px">' + mSt.icon + '</span>' +
        '<span style="flex:1;font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(m.name) +
          '<span class="pd-ms-hours" data-msid="' + eH(m.id) + '"></span>' +
        '</span>' +
        '<span style="font-size:9px;color:var(--t6)">' + (m.endDate || '') + '</span>' +
        '<span class="badge" style="background:' + mSt.bg + ';color:' + mSt.color + ';font-size:8px;padding:1px 4px">' + mSt.label + '</span></div>';
    }).join('') : '<div style="font-size:11px;color:var(--t6)">마일스톤 없음</div>';
  html += '<div style="margin-bottom:12px"><div style="font-size:10px;color:var(--t5);margin-bottom:6px">마일스톤 (' + projMs.length + ')</div>' + msHtml + '</div>';

  // 백그라운드 시간 집계 → 채움 (패널 부착 후 setTimeout으로 비동기 실행)
  if (projMs.length && typeof calcHoursByMilestone === 'function') {
    setTimeout(function () {
      calcHoursByMilestone(id, { proj: proj, milestones: projMs }).then(function (msHoursData) {
        if (!document.getElementById('projDetailPanel')) return;  // 사용자가 패널 닫았으면 무시
        Object.keys(msHoursData || {}).forEach(function (msid) {
          var h = msHoursData[msid] && msHoursData[msid].hours;
          if (!h || h <= 0) return;
          var el = document.querySelector('.pd-ms-hours[data-msid="' + msid + '"]');
          if (el) el.innerHTML = ' <span style="font-size:9px;color:var(--ac-t);background:var(--ac-bg);padding:1px 5px;border-radius:3px;margin-left:4px">' + h + 'h</span>';
        });
      }).catch(function (e) { console.warn('[Timeline/ms-hours]', e); });
    }, 0);
  }

  // 개요 탭: 현재 단계 체크리스트 (기본 표시)
  var overviewChkPhase = proj.currentPhase || 'order';
  var overviewChkPh = phases[overviewChkPhase] || { label: overviewChkPhase, icon: '', color: '#94A3B8' };
  var overviewChkItems = allChk.filter(function (c) { return c.phase === overviewChkPhase; });
  overviewChkItems.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  var overviewChkDone = overviewChkItems.filter(function (c) { return c.done; }).length;
  var overviewChkPct = overviewChkItems.length ? Math.round(overviewChkDone / overviewChkItems.length * 100) : 0;

  html += '<div style="margin-bottom:12px" data-overview-chk-phase="' + overviewChkPhase + '">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
  html += '<span style="font-size:10px;color:var(--t5)">체크리스트 — ' + overviewChkPh.icon + ' ' + overviewChkPh.label + '</span>';
  html += '<span id="pdOverviewChkStat" style="font-size:10px;color:' + overviewChkPh.color + ';font-weight:600' + (overviewChkItems.length > 0 ? '' : ';display:none') + '">' + overviewChkDone + '/' + overviewChkItems.length + ' (' + overviewChkPct + '%)</span>';
  html += '</div>';
  html += '<div id="pdOverviewChkList">' + renderOverviewChkListHtml(id, overviewChkPhase, overviewChkPh, overviewChkItems) + '</div>';
  // 개요 탭 항목 추가 input
  html += '<div style="margin-top:6px;display:flex;gap:4px">';
  html += '<input type="text" id="pdOverviewNewChk" placeholder="새 항목 추가..." style="flex:1;font-size:11px;padding:4px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t2)" onkeydown="if(event.key===\'Enter\')pdAddCheck(\'' + id + '\',\'' + overviewChkPhase + '\')">';
  html += '<button class="btn btn-g btn-s" style="font-size:10px;padding:4px 8px" onclick="pdAddCheck(\'' + id + '\',\'' + overviewChkPhase + '\')">추가</button>';
  html += '</div>';
  html += '</div>';

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
  html += '<div style="text-align:center;margin-bottom:14px">';
  if (nextPhase) {
    var nextPh = phases[nextPhase];
    html += '<button class="btn btn-p btn-s" onclick="pdAdvancePhase(\'' + id + '\',\'' + nextPhase + '\')" style="font-size:11px;margin-right:8px">➡️ 다음 단계(' + nextPh.label + ')</button>';
  }
  // 임의 단계 선택 드롭다운
  html += '<select class="si" style="font-size:11px;padding:3px 6px;vertical-align:middle;width:auto;background:var(--bg-i);border-color:var(--bd);border-radius:6px" onchange="if(this.value){pdAdvancePhase(\'' + id + '\',this.value);this.value=\'\';}">';
  html += '<option value="">(임의 단계로 이동...)</option>';
  phaseKeys.forEach(function(pk){
    if (pk !== curPhase) html += '<option value="' + pk + '">' + phases[pk].label + ' 단계로 이동</option>';
  });
  html += '</select>';
  html += '</div>';

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
  }).catch(function (err) {
      console.error('[pdLoadIssues]', err);
      if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
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
  // v13.61: projGet/msGetByProject 결과를 calcHoursByMilestone에 전달 (중복 fetch 제거)
  Promise.all([
    projGet(projId),
    msGetByProject(projId)
  ]).then(function (results) {
    var proj = results[0];
    var milestones = results[1];
    return calcHoursByMilestone(projId, { proj: proj, milestones: milestones }).then(function (msHours) {
      return { proj: proj, milestones: milestones, msHours: msHours };
    });
  }).then(function (results) {
    var msHours = results.msHours;
    var proj = results.proj;
    var milestones = results.milestones;
    milestones.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    var totalH = 0;
    var personMap = {};
    var untaggedCount = (msHours._meta && msHours._meta.untaggedCount) || 0;
    Object.keys(msHours).forEach(function (mid) {
      if (mid === '_meta') return;
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
      h += '<div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px">';
      h += '<span style="font-size:10px;color:var(--t5)">마일스톤별 투입' + (untaggedCount > 0 ? ' <span style="color:#F59E0B" title="마일스톤 태그 없이 날짜로 추정 집계된 레코드 수">⚠️ 미태깅 ' + untaggedCount + '건</span>' : '') + '</span>';
      h += '<button class="btn btn-g btn-s" style="font-size:9px;padding:2px 6px" onclick="pdAutoTagWork(\'' + projId + '\')" title="업무일지 레코드를 마일스톤 날짜 구간으로 자동 태깅">🏷 자동 태깅</button>';
      h += '</div>';
      milestones.forEach(function (m) {
        var mH = msHours[m.id];
        var hrs = mH ? mH.hours : 0;
        var ut = mH ? mH.untagged : 0;
        var mSt = (typeof PROJ_STATUS !== 'undefined' ? PROJ_STATUS[m.status] : null) || { icon: '⏳', label: m.status, color: '#94A3B8', bg: 'rgba(148,163,184,.15)' };
        h += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--bd)">';
        h += '<span style="font-size:10px">' + mSt.icon + '</span>';
        h += '<span style="flex:1;font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(m.name) + '</span>';
        if (ut > 0) h += '<span style="font-size:9px;color:#F59E0B" title="날짜 추정 집계">~' + ut + '</span>';
        h += '<span style="font-size:10px;color:var(--ac);font-weight:600">' + hrs + 'h</span>';
        h += '</div>';
      });
    }

    if (totalH === 0 && milestones.length === 0) {
      h = '<div style="text-align:center;color:var(--t6);font-size:11px;padding:20px 0">투입실적 데이터가 없습니다.</div>';
    }

    wrap.innerHTML = h;
  }).catch(function (err) {
      console.error('[pdLoadWork]', err);
      if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

/* 업무일지 레코드를 프로젝트 마일스톤의 날짜 구간으로 자동 태깅 */
function pdAutoTagWork(projId) {
  if (typeof apiFetch !== 'function') return;
  var overwrite = confirm('미태깅 레코드만 태깅합니다.\n확인: 미태깅만 태깅 / 취소: 기존 태그도 덮어쓰기\n\n[확인] 누를까요?');
  apiFetch('/api/archives/records/auto-tag-milestones', {
    method: 'POST',
    body: JSON.stringify({ projectId: projId, overwrite: !overwrite })
  }).then(function (r) {
    var d = r && r.data ? r.data : {};
    if (d.reason) { if (typeof showToast === 'function') showToast(d.reason, 'warn'); return; }
    if (typeof showToast === 'function') showToast('자동 태깅 완료: ' + (d.tagged || 0) + '건');
    if (typeof invalidateArchiveCache === 'function') invalidateArchiveCache();
    pdLoadWork(projId);
  }).catch(function (err) {
    console.error('[pdAutoTagWork]', err);
    if (typeof showToast === 'function') showToast('태깅 실패: ' + ((err && err.message) || '오류'), 'error');
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
      h += '<div class="pdChkItem pdChkRow" draggable="true" data-chkid="' + item.id + '" data-projid="' + projId + '" data-phase="' + phase + '" data-idx="' + idx + '" style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--bd);cursor:grab" ondragstart="pdChkDragStart(event)" ondragover="pdChkDragOver(event)" ondrop="pdChkDrop(event)">';
      h += '<span style="color:var(--t6);font-size:10px;cursor:grab;flex-shrink:0" title="드래그하여 순서 변경">⠿</span>';
      h += '<input type="checkbox" ' + (item.done ? 'checked' : '') + ' onchange="pdToggleCheck(\'' + projId + '\',\'' + item.id + '\',this)" style="cursor:pointer;flex-shrink:0">';
      h += '<span class="pdChkTextSpan" data-projid="' + projId + '" data-chkid="' + item.id + '" style="flex:1;font-size:11px;' + checkStyle + ';cursor:text" title="클릭하여 수정" onclick="pdEditCheckInline(this)">' + eH(item.text) + '</span>';
      h += '<input type="date" value="' + (item.doneDate || localDate()) + '" onchange="pdChangeDoneDate(\'' + projId + '\',\'' + item.id + '\',this.value)" style="font-size:9px;padding:1px 2px;border:1px solid var(--bd);border-radius:3px;background:var(--bg-i);color:var(--t6);width:auto;' + (item.done ? '' : 'visibility:hidden;width:0;padding:0;border:0;') + '" title="완료 날짜">';
      if (item.dueDate && !item.done) {
        var overdue = item.dueDate < localDate();
        h += '<span style="font-size:9px;color:' + (overdue ? '#EF4444' : 'var(--t6)') + ';white-space:nowrap">' + (overdue ? '⚠️' : '') + item.dueDate + '</span>';
      }
      h += '<button style="background:none;border:none;color:var(--t6);cursor:pointer;font-size:10px;padding:0 2px;flex-shrink:0" onclick="pdDeleteCheck(\'' + projId + '\',\'' + item.id + '\',this)" title="삭제">✕</button>';
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
function pdToggleCheck(projId, chkId, checkbox) {
  var row = checkbox.closest('.pdChkRow');
  var textSpan = row ? row.querySelector('.pdChkTextSpan') : null;
  var dateInput = row ? row.querySelector('input[type="date"]') : null;
  var isDone = checkbox.checked;
  var doneDate = isDone ? (dateInput ? dateInput.value || localDate() : localDate()) : null;

  // 즉시 UI 반영
  if (textSpan) {
    textSpan.style.textDecoration = isDone ? 'line-through' : 'none';
    textSpan.style.color = isDone ? 'var(--t6)' : 'var(--t2)';
  }
  if (dateInput) {
    if (isDone) {
      dateInput.value = doneDate;
      dateInput.style.cssText = 'font-size:9px;padding:1px 2px;border:1px solid var(--bd);border-radius:3px;background:var(--bg-i);color:var(--t6);width:auto';
    } else {
      dateInput.style.cssText = 'visibility:hidden;width:0;padding:0;border:0';
    }
  }

  toggleCheckItem(chkId, '', doneDate).then(function () {
    pdRefreshChkProgress(projId);
  }).catch(function (err) {
    console.warn('[pdToggleCheck]', err);
    checkbox.checked = !isDone;
    if (textSpan) { textSpan.style.textDecoration = !isDone ? 'line-through' : 'none'; textSpan.style.color = !isDone ? 'var(--t6)' : 'var(--t2)'; }
  });
}

function pdDeleteCheck(projId, chkId, btn) {
  var row = btn.closest('.pdChkRow');
  if (row) row.style.opacity = '0.3';
  chkDel(chkId).then(function () {
    if (row) row.remove();
    pdRefreshChkProgress(projId);
  }).catch(function (err) {
    console.warn('[pdDeleteCheck]', err);
    if (row) row.style.opacity = '1';
  });
}

/* 완료 날짜 변경 */
function pdChangeDoneDate(projId, chkId, newDate) {
  var sep = chkId.indexOf('::');
  if (sep >= 0 && typeof apiFetch === 'function' && (typeof AUTH_SKIP === 'undefined' || !AUTH_SKIP)) {
    var parentId = chkId.slice(0, sep), idx = parseInt(chkId.slice(sep + 2), 10);
    apiFetch('/api/checklists/' + encodeURIComponent(parentId)).then(function (r) {
      var row = r.data;
      var items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
      if (idx >= 0 && idx < items.length) {
        items[idx].doneDate = newDate;
        return apiFetch('/api/checklists/' + encodeURIComponent(parentId), { method: 'PUT', body: JSON.stringify({ items: items }) });
      }
    }).catch(function (err) { console.warn('[pdChangeDoneDate]', err); });
  } else {
    var store = db.transaction('checklists', 'readwrite').objectStore('checklists');
    var req = store.get(chkId);
    req.onsuccess = function () {
      var item = req.result;
      if (item) { item.doneDate = newDate; store.put(item); }
    };
  }
}

/* 체크리스트 진행률 카운터 인라인 갱신 */
function pdRefreshChkProgress(projId) {
  chkGetByProject(projId).then(function (allChk) {
    var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
    // 개요 탭 카운터 갱신
    var panel = document.getElementById('projDetailPanel');
    if (!panel) return;
    var overviewCounters = panel.querySelectorAll('[data-chk-counter]');
    var phaseKeys = Object.keys(phases);
    phaseKeys.forEach(function (pk) {
      var items = allChk.filter(function (c) { return c.phase === pk; });
      var done = items.filter(function (c) { return c.done; }).length;
      var pct = items.length ? Math.round(done / items.length * 100) : 0;
      // 라이프사이클 단계 진행바의 카운터도 갱신
      var phCounters = panel.querySelectorAll('[data-phase-count="' + pk + '"]');
      phCounters.forEach(function (el) { el.textContent = done + '/' + items.length; });
    });
  });
}

/* ═══ 체크리스트 항목 인라인 수정 ═══ */
function pdEditCheckInline(span) {
  if (span.querySelector('input')) return;
  var oldText = span.textContent;
  var projId = span.getAttribute('data-projid');
  var chkId = span.getAttribute('data-chkid');
  var input = document.createElement('input');
  input.type = 'text';
  input.value = oldText;
  input.style.cssText = 'width:100%;font-size:11px;padding:2px 6px;border:1px solid var(--ac);border-radius:3px;background:var(--bg-p);color:var(--t2);outline:none';
  var saving = false;
  function save() {
    if (saving) return;
    saving = true;
    pdSaveCheckInline(span, projId, chkId, input.value.trim(), oldText);
  }
  input.onkeydown = function (e) {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { span.textContent = oldText; }
  };
  input.onblur = function () { save(); };
  span.textContent = '';
  span.appendChild(input);
  input.focus();
  input.select();
}

function pdSaveCheckInline(span, projId, chkId, newText, oldText) {
  // 즉시 span 텍스트 복원 (입력 제거)
  span.textContent = newText || oldText;
  if (!newText || newText === oldText) return;

  var sep = chkId.indexOf('::');
  if (sep >= 0 && typeof apiFetch === 'function' && (typeof AUTH_SKIP === 'undefined' || !AUTH_SKIP)) {
    var parentId = chkId.slice(0, sep);
    var idx = parseInt(chkId.slice(sep + 2), 10);
    apiFetch('/api/checklists/' + encodeURIComponent(parentId)).then(function (r) {
      var row = r.data;
      var items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
      if (idx >= 0 && idx < items.length) {
        items[idx].text = newText;
        return apiFetch('/api/checklists/' + encodeURIComponent(parentId), { method: 'PUT', body: JSON.stringify({ items: items }) });
      }
    }).catch(function (err) {
      console.error('[pdSaveCheckInline]', err);
      span.textContent = oldText;
      if (typeof showToast === 'function') showToast('수정 실패', 'error');
    });
  } else {
    var store = db.transaction('checklists', 'readwrite').objectStore('checklists');
    var req = store.get(chkId);
    req.onsuccess = function () {
      var item = req.result;
      if (item) { item.text = newText; store.put(item); }
    };
  }
}

/* 개요 탭 체크리스트 목록 HTML 생성 (추가/삭제/토글 시 부분 갱신용) */
function renderOverviewChkListHtml(projId, phase, phMeta, items) {
  var out = '';
  if (items.length > 0) {
    var done = items.filter(function (c) { return c.done; }).length;
    var pct = Math.round(done / items.length * 100);
    out += '<div style="height:4px;background:var(--bg-i);border-radius:2px;overflow:hidden;margin-bottom:8px"><div style="height:100%;width:' + pct + '%;background:' + phMeta.color + ';border-radius:2px"></div></div>';
    items.forEach(function (item) {
      var cStyle = item.done ? 'text-decoration:line-through;color:var(--t6)' : 'color:var(--t2)';
      out += '<div class="pdChkRow" data-chkid="' + item.id + '" data-projid="' + projId + '" data-phase="' + phase + '" style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--bd)">';
      out += '<input type="checkbox" ' + (item.done ? 'checked' : '') + ' onchange="pdToggleCheck(\'' + projId + '\',\'' + item.id + '\',this)" style="cursor:pointer;flex-shrink:0">';
      out += '<span class="pdChkTextSpan" data-projid="' + projId + '" data-chkid="' + item.id + '" style="flex:1;font-size:11px;' + cStyle + ';cursor:text" title="클릭하여 수정" onclick="pdEditCheckInline(this)">' + eH(item.text) + '</span>';
      out += '<input type="date" value="' + (item.doneDate || localDate()) + '" onchange="pdChangeDoneDate(\'' + projId + '\',\'' + item.id + '\',this.value)" style="font-size:9px;padding:1px 2px;border:1px solid var(--bd);border-radius:3px;background:var(--bg-i);color:var(--t6);width:auto;' + (item.done ? '' : 'visibility:hidden;width:0;padding:0;border:0;') + '" title="완료 날짜">';
      out += '<button style="background:none;border:none;color:var(--t6);cursor:pointer;font-size:10px;padding:0 2px;flex-shrink:0" onclick="pdDeleteCheck(\'' + projId + '\',\'' + item.id + '\',this)" title="삭제">✕</button>';
      out += '</div>';
    });
  } else {
    out += '<div style="text-align:center;color:var(--t6);font-size:11px;padding:12px 0">체크리스트 항목이 없습니다.<br><button class="btn btn-g btn-s" style="margin-top:6px;font-size:10px" onclick="pdGenerateChecklists(\'' + projId + '\')">기본 체크리스트 생성</button></div>';
  }
  return out;
}

/* 개요 탭 체크리스트만 부분 갱신 (패널 전체 리로드 없이) */
function pdRefreshOverviewChk(projId, phase) {
  var listEl = document.getElementById('pdOverviewChkList');
  if (!listEl || typeof chkGetByPhase !== 'function') return Promise.resolve();
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  var phMeta = phases[phase] || { label: phase, icon: '', color: '#94A3B8' };
  return chkGetByPhase(projId, phase).then(function (items) {
    items.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    listEl.innerHTML = renderOverviewChkListHtml(projId, phase, phMeta, items);
    var stat = document.getElementById('pdOverviewChkStat');
    if (stat) {
      if (items.length > 0) {
        var done = items.filter(function (c) { return c.done; }).length;
        var pct = Math.round(done / items.length * 100);
        stat.textContent = done + '/' + items.length + ' (' + pct + '%)';
        stat.style.display = '';
      } else {
        stat.style.display = 'none';
      }
    }
  });
}

function pdAddCheck(projId, phase) {
  // 활성 탭에 맞는 input 우선 사용 (감춰진 input에 남은 값이 엉뚱하게 쓰이지 않도록)
  var lifecycleEl = document.getElementById('pdLifecycle');
  var lifecycleVisible = lifecycleEl && lifecycleEl.style.display !== 'none';
  var inpLifecycle = document.getElementById('pdNewChkText');
  var inpOverview = document.getElementById('pdOverviewNewChk');
  var text = '';
  var usedInput = null;
  if (lifecycleVisible && inpLifecycle && inpLifecycle.value.trim()) { text = inpLifecycle.value.trim(); usedInput = inpLifecycle; }
  else if (inpOverview && inpOverview.value.trim()) { text = inpOverview.value.trim(); usedInput = inpOverview; }
  else if (inpLifecycle && inpLifecycle.value.trim()) { text = inpLifecycle.value.trim(); usedInput = inpLifecycle; }
  if (!text) return;
  chkGetByPhase(projId, phase).then(function (items) {
    return createCheckItem({ projectId: projId, phase: phase, text: text, order: items.length });
  }).then(function () {
    if (usedInput) { usedInput.value = ''; usedInput.focus(); }
    // 현재 활성 탭에 해당하는 영역만 부분 갱신 (패널은 유지)
    var lifecycleEl2 = document.getElementById('pdLifecycle');
    var lifecycleNow = lifecycleEl2 && lifecycleEl2.style.display !== 'none';
    if (lifecycleNow && typeof pdShowPhase === 'function') {
      pdShowPhase(projId, phase);
    } else {
      pdRefreshOverviewChk(projId, phase);
    }
  }).catch(function (err) {
      console.error('[pdAddCheck]', err);
      var msg = (err && err.message) ? err.message : '추가 실패';
      if (typeof showToast === 'function') showToast('체크리스트 추가 실패: ' + msg, 'error');
  });
}

function pdShowPhase(projId, phase) {
  chkGetByProject(projId).then(function (allChk) {
    var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
    var el = document.getElementById('pdPhaseChecklists');
    if (el) el.innerHTML = buildPhaseChecklistHtml(projId, phase, allChk, phases);
  }).catch(function (err) {
      console.error('[pdShowPhase]', err);
      if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
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

  // 순서 업데이트: parent row의 items 배열 순서를 직접 변경
  (function () {
    // flat ID에서 parent row id 추출
    var parentId = ids[0] && ids[0].indexOf('::') >= 0 ? ids[0].split('::')[0] : null;
    if (parentId && typeof apiFetch === 'function' && (typeof AUTH_SKIP === 'undefined' || !AUTH_SKIP)) {
      // 서버 모드: parent row를 가져와서 items 배열 순서 변경 후 한 번에 PUT
      apiFetch('/api/checklists/' + encodeURIComponent(parentId)).then(function (r) {
        var row = r.data;
        var rowItems = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
        // ids에서 index 추출하여 새 순서 만들기
        var reordered = ids.map(function (cid) {
          var idx = parseInt(cid.split('::')[1], 10);
          return rowItems[idx];
        }).filter(Boolean);
        reordered.forEach(function (it, i) { it.order = i; });
        return apiFetch('/api/checklists/' + encodeURIComponent(parentId), { method: 'PUT', body: JSON.stringify({ items: reordered }) });
      }).then(function () {
        showProjectDetail(projId).then(function () { pdSwitchTab('lifecycle'); });
      }).catch(function (err) {
        console.error('[pdChkDrop]', err);
        if (typeof showToast === 'function') showToast('순서 변경 실패', 'error');
      });
    } else {
      // 로컬 모드
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
      }).catch(function (err) {
        console.error('[pdChkDrop]', err);
        if (typeof showToast === 'function') showToast('순서 변경 실패', 'error');
      });
    }
  })();
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
    }).catch(function (err) {
        console.error('[pdAdvancePhase:transition]', err);
        if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
    });
  }).catch(function (err) {
      console.error('[pdAdvancePhase]', err);
      if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
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
  }).catch(function (err) {
      console.error('[renderProgressHistoryChart]', err);
      if (typeof showToast === 'function') showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

