// spec-schema.js — 장비 표준 사양서 순수 로직 (v13.196)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../spec-schema.js');

const schema = S.SPEC_BUILTIN_TEMPLATE.schema;

test('내장 기본 양식은 검사를 통과한다', () => {
  assert.deepStrictEqual(S.specValidateSchema(schema), []);
});

test('양식 검사: 키 중복·표 열 없음·선택지 없음', () => {
  const bad = { sections: [
    { key: 'a', label: 'A', discipline: 'design', items: [
      { key: 'x', label: 'X', type: 'text' },
      { key: 'x', label: 'X2', type: 'select', options: [] },
      { key: 't', label: 'T', type: 'table', columns: [] }
    ] },
    { key: 'a', label: '', discipline: 'nope', items: [] }
  ] };
  const errs = S.specValidateSchema(bad).join('\n');
  assert.match(errs, /항목 키 "x" 중복/);
  assert.match(errs, /선택지가 없습니다/);
  assert.match(errs, /표에 열이 없습니다/);
  assert.match(errs, /섹션 키 "a" 중복/);
  assert.match(errs, /분야가 올바르지 않습니다/);
});

test('v13.160 형식 → v2: 행은 기타 사양으로, 빈 값은 빈 배열', () => {
  const s = S.specNormalize({ design: [{ id: 'a', item: '총 중량', value: '850', remark: '' }], control: [{ item: '통신 사양', value: 'EtherCAT' }] });
  assert.strictEqual(s.v, 2);
  assert.strictEqual(s.templateId, null);
  assert.strictEqual(s.extra.design.length, 1);
  assert.strictEqual(s.extra.control[0].value, 'EtherCAT');
  assert.ok(s.extra.control[0].id);
  assert.deepStrictEqual(s.extra.software, []);
  assert.deepStrictEqual(S.specNormalize(null).values, {});
});

test('양식 적용: 라벨이 같은 기타 사양 행은 양식 항목으로 옮긴다 (공백 무시, 값 0 유지)', () => {
  const s = S.specNormalize({ design: [{ item: '총중량', value: '0', remark: '추정' }, { item: '없는 항목', value: 'x' }] });
  const moved = S.specApplyTemplate(s, 'builtin', 1, schema);
  assert.strictEqual(moved, 1);
  assert.strictEqual(s.values.mech_weight, '0');
  assert.strictEqual(s.remarks.mech_weight, '추정');
  assert.strictEqual(s.extra.design.length, 1);
  assert.strictEqual(s.templateVersion, 1);
});

test('양식 적용: 이미 값이 있으면 덮어쓰지 않는다', () => {
  const s = S.specNormalize({ v: 2, values: { mech_weight: '900' }, extra: { design: [{ id: 'e', item: '총 중량', value: '850' }] } });
  assert.strictEqual(S.specAbsorbExtra(s, schema), 0);
  assert.strictEqual(s.values.mech_weight, '900');
});

test('사양서 복사: 값은 같고 표 행 id 는 새로', () => {
  const src = { v: 2, templateId: 'builtin', templateVersion: 1, values: { axes: [{ id: 'r-1', name: 'X1' }], mc_axes: '2' }, remarks: {}, extra: {} };
  const c = S.specCopySheet(src);
  assert.strictEqual(c.values.axes[0].name, 'X1');
  assert.notStrictEqual(c.values.axes[0].id, 'r-1');
  assert.strictEqual(src.values.axes[0].id, 'r-1');
  assert.strictEqual(c.templateId, 'builtin');
});

// 요청서 예시: RS-232C 장치 6대 · 4포트 멀티포트 1개
function sampleSheet(extra) {
  return S.specNormalize({ v: 2, values: Object.assign({
    mc_vendor: 'Ajinextek', mc_axes: '2', mc_form: 'PCIe 보드', mc_qty: '1', bb_model: 'BPHR', hub_qty: '1',
    mp_vendor: 'Moxa', mp_ports: '4', mp_qty: '1',
    ext_devices: [
      { id: '1', name: 'Santec test equipment', iface: 'Ethernet', qty: '1' },
      { id: '2', name: 'Keyence SLC Camera', iface: 'Ethernet', qty: '1' },
      { id: '3', name: 'DLC Camera', iface: 'RS-232C' },
      { id: '4', name: 'Suruga Seiki 평탄도', iface: 'RS-232C' },
      { id: '5', name: 'Hoya UV Cure', iface: 'RS-232C' },
      { id: '6', name: 'Load Cell', iface: 'RS-232C', qty: '2' },
      { id: '7', name: 'EFU', iface: 'RS-232C' },
      { id: '8', name: '', iface: '', qty: '' }
    ],
    axes: [{ id: 'a', name: 'X1', ch: '0' }, { id: 'b', name: 'Y1', ch: '0' }, { id: 'c', name: 'Z1', ch: '2', brake_req: '필요', motor_brake: '없음' }]
  }, extra || {}) });
}

