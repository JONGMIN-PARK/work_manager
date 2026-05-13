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
var asViewMode = 'all';  // 'all' | 'myqueue' — 내게 할당된 active 건만

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

  var listParams = (asViewMode === 'myqueue') ? { myQueue: 1 } : null;

  Promise.all([asGetAll(listParams), _asLoadCats()]).then(function (results) {
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
    // 전체 / 내 큐 토글
    html += '<div style="display:inline-flex;border:1px solid var(--bd);border-radius:6px;overflow:hidden">';
    html += '<button onclick="asViewMode=\'all\';renderAS()" style="font-size:10px;padding:4px 10px;border:none;background:' + (asViewMode === 'all' ? '#F59E0B' : 'var(--bg-i)') + ';color:' + (asViewMode === 'all' ? '#fff' : 'var(--t4)') + ';cursor:pointer;font-weight:' + (asViewMode === 'all' ? '700' : '500') + '">📋 전체</button>';
    html += '<button onclick="asViewMode=\'myqueue\';renderAS()" style="font-size:10px;padding:4px 10px;border:none;background:' + (asViewMode === 'myqueue' ? '#F59E0B' : 'var(--bg-i)') + ';color:' + (asViewMode === 'myqueue' ? '#fff' : 'var(--t4)') + ';cursor:pointer;font-weight:' + (asViewMode === 'myqueue' ? '700' : '500') + '" title="내게 할당된 처리 진행 중인 건만">🎯 내 큐</button>';
    html += '</div>';
    html += '<span style="font-size:11px;color:var(--t5)">' + (asViewMode === 'myqueue' ? '내 큐 ' : '전체 ') + all.length + '건' +
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
      if (all.length === 0) {
        html += asViewMode === 'myqueue'
          ? '🎯 내게 할당된 진행 중인 A/S가 없습니다.<br><span style="color:var(--t6);font-size:10px;margin-top:6px;display:inline-block">전체 보기로 전환하거나, 접수 상세 → ②할당에서 본인을 담당으로 추가하세요.</span>'
          : '아직 접수된 A/S가 없습니다. <button onclick="showASModal()" style="border:none;background:none;color:#F59E0B;cursor:pointer;text-decoration:underline">첫 접수 등록</button>';
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

/* ═══ 6-Step 상세 패널 (v2) ═══
 * 접수상세를 ①접수 ②할당 ③처리 ④보고 ⑤확인 ⑥보고서 6탭으로 펼침.
 * 현재 슬라이스: ①②③ 풀구현, ④는 RCA/재발방지 입력 + 종결 토글, ⑤⑥은 Phase 2 placeholder.
 */
var _asDetailTab = 'overview';  // overview|assign|work|report|customer|doc

function showASDetail(id) {
  if (!id) return;
  Promise.all([
    asGetExpand(id),
    _asLoadCats()
  ]).then(function (results) {
    var t = results[0];
    var CAT = results[1] || {};
    if (!t) { if (typeof showToast === 'function') showToast('A/S 정보를 찾을 수 없습니다.', 'error'); return; }
    _asRenderDetail(t, CAT);
  }).catch(function (err) {
    console.error('[showASDetail]', err);
    if (typeof showToast === 'function') showToast('A/S 조회 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

function _asRenderDetail(t, CAT) {
  var STATUS = typeof AS_STATUS !== 'undefined' ? AS_STATUS : {};
  var PRIO   = typeof AS_PRIORITY !== 'undefined' ? AS_PRIORITY : {};

  document.querySelectorAll('#asDetailOverlay').forEach(function (el) { el.remove(); });
  var overlay = document.createElement('div');
  overlay.id = 'asDetailOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9990;display:flex;align-items:flex-start;justify-content:center;padding:30px 20px;overflow-y:auto';

  var st = STATUS[t.status] || { label: t.status, color: '#94A3B8', icon: '' };
  var pr = PRIO[t.priority] || { label: t.priority, color: '#94A3B8', icon: '' };
  var ct = CAT[t.category] || { label: t.category || '-', icon: '' };

  var h = '';
  h += '<div style="background:var(--bg);border:1px solid var(--bd);border-radius:12px;width:920px;max-width:100%;color:var(--t2);box-shadow:0 14px 50px rgba(0,0,0,0.5);overflow:hidden">';

  // 헤더
  h += '<div style="padding:16px 22px;border-bottom:1px solid var(--bd);background:linear-gradient(135deg,' + pr.color + '15,' + st.color + '15)">';
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">';
  h += '<div style="flex:1">';
  h += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
  h += '<span style="font-family:monospace;font-size:14px;font-weight:700;color:var(--t1)">' + _asEsc(t.ticketNo) + '</span>';
  h += '<span style="padding:2px 8px;border-radius:10px;background:' + pr.color + ';color:#fff;font-size:10px;font-weight:600">' + (pr.icon || '') + ' ' + _asEsc(t.priority) + '</span>';
  h += '<span style="padding:2px 8px;border-radius:10px;background:' + st.color + '22;color:' + st.color + ';font-size:10px;font-weight:700">' + (st.icon || '') + ' ' + _asEsc(st.label) + '</span>';
  if (t.linkedIssueId) h += '<span style="padding:2px 8px;border-radius:10px;background:#6366F122;color:#6366F1;font-size:10px;font-weight:600">🎫 이슈 연결됨</span>';
  h += '</div>';
  h += '<div style="margin-top:6px;font-size:13px;font-weight:600;color:var(--t2)">' + _asEsc(t.customerName || '-') +
       ' · ' + _asEsc(t.equipmentModel || '-') + (t.serialNo ? ' (' + _asEsc(t.serialNo) + ')' : '') + '</div>';
  h += '<div style="margin-top:2px;font-size:11px;color:var(--t5)">' + (ct.icon || '') + ' ' + _asEsc(ct.label) + ' · ' + _asFmtDT(t.receivedAt) + '</div>';
  h += '</div>';
  h += '<div style="display:flex;gap:6px;align-items:flex-start">';
  h += '<button onclick="showASModal(\'' + _asEsc(t.id) + '\')" style="font-size:11px;padding:6px 12px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer">✏️ 접수 편집</button>';
  if (!t.linkedIssueId) {
    h += '<button onclick="asTriggerLinkIssue(\'' + _asEsc(t.id) + '\')" style="font-size:11px;padding:6px 12px;border:1px solid #6366F1;border-radius:6px;background:transparent;color:#6366F1;cursor:pointer" title="이 A/S를 이슈관리에 자동 등록">🎫 이슈로 등록</button>';
  }
  h += '<button onclick="document.getElementById(\'asDetailOverlay\').remove()" style="font-size:16px;padding:4px 10px;border:none;background:none;color:var(--t5);cursor:pointer">✕</button>';
  h += '</div></div></div>';

  // 6-step 탭바
  var steps = [
    { key: 'overview', label: '① 접수',     icon: '📥' },
    { key: 'assign',   label: '② 할당',     icon: '🎯' },
    { key: 'work',     label: '③ 처리',     icon: '🛠️' },
    { key: 'report',   label: '④ 보고/결재', icon: '📝' },
    { key: 'customer', label: '⑤ 고객확인', icon: '📞' },
    { key: 'doc',      label: '⑥ 보고서',   icon: '📄' }
  ];
  h += '<div style="display:flex;border-bottom:1px solid var(--bd);background:var(--bg-i)">';
  steps.forEach(function (s) {
    var active = _asDetailTab === s.key;
    h += '<button onclick="_asDetailTab=\'' + s.key + '\';showASDetail(\'' + _asEsc(t.id) + '\')" ' +
         'style="flex:1;padding:10px 6px;border:none;background:' + (active ? 'var(--bg)' : 'transparent') +
         ';color:' + (active ? 'var(--t2)' : 'var(--t5)') + ';font-size:11px;font-weight:' + (active ? '700' : '500') +
         ';cursor:pointer;border-bottom:2px solid ' + (active ? '#F59E0B' : 'transparent') + '">' +
         s.icon + ' ' + s.label + '</button>';
  });
  h += '</div>';

  // 탭 내용
  h += '<div style="padding:18px 22px;max-height:calc(100vh - 280px);overflow-y:auto">';
  if (_asDetailTab === 'overview')  h += _asTabOverview(t, CAT);
  if (_asDetailTab === 'assign')    h += _asTabAssign(t);
  if (_asDetailTab === 'work')      h += _asTabWork(t);
  if (_asDetailTab === 'report')    h += _asTabReport(t);
  if (_asDetailTab === 'customer')  h += _asTabPlaceholder('⑤ 고객 확인 + CSAT', 'Phase 2에서 추가 예정 — 현장 담당자 서명 캔버스, CSAT 만족도 라디오, 코멘트, D+3일 미회신 알림.');
  if (_asDetailTab === 'doc')       h += _asTabPlaceholder('⑥ 보고서 발행', 'Phase 2~3에서 추가 예정 — 엑셀 6시트 자동 생성, PDF 변환, 고객 이메일 자동 발송, 발행 이력 관리.');
  h += '</div>';

  h += '</div>';

  overlay.innerHTML = h;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
}

/* ─── ① 접수 개요 탭 ─── */
function _asTabOverview(t, CAT) {
  var h = '';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">';
  h += _asInfoBlock('고객 / 장비', [
    ['고객사', t.customerName],
    ['사이트/라인', t.siteLine],
    ['연락처', t.customerContact],
    ['장비모델', t.equipmentModel],
    ['장비번호', t.equipmentNo],
    ['Serial No.', t.serialNo],
    ['설치일', _asFmtDate(t.installDate)],
    ['보증여부', t.warrantyStatus],
    ['수주번호', t.orderNo]
  ]);
  h += _asInfoBlock('접수 / 1차 분석', [
    ['접수일시', _asFmtDT(t.receivedAt)],
    ['접수경로', _asEnumLabel('AS_CHANNEL', t.channel)],
    ['긴급도', _asEnumLabel('AS_PRIORITY', t.priority)],
    ['카테고리', (CAT[t.category] || {}).label || t.category],
    ['처리방식(예정)', _asEnumLabel('AS_METHOD', t.method)],
    ['재현 여부', _asEnumLabel('AS_REPRODUCTION', t.reproduction)],
    ['발생 빈도', _asFreqDisplay(t.frequency, t.frequencyCount)],
    ['영향 범위', t.impactScope]
  ]);
  h += '</div>';

  h += '<div style="margin-top:14px"><div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:4px">📝 신고 내용 (원문)</div>';
  h += '<div style="background:var(--bg-i);border:1px solid var(--bd);border-radius:6px;padding:10px;font-size:12px;color:var(--t2);white-space:pre-wrap">' + _asEsc(t.issueSummary || '-') + '</div></div>';

  if (t.initialAnalysis) {
    h += '<div style="margin-top:12px"><div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:4px">🔍 1차 분석 메모</div>';
    h += '<div style="background:var(--bg-i);border:1px solid var(--bd);border-radius:6px;padding:10px;font-size:12px;color:var(--t2);white-space:pre-wrap">' + _asEsc(t.initialAnalysis) + '</div></div>';
  }
  return h;
}

/* ─── ② 할당 탭 ─── */
function _asTabAssign(t) {
  var ASG_ROLE   = typeof AS_ASSIGN_ROLE   !== 'undefined' ? AS_ASSIGN_ROLE   : {};
  var ASG_STATUS = typeof AS_ASSIGN_STATUS !== 'undefined' ? AS_ASSIGN_STATUS : {};
  var DEPT_MAP   = typeof DEPT             !== 'undefined' ? DEPT             : {};
  var METH       = typeof AS_METHOD        !== 'undefined' ? AS_METHOD        : {};
  var asgs = t.assignments || [];

  var h = '';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
  h += '<div style="font-size:13px;font-weight:700;color:var(--t2)">🎯 부서 할당 (' + asgs.length + ')</div>';
  h += '<button onclick="showASAssignAddForm(\'' + _asEsc(t.id) + '\')" style="font-size:11px;padding:5px 12px;border:none;border-radius:6px;background:#06B6D4;color:#fff;cursor:pointer;font-weight:600">+ 부서 추가</button>';
  h += '</div>';

  if (!asgs.length) {
    h += '<div style="background:var(--bg-i);border:1px dashed var(--bd);border-radius:8px;padding:30px;text-align:center;color:var(--t5);font-size:12px">';
    h += '아직 할당된 부서가 없습니다. <strong>+ 부서 추가</strong>로 시작하세요.';
    h += '</div>';
    return h;
  }

  h += '<div style="display:flex;flex-direction:column;gap:8px">';
  asgs.forEach(function (a) {
    var role = ASG_ROLE[a.role] || { label: a.role, color: '#94A3B8', icon: '' };
    var ast  = ASG_STATUS[a.status] || { label: a.status, color: '#94A3B8', icon: '' };
    var dept = DEPT_MAP[a.dept] || { label: a.dept, color: '#64748B', icon: '' };
    var meth = METH[a.method] || { label: a.method || '-', icon: '' };
    h += '<div style="border:1px solid var(--bd);border-radius:8px;padding:12px 14px;background:var(--bg-i)">';
    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">';
    h += '<div style="flex:1">';
    h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
    h += '<span style="padding:2px 6px;border-radius:8px;background:' + role.color + ';color:#fff;font-size:9px;font-weight:600">' + (role.icon || '') + ' ' + _asEsc(role.label) + '</span>';
    h += '<span style="font-size:12px;font-weight:700;color:var(--t2)">' + (dept.icon || '') + ' ' + _asEsc(dept.label) + '</span>';
    if (a.assigneeName) h += '<span style="font-size:11px;color:var(--t4)">· 👤 ' + _asEsc(a.assigneeName) + '</span>';
    h += '</div>';
    h += '<div style="font-size:10px;color:var(--t5)">';
    if (a.method) h += (meth.icon || '') + ' ' + _asEsc(meth.label) + ' · ';
    if (a.promisedAt) h += '약속: ' + _asFmtDT(a.promisedAt) + ' · ';
    h += '소요: ' + (a.durationH || 0) + 'h';
    if (a.completedAt) h += ' · 완료: ' + _asFmtDT(a.completedAt);
    h += '</div>';
    if (a.resultNote) h += '<div style="font-size:11px;color:var(--t3);margin-top:6px;padding:6px 8px;background:var(--bg);border-radius:4px;white-space:pre-wrap">' + _asEsc(a.resultNote) + '</div>';
    h += '</div>';
    h += '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">';
    h += '<span style="padding:2px 8px;border-radius:10px;background:' + ast.color + '22;color:' + ast.color + ';font-size:10px;font-weight:700">' + (ast.icon || '') + ' ' + _asEsc(ast.label) + '</span>';
    h += '<div style="display:flex;gap:3px">';
    if (a.status !== 'completed') {
      h += '<button onclick="asAssignmentChangeStatus(\'' + _asEsc(t.id) + '\',\'' + _asEsc(a.id) + '\',\'completed\')" style="font-size:9px;padding:3px 6px;border:1px solid #10B981;border-radius:4px;background:transparent;color:#10B981;cursor:pointer" title="완료 처리">✅ 완료</button>';
    }
    h += '<button onclick="asAssignmentRemove(\'' + _asEsc(t.id) + '\',\'' + _asEsc(a.id) + '\')" style="font-size:9px;padding:3px 6px;border:1px solid #EF4444;border-radius:4px;background:transparent;color:#EF4444;cursor:pointer" title="할당 해제">🗑️</button>';
    h += '</div>';
    h += '</div>';
    h += '</div></div>';
  });
  h += '</div>';

  return h;
}

/* ─── ③ 처리 탭 (Activity Log + 부서별 소요시간) ─── */
function _asTabWork(t) {
  var LOG_TYPE   = typeof AS_WORK_TYPE   !== 'undefined' ? AS_WORK_TYPE   : {};
  var LOG_STATUS = typeof AS_LOG_STATUS  !== 'undefined' ? AS_LOG_STATUS  : {};
  var DEPT_MAP   = typeof DEPT           !== 'undefined' ? DEPT           : {};
  var logs = t.activityLogs || [];

  var h = '';
  // 부서별 소요시간 집계
  var byDept = {};
  logs.forEach(function (l) {
    byDept[l.dept] = (byDept[l.dept] || 0) + Number(l.durationH || 0);
  });
  var totalH = Object.keys(byDept).reduce(function (s, k) { return s + byDept[k]; }, 0);

  if (Object.keys(byDept).length) {
    h += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">';
    Object.keys(byDept).forEach(function (k) {
      var d = DEPT_MAP[k] || { label: k, color: '#64748B', icon: '' };
      h += '<div style="border:1px solid var(--bd);border-radius:6px;padding:6px 10px;background:var(--bg-i);font-size:11px">';
      h += '<span style="color:' + d.color + ';font-weight:700">' + (d.icon || '') + ' ' + _asEsc(d.label) + '</span>';
      h += ' <span style="color:var(--t3);font-weight:600">' + byDept[k].toFixed(1) + 'h</span>';
      h += '</div>';
    });
    h += '<div style="border:1px solid #F59E0B;border-radius:6px;padding:6px 10px;background:#F59E0B11;font-size:11px;color:#F59E0B;font-weight:700">합계 ' + totalH.toFixed(1) + 'h</div>';
    h += '</div>';
  }

  // 추가 폼
  h += '<div style="background:var(--bg-i);border:1px dashed var(--bd);border-radius:8px;padding:12px;margin-bottom:14px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">➕ 작업 기록 추가</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1.4fr 1fr 0.8fr;gap:8px;margin-bottom:8px">';
  h += _asField('부서 *', _asEnumSelect('asLogNew_dept', DEPT_MAP, '', true));
  h += _asField('작업 유형 *', _asEnumSelect('asLogNew_workType', LOG_TYPE, '', true));
  h += _asField('소요(h)', '<input id="asLogNew_durationH" type="number" min="0" step="0.5" value="" placeholder="0.5" ' + _asInpStyle() + '>');
  h += _asField('상태', _asEnumSelect('asLogNew_status', LOG_STATUS, 'in_progress', false));
  h += '</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">';
  h += _asField('문제 / 분석', '<input id="asLogNew_problem" type="text" placeholder="현상·원인 분석 (선택)" ' + _asInpStyle() + '>');
  h += _asField('조치 내용 *', '<input id="asLogNew_actionTaken" type="text" placeholder="실제 수행한 조치" ' + _asInpStyle() + '>');
  h += '</div>';
  h += '<div style="text-align:right"><button onclick="asLogAdd(\'' + _asEsc(t.id) + '\')" style="font-size:11px;padding:6px 14px;border:none;border-radius:6px;background:#10B981;color:#fff;cursor:pointer;font-weight:600">+ 추가</button></div>';
  h += '</div>';

  // 타임라인
  if (!logs.length) {
    h += '<div style="padding:30px;text-align:center;color:var(--t5);font-size:12px">아직 작업 기록이 없습니다.</div>';
    return h;
  }
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">📋 작업 타임라인 (' + logs.length + '개)</div>';
  h += '<div style="display:flex;flex-direction:column;gap:6px">';
  logs.forEach(function (l) {
    var d = DEPT_MAP[l.dept] || { label: l.dept, color: '#64748B', icon: '' };
    var wt = LOG_TYPE[l.workType] || { label: l.workType, icon: '' };
    var ls = LOG_STATUS[l.status] || { label: l.status, color: '#94A3B8' };
    h += '<div style="border-left:3px solid ' + d.color + ';padding:8px 12px;background:var(--bg-i);border-radius:0 6px 6px 0">';
    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">';
    h += '<div style="flex:1">';
    h += '<div style="font-size:11px;color:var(--t5);margin-bottom:2px">';
    h += '#' + l.seq + ' · ' + _asFmtDT(l.workedAt) + ' · ';
    h += '<span style="color:' + d.color + ';font-weight:600">' + (d.icon || '') + ' ' + _asEsc(d.label) + '</span>';
    h += (l.authorName ? ' · 👤 ' + _asEsc(l.authorName) : '');
    h += '</div>';
    h += '<div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:3px">' + (wt.icon || '') + ' ' + _asEsc(wt.label) + '</div>';
    if (l.problem) h += '<div style="font-size:11px;color:var(--t4);margin-bottom:2px"><strong>현상:</strong> ' + _asEsc(l.problem) + '</div>';
    h += '<div style="font-size:11px;color:var(--t3)"><strong>조치:</strong> ' + _asEsc(l.actionTaken || '-') + '</div>';
    if (l.followup) h += '<div style="font-size:10px;color:var(--t5);margin-top:3px">📌 후속: ' + _asEsc(l.followup) + '</div>';
    h += '</div>';
    h += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">';
    h += '<span style="padding:2px 8px;border-radius:10px;background:' + ls.color + '22;color:' + ls.color + ';font-size:9px;font-weight:600">' + _asEsc(ls.label) + '</span>';
    h += '<span style="font-size:10px;color:var(--t4);font-weight:600">' + (l.durationH || 0) + 'h</span>';
    h += '<button onclick="asLogRemove(\'' + _asEsc(t.id) + '\',\'' + _asEsc(l.id) + '\')" style="font-size:9px;padding:2px 6px;border:1px solid #EF4444;border-radius:3px;background:transparent;color:#EF4444;cursor:pointer">🗑️</button>';
    h += '</div></div></div>';
  });
  h += '</div>';
  return h;
}

/* ─── ④ 보고/결재 탭 — 최소 구현 (RCA/재발방지 + 종결 토글) ─── */
function _asTabReport(t) {
  var h = '';
  h += '<div style="font-size:13px;font-weight:700;color:var(--t2);margin-bottom:10px">📝 근본원인 / 재발방지</div>';
  h += '<div style="margin-bottom:10px">';
  h += '<label style="display:block;font-size:11px;color:var(--t4);margin-bottom:4px">근본원인 (RCA)</label>';
  h += '<textarea id="asRpt_rca" rows="3" placeholder="장비/SW/공정 등 어디에서 왜 발생했는지" style="width:100%;padding:8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;resize:vertical">' + _asEsc(t.rca || '') + '</textarea>';
  h += '</div>';
  h += '<div style="margin-bottom:14px">';
  h += '<label style="display:block;font-size:11px;color:var(--t4);margin-bottom:4px">재발방지 대책</label>';
  h += '<textarea id="asRpt_prevention" rows="3" placeholder="유사 건 재발을 막기 위한 조치 (SW 패치/매뉴얼/예방점검 등)" style="width:100%;padding:8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2);font-size:11px;resize:vertical">' + _asEsc(t.prevention || '') + '</textarea>';
  h += '</div>';

  h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">';
  h += _asField('장비 최종 상태', '<select id="asRpt_finalEquipStatus" ' + _asInpStyle() + '>' +
    ['', '정상가동', '임시조치(가동)', '제한가동', '가동불가', '재방문 필요'].map(function (v) {
      return '<option value="' + v + '"' + (t.finalEquipStatus === v ? ' selected' : '') + '>' + (v || '선택') + '</option>';
    }).join('') + '</select>');
  h += _asField('모니터링', '<select id="asRpt_monitoring" ' + _asInpStyle() + '>' +
    ['', '불필요', '단기관찰', '장기관찰'].map(function (v) {
      return '<option value="' + v + '"' + (t.monitoring === v ? ' selected' : '') + '>' + (v || '선택') + '</option>';
    }).join('') + '</select>');
  h += _asField('완료 분류', '<select id="asRpt_closure" ' + _asInpStyle() + '>' +
    ['', '정상완료', '부분완료', '미완료(사유필요)', '이관처리', '취소'].map(function (v) {
      return '<option value="' + v + '"' + (t.closure === v ? ' selected' : '') + '>' + (v || '선택') + '</option>';
    }).join('') + '</select>');
  h += '</div>';

  h += '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:12px;border-top:1px solid var(--bd)">';
  h += '<div style="font-size:10px;color:var(--t5)">⑤ 고객 확인 + ⑥ 보고서 발행은 Phase 2~3에서 추가</div>';
  h += '<div style="display:flex;gap:6px">';
  h += '<button onclick="asReportSave(\'' + _asEsc(t.id) + '\', false)" style="font-size:11px;padding:6px 14px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer">💾 저장</button>';
  if (t.status !== 'closed') {
    h += '<button onclick="asReportSave(\'' + _asEsc(t.id) + '\', true)" style="font-size:11px;padding:6px 14px;border:none;border-radius:6px;background:#10B981;color:#fff;cursor:pointer;font-weight:600">✅ 최종 종결</button>';
  } else {
    h += '<span style="font-size:11px;padding:6px 14px;border-radius:6px;background:#10B98122;color:#10B981;font-weight:600">🏁 종결됨 ' + _asFmtDate(t.closedAt) + '</span>';
  }
  h += '</div></div>';

  return h;
}

function _asTabPlaceholder(title, msg) {
  return '<div style="padding:40px 20px;text-align:center"><div style="font-size:14px;font-weight:700;color:var(--t3);margin-bottom:10px">' + title + '</div>' +
    '<div style="font-size:11px;color:var(--t5);max-width:480px;margin:0 auto;line-height:1.6">' + _asEsc(msg) + '</div></div>';
}

function _asInfoBlock(title, rows) {
  var h = '<div style="background:var(--bg-i);border:1px solid var(--bd);border-radius:8px;padding:12px 14px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:6px">' + _asEsc(title) + '</div>';
  rows.forEach(function (r) {
    var v = (r[1] == null || r[1] === '' ? '-' : r[1]);
    h += '<div style="display:flex;gap:8px;padding:3px 0;font-size:11px"><div style="color:var(--t5);min-width:80px">' + _asEsc(r[0]) + '</div>';
    h += '<div style="color:var(--t2);flex:1">' + _asEsc(v) + '</div></div>';
  });
  h += '</div>';
  return h;
}

function _asEnumLabel(globalName, key) {
  if (!key) return '-';
  var obj = window[globalName];
  if (!obj || !obj[key]) return key;
  return (obj[key].icon ? obj[key].icon + ' ' : '') + (obj[key].label || key);
}

/* ─── 할당 추가 모달 ─── */
function showASAssignAddForm(ticketId) {
  var DEPT_MAP = typeof DEPT       !== 'undefined' ? DEPT       : {};
  var METH     = typeof AS_METHOD  !== 'undefined' ? AS_METHOD  : {};
  var ROLE     = typeof AS_ASSIGN_ROLE !== 'undefined' ? AS_ASSIGN_ROLE : {};

  document.querySelectorAll('#asAssignAddOverlay').forEach(function (el) { el.remove(); });
  var overlay = document.createElement('div');
  overlay.id = 'asAssignAddOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';

  var h = '<div style="background:var(--bg);border:1px solid var(--bd);border-radius:10px;width:520px;max-width:100%;padding:20px 22px;color:var(--t2)">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--bd)">';
  h += '<div style="font-size:13px;font-weight:700">🎯 부서 할당 추가</div>';
  h += '<button onclick="document.getElementById(\'asAssignAddOverlay\').remove()" style="border:none;background:none;font-size:18px;cursor:pointer;color:var(--t5)">✕</button>';
  h += '</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
  h += _asField('부서 *', _asEnumSelect('asAsgNew_dept', DEPT_MAP, '', true));
  h += _asField('역할 *', _asEnumSelect('asAsgNew_role', ROLE, 'primary', false));
  h += _asField('처리방식', _asEnumSelect('asAsgNew_method', METH, '', true));
  h += _asField('약속 방문일시', '<input id="asAsgNew_promisedAt" type="datetime-local" ' + _asInpStyle() + '>');
  h += '</div>';
  // 담당자: "내가 담당" 토글 + 자유 입력 백업
  var meName = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.display_name || currentUser.name || '') : '';
  h += '<div style="margin-bottom:14px;padding:10px;background:var(--bg-i);border:1px dashed var(--bd);border-radius:6px">';
  h += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:6px"><input id="asAsgNew_meCheck" type="checkbox" checked onchange="_asAsgToggleMe()"><span style="font-size:11px;font-weight:600;color:var(--t3)">👤 내가 담당 (' + _asEsc(meName) + ')</span></label>';
  h += '<div id="asAsgNew_extName" style="display:none">';
  h += _asField('외부 담당자 이름', '<input id="asAsgNew_assigneeName" type="text" placeholder="예: 외부 협력사 김OO" ' + _asInpStyle() + '>');
  h += '</div></div>';
  h += '<div style="display:flex;justify-content:flex-end;gap:8px">';
  h += '<button onclick="document.getElementById(\'asAssignAddOverlay\').remove()" style="padding:7px 14px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer;font-size:11px">취소</button>';
  h += '<button onclick="asAssignmentAdd(\'' + _asEsc(ticketId) + '\')" style="padding:7px 14px;border:none;border-radius:6px;background:#06B6D4;color:#fff;cursor:pointer;font-size:11px;font-weight:600">+ 할당</button>';
  h += '</div></div>';

  overlay.innerHTML = h;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
}

function _asAsgToggleMe() {
  var chk = document.getElementById('asAsgNew_meCheck');
  var ext = document.getElementById('asAsgNew_extName');
  if (!chk || !ext) return;
  ext.style.display = chk.checked ? 'none' : '';
}

function asAssignmentAdd(ticketId) {
  var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var meCheck = document.getElementById('asAsgNew_meCheck');
  var isMe = !meCheck || meCheck.checked;
  var data = {
    dept: v('asAsgNew_dept'),
    role: v('asAsgNew_role') || 'primary',
    method: v('asAsgNew_method'),
    promisedAt: v('asAsgNew_promisedAt') ? new Date(v('asAsgNew_promisedAt')).toISOString() : null,
    _isNew: true
  };
  if (isMe && typeof currentUser !== 'undefined' && currentUser) {
    data.assigneeId = currentUser.id;
    data.assigneeName = currentUser.display_name || currentUser.name || '';
  } else {
    data.assigneeName = v('asAsgNew_assigneeName');
  }
  if (!data.dept) { if (typeof showToast === 'function') showToast('부서를 선택하세요.', 'warn'); return; }

  asAssignmentPut(ticketId, data).then(function () {
    var ov = document.getElementById('asAssignAddOverlay');
    if (ov) ov.remove();
    if (typeof showToast === 'function') showToast('부서가 할당되었습니다.');
    showASDetail(ticketId);
    renderAS();
  }).catch(function (err) {
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (typeof showToast === 'function') showToast('❌ 할당 실패: ' + msg, 'error');
  });
}

function asAssignmentChangeStatus(ticketId, aid, status) {
  asAssignmentPut(ticketId, { id: aid, status: status }).then(function () {
    if (typeof showToast === 'function') showToast('상태가 변경되었습니다.');
    showASDetail(ticketId);
    renderAS();
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('❌ 변경 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

function asAssignmentRemove(ticketId, aid) {
  if (!confirm('이 부서 할당을 해제하시겠습니까?\n(이 부서로 기록된 처리이력은 유지됩니다.)')) return;
  asAssignmentDel(ticketId, aid).then(function () {
    if (typeof showToast === 'function') showToast('할당이 해제되었습니다.');
    showASDetail(ticketId);
    renderAS();
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('❌ 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

/* ─── 처리이력 추가/삭제 ─── */
function asLogAdd(ticketId) {
  var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var data = {
    dept: v('asLogNew_dept'),
    workType: v('asLogNew_workType'),
    problem: v('asLogNew_problem'),
    actionTaken: v('asLogNew_actionTaken'),
    durationH: Number(v('asLogNew_durationH')) || 0,
    status: v('asLogNew_status') || 'in_progress',
    _isNew: true
  };
  if (!data.dept) { if (typeof showToast === 'function') showToast('부서를 선택하세요.', 'warn'); return; }
  if (!data.workType) { if (typeof showToast === 'function') showToast('작업 유형을 선택하세요.', 'warn'); return; }
  if (!data.actionTaken) { if (typeof showToast === 'function') showToast('조치 내용을 입력하세요.', 'warn'); return; }

  // 동일 부서의 in-progress assignment 자동 연결
  var assigns = []; // 현재 상세 데이터에서 가져오면 좋지만 새로 받는 게 정확
  asAssignmentGetAll(ticketId).then(function (asgs) {
    var matched = (asgs || []).filter(function (a) { return a.dept === data.dept && a.status !== 'completed' && a.status !== 'cancelled'; })
      .sort(function (a, b) { return (a.role === 'primary' ? -1 : 1); });
    if (matched.length) data.assignmentId = matched[0].id;
    return asLogPut(ticketId, data);
  }).then(function () {
    if (typeof showToast === 'function') showToast('작업이 기록되었습니다.');
    showASDetail(ticketId);
    renderAS();
  }).catch(function (err) {
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (typeof showToast === 'function') showToast('❌ 기록 실패: ' + msg, 'error');
  });
}

function asLogRemove(ticketId, lid) {
  if (!confirm('이 작업 기록을 삭제하시겠습니까?\n(부서별 소요시간이 재계산됩니다.)')) return;
  asLogDel(ticketId, lid).then(function () {
    if (typeof showToast === 'function') showToast('삭제되었습니다.');
    showASDetail(ticketId);
    renderAS();
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('❌ 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

/* ─── 보고/종결 ─── */
function asReportSave(ticketId, finalize) {
  var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var data = {
    rca: v('asRpt_rca'),
    prevention: v('asRpt_prevention'),
    finalEquipStatus: v('asRpt_finalEquipStatus'),
    monitoring: v('asRpt_monitoring'),
    closure: v('asRpt_closure')
  };
  if (finalize) {
    if (!data.rca) { if (typeof showToast === 'function') showToast('종결하려면 RCA를 입력하세요.', 'warn'); return; }
    if (!data.closure) data.closure = '정상완료';
    data.status = 'closed';
    data.closedAt = new Date().toISOString();
  }

  updateASTicket(ticketId, data).then(function () {
    if (typeof showToast === 'function') showToast(finalize ? '✅ 최종 종결되었습니다.' : '저장되었습니다.');
    showASDetail(ticketId);
    renderAS();
  }).catch(function (err) {
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (typeof showToast === 'function') showToast('❌ 실패: ' + msg, 'error');
  });
}

/* ─── 이슈 연계 ─── */
function asTriggerLinkIssue(ticketId) {
  if (!confirm('이 A/S를 이슈관리에 새 이슈로 자동 등록하시겠습니까?\n\n• 카테고리·긴급도에 따라 이슈 유형·urgency 자동 매핑\n• 신고내용·RCA·재발방지가 이슈 설명으로 복사\n• 이슈 태그에 from-as / 접수번호 추가')) return;
  asLinkIssue(ticketId, null).then(function (res) {
    if (typeof showToast === 'function') showToast('🎫 이슈가 등록되었습니다 (' + res.issueId + ')');
    showASDetail(ticketId);
    renderAS();
  }).catch(function (err) {
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (typeof showToast === 'function') showToast('❌ 이슈 등록 실패: ' + msg, 'error');
  });
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
