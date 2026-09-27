/**
 * A/S 관리 — 카테고리 관리 모달 (관리자 전용, 분할 7/7, 마지막 로드)
 * showASCategoryAdmin · 신규/수정/삭제 저장
 * 로드 시 실행: wmDataBus asCategory 청취자 등록(카테고리 캐시 무효화) — 원본과 동일하게 맨 끝에서 실행
 * (원래 as-manager.js 에서 순수 이동 — 동작 변화 없음)
 */

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
    // v13.63: backdrop 클릭 닫기 비활성화 — 작업 중 실수 클릭 데이터 유실 방지 (✕ 버튼만 닫기)
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
