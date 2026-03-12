/**
 * 프로젝트 문서 관리 모듈
 * 3-Panel: 폴더 트리 | 파일 목록 | 미리보기/AI요약
 */

/* ═══ PDF.js 워커 설정 ═══ */
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ═══ 상태 변수 ═══ */
var docSelProject = '';
var docSelFolder = null; // null = 전체
var docSelFile = null;
var docViewMode = 'card'; // 'card' | 'list'
var docPreviewTab = 'preview'; // 'preview' | 'summary'
var docFilePage = 1;
var docSearchKeyword = '';
var _docBlobUrls = [];

/* ═══ Blob URL 관리 ═══ */
function docRevokeBlobUrls() {
  _docBlobUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
  _docBlobUrls = [];
}
function docCreateBlobUrl(data, type) {
  var blob = new Blob([data], { type: type || 'application/octet-stream' });
  var url = URL.createObjectURL(blob);
  _docBlobUrls.push(url);
  return url;
}

/* ═══ 메인 렌더 ═══ */
async function renderDocManager() {
  var wrap = document.getElementById('mDocs');
  if (!wrap) return;
  docRevokeBlobUrls();

  var projects = await projGetAll();
  projects.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });

  // 프로젝트 미선택 시 첫 번째 자동 선택
  if (!docSelProject && projects.length) docSelProject = projects[0].id;

  var proj = projects.find(function (p) { return p.id === docSelProject; });

  var html = '<div class="pnl" style="padding:14px 18px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
  html += '<div style="display:flex;align-items:center;gap:10px">';
  html += '<span style="font-size:15px;font-weight:700;color:var(--t1)">📂 문서 관리</span>';
  html += '<select id="docProjSel" onchange="docSelectProject(this.value)" style="background:var(--bg-i);border:1px solid var(--bd);border-radius:7px;padding:6px 10px;font-size:11px;color:var(--t2);font-family:inherit;outline:none;max-width:250px">';
  html += '<option value="">프로젝트 선택...</option>';
  projects.forEach(function (p) {
    html += '<option value="' + p.id + '"' + (p.id === docSelProject ? ' selected' : '') + '>' + eH(p.name || p.orderNo || p.id) + '</option>';
  });
  html += '</select></div>';

  // 용량 표시
  if (proj) {
    var storage = await getProjectStorageSize(docSelProject);
    var pct = Math.round(storage.total / DOC_MAX_PROJECT * 100);
    html += '<div style="display:flex;align-items:center;gap:8px;font-size:10px;color:var(--t4)">';
    html += '<span>💾 ' + formatFileSize(storage.total) + ' / ' + formatFileSize(DOC_MAX_PROJECT) + '</span>';
    html += '<div style="width:80px;height:5px;background:var(--pt);border-radius:3px"><div style="width:' + Math.min(pct, 100) + '%;height:100%;background:' + (pct > 80 ? '#EF4444' : 'var(--ac)') + ';border-radius:3px"></div></div>';
    html += '<button class="btn btn-g btn-s" onclick="docShowStorageDashboard()" style="font-size:9px;padding:2px 6px" title="용량 대시보드">📊</button>';
    html += '</div>';
  }
  html += '</div></div>';

  if (!proj) {
    html += '<div style="text-align:center;padding:60px;color:var(--t5)"><div style="font-size:40px;margin-bottom:12px">📂</div><div style="font-size:13px">프로젝트를 선택하세요</div></div>';
    wrap.innerHTML = html;
    return;
  }

  // 폴더 + 파일 로드
  var folders = await folderGetByProject(docSelProject);
  if (!folders.length) {
    await createDefaultFolders(docSelProject);
    folders = await folderGetByProject(docSelProject);
  }
  folders.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

  var allFiles = await fileGetByProject(docSelProject);

  // 상단: 폴더 트리 + 파일 목록
  html += '<div style="display:grid;grid-template-columns:200px 1fr;gap:12px" id="docPanels">';
  html += renderFolderTree(folders, allFiles);
  html += renderFileList(folders, allFiles);
  html += '</div>';

  // 하단: 미리보기 / AI 요약
  html += '<div class="pnl" style="padding:0;overflow:hidden;display:flex;flex-direction:column;min-height:200px" id="docPreviewPanel">';
  html += renderPreviewPanel();
  html += '</div>';
  wrap.innerHTML = html;

  // 파일 선택 상태 복원
  if (docSelFile) {
    var f = await fileGet(docSelFile);
    if (f) showFilePreview(f);
  }
}

/* ═══ 프로젝트 선택 ═══ */
function docSelectProject(projId) {
  docSelProject = projId;
  docSelFolder = null;
  docSelFile = null;
  docFilePage = 1;
  renderDocManager();
}

/* ═══ 폴더 트리 렌더 ═══ */
function renderFolderTree(folders, allFiles) {
  var html = '<div class="pnl" style="padding:10px;overflow-y:auto">';
  html += '<div style="font-size:10px;font-weight:700;color:var(--t4);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;padding:0 6px">폴더</div>';

  // 전체 파일
  var allSel = docSelFolder === null ? 'background:var(--ac-bg);color:var(--ac-t);border-color:var(--ac)' : '';
  html += '<div onclick="docSelectFolder(null)" style="padding:6px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;margin-bottom:2px;display:flex;justify-content:space-between;align-items:center;border:1px solid transparent;transition:all .15s;' + allSel + '">';
  html += '<span>📁 전체</span><span class="badge" style="background:var(--bg-i);color:var(--t4);font-size:9px">' + allFiles.length + '</span></div>';

  // 루트 폴더
  var rootFolders = folders.filter(function (f) { return !f.parentId; });
  rootFolders.forEach(function (folder) {
    var count = allFiles.filter(function (f) { return f.folderId === folder.id; }).length;
    var sel = docSelFolder === folder.id ? 'background:var(--ac-bg);color:var(--ac-t);border-color:var(--ac)' : '';
    var hasMemo = folder.memo ? 'border-left:2px solid var(--ac);' : '';
    html += '<div onclick="docSelectFolder(\'' + folder.id + '\')" style="padding:6px 10px;border-radius:6px;cursor:pointer;font-size:11px;margin-bottom:2px;display:flex;justify-content:space-between;align-items:center;border:1px solid transparent;transition:all .15s;' + hasMemo + sel + '">';
    html += '<span>📁 ' + eH(folder.name) + '</span>';
    html += '<span style="display:flex;align-items:center;gap:4px"><span class="badge" style="background:var(--bg-i);color:var(--t4);font-size:9px">' + count + '</span>';
    html += '<span onclick="event.stopPropagation();docEditFolderMemo(\'' + folder.id + '\')" style="cursor:pointer;font-size:10px;color:' + (folder.memo ? 'var(--ac-t)' : 'var(--t5)') + '" title="' + (folder.memo ? eH(folder.memo.slice(0, 60)) : '메모 추가') + '">📝</span>';
    if (!folder.phase) html += '<span onclick="event.stopPropagation();docRenameFolder(\'' + folder.id + '\')" style="cursor:pointer;font-size:10px;color:var(--t5)" title="이름변경">✏️</span>';
    html += '</span></div>';

    // 하위 폴더
    var children = folders.filter(function (f) { return f.parentId === folder.id; });
    children.forEach(function (child) {
      var cCount = allFiles.filter(function (f) { return f.folderId === child.id; }).length;
      var cSel = docSelFolder === child.id ? 'background:var(--ac-bg);color:var(--ac-t);border-color:var(--ac)' : '';
      var cHasMemo = child.memo ? 'border-left:2px solid var(--ac);' : '';
      html += '<div onclick="docSelectFolder(\'' + child.id + '\')" style="padding:5px 10px 5px 26px;border-radius:6px;cursor:pointer;font-size:10px;margin-bottom:1px;display:flex;justify-content:space-between;align-items:center;border:1px solid transparent;transition:all .15s;' + cHasMemo + cSel + '">';
      html += '<span>📄 ' + eH(child.name) + '</span>';
      html += '<span style="display:flex;align-items:center;gap:4px"><span class="badge" style="background:var(--bg-i);color:var(--t4);font-size:9px">' + cCount + '</span>';
      html += '<span onclick="event.stopPropagation();docEditFolderMemo(\'' + child.id + '\')" style="cursor:pointer;font-size:10px;color:' + (child.memo ? 'var(--ac-t)' : 'var(--t5)') + '" title="' + (child.memo ? eH(child.memo.slice(0, 60)) : '메모 추가') + '">📝</span>';
      html += '</span></div>';
    });
  });

  html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bd)">';
  html += '<button class="btn btn-g btn-s" onclick="docAddFolder()" style="width:100%;justify-content:center">+ 폴더 추가</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

