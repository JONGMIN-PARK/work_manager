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

/* ═══ 통합 검색 v13.291 — 서버 /api/search 한 번으로 전체 범위 ═══
 * 예전엔 프로젝트 · 마일스톤 · 이슈 · 수주 · 일정 목록을 통째로 받아 그 안에서만 찾았다.
 * 이제 업무일지 · 회의 · 할 일 · 노트 · 마인드맵 · 문서 · 개발 · 체크리스트 · 코멘트 · 사전검토 · 요소기술 · A/S ·
 * 주간 업무 · 메시지 · 팀원까지 서버가 권한대로 찾아 범주별 상위 몇 건 + 전체 건수를 준다.
 * 고르면 그 화면 · 그 자리로 가서 검색어를 형광으로 표시한다(wmHitShow). */
var GS_CATS = {
  project:   { label: '📁 프로젝트',  icon: '📁' },
  milestone: { label: '◆ 마일스톤',  icon: '◆' },
  issue:     { label: '🎫 이슈',      icon: '🎫' },
  order:     { label: '📋 수주',      icon: '📋' },
  work:      { label: '📒 업무일지',  icon: '📒' },
  meeting:   { label: '🗓 회의',      icon: '🗓' },
  todo:      { label: '✅ 내 할 일',  icon: '✅' },
  note:      { label: '📝 내 노트',   icon: '📝' },
  mindmap:   { label: '🧠 마인드맵',  icon: '🧠' },
  doc:       { label: '📂 문서',      icon: '📂' },
  dev:       { label: '🧩 개발',      icon: '🧩' },
  checklist: { label: '☑️ 체크리스트', icon: '☑️' },
  comment:   { label: '💬 코멘트',    icon: '💬' },
  prestudy:  { label: '🔍 사전검토',  icon: '🔍' },
  tech:      { label: '🧪 요소기술',  icon: '🧪' },
  as:        { label: '🛠️ A/S',       icon: '🛠️' },
  weekly:    { label: '📅 주간 업무', icon: '📅' },
  message:   { label: '✉️ 메시지',    icon: '✉️' },
  member:    { label: '👤 팀원',      icon: '👤' },
  group:     { label: '👥 그룹',      icon: '👥' }
};
var _gs = { q: '', groups: [], only: null, seq: 0 };
var GS_RECENT = 'wm-gs-recent';

function gsHighlight(text, kw) {
  if (!text || !kw) return eH(text || '');
  var escaped = eH(text);
  var kwEsc = eH(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp('(' + kwEsc + ')', 'gi'), '<mark>$1</mark>');
}

/* 그룹(팀원 묶음)은 설정에만 있어 화면에서 찾는다 */
function gsLocalGroups(kl) {
  var out = [];
  (typeof memberGroups !== 'undefined' && Array.isArray(memberGroups) ? memberGroups : []).forEach(function (g) {
    if ((g.name && g.name.toLowerCase().indexOf(kl) >= 0) || (g.members || []).some(function (m) { return String(m).toLowerCase().indexOf(kl) >= 0; }))
      out.push({ id: g.id, title: g.name, sub: (g.members || []).length + '명', nav: { groupId: g.id } });
  });
  return out.length ? { key: 'group', total: out.length, items: out.slice(0, 5) } : null;
}

