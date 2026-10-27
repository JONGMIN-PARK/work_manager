/**
 * 업무 관리자 — 🧠 마인드맵 (PRD_마인드맵) — 공통 상수 · 상태 · 헬퍼 · 진입점 · 열기/닫기 · 편집 잠금
 * 상위 탭 페이지. 관리자 + 관리자가 지정한 사용자만 사용 (currentUser.mindmapAccess).
 *
 * 모듈 (모두 전역 함수 · 이 순서로 로드 — 업무일지_분석기.html):
 *   mindmap-layout.js  순수 로직 — 트리 조작 · 배치(같은 단계 맞춤 포함) · 경계/요약/관계선 위치 · Markdown/XMind/OPML 변환
 *   mindmap.js         (이 파일) 상수 · 상태(_mm) · 헬퍼 · renderMindmap · mmOpen/mmBack · 편집 잠금
 *   mindmap-list.js    목록 · 새 맵 · 가져오기 · 사용 권한 · 공유 모달
 *   mindmap-view.js    편집기 화면 · 정렬 메뉴 · 시트 · 참조 상태 · 그리기 · 확대/이동
 *   mindmap-edit.js    변경/되돌리기/저장 · 주제 편집 · 인라인 편집 · 복사/붙여넣기 · 검색 · 마우스/키 이벤트 · 관계선
 *   mindmap-panel.js   속성 패널 · 아웃라인 · Markdown/PNG 내보내기
 *   mindmap-extra.js   앱 데이터 연결 · 승격 · 자동 생성 · 원본과 맞추기 · AI · .xmind/.opml · 프로젝트 상세 칸
 *   mindmap-keys.js    단축키 표(MM_COMMANDS) · 오른쪽 클릭 메뉴 · 명령 찾기 · 도움말 · 여러 선택 패널
 *   mindmap-media.js   주제 안 내용 줄(글 · 이미지) — 올리기 · 붙여넣기 · 끌어 놓기 · 크게 보기
 *
 * 저장: 1.5초 자동 저장(낙관적 락 version) · 편집 잠금(/api/locks, resourceType='mindmap')
 * 노드: text · children · side · collapsed · color · markers · labels · note · link(URL) · 작업 정보 ·
 *       ref(앱 데이터) · blocks(내용 줄) · boundary · summary · numbering · alignLevels · _ai(AI 미리보기, 저장 제외)
 * 의존(전역): apiFetch, currentUser, createModal, wmGuardedModal, showToast, eH, projGetAll, html2canvas
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
/** 프로젝트 고르기 <option> 목록 (이름순, "선택…" 포함) — 새 맵 · 공유 · 승격 · WBS 창 공용 */
function _mmProjectOptions(projects, selId) {
  return '<option value="">선택…</option>' + (projects || []).slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); })
    .map(function (p) { return '<option value="' + _mmEsc(p.id) + '"' + (p.id === selId ? ' selected' : '') + '>' + _mmEsc((p.orderNo ? '[' + p.orderNo + '] ' : '') + (p.name || '')) + '</option>'; }).join('');
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
    _mm.sheetIdx = 0; _mm.refs = {}; _mm.relFrom = null; _mm.multi = []; _mm.images = {}; _mm.imagesLoaded = false;
    _mm.sel = _mmRoot().id;
    _mm.undo = []; _mm.redo = [];
    _mm.dirty = false; _mm.titleDirty = false; _mm.conflict = null; _mm.lockedBy = null;
    _mm.search = ''; _mm.hits = []; _mm.hitIdx = -1;
    _mm.zoom = 1; _mm.panX = null; _mm.panY = null;
    if (window.innerWidth < 768) _mm.outline = true;   // 휴대폰은 아웃라인 보기로 시작
    _mmRenderEditor();
    if (_mm.canEdit) _mmLockAcquire(false);
    _mmResolveRefs();
    if (typeof mmLoadImages === 'function') mmLoadImages(id);
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
