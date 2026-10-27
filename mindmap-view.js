/**
 * 업무 관리자 — 🧠 마인드맵 편집기 화면 · 그리기
 * 편집기 틀(상단 · 도구 · 캔버스 · 패널 자리), 정렬 메뉴, 시트 탭, 참조 노드 상태 해석·표시,
 * 노드 HTML · 배치(mmLayout) · 연결선 · 경계 · 요약 · 관계선, 확대·이동·화면 맞춤·선택 표시.
 * 의존(전역): mindmap.js, mindmap-layout.js, mindmap-media.js(_mmBlocksHtml · _mmNodeMaxW)
 */

/* ═══ 편집기 화면 ═══ */
function _mmRenderEditor() {
  var wrap = _mmEl('mindmapWrap');
  if (!wrap) return;
  var row = _mm.row;
  var sc = MM_SCOPE[row.scope] || MM_SCOPE.personal;
  var st = _mmSheet().structure || 'balanced';
  // 왼쪽 도구: 아이콘 + 작은 이름 / 상단: 묶음별 아이콘 버튼 (편집 전용은 mm-edit-only — 보기 전용이면 숨김)
  var tool = function (act, icon, label, title, always) {
    return '<button class="mm-rail-btn' + (always ? '' : ' mm-edit-only') + '" data-act="' + act + '" title="' + title + '">' + _mmIcon(icon, 18) + '<span>' + label + '</span></button>';
  };
  var tb = function (act, icon, label, title, extra) {
    return '<button class="mm-tbtn' + (extra || '') + '" data-act="' + act + '"' + (title ? ' title="' + title + '"' : '') + '>' + _mmIcon(icon) + (label ? '<span>' + label + '</span>' : '') + '</button>';
  };
  var menuBtn = function (menuId, icon, label, title, extraWrap) {
    return '<div class="mm-menu-wrap' + (extraWrap || '') + '"><button class="mm-tbtn" data-act="menu" data-menu="' + menuId + '"' + (title ? ' title="' + title + '"' : '') + '>' + _mmIcon(icon) + (label ? '<span>' + label + '</span>' : '') + '</button>';
  };
  var h = '<div class="mm-ed' + (_mm.zen ? ' mm-zen' : '') + '" id="mmEd">' +
    '<div class="mm-top">' +
    '<button class="mm-tbtn mm-tbtn-icon" data-act="back" title="목록으로">' + _mmIcon('back', 18) + '</button>' +
    '<div class="mm-titlebox"><input id="mmTitle" class="mm-title" value="' + _mmEsc(row.title) + '" maxlength="255">' +
    '<div class="mm-subline"><span class="mm-badge">' + sc.i + ' ' + sc.l + (row.project_name ? ' · ' + _mmEsc(row.project_name) : '') + '</span>' +
    '<span id="mmStatus" class="mm-status"></span></div></div>' +
    '<span class="mm-flex"></span>' +
    '<label class="mm-searchbox">' + _mmIcon('search', 14) + '<input id="mmSearch" class="mm-search" placeholder="맵에서 찾기  Ctrl+F"></label>' +
    '<span class="mm-tsep"></span>' +
    '<div class="mm-seg"><button data-act="view-map" id="mmVMap" title="맵">맵</button><button data-act="view-outline" id="mmVOut" title="아웃라인 (Alt+O)">아웃라인</button>' +
    '<button data-act="view-gantt" id="mmVGantt" title="간트 (Alt+J)">간트</button></div>' +
    '<select id="mmStructure" class="mm-select mm-edit-only" title="구조 (Ctrl+Shift+L)">' + MM_STRUCTURES.map(function (s) { return '<option value="' + s.k + '"' + (s.k === st ? ' selected' : '') + '>' + s.l + '</option>'; }).join('') + '</select>' +
    menuBtn('mmAlignMenu', 'align', '정렬', '같은 단계 맞춤 · 글자 정렬 (Alt+G)', ' mm-edit-only') + '<div class="mm-menu hidden" id="mmAlignMenu"></div></div>' +
    (_mm.doc.meta && _mm.doc.meta.gen ? tb('resync', 'sync', '원본과 맞추기', '원본 데이터에 새로 생긴 항목을 맵에 추가', ' mm-edit-only') : '') +
    '<span class="mm-tsep"></span>' +
    menuBtn('mmAiMenu', 'sparkles', 'AI', 'AI 도우미', ' mm-edit-only' + (_mm.aiReady ? '' : ' hidden')).replace('<div class="mm-menu-wrap', '<div id="mmAiWrap" class="mm-menu-wrap') +
    '<div class="mm-menu hidden" id="mmAiMenu">' +
    '<button data-act="ai-expand">💡 하위 주제 제안 <span class="mm-hint">Alt+A</span></button>' +
    '<button data-act="ai-summary">} 가지 요약 <span class="mm-hint">선택 주제</span></button>' +
    '<button data-act="ai-text">📝 글로 가지 만들기</button>' +
    '<button data-act="ai-wbs">🏗 WBS 초안 <span class="mm-hint">프로젝트</span></button></div></div>' +
    menuBtn('mmExportMenu', 'download', '', '내보내기') +
    '<div class="mm-menu hidden" id="mmExportMenu"><button data-act="export-png">PNG 이미지</button><button data-act="export-md">Markdown (.md)</button>' +
    '<button data-act="export-opml">OPML (.opml)</button></div></div>' +
    tb('history', 'history', '기록', '버전 기록 (Ctrl+Shift+H)') +
    ((row.is_owner || _mmIsAdmin()) ? tb('share', 'share', '공유', '공유 설정', ' mm-tbtn-accent') : '') +
    '<span class="mm-tsep"></span>' +
    tb('zen', 'zen', '', '집중 모드 (Ctrl+Shift+F)', ' mm-tbtn-icon') +
    tb('palette', 'command', '', '명령 찾기 (Ctrl+/)', ' mm-tbtn-icon') +
    tb('help', 'help', '', '단축키 (F1)', ' mm-tbtn-icon') +
    '</div>' +
    '<div id="mmBanner"></div>' +
    '<div id="mmAiBar"></div>' +
    '<div class="mm-sheets" id="mmSheets"></div>' +
    '<div class="mm-body">' +
    '<div class="mm-tools">' +
    tool('child', 'child', '하위', '하위 주제 추가 (Tab)') + tool('sibling', 'sibling', '형제', '형제 주제 추가 (Enter · 위는 Shift+Enter)') + tool('parent', 'parent', '부모', '부모 주제 끼워 넣기 (Ctrl+Enter)') +
    tool('del', 'trash', '삭제', '삭제 (Delete) · 여러 개: Ctrl+클릭 / Shift+끌기') + '<span class="mm-tool-sep"></span>' +
    tool('undo', 'undo', '취소', '되돌리기 (Ctrl+Z)') + tool('redo', 'redo', '다시', '다시 실행 (Ctrl+Y)') + '<span class="mm-tool-sep"></span>' +
    tool('relation', 'relation', '관계', '관계선 (Alt+R) — 누른 뒤 이을 주제를 클릭, Esc 취소') + tool('link-ref', 'link', '연결', '앱 데이터 연결 (Alt+L) — 프로젝트·마일스톤·이슈·팀원…') +
    tool('refs-refresh', 'refresh', '상태', '연결된 항목 상태 새로고침', true) + '<span class="mm-tool-sep"></span>' +
    tool('fold', 'fold', '접기', '접기/펴기 (Space)', true) + tool('fold-all', 'level1', '1단계', '1단계만 보기', true) + tool('unfold-all', 'unfold', '펴기', '모두 펴기', true) +
    '</div>' +
    '<div class="mm-canvas" id="mmCanvas"><div class="mm-stage" id="mmStage"></div>' +
    '<textarea id="mmSink" class="mm-sink" aria-label="마인드맵 키 입력" autocomplete="off" spellcheck="false"></textarea>' +
    '<canvas class="mm-minimap' + (_mmMiniOn() ? '' : ' hidden') + '" id="mmMini" width="176" height="114" title="눌러서 그 자리로 이동"></canvas>' +
    '<div class="mm-zoom"><button data-act="zoom-out" title="축소 (Ctrl+-)">' + _mmIcon('minus', 14) + '</button><span id="mmZoomV">100%</span>' +
    '<button data-act="zoom-in" title="확대 (Ctrl+=)">' + _mmIcon('plus', 14) + '</button><span class="mm-zsep"></span>' +
    '<button data-act="fit" title="화면 맞춤 (Ctrl+0)">' + _mmIcon('fit', 14) + '</button>' +
    '<button data-act="minimap" id="mmMiniBtn" class="' + (_mmMiniOn() ? 'on' : '') + '" title="미니맵">' + _mmIcon('map', 14) + '</button></div>' +
    '<button class="mm-zen-exit" data-act="zen">집중 모드 끝내기 (Esc)</button></div>' +
    '<div class="mm-outline hidden" id="mmOutline"></div>' +
    '<div class="mm-gantt hidden" id="mmGantt"></div>' +
    '<div class="mm-panel" id="mmPanel"></div>' +
    '<div class="mm-hist hidden" id="mmHist"></div>' +
    '</div></div>';
  wrap.innerHTML = h;
  wrap.onclick = _mmEdClick;
  var title = _mmEl('mmTitle');
  title.onchange = function () {
    var v = title.value.trim();
    if (!v) { title.value = _mm.row.title; return; }
    if (v === _mm.row.title || _mm.readOnly) { title.value = _mm.row.title; return; }
    _mm.row.title = v; _mm.titleDirty = true; _mmMarkDirty();
  };
  title.onkeydown = function (e) { if (e.key === 'Enter') { title.blur(); _mmFocusCanvas(); } };
  _mmEl('mmStructure').onchange = function () {
    var v = this.value;
    _mmMutate(function () { _mmSheet().structure = v; });
    _mmFit();
  };
  var search = _mmEl('mmSearch');
  search.oninput = function () { _mmSearch(search.value, false); };
  search.onkeydown = function (e) {
    if (e.key === 'Enter') { e.preventDefault(); _mmSearch(search.value, true, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { search.value = ''; _mmSearch('', false); _mmFocusCanvas(); }
  };
  _mmBindCanvas();
  _mmRefreshMode();
  _mmPaintSheets();
  if (typeof _mmAiBar === 'function') _mmAiBar();
  _mmPaint();
  if (_mm.panX == null) _mmFit();
  _mmSetView(_mm.gantt ? 'gantt' : _mm.outline ? 'outline' : 'map');
  if (_mm.hist && _mm.hist.open) mmHistToggle(true);
  _mmFocusCanvas();
}

/** 보기 전용/편집 상태 · 배너 · 상태 표시 갱신 */
function _mmRefreshMode() {
  var ed = _mmEl('mmEd');
  if (!ed) return;
  ed.classList.toggle('mm-ro', _mm.readOnly);
  var t = _mmEl('mmTitle');
  if (t) t.readOnly = _mm.readOnly;
  _mmBanner();
  _mmStatus();
  _mmPaintPanel();
}

function _mmBanner() {
  var b = _mmEl('mmBanner');
  if (!b) return;
  if (_mm.preview) {
    b.innerHTML = _mmHistBannerHtml();
  } else if (_mm.conflict) {
    var who = _mm.conflict.updated_by_name ? _mm.conflict.updated_by_name + ' 님이' : '다른 사용자가';
    b.innerHTML = '<div class="mm-banner mm-banner-warn">⚠️ ' + _mmEsc(who) + ' 먼저 저장해 내 변경을 저장하지 못했습니다. ' +
      '<button class="btn btn-g btn-s" data-act="conflict-reload">최신본 불러오기 (내 변경 버림)</button> ' +
      '<button class="btn btn-g btn-s" data-act="conflict-overwrite">내 내용으로 덮어쓰기</button></div>';
  } else if (_mm.lockedBy) {
    b.innerHTML = '<div class="mm-banner">✏️ <b>' + _mmEsc(_mm.lockedBy) + '</b> 님이 편집 중입니다 — 보기 전용으로 열었습니다. ' +
      '<button class="btn btn-g btn-s" data-act="take-lock">편집 가져오기</button></div>';
  } else if (!_mm.canEdit) {
    b.innerHTML = '<div class="mm-banner">👁 보기 권한만 있습니다.</div>';
  } else {
    b.innerHTML = '';
  }
}

function _mmStatus() {
  var s = _mmEl('mmStatus');
  if (!s) return;
  if (_mm.preview) s.textContent = '🕘 이전 버전 미리 보기';
  else if (_mm.readOnly) s.textContent = '보기 전용';
  else if (_mm.conflict) s.textContent = '⚠️ 저장 충돌';
  else if (_mm.saving) s.textContent = '저장 중…';
  else if (_mm.dirty) s.textContent = '● 변경됨';
  else s.textContent = _mm.lastSaved ? '✓ 저장됨' : '';
}

/* ═══ 정렬 메뉴 — 같은 단계 맞춤(중심 주제 · 선택 가지) · 글자 정렬(시트) ═══ */
var MM_TEXT_ALIGNS = [
  { k: 'auto', l: '자동 — 오른쪽 가지는 왼쪽, 왼쪽 가지는 오른쪽 정렬' },
  { k: 'left', l: '모두 왼쪽 정렬' }, { k: 'center', l: '모두 가운데 정렬' }, { k: 'right', l: '모두 오른쪽 정렬' }
];
function _mmPaintAlignMenu() {
  var m = _mmEl('mmAlignMenu');
  if (!m) return;
  var root = _mmRoot(), f = _mmSelInfo();
  var ta = _mmSheet().textAlign || 'auto';
  var chk = function (on) { return '<span class="mm-chk">' + (on ? '✓' : '') + '</span>'; };
  m.innerHTML = '<div class="mm-menu-h">같은 단계 맞춤 <span class="mm-hint">폭은 가장 넓은 주제 기준</span></div>' +
    '<button data-act="cmd" data-cmd="alignAll">' + chk(root.alignLevels) + '맵 전체 <span class="mm-hint">Alt+G (중심 주제)</span></button>' +
    (f && f.parent && (f.node.children || []).length ? '<button data-act="cmd" data-cmd="alignLevels">' + chk(f.node.alignLevels) + '선택한 가지의 하위만 <span class="mm-hint">Alt+G</span></button>' : '') +
    '<div class="mm-menu-h">글자 정렬 <span class="mm-hint">이 시트</span></div>' +
    MM_TEXT_ALIGNS.map(function (a) { return '<button data-act="cmd" data-cmd="textAlign:' + a.k + '">' + chk(ta === a.k) + a.l + '</button>'; }).join('');
}

/* ═══ 시트 ═══ */
function _mmPaintSheets() {
  var bar = _mmEl('mmSheets');
  if (!bar || !_mm.doc) return;
  var list = _mm.doc.sheets;
  bar.innerHTML = list.map(function (sh, i) {
    var on = i === _mm.sheetIdx;
    return '<button class="mm-sheet' + (on ? ' on' : '') + '" data-act="sheet" data-i="' + i + '" title="' + (on ? '두 번 눌러 이름 바꾸기' : '') + '">' + _mmEsc(sh.title || ('시트 ' + (i + 1))) +
      (on && list.length > 1 ? '<span class="mm-sheet-x mm-edit-only" data-act="sheet-del" data-i="' + i + '" title="시트 삭제">×</span>' : '') + '</button>';
  }).join('') + '<button class="mm-sheet mm-sheet-add mm-edit-only" data-act="sheet-add" title="새 시트 (현재 시트 구조로)">＋</button>';
}
function mmSwitchSheet(i) {
  if (!_mm.doc.sheets[i] || i === _mm.sheetIdx) return;
  _mm.sheetIdx = i;
  _mm.sel = _mmRoot().id;
  _mm.hits = []; _mm.hitIdx = -1; _mm.relFrom = null; _mm.multi = [];
  var st = _mmEl('mmStructure');
  if (st) st.value = _mmSheet().structure || 'balanced';
  _mmPaintSheets();
  _mmPaint();
  _mmFit();
  _mmFocusCanvas();
}
function mmAddSheet() {
  var name = prompt('새 시트 이름', '시트 ' + (_mm.doc.sheets.length + 1));
  if (name == null) return;
  if (_mm.doc.sheets.length >= 20) { _mmToast('시트는 최대 20개까지 만들 수 있습니다', 'error'); return; }
  _mmMutate(function () {
    _mm.doc.sheets.push({ id: 'sh-' + mmUid().slice(2), title: (name.trim() || '시트').slice(0, 60), structure: _mmSheet().structure || 'balanced', root: mmNewNode(name.trim() || '중심 주제'), relations: [] });
    _mm.sheetIdx = _mm.doc.sheets.length - 1;
    _mm.sel = _mmRoot().id;
  });
  var st = _mmEl('mmStructure');
  if (st) st.value = _mmSheet().structure || 'balanced';
  _mmPaintSheets();
  _mmFit();
  _mmFocusCanvas();   // 이름 입력 창이 가져간 키 입력을 캔버스로
}
function mmRenameSheet() {
  if (_mm.readOnly) return;
  var cur = _mmSheet();
  var name = prompt('시트 이름', cur.title || '');
  if (name == null || !name.trim() || name.trim() === cur.title) return;
  _mmMutate(function () { cur.title = name.trim().slice(0, 60); }, { paint: false });
  _mmPaintSheets();
}
function mmDeleteSheet(i) {
  if (_mm.doc.sheets.length <= 1) return;
  var sh = _mm.doc.sheets[i];
  if (!confirm('"' + (sh.title || '') + '" 시트를 삭제할까요? (되돌리기 가능)')) return;
  _mmMutate(function () {
    _mm.doc.sheets.splice(i, 1);
    _mm.sheetIdx = Math.max(0, Math.min(_mm.sheetIdx, _mm.doc.sheets.length - 1));
    _mm.sel = _mmRoot().id;
  });
  _mmPaintSheets();
  _mmFit();
}

/* ═══ 앱 데이터 참조 — 상태 해석 ═══ */
function _mmAllRefs() {
  var out = [], seen = {};
  (_mm.doc ? _mm.doc.sheets : []).forEach(function (sh) {
    mmWalk(sh.root, function (n) {
      if (!n.ref) return;
      var k = n.ref.type + ':' + n.ref.id;
      if (!seen[k]) { seen[k] = true; out.push({ type: n.ref.type, id: n.ref.id }); }
    });
  });
  return out;
}
/** 참조 상태 불러오기 — onlyMissing 이면 아직 모르는 것만 */
function _mmResolveRefs(onlyMissing) {
  var mapId = _mm.mapId;
  var refs = _mmAllRefs().filter(function (r) { return !onlyMissing || !_mm.refs[r.type + ':' + r.id]; });
  if (!refs.length) return Promise.resolve();
  return apiFetch('/api/mindmaps/resolve', { method: 'POST', body: JSON.stringify({ refs: refs }) }).then(function (r) {
    if (_mm.mapId !== mapId) return;
    var d = (r && r.data) || {};
    Object.keys(d).forEach(function (k) { _mm.refs[k] = d[k]; });
    _mmPaint();
  }).catch(function () {});
}
function _mmStatusLabel(type, st) {
  if (st == null || st === '') return '';
  var tbl = null;
  if (type === 'project' || type === 'milestone') tbl = (typeof PROJ_STATUS !== 'undefined') ? PROJ_STATUS : null;
  else if (type === 'issue') {
    tbl = (typeof ISSUE_STATUS !== 'undefined') ? ISSUE_STATUS : null;
    if (st === 'in_progress') st = 'inProgress';
  } else if (type === 'as') tbl = (typeof AS_STATUS !== 'undefined') ? AS_STATUS : null;
  else if (type === 'prestudy' && typeof PS_STATUS !== 'undefined') { for (var i = 0; i < PS_STATUS.length; i++) if (PS_STATUS[i].key === st) return PS_STATUS[i].label; }
  else if (type === 'tech' && typeof TECH_STATUS !== 'undefined') { for (var j = 0; j < TECH_STATUS.length; j++) if (TECH_STATUS[j].key === st) return TECH_STATUS[j].label; }
  return (tbl && tbl[st] && tbl[st].label) || st;
}
/** 참조 노드의 상태 한 줄 (해석 결과 r) */
function _mmRefLine(n) {
  if (!n.ref) return '';
  var info = MM_REF_TYPES[n.ref.type] || { i: '🔗', l: '항목' };
  var r = _mm.refs[n.ref.type + ':' + n.ref.id];
  var body = [];
  if (!r) body.push('<span class="mm-ref-dim">불러오는 중…</span>');
  else if (r.locked) body.push('<span class="mm-ref-dim">🔒 볼 권한이 없는 항목</span>');
  else if (r.missing) body.push('<span class="mm-late">⚠️ 삭제된 항목</span>');
  else {
    var st = _mmStatusLabel(n.ref.type, r.status);
    if (st) body.push('<b>' + _mmEsc(st) + '</b>');
    if (r.progress != null && n.ref.type !== 'user') {
      var pg = Math.max(0, Math.min(100, parseInt(r.progress, 10) || 0));
      body.push('<span class="mm-ref-bar"><i style="width:' + pg + '%"></i></span>' + pg + '%');
    }
    if (n.ref.type === 'user') body.push('◆ ' + (r.msCount || 0) + ' · 🎫 ' + (r.issueCount || 0) + (r.dept ? ' · ' + _mmEsc(r.dept) : ''));
    if (r.trl) body.push('TRL ' + _mmEsc(r.trl));
    if (r.people && r.people.length) body.push('👤 ' + _mmEsc(r.people.slice(0, 3).join(', ')) + (r.people.length > 3 ? ' 외 ' + (r.people.length - 3) : ''));
    var end = r.end || (n.ref.type === 'meeting' ? r.start : null);
    if (end) {
      var done = r.done || r.status === 'done';
      var late = !done && n.ref.type !== 'meeting' && String(end).slice(0, 10) < new Date().toISOString().slice(0, 10);
      body.push('<span class="' + (late ? 'mm-late' : '') + '">📅 ' + _mmEsc(String(end).slice(5, 10)) + '</span>');
    }
    // 프로젝트명은 맵의 프로젝트(맵 소속 · 중심 주제 참조)와 다를 때만
    var rootRef = _mmRoot().ref;
    var mapProj = (rootRef && rootRef.type === 'project') ? rootRef.id : (_mm.row && _mm.row.project_id);
    if (r.projectName && n.ref.type !== 'project' && r.projectId !== mapProj) body.push('<span class="mm-ref-dim">' + _mmEsc(r.projectName) + '</span>');
  }
  return '<div class="mm-ref"><span class="mm-ref-open" data-open-ref="1" title="' + info.l + ' 열기">' + info.i + '</span>' + body.join(' · ') + '</div>';
}
function _mmRefDone(n) {
  if (!n.ref) return false;
  var r = _mm.refs[n.ref.type + ':' + n.ref.id];
  return !!(r && (r.done || r.status === 'done'));
}

/* ═══ 그리기 ═══ */
/** 주제 색 — 중심은 강조색, 주요 주제는 자기 색 또는 차례대로 자동 색, 그 아래는 부모 색을 물려받음. colors = 지금까지 정한 {id: 색} */
function _mmNodeColor(n, parent, depth, root, colors) {
  if (depth === 0) return _mmColorVar(n.color) || 'var(--ac)';
  if (depth === 1) return _mmColorVar(n.color) || _mmColorVar(MM_AUTO_COLORS[root.children.indexOf(n) % MM_AUTO_COLORS.length]);
  return _mmColorVar(n.color) || colors[parent.id];
}
function _mmNodeHtml(n, depth, color, num) {
  var hit = _mm.hits.indexOf(n.id) >= 0;
  var cls = 'mm-node ' + (depth === 0 ? 'mm-root' : depth === 1 ? 'mm-main' : 'mm-topic2') +
    ((n.done || _mmRefDone(n)) ? ' mm-done' : '') + (hit ? ' mm-hit' : '') + (n.id === _mm.sel ? ' mm-sel' : '') + (n.color ? ' mm-colored' : '') +
    (n.ref ? ' mm-has-ref' : '') + (n._ai ? ' mm-ai' : '') + (n.collapsed && (n.children || []).length ? ' mm-folded' : '') + (n.id === _mm.relFrom ? ' mm-rel-from' : '') + (_mm.multi.indexOf(n.id) >= 0 ? ' mm-multi' : '') +
    (_mm.preview ? _mmHistNodeClass(n.id) : '');
  var mk = '';
  (n.markers || []).forEach(function (m) {
    var pm = /^priority-(\d)$/.exec(m);
    if (pm) { mk += '<span class="mm-pri mm-pri' + pm[1] + '">' + pm[1] + '</span>'; return; }
    for (var i = 0; i < MM_SYMBOLS.length; i++) if (MM_SYMBOLS[i].k === m) mk += '<span class="mm-sym">' + MM_SYMBOLS[i].g + '</span>';
  });
  if (n.progress != null && n.progress !== '' && !isNaN(n.progress)) {
    var pg = Math.max(0, Math.min(100, parseInt(n.progress, 10)));
    mk += '<span class="mm-prog" title="진척 ' + pg + '%">' + (pg >= 100 ? '●' : pg >= 75 ? '◕' : pg >= 50 ? '◑' : pg >= 25 ? '◔' : '○') + '</span>';
  }
  var icons = '';
  if (n.note) icons += '<span class="mm-ico" title="' + _mmEsc(String(n.note).slice(0, 300)) + '">📝</span>';
  if (n.link && /^https?:\/\//i.test(n.link)) icons += '<a class="mm-ico" href="' + _mmEsc(n.link) + '" target="_blank" rel="noopener" title="' + _mmEsc(n.link) + '">🔗</a>';
  var meta = [];
  if (n.assigneeId) meta.push('👤 ' + _mmEsc(_mmMemberName(n.assigneeId) || '담당'));
  if (n.dueDate) {
    var late = !n.done && n.dueDate < new Date().toISOString().slice(0, 10);
    meta.push('<span class="' + (late ? 'mm-late' : '') + '">📅 ' + _mmEsc((n.startDate ? n.startDate.slice(5) + '~' : '') + n.dueDate.slice(5)) + '</span>');
  }
  var labels = (n.labels || []).length ? '<div class="mm-labels">' + n.labels.map(function (l) { return '<span class="mm-label">' + _mmEsc(l) + '</span>'; }).join('') + '</div>' : '';
  var kids = (n.children || []).length;
  var fold = (kids && depth > 0 || (kids && n.collapsed)) ? '<span class="mm-fold" data-fold="' + _mmEsc(n.id) + '">' + (n.collapsed ? kids : '−') + '</span>' : '';
  var maxW = (typeof _mmNodeMaxW === 'function') ? _mmNodeMaxW(n) : 0;   // 이미지 줄이 있으면 그만큼 넓게
  var dfTip = _mm.preview ? _mmHistNodeTip(n.id) : '';
  return '<div class="' + cls + '" data-id="' + _mmEsc(n.id) + '"' + (dfTip ? ' title="' + _mmEsc(dfTip) + '"' : '') + ' style="--mm-c:' + color + (maxW ? ';max-width:' + maxW + 'px' : '') + '">' +
    '<div class="mm-line">' + (num ? '<span class="mm-num">' + num + '</span>' : '') + mk + '<span class="mm-txt">' + (n.text ? _mmEsc(n.text) : '<i class="mm-ph">(빈 주제)</i>') + '</span>' + icons + '</div>' +
    (typeof _mmBlocksHtml === 'function' ? _mmBlocksHtml(n) : '') + _mmRefLine(n) + labels + (meta.length ? '<div class="mm-meta">' + meta.join(' · ') + '</div>' : '') + fold + '</div>';
}

function _mmPaint() {
  var stage = _mmEl('mmStage');
  if (!stage || !_mm.doc) return;
  var sheet = _mmSheet();
  var root = sheet.root;
  var st = sheet.structure || 'balanced';
  var html = [];
  var colors = {};
  var nums = mmNumbering(root);
  mmWalk(root, function (n, parent, depth) {
    var c = _mmNodeColor(n, parent, depth, root, colors);
    colors[n.id] = c;
    html.push(_mmNodeHtml(n, depth, c, nums[n.id]));
    if (n.summary && !n.collapsed && (n.children || []).length) {
      html.push('<div class="mm-sumlabel" data-sum="' + _mmEsc(n.id) + '" style="--mm-c:' + c + '">' + _mmEsc(n.summary.text || '요약') + '</div>');
    }
    if (n.collapsed) return false;
  });
  stage.innerHTML = '<svg class="mm-edges" id="mmEdges" xmlns="http://www.w3.org/2000/svg"></svg>' + html.join('');
  var sizes = {};
  // 이음매: 주제 상자는 화소 단위로 맞춰 그려지는데 선(SVG)은 그렇지 않아, 위치 · 크기가 소수면 확대할수록
  // 밑줄과 선이 위아래로 어긋난다. 크기는 실제 크기를 올림한 정수로 재 최소 크기로 두고, 위치도 정수로 맞춘다.
  // (width 로 고정하면 글꼴이 늦게 받아져 글자가 넓어질 때 한 글자씩 줄이 꺾인다 — min-width 라 그때는 늘어난다)
  var zm = _mm.zoom || 1;
  function sizeOf(el) {
    var r = el.getBoundingClientRect();
    var w = r.width ? r.width / zm : el.offsetWidth, h = r.width ? r.height / zm : el.offsetHeight;
    return { w: Math.ceil(w - 0.01), h: Math.ceil(h - 0.01) };
  }
  var els = stage.querySelectorAll('.mm-node');
  els.forEach(function (el) { sizes[el.getAttribute('data-id')] = sizeOf(el); });
  var sumEls = stage.querySelectorAll('.mm-sumlabel');
  sumEls.forEach(function (el) { sizes['sum:' + el.getAttribute('data-sum')] = sizeOf(el); });
  var lay = mmLayout(root, st, sizes);
  var deco = mmDecorations(root, st, lay, sizes);
  _mm.layout = lay;
  Object.keys(lay.pos).forEach(function (id) { var p = lay.pos[id]; p.x = Math.round(p.x); p.y = Math.round(p.y); });
  els.forEach(function (el) {
    var id = el.getAttribute('data-id');
    var p = lay.pos[id];
    if (!p) { el.style.display = 'none'; return; }
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.setAttribute('data-side', p.side);
    el.style.minWidth = p.w + 'px';
    el.style.minHeight = p.h + 'px';
    // 같은 단계 맞춤으로 넓힌 주제는 그 너비로 (글자 정렬은 시트 설정 — stage 의 mm-ta-*)
    if (lay.aligned && lay.aligned[id]) { el.style.width = p.w + 'px'; el.classList.add('mm-aligned'); }
  });
  // 가로 구조는 하위 주제 밑줄을 SVG 연결선이 이어 그린다 — CSS 밑줄은 자리만 차지(투명)
  stage.className = 'mm-stage mm-ta-' + (sheet.textAlign || 'auto') + (st === 'down' ? '' : ' mm-ul-svg');
  var b = lay.bounds;
  b.minX = Math.floor(b.minX); b.minY = Math.floor(b.minY); b.maxX = Math.ceil(b.maxX); b.maxY = Math.ceil(b.maxY);
  var pad = 40;
  var paths = [];
  var extra = [];
  // 경계 (노드 뒤)
  deco.boundaries.forEach(function (bd) {
    paths.push('<rect class="mm-boundary" x="' + bd.x + '" y="' + bd.y + '" width="' + bd.w + '" height="' + bd.h + '" rx="12" style="stroke:' + colors[bd.id] + ';fill:' + colors[bd.id] + '"/>');
    if (bd.title) extra.push('<div class="mm-bd-title" style="left:' + (bd.x + 8) + 'px;top:' + (bd.y - 19) + 'px;--mm-c:' + colors[bd.id] + '">' + _mmEsc(bd.title) + '</div>');
  });
  // 요약 중괄호 + 글상자 위치
  deco.summaries.forEach(function (sm) {
    paths.push('<path class="mm-sumbrace" d="' + sm.path + '" style="stroke:' + colors[sm.id] + '"/>');
    var el = stage.querySelector('.mm-sumlabel[data-sum="' + sm.id + '"]');
    if (el) { el.style.left = sm.x + 'px'; el.style.top = sm.y + 'px'; }
  });
  Object.keys(lay.pos).forEach(function (id) {
    var p = lay.pos[id];
    if (!p.parentId) return;
    var pp = lay.pos[p.parentId];
    if (p.depth <= 2) {
      // 가지는 부모 쪽이 굵고 끝으로 갈수록 가늘게 (유료 마인드맵 툴의 기본 모양)
      // 끝 굵기를 하위 주제 밑줄과 같게 — 밑줄까지 한 도형이라 이음매가 없다.
      var w0 = p.depth === 1 ? 7 : 3.4, w1 = p.depth === 1 ? 2.4 : MM_UNDERLINE;
      paths.push('<path d="' + mmEdgeShape(pp, p, st, w0, w1) + '" class="mm-branch" style="fill:' + colors[id] + '"/>');
    } else {
      paths.push('<path d="' + mmEdgePath(pp, p, st) + '" class="mm-edge" style="stroke:' + colors[id] + ';stroke-width:' + MM_UNDERLINE + '"/>');
    }
  });
  var svg = _mmEl('mmEdges');
  var w = (b.maxX - b.minX) + pad * 2, hh = (b.maxY - b.minY) + pad * 2;
  svg.setAttribute('viewBox', (b.minX - pad) + ' ' + (b.minY - pad) + ' ' + w + ' ' + hh);
  svg.setAttribute('width', w);
  svg.setAttribute('height', hh);
  svg.style.left = (b.minX - pad) + 'px';
  svg.style.top = (b.minY - pad) + 'px';
  // 관계선 (양 끝이 보일 때만)
  (sheet.relations || []).forEach(function (rl) {
    var a = lay.pos[rl.from], c = lay.pos[rl.to];
    if (!a || !c) return;
    var rp = mmRelationPath(a, c);
    paths.push('<path class="mm-relation" d="' + rp.d + '" marker-end="url(#mmArrow)"/>');
    extra.push('<div class="mm-rel-label' + (rl.label ? '' : ' mm-rel-empty') + '" data-rel="' + _mmEsc(rl.id) + '" style="left:' + rp.mx + 'px;top:' + rp.my + 'px">' + _mmEsc(rl.label || '') + '</div>');
  });
  svg.innerHTML = '<defs><marker id="mmArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M0,0 L10,5 L0,10 z" class="mm-arrow"/></marker></defs>' + paths.join('');
  if (extra.length) stage.insertAdjacentHTML('beforeend', extra.join(''));
  _mmApplyTransform();
  _mmPaintPanel();
  if (typeof _mmAiBar === 'function') _mmAiBar();
  if (_mm.outline) _mmPaintOutline();
  if (_mm.gantt) _mmPaintGantt();
}

// 글꼴(웹 폰트 글자 묶음)이 그린 뒤에 받아지면 주제 크기가 바뀌므로 다시 배치 — 입력 중이면 건너뜀
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', function () {
    var stage = _mmEl('mmStage');
    if (stage && stage.offsetParent && _mm.doc && !_mm.editing) _mmPaint();
  });
}

