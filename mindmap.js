/**
 * 업무 관리자 — 🧠 마인드맵 (PRD_마인드맵 Phase 1)
 * 상위 탭 페이지. 관리자 + 관리자가 지정한 사용자만 사용 (currentUser.mindmapAccess).
 *
 * 화면: 목록(카드) / 편집기(맵 · 아웃라인 · 집중 모드)
 * 편집: XMind 식 키보드 — Tab 하위 · Enter 형제 · Ctrl+Enter 부모 · F2 편집 · Space 접기 · 방향키 이동 ·
 *       Del 삭제 · Ctrl+Z/Y · Ctrl+C/X/V(가지) · Alt+1~9 우선순위 · Ctrl+F 검색 · Ctrl+Shift+F 집중 모드
 * 저장: 1.5초 자동 저장(낙관적 락 version) · 편집 잠금(/api/locks, resourceType='mindmap')
 * Phase 2: 여러 시트 · 앱 데이터 참조 노드(node.ref — /api/mindmaps/resolve 로 실시간 상태) · 경계 · 요약 · 관계선 · 번호 ·
 *          AI 제안 미리보기(_ai 노드, 저장 제외). 모달·AI·가져오기 등은 mindmap-extra.js
 * 의존(전역): apiFetch, currentUser, createModal, wmGuardedModal, showToast, eH, projGetAll, html2canvas,
 *            mindmap-layout.js (mmLayout · mmEdgePath · mmFind · mmWalk · mmMoveNode · mmFromMarkdown …)
 */

var MM_COLORS = [
  { key: '', label: '자동' },
  { key: 'blue', c: 'var(--stat-blue,#3B82F6)' },
  { key: 'green', c: 'var(--stat-green,#10B981)' },
  { key: 'amber', c: 'var(--stat-amber,#F59E0B)' },
  { key: 'rose', c: 'var(--stat-rose,#F43F5E)' },
  { key: 'purple', c: 'var(--stat-purple,#8B5CF6)' },
  { key: 'cyan', c: 'var(--stat-cyan,#06B6D4)' },
  { key: 'slate', c: '#64748B' }
];
var MM_AUTO_COLORS = ['blue', 'green', 'amber', 'rose', 'purple', 'cyan'];
var MM_SYMBOLS = [
  { k: 'flag', g: '🚩', l: '플래그' }, { k: 'star', g: '⭐', l: '별' }, { k: 'question', g: '❓', l: '질문' },
  { k: 'warning', g: '⚠️', l: '주의' }, { k: 'idea', g: '💡', l: '아이디어' }, { k: 'check', g: '✅', l: '확인' },
  { k: 'cross', g: '❌', l: '취소' }, { k: 'people', g: '👥', l: '협의' }
];
var MM_STRUCTURES = [
  { k: 'balanced', l: '마인드맵 ⇆' }, { k: 'right', l: '논리도 →' }, { k: 'down', l: '조직도 ↓' }
];
var MM_SCOPE = {
  personal: { l: '개인', i: '🔒' },
  project: { l: '프로젝트', i: '📁' },
  dept: { l: '팀', i: '👥' },
  org: { l: '조직', i: '🏢' }
};
/* 앱 데이터 참조 노드 종류 (server lib/mindmap-data REF_TYPES 와 같은 키) */
var MM_REF_TYPES = {
  project: { i: '📁', l: '프로젝트' }, milestone: { i: '◆', l: '마일스톤' }, issue: { i: '🎫', l: '이슈' },
  user: { i: '👤', l: '팀원' }, tech: { i: '🧪', l: '요소기술' }, prestudy: { i: '🔍', l: '사전검토' },
  as: { i: '🛠️', l: 'A/S' }, meeting: { i: '🤝', l: '회의' }
};
var MM_TEMPLATES = [
  { k: 'blank', l: '빈 맵', tree: function (t) { return { text: t, children: [] }; } },
  { k: 'meeting', l: '회의', tree: function (t) { return { text: t, children: ['안건', '논의 내용', '결정 사항', '할 일 (담당 · 기한)', '다음 회의'] }; } },
  { k: 'wbs', l: '프로젝트 WBS 골격', structure: 'right', tree: function (t) { return { text: t, children: [
    { text: '기획 · 사양', children: ['요구사항', '사양 확정', '견적'] },
    { text: '설계', children: ['기구', '전장', 'SW'] },
    { text: '제작', children: ['가공 · 구매', '조립', '배선'] },
    { text: '시운전', children: ['자체 시운전', '고객 입회'] },
    { text: '납품 · 셋업', children: ['출하', '현장 셋업', '교육 · 인수'] }
  ] }; } },
  { k: 'swot', l: 'SWOT', tree: function (t) { return { text: t, children: ['강점 (S)', '약점 (W)', '기회 (O)', '위협 (T)'] }; } },
  { k: 'why5', l: '5 Why (원인 분석)', structure: 'right', tree: function (t) { return { text: t, children: [
    { text: '왜? 1', children: [{ text: '왜? 2', children: [{ text: '왜? 3', children: [{ text: '왜? 4', children: ['왜? 5 → 근본 원인'] }] }] }] }
  ] }; } },
  { k: 'weekly', l: '내 주간 업무', tree: function (t) { return { text: t, children: ['이번 주 한 일', '다음 주 할 일', '이슈 · 리스크', '요청 · 협조', '아이디어'] }; } },
  { k: 'team', l: '팀 업무 분장', structure: 'down', tree: function (t) { return { text: t, children: ['팀원 1', '팀원 2', '팀원 3'] }; } }
];

/* 앱 데이터로 자동 생성 (lib/mindmap-data generate) · AI 로 만들기 — mindmap-extra.js 가 문서를 만든다 */
var MM_GEN_TEMPLATES = [
  { k: 'gen-project', gen: 'project', l: '📁 프로젝트 구조도', hint: '프로젝트 → 마일스톤 · 체크리스트(단계별) · 미해결 이슈 · 최근 회의. 마일스톤·이슈는 상태가 실시간으로 보입니다.' },
  { k: 'gen-team', gen: 'team', l: '👥 팀원 업무 지도', hint: '부서 → 팀원 → 담당 프로젝트 · 마일스톤 · 이슈 · A/S. 내가 볼 수 있는 프로젝트의 업무만 나옵니다.' },
  { k: 'gen-mine', gen: 'mine', l: '🙋 내 업무', hint: '나 → 담당 마일스톤(프로젝트별) · 이슈 · A/S + 할 일 · 아이디어 가지.' }
];
var MM_AI_TEMPLATES = [
  { k: 'ai-text', ai: 'text', l: '✨ 글을 맵으로 정리', hint: '회의 메모·요구사항·메일을 붙여넣으면 AI 가 갈래를 나눠 맵으로 만듭니다.' },
  { k: 'ai-wbs', ai: 'wbs', l: '✨ 프로젝트 WBS 초안', hint: '프로젝트 정보(기간·메모·사양·기존 마일스톤)로 단계 → 작업 → 산출물 초안을 만듭니다.' }
];

var _mm = {
  view: 'list', listTab: 'all', q: '', list: [], members: null,
  mapId: null, row: null, doc: null, version: 0, canEdit: false, readOnly: true,
  sel: null, editing: false, dirty: false, titleDirty: false, saving: false, saveAgain: false, saveTimer: null, savePromise: null,
  undo: [], redo: [], zoom: 1, panX: 0, panY: 0, layout: null, outline: false, zen: false,
  search: '', hits: [], hitIdx: -1, clip: null, clipText: '', lockTimer: null, lockedBy: null, conflict: null, lastSaved: null,
  sheetIdx: 0, refs: {}, relFrom: null, aiReady: null,
  multi: []   // 여러 주제 선택 (Ctrl+클릭 · Shift+끌기 · Ctrl+A) — 비어 있으면 _mm.sel 하나
};

/** 지금 선택된 주제 id 목록 (여러 개 선택이면 그 목록, 아니면 [sel]) */
function _mmSelIds() {
  if (_mm.multi.length) return _mm.multi.slice();
  return _mm.sel ? [_mm.sel] : [];
}
function _mmClearMulti() {
  if (!_mm.multi.length) return;
  _mm.multi = [];
  var st = _mmEl('mmStage');
  if (st) st.querySelectorAll('.mm-multi').forEach(function (el) { el.classList.remove('mm-multi'); });
  _mmPaintPanel();
}
function _mmToggleMulti(id) {
  if (!_mm.multi.length && _mm.sel && _mm.sel !== id) _mm.multi = [_mm.sel];
  var i = _mm.multi.indexOf(id);
  if (i >= 0) _mm.multi.splice(i, 1); else _mm.multi.push(id);
  if (_mm.multi.length === 1) { _mm.sel = _mm.multi[0]; _mm.multi = []; }
  else if (_mm.multi.length) _mm.sel = id;
  _mmPaintMulti();
  _mmPaintPanel();
}
function _mmPaintMulti() {
  var st = _mmEl('mmStage');
  if (!st) return;
  st.querySelectorAll('.mm-node').forEach(function (el) {
    var id = el.getAttribute('data-id');
    el.classList.toggle('mm-multi', _mm.multi.indexOf(id) >= 0);
    el.classList.toggle('mm-sel', id === _mm.sel);
  });
}

/* ═══ 공통 헬퍼 ═══ */
function _mmEsc(v) { return (typeof eH === 'function') ? eH(v == null ? '' : v) : String(v == null ? '' : v); }
function _mmToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _mmErr(e) { return (e && e.message) || '권한 또는 서버 오류'; }
function _mmEl(id) { return document.getElementById(id); }
function _mmMe() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }
function _mmIsAdmin() { var u = _mmMe(); return !!(u && u.role === 'admin'); }
function mmHasAccess() { var u = _mmMe(); return !!(u && (u.role === 'admin' || u.mindmapAccess)); }
function _mmSheet() {
  var list = _mm.doc.sheets;
  if (!(_mm.sheetIdx >= 0 && _mm.sheetIdx < list.length)) _mm.sheetIdx = 0;
  return list[_mm.sheetIdx];
}
function _mmRoot() { return _mmSheet().root; }
function _mmColorVar(key) {
  for (var i = 0; i < MM_COLORS.length; i++) if (MM_COLORS[i].key === key && MM_COLORS[i].c) return MM_COLORS[i].c;
  return null;
}
function _mmFmtTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d)) return '';
  var diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return Math.floor(diff / 60) + '분 전';
  if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
  return (d.getMonth() + 1) + '/' + d.getDate();
}
function _mmMemberName(id) {
  var list = _mm.members || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
  return '';
}
function _mmLoadMembers() {
  if (_mm.members) return Promise.resolve(_mm.members);
  return apiFetch('/api/mindmaps/members').then(function (r) { _mm.members = (r && r.data) || []; return _mm.members; })
    .catch(function () { _mm.members = []; return _mm.members; });
}
/** 템플릿 정의 → 노드 트리 (문자열 자식은 노드로) */
function _mmBuildTree(def) {
  var n = mmNewNode(typeof def === 'string' ? def : def.text);
  if (typeof def !== 'string') n.children = (def.children || []).map(_mmBuildTree);
  return n;
}
function _mmDownload(name, blob) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function _mmFileName(s) { return String(s || 'mindmap').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80); }

/* ═══ 진입점 ═══ */
function renderMindmap() {
  var wrap = _mmEl('mindmapWrap');
  if (!wrap) return;
  if (!mmHasAccess()) {
    wrap.innerHTML = '<div class="mm-empty">🧠 마인드맵 사용 권한이 없습니다. 관리자에게 요청하세요.</div>';
    return;
  }
  _mmBindGlobal();
  if (_mm.mapId) { mmOpen(_mm.mapId); return; }
  _mmRenderList();
}

/** 다른 페이지로 나갈 때 (mode.js setPage) — 저장 마무리 · 잠금 해제 */
function mmOnLeave() {
  if (_mm.view !== 'editor') return;
  _mmSetZen(false);
  _mmSaveNow();
  _mmLockRelease();
}