/* ═══ 폴더 선택 ═══ */
function docSelectFolder(folderId) {
  docSelFolder = folderId;
  docFilePage = 1;
  renderDocManager();
}

/* ═══ 파일 목록 렌더 ═══ */
function renderFileList(folders, allFiles) {
  var files = docSelFolder === null
    ? allFiles
    : allFiles.filter(function (f) { return f.folderId === docSelFolder; });

  // 검색 필터
  if (docSearchKeyword) {
    var kw = docSearchKeyword.toLowerCase();
    files = files.filter(function (f) {
      return (f.name || '').toLowerCase().indexOf(kw) >= 0
        || (f.memo || '').toLowerCase().indexOf(kw) >= 0
        || (f.tags || []).some(function (t) { return t.toLowerCase().indexOf(kw) >= 0; })
        || (docDeepSearch && (f.textCache || '').toLowerCase().indexOf(kw) >= 0);
    });
  }

  files.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

  var folderName = '전체';
  var selFolderObj = null;
  if (docSelFolder) {
    selFolderObj = folders.find(function (f) { return f.id === docSelFolder; });
    if (selFolderObj) folderName = selFolderObj.name;
  }

  var html = '<div class="pnl" style="padding:12px;display:flex;flex-direction:column;overflow:hidden">';

  // 헤더
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">';
  html += '<span style="font-size:12px;font-weight:700;color:var(--t3)">📁 ' + eH(folderName) + ' <span style="color:var(--t5);font-weight:400">(' + files.length + ')</span></span>';
  html += '<div style="display:flex;gap:4px">';
  html += '<button class="btn btn-s ' + (docViewMode === 'card' ? 'btn-p' : 'btn-g') + '" onclick="docSetView(\'card\')">▦</button>';
  html += '<button class="btn btn-s ' + (docViewMode === 'list' ? 'btn-p' : 'btn-g') + '" onclick="docSetView(\'list\')">☰</button>';
  html += '</div></div>';

  // 폴더 메모 표시
  if (selFolderObj && selFolderObj.memo) {
    html += '<div style="margin-bottom:8px;padding:8px 10px;background:var(--bg-i);border-radius:6px;border-left:2px solid var(--ac);cursor:pointer;position:relative" onclick="docEditFolderMemo(\'' + selFolderObj.id + '\')" title="클릭하여 메모 편집">';
    html += '<div style="font-size:9px;font-weight:700;color:var(--t4);margin-bottom:3px;display:flex;justify-content:space-between;align-items:center"><span>📝 폴더 메모</span><span style="font-size:9px;color:var(--t5)">✏️ 편집</span></div>';
    html += '<div style="font-size:11px;color:var(--t2);line-height:1.5;white-space:pre-wrap;max-height:60px;overflow-y:auto">' + eH(selFolderObj.memo) + '</div>';
    html += '</div>';
  }

  // 검색바
  html += '<div style="margin-bottom:8px"><div style="display:flex;gap:4px;align-items:center"><div class="sw" style="flex:1"><span class="sic">🔍</span>';
  html += '<input class="si" style="padding-left:28px;font-size:11px;height:32px" placeholder="파일명, 메모, 태그' + (docDeepSearch ? ', 본문' : '') + ' 검색..." value="' + eH(docSearchKeyword) + '" oninput="docSearchFiles(this.value)">';
  html += '</div>';
  html += '<button class="btn btn-s ' + (docDeepSearch ? 'btn-p' : 'btn-g') + '" onclick="docToggleDeepSearch()" title="본문 포함 전문 검색" style="font-size:9px;white-space:nowrap;height:32px">📖 전문</button>';
  html += '</div></div>';

  // 업로드 존 + 파일 목록
  html += '<div style="flex:1;overflow-y:auto">';

  if (!files.length) {
    html += '<div id="docDropZone" class="dz" style="margin-bottom:12px" onclick="document.getElementById(\'docFileInput\').click()" ondragover="event.preventDefault();this.classList.add(\'active\')" ondragleave="this.classList.remove(\'active\')" ondrop="event.preventDefault();this.classList.remove(\'active\');docHandleDrop(event)">';
    html += '<div style="font-size:32px;margin-bottom:8px;opacity:.7">📂</div>';
    html += '<div style="font-size:12px;color:var(--t4);margin-bottom:4px">파일을 드래그하거나 클릭하여 업로드</div>';
    html += '<div style="font-size:10px;color:var(--t5)">PDF, Excel, PPT, Word, 텍스트, 이미지 지원 (최대 50MB)</div>';
    html += '</div>';
  } else {
    // 업로드 버튼
    html += '<div style="margin-bottom:10px;display:flex;gap:6px">';
    html += '<button class="btn btn-p btn-s" onclick="document.getElementById(\'docFileInput\').click()">📤 파일 업로드</button>';
    if (docSelFolder) html += '<button class="btn btn-d btn-s" onclick="docDeleteFolder(\'' + docSelFolder + '\')">🗑️ 폴더 삭제</button>';
    html += '</div>';

    // 파일 카드 / 리스트
    var pageInfo = paginate(files, docFilePage, 30);

    if (docViewMode === 'card') {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px">';
      pageInfo.items.forEach(function (f) {
        var icon = getDocIcon(f.ext);
        var sel = docSelFile === f.id ? 'border-color:var(--ac);background:var(--ac-g)' : '';
        html += '<div onclick="docClickFile(\'' + f.id + '\')" style="padding:12px 10px;border-radius:8px;border:1px solid var(--bd);cursor:pointer;text-align:center;transition:all .15s;' + sel + '" onmouseover="this.style.borderColor=\'var(--ac)\'" onmouseout="if(\'' + f.id + '\'!==docSelFile)this.style.borderColor=\'var(--bd)\'">';
        html += '<div style="font-size:28px;margin-bottom:6px">' + icon.icon + '</div>';
        html += '<div style="font-size:10px;font-weight:600;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + eH(f.name) + '">' + eH(f.name) + '</div>';
        html += '<div style="font-size:9px;color:var(--t5);margin-top:3px">' + formatFileSize(f.size) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    } else {
      html += '<table><thead><tr><th>파일</th><th>크기</th><th>유형</th><th>업로드일</th><th></th></tr></thead><tbody>';
      pageInfo.items.forEach(function (f) {
        var icon = getDocIcon(f.ext);
        var sel = docSelFile === f.id ? 'background:var(--ac-g)' : '';
        html += '<tr onclick="docClickFile(\'' + f.id + '\')" style="cursor:pointer;' + sel + '">';
        html += '<td><span style="margin-right:4px">' + icon.icon + '</span>' + eH(f.name);
        if (f.tags && f.tags.length) html += ' <span style="font-size:9px;color:var(--tg-t)">' + f.tags.map(function(t){return '#'+eH(t)}).join(' ') + '</span>';
        html += '</td>';
        html += '<td class="mono">' + formatFileSize(f.size) + '</td>';
        html += '<td>' + (f.ext || '').toUpperCase() + '</td>';
        html += '<td style="font-size:10px">' + (f.createdAt ? new Date(f.createdAt).toLocaleDateString('ko') : '') + '</td>';
        html += '<td style="white-space:nowrap">';
        html += '<span onclick="event.stopPropagation();docMoveFile(\'' + f.id + '\')" style="cursor:pointer;color:var(--t5);font-size:12px;margin-right:4px" title="이동">📁</span>';
        html += '<span onclick="event.stopPropagation();docDeleteFile(\'' + f.id + '\')" style="cursor:pointer;color:var(--t5);font-size:12px" title="삭제">🗑️</span>';
        html += '</td></tr>';
      });
      html += '</tbody></table>';
    }

    if (pageInfo.totalPages > 1) {
      html += '<div id="docPagination"></div>';
    }
  }

  html += '</div>';

  // hidden file input
  html += '<input type="file" id="docFileInput" multiple style="display:none" accept=".txt,.csv,.md,.json,.xml,.log,.pdf,.png,.jpg,.jpeg,.gif,.bmp,.svg,.xls,.xlsx,.ppt,.pptx,.doc,.docx" onchange="docUploadWithVersion(this.files)">';
  html += '</div>';
  return html;
}

/* ═══ 미리보기 패널 ═══ */
function renderPreviewPanel() {
  var html = '';
  // 탭
  html += '<div style="display:flex;border-bottom:1px solid var(--bd)">';
  html += '<button class="tab' + (docPreviewTab === 'preview' ? ' on' : '') + '" onclick="docSetPreviewTab(\'preview\')" style="flex:1;border-radius:0;font-size:11px">📋 미리보기</button>';
  html += '<button class="tab' + (docPreviewTab === 'summary' ? ' on' : '') + '" onclick="docSetPreviewTab(\'summary\')" style="flex:1;border-radius:0;font-size:11px">🤖 AI 요약</button>';
  html += '</div>';

  html += '<div id="docPreviewContent" style="flex:1;overflow-y:auto;padding:14px;max-height:520px">';
  if (!docSelFile) {
    html += '<div style="text-align:center;padding:30px;color:var(--t5)"><div style="font-size:28px;margin-bottom:8px">📄</div><div style="font-size:11px">파일을 선택하면 미리보기가 표시됩니다</div></div>';
  }
  html += '</div>';
  return html;
}

/* ═══ 뷰 모드 변경 ═══ */
function docSetView(mode) {
  docViewMode = mode;
  renderDocManager();
}

function docSetPreviewTab(tab) {
  docPreviewTab = tab;
  var content = document.getElementById('docPreviewContent');
  if (!content) return;
  if (!docSelFile) {
    content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--t5)"><div style="font-size:32px;margin-bottom:8px">📄</div><div style="font-size:11px">파일을 선택하세요</div></div>';
    return;
  }
  fileGet(docSelFile).then(function (f) {
    if (!f) return;
    if (tab === 'preview') showFilePreview(f);
    else showAISummaryPanel(f);
  });
  // 탭 버튼 상태 업데이트
  var tabs = document.querySelectorAll('#docPreviewPanel .tab');
  tabs.forEach(function (t) {
    t.classList.toggle('on', t.textContent.includes(tab === 'preview' ? '미리보기' : 'AI'));
  });
}

/* ═══ 파일 선택 ═══ */
function docClickFile(fileId) {
  docSelFile = fileId;
  // 선택 하이라이트 업데이트
  renderDocManager();
}

/* ═══ 파일 업로드 ═══ */
function docHandleDrop(e) {
  var files = e.dataTransfer ? e.dataTransfer.files : [];
  if (files.length) docUploadWithVersion(files);
}

async function docHandleFiles(fileList) {
  if (!docSelProject) { showToast('프로젝트를 먼저 선택하세요.', 'warn'); return; }

  var targetFolder = docSelFolder;
  if (!targetFolder) {
    // 전체 보기에서 업로드 시 첫 번째 폴더에 저장
    var folders = await folderGetByProject(docSelProject);
    if (folders.length) targetFolder = folders[0].id;
    else { showToast('폴더가 없습니다.', 'error'); return; }
  }

  var count = 0;
  var errors = [];

  for (var i = 0; i < fileList.length; i++) {
    var file = fileList[i];
    if (file.size > DOC_MAX_FILE) {
      errors.push(file.name + ' (크기 초과)');
      continue;
    }

    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var buf = await readFileAsArrayBuffer(file);

    var record = {
      id: 'file-' + uuid(),
      projectId: docSelProject,
      folderId: targetFolder,
      name: file.name,
      type: file.type || 'application/octet-stream',
      ext: ext,
      size: file.size,
      data: buf,
      textCache: '',
      memo: '',
      tags: [],
      uploadedBy: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 텍스트 캐시 추출
    record.textCache = await extractTextFromFile(record);

    await filePut(record);
    count++;
  }

  if (count) showToast('📤 ' + count + '개 파일 업로드 완료');
  if (errors.length) showToast('⚠️ ' + errors.join(', '), 'warn');

  renderDocManager();
}

function readFileAsArrayBuffer(file) {
  return new Promise(function (res) {
    var reader = new FileReader();
    reader.onload = function (e) { res(e.target.result); };
    reader.onerror = function () { res(new ArrayBuffer(0)); };
    reader.readAsArrayBuffer(file);
  });
}

/* ═══ 텍스트 추출 ═══ */
async function extractTextFromFile(fileRecord) {
  var ext = fileRecord.ext;
  var data = fileRecord.data;
  if (!data) return '';

  try {
    // 텍스트 파일
    if (['txt', 'csv', 'md', 'json', 'xml', 'log'].indexOf(ext) >= 0) {
      return new TextDecoder('utf-8', { fatal: false }).decode(data);
    }

    // 엑셀
    if (['xlsx', 'xls'].indexOf(ext) >= 0 && typeof XLSX !== 'undefined') {
      var wb = XLSX.read(data, { type: 'array' });
      var text = '';
      wb.SheetNames.forEach(function (name) {
        text += '=== Sheet: ' + name + ' ===\n';
        text += XLSX.utils.sheet_to_csv(wb.Sheets[name]) + '\n\n';
      });
      return text.slice(0, 50000); // 50K자 제한
    }

    // PDF (pdf.js 필요)
    if (ext === 'pdf' && typeof pdfjsLib !== 'undefined') {
      var pdf = await pdfjsLib.getDocument({ data: data }).promise;
      var text = '';
      var maxPages = Math.min(pdf.numPages, 30);
      for (var p = 1; p <= maxPages; p++) {
        var page = await pdf.getPage(p);
        var content = await page.getTextContent();
        text += content.items.map(function (item) { return item.str; }).join(' ') + '\n';
      }
      return text.slice(0, 50000);
    }

    // PPTX / DOCX (JSZip 필요)
    if (['pptx', 'docx'].indexOf(ext) >= 0 && typeof JSZip !== 'undefined') {
      var zip = await JSZip.loadAsync(data);
      var text = '';
      if (ext === 'docx') {
        var docXml = await zip.file('word/document.xml').async('string');
        text = docXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      } else {
        // pptx: 슬라이드별 텍스트 추출
        var slideFiles = Object.keys(zip.files).filter(function (n) { return n.match(/ppt\/slides\/slide\d+\.xml/); }).sort();
        for (var s = 0; s < slideFiles.length; s++) {
          var slideXml = await zip.file(slideFiles[s]).async('string');
          text += '--- Slide ' + (s + 1) + ' ---\n';
          text += slideXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() + '\n\n';
        }
      }
      return text.slice(0, 50000);
    }
  } catch (e) {
    console.warn('[DocManager] extractText error', ext, e);
  }

  return '';
}

/* ═══ 미리보기 렌더 ═══ */
async function showFilePreview(fileRecord) {
  var content = document.getElementById('docPreviewContent');
  if (!content) return;

  var ext = fileRecord.ext;
  var data = fileRecord.data;

  // 파일 정보 사이드바
  var icon = getDocIcon(ext);
  var infoHtml = '<div style="min-width:220px;max-width:280px;padding-right:14px;border-right:1px solid var(--bd)">';
  infoHtml += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
  infoHtml += '<span style="font-size:22px">' + icon.icon + '</span>';
  infoHtml += '<div><div style="font-size:12px;font-weight:700;color:var(--t1);word-break:break-all">' + eH(fileRecord.name) + '</div>';
  infoHtml += '<div style="font-size:10px;color:var(--t4)">' + formatFileSize(fileRecord.size) + ' · ' + (ext || '').toUpperCase() + ' · ' + (fileRecord.createdAt ? new Date(fileRecord.createdAt).toLocaleDateString('ko') : '') + '</div></div></div>';
  if (fileRecord.tags && fileRecord.tags.length) {
    infoHtml += '<div style="margin-bottom:6px;display:flex;flex-wrap:wrap;gap:3px">';
    fileRecord.tags.forEach(function (t) {
      infoHtml += '<span class="ft" style="font-size:9px;padding:1px 6px">#' + eH(t) + '</span>';
    });
    infoHtml += '</div>';
  }
  if (fileRecord.memo) {
    infoHtml += '<div style="font-size:10px;color:var(--t4);margin-bottom:6px;background:var(--bg-i);padding:6px 8px;border-radius:4px;max-height:80px;overflow-y:auto;line-height:1.5">' + eH(fileRecord.memo).slice(0, 300) + '</div>';
  }
  infoHtml += '<div style="display:flex;gap:4px;flex-wrap:wrap">';
  infoHtml += '<button class="btn btn-g btn-s" onclick="docDownloadFile(\'' + fileRecord.id + '\')">💾 다운로드</button>';
  infoHtml += '<button class="btn btn-g btn-s" onclick="docEditFileMeta(\'' + fileRecord.id + '\')">✏️ 편집</button>';
  infoHtml += '<button class="btn btn-g btn-s" onclick="docMoveFile(\'' + fileRecord.id + '\')">📁 이동</button>';
  infoHtml += '<button class="btn btn-d btn-s" onclick="docDeleteFile(\'' + fileRecord.id + '\')">🗑️ 삭제</button>';
  infoHtml += '</div></div>';

  if (!data) {
    content.innerHTML = '<div style="display:flex;gap:14px">' + infoHtml + '<div style="flex:1;text-align:center;padding:20px;color:var(--t5)">파일 데이터 없음</div></div>';
    return;
  }

  var previewHtml = '';

  try {
    // 이미지
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg'].indexOf(ext) >= 0) {
      var url = docCreateBlobUrl(data, fileRecord.type);
      previewHtml = '<div style="text-align:center"><img src="' + url + '" style="max-width:100%;max-height:420px;border-radius:6px;border:1px solid var(--bd)" alt="' + eH(fileRecord.name) + '"></div>';
    }
    // PDF
    else if (ext === 'pdf') {
      var url = docCreateBlobUrl(data, 'application/pdf');
      previewHtml = '<iframe src="' + url + '" style="width:100%;height:420px;border:1px solid var(--bd);border-radius:6px;background:#fff"></iframe>';
    }
    // 엑셀
    else if (['xlsx', 'xls'].indexOf(ext) >= 0 && typeof XLSX !== 'undefined') {
      var wb = XLSX.read(data, { type: 'array' });
      previewHtml = '<div style="margin-bottom:6px;display:flex;gap:4px;flex-wrap:wrap">';
      wb.SheetNames.forEach(function (name, idx) {
        previewHtml += '<button class="btn btn-s ' + (idx === 0 ? 'btn-p' : 'btn-g') + '" onclick="docShowSheet(this,' + idx + ')" data-sheet="' + idx + '">' + eH(name) + '</button>';
      });
      previewHtml += '</div>';
      wb.SheetNames.forEach(function (name, idx) {
        var sheetHtml = XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false });
        previewHtml += '<div class="doc-sheet tw" data-sheet-idx="' + idx + '" style="' + (idx > 0 ? 'display:none;' : '') + 'font-size:10px;max-height:380px;overflow:auto">' + sheetHtml + '</div>';
      });
    }
    // 텍스트
    else if (['txt', 'csv', 'md', 'json', 'xml', 'log'].indexOf(ext) >= 0) {
      var text = new TextDecoder('utf-8', { fatal: false }).decode(data);
      previewHtml = '<pre style="background:var(--bg-i);border:1px solid var(--bd);border-radius:6px;padding:12px;font-size:11px;font-family:\'JetBrains Mono\',monospace;max-height:420px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:var(--t2)">' + eH(text.slice(0, 30000)) + '</pre>';
    }
    // PPTX/DOCX (텍스트 추출)
    else if (['pptx', 'docx'].indexOf(ext) >= 0) {
      var text = fileRecord.textCache || await extractTextFromFile(fileRecord);
      if (text) {
        previewHtml = '<div style="background:var(--bg-i);border:1px solid var(--bd);border-radius:6px;padding:12px;font-size:11px;max-height:420px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:var(--t2);line-height:1.6">' + eH(text.slice(0, 20000)) + '</div>';
      } else {
        previewHtml = '<div style="text-align:center;padding:30px;color:var(--t5)"><div style="font-size:24px;margin-bottom:8px">📄</div><div style="font-size:11px">텍스트 추출 불가 — 다운로드하여 확인하세요</div></div>';
      }
    }
    // 기타
    else {
      previewHtml = '<div style="text-align:center;padding:30px;color:var(--t5)"><div style="font-size:24px;margin-bottom:8px">' + icon.icon + '</div><div style="font-size:11px">미리보기를 지원하지 않는 파일 형식입니다<br>다운로드하여 확인하세요</div></div>';
    }
  } catch (e) {
    console.warn('[DocManager] preview error', e);
    previewHtml = '<div style="text-align:center;padding:20px;color:var(--d-t)">미리보기 오류: ' + eH(e.message || '') + '</div>';
  }

  content.innerHTML = '<div style="display:flex;gap:14px" id="docPreviewFlex">' + infoHtml + '<div style="flex:1;min-width:0">' + previewHtml + '</div></div>';
}

