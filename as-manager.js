/**
 * 업무 관리자 — A/S 관리 모듈 (v1, 수직 슬라이스: 접수만)
 * 접수 카드 목록 + 신규 접수 모달
 * PRD: docs/PRD_AS_접수보고서.md
 */

/* ═══ 상태 변수 ═══ */
var asFilterStatus = '';
var asFilterPriority = '';
var asFilterCategory = '';
var asSearchKw = '';

/* ═══ 카테고리 캐시 (DB의 as_categories 테이블에서 동적 로드) ═══
 * active=true 항목만 캐시. 관리자 화면에서는 별도로 includeInactive=true 로 다시 조회.
 * 형식: [{ id, code, label, icon, sortOrder, active }, ...] (sortOrder ASC 정렬)
 * 폴백: config.js AS_CATEGORY (서버 통신 실패 / 부팅 직후 / 로컬 환경) */
var _AS_CAT_CACHE = null;
var _AS_CAT_LOADING = null;

function _asCats() {
  // 캐시가 있으면 그대로, 없으면 AS_CATEGORY fallback을 객체로 변환
  if (_AS_CAT_CACHE && _AS_CAT_CACHE.length) {
    var out = {};
    _AS_CAT_CACHE.forEach(function (c) { out[c.code] = { label: c.label, icon: c.icon || '' }; });
    return out;
  }
  return typeof AS_CATEGORY !== 'undefined' ? AS_CATEGORY : {};
}

function _asLoadCats(force) {
  if (typeof asCategoryGetAll !== 'function') return Promise.resolve(_asCats());
  if (!force && _AS_CAT_CACHE) return Promise.resolve(_asCats());
  if (_AS_CAT_LOADING) return _AS_CAT_LOADING;
  _AS_CAT_LOADING = asCategoryGetAll(false).then(function (rows) {
    _AS_CAT_CACHE = rows || [];
    _AS_CAT_LOADING = null;
    return _asCats();
  }).catch(function (err) {
    console.warn('[as] 카테고리 로드 실패 — fallback 사용', err && err.message);
    _AS_CAT_LOADING = null;
    return _asCats();
  });
  return _AS_CAT_LOADING;
}

function _asFreqDisplay(freqCode, count) {
  var FREQ = typeof AS_FREQUENCY !== 'undefined' ? AS_FREQUENCY : {};
  var f = FREQ[freqCode];
  if (!f) return freqCode || '';
  // 비정규적은 회수 무관, 그 외엔 회수 결합
  if (freqCode === 'irregular') return f.label;
  if (count == null || count === '' || isNaN(Number(count))) return f.label;
  // 시간당 회수 → 시간당 2회 형태
  var base = f.label.replace(/\s*회수\s*$/, '');
  return base + ' ' + Number(count) + '회';
}

function _asAdminOnly() {
  return typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin';
}

/* ═══ 헬퍼 ═══ */
function _asEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _asFmtDate(iso) {
  if (!iso) return '-';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}
function _asFmtDT(iso) {
  if (!iso) return '-';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return _asFmtDate(iso) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function _asElapsed(iso) {
  if (!iso) return '';
  var diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff) || diff < 0) return '';
  var h = Math.floor(diff / 3600000);
  if (h < 1) return Math.floor(diff / 60000) + '분 전';
  if (h < 24) return h + '시간 전';
  return Math.floor(h / 24) + '일 전';
}