/* ═══ 목록 ═══ */
function _mmRenderList() {
  var wrap = _mmEl('mindmapWrap');
  if (!wrap) return;
  _mm.view = 'list';
  var tabs = [['all', '전체'], ['mine', '내 맵'], ['shared', '공유받은'], ['project', '프로젝트'], ['org', '조직']];
  var h = '<div class="mm-list-head">' +
    '<div><h3 class="mm-h3">🧠 마인드맵</h3><div class="mm-sub">생각 정리 · 업무 분장 · 프로젝트 구조 — 개인 맵은 본인과 공유한 사람만 볼 수 있습니다.</div></div>' +
    '<div class="mm-list-actions">' +
    (_mmIsAdmin() ? '<button class="btn btn-g btn-s" data-act="access">👥 사용 권한</button>' : '') +
    '<button class="btn btn-g btn-s" data-act="import">⤓ 가져오기</button>' +
    '<button class="btn btn-p btn-s" data-act="new">+ 새 맵</button>' +
    '</div></div>' +
    '<div class="mm-list-bar"><div class="mm-seg">' +
    tabs.map(function (t) { return '<button data-act="tab" data-tab="' + t[0] + '" class="' + (_mm.listTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') +
    '</div><input id="mmListQ" class="mm-input" placeholder="🔍 제목 검색" value="' + _mmEsc(_mm.q) + '"></div>' +
    '<div id="mmListBody"><div class="mm-empty">로딩 중...</div></div>';
  wrap.innerHTML = h;
  wrap.onclick = _mmListClick;
  var q = _mmEl('mmListQ');
  if (q) q.oninput = function () { _mm.q = q.value; _mmPaintList(); };
  apiFetch('/api/mindmaps').then(function (r) {
    _mm.list = (r && r.data) || [];
    _mmPaintList();
  }).catch(function (e) {
    var b = _mmEl('mmListBody');
    if (b) b.innerHTML = '<div class="mm-empty">목록을 불러오지 못했습니다 — ' + _mmEsc(e && e.status === 404 ? '서버 배포 후 사용 가능' : _mmErr(e)) + '</div>';
  });
}

function _mmPaintList() {
  var body = _mmEl('mmListBody');
  if (!body) return;
  var me = (_mmMe() || {}).id;
  var q = (_mm.q || '').trim().toLowerCase();
  var list = _mm.list.filter(function (m) {
    if (q && String(m.title || '').toLowerCase().indexOf(q) < 0) return false;
    switch (_mm.listTab) {
      case 'mine': return m.owner_id === me;
      case 'shared': return m.owner_id !== me && m.scope === 'personal';
      case 'project': return m.scope === 'project';
      case 'org': return m.scope === 'org';
      default: return true;
    }
  });
  if (!list.length) {
    body.innerHTML = '<div class="mm-empty">' + (_mm.list.length ? '조건에 맞는 맵이 없습니다.' : '아직 맵이 없습니다. <b>+ 새 맵</b>으로 시작하세요.') + '</div>';
    return;
  }
  function isPinned(m) { return (m.pinned_by || []).indexOf(me) >= 0; }
  var pinned = list.filter(isPinned);
  var rest = list.filter(function (m) { return !isPinned(m); });
  var h = '';
  if (pinned.length) h += '<div class="mm-sec">⭐ 즐겨찾기</div><div class="mm-grid">' + pinned.map(_mmCardHtml).join('') + '</div>';
  h += (pinned.length ? '<div class="mm-sec">최근 수정</div>' : '') + '<div class="mm-grid">' + rest.map(_mmCardHtml).join('') + '</div>';
  body.innerHTML = h;
}

function _mmCardHtml(m) {
  var me = (_mmMe() || {}).id;
  var sc = MM_SCOPE[m.scope] || MM_SCOPE.personal;
  var pinned = (m.pinned_by || []).indexOf(me) >= 0;
  var owner = m.owner_id === me;
  var shared = (m.editors || []).length + (m.viewers || []).length;
  return '<div class="mm-card" data-act="open" data-id="' + _mmEsc(m.id) + '">' +
    '<div class="mm-card-top"><span class="mm-badge">' + sc.i + ' ' + sc.l + '</span>' +
    '<span class="mm-star' + (pinned ? ' on' : '') + '" data-act="pin" data-id="' + _mmEsc(m.id) + '" title="즐겨찾기">' + (pinned ? '★' : '☆') + '</span></div>' +
    '<div class="mm-card-title">' + _mmEsc(m.title) + '</div>' +
    '<div class="mm-card-root">◉ ' + _mmEsc(m.root_text || '') + '</div>' +
    (m.project_name ? '<div class="mm-card-meta">📁 ' + _mmEsc(m.project_name) + '</div>' : '') +
    '<div class="mm-card-meta">' + _mmEsc(m.owner_name || '') + (shared ? ' · 공유 ' + shared + '명' : '') +
    ' · 노드 ' + (m.node_count || 0) + ' · ' + _mmFmtTime(m.updated_at) + '</div>' +
    '<div class="mm-card-acts">' +
    '<button class="btn btn-g btn-s" data-act="dup" data-id="' + _mmEsc(m.id) + '">복제</button>' +
    ((owner || (_mmIsAdmin() && m.scope !== 'personal')) ? '<button class="btn btn-g btn-s mm-danger" data-act="del" data-id="' + _mmEsc(m.id) + '">삭제</button>' : '') +
    '</div></div>';
}

function _mmListClick(e) {
  var t = e.target.closest('[data-act]');
  if (!t || !this.contains(t)) return;
  var act = t.getAttribute('data-act');
  var id = t.getAttribute('data-id');
  if (act !== 'open') e.stopPropagation();
  if (act === 'tab') { _mm.listTab = t.getAttribute('data-tab'); _mmRenderListTabs(); _mmPaintList(); }
  else if (act === 'open') mmOpen(id);
  else if (act === 'new') mmNewMapModal();
  else if (act === 'import') mmImportModal();
  else if (act === 'access') mmAccessModal();
  else if (act === 'pin') _mmTogglePin(id);
  else if (act === 'dup') _mmDuplicate(id);
  else if (act === 'del') _mmDelete(id);
}
function _mmRenderListTabs() {
  document.querySelectorAll('#mindmapWrap .mm-list-bar [data-act="tab"]').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-tab') === _mm.listTab);
  });
}
function _mmTogglePin(id) {
  var me = (_mmMe() || {}).id;
  var m = _mm.list.filter(function (x) { return x.id === id; })[0];
  if (!m) return;
  var pinned = (m.pinned_by || []).indexOf(me) < 0;
  apiFetch('/api/mindmaps/' + encodeURIComponent(id) + '/pin', { method: 'PUT', body: JSON.stringify({ pinned: pinned }) })
    .then(function () {
      m.pinned_by = (m.pinned_by || []).filter(function (x) { return x !== me; });
      if (pinned) m.pinned_by.push(me);
      _mmPaintList();
    }).catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
}
function _mmDuplicate(id) {
  apiFetch('/api/mindmaps/' + encodeURIComponent(id) + '/duplicate', { method: 'POST', body: '{}' })
    .then(function () { _mmToast('내 개인 맵으로 복제했습니다'); _mmRenderList(); })
    .catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
}
function _mmDelete(id) {
  var m = _mm.list.filter(function (x) { return x.id === id; })[0];
  if (!confirm('"' + (m ? m.title : '') + '" 맵을 삭제할까요?')) return;
  apiFetch('/api/mindmaps/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function () { _mmToast('삭제했습니다'); _mmRenderList(); })
    .catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
}

/* ═══ 새 맵 · 가져오기 · 사용 권한 모달 ═══ */
function mmNewMapModal() {
  return wmGuardedModal('mmNew', function () {
    var pList = (typeof projGetAll === 'function') ? projGetAll().catch(function () { return []; }) : Promise.resolve([]);
    var dList = _mmIsAdmin() ? apiFetch('/api/departments').then(function (r) { return (r && r.data) || []; }).catch(function () { return []; }) : Promise.resolve([]);
    var aiP = (typeof mmAiCheck === 'function') ? mmAiCheck() : Promise.resolve(false);
    return Promise.all([pList, dList, aiP]).then(function (res) {
      var projects = (res[0] || []).slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
      var depts = res[1] || [];
      var ai = !!res[2];
      var me = _mmMe() || {};
      var hasDept = !!(me.department_id || me.departmentId);
      var opt = function (t) { return '<option value="' + t.k + '">' + t.l + '</option>'; };
      var html = '<div class="mm-form">' +
        '<label>시작 방법<select id="mmNewTpl" class="mm-input">' +
        '<optgroup label="빈 틀">' + MM_TEMPLATES.map(opt).join('') + '</optgroup>' +
        '<optgroup label="앱 데이터로 자동 생성 (상태가 실시간으로 보임)">' + MM_GEN_TEMPLATES.map(opt).join('') + '</optgroup>' +
        (ai ? '<optgroup label="✨ AI">' + MM_AI_TEMPLATES.map(opt).join('') + '</optgroup>' : '') +
        '</select></label>' +
        '<div class="mm-sub" id="mmNewHint"></div>' +
        '<label>제목<input id="mmNewTitle" class="mm-input" placeholder="예: SK 2호기 WBS"></label>' +
        '<label id="mmNewProjWrap" class="hidden">프로젝트<select id="mmNewProj" class="mm-input"><option value="">선택…</option>' +
        projects.map(function (p) { return '<option value="' + _mmEsc(p.id) + '">' + _mmEsc((p.orderNo ? '[' + p.orderNo + '] ' : '') + (p.name || '')) + '</option>'; }).join('') +
        '</select></label>' +
        '<label id="mmNewDeptWrap" class="hidden">부서<select id="mmNewDept" class="mm-input">' +
        (hasDept ? '<option value="">내 부서</option>' : '') + (_mmIsAdmin() ? '<option value="__all">전체 (모든 사용자)</option>' : '') +
        depts.map(function (d) { return '<option value="' + _mmEsc(d.id) + '">' + _mmEsc(d.name) + '</option>'; }).join('') + '</select></label>' +
        '<label id="mmNewAiWrap" class="hidden">정리할 글 (회의 메모 · 요구사항 · 메일 등)<textarea id="mmNewAiText" class="mm-input" rows="8"></textarea></label>' +
        '<label>공개 범위<select id="mmNewScope" class="mm-input">' +
        '<option value="personal">🔒 개인 — 나와 공유한 사람만</option>' +
        '<option value="project">📁 프로젝트 — 프로젝트 권한을 따름</option>' +
        ((hasDept || _mmIsAdmin()) ? '<option value="dept">👥 팀 — 같은 부서 사용 권한자 읽기</option>' : '') +
        (_mmIsAdmin() ? '<option value="org">🏢 조직 — 사용 권한자 전체 읽기</option>' : '') +
        '</select></label>' +
        '<div class="mm-form-acts"><button class="btn btn-p" id="mmNewOk">만들기</button></div></div>';
      var md = createModal({ id: 'mmNewModal', title: '🧠 새 마인드맵', html: html, width: '500px', closeOnEsc: true });
      var scope = _mmEl('mmNewScope'), tplSel = _mmEl('mmNewTpl');
      function tplOf(k) { return MM_TEMPLATES.concat(MM_GEN_TEMPLATES, MM_AI_TEMPLATES).filter(function (t) { return t.k === k; })[0] || MM_TEMPLATES[0]; }
      function refresh(fromTpl) {
        var t = tplOf(tplSel.value);
        if (fromTpl) {
          if (t.gen === 'project' || t.ai === 'wbs') scope.value = 'project';
          else if (t.gen === 'team' && scope.querySelector('option[value="dept"]')) scope.value = 'dept';
          else if (t.gen === 'mine') scope.value = 'personal';
        }
        var needProj = scope.value === 'project' || t.gen === 'project' || t.ai === 'wbs';
        _mmEl('mmNewProjWrap').classList.toggle('hidden', !needProj);
        _mmEl('mmNewDeptWrap').classList.toggle('hidden', !(_mmIsAdmin() && (t.gen === 'team' || scope.value === 'dept')));
        _mmEl('mmNewAiWrap').classList.toggle('hidden', t.ai !== 'text');
        _mmEl('mmNewTitle').placeholder = (t.gen || t.ai) ? '비우면 자동으로 정함' : '예: SK 2호기 WBS';
        _mmEl('mmNewHint').textContent = t.hint || '';
      }
      tplSel.onchange = function () { refresh(true); };
      scope.onchange = function () { refresh(false); };
      refresh(false);
      _mmEl('mmNewTitle').onkeydown = function (e) { if (e.key === 'Enter') _mmEl('mmNewOk').click(); };
      _mmEl('mmNewOk').onclick = function () {
        var btn = this;
        var t = tplOf(tplSel.value);
        var title = _mmEl('mmNewTitle').value.trim();
        var projectId = _mmEl('mmNewProj').value || null;
        var deptSel = _mmEl('mmNewDept').value;
        var deptId = deptSel && deptSel !== '__all' ? deptSel : null;
        if (!title && !t.gen && !t.ai) { _mmToast('제목을 입력하세요', 'error'); return; }
        if ((scope.value === 'project' || t.gen === 'project' || t.ai === 'wbs') && !projectId) { _mmToast('프로젝트를 선택하세요', 'error'); return; }
        var made;
        if (t.gen) made = mmGenerateDoc(t.gen, { projectId: projectId, departmentId: deptId, all: deptSel === '__all' });
        else if (t.ai === 'text') made = mmAiTextDoc(_mmEl('mmNewAiText').value, title);
        else if (t.ai === 'wbs') made = mmAiWbsDoc(projectId, title);
        else {
          var root = _mmBuildTree(t.tree(title));
          root.id = 'n-root';
          made = Promise.resolve({ title: title, doc: { sheets: [{ id: 'sh-1', title: '시트 1', structure: t.structure || 'balanced', root: root, relations: [] }] } });
        }
        btn.disabled = true;
        var oldLabel = btn.textContent;
        if (t.gen || t.ai) btn.textContent = t.ai ? '✨ AI 가 정리하는 중…' : '불러오는 중…';
        made.then(function (r) {
          if (!r) throw new Error('만들 내용이 없습니다');
          return _mmCreate({ title: (title || r.title || '새 맵').slice(0, 255), scope: scope.value, projectId: projectId, departmentId: scope.value === 'dept' ? deptId : null, template: t.k, doc: r.doc });
        }).then(function (ok) {
          if (ok) md.close(); else { btn.disabled = false; btn.textContent = oldLabel; }
        }).catch(function (e) {
          btn.disabled = false; btn.textContent = oldLabel;
          _mmToast('❌ ' + _mmErr(e), 'error');
        });
      };
    });
  }, 'mmNewModal', { onOpen: function () { var t = _mmEl('mmNewTpl'); if (t) t.focus(); } });
}

function _mmCreate(body) {
  return apiFetch('/api/mindmaps', { method: 'POST', body: JSON.stringify(body) })
    .then(function (r) { mmOpen(r.data.id); return true; })
    .catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); return false; });
}

