/**
 * 업무 관리자 — 수주 대장 뷰
 * 수주 목록 테이블, 등록/편집/삭제, 엑셀 연동
 */

// v13.38: 수주 정렬·거래처 필터 localStorage 보존
var orderSortKey = (function () { try { return localStorage.getItem('wm_orderSortKey') || 'date'; } catch (e) { return 'date'; } })();
var orderSortAsc = (function () { try { return localStorage.getItem('wm_orderSortAsc') === '1'; } catch (e) { return false; } })();
var orderFilterClient = (function () { try { return localStorage.getItem('wm_orderFilterClient') || ''; } catch (e) { return ''; } })();
function _orderPersistFilters() {
  try {
    localStorage.setItem('wm_orderSortKey', orderSortKey || '');
    localStorage.setItem('wm_orderSortAsc', orderSortAsc ? '1' : '0');
    localStorage.setItem('wm_orderFilterClient', orderFilterClient || '');
  } catch (e) {}
}

// 텍스트 검색 (수주번호·프로젝트명·거래처) — 디바운스 + 포커스/캐럿 복원
var orderSearchKw = '';
var _orderQTimer = null;
function orderSetQ(v) {
  orderSearchKw = v || '';
  clearTimeout(_orderQTimer);
  _orderQTimer = setTimeout(function () {
    renderOrders(function () { wmRestoreFocus('orderQ'); });
  }, 250);
}