/* ═══ 미니맵 — 전체 축소 지도 + 지금 보이는 영역, 눌러서 이동 ═══ */
function _mmMiniOn() {
  try { return localStorage.getItem('mm-minimap') !== '0'; } catch (_) { return true; }
}
function mmToggleMinimap() {
  var on = !_mmMiniOn();
  try { localStorage.setItem('mm-minimap', on ? '1' : '0'); } catch (_) {}
  var c = _mmEl('mmMini'), b = _mmEl('mmMiniBtn');
  if (c) c.classList.toggle('hidden', !on);
  if (b) b.classList.toggle('on', on);
  _mmPaintMini();
}
function _mmMiniGeom() {
  var c = _mmEl('mmMini');
  if (!c || !_mm.layout) return null;
  var b = _mm.layout.bounds, pad = 30;
  var bw = b.maxX - b.minX + pad * 2, bh = b.maxY - b.minY + pad * 2;
  var k = Math.min(c.width / bw, c.height / bh);
  return { c: c, k: k, ox: (c.width - bw * k) / 2 - (b.minX - pad) * k, oy: (c.height - bh * k) / 2 - (b.minY - pad) * k };
}
function _mmPaintMini() {
  var g = _mmMiniGeom();
  if (!g || g.c.classList.contains('hidden')) return;
  var ctx = g.c.getContext('2d');
  var cs = getComputedStyle(g.c);
  ctx.clearRect(0, 0, g.c.width, g.c.height);
  var pos = _mm.layout.pos;
  var stage = _mmEl('mmStage');
  Object.keys(pos).forEach(function (id) {
    var p = pos[id];
    var el = stage && stage.querySelector('.mm-node[data-id="' + id + '"]');
    ctx.fillStyle = (el && getComputedStyle(el).borderTopColor) || cs.color;
    ctx.globalAlpha = p.depth === 0 ? 0.95 : p.depth === 1 ? 0.75 : 0.45;
    ctx.fillRect(g.ox + p.x * g.k, g.oy + p.y * g.k, Math.max(2, p.w * g.k), Math.max(2, p.h * g.k));
  });
  ctx.globalAlpha = 1;
  var cv = _mmEl('mmCanvas');
  if (!cv) return;
  // 지금 보이는 영역
  var vx = -_mm.panX / _mm.zoom, vy = -_mm.panY / _mm.zoom, vw = cv.clientWidth / _mm.zoom, vh = cv.clientHeight / _mm.zoom;
  ctx.strokeStyle = cs.outlineColor || '#5B8DEF';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(g.ox + vx * g.k, g.oy + vy * g.k, vw * g.k, vh * g.k);
}
/** 미니맵을 누르거나 끌면 그 자리를 화면 가운데로 */
function _mmMiniPan(e) {
  var g = _mmMiniGeom(), cv = _mmEl('mmCanvas');
  if (!g || !cv) return;
  var r = g.c.getBoundingClientRect();
  var sx = ((e.clientX - r.left) * (g.c.width / r.width) - g.ox) / g.k;
  var sy = ((e.clientY - r.top) * (g.c.height / r.height) - g.oy) / g.k;
  _mm.panX = cv.clientWidth / 2 - sx * _mm.zoom;
  _mm.panY = cv.clientHeight / 2 - sy * _mm.zoom;
  _mmApplyTransform();
}

