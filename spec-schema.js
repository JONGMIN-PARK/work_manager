/* ═══════════════════════════════════════════════════════════════════════
   spec-schema.js — 장비 표준 사양서 (v13.196) 순수 로직 (DOM 없음, node --test 로 검사)
   ─────────────────────────────────────────────────────────────────────
   · 양식(schema): { sections:[{ key, label, discipline, items:[항목] }] }
       항목: { key, label, type:'text'|'textarea'|'number'|'select'|'table', owner, unit?, options?, help?,
              columns?:[{ key, label, type:'text'|'number'|'select', owner, group?, unit?, options? }] }
       key 는 양식 안에서 유일하고 바뀌지 않는다(값은 key 로 저장 → 라벨을 바꿔도 값 유지).
   · 사양서(projects.specs, v:2):
       { v:2, templateId, templateVersion, values:{ itemKey: 문자열 | 표 행[] }, remarks:{ itemKey: 문자열 },
         extra:{ design|control|software|process: [{id,item,value,remark}] } }
       값은 모두 문자열로 보관(0 이 falsy 로 사라지는 문제 방지). 표 행 = { id, <colKey>: 문자열 }.
       extra = "기타 사양" — 양식에 없는 항목, v13.160 이전 형식 데이터도 여기로 옮긴다.
   · 내장 기본 양식 SPEC_BUILTIN_TEMPLATE (id 'builtin', version 1): 관리자가 양식을 만들지 않아도 바로 사용.
   ═══════════════════════════════════════════════════════════════════════ */

var SPEC_DISCIPLINES = [
  { key: 'design',   label: '설계' },
  { key: 'control',  label: '전장·제어' },
  { key: 'software', label: 'SW' },
  { key: 'process',  label: '공정' }
];
var SPEC_DISCIPLINE_KEYS = SPEC_DISCIPLINES.map(function (d) { return d.key; });
var SPEC_ITEM_TYPES = ['text', 'textarea', 'number', 'select', 'table'];
var SPEC_COL_TYPES = ['text', 'number', 'select'];
var SPEC_BUILTIN_ID = 'builtin';

