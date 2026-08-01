/**
 * 업무일지 분석기 — 프로젝트/마일스톤/일정 데이터 관리 (서버 모드 전용)
 *
 * 이전에는 IndexedDB(local) + REST API(server) 듀얼 모드였으나,
 * 로컬 모드는 제거되고 서버 모드(REST API)만 사용합니다.
 * apiFetch 가 전역에서 사용 가능해야 하며, 그렇지 않으면 런타임 오류가 발생합니다.
 *
 * === API 네이밍 규칙 (#14) ===
 * 엔티티별:   {prefix}Put, {prefix}GetAll, {prefix}Get, {prefix}Del
 *   proj*   → projects       | ms*      → milestones    | evt*     → events
 *   order*  → orders         | chk*     → checklists    | issue*   → issues
 *   issueLog* → issueLogs   | wr*      → workRecords    | wk*      → weeks(archives)
 *   folder* → projectFolders | file*   → projectFiles
 * localStorage: lsGet(key), lsSet(key,val), lsRemove(key), lsGetJSON(key,fallback), lsSetJSON(key,val)
 * 모달: createModal({title, html, content, width, onClose, closeOnOverlay})
 * 토스트: showToast(msg, type)
 * 아카이브 캐시: invalidateArchiveCache()
 */

/* ═══ UUID 생성 ═══ */
function uuid() {
  return 'xxxx-xxxx-xxxx'.replace(/x/g, function () {
    return (Math.random() * 16 | 0).toString(16);
  });
}

/* ═══ camelCase ↔ snake_case 변환 헬퍼 ═══ */
function toCamel(row) {
  if (!row) return row;
  var out = {};
  for (var k in row) {
    var ck = k.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); });
    var v = row[k];
    // JSONB 문자열 → 파싱
    if (typeof v === 'string' && (k === 'assignees' || k === 'dependencies' || k === 'project_ids' || k === 'tags' || k === 'items' || k === 'phases' || k === 'data' || k === 'date_range' || k === 'selected_names' || k === 'summary_history' || k === 'version_history' || k === 'assignee_targets')) {
      try { v = JSON.parse(v); } catch (e) { /* keep string */ }
    }
    // NUMERIC 컬럼 → 숫자 변환 (node-postgres가 문자열로 반환)
    if (typeof v === 'string' && (k === 'hours' || k === 'estimated_hours' || k === 'actual_hours' || k === 'total_hours' || k === 'progress' || k === 'weight')) {
      v = parseFloat(v) || 0;
    }
    out[ck] = v;
  }
  return out;
}
function toCamelArray(rows) { return (rows || []).map(toCamel); }
function toSnake(s) { return s.replace(/[A-Z]/g, function (c) { return '_' + c.toLowerCase(); }); }

/* ═══ #12 리팩토링: localStorage 래퍼 ═══ */
function lsGet(key, fallback) {
  try { var v = localStorage.getItem(key); return v !== null ? v : (fallback !== undefined ? fallback : null); }
  catch (e) { console.warn('[LS] read error', key, e); return fallback !== undefined ? fallback : null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); }
  catch (e) { console.warn('[LS] write error', key, e); }
}
function lsRemove(key) {
  try { localStorage.removeItem(key); }
  catch (e) { console.warn('[LS] remove error', key, e); }
}
function lsGetJSON(key, fallback) {
  try { var v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : (fallback !== undefined ? fallback : null); }
  catch (e) { console.warn('[LS] JSON parse error', key, e); return fallback !== undefined ? fallback : null; }
}
function lsSetJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('[LS] JSON write error', key, e); }
}

/* ═══ #4/#10 리팩토링: 아카이브 캐시 ═══ */
var _archiveCache = { data: null, ts: 0 };
var ARCHIVE_CACHE_TTL = 5000; // 5초 캐시

function invalidateArchiveCache() { _archiveCache.data = null; _archiveCache.ts = 0; }

/* ═══ #13 리팩토링: 매직 넘버 상수 ═══ */
var REPEAT_LIMIT = 200;
var TOAST_DURATION = 2500;
var TOAST_FADE = 300;
var PROGRESS_MAX = 100;

/* ═══ 기본 체크리스트 템플릿 ═══ */
var DEFAULT_CHECKLIST = {
  order: ['견적서 발행', '계약서 체결', '선급금 수령', '킥오프 미팅 완료', '요구사항 정의서 작성'],
  design: ['기구 설계 완료', '전장 설계 완료', 'SW 설계 완료', '설계 검토(DR) 완료', '자재 발주'],
  manufacture: ['자재 입고 확인', '기구 가공/조립 완료', '전장 배선 완료', 'SW 개발/탑재 완료', '단품 시험 완료'],
  inspect: ['자체 검수 완료', '검수 성적서 작성', '고객 입회 검수(FAT) 완료', '불량 시정 완료'],
  deliver: ['출하 검사 완료', '운송/설치 완료', '시운전 완료(SAT)', '운전 교육 완료', '인수인계서 서명'],
  as: ['하자보증 기간 설정', '정기점검 일정 등록', 'A/S 연락처 공유']
};

/* ═══ 문서 폴더 / 파일 상수 ═══ */
var DOC_FOLDER_DEFAULTS = ['order', 'design', 'manufacture', 'inspect', 'deliver', 'as'];
var DOC_MAX_FILE = 50 * 1024 * 1024; // 50MB
var DOC_MAX_PROJECT = 500 * 1024 * 1024; // 500MB

var DOC_ICONS = {
  pdf: { icon: '📕', color: '#EF4444' },
  xlsx: { icon: '📗', color: '#10B981' }, xls: { icon: '📗', color: '#10B981' },
  pptx: { icon: '📙', color: '#F59E0B' }, ppt: { icon: '📙', color: '#F59E0B' },
  docx: { icon: '📘', color: '#3B82F6' }, doc: { icon: '📘', color: '#3B82F6' },
  txt: { icon: '📄', color: '' }, csv: { icon: '📄', color: '' }, md: { icon: '📄', color: '' },
  json: { icon: '📄', color: '' }, xml: { icon: '📄', color: '' }, log: { icon: '📄', color: '' },
  png: { icon: '🖼️', color: '#8B5CF6' }, jpg: { icon: '🖼️', color: '#8B5CF6' },
  jpeg: { icon: '🖼️', color: '#8B5CF6' }, gif: { icon: '🖼️', color: '#8B5CF6' },
  svg: { icon: '🖼️', color: '#8B5CF6' }, bmp: { icon: '🖼️', color: '#8B5CF6' }
};
function getDocIcon(ext) { return DOC_ICONS[ext] || { icon: '📎', color: '' }; }

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1048576).toFixed(1) + 'MB';
}

/* ═══ 페이지네이션 ═══ */
var PAGE_SIZE = 50;
var MODAL_Z = 9999;

/* ═══ 날짜 유틸 ═══ */
function dateToStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function datesBetween(start, end) {
  var arr = [];
  var d = new Date(start);
  var e = new Date(end);
  while (d <= e) {
    arr.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return arr;
}

function daysDiff(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 86400000);
}

function localDate() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

/* ═══ 반복 일정 인스턴스 확장 ═══ */
function expandRepeatingEvents(events, viewStart, viewEnd) {
  var result = [];
  events.forEach(function (ev) {
    result.push(ev);
    if (!ev.repeat || !ev.startDate) return;
    var duration = daysDiff(ev.startDate, ev.endDate) || 0;
    var until = ev.repeatUntil || viewEnd;
    if (until > viewEnd) until = viewEnd;
    var cur = new Date(ev.startDate);
    var limit = REPEAT_LIMIT;
    while (limit-- > 0) {
      if (ev.repeat === 'weekly') cur.setDate(cur.getDate() + 7);
      else if (ev.repeat === 'biweekly') cur.setDate(cur.getDate() + 14);
      else if (ev.repeat === 'monthly') cur.setMonth(cur.getMonth() + 1);
      else break;
      var ns = dateToStr(cur);
      if (ns > until) break;
      if (ns < viewStart && ns < ev.startDate) continue;
      var nd = new Date(cur);
      nd.setDate(nd.getDate() + duration);
      var ne = dateToStr(nd);
      // 가상 인스턴스 (원본 ID 유지하여 편집 가능)
      var inst = {};
      for (var k in ev) inst[k] = ev[k];
      inst.startDate = ns;
      inst.endDate = ne;
      inst._repeatInstance = true;
      inst._origId = ev.id;
      result.push(inst);
    }
  });
  return result;
}

/* ═══ 프로젝트 상태 자동 판별 ═══ */
function autoProjectStatus(proj) {
  if (proj.status === 'done' || proj.status === 'hold') return proj.status;
  var today = localDate();
  if (proj.endDate && proj.endDate < today) return 'delayed';
  if (proj.startDate && proj.startDate <= today) return 'active';
  return 'waiting';
}

/* ═══ 업무일지 레코드 중복 키 / 병합 ═══ */
function wrRecordKey(r) {
  return (r.date || '') + '|' + (r.name || '') + '|' + (r.orderNo || '') + '|' + (r.content || '');
}

function wrMerge(existingRecords, newRecords) {
  var keySet = {};
  existingRecords.forEach(function (r) { keySet[wrRecordKey(r)] = true; });
  var added = 0;
  var toAdd = [];
  newRecords.forEach(function (r) {
    var k = wrRecordKey(r);
    if (!keySet[k]) {
      keySet[k] = true;
      toAdd.push(r);
      added++;
    }
  });
  return { toAdd: toAdd, added: added };
}

/* ═══ 페이지네이션 유틸리티 ═══ */
function paginate(items, page, size) {
  size = size || PAGE_SIZE;
  page = Math.max(1, page || 1);
  var total = items.length;
  var totalPages = Math.ceil(total / size) || 1;
  page = Math.min(page, totalPages);
  var start = (page - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: page,
    totalPages: totalPages,
    total: total,
    hasNext: page < totalPages,
    hasPrev: page > 1
  };
}

function renderPagination(containerId, pageInfo, onPageChange) {
  var el = document.getElementById(containerId);
  if (!el) return;
  if (pageInfo.totalPages <= 1) { el.innerHTML = ''; return; }
  var html = '<div style="display:flex;align-items:center;justify-content:center;gap:6px;padding:8px;font-size:11px;color:var(--t4)">';
  html += '<button class="btn btn-g btn-s" ' + (pageInfo.hasPrev ? '' : 'disabled') + ' onclick="(' + onPageChange + ')(' + (pageInfo.page - 1) + ')">&lt;</button>';
  html += '<span>' + pageInfo.page + ' / ' + pageInfo.totalPages + ' (' + pageInfo.total + '건)</span>';
  html += '<button class="btn btn-g btn-s" ' + (pageInfo.hasNext ? '' : 'disabled') + ' onclick="(' + onPageChange + ')(' + (pageInfo.page + 1) + ')">&gt;</button>';
  html += '</div>';
  el.innerHTML = html;
}

/* ═══ 공용 모달 프레임 ═══ */
function createModal(opts) {
  var ov = document.createElement('div');
  ov.className = 'wa-modal-overlay';
  ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.55);z-index:' + MODAL_Z + ';display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
  var box = document.createElement('div');
  box.className = 'wa-modal-box';
  box.style.cssText = 'background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:24px;max-width:' + (opts.width || '600px') + ';width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.3);color:var(--t2)';
  if (opts.title) {
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px';
    hdr.innerHTML = '<span style="font-size:15px;font-weight:700;color:var(--t1)">' + opts.title + '</span>';
    var closeBtn = document.createElement('span');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = 'cursor:pointer;color:var(--t5);font-size:16px;padding:4px 8px;border-radius:6px;transition:all .15s';
    closeBtn.onmouseover = function () { this.style.color = 'var(--d-t)'; this.style.background = 'var(--d-bg)'; };
    closeBtn.onmouseout = function () { this.style.color = 'var(--t5)'; this.style.background = 'none'; };
    closeBtn.onclick = function () { ov.remove(); if (opts.onClose) opts.onClose(); };
    hdr.appendChild(closeBtn);
    box.appendChild(hdr);
  }
  if (opts.html) { var body = document.createElement('div'); body.innerHTML = opts.html; box.appendChild(body); }
  if (opts.content) { box.appendChild(opts.content); }
  ov.appendChild(box);
  // v13.63: 기본값을 false로 변경 — backdrop 클릭 닫기는 명시적으로 opts.closeOnOverlay:true 일 때만.
  //         편집 중 실수 클릭으로 데이터 유실되는 사고 방지.
  if (opts.closeOnOverlay === true) {
    ov.addEventListener('click', function (e) { if (e.target === ov) { ov.remove(); if (opts.onClose) opts.onClose(); } });
  }
  document.body.appendChild(ov);
  return { overlay: ov, box: box, close: function () { ov.remove(); if (opts.onClose) opts.onClose(); } };
}