function mmImportModal() {
  return wmGuardedModal('mmImport', function () {
    var html = '<div class="mm-form">' +
      '<div class="mm-sub"><b>XMind</b>(.xmind) · <b>OPML</b>(.opml) 파일, 또는 <b>Markdown</b> 목록·제목(<code># 중심 주제</code>, <code>## 주요 주제</code>, <code>- 하위</code>)을 맵으로 바꿉니다.</div>' +
      '<label>파일<input type="file" id="mmImpFile" accept=".xmind,.opml,.xml,.md,.markdown,.txt" class="mm-input"></label>' +
      '<div class="mm-sub" id="mmImpInfo"></div>' +
      '<label>또는 붙여넣기 (Markdown)<textarea id="mmImpText" class="mm-input" rows="10" placeholder="# 프로젝트\n## 설계\n- 기구\n  - 프레임"></textarea></label>' +
      '<div class="mm-form-acts"><button class="btn btn-p" id="mmImpOk">맵 만들기</button></div></div>';
    var md = createModal({ id: 'mmImportModal', title: '⤓ 가져오기', html: html, width: '560px', closeOnEsc: true });
    var pending = null;   // XMind · OPML 에서 읽은 { title, doc }
    _mmEl('mmImpFile').onchange = function () {
      var f = this.files && this.files[0];
      pending = null;
      _mmEl('mmImpInfo').textContent = '';
      if (!f) return;
      if (/\.(xmind|opml|xml)$/i.test(f.name) && typeof mmReadImportFile === 'function') {
        _mmEl('mmImpInfo').textContent = '읽는 중…';
        mmReadImportFile(f).then(function (r) {
          pending = r;
          var n = 0;
          r.doc.sheets.forEach(function (sh) { n += mmCount(sh.root); });
          _mmEl('mmImpInfo').textContent = '✓ ' + f.name + ' — 시트 ' + r.doc.sheets.length + '개, 주제 ' + n + '개';
        }).catch(function (e) { _mmEl('mmImpInfo').textContent = '❌ ' + _mmErr(e); });
        return;
      }
      var rd = new FileReader();
      rd.onload = function () { _mmEl('mmImpText').value = rd.result; };
      rd.readAsText(f, 'utf-8');
    };
    _mmEl('mmImpOk').onclick = function () {
      var btn = this;
      var title, doc;
      if (pending) {
        title = pending.title; doc = pending.doc;
      } else {
        var root = mmFromMarkdown(_mmEl('mmImpText').value);
        if (!root) { _mmToast('가져올 내용이 없습니다', 'error'); return; }
        root.id = 'n-root';
        title = root.text;
        doc = { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: root, relations: [] }] };
      }
      var count = 0;
      doc.sheets.forEach(function (sh) { count += mmCount(sh.root); });
      if (count > 2000) { _mmToast('노드는 최대 2000개까지 가져올 수 있습니다 (' + count + '개)', 'error'); return; }
      btn.disabled = true;
      _mmCreate({ title: (title || '가져온 맵').slice(0, 100), scope: 'personal', template: 'import', doc: doc })
        .then(function (ok) { if (ok) md.close(); else btn.disabled = false; });
    };
  }, 'mmImportModal', { onOpen: function () { var t = _mmEl('mmImpText'); if (t) t.focus(); } });
}

/** 관리자: 사용 권한 부여/회수 */
function mmAccessModal() {
  return wmGuardedModal('mmAccess', function () {
    return apiFetch('/api/mindmaps/access/users').then(function (r) {
      var users = (r && r.data) || [];
      var roleL = { admin: '관리자', executive: '임원', manager: '팀장', member: '팀원' };
      var html = '<div class="mm-sub" style="margin-bottom:10px">관리자는 항상 사용할 수 있습니다. 그 외 사용자는 여기서 켠 사람만 마인드맵 탭이 보입니다. 권한을 끄면 그 사람의 맵은 보존되고 접근만 막힙니다.</div>' +
        '<input id="mmAccQ" class="mm-input" placeholder="🔍 이름·이메일" style="margin-bottom:8px">' +
        '<div class="mm-acc-list">' + users.map(function (u) {
          var admin = u.role === 'admin';
          return '<label class="mm-acc-row" data-q="' + _mmEsc(((u.name || '') + ' ' + (u.email || '')).toLowerCase()) + '">' +
            '<input type="checkbox" data-uid="' + _mmEsc(u.id) + '"' + (admin || u.mindmap_enabled ? ' checked' : '') + (admin ? ' disabled' : '') + '>' +
            '<span class="mm-acc-name">' + _mmEsc(u.name || '') + '</span>' +
            '<span class="mm-acc-meta">' + _mmEsc(roleL[u.role] || u.role || '') + ' · ' + _mmEsc(u.email || '') + '</span></label>';
        }).join('') + '</div>';
      createModal({ id: 'mmAccessModal', title: '👥 마인드맵 사용 권한', html: html, width: '520px', closeOnEsc: true });
      var box = _mmEl('mmAccessModal');
      box.addEventListener('change', function (e) {
        var cb = e.target;
        if (!cb || !cb.getAttribute('data-uid')) return;
        var on = cb.checked;
        apiFetch('/api/mindmaps/access/users/' + encodeURIComponent(cb.getAttribute('data-uid')), { method: 'PUT', body: JSON.stringify({ enabled: on }) })
          .then(function () { _mmToast(on ? '사용 권한을 부여했습니다' : '사용 권한을 회수했습니다'); _mm.members = null; })
          .catch(function (err) { cb.checked = !on; _mmToast('❌ ' + _mmErr(err), 'error'); });
      });
      _mmEl('mmAccQ').oninput = function () {
        var q = this.value.trim().toLowerCase();
        box.querySelectorAll('.mm-acc-row').forEach(function (row) {
          row.style.display = !q || row.getAttribute('data-q').indexOf(q) >= 0 ? '' : 'none';
        });
      };
    });
  }, 'mmAccessModal');
}

/** 소유자: 공개 범위 · 공유 대상 */
function mmShareModal() {
  if (!_mm.row) return;
  return wmGuardedModal('mmShare', function () {
    var pList = (typeof projGetAll === 'function') ? projGetAll().catch(function () { return []; }) : Promise.resolve([]);
    return Promise.all([_mmLoadMembers(), pList]).then(function (res) {
      var me = (_mmMe() || {}).id;
      var members = (res[0] || []).filter(function (u) { return u.id !== me; });
      var projects = res[1] || [];
      var row = _mm.row;
      var editors = row.editors || [], viewers = row.viewers || [];
      var html = '<div class="mm-form">' +
        '<label>공개 범위<select id="mmShScope" class="mm-input">' +
        '<option value="personal"' + (row.scope === 'personal' ? ' selected' : '') + '>🔒 개인 — 나와 아래 공유 대상만</option>' +
        '<option value="project"' + (row.scope === 'project' ? ' selected' : '') + '>📁 프로젝트 — 프로젝트 권한을 따름</option>' +
        (_mmIsAdmin() || row.scope === 'org' ? '<option value="org"' + (row.scope === 'org' ? ' selected' : '') + '>🏢 조직 — 사용 권한자 전체 읽기</option>' : '') +
        '</select></label>' +
        '<label id="mmShProjWrap" class="' + (row.scope === 'project' ? '' : 'hidden') + '">프로젝트<select id="mmShProj" class="mm-input"><option value="">선택…</option>' +
        projects.map(function (p) { return '<option value="' + _mmEsc(p.id) + '"' + (p.id === row.project_id ? ' selected' : '') + '>' + _mmEsc((p.orderNo ? '[' + p.orderNo + '] ' : '') + (p.name || '')) + '</option>'; }).join('') +
        '</select></label>' +
        '<div class="mm-sub">공유 대상 — 마인드맵 사용 권한이 있는 사람만 고를 수 있습니다.</div>' +
        '<div class="mm-acc-list">' + members.map(function (u) {
          var role = editors.indexOf(u.id) >= 0 ? 'edit' : viewers.indexOf(u.id) >= 0 ? 'view' : '';
          return '<div class="mm-acc-row"><span class="mm-acc-name">' + _mmEsc(u.name) + '</span>' +
            (u.has_access ? '<select class="mm-input mm-sh-role" data-uid="' + _mmEsc(u.id) + '">' +
              '<option value="">—</option><option value="view"' + (role === 'view' ? ' selected' : '') + '>보기</option>' +
              '<option value="edit"' + (role === 'edit' ? ' selected' : '') + '>편집</option></select>'
              : '<span class="mm-acc-meta">사용 권한 없음</span>') + '</div>';
        }).join('') + '</div>' +
        '<div class="mm-form-acts"><button class="btn btn-p" id="mmShOk">저장</button></div></div>';
      var md = createModal({ id: 'mmShareModal', title: '🔗 공유 설정', html: html, width: '480px', closeOnEsc: true });
      var scope = _mmEl('mmShScope');
      scope.onchange = function () { _mmEl('mmShProjWrap').classList.toggle('hidden', scope.value !== 'project'); };
      _mmEl('mmShOk').onclick = function () {
        var btn = this;
        var ed = [], vw = [];
        document.querySelectorAll('#mmShareModal .mm-sh-role').forEach(function (s) {
          if (s.value === 'edit') ed.push(s.getAttribute('data-uid'));
          else if (s.value === 'view') vw.push(s.getAttribute('data-uid'));
        });
        var body = { scope: scope.value, projectId: _mmEl('mmShProj').value || null, editors: ed, viewers: vw };
        btn.disabled = true;
        // 편집 중인 내용을 먼저 저장해 version 을 맞춘 뒤 공유 설정 저장
        Promise.resolve(_mmSaveNow()).then(function () {
          body.version = _mm.version;
          return apiFetch('/api/mindmaps/' + encodeURIComponent(_mm.mapId), { method: 'PUT', body: JSON.stringify(body) });
        }).then(function (r) {
          _mm.version = r.data.version;
          _mm.row.scope = r.data.scope; _mm.row.project_id = r.data.project_id;
          _mm.row.editors = r.data.editors || []; _mm.row.viewers = r.data.viewers || [];
          _mmToast('공유 설정을 저장했습니다');
          md.close();
          _mmStatus();
        }).catch(function (e) {
          btn.disabled = false;
          _mmToast('❌ ' + (e && e.status === 409 ? '다른 사람이 먼저 저장했습니다 — 새로고침 후 다시 시도하세요' : _mmErr(e)), 'error');
        });
      };
    });
  }, 'mmShareModal');
}

/* ═══ 편집기 열기 · 닫기 ═══ */
function mmOpen(id) {
  var wrap = _mmEl('mindmapWrap');
  if (!wrap) return;
  if (_mm.view === 'editor' && _mm.mapId && _mm.mapId !== id) { _mmSaveNow(); _mmLockRelease(); }
  _mm.mapId = id;
  _mm.view = 'editor';
  wrap.innerHTML = '<div class="mm-empty">맵을 여는 중...</div>';
  Promise.all([apiFetch('/api/mindmaps/' + encodeURIComponent(id)), _mmLoadMembers()]).then(function (res) {
    if (_mm.mapId !== id) return;
    var row = res[0].data;
    var doc = row.doc;
    if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch (_) { doc = null; } }
    if (!doc || !doc.sheets || !doc.sheets.length) doc = { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: mmNewNode(row.title) }] };
    _mm.row = row;
    _mm.doc = doc;
    _mm.version = row.version;
    _mm.canEdit = !!row.can_edit;
    _mm.readOnly = !row.can_edit;
    _mm.sheetIdx = 0; _mm.refs = {}; _mm.relFrom = null; _mm.multi = [];
    _mm.sel = _mmRoot().id;
    _mm.undo = []; _mm.redo = [];
    _mm.dirty = false; _mm.titleDirty = false; _mm.conflict = null; _mm.lockedBy = null;
    _mm.search = ''; _mm.hits = []; _mm.hitIdx = -1;
    _mm.zoom = 1; _mm.panX = null; _mm.panY = null;
    if (window.innerWidth < 768) _mm.outline = true;   // 휴대폰은 아웃라인 보기로 시작
    _mmRenderEditor();
    if (_mm.canEdit) _mmLockAcquire(false);
    _mmResolveRefs();
    if (typeof mmAiCheck === 'function') mmAiCheck();
  }).catch(function (e) {
    _mm.mapId = null;
    _mm.view = 'list';
    _mmToast('❌ 맵을 열 수 없습니다 — ' + (e && e.status === 404 ? '삭제되었거나 권한이 없습니다' : _mmErr(e)), 'error');
    _mmRenderList();
  });
}

