/**
 * A/S 관리 — 접수 등록/편집 모달 (분할 3/7)
 * showASModal · 폼 필드 헬퍼 · 재발 이력 사이드바 · 장비 마스터 조회
 * AI 분석 보조 · 모달 첨부 그리드(업로드/대기 큐) · saveASModal
 * (원래 as-manager.js 에서 순수 이동 — 동작 변화 없음)
 */

/* ═══ 접수 등록/편집 모달 ═══ */
function showASModal(editId) {
  var PRIO = typeof AS_PRIORITY !== 'undefined' ? AS_PRIORITY : {};
  var CHAN = typeof AS_CHANNEL !== 'undefined' ? AS_CHANNEL : {};
  var METH = typeof AS_METHOD !== 'undefined' ? AS_METHOD : {};
  var REPRO = typeof AS_REPRODUCTION !== 'undefined' ? AS_REPRODUCTION : {};
  var FREQ = typeof AS_FREQUENCY !== 'undefined' ? AS_FREQUENCY : {};

  var pOrders = (typeof orderGetAll === 'function') ? orderGetAll() : Promise.resolve([]);
  var pExist  = editId ? asGet(editId) : Promise.resolve(null);
  var pCats   = _asLoadCats();
  // 편집 모드면 첨부도 함께 로드
  var pAtts   = (editId && typeof asAttachmentGetAll === 'function')
                  ? asAttachmentGetAll(editId).catch(function () { return []; })
                  : Promise.resolve([]);

  // 신규 모달용 임시 첨부 큐 초기화
  window._asPendingAttachments = [];

  Promise.all([pOrders, pExist, pCats, pAtts]).then(function (results) {
    var orders = results[0] || [];
    var existing = results[1];
    var CAT = results[2] || {};
    var existingAtts = results[3] || [];
    var isEdit = !!existing;

    document.querySelectorAll('#asModalOverlay').forEach(function (el) { el.remove(); });

    var h = '';
    h += '<div style="background:var(--bg);border:1px solid var(--bd);border-radius:10px;width:760px;max-width:100%;padding:20px 24px;color:var(--t2);box-shadow:0 10px 40px rgba(0,0,0,0.4)">';

    // 헤더
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--bd)">';
    h += '<div><div style="font-size:14px;font-weight:700">🛠️ ' + (isEdit ? 'A/S 접수 편집' : '새 A/S 접수') + '</div>';
    if (isEdit) h += '<div style="font-size:11px;color:var(--t5);margin-top:2px;font-family:monospace">' + _asEsc(existing.ticketNo) + '</div>';
    h += '</div>';
    h += '<button onclick="document.getElementById(\'asModalOverlay\').remove()" style="border:none;background:none;font-size:18px;cursor:pointer;color:var(--t5)">✕</button>';
    h += '</div>';

    // 1. 고객·장비 섹션
    h += _asSection('① 고객 및 장비 정보');
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">';
    h += _asField('고객사 *', '<input id="asM_customerName" type="text" value="' + _asEsc(existing && existing.customerName || '') + '" placeholder="예: 코아비스" ' + _asInpStyle() + '>');
    h += _asField('사이트/라인', '<input id="asM_siteLine" type="text" value="' + _asEsc(existing && existing.siteLine || '') + '" placeholder="예: 세종시 1공장" ' + _asInpStyle() + '>');
    h += _asField('연락처', '<input id="asM_customerContact" type="text" value="' + _asEsc(existing && existing.customerContact || '') + '" placeholder="고객 담당자 이름·연락처" ' + _asInpStyle() + '>');
    h += _asField('수주번호 연결', _asOrderSelect(orders, existing && existing.orderNo));
    h += _asField('장비모델', '<input id="asM_equipmentModel" type="text" value="' + _asEsc(existing && existing.equipmentModel || '') + '" placeholder="예: Laser Trimming System" ' + _asInpStyle() + '>');
    h += _asField('장비번호 (Prj No.)', '<input id="asM_equipmentNo" type="text" value="' + _asEsc(existing && existing.equipmentNo || '') + '" placeholder="예: A25065" ' + _asInpStyle() + '>');
    h += _asField('Serial No. <span style="color:var(--t6);font-size:9px">(입력 후 Tab — 마스터에서 자동 채움)</span>',
      '<input id="asM_serialNo" type="text" value="' + _asEsc(existing && existing.serialNo || '') + '" onblur="_asEquipLookup(this.value)" ' + _asInpStyle() + '>');
    h += _asField('설치일', '<input id="asM_installDate" type="date" value="' + _asEsc(existing && existing.installDate ? String(existing.installDate).slice(0, 10) : '') + '" ' + _asInpStyle() + '>');
    h += '</div>';

    // 2. 접수 섹션
    h += _asSection('② 접수 정보');
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">';
    var nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    // datetime-local 은 로컬 시각을 받는다 — 저장된 UTC 타임스탬프를 로컬로 바꿔 넣어야 편집·저장 때마다 9시간씩 밀리지 않는다
    var _recD = existing && existing.receivedAt ? new Date(existing.receivedAt) : null;
    var recVal = _recD && !isNaN(_recD.getTime()) ? new Date(_recD.getTime() - _recD.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : nowLocal;
    h += _asField('접수일시 *', '<input id="asM_receivedAt" type="datetime-local" value="' + _asEsc(recVal) + '" ' + _asInpStyle() + '>');
    h += _asField('접수경로', _asEnumSelect('asM_channel', CHAN, existing && existing.channel || 'phone'));
    h += _asField('긴급도 *', _asEnumSelect('asM_priority', PRIO, existing && existing.priority || 'P3'));
    h += _asField('카테고리', _asEnumSelect('asM_category', CAT, existing && existing.category || '', true));
    h += _asField('처리방식 (예정)', _asEnumSelect('asM_method', METH, existing && existing.method || '', true));
    h += _asField('보증여부', '<select id="asM_warrantyStatus" ' + _asInpStyle() + '>' +
      ['', '보증 내', '보증 종료', '확인 필요'].map(function (v) {
        return '<option value="' + v + '"' + ((existing && existing.warrantyStatus) === v ? ' selected' : '') + '>' + (v || '선택') + '</option>';
      }).join('') + '</select>');
    h += '</div>';

    // 3. 증상 + 1차분석
    h += _asSection('③ 신고 내용 + 1차 분석');
    h += '<div style="margin-bottom:10px">';
    h += '<label style="display:block;font-size:11px;color:var(--t4);margin-bottom:4px">고객 신고 내용 (증상) *</label>';
    h += '<textarea id="asM_issueSummary" rows="3" placeholder="고객이 호소한 증상 원문을 그대로 기록 (예: 장비마다 저항값이 다름, Calibration 필요)" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;resize:vertical">' + _asEsc(existing && existing.issueSummary || '') + '</textarea>';
    h += '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1.4fr 1fr;gap:10px;margin-bottom:10px">';
    h += _asField('재현 여부', _asEnumSelect('asM_reproduction', REPRO, existing && existing.reproduction || '', true));
    // 발생 빈도 + 회수(횟수) 결합 — "시간당 [2] 회"
    var freqVal = existing && existing.frequency || '';
    var freqCntVal = existing && existing.frequencyCount != null ? existing.frequencyCount : '';
    var freqInline = '<div style="display:flex;gap:4px;align-items:center">';
    freqInline += '<select id="asM_frequency" onchange="_asFreqToggleCount()" ' + _asInpStyle() + '>';
    freqInline += '<option value=""' + (!freqVal ? ' selected' : '') + '>선택</option>';
    Object.keys(FREQ).forEach(function (k) {
      freqInline += '<option value="' + k + '"' + (freqVal === k ? ' selected' : '') + '>' + _asEsc(FREQ[k].label) + '</option>';
    });
    freqInline += '</select>';
    var cntHidden = (!freqVal || freqVal === 'irregular') ? 'display:none;' : '';
    freqInline += '<input id="asM_frequencyCount" type="number" min="0" step="0.5" value="' + _asEsc(freqCntVal) + '" placeholder="회수" style="' + cntHidden + 'width:80px;padding:5px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;box-sizing:border-box" title="예: 시간당 2회 → 빈도=시간당, 회수=2">';
    freqInline += '<span id="asM_frequencyUnit" style="' + cntHidden + 'font-size:10px;color:var(--t5);white-space:nowrap">회</span>';
    freqInline += '</div>';
    h += _asField('발생 빈도 (+ 회수)', freqInline);
    h += _asField('영향 범위', '<input id="asM_impactScope" type="text" value="' + _asEsc(existing && existing.impactScope || '') + '" placeholder="예: 라인 1개 / 전체" ' + _asInpStyle() + '>');
    h += '</div>';
    h += '<div style="margin-bottom:14px">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">';
    h += '<label style="font-size:11px;color:var(--t4)">1차 분석 (CS/공정 메모)</label>';
    h += '<button type="button" onclick="_asAiAnalyzeClick()" style="font-size:10px;padding:3px 10px;border:1px solid #8B5CF6;border-radius:4px;background:transparent;color:#8B5CF6;cursor:pointer;font-weight:600" title="Claude AI가 신고 내용으로 카테고리·RCA·재발방지 초안을 작성합니다">🤖 AI 분석 (Claude)</button>';
    h += '</div>';
    h += '<textarea id="asM_initialAnalysis" rows="2" placeholder="첫 통화/원격 진단 결과를 메모 (선택)" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;resize:vertical">' + _asEsc(existing && existing.initialAnalysis || '') + '</textarea>';
    h += '<div id="asM_aiStatus" style="font-size:10px;color:var(--t5);margin-top:4px;min-height:14px"></div>';
    h += '</div>';

    // ④ 첨부 파일 (이미지·문서 다중 업로드 + 카드 그리드 + 클릭 미리보기)
    h += _asSection('④ 첨부 파일 ' + (isEdit ? '<span style="color:var(--t6);font-weight:400;font-size:10px">— 이미지·캡처·PDF·문서 (선택 즉시 업로드, 10MB 이하)</span>' : '<span style="color:var(--t6);font-weight:400;font-size:10px">— 접수 등록 후 일괄 업로드 (10MB 이하 다중 선택 가능)</span>'));
    h += '<div style="margin-bottom:14px">';
    h += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">';
    h += '<input id="asM_attachInput" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.log,.zip" onchange="_asModalAttachPicked(event,\'' + (isEdit ? _asJsArg(editId) : '') + '\')" style="font-size:11px;flex:1;min-width:240px">';
    h += '<span style="font-size:9px;color:var(--t6)">여러 파일을 한 번에 선택 가능 (Ctrl/Shift)</span>';
    h += '</div>';
    h += '<div id="asM_attachGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;min-height:60px">';
    h += _asRenderAttachGridHtml(existingAtts, isEdit ? editId : null, false);
    h += '</div>';
    h += '<div id="asM_attachStatus" style="font-size:10px;color:var(--t5);margin-top:6px;min-height:14px"></div>';
    h += '</div>';

    // 액션
    h += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:14px;border-top:1px solid var(--bd)">';
    h += '<div>';
    if (isEdit) {
      h += '<button onclick="asSoftDeleteTicket(\'' + _asJsArg(editId) + '\',\'' + _asJsArg(existing.ticketNo) + '\')" style="padding:8px 14px;border:1px solid ' + SEM_COLOR.danger + ';border-radius:6px;background:transparent;color:' + SEM_COLOR.danger + ';cursor:pointer;font-size:11px" title="휴지통으로 이동 (복구 가능)">🗑️ 휴지통으로 이동</button>';
    }
    h += '</div><div style="display:flex;gap:8px">';
    h += '<button onclick="document.getElementById(\'asModalOverlay\').remove()" style="padding:8px 16px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer;font-size:11px">취소</button>';
    h += '<button onclick="saveASModal(' + (isEdit ? 'true' : 'false') + ',\'' + (isEdit ? _asJsArg(editId) : '') + '\')" style="padding:8px 16px;border:none;border-radius:6px;background:#F59E0B;color:#fff;cursor:pointer;font-size:11px;font-weight:600">' + (isEdit ? '수정 저장' : '접수 등록') + '</button>';
    h += '</div></div>';
    h += '</div>';

    var overlay = _asOverlay('asModalOverlay', 9999, 'align-items:flex-start;padding:40px 20px;overflow-y:auto');
    overlay.innerHTML = h;
    // v13.63: backdrop 클릭 닫기 비활성화 — 작업 중 실수 클릭 데이터 유실 방지 (✕ 버튼만 닫기)
  }).catch(function (err) {
    console.error('[showASModal]', err);
    if (typeof showToast === 'function') showToast('A/S 모달 로드 실패', 'error');
  });
}

