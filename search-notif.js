/* search-notif.js — 통합 검색(Ctrl+K) · 대시보드 드릴다운 · 알림 센터
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══════════════════════════════════════════════════════════
   Feature 1: 통합 검색 (Global Search)
   ══════════════════════════════════════════════════════════ */
let _gsTimer = null;
function gsDebounce(kw) {
  clearTimeout(_gsTimer);
  _gsTimer = setTimeout(() => globalSearch(kw), 200);
}

var _gsActiveIdx = -1;

function gsHighlight(text, kw) {
  if (!text || !kw) return eH(text || '');
  var escaped = eH(text);
  var kwEsc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp('(' + kwEsc + ')', 'gi'), '<mark style="background:var(--mk);color:var(--mk-t);padding:0 1px;border-radius:2px">$1</mark>');
}

function gsMatchField(obj, fields, kl) {
  for (var i = 0; i < fields.length; i++) {
    var v = obj[fields[i]];
    if (v && String(v).toLowerCase().includes(kl)) return fields[i];
    if (Array.isArray(v) && v.some(function(x) { return String(x).toLowerCase().includes(kl); })) return fields[i];
  }
  return null;
}

var GS_FIELD_LABELS = {
  name: '이름', title: '제목', orderNo: '수주번호', memo: '메모', description: '설명',
  client: '거래처', manager: '담당자', assignees: '담당자', content: '내용',
  label: '라벨', text: '항목', reporter: '보고자', tags: '태그',
  resolution: '해결내용', startDate: '시작일', endDate: '종료일'
};

