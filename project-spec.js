/* ═══════════════════════════════════════════════════════════════════════
   project-spec.js — 프로젝트 상세 "사양" 탭: 장비 표준 사양서 (v13.196)
   ─────────────────────────────────────────────────────────────────────
   · 표준 양식(관리자, spec-template-admin.js) → 프로젝트 사양서 입력(섹션·항목·표)
   · 분야 필터(설계/전장·제어/SW/공정): 고른 분야 칸만 입력, 나머지는 흐리게
   · 하드웨어 구성도: 표 값으로 자동 계통도 + 맞지 않는 값 경고, draw.io 도면, 이미지·파일 첨부
   · 이전 프로젝트 사양서 복사, XLSX 내보내기, 기존(v13.160) 3칸 사양은 "기타 사양"으로 유지
   순수 로직: spec-schema.js / 서버: routes/projects.js PUT /:id/specs, routes/project-specs.js, routes/spec-templates.js
   전역 의존: apiFetch, toCamel, toCamelArray, eH, showToast, createModal, wmGuardedModal, currentUser,
             pmGetProjects|projGetAll, projMembersGet, projSpecsPut, renderCommentThread, pimgOpenViewer, _pimgDownscale
   ═══════════════════════════════════════════════════════════════════════ */

var _ps = null;                                   // 열린 사양서 상태
var _psTpl = { list: null, schemas: {} };         // 양식 캐시 (list: 발행된 양식 목록, schemas: 'id:ver' → schema)
var PS_DISC_COLOR = { design: '#8B5CF6', control: '#F59E0B', software: '#EC4899', process: '#10B981', all: '#64748B' };
var PS_HW_SECTION = 'hw';                         // 사양서 전체 구성도·도면 첨부용 섹션 키
var PS_DRAWIO_URL = 'https://embed.diagrams.net/?embed=1&proto=json&spin=1&saveAndExit=0&noExitBtn=0&lang=ko';