/* ═══ 수주 대장 렌더링 ═══ */
function renderOrders(afterRender) {
  var wrap = document.getElementById('ordersWrap');
  if (!wrap) return;

  return Promise.all([orderGetAll(), projGetAll(), typeof issueGetAll === 'function' ? issueGetAll() : Promise.resolve([])]).then(function (results) {
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

    // 거래처 목록 (필터용) — ORDER_MAP 보충분 포함
    var clients = {};
    orders.forEach(function (o) { if (o.client) clients[o.client] = true; });

    // 저장된 거래처 필터가 더 이상 존재하지 않으면 초기화 (빈 목록 + 선택 불가 상태 방지)
    if (orderFilterClient && !clients[orderFilterClient]) {
      orderFilterClient = '';
      _orderPersistFilters();
    }
    var totalCnt = orders.length;

    // 거래처 필터
    if (orderFilterClient) {
      orders = orders.filter(function (o) { return o.client === orderFilterClient; });
    }
    // 텍스트 검색
    if (orderSearchKw) {
      var kw = orderSearchKw.toLowerCase();
      orders = orders.filter(function (o) {
        return ((o.orderNo || '') + ' ' + (o.name || '') + ' ' + (o.client || '')).toLowerCase().indexOf(kw) >= 0;
      });
    }
    var filterActive = !!(orderFilterClient || orderSearchKw);

    // 정렬
    orders.sort(function (a, b) {
      var va = a[orderSortKey] || '';
      var vb = b[orderSortKey] || '';
      if (orderSortKey === 'amount') { va = Number(va) || 0; vb = Number(vb) || 0; }
      var cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return orderSortAsc ? cmp : -cmp;
    });

    var html = '';

    // 상단 컨트롤
    html += '<div class="pnl" style="margin-bottom:14px;padding:14px 18px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">';
    html += '<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;flex-wrap:wrap">';
    html += '<span style="font-size:13px;font-weight:700;color:var(--t2)">📋 수주 대장</span>';
    html += '<span style="font-size:11px;color:var(--t5)">' + orders.length + '건' + (filterActive ? ' / 전체 ' + totalCnt + '건' : '') + '</span>';
    // 거래처 필터
    html += '<select style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3)" onchange="orderFilterClient=this.value;_orderPersistFilters();renderOrders()">';
    html += '<option value="">전체 거래처</option>';
    Object.keys(clients).sort().forEach(function (c) {
      html += '<option value="' + eH(c) + '"' + (orderFilterClient === c ? ' selected' : '') + '>' + eH(c) + '</option>';
    });
    html += '</select>';
    // 텍스트 검색
    html += '<input type="text" id="orderQ" placeholder="🔍 수주번호·프로젝트명·거래처" value="' + eH(orderSearchKw) + '" oninput="orderSetQ(this.value)" style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);flex:1;min-width:160px;max-width:360px">';
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
    // v13.189 wide-mode: 고정 레이아웃 — 고정 폭 컬럼은 th width, 프로젝트명만 가변(말줄임)
    html += '<table style="width:100%;min-width:980px;table-layout:fixed;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="border-bottom:2px solid var(--bd)">';
    var cols = [
      { key: 'orderNo', label: '수주번호', w: '100px' },
      { key: 'date', label: '수주일', w: '90px' },
      { key: 'client', label: '거래처', w: '180px' },
      { key: 'name', label: '프로젝트명', w: '' },
      { key: 'amount', label: '수주액', w: '100px' },
      { key: 'manager', label: '담당자', w: '90px' },
      { key: 'delivery', label: '납품예정', w: '90px' },
      { key: '_phase', label: '현재 단계', w: '110px' },
      { key: '_issues', label: '이슈', w: '60px' },
      { key: '_actions', label: '', w: '90px' }
    ];
    cols.forEach(function (c) {
      var sortable = c.key && c.key[0] !== '_';
      var arrow = orderSortKey === c.key ? (orderSortAsc ? ' ▲' : ' ▼') : '';
      var cursor = sortable ? 'cursor:pointer' : '';
      var onclick = sortable ? 'onclick="orderSort(\'' + c.key + '\')"' : '';
      html += '<th style="padding:8px 6px;text-align:left;font-weight:600;color:var(--t4);white-space:nowrap;' + cursor + (c.w ? ';width:' + c.w : '') + '" ' + onclick + '>' + c.label + arrow + '</th>';
    });
    html += '</tr></thead><tbody>';

    if (orders.length === 0 && filterActive && totalCnt > 0) {
      html += '<tr><td colspan="10" style="padding:40px 20px;text-align:center;color:var(--t5)">' +
        '<div style="font-size:13px;color:var(--t3);margin-bottom:8px;font-weight:600">필터 결과 없음</div>' +
        '<div style="font-size:11px;color:var(--t6);margin-bottom:12px">현재 거래처/검색 조건에 맞는 수주가 없습니다. (전체 ' + totalCnt + '건)</div>' +
        '<button class="btn btn-g btn-s" onclick="orderClearFilters()" style="font-size:12px">✕ 필터 초기화</button>' +
      '</td></tr>';
    } else if (orders.length === 0) {
      html += '<tr><td colspan="10" style="padding:48px 20px;text-align:center;color:var(--t5)">' +
        '<div style="font-size:32px;margin-bottom:10px">📋</div>' +
        '<div style="font-size:13px;color:var(--t3);margin-bottom:6px;font-weight:600">등록된 수주가 없습니다</div>' +
        '<div style="font-size:11px;color:var(--t6);margin-bottom:16px;line-height:1.6">엑셀 파일에서 일괄 등록하거나, 직접 신규 등록할 수 있습니다.</div>' +
        '<div style="display:inline-flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
          '<button class="btn btn-p btn-s" onclick="importOrderExcel()" style="font-size:12px">📥 엑셀 불러오기</button>' +
          '<button class="btn btn-g btn-s" onclick="showOrderModal()" style="font-size:12px">➕ 신규 등록</button>' +
        '</div>' +
      '</td></tr>';
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
      var ell = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      html += '<td style="padding:8px 6px;font-weight:600;color:var(--t2);' + ell + '" title="' + eH(o.orderNo) + '">' + eH(o.orderNo) + '</td>';
      html += '<td style="padding:8px 6px;color:var(--t4);' + ell + '">' + eH(o.date) + '</td>';
      html += '<td style="padding:8px 6px;color:var(--t3);' + ell + '" title="' + eH(o.client) + '">' + eH(o.client) + '</td>';
      html += '<td style="padding:8px 6px;color:var(--t2);' + ell + '" title="' + eH(o.name) + '">' + eH(o.name) + '</td>';
      html += '<td style="padding:8px 6px;color:var(--t3);text-align:right;' + ell + '">' + (o.amount ? formatAmount(o.amount) : '-') + '</td>';
      html += '<td style="padding:8px 6px;color:var(--t4);' + ell + '" title="' + eH(o.manager) + '">' + eH(o.manager) + '</td>';
      html += '<td style="padding:8px 6px;color:var(--t4);' + ell + '">' + eH(o.delivery) + '</td>';
      html += '<td style="padding:8px 6px;' + ell + '">' + phase + '</td>';

      // 이슈 배지 — 클릭 시 이슈관리 탭으로 이동 + 수주번호 필터 (v13.39)
      var issueCnt = openIssuesByOrder[o.orderNo] || 0;
      var safeOrderNo = _orderJsStr(o.orderNo);
      if (issueCnt > 0) {
        html += '<td style="padding:8px 6px;text-align:center"><span onclick="event.stopPropagation();gotoIssuesForOrder(\'' + safeOrderNo + '\')" style="cursor:pointer;font-size:10px;padding:2px 7px;border-radius:10px;background:#EF444422;color:#EF4444;font-weight:700;border:1px solid #EF444440" title="이슈관리 탭으로 이동 — 이 수주(' + eH(o.orderNo) + ')의 이슈 ' + issueCnt + '건">' + issueCnt + ' →</span></td>';
      } else {
        html += '<td style="padding:8px 6px;text-align:center"><span onclick="event.stopPropagation();gotoIssuesForOrder(\'' + safeOrderNo + '\')" style="cursor:pointer;font-size:10px;color:var(--t6)" title="이슈관리 탭으로 이동 (필터: 이 수주)">-</span></td>';
      }

      html += '<td style="padding:8px 6px;white-space:nowrap">';
      var safeNo = safeOrderNo;
      html += '<button class="btn btn-g" style="padding:2px 6px;font-size:9px;margin-right:3px" onclick="showOrderModal(\'' + safeNo + '\')">편집</button>';
      html += '<button class="btn btn-d" style="padding:2px 6px;font-size:9px" onclick="confirmDeleteOrder(\'' + safeNo + '\')">삭제</button>';
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';

    wrap.innerHTML = html;
    if (typeof afterRender === 'function') afterRender();
  }).catch(function (err) {
    console.error('[renderOrders]', err);
    var msg = (err && err.message) || '알 수 없는 오류';
    wrap.innerHTML = '<div class="pnl" style="padding:32px 20px;text-align:center;color:var(--t5);font-size:12px">수주 대장을 불러오지 못했습니다. <button class="btn btn-g btn-s" onclick="renderOrders()" style="margin-left:6px">다시 시도</button></div>';
    if (typeof showToast === 'function') showToast('❌ 수주 대장 로드 실패: ' + msg, 'error');
  });
}

function orderClearFilters() {
  orderFilterClient = '';
  orderSearchKw = '';
  _orderPersistFilters();
  renderOrders();
}

/* ═══ 정렬 ═══ */
function orderSort(key) {
  if (orderSortKey === key) orderSortAsc = !orderSortAsc;
  else { orderSortKey = key; orderSortAsc = true; }
  _orderPersistFilters();
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
    var modal = createModal({ id: 'orderModal', z: MODAL_Z, overlayStyle: 'padding:0;background:rgba(0,0,0,.6)' }).overlay;
    // v13.63: backdrop 클릭 닫기 비활성화 — 데이터 유실 방지 (✕ 버튼만 닫기)

    var o = existing || {};

    modal.innerHTML = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;max-width:520px;width:95%;max-height:90vh;overflow:auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
      '<h3 style="font-size:14px;font-weight:700;color:var(--t1)">' + (isEdit ? '📝 수주 편집' : '➕ 신규 수주 등록') + '</h3>' +
      '<button class="btn btn-g btn-s" onclick="document.getElementById(\'orderModal\').remove()">✕ 닫기</button>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<div><label class="fl">수주번호 *</label>' +
        (isEdit
          // 편집 중에는 직접 타이핑으로 바꾸지 못하게 하고(= 옛 번호가 남은 채 새 수주가 하나 더 생기는 사고 방지)
          // 연결 레코드까지 함께 옮기는 전용 모달로 유도한다.
          ? '<div style="display:flex;gap:6px"><input type="text" class="si" id="omOrderNo" value="' + eH(o.orderNo || '') + '" readonly style="padding-left:10px;background:var(--bg-i);flex:1">' +
            '<button class="btn btn-g btn-s" style="white-space:nowrap" title="연결된 프로젝트·이슈·업무일지·A/S·사전검토까지 함께 바꿉니다" onclick="showRenumberModal(\'' + _orderJsStr(o.orderNo) + '\', ' + (o.version === undefined || o.version === null ? 'null' : Number(o.version)) + ')">🔢 번호 변경</button></div>'
          : '<input type="text" class="si" id="omOrderNo" value="' + eH(o.orderNo || '') + '" placeholder="예: A25029" style="padding-left:10px">') +
      '</div>' +
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
    // 주간분석 상세 필드도 갱신 (수주명/거래처 반영)
    if (typeof invalidateOrderInfoCache === 'function') invalidateOrderInfoCache();
    if (typeof gfInvalidate === 'function') gfInvalidate();
    if (typeof rFL === 'function') rFL();
    if (typeof upV === 'function') upV();
  }).catch(function (err) {
    console.error('[saveOrderModal]', err);
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (err && err.status === 403) msg = '수주 등록 권한이 없습니다. 관리자에게 문의하세요.';
    showToast('❌ 수주 저장 실패: ' + msg, 'error');
  });
}