function _asSection(title) {
  return '<div style="font-size:11px;font-weight:700;color:var(--t3);margin:8px 0 6px;padding-bottom:4px;border-bottom:1px dashed var(--bd)">' + title + '</div>';
}
function _asField(label, control) {
  return '<div><label style="display:block;font-size:10px;color:var(--t4);margin-bottom:3px">' + label + '</label>' + control + '</div>';
}
function _asInpStyle() {
  return 'style="width:100%;padding:5px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;box-sizing:border-box"';
}
function _asEnumSelect(id, options, curVal, allowEmpty) {
  var h = '<select id="' + id + '" ' + _asInpStyle() + '>';
  if (allowEmpty) h += '<option value=""' + (!curVal ? ' selected' : '') + '>선택</option>';
  Object.keys(options).forEach(function (k) {
    var o = options[k];
    h += '<option value="' + _asEsc(k) + '"' + (curVal === k ? ' selected' : '') + '>' + _asEsc(o.icon || '') + ' ' + _asEsc(o.label) + '</option>';
  });
  h += '</select>';
  return h;
}
function _asFreqToggleCount() {
  var sel = document.getElementById('asM_frequency');
  var inp = document.getElementById('asM_frequencyCount');
  var unit = document.getElementById('asM_frequencyUnit');
  if (!sel || !inp) return;
  var v = sel.value;
  var hide = !v || v === 'irregular';
  inp.style.display = hide ? 'none' : '';
  if (unit) unit.style.display = hide ? 'none' : '';
  if (hide) inp.value = '';
}

