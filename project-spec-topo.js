/* project-spec-topo.js — 🧩 장치 계층 구성 화면 (v13.449)
 *   프로젝트 › 편집 › 사양 › 하드웨어 구성도 카드 안 (#psTopo). 데이터 · 그림은 spec-topo.js, 저장은 project-spec.js(_ps.sheet.topo → PATCH ['topo']).
 *   보기: 🗺 구성도 · 📋 목록 · 🎯 축 순서 · 🔢 IO 리스트 — 위의 거르기(Ethernet · USB · 시리얼 …)는 구성도 · 목록에 같이 (고른 계통만 선명, 나머지 흐리게)
 *   파일: ⤓ 엑셀(장치 목록 · 축 순서 · IO 리스트 3장) · 구성도 PNG · SVG
 */
var PST = { view: 'map', sel: null, filter: '', q: '', ioNode: '', ioDir: '', zoom: 1, zoomSet: false, rt: 0, mode: '', modeSet: false };
/** 구성도 모양 — 사람이 고른 것, 아니면 칸이 좁으면(620px 미만) 세로 트리 */
function _pstMode() { if (PST.modeSet && PST.mode) return PST.mode; var b = document.getElementById('psTopo'); return b && b.clientWidth && b.clientWidth < 620 ? 'v' : 'h'; }
function _pstSvg(t, extra) { return specTopoSvg(t, Object.assign({ sel: PST.sel, focus: specTopoFocus(t, PST.filter, PST.q), dark: _pstDark(), mode: _pstMode() }, extra || {})); }
function _pstE(s) { return typeof _specEsc === 'function' ? _specEsc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _pstToast(m, t) { if (typeof _specToast === 'function') _specToast(m, t); else if (typeof showToast === 'function') showToast(m, t); }
function _pstEdit() { return !!(typeof _ps !== 'undefined' && _ps && _ps.canEdit); }
/** 지금 사양서의 계층 구성 (없으면 빈 것) — 고칠 때는 이것을 바로 바꾸고 _pstChanged() */
function _pstT() { if (!_ps.sheet.topo || !Array.isArray(_ps.sheet.topo.nodes)) _ps.sheet.topo = specTopoNorm(_ps.sheet.topo); return _ps.sheet.topo; }
function _pstChanged(redraw) {
  if (specTopoEmpty(_ps.sheet.topo) && !(_ps.sheet.topo.io || []).length) _ps.sheet.topo = null;   // 다 지우면 저장도 비움
  if (typeof _psMarkDirty === 'function') _psMarkDirty();
  if (redraw !== false) psTopoRender();
}
function _pstDark() { var t = document.documentElement.getAttribute('data-theme') || ''; return /dark|night|midnight|ocean|neon|nova|holo|command/.test(t) || (document.body && getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255]).slice(0, 3).reduce(function (s, v) { return s + +v; }, 0) < 300; }

/* ─── 카드 안 틀 ─── */
function psTopoHtml() {
  return '<div id="psTopo" class="pst"></div><datalist id="pstCables">' + ['HDMI', 'DisplayPort', 'VGA (D-Sub)', 'DVI', 'LAN Cat5e', 'LAN Cat6', 'LAN Cat6A', 'USB 2.0', 'USB 3.0', 'RS-232C', 'RS-485', 'Camera Link', 'CoaXPress', 'EtherCAT', '광 케이블', '직결'].map(function (c) { return '<option value="' + c + '">'; }).join('') + '</datalist>';
}
function psTopoRender() {
  var box = document.getElementById('psTopo'); if (!box || typeof _ps === 'undefined' || !_ps) return;
  var t = _ps.sheet.topo ? _pstT() : { v: 1, nodes: [], io: [] }, ed = _pstEdit();
  if (!box._pstBound) { box._pstBound = true; box.addEventListener('click', _pstClick); box.addEventListener('input', _pstInput); box.addEventListener('change', _pstChange); }
  if (PST.sel && !specTopoNode(t, PST.sel)) PST.sel = null;
  var nAx = specTopoAxes(t).length, nIo = (t.io || []).length;
  var head = '<div class="pst-h"><b class="pst-t">🧩 장치 계층 구성</b><span class="pst-sub">PC → 포트 → 카드 · 허브 · 변환기 → 컨트롤러 · 드라이브 → 축</span><span class="pst-sp"></span>' +
    (t.nodes.length ? '<div class="pst-tabs" role="tablist">' + [['map', '구성도'], ['list', '목록 ' + t.nodes.length], ['axis', '축 순서 ' + nAx], ['io', 'IO ' + nIo], ['mon', '모니터 ' + specTopoMonitors(t).length]].map(function (v) { return '<button type="button" role="tab" class="' + (PST.view === v[0] ? 'on' : '') + '" data-pt="view" data-v="' + v[0] + '">' + v[1] + '</button>'; }).join('') + '</div>' : '') +
    (t.nodes.length ? '<div class="pst-dd"><button type="button" class="pst-b" data-pt="filemenu" title="파일로 뽑기">⤓ 파일</button><div class="pst-menu" hidden>' +
      (ed ? '<button type="button" data-pt="imp">📥 엑셀 · CSV 에서 가져오기 (트리 표)</button><button type="button" data-pt="tpl">📄 가져오기 빈 양식 받기</button><hr>' : '') +
      '<button type="button" data-pt="xlsx">📊 엑셀 — 장치 목록 · 축 순서 · IO 리스트 · 모니터 연결</button><button type="button" data-pt="png">🖼 구성도 그림 (PNG)</button><button type="button" data-pt="svg">✏️ 구성도 도면 (SVG)</button></div></div>' +
      '<button type="button" class="pst-b" data-pt="zoombig" title="구성도 크게 보기">⛶</button>' : '') + '</div>';
  if (!t.nodes.length) {
    box.innerHTML = head + '<div class="pst-empty"><div>PC 의 포트에서 갈라지는 제어 장치를 한눈에 — <b>계층 구성도 · 장치 목록 · 축 순서 · IO 리스트</b>를 한 데이터로 관리합니다.</div>' +
      (ed ? '<div class="pst-empty-a"><button type="button" class="pst-b pri" data-pt="seed">✨ 지금 사양 값으로 초안 만들기</button><button type="button" class="pst-b" data-pt="newpc">🖥 PC 부터 새로</button><button type="button" class="pst-b" data-pt="imp">📥 엑셀에서 가져오기</button><button type="button" class="pst-b" data-pt="tpl">📄 빈 양식</button></div><div class="pst-hint">초안은 IPC · 모션 컨트롤러 · IO · 확장 모듈 · 외부장치 · 축 구성 표의 값으로 만듭니다. 만든 뒤 자유롭게 고치세요.</div>' : '<div class="pst-hint">아직 만든 구성이 없습니다.</div>') + '</div>';
    return;
  }
  var checks = specTopoChecks(t);
  var flt = PST.view === 'map' || PST.view === 'list' ? '<div class="pst-flt"><span class="pst-fl">보기</span><button type="button" class="pst-chip' + (!PST.filter ? ' on' : '') + '" data-pt="flt" data-v="">전체</button>' +
    TOPO_FILTERS.map(function (f) { var c = specTopoFilterCount(t, f.key); return c ? '<button type="button" class="pst-chip' + (PST.filter === f.key ? ' on' : '') + '" data-pt="flt" data-v="' + f.key + '">' + _pstE(f.label) + ' <i>' + c + '</i></button>' : ''; }).join('') +
    '<input type="search" class="pst-q" id="pstQ" placeholder="이름 · 모델 · 포트 · IP 찾기" value="' + _pstE(PST.q) + '" autocomplete="off">' +
    (ed ? '<span class="pst-sp"></span><select class="pst-sel" data-pt="preset" title="자주 쓰는 사슬을 한 번에 붙입니다 (장치를 고른 상태면 그 아래)"><option value="">⚡ 빠른 추가…</option>' + TOPO_PRESETS.map(function (p) { return '<option value="' + p.key + '">' + _pstE(p.label) + '</option>'; }).join('') + '</select>' : '') + '</div>' : '';
  var ck = checks.length ? '<div class="pst-ck">⚠️ ' + checks.slice(0, 4).map(_pstE).join(' · ') + (checks.length > 4 ? ' 외 ' + (checks.length - 4) + '건' : '') + '</div>' : '';
  var body = PST.view === 'list' ? _pstList(t) : PST.view === 'axis' ? _pstAxes(t) : PST.view === 'io' ? _pstIo(t) : PST.view === 'mon' ? _pstMon(t) : _pstMap(t);
  var keepQ = document.activeElement && document.activeElement.id === 'pstQ' ? [document.activeElement.selectionStart] : null;
  box.innerHTML = head + flt + ck + body;
  if (keepQ) { var q = document.getElementById('pstQ'); if (q) { q.focus(); try { q.setSelectionRange(keepQ[0], keepQ[0]); } catch (e) {} } }
  if (PST.view === 'map') _pstMapAfter();
}

