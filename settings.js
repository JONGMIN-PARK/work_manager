/**
 * 업무일지 분석기 — 설정 관리
 * 팀원 그룹, 별칭(닉네임) — 서버 DB 우선, localStorage 폴백
 */

/* ═══ localStorage 키 접두사 ═══ */
var LS_PREFIX = 'wa-';

/* ═══ 안전한 localStorage 접근 (접두사 포함) ═══ */
function prefLsGet(key) { try { return localStorage.getItem(LS_PREFIX + key); } catch(e) { console.warn('[LS]', e); return null; } }
function prefLsSet(key, val) { try { localStorage.setItem(LS_PREFIX + key, val); } catch(e) { console.warn('[LS]', e); } }
function prefLsDel(key) { try { localStorage.removeItem(LS_PREFIX + key); } catch(e) { console.warn('[LS]', e); } }

/* ═══ 서버 설정 저장/로드 헬퍼 ═══ */
function _canUseServer() {
  return typeof apiFetch === 'function' && typeof _accessToken !== 'undefined' && _accessToken;
}

async function _serverSettingsGet(key) {
  if (!_canUseServer()) return null;
  try {
    var res = await apiFetch('/api/settings/' + key);
    return res && res.data !== null ? res.data : null;
  } catch (e) { console.warn('[Settings] server get error:', key, e.message || e); return null; }
}

async function _serverSettingsPut(key, value) {
  if (!_canUseServer()) return false;
  // 최대 2회 재시도 (DB 콜드스타트 대비)
  for (var i = 0; i < 3; i++) {
    try {
      await apiFetch('/api/settings/' + key, { method: 'PUT', body: JSON.stringify({ value: value }) });
      return true;
    } catch (e) {
      console.warn('[Settings] put attempt', i + 1, key, e.status, e.message);
      if (i < 2 && (!e.status || e.status >= 500)) {
        await new Promise(function(r) { setTimeout(r, 2000); });
      } else { return false; }
    }
  }
  return false;
}

/* ═══════════════════════════════════════
   팀원 별칭 (Alias) 관리
   ═══════════════════════════════════════ */
var aliasMap = {};

function loadAliases() {
  const raw = prefLsGet('aliases');
  aliasMap = raw ? JSON.parse(raw) : {};
}

async function loadAliasesFromServer() {
  var srv = await _serverSettingsGet('aliases');
  if (srv && typeof srv === 'object' && Object.keys(srv).length > 0) {
    aliasMap = srv;
    prefLsSet('aliases', JSON.stringify(aliasMap));
  } else if (Object.keys(aliasMap).length > 0) {
    await _serverSettingsPut('aliases', aliasMap);
  }
}

async function saveAliases() {
  prefLsSet('aliases', JSON.stringify(aliasMap));
  var ok = await _serverSettingsPut('aliases', aliasMap);
  if (!ok && _canUseServer()) { if (typeof showToast === 'function') showToast('별칭 서버 저장 실패', 'warn'); }
}

function setAlias(realName, alias) {
  if (!alias || alias.trim() === '' || alias.trim() === realName) {
    delete aliasMap[realName];
  } else {
    aliasMap[realName] = alias.trim();
  }
  saveAliases();
}

function getAlias(realName) {
  return aliasMap[realName] || null;
}

function displayName(realName) {
  const alias = aliasMap[realName];
  return alias ? `${alias}(${realName})` : realName;
}

function shortName(realName) {
  return aliasMap[realName] || realName;
}

/* ═══════════════════════════════════════
   팀원 그룹 관리
   서버 DB 저장 + localStorage 캐시
   ═══════════════════════════════════════ */
var memberGroups = [];

function loadGroups() {
  const raw = prefLsGet('groups');
  memberGroups = raw ? JSON.parse(raw) : [];
}

async function loadGroupsFromServer() {
  var srv = await _serverSettingsGet('groups');
  if (srv && Array.isArray(srv) && srv.length > 0) {
    memberGroups = srv;
    prefLsSet('groups', JSON.stringify(memberGroups));
    if (typeof updateGroupButtons === 'function') updateGroupButtons();
  } else if (memberGroups.length > 0) {
    // 서버에 데이터 없고 로컬에 있으면 → 최초 업로드
    await _serverSettingsPut('groups', memberGroups);
  }
}