function _psEsc(s) { return (typeof eH === 'function') ? eH(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _psJs(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function _psToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _psMe() { return (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.sub || currentUser.id) : null; }
function _psRole() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser.role : null; }
function _psErrMsg(err, dflt) {
  if (err && err.status === 403) return '생성자·참여자·관리자만 수정할 수 있습니다.';
  if (err && err.status === 404) return '서버 배포 후 사용할 수 있습니다.';
  return (err && err.data && err.data.message) || (err && err.message) || dflt;
}

/* ── 양식 ────────────────────────────────────────────────────────────── */
function psTemplatesList(force) {
  if (_psTpl.list && !force) return Promise.resolve(_psTpl.list);
  return apiFetch('/api/spec-templates').then(function (r) {
    _psTpl.list = toCamelArray((r && r.data) || []);
    _psTpl.list.forEach(function (t) { if (t.schema && t.currentVersion) _psTpl.schemas[t.id + ':' + t.currentVersion] = t.schema; });
    return _psTpl.list;
  }).catch(function () { _psTpl.list = []; return []; });
}
function psInvalidateTemplates() { _psTpl.list = null; }
/* 사양서에서 고를 수 있는 양식 — 발행된 양식(기본 먼저) + 내장 기본 양식 */
function psChoosableTemplates() {
  var out = (_psTpl.list || []).filter(function (t) { return t.currentVersion > 0; })
    .map(function (t) { return { id: t.id, name: t.name, version: t.currentVersion, isDefault: t.isDefault }; });
  out.push({ id: SPEC_BUILTIN_ID, name: SPEC_BUILTIN_TEMPLATE.name + ' (내장)', version: SPEC_BUILTIN_TEMPLATE.version, isDefault: !out.length });
  return out;
}
function psLatestVersion(id) {
  if (id === SPEC_BUILTIN_ID) return SPEC_BUILTIN_TEMPLATE.version;
  var t = (_psTpl.list || []).filter(function (x) { return x.id === id; })[0];
  return t ? t.currentVersion : null;
}
function psTemplateName(id) {
  if (id === SPEC_BUILTIN_ID) return SPEC_BUILTIN_TEMPLATE.name;
  var t = (_psTpl.list || []).filter(function (x) { return x.id === id; })[0];
  return t ? t.name : '(삭제된 양식)';
}
function psTemplateSchema(id, ver) {
  if (!id) return Promise.resolve(null);
  if (id === SPEC_BUILTIN_ID) return Promise.resolve(SPEC_BUILTIN_TEMPLATE.schema);
  var k = id + ':' + ver;
  if (_psTpl.schemas[k]) return Promise.resolve(_psTpl.schemas[k]);
  return apiFetch('/api/spec-templates/' + encodeURIComponent(id) + '/versions/' + ver)
    .then(function (r) { _psTpl.schemas[k] = r.data.schema; return r.data.schema; });
}

/* ── 첨부 API ─────────────────────────────────────────────────────────── */
function psFilesGet(projId) {
  return apiFetch('/api/projects/' + encodeURIComponent(projId) + '/spec-files')
    .then(function (r) { return { files: toCamelArray(r.data), storage: r.storage || 'inline' }; })
    .catch(function () { return { files: [], storage: 'inline', failed: true }; });
}
/* ── 변경 이력·병합 저장 ─────────────────────────────────────────────── */
function psChangesGet(projId) {
  return apiFetch('/api/projects/' + encodeURIComponent(projId) + '/spec-changes?limit=100')
    .then(function (r) { return toCamelArray((r && r.data) || []); }).catch(function () { return []; });
}
/* 서버에 저장된 상태 = 변경분 계산의 기준. 이전 형식(v2 아님)이면 첫 저장은 문서 전체 교체로 보낸다. */
function _psSetBase(rawSpecs) {
  _ps.rawBase = rawSpecs ? specClone(rawSpecs) : {};
  _ps.baseIsV2 = !!(rawSpecs && rawSpecs.v === 2);
  _ps.base = specNormalize(rawSpecs);
}
/* 최근 14일 안에 다른 사람이 바꾼 항목 → { itemKey: { by, at, from, to } } (가장 최근 것) */
function _psRecentByOthers() {
  var me = _psMe(), since = Date.now() - 14 * 864e5, out = {};
  (_ps.changes || []).forEach(function (row) {
    if (me != null && String(row.changedBy) === String(me)) return;
    var at = Date.parse(row.changedAt); if (!(at >= since)) return;
    (row.changes || []).forEach(function (c) {
      var p = c.path || [];
      if (!(p[0] === 'values' || p[0] === 'remarks') || !p[1] || out[p[1]]) return;   // 상태 변경은 상태 버튼이 보여 준다
      out[p[1]] = { by: row.changedByName || '', at: row.changedAt, label: c.label, from: c.from, to: c.to };
    });
  });
  return out;
}
/* 이력 표시용 값 — 상태는 한글로, 문서 전체 전환은 값 생략 */
function _psFmtChange(c) {
  var p = c.path || [];
  if (!p.length) return '';
  var f = c.from, t = c.to;
  if (p[0] === 'status') { var L = { '': '미정', review: '검토', fixed: '확정' }; f = L[f || ''] || f; t = L[t || ''] || t; }
  if (p[0] === 'extra') return ' (목록 수정)';
  return ': <span style="color:var(--t5)">' + _psEsc(_psFmtVal(f)) + '</span> → <b>' + _psEsc(_psFmtVal(t)) + '</b>';
}
function _psFmtVal(v) { if (v == null || v === '') return '(빈 값)'; if (typeof v === 'object') return v.name ? '행 "' + v.name + '"' : '(행)'; return String(v).length > 40 ? String(v).slice(0, 39) + '…' : String(v); }
function _psFmtAt(at) { var d = new Date(at); if (isNaN(d)) return ''; return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function _psRecentMark(key) {
  var r = (_ps.recent || {})[key]; if (!r) return '';
  return '<span title="' + _psEsc(_psFmtAt(r.at) + ' ' + r.by + ' 변경: ' + _psFmtVal(r.from) + ' → ' + _psFmtVal(r.to)) + '" style="display:inline-block;font-size:8.5px;font-weight:700;color:#fff;background:' + SEM_COLOR.info + ';border-radius:6px;padding:0 4px;margin-left:4px;vertical-align:middle;cursor:help">변경</span>';
}
function _psFilesUrl(projId, fid) { return '/api/projects/' + encodeURIComponent(projId) + '/spec-files' + (fid ? '/' + encodeURIComponent(fid) : ''); }

/* ═══ 진입점 — 탭을 처음 열 때 한 번 빌드 (편집 내용 보존) ═══ */
function pdRenderSpec(projId) {
  var el = document.getElementById('pdSpec'); if (!el) return;
  if (el.getAttribute('data-rendered') === '1') return;
  el.setAttribute('data-rendered', '1');
  el.innerHTML = '<div style="color:var(--t6);font-size:11px;padding:10px 0">로딩 중...</div>';
  var srcP = (typeof pmGetProjects === 'function') ? pmGetProjects() : (typeof projGetAll === 'function' ? projGetAll() : Promise.resolve([]));
  var memP = (typeof projMembersGet === 'function') ? projMembersGet(projId).catch(function () { return []; }) : Promise.resolve([]);
  Promise.all([Promise.resolve(srcP), memP, psTemplatesList(), psFilesGet(projId), psChangesGet(projId)]).then(function (res) {
    var proj = (res[0] || []).filter(function (p) { return p.id === projId; })[0] || window._pdProj || { id: projId };
    var me = _psMe(), role = _psRole();
    var isMember = (res[1] || []).some(function (m) { return me != null && String(m.userId) === String(me); });
    _ps = {
      projId: projId, proj: proj,
      canEdit: !!(role === 'admin' || role === 'executive' || (me != null && proj.ownerId === me) || isMember),
      sheet: specNormalize(proj.specs), schema: null, filter: 'all', onlyOpen: false, dirty: false,
      files: res[3].files, storage: res[3].storage, collapsed: {}, hiddenGroups: {},
      changes: res[4], conflicts: [], warnedFixed: {}
    };
    _psSetBase(proj.specs);
    return psTemplateSchema(_ps.sheet.templateId, _ps.sheet.templateVersion).catch(function () { return null; });
  }).then(function (schema) {
    if (!_ps || _ps.projId !== projId) return;
    _ps.schema = schema;
    if (_ps.sheet.templateId && !schema) _psToast('사양서 양식을 불러오지 못했습니다. 기타 사양만 표시합니다.', 'warn');
    _psRender();
  }).catch(function (e) {
    console.error('[pdRenderSpec]', e);
    el.innerHTML = '<div style="color:var(--t6);font-size:11px;padding:10px 0">사양서를 불러오지 못했습니다.</div>';
  });
}

/* ═══ 렌더 ═══ */
function _psRender() {
  var el = document.getElementById('pdSpec'); if (!el || !_ps) return;
  _ps.recent = _psRecentByOthers();
  var h = _psToolbarHtml() + _psConflictsHtml();
  if (_ps.schema) {
    h += _psNavHtml();
    h += _psHwCardHtml();
    h += _ps.schema.sections.map(_psSectionHtml).join('');
  } else {
    h += _psStartPanelHtml();
  }
  h += _psExtraHtml();
  h += '<div style="font-size:10px;color:var(--t6);margin:6px 0 10px">사양 관련 협업 메모는 아래 코멘트에 남기세요(메일·텔레그램 연동).</div><div id="pdSpecComments"></div>';
  el.innerHTML = h;
  if (!el._psBound) {   // 입력 → 저장 필요 표시 + 구성도·경고 갱신 (위임, 한 번만)
    el.addEventListener('input', _psOnInput);
    el.addEventListener('change', _psOnInput);
    el._psBound = true;
  }
  _psApplyFilter();
  _psRefreshDiagram();
  if (typeof renderCommentThread === 'function') renderCommentThread('project', _ps.projId, 'pdSpecComments');
}

function _psMetaText() {
  var p = _ps.proj;
  if (p.specsUpdatedBy || p.specsUpdatedAt) return '최종 수정: ' + (p.specsUpdatedBy || '') + (p.specsUpdatedAt ? ' · ' + String(p.specsUpdatedAt).slice(0, 16).replace('T', ' ') : '');
  return _ps.canEdit ? '아직 저장된 사양이 없습니다.' : '등록된 사양이 없습니다.';
}

function _psToolbarHtml() {
  var s = _ps.sheet, pid = _psJs(_ps.projId);
  var tpl = '';
  if (s.templateId) {
    var latest = psLatestVersion(s.templateId);
    tpl = '<span style="font-size:10px;color:var(--t4);background:var(--bg-i);border:1px solid var(--bd);border-radius:10px;padding:1px 8px">양식: ' + _psEsc(psTemplateName(s.templateId)) + ' v' + _psEsc(s.templateVersion) + '</span>';
    if (_ps.canEdit && latest && latest > s.templateVersion) tpl += ' <button class="btn btn-g btn-s" style="font-size:10px;padding:1px 7px" onclick="psUpgradeTemplate()" title="값은 항목 키 기준으로 유지됩니다">새 표준 v' + latest + ' 적용</button>';
  }
  var chips = [{ key: 'all', label: '전체' }].concat(SPEC_DISCIPLINES).map(function (d) {
    var on = _ps.filter === d.key, c = PS_DISC_COLOR[d.key] || '#64748B';
    return '<button class="btn btn-s" onclick="psSetFilter(\'' + d.key + '\')" style="font-size:10px;padding:2px 8px;border:1px solid ' + (on ? c : 'var(--bd)') + ';background:' + (on ? c + '22' : 'transparent') + ';color:' + (on ? 'var(--t1)' : 'var(--t4)') + ';font-weight:' + (on ? 700 : 400) + '">' + _psEsc(d.label) + '</button>';
  }).join('');
  return '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;margin-bottom:8px">' +
      '<div style="display:flex;flex-direction:column;gap:3px"><span id="pdSpecMeta" style="font-size:10px;color:var(--t6)">' + _psEsc(_psMetaText()) + '</span><span>' + tpl + '</span></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">' +
        (_ps.schema ? '<span style="display:flex;gap:3px;margin-right:4px" title="분야를 고르면 그 분야 담당 칸만 입력할 수 있고 나머지는 흐려집니다">' + chips + '</span>' : '') +
        (_psNarrow() && typeof pdSetPanelSize === 'function' ? '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pdSetPanelSize(0.67);setTimeout(_psRender,50)" title="상세 패널을 넓혀 사양서를 편하게 봅니다 (폭은 기억됩니다)">↔ 넓게 보기</button>' : '') +
        (_ps.schema ? '<button class="btn btn-s" onclick="psToggleOnlyOpen()" title="확정되지 않은 항목만 보기" style="font-size:10px;padding:2px 8px;border:1px solid ' + (_ps.onlyOpen ? SEM_COLOR.warn : 'var(--bd)') + ';background:' + (_ps.onlyOpen ? SEM_COLOR.warn + '22' : 'transparent') + ';color:var(--t2)">' + (_ps.onlyOpen ? '☑' : '☐') + ' 미확정만</button>' : '') +
        '<button class="btn btn-g btn-s" style="font-size:10px" onclick="psOpenHistory()" title="누가 언제 무엇을 바꿨는지">🕘 변경 이력</button>' +
        '<button class="btn btn-g btn-s" style="font-size:10px" onclick="psExportXlsx()" title="사양서를 XLSX 로 저장">📥 XLSX</button>' +
        (_ps.canEdit ? '<button class="btn btn-g btn-s" style="font-size:10px" onclick="psOpenCopy()" title="다른 프로젝트의 사양서를 가져와 시작">📋 이전 프로젝트 복사</button>' : '') +
        (_psRole() === 'admin' ? '<button class="btn btn-g btn-s" style="font-size:10px" onclick="showSpecTemplateAdmin()" title="회사 표준 사양서 양식 관리 (관리자)">⚙️ 표준 양식</button>' : '') +
        (_ps.canEdit ? '<button class="btn btn-p btn-s" id="pdSpecSaveBtn" onclick="pdSpecSave(\'' + pid + '\')">💾 저장</button><span id="psDirty" style="font-size:10px;color:' + SEM_COLOR.warn + ';display:' + (_ps.dirty ? 'inline' : 'none') + '">● 저장 안 됨</span>'
          : '<span style="font-size:9px;color:var(--t6)">읽기 전용 (생성자·참여자·관리자만 편집)</span>') +
      '</div>' +
    '</div>';
}

function _psNarrow() { var el = document.getElementById('pdSpec'); return !!(el && el.clientWidth && el.clientWidth < 720); }

/* ═══ 하드웨어 구성도 편집 (v13.200) ═══════════════════════════════════════
   자동 계통도 위에 사용자가 옮기기·이름 고치기·화살표 잇기/지우기/뒤집기·상자 추가/숨기기를 얹는다.
   편집 내용은 _ps.sheet.diagram (spec-schema.js specDiagramMerge 규칙) → 사양서와 함께 PATCH 저장.
   _ps.dg = { edit, arrow, source, sel:'box:id'|'edge:key', drag } */
var PS_DG_GRID = 8;
function _psDgState() { if (!_ps.dg) _ps.dg = { edit: false, arrow: false, source: null, sel: '', drag: null }; return _ps.dg; }
function _psDgDoc() { _ps.sheet.diagram = specDiagramNorm(_ps.sheet.diagram); return _ps.sheet.diagram; }
/* 지금 사양 값으로 계산한 자동 배치 + 편집 내용 = 화면에 그릴 배치 */
function _psDgLayout(sheet) {
  sheet = sheet || _psCollect(true);
  var model = specBuildDiagram(sheet), checks = specChecks(sheet);
  var hasUser = sheet.diagram && ((sheet.diagram.add || []).length);
  if (model.empty && !hasUser) return { empty: true, checks: checks };
  var L = specDiagramMerge(specDiagramLayout(model, checks), sheet.diagram);
  L.checks = checks;
  return L;
}
function _psDgSvg(L) {
  var st = _psDgState();
  return specDiagramSvg(L, { accent: SEM_COLOR.info, warn: SEM_COLOR.warn, interactive: st.edit, selected: st.sel, source: st.source, userDash: '5 3' });
}
function _psDgToolbarHtml() {
  if (!_ps.canEdit) return '';
  var st = _psDgState();
  if (!st.edit) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px">' +
      '<span style="font-size:10px;color:var(--t6)">자동 계통도 — 축 구성·모션 컨트롤러·IO·외부장치·확장 모듈 값으로 그립니다.' + (_ps.sheet.diagram && !specDiagramEmpty(_ps.sheet.diagram) ? ' <b style="color:var(--t4)">(편집한 배치 적용 중)</b>' : '') + '</span>' +
      '<button class="btn btn-g btn-s" style="font-size:10px;white-space:nowrap" onclick="psDgEdit(true)" title="상자 옮기기·이름 고치기·화살표 잇기">✏️ 구성도 편집</button></div>';
  }
  var b = function (label, fn, title, on) { return '<button class="btn btn-' + (on ? 'p' : 'g') + ' btn-s" style="font-size:10px;white-space:nowrap" onclick="' + fn + '" title="' + title + '">' + label + '</button>'; };
  return '<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:4px;padding:5px 6px;border:1px solid ' + SEM_COLOR.info + ';border-radius:6px;background:' + SEM_COLOR.info + '10">' +
    '<b style="font-size:10.5px;color:var(--t2);margin-right:4px">✏️ 편집 중</b>' +
    b('+ 상자', 'psDgAddBox()', '새 상자를 추가합니다') +
    b(st.arrow ? '↗ 화살표 잇는 중 (끄기)' : '↗ 화살표 잇기', 'psDgArrowMode()', '시작 상자 → 도착 상자 순서로 누르세요', st.arrow) +
    b('⊞ 격자 맞춤', 'psDgSnapAll()', '모든 상자를 격자에 맞춰 가지런히') +
    b('⟲ 자동 배치로 정리', 'psDgAutoArrange()', '이름·추가한 상자·화살표는 두고 위치만 자동 배치로') +
    b('초기화', 'psDgReset()', '편집한 내용을 모두 지우고 자동 계통도로') +
    '<span style="flex:1"></span>' + b('완료', 'psDgEdit(false)', '편집 마치기 (💾 저장을 눌러 사양서와 함께 저장)', true) +
    '<div style="flex-basis:100%;font-size:9.5px;color:var(--t6)">' + (st.arrow ? (st.source ? '도착 상자를 누르세요 (Esc: 취소)' : '시작 상자를 누르세요') : '상자·제목을 끌어서 옮기기 · 누르면 오른쪽에서 이름·삭제 · 화살표를 누르면 라벨·방향·삭제 · Delete 키로 삭제') + '</div>' +
  '</div>';
}
function _psDgPanelHtml(L) {
  var st = _psDgState(); if (!st.edit || !st.sel) return '';
  var kind = st.sel.slice(0, st.sel.indexOf(':')), id = st.sel.slice(st.sel.indexOf(':') + 1);
  var inp = 'width:100%;box-sizing:border-box;font-size:11px;padding:4px 7px;margin-bottom:4px';
  var h = '<div style="border:1px solid var(--bd);border-radius:6px;padding:7px 9px;margin-top:6px;background:var(--bg-i)">';
  if (kind === 'box') {
    var bx = (L.boxes || []).filter(function (x) { return x.id === id; })[0];
    var ln = (L.lanes || []).filter(function (x) { return x.id === id; })[0];
    var o = bx || ln; if (!o) return '';
    var isUser = bx && bx.kind === 'user';
    h += '<div style="font-size:10.5px;font-weight:700;color:var(--t3);margin-bottom:5px">' + (ln ? '계통 제목' : isUser ? '추가한 상자' : '상자') + '</div>' +
      '<input class="si" value="' + _psEsc(o.title) + '" placeholder="이름" oninput="psDgText(\'' + _psJs(id) + '\',\'title\',this.value)" style="' + inp + '">' +
      (bx && bx.kind !== 'warn' ? '<input class="si" value="' + _psEsc(o.sub || '') + '" placeholder="부제 (선택)" oninput="psDgText(\'' + _psJs(id) + '\',\'sub\',this.value)" style="' + inp + '">' : '') +
      '<div style="display:flex;gap:4px;flex-wrap:wrap">' +
        (!isUser ? '<button class="btn btn-g btn-s" style="font-size:10px" onclick="psDgRestore(\'' + _psJs(id) + '\')" title="이름·위치를 자동 값으로">원래대로</button>' : '') +
        (bx ? '<button class="btn btn-d btn-s" style="font-size:10px" onclick="psDgDelete()">' + (isUser ? '삭제' : '숨기기') + '</button>' : '') +
      '</div>';
  } else {
    var e = (L.edges || []).filter(function (x) { return x.key === id; })[0]; if (!e) return '';
    var nm = function (bid) { var x = (L.boxes || []).filter(function (y) { return y.id === bid; })[0]; return x ? x.title : bid; };
    h += '<div style="font-size:10.5px;font-weight:700;color:var(--t3);margin-bottom:5px">화살표 · ' + _psEsc(nm(e.from)) + ' → ' + _psEsc(nm(e.to)) + '</div>' +
      '<input class="si" value="' + _psEsc(e.label || '') + '" placeholder="라벨 (예: RS-232C, 24V, CH0)" oninput="psDgEdgeLabel(this.value)" style="' + inp + '">' +
      '<div style="display:flex;gap:4px"><button class="btn btn-g btn-s" style="font-size:10px" onclick="psDgFlip()">⇄ 방향 바꾸기</button><button class="btn btn-d btn-s" style="font-size:10px" onclick="psDgDelete()">삭제</button></div>';
  }
  return h + '</div>';
}
/* 구성도만 다시 그림 (드래그 중에는 계산해 둔 자동 배치를 재사용) */
function _psDgPaint(L) {
  var box = document.getElementById('psDiagram'); if (!box) return;
  var st = _psDgState();
  L = L || _psDgLayout();
  var tb = document.getElementById('psDgTools'); if (tb) tb.innerHTML = _psDgToolbarHtml();
  box.style.cursor = st.edit ? 'default' : 'zoom-in';
  box.title = st.edit ? '' : '눌러서 크게 보기';
  box.innerHTML = L.empty
    ? '<div style="font-size:11px;color:var(--t6);padding:14px;text-align:center">모션 컨트롤러·축 구성·외부장치 목록을 채우면 계통도가 그려집니다.' + (st.edit ? ' 또는 "+ 상자"로 직접 그리세요.' : '') + '</div>'
    : '<div style="min-width:640px">' + _psDgSvg(L) + '</div>';   // 좁은 패널에서는 가로 스크롤(글자가 읽히는 크기 유지)
  var pn = document.getElementById('psDgPanel'); if (pn) pn.innerHTML = L.empty ? '' : _psDgPanelHtml(L);
  _psDgBind(box);
}
function psDgEdit(on) {
  if (!_ps) return;
  var st = _psDgState();
  st.edit = !!on; st.arrow = false; st.source = null; st.sel = '';
  _psDgPaint();
}
function _psDgChanged(L) { _psMarkDirty(); _psDgPaint(L); }

/* ── 포인터: 끌기 · 선택 · 화살표 잇기 (구성도 상자 div 에 한 번만 묶는다) ── */
function _psDgPoint(svg, ev) {
  var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
  var m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
}
function _psDgBind(box) {
  if (box._psDgBound) return;
  box._psDgBound = true;
  box.addEventListener('click', function () { if (!_psDgState().edit) psDiagramZoom(); });
  box.addEventListener('pointerdown', function (ev) {
    var st = _psDgState(); if (!st.edit) return;
    var svg = box.querySelector('svg'); if (!svg) return;
    var gBox = ev.target.closest && ev.target.closest('[data-box]'), gEdge = ev.target.closest && ev.target.closest('[data-edge]');
    if (gBox) {
      var id = gBox.getAttribute('data-box');
      if (st.arrow) { _psDgArrowClick(id); return; }
      var peek = _psCollect(true), L = _psDgLayout(peek), o = (L.boxes.concat(L.lanes)).filter(function (x) { return x.id === id; })[0]; if (!o) return;
      var p = _psDgPoint(svg, ev);
      // 자동 배치는 끄는 동안 바뀌지 않으므로 한 번만 계산해 둔다 (저장 전 입력값 포함)
      var base = specDiagramLayout(specBuildDiagram(peek), L.checks || []);
      st.drag = { id: id, base: base, checks: L.checks, dx: p.x - o.x, dy: p.y - o.y, x0: ev.clientX, y0: ev.clientY, moved: false };
      box.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    } else if (gEdge) {
      st.sel = 'edge:' + gEdge.getAttribute('data-edge'); _psDgPaint();
    } else if (st.sel) { st.sel = ''; _psDgPaint(); }
  });
  box.addEventListener('pointermove', function (ev) {
    var st = _psDgState(), d = st.drag; if (!d) return;
    if (!d.moved && Math.abs(ev.clientX - d.x0) + Math.abs(ev.clientY - d.y0) < 4) return;
    d.moved = true;
    var svg = box.querySelector('svg'); if (!svg) return;
    var p = _psDgPoint(svg, ev);
    var x = Math.max(0, Math.round((p.x - d.dx) / PS_DG_GRID) * PS_DG_GRID), y = Math.max(0, Math.round((p.y - d.dy) / PS_DG_GRID) * PS_DG_GRID);
    var dg = _psDgDoc(); dg.pos[d.id] = { x: x, y: y };
    if (!d.raf) d.raf = requestAnimationFrame(function () {
      d.raf = null;
      var L = specDiagramMerge(d.base, _ps.sheet.diagram); L.checks = d.checks;
      var inner = box.querySelector('div'); if (inner) inner.innerHTML = _psDgSvg(L);
    });
  });
  function end(ev) {
    var st = _psDgState(), d = st.drag; if (!d) return;
    st.drag = null;
    try { box.releasePointerCapture(ev.pointerId); } catch (e) { /* 무시 */ }
    if (d.moved) { _psDgChanged(); return; }
    st.sel = 'box:' + d.id; _psDgPaint();
  }
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
}
function _psDgArrowClick(id) {
  var st = _psDgState();
  if (/^lane/.test(id)) return;
  if (!st.source) { st.source = id; _psDgPaint(); return; }
  if (st.source === id) { st.source = null; _psDgPaint(); return; }
  var dg = _psDgDoc(), from = st.source;
  var exists = dg.links.some(function (l) { return l.from === from && l.to === id; });
  if (!exists) dg.links.push({ id: specNewId('ln'), from: from, to: id, label: '' });
  st.source = null;
  _psDgChanged();
}
function psDgArrowMode() { var st = _psDgState(); st.arrow = !st.arrow; st.source = null; st.sel = ''; _psDgPaint(); }

/* ── 패널 동작 ─────────────────────────────────────────────────────────── */
function _psDgSel() { var st = _psDgState(), i = st.sel.indexOf(':'); return { kind: st.sel.slice(0, i), id: st.sel.slice(i + 1) }; }
function psDgText(id, field, v) {
  var dg = _psDgDoc();
  var u = dg.add.filter(function (x) { return x.id === id; })[0];
  if (u) u[field] = v; else { dg.text[id] = dg.text[id] || {}; dg.text[id][field] = v; }
  _psMarkDirty();
  var box = document.getElementById('psDiagram'), inner = box && box.querySelector('div');
  if (inner) inner.innerHTML = _psDgSvg(_psDgLayout());   // 패널 입력칸은 그대로 두고 그림만
}
function psDgEdgeLabel(v) {
  var s = _psDgSel(), dg = _psDgDoc();
  if (s.id.indexOf('u:') === 0) { var l = dg.links.filter(function (x) { return 'u:' + x.id === s.id; })[0]; if (l) l.label = v; }
  else { var k = s.id.slice(2); if (v) dg.edgeLabel[k] = v; else delete dg.edgeLabel[k]; }
  _psMarkDirty();
  var box = document.getElementById('psDiagram'), inner = box && box.querySelector('div');
  if (inner) inner.innerHTML = _psDgSvg(_psDgLayout());
}
function psDgFlip() {
  var s = _psDgSel(), dg = _psDgDoc();
  if (s.id.indexOf('u:') === 0) {
    var l = dg.links.filter(function (x) { return 'u:' + x.id === s.id; })[0];
    if (l) { var t = l.from; l.from = l.to; l.to = t; }
  } else { var k = s.id.slice(2); if (dg.flip[k]) delete dg.flip[k]; else dg.flip[k] = true; }
  _psDgChanged();
}
function psDgDelete() {
  var st = _psDgState(), s = _psDgSel(), dg = _psDgDoc();
  if (!st.sel) return;
  if (s.kind === 'edge') {
    if (s.id.indexOf('u:') === 0) dg.links = dg.links.filter(function (x) { return 'u:' + x.id !== s.id; });
    else dg.hideEdge[s.id.slice(2)] = true;
  } else {
    if (/^lane/.test(s.id)) return;
    var isUser = dg.add.some(function (x) { return x.id === s.id; });
    if (isUser) dg.add = dg.add.filter(function (x) { return x.id !== s.id; });
    else dg.hideBox[s.id] = true;
    dg.links = dg.links.filter(function (l) { return l.from !== s.id && l.to !== s.id; });
    delete dg.pos[s.id]; delete dg.text[s.id];
  }
  st.sel = '';
  _psDgChanged();
}
function psDgRestore(id) {
  var dg = _psDgDoc(); delete dg.pos[id]; delete dg.text[id];
  _psDgChanged();
}
function psDgAddBox() {
  var L = _psDgLayout(), dg = _psDgDoc(), st = _psDgState();
  var y = 16; (L.boxes || []).forEach(function (b) { if (b.x + b.w > (L.width || 796) - 200) y = Math.max(y, b.y + b.h + 16); });
  var id = specNewId('bx');
  dg.add.push({ id: id, x: Math.max(16, (L.width || 796) - 200), y: y, w: 168, h: 44, title: '새 상자', sub: '' });
  st.sel = 'box:' + id;
  _psDgChanged();
}
function psDgSnapAll() {
  var L = _psDgLayout(); if (L.empty) return;
  var dg = _psDgDoc(), g = PS_DG_GRID * 2;
  L.boxes.concat(L.lanes).forEach(function (b) {
    var x = Math.round(b.x / g) * g, y = Math.round(b.y / g) * g;
    var u = dg.add.filter(function (a) { return a.id === b.id; })[0];
    if (u) { u.x = x; u.y = y; delete dg.pos[b.id]; } else dg.pos[b.id] = { x: x, y: y };
  });
  _psDgChanged();
  _psToast('격자에 맞췄습니다.');
}
function psDgAutoArrange() {
  var dg = _psDgDoc(), n = 0;
  Object.keys(dg.pos).forEach(function (k) { if (!dg.add.some(function (a) { return a.id === k; })) { delete dg.pos[k]; n++; } });
  // 추가한 상자는 자동 배치 오른쪽에 한 줄로
  var L0 = specDiagramLayout(specBuildDiagram(_psCollect(true)), []), x = (L0.width || 796) - 184, y = 16;
  dg.add.forEach(function (a) { a.x = x; a.y = y; y += (a.h || 44) + 16; delete dg.pos[a.id]; });
  _psDgChanged();
  _psToast('자동 배치로 정리했습니다' + (dg.add.length ? ' (추가한 상자는 오른쪽에 정렬)' : '') + '.');
}
function psDgReset() {
  if (!confirm('구성도에서 옮기고 고친 내용·추가한 상자·화살표를 모두 지우고 자동 계통도로 되돌릴까요?')) return;
  _ps.sheet.diagram = null;
  var st = _psDgState(); st.sel = ''; st.source = null;
  _psDgChanged();
}
/* 키보드 — 편집 중 Delete: 선택 삭제, Esc: 화살표 잇기 취소·선택 해제 */
if (typeof document !== 'undefined' && !window._psDgKeyBound) {
  window._psDgKeyBound = true;
  document.addEventListener('keydown', function (e) {
    if (!_ps || !_ps.dg || !_ps.dg.edit || !document.getElementById('psDiagram')) return;
    var t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (_ps.dg.sel) { e.preventDefault(); psDgDelete(); } }
    else if (e.key === 'Escape') { _ps.dg.source = null; _ps.dg.sel = ''; _psDgPaint(); }
  });
}

/* 구성도 크게 보기 */
function psDiagramZoom() {
  if (!_ps) return;
  var L = _psDgLayout();
  if (L.empty) return;
  var svg = specDiagramSvg(L, { accent: SEM_COLOR.info, warn: SEM_COLOR.warn });
  createModal({ id: 'psDiagramZoom', titleText: '🔌 하드웨어 구성도 — ' + (_ps.proj.name || ''), html: '<div style="overflow:auto;max-height:78vh;background:var(--bg);border-radius:8px;padding:10px">' + svg + '</div>', width: '1000px', closeOnEsc: true, closeOnOverlay: true });
}

/* 섹션 바로가기 — 섹션별 확정 수. 누르면 펼치고 그 위치로 이동 */
function _psNavHtml() {
  var all = { total: 0, fixed: 0, review: 0 };
  var chips = _ps.schema.sections.map(function (sec) {
    var st = specSectionStatus(sec, _ps.sheet), c = PS_DISC_COLOR[sec.discipline] || '#64748B';
    all.total += st.total; all.fixed += st.fixed; all.review += st.review;
    var done = st.total && st.fixed === st.total;
    return '<button class="btn btn-s" onclick="psJump(\'' + sec.key + '\')" style="font-size:10px;padding:2px 7px;border:1px solid var(--bd);border-left:3px solid ' + c + ';background:' + (done ? SEM_COLOR.ok + '1a' : 'transparent') + ';color:var(--t3)">' +
      _psEsc(sec.label) + ' <span style="color:' + (done ? SEM_COLOR.ok : 'var(--t6)') + ';font-weight:600">' + st.fixed + '/' + st.total + '</span></button>';
  }).join('');
  var pct = all.total ? Math.round(all.fixed / all.total * 100) : 0;
  return '<div style="position:sticky;top:0;z-index:2;background:var(--bg-p,var(--bg));padding:6px 0 8px;margin-bottom:6px;border-bottom:1px solid var(--bd)">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:10.5px;color:var(--t4)">' +
      '<span style="font-weight:700;color:var(--t2)">확정 ' + all.fixed + '/' + all.total + ' (' + pct + '%)</span>' +
      '<span style="flex:1;max-width:260px;height:6px;border-radius:3px;background:var(--bg-i);overflow:hidden;display:flex">' +
        '<span style="width:' + pct + '%;background:' + SEM_COLOR.ok + '"></span><span style="width:' + (all.total ? Math.round(all.review / all.total * 100) : 0) + '%;background:' + SEM_COLOR.warn + '"></span></span>' +
      '<span>검토 ' + all.review + ' · 미정 ' + (all.total - all.fixed - all.review) + '</span>' +
      '<span style="color:var(--t6)">항목 옆 상태 버튼을 눌러 미정 → 검토 → 확정. 확정 항목을 고치면 자동으로 검토로 돌아갑니다.</span>' +
    '</div><div style="display:flex;flex-wrap:wrap;gap:4px">' + chips + '</div></div>';
}
function psJump(key) {
  if (!_ps) return;
  if (_ps.collapsed[key]) { _psCollect(); _ps.collapsed[key] = false; _psRender(); }
  var el = document.getElementById('ps-sec-' + key);
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function psToggleOnlyOpen() { if (!_ps) return; _psCollect(); _ps.onlyOpen = !_ps.onlyOpen; _psRender(); }

/* 상태 버튼 */
function _psStatusBtnHtml(key) {
  var s = specStatusOf(_ps.sheet, key), def = SPEC_STATUS.filter(function (x) { return x.key === s; })[0];
  var st = 'font-size:9.5px;font-weight:700;border-radius:9px;padding:1px 7px;border:1px solid ' + def.color + ';color:' + (s ? '#fff' : def.color) + ';background:' + (s ? def.color : 'transparent') + ';white-space:nowrap';
  if (!_ps.canEdit) return '<span style="' + st + '">' + def.label + '</span>';
  return '<button class="ps-st" data-k="' + key + '" onclick="psCycleStatus(\'' + key + '\')" title="눌러서 상태 변경 (미정 → 검토 → 확정)" style="' + st + ';cursor:pointer">' + def.label + '</button>';
}
function psCycleStatus(key) {
  if (!_ps || !_ps.canEdit) return;
  var next = specNextStatus(specStatusOf(_ps.sheet, key));
  if (next) _ps.sheet.status[key] = next; else delete _ps.sheet.status[key];
  _psPaintStatus(key);
  _psMarkDirty();
}
function _psPaintStatus(key) {
  var b = document.querySelector('#pdSpec .ps-st[data-k="' + key + '"]');
  if (b) b.outerHTML = _psStatusBtnHtml(key);
  var idx = specItemIndex(_ps.schema), e = idx[key];
  if (e) { var g = document.getElementById('ps-stat-' + e.section.key); if (g) g.innerHTML = _psSecStatusText(e.section); }
}
function _psSecStatusText(sec) {
  var st = specSectionStatus(sec, _ps.sheet);
  return '<span style="color:' + (st.total && st.fixed === st.total ? SEM_COLOR.ok : 'var(--t5)') + '">확정 ' + st.fixed + '/' + st.total + '</span>';
}

/* 저장 충돌 — 다른 사람이 먼저 바꾼 칸. 서버 값을 화면에 두고, 원하면 내 값으로 덮어쓴다 */
function _psConflictsHtml() {
  var list = _ps.conflicts || [];
  if (!list.length) return '';
  return '<div id="psConflicts" style="border:1px solid ' + SEM_COLOR.danger + ';background:' + SEM_COLOR.danger + '10;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:11px;color:var(--t2)">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><b>⚠️ 다른 사람이 먼저 바꾼 항목 ' + list.length + '건 — 저장된 값을 화면에 표시했습니다</b>' +
    '<button class="btn btn-g btn-s" style="font-size:10px" onclick="psDismissConflicts()">닫기</button></div>' +
    list.map(function (c, i) {
      return '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:3px 0;border-top:1px solid var(--bd)">' +
        '<span><b>' + _psEsc(c.label) + '</b> · 저장된 값 <b>' + _psEsc(_psFmtVal(c.theirs)) + '</b> · 내가 입력한 값 <b>' + _psEsc(_psFmtVal(c.mine)) + '</b></span>' +
        (c.path && c.path.length ? '<button class="btn btn-g btn-s" style="font-size:10px;white-space:nowrap" onclick="psResolveConflict(' + i + ')">내 값으로 바꾸기</button>' : '') + '</div>';
    }).join('') + '</div>';
}
function psDismissConflicts() { if (!_ps) return; _psCollect(); _ps.conflicts = []; _psRender(); }
function psResolveConflict(i) {
  var c = (_ps.conflicts || [])[i]; if (!c) return;
  _psPatch([{ path: c.path, from: c.theirs, to: c.mine, label: c.label }]).then(function (ok) {
    if (!ok) return;
    _ps.conflicts.splice(i, 1);
    _psRender();
  });
}

function _psStartPanelHtml() {
  var opts = psChoosableTemplates();
  var body = _ps.canEdit
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px"><select id="psStartTpl" class="si" style="font-size:11px;padding:4px 8px;max-width:280px">' +
        opts.map(function (t) { return '<option value="' + _psEsc(t.id) + '"' + (t.isDefault ? ' selected' : '') + '>' + _psEsc(t.name) + ' v' + t.version + '</option>'; }).join('') +
      '</select><button class="btn btn-p btn-s" onclick="psStartWithTemplate()">이 양식으로 시작</button>' +
      '<button class="btn btn-g btn-s" onclick="psOpenCopy()">📋 이전 프로젝트에서 복사</button></div>' +
      '<div style="font-size:10px;color:var(--t6);margin-top:6px">아래 "기타 사양"의 항목 중 이름이 표준 항목과 같은 것은 해당 항목으로 옮겨집니다. 시작한 뒤 💾 저장을 눌러야 반영됩니다.</div>'
    : '<div style="font-size:11px;color:var(--t5);margin-top:6px">아직 표준 양식으로 작성되지 않았습니다.</div>';
  return '<div style="border:1px dashed var(--bd);border-radius:8px;padding:12px 14px;margin-bottom:12px">' +
    '<div style="font-size:12px;font-weight:700;color:var(--t2)">📑 표준 사양서로 정리하기</div>' +
    '<div style="font-size:11px;color:var(--t5);margin-top:3px">설계·전장/제어·SW 가 같은 양식(일반 기구, 축 구성, 모션 컨트롤러, IO, 외부장치 I/F …)을 채우고, 구성도·도면·사진을 함께 보관합니다.</div>' +
    body + '</div>';
}

/* ── 하드웨어 구성도 카드 ─────────────────────────────────────────────── */
function _psHwCardHtml() {
  var collapsed = !!_ps.collapsed[PS_HW_SECTION];
  return '<div id="ps-sec-' + PS_HW_SECTION + '" style="margin-bottom:12px;border:1px solid var(--bd);border-radius:8px;overflow:hidden">' +
    '<div onclick="psToggleSection(\'' + PS_HW_SECTION + '\')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:var(--bg-i);padding:6px 10px">' +
      '<span style="font-size:12px;font-weight:700;color:var(--t2)">' + (collapsed ? '▸' : '▾') + ' 🔌 하드웨어 구성도</span>' +
      '<span id="psChecksBadge" style="font-size:10px"></span>' +
    '</div>' +
    '<div style="padding:8px 10px;display:' + (collapsed ? 'none' : 'block') + '">' +
      '<div id="psChecks"></div>' +
      '<div id="psDgTools"></div>' +
      '<div id="psDiagram" style="overflow-x:auto;background:var(--bg);border:1px solid var(--bd);border-radius:6px;padding:8px;cursor:zoom-in;touch-action:none;user-select:none"></div>' +
      '<div id="psDgPanel"></div>' +
      '<div id="psBom" style="margin-top:8px"></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 4px">' +
        (_ps.canEdit ? '<button class="btn btn-g btn-s" style="font-size:10px" onclick="psDrawioFromAuto()" title="지금 구성도(편집한 배치 포함)를 draw.io 도면으로 가져와 상세하게 그립니다">✏️ 구성도를 draw.io 도면으로 내보내기</button>' + _psAttachBtnsHtml(PS_HW_SECTION, false) : '') +
      '</div>' +
      _psFilesBlockHtml(PS_HW_SECTION) +
    '</div></div>';
}

function _psRefreshDiagram() {
  if (!_ps || !_ps.schema) return;
  var box = document.getElementById('psDiagram'); if (!box) return;
  var sheet = _psCollect(true);
  var L = _psDgLayout(sheet), checks = L.checks || specChecks(sheet);
  if (_psDgState().drag) return;   // 끄는 중에는 그림을 새로 그리지 않는다
  _psDgPaint(L);
  var ck = document.getElementById('psChecks');
  if (ck) ck.innerHTML = checks.length
    ? '<div style="border:1px solid ' + SEM_COLOR.warn + ';background:' + SEM_COLOR.warn + '14;border-radius:6px;padding:6px 10px;margin-bottom:8px;font-size:11px;color:var(--t2)">' +
        '<div style="font-weight:700;margin-bottom:2px">⚠️ 확인이 필요한 값 ' + checks.length + '건</div>' +
        checks.map(function (c) { return '<div>· ' + _psEsc(c.text) + '</div>'; }).join('') + '</div>'
    : '';
  var bomBox = document.getElementById('psBom');
  if (bomBox) {
    var bom = specBom(sheet);
    var td = 'padding:3px 8px;border-bottom:1px solid var(--bd);font-size:11px;color:var(--t2)';
    bomBox.innerHTML = bom.length
      ? '<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:3px">🧾 부품 요약 <span style="font-weight:400;font-size:10px;color:var(--t6)">모델별 수량 자동 집계 — 구매·조립 확인용 (XLSX 에도 포함)</span></div>' +
        '<div style="overflow-x:auto;border:1px solid var(--bd);border-radius:6px"><table style="border-collapse:collapse;width:100%"><thead><tr>' +
        ['구분', '품목', '모델', '수량', '비고'].map(function (h) { return '<th style="' + td + ';text-align:left;font-size:9.5px;color:var(--t5);background:var(--bg-i);text-transform:none;letter-spacing:0">' + h + '</th>'; }).join('') +
        '</tr></thead><tbody>' + bom.map(function (r) {
          return '<tr><td style="' + td + '">' + _psEsc(r.group) + '</td><td style="' + td + '">' + _psEsc(r.name) + '</td><td style="' + td + ';font-weight:600">' + _psEsc(r.model) + '</td><td style="' + td + ';text-align:right">' + r.qty + '</td><td style="' + td + ';color:var(--t5)">' + _psEsc(r.note) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : '';
  }
  var bd = document.getElementById('psChecksBadge');
  if (bd) bd.innerHTML = checks.length ? '<span style="color:' + SEM_COLOR.warn + ';font-weight:700">⚠️ ' + checks.length + '</span>' : '';
}

/* ── 섹션 ──────────────────────────────────────────────────────────────── */
function _psOwnerDot(owner) {
  var c = PS_DISC_COLOR[owner]; if (!c) return '';
  return '<span title="담당: ' + _psEsc(specDisciplineLabel(owner)) + '" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + c + ';margin-right:4px;vertical-align:middle"></span>';
}
function _psSectionHtml(sec) {
  var prog = specSectionProgress(sec, _ps.sheet);
  var nFiles = _ps.files.filter(function (f) { return f.sectionKey === sec.key; }).length;
  var collapsed = !!_ps.collapsed[sec.key];
  var dc = PS_DISC_COLOR[sec.discipline] || '#64748B';
  var items = (sec.items || []);
  if (_ps.onlyOpen) items = items.filter(function (it) { return specStatusOf(_ps.sheet, it.key) !== 'fixed'; });
  var plain = items.filter(function (it) { return it.type !== 'table'; });
  var tables = items.filter(function (it) { return it.type === 'table'; });
  var body = '';
  if (_ps.onlyOpen && !items.length) body += '<div style="font-size:11px;color:' + SEM_COLOR.ok + ';padding:2px 0">✔ 모든 항목이 확정되었습니다.</div>';
  if (plain.length) {
    // 좁은 상세 패널(1/3)에서도 입력칸이 줄지 않게: 항목 | (내용 + 비고, 자리가 없으면 비고가 아래로) | 상태
    body += '<div style="display:grid;grid-template-columns:minmax(96px,180px) 1fr 44px;gap:5px 6px;align-items:center">' +
      '<span style="font-size:9px;color:var(--t6)">항목</span><span style="font-size:9px;color:var(--t6)">내용 · 비고</span><span style="font-size:9px;color:var(--t6)">상태</span>' +
      plain.map(_psItemRowHtml).join('') + '</div>';
  }
  tables.forEach(function (it) { body += _psTableHtml(it); });
  body += _psFilesBlockHtml(sec.key);
  return '<div id="ps-sec-' + sec.key + '" data-disc="' + _psEsc(sec.discipline) + '" style="margin-bottom:12px;border:1px solid var(--bd);border-left:3px solid ' + dc + ';border-radius:8px;overflow:hidden">' +
    '<div onclick="psToggleSection(\'' + sec.key + '\')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:var(--bg-i);padding:6px 10px">' +
      '<span style="font-size:12px;font-weight:700;color:var(--t2)">' + (collapsed ? '▸' : '▾') + ' ' + _psEsc(sec.label) +
        ' <span style="font-size:9px;font-weight:500;color:' + dc + ';border:1px solid ' + dc + ';border-radius:8px;padding:0 5px;margin-left:4px">' + _psEsc(specDisciplineLabel(sec.discipline)) + '</span></span>' +
      '<span style="display:flex;gap:4px;align-items:center;font-size:10px;color:var(--t5)">' + _psAttachBtnsHtml(sec.key, true) +
        '<span style="margin-left:4px" title="입력한 항목 / 전체"><span id="ps-prog-' + sec.key + '">' + prog.filled + '/' + prog.total + '</span> 입력 · <span id="ps-stat-' + sec.key + '">' + _psSecStatusText(sec) + '</span>' + (nFiles ? ' · 📎 ' + nFiles : '') + '</span></span>' +
    '</div>' +
    '<div style="padding:8px 10px;display:' + (collapsed ? 'none' : 'block') + '">' + body + '</div>' +
  '</div>';
}

function _psItemRowHtml(it) {
  var v = _ps.sheet.values[it.key], r = _ps.sheet.remarks[it.key];
  var label = '<span style="font-size:11px;font-weight:600;color:var(--t2)" title="' + _psEsc(it.help || '') + '">' + _psOwnerDot(it.owner) + _psEsc(it.label) + (it.unit ? ' <span style="font-weight:400;color:var(--t6)">(' + _psEsc(it.unit) + ')</span>' : '') + (it.help ? ' <span style="color:var(--t6);cursor:help">ⓘ</span>' : '') + _psRecentMark(it.key) + '</span>';
  var stBtn = '<span>' + _psStatusBtnHtml(it.key) + '</span>';
  if (!_ps.canEdit) {
    return label + '<span style="font-size:11px;color:var(--t2);white-space:pre-wrap">' + (v != null && String(v) !== '' ? _psEsc(v) : '<span style="color:var(--t6)">—</span>') +
      (r ? ' <span style="font-size:10px;color:var(--t5)">· ' + _psEsc(r) + '</span>' : '') + '</span>' + stBtn;
  }
  return label + '<span style="display:flex;flex-wrap:wrap;gap:4px;min-width:0">' +
      '<span style="flex:3 1 170px;min-width:0">' + _psInputHtml(it, v, 'class="ps-v si" data-k="' + it.key + '" data-o="' + _psEsc(it.owner || '') + '"') + '</span>' +
      '<input class="ps-r si" data-k="' + it.key + '" data-o="' + _psEsc(it.owner || '') + '" value="' + _psEsc(r || '') + '" placeholder="비고" style="flex:1 1 90px;min-width:0;font-size:11px;padding:3px 6px;box-sizing:border-box">' +
    '</span>' + stBtn;
}

/* 입력 요소 — select 에 없는 기존 값은 선택지로 보존 */
function _psInputHtml(def, v, attrs) {
  var val = v == null ? '' : String(v);
  var st = 'font-size:11px;padding:3px 6px;width:100%;box-sizing:border-box';
  if (def.type === 'select') {
    var opts = (def.options || []).slice();
    if (val && opts.indexOf(val) < 0) opts.push(val);
    return '<select ' + attrs + ' style="' + st + '"><option value=""></option>' + opts.map(function (o) { return '<option' + (o === val ? ' selected' : '') + '>' + _psEsc(o) + '</option>'; }).join('') + '</select>';
  }
  if (def.type === 'textarea') return '<textarea ' + attrs + ' rows="2" style="' + st + ';resize:vertical">' + _psEsc(val) + '</textarea>';
  return '<input ' + attrs + (def.type === 'number' ? ' inputmode="decimal"' : '') + ' value="' + _psEsc(val) + '" placeholder="' + _psEsc(def.help || '') + '" style="' + st + '">';
}

/* ── 표 항목 (축 구성·외부장치 목록 등) — 열 묶음 머리글을 누르면 묶음을 접는다 ── */
function _psTableHtml(it) {
  var cols = it.columns || [];
  var rows = Array.isArray(_ps.sheet.values[it.key]) ? _ps.sheet.values[it.key] : [];
  if (!_ps.canEdit) rows = rows.filter(function (r) { return !specRowEmpty(r); });
  var hidden = _ps.hiddenGroups[it.key] || {};
  var groups = [], hasGroups = cols.some(function (c) { return c.group; });
  cols.forEach(function (c) { var g = c.group || ''; if (!groups.length || groups[groups.length - 1].name !== g) groups.push({ name: g, n: 0, owner: c.owner }); groups[groups.length - 1].n++; });
  var th = 'font-size:9.5px;font-weight:600;color:var(--t5);padding:3px 4px;border-bottom:1px solid var(--bd);white-space:nowrap;text-align:left;text-transform:none;letter-spacing:0';
  var h = '<div style="margin-top:8px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
    '<span style="font-size:11px;font-weight:700;color:var(--t2)">' + _psOwnerDot(it.owner) + _psEsc(it.label) + ' <span style="font-weight:400;color:var(--t6)">' + rows.filter(function (r) { return !specRowEmpty(r); }).length + '행</span>' + _psRecentMark(it.key) + '</span>' +
    '<span style="display:flex;gap:6px;align-items:center">' + _psStatusBtnHtml(it.key) +
    (_ps.canEdit ? '<button class="btn btn-g btn-s" style="font-size:10px;padding:1px 7px" onclick="psAddRow(\'' + it.key + '\')">+ 행</button>' : '') + '</span>' +
    '</div><div style="overflow-x:auto;border:1px solid var(--bd);border-radius:6px"><table class="ps-tbl" data-k="' + it.key + '" style="border-collapse:collapse;min-width:100%">';
  if (hasGroups) {
    h += '<thead><tr>' + groups.map(function (g) {
      var off = !!hidden[g.name];
      return '<th colspan="' + (off ? 1 : g.n) + '" onclick="psToggleGroup(\'' + it.key + '\',\'' + _psJs(g.name) + '\')" title="눌러서 ' + (off ? '펼치기' : '접기') + '" style="' + th + ';cursor:pointer;background:var(--bg-i);border-left:1px solid var(--bd)">' + (off ? '▸ ' : '▾ ') + _psEsc(g.name || '—') + '</th>';
    }).join('') + (_ps.canEdit ? '<th style="' + th + ';background:var(--bg-i)"></th>' : '') + '</tr>';
  } else h += '<thead>';
  h += '<tr>' + cols.map(function (c) {
    if (hidden[c.group || '']) return c === _psFirstOfGroup(cols, c.group) ? '<th style="' + th + '">…</th>' : '';
    return '<th data-o="' + _psEsc(c.owner || '') + '" style="' + th + '">' + _psOwnerDot(c.owner) + _psEsc(c.label) + (c.unit ? ' <span style="font-weight:400;color:var(--t6)">(' + _psEsc(c.unit) + ')</span>' : '') + '</th>';
  }).join('') + (_ps.canEdit ? '<th style="' + th + '"></th>' : '') + '</tr></thead><tbody>';
  if (!rows.length) h += '<tr><td colspan="' + (cols.length + 1) + '" style="font-size:10px;color:var(--t6);padding:8px;text-align:center">' + (_ps.canEdit ? '+ 행 으로 추가하세요' : '—') + '</td></tr>';
  rows.forEach(function (r) { h += _psTableRowHtml(it, r); });
  return h + '</tbody></table></div></div>';
}
function _psFirstOfGroup(cols, g) { for (var i = 0; i < cols.length; i++) if ((cols[i].group || '') === (g || '')) return cols[i]; return null; }
function _psTableRowHtml(it, r) {
  var cols = it.columns || [], hidden = _ps.hiddenGroups[it.key] || {};
  var td = 'padding:2px 3px;border-bottom:1px solid var(--bd)';
  var cells = cols.map(function (c) {
    var g = c.group || '';
    if (hidden[g]) {
      if (c !== _psFirstOfGroup(cols, g)) return '';
      // 접힌 묶음: 값은 숨은 입력으로 유지 (저장 시 사라지지 않게)
      return '<td style="' + td + ';color:var(--t6);font-size:10px;text-align:center">…' +
        cols.filter(function (x) { return (x.group || '') === g; }).map(function (x) { return '<input type="hidden" class="ps-c" data-c="' + x.key + '" value="' + _psEsc(r[x.key] == null ? '' : r[x.key]) + '">'; }).join('') + '</td>';
    }
    if (!_ps.canEdit) return '<td style="' + td + ';font-size:11px;color:var(--t2);white-space:nowrap">' + _psEsc(r[c.key] == null ? '' : r[c.key]) + '</td>';
    var minW = c.type === 'number' ? 64 : c.type === 'select' ? 96 : 110;
    return '<td data-o="' + _psEsc(c.owner || '') + '" style="' + td + ';min-width:' + minW + 'px">' + _psInputHtml(c, r[c.key], 'class="ps-c si" data-c="' + c.key + '" data-o="' + _psEsc(c.owner || '') + '"') + '</td>';
  }).join('');
  return '<tr data-rid="' + _psEsc(r.id || specNewId('r')) + '">' + cells +
    (_ps.canEdit ? '<td style="' + td + ';white-space:nowrap"><button class="btn btn-g btn-s" title="행 복제" onclick="psDupRow(this)" style="padding:1px 5px;font-size:10px">⧉</button><button class="btn btn-d btn-s" title="행 삭제" onclick="psDelRow(this)" style="padding:1px 5px;font-size:10px;margin-left:2px">✕</button></td>' : '') +
    '</tr>';
}

/* ── 기타 사양 (양식 밖 항목 · v13.160 데이터) ─────────────────────────── */
function _psExtraHtml() {
  var ex = _ps.sheet.extra;
  var discs = SPEC_DISCIPLINES.filter(function (d) { return _ps.canEdit || (ex[d.key] || []).length; });
  if (!discs.length) return '';
  var h = '<div style="margin-bottom:12px;border:1px solid var(--bd);border-radius:8px;overflow:hidden">' +
    '<div style="background:var(--bg-i);padding:6px 10px;font-size:12px;font-weight:700;color:var(--t2)">🗂 기타 사양 <span style="font-size:10px;font-weight:400;color:var(--t6)">표준 양식에 없는 항목 · 이전 형식 사양</span></div><div style="padding:6px 10px">';
  discs.forEach(function (d) {
    var rows = ex[d.key] || [];
    h += '<div style="margin:4px 0 8px"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;font-weight:600;color:var(--t3)">' + _psOwnerDot(d.key) + _psEsc(d.label) + '</span>' +
      (_ps.canEdit ? '<button class="btn btn-g btn-s" style="font-size:10px;padding:1px 7px" onclick="psAddExtra(\'' + d.key + '\')">+ 행</button>' : '') + '</div>' +
      '<div id="ps-extra-' + d.key + '">' + rows.map(function (r) { return _psExtraRowHtml(d.key, r); }).join('') + '</div></div>';
  });
  return h + '</div></div>';
}
function _psExtraRowHtml(disc, r) {
  r = r || {};
  if (!_ps.canEdit) {
    return '<div style="display:grid;grid-template-columns:150px 1fr 120px;gap:5px;padding:3px 0;font-size:11px;border-bottom:1px solid var(--bd)"><span style="font-weight:600;color:var(--t2)">' + _psEsc(r.item) + '</span><span style="color:var(--t2);white-space:pre-wrap">' + _psEsc(r.value) + '</span><span style="color:var(--t5)">' + _psEsc(r.remark) + '</span></div>';
  }
  return '<div class="ps-x" data-d="' + disc + '" data-id="' + _psEsc(r.id || specNewId('sp')) + '" style="display:grid;grid-template-columns:150px 1fr 120px 24px;gap:5px;align-items:center;padding:2px 0">' +
    '<input class="si ps-xi" data-o="' + disc + '" value="' + _psEsc(r.item) + '" placeholder="항목" style="font-size:11px;padding:3px 6px">' +
    '<input class="si ps-xv" data-o="' + disc + '" value="' + _psEsc(r.value) + '" placeholder="내용" style="font-size:11px;padding:3px 6px">' +
    '<input class="si ps-xr" data-o="' + disc + '" value="' + _psEsc(r.remark) + '" placeholder="비고" style="font-size:11px;padding:3px 6px">' +
    '<button class="btn btn-d btn-s" title="행 삭제" onclick="this.closest(\'.ps-x\').remove();_psMarkDirty()" style="padding:1px 5px;font-size:10px">✕</button></div>';
}

/* ── 첨부 블록 ─────────────────────────────────────────────────────────── */
function _psFilesBlockHtml(secKey) {
  return '<div id="ps-files-' + secKey + '" style="margin-top:8px">' + _psFilesInnerHtml(secKey) + '</div>';
}
function _psFilesInnerHtml(secKey) {
  var list = _ps.files.filter(function (f) { return f.sectionKey === secKey; });
  var h = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start">';
  list.forEach(function (f) {
    var fid = _psJs(f.id), name = _psEsc(f.name || f.caption || '');
    var del = _ps.canEdit ? '<button onclick="event.stopPropagation();psDeleteFile(\'' + fid + '\')" title="삭제" style="position:absolute;top:2px;right:2px;border:none;background:rgba(0,0,0,.55);color:#fff;border-radius:4px;font-size:10px;cursor:pointer;padding:0 4px">✕</button>' : '';
    if (f.kind === 'image') {
      h += '<div style="position:relative;width:96px"><img src="' + _psEsc(f.url || f.data || '') + '" loading="lazy" decoding="async" onclick="psViewImages(\'' + secKey + '\',\'' + fid + '\')" style="width:96px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--bd);cursor:zoom-in;background:var(--bg-i)" alt="' + name + '">' +
        '<div style="font-size:9.5px;color:var(--t5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + name + '">' + name + '</div>' + del + '</div>';
    } else if (f.kind === 'drawio') {
      h += '<div style="position:relative;width:180px;border:1px solid var(--bd);border-radius:6px;padding:4px;background:var(--bg)">' +
        (f.previewSvg ? '<img src="' + _psEsc(f.previewSvg) + '" onclick="psViewDrawio(\'' + fid + '\')" style="width:170px;height:110px;object-fit:contain;cursor:zoom-in;background:#fff;border-radius:4px" alt="' + name + '">' : '<div style="height:110px;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--t6)">미리보기 없음</div>') +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:4px;margin-top:2px"><span style="font-size:10px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + name + '">✏️ ' + name + '</span>' +
        (_ps.canEdit ? '<button class="btn btn-g btn-s" style="font-size:9.5px;padding:0 5px" onclick="psDrawioEdit(\'' + fid + '\')">편집</button>' : '') + '</div>' + del + '</div>';
    } else {
      h += '<div style="position:relative;width:150px;border:1px solid var(--bd);border-radius:6px;padding:6px 18px 6px 6px;cursor:pointer;background:var(--bg)" onclick="psDownloadFile(\'' + fid + '\')" title="' + name + ' 내려받기">' +
        '<div style="font-size:11px;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📄 ' + name + '</div>' +
        '<div style="font-size:9.5px;color:var(--t6)">' + (f.size ? Math.max(1, Math.round(f.size / 1024)) + ' KB' : '') + '</div>' + del + '</div>';
    }
  });
  if (!list.length) return '';   // 첨부 버튼은 섹션 머리글에 (_psAttachBtnsHtml)
  return h + '</div>';
}
function _psAttachBtnsHtml(secKey, small) {
  if (!_ps.canEdit) return '';
  var st = 'cursor:pointer;font-size:' + (small ? '9.5px;padding:1px 6px' : '10px');
  var gcs = _ps.storage === 'gcs';
  return '<label class="btn btn-g btn-s" onclick="event.stopPropagation()" style="' + st + '" title="' + (gcs ? '이미지·PDF·도면 파일 (50MB 이하)' : '파일 스토리지 미설정 — 이미지만 압축해 첨부') + '">📎 ' + (gcs ? '첨부' : '이미지') +
      '<input type="file" multiple ' + (gcs ? '' : 'accept="image/*" ') + 'style="display:none" onchange="psUpload(this,\'' + secKey + '\')"></label>' +
    '<button class="btn btn-g btn-s" style="' + st + '" onclick="event.stopPropagation();psDrawioNew(\'' + secKey + '\')" title="draw.io 로 도면 그리기">✏️ 도면</button>';
}
function _psRefreshFiles(secKey) {
  return psFilesGet(_ps.projId).then(function (r) {
    if (!_ps) return;
    _ps.files = r.files; _ps.storage = r.storage;
    var keys = secKey ? [secKey] : _ps.files.map(function (f) { return f.sectionKey; });
    keys.forEach(function (k) { var box = document.getElementById('ps-files-' + k); if (box) box.innerHTML = _psFilesInnerHtml(k); });
  });
}

/* ═══ 입력 수집 ═══ */
/* DOM → 사양서. peek=true 면 상태를 바꾸지 않고 사본을 돌려준다(구성도 미리보기용).
   DOM 에 없는 값(양식에서 빠진 항목 등)은 그대로 둔다. */
function _psCollect(peek) {
  var el = document.getElementById('pdSpec');
  var sheet = peek ? specClone(_ps.sheet) : _ps.sheet;
  if (!el || !_ps.canEdit) return sheet;
  el.querySelectorAll('.ps-v').forEach(function (i) { sheet.values[i.getAttribute('data-k')] = i.value; });
  el.querySelectorAll('.ps-r').forEach(function (i) {
    var k = i.getAttribute('data-k');
    if (i.value.trim()) sheet.remarks[k] = i.value; else delete sheet.remarks[k];
  });
  el.querySelectorAll('table.ps-tbl').forEach(function (t) {
    var rows = [];
    t.querySelectorAll('tbody tr[data-rid]').forEach(function (tr) {
      var row = { id: tr.getAttribute('data-rid') };
      tr.querySelectorAll('.ps-c').forEach(function (i) { row[i.getAttribute('data-c')] = i.value; });
      rows.push(row);   // 빈 행도 유지 — 다시 그릴 때 사라지지 않게 (저장할 때 _psForSave 가 뺀다)
    });
    sheet.values[t.getAttribute('data-k')] = rows;
  });
  if (el.querySelector('.ps-x') || document.getElementById('ps-extra-design')) {
    SPEC_DISCIPLINES.forEach(function (d) { sheet.extra[d.key] = []; });
    el.querySelectorAll('.ps-x').forEach(function (r) {
      var item = r.querySelector('.ps-xi').value.trim(), value = r.querySelector('.ps-xv').value.trim(), remark = r.querySelector('.ps-xr').value.trim();
      if (item || value || remark) sheet.extra[r.getAttribute('data-d')].push({ id: r.getAttribute('data-id'), item: item, value: value, remark: remark });
    });
  }
  return sheet;
}

var _psInputTimer = null;
function _psOnInput(e) {
  if (!_ps || !e.target || !e.target.closest) return;
  if (!e.target.closest('.ps-v,.ps-r,.ps-c,.ps-xi,.ps-xv,.ps-xr')) return;
  _psMarkDirty();
  // 확정된 항목의 값을 고치면 검토로 되돌린다 — 제작·구매가 바뀐 값을 확정으로 오해하지 않게
  var key = e.target.getAttribute('data-k') || (e.target.closest('table.ps-tbl') ? e.target.closest('table.ps-tbl').getAttribute('data-k') : null);
  if (key && !e.target.classList.contains('ps-r') && specStatusOf(_ps.sheet, key) === 'fixed') {
    _ps.sheet.status[key] = 'review';
    _psPaintStatus(key);
    if (!_ps.warnedFixed[key]) { _ps.warnedFixed[key] = true; _psToast('확정된 항목을 수정해 "검토"로 바뀌었습니다. 확인 후 다시 확정하세요.', 'warn'); }
  }
  clearTimeout(_psInputTimer);
  _psInputTimer = setTimeout(function () {
    _psRefreshDiagram();
    if (_ps && _ps.schema) {
      var peek = _psCollect(true);
      _ps.schema.sections.forEach(function (sec) { var p = document.getElementById('ps-prog-' + sec.key); if (p) { var g = specSectionProgress(sec, peek); p.textContent = g.filled + '/' + g.total; } });
    }
  }, 350);
}
function _psMarkDirty() {
  if (!_ps) return;
  _ps.dirty = true;
  var d = document.getElementById('psDirty'); if (d) d.style.display = 'inline';
}

/* ═══ 화면 동작 ═══ */
function psSetFilter(k) { if (!_ps) return; _psCollect(); _ps.filter = k; _psRender(); }
/* 고른 분야의 칸만 입력 가능 — 나머지는 흐리게 + 비활성 */
function _psApplyFilter() {
  var el = document.getElementById('pdSpec'); if (!el || !_ps) return;
  var f = _ps.filter;
  el.querySelectorAll('[data-o]').forEach(function (n) {
    var o = n.getAttribute('data-o');
    var off = f !== 'all' && o && o !== f;
    if (n.tagName === 'TH' || n.tagName === 'TD') { n.style.opacity = off ? '0.45' : ''; return; }
    n.style.opacity = off ? '0.45' : '';
    n.disabled = off;
  });
}
function psToggleSection(k) {
  if (!_ps) return;
  _psCollect();
  _ps.collapsed[k] = !_ps.collapsed[k];
  _psRender();
}
function psToggleGroup(itemKey, g) {
  if (!_ps) return;
  _psCollect();
  var h = _ps.hiddenGroups[itemKey] = _ps.hiddenGroups[itemKey] || {};
  h[g] = !h[g];
  _psRender();
}
function psAddRow(itemKey) {
  if (!_ps) return;
  _psCollect();
  var rows = Array.isArray(_ps.sheet.values[itemKey]) ? _ps.sheet.values[itemKey] : [];
  rows.push({ id: specNewId('r') });
  _ps.sheet.values[itemKey] = rows;
  _psRender();
  _psMarkDirty();
}
function psDupRow(btn) {
  var tr = btn.closest('tr'); if (!tr) return;
  var copy = tr.cloneNode(true);
  copy.setAttribute('data-rid', specNewId('r'));
  // cloneNode 는 select 선택값을 복사하지 않는다 → 직접 맞춤
  var src = tr.querySelectorAll('select'), dst = copy.querySelectorAll('select');
  for (var i = 0; i < src.length; i++) dst[i].value = src[i].value;
  tr.parentNode.insertBefore(copy, tr.nextSibling);
  _psMarkDirty(); _psRefreshDiagram();
}
function psDelRow(btn) {
  var tr = btn.closest('tr'); if (!tr) return;
  tr.remove(); _psMarkDirty(); _psRefreshDiagram();
}
function psAddExtra(disc) {
  var box = document.getElementById('ps-extra-' + disc); if (!box) return;
  box.insertAdjacentHTML('beforeend', _psExtraRowHtml(disc, {}));
  _psApplyFilter();
}

/* 양식으로 시작 / 새 버전 적용 */
function psStartWithTemplate() {
  var sel = document.getElementById('psStartTpl'); if (!sel || !_ps) return;
  var t = psChoosableTemplates().filter(function (x) { return x.id === sel.value; })[0]; if (!t) return;
  _psApplyTpl(t.id, t.version);
}
function psUpgradeTemplate() {
  if (!_ps || !_ps.sheet.templateId) return;
  var latest = psLatestVersion(_ps.sheet.templateId);
  if (!latest) return;
  if (!confirm('표준 양식 v' + latest + ' 을 적용합니다.\n값은 항목 키 기준으로 유지되고, 새 양식에서 빠진 항목의 값은 화면에 보이지 않게 됩니다(데이터는 남음).')) return;
  _psApplyTpl(_ps.sheet.templateId, latest);
}
function _psApplyTpl(id, ver) {
  _psCollect();
  psTemplateSchema(id, ver).then(function (schema) {
    var moved = specApplyTemplate(_ps.sheet, id, ver, schema);
    _ps.schema = schema;
    _ps.dirty = true;
    _psRender();
    _psToast('표준 양식을 적용했습니다' + (moved ? ' — 기타 사양 ' + moved + '건을 표준 항목으로 옮김' : '') + '. 💾 저장을 눌러 반영하세요.');
  }).catch(function () { _psToast('양식을 불러오지 못했습니다.', 'error'); });
}

/* 저장용 사본 — 빈 표 행 제거 */
function _psForSave(sheet) {
  var out = specClone(sheet);
  Object.keys(out.values).forEach(function (k) { if (Array.isArray(out.values[k])) out.values[k] = out.values[k].filter(function (r) { return !specRowEmpty(r); }); });
  return out;
}

/* 저장 — 처음 불러온 값 대비 바뀐 칸만 보낸다(PATCH). 그 사이 다른 사람이 저장한 칸은 서버가 합치고,
   같은 칸을 먼저 바꾼 경우만 충돌로 돌려준다. 저장 후에는 서버 문서(다른 사람 변경 포함)로 화면을 다시 그린다. */
function pdSpecSave(projId) {
  if (!_ps || _ps.projId !== projId) return;
  var sheet = _psForSave(_psCollect());
  var changes = _ps.baseIsV2 ? specDiff(_ps.base, sheet, _ps.schema) : [{ path: [], from: _ps.rawBase, to: sheet, label: '사양서 (표준 형식으로 전환)' }];
  if (!changes.length) { _psToast('바뀐 내용이 없습니다.'); _ps.dirty = false; var d0 = document.getElementById('psDirty'); if (d0) d0.style.display = 'none'; return; }
  var btn = document.getElementById('pdSpecSaveBtn'); if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }
  _psPatch(changes).then(function (ok) {
    if (btn) { btn.disabled = false; btn.textContent = '💾 저장'; }
    if (!ok) return;
    var n = (_ps.conflicts || []).length;
    _psToast(n ? '저장했습니다. 다른 사람이 먼저 바꾼 ' + n + '건은 저장된 값으로 표시됩니다.' : '사양서가 저장되었습니다.', n ? 'warn' : undefined);
  });
}
/* 변경분 전송 → 서버 문서로 상태 갱신. 성공 여부를 돌려준다 */
function _psPatch(changes) {
  var projId = _ps.projId;
  return apiFetch('/api/projects/' + encodeURIComponent(projId) + '/specs', { method: 'PATCH', body: JSON.stringify({ changes: changes }) }).then(function (r) {
    if (!_ps || _ps.projId !== projId) return false;
    var d = toCamel(r.data || {});
    _ps.conflicts = (r.conflicts || []).concat((_ps.conflicts || []).filter(function (c) { return !(r.conflicts || []).some(function (x) { return JSON.stringify(x.path) === JSON.stringify(c.path); }) && !changes.some(function (x) { return JSON.stringify(x.path) === JSON.stringify(c.path); }); }));
    _psSetBase(d.specs);
    _ps.sheet = specNormalize(d.specs);
    _ps.proj.specs = d.specs; _ps.proj.specsUpdatedBy = d.specsUpdatedBy; _ps.proj.specsUpdatedAt = d.specsUpdatedAt;
    if (window._pdProj && window._pdProj.id === projId) window._pdProj.specs = d.specs;
    if (typeof _pdInvalidate === 'function') { _pdInvalidate('proj'); _pdInvalidate('projAll'); }
    _ps.dirty = false;
    return psChangesGet(projId).then(function (list) { if (_ps && _ps.projId === projId) { _ps.changes = list; _psRender(); } return true; });
  }).catch(function (err) {
    if (err && err.status === 409) {
      _psToast('다른 사람이 사양서 형식을 바꿨습니다. 새로 불러옵니다 — 입력한 내용을 다시 확인하세요.', 'warn');
      psReload();
      return false;
    }
    _psToast('❌ ' + _psErrMsg(err, '저장 실패'), 'error');
    return false;
  });
}
/* 탭을 처음부터 다시 불러오기 (저장 안 된 입력은 사라진다) */
function psReload() {
  var el = document.getElementById('pdSpec'); if (!el || !_ps) return;
  if (typeof _pdInvalidate === 'function') { _pdInvalidate('proj'); _pdInvalidate('projAll'); }
  el.removeAttribute('data-rendered');
  pdRenderSpec(_ps.projId);
}

/* ═══ 변경 이력 ═══ */
function psOpenHistory() {
  if (!_ps) return;
  return wmGuardedModal('psHistory', function () {
    return psChangesGet(_ps.projId).then(function (list) {
      _ps.changes = list;
      var kindLbl = { edit: '수정', copy: '복사', template: '양식' };
      var html = list.length ? list.map(function (row) {
        var ch = row.changes || [];
        return '<div style="border:1px solid var(--bd);border-radius:6px;padding:6px 10px;margin-bottom:6px">' +
          '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><b style="color:var(--t1)">' + _psEsc(row.changedByName || '') + '</b>' +
          '<span style="color:var(--t5)">' + _psEsc(kindLbl[row.kind] || row.kind) + ' · ' + ch.length + '건 · ' + _psEsc(String(row.changedAt || '').slice(0, 16).replace('T', ' ')) + '</span></div>' +
          ch.slice(0, 30).map(function (c) {
            return '<div style="font-size:10.5px;color:var(--t3);padding:1px 0">· ' + _psEsc(c.label || (c.path || []).join('.')) + (row.kind === 'copy' ? '' : _psFmtChange(c)) + '</div>';
          }).join('') + (ch.length > 30 ? '<div style="font-size:10px;color:var(--t6)">… 외 ' + (ch.length - 30) + '건</div>' : '') + '</div>';
      }).join('') : '<div style="font-size:11px;color:var(--t6);padding:14px;text-align:center">아직 변경 이력이 없습니다.</div>';
      createModal({ id: 'psHistoryModal', titleText: '🕘 사양서 변경 이력 (최근 100회)', html: '<div style="max-height:64vh;overflow-y:auto">' + html + '</div>', width: '680px', closeOnEsc: true, closeOnOverlay: true });
    });
  }, 'psHistoryModal');
}

/* ═══ 이전 프로젝트 복사 ═══ */
function psOpenCopy() {
  if (!_ps || !_ps.canEdit) return;
  return wmGuardedModal('psCopy', _psBuildCopyModal, 'psCopyModal');
}
function _psBuildCopyModal() {
  var srcP = (typeof pmGetProjects === 'function') ? pmGetProjects() : (typeof projGetAll === 'function' ? projGetAll() : Promise.resolve([]));
  return Promise.resolve(srcP).then(function (list) {
    var cands = (list || []).filter(function (p) {
      if (p.id === _ps.projId) return false;
      var s = specNormalize(p.specs);
      return s.templateId || Object.keys(s.values).length || SPEC_DISCIPLINES.some(function (d) { return s.extra[d.key].length; });
    });
    window._psCopyCands = cands;
    var html = '<input id="psCopySearch" class="si" placeholder="프로젝트 이름·수주번호 검색" oninput="_psCopyFilter()" style="font-size:12px;padding:6px 10px;margin-bottom:8px;width:100%;box-sizing:border-box">' +
      '<div id="psCopyList" style="max-height:52vh;overflow-y:auto"></div>' +
      '<div style="font-size:10px;color:var(--t6);margin-top:8px">사양서 본문과 draw.io 도면을 복사합니다(이미지·파일 첨부는 복사하지 않음). 현재 사양서는 덮어씁니다.</div>';
    createModal({ id: 'psCopyModal', titleText: '📋 이전 프로젝트 사양서 복사', html: html, width: '560px', closeOnEsc: true });
    _psCopyFilter();
  });
}
function _psCopyFilter() {
  var box = document.getElementById('psCopyList'); if (!box) return;
  var q = ((document.getElementById('psCopySearch') || {}).value || '').trim().toLowerCase();
  var list = (window._psCopyCands || []).filter(function (p) { return !q || String(p.name || '').toLowerCase().indexOf(q) >= 0 || String(p.orderNo || '').toLowerCase().indexOf(q) >= 0; });
  box.innerHTML = list.length ? list.map(function (p) {
    var s = specNormalize(p.specs);
    var info = s.templateId ? psTemplateName(s.templateId) + ' v' + s.templateVersion : '기타 사양만';
    return '<div onclick="psCopyFrom(\'' + _psJs(p.id) + '\')" style="cursor:pointer;padding:8px 10px;border:1px solid var(--bd);border-radius:6px;margin-bottom:5px;display:flex;justify-content:space-between;gap:8px" onmouseover="this.style.background=\'var(--bg-i)\'" onmouseout="this.style.background=\'\'">' +
      '<span style="font-size:12px;color:var(--t1);font-weight:600">' + _psEsc(p.name || p.id) + (p.orderNo ? ' <span style="font-weight:400;color:var(--t5);font-size:10px">' + _psEsc(p.orderNo) + '</span>' : '') + '</span>' +
      '<span style="font-size:10px;color:var(--t5);white-space:nowrap">' + _psEsc(info) + '</span></div>';
  }).join('') : '<div style="font-size:11px;color:var(--t6);padding:14px;text-align:center">사양서가 있는 다른 프로젝트가 없습니다.</div>';
}
function psCopyFrom(srcId) {
  var src = (window._psCopyCands || []).filter(function (p) { return p.id === srcId; })[0];
  if (!src || !_ps) return;
  if (!confirm('"' + (src.name || srcId) + '" 의 사양서로 현재 사양서를 덮어씁니다. 계속할까요?')) return;
  var projId = _ps.projId;
  apiFetch('/api/projects/' + encodeURIComponent(projId) + '/specs/copy-from/' + encodeURIComponent(srcId), { method: 'POST', body: JSON.stringify({ specs: specCopySheet(src.specs) }) })
    .then(function (r) {
      var ov = document.getElementById('psCopyModal'); if (ov) ov.remove();
      var d = toCamel(r.data || {});
      if (!_ps || _ps.projId !== projId) return;
      _psSetBase(d.specs);
      _ps.sheet = specNormalize(d.specs);
      _ps.proj.specs = d.specs; _ps.proj.specsUpdatedBy = d.specsUpdatedBy; _ps.proj.specsUpdatedAt = d.specsUpdatedAt;
      _ps.dirty = false; _ps.conflicts = [];
      if (typeof _pdInvalidate === 'function') { _pdInvalidate('proj'); _pdInvalidate('projAll'); }
      return Promise.all([psTemplateSchema(_ps.sheet.templateId, _ps.sheet.templateVersion).catch(function () { return null; }), psFilesGet(projId), psChangesGet(projId)]).then(function (res) {
        _ps.schema = res[0]; _ps.files = res[1].files; _ps.storage = res[1].storage; _ps.changes = res[2];
        _psRender();
        _psToast('사양서를 복사했습니다' + (r.copiedDrawings ? ' (도면 ' + r.copiedDrawings + '개 포함)' : '') + '.');
      });
    }).catch(function (err) { _psToast('❌ ' + _psErrMsg(err, '복사 실패'), 'error'); });
}

/* ═══ XLSX 내보내기 ═══ */
function psExportXlsx() {
  if (!_ps) return;
  if (typeof XLSX === 'undefined') { _psToast('SheetJS(xlsx) 라이브러리를 불러올 수 없습니다.', 'error'); return; }
  var sheet = _psCollect(true), name = _ps.proj.name || _ps.projId;
  var out = specSheetRows(name, _ps.schema || { sections: [] }, sheet);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['프로젝트', '섹션', '항목', '값', '단위', '비고', '상태']].concat(out.rows)), '사양서');
  var used = { '사양서': true };
  out.tables.forEach(function (t) {
    var nm = String(t.label).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 28) || t.key, n = nm, i = 2;
    while (used[n]) n = nm + ' ' + (i++);
    used[n] = true;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t.rows), n);
  });
  var bom = specBom(sheet);
  if (bom.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['구분', '품목', '모델', '수량', '비고']].concat(bom.map(function (r) { return [r.group, r.name, r.model, r.qty, r.note]; }))), '부품 요약');
  var checks = specChecks(sheet);
  if (checks.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['확인이 필요한 값']].concat(checks.map(function (c) { return [c.text]; }))), '확인 필요');
  var day = (typeof localDate === 'function') ? localDate() : new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, '사양서_' + String(name).replace(/[\\\/:*?"<>|]/g, '_') + '_' + day + '.xlsx');
}

/* ═══ 첨부 ═══ */
function psUpload(input, secKey) {
  if (!_ps) return;
  var files = Array.prototype.slice.call(input.files || []);
  input.value = '';
  if (!files.length) return;
  var projId = _ps.projId, ok = 0, fail = 0, skipped = 0;
  _psToast('첨부 업로드 중... (' + files.length + '개)');
  // 순차 처리 — 대용량 여러 장 동시 처리 시 브라우저 메모리 급증 방지(v13.150 과 같은 이유)
  files.reduce(function (p, file) {
    return p.then(function () {
      return _psUploadOne(projId, secKey, file).then(function (r) { if (r === 'skip') skipped++; else ok++; })
        .catch(function (err) { fail++; console.warn('[psUpload]', file.name, err); });
    });
  }, Promise.resolve()).then(function () {
    _psRefreshFiles(secKey);
    var msg = ok + '개 첨부' + (fail ? ', 실패 ' + fail : '') + (skipped ? ', 이미지가 아니라 건너뜀 ' + skipped + ' (파일 스토리지 미설정)' : '');
    _psToast(msg, fail || skipped ? 'warn' : undefined);
  });
}
function _psUploadOne(projId, secKey, file) {
  var isImg = /^image\//.test(file.type || '');
  var ext = (String(file.name).split('.').pop() || '').toLowerCase();
  if (_ps.storage === 'gcs') {
    var mime = file.type || 'application/octet-stream';
    return apiFetch(_psFilesUrl(projId) + '/upload-url', { method: 'POST', body: JSON.stringify({ name: file.name, mimeType: mime, ext: ext, size: file.size }) })
      .then(function (r) {
        return fetch(r.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: file }).then(function (up) {
          if (!up.ok) throw new Error('업로드 실패 (HTTP ' + up.status + ')');
          return apiFetch(_psFilesUrl(projId), { method: 'POST', body: JSON.stringify({ sectionKey: secKey, kind: isImg ? 'image' : 'file', name: file.name, mime: mime, size: file.size, storageKey: r.data.storageKey }) });
        });
      });
  }
  if (!isImg) return Promise.resolve('skip');
  if (typeof _pimgDownscale !== 'function') return Promise.reject(new Error('이미지 압축 기능 없음'));
  return _pimgDownscale(file, 1600, 0.85).then(function (data) {
    return apiFetch(_psFilesUrl(projId), { method: 'POST', body: JSON.stringify({ sectionKey: secKey, kind: 'image', name: file.name, mime: 'image/jpeg', size: data.length, data: data }) });
  });
}
function psViewImages(secKey, fid) {
  var imgs = _ps.files.filter(function (f) { return f.sectionKey === secKey && f.kind === 'image'; });
  var idx = 0; imgs.forEach(function (f, i) { if (f.id === fid) idx = i; });
  if (typeof pimgOpenViewer === 'function') pimgOpenViewer(imgs.map(function (f) { return { src: f.url || f.data, caption: f.name }; }), idx);
}
function psViewDrawio(fid) {
  var f = _ps.files.filter(function (x) { return x.id === fid; })[0];
  if (f && f.previewSvg && typeof pimgOpenViewer === 'function') pimgOpenViewer([{ src: f.previewSvg, caption: f.name }], 0);
}
function psDownloadFile(fid) {
  apiFetch(_psFilesUrl(_ps.projId, fid) + '/download-url').then(function (r) { window.open(r.data.downloadUrl, '_blank', 'noopener'); })
    .catch(function (err) { _psToast('❌ ' + _psErrMsg(err, '다운로드 실패'), 'error'); });
}
function psDeleteFile(fid) {
  var f = _ps.files.filter(function (x) { return x.id === fid; })[0]; if (!f) return;
  if (!confirm('"' + (f.name || '첨부') + '" 을(를) 삭제할까요?')) return;
  apiFetch(_psFilesUrl(_ps.projId, fid), { method: 'DELETE' }).then(function () { _psRefreshFiles(f.sectionKey); _psToast('삭제했습니다.'); })
    .catch(function (err) { _psToast('❌ ' + _psErrMsg(err, '삭제 실패'), 'error'); });
}