function _asOrderSelect(orders, curOrderNo) {
  var h = '<select id="asM_orderNo" ' + _asInpStyle() + '>';
  h += '<option value="">(연결 없음)</option>';
  (orders || []).forEach(function (o) {
    var no = o.orderNo || o.order_no || '';
    if (!no) return;
    var label = no + (o.client || o.customer ? ' · ' + (o.client || o.customer) : '') + (o.title ? ' · ' + o.title : '');
    h += '<option value="' + _asEsc(no) + '"' + (curOrderNo === no ? ' selected' : '') + '>' + _asEsc(label) + '</option>';
  });
  h += '</select>';
  return h;
}

/* 재발 이력 사이드바 — 같은 Serial/장비번호의 과거 A/S 자동 로드 */
function _asLoadRecurrences(ticketId) {
  if (typeof asRecurrencesGet !== 'function') return;
  asRecurrencesGet(ticketId).then(function (res) {
    var list = res.data || [];
    var listEl = document.getElementById('asRecurList');
    var cntEl = document.getElementById('asRecurCount');
    if (!listEl) return;
    if (cntEl) cntEl.textContent = list.length ? list.length + '건 발견' : '없음 (첫 접수)';
    if (!list.length) {
      listEl.innerHTML = '<div style="padding:10px;color:var(--t5);font-size:11px">이 장비/Serial로 등록된 과거 A/S가 없습니다 — <strong>첫 접수</strong>입니다.</div>';
      return;
    }
    var STATUS = typeof AS_STATUS !== 'undefined' ? AS_STATUS : {};
    var PRIO = typeof AS_PRIORITY !== 'undefined' ? AS_PRIORITY : {};
    var CAT = _asCats();
    var html = '<div style="display:flex;flex-direction:column;gap:5px;max-height:200px;overflow-y:auto">';
    list.forEach(function (r) {
      var st = STATUS[r.status] || { label: r.status, color: SEM_COLOR.muted };
      var pr = PRIO[r.priority] || { label: r.priority, color: SEM_COLOR.muted };
      var ct = CAT[r.category] || { label: r.category || '-' };
      html += '<div style="display:flex;gap:8px;align-items:center;padding:6px 8px;background:var(--bg);border-radius:4px;font-size:11px;cursor:pointer" onclick="showASDetail(\'' + _asEsc(r.id) + '\')" title="클릭하면 상세 열기">';
      html += '<span style="font-family:monospace;font-weight:600;color:var(--t3);min-width:115px">' + _asEsc(r.ticketNo) + '</span>';
      html += '<span style="color:var(--t5);font-size:10px;min-width:78px">' + _asFmtDate(r.receivedAt) + '</span>';
      html += '<span style="padding:1px 5px;border-radius:6px;background:' + pr.color + ';color:#fff;font-size:9px;font-weight:600">' + _asEsc(r.priority) + '</span>';
      html += '<span style="padding:1px 5px;border-radius:6px;background:' + st.color + '22;color:' + st.color + ';font-size:9px;font-weight:600">' + _asEsc(st.label) + '</span>';
      html += '<span style="color:var(--t4);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _asEsc(ct.label) + ' · ' + _asEsc((r.issueSummary || '').slice(0, 40)) + '</span>';
      if (r.closure) html += '<span style="color:var(--t6);font-size:10px">' + _asEsc(r.closure) + '</span>';
      html += '</div>';
    });
    html += '</div>';
    // 같은 증상 자동 감지: 카테고리가 같은 게 2건 이상이면 알림
    var sameCatCount = {};
    list.forEach(function (r) { if (r.category) sameCatCount[r.category] = (sameCatCount[r.category] || 0) + 1; });
    var topCat = null, topCnt = 0;
    Object.keys(sameCatCount).forEach(function (k) { if (sameCatCount[k] > topCnt) { topCnt = sameCatCount[k]; topCat = k; } });
    if (topCnt >= 2) {
      var catLabel = (CAT[topCat] || {}).label || topCat;
      html = '<div style="background:' + SEM_COLOR.danger + '15;border-left:3px solid ' + SEM_COLOR.danger + ';padding:6px 10px;font-size:10px;color:#DC2626;margin-bottom:6px;font-weight:600">⚠ 동일 카테고리 "' + _asEsc(catLabel) + '" ' + topCnt + '번 재발 — RCA·재발방지 우선 검토</div>' + html;
    }
    listEl.innerHTML = html;
  }).catch(function (err) {
    var el = document.getElementById('asRecurList');
    if (el) el.innerHTML = '<div style="color:' + SEM_COLOR.danger + ';font-size:10px">재발 이력 로드 실패: ' + _asEsc(err.message || '') + '</div>';
  });
}

