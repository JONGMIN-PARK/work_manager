/**
 * 업무 관리자 — 사전검토 (Pre-study)
 * 프로젝트가 되기 "이전" 단계: 업체 문의·기술검토·개선제안·아이디어를 등록하고
 * 브레인스토밍하다가 확정되면 프로젝트/수주로 전환한다.
 *
 * 보기: 칸반(상태별) / 업체별 / 리스트
 * 데이터: prestudyGetAll·prestudyPut·prestudyMove·prestudyConvert·prestudyDel (project-data.js)
 */

var PS_STATUS = [
  { key: 'idea',       label: '아이디어',  icon: '💡', color: '#8B5CF6' },
  { key: 'reviewing',  label: '검토중',    icon: '🔍', color: '#3B82F6' },
  { key: 'discussing', label: '업체협의',  icon: '🤝', color: '#06B6D4' },
  { key: 'proposed',   label: '견적/제안', icon: '📄', color: '#F59E0B' },
  { key: 'won',        label: '확정',      icon: '✅', color: '#10B981' },
  { key: 'hold',       label: '보류',      icon: '⏸',  color: '#94A3B8' },
  { key: 'dropped',    label: '드롭',      icon: '❌', color: '#64748B' }
];
var PS_CAT = {
  inquiry: { label: '문의',     color: '#3B82F6' },
  tech:    { label: '기술검토', color: '#8B5CF6' },
  improve: { label: '개선제안', color: '#10B981' },
  idea:    { label: '아이디어', color: '#F59E0B' },
  quote:   { label: '견적',     color: '#EC4899' }
};
var PS_PRIO = { high: { label: '높음', color: '#EF4444' }, normal: { label: '보통', color: '#F59E0B' }, low: { label: '낮음', color: '#94A3B8' } };

var _psList = [];
var _psView = 'board';   // board | client | list
var _psFilter = { q: '', client: '', mine: false };
var _psModal = null;   // createModal 핸들 ({overlay, box, close})

function _psInfo(key) {
  for (var i = 0; i < PS_STATUS.length; i++) if (PS_STATUS[i].key === key) return PS_STATUS[i];
  return PS_STATUS[0];
}
function _psEsc(v) { return (typeof eH === 'function') ? eH(v == null ? '' : v) : String(v == null ? '' : v); }
function _psToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _psCloseModal() { if (_psModal && _psModal.close) { _psModal.close(); _psModal = null; } }

