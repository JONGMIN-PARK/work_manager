/**
 * 업무 관리자 — 🧠 마인드맵 Phase 2 기능 (PRD_마인드맵 3.2 ~ 3.6)
 * - 앱 데이터 연결(mmLinkModal) · 열기(mmOpenRef) · 승격(mmPromoteModal: 주제 → 마일스톤/이슈)
 * - 자동 생성(mmGenerateDoc) · 원본과 맞추기(mmResync)
 * - AI: 하위 주제 제안 · 가지 요약 · 글 → 가지 · WBS 초안 — 결과는 _ai 미리보기 노드(저장 제외) → 채택/버리기
 * - 가져오기(mmReadImportFile: .xmind · .opml) · OPML 내보내기
 * - 프로젝트 상세 패널의 "관련 마인드맵" 칸 (mmProjectSection)
 * 의존(전역): mindmap.js(_mm · _mmMutate · _mmSelInfo · _mmRoot · _mmPaint · _mmResolveRefs …), mindmap-layout.js,
 *            apiFetch, createModal, wmGuardedModal, projGetAll, JSZip, showProjectDetail · showIssueDetail · techOpenModal · psOpenModal · showASDetail
 */

var MM_DEFAULT_TEXTS = ['', '중심 주제', '주요 주제', '하위 주제', '주제'];

/* ═══ AI ═══ */
var _mmAiStatusP = null;
/** AI 사용 가능 여부 (서버 ANTHROPIC_API_KEY) — 한 번만 묻고 기억 */
function mmAiCheck() {
  function show(v) { var w = _mmEl('mmAiWrap'); if (w) w.classList.toggle('hidden', !v); return v; }
  if (_mm.aiReady != null) return Promise.resolve(show(_mm.aiReady));
  if (!_mmAiStatusP) {
    _mmAiStatusP = apiFetch('/api/mindmaps/ai/status')
      .then(function (r) { _mm.aiReady = !!(r && r.data && r.data.ready); })
      .catch(function () { _mm.aiReady = false; })
      .then(function () { _mmAiStatusP = null; return show(_mm.aiReady); });
  }
  return _mmAiStatusP;
}

function _mmAiCall(body) {
  body.mapId = _mm.mapId || null;
  return apiFetch('/api/mindmaps/ai', { method: 'POST', body: JSON.stringify(body), timeoutMs: 120000 })
    .then(function (r) { return r.data; })
    .catch(function (e) {
      var code = e && e.data && e.data.error;
      if (code === 'AI_NOT_READY') { _mm.aiReady = false; mmAiCheck(); }
      throw new Error(code === 'RATE_LIMIT' ? 'AI 호출 한도(시간당 30회)를 넘었습니다. 잠시 후 다시 시도하세요.' : (e && e.name === 'AbortError') ? 'AI 응답이 너무 오래 걸립니다. 다시 시도하세요.' : _mmErr(e));
    });
}

/** AI 평평한 목록 [{ text, parent, note?, days? }] → 최상위 노드 배열. preview 면 모든 노드에 _ai 표시 */
function _mmFlatToNodes(flat, preview) {
  var made = [], tops = [];
  (flat || []).forEach(function (f, i) {
    var n = mmNewNode(f.text);
    var note = [];
    if (f.note) note.push(f.note);
    if (f.days != null) note.push('예상 ' + f.days + '일');
    if (note.length) n.note = note.join('\n');
    if (preview) n._ai = true;
    made[i] = n;
    var p = made[f.parent];
    if (f.parent >= 0 && p) p.children.push(n); else tops.push(n);
  });
  return tops;
}

function _mmAiBusy(msg) {
  var bar = _mmEl('mmAiBar');
  if (bar) bar.innerHTML = msg ? '<div class="mm-banner mm-ai-banner">✨ ' + _mmEsc(msg) + ' <span class="mm-spin"></span></div>' : '';
  if (!msg) _mmAiBar();
}