/* 결과 → 드롭다운 HTML. groups = [{key,total,items}], only = 범주 칩으로 고른 것 */
function gsRenderResults(groups, kw, only) {
  var total = groups.reduce(function (s, g) { return s + g.total; }, 0);
  if (!total) return '<div class="gs-empty">「' + eH(kw) + '」 검색 결과 없음</div>';
  var h = '<div class="gs-head"><span>' + total + '건</span><span class="gs-keys">↑↓ 이동 · Enter 열기 · Esc 닫기</span></div>';
  // 범주 칩 — 누르면 그 범주만 더 많이
  h += '<div class="gs-chips"><button class="gs-chip' + (only ? '' : ' on') + '" onclick="gsOnly(null)">전체</button>' +
    groups.map(function (g) { var c = GS_CATS[g.key] || { label: g.key }; return '<button class="gs-chip' + (only === g.key ? ' on' : '') + '" onclick="gsOnly(\'' + g.key + '\')">' + c.label + ' <b>' + g.total + '</b></button>'; }).join('') + '</div>';
  h += '<div class="gs-list">';
  groups.forEach(function (g) {
    if (only && g.key !== only) return;
    var c = GS_CATS[g.key] || { label: g.key, icon: '•' };
    h += '<div class="gs-group">' + c.label + ' <span>' + g.total + '</span></div>';
    g.items.forEach(function (it, i) {
      h += '<div class="gs-item" data-k="' + g.key + '" data-i="' + i + '" onclick="gsPick(\'' + g.key + '\',' + i + ')">' +
        '<span class="gs-icon">' + c.icon + '</span>' +
        '<span class="gs-main"><span class="gs-name">' + gsHighlight(it.title || '', kw) + '</span>' +
          (it.snippet ? '<span class="gs-snip">' + gsHighlight(it.snippet, kw) + '</span>' : '') + '</span>' +
        (it.sub ? '<span class="gs-sub" title="' + eA(it.sub) + '">' + gsHighlight(it.sub, kw) + '</span>' : '') + '</div>';
    });
    if (!only && g.total > g.items.length) h += '<div class="gs-more" onclick="gsOnly(\'' + g.key + '\')">+' + (g.total - g.items.length) + '건 더 보기</div>';
  });
  return h + '</div>';
}
/* 최근 검색어 (입력칸이 비었을 때) */
function gsRecentHtml() {
  var r = (typeof lsGetJSON === 'function' ? lsGetJSON(GS_RECENT, []) : []) || [];
  if (!r.length) return '';
  return '<div class="gs-head"><span>최근 검색</span></div><div class="gs-list">' + r.map(function (q) {
    return '<div class="gs-item" onclick="gsUseRecent(this.dataset.q)" data-q="' + eA(q) + '"><span class="gs-icon">🕘</span><span class="gs-main"><span class="gs-name">' + eH(q) + '</span></span></div>';
  }).join('') + '</div>';
}
function gsRemember(q) {
  if (typeof lsGetJSON !== 'function') return;
  var r = (lsGetJSON(GS_RECENT, []) || []).filter(function (x) { return x !== q; });
  r.unshift(q); lsSetJSON(GS_RECENT, r.slice(0, 5));
}
function gsUseRecent(q) {
  var inp = document.getElementById('globalSearchInput');
  if (inp) { inp.value = q; inp.focus(); }
  globalSearch(q);
}