function _mmApplyTransform() {
  var stage = _mmEl('mmStage');
  if (!stage) return;
  stage.style.transform = 'translate(' + (_mm.panX || 0) + 'px,' + (_mm.panY || 0) + 'px) scale(' + _mm.zoom + ')';
  _mmPaintMini();
  var z = _mmEl('mmZoomV');
  if (z) z.textContent = Math.round(_mm.zoom * 100) + '%';
}

function _mmFit() {
  var cv = _mmEl('mmCanvas');
  if (!cv || !_mm.layout) return;
  var b = _mm.layout.bounds;
  var cw = cv.clientWidth || 800, ch = cv.clientHeight || 500;
  var bw = b.maxX - b.minX + 80, bh = b.maxY - b.minY + 80;
  _mm.zoom = Math.max(0.25, Math.min(1.1, Math.min(cw / bw, ch / bh)));
  _mm.panX = cw / 2 - ((b.minX + b.maxX) / 2) * _mm.zoom;
  _mm.panY = ch / 2 - ((b.minY + b.maxY) / 2) * _mm.zoom;
  _mmApplyTransform();
}

function _mmZoomAt(factor, cx, cy) {
  var cv = _mmEl('mmCanvas');
  if (!cv) return;
  if (cx == null) { cx = cv.clientWidth / 2; cy = cv.clientHeight / 2; }
  var nz = Math.max(0.2, Math.min(3, _mm.zoom * factor));
  _mm.panX = cx - (cx - _mm.panX) * (nz / _mm.zoom);
  _mm.panY = cy - (cy - _mm.panY) * (nz / _mm.zoom);
  _mm.zoom = nz;
  _mmApplyTransform();
}