/* Serial No. 입력 → 장비 마스터 조회 → 모달 필드 자동 채움 (빈 필드만) */
function _asEquipLookup(serial) {
  serial = (serial || '').trim();
  if (!serial || typeof asEquipmentBySerial !== 'function') return;
  asEquipmentBySerial(serial).then(function (eqp) {
    if (!eqp) return;
    var fillIfEmpty = function (id, val) {
      var el = document.getElementById(id);
      if (el && !el.value && val != null && val !== '') el.value = val;
    };
    fillIfEmpty('asM_equipmentModel', eqp.equipmentModel);
    fillIfEmpty('asM_equipmentNo', eqp.equipmentNo);
    fillIfEmpty('asM_customerName', eqp.customerName);
    fillIfEmpty('asM_siteLine', eqp.siteLine);
    if (eqp.installDate) fillIfEmpty('asM_installDate', String(eqp.installDate).slice(0, 10));
    fillIfEmpty('asM_warrantyStatus', eqp.warrantyStatus);
    if (typeof showToast === 'function') {
      showToast('🔧 장비 마스터에서 자동 채움: ' + (eqp.equipmentModel || serial), 'info');
    }
  }).catch(function () { /* 없으면 무시 */ });
}

/* ─── AI 분석 (Claude) — 신고 내용 → 카테고리·RCA·재발방지 초안 자동 채움 ───
 * "1차 분석" 텍스트박스에 AI 요약 + checkPoints 표시
 * 카테고리·긴급도 빈 필드는 AI 추정값으로 자동 채움 (이미 입력된 값은 보존)
 * RCA·재발방지는 ④보고 탭(상세)에 들어가므로, 여기서는 1차 분석 영역에 요약 형태로 출력
 */