/* ═══ 토스트 알림 ═══ */
function showToast(msg, type) {
  var existing = document.querySelectorAll('.wa-toast');
  existing.forEach(function (t, i) { t.style.top = (12 + (i + 1) * 44) + 'px'; });
  var toast = document.createElement('div');
  toast.className = 'wa-toast';
  var bg = type === 'error' ? '#EF4444' : type === 'warn' ? '#F59E0B' : '#10B981';
  toast.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:8px 20px;border-radius:8px;font-size:12px;font-weight:600;color:#fff;background:' + bg + ';z-index:100000;box-shadow:0 4px 12px rgba(0,0,0,.2);opacity:0;transition:opacity .3s;white-space:nowrap';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(function () { toast.style.opacity = '1'; });
  setTimeout(function () { toast.style.opacity = '0'; setTimeout(function () { toast.remove(); }, TOAST_FADE); }, TOAST_DURATION);
}

/* ═══════════════════════════════════════════════════════════════════════
 * 서버 모드 엔티티 CRUD (REST API)
 * ═══════════════════════════════════════════════════════════════════════ */

/* ─── 읽기 캐시 (TTL) — 동일 페이지 내 다수 위젯이 같은 API를 호출하는 중복 요청 제거 ─── */
var _PD_TTL = 30000;
/* wmDataBus emit 헬퍼 — 정의 안 됐으면 no-op (file:// 모드 등 호환) */
function _emitBus(type, action, detail) {
  try { if (typeof window !== 'undefined' && window.wmDataBus) window.wmDataBus.emit(type, action, detail || {}); } catch (e) { /* ignore */ }
}

var _pdCache = { proj: null, ms: null, evt: null };
var _pdCacheT = { proj: 0, ms: 0, evt: 0 };
var _pdInflight = { proj: null, ms: null, evt: null };
function _pdFresh(key) { return _pdCache[key] && (Date.now() - _pdCacheT[key] < _PD_TTL); }
function _pdInvalidate(key) {
  if (key) { _pdCache[key] = null; _pdCacheT[key] = 0; _pdInflight[key] = null; }
  else { _pdCache = { proj: null, ms: null, evt: null }; _pdCacheT = { proj: 0, ms: 0, evt: 0 }; _pdInflight = { proj: null, ms: null, evt: null }; }
}
function _pdCached(key, loader) {
  if (_pdFresh(key)) return Promise.resolve(_pdCache[key]);
  if (_pdInflight[key]) return _pdInflight[key];
  var p = loader().then(function (v) { _pdCache[key] = v; _pdCacheT[key] = Date.now(); _pdInflight[key] = null; return v; })
                  .catch(function (err) { _pdInflight[key] = null; throw err; });
  _pdInflight[key] = p;
  return p;
}

/* ─── 캐시 프라이밍 — /api/bootstrap 응답으로 프로젝트/마일스톤/이벤트 캐시 일괄 주입 ─── */
function _pdPrimeCache(projectsRaw, milestonesRaw, eventsRaw) {
  try {
    var now = Date.now();
    if (Array.isArray(projectsRaw)) {
      _pdCache.proj = toCamelArray(projectsRaw);
      _pdCacheT.proj = now;
    }
    if (Array.isArray(milestonesRaw)) {
      // _msNorm 필수 — msGetAll 과 동일 파이프라인. 누락 시 order=undefined 가 되어
      // _msDedupe 가 createdAt 순으로 정렬 → 타임라인이 저장된 sort_order 를 무시(순서 유실)
      _pdCache.ms = _msDedupe(_msNorm(toCamelArray(milestonesRaw)));
      _pdCacheT.ms = now;
    }
    if (Array.isArray(eventsRaw)) {
      _pdCache.evt = toCamelArray(eventsRaw);
      _pdCacheT.evt = now;
    }
  } catch (e) { console.warn('[pdPrimeCache]', e); }
}

/* ─── 프로젝트 ─── */
function projGetAll() { return _pdCached('proj', function () { return apiFetch('/api/projects').then(function (r) { return toCamelArray(r.data); }); }); }
function projGet(id) { return apiFetch('/api/projects/' + id).then(function (r) { return toCamel(r.data); }); }
/* 운영자 전용 — 테넌트 전체 프로젝트(가시성 우회) */
function projGetAllOperator() { return _pdCached('projAll', function () { return apiFetch('/api/projects/all').then(function (r) { return toCamelArray(r.data); }); }); }

/* ─── 운영자 포커스 셋(숨김 프로젝트) — user_settings 'project_focus' 저장, 모든 뷰 전역 적용 ─── */
var pmHidden = (typeof window !== 'undefined' && window.pmHidden) ? window.pmHidden : {};   // { projId: true }
function pmLoadFocus() {
  return apiFetch('/api/settings/project_focus').then(function (r) {
    pmHidden = {};
    var hid = (r && r.data && Array.isArray(r.data.hidden)) ? r.data.hidden : [];
    hid.forEach(function (id) { pmHidden[id] = true; });
    if (typeof window !== 'undefined') window.pmHidden = pmHidden;
    return pmHidden;
  }).catch(function () { return pmHidden; });
}
function pmSaveFocus() {
  var hidden = Object.keys(pmHidden).filter(function (id) { return pmHidden[id]; });
  return apiFetch('/api/settings/project_focus', { method: 'PUT', body: JSON.stringify({ value: { hidden: hidden } }) });
}
function pmIsHidden(id) { return !!pmHidden[id]; }
function pmSetHidden(id, hidden) { if (hidden) pmHidden[id] = true; else delete pmHidden[id]; if (typeof window !== 'undefined') window.pmHidden = pmHidden; }
/* 표시용 프로젝트 소스 — 운영자는 전체, 그 외 접근가능 집합. 숨김 제외. (모든 뷰가 이걸 사용) */
function pmGetProjects() {
  var base = (typeof isOperator === 'function' && isOperator())
    ? projGetAllOperator().catch(function () { return projGetAll(); })
    : projGetAll();
  return Promise.resolve(base).then(function (list) {
    return (list || []).filter(function (p) { return !pmHidden[p.id]; });
  });
}
function projPut(proj) {
  _pdInvalidate('proj'); _pdInvalidate('projAll');
  var isNew = !proj.id || proj._isNew;
  if (isNew) {
    delete proj._isNew;
    return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(proj) })
      .then(function (r) { var saved = toCamel(r.data); _emitBus('project', 'created', { id: saved && saved.id }); return saved; });
  }
  return apiFetch('/api/projects/' + proj.id, { method: 'PUT', body: JSON.stringify(proj) })
    .then(function (r) { return toCamel(r.data); })
    .catch(function (err) {
      if (err && (err.status === 404 || (err.data && err.data.error === 'NOT_FOUND'))) {
        return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(proj) }).then(function (r) { return toCamel(r.data); });
      }
      throw err;
    })
    .then(function (saved) { _emitBus('project', 'updated', { id: saved && saved.id }); return saved; });
}
function projDel(id) {
  _pdInvalidate('proj'); _pdInvalidate('projAll');
  return apiFetch('/api/projects/' + id, { method: 'DELETE' })
    .then(function (r) { _emitBus('project', 'deleted', { id: id }); return r; });
}
// 프로젝트 사양 정리 표 저장 — specs: {design:[],control:[],software:[],process:[]}
function projSpecsPut(id, specs) {
  return apiFetch('/api/projects/' + id + '/specs', { method: 'PUT', body: JSON.stringify({ specs: specs || {} }) })
    .then(function (r) { _pdInvalidate('proj'); _pdInvalidate('projAll'); return (r && r.data) ? toCamel(r.data) : r; });
}
// 프로젝트 표시 순서 일괄 갱신 (파이프라인 카드 재배열 등) — items: [{id, sortOrder}]
function projReorder(items) {
  return apiFetch('/api/projects/reorder', { method: 'POST', body: JSON.stringify({ items: items || [] }) })
    .then(function (r) { _pdInvalidate('proj'); _pdInvalidate('projAll'); return r; });
}

/* ─── 공유/이관 ─── */
function userLookup() {
  return apiFetch('/api/users/lookup').then(function (r) { return toCamelArray(r.data); });
}
function projMembersGet(id) {
  return apiFetch('/api/projects/' + id + '/members').then(function (r) { return toCamelArray(r.data); });
}
/* 테넌트 전체 활성 멤버를 1회 조회 → { projectId: { 이름: true } } 맵 (진척률 일괄 산출용) */
function projMembersAll() {
  return apiFetch('/api/projects/members/all').then(function (r) {
    var map = {};
    (r.data || []).forEach(function (row) {
      var pid = row.project_id || row.projectId;
      var nm = row.user_name || row.userName;
      if (!pid || !nm) return;
      if (!map[pid]) map[pid] = {};
      map[pid][nm] = true;
    });
    return map;
  });
}
function projShareAdd(id, userId, role) {
  return apiFetch('/api/projects/' + id + '/members', { method: 'POST', body: JSON.stringify({ userId: userId, role: role || 'assignee' }) })
    .then(function (r) { _pdInvalidate('proj'); return toCamel(r.data); });
}
function projShareRemove(id, userId) {
  return apiFetch('/api/projects/' + id + '/members/' + userId, { method: 'DELETE' })
    .then(function (r) { _pdInvalidate('proj'); return r; });
}
function projTransfer(id, newOwnerId, opts) {
  var body = { newOwnerId: newOwnerId };
  if (opts && opts.keepPrevAsMember === false) body.keepPrevAsMember = false;
  return apiFetch('/api/projects/' + id + '/transfer', { method: 'POST', body: JSON.stringify(body) })
    .then(function (r) { _pdInvalidate('proj'); return r.data; });
}
function msTransfer(id, targetProjectId) {
  return apiFetch('/api/milestones/' + id + '/transfer', { method: 'POST', body: JSON.stringify({ targetProjectId: targetProjectId }) })
    .then(function (r) { _pdInvalidate('proj'); return toCamel(r.data); });
}
// 프로젝트 사본 생성 — data: { name(필수), orderNo? }. 내용·인원·마일스톤·담당배정 복사(실적은 초기화)
function projCopy(id, data) {
  return apiFetch('/api/projects/' + id + '/copy', { method: 'POST', body: JSON.stringify(data || {}) })
    .then(function (r) { _pdInvalidate('proj'); _pdInvalidate('ms'); return toCamel(r.data); });
}

// 담당자 이름(string[]) → users 매칭 후 project_members 에 active assignee 로 추가 (additive only)
//  · 매칭 실패한 이름은 외부 인원으로 간주하고 무시
//  · 같은 이름의 사용자가 여러 명이면 먼저 매칭된 한 명만 사용
//  · 기존 멤버 자동 해제는 하지 않음 (의도치 않은 접근 손실 방지)
function syncAssigneesToMembers(projectId, names) {
  if (!projectId || !Array.isArray(names) || !names.length) return Promise.resolve([]);
  return userLookup().then(function (users) {
    var byName = {};
    (users || []).forEach(function (u) {
      [u.name, u.displayName].forEach(function (k) {
        if (k && !byName[k]) byName[k] = u;
      });
    });
    var ops = [];
    var seen = {};
    names.forEach(function (n) {
      var nm = (n || '').trim();
      if (!nm || seen[nm]) return;
      seen[nm] = true;
      var u = byName[nm];
      if (u && u.id) {
        ops.push(
          projShareAdd(projectId, u.id, 'assignee')
            .catch(function (e) { console.warn('[syncAssignee]', nm, e && e.message); })
        );
      }
    });
    return Promise.all(ops);
  }).catch(function (e) { console.warn('[syncAssigneesToMembers]', e && e.message); return []; });
}