/* 엑셀 시트 탭 전환 */
function docShowSheet(btn, idx) {
  // 버튼 활성화
  var btns = btn.parentElement.querySelectorAll('button');
  btns.forEach(function (b) { b.className = 'btn btn-s btn-g'; });
  btn.className = 'btn btn-s btn-p';
  // 시트 표시
  var sheets = document.querySelectorAll('.doc-sheet');
  sheets.forEach(function (s) { s.style.display = parseInt(s.dataset.sheetIdx) === idx ? '' : 'none'; });
}

/* ═══ AI 요약 패널 ═══ */
async function showAISummaryPanel(fileRecord) {
  var content = document.getElementById('docPreviewContent');
  if (!content) return;

  var icon = getDocIcon(fileRecord.ext);
  var proj = await projGet(docSelProject);
  var projName = proj ? (proj.name || proj.orderNo || '') : '';
  var orderNo = proj ? (proj.orderNo || '') : '';

  // 좌측: 파일정보 + 요약 컨트롤
  var leftHtml = '<div style="min-width:260px;max-width:320px;padding-right:14px;border-right:1px solid var(--bd)">';
  leftHtml += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">';
  leftHtml += '<span style="font-size:18px">' + icon.icon + '</span>';
  leftHtml += '<div><div style="font-size:11px;font-weight:700;color:var(--t1);word-break:break-all">' + eH(fileRecord.name) + '</div>';
  leftHtml += '<div style="font-size:10px;color:var(--t4)">🏗️ ' + eH(projName) + (orderNo ? ' · 📦 ' + eH(orderNo) : '') + '</div></div>';
  leftHtml += '</div>';

  // AI 프로바이더 표시
  var hasKey = typeof gAk === 'function' && gAk();
  var provName = typeof aiProv !== 'undefined' ? (aiProv === 'gemini' ? 'Gemini' : 'Claude') : '미설정';
  leftHtml += '<div style="font-size:10px;color:var(--t5);margin-bottom:10px">🔑 ' + provName + (hasKey ? ' ✅' : ' ❌ (API 키 필요)') + '</div>';

  // 프리셋 버튼
  leftHtml += '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;color:var(--t4);margin-bottom:6px">요약 유형</div>';
  leftHtml += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
  var presets = [
    { id: 'quick', icon: '⚡', label: '핵심요약', prompt: '이 문서의 핵심 내용을 3~5줄로 요약해줘.' },
    { id: 'detail', icon: '📋', label: '상세분석', prompt: '이 문서의 주요 내용을 구조적으로 정리하고 핵심 포인트를 분석해줘.' },
    { id: 'check', icon: '✅', label: '체크리스트', prompt: '이 문서에서 확인해야 할 체크리스트 항목을 추출해줘.' },
    { id: 'issue', icon: '🔍', label: '이슈추출', prompt: '이 문서에서 잠재적 리스크나 이슈 사항을 찾아줘.' }
  ];
  presets.forEach(function (p) {
    leftHtml += '<button class="btn btn-g btn-s" onclick="docRunSummary(\'' + fileRecord.id + '\',\'' + p.id + '\')" title="' + eH(p.prompt) + '">' + p.icon + ' ' + p.label + '</button>';
  });
  leftHtml += '</div></div>';

  // 자유 입력
  leftHtml += '<div style="margin-bottom:10px">';
  leftHtml += '<textarea id="docSumPrompt" placeholder="자유 입력: 분석할 내용을 입력하세요..." style="width:100%;height:48px;background:var(--bg-i);border:1px solid var(--bd);border-radius:6px;padding:8px;font-size:11px;color:var(--t2);font-family:inherit;resize:vertical;outline:none"></textarea>';
  leftHtml += '<button class="btn btn-p btn-s" onclick="docRunSummary(\'' + fileRecord.id + '\',\'custom\')" style="margin-top:4px;width:100%;justify-content:center">🚀 요약 실행</button>';
  leftHtml += '</div>';

  // 요약 이력 버튼
  var histCount = (fileRecord.summaryHistory || []).length;
  if (histCount || fileRecord.memo) {
    leftHtml += '<div>';
    leftHtml += '<button class="btn btn-g btn-s" onclick="docShowSummaryHistory(\'' + fileRecord.id + '\')" style="width:100%;justify-content:center">📜 요약 이력' + (histCount ? ' (' + histCount + ')' : '') + '</button>';
    leftHtml += '</div>';
  }
  leftHtml += '</div>';

  // 우측: 결과 영역
  var rightHtml = '<div style="flex:1;min-width:0">';
  rightHtml += '<div id="docSumResult">';
  if (fileRecord.memo) {
    rightHtml += '<div style="font-size:10px;font-weight:700;color:var(--t4);margin-bottom:6px">📝 이전 요약</div>';
    rightHtml += '<div style="font-size:11px;color:var(--t2);line-height:1.6;background:var(--bg-i);border-radius:6px;padding:10px;max-height:360px;overflow-y:auto">' + (typeof rMD === 'function' ? rMD(fileRecord.memo) : eH(fileRecord.memo)) + '</div>';
  } else {
    rightHtml += '<div style="text-align:center;padding:40px;color:var(--t5)"><div style="font-size:28px;margin-bottom:8px">🤖</div><div style="font-size:11px">요약 유형을 선택하거나<br>자유 입력으로 분석을 실행하세요</div></div>';
  }
  rightHtml += '</div></div>';

  content.innerHTML = '<div style="display:flex;gap:14px" id="docSumFlex">' + leftHtml + rightHtml + '</div>';
}

