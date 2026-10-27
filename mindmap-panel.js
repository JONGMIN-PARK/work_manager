/**
 * 업무 관리자 — 🧠 마인드맵 속성 패널 · 아웃라인 · 내보내기
 * 선택 주제 속성(글 · 내용 줄 · 앱 데이터 연결 · 구조 · 관계 · 색 · 마커 · 라벨 · 작업 정보 · 링크 · 노트),
 * 아웃라인 보기(목록 편집), Markdown · PNG 내보내기.
 * 의존(전역): mindmap.js, mindmap-edit.js, mindmap-media.js · mindmap-keys.js(있으면)
 */

/* ═══ 속성 패널 ═══ */
function _mmPaintPanel() {
  var pn = _mmEl('mmPanel');
  if (!pn || !_mm.doc) return;
  var f = _mmSelInfo();
  if (!f) { pn.innerHTML = ''; return; }
  if (_mm.multi.length > 1 && typeof mmMultiPanelHtml === 'function') {
    pn.removeAttribute('data-sel');
    pn.innerHTML = mmMultiPanelHtml();
    return;
  }
  // 같은 주제의 입력칸을 쓰는 중이면 다시 그리지 않음 (Tab 으로 다음 칸 이동 시 포커스 유지)
  var ae = document.activeElement;
  // (체크박스는 켜면 딸린 입력칸이 나타나야 하므로 다시 그림)
  var typing = ae && pn.contains(ae) && (ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || (ae.tagName === 'INPUT' && !/^(checkbox|radio)$/.test(ae.type)));
  if (typing && pn.getAttribute('data-sel') === f.node.id) return;
  pn.setAttribute('data-sel', f.node.id);
  var n = f.node;
  var ro = _mm.readOnly ? ' disabled' : '';
  var pri = '';
  (n.markers || []).forEach(function (m) { var x = /^priority-(\d)$/.exec(m); if (x) pri = x[1]; });
  var h = '<div class="mm-pn-sec"><div class="mm-pn-h">' + (f.depth === 0 ? '중심 주제' : f.depth === 1 ? '주요 주제' : '하위 주제') + '</div>' +
    '<textarea id="mmPnText" class="mm-input mm-pn-text" rows="3"' + ro + '>' + _mmEsc(n.text || '') + '</textarea></div>';
  if (typeof _mmBlocksPanelHtml === 'function') h += _mmBlocksPanelHtml(n, ro);
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">색상</div><div class="mm-swatches">' + MM_COLORS.map(function (c) {
    return '<button class="mm-sw' + ((n.color || '') === c.key ? ' on' : '') + '" data-act="color" data-v="' + c.key + '" title="' + (c.label || c.key) + '"' + ro +
      ' style="' + (c.c ? 'background:' + c.c : '') + '">' + (c.c ? '' : 'A') + '</button>';
  }).join('') + '</div></div>';
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">우선순위 <span class="mm-hint">Alt+1~9</span></div><div class="mm-swatches">' +
    '<button class="mm-mkbtn' + (!pri ? ' on' : '') + '" data-act="priority" data-v=""' + ro + '>—</button>' +
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) { return '<button class="mm-mkbtn' + (pri === String(i) ? ' on' : '') + '" data-act="priority" data-v="' + i + '"' + ro + '><span class="mm-pri mm-pri' + i + '">' + i + '</span></button>'; }).join('') +
    '</div></div>';
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">마커</div>' + _mmSymbolGroupsHtml(function (s) {
    var on = (n.markers || []).indexOf(s.k) >= 0;
    return '<button class="mm-mkbtn' + (on ? ' on' : '') + '" data-act="symbol" data-v="' + s.k + '" title="' + s.l + '"' + ro + '>' + s.g + '</button>';
  }) + '</div>';
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">라벨 <span class="mm-hint">쉼표로 구분</span></div>' +
    '<input id="mmPnLabels" class="mm-input" value="' + _mmEsc((n.labels || []).join(', ')) + '"' + ro + '></div>';
  var members = _mm.members || [];
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">작업 정보</div>' +
    '<label class="mm-pn-row">담당<input id="mmPnAssignee" class="mm-input" list="mmPnMembers" autocomplete="off" placeholder="고르거나 이름 입력" value="' + _mmEsc(_mmAssigneeName(n)) + '"' + ro + '></label>' +
    '<datalist id="mmPnMembers">' + members.map(function (u) { return '<option value="' + _mmEsc(u.name) + '">'; }).join('') + '</datalist>' +
    '<label class="mm-pn-row">시작<input type="date" id="mmPnStart" class="mm-input" value="' + _mmEsc(n.startDate || '') + '"' + ro + '></label>' +
    '<label class="mm-pn-row">마감<input type="date" id="mmPnDue" class="mm-input" value="' + _mmEsc(n.dueDate || '') + '"' + ro + '></label>' +
    '<label class="mm-pn-row">진행률<input type="number" min="0" max="100" step="5" id="mmPnProg" class="mm-input" placeholder="' + (_mm.prog && _mm.prog[n.id] && !_mm.prog[n.id].own ? '하위 평균 ' + _mm.prog[n.id].p : '') + '%" value="' + (n.progress != null ? _mmEsc(n.progress) : '') + '"' + ro + '></label>' +
    (_mm.readOnly ? '' : '<div class="mm-swatches mm-pg-quick">' + [0, 25, 50, 75, 100].map(function (v) {
      return '<button class="mm-mkbtn' + (String(n.progress) === String(v) ? ' on' : '') + '" data-act="prog" data-v="' + v + '">' + v + '</button>';
    }).join('') + '<button class="mm-mkbtn" data-act="prog" data-v="" title="직접 값 지우기 (하위 평균 사용)">—</button></div>') +
    '<label class="mm-pn-chk"><input type="checkbox" id="mmPnDone"' + (n.done ? ' checked' : '') + ro + '> 완료</label></div>';
  // 앱 데이터 연결 · 승격
  var ri = n.ref ? (MM_REF_TYPES[n.ref.type] || { i: '🔗', l: '항목' }) : null;
  var rr = n.ref ? _mm.refs[n.ref.type + ':' + n.ref.id] : null;
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">앱 데이터 연결</div>' + (n.ref
    ? '<div class="mm-pn-ref">' + ri.i + ' ' + ri.l + ' · <b>' + _mmEsc(rr && rr.title ? rr.title : (rr && rr.locked ? '볼 권한 없음' : rr && rr.missing ? '삭제됨' : '…')) + '</b></div>' +
      '<div class="mm-swatches"><button class="btn btn-g btn-s" data-act="ref-open">열기</button>' + (_mm.readOnly ? '' : '<button class="btn btn-g btn-s" data-act="ref-unlink">연결 해제</button>') + '</div>'
    : (_mm.readOnly ? '<div class="mm-hint">연결 없음</div>' :
      '<div class="mm-swatches"><button class="btn btn-g btn-s" data-act="link-ref">🔗 연결…</button>' +
      '<button class="btn btn-g btn-s" data-act="promote" data-kind="milestone" title="이 주제로 마일스톤 만들기">⤴ 마일스톤</button>' +
      '<button class="btn btn-g btn-s" data-act="promote" data-kind="issue" title="이 주제로 이슈 만들기">⤴ 이슈</button></div>')) + '</div>';
  // 구조: 경계 · 요약 · 번호
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">구조</div>' +
    '<label class="mm-pn-chk"><input type="checkbox" id="mmPnBd"' + (n.boundary ? ' checked' : '') + ro + '> 경계 (이 가지 묶기)</label>' +
    (n.boundary ? '<input id="mmPnBdTitle" class="mm-input" placeholder="경계 제목 (선택)" value="' + _mmEsc(n.boundary.title || '') + '"' + ro + '>' : '') +
    ((n.children || []).length ? '<label class="mm-pn-chk"><input type="checkbox" id="mmPnSum"' + (n.summary ? ' checked' : '') + ro + '> 요약 (하위 묶음 옆 중괄호)</label>' +
      (n.summary ? '<div class="mm-pn-row"><input id="mmPnSumText" class="mm-input" placeholder="요약 내용" value="' + _mmEsc(n.summary.text || '') + '"' + ro + '>' +
        (!_mm.readOnly && _mm.aiReady ? '<button class="btn btn-g btn-s" data-act="ai-summary" title="AI 로 요약 쓰기">✨</button>' : '') + '</div>' : '') +
      '<label class="mm-pn-chk"><input type="checkbox" id="mmPnNum"' + (n.numbering ? ' checked' : '') + ro + '> 하위 번호 매기기 (1 · 1.1)</label>' +
      '<label class="mm-pn-chk" title="Alt+G — 중심 주제에 켜면 맵 전체"><input type="checkbox" id="mmPnAlign"' + (n.alignLevels ? ' checked' : '') + ro + '> ' +
        (f.depth === 0 ? '같은 단계 맞춤 (맵 전체)' : '하위 같은 단계 맞춤') + ' <span class="mm-hint">폭은 가장 넓은 주제 기준</span></label>' : '') +
    '</div>';
  // 관계
  var rels = (_mmSheet().relations || []).filter(function (r) { return r.from === n.id || r.to === n.id; });
  if (rels.length) {
    h += '<div class="mm-pn-sec"><div class="mm-pn-h">관계</div>' + rels.map(function (r) {
      var other = mmFind(_mmRoot(), r.from === n.id ? r.to : r.from);
      return '<div class="mm-pn-row"><span class="mm-hint">' + (r.from === n.id ? '→' : '←') + ' ' + _mmEsc(other ? (other.node.text || '(빈 주제)').slice(0, 16) : '?') + '</span>' +
        '<input class="mm-input mm-rel-in" data-rel-label="' + _mmEsc(r.id) + '" placeholder="관계 설명" value="' + _mmEsc(r.label || '') + '"' + ro + '>' +
        (_mm.readOnly ? '' : '<button class="btn btn-g btn-s" data-act="rel-del" data-rel="' + _mmEsc(r.id) + '" title="관계 삭제">×</button>') + '</div>';
    }).join('') + '</div>';
  }
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">링크</div><input id="mmPnLink" class="mm-input" placeholder="https://" value="' + _mmEsc(n.link || '') + '"' + ro + '></div>';
  h += '<div class="mm-pn-sec"><div class="mm-pn-h">노트</div><textarea id="mmPnNote" class="mm-input" rows="5"' + ro + '>' + _mmEsc(n.note || '') + '</textarea></div>';
  pn.innerHTML = h;
  if (typeof _mmBindBlocksPanel === 'function') _mmBindBlocksPanel(pn, n);
  if (_mm.readOnly) return;
  function bind(id, fn) { var el = _mmEl(id); if (el) el.onchange = function () { fn(el); }; }
  bind('mmPnText', function (el) { var v = el.value.replace(/\s+$/, ''); if (v !== (n.text || '')) _mmSetProp('text', v); });
  bind('mmPnLabels', function (el) {
    var arr = el.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 10);
    _mmSetProp('labels', arr);
  });
  // 담당: 사용자 목록 이름과 같으면 그 사용자, 아니면 입력한 이름 그대로 (외부 인원 · 업체 등)
  bind('mmPnAssignee', function (el) {
    var v = el.value.trim().slice(0, 60);
    var u = (_mm.members || []).filter(function (m) { return m.name === v; })[0];
    var f = _mmSelInfo();
    if (!f) return;
    _mmMutate(function () {
      delete f.node.assigneeId; delete f.node.assigneeName;
      if (u) f.node.assigneeId = u.id; else if (v) f.node.assigneeName = v;
    });
  });
  bind('mmPnStart', function (el) { _mmSetProp('startDate', el.value || null); });
  bind('mmPnDue', function (el) { _mmSetProp('dueDate', el.value || null); });
  bind('mmPnProg', function (el) {
    var v = el.value === '' ? null : Math.max(0, Math.min(100, parseInt(el.value, 10) || 0));
    _mmSetProp('progress', v);
  });
  bind('mmPnDone', function (el) { _mmSetProp('done', el.checked); });
  bind('mmPnLink', function (el) {
    var v = el.value.trim();
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    _mmSetProp('link', v);
  });
  bind('mmPnNote', function (el) { _mmSetProp('note', el.value.replace(/\s+$/, '')); });
  bind('mmPnBd', function (el) { _mmSetProp('boundary', el.checked ? { title: '' } : null); });
  bind('mmPnBdTitle', function (el) { _mmSetProp('boundary', { title: el.value.trim().slice(0, 100) }); });
  bind('mmPnSum', function (el) { _mmSetProp('summary', el.checked ? { text: '요약' } : null); });
  bind('mmPnSumText', function (el) { _mmSetProp('summary', { text: el.value.trim().slice(0, 200) || '요약' }); });
  bind('mmPnNum', function (el) { _mmSetProp('numbering', el.checked); });
  bind('mmPnAlign', function (el) { _mmSetProp('alignLevels', el.checked); });
  pn.querySelectorAll('.mm-rel-in').forEach(function (inp) {
    inp.onchange = function () {
      var id = inp.getAttribute('data-rel-label');
      _mmMutate(function () {
        (_mmSheet().relations || []).forEach(function (r) { if (r.id === id) r.label = inp.value.trim().slice(0, 100); });
      });
    };
  });
  // 패널 입력 중 단축키가 캔버스로 가지 않게
  pn.onkeydown = function (e) { e.stopPropagation(); if (e.key === 'Escape') _mmFocusCanvas(); };
}