function mmBack() {
  _mmSetZen(false);
  var p = _mmSaveNow();
  _mmLockRelease();
  _mm.mapId = null;
  _mm.view = 'list';
  Promise.resolve(p).then(function () { _mmRenderList(); });
}

/* ═══ 편집 잠금 ═══ */
function _mmLockAcquire(force) {
  var id = _mm.mapId;
  var me = (_mmMe() || {}).id;
  clearInterval(_mm.lockTimer);
  var q = '/api/locks?resourceType=mindmap&resourceId=' + encodeURIComponent(id);
  apiFetch(q).then(function (r) {
    if (_mm.mapId !== id) return;
    var lk = r && r.data;
    var active = lk && lk.user_id !== me && new Date(lk.expires_at).getTime() > Date.now();
    if (active && !force) {
      _mm.lockedBy = lk.user_name || '다른 사용자';
      _mm.readOnly = true;
      _mmRefreshMode();
      return;
    }
    return apiFetch('/api/locks', { method: 'PATCH', body: JSON.stringify({ resourceType: 'mindmap', resourceId: id }) }).then(function () {
      if (_mm.mapId !== id) return;
      _mm.lockedBy = null;
      _mm.readOnly = !_mm.canEdit;
      _mmRefreshMode();
      if (force) {
        // 다른 사람이 마지막으로 저장한 내용부터 이어서 편집
        mmOpen(id);
        return;
      }
      // 2분마다 잠금 연장 — 그 사이 다른 사람이 "편집 가져오기"를 했으면 되찾지 않고 보기 전용으로 전환
      _mm.lockTimer = setInterval(function () { _mmLockBeat(id); }, 120000);
    });
  }).catch(function () { /* 잠금 API 실패 시에도 version 충돌 검사로 보호됨 */ });
}
function _mmLockBeat(id) {
  var me = (_mmMe() || {}).id;
  if (_mm.mapId !== id || _mm.readOnly) return Promise.resolve();
  return apiFetch('/api/locks?resourceType=mindmap&resourceId=' + encodeURIComponent(id)).then(function (r) {
    if (_mm.mapId !== id) return;
    var cur = r && r.data;
    if (cur && cur.user_id !== me && new Date(cur.expires_at).getTime() > Date.now()) {
      clearInterval(_mm.lockTimer);
      _mmSaveNow();
      _mm.lockedBy = cur.user_name || '다른 사용자';
      _mm.readOnly = true;
      _mmRefreshMode();
      _mmToast(_mm.lockedBy + ' 님이 편집을 가져갔습니다 — 보기 전용으로 바뀝니다');
      return;
    }
    return apiFetch('/api/locks', { method: 'PATCH', body: JSON.stringify({ resourceType: 'mindmap', resourceId: id }) });
  }).catch(function () {});
}
function _mmLockRelease() {
  clearInterval(_mm.lockTimer);
  _mm.lockTimer = null;
  if (!_mm.mapId || !_mm.canEdit || _mm.lockedBy) return;
  apiFetch('/api/locks?resourceType=mindmap&resourceId=' + encodeURIComponent(_mm.mapId), { method: 'DELETE' }).catch(function () {});
}

/* ═══ 편집기 화면 ═══ */
function _mmRenderEditor() {
  var wrap = _mmEl('mindmapWrap');
  if (!wrap) return;
  var row = _mm.row;
  var sc = MM_SCOPE[row.scope] || MM_SCOPE.personal;
  var st = _mmSheet().structure || 'balanced';
  var tool = function (act, label, title) { return '<button class="mm-tool mm-edit-only" data-act="' + act + '" title="' + title + '">' + label + '</button>'; };
  var h = '<div class="mm-ed' + (_mm.zen ? ' mm-zen' : '') + '" id="mmEd">' +
    '<div class="mm-top">' +
    '<button class="btn btn-g btn-s" data-act="back">← 목록</button>' +
    '<input id="mmTitle" class="mm-title" value="' + _mmEsc(row.title) + '" maxlength="255">' +
    '<span class="mm-badge">' + sc.i + ' ' + sc.l + (row.project_name ? ' · ' + _mmEsc(row.project_name) : '') + '</span>' +
    '<span id="mmStatus" class="mm-status"></span>' +
    '<span class="mm-flex"></span>' +
    '<input id="mmSearch" class="mm-input mm-search" placeholder="🔍 검색 (Ctrl+F)">' +
    '<div class="mm-seg"><button data-act="view-map" id="mmVMap">맵</button><button data-act="view-outline" id="mmVOut">아웃라인</button></div>' +
    '<select id="mmStructure" class="mm-input mm-edit-only" title="구조 (Ctrl+Shift+L)">' + MM_STRUCTURES.map(function (s) { return '<option value="' + s.k + '"' + (s.k === st ? ' selected' : '') + '>' + s.l + '</option>'; }).join('') + '</select>' +
    '<button class="btn btn-g btn-s" data-act="zen" title="집중 모드 (Ctrl+Shift+F)">⛶</button>' +
    (_mm.doc.meta && _mm.doc.meta.gen ? '<button class="btn btn-g btn-s mm-edit-only" data-act="resync" title="원본 데이터에 새로 생긴 항목을 맵에 추가">↻ 원본과 맞추기</button>' : '') +
    '<div class="mm-menu-wrap mm-edit-only' + (_mm.aiReady ? '' : ' hidden') + '" id="mmAiWrap"><button class="btn btn-g btn-s" data-act="menu" data-menu="mmAiMenu">✨ AI</button>' +
    '<div class="mm-menu hidden" id="mmAiMenu">' +
    '<button data-act="ai-expand">💡 하위 주제 제안 <span class="mm-hint">선택 주제</span></button>' +
    '<button data-act="ai-summary">} 가지 요약 <span class="mm-hint">선택 주제</span></button>' +
    '<button data-act="ai-text">📝 글로 가지 만들기</button>' +
    '<button data-act="ai-wbs">🏗 WBS 초안 <span class="mm-hint">프로젝트</span></button></div></div>' +
    '<div class="mm-menu-wrap"><button class="btn btn-g btn-s" data-act="menu" data-menu="mmExportMenu">⤓ 내보내기</button>' +
    '<div class="mm-menu hidden" id="mmExportMenu"><button data-act="export-png">PNG 이미지</button><button data-act="export-md">Markdown (.md)</button>' +
    '<button data-act="export-opml">OPML (.opml)</button></div></div>' +
    ((row.is_owner || _mmIsAdmin()) ? '<button class="btn btn-g btn-s" data-act="share">🔗 공유</button>' : '') +
    '<button class="btn btn-g btn-s" data-act="palette" title="명령 찾기 (Ctrl+/)">⌘</button>' +
    '<button class="btn btn-g btn-s" data-act="help" title="단축키 (F1)">?</button>' +
    '</div>' +
    '<div id="mmBanner"></div>' +
    '<div id="mmAiBar"></div>' +
    '<div class="mm-sheets" id="mmSheets"></div>' +
    '<div class="mm-body">' +
    '<div class="mm-tools">' +
    tool('child', '＋하위', '하위 주제 추가 (Tab)') + tool('sibling', '＋형제', '형제 주제 추가 (Enter)') + tool('parent', '＋부모', '부모 주제 삽입 (Ctrl+Enter)') +
    tool('del', '삭제', '삭제 (Delete) · 여러 개: Ctrl+클릭 / Shift+끌기') + '<span class="mm-tool-sep"></span>' +
    tool('undo', '↶ 취소', '되돌리기 (Ctrl+Z)') + tool('redo', '↷ 다시', '다시 실행 (Ctrl+Y)') + '<span class="mm-tool-sep"></span>' +
    tool('relation', '↔ 관계', '관계선 (Alt+R) — 누른 뒤 이을 주제를 클릭, Esc 취소') + tool('link-ref', '🔗 연결', '앱 데이터 연결 (Alt+L) — 프로젝트·마일스톤·이슈·팀원…') +
    '<button class="mm-tool" data-act="refs-refresh" title="연결된 항목 상태 새로고침">↻ 상태</button><span class="mm-tool-sep"></span>' +
    '<button class="mm-tool" data-act="fold" title="접기/펴기 (Space)">접기</button>' +
    '<button class="mm-tool" data-act="fold-all" title="1단계만 보기">1단계</button>' +
    '<button class="mm-tool" data-act="unfold-all" title="모두 펴기">모두 펴기</button>' +
    '</div>' +
    '<div class="mm-canvas" id="mmCanvas"><div class="mm-stage" id="mmStage"></div>' +
    '<textarea id="mmSink" class="mm-sink" aria-label="마인드맵 키 입력" autocomplete="off" spellcheck="false"></textarea>' +
    '<div class="mm-zoom"><button data-act="zoom-out">−</button><span id="mmZoomV">100%</span><button data-act="zoom-in">＋</button><button data-act="fit" title="화면 맞춤">⤢</button></div>' +
    '<button class="mm-zen-exit" data-act="zen">집중 모드 끝내기 (Esc)</button></div>' +
    '<div class="mm-outline hidden" id="mmOutline"></div>' +
    '<div class="mm-panel" id="mmPanel"></div>' +
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
  _mmSetOutline(_mm.outline);
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
  if (_mm.conflict) {
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
  if (_mm.readOnly) s.textContent = '보기 전용';
  else if (_mm.conflict) s.textContent = '⚠️ 저장 충돌';
  else if (_mm.saving) s.textContent = '저장 중…';
  else if (_mm.dirty) s.textContent = '● 변경됨';
  else s.textContent = _mm.lastSaved ? '✓ 저장됨' : '';
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
function _mmNodeHtml(n, depth, color, num) {
  var hit = _mm.hits.indexOf(n.id) >= 0;
  var cls = 'mm-node ' + (depth === 0 ? 'mm-root' : depth === 1 ? 'mm-main' : 'mm-topic2') +
    ((n.done || _mmRefDone(n)) ? ' mm-done' : '') + (hit ? ' mm-hit' : '') + (n.id === _mm.sel ? ' mm-sel' : '') + (n.color ? ' mm-colored' : '') +
    (n.ref ? ' mm-has-ref' : '') + (n._ai ? ' mm-ai' : '') + (n.id === _mm.relFrom ? ' mm-rel-from' : '') + (_mm.multi.indexOf(n.id) >= 0 ? ' mm-multi' : '');
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
  return '<div class="' + cls + '" data-id="' + _mmEsc(n.id) + '" style="--mm-c:' + color + '">' +
    '<div class="mm-line">' + (num ? '<span class="mm-num">' + num + '</span>' : '') + mk + '<span class="mm-txt">' + (n.text ? _mmEsc(n.text) : '<i class="mm-ph">(빈 주제)</i>') + '</span>' + icons + '</div>' +
    _mmRefLine(n) + labels + (meta.length ? '<div class="mm-meta">' + meta.join(' · ') + '</div>' : '') + fold + '</div>';
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
    var c;
    if (depth === 0) c = _mmColorVar(n.color) || 'var(--ac)';
    else if (depth === 1) c = _mmColorVar(n.color) || _mmColorVar(MM_AUTO_COLORS[root.children.indexOf(n) % MM_AUTO_COLORS.length]);
    else c = _mmColorVar(n.color) || colors[parent.id];
    colors[n.id] = c;
    html.push(_mmNodeHtml(n, depth, c, nums[n.id]));
    if (n.summary && !n.collapsed && (n.children || []).length) {
      html.push('<div class="mm-sumlabel" data-sum="' + _mmEsc(n.id) + '" style="--mm-c:' + c + '">' + _mmEsc(n.summary.text || '요약') + '</div>');
    }
    if (n.collapsed) return false;
  });
  stage.innerHTML = '<svg class="mm-edges" id="mmEdges" xmlns="http://www.w3.org/2000/svg"></svg>' + html.join('');
  var sizes = {};
  var els = stage.querySelectorAll('.mm-node');
  els.forEach(function (el) { sizes[el.getAttribute('data-id')] = { w: el.offsetWidth, h: el.offsetHeight }; });
  var sumEls = stage.querySelectorAll('.mm-sumlabel');
  sumEls.forEach(function (el) { sizes['sum:' + el.getAttribute('data-sum')] = { w: el.offsetWidth, h: el.offsetHeight }; });
  var lay = mmLayout(root, st, sizes);
  var deco = mmDecorations(root, st, lay, sizes);
  _mm.layout = lay;
  els.forEach(function (el) {
    var p = lay.pos[el.getAttribute('data-id')];
    if (!p) { el.style.display = 'none'; return; }
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.setAttribute('data-side', p.side);
  });
  var b = lay.bounds;
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
    paths.push('<path d="' + mmEdgePath(pp, p, st) + '" class="mm-edge" style="stroke:' + colors[id] + ';stroke-width:' + (p.depth === 1 ? 2.6 : p.depth === 2 ? 1.8 : 1.3) + '"/>');
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
}