var _gsCache=null,_gsCacheTime=0;
async function globalSearch(kw) {
  const dd = document.getElementById('globalSearchDropdown');
  if (!dd) return;
  kw = (kw || '').trim();
  if (kw.length < 1) { dd.style.display = 'none'; return; }
  const kl = kw.toLowerCase();
  _gsActiveIdx = -1;

  // gather all data in parallel (cached for 5s)
  var _gsNow=Date.now();
  if(!_gsCache||(_gsNow-_gsCacheTime)>5000){
    _gsCache=await Promise.all([
      typeof projGetAll === 'function' ? projGetAll() : Promise.resolve([]),
      typeof msGetAll === 'function' ? msGetAll() : Promise.resolve([]),
      typeof issueGetAll === 'function' ? issueGetAll() : Promise.resolve([]),
      typeof orderGetAll === 'function' ? orderGetAll() : Promise.resolve([]),
      typeof evtGetAll === 'function' ? evtGetAll() : Promise.resolve([]),
      Promise.resolve([])  // 주간 아카이브(weeks): 과거 IndexedDB 전용 경로라 항상 빈 배열이었음 — 동작 동일
    ]);
    _gsCacheTime=_gsNow;
  }
  const [projects, milestones, issues, orders, events, weeks] = _gsCache;

  // team members from aliases and groups
  var members = [];
  if (typeof aliasMap === 'object') {
    Object.keys(aliasMap).forEach(function(realName) {
      if (realName.toLowerCase().includes(kl) || (aliasMap[realName] && aliasMap[realName].toLowerCase().includes(kl))) {
        members.push({ realName: realName, alias: aliasMap[realName] });
      }
    });
  }
  var groups = [];
  if (Array.isArray(memberGroups)) {
    memberGroups.forEach(function(g) {
      if (g.name && g.name.toLowerCase().includes(kl)) {
        groups.push(g);
      } else if (g.members && g.members.some(function(m) { return m.toLowerCase().includes(kl); })) {
        groups.push(g);
      }
    });
  }

  // search with field tracking
  var pHits = []; projects.forEach(function(p) {
    var f = gsMatchField(p, ['name','orderNo','memo','assignees'], kl);
    if (f) pHits.push({ d: p, f: f });
  });
  var msHits = []; milestones.forEach(function(m) {
    var f = gsMatchField(m, ['name'], kl);
    if (f) msHits.push({ d: m, f: f });
  });
  var iHits = []; issues.forEach(function(i) {
    var f = gsMatchField(i, ['title','description','tags','reporter','assignees','resolution'], kl);
    if (f) iHits.push({ d: i, f: f });
  });
  var oHits = []; orders.forEach(function(o) {
    var f = gsMatchField(o, ['orderNo','name','client','manager','memo'], kl);
    if (f) oHits.push({ d: o, f: f });
  });
  var eHits = []; events.forEach(function(e) {
    var f = gsMatchField(e, ['title','memo','assignees'], kl);
    if (f) eHits.push({ d: e, f: f });
  });
  var wHits = []; if (Array.isArray(weeks)) weeks.forEach(function(w) {
    if (w.label && w.label.toLowerCase().includes(kl)) wHits.push({ d: w, f: 'label' });
    else if (w.fileName && w.fileName.toLowerCase().includes(kl)) wHits.push({ d: w, f: 'fileName' });
    else if (w.selectedNames && w.selectedNames.some(function(n) { return n.toLowerCase().includes(kl); })) wHits.push({ d: w, f: 'selectedNames' });
  });

  // limit results per category
  pHits = pHits.slice(0, 5); msHits = msHits.slice(0, 4); iHits = iHits.slice(0, 5);
  oHits = oHits.slice(0, 5); eHits = eHits.slice(0, 4); wHits = wHits.slice(0, 3);
  members = members.slice(0, 4); groups = groups.slice(0, 3);

  var total = pHits.length + msHits.length + iHits.length + oHits.length + eHits.length + wHits.length + members.length + groups.length;
  if (total === 0) {
    dd.innerHTML = '<div class="gs-empty">검색 결과 없음</div>';
    dd.style.display = 'block';
    return;
  }

  var html = '<div style="padding:6px 10px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--bd)"><span style="font-size:10px;color:var(--t5);font-weight:600">' + total + '건 발견</span><span style="font-size:9px;color:var(--t6)">↑↓ 이동 · Enter 선택 · Esc 닫기</span></div>';

  function fieldHint(f) {
    return f && GS_FIELD_LABELS[f] && f !== 'name' && f !== 'title' ? '<span style="font-size:9px;color:var(--t6);margin-left:4px">[' + GS_FIELD_LABELS[f] + ']</span>' : '';
  }

  // projects
  if (pHits.length) {
    html += '<div class="gs-group">📁 프로젝트 (' + pHits.length + ')</div>';
    pHits.forEach(function(h) {
      var p = h.d; var st = typeof autoProjectStatus === 'function' ? autoProjectStatus(p) : p.status;
      var stInfo = typeof PROJ_STATUS !== 'undefined' && PROJ_STATUS[st] ? PROJ_STATUS[st] : null;
      html += '<div class="gs-item" onclick="globalSearchNav(\'project\',\'' + p.id + '\')">' +
        '<span class="gs-icon" style="color:' + (p.color || 'var(--ac)') + '">●</span>' +
        '<span class="gs-name">' + gsHighlight(p.name, kw) + fieldHint(h.f) + '</span>' +
        '<span class="gs-sub">' + (stInfo ? '<span style="color:' + stInfo.color + '">' + stInfo.icon + '</span> ' : '') + eH(p.orderNo || '') + '</span></div>';
    });
  }
  // milestones
  if (msHits.length) {
    html += '<div class="gs-group">◆ 마일스톤 (' + msHits.length + ')</div>';
    msHits.forEach(function(h) {
      var m = h.d; var proj = projects.find(function(p) { return p.id === m.projectId; });
      html += '<div class="gs-item" onclick="globalSearchNav(\'milestone\',\'' + m.projectId + '\')">' +
        '<span class="gs-icon" style="color:#8B5CF6">◆</span>' +
        '<span class="gs-name">' + gsHighlight(m.name, kw) + '</span>' +
        '<span class="gs-sub">' + eH(proj ? (proj.name || proj.orderNo) : '') + '</span></div>';
    });
  }
  // issues
  if (iHits.length) {
    html += '<div class="gs-group">🎫 이슈 (' + iHits.length + ')</div>';
    iHits.forEach(function(h) {
      var i = h.d;
      var urgColor = i.urgency === 'urgent' ? '#EF4444' : i.urgency === 'normal' ? '#F59E0B' : 'var(--t5)';
      html += '<div class="gs-item" onclick="globalSearchNav(\'issue\',\'' + i.id + '\')">' +
        '<span class="gs-icon" style="color:' + urgColor + '">🎫</span>' +
        '<span class="gs-name">' + gsHighlight(i.title, kw) + fieldHint(h.f) + '</span>' +
        '<span class="gs-sub" style="color:' + urgColor + '">' + eH(i.status || '') + '</span></div>';
    });
  }
  // orders
  if (oHits.length) {
    html += '<div class="gs-group">📋 수주 (' + oHits.length + ')</div>';
    oHits.forEach(function(h) {
      var o = h.d;
      html += '<div class="gs-item" onclick="globalSearchNav(\'order\',\'' + (o.orderNo || o.id || '') + '\')">' +
        '<span class="gs-icon">📋</span>' +
        '<span class="gs-name">' + gsHighlight(o.name || o.orderNo || '', kw) + fieldHint(h.f) + '</span>' +
        '<span class="gs-sub">' + eH(o.client || o.orderNo || '') + '</span></div>';
    });
  }
  // events
  if (eHits.length) {
    html += '<div class="gs-group">📅 일정 (' + eHits.length + ')</div>';
    eHits.forEach(function(h) {
      var e = h.d; var t = typeof EVT_TYPE !== 'undefined' && EVT_TYPE[e.type] ? EVT_TYPE[e.type] : { icon: '📌' };
      html += '<div class="gs-item" onclick="globalSearchNav(\'event\',\'' + e.id + '\')">' +
        '<span class="gs-icon">' + t.icon + '</span>' +
        '<span class="gs-name">' + gsHighlight(e.title, kw) + fieldHint(h.f) + '</span>' +
        '<span class="gs-sub">' + eH(e.startDate || '') + '</span></div>';
    });
  }
  // archived weeks
  if (wHits.length) {
    html += '<div class="gs-group">🗄️ 아카이브 (' + wHits.length + ')</div>';
    wHits.forEach(function(h) {
      var w = h.d;
      html += '<div class="gs-item" onclick="globalSearchNav(\'archive\',\'' + eH(w.id) + '\')">' +
        '<span class="gs-icon">🗄️</span>' +
        '<span class="gs-name">' + gsHighlight(w.label || w.id, kw) + '</span>' +
        '<span class="gs-sub">' + (w.totalHours ? Math.round(w.totalHours) + 'h' : '') + '</span></div>';
    });
  }
  // team members
  if (members.length) {
    html += '<div class="gs-group">👤 팀원 (' + members.length + ')</div>';
    members.forEach(function(m) {
      html += '<div class="gs-item" onclick="globalSearchNav(\'member\',\'' + eH(m.realName) + '\')">' +
        '<span class="gs-icon">👤</span>' +
        '<span class="gs-name">' + gsHighlight(m.realName, kw) + (m.alias ? ' <span style="color:var(--t5)">(' + gsHighlight(m.alias, kw) + ')</span>' : '') + '</span>' +
        '<span class="gs-sub">팀원</span></div>';
    });
  }
  // groups
  if (groups.length) {
    html += '<div class="gs-group">👥 그룹 (' + groups.length + ')</div>';
    groups.forEach(function(g) {
      html += '<div class="gs-item" onclick="globalSearchNav(\'group\',\'' + eH(g.id) + '\')">' +
        '<span class="gs-icon" style="color:' + (g.color || 'var(--ac)') + '">●</span>' +
        '<span class="gs-name">' + gsHighlight(g.name, kw) + '</span>' +
        '<span class="gs-sub">' + (g.members ? g.members.length + '명' : '') + '</span></div>';
    });
  }

  dd.innerHTML = html;
  dd.style.display = 'block';
}