var SPEC_BUILTIN_TEMPLATE = {
  id: SPEC_BUILTIN_ID,
  name: '기본 표준 사양서',
  version: 1,
  schema: {
    sections: [
      { key: 'mech', label: '일반 기구', discipline: 'design', items: [
        { key: 'mech_dim', label: '외형 치수 (W×D×H)', type: 'text', unit: 'mm', owner: 'design' },
        { key: 'mech_weight', label: '총 중량', type: 'number', unit: 'kg', owner: 'design' },
        { key: 'mech_frame', label: '프레임 재질', type: 'text', owner: 'design' },
        { key: 'mech_base', label: '베이스', type: 'select', options: ['석정반', '철판 정반', '알루미늄 프로파일', '기타'], owner: 'design' },
        { key: 'mech_isolation', label: '방진 방식', type: 'select', options: ['없음', '방진 패드', '에어 방진대', '액티브 방진대', '기타'], owner: 'design' },
        { key: 'mech_cover', label: '커버·도어', type: 'text', owner: 'design', help: '도어 인터록 포함 여부' },
        { key: 'mech_paint', label: '도장·색상', type: 'text', owner: 'design' },
        { key: 'util_power', label: '입력 전원', type: 'text', owner: 'control', help: '예: AC 220V 1Φ 60Hz' },
        { key: 'util_air', label: '공압', type: 'text', unit: 'MPa', owner: 'design' },
        { key: 'util_vacuum', label: '진공', type: 'text', owner: 'design' },
        { key: 'env_install', label: '설치 환경', type: 'text', owner: 'design', help: '클린룸 등급·온습도' },
        { key: 'env_carryin', label: '반입 조건', type: 'text', owner: 'design' }
      ] },
      { key: 'axes', label: '축 구성', discipline: 'all', items: [
        { key: 'axes', label: '축 구성 표', type: 'table', owner: 'design', columns: [
          { key: 'name', label: '축', type: 'text', owner: 'design', group: '기본' },
          { key: 'use', label: '용도', type: 'text', owner: 'design', group: '기본' },
          { key: 'drive', label: '구동 방식', type: 'select', options: ['볼스크류', '벨트', '리니어 모터', 'DD 모터', '랙&피니언', '기타'], owner: 'design', group: '기구' },
          { key: 'lead', label: '리드', type: 'number', unit: 'mm', owner: 'design', group: '기구' },
          { key: 'stroke', label: '스트로크', type: 'number', unit: 'mm', owner: 'design', group: '기구' },
          { key: 'speed', label: '최대 속도', type: 'number', unit: 'mm/s', owner: 'design', group: '기구' },
          { key: 'accel', label: '가감속', type: 'text', unit: 'G', owner: 'design', group: '기구' },
          { key: 'repeat', label: '반복 정밀도', type: 'text', unit: '±㎛', owner: 'design', group: '기구' },
          { key: 'load', label: '가반하중', type: 'number', unit: 'kg', owner: 'design', group: '기구' },
          { key: 'brake_req', label: '브레이크', type: 'select', options: ['필요', '불필요'], owner: 'design', group: '기구' },
          { key: 'drv_model', label: '드라이브', type: 'text', owner: 'control', group: '전장' },
          { key: 'motor_type', label: '모터 종류', type: 'select', options: ['AC 서보', '스테핑', '리니어', 'DD', '기타'], owner: 'control', group: '전장' },
          { key: 'motor_model', label: '모터 모델', type: 'text', owner: 'control', group: '전장' },
          { key: 'motor_power', label: '용량', type: 'text', unit: 'W', owner: 'control', group: '전장' },
          { key: 'motor_brake', label: '모터 브레이크', type: 'select', options: ['있음', '없음'], owner: 'control', group: '전장' },
          { key: 'encoder', label: '엔코더', type: 'select', options: ['절대치', '증분', '기타'], owner: 'control', group: '전장' },
          { key: 'sensor', label: '원점·리밋 센서', type: 'text', owner: 'control', group: '전장' },
          { key: 'ch', label: '채널', type: 'number', owner: 'software', group: 'SW' },
          { key: 'home', label: '원점 방식', type: 'text', owner: 'software', group: 'SW' },
          { key: 'unit_conv', label: '단위 변환', type: 'text', unit: 'pulse/mm', owner: 'software', group: 'SW' },
          { key: 'soft_limit', label: '소프트 리밋', type: 'text', owner: 'software', group: 'SW' }
        ] }
      ] },
      { key: 'ipc', label: '제어 PC (IPC)', discipline: 'control', items: [
        { key: 'ipc_model', label: '모델', type: 'text', owner: 'control' },
        { key: 'ipc_cpu', label: 'CPU·메모리', type: 'text', owner: 'control' },
        { key: 'ipc_pcie', label: 'PCIe 슬롯 수', type: 'number', owner: 'control' },
        { key: 'ipc_com', label: '내장 COM 포트 수', type: 'number', owner: 'control' },
        { key: 'ipc_lan', label: 'LAN 포트 수', type: 'number', owner: 'control' }
      ] },
      { key: 'mc', label: '모션 컨트롤러', discipline: 'control', items: [
        { key: 'mc_vendor', label: '제조사', type: 'select', options: ['A1', 'Ajinextek', '기타'], owner: 'control' },
        { key: 'mc_model', label: '모델', type: 'text', owner: 'control' },
        { key: 'mc_form', label: '형태', type: 'select', options: ['PCIe 보드', 'EtherCAT 마스터', '단독형 컨트롤러', '기타'], owner: 'control' },
        { key: 'mc_axes', label: '보드당 축 수', type: 'number', owner: 'control' },
        { key: 'mc_ctrl', label: '제어 방식', type: 'select', options: ['펄스', 'EtherCAT', 'MECHATROLINK', '기타'], owner: 'control' },
        { key: 'mc_interp', label: '보간 기능', type: 'text', owner: 'software' },
        { key: 'mc_qty', label: '수량', type: 'number', unit: 'EA', owner: 'control' }
      ] },
      { key: 'io', label: 'IO', discipline: 'control', items: [
        { key: 'io_model', label: 'IO 카드 모델', type: 'text', owner: 'control' },
        { key: 'io_in_cards', label: '입력 카드 수량', type: 'number', unit: 'EA', owner: 'control' },
        { key: 'io_out_cards', label: '출력 카드 수량', type: 'number', unit: 'EA', owner: 'control' },
        { key: 'io_di', label: 'DI 접점 수', type: 'number', unit: '점', owner: 'control' },
        { key: 'io_do', label: 'DO 접점 수', type: 'number', unit: '점', owner: 'control' },
        { key: 'io_ai', label: 'AI 점수', type: 'number', unit: '점', owner: 'control' },
        { key: 'io_ao', label: 'AO 점수', type: 'number', unit: '점', owner: 'control' },
        { key: 'io_spare', label: '여유 접점', type: 'text', owner: 'control' }
      ] },
      { key: 'bb', label: '모션·IO 베이스보드', discipline: 'control', items: [
        { key: 'bb_model', label: '모델', type: 'text', owner: 'control' },
        { key: 'bb_qty', label: '수량', type: 'number', unit: 'EA', owner: 'control' }
      ] },
      { key: 'ext', label: '외부장치 인터페이스', discipline: 'control', items: [
        { key: 'ext_devices', label: '외부장치 목록', type: 'table', owner: 'control', columns: [
          { key: 'name', label: '장치', type: 'text', owner: 'control' },
          { key: 'vendor', label: '제조사/모델', type: 'text', owner: 'control' },
          { key: 'iface', label: '인터페이스', type: 'select', options: ['Ethernet', 'RS-232C', 'RS-485', 'USB', 'EtherCAT', '기타'], owner: 'control' },
          { key: 'via', label: '연결 위치', type: 'text', owner: 'control' },
          { key: 'port', label: '포트', type: 'text', owner: 'software' },
          { key: 'protocol', label: '프로토콜', type: 'text', owner: 'software' },
          { key: 'qty', label: '수량', type: 'number', owner: 'control' }
        ] }
      ] },
      { key: 'exp', label: '확장 모듈', discipline: 'control', items: [
        { key: 'hub_model', label: 'Switching Hub 모델', type: 'text', owner: 'control' },
        { key: 'hub_qty', label: 'Switching Hub 수량', type: 'number', unit: 'EA', owner: 'control' },
        { key: 'mp_vendor', label: 'RS-232C 멀티포트', type: 'select', options: ['Systembase', 'Moxa', '기타'], owner: 'control' },
        { key: 'mp_ports', label: '멀티포트 포트 수', type: 'number', unit: '포트', owner: 'control' },
        { key: 'mp_qty', label: '멀티포트 수량', type: 'number', unit: 'EA', owner: 'control' }
      ] },
      { key: 'sw', label: '소프트웨어', discipline: 'software', items: [
        { key: 'sw_os', label: 'OS', type: 'text', owner: 'software' },
        { key: 'sw_dev', label: '개발 환경', type: 'text', owner: 'software' },
        { key: 'sw_modes', label: '운전 모드·레시피', type: 'textarea', owner: 'software' },
        { key: 'sw_mes', label: '상위 연동 (MES 등)', type: 'text', owner: 'software' },
        { key: 'sw_log', label: '데이터 로깅', type: 'text', owner: 'software' },
        { key: 'sw_alarm', label: '알람 관리', type: 'text', owner: 'software' },
        { key: 'sw_auth', label: '사용자 권한', type: 'text', owner: 'software' }
      ] },
      { key: 'process', label: '공정', discipline: 'process', items: [
        { key: 'proc_ct', label: '사이클 타임', type: 'number', unit: 's', owner: 'process' },
        { key: 'proc_uph', label: '시간당 생산량 (UPH)', type: 'number', owner: 'process' },
        { key: 'proc_yield', label: '목표 수율', type: 'number', unit: '%', owner: 'process' },
        { key: 'proc_staff', label: '작업 인원', type: 'number', unit: '명', owner: 'process' }
      ] }
    ]
  }
};

/* ── 공통 ─────────────────────────────────────────────────────────────── */
function _specStr(v) { return v == null ? '' : String(v); }
function _specNum(v) {
  var s = _specStr(v).replace(/,/g, '').trim();
  if (s === '') return null;
  var n = Number(s);
  return isFinite(n) ? n : null;
}
function _specNorm(s) { return _specStr(s).replace(/\s+/g, '').toLowerCase(); }
function specNewId(prefix) { return (prefix || 'r') + '-' + Math.random().toString(36).slice(2, 10); }
function specClone(o) { return JSON.parse(JSON.stringify(o == null ? null : o)); }
function specDisciplineLabel(k) {
  if (k === 'all') return '공용';
  for (var i = 0; i < SPEC_DISCIPLINES.length; i++) if (SPEC_DISCIPLINES[i].key === k) return SPEC_DISCIPLINES[i].label;
  return k || '';
}

