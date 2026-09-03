/* ═══════════════════════════════════════════════════════════════════
   운영자 모드 (관리자/운영자) — 전체 프로젝트 가시성 + 접근 관리
   · 전체 프로젝트(가시성 우회)를 보고, 보고 싶은 것만 남기도록 숨김
   · 숨김(포커스 셋)은 타임라인·파이프라인·달력·문서관리에 전역 적용 (user_settings 저장)
   · admin은 다른 사용자에게 운영자 접근을 부여/회수
   의존(전역): isOperator, currentUser, projGetAllOperator, pmIsHidden/pmSetHidden/pmSaveFocus,
              apiFetch, showToast, eH, PROJ_STATUS, autoProjectStatus, _modeRendered
   ═══════════════════════════════════════════════════════════════════ */
function renderOperator() {
  var wrap = document.getElementById('operatorWrap');
  if (!wrap) return;
  if (!(typeof isOperator === 'function' && isOperator())) {
    wrap.innerHTML = '<div style="text-align:center;color:var(--t6);font-size:12px;padding:30px">운영자 권한이 필요합니다.</div>';
    return;
  }
  var isAdmin = currentUser && currentUser.role === 'admin';
  var _view = (typeof window !== 'undefined' && window._opView) || 'manage';
  var toggle = '<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">' +
    '<button class="btn btn-s ' + (_view === 'manage' ? 'btn-p' : 'btn-g') + '" onclick="opSetView(\'manage\')">🗂 가시성·접근 관리</button>' +
    '<button class="btn btn-s ' + (_view === 'analytics' ? 'btn-p' : 'btn-g') + '" onclick="opSetView(\'analytics\')">📊 분석·트렌드</button>' +
    (isAdmin ? '<button class="btn btn-s ' + (_view === 'log' ? 'btn-p' : 'btn-g') + '" onclick="opSetView(\'log\')">🧾 활동 로그</button>' : '') +
  '</div>';
  // 분석·트렌드 뷰
  if (_view === 'analytics') {
    wrap.innerHTML = toggle + '<div id="opAnalyticsBody"><div style="font-size:12px;color:var(--t6);padding:20px">로딩 중...</div></div>';
    if (typeof renderOperatorAnalytics === 'function') renderOperatorAnalytics('opAnalyticsBody');
    else { var ab = document.getElementById('opAnalyticsBody'); if (ab) ab.innerHTML = '<div style="color:#EF4444;font-size:12px;padding:20px">분석 모듈을 불러올 수 없습니다.</div>'; }
    return;
  }
  // 활동 로그 뷰 (admin 전용)
  if (_view === 'log' && isAdmin) {
    wrap.innerHTML = toggle + '<div id="opLogBody"><div style="font-size:12px;color:var(--t6);padding:20px">활동 로그 로딩 중...</div></div>';
    renderOperatorLog('opLogBody');
    return;
  }
  wrap.innerHTML = '<div style="font-size:12px;color:var(--t6);padding:20px">로딩 중...</div>';

  var pAll = (typeof projGetAllOperator === 'function') ? projGetAllOperator().catch(function () { return []; }) : Promise.resolve([]);
  var pUsers = isAdmin ? apiFetch('/api/users/operator-list').then(function (r) { return r.data || []; }).catch(function () { return []; }) : Promise.resolve(null);

  Promise.all([pAll, pUsers]).then(function (res) {
    var projects = res[0] || [];
    var users = res[1];
    projects.sort(function (a, b) { return (a.name || a.orderNo || '').localeCompare(b.name || b.orderNo || ''); });
    var hiddenCount = projects.filter(function (p) { return pmIsHidden(p.id); }).length;

    var h = toggle;
    h += '<div style="margin-bottom:16px"><h3 style="font-size:15px;font-weight:700;color:var(--t1);margin-bottom:4px">🛡️ 운영자 모드</h3>';
    h += '<div style="font-size:11px;color:var(--t5);line-height:1.6">전체 프로젝트를 보고, 보고 싶은 것만 남기도록 숨길 수 있습니다. 숨김은 <b>타임라인·파이프라인·달력·문서관리</b>에 전역 적용되며 새로고침·기기 간 유지됩니다.</div></div>';

    // ── 프로젝트 가시성 관리 ──
    h += '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:16px">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">';
    h += '<span style="font-size:12px;font-weight:700;color:var(--t2)">📋 프로젝트 가시성 (' + projects.length + ') · <span style="color:#EF4444">숨김 ' + hiddenCount + '</span></span>';
    h += '<span style="display:flex;gap:6px"><button class="btn btn-g btn-s" style="font-size:10px" onclick="opShowAll()">전체 표시</button><button class="btn btn-g btn-s" style="font-size:10px" onclick="opHideAll()">전체 숨김</button></span>';
    h += '</div>';
    h += '<div style="max-height:50vh;overflow:auto">';
    if (!projects.length) h += '<div style="font-size:11px;color:var(--t6);padding:10px">표시할 프로젝트가 없습니다.</div>';
    projects.forEach(function (p) {
      var hid = pmIsHidden(p.id);
      var st = (typeof autoProjectStatus === 'function') ? autoProjectStatus(p) : (p.status || 'waiting');
      var stInfo = (typeof PROJ_STATUS !== 'undefined' && PROJ_STATUS[st]) || { label: st, color: '#94A3B8', bg: 'rgba(148,163,184,.15)', icon: '•' };
      h += '<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--bd);cursor:pointer;opacity:' + (hid ? '.5' : '1') + '">';
      h += '<input type="checkbox" ' + (hid ? '' : 'checked') + ' onchange="opToggle(\'' + p.id + '\', !this.checked)">';
      h += '<span style="flex:1;font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(p.name || p.orderNo || p.id) + (p.orderNo ? ' <span style="color:var(--t6);font-size:10px">' + eH(p.orderNo) + '</span>' : '') + '</span>';
      h += '<span class="badge" style="background:' + stInfo.bg + ';color:' + stInfo.color + ';font-size:9px;flex-shrink:0">' + (stInfo.icon || '') + ' ' + stInfo.label + '</span>';
      h += '</label>';
    });
    h += '</div></div>';

    // ── 운영자 접근 관리 (admin only) ──
    if (isAdmin && users) {
      h += '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:10px;padding:14px">';
      h += '<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:4px">👥 운영자 접근 관리</div>';
      h += '<div style="font-size:10px;color:var(--t6);margin-bottom:10px">허용된 사용자만 운영자 모드에 접근할 수 있습니다. (admin은 항상 접근)</div>';
      h += '<div style="max-height:40vh;overflow:auto">';
      users.forEach(function (u) {
        var admin = u.role === 'admin';
        var on = admin || u.operator_enabled;
        var nm = u.display_name || u.name || u.email;
        h += '<div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--bd)">';
        h += '<span style="flex:1;font-size:11px;color:var(--t2)">' + eH(nm) + ' <span style="color:var(--t6);font-size:10px">(' + eH(u.role) + ')</span></span>';
        if (admin) {
          h += '<span style="font-size:10px;color:#10B981;font-weight:600">관리자 · 항상 ON</span>';
        } else {
          h += '<label style="cursor:pointer;font-size:10px;color:' + (on ? '#10B981' : 'var(--t5)') + '"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="opGrant(\'' + u.id + '\', this.checked, this)"> ' + (on ? '허용' : '차단') + '</label>';
        }
        h += '</div>';
      });
      h += '</div></div>';
    }

    wrap.innerHTML = h;
  }).catch(function (e) {
    wrap.innerHTML = '<div style="color:#EF4444;font-size:12px;padding:20px">로드 실패: ' + ((e && e.message) || e) + (e && e.status === 404 ? ' (서버 배포 후 동작)' : '') + '</div>';
  });
}

