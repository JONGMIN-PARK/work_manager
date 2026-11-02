/* project-docs.js — 프로젝트 상세 📂 문서 탭 (v13.307)
 *   프로젝트를 보다가 바로 문서를 넣고 · 찾고 · 내려받기. 넣는 것은 document-manager.js docUploadFiles 공용.
 *   - 올릴 폴더: 고른 폴더 → 없으면 지금 단계 폴더 (설계 단계면 '설계')
 *   - 탭 어디에 끌어다 놓아도 올라감 · Ctrl+V (탭이 보일 때) · 📤 단추
 *   - 폴더별 묶음 · 최근 순 · 이름 찾기 · ⬇ 내려받기 · ↗ 문서 화면에서 열기(미리보기 · AI 요약 · 버전)
 *   - 보기 전용(편집권 없음)이면 올리기 단추를 숨김 (.pd-ro .pd-edit-only)
 */
var _pdDocs = { projId: null, folders: [], files: [], folderId: '', q: '' };

function pdLoadDocs(projId) {
  var el = document.getElementById('pdDocs'); if (!el) return;
  if (_pdDocs.projId !== projId) _pdDocs = { projId: projId, folders: [], files: [], folderId: '', q: '' };
  el.innerHTML = '<div style="color:var(--t6);font-size:11px;padding:10px 0">로딩 중...</div>';
  var seq = _pdNextSeq('docs');
  var canEdit = !document.querySelector('#projDetailPanel.pd-ro');
  Promise.all([folderGetByProject(projId), fileGetByProject(projId)]).then(async function (r) {
    var folders = r[0];
    if (!folders.length && canEdit) { try { await createDefaultFolders(projId); folders = await folderGetByProject(projId); } catch (_) {} }
    if (_pdIsStale('docs', seq, projId)) return;
    _pdDocs.folders = _docSortFolders(folders);
    _pdDocs.files = r[1] || [];
    pdSetTabCount('docs', _pdDocs.files.length);
    pdRenderDocs();
  }).catch(function (e) {
    if (_pdIsStale('docs', seq, projId)) return;
    el.innerHTML = '<div style="color:var(--t5);font-size:11px;padding:10px 0">⚠️ 문서를 불러오지 못했습니다 — ' + eH((e && e.message) || '') + '</div>';
  });
}

function _pdDocsTarget() {
  var p = window._pdProj || {};
  var fo = _pdDocs.folderId ? _pdDocs.folders.filter(function (f) { return f.id === _pdDocs.folderId; })[0] : docPickFolder(_pdDocs.folders, p.currentPhase);
  return fo || null;
}

function pdRenderDocs() {
  var el = document.getElementById('pdDocs'); if (!el) return;
  var projId = _pdDocs.projId;
  var target = _pdDocsTarget();
  var q = (_pdDocs.q || '').toLowerCase();
  var files = _pdDocs.files.filter(function (f) {
    return !q || (f.name || '').toLowerCase().indexOf(q) >= 0 || (f.tags || []).some(function (t) { return String(t).toLowerCase().indexOf(q) >= 0; });
  });
  var h = '<div class="pdd-bar">' +
    '<div class="pd-edit-only pdd-up">' +
      '<button class="btn btn-p btn-s" onclick="document.getElementById(\'pdDocsInput\').click()">📤 문서 넣기</button>' +
      '<span class="pdd-to">→ <select id="pdDocsFolder" onchange="_pdDocs.folderId=this.value;pdRenderDocs()" title="넣을 폴더 — 비워 두면 지금 단계 폴더">' +
        '<option value="">지금 단계' + (target && !_pdDocs.folderId ? ' (' + eH(target.name) + ')' : '') + '</option>' +
        _pdDocs.folders.map(function (f) { return '<option value="' + eA(f.id) + '"' + (f.id === _pdDocs.folderId ? ' selected' : '') + '>' + (f.parentId ? '└ ' : '📁 ') + eH(f.name) + '</option>'; }).join('') +
      '</select></span>' +
      '<input type="file" id="pdDocsInput" multiple style="display:none" onchange="pdDocsUpload(this.files);this.value=\'\'">' +
    '</div>' +
    '<input class="si pdd-q" placeholder="문서 이름 · 태그 찾기" value="' + eA(_pdDocs.q) + '" oninput="_pdDocs.q=this.value;_pdDocsListOnly()">' +
    '<button class="btn btn-g btn-s" onclick="pdDocsOpenManager()" title="문서 화면 — 미리보기 · AI 요약 · 버전 · 폴더 관리">↗ 문서 화면</button>' +
  '</div>';
  h += '<div class="pdd-hint pd-edit-only">여기에 파일을 끌어다 놓거나 Ctrl+V — 모든 형식 · 파일당 50MB</div>';
  h += '<div id="pdDocsList">' + _pdDocsListHtml(files) + '</div>';
  el.innerHTML = h;
}
function _pdDocsListOnly() {
  var box = document.getElementById('pdDocsList'); if (!box) return;
  var q = (_pdDocs.q || '').toLowerCase();
  box.innerHTML = _pdDocsListHtml(_pdDocs.files.filter(function (f) {
    return !q || (f.name || '').toLowerCase().indexOf(q) >= 0 || (f.tags || []).some(function (t) { return String(t).toLowerCase().indexOf(q) >= 0; });
  }));
}
function _pdDocsListHtml(files) {
  if (!_pdDocs.files.length) {
    return '<div class="pdd-empty"><div style="font-size:30px;opacity:.7">📂</div><div>아직 문서가 없습니다</div>' +
      '<div class="pd-edit-only" style="font-size:10.5px;color:var(--t5);margin-top:4px">사양서 · 도면 · 견적 · 검수 자료를 여기에 끌어다 놓으세요</div></div>';
  }
  if (!files.length) return '<div class="pdd-empty">찾는 문서가 없습니다</div>';
  var byFolder = {};
  files.forEach(function (f) { (byFolder[f.folderId || ''] = byFolder[f.folderId || ''] || []).push(f); });
  var order = _pdDocs.folders.map(function (f) { return f.id; }).concat(['']);
  var h = '';
  order.forEach(function (fid) {
    var list = byFolder[fid]; if (!list || !list.length) return;
    var fo = _pdDocs.folders.filter(function (f) { return f.id === fid; })[0];
    list.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
    h += '<div class="pdd-grp"><div class="pdd-gh">📁 ' + eH(fo ? fo.name : '폴더 없음') + ' <span>' + list.length + '</span></div>';
    list.forEach(function (f) {
      var ic = getDocIcon(f.ext);
      var old = (f.tags || []).indexOf('이전버전') >= 0;
      h += '<div class="pdd-row' + (old ? ' pdd-old' : '') + '">' +
        '<span class="pdd-ic">' + ic.icon + '</span>' +
        '<span class="pdd-nm" title="' + eA(f.name) + '" onclick="pdDocsOpenManager(\'' + eA(f.id) + '\')">' + eH(f.name) + '</span>' +
        '<span class="pdd-mt">' + formatFileSize(f.size || 0) + (f.createdAt ? ' · ' + eH(String(f.createdAt).slice(0, 10)) : '') + '</span>' +
        '<button class="pdd-b" title="내려받기" onclick="docDownloadFile(\'' + eA(f.id) + '\')">⬇</button>' +
        '<button class="pdd-b" title="문서 화면에서 열기 (미리보기 · AI 요약)" onclick="pdDocsOpenManager(\'' + eA(f.id) + '\')">↗</button>' +
      '</div>';
    });
    h += '</div>';
  });
  return h;
}