function _asAiAnalyzeClick() {
  var status = document.getElementById('asM_aiStatus');
  if (!status) return;
  var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var issue = v('asM_issueSummary');
  if (!issue) {
    status.innerHTML = '<span style="color:' + SEM_COLOR.danger + '">⚠ 신고 내용(증상)을 먼저 입력하세요.</span>';
    return;
  }
  if (typeof asAiAnalyze !== 'function') {
    status.innerHTML = '<span style="color:' + SEM_COLOR.danger + '">⚠ AI API 미연결 (project-data.js)</span>';
    return;
  }
  status.innerHTML = '<span style="color:#8B5CF6">⏳ Claude가 분석 중…</span>';

  // 화려한 진행 모달 + 단계 메시지 시퀀스
  if (window.wmProgress) {
    wmProgress.show({
      icon: '🤖',
      title: 'Claude AI 분석 중',
      sub: '신고 내용을 분석하고 카테고리·RCA·재발방지 초안을 작성합니다.',
      tip: '평균 5~15초 소요됩니다. 모델: claude-opus-4-7 · adaptive thinking'
    });
    wmProgress.autoSteps([
      '📝 신고 내용 검토',
      '🏷️ 카테고리 후보 매칭',
      '🔍 근본원인(RCA) 추론',
      '🛡️ 재발방지 방안 작성',
      '✅ 결과 정리'
    ], 1800);
  }

  var payload = {
    issueSummary: issue,
    customerName: v('asM_customerName'),
    equipmentModel: v('asM_equipmentModel'),
    priority: v('asM_priority'),
    reproduction: v('asM_reproduction'),
    frequency: v('asM_frequency'),
    frequencyCount: v('asM_frequencyCount') ? Number(v('asM_frequencyCount')) : null,
    impactScope: v('asM_impactScope')
  };

  asAiAnalyze(payload).then(function (r) {
    if (window.wmProgress) wmProgress.hide();
    var d = r && r.data;
    if (!d) { status.innerHTML = '<span style="color:' + SEM_COLOR.danger + '">⚠ AI 응답 비어 있음</span>'; return; }

    // 빈 필드 자동 채움 (사용자 입력 우선)
    var catSel = document.getElementById('asM_category');
    if (catSel && !catSel.value && d.category) {
      // 옵션에 해당 코드가 있는지 확인 후 적용
      var opt = catSel.querySelector('option[value="' + d.category + '"]');
      if (opt) catSel.value = d.category;
    }
    var prioSel = document.getElementById('asM_priority');
    if (prioSel && d.priority && (!prioSel.value || prioSel.value === 'P3')) {
      var pOpt = prioSel.querySelector('option[value="' + d.priority + '"]');
      if (pOpt) prioSel.value = d.priority;
    }

    // 1차 분석 영역에 요약·RCA·재발방지 합쳐서 채움
    var combined = '';
    if (d.summary) combined += '【요약】 ' + d.summary + '\n\n';
    if (d.rcaDraft) combined += '【추정 RCA】\n' + d.rcaDraft + '\n\n';
    if (d.preventionDraft) combined += '【재발방지 초안】\n' + d.preventionDraft + '\n';
    if (d.checkPoints && d.checkPoints.length) {
      combined += '\n【현장 점검 권장】\n' + d.checkPoints.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n');
    }
    var ta = document.getElementById('asM_initialAnalysis');
    if (ta) {
      // 기존 내용이 있으면 줄바꿈 후 AI 결과 append
      var prev = (ta.value || '').trim();
      ta.value = prev ? (prev + '\n\n---\n[🤖 AI 분석]\n' + combined) : ('[🤖 AI 분석]\n' + combined);
    }

    var conf = d.categoryConfidence != null ? Math.round(d.categoryConfidence * 100) + '%' : '-';
    var usage = r.usage || {};
    status.innerHTML = '<span style="color:' + SEM_COLOR.ok + '">✅ Claude 분석 완료</span> · 카테고리 ' +
      _asEsc(d.category || '-') + ' (신뢰도 ' + conf + ') · 긴급도 ' + _asEsc(d.priority || '-') +
      ' · 토큰 in=' + (usage.input_tokens || 0) + ' out=' + (usage.output_tokens || 0);
  }).catch(function (err) {
    if (window.wmProgress) wmProgress.hide();
    var msg = (err && err.data && err.data.message) || (err && err.message) || '실패';
    status.innerHTML = '<span style="color:' + SEM_COLOR.danger + '">❌ ' + _asEsc(msg) + '</span>';
  });
}