/** 서버 + localStorage 동시 저장 */
async function saveGroupsToServer() {
  prefLsSet('groups', JSON.stringify(memberGroups));
  var ok = await _serverSettingsPut('groups', memberGroups);
  return ok;
}

function createGroup(name, members, color) {
  const group = {
    id: 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    members: [...members],
    color: color || COL[memberGroups.length % COL.length],
    createdAt: new Date().toISOString()
  };
  memberGroups.push(group);
  return group;
}

function updateGroupLocal(id, updates) {
  const idx = memberGroups.findIndex(g => g.id === id);
  if (idx === -1) return null;
  Object.assign(memberGroups[idx], updates);
  return memberGroups[idx];
}

function deleteGroupLocal(id) {
  memberGroups = memberGroups.filter(g => g.id !== id);
}

function getGroup(id) {
  return memberGroups.find(g => g.id === id) || null;
}

// 호환용 래퍼 (HTML 스텁/기존 호출 대응)
function saveGroups() { saveGroupsToServer(); }
function updateGroup(id, updates) { var g = updateGroupLocal(id, updates); saveGroupsToServer(); return g; }
function deleteGroup(id) { deleteGroupLocal(id); saveGroupsToServer(); }

/* ═══════════════════════════════════════
   별칭 관리 UI
   ═══════════════════════════════════════ */
