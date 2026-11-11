// node --test test/spec-topo.test.js — 장치 계층 구성(spec-topo.js) 순수 로직
var test = require('node:test'), assert = require('node:assert');
var T = require('../spec-topo.js');

function build() {
  var t = T.specTopoNorm({});
  var pc = T.specTopoAdd(t, null, 'pc');
  var e1 = T.specTopoAdd(t, pc.id, 'eth'), e2 = T.specTopoAdd(t, pc.id, 'eth');
  var slot = T.specTopoAdd(t, pc.id, 'pcie');
  var mc = T.specTopoAdd(t, slot.id, 'motion');
  var d1 = T.specTopoAdd(t, mc.id, 'drive'); d1.port = 'CH0';
  var a1 = T.specTopoAdd(t, d1.id, 'axis');
  var d2 = T.specTopoAdd(t, mc.id, 'drive'); d2.port = 'CH1';
  var a2 = T.specTopoAdd(t, d2.id, 'axis');
  var hub = T.specTopoAdd(t, e2.id, 'hub');
  var cam = T.specTopoAdd(t, e1.id, 'camera');
  return { t: t, pc: pc, e1: e1, e2: e2, slot: slot, mc: mc, d1: d1, d2: d2, a1: a1, a2: a2, hub: hub, cam: cam };
}

test('추가 — 형제 수로 이름 번호', function () {
  var b = build();
  assert.strictEqual(b.e1.name, 'Ethernet #1');
  assert.strictEqual(b.e2.name, 'Ethernet #2');
  assert.strictEqual(b.a1.name, 'X 축');
  assert.strictEqual(b.a1.ord, 1); assert.strictEqual(b.a2.ord, 2);
});

test('평평하게 · 깊이 · 경로', function () {
  var b = build(), flat = T.specTopoFlat(b.t);
  assert.strictEqual(flat[0].n.id, b.pc.id); assert.strictEqual(flat[0].depth, 0);
  var a1 = flat.filter(function (x) { return x.n.id === b.a1.id; })[0];
  assert.strictEqual(a1.depth, 4);
  assert.deepStrictEqual(T.specTopoPath(b.t, b.a1.id).map(function (n) { return n.kind; }), ['pc', 'pcie', 'motion', 'drive']);
});

test('축 정보 · 순서 바꾸기', function () {
  var b = build(), inf = T.specTopoAxisInfo(b.t, b.a2);
  assert.strictEqual(inf.drive.id, b.d2.id); assert.strictEqual(inf.ch, 'CH1'); assert.strictEqual(inf.ctrl.id, b.mc.id); assert.strictEqual(inf.port.id, b.slot.id);
  assert.ok(T.specTopoAxisMove(b.t, b.a2.id, -1));
  assert.deepStrictEqual(T.specTopoAxes(b.t).map(function (n) { return n.id; }), [b.a2.id, b.a1.id]);
  assert.strictEqual(b.a2.ord, 1);
});

test('위아래 · 들이기 · 내기 · 다른 부모 (고리 거절)', function () {
  var b = build(), t = b.t;
  assert.ok(T.specTopoMove(t, b.e2.id, -1));
  assert.strictEqual(T.specTopoChildren(t, b.pc.id)[0].id, b.e2.id);
  assert.ok(T.specTopoIndent(t, b.e1.id));   // e1 → e2 아래로
  assert.strictEqual(b.e1.parent, b.e2.id);
  assert.ok(T.specTopoOutdent(t, b.e1.id));
  assert.strictEqual(b.e1.parent, b.pc.id);
  assert.strictEqual(T.specTopoReparent(t, b.pc.id, b.a1.id), false, '자기 자손 밑으로는 못 감');
  assert.ok(T.specTopoReparent(t, b.cam.id, b.hub.id));
  assert.strictEqual(b.cam.parent, b.hub.id);
});

test('지우기 — 아래 장치 · IO 까지, 축 번호 다시', function () {
  var b = build(), t = b.t;
  T.specTopoIoAdd(t, b.mc.id, 'DI', 4);
  var n = T.specTopoRemove(t, b.d1.id);
  assert.strictEqual(n, 2);
  assert.strictEqual(b.a2.ord, 1);
  assert.strictEqual(t.io.length, 4, '모션 카드 IO 는 남음');
  T.specTopoRemove(t, b.slot.id);
  assert.strictEqual(t.io.length, 0);
});

test('복제 — 아래까지 · 새 id · 축 번호 이어서', function () {
  var b = build(), t = b.t, before = t.nodes.length;
  var c = T.specTopoDup(t, b.d1.id);
  assert.strictEqual(t.nodes.length, before + 2);
  assert.notStrictEqual(c.id, b.d1.id);
  assert.deepStrictEqual(T.specTopoAxes(t).map(function (n) { return n.ord; }), [1, 2, 3]);
});