/* ─── 모달 내 첨부 그리드 렌더 ───
 * 편집: 서버에서 받은 attachments 배열을 카드로
 * 신규: window._asPendingAttachments 임시 큐를 카드로 (id 없음, dataUrl만)
 */
function _asRenderAttachGridHtml(atts, ticketId, isPending) {
  var CAT = typeof AS_ATTACH_CATEGORY !== 'undefined' ? AS_ATTACH_CATEGORY : {};
  if (!atts || !atts.length) {
    return '<div style="grid-column:1/-1;padding:18px;text-align:center;color:var(--t5);font-size:11px;border:1px dashed var(--bd);border-radius:6px;background:var(--bg-i)">📎 첨부된 파일이 없습니다. 위 [파일 선택]에서 사진·캡처·문서를 추가하세요.</div>';
  }
  // 글로벌 인덱스에도 등록해서 preview 함수가 찾을 수 있도록 (편집 모드)
  if (ticketId) {
    window._asAttachIndex = window._asAttachIndex || {};
    window._asAttachIndex[ticketId] = atts;
  }
  var html = '';
  atts.forEach(function (a, idx) {
    var c = CAT[a.category] || { label: a.category || '기타', icon: '📎' };
    var isImg = _asAttIsImage(a);
    var isPdf = _asAttIsPdf(a);
    var clickHandler;
    var removeHandler;
    if (isPending) {
      clickHandler = '_asPendingAttachPreview(' + idx + ')';
      removeHandler = '_asPendingAttachRemove(' + idx + ')';
    } else {
      clickHandler = 'asAttachPreview(\'' + _asEsc(ticketId) + '\',\'' + _asEsc(a.id) + '\')';
      removeHandler = '_asModalAttachRemove(\'' + _asEsc(ticketId) + '\',\'' + _asEsc(a.id) + '\')';
    }
    html += '<div style="border:1px solid var(--bd);border-radius:6px;padding:6px;background:var(--bg-i);position:relative;cursor:pointer;transition:border-color 0.15s" onmouseover="this.style.borderColor=\'#F59E0B\'" onmouseout="this.style.borderColor=\'\'" onclick="' + clickHandler + '">';
    if (isImg) {
      html += '<div style="width:100%;height:70px;background:#0f172a center / contain no-repeat url(\'' + _asEsc(a.fileUrl) + '\');border-radius:3px;margin-bottom:4px"></div>';
    } else {
      html += '<div style="width:100%;height:70px;display:flex;align-items:center;justify-content:center;font-size:32px;background:var(--bg);border-radius:3px;margin-bottom:4px">' + (isPdf ? '📄' : (c.icon || '📎')) + '</div>';
    }
    html += '<div style="font-size:9px;color:var(--t5);margin-bottom:1px">' + (c.icon || '') + ' ' + _asEsc(c.label) + (isPending ? ' <span style="color:' + SEM_COLOR.warn + '">⏳대기</span>' : '') + '</div>';
    html += '<div style="font-size:10px;color:var(--t2);font-weight:600;word-break:break-all;line-height:1.25">' + _asEsc(a.fileName) + '</div>';
    if (a.fileSize) {
      var kb = Math.round(a.fileSize / 1024);
      html += '<div style="font-size:9px;color:var(--t6);margin-top:1px">' + (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB') + '</div>';
    }
    html += '<button onclick="event.stopPropagation();' + removeHandler + '" style="position:absolute;top:3px;right:3px;font-size:9px;padding:1px 5px;border:1px solid ' + SEM_COLOR.danger + ';border-radius:3px;background:rgba(255,255,255,0.9);color:' + SEM_COLOR.danger + ';cursor:pointer" title="삭제">×</button>';
    html += '</div>';
  });
  return html;
}

/* 모달 내 그리드 갱신 (편집 모드는 서버 재조회, 신규는 큐 기반) */
function _asRefreshModalAttachGrid(ticketId) {
  var grid = document.getElementById('asM_attachGrid');
  if (!grid) return;
  if (ticketId) {
    if (typeof asAttachmentGetAll !== 'function') return;
    asAttachmentGetAll(ticketId).then(function (atts) {
      grid.innerHTML = _asRenderAttachGridHtml(atts, ticketId, false);
    }).catch(function () { /* 무시 */ });
  } else {
    grid.innerHTML = _asRenderAttachGridHtml(window._asPendingAttachments || [], null, true);
  }
}

/* 다중 파일 선택 핸들러 — 편집 모드: 즉시 업로드 / 신규 모드: 큐에 보관 */
function _asModalAttachPicked(ev, ticketId) {
  var files = ev.target.files ? Array.from(ev.target.files) : [];
  if (!files.length) return;
  ev.target.value = '';  // 같은 파일 다시 선택 가능하도록 reset

  var status = document.getElementById('asM_attachStatus');
  var oversized = files.filter(function (f) { return f.size > 10 * 1024 * 1024; });
  if (oversized.length) {
    if (status) status.innerHTML = '<span style="color:' + SEM_COLOR.danger + '">⚠ 10MB 초과 파일 ' + oversized.length + '개 제외됨: ' + _asEsc(oversized.map(function (f) { return f.name; }).join(', ')) + '</span>';
    files = files.filter(function (f) { return f.size <= 10 * 1024 * 1024; });
    if (!files.length) return;
  }

  // 파일 → dataURL + 카테고리 추정
  var readers = files.map(function (f) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function (e) {
        var mt = (f.type || '').toLowerCase();
        var ext = (f.name.split('.').pop() || '').toLowerCase();
        var cat = 'etc';
        if (mt.indexOf('image/') === 0) cat = 'photo_before';
        else if (mt === 'application/pdf' || ext === 'pdf') cat = 'doc';
        else if (['doc','docx','xls','xlsx','ppt','pptx','txt','csv'].indexOf(ext) >= 0) cat = 'doc';
        else if (ext === 'log') cat = 'log';
        resolve({
          category: cat,
          fileName: f.name,
          fileUrl: e.target.result,
          fileSize: f.size,
          mimeType: f.type || null
        });
      };
      r.readAsDataURL(f);
    });
  });

  if (status) status.innerHTML = '<span style="color:var(--t5)">⏳ ' + files.length + '개 파일 처리 중…</span>';

  // 2개 이상 파일이거나 합계 2MB 초과면 진행 모달 표시
  var totalBytes = files.reduce(function (s, f) { return s + f.size; }, 0);
  var showProg = (files.length >= 2 || totalBytes >= 2 * 1024 * 1024) && window.wmProgress;
  if (showProg) {
    wmProgress.show({
      icon: '📎',
      title: ticketId ? files.length + '개 파일 업로드 중' : files.length + '개 파일 변환 중',
      sub: '전체 ' + (totalBytes >= 1024 * 1024 ? (totalBytes / 1024 / 1024).toFixed(1) + ' MB' : Math.round(totalBytes / 1024) + ' KB'),
      tip: ticketId ? '서버에 순차 업로드합니다. 큰 파일은 시간이 더 걸릴 수 있습니다.' : '접수 등록 시 서버에 일괄 업로드됩니다.'
    });
    wmProgress.step('📖 파일 읽기 중 (0/' + files.length + ')');
  }

  // FileReader 진행률 추적 — Promise.all에 카운터 wrapping
  var readDone = 0;
  var readersWrapped = readers.map(function (p) {
    return p.then(function (v) {
      readDone++;
      if (showProg) wmProgress.step('📖 파일 읽기 (' + readDone + '/' + files.length + ')');
      return v;
    });
  });

  Promise.all(readersWrapped).then(function (items) {
    if (ticketId) {
      // 편집 모드 — 서버에 즉시 일괄 업로드
      if (typeof asAttachmentPut !== 'function') {
        if (showProg) wmProgress.hide();
        if (status) status.innerHTML = '<span style="color:' + SEM_COLOR.danger + '">⚠ 첨부 API 미연결</span>';
        return;
      }
      var ok = 0, fail = 0;
      var seq = Promise.resolve();
      items.forEach(function (it, idx) {
        seq = seq.then(function () {
          if (showProg) wmProgress.update({
            step: '☁️ 서버 업로드 (' + (idx + 1) + '/' + items.length + ') · ' + it.fileName.slice(0, 28)
          });
          return asAttachmentPut(ticketId, it).then(function () { ok++; }, function () { fail++; });
        });
      });
      seq.then(function () {
        if (showProg) wmProgress.hide();
        if (status) status.innerHTML = '<span style="color:' + (fail ? SEM_COLOR.warn : SEM_COLOR.ok) + '">✅ ' + ok + '개 업로드' + (fail ? ' · ❌ ' + fail + '개 실패' : '') + '</span>';
        _asRefreshModalAttachGrid(ticketId);
        if (typeof showToast === 'function') showToast('📎 ' + ok + '개 첨부 업로드 완료');
      });
    } else {
      // 신규 모드 — 임시 큐에 누적
      if (showProg) wmProgress.hide();
      window._asPendingAttachments = (window._asPendingAttachments || []).concat(items);
      if (status) status.innerHTML = '<span style="color:' + SEM_COLOR.warn + '">⏳ ' + items.length + '개 추가됨 — 접수 등록 시 함께 업로드됩니다 (총 ' + window._asPendingAttachments.length + '개 대기)</span>';
      _asRefreshModalAttachGrid(null);
    }
  });
}