/* 양식의 모든 항목을 { key: {item, section} } 으로 */
function specItemIndex(schema) {
  var idx = {};
  ((schema && schema.sections) || []).forEach(function (sec) {
    (sec.items || []).forEach(function (it) { idx[it.key] = { item: it, section: sec }; });
  });
  return idx;
}

/* ── 사양서 정규화 ───────────────────────────────────────────────────────
   v13.160 형식 { design:[{item,value,remark}], ... } 또는 빈 값 → v:2.
   v:2 는 빠진 필드만 채운다. 원본은 바꾸지 않는다. */
function specNormalize(raw) {
  raw = raw || {};
  if (raw.v === 2) {
    var out = specClone(raw);
    out.values = out.values || {};
    out.remarks = out.remarks || {};
    out.extra = out.extra || {};
    out.status = out.status || {};
    SPEC_DISCIPLINE_KEYS.forEach(function (k) { if (!Array.isArray(out.extra[k])) out.extra[k] = []; });
    if (out.templateId == null) out.templateId = null;
    if (out.templateVersion == null) out.templateVersion = null;
    return out;
  }
  var sheet = { v: 2, templateId: null, templateVersion: null, values: {}, remarks: {}, status: {}, extra: {} };
  SPEC_DISCIPLINE_KEYS.forEach(function (k) {
    sheet.extra[k] = (Array.isArray(raw[k]) ? raw[k] : []).filter(Boolean).map(function (r) {
      return { id: r.id || specNewId('sp'), item: _specStr(r.item), value: _specStr(r.value), remark: _specStr(r.remark) };
    });
  });
  return sheet;
}

/* 기타 사양 행 중 항목 이름이 양식 항목 라벨과 같고(공백·대소문자 무시) 그 항목 값이 비어 있으면
   양식 항목으로 옮긴다. 표 항목은 대상이 아니다. 옮긴 개수를 돌려준다. (sheet 를 직접 수정) */
function specAbsorbExtra(sheet, schema) {
  var byLabel = {};
  ((schema && schema.sections) || []).forEach(function (sec) {
    (sec.items || []).forEach(function (it) { if (it.type !== 'table') byLabel[_specNorm(it.label)] = it; });
  });
  var moved = 0;
  SPEC_DISCIPLINE_KEYS.forEach(function (k) {
    sheet.extra[k] = (sheet.extra[k] || []).filter(function (r) {
      var it = byLabel[_specNorm(r.item)];
      if (!it || _specStr(sheet.values[it.key]) !== '') return true;
      sheet.values[it.key] = _specStr(r.value);
      if (r.remark) sheet.remarks[it.key] = _specStr(r.remark);
      moved++;
      return false;
    });
  });
  return moved;
}

/* 사양서에 양식을 지정(처음 시작 또는 새 버전 적용). 값은 key 로 유지된다. */
function specApplyTemplate(sheet, templateId, version, schema) {
  sheet.templateId = templateId;
  sheet.templateVersion = version;
  return specAbsorbExtra(sheet, schema);
}

/* 이전 프로젝트 사양서를 복사 — 값·비고·기타 사양·양식 참조. 표 행 id 는 새로 만든다. */
function specCopySheet(src) {
  var s = specNormalize(src);
  Object.keys(s.values).forEach(function (k) {
    if (Array.isArray(s.values[k])) s.values[k] = s.values[k].map(function (r) { var c = specClone(r); c.id = specNewId('r'); return c; });
  });
  SPEC_DISCIPLINE_KEYS.forEach(function (k) { s.extra[k] = s.extra[k].map(function (r) { var c = specClone(r); c.id = specNewId('sp'); return c; }); });
  return s;
}

/* 표 행이 비었는지 (id 제외 모든 칸이 공백) */
function specRowEmpty(row) {
  return !Object.keys(row || {}).some(function (k) { return k !== 'id' && _specStr(row[k]).trim() !== ''; });
}

/* 섹션별 입력 진행률 — 일반 항목은 값이 있으면 1, 표는 비지 않은 행이 1개 이상이면 1 */
function specSectionProgress(section, sheet) {
  var total = 0, filled = 0;
  (section.items || []).forEach(function (it) {
    total++;
    var v = sheet.values[it.key];
    if (it.type === 'table') { if (Array.isArray(v) && v.some(function (r) { return !specRowEmpty(r); })) filled++; }
    else if (_specStr(v).trim() !== '') filled++;
  });
  return { filled: filled, total: total };
}

/* ── 양식 검사 (관리자 편집기 저장·발행 전) ─────────────────────────────── */
var _SPEC_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
function specValidateSchema(schema) {
  var errs = [];
  var secs = (schema && schema.sections) || [];
  if (!secs.length) errs.push('섹션이 하나도 없습니다.');
  var secKeys = {}, itemKeys = {};
  secs.forEach(function (sec, si) {
    var where = '섹션 ' + (si + 1) + (sec.label ? ' "' + sec.label + '"' : '');
    if (!_SPEC_KEY_RE.test(sec.key || '')) errs.push(where + ': 키는 영소문자로 시작하는 영소문자·숫자·_ 40자 이내');
    else if (secKeys[sec.key]) errs.push(where + ': 섹션 키 "' + sec.key + '" 중복');
    else if (sec.key === 'hw') errs.push(where + ': 섹션 키 "hw" 는 하드웨어 구성도용으로 예약되어 있습니다.');
    secKeys[sec.key] = true;
    if (!_specStr(sec.label).trim()) errs.push(where + ': 이름이 없습니다.');
    if (sec.discipline !== 'all' && SPEC_DISCIPLINE_KEYS.indexOf(sec.discipline) < 0) errs.push(where + ': 분야가 올바르지 않습니다.');
    (sec.items || []).forEach(function (it, ii) {
      var w2 = where + ' 항목 ' + (ii + 1) + (it.label ? ' "' + it.label + '"' : '');
      if (!_SPEC_KEY_RE.test(it.key || '')) errs.push(w2 + ': 키 형식 오류');
      else if (itemKeys[it.key]) errs.push(w2 + ': 항목 키 "' + it.key + '" 중복 (양식 전체에서 유일해야 함)');
      itemKeys[it.key] = true;
      if (!_specStr(it.label).trim()) errs.push(w2 + ': 이름이 없습니다.');
      if (SPEC_ITEM_TYPES.indexOf(it.type) < 0) errs.push(w2 + ': 입력 유형 오류');
      if (it.type === 'select' && !(it.options || []).length) errs.push(w2 + ': 선택지가 없습니다.');
      if (it.type === 'table') {
        var cols = it.columns || [];
        if (!cols.length) errs.push(w2 + ': 표에 열이 없습니다.');
        var colKeys = {};
        cols.forEach(function (c, ci) {
          var w3 = w2 + ' 열 ' + (ci + 1);
          if (!_SPEC_KEY_RE.test(c.key || '') || c.key === 'id') errs.push(w3 + ': 키 형식 오류');
          else if (colKeys[c.key]) errs.push(w3 + ': 열 키 "' + c.key + '" 중복');
          colKeys[c.key] = true;
          if (!_specStr(c.label).trim()) errs.push(w3 + ': 이름이 없습니다.');
          if (SPEC_COL_TYPES.indexOf(c.type) < 0) errs.push(w3 + ': 유형 오류');
          if (c.type === 'select' && !(c.options || []).length) errs.push(w3 + ': 선택지가 없습니다.');
        });
      }
    });
  });
  return errs;
}

