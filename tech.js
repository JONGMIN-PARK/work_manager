/**
 * 업무 관리자 — 요소기술 (Element Technology / 기반기술 자산)
 * 프로젝트에 종속되지 않는 재사용 기반기술을 카탈로그화하고, 개발일지로 경위를 보존한다.
 *
 * 보기: 카탈로그(카드) / 분류별 / 기술스택 / 목록
 * 데이터: techGetAll·techPut·techDel·techStacks·techMembers·techLogs* (project-data.js)
 */

var TECH_CAT = {
  vision:  { label: '비전',      icon: '👁',  color: '#8B5CF6' },
  motion:  { label: '모션',      icon: '⚙️', color: '#3B82F6' },
  control: { label: '제어',      icon: '🎛️', color: '#06B6D4' },
  sw:      { label: '소프트웨어', icon: '💻', color: '#EC4899' },
  ai:      { label: 'AI',        icon: '🤖', color: '#10B981' },
  comm:    { label: '통신',      icon: '📡', color: '#F59E0B' },
  mech:    { label: '기구',      icon: '🔩', color: '#94A3B8' },
  etc:     { label: '기타',      icon: '📌', color: '#64748B' }
};
var TECH_STATUS = [
  { key: 'research',   label: '연구',     icon: '🔬', color: '#8B5CF6' },
  { key: 'developing', label: '개발',     icon: '🛠', color: '#3B82F6' },
  { key: 'verifying',  label: '검증',     icon: '🧪', color: '#F59E0B' },
  { key: 'available',  label: '사용가능', icon: '✅', color: '#10B981' },
  { key: 'deprecated', label: '폐기예정', icon: '⚠️', color: '#94A3B8' }
];
var TECH_STACK_KIND = {
  language:  '언어', framework: '프레임워크', library: '라이브러리',
  hw: '하드웨어', tool: '도구', protocol: '프로토콜', etc: '기타'
};
var TECH_LOG_KIND = {
  dev:    { label: '개발', icon: '🛠' },
  test:   { label: '테스트', icon: '🧪' },
  issue:  { label: '이슈', icon: '🔴' },
  doc:    { label: '문서', icon: '📄' },
  review: { label: '리뷰', icon: '🔍' },
  idea:   { label: '아이디어', icon: '💡' }
};

var _techList = [];
var _techView = 'catalog';   // catalog | category | stack | list
var _techFilter = { q: '', category: '', status: '', mine: false };
var _techModal = null;
var _techStacks = [];

function _tcInfo(k) { return TECH_CAT[k] || TECH_CAT.etc; }
function _tsInfo(k) {
  for (var i = 0; i < TECH_STATUS.length; i++) if (TECH_STATUS[i].key === k) return TECH_STATUS[i];
  return TECH_STATUS[0];
}
/** TRL 1~9 → 3구간 요약 (PRD 4.2) */
function _trlInfo(n) {
  var t = parseInt(n, 10) || 1;
  if (t >= 7) return { label: '실전', color: '#10B981', dot: '🟢' };
  if (t >= 4) return { label: '검증중', color: '#F59E0B', dot: '🟡' };
  return { label: '초기', color: '#EF4444', dot: '🔴' };
}
function _tEsc(v) { return (typeof eH === 'function') ? eH(v == null ? '' : v) : String(v == null ? '' : v); }
function _tToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _tCloseModal() { if (_techModal && _techModal.close) { _techModal.close(); _techModal = null; } }