/* 편집 모달에서 기존 첨부 삭제 — 서버 즉시 반영 */
function _asModalAttachRemove(ticketId, aid) {
  if (!confirm('이 첨부를 삭제하시겠습니까?')) return;
  if (typeof asAttachmentDel !== 'function') return;
  asAttachmentDel(ticketId, aid).then(function () {
    if (typeof showToast === 'function') showToast('첨부가 삭제되었습니다.');
    _asRefreshModalAttachGrid(ticketId);
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('❌ 삭제 실패: ' + ((err && err.message) || ''), 'error');
  });
}

/* 신규 모달 — 임시 큐 항목 제거 / 미리보기 */
function _asPendingAttachRemove(idx) {
  if (!window._asPendingAttachments) return;
  window._asPendingAttachments.splice(idx, 1);
  _asRefreshModalAttachGrid(null);
  var status = document.getElementById('asM_attachStatus');
  if (status) status.innerHTML = '<span style="color:var(--t5)">대기 ' + window._asPendingAttachments.length + '개</span>';
}
function _asPendingAttachPreview(idx) {
  var a = (window._asPendingAttachments || [])[idx];
  if (!a) return;
  // _asRenderAttachPreview 가 fileUrl/fileName/category/note/uploadedAt 등을 읽음
  _asRenderAttachPreview({
    fileName: a.fileName,
    fileUrl: a.fileUrl,
    category: a.category,
    mimeType: a.mimeType,
    note: '⏳ 등록 전 — 접수 저장 시 업로드됩니다',
    uploadedAt: new Date().toISOString()
  });
}