function globalSearchNav(type, id) {
  const dd = document.getElementById('globalSearchDropdown');
  if (dd) dd.style.display = 'none';
  const inp = document.getElementById('globalSearchInput');
  if (inp) { inp.value = ''; inp.blur(); }

  if (type === 'project' || type === 'milestone') {
    setPage('project');
    setMode('pipeline');
    setTimeout(function() { if (typeof showProjectDetail === 'function') showProjectDetail(id); }, 100);
  } else if (type === 'issue') {
    setPage('project');
    setMode('issues');
    setTimeout(function() { if (typeof showIssueDetail === 'function') showIssueDetail(id); }, 200);
  } else if (type === 'order') {
    setPage('project');
    setMode('orders');
  } else if (type === 'event') {
    setPage('project');
    setMode('calendar');
    setTimeout(function() { if (typeof showEventModal === 'function') showEventModal(id); }, 200);
  } else if (type === 'archive') {
    setPage('team');
    setMode('archive');
    setTimeout(function() { if (typeof showArchDetail === 'function') showArchDetail(id); }, 200);
  } else if (type === 'member') {
    setPage('team');
    setMode('weekly');
    // try to select the member in name chips
    setTimeout(function() {
      var chips = document.querySelectorAll('#nameChips .chip');
      chips.forEach(function(c) { if (c.textContent.includes(id)) c.click(); });
    }, 200);
  } else if (type === 'group') {
    setPage('team');
    setMode('weekly');
  }
}