/* ═══ draw.io 도면 (embed 모드 — 도면 데이터는 브라우저 안에서만 오가고 diagrams.net 에 저장되지 않는다) ═══ */
function psDrawioNew(secKey) {
  var nm = prompt('도면 이름', secKey === PS_HW_SECTION ? '하드웨어 구조도' : '도면');
  if (nm == null) return;
  return psDrawioOpen({ secKey: secKey, name: nm.trim() || '도면', xml: '' });
}
function psDrawioFromAuto() {
  if (!_ps) return;
  var L = _psDgLayout();
  if (L.empty) { _psToast('모션 컨트롤러·축 구성·외부장치 값을 먼저 채우세요.', 'warn'); return; }
  var nm = prompt('도면 이름', '하드웨어 구조도');
  if (nm == null) return;
  return psDrawioOpen({ secKey: PS_HW_SECTION, name: nm.trim() || '하드웨어 구조도', xml: specDiagramDrawioXml(L) });
}
function psDrawioEdit(fid) {
  if (!_ps) return;
  var projId = _ps.projId;
  return apiFetch(_psFilesUrl(projId, fid)).then(function (r) {
    var f = toCamel(r.data);
    return psDrawioOpen({ secKey: f.sectionKey, name: f.name || '도면', xml: f.drawioXml || '', fileId: f.id });
  }).catch(function (err) { _psToast('❌ ' + _psErrMsg(err, '도면을 불러오지 못했습니다.'), 'error'); });
}
function psDrawioOpen(o) {
  return wmGuardedModal('psDrawio', function () { _psBuildDrawio(o); }, 'psDrawioModal', { timeoutMs: 8000 });
}
function _psBuildDrawio(o) {
  var projId = _ps.projId;
  var st = { xml: o.xml || '', fileId: o.fileId || null, exitAfter: false, saving: false };
  var m = createModal({
    id: 'psDrawioModal', width: '100vw',
    overlayStyle: 'padding:0', boxStyle: 'padding:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0;overflow:hidden;display:flex;flex-direction:column',
    html: '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;border-bottom:1px solid var(--bd);background:var(--bg-p)">' +
      '<span style="font-size:12px;font-weight:700;color:var(--t1)">✏️ ' + _psEsc(o.name) + ' <span id="psDrawioStatus" style="font-weight:400;color:var(--t5);font-size:11px;margin-left:6px">편집기를 여는 중...</span></span>' +
      '<span style="font-size:10px;color:var(--t6)">편집기 오른쪽 위 "저장"(Ctrl+S) · "나가기"로 닫기</span></div>' +
      '<iframe id="psDrawioFrame" src="' + PS_DRAWIO_URL + '" style="flex:1;width:100%;height:calc(100vh - 36px);border:0;background:#fff"></iframe>'
  });
  var frame = document.getElementById('psDrawioFrame');
  function status(t) { var s = document.getElementById('psDrawioStatus'); if (s) s.textContent = t; }
  function post(msg) { if (frame && frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify(msg), '*'); }
  function close() { window.removeEventListener('message', onMsg); m.close(); }
  function save(svg) {
    var body = { drawioXml: st.xml, previewSvg: svg || '' };
    var req = st.fileId
      ? apiFetch(_psFilesUrl(projId, st.fileId), { method: 'PUT', body: JSON.stringify(body) })
      : apiFetch(_psFilesUrl(projId), { method: 'POST', body: JSON.stringify(Object.assign({ kind: 'drawio', sectionKey: o.secKey, name: o.name }, body)) });
    return req.then(function (r) {
      st.fileId = (r && r.data && r.data.id) || st.fileId;
      st.saving = false;
      post({ action: 'status', message: '저장됨', modified: false });
      status('저장됨 · ' + new Date().toTimeString().slice(0, 5));
      if (_ps && _ps.projId === projId) _psRefreshFiles(o.secKey);
      if (st.exitAfter) close();
    }).catch(function (err) {
      st.saving = false;
      status('저장 실패');
      _psToast('❌ ' + _psErrMsg(err, '도면 저장 실패'), 'error');
    });
  }
  function onMsg(ev) {
    if (!frame || ev.source !== frame.contentWindow || typeof ev.data !== 'string') return;
    var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.event === 'init') { post({ action: 'load', xml: st.xml, autosave: 0, title: o.name }); status(''); }
    else if (msg.event === 'save') {
      if (st.saving) return;
      st.saving = true; st.xml = msg.xml; st.exitAfter = !!msg.exit;
      status('저장 중...');
      post({ action: 'export', format: 'svg', spinKey: 'saving' });   // 미리보기 SVG → 'export' 이벤트
    }
    else if (msg.event === 'export') save(msg.data);
    else if (msg.event === 'exit') {
      // 저장하지 않은 변경이 있으면 확인 — 취소하면 편집기를 그대로 둔다
      if (msg.modified && !confirm('저장하지 않은 변경이 있습니다. 저장하지 않고 닫을까요?')) return;
      close();
    }
  }
  window.addEventListener('message', onMsg);
}

/* 저장하지 않은 사양서가 있으면 페이지를 떠날 때 확인 */
if (typeof window !== 'undefined' && !window._psUnloadBound) {
  window._psUnloadBound = true;
  window.addEventListener('beforeunload', function (e) {
    if (_ps && _ps.dirty && document.getElementById('pdSpec')) { e.preventDefault(); e.returnValue = ''; }
  });
}
