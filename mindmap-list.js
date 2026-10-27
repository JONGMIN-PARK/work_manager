/**
 * 업무 관리자 — 🧠 마인드맵 목록 · 모달
 * 맵 목록(카드 · 탭 · 즐겨찾기 · 복제 · 삭제), 새 맵(빈 틀 · 자동 생성 · AI), 가져오기(.xmind · .opml · Markdown),
 * 사용 권한(관리자), 공유 설정.
 * 의존(전역): mindmap.js(_mm · 헬퍼 · mmOpen), mindmap-extra.js(mmGenerateDoc · mmAiTextDoc · mmAiWbsDoc · mmReadImportFile)
 */

/* ═══ 목록 ═══ */
function _mmRenderList() {
  var wrap = _mmEl('mindmapWrap');
  if (!wrap) return;
  _mm.view = 'list';
  var tabs = [['all', '전체'], ['mine', '내 맵'], ['shared', '공유받은'], ['project', '프로젝트'], ['org', '조직']];
  var h = '<div class="mm-list-head">' +
    '<div><h3 class="mm-h3">🧠 마인드맵</h3><div class="mm-sub">생각 정리 · 업무 분장 · 프로젝트 구조 — 개인 맵은 본인과 공유한 사람만 볼 수 있습니다.</div></div>' +
    '<div class="mm-list-actions">' +
    (_mmIsAdmin() ? '<button class="btn btn-g btn-s" data-act="access">👥 사용 권한</button>' : '') +
    '<button class="btn btn-g btn-s" data-act="import">⤓ 가져오기</button>' +
    '<button class="btn btn-p btn-s" data-act="new">+ 새 맵</button>' +
    '</div></div>' +
    '<div class="mm-list-bar"><div class="mm-seg">' +
    tabs.map(function (t) { return '<button data-act="tab" data-tab="' + t[0] + '" class="' + (_mm.listTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') +
    '</div><input id="mmListQ" class="mm-input" placeholder="🔍 제목 검색" value="' + _mmEsc(_mm.q) + '"></div>' +
    '<div id="mmListBody"><div class="mm-empty">로딩 중...</div></div>';
  wrap.innerHTML = h;
  wrap.onclick = _mmListClick;
  var q = _mmEl('mmListQ');
  if (q) q.oninput = function () { _mm.q = q.value; _mmPaintList(); };
  apiFetch('/api/mindmaps').then(function (r) {
    _mm.list = (r && r.data) || [];
    _mmPaintList();
  }).catch(function (e) {
    var b = _mmEl('mmListBody');
    if (b) b.innerHTML = '<div class="mm-empty">목록을 불러오지 못했습니다 — ' + _mmEsc(e && e.status === 404 ? '서버 배포 후 사용 가능' : _mmErr(e)) + '</div>';
  });
}

function _mmPaintList() {
  var body = _mmEl('mmListBody');
  if (!body) return;
  var me = (_mmMe() || {}).id;
  var q = (_mm.q || '').trim().toLowerCase();
  var list = _mm.list.filter(function (m) {
    if (q && String(m.title || '').toLowerCase().indexOf(q) < 0) return false;
    switch (_mm.listTab) {
      case 'mine': return m.owner_id === me;
      case 'shared': return m.owner_id !== me && m.scope === 'personal';
      case 'project': return m.scope === 'project';
      case 'org': return m.scope === 'org';
      default: return true;
    }
  });
  if (!list.length) {
    body.innerHTML = '<div class="mm-empty">' + (_mm.list.length ? '조건에 맞는 맵이 없습니다.' : '아직 맵이 없습니다. <b>+ 새 맵</b>으로 시작하세요.') + '</div>';
    return;
  }
  function isPinned(m) { return (m.pinned_by || []).indexOf(me) >= 0; }
  var pinned = list.filter(isPinned);
  var rest = list.filter(function (m) { return !isPinned(m); });
  var h = '';
  if (pinned.length) h += '<div class="mm-sec">⭐ 즐겨찾기</div><div class="mm-grid">' + pinned.map(_mmCardHtml).join('') + '</div>';
  h += (pinned.length ? '<div class="mm-sec">최근 수정</div>' : '') + '<div class="mm-grid">' + rest.map(_mmCardHtml).join('') + '</div>';
  body.innerHTML = h;
}

function _mmCardHtml(m) {
  var me = (_mmMe() || {}).id;
  var sc = MM_SCOPE[m.scope] || MM_SCOPE.personal;
  var pinned = (m.pinned_by || []).indexOf(me) >= 0;
  var owner = m.owner_id === me;
  var shared = (m.editors || []).length + (m.viewers || []).length;
  return '<div class="mm-card" data-act="open" data-id="' + _mmEsc(m.id) + '">' +
    '<div class="mm-card-top"><span class="mm-badge">' + sc.i + ' ' + sc.l + '</span>' +
    '<span class="mm-star' + (pinned ? ' on' : '') + '" data-act="pin" data-id="' + _mmEsc(m.id) + '" title="즐겨찾기">' + (pinned ? '★' : '☆') + '</span></div>' +
    '<div class="mm-card-title">' + _mmEsc(m.title) + '</div>' +
    '<div class="mm-card-root">◉ ' + _mmEsc(m.root_text || '') + '</div>' +
    (m.project_name ? '<div class="mm-card-meta">📁 ' + _mmEsc(m.project_name) + '</div>' : '') +
    '<div class="mm-card-meta">' + _mmEsc(m.owner_name || '') + (shared ? ' · 공유 ' + shared + '명' : '') +
    ' · 노드 ' + (m.node_count || 0) + ' · ' + _mmFmtTime(m.updated_at) + '</div>' +
    '<div class="mm-card-acts">' +
    '<button class="btn btn-g btn-s" data-act="dup" data-id="' + _mmEsc(m.id) + '">복제</button>' +
    ((owner || (_mmIsAdmin() && m.scope !== 'personal')) ? '<button class="btn btn-g btn-s mm-danger" data-act="del" data-id="' + _mmEsc(m.id) + '">삭제</button>' : '') +
    '</div></div>';
}

function _mmListClick(e) {
  var t = e.target.closest('[data-act]');
  if (!t || !this.contains(t)) return;
  var act = t.getAttribute('data-act');
  var id = t.getAttribute('data-id');
  if (act !== 'open') e.stopPropagation();
  if (act === 'tab') { _mm.listTab = t.getAttribute('data-tab'); _mmRenderListTabs(); _mmPaintList(); }
  else if (act === 'open') mmOpen(id);
  else if (act === 'new') mmNewMapModal();
  else if (act === 'import') mmImportModal();
  else if (act === 'access') mmAccessModal();
  else if (act === 'pin') _mmTogglePin(id);
  else if (act === 'dup') _mmDuplicate(id);
  else if (act === 'del') _mmDelete(id);
}
function _mmRenderListTabs() {
  document.querySelectorAll('#mindmapWrap .mm-list-bar [data-act="tab"]').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-tab') === _mm.listTab);
  });
}
function _mmTogglePin(id) {
  var me = (_mmMe() || {}).id;
  var m = _mm.list.filter(function (x) { return x.id === id; })[0];
  if (!m) return;
  var pinned = (m.pinned_by || []).indexOf(me) < 0;
  apiFetch('/api/mindmaps/' + encodeURIComponent(id) + '/pin', { method: 'PUT', body: JSON.stringify({ pinned: pinned }) })
    .then(function () {
      m.pinned_by = (m.pinned_by || []).filter(function (x) { return x !== me; });
      if (pinned) m.pinned_by.push(me);
      _mmPaintList();
    }).catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
}
function _mmDuplicate(id) {
  apiFetch('/api/mindmaps/' + encodeURIComponent(id) + '/duplicate', { method: 'POST', body: '{}' })
    .then(function () { _mmToast('내 개인 맵으로 복제했습니다'); _mmRenderList(); })
    .catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
}
function _mmDelete(id) {
  var m = _mm.list.filter(function (x) { return x.id === id; })[0];
  if (!confirm('"' + (m ? m.title : '') + '" 맵을 삭제할까요?')) return;
  apiFetch('/api/mindmaps/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function () { _mmToast('삭제했습니다'); _mmRenderList(); })
    .catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
}

/* ═══ 새 맵 · 가져오기 · 사용 권한 모달 ═══ */
function mmNewMapModal() {
  return wmGuardedModal('mmNew', function () {
    var pList = (typeof projGetAll === 'function') ? projGetAll().catch(function () { return []; }) : Promise.resolve([]);
    var dList = _mmIsAdmin() ? apiFetch('/api/departments').then(function (r) { return (r && r.data) || []; }).catch(function () { return []; }) : Promise.resolve([]);
    var aiP = (typeof mmAiCheck === 'function') ? mmAiCheck() : Promise.resolve(false);
    return Promise.all([pList, dList, aiP]).then(function (res) {
      var projects = res[0] || [];
      var depts = res[1] || [];
      var ai = !!res[2];
      var me = _mmMe() || {};
      var hasDept = !!(me.department_id || me.departmentId);
      var opt = function (t) { return '<option value="' + t.k + '">' + t.l + '</option>'; };
      var html = '<div class="mm-form">' +
        '<label>시작 방법<select id="mmNewTpl" class="mm-input">' +
        '<optgroup label="빈 틀">' + MM_TEMPLATES.map(opt).join('') + '</optgroup>' +
        '<optgroup label="앱 데이터로 자동 생성 (상태가 실시간으로 보임)">' + MM_GEN_TEMPLATES.map(opt).join('') + '</optgroup>' +
        (ai ? '<optgroup label="✨ AI">' + MM_AI_TEMPLATES.map(opt).join('') + '</optgroup>' : '') +
        '</select></label>' +
        '<div class="mm-sub" id="mmNewHint"></div>' +
        '<label>제목<input id="mmNewTitle" class="mm-input" placeholder="예: SK 2호기 WBS"></label>' +
        '<label id="mmNewProjWrap" class="hidden">프로젝트<select id="mmNewProj" class="mm-input">' + _mmProjectOptions(projects) + '</select></label>' +
        '<label id="mmNewDeptWrap" class="hidden">부서<select id="mmNewDept" class="mm-input">' +
        (hasDept ? '<option value="">내 부서</option>' : '') + (_mmIsAdmin() ? '<option value="__all">전체 (모든 사용자)</option>' : '') +
        depts.map(function (d) { return '<option value="' + _mmEsc(d.id) + '">' + _mmEsc(d.name) + '</option>'; }).join('') + '</select></label>' +
        '<label id="mmNewAiWrap" class="hidden">정리할 글 (회의 메모 · 요구사항 · 메일 등)<textarea id="mmNewAiText" class="mm-input" rows="8"></textarea></label>' +
        '<label>공개 범위<select id="mmNewScope" class="mm-input">' +
        '<option value="personal">🔒 개인 — 나와 공유한 사람만</option>' +
        '<option value="project">📁 프로젝트 — 프로젝트 권한을 따름</option>' +
        ((hasDept || _mmIsAdmin()) ? '<option value="dept">👥 팀 — 같은 부서 사용 권한자 읽기</option>' : '') +
        (_mmIsAdmin() ? '<option value="org">🏢 조직 — 사용 권한자 전체 읽기</option>' : '') +
        '</select></label>' +
        '<div class="mm-form-acts"><button class="btn btn-p" id="mmNewOk">만들기</button></div></div>';
      var md = createModal({ id: 'mmNewModal', title: '🧠 새 마인드맵', html: html, width: '500px', closeOnEsc: true });
      var scope = _mmEl('mmNewScope'), tplSel = _mmEl('mmNewTpl');
      function tplOf(k) { return MM_TEMPLATES.concat(MM_GEN_TEMPLATES, MM_AI_TEMPLATES).filter(function (t) { return t.k === k; })[0] || MM_TEMPLATES[0]; }
      function refresh(fromTpl) {
        var t = tplOf(tplSel.value);
        if (fromTpl) {
          if (t.gen === 'project' || t.ai === 'wbs') scope.value = 'project';
          else if (t.gen === 'team' && scope.querySelector('option[value="dept"]')) scope.value = 'dept';
          else if (t.gen === 'mine') scope.value = 'personal';
        }
        var needProj = scope.value === 'project' || t.gen === 'project' || t.ai === 'wbs';
        _mmEl('mmNewProjWrap').classList.toggle('hidden', !needProj);
        _mmEl('mmNewDeptWrap').classList.toggle('hidden', !(_mmIsAdmin() && (t.gen === 'team' || scope.value === 'dept')));
        _mmEl('mmNewAiWrap').classList.toggle('hidden', t.ai !== 'text');
        _mmEl('mmNewTitle').placeholder = (t.gen || t.ai) ? '비우면 자동으로 정함' : '예: SK 2호기 WBS';
        _mmEl('mmNewHint').textContent = t.hint || '';
      }
      tplSel.onchange = function () { refresh(true); };
      scope.onchange = function () { refresh(false); };
      refresh(false);
      _mmEl('mmNewTitle').onkeydown = function (e) { if (e.key === 'Enter') _mmEl('mmNewOk').click(); };
      _mmEl('mmNewOk').onclick = function () {
        var btn = this;
        var t = tplOf(tplSel.value);
        var title = _mmEl('mmNewTitle').value.trim();
        var projectId = _mmEl('mmNewProj').value || null;
        var deptSel = _mmEl('mmNewDept').value;
        var deptId = deptSel && deptSel !== '__all' ? deptSel : null;
        if (!title && !t.gen && !t.ai) { _mmToast('제목을 입력하세요', 'error'); return; }
        if ((scope.value === 'project' || t.gen === 'project' || t.ai === 'wbs') && !projectId) { _mmToast('프로젝트를 선택하세요', 'error'); return; }
        var made;
        if (t.gen) made = mmGenerateDoc(t.gen, { projectId: projectId, departmentId: deptId, all: deptSel === '__all' });
        else if (t.ai === 'text') made = mmAiTextDoc(_mmEl('mmNewAiText').value, title);
        else if (t.ai === 'wbs') made = mmAiWbsDoc(projectId, title);
        else {
          var root = _mmBuildTree(t.tree(title));
          root.id = 'n-root';
          made = Promise.resolve({ title: title, doc: { sheets: [{ id: 'sh-1', title: '시트 1', structure: t.structure || 'balanced', root: root, relations: [] }] } });
        }
        btn.disabled = true;
        var oldLabel = btn.textContent;
        if (t.gen || t.ai) btn.textContent = t.ai ? '✨ AI 가 정리하는 중…' : '불러오는 중…';
        made.then(function (r) {
          if (!r) throw new Error('만들 내용이 없습니다');
          return _mmCreate({ title: (title || r.title || '새 맵').slice(0, 255), scope: scope.value, projectId: projectId, departmentId: scope.value === 'dept' ? deptId : null, template: t.k, doc: r.doc });
        }).then(function (ok) {
          if (ok) md.close(); else { btn.disabled = false; btn.textContent = oldLabel; }
        }).catch(function (e) {
          btn.disabled = false; btn.textContent = oldLabel;
          _mmToast('❌ ' + _mmErr(e), 'error');
        });
      };
    });
  }, 'mmNewModal', { onOpen: function () { var t = _mmEl('mmNewTpl'); if (t) t.focus(); } });
}

function _mmCreate(body) {
  return apiFetch('/api/mindmaps', { method: 'POST', body: JSON.stringify(body) })
    .then(function (r) { mmOpen(r.data.id); return true; })
    .catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); return false; });
}