/* ── 자동 계통도 모델 + 검사 ─────────────────────────────────────────────
   내장 양식의 항목 키(mc_*, io_*, bb_*, ext_devices, hub_*, mp_*, ipc_*, axes)를 읽는다.
   관리자가 키를 지우면 해당 부분만 빠진다. */
function _specQty(v, dflt) { var n = _specNum(v); return n == null ? dflt : n; }
function specBuildDiagram(sheet) {
  var V = (sheet && sheet.values) || {};
  var devs = (Array.isArray(V.ext_devices) ? V.ext_devices : []).filter(function (r) { return !specRowEmpty(r); });
  var axes = (Array.isArray(V.axes) ? V.axes : []).filter(function (r) { return !specRowEmpty(r); });
  function devOf(re) { return devs.filter(function (d) { return re.test(_specStr(d.iface)); }); }
  var eth = devOf(/ethernet/i), ser = devOf(/232/), other = devs.filter(function (d) { return eth.indexOf(d) < 0 && ser.indexOf(d) < 0; });
  var mcName = [_specStr(V.mc_vendor), _specStr(V.mc_model)].filter(Boolean).join(' ');
  var model = {
    ipc: { name: _specStr(V.ipc_model), com: _specNum(V.ipc_com) },
    motion: {
      board: mcName || (V.mc_form ? _specStr(V.mc_form) : ''),
      boardSub: [V.mc_axes ? _specStr(V.mc_axes) + '축' : '', _specStr(V.mc_form), V.mc_qty && _specNum(V.mc_qty) !== 1 ? '× ' + _specStr(V.mc_qty) : ''].filter(Boolean).join(' · '),
      io: (_specStr(V.io_model) || _specNum(V.io_in_cards) != null || _specNum(V.io_out_cards) != null)
        ? { name: _specStr(V.io_model), sub: [V.io_in_cards ? 'In ' + _specStr(V.io_in_cards) : '', V.io_out_cards ? 'Out ' + _specStr(V.io_out_cards) : '', V.io_di ? 'DI ' + _specStr(V.io_di) : '', V.io_do ? 'DO ' + _specStr(V.io_do) : ''].filter(Boolean).join(' · ') }
        : null,
      base: _specStr(V.bb_model),
      axes: axes.map(function (a) {
        return { name: _specStr(a.name) || '(축)', sub: [_specStr(a.motor_type), _specStr(a.motor_power) ? _specStr(a.motor_power) + 'W' : '', _specStr(a.ch) !== '' ? 'CH' + _specStr(a.ch) : ''].filter(Boolean).join(' · ') };
      })
    },
    eth: { hub: (_specStr(V.hub_model) || _specNum(V.hub_qty)) ? { name: _specStr(V.hub_model) || 'Switching Hub', qty: _specQty(V.hub_qty, 1) } : null, devices: eth },
    serial: { mp: (_specStr(V.mp_vendor) || _specNum(V.mp_ports)) ? { name: _specStr(V.mp_vendor), ports: _specNum(V.mp_ports), qty: _specQty(V.mp_qty, 1) } : null, devices: ser },
    other: other
  };
  model.empty = !model.motion.board && !model.motion.io && !model.motion.base && !axes.length && !devs.length && !model.eth.hub && !model.serial.mp;
  return model;
}

/* 맞지 않는 값 — [{ level:'warn', text }] */
function specChecks(sheet) {
  var V = (sheet && sheet.values) || {};
  var out = [];
  var devs = (Array.isArray(V.ext_devices) ? V.ext_devices : []).filter(function (r) { return !specRowEmpty(r); });
  var serialNeed = devs.filter(function (d) { return /232/.test(_specStr(d.iface)); })
    .reduce(function (s, d) { return s + _specQty(d.qty, 1); }, 0);
  if (serialNeed > 0) {
    var mpPorts = (_specNum(V.mp_ports) || 0) * _specQty(V.mp_qty, _specNum(V.mp_ports) ? 1 : 0);
    var com = _specNum(V.ipc_com);
    var have = mpPorts + (com || 0);
    if (serialNeed > have) {
      out.push({ level: 'warn', key: 'serial_ports', text: 'RS-232C 장치 ' + serialNeed + '대 > 포트 ' + have + '개 (멀티포트 ' + mpPorts + (com != null ? ' + IPC 내장 ' + com : '') + ')' + (com == null ? ' — IPC 내장 COM 포트 수를 입력하세요' : '') });
    }
  }
  var axes = (Array.isArray(V.axes) ? V.axes : []).filter(function (r) { return !specRowEmpty(r); });
  var perBoard = _specNum(V.mc_axes);
  if (perBoard != null && axes.length) {
    var cap = perBoard * _specQty(V.mc_qty, 1);
    if (axes.length > cap) out.push({ level: 'warn', key: 'axis_cap', text: '축 ' + axes.length + '개 > 모션 컨트롤러 ' + cap + '축 (보드당 ' + perBoard + '축 × ' + _specQty(V.mc_qty, 1) + ')' });
  }
  var seen = {}, dup = {};
  axes.forEach(function (a) { var c = _specStr(a.ch).trim(); if (c === '') return; if (seen[c]) dup[c] = true; seen[c] = true; });
  if (Object.keys(dup).length) out.push({ level: 'warn', key: 'ch_dup', text: '축 채널 번호 중복: CH' + Object.keys(dup).join(', CH') });
  axes.forEach(function (a) {
    if (_specStr(a.brake_req) === '필요' && _specStr(a.motor_brake) === '없음') out.push({ level: 'warn', key: 'brake_' + (a.name || ''), text: '축 ' + (_specStr(a.name) || '?') + ': 브레이크가 필요한데 모터 브레이크 "없음"' });
  });
  return out;
}

