/**
 * 업무일지 분석기 — 설정 관리
 * 팀원 그룹, 별칭(닉네임), localStorage 래퍼
 */

/* ═══ localStorage 키 접두사 ═══ */
var LS_PREFIX = 'wa-';

/* ═══ 안전한 localStorage 접근 (접두사 포함) ═══ */
function prefLsGet(key) { try { return localStorage.getItem(LS_PREFIX + key); } catch(e) { console.warn('[LS]', e); return null; } }
function prefLsSet(key, val) { try { localStorage.setItem(LS_PREFIX + key, val); } catch(e) { console.warn('[LS]', e); } }
function prefLsDel(key) { try { localStorage.removeItem(LS_PREFIX + key); } catch(e) { console.warn('[LS]', e); } }

/* ═══════════════════════════════════════
   팀원 별칭 (Alias) 관리
   저장 구조: wa-aliases = { "홍길동": "길동", "김철수": "CS팀장" }
   ═══════════════════════════════════════ */
var aliasMap = {};

function loadAliases() {
  const raw = prefLsGet('aliases');
  aliasMap = raw ? JSON.parse(raw) : {};
}

function saveAliases() {
  prefLsSet('aliases', JSON.stringify(aliasMap));
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

/** 표시용 이름: 별칭이 있으면 "별칭(원래이름)", 없으면 원래이름 */
function displayName(realName) {
  const alias = aliasMap[realName];
  return alias ? `${alias}(${realName})` : realName;
}

/** 짧은 표시: 별칭만, 없으면 원래이름 */
function shortName(realName) {
  return aliasMap[realName] || realName;
}

/* ═══════════════════════════════════════
   팀원 그룹 관리
   저장 구조: wa-groups = [
     { id: "...", name: "SW팀", members: ["홍길동","김철수"], color: "#3B82F6", createdAt: "..." },
     ...
   ]
   ═══════════════════════════════════════ */
var memberGroups = [];

function loadGroups() {
  const raw = prefLsGet('groups');
  memberGroups = raw ? JSON.parse(raw) : [];
}

function saveGroups() {
  prefLsSet('groups', JSON.stringify(memberGroups));
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
  saveGroups();
  return group;
}

function updateGroup(id, updates) {
  const idx = memberGroups.findIndex(g => g.id === id);
  if (idx === -1) return null;
  Object.assign(memberGroups[idx], updates);
  saveGroups();
  return memberGroups[idx];
}

function deleteGroup(id) {
  memberGroups = memberGroups.filter(g => g.id !== id);
  saveGroups();
}

function getGroup(id) {
  return memberGroups.find(g => g.id === id) || null;
}

/* ═══════════════════════════════════════
   별칭 관리 UI
   ═══════════════════════════════════════ */
function renderAliasModal() {
  let existing = document.getElementById('aliasModal');
  if (existing) { existing.remove(); return; }

  const names = typeof aN !== 'undefined' ? aN : [];
  if (!names.length) { alert('먼저 데이터를 업로드하세요.'); return; }

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

function applyAliasModal() {
  document.querySelectorAll('#aliasModal .alias-input').forEach(inp => {
    const name = inp.dataset.name;
    const alias = inp.value.trim();
    setAlias(name, alias);
  });
  document.getElementById('aliasModal').remove();
  // 뷰 갱신
  if (typeof rNC === 'function') rNC();
  if (typeof upV === 'function') upV();
}

function clearAllAliases() {
  if (!confirm('모든 별칭을 삭제하시겠습니까?')) return;
  aliasMap = {};
  saveAliases();
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

  const names = typeof aN !== 'undefined' ? aN : [];

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
        <button class="btn btn-p btn-s" onclick="createGroupFromUI()">생성</button>
      </div>
      <div style="font-size:10px;color:var(--t5);margin-bottom:6px">현재 선택된 인원 <b id="grpSelCount">${typeof sN !== 'undefined' ? sN.size : 0}</b>명이 그룹에 포함됩니다.</div>
      <p style="font-size:10px;color:var(--t6)">💡 주간분석에서 팀원을 다중선택한 뒤 여기서 그룹으로 저장하세요.</p>
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
    return `<div style="padding:10px;background:var(--bg-c);border:1px solid var(--bd2);border-radius:8px;margin-bottom:8px;border-left:3px solid ${g.color}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:13px;font-weight:700;color:var(--t1)">${eH(g.name)}</span>
        <div style="display:flex;gap:5px">
          <button class="btn btn-p btn-s" onclick="applyGroup('${g.id}')">선택 적용</button>
          <button class="btn btn-w btn-s" onclick="updateGroupMembers('${g.id}')">현재 인원으로 갱신</button>
          <button class="btn btn-d btn-s" onclick="deleteGroupUI('${g.id}')">삭제</button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--t4)">${g.members.length}명: ${eH(memberDisplay)}</div>
      <div style="font-size:9px;color:var(--t6);margin-top:4px">${new Date(g.createdAt).toLocaleDateString('ko')} 생성</div>
    </div>`;
  }).join('');
}