/* ═══ AI 요약 실행 ═══ */
async function docRunSummary(fileId, presetId) {
  var resultEl = document.getElementById('docSumResult');
  if (!resultEl) return;

  var f = await fileGet(fileId);
  if (!f) { showToast('파일을 찾을 수 없습니다.', 'error'); return; }

  // API 키 확인
  var hasKey = typeof gAk === 'function' && gAk();
  if (!hasKey) {
    resultEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--d-t);font-size:11px">⚠️ AI API 키가 설정되지 않았습니다.<br>설정 탭에서 API 키를 등록하세요.</div>';
    return;
  }

  // 텍스트 추출
  var text = f.textCache || '';
  if (!text) {
    text = await extractTextFromFile(f);
    if (text) {
      f.textCache = text;
      await filePut(f);
    }
  }

  if (!text) {
    resultEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--d-t);font-size:11px">⚠️ 이 파일에서 텍스트를 추출할 수 없습니다.</div>';
    return;
  }

  // 프롬프트 구성
  var presets = {
    quick: '이 문서의 핵심 내용을 3~5줄로 요약해줘.',
    detail: '이 문서의 주요 내용을 구조적으로 정리하고 핵심 포인트를 분석해줘.',
    check: '이 문서에서 확인해야 할 체크리스트 항목을 추출해줘.',
    issue: '이 문서에서 잠재적 리스크나 이슈 사항을 찾아줘.',
    custom: ''
  };

  var userPrompt = presets[presetId] || '';
  if (presetId === 'custom') {
    var textarea = document.getElementById('docSumPrompt');
    userPrompt = textarea ? textarea.value.trim() : '';
    if (!userPrompt) { showToast('분석 내용을 입력하세요.', 'warn'); return; }
  }

  // 프로젝트 컨텍스트
  var proj = await projGet(docSelProject);
  var projName = proj ? (proj.name || '') : '';
  var orderNo = proj ? (proj.orderNo || '') : '';
  var phase = proj ? (proj.currentPhase || '') : '';

  // 텍스트 축약 (토큰 제한 대응)
  var maxChars = 8000;
  var docText = text;
  if (docText.length > maxChars) {
    var head = docText.slice(0, Math.floor(maxChars * 0.5));
    var mid = docText.slice(Math.floor(docText.length * 0.4), Math.floor(docText.length * 0.4) + Math.floor(maxChars * 0.2));
    var tail = docText.slice(-Math.floor(maxChars * 0.2));
    docText = head + '\n\n[... 중간 생략 ...]\n\n' + mid + '\n\n[... 생략 ...]\n\n' + tail;
  }

  var fullPrompt = '당신은 프로젝트 문서 분석 전문가입니다.\n';
  fullPrompt += '프로젝트: ' + projName + (orderNo ? ' (수주번호: ' + orderNo + ')' : '') + '\n';
  if (phase) fullPrompt += '현재 단계: ' + phase + '\n';
  fullPrompt += '문서 파일: ' + f.name + ' (' + formatFileSize(f.size) + ', ' + (f.ext || '').toUpperCase() + ')\n\n';
  fullPrompt += '=== 문서 내용 ===\n' + docText + '\n\n';
  fullPrompt += '=== 분석 요청 ===\n' + userPrompt;

  // 로딩 표시
  resultEl.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:16px"><div class="sp" style="width:16px;height:16px;border:2px solid var(--bd);border-top-color:var(--ac);border-radius:50%;animation:spn .6s linear infinite"></div><span style="font-size:11px;color:var(--t4)">AI 분석 중...</span></div>';

  try {
    var aiResult = await callAI(fullPrompt);

    // summaryHistory에 자동 저장
    var presetLabels = { quick: '핵심요약', detail: '상세분석', check: '체크리스트', issue: '이슈추출', custom: '자유입력' };
    if (!f.summaryHistory) f.summaryHistory = [];
    f.summaryHistory.unshift({
      preset: presetLabels[presetId] || presetId,
      text: aiResult,
      date: new Date().toISOString().slice(0, 16).replace('T', ' ')
    });
    // 최대 20건 보관
    if (f.summaryHistory.length > 20) f.summaryHistory = f.summaryHistory.slice(0, 20);
    f.updatedAt = new Date().toISOString();
    await filePut(f);

    var resHtml = '<div style="font-size:10px;font-weight:700;color:var(--t4);margin-bottom:6px">🤖 분석 결과</div>';
    resHtml += '<div id="docSumText" style="font-size:11px;color:var(--t2);line-height:1.7;background:var(--bg-i);border-radius:6px;padding:12px;max-height:280px;overflow-y:auto">' + (typeof rMD === 'function' ? rMD(aiResult) : eH(aiResult)) + '</div>';
    resHtml += '<div style="display:flex;gap:4px;margin-top:8px">';
    resHtml += '<button class="btn btn-g btn-s" onclick="docCopySummary()">📋 복사</button>';
    resHtml += '<button class="btn btn-p btn-s" onclick="docSaveSummary(\'' + fileId + '\')">💾 메모 저장</button>';
    resHtml += '<button class="btn btn-g btn-s" onclick="docShowSummaryHistory(\'' + fileId + '\')">📜 이력</button>';
    resHtml += '</div>';

    resultEl.innerHTML = resHtml;
    // 결과를 임시 저장
    resultEl.dataset.lastResult = aiResult;
  } catch (e) {
    console.warn('[DocManager] AI summary error', e);
    resultEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--d-t);font-size:11px">⚠️ AI 호출 오류: ' + eH(e.message || '알 수 없는 오류') + '</div>';
  }
}

