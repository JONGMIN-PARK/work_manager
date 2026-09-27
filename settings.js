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

  const modal = createModal({ id: 'aliasModal', z: MODAL_Z, overlayStyle: 'padding:0;background:rgba(0,0,0,.6)' }).overlay;
  // v13.63: backdrop 클릭 닫기 비활성화 — 데이터 유실 방지 (✕ 버튼만 닫기)

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

  const modal = createModal({ id: 'groupModal', z: MODAL_Z, overlayStyle: 'padding:0;background:rgba(0,0,0,.6)' }).overlay;
  // v13.63: backdrop 클릭 닫기 비활성화 — 데이터 유실 방지 (✕ 버튼만 닫기)

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
    if (status) { status.textContent = '✅ 서버 저장 완료'; status.style.color = SEM_COLOR.ok; }
    showToast(`"${name}" 그룹 생성 (${members.length}명)`);
  } else {
    if (status) { status.textContent = '⚠️ 로컬 저장됨 (서버 저장 실패)'; status.style.color = SEM_COLOR.warn; }
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
  var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
  h += '<span style="font-size:14px;font-weight:700;color:var(--t1)">💾 데이터 백업 / 복원</span>';
  h += '<button onclick="document.getElementById(\'backupOverlay\').remove()" style="border:none;background:none;font-size:18px;cursor:pointer;color:var(--t5)">✕</button>';
  h += '</div>';

  h += '<div style="margin-bottom:16px">';
  h += '<p style="font-size:11px;color:var(--t3);margin-bottom:12px">서버 데이터(프로젝트, 마일스톤, 일정, 수주, 이슈, 업무일지, 문서)와 이 브라우저의 환경설정을 JSON 파일로 백업합니다. 복원은 환경설정만 적용합니다 — 서버 데이터는 서버 DB 백업으로 복원하세요.</p>';

  h += '<button onclick="exportBackupJSON()" style="width:100%;padding:10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg-i);color:var(--t2);cursor:pointer;font-size:12px;font-weight:600;margin-bottom:8px">📥 전체 백업 다운로드</button>';

  h += '<div style="border:2px dashed var(--bd);border-radius:8px;padding:16px;text-align:center;margin-bottom:8px" id="backupDropZone">';
  h += '<input type="file" id="backupFileInput" accept=".json" style="display:none" onchange="importBackupJSON(this.files[0])">';
  h += '<p style="font-size:11px;color:var(--t5);margin-bottom:6px">복원할 JSON 파일을 선택하세요</p>';
  h += '<button onclick="document.getElementById(\'backupFileInput\').click()" style="padding:8px 16px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer;font-size:11px">📤 파일 선택</button>';
  h += '</div>';

  h += '<div id="backupStatus" style="font-size:10px;color:var(--t5)"></div>';
  h += '</div>';

  // v13.63: backdrop 클릭 닫기 비활성화 — 데이터 유실 방지 (✕ 버튼만 닫기) = createModal 기본값
  var dialog = createModal({ id: 'backupOverlay', z: MODAL_Z, overlayStyle: 'padding:0;background:rgba(0,0,0,.5);backdrop-filter:blur(2px)' }).box;
  dialog.style.cssText = 'background:var(--bg-p);border-radius:12px;padding:24px;max-width:480px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3)';
  dialog.innerHTML = h;
}

/* 백업 형식 (version 9)
   { version, exportDate, source: 'server', stores: { 이름: [행...] }, localStorage: { 'wa-…': 문자열 }, errors: [이름...] }
   - stores: 서버 데이터 스냅샷 (읽기 전용 보관용). IndexedDB 는 없어졌고 서버 DB 가 원본이다.
     복원 시 서버에 되쓰지 않는다 — 여러 사용자가 공유하는 DB 를 파일 한 장으로 덮어쓰면 위험하고,
     서버 DB 복원은 server/scripts/backup-db.js 로 한다.
   - localStorage: 이 브라우저의 환경설정(LS_PREFIX 키). 복원 대상.
     서버 동기화되는 설정(별칭·그룹·색상)은 복원 시 서버에도 저장 — 안 하면 다음 로드 때 서버 값이 덮어쓴다. */
