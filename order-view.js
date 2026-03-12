/**
 * 업무 관리자 — 수주 대장 뷰
 * 수주 목록 테이블, 등록/편집/삭제, 엑셀 연동
 */

var orderSortKey = 'date';
var orderSortAsc = false;
var orderFilterClient = '';

/* ═══ 수주 대장 렌더링 ═══ */
function renderOrders() {
  var wrap = document.getElementById('ordersWrap');
  if (!wrap) return;

  Promise.all([orderGetAll(), projGetAll(), typeof issueGetAll === 'function' ? issueGetAll() : Promise.resolve([])]).then(function (results) {
    var orders = results[0] || [];
    var projects = results[1] || [];
    var allIssues = results[2] || [];

    // 수주번호별 미해결 이슈 건수
    var openIssuesByOrder = {};
    allIssues.forEach(function (iss) {
      if (iss.orderNo && iss.status !== 'resolved' && iss.status !== 'closed') {
        openIssuesByOrder[iss.orderNo] = (openIssuesByOrder[iss.orderNo] || 0) + 1;
      }
    });

    // ORDER_MAP에는 있지만 DB에 없는 항목 보충
    if (typeof ORDER_MAP !== 'undefined') {
      var dbNos = {};
      orders.forEach(function (o) { dbNos[o.orderNo] = true; });
      Object.keys(ORDER_MAP).forEach(function (k) {
        if (!dbNos[k]) {
          var v = ORDER_MAP[k];
          orders.push({
            orderNo: k,
            date: (typeof v === 'object' ? v.date : '') || '',
            client: (typeof v === 'object' ? v.client : '') || '',
            name: (typeof v === 'object' ? v.name : v) || '',
            amount: (typeof v === 'object' ? Number(v.amount) || 0 : 0),
            manager: (typeof v === 'object' ? v.manager : '') || '',
            delivery: (typeof v === 'object' ? v.delivery : '') || '',
            memo: '', createdAt: ''
          });
        }
      });
    }

    // 프로젝트 매핑 (수주번호 → 프로젝트)
    var projByOrder = {};
    projects.forEach(function (p) {
      if (p.orderNo) {
        if (!projByOrder[p.orderNo]) projByOrder[p.orderNo] = [];
        projByOrder[p.orderNo].push(p);
      }
    });

    // 거래처 필터
    if (orderFilterClient) {
      orders = orders.filter(function (o) { return o.client === orderFilterClient; });
    }

    // 정렬
    orders.sort(function (a, b) {
      var va = a[orderSortKey] || '';
      var vb = b[orderSortKey] || '';
      if (orderSortKey === 'amount') { va = Number(va) || 0; vb = Number(vb) || 0; }
      var cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return orderSortAsc ? cmp : -cmp;
    });

    // 거래처 목록 (필터용)
    var clients = {};
    (results[0] || []).forEach(function (o) { if (o.client) clients[o.client] = true; });

    var html = '';

    // 상단 컨트롤
    html += '<div class="pnl" style="margin-bottom:14px;padding:14px 18px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">';
    html += '<div style="display:flex;align-items:center;gap:10px">';
    html += '<span style="font-size:13px;font-weight:700;color:var(--t2)">📋 수주 대장</span>';
    html += '<span style="font-size:11px;color:var(--t5)">' + orders.length + '건</span>';
    // 거래처 필터
    html += '<select style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3)" onchange="orderFilterClient=this.value;renderOrders()">';
    html += '<option value="">전체 거래처</option>';
    Object.keys(clients).sort().forEach(function (c) {
      html += '<option value="' + eH(c) + '"' + (orderFilterClient === c ? ' selected' : '') + '>' + eH(c) + '</option>';
    });
    html += '</select>';
    html += '</div>';
    html += '<div style="display:flex;gap:6px">';
    html += '<button class="btn btn-p btn-s" onclick="showOrderModal()">+ 신규 수주</button>';
    html += '<button class="btn btn-g btn-s" onclick="importOrderExcel()">📥 엑셀 불러오기</button>';
    html += '<button class="btn btn-g btn-s" onclick="exportOrderExcel()">📤 엑셀 저장</button>';
    html += '<button class="btn btn-g btn-s" onclick="syncOrdersToDB()">🔄 DB 동기화</button>';
    html += '</div></div>';

    // 통계 카드
    var totalAmount = 0;
    orders.forEach(function (o) { totalAmount += Number(o.amount) || 0; });
    html += '<div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap">';
    html += '<div style="font-size:10px;color:var(--t5)">총 수주액: <strong style="color:var(--t2)">' + formatAmount(totalAmount) + '</strong></div>';
    html += '<div style="font-size:10px;color:var(--t5)">프로젝트 연결: <strong style="color:var(--t2)">' + Object.keys(projByOrder).length + '건</strong></div>';
    html += '</div>';
    html += '</div>';

    // 테이블
    html += '<div class="pnl" style="overflow-x:auto">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="border-bottom:2px solid var(--bd)">';
    var cols = [
      { key: 'orderNo', label: '수주번호', w: '100px' },
      { key: 'date', label: '수주일', w: '90px' },
      { key: 'client', label: '거래처', w: '120px' },
      { key: 'name', label: '프로젝트명', w: '' },
      { key: 'amount', label: '수주액', w: '100px' },
      { key: 'manager', label: '담당자', w: '80px' },
      { key: 'delivery', label: '납품예정', w: '90px' },
      { key: '_phase', label: '현재 단계', w: '90px' },
      { key: '_issues', label: '이슈', w: '55px' },
      { key: '_actions', label: '', w: '70px' }
    ];
    cols.forEach(function (c) {
      var sortable = c.key && c.key[0] !== '_';
      var arrow = orderSortKey === c.key ? (orderSortAsc ? ' ▲' : ' ▼') : '';
      var cursor = sortable ? 'cursor:pointer' : '';
      var onclick = sortable ? 'onclick="orderSort(\'' + c.key + '\')"' : '';
      html += '<th style="padding:8px 6px;text-align:left;font-weight:600;color:var(--t4);white-space:nowrap;' + cursor + (c.w ? ';width:' + c.w : '') + '" ' + onclick + '>' + c.label + arrow + '</th>';
    });
    html += '</tr></thead><tbody>';

    if (orders.length === 0) {
      html += '<tr><td colspan="10" style="padding:40px;text-align:center;color:var(--t6)">등록된 수주가 없습니다. 엑셀 불러오기 또는 신규 등록을 이용하세요.</td></tr>';
    }

    orders.forEach(function (o) {
      var linked = projByOrder[o.orderNo] || [];
      var phase = '';
      if (linked.length > 0) {
        var p = linked[0];
        var phKey = p.currentPhase || guessPhase(p);
        var ph = typeof PROJ_PHASE !== 'undefined' && PROJ_PHASE[phKey] ? PROJ_PHASE[phKey] : null;
        if (ph) phase = '<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:' + ph.color + '22;color:' + ph.color + '">' + ph.icon + ' ' + ph.label + '</span>';
        else phase = '<span style="font-size:10px;color:var(--t5)">' + eH(phKey) + '</span>';
      } else {
        phase = '<span style="font-size:10px;color:var(--t6)">미연결</span>';
      }

      html += '<tr style="border-bottom:1px solid var(--bd);transition:background .1s" onmouseover="this.style.background=\'var(--bg-i)\'" onmouseout="this.style.background=\'\'">';
      html += '<td style="padding:8px 6px;font-weight:600;color:var(--t2)">' + eH(o.orderNo) + '</td>';
      html += '<td style="padding:8px 6px;color:var(--t4)">' + eH(o.date) + '</td>';
      html += '<td style="padding:8px 6px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">' + eH(o.client) + '</td>';
      html += '<td style="padding:8px 6px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px" title="' + eH(o.name) + '">' + eH(o.name) + '</td>';
      html += '<td style="padding:8px 6px;color:var(--t3);text-align:right">' + (o.amount ? formatAmount(o.amount) : '-') + '</td>';
      html += '<td style="padding:8px 6px;color:var(--t4)">' + eH(o.manager) + '</td>';
      html += '<td style="padding:8px 6px;color:var(--t4)">' + eH(o.delivery) + '</td>';
      html += '<td style="padding:8px 6px">' + phase + '</td>';

      // 이슈 배지
      var issueCnt = openIssuesByOrder[o.orderNo] || 0;
      var safeOrderNo = (o.orderNo || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      if (issueCnt > 0) {
        html += '<td style="padding:8px 6px;text-align:center"><span onclick="issueFilterProject=\'\';issueFilterStatus=\'\';issueSearchKw=\'\';(function(){issueGetAll&&issueGetAll().then(function(all){var matched=all.filter(function(i){return i.orderNo===\'' + safeOrderNo + '\'&&i.status!==\'resolved\'&&i.status!==\'closed\'});if(matched.length&&typeof showIssueDetail===\'function\')showIssueDetail(matched[0].id)})})();event.stopPropagation()" style="cursor:pointer;font-size:10px;padding:2px 7px;border-radius:10px;background:#EF444422;color:#EF4444;font-weight:700;border:1px solid #EF444440" title="미해결 이슈 ' + issueCnt + '건 클릭하면 첫 번째 이슈 확인">' + issueCnt + '</span></td>';
      } else {
        html += '<td style="padding:8px 6px;text-align:center"><span style="font-size:10px;color:var(--t6)">-</span></td>';
      }

      html += '<td style="padding:8px 6px;white-space:nowrap">';
      var safeNo = (o.orderNo || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      html += '<button class="btn btn-g" style="padding:2px 6px;font-size:9px;margin-right:3px" onclick="showOrderModal(\'' + safeNo + '\')">편집</button>';
      html += '<button class="btn btn-d" style="padding:2px 6px;font-size:9px" onclick="confirmDeleteOrder(\'' + safeNo + '\')">삭제</button>';
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';

    wrap.innerHTML = html;
  });
}

/* ═══ 정렬 ═══ */
function orderSort(key) {
  if (orderSortKey === key) orderSortAsc = !orderSortAsc;
  else { orderSortKey = key; orderSortAsc = true; }
  renderOrders();
}

/* ═══ 금액 포맷 ═══ */
function formatAmount(val) {
  var n = Number(val) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '억';
  if (n >= 1000) return (n / 1000).toFixed(0) + '천만';
  if (n > 0) return n.toLocaleString() + '만';
  return '-';
}

/* ═══ 수주 등록/편집 모달 ═══ */
function showOrderModal(editOrderNo) {
  var existing = null;
  var isEdit = false;

  var doShow = function () {
    var modal = document.createElement('div');
    modal.id = 'orderModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
    modal.onclick = function (e) { if (e.target === modal) modal.remove(); };

    var o = existing || {};

    modal.innerHTML = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;max-width:520px;width:95%;max-height:90vh;overflow:auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
      '<h3 style="font-size:14px;font-weight:700;color:var(--t1)">' + (isEdit ? '📝 수주 편집' : '➕ 신규 수주 등록') + '</h3>' +
      '<button class="btn btn-g btn-s" onclick="document.getElementById(\'orderModal\').remove()">✕ 닫기</button>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<div><label class="fl">수주번호 *</label><input type="text" class="si" id="omOrderNo" value="' + eH(o.orderNo || '') + '" placeholder="예: A25029" style="padding-left:10px"' + (isEdit ? ' readonly style="padding-left:10px;background:var(--bg-i)"' : '') + '></div>' +
      '<div><label class="fl">수주일</label><input type="date" class="si" id="omDate" value="' + (o.date || '') + '" style="padding-left:10px"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<div><label class="fl">거래처</label><input type="text" class="si" id="omClient" value="' + eH(o.client || '') + '" placeholder="거래처명" style="padding-left:10px"></div>' +
      '<div><label class="fl">프로젝트명</label><input type="text" class="si" id="omName" value="' + eH(o.name || '') + '" placeholder="프로젝트명" style="padding-left:10px"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +
      '<div><label class="fl">수주액 (만원)</label><input type="number" class="si" id="omAmount" value="' + (o.amount || '') + '" placeholder="0" style="padding-left:10px"></div>' +
      '<div><label class="fl">담당자</label><input type="text" class="si" id="omManager" value="' + eH(o.manager || '') + '" placeholder="담당자" style="padding-left:10px"></div>' +
      '<div><label class="fl">납품예정일</label><input type="date" class="si" id="omDelivery" value="' + (o.delivery || '') + '" style="padding-left:10px"></div>' +
      '</div>' +
      '<div><label class="fl">메모</label><textarea class="si" id="omMemo" rows="2" style="padding:8px 10px;resize:vertical">' + eH(o.memo || '') + '</textarea></div>' +
      (!isEdit ? '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t4);cursor:pointer"><input type="checkbox" id="omAutoProj" checked> 프로젝트 자동 생성 (6단계 마일스톤 포함)</label>' : '') +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">' +
      '<button class="btn btn-g" onclick="document.getElementById(\'orderModal\').remove()">취소</button>' +
      '<button class="btn btn-p" onclick="saveOrderModal(' + (isEdit ? 'true' : 'false') + ')">저장</button>' +
      '</div></div></div>';

    document.body.appendChild(modal);
    if (!isEdit) document.getElementById('omOrderNo').focus();
  };

  if (editOrderNo) {
    isEdit = true;
    orderGet(editOrderNo).then(function (o) {
      if (o) { existing = o; }
      else if (typeof ORDER_MAP !== 'undefined' && ORDER_MAP[editOrderNo]) {
        var v = ORDER_MAP[editOrderNo];
        existing = { orderNo: editOrderNo, date: (typeof v === 'object' ? v.date : '') || '', client: (typeof v === 'object' ? v.client : '') || '', name: (typeof v === 'object' ? v.name : v) || '', amount: (typeof v === 'object' ? Number(v.amount) || 0 : 0), manager: (typeof v === 'object' ? v.manager : '') || '', delivery: (typeof v === 'object' ? v.delivery : '') || '', memo: '' };
      }
      doShow();
    });
  } else {
    doShow();
  }
}

/* ═══ 수주 저장 ═══ */
function saveOrderModal(isEdit) {
  var orderNo = document.getElementById('omOrderNo').value.trim();
  if (!orderNo) { showToast('수주번호를 입력하세요', 'error'); return; }

  var data = {
    orderNo: orderNo,
    date: document.getElementById('omDate').value,
    client: document.getElementById('omClient').value.trim(),
    name: document.getElementById('omName').value.trim(),
    amount: Number(document.getElementById('omAmount').value) || 0,
    manager: document.getElementById('omManager').value.trim(),
    delivery: document.getElementById('omDelivery').value,
    memo: document.getElementById('omMemo').value.trim()
  };

  var autoProj = !isEdit && document.getElementById('omAutoProj') && document.getElementById('omAutoProj').checked;

  createOrder(data).then(function () {
    if (autoProj) {
      return createProjectFromOrder(data).then(function (proj) {
        showToast('✅ 수주 등록 + 프로젝트 자동 생성 완료', 'success');
        return proj;
      });
    } else {
      showToast('✅ 수주 ' + (isEdit ? '수정' : '등록') + ' 완료', 'success');
    }
  }).then(function () {
    var modal = document.getElementById('orderModal');
    if (modal) modal.remove();
    renderOrders();
    // 파이프라인도 갱신
    if (typeof renderPipeline === 'function' && document.getElementById('mPipeline') && !document.getElementById('mPipeline').classList.contains('hidden')) {
      renderPipeline();
    }
  });
}

/* ═══ 수주 삭제 ═══ */
function confirmDeleteOrder(orderNo) {
  if (!confirm('수주 "' + orderNo + '"를 삭제하시겠습니까?\n(연결된 프로젝트는 삭제되지 않습니다)')) return;
  deleteOrder(orderNo).then(function () {
    showToast('🗑️ 수주 삭제 완료', 'success');
    renderOrders();
  });
}

/* ═══ ORDER_MAP → DB 동기화 ═══ */
function syncOrdersToDB() {
  syncOrderMapToDB().then(function () {
    showToast('✅ ORDER_MAP → DB 동기화 완료', 'success');
    renderOrders();
  });
}

/* ═══ 엑셀 불러오기 후 DB 동기화 ═══ */
var _origHandleOrderExcel = typeof handleOrderExcel === 'function' ? handleOrderExcel : null;
if (typeof handleOrderExcel === 'function') {
  var _baseHandleOrderExcel = handleOrderExcel;
  handleOrderExcel = function (input) {
    _baseHandleOrderExcel(input);
    // 엑셀 로드 완료 후 DB 동기화 (약간의 지연)
    setTimeout(function () {
      if (typeof syncOrderMapToDB === 'function') {
        syncOrderMapToDB().then(function () {
          if (typeof renderOrders === 'function') renderOrders();
        });
      }
    }, 500);
  };
}

/* ═══ eH / guessPhase 폴백 ═══ */
if (typeof eH === 'undefined') {
  function eH(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
}
if (typeof guessPhase === 'undefined') {
  function guessPhase(p) { return p.currentPhase || (p.status === 'done' ? 'as' : p.status === 'waiting' ? 'order' : 'manufacture'); }
}
