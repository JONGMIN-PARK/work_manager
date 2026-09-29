/* ═══════════════════════════════════════════════════════════════════════
   spec-template-admin.js — 표준 사양서 양식 관리 (관리자 전용, v13.196)
   ─────────────────────────────────────────────────────────────────────
   · 양식 = 섹션(분야) → 항목(텍스트·긴 글·숫자·선택·표) → 표의 열(유형·담당 분야·묶음)
   · 초안 저장 → 검사 → 발행(v1, v2 …). 발행본은 바뀌지 않고, 사양서는 발행 버전을 참조한다.
   · 회사 양식이 없으면 내장 기본 양식을 복사해 시작.
   진입: 사양 탭 "⚙️ 표준 양식" (project-spec.js) → showSpecTemplateAdmin()
   서버: routes/spec-templates.js / 전역 의존: apiFetch, toCamel, createModal, wmGuardedModal, showToast, spec-schema.js
   ═══════════════════════════════════════════════════════════════════════ */

var _sta = null;   // { list, id, name, description, draft, currentVersion, isDefault, sel, openCols:{itemIdx:true}, dirty }

function _staEsc(s) { return (typeof eH === 'function') ? eH(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _staToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _staKey(prefix) { return (prefix || 'f') + '_' + Math.random().toString(36).slice(2, 8); }

function showSpecTemplateAdmin() {
  if (!(typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin')) { _staToast('관리자만 접근할 수 있습니다.', 'warn'); return; }
  return wmGuardedModal('specTplAdmin', _staBuildModal, 'specTplAdminModal');
}

function _staBuildModal() {
  return psTemplatesList(true).then(function (list) {
    _sta = { list: list, sel: 0, openCols: {}, dirty: false };
    var first = list.filter(function (t) { return t.isDefault; })[0] || list[0];
    if (first) _staLoad(first); else _sta.id = null;
    createModal({ id: 'specTplAdminModal', titleText: '⚙️ 표준 사양서 양식 관리', html: '<div id="staBody"></div>', width: '1180px', boxStyle: 'max-height:92vh', onClose: function () { _sta = null; } });
    _staRender();
  });
}
function _staLoad(t) {
  _sta.id = t.id; _sta.name = t.name; _sta.description = t.description || '';
  _sta.draft = specClone(t.draft && t.draft.sections ? t.draft : (t.schema || { sections: [] }));
  _sta.currentVersion = t.currentVersion || 0; _sta.isDefault = !!t.isDefault;
  _sta.sel = 0; _sta.openCols = {}; _sta.dirty = false;
}
function staPick(id) {
  if (_sta.dirty && !confirm('저장하지 않은 변경이 있습니다. 버리고 다른 양식을 열까요?')) { _staRender(); return; }
  var t = _sta.list.filter(function (x) { return x.id === id; })[0]; if (t) { _staLoad(t); _staRender(); }
}

/* 새 양식 — from: 'builtin' | 'current' | 'blank' */
function staCreate(from) {
  var name = prompt('새 양식 이름', from === 'builtin' ? '회사 표준 사양서' : (from === 'current' && _sta.name ? _sta.name + ' 사본' : '새 사양서 양식'));
  if (name == null || !name.trim()) return;
  var draft = from === 'builtin' ? specClone(SPEC_BUILTIN_TEMPLATE.schema) : from === 'current' && _sta.draft ? specClone(_sta.draft) : { sections: [{ key: 'sec1', label: '새 섹션', discipline: 'design', items: [] }] };
  apiFetch('/api/spec-templates', { method: 'POST', body: JSON.stringify({ name: name.trim(), draft: draft }) }).then(function (r) {
    var t = toCamel(r.data);
    _sta.list.push(t); _staLoad(t); _staRender();
    psInvalidateTemplates();
    _staToast('양식을 만들었습니다. 내용을 고친 뒤 "발행"하면 사양서에서 고를 수 있습니다.');
  }).catch(function (e) { _staToast('❌ ' + ((e && e.message) || '생성 실패'), 'error'); });
}

/* ── 렌더 ─────────────────────────────────────────────────────────────── */
var _STA_TYPE_LABEL = { text: '텍스트', textarea: '긴 글', number: '숫자', select: '선택', table: '표' };
var _STA_COL_TYPES = ['text', 'number', 'select'];
function _staOwnerSel(val, onchange, allowAll) {
  var opts = (allowAll ? [{ key: 'all', label: '공용' }] : []).concat(SPEC_DISCIPLINES);
  return '<select class="si" onchange="' + onchange + '" style="font-size:10.5px;padding:2px 4px">' + opts.map(function (d) { return '<option value="' + d.key + '"' + (d.key === val ? ' selected' : '') + '>' + _staEsc(d.label) + '</option>'; }).join('') + '</select>';
}
function _staInp(val, oninput, ph, w, mono) {
  return '<input class="si" value="' + _staEsc(val == null ? '' : val) + '" placeholder="' + _staEsc(ph || '') + '" oninput="' + oninput + '" style="font-size:10.5px;padding:2px 5px;width:' + (w || '100%') + ';box-sizing:border-box' + (mono ? ';font-family:monospace' : '') + '">';
}

function _staRender() {
  var box = document.getElementById('staBody'); if (!box || !_sta) return;
  var list = _sta.list;
  var top = '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px">' +
    (list.length ? '<select class="si" onchange="staPick(this.value)" style="font-size:12px;padding:4px 8px">' + list.map(function (t) {
      return '<option value="' + _staEsc(t.id) + '"' + (t.id === _sta.id ? ' selected' : '') + '>' + _staEsc(t.name) + (t.isDefault ? ' ★' : '') + (t.currentVersion ? ' · v' + t.currentVersion : ' · 미발행') + '</option>';
    }).join('') + '</select>' : '') +
    '<button class="btn btn-g btn-s" onclick="staCreate(\'builtin\')" title="내장 기본 양식(일반 기구·축 구성·모션·IO·외부장치 …)을 복사해 시작">+ 기본 양식에서 새로 만들기</button>' +
    (_sta.id ? '<button class="btn btn-g btn-s" onclick="staCreate(\'current\')">+ 이 양식 복제</button>' : '') +
    '<button class="btn btn-g btn-s" onclick="staCreate(\'blank\')">+ 빈 양식</button>' +
    '</div>';
  if (!_sta.id) {
    box.innerHTML = top + '<div style="border:1px dashed var(--bd);border-radius:8px;padding:18px;font-size:12px;color:var(--t4);line-height:1.7">아직 회사 양식이 없습니다. 지금은 모든 프로젝트가 <b>내장 기본 양식</b>을 씁니다.<br>' +
      '"기본 양식에서 새로 만들기"로 복사한 뒤 회사 표준에 맞게 항목을 고치고 발행하세요.</div>';
    return;
  }
  var secs = _sta.draft.sections || [];
  if (_sta.sel >= secs.length) _sta.sel = Math.max(0, secs.length - 1);
  var head = '<div style="display:grid;grid-template-columns:1fr 2fr auto;gap:6px;align-items:center;margin-bottom:10px">' +
    _staInp(_sta.name, "_sta.name=this.value;_staDirty()", '양식 이름') +
    _staInp(_sta.description, "_sta.description=this.value;_staDirty()", '설명 (선택)') +
    '<span style="font-size:10.5px;color:var(--t5);white-space:nowrap">' + (_sta.currentVersion ? '발행 v' + _sta.currentVersion : '미발행') + (_sta.isDefault ? ' · ★ 기본 양식' : '') + '</span></div>';
  var left = '<div style="border:1px solid var(--bd);border-radius:8px;padding:6px;max-height:62vh;overflow-y:auto">' +
    secs.map(function (s, i) {
      var on = i === _sta.sel, c = PS_DISC_COLOR[s.discipline] || '#64748B';
      return '<div onclick="staSelSec(' + i + ')" style="cursor:pointer;padding:5px 6px;border-radius:6px;margin-bottom:2px;border-left:3px solid ' + c + ';background:' + (on ? 'var(--bg-i)' : 'transparent') + ';display:flex;justify-content:space-between;align-items:center;gap:4px">' +
        '<span style="font-size:11.5px;font-weight:' + (on ? 700 : 500) + ';color:var(--t2)"><span id="staSecName-' + i + '">' + _staEsc(s.label || '(이름 없음)') + '</span> <span style="font-size:9.5px;color:var(--t6)">' + (s.items || []).length + '</span></span>' +
        '<span style="white-space:nowrap"><button class="btn btn-g btn-s" style="padding:0 4px;font-size:9px" onclick="event.stopPropagation();staMoveSec(' + i + ',-1)">↑</button><button class="btn btn-g btn-s" style="padding:0 4px;font-size:9px" onclick="event.stopPropagation();staMoveSec(' + i + ',1)">↓</button></span></div>';
    }).join('') +
    '<button class="btn btn-g btn-s" style="width:100%;margin-top:4px;font-size:10.5px" onclick="staAddSec()">+ 섹션</button></div>';
  var right = secs.length ? _staSectionEditor(secs[_sta.sel], _sta.sel) : '<div style="font-size:11px;color:var(--t6)">섹션을 추가하세요.</div>';
  var foot = '<div id="staErrs" style="margin-top:8px"></div>' +
    '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--bd)">' +
      '<span style="display:flex;gap:6px"><button class="btn btn-d btn-s" onclick="staDelete()">양식 삭제</button>' +
      (!_sta.isDefault ? '<button class="btn btn-g btn-s" onclick="staSetDefault()" title="새 사양서를 시작할 때 먼저 선택되는 양식">★ 기본 양식으로 지정</button>' : '') + '</span>' +
      '<span style="display:flex;gap:6px;align-items:center"><span id="staDirty" style="font-size:10px;color:' + SEM_COLOR.warn + ';display:' + (_sta.dirty ? 'inline' : 'none') + '">● 저장 안 됨</span>' +
      '<button class="btn btn-g btn-s" onclick="staCheck()">검사</button>' +
      '<button class="btn btn-g btn-s" onclick="staSaveDraft()">초안 저장</button>' +
      '<button class="btn btn-p btn-s" onclick="staPublish()">발행 (v' + ((_sta.currentVersion || 0) + 1) + ')</button></span>' +
    '</div>' +
    '<div style="font-size:10px;color:var(--t6);margin-top:6px">항목 키는 값을 저장하는 이름입니다. 발행한 뒤 키를 바꾸면 기존 사양서의 그 항목 값이 새 버전에서 보이지 않습니다(이름·순서·선택지는 자유롭게 바꿔도 됨).</div>';
  box.innerHTML = top + head + '<div style="display:grid;grid-template-columns:220px 1fr;gap:10px">' + left + right + '</div>' + foot;
}

function _staSectionEditor(s, si) {
  var h = '<div style="border:1px solid var(--bd);border-radius:8px;padding:8px 10px;max-height:62vh;overflow-y:auto">' +
    '<div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:6px;align-items:center;margin-bottom:8px">' +
      _staInp(s.label, "_staSec().label=this.value;_staDirty();_staRenderLeftSoon()", '섹션 이름') +
      _staInp(s.key, "_staSec().key=this.value.trim();_staDirty()", '섹션 키', null, true) +
      _staOwnerSel(s.discipline, "_staSec().discipline=this.value;_staDirty();_staRender()", true) +
      '<button class="btn btn-d btn-s" style="font-size:10px" onclick="staDelSec()">섹션 삭제</button>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:22px 1.6fr 1fr 78px 78px 64px 1.4fr 1fr 58px;gap:4px;font-size:9.5px;color:var(--t6);padding:0 2px 2px"><span></span><span>항목 이름</span><span>키</span><span>유형</span><span>담당</span><span>단위</span><span>선택지 (쉼표로 구분)</span><span>도움말</span><span></span></div>';
  (s.items || []).forEach(function (it, ii) {
    var isTbl = it.type === 'table', isSel = it.type === 'select';
    h += '<div style="display:grid;grid-template-columns:22px 1.6fr 1fr 78px 78px 64px 1.4fr 1fr 58px;gap:4px;align-items:center;padding:2px;border-top:1px solid var(--bd)">' +
      '<span style="font-size:9.5px;color:var(--t6);text-align:right">' + (ii + 1) + '</span>' +
      _staInp(it.label, "_staItem(" + ii + ").label=this.value;_staDirty()", '이름') +
      _staInp(it.key, "_staItem(" + ii + ").key=this.value.trim();_staDirty()", 'key', null, true) +
      '<select class="si" onchange="staSetType(' + ii + ',this.value)" style="font-size:10.5px;padding:2px 4px">' + SPEC_ITEM_TYPES.map(function (t) { return '<option value="' + t + '"' + (t === it.type ? ' selected' : '') + '>' + _STA_TYPE_LABEL[t] + '</option>'; }).join('') + '</select>' +
      _staOwnerSel(it.owner || s.discipline, "_staItem(" + ii + ").owner=this.value;_staDirty()") +
      (isTbl ? '<span></span>' : _staInp(it.unit, "_staItem(" + ii + ").unit=this.value;_staDirty()", '단위')) +
      (isTbl ? '<button class="btn btn-g btn-s" style="font-size:10px" onclick="staToggleCols(' + ii + ')">' + (_sta.openCols[ii] ? '▾' : '▸') + ' 열 ' + (it.columns || []).length + '개 편집</button>'
        : isSel ? _staInp((it.options || []).join(', '), "_staItem(" + ii + ").options=_staSplit(this.value);_staDirty()", '예: A1, Ajinextek, 기타') : '<span style="font-size:9.5px;color:var(--t6)">—</span>') +
      (isTbl ? '<span></span>' : _staInp(it.help, "_staItem(" + ii + ").help=this.value;_staDirty()", '입력 안내')) +
      '<span style="white-space:nowrap"><button class="btn btn-g btn-s" style="padding:0 4px;font-size:9px" onclick="staMoveItem(' + ii + ',-1)">↑</button><button class="btn btn-g btn-s" style="padding:0 4px;font-size:9px" onclick="staMoveItem(' + ii + ',1)">↓</button><button class="btn btn-d btn-s" style="padding:0 4px;font-size:9px" onclick="staDelItem(' + ii + ')">✕</button></span>' +
    '</div>';
    if (isTbl && _sta.openCols[ii]) h += _staColsEditor(it, ii);
  });
  h += '<div style="display:flex;gap:6px;margin-top:6px"><button class="btn btn-g btn-s" style="font-size:10.5px" onclick="staAddItem(\'text\')">+ 항목</button><button class="btn btn-g btn-s" style="font-size:10.5px" onclick="staAddItem(\'table\')">+ 표 항목</button></div>';
  return h + '</div>';
}
function _staColsEditor(it, ii) {
  var cols = it.columns || [];
  var g = '20px 1.4fr 1fr 70px 78px 1fr 60px 1.4fr 44px';
  var h = '<div style="margin:2px 0 8px 26px;padding:6px 8px;border:1px dashed var(--bd);border-radius:6px;background:var(--bg-i)">' +
    '<div style="display:grid;grid-template-columns:' + g + ';gap:4px;font-size:9.5px;color:var(--t6);padding-bottom:2px"><span></span><span>열 이름</span><span>키</span><span>유형</span><span>담당</span><span>열 묶음</span><span>단위</span><span>선택지</span><span></span></div>';
  cols.forEach(function (c, ci) {
    var P = "_staCol(" + ii + "," + ci + ")";
    h += '<div style="display:grid;grid-template-columns:' + g + ';gap:4px;align-items:center;padding:1px 0">' +
      '<span style="font-size:9.5px;color:var(--t6);text-align:right">' + (ci + 1) + '</span>' +
      _staInp(c.label, P + ".label=this.value;_staDirty()", '이름') +
      _staInp(c.key, P + ".key=this.value.trim();_staDirty()", 'key', null, true) +
      '<select class="si" onchange="' + P + '.type=this.value;_staDirty();_staRender()" style="font-size:10.5px;padding:2px 4px">' + _STA_COL_TYPES.map(function (t) { return '<option value="' + t + '"' + (t === c.type ? ' selected' : '') + '>' + _STA_TYPE_LABEL[t] + '</option>'; }).join('') + '</select>' +
      _staOwnerSel(c.owner || it.owner, P + ".owner=this.value;_staDirty()") +
      _staInp(c.group, P + ".group=this.value;_staDirty()", '예: 기구·전장·SW') +
      _staInp(c.unit, P + ".unit=this.value;_staDirty()", '단위') +
      (c.type === 'select' ? _staInp((c.options || []).join(', '), P + ".options=_staSplit(this.value);_staDirty()", '쉼표로 구분') : '<span style="font-size:9.5px;color:var(--t6)">—</span>') +
      '<span style="white-space:nowrap"><button class="btn btn-g btn-s" style="padding:0 3px;font-size:9px" onclick="staMoveCol(' + ii + ',' + ci + ',-1)">↑</button><button class="btn btn-d btn-s" style="padding:0 3px;font-size:9px" onclick="staDelCol(' + ii + ',' + ci + ')">✕</button></span>' +
    '</div>';
  });
  return h + '<button class="btn btn-g btn-s" style="font-size:10px;margin-top:4px" onclick="staAddCol(' + ii + ')">+ 열</button></div>';
}

/* ── 편집 동작 ─────────────────────────────────────────────────────────── */
function _staSec() { return _sta.draft.sections[_sta.sel]; }
function _staItem(ii) { return _staSec().items[ii]; }
function _staCol(ii, ci) { return _staItem(ii).columns[ci]; }
function _staSplit(v) { return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
function _staDirty() { _sta.dirty = true; var d = document.getElementById('staDirty'); if (d) d.style.display = 'inline'; }
function _staRenderLeftSoon() { var n = document.getElementById('staSecName-' + _sta.sel); if (n) n.textContent = _staSec().label || '(이름 없음)'; }
function _staMove(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return false; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; return true; }

function staSelSec(i) { _sta.sel = i; _sta.openCols = {}; _staRender(); }
function staAddSec() { _sta.draft.sections.push({ key: _staKey('sec'), label: '새 섹션', discipline: 'design', items: [] }); _sta.sel = _sta.draft.sections.length - 1; _staDirty(); _staRender(); }
function staDelSec() { var s = _staSec(); if (!confirm('섹션 "' + (s.label || '') + '" 과 항목 ' + (s.items || []).length + '개를 삭제할까요?')) return; _sta.draft.sections.splice(_sta.sel, 1); _staDirty(); _staRender(); }
function staMoveSec(i, d) { if (_staMove(_sta.draft.sections, i, d)) { if (_sta.sel === i) _sta.sel = i + d; else if (_sta.sel === i + d) _sta.sel = i; _staDirty(); _staRender(); } }
function staAddItem(type) {
  var s = _staSec(); s.items = s.items || [];
  var it = { key: _staKey(type === 'table' ? 'tbl' : 'f'), label: type === 'table' ? '새 표' : '새 항목', type: type, owner: s.discipline === 'all' ? 'design' : s.discipline };
  if (type === 'table') { it.columns = [{ key: 'name', label: '이름', type: 'text', owner: it.owner }]; _sta.openCols[s.items.length] = true; }
  s.items.push(it); _staDirty(); _staRender();
}
function staDelItem(ii) { var it = _staItem(ii); if (!confirm('항목 "' + (it.label || '') + '" 을 삭제할까요?')) return; _staSec().items.splice(ii, 1); _sta.openCols = {}; _staDirty(); _staRender(); }
function staMoveItem(ii, d) { if (_staMove(_staSec().items, ii, d)) { _sta.openCols = {}; _staDirty(); _staRender(); } }
function staSetType(ii, t) {
  var it = _staItem(ii); it.type = t;
  if (t === 'table' && !(it.columns || []).length) { it.columns = [{ key: 'name', label: '이름', type: 'text', owner: it.owner }]; _sta.openCols[ii] = true; }
  if (t === 'select' && !(it.options || []).length) it.options = [];
  _staDirty(); _staRender();
}
function staToggleCols(ii) { _sta.openCols[ii] = !_sta.openCols[ii]; _staRender(); }
function staAddCol(ii) { var it = _staItem(ii); it.columns = it.columns || []; it.columns.push({ key: _staKey('c'), label: '새 열', type: 'text', owner: it.owner }); _staDirty(); _staRender(); }
function staDelCol(ii, ci) { _staItem(ii).columns.splice(ci, 1); _staDirty(); _staRender(); }
function staMoveCol(ii, ci, d) { if (_staMove(_staItem(ii).columns, ci, d)) { _staDirty(); _staRender(); } }

/* ── 저장·발행 ─────────────────────────────────────────────────────────── */
function _staShowErrs(errs) {
  var el = document.getElementById('staErrs'); if (!el) return;
  el.innerHTML = errs.length ? '<div style="border:1px solid ' + SEM_COLOR.danger + ';background:' + SEM_COLOR.danger + '14;border-radius:6px;padding:6px 10px;font-size:11px;color:var(--t2);max-height:120px;overflow-y:auto"><b>수정이 필요한 곳 ' + errs.length + '건</b>' + errs.map(function (e) { return '<div>· ' + _staEsc(e) + '</div>'; }).join('') + '</div>' : '';
}
function staCheck() {
  var errs = specValidateSchema(_sta.draft);
  _staShowErrs(errs);
  if (!errs.length) _staToast('검사 통과 — 발행할 수 있습니다.');
  return errs;
}
function _staPut() {
  return apiFetch('/api/spec-templates/' + encodeURIComponent(_sta.id), { method: 'PUT', body: JSON.stringify({ name: _sta.name, description: _sta.description, draft: _sta.draft }) })
    .then(function (r) {
      var t = toCamel(r.data);
      _sta.list = _sta.list.map(function (x) { return x.id === t.id ? Object.assign({}, x, t) : x; });
      _sta.dirty = false;
      return t;
    });
}
function staSaveDraft() {
  if (!String(_sta.name || '').trim()) { _staToast('양식 이름을 입력하세요.', 'warn'); return; }
  _staPut().then(function () { _staRender(); _staToast('초안을 저장했습니다. 발행해야 사양서에 반영됩니다.'); })
    .catch(function (e) { _staToast('❌ ' + ((e && e.message) || '저장 실패'), 'error'); });
}
function staPublish() {
  if (staCheck().length) { _staToast('검사에서 문제가 발견되어 발행하지 않았습니다.', 'warn'); return; }
  var ver = (_sta.currentVersion || 0) + 1;
  if (!confirm('v' + ver + ' 로 발행합니다.\n이미 작성 중인 사양서는 기존 버전을 유지하고, 각 사양서에서 "새 표준 적용"을 눌러야 바뀝니다.')) return;
  _staPut().then(function () {
    return apiFetch('/api/spec-templates/' + encodeURIComponent(_sta.id) + '/publish', { method: 'POST', body: '{}' });
  }).then(function (r) {
    var t = toCamel(r.data);
    _sta.currentVersion = t.currentVersion;
    _sta.list = _sta.list.map(function (x) { return x.id === t.id ? Object.assign({}, x, t) : x; });
    psInvalidateTemplates();
    _staRender();
    _staToast('v' + t.currentVersion + ' 발행 완료');
    _staRefreshSpecTab();
  }).catch(function (e) { _staToast('❌ ' + ((e && e.data && e.data.message) || (e && e.message) || '발행 실패'), 'error'); });
}
function staSetDefault() {
  apiFetch('/api/spec-templates/' + encodeURIComponent(_sta.id), { method: 'PUT', body: JSON.stringify({ isDefault: true }) }).then(function () {
    _sta.isDefault = true;
    _sta.list.forEach(function (x) { x.isDefault = x.id === _sta.id; });
    psInvalidateTemplates();
    _staRender();
    _staToast('기본 양식으로 지정했습니다.');
  }).catch(function (e) { _staToast('❌ ' + ((e && e.message) || '실패'), 'error'); });
}
function staDelete() {
  if (!confirm('양식 "' + _sta.name + '" 을 삭제할까요?\n이 양식으로 작성된 사양서는 발행 버전이 남아 있어 계속 열립니다.')) return;
  apiFetch('/api/spec-templates/' + encodeURIComponent(_sta.id), { method: 'DELETE' }).then(function () {
    _sta.list = _sta.list.filter(function (x) { return x.id !== _sta.id; });
    psInvalidateTemplates();
    if (_sta.list.length) _staLoad(_sta.list[0]); else _sta.id = null;
    _staRender();
    _staToast('삭제했습니다.');
  }).catch(function (e) { _staToast('❌ ' + ((e && e.message) || '삭제 실패'), 'error'); });
}
/* 사양 탭이 열려 있으면 양식 목록을 새로 받아 "새 표준 적용" 버튼 등을 갱신 */
function _staRefreshSpecTab() {
  if (typeof _ps === 'undefined' || !_ps) return;
  psTemplatesList(true).then(function () { if (_ps) { _psCollect(); _psRender(); } });
}