/** 선택 노드가 화면 밖이면 보이게 이동 */
function _mmEnsureVisible(id) {
  var cv = _mmEl('mmCanvas');
  var p = _mm.layout && _mm.layout.pos[id];
  if (!cv || !p) return;
  var m = 40;
  var x1 = _mm.panX + p.x * _mm.zoom, y1 = _mm.panY + p.y * _mm.zoom;
  var x2 = x1 + p.w * _mm.zoom, y2 = y1 + p.h * _mm.zoom;
  var cw = cv.clientWidth, ch = cv.clientHeight;
  if (x1 < m) _mm.panX += m - x1; else if (x2 > cw - m) _mm.panX -= x2 - (cw - m);
  if (y1 < m) _mm.panY += m - y1; else if (y2 > ch - m) _mm.panY -= y2 - (ch - m);
  _mmApplyTransform();
}

function _mmSelect(id, opts) {
  if (!id) return;
  _mm.sel = id;
  var stage = _mmEl('mmStage');
  if (stage) stage.querySelectorAll('.mm-node').forEach(function (el) { el.classList.toggle('mm-sel', el.getAttribute('data-id') === id); });
  if (!opts || opts.scroll !== false) _mmEnsureVisible(id);
  _mmPaintPanel();
}

function _mmFocusCanvas() {
  // 키 입력은 캔버스 안의 투명한 입력칸(mmSink)이 받는다 — 한글 IME 가 켜지려면 입력 가능한 요소여야 함
  var sink = _mmEl('mmSink');
  if (sink && !_mm.outline && !_mm.gantt && !_mm.editing) { try { sink.focus({ preventScroll: true }); } catch (_) { sink.focus(); } }
}