function gsOnFocus(v) {
  var dd = document.getElementById('globalSearchDropdown');
  if (dd && dd.style.display === 'flex' && (v || '').trim() === _gs.q) return;
  globalSearch(v);
}
async function globalSearch(kw, only) {
  var dd = document.getElementById('globalSearchDropdown');
  if (!dd) return;
  kw = (kw || '').trim();
  _gsActiveIdx = -1;
  if (!kw) { var rc = gsRecentHtml(); dd.innerHTML = rc; dd.style.display = rc ? 'flex' : 'none'; return; }
  var seq = ++_gs.seq;
  if (_gs.q !== kw) { _gs.only = null; dd.innerHTML = '<div class="gs-empty">찾는 중…</div>'; dd.style.display = 'flex'; }
  _gs.only = only || null;   // 입력칸에서 다시 치면 전체로 (칩은 gsOnly 가 넘김)
  var r;
  try {
    r = await apiFetch('/api/search?q=' + encodeURIComponent(kw) + (_gs.only ? '&cat=' + _gs.only : ''));
  } catch (e) {
    if (seq === _gs.seq) dd.innerHTML = '<div class="gs-empty">검색하지 못했습니다 — ' + eH((e && e.message) || '서버 오류') + '</div>';
    return;
  }
  if (seq !== _gs.seq) return;   // 더 늦게 친 검색어가 이미 나감
  var groups = (r && r.data && r.data.groups) || [];
  if (!_gs.only) { var lg = gsLocalGroups(kw.toLowerCase()); if (lg) groups.push(lg); }
  else if (_gs.q === kw) {   // 범주 하나만 받았으면 나머지 범주(칩 숫자)는 앞 결과 그대로
    groups = _gs.groups.map(function (g) { return g.key === _gs.only ? (groups[0] || g) : g; });
  }
  _gs.q = kw; _gs.groups = groups;
  dd.innerHTML = gsRenderResults(groups, kw, _gs.only);
  dd.style.display = 'flex';
}
function gsOnly(key) {
  var inp = document.getElementById('globalSearchInput');
  if (key && _gs.groups.some(function (g) { return g.key === key && g.items.length >= g.total; })) {   // 이미 다 받았으면 다시 안 받음
    _gs.only = key;
    document.getElementById('globalSearchDropdown').innerHTML = gsRenderResults(_gs.groups, _gs.q, key);
  } else globalSearch(_gs.q, key);
  if (inp) inp.focus();
}

/* 결과 고르기 → 그 화면 · 그 자리로 가서 검색어 형광 표시 */
function gsPick(key, i) {
  var g = _gs.groups.filter(function (x) { return x.key === key; })[0];
  var it = g && g.items[i];
  if (!it) return;
  var kw = _gs.q;
  gsRemember(kw);
  var dd = document.getElementById('globalSearchDropdown');
  if (dd) dd.style.display = 'none';
  var inp = document.getElementById('globalSearchInput');
  if (inp) { inp.value = ''; inp.blur(); }
  globalSearchNav(key, it, kw);
}

/* 프로젝트 상세 패널을 열고(이미 열려 있으면 그대로) 탭을 고른 뒤 cb */
function _gsOpenProject(pid, tab, cb) {
  if (!pid) return;
  if (curPage !== 'project') { setPage('project'); }
  var open = window._pdProj && window._pdProj.id === pid && document.getElementById('projDetailPanel');
  (open ? Promise.resolve() : showProjectDetail(pid)).then(function () {
    if (tab) pdSwitchTab(tab, pid);
    if (cb) cb();
  });
}