function renderAliasModal() {
  let existing = document.getElementById('aliasModal');
  if (existing) { existing.remove(); return; }

  const names = typeof aN !== 'undefined' ? aN : [];
  if (!names.length) { showToast('먼저 데이터를 업로드하세요.','warn'); return; }

  const modal = document.createElement('div');
  modal.id = 'aliasModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };

  let rows = names.map(n => {
    const a = getAlias(n) || '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--bd)">
      <span style="font-size:12px;color:var(--t3);min-width:80px;font-weight:600">${eH(n)}</span>
      <span style="color:var(--t6);font-size:10px">→</span>
      <input type="text" class="si alias-input" data-name="${eH(n)}" value="${eH(a)}" placeholder="별칭 입력..." style="flex:1;padding:5px 8px;padding-left:8px;font-size:11px">
    </div>`;
  }).join('');

  modal.innerHTML = `<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;max-width:480px;width:90%;max-height:80vh;overflow:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <h3 style="font-size:14px;font-weight:700;color:var(--t1)">👤 팀원 별칭 관리</h3>
      <button class="btn btn-g btn-s" onclick="document.getElementById('aliasModal').remove()">✕ 닫기</button>
    </div>
    <p style="font-size:11px;color:var(--t5);margin-bottom:12px">별칭을 지정하면 차트, 테이블, 아카이브에서 별칭으로 표시됩니다. 비우면 원래 이름 사용.</p>
    <div>${rows}</div>
    <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
      <button class="btn btn-d btn-s" onclick="clearAllAliases()">전체 삭제</button>
      <button class="btn btn-p" onclick="applyAliasModal()">💾 저장</button>
    </div>
  </div>`;

  document.body.appendChild(modal);
}

async function applyAliasModal() {
  document.querySelectorAll('#aliasModal .alias-input').forEach(inp => {
    const name = inp.dataset.name;
    const alias = inp.value.trim();
    if (!alias || alias === name) { delete aliasMap[name]; }
    else { aliasMap[name] = alias; }
  });
  await saveAliases();
  document.getElementById('aliasModal').remove();
  if (typeof rNC === 'function') rNC();
  if (typeof upV === 'function') upV();
  showToast('별칭 저장 완료');
}

async function clearAllAliases() {
  if (!confirm('모든 별칭을 삭제하시겠습니까?')) return;
  aliasMap = {};
  await saveAliases();
  document.getElementById('aliasModal').remove();
  if (typeof rNC === 'function') rNC();
  if (typeof upV === 'function') upV();
}

/* ═══════════════════════════════════════
   그룹 관리 UI
   ═══════════════════════════════════════ */
function renderGroupModal() {
  let existing = document.getElementById('groupModal');
  if (existing) { existing.remove(); return; }

  const modal = document.createElement('div');
  modal.id = 'groupModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;max-width:560px;width:90%;max-height:80vh;overflow:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <h3 style="font-size:14px;font-weight:700;color:var(--t1)">👥 팀원 그룹 관리</h3>
      <button class="btn btn-g btn-s" onclick="document.getElementById('groupModal').remove()">✕ 닫기</button>
    </div>

    <!-- 새 그룹 생성 -->
    <div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px;margin-bottom:14px">
      <div style="font-size:12px;font-weight:600;color:var(--t4);margin-bottom:8px">➕ 새 그룹 만들기</div>
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <input type="text" id="newGroupName" class="si" placeholder="그룹명 입력..." style="flex:1;min-width:120px;padding:6px 10px;padding-left:10px;font-size:12px">
        <button class="btn btn-p btn-s" id="grpCreateBtn" onclick="createGroupFromUI()">생성</button>
      </div>
      <div style="font-size:10px;color:var(--t5);margin-bottom:6px">현재 선택된 인원 <b id="grpSelCount">${typeof sN !== 'undefined' ? sN.size : 0}</b>명이 그룹에 포함됩니다.</div>
      <p style="font-size:10px;color:var(--t6)">💡 주간분석에서 팀원을 다중선택한 뒤 여기서 그룹으로 저장하세요.</p>
      <div id="grpSaveStatus" style="font-size:10px;min-height:16px;margin-top:4px"></div>
    </div>

    <!-- 기존 그룹 목록 -->
    <div id="groupListArea"></div>
  </div>`;

  document.body.appendChild(modal);
  renderGroupList();
}

function renderGroupList() {
  const area = document.getElementById('groupListArea');
  if (!area) return;

  if (!memberGroups.length) {
    area.innerHTML = '<div style="text-align:center;color:var(--t6);padding:20px;font-size:12px">저장된 그룹이 없습니다.</div>';
    return;
  }

  area.innerHTML = memberGroups.map(g => {
    const memberDisplay = g.members.map(m => shortName(m)).join(', ');
    var dateStr = '-';
    try { if (g.createdAt) { var d = new Date(g.createdAt); if (!isNaN(d.getTime())) dateStr = d.toLocaleDateString('ko'); } } catch(e) {}
    return `<div style="padding:10px;background:var(--bg-c);border:1px solid var(--bd2);border-radius:8px;margin-bottom:8px;border-left:3px solid ${g.color}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:13px;font-weight:700;color:var(--t1)">${eH(g.name)}</span>
        <div style="display:flex;gap:5px">
          <button class="btn btn-p btn-s" onclick="applyGroup('${g.id}')">선택 적용</button>
          <button class="btn btn-w btn-s" onclick="updateGroupMembersUI('${g.id}')">현재 인원으로 갱신</button>
          <button class="btn btn-d btn-s" onclick="deleteGroupUI('${g.id}')">삭제</button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--t4)">${g.members.length}명: ${eH(memberDisplay)}</div>
      <div style="font-size:9px;color:var(--t6);margin-top:4px">${dateStr} 생성</div>
    </div>`;
  }).join('');
}

async function createGroupFromUI() {
  const nameInput = document.getElementById('newGroupName');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) { showToast('그룹명을 입력하세요.', 'warn'); return; }

  const members = typeof sN !== 'undefined' ? [...sN] : [];
  if (!members.length) { showToast('먼저 주간분석에서 팀원을 선택하세요.', 'warn'); return; }

  // 버튼 비활성화 + 상태 표시
  var btn = document.getElementById('grpCreateBtn');
  var status = document.getElementById('grpSaveStatus');
  if (btn) btn.disabled = true;
  if (status) { status.textContent = '저장 중...'; status.style.color = 'var(--ac-t)'; }

  createGroup(name, members);
  var ok = await saveGroupsToServer();

  if (ok) {
    if (status) { status.textContent = '✅ 서버 저장 완료'; status.style.color = '#10B981'; }
    showToast(`"${name}" 그룹 생성 (${members.length}명)`);
  } else {
    if (status) { status.textContent = '⚠️ 로컬 저장됨 (서버 저장 실패)'; status.style.color = '#F59E0B'; }
    showToast(`"${name}" 그룹 생성 (로컬만)`, 'warn');
  }

  if (nameInput) nameInput.value = '';
  if (btn) btn.disabled = false;
  renderGroupList();
  updateGroupButtons();
}

/** 현재 활성 그룹 필터 ID */
var activeGroupId = null;

function applyGroup(id) {
  const g = getGroup(id);
  if (!g) return;
  if (typeof sN === 'undefined' || typeof aN === 'undefined') return;

  if (activeGroupId === id) { activeGroupId = null; }
  else { activeGroupId = id; }

  if (activeGroupId) {
    sN.clear();
    g.members.forEach(m => { if (aN.includes(m)) sN.add(m); });
  }

  if (sN.size > 1 && typeof multiSel !== 'undefined') {
    multiSel = true;
    const tog = document.getElementById('multiSelTog');
    if (tog) tog.checked = true;
    const btn = document.getElementById('selAllBtn');
    if (btn) btn.classList.remove('hidden');
  }

  if (typeof syncCmpVisibility === 'function') syncCmpVisibility();
  if (typeof rNC === 'function') rNC();
  if (typeof rFL === 'function') rFL();
  if (typeof upOP === 'function') upOP();
  if (typeof upV === 'function') upV();

  const modal = document.getElementById('groupModal');
  if (modal) modal.remove();
}

function showAllMembers() {
  activeGroupId = null;
  if (typeof rNC === 'function') rNC();
  if (typeof updateGroupButtons === 'function') updateGroupButtons();
}

async function updateGroupMembersUI(id) {
  const members = typeof sN !== 'undefined' ? [...sN] : [];
  if (!members.length) { showToast('먼저 팀원을 선택하세요.', 'warn'); return; }
  var g = updateGroupLocal(id, { members });
  if (g) {
    var ok = await saveGroupsToServer();
    renderGroupList();
    showToast(`"${g.name}" 그룹 갱신 (${members.length}명)` + (ok ? '' : ' — 로컬만'));
  }
}

// 이전 호출 호환용
function updateGroupMembers(id) { updateGroupMembersUI(id); }

async function deleteGroupUI(id) {
  const g = getGroup(id);
  if (!g) return;
  if (!confirm(`"${g.name}" 그룹을 삭제하시겠습니까?`)) return;
  deleteGroupLocal(id);
  var ok = await saveGroupsToServer();
  renderGroupList();
  updateGroupButtons();
  showToast(`"${g.name}" 그룹 삭제` + (ok ? '' : ' — 로컬만'));
}

function renderGroupQuickButtons(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!memberGroups.length) { el.innerHTML = ''; return; }

  const btns = memberGroups.map(g => {
    const isActive = activeGroupId === g.id;
    return `<button class="btn ${isActive ? 'btn-p' : 'btn-g'} btn-s" style="border-left:3px solid ${g.color}" onclick="applyGroup('${g.id}')" title="${g.members.map(m => shortName(m)).join(', ')}">
      👥 ${eH(g.name)} (${g.members.length})
    </button>`;
  }).join('');

  const allBtn = activeGroupId
    ? `<button class="btn btn-g btn-s" onclick="showAllMembers()">📋 전체 보기</button>`
    : '';

  el.innerHTML = btns + allBtn;
}