function pdDocsUpload(fileList) {
  var projId = _pdDocs.projId; if (!projId) return;
  var t = _pdDocsTarget();
  return docUploadFiles(fileList, {
    projectId: projId, folderId: t ? t.id : null, phase: (window._pdProj || {}).currentPhase,
    onDone: function (n) {
      if (n && _pdDocs.projId === projId) pdLoadDocs(projId);
      if (n && typeof _docDataCache !== 'undefined' && _docDataCache.projId === projId) _docDataCache.projId = null;   // 문서 화면 캐시 비움
    }
  });
}

/** 문서 화면으로 — 이 프로젝트 · (있으면) 그 파일을 고른 채 */
function pdDocsOpenManager(fileId) {
  var projId = _pdDocs.projId || (window._pdProj && window._pdProj.id);
  if (typeof pdCloseDetail === 'function') pdCloseDetail();
  docSelProject = projId; docSelFolder = null; docSelFile = fileId || null; docFilePage = 1; docPreviewTab = 'preview';
  if (typeof _docDataCache !== 'undefined') _docDataCache.projId = null;
  setPage('project'); setMode('docs');
}

/* 끌어다 놓기 · 붙여넣기 — 문서 탭이 보일 때만, 편집권이 있을 때만 */
function _pdDocsActive() {
  var el = document.getElementById('pdDocs');
  return el && el.style.display !== 'none' && el.offsetParent && !document.querySelector('#projDetailPanel.pd-ro');
}
document.addEventListener('dragover', function (e) {
  if (!e.target.closest || !e.target.closest('#pdDocs') || !_pdDocsActive()) return;
  if (!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0)) return;
  e.preventDefault();
  document.getElementById('pdDocs').classList.add('pdd-on');
}, true);   // 먼저 받기 — 몸통의 업무일지 가져오기가 가로채지 않게 (preventDefault 를 보고 건너뜀)
document.addEventListener('dragleave', function (e) {
  var el = document.getElementById('pdDocs');
  if (el && !el.contains(e.relatedTarget)) el.classList.remove('pdd-on');
});
document.addEventListener('drop', function (e) {
  var el = document.getElementById('pdDocs');
  if (el) el.classList.remove('pdd-on');
  if (!e.target.closest || !e.target.closest('#pdDocs') || !_pdDocsActive()) return;
  var files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  e.preventDefault();
  pdDocsUpload(files);
}, true);
document.addEventListener('paste', function (e) {
  if (!_pdDocsActive()) return;
  var t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (document.querySelector('.wa-modal-overlay')) return;
  var files = (e.clipboardData && e.clipboardData.files) || [];
  if (!files.length) return;
  e.preventDefault();
  var d = new Date(), p2 = function (n) { return ('0' + n).slice(-2); };
  pdDocsUpload(Array.prototype.map.call(files, function (f, i) {
    if (f.name && f.name !== 'image.png') return f;
    var nm = '붙여넣기-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + (i ? '-' + i : '') + '.' + ((f.type.split('/')[1] || 'png').replace('jpeg', 'jpg'));
    try { return new File([f], nm, { type: f.type }); } catch (_) { return f; }
  }));
});