/* ═══ 진입점 ═══ */
function renderPrestudy() {
  var wrap = document.getElementById('prestudyWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div style="padding:20px;color:var(--t6);font-size:12px">로딩 중...</div>';
  prestudyGetAll({}).then(function (list) {
    _psList = list || [];
    _psRender();
  }).catch(function () {
    wrap.innerHTML = '<div style="padding:20px;color:var(--t6);font-size:12px">사전검토 목록을 불러오지 못했습니다.</div>';
  });
}

function _psFiltered() {
  var q = (_psFilter.q || '').toLowerCase();
  var me = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.sub || currentUser.id) : null;
  return _psList.filter(function (p) {
    if (_psFilter.client && (p.client || '') !== _psFilter.client) return false;
    if (_psFilter.mine && me && p.ownerId !== me) return false;
    if (q) {
      var hay = ((p.title || '') + ' ' + (p.client || '') + ' ' + (p.background || '') + ' ' + (p.notes || '')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}

function _psRender() {
  var wrap = document.getElementById('prestudyWrap');
  if (!wrap) return;
  var items = _psFiltered();

  // ── 툴바 ──
  var clients = {};
  _psList.forEach(function (p) { if (p.client) clients[p.client] = true; });
  var clientOpts = ['<option value="">전체 업체</option>'].concat(
    Object.keys(clients).sort().map(function (c) {
      return '<option value="' + _psEsc(c) + '"' + (_psFilter.client === c ? ' selected' : '') + '>' + _psEsc(c) + '</option>';
    })
  ).join('');

  var viewBtn = function (key, label) {
    var on = _psView === key;
    return '<button class="btn btn-s" style="font-size:11px;' + (on ? 'background:var(--ac);color:#fff' : '') + '" onclick="psSetView(\'' + key + '\')">' + label + '</button>';
  };

  var html = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
    '<h3 style="font-size:14px;font-weight:700;color:var(--t1);margin:0">🔍 사전검토</h3>' +
    '<span style="font-size:11px;color:var(--t5)">' + items.length + '건</span>' +
    '<span style="flex:1"></span>' +
    viewBtn('board', '칸반') + viewBtn('client', '업체별') + viewBtn('list', '목록') +
    '<button class="btn btn-p btn-s" style="font-size:11px" onclick="psOpenModal()">+ 새 검토</button>' +
  '</div>';

  html += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
    '<input id="psQ" placeholder="제목·업체·내용 검색" value="' + _psEsc(_psFilter.q) + '" style="flex:1;min-width:140px;font-size:11px;padding:5px 8px" oninput="psSetQ(this.value)">' +
    '<select class="si" style="font-size:11px;padding:4px" onchange="psSetClient(this.value)">' + clientOpts + '</select>' +
    '<label style="font-size:11px;color:var(--t4);display:flex;align-items:center;gap:4px">' +
      '<input type="checkbox"' + (_psFilter.mine ? ' checked' : '') + ' onchange="psSetMine(this.checked)"> 내 담당' +
    '</label>' +
  '</div>';

  if (_psView === 'board') html += _psBoardHtml(items);
  else if (_psView === 'client') html += _psClientHtml(items);
  else html += _psListHtml(items);

  wrap.innerHTML = html;
}

/* ═══ 칸반 ═══ */
function _psBoardHtml(items) {
  var moveOpts = PS_STATUS.map(function (s) { return s; });
  var html = '<div class="pipeline-board" style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px">';
  PS_STATUS.forEach(function (col) {
    var colItems = items.filter(function (p) { return p.status === col.key; });
    html += '<div style="flex:0 0 190px;min-width:190px">';
    html += '<div style="font-size:11px;font-weight:700;color:' + col.color + ';padding:4px 6px;border-bottom:2px solid ' + col.color + '33;margin-bottom:6px">' +
      col.icon + ' ' + col.label + ' <span style="color:var(--t6)">(' + colItems.length + ')</span></div>';
    if (!colItems.length) {
      html += '<div style="font-size:10px;color:var(--t6);padding:6px">—</div>';
    } else {
      colItems.forEach(function (p) {
        var cat = PS_CAT[p.category] || PS_CAT.inquiry;
        var prio = PS_PRIO[p.priority] || PS_PRIO.normal;
        var selOpts = moveOpts.map(function (s) {
          return '<option value="' + s.key + '"' + (s.key === p.status ? ' selected' : '') + '>' + s.label + '</option>';
        }).join('');
        html += '<div style="border:1px solid var(--bd);border-radius:6px;padding:7px;margin-bottom:6px;background:var(--bg-i)">' +
          '<div style="font-size:11px;font-weight:600;color:var(--t2);cursor:pointer;word-break:break-word;margin-bottom:3px" onclick="psOpenModal(\'' + _psEsc(p.id) + '\')">' + _psEsc(p.title) + '</div>' +
          (p.client ? '<div style="font-size:10px;color:var(--t4);margin-bottom:3px">🏢 ' + _psEsc(p.client) + '</div>' : '') +
          '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
            '<span class="badge" style="background:' + cat.color + '22;color:' + cat.color + ';font-size:8px;padding:1px 4px">' + cat.label + '</span>' +
            '<span style="font-size:9px;color:' + prio.color + '">●</span>' +
            (p.dueDate ? '<span style="font-size:9px;color:var(--t5)">~' + _psEsc(p.dueDate) + '</span>' : '') +
          '</div>' +
          '<select class="si" style="font-size:9px;padding:1px 2px;margin-top:4px;width:100%" onchange="psMove(\'' + _psEsc(p.id) + '\',this.value)">' + selOpts + '</select>' +
        '</div>';
      });
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

/* ═══ 업체별 ═══ */
function _psClientHtml(items) {
  var byClient = {};
  items.forEach(function (p) {
    var c = p.client || '(업체 미지정)';
    (byClient[c] = byClient[c] || []).push(p);
  });
  var keys = Object.keys(byClient).sort(function (a, b) { return byClient[b].length - byClient[a].length; });
  if (!keys.length) return '<div style="font-size:12px;color:var(--t6);padding:16px">해당 조건의 검토 건이 없습니다.</div>';

  var html = '';
  keys.forEach(function (c) {
    var list = byClient[c];
    var openCnt = list.filter(function (p) { return p.status !== 'won' && p.status !== 'dropped'; }).length;
    var wonCnt = list.filter(function (p) { return p.status === 'won'; }).length;
    html += '<div style="border:1px solid var(--bd);border-radius:8px;padding:10px;margin-bottom:10px">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
        '<span style="font-size:13px;font-weight:700;color:var(--t1)">🏢 ' + _psEsc(c) + '</span>' +
        '<span style="font-size:10px;color:var(--t5)">진행 ' + openCnt + ' · 확정 ' + wonCnt + ' / 전체 ' + list.length + '</span>' +
      '</div>';
    list.forEach(function (p) {
      var st = _psInfo(p.status);
      var cat = PS_CAT[p.category] || PS_CAT.inquiry;
      html += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--bd)">' +
        '<span style="font-size:11px">' + st.icon + '</span>' +
        '<span style="flex:1;font-size:11px;color:var(--t2);cursor:pointer;word-break:break-word" onclick="psOpenModal(\'' + _psEsc(p.id) + '\')">' + _psEsc(p.title) + '</span>' +
        '<span class="badge" style="background:' + cat.color + '22;color:' + cat.color + ';font-size:8px;padding:1px 4px">' + cat.label + '</span>' +
        (p.dueDate ? '<span style="font-size:9px;color:var(--t5)">~' + _psEsc(p.dueDate) + '</span>' : '') +
        '<span class="badge" style="background:' + st.color + '22;color:' + st.color + ';font-size:8px;padding:1px 4px">' + st.label + '</span>' +
      '</div>';
    });
    html += '</div>';
  });
  return html;
}

/* ═══ 목록 ═══ */
function _psListHtml(items) {
  if (!items.length) return '<div style="font-size:12px;color:var(--t6);padding:16px">해당 조건의 검토 건이 없습니다.</div>';
  var html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">' +
    '<thead><tr style="color:var(--t5);font-size:10px;text-align:left">' +
    '<th style="padding:5px">상태</th><th style="padding:5px">업체</th><th style="padding:5px">제목</th>' +
    '<th style="padding:5px">유형</th><th style="padding:5px">기한</th><th style="padding:5px">전환</th></tr></thead><tbody>';
  items.forEach(function (p) {
    var st = _psInfo(p.status);
    var cat = PS_CAT[p.category] || PS_CAT.inquiry;
    var linked = p.linkedProjectId ? '프로젝트' : (p.linkedOrderNo ? '수주 ' + _psEsc(p.linkedOrderNo) : '-');
    html += '<tr style="border-bottom:1px solid var(--bd)">' +
      '<td style="padding:5px"><span class="badge" style="background:' + st.color + '22;color:' + st.color + ';font-size:8px;padding:1px 4px">' + st.icon + ' ' + st.label + '</span></td>' +
      '<td style="padding:5px;color:var(--t3)">' + _psEsc(p.client || '-') + '</td>' +
      '<td style="padding:5px;color:var(--t2);cursor:pointer" onclick="psOpenModal(\'' + _psEsc(p.id) + '\')">' + _psEsc(p.title) + '</td>' +
      '<td style="padding:5px;color:' + cat.color + '">' + cat.label + '</td>' +
      '<td style="padding:5px;color:var(--t5)">' + _psEsc(p.dueDate || '-') + '</td>' +
      '<td style="padding:5px;color:var(--t5)">' + linked + '</td>' +
    '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

/* ═══ 필터/뷰 ═══ */
function psSetView(v) { _psView = v; _psRender(); }
function psSetClient(c) { _psFilter.client = c; _psRender(); }
function psSetMine(b) { _psFilter.mine = !!b; _psRender(); }
var _psQTimer = null;
function psSetQ(v) {
  _psFilter.q = v;
  clearTimeout(_psQTimer);
  _psQTimer = setTimeout(function () {
    _psRender();
    var el = document.getElementById('psQ');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, 250);
}

/* ═══ 상세/편집 모달 ═══ */
function psOpenModal(id) {
  var p = id ? _psList.filter(function (x) { return x.id === id; })[0] : null;
  var isNew = !p;
  p = p || { title: '', client: '', category: 'inquiry', status: 'idea', priority: 'normal', background: '', notes: '', conclusion: '', dueDate: '' };

  var catOpts = Object.keys(PS_CAT).map(function (k) {
    return '<option value="' + k + '"' + (p.category === k ? ' selected' : '') + '>' + PS_CAT[k].label + '</option>';
  }).join('');
  var stOpts = PS_STATUS.map(function (s) {
    return '<option value="' + s.key + '"' + (p.status === s.key ? ' selected' : '') + '>' + s.icon + ' ' + s.label + '</option>';
  }).join('');
  var prioOpts = Object.keys(PS_PRIO).map(function (k) {
    return '<option value="' + k + '"' + (p.priority === k ? ' selected' : '') + '>' + PS_PRIO[k].label + '</option>';
  }).join('');

  var lbl = 'font-size:10px;color:var(--t5);margin:8px 0 2px';
  var inp = 'width:100%;font-size:12px;padding:5px 7px';
  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<div><div style="' + lbl + '">제목 *</div><input id="psmTitle" value="' + _psEsc(p.title) + '" style="' + inp + '"></div>' +
      '<div><div style="' + lbl + '">업체</div><input id="psmClient" value="' + _psEsc(p.client) + '" style="' + inp + '" placeholder="업체명"></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">' +
      '<div><div style="' + lbl + '">유형</div><select id="psmCat" class="si" style="' + inp + '">' + catOpts + '</select></div>' +
      '<div><div style="' + lbl + '">상태</div><select id="psmStatus" class="si" style="' + inp + '">' + stOpts + '</select></div>' +
      '<div><div style="' + lbl + '">우선순위</div><select id="psmPrio" class="si" style="' + inp + '">' + prioOpts + '</select></div>' +
      '<div><div style="' + lbl + '">회신기한</div><input id="psmDue" type="date" value="' + _psEsc(p.dueDate || '') + '" style="' + inp + '"></div>' +
    '</div>' +
    '<div><div style="' + lbl + '">배경 / 요구사항</div><textarea id="psmBg" style="' + inp + ';min-height:52px;resize:vertical">' + _psEsc(p.background) + '</textarea></div>' +
    '<div><div style="' + lbl + '">브레인스토밍 노트</div><textarea id="psmNotes" style="' + inp + ';min-height:88px;resize:vertical" placeholder="자유롭게 아이디어·검토 내용을 적어두세요. **굵게** - [ ] 체크박스 지원">' + _psEsc(p.notes) + '</textarea></div>' +
    '<div><div style="' + lbl + '">결론</div><textarea id="psmConc" style="' + inp + ';min-height:44px;resize:vertical">' + _psEsc(p.conclusion) + '</textarea></div>';

  if (!isNew) {
    var linkInfo = p.linkedProjectId ? '✅ 프로젝트로 전환됨' : (p.linkedOrderNo ? '✅ 수주(' + _psEsc(p.linkedOrderNo) + ')로 전환됨' : '');
    html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--bd)">' +
      (linkInfo
        ? '<div style="font-size:11px;color:#10B981">' + linkInfo + '</div>'
        : '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
            '<span style="font-size:10px;color:var(--t5)">확정되면 전환:</span>' +
            '<button class="btn btn-g btn-s" style="font-size:10px" onclick="psConvert(\'' + _psEsc(p.id) + '\',\'project\')">📁 프로젝트로</button>' +
            '<button class="btn btn-g btn-s" style="font-size:10px" onclick="psConvert(\'' + _psEsc(p.id) + '\',\'order\')">📋 수주로</button>' +
          '</div>') +
    '</div>';
    html += '<div id="psmComments" style="margin-top:12px"></div>';
  }

  html += '<div style="display:flex;gap:6px;margin-top:14px">' +
    '<button class="btn btn-p btn-s" onclick="psSave(' + (isNew ? 'null' : '\'' + _psEsc(p.id) + '\'') + ')">💾 저장</button>' +
    (isNew ? '' : '<button class="btn btn-d btn-s" onclick="psDelete(\'' + _psEsc(p.id) + '\')">🗑 삭제</button>') +
  '</div>';

  if (typeof createModal !== 'function') { _psToast('모달을 열 수 없습니다.', 'error'); return; }
  _psModal = createModal({ title: isNew ? '새 사전검토' : '사전검토 상세', html: html, width: '640px' });
  // 코멘트 스레드 (기존 모듈 재사용)
  if (!isNew && typeof renderCommentThread === 'function') {
    renderCommentThread('prestudy', p.id, 'psmComments');
  }
}

function psSave(id) {
  var g = function (i) { var el = document.getElementById(i); return el ? el.value : ''; };
  var title = (g('psmTitle') || '').trim();
  if (!title) { _psToast('제목을 입력하세요.', 'warn'); return; }
  var payload = {
    title: title,
    client: (g('psmClient') || '').trim(),
    category: g('psmCat'), status: g('psmStatus'), priority: g('psmPrio'),
    dueDate: g('psmDue') || null,
    background: g('psmBg'), notes: g('psmNotes'), conclusion: g('psmConc')
  };
  if (id) payload.id = id;
  prestudyPut(payload).then(function () {
    _psToast('저장되었습니다.', 'success');
    _psCloseModal();
    renderPrestudy();
  }).catch(function () { _psToast('저장 실패', 'error'); });
}

function psMove(id, status) {
  prestudyMove(id, status).then(function () { renderPrestudy(); })
    .catch(function () { _psToast('상태 변경 실패', 'error'); });
}

function psDelete(id) {
  if (!confirm('이 사전검토를 삭제할까요?')) return;
  prestudyDel(id).then(function () {
    _psCloseModal();
    renderPrestudy();
  });
}

function psConvert(id, target) {
  var orderNo = null;
  if (target === 'order') {
    var no = prompt('생성할 수주번호를 입력하세요. (예: B2026-001)');
    if (!no || !no.trim()) return;
    orderNo = no.trim();
  } else if (!confirm('이 검토 건을 프로젝트로 전환할까요?')) {
    return;
  }
  prestudyConvert(id, target, orderNo).then(function () {
    _psToast(target === 'order' ? '수주로 전환되었습니다.' : '프로젝트로 전환되었습니다.', 'success');
    _psCloseModal();
    renderPrestudy();
  }).catch(function (e) {
    _psToast('전환 실패: ' + ((e && e.message) || ''), 'error');
  });
}
