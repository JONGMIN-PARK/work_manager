/**
 * 업무 관리자 — 🧠 마인드맵 목록 · 모달
 * 맵 목록(카드 · 탭 · 즐겨찾기 · 복제 · 삭제), 새 맵(빈 틀 · 자동 생성 · AI), 가져오기(.xmind · .opml · Markdown),
 * 보내기(공유) — 맵은 소유자와 보낸 사람만 본다 (v13.249).
 * 의존(전역): mindmap.js(_mm · 헬퍼 · mmOpen), mindmap-extra.js(mmGenerateDoc · mmAiTextDoc · mmAiWbsDoc · mmReadImportFile)
 */

/* ═══ 목록 ═══
 * v13.267 관리하기 쉽게 — 제목 · 내용 검색(맵 안 주제 · 메모 · 라벨까지, 누르면 그 주제로), 프로젝트 · 만든 사람 · 수정 시기 필터,
 * 정렬, 카드 / 목록(표) 보기, 최근 연 맵, 마우스를 올리면 맵 미리보기(터치는 👁). 보기 설정은 localStorage 'wm-mm-list' */
var _mmLS = (function () { try { return JSON.parse(localStorage.getItem('wm-mm-list') || '{}') || {}; } catch (e) { return {}; } })();
var _mmLV = { view: _mmLS.view || 'card', sort: _mmLS.sort || 'updated', proj: _mmLS.proj || '', owner: _mmLS.owner || '', age: _mmLS.age || '' };
function _mmLVSave() { try { localStorage.setItem('wm-mm-list', JSON.stringify(_mmLV)); } catch (e) {} }
var _mmHits = null, _mmHitQ = '', _mmHitT = 0, _mmHitSeq = 0;
var MM_SORTS = [['updated', '최근 수정'], ['opened', '최근 연 순'], ['title', '제목'], ['nodes', '주제 많은 순'], ['created', '만든 날']];
var MM_AGES = [['', '수정: 전체'], ['today', '오늘 고친 것'], ['week', '이번 주'], ['month', '30일 안'], ['old', '90일 넘게 그대로']];
function _mmRecent() { try { return JSON.parse(localStorage.getItem('wm-mm-recent') || '[]') || []; } catch (e) { return []; } }
function _mmRecentPush(id) {
  if (!id) return;
  var r = _mmRecent().filter(function (x) { return x !== id; });
  r.unshift(id);
  try { localStorage.setItem('wm-mm-recent', JSON.stringify(r.slice(0, 12))); } catch (e) {}
}