function _mmApplyTransform() {
  var stage = _mmEl('mmStage');
  if (!stage) return;
  stage.style.transform = 'translate(' + (_mm.panX || 0) + 'px,' + (_mm.panY || 0) + 'px) scale(' + _mm.zoom + ')';
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
  if (sink && !_mm.outline && !_mm.editing) { try { sink.focus({ preventScroll: true }); } catch (_) { sink.focus(); } }
}

/* ═══ 변경 · 되돌리기 · 저장 ═══ */
function _mmSnapshot() { return JSON.stringify({ sheets: _mm.doc.sheets, sel: _mm.sel, sheetIdx: _mm.sheetIdx }); }
function _mmMutate(fn, opts) {
  if (_mm.readOnly) return false;
  _mm.undo.push(_mmSnapshot());
  if (_mm.undo.length > 50) _mm.undo.shift();
  _mm.redo = [];
  fn();
  _mmMarkDirty();
  if (!opts || opts.paint !== false) _mmPaint();
  return true;
}
function _mmRestore(snap) {
  var s = JSON.parse(snap);
  _mm.doc.sheets = s.sheets;
  _mm.sheetIdx = s.sheetIdx || 0;
  _mm.sel = mmFind(_mmRoot(), s.sel) ? s.sel : _mmRoot().id;
  _mmMarkDirty();
  _mmPaintSheets();
  if (typeof _mmAiBar === 'function') _mmAiBar();
  _mmPaint();
  var stSel = _mmEl('mmStructure');
  if (stSel) stSel.value = _mmSheet().structure || 'balanced';
}
function mmUndo() {
  if (_mm.readOnly || !_mm.undo.length) return;
  _mm.redo.push(_mmSnapshot());
  _mmRestore(_mm.undo.pop());
}
function mmRedo() {
  if (_mm.readOnly || !_mm.redo.length) return;
  _mm.undo.push(_mmSnapshot());
  _mmRestore(_mm.redo.pop());
}

function _mmMarkDirty() {
  _mm.dirty = true;
  _mmStatus();
  clearTimeout(_mm.saveTimer);
  _mm.saveTimer = setTimeout(_mmSaveNow, 1500);
}

function _mmSaveNow(force) {
  clearTimeout(_mm.saveTimer);
  if (!_mm.mapId || !_mm.dirty || (_mm.readOnly && !force) || (_mm.conflict && !force)) return _mm.savePromise || Promise.resolve();
  if (_mm.saving) { _mm.saveAgain = true; return _mm.savePromise; }
  _mm.saving = true;
  _mm.dirty = false;
  _mmStatus();
  var mapId = _mm.mapId;
  var body = { version: _mm.version, doc: _mmDocForSave() };
  if (_mm.titleDirty) body.title = _mm.row.title;
  _mm.savePromise = apiFetch('/api/mindmaps/' + encodeURIComponent(mapId), { method: 'PUT', body: JSON.stringify(body), timeoutMs: 30000 })
    .then(function (r) {
      if (_mm.mapId !== mapId) return;
      _mm.version = r.data.version;
      _mm.titleDirty = false;
      _mm.lastSaved = new Date();
    })
    .catch(function (e) {
      if (_mm.mapId !== mapId) return;
      _mm.dirty = true;
      if (e && e.status === 409) { _mm.conflict = (e.data && e.data.latest) || {}; _mmBanner(); }
      else _mmToast('❌ 저장 실패 — ' + _mmErr(e) + ' (잠시 후 다시 시도)', 'error');
    })
    .then(function () {
      _mm.saving = false;
      _mmStatus();
      if (_mm.saveAgain) { _mm.saveAgain = false; return _mmSaveNow(); }
    });
  return _mm.savePromise;
}

/** 저장용 문서 — AI 미리보기(_ai) 노드 제외, 양 끝이 없는 관계선 제거 */
function _mmDocForSave() {
  var d = JSON.parse(JSON.stringify(_mm.doc));
  d.sheets.forEach(function (sh) {
    (function strip(n) {
      n.children = (n.children || []).filter(function (c) { return !c._ai; });
      n.children.forEach(strip);
    })(sh.root);
    var ids = {};
    mmWalk(sh.root, function (n) { ids[n.id] = true; });
    if (sh.relations) sh.relations = sh.relations.filter(function (r) { return ids[r.from] && ids[r.to]; });
  });
  return d;
}

function _mmConflictOverwrite() {
  var id = _mm.mapId;
  apiFetch('/api/mindmaps/' + encodeURIComponent(id)).then(function (r) {
    if (_mm.mapId !== id) return;
    _mm.version = r.data.version;
    _mm.conflict = null;
    _mm.dirty = true;
    _mmBanner();
    return _mmSaveNow();
  }).catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
}

/* ═══ 노드 편집 동작 ═══ */
function _mmSelInfo() { return _mm.doc ? mmFind(_mmRoot(), _mm.sel) : null; }

function mmAddChild() {
  var f = _mmSelInfo();
  if (!f) return;
  var n = mmNewNode(f.depth === 0 ? '주요 주제' : '하위 주제');
  if (!_mmMutate(function () {
    f.node.collapsed = false;
    (f.node.children || (f.node.children = [])).push(n);
    _mm.sel = n.id;
  })) return;
  _mmEdit(n.id, null);
}
function mmAddSibling() {
  var f = _mmSelInfo();
  if (!f) return;
  if (!f.parent) { mmAddChild(); return; }
  var n = mmNewNode(f.depth === 1 ? '주요 주제' : '하위 주제');
  // 1단계 주제는 지금 보이는 쪽(왼쪽/오른쪽)에 이어서 생기도록
  var curSide = _mm.layout && _mm.layout.pos[f.node.id] && _mm.layout.pos[f.node.id].side;
  if (f.depth === 1 && (curSide === 'left' || curSide === 'right')) n.side = curSide;
  if (!_mmMutate(function () { f.parent.children.splice(f.index + 1, 0, n); _mm.sel = n.id; })) return;
  _mmEdit(n.id, null);
}
function mmAddParent() {
  var f = _mmSelInfo();
  if (!f || !f.parent) return;
  var n = mmNewNode('주제');
  if (!_mmMutate(function () {
    if (f.node.side) { n.side = f.node.side; delete f.node.side; }
    f.parent.children.splice(f.index, 1, n);
    n.children.push(f.node);
    _mm.sel = n.id;
  })) return;
  _mmEdit(n.id, null);
}
function mmDeleteSel() {
  var root = _mmRoot();
  var ids = _mmSelIds().filter(function (id) { return id !== root.id; });
  if (!ids.length) return;
  // 다른 선택 주제의 하위는 같이 지워지므로 빼고, 지운 뒤엔 첫 주제의 이웃(없으면 부모)을 선택
  ids = ids.filter(function (id) { return !ids.some(function (o) { return o !== id && mmIsAncestor(root, o, id); }); });
  var f = mmFind(root, ids[0]);
  var sibs = f.parent.children;
  var next = sibs.filter(function (c) { return ids.indexOf(c.id) < 0; })[0] || f.parent;
  _mmMutate(function () {
    ids.forEach(function (id) { mmRemoveNode(root, id); });
    _mm.multi = [];
    _mm.sel = next.id;
  });
}
function mmToggleFold(id) {
  var f = mmFind(_mmRoot(), id || _mm.sel);
  if (!f || !(f.node.children || []).length) return;
  // 접기는 보기 상태라 보기 전용에서도 허용 (저장은 하지 않음)
  if (_mm.readOnly) { f.node.collapsed = !f.node.collapsed; _mmPaint(); return; }
  _mmMutate(function () { f.node.collapsed = !f.node.collapsed; });
}
function _mmFoldAll(level) {
  var apply = function () {
    mmWalk(_mmRoot(), function (n, parent, depth) {
      if ((n.children || []).length) n.collapsed = level != null && depth >= level;
    });
  };
  if (_mm.readOnly) { apply(); _mmPaint(); } else _mmMutate(apply);
  // 숨겨진 노드가 선택돼 있으면 가장 가까운 보이는 조상으로
  if (_mm.layout && !_mm.layout.pos[_mm.sel]) {
    var cur = _mmSelInfo();
    while (cur && cur.parent && !_mm.layout.pos[cur.node.id]) cur = mmFind(_mmRoot(), cur.parent.id);
    _mmSelect(cur ? cur.node.id : _mmRoot().id);
  }
  _mmFit();
}
function _mmSetMarker(kind, value) {
  var f = _mmSelInfo();
  if (!f) return;
  _mmMutate(function () {
    var ms = (f.node.markers || []).slice();
    if (kind === 'priority') {
      ms = ms.filter(function (m) { return !/^priority-/.test(m); });
      if (value) ms.unshift('priority-' + value);
    } else {
      var i = ms.indexOf(value);
      if (i >= 0) ms.splice(i, 1); else ms.push(value);
    }
    if (ms.length) f.node.markers = ms; else delete f.node.markers;
  });
}
function _mmSetProp(key, value) {
  var f = _mmSelInfo();
  if (!f) return;
  _mmMutate(function () {
    if (value === '' || value == null || value === false || (Array.isArray(value) && !value.length)) delete f.node[key];
    else f.node[key] = value;
  });
}