/** AI 미리보기가 있으면 채택/버리기 막대 */
function _mmAiBar() {
  var bar = _mmEl('mmAiBar');
  if (!bar || !_mm.doc) return;
  if (bar.querySelector('.mm-spin')) return;   // 요청 중 표시는 그대로
  var n = 0;
  _mm.doc.sheets.forEach(function (sh) { mmWalk(sh.root, function (x) { if (x._ai) n++; }); });
  bar.innerHTML = n ? '<div class="mm-banner mm-ai-banner">✨ AI 제안 <b>' + n + '</b>개 (점선) — 필요 없는 주제는 지우거나 고친 뒤 채택하세요. 채택하기 전에는 저장되지 않습니다. ' +
    '<button class="btn btn-p btn-s" data-act="ai-accept">모두 채택</button> <button class="btn btn-g btn-s" data-act="ai-discard">모두 버리기</button></div>' : '';
}

function _mmAiInsert(parentId, tops) {
  if (!tops.length) { _mmToast('AI 가 제안한 주제가 없습니다'); return; }
  var f = mmFind(_mmRoot(), parentId);
  if (!f) return;
  _mmMutate(function () {
    f.node.collapsed = false;
    tops.forEach(function (n) { (f.node.children || (f.node.children = [])).push(n); });
    _mm.sel = tops[0].id;
  });
  _mmAiBar();
  _mmEnsureVisible(_mm.sel);
}

function mmAiAccept() {
  _mmMutate(function () {
    _mm.doc.sheets.forEach(function (sh) { mmWalk(sh.root, function (n) { delete n._ai; }); });
  });
  _mmAiBar();
  _mmToast('AI 제안을 맵에 넣었습니다');
}
function mmAiDiscard() {
  _mmMutate(function () {
    _mm.doc.sheets.forEach(function (sh) {
      (function strip(n) { n.children = (n.children || []).filter(function (c) { return !c._ai; }); n.children.forEach(strip); })(sh.root);
    });
    if (!mmFind(_mmRoot(), _mm.sel)) _mm.sel = _mmRoot().id;
  });
  _mmAiBar();
}

function _mmPathOf(id) {
  var path = [], f = mmFind(_mmRoot(), id);
  while (f) { path.unshift(f.node.text || ''); f = f.parent ? mmFind(_mmRoot(), f.parent.id) : null; }
  return path;
}

function mmAiExpand() {
  var f = _mmSelInfo();
  if (!f || _mm.readOnly) return;
  _mmAiBusy('하위 주제를 생각하는 중…');
  _mmAiCall({
    action: 'expand', path: _mmPathOf(f.node.id),
    siblings: f.parent ? f.parent.children.filter(function (c) { return c !== f.node; }).map(function (c) { return c.text; }) : [],
    existing: (f.node.children || []).map(function (c) { return c.text; }),
    note: f.node.note || ''
  }).then(function (d) {
    _mmAiBusy('');
    _mmAiInsert(f.node.id, _mmFlatToNodes(d.nodes, true));
  }).catch(function (e) { _mmAiBusy(''); _mmToast('❌ ' + e.message, 'error'); });
}

function mmAiSummary() {
  var f = _mmSelInfo();
  if (!f || _mm.readOnly) return;
  if (!(f.node.children || []).length) { _mmToast('하위 주제가 있는 주제를 고르세요'); return; }
  _mmAiBusy('가지를 요약하는 중…');
  _mmAiCall({ action: 'summarize', outline: mmToMarkdown(f.node) }).then(function (d) {
    _mmAiBusy('');
    if (!d.summary) return;
    _mmMutate(function () { f.node.summary = { text: d.summary }; f.node.collapsed = false; });
    _mmToast('요약을 넣었습니다 (되돌리기 Ctrl+Z)');
  }).catch(function (e) { _mmAiBusy(''); _mmToast('❌ ' + e.message, 'error'); });
}