/* 요약 복사 */
function docCopySummary() {
  var el = document.getElementById('docSumResult');
  var text = el ? (el.dataset.lastResult || el.textContent) : '';
  if (!text) return;
  navigator.clipboard.writeText(text).then(function () {
    showToast('📋 요약 결과 복사됨');
  }).catch(function () {
    showToast('복사 실패', 'error');
  });
}

/* 요약 메모 저장 */
async function docSaveSummary(fileId) {
  var el = document.getElementById('docSumResult');
  var text = el ? (el.dataset.lastResult || '') : '';
  if (!text) return;

  var f = await fileGet(fileId);
  if (!f) return;
  f.memo = text;
  f.updatedAt = new Date().toISOString();
  await filePut(f);
  showToast('💾 요약 결과가 파일 메모에 저장됨');
}

/* ═══ 파일 다운로드 ═══ */
async function docDownloadFile(fileId) {
  var f = await fileGet(fileId);
  if (!f || !f.data) { showToast('파일 데이터 없음', 'error'); return; }

  var url = docCreateBlobUrl(f.data, f.type);
  var a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  a.click();
  showToast('💾 ' + f.name + ' 다운로드');
}

/* ═══ 파일 삭제 ═══ */
async function docDeleteFile(fileId) {
  if (!confirm('이 파일을 삭제하시겠습니까?')) return;
  await fileDel(fileId);
  if (docSelFile === fileId) docSelFile = null;
  showToast('🗑️ 파일 삭제됨');
  renderDocManager();
}