function globalSearchNav(type, it, kw) {
  var n = (it && it.nav) || {};
  var hit = function (root, opt) { wmHitShow(root, kw, opt); };
  if (type === 'project') {
    _gsOpenProject(n.projectId, 'overview', function () { hit('#projDetailPanel'); });
  } else if (type === 'milestone') {
    _gsOpenProject(n.projectId, 'overview', function () { hit('#pdOverview'); });
  } else if (type === 'dev') {
    _gsOpenProject(n.projectId, 'dev', function () { hit('#pdDev'); });
  } else if (type === 'checklist') {
    _gsOpenProject(n.projectId, 'lifecycle', function () {
      if (n.phase && typeof pdShowPhase === 'function') pdShowPhase(n.projectId, n.phase);
      hit('#pdLifecycle');
    });
  } else if (type === 'comment') {
    _gsOpenProject(n.projectId, 'overview', function () { hit('#pdCommentsSection'); });
  } else if (type === 'meeting') {
    if (!n.projectId) { setPage('mywork'); return; }
    _gsOpenProject(n.projectId, null, function () {
      if (typeof _pmt !== 'undefined' && _pmt && _pmt.projId === n.projectId) _pmt.open[n.meetingId] = true;
      window._gsMeetOpen = n.meetingId;   // 처음 여는 프로젝트면 pdLoadMeetings 가 이 회의를 펼침
      pdSwitchTab('meeting', n.projectId);
      hit('#pdMeeting', { near: '#pmt-card-' + n.meetingId });
    });
  } else if (type === 'issue') {
    setPage('project'); setMode('issues');
    setTimeout(function () { if (typeof showIssueDetail === 'function') showIssueDetail(n.issueId); hit('#issueDetailPanel'); }, 200);
  } else if (type === 'order') {
    setPage('project');
    if (typeof orderSearchKw !== 'undefined') { orderSearchKw = n.orderNo || kw; if (typeof orderFilterClient !== 'undefined') orderFilterClient = ''; }
    setMode('orders');
    if (typeof renderOrders === 'function') renderOrders();
    hit('#mOrders', { kw2: n.orderNo });
  } else if (type === 'work') {
    setPage('team'); setMode('weekly');
    setTimeout(function () {
      var s = document.getElementById('cSearch');
      if (s) { s.value = kw; if (typeof onSI === 'function') onSI(); }
      hit('#mWeekly');
    }, 300);
  } else if (type === 'todo') {
    setPage('mywork');
    var tries = 0;
    (function open() {
      var x = typeof _mwFind === 'function' ? _mwFind('todo:' + n.todoId) : null;
      if (x && typeof mwPanelOpen === 'function') { mwPanelOpen(x); hit('#mwPanel'); }
      else if (++tries < 30) setTimeout(open, 150);
      else if (typeof showToast === 'function') showToast('내 업무 목록에 없는 할 일입니다 — 완료 · 보관된 것이면 필터를 바꿔 보세요', 'info');
    })();
  } else if (type === 'note') {
    setPage('mywork');
    setTimeout(function () { if (typeof mwNotesOpen === 'function') mwNotesOpen(n.noteDate); hit('#mwNotes, .mwn'); }, 400);
  } else if (type === 'mindmap') {
    setPage('mindmap');
    if (n.nodeId && typeof _mm !== 'undefined') _mm.goto = { mapId: n.mapId, sheet: n.sheet || 0, node: n.nodeId };
    if (typeof mmOpen === 'function') mmOpen(n.mapId);
  } else if (type === 'doc') {
    setPage('project'); setMode('docs');
    setTimeout(function () { if (n.projectId && typeof docSelectProject === 'function') docSelectProject(n.projectId); hit('#mDocs'); }, 200);
  } else if (type === 'prestudy') {
    setPage('project'); setMode('prestudy');
    setTimeout(function () { if (typeof psOpenModal === 'function') psOpenModal(n.prestudyId); hit('#psModal'); }, 300);
  } else if (type === 'tech') {
    setPage('project'); setMode('tech');
    setTimeout(function () { if (typeof techOpenModal === 'function') techOpenModal(n.techId); hit('#techModal'); }, 300);
  } else if (type === 'as') {
    setPage('project'); setMode('as');
    setTimeout(function () { if (typeof showASDetail === 'function') showASDetail(n.asId); hit('#asDetailOverlay'); }, 300);
  } else if (type === 'weekly') {
    setPage('weekly_report');
    setTimeout(function () { var b = document.querySelector('#wrSubTabs [data-wt="list"]'); if (b) b.click(); hit('#mWeeklyReport'); }, 300);
  } else if (type === 'message') {
    setPage('messages');
    setTimeout(function () { if (typeof msgOpenThread === 'function') msgOpenThread(n.peerId); hit('#mMessages'); }, 300);
  } else if (type === 'member') {
    setPage('team'); setMode('weekly');
    setTimeout(function () {
      document.querySelectorAll('#nameChips .chip').forEach(function (c) { if (c.textContent.indexOf(n.name) >= 0) c.click(); });
    }, 200);
  } else if (type === 'group') {
    setPage('team'); setMode('weekly');
  }
}

/* ═══ 찾은 자리 형광 표시 — 범위(root) 안 글자에 <mark class="wm-hit">, 첫 곳으로 스크롤 · 깜빡임.
 * 화면이 늦게 그려지므로 최대 5초 기다리며 찾는다. 다른 곳을 누르면 지움(다시 그리면 자연히 사라짐).
 * opt.near = 이 선택자 요소 안을 먼저 · opt.kw2 = 검색어가 안 보이면 대신 찾을 글자(수주번호 등) */