/* ═══ 진입점 ═══ */
function renderTech() {
  var wrap = document.getElementById('techWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div style="padding:20px;color:var(--t6);font-size:12px">로딩 중...</div>';
  Promise.all([techGetAll({}), techStacks()]).then(function (r) {
    _techList = r[0] || [];
    _techStacks = r[1] || [];
    _techRender();
  }).catch(function () {
    wrap.innerHTML = '<div style="padding:20px;color:var(--t6);font-size:12px">요소기술 목록을 불러오지 못했습니다.</div>';
  });
}

function _techFiltered() {
  var q = (_techFilter.q || '').toLowerCase();
  var me = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.sub || currentUser.id) : null;
  return _techList.filter(function (t) {
    if (_techFilter.category && t.category !== _techFilter.category) return false;
    if (_techFilter.status && t.status !== _techFilter.status) return false;
    if (_techFilter.mine && me && t.ownerId !== me) return false;
    if (q) {
      var stackTxt = (t.stack || []).map(function (s) { return (s.name || '') + ' ' + (s.version || ''); }).join(' ');
      var hay = ((t.name || '') + ' ' + (t.code || '') + ' ' + (t.summary || '') + ' ' + (t.description || '') + ' ' + stackTxt).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}

function _techRender() {
  var wrap = document.getElementById('techWrap');
  if (!wrap) return;
  var items = _techFiltered();

  var catOpts = ['<option value="">전체 분류</option>'].concat(
    Object.keys(TECH_CAT).map(function (k) {
      return '<option value="' + k + '"' + (_techFilter.category === k ? ' selected' : '') + '>' + TECH_CAT[k].icon + ' ' + TECH_CAT[k].label + '</option>';
    })
  ).join('');
  var stOpts = ['<option value="">전체 상태</option>'].concat(
    TECH_STATUS.map(function (s) {
      return '<option value="' + s.key + '"' + (_techFilter.status === s.key ? ' selected' : '') + '>' + s.icon + ' ' + s.label + '</option>';
    })
  ).join('');

  var viewBtn = function (key, label) {
    var on = _techView === key;
    return '<button class="btn btn-s" style="font-size:11px;' + (on ? 'background:var(--ac);color:#fff' : '') + '" onclick="techSetView(\'' + key + '\')">' + label + '</button>';
  };

  var html = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
    '<h3 style="font-size:14px;font-weight:700;color:var(--t1);margin:0">🧪 요소기술</h3>' +
    '<span style="font-size:11px;color:var(--t5)">' + items.length + '건</span>' +
    '<span style="flex:1"></span>' +
    viewBtn('catalog', '카탈로그') + viewBtn('category', '분류별') + viewBtn('stack', '기술스택') + viewBtn('list', '목록') +
    '<button class="btn btn-p btn-s" style="font-size:11px" onclick="techOpenModal()">+ 새 기술</button>' +
  '</div>';

  html += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
    '<input id="techQ" placeholder="기술명·코드·설명·스택 검색" value="' + _tEsc(_techFilter.q) + '" style="flex:1;min-width:150px;font-size:11px;padding:5px 8px" oninput="techSetQ(this.value)">' +
    '<select class="si" style="font-size:11px;padding:4px" onchange="techSetCat(this.value)">' + catOpts + '</select>' +
    '<select class="si" style="font-size:11px;padding:4px" onchange="techSetStatus(this.value)">' + stOpts + '</select>' +
    '<label style="font-size:11px;color:var(--t4);display:flex;align-items:center;gap:4px">' +
      '<input type="checkbox"' + (_techFilter.mine ? ' checked' : '') + ' onchange="techSetMine(this.checked)"> 내 담당' +
    '</label>' +
  '</div>';

  if (_techView === 'catalog') html += _techCatalogHtml(items);
  else if (_techView === 'category') html += _techCategoryHtml(items);
  else if (_techView === 'stack') html += _techStackHtml();
  else html += _techListHtml(items);

  wrap.innerHTML = html;
}

/** 카드 1개 */
function _techCardHtml(t) {
  var cat = _tcInfo(t.category);
  var st = _tsInfo(t.status);
  var trl = _trlInfo(t.trl);
  var stack = (t.stack || []).slice(0, 5);
  return '<div style="border:1px solid var(--bd);border-radius:8px;padding:10px;background:var(--bg-i);cursor:pointer' +
      (t.status === 'deprecated' ? ';opacity:.55' : '') + '" onclick="techOpenModal(\'' + _tEsc(t.id) + '\')">' +
    '<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">' +
      '<span style="font-size:13px">' + cat.icon + '</span>' +
      '<span style="flex:1;font-size:12px;font-weight:700;color:var(--t1);word-break:break-word">' + _tEsc(t.name) + '</span>' +
      (t.techVersion ? '<span style="font-size:9px;color:var(--t5)">' + _tEsc(t.techVersion) + '</span>' : '') +
    '</div>' +
    (t.code ? '<div style="font-size:9px;color:var(--t6);margin-bottom:3px"><code>' + _tEsc(t.code) + '</code></div>' : '') +
    (t.summary ? '<div style="font-size:10px;color:var(--t4);margin-bottom:5px;word-break:break-word">' + _tEsc(t.summary) + '</div>' : '') +
    '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:5px">' +
      '<span class="badge" style="background:' + st.color + '22;color:' + st.color + ';font-size:8px;padding:1px 5px">' + st.icon + ' ' + st.label + '</span>' +
      '<span style="font-size:9px;color:' + trl.color + '" title="기술성숙도 TRL ' + (t.trl || 1) + '">' + trl.dot + ' TRL' + (t.trl || 1) + '</span>' +
      (t.ownerName ? '<span style="font-size:9px;color:var(--t5)">@' + _tEsc(t.ownerName) + '</span>' : '') +
    '</div>' +
    (stack.length
      ? '<div style="display:flex;gap:3px;flex-wrap:wrap">' + stack.map(function (s) {
          return '<span style="font-size:8px;padding:1px 4px;border:1px solid var(--bd);border-radius:3px;color:var(--t5)">' +
            _tEsc(s.name) + (s.version ? ' ' + _tEsc(s.version) : '') + '</span>';
        }).join('') + ((t.stack || []).length > 5 ? '<span style="font-size:8px;color:var(--t6)">+' + ((t.stack || []).length - 5) + '</span>' : '') + '</div>'
      : '') +
    '<div style="display:flex;align-items:center;gap:5px;margin-top:6px">' +
      '<div style="flex:1;height:4px;background:var(--bg-p);border-radius:2px;overflow:hidden"><div style="height:100%;width:' + Math.min(t.progress || 0, 100) + '%;background:' + st.color + '"></div></div>' +
      '<span style="font-size:9px;color:var(--t5)">' + (t.progress || 0) + '%</span>' +
      (parseFloat(t.totalHours) > 0 ? '<span style="font-size:9px;color:var(--t6)">' + (Math.round(parseFloat(t.totalHours) * 10) / 10) + 'h</span>' : '') +
    '</div>' +
  '</div>';
}

function _techCatalogHtml(items) {
  if (!items.length) return '<div style="font-size:12px;color:var(--t6);padding:16px">해당 조건의 요소기술이 없습니다.</div>';
  return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px">' +
    items.map(_techCardHtml).join('') + '</div>';
}

function _techCategoryHtml(items) {
  if (!items.length) return '<div style="font-size:12px;color:var(--t6);padding:16px">해당 조건의 요소기술이 없습니다.</div>';
  var byCat = {};
  items.forEach(function (t) { (byCat[t.category || 'etc'] = byCat[t.category || 'etc'] || []).push(t); });
  var html = '';
  Object.keys(TECH_CAT).forEach(function (k) {
    var list = byCat[k];
    if (!list || !list.length) return;
    var c = TECH_CAT[k];
    html += '<div style="margin-bottom:14px">' +
      '<div style="font-size:12px;font-weight:700;color:' + c.color + ';margin-bottom:6px">' + c.icon + ' ' + c.label + ' <span style="color:var(--t6)">(' + list.length + ')</span></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px">' + list.map(_techCardHtml).join('') + '</div>' +
    '</div>';
  });
  return html;
}

/** 기술스택 집계 보기 — 조직이 쓰는 스택 분포 */
function _techStackHtml() {
  if (!_techStacks.length) return '<div style="font-size:12px;color:var(--t6);padding:16px">등록된 기술스택이 없습니다. 기술 상세에서 스택을 추가하세요.</div>';
  var byKind = {};
  _techStacks.forEach(function (s) { (byKind[s.kind || 'etc'] = byKind[s.kind || 'etc'] || []).push(s); });
  var maxCnt = _techStacks.reduce(function (m, s) { return Math.max(m, s.cnt); }, 1);
  var html = '<div style="font-size:10px;color:var(--t5);margin-bottom:8px">항목을 클릭하면 해당 스택을 쓰는 기술만 필터됩니다.</div>';
  Object.keys(TECH_STACK_KIND).forEach(function (k) {
    var list = byKind[k];
    if (!list || !list.length) return;
    html += '<div style="margin-bottom:12px">' +
      '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:5px">' + TECH_STACK_KIND[k] + '</div>';
    list.forEach(function (s) {
      var pct = Math.round(s.cnt / maxCnt * 100);
      html += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer" onclick="techFilterByStack(\'' + _tEsc(s.name) + '\')">' +
        '<span style="width:130px;font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _tEsc(s.name) + '</span>' +
        '<div style="flex:1;height:6px;background:var(--bg-i);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:var(--ac)"></div></div>' +
        '<span style="font-size:10px;color:var(--t5);width:36px;text-align:right">' + s.cnt + '건</span>' +
        '<span style="font-size:9px;color:var(--t6);width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _tEsc((s.versions || []).join(', ')) + '</span>' +
      '</div>';
    });
    html += '</div>';
  });
  return html;
}

function _techListHtml(items) {
  if (!items.length) return '<div style="font-size:12px;color:var(--t6);padding:16px">해당 조건의 요소기술이 없습니다.</div>';
  var html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">' +
    '<thead><tr style="color:var(--t5);font-size:10px;text-align:left">' +
    '<th style="padding:5px">분류</th><th style="padding:5px">코드</th><th style="padding:5px">기술명</th>' +
    '<th style="padding:5px">상태</th><th style="padding:5px">TRL</th><th style="padding:5px">담당</th>' +
    '<th style="padding:5px">진척</th><th style="padding:5px">투입</th></tr></thead><tbody>';
  items.forEach(function (t) {
    var cat = _tcInfo(t.category);
    var st = _tsInfo(t.status);
    var trl = _trlInfo(t.trl);
    html += '<tr style="border-bottom:1px solid var(--bd)' + (t.status === 'deprecated' ? ';opacity:.55' : '') + '">' +
      '<td style="padding:5px;color:' + cat.color + '">' + cat.icon + ' ' + cat.label + '</td>' +
      '<td style="padding:5px;color:var(--t5)"><code>' + _tEsc(t.code || '-') + '</code></td>' +
      '<td style="padding:5px;color:var(--t2);cursor:pointer" onclick="techOpenModal(\'' + _tEsc(t.id) + '\')">' + _tEsc(t.name) + (t.techVersion ? ' <span style="color:var(--t6)">' + _tEsc(t.techVersion) + '</span>' : '') + '</td>' +
      '<td style="padding:5px"><span class="badge" style="background:' + st.color + '22;color:' + st.color + ';font-size:8px;padding:1px 4px">' + st.label + '</span></td>' +
      '<td style="padding:5px;color:' + trl.color + '">' + trl.dot + ' ' + (t.trl || 1) + '</td>' +
      '<td style="padding:5px;color:var(--t4)">' + _tEsc(t.ownerName || '-') + '</td>' +
      '<td style="padding:5px;color:var(--t4)">' + (t.progress || 0) + '%</td>' +
      '<td style="padding:5px;color:var(--t5)">' + (parseFloat(t.totalHours) > 0 ? (Math.round(parseFloat(t.totalHours) * 10) / 10) + 'h' : '-') + '</td>' +
    '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

/* ═══ 필터 ═══ */
function techSetView(v) { _techView = v; _techRender(); }
function techSetCat(v) { _techFilter.category = v; _techRender(); }
function techSetStatus(v) { _techFilter.status = v; _techRender(); }
function techSetMine(b) { _techFilter.mine = !!b; _techRender(); }
function techFilterByStack(name) { _techFilter.q = name; _techView = 'catalog'; _techRender(); }
var _techQTimer = null;
function techSetQ(v) {
  _techFilter.q = v;
  clearTimeout(_techQTimer);
  _techQTimer = setTimeout(function () {
    _techRender();
    var el = document.getElementById('techQ');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, 250);
}

/* ═══ 상세/편집 모달 ═══ */
function techOpenModal(id) {
  techMembers().then(function (members) { _techBuildModal(id, members || []); });
}

function _techBuildModal(id, members) {
  var t = id ? _techList.filter(function (x) { return x.id === id; })[0] : null;
  var isNew = !t;
  t = t || { name: '', code: '', category: 'etc', status: 'research', trl: 1, techVersion: '', summary: '', description: '', stack: [], participants: [], tags: [], repoUrl: '', docUrl: '' };
  var me = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.sub || currentUser.id) : null;
  var ownerId = t.ownerId || (isNew ? me : null);
  var parts = Array.isArray(t.participants) ? t.participants : [];
  var tags = Array.isArray(t.tags) ? t.tags : [];
  var stack = Array.isArray(t.stack) ? t.stack : [];

  var catOpts = Object.keys(TECH_CAT).map(function (k) {
    return '<option value="' + k + '"' + (t.category === k ? ' selected' : '') + '>' + TECH_CAT[k].icon + ' ' + TECH_CAT[k].label + '</option>';
  }).join('');
  var stOpts = TECH_STATUS.map(function (s) {
    return '<option value="' + s.key + '"' + (t.status === s.key ? ' selected' : '') + '>' + s.icon + ' ' + s.label + '</option>';
  }).join('');
  var trlOpts = [1,2,3,4,5,6,7,8,9].map(function (n) {
    return '<option value="' + n + '"' + ((t.trl || 1) === n ? ' selected' : '') + '>TRL ' + n + ' ' + _trlInfo(n).dot + '</option>';
  }).join('');
  var ownerOpts = ['<option value="">(미지정)</option>'].concat(members.map(function (m) {
    return '<option value="' + _tEsc(m.id) + '"' + (m.id === ownerId ? ' selected' : '') + '>' + _tEsc(m.name) + '</option>';
  })).join('');
  var partHtml = members.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;max-height:80px;overflow-y:auto;padding:5px;border:1px solid var(--bd);border-radius:6px">' +
        members.map(function (m) {
          return '<label style="font-size:11px;color:var(--t3);display:flex;align-items:center;gap:3px">' +
            '<input type="checkbox" class="tech-part" value="' + _tEsc(m.name) + '"' + (parts.indexOf(m.name) >= 0 ? ' checked' : '') + '>' + _tEsc(m.name) + '</label>';
        }).join('') + '</div>'
    : '<div style="font-size:10px;color:var(--t6)">선택 가능한 구성원이 없습니다.</div>';

  var lbl = 'font-size:10px;color:var(--t5);margin:8px 0 2px';
  var inp = 'width:100%;font-size:12px;padding:5px 7px';
  var codeHint = isNew ? ' placeholder="예: TECH-' + (TECH_CAT[t.category] ? t.category.toUpperCase().slice(0,3) : 'ETC') + '-001"' : '';

  var html = '<div style="display:grid;grid-template-columns:2fr 1fr;gap:8px">' +
      '<div><div style="' + lbl + '">기술명 *</div><input id="tmName" value="' + _tEsc(t.name) + '" style="' + inp + '"></div>' +
      '<div><div style="' + lbl + '">기술코드</div><input id="tmCode" value="' + _tEsc(t.code) + '" style="' + inp + '"' + codeHint + '></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">' +
      '<div><div style="' + lbl + '">분류</div><select id="tmCat" class="si" style="' + inp + '">' + catOpts + '</select></div>' +
      '<div><div style="' + lbl + '">상태</div><select id="tmStatus" class="si" style="' + inp + '">' + stOpts + '</select></div>' +
      '<div><div style="' + lbl + '">성숙도</div><select id="tmTrl" class="si" style="' + inp + '">' + trlOpts + '</select></div>' +
      '<div><div style="' + lbl + '">버전</div><input id="tmVer" value="' + _tEsc(t.techVersion) + '" style="' + inp + '" placeholder="v1.0"></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<div><div style="' + lbl + '">담당자</div><select id="tmOwner" class="si" style="' + inp + '">' + ownerOpts + '</select></div>' +
      '<div><div style="' + lbl + '">태그 <span style="color:var(--t6)">(쉼표)</span></div><input id="tmTags" value="' + _tEsc(tags.join(', ')) + '" style="' + inp + '"></div>' +
    '</div>' +
    '<div><div style="' + lbl + '">참여자</div>' + partHtml + '</div>' +
    '<div><div style="' + lbl + '">한 줄 설명</div><input id="tmSummary" value="' + _tEsc(t.summary) + '" style="' + inp + '" placeholder="카탈로그 카드에 표시됩니다"></div>' +
    '<div><div style="' + lbl + '">상세 (원리·구조·제약)</div><textarea id="tmDesc" style="' + inp + ';min-height:60px;resize:vertical">' + _tEsc(t.description) + '</textarea></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<div><div style="' + lbl + '">저장소 URL</div><input id="tmRepo" value="' + _tEsc(t.repoUrl) + '" style="' + inp + '" placeholder="https://github.com/..."></div>' +
      '<div><div style="' + lbl + '">문서 URL</div><input id="tmDoc" value="' + _tEsc(t.docUrl) + '" style="' + inp + '"></div>' +
    '</div>' +
    // ── 기술스택 ──
    '<div style="' + lbl + ';display:flex;align-items:center;gap:6px">기술스택' +
      '<button class="btn btn-g btn-s" style="font-size:9px;padding:1px 6px" onclick="techStackAddRow()">+ 항목</button>' +
    '</div>' +
    '<div id="tmStackRows" style="border:1px solid var(--bd);border-radius:6px;padding:6px">' +
      (stack.length ? stack.map(_techStackRowHtml).join('') : '') +
    '</div>' +
    '<datalist id="tmStackNames">' + _techStacks.map(function (s) { return '<option value="' + _tEsc(s.name) + '">'; }).join('') + '</datalist>';

  if (!isNew) {
    html += '<div id="tmUsages" style="margin-top:12px"><div style="font-size:11px;color:var(--t6)">적용 이력 로딩 중...</div></div>';
    html += '<div id="tmLogs" style="margin-top:12px"><div style="font-size:11px;color:var(--t6)">개발일지 로딩 중...</div></div>';
    html += '<div id="tmComments" style="margin-top:12px"></div>';
  }

  html += '<div style="display:flex;gap:6px;margin-top:14px">' +
    '<button class="btn btn-p btn-s" onclick="techSave(' + (isNew ? 'null' : '\'' + _tEsc(t.id) + '\'') + ')">💾 저장</button>' +
    (isNew ? '' : '<button class="btn btn-d btn-s" onclick="techDelete(\'' + _tEsc(t.id) + '\')">🗑 삭제</button>') +
  '</div>';

  if (typeof createModal !== 'function') { _tToast('모달을 열 수 없습니다.', 'error'); return; }
  _techModal = createModal({ title: isNew ? '새 요소기술' : '요소기술 상세', html: html, width: '720px' });

  if (!isNew) {
    techLoadUsages(t.id);
    techLoadLogs(t.id);
    if (typeof renderCommentThread === 'function') renderCommentThread('tech', t.id, 'tmComments');
  }
}

function _techStackRowHtml(s) {
  s = s || {};
  var kindOpts = Object.keys(TECH_STACK_KIND).map(function (k) {
    return '<option value="' + k + '"' + (s.kind === k ? ' selected' : '') + '>' + TECH_STACK_KIND[k] + '</option>';
  }).join('');
  return '<div class="tech-stack-row" style="display:grid;grid-template-columns:90px 1fr 90px 24px;gap:4px;align-items:center;padding:2px 0">' +
    '<select class="si stack-kind" style="font-size:10px;padding:2px">' + kindOpts + '</select>' +
    '<input class="si stack-name" list="tmStackNames" value="' + _tEsc(s.name) + '" placeholder="이름 (예: OpenCV)" style="font-size:11px;padding:3px 5px">' +
    '<input class="si stack-ver" value="' + _tEsc(s.version) + '" placeholder="버전" style="font-size:11px;padding:3px 5px">' +
    '<button class="btn btn-d btn-s" style="font-size:10px;padding:1px 5px" onclick="this.closest(\'.tech-stack-row\').remove()">✕</button>' +
  '</div>';
}
function techStackAddRow() {
  var box = document.getElementById('tmStackRows');
  if (!box) return;
  box.insertAdjacentHTML('beforeend', _techStackRowHtml({ kind: 'library' }));
}
function _techCollectStack() {
  var out = [];
  document.querySelectorAll('.tech-stack-row').forEach(function (row) {
    var name = (row.querySelector('.stack-name') || {}).value || '';
    name = name.trim();
    if (!name) return;
    out.push({
      kind: (row.querySelector('.stack-kind') || {}).value || 'etc',
      name: name,
      version: ((row.querySelector('.stack-ver') || {}).value || '').trim()
    });
  });
  return out;
}

function techSave(id) {
  var g = function (i) { var el = document.getElementById(i); return el ? el.value : ''; };
  var name = (g('tmName') || '').trim();
  if (!name) { _tToast('기술명을 입력하세요.', 'warn'); return; }
  var parts = [];
  document.querySelectorAll('.tech-part:checked').forEach(function (el) { parts.push(el.value); });
  var payload = {
    name: name,
    code: (g('tmCode') || '').trim(),
    category: g('tmCat'), status: g('tmStatus'),
    trl: parseInt(g('tmTrl'), 10) || 1,
    techVersion: (g('tmVer') || '').trim(),
    ownerId: g('tmOwner') || null,
    participants: parts,
    tags: (g('tmTags') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
    summary: g('tmSummary'), description: g('tmDesc'),
    repoUrl: (g('tmRepo') || '').trim(), docUrl: (g('tmDoc') || '').trim(),
    stack: _techCollectStack()
  };
  if (id) payload.id = id;
  techPut(payload).then(function () {
    _tToast('저장되었습니다.', 'success');
    _tCloseModal();
    renderTech();
  }).catch(function () { _tToast('저장 실패 (권한 또는 서버 오류)', 'error'); });
}

function techDelete(id) {
  if (!confirm('이 요소기술을 삭제할까요? (개발일지도 함께 숨겨집니다)')) return;
  techDel(id).then(function () { _tCloseModal(); renderTech(); });
}

/* ═══ 적용 이력 (Phase 2) ═══ */
var _techUsageTargets = null;   // {projects:[], prestudies:[]} 캐시

function techLoadUsages(techId) {
  var box = document.getElementById('tmUsages');
  if (!box) return;
  techUsagesGet(techId).then(function (list) { _techRenderUsages(techId, list || []); });
}

/** 적용 대상 선택지(프로젝트·사전검토)를 1회 로드 */
function _techLoadTargets() {
  if (_techUsageTargets) return Promise.resolve(_techUsageTargets);
  var pP = (typeof pmGetProjects === 'function') ? pmGetProjects() : (typeof projGetAll === 'function' ? projGetAll() : Promise.resolve([]));
  var sP = (typeof prestudyGetAll === 'function') ? prestudyGetAll({}) : Promise.resolve([]);
  return Promise.all([pP, sP]).then(function (r) {
    _techUsageTargets = { projects: r[0] || [], prestudies: r[1] || [] };
    return _techUsageTargets;
  }).catch(function () { return { projects: [], prestudies: [] }; });
}

function _techRenderUsages(techId, list) {
  var box = document.getElementById('tmUsages');
  if (!box) return;
  var html = '<div style="border-top:1px solid var(--bd);padding-top:10px">' +
    '<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:6px">🔗 적용 이력 <span style="color:var(--t6);font-weight:400">(' + list.length + ')</span></div>';

  if (!list.length) {
    html += '<div style="font-size:11px;color:var(--t6);margin-bottom:6px">아직 적용된 프로젝트·사전검토가 없습니다.</div>';
  } else {
    list.forEach(function (u) {
      var isProj = u.targetType === 'project';
      var name = u.targetName || '(삭제된 대상)';
      html += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--bd);font-size:11px">' +
        '<span>' + (isProj ? '📁' : '🔍') + '</span>' +
        '<span style="flex:1;color:' + (u.targetName ? 'var(--t2)' : 'var(--t6)') + ';word-break:break-word">' +
          _tEsc(name) + (u.targetClient ? ' <span style="color:var(--t5)">· ' + _tEsc(u.targetClient) + '</span>' : '') +
          (u.note ? '<span style="color:var(--t5)"> — ' + _tEsc(u.note) + '</span>' : '') +
        '</span>' +
        '<button class="btn btn-d btn-s" style="font-size:8px;padding:0 4px" onclick="techUsageRemove(\'' + _tEsc(techId) + '\',\'' + _tEsc(u.id) + '\')">✕</button>' +
      '</div>';
    });
  }
  // 추가 폼 (대상 선택지는 비동기 로드 후 채움)
  html += '<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">' +
    '<select id="tuTarget" class="si" style="flex:1;min-width:160px;font-size:10px;padding:3px"><option value="">로딩 중...</option></select>' +
    '<input id="tuNote" placeholder="적용 방식(선택)" style="flex:1;min-width:110px;font-size:10px;padding:3px 5px">' +
    '<button class="btn btn-g btn-s" style="font-size:10px" onclick="techUsageAddFromForm(\'' + _tEsc(techId) + '\')">+ 적용</button>' +
  '</div>';
  html += '</div>';
  box.innerHTML = html;

  _techLoadTargets().then(function (t) {
    var sel = document.getElementById('tuTarget');
    if (!sel) return;
    var used = {};
    list.forEach(function (u) { used[u.targetType + ':' + u.targetId] = true; });
    var opts = ['<option value="">적용 대상 선택…</option>'];
    var projOpts = (t.projects || []).filter(function (p) { return !used['project:' + p.id]; })
      .map(function (p) { return '<option value="project:' + _tEsc(p.id) + '">📁 ' + _tEsc(p.name) + '</option>'; });
    var psOpts = (t.prestudies || []).filter(function (p) { return !used['prestudy:' + p.id]; })
      .map(function (p) { return '<option value="prestudy:' + _tEsc(p.id) + '">🔍 ' + _tEsc((p.client ? p.client + ' / ' : '') + p.title) + '</option>'; });
    if (projOpts.length) opts.push('<optgroup label="프로젝트">' + projOpts.join('') + '</optgroup>');
    if (psOpts.length) opts.push('<optgroup label="사전검토">' + psOpts.join('') + '</optgroup>');
    sel.innerHTML = opts.join('');
  });
}

function techUsageAddFromForm(techId) {
  var sel = document.getElementById('tuTarget');
  var val = sel ? sel.value : '';
  if (!val) { _tToast('적용 대상을 선택하세요.', 'warn'); return; }
  var parts = val.split(':');
  var note = (document.getElementById('tuNote') || {}).value || '';
  techUsageAdd(techId, parts[0], parts.slice(1).join(':'), note.trim() || null)
    .then(function () { _tToast('적용 이력이 추가되었습니다.', 'success'); techLoadUsages(techId); })
    .catch(function () { _tToast('추가 실패', 'error'); });
}

function techUsageRemove(techId, usageId) {
  if (!confirm('이 적용 이력을 삭제할까요?')) return;
  techUsageDel(techId, usageId).then(function () { techLoadUsages(techId); });
}

/* ═══ 개발일지 ═══ */
function techLoadLogs(techId) {
  var box = document.getElementById('tmLogs');
  if (!box) return;
  techLogsGet(techId).then(function (logs) { _techRenderLogs(techId, logs || []); });
}

function _techRenderLogs(techId, logs) {
  var box = document.getElementById('tmLogs');
  if (!box) return;
  var kindOpts = Object.keys(TECH_LOG_KIND).map(function (k) {
    return '<option value="' + k + '">' + TECH_LOG_KIND[k].icon + ' ' + TECH_LOG_KIND[k].label + '</option>';
  }).join('');
  var todayStr = new Date().toISOString().slice(0, 10);

  var html = '<div style="border-top:1px solid var(--bd);padding-top:10px">' +
    '<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:6px">📓 개발일지 <span style="color:var(--t6);font-weight:400">(' + logs.length + ')</span></div>';

  // 작성 폼
  html += '<div style="border:1px solid var(--bd);border-radius:6px;padding:7px;margin-bottom:8px;background:var(--bg-i)">' +
    '<div style="display:grid;grid-template-columns:120px 100px 80px 80px;gap:5px;margin-bottom:5px">' +
      '<input id="tlDate" type="date" class="si" value="' + todayStr + '" style="font-size:11px;padding:3px">' +
      '<select id="tlKind" class="si" style="font-size:11px;padding:3px">' + kindOpts + '</select>' +
      '<input id="tlProgress" type="number" min="0" max="100" placeholder="진척%" class="si" style="font-size:11px;padding:3px">' +
      '<input id="tlHours" type="number" min="0" step="0.5" placeholder="시간" class="si" style="font-size:11px;padding:3px">' +
    '</div>' +
    '<textarea id="tlContent" placeholder="무엇을 했고, 무엇을 알게 됐는지. **굵게** ~~취소선~~ `코드` - [ ] 체크박스" style="width:100%;font-size:11px;padding:5px;min-height:52px;resize:vertical"></textarea>' +
    '<button class="btn btn-p btn-s" style="font-size:10px;margin-top:4px" onclick="techLogSave(\'' + _tEsc(techId) + '\')">+ 일지 등록</button>' +
  '</div>';

  if (!logs.length) {
    html += '<div style="font-size:11px;color:var(--t6);padding:4px">아직 개발일지가 없습니다.</div>';
  } else {
    logs.forEach(function (lg) {
      var k = TECH_LOG_KIND[lg.kind] || TECH_LOG_KIND.dev;
      var body = (typeof wmRichNote === 'function') ? wmRichNote(lg.content || '') : _tEsc(lg.content || '');
      html += '<div style="border-left:2px solid var(--bd);padding:4px 0 6px 8px;margin-bottom:4px">' +
        '<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--t5);margin-bottom:2px">' +
          '<span>' + k.icon + ' ' + k.label + '</span>' +
          '<span>' + _tEsc(lg.logDate || '') + '</span>' +
          (lg.authorName ? '<span>· ' + _tEsc(lg.authorName) + '</span>' : '') +
          (lg.progress ? '<span style="color:var(--ac)">· ' + lg.progress + '%</span>' : '') +
          (parseFloat(lg.hours) > 0 ? '<span>· ' + (Math.round(parseFloat(lg.hours) * 10) / 10) + 'h</span>' : '') +
          '<span style="flex:1"></span>' +
          '<button class="btn btn-d btn-s" style="font-size:8px;padding:0 4px" onclick="techLogDelete(\'' + _tEsc(techId) + '\',\'' + _tEsc(lg.id) + '\')">✕</button>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--t3);white-space:pre-wrap;word-break:break-word">' + body + '</div>' +
      '</div>';
    });
  }
  html += '</div>';
  box.innerHTML = html;
}

function techLogSave(techId) {
  var g = function (i) { var el = document.getElementById(i); return el ? el.value : ''; };
  var content = g('tlContent');
  if (!content || !content.trim()) { _tToast('일지 내용을 입력하세요.', 'warn'); return; }
  techLogAdd(techId, {
    logDate: g('tlDate') || null,
    kind: g('tlKind') || 'dev',
    progress: parseInt(g('tlProgress'), 10) || 0,
    hours: parseFloat(g('tlHours')) || 0,
    content: content
  }).then(function () {
    _tToast('개발일지가 등록되었습니다.', 'success');
    techLoadLogs(techId);
    // 목록의 진척률·투입시간이 바뀌므로 백그라운드 갱신
    techGetAll({}).then(function (list) { _techList = list || []; });
  }).catch(function () { _tToast('일지 등록 실패', 'error'); });
}

function techLogDelete(techId, logId) {
  if (!confirm('이 개발일지를 삭제할까요?')) return;
  techLogDel(techId, logId).then(function () {
    techLoadLogs(techId);
    techGetAll({}).then(function (list) { _techList = list || []; });
  });
}