// keyboard navigation for search results
function gsKeyNav(e) {
  var dd = document.getElementById('globalSearchDropdown');
  if (!dd || dd.style.display === 'none') {
    if (e.key === 'Escape') { e.target.blur(); return; }
    return;
  }
  var items = dd.querySelectorAll('.gs-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _gsActiveIdx = Math.min(_gsActiveIdx + 1, items.length - 1);
    gsHighlightActive(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _gsActiveIdx = Math.max(_gsActiveIdx - 1, 0);
    gsHighlightActive(items);
  } else if (e.key === 'Enter' && _gsActiveIdx >= 0 && _gsActiveIdx < items.length) {
    e.preventDefault();
    items[_gsActiveIdx].click();
  } else if (e.key === 'Escape') {
    dd.style.display = 'none';
    _gsActiveIdx = -1;
  }
}

function gsHighlightActive(items) {
  items.forEach(function(el, i) {
    el.style.background = i === _gsActiveIdx ? 'var(--bg-hv)' : '';
  });
  if (_gsActiveIdx >= 0 && items[_gsActiveIdx]) {
    items[_gsActiveIdx].scrollIntoView({ block: 'nearest' });
  }
}

// Ctrl+K shortcut to focus search
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    var inp = document.getElementById('globalSearchInput');
    if (inp) { inp.focus(); inp.select(); }
  }
});

// close search dropdown on outside click
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('globalSearchWrap');
  if (wrap && !wrap.contains(e.target)) {
    const dd = document.getElementById('globalSearchDropdown');
    if (dd) dd.style.display = 'none';
  }
});

/* ═══════════════════════════════════════════════════════════
   Feature 2: 대시보드 드릴다운 (Dashboard Drill-down)
   ══════════════════════════════════════════════════════════ */
function dashDrill(type, value) {
  if (type === 'delayedProjects') {
    setPage('project');
    setMode('pipeline');
    // pipeline 자체적으로 지연 프로젝트를 강조하므로 추가 필터 없음
  } else if (type === 'urgentIssues') {
    setPage('project');
    if (typeof issueFilterUrgency !== 'undefined') {
      issueFilterUrgency = 'urgent';
      issueFilterStatus = '';
    }
    setMode('issues');
    setTimeout(() => { if (typeof renderIssues === 'function') renderIssues(); }, 50);
  } else if (type === 'openIssues') {
    setPage('project');
    if (typeof issueFilterStatus !== 'undefined') {
      issueFilterStatus = 'open';
      issueFilterUrgency = '';
    }
    setMode('issues');
    setTimeout(() => { if (typeof renderIssues === 'function') renderIssues(); }, 50);
  } else if (type === 'inProgressIssues') {
    setPage('project');
    if (typeof issueFilterStatus !== 'undefined') {
      issueFilterStatus = 'inProgress';
      issueFilterUrgency = '';
    }
    setMode('issues');
    setTimeout(() => { if (typeof renderIssues === 'function') renderIssues(); }, 50);
  }
}

/* ═══════════════════════════════════════════════════════════
   Feature 6: 알림 센터 (Notification Center)
   ══════════════════════════════════════════════════════════ */
function toggleNotifPanel() {
  const dd = document.getElementById('notifDropdown');
  if (!dd) return;
  if (dd.style.display === 'none' || !dd.style.display) {
    loadNotifications().then(items => {
      renderNotificationPanel(items);
      dd.style.display = 'block';
    });
  } else {
    dd.style.display = 'none';
  }
}