function updateGroupButtons() {
  renderGroupQuickButtons('groupQuickBtns');
}

/* ═══════════════════════════════════════
   데이터 백업 / 복원
   ═══════════════════════════════════════ */
function showBackupRestoreModal() {
  var overlay = document.createElement('div');
  overlay.id = 'backupOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
  overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

  var dialog = document.createElement('div');
  dialog.style.cssText = 'background:var(--bg-p);border-radius:12px;padding:24px;max-width:480px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3)';

  var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
  h += '<span style="font-size:14px;font-weight:700;color:var(--t1)">💾 데이터 백업 / 복원</span>';
  h += '<button onclick="document.getElementById(\'backupOverlay\').remove()" style="border:none;background:none;font-size:18px;cursor:pointer;color:var(--t5)">✕</button>';
  h += '</div>';

  h += '<div style="margin-bottom:16px">';
  h += '<p style="font-size:11px;color:var(--t3);margin-bottom:12px">전체 데이터(업무일지, 프로젝트, 마일스톤, 일정, 수주, 체크리스트, 이슈, 이슈이력, 진척이력)를 JSON 파일로 백업하고 복원합니다.</p>';

  h += '<button onclick="exportBackupJSON()" style="width:100%;padding:10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg-i);color:var(--t2);cursor:pointer;font-size:12px;font-weight:600;margin-bottom:8px">📥 전체 백업 다운로드</button>';

  h += '<div style="border:2px dashed var(--bd);border-radius:8px;padding:16px;text-align:center;margin-bottom:8px" id="backupDropZone">';
  h += '<input type="file" id="backupFileInput" accept=".json" style="display:none" onchange="importBackupJSON(this.files[0])">';
  h += '<p style="font-size:11px;color:var(--t5);margin-bottom:6px">복원할 JSON 파일을 선택하세요</p>';
  h += '<button onclick="document.getElementById(\'backupFileInput\').click()" style="padding:8px 16px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer;font-size:11px">📤 파일 선택</button>';
  h += '</div>';

  h += '<div id="backupStatus" style="font-size:10px;color:var(--t5)"></div>';
  h += '</div>';

  dialog.innerHTML = h;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function exportBackupJSON() {
  var stores = ['projects', 'milestones', 'events', 'progressHistory', 'orders', 'checklists', 'issues', 'issueLogs', 'workRecords', 'projectFolders', 'projectFiles'];
  var backup = { version: 8, exportDate: new Date().toISOString(), stores: {} };

  var promises = stores.map(function (storeName) {
    return new Promise(function (resolve) {
      try {
        openDBv2().then(function (db) {
          if (!db.objectStoreNames.contains(storeName)) { resolve(); return; }
          var tx = db.transaction(storeName, 'readonly');
          var st = tx.objectStore(storeName);
          var req = st.getAll();
          req.onsuccess = function () {
            backup.stores[storeName] = req.result || [];
            resolve();
          };
          req.onerror = function () { resolve(); };
        }).catch(function () { resolve(); });
      } catch (e) { resolve(); }
    });
  });

  backup.localStorage = {};
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.indexOf(LS_PREFIX) === 0) {
        backup.localStorage[key] = localStorage.getItem(key);
      }
    }
  } catch (e) { console.warn('[Settings]', e); }

  Promise.all(promises).then(function () {
    var totalItems = 0;
    Object.keys(backup.stores).forEach(function (k) { totalItems += (backup.stores[k] || []).length; });

    var json = JSON.stringify(backup, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'work-manager-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    var status = document.getElementById('backupStatus');
    if (status) status.innerHTML = '<span style="color:#10B981">✅ 백업 완료 — ' + totalItems + '건 데이터 내보내기</span>';
    if (typeof showToast === 'function') showToast('💾 백업 파일 다운로드 완료 (' + totalItems + '건)');
  });
}

