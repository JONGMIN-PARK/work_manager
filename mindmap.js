/**
 * 업무 관리자 — 🧠 마인드맵 (PRD_마인드맵) — 공통 상수 · 상태 · 헬퍼 · 진입점 · 열기/닫기 · 편집 잠금
 * 상위 탭 페이지. 로그인한 모든 사용자 — 맵은 각자 자기 것과 받은 것만 보인다 (v13.249).
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
/* 색 테마 — 시트마다(sheet.theme, 없으면 default). 주요 주제가 차례로 쓰는 가지 색 · 중심 주제 색. 주제에 직접 고른 색이 먼저 */
var MM_THEMES = [
  { k: 'default', l: '기본', root: null, colors: null },
  { k: 'pastel', l: '파스텔', root: '#8B9CF7', colors: ['#7FB3F5', '#7DD3B0', '#F5C26B', '#F59AB0', '#B69CF5', '#7CD3E3'] },
  { k: 'vivid', l: '선명', root: '#E11D48', colors: ['#2563EB', '#16A34A', '#EA580C', '#DB2777', '#7C3AED', '#0891B2'] },
  { k: 'earth', l: '흙빛', root: '#7C5A3A', colors: ['#B7793E', '#6F8F4E', '#C29A3B', '#A45A52', '#7D6B91', '#4F7F86'] },
  { k: 'ocean', l: '바다', root: '#0E4A7A', colors: ['#1D7AB8', '#14A3A3', '#3B6FD1', '#2DB3C9', '#5468C4', '#22839B'] },
  { k: 'mono', l: '단색', root: '#334155', colors: ['#475569', '#64748B', '#475569', '#64748B', '#475569', '#64748B'] }
];
function _mmTheme() { var k = _mmSheet().theme; return MM_THEMES.filter(function (t) { return t.k === k; })[0] || MM_THEMES[0]; }
/* 글자 서식 — node.bold · node.fs('s' 작게 | 'l' 크게). 서식 복사 대상: 색 · 굵게 · 크기 */
var MM_STYLE_KEYS = ['color', 'bold', 'fs'];
var MM_UNDERLINE = 2;   // 하위 주제 밑줄 굵기(px) — style.css .mm-topic2 border-bottom 과 같게
var MM_AUTO_COLORS = ['blue', 'green', 'amber', 'rose', 'purple', 'cyan'];
/* 마커 — 묶음(grp)별로 패널에 표시. k 는 저장 값이라 바꾸지 않는다 */
var MM_SYMBOL_GROUPS = [
  { k: 'state', l: '상태' }, { k: 'flag', l: '깃발 · 별' }, { k: 'face', l: '표정' },
  { k: 'arrow', l: '화살표 · 의견' }, { k: 'people', l: '사람' }, { k: 'work', l: '업무' }, { k: 'misc', l: '기타' }
];
var MM_SYMBOLS = [
  { k: 'check', g: '✅', l: '확인', grp: 'state' }, { k: 'cross', g: '❌', l: '취소', grp: 'state' },
  { k: 'question', g: '❓', l: '질문', grp: 'state' }, { k: 'warning', g: '⚠️', l: '주의', grp: 'state' },
  { k: 'stop', g: '⛔', l: '막힘', grp: 'state' }, { k: 'wait', g: '⏳', l: '대기', grp: 'state' },
  { k: 'hot', g: '🔥', l: '긴급', grp: 'state' }, { k: 'new', g: '🆕', l: '새 항목', grp: 'state' },
  { k: 'repeat', g: '🔁', l: '반복', grp: 'state' }, { k: 'lock', g: '🔒', l: '잠금 · 비공개', grp: 'state' },
  { k: 'flag', g: '🚩', l: '플래그', grp: 'flag' }, { k: 'flag-finish', g: '🏁', l: '완료 지점', grp: 'flag' },
  { k: 'flag-white', g: '🏳️', l: '흰 깃발', grp: 'flag' }, { k: 'flag-black', g: '🏴', l: '검은 깃발', grp: 'flag' },
  { k: 'star', g: '⭐', l: '별', grp: 'flag' }, { k: 'sparkle', g: '✨', l: '반짝', grp: 'flag' },
  { k: 'heart', g: '❤️', l: '하트', grp: 'flag' }, { k: 'medal', g: '🏅', l: '메달', grp: 'flag' }, { k: 'trophy', g: '🏆', l: '트로피', grp: 'flag' },
  { k: 'smile', g: '😀', l: '좋음', grp: 'face' }, { k: 'meh', g: '😐', l: '보통', grp: 'face' },
  { k: 'sad', g: '😟', l: '걱정', grp: 'face' }, { k: 'angry', g: '😠', l: '불만', grp: 'face' },
  { k: 'surprise', g: '😮', l: '놀람', grp: 'face' }, { k: 'think', g: '🤔', l: '고민', grp: 'face' },
  { k: 'up', g: '⬆️', l: '올림', grp: 'arrow' }, { k: 'down', g: '⬇️', l: '내림', grp: 'arrow' },
  { k: 'right', g: '➡️', l: '다음', grp: 'arrow' }, { k: 'left', g: '⬅️', l: '이전', grp: 'arrow' },
  { k: 'refresh', g: '🔄', l: '갱신', grp: 'arrow' }, { k: 'back', g: '↩️', l: '되돌림', grp: 'arrow' },
  { k: 'thumbs-up', g: '👍', l: '찬성', grp: 'arrow' }, { k: 'thumbs-down', g: '👎', l: '반대', grp: 'arrow' },
  { k: 'person', g: '👤', l: '개인', grp: 'people' }, { k: 'people', g: '👥', l: '협의', grp: 'people' },
  { k: 'handshake', g: '🤝', l: '협력', grp: 'people' }, { k: 'raise', g: '🙋', l: '요청', grp: 'people' },
  { k: 'customer', g: '🧑‍💼', l: '고객', grp: 'people' }, { k: 'engineer', g: '🧑‍🔧', l: '기술', grp: 'people' },
  { k: 'target', g: '🎯', l: '목표', grp: 'work' }, { k: 'rocket', g: '🚀', l: '출시', grp: 'work' },
  { k: 'calendar', g: '📅', l: '일정', grp: 'work' }, { k: 'pin', g: '📌', l: '고정', grp: 'work' },
  { k: 'doc', g: '📄', l: '문서', grp: 'work' }, { k: 'chat', g: '💬', l: '논의', grp: 'work' },
  { k: 'mail', g: '✉️', l: '메일', grp: 'work' }, { k: 'phone', g: '📞', l: '전화', grp: 'work' },
  { k: 'money', g: '💰', l: '비용', grp: 'work' }, { k: 'chart', g: '📈', l: '실적', grp: 'work' },
  { k: 'bug', g: '🐞', l: '결함', grp: 'work' }, { k: 'tool', g: '🔧', l: '수리 · 조정', grp: 'work' },
  { k: 'test', g: '🧪', l: '시험', grp: 'work' }, { k: 'box', g: '📦', l: '출하 · 자재', grp: 'work' },
  { k: 'idea', g: '💡', l: '아이디어', grp: 'misc' }, { k: 'bell', g: '🔔', l: '알림', grp: 'misc' },
  { k: 'search', g: '🔍', l: '확인 필요', grp: 'misc' }, { k: 'key', g: '🔑', l: '핵심', grp: 'misc' },
  { k: 'link', g: '🔗', l: '연결', grp: 'misc' }, { k: 'coffee', g: '☕', l: '휴식', grp: 'misc' }
];
/** 마커 단추를 묶음별로. btn(s) → 단추 하나의 HTML */
function _mmSymbolGroupsHtml(btn) {
  return MM_SYMBOL_GROUPS.map(function (g) {
    var items = MM_SYMBOLS.filter(function (s) { return s.grp === g.k; });
    return '<div class="mm-mk-grp"><div class="mm-mk-grp-h">' + g.l + '</div><div class="mm-swatches">' + items.map(btn).join('') + '</div></div>';
  }).join('');
}
/* 캔버스 배경 — 시트마다(sheet.bg, 없으면 dots). 모양은 style.css [data-mmbg=…]. tone: 'light' · 'dark' 는 글자색을 그 배경에 맞춰 고정 */
var MM_BG_GROUPS = [{ k: 'clean', l: '깨끗한' }, { k: 'pattern', l: '무늬' }, { k: 'tint', l: '색감' }, { k: 'dark', l: '어둡게' }];
var MM_BACKGROUNDS = [
  { k: 'plain', l: '단색', grp: 'clean' }, { k: 'white', l: '흰 종이', grp: 'clean', tone: 'light' },
  { k: 'dots', l: '점', grp: 'pattern' }, { k: 'grid', l: '모눈', grp: 'pattern' }, { k: 'lines', l: '가로줄', grp: 'pattern' }, { k: 'cross', l: '십자', grp: 'pattern' },
  { k: 'ivory', l: '아이보리', grp: 'tint', tone: 'light' }, { k: 'mint', l: '민트', grp: 'tint', tone: 'light' }, { k: 'sky', l: '하늘', grp: 'tint', tone: 'light' },
  { k: 'lavender', l: '라벤더', grp: 'tint', tone: 'light' }, { k: 'rose', l: '로즈', grp: 'tint', tone: 'light' },
  { k: 'slate', l: '칠판', grp: 'dark', tone: 'dark' }, { k: 'blueprint', l: '청사진', grp: 'dark', tone: 'dark' }
];
function _mmBgKey() { var b = _mmSheet().bg; return MM_BACKGROUNDS.some(function (x) { return x.k === b; }) ? b : 'dots'; }
var MM_STRUCTURES = [
  { k: 'balanced', l: '마인드맵 ⇆' }, { k: 'right', l: '논리도 →' }, { k: 'down', l: '조직도 ↓' },
  { k: 'timeline', l: '타임라인 ⟶' }, { k: 'fishbone', l: '피시본 ⟵' }, { k: 'matrix', l: '매트릭스 ▦' }
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
/* 빈 틀 · 예제 템플릿 MM_TEMPLATES 는 mindmap-templates.js (상황별 추천, v13.249) */

/* 앱 데이터로 자동 생성 (lib/mindmap-data generate) · AI 로 만들기 — mindmap-extra.js 가 문서를 만든다 */
var MM_GEN_TEMPLATES = [
  { k: 'gen-project', gen: 'project', l: '📁 프로젝트 구조도', hint: '프로젝트 → 마일스톤 · 체크리스트(단계별) · 미해결 이슈 · 최근 회의. 마일스톤·이슈는 상태가 실시간으로 보입니다.' },
  { k: 'gen-team', gen: 'team', l: '👥 팀원 업무 지도', hint: '부서 → 팀원 → 담당 프로젝트 · 마일스톤 · 이슈 · A/S. 내가 볼 수 있는 프로젝트의 업무만 나옵니다.' },
  { k: 'gen-mine', gen: 'mine', l: '🙋 내 업무', hint: '나 → 담당 마일스톤(프로젝트별) · 이슈 · A/S + 할 일 · 아이디어 가지.' },
  { k: 'gen-meeting', gen: 'meeting', l: '🤝 회의록 → 맵', hint: '회의 → 안건(논의 · 결과) · 논의 · 결정 사항 · 액션 아이템(담당 · 마감 · 완료) · 참석자 · 다음 회의. 프로젝트 회의는 프로젝트 범위로.' }
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
function mmHasAccess() { return !!_mmMe(); }
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
/**
 * 진행률 표 {id: {p, own, n, of}} — 맵 · 간트가 같은 기준으로 쓴다(mmProgressRollup).
 * 직접 값 · 완료가 없으면 연결된 앱 데이터(마일스톤 · 프로젝트 …)의 완료 · 진척을 쓴다.
 */
function _mmProgressMap(root) {
  return mmProgressRollup(root, function (n) {
    if (!n.ref || n.ref.type === 'user') return null;
    var r = _mm.refs && _mm.refs[n.ref.type + ':' + n.ref.id];
    if (!r) return null;
    if (r.done || r.status === 'done') return 100;
    var p = parseInt(r.progress, 10);
    return isNaN(p) ? null : p;
  });
}
/** 담당자 표시 이름 — 사용자 목록에서 고른 사람(assigneeId) 또는 직접 입력한 이름(assigneeName) */
function _mmAssigneeName(n) {
  return (n.assigneeId && _mmMemberName(n.assigneeId)) || n.assigneeName || '';
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
  if (typeof def !== 'string') {
    n.children = (def.children || []).map(_mmBuildTree);
    if (def.note) n.note = def.note;
    if (def.labels) n.labels = def.labels.slice();
  }
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
/* 선 아이콘 — 24 격자 path (Lucide 모양, MIT). _mmIcon(name) → <svg> */
var MM_ICONS = {
  back: 'M15 18l-6-6 6-6',
  child: 'M3 8h6v8H3zM9 12h5M18 9v6M15 12h6',
  sibling: 'M4 4h8v6H4zM4 14h8v6H4zM18 14v6M15 17h6',
  parent: 'M10 3h8v6h-8zM14 9v3M14 12H7v3M3 15h8v6H3z',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  relation: 'M5 19C5 10 19 14 19 5M15 5h4v4',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  refresh: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
  fold: 'M4 4h16v16H4zM8 12h8',
  level1: 'M12 3L2 8l10 5 10-5-10-5zM2 16l10 5 10-5',
  unfold: 'M7 15l5 5 5-5M7 9l5-5 5 5',
  fit: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  align: 'M21 6H3M17 12H3M21 18H3',
  zen: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  command: 'M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  sparkles: 'M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2zM19 3v4M21 5h-4',
  sync: 'M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  gantt: 'M3 3v18h18M7 7h7M10 12h8M7 17h5',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  pen: 'M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  x: 'M18 6L6 18M6 6l12 12',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  play: 'M7 4v16l13-8z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  bg: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 8.5h.01'
};
function _mmIcon(name, size) {
  var d = MM_ICONS[name];
  if (!d) return '';
  var s = size || 16;
  return '<svg class="mm-ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
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
    _mm.preview = null; _mm.hist = null; if (_mm.gt) _mm.gt.scrolled = false;
    _mm.sel = _mmRoot().id;
    _mm.undo = []; _mm.redo = [];
    _mm.dirty = false; _mm.titleDirty = false; _mm.conflict = null; _mm.lockedBy = null;
    _mm.search = ''; _mm.hits = []; _mm.hitIdx = -1; _mm.vf = null; _mm.comments = []; _mm.files = [];
    _mm.zoom = 1; _mm.panX = null; _mm.panY = null;
    if (window.innerWidth < 768) _mm.outline = true;   // 휴대폰은 아웃라인 보기로 시작
    var go = _mmTakeGoto(id);
    _mmRenderEditor();
    if (go) setTimeout(function () { if (_mm.mapId === id) _mmSelect(go); }, 0);
    if (_mm.canEdit) _mmLockAcquire(false);
    _mmResolveRefs();
    if (typeof mmLoadImages === 'function') mmLoadImages(id);
    if (typeof mmLoadComments === 'function') mmLoadComments();
    if (typeof mmLoadFiles === 'function') mmLoadFiles();
    if (typeof mmAiCheck === 'function') mmAiCheck();
  }).catch(function (e) {
    _mm.mapId = null;
    _mm.view = 'list';
    _mmToast('❌ 맵을 열 수 없습니다 — ' + (e && e.status === 404 ? '삭제되었거나 권한이 없습니다' : _mmErr(e)), 'error');
    _mmRenderList();
  });
}

/**
 * 다른 화면(내 업무)에서 주제로 바로 열기 — _mm.goto = { mapId, sheet, node }.
 * 그 시트로 바꾸고 접힌 위 단계를 펴서 고를 주제 id 를 돌려준다 (없으면 null)
 */
function _mmTakeGoto(id) {
  var g = _mm.goto;
  if (!g || g.mapId !== id) return null;
  _mm.goto = null;
  if (_mm.doc.sheets[g.sheet]) _mm.sheetIdx = g.sheet;
  var f = mmFind(_mmRoot(), g.node);
  if (!f) { _mmToast('주제를 찾을 수 없습니다 — 지워졌거나 옮겨졌습니다', 'warn'); return null; }
  while (f && f.parent) {
    f.parent.collapsed = false;
    f = mmFind(_mmRoot(), f.parent.id);
  }
  _mm.sel = g.node;
  return g.node;
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
  var ro = _mm.preview ? _mm.preview.live.readOnly : _mm.readOnly;   // 미리 보기 중에도 잠금은 계속 연장
  if (_mm.mapId !== id || ro) return Promise.resolve();
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