/* ── 인라인 편집 ── */
function _mmEdit(id, initial, useSink) {
  if (_mm.readOnly || _mm.editing) return;
  var stage = _mmEl('mmStage'), cv = _mmEl('mmCanvas');
  var f = mmFind(_mmRoot(), id);
  if (!stage || !cv || !f) return;
  _mmSelect(id);
  var p = _mm.layout && _mm.layout.pos[id];
  if (!p) return;
  var el = stage.querySelector('.mm-node[data-id="' + id + '"]');
  // 입력칸은 캔버스 좌표에 겹쳐 띄운다 (확대 배율만큼 scale). 한글 입력은 키 받는 칸(mmSink) 자체가
  // 그대로 입력칸이 된다 — 조합 중에 다른 칸으로 포커스를 옮기면 첫 글자가 깨지기 때문
  var ta = useSink ? _mmEl('mmSink') : document.createElement('textarea');
  if (!ta) return;
  ta.classList.add('mm-inline');
  if (!useSink) ta.value = initial != null ? initial : (f.node.text || '');
  ta.style.left = (_mm.panX + p.x * _mm.zoom) + 'px';
  ta.style.top = (_mm.panY + p.y * _mm.zoom) + 'px';
  ta.style.width = Math.max(p.w, 140) + 'px';
  ta.style.minHeight = p.h + 'px';
  ta.style.transform = 'scale(' + _mm.zoom + ')';
  if (el) el.style.visibility = 'hidden';
  if (!useSink) cv.appendChild(ta);
  _mm.editing = true;
  var done = false;
  function grow() { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  function onKey(e) {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;   // 한글 조합 중 Enter 는 조합 확정
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Tab') { e.preventDefault(); finish(true, mmAddChild); }
  }
  function onBlur() { finish(true); }
  function onDown(e) { e.stopPropagation(); }
  function finish(commit, then) {
    if (done) return;
    done = true;
    var v = ta.value.replace(/\s+$/, '');
    ta.removeEventListener('input', grow);
    ta.removeEventListener('keydown', onKey);
    ta.removeEventListener('blur', onBlur);
    ta.removeEventListener('mousedown', onDown);
    if (useSink) { ta.classList.remove('mm-inline'); ta.removeAttribute('style'); ta.value = ''; }
    else ta.remove();
    _mm.editing = false;
    if (el) el.style.visibility = '';
    if (commit && v !== (f.node.text || '')) _mmMutate(function () { f.node.text = v; });
    else _mmPaint();
    _mmFocusCanvas();
    if (then) then();
  }
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', onKey);
  ta.addEventListener('blur', onBlur);
  ta.addEventListener('mousedown', onDown);
  if (!useSink) {
    ta.focus();
    if (initial == null) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  grow();
}

/* ── 방향키 이동 (화면 위치 기준 — 모든 구조에서 같은 감각) ── */
function _mmNav(dir) {
  var lay = _mm.layout;
  var cur = lay && lay.pos[_mm.sel];
  if (!cur) { _mmSelect(_mmRoot().id); return; }
  var cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
  var best = null, bestScore = Infinity;
  Object.keys(lay.pos).forEach(function (id) {
    if (id === _mm.sel) return;
    var p = lay.pos[id];
    var dx = p.x + p.w / 2 - cx, dy = p.y + p.h / 2 - cy;
    var main, cross;
    if (dir === 'left') { main = -dx; cross = dy; }
    else if (dir === 'right') { main = dx; cross = dy; }
    else if (dir === 'up') { main = -dy; cross = dx; }
    else { main = dy; cross = dx; }
    if (main <= 4) return;
    var score = main + Math.abs(cross) * 2.5;
    if (score < bestScore) { bestScore = score; best = id; }
  });
  if (best) _mmSelect(best);
}

/* ── 가지 복사 · 붙여넣기 ── */
function _mmCopy(e, cut) {
  var root = _mmRoot();
  var ids = _mmSelIds();
  ids = ids.filter(function (id) { return !ids.some(function (o) { return o !== id && mmIsAncestor(root, o, id); }); });
  var nodes = ids.map(function (id) { var f = mmFind(root, id); return f && f.node; }).filter(Boolean);
  if (!nodes.length) return;
  // 가지를 Markdown 목록으로 — 다른 앱(메모·XMind)에 붙여넣어도 같은 모양
  var out = [];
  nodes.forEach(function (node) {
    mmWalk(node, function (n, parent, depth) {
      out.push(new Array(depth + 1).join('  ') + '- ' + (n.done ? '[x] ' : '') + String(n.text || '').replace(/\n/g, ' '));
    });
  });
  var md = out.join('\n') + '\n';
  _mm.clip = JSON.stringify(nodes);
  _mm.clipText = md;
  if (e && e.clipboardData) { e.clipboardData.setData('text/plain', md); e.preventDefault(); }
  if (cut && !_mm.readOnly) mmDeleteSel();
  _mmToast((cut ? '잘라냈습니다' : '복사했습니다') + (nodes.length > 1 ? ' (' + nodes.length + '개 가지)' : ''));
}
function _mmPaste(e) {
  if (_mm.readOnly) return;
  var f = _mmSelInfo();
  if (!f) return;
  var text = e && e.clipboardData ? e.clipboardData.getData('text/plain') : '';
  if (e) e.preventDefault();
  var nodes = [];
  if (_mm.clip && (!text || text === _mm.clipText)) {
    var clip = JSON.parse(_mm.clip);
    nodes = (Array.isArray(clip) ? clip : [clip]).map(mmCloneBranch);
  } else if (text && text.trim()) {
    var lines = text.trim().split(/\r?\n/);
    if (lines.length === 1) nodes = [mmNewNode(lines[0].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())];
    else {
      var parsed = mmFromMarkdown(text);
      if (parsed) nodes = parsed.text === '중심 주제' && !/^#/.test(text.trim()) ? parsed.children : [parsed];
    }
  }
  if (!nodes.length) return;
  _mmMutate(function () {
    f.node.collapsed = false;
    nodes.forEach(function (n) { delete n.side; (f.node.children || (f.node.children = [])).push(n); });
    _mm.sel = nodes[0].id;
  });
  _mmEnsureVisible(_mm.sel);
}

/* ── 검색 ── */
function _mmSearch(q, jump, step) {
  q = (q || '').trim().toLowerCase();
  _mm.search = q;
  var hits = [];
  if (q) mmWalk(_mmRoot(), function (n) {
    var hay = ((n.text || '') + ' ' + (n.note || '') + ' ' + (n.labels || []).join(' ')).toLowerCase();
    if (hay.indexOf(q) >= 0) hits.push(n.id);
  });
  var changed = hits.join() !== _mm.hits.join();
  _mm.hits = hits;
  if (!jump) { _mm.hitIdx = -1; if (changed || !q) _mmPaint(); return; }
  if (!hits.length) { _mmToast('찾는 내용이 없습니다'); return; }
  _mm.hitIdx = (_mm.hitIdx + (step || 1) + hits.length) % hits.length;
  var id = hits[_mm.hitIdx];
  // 접힌 조상 펼치기 (보기 상태 — 저장 대상은 아님)
  var f = mmFind(_mmRoot(), id), opened = false;
  while (f && f.parent) {
    if (f.parent.collapsed) { f.parent.collapsed = false; opened = true; }
    f = mmFind(_mmRoot(), f.parent.id);
  }
  _mm.sel = id;
  _mmPaint();
  if (opened && !_mm.readOnly) _mmMarkDirty();
  _mmSelect(id);
  var s = _mmEl('mmStatus');
  if (s) s.textContent = '검색 ' + (_mm.hitIdx + 1) + '/' + hits.length;
}

/* ═══ 이벤트 ═══ */
function _mmEdClick(e) {
  var t = e.target.closest('[data-act]');
  var act = t && this.contains(t) ? t.getAttribute('data-act') : null;
  // 열린 메뉴는 다른 곳을 누르면 닫음
  document.querySelectorAll('#mindmapWrap .mm-menu').forEach(function (m) {
    if (!(act === 'menu' && t.getAttribute('data-menu') === m.id)) m.classList.add('hidden');
  });
  if (!act) return;
  switch (act) {
    case 'menu': var mEl = _mmEl(t.getAttribute('data-menu')); if (mEl) mEl.classList.toggle('hidden'); return;
    case 'sheet':
      var si = parseInt(t.getAttribute('data-i'), 10);
      if (si === _mm.sheetIdx && e.detail >= 2) mmRenameSheet(); else mmSwitchSheet(si);
      return;
    case 'sheet-add': e.stopPropagation(); mmAddSheet(); return;
    case 'sheet-del': e.stopPropagation(); mmDeleteSheet(parseInt(t.getAttribute('data-i'), 10)); return;
    case 'relation': mmStartRelation(); return;
    case 'rel-del': _mmMutate(function () { var id = t.getAttribute('data-rel'); _mmSheet().relations = (_mmSheet().relations || []).filter(function (r) { return r.id !== id; }); }); return;
    case 'refs-refresh': _mm.refs = {}; _mmPaint(); _mmResolveRefs().then(function () { _mmToast('연결 항목 상태를 새로 불러왔습니다'); }); return;
    case 'link-ref': if (typeof mmLinkModal === 'function') mmLinkModal(); return;
    case 'ref-open': var rf = _mmSelInfo(); if (rf && rf.node.ref && typeof mmOpenRef === 'function') mmOpenRef(rf.node.ref); return;
    case 'ref-unlink': _mmSetProp('ref', null); return;
    case 'promote': if (typeof mmPromoteModal === 'function') mmPromoteModal(t.getAttribute('data-kind')); return;
    case 'resync': if (typeof mmResync === 'function') mmResync(); return;
    case 'export-opml': if (typeof mmExportOpml === 'function') mmExportOpml(); return;
    case 'ai-expand': if (typeof mmAiExpand === 'function') mmAiExpand(); return;
    case 'ai-summary': if (typeof mmAiSummary === 'function') mmAiSummary(); return;
    case 'ai-text': if (typeof mmAiTextModal === 'function') mmAiTextModal(); return;
    case 'ai-wbs': if (typeof mmAiWbsModal === 'function') mmAiWbsModal(); return;
    case 'ai-accept': if (typeof mmAiAccept === 'function') mmAiAccept(); return;
    case 'ai-discard': if (typeof mmAiDiscard === 'function') mmAiDiscard(); return;
    case 'back': mmBack(); return;
    case 'child': mmAddChild(); return;
    case 'sibling': mmAddSibling(); return;
    case 'parent': mmAddParent(); return;
    case 'del': mmDeleteSel(); break;
    case 'undo': mmUndo(); break;
    case 'redo': mmRedo(); break;
    case 'fold': mmToggleFold(); break;
    case 'fold-all': _mmFoldAll(1); break;
    case 'unfold-all': _mmFoldAll(null); break;
    case 'zoom-in': _mmZoomAt(1.2); break;
    case 'zoom-out': _mmZoomAt(1 / 1.2); break;
    case 'fit': _mmFit(); break;
    case 'zen': _mmSetZen(!_mm.zen); break;
    case 'view-map': _mmSetOutline(false); return;
    case 'view-outline': _mmSetOutline(true); return;
    case 'export-png': mmExportPng(); return;
    case 'export-md': mmExportMarkdown(); return;
    case 'share': mmShareModal(); return;
    case 'help': if (typeof mmHelpModal === 'function') mmHelpModal(); return;
    case 'palette': if (typeof mmPalette === 'function') mmPalette(); return;
    case 'cmd': if (typeof mmRunCommand === 'function') mmRunCommand(t.getAttribute('data-cmd')); break;
    case 'take-lock':
      if (!confirm((_mm.lockedBy || '다른 사용자') + ' 님이 아직 편집 중일 수 있습니다.\n가져오면 그분이 마지막으로 저장한 내용부터 이어서 편집하고, 그분 화면은 보기 전용으로 바뀝니다.\n가져올까요?')) return;
      _mmLockAcquire(true); return;
    case 'conflict-reload': _mm.conflict = null; _mm.dirty = false; mmOpen(_mm.mapId); return;
    case 'conflict-overwrite': _mmConflictOverwrite(); return;
    case 'color': _mmSetProp('color', t.getAttribute('data-v')); return;
    case 'priority': _mmSetMarker('priority', t.getAttribute('data-v')); return;
    case 'symbol': _mmSetMarker('symbol', t.getAttribute('data-v')); return;
    default: return;
  }
  _mmFocusCanvas();
}

function _mmBindCanvas() {
  var cv = _mmEl('mmCanvas');
  if (!cv) return;
  var drag = null;   // { mode: 'pan'|'node', sx, sy, px, py, id, moved, ghost, target }

  cv.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || _mm.editing) return;
    var fold = e.target.closest('.mm-fold');
    if (fold) { e.preventDefault(); mmToggleFold(fold.getAttribute('data-fold')); return; }
    if (e.target.closest('.mm-zoom, .mm-zen-exit, a')) return;
    var node = e.target.closest('.mm-node');
    _mmFocusCanvas();
    var relLb = e.target.closest('.mm-rel-label');
    if (relLb) {
      // 관계선 라벨 → 출발 주제를 선택하고 패널의 관계 칸으로
      var rel = (_mmSheet().relations || []).filter(function (r) { return r.id === relLb.getAttribute('data-rel'); })[0];
      if (rel) { _mmSelect(rel.from); var ri = document.querySelector('#mmPanel [data-rel-label="' + rel.id + '"]'); if (ri) ri.focus(); }
      e.preventDefault();
      return;
    }
    if (node && _mm.relFrom) {
      mmFinishRelation(node.getAttribute('data-id'));
      e.preventDefault();
      return;
    }
    if (node && e.target.closest('[data-open-ref]')) {
      var rn = mmFind(_mmRoot(), node.getAttribute('data-id'));
      _mmSelect(rn.node.id, { scroll: false });
      if (rn && rn.node.ref && typeof mmOpenRef === 'function') mmOpenRef(rn.node.ref);
      e.preventDefault();
      return;
    }
    if (node && (e.ctrlKey || e.metaKey)) {
      _mmToggleMulti(node.getAttribute('data-id'));
      e.preventDefault();
      return;
    }
    if (node) {
      var id = node.getAttribute('data-id');
      if (_mm.multi.indexOf(id) < 0) _mmClearMulti();
      _mmSelect(id, { scroll: false });
      drag = { mode: 'node', sx: e.clientX, sy: e.clientY, id: id, moved: false };
    } else if (e.shiftKey) {
      // Shift+끌기: 상자 안 주제 여러 개 선택
      var cr = cv.getBoundingClientRect();
      var box = document.createElement('div');
      box.className = 'mm-selbox';
      cv.appendChild(box);
      drag = { mode: 'box', sx: e.clientX, sy: e.clientY, ox: cr.left, oy: cr.top, box: box };
    } else {
      _mmClearMulti();
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: _mm.panX, py: _mm.panY };
      cv.classList.add('mm-panning');
    }
    e.preventDefault();
  });
  function onMove(e) {
    if (!drag) return;
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (drag.mode === 'pan') {
      _mm.panX = drag.px + dx; _mm.panY = drag.py + dy;
      _mmApplyTransform();
      return;
    }
    if (drag.mode === 'box') {
      var x1 = Math.min(drag.sx, e.clientX) - drag.ox, y1 = Math.min(drag.sy, e.clientY) - drag.oy;
      drag.box.style.cssText = 'left:' + x1 + 'px;top:' + y1 + 'px;width:' + Math.abs(dx) + 'px;height:' + Math.abs(dy) + 'px';
      return;
    }
    if (_mm.readOnly || drag.id === _mmRoot().id) return;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      var src = _mmEl('mmStage').querySelector('.mm-node[data-id="' + drag.id + '"]');
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'mm-ghost';
      drag.ghost.textContent = src ? (src.querySelector('.mm-txt') || src).textContent : '';
      document.body.appendChild(drag.ghost);
      if (src) src.classList.add('mm-dragging');
    }
    drag.ghost.style.left = (e.clientX + 12) + 'px';
    drag.ghost.style.top = (e.clientY + 8) + 'px';
    var under = document.elementFromPoint(e.clientX, e.clientY);
    var tn = under && under.closest && under.closest('.mm-node');
    document.querySelectorAll('.mm-drop-child,.mm-drop-before,.mm-drop-after').forEach(function (x) { x.classList.remove('mm-drop-child', 'mm-drop-before', 'mm-drop-after'); });
    drag.target = null;
    if (tn) {
      var tid = tn.getAttribute('data-id');
      if (tid !== drag.id && !mmIsAncestor(_mmRoot(), drag.id, tid)) {
        var r = tn.getBoundingClientRect();
        var down = (_mmSheet().structure === 'down');
        var rel = down ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
        var zone = tid === _mmRoot().id ? 'child' : rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : 'child';
        tn.classList.add('mm-drop-' + zone);
        drag.target = { id: tid, zone: zone };
      }
    }
  }
  function onUp(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    cv.classList.remove('mm-panning');
    if (d.mode === 'box') {
      d.box.remove();
      // 화면 좌표 → 스테이지 좌표로 바꿔 겹치는 주제 선택
      var bx1 = (Math.min(d.sx, e.clientX) - d.ox - _mm.panX) / _mm.zoom, by1 = (Math.min(d.sy, e.clientY) - d.oy - _mm.panY) / _mm.zoom;
      var bx2 = (Math.max(d.sx, e.clientX) - d.ox - _mm.panX) / _mm.zoom, by2 = (Math.max(d.sy, e.clientY) - d.oy - _mm.panY) / _mm.zoom;
      var hit = Object.keys(_mm.layout ? _mm.layout.pos : {}).filter(function (id) {
        var p = _mm.layout.pos[id];
        return p.x < bx2 && p.x + p.w > bx1 && p.y < by2 && p.y + p.h > by1;
      });
      if (hit.length === 1) { _mm.multi = []; _mmSelect(hit[0]); }
      else if (hit.length) { _mm.multi = hit; _mm.sel = hit[0]; _mmPaintMulti(); _mmPaintPanel(); }
      return;
    }
    if (d.ghost) d.ghost.remove();
    document.querySelectorAll('.mm-dragging,.mm-drop-child,.mm-drop-before,.mm-drop-after').forEach(function (x) { x.classList.remove('mm-dragging', 'mm-drop-child', 'mm-drop-before', 'mm-drop-after'); });
    if (d.mode !== 'node' || !d.moved) return;
    var root = _mmRoot();
    if (d.target) {
      var t = d.target;
      _mmMutate(function () {
        if (t.zone === 'child') { mmMoveNode(root, d.id, t.id); var tf = mmFind(root, t.id); if (tf) tf.node.collapsed = false; }
        else {
          var tf2 = mmFind(root, t.id);
          var targetSide = _mm.layout && _mm.layout.pos[t.id] && _mm.layout.pos[t.id].side;
          mmMoveNode(root, d.id, tf2.parent.id, tf2.index + (t.zone === 'after' ? 1 : 0));
          if (tf2.parent === root && (targetSide === 'left' || targetSide === 'right')) mmFind(root, d.id).node.side = targetSide;
        }
      });
      return;
    }
    // 빈 곳에 놓음: 마인드맵 구조의 1단계 주제는 루트 기준 왼쪽/오른쪽으로 옮김
    var f = mmFind(root, d.id);
    if (f && f.parent === root && (_mmSheet().structure || 'balanced') === 'balanced') {
      var cvr = cv.getBoundingClientRect();
      var wx = (e.clientX - cvr.left - _mm.panX) / _mm.zoom;
      var side = wx < 0 ? 'left' : 'right';
      if (f.node.side !== side) _mmMutate(function () { f.node.side = side; });
    }
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  // 편집기를 다시 그리면 이전 캔버스의 리스너는 정리
  cv._mmCleanup = function () { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  if (_mmBindCanvas._prev && _mmBindCanvas._prev !== cv && _mmBindCanvas._prev._mmCleanup) _mmBindCanvas._prev._mmCleanup();
  _mmBindCanvas._prev = cv;

  cv.addEventListener('dblclick', function (e) {
    var node = e.target.closest('.mm-node');
    if (node && !e.target.closest('.mm-fold')) _mmEdit(node.getAttribute('data-id'), null);
    else if (!node && !_mm.readOnly && _mmSheet().root) { _mmSelect(_mmRoot().id); }
  });
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      var r = cv.getBoundingClientRect();
      _mmZoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    } else {
      _mm.panX -= e.shiftKey ? e.deltaY : e.deltaX;
      _mm.panY -= e.shiftKey ? 0 : e.deltaY;
      _mmApplyTransform();
    }
  }, { passive: false });
  cv.addEventListener('keydown', _mmKey);
  cv.addEventListener('contextmenu', function (e) {
    if (_mm.editing || typeof mmContextMenu !== 'function') return;
    e.preventDefault();
    var node = e.target.closest('.mm-node');
    if (node) {
      var id = node.getAttribute('data-id');
      if (_mm.multi.indexOf(id) < 0) { _mmClearMulti(); _mmSelect(id, { scroll: false }); }
    }
    _mmFocusCanvas();
    mmContextMenu(e.clientX, e.clientY, node ? 'node' : 'canvas');
  });
  var sink = _mmEl('mmSink');
  if (sink) {
    sink.addEventListener('compositionstart', function () {
      if (!_mm.editing && !_mm.readOnly) _mmEdit(_mm.sel, null, true);
    });
    sink.addEventListener('input', function () { if (!_mm.editing) sink.value = ''; });
  }
  cv.addEventListener('copy', function (e) { if (!_mm.editing) _mmCopy(e, false); });
  cv.addEventListener('cut', function (e) { if (!_mm.editing && !_mm.readOnly) _mmCopy(e, true); });
  cv.addEventListener('paste', function (e) { if (!_mm.editing) _mmPaste(e); });
}