function wmHitShow(rootSel, kw, opt) {
  opt = opt || {};
  if (!kw) return;
  var t0 = Date.now();
  (function tryIt() {
    var roots = Array.prototype.slice.call(document.querySelectorAll(rootSel)).filter(function (e) { return e.offsetParent || e.getClientRects().length; });
    var root = roots[roots.length - 1];   // 창이 겹치면 맨 위(마지막)
    if (root && opt.near) { var nr = root.querySelector(opt.near); if (nr) root = nr; }
    var n = root ? wmHitMark(root, kw) : 0;
    if (!n && root && opt.kw2) n = wmHitMark(root, opt.kw2);
    if (!n && root) n = wmHitField(root, kw);
    if (n) return;
    if (Date.now() - t0 < 5000) setTimeout(tryIt, 200);
  })();
}
function wmHitClear() {
  document.querySelectorAll('mark.wm-hit').forEach(function (m) {
    var p = m.parentNode; if (!p) return;
    p.replaceChild(document.createTextNode(m.textContent), m); p.normalize();
  });
  document.querySelectorAll('.wm-hit-box').forEach(function (e) { e.classList.remove('wm-hit-box'); });
}
/* root 안 글자 노드에서 kw 를 찾아 감쌈 → 감싼 수. 입력칸 · 스크립트는 건너뜀 */
function wmHitMark(root, kw) {
  wmHitClear();
  var kl = String(kw).toLowerCase(), marks = [];
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: function (t) {
      var p = t.parentNode;
      if (!p || /^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT|OPTION|MARK)$/.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
      return t.nodeValue.toLowerCase().indexOf(kl) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.slice(0, 200).forEach(function (t) {
    var s = t.nodeValue, low = s.toLowerCase(), i = 0, j, frag = document.createDocumentFragment();
    while ((j = low.indexOf(kl, i)) >= 0) {
      if (j > i) frag.appendChild(document.createTextNode(s.slice(i, j)));
      var m = document.createElement('mark'); m.className = 'wm-hit'; m.textContent = s.slice(j, j + kl.length);
      frag.appendChild(m); marks.push(m); i = j + kl.length;
    }
    if (i < s.length) frag.appendChild(document.createTextNode(s.slice(i)));
    t.parentNode.replaceChild(frag, t);
  });
  if (marks.length) _wmHitFocus(marks[0]);
  return marks.length;
}
/* 글자가 입력칸(회의록 · 메모 칸)에만 있으면 그 칸을 강조 */
function wmHitField(root, kw) {
  var kl = String(kw).toLowerCase();
  var f = Array.prototype.slice.call(root.querySelectorAll('textarea, input[type=text], input:not([type])')).filter(function (e) { return String(e.value || '').toLowerCase().indexOf(kl) >= 0; })[0];
  if (!f) return 0;
  _wmHitFocus(f);
  // 입력칸 안 글자는 형광을 못 칠하니 그 부분을 선택해 보이게
  var i = String(f.value).toLowerCase().indexOf(kl);
  setTimeout(function () { try { f.focus({ preventScroll: true }); f.setSelectionRange(i, i + kl.length); } catch (e) {} }, 350);
  return 1;
}
function _wmHitFocus(el) {
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
  var box = el.closest('tr, .gs-row, .pdChkRow, [data-mid], .mw-row, .card, .pnl, li') || el;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') box = el;
  box.classList.remove('wm-hit-box'); void box.offsetWidth; box.classList.add('wm-hit-box');
  setTimeout(function () {   // 다음에 누르면 지움
    document.addEventListener('mousedown', function off(e) { if (e.target.closest && e.target.closest('#globalSearchWrap')) return; document.removeEventListener('mousedown', off, true); wmHitClear(); }, true);
  }, 400);
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