/** 글 → 가지 (선택 주제 아래 미리보기) */
function mmAiTextModal() {
  if (_mm.readOnly) return;
  var f = _mmSelInfo();
  if (!f) return;
  return wmGuardedModal('mmAiText', function () {
    var html = '<div class="mm-form"><div class="mm-sub">"' + _mmEsc((f.node.text || '').slice(0, 40)) + '" 아래에 정리해 넣습니다. 회의 메모 · 요구사항 · 메일을 붙여넣으세요.</div>' +
      '<textarea id="mmAiTextIn" class="mm-input" rows="12"></textarea>' +
      '<div class="mm-form-acts"><button class="btn btn-p" id="mmAiTextOk">✨ 정리하기</button></div></div>';
    var md = createModal({ id: 'mmAiTextModal', title: '📝 글로 가지 만들기', html: html, width: '600px', closeOnEsc: true });
    _mmEl('mmAiTextOk').onclick = function () {
      var btn = this, text = _mmEl('mmAiTextIn').value;
      if (!text.trim()) { _mmToast('내용을 입력하세요', 'error'); return; }
      btn.disabled = true; btn.textContent = '✨ 정리하는 중…';
      _mmAiCall({ action: 'fromText', text: text, title: f.node.text }).then(function (d) {
        md.close();
        _mmAiInsert(f.node.id, _mmFlatToNodes(d.nodes, true));
      }).catch(function (e) { btn.disabled = false; btn.textContent = '✨ 정리하기'; _mmToast('❌ ' + e.message, 'error'); });
    };
  }, 'mmAiTextModal', { onOpen: function () { var t = _mmEl('mmAiTextIn'); if (t) t.focus(); } });
}

/** 가장 가까운 프로젝트 — 선택 주제부터 위로 올라가며 프로젝트 참조, 없으면 맵의 프로젝트 */
function _mmNearestProject(id) {
  var f = mmFind(_mmRoot(), id);
  while (f) {
    if (f.node.ref && f.node.ref.type === 'project') return f.node.ref.id;
    if (f.node.ref && f.node.ref.type === 'milestone') {
      var r = _mm.refs['milestone:' + f.node.ref.id];
      if (r && r.projectId) return r.projectId;
    }
    f = f.parent ? mmFind(_mmRoot(), f.parent.id) : null;
  }
  return (_mm.row && _mm.row.project_id) || '';
}

function mmAiWbsModal() {
  if (_mm.readOnly) return;
  var f = _mmSelInfo();
  if (!f) return;
  return wmGuardedModal('mmAiWbs', function () {
    return projGetAll().catch(function () { return []; }).then(function (projects) {
      var html = '<div class="mm-form"><div class="mm-sub">"' + _mmEsc((f.node.text || '').slice(0, 40)) + '" 아래에 WBS 초안(단계 → 작업 → 산출물, 예상 일수)을 넣습니다.</div>' +
        '<label>프로젝트<select id="mmAiWbsProj" class="mm-input">' + _mmProjectOptions(projects, _mmNearestProject(f.node.id)) + '</select></label>' +
        '<label>추가 요청 (선택)<textarea id="mmAiWbsExtra" class="mm-input" rows="3" placeholder="예: 시운전은 고객사 입회 2회, 해외 출하 포함"></textarea></label>' +
        '<div class="mm-form-acts"><button class="btn btn-p" id="mmAiWbsOk">✨ 초안 만들기</button></div></div>';
      var md = createModal({ id: 'mmAiWbsModal', title: '🏗 WBS 초안', html: html, width: '520px', closeOnEsc: true });
      _mmEl('mmAiWbsOk').onclick = function () {
        var btn = this, pid = _mmEl('mmAiWbsProj').value;
        if (!pid) { _mmToast('프로젝트를 선택하세요', 'error'); return; }
        btn.disabled = true; btn.textContent = '✨ 만드는 중…';
        _mmAiCall({ action: 'wbs', projectId: pid, extra: _mmEl('mmAiWbsExtra').value }).then(function (d) {
          md.close();
          _mmAiInsert(f.node.id, _mmFlatToNodes(d.nodes, true));
        }).catch(function (e) { btn.disabled = false; btn.textContent = '✨ 초안 만들기'; _mmToast('❌ ' + e.message, 'error'); });
      };
    });
  }, 'mmAiWbsModal');
}

/** 새 맵: 글 → 맵 문서 */
function mmAiTextDoc(text, title) {
  if (!String(text || '').trim()) return Promise.reject(new Error('정리할 글을 입력하세요'));
  return _mmAiCall({ action: 'fromText', text: text, title: title }).then(function (d) {
    var root = mmNewNode(title || 'AI 정리');
    root.children = _mmFlatToNodes(d.nodes, false);
    return { title: title || 'AI 정리', doc: { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: root, relations: [] }] } };
  });
}
/** 새 맵: 프로젝트 WBS 초안 문서 (루트 = 프로젝트 참조) */
function mmAiWbsDoc(projectId, title) {
  return Promise.all([_mmAiCall({ action: 'wbs', projectId: projectId }), projGetAll().catch(function () { return []; })]).then(function (res) {
    var p = (res[1] || []).filter(function (x) { return x.id === projectId; })[0];
    var name = p ? p.name : '프로젝트';
    var root = mmNewNode(name);
    root.ref = { type: 'project', id: projectId };
    root.children = _mmFlatToNodes(res[0].nodes, false);
    return { title: title || (name + ' WBS'), doc: { sheets: [{ id: 'sh-1', title: 'WBS', structure: 'right', root: root, relations: [] }] } };
  });
}

