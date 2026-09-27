/**
 * A/S 관리 — 6-Step 상세 패널 렌더 (분할 4/7)
 * showASDetail · ①개요 ②할당 ③처리(부품/첨부 서브블록) ④보고 ⑤고객확인 ⑥보고서 탭
 * 첨부 타입 판별 + Preview 모달 · 서명 카드 · 정보 블록/enum 라벨 헬퍼
 * (원래 as-manager.js 에서 순수 이동 — 동작 변화 없음)
 */

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
  h += '<div style="background:var(--bg);border:1px solid var(--bd);border-radius:12px;width:min(1200px,94vw);max-width:100%;color:var(--t2);box-shadow:0 14px 50px rgba(0,0,0,0.5);overflow:hidden">';

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
  // v13.63: backdrop 클릭 닫기 비활성화 — 작업 중 실수 클릭 데이터 유실 방지 (✕ 버튼만 닫기)

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

  // 재발 이력 사이드바 (비동기 로딩) — Serial No. 또는 장비번호 기준 과거 A/S
  if (t.serialNo || t.equipmentNo) {
    h += '<div id="asRecurBox" style="margin-bottom:14px;border:1px solid var(--bd);border-radius:8px;padding:10px 12px;background:linear-gradient(135deg,#F59E0B11,transparent)">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t3)">🔁 이 장비의 과거 A/S 이력</div>';
    h += '<div id="asRecurCount" style="font-size:10px;color:var(--t5)">조회 중…</div>';
    h += '</div>';
    h += '<div id="asRecurList" style="font-size:11px;color:var(--t5)">로딩…</div>';
    h += '</div>';
    // 비동기 로드
    setTimeout(function () { _asLoadRecurrences(t.id); }, 0);
  }

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
  // v13.63: backdrop 클릭 닫기 비활성화 — 작업 중 실수 클릭 데이터 유실 방지 (✕ 버튼만 닫기)
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