function _mmKey(e) {
  if (_mm.editing) return;
  // 한글 등 IME 입력(keyCode 229)은 compositionstart 에서 mmSink 를 입력칸으로 바꿔 처리
  if (e.isComposing || e.keyCode === 229) return;
  // 단축키 — 표는 mindmap-keys.js (MM_COMMANDS). 복사·잘라내기·붙여넣기는 copy/cut/paste 이벤트로
  if (typeof mmHandleKey === 'function' && mmHandleKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
  var k = e.key;
  if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !_mm.readOnly) {
    // XMind 처럼: 주제를 고른 채 바로 타이핑하면 내용을 바꿔 씀
    e.preventDefault();
    _mmClearMulti();
    _mmEdit(_mm.sel, k);
  }
}

/* 페이지 단위 리스너 (1회) — 나가기 전 저장 경고 · 집중 모드 Esc */
function _mmBindGlobal() {
  if (_mmBindGlobal._done) return;
  _mmBindGlobal._done = true;
  window.addEventListener('beforeunload', function (e) {
    if (_mm.view === 'editor' && (_mm.dirty || _mm.saving)) {
      _mmSaveNow();
      e.preventDefault();
      e.returnValue = '';
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _mm.zen && !_mm.editing && !document.querySelector('.wa-modal-overlay')) _mmSetZen(false);
  });
}

function _mmSetZen(on) {
  _mm.zen = !!on;
  var ed = _mmEl('mmEd');
  if (!ed) return;
  ed.classList.toggle('mm-zen', _mm.zen);
  document.body.classList.toggle('mm-zen-body', _mm.zen);
  setTimeout(function () { _mmFit(); _mmFocusCanvas(); }, 30);
}

/* ═══ 관계선 ═══ */
function mmStartRelation() {
  if (_mm.readOnly || !_mm.sel) return;
  _mm.relFrom = _mm.sel;
  _mmPaint();
  var s = _mmEl('mmStatus');
  if (s) s.textContent = '↔ 이을 주제를 클릭하세요 (Esc 취소)';
  _mmFocusCanvas();
}
function mmCancelRelation() {
  _mm.relFrom = null;
  _mmPaint();
  _mmStatus();
}
function mmFinishRelation(toId) {
  var from = _mm.relFrom;
  _mm.relFrom = null;
  if (!from || from === toId) { _mmPaint(); _mmStatus(); return; }
  var dup = (_mmSheet().relations || []).some(function (r) { return (r.from === from && r.to === toId) || (r.from === toId && r.to === from); });
  if (dup) { _mmToast('이미 이어진 주제입니다'); _mmPaint(); _mmStatus(); return; }
  _mmMutate(function () {
    var sh = _mmSheet();
    (sh.relations || (sh.relations = [])).push({ id: 'r-' + mmUid().slice(2), from: from, to: toId, label: '' });
    _mm.sel = from;
  });
  _mmStatus();
  var inp = document.querySelector('#mmPanel .mm-rel-in');
  if (inp) inp.focus();
}

/* ═══ 속성 패널 ═══ */
function _mmPaintPanel() {
  var pn = _mmEl('mmPanel');
  if (!pn || !_mm.doc) return;
  var f = _mmSelInfo();
  if (!f) { pn.innerHTML = ''; return; }
  if (_mm.multi.length > 1 && typeof mmMultiPanelHtml === 'function') {
    pn.removeAttribute('data-sel');
    pn.innerHTML = mmMultiPanelHtml();
    return;
  }
  // 같은 주제의 입력칸을 쓰는 중이면 다시 그리지 않음 (Tab 으로 다음 칸 이동 시 포커스 유지)
  var ae = document.activeElement;
  // (체크박스는 켜면 딸린 입력칸이 나타나야 하므로 다시 그림)
  var typing = ae && pn.contains(ae) && (ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || (ae.tagName === 'INPUT' && !/^(checkbox|radio)$/.test(ae.type)));
  if (typing && pn.getAttribute('data-sel') === f.node.id) return;
  pn.setAttribute('data-sel', f.node.id);
  var n = f.node;
  var ro = _mm.readOnly ? ' disabled' : '';
  var pri = '';
  (n.markers || []).forEach(function (m) { var x = /^priority-(\d)$/.exec(m); if (x) pri = x[1]; });
  var h = '<div class="mm-pn-sec"><div class="mm-pn-h">' + (f.depth === 0 ? '중심 주제' : f.depth === 1 ? '주요 주제' : '하위 주제') + '</div>' +
    '<textarea id="mmPnText" class="mm-input" rows="2"' + ro + '>' + _mmEsc(n.text || '') + '</textarea></div>';
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">색상</div><div class="mm-swatches">' + MM_COLORS.map(function (c) {
    return '<button class="mm-sw' + ((n.color || '') === c.key ? ' on' : '') + '" data-act="color" data-v="' + c.key + '" title="' + (c.label || c.key) + '"' + ro +
      ' style="' + (c.c ? 'background:' + c.c : '') + '">' + (c.c ? '' : 'A') + '</button>';
  }).join('') + '</div></div>';
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">우선순위 <span class="mm-hint">Alt+1~9</span></div><div class="mm-swatches">' +
    '<button class="mm-mkbtn' + (!pri ? ' on' : '') + '" data-act="priority" data-v=""' + ro + '>—</button>' +
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) { return '<button class="mm-mkbtn' + (pri === String(i) ? ' on' : '') + '" data-act="priority" data-v="' + i + '"' + ro + '><span class="mm-pri mm-pri' + i + '">' + i + '</span></button>'; }).join('') +
    '</div></div>';
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">마커</div><div class="mm-swatches">' + MM_SYMBOLS.map(function (s) {
    var on = (n.markers || []).indexOf(s.k) >= 0;
    return '<button class="mm-mkbtn' + (on ? ' on' : '') + '" data-act="symbol" data-v="' + s.k + '" title="' + s.l + '"' + ro + '>' + s.g + '</button>';
  }).join('') + '</div></div>';
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">라벨 <span class="mm-hint">쉼표로 구분</span></div>' +
    '<input id="mmPnLabels" class="mm-input" value="' + _mmEsc((n.labels || []).join(', ')) + '"' + ro + '></div>';
  var members = _mm.members || [];
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">작업 정보</div>' +
    '<label class="mm-pn-row">담당<select id="mmPnAssignee" class="mm-input"' + ro + '><option value="">—</option>' +
    members.map(function (u) { return '<option value="' + _mmEsc(u.id) + '"' + (u.id === n.assigneeId ? ' selected' : '') + '>' + _mmEsc(u.name) + '</option>'; }).join('') + '</select></label>' +
    '<label class="mm-pn-row">시작<input type="date" id="mmPnStart" class="mm-input" value="' + _mmEsc(n.startDate || '') + '"' + ro + '></label>' +
    '<label class="mm-pn-row">마감<input type="date" id="mmPnDue" class="mm-input" value="' + _mmEsc(n.dueDate || '') + '"' + ro + '></label>' +
    '<label class="mm-pn-row">진척<input type="number" min="0" max="100" step="5" id="mmPnProg" class="mm-input" placeholder="%" value="' + (n.progress != null ? _mmEsc(n.progress) : '') + '"' + ro + '></label>' +
    '<label class="mm-pn-chk"><input type="checkbox" id="mmPnDone"' + (n.done ? ' checked' : '') + ro + '> 완료</label></div>';
  // 앱 데이터 연결 · 승격
  var ri = n.ref ? (MM_REF_TYPES[n.ref.type] || { i: '🔗', l: '항목' }) : null;
  var rr = n.ref ? _mm.refs[n.ref.type + ':' + n.ref.id] : null;
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">앱 데이터 연결</div>' + (n.ref
    ? '<div class="mm-pn-ref">' + ri.i + ' ' + ri.l + ' · <b>' + _mmEsc(rr && rr.title ? rr.title : (rr && rr.locked ? '볼 권한 없음' : rr && rr.missing ? '삭제됨' : '…')) + '</b></div>' +
      '<div class="mm-swatches"><button class="btn btn-g btn-s" data-act="ref-open">열기</button>' + (_mm.readOnly ? '' : '<button class="btn btn-g btn-s" data-act="ref-unlink">연결 해제</button>') + '</div>'
    : (_mm.readOnly ? '<div class="mm-hint">연결 없음</div>' :
      '<div class="mm-swatches"><button class="btn btn-g btn-s" data-act="link-ref">🔗 연결…</button>' +
      '<button class="btn btn-g btn-s" data-act="promote" data-kind="milestone" title="이 주제로 마일스톤 만들기">⤴ 마일스톤</button>' +
      '<button class="btn btn-g btn-s" data-act="promote" data-kind="issue" title="이 주제로 이슈 만들기">⤴ 이슈</button></div>')) + '</div>';
  // 구조: 경계 · 요약 · 번호
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">구조</div>' +
    '<label class="mm-pn-chk"><input type="checkbox" id="mmPnBd"' + (n.boundary ? ' checked' : '') + ro + '> 경계 (이 가지 묶기)</label>' +
    (n.boundary ? '<input id="mmPnBdTitle" class="mm-input" placeholder="경계 제목 (선택)" value="' + _mmEsc(n.boundary.title || '') + '"' + ro + '>' : '') +
    ((n.children || []).length ? '<label class="mm-pn-chk"><input type="checkbox" id="mmPnSum"' + (n.summary ? ' checked' : '') + ro + '> 요약 (하위 묶음 옆 중괄호)</label>' +
      (n.summary ? '<div class="mm-pn-row"><input id="mmPnSumText" class="mm-input" placeholder="요약 내용" value="' + _mmEsc(n.summary.text || '') + '"' + ro + '>' +
        (!_mm.readOnly && _mm.aiReady ? '<button class="btn btn-g btn-s" data-act="ai-summary" title="AI 로 요약 쓰기">✨</button>' : '') + '</div>' : '') +
      '<label class="mm-pn-chk"><input type="checkbox" id="mmPnNum"' + (n.numbering ? ' checked' : '') + ro + '> 하위 번호 매기기 (1 · 1.1)</label>' : '') +
    '</div>';
  // 관계
  var rels = (_mmSheet().relations || []).filter(function (r) { return r.from === n.id || r.to === n.id; });
  if (rels.length) {
    h += '<div class="mm-pn-sec"><div class="mm-pn-h">관계</div>' + rels.map(function (r) {
      var other = mmFind(_mmRoot(), r.from === n.id ? r.to : r.from);
      return '<div class="mm-pn-row"><span class="mm-hint">' + (r.from === n.id ? '→' : '←') + ' ' + _mmEsc(other ? (other.node.text || '(빈 주제)').slice(0, 16) : '?') + '</span>' +
        '<input class="mm-input mm-rel-in" data-rel-label="' + _mmEsc(r.id) + '" placeholder="관계 설명" value="' + _mmEsc(r.label || '') + '"' + ro + '>' +
        (_mm.readOnly ? '' : '<button class="btn btn-g btn-s" data-act="rel-del" data-rel="' + _mmEsc(r.id) + '" title="관계 삭제">×</button>') + '</div>';
    }).join('') + '</div>';
  }
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">링크</div><input id="mmPnLink" class="mm-input" placeholder="https://" value="' + _mmEsc(n.link || '') + '"' + ro + '></div>';
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">노트</div><textarea id="mmPnNote" class="mm-input" rows="5"' + ro + '>' + _mmEsc(n.note || '') + '</textarea></div>';
  pn.innerHTML = h;
  if (_mm.readOnly) return;
  function bind(id, fn) { var el = _mmEl(id); if (el) el.onchange = function () { fn(el); }; }
  bind('mmPnText', function (el) { var v = el.value.replace(/\s+$/, ''); if (v !== (n.text || '')) _mmSetProp('text', v); });
  bind('mmPnLabels', function (el) {
    var arr = el.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 10);
    _mmSetProp('labels', arr);
  });
  bind('mmPnAssignee', function (el) { _mmSetProp('assigneeId', el.value || null); });
  bind('mmPnStart', function (el) { _mmSetProp('startDate', el.value || null); });
  bind('mmPnDue', function (el) { _mmSetProp('dueDate', el.value || null); });
  bind('mmPnProg', function (el) {
    var v = el.value === '' ? null : Math.max(0, Math.min(100, parseInt(el.value, 10) || 0));
    _mmSetProp('progress', v);
  });
  bind('mmPnDone', function (el) { _mmSetProp('done', el.checked); });
  bind('mmPnLink', function (el) {
    var v = el.value.trim();
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    _mmSetProp('link', v);
  });
  bind('mmPnNote', function (el) { _mmSetProp('note', el.value.replace(/\s+$/, '')); });
  bind('mmPnBd', function (el) { _mmSetProp('boundary', el.checked ? { title: '' } : null); });
  bind('mmPnBdTitle', function (el) { _mmSetProp('boundary', { title: el.value.trim().slice(0, 100) }); });
  bind('mmPnSum', function (el) { _mmSetProp('summary', el.checked ? { text: '요약' } : null); });
  bind('mmPnSumText', function (el) { _mmSetProp('summary', { text: el.value.trim().slice(0, 200) || '요약' }); });
  bind('mmPnNum', function (el) { _mmSetProp('numbering', el.checked); });
  pn.querySelectorAll('.mm-rel-in').forEach(function (inp) {
    inp.onchange = function () {
      var id = inp.getAttribute('data-rel-label');
      _mmMutate(function () {
        (_mmSheet().relations || []).forEach(function (r) { if (r.id === id) r.label = inp.value.trim().slice(0, 100); });
      });
    };
  });
  // 패널 입력 중 단축키가 캔버스로 가지 않게
  pn.onkeydown = function (e) { e.stopPropagation(); if (e.key === 'Escape') _mmFocusCanvas(); };
}

