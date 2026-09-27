/**
 * A/S 관리 — 목록 화면 (분할 2/7)
 * renderAS(메인 렌더·목록 캐시) · 요약 카드 · 필터 셀렉트 · 검색 디바운스
 * 칸반 보드 렌더 + 드래그앤드롭(_asRenderKanban/_asAttachKanbanDnD)
 * (원래 as-manager.js 에서 순수 이동 — 동작 변화 없음)
 */

/* ═══ 메인 렌더링 ═══
 * opts.useCache: 검색·필터 변경처럼 클라이언트 필터만 바뀌는 경우 직전 조회 결과(같은 보기 모드)를 재사용.
 * 변경(저장·삭제·상태이동) 후에는 renderAS()로 재조회. */
var _asListCache = null;   // { key: asViewMode, rows: [...] }
var _asRenderSeq = 0;      // 느린 이전 응답이 새 렌더를 덮어쓰지 않도록
function renderAS(opts) {
  var wrap = document.getElementById('asWrap');
  if (!wrap) return Promise.resolve();

  // 통계 모드는 별도 모듈에 위임
  if (asViewMode === 'stats') {
    ++_asRenderSeq;   // 진행 중인 목록 조회가 통계 화면을 덮어쓰지 않도록
    if (typeof renderASStats === 'function') {
      renderASStats();
      return;
    }
    wrap.innerHTML = '<div class="pnl" style="padding:24px;text-align:center;color:#EF4444">as-stats.js 모듈 로드 실패</div>';
    return;
  }

  var STATUS = typeof AS_STATUS !== 'undefined' ? AS_STATUS : {};
  var PRIO   = typeof AS_PRIORITY !== 'undefined' ? AS_PRIORITY : {};

  if (typeof asGetAll !== 'function') {
    wrap.innerHTML = '<div class="pnl" style="padding:24px;text-align:center;color:var(--t5)">A/S 데이터 로직 로드 실패 (project-data.js)</div>';
    return;
  }

  var listParams = null;
  if (asViewMode === 'myqueue') listParams = { myQueue: 1 };
  else if (asViewMode === 'trash') listParams = { trashed: 1 };

  var seq = ++_asRenderSeq;
  var cacheKey = asViewMode;
  var pData;
  if (opts && opts.useCache && _asListCache && _asListCache.key === cacheKey) {
    pData = Promise.all([_asListCache.rows, _asLoadCats()]);
  } else {
    // 휴지통 카운트는 항상 별도 조회 (배지 표시용, 가벼움)
    var pTrashCount = (asViewMode !== 'trash')
      ? asGetAll({ trashed: 1 }).then(function (rows) { _asTrashCount = (rows || []).length; }).catch(function () { _asTrashCount = 0; })
      : Promise.resolve();
    pData = Promise.all([asGetAll(listParams), _asLoadCats(), pTrashCount]).then(function (r) {
      if (seq === _asRenderSeq) _asListCache = { key: cacheKey, rows: r[0] || [] };
      return r;
    });
  }

  return pData.then(function (results) {
    if (seq !== _asRenderSeq) return;   // 더 최근 renderAS 가 진행 중 — 이 응답은 버림
    var rows = results[0];
    var CAT = results[1] || {};
    var all = rows || [];
    var filtered = all.filter(function (t) {
      if (asFilterStatus && t.status !== asFilterStatus) return false;
      if (asFilterPriority && t.priority !== asFilterPriority) return false;
      if (asFilterCategory && t.category !== asFilterCategory) return false;
      if (asSearchKw) {
        var kw = asSearchKw.toLowerCase();
        var hit = ['ticketNo', 'customerName', 'equipmentModel', 'serialNo', 'issueSummary']
          .some(function (f) { return (t[f] || '').toLowerCase().indexOf(kw) >= 0; });
        if (!hit) return false;
      }
      return true;
    });
    filtered.sort(function (a, b) {
      var av = a.receivedAt || a.createdAt || '';
      var bv = b.receivedAt || b.createdAt || '';
      return av < bv ? 1 : av > bv ? -1 : 0;
    });

    // 통계
    var cnt = { received: 0, in_progress: 0, urgent: 0, closed: 0 };
    all.forEach(function (t) {
      if (t.status === 'received' || t.status === 'assigned') cnt.received++;
      if (t.status === 'in_progress' || t.status === 'reporting' || t.status === 'approved' || t.status === 'customer_wait') cnt.in_progress++;
      if ((t.priority === 'P1' || t.priority === 'P2') && t.status !== 'closed' && t.status !== 'cancelled') cnt.urgent++;
      if (t.status === 'closed') cnt.closed++;
    });

    var html = '';

    // 상단 컨트롤 바
    html += '<div class="pnl" style="margin-bottom:12px;padding:14px 18px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
    html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
    html += '<span style="font-size:13px;font-weight:700;color:var(--t2)">🛠️ A/S 접수 관리</span>';
    // 전체 / 내 큐 / 칸반 / 통계 / 휴지통 토글
    html += '<div style="display:inline-flex;border:1px solid var(--bd);border-radius:6px;overflow:hidden">';
    ['all', 'myqueue', 'kanban', 'stats', 'trash'].forEach(function (mode) {
      var labels = {
        all: '📋 전체',
        myqueue: '🎯 내 큐',
        kanban: '🗂️ 칸반',
        stats: '📊 통계',
        trash: '🗑️ 휴지통' + (_asTrashCount > 0 ? ' (' + _asTrashCount + ')' : '')
      };
      var titles = {
        myqueue: '내게 할당된 처리 진행 중인 건만',
        kanban: '상태별 칸반 보드 (드래그로 이동)',
        stats: '트렌드·KPI·SLA·부서부하·CSAT·부품 비용 분석',
        trash: '삭제(휴지통 이동)된 접수 — 복구 또는 완전 삭제'
      };
      var bgPerMode = { trash: '#EF4444', stats: '#0EA5E9' };
      var activeBg = bgPerMode[mode] || '#F59E0B';
      var active = asViewMode === mode;
      html += '<button onclick="asViewMode=\'' + mode + '\';renderAS()" style="font-size:10px;padding:4px 10px;border:none;background:' + (active ? activeBg : 'var(--bg-i)') + ';color:' + (active ? '#fff' : 'var(--t4)') + ';cursor:pointer;font-weight:' + (active ? '700' : '500') + '"' + (titles[mode] ? ' title="' + titles[mode] + '"' : '') + '>' + labels[mode] + '</button>';
    });
    html += '</div>';
    var modeLabel = { all: '전체 ', myqueue: '내 큐 ', kanban: '칸반 ', trash: '🗑️ 휴지통 ' }[asViewMode] || '';
    html += '<span style="font-size:11px;color:var(--t5)">' + modeLabel + all.length + '건' +
      (filtered.length !== all.length ? ' (필터: ' + filtered.length + '건)' : '') + '</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:6px">';
    if (_asAdminOnly()) {
      html += '<button onclick="showASCategoryAdmin()" style="font-size:11px;padding:4px 10px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer" title="관리자 전용 — 카테고리 추가·수정·비활성화">⚙️ 카테고리 관리</button>';
    }
    html += '<button onclick="showASModal()" style="font-size:11px;padding:4px 12px;border:none;border-radius:6px;background:#F59E0B;color:#fff;cursor:pointer;font-weight:600">+ 새 접수</button>';
    html += '</div></div></div>';

    // 요약 카드
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,260px));justify-content:start;gap:10px;margin-bottom:12px">';
    html += _asStatCard('대기/할당', cnt.received, '#6366F1');
    html += _asStatCard('P1·P2 긴급', cnt.urgent, '#EF4444');
    html += _asStatCard('처리중', cnt.in_progress, '#3B82F6');
    html += _asStatCard('완료', cnt.closed, '#10B981');
    html += '</div>';

    // 필터 바
    html += '<div class="pnl" style="margin-bottom:12px;padding:10px 14px">';
    html += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">';
    html += _asFilterSelect('상태', 'asFilterStatus', asFilterStatus, STATUS);
    html += _asFilterSelect('긴급도', 'asFilterPriority', asFilterPriority, PRIO);
    html += _asFilterSelect('카테고리', 'asFilterCategory', asFilterCategory, CAT);
    html += '<input type="text" placeholder="🔍 접수번호·고객사·증상" value="' + _asEsc(asSearchKw) +
      '" id="asSearchInput" oninput="asOnSearchInput(this.value)" style="font-size:11px;padding:4px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t2);min-width:180px">';
    if (asFilterStatus || asFilterPriority || asFilterCategory || asSearchKw) {
      html += '<button onclick="asClearFilters()" style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t4);cursor:pointer">필터 해제</button>';
    }
    html += '</div></div>';

    // 칸반 모드일 때 다른 렌더로 분기 (휴지통 모드에서는 칸반 비활성)
    if (asViewMode === 'kanban') {
      html += _asRenderKanban(filtered, CAT);
      wrap.innerHTML = html;
      _asAttachKanbanDnD();
      return;
    }

    // 목록 테이블
    html += '<div class="pnl" style="padding:0;overflow:hidden">';
    if (!filtered.length) {
      html += '<div style="padding:40px 20px;text-align:center;color:var(--t5);font-size:12px">';
      if (all.length === 0) {
        if (asViewMode === 'myqueue') {
          html += '🎯 내게 할당된 진행 중인 A/S가 없습니다.<br><span style="color:var(--t6);font-size:10px;margin-top:6px;display:inline-block">전체 보기로 전환하거나, 접수 상세 → ②할당에서 본인을 담당으로 추가하세요.</span>';
        } else if (asViewMode === 'trash') {
          html += '🗑️ 휴지통이 비어 있습니다.<br><span style="color:var(--t6);font-size:10px;margin-top:6px;display:inline-block">삭제된 접수는 여기로 이동하며 [복구] 또는 [완전 삭제] 할 수 있습니다.</span>';
        } else {
          html += '아직 접수된 A/S가 없습니다. <button onclick="showASModal()" style="border:none;background:none;color:#F59E0B;cursor:pointer;text-decoration:underline">첫 접수 등록</button>';
        }
      } else {
        html += '필터 조건에 맞는 A/S가 없습니다.';
      }
      html += '</div>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
      html += '<thead><tr style="background:var(--bg-i);border-bottom:1px solid var(--bd)">';
      ['접수번호', '고객사 / 장비', '카테고리', '긴급도', '상태', '신고 내용', '접수', ''].forEach(function (h) {
        html += '<th style="padding:8px 10px;text-align:left;font-weight:600;color:var(--t4);font-size:10px">' + h + '</th>';
      });
      html += '</tr></thead><tbody>';
      var isTrashView = (asViewMode === 'trash');
      filtered.forEach(function (t) {
        var st = STATUS[t.status] || { label: t.status, color: '#94A3B8', icon: '' };
        var pr = PRIO[t.priority] || { label: t.priority, color: '#94A3B8', icon: '' };
        var ct = CAT[t.category] || { label: t.category || '-', icon: '' };
        var safeId = _asEsc(t.id);
        var rowStyle = 'border-bottom:1px solid var(--bd);cursor:pointer' + (isTrashView ? ';opacity:0.7' : '');
        var rowClick = isTrashView ? '' : 'onclick="showASDetail(\'' + safeId + '\')"';
        html += '<tr style="' + rowStyle + '" ' + rowClick + '>';
        html += '<td style="padding:8px 10px;font-family:monospace;font-weight:600;color:var(--t2)">' + _asEsc(t.ticketNo) + (isTrashView ? ' <span style="font-size:9px;color:#EF4444">🗑️</span>' : '') + '</td>';
        html += '<td style="padding:8px 10px;color:var(--t2)"><div style="font-weight:600">' + _asEsc(t.customerName) + '</div>';
        html += '<div style="font-size:10px;color:var(--t5)">' + _asEsc(t.equipmentModel || '-') + (t.serialNo ? ' · ' + _asEsc(t.serialNo) : '') + '</div></td>';
        html += '<td style="padding:8px 10px;color:var(--t3)">' + (ct.icon || '') + ' ' + _asEsc(ct.label) + '</td>';
        html += '<td style="padding:8px 10px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:' + pr.color + ';color:#fff;font-size:10px;font-weight:600">' + (pr.icon || '') + ' ' + _asEsc(t.priority) + '</span></td>';
        html += '<td style="padding:8px 10px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:' + st.color + '22;color:' + st.color + ';font-size:10px;font-weight:600">' + (st.icon || '') + ' ' + _asEsc(st.label) + '</span></td>';
        // 신고 내용: 잘라내지 않고 남는 폭을 모두 쓰는 말줄임 셀 (전체 내용은 title)
        var summary = String(t.issueSummary || '').replace(/\s+/g, ' ').trim();
        var freqTxt = t.frequency ? _asFreqDisplay(t.frequency, t.frequencyCount) : '';
        html += '<td style="padding:8px 10px;color:var(--t3);width:45%;max-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + _asEsc(summary) + '">' + _asEsc(summary) + '</div>';
        if (freqTxt) html += '<div style="font-size:10px;color:var(--t5);margin-top:2px">📊 ' + _asEsc(freqTxt) + '</div>';
        html += '</td>';
        if (isTrashView) {
          html += '<td style="padding:8px 10px;color:var(--t5);font-size:10px">🗑️ ' + _asFmtDT(t.deletedAt) + '<br><span style="color:var(--t6)">접수: ' + _asFmtDate(t.receivedAt) + '</span></td>';
        } else {
          html += '<td style="padding:8px 10px;color:var(--t5);font-size:10px">' + _asFmtDate(t.receivedAt) + '<br><span style="color:var(--t6)">' + _asElapsed(t.receivedAt) + '</span></td>';
        }
        html += '<td style="padding:8px 10px;text-align:right;white-space:nowrap" onclick="event.stopPropagation()">';
        if (isTrashView) {
          html += '<button onclick="asRestoreTicket(\'' + safeId + '\')" style="font-size:10px;padding:3px 8px;border:1px solid #10B981;border-radius:4px;background:transparent;color:#10B981;cursor:pointer;margin-right:4px" title="복구">↻ 복구</button>';
          html += '<button onclick="asPurgeTicket(\'' + safeId + '\',\'' + _asJsArg(t.ticketNo) + '\')" style="font-size:10px;padding:3px 8px;border:1px solid #EF4444;border-radius:4px;background:transparent;color:#EF4444;cursor:pointer" title="완전 삭제">💥 완전삭제</button>';
        } else {
          html += '<button onclick="showASModal(\'' + safeId + '\')" style="font-size:10px;border:none;background:none;color:var(--t5);cursor:pointer;margin-right:4px" title="편집">✏️</button>';
          html += '<button onclick="asSoftDeleteTicket(\'' + safeId + '\',\'' + _asJsArg(t.ticketNo) + '\')" style="font-size:10px;border:none;background:none;color:var(--t5);cursor:pointer" title="휴지통으로 이동">🗑️</button>';
        }
        html += '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    wrap.innerHTML = html;
  }).catch(function (err) {
    if (seq !== _asRenderSeq) return;
    console.error('[renderAS]', err);
    wrap.innerHTML = '<div class="pnl" style="padding:24px;text-align:center;color:#EF4444">A/S 목록 조회 실패: ' + _asEsc((err && err.message) || '알 수 없는 오류') + '</div>';
  });
}

function _asStatCard(label, count, color) {
  return '<div class="pnl" style="padding:12px;text-align:center">' +
    '<div style="font-size:22px;font-weight:700;color:' + color + '">' + count + '</div>' +
    '<div style="font-size:10px;color:var(--t5);margin-top:2px">' + label + '</div></div>';
}

function _asFilterSelect(label, varName, curVal, options) {
  var h = '<select onchange="' + varName + '=this.value;renderAS({useCache:true})" style="font-size:10px;padding:3px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3)">';
  h += '<option value="">전체 ' + label + '</option>';
  Object.keys(options).forEach(function (k) {
    var o = options[k];
    h += '<option value="' + _asEsc(k) + '"' + (curVal === k ? ' selected' : '') + '>' + _asEsc(o.icon || '') + ' ' + _asEsc(o.label) + '</option>';
  });
  h += '</select>';
  return h;
}

function asClearFilters() {
  asFilterStatus = ''; asFilterPriority = ''; asFilterCategory = ''; asSearchKw = '';
  renderAS({ useCache: true });
}

/* 검색 입력 — 디바운스 + 캐시 목록 클라이언트 필터 + 재렌더 후 포커스/커서 복원 */
var _asSearchTimer = null;
function asOnSearchInput(val) {
  asSearchKw = val;
  clearTimeout(_asSearchTimer);
  _asSearchTimer = setTimeout(function () {
    var el = document.getElementById('asSearchInput');
    var hadFocus = el && document.activeElement === el;
    var caret = hadFocus ? el.selectionStart : null;
    Promise.resolve(renderAS({ useCache: true })).then(function () {
      if (!hadFocus) return;
      var ne = document.getElementById('asSearchInput');
      if (!ne) return;
      ne.focus();
      var v = ne.value || '';
      var pos = Math.min(caret == null ? v.length : caret, v.length);
      try { ne.setSelectionRange(pos, pos); } catch (e) {}
    });
  }, 250);
}

/* ═══ 칸반 보드 (드래그앤드롭) ═══ */
function _asRenderKanban(tickets, CAT) {
  var STATUS = typeof AS_STATUS !== 'undefined' ? AS_STATUS : {};
  var PRIO = typeof AS_PRIORITY !== 'undefined' ? AS_PRIORITY : {};
  // 컬럼 정의 (보류/취소는 별도 표시 안 함)
  var cols = [
    { key: 'received', label: '① 접수', color: '#6366F1' },
    { key: 'assigned', label: '② 할당', color: '#0EA5E9' },
    { key: 'in_progress', label: '③ 처리중', color: '#3B82F6' },
    { key: 'reporting', label: '④ 보고작성', color: '#8B5CF6' },
    { key: 'customer_wait', label: '⑤ 고객확인', color: '#F59E0B' },
    { key: 'closed', label: '⑥ 완료', color: '#10B981' }
  ];
  // status별 그룹
  var grouped = {};
  cols.forEach(function (c) { grouped[c.key] = []; });
  tickets.forEach(function (t) {
    // approved는 customer_wait 컬럼에 함께
    var k = (t.status === 'approved') ? 'customer_wait' : t.status;
    if (grouped[k]) grouped[k].push(t);
  });

  var h = '<div class="pnl" style="padding:14px;overflow-x:auto">';
  h += '<div style="display:flex;gap:10px">';
  cols.forEach(function (c) {
    h += '<div style="flex:1 1 240px;min-width:220px;display:flex;flex-direction:column">';
    h += '<div style="padding:8px 10px;background:' + c.color + '15;border-radius:6px;margin-bottom:8px;border-top:3px solid ' + c.color + '">';
    h += '<div style="font-size:11px;font-weight:700;color:' + c.color + '">' + c.label + ' <span style="color:var(--t5);font-weight:500">(' + grouped[c.key].length + ')</span></div>';
    h += '</div>';
    h += '<div class="asKanbanCol" data-status="' + c.key + '" style="flex:1;min-height:200px;background:var(--bg-i);border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:6px">';
    grouped[c.key].forEach(function (t) {
      var pr = PRIO[t.priority] || { color: '#94A3B8', icon: '' };
      var ct = CAT[t.category] || { label: t.category || '-', icon: '' };
      h += '<div class="asKanbanCard" draggable="true" data-ticket-id="' + _asEsc(t.id) + '" style="background:var(--bg);border:1px solid var(--bd);border-left:3px solid ' + pr.color + ';border-radius:5px;padding:8px 10px;cursor:grab;font-size:11px" onclick="showASDetail(\'' + _asEsc(t.id) + '\')">';
      h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">';
      h += '<div style="font-family:monospace;font-size:10px;color:var(--t5);font-weight:600">' + _asEsc(t.ticketNo) + '</div>';
      h += '<span style="font-size:9px;padding:1px 5px;border-radius:8px;background:' + pr.color + ';color:#fff;font-weight:600">' + _asEsc(t.priority) + '</span>';
      h += '</div>';
      h += '<div style="font-size:11px;font-weight:600;color:var(--t2);margin-top:3px">' + _asEsc(t.customerName || '-') + '</div>';
      h += '<div style="font-size:10px;color:var(--t5);margin-top:1px">' + (ct.icon || '') + ' ' + _asEsc(ct.label) + '</div>';
      var elapsed = _asElapsed(t.receivedAt);
      if (elapsed) h += '<div style="font-size:9px;color:var(--t6);margin-top:3px">⏱️ ' + elapsed + '</div>';
      h += '</div>';
    });
    h += '</div></div>';
  });
  h += '</div></div>';
  return h;
}

function _asAttachKanbanDnD() {
  var cards = document.querySelectorAll('.asKanbanCard');
  var cols = document.querySelectorAll('.asKanbanCol');
  var draggingId = null;
  cards.forEach(function (card) {
    card.addEventListener('dragstart', function (e) {
      draggingId = card.dataset.ticketId;
      e.dataTransfer.effectAllowed = 'move';
      card.style.opacity = '0.4';
    });
    card.addEventListener('dragend', function () {
      draggingId = null;
      card.style.opacity = '';
    });
  });
  cols.forEach(function (col) {
    col.addEventListener('dragover', function (e) {
      e.preventDefault();
      col.style.background = 'var(--bg)';
    });
    col.addEventListener('dragleave', function () {
      col.style.background = 'var(--bg-i)';   // 레인 기본 배경 복원 ('' 로 지우면 인라인 배경이 사라짐)
    });
    col.addEventListener('drop', function (e) {
      e.preventDefault();
      col.style.background = 'var(--bg-i)';
      if (!draggingId) return;
      var newStatus = col.dataset.status;
      updateASTicket(draggingId, { status: newStatus }).then(function () {
        if (typeof showToast === 'function') showToast('상태 변경 → ' + newStatus);
        renderAS();
      }).catch(function (err) {
        if (typeof showToast === 'function') showToast('❌ 변경 실패: ' + ((err && err.message) || ''), 'error');
        renderAS();
      });
    });
  });
}