test('검사: 232C 장치 6대 > 4포트, 축 3개 > 2축, 채널 중복, 브레이크 불일치', () => {
  const w = S.specChecks(sampleSheet()).map((x) => x.key);
  assert.deepStrictEqual(w.sort(), ['axis_cap', 'brake_Z1', 'ch_dup', 'serial_ports'].sort());
  const txt = S.specChecks(sampleSheet()).find((x) => x.key === 'serial_ports').text;
  assert.match(txt, /6대 > 포트 4개/);
  assert.match(txt, /내장 COM 포트 수를 입력/);
});

test('검사: IPC 내장 COM 2개를 넣으면 포트 경고가 사라진다', () => {
  const w = S.specChecks(sampleSheet({ ipc_com: '2' })).map((x) => x.key);
  assert.ok(!w.includes('serial_ports'));
});

test('계통도 모델: 계통별 장치 분류, 빈 행 제외', () => {
  const m = S.specBuildDiagram(sampleSheet());
  assert.strictEqual(m.empty, false);
  assert.strictEqual(m.eth.devices.length, 2);
  assert.strictEqual(m.serial.devices.length, 5);
  assert.strictEqual(m.serial.mp.ports, 4);
  assert.strictEqual(m.motion.board, 'Ajinextek');
  assert.match(m.motion.boardSub, /2축/);
  assert.strictEqual(m.motion.axes.length, 3);
  assert.strictEqual(S.specBuildDiagram(S.specNormalize({})).empty, true);
});

test('진행률: 표는 비지 않은 행이 있어야 채움', () => {
  const sec = schema.sections.find((s) => s.key === 'axes');
  assert.deepStrictEqual(S.specSectionProgress(sec, S.specNormalize({ v: 2, values: { axes: [{ id: 'x' }] } })), { filled: 0, total: 1 });
  assert.deepStrictEqual(S.specSectionProgress(sec, sampleSheet()), { filled: 1, total: 1 });
});

test('XLSX 행: 일반 항목 + 표 시트 + 기타 사양', () => {
  const s = sampleSheet();
  s.extra.design.push({ id: 'e', item: '특이사항', value: '반입구 협소', remark: '' });
  const out = S.specSheetRows('P1', schema, s);
  assert.ok(out.rows.some((r) => r[2] === '보드당 축 수' && r[3] === '2'));
  assert.ok(out.rows.some((r) => r[1] === '기타 사양 (설계)'));
  const ext = out.tables.find((t) => t.key === 'ext_devices');
  assert.strictEqual(ext.rows.length, 1 + 7);
  assert.strictEqual(ext.rows[0][0], '프로젝트');
});

test('변경분: 일반 항목·비고·상태·표 칸/행 추가·삭제·기타 사양', () => {
  const base = S.specNormalize({ v: 2, templateId: 'builtin', templateVersion: 1, values: { mc_axes: '2', axes: [{ id: 'a', name: 'X1', stroke: '300' }, { id: 'b', name: 'Y1' }] }, remarks: {}, status: { mc_axes: 'fixed' }, extra: {} });
  const next = S.specNormalize(JSON.parse(JSON.stringify(base)));
  next.values.mc_axes = '4';
  next.remarks.mc_axes = '확장';
  next.status.mc_axes = 'review';
  next.values.axes[0].stroke = '350';
  next.values.axes.splice(1, 1);
  next.values.axes.push({ id: 'c', name: 'Z1' });
  next.extra.design.push({ id: 'e', item: '특이', value: 'x', remark: '' });
  const ch = S.specDiff(base, next, schema);
  const by = (p) => ch.find((c) => JSON.stringify(c.path) === JSON.stringify(p));
  assert.deepStrictEqual(by(['values', 'mc_axes']).to, '4');
  assert.strictEqual(by(['values', 'mc_axes']).label, '모션 컨트롤러 › 보드당 축 수');
  assert.strictEqual(by(['remarks', 'mc_axes']).to, '확장');
  assert.strictEqual(by(['status', 'mc_axes']).from, 'fixed');
  assert.strictEqual(by(['values', 'axes', 'a', 'stroke']).label, '축 구성 › 축 구성 표 › X1 › 스트로크');
  assert.strictEqual(by(['values', 'axes', 'b']).to, null);
  assert.strictEqual(by(['values', 'axes', 'c']).from, null);
  assert.ok(by(['extra', 'design']));
  assert.strictEqual(ch.length, 7);
  assert.deepStrictEqual(S.specDiff(base, S.specNormalize(JSON.parse(JSON.stringify(base))), schema), []);
});

