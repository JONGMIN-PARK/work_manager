/**
 * A/S 관리 — 상세 패널 액션 (분할 5/7)
 * 캔버스 서명·CSAT 저장 · 부품/첨부 추가·삭제 · 할당 추가/상태/삭제
 * 처리이력 추가/삭제 · 보고/종결 저장 · 휴지통(soft/restore/purge) · 이슈 연계
 * (원래 as-manager.js 에서 순수 이동 — 동작 변화 없음)
 */

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
  // v13.63: backdrop 클릭 닫기 비활성화 — 작업 중 실수 클릭 데이터 유실 방지 (✕ 버튼만 닫기)
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
  // v13.63: backdrop 클릭 닫기 비활성화 — 작업 중 실수 클릭 데이터 유실 방지 (✕ 버튼만 닫기)
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
  // v13.63: backdrop 클릭 닫기 비활성화 — 작업 중 실수 클릭 데이터 유실 방지 (✕ 버튼만 닫기)
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