function mmImportModal() {
  return wmGuardedModal('mmImport', function () {
    var html = '<div class="mm-form">' +
      '<div class="mm-sub"><b>XMind</b>(.xmind) · <b>OPML</b>(.opml) 파일, 또는 <b>Markdown</b> 목록·제목(<code># 중심 주제</code>, <code>## 주요 주제</code>, <code>- 하위</code>)을 맵으로 바꿉니다.</div>' +
      '<label>파일<input type="file" id="mmImpFile" accept=".xmind,.opml,.xml,.md,.markdown,.txt" class="mm-input"></label>' +
      '<div class="mm-sub" id="mmImpInfo"></div>' +
      '<label>또는 붙여넣기 (Markdown)<textarea id="mmImpText" class="mm-input" rows="10" placeholder="# 프로젝트\n## 설계\n- 기구\n  - 프레임"></textarea></label>' +
      '<div class="mm-form-acts"><button class="btn btn-p" id="mmImpOk">맵 만들기</button></div></div>';
    var md = createModal({ id: 'mmImportModal', title: '⤓ 가져오기', html: html, width: '560px', closeOnEsc: true });
    var pending = null;   // XMind · OPML 에서 읽은 { title, doc }
    _mmEl('mmImpFile').onchange = function () {
      var f = this.files && this.files[0];
      pending = null;
      _mmEl('mmImpInfo').textContent = '';
      if (!f) return;
      if (/\.(xmind|opml|xml)$/i.test(f.name) && typeof mmReadImportFile === 'function') {
        _mmEl('mmImpInfo').textContent = '읽는 중…';
        mmReadImportFile(f).then(function (r) {
          pending = r;
          var n = 0;
          r.doc.sheets.forEach(function (sh) { n += mmCount(sh.root); });
          _mmEl('mmImpInfo').textContent = '✓ ' + f.name + ' — 시트 ' + r.doc.sheets.length + '개, 주제 ' + n + '개';
        }).catch(function (e) { _mmEl('mmImpInfo').textContent = '❌ ' + _mmErr(e); });
        return;
      }
      var rd = new FileReader();
      rd.onload = function () { _mmEl('mmImpText').value = rd.result; };
      rd.readAsText(f, 'utf-8');
    };
    _mmEl('mmImpOk').onclick = function () {
      var btn = this;
      var title, doc;
      if (pending) {
        title = pending.title; doc = pending.doc;
      } else {
        var root = mmFromMarkdown(_mmEl('mmImpText').value);
        if (!root) { _mmToast('가져올 내용이 없습니다', 'error'); return; }
        root.id = 'n-root';
        title = root.text;
        doc = { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: root, relations: [] }] };
      }
      var count = 0;
      doc.sheets.forEach(function (sh) { count += mmCount(sh.root); });
      if (count > 2000) { _mmToast('노드는 최대 2000개까지 가져올 수 있습니다 (' + count + '개)', 'error'); return; }
      btn.disabled = true;
      _mmCreate({ title: (title || '가져온 맵').slice(0, 100), scope: 'personal', template: 'import', doc: doc })
        .then(function (ok) { if (ok) md.close(); else btn.disabled = false; });
    };
  }, 'mmImportModal', { onOpen: function () { var t = _mmEl('mmImpText'); if (t) t.focus(); } });
}