test('변경분: 빈 값과 없는 값은 같다 (0 은 다르다)', () => {
  const a = S.specNormalize({ v: 2, values: { mc_axes: '' } });
  const b = S.specNormalize({ v: 2, values: {} });
  assert.deepStrictEqual(S.specDiff(a, b, schema), []);
  b.values.mc_axes = '0';
  assert.strictEqual(S.specDiff(a, b, schema).length, 1);
});

test('상태: 미정 → 검토 → 확정 → 미정, 섹션 집계', () => {
  assert.strictEqual(S.specNextStatus(''), 'review');
  assert.strictEqual(S.specNextStatus('review'), 'fixed');
  assert.strictEqual(S.specNextStatus('fixed'), '');
  const sec = schema.sections.find((s) => s.key === 'mc');
  const st = S.specSectionStatus(sec, S.specNormalize({ v: 2, status: { mc_axes: 'fixed', mc_vendor: 'review', mc_qty: 'bogus' } }));
  assert.deepStrictEqual(st, { total: sec.items.length, fixed: 1, review: 1 });
});

test('부품 요약: 같은 모델은 합산, 축 이름을 비고로', () => {
  const s = S.specNormalize({ v: 2, values: {
    mc_vendor: 'Ajinextek', mc_model: 'PCIe-Rxx04', mc_qty: '2',
    axes: [{ id: 'a', name: 'X1', drv_model: 'SGD7S-2R8', motor_model: 'SGM7J-04', motor_power: '400' }, { id: 'b', name: 'Y1', drv_model: 'SGD7S-2R8', motor_model: 'SGM7J-04', motor_power: '400' }, { id: 'c' }],
    ext_devices: [{ id: 'l', name: 'Load Cell', vendor: 'CAS', iface: 'RS-232C', qty: '2' }]
  } });
  const bom = S.specBom(s);
  const drv = bom.find((r) => r.name === '드라이브');
  assert.strictEqual(drv.qty, 2);
  assert.strictEqual(drv.note, 'X1, Y1');
  assert.strictEqual(bom.find((r) => r.name === '모터').model, 'SGM7J-04 400W');
  assert.strictEqual(bom.find((r) => r.name === '모션 컨트롤러').qty, 2);
  assert.strictEqual(bom.find((r) => r.group === '외부장치').qty, 2);
});

test('PCI: 선택지 포함, CPU·메모리 분리, 슬롯 초과 검사 (PCI 와 PCIe 구분)', () => {
  const idx = S.specItemIndex(schema);
  assert.ok(idx.mc_form.item.options.includes('PCI 보드'));
  assert.ok(idx.io_form.item.options.includes('PCI 보드'));
  assert.ok(idx.ext_devices.item.columns.find((c) => c.key === 'iface').options.includes('PCI'));
  assert.strictEqual(idx.ipc_cpu.item.label, 'CPU');
  assert.strictEqual(idx.ipc_mem.item.label, '메모리');
  const sheet = (v) => S.specNormalize({ v: 2, values: v });
  const base = { mc_form: 'PCI 보드', mc_qty: '2', io_form: 'PCI 보드', io_in_cards: '1', io_out_cards: '1', ipc_pci: '3', ipc_pcie: '1',
    ext_devices: [{ id: 'g', name: '프레임 그래버', iface: 'PCIe' }, { id: 'h', name: 'GPIB', iface: 'PCI' }] };
  const w = S.specChecks(sheet(base));
  const pci = w.find((x) => x.key === 'slot_pci');
  assert.match(pci.text, /PCI 보드 5장 > IPC PCI 슬롯 3개/);
  assert.ok(!w.some((x) => x.key === 'slot_pcie'));   // PCIe 는 1장 = 슬롯 1 — 'PCIe' 가 PCI 로 세어지지 않아야 함
  assert.ok(!S.specChecks(sheet(Object.assign({}, base, { ipc_pci: '' }))).some((x) => x.key === 'slot_pci'));
  assert.deepStrictEqual(S.specValidateSchema(schema), []);
});