/* ═══ 메인 렌더링 ═══ */
function renderAS() {
  var wrap = document.getElementById('asWrap');
  if (!wrap) return;

  var STATUS = typeof AS_STATUS !== 'undefined' ? AS_STATUS : {};
  var PRIO   = typeof AS_PRIORITY !== 'undefined' ? AS_PRIORITY : {};

  if (typeof asGetAll !== 'function') {
    wrap.innerHTML = '<div class="pnl" style="padding:24px;text-align:center;color:var(--t5)">A/S 데이터 로직 로드 실패 (project-data.js)</div>';
    return;
  }

  Promise.all([asGetAll(), _asLoadCats()]).then(function (results) {
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
    html += '<div style="display:flex;align-items:center;gap:10px">';
    html += '<span style="font-size:13px;font-weight:700;color:var(--t2)">🛠️ A/S 접수 관리</span>';
    html += '<span style="font-size:11px;color:var(--t5)">전체 ' + all.length + '건' +
      (filtered.length !== all.length ? ' (필터: ' + filtered.length + '건)' : '') + '</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:6px">';
    if (_asAdminOnly()) {
      html += '<button onclick="showASCategoryAdmin()" style="font-size:11px;padding:4px 10px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer" title="관리자 전용 — 카테고리 추가·수정·비활성화">⚙️ 카테고리 관리</button>';
    }
    html += '<button onclick="showASModal()" style="font-size:11px;padding:4px 12px;border:none;border-radius:6px;background:#F59E0B;color:#fff;cursor:pointer;font-weight:600">+ 새 접수</button>';
    html += '</div></div></div>';

    // 요약 카드
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">';
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
      '" oninput="asSearchKw=this.value;renderAS()" style="font-size:11px;padding:4px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t2);min-width:180px">';
    if (asFilterStatus || asFilterPriority || asFilterCategory || asSearchKw) {
      html += '<button onclick="asClearFilters()" style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t4);cursor:pointer">필터 해제</button>';
    }
    html += '</div></div>';

    // 목록 테이블
    html += '<div class="pnl" style="padding:0;overflow:hidden">';
    if (!filtered.length) {
      html += '<div style="padding:40px 20px;text-align:center;color:var(--t5);font-size:12px">';
      html += all.length === 0
        ? '아직 접수된 A/S가 없습니다. <button onclick="showASModal()" style="border:none;background:none;color:#F59E0B;cursor:pointer;text-decoration:underline">첫 접수 등록</button>'
        : '필터 조건에 맞는 A/S가 없습니다.';
      html += '</div>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
      html += '<thead><tr style="background:var(--bg-i);border-bottom:1px solid var(--bd)">';
      ['접수번호', '고객사 / 장비', '카테고리', '긴급도', '상태', '신고 내용', '접수', ''].forEach(function (h) {
        html += '<th style="padding:8px 10px;text-align:left;font-weight:600;color:var(--t4);font-size:10px">' + h + '</th>';
      });
      html += '</tr></thead><tbody>';
      filtered.forEach(function (t) {
        var st = STATUS[t.status] || { label: t.status, color: '#94A3B8', icon: '' };
        var pr = PRIO[t.priority] || { label: t.priority, color: '#94A3B8', icon: '' };
        var ct = CAT[t.category] || { label: t.category || '-', icon: '' };
        var safeId = _asEsc(t.id);
        html += '<tr style="border-bottom:1px solid var(--bd);cursor:pointer" onclick="showASDetail(\'' + safeId + '\')">';
        html += '<td style="padding:8px 10px;font-family:monospace;font-weight:600;color:var(--t2)">' + _asEsc(t.ticketNo) + '</td>';
        html += '<td style="padding:8px 10px;color:var(--t2)"><div style="font-weight:600">' + _asEsc(t.customerName) + '</div>';
        html += '<div style="font-size:10px;color:var(--t5)">' + _asEsc(t.equipmentModel || '-') + (t.serialNo ? ' · ' + _asEsc(t.serialNo) : '') + '</div></td>';
        html += '<td style="padding:8px 10px;color:var(--t3)">' + (ct.icon || '') + ' ' + _asEsc(ct.label) + '</td>';
        html += '<td style="padding:8px 10px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:' + pr.color + ';color:#fff;font-size:10px;font-weight:600">' + (pr.icon || '') + ' ' + _asEsc(t.priority) + '</span></td>';
        html += '<td style="padding:8px 10px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:' + st.color + '22;color:' + st.color + ';font-size:10px;font-weight:600">' + (st.icon || '') + ' ' + _asEsc(st.label) + '</span></td>';
        var summary = (t.issueSummary || '').slice(0, 50);
        if ((t.issueSummary || '').length > 50) summary += '…';
        var freqTxt = t.frequency ? _asFreqDisplay(t.frequency, t.frequencyCount) : '';
        html += '<td style="padding:8px 10px;color:var(--t3);max-width:280px">' + _asEsc(summary);
        if (freqTxt) html += '<div style="font-size:10px;color:var(--t5);margin-top:2px">📊 ' + _asEsc(freqTxt) + '</div>';
        html += '</td>';
        html += '<td style="padding:8px 10px;color:var(--t5);font-size:10px">' + _asFmtDate(t.receivedAt) + '<br><span style="color:var(--t6)">' + _asElapsed(t.receivedAt) + '</span></td>';
        html += '<td style="padding:8px 10px;text-align:right" onclick="event.stopPropagation()">';
        html += '<button onclick="showASModal(\'' + safeId + '\')" style="font-size:10px;border:none;background:none;color:var(--t5);cursor:pointer" title="편집">✏️</button>';
        html += '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    wrap.innerHTML = html;
  }).catch(function (err) {
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
  var h = '<select onchange="' + varName + '=this.value;renderAS()" style="font-size:10px;padding:3px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3)">';
  h += '<option value="">전체 ' + label + '</option>';
  Object.keys(options).forEach(function (k) {
    var o = options[k];
    h += '<option value="' + k + '"' + (curVal === k ? ' selected' : '') + '>' + (o.icon || '') + ' ' + o.label + '</option>';
  });
  h += '</select>';
  return h;
}

function asClearFilters() {
  asFilterStatus = ''; asFilterPriority = ''; asFilterCategory = ''; asSearchKw = '';
  renderAS();
}

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

  Promise.all([pOrders, pExist, pCats]).then(function (results) {
    var orders = results[0] || [];
    var existing = results[1];
    var CAT = results[2] || {};
    var isEdit = !!existing;

    document.querySelectorAll('#asModalOverlay').forEach(function (el) { el.remove(); });
    var overlay = document.createElement('div');
    overlay.id = 'asModalOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:40px 20px;overflow-y:auto';

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
    h += _asField('Serial No.', '<input id="asM_serialNo" type="text" value="' + _asEsc(existing && existing.serialNo || '') + '" ' + _asInpStyle() + '>');
    h += _asField('설치일', '<input id="asM_installDate" type="date" value="' + _asEsc(existing && existing.installDate ? String(existing.installDate).slice(0, 10) : '') + '" ' + _asInpStyle() + '>');
    h += '</div>';

    // 2. 접수 섹션
    h += _asSection('② 접수 정보');
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">';
    var nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    var recVal = existing && existing.receivedAt ? new Date(existing.receivedAt).toISOString().slice(0, 16) : nowLocal;
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
    h += '<label style="display:block;font-size:11px;color:var(--t4);margin-bottom:4px">1차 분석 (CS/공정 메모)</label>';
    h += '<textarea id="asM_initialAnalysis" rows="2" placeholder="첫 통화/원격 진단 결과를 메모 (선택)" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;resize:vertical">' + _asEsc(existing && existing.initialAnalysis || '') + '</textarea>';
    h += '</div>';

    // 액션
    h += '<div style="display:flex;justify-content:flex-end;gap:8px;padding-top:14px;border-top:1px solid var(--bd)">';
    h += '<button onclick="document.getElementById(\'asModalOverlay\').remove()" style="padding:8px 16px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer;font-size:11px">취소</button>';
    h += '<button onclick="saveASModal(' + (isEdit ? 'true' : 'false') + ',\'' + (isEdit ? _asEsc(editId).replace(/'/g, "\\'") : '') + '\')" style="padding:8px 16px;border:none;border-radius:6px;background:#F59E0B;color:#fff;cursor:pointer;font-size:11px;font-weight:600">' + (isEdit ? '수정 저장' : '접수 등록') + '</button>';
    h += '</div>';
    h += '</div>';

    overlay.innerHTML = h;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
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
    h += '<option value="' + k + '"' + (curVal === k ? ' selected' : '') + '>' + (o.icon || '') + ' ' + o.label + '</option>';
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
    var ov = document.getElementById('asModalOverlay');
    if (ov) ov.remove();
    if (typeof showToast === 'function') {
      showToast(isEdit ? 'A/S가 수정되었습니다.' : 'A/S가 접수되었습니다. ' + (saved && saved.ticketNo ? '(' + saved.ticketNo + ')' : ''));
    }
    renderAS();
  }).catch(function (err) {
    console.error('[saveASModal]', err);
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (err && err.status === 403) msg = '권한이 없습니다.';
    if (typeof showToast === 'function') showToast('❌ 저장 실패: ' + msg, 'error');
  });
}

/* ═══ 상세 패널 (v1: 모달 편집으로 위임) ═══ */
function showASDetail(id) {
  // v1에서는 편집 모달을 그대로 띄움. 후속 작업에서 6단계 탭 상세화면으로 확장.
  showASModal(id);
}

/* ═══ 카테고리 관리 모달 (관리자 전용, 무한 확장) ═══
 * GET /api/as-categories?all=1 로 비활성 포함 전체 조회 → 테이블 + 인라인 편집 + 추가 폼
 * 코드(code)는 영소문자·숫자·언더스코어 2~40자, 생성 후 변경 불가(서버에서 거절). */
function showASCategoryAdmin() {
  if (!_asAdminOnly()) {
    if (typeof showToast === 'function') showToast('관리자만 접근할 수 있습니다.', 'warn');
    return;
  }
  if (typeof asCategoryGetAll !== 'function') {
    if (typeof showToast === 'function') showToast('카테고리 API 미연결', 'error');
    return;
  }

  asCategoryGetAll(true).then(function (rows) {
    document.querySelectorAll('#asCatAdminOverlay').forEach(function (el) { el.remove(); });
    var overlay = document.createElement('div');
    overlay.id = 'asCatAdminOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:40px 20px;overflow-y:auto';

    var h = '';
    h += '<div style="background:var(--bg);border:1px solid var(--bd);border-radius:10px;width:720px;max-width:100%;padding:20px 24px;color:var(--t2);box-shadow:0 10px 40px rgba(0,0,0,0.4)">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--bd)">';
    h += '<div><div style="font-size:14px;font-weight:700">⚙️ A/S 카테고리 관리</div>';
    h += '<div style="font-size:10px;color:var(--t5);margin-top:2px">관리자 전용 — 추가·라벨/아이콘/순서 변경·비활성화 가능 (코드는 변경 불가)</div></div>';
    h += '<button onclick="document.getElementById(\'asCatAdminOverlay\').remove()" style="border:none;background:none;font-size:18px;cursor:pointer;color:var(--t5)">✕</button>';
    h += '</div>';

    // 추가 폼
    h += '<div style="background:var(--bg-i);border:1px dashed var(--bd);border-radius:8px;padding:12px;margin-bottom:14px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">➕ 새 카테고리 추가</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 2fr 60px 80px;gap:8px;align-items:end">';
    h += _asField('코드 (영소문자_숫자) *', '<input id="asCatNew_code" type="text" placeholder="예: optic_cleaning" pattern="[a-z0-9_]{2,40}" ' + _asInpStyle() + '>');
    h += _asField('라벨 *', '<input id="asCatNew_label" type="text" placeholder="예: Optic Cleaning" ' + _asInpStyle() + '>');
    h += _asField('아이콘', '<input id="asCatNew_icon" type="text" placeholder="🔆" maxlength="4" ' + _asInpStyle() + '>');
    h += _asField('순서', '<input id="asCatNew_sortOrder" type="number" value="100" min="0" ' + _asInpStyle() + '>');
    h += '</div>';
    h += '<div style="text-align:right;margin-top:10px"><button onclick="saveASCategoryNew()" style="padding:6px 14px;border:none;border-radius:6px;background:#10B981;color:#fff;cursor:pointer;font-size:11px;font-weight:600">+ 추가</button></div>';
    h += '</div>';

    // 목록 테이블
    h += '<div style="border:1px solid var(--bd);border-radius:8px;overflow:hidden">';
    h += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    h += '<thead><tr style="background:var(--bg-i);border-bottom:1px solid var(--bd)">';
    ['코드', '라벨', '아이콘', '순서', '활성', '액션'].forEach(function (col) {
      h += '<th style="padding:8px 10px;text-align:left;font-size:10px;color:var(--t4);font-weight:600">' + col + '</th>';
    });
    h += '</tr></thead><tbody>';
    if (!rows || !rows.length) {
      h += '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--t5)">등록된 카테고리가 없습니다.</td></tr>';
    } else {
      rows.forEach(function (c) {
        var sid = _asEsc(c.id);
        var rowBg = c.active === false ? 'opacity:0.5;' : '';
        h += '<tr style="border-bottom:1px solid var(--bd);' + rowBg + '">';
        h += '<td style="padding:6px 10px;font-family:monospace;color:var(--t5)">' + _asEsc(c.code) + '</td>';
        h += '<td style="padding:6px 10px"><input id="asCatEd_label_' + sid + '" type="text" value="' + _asEsc(c.label || '') + '" style="width:100%;padding:4px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t2);font-size:11px"></td>';
        h += '<td style="padding:6px 10px"><input id="asCatEd_icon_' + sid + '" type="text" value="' + _asEsc(c.icon || '') + '" maxlength="4" style="width:50px;padding:4px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t2);font-size:11px;text-align:center"></td>';
        h += '<td style="padding:6px 10px"><input id="asCatEd_sortOrder_' + sid + '" type="number" value="' + (c.sortOrder != null ? c.sortOrder : 100) + '" style="width:60px;padding:4px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t2);font-size:11px"></td>';
        h += '<td style="padding:6px 10px"><label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer"><input id="asCatEd_active_' + sid + '" type="checkbox"' + (c.active !== false ? ' checked' : '') + '><span style="font-size:10px;color:var(--t5)">' + (c.active !== false ? '활성' : '비활성') + '</span></label></td>';
        h += '<td style="padding:6px 10px;text-align:right;white-space:nowrap">';
        h += '<button onclick="saveASCategoryEdit(\'' + sid + '\')" style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3);cursor:pointer;margin-right:4px" title="이 행 저장">💾</button>';
        h += '<button onclick="deleteASCategory(\'' + sid + '\',\'' + _asEsc(c.code) + '\')" style="font-size:10px;padding:3px 8px;border:1px solid #EF4444;border-radius:4px;background:transparent;color:#EF4444;cursor:pointer" title="비활성화 (사용 중이면 hard-delete 거절)">🗑️</button>';
        h += '</td></tr>';
      });
    }
    h += '</tbody></table></div>';

    h += '<div style="text-align:right;margin-top:14px;padding-top:12px;border-top:1px solid var(--bd)">';
    h += '<button onclick="document.getElementById(\'asCatAdminOverlay\').remove()" style="padding:7px 16px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer;font-size:11px">닫기</button>';
    h += '</div>';
    h += '</div>';

    overlay.innerHTML = h;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }).catch(function (err) {
    console.error('[showASCategoryAdmin]', err);
    if (typeof showToast === 'function') showToast('카테고리 로드 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

function saveASCategoryNew() {
  var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var data = {
    code: v('asCatNew_code').toLowerCase(),
    label: v('asCatNew_label'),
    icon: v('asCatNew_icon'),
    sortOrder: Number(v('asCatNew_sortOrder')) || 100,
    active: true,
    _isNew: true
  };
  if (!data.code) { if (typeof showToast === 'function') showToast('코드를 입력하세요.', 'warn'); return; }
  if (!/^[a-z0-9_]{2,40}$/.test(data.code)) {
    if (typeof showToast === 'function') showToast('코드는 영소문자·숫자·언더스코어 2~40자.', 'warn');
    return;
  }
  if (!data.label) { if (typeof showToast === 'function') showToast('라벨을 입력하세요.', 'warn'); return; }

  asCategoryPut(data).then(function () {
    _AS_CAT_CACHE = null; // 캐시 무효화
    if (typeof showToast === 'function') showToast('카테고리가 추가되었습니다.');
    showASCategoryAdmin(); // 재로드
    renderAS();
  }).catch(function (err) {
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (typeof showToast === 'function') showToast('❌ 추가 실패: ' + msg, 'error');
  });
}

function saveASCategoryEdit(id) {
  var v = function (suffix) { var el = document.getElementById('asCatEd_' + suffix + '_' + id); return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : ''; };
  var data = {
    id: id,
    label: v('label'),
    icon: v('icon'),
    sortOrder: Number(v('sortOrder')) || 100,
    active: !!v('active')
  };
  if (!data.label) { if (typeof showToast === 'function') showToast('라벨은 비울 수 없습니다.', 'warn'); return; }

  asCategoryPut(data).then(function () {
    _AS_CAT_CACHE = null;
    if (typeof showToast === 'function') showToast('저장되었습니다.');
    renderAS();
  }).catch(function (err) {
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (typeof showToast === 'function') showToast('❌ 저장 실패: ' + msg, 'error');
  });
}

function deleteASCategory(id, code) {
  if (!confirm('카테고리 "' + code + '"을(를) 비활성화하시겠습니까?\n\n• 비활성화 → 신규 접수에서 선택 불가 (기존 접수는 그대로 표시)\n• 사용 중이지 않으면 완전 삭제도 가능 (다음 단계에서 안내)')) return;
  asCategoryDel(id, false).then(function () {
    _AS_CAT_CACHE = null;
    if (typeof showToast === 'function') showToast('비활성화되었습니다.');
    showASCategoryAdmin();
    renderAS();
  }).catch(function (err) {
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (typeof showToast === 'function') showToast('❌ 실패: ' + msg, 'error');
  });
}

/* 크로스탭 동기화는 업무일지_분석기.html의 wmDataBus depMap/renderMap('as') 에서 처리.
   카테고리 변경 시에도 'asCategory' 타입이 emit되며, depMap에 등록되어 있어 AS 탭이 자동 재렌더됨.
   다만 캐시(_AS_CAT_CACHE)도 함께 무효화해야 신규 라벨이 반영되므로 별도 청취자 등록. */
(function () {
  if (typeof window === 'undefined' || !window.wmDataBus) return;
  window.wmDataBus.on('asCategory', function () { _AS_CAT_CACHE = null; });
})();