/* ═══ 자동 생성 · 원본과 맞추기 ═══ */
function mmGenerateDoc(kind, opts) {
  opts = opts || {};
  var body = { kind: kind, projectId: opts.projectId || undefined, departmentId: opts.all ? '__all' : (opts.departmentId || undefined) };
  return apiFetch('/api/mindmaps/generate', { method: 'POST', body: JSON.stringify(body), timeoutMs: 30000 }).then(function (r) {
    var g = r.data;
    return {
      title: g.title,
      doc: { meta: { gen: { kind: kind, projectId: body.projectId || null, departmentId: body.departmentId || null } },
        sheets: [{ id: 'sh-1', title: '시트 1', structure: g.structure || 'balanced', root: g.root, relations: [] }] }
    };
  });
}

/** 자동 생성 맵: 원본에 새로 생긴 항목(참조)만 맞는 자리에 추가 — 지우거나 옮긴 건 건드리지 않음 */
function mmResync() {
  var g = _mm.doc.meta && _mm.doc.meta.gen;
  if (!g || _mm.readOnly) return;
  var body = { kind: g.kind, projectId: g.projectId || undefined, departmentId: g.departmentId || undefined };
  apiFetch('/api/mindmaps/generate', { method: 'POST', body: JSON.stringify(body), timeoutMs: 30000 }).then(function (r) {
    var fresh = r.data.root;
    var sheet = _mm.doc.sheets[0];
    var have = {}, byRef = {}, byText = {};
    mmWalk(sheet.root, function (n, parent) {
      if (n.ref) { var k = n.ref.type + ':' + n.ref.id; have[k] = true; if (!byRef[k]) byRef[k] = n; }
      if (parent === sheet.root && n.text) byText[n.text] = n;
    });
    var parents = {};
    mmWalk(fresh, function (n, parent) { parents[n.id] = parent; });
    var adds = [];
    mmWalk(fresh, function (n) {
      if (n === fresh || !n.ref) return;
      var k = n.ref.type + ':' + n.ref.id;
      if (have[k]) return;
      // 붙일 자리: 위로 올라가며 같은 참조 → 같은 이름의 1단계 묶음 → 루트
      var target = null, p = parents[n.id];
      while (p && !target) {
        if (p === fresh) target = sheet.root;
        else if (p.ref && byRef[p.ref.type + ':' + p.ref.id]) target = byRef[p.ref.type + ':' + p.ref.id];
        else if (byText[p.text] && parents[p.id] === fresh) target = byText[p.text];
        p = parents[p.id];
      }
      adds.push({ target: target || sheet.root, node: n });
      mmWalk(n, function (x) { if (x.ref) have[x.ref.type + ':' + x.ref.id] = true; });
      return false;
    });
    if (!adds.length) { _mmToast('새로 생긴 항목이 없습니다'); return; }
    _mmMutate(function () {
      adds.forEach(function (a) {
        a.target.collapsed = false;
        (a.target.children || (a.target.children = [])).push(mmCloneBranch(a.node));
      });
    });
    _mmToast('새 항목 ' + adds.length + '개를 추가했습니다');
    _mmResolveRefs(true);
  }).catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
}