var BACKUP_VERSION = 9;
var BACKUP_SERVER_SOURCES = [
  ['projects', 'projGetAll'], ['milestones', 'msGetAll'], ['events', 'evtGetAll'], ['orders', 'orderGetAll'],
  ['issues', 'issueGetAll'], ['workRecords', 'wrGetAll'], ['projectFolders', 'folderGetAll'], ['projectFiles', 'fileGetAll']
];
var BACKUP_SERVER_PREFS = ['aliases', 'groups', 'abbrColors'];

function _backupStorage(ls) {
  if (ls) return ls;
  try { return localStorage; } catch (e) { return null; }
}

/* [순수] LS_PREFIX 키만 모은다 (토큰 등 다른 키는 제외) */
function backupCollectPrefs(ls) {
  var out = {};
  ls = _backupStorage(ls);
  if (!ls) return out;
  for (var i = 0; i < ls.length; i++) {
    var key = ls.key(i);
    if (key && key.indexOf(LS_PREFIX) === 0) out[key] = ls.getItem(key);
  }
  return out;
}

/* 백업 객체 생성 — getters: { 함수이름: fn } (기본: 전역 데이터 함수). 실패한 스토어는 errors 에 이름을 남긴다 */
function buildBackupData(opts) {
  opts = opts || {};
  var getters = opts.getters || (typeof window !== 'undefined' ? window : {});
  var backup = { version: BACKUP_VERSION, exportDate: new Date().toISOString(), source: 'server', stores: {}, localStorage: backupCollectPrefs(opts.storage), errors: [] };
  return Promise.all(BACKUP_SERVER_SOURCES.map(function (src) {
    var fn = getters[src[1]];
    if (typeof fn !== 'function') { backup.errors.push(src[0]); return null; }
    return Promise.resolve().then(function () { return fn(); }).then(function (rows) {
      backup.stores[src[0]] = Array.isArray(rows) ? rows : [];
    }).catch(function (err) {
      console.warn('[Backup] ' + src[0], err);
      backup.errors.push(src[0]);
    });
  })).then(function () { return backup; });
}

function _backupCount(backup) {
  var n = 0;
  Object.keys((backup && backup.stores) || {}).forEach(function (k) { n += ((backup.stores[k]) || []).length; });
  return n;
}

/* [순수] 백업 파일 검증 — 옛(v8, IndexedDB 시절) 파일도 localStorage 가 있으면 복원 가능 */
function parseBackupText(text) {
  var backup = JSON.parse(text);
  if (!backup || typeof backup !== 'object' || (!backup.localStorage && !backup.stores)) throw new Error('유효하지 않은 백업 파일입니다.');
  return backup;
}

/* 환경설정 복원 — LS_PREFIX 키만. 서버 동기화 설정은 서버에도 저장. { restored, serverSynced, failed } */
function applyBackupPrefs(backup, opts) {
  opts = opts || {};
  var ls = _backupStorage(opts.storage);
  var put = opts.serverPut || (typeof _serverSettingsPut === 'function' ? _serverSettingsPut : null);
  var prefs = (backup && backup.localStorage) || {};
  var res = { restored: 0, serverSynced: 0, failed: [] };
  Object.keys(prefs).forEach(function (key) {
    if (key.indexOf(LS_PREFIX) !== 0 || typeof prefs[key] !== 'string') return;
    try { ls.setItem(key, prefs[key]); res.restored++; } catch (e) { console.warn('[Backup]', key, e); res.failed.push(key); }
  });
  var jobs = BACKUP_SERVER_PREFS.map(function (name) {
    var raw = prefs[LS_PREFIX + name];
    if (typeof raw !== 'string' || !put) return null;
    var val;
    try { val = JSON.parse(raw); } catch (e) { res.failed.push(LS_PREFIX + name); return null; }
    return Promise.resolve(put(name, val)).then(function (ok) {
      // _serverSettingsPut 은 서버를 못 쓰는 상태(로그인 전·file://)면 false — 로컬 복원만 된 것
      if (ok) res.serverSynced++;
    }).catch(function () { res.failed.push(LS_PREFIX + name); });
  });
  return Promise.all(jobs).then(function () { return res; });
}

function _backupStatus(html) {
  var status = document.getElementById('backupStatus');
  if (status) status.innerHTML = html;
}