/* ═══ 아웃라인 보기 ═══ */
function _mmSetOutline(on) {
  _mm.outline = !!on;
  var ol = _mmEl('mmOutline'), cv = _mmEl('mmCanvas');
  if (!ol || !cv) return;
  ol.classList.toggle('hidden', !_mm.outline);
  cv.classList.toggle('hidden', _mm.outline);
  var a = _mmEl('mmVMap'), b = _mmEl('mmVOut');
  if (a) a.classList.toggle('on', !_mm.outline);
  if (b) b.classList.toggle('on', _mm.outline);
  if (_mm.outline) _mmPaintOutline();
  else { _mmPaint(); _mmFit(); _mmFocusCanvas(); }
}

function _mmPaintOutline(focusId) {
  var ol = _mmEl('mmOutline');
  if (!ol || !_mm.doc) return;
  var rows = [];
  mmWalk(_mmRoot(), function (n, parent, depth) {
    var kids = (n.children || []).length;
    rows.push('<div class="mm-ol-row' + (depth === 0 ? ' mm-ol-root' : '') + (n.done ? ' mm-done' : '') + '" style="padding-left:' + (depth * 22 + 6) + 'px">' +
      '<span class="mm-ol-tog" data-tog="' + _mmEsc(n.id) + '">' + (kids ? (n.collapsed ? '▸' : '▾') : '•') + '</span>' +
      '<input class="mm-ol-in" data-id="' + _mmEsc(n.id) + '" value="' + _mmEsc(n.text || '') + '"' + (_mm.readOnly ? ' readonly' : '') + '>' +
      (n.collapsed && kids ? '<span class="mm-hint">+' + kids + '</span>' : '') + '</div>');
    if (n.collapsed) return false;
  });
  ol.innerHTML = '<div class="mm-sub" style="margin-bottom:8px">Enter 새 줄 · Tab 들여쓰기 · Shift+Tab 내어쓰기 · 빈 줄에서 Backspace 삭제 · ↑↓ 이동</div>' + rows.join('');
  ol.onclick = function (e) {
    var tg = e.target.closest('[data-tog]');
    if (!tg) return;
    var f = mmFind(_mmRoot(), tg.getAttribute('data-tog'));
    if (!f || !(f.node.children || []).length) return;
    if (_mm.readOnly) f.node.collapsed = !f.node.collapsed;
    else _mmMutate(function () { f.node.collapsed = !f.node.collapsed; }, { paint: false });
    _mmPaintOutline(f.node.id);
  };
  ol.oninput = function (e) {
    var inp = e.target;
    if (!inp.classList.contains('mm-ol-in') || _mm.readOnly) return;
    var f = mmFind(_mmRoot(), inp.getAttribute('data-id'));
    if (!f) return;
    f.node.text = inp.value;
    _mmMarkDirty();
  };
  ol.onfocusin = function (e) {
    var inp = e.target;
    if (!inp.classList || !inp.classList.contains('mm-ol-in')) return;
    _mm.sel = inp.getAttribute('data-id');
    // 한 줄 편집을 시작할 때 되돌리기 지점 하나
    if (!_mm.readOnly) { _mm.undo.push(_mmSnapshot()); if (_mm.undo.length > 50) _mm.undo.shift(); _mm.redo = []; }
  };
  ol.onkeydown = function (e) {
    var inp = e.target;
    if (!inp.classList.contains('mm-ol-in') || e.isComposing || e.keyCode === 229) return;
    var id = inp.getAttribute('data-id');
    var root = _mmRoot();
    var f = mmFind(root, id);
    if (!f) return;
    var ins = Array.prototype.slice.call(ol.querySelectorAll('.mm-ol-in'));
    var idx = ins.indexOf(inp);
    var focusTo = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      var t = ins[idx + (e.key === 'ArrowUp' ? -1 : 1)];
      if (t) t.focus();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'y')) { e.preventDefault(); if (e.key === 'z' && !e.shiftKey) mmUndo(); else mmRedo(); _mmPaintOutline(_mm.sel); return; }
    if (_mm.readOnly) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      var nn = mmNewNode('');
      _mmMutate(function () {
        if (!f.parent) { f.node.collapsed = false; f.node.children.unshift(nn); }
        else if ((f.node.children || []).length && !f.node.collapsed) f.node.children.unshift(nn);
        else f.parent.children.splice(f.index + 1, 0, nn);
      }, { paint: false });
      focusTo = nn.id;
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (!f.parent || f.index === 0) return;
      var prev = f.parent.children[f.index - 1];
      _mmMutate(function () { prev.collapsed = false; mmMoveNode(root, id, prev.id); }, { paint: false });
      focusTo = id;
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (!f.parent || f.parent === root) return;
      var gp = mmFind(root, f.parent.id);
      _mmMutate(function () { mmMoveNode(root, id, gp.parent.id, gp.index + 1); }, { paint: false });
      focusTo = id;
    } else if (e.key === 'Backspace' && inp.value === '' && f.parent) {
      e.preventDefault();
      var prevIn = ins[idx - 1];
      var prevId = prevIn ? prevIn.getAttribute('data-id') : f.parent.id;
      _mmMutate(function () {
        // 하위가 있으면 부모 쪽으로 끌어올린 뒤 삭제
        var kids = f.node.children || [];
        f.parent.children.splice.apply(f.parent.children, [f.index, 1].concat(kids));
      }, { paint: false });
      focusTo = prevId;
    } else return;
    _mmPaintOutline(focusTo);
  };
  if (focusId) {
    var el = ol.querySelector('.mm-ol-in[data-id="' + (window.CSS && CSS.escape ? CSS.escape(focusId) : focusId) + '"]');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
}

/* ═══ 내보내기 ═══ */
function mmExportMarkdown() {
  if (!_mm.doc) return;
  var md = mmToMarkdown(_mmRoot());
  _mmDownload(_mmFileName(_mm.row.title) + '.md', new Blob([md], { type: 'text/markdown;charset=utf-8' }));
}

function mmExportPng() {
  if (typeof html2canvas !== 'function') { _mmToast('이미지 모듈을 불러오지 못했습니다', 'error'); return; }
  var stage = _mmEl('mmStage');
  if (!stage || !_mm.layout) return;
  if (_mm.outline) { _mmSetOutline(false); }
  var b = _mm.layout.bounds;
  var pad = 40;
  var w = Math.ceil(b.maxX - b.minX + pad * 2), h = Math.ceil(b.maxY - b.minY + pad * 2);
  var bg = getComputedStyle(_mmEl('mmCanvas')).backgroundColor || getComputedStyle(document.body).backgroundColor;
  var box = document.createElement('div');
  box.className = 'mm-export-box';
  box.style.cssText = 'position:fixed;left:-100000px;top:0;width:' + w + 'px;height:' + h + 'px;overflow:hidden;background:' + bg;
  var clone = stage.cloneNode(true);
  clone.removeAttribute('id');
  clone.style.transform = 'translate(' + (pad - b.minX) + 'px,' + (pad - b.minY) + 'px)';
  clone.querySelectorAll('.mm-sel,.mm-hit,.mm-multi,.mm-rel-from').forEach(function (x) { x.classList.remove('mm-sel', 'mm-hit', 'mm-multi', 'mm-rel-from'); });
  clone.querySelectorAll('.mm-inline').forEach(function (x) { x.remove(); });
  box.appendChild(clone);
  document.body.appendChild(box);
  var scale = Math.min(2, 8000 / Math.max(w, h));
  _mmToast('이미지 만드는 중…');
  html2canvas(box, { backgroundColor: bg, scale: scale, logging: false }).then(function (canvas) {
    canvas.toBlob(function (blob) { if (blob) _mmDownload(_mmFileName(_mm.row.title) + '.png', blob); }, 'image/png');
  }).catch(function (e) { _mmToast('❌ 이미지 만들기 실패 — ' + _mmErr(e), 'error'); })
    .then(function () { box.remove(); });
}