test('구성도 편집: 옮김·이름·숨김·추가 상자·화살표(추가·지움·뒤집기·라벨) 병합', () => {
  const sheet = sampleSheet();
  const L = S.specDiagramLayout(S.specBuildDiagram(sheet), S.specChecks(sheet));
  const hubKey = 'hub>eth0';
  const M = S.specDiagramMerge(L, {
    pos: { hub: { x: 500, y: 900 } }, text: { mc: { title: '모션 보드 (메인)' }, lane0: { title: '모션 계통' } },
    hideBox: { eth1: true }, add: [{ id: 'bx1', x: 700, y: 20, w: 160, h: 44, title: 'UPS' }],
    links: [{ id: 'l1', from: 'bx1', to: 'ipc', label: 'AC 220V' }, { id: 'l2', from: 'bx1', to: 'nope' }],
    hideEdge: { 'mp>ser0': true }, flip: { [hubKey]: true }, edgeLabel: { [hubKey]: 'LAN' }
  });
  const box = (id) => M.boxes.find((b) => b.id === id);
  assert.deepStrictEqual([box('hub').x, box('hub').y], [500, 900]);
  assert.strictEqual(box('mc').title, '모션 보드 (메인)');
  assert.strictEqual(M.lanes[0].title, '모션 계통');
  assert.strictEqual(box('eth1'), undefined);
  assert.strictEqual(box('bx1').kind, 'user');
  assert.ok(M.edges.some((e) => e.key === 'u:l1' && e.label === 'AC 220V'));
  assert.ok(!M.edges.some((e) => e.key === 'u:l2'));                 // 없는 상자로 가는 화살표는 버림
  assert.ok(!M.edges.some((e) => e.key === 'a:mp>ser0'));
  assert.ok(!M.edges.some((e) => e.to === 'eth1' || e.from === 'eth1')); // 숨긴 상자의 화살표도 사라짐
  const f = M.edges.find((e) => e.key === 'a:' + hubKey);
  assert.deepStrictEqual([f.from, f.to, f.label], ['eth0', 'hub', 'LAN']);
  assert.ok(M.height >= 900 + 52);                                  // 옮긴 상자까지 그림이 커진다
  assert.deepStrictEqual(M.brackets, []);                           // 옮기면 경고 괄호는 생략
  assert.strictEqual(S.specDiagramMerge(L, null).brackets.length, L.brackets.length);
});

test('구성도 편집: 사양 값이 바뀌어도 id 로 위치 유지, 없어진 장치는 빠짐', () => {
  const sheet = sampleSheet();
  const dg = { pos: { eth0: { x: 600, y: 400 }, ser4: { x: 10, y: 10 } } };
  sheet.values.ext_devices = sheet.values.ext_devices.filter((d) => d.iface !== 'RS-232C');
  const M = S.specDiagramMerge(S.specDiagramLayout(S.specBuildDiagram(sheet), []), dg);
  assert.deepStrictEqual([M.boxes.find((b) => b.id === 'eth0').x, M.boxes.find((b) => b.id === 'eth0').y], [600, 400]);
  assert.ok(!M.boxes.some((b) => b.id === 'ser4'));
});

test('화살표 경로: 오른쪽·왼쪽·아래·위 모두 직각', () => {
  const a = { x: 100, y: 100, w: 100, h: 40 };
  const right = S.specEdgeRoute(a, { x: 300, y: 200, w: 100, h: 40 });
  const left = S.specEdgeRoute(a, { x: 0, y: 0, w: 60, h: 40 });
  const down = S.specEdgeRoute(a, { x: 120, y: 300, w: 100, h: 40 });
  const up = S.specEdgeRoute(a, { x: 150, y: 0, w: 100, h: 40 });
  assert.deepStrictEqual(right[0], [200, 120]); assert.deepStrictEqual(right.at(-1), [300, 220]);
  assert.deepStrictEqual(left[0], [100, 120]); assert.deepStrictEqual(left.at(-1), [60, 20]);
  assert.deepStrictEqual(down[0], [150, 140]); assert.deepStrictEqual(down.at(-1), [170, 300]);
  assert.deepStrictEqual(up[0], [150, 100]); assert.deepStrictEqual(up.at(-1), [200, 40]);
  [right, left, down, up].forEach((pts) => { for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1]); });
});

test('변경분: 구성도 편집은 diagram 통째 한 건', () => {
  const base = S.specNormalize({ v: 2, values: {} });
  const next = S.specNormalize({ v: 2, values: {}, diagram: { pos: { mc: { x: 1, y: 2 } } } });
  const ch = S.specDiff(base, next, schema);
  assert.strictEqual(ch.length, 1);
  assert.deepStrictEqual(ch[0].path, ['diagram']);
  assert.ok(S.specDiagramEmpty(null) && S.specDiagramEmpty({ pos: {} }) && !S.specDiagramEmpty(next.diagram));
});

test('SVG: 편집 모드는 data-box·data-edge 와 선택 표시, 라벨은 이스케이프', () => {
  const sheet = sampleSheet();
  const M = S.specDiagramMerge(S.specDiagramLayout(S.specBuildDiagram(sheet), []), { links: [{ id: 'x', from: 'mc', to: 'ipc', label: '<24V>' }] });
  const svg = S.specDiagramSvg(M, { interactive: true, selected: 'box:mc' });
  assert.match(svg, /data-box="mc"/);
  assert.match(svg, /data-edge="u:x"/);
  assert.match(svg, /&lt;24V&gt;/);
  assert.doesNotMatch(S.specDiagramSvg(M, {}), /data-box=/);
});