function importBackupJSON(file) {
  if (!file) return;
  var status = document.getElementById('backupStatus');

  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var backup = JSON.parse(e.target.result);
      if (!backup.stores) { showToast('유효하지 않은 백업 파일입니다.','error'); return; }

      var storeNames = Object.keys(backup.stores);
      var totalItems = 0;
      storeNames.forEach(function (k) { totalItems += (backup.stores[k] || []).length; });

      if (!confirm('백업 데이터를 복원하시겠습니까?\n\n' +
        '복원 대상: ' + storeNames.join(', ') + '\n' +
        '총 ' + totalItems + '건\n' +
        '백업일: ' + (backup.exportDate || '알 수 없음') + '\n\n' +
        '⚠️ 기존 데이터가 덮어쓰기됩니다.')) return;

      if (status) status.innerHTML = '<span style="color:#F59E0B">복원 중...</span>';

      openDBv2().then(function (db) {
        var validStores = storeNames.filter(function (s) { return db.objectStoreNames.contains(s); });
        if (validStores.length === 0) { showToast('복원할 수 있는 스토어가 없습니다.','error'); return; }

        var tx = db.transaction(validStores, 'readwrite');
        var clearPromises = validStores.map(function (storeName) {
          return new Promise(function (resolve) {
            var st = tx.objectStore(storeName);
            var clearReq = st.clear();
            clearReq.onsuccess = function () {
              var items = backup.stores[storeName] || [];
              var putPromises = items.map(function (item) {
                return new Promise(function (res) {
                  var putReq = st.put(item);
                  putReq.onsuccess = function () { res(); };
                  putReq.onerror = function () { res(); };
                });
              });
              Promise.all(putPromises).then(resolve);
            };
            clearReq.onerror = function () { resolve(); };
          });
        });

        if (backup.localStorage) {
          Object.keys(backup.localStorage).forEach(function (key) {
            try { localStorage.setItem(key, backup.localStorage[key]); } catch (e) { console.warn('[Settings]', e); }
          });
        }

        Promise.all(clearPromises).then(function () {
          if (status) status.innerHTML = '<span style="color:#10B981">✅ 복원 완료 — ' + totalItems + '건</span>';
          if (typeof showToast === 'function') showToast('✅ 데이터 복원 완료 (' + totalItems + '건)', 'success');
          setTimeout(function () { location.reload(); }, 1000);
        });
      });
    } catch (err) {
      showToast('파일 파싱 실패: ' + err.message,'error');
    }
  };
  reader.readAsText(file);
}