/* ─── 🗺 구성도 ─── */
function _pstMap(t) {
  var focus = specTopoFocus(t, PST.filter, PST.q);
  var mode = _pstMode(), svg = _pstSvg(t);
  return '<div class="pst-zbar"><div class="pst-seg" role="group" aria-label="구성도 모양"><button type="button" class="' + (mode === 'h' ? 'on' : '') + '" data-pt="mode" data-v="h" title="가로 펼침 — 위에 PC, 장치 인터페이스 띠에서 포트마다 내려감">⇆ 가로</button><button type="button" class="' + (mode === 'v' ? 'on' : '') + '" data-pt="mode" data-v="v" title="세로 트리 — 한 줄씩 들여쓰기 (좁은 칸에서 읽기 쉬움)">⇅ 세로</button></div>' +
    '<button type="button" data-pt="z" data-v="-1" title="작게">－</button><span>' + Math.round(PST.zoom * 100) + '%</span><button type="button" data-pt="z" data-v="1" title="크게">＋</button><button type="button" data-pt="z" data-v="0" title="칸에 맞춤">맞춤</button>' +
    '<span class="pst-zh">장치를 누르면 아래에서 고칠 수 있습니다 · 접힌 가지는 ＋N</span></div>' +
    '<div class="pst-map" id="pstMap"><div class="pst-mapin" style="transform:scale(' + PST.zoom + ');transform-origin:0 0">' + svg + '</div></div>' + _pstEditor(t);
}
function _pstMapAfter() {
  var m = document.getElementById('pstMap'), inner = m && m.querySelector('.pst-mapin'), s = inner && inner.querySelector('svg'); if (!s) return;
  var w = +s.getAttribute('width'), h = +s.getAttribute('height');
  if (!PST.zoomSet && m.clientWidth > 50) {   // 처음엔 칸 폭에 맞춤 (좁은 상세 패널에서 PC 가 밖으로 나가지 않게) — 사람이 배율을 바꾸면 그대로
    var fz = Math.max(0.4, Math.min(1, (m.clientWidth - 8) / w));
    if (Math.abs(fz - PST.zoom) > 0.01) { PST.zoom = fz; inner.style.transform = 'scale(' + fz + ')'; var zl = document.querySelector('#psTopo .pst-zbar span'); if (zl) zl.textContent = Math.round(fz * 100) + '%'; }
  }
  inner.style.width = (w * PST.zoom) + 'px'; inner.style.height = (h * PST.zoom) + 'px';
  if (PST.sel) { var g = s.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(PST.sel) : PST.sel) + '"]'); if (g && g.getBBox) { try { var b = g.getBBox(), x = b.x * PST.zoom, y = b.y * PST.zoom; if (x < m.scrollLeft || x > m.scrollLeft + m.clientWidth - 160) m.scrollLeft = Math.max(0, x - m.clientWidth / 2); if (y < m.scrollTop || y > m.scrollTop + m.clientHeight - 60) m.scrollTop = Math.max(0, y - m.clientHeight / 2); } catch (e) {} } }
}
/** 고른 장치 고치기 줄 (구성도 아래) */
function _pstEditor(t) {
  var n = PST.sel && specTopoNode(t, PST.sel), ed = _pstEdit();
  if (!n) return '<div class="pst-ed pst-ed-0">' + (ed ? '장치를 누르면 이름 · 모델 · 포트를 고치고, 아래에 장치를 붙일 수 있습니다' : '장치를 누르면 자세히 볼 수 있습니다') + '</div>';
  var K = topoKind(n.kind), C = topoCat(n.kind), path = specTopoPath(t, n.id).map(specTopoName).join(' › ');
  var dis = ed ? '' : ' disabled';
  return '<div class="pst-ed" data-id="' + _pstE(n.id) + '"><div class="pst-ed-h"><span class="pst-kd" style="background:' + C.fill + '">' + topoIconSvg(n.kind, 13, '#fff') + ' ' + _pstE(K.label) + '</span><span class="pst-path">' + _pstE(path || '맨 위') + '</span>' +
    (ed ? '<span class="pst-sp"></span>' + _pstAddSel(n) + '<button type="button" class="pst-b sm" data-pt="up" data-id="' + _pstE(n.id) + '" title="위로">↑</button><button type="button" class="pst-b sm" data-pt="down" data-id="' + _pstE(n.id) + '" title="아래로">↓</button>' +
      '<button type="button" class="pst-b sm" data-pt="fold" data-id="' + _pstE(n.id) + '">' + (n.fold ? '펼치기' : '접기') + '</button><button type="button" class="pst-b sm" data-pt="dup" data-id="' + _pstE(n.id) + '" title="아래 장치까지 복제">⧉</button><button type="button" class="pst-b sm dng" data-pt="del" data-id="' + _pstE(n.id) + '" title="지우기 (아래 장치까지)">🗑</button>' : '') + '</div>' +
    '<div class="pst-ed-f">' +
    '<label><span>이름</span><input class="pst-in" data-f="name" data-id="' + _pstE(n.id) + '" value="' + _pstE(n.name) + '" placeholder="' + _pstE(K.dflt) + '"' + dis + '></label>' +
    '<label><span>종류</span><select class="pst-in" data-f="kind" data-id="' + _pstE(n.id) + '"' + dis + '>' + _pstKindOpts(n.kind) + '</select></label>' +
    '<label><span>모델</span><input class="pst-in" data-f="model" data-id="' + _pstE(n.id) + '" value="' + _pstE(n.model) + '" placeholder="제조사 · 모델"' + dis + '></label>' +
    '<label><span>포트 · 채널</span><input class="pst-in sm" data-f="port" data-id="' + _pstE(n.id) + '" value="' + _pstE(n.port) + '" placeholder="' + _pstE(K.portHint || 'CH0 · Port1') + '"' + dis + '></label>' +
    '<label><span>주소 · IP · COM</span><input class="pst-in sm mono ip" data-f="addr" data-id="' + _pstE(n.id) + '" value="' + _pstE(n.addr) + '" placeholder="192.168.0.10 · COM3"' + dis + '></label>' +
    (n.parent ? '<label><span>케이블 (위와 연결)</span><input class="pst-in sm" data-f="cable" data-id="' + _pstE(n.id) + '" value="' + _pstE(n.cable) + '" placeholder="HDMI · LAN Cat6 · RS-232C" list="pstCables"' + dis + '></label><label><span>길이</span><input class="pst-in xs" data-f="len" data-id="' + _pstE(n.id) + '" value="' + _pstE(n.len) + '" placeholder="3m"' + dis + '></label>' : '') +
    (n.kind === 'axis' ? '<label><span>축 번호</span><input class="pst-in xs" type="number" min="1" data-f="ord" data-id="' + _pstE(n.id) + '" value="' + _pstE(n.ord) + '"' + dis + '></label>' : '') +
    (n.kind === 'iocard' || n.kind === 'iomod' ? '<label><span>점 수</span><input class="pst-in xs" type="number" min="0" data-f="pts" data-id="' + _pstE(n.id) + '" value="' + _pstE(n.pts) + '"' + dis + '></label>' : '') +
    '<label class="wide"><span>비고</span><input class="pst-in" data-f="note" data-id="' + _pstE(n.id) + '" value="' + _pstE(n.note) + '" placeholder="용도 · 프로토콜 · 설정"' + dis + '></label></div></div>';
}
function _pstKindOpts(cur) {   // 무리별로 묶어 고르기 쉽게
  var by = {}; TOPO_KIND_ORDER.forEach(function (k) { var c = topoKind(k).cat; (by[c] = by[c] || []).push(k); });
  return Object.keys(TOPO_CATS).filter(function (c) { return by[c]; }).map(function (c) { return '<optgroup label="' + _pstE(TOPO_CATS[c].label) + '">' + by[c].map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + _pstE(topoKind(k).label) + '</option>'; }).join('') + '</optgroup>'; }).join('');
}
/** ＋ 아래에 붙이기 — 흔히 붙는 것 먼저 */
function _pstAddSel(n) {
  var K = topoKind(n.kind), rec = K.next || [], rest = TOPO_KIND_ORDER.filter(function (k) { return k !== 'pc' && rec.indexOf(k) < 0; });
  return '<select class="pst-sel sm" data-pt="addkid" data-id="' + _pstE(n.id) + '" title="이 장치 아래에 붙이기"><option value="">＋ 아래에 붙이기</option>' +
    (rec.length ? '<optgroup label="흔히 붙는 것">' + rec.map(function (k) { return '<option value="' + k + '">' + _pstE(topoKind(k).label) + '</option>'; }).join('') + '</optgroup>' : '') +
    '<optgroup label="모든 종류">' + rest.map(function (k) { return '<option value="' + k + '">' + _pstE(topoKind(k).label) + '</option>'; }).join('') + '</optgroup></select>';
}