/* ═══ 아웃라인 보기 ═══ */
/** 맵 ↔ 아웃라인 (보기 전환은 mindmap-gantt.js _mmSetView) */
function _mmSetOutline(on) { _mmSetView(on ? 'outline' : 'map'); }

function _mmPaintOutline(focusId) {
  var ol = _mmEl('mmOutline');
  if (!ol || !_mm.doc) return;
  var rows = [];
  mmWalk(_mmRoot(), function (n, parent, depth) {
    var kids = (n.children || []).length;
    rows.push('<div class="mm-ol-row' + (depth === 0 ? ' mm-ol-root' : '') + (n.done ? ' mm-done' : '') + '" style="padding-left:' + (depth * 22 + 6) + 'px">' +
      '<span class="mm-ol-tog" data-tog="' + _mmEsc(n.id) + '">' + (kids ? (n.collapsed ? '▸' : '▾') : '•') + '</span>' +
      '<input class="mm-ol-in" data-id="' + _mmEsc(n.id) + '" value="' + _mmEsc(n.text || '') + '"' + (_mm.readOnly ? ' readonly' : '') + '>' +
      (n.collapsed && kids ? '<span class="mm-hint">+' + kids + '</span>' : '') + '</div>');
    if (n.collapsed) return false;
  });
  ol.innerHTML = '<div class="mm-sub" style="margin-bottom:8px">Enter 새 줄 · Tab 들여쓰기 · Shift+Tab 내어쓰기 · 빈 줄에서 Backspace 삭제 · ↑↓ 이동</div>' + rows.join('');
  ol.onclick = function (e) {
    var tg = e.target.closest('[data-tog]');
    if (!tg) return;
    var f = mmFind(_mmRoot(), tg.getAttribute('data-tog'));
    if (!f || !(f.node.children || []).length) return;
    if (_mm.readOnly) f.node.collapsed = !f.node.collapsed;
    else _mmMutate(function () { f.node.collapsed = !f.node.collapsed; }, { paint: false });
    _mmPaintOutline(f.node.id);
  };
  ol.oninput = function (e) {
    var inp = e.target;
    if (!inp.classList.contains('mm-ol-in') || _mm.readOnly) return;
    var f = mmFind(_mmRoot(), inp.getAttribute('data-id'));
    if (!f) return;
    f.node.text = inp.value;
    _mmMarkDirty();
  };
  ol.onfocusin = function (e) {
    var inp = e.target;
    if (!inp.classList || !inp.classList.contains('mm-ol-in')) return;
    _mm.sel = inp.getAttribute('data-id');
    // 한 줄 편집을 시작할 때 되돌리기 지점 하나
    if (!_mm.readOnly) { _mm.undo.push(_mmSnapshot()); if (_mm.undo.length > 50) _mm.undo.shift(); _mm.redo = []; }
  };
  ol.onkeydown = function (e) {
    var inp = e.target;
    if (!inp.classList.contains('mm-ol-in') || e.isComposing || e.keyCode === 229) return;
    var id = inp.getAttribute('data-id');
    var root = _mmRoot();
    var f = mmFind(root, id);
    if (!f) return;
    var ins = Array.prototype.slice.call(ol.querySelectorAll('.mm-ol-in'));
    var idx = ins.indexOf(inp);
    var focusTo = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      var t = ins[idx + (e.key === 'ArrowUp' ? -1 : 1)];
      if (t) t.focus();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'y')) { e.preventDefault(); if (e.key === 'z' && !e.shiftKey) mmUndo(); else mmRedo(); _mmPaintOutline(_mm.sel); return; }
    if (_mm.readOnly) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      var nn = mmNewNode('');
      _mmMutate(function () {
        if (!f.parent) { f.node.collapsed = false; f.node.children.unshift(nn); }
        else if ((f.node.children || []).length && !f.node.collapsed) f.node.children.unshift(nn);
        else f.parent.children.splice(f.index + 1, 0, nn);
      }, { paint: false });
      focusTo = nn.id;
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (!f.parent || f.index === 0) return;
      var prev = f.parent.children[f.index - 1];
      _mmMutate(function () { prev.collapsed = false; mmMoveNode(root, id, prev.id); }, { paint: false });
      focusTo = id;
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (!f.parent || f.parent === root) return;
      var gp = mmFind(root, f.parent.id);
      _mmMutate(function () { mmMoveNode(root, id, gp.parent.id, gp.index + 1); }, { paint: false });
      focusTo = id;
    } else if (e.key === 'Backspace' && inp.value === '' && f.parent) {
      e.preventDefault();
      var prevIn = ins[idx - 1];
      var prevId = prevIn ? prevIn.getAttribute('data-id') : f.parent.id;
      _mmMutate(function () {
        // 하위가 있으면 부모 쪽으로 끌어올린 뒤 삭제
        var kids = f.node.children || [];
        f.parent.children.splice.apply(f.parent.children, [f.index, 1].concat(kids));
      }, { paint: false });
      focusTo = prevId;
    } else return;
    _mmPaintOutline(focusTo);
  };
  if (focusId) {
    var el = ol.querySelector('.mm-ol-in[data-id="' + (window.CSS && CSS.escape ? CSS.escape(focusId) : focusId) + '"]');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
}