/* ═══════════════════════════════════════
   업무분장 색상 커스터마이징
   ═══════════════════════════════════════ */

/** localStorage에서 사용자 커스텀 색상 로드 → ABR에 반영 */
function loadAbbrColors() {
  var raw = prefLsGet('abbrColors');
  if (raw) {
    try {
      var custom = JSON.parse(raw);
      Object.keys(custom).forEach(function(k) { if (custom[k]) ABR[k] = custom[k]; });
    } catch(e) { console.warn('[Settings] abbrColors parse error', e); }
  }
}

/** 서버에서 색상 동기화 */
async function loadAbbrColorsFromServer() {
  var srv = await _serverSettingsGet('abbrColors');
  if (srv && typeof srv === 'object' && Object.keys(srv).length > 0) {
    Object.keys(srv).forEach(function(k) { if (srv[k]) ABR[k] = srv[k]; });
    prefLsSet('abbrColors', JSON.stringify(srv));
  } else {
    // 로컬에 커스텀이 있으면 서버로 업로드
    var raw = prefLsGet('abbrColors');
    if (raw) {
      try { var local = JSON.parse(raw); if (Object.keys(local).length > 0) await _serverSettingsPut('abbrColors', local); } catch(e) {}
    }
  }
}

/** 커스텀 색상 저장 (서버 + localStorage) */
async function saveAbbrColors() {
  var custom = {};
  Object.keys(ABR).forEach(function(k) {
    if (ABR[k] !== ABR_DEFAULT[k]) custom[k] = ABR[k];
  });
  // 전부 기본이면 저장 제거
  if (Object.keys(custom).length === 0) {
    prefLsDel('abbrColors');
    await _serverSettingsPut('abbrColors', {});
  } else {
    prefLsSet('abbrColors', JSON.stringify(custom));
    await _serverSettingsPut('abbrColors', custom);
  }
}

/** 색상을 기본값으로 리셋 */
function resetAbbrColors() {
  Object.keys(ABR_DEFAULT).forEach(function(k) { ABR[k] = ABR_DEFAULT[k]; });
}