function exportBackupJSON() {
  _backupStatus('<span style="color:' + SEM_COLOR.warn + '">백업 중...</span>');
  return buildBackupData().then(function (backup) {
    var totalItems = _backupCount(backup);
    var json = JSON.stringify(backup, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'work-manager-backup-' + localDate() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    var prefCount = Object.keys(backup.localStorage).length;
    var msg = '백업 완료 — 서버 데이터 ' + totalItems + '건, 환경설정 ' + prefCount + '개';
    if (backup.errors.length) {
      _backupStatus('<span style="color:' + SEM_COLOR.warn + '">⚠️ ' + eH(msg) + ' (실패: ' + eH(backup.errors.join(', ')) + ')</span>');
      if (typeof showToast === 'function') showToast('⚠️ 일부 데이터를 가져오지 못했습니다: ' + backup.errors.join(', '), 'error');
    } else {
      _backupStatus('<span style="color:' + SEM_COLOR.ok + '">✅ ' + eH(msg) + '</span>');
      if (typeof showToast === 'function') showToast('💾 백업 파일 다운로드 완료 (' + totalItems + '건)');
    }
    return backup;
  }).catch(function (err) {
    console.error('[Backup export]', err);
    _backupStatus('<span style="color:' + SEM_COLOR.danger + '">❌ 백업 실패</span>');
    if (typeof showToast === 'function') showToast('백업 실패: ' + (err && err.message || err), 'error');
  });
}

function importBackupJSON(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onerror = function () {
    if (typeof showToast === 'function') showToast('파일을 읽지 못했습니다.', 'error');
  };
  reader.onload = function (e) {
    var backup;
    try { backup = parseBackupText(e.target.result); } catch (err) {
      if (typeof showToast === 'function') showToast('파일 파싱 실패: ' + err.message, 'error');
      return;
    }
    var prefKeys = Object.keys(backup.localStorage || {}).filter(function (k) { return k.indexOf(LS_PREFIX) === 0; });
    var storeNames = Object.keys(backup.stores || {});
    if (!prefKeys.length) {
      if (typeof showToast === 'function') showToast('복원할 환경설정이 없는 백업 파일입니다. 서버 데이터는 서버 DB 백업으로 복원하세요.', 'error');
      return;
    }
    if (!confirm('환경설정을 복원하시겠습니까?\n\n' +
      '복원 대상: 환경설정 ' + prefKeys.length + '개 (별칭·그룹·색상은 서버에도 저장)\n' +
      '백업일: ' + (backup.exportDate || '알 수 없음') + '\n' +
      (storeNames.length ? '※ 파일 안의 서버 데이터(' + _backupCount(backup) + '건)는 복원하지 않습니다 — 서버 DB 가 원본입니다.\n' : '') +
      '\n⚠️ 이 브라우저의 기존 환경설정이 덮어쓰기됩니다.')) return;

    _backupStatus('<span style="color:' + SEM_COLOR.warn + '">복원 중...</span>');
    applyBackupPrefs(backup).then(function (res) {
      var msg = '환경설정 ' + res.restored + '개 복원' + (res.serverSynced ? ' (서버 동기화 ' + res.serverSynced + '개)' : '');
      if (res.failed.length) {
        _backupStatus('<span style="color:' + SEM_COLOR.warn + '">⚠️ ' + eH(msg) + ' — 실패: ' + eH(res.failed.join(', ')) + '</span>');
        if (typeof showToast === 'function') showToast('⚠️ 일부 설정 복원 실패: ' + res.failed.join(', '), 'error');
        return;
      }
      _backupStatus('<span style="color:' + SEM_COLOR.ok + '">✅ ' + eH(msg) + '</span>');
      if (typeof showToast === 'function') showToast('✅ ' + msg, 'success');
      setTimeout(function () { location.reload(); }, 1000);
    }).catch(function (err) {
      console.error('[Backup import]', err);
      _backupStatus('<span style="color:' + SEM_COLOR.danger + '">❌ 복원 실패</span>');
      if (typeof showToast === 'function') showToast('복원 실패: ' + (err && err.message || err), 'error');
    });
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

  var modal = createModal({ id: 'abbrColorModal', z: MODAL_Z, overlayStyle: 'padding:0;background:rgba(0,0,0,.6)' }).overlay;
  // v13.63: backdrop 클릭 닫기 비활성화 — 데이터 유실 방지 (✕ 버튼만 닫기)

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