/* ─── 📋 목록 (들여쓰기 나무) ─── */
function _pstList(t) {
  var ed = _pstEdit(), focus = specTopoFocus(t, PST.filter, PST.q), flat = specTopoFlat(t, { fold: true });
  var dis = ed ? '' : ' disabled';
  var rows = flat.map(function (x) {
    var n = x.n, K = topoKind(n.kind), C = topoCat(n.kind), id = _pstE(n.id), dim = focus && !focus[n.id];
    return '<tr class="' + (dim ? 'dim' : '') + (PST.sel === n.id ? ' sel' : '') + (n.parent ? '' : ' is-root') + '" data-id="' + id + '" style="--d:' + Math.min(x.depth, 8) + '">' +
      '<td class="pst-tree" style="--d:' + x.depth + ';padding-left:' + (6 + x.depth * 18) + 'px">' + (x.kids ? '<button type="button" class="pst-fold" data-pt="fold" data-id="' + id + '" title="' + (n.fold ? '펼치기' : '접기') + '">' + (n.fold ? '▸' : '▾') + '</button>' : '<span class="pst-fold0">' + (x.depth ? '└' : '') + '</span>') +
        '<span class="pst-kd ic" style="background:' + C.fill + '" title="' + _pstE(K.label) + '">' + topoIconSvg(n.kind, 13, '#fff') + '</span>' +
        '<input class="pst-in" data-f="name" data-id="' + id + '" value="' + _pstE(n.name) + '" placeholder="' + _pstE(K.dflt) + '"' + dis + '>' + (n.fold && x.kids ? '<i class="pst-more">+' + x.kids + '</i>' : '') + '</td>' +
      '<td data-l="종류"><select class="pst-in" data-f="kind" data-id="' + id + '"' + dis + '>' + _pstKindOpts(n.kind) + '</select></td>' +
      '<td data-l="모델"><input class="pst-in" data-f="model" data-id="' + id + '" value="' + _pstE(n.model) + '"' + dis + '></td>' +
      '<td data-l="포트 · 채널"><input class="pst-in" data-f="port" data-id="' + id + '" value="' + _pstE(n.port) + '" placeholder="' + _pstE(K.portHint) + '"' + dis + '></td>' +
      '<td data-l="주소 · IP · COM" class="pst-ipc"><input class="pst-in mono ip" data-f="addr" data-id="' + id + '" value="' + _pstE(n.addr) + '" placeholder="192.168.0.10 · COM3"' + dis + '></td>' +
      '<td data-l="케이블" class="pst-cab"><input class="pst-in" data-f="cable" data-id="' + id + '" value="' + _pstE(n.cable) + '" list="pstCables"' + (n.parent ? '' : ' disabled') + dis + '></td>' +
      '<td data-l="길이" class="pst-cab"><input class="pst-in xs" data-f="len" data-id="' + id + '" value="' + _pstE(n.len) + '"' + (n.parent ? '' : ' disabled') + dis + '></td>' +
      '<td data-l="비고" class="pst-notec"><input class="pst-in" data-f="note" data-id="' + id + '" value="' + _pstE(n.note) + '"' + dis + '></td>' +
      (ed ? '<td class="pst-act">' + _pstAddSel(n).replace('pst-sel sm', 'pst-sel xs').replace('＋ 아래에 붙이기', '＋') +
        '<button type="button" data-pt="up" data-id="' + id + '" title="위로">↑</button><button type="button" data-pt="down" data-id="' + id + '" title="아래로">↓</button>' +
        '<button type="button" data-pt="out" data-id="' + id + '" title="한 단계 위로 (내기)">⇤</button><button type="button" data-pt="in" data-id="' + id + '" title="바로 위 장치 아래로 (들이기)">⇥</button>' +
        '<button type="button" data-pt="dup" data-id="' + id + '" title="복제">⧉</button><button type="button" class="dng" data-pt="del" data-id="' + id + '" title="지우기">✕</button></td>' : '') + '</tr>';
  }).join('');
  return '<div class="pst-tw"><table class="pst-tbl pst-tree-tbl"><thead><tr><th>장치 (계층)</th><th>종류</th><th>모델</th><th>포트 · 채널</th><th>주소 · IP · COM</th><th>케이블</th><th>길이</th><th>비고</th>' + (ed ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
    (ed ? '<div class="pst-foot"><button type="button" class="pst-b sm" data-pt="addroot">＋ 맨 위에 장치</button><button type="button" class="pst-b sm" data-pt="foldall" data-v="1">모두 접기</button><button type="button" class="pst-b sm" data-pt="foldall" data-v="0">모두 펼치기</button></div>' : '');
}

/* ─── 🎯 축 순서 ─── */
function _pstAxes(t) {
  var ax = specTopoAxes(t), ed = _pstEdit(), dis = ed ? '' : ' disabled';
  if (!ax.length) return '<div class="pst-empty sm">액추에이터(축)가 없습니다 — ' + (ed ? '구성도에서 드라이브 · 모션 카드를 고르고 <b>＋ 아래에 붙이기 › 액추에이터</b>, 또는 <b>⚡ 빠른 추가 › 모션</b>' : '') + '</div>';
  var rows = ax.map(function (n, i) {
    var inf = specTopoAxisInfo(t, n), id = _pstE(n.id);
    return '<tr data-id="' + id + '"><td class="pst-ord">' + (ed ? '<button type="button" data-pt="axup" data-id="' + id + '"' + (i ? '' : ' disabled') + ' title="앞으로">▲</button>' : '') + '<b>' + (n.ord || i + 1) + '</b>' + (ed ? '<button type="button" data-pt="axdn" data-id="' + id + '"' + (i < ax.length - 1 ? '' : ' disabled') + ' title="뒤로">▼</button>' : '') + '</td>' +
      '<td><input class="pst-in" data-f="name" data-id="' + id + '" value="' + _pstE(n.name) + '"' + dis + '></td>' +
      '<td><input class="pst-in" data-f="model" data-id="' + id + '" value="' + _pstE(n.model) + '" placeholder="모터 · 액추에이터 모델"' + dis + '></td>' +
      '<td>' + (inf.drive ? _pstE(specTopoName(inf.drive)) + (inf.drive.model ? '<i> ' + _pstE(inf.drive.model) + '</i>' : '') : '<span class="pst-na">—</span>') + '</td>' +
      '<td>' + (_pstE(inf.ch) || '<span class="pst-na">—</span>') + '</td>' +
      '<td>' + (inf.ctrl ? _pstE(specTopoName(inf.ctrl)) : '<span class="pst-warn">제어기 없음</span>') + '</td>' +
      '<td class="pst-pathc">' + _pstE(inf.path.map(specTopoName).join(' › ')) + '</td>' +
      '<td><input class="pst-in" data-f="note" data-id="' + id + '" value="' + _pstE(n.note) + '" placeholder="용도"' + dis + '></td></tr>';
  }).join('');
  return '<div class="pst-tw"><table class="pst-tbl"><thead><tr><th>축 번호</th><th>축 이름</th><th>모델</th><th>드라이브</th><th>채널</th><th>제어기</th><th>연결 경로</th><th>용도 · 비고</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="pst-hint">축 번호는 프로그램의 축 순서 — ▲▼ 로 바꾸면 1번부터 다시 매깁니다. 연결 경로 · 채널은 구성도에서 자동.</div>';
}

/* ─── 🔢 IO 리스트 ─── */
function _pstIo(t) {
  var ed = _pstEdit(), dis = ed ? '' : ' disabled', sum = specTopoIoSummary(t), dup = specTopoIoDup(t);
  if (!sum.length) return '<div class="pst-empty sm">IO 를 둘 장치가 없습니다 — ' + (ed ? '<b>⚡ 빠른 추가 › IO</b> 또는 구성도에서 IO 카드 · 리모트 IO 를 붙이세요' : '') + '</div>';
  if (PST.ioNode && !sum.some(function (s) { return s.n.id === PST.ioNode; })) PST.ioNode = '';
  var chips = '<div class="pst-flt"><span class="pst-fl">장치</span><button type="button" class="pst-chip' + (!PST.ioNode ? ' on' : '') + '" data-pt="ionode" data-v="">전체 <i>' + t.io.length + '</i></button>' +
    sum.map(function (s) { return '<button type="button" class="pst-chip' + (PST.ioNode === s.n.id ? ' on' : '') + (s.over ? ' over' : '') + '" data-pt="ionode" data-v="' + _pstE(s.n.id) + '">' + topoKind(s.n.kind).icon + ' ' + _pstE(specTopoName(s.n)) + ' <i>' + (s.c.DI ? 'DI ' + s.c.DI + ' ' : '') + (s.c.DO ? 'DO ' + s.c.DO + ' ' : '') + (s.c.AI ? 'AI ' + s.c.AI + ' ' : '') + (s.c.AO ? 'AO ' + s.c.AO : '') + (s.used ? '' : '0') + (s.n.pts != null ? ' / ' + s.n.pts : '') + '</i></button>'; }).join('') +
    '<span class="pst-sp"></span>' + ['', 'DI', 'DO', 'AI', 'AO'].map(function (d) { return '<button type="button" class="pst-chip sm' + (PST.ioDir === d ? ' on' : '') + '" data-pt="iodir" data-v="' + d + '">' + (d || '모두') + '</button>'; }).join('') + '</div>';
  var target = PST.ioNode || (sum[0] && sum[0].n.id);
  var add = ed ? '<div class="pst-ioadd"><span>' + _pstE(specTopoName(specTopoNode(t, target))) + ' 에</span>' +
    [['DI', 16], ['DO', 16], ['AI', 4], ['AO', 4], ['DI', 1], ['DO', 1]].map(function (a) { return '<button type="button" class="pst-b sm" data-pt="ioadd" data-dir="' + a[0] + '" data-n="' + a[1] + '" data-id="' + _pstE(target) + '">＋ ' + a[0] + ' ' + a[1] + '점</button>'; }).join('') + '</div>' : '';
  var list = t.io.filter(function (r) { return (!PST.ioNode || r.node === PST.ioNode) && (!PST.ioDir || r.dir === PST.ioDir); });
  var rows = list.slice(0, 1500).map(function (r) {
    var n = specTopoNode(t, r.node), id = _pstE(r.id), dp = dup[String(r.addr || '').trim().toUpperCase()];
    return '<tr data-io="' + id + '"><td>' + _pstE(n ? specTopoName(n) : '') + '</td><td><select class="pst-in io-' + r.dir + '" data-iof="dir" data-io="' + id + '"' + dis + '>' + ['DI', 'DO', 'AI', 'AO'].map(function (d) { return '<option' + (d === r.dir ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></td>' +
      '<td><input class="pst-in mono' + (dp ? ' bad' : '') + '" data-iof="addr" data-io="' + id + '" value="' + _pstE(r.addr) + '"' + (dp ? ' title="같은 주소가 또 있습니다"' : '') + dis + '></td>' +
      '<td><input class="pst-in" data-iof="name" data-io="' + id + '" value="' + _pstE(r.name) + '" placeholder="예: 도어 닫힘 센서"' + dis + '></td>' +
      '<td><input class="pst-in" data-iof="desc" data-io="' + id + '" value="' + _pstE(r.desc) + '"' + dis + '></td>' +
      '<td><input class="pst-in" data-iof="dev" data-io="' + id + '" value="' + _pstE(r.dev) + '" placeholder="센서 · 밸브 · 램프"' + dis + '></td>' +
      (ed ? '<td class="pst-act"><button type="button" class="dng" data-pt="iodel" data-io="' + id + '" title="지우기">✕</button></td>' : '') + '</tr>';
  }).join('');
  return chips + add + (list.length ? '<div class="pst-tw io"><table class="pst-tbl"><thead><tr><th>장치</th><th>방향</th><th>주소</th><th>이름</th><th>설명</th><th>연결 장치</th>' + (ed ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' + (list.length > 1500 ? '<div class="pst-hint">처음 1500점만 보입니다 — 장치 · 방향으로 거르거나 엑셀로 뽑아 보세요</div>' : '') : '<div class="pst-empty sm">IO 점이 없습니다' + (ed ? ' — 위 단추로 16점씩 더하세요 (주소 자동: X000 · Y000 …)' : '') + '</div>');
}

/* ─── 🖵 모니터 연결 ─── */
function _pstMon(t) {
  var M = specTopoMonitors(t), ed = _pstEdit(), dis = ed ? '' : ' disabled';
  if (!M.length) return '<div class="pst-empty sm">모니터가 없습니다 — ' + (ed ? '<b>⚡ 빠른 추가 › 모니터</b> 또는 구성도에서 PC 를 고르고 <b>＋ 아래에 붙이기 › HDMI · DP 포트 › 모니터</b>' : '') + '</div>';
  var rows = M.map(function (r) {
    var id = _pstE(r.n.id);
    return '<tr data-id="' + id + '"><td class="pst-mon">' + (r.port ? '<span class="pst-kd" style="background:' + topoCat(r.port.kind).fill + '">' + topoIconSvg(r.port.kind, 12, '#fff') + ' ' + _pstE(specTopoName(r.port)) + '</span>' + (r.port.port ? '<i> ' + _pstE(r.port.port) + '</i>' : '') : '<span class="pst-warn">영상 포트 없음</span>') + '</td>' +
      '<td>' + (r.adapters.length ? _pstE(r.adapters.join(' → ')) : '<span class="pst-na">—</span>') + '</td>' +
      '<td><input class="pst-in" data-f="cable" data-id="' + id + '" value="' + _pstE(r.n.cable) + '" list="pstCables" placeholder="HDMI"' + dis + '></td>' +
      '<td><input class="pst-in xs" data-f="len" data-id="' + id + '" value="' + _pstE(r.n.len) + '" placeholder="3m"' + dis + '></td>' +
      '<td><input class="pst-in" data-f="port" data-id="' + id + '" value="' + _pstE(r.n.port) + '" placeholder="HDMI 1"' + dis + '></td>' +
      '<td class="pst-mon">' + topoIconSvg('monitor', 14, topoCat('monitor').fill) + '<input class="pst-in" data-f="name" data-id="' + id + '" value="' + _pstE(r.n.name) + '"' + dis + '></td>' +
      '<td><input class="pst-in" data-f="model" data-id="' + id + '" value="' + _pstE(r.n.model) + '" placeholder="제조사 · 모델 · 크기"' + dis + '></td></tr>';
  }).join('');
  return '<div class="pst-tw"><table class="pst-tbl"><thead><tr><th>PC 영상 포트</th><th>변환 잭</th><th>케이블</th><th>길이</th><th>모니터 입력</th><th>모니터</th><th>모델</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="pst-hint">케이블 · 길이는 모니터 바로 위 줄(변환 잭 · 포트)과 잇는 것 — 중간 변환 잭의 케이블은 구성도 · 목록에서 그 장치를 고르고 적으세요.</div>';
}

/* ─── 동작 ─── */
async function _pstClick(e) {
  var g = e.target.closest('.tp-n'); if (g && g.closest('#pstMap')) { PST.sel = g.getAttribute('data-id'); psTopoRender(); return; }
  var b = e.target.closest('[data-pt]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  var k = b.dataset.pt, id = b.dataset.id, t = _ps.sheet.topo ? _pstT() : null;
  if (k !== 'filemenu') { var mm = document.querySelector('#psTopo .pst-menu'); if (mm) mm.hidden = true; }
  if (k === 'view') { PST.view = b.dataset.v; psTopoRender(); return; }
  if (k === 'flt') { PST.filter = b.dataset.v; psTopoRender(); return; }
  if (k === 'ionode') { PST.ioNode = b.dataset.v; psTopoRender(); return; }
  if (k === 'iodir') { PST.ioDir = b.dataset.v; psTopoRender(); return; }
  if (k === 'mode') { PST.mode = b.dataset.v; PST.modeSet = true; PST.zoomSet = false; psTopoRender(); return; }
  if (k === 'imp') return psTopoImport();
  if (k === 'tpl') return psTopoTemplate();
  if (k === 'z') { var v = +b.dataset.v; PST.zoomSet = !!v; if (!v) { var m = document.getElementById('pstMap'), s = m && m.querySelector('svg'); PST.zoom = s ? Math.max(0.3, Math.min(1, (m.clientWidth - 16) / +s.getAttribute('width'))) : 1; } else PST.zoom = Math.max(0.3, Math.min(2.5, Math.round((PST.zoom + v * 0.15) * 100) / 100)); psTopoRender(); return; }
  if (k === 'filemenu') { var mn = b.parentNode.querySelector('.pst-menu'); mn.hidden = !mn.hidden; return; }
  if (k === 'xlsx') return psTopoExportXlsx();
  if (k === 'png' || k === 'svg') return psTopoExportImage(k);
  if (k === 'zoombig') return psTopoZoom();
  if (!_pstEdit()) return;
  if (k === 'seed') { _ps.sheet.topo = specTopoNorm(specTopoSeed(_psCollect(true))); PST.view = 'map'; _pstChanged(); _pstToast('사양 값으로 초안을 만들었습니다 — 💾 저장을 눌러야 반영됩니다', 'success'); return; }
  if (k === 'newpc') { _ps.sheet.topo = { v: 1, nodes: [], io: [] }; var pc = specTopoAdd(_ps.sheet.topo, null, 'pc'); PST.sel = pc.id; _pstChanged(); return; }
  if (!t) return;
  if (k === 'addroot') { var r = specTopoAdd(t, null, 'device'); PST.sel = r && r.id; _pstChanged(); return; }
  if (k === 'foldall') { var on = b.dataset.v === '1'; t.nodes.forEach(function (n) { if (on && specTopoChildren(t, n.id).length && n.kind !== 'pc') n.fold = true; else delete n.fold; }); _pstChanged(); return; }
  if (k === 'up' || k === 'down') { if (specTopoMove(t, id, k === 'up' ? -1 : 1)) _pstChanged(); return; }
  if (k === 'in') { if (specTopoIndent(t, id)) _pstChanged(); else _pstToast('바로 위에 같은 단계의 장치가 있어야 들일 수 있습니다', 'warn'); return; }
  if (k === 'out') { if (specTopoOutdent(t, id)) _pstChanged(); return; }
  if (k === 'fold') { var n = specTopoNode(t, id); if (n) { if (n.fold) delete n.fold; else n.fold = true; _pstChanged(); } return; }
  if (k === 'dup') { var c = specTopoDup(t, id); if (c) { PST.sel = c.id; _pstChanged(); } return; }
  if (k === 'del') {
    var nn = specTopoNode(t, id); if (!nn) return;
    var cnt = (function count(x) { return specTopoChildren(t, x).reduce(function (s, c) { return s + 1 + count(c.id); }, 0); })(id);
    if (!(await wmConfirm('「' + specTopoName(nn) + '」' + (cnt ? '과 그 아래 장치 ' + cnt + '개' : '') + '를 지울까요?'))) return;
    specTopoRemove(t, id); if (PST.sel === id) PST.sel = null; _pstChanged(); return;
  }
  if (k === 'axup' || k === 'axdn') { if (specTopoAxisMove(t, id, k === 'axup' ? -1 : 1)) _pstChanged(); return; }
  if (k === 'ioadd') { var add = specTopoIoAdd(t, id, b.dataset.dir, +b.dataset.n); if (!add.length) _pstToast('IO 는 4000점까지입니다', 'warn'); PST.ioNode = id; _pstChanged(); return; }
  if (k === 'iodel') { t.io = t.io.filter(function (r) { return r.id !== b.dataset.io; }); _pstChanged(); return; }
}
function _pstInput(e) {
  var el = e.target;
  if (el.id === 'pstQ') { PST.q = el.value; clearTimeout(PST.rt); PST.rt = setTimeout(psTopoRender, 220); return; }
  if (!_pstEdit() || !_ps.sheet.topo) return;
  var t = _pstT();
  if (el.dataset.f && el.dataset.id && el.tagName === 'INPUT') {
    var n = specTopoNode(t, el.dataset.id); if (!n) return;
    var f = el.dataset.f;
    if (f === 'ord' || f === 'pts') { var v = el.value === '' ? null : +el.value; if (v == null) delete n[f]; else n[f] = v; }
    else n[f] = el.value;
    _pstChanged(false);
    if (PST.view === 'map') { clearTimeout(PST.rt); PST.rt = setTimeout(function () { var m = document.getElementById('pstMap'); if (!m) return; var sl = m.scrollLeft, st = m.scrollTop; var inner = m.querySelector('.pst-mapin'); inner.innerHTML = _pstSvg(_pstT()); _pstMapAfter(); m.scrollLeft = sl; m.scrollTop = st; }, 250); }   // 그림만 (입력칸은 그대로)
    return;
  }
  if (el.dataset.iof && el.dataset.io && el.tagName === 'INPUT') {
    var r = t.io.filter(function (x) { return x.id === el.dataset.io; })[0]; if (!r) return;
    r[el.dataset.iof] = el.value; _pstChanged(false);
  }
}
function _pstChange(e) {
  var el = e.target;
  if (el.dataset.pt === 'preset' && el.value) {
    if (!_pstEdit()) return;
    if (!_ps.sheet.topo) _ps.sheet.topo = { v: 1, nodes: [], io: [] };
    var t = _pstT(), at = PST.sel && specTopoNode(t, PST.sel), p = TOPO_PRESETS.filter(function (x) { return x.key === el.value; })[0];
    var par = p && p.at === 'any' ? (at ? at.id : null) : (at && at.kind !== 'pc' && topoKind(at.kind).cat !== 'port' ? null : at ? (at.kind === 'pc' ? at.id : at.parent) : null);
    if (p && p.at === 'any' && !at) { _pstToast('먼저 구성도에서 모션 카드 · 컨트롤러를 고르세요', 'warn'); el.value = ''; return; }
    var first = specTopoPreset(t, el.value, par);
    PST.sel = first ? first.id : PST.sel; _pstChanged(); return;
  }
  if (el.dataset.pt === 'addkid' && el.value) {
    if (!_pstEdit()) return;
    var t2 = _pstT(), nn = specTopoAdd(t2, el.dataset.id, el.value);
    if (!nn) { _pstToast('장치는 600개까지입니다', 'warn'); return; }
    var par2 = specTopoNode(t2, el.dataset.id); if (par2) delete par2.fold;
    PST.sel = nn.id; _pstChanged(); return;
  }
  if (!_pstEdit() || !_ps.sheet.topo) return;
  if (el.dataset.f === 'kind' && el.dataset.id) { var n = specTopoNode(_pstT(), el.dataset.id); if (n) { n.kind = el.value; if (n.kind === 'axis' && n.ord == null) n.ord = specTopoAxes(_pstT()).length; _pstChanged(); } return; }
  if (el.dataset.iof === 'dir' && el.dataset.io) { var r = _pstT().io.filter(function (x) { return x.id === el.dataset.io; })[0]; if (r) { r.dir = el.value; _pstChanged(); } return; }
  if (el.dataset.f === 'ord' || el.dataset.f === 'pts') _pstChanged();   // 축 번호를 바꾸면 순서대로 다시 보이게
}

/* ─── 📥 엑셀 · CSV 에서 가져오기 (트리 표) ───
 *   내보낸 엑셀(장치 목록 · 축 순서 · IO 리스트)을 고쳐 다시 넣거나, 손으로 쓴 트리 표(레벨 칸 · 들여쓰기 · 상위 칸)를 읽음 */
function psTopoImport() {
  if (!_pstEdit()) return;
  if (typeof wmLibRetry === 'function' && wmLibRetry('xlsx', psTopoImport, this, arguments)) return;
  if (typeof XLSX === 'undefined') { _pstToast('엑셀 도구를 불러올 수 없습니다', 'error'); return; }
  var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv,.tsv,text/csv';
  inp.onchange = function () {
    var f = inp.files && inp.files[0]; if (!f) return;
    if (f.size > 8 * 1024 * 1024) { _pstToast('8MB 보다 큰 파일은 읽지 않습니다', 'warn'); return; }
    f.arrayBuffer().then(function (ab) {
      var wb = XLSX.read(ab, { type: 'array' }), get = function (re) { var nm = wb.SheetNames.filter(function (n) { return re.test(n); })[0]; return nm ? XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: '', raw: false }) : null; };
      var dev = get(/장치|device|구성|tree|트리/i) || XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
      var r = specTopoFromSheets({ devices: dev, axes: get(/축/) || [], io: get(/^io|io\s*리스트|입출력/i) || [] });
      if (!r.t) { _pstToast(r.warn[0] || '장치를 찾지 못했습니다', 'error'); return; }
      _pstImportPreview(r, f.name);
    }).catch(function (e) { console.error('[topo import]', e); _pstToast('파일을 읽지 못했습니다', 'error'); });
  };
  inp.click();
}
function _pstImportPreview(r, fname) {
  var has = _ps.sheet.topo && _ps.sheet.topo.nodes && _ps.sheet.topo.nodes.length, sel = PST.sel && has ? specTopoNode(_pstT(), PST.sel) : null;
  var flat = specTopoFlat(r.t).slice(0, 40);
  var tree = flat.map(function (x) { var n = x.n, C = topoCat(n.kind); return '<div class="pst-imp-r" style="padding-left:' + (x.depth * 16) + 'px"><span class="pst-kd ic" style="background:' + C.fill + '">' + topoIconSvg(n.kind, 11, '#fff') + '</span><b>' + _pstE(specTopoName(n)) + '</b><i>' + _pstE(topoKind(n.kind).label) + '</i>' + (n.addr ? '<code>' + _pstE(n.addr) + '</code>' : '') + '</div>'; }).join('') + (r.t.nodes.length > 40 ? '<div class="pst-hint">… 외 ' + (r.t.nodes.length - 40) + '개</div>' : '');
  var build = function () {
    var m = createModal({ id: 'psTopoImp', titleText: '📥 장치 구성 가져오기 — ' + fname, width: '640px', closeOnEsc: true,
      html: '<div class="pst-imp"><div class="pst-imp-s">장치 <b>' + r.stat.nodes + '</b>개 · 축 순서 <b>' + r.stat.axes + '</b> · IO <b>' + r.stat.io + '</b>점</div>' +
        (r.warn.length ? '<div class="pst-ck">⚠️ ' + r.warn.map(_pstE).join('<br>⚠️ ') + '</div>' : '') +
        '<div class="pst-imp-t">' + tree + '</div>' +
        '<div class="nt-foot" style="display:flex;gap:6px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">' +
        (has ? '<button type="button" class="pst-b" data-imp="append">' + (sel ? '「' + _pstE(specTopoName(sel)) + '」 아래에 덧붙이기' : '지금 PC 아래에 덧붙이기') + '</button>' : '') +
        '<button type="button" class="pst-b pri" data-imp="replace">' + (has ? '지금 구성을 바꾸기' : '가져오기') + '</button></div>' +
        '<div class="pst-hint">가져온 뒤 💾 저장을 눌러야 반영됩니다 — 마음에 안 들면 저장하지 말고 다시 여세요.</div></div>' });
    m.box.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-imp]'); if (!b) return;
      var mode = b.dataset.imp;
      if (mode === 'replace' && has && !(await wmConfirm('지금 장치 구성(' + _pstT().nodes.length + '개 · IO ' + (_pstT().io || []).length + '점)을 가져온 것으로 바꿀까요?'))) return;
      var out = specTopoMerge(has ? _pstT() : null, r.t, mode, sel && sel.id);
      if (!out) { _pstToast('장치는 600개까지입니다 — 바꾸기로 가져오세요', 'warn'); return; }
      _ps.sheet.topo = out; PST.sel = null; PST.view = 'list'; m.close(); _pstChanged();
      _pstToast('📥 ' + r.stat.nodes + '개를 ' + (mode === 'append' ? '덧붙였습니다' : '가져왔습니다') + ' — 💾 저장을 눌러야 반영됩니다', 'success');
    });
  };
  if (typeof wmGuardedModal === 'function') wmGuardedModal('topoImport', build, 'psTopoImp'); else build();
}
/** 빈 양식 — 예시 줄이 든 엑셀 (레벨 · 종류만 맞추면 됨) */
function psTopoTemplate() {
  if (typeof wmLibRetry === 'function' && wmLibRetry('xlsx', psTopoTemplate, this, arguments)) return;
  if (typeof XLSX === 'undefined') { _pstToast('엑셀 도구를 불러올 수 없습니다', 'error'); return; }
  var wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(specTopoTemplateRows());
  ws['!cols'] = [6, 34, 20, 20, 18, 12, 16, 12, 7, 8, 8, 18, 10].map(function (w) { return { wch: w }; });
  XLSX.utils.book_append_sheet(wb, ws, '장치 목록');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['장치', '방향', '주소', '이름', '설명', '연결 장치'], ['모션 모듈', 'DI', 'X000', '도어 닫힘', '', '도어 센서'], ['모션 모듈', 'DO', 'Y000', '경광등 적색', '', '타워 램프']]), 'IO 리스트');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['쓰는 법'], ['레벨: 0 = PC, 1 = PC 의 포트 · 슬롯, 2 = 그 아래 장치 … (레벨 대신 「계층」 칸에 들여쓰기로 써도 됨)'], ['종류: 장치 목록의 종류 이름 그대로, 또는 비워 두면 이름으로 짐작 (Ethernet · PCIe · 모션 · 드라이브 · 축 · 카메라 · 모니터 …)'], ['주소 · IP · COM: 192.168.0.10 · COM3 처럼'], ['IO 리스트의 「장치」는 장치 목록의 이름과 같게']]), '쓰는 법');
  XLSX.writeFile(wb, '장치구성_가져오기_양식.xlsx');
}

