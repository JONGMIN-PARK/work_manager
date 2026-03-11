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
  try { await autoUpdateProgress(); projects = await projGetAll(); } catch (e) {}
  // Integration 1: 업무유형 분포 데이터 로드
  try { taskDist = await calcTaskDistByOrder(); } catch (e) {}

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

  var milestones = await msGetAll();
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

  var events = await evtGetAll();
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
      '<div class="sc"><div class="sl">진행중</div><div class="sv bl">' + counts.active + '</div></div>' +
      '<div class="sc"><div class="sl" style="color:#EF4444">지연</div><div class="sv" style="color:#FCA5A5">' + counts.delayed + '</div></div>' +
      '<div class="sc"><div class="sl">완료</div><div class="sv gr">' + counts.done + '</div></div>' +
    '</div>' +

    // 하단 정보
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px">' +
      // 금월 납기
      '<div style="padding:10px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px">' +
        '<div style="font-size:11px;font-weight:600;color:var(--t4);margin-bottom:6px">🏁 금월 납기</div>' +
        (monthDeadlines.length ?
          monthDeadlines.map(function (e) {
            return '<div style="font-size:11px;color:var(--t3);padding:2px 0">🏁 ' + eH(e.title) + ' <span style="color:var(--t6)">' + e.startDate + '</span></div>';
          }).join('') :
          '<div style="font-size:11px;color:var(--t6)">없음</div>'
        ) +
      '</div>' +
      // 지연 경고
      '<div style="padding:10px;background:' + (delayedProjects.length ? 'rgba(239,68,68,.08)' : 'var(--bg-i)') + ';border:1px solid ' + (delayedProjects.length ? 'rgba(239,68,68,.3)' : 'var(--bd-i)') + ';border-radius:8px">' +
        '<div style="font-size:11px;font-weight:600;color:' + (delayedProjects.length ? '#EF4444' : 'var(--t4)') + ';margin-bottom:6px">⚠️ 지연 프로젝트</div>' +
        (delayedProjects.length ?
          delayedProjects.map(function (p) {
            var overDays = daysDiff(p.endDate, today);
            return '<div style="font-size:11px;color:#FCA5A5;padding:2px 0">' + eH(p.name) + ' <span style="color:var(--t6)">(' + overDays + '일 초과)</span></div>';
          }).join('') :
          '<div style="font-size:11px;color:var(--t6)">없음</div>'
        ) +
      '</div>' +
      // 금주 마일스톤
      '<div style="padding:10px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px">' +
        '<div style="font-size:11px;font-weight:600;color:var(--t4);margin-bottom:6px">◆ 금주 마일스톤</div>' +
        (weekMs.length ?
          weekMs.map(function (m) {
            var mProj = projects.find(function (p) { return p.id === m.projectId; });
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
    '<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px;margin-top:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<div style="font-size:12px;font-weight:700;color:var(--t1)">◆ 마일스톤 추적 <span style="font-size:10px;font-weight:400;color:var(--t6)">(' + pendingMs.length + '개 미완료 / ' + milestones.length + '개 전체)</span></div>' +
      '</div>' +
      (pendingMs.length ?
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:6px">' +
        pendingMs.map(function (m) {
          var mProj = projects.find(function (p) { return p.id === m.projectId; });
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

  // Integration 1: 업무유형 분포 렌더
  if (typeof calcTaskDistByOrder === 'function') {
    buildTaskDistSection(projects, taskDist);
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
      '<div style="min-width:60px;font-size:11px;font-weight:600;color:var(--t2)">' + eH(displayName) + '</div>' +
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
  var projects = await projGetAll();
  var milestones = await msGetAll();
  var events = await evtGetAll();
  var today = localDate();

  var lines = [];
  lines.push('당신은 프로젝트 일정 관리 전문가입니다. 다음 데이터를 분석해주세요.');
  lines.push('오늘: ' + today);
  lines.push('');
  lines.push('[프로젝트 목록]');
  projects.forEach(function (p) {
    var st = autoProjectStatus(p);
    lines.push('- ' + (p.name || p.orderNo) + ' | ' + p.startDate + '~' + p.endDate + ' | 상태:' + (PROJ_STATUS[st] || {}).label + ' | 진척:' + (p.progress || 0) + '% | 담당:' + (p.assignees || []).join(',') + (p.dependencies && p.dependencies.length ? ' | 선행:' + p.dependencies.length + '개' : ''));
  });
  lines.push('');
  lines.push('[마일스톤]');
  milestones.forEach(function (m) {
    var proj = projects.find(function (p) { return p.id === m.projectId; });
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
    } catch (e) {}
  }

  lines.push('');
  lines.push('업무분장 약자: A=CS현장, B=제작, D=개발, G=일반, M=관리, S=영업지원');
  lines.push('');
  lines.push('다음 형식으로 한국어 분석:');
  lines.push('## ⚠️ 일정 충돌 감지');
  lines.push('- 겹치는 일정, 동일 담당자 중복 배정 등');
  lines.push('## 🔥 과부하 경고');
  lines.push('- 담당자별 동시 진행 프로젝트 수, 과부하 위험');
  lines.push('## 📊 지연 위험 분석');
  lines.push('- 기한 임박, 진척률 부족, 마일스톤 지연 위험');
  lines.push('## 📋 아카이브-프로젝트 교차 분석');
  lines.push('- 실제 투입시간 vs 예상시간 비교, 미배정 인원, 미착수 프로젝트');
  lines.push('## 💡 최적 배분 제안');
  lines.push('- 리소스 재배분, 일정 조정 제안');

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
  var projects = await projGetAll();
  var milestones = await msGetAll();
  var events = await evtGetAll();
  var today = localDate();
  var html = '';

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
      var proj = projects.find(function (p) { return p.id === m.projectId; });
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
    } catch (e) {}
  }

  return html;
}