/* ═══ 앱 데이터 연결 · 열기 ═══ */
function mmLinkModal() {
  if (_mm.readOnly) return;
  var f = _mmSelInfo();
  if (!f) return;
  return wmGuardedModal('mmLink', function () {
    var types = Object.keys(MM_REF_TYPES);
    var html = '<div class="mm-form">' +
      '<div class="mm-sub">"' + _mmEsc((f.node.text || '').slice(0, 40)) + '" 주제를 앱 데이터에 연결합니다. 연결하면 상태·진척·담당이 실시간으로 보이고, 주제를 눌러 바로 열 수 있습니다.</div>' +
      '<div class="mm-seg mm-link-types">' + types.map(function (t, i) {
        return '<button data-lt="' + t + '" class="' + (i === 0 ? 'on' : '') + '">' + MM_REF_TYPES[t].i + ' ' + MM_REF_TYPES[t].l + '</button>';
      }).join('') + '</div>' +
      '<input id="mmLinkQ" class="mm-input" placeholder="🔍 이름으로 찾기">' +
      '<div class="mm-link-list" id="mmLinkList"><div class="mm-empty">불러오는 중…</div></div></div>';
    var md = createModal({ id: 'mmLinkModal', title: '🔗 앱 데이터 연결', html: html, width: '620px', closeOnEsc: true });
    var type = types[0], seq = 0, timer = null;
    function run() {
      var my = ++seq;
      var list = _mmEl('mmLinkList');
      apiFetch('/api/mindmaps/search-refs?type=' + type + '&q=' + encodeURIComponent(_mmEl('mmLinkQ').value.trim())).then(function (r) {
        if (my !== seq || !list) return;
        var rows = (r && r.data) || [];
        list.innerHTML = rows.length ? rows.map(function (x) {
          return '<button class="mm-link-row" data-id="' + _mmEsc(x.id) + '" data-title="' + _mmEsc(x.title) + '"><b>' + _mmEsc(x.title) + '</b>' +
            (x.sub ? '<span class="mm-hint">' + _mmEsc(x.sub) + '</span>' : '') + '</button>';
        }).join('') : '<div class="mm-empty">찾는 항목이 없습니다</div>';
      }).catch(function (e) { if (list) list.innerHTML = '<div class="mm-empty">❌ ' + _mmEsc(_mmErr(e)) + '</div>'; });
    }
    var box = _mmEl('mmLinkModal');
    box.addEventListener('click', function (e) {
      var tb = e.target.closest('[data-lt]');
      if (tb) {
        type = tb.getAttribute('data-lt');
        box.querySelectorAll('[data-lt]').forEach(function (b) { b.classList.toggle('on', b === tb); });
        run();
        return;
      }
      var row = e.target.closest('.mm-link-row');
      if (!row) return;
      var ref = { type: type, id: row.getAttribute('data-id') };
      var title = row.getAttribute('data-title');
      _mmMutate(function () {
        f.node.ref = ref;
        if (MM_DEFAULT_TEXTS.indexOf((f.node.text || '').trim()) >= 0) f.node.text = title;
      });
      delete _mm.refs[ref.type + ':' + ref.id];
      _mmResolveRefs(true);
      md.close();
      _mmFocusCanvas();
    });
    _mmEl('mmLinkQ').oninput = function () { clearTimeout(timer); timer = setTimeout(run, 250); };
    run();
  }, 'mmLinkModal', { onOpen: function () { var q = _mmEl('mmLinkQ'); if (q) q.focus(); } });
}

/** 참조 항목 열기 — 각 화면의 상세 창 */
function mmOpenRef(ref) {
  var r = _mm.refs[ref.type + ':' + ref.id];
  if (r && r.locked) { _mmToast('🔒 볼 권한이 없는 항목입니다'); return; }
  if (r && r.missing) { _mmToast('⚠️ 삭제된 항목입니다'); return; }
  function call(fn, arg) {
    if (typeof window[fn] === 'function') { window[fn](arg); return true; }
    _mmToast('이 화면에서는 열 수 없습니다', 'error');
    return false;
  }
  switch (ref.type) {
    case 'project': call('showProjectDetail', ref.id); break;
    case 'milestone':
    case 'meeting':
      if (r && r.projectId) call('showProjectDetail', r.projectId); else _mmToast('프로젝트 정보를 불러오는 중입니다');
      break;
    case 'issue': call('showIssueDetail', ref.id); break;
    case 'tech': call('techOpenModal', ref.id); break;
    case 'prestudy': call('psOpenModal', ref.id); break;
    case 'as': call('showASDetail', ref.id); break;
    case 'user':
      if (r) _mmToast('👤 ' + r.title + (r.dept ? ' (' + r.dept + ')' : '') + ' — 진행 중 마일스톤 ' + (r.msCount || 0) + ' · 미해결 이슈 ' + (r.issueCount || 0));
      break;
  }
}