/* ── 자동 계통도 배치 — 상자·연결선·계통 제목 좌표 (SVG 와 draw.io XML 이 같은 배치를 쓴다) ──
   IPC(왼쪽 세로 상자) → 계통별 1열(보드·허브·멀티포트) → 2열(베이스보드·장치) → 3열(축·경고) */
var _SPEC_DG = { ipcX: 16, ipcW: 104, c1: 164, w1: 184, c2: 388, w2: 184, c3: 612, w3: 168, width: 796, laneGap: 40, boxGap: 12 };
function _specTrunc(s, n) { s = _specStr(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function specDiagramLayout(model, checks) {
  var G = _SPEC_DG, boxes = [], edges = [], lanes = [], notes = [], brackets = [];
  var y = 36, laneTops = [];
  function box(id, x, yy, w, h, title, sub, kind) { var b = { id: id, x: x, y: yy, w: w, h: h, title: _specStr(title), sub: _specStr(sub), kind: kind || 'box' }; boxes.push(b); return b; }
  function stack(list, x, w, top, h, mk) { var out = [], yy = top; list.forEach(function (it, i) { out.push(mk(it, i, x, yy, w, h)); yy += h + G.boxGap; }); return out; }
  function colH(n, h) { return n ? n * h + (n - 1) * G.boxGap : 0; }
  function lane(title) { lanes.push({ title: title, x: G.c1, y: y - 10 }); laneTops.push(y); }
  var srcs = [];   // IPC 에서 나가는 연결 대상
  var M = model.motion;
  if (M.board || M.io || M.base || M.axes.length) {
    lane('모션·IO 계통');
    var left = [];
    if (M.board) left.push(box('mc', G.c1, 0, G.w1, 52, M.board, M.boardSub || '모션 보드', 'box'));
    if (M.io) left.push(box('io', G.c1, 0, G.w1, 52, M.io.name || 'IO 카드', M.io.sub, 'box'));
    var shown = M.axes.slice(0, 12);
    var axH = 36, colAx = colH(shown.length + (M.axes.length > 12 ? 1 : 0), axH);
    var h = Math.max(colH(left.length, 52), M.base ? 52 : 0, colAx);
    var yy = y + (h - colH(left.length, 52)) / 2;
    left.forEach(function (b) { b.y = yy; yy += 52 + G.boxGap; srcs.push(b); });
    var base = M.base ? box('bb', G.c2, y + (h - 52) / 2, G.w2, 52, M.base, '베이스보드', 'box') : null;
    var axBoxes = stack(shown, G.c3, G.w3, y + (h - colAx) / 2, axH, function (a, i, x, top, w, hh) { return box('ax' + i, x, top, w, hh, a.name, a.sub, 'small'); });
    if (M.axes.length > 12) axBoxes.push(box('axmore', G.c3, y + (h - colAx) / 2 + 12 * (axH + G.boxGap), G.w3, axH, '+' + (M.axes.length - 12) + '축', '', 'small'));
    if (base) left.forEach(function (b) { edges.push({ from: b.id, to: 'bb' }); });
    var axSrc = base ? [base] : left.slice(0, 1);
    axSrc.forEach(function (s) { axBoxes.forEach(function (a) { edges.push({ from: s.id, to: a.id }); }); });
    if (!left.length && base) srcs.push(base);
    if (!left.length && !base) axBoxes.forEach(function (a) { srcs.push(a); });
    y += h + G.laneGap + 12;
  }
  var E = model.eth;
  if (E.hub || E.devices.length) {
    lane('Ethernet 계통');
    var devH = 44, colD = colH(E.devices.length, devH), hh2 = Math.max(E.hub ? 52 : 0, colD);
    var hub = E.hub ? box('hub', G.c1, y + (hh2 - 52) / 2, G.w1, 52, E.hub.name, E.hub.name === 'Switching Hub' ? E.hub.qty + ' EA' : 'Switching Hub' + (E.hub.qty > 1 ? ' × ' + E.hub.qty : ''), 'box') : null;
    var ed = stack(E.devices, hub ? G.c2 : G.c1, hub ? G.w2 : G.w1, y + (hh2 - colD) / 2, devH, function (d, i, x, top, w, hh) { return box('eth' + i, x, top, w, hh, d.name || '(장치)', [d.vendor, _specQty(d.qty, 1) > 1 ? '× ' + d.qty : ''].filter(Boolean).join(' · '), 'dev'); });
    if (hub) { srcs.push(hub); ed.forEach(function (d) { edges.push({ from: 'hub', to: d.id }); }); } else ed.forEach(function (d) { srcs.push(d); });
    y += hh2 + G.laneGap + 12;
  }
  var S = model.serial;
  if (S.mp || S.devices.length) {
    lane('RS-232C 계통');
    var sH = 36, colS = colH(S.devices.length, sH), hh3 = Math.max(S.mp ? 52 : 0, colS);
    var mp = S.mp ? box('mp', G.c1, y + (hh3 - 52) / 2, G.w1, 52, (S.mp.name ? S.mp.name + ' ' : '') + '멀티포트', [S.mp.ports ? S.mp.ports + '포트' : '', S.mp.qty > 1 ? '× ' + S.mp.qty : ''].filter(Boolean).join(' · '), 'box') : null;
    var sd = stack(S.devices, mp ? G.c2 : G.c1, mp ? G.w2 : G.w1, y + (hh3 - colS) / 2, sH, function (d, i, x, top, w, hh) { return box('ser' + i, x, top, w, hh, (d.name || '(장치)') + (_specQty(d.qty, 1) > 1 ? ' × ' + d.qty : ''), '', 'small'); });
    if (mp) { srcs.push(mp); sd.forEach(function (d) { edges.push({ from: 'mp', to: d.id }); }); } else sd.forEach(function (d) { srcs.push(d); });
    var pw = (checks || []).filter(function (c) { return c.key === 'serial_ports'; })[0];
    if (pw) {
      notes.push(box('note_ports', G.c3, y + (hh3 - 84) / 2, G.w3, 84, '포트 부족', pw.text, 'warn'));
      if (sd.length) brackets.push({ x: sd[0].x + sd[0].w + 8, y1: sd[0].y, y2: sd[sd.length - 1].y + sd[sd.length - 1].h, toX: G.c3, midY: y + hh3 / 2 });
    }
    y += hh3 + G.laneGap + 12;
  }
  if (model.other.length) {
    lane('기타 인터페이스');
    var oH = 44;
    var od = stack(model.other, G.c1, G.w1, y, oH, function (d, i, x, top, w, hh) { return box('oth' + i, x, top, w, hh, d.name || '(장치)', [d.iface, d.vendor].filter(Boolean).join(' · '), 'dev'); });
    od.forEach(function (d) { srcs.push(d); });
    y += colH(od.length, oH) + G.laneGap + 12;
  }
  var ipcTop = laneTops.length ? laneTops[0] : 36;
  var ipcBottom = Math.max(ipcTop + 60, y - G.laneGap - 12);
  var ipc = { id: 'ipc', x: G.ipcX, y: ipcTop, w: G.ipcW, h: ipcBottom - ipcTop, title: model.ipc.name || 'IPC', sub: '제어 PC', kind: 'ipc' };
  boxes.unshift(ipc);
  srcs.forEach(function (b) { edges.unshift({ from: 'ipc', to: b.id }); });
  return { width: G.width, height: Math.max(ipcBottom + 20, 120), boxes: boxes.concat(notes), edges: edges, lanes: lanes, brackets: brackets };
}

/* 공백 단위 줄바꿈 (한 줄 최대 n 자, 최대 maxLines 줄 — 넘치면 마지막 줄 …) */
function _specWrap(text, n, maxLines) {
  var words = _specStr(text).split(/\s+/).filter(Boolean), lines = [], cur = '';
  words.forEach(function (w) {
    while (w.length > n) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, n)); w = w.slice(n); }
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= n) cur += ' ' + w; else { lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = _specTrunc(lines[maxLines - 1] + '…', n); }
  return lines;
}
function _specXml(s) { return _specStr(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _specBoxById(L, id) { for (var i = 0; i < L.boxes.length; i++) if (L.boxes[i].id === id) return L.boxes[i]; return null; }

/* 직각 연결선 — 출발 상자 오른쪽 가운데 → 두 열 사이 세로선 → 도착 상자 왼쪽 가운데 */
function _specEdgePath(a, b) {
  var x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
  if (a.kind === 'ipc') y1 = Math.max(a.y + 12, Math.min(a.y + a.h - 12, y2));
  var mx = x2 - 20;
  if (Math.abs(y1 - y2) < 1) return 'M' + x1 + ' ' + y1 + 'H' + (x2 - 1);
  return 'M' + x1 + ' ' + y1 + 'H' + mx + 'V' + y2 + 'H' + (x2 - 1);
}

/* SVG 문자열 — 앱 CSS 변수로 색을 잡아 다크 모드에서도 읽힌다. 문자열은 모두 이스케이프. */
function specDiagramSvg(L, opts) {
  opts = opts || {};
  var edge = opts.edge || 'var(--t6)', ink = opts.ink || 'var(--t1)', quiet = opts.quiet || 'var(--t5)', line = opts.line || 'var(--bd)';
  var accent = opts.accent || '#3B82F6', warn = opts.warn || '#F59E0B';
  var p = [];
  p.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + L.width + ' ' + L.height + '" width="100%" style="max-width:' + L.width + 'px;font-family:inherit" role="img" aria-label="하드웨어 구성도">');
  p.push('<defs><marker id="psArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="' + edge + '"/></marker></defs>');
  L.lanes.forEach(function (ln) { p.push('<text x="' + ln.x + '" y="' + ln.y + '" font-size="11" font-weight="700" fill="' + quiet + '">' + _specXml(ln.title) + '</text>'); });
  p.push('<g fill="none" stroke="' + edge + '" stroke-width="1.2">');
  L.edges.forEach(function (e) {
    var a = _specBoxById(L, e.from), b = _specBoxById(L, e.to);
    if (a && b) p.push('<path d="' + _specEdgePath(a, b) + '" marker-end="url(#psArrow)"/>');
  });
  p.push('</g>');
  (L.brackets || []).forEach(function (k) {
    p.push('<path d="M' + (k.x - 4) + ' ' + k.y1 + 'H' + k.x + 'V' + k.y2 + 'H' + (k.x - 4) + 'M' + k.x + ' ' + k.midY + 'H' + k.toX + '" fill="none" stroke="' + warn + '" stroke-width="1.2"/>');
  });
  L.boxes.forEach(function (b) {
    var isIpc = b.kind === 'ipc', isWarn = b.kind === 'warn';
    var stroke = isIpc ? accent : isWarn ? warn : line;
    var fill = isIpc ? accent : isWarn ? warn : 'none';
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    var chars = Math.floor((b.w - 16) / 7.2);
    p.push('<g><title>' + _specXml(b.title + (b.sub ? ' — ' + b.sub : '')) + '</title>');
    p.push('<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="8" fill="' + fill + '" fill-opacity="' + (fill === 'none' ? 1 : 0.1) + '" stroke="' + stroke + '" stroke-width="' + (isIpc || isWarn ? 1.8 : 1.2) + '"/>');
    if (isWarn) {
      p.push('<text x="' + (b.x + 10) + '" y="' + (b.y + 20) + '" font-size="12" font-weight="700" fill="' + ink + '">' + _specXml(b.title) + '</text>');
      var lines = _specWrap(b.sub, Math.floor((b.w - 20) / 7), 4);
      lines.forEach(function (ln, i) { p.push('<text x="' + (b.x + 10) + '" y="' + (b.y + 38 + i * 14) + '" font-size="10.5" fill="' + ink + '">' + _specXml(ln) + '</text>'); });
    } else if (isIpc) {
      var tl = _specWrap(b.title, Math.floor((b.w - 12) / 7.5), 4), ty = cy - (tl.length * 16) / 2 + 8;
      tl.forEach(function (ln, i) { p.push('<text x="' + cx + '" y="' + (ty + i * 16) + '" text-anchor="middle" font-size="12.5" font-weight="700" fill="' + ink + '">' + _specXml(ln) + '</text>'); });
      p.push('<text x="' + cx + '" y="' + (ty + tl.length * 16 + 2) + '" text-anchor="middle" font-size="10.5" fill="' + quiet + '">' + _specXml(b.sub) + '</text>');
    } else if (b.sub) {
      p.push('<text x="' + cx + '" y="' + (cy - 3) + '" text-anchor="middle" font-size="' + (b.kind === 'small' ? 11.5 : 12.5) + '" font-weight="700" fill="' + ink + '">' + _specXml(_specTrunc(b.title, chars)) + '</text>');
      p.push('<text x="' + cx + '" y="' + (cy + 12) + '" text-anchor="middle" font-size="10.5" fill="' + quiet + '">' + _specXml(_specTrunc(b.sub, Math.floor((b.w - 16) / 6.2))) + '</text>');
    } else {
      p.push('<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="' + (b.kind === 'small' ? 11.5 : 12.5) + '" font-weight="' + (b.kind === 'small' ? 500 : 700) + '" fill="' + ink + '">' + _specXml(_specTrunc(b.title, chars)) + '</text>');
    }
    p.push('</g>');
  });
  p.push('</svg>');
  return p.join('');
}

/* draw.io(mxGraph) XML — 자동 계통도를 편집 가능한 도면의 출발점으로 */
function specDiagramDrawioXml(L) {
  var c = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  L.lanes.forEach(function (ln, i) {
    c.push('<mxCell id="lane' + i + '" value="' + _specXml(ln.title) + '" style="text;html=1;fontStyle=1;fontSize=11;fontColor=#64748B;align=left;verticalAlign=middle;" vertex="1" parent="1"><mxGeometry x="' + ln.x + '" y="' + (ln.y - 14) + '" width="200" height="20" as="geometry"/></mxCell>');
  });
  L.boxes.forEach(function (b) {
    var style = b.kind === 'ipc' ? 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#3B82F6;fontStyle=1;'
      : b.kind === 'warn' ? 'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#F59E0B;align=left;spacingLeft=8;'
      : 'rounded=1;whiteSpace=wrap;html=1;';
    var val = _specXml(_specXml(b.title)) + (b.sub ? '&lt;br&gt;&lt;font style=&quot;font-size:10px&quot; color=&quot;#64748B&quot;&gt;' + _specXml(_specXml(b.sub)) + '&lt;/font&gt;' : '');
    c.push('<mxCell id="' + b.id + '" value="' + val + '" style="' + style + '" vertex="1" parent="1"><mxGeometry x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" as="geometry"/></mxCell>');
  });
  L.edges.forEach(function (e, i) {
    c.push('<mxCell id="e' + i + '" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;strokeColor=#94A3B8;" edge="1" parent="1" source="' + e.from + '" target="' + e.to + '"><mxGeometry relative="1" as="geometry"/></mxCell>');
  });
  return '<mxfile><diagram name="구성도"><mxGraphModel dx="' + L.width + '" dy="' + L.height + '" grid="1" gridSize="8" page="0"><root>' + c.join('') + '</root></mxGraphModel></diagram></mxfile>';
}

/* ── 항목 상태 — 미정(값 없음) → 검토 → 확정. sheet.status[itemKey] ─────── */
var SPEC_STATUS = [
  { key: '', label: '미정', color: '#94A3B8' },
  { key: 'review', label: '검토', color: '#F59E0B' },
  { key: 'fixed', label: '확정', color: '#10B981' }
];
function specStatusOf(sheet, key) { var s = sheet && sheet.status && sheet.status[key]; return s === 'fixed' || s === 'review' ? s : ''; }
function specNextStatus(s) { return s === '' ? 'review' : s === 'review' ? 'fixed' : ''; }
function specSectionStatus(section, sheet) {
  var n = 0, fixed = 0, review = 0;
  (section.items || []).forEach(function (it) { n++; var s = specStatusOf(sheet, it.key); if (s === 'fixed') fixed++; else if (s === 'review') review++; });
  return { total: n, fixed: fixed, review: review };
}

/* ── 변경분 — 서버 PATCH /specs 로 보낼 [{ path, from, to, label }] (규칙: server/lib/spec-patch.js) ──
   표는 행·칸 단위라 같은 표의 다른 칸을 여러 사람이 동시에 고쳐도 병합된다. */
function _specBlank(v) { return v === undefined || v === null || v === ''; }
function _specSame(a, b) { if (_specBlank(a) && _specBlank(b)) return true; return JSON.stringify(a) === JSON.stringify(b); }
function specDiff(base, next, schema) {
  var out = [], idx = specItemIndex(schema);
  function lbl(k, extra) {
    var e = idx[k];
    return (e ? e.section.label + ' › ' + e.item.label : k) + (extra ? ' › ' + extra : '');
  }
  function colLabel(k, c) {
    var e = idx[k]; if (!e) return c;
    var col = (e.item.columns || []).filter(function (x) { return x.key === c; })[0];
    return col ? col.label : c;
  }
  ['templateId', 'templateVersion'].forEach(function (k) {
    if (!_specSame(base[k], next[k])) out.push({ path: [k], from: base[k] == null ? null : base[k], to: next[k] == null ? null : next[k], label: k === 'templateId' ? '표준 양식' : '표준 양식 버전' });
  });
  var vkeys = {};
  Object.keys(base.values || {}).concat(Object.keys(next.values || {})).forEach(function (k) { vkeys[k] = true; });
  Object.keys(vkeys).forEach(function (k) {
    var b = (base.values || {})[k], n = (next.values || {})[k];
    if (Array.isArray(b) || Array.isArray(n)) {
      var bRows = Array.isArray(b) ? b : [], nRows = Array.isArray(n) ? n : [];
      var bById = {}, nById = {};
      bRows.forEach(function (r) { if (r && r.id) bById[r.id] = r; });
      nRows.forEach(function (r) { if (r && r.id) nById[r.id] = r; });
      nRows.forEach(function (r) {
        if (!r || !r.id) return;
        var br = bById[r.id], name = _specStr(r.name) || _specStr((br || {}).name) || '행';
        if (!br) { out.push({ path: ['values', k, r.id], from: null, to: r, label: lbl(k, name + ' 추가') }); return; }
        var cols = {};
        Object.keys(br).concat(Object.keys(r)).forEach(function (c) { if (c !== 'id') cols[c] = true; });
        Object.keys(cols).forEach(function (c) {
          if (!_specSame(br[c], r[c])) out.push({ path: ['values', k, r.id, c], from: _specBlank(br[c]) ? '' : br[c], to: _specBlank(r[c]) ? '' : r[c], label: lbl(k, name + ' › ' + colLabel(k, c)) });
        });
      });
      bRows.forEach(function (r) { if (r && r.id && !nById[r.id]) out.push({ path: ['values', k, r.id], from: r, to: null, label: lbl(k, (_specStr(r.name) || '행') + ' 삭제') }); });
      return;
    }
    if (!_specSame(b, n)) out.push({ path: ['values', k], from: _specBlank(b) ? '' : b, to: _specBlank(n) ? '' : n, label: lbl(k) });
  });
  ['remarks', 'status'].forEach(function (root) {
    var ks = {};
    Object.keys(base[root] || {}).concat(Object.keys(next[root] || {})).forEach(function (k) { ks[k] = true; });
    Object.keys(ks).forEach(function (k) {
      var b = (base[root] || {})[k], n = (next[root] || {})[k];
      if (!_specSame(b, n)) out.push({ path: [root, k], from: _specBlank(b) ? '' : b, to: _specBlank(n) ? '' : n, label: lbl(k, root === 'status' ? '상태' : '비고') });
    });
  });
  SPEC_DISCIPLINE_KEYS.forEach(function (d) {
    var b = (base.extra || {})[d] || [], n = (next.extra || {})[d] || [];
    if (!_specSame(b, n)) out.push({ path: ['extra', d], from: b, to: n, label: '기타 사양 › ' + specDisciplineLabel(d) });
  });
  return out;
}

/* ── 부품 요약 (BOM 기초) — 모델별 수량. [{ group, name, model, qty, note }] ───── */
function specBom(sheet) {
  var V = (sheet && sheet.values) || {}, map = {}, order = [];
  function add(group, name, model, qty, note) {
    model = _specStr(model).trim();
    if (!model) return;
    var k = group + '|' + model;
    if (!map[k]) { map[k] = { group: group, name: name, model: model, qty: 0, note: [] }; order.push(k); }
    map[k].qty += qty;
    if (note && map[k].note.indexOf(note) < 0) map[k].note.push(note);
  }
  add('제어', '제어 PC', V.ipc_model, 1);
  add('모션', '모션 컨트롤러', [_specStr(V.mc_vendor), _specStr(V.mc_model)].filter(Boolean).join(' '), _specQty(V.mc_qty, 1));
  add('IO', 'IO 카드', V.io_model, (_specNum(V.io_in_cards) || 0) + (_specNum(V.io_out_cards) || 0) || 1);
  add('모션', '베이스보드', V.bb_model, _specQty(V.bb_qty, 1));
  (Array.isArray(V.axes) ? V.axes : []).filter(function (r) { return !specRowEmpty(r); }).forEach(function (a) {
    var ax = _specStr(a.name);
    add('모션', '드라이브', a.drv_model, 1, ax);
    add('모션', '모터', [a.motor_model, a.motor_power ? a.motor_power + 'W' : ''].filter(Boolean).join(' '), 1, ax);
  });
  add('통신', 'Switching Hub', V.hub_model || (_specNum(V.hub_qty) ? 'Switching Hub' : ''), _specQty(V.hub_qty, 1));
  add('통신', 'RS-232C 멀티포트', V.mp_vendor ? _specStr(V.mp_vendor) + (V.mp_ports ? ' ' + _specStr(V.mp_ports) + '포트' : '') : '', _specQty(V.mp_qty, 1));
  (Array.isArray(V.ext_devices) ? V.ext_devices : []).filter(function (r) { return !specRowEmpty(r); }).forEach(function (d) {
    add('외부장치', _specStr(d.name) || '외부장치', d.vendor || d.name, _specQty(d.qty, 1), _specStr(d.iface));
  });
  return order.map(function (k) { var r = map[k]; r.note = r.note.filter(Boolean).join(', '); return r; });
}

/* ── XLSX 행 — [ [프로젝트, 섹션, 항목, 값, 단위, 비고] ] + 표별 시트 ──── */
function specSheetRows(projName, schema, sheet) {
  var rows = [], tables = [];
  ((schema && schema.sections) || []).forEach(function (sec) {
    (sec.items || []).forEach(function (it) {
      var v = sheet.values[it.key];
      if (it.type === 'table') {
        var data = (Array.isArray(v) ? v : []).filter(function (r) { return !specRowEmpty(r); });
        if (!data.length) return;
        var cols = it.columns || [];
        var aoa = [['프로젝트'].concat(cols.map(function (c) { return c.label + (c.unit ? ' (' + c.unit + ')' : ''); }))];
        data.forEach(function (r) { aoa.push([projName].concat(cols.map(function (c) { return _specStr(r[c.key]); }))); });
        tables.push({ key: it.key, label: it.label, rows: aoa });
        return;
      }
      if (_specStr(v).trim() === '' && !sheet.remarks[it.key] && !specStatusOf(sheet, it.key)) return;
      var st = specStatusOf(sheet, it.key);
      rows.push([projName, sec.label, it.label, _specStr(v), it.unit || '', _specStr(sheet.remarks[it.key]), st === 'fixed' ? '확정' : st === 'review' ? '검토' : '미정']);
    });
  });
  SPEC_DISCIPLINE_KEYS.forEach(function (k) {
    (sheet.extra[k] || []).forEach(function (r) {
      if (!r || !(r.item || r.value || r.remark)) return;
      rows.push([projName, '기타 사양 (' + specDisciplineLabel(k) + ')', _specStr(r.item), _specStr(r.value), '', _specStr(r.remark), '']);
    });
  });
  return { rows: rows, tables: tables };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SPEC_DISCIPLINES: SPEC_DISCIPLINES, SPEC_BUILTIN_TEMPLATE: SPEC_BUILTIN_TEMPLATE, SPEC_BUILTIN_ID: SPEC_BUILTIN_ID,
    specNormalize: specNormalize, specAbsorbExtra: specAbsorbExtra, specApplyTemplate: specApplyTemplate,
    specCopySheet: specCopySheet, specRowEmpty: specRowEmpty, specSectionProgress: specSectionProgress,
    specValidateSchema: specValidateSchema, specBuildDiagram: specBuildDiagram, specChecks: specChecks,
    specSheetRows: specSheetRows, specItemIndex: specItemIndex, specDisciplineLabel: specDisciplineLabel,
    specDiagramLayout: specDiagramLayout, specDiagramSvg: specDiagramSvg, specDiagramDrawioXml: specDiagramDrawioXml,
    specDiff: specDiff, specBom: specBom, specStatusOf: specStatusOf, specNextStatus: specNextStatus, specSectionStatus: specSectionStatus, SPEC_STATUS: SPEC_STATUS
  };
}