function _mmRenderList() {
  var wrap = _mmEl('mindmapWrap');
  if (!wrap) return;
  _mm.view = 'list';
  if (typeof _mmOpenRemember === 'function') _mmOpenRemember(null);   // 목록을 보고 있으면 다음 방문도 목록부터 (v13.285)
  _mmPeekHide(true);
  var tabs = [['all', '전체'], ['mine', '내 맵'], ['shared', '받은 맵']];
  // v13.295 공통 툴바(.wm-tb) — [제목 · 개수] [전체 · 내 맵 · 받은 맵] … [검색] [정렬] [⏷ 필터(프로젝트 · 만든 사람 · 수정)] [카드 · 목록] [+ 새 맵] [⋯ 가져오기]
  var h = '<div class="wm-tb mm-list-tb">' +
    '<h3 class="wm-tb-t" title="생각 정리 · 업무 분장 · 프로젝트 구조 — 맵은 나와 내가 보낸 사람만 볼 수 있습니다.">🧠 마인드맵</h3>' +
    '<span class="wm-tb-n mm-lcount" id="mmListCount"></span>' +
    '<span class="wm-seg mm-seg">' +
    tabs.map(function (t) { return '<button data-act="tab" data-tab="' + t[0] + '" class="' + (_mm.listTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') +
    '</span>' +
    '<span class="wm-tb-sp"></span>' +
    '<input id="mmListQ" class="wm-tb-q" type="search" placeholder="🔍 제목 · 맵 안 내용 검색" value="' + _mmEsc(_mm.q) + '" aria-label="제목 · 맵 안 내용 검색">' +
    '<select id="mmListSort" class="wm-tb-sel" aria-label="정렬">' + MM_SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (_mmLV.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select>' +
    '<div class="hdr-pop wm-flt" id="mmFltWrap"><button class="btn btn-g" id="mmFltBtn" onclick="wmHdrPop(\'mmFltWrap\')" aria-haspopup="true" aria-expanded="false" title="필터">⏷ 필터</button>' +
      '<div class="hdr-pop-menu wm-flt-menu"><div class="mm-list-filt" id="mmListFilt"></div></div></div>' +
    '<span class="wm-seg mm-seg mm-vseg" role="group" aria-label="보기"><button data-act="view" data-v="card" title="카드로 보기">▦ 카드</button><button data-act="view" data-v="table" title="목록으로 보기">☰ 목록</button></span>' +
    '<button class="wm-pri" data-act="new">+ 새 맵</button>' +
    '<div class="hdr-pop" id="mmListMore"><button class="btn btn-g wm-more" onclick="wmHdrPop(\'mmListMore\')" title="가져오기" aria-haspopup="true" aria-expanded="false">⋯</button>' +
      '<div class="hdr-pop-menu" role="menu"><button class="hdr-mi" data-act="import">⤓ 가져오기 (XMind · JSON)</button></div></div>' +
    '</div>' +
    '<div id="mmListBody"><div class="mm-empty">로딩 중...</div></div>';
  wrap.innerHTML = h;
  wrap.onclick = _mmListClick;
  _mmBindPeek(wrap);
  var q = _mmEl('mmListQ');
  if (q) q.oninput = function () { _mm.q = q.value; _mmPaintList(); _mmHitFetch(); };
  _mmEl('mmListSort').onchange = function () { _mmLV.sort = this.value; _mmLVSave(); _mmPaintList(); };
  _mmEl('mmListFilt').onchange = function (e) {
    var k = e.target.getAttribute('data-f');
    if (k) { _mmLV[k] = e.target.value; _mmLVSave(); _mmPaintList(); }
  };
  if (_mm.listLoaded) _mmPaintList();   // v13.258 다시 들어올 때 — 받아 둔 목록을 바로 그리고 뒤에서 새로 받음
  apiFetch('/api/mindmaps').then(function (r) {
    _mm.list = (r && r.data) || [];
    _mm.listLoaded = true;
    _mmPaintList();
    if (_mm.q) _mmHitFetch(true);
  }).catch(function (e) {
    var b = _mmEl('mmListBody');
    if (b) b.innerHTML = '<div class="mm-empty">목록을 불러오지 못했습니다 — ' + _mmEsc(e && e.status === 404 ? '서버 배포 후 사용 가능' : _mmErr(e)) + '</div>';
  });
}

/* 맵 안 내용 검색 — 두 글자부터 서버에서 (제목은 바로 걸러짐) */
function _mmHitFetch(now) {
  clearTimeout(_mmHitT);
  var q = (_mm.q || '').trim();
  if (q.length < 2) { if (_mmHits) { _mmHits = null; _mmHitQ = ''; _mmPaintList(); } return; }
  _mmHitT = setTimeout(function () {
    var seq = ++_mmHitSeq;
    apiFetch('/api/mindmaps/search?q=' + encodeURIComponent(q)).then(function (r) {
      if (seq !== _mmHitSeq || (_mm.q || '').trim() !== q) return;
      _mmHits = {};
      ((r && r.data) || []).forEach(function (x) { _mmHits[x.id] = x; });
      _mmHitQ = q;
      if (_mm.view === 'list') _mmPaintList();
    }).catch(function () {});
  }, now ? 0 : 300);
}

function _mmAgeOk(m, age) {
  if (!age) return true;
  var t = new Date(m.updated_at).getTime(), now = Date.now(), d = 86400000;
  if (age === 'today') return new Date(m.updated_at).toDateString() === new Date().toDateString();
  if (age === 'week') return now - t <= 7 * d;
  if (age === 'month') return now - t <= 30 * d;
  if (age === 'old') return now - t > 90 * d;
  return true;
}
function _mmPaintFilters(base) {
  var el = _mmEl('mmListFilt');
  if (!el) return;
  var projs = {}, owners = {};
  base.forEach(function (m) {
    if (m.project_id) projs[m.project_id] = m.project_name || m.project_id;
    if (m.owner_id) owners[m.owner_id] = m.owner_name || '';
  });
  var opt = function (v, l, cur) { return '<option value="' + _mmEsc(v) + '"' + (cur === v ? ' selected' : '') + '>' + _mmEsc(l) + '</option>'; };
  var pk = Object.keys(projs).sort(function (a, b) { return String(projs[a]).localeCompare(String(projs[b]), 'ko'); });
  var ok = Object.keys(owners).sort(function (a, b) { return String(owners[a]).localeCompare(String(owners[b]), 'ko'); });
  var any = _mmLV.proj || _mmLV.owner || _mmLV.age;
  var nF = (_mmLV.proj ? 1 : 0) + (_mmLV.owner ? 1 : 0) + (_mmLV.age ? 1 : 0);
  el.innerHTML =
    wmFltRow('프로젝트', '<select data-f="proj" aria-label="프로젝트">' + opt('', '전체', _mmLV.proj) + opt('__none', '프로젝트 없음', _mmLV.proj) + pk.map(function (k) { return opt(k, projs[k], _mmLV.proj); }).join('') + '</select>') +
    wmFltRow('만든 사람', '<select data-f="owner" aria-label="만든 사람">' + opt('', '전체', _mmLV.owner) + ok.map(function (k) { return opt(k, owners[k], _mmLV.owner); }).join('') + '</select>') +
    wmFltRow('수정', '<select data-f="age" aria-label="수정 시기">' + MM_AGES.map(function (a) { return opt(a[0], String(a[1]).replace(/^수정:\s*/, ''), _mmLV.age); }).join('') + '</select>') +
    '<div class="hdr-mi-sep"></div><button class="hdr-mi" data-act="fclear"' + (any ? '' : ' disabled') + '>✕ 필터 모두 지우기</button>';
  var fb = _mmEl('mmFltBtn');
  if (fb) { fb.classList.toggle('wm-flt-on', !!nF); fb.innerHTML = '⏷ 필터' + (nF ? '<span class="wm-flt-n">' + nF + '</span>' : ''); }
}

function _mmPaintList() {
  var body = _mmEl('mmListBody');
  if (!body) return;
  document.querySelectorAll('#mindmapWrap .mm-vseg [data-act="view"]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === _mmLV.view); });
  var me = (_mmMe() || {}).id;
  var q = (_mm.q || '').trim().toLowerCase();
  var hitsOn = !!(_mmHits && q && _mmHitQ.toLowerCase() === q);
  var base = _mm.list.filter(function (m) {
    switch (_mm.listTab) {
      case 'mine': return m.owner_id === me;
      case 'shared': return m.owner_id !== me;
      default: return true;
    }
  });
  _mmPaintFilters(base);
  var list = base.filter(function (m) {
    if (_mmLV.proj && (_mmLV.proj === '__none' ? m.project_id : m.project_id !== _mmLV.proj)) return false;
    if (_mmLV.owner && m.owner_id !== _mmLV.owner) return false;
    if (!_mmAgeOk(m, _mmLV.age)) return false;
    if (!q) return true;
    if (String(m.title || '').toLowerCase().indexOf(q) >= 0 || String(m.root_text || '').toLowerCase().indexOf(q) >= 0) return true;
    return hitsOn && !!_mmHits[m.id];
  });
  var recent = _mmRecent();
  var rIdx = function (m) { var i = recent.indexOf(m.id); return i < 0 ? 999 : i; };
  var by = {
    updated: function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); },
    opened: function (a, b) { return rIdx(a) - rIdx(b) || String(b.updated_at).localeCompare(String(a.updated_at)); },
    title: function (a, b) { return String(a.title || '').localeCompare(String(b.title || ''), 'ko'); },
    nodes: function (a, b) { return (b.node_count || 0) - (a.node_count || 0); },
    created: function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }
  }[_mmLV.sort] || function () { return 0; };
  list.sort(by);
  var cnt = _mmEl('mmListCount');
  if (cnt) {
    var nodeHits = 0;
    if (hitsOn) list.forEach(function (m) { if (_mmHits[m.id]) nodeHits += _mmHits[m.id].total; });
    cnt.textContent = '맵 ' + list.length + '개' + (list.length !== _mm.list.length ? ' / ' + _mm.list.length : '') + (hitsOn && nodeHits ? ' · 맵 안 주제 ' + nodeHits + '곳' : q && q.length >= 2 && !hitsOn ? ' · 내용 찾는 중…' : '');
  }
  if (!list.length) {
    body.innerHTML = '<div class="mm-empty">' + (_mm.list.length ? (q ? '「' + _mmEsc(_mm.q.trim()) + '」 — 제목이나 맵 안 내용에 맞는 맵이 없습니다.' : '조건에 맞는 맵이 없습니다.') : '아직 맵이 없습니다. <b>+ 새 맵</b>으로 시작하세요.') + '</div>';
    return;
  }
  function isPinned(m) { return (m.pinned_by || []).indexOf(me) >= 0; }
  var filtered = q || _mmLV.proj || _mmLV.owner || _mmLV.age;
  var h = '';
  // 최근 연 맵 — 검색 · 필터 없을 때만, 칩 한 줄
  if (!filtered) {
    var rc = recent.map(function (id) { return list.filter(function (m) { return m.id === id; })[0]; }).filter(Boolean).slice(0, 6);
    if (rc.length) h += '<div class="mm-sec">🕘 최근 연 맵</div><div class="mm-recent">' + rc.map(function (m) {
      return '<button type="button" class="mm-rchip" data-act="open" data-id="' + _mmEsc(m.id) + '"><b>' + _mmEsc(m.title) + '</b><span>' + _mmFmtTime(m.updated_at) + '</span></button>';
    }).join('') + '</div>';
  }
  var pinned = filtered ? [] : list.filter(isPinned);
  var rest = filtered ? list : list.filter(function (m) { return !isPinned(m); });
  var render = _mmLV.view === 'table' ? _mmTableHtml : function (arr) { return '<div class="mm-grid">' + arr.map(_mmCardHtml).join('') + '</div>'; };
  if (pinned.length) h += '<div class="mm-sec">⭐ 즐겨찾기</div>' + render(pinned);
  if (rest.length) h += (pinned.length || h ? '<div class="mm-sec">' + (filtered ? '찾은 맵' : MM_SORTS.filter(function (s) { return s[0] === _mmLV.sort; })[0][1]) + '</div>' : '') + render(rest);
  body.innerHTML = h;
}

/* 검색에 맞은 주제 — 누르면 그 맵의 그 주제로 */
function _mmHitsHtml(m) {
  var x = _mmHits && _mmHits[m.id];
  var q = (_mm.q || '').trim();
  if (!x || !x.hits.length || !q) return '';
  var rx = new RegExp('(' + _mmEsc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  var mk = function (s) { return _mmEsc(s).replace(rx, '<mark>$1</mark>'); };
  var W = { note: '📝 메모', blocks: '📄 내용', label: '🏷 라벨' };
  return '<div class="mm-hits">' + x.hits.slice(0, 3).map(function (t) {
    return '<button type="button" class="mm-hit" data-act="hit" data-id="' + _mmEsc(m.id) + '" data-sheet="' + t.sheet + '" data-node="' + _mmEsc(t.node) + '" title="이 주제로 열기">' +
      (t.path.length ? '<span class="mm-hit-p">' + t.path.map(_mmEsc).join(' › ') + ' ›</span>' : '') +
      '<span class="mm-hit-t">' + (t.where === 'text' ? mk(t.text) : _mmEsc(t.text) + ' <i>' + W[t.where] + ': ' + mk(t.snip) + '</i>') + '</span></button>';
  }).join('') + (x.total > 3 ? '<span class="mm-hit-more">외 ' + (x.total - 3) + '곳</span>' : '') + '</div>';
}

function _mmCardHtml(m) {
  var me = (_mmMe() || {}).id;
  var pinned = (m.pinned_by || []).indexOf(me) >= 0;
  var owner = m.owner_id === me;
  var shared = (m.editors || []).length + (m.viewers || []).length;
  var badge = owner ? '🔒 내 맵' : '📨 받은 맵 · ' + ((m.editors || []).indexOf(me) >= 0 ? '편집' : '보기');
  return '<div class="mm-card" data-act="open" data-id="' + _mmEsc(m.id) + '">' +
    '<div class="mm-card-top"><span class="mm-badge">' + badge + '</span>' +
    '<span class="mm-star' + (pinned ? ' on' : '') + '" data-act="pin" data-id="' + _mmEsc(m.id) + '" title="즐겨찾기">' + (pinned ? '★' : '☆') + '</span></div>' +
    '<div class="mm-card-title">' + _mmEsc(m.title) + '</div>' +
    '<div class="mm-card-root">◉ ' + _mmEsc(m.root_text || '') + '</div>' +
    (m.project_name ? '<div class="mm-card-meta">📁 ' + _mmEsc(m.project_name) + '</div>' : '') +
    '<div class="mm-card-meta">' + _mmEsc(m.owner_name || '') + (owner ? (shared ? ' · ' + shared + '명에게 보냄' : '') : '') +
    ' · 노드 ' + (m.node_count || 0) + ' · ' + _mmFmtTime(m.updated_at) + '</div>' +
    _mmHitsHtml(m) +
    '<div class="mm-card-acts">' +
    '<button class="btn btn-g btn-s mm-peek-btn" data-act="peek" data-id="' + _mmEsc(m.id) + '" title="미리보기">👁</button>' +
    '<button class="btn btn-g btn-s" data-act="dup" data-id="' + _mmEsc(m.id) + '">복제</button>' +
    (owner ? '<button class="btn btn-g btn-s" data-act="send" data-id="' + _mmEsc(m.id) + '">📨 보내기</button>' : '') +
    (owner ? '<button class="btn btn-g btn-s mm-danger" data-act="del" data-id="' + _mmEsc(m.id) + '">삭제</button>' : '') +
    '</div></div>';
}
/* 목록(표) 보기 — 한 줄에 한 맵, 머리를 누르면 정렬 */
function _mmTableHtml(arr) {
  var me = (_mmMe() || {}).id;
  var th = function (k, l, cls) { return '<th class="' + (cls || '') + '"' + (k ? ' data-act="sortcol" data-v="' + k + '"' : '') + '>' + l + (k && _mmLV.sort === k ? ' ▾' : '') + '</th>'; };
  return '<div class="mm-tbl-w"><table class="mm-tbl"><thead><tr>' + th('', '', 'c-star') + th('title', '제목') + th('', '프로젝트', 'c-proj') + th('', '만든 사람', 'c-own') + th('', '공유', 'c-sh') + th('nodes', '주제', 'c-n') + th('updated', '수정') + th('', '', 'c-act') + '</tr></thead><tbody>' +
    arr.map(function (m) {
      var pinned = (m.pinned_by || []).indexOf(me) >= 0, owner = m.owner_id === me;
      var shared = (m.editors || []).length + (m.viewers || []).length;
      return '<tr class="mm-row" data-act="open" data-id="' + _mmEsc(m.id) + '">' +
        '<td class="c-star"><span class="mm-star' + (pinned ? ' on' : '') + '" data-act="pin" data-id="' + _mmEsc(m.id) + '" title="즐겨찾기">' + (pinned ? '★' : '☆') + '</span></td>' +
        '<td class="c-title"><b>' + _mmEsc(m.title) + '</b><span>◉ ' + _mmEsc(m.root_text || '') + '</span>' + _mmHitsHtml(m) + '</td>' +
        '<td class="c-proj">' + _mmEsc(m.project_name || '—') + '</td>' +
        '<td class="c-own">' + _mmEsc(m.owner_name || '') + '</td>' +
        '<td class="c-sh">' + (owner ? (shared ? '📨 ' + shared + '명' : '🔒 나만') : '받음 · ' + ((m.editors || []).indexOf(me) >= 0 ? '편집' : '보기')) + '</td>' +
        '<td class="c-n">' + (m.node_count || 0) + '</td>' +
        '<td class="c-up">' + _mmFmtTime(m.updated_at) + '</td>' +
        '<td class="c-act"><button class="btn btn-g btn-s mm-peek-btn" data-act="peek" data-id="' + _mmEsc(m.id) + '" title="미리보기">👁</button>' +
        '<button class="btn btn-g btn-s" data-act="dup" data-id="' + _mmEsc(m.id) + '" title="복제">⧉</button>' +
        (owner ? '<button class="btn btn-g btn-s" data-act="send" data-id="' + _mmEsc(m.id) + '" title="보내기">📨</button><button class="btn btn-g btn-s mm-danger" data-act="del" data-id="' + _mmEsc(m.id) + '" title="삭제">🗑</button>' : '') +
        '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function _mmListClick(e) {
  var t = e.target.closest('[data-act]');
  if (!t || !this.contains(t)) return;
  var act = t.getAttribute('data-act');
  var id = t.getAttribute('data-id');
  if (act !== 'open') e.stopPropagation();
  if (act !== 'peek') _mmPeekHide(true);
  if (act === 'tab') { _mm.listTab = t.getAttribute('data-tab'); _mmRenderListTabs(); _mmPaintList(); }
  else if (act === 'open') mmOpen(id);
  else if (act === 'hit') { _mm.goto = { mapId: id, sheet: +t.getAttribute('data-sheet') || 0, node: t.getAttribute('data-node') }; mmOpen(id); }
  else if (act === 'peek') _mmPeekShow(id, t.closest('.mm-card,.mm-row') || t, true);
  else if (act === 'view') { _mmLV.view = t.getAttribute('data-v'); _mmLVSave(); _mmPaintList(); }
  else if (act === 'sortcol') { _mmLV.sort = t.getAttribute('data-v'); _mmLVSave(); var s = _mmEl('mmListSort'); if (s) s.value = _mmLV.sort; _mmPaintList(); }
  else if (act === 'fclear') { _mmLV.proj = ''; _mmLV.owner = ''; _mmLV.age = ''; _mmLVSave(); _mmPaintList(); }
  else if (act === 'new') mmNewMapModal();
  else if (act === 'import') mmImportModal();
  else if (act === 'send') mmShareModal(_mm.list.filter(function (m) { return m.id === id; })[0]);
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
        // 상황별 추천 갤러리 — 카드를 고르면 아래 숨긴 #mmNewTpl 값이 바뀐다 (키보드 · 테스트는 select 를 그대로 씀)
        '<div class="mm-tpl-cats" id="mmTplCats">' + MM_TPL_CATS.map(function (c) { return '<button type="button" data-cat="' + c.k + '">' + c.l + '</button>'; }).join('') + '</div>' +
        '<div class="mm-tpl-grid" id="mmTplGrid"></div>' +
        '<label class="mm-tpl-sel-l">시작 방법<select id="mmNewTpl" class="mm-input">' +
        '<optgroup label="템플릿">' + MM_TEMPLATES.map(opt).join('') + '</optgroup>' +
        '<optgroup label="앱 데이터로 자동 생성 (상태가 실시간으로 보임)">' + MM_GEN_TEMPLATES.map(opt).join('') + '</optgroup>' +
        (ai ? '<optgroup label="✨ AI">' + MM_AI_TEMPLATES.map(opt).join('') + '</optgroup>' : '') +
        '</select></label>' +
        '<div class="mm-sub" id="mmNewHint"></div>' +
        '<div class="mm-tpl-prev" id="mmNewPrev"></div>' +
        '<label class="mm-pn-chk" id="mmNewExWrap"><input type="checkbox" id="mmNewEx" checked> 예제 내용 넣기 — 바로 고쳐 쓰기 쉽게 (끄면 가지 이름만)</label>' +
        '<label>제목<input id="mmNewTitle" class="mm-input" placeholder="예: SK 2호기 WBS"></label>' +
        '<label id="mmNewProjWrap" class="hidden">프로젝트<select id="mmNewProj" class="mm-input">' + _mmProjectOptions(projects) + '</select></label>' +
        '<label id="mmNewMeetWrap" class="hidden">회의<select id="mmNewMeet" class="mm-input"><option value="">불러오는 중…</option></select></label>' +
        '<label id="mmNewDeptWrap" class="hidden">부서<select id="mmNewDept" class="mm-input">' +
        (hasDept ? '<option value="">내 부서</option>' : '') + (_mmIsAdmin() ? '<option value="__all">전체 (모든 사용자)</option>' : '') +
        depts.map(function (d) { return '<option value="' + _mmEsc(d.id) + '">' + _mmEsc(d.name) + '</option>'; }).join('') + '</select></label>' +
        '<label id="mmNewAiWrap" class="hidden">정리할 글 (회의 메모 · 요구사항 · 메일 등)<textarea id="mmNewAiText" class="mm-input" rows="8"></textarea></label>' +
        '<div class="mm-sub">만든 맵은 나만 봅니다. 다른 사람에게는 [📨 보내기]로 보내세요.</div>' +
        '<div class="mm-form-acts"><button class="btn btn-p" id="mmNewOk">만들기</button></div></div>';
      var md = createModal({ id: 'mmNewModal', title: '🧠 새 마인드맵', html: html, width: '680px', closeOnEsc: true });
      var tplSel = _mmEl('mmNewTpl');
      function tplOf(k) { return MM_TEMPLATES.concat(MM_GEN_TEMPLATES, MM_AI_TEMPLATES).filter(function (t) { return t.k === k; })[0] || MM_TEMPLATES[0]; }
      function refresh(fromTpl) {
        var t = tplOf(tplSel.value);
        if (fromTpl) {
          if (t.gen === 'meeting') _mmLoadMeetingOptions();
        }
        var needProj = t.gen === 'project' || t.ai === 'wbs';
        _mmEl('mmNewMeetWrap').classList.toggle('hidden', t.gen !== 'meeting');
        _mmEl('mmNewProjWrap').classList.toggle('hidden', !needProj);
        _mmEl('mmNewDeptWrap').classList.toggle('hidden', !(_mmIsAdmin() && t.gen === 'team'));
        _mmEl('mmNewAiWrap').classList.toggle('hidden', t.ai !== 'text');
        _mmEl('mmNewTitle').placeholder = (t.gen || t.ai) ? '비우면 자동으로 정함' : t.k === 'blank' ? '예: SK 2호기 WBS' : '비우면 「' + t.l + '」';
        _mmEl('mmNewHint').textContent = t.hint || t.when || '';
        var ex = !!t.ex;
        _mmEl('mmNewExWrap').classList.toggle('hidden', !ex);
        var def = t.tree ? ((ex && _mmEl('mmNewEx').checked) ? t.ex('') : t.tree('')) : null;
        _mmEl('mmNewPrev').innerHTML = def && (def.children || []).length ? '<b>미리 보기</b>' + (def.children || []).map(function (c) {
          var kids = typeof c === 'string' ? [] : (c.children || []);
          return '<div><span>' + _mmEsc(typeof c === 'string' ? c : c.text) + '</span>' + (kids.length ? '<i>' + kids.slice(0, 3).map(function (k) { return _mmEsc(typeof k === 'string' ? k : k.text); }).join(' · ') + (kids.length > 3 ? ' …' : '') + '</i>' : '') + '</div>';
        }).join('') : '';
        _mmEl('mmTplGrid').querySelectorAll('[data-k]').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-k') === t.k); });
      }
      var allTpl = MM_TEMPLATES.concat(MM_GEN_TEMPLATES, ai ? MM_AI_TEMPLATES : []);
      function paintCat(cat) {
        _mmEl('mmTplCats').querySelectorAll('[data-cat]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-cat') === cat); });
        var list = cat === 'rec' ? MM_TPL_REC.map(tplOf) : cat === 'auto' ? MM_GEN_TEMPLATES.concat(ai ? MM_AI_TEMPLATES : []) : allTpl.filter(function (t) { return t.cat === cat; });
        _mmEl('mmTplGrid').innerHTML = list.map(function (t) {
          return '<button type="button" class="mm-tpl-card' + (t.k === tplSel.value ? ' on' : '') + '" data-k="' + t.k + '">' +
            '<b>' + (t.icon ? t.icon + ' ' : '') + _mmEsc(t.l) + '</b><span>' + _mmEsc(t.when || t.hint || '') + '</span></button>';
        }).join('');
      }
      _mmEl('mmTplCats').onclick = function (e) { var b = e.target.closest('[data-cat]'); if (b) paintCat(b.getAttribute('data-cat')); };
      _mmEl('mmTplGrid').onclick = function (e) {
        var c = e.target.closest('[data-k]');
        if (!c) return;
        tplSel.value = c.getAttribute('data-k');
        refresh(true);
        _mmEl('mmNewTitle').focus();
      };
      _mmEl('mmNewEx').onchange = function () { refresh(false); };
      paintCat('rec');
      function _mmLoadMeetingOptions() {
        var sel = _mmEl('mmNewMeet');
        if (sel.getAttribute('data-loaded')) return;
        sel.setAttribute('data-loaded', '1');
        apiFetch('/api/mindmaps/search-refs?type=meeting&q=').then(function (r) {
          var list = (r && r.data) || [];
          sel.innerHTML = list.length ? list.map(function (m) { return '<option value="' + _mmEsc(m.id) + '">' + _mmEsc((m.sub ? String(m.sub).slice(0, 10) + ' · ' : '') + m.title) + '</option>'; }).join('')
            : '<option value="">볼 수 있는 회의가 없습니다</option>';
        }).catch(function () { sel.innerHTML = '<option value="">회의 목록을 불러오지 못했습니다</option>'; });
      }
      tplSel.onchange = function () { refresh(true); };
      refresh(false);
      _mmEl('mmNewTitle').onkeydown = function (e) { if (e.key === 'Enter') _mmEl('mmNewOk').click(); };
      _mmEl('mmNewOk').onclick = function () {
        var btn = this;
        var t = tplOf(tplSel.value);
        var title = _mmEl('mmNewTitle').value.trim();
        var projectId = _mmEl('mmNewProj').value || null;
        var deptSel = _mmEl('mmNewDept').value;
        var deptId = deptSel && deptSel !== '__all' ? deptSel : null;
        if (!title && t.tree && t.k !== 'blank') title = t.l;   // 템플릿은 이름을 기본 제목으로
        if (!title && !t.gen && !t.ai) { _mmToast('제목을 입력하세요', 'error'); return; }
        var meetingId = _mmEl('mmNewMeet').value || null;
        if (t.gen === 'meeting' && !meetingId) { _mmToast('회의를 선택하세요', 'error'); return; }
        if ((t.gen === 'project' || t.ai === 'wbs') && !projectId) { _mmToast('프로젝트를 선택하세요', 'error'); return; }
        var made;
        if (t.gen) made = mmGenerateDoc(t.gen, { projectId: projectId, departmentId: deptId, all: deptSel === '__all', meetingId: meetingId });
        else if (t.ai === 'text') made = mmAiTextDoc(_mmEl('mmNewAiText').value, title);
        else if (t.ai === 'wbs') made = mmAiWbsDoc(projectId, title);
        else {
          var root = _mmBuildTree(t.ex && _mmEl('mmNewEx').checked ? t.ex(title) : t.tree(title));
          root.id = 'n-root';
          made = Promise.resolve({ title: title, doc: { sheets: [{ id: 'sh-1', title: '시트 1', structure: t.structure || 'balanced', root: root, relations: [] }] } });
        }
        btn.disabled = true;
        var oldLabel = btn.textContent;
        if (t.gen || t.ai) btn.textContent = t.ai ? '✨ AI 가 정리하는 중…' : '불러오는 중…';
        made.then(function (r) {
          if (!r) throw new Error('만들 내용이 없습니다');
          // 볼 수 있는 사람은 늘 나 + 보낸 사람. 프로젝트 맵 · 프로젝트 회의록은 그 프로젝트에 연결만 (프로젝트 상세의 맵 목록용)
          var pid = t.gen === 'meeting' ? (r.projectId || null) : (t.gen === 'project' || t.ai === 'wbs') ? projectId : null;
          return _mmCreate({ title: (title || r.title || '새 맵').slice(0, 255), scope: pid ? 'project' : 'personal', projectId: pid, template: t.k, doc: r.doc });
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

/**
 * 소유자: 📨 보내기 — 고른 사람만 이 맵을 본다 (보기 = 읽기만, 편집 = 같이 고치기). 받은 사람에게 알림이 간다.
 * row 를 주면 목록 카드에서 (편집기 밖), 없으면 열린 맵(_mm.row)
 */
function mmShareModal(row) {
  var inEditor = !row;
  row = row || _mm.row;
  if (!row) return;
  return wmGuardedModal('mmShare', function () {
    return _mmLoadMembers().then(function (all) {
      var me = (_mmMe() || {}).id;
      var members = (all || []).filter(function (u) { return u.id !== me; });
      var editors = row.editors || [], viewers = row.viewers || [];
      var html = '<div class="mm-form">' +
        '<div class="mm-sub">「' + _mmEsc(row.title || '') + '」 — 여기서 고른 사람만 이 맵을 볼 수 있습니다. 새로 받은 사람에게는 알림이 갑니다.</div>' +
        '<input id="mmShQ" class="mm-input" placeholder="🔍 이름으로 찾기">' +
        '<div class="mm-acc-list">' + members.map(function (u) {
          var role = editors.indexOf(u.id) >= 0 ? 'edit' : viewers.indexOf(u.id) >= 0 ? 'view' : '';
          return '<div class="mm-acc-row" data-q="' + _mmEsc(String(u.name || '').toLowerCase()) + '"><span class="mm-acc-name">' + _mmEsc(u.name) + '</span>' +
            '<select class="mm-input mm-sh-role" data-uid="' + _mmEsc(u.id) + '">' +
              '<option value="">보내지 않음</option><option value="view"' + (role === 'view' ? ' selected' : '') + '>보기만</option>' +
              '<option value="edit"' + (role === 'edit' ? ' selected' : '') + '>같이 편집</option></select></div>';
        }).join('') + '</div>' +
        '<div class="mm-form-acts"><span class="mm-hint" id="mmShCount"></span><button class="btn btn-p" id="mmShOk">보내기</button></div></div>';
      var md = createModal({ id: 'mmShareModal', title: '📨 맵 보내기', html: html, width: '480px', closeOnEsc: true });
      function count() {
        var n = 0;
        document.querySelectorAll('#mmShareModal .mm-sh-role').forEach(function (x) { if (x.value) n++; });
        _mmEl('mmShCount').textContent = n ? n + '명이 볼 수 있음' : '나만 볼 수 있음';
      }
      count();
      _mmEl('mmShareModal').addEventListener('change', count);
      _mmEl('mmShQ').oninput = function () {
        var q = this.value.trim().toLowerCase();
        document.querySelectorAll('#mmShareModal .mm-acc-row').forEach(function (r) { r.style.display = !q || r.getAttribute('data-q').indexOf(q) >= 0 ? '' : 'none'; });
      };
      _mmEl('mmShOk').onclick = function () {
        var btn = this;
        var ed = [], vw = [];
        document.querySelectorAll('#mmShareModal .mm-sh-role').forEach(function (x) {
          if (x.value === 'edit') ed.push(x.getAttribute('data-uid'));
          else if (x.value === 'view') vw.push(x.getAttribute('data-uid'));
        });
        var added = ed.concat(vw).filter(function (id) { return editors.indexOf(id) < 0 && viewers.indexOf(id) < 0; }).length;
        btn.disabled = true;
        // 편집기에서는 고치던 내용을 먼저 저장해 version 을 맞춘다
        Promise.resolve(inEditor ? _mmSaveNow() : null).then(function () {
          return apiFetch('/api/mindmaps/' + encodeURIComponent(row.id), { method: 'PUT', body: JSON.stringify({ version: inEditor ? _mm.version : row.version, editors: ed, viewers: vw }) });
        }).then(function (r) {
          row.version = r.data.version; row.editors = r.data.editors || []; row.viewers = r.data.viewers || [];
          if (inEditor) { _mm.version = r.data.version; _mmStatus(); }
          else _mmPaintList();
          _mmToast(added ? '📨 ' + added + '명에게 보냈습니다' : '보낼 사람을 바꿨습니다');
          md.close();
        }).catch(function (e) {
          btn.disabled = false;
          _mmToast('❌ ' + (e && e.status === 409 ? '그 사이 맵이 바뀌었습니다 — 새로고침 후 다시 해 주세요' : _mmErr(e)), 'error');
        });
      };
    });
  }, 'mmShareModal');
}

/* ═══ 미리보기 — 카드 · 줄에 마우스를 올리면(0.4초) 작은 맵 모양으로. 터치 기기는 👁 를 누르면 아래에서 ═══
 * 맵 본문은 처음 한 번만 받고 수정 시각이 같으면 다시 쓰는 캐시(_mmPV) */
var _mmPV = {}, _mmPeekT = 0, _mmPeekId = null, _mmPeekCand = null, _mmTouchAt = 0;
// 터치 뒤 브라우저가 흉내 내는 마우스 이벤트는 무시 (👁 로 연 아래 창을 마우스용 미리보기가 덮어쓰지 않게)
document.addEventListener('touchstart', function () { _mmTouchAt = Date.now(); }, { passive: true, capture: true });
function _mmFinePointer() { return Date.now() - _mmTouchAt > 1000 && !document.getElementById('mmPeekBk') && !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches); }
function _mmBindPeek(wrap) {
  wrap.onmouseover = function (e) {
    if (!_mmFinePointer() || _mm.view !== 'list') return;
    var c = e.target.closest && e.target.closest('.mm-card,.mm-row');
    if (!c || !wrap.contains(c)) return;
    var id = c.getAttribute('data-id');
    if (id === _mmPeekId || id === _mmPeekCand) return;
    clearTimeout(_mmPeekT);
    _mmPeekCand = id;
    _mmPeekT = setTimeout(function () { _mmPeekCand = null; _mmPeekShow(id, c, false); }, 400);
  };
  wrap.onmouseout = function (e) {
    if (document.getElementById('mmPeekBk')) return;
    var c = e.target.closest && e.target.closest('.mm-card,.mm-row');
    if (!c || (e.relatedTarget && c.contains(e.relatedTarget))) return;
    clearTimeout(_mmPeekT); _mmPeekCand = null;
    _mmPeekHide();
  };
}
function _mmPeekHide() {
  clearTimeout(_mmPeekT); _mmPeekCand = null; _mmPeekId = null;
  var el = document.getElementById('mmPeek'); if (el) el.remove();
  var bk = document.getElementById('mmPeekBk'); if (bk) bk.remove();
}
function _mmPeekShow(id, anchor, touch) {
  var m = _mm.list.filter(function (x) { return x.id === id; })[0];
  if (!m) return;
  _mmPeekHide();
  _mmPeekId = id;
  var el = document.createElement('div');
  el.id = 'mmPeek';
  el.className = 'mm-peek' + (touch ? ' sheet' : '');
  el.setAttribute('role', touch ? 'dialog' : 'tooltip');
  if (touch) {
    var bk = document.createElement('div');
    bk.id = 'mmPeekBk'; bk.className = 'mm-peek-bk';
    bk.onclick = _mmPeekHide;
    document.body.appendChild(bk);
  }
  document.body.appendChild(el);
  var paint = function (row) {
    if (_mmPeekId !== id) return;
    el.innerHTML = _mmPeekHtml(m, row, touch);
    if (touch) {
      var ob = el.querySelector('[data-pk="open"]'); if (ob) ob.onclick = function () { _mmPeekHide(); _mmRecentPush(id); mmOpen(id); };
      var cb = el.querySelector('[data-pk="close"]'); if (cb) cb.onclick = _mmPeekHide;
    } else _mmPeekPlace(el, anchor);
  };
  var c = _mmPV[id];
  if (c && c.u === m.updated_at) { paint(c.row); return; }
  paint(null);
  apiFetch('/api/mindmaps/' + encodeURIComponent(id)).then(function (r) {
    _mmPV[id] = { u: m.updated_at, row: r.data };
    paint(r.data);
  }).catch(function (e) {
    if (_mmPeekId === id) el.querySelector('.mm-pk-body').innerHTML = '<div class="mm-pk-load">미리보기를 불러오지 못했습니다 — ' + _mmEsc(_mmErr(e)) + '</div>';
  });
}
function _mmPeekPlace(el, anchor) {
  if (!anchor || !anchor.getBoundingClientRect) return;
  var r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, W = window.innerWidth, H = window.innerHeight;
  var left, top = Math.max(8, Math.min(r.top, H - h - 8));
  if (r.right + 12 + w <= W - 8) left = r.right + 12;
  else if (r.left - 12 - w >= 8) left = r.left - 12 - w;
  else { left = Math.max(8, Math.min(r.left, W - w - 8)); top = r.bottom + 8 + h <= H - 8 ? r.bottom + 8 : Math.max(8, r.top - h - 8); }
  el.style.left = left + 'px'; el.style.top = top + 'px';
}
window.addEventListener('scroll', function () { if (_mmPeekId && !document.getElementById('mmPeekBk')) _mmPeekHide(); }, true);
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && _mmPeekId) _mmPeekHide(); });

function _mmPeekHtml(m, row, touch) {
  var me = (_mmMe() || {}).id;
  var head = '<div class="mm-pk-h"><div class="mm-pk-tt">' + _mmEsc(m.title) + '</div>' +
    '<div class="mm-pk-meta">' + (m.project_name ? '📁 ' + _mmEsc(m.project_name) + ' · ' : '') + _mmEsc(m.owner_name || '') + ' · ' + _mmFmtTime(m.updated_at) +
    (m.updated_by_name && m.updated_by !== m.owner_id ? ' (' + _mmEsc(m.updated_by_name) + ')' : '') + '</div>' +
    (touch ? '<button type="button" class="mm-pk-x" data-pk="close" aria-label="닫기">✕</button>' : '') + '</div>';
  var foot = touch ? '<div class="mm-pk-f"><button type="button" class="btn btn-p" data-pk="open">맵 열기</button></div>' : '<div class="mm-pk-tip">누르면 열기</div>';
  if (!row) return head + '<div class="mm-pk-body"><div class="mm-pk-load">불러오는 중…</div></div>' + foot;
  var doc = row.doc;
  if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch (_) { doc = null; } }
  var sheets = (doc && doc.sheets) || [];
  var sh = sheets[0];
  if (!sh || !sh.root) return head + '<div class="mm-pk-body"><div class="mm-pk-load">빈 맵입니다</div></div>' + foot;
  var th = MM_THEMES.filter(function (t) { return t.k === (sh.theme || 'default'); })[0] || MM_THEMES[0];
  var root = sh.root;
  var cut = function (s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s ? (s.length > n ? s.slice(0, n) + '…' : s) : '(빈 주제)'; };
  var br = (root.children || []).filter(function (n) { return !_mmIsFloat(n); });
  var col = function (n) { var i = (root.children || []).indexOf(n); return _mmColorVar(n.color) || (th.colors ? th.colors[i % th.colors.length] : _mmColorVar(MM_AUTO_COLORS[i % MM_AUTO_COLORS.length])); };
  var bal = (sh.structure || 'balanced') === 'balanced';
  var half = Math.ceil(br.length / 2), L = [], R = [];
  br.forEach(function (n, i) { if (bal && (n.side === 'left' || (!n.side && i >= half))) L.push(n); else R.push(n); });
  var MAX = 6;
  var bHtml = function (arr) {
    return arr.slice(0, MAX).map(function (n) {
      var kids = n.children || [];
      return '<div class="mm-pk-b" style="--c:' + col(n) + '"><div class="mm-pk-bt">' + _mmEsc(cut(n.text, 34)) + '</div>' +
        (kids.length ? '<div class="mm-pk-k">' + kids.slice(0, 4).map(function (k) { return '<span>' + _mmEsc(cut(k.text, 18)) + '</span>'; }).join('') + (kids.length > 4 ? '<em>+' + (kids.length - 4) + '</em>' : '') + '</div>' : '') +
        '</div>';
    }).join('') + (arr.length > MAX ? '<div class="mm-pk-more">가지 ' + (arr.length - MAX) + '개 더</div>' : '');
  };
  var rootC = _mmColorVar(root.color) || th.root || 'var(--ac)';
  var map = '<div class="mm-pk-map' + (L.length ? '' : ' one') + '">' +
    (L.length ? '<div class="mm-pk-col l">' + bHtml(L) + '</div>' : '') +
    '<div class="mm-pk-root" style="--c:' + rootC + '">' + _mmEsc(cut(root.text, 30)) + '</div>' +
    '<div class="mm-pk-col r">' + (R.length ? bHtml(R) : '<div class="mm-pk-more">아직 가지가 없습니다</div>') + '</div></div>';
  var total = 0; sheets.forEach(function (s) { total += mmCount(s.root); });
  var info = '<div class="mm-pk-info"><span>주제 ' + total + '개</span>' +
    (sheets.length > 1 ? '<span>시트 ' + sheets.length + '개 — ' + sheets.slice(0, 4).map(function (s) { return _mmEsc(cut(s.title, 12)); }).join(' · ') + (sheets.length > 4 ? ' …' : '') + '</span>' : '') +
    (m.owner_id === me ? ((m.editors || []).length + (m.viewers || []).length ? '<span>📨 ' + ((m.editors || []).length + (m.viewers || []).length) + '명에게 보냄</span>' : '<span>🔒 나만 봄</span>') : '<span>📨 받은 맵</span>') +
    '</div>' + (root.note ? '<div class="mm-pk-note">📝 ' + _mmEsc(cut(root.note, 120)) + '</div>' : '');
  return head + '<div class="mm-pk-body">' + map + info + '</div>' + foot;
}