/* ═══ 폴더 추가 ═══ */
async function docAddFolder() {
  if (!docSelProject) { showToast('프로젝트를 선택하세요.', 'warn'); return; }
  var name = prompt('새 폴더 이름:');
  if (!name || !name.trim()) return;

  var parentId = docSelFolder;
  // 뎁스 체크 (최대 3)
  if (parentId) {
    var parent = await folderGet(parentId);
    if (parent && parent.parentId) {
      var grandparent = await folderGet(parent.parentId);
      if (grandparent && grandparent.parentId) {
        showToast('최대 3뎁스까지만 생성 가능합니다.', 'warn');
        return;
      }
    }
  }

  var folders = await folderGetByProject(docSelProject);
  await folderPut({
    id: 'fldr-' + uuid(),
    projectId: docSelProject,
    parentId: parentId,
    name: name.trim(),
    phase: null,
    order: folders.length,
    createdAt: new Date().toISOString()
  });

  showToast('📁 폴더 생성: ' + name.trim());
  renderDocManager();
}

/* ═══ 폴더 삭제 ═══ */
async function docDeleteFolder(folderId) {
  var folder = await folderGet(folderId);
  if (!folder) return;
  if (folder.phase) {
    showToast('기본 단계 폴더는 삭제할 수 없습니다.', 'warn');
    return;
  }

  var files = await fileGetByFolder(folderId);
  if (files.length) {
    if (!confirm('이 폴더에 ' + files.length + '개의 파일이 있습니다.\n폴더와 파일을 모두 삭제하시겠습니까?')) return;
    await Promise.all(files.map(function (f) { return fileDel(f.id); }));
  } else {
    if (!confirm('"' + folder.name + '" 폴더를 삭제하시겠습니까?')) return;
  }

  // 하위 폴더도 삭제
  var allFolders = await folderGetByProject(folder.projectId);
  var children = allFolders.filter(function (f) { return f.parentId === folderId; });
  for (var i = 0; i < children.length; i++) {
    var childFiles = await fileGetByFolder(children[i].id);
    await Promise.all(childFiles.map(function (f) { return fileDel(f.id); }));
    await folderDel(children[i].id);
  }

  await folderDel(folderId);
  docSelFolder = null;
  showToast('🗑️ 폴더 삭제됨');
  renderDocManager();
}

/* ═══ Phase 2: 파일 검색 ═══ */
var _docSearchTimer = null;
function docSearchFiles(keyword) {
  clearTimeout(_docSearchTimer);
  _docSearchTimer = setTimeout(function () {
    docSearchKeyword = keyword.trim();
    docFilePage = 1;
    renderDocManager();
  }, 300);
}