async function loadNotifications() {
  const today = typeof localDate === 'function' ? localDate() : new Date().toISOString().slice(0,10);
  const d3 = new Date(today); d3.setDate(d3.getDate() + 3); const d3s = d3.toISOString().slice(0,10);
  const d14 = new Date(today); d14.setDate(d14.getDate() - 14); const d14s = d14.toISOString().slice(0,10);

  let items = [];

  try {
    const [projects, milestones, issues] = await Promise.all([
      typeof projGetAll === 'function' ? projGetAll() : Promise.resolve([]),
      typeof msGetAll === 'function' ? msGetAll() : Promise.resolve([]),
      typeof issueGetAll === 'function' ? issueGetAll() : Promise.resolve([])
    ]);

    // Overdue issues (dueDate < today, not resolved/closed)
    issues.filter(i => i.dueDate && i.dueDate < today && i.status !== 'resolved' && i.status !== 'closed')
      .slice(0, 5)
      .forEach(i => items.push({
        icon: '🔴', msg: `이슈 기한 초과: ${i.title}`,
        date: i.dueDate, type: 'issue', id: i.id, priority: 0
      }));

    // Issues due within 3 days
    issues.filter(i => i.dueDate && i.dueDate >= today && i.dueDate <= d3s && i.status !== 'resolved' && i.status !== 'closed')
      .slice(0, 5)
      .forEach(i => {
        const diff = Math.round((new Date(i.dueDate) - new Date(today)) / 86400000);
        items.push({
          icon: '🟡', msg: `이슈 D-${diff}: ${i.title}`,
          date: i.dueDate, type: 'issue', id: i.id, priority: 1
        });
      });

    // Overdue milestones
    milestones.filter(m => m.endDate && m.endDate < today && m.status !== 'done')
      .slice(0, 4)
      .forEach(m => {
        const proj = projects.find(p => p.id === m.projectId);
        items.push({
          icon: '🏁', msg: `마일스톤 초과: ${m.name}${proj ? ' [' + proj.name + ']' : ''}`,
          date: m.endDate, type: 'project', id: m.projectId, priority: 0
        });
      });

    // Delayed projects (endDate < today, not done)
    projects.filter(p => {
      const st = typeof autoProjectStatus === 'function' ? autoProjectStatus(p) : p.status;
      return st === 'delayed';
    }).slice(0, 5).forEach(p => {
      const days = typeof daysDiff === 'function' ? daysDiff(p.endDate, today) : '-';
      items.push({
        icon: '⚠️', msg: `지연 프로젝트: ${p.name} (${days}일 초과)`,
        date: p.endDate, type: 'project', id: p.id, priority: 0
      });
    });

    // Projects stuck in same phase 14+ days
    projects.filter(p => {
      const st = typeof autoProjectStatus === 'function' ? autoProjectStatus(p) : p.status;
      if (st === 'done' || st === 'cancelled') return false;
      return p.phaseUpdatedAt && p.phaseUpdatedAt <= d14s;
    }).slice(0, 3).forEach(p => {
      const days = typeof daysDiff === 'function' ? daysDiff(p.phaseUpdatedAt, today) : '14+';
      const ph = typeof PROJ_PHASE !== 'undefined' && PROJ_PHASE[p.phase] ? PROJ_PHASE[p.phase].label : (p.phase || '');
      items.push({
        icon: '🔄', msg: `단계 정체 ${days}일: ${p.name} (${ph})`,
        date: p.phaseUpdatedAt, type: 'project', id: p.id, priority: 2
      });
    });

  } catch(e) { console.warn('loadNotifications error:', e); }

  // sort by priority then date
  items.sort((a, b) => a.priority - b.priority || (a.date || '').localeCompare(b.date || ''));
  return items;
}

function renderNotificationPanel(items) {
  const dd = document.getElementById('notifDropdown');
  const badge = document.getElementById('notifBadge');
  if (!dd) return;

  if (badge) {
    if (items.length > 0) {
      badge.textContent = items.length > 99 ? '99+' : items.length;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  if (!items.length) {
    dd.innerHTML = '<div class="notif-hdr"><span>🔔 알림 센터</span></div><div class="notif-empty">알림 없음 ✅</div>';
    return;
  }

  let html = `<div class="notif-hdr"><span>🔔 알림 (${items.length})</span><span style="font-size:10px;color:var(--t5);font-weight:400;cursor:pointer" onclick="document.getElementById('notifDropdown').style.display='none'">✕</span></div>`;
  items.forEach(it => {
    const nav = it.type === 'issue'
      ? `globalSearchNav('issue','${it.id}')`
      : `globalSearchNav('project','${it.id}')`;
    html += `<div class="notif-item" onclick="${nav};document.getElementById('notifDropdown').style.display='none'">`;
    html += `<span class="notif-icon">${it.icon}</span>`;
    html += `<div class="notif-body"><div class="notif-msg">${eH(it.msg)}</div><div class="notif-date">${eH(it.date || '')}</div></div>`;
    html += '</div>';
  });
  dd.innerHTML = html;
}

// Update notification badge on page load and after data changes
async function refreshNotifBadge() {
  try {
    const items = await loadNotifications();
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (items.length > 0) {
      badge.textContent = items.length > 99 ? '99+' : items.length;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  } catch(e) { console.warn('[Notif] refreshNotifBadge error', e); }
}

// close notification dropdown on outside click
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('notifWrap');
  if (wrap && !wrap.contains(e.target)) {
    const dd = document.getElementById('notifDropdown');
    if (dd) dd.style.display = 'none';
  }
});