/* ═══ 수주번호 변경 (renumber) ═══
   수주번호는 FK 없는 문자열 키로 projects·issues·work_records·as_tickets·prestudies 에
   흩어져 있다. orders 만 고치면 연결이 조용히 끊기므로, 전용 모달에서
   ① 함께 바뀔 건수를 먼저 보여주고 ② 변경 사유를 받은 뒤
   ③ 서버가 한 트랜잭션으로 전파 + 감사 로그까지 남긴다. */

/* onclick="...(' + 여기 + ')" 자리에 들어갈 값.
   ① JS 문자열 리터럴 이스케이프(역슬래시·작은따옴표) → ② HTML 속성 이스케이프.
   순서가 중요하다 — 브라우저가 속성을 먼저 디코드한 뒤 JS 로 파싱한다. */
function _orderJsStr(s) {
  return eH(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

function _renumberHistoryHTML(logs) {
  if (!logs || !logs.length) return '<div style="font-size:10px;color:var(--t6);padding:6px 0">변경 이력이 없습니다.</div>';
  return logs.map(function (lg) {
    var d = lg.detail || {};
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
    var when = (lg.created_at || '').slice(0, 16).replace('T', ' ');
    return '<div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid var(--bd);font-size:10px">' +
      '<span style="color:var(--t6);white-space:nowrap">' + eH(when) + '</span>' +
      '<span style="color:var(--t3);white-space:nowrap">' + eH(lg.user_name || lg.user_email || '알 수 없음') + '</span>' +
      '<span style="color:var(--t4);white-space:nowrap"><b>' + eH(d.from || '?') + '</b> → <b>' + eH(d.to || '?') + '</b></span>' +
      '<span style="color:var(--t5);flex:1;overflow:hidden;text-overflow:ellipsis">' + eH(d.reason || '') + '</span>' +
      '</div>';
  }).join('');
}

function _renumberRefsHTML(refs) {
  if (!refs) return '';
  var counts = refs.counts || {};
  var parts = Object.keys(counts).map(function (k) {
    var c = counts[k];
    var on = c.count > 0;
    return '<span style="font-size:10px;padding:2px 7px;border-radius:10px;border:1px solid ' + (on ? 'var(--ac)' : 'var(--bd)') + ';color:' + (on ? 'var(--ac-t)' : 'var(--t6)') + '">' +
      eH(c.label) + ' ' + c.count + '건</span>';
  });
  return '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">' + parts.join('') + '</div>' +
    '<div style="font-size:10px;color:var(--t5);margin-top:5px">총 <b style="color:var(--ac-t)">' + refs.total + '건</b>이 새 번호로 함께 갱신됩니다.</div>';
}

function showRenumberModal(orderNo, version) {
  var modal = createModal({ id: 'renumberModal', z: MODAL_Z + 1, overlayStyle: 'padding:0;background:rgba(0,0,0,.6)' }).overlay;
  modal.innerHTML = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;max-width:520px;width:95%;max-height:90vh;overflow:auto">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
    '<h3 style="font-size:14px;font-weight:700;color:var(--t1)">🔢 수주번호 변경</h3>' +
    '<button class="btn btn-g btn-s" onclick="document.getElementById(\'renumberModal\').remove()">✕ 닫기</button>' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:10px">' +
    '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:end">' +
    '<div><label class="fl">현재 번호</label><input type="text" class="si" value="' + eH(orderNo) + '" readonly style="padding-left:10px;background:var(--bg-i)"></div>' +
    '<div style="padding-bottom:8px;color:var(--t5);font-size:14px">→</div>' +
    '<div><label class="fl">새 번호 *</label><input type="text" class="si" id="rnNewNo" placeholder="예: A25030" style="padding-left:10px"></div>' +
    '</div>' +
    '<div><label class="fl">변경 사유 * <span style="color:var(--t6);font-weight:400">(감사 로그에 기록됩니다)</span></label>' +
    '<textarea class="si" id="rnReason" rows="2" placeholder="예: 고객사 발주번호 정정 요청" style="padding:8px 10px;resize:vertical"></textarea></div>' +
    '<div style="background:var(--bg-i);border:1px solid var(--bd);border-radius:8px;padding:10px">' +
    '<div style="font-size:11px;font-weight:600;color:var(--t3)">함께 갱신되는 항목</div>' +
    '<div id="rnRefs" style="font-size:10px;color:var(--t6);margin-top:4px">확인 중...</div>' +
    '</div>' +
    '<div style="background:var(--bg-i);border:1px solid var(--bd);border-radius:8px;padding:10px">' +
    '<div style="font-size:11px;font-weight:600;color:var(--t3);margin-bottom:2px">📜 번호 변경 이력</div>' +
    '<div id="rnHistory" style="max-height:130px;overflow:auto"><div style="font-size:10px;color:var(--t6);padding:6px 0">불러오는 중...</div></div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:2px">' +
    '<button class="btn btn-g" onclick="document.getElementById(\'renumberModal\').remove()">취소</button>' +
    '<button class="btn btn-p" id="rnSubmit" onclick="submitRenumber(\'' + _orderJsStr(orderNo) + '\', ' + (version === undefined || version === null ? 'null' : Number(version)) + ')">번호 변경 적용</button>' +
    '</div></div></div>';

  var noEl = document.getElementById('rnNewNo');
  if (noEl) noEl.focus();

  orderReferences(orderNo).then(function (refs) {
    var el = document.getElementById('rnRefs');
    if (el) el.innerHTML = _renumberRefsHTML(refs);
  }).catch(function (err) {
    var el = document.getElementById('rnRefs');
    if (el) el.textContent = '영향 범위를 불러오지 못했습니다: ' + ((err && err.message) || '오류');
  });

  orderRenumberHistory(orderNo).then(function (logs) {
    var el = document.getElementById('rnHistory');
    if (el) el.innerHTML = _renumberHistoryHTML(logs);
  }).catch(function () {
    var el = document.getElementById('rnHistory');
    if (el) el.innerHTML = '<div style="font-size:10px;color:var(--t6);padding:6px 0">이력을 불러오지 못했습니다.</div>';
  });
}

function submitRenumber(orderNo, version) {
  var newNo = (document.getElementById('rnNewNo').value || '').trim();
  var reason = (document.getElementById('rnReason').value || '').trim();

  if (!newNo) { showToast('새 수주번호를 입력하세요', 'error'); return; }
  if (newNo === orderNo) { showToast('기존 수주번호와 동일합니다', 'warn'); return; }
  if (!/^[\w.\-\/가-힣]+$/.test(newNo)) { showToast('수주번호에 공백·특수문자는 쓸 수 없습니다', 'error'); return; }
  if (reason.length < 2) { showToast('변경 사유를 2자 이상 입력하세요', 'error'); return; }
  if (!confirm('수주번호를 "' + orderNo + '" → "' + newNo + '" 로 변경합니다.\n연결된 프로젝트·이슈·업무일지·A/S·사전검토가 모두 새 번호로 갱신됩니다.\n\n계속하시겠습니까?')) return;

  var btn = document.getElementById('rnSubmit');
  if (btn) { btn.disabled = true; btn.textContent = '변경 중...'; }

  orderRenumber(orderNo, newNo, reason, version).then(function (r) {
    var modal = document.getElementById('renumberModal');
    if (modal) modal.remove();
    var om = document.getElementById('orderModal');
    if (om) om.remove();
    showToast('✅ ' + ((r && r.message) || '수주번호 변경 완료'), 'success');
    renderOrders();
    if (typeof invalidateOrderInfoCache === 'function') invalidateOrderInfoCache();
    if (typeof gfInvalidate === 'function') gfInvalidate();
    if (typeof rFL === 'function') rFL();
    if (typeof upV === 'function') upV();
    if (typeof renderPipeline === 'function' && document.getElementById('mPipeline') && !document.getElementById('mPipeline').classList.contains('hidden')) renderPipeline();
  }).catch(function (err) {
    if (btn) { btn.disabled = false; btn.textContent = '번호 변경 적용'; }
    console.error('[submitRenumber]', err);
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (err && err.status === 403) msg = '수주 편집 권한이 없습니다. 관리자에게 문의하세요.';
    if (err && err.status === 404) msg = '서버 배포 후 사용할 수 있습니다.';
    showToast('❌ 번호 변경 실패: ' + msg, 'error');
  });
}

/* ═══ 수주 삭제 ═══ */
function confirmDeleteOrder(orderNo) {
  if (!confirm('수주 "' + orderNo + '"를 삭제하시겠습니까?\n(연결된 프로젝트는 삭제되지 않습니다)')) return;
  deleteOrder(orderNo).then(function () {
    showToast('🗑️ 수주 삭제 완료', 'success');
    renderOrders();
  }).catch(function (err) {
    console.error('[confirmDeleteOrder]', err);
    showToast('❌ 오류: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

/* ═══ ORDER_MAP → DB 동기화 ═══ */
function syncOrdersToDB() {
  syncOrderMapToDB().then(function () {
    showToast('✅ ORDER_MAP → DB 동기화 완료', 'success');
    renderOrders();
  });
}

/* ═══ 엑셀 불러오기 후 DB 동기화 ═══
   예전에는 여기서 500ms 뒤에 syncOrderMapToDB() 를 한 번 더 호출했다.
   handleOrderExcel(업무일지_분석기.html) 이 이미 동기화·재렌더·오류 토스트까지 하므로
   중복 호출은 같은 배치를 두 번 밀어넣어 결과 보고만 어긋나게 만든다 → 제거. */

/* ═══ 크로스탭 이동: 수주대장 → 이슈관리 (v13.39 M1) ═══
   이슈 배지 클릭 시 이슈관리 탭으로 전환 + 해당 수주(orderNo)로 필터 자동 적용 */
function gotoIssuesForOrder(orderNo) {
  if (!orderNo) return;
  // 다른 이슈 필터는 초기화하여 결과가 0건이 되지 않도록 — issueClearFilters() 는 즉시 렌더하므로
  // 호출하지 않고 변수만 직접 리셋한 뒤, 탭 전환 시 한 번만 렌더한다.
  if (typeof issueFilterPhase !== 'undefined') issueFilterPhase = '';
  if (typeof issueFilterDept !== 'undefined') issueFilterDept = '';
  if (typeof issueFilterType !== 'undefined') issueFilterType = '';
  if (typeof issueFilterStatus !== 'undefined') issueFilterStatus = '';
  if (typeof issueFilterUrgency !== 'undefined') issueFilterUrgency = '';
  if (typeof issueFilterProject !== 'undefined') issueFilterProject = '';
  if (typeof issueSearchKw !== 'undefined') issueSearchKw = '';
  // 수주번호 필터 적용
  if (typeof issueFilterOrderNo !== 'undefined') {
    issueFilterOrderNo = orderNo;
  } else {
    window.issueFilterOrderNo = orderNo;
  }
  // 탭 캐시 무효화 → setMode('issues') 가 새 필터로 정확히 1회 렌더
  if (window._modeRendered) delete window._modeRendered.issues;
  var switched = false;
  try {
    if (typeof setPage === 'function' && (typeof curPage === 'undefined' || curPage !== 'project')) setPage('project');
    if (typeof setMode === 'function') { setMode('issues'); switched = true; }
  } catch (e) { console.warn('[gotoIssuesForOrder] tab switch err:', e); }
  if (!switched && typeof renderIssues === 'function') renderIssues();
  if (typeof showToast === 'function') showToast('수주 ' + orderNo + ' 이슈만 표시 중', 'info');
}