/* ═══ Phase 2: 폴더 이름변경 ═══ */
async function docRenameFolder(folderId) {
  var folder = await folderGet(folderId);
  if (!folder) return;
  var newName = prompt('폴더 이름 변경:', folder.name);
  if (!newName || !newName.trim() || newName.trim() === folder.name) return;
  folder.name = newName.trim();
  await folderPut(folder);
  showToast('📁 폴더 이름 변경: ' + newName.trim());
  renderDocManager();
}

/* ═══ 폴더 메모 편집 ═══ */
async function docEditFolderMemo(folderId) {
  var folder = await folderGet(folderId);
  if (!folder) return;

  var div = document.createElement('div');
  div.innerHTML = '<div style="margin-bottom:12px">'
    + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">'
    + '<span style="font-size:16px">📁</span>'
    + '<span style="font-size:12px;font-weight:700;color:var(--t1)">' + eH(folder.name) + '</span>'
    + (folder.phase ? '<span class="ft" style="font-size:9px">' + eH(folder.phase) + '</span>' : '')
    + '</div>'
    + '<label style="font-size:11px;font-weight:700;color:var(--t4);display:block;margin-bottom:4px">📝 메모</label>'
    + '<textarea id="docFolderMemo" style="width:100%;height:120px;background:var(--bg-i);border:1px solid var(--bd);border-radius:6px;padding:10px;font-size:11px;color:var(--t2);font-family:inherit;resize:vertical;outline:none;line-height:1.6" placeholder="미팅 내용, 사양 관련 메모, 회의 결과 등...">' + eH(folder.memo || '') + '</textarea>'
    + '</div>'
    + '<div style="display:flex;gap:6px">'
    + '<button class="btn btn-p" onclick="docSaveFolderMemo(\'' + folderId + '\')" style="flex:1;justify-content:center">💾 저장</button>'
    + (folder.memo ? '<button class="btn btn-d" onclick="docClearFolderMemo(\'' + folderId + '\')" style="justify-content:center">🗑️ 삭제</button>' : '')
    + '</div>';

  createModal({ title: '📝 폴더 메모 — ' + folder.name, content: div, width: '460px' });
}

async function docSaveFolderMemo(folderId) {
  var folder = await folderGet(folderId);
  if (!folder) return;
  var el = document.getElementById('docFolderMemo');
  if (!el) return;
  folder.memo = el.value.trim();
  folder.updatedAt = new Date().toISOString();
  await folderPut(folder);
  var overlay = document.querySelector('.wa-modal-overlay');
  if (overlay) overlay.remove();
  showToast('📝 폴더 메모 저장됨');
  renderDocManager();
}

async function docClearFolderMemo(folderId) {
  if (!confirm('이 폴더의 메모를 삭제하시겠습니까?')) return;
  var folder = await folderGet(folderId);
  if (!folder) return;
  folder.memo = '';
  folder.updatedAt = new Date().toISOString();
  await folderPut(folder);
  var overlay = document.querySelector('.wa-modal-overlay');
  if (overlay) overlay.remove();
  showToast('🗑️ 폴더 메모 삭제됨');
  renderDocManager();
}

/* ═══ Phase 2: 파일 이동 ═══ */
async function docMoveFile(fileId) {
  var f = await fileGet(fileId);
  if (!f) return;
  var folders = await folderGetByProject(f.projectId);
  folders.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

  var html = '<div style="max-height:300px;overflow-y:auto">';
  folders.forEach(function (folder) {
    var isCurrent = f.folderId === folder.id;
    html += '<div onclick="docExecMoveFile(\'' + fileId + '\',\'' + folder.id + '\')" style="padding:8px 12px;cursor:pointer;border-radius:6px;margin-bottom:4px;transition:all .15s;display:flex;align-items:center;gap:8px;font-size:12px;' + (isCurrent ? 'background:var(--ac-bg);color:var(--ac-t);font-weight:700' : 'color:var(--t2)') + '" onmouseover="if(!' + isCurrent + ')this.style.background=\'var(--bg-hv)\'" onmouseout="if(!' + isCurrent + ')this.style.background=\'none\'">';
    html += '<span>📁</span><span>' + eH(folder.name) + '</span>';
    if (isCurrent) html += '<span style="font-size:10px;color:var(--t5);margin-left:auto">(현재)</span>';
    html += '</div>';
  });
  html += '</div>';

  createModal({ title: '📁 파일 이동: ' + f.name, html: html, width: '360px' });
}

async function docExecMoveFile(fileId, targetFolderId) {
  var f = await fileGet(fileId);
  if (!f) return;
  if (f.folderId === targetFolderId) return;
  f.folderId = targetFolderId;
  f.updatedAt = new Date().toISOString();
  await filePut(f);
  // 모달 닫기
  var overlay = document.querySelector('.wa-modal-overlay');
  if (overlay) overlay.remove();
  showToast('📁 파일 이동 완료');
  renderDocManager();
}

/* ═══ Phase 2: 파일 이름변경 ═══ */
async function docRenameFile(fileId) {
  var f = await fileGet(fileId);
  if (!f) return;
  var newName = prompt('파일 이름 변경:', f.name);
  if (!newName || !newName.trim() || newName.trim() === f.name) return;
  f.name = newName.trim();
  f.ext = (newName.split('.').pop() || '').toLowerCase();
  f.updatedAt = new Date().toISOString();
  await filePut(f);
  showToast('✏️ 파일 이름 변경됨');
  renderDocManager();
}

/* ═══ Phase 2: 파일 메모/태그 편집 ═══ */
async function docEditFileMeta(fileId) {
  var f = await fileGet(fileId);
  if (!f) return;

  var div = document.createElement('div');
  div.innerHTML = '<div style="margin-bottom:12px">'
    + '<label style="font-size:11px;font-weight:700;color:var(--t4);display:block;margin-bottom:4px">📝 메모</label>'
    + '<textarea id="docMetaMemo" style="width:100%;height:80px;background:var(--bg-i);border:1px solid var(--bd);border-radius:6px;padding:8px;font-size:11px;color:var(--t2);font-family:inherit;resize:vertical;outline:none">' + eH(f.memo || '') + '</textarea>'
    + '</div>'
    + '<div style="margin-bottom:12px">'
    + '<label style="font-size:11px;font-weight:700;color:var(--t4);display:block;margin-bottom:4px">🏷️ 태그 <span style="font-weight:400;color:var(--t5)">(쉼표로 구분)</span></label>'
    + '<input id="docMetaTags" class="si" style="font-size:11px" value="' + eH((f.tags || []).join(', ')) + '" placeholder="예: 견적, 최종, v2">'
    + '</div>'
    + '<div style="margin-bottom:12px">'
    + '<label style="font-size:11px;font-weight:700;color:var(--t4);display:block;margin-bottom:4px">✏️ 파일명</label>'
    + '<input id="docMetaName" class="si" style="font-size:11px" value="' + eH(f.name) + '">'
    + '</div>'
    + '<button class="btn btn-p" onclick="docSaveFileMeta(\'' + fileId + '\')" style="width:100%;justify-content:center">💾 저장</button>';

  createModal({ title: '📄 파일 정보 편집', content: div, width: '400px' });
}

/* ═══ Phase 3: 전문 검색 (textCache 포함) ═══ */
var docDeepSearch = false;
function docToggleDeepSearch() {
  docDeepSearch = !docDeepSearch;
  renderDocManager();
}