/* ═══ 내보내기 ═══ */
function mmExportMarkdown() {
  if (!_mm.doc) return;
  var md = mmToMarkdown(_mmRoot());
  _mmDownload(_mmFileName(_mm.row.title) + '.md', new Blob([md], { type: 'text/markdown;charset=utf-8' }));
}

function mmExportPng() {
  if (typeof html2canvas !== 'function') { _mmToast('이미지 모듈을 불러오지 못했습니다', 'error'); return; }
  var stage = _mmEl('mmStage');
  if (!stage || !_mm.layout) return;
  if (_mm.outline || _mm.gantt) _mmSetView('map');
  var b = _mm.layout.bounds;
  var pad = 40;
  var w = Math.ceil(b.maxX - b.minX + pad * 2), h = Math.ceil(b.maxY - b.minY + pad * 2);
  var bg = getComputedStyle(_mmEl('mmCanvas')).backgroundColor || getComputedStyle(document.body).backgroundColor;
  var box = document.createElement('div');
  box.className = 'mm-export-box';
  box.style.cssText = 'position:fixed;left:-100000px;top:0;width:' + w + 'px;height:' + h + 'px;overflow:hidden;background:' + bg;
  var clone = stage.cloneNode(true);
  clone.removeAttribute('id');
  clone.style.transform = 'translate(' + (pad - b.minX) + 'px,' + (pad - b.minY) + 'px)';
  clone.querySelectorAll('.mm-sel,.mm-hit,.mm-multi,.mm-rel-from').forEach(function (x) { x.classList.remove('mm-sel', 'mm-hit', 'mm-multi', 'mm-rel-from'); });
  clone.querySelectorAll('.mm-inline').forEach(function (x) { x.remove(); });
  box.appendChild(clone);
  document.body.appendChild(box);
  var scale = Math.min(2, 8000 / Math.max(w, h));
  _mmToast('이미지 만드는 중…');
  html2canvas(box, { backgroundColor: bg, scale: scale, logging: false }).then(function (canvas) {
    canvas.toBlob(function (blob) { if (blob) _mmDownload(_mmFileName(_mm.row.title) + '.png', blob); }, 'image/png');
  }).catch(function (e) { _mmToast('❌ 이미지 만들기 실패 — ' + _mmErr(e), 'error'); })
    .then(function () { box.remove(); });
}