/* ═══ 승격: 주제 → 마일스톤 / 이슈 ═══ */
function mmPromoteModal(kind) {
  if (_mm.readOnly) return;
  var f = _mmSelInfo();
  if (!f || f.node.ref) return;
  var isMs = kind === 'milestone';
  var label = isMs ? '마일스톤' : '이슈';
  var kids = (f.node.children || []).filter(function (c) { return !c.ref && !c._ai; });
  return wmGuardedModal('mmPromote', function () {
    return projGetAll().catch(function () { return []; }).then(function (projects) {
      var n = f.node;
      var html = '<div class="mm-form">' +
        '<label>프로젝트<select id="mmPrProj" class="mm-input">' + _mmProjectOptions(projects, _mmNearestProject(n.id)) + '</select></label>' +
        '<label>' + (isMs ? '이름' : '제목') + '<input id="mmPrName" class="mm-input" value="' + _mmEsc(n.text || '') + '"></label>' +
        (isMs
          ? '<div class="mm-pn-row"><label class="mm-pn-row">시작<input type="date" id="mmPrStart" class="mm-input" value="' + _mmEsc(n.startDate || '') + '"></label>' +
            '<label class="mm-pn-row">종료<input type="date" id="mmPrEnd" class="mm-input" value="' + _mmEsc(n.dueDate || '') + '"></label></div>'
          : '<div class="mm-pn-row"><label class="mm-pn-row">긴급도<select id="mmPrUrg" class="mm-input"><option value="normal">보통</option><option value="urgent">긴급</option><option value="low">일반</option></select></label>' +
            '<label class="mm-pn-row">마감<input type="date" id="mmPrEnd" class="mm-input" value="' + _mmEsc(n.dueDate || '') + '"></label></div>') +
        (kids.length ? '<label class="mm-pn-chk"><input type="checkbox" id="mmPrKids"> 하위 주제 ' + kids.length + '개도 각각 ' + label + '(으)로</label>' : '') +
        '<div class="mm-sub">만들면 주제가 그 ' + label + '에 연결되어 상태가 실시간으로 보입니다. 프로젝트를 편집할 권한이 있어야 합니다.</div>' +
        '<div class="mm-form-acts"><button class="btn btn-p" id="mmPrOk">' + label + ' 만들기</button></div></div>';
      var md = createModal({ id: 'mmPromoteModal', title: '⤴ ' + label + '(으)로 만들기', html: html, width: '480px', closeOnEsc: true });
      _mmEl('mmPrOk').onclick = function () {
        var btn = this;
        var pid = _mmEl('mmPrProj').value;
        var name = _mmEl('mmPrName').value.trim();
        if (!pid) { _mmToast('프로젝트를 선택하세요', 'error'); return; }
        if (!name) { _mmToast(label + ' 이름을 입력하세요', 'error'); return; }
        var jobs = [{ node: n, name: name, start: isMs ? _mmEl('mmPrStart').value : null, end: _mmEl('mmPrEnd').value }];
        if (kids.length && _mmEl('mmPrKids').checked) kids.forEach(function (c) { jobs.push({ node: c, name: c.text || '(이름 없음)', start: c.startDate || null, end: c.dueDate || null }); });
        btn.disabled = true;
        var done = [];
        var chain = Promise.resolve();
        jobs.forEach(function (j) {
          chain = chain.then(function () {
            var body = isMs
              ? { projectId: pid, name: j.name, startDate: j.start || '', endDate: j.end || '', status: 'waiting' }
              : { projectId: pid, title: j.name, dueDate: j.end || null, urgency: _mmEl('mmPrUrg').value, status: 'open', description: j.node.note || '',
                assignees: j.node.assigneeId && _mmMemberName(j.node.assigneeId) ? [_mmMemberName(j.node.assigneeId)] : [] };
            return apiFetch(isMs ? '/api/milestones' : '/api/issues', { method: 'POST', body: JSON.stringify(body) })
              .then(function (r) { done.push({ node: j.node, id: r.data.id }); });
          });
        });
        chain.catch(function (e) {
          _mmToast('❌ ' + (e && e.status === 403 ? '이 프로젝트를 편집할 권한이 없습니다' : _mmErr(e)) + (done.length ? ' — ' + done.length + '개는 만들었습니다' : ''), 'error');
        }).then(function () {
          if (done.length) {
            _mmMutate(function () {
              done.forEach(function (d) {
                d.node.ref = { type: kind, id: d.id };
                if (d.node === n) d.node.text = name;
              });
            });
            if (typeof _emitBus === 'function') _emitBus(kind, 'created', { projectId: pid });
            _mmResolveRefs(true);
            _mmToast(label + ' ' + done.length + '개를 만들고 연결했습니다');
            md.close();
          } else btn.disabled = false;
        });
      };
    });
  }, 'mmPromoteModal', { onOpen: function () { var t = _mmEl('mmPrName'); if (t) t.focus(); } });
}