/** 관리자: 사용 권한 부여/회수 */
function mmAccessModal() {
  return wmGuardedModal('mmAccess', function () {
    return apiFetch('/api/mindmaps/access/users').then(function (r) {
      var users = (r && r.data) || [];
      var roleL = { admin: '관리자', executive: '임원', manager: '팀장', member: '팀원' };
      var html = '<div class="mm-sub" style="margin-bottom:10px">관리자는 항상 사용할 수 있습니다. 그 외 사용자는 여기서 켠 사람만 마인드맵 탭이 보입니다. 권한을 끄면 그 사람의 맵은 보존되고 접근만 막힙니다.</div>' +
        '<input id="mmAccQ" class="mm-input" placeholder="🔍 이름·이메일" style="margin-bottom:8px">' +
        '<div class="mm-acc-list">' + users.map(function (u) {
          var admin = u.role === 'admin';
          return '<label class="mm-acc-row" data-q="' + _mmEsc(((u.name || '') + ' ' + (u.email || '')).toLowerCase()) + '">' +
            '<input type="checkbox" data-uid="' + _mmEsc(u.id) + '"' + (admin || u.mindmap_enabled ? ' checked' : '') + (admin ? ' disabled' : '') + '>' +
            '<span class="mm-acc-name">' + _mmEsc(u.name || '') + '</span>' +
            '<span class="mm-acc-meta">' + _mmEsc(roleL[u.role] || u.role || '') + ' · ' + _mmEsc(u.email || '') + '</span></label>';
        }).join('') + '</div>';
      createModal({ id: 'mmAccessModal', title: '👥 마인드맵 사용 권한', html: html, width: '520px', closeOnEsc: true });
      var box = _mmEl('mmAccessModal');
      box.addEventListener('change', function (e) {
        var cb = e.target;
        if (!cb || !cb.getAttribute('data-uid')) return;
        var on = cb.checked;
        apiFetch('/api/mindmaps/access/users/' + encodeURIComponent(cb.getAttribute('data-uid')), { method: 'PUT', body: JSON.stringify({ enabled: on }) })
          .then(function () { _mmToast(on ? '사용 권한을 부여했습니다' : '사용 권한을 회수했습니다'); _mm.members = null; })
          .catch(function (err) { cb.checked = !on; _mmToast('❌ ' + _mmErr(err), 'error'); });
      });
      _mmEl('mmAccQ').oninput = function () {
        var q = this.value.trim().toLowerCase();
        box.querySelectorAll('.mm-acc-row').forEach(function (row) {
          row.style.display = !q || row.getAttribute('data-q').indexOf(q) >= 0 ? '' : 'none';
        });
      };
    });
  }, 'mmAccessModal');
}

