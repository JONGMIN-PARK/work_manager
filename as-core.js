/**
 * A/S 관리 — 공통 코어 (as-manager.js 분할 1/7, 가장 먼저 로드)
 * 상태 변수(필터·뷰모드) · 카테고리 캐시(_asCats/_asLoadCats) · 빈도 표시 · 관리자 판별
 * 공통 헬퍼: _asEsc / _asJsArg / _asFmtDate / _asFmtDT / _asElapsed
 * (원래 as-manager.js 에서 순수 이동 — 동작 변화 없음)
 */

/**
 * 업무 관리자 — A/S 관리 모듈 (v1, 수직 슬라이스: 접수만)
 * 접수 카드 목록 + 신규 접수 모달
 * PRD: docs/PRD_AS_접수보고서.md
 */

/* ═══ 상태 변수 ═══ */
var asFilterStatus = '';
var asFilterPriority = '';
var asFilterCategory = '';
var asSearchKw = '';
var asViewMode = 'all';  // 'all' | 'myqueue' | 'kanban' | 'trash' | 'stats'
var _asTrashCount = 0;   // 휴지통 N개 배지용 (목록 응답 시 갱신)

/* ═══ 카테고리 캐시 (DB의 as_categories 테이블에서 동적 로드) ═══
 * active=true 항목만 캐시. 관리자 화면에서는 별도로 includeInactive=true 로 다시 조회.
 * 형식: [{ id, code, label, icon, sortOrder, active }, ...] (sortOrder ASC 정렬)
 * 폴백: config.js AS_CATEGORY (서버 통신 실패 / 부팅 직후 / 로컬 환경) */
var _AS_CAT_CACHE = null;
var _AS_CAT_LOADING = null;

function _asCats() {
  // 캐시가 있으면 그대로, 없으면 AS_CATEGORY fallback을 객체로 변환
  if (_AS_CAT_CACHE && _AS_CAT_CACHE.length) {
    var out = {};
    _AS_CAT_CACHE.forEach(function (c) { out[c.code] = { label: c.label, icon: c.icon || '' }; });
    return out;
  }
  return typeof AS_CATEGORY !== 'undefined' ? AS_CATEGORY : {};
}

function _asLoadCats(force) {
  if (typeof asCategoryGetAll !== 'function') return Promise.resolve(_asCats());
  if (!force && _AS_CAT_CACHE) return Promise.resolve(_asCats());
  if (_AS_CAT_LOADING) return _AS_CAT_LOADING;
  _AS_CAT_LOADING = asCategoryGetAll(false).then(function (rows) {
    _AS_CAT_CACHE = rows || [];
    _AS_CAT_LOADING = null;
    return _asCats();
  }).catch(function (err) {
    console.warn('[as] 카테고리 로드 실패 — fallback 사용', err && err.message);
    _AS_CAT_LOADING = null;
    return _asCats();
  });
  return _AS_CAT_LOADING;
}

function _asFreqDisplay(freqCode, count) {
  var FREQ = typeof AS_FREQUENCY !== 'undefined' ? AS_FREQUENCY : {};
  var f = FREQ[freqCode];
  if (!f) return freqCode || '';
  // 비정규적은 회수 무관, 그 외엔 회수 결합
  if (freqCode === 'irregular') return f.label;
  if (count == null || count === '' || isNaN(Number(count))) return f.label;
  // 시간당 회수 → 시간당 2회 형태
  var base = f.label.replace(/\s*회수\s*$/, '');
  return base + ' ' + Number(count) + '회';
}

/* A/S 모달 오버레이 — createModal(project-data.js) 위에 기존 모양을 그대로 유지.
 * z 는 고정값(기존 스택 순서 유지), 블러 없음, backdrop 클릭 닫기 없음(v13.63).
 * 호출 측은 반환된 overlay 에 innerHTML 로 기존 박스 마크업을 넣는다. */
function _asOverlay(id, z, overlayStyle) {
  return createModal({ id: id, z: z, overlayStyle: 'backdrop-filter:none' + (overlayStyle ? ';' + overlayStyle : '') }).overlay;
}

function _asAdminOnly() {
  return typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin';
}

/* ═══ 헬퍼 ═══ */
function _asEsc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
/* onclick="fn('...')" 안의 JS 문자열 인자용 — JS 이스케이프(\, ') 후 HTML 이스케이프.
   (_asEsc 가 ' → &#39; 로 바꾸므로 기존 _asEsc(x).replace(/'/g, "\\'") 는 동작하지 않았음) */
function _asJsArg(s) {
  if (s == null) return '';
  return _asEsc(String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}
function _asFmtDate(iso) {
  if (!iso) return '-';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}
function _asFmtDT(iso) {
  if (!iso) return '-';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return _asFmtDate(iso) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function _asElapsed(iso) {
  if (!iso) return '';
  var diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff) || diff < 0) return '';
  var h = Math.floor(diff / 3600000);
  if (h < 1) return Math.floor(diff / 60000) + '분 전';
  if (h < 24) return h + '시간 전';
  return Math.floor(h / 24) + '일 전';
}