/* 운영자 탭 뷰 전환 (관리 / 분석·트렌드) */
function opSetView(v) {
  try { window._opView = v; } catch (_) {}
  if (typeof renderOperator === 'function') renderOperator();
}

/* 포커스 변경 → 4개 뷰 캐시 무효화 (다음 진입 시 재렌더) */
function _opInvalidateViews() {
  try { ['timeline', 'pipeline', 'calendar', 'docs'].forEach(function (m) { if (window._modeRendered) delete window._modeRendered[m]; }); } catch (_) {}
}
var _opSaveT = null;
function _opSaveFocusDebounced() {
  if (_opSaveT) clearTimeout(_opSaveT);
  _opSaveT = setTimeout(function () {
    if (typeof pmSaveFocus === 'function') pmSaveFocus().catch(function (err) {
      if (typeof showToast === 'function') showToast('❌ 저장 실패' + (err && err.status === 404 ? ' (서버 배포 후 동작)' : ''), 'error');
    });
  }, 400);
}
function opToggle(projId, hidden) {
  if (typeof pmSetHidden === 'function') pmSetHidden(projId, hidden);
  _opInvalidateViews(); _opSaveFocusDebounced(); renderOperator();
}
function opShowAll() {
  if (typeof projGetAllOperator !== 'function') return;
  projGetAllOperator().then(function (list) {
    (list || []).forEach(function (p) { pmSetHidden(p.id, false); });
    _opInvalidateViews(); _opSaveFocusDebounced(); renderOperator();
  });
}
function opHideAll() {
  if (typeof projGetAllOperator !== 'function') return;
  projGetAllOperator().then(function (list) {
    (list || []).forEach(function (p) { pmSetHidden(p.id, true); });
    _opInvalidateViews(); _opSaveFocusDebounced(); renderOperator();
  });
}
function opGrant(userId, enabled, el) {
  apiFetch('/api/users/' + userId + '/operator-mode', { method: 'PUT', body: JSON.stringify({ enabled: !!enabled }) })
    .then(function () { if (typeof showToast === 'function') showToast(enabled ? '운영자 권한 부여' : '운영자 권한 회수'); })
    .catch(function (err) {
      if (el) el.checked = !enabled;
      var msg = (err && err.status === 403) ? '관리자만 변경할 수 있습니다.' : (err && err.status === 404) ? '서버 배포 후 사용 가능' : ((err && err.message) || '변경 실패');
      if (typeof showToast === 'function') showToast('❌ ' + msg, 'error');
    });
}

