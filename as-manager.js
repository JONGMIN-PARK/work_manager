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
var asViewMode = 'all';  // 'all' | 'myqueue' | 'kanban' | 'trash' | 'stats'
var _asTrashCount = 0;   // 휴지통 N개 배지용 (목록 응답 시 갱신)

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

  // 통계 모드는 별도 모듈에 위임
  if (asViewMode === 'stats') {
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

  // 휴지통 카운트는 항상 별도 조회 (배지 표시용, 가벼움)
  var pTrashCount = (asViewMode !== 'trash')
    ? asGetAll({ trashed: 1 }).then(function (rows) { _asTrashCount = (rows || []).length; }).catch(function () { _asTrashCount = 0; })
    : Promise.resolve();

  Promise.all([asGetAll(listParams), _asLoadCats(), pTrashCount]).then(function (results) {
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
        var summary = (t.issueSummary || '').slice(0, 50);
        if ((t.issueSummary || '').length > 50) summary += '…';
        var freqTxt = t.frequency ? _asFreqDisplay(t.frequency, t.frequencyCount) : '';
        html += '<td style="padding:8px 10px;color:var(--t3);max-width:280px">' + _asEsc(summary);
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
          html += '<button onclick="asPurgeTicket(\'' + safeId + '\',\'' + _asEsc(t.ticketNo).replace(/\x27/g, "\\\x27") + '\')" style="font-size:10px;padding:3px 8px;border:1px solid #EF4444;border-radius:4px;background:transparent;color:#EF4444;cursor:pointer" title="완전 삭제">💥 완전삭제</button>';
        } else {
          html += '<button onclick="showASModal(\'' + safeId + '\')" style="font-size:10px;border:none;background:none;color:var(--t5);cursor:pointer;margin-right:4px" title="편집">✏️</button>';
          html += '<button onclick="asSoftDeleteTicket(\'' + safeId + '\',\'' + _asEsc(t.ticketNo).replace(/\x27/g, "\\\x27") + '\')" style="font-size:10px;border:none;background:none;color:var(--t5);cursor:pointer" title="휴지통으로 이동">🗑️</button>';
        }
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
    h += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:14px;border-top:1px solid var(--bd)">';
    h += '<div>';
    if (isEdit) {
      h += '<button onclick="asSoftDeleteTicket(\'' + _asEsc(editId).replace(/\x27/g, "\\\x27") + '\',\'' + _asEsc(existing.ticketNo).replace(/\x27/g, "\\\x27") + '\')" style="padding:8px 14px;border:1px solid #EF4444;border-radius:6px;background:transparent;color:#EF4444;cursor:pointer;font-size:11px" title="휴지통으로 이동 (복구 가능)">🗑️ 휴지통으로 이동</button>';
    }
    h += '</div><div style="display:flex;gap:8px">';
    h += '<button onclick="document.getElementById(\'asModalOverlay\').remove()" style="padding:8px 16px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer;font-size:11px">취소</button>';
    h += '<button onclick="saveASModal(' + (isEdit ? 'true' : 'false') + ',\'' + (isEdit ? _asEsc(editId).replace(/'/g, "\\'") : '') + '\')" style="padding:8px 16px;border:none;border-radius:6px;background:#F59E0B;color:#fff;cursor:pointer;font-size:11px;font-weight:600">' + (isEdit ? '수정 저장' : '접수 등록') + '</button>';
    h += '</div></div>';
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
  if (_asDetailTab === 'customer')  h += _asTabCustomer(t);
  if (_asDetailTab === 'doc')       h += _asTabReportDoc(t);
  h += '</div>';

  h += '</div>';

  overlay.innerHTML = h;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

  // 캔버스 attach (⑤ 탭이면)
  if (_asDetailTab === 'customer') {
    ['customer_field', 'engineer'].forEach(function (role) {
      var c = document.getElementById('asSignCanvas_' + role);
      if (c) _asAttachSign(role);
    });
  }
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

  // 추가 폼 (부서 default: 본인이 할당받은 active assignment의 부서, 없으면 첫 active 할당의 부서)
  var meId = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  var defDept = '';
  var asgs = t.assignments || [];
  var myAsg = asgs.find(function (a) { return a.assigneeId === meId && a.status !== 'completed' && a.status !== 'cancelled'; });
  if (myAsg) defDept = myAsg.dept;
  else if (asgs.length) defDept = (asgs.find(function (a) { return a.status !== 'completed' && a.status !== 'cancelled'; }) || asgs[0]).dept;

  h += '<div style="background:var(--bg-i);border:1px dashed var(--bd);border-radius:8px;padding:12px;margin-bottom:14px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">➕ 작업 기록 추가</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1.4fr 1fr 0.8fr;gap:8px;margin-bottom:8px">';
  h += _asField('부서 *', _asEnumSelect('asLogNew_dept', DEPT_MAP, defDept, true));
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
  // 부품 사용 + 첨부 섹션
  h += _asSubBlockParts(t);
  h += _asSubBlockAttachments(t);

  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px;margin-top:18px">📋 작업 타임라인 (' + logs.length + '개)</div>';
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

/* ─── ③처리 탭 — 부품 사용 서브블록 ─── */
function _asSubBlockParts(t) {
  var BILL = typeof AS_BILLING !== 'undefined' ? AS_BILLING : {};
  var parts = t.parts || [];

  // 청구구분별 자동 집계
  var totals = {};
  var grandTotal = 0;
  parts.forEach(function (p) {
    var b = p.billing || 'check';
    var amt = Number(p.amount || (Number(p.qty || 0) * Number(p.unitPrice || 0)));
    totals[b] = (totals[b] || 0) + amt;
    grandTotal += amt;
  });

  var h = '<div style="margin-top:18px;border:1px solid var(--bd);border-radius:8px;padding:12px 14px">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3)">🔩 사용 부품 / 소모품 (' + parts.length + ')</div>';
  h += '<button onclick="showASPartAddForm(\'' + _asEsc(t.id) + '\')" style="font-size:10px;padding:4px 10px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3);cursor:pointer">+ 부품 추가</button>';
  h += '</div>';

  if (!parts.length) {
    h += '<div style="padding:14px;text-align:center;color:var(--t5);font-size:11px">아직 등록된 부품이 없습니다.</div>';
  } else {
    h += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px">';
    h += '<thead><tr style="border-bottom:1px solid var(--bd)">';
    ['사용일', '품목', 'Part No', '수량', '단가', '금액', '청구', 'S/N', ''].forEach(function (c) {
      h += '<th style="padding:5px 6px;text-align:left;font-size:9px;color:var(--t5);font-weight:600">' + c + '</th>';
    });
    h += '</tr></thead><tbody>';
    parts.forEach(function (p) {
      var bill = BILL[p.billing] || { label: p.billing, color: '#94A3B8', icon: '' };
      var amt = Number(p.amount || (Number(p.qty || 0) * Number(p.unitPrice || 0)));
      h += '<tr style="border-bottom:1px dotted var(--bd)">';
      h += '<td style="padding:5px 6px;color:var(--t4);font-size:10px">' + _asFmtDate(p.usedAt) + '</td>';
      h += '<td style="padding:5px 6px;color:var(--t2);font-weight:600">' + _asEsc(p.itemName) + (p.note ? '<br><span style="color:var(--t5);font-size:9px;font-weight:400">' + _asEsc(p.note) + '</span>' : '') + '</td>';
      h += '<td style="padding:5px 6px;color:var(--t4);font-family:monospace;font-size:10px">' + _asEsc(p.partNo || '-') + '</td>';
      h += '<td style="padding:5px 6px;color:var(--t3);text-align:right">' + (p.qty || 0) + '</td>';
      h += '<td style="padding:5px 6px;color:var(--t3);text-align:right">' + Number(p.unitPrice || 0).toLocaleString() + '</td>';
      h += '<td style="padding:5px 6px;color:var(--t2);text-align:right;font-weight:600">' + amt.toLocaleString() + '</td>';
      h += '<td style="padding:5px 6px"><span style="padding:1px 6px;border-radius:8px;background:' + bill.color + '22;color:' + bill.color + ';font-size:9px;font-weight:600;white-space:nowrap">' + (bill.icon || '') + ' ' + _asEsc(bill.label) + '</span></td>';
      h += '<td style="padding:5px 6px;color:var(--t5);font-family:monospace;font-size:10px">' + _asEsc(p.replacedSn || '-') + '</td>';
      h += '<td style="padding:5px 6px;text-align:right"><button onclick="asPartRemove(\'' + _asEsc(t.id) + '\',\'' + _asEsc(p.id) + '\')" style="font-size:9px;padding:2px 5px;border:1px solid #EF4444;border-radius:3px;background:transparent;color:#EF4444;cursor:pointer">🗑️</button></td>';
      h += '</tr>';
    });
    h += '</tbody></table>';

    // 청구구분별 집계
    h += '<div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:8px;border-top:1px solid var(--bd);font-size:10px">';
    Object.keys(totals).forEach(function (k) {
      var b = BILL[k] || { label: k, color: '#94A3B8', icon: '' };
      h += '<span style="padding:3px 8px;border-radius:6px;background:' + b.color + '22;color:' + b.color + ';font-weight:600">' + (b.icon || '') + ' ' + _asEsc(b.label) + ' ' + totals[k].toLocaleString() + '원</span>';
    });
    h += '<span style="margin-left:auto;padding:3px 10px;border-radius:6px;background:#F59E0B;color:#fff;font-weight:700">합계 ' + grandTotal.toLocaleString() + '원</span>';
    h += '</div>';
  }
  h += '</div>';
  return h;
}

/* ─── ③처리 탭 — 첨부 서브블록 (이미지 썸네일 + 클릭 시 Preview) ─── */
function _asSubBlockAttachments(t) {
  var CAT = typeof AS_ATTACH_CATEGORY !== 'undefined' ? AS_ATTACH_CATEGORY : {};
  var atts = t.attachments || [];

  // window에 등록해 두면 Preview 함수가 인덱스로 빨리 가져갈 수 있음
  window._asAttachIndex = window._asAttachIndex || {};
  window._asAttachIndex[t.id] = atts;

  var h = '<div style="margin-top:14px;border:1px solid var(--bd);border-radius:8px;padding:12px 14px">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3)">📎 첨부 파일 (' + atts.length + ')</div>';
  h += '<button onclick="showASAttachAddForm(\'' + _asEsc(t.id) + '\')" style="font-size:10px;padding:4px 10px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3);cursor:pointer">+ 첨부 추가</button>';
  h += '</div>';
  if (!atts.length) {
    h += '<div style="padding:12px;text-align:center;color:var(--t5);font-size:11px">사진·캡처·PDF·문서 등을 첨부할 수 있습니다.</div>';
  } else {
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px">';
    atts.forEach(function (a) {
      var c = CAT[a.category] || { label: a.category || '기타', icon: '📎' };
      var safeId = _asEsc(a.id);
      var safeTid = _asEsc(t.id);
      var isImg = _asAttIsImage(a);
      var isPdf = _asAttIsPdf(a);
      h += '<div style="border:1px solid var(--bd);border-radius:6px;padding:8px;background:var(--bg-i);position:relative;cursor:pointer;transition:border-color 0.15s" onmouseover="this.style.borderColor=\'#F59E0B\'" onmouseout="this.style.borderColor=\'\'" onclick="asAttachPreview(\'' + safeTid + '\',\'' + safeId + '\')">';
      // 썸네일/아이콘 영역
      if (isImg) {
        h += '<div style="width:100%;height:90px;background:#0f172a center / contain no-repeat url(\'' + _asEsc(a.fileUrl) + '\');border-radius:4px;margin-bottom:6px"></div>';
      } else {
        var bigIcon = isPdf ? '📄' : (c.icon || '📎');
        h += '<div style="width:100%;height:90px;display:flex;align-items:center;justify-content:center;font-size:42px;background:var(--bg);border-radius:4px;margin-bottom:6px">' + bigIcon + '</div>';
      }
      h += '<div style="font-size:10px;color:var(--t5);margin-bottom:2px">' + (c.icon || '') + ' ' + _asEsc(c.label) + '</div>';
      h += '<div style="font-size:11px;color:var(--t2);font-weight:600;word-break:break-all;line-height:1.3">' + _asEsc(a.fileName) + '</div>';
      if (a.note) h += '<div style="font-size:10px;color:var(--t4);margin-top:3px">' + _asEsc(a.note) + '</div>';
      h += '<div style="font-size:9px;color:var(--t6);margin-top:4px">' + _asFmtDate(a.uploadedAt) + '</div>';
      h += '<button onclick="event.stopPropagation();asAttachRemove(\'' + safeTid + '\',\'' + safeId + '\')" style="position:absolute;top:4px;right:4px;font-size:9px;padding:1px 5px;border:1px solid #EF4444;border-radius:3px;background:rgba(255,255,255,0.9);color:#EF4444;cursor:pointer" title="삭제">×</button>';
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div>';
  return h;
}

/* 첨부 타입 판별 — URL/mime/확장자로 추정 */
function _asAttExtMime(a) {
  var mt = (a.mimeType || a.mime_type || '').toLowerCase();
  var url = (a.fileUrl || a.file_url || '');
  // data URL이면 mime 추출
  if (!mt && url.indexOf('data:') === 0) {
    var m = url.match(/^data:([^;]+);/);
    if (m) mt = m[1].toLowerCase();
  }
  var name = (a.fileName || a.file_name || '');
  var ext = (name.split('.').pop() || '').toLowerCase();
  return { mime: mt, ext: ext, url: url, name: name };
}
function _asAttIsImage(a) {
  var info = _asAttExtMime(a);
  if (info.mime.indexOf('image/') === 0) return true;
  return ['jpg','jpeg','png','gif','webp','bmp','svg','ico'].indexOf(info.ext) >= 0;
}
function _asAttIsPdf(a) {
  var info = _asAttExtMime(a);
  if (info.mime === 'application/pdf') return true;
  return info.ext === 'pdf';
}
function _asAttIsText(a) {
  var info = _asAttExtMime(a);
  if (info.mime.indexOf('text/') === 0) return true;
  return ['txt','log','csv','md','json','xml','yml','yaml'].indexOf(info.ext) >= 0;
}

/* ─── 첨부 Preview 모달 ─── */
function asAttachPreview(ticketId, attId) {
  var atts = (window._asAttachIndex && window._asAttachIndex[ticketId]) || [];
  var a = atts.find(function (x) { return x.id === attId; });
  if (!a) {
    // 캐시에 없으면 서버에서 다시 받기
    if (typeof asAttachmentGetAll === 'function') {
      asAttachmentGetAll(ticketId).then(function (rows) {
        window._asAttachIndex[ticketId] = rows;
        var found = (rows || []).find(function (x) { return x.id === attId; });
        if (found) _asRenderAttachPreview(found);
        else if (typeof showToast === 'function') showToast('첨부를 찾지 못했습니다.', 'error');
      });
    }
    return;
  }
  _asRenderAttachPreview(a);
}

function _asRenderAttachPreview(a) {
  document.querySelectorAll('#asAttachPreviewOverlay').forEach(function (el) { el.remove(); });
  var overlay = document.createElement('div');
  overlay.id = 'asAttachPreviewOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10003;display:flex;align-items:center;justify-content:center;padding:30px';

  var CAT = typeof AS_ATTACH_CATEGORY !== 'undefined' ? AS_ATTACH_CATEGORY : {};
  var c = CAT[a.category] || { label: a.category || '기타', icon: '📎' };

  var h = '<div style="background:var(--bg);border:1px solid var(--bd);border-radius:10px;width:min(960px,98vw);max-height:96vh;display:flex;flex-direction:column;overflow:hidden;color:var(--t2);box-shadow:0 14px 50px rgba(0,0,0,0.6)">';
  // 헤더
  h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--bd);background:var(--bg-i)">';
  h += '<div style="min-width:0;flex:1"><div style="font-size:13px;font-weight:700;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (c.icon || '') + ' ' + _asEsc(a.fileName) + '</div>';
  h += '<div style="font-size:10px;color:var(--t5);margin-top:2px">' + _asEsc(c.label) + (a.note ? ' · ' + _asEsc(a.note) : '') + ' · ' + _asFmtDate(a.uploadedAt) + '</div></div>';
  h += '<div style="display:flex;gap:6px;margin-left:12px">';
  h += '<a href="' + _asEsc(a.fileUrl) + '" download="' + _asEsc(a.fileName) + '" target="_blank" rel="noopener" style="font-size:11px;padding:6px 12px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--t3);cursor:pointer;text-decoration:none">⬇ 다운로드</a>';
  h += '<button onclick="document.getElementById(\'asAttachPreviewOverlay\').remove()" style="font-size:16px;padding:4px 10px;border:none;background:none;color:var(--t5);cursor:pointer">✕</button>';
  h += '</div></div>';

  // 본문 (타입별)
  h += '<div style="flex:1;overflow:auto;background:#0f172a;display:flex;align-items:center;justify-content:center;min-height:300px;padding:14px">';
  if (_asAttIsImage(a)) {
    h += '<img src="' + _asEsc(a.fileUrl) + '" alt="' + _asEsc(a.fileName) + '" style="max-width:100%;max-height:78vh;object-fit:contain;background:#fff;border-radius:4px">';
  } else if (_asAttIsPdf(a)) {
    h += '<iframe src="' + _asEsc(a.fileUrl) + '" style="width:100%;height:78vh;border:none;background:#fff;border-radius:4px" title="PDF 미리보기"></iframe>';
  } else if (_asAttIsText(a) && a.fileUrl && a.fileUrl.indexOf('data:') === 0) {
    // data URL 텍스트는 직접 디코딩
    try {
      var b64 = a.fileUrl.split(',')[1] || '';
      var txt = decodeURIComponent(escape(atob(b64)));
      h += '<pre style="background:#fff;color:#111;padding:14px;border-radius:4px;width:100%;max-height:78vh;overflow:auto;font-size:11px;font-family:JetBrains Mono,Consolas,monospace;white-space:pre-wrap">' + _asEsc(txt) + '</pre>';
    } catch (e) {
      h += '<div style="color:#FCA5A5;font-size:12px">텍스트 디코딩 실패</div>';
    }
  } else if (_asAttIsText(a)) {
    // 외부 URL 텍스트는 iframe로
    h += '<iframe src="' + _asEsc(a.fileUrl) + '" style="width:100%;height:78vh;border:none;background:#fff;border-radius:4px" title="텍스트 미리보기"></iframe>';
  } else {
    // 기타 — 미리보기 불가
    h += '<div style="text-align:center;color:#cbd5e1;padding:40px">';
    h += '<div style="font-size:64px;margin-bottom:14px">📎</div>';
    h += '<div style="font-size:13px;margin-bottom:8px">이 형식은 미리보기를 지원하지 않습니다.</div>';
    h += '<div style="font-size:11px;color:#94a3b8">상단의 [⬇ 다운로드] 버튼으로 받아 확인하세요.</div></div>';
  }
  h += '</div></div>';

  overlay.innerHTML = h;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  // ESC 키
  function onKey(ev) {
    if (ev.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  }
  document.addEventListener('keydown', onKey);
}

/* ─── ⑤ 고객 확인 + CSAT ─── */
function _asTabCustomer(t) {
  var SIGN_ROLE = typeof AS_SIGN_ROLE !== 'undefined' ? AS_SIGN_ROLE : {};
  var CSAT = typeof AS_CSAT !== 'undefined' ? AS_CSAT : {};
  var sigs = t.signatures || [];
  var byRole = {};
  sigs.forEach(function (s) { byRole[s.role] = s; });

  var custSig = byRole['customer_field'];
  var engSig = byRole['engineer'];

  var h = '';
  h += '<div style="font-size:13px;font-weight:700;color:var(--t2);margin-bottom:10px">📞 ⑤ 고객 확인 + 만족도 (CSAT)</div>';

  // 두 컬럼: 현장담당자 / 엔지니어 (모두 서명 캔버스)
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">';
  h += _asSignCard(t.id, 'customer_field', '현장 담당자 (고객)', custSig, t.customerName);
  h += _asSignCard(t.id, 'engineer', '담당 엔지니어', engSig, _asMeName());
  h += '</div>';

  // CSAT (고객 서명 카드 안에 포함시킬 수도 있지만 별도 섹션)
  h += '<div style="border:1px solid var(--bd);border-radius:8px;padding:14px;background:var(--bg-i)">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:10px">⭐ 고객 만족도 (CSAT)</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">';
  ['speed', 'quality', 'overall'].forEach(function (k) {
    var labels = { speed: '응답 속도', quality: '처리 품질', overall: '전반 만족도' };
    var curVal = custSig ? (custSig['csat' + k.charAt(0).toUpperCase() + k.slice(1)] || '') : '';
    h += '<div>';
    h += '<div style="font-size:10px;color:var(--t4);margin-bottom:4px">' + labels[k] + '</div>';
    h += '<select id="asCSAT_' + k + '" ' + _asInpStyle() + '>';
    h += '<option value=""' + (!curVal ? ' selected' : '') + '>—</option>';
    Object.keys(CSAT).forEach(function (cs) {
      var o = CSAT[cs];
      h += '<option value="' + cs + '"' + (curVal === cs ? ' selected' : '') + '>' + (o.icon || '') + ' ' + o.label + '</option>';
    });
    h += '</select></div>';
  });
  h += '</div>';
  h += '<div style="margin-bottom:8px">';
  h += '<label style="display:block;font-size:10px;color:var(--t4);margin-bottom:4px">고객 코멘트</label>';
  h += '<textarea id="asCSAT_comment" rows="2" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--t2);font-size:11px;resize:vertical">' + _asEsc((custSig && custSig.comment) || '') + '</textarea>';
  h += '</div>';
  h += '<div style="text-align:right"><button onclick="asCSATSave(\'' + _asEsc(t.id) + '\')" style="font-size:11px;padding:6px 14px;border:none;border-radius:6px;background:#10B981;color:#fff;cursor:pointer;font-weight:600">💾 CSAT 저장</button></div>';
  h += '</div>';

  return h;
}

function _asMeName() {
  return (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.display_name || currentUser.name || '') : '';
}

function _asSignCard(ticketId, role, title, sig, defaultName) {
  var tid = _asEsc(ticketId);
  var h = '<div style="border:1px solid var(--bd);border-radius:8px;padding:12px;background:var(--bg-i)">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3)">✍️ ' + _asEsc(title) + '</div>';
  if (sig) h += '<span style="font-size:9px;color:#10B981;font-weight:600">✓ 서명됨 ' + _asFmtDate(sig.signedAt) + '</span>';
  h += '</div>';
  var nm = sig ? (sig.signerName || defaultName || '') : (defaultName || '');
  h += '<input id="asSign_' + role + '_name" type="text" value="' + _asEsc(nm) + '" placeholder="서명자 이름" style="width:100%;padding:5px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--t2);font-size:11px;margin-bottom:6px">';
  if (sig && sig.signatureUrl) {
    h += '<div style="border:1px dashed var(--bd);border-radius:4px;padding:6px;background:#fff;text-align:center;margin-bottom:6px">';
    h += '<img src="' + _asEsc(sig.signatureUrl) + '" style="max-width:100%;max-height:80px" alt="서명">';
    h += '</div>';
    h += '<div style="display:flex;gap:4px">';
    h += '<button onclick="asSignRedraw(\'' + tid + '\',\'' + role + '\')" style="flex:1;font-size:10px;padding:4px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--t3);cursor:pointer">↻ 다시 그리기</button>';
    h += '<button onclick="asSignSaveNameOnly(\'' + tid + '\',\'' + role + '\')" style="flex:1;font-size:10px;padding:4px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--t3);cursor:pointer">이름만 갱신</button>';
    h += '</div></div>';
    return h;
  }
  h += '<canvas id="asSignCanvas_' + role + '" width="320" height="100" style="width:100%;height:100px;border:1px dashed var(--bd);border-radius:4px;background:#fff;cursor:crosshair;display:block;margin-bottom:6px;touch-action:none"></canvas>';
  h += '<div style="display:flex;gap:4px">';
  h += '<button onclick="_asSignClear(\'' + role + '\')" style="flex:1;font-size:10px;padding:4px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--t3);cursor:pointer">✕ 지우기</button>';
  h += '<button onclick="asSignSave(\'' + tid + '\',\'' + role + '\')" style="flex:1;font-size:10px;padding:4px;border:none;border-radius:4px;background:#10B981;color:#fff;cursor:pointer;font-weight:600">✓ 서명 저장</button>';
  h += '</div></div>';
  return h;
}

/* ─── 캔버스 서명 attach/clear/redraw ─── */
var _asSignCtxMap = {};
var _asSignDrawing = {};
function _asAttachSign(role) {
  var c = document.getElementById('asSignCanvas_' + role);
  if (!c) return;
  // 해상도 보정
  var dpr = window.devicePixelRatio || 1;
  var rect = c.getBoundingClientRect();
  c.width = Math.floor(rect.width * dpr);
  c.height = Math.floor(rect.height * dpr);
  var ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1F2937';
  _asSignCtxMap[role] = { canvas: c, ctx: ctx };
  _asSignDrawing[role] = false;

  function pos(e) {
    var r = c.getBoundingClientRect();
    var pt = e.touches ? e.touches[0] : e;
    return { x: pt.clientX - r.left, y: pt.clientY - r.top };
  }
  function start(e) { e.preventDefault(); _asSignDrawing[role] = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(e) { if (!_asSignDrawing[role]) return; e.preventDefault(); var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  function end() { _asSignDrawing[role] = false; }
  c.addEventListener('mousedown', start); c.addEventListener('mousemove', move); c.addEventListener('mouseup', end); c.addEventListener('mouseleave', end);
  c.addEventListener('touchstart', start); c.addEventListener('touchmove', move); c.addEventListener('touchend', end);
}

function _asSignClear(role) {
  var entry = _asSignCtxMap[role];
  if (!entry) return;
  entry.ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
}

function asSignRedraw(ticketId, role) {
  // 기존 서명을 가린 채 다시 그리기 캔버스 띄움
  asGetExpand(ticketId).then(function (t) {
    if (t && t.signatures) {
      t.signatures = t.signatures.filter(function (s) { return s.role !== role; });
    }
    _asRenderDetail(t, _asCats());
  });
}

function asSignSave(ticketId, role) {
  var entry = _asSignCtxMap[role];
  var nameInput = document.getElementById('asSign_' + role + '_name');
  if (!entry) { if (typeof showToast === 'function') showToast('서명 캔버스를 찾지 못했습니다.', 'error'); return; }
  if (!nameInput || !nameInput.value.trim()) { if (typeof showToast === 'function') showToast('서명자 이름을 입력하세요.', 'warn'); return; }

  // 빈 캔버스 체크 (간단: 픽셀 데이터 일부 sampling)
  var ctx = entry.ctx;
  var w = entry.canvas.width, ht = entry.canvas.height;
  var data = ctx.getImageData(0, 0, w, ht).data;
  var hasInk = false;
  for (var i = 3; i < data.length; i += 4 * 50) { if (data[i] > 0) { hasInk = true; break; } }
  if (!hasInk) { if (typeof showToast === 'function') showToast('서명을 그려주세요.', 'warn'); return; }

  var dataUrl = entry.canvas.toDataURL('image/png');
  var payload = {
    role: role,
    signerName: nameInput.value.trim(),
    signedAt: new Date().toISOString(),
    signatureUrl: dataUrl
  };
  // 내부 사용자 서명이면 signerId 자동
  if (role !== 'customer_field' && typeof currentUser !== 'undefined' && currentUser) {
    payload.signerId = currentUser.id;
  }

  asSignaturePut(ticketId, payload).then(function () {
    if (typeof showToast === 'function') showToast('✍️ 서명이 저장되었습니다.');
    showASDetail(ticketId);
    renderAS();
  }).catch(function (err) {
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (typeof showToast === 'function') showToast('❌ 서명 저장 실패: ' + msg, 'error');
  });
}

function asSignSaveNameOnly(ticketId, role) {
  var nameInput = document.getElementById('asSign_' + role + '_name');
  if (!nameInput || !nameInput.value.trim()) { if (typeof showToast === 'function') showToast('이름을 입력하세요.', 'warn'); return; }
  // 기존 서명 url을 유지하면서 이름만 갱신 — 서버 GET 후 다시 보냄
  asGetExpand(ticketId).then(function (t) {
    var existing = (t.signatures || []).find(function (s) { return s.role === role; });
    if (!existing) { if (typeof showToast === 'function') showToast('기존 서명이 없습니다.', 'warn'); return; }
    return asSignaturePut(ticketId, {
      role: role,
      signerName: nameInput.value.trim(),
      signedAt: existing.signedAt,
      signatureUrl: existing.signatureUrl
    });
  }).then(function () {
    if (typeof showToast === 'function') showToast('이름이 갱신되었습니다.');
    showASDetail(ticketId);
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('❌ 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

function asCSATSave(ticketId) {
  var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  asGetExpand(ticketId).then(function (t) {
    var existing = (t.signatures || []).find(function (s) { return s.role === 'customer_field'; });
    var payload = {
      role: 'customer_field',
      signerName: existing ? existing.signerName : (t.customerName || ''),
      signedAt: existing ? existing.signedAt : null,
      signatureUrl: existing ? existing.signatureUrl : null,
      csatSpeed: v('asCSAT_speed'),
      csatQuality: v('asCSAT_quality'),
      csatOverall: v('asCSAT_overall'),
      comment: v('asCSAT_comment')
    };
    return asSignaturePut(ticketId, payload);
  }).then(function () {
    if (typeof showToast === 'function') showToast('⭐ CSAT가 저장되었습니다.');
    showASDetail(ticketId);
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('❌ 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

/* ─── 부품 추가 모달 + 액션 ─── */
function showASPartAddForm(ticketId) {
  var BILL = typeof AS_BILLING !== 'undefined' ? AS_BILLING : {};
  document.querySelectorAll('#asPartAddOverlay').forEach(function (el) { el.remove(); });
  var overlay = document.createElement('div');
  overlay.id = 'asPartAddOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';

  var today = new Date().toISOString().slice(0, 10);
  var h = '<div style="background:var(--bg);border:1px solid var(--bd);border-radius:10px;width:600px;max-width:100%;padding:20px 22px;color:var(--t2)">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--bd)">';
  h += '<div style="font-size:13px;font-weight:700">🔩 사용 부품 추가</div>';
  h += '<button onclick="document.getElementById(\'asPartAddOverlay\').remove()" style="border:none;background:none;font-size:18px;cursor:pointer;color:var(--t5)">✕</button></div>';
  h += '<div style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:10px;margin-bottom:10px">';
  h += _asField('사용일', '<input id="asPartNew_usedAt" type="date" value="' + today + '" ' + _asInpStyle() + '>');
  h += _asField('품목명 *', '<input id="asPartNew_itemName" type="text" placeholder="예: Dia. 1\" 3T Window" ' + _asInpStyle() + '>');
  h += _asField('Part No', '<input id="asPartNew_partNo" type="text" placeholder="옵션" ' + _asInpStyle() + '>');
  h += '</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">';
  h += _asField('수량', '<input id="asPartNew_qty" type="number" min="0" step="0.5" value="1" ' + _asInpStyle() + '>');
  h += _asField('단가 (원)', '<input id="asPartNew_unitPrice" type="number" min="0" step="100" value="0" ' + _asInpStyle() + '>');
  h += _asField('청구구분', _asEnumSelect('asPartNew_billing', BILL, 'warranty', false));
  h += '</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;margin-bottom:14px">';
  h += _asField('교체 대상 S/N', '<input id="asPartNew_replacedSn" type="text" placeholder="옵션" ' + _asInpStyle() + '>');
  h += _asField('메모', '<input id="asPartNew_note" type="text" placeholder="옵션" ' + _asInpStyle() + '>');
  h += '</div>';
  h += '<div style="display:flex;justify-content:flex-end;gap:8px">';
  h += '<button onclick="document.getElementById(\'asPartAddOverlay\').remove()" style="padding:7px 14px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer;font-size:11px">취소</button>';
  h += '<button onclick="asPartAdd(\'' + _asEsc(ticketId) + '\')" style="padding:7px 14px;border:none;border-radius:6px;background:#10B981;color:#fff;cursor:pointer;font-size:11px;font-weight:600">+ 부품 추가</button>';
  h += '</div></div>';
  overlay.innerHTML = h;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
}

function asPartAdd(ticketId) {
  var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var data = {
    usedAt: v('asPartNew_usedAt') || null,
    itemName: v('asPartNew_itemName'),
    partNo: v('asPartNew_partNo'),
    qty: Number(v('asPartNew_qty')) || 0,
    unitPrice: Number(v('asPartNew_unitPrice')) || 0,
    billing: v('asPartNew_billing') || 'warranty',
    replacedSn: v('asPartNew_replacedSn'),
    note: v('asPartNew_note'),
    _isNew: true
  };
  if (!data.itemName) { if (typeof showToast === 'function') showToast('품목명을 입력하세요.', 'warn'); return; }
  asPartPut(ticketId, data).then(function () {
    var ov = document.getElementById('asPartAddOverlay');
    if (ov) ov.remove();
    if (typeof showToast === 'function') showToast('부품이 추가되었습니다.');
    showASDetail(ticketId);
    renderAS();
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('❌ 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

function asPartRemove(ticketId, pid) {
  if (!confirm('이 부품 기록을 삭제하시겠습니까?')) return;
  asPartDel(ticketId, pid).then(function () {
    if (typeof showToast === 'function') showToast('삭제되었습니다.');
    showASDetail(ticketId);
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('❌ 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

/* ─── 첨부 추가 모달 + 액션 ─── */
function showASAttachAddForm(ticketId) {
  var CAT = typeof AS_ATTACH_CATEGORY !== 'undefined' ? AS_ATTACH_CATEGORY : {};
  document.querySelectorAll('#asAttachAddOverlay').forEach(function (el) { el.remove(); });
  var overlay = document.createElement('div');
  overlay.id = 'asAttachAddOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';

  var h = '<div style="background:var(--bg);border:1px solid var(--bd);border-radius:10px;width:520px;max-width:100%;padding:20px 22px;color:var(--t2)">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--bd)">';
  h += '<div style="font-size:13px;font-weight:700">📎 첨부 추가</div>';
  h += '<button onclick="document.getElementById(\'asAttachAddOverlay\').remove()" style="border:none;background:none;font-size:18px;cursor:pointer;color:var(--t5)">✕</button></div>';
  h += '<div style="font-size:10px;color:var(--t5);margin-bottom:10px">사진·캡처·PDF·문서 등을 첨부할 수 있습니다 (10MB 이하 자동 임베드).<br>큰 파일은 외부 스토리지(또는 문서관리)에 먼저 올린 뒤 URL만 등록하세요.</div>';
  h += '<div style="margin-bottom:10px">';
  h += '<label style="display:block;font-size:10px;color:var(--t4);margin-bottom:3px">📁 파일 선택 (이미지·캡처·PDF·문서 등)</label>';
  h += '<input id="asAttNew_file" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.log,.zip" onchange="_asAttachFilePicked(event)" style="font-size:11px;width:100%">';
  h += '<div id="asAttNew_preview" style="margin-top:8px"></div>';
  h += '</div>';
  h += '<div style="margin-bottom:10px">';
  h += _asField('카테고리', _asEnumSelect('asAttNew_category', CAT, 'photo_before', false));
  h += '</div>';
  h += '<div style="margin-bottom:10px">';
  h += _asField('파일 이름 *', '<input id="asAttNew_fileName" type="text" placeholder="예: before.jpg / measurement.pdf" ' + _asInpStyle() + '>');
  h += '</div>';
  h += '<div style="margin-bottom:10px">';
  h += _asField('파일 URL *', '<input id="asAttNew_fileUrl" type="text" placeholder="https://... 또는 data:... (위에서 파일 선택 시 자동 채움)" ' + _asInpStyle() + '>');
  h += '</div>';
  h += '<div style="margin-bottom:14px">';
  h += _asField('메모', '<input id="asAttNew_note" type="text" placeholder="옵션" ' + _asInpStyle() + '>');
  h += '</div>';
  h += '<div style="display:flex;justify-content:flex-end;gap:8px">';
  h += '<button onclick="document.getElementById(\'asAttachAddOverlay\').remove()" style="padding:7px 14px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer;font-size:11px">취소</button>';
  h += '<button onclick="asAttachAdd(\'' + _asEsc(ticketId) + '\')" style="padding:7px 14px;border:none;border-radius:6px;background:#10B981;color:#fff;cursor:pointer;font-size:11px;font-weight:600">+ 추가</button>';
  h += '</div></div>';
  overlay.innerHTML = h;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
}

function _asAttachFilePicked(ev) {
  var f = ev.target.files && ev.target.files[0];
  if (!f) return;
  if (f.size > 10 * 1024 * 1024) {
    if (typeof showToast === 'function') showToast('10MB 이하 파일만 직접 첨부 가능 (그 이상은 외부 URL 사용)', 'warn');
    return;
  }
  var reader = new FileReader();
  reader.onload = function (e) {
    var urlInp = document.getElementById('asAttNew_fileUrl');
    var nameInp = document.getElementById('asAttNew_fileName');
    var catSel  = document.getElementById('asAttNew_category');
    var prev    = document.getElementById('asAttNew_preview');
    var dataUrl = e.target.result;
    if (urlInp) urlInp.value = dataUrl;
    if (nameInp && !nameInp.value) nameInp.value = f.name;

    // 카테고리 자동 추정 (사용자가 이미 변경했으면 덮어쓰지 않음)
    if (catSel && (catSel.value === 'photo_before' || !catSel.value)) {
      var mt = (f.type || '').toLowerCase();
      var ext = (f.name.split('.').pop() || '').toLowerCase();
      var guess = 'etc';
      if (mt.indexOf('image/') === 0) guess = 'photo_before';
      else if (mt === 'application/pdf' || ext === 'pdf') guess = 'doc';
      else if (['doc','docx','xls','xlsx','ppt','pptx','txt','csv'].indexOf(ext) >= 0) guess = 'doc';
      else if (ext === 'log') guess = 'log';
      // catSel 옵션에 있는 것만 적용
      if (catSel.querySelector('option[value="' + guess + '"]')) catSel.value = guess;
    }

    // 미니 프리뷰
    if (prev) {
      var html = '';
      var sizeKb = (f.size / 1024).toFixed(0);
      if ((f.type || '').indexOf('image/') === 0) {
        html += '<div style="display:flex;gap:8px;align-items:center"><img src="' + dataUrl + '" style="max-width:120px;max-height:80px;border:1px solid var(--bd);border-radius:4px">';
        html += '<div style="font-size:10px;color:var(--t5)">' + _asEsc(f.name) + '<br>' + sizeKb + ' KB</div></div>';
      } else if ((f.type || '').toLowerCase() === 'application/pdf') {
        html += '<div style="font-size:11px;color:var(--t3)">📄 ' + _asEsc(f.name) + ' <span style="color:var(--t5)">(' + sizeKb + ' KB)</span></div>';
      } else {
        html += '<div style="font-size:11px;color:var(--t3)">📎 ' + _asEsc(f.name) + ' <span style="color:var(--t5)">(' + sizeKb + ' KB)</span></div>';
      }
      prev.innerHTML = html;
    }
  };
  reader.readAsDataURL(f);
}

function asAttachAdd(ticketId) {
  var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var data = {
    category: v('asAttNew_category') || 'etc',
    fileName: v('asAttNew_fileName'),
    fileUrl: v('asAttNew_fileUrl'),
    note: v('asAttNew_note')
  };
  if (!data.fileName) { if (typeof showToast === 'function') showToast('파일 이름을 입력하세요.', 'warn'); return; }
  if (!data.fileUrl) { if (typeof showToast === 'function') showToast('파일 URL을 입력하거나 이미지를 선택하세요.', 'warn'); return; }
  asAttachmentPut(ticketId, data).then(function () {
    var ov = document.getElementById('asAttachAddOverlay');
    if (ov) ov.remove();
    if (typeof showToast === 'function') showToast('첨부가 추가되었습니다.');
    showASDetail(ticketId);
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('❌ 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

function asAttachRemove(ticketId, aid) {
  if (!confirm('이 첨부를 삭제하시겠습니까?')) return;
  asAttachmentDel(ticketId, aid).then(function () {
    if (typeof showToast === 'function') showToast('삭제되었습니다.');
    showASDetail(ticketId);
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('❌ 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
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
  h += '<div style="display:flex;gap:10px;min-width:fit-content">';
  cols.forEach(function (c) {
    h += '<div style="flex:0 0 220px;display:flex;flex-direction:column">';
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
      col.style.background = '';
    });
    col.addEventListener('drop', function (e) {
      e.preventDefault();
      col.style.background = '';
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

/* ═══ ⑥ 보고서 — 엑셀 6시트 다운로드 (SheetJS) + 인쇄 미리보기 ═══ */
function asExportExcel(ticketId) {
  if (typeof XLSX === 'undefined') {
    if (typeof showToast === 'function') showToast('SheetJS(xlsx) 라이브러리를 불러올 수 없습니다.', 'error');
    return;
  }
  asGetExpand(ticketId).then(function (t) {
    var CAT = _asCats();
    var DEPT_MAP = typeof DEPT !== 'undefined' ? DEPT : {};
    var BILL = typeof AS_BILLING !== 'undefined' ? AS_BILLING : {};
    var WT = typeof AS_WORK_TYPE !== 'undefined' ? AS_WORK_TYPE : {};
    var LS = typeof AS_LOG_STATUS !== 'undefined' ? AS_LOG_STATUS : {};
    var CSAT = typeof AS_CSAT !== 'undefined' ? AS_CSAT : {};
    var label = function (m, k) { return (m && m[k] && m[k].label) || k || ''; };
    var freqTxt = t.frequency ? _asFreqDisplay(t.frequency, t.frequencyCount) : '';

    var wb = XLSX.utils.book_new();

    // 시트 1: 표지요약
    var deptDur = {};
    (t.activityLogs || []).forEach(function (l) {
      deptDur[l.dept] = (deptDur[l.dept] || 0) + Number(l.durationH || 0);
    });
    var totalH = Object.keys(deptDur).reduce(function (s, k) { return s + deptDur[k]; }, 0);

    var s1 = [
      ['A/S 작업 보고서'],
      ['장비 A/S 처리 결과 통합 리포트 (CS·공정·SW·제조·품질)'],
      [],
      ['리포트 번호', t.ticketNo || '', '', '작성일', _asFmtDate(new Date().toISOString()), '', '리포트 상태', label(typeof AS_STATUS !== 'undefined' ? AS_STATUS : {}, t.status)],
      [],
      ['▶ 고객 및 장비 정보'],
      ['고객사', t.customerName || '', '', '사이트/라인', t.siteLine || '', '', '담당자', t.customerContact || ''],
      ['장비모델', t.equipmentModel || '', '', 'Serial No.', t.serialNo || '', '', '장비번호', t.equipmentNo || ''],
      ['설치일자', _asFmtDate(t.installDate), '', '보증여부', t.warrantyStatus || '', '', '수주번호', t.orderNo || ''],
      [],
      ['▶ 접수 정보'],
      ['접수일시', _asFmtDT(t.receivedAt), '', '접수경로', label(typeof AS_CHANNEL !== 'undefined' ? AS_CHANNEL : {}, t.channel), '', '긴급도', t.priority || ''],
      ['카테고리', (CAT[t.category] || {}).label || t.category, '', '처리방식', label(typeof AS_METHOD !== 'undefined' ? AS_METHOD : {}, t.method)],
      [],
      ['▶ 이슈 요약 (고객 신고 내용)'],
      [t.issueSummary || ''],
      [],
      ['▶ 부서별 처리 요약'],
      ['부서', '소요(h)', '비고']
    ];
    Object.keys(deptDur).forEach(function (k) {
      s1.push([label(DEPT_MAP, k), Number(deptDur[k].toFixed(2)), '']);
    });
    s1.push(['합계', Number(totalH.toFixed(2)), '']);
    s1.push([]);
    s1.push(['▶ 최종 조치 결과 요약']);
    s1.push(['완료여부', t.closure || '', '', '작업종료일', _asFmtDate(t.closedAt), '', '장비 최종 상태', t.finalEquipStatus || '']);
    s1.push(['근본원인(RCA)', t.rca || '']);
    s1.push(['재발방지 대책', t.prevention || '']);
    s1.push(['모니터링', t.monitoring || '']);
    s1.push([]);
    s1.push(['▶ 고객 확인 및 서명']);
    var cust = (t.signatures || []).find(function (s) { return s.role === 'customer_field'; });
    var eng = (t.signatures || []).find(function (s) { return s.role === 'engineer'; });
    s1.push(['현장 담당자', (cust && cust.signerName) || '', '서명일', _asFmtDate(cust && cust.signedAt), 'CSAT', label(CSAT, cust && cust.csatOverall)]);
    s1.push(['담당 엔지니어', (eng && eng.signerName) || '', '서명일', _asFmtDate(eng && eng.signedAt)]);

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), '표지요약');

    // 시트 2: 접수상세
    var s2 = [
      ['접수 및 이슈 상세'],
      [],
      ['리포트 번호', t.ticketNo, '고객사', t.customerName, '장비모델', t.equipmentModel],
      [],
      ['▶ 접수 상세'],
      ['최초 접수일시', _asFmtDT(t.receivedAt)],
      ['접수자(CS)', '(시스템에서 user_id 매핑)'],
      ['약속 응답일시', _asFmtDT(t.promisedResponseAt)],
      ['약속 방문일시', _asFmtDT(t.promisedVisitAt)],
      [],
      ['▶ 고객 신고 내용 (원문)'],
      [t.issueSummary || ''],
      [],
      ['▶ 1차 분석 (CS/공정)'],
      ['재현 여부', label(typeof AS_REPRODUCTION !== 'undefined' ? AS_REPRODUCTION : {}, t.reproduction)],
      ['발생 빈도', freqTxt],
      ['영향 범위', t.impactScope || ''],
      ['1차 분석 결과', t.initialAnalysis || ''],
      [],
      ['▶ 처리부서 분기 결정'],
      ['부서', '역할', '담당자', '처리방식', '약속일시', '시작', '완료', '소요(h)', '상태', '결과']
    ];
    (t.assignments || []).forEach(function (a) {
      s2.push([label(DEPT_MAP, a.dept), a.role === 'primary' ? '주관' : '보조',
        a.assigneeName || '', label(typeof AS_METHOD !== 'undefined' ? AS_METHOD : {}, a.method),
        _asFmtDT(a.promisedAt), _asFmtDT(a.startedAt), _asFmtDT(a.completedAt),
        Number(a.durationH || 0), label(typeof AS_ASSIGN_STATUS !== 'undefined' ? AS_ASSIGN_STATUS : {}, a.status),
        a.resultNote || '']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), '접수상세');

    // 시트 3: 부서별 처리이력
    var s3 = [
      ['부서별 처리 이력 (Activity Log)'],
      [],
      ['No', '일자', '부서', '담당자', '작업유형', '문제/분석', '조치내용', '소요(h)', '상태', '후속']
    ];
    (t.activityLogs || []).forEach(function (l) {
      s3.push([l.seq, _asFmtDT(l.workedAt), label(DEPT_MAP, l.dept), l.authorName || '',
        label(WT, l.workType), l.problem || '', l.actionTaken || '',
        Number(l.durationH || 0), label(LS, l.status), l.followup || '']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s3), '처리이력');

    // 시트 4: 사용 부품
    var s4 = [
      ['사용 부품 / 소모품'],
      [],
      ['사용일', '품목', 'Part No', '수량', '단가', '금액', '교체 S/N', '청구구분', '메모']
    ];
    var totals = {}; var grand = 0;
    (t.parts || []).forEach(function (p) {
      var amt = Number(p.amount || (Number(p.qty || 0) * Number(p.unitPrice || 0)));
      totals[p.billing] = (totals[p.billing] || 0) + amt;
      grand += amt;
      s4.push([_asFmtDate(p.usedAt), p.itemName || '', p.partNo || '',
        Number(p.qty || 0), Number(p.unitPrice || 0), amt,
        p.replacedSn || '', label(BILL, p.billing), p.note || '']);
    });
    s4.push([]);
    s4.push(['▶ 청구구분별 자동 집계']);
    Object.keys(totals).forEach(function (k) {
      s4.push([label(BILL, k), '', '', '', '', totals[k]]);
    });
    s4.push(['합계', '', '', '', '', grand]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s4), '부품');

    // 시트 5: 최종 결과 + 첨부 + 고객 확인
    var s5 = [
      ['최종 결과 · 첨부 · 고객 확인'],
      [],
      ['▶ 장비 최종 상태'],
      ['운전 가능 여부', t.finalEquipStatus || '', '추가 모니터링', t.monitoring || ''],
      ['현재 장비 상태 상세', ''],
      ['추가 권고 / 개선 제안', t.prevention || ''],
      [],
      ['▶ 첨부 자료'],
      ['구분', '파일/문서명', '경로/링크', '메모']
    ];
    (t.attachments || []).forEach(function (a) {
      var ac = typeof AS_ATTACH_CATEGORY !== 'undefined' ? AS_ATTACH_CATEGORY : {};
      s5.push([label(ac, a.category), a.fileName || '', a.fileUrl || '', a.note || '']);
    });
    s5.push([]);
    s5.push(['▶ 고객 피드백 / 만족도']);
    s5.push(['응답속도', label(CSAT, cust && cust.csatSpeed)]);
    s5.push(['처리품질', label(CSAT, cust && cust.csatQuality)]);
    s5.push(['전반 만족도', label(CSAT, cust && cust.csatOverall)]);
    s5.push(['고객 코멘트', (cust && cust.comment) || '']);
    s5.push([]);
    s5.push(['▶ 고객 확인 서명']);
    s5.push(['현장 담당자', (cust && cust.signerName) || '', '서명일', _asFmtDate(cust && cust.signedAt)]);
    s5.push(['담당 엔지니어', (eng && eng.signerName) || '', '서명일', _asFmtDate(eng && eng.signedAt)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s5), '최종결과');

    // 시트 6: 코드표 / 작성 가이드 (정적)
    var s6 = [
      ['코드표 및 작성 가이드'],
      [],
      ['▶ 작성 순서'],
      ['1.', '접수번호 자동 채번: AS-{년도}-{월}-{순번}'],
      ['2.', '시트2(접수상세) → 시트3(처리이력) → 시트4(부품) → 시트5(결과) → 시트1(표지요약)'],
      ['3.', '한 작업당 한 줄. 부서·담당자·일자·작업유형·내용·소요시간·상태 필수'],
      [],
      ['▶ 표준 코드값 (드롭다운 enum)'],
      ['카테고리'].concat(Object.keys(CAT).map(function (k) { return CAT[k].label; })),
      ['긴급도', 'P1-긴급(라인정지)', 'P2-높음(생산영향)', 'P3-보통', 'P4-낮음'],
      ['처리방식', '원격지원', '출장', 'RMA', '가이드제공', '자료송부'],
      ['처리 상태', '진행중', '완료', '대기(부품)', '대기(고객확인)', '이관', '보류', '취소'],
      ['보증/청구', '보증(무상)', '보증외(유상)', 'Goodwill(무상)', '확인필요'],
      ['만족도', '매우만족', '만족', '보통', '불만족', '매우불만족', 'N/A']
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s6), '코드표');

    var fname = (t.ticketNo || 'AS_Report') + '_' + _asFmtDate(new Date().toISOString()) + '.xlsx';
    XLSX.writeFile(wb, fname);
    if (typeof showToast === 'function') showToast('📊 ' + fname + ' 다운로드 시작');
  }).catch(function (err) {
    console.error('[asExportExcel]', err);
    if (typeof showToast === 'function') showToast('엑셀 생성 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

function asPrintReport(ticketId) {
  asGetExpand(ticketId).then(function (t) {
    var CAT = _asCats();
    var DEPT_MAP = typeof DEPT !== 'undefined' ? DEPT : {};
    var html = '';
    html += '<!DOCTYPE html><html><head><meta charset="utf-8"><title>A/S Report ' + _asEsc(t.ticketNo) + '</title>';
    html += '<style>body{font-family:Malgun Gothic,Arial,sans-serif;font-size:11px;color:#1F2937;padding:30px;max-width:800px;margin:0 auto}';
    html += 'h1{font-size:20px;border-bottom:2px solid #F59E0B;padding-bottom:8px}';
    html += 'h2{font-size:14px;background:#F3F4F6;padding:5px 10px;margin-top:18px}';
    html += 'table{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px}';
    html += 'th,td{border:1px solid #D1D5DB;padding:5px 8px;text-align:left}';
    html += 'th{background:#F9FAFB;font-weight:700}';
    html += '.summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:8px 0}';
    html += '.summary>div{border:1px solid #E5E7EB;padding:8px;border-radius:4px}';
    html += '.summary .k{font-size:9px;color:#6B7280;margin-bottom:2px}';
    html += '.sig{display:flex;gap:20px;margin-top:14px}';
    html += '.sig>div{flex:1;border:1px solid #E5E7EB;padding:10px;text-align:center;min-height:90px}';
    html += '.sig img{max-height:60px}';
    html += '@media print{button{display:none}}</style></head><body>';
    html += '<h1>🛠️ A/S Report — ' + _asEsc(t.ticketNo) + '</h1>';
    html += '<button onclick="window.print()" style="margin-bottom:14px;padding:8px 14px;background:#F59E0B;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer">🖨️ 인쇄</button>';

    html += '<h2>① 고객 및 장비</h2>';
    html += '<div class="summary">';
    [['고객사', t.customerName], ['장비모델', t.equipmentModel], ['Serial No.', t.serialNo],
     ['장비번호', t.equipmentNo], ['수주번호', t.orderNo], ['보증여부', t.warrantyStatus]].forEach(function (r) {
      html += '<div><div class="k">' + _asEsc(r[0]) + '</div><div>' + _asEsc(r[1] || '-') + '</div></div>';
    });
    html += '</div>';

    html += '<h2>② 접수 정보</h2>';
    html += '<div class="summary">';
    [['접수일시', _asFmtDT(t.receivedAt)], ['긴급도', t.priority],
     ['카테고리', (CAT[t.category] || {}).label || t.category],
     ['재현', t.reproduction], ['빈도', _asFreqDisplay(t.frequency, t.frequencyCount)],
     ['영향범위', t.impactScope]].forEach(function (r) {
      html += '<div><div class="k">' + _asEsc(r[0]) + '</div><div>' + _asEsc(r[1] || '-') + '</div></div>';
    });
    html += '</div>';

    html += '<h2>③ 신고 내용</h2><div style="border:1px solid #E5E7EB;padding:10px;white-space:pre-wrap">' + _asEsc(t.issueSummary || '') + '</div>';

    if ((t.activityLogs || []).length) {
      html += '<h2>④ 처리 이력</h2><table><thead><tr><th>#</th><th>일자</th><th>부서</th><th>유형</th><th>조치</th><th>소요(h)</th></tr></thead><tbody>';
      t.activityLogs.forEach(function (l) {
        var WT = typeof AS_WORK_TYPE !== 'undefined' ? AS_WORK_TYPE : {};
        html += '<tr><td>' + l.seq + '</td><td>' + _asFmtDT(l.workedAt) + '</td><td>' +
          _asEsc((DEPT_MAP[l.dept] || {}).label || l.dept) + '</td><td>' +
          _asEsc((WT[l.workType] || {}).label || l.workType) + '</td><td>' +
          _asEsc(l.actionTaken || '') + '</td><td style="text-align:right">' +
          (l.durationH || 0) + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    if ((t.parts || []).length) {
      html += '<h2>⑤ 사용 부품</h2><table><thead><tr><th>품목</th><th>수량</th><th>단가</th><th>금액</th><th>청구</th></tr></thead><tbody>';
      var grand = 0;
      t.parts.forEach(function (p) {
        var amt = Number(p.amount || (Number(p.qty || 0) * Number(p.unitPrice || 0)));
        grand += amt;
        html += '<tr><td>' + _asEsc(p.itemName) + '</td><td style="text-align:right">' + (p.qty || 0) + '</td><td style="text-align:right">' +
          Number(p.unitPrice || 0).toLocaleString() + '</td><td style="text-align:right">' +
          amt.toLocaleString() + '</td><td>' + _asEsc(p.billing) + '</td></tr>';
      });
      html += '<tr><th colspan="3" style="text-align:right">합계</th><th style="text-align:right">' + grand.toLocaleString() + '</th><th></th></tr></tbody></table>';
    }

    html += '<h2>⑥ 근본원인 / 재발방지</h2>';
    html += '<div><strong>RCA:</strong> ' + _asEsc(t.rca || '-') + '</div>';
    html += '<div style="margin-top:6px"><strong>재발방지:</strong> ' + _asEsc(t.prevention || '-') + '</div>';
    html += '<div style="margin-top:6px"><strong>장비 최종 상태:</strong> ' + _asEsc(t.finalEquipStatus || '-') + ' · <strong>모니터링:</strong> ' + _asEsc(t.monitoring || '-') + '</div>';

    var cust = (t.signatures || []).find(function (s) { return s.role === 'customer_field'; });
    var eng = (t.signatures || []).find(function (s) { return s.role === 'engineer'; });
    html += '<h2>⑦ 서명</h2><div class="sig">';
    html += '<div><div class="k">현장 담당자 (고객)</div>';
    html += (cust && cust.signatureUrl) ? '<img src="' + _asEsc(cust.signatureUrl) + '">' : '<div style="height:60px;color:#9CA3AF">(미서명)</div>';
    html += '<div style="margin-top:4px;font-weight:700">' + _asEsc((cust && cust.signerName) || '-') + '</div>';
    html += '<div style="font-size:9px;color:#6B7280">' + _asFmtDate(cust && cust.signedAt) + '</div></div>';
    html += '<div><div class="k">담당 엔지니어</div>';
    html += (eng && eng.signatureUrl) ? '<img src="' + _asEsc(eng.signatureUrl) + '">' : '<div style="height:60px;color:#9CA3AF">(미서명)</div>';
    html += '<div style="margin-top:4px;font-weight:700">' + _asEsc((eng && eng.signerName) || '-') + '</div>';
    html += '<div style="font-size:9px;color:#6B7280">' + _asFmtDate(eng && eng.signedAt) + '</div></div>';
    html += '</div>';

    html += '</body></html>';

    var w = window.open('', '_blank', 'width=900,height=900');
    w.document.write(html);
    w.document.close();
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('미리보기 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

/* ═══ ⑥ 보고서 — PDF 인앱 미리보기 + 다운로드 + 메일 발송 ═══
 * 1) asReportPdfPreview(id): jsPDF/html2canvas로 PDF 생성 → 모달 iframe에 미리보기
 * 2) 모달 안 버튼: 📥 다운로드 / ✉️ 메일 보내기
 * 3) 메일은 to/subject/message 입력 → POST /api/as-tickets/:id/email-report
 *
 * PDF 한글: html2canvas로 비트맵 캡처 후 jsPDF에 이미지로 임베드 (폰트 임베드 우회) */

function _asReportHtmlForPdf(t, opts) {
  opts = opts || {};
  // 인쇄용과 같은 HTML 구조를 재사용하되, 인쇄 버튼 등은 제거
  var CAT = _asCats();
  var DEPT_MAP = typeof DEPT !== 'undefined' ? DEPT : {};
  var WT = typeof AS_WORK_TYPE !== 'undefined' ? AS_WORK_TYPE : {};
  var BILL = typeof AS_BILLING !== 'undefined' ? AS_BILLING : {};
  var CSAT = typeof AS_CSAT !== 'undefined' ? AS_CSAT : {};
  var ATT_CAT = typeof AS_ATTACH_CATEGORY !== 'undefined' ? AS_ATTACH_CATEGORY : {};

  var html = '';
  html += '<div id="asPdfRoot" style="font-family:\'Malgun Gothic\',\'맑은 고딕\',sans-serif;font-size:11px;color:#1F2937;padding:24px;width:794px;background:#fff;line-height:1.55">';
  html += '<h1 style="font-size:22px;border-bottom:2px solid #F59E0B;padding-bottom:8px;margin:0 0 12px 0">🛠️ A/S 작업 보고서</h1>';
  html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#6B7280;margin-bottom:14px">';
  html += '<span>접수번호 <strong style="color:#1F2937">' + _asEsc(t.ticketNo) + '</strong></span>';
  html += '<span>작성일 ' + _asFmtDate(new Date().toISOString()) + '</span>';
  html += '</div>';

  // ① 고객/장비
  html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">① 고객 및 장비</h2>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:11px"><tbody>';
  [['고객사', t.customerName], ['사이트/라인', t.siteLine], ['장비모델', t.equipmentModel],
   ['Serial No.', t.serialNo], ['장비번호', t.equipmentNo], ['수주번호', t.orderNo],
   ['보증여부', t.warrantyStatus], ['설치일', _asFmtDate(t.installDate)]
  ].forEach(function (r, i) {
    if (i % 2 === 0) html += '<tr>';
    html += '<th style="text-align:left;padding:5px 8px;background:#F9FAFB;width:14%;border:1px solid #E5E7EB;font-weight:600">' + _asEsc(r[0]) + '</th>';
    html += '<td style="padding:5px 8px;border:1px solid #E5E7EB;width:36%">' + _asEsc(r[1] || '-') + '</td>';
    if (i % 2 === 1) html += '</tr>';
  });
  html += '</tbody></table>';

  // ② 접수
  html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">② 접수 정보</h2>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:11px"><tbody>';
  [['접수일시', _asFmtDT(t.receivedAt)], ['긴급도', t.priority],
   ['카테고리', (CAT[t.category] || {}).label || t.category || '-'],
   ['재현', _asEnumLabel('AS_REPRODUCTION', t.reproduction)],
   ['빈도', _asFreqDisplay(t.frequency, t.frequencyCount)],
   ['영향범위', t.impactScope]
  ].forEach(function (r, i) {
    if (i % 2 === 0) html += '<tr>';
    html += '<th style="text-align:left;padding:5px 8px;background:#F9FAFB;width:14%;border:1px solid #E5E7EB;font-weight:600">' + _asEsc(r[0]) + '</th>';
    html += '<td style="padding:5px 8px;border:1px solid #E5E7EB;width:36%">' + _asEsc(r[1] || '-') + '</td>';
    if (i % 2 === 1) html += '</tr>';
  });
  html += '</tbody></table>';

  // ③ 신고
  html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">③ 고객 신고 내용</h2>';
  html += '<div style="border:1px solid #E5E7EB;padding:10px;white-space:pre-wrap;background:#fff">' + _asEsc(t.issueSummary || '-') + '</div>';
  if (t.initialAnalysis) {
    html += '<div style="margin-top:6px;border:1px solid #E5E7EB;padding:8px;background:#FAFAFA;font-size:11px"><strong>1차 분석:</strong> ' + _asEsc(t.initialAnalysis) + '</div>';
  }

  // ④ 처리이력
  if ((t.activityLogs || []).length) {
    html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">④ 처리 이력</h2>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr>';
    ['#', '일자', '부서', '유형', '조치', '소요(h)'].forEach(function (c) {
      html += '<th style="border:1px solid #E5E7EB;padding:5px 6px;background:#F9FAFB;text-align:left;font-weight:600">' + c + '</th>';
    });
    html += '</tr></thead><tbody>';
    t.activityLogs.forEach(function (l) {
      html += '<tr>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + l.seq + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asFmtDT(l.workedAt) + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc((DEPT_MAP[l.dept] || {}).label || l.dept) + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc((WT[l.workType] || {}).label || l.workType) + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc(l.actionTaken || '') + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px;text-align:right">' + (l.durationH || 0) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
  }

  // ⑤ 사용 부품
  if ((t.parts || []).length) {
    html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">⑤ 사용 부품 / 소모품</h2>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr>';
    ['품목', 'Part No', '수량', '단가', '금액', '청구'].forEach(function (c) {
      html += '<th style="border:1px solid #E5E7EB;padding:5px 6px;background:#F9FAFB;text-align:left;font-weight:600">' + c + '</th>';
    });
    html += '</tr></thead><tbody>';
    var grand = 0;
    t.parts.forEach(function (p) {
      var amt = Number(p.amount || (Number(p.qty || 0) * Number(p.unitPrice || 0)));
      grand += amt;
      html += '<tr>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc(p.itemName) + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc(p.partNo || '-') + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px;text-align:right">' + (p.qty || 0) + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px;text-align:right">' + Number(p.unitPrice || 0).toLocaleString() + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px;text-align:right">' + amt.toLocaleString() + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc((BILL[p.billing] || {}).label || p.billing) + '</td>';
      html += '</tr>';
    });
    html += '<tr><th colspan="4" style="border:1px solid #E5E7EB;padding:5px 8px;text-align:right;background:#F9FAFB">합계</th>';
    html += '<th style="border:1px solid #E5E7EB;padding:5px 8px;text-align:right;background:#F9FAFB">' + grand.toLocaleString() + '</th>';
    html += '<th style="border:1px solid #E5E7EB;background:#F9FAFB"></th></tr>';
    html += '</tbody></table>';
  }

  // ⑥ RCA / 재발방지
  html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">⑥ 근본원인 · 재발방지 · 최종 상태</h2>';
  html += '<div style="border:1px solid #E5E7EB;padding:10px"><strong>근본원인 (RCA):</strong><div style="margin-top:4px;white-space:pre-wrap">' + _asEsc(t.rca || '-') + '</div></div>';
  html += '<div style="border:1px solid #E5E7EB;padding:10px;margin-top:4px"><strong>재발방지 대책:</strong><div style="margin-top:4px;white-space:pre-wrap">' + _asEsc(t.prevention || '-') + '</div></div>';
  html += '<div style="display:flex;gap:8px;margin-top:4px;font-size:11px">';
  html += '<div style="flex:1;border:1px solid #E5E7EB;padding:8px"><strong>장비 최종 상태:</strong> ' + _asEsc(t.finalEquipStatus || '-') + '</div>';
  html += '<div style="flex:1;border:1px solid #E5E7EB;padding:8px"><strong>모니터링:</strong> ' + _asEsc(t.monitoring || '-') + '</div>';
  html += '<div style="flex:1;border:1px solid #E5E7EB;padding:8px"><strong>완료분류:</strong> ' + _asEsc(t.closure || '-') + '</div>';
  html += '</div>';

  // ⑦ 첨부 자료 (사진은 작게 임베드)
  if ((t.attachments || []).length) {
    html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">⑦ 첨부 자료 (' + t.attachments.length + '개)</h2>';
    var photos = t.attachments.filter(_asAttIsImage);
    var others = t.attachments.filter(function (a) { return !_asAttIsImage(a); });
    if (photos.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">';
      photos.forEach(function (a) {
        var cat = (ATT_CAT[a.category] || {});
        html += '<div style="width:180px;border:1px solid #E5E7EB;padding:4px;background:#fff">';
        html += '<img src="' + _asEsc(a.fileUrl) + '" style="width:100%;height:120px;object-fit:contain;background:#fff;display:block">';
        html += '<div style="font-size:9px;color:#6B7280;margin-top:3px">' + _asEsc((cat.icon || '') + ' ' + (cat.label || '')) + '</div>';
        html += '<div style="font-size:10px;color:#1F2937;font-weight:600;word-break:break-all">' + _asEsc(a.fileName) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    if (others.length) {
      html += '<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr>';
      ['구분', '파일명', '메모'].forEach(function (c) {
        html += '<th style="border:1px solid #E5E7EB;padding:5px 6px;background:#F9FAFB;text-align:left;font-weight:600">' + c + '</th>';
      });
      html += '</tr></thead><tbody>';
      others.forEach(function (a) {
        var cat = (ATT_CAT[a.category] || {});
        html += '<tr>';
        html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc((cat.icon || '') + ' ' + (cat.label || '')) + '</td>';
        html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc(a.fileName) + '</td>';
        html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc(a.note || '-') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
  }

  // ⑧ 서명 + CSAT
  var cust = (t.signatures || []).find(function (s) { return s.role === 'customer_field'; });
  var eng = (t.signatures || []).find(function (s) { return s.role === 'engineer'; });
  html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">⑧ 고객 확인 · 서명</h2>';
  html += '<div style="display:flex;gap:10px">';
  [['현장 담당자 (고객)', cust], ['담당 엔지니어', eng]].forEach(function (pair) {
    var s = pair[1];
    html += '<div style="flex:1;border:1px solid #E5E7EB;padding:10px;text-align:center;min-height:110px">';
    html += '<div style="font-size:10px;color:#6B7280;margin-bottom:4px">' + _asEsc(pair[0]) + '</div>';
    html += (s && s.signatureUrl)
      ? '<img src="' + _asEsc(s.signatureUrl) + '" style="max-height:60px">'
      : '<div style="height:60px;color:#9CA3AF;font-size:10px;display:flex;align-items:center;justify-content:center">(미서명)</div>';
    html += '<div style="margin-top:4px;font-weight:700;font-size:11px">' + _asEsc((s && s.signerName) || '-') + '</div>';
    html += '<div style="font-size:9px;color:#6B7280">' + _asFmtDate(s && s.signedAt) + '</div>';
    html += '</div>';
  });
  html += '</div>';
  if (cust && (cust.csatSpeed || cust.csatQuality || cust.csatOverall || cust.comment)) {
    html += '<div style="margin-top:6px;border:1px solid #E5E7EB;padding:8px;background:#FAFAFA;font-size:11px">';
    html += '<strong>CSAT</strong> — ';
    html += '응답: ' + _asEsc((CSAT[cust.csatSpeed] || {}).label || '-') + ' · ';
    html += '품질: ' + _asEsc((CSAT[cust.csatQuality] || {}).label || '-') + ' · ';
    html += '전반: ' + _asEsc((CSAT[cust.csatOverall] || {}).label || '-');
    if (cust.comment) html += '<div style="margin-top:4px;color:#374151">"' + _asEsc(cust.comment) + '"</div>';
    html += '</div>';
  }

  html += '<div style="margin-top:18px;padding-top:8px;border-top:1px solid #E5E7EB;font-size:9px;color:#9CA3AF;text-align:center">업무 관리자 — A/S 모듈</div>';
  html += '</div>';
  return html;
}

/* 보고서 PDF를 생성해서 Blob/Base64로 반환. 미리보기·다운로드·메일에 공통 사용 */
function _asGeneratePdf(t) {
  return new Promise(function (resolve, reject) {
    if (!window.jspdf || !window.html2canvas) {
      reject(new Error('PDF 라이브러리(jsPDF/html2canvas)가 로드되지 않았습니다. 페이지를 새로고침 후 다시 시도하세요.'));
      return;
    }
    // 화면 밖 컨테이너에 HTML 렌더 — 폭을 명시해서 html2canvas가 0폭으로 캡처하는 사고 방지
    var holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:794px;background:#fff;z-index:-1';
    holder.innerHTML = _asReportHtmlForPdf(t);
    document.body.appendChild(holder);
    var root = holder.querySelector('#asPdfRoot');

    window.html2canvas(root, { scale: 2, backgroundColor: '#ffffff', useCORS: true, allowTaint: true, logging: false, width: 794, windowWidth: 794 }).then(function (canvas) {
      try {
        var jsPDF = window.jspdf.jsPDF;
        var pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        var pageW = pdf.internal.pageSize.getWidth();   // 210
        var pageH = pdf.internal.pageSize.getHeight();  // 297
        var margin = 8;
        var imgW = pageW - margin * 2;
        // canvas → 비율 유지 + 페이지 분할
        var imgH = canvas.height * imgW / canvas.width;
        var imgData = canvas.toDataURL('image/jpeg', 0.92);
        if (imgH <= pageH - margin * 2) {
          pdf.addImage(imgData, 'JPEG', margin, margin, imgW, imgH);
        } else {
          // 다중 페이지 — canvas를 페이지 높이 단위로 잘라서 add
          var pageContentH = pageH - margin * 2;          // mm
          var pxPerMm = canvas.width / imgW;              // px / mm
          var pageContentPx = Math.floor(pageContentH * pxPerMm);
          var y = 0;
          while (y < canvas.height) {
            var sliceH = Math.min(pageContentPx, canvas.height - y);
            var slice = document.createElement('canvas');
            slice.width = canvas.width;
            slice.height = sliceH;
            slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
            var sliceImg = slice.toDataURL('image/jpeg', 0.92);
            if (y > 0) pdf.addPage();
            pdf.addImage(sliceImg, 'JPEG', margin, margin, imgW, sliceH / pxPerMm);
            y += sliceH;
          }
        }
        var fileName = (t.ticketNo || 'AS_Report') + '_' + _asFmtDate(new Date().toISOString()) + '.pdf';
        var blob = pdf.output('blob');
        var dataUrl = pdf.output('datauristring');
        document.body.removeChild(holder);
        resolve({ blob: blob, dataUrl: dataUrl, fileName: fileName, pdf: pdf });
      } catch (e) {
        try { document.body.removeChild(holder); } catch (_) {}
        reject(e);
      }
    }).catch(function (e) {
      try { document.body.removeChild(holder); } catch (_) {}
      reject(e);
    });
  });
}

/* 메일 작성기 URL 빌더 — 사용자가 선택한 웹메일 서비스의 compose 화면을 직접 연다.
 * 각 서비스의 URL 파라미터 규약은 공식문서/실측 기반.
 * Naver는 body 파라미터를 일관되게 지원하지 않아 subject만 채움. */
function _asBuildComposeUrl(provider, to, subject, body) {
  var enc = encodeURIComponent;
  to = to || ''; subject = subject || ''; body = body || '';
  switch (provider) {
    case 'gmail':
      // Gmail 신규 작성: view=cm, fs=1(전체 작성창), to/su/body
      return 'https://mail.google.com/mail/?view=cm&fs=1&to=' + enc(to) + '&su=' + enc(subject) + '&body=' + enc(body);
    case 'outlook':
      // Office 365 / Outlook on the web
      return 'https://outlook.office.com/mail/deeplink/compose?to=' + enc(to) + '&subject=' + enc(subject) + '&body=' + enc(body);
    case 'outlook-live':
      // Outlook.com (개인) — Live/Hotmail 계정용
      return 'https://outlook.live.com/owa/?path=/mail/action/compose&to=' + enc(to) + '&subject=' + enc(subject) + '&body=' + enc(body);
    case 'naver':
      // 네이버 메일 — 공식 compose URL은 to/subject 받음. body는 환경에 따라 다름
      return 'https://mail.naver.com/write/popup/?to=' + enc(to) + '&subject=' + enc(subject) + '&body=' + enc(body);
    case 'mailto':
    default:
      // PC 기본 메일 클라이언트 (Outlook 데스크톱/Thunderbird/Mail 등)
      return 'mailto:' + enc(to) + '?subject=' + enc(subject) + '&body=' + enc(body);
  }
}

/* ⑥ 보고서 — PDF 미리보기 모달 진입점 */
function asReportPdfPreview(ticketId) {
  if (typeof showToast === 'function') showToast('📄 PDF 생성 중…');
  asGetExpand(ticketId).then(function (t) {
    return _asGeneratePdf(t).then(function (out) {
      _asRenderPdfPreviewModal(t, out);
    });
  }).catch(function (err) {
    console.error('[asReportPdfPreview]', err);
    if (typeof showToast === 'function') showToast('❌ PDF 생성 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

function _asRenderPdfPreviewModal(t, out) {
  document.querySelectorAll('#asPdfPreviewOverlay').forEach(function (el) { el.remove(); });
  var overlay = document.createElement('div');
  overlay.id = 'asPdfPreviewOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10004;display:flex;align-items:center;justify-content:center;padding:24px';

  var blobUrl = URL.createObjectURL(out.blob);

  var h = '<div style="background:var(--bg);border:1px solid var(--bd);border-radius:10px;width:min(960px,98vw);max-height:96vh;display:flex;flex-direction:column;overflow:hidden;color:var(--t2);box-shadow:0 14px 50px rgba(0,0,0,0.6)">';

  // 헤더
  h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--bd);background:var(--bg-i)">';
  h += '<div><div style="font-size:13px;font-weight:700">📄 A/S 보고서 PDF — ' + _asEsc(t.ticketNo) + '</div>';
  h += '<div style="font-size:10px;color:var(--t5);margin-top:2px">' + _asEsc(t.customerName || '-') + ' · ' + _asEsc(t.equipmentModel || '-') + '</div></div>';
  h += '<button onclick="_asPdfPreviewClose()" style="font-size:16px;padding:4px 10px;border:none;background:none;color:var(--t5);cursor:pointer">✕</button>';
  h += '</div>';

  // 본문 — 좌측 iframe / 우측 액션
  h += '<div style="display:flex;flex:1;overflow:hidden;min-height:520px">';
  h += '<div id="asPdfPreviewArea" style="flex:1;display:flex;flex-direction:column;background:#525659;min-width:0">';
  h += '<iframe id="asPdfPreviewFrame" src="' + blobUrl + '" style="width:100%;height:100%;border:none;background:#525659;display:block" title="PDF 미리보기"></iframe>';
  h += '</div>';

  // 우측 액션 패널
  var savedProvider = '';
  try { savedProvider = localStorage.getItem('as_mail_provider') || 'gmail'; } catch (e) { savedProvider = 'gmail'; }
  var defaultSubj = 'A/S 작업 보고서 ' + (t.ticketNo || '') + ' — ' + (t.customerName || '');
  var defaultBody = '안녕하세요,\n\nA/S 작업 보고서를 전달드립니다.\n\n• 접수번호: ' + (t.ticketNo || '') +
                    '\n• 고객사: ' + (t.customerName || '-') +
                    (t.equipmentModel ? '\n• 장비: ' + t.equipmentModel : '') +
                    '\n\n※ 첨부된 PDF 보고서를 확인 부탁드립니다.\n감사합니다.';

  h += '<div style="width:300px;border-left:1px solid var(--bd);padding:14px 16px;overflow-y:auto;background:var(--bg-i)">';

  // PDF 저장
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">📥 PDF 다운로드</div>';
  h += '<button id="asPdfDownloadBtn" style="width:100%;padding:9px 12px;border:none;border-radius:6px;background:#10B981;color:#fff;cursor:pointer;font-size:11px;font-weight:600;margin-bottom:14px">📥 PDF로 저장</button>';

  // 메일 작성기 콤보
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">✉️ 메일 작성기 열기</div>';

  // 메일 서비스 선택
  h += '<label style="display:block;font-size:10px;color:var(--t4);margin-bottom:3px">사용할 메일 서비스</label>';
  h += '<select id="asMail_provider" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--t2);font-size:11px;box-sizing:border-box;margin-bottom:8px">';
  [
    { v: 'gmail',        l: '📧 Gmail (웹)' },
    { v: 'outlook',      l: '📨 Outlook / Office 365 (웹)' },
    { v: 'outlook-live', l: '📨 Outlook.com / Hotmail (개인)' },
    { v: 'naver',        l: '📬 네이버 메일 (웹)' },
    { v: 'mailto',       l: '💻 PC 기본 메일 앱 (mailto:)' }
  ].forEach(function (o) {
    h += '<option value="' + o.v + '"' + (savedProvider === o.v ? ' selected' : '') + '>' + o.l + '</option>';
  });
  h += '</select>';

  // To / 제목 / 본문
  h += '<label style="display:block;font-size:10px;color:var(--t4);margin-bottom:3px">받는 사람 (To) *</label>';
  h += '<input id="asMail_to" type="email" placeholder="customer@example.com" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--t2);font-size:11px;box-sizing:border-box;margin-bottom:8px">';

  h += '<label style="display:block;font-size:10px;color:var(--t4);margin-bottom:3px">제목</label>';
  h += '<input id="asMail_subject" type="text" value="' + _asEsc(defaultSubj) + '" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--t2);font-size:11px;box-sizing:border-box;margin-bottom:8px">';

  h += '<label style="display:block;font-size:10px;color:var(--t4);margin-bottom:3px">본문</label>';
  h += '<textarea id="asMail_message" rows="6" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--t2);font-size:11px;resize:vertical;box-sizing:border-box;margin-bottom:10px">' + _asEsc(defaultBody) + '</textarea>';

  h += '<button id="asPdfMailBtn" style="width:100%;padding:9px 12px;border:none;border-radius:6px;background:#3B82F6;color:#fff;cursor:pointer;font-size:11px;font-weight:600">✉️ PDF 다운로드 + 작성기 열기</button>';
  h += '<div id="asMail_status" style="margin-top:8px;font-size:10px;color:var(--t5);min-height:14px;line-height:1.5"></div>';

  // 안내
  h += '<div style="margin-top:14px;padding-top:10px;border-top:1px dashed var(--bd);font-size:9px;color:var(--t6);line-height:1.6">';
  h += '<strong>📋 작동 방식</strong><br>';
  h += '1. 클릭 시 PDF가 자동 다운로드됩니다<br>';
  h += '2. 선택한 메일 서비스의 작성 창이 새 탭으로 열립니다 (To·제목·본문 자동 입력)<br>';
  h += '3. 다운로드된 PDF를 <strong>작성 창에 끌어다 놓고</strong> "보내기"를 누르세요<br>';
  h += '<br><strong style="color:var(--t5)">✨ 장점</strong> — 본인 메일 명의로 발송되어 "보낸 편지함"에 자동 보관됩니다. 서버 SMTP 설정이 필요 없습니다.<br>';
  h += '<br><span style="color:#F59E0B">⚠ 팝업이 차단되면 브라우저 주소창 우측의 "팝업 허용"을 클릭하세요.</span>';
  h += '</div>';
  h += '</div>';
  h += '</div></div>';

  overlay.innerHTML = h;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) _asPdfPreviewClose(); });

  // PDF iframe 로딩 실패/차단 감지 (CSP/구브라우저 폴백)
  (function () {
    var fr = document.getElementById('asPdfPreviewFrame');
    var area = document.getElementById('asPdfPreviewArea');
    if (!fr || !area) return;
    var loaded = false;
    fr.addEventListener('load', function () { loaded = true; });
    setTimeout(function () {
      if (loaded) return;
      // 3초 안에 load 이벤트가 안 오면 폴백 UI
      area.innerHTML =
        '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#cbd5e1;padding:40px;text-align:center">' +
        '<div style="font-size:60px;margin-bottom:14px">📄</div>' +
        '<div style="font-size:13px;margin-bottom:8px">브라우저 미리보기가 차단되었습니다.</div>' +
        '<div style="font-size:11px;color:#94a3b8;margin-bottom:18px">새 탭에서 PDF를 확인하거나, 우측 [PDF로 저장]을 사용하세요.</div>' +
        '<button id="asPdfOpenNewTab" style="padding:9px 18px;border:none;border-radius:6px;background:#3B82F6;color:#fff;cursor:pointer;font-size:12px;font-weight:600">🔗 새 탭에서 열기</button>' +
        '</div>';
      var btn = document.getElementById('asPdfOpenNewTab');
      if (btn) btn.onclick = function () { window.open(blobUrl, '_blank'); };
    }, 3000);
  })();

  // 액션 바인딩 — out을 클로저로 잡고 있어야 함
  document.getElementById('asPdfDownloadBtn').onclick = function () {
    try { out.pdf.save(out.fileName); }
    catch (e) {
      // fallback: blob 직접 저장
      var a = document.createElement('a');
      a.href = blobUrl; a.download = out.fileName; document.body.appendChild(a); a.click(); a.remove();
    }
  };

  document.getElementById('asPdfMailBtn').onclick = function () {
    var to = (document.getElementById('asMail_to').value || '').trim();
    var subject = (document.getElementById('asMail_subject').value || '').trim();
    var message = (document.getElementById('asMail_message').value || '').trim();
    var provider = (document.getElementById('asMail_provider').value || 'gmail');
    var status = document.getElementById('asMail_status');
    var btn = this;
    if (!to) { status.textContent = '⚠ 받는 사람을 입력하세요.'; status.style.color = '#EF4444'; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { status.textContent = '⚠ 올바른 이메일 형식이 아닙니다.'; status.style.color = '#EF4444'; return; }

    // 1) 선택 기억
    try { localStorage.setItem('as_mail_provider', provider); } catch (e) {}

    // 2) PDF 자동 다운로드 (사용자 제스처 활성 상태에서)
    try { out.pdf.save(out.fileName); }
    catch (e) {
      var a = document.createElement('a');
      a.href = blobUrl; a.download = out.fileName;
      document.body.appendChild(a); a.click(); a.remove();
    }

    // 3) 메일 작성기 URL 구성
    var composeUrl = _asBuildComposeUrl(provider, to, subject, message);

    // 4) 새 탭에서 작성기 열기 (팝업 차단 회피 위해 같은 클릭 안에서)
    var win = window.open(composeUrl, '_blank');
    if (!win || win.closed || typeof win.closed === 'undefined') {
      status.innerHTML = '⚠ 팝업이 차단되었습니다. 주소창 우측의 "팝업 허용"을 누르고 다시 시도하거나 <a href="' + _asEsc(composeUrl) + '" target="_blank" style="color:#3B82F6">여기를 클릭</a>하세요.';
      status.style.color = '#F59E0B';
      return;
    }

    var label = {
      gmail: 'Gmail', outlook: 'Outlook', 'outlook-live': 'Outlook.com', naver: '네이버 메일', mailto: 'PC 기본 메일 앱'
    }[provider] || '메일 작성기';
    status.innerHTML = '✅ PDF 다운로드 + ' + label + ' 작성기 열림.<br><strong style="color:#10B981">다운로드된 PDF를 작성 창에 끌어다 놓고 보내기를 누르세요.</strong>';
    status.style.color = 'var(--t3)';
    if (typeof showToast === 'function') showToast('📄 PDF 다운로드 + ' + label + ' 작성기 열림');
  };

  // 모달 닫을 때 blob URL 해제
  window._asPdfPreviewClose = function () {
    try { URL.revokeObjectURL(blobUrl); } catch (e) {}
    var ov = document.getElementById('asPdfPreviewOverlay');
    if (ov) ov.remove();
    window._asPdfPreviewClose = null;
  };
}

/* ─── ⑥ 보고서 발행 ─── */
function _asTabReportDoc(t) {
  var h = '';
  h += '<div style="font-size:13px;font-weight:700;color:var(--t2);margin-bottom:10px">📄 ⑥ 보고서 발행</div>';

  // 발행 전 점검 체크리스트
  var checks = [
    { ok: !!t.issueSummary,                label: '① 접수 — 신고 내용 입력됨' },
    { ok: (t.assignments || []).length > 0,label: '② 할당 — 부서 1개 이상 지정됨' },
    { ok: (t.activityLogs || []).length > 0, label: '③ 처리 — Activity Log 1건 이상' },
    { ok: !!t.rca,                         label: '④ 보고 — RCA 입력됨' },
    { ok: (t.signatures || []).some(function (s) { return s.role === 'customer_field' && s.signatureUrl; }),
      label: '⑤ 확인 — 고객 서명 받음' }
  ];
  h += '<div style="border:1px solid var(--bd);border-radius:8px;padding:12px;margin-bottom:14px;background:var(--bg-i)">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">📋 발행 전 점검</div>';
  checks.forEach(function (c) {
    h += '<div style="font-size:11px;color:' + (c.ok ? '#10B981' : 'var(--t5)') + ';padding:3px 0">' + (c.ok ? '✅' : '⬜') + ' ' + _asEsc(c.label) + '</div>';
  });
  var allOk = checks.every(function (c) { return c.ok; });
  if (!allOk) {
    h += '<div style="margin-top:8px;font-size:10px;color:var(--t5)">⚠ 일부 항목 누락 — 보고서는 다운로드 가능하지만 정식 발행 전 확인 권장</div>';
  }
  h += '</div>';

  // 다운로드/미리보기/메일 버튼
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">';
  h += '<button onclick="asReportPdfPreview(\'' + _asEsc(t.id) + '\')" style="padding:10px 18px;border:none;border-radius:6px;background:#EF4444;color:#fff;cursor:pointer;font-size:12px;font-weight:600">📄 PDF 미리보기 / 메일</button>';
  h += '<button onclick="asExportExcel(\'' + _asEsc(t.id) + '\')" style="padding:10px 18px;border:none;border-radius:6px;background:#10B981;color:#fff;cursor:pointer;font-size:12px;font-weight:600">📊 엑셀 6시트 다운로드</button>';
  h += '<button onclick="asPrintReport(\'' + _asEsc(t.id) + '\')" style="padding:10px 18px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t3);cursor:pointer;font-size:12px">🖨️ 인쇄 미리보기 (새 창)</button>';
  h += '</div>';

  // 보고서 미리보기 요약
  h += '<div style="border:1px solid var(--bd);border-radius:8px;padding:14px;background:var(--bg-i);font-size:11px;line-height:1.7">';
  h += '<div style="font-size:13px;font-weight:700;color:var(--t2);margin-bottom:8px">📑 보고서 시트 구성</div>';
  h += '<div style="color:var(--t4)">';
  h += '<div>📄 <strong>표지요약</strong> — 접수번호·고객·장비·접수정보·부서별 소요·완료여부·RCA·재발방지</div>';
  h += '<div>📄 <strong>접수상세</strong> — 신고 원문·1차분석·재현/빈도/영향</div>';
  h += '<div>📄 <strong>처리이력</strong> — 부서별 Activity Log ' + ((t.activityLogs || []).length) + '건</div>';
  h += '<div>📄 <strong>부품/소모품</strong> — ' + ((t.parts || []).length) + '품목 · 청구합계 ' +
    ((t.parts || []).reduce(function (s, p) { return s + Number(p.amount || (Number(p.qty||0)*Number(p.unitPrice||0))); }, 0)).toLocaleString() + '원</div>';
  h += '<div>📄 <strong>최종결과</strong> — 장비상태·서명·CSAT·첨부 ' + ((t.attachments || []).length) + '개</div>';
  h += '<div>📄 <strong>코드표</strong> — 작성 가이드 (정적)</div>';
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

/* ─── 휴지통 (soft → hard 2단계 삭제) ─── */
function asSoftDeleteTicket(ticketId, ticketNo) {
  if (!confirm('접수 ' + ticketNo + ' 을(를) 휴지통으로 이동하시겠습니까?\n\n• 휴지통에서 언제든 복구 가능\n• 완전 삭제는 휴지통에서 다시 한 번 더 확인 후 가능')) return;
  if (typeof asDel !== 'function') {
    if (typeof showToast === 'function') showToast('삭제 API 미연결', 'error');
    return;
  }
  asDel(ticketId).then(function () {
    // 상세 모달이 열려 있으면 닫고
    var d = document.getElementById('asDetailOverlay'); if (d) d.remove();
    var m = document.getElementById('asModalOverlay'); if (m) m.remove();
    if (typeof showToast === 'function') showToast('🗑️ 휴지통으로 이동되었습니다.');
    renderAS();
  }).catch(function (err) {
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (typeof showToast === 'function') showToast('❌ 삭제 실패: ' + msg, 'error');
  });
}

function asRestoreTicket(ticketId) {
  if (typeof asRestore !== 'function') return;
  asRestore(ticketId).then(function () {
    if (typeof showToast === 'function') showToast('↻ 접수가 복구되었습니다.');
    renderAS();
  }).catch(function (err) {
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (typeof showToast === 'function') showToast('❌ 복구 실패: ' + msg, 'error');
  });
}

function asPurgeTicket(ticketId, ticketNo) {
  // 2단계 확인: 접수번호를 정확히 입력해야 진행
  var typed = prompt('⚠ 완전 삭제\n\n접수 "' + ticketNo + '"를 완전히 삭제합니다.\n할당·처리이력·부품·첨부·서명까지 모두 영구 제거되며 복구할 수 없습니다.\n\n계속하려면 접수번호 "' + ticketNo + '"를 그대로 입력하세요.');
  if (typed === null) return;
  if (String(typed).trim() !== ticketNo) {
    if (typeof showToast === 'function') showToast('접수번호가 일치하지 않습니다. 취소되었습니다.', 'warn');
    return;
  }
  if (typeof asDelHard !== 'function') {
    if (typeof showToast === 'function') showToast('완전 삭제 API 미연결', 'error');
    return;
  }
  asDelHard(ticketId).then(function () {
    if (typeof showToast === 'function') showToast('💥 완전 삭제되었습니다.');
    renderAS();
  }).catch(function (err) {
    var msg = (err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류';
    if (err && err.status === 403) msg = '완전 삭제 권한이 없습니다 (관리자 권한 필요).';
    if (typeof showToast === 'function') showToast('❌ 완전 삭제 실패: ' + msg, 'error');
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