function createProject(data) {
  var now = new Date().toISOString();
  var defaultPhases = { order: { status: 'waiting', startDate: '', endDate: '' }, design: { status: 'waiting', startDate: '', endDate: '' }, manufacture: { status: 'waiting', startDate: '', endDate: '' }, inspect: { status: 'waiting', startDate: '', endDate: '' }, deliver: { status: 'waiting', startDate: '', endDate: '' }, as: { status: 'waiting', startDate: '', endDate: '' } };
  var proj = {
    id: 'proj-' + uuid(),
    orderNo: (data.orderNo || '').trim(),
    name: (data.name || '').trim(),
    startDate: data.startDate || '',
    endDate: data.endDate || '',
    status: data.status || 'active',
    progress: data.progress || 0,
    estimatedHours: data.estimatedHours || 0,
    assignees: data.assignees || [],
    dependencies: data.dependencies || [],
    color: data.color || (typeof COL !== 'undefined' ? COL[(Math.random() * COL.length | 0)] : '#3B82F6'),
    memo: data.memo || '',
    currentPhase: data.currentPhase || 'order',
    phases: data.phases || defaultPhases,
    // v13.144 버그수정: 신규 생성 시 가시성 누락 → 서버가 항상 'private'로 저장되던 문제.
    // 모달 선택값('private'|'dept'|'tenant')을 그대로 전달(미지정 시에만 private).
    visibility: data.visibility || 'private',
    createdAt: now,
    updatedAt: now,
    _isNew: true
  };
  return projPut(proj);
}

function updateProject(id, updates) {
  return projGet(id).then(function (p) {
    if (!p) return null;
    Object.assign(p, updates, { updatedAt: new Date().toISOString() });
    return projPut(p);
  });
}