/* ═══════════════ 활동 로그 (audit_logs, admin 전용) ═══════════════ */
var _opLogCache = null;
var _opLogSearch = '';
var _opLogProjectOnly = true;
var _OP_LOG_PROJECT_ACTIONS = ['project.create', 'project.update', 'order.renumber', 'milestone.create', 'milestone.update', 'milestone.delete', 'milestone.progress', 'comment.create'];
var _OP_LOG_LABELS = {
  'project.create': { icon: '📁', label: '프로젝트 등록', color: '#10B981' },
  'project.update': { icon: '✏️', label: '프로젝트 수정', color: '#3B82F6' },
  'order.renumber': { icon: '🔢', label: '수주번호 변경', color: '#F59E0B' },
  'milestone.create': { icon: '◆', label: '마일스톤 등록', color: '#10B981' },
  'milestone.update': { icon: '◆', label: '마일스톤 수정', color: '#3B82F6' },
  'milestone.delete': { icon: '🗑', label: '마일스톤 삭제', color: '#EF4444' },
  'milestone.progress': { icon: '🖉', label: '마일스톤 진척 업데이트', color: '#8B5CF6' },
  'comment.create': { icon: '💬', label: '코멘트/피드백', color: '#EC4899' },
  'approve_user': { icon: '👤', label: '사용자 승인', color: '#6366F1' }
};
function _opEsc(s) { return (typeof eH === 'function') ? eH(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _opLogTime(iso) {
  if (typeof _pdRelTime === 'function') { var r = _pdRelTime(iso); if (r) return r; }
  try { var d = new Date(iso); if (isNaN(d.getTime())) return ''; return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return ''; }
}
function _opLogDetail(a) {
  var d = a.detail;
  if (!d) return _opEsc((a.target_type || '') + (a.target_id ? ' ' + String(a.target_id).slice(0, 14) : ''));
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return _opEsc(d); } }
  if (typeof d !== 'object') return _opEsc(String(d));
  var parts = [];
  // 수주번호 변경: 무엇이 어떻게·왜 바뀌었는지가 핵심
  if (d.from && d.to) parts.push(_opEsc(d.from) + ' → ' + _opEsc(d.to));
  if (d.reason) parts.push('사유:' + _opEsc(d.reason));
  if (d.affectedTotal != null) parts.push('연결 ' + _opEsc(d.affectedTotal) + '건 갱신');
  if (d.name) parts.push(_opEsc(d.name));
  if (d.status) parts.push('상태:' + _opEsc(d.status));
  if (d.progress != null) parts.push('진척:' + _opEsc(d.progress) + '%');
  if (d.hours != null) parts.push('투입:' + _opEsc(d.hours) + 'h');
  if (a.target_type) parts.push(_opEsc(a.target_type) + (a.target_id ? ':' + _opEsc(String(a.target_id).slice(0, 12)) : ''));
  return parts.join(' · ');
}
function renderOperatorLog(containerId) {
  var box = document.getElementById(containerId || 'opLogBody');
  if (!box) return;
  box.innerHTML = '<div style="font-size:11px;color:var(--t6);padding:12px">활동 로그 로딩 중...</div>';
  apiFetch('/api/audit?limit=300').then(function (r) {
    _opLogCache = (r && r.data) || [];
    _opRenderLogShell(box);
    _opRenderLogList();
  }).catch(function (err) {
    var msg = (err && err.status === 403) ? '관리자만 조회할 수 있습니다.' : (err && err.status === 404) ? '서버 배포 후 사용할 수 있습니다.' : ((err && err.message) || '로드 실패');
    box.innerHTML = '<div style="color:#EF4444;font-size:12px;padding:20px">활동 로그 ' + _opEsc(msg) + '</div>';
  });
}
function _opRenderLogShell(box) {
  var h = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:10px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
  h += '<span style="font-size:11px;font-weight:700;color:var(--t3)">🧾 활동 로그</span>';
  h += '<label style="font-size:10px;color:var(--t5);display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" ' + (_opLogProjectOnly ? 'checked' : '') + ' onchange="opLogSetProjectOnly(this.checked)"> 프로젝트 관련만</label>';
  h += '<input type="text" placeholder="검색 (사용자·액션·대상)" value="' + _opEsc(_opLogSearch) + '" oninput="opLogSetSearch(this.value)" style="flex:1;min-width:140px;font-size:11px;padding:4px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2)">';
  h += '<button class="btn btn-g btn-s" style="font-size:10px" onclick="renderOperatorLog(\'opLogBody\')">🔄 새로고침</button>';
  h += '</div>';
  h += '<div class="op-log-list" id="opLogList" style="background:var(--bg-p);border:1px solid var(--bd);border-radius:10px;padding:4px 12px;max-height:64vh;overflow:auto"></div>';
  box.innerHTML = h;
}
function _opRenderLogList() {
  var list = document.getElementById('opLogList');
  if (!list) return;
  var all = _opLogCache || [];
  var s = _opLogSearch.toLowerCase();
  var rows = all.filter(function (a) {
    if (_opLogProjectOnly && _OP_LOG_PROJECT_ACTIONS.indexOf(a.action) < 0) return false;
    if (s) {
      var hay = ((a.user_name || '') + ' ' + (a.action || '') + ' ' + (a.target_id || '') + ' ' + (a.detail ? JSON.stringify(a.detail) : '')).toLowerCase();
      if (hay.indexOf(s) < 0) return false;
    }
    return true;
  });
  if (!rows.length) { list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5);font-size:12px">표시할 로그가 없습니다.</div>'; return; }
  var h = '<div style="font-size:9px;color:var(--t6);padding:4px 0 6px">' + rows.length + '건</div>';
  rows.forEach(function (a) {
    var meta = _OP_LOG_LABELS[a.action] || { icon: '•', label: a.action, color: 'var(--t4)' };
    h += '<div style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid var(--bd)">';
    h += '<span style="font-size:13px;width:20px;text-align:center;flex-shrink:0">' + meta.icon + '</span>';
    h += '<div style="flex:1;min-width:0">';
    h += '<div style="font-size:11px;color:var(--t2)"><span style="font-weight:600;color:' + meta.color + '">' + _opEsc(meta.label) + '</span> <span style="color:var(--t5)">· ' + _opEsc(a.user_name || '시스템') + '</span></div>';
    var det = _opLogDetail(a);
    if (det) h += '<div style="font-size:10px;color:var(--t6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + det + '</div>';
    h += '</div>';
    h += '<span style="font-size:9px;color:var(--t6);white-space:nowrap;flex-shrink:0">' + _opLogTime(a.created_at) + '</span>';
    h += '</div>';
  });
  list.innerHTML = h;
}
function opLogSetProjectOnly(v) { _opLogProjectOnly = !!v; _opRenderLogList(); }
function opLogSetSearch(v) { _opLogSearch = v || ''; _opRenderLogList(); }