/* ═══ 가져오기 · 내보내기 ═══ */
function _mmXmlKids(el, name) { return Array.prototype.filter.call(el ? el.children : [], function (c) { return c.localName === name; }); }
function _mmXmlText(el, name) { var k = _mmXmlKids(el, name)[0]; return k ? k.textContent : ''; }

/** XMind 8 content.xml → content.json 과 같은 모양 (mmFromXmindSheets 입력) */
function _mmXmindXmlToSheets(xmlText) {
  var xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  function topic(el) {
    var t = { id: el.getAttribute('id'), title: _mmXmlText(el, 'title'), branch: el.getAttribute('branch'),
      href: el.getAttribute('xlink:href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
      structureClass: el.getAttribute('structure-class'), children: { attached: [] }, markers: [], labels: [], boundaries: [] };
    var notes = _mmXmlKids(el, 'notes')[0];
    if (notes) t.notes = { plain: { content: _mmXmlText(notes, 'plain') } };
    _mmXmlKids(_mmXmlKids(el, 'marker-refs')[0], 'marker-ref').forEach(function (m) { t.markers.push({ markerId: m.getAttribute('marker-id') }); });
    _mmXmlKids(_mmXmlKids(el, 'labels')[0], 'label').forEach(function (l) { t.labels.push(l.textContent); });
    _mmXmlKids(_mmXmlKids(el, 'boundaries')[0], 'boundary').forEach(function (b) { t.boundaries.push({ range: b.getAttribute('range'), title: _mmXmlText(b, 'title') }); });
    _mmXmlKids(_mmXmlKids(el, 'children')[0], 'topics').forEach(function (ts) {
      if ((ts.getAttribute('type') || 'attached') !== 'attached') return;
      _mmXmlKids(ts, 'topic').forEach(function (c) { t.children.attached.push(topic(c)); });
    });
    return t;
  }
  var sheets = [];
  Array.prototype.forEach.call(xml.getElementsByTagName('sheet'), function (sh) {
    var rt = _mmXmlKids(sh, 'topic')[0];
    if (!rt) return;
    var rel = _mmXmlKids(_mmXmlKids(sh, 'relationships')[0], 'relationship').map(function (r) {
      return { end1Id: r.getAttribute('end1'), end2Id: r.getAttribute('end2'), title: _mmXmlText(r, 'title') };
    });
    sheets.push({ title: _mmXmlText(sh, 'title'), rootTopic: topic(rt), relationships: rel });
  });
  return sheets;
}

function _mmOpmlToTree(xmlText) {
  var xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  var body = xml.getElementsByTagName('body')[0];
  if (!body) return null;
  function conv(o) {
    return { text: o.getAttribute('text') || o.getAttribute('title') || '', note: o.getAttribute('_note') || '', done: o.getAttribute('_complete') === 'true',
      children: _mmXmlKids(o, 'outline').map(conv) };
  }
  var tops = _mmXmlKids(body, 'outline').map(conv);
  var title = (xml.getElementsByTagName('title')[0] || {}).textContent || '';
  if (tops.length === 1) return tops[0];
  return { text: title || '가져온 맵', children: tops };
}

/** .xmind · .opml 파일 → { title, doc } */
function mmReadImportFile(file) {
  var name = file.name || '';
  if (/\.xmind$/i.test(name)) {
    if (typeof JSZip === 'undefined') return Promise.reject(new Error('압축 모듈(JSZip)을 불러오지 못했습니다'));
    return JSZip.loadAsync(file).then(function (zip) {
      var j = zip.file('content.json');
      if (j) return j.async('string').then(function (t) { return mmFromXmindSheets(JSON.parse(t)); });
      var x = zip.file('content.xml');
      if (x) return x.async('string').then(function (t) { return mmFromXmindSheets(_mmXmindXmlToSheets(t)); });
      throw new Error('XMind 내용(content.json / content.xml)을 찾지 못했습니다');
    }).then(function (doc) {
      if (!doc) throw new Error('가져올 시트가 없습니다');
      return { title: doc.sheets[0].root.text || name.replace(/\.xmind$/i, ''), doc: doc };
    });
  }
  return new Promise(function (resolve, reject) {
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var t = _mmOpmlToTree(rd.result);
        if (!t) throw new Error('OPML 형식이 아닙니다');
        var root = mmFromPlainTree(t);
        resolve({ title: root.text || name, doc: { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: root, relations: [] }] } });
      } catch (e) { reject(e); }
    };
    rd.onerror = function () { reject(new Error('파일을 읽지 못했습니다')); };
    rd.readAsText(file, 'utf-8');
  });
}