test('IO — 주소 자동(16진) · 장치별 모음 · 넘침 · 중복', function () {
  var b = build(), t = b.t, io = T.specTopoAdd(t, b.slot.id, 'iocard');
  io.pts = 16;
  var a = T.specTopoIoAdd(t, io.id, 'DI', 16);
  assert.strictEqual(a[0].addr, 'X000'); assert.strictEqual(a[15].addr, 'X00F');
  var c = T.specTopoIoAdd(t, io.id, 'DO', 2);
  assert.strictEqual(c[0].addr, 'Y000');
  var d = T.specTopoIoAdd(t, b.mc.id, 'DI', 2);
  assert.strictEqual(d[0].addr, 'X010', '다른 장치라도 이어서');
  var s = T.specTopoIoSummary(t).filter(function (x) { return x.n.id === io.id; })[0];
  assert.strictEqual(s.used, 18); assert.ok(s.over);
  t.io[1].addr = 'X000';
  assert.ok(T.specTopoIoDup(t).X000);
  assert.ok(T.specTopoChecks(t).some(function (m) { return /IO 주소 중복/.test(m); }));
  assert.ok(T.specTopoChecks(t).some(function (m) { return /18점 > 16점/.test(m); }));
});

test('확인 — 제어기 밖의 축 · 채널 중복', function () {
  var b = build(), t = b.t;
  b.d2.port = 'CH0';
  var lone = T.specTopoAdd(t, b.pc.id, 'axis');
  var ck = T.specTopoChecks(t);
  assert.ok(ck.some(function (m) { return /채널 중복/.test(m); }));
  assert.ok(ck.some(function (m) { return m.indexOf(lone.name) >= 0 && /모션 카드/.test(m); }));
});

test('다듬기 — 고리 · 없는 부모 · 남의 IO 정리', function () {
  var t = T.specTopoNorm({ nodes: [{ id: 'a', parent: 'b', kind: 'pc' }, { id: 'b', parent: 'a', kind: 'eth' }, { id: 'c', parent: 'zz', kind: 'nope' }], io: [{ id: 'i', node: 'q', dir: 'DI' }, { id: 'j', node: 'a', dir: 'XX' }] });
  assert.ok(t.nodes.filter(function (n) { return !n.parent; }).length >= 2);
  assert.strictEqual(T.specTopoNode(t, 'c').kind, 'device');
  assert.strictEqual(t.io.length, 1); assert.strictEqual(t.io[0].dir, 'DI');
  assert.strictEqual(T.specTopoFlat(t).length, 3, '모두 보임');
});

test('사양 값으로 초안', function () {
  var t = T.specTopoSeed({ values: { ipc_model: 'IPC-610', ipc_lan: '2', mc_vendor: 'Ajinextek', mc_model: 'PCIe-Rxx04', mc_form: 'PCIe 보드', mc_axes: '4', mc_qty: '1', io_model: 'DIO-32', io_in_cards: '1', io_form: 'PCIe 보드', mp_vendor: 'Moxa', mp_ports: '4', mp_qty: '1', hub_model: 'TL-SG105',
    ext_devices: [{ id: 'r1', name: '얼라인 카메라', iface: 'Ethernet' }, { id: 'r2', name: '레이저 변위센서', iface: 'RS-232C', port: 'COM3' }],
    axes: [{ id: 'x', name: 'X', ch: '0', drv_model: 'L7', motor_type: 'AC 서보' }, { id: 'y', name: 'Y', ch: '1' }] } });
  var kinds = t.nodes.map(function (n) { return n.kind; });
  ['pc', 'eth', 'pcie', 'motion', 'iocard', 'multiport', 'sport', 'hub', 'camera', 'ctrl', 'drive', 'axis'].forEach(function (k) { assert.ok(kinds.indexOf(k) >= 0, k); });
  var laser = t.nodes.filter(function (n) { return n.name === '레이저 변위센서'; })[0];
  assert.strictEqual(T.specTopoNode(t, laser.parent).kind, 'sport', '시리얼 장치는 멀티포트 포트로');
  var cam = t.nodes.filter(function (n) { return n.kind === 'camera'; })[0];
  assert.strictEqual(T.specTopoNode(t, cam.parent).kind, 'hub');
  assert.deepStrictEqual(T.specTopoAxes(t).map(function (n) { return n.name; }), ['X', 'Y']);
  assert.strictEqual(T.specTopoAxisInfo(t, T.specTopoAxes(t)[0]).ch, 'CH0');
});

test('배치 · SVG · 내보내기 표', function () {
  var b = build(), t = b.t, mp = T.specTopoAdd(t, b.slot.id, 'multiport');
  for (var i = 0; i < 8; i++) T.specTopoAdd(t, mp.id, 'sport');
  var L = T.specTopoLayout(t);
  assert.strictEqual(L.boxes.length, t.nodes.length);
  var ports = L.boxes.filter(function (x) { return x.n.kind === 'sport'; });
  assert.ok(ports.every(function (p) { return p.x === ports[0].x; }), '잎이 여럿이면 세로로 쌓음');
  assert.ok(L.bus && L.bus.x2 > L.bus.x1, '장치 인터페이스 띠');
  var pcB = L.boxes.filter(function (x) { return x.pc; })[0], ethB = L.boxes.filter(function (x) { return x.n.id === b.e1.id; })[0];
  assert.ok(ethB.y > pcB.y + pcB.h, '포트는 PC 아래');
  var svg = T.specTopoSvg(t, { sel: b.mc.id });
  assert.ok(/<svg/.test(svg) && /장치 인터페이스/.test(svg) && svg.indexOf('data-id="' + b.mc.id + '"') > 0);
  b.mc.name = '<script>'; assert.ok(T.specTopoSvg(t).indexOf('<script>') < 0, '이름은 글자 그대로');
  var R = T.specTopoRows(t);
  assert.strictEqual(R.devices.length, t.nodes.length + 1);
  assert.strictEqual(R.axes.length, 3);
  b.mc.fold = true;
  var L2 = T.specTopoLayout(t);
  assert.ok(L2.boxes.length < L.boxes.length, '접으면 아래는 안 그림');
});

