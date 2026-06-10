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
  wrap.innerHTML = '<div style="font-size:12px;color:var(--t6);padding:20px">로딩 중...</div>';
  var isAdmin = currentUser && currentUser.role === 'admin';

  var pAll = (typeof projGetAllOperator === 'function') ? projGetAllOperator().catch(function () { return []; }) : Promise.resolve([]);
  var pUsers = isAdmin ? apiFetch('/api/users/operator-list').then(function (r) { return r.data || []; }).catch(function () { return []; }) : Promise.resolve(null);

  Promise.all([pAll, pUsers]).then(function (res) {
    var projects = res[0] || [];
    var users = res[1];
    projects.sort(function (a, b) { return (a.name || a.orderNo || '').localeCompare(b.name || b.orderNo || ''); });
    var hiddenCount = projects.filter(function (p) { return pmIsHidden(p.id); }).length;

    var h = '';
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