/* ═══ Phase 3: 파일 버전 관리 ═══ */
async function docUploadWithVersion(fileList) {
  if (!docSelProject) { showToast('프로젝트를 먼저 선택하세요.', 'warn'); return; }

  var targetFolder = docSelFolder;
  if (!targetFolder) {
    var folders = await folderGetByProject(docSelProject);
    if (folders.length) targetFolder = folders[0].id;
    else { showToast('폴더가 없습니다.', 'error'); return; }
  }

  var existingFiles = await fileGetByFolder(targetFolder);
  var count = 0;

  for (var i = 0; i < fileList.length; i++) {
    var file = fileList[i];
    if (file.size > DOC_MAX_FILE) continue;

    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var buf = await readFileAsArrayBuffer(file);

    // 동일 이름 파일 확인
    var existing = existingFiles.find(function (f) { return f.name === file.name; });
    if (existing) {
      var action = confirm('"' + file.name + '" 파일이 이미 존재합니다.\n\n[확인] 새 버전으로 교체 (이전 버전 보관)\n[취소] 건너뛰기');
      if (!action) continue;

      // 이전 버전 이름 변경하여 보관
      var ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      var baseName = existing.name.replace(/\.[^.]+$/, '');
      var oldExt = existing.ext || '';
      existing.name = baseName + '_v' + ts + (oldExt ? '.' + oldExt : '');
      existing.tags = (existing.tags || []).concat(['이전버전']);
      existing.updatedAt = new Date().toISOString();
      await filePut(existing);
    }

    var record = {
      id: 'file-' + uuid(),
      projectId: docSelProject,
      folderId: targetFolder,
      name: file.name,
      type: file.type || 'application/octet-stream',
      ext: ext,
      size: file.size,
      data: buf,
      textCache: '',
      memo: '',
      tags: [],
      uploadedBy: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    record.textCache = await extractTextFromFile(record);
    await filePut(record);
    count++;
  }

  if (count) showToast('📤 ' + count + '개 파일 업로드 완료');
  renderDocManager();
}

/* ═══ Phase 3: 요약 이력 관리 ═══ */
async function docShowSummaryHistory(fileId) {
  var f = await fileGet(fileId);
  if (!f) return;

  var history = f.summaryHistory || [];
  if (!history.length && !f.memo) {
    showToast('저장된 요약 이력이 없습니다.', 'warn');
    return;
  }

  var html = '<div style="max-height:400px;overflow-y:auto">';
  if (f.memo) {
    html += '<div style="margin-bottom:12px;padding:10px;background:var(--bg-i);border-radius:6px;border-left:3px solid var(--ac)">';
    html += '<div style="font-size:10px;font-weight:700;color:var(--t4);margin-bottom:4px">📝 현재 메모</div>';
    html += '<div style="font-size:11px;color:var(--t2);line-height:1.6">' + (typeof rMD === 'function' ? rMD(f.memo) : eH(f.memo)) + '</div>';
    html += '</div>';
  }
  history.forEach(function (h, idx) {
    html += '<div style="margin-bottom:10px;padding:10px;background:var(--bg-i);border-radius:6px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">';
    html += '<span style="font-size:10px;font-weight:700;color:var(--t4)">' + (h.preset || '자유입력') + '</span>';
    html += '<span style="font-size:9px;color:var(--t5)">' + (h.date || '') + '</span></div>';
    html += '<div style="font-size:11px;color:var(--t2);line-height:1.6;max-height:150px;overflow-y:auto">' + (typeof rMD === 'function' ? rMD(h.text) : eH(h.text)) + '</div>';
    html += '</div>';
  });
  html += '</div>';

  createModal({ title: '📜 요약 이력: ' + f.name, html: html, width: '500px' });
}

/* ═══ Phase 3: 용량 대시보드 ═══ */
async function docShowStorageDashboard() {
  var projects = await projGetAll();
  var allFiles = await fileGetAll();

  var byProject = {};
  var totalSize = 0;
  allFiles.forEach(function (f) {
    if (!byProject[f.projectId]) byProject[f.projectId] = { size: 0, count: 0 };
    byProject[f.projectId].size += (f.size || 0);
    byProject[f.projectId].count++;
    totalSize += (f.size || 0);
  });

  // 확장자별 분포
  var byExt = {};
  allFiles.forEach(function (f) {
    var ext = (f.ext || 'other').toLowerCase();
    if (!byExt[ext]) byExt[ext] = { size: 0, count: 0 };
    byExt[ext].size += (f.size || 0);
    byExt[ext].count++;
  });

  var html = '<div style="margin-bottom:16px">';
  html += '<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:8px">📊 전체 용량: ' + formatFileSize(totalSize) + ' (' + allFiles.length + '개 파일)</div>';
  html += '</div>';

  // 프로젝트별
  html += '<div style="font-size:11px;font-weight:700;color:var(--t4);margin-bottom:8px">프로젝트별 사용량</div>';
  var sortedProjects = Object.entries(byProject).sort(function (a, b) { return b[1].size - a[1].size; });
  sortedProjects.forEach(function (entry) {
    var projId = entry[0];
    var info = entry[1];
    var proj = projects.find(function (p) { return p.id === projId; });
    var name = proj ? (proj.name || proj.orderNo || projId) : projId;
    var pct = totalSize > 0 ? Math.round(info.size / totalSize * 100) : 0;
    html += '<div style="margin-bottom:6px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t3);margin-bottom:2px"><span>' + eH(name) + '</span><span>' + formatFileSize(info.size) + ' (' + info.count + ')</span></div>';
    html += '<div style="height:6px;background:var(--pt);border-radius:3px"><div style="width:' + pct + '%;height:100%;background:var(--ac);border-radius:3px"></div></div>';
    html += '</div>';
  });

  // 확장자별
  html += '<div style="font-size:11px;font-weight:700;color:var(--t4);margin:12px 0 8px">파일 유형별 분포</div>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
  Object.entries(byExt).sort(function (a, b) { return b[1].size - a[1].size; }).forEach(function (entry) {
    var ext = entry[0];
    var info = entry[1];
    var icon = getDocIcon(ext);
    html += '<div style="padding:6px 10px;background:var(--bg-i);border-radius:6px;font-size:10px;color:var(--t3)">';
    html += icon.icon + ' .' + ext.toUpperCase() + ' <b>' + info.count + '</b>개 · ' + formatFileSize(info.size);
    html += '</div>';
  });
  html += '</div>';

  createModal({ title: '💾 문서 용량 대시보드', html: html, width: '500px' });
}

async function docSaveFileMeta(fileId) {
  var f = await fileGet(fileId);
  if (!f) return;

  var memoEl = document.getElementById('docMetaMemo');
  var tagsEl = document.getElementById('docMetaTags');
  var nameEl = document.getElementById('docMetaName');

  if (memoEl) f.memo = memoEl.value;
  if (tagsEl) {
    f.tags = tagsEl.value.split(',').map(function (t) { return t.trim(); }).filter(function (t) { return t; });
  }
  if (nameEl && nameEl.value.trim()) {
    f.name = nameEl.value.trim();
    f.ext = (f.name.split('.').pop() || '').toLowerCase();
  }
  f.updatedAt = new Date().toISOString();
  await filePut(f);

  var overlay = document.querySelector('.wa-modal-overlay');
  if (overlay) overlay.remove();
  showToast('💾 파일 정보 저장됨');
  renderDocManager();
}