/* ─── 마일스톤 ─── */
// 마일스톤 중복 탐지 & 자동 정리 — (projectId|name|startDate|endDate) 키로
// 가장 먼저 등장한 레코드만 유지, 나머지는 fire-and-forget 으로 서버에서 삭제.
// sort_order(order) 낮은 것 우선, 동률이면 createdAt 빠른 것 우선.
function _msDedupe(list) {
  if (!Array.isArray(list) || list.length < 2) return list || [];
  var sorted = list.slice().sort(function (a, b) {
    var ao = (a.order == null ? 999999 : a.order);
    var bo = (b.order == null ? 999999 : b.order);
    if (ao !== bo) return ao - bo;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
  var seen = {};
  var uniq = [];
  var dupIds = [];
  sorted.forEach(function (m) {
    var key = (m.projectId || '') + '|' + ((m.name || '').trim()) + '|' + (m.startDate || '') + '|' + (m.endDate || '');
    if (seen[key]) dupIds.push(m.id);
    else { seen[key] = true; uniq.push(m); }
  });
  if (dupIds.length) {
    Promise.all(dupIds.map(function (id) {
      return apiFetch('/api/milestones/' + id, { method: 'DELETE' }).catch(function () {});
    })).then(function () {
      if (typeof console !== 'undefined') console.info('[milestones] 중복 ' + dupIds.length + '개 자동 정리');
    });
  }
  return uniq;
}
// 서버는 sort_order 컬럼을 반환 → toCamel 이 sortOrder 로 변환하지만,
// 클라이언트(타임라인·편집모달 정렬)는 m.order 를 사용한다. 둘을 일치시킨다.
function _msNorm(list) {
  (list || []).forEach(function (m) {
    if (m.order == null) m.order = (m.sortOrder != null ? m.sortOrder : 0);
  });
  return list;
}
function msGetAll() { return _pdCached('ms', function () { return apiFetch('/api/milestones').then(function (r) { return _msDedupe(_msNorm(toCamelArray(r.data))); }); }); }
function msGetByProject(pid) { return apiFetch('/api/milestones?projectId=' + pid).then(function (r) { return _msDedupe(_msNorm(toCamelArray(r.data))); }); }
function msPut(ms) {
  _pdInvalidate('ms');
  var isNew = !ms.id || ms._isNew;
  if (isNew) {
    delete ms._isNew;
    return apiFetch('/api/milestones', { method: 'POST', body: JSON.stringify(ms) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('milestone', 'created', { id: s && s.id, projectId: s && s.projectId }); return s; });
  }
  return apiFetch('/api/milestones/' + ms.id, { method: 'PUT', body: JSON.stringify(ms) })
    .then(function (r) { return toCamel(r.data); })
    .catch(function (err) {
      if (err && (err.status === 404 || (err.data && err.data.error === 'NOT_FOUND'))) {
        return apiFetch('/api/milestones', { method: 'POST', body: JSON.stringify(ms) }).then(function (r) { return toCamel(r.data); });
      }
      throw err;
    })
    .then(function (s) { _emitBus('milestone', 'updated', { id: s && s.id, projectId: s && s.projectId }); return s; });
}
function msDel(id) {
  _pdInvalidate('ms');
  return apiFetch('/api/milestones/' + id, { method: 'DELETE' })
    .then(function (r) { _emitBus('milestone', 'deleted', { id: id }); return r; });
}

function msDelByProject(projectId) {
  return msGetByProject(projectId).then(function (list) {
    return Promise.all(list.map(function (m) { return msDel(m.id); }));
  });
}

/* ─── 마일스톤 담당 배정(assignment) — 변경(교체)/대체(임시)/원복 (v13.141) ───
   사람은 user_id 기반. 과거 이력은 보존. msPut 와 달리 캐시 무효화 불필요(별도 테이블). */
function msAssignmentsGet(mid, includeAll) {
  return apiFetch('/api/milestones/' + mid + '/assignments' + (includeAll ? '?all=1' : ''))
    .then(function (r) { return toCamelArray(r.data); });
}
function msAssignmentAdd(mid, data) {
  return apiFetch('/api/milestones/' + mid + '/assignments', { method: 'POST', body: JSON.stringify(data || {}) })
    .then(function (r) { return toCamel(r.data); });
}
// data: { mode:'replace'|'cover', fromUserId?, toUserId, targetHours?, validFrom?, validUntil?, role? }
function msAssignmentHandover(mid, data) {
  return apiFetch('/api/milestones/' + mid + '/assignments/handover', { method: 'POST', body: JSON.stringify(data || {}) })
    .then(function (r) { return (r && r.data) ? toCamel(r.data) : r; });
}
// data: { assignmentId, restoreUserId? }
function msAssignmentRestore(mid, data) {
  return apiFetch('/api/milestones/' + mid + '/assignments/restore', { method: 'POST', body: JSON.stringify(data || {}) });
}
function msAssignmentRelease(mid, aid) {
  return apiFetch('/api/milestones/' + mid + '/assignments/' + aid, { method: 'DELETE' });
}

/* ─── 마일스톤 작업 노트 + 보고 진척률 이력 ─── */
function msLogsGet(mid) {
  return apiFetch('/api/milestones/' + mid + '/logs').then(function (r) { return toCamelArray(r.data); });
}
function msLogAdd(mid, data) {
  _pdInvalidate('ms');   // 마일스톤 progress 갱신 → 캐시 무효화
  return apiFetch('/api/milestones/' + mid + '/logs', {
    method: 'POST',
    body: JSON.stringify({ progress: data.progress, note: data.note || '', hours: data.hours || 0 })
  }).then(function (r) {
    var s = toCamel(r.data);
    _emitBus('milestone', 'updated', { id: mid, projectId: s && s.projectId });
    return s;
  });
}
function msLogDel(mid, logId) {
  _pdInvalidate('ms');   // 삭제 후 progress 재동기화 → 캐시 무효화
  return apiFetch('/api/milestones/' + mid + '/logs/' + logId, { method: 'DELETE' })
    .then(function (r) { _emitBus('milestone', 'updated', { id: mid }); return r; });
}
function msLogClear(mid) {
  _pdInvalidate('ms');
  return apiFetch('/api/milestones/' + mid + '/logs', { method: 'DELETE' })
    .then(function (r) { _emitBus('milestone', 'updated', { id: mid }); return r; });
}
/* 휴지통(삭제된 투입실적 이력) 목록 — 관리자 전용 */
function msLogsTrashGet(mid) {
  return apiFetch('/api/milestones/' + mid + '/logs/trash').then(function (r) { return toCamelArray(r.data); });
}
/* 휴지통에서 복구 — 관리자 전용 */
function msLogRestore(mid, logId) {
  _pdInvalidate('ms');   // 복구 시 진척률·투입시간 재집계 → 캐시 무효화
  return apiFetch('/api/milestones/' + mid + '/logs/' + logId + '/restore', { method: 'POST' })
    .then(function (r) { _emitBus('milestone', 'updated', { id: mid }); return r; });
}
/* 완전 삭제(복구 불가) — 관리자 전용. 휴지통 항목만. */
function msLogHardDel(mid, logId) {
  return apiFetch('/api/milestones/' + mid + '/logs/' + logId + '/hard', { method: 'DELETE' });
}
/* 휴지통 비우기(일괄 완전삭제) — 관리자 전용 */
function msLogTrashEmpty(mid) {
  return apiFetch('/api/milestones/' + mid + '/logs/trash/empty', { method: 'DELETE' });
}
/* 작업노트 N번째 체크박스 토글(저장) — 프로젝트 멤버 */
function msLogToggleCheck(mid, logId, index) {
  _pdInvalidate('ms');   // 최신 로그면 progress_note 변경 → 캐시 무효화
  return apiFetch('/api/milestones/' + mid + '/logs/' + logId + '/toggle-check', {
    method: 'POST', body: JSON.stringify({ index: index })
  }).then(function (r) { _emitBus('milestone', 'updated', { id: mid }); return toCamel(r.data); });
}

function createMilestone(data) {
  var ms = {
    id: 'ms-' + uuid(),
    projectId: data.projectId,
    name: (data.name || '').trim(),
    startDate: data.startDate || '',
    endDate: data.endDate || '',
    status: data.status || 'waiting',
    order: data.order || 0,
    assigneeTargets: data.assigneeTargets || {},
    createdAt: new Date().toISOString(),
    _isNew: true
  };
  return msPut(ms);
}

/* ─── 이벤트 ─── */
function evtGetAll() { return _pdCached('evt', function () { return apiFetch('/api/events').then(function (r) { return toCamelArray(r.data); }); }); }
function evtGet(id) { return apiFetch('/api/events/' + id).then(function (r) { return toCamel(r.data); }); }
function evtPut(evt) {
  _pdInvalidate('evt');
  var isNew = !evt.id || evt._isNew;
  if (isNew) {
    delete evt._isNew;
    return apiFetch('/api/events', { method: 'POST', body: JSON.stringify(evt) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('event', 'created', { id: s && s.id }); return s; });
  }
  return apiFetch('/api/events/' + evt.id, { method: 'PUT', body: JSON.stringify(evt) })
    .then(function (r) { return toCamel(r.data); })
    .catch(function (err) {
      if (err && (err.status === 404 || (err.data && err.data.error === 'NOT_FOUND'))) {
        return apiFetch('/api/events', { method: 'POST', body: JSON.stringify(evt) }).then(function (r) { return toCamel(r.data); });
      }
      throw err;
    })
    .then(function (s) { _emitBus('event', 'updated', { id: s && s.id }); return s; });
}
function evtDel(id) {
  _pdInvalidate('evt');
  return apiFetch('/api/events/' + id, { method: 'DELETE' })
    .then(function (r) { _emitBus('event', 'deleted', { id: id }); return r; });
}

function createEvent(data) {
  var now = new Date().toISOString();
  var evt = {
    id: 'evt-' + uuid(),
    title: (data.title || '').trim(),
    type: data.type || 'etc',
    startDate: data.startDate || '',
    endDate: data.endDate || data.startDate || '',
    projectIds: data.projectIds || [],
    assignees: data.assignees || [],
    color: data.color || (typeof EVT_TYPE !== 'undefined' ? (EVT_TYPE[data.type] || EVT_TYPE.etc).color : '#3B82F6'),
    memo: data.memo || '',
    repeat: data.repeat || null,
    repeatUntil: data.repeatUntil || '',
    createdAt: now,
    _isNew: true
  };
  return evtPut(evt);
}

function updateEvent(id, updates) {
  return evtGet(id).then(function (e) {
    if (!e) return null;
    Object.assign(e, updates);
    return evtPut(e);
  });
}

/* ─── 프로젝트 삭제 (캐스케이드) ─── */
function deleteProjectCascade(id) {
  var issDel = typeof issueGetByProject === 'function'
    ? issueGetByProject(id).then(function (issues) {
        return Promise.all(issues.map(function (iss) { return deleteIssueCascade(iss.id); }));
      })
    : Promise.resolve();
  var docDel = typeof deleteProjectFiles === 'function' ? deleteProjectFiles(id) : Promise.resolve();
  return Promise.all([issDel, docDel]).then(function () { return msDelByProject(id); }).then(function () {
    // 이벤트에서 삭제된 프로젝트 참조 제거
    return evtGetAll().then(function (events) {
      var updates = [];
      events.forEach(function (ev) {
        if (ev.projectIds && ev.projectIds.includes(id)) {
          ev.projectIds = ev.projectIds.filter(function (pid) { return pid !== id; });
          updates.push(evtPut(ev));
        }
      });
      return Promise.all(updates);
    });
  }).then(function () {
    // 다른 프로젝트의 의존관계에서 제거
    return projGetAll().then(function (projects) {
      var updates = [];
      projects.forEach(function (p) {
        if (p.dependencies && p.dependencies.includes(id)) {
          p.dependencies = p.dependencies.filter(function (did) { return did !== id; });
          updates.push(projPut(p));
        }
      });
      return Promise.all(updates);
    });
  }).then(function () {
    return projDel(id);
  });
}

/* ─── 수주 대장 ─── */
function orderGetAll() { return apiFetch('/api/orders').then(function (r) { return toCamelArray(r.data); }); }
function orderGet(orderNo) { return apiFetch('/api/orders/' + encodeURIComponent(orderNo)).then(function (r) { return toCamel(r.data); }); }
function orderPut(order) {
  return apiFetch('/api/orders', { method: 'POST', body: JSON.stringify(order) })
    .then(function (r) { var s = toCamel(r.data); _emitBus('order', 'updated', { orderNo: s && s.orderNo }); return s; });
}
function orderDel(orderNo) {
  return apiFetch('/api/orders/' + encodeURIComponent(orderNo), { method: 'DELETE' })
    .then(function (r) { _emitBus('order', 'deleted', { orderNo: orderNo }); return r; });
}

function createOrder(data) {
  var now = new Date().toISOString();
  var order = {
    orderNo: data.orderNo,
    date: data.date || '',
    client: data.client || '',
    name: data.name || '',
    amount: data.amount || 0,
    manager: data.manager || '',
    delivery: data.delivery || '',
    memo: data.memo || '',
    createdAt: now
  };
  if (typeof ORDER_MAP !== 'undefined') {
    ORDER_MAP[order.orderNo] = { name: order.name, date: order.date, client: order.client, amount: String(order.amount), manager: order.manager, delivery: order.delivery };
  }
  if (order.name) lsSet('wa-oc-' + order.orderNo, order.name);
  return orderPut(order);
}

function deleteOrder(orderNo) {
  if (typeof ORDER_MAP !== 'undefined') delete ORDER_MAP[orderNo];
  lsRemove('wa-oc-' + orderNo);
  return orderDel(orderNo);
}

/* 엑셀 → orders 일괄 동기화 (서버 bulk API) */
function syncOrderMapToDB() {
  if (typeof ORDER_MAP === 'undefined') return Promise.resolve();
  var keys = Object.keys(ORDER_MAP);
  if (keys.length === 0) return Promise.resolve();
  var records = keys.map(function (k) {
    var v = ORDER_MAP[k];
    return {
      orderNo: k,
      date: (typeof v === 'object' ? v.date : '') || '',
      client: (typeof v === 'object' ? v.client : '') || '',
      name: (typeof v === 'object' ? v.name : v) || '',
      amount: (typeof v === 'object' ? Number(v.amount) || 0 : 0),
      manager: (typeof v === 'object' ? v.manager : '') || '',
      delivery: (typeof v === 'object' ? v.delivery : '') || ''
    };
  });
  return apiFetch('/api/orders/bulk', { method: 'POST', body: JSON.stringify({ records: records }) });
}

/* orders DB → ORDER_MAP 동기화 (앱 시작 시) */
function loadOrdersToMap() {
  return orderGetAll().then(function (orders) {
    orders.forEach(function (o) {
      ORDER_MAP[o.orderNo] = { name: o.name, date: o.date, client: o.client, amount: String(o.amount || ''), manager: o.manager, delivery: o.delivery };
      if (o.name) lsSet('wa-oc-' + o.orderNo, o.name);
    });
    return orders;
  });
}

/* ─── 체크리스트 ─── */
function chkGetByProject(pid) {
  return apiFetch('/api/checklists?projectId=' + pid).then(function (r) {
    // 서버는 phase별 row에 items JSONB 배열 → 클라이언트는 개별 항목 기대 → flat 변환
    var flat = [];
    (r.data || []).forEach(function (row) {
      var rc = toCamel(row);
      var items = rc.items;
      if (typeof items === 'string') try { items = JSON.parse(items); } catch (e) { items = []; }
      if (Array.isArray(items) && items.length > 0) {
        items.forEach(function (it, idx) {
          flat.push({
            id: rc.id + '::' + idx,
            _parentId: rc.id,
            projectId: rc.projectId,
            phase: rc.phase,
            text: it.text || '',
            done: !!it.done,
            doneDate: it.doneDate || null,
            doneBy: it.doneBy || null,
            dueDate: it.dueDate || '',
            order: it.order !== undefined ? it.order : idx
          });
        });
      } else if (!items || items.length === 0) {
        if (rc.text) flat.push(rc);
      }
    });
    return flat;
  });
}
function chkPut(item) {
  var isNew = !item.id || item._isNew;
  if (isNew) {
    delete item._isNew;
    return apiFetch('/api/checklists', { method: 'POST', body: JSON.stringify(item) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('checklist', 'created', { id: s && s.id, projectId: s && s.projectId }); return s; });
  }
  return apiFetch('/api/checklists/' + item.id, { method: 'PUT', body: JSON.stringify(item) })
    .then(function (r) { return toCamel(r.data); })
    .catch(function (err) {
      if (err && (err.status === 404 || (err.data && err.data.error === 'NOT_FOUND'))) {
        return apiFetch('/api/checklists', { method: 'POST', body: JSON.stringify(item) }).then(function (r) { return toCamel(r.data); });
      }
      throw err;
    })
    .then(function (s) { _emitBus('checklist', 'updated', { id: s && s.id, projectId: s && s.projectId }); return s; });
}
function chkDel(id) {
  // flat id (chk-xxx::N) → 부모 row에서 해당 항목 제거
  var sep = id.indexOf('::');
  if (sep < 0) {
    return apiFetch('/api/checklists/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function () { return null; });
  }
  var parentId = id.slice(0, sep), idx = parseInt(id.slice(sep + 2), 10);
  return apiFetch('/api/checklists/' + encodeURIComponent(parentId)).then(function (r) {
    var row = r.data;
    var items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
    if (idx < 0 || idx >= items.length) return null;
    items.splice(idx, 1);
    if (items.length === 0) return apiFetch('/api/checklists/' + encodeURIComponent(parentId), { method: 'DELETE' });
    return apiFetch('/api/checklists/' + encodeURIComponent(parentId), { method: 'PUT', body: JSON.stringify({ items: items }) });
  }).catch(function (err) {
    console.warn('[chkDel] fallback delete:', err);
    return null;
  });
}

function chkGetByPhase(projectId, phase) {
  return chkGetByProject(projectId).then(function (items) {
    return items.filter(function (i) { return i.phase === phase; });
  });
}

/* 토글 (서버 모드: 부모 row의 items 배열 갱신) */
function toggleCheckItem(id, doneBy, doneDate) {
  var sep = id.indexOf('::');
  if (sep < 0) return Promise.resolve(null);
  var parentId = id.slice(0, sep), idx = parseInt(id.slice(sep + 2), 10);
  return apiFetch('/api/checklists/' + encodeURIComponent(parentId)).then(function (r) {
    var row = r.data;
    var items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
    if (idx < 0 || idx >= items.length) return null;
    items[idx].done = !items[idx].done;
    items[idx].doneDate = items[idx].done ? (doneDate || localDate()) : null;
    items[idx].doneBy = items[idx].done ? (doneBy || '') : null;
    return apiFetch('/api/checklists/' + encodeURIComponent(parentId), { method: 'PUT', body: JSON.stringify({ items: items }) });
  }).catch(function (err) {
    console.warn('[toggleCheckItem] error:', err);
    return null;
  });
}

/* 체크리스트 항목 생성 — 기존 phase row에 항목 추가 */
function createCheckItem(data) {
  return apiFetch('/api/checklists?projectId=' + encodeURIComponent(data.projectId)).then(function (r) {
    var rows = r.data || [];
    var parentRow = rows.find(function (row) { return row.phase === data.phase; });
    var newItem = { text: data.text || '', done: false, doneDate: null, doneBy: null, dueDate: data.dueDate || '', order: 0 };
    if (parentRow) {
      var existing = parentRow.items;
      if (typeof existing === 'string') { try { existing = JSON.parse(existing); } catch (e) { existing = []; } }
      if (!Array.isArray(existing)) existing = [];
      var items = existing.slice();
      newItem.order = typeof data.order === 'number' ? data.order : items.length;
      items.push(newItem);
      return apiFetch('/api/checklists/' + encodeURIComponent(parentRow.id), { method: 'PUT', body: JSON.stringify({ items: items }) });
    } else {
      newItem.order = typeof data.order === 'number' ? data.order : 0;
      return apiFetch('/api/checklists', { method: 'POST', body: JSON.stringify({
        id: 'chk-' + uuid(), projectId: data.projectId, phase: data.phase, items: [newItem]
      }) });
    }
  }).then(function (r) { return toCamel(r.data); });
}

/* 프로젝트에 기본 체크리스트 일괄 생성 (phase별 items 배열로 묶어서 저장) */
function createDefaultChecklists(projectId) {
  var promises = [];
  Object.keys(DEFAULT_CHECKLIST).forEach(function (phase) {
    var items = DEFAULT_CHECKLIST[phase].map(function (text, idx) {
      return { text: text, done: false, doneDate: null, doneBy: null, order: idx };
    });
    promises.push(apiFetch('/api/checklists', { method: 'POST', body: JSON.stringify({
      id: 'chk-' + uuid(), projectId: projectId, phase: phase, items: items
    }) }).then(function (r) { return toCamel(r.data); }));
  });
  return Promise.all(promises);
}

/* ═══ 개발 백로그 (project_dev_items, 칸반) — PRD Phase 1 ═══ */
function devItemsByProject(pid) {
  return apiFetch('/api/dev-items?projectId=' + encodeURIComponent(pid))
    .then(function (r) { return toCamelArray(r.data); })
    .catch(function () { return []; });
}
function devItemCreate(item) {
  return apiFetch('/api/dev-items', { method: 'POST', body: JSON.stringify(item) })
    .then(function (r) { return toCamel(r.data); });
}
function devItemUpdate(id, patch) {
  return apiFetch('/api/dev-items/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(patch) })
    .then(function (r) { return toCamel(r.data); });
}
function devItemMove(id, status, sortOrder) {
  return apiFetch('/api/dev-items/' + encodeURIComponent(id) + '/move', { method: 'PUT', body: JSON.stringify({ status: status, sortOrder: sortOrder || 0 }) })
    .then(function (r) { return toCamel(r.data); });
}
function devItemDel(id) {
  return apiFetch('/api/dev-items/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function () { return null; });
}

/* ═══ 사전검토 (prestudies) — 프로젝트 이전 단계 독립 모듈 ═══ */
function prestudyGetAll(params) {
  var qs = [];
  if (params) {
    Object.keys(params).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') qs.push(k + '=' + encodeURIComponent(params[k]));
    });
  }
  return apiFetch('/api/prestudies' + (qs.length ? '?' + qs.join('&') : ''))
    .then(function (r) { return toCamelArray(r.data); })
    .catch(function () { return []; });
}
function prestudyGet(id) {
  return apiFetch('/api/prestudies/' + encodeURIComponent(id)).then(function (r) { return toCamel(r.data); });
}
/* 담당자·참여자 선택용 테넌트 활성 사용자 [{id, name}] — 1회 조회 후 캐시 */
var _prestudyMembersCache = null;
function prestudyMembers() {
  if (_prestudyMembersCache) return Promise.resolve(_prestudyMembersCache);
  return apiFetch('/api/prestudies/members')
    .then(function (r) { _prestudyMembersCache = r.data || []; return _prestudyMembersCache; })
    .catch(function () { return []; });
}
function prestudyPut(item) {
  if (item.id) {
    return apiFetch('/api/prestudies/' + encodeURIComponent(item.id), { method: 'PUT', body: JSON.stringify(item) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('prestudy', 'updated', { id: s && s.id }); return s; });
  }
  return apiFetch('/api/prestudies', { method: 'POST', body: JSON.stringify(item) })
    .then(function (r) { var s = toCamel(r.data); _emitBus('prestudy', 'created', { id: s && s.id }); return s; });
}
function prestudyMove(id, status, sortOrder) {
  return apiFetch('/api/prestudies/' + encodeURIComponent(id) + '/move', { method: 'PUT', body: JSON.stringify({ status: status, sortOrder: sortOrder || 0 }) })
    .then(function (r) { var s = toCamel(r.data); _emitBus('prestudy', 'updated', { id: id }); return s; });
}
function prestudyConvert(id, target, orderNo) {
  var body = { target: target };
  if (target === 'order' && orderNo) body.orderNo = orderNo;
  return apiFetch('/api/prestudies/' + encodeURIComponent(id) + '/convert', { method: 'POST', body: JSON.stringify(body) })
    .then(function (r) {
      _emitBus('prestudy', 'updated', { id: id });
      // 전환 결과가 프로젝트/수주이므로 해당 탭 캐시도 무효화
      _emitBus(target === 'order' ? 'order' : 'project', 'created', { id: id });
      return r.data;
    });
}
function prestudyDel(id) {
  return apiFetch('/api/prestudies/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function () { _emitBus('prestudy', 'deleted', { id: id }); })
    .catch(function () { return null; });
}

/* ═══ 회의 관리 (meetings + action_items) — PRD Phase 2 ═══ */
function meetingsByProject(pid) {
  return apiFetch('/api/meetings?projectId=' + encodeURIComponent(pid))
    .then(function (r) {
      return (r.data || []).map(function (m) {
        var c = toCamel(m);
        c.actionItems = (m.action_items || []).map(toCamel);
        return c;
      });
    })
    .catch(function () { return []; });
}
function meetingCreate(item) {
  return apiFetch('/api/meetings', { method: 'POST', body: JSON.stringify(item) })
    .then(function (r) { return toCamel(r.data); });
}
function meetingUpdate(id, patch) {
  return apiFetch('/api/meetings/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(patch) })
    .then(function (r) { return toCamel(r.data); });
}
function meetingDel(id) {
  return apiFetch('/api/meetings/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function () { return null; });
}
function meetingActionAdd(mid, item) {
  return apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/actions', { method: 'POST', body: JSON.stringify(item) })
    .then(function (r) { return toCamel(r.data); });
}
function meetingActionUpdate(mid, aid, patch) {
  return apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/actions/' + encodeURIComponent(aid), { method: 'PUT', body: JSON.stringify(patch) })
    .then(function (r) { return toCamel(r.data); });
}
function meetingActionDel(mid, aid) {
  return apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/actions/' + encodeURIComponent(aid), { method: 'DELETE' }).catch(function () { return null; });
}
function meetingActionConvert(mid, aid, target) {
  return apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/actions/' + encodeURIComponent(aid) + '/convert', { method: 'POST', body: JSON.stringify({ target: target }) })
    .then(function (r) { return r.data; });
}

/* ═══ 요소기술 (tech_assets + tech_logs) — 기반기술 자산 ═══ */
function techGetAll(params) {
  var qs = [];
  if (params) {
    Object.keys(params).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') qs.push(k + '=' + encodeURIComponent(params[k]));
    });
  }
  return apiFetch('/api/tech' + (qs.length ? '?' + qs.join('&') : ''))
    .then(function (r) { return toCamelArray(r.data); })
    .catch(function () { return []; });
}
function techGet(id) {
  return apiFetch('/api/tech/' + encodeURIComponent(id)).then(function (r) { return toCamel(r.data); });
}
function techStacks() {
  return apiFetch('/api/tech/stacks').then(function (r) { return r.data || []; }).catch(function () { return []; });
}
var _techMembersCache = null;
function techMembers() {
  if (_techMembersCache) return Promise.resolve(_techMembersCache);
  return apiFetch('/api/tech/members')
    .then(function (r) { _techMembersCache = r.data || []; return _techMembersCache; })
    .catch(function () { return []; });
}
function techPut(item) {
  if (item.id) {
    return apiFetch('/api/tech/' + encodeURIComponent(item.id), { method: 'PUT', body: JSON.stringify(item) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('tech', 'updated', { id: s && s.id }); return s; });
  }
  return apiFetch('/api/tech', { method: 'POST', body: JSON.stringify(item) })
    .then(function (r) { var s = toCamel(r.data); _emitBus('tech', 'created', { id: s && s.id }); return s; });
}
function techDel(id) {
  return apiFetch('/api/tech/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function () { _emitBus('tech', 'deleted', { id: id }); })
    .catch(function () { return null; });
}
/* 개발일지 */
function techLogsGet(techId) {
  return apiFetch('/api/tech/' + encodeURIComponent(techId) + '/logs')
    .then(function (r) { return toCamelArray(r.data); })
    .catch(function () { return []; });
}
function techLogAdd(techId, log) {
  return apiFetch('/api/tech/' + encodeURIComponent(techId) + '/logs', { method: 'POST', body: JSON.stringify(log) })
    .then(function (r) { _emitBus('tech', 'updated', { id: techId }); return toCamel(r.data); });
}
function techLogDel(techId, logId) {
  return apiFetch('/api/tech/' + encodeURIComponent(techId) + '/logs/' + encodeURIComponent(logId), { method: 'DELETE' })
    .then(function () { _emitBus('tech', 'updated', { id: techId }); })
    .catch(function () { return null; });
}

/* 단계별 완료율 계산 */
function calcPhaseProgress(projectId, phase) {
  return chkGetByPhase(projectId, phase).then(function (items) {
    if (!items.length) return { total: 0, done: 0, pct: 0 };
    var done = items.filter(function (i) { return i.done; }).length;
    return { total: items.length, done: done, pct: Math.round(done / items.length * 100) };
  });
}

/* 전 단계 완료율 한 번에 계산 */
function calcAllPhaseProgress(projectId) {
  return chkGetByProject(projectId).then(function (items) {
    var result = {};
    var phases = typeof PROJ_PHASE !== 'undefined' ? Object.keys(PROJ_PHASE) : [];
    phases.forEach(function (ph) {
      var phItems = items.filter(function (i) { return i.phase === ph; });
      var done = phItems.filter(function (i) { return i.done; }).length;
      result[ph] = { total: phItems.length, done: done, pct: phItems.length ? Math.round(done / phItems.length * 100) : 0 };
    });
    return result;
  });
}

/* 단계 전환 (게이트 체크) */
function advancePhase(projectId, targetPhase) {
  return projGet(projectId).then(function (proj) {
    if (!proj) return null;
    var curPhase = proj.currentPhase || 'order';
    return calcPhaseProgress(projectId, curPhase).then(function (prog) {
      var result = { proj: proj, fromPhase: curPhase, toPhase: targetPhase, gatePass: true, progress: prog };
      if (prog.total > 0 && prog.pct < 100) {
        result.gatePass = false;
      }
      return result;
    });
  });
}

/* 단계 전환 실행 (강제 포함) */
function executePhaseTransition(projectId, targetPhase) {
  return projGet(projectId).then(function (proj) {
    if (!proj) return null;
    if (!proj.phases) proj.phases = {};
    var curPhase = proj.currentPhase || 'order';
    if (proj.phases[curPhase]) {
      proj.phases[curPhase].status = 'done';
      if (!proj.phases[curPhase].endDate) proj.phases[curPhase].endDate = localDate();
    }
    proj.currentPhase = targetPhase;
    if (!proj.phases[targetPhase]) proj.phases[targetPhase] = {};
    proj.phases[targetPhase].status = 'active';
    if (!proj.phases[targetPhase].startDate) proj.phases[targetPhase].startDate = localDate();
    proj.updatedAt = new Date().toISOString();
    return projPut(proj);
  });
}

/* 수주에서 프로젝트 + 마일스톤 + 체크리스트 1회 호출 생성 */
function createProjectFromOrder(order) {
  var projId = 'proj-' + uuid();
  var startDate = order.date || localDate();
  var endDate = order.delivery || '';
  var defaultPhases = { order: { status: 'done', startDate: startDate, endDate: startDate }, design: { status: 'waiting', startDate: '', endDate: '' }, manufacture: { status: 'waiting', startDate: '', endDate: '' }, inspect: { status: 'waiting', startDate: '', endDate: '' }, deliver: { status: 'waiting', startDate: '', endDate: '' }, as: { status: 'waiting', startDate: '', endDate: '' } };
  var phaseKeys = ['order', 'design', 'manufacture', 'inspect', 'deliver', 'as'];
  var phaseLabels = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  var milestones = phaseKeys.map(function (pk, idx) {
    var label = phaseLabels[pk] ? phaseLabels[pk].label : pk;
    return { id: 'ms-' + uuid(), name: label, startDate: '', endDate: '', status: 'waiting', order: idx };
  });
  var checklists = phaseKeys.map(function (pk) {
    var items = (DEFAULT_CHECKLIST[pk] || []).map(function (text, idx) {
      return { text: text, done: false, doneDate: null, doneBy: null, order: idx };
    });
    return { id: 'chk-' + uuid(), phase: pk, items: items };
  });
  var payload = {
    id: projId, orderNo: order.orderNo, name: order.name || order.orderNo,
    startDate: startDate, endDate: endDate, status: 'active', progress: 0,
    estimatedHours: 0, assignees: order.manager ? [order.manager] : [],
    dependencies: [], color: typeof COL !== 'undefined' ? COL[Math.floor(Math.random() * COL.length)] : '#3B82F6',
    memo: '', currentPhase: 'design', phases: defaultPhases,
    milestones: milestones, checklists: checklists
  };
  return apiFetch('/api/projects/full', { method: 'POST', body: JSON.stringify(payload) })
    .then(function (r) { return toCamel(r.data); });
}

/* ─── 이슈 ─── */
function issueGetAll() { return apiFetch('/api/issues').then(function (r) { return toCamelArray(r.data); }); }
function issueGet(id) { return apiFetch('/api/issues/' + id).then(function (r) { return toCamel(r.data); }); }
function issuePut(issue) {
  var isNew = !issue.id || issue._isNew;
  if (isNew) {
    delete issue._isNew;
    return apiFetch('/api/issues', { method: 'POST', body: JSON.stringify(issue) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('issue', 'created', { id: s && s.id, projectId: s && s.projectId, orderNo: s && s.orderNo }); return s; });
  }
  return apiFetch('/api/issues/' + issue.id, { method: 'PUT', body: JSON.stringify(issue) })
    .then(function (r) { return toCamel(r.data); })
    .catch(function (err) {
      if (err && (err.status === 404 || (err.data && err.data.error === 'NOT_FOUND'))) {
        return apiFetch('/api/issues', { method: 'POST', body: JSON.stringify(issue) }).then(function (r) { return toCamel(r.data); });
      }
      throw err;
    })
    .then(function (s) { _emitBus('issue', 'updated', { id: s && s.id, projectId: s && s.projectId, orderNo: s && s.orderNo }); return s; });
}
function issueDel(id) {
  return apiFetch('/api/issues/' + id, { method: 'DELETE' })
    .then(function (r) { _emitBus('issue', 'deleted', { id: id }); return r; });
}
function issueGetByProject(pid) { return apiFetch('/api/issues?projectId=' + pid).then(function (r) { return toCamelArray(r.data); }); }
function issueGetByOrder(orderNo) { return apiFetch('/api/issues?orderNo=' + encodeURIComponent(orderNo)).then(function (r) { return toCamelArray(r.data); }); }

/* ─── A/S 접수 ─── */
function asGetAll(params) {
  var qs = '';
  if (params && typeof params === 'object') {
    var pairs = Object.keys(params).filter(function (k) { return params[k] != null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    if (pairs.length) qs = '?' + pairs.join('&');
  }
  return apiFetch('/api/as-tickets' + qs).then(function (r) { return toCamelArray(r.data); });
}
function asGet(id) { return apiFetch('/api/as-tickets/' + id).then(function (r) { return toCamel(r.data); }); }
function asPut(ticket) {
  var isNew = !ticket.id || ticket._isNew;
  if (isNew) {
    delete ticket._isNew;
    return apiFetch('/api/as-tickets', { method: 'POST', body: JSON.stringify(ticket) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('as', 'created', { id: s && s.id, ticketNo: s && s.ticketNo }); return s; });
  }
  return apiFetch('/api/as-tickets/' + ticket.id, { method: 'PUT', body: JSON.stringify(ticket) })
    .then(function (r) { return toCamel(r.data); })
    .then(function (s) { _emitBus('as', 'updated', { id: s && s.id, ticketNo: s && s.ticketNo }); return s; });
}
function asDel(id) {
  return apiFetch('/api/as-tickets/' + id, { method: 'DELETE' })
    .then(function (r) { _emitBus('as', 'deleted', { id: id, mode: 'soft' }); return r; });
}
function asDelHard(id) {
  return apiFetch('/api/as-tickets/' + id + '/hard', { method: 'DELETE' })
    .then(function (r) { _emitBus('as', 'deleted', { id: id, mode: 'hard' }); return r; });
}
function asRestore(id) {
  return apiFetch('/api/as-tickets/' + id + '/restore', { method: 'POST' })
    .then(function (r) { _emitBus('as', 'updated', { id: id, action: 'restore' }); return toCamel(r.data); });
}
function asEmailReport(ticketId, payload) {
  return apiFetch('/api/as-tickets/' + ticketId + '/email-report', {
    method: 'POST',
    body: JSON.stringify(payload || {})
  });
}

/* ─── A/S 마스터 (장비/컨택) + 재발 이력 ─── */
function asEquipmentSearch(params) {
  var qs = '';
  if (params && typeof params === 'object') {
    var pairs = Object.keys(params).filter(function (k) { return params[k] != null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    if (pairs.length) qs = '?' + pairs.join('&');
  }
  return apiFetch('/api/as-masters/equipment' + qs).then(function (r) { return toCamelArray(r.data); });
}
function asEquipmentBySerial(serial) {
  return apiFetch('/api/as-masters/equipment/by-serial/' + encodeURIComponent(serial))
    .then(function (r) { return toCamel(r.data); })
    .catch(function (err) {
      if (err && err.status === 404) return null;
      throw err;
    });
}
function asContactsSearch(params) {
  var qs = '';
  if (params && typeof params === 'object') {
    var pairs = Object.keys(params).filter(function (k) { return params[k] != null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    if (pairs.length) qs = '?' + pairs.join('&');
  }
  return apiFetch('/api/as-masters/contacts' + qs).then(function (r) { return toCamelArray(r.data); });
}
function asContactPut(contact) {
  var isNew = !contact.id || contact._isNew;
  if (isNew) {
    delete contact._isNew;
    return apiFetch('/api/as-masters/contacts', { method: 'POST', body: JSON.stringify(contact) })
      .then(function (r) { return toCamel(r.data); });
  }
  return apiFetch('/api/as-masters/contacts/' + contact.id, { method: 'PUT', body: JSON.stringify(contact) })
    .then(function (r) { return toCamel(r.data); });
}
function asRecurrencesGet(ticketId) {
  return apiFetch('/api/as-tickets/' + ticketId + '/recurrences')
    .then(function (r) { return { data: toCamelArray(r.data), context: toCamel(r.context), total: r.total }; });
}

/* ─── A/S AI 분석 (Claude) — v13.72: 120s 타임아웃 (Claude opus-4-7 응답 시간 대응) ─── */
function asAiAnalyze(payload) {
  return apiFetch('/api/as-ai/analyze', { method: 'POST', body: JSON.stringify(payload || {}), timeoutMs: 120000 })
    .then(function (r) { return r; });
}
function asAiSimilar(ticketId) {
  return apiFetch('/api/as-ai/similar/' + ticketId, { method: 'POST', body: JSON.stringify({}), timeoutMs: 120000 })
    .then(function (r) { return r; });
}
function asAiWeeklyInsight() {
  return apiFetch('/api/as-ai/weekly-insight', { timeoutMs: 120000 })
    .then(function (r) { return r; });
}

/* ─── A/S 통계 ─── */
function asStatsGet(params) {
  var qs = '';
  if (params && typeof params === 'object') {
    var pairs = Object.keys(params).filter(function (k) { return params[k] != null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    if (pairs.length) qs = '?' + pairs.join('&');
  }
  return apiFetch('/api/as-stats' + qs).then(function (r) { return r.data; });
}
function asStatsWeeklyDigest(send) {
  var qs = send ? '?send=1' : '';
  return apiFetch('/api/as-stats/weekly-digest' + qs).then(function (r) { return r.data; });
}
function createASTicket(data) {
  var now = new Date().toISOString();
  var ticket = {
    id: 'as-' + uuid(),
    customerName: data.customerName || '',
    siteLine: data.siteLine || '',
    customerContact: data.customerContact || '',
    equipmentNo: data.equipmentNo || '',
    equipmentModel: data.equipmentModel || '',
    serialNo: data.serialNo || '',
    installDate: data.installDate || null,
    warrantyStatus: data.warrantyStatus || '',
    receivedAt: data.receivedAt || now,
    channel: data.channel || 'phone',
    priority: data.priority || 'P3',
    category: data.category || '',
    method: data.method || '',
    issueSummary: data.issueSummary || '',
    reproduction: data.reproduction || '',
    frequency: data.frequency || '',
    impactScope: data.impactScope || '',
    initialAnalysis: data.initialAnalysis || '',
    status: 'received',
    projectId: data.projectId || '',
    orderNo: data.orderNo || '',
    createdAt: now,
    _isNew: true
  };
  return asPut(ticket);
}
function updateASTicket(id, updates) {
  return asGet(id).then(function (t) {
    if (!t) return null;
    Object.assign(t, updates);
    t.updatedAt = new Date().toISOString();
    return asPut(t);
  });
}

/* ─── A/S 카테고리 마스터 (관리자 관리) ─── */
function asCategoryGetAll(includeInactive) {
  var qs = includeInactive ? '?all=1' : '';
  return apiFetch('/api/as-categories' + qs).then(function (r) { return toCamelArray(r.data); });
}
function asCategoryPut(cat) {
  var isNew = !cat.id || cat._isNew;
  if (isNew) {
    delete cat._isNew;
    return apiFetch('/api/as-categories', { method: 'POST', body: JSON.stringify(cat) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('asCategory', 'created', { id: s && s.id, code: s && s.code }); return s; });
  }
  return apiFetch('/api/as-categories/' + cat.id, { method: 'PUT', body: JSON.stringify(cat) })
    .then(function (r) { return toCamel(r.data); })
    .then(function (s) { _emitBus('asCategory', 'updated', { id: s && s.id, code: s && s.code }); return s; });
}
function asCategoryDel(id, hard) {
  var qs = hard ? '?hard=1' : '';
  return apiFetch('/api/as-categories/' + id + qs, { method: 'DELETE' })
    .then(function (r) { _emitBus('asCategory', 'deleted', { id: id }); return r; });
}

/* ─── A/S 할당·로그·부품·첨부·서명 — 응답 정규화 헬퍼 ───
 * toCamel은 최상위 키만 변환하고 NUMERIC을 문자열로 두기 때문에,
 * A/S 자식 컬렉션과 ticket의 NUMERIC을 명시적으로 정규화한다. */
function _asNum(o, keys) {
  if (!o) return o;
  keys.forEach(function (k) { if (typeof o[k] === 'string') o[k] = parseFloat(o[k]) || 0; });
  return o;
}
function _asNormAsg(a)  { return _asNum(toCamel(a), ['durationH']); }
function _asNormLog(l)  { return _asNum(toCamel(l), ['durationH']); }
function _asNormPart(p) { return _asNum(toCamel(p), ['qty', 'unitPrice', 'amount']); }
function _asNormTicket(t) {
  if (!t) return t;
  t = _asNum(t, ['frequencyCount']);
  if (Array.isArray(t.assignments))    t.assignments    = t.assignments.map(_asNormAsg);
  if (Array.isArray(t.activityLogs))   t.activityLogs   = t.activityLogs.map(_asNormLog);
  if (Array.isArray(t.parts))          t.parts          = t.parts.map(_asNormPart);
  if (Array.isArray(t.attachments))    t.attachments    = toCamelArray(t.attachments);
  if (Array.isArray(t.signatures))     t.signatures     = toCamelArray(t.signatures);
  return t;
}

/* ─── A/S 할당 (as_assignments) ─── */
function asGetExpand(id) {
  return apiFetch('/api/as-tickets/' + id + '?expand=1').then(function (r) { return _asNormTicket(toCamel(r.data)); });
}
function asAssignmentGetAll(ticketId) {
  return apiFetch('/api/as-tickets/' + ticketId + '/assignments').then(function (r) { return (r.data || []).map(_asNormAsg); });
}
function asAssignmentPut(ticketId, asg) {
  var isNew = !asg.id || asg._isNew;
  if (isNew) {
    delete asg._isNew;
    return apiFetch('/api/as-tickets/' + ticketId + '/assignments', { method: 'POST', body: JSON.stringify(asg) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('as', 'updated', { id: ticketId, action: 'assign' }); return s; });
  }
  return apiFetch('/api/as-tickets/' + ticketId + '/assignments/' + asg.id, { method: 'PUT', body: JSON.stringify(asg) })
    .then(function (r) { return toCamel(r.data); })
    .then(function (s) { _emitBus('as', 'updated', { id: ticketId, action: 'assign-update' }); return s; });
}
function asAssignmentDel(ticketId, aid) {
  return apiFetch('/api/as-tickets/' + ticketId + '/assignments/' + aid, { method: 'DELETE' })
    .then(function (r) { _emitBus('as', 'updated', { id: ticketId, action: 'assign-remove' }); return r; });
}

/* ─── A/S 활동로그 (as_activity_logs) ─── */
function asLogGetAll(ticketId) {
  return apiFetch('/api/as-tickets/' + ticketId + '/logs').then(function (r) { return (r.data || []).map(_asNormLog); });
}
function asLogPut(ticketId, log) {
  var isNew = !log.id || log._isNew;
  if (isNew) {
    delete log._isNew;
    return apiFetch('/api/as-tickets/' + ticketId + '/logs', { method: 'POST', body: JSON.stringify(log) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('as', 'updated', { id: ticketId, action: 'log-add' }); return s; });
  }
  return apiFetch('/api/as-tickets/' + ticketId + '/logs/' + log.id, { method: 'PUT', body: JSON.stringify(log) })
    .then(function (r) { return toCamel(r.data); })
    .then(function (s) { _emitBus('as', 'updated', { id: ticketId, action: 'log-update' }); return s; });
}
function asLogDel(ticketId, lid) {
  return apiFetch('/api/as-tickets/' + ticketId + '/logs/' + lid, { method: 'DELETE' })
    .then(function (r) { _emitBus('as', 'updated', { id: ticketId, action: 'log-remove' }); return r; });
}

/* ─── A/S 부품 (as_parts) ─── */
function asPartGetAll(ticketId) {
  return apiFetch('/api/as-tickets/' + ticketId + '/parts').then(function (r) { return (r.data || []).map(_asNormPart); });
}
function asPartPut(ticketId, part) {
  var isNew = !part.id || part._isNew;
  if (isNew) {
    delete part._isNew;
    return apiFetch('/api/as-tickets/' + ticketId + '/parts', { method: 'POST', body: JSON.stringify(part) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('as', 'updated', { id: ticketId, action: 'part-add' }); return s; });
  }
  return apiFetch('/api/as-tickets/' + ticketId + '/parts/' + part.id, { method: 'PUT', body: JSON.stringify(part) })
    .then(function (r) { return toCamel(r.data); })
    .then(function (s) { _emitBus('as', 'updated', { id: ticketId, action: 'part-update' }); return s; });
}
function asPartDel(ticketId, pid) {
  return apiFetch('/api/as-tickets/' + ticketId + '/parts/' + pid, { method: 'DELETE' })
    .then(function (r) { _emitBus('as', 'updated', { id: ticketId, action: 'part-remove' }); return r; });
}

/* ─── A/S 첨부 (as_attachments) ─── */
function asAttachmentGetAll(ticketId) {
  return apiFetch('/api/as-tickets/' + ticketId + '/attachments').then(function (r) { return toCamelArray(r.data); });
}
function asAttachmentPut(ticketId, att) {
  return apiFetch('/api/as-tickets/' + ticketId + '/attachments', { method: 'POST', body: JSON.stringify(att) })
    .then(function (r) { var s = toCamel(r.data); _emitBus('as', 'updated', { id: ticketId, action: 'attach-add' }); return s; });
}
function asAttachmentDel(ticketId, aid) {
  return apiFetch('/api/as-tickets/' + ticketId + '/attachments/' + aid, { method: 'DELETE' })
    .then(function (r) { _emitBus('as', 'updated', { id: ticketId, action: 'attach-remove' }); return r; });
}

/* ─── A/S 서명·CSAT (as_signatures) UPSERT ─── */
function asSignaturePut(ticketId, sig) {
  return apiFetch('/api/as-tickets/' + ticketId + '/signatures', { method: 'POST', body: JSON.stringify(sig) })
    .then(function (r) { var s = toCamel(r.data); _emitBus('as', 'updated', { id: ticketId, action: 'sign-' + (sig.role || '') }); return s; });
}
function asSignatureDel(ticketId, sid) {
  return apiFetch('/api/as-tickets/' + ticketId + '/signatures/' + sid, { method: 'DELETE' })
    .then(function (r) { _emitBus('as', 'updated', { id: ticketId, action: 'sign-remove' }); return r; });
}

/* ─── A/S → 이슈 양방향 연계 ─── */
function asLinkIssue(ticketId, issueId) {
  var body = issueId ? { issueId: issueId } : {};
  return apiFetch('/api/as-tickets/' + ticketId + '/link-issue', { method: 'POST', body: JSON.stringify(body) })
    .then(function (r) {
      _emitBus('as', 'updated', { id: ticketId, action: 'link-issue' });
      if (r && r.issueId) _emitBus('issue', 'created', { id: r.issueId });
      return { ticket: toCamel(r.data), issueId: r.issueId };
    });
}

function createIssue(data) {
  var now = new Date().toISOString();
  var issue = {
    id: 'iss-' + uuid(),
    projectId: data.projectId || '',
    orderNo: data.orderNo || '',
    phase: data.phase || 'order',
    dept: data.dept || '',
    title: data.title || '',
    type: data.type || 'etc',
    urgency: data.urgency || 'normal',
    status: 'open',
    reportDate: data.reportDate || localDate(),
    reporter: data.reporter || '',
    assignees: data.assignees || [],
    description: data.description || '',
    resolvedDate: null,
    resolution: '',
    tags: data.tags || [],
    createdAt: now,
    _isNew: true
  };
  return issuePut(issue);
}

function updateIssue(id, updates) {
  return issueGet(id).then(function (issue) {
    if (!issue) return null;
    Object.assign(issue, updates);
    issue.updatedAt = new Date().toISOString();
    return issuePut(issue);
  });
}

function deleteIssueCascade(id) {
  return issueLogGetByIssue(id).then(function (logs) {
    return Promise.all(logs.map(function (l) { return issueLogDel(l.id); }));
  }).then(function () {
    return issueDel(id);
  });
}

/* ─── 이슈 대응 이력 ─── */
function issueLogGetByIssue(issueId) { return apiFetch('/api/issues/' + issueId + '/logs').then(function (r) { return toCamelArray(r.data); }); }
function issueLogPut(log) {
  return apiFetch('/api/issues/' + log.issueId + '/logs', { method: 'POST', body: JSON.stringify(log) }).then(function (r) { return toCamel(r.data); });
}
function issueLogDel(id) {
  return apiFetch('/api/issues/_/logs/' + id, { method: 'DELETE' });
}

function createIssueLog(data) {
  var now = new Date();
  var log = {
    id: 'ilog-' + uuid(),
    issueId: data.issueId || '',
    date: data.date || localDate(),
    time: data.time || (String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')),
    type: data.type || '기타',
    author: data.author || '',
    dept: data.dept || '',
    content: data.content || '',
    attachmentNote: data.attachmentNote || ''
  };
  return issueLogPut(log);
}

/* ─── 진척률 히스토리 ─── */
function getProgressHistory(pid) { return apiFetch('/api/progress?projectId=' + pid).then(function (r) { return toCamelArray(r.data); }); }
function saveProgressSnapshot(pid, progress, actualHours) {
  return apiFetch('/api/progress', { method: 'POST', body: JSON.stringify({ projectId: pid, date: localDate(), progress: progress, actualHours: actualHours }) });
}

/* ─── 업무일지 아카이브 (weeks) ─── */
function wkGetAll() { return apiFetch('/api/archives').then(function (r) { return toCamelArray(r.data); }); }
function wkGet(id) { return apiFetch('/api/archives/' + encodeURIComponent(id)).then(function (r) { return toCamel(r.data); }); }
function wkPut(data) { return apiFetch('/api/archives', { method: 'POST', body: JSON.stringify(data) }).then(function (r) { return toCamel(r.data); }); }
function wkDel(id) { return apiFetch('/api/archives/' + encodeURIComponent(id), { method: 'DELETE' }); }

/* ─── 업무일지 레코드 (서버 DB 전용) ─── */
function _toWrRecord(r) {
  return {
    id: r.id, date: r.date, name: r.name,
    orderNo: r.order_no, hours: typeof r.hours === 'string' ? parseFloat(r.hours) || 0 : r.hours || 0,
    taskType: r.task_type, abbr: r.abbr, content: r.content,
    ocmt: r.ocmt, oclient: r.oclient, dept: r.dept, userId: r.user_id
  };
}
function wrGetAll() {
  return apiFetch('/api/archives/records?limit=50000&all=true').then(function (r) {
    return (r.data || []).map(_toWrRecord);
  });
}
function wrCount() {
  return apiFetch('/api/archives/records/count').then(function (r) { return r.data.count; });
}
function wrBulkPut(records) {
  return apiFetch('/api/archives/records/bulk', { method: 'POST', body: JSON.stringify({ records: records }) });
}
function wrClear() {
  return apiFetch('/api/archives/records', { method: 'DELETE' });
}
function wrUpdateRecords(records) {
  return apiFetch('/api/archives/records/batch', { method: 'PATCH', body: JSON.stringify({ updates: records }) });
}
function wrDeleteRecords(remainingRecords, deletedIds) {
  if (deletedIds && deletedIds.length) {
    return apiFetch('/api/archives/records/batch', { method: 'DELETE', body: JSON.stringify({ ids: deletedIds }) });
  }
  return wrClear().then(function () { return wrBulkPut(remainingRecords); });
}

/* ═══ 아카이브 전체 레코드 읽기 (캐시 적용, 서버 API) ═══ */
function readAllArchiveRecords() {
  var now = Date.now();
  if (_archiveCache.data && (now - _archiveCache.ts) < ARCHIVE_CACHE_TTL) {
    return Promise.resolve(_archiveCache.data);
  }
  return wrGetAll().then(function (records) {
    _archiveCache.data = records;
    _archiveCache.ts = Date.now();
    return records;
  });
}

/* ═══ 진척률 자동 산출 (아카이브 연동) ═══ */
function calcProgressFromArchive() {
  return readAllArchiveRecords().then(function (records) {
    // 수주번호 × 담당자명 별 시간 (멤버 필터는 autoUpdateProgress에서 적용)
    var byOrderName = {};
    records.forEach(function (r) {
      if (!r.orderNo) return;
      var key = r.orderNo.trim();
      var nm = r.name || '';
      if (!byOrderName[key]) byOrderName[key] = {};
      byOrderName[key][nm] = (byOrderName[key][nm] || 0) + (r.hours || 0);
    });
    return byOrderName;
  });
}

// 마일스톤 보고 진척률(가중평균)을 프로젝트 진척률로 사용. 보고 이력 없으면 시간기반 폴백.
// 투입시간(actual_hours)은 항상 멤버 한정으로 집계.
function autoUpdateProgress() {
  return Promise.all([
    calcProgressFromArchive(),
    (typeof projMembersAll === 'function' ? projMembersAll().catch(function () { return {}; }) : Promise.resolve({})),
    (typeof msGetAll === 'function' ? msGetAll().catch(function () { return []; }) : Promise.resolve([]))
  ]).then(function (arr) {
    var byOrderName = arr[0];
    var membersByProj = arr[1] || {};
    var allMs = arr[2] || [];
    // 프로젝트별 마일스톤 그룹
    var msByProj = {};
    allMs.forEach(function (m) {
      if (!m.projectId) return;
      (msByProj[m.projectId] = msByProj[m.projectId] || []).push(m);
    });
    // 마일스톤 보고 진척률 가중평균 (서버 롤업과 동일). 보고 이력 없으면 null.
    function reportedProgress(pid) {
      var list = msByProj[pid] || [];
      if (!list.length || !list.some(function (m) { return m.progressUpdatedAt != null; })) return null;
      var wsum = 0, psum = 0, psimple = 0, cnt = 0;
      list.forEach(function (m) {
        var at = m.assigneeTargets || {};
        var w = 0; Object.keys(at).forEach(function (k) { w += Number(at[k]) || 0; });
        var prog = Number(m.progress) || 0;
        wsum += w; psum += prog * w; psimple += prog; cnt++;
      });
      var v = wsum > 0 ? Math.round(psum / wsum) : Math.round(psimple / Math.max(cnt, 1));
      return Math.max(0, Math.min(100, v));
    }
    return projGetAll().then(function (projects) {
      var updates = [];
      projects.forEach(function (p) {
        // 멤버 한정 투입시간 집계
        var actual = 0;
        if (p.orderNo) {
          var byName = byOrderName[p.orderNo.trim()];
          if (byName) {
            // 등록 인원 = 활성 멤버 ∪ 지정 담당자(assignees). 수주번호만 같은 비등록자는 제외.
            var memberSet = {};
            var _msrc = membersByProj[p.id];
            if (_msrc) Object.keys(_msrc).forEach(function (n) { memberSet[n] = true; });
            if (Array.isArray(p.assignees)) p.assignees.forEach(function (n) { if (n) memberSet[n] = true; });
            var hasMembers = Object.keys(memberSet).length > 0;
            Object.keys(byName).forEach(function (nm) {
              if (hasMembers && !memberSet[nm]) return;
              actual += byName[nm];
            });
          }
        }
        actual = Math.round(actual * 10) / 10;
        // 진척률: 보고값 우선, 없으면 시간기반 폴백
        var reported = reportedProgress(p.id);
        var progress;
        if (reported != null) {
          progress = reported;
        } else if (p.estimatedHours && p.estimatedHours > 0 && actual > 0) {
          progress = Math.min(Math.round((actual / p.estimatedHours) * 100), PROGRESS_MAX);
        } else {
          progress = p.progress;   // 변경 없음
        }
        var progChanged = (progress != null && progress !== p.progress);
        var hoursChanged = (actual > 0 && Math.round((p.actualHours || 0) * 10) / 10 !== actual);
        if (!progChanged && !hoursChanged) return;
        updates.push({ id: p.id, progress: progress, actualHours: actual });
      });
      return Promise.all(updates.map(function (u) {
        return updateProject(u.id, { progress: u.progress, actualHours: u.actualHours });
      })).then(function () {
        return Promise.all(updates.map(function (u) {
          return saveProgressSnapshot(u.id, u.progress, u.actualHours);
        }));
      }).then(function () { return updates.length; });
    });
  });
}

/* ═══ Integration 1: 수주번호별 업무유형 분포 ═══ */
function calcTaskDistByOrder() {
  return readAllArchiveRecords().then(function (records) {
    var dist = {};
    records.forEach(function (r) {
      if (!r.orderNo || !r.abbr) return;
      var key = r.orderNo.trim();
      var abbr = r.abbr.trim().charAt(0).toUpperCase();
      if (!dist[key]) dist[key] = {};
      dist[key][abbr] = (dist[key][abbr] || 0) + (r.hours || 0);
    });
    return dist;
  });
}

/* ═══ Integration 4: 마일스톤별 실적 시간 집계 ═══ */
/* v13.61: opts.proj / opts.milestones 전달 시 중복 fetch 생략 (네트워크 2× 절감) */
function calcHoursByMilestone(projectId, opts) {
  opts = opts || {};
  var pProj = opts.proj ? Promise.resolve(opts.proj) : projGet(projectId);
  return pProj.then(function (proj) {
    if (!proj || !proj.orderNo) return {};
    var pMs = opts.milestones ? Promise.resolve(opts.milestones) : msGetByProject(projectId);
    // 투입실적은 프로젝트 등록 인원(활성 멤버)만 집계. 비멤버 기록은 outHours/outPeople로 분리.
    var pMem = opts.memberNames
      ? Promise.resolve(opts.memberNames)
      : (typeof projMembersGet === 'function'
          ? projMembersGet(projectId).then(function (ms) { return ms.map(function (m) { return m.userName; }).filter(Boolean); }).catch(function () { return []; })
          : Promise.resolve([]));
    return Promise.all([pMs, pMem]).then(function (msMem) {
      var milestones = msMem[0];
      var memberSet = {};
      (msMem[1] || []).forEach(function (n) { memberSet[n] = true; });
      // 프로젝트 등록 인원 = 활성 멤버 ∪ 프로젝트 지정 담당자(assignees). 수주번호만 같은 비등록자는 집계 제외.
      if (proj && Array.isArray(proj.assignees)) proj.assignees.forEach(function (n) { if (n) memberSet[n] = true; });
      var hasMembers = Object.keys(memberSet).length > 0;
      if (!milestones.length) return {};
      milestones.sort(function (a, b) { return (a.startDate || '') < (b.startDate || '') ? -1 : 1; });
      return readAllArchiveRecords().then(function (records) {
        var orderKey = proj.orderNo.trim();
        var msIds = {};
        milestones.forEach(function (ms) { msIds[ms.id] = true; });
        var result = {};
        milestones.forEach(function (ms) { result[ms.id] = { hours: 0, records: 0, name: ms.name, people: {}, untagged: 0, outHours: 0, outPeople: {} }; });
        var untagged = 0;
        function addRec(mid, r, isUntagged) {
          var hrs = r.hours || 0;
          var nm = r.name;
          var isMember = !hasMembers || (nm && !!memberSet[nm]);
          var bucket = result[mid];
          if (isMember) {
            bucket.hours += hrs;
            bucket.records += 1;
            if (isUntagged) { bucket.untagged += 1; untagged++; }
            if (nm) bucket.people[nm] = (bucket.people[nm] || 0) + hrs;
          } else {
            // 등록 인원이 아닌 기록 — 공식 지표 제외, '할당 외'로 분리 표시
            bucket.outHours += hrs;
            if (nm) bucket.outPeople[nm] = (bucket.outPeople[nm] || 0) + hrs;
          }
        }
        records.forEach(function (r) {
          if (!r.orderNo || r.orderNo.trim() !== orderKey) return;
          // 1순위: milestoneId 명시적 태깅
          if (r.milestoneId && msIds[r.milestoneId]) {
            addRec(r.milestoneId, r, false);
            return;
          }
          if (!r.date) return;
          var recDate = r.date.length === 8
            ? r.date.slice(0, 4) + '-' + r.date.slice(4, 6) + '-' + r.date.slice(6, 8)
            : r.date;
          // 2순위: 날짜 구간 매칭 (태깅 안 된 레코드용 fallback)
          var matched = false;
          for (var i = 0; i < milestones.length; i++) {
            var ms = milestones[i];
            if (ms.startDate && ms.endDate && recDate >= ms.startDate && recDate <= ms.endDate) {
              addRec(ms.id, r, true);
              matched = true;
              break;
            }
          }
          // 3순위: 가장 가까운 마일스톤 (구간 밖 레코드)
          if (!matched && milestones.length) {
            var bestIdx = 0;
            var bestDist = Infinity;
            for (var j = 0; j < milestones.length; j++) {
              var msEnd = milestones[j].endDate || milestones[j].startDate;
              if (!msEnd) continue;
              var d = Math.abs(daysDiff(recDate, msEnd));
              if (d < bestDist) { bestDist = d; bestIdx = j; }
            }
            addRec(milestones[bestIdx].id, r, true);
          }
        });
        Object.keys(result).forEach(function (k) {
          result[k].hours = Math.round(result[k].hours * 10) / 10;
          result[k].outHours = Math.round((result[k].outHours || 0) * 10) / 10;
          Object.keys(result[k].people).forEach(function (p) {
            result[k].people[p] = Math.round(result[k].people[p] * 10) / 10;
          });
          Object.keys(result[k].outPeople).forEach(function (p) {
            result[k].outPeople[p] = Math.round(result[k].outPeople[p] * 10) / 10;
          });
        });
        // 전체 통계를 별도 key로 부착 (MS id와 충돌 방지 위해 _meta 사용)
        result._meta = { untaggedCount: untagged };
        return result;
      });
    });
  });
}

/* ═══ Integration 8: 아카이브 패턴 기반 마일스톤 자동 제안 ═══ */
function suggestMilestones(orderNo, startDate, endDate) {
  return wrGetAll().then(function (allRecords) {
    var records = allRecords.filter(function (r) {
      return r.orderNo && r.orderNo.trim() === orderNo.trim();
    });
    if (!records.length) return [];

    records.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });

    // 날짜별 업무분장 시간 집계
    var dateMap = {};
    records.forEach(function (r) {
      var d = r.date || '';
      if (!dateMap[d]) dateMap[d] = {};
      var abbr = (r.abbr || r.taskType || 'G').charAt(0).toUpperCase();
      dateMap[d][abbr] = (dateMap[d][abbr] || 0) + (r.hours || 0);
    });

    var dates = Object.keys(dateMap).sort();
    if (!dates.length) return [];

    // 각 날짜의 지배적 업무유형
    var dominantByDate = dates.map(function (d) {
      var dist = dateMap[d];
      var maxAbbr = 'G'; var maxH = 0;
      for (var k in dist) { if (dist[k] > maxH) { maxH = dist[k]; maxAbbr = k; } }
      return { date: d, dominant: maxAbbr };
    });

    // 연속된 같은 지배적 유형을 구간으로 묶기
    var phases = [];
    var curPhase = { abbr: dominantByDate[0].dominant, startDate: dominantByDate[0].date, endDate: dominantByDate[0].date };
    for (var i = 1; i < dominantByDate.length; i++) {
      if (dominantByDate[i].dominant === curPhase.abbr) {
        curPhase.endDate = dominantByDate[i].date;
      } else {
        phases.push(curPhase);
        curPhase = { abbr: dominantByDate[i].dominant, startDate: dominantByDate[i].date, endDate: dominantByDate[i].date };
      }
    }
    phases.push(curPhase);

    function toISO(d) {
      if (!d) return '';
      // 이미 ISO 형식이면 그대로, YYYYMMDD면 변환
      if (d.length === 10 && d.indexOf('-') >= 0) return d;
      return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
    }

    var amLabels = typeof AM !== 'undefined' ? AM : { A: 'A(CS현장)', B: 'B(제작)', D: 'D(개발)', G: 'G(공통)', M: 'M(관리)', S: 'S(영업지원)' };
    var suggestions = phases.map(function (ph, idx) {
      var label = amLabels[ph.abbr] || ph.abbr;
      return { name: label + ' 집중 구간', startDate: toISO(ph.startDate), endDate: toISO(ph.endDate), status: 'done', order: idx };
    });

    // 인접 동일 유형 병합
    var merged = [];
    suggestions.forEach(function (s) {
      if (merged.length && s.name === merged[merged.length - 1].name) {
        merged[merged.length - 1].endDate = s.endDate;
      } else {
        merged.push({ name: s.name, startDate: s.startDate, endDate: s.endDate, status: s.status, order: merged.length });
      }
    });

    return merged;
  });
}

/* ═══ Integration 9: 달력에 주간 업무 요약 오버레이 ═══ */
function getWeeklyArchiveSummary() {
  return wkGetAll().then(function (weeks) {
    var summaries = [];
    weeks.forEach(function (w) {
      var dr = w.dateRange || [];
      if (!dr.length || !dr[0]) return;
      var startDate = dr[0].length === 8 ? dr[0].slice(0, 4) + '-' + dr[0].slice(4, 6) + '-' + dr[0].slice(6, 8) : dr[0];
      var endDate = dr[1]
        ? (dr[1].length === 8 ? dr[1].slice(0, 4) + '-' + dr[1].slice(4, 6) + '-' + dr[1].slice(6, 8) : dr[1])
        : startDate;
      var memberCount = (w.selectedNames || []).length;
      summaries.push({
        startDate: startDate,
        endDate: endDate,
        totalHours: w.totalHours || 0,
        memberCount: memberCount,
        label: w.label || ''
      });
    });
    return summaries;
  });
}

/* ═══ Integration 10 helper: 최근 아카이브 데이터 읽기 ═══ */
function getRecentArchiveWeeks(count) {
  return wkGetAll().then(function (weeks) {
    weeks.sort(function (a, b) { return (b.savedAt || '').localeCompare(a.savedAt || ''); });
    return weeks.slice(0, count || 4);
  });
}

/* ─── 문서 폴더 ─── */
function folderGetAll() { return apiFetch('/api/docs/folders').then(function (r) { return toCamelArray(r.data); }); }
function folderGet(id) { return apiFetch('/api/docs/folders').then(function (r) { var all = toCamelArray(r.data); return all.find(function (f) { return f.id === id; }) || null; }); }
function folderGetByProject(pid) { return apiFetch('/api/docs/folders?projectId=' + pid).then(function (r) { return toCamelArray(r.data); }); }
function folderPut(f) {
  var isNew = !f.id || f._isNew;
  if (isNew) {
    delete f._isNew;
    return apiFetch('/api/docs/folders', { method: 'POST', body: JSON.stringify(f) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('document', 'created', { kind: 'folder', id: s && s.id, projectId: s && s.projectId }); return s; });
  }
  return apiFetch('/api/docs/folders/' + f.id, { method: 'PUT', body: JSON.stringify(f) })
    .then(function (r) { return toCamel(r.data); })
    .catch(function (err) {
      if (err && (err.status === 404 || (err.data && err.data.error === 'NOT_FOUND'))) {
        return apiFetch('/api/docs/folders', { method: 'POST', body: JSON.stringify(f) }).then(function (r) { return toCamel(r.data); });
      }
      throw err;
    })
    .then(function (s) { _emitBus('document', 'updated', { kind: 'folder', id: s && s.id, projectId: s && s.projectId }); return s; });
}
function folderDel(id) {
  return apiFetch('/api/docs/folders/' + id, { method: 'DELETE' })
    .then(function (r) { _emitBus('document', 'deleted', { kind: 'folder', id: id }); return r; });
}

function createDefaultFolders(projectId) {
  var phaseLabels = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  return Promise.all(DOC_FOLDER_DEFAULTS.map(function (phase, idx) {
    var label = phaseLabels[phase] ? phaseLabels[phase].label : phase;
    return folderPut({
      id: 'fldr-' + uuid(),
      projectId: projectId,
      parentId: null,
      name: label,
      phase: phase,
      order: idx,
      createdAt: new Date().toISOString(),
      _isNew: true
    });
  }));
}

/* ─── 문서 파일 ─── */
function fileGetAll() { return apiFetch('/api/docs/files').then(function (r) { return toCamelArray(r.data); }); }
function fileGet(id) { return apiFetch('/api/docs/files').then(function (r) { var all = toCamelArray(r.data); return all.find(function (f) { return f.id === id; }) || null; }); }
function fileGetByProject(pid) { return apiFetch('/api/docs/files?projectId=' + pid).then(function (r) { return toCamelArray(r.data); }); }
function fileGetByFolder(fid) { return apiFetch('/api/docs/files?folderId=' + fid).then(function (r) { return toCamelArray(r.data); }); }
function filePut(f) {
  var isNew = !f.id || f._isNew;
  if (isNew) {
    delete f._isNew;
    return apiFetch('/api/docs/files', { method: 'POST', body: JSON.stringify(f) })
      .then(function (r) { var s = toCamel(r.data); _emitBus('document', 'created', { kind: 'file', id: s && s.id, projectId: s && s.projectId }); return s; });
  }
  return apiFetch('/api/docs/files/' + f.id, { method: 'PUT', body: JSON.stringify(f) })
    .then(function (r) { return toCamel(r.data); })
    .catch(function (err) {
      if (err && (err.status === 404 || (err.data && err.data.error === 'NOT_FOUND'))) {
        return apiFetch('/api/docs/files', { method: 'POST', body: JSON.stringify(f) }).then(function (r) { return toCamel(r.data); });
      }
      throw err;
    })
    .then(function (s) { _emitBus('document', 'updated', { kind: 'file', id: s && s.id, projectId: s && s.projectId }); return s; });
}
function fileDel(id) {
  return apiFetch('/api/docs/files/' + id, { method: 'DELETE' })
    .then(function (r) { _emitBus('document', 'deleted', { kind: 'file', id: id }); return r; });
}

function deleteProjectFiles(projectId) {
  return fileGetByProject(projectId).then(function (files) {
    return Promise.all(files.map(function (f) { return fileDel(f.id); }));
  }).then(function () {
    return folderGetByProject(projectId);
  }).then(function (folders) {
    return Promise.all(folders.map(function (f) { return folderDel(f.id); }));
  });
}

function getProjectStorageSize(projectId) {
  return fileGetByProject(projectId).then(function (files) {
    var total = 0;
    files.forEach(function (f) { total += (f.size || 0); });
    return { total: total, count: files.length };
  });
}