function saveASModal(isEdit, editId) {
  var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var data = {
    customerName: v('asM_customerName'),
    siteLine: v('asM_siteLine'),
    customerContact: v('asM_customerContact'),
    orderNo: v('asM_orderNo'),
    equipmentModel: v('asM_equipmentModel'),
    equipmentNo: v('asM_equipmentNo'),
    serialNo: v('asM_serialNo'),
    installDate: v('asM_installDate') || null,
    receivedAt: v('asM_receivedAt') ? new Date(v('asM_receivedAt')).toISOString() : null,
    channel: v('asM_channel'),
    priority: v('asM_priority') || 'P3',
    category: v('asM_category'),
    method: v('asM_method'),
    warrantyStatus: v('asM_warrantyStatus'),
    issueSummary: v('asM_issueSummary'),
    reproduction: v('asM_reproduction'),
    frequency: v('asM_frequency'),
    frequencyCount: (function () {
      var raw = v('asM_frequencyCount');
      if (raw === '' || v('asM_frequency') === 'irregular') return null;
      var n = Number(raw);
      return isNaN(n) ? null : n;
    })(),
    impactScope: v('asM_impactScope'),
    initialAnalysis: v('asM_initialAnalysis')
  };

  if (!data.customerName) { if (typeof showToast === 'function') showToast('고객사를 입력하세요.', 'warn'); return; }
  if (!data.issueSummary) { if (typeof showToast === 'function') showToast('신고 내용(증상)을 입력하세요.', 'warn'); return; }

  var promise = (isEdit && editId) ? updateASTicket(editId, data) : createASTicket(data);

  promise.then(function (saved) {
    // 신규 등록 성공 + 임시 첨부 큐가 있으면 일괄 업로드
    var pending = (!isEdit && saved && saved.id && Array.isArray(window._asPendingAttachments) && window._asPendingAttachments.length)
      ? window._asPendingAttachments.slice() : [];
    window._asPendingAttachments = [];

    var afterAttach = Promise.resolve();
    if (pending.length && typeof asAttachmentPut === 'function') {
      if (typeof showToast === 'function') showToast('📎 ' + pending.length + '개 첨부 업로드 중…', 'info');
      // 순차 업로드 (서버 부담 방지)
      pending.forEach(function (att) {
        afterAttach = afterAttach.then(function () {
          return asAttachmentPut(saved.id, att).catch(function (e) {
            console.warn('[attach upload]', att.fileName, e.message);
          });
        });
      });
    }

    afterAttach.then(function () {
      var ov = document.getElementById('asModalOverlay');
      if (ov) ov.remove();
      if (typeof showToast === 'function') {
        var attachMsg = pending.length ? ' · 📎 ' + pending.length + '개 첨부' : '';
        showToast(isEdit
          ? 'A/S가 수정되었습니다.'
          : 'A/S가 접수되었습니다. ' + (saved && saved.ticketNo ? '(' + saved.ticketNo + ')' : '') + attachMsg);
      }
      renderAS();
    });
  }).catch(function (err) {
    console.error('[saveASModal]', err);
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (err && err.status === 403) msg = '권한이 없습니다.';
    if (typeof showToast === 'function') showToast('❌ 저장 실패: ' + msg, 'error');
  });
}
