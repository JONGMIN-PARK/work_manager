/**
 * 업무 관리자 — 대시보드 위젯 모듈
 */

/* ═══ 대시보드 렌더 ═══ */
async function renderDashboard(projects) {
  var el = document.getElementById('dashCards');
  if (!el) return;

  if (!projects) projects = await projGetAll();

  // 진척률 자동 산출 (아카이브 연동)
  var taskDist = {};
  try { await autoUpdateProgress(); projects = await projGetAll(); } catch (e) { console.warn('[Dashboard]', e); }
  // Integration 1: 업무유형 분포 데이터 로드
  try { taskDist = await calcTaskDistByOrder(); } catch (e) { console.warn('[Dashboard]', e); }

  // 상태별 집계
  var counts = { total: projects.length, active: 0, delayed: 0, done: 0, waiting: 0, hold: 0 };
  var today = localDate();

  projects.forEach(function (p) {
    var st = autoProjectStatus(p);
    if (counts[st] !== undefined) counts[st]++;
  });

  // 금주 마일스톤
  var weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  var wsStr = weekStart.toISOString().slice(0, 10);
  var weStr = weekEnd.toISOString().slice(0, 10);

  var _msEvtData = await Promise.all([msGetAll(), evtGetAll()]);
  var milestones = _msEvtData[0];
  var events = _msEvtData[1];
  var _projMap = {};
  projects.forEach(function (p) { _projMap[p.id] = p; });
  var weekMs = milestones.filter(function (m) {
    return m.endDate >= wsStr && m.endDate <= weStr;
  });

  // 미완료 마일스톤 전체 (done 제외)
  var pendingMs = milestones.filter(function (m) {
    return m.status !== 'done';
  }).sort(function (a, b) {
    return (a.endDate || '9999') < (b.endDate || '9999') ? -1 : 1;
  });

  // 금월 납기
  var monthStart = today.slice(0, 7) + '-01';
  var monthEndDate = new Date(parseInt(today.slice(0, 4)), parseInt(today.slice(5, 7)), 0);
  var monthEnd = monthEndDate.toISOString().slice(0, 10);
  var monthDeadlines = events.filter(function (e) {
    return e.type === 'deadline' && e.startDate >= monthStart && e.startDate <= monthEnd;
  });

  // 지연 프로젝트
  var delayedProjects = projects.filter(function (p) {
    return autoProjectStatus(p) === 'delayed';
  });

  // 렌더
  el.innerHTML =
    // 상태 요약 카드
    '<div class="sg" style="margin-bottom:0">' +
      '<div class="sc"><div class="sl">전체 프로젝트</div><div class="sv">' + counts.total + '</div></div>' +
      '<div class="sc"><div class="sl" style="color:var(--ac-t)">진행중</div><div class="sv bl">' + counts.active + '</div></div>' +
      '<div class="sc" data-drill="delayedProjects" style="cursor:pointer;' + (counts.delayed ? 'border-color:rgba(239,68,68,.4)' : '') + '" onclick="if(typeof dashDrill===\'function\')dashDrill(\'delayedProjects\')" title="클릭: 지연 프로젝트 보기"><div class="sl" style="color:#EF4444">지연</div><div class="sv" style="color:#FCA5A5">' + counts.delayed + '</div></div>' +
      '<div class="sc"><div class="sl" style="color:#10B981">완료</div><div class="sv gr">' + counts.done + '</div></div>' +
    '</div>' +

    // 하단 정보
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px">' +
      // 금월 납기
      '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px">' +
        '<div style="font-size:11px;font-weight:700;color:var(--t4);margin-bottom:8px">🏁 금월 납기</div>' +
        (monthDeadlines.length ?
          monthDeadlines.map(function (e) {
            return '<div style="font-size:11px;color:var(--t3);padding:2px 0">🏁 ' + eH(e.title) + ' <span style="color:var(--t6)">' + e.startDate + '</span></div>';
          }).join('') :
          '<div style="font-size:11px;color:var(--t6)">없음</div>'
        ) +
      '</div>' +
      // 지연 경고
      '<div data-drill="delayedProjects" style="padding:12px;background:' + (delayedProjects.length ? 'rgba(239,68,68,.08)' : 'var(--bg-i)') + ';border:1px solid ' + (delayedProjects.length ? 'rgba(239,68,68,.3)' : 'var(--bd-i)') + ';border-radius:8px' + (delayedProjects.length ? ';cursor:pointer' : '') + '" onclick="if(typeof dashDrill===\'function\')dashDrill(\'delayedProjects\')" title="클릭: 지연 프로젝트 목록 보기">' +
        '<div style="font-size:11px;font-weight:700;color:' + (delayedProjects.length ? '#EF4444' : 'var(--t4)') + ';margin-bottom:8px">⚠️ 지연 프로젝트</div>' +
        (delayedProjects.length ?
          delayedProjects.map(function (p) {
            var overDays = daysDiff(p.endDate, today);
            return '<div style="font-size:11px;color:#FCA5A5;padding:2px 0">' + eH(p.name) + ' <span style="color:var(--t6)">(' + overDays + '일 초과)</span></div>';
          }).join('') :
          '<div style="font-size:11px;color:var(--t6)">없음</div>'
        ) +
      '</div>' +
      // 금주 마일스톤
      '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px">' +
        '<div style="font-size:11px;font-weight:700;color:var(--t4);margin-bottom:8px">◆ 금주 마일스톤</div>' +
        (weekMs.length ?
          weekMs.map(function (m) {
            var mProj = _projMap[m.projectId];
            var mSt = PROJ_STATUS[m.status] || PROJ_STATUS.waiting;
            return '<div style="font-size:11px;color:var(--t3);padding:2px 0;display:flex;align-items:center;gap:4px">' +
              '<span style="color:' + mSt.color + '">' + mSt.icon + '</span> ' +
              eH(m.name) +
              (mProj ? ' <span style="color:var(--t6);font-size:10px">[' + eH(mProj.name || mProj.orderNo) + ']</span>' : '') +
              ' <span style="color:var(--t6);font-size:10px">' + m.endDate + '</span>' +
            '</div>';
          }).join('') :
          '<div style="font-size:11px;color:var(--t6)">없음</div>'
        ) +
      '</div>' +
    '</div>' +

    // 마일스톤 추적 패널 (미완료 전체)
    '<div style="padding:14px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:10px;margin-top:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
        '<div style="font-size:12px;font-weight:700;color:var(--t2)">◆ 마일스톤 추적 <span style="font-size:10px;font-weight:500;color:var(--t5)">(' + pendingMs.length + '개 미완료 / ' + milestones.length + '개 전체)</span></div>' +
      '</div>' +
      (pendingMs.length ?
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:6px">' +
        pendingMs.map(function (m) {
          var mProj = _projMap[m.projectId];
          var mSt = PROJ_STATUS[m.status] || PROJ_STATUS.waiting;
          var isOverdue = m.endDate && m.endDate < today && m.status !== 'hold';
          var borderColor = isOverdue ? '#EF4444' : mSt.color;
          var bgColor = isOverdue ? 'rgba(239,68,68,.06)' : mSt.bg;
          return '<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:' + bgColor + ';border-left:3px solid ' + borderColor + ';border-radius:4px;font-size:11px">' +
            '<span style="font-size:12px">' + mSt.icon + '</span>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-weight:600;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + eH(m.name) + '</div>' +
              '<div style="display:flex;align-items:center;gap:6px;margin-top:1px">' +
                (mProj ? '<span style="color:var(--t5);font-size:10px"><span class="dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + (mProj.color || '#888') + ';margin-right:2px;vertical-align:middle"></span>' + eH(mProj.name || mProj.orderNo) + '</span>' : '') +
                '<span style="color:var(--t6);font-size:10px">' + (m.endDate || '기한없음') + '</span>' +
                (isOverdue ? '<span style="color:#EF4444;font-size:9px;font-weight:600">' + daysDiff(m.endDate, today) + '일 초과</span>' : '') +
              '</div>' +
            '</div>' +
            '<span class="badge" style="background:' + mSt.bg + ';color:' + mSt.color + ';font-size:9px;padding:1px 5px;border-radius:3px;white-space:nowrap">' + mSt.label + '</span>' +
          '</div>';
        }).join('') +
        '</div>' :
        '<div style="font-size:11px;color:var(--t6);text-align:center;padding:8px">모든 마일스톤이 완료되었습니다 ✓</div>'
      ) +
    '</div>' +

    // 팀원 리소스 맵
    buildResourceMap(projects);

  // 파이프라인 요약 위젯
  buildPipelineSummary(projects);

  // 단계 병목 위젯
  buildBottleneckWidget(projects);

  // 수주 현황 위젯
  buildOrderSummary();

  // 이슈 현황 위젯
  if (typeof issueGetAll === 'function') {
    buildIssueSummary();
  }

  // Integration 1: 업무유형 분포 렌더
  if (typeof calcTaskDistByOrder === 'function') {
    buildTaskDistSection(projects, taskDist);
  }

  // Feature 7: 건강 스코어카드
  await buildHealthScorecard(projects);

  // Feature 10: 보고서 버튼 추가
  var dashEl = document.getElementById('dashCards');
  if (dashEl) {
    dashEl.innerHTML += '<div style="margin-top:10px;text-align:right">' +
      '<button class="btn btn-g btn-s" onclick="showReportModal()" style="font-size:11px;padding:5px 14px">📊 보고서 생성</button>' +
    '</div>';
  }
}

/* ═══ 팀원 리소스 맵 ═══ */
function buildResourceMap(projects) {
  // 진행중/지연 프로젝트만 대상
  var activeProjs = projects.filter(function (p) {
    var st = autoProjectStatus(p);
    return st === 'active' || st === 'delayed' || st === 'waiting';
  });

  // 담당자 → 프로젝트 매핑
  var assigneeMap = {};
  activeProjs.forEach(function (p) {
    (p.assignees || []).forEach(function (a) {
      if (!assigneeMap[a]) assigneeMap[a] = [];
      assigneeMap[a].push(p);
    });
  });

  var assignees = Object.keys(assigneeMap).sort();
  if (!assignees.length) return '';

  var maxCount = 0;
  assignees.forEach(function (a) { if (assigneeMap[a].length > maxCount) maxCount = assigneeMap[a].length; });

  var el = document.getElementById('dashCards');
  if (!el) return '';

  var html = '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px;margin-top:10px">' +
    '<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px">👥 팀원 리소스 맵 <span style="font-size:10px;font-weight:400;color:var(--t6)">(' + assignees.length + '명 · 진행/대기 프로젝트 기준)</span></div>' +
    '<div style="display:flex;flex-direction:column;gap:6px">';

  assignees.forEach(function (a) {
    var projs = assigneeMap[a];
    var count = projs.length;
    // 히트맵 강도: 3개 이상이면 과부하
    var intensity = count <= 1 ? 'rgba(16,185,129,.15)' : count <= 2 ? 'rgba(59,130,246,.15)' : count <= 3 ? 'rgba(245,158,11,.15)' : 'rgba(239,68,68,.15)';
    var borderColor = count <= 1 ? '#10B981' : count <= 2 ? '#3B82F6' : count <= 3 ? '#F59E0B' : '#EF4444';
    var loadLabel = count <= 1 ? '여유' : count <= 2 ? '적정' : count <= 3 ? '다소 많음' : '과부하';
    var loadColor = borderColor;
    var displayName = typeof shortName === 'function' ? shortName(a) : a;

    html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:' + intensity + ';border-left:3px solid ' + borderColor + ';border-radius:4px">' +
      '<div style="min-width:60px;font-size:11px;font-weight:600;color:var(--t2);cursor:pointer;text-decoration:underline dotted" onclick="showPersonReport(\'' + eA(a) + '\')" title="' + eH(a) + ' 리소스 리포트 보기">' + eH(displayName) + '</div>' +
      '<div style="flex:1;display:flex;gap:4px;flex-wrap:wrap">';

    projs.forEach(function (p) {
      var st = autoProjectStatus(p);
      html += '<span style="font-size:9px;padding:2px 6px;border-radius:3px;background:' + p.color + '20;color:' + p.color + ';border:1px solid ' + p.color + '40;white-space:nowrap">' + eH((p.name || p.orderNo).slice(0, 10)) +
        (p.progress ? ' ' + p.progress + '%' : '') + '</span>';
    });

    html += '</div>' +
      '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">' +
        '<span style="font-size:10px;font-weight:600;color:' + loadColor + '">' + count + '건</span>' +
        '<span style="font-size:9px;color:' + loadColor + ';padding:1px 5px;background:' + intensity + ';border-radius:3px">' + loadLabel + '</span>' +
      '</div>' +
    '</div>';
  });

  html += '</div></div>';

  el.innerHTML += html;

  // AI 일정 인사이트 패널
  el.innerHTML += '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px;margin-top:10px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<div style="font-size:12px;font-weight:700;color:var(--t1)">🤖 AI 일정 인사이트</div>' +
      '<button class="btn btn-p btn-s" id="aiInsightBtn" onclick="runAiInsight()">분석 실행</button>' +
    '</div>' +
    '<div id="aiInsightResult" style="font-size:11px;color:var(--t5)">버튼을 눌러 프로젝트 일정 충돌, 과부하, 배분 최적화를 AI로 분석합니다.</div>' +
  '</div>';

  return '';
}

/* ═══ AI 일정 인사이트 ═══ */
async function runAiInsight() {
  var btn = document.getElementById('aiInsightBtn');
  var resultEl = document.getElementById('aiInsightResult');
  if (!btn || !resultEl) return;

  // API 키 확인
  var key = (typeof gAk === 'function') ? gAk() : null;
  if (!key) {
    // 로컬 분석 폴백
    resultEl.innerHTML = await buildLocalInsight();
    return;
  }

  btn.disabled = true;
  btn.textContent = '분석중...';
  resultEl.innerHTML = '<div class="sld"><div class="sp"></div>AI 분석 중...</div>';

  try {
    var prompt = await buildInsightPrompt();
    var txt = await callAI(prompt);
    resultEl.innerHTML = '<div style="font-size:10px;color:var(--t6);margin-bottom:4px">✨ AI 응답</div>' + (typeof rMD === 'function' ? rMD(txt) : '<pre style="white-space:pre-wrap;font-size:11px">' + eH(txt) + '</pre>');
  } catch (err) {
    resultEl.innerHTML = '<div style="color:#EF4444;font-size:11px">⚠️ AI 호출 실패: ' + eH(err.message) + '</div>' + await buildLocalInsight();
  }
  btn.disabled = false;
  btn.textContent = '분석 실행';
}

async function buildInsightPrompt() {
  var _ipData = await Promise.all([projGetAll(), msGetAll(), evtGetAll()]);
  var projects = _ipData[0];
  var milestones = _ipData[1];
  var events = _ipData[2];
  var today = localDate();

  // 이슈 데이터 로드
  var issues = [];
  try { if (typeof issueGetAll === 'function') issues = await issueGetAll(); } catch (e) { console.warn('[Dashboard]', e); }

  var lines = [];
  lines.push('당신은 프로젝트 라이프사이클 관리 전문가입니다. 수주→설계→제작→검수→납품→A/S 전 과정의 데이터를 분석해주세요.');
  lines.push('오늘: ' + today);
  lines.push('');
  lines.push('[프로젝트 목록]');
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  projects.forEach(function (p) {
    var st = autoProjectStatus(p);
    var phaseName = p.currentPhase && phases[p.currentPhase] ? phases[p.currentPhase].label : '미지정';
    var phaseInfo = '';
    if (p.phases) {
      var phParts = [];
      Object.keys(p.phases).forEach(function (k) {
        var ph = p.phases[k];
        if (ph.status && ph.status !== 'waiting') {
          var phLabel = phases[k] ? phases[k].label : k;
          phParts.push(phLabel + ':' + ph.status + (ph.startDate ? '(' + ph.startDate + ')' : ''));
        }
      });
      if (phParts.length) phaseInfo = ' | 단계이력:' + phParts.join(',');
    }
    lines.push('- ' + (p.name || p.orderNo) + ' | ' + p.startDate + '~' + p.endDate + ' | 상태:' + (PROJ_STATUS[st] || {}).label + ' | 현재단계:' + phaseName + ' | 진척:' + (p.progress || 0) + '% | 담당:' + (p.assignees || []).join(',') + phaseInfo + (p.dependencies && p.dependencies.length ? ' | 선행:' + p.dependencies.length + '개' : ''));
  });
  lines.push('');
  var _ipProjMap = {};
  projects.forEach(function (p) { _ipProjMap[p.id] = p; });
  lines.push('[마일스톤]');
  milestones.forEach(function (m) {
    var proj = _ipProjMap[m.projectId];
    lines.push('- ' + m.name + ' (' + (proj ? proj.name : '?') + ') | ~' + m.endDate + ' | ' + (PROJ_STATUS[m.status] || {}).label);
  });
  lines.push('');
  lines.push('[일정/이벤트]');
  events.forEach(function (e) {
    var t = EVT_TYPE[e.type] || EVT_TYPE.etc;
    lines.push('- ' + t.label + ': ' + e.title + ' | ' + e.startDate + '~' + e.endDate + (e.repeat ? ' (반복:' + e.repeat + ')' : ''));
  });

  // Integration 10: 아카이브 데이터 추가
  if (typeof getRecentArchiveWeeks === 'function') {
    try {
      var archWeeks = await getRecentArchiveWeeks(4);
      if (archWeeks.length) {
        lines.push('');
        lines.push('[주간 업무 실적 (최근 ' + archWeeks.length + '주)]');
        archWeeks.forEach(function (w) {
          var dr = w.dateRange || [];
          var dateLabel = dr.length ? dr[0] + '~' + (dr[1] || dr[0]) : '?';
          lines.push('- ' + (w.label || dateLabel) + ': ' + (w.totalHours || 0) + 'h, ' + (w.selectedNames || []).length + '명');
          // 인원별 시간
          if (w.data && Array.isArray(w.data)) {
            var personHours = {};
            var personAbbr = {};
            w.data.forEach(function (r) {
              personHours[r.name] = (personHours[r.name] || 0) + (r.hours || 0);
              var abbr = (r.abbr || 'G').charAt(0).toUpperCase();
              if (!personAbbr[r.name]) personAbbr[r.name] = {};
              personAbbr[r.name][abbr] = (personAbbr[r.name][abbr] || 0) + (r.hours || 0);
            });
            Object.keys(personHours).sort().forEach(function (name) {
              var abbrStr = Object.entries(personAbbr[name]).map(function (e) { return e[0] + ':' + Math.round(e[1] * 10) / 10 + 'h'; }).join(',');
              lines.push('  ' + name + ': ' + Math.round(personHours[name] * 10) / 10 + 'h (' + abbrStr + ')');
            });
          }
          // 분장 분포
          var ad = w.abbrDist || {};
          var abbrLine = Object.entries(ad).map(function (e) { return e[0] + ':' + Math.round(e[1] * 10) / 10 + 'h'; }).join(', ');
          if (abbrLine) lines.push('  분장: ' + abbrLine);
        });
      }
    } catch (e) { console.warn('[Dashboard]', e); }
  }

  // 이슈 데이터
  if (issues.length) {
    var deptMap = typeof DEPT !== 'undefined' ? DEPT : {};
    var issueTypes = typeof ISSUE_TYPE !== 'undefined' ? ISSUE_TYPE : {};
    var issueUrgencies = typeof ISSUE_URGENCY !== 'undefined' ? ISSUE_URGENCY : {};
    lines.push('');
    lines.push('[이슈 현황] 전체 ' + issues.length + '건');
    var openIssues = issues.filter(function (i) { return i.status !== 'closed' && i.status !== 'resolved'; });
    lines.push('미해결: ' + openIssues.length + '건');
    openIssues.forEach(function (iss) {
      var proj = _ipProjMap[iss.projectId];
      var projName = proj ? proj.name : (iss.orderNo || '?');
      var deptLabel = deptMap[iss.dept] ? deptMap[iss.dept].label : iss.dept;
      var typeLabel = issueTypes[iss.type] ? issueTypes[iss.type].label : iss.type;
      var urgLabel = issueUrgencies[iss.urgency] ? issueUrgencies[iss.urgency].label : iss.urgency;
      var phLabel = phases[iss.phase] ? phases[iss.phase].label : iss.phase;
      lines.push('- ' + iss.title + ' | ' + projName + ' | ' + phLabel + ' | ' + deptLabel + ' | ' + typeLabel + ' | ' + urgLabel + ' | ' + iss.status + ' | ' + iss.reportDate);
    });
  }

  lines.push('');
  lines.push('업무분장 약자: A=CS현장, B=제작, D=개발, G=일반, M=관리, S=영업지원');
  lines.push('부서: 설계, 제조, 전장, 제어, 공정, 소프트웨어');
  lines.push('');
  lines.push('다음 형식으로 한국어 분석:');
  lines.push('## ⚠️ 일정 충돌 감지');
  lines.push('- 겹치는 일정, 동일 담당자 중복 배정 등');
  lines.push('## 🔥 과부하 경고');
  lines.push('- 담당자별 동시 진행 프로젝트 수, 과부하 위험');
  lines.push('## 📊 지연 위험 / 단계 병목 분석');
  lines.push('- 기한 임박, 진척률 부족, 마일스톤 지연 위험');
  lines.push('- 특정 단계에 오래 체류 중인 프로젝트, 평균 대비 초과 단계');
  lines.push('## 🎫 이슈 패턴 분석');
  lines.push('- 부서별 이슈 집중도, 반복 이슈, 긴급 이슈 대응 필요');
  lines.push('## 📋 아카이브-프로젝트 교차 분석');
  lines.push('- 실제 투입시간 vs 예상시간 비교, 미배정 인원, 미착수 프로젝트');
  lines.push('## 💡 최적 배분 제안');
  lines.push('- 리소스 재배분, 일정 조정, 이슈 집중 부서 지원 제안');

  return lines.join('\n');
}

/* ═══ Integration 1: 프로젝트별 업무유형 분포 ═══ */
function buildTaskDistSection(projects, taskDist) {
  var el = document.getElementById('dashCards');
  if (!el || !taskDist) return;

  // 수주번호가 있는 프로젝트만 대상
  var projsWithDist = projects.filter(function (p) {
    return p.orderNo && taskDist[p.orderNo.trim()];
  });
  if (!projsWithDist.length) return;

  // ABR 색상 참조
  var abrColors = (typeof ABR !== 'undefined') ? ABR : { A: '#EF4444', B: '#3B82F6', D: '#10B981', G: '#8B5CF6', S: '#F59E0B', M: '#64748B' };
  var amLabels = (typeof AM !== 'undefined') ? AM : {};

  var html = '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px;margin-top:10px">' +
    '<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px">📊 업무유형 분포 <span style="font-size:10px;font-weight:400;color:var(--t6)">(아카이브 기반 · 프로젝트별 업무분장 비율)</span></div>' +
    '<div style="display:flex;flex-direction:column;gap:8px">';

  projsWithDist.forEach(function (p) {
    var dist = taskDist[p.orderNo.trim()];
    var types = Object.keys(dist).sort();
    var totalHours = 0;
    types.forEach(function (t) { totalHours += dist[t]; });
    if (totalHours <= 0) return;

    // 프로젝트 헤더
    html += '<div style="padding:8px;background:var(--bg-c);border:1px solid var(--bd2);border-radius:6px;border-left:3px solid ' + (p.color || '#888') + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
        '<span style="font-size:11px;font-weight:600;color:var(--t2)">' + eH(p.name || p.orderNo) + '</span>' +
        '<span style="font-size:10px;color:var(--t5)">' + Math.round(totalHours * 10) / 10 + 'h</span>' +
      '</div>';

    // 스택드 바
    html += '<div style="display:flex;height:16px;border-radius:4px;overflow:hidden;background:var(--bg-i)">';
    types.forEach(function (t) {
      var pct = (dist[t] / totalHours * 100);
      if (pct < 1) return;
      var color = abrColors[t] || '#888';
      html += '<div style="width:' + pct.toFixed(1) + '%;background:' + color + ';position:relative" title="' + (amLabels[t] || t) + ': ' + Math.round(dist[t] * 10) / 10 + 'h (' + Math.round(pct) + '%)"></div>';
    });
    html += '</div>';

    // 범례
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">';
    types.forEach(function (t) {
      var pct = Math.round(dist[t] / totalHours * 100);
      if (pct < 1) return;
      var color = abrColors[t] || '#888';
      var label = amLabels[t] || t;
      html += '<span style="font-size:9px;color:var(--t4);display:flex;align-items:center;gap:2px"><span style="width:8px;height:8px;border-radius:2px;background:' + color + ';display:inline-block"></span>' + eH(label) + ' ' + pct + '%</span>';
    });
    html += '</div></div>';
  });

  html += '</div></div>';
  el.innerHTML += html;
}

async function buildLocalInsight() {
  var _liData = await Promise.all([projGetAll(), msGetAll(), evtGetAll()]);
  var projects = _liData[0];
  var milestones = _liData[1];
  var events = _liData[2];
  var today = localDate();
  var html = '';
  var _liProjMap = {};
  projects.forEach(function (p) { _liProjMap[p.id] = p; });

  // 1. 일정 충돌 감지: 같은 날짜에 같은 담당자가 여러 프로젝트
  var conflicts = [];
  var assigneeDates = {};
  projects.forEach(function (p) {
    if (!p.assignees || !p.assignees.length || !p.startDate || !p.endDate) return;
    var st = autoProjectStatus(p);
    if (st === 'done') return;
    p.assignees.forEach(function (a) {
      if (!assigneeDates[a]) assigneeDates[a] = [];
      assigneeDates[a].push({ name: p.name, start: p.startDate, end: p.endDate });
    });
  });
  Object.keys(assigneeDates).forEach(function (a) {
    var projs = assigneeDates[a];
    for (var i = 0; i < projs.length; i++) {
      for (var j = i + 1; j < projs.length; j++) {
        if (projs[i].start <= projs[j].end && projs[j].start <= projs[i].end) {
          conflicts.push(a + ': ' + projs[i].name + ' ↔ ' + projs[j].name);
        }
      }
    }
  });

  html += '<div style="margin-top:6px"><strong style="color:var(--t2)">⚠️ 일정 충돌</strong>';
  if (conflicts.length) {
    html += '<ul style="margin:4px 0;padding-left:16px">';
    conflicts.forEach(function (c) { html += '<li style="color:var(--t3);padding:1px 0">' + eH(c) + '</li>'; });
    html += '</ul>';
  } else {
    html += '<div style="color:var(--t6);padding:2px 0">충돌 없음</div>';
  }
  html += '</div>';

  // 2. 과부하 경고
  var overloaded = [];
  Object.keys(assigneeDates).forEach(function (a) {
    var active = assigneeDates[a].filter(function (p) { return p.start <= today && p.end >= today; });
    if (active.length >= 3) overloaded.push(a + ' (' + active.length + '건 동시 진행)');
  });
  html += '<div style="margin-top:6px"><strong style="color:var(--t2)">🔥 과부하 경고</strong>';
  if (overloaded.length) {
    html += '<ul style="margin:4px 0;padding-left:16px">';
    overloaded.forEach(function (o) { html += '<li style="color:#EF4444;padding:1px 0">' + eH(o) + '</li>'; });
    html += '</ul>';
  } else {
    html += '<div style="color:var(--t6);padding:2px 0">과부하 없음</div>';
  }
  html += '</div>';

  // 3. 지연 위험
  var risks = [];
  projects.forEach(function (p) {
    var st = autoProjectStatus(p);
    if (st === 'done') return;
    if (st === 'delayed') {
      risks.push(p.name + ' — ' + daysDiff(p.endDate, today) + '일 초과 지연');
    } else if (p.endDate) {
      var remain = daysDiff(today, p.endDate);
      if (remain <= 7 && remain > 0 && (p.progress || 0) < 80) {
        risks.push(p.name + ' — ' + remain + '일 남음, 진척률 ' + (p.progress || 0) + '%');
      }
    }
  });
  milestones.forEach(function (m) {
    if (m.status === 'done') return;
    if (m.endDate && m.endDate < today) {
      var proj = _liProjMap[m.projectId];
      risks.push('마일스톤 "' + m.name + '" (' + (proj ? proj.name : '?') + ') — ' + daysDiff(m.endDate, today) + '일 초과');
    }
  });
  html += '<div style="margin-top:6px"><strong style="color:var(--t2)">📊 지연 위험</strong>';
  if (risks.length) {
    html += '<ul style="margin:4px 0;padding-left:16px">';
    risks.forEach(function (r) { html += '<li style="color:#F59E0B;padding:1px 0">' + eH(r) + '</li>'; });
    html += '</ul>';
  } else {
    html += '<div style="color:var(--t6);padding:2px 0">위험 없음</div>';
  }
  html += '</div>';

  // 4. 단계 병목 분석
  var bottlenecks = [];
  var phaseKeys = typeof PROJ_PHASE !== 'undefined' ? Object.keys(PROJ_PHASE) : [];
  projects.forEach(function (p) {
    if (!p.phases || !p.currentPhase) return;
    var cur = p.phases[p.currentPhase];
    if (cur && cur.status === 'active' && cur.startDate) {
      var stayDays = daysDiff(cur.startDate, today);
      if (stayDays >= 30) {
        var phLabel = PROJ_PHASE && PROJ_PHASE[p.currentPhase] ? PROJ_PHASE[p.currentPhase].label : p.currentPhase;
        bottlenecks.push(p.name + ' — ' + phLabel + ' 단계 ' + stayDays + '일째 체류');
      }
    }
  });
  html += '<div style="margin-top:6px"><strong style="color:var(--t2)">🔀 단계 병목</strong>';
  if (bottlenecks.length) {
    html += '<ul style="margin:4px 0;padding-left:16px">';
    bottlenecks.forEach(function (b) { html += '<li style="color:#F59E0B;padding:1px 0">' + eH(b) + '</li>'; });
    html += '</ul>';
  } else {
    html += '<div style="color:var(--t6);padding:2px 0">병목 없음</div>';
  }
  html += '</div>';

  // 5. 이슈 패턴 분석
  if (typeof issueGetAll === 'function') {
    try {
      var issues = await issueGetAll();
      var openIssues = issues.filter(function (i) { return i.status !== 'closed' && i.status !== 'resolved'; });
      var issueItems = [];
      if (openIssues.length) {
        // 긴급 이슈
        var urgents = openIssues.filter(function (i) { return i.urgency === 'urgent'; });
        if (urgents.length) {
          issueItems.push('🔴 긴급 이슈 ' + urgents.length + '건 미해결: ' + urgents.map(function (i) { return i.title; }).join(', '));
        }
        // 부서별 집중도
        var deptCounts = {};
        var deptLabels = typeof DEPT !== 'undefined' ? DEPT : {};
        openIssues.forEach(function (i) {
          deptCounts[i.dept] = (deptCounts[i.dept] || 0) + 1;
        });
        Object.keys(deptCounts).forEach(function (dk) {
          if (deptCounts[dk] >= 3) {
            var dl = deptLabels[dk] ? deptLabels[dk].label : dk;
            issueItems.push(dl + ' 부서 미해결 이슈 ' + deptCounts[dk] + '건 집중');
          }
        });
      }
      html += '<div style="margin-top:6px"><strong style="color:var(--t2)">🎫 이슈 현황</strong>';
      if (issueItems.length) {
        html += '<ul style="margin:4px 0;padding-left:16px">';
        issueItems.forEach(function (item) { html += '<li style="color:var(--t3);padding:1px 0">' + eH(item) + '</li>'; });
        html += '</ul>';
      } else if (openIssues.length) {
        html += '<div style="color:var(--t6);padding:2px 0">미해결 ' + openIssues.length + '건 (특이사항 없음)</div>';
      } else {
        html += '<div style="color:var(--t6);padding:2px 0">이슈 없음</div>';
      }
      html += '</div>';
    } catch (e) { console.warn('[Dashboard]', e); }
  }

  // Integration 10: 아카이브-프로젝트 교차 분석
  if (typeof getRecentArchiveWeeks === 'function') {
    try {
      var archWeeks = await getRecentArchiveWeeks(4);
      if (archWeeks.length) {
        var crossItems = [];

        // 수주번호별 실제 투입시간 집계
        var actualByOrder = {};
        var archMembers = {};
        archWeeks.forEach(function (w) {
          if (!w.data || !Array.isArray(w.data)) return;
          w.data.forEach(function (r) {
            archMembers[r.name] = true;
            if (!r.orderNo) return;
            var key = r.orderNo.trim();
            actualByOrder[key] = (actualByOrder[key] || 0) + (r.hours || 0);
          });
        });

        // 예상시간 대비 실제시간 비교
        projects.forEach(function (p) {
          if (!p.orderNo || !p.estimatedHours || p.estimatedHours <= 0) return;
          var st = autoProjectStatus(p);
          if (st === 'done') return;
          var key = p.orderNo.trim();
          var actual = actualByOrder[key] || 0;
          if (actual <= 0) {
            crossItems.push('⚪ ' + p.name + ' (' + p.orderNo + '): 아카이브 실적 0h — 미착수 가능성');
          } else {
            var ratio = actual / p.estimatedHours * 100;
            if (ratio > 120) {
              crossItems.push('🔴 ' + p.name + ': 실제 ' + Math.round(actual) + 'h / 예상 ' + p.estimatedHours + 'h (' + Math.round(ratio) + '%) — 초과 투입');
            } else if (ratio < 30 && st === 'active') {
              crossItems.push('🟡 ' + p.name + ': 실제 ' + Math.round(actual) + 'h / 예상 ' + p.estimatedHours + 'h (' + Math.round(ratio) + '%) — 투입 부족');
            }
          }
        });

        // 프로젝트에 배정되었지만 아카이브에 없는 인원
        var projAssigneeSet = {};
        projects.forEach(function (p) {
          var st = autoProjectStatus(p);
          if (st === 'done') return;
          (p.assignees || []).forEach(function (a) { projAssigneeSet[a] = p.name; });
        });
        Object.keys(projAssigneeSet).forEach(function (a) {
          if (!archMembers[a]) {
            crossItems.push('👤 ' + a + ': ' + projAssigneeSet[a] + ' 담당이지만 최근 아카이브에 기록 없음');
          }
        });

        // 아카이브에 있지만 프로젝트에 미배정된 인원
        Object.keys(archMembers).forEach(function (m) {
          if (!projAssigneeSet[m]) {
            crossItems.push('👤 ' + m + ': 아카이브에 활동 중이지만 프로젝트 담당자로 미배정');
          }
        });

        // 수주번호가 있는 프로젝트 중 아카이브 실적 0인 것
        projects.forEach(function (p) {
          if (!p.orderNo) return;
          var st = autoProjectStatus(p);
          if (st === 'done' || st === 'waiting') return;
          var key = p.orderNo.trim();
          if (!actualByOrder[key]) {
            // 이미 위에서 체크했으므로 중복 방지
          }
        });

        html += '<div style="margin-top:6px"><strong style="color:var(--t2)">📋 아카이브-프로젝트 교차 분석</strong>';
        if (crossItems.length) {
          html += '<ul style="margin:4px 0;padding-left:16px">';
          crossItems.forEach(function (item) { html += '<li style="color:var(--t3);padding:1px 0">' + eH(item) + '</li>'; });
          html += '</ul>';
        } else {
          html += '<div style="color:var(--t6);padding:2px 0">특이사항 없음</div>';
        }
        html += '</div>';
      }
    } catch (e) { console.warn('[Dashboard]', e); }
  }

  return html;
}

/* ═══ 파이프라인 요약 위젯 ═══ */
function buildPipelineSummary(projects) {
  var el = document.getElementById('dashCards');
  if (!el) return;
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  var phaseKeys = Object.keys(phases).sort(function (a, b) { return (phases[a].seq || 0) - (phases[b].seq || 0); });
  if (!phaseKeys.length) return;

  var buckets = {};
  phaseKeys.forEach(function (k) { buckets[k] = 0; });
  projects.forEach(function (p) {
    var ph = p.currentPhase || 'order';
    if (buckets[ph] !== undefined) buckets[ph]++;
    else buckets[phaseKeys[0]]++;
  });

  var maxCnt = 1;
  phaseKeys.forEach(function (k) { if (buckets[k] > maxCnt) maxCnt = buckets[k]; });

  var html = '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px;margin-top:10px">';
  html += '<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px">🔀 파이프라인 현황</div>';
  html += '<div style="display:flex;align-items:flex-end;gap:4px;height:60px">';
  phaseKeys.forEach(function (k) {
    var ph = phases[k];
    var cnt = buckets[k];
    var pct = Math.max(cnt / maxCnt * 100, cnt > 0 ? 8 : 2);
    html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">';
    html += '<span style="font-size:10px;font-weight:700;color:' + ph.color + '">' + cnt + '</span>';
    html += '<div style="width:100%;height:' + pct + '%;min-height:2px;background:' + ph.color + ';border-radius:4px 4px 0 0;transition:height .3s"></div>';
    html += '<span style="font-size:9px;color:var(--t5)">' + ph.icon + '</span>';
    html += '</div>';
  });
  html += '</div>';
  // 범례
  html += '<div style="display:flex;justify-content:center;gap:8px;margin-top:6px">';
  phaseKeys.forEach(function (k) {
    var ph = phases[k];
    html += '<span style="font-size:9px;color:' + ph.color + '">' + ph.icon + ' ' + ph.label + '</span>';
  });
  html += '</div></div>';
  el.innerHTML += html;
}

/* ═══ 이슈 현황 위젯 ═══ */
/* ═══ 단계 병목 위젯 ═══ */
function buildBottleneckWidget(projects) {
  var el = document.getElementById('dashCards');
  if (!el) return;
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  var today = localDate();
  var bottlenecks = [];

  projects.forEach(function (p) {
    if (!p.phases || !p.currentPhase) return;
    var cur = p.phases[p.currentPhase];
    if (cur && cur.status === 'active' && cur.startDate) {
      var stayDays = daysDiff(cur.startDate, today);
      if (stayDays >= 14) {
        var phLabel = phases[p.currentPhase] ? phases[p.currentPhase].label : p.currentPhase;
        var phColor = phases[p.currentPhase] ? phases[p.currentPhase].color : '#94A3B8';
        bottlenecks.push({ name: p.name, phase: phLabel, days: stayDays, color: phColor });
      }
    }
  });

  if (!bottlenecks.length) return;
  bottlenecks.sort(function (a, b) { return b.days - a.days; });

  var html = '<div style="padding:12px;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.3);border-radius:8px;margin-top:10px">';
  html += '<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:8px">🚧 단계 병목 <span style="font-size:10px;font-weight:400;color:var(--t6)">(' + bottlenecks.length + '건, 14일+ 체류)</span></div>';
  bottlenecks.forEach(function (b) {
    html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:11px">';
    html += '<span style="color:var(--t2);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px">' + eH(b.name) + '</span>';
    html += '<span style="padding:1px 6px;border-radius:8px;background:' + b.color + '22;color:' + b.color + ';font-size:10px">' + b.phase + '</span>';
    html += '<span style="font-size:10px;color:#F59E0B;font-weight:700;margin-left:auto">' + b.days + '일</span>';
    html += '</div>';
  });
  html += '</div>';
  el.innerHTML += html;
}

/* ═══ 수주 현황 위젯 ═══ */
function buildOrderSummary() {
  var el = document.getElementById('dashCards');
  if (!el || typeof orderGetAll !== 'function') return;

  orderGetAll().then(function (orders) {
    if (!orders.length) return;
    var today = localDate();
    var m3ago = new Date();
    m3ago.setMonth(m3ago.getMonth() - 3);
    var m3str = m3ago.getFullYear() + '-' + String(m3ago.getMonth() + 1).padStart(2, '0') + '-01';

    // 최근 3개월 수주
    var recent = orders.filter(function (o) { return o.date >= m3str; });
    var totalAmt = 0;
    orders.forEach(function (o) { totalAmt += (parseInt(o.amount) || 0); });
    var recentAmt = 0;
    recent.forEach(function (o) { recentAmt += (parseInt(o.amount) || 0); });

    // 월별 건수
    var monthBuckets = {};
    for (var i = 0; i < 3; i++) {
      var d = new Date();
      d.setMonth(d.getMonth() - i);
      var mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      monthBuckets[mk] = { count: 0, amount: 0 };
    }
    recent.forEach(function (o) {
      var mk = (o.date || '').slice(0, 7);
      if (monthBuckets[mk]) {
        monthBuckets[mk].count++;
        monthBuckets[mk].amount += (parseInt(o.amount) || 0);
      }
    });

    var fmtAmt = typeof formatAmount === 'function' ? formatAmount : function (v) { return (v / 10000).toFixed(0) + '만'; };

    var html = '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px;margin-top:10px">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:8px">📋 수주 현황</div>';
    html += '<div style="display:flex;gap:12px;margin-bottom:8px">';
    html += '<div style="text-align:center"><div style="font-size:16px;font-weight:700;color:#6366F1">' + orders.length + '</div><div style="font-size:9px;color:var(--t5)">전체</div></div>';
    html += '<div style="text-align:center"><div style="font-size:16px;font-weight:700;color:#3B82F6">' + recent.length + '</div><div style="font-size:9px;color:var(--t5)">최근3개월</div></div>';
    if (totalAmt > 0) {
      html += '<div style="text-align:center"><div style="font-size:14px;font-weight:700;color:#10B981">' + fmtAmt(totalAmt) + '</div><div style="font-size:9px;color:var(--t5)">총수주액</div></div>';
    }
    html += '</div>';

    // 월별 미니 바
    var months = Object.keys(monthBuckets).sort();
    var maxCnt = 1;
    months.forEach(function (mk) { if (monthBuckets[mk].count > maxCnt) maxCnt = monthBuckets[mk].count; });
    html += '<div style="display:flex;gap:6px">';
    months.forEach(function (mk) {
      var b = monthBuckets[mk];
      var pct = Math.max(b.count / maxCnt * 100, b.count > 0 ? 10 : 2);
      html += '<div style="flex:1;text-align:center">';
      html += '<div style="height:30px;display:flex;align-items:flex-end;justify-content:center">';
      html += '<div style="width:100%;height:' + pct + '%;background:#6366F1;border-radius:3px 3px 0 0;min-height:2px"></div>';
      html += '</div>';
      html += '<div style="font-size:9px;color:var(--t5);margin-top:2px">' + mk.slice(5) + '월</div>';
      html += '<div style="font-size:10px;color:var(--t3);font-weight:600">' + b.count + '건</div>';
      html += '</div>';
    });
    html += '</div></div>';
    el.innerHTML += html;
  });
}

function buildIssueSummary() {
  var el = document.getElementById('dashCards');
  if (!el) return;
  if (typeof issueGetAll !== 'function') return;

  issueGetAll().then(function (issues) {
    if (!issues.length) return;
    var depts = typeof DEPT !== 'undefined' ? DEPT : {};
    var statuses = typeof ISSUE_STATUS !== 'undefined' ? ISSUE_STATUS : {};

    var openCnt = 0, urgentCnt = 0, inProgCnt = 0;
    var deptOpen = {};
    Object.keys(depts).forEach(function (k) { deptOpen[k] = 0; });

    issues.forEach(function (iss) {
      if (iss.status === 'open') { openCnt++; }
      if (iss.status === 'inProgress') { inProgCnt++; }
      if (iss.urgency === 'urgent' && iss.status !== 'closed' && iss.status !== 'resolved') urgentCnt++;
      if (iss.status !== 'closed' && iss.status !== 'resolved' && deptOpen[iss.dept] !== undefined) {
        deptOpen[iss.dept]++;
      }
    });

    var html = '<div style="padding:12px;background:var(--bg-i);border:1px solid ' + (urgentCnt > 0 ? 'rgba(239,68,68,.3)' : 'var(--bd-i)') + ';border-radius:8px;margin-top:10px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html += '<span style="font-size:12px;font-weight:700;color:var(--t1)">🎫 이슈 현황</span>';
    html += '<span style="font-size:10px;color:var(--t5)">' + issues.length + '건 전체</span>';
    html += '</div>';

    // 요약 수치
    html += '<div style="display:flex;gap:12px;margin-bottom:10px">';
    html += '<div style="text-align:center;cursor:pointer" onclick="if(typeof dashDrill===\'function\')dashDrill(\'openIssues\')" title="클릭: 접수 이슈 보기"><div style="font-size:16px;font-weight:700;color:#6366F1">' + openCnt + '</div><div style="font-size:9px;color:var(--t5)">접수</div></div>';
    html += '<div style="text-align:center;cursor:pointer" onclick="if(typeof dashDrill===\'function\')dashDrill(\'urgentIssues\')" title="클릭: 긴급 이슈 보기"><div style="font-size:16px;font-weight:700;color:#EF4444">' + urgentCnt + '</div><div style="font-size:9px;color:var(--t5)">긴급</div></div>';
    html += '<div style="text-align:center;cursor:pointer" onclick="if(typeof dashDrill===\'function\')dashDrill(\'inProgressIssues\')" title="클릭: 대응중 이슈 보기"><div style="font-size:16px;font-weight:700;color:#3B82F6">' + inProgCnt + '</div><div style="font-size:9px;color:var(--t5)">대응중</div></div>';
    html += '</div>';

    // 부서별 미해결
    html += '<div style="display:flex;flex-direction:column;gap:3px">';
    Object.keys(depts).forEach(function (k) {
      var cnt = deptOpen[k];
      if (cnt === 0) return;
      var dp = depts[k];
      html += '<div style="display:flex;align-items:center;gap:6px;font-size:10px">';
      html += '<span style="width:60px;color:' + dp.color + '">' + dp.icon + ' ' + dp.label + '</span>';
      html += '<div style="flex:1;height:6px;background:var(--bd);border-radius:3px;overflow:hidden">';
      html += '<div style="height:100%;width:' + Math.min(cnt * 20, 100) + '%;background:' + dp.color + ';border-radius:3px"></div></div>';
      html += '<span style="font-weight:600;color:' + dp.color + '">' + cnt + '</span>';
      html += '</div>';
    });
    html += '</div></div>';

    el.innerHTML += html;
  });
}

/* ═══ Feature 4: 인원별 리소스 리포트 ═══ */
async function showPersonReport(name) {
  var existing = document.getElementById('personReportPanel');
  if (existing) existing.remove();
  var existingBd = document.getElementById('personReportBackdrop');
  if (existingBd) existingBd.remove();

  var panel = document.createElement('div');
  panel.id = 'personReportPanel';
  panel.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:420px;max-width:92vw;background:var(--bg-p);border-left:1px solid var(--bd);z-index:9998;overflow-y:auto;box-shadow:-4px 0 20px rgba(0,0,0,.15);padding:20px;animation:slideIn .2s ease';
  panel.innerHTML = '<div style="text-align:center;color:var(--t6);font-size:12px;padding:40px 0">로딩 중...</div>';
  document.body.appendChild(panel);

  var backdrop = document.createElement('div');
  backdrop.id = 'personReportBackdrop';
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:9997;background:rgba(0,0,0,.3)';
  backdrop.onclick = function () { panel.remove(); backdrop.remove(); };
  document.body.appendChild(backdrop);

  try {
    var today = localDate();
    var displayName = typeof shortName === 'function' ? shortName(name) : name;

    // 데이터 로드 (병렬)
    var _prData = await Promise.all([
      projGetAll(),
      (typeof issueGetAll === 'function') ? issueGetAll().catch(function (e) { console.warn('[Dashboard]', e); return []; }) : Promise.resolve([]),
      evtGetAll(),
      (typeof getRecentArchiveWeeks === 'function') ? getRecentArchiveWeeks(4).catch(function (e) { console.warn('[Dashboard]', e); return []; }) : Promise.resolve([])
    ]);
    var allProjects = _prData[0];
    var allIssues = _prData[1] || [];
    var allEvents = _prData[2];
    var archWeeks = _prData[3] || [];

    // 1. 배정 프로젝트
    var myProjects = allProjects.filter(function (p) {
      return (p.assignees || []).indexOf(name) >= 0;
    });

    // 2. 담당 이슈 (미해결)
    var myIssues = allIssues.filter(function (iss) {
      return (iss.assignees || []).indexOf(name) >= 0 && iss.status !== 'closed' && iss.status !== 'resolved';
    });

    // 3. 주간 투입시간
    var weeklyHours = [];
    archWeeks.forEach(function (w) {
      var h = 0;
      if (w.data && Array.isArray(w.data)) {
        w.data.forEach(function (r) {
          if (r.name === name) h += (r.hours || 0);
        });
      }
      var dr = w.dateRange || [];
      weeklyHours.push({ label: w.label || (dr[0] || '?'), hours: Math.round(h * 10) / 10 });
    });

    // 4. 예정 일정
    var myEvents = allEvents.filter(function (ev) {
      return (ev.assignees || []).indexOf(name) >= 0 && ev.startDate >= today;
    }).sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; }).slice(0, 10);

    // 렌더
    var html = '';

    // 헤더
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
      '<h3 style="font-size:15px;font-weight:700;color:var(--t1)">👤 ' + eH(displayName) + ' 리소스 리포트</h3>' +
      '<button class="btn btn-g btn-s" onclick="document.getElementById(\'personReportPanel\').remove();var bd=document.getElementById(\'personReportBackdrop\');if(bd)bd.remove()">✕</button>' +
    '</div>';
    html += '<div style="font-size:10px;color:var(--t6);margin-bottom:14px">' + eH(name) + ' · 기준일: ' + today + '</div>';

    // 배정 프로젝트
    html += '<div style="margin-bottom:14px">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--t4);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--bd)">📁 배정 프로젝트 (' + myProjects.length + '건)</div>';
    if (myProjects.length) {
      myProjects.forEach(function (p) {
        var st = autoProjectStatus(p);
        var stInfo = PROJ_STATUS[st] || PROJ_STATUS.waiting;
        var prog = p.progress || 0;
        html += '<div style="padding:6px 8px;background:var(--bg-i);border-radius:6px;border-left:3px solid ' + (p.color || '#888') + ';margin-bottom:4px">';
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
        html += '<span style="flex:1;font-size:11px;font-weight:600;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(p.name || p.orderNo) + '</span>';
        html += '<span class="badge" style="background:' + stInfo.bg + ';color:' + stInfo.color + ';font-size:9px;flex-shrink:0">' + stInfo.icon + ' ' + stInfo.label + '</span>';
        html += '</div>';
        html += '<div style="display:flex;align-items:center;gap:6px">';
        html += '<div style="flex:1;height:4px;background:var(--bd);border-radius:2px;overflow:hidden"><div style="height:100%;width:' + prog + '%;background:' + (p.color || '#888') + ';border-radius:2px"></div></div>';
        html += '<span style="font-size:9px;color:var(--t5);flex-shrink:0">' + prog + '% · ' + (p.endDate || '-') + '</span>';
        html += '</div></div>';
      });
    } else {
      html += '<div style="font-size:11px;color:var(--t6)">배정된 프로젝트가 없습니다.</div>';
    }
    html += '</div>';

    // 담당 이슈
    var urgencies = typeof ISSUE_URGENCY !== 'undefined' ? ISSUE_URGENCY : {};
    var issueStatuses = typeof ISSUE_STATUS !== 'undefined' ? ISSUE_STATUS : {};
    html += '<div style="margin-bottom:14px">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--t4);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--bd)">🎫 담당 이슈 (미해결 ' + myIssues.length + '건)</div>';
    if (myIssues.length) {
      myIssues.slice(0, 8).forEach(function (iss) {
        var urg = urgencies[iss.urgency] || { label: iss.urgency, color: '#94A3B8', icon: '' };
        var ist = issueStatuses[iss.status] || { label: iss.status, color: '#94A3B8' };
        var isUrgent = iss.urgency === 'urgent';
        html += '<div style="padding:5px 8px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd)">';
        if (isUrgent) html += '<span style="font-size:10px;flex-shrink:0">🔴</span>';
        html += '<span style="flex:1;font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(iss.title) + '</span>';
        html += '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:' + urg.color + '22;color:' + urg.color + ';flex-shrink:0">' + urg.label + '</span>';
        html += '<span class="badge" style="background:' + ist.color + '22;color:' + ist.color + ';font-size:8px;flex-shrink:0">' + ist.label + '</span>';
        html += '</div>';
      });
      if (myIssues.length > 8) {
        html += '<div style="font-size:10px;color:var(--t6);padding:4px 0">+' + (myIssues.length - 8) + '건 더 있음</div>';
      }
    } else {
      html += '<div style="font-size:11px;color:var(--t6)">담당 미해결 이슈가 없습니다.</div>';
    }
    html += '</div>';

    // 주간 투입시간
    html += '<div style="margin-bottom:14px">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--t4);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--bd)">⏱ 주간 투입시간 (최근 4주)</div>';
    if (weeklyHours.length) {
      var maxHours = 1;
      weeklyHours.forEach(function (w) { if (w.hours > maxHours) maxHours = w.hours; });
      html += '<div style="display:flex;align-items:flex-end;gap:6px;height:60px;margin-bottom:4px">';
      weeklyHours.forEach(function (w) {
        var pct = Math.max(w.hours / maxHours * 100, w.hours > 0 ? 6 : 2);
        var barColor = w.hours >= 40 ? '#EF4444' : w.hours >= 20 ? '#F59E0B' : '#10B981';
        html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">';
        html += '<span style="font-size:9px;font-weight:700;color:' + barColor + '">' + w.hours + 'h</span>';
        html += '<div style="width:100%;height:' + pct + '%;min-height:2px;background:' + barColor + ';border-radius:3px 3px 0 0"></div>';
        html += '<span style="font-size:9px;color:var(--t5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;text-align:center">' + eH(w.label.slice(-5)) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    } else {
      html += '<div style="font-size:11px;color:var(--t6)">아카이브 데이터가 없습니다.</div>';
    }
    html += '</div>';

    // 예정 일정
    var evtTypes = typeof EVT_TYPE !== 'undefined' ? EVT_TYPE : {};
    html += '<div style="margin-bottom:14px">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--t4);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--bd)">📅 예정 일정 (' + myEvents.length + '건)</div>';
    if (myEvents.length) {
      myEvents.forEach(function (ev) {
        var et = evtTypes[ev.type] || { label: ev.type || '일정', icon: '📌', color: '#6366F1' };
        html += '<div style="padding:5px 0;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd)">';
        html += '<span style="font-size:11px;flex-shrink:0">' + (et.icon || '📌') + '</span>';
        html += '<span style="flex:1;font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(ev.title) + '</span>';
        html += '<span style="font-size:9px;color:var(--t5);flex-shrink:0">' + ev.startDate + '</span>';
        html += '</div>';
      });
    } else {
      html += '<div style="font-size:11px;color:var(--t6)">예정된 일정이 없습니다.</div>';
    }
    html += '</div>';

    panel.innerHTML = html;
  } catch (err) {
    panel.innerHTML = '<div style="color:#EF4444;font-size:12px;padding:20px">오류: ' + eH(err.message || String(err)) + '</div>';
  }
}

/* ═══ Feature 7: 프로젝트 건강 스코어카드 ═══ */
async function buildHealthScorecard(projects) {
  var el = document.getElementById('dashCards');
  if (!el) return;
  var today = localDate();

  // 진행중/지연 프로젝트만 대상
  var targetProjs = (projects || []).filter(function (p) {
    var st = autoProjectStatus(p);
    return st === 'active' || st === 'delayed';
  });
  if (!targetProjs.length) return;

  // 이슈/체크리스트 데이터 로드 (병렬)
  var _chkPromises = [];
  var _chkProjIds = [];
  if (typeof chkGetByProject === 'function') {
    for (var i = 0; i < targetProjs.length; i++) {
      _chkProjIds.push(targetProjs[i].id);
      _chkPromises.push(chkGetByProject(targetProjs[i].id).catch(function (e) { console.warn('[Dashboard]', e); return []; }));
    }
  }
  var _hsData = await Promise.all([
    (typeof issueGetAll === 'function') ? issueGetAll().catch(function (e) { console.warn('[Dashboard]', e); return []; }) : Promise.resolve([]),
    Promise.all(_chkPromises)
  ]);
  var allIssues = _hsData[0] || [];
  var _chkResults = _hsData[1];
  var allChklists = {};
  for (var i = 0; i < _chkProjIds.length; i++) {
    allChklists[_chkProjIds[i]] = _chkResults[i];
  }

  // 스코어 계산
  var scored = targetProjs.map(function (p) {
    var score = 0;

    // 1. 일정 준수 (30%)
    var scheduleScore = 0;
    if (p.startDate && p.endDate) {
      var totalDays = daysDiff(p.startDate, p.endDate) || 1;
      var remainDays = daysDiff(today, p.endDate);
      if (remainDays > 0) {
        scheduleScore = Math.min(100, Math.round(remainDays / totalDays * 100));
      } else {
        scheduleScore = 0;
      }
    }
    score += scheduleScore * 0.30;

    // 2. 이슈 해결율 (25%)
    var projIssues = allIssues.filter(function (iss) { return iss.projectId === p.id; });
    var issueScore = 100;
    if (projIssues.length > 0) {
      var resolvedIssues = projIssues.filter(function (iss) { return iss.status === 'resolved' || iss.status === 'closed'; }).length;
      issueScore = Math.round(resolvedIssues / projIssues.length * 100);
    }
    score += issueScore * 0.25;

    // 3. 체크리스트 완료율 (25%)
    var chkScore = 100;
    var chkItems = allChklists[p.id] || [];
    var curPhaseItems = p.currentPhase ? chkItems.filter(function (c) { return c.phase === p.currentPhase; }) : chkItems;
    if (curPhaseItems.length > 0) {
      var doneCnt = curPhaseItems.filter(function (c) { return c.done; }).length;
      chkScore = Math.round(doneCnt / curPhaseItems.length * 100);
    }
    score += chkScore * 0.25;

    // 4. 투입 효율 (20%)
    var effScore = 50;
    if (p.estimatedHours > 0 && p.actualHours > 0) {
      var ratio = p.actualHours / p.estimatedHours * 100;
      effScore = Math.max(0, 100 - Math.abs(ratio - 100));
    }
    score += effScore * 0.20;

    score = Math.round(score);

    // 등급
    var grade, gradeColor;
    if (score >= 80) { grade = 'A'; gradeColor = '#10B981'; }
    else if (score >= 60) { grade = 'B'; gradeColor = '#3B82F6'; }
    else if (score >= 40) { grade = 'C'; gradeColor = '#F59E0B'; }
    else if (score >= 20) { grade = 'D'; gradeColor = '#F97316'; }
    else { grade = 'E'; gradeColor = '#EF4444'; }

    var issueResolved = projIssues.filter(function (iss) { return iss.status === 'resolved' || iss.status === 'closed'; }).length;
    var chkDone = curPhaseItems.filter(function (c) { return c.done; }).length;

    return {
      proj: p,
      score: score,
      grade: grade,
      gradeColor: gradeColor,
      scheduleScore: scheduleScore,
      issueScore: issueScore,
      chkScore: chkScore,
      effScore: Math.round(effScore),
      issueTotal: projIssues.length,
      issueResolved: issueResolved,
      chkTotal: curPhaseItems.length,
      chkDone: chkDone
    };
  });

  // 점수순 정렬 (낮은 순)
  scored.sort(function (a, b) { return a.score - b.score; });

  var html = '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px;margin-top:10px" id="healthScorecardWidget">';
  html += '<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:10px">🏥 프로젝트 건강 스코어카드 <span style="font-size:10px;font-weight:400;color:var(--t6)">(' + scored.length + '개 진행/지연 프로젝트)</span></div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">';

  scored.forEach(function (s) {
    var p = s.proj;
    html += '<div style="padding:10px;background:var(--bg-c);border:1px solid var(--bd2);border-radius:8px;border-top:3px solid ' + s.gradeColor + '">';
    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">';
    html += '<span style="font-size:11px;font-weight:600;color:var(--t2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(p.name || p.orderNo) + '</span>';
    html += '<span style="font-size:20px;font-weight:900;color:' + s.gradeColor + ';line-height:1">' + s.grade + '</span>';
    html += '</div>';
    html += '<div style="margin-bottom:8px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--t5);margin-bottom:2px"><span>종합 점수</span><span style="font-weight:700;color:' + s.gradeColor + '">' + s.score + '/100</span></div>';
    html += '<div style="height:6px;background:var(--bd);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + s.score + '%;background:' + s.gradeColor + ';border-radius:3px;transition:width .4s"></div></div>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px">';
    html += '<div style="font-size:9px;color:var(--t5)">📅 일정<span style="float:right;color:var(--t3);font-weight:600">' + s.scheduleScore + '%</span></div>';
    html += '<div style="font-size:9px;color:var(--t5)">🎫 이슈<span style="float:right;color:var(--t3);font-weight:600">' + s.issueResolved + '/' + s.issueTotal + '</span></div>';
    html += '<div style="font-size:9px;color:var(--t5)">✅ 체크<span style="float:right;color:var(--t3);font-weight:600">' + s.chkDone + '/' + s.chkTotal + '</span></div>';
    html += '<div style="font-size:9px;color:var(--t5)">⚡ 효율<span style="float:right;color:var(--t3);font-weight:600">' + s.effScore + '%</span></div>';
    html += '</div>';
    html += '</div>';
  });

  html += '</div></div>';
  el.innerHTML += html;
}

/* ═══ Feature 10: 보고서 자동 생성 ═══ */
function showReportModal() {
  var existing = document.getElementById('reportModal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'reportModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
  modal.onclick = function (e) { if (e.target === modal) modal.remove(); };

  modal.innerHTML = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;max-width:420px;width:95%">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
      '<h3 style="font-size:14px;font-weight:700;color:var(--t1)">📊 보고서 생성</h3>' +
      '<button class="btn btn-g btn-s" onclick="document.getElementById(\'reportModal\').remove()">✕</button>' +
    '</div>' +
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:11px;font-weight:600;color:var(--t3);margin-bottom:6px">기간</div>' +
      '<div style="display:flex;gap:12px">' +
        '<label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;color:var(--t3)"><input type="radio" name="rptPeriod" value="weekly" checked> 주간</label>' +
        '<label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;color:var(--t3)"><input type="radio" name="rptPeriod" value="monthly"> 월간</label>' +
      '</div>' +
    '</div>' +
    '<div style="margin-bottom:14px">' +
      '<div style="font-size:11px;font-weight:600;color:var(--t3);margin-bottom:6px">포함 항목</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px">' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;color:var(--t3)"><input type="checkbox" id="rptProjects" checked> 프로젝트 현황</label>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;color:var(--t3)"><input type="checkbox" id="rptIssues" checked> 이슈 현황</label>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;color:var(--t3)"><input type="checkbox" id="rptWork" checked> 투입실적</label>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;color:var(--t3)"><input type="checkbox" id="rptHealth" checked> 건강 스코어</label>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="btn btn-g btn-s" onclick="document.getElementById(\'reportModal\').remove()">취소</button>' +
      '<button class="btn btn-p" onclick="generateReport()">📊 보고서 생성</button>' +
    '</div>' +
  '</div>';

  document.body.appendChild(modal);
}

async function generateReport() {
  var modal = document.getElementById('reportModal');
  if (modal) modal.remove();

  var periodEl = document.querySelector('input[name="rptPeriod"]:checked');
  var period = periodEl ? periodEl.value : 'weekly';
  var inclProjects = document.getElementById('rptProjects') ? document.getElementById('rptProjects').checked : true;
  var inclIssues = document.getElementById('rptIssues') ? document.getElementById('rptIssues').checked : true;
  var inclWork = document.getElementById('rptWork') ? document.getElementById('rptWork').checked : true;
  var inclHealth = document.getElementById('rptHealth') ? document.getElementById('rptHealth').checked : true;

  var today = localDate();
  var periodLabel = period === 'weekly' ? '주간' : '월간';

  // 데이터 수집 (병렬)
  var _grData = await Promise.all([
    projGetAll(),
    (typeof issueGetAll === 'function') ? issueGetAll().catch(function (e) { console.warn('[Dashboard]', e); return []; }) : Promise.resolve([]),
    (typeof getRecentArchiveWeeks === 'function') ? getRecentArchiveWeeks(period === 'weekly' ? 1 : 4).catch(function (e) { console.warn('[Dashboard]', e); return []; }) : Promise.resolve([])
  ]);
  var projects = _grData[0];
  var _rptProjMap = {};
  projects.forEach(function (p) { _rptProjMap[p.id] = p; });
  var allIssues = _grData[1] || [];
  var archWeeks = _grData[2] || [];

  // 보고서 HTML 생성
  var rptStyles = '<style>' +
    'body{font-family:"Noto Sans KR",sans-serif;color:#1e293b;background:#fff;margin:0;padding:20px}' +
    'h1{font-size:18px;font-weight:700;color:#0f172a;border-bottom:2px solid #3B82F6;padding-bottom:8px;margin-bottom:16px}' +
    'h2{font-size:14px;font-weight:700;color:#1e293b;margin:20px 0 8px;padding:6px 10px;background:#f1f5f9;border-radius:4px}' +
    'table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px}' +
    'th{background:#f8fafc;border:1px solid #e2e8f0;padding:6px 8px;font-weight:600;text-align:left;font-size:10px}' +
    'td{border:1px solid #e2e8f0;padding:5px 8px;font-size:11px;vertical-align:middle}' +
    '.badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:600}' +
    '.grade{font-size:16px;font-weight:900}' +
    '@media print{body{padding:10px}.no-print{display:none!important}button{display:none!important}}' +
  '</style>';

  var rptHtml = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>' + periodLabel + ' 보고서</title>' + rptStyles + '</head><body>';
  rptHtml += '<div class="no-print" style="margin-bottom:16px;display:flex;gap:8px;padding:10px;background:#f1f5f9;border-radius:8px">';
  rptHtml += '<button onclick="window.print()" style="padding:6px 16px;background:#3B82F6;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">🖨 인쇄</button>';
  rptHtml += '<button onclick="window.close()" style="padding:6px 16px;background:#94A3B8;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer">✕ 닫기</button>';
  rptHtml += '</div>';
  rptHtml += '<h1>📊 ' + periodLabel + ' 업무 보고서</h1>';
  rptHtml += '<p style="font-size:11px;color:#64748b;margin-bottom:16px">기준일: ' + today + ' | 생성: ' + new Date().toLocaleString('ko-KR') + '</p>';

  // 1. 프로젝트 현황
  if (inclProjects) {
    rptHtml += '<h2>📁 프로젝트 현황</h2>';
    rptHtml += '<table><thead><tr><th>프로젝트명</th><th>상태</th><th>현재단계</th><th>진척률</th><th>시작일</th><th>종료일</th><th>담당자</th></tr></thead><tbody>';
    var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
    projects.forEach(function (p) {
      var st = autoProjectStatus(p);
      var stInfo = PROJ_STATUS[st] || PROJ_STATUS.waiting;
      var phLabel = p.currentPhase && phases[p.currentPhase] ? phases[p.currentPhase].label : '-';
      var assignees = (p.assignees || []).map(function (a) { return typeof shortName === 'function' ? shortName(a) : a; }).join(', ');
      rptHtml += '<tr>' +
        '<td style="font-weight:600">' + eH(p.name || p.orderNo) + '</td>' +
        '<td><span class="badge" style="background:' + stInfo.bg + ';color:' + stInfo.color + '">' + stInfo.icon + ' ' + stInfo.label + '</span></td>' +
        '<td>' + phLabel + '</td>' +
        '<td><div style="background:#e2e8f0;border-radius:3px;height:8px;width:80px;overflow:hidden"><div style="background:#3B82F6;height:100%;width:' + (p.progress || 0) + '%"></div></div><span style="font-size:9px;color:#64748b">' + (p.progress || 0) + '%</span></td>' +
        '<td style="font-size:10px;color:#64748b">' + (p.startDate || '-') + '</td>' +
        '<td style="font-size:10px;color:#64748b">' + (p.endDate || '-') + '</td>' +
        '<td style="font-size:10px">' + eH(assignees || '-') + '</td>' +
      '</tr>';
    });
    rptHtml += '</tbody></table>';
  }

  // 2. 이슈 현황
  if (inclIssues && allIssues.length) {
    var openIssues = allIssues.filter(function (i) { return i.status !== 'closed' && i.status !== 'resolved'; });
    var urgentIssues = openIssues.filter(function (i) { return i.urgency === 'urgent'; });
    var urgencies = typeof ISSUE_URGENCY !== 'undefined' ? ISSUE_URGENCY : {};
    var issStatuses = typeof ISSUE_STATUS !== 'undefined' ? ISSUE_STATUS : {};
    rptHtml += '<h2>🎫 이슈 현황</h2>';
    rptHtml += '<p style="font-size:11px;color:#475569">전체 ' + allIssues.length + '건 | 미해결 ' + openIssues.length + '건 | 긴급 ' + urgentIssues.length + '건</p>';
    if (openIssues.length) {
      rptHtml += '<table><thead><tr><th>제목</th><th>긴급도</th><th>상태</th><th>프로젝트</th><th>등록일</th></tr></thead><tbody>';
      openIssues.slice(0, 20).forEach(function (iss) {
        var urg = urgencies[iss.urgency] || { label: iss.urgency, color: '#94A3B8' };
        var ist = issStatuses[iss.status] || { label: iss.status, color: '#94A3B8' };
        var proj = _rptProjMap[iss.projectId];
        rptHtml += '<tr>' +
          '<td>' + eH(iss.title) + '</td>' +
          '<td><span class="badge" style="background:' + urg.color + '22;color:' + urg.color + '">' + urg.label + '</span></td>' +
          '<td><span class="badge" style="background:' + ist.color + '22;color:' + ist.color + '">' + ist.label + '</span></td>' +
          '<td style="font-size:10px">' + eH(proj ? (proj.name || proj.orderNo) : '-') + '</td>' +
          '<td style="font-size:10px;color:#64748b">' + (iss.reportDate || '-') + '</td>' +
        '</tr>';
      });
      rptHtml += '</tbody></table>';
    }
  }

  // 3. 투입실적
  if (inclWork && archWeeks.length) {
    rptHtml += '<h2>⏱ 투입실적</h2>';
    var personHoursMap = {};
    var orderHoursMap = {};
    archWeeks.forEach(function (w) {
      if (!w.data || !Array.isArray(w.data)) return;
      w.data.forEach(function (r) {
        personHoursMap[r.name] = (personHoursMap[r.name] || 0) + (r.hours || 0);
        if (r.orderNo) {
          orderHoursMap[r.orderNo] = (orderHoursMap[r.orderNo] || 0) + (r.hours || 0);
        }
      });
    });
    var personKeys = Object.keys(personHoursMap).sort(function (a, b) { return personHoursMap[b] - personHoursMap[a]; });
    var orderKeys = Object.keys(orderHoursMap).sort(function (a, b) { return orderHoursMap[b] - orderHoursMap[a]; });

    rptHtml += '<div style="display:flex;gap:16px">';
    rptHtml += '<div style="flex:1"><p style="font-size:11px;font-weight:600;color:#475569;margin-bottom:4px">인원별 투입</p>';
    rptHtml += '<table><thead><tr><th>이름</th><th>시간(h)</th></tr></thead><tbody>';
    personKeys.forEach(function (name) {
      var dn = typeof shortName === 'function' ? shortName(name) : name;
      rptHtml += '<tr><td>' + eH(dn) + '</td><td style="font-weight:600">' + Math.round(personHoursMap[name] * 10) / 10 + 'h</td></tr>';
    });
    rptHtml += '</tbody></table></div>';

    if (orderKeys.length) {
      rptHtml += '<div style="flex:1"><p style="font-size:11px;font-weight:600;color:#475569;margin-bottom:4px">프로젝트별 투입</p>';
      rptHtml += '<table><thead><tr><th>수주번호</th><th>시간(h)</th></tr></thead><tbody>';
      orderKeys.slice(0, 15).forEach(function (k) {
        rptHtml += '<tr><td>' + eH(k) + '</td><td style="font-weight:600">' + Math.round(orderHoursMap[k] * 10) / 10 + 'h</td></tr>';
      });
      rptHtml += '</tbody></table></div>';
    }
    rptHtml += '</div>';
  }

  // 4. 건강 스코어
  if (inclHealth) {
    var activeProjs = projects.filter(function (p) {
      var st = autoProjectStatus(p);
      return st === 'active' || st === 'delayed';
    });
    if (activeProjs.length) {
      rptHtml += '<h2>🏥 건강 스코어 요약</h2>';
      rptHtml += '<table><thead><tr><th>프로젝트</th><th>등급</th><th>진척률</th><th>상태</th></tr></thead><tbody>';
      activeProjs.forEach(function (p) {
        var st = autoProjectStatus(p);
        var stInfo = PROJ_STATUS[st] || PROJ_STATUS.waiting;
        var score = p.progress || 0;
        var grade, gradeColor;
        if (score >= 80) { grade = 'A'; gradeColor = '#10B981'; }
        else if (score >= 60) { grade = 'B'; gradeColor = '#3B82F6'; }
        else if (score >= 40) { grade = 'C'; gradeColor = '#F59E0B'; }
        else if (score >= 20) { grade = 'D'; gradeColor = '#F97316'; }
        else { grade = 'E'; gradeColor = '#EF4444'; }
        rptHtml += '<tr>' +
          '<td style="font-weight:600">' + eH(p.name || p.orderNo) + '</td>' +
          '<td><span class="grade" style="color:' + gradeColor + '">' + grade + '</span></td>' +
          '<td>' + score + '%</td>' +
          '<td><span class="badge" style="background:' + stInfo.bg + ';color:' + stInfo.color + '">' + stInfo.icon + ' ' + stInfo.label + '</span></td>' +
        '</tr>';
      });
      rptHtml += '</tbody></table>';
    }
  }

  rptHtml += '</body></html>';

  // 새 창에서 보고서 열기
  var win = window.open('', '_blank', 'width=900,height=700,scrollbars=yes');
  if (win) {
    win.document.write(rptHtml);
    win.document.close();
  } else {
    // 팝업 차단 시 모달로 표시
    var rptModal = document.createElement('div');
    rptModal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#fff;overflow:auto;padding:20px';
    rptModal.innerHTML = '<div style="display:flex;gap:8px;margin-bottom:12px;position:sticky;top:0;background:#fff;padding:8px 0;border-bottom:1px solid #e2e8f0;z-index:1" class="no-print">' +
      '<button onclick="window.print()" style="padding:6px 16px;background:#3B82F6;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">🖨 인쇄</button>' +
      '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="padding:6px 16px;background:#94A3B8;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer">✕ 닫기</button>' +
    '</div>' +
    '<iframe srcdoc="' + eA(rptHtml) + '" style="width:100%;height:calc(100vh - 80px);border:none"></iframe>';
    document.body.appendChild(rptModal);
  }
}