test('거르기 — 고른 계통 · 그 아래 · 위로 가는 길만', function () {
  var b = build(), t = b.t;
  var on = T.specTopoFocus(t, 'eth');
  assert.ok(on[b.e1.id] && on[b.cam.id] && on[b.hub.id] && on[b.pc.id], 'Ethernet 가지 + PC');
  assert.ok(!on[b.mc.id] && !on[b.a1.id], '모션은 흐리게');
  var m = T.specTopoFocus(t, 'motion');
  assert.ok(m[b.a1.id] && m[b.slot.id] && m[b.pc.id] && !m[b.e1.id]);
  var q = T.specTopoFocus(t, '', 'hub');
  assert.ok(q[b.hub.id] && q[b.e2.id] && !q[b.e1.id]);
  assert.strictEqual(T.specTopoFocus(t, '', ''), null);
  var svg = T.specTopoSvg(t, { focus: on });
  assert.ok((svg.match(/opacity="\.16"/g) || []).length >= 4);
  assert.strictEqual(T.specTopoFilterCount(t, 'eth'), 3);
});

test('빠른 추가 — PC → PCIe → 프레임 그래버 → 카메라 같은 사슬', function () {
  var t = T.specTopoNorm({});
  T.specTopoPreset(t, 'vision');
  var cam = t.nodes.filter(function (n) { return n.kind === 'camera'; })[0];
  assert.deepStrictEqual(T.specTopoPath(t, cam.id).map(function (n) { return n.kind; }), ['pc', 'pcie', 'grabber']);
  T.specTopoPreset(t, 'motion');
  assert.strictEqual(T.specTopoAxes(t).length, 4);
  assert.strictEqual(T.specTopoAxisInfo(t, T.specTopoAxes(t)[3]).ch, 'CH3');
  T.specTopoPreset(t, 'serial');
  assert.strictEqual(t.nodes.filter(function (n) { return n.kind === 'sport'; }).length, 8);
  T.specTopoPreset(t, 'io');
  assert.strictEqual(t.io.length, 32);
  var mc = t.nodes.filter(function (n) { return n.kind === 'motion'; })[0];
  T.specTopoPreset(t, 'axes', mc.id);
  assert.strictEqual(T.specTopoAxes(t).length, 5, '고른 카드 아래 축 하나 더');
  assert.strictEqual(T.specTopoChildren(t, null).length, 1, 'PC 하나 아래로');
});

test('디스플레이 — HDMI · DP → 변환 잭 → 케이블 · 길이 → 모니터', function () {
  var t = T.specTopoNorm({});
  T.specTopoPreset(t, 'mondp'); T.specTopoPreset(t, 'mon');
  var M = T.specTopoMonitors(t);
  assert.strictEqual(M.length, 2);
  assert.strictEqual(M[0].port.kind, 'dp'); assert.deepStrictEqual(M[0].adapters, ['DP → HDMI']); assert.strictEqual(M[0].input, 'HDMI 1');
  assert.ok(M[0].cables.join(' ').indexOf('HDMI 3m') >= 0);
  assert.strictEqual(M[1].port.kind, 'hdmi');
  var R = T.specTopoRows(t);
  assert.strictEqual(R.monitors.length, 3);
  var L = T.specTopoLayout(t), dpB = L.boxes.filter(function (b) { return b.n.kind === 'dp'; })[0];
  assert.ok(dpB.port, '영상 포트도 포트 모양');
  assert.ok(L.edges.some(function (e) { return /HDMI 1 · HDMI 3m/.test(e.label || ''); }), '줄 꼬리표에 입력 포트 · 케이블 · 길이');
  var on = T.specTopoFocus(t, 'display'); assert.ok(on && Object.keys(on).length >= 5);
  var lone = T.specTopoAdd(t, null, 'monitor');
  assert.ok(T.specTopoChecks(t).some(function (m) { return m.indexOf(lone.name) >= 0; }));
  var svg = T.specTopoSvg(t); assert.ok(/<path d="M3 4h18v12H3z/.test(svg), '모니터 선 아이콘');
  assert.ok(!/🖵|📷|🖥/.test(svg), '구성도에 이모지 없음');
  assert.ok(Object.keys(T.TOPO_KINDS).every(function (k) { return T.TOPO_ICONS[k]; }), '모든 종류에 아이콘');
});