function mmExportOpml() {
  if (!_mm.doc) return;
  _mmDownload(_mmFileName(_mm.row.title) + '.opml', new Blob([mmToOpml(_mmRoot(), _mm.row.title)], { type: 'text/x-opml;charset=utf-8' }));
}

/* ═══ 프로젝트 상세 패널 — 관련 마인드맵 ═══ */
function mmProjectSection(projectId, elId) {
  var el = document.getElementById(elId);
  if (!el || typeof mmHasAccess !== 'function' || !mmHasAccess()) return;
  el.innerHTML = '';
  apiFetch('/api/mindmaps/by-link?type=project&id=' + encodeURIComponent(projectId)).then(function (r) {
    var box = document.getElementById(elId);
    if (!box) return;
    var maps = (r && r.data) || [];
    box.innerHTML = '<div class="mm-pd-sec"><div class="mm-pd-head"><span>🧠 관련 마인드맵 (' + maps.length + ')</span>' +
      '<button class="btn btn-g btn-s" data-mm-gen="' + _mmEsc(projectId) + '">＋ 구조도 만들기</button></div>' +
      (maps.length ? maps.map(function (m) {
        var sc = MM_SCOPE[m.scope] || MM_SCOPE.personal;
        return '<button class="mm-pd-row" data-mm-open="' + _mmEsc(m.id) + '"><b>' + _mmEsc(m.title) + '</b><span class="mm-hint">' + sc.i + ' ' + sc.l + ' · ' + _mmEsc(m.owner_name || '') + ' · ' + _mmFmtTime(m.updated_at) + '</span></button>';
      }).join('') : '<div class="mm-hint">이 프로젝트를 담은 맵이 없습니다.</div>') + '</div>';
    box.onclick = function (e) {
      var o = e.target.closest('[data-mm-open]');
      var g = e.target.closest('[data-mm-gen]');
      if (o) _mmGoTo(o.getAttribute('data-mm-open'));
      else if (g) {
        g.disabled = true;
        mmGenerateDoc('project', { projectId: projectId }).then(function (res) {
          return apiFetch('/api/mindmaps', { method: 'POST', body: JSON.stringify({ title: res.title, scope: 'project', projectId: projectId, template: 'gen-project', doc: res.doc }) });
        }).then(function (cr) { _mmGoTo(cr.data.id); })
          .catch(function (err) { g.disabled = false; _mmToast('❌ ' + _mmErr(err), 'error'); });
      }
    };
  }).catch(function () { /* 권한 없음·서버 미배포 — 칸을 비워 둠 */ });
}
/** 다른 화면에서 맵 열기 — 상세 패널을 닫고 마인드맵 탭으로 */
function _mmGoTo(mapId) {
  if (typeof pdCloseDetail === 'function') pdCloseDetail();
  if (_mm.view === 'editor' && _mm.mapId === mapId && typeof curPage !== 'undefined' && curPage === 'mindmap') return;   // 이미 열려 있음
  if (_mm.view === 'editor' && _mm.mapId && _mm.mapId !== mapId) { _mmSaveNow(); _mmLockRelease(); }
  _mm.mapId = mapId;
  _mm.view = 'editor';
  if (typeof setPage === 'function') setPage('mindmap');
}