/** 색상 설정 모달 UI */
function renderAbbrColorModal() {
  var existing = document.getElementById('abbrColorModal');
  if (existing) { existing.remove(); return; }

  var modal = document.createElement('div');
  modal.id = 'abbrColorModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

  var keys = Object.keys(AM);
  var rows = keys.map(function(k) {
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bd)">' +
      '<span style="width:28px;height:28px;border-radius:6px;background:' + ABR[k] + ';display:inline-block;border:2px solid var(--bd)" class="abbrColorPreview" data-key="' + k + '"></span>' +
      '<span style="font-size:13px;font-weight:700;color:var(--t1);min-width:90px">' + AM[k] + '</span>' +
      '<input type="color" class="abbrColorInput" data-key="' + k + '" value="' + ABR[k] + '" style="width:40px;height:30px;border:1px solid var(--bd);border-radius:4px;cursor:pointer;background:none;padding:0">' +
      '<span class="mono" style="font-size:10px;color:var(--t5)" data-hex="' + k + '">' + ABR[k] + '</span>' +
      '<button class="btn btn-g btn-s" onclick="resetSingleAbbrColor(\'' + k + '\')" title="기본값으로" style="font-size:10px;padding:2px 6px">↺</button>' +
    '</div>';
  }).join('');

  modal.innerHTML = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;max-width:480px;width:90%;max-height:80vh;overflow:auto">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
      '<h3 style="font-size:14px;font-weight:700;color:var(--t1)">🎨 업무분장 색상 설정</h3>' +
      '<button class="btn btn-g btn-s" onclick="document.getElementById(\'abbrColorModal\').remove()">✕ 닫기</button>' +
    '</div>' +
    '<p style="font-size:11px;color:var(--t5);margin-bottom:12px">업무분장 코드별 색상을 설정합니다. 모든 차트에 동일하게 적용됩니다.</p>' +
    '<div style="margin-bottom:14px">' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;padding:10px;background:var(--bg-i);border-radius:8px">' +
        keys.map(function(k) {
          return '<span style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--t4)"><span style="width:12px;height:12px;border-radius:3px;background:' + ABR[k] + '" class="abbrColorChip" data-key="' + k + '"></span>' + k + '</span>';
        }).join('') +
      '</div>' +
      rows +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="btn btn-d btn-s" onclick="resetAllAbbrColors()">전체 초기화</button>' +
      '<button class="btn btn-p" onclick="applyAbbrColorModal()">💾 저장</button>' +
    '</div>' +
  '</div>';

  document.body.appendChild(modal);

  // color input 실시간 미리보기
  document.querySelectorAll('#abbrColorModal .abbrColorInput').forEach(function(inp) {
    inp.addEventListener('input', function() {
      var k = inp.dataset.key;
      var color = inp.value;
      // 프리뷰 업데이트
      var preview = document.querySelector('#abbrColorModal .abbrColorPreview[data-key="' + k + '"]');
      if (preview) preview.style.background = color;
      var chip = document.querySelector('#abbrColorModal .abbrColorChip[data-key="' + k + '"]');
      if (chip) chip.style.background = color;
      var hex = document.querySelector('#abbrColorModal [data-hex="' + k + '"]');
      if (hex) hex.textContent = color;
    });
  });
}

/** 단일 색상 기본값 복원 */
function resetSingleAbbrColor(k) {
  var inp = document.querySelector('#abbrColorModal .abbrColorInput[data-key="' + k + '"]');
  if (inp) {
    inp.value = ABR_DEFAULT[k];
    inp.dispatchEvent(new Event('input'));
  }
}

/** 전체 색상 기본값 복원 */
function resetAllAbbrColors() {
  if (!confirm('모든 색상을 기본값으로 초기화하시겠습니까?')) return;
  Object.keys(ABR_DEFAULT).forEach(function(k) {
    var inp = document.querySelector('#abbrColorModal .abbrColorInput[data-key="' + k + '"]');
    if (inp) { inp.value = ABR_DEFAULT[k]; inp.dispatchEvent(new Event('input')); }
  });
}

/** 모달에서 저장 적용 */
async function applyAbbrColorModal() {
  document.querySelectorAll('#abbrColorModal .abbrColorInput').forEach(function(inp) {
    ABR[inp.dataset.key] = inp.value;
  });
  await saveAbbrColors();
  document.getElementById('abbrColorModal').remove();
  // 차트 갱신
  if (typeof upV === 'function') upV();
  showToast('업무분장 색상 저장 완료');
}

/* ═══════════════════════════════════════
   초기화 — localStorage 즉시 로드 + 서버 비동기 동기화
   ═══════════════════════════════════════ */
function initSettings() {
  loadAliases();
  loadGroups();
  loadAbbrColors();
}

/** 서버 인증 완료 후 호출 — 서버에서 그룹/별칭 동기화 */
async function syncSettingsFromServer() {
  if (!_canUseServer()) return;
  try {
    await loadGroupsFromServer();
    if (typeof updateGroupButtons === 'function') updateGroupButtons();
  } catch (e) { console.warn('[Settings] group sync:', e); }
  try {
    await loadAliasesFromServer();
    if (typeof rNC === 'function') rNC();
  } catch (e) { console.warn('[Settings] alias sync:', e); }
  try {
    await loadAbbrColorsFromServer();
  } catch (e) { console.warn('[Settings] abbrColors sync:', e); }
}