/** 소유자: 공개 범위 · 공유 대상 */
function mmShareModal() {
  if (!_mm.row) return;
  return wmGuardedModal('mmShare', function () {
    var pList = (typeof projGetAll === 'function') ? projGetAll().catch(function () { return []; }) : Promise.resolve([]);
    return Promise.all([_mmLoadMembers(), pList]).then(function (res) {
      var me = (_mmMe() || {}).id;
      var members = (res[0] || []).filter(function (u) { return u.id !== me; });
      var projects = res[1] || [];
      var row = _mm.row;
      var editors = row.editors || [], viewers = row.viewers || [];
      var html = '<div class="mm-form">' +
        '<label>공개 범위<select id="mmShScope" class="mm-input">' +
        '<option value="personal"' + (row.scope === 'personal' ? ' selected' : '') + '>🔒 개인 — 나와 아래 공유 대상만</option>' +
        '<option value="project"' + (row.scope === 'project' ? ' selected' : '') + '>📁 프로젝트 — 프로젝트 권한을 따름</option>' +
        (_mmIsAdmin() || row.scope === 'org' ? '<option value="org"' + (row.scope === 'org' ? ' selected' : '') + '>🏢 조직 — 사용 권한자 전체 읽기</option>' : '') +
        '</select></label>' +
        '<label id="mmShProjWrap" class="' + (row.scope === 'project' ? '' : 'hidden') + '">프로젝트<select id="mmShProj" class="mm-input">' + _mmProjectOptions(projects, row.project_id) + '</select></label>' +
        '<div class="mm-sub">공유 대상 — 마인드맵 사용 권한이 있는 사람만 고를 수 있습니다.</div>' +
        '<div class="mm-acc-list">' + members.map(function (u) {
          var role = editors.indexOf(u.id) >= 0 ? 'edit' : viewers.indexOf(u.id) >= 0 ? 'view' : '';
          return '<div class="mm-acc-row"><span class="mm-acc-name">' + _mmEsc(u.name) + '</span>' +
            (u.has_access ? '<select class="mm-input mm-sh-role" data-uid="' + _mmEsc(u.id) + '">' +
              '<option value="">—</option><option value="view"' + (role === 'view' ? ' selected' : '') + '>보기</option>' +
              '<option value="edit"' + (role === 'edit' ? ' selected' : '') + '>편집</option></select>'
              : '<span class="mm-acc-meta">사용 권한 없음</span>') + '</div>';
        }).join('') + '</div>' +
        '<div class="mm-form-acts"><button class="btn btn-p" id="mmShOk">저장</button></div></div>';
      var md = createModal({ id: 'mmShareModal', title: '🔗 공유 설정', html: html, width: '480px', closeOnEsc: true });
      var scope = _mmEl('mmShScope');
      scope.onchange = function () { _mmEl('mmShProjWrap').classList.toggle('hidden', scope.value !== 'project'); };
      _mmEl('mmShOk').onclick = function () {
        var btn = this;
        var ed = [], vw = [];
        document.querySelectorAll('#mmShareModal .mm-sh-role').forEach(function (s) {
          if (s.value === 'edit') ed.push(s.getAttribute('data-uid'));
          else if (s.value === 'view') vw.push(s.getAttribute('data-uid'));
        });
        var body = { scope: scope.value, projectId: _mmEl('mmShProj').value || null, editors: ed, viewers: vw };
        btn.disabled = true;
        // 편집 중인 내용을 먼저 저장해 version 을 맞춘 뒤 공유 설정 저장
        Promise.resolve(_mmSaveNow()).then(function () {
          body.version = _mm.version;
          return apiFetch('/api/mindmaps/' + encodeURIComponent(_mm.mapId), { method: 'PUT', body: JSON.stringify(body) });
        }).then(function (r) {
          _mm.version = r.data.version;
          _mm.row.scope = r.data.scope; _mm.row.project_id = r.data.project_id;
          _mm.row.editors = r.data.editors || []; _mm.row.viewers = r.data.viewers || [];
          _mmToast('공유 설정을 저장했습니다');
          md.close();
          _mmStatus();
        }).catch(function (e) {
          btn.disabled = false;
          _mmToast('❌ ' + (e && e.status === 409 ? '다른 사람이 먼저 저장했습니다 — 새로고침 후 다시 시도하세요' : _mmErr(e)), 'error');
        });
      };
    });
  }, 'mmShareModal');
}