function createGroupFromUI() {
  const nameInput = document.getElementById('newGroupName');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) { alert('그룹명을 입력하세요.'); return; }

  const members = typeof sN !== 'undefined' ? [...sN] : [];
  if (!members.length) { alert('먼저 주간분석에서 팀원을 선택하세요.'); return; }

  createGroup(name, members);
  if (nameInput) nameInput.value = '';
  renderGroupList();
  updateGroupButtons();
  alert(`✅ "${name}" 그룹 생성 (${members.length}명)`);
}

/** 현재 활성 그룹 필터 ID (null이면 전체 보기) */
var activeGroupId = null;

function applyGroup(id) {
  const g = getGroup(id);
  if (!g) return;
  if (typeof sN === 'undefined' || typeof aN === 'undefined') return;

  // 같은 그룹 다시 클릭 → 토글 해제 (전체 보기)
  if (activeGroupId === id) {
    activeGroupId = null;
  } else {
    activeGroupId = id;
  }

  // 그룹 필터 적용 시 선택 초기화 + 그룹 멤버만 선택
  if (activeGroupId) {
    sN.clear();
    g.members.forEach(m => { if (aN.includes(m)) sN.add(m); });
  }
  // 전체 보기 복귀 시 선택 유지

  // 다중선택 활성화
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

  // 모달 닫기
  const modal = document.getElementById('groupModal');
  if (modal) modal.remove();
}

/** 전체 보기 (그룹 필터 해제) */
function showAllMembers() {
  activeGroupId = null;
  if (typeof rNC === 'function') rNC();
  if (typeof updateGroupButtons === 'function') updateGroupButtons();
}

function updateGroupMembers(id) {
  const members = typeof sN !== 'undefined' ? [...sN] : [];
  if (!members.length) { alert('먼저 팀원을 선택하세요.'); return; }
  const g = updateGroup(id, { members });
  if (g) {
    renderGroupList();
    alert(`✅ "${g.name}" 그룹 갱신 (${members.length}명)`);
  }
}

function deleteGroupUI(id) {
  const g = getGroup(id);
  if (!g) return;
  if (!confirm(`"${g.name}" 그룹을 삭제하시겠습니까?`)) return;
  deleteGroup(id);
  renderGroupList();
  updateGroupButtons();
}

/** 메인 UI에 그룹 빠른 적용 버튼 렌더링 */
function renderGroupQuickButtons(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!memberGroups.length) {
    el.innerHTML = '';
    return;
  }

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

  // localStorage 데이터도 포함
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
      if (!backup.stores) { alert('유효하지 않은 백업 파일입니다.'); return; }

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
        if (validStores.length === 0) { alert('복원할 수 있는 스토어가 없습니다.'); return; }

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

        // localStorage 복원
        if (backup.localStorage) {
          Object.keys(backup.localStorage).forEach(function (key) {
            try { localStorage.setItem(key, backup.localStorage[key]); } catch (e) { console.warn('[Settings]', e); }
          });
        }

        Promise.all(clearPromises).then(function () {
          if (status) status.innerHTML = '<span style="color:#10B981">✅ 복원 완료 — ' + totalItems + '건</span>';
          if (typeof showToast === 'function') showToast('✅ 데이터 복원 완료 (' + totalItems + '건)', 'success');
          // 화면 새로고침
          setTimeout(function () { location.reload(); }, 1000);
        });
      });
    } catch (err) {
      alert('파일 파싱 실패: ' + err.message);
    }
  };
  reader.readAsText(file);
}

/* ═══════════════════════════════════════
   초기화
   ═══════════════════════════════════════ */
function initSettings() {
  loadAliases();
  loadGroups();
}