/* ─── 크게 보기 · 파일 ─── */
function psTopoZoom() {
  var t = _ps.sheet.topo ? _pstT() : null; if (!t || !t.nodes.length) return;
  var name = (_ps.proj && _ps.proj.name) || '';
  createModal({ id: 'psTopoZoom', titleText: '🧩 장치 계층 구성 — ' + name, width: '96vw', closeOnEsc: true,
    html: '<div style="overflow:auto;max-height:80vh;background:' + (_pstDark() ? '#0f172a' : '#fff') + ';border-radius:8px;padding:10px">' + _pstSvg(t, { sel: null }) + '</div>' });
}
function _pstFileBase() { var nm = String((_ps.proj && _ps.proj.name) || _ps.projId || '프로젝트').replace(/[\\\/:*?"<>|]/g, '_'), day = typeof localDate === 'function' ? localDate() : new Date().toISOString().slice(0, 10); return '장치구성_' + nm + '_' + day; }
function _pstSave(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000); }
function psTopoExportXlsx() {
  if (typeof wmLibRetry === 'function' && wmLibRetry('xlsx', psTopoExportXlsx, this, arguments)) return;
  if (typeof XLSX === 'undefined') { _pstToast('엑셀 도구를 불러올 수 없습니다', 'error'); return; }
  var t = _pstT(), R = specTopoRows(t), wb = XLSX.utils.book_new();
  function sheet(rows, cols) { var ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = cols.map(function (w) { return { wch: w }; }); return ws; }
  XLSX.utils.book_append_sheet(wb, sheet(R.devices, [34, 18, 12, 22, 24, 14, 18, 14, 8, 44, 30]), '장치 목록');
  XLSX.utils.book_append_sheet(wb, sheet(R.axes, [8, 14, 24, 24, 10, 18, 16, 28]), '축 순서');
  XLSX.utils.book_append_sheet(wb, sheet(R.io, [20, 7, 9, 26, 30, 20]), 'IO 리스트');
  if (R.monitors.length > 1) XLSX.utils.book_append_sheet(wb, sheet(R.monitors, [18, 20, 14, 18, 22, 22, 14]), '모니터 연결');
  var ck = specTopoChecks(t); if (ck.length) XLSX.utils.book_append_sheet(wb, sheet([['확인이 필요한 것']].concat(ck.map(function (c) { return [c]; })), [80]), '확인 필요');
  XLSX.writeFile(wb, _pstFileBase() + '.xlsx');
}
function psTopoExportImage(kind) {
  var t = _pstT(), svg = _pstSvg(t, { sel: null, dark: false });
  svg = svg.replace('<svg ', '<svg style="background:#fff" ');
  if (kind === 'svg') return _pstSave(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: 'image/svg+xml' }), _pstFileBase() + '.svg');
  var w = +(/width="(\d+)"/.exec(svg) || [0, 800])[1], h = +(/height="(\d+)"/.exec(svg) || [0, 600])[1], k = Math.min(3, 6000 / Math.max(w, h));
  var img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.onload = function () {
    var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.scale(k, k); g.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    c.toBlob(function (b) { if (b) _pstSave(b, _pstFileBase() + '.png'); else _pstToast('그림을 만들지 못했습니다', 'error'); }, 'image/png');
  };
  img.onerror = function () { URL.revokeObjectURL(url); _pstToast('그림을 만들지 못했습니다 — SVG 로 받아 보세요', 'error'); };
  img.src = url;
}
document.addEventListener('click', function (e) { if (!e.target.closest('#psTopo .pst-dd')) { var m = document.querySelector('#psTopo .pst-menu'); if (m) m.hidden = true; } });
