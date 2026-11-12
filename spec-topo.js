/* spec-topo.js — 🧩 장치 계층 구성 (v13.449)
 *   PC → 포트(Ethernet · PoE · USB · COM · PCI/PCIe 슬롯) → 카드 · 허브 · 변환기 · 시리얼 서버 → 컨트롤러 · 드라이브 → 액추에이터(축)
 *   를 하나의 나무(sheet.topo)로 두고, 같은 데이터를 네 화면으로 보여 준다.
 *     ① 계층 구성도  PPT 처럼 위에 PC, 가로 '장치 인터페이스' 띠에서 포트마다 내려가 가지를 침 (SVG · 눌러서 고르기 · 크게 보기)
 *     ② 장치 목록    들여쓰기 표 — 종류 · 이름(바꿀 수 있음) · 모델 · 포트/채널 · 주소 · 비고, ＋하위 · ↑↓ · 들이기/내기 · 복제 · 지우기
 *     ③ 축 순서      액추에이터(축)만 모아 순서(축 번호) · 연결 경로(카드 › 채널 › 드라이브) 한눈에, ↑↓ 로 순서 바꿈
 *     ④ IO 리스트    IO 카드 · 리모트 IO · 모션 카드 등 장치마다 DI/DO/AI/AO 점(주소 자동 · 16점씩 추가)
 *
 *   저장: sheet.topo = { v:1, nodes:[{ id, parent, kind, name, model, port, addr, note, ord?, pts? }], io:[{ id, node, dir, addr, name, desc, dev }] }
 *         사양서와 함께 PATCH ['topo'] 통째 (server/lib/spec-patch.js · spec-schema.js specDiff)
 *   순수 로직(specTopo*)은 node 시험 가능 (test/spec-topo.test.js) · 화면(psTopo*)은 project-spec.js 의 _ps 를 씀
 */
/* ── 종류 ─────────────────────────────────────────────────────────────── */
var TOPO_CATS = {
  pc:     { label: 'PC',          fill: '#334155', soft: '#e2e8f0' },
  port:   { label: '포트 · 슬롯', fill: '#d97706', soft: '#fef3c7' },
  card:   { label: '보드 · 카드', fill: '#4f46e5', soft: '#e0e7ff' },
  net:    { label: '네트워크',    fill: '#0d9488', soft: '#ccfbf1' },
  serial: { label: '시리얼',      fill: '#ea580c', soft: '#ffedd5' },
  ctrl:   { label: '컨트롤러',    fill: '#7c3aed', soft: '#ede9fe' },
  drive:  { label: '드라이브',    fill: '#2563eb', soft: '#dbeafe' },
  axis:   { label: '액추에이터',  fill: '#16a34a', soft: '#dcfce7' },
  vision: { label: '비전',        fill: '#0891b2', soft: '#cffafe' },
  io:     { label: 'IO',          fill: '#e11d48', soft: '#ffe4e6' },
  dport:  { label: '영상 포트',   fill: '#c026d3', soft: '#fae8ff' },
  display:{ label: '디스플레이',  fill: '#c026d3', soft: '#fae8ff' },
  etc:    { label: '기타',        fill: '#64748b', soft: '#f1f5f9' }
};
// kind: [이름, 무리, 아이콘, 기본 이름, 포트 칸 안내, 아래에 흔히 붙는 것]
var TOPO_KINDS = {
  pc:        ['PC · IPC',             'pc',     '🖥', '제어 PC',        '',             ['eth', 'poe', 'usb', 'com', 'pcie', 'pci', 'hdmi', 'dp', 'vga', 'dvi']],
  hdmi:      ['HDMI 포트',            'dport',  '▭', 'HDMI #1',        '그래픽 · 메인보드', ['monitor', 'adapter']],
  dp:        ['DisplayPort',          'dport',  '▭', 'DP #1',          '그래픽 · 메인보드', ['adapter', 'monitor']],
  vga:       ['VGA 포트',             'dport',  '▭', 'VGA #1',         '그래픽 · 메인보드', ['monitor', 'adapter']],
  dvi:       ['DVI 포트',             'dport',  '▭', 'DVI #1',         '그래픽 · 메인보드', ['adapter', 'monitor']],
  adapter:   ['변환 잭 · 젠더',       'display','⇄', 'DP → HDMI',      '',             ['monitor', 'adapter']],
  monitor:   ['모니터',               'display','🖵', '모니터',         '입력 (HDMI 1)', []],
  eth:       ['Ethernet 포트',        'port',   '🔌', 'Ethernet #1',    'NIC · IP',     ['hub', 'nport', 'camera', 'ectmaster', 'ctrl', 'plc', 'robot', 'device']],
  poe:       ['PoE 포트',             'port',   '⚡', 'PoE #1',         'NIC · IP',     ['camera', 'device']],
  usb:       ['USB 포트',             'port',   '🔗', 'USB #1',         'USB 2.0/3.0',  ['usbser', 'camera', 'ctrl', 'device']],
  com:       ['COM 포트 (RS-232C)',   'port',   '🔁', 'COM1',           'COM 번호',     ['ctrl', 'device']],
  pcie:      ['PCIe 슬롯',            'port',   '🧩', 'PCIe #1',        'x1 · x4 · x8', ['baseboard', 'motion', 'hyperwire', 'grabber', 'iocard', 'multiport', 'lancard']],
  pci:       ['PCI 슬롯',             'port',   '🧩', 'PCI #1',         '',             ['baseboard', 'motion', 'iocard', 'multiport', 'grabber']],
  baseboard: ['아진 베이스보드',      'card',   '🧩', '아진 베이스보드', '슬롯',        ['motion', 'iocard', 'drive']],   // v13.450 Ajinextek 베이스보드 — 모션 · IO 모듈을 꽂는 보드
  motion:    ['모션 카드',            'card',   '🎛', '모션 카드',      '슬롯',         ['axisch', 'drive', 'iocard']],
  hyperwire: ['HyperWire 카드',       'card',   '🛰', 'HyperWire 카드', '슬롯',         ['drive', 'ctrl']],
  grabber:   ['프레임 그래버',        'card',   '🎞', 'Frame Grabber',  '슬롯',         ['camera']],
  iocard:    ['IO 카드',              'io',     '🔢', 'IO 카드',        '슬롯',         []],
  multiport: ['멀티포트 카드 (Moxa 등)', 'card', '🔀', '멀티포트 카드',  '슬롯',         ['sport']],
  lancard:   ['LAN 카드',             'card',   '🌐', 'LAN 카드',       '슬롯',         ['hub', 'camera', 'device']],
  hub:       ['스위칭 허브',          'net',    '🔀', 'Switching Hub',  '포트',         ['ctrl', 'camera', 'nport', 'plc', 'robot', 'device']],
  nport:     ['시리얼 서버 (Moxa NPort)', 'serial', '🧷', 'Moxa NPort',  'IP',           ['sport']],
  usbser:    ['USB → 시리얼 변환',    'serial', '🔄', 'USB to RS-485',  'COM 번호',     ['sport', 'ctrl']],
  sport:     ['시리얼 포트',          'serial', '🔁', 'Port 1',         'COM 번호',     ['ctrl', 'device']],
  ectmaster: ['EtherCAT 마스터',      'net',    '🔗', 'EtherCAT',       '',             ['drive', 'iomod']],
  axisch:    ['축 채널',              'card',   '#',  'CH0',            '채널',         ['drive']],
  drive:     ['드라이브 · 앰프',      'drive',  '⚙', '드라이브',       '채널 · 국번',  ['axis']],
  axis:      ['액추에이터 · 모션 축', 'axis',   '↔', 'X 축',           '채널',         []],
  ctrl:      ['컨트롤러',             'ctrl',   '🎚', '컨트롤러',       '포트 · 국번',  ['axis', 'device']],
  plc:       ['PLC',                  'ctrl',   '🧠', 'PLC',            'IP · 국번',    ['iomod', 'device']],
  robot:     ['로봇',                 'ctrl',   '🦾', '로봇',           'IP',           []],
  camera:    ['카메라',               'vision', '📷', '카메라',         'IP · 포트',    []],
  iomod:     ['리모트 IO 모듈',       'io',     '🔢', '리모트 IO',      '국번',         []],
  light:     ['조명 컨트롤러',        'vision', '💡', '조명 컨트롤러',  '채널 · COM',   []],   // v13.479 자주 쓰는 종류 추가
  barcode:   ['바코드 리더',          'vision', '▥', '바코드 리더',    'IP · COM',     []],
  laser:     ['레이저 · 변위 센서',   'vision', '✴', '변위 센서',      'IP · COM',     []],
  sensor:    ['센서',                 'io',     '◉', '센서',           '채널',         []],
  valve:     ['밸브 · 실린더',        'io',     '⇵', '솔레노이드 밸브', '채널',        []],
  lamp:      ['타워 램프 · 부저',     'io',     '🚨', '타워 램프',      '채널',         []],
  hmi:       ['터치 패널 · HMI',      'display','▣', '터치 패널',      'IP · COM',     []],
  power:     ['전원 · UPS',           'etc',    '⏻', '전원',           '',             []],
  device:    ['기타 장치',            'etc',    '📦', '장치',           '포트',         []]
};
var TOPO_KIND_ORDER = ['pc', 'eth', 'poe', 'usb', 'com', 'pcie', 'pci', 'hdmi', 'dp', 'vga', 'dvi', 'adapter', 'monitor', 'baseboard', 'motion', 'hyperwire', 'grabber', 'iocard', 'multiport', 'lancard', 'hub', 'nport', 'usbser', 'sport', 'ectmaster', 'axisch', 'drive', 'axis', 'ctrl', 'plc', 'robot', 'camera', 'light', 'barcode', 'laser', 'iomod', 'sensor', 'valve', 'lamp', 'hmi', 'power', 'device'];
var TOPO_IO_KINDS = { iocard: 1, iomod: 1, motion: 1, plc: 1, ectmaster: 1, ctrl: 1 };   // IO 리스트를 둘 수 있는 장치 (그 밖도 고를 수 있음)
var TOPO_IO_DIRS = ['DI', 'DO', 'AI', 'AO'];
var TOPO_IO_PREFIX = { DI: 'X', DO: 'Y', AI: 'AI', AO: 'AO' };
var TOPO_MAX_NODES = 600, TOPO_MAX_IO = 4000;

function _tpStr(v) { return v == null ? '' : String(v); }
function _tpId(p) { return (p || 'n') + '-' + Math.random().toString(36).slice(2, 10); }
function topoKind(k) { var d = TOPO_KINDS[k] || TOPO_KINDS.device; return { key: TOPO_KINDS[k] ? k : 'device', label: d[0], cat: d[1], icon: d[2], dflt: d[3], portHint: d[4], next: d[5] }; }
function topoCat(k) { return TOPO_CATS[topoKind(k).cat] || TOPO_CATS.etc; }
/* v13.479 장치마다 바꿀 수 있는 것 — n.kl 종류 이름(직접) · n.cat 분류(색) · n.ico 아이콘. 화면 · 그림은 이것으로 (구조 판단은 여전히 n.kind) */
function topoKindN(n) {
  var K = topoKind(n && n.kind);
  if (n && n.kl) { K.label = n.kl; K.dflt = n.kl; }
  if (n && n.cat && TOPO_CATS[n.cat]) K.cat = n.cat;
  K.ico = n && n.ico && TOPO_ICONS[n.ico] ? n.ico : K.key;
  return K;
}
function topoCatN(n) { return TOPO_CATS[topoKindN(n).cat] || TOPO_CATS.etc; }
/** 분류마다 기본 아이콘 (직접 만든 항목의 처음 아이콘) */
var TOPO_CAT_ICON = { pc: 'pc', port: 'eth', card: 'pcie', net: 'hub', serial: 'sport', ctrl: 'ctrl', drive: 'drive', axis: 'axis', vision: 'camera', io: 'iomod', dport: 'hdmi', display: 'monitor', etc: 'device' };

/* ── 선 아이콘 (24 칸 · 굵기 1.8) — 화면 · 구성도 · 내려받은 그림이 같은 모양 (이모지는 기기마다 달라 안 씀) ── */
var TOPO_ICONS = {
  pc: 'M2 5h12v9H2z M6 18h4 M8 14v4 M17 4h5v16h-5z M19 8h1',
  eth: 'M5 5h14v10H5z M8 15v4h8v-4 M8 9h1 M11 9h2 M15 9h1',
  poe: 'M13 2 4 14h7l-1 8 9-12h-7z',
  usb: 'M12 3v13 M9 6l3-3 3 3 M6 10v2l6 4 M18 9v2l-6 4 M12 16.5a2 2 0 1 0 .01 0',
  com: 'M3 7h18l-2 10H5z M7 11h.01 M10 11h.01 M13 11h.01 M16 11h.01 M8.5 14h.01 M11.5 14h.01 M14.5 14h.01',
  pcie: 'M3 6h18v10H3z M5 16v3 M9 16v3 M13 16v3 M17 16v3 M7 9h6v4H7z',
  pci: 'M3 6h18v10H3z M6 16v3 M10 16v3 M14 16v3 M7 9h6v4H7z',
  baseboard: 'M2 5h20v12H2z M5 17v3 M9 17v3 M13 17v3 M17 17v3 M5 8h5v6H5z M12 8h5v6h-5z M19 9v4',
  motion: 'M7 7h10v10H7z M10 3v4 M14 3v4 M10 17v4 M14 17v4 M3 10h4 M3 14h4 M17 10h4 M17 14h4',
  hyperwire: 'M3 12h4l2-5 4 10 2-5h6',
  grabber: 'M3 5h18v14H3z M7 5v14 M17 5v14 M3 9h4 M3 15h4 M17 9h4 M17 15h4',
  iocard: 'M4 4h16v16H4z M8 8h.01 M12 8h.01 M16 8h.01 M8 12h.01 M12 12h.01 M16 12h.01 M8 16h.01 M12 16h.01 M16 16h.01',
  multiport: 'M3 12h6 M9 12l5-6h7 M9 12h12 M9 12l5 6h7',
  lancard: 'M3 6h18v10H3z M5 16v3 M9 16v3 M13 16v3 M14 9h4v4h-4z',
  hub: 'M3 8h18v8H3z M6 12h.01 M9 12h.01 M12 12h.01 M15 12h.01 M18 12h.01',
  nport: 'M4 6h16v12H4z M8 10h8 M8 14h5',
  usbser: 'M3 12h11 M10 8l4 4-4 4 M18 6v12',
  sport: 'M5 8h14l-2 8H7z M9 12h.01 M12 12h.01 M15 12h.01',
  ectmaster: 'M10 14a4 4 0 0 1 0-6l2-2a4 4 0 0 1 6 6l-1 1 M14 10a4 4 0 0 1 0 6l-2 2a4 4 0 0 1-6-6l1-1',
  axisch: 'M9 4 7 20 M17 4l-2 16 M4 9h16 M3 15h16',
  drive: 'M5 3h14v18H5z M8 7h8 M8 12c1.3-2 2.7 2 4 0s2.7 2 4 0 M9 17h6',
  axis: 'M2 12h20 M5 9l-3 3 3 3 M19 9l3 3-3 3 M9 8h6v8H9z',
  ctrl: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  plc: 'M4 4h6v16H4z M14 4h6v16h-6z M6 8h2 M6 12h2 M16 8h2 M16 12h2',
  robot: 'M4 20h8 M8 20v-4 M8 16l4-7 M12 9l6 2 M18 11v3 M6 16h4',
  camera: 'M3 7h4l2-2h6l2 2h4v12H3z M12 9.5a3.5 3.5 0 1 0 .01 0',
  iomod: 'M5 3h14v18H5z M9 7h.01 M15 7h.01 M9 11h.01 M15 11h.01 M9 15h.01 M15 15h.01',
  device: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  hdmi: 'M3 8h18v5l-3 3H6l-3-3z M7 11h10',
  dp: 'M4 8h16v8H7l-3-3z M8 12h8',
  vga: 'M3 7h18l-2 10H5z M7 10h.01 M10 10h.01 M13 10h.01 M16 10h.01 M8 12.5h.01 M11 12.5h.01 M14 12.5h.01 M8.5 15h.01 M12 15h.01 M15.5 15h.01',
  dvi: 'M3 8h18v8H3z M6 11h1 M9 11h1 M12 11h1 M6 13h1 M9 13h1 M12 13h1 M16 10v4',
  adapter: 'M2 9h6v6H2z M8 12h8 M16 9h6v6h-6z M11 10l2 2-2 2',
  monitor: 'M3 4h18v12H3z M9 20h6 M12 16v4',
  light: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  barcode: 'M4 6v12 M7 6v12 M10 6v9 M13 6v12 M16 6v9 M20 6v12 M10 18h.01 M16 18h.01',
  laser: 'M2 9h9v6H2z M11 12h3 M17 12h.01 M21 12h.01 M17 7l1.5 1.5 M17 17l1.5-1.5',
  sensor: 'M12 10a2 2 0 1 0 .01 0 M7.8 16.2a6 6 0 0 1 0-8.4 M16.2 7.8a6 6 0 0 1 0 8.4 M5 19a10 10 0 0 1 0-14 M19 5a10 10 0 0 1 0 14',
  valve: 'M3 8l9 4-9 4z M21 8l-9 4 9 4z M12 12V5 M9 5h6',
  lamp: 'M9 3h6v5H9z M9 8h6v5H9z M9 13h6v5H9z M7 21h10 M12 18v3',
  hmi: 'M3 4h18v13H3z M8 21h8 M12 17v4 M7 8h4v5H7z M14 8h3 M14 11h3',
  power: 'M12 3v9 M6.3 6.3a8 8 0 1 0 11.4 0',
  cylinder: 'M3 9h12v6H3z M15 12h6 M21 9v6 M6 9v6',
  temp: 'M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z M12 9v8',
  scale: 'M4 20h16 M6 20l2-9h8l2 9 M9 11V7h6v4 M12 14v3',
  stage: 'M3 15h18v4H3z M7 15v-4h10v4 M10 11V7h4v4',
  dongle: 'M8 12a4 4 0 1 0 .01 0 M11 13l9-9 M16 8l3 3 M14 10l2 2',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  buzzer: 'M4 9h4l5-4v14l-5-4H4z M17 9a4 4 0 0 1 0 6',
  fan: 'M12 12a1.5 1.5 0 1 0 .01 0 M12 10.5c-1-4 1-7 4-7 1 3-1 6-4 7z M13.5 12c4-1 7 1 7 4-3 1-6-1-7-4z M12 13.5c1 4-1 7-4 7-1-3 1-6 4-7z M10.5 12c-4 1-7-1-7-4 3-1 6 1 7 4z',
  gear: 'M12 9a3 3 0 1 0 .01 0 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  cloud: 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9.5 4.2 4.2 0 0 1 17.5 18z',
  wifi: 'M2 9a15 15 0 0 1 20 0 M5.5 12.5a10 10 0 0 1 13 0 M9 16a5 5 0 0 1 6 0 M12 19.5h.01',
  keyboard: 'M2 6h20v12H2z M6 10h.01 M10 10h.01 M14 10h.01 M18 10h.01 M7 14h10',
  printer: 'M6 9V3h12v6 M6 18H3V9h18v9h-3 M6 14h12v7H6z',
  safety: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4'
};
/** 아이콘 SVG — x · y 왼쪽 위 · s 크기(px) · c 색 (구성도 안에 넣을 때는 opt.g, 화면에 따로 쓸 때는 svg 로 감쌈) */
function topoIconSvg(kind, s, c, x, y, inG) {
  var d = TOPO_ICONS[kind] || TOPO_ICONS.device, k = (s || 16) / 24;
  var p = '<path d="' + d + '" fill="none" stroke="' + (c || 'currentColor') + '" stroke-width="' + (1.95 / Math.max(k, .5)).toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"/>';
  if (inG) return '<g transform="translate(' + (x || 0) + ' ' + (y || 0) + ') scale(' + k.toFixed(3) + ')">' + p + '</g>';
  return '<svg class="tp-ic" viewBox="0 0 24 24" width="' + (s || 16) + '" height="' + (s || 16) + '" aria-hidden="true">' + p + '</svg>';
}

/* ── 다듬기 · 기본 ─────────────────────────────────────────────────────── */
/** 저장된 것 → 쓸 수 있는 모양 (부모가 없거나 고리가 생긴 노드는 맨 위로) */
function specTopoNorm(t) {
  t = t && typeof t === 'object' ? t : {};
  var nodes = (Array.isArray(t.nodes) ? t.nodes : []).filter(function (n) { return n && n.id; }).slice(0, TOPO_MAX_NODES).map(function (n) {
    var o = { id: _tpStr(n.id).slice(0, 40), parent: n.parent ? _tpStr(n.parent).slice(0, 40) : null, kind: TOPO_KINDS[n.kind] ? n.kind : 'device', name: _tpStr(n.name).slice(0, 80), model: _tpStr(n.model).slice(0, 80), port: _tpStr(n.port).slice(0, 40), addr: _tpStr(n.addr).slice(0, 60), note: _tpStr(n.note).slice(0, 200) };
    if (n.cable) o.cable = _tpStr(n.cable).slice(0, 40);   // 위 장치와 잇는 케이블 종류 (HDMI · LAN Cat6 · RS-232C …)
    if (n.len) o.len = _tpStr(n.len).slice(0, 20);         // 케이블 길이 (3m)
    if (n.ord != null && n.ord !== '' && isFinite(+n.ord)) o.ord = +n.ord;
    if (n.pts != null && n.pts !== '' && isFinite(+n.pts)) o.pts = Math.max(0, Math.min(9999, Math.round(+n.pts)));
    if (n.fold) o.fold = true;
    if (n.kl && _tpStr(n.kl).trim()) o.kl = _tpStr(n.kl).trim().slice(0, 30);
    if (n.cat && TOPO_CATS[n.cat]) o.cat = n.cat;
    if (n.ico && TOPO_ICONS[n.ico]) o.ico = n.ico;
    return o;
  });
  var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
  nodes.forEach(function (n) {
    if (n.parent && !byId[n.parent]) n.parent = null;
    var seen = {}, p = n.parent;   // 고리 끊기
    while (p) { if (p === n.id || seen[p]) { n.parent = null; break; } seen[p] = 1; p = byId[p] ? byId[p].parent : null; }
  });
  var io = (Array.isArray(t.io) ? t.io : []).filter(function (r) { return r && r.id && byId[r.node]; }).slice(0, TOPO_MAX_IO).map(function (r) {
    return { id: _tpStr(r.id).slice(0, 40), node: _tpStr(r.node), dir: TOPO_IO_DIRS.indexOf(r.dir) >= 0 ? r.dir : 'DI', addr: _tpStr(r.addr).slice(0, 20), name: _tpStr(r.name).slice(0, 80), desc: _tpStr(r.desc).slice(0, 200), dev: _tpStr(r.dev).slice(0, 80) };
  });
  return { v: 1, nodes: nodes, io: io };
}
function specTopoEmpty(t) { return !t || !t.nodes || !t.nodes.length; }
function specTopoChildren(t, id) { return t.nodes.filter(function (n) { return (n.parent || null) === (id || null); }); }
function specTopoNode(t, id) { for (var i = 0; i < t.nodes.length; i++) if (t.nodes[i].id === id) return t.nodes[i]; return null; }
/** 이름 — 비었으면 종류의 기본 이름 */
function specTopoName(n) { return _tpStr(n && n.name).trim() || topoKindN(n).dflt; }
/** 위에서부터 차례 (들여쓰기 깊이 포함) — 목록 · 내보내기 */
function specTopoFlat(t, opt) {
  var out = [], fold = opt && opt.fold;
  (function walk(pid, d) {
    specTopoChildren(t, pid).forEach(function (n) {
      var kids = specTopoChildren(t, n.id).length;
      out.push({ n: n, depth: d, kids: kids });
      if (!(fold && n.fold)) walk(n.id, d + 1);
    });
  })(null, 0);
  return out;
}
/** 위로 올라가는 길 (자기 제외) — '모션 카드 › CH1 › 드라이브' */
function specTopoPath(t, id) {
  var out = [], n = specTopoNode(t, id), guard = 0;
  n = n && n.parent ? specTopoNode(t, n.parent) : null;
  while (n && guard++ < 50) { out.unshift(n); n = n.parent ? specTopoNode(t, n.parent) : null; }
  return out;
}
/** 노드 추가 — 같은 종류 형제 수를 보고 이름에 번호 (Ethernet #2, COM2, CH1 …) */
function specTopoAdd(t, parentId, kind, after) {
  if (t.nodes.length >= TOPO_MAX_NODES) return null;
  var K = topoKind(kind), sib = specTopoChildren(t, parentId).filter(function (x) { return x.kind === K.key; }).length;
  var nm = K.dflt;
  if (/#1$/.test(nm)) nm = nm.replace(/#1$/, '#' + (sib + 1));
  else if (/^COM1$/.test(nm)) nm = 'COM' + (sib + 1);
  else if (/^Port 1$/.test(nm)) nm = 'Port ' + (sib + 1);
  else if (/^(HDMI|DP|VGA|DVI) #1$/.test(nm)) nm = nm.replace(/#1$/, '#' + (sib + 1));
  else if (/^CH0$/.test(nm)) nm = 'CH' + sib;
  else if (K.key === 'axis') nm = ['X', 'Y', 'Z', 'T', 'U', 'V', 'W', 'R'][sib] ? ['X', 'Y', 'Z', 'T', 'U', 'V', 'W', 'R'][sib] + ' 축' : '축 ' + (sib + 1);
  else if (sib) nm = K.dflt + ' ' + (sib + 1);
  var n = { id: _tpId('n'), parent: parentId || null, kind: K.key, name: nm, model: '', port: '', addr: '', note: '' };
  if (K.key === 'axis') n.ord = specTopoAxes(t).length + 1;
  if (K.key === 'iocard' || K.key === 'iomod') n.pts = 32;
  var i = after ? t.nodes.indexOf(specTopoNode(t, after)) : -1;
  if (i >= 0) t.nodes.splice(i + 1, 0, n); else t.nodes.push(n);
  return n;
}
/** 지우기 — 아래 장치 · 그 IO 점까지 */
function specTopoRemove(t, id) {
  var gone = {}; (function mark(x) { gone[x] = 1; specTopoChildren(t, x).forEach(function (c) { mark(c.id); }); })(id);
  t.nodes = t.nodes.filter(function (n) { return !gone[n.id]; });
  t.io = t.io.filter(function (r) { return !gone[r.node]; });
  _tpRenumberAxes(t);
  return Object.keys(gone).length;
}
/** 복제 — 아래 장치까지 (IO 점은 빼고) · 바로 뒤에 */
function specTopoDup(t, id) {
  var src = specTopoNode(t, id); if (!src) return null;
  var map = {}, add = [];
  (function copy(n, parent) {
    var c = JSON.parse(JSON.stringify(n)); c.id = _tpId('n'); c.parent = parent; delete c.ord; map[n.id] = c.id; add.push(c);
    specTopoChildren(t, n.id).forEach(function (k) { copy(k, c.id); });
  })(src, src.parent || null);
  if (t.nodes.length + add.length > TOPO_MAX_NODES) return null;
  add[0].name = specTopoName(src) + ' (복사)';
  var i = t.nodes.indexOf(src); t.nodes.splice.apply(t.nodes, [i + 1, 0].concat(add));
  var base = specTopoAxes(t).length;
  add.forEach(function (c) { if (c.kind === 'axis') c.ord = ++base; });
  _tpRenumberAxes(t);
  return add[0];
}
/** 같은 부모 안에서 위 · 아래로 */
function specTopoMove(t, id, d) {
  var n = specTopoNode(t, id); if (!n) return false;
  var sib = specTopoChildren(t, n.parent), i = sib.indexOf(n), j = i + d;
  if (j < 0 || j >= sib.length) return false;
  var a = t.nodes.indexOf(n), b = t.nodes.indexOf(sib[j]);
  t.nodes[a] = sib[j]; t.nodes[b] = n;
  return true;
}
/** 들이기 — 바로 위 형제의 아래로 · 내기 — 부모와 같은 줄로(부모 바로 뒤) */
function specTopoIndent(t, id) {
  var n = specTopoNode(t, id); if (!n) return false;
  var sib = specTopoChildren(t, n.parent), i = sib.indexOf(n); if (i <= 0) return false;
  n.parent = sib[i - 1].id; sib[i - 1].fold = false;
  t.nodes.splice(t.nodes.indexOf(n), 1); t.nodes.push(n);   // 새 부모의 마지막 아이로
  return true;
}
function specTopoOutdent(t, id) {
  var n = specTopoNode(t, id); if (!n || !n.parent) return false;
  var p = specTopoNode(t, n.parent); n.parent = p ? p.parent || null : null;
  t.nodes.splice(t.nodes.indexOf(n), 1);
  var at = t.nodes.indexOf(p); t.nodes.splice(at + 1, 0, n);
  return true;
}
/** 다른 부모 밑으로 (고리가 생기면 거절) */
function specTopoReparent(t, id, parentId) {
  var n = specTopoNode(t, id); if (!n || id === parentId) return false;
  var p = parentId ? specTopoNode(t, parentId) : null;
  for (var q = p, g = 0; q && g < 60; q = q.parent ? specTopoNode(t, q.parent) : null, g++) if (q.id === id) return false;
  n.parent = parentId || null;
  t.nodes.splice(t.nodes.indexOf(n), 1); t.nodes.push(n);
  return true;
}

/* ── 빠른 추가 — 자주 쓰는 사슬을 한 번에 (PC 아래 · 또는 고른 장치 아래) ── */
var TOPO_PRESETS = [
  { key: 'vision',  label: '📷 비전 — PCIe → 프레임 그래버 → 카메라',        at: 'pc', n: 1 },
  { key: 'gige',    label: '📷 GigE 카메라 — PoE → 카메라',                    at: 'pc', n: 1 },
  { key: 'motion',  label: '🎛 모션 — PCIe → 모션 카드 → 드라이브 → 축 × 4',   at: 'pc', n: 4 },
  { key: 'ajin',    label: '🧩 아진 베이스보드 — PCIe → 베이스보드 → 모션 모듈 → 드라이브 → 축 × 4 + IO 모듈', at: 'pc', n: 4 },
  { key: 'hyper',   label: '🛰 HyperWire — PCIe → HyperWire 카드 → 드라이브 → 축 × 2', at: 'pc', n: 2 },
  { key: 'ecat',    label: '🔗 EtherCAT — Ethernet → 마스터 → 드라이브 → 축 × 4', at: 'pc', n: 4 },
  { key: 'serial',  label: '🔀 시리얼 — PCIe → 멀티포트(Moxa) → Port 1~8',     at: 'pc', n: 8 },
  { key: 'nport',   label: '🧷 Moxa NPort — Ethernet → NPort → Port 1~4',      at: 'pc', n: 4 },
  { key: 'usb485',  label: '🔄 USB → RS-485 → 컨트롤러',                        at: 'pc', n: 1 },
  { key: 'hub',     label: '🔀 Ethernet → 스위칭 허브 → 장치 × 3',              at: 'pc', n: 3 },
  { key: 'io',      label: '🔢 IO — PCIe → IO 카드 (DI 16 · DO 16)',            at: 'pc', n: 1 },
  { key: 'mon',     label: '🖵 모니터 — HDMI → 모니터 (HDMI 케이블)',             at: 'pc', n: 1 },
  { key: 'mondp',   label: '🖵 모니터 — DP → 변환 잭(DP→HDMI) → 모니터',          at: 'pc', n: 1 },
  { key: 'axes',    label: '⚙ 드라이브 → 축 (고른 카드 · 컨트롤러 아래)',      at: 'any', n: 1 }
];
/** 사슬 붙이기 — parentId 아래 (없으면 맨 위 PC 아래, PC 도 없으면 새로). 만든 첫 노드를 돌려줌 */
function specTopoPreset(t, key, parentId) {
  var pc = parentId ? specTopoNode(t, parentId) : specTopoChildren(t, null).filter(function (n) { return n.kind === 'pc'; })[0];
  if (!pc) pc = specTopoAdd(t, null, 'pc');
  var P = pc.id, A = function (par, k, name) { var x = specTopoAdd(t, par, k); if (x && name) x.name = name; return x; };
  var slotKind = pc.kind === 'pc' ? 'pcie' : null, first = null;
  function slot() { return slotKind ? A(P, slotKind) : pc; }
  function axes(par, n) { for (var i = 0; i < n; i++) { var ch = specTopoChildren(t, par).filter(function (x) { return x.kind === 'drive'; }).length; var d = A(par, 'drive', '드라이브 ' + (ch + 1)); if (!d) break; d.port = 'CH' + ch; A(d.id, 'axis'); } }
  if (key === 'vision') { var s = slot(); first = s; var g = A(s.id, 'grabber'); A(g.id, 'camera'); }
  else if (key === 'gige') { var p = pc.kind === 'pc' ? A(P, 'poe') : pc; first = p; A(p.id, 'camera'); }
  else if (key === 'ajin') { var s5 = slot(); first = s5; var bb = A(s5.id, 'baseboard'); bb.model = 'Ajinextek'; var mm = A(bb.id, 'motion', '모션 모듈'); axes(mm.id, 4); var im = A(bb.id, 'iocard', 'IO 모듈'); im.pts = 32; }
  else if (key === 'motion' || key === 'hyper') { var s2 = slot(); first = s2; var mc = A(s2.id, key === 'motion' ? 'motion' : 'hyperwire'); axes(mc.id, key === 'motion' ? 4 : 2); }
  else if (key === 'ecat') { var e = pc.kind === 'pc' ? A(P, 'eth') : pc; first = e; var m = A(e.id, 'ectmaster'); axes(m.id, 4); }
  else if (key === 'serial') { var s3 = slot(); first = s3; var mp = A(s3.id, 'multiport', 'Moxa 멀티포트'); for (var i = 0; i < 8; i++) A(mp.id, 'sport'); }
  else if (key === 'nport') { var e2 = pc.kind === 'pc' ? A(P, 'eth') : pc; first = e2; var np = A(e2.id, 'nport'); for (var j = 0; j < 4; j++) A(np.id, 'sport'); }
  else if (key === 'usb485') { var u = pc.kind === 'pc' ? A(P, 'usb') : pc; first = u; var cv = A(u.id, 'usbser'); A(cv.id, 'ctrl'); }
  else if (key === 'hub') { var e3 = pc.kind === 'pc' ? A(P, 'eth') : pc; first = e3; var h = A(e3.id, 'hub'); for (var k = 0; k < 3; k++) A(h.id, 'device'); }
  else if (key === 'io') { var s4 = slot(); first = s4; var io = A(s4.id, 'iocard'); specTopoIoAdd(t, io.id, 'DI', 16); specTopoIoAdd(t, io.id, 'DO', 16); }
  else if (key === 'axes') { axes(pc.id, 1); first = pc; }
  else if (key === 'mon') { var h1 = pc.kind === 'pc' ? A(P, 'hdmi') : pc; first = h1; var mo = A(h1.id, 'monitor'); mo.port = 'HDMI 1'; mo.cable = 'HDMI'; mo.len = '3m'; }
  else if (key === 'mondp') { var d1 = pc.kind === 'pc' ? A(P, 'dp') : pc; first = d1; var ad = A(d1.id, 'adapter'); ad.cable = '직결'; var mo2 = A(ad.id, 'monitor'); mo2.port = 'HDMI 1'; mo2.cable = 'HDMI'; mo2.len = '3m'; }
  _tpRenumberAxes(t);
  return first;
}

/* ── 축 순서 ──────────────────────────────────────────────────────────── */
/** 액추에이터(축) — 축 번호(ord) 순 */
function specTopoAxes(t) {
  var flat = specTopoFlat(t).map(function (x) { return x.n; }).filter(function (n) { return n.kind === 'axis'; });
  return flat.map(function (n, i) { return { n: n, i: i }; }).sort(function (a, b) {
    var x = a.n.ord != null ? a.n.ord : 1e9, y = b.n.ord != null ? b.n.ord : 1e9;
    return x - y || a.i - b.i;
  }).map(function (x) { return x.n; });
}
function _tpRenumberAxes(t) { specTopoAxes(t).forEach(function (n, i) { n.ord = i + 1; }); }
/** 축 순서 한 칸 위 · 아래 */
function specTopoAxisMove(t, id, d) {
  var ax = specTopoAxes(t), i = ax.map(function (n) { return n.id; }).indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= ax.length) return false;
  var tmp = ax[i]; ax[i] = ax[j]; ax[j] = tmp;
  ax.forEach(function (n, k) { n.ord = k + 1; });
  return true;
}
/** 축 하나의 연결 정보 — 경로 · 드라이브 · 채널 · 제어기 */
function specTopoAxisInfo(t, n) {
  var path = specTopoPath(t, n.id), drv = null, ch = '', ctl = null, port = null;
  for (var i = path.length - 1; i >= 0; i--) {
    var p = path[i], k = p.kind;
    if (!drv && k === 'drive') drv = p;
    if (!ch && (k === 'axisch' || k === 'drive') && (p.port || k === 'axisch')) ch = k === 'axisch' ? specTopoName(p) : p.port;
    if (!ctl && (k === 'motion' || k === 'hyperwire' || k === 'ectmaster' || k === 'ctrl' || k === 'plc')) ctl = p;
    if (!port && topoKind(k).cat === 'port') port = p;
  }
  if (!ch && n.port) ch = n.port;
  return { path: path, drive: drv, ch: ch, ctrl: ctl, port: port };
}

/* ── IO 리스트 ────────────────────────────────────────────────────────── */
function specTopoIoNodes(t) {
  var has = {}; t.io.forEach(function (r) { has[r.node] = 1; });
  return specTopoFlat(t).map(function (x) { return x.n; }).filter(function (n) { return TOPO_IO_KINDS[n.kind] || has[n.id]; });
}
function _tpAddrNum(a, pre) { var m = new RegExp('^' + pre + '([0-9A-Fa-f]+)$').exec(_tpStr(a).trim()); return m ? parseInt(m[1], 16) : -1; }
function _tpAddr(pre, n) { var h = n.toString(16).toUpperCase(); while (h.length < 3) h = '0' + h; return pre + h; }
/** IO 점 n 개 더하기 — 주소는 그 방향(X · Y · AI · AO)에서 쓰인 가장 큰 번호 다음부터 (16진수 3자리: X000 … X01F) */
function specTopoIoAdd(t, nodeId, dir, count) {
  dir = TOPO_IO_DIRS.indexOf(dir) >= 0 ? dir : 'DI';
  count = Math.max(1, Math.min(256, count | 0 || 1));
  if (t.io.length + count > TOPO_MAX_IO) count = Math.max(0, TOPO_MAX_IO - t.io.length);
  var pre = TOPO_IO_PREFIX[dir], mx = -1;
  t.io.forEach(function (r) { if (r.dir === dir) mx = Math.max(mx, _tpAddrNum(r.addr, pre)); });
  var add = [];
  for (var i = 0; i < count; i++) add.push({ id: _tpId('io'), node: nodeId, dir: dir, addr: _tpAddr(pre, mx + 1 + i), name: '', desc: '', dev: '' });
  // 같은 장치 · 같은 방향의 마지막 점 뒤에 끼움 (목록이 장치별로 모여 있게)
  var last = -1; t.io.forEach(function (r, k) { if (r.node === nodeId && r.dir === dir) last = k; });
  if (last >= 0) t.io.splice.apply(t.io, [last + 1, 0].concat(add)); else t.io = t.io.concat(add);
  return add;
}
/** 장치별 IO 점 수 · 넘침 경고 */
function specTopoIoSummary(t) {
  return specTopoIoNodes(t).map(function (n) {
    var c = { DI: 0, DO: 0, AI: 0, AO: 0 };
    t.io.forEach(function (r) { if (r.node === n.id) c[r.dir]++; });
    var used = c.DI + c.DO + c.AI + c.AO;
    return { n: n, c: c, used: used, over: n.pts != null && used > n.pts };
  });
}
/** 같은 주소가 두 번 쓰였나 */
function specTopoIoDup(t) {
  var seen = {}, dup = {};
  t.io.forEach(function (r) { var a = _tpStr(r.addr).trim().toUpperCase(); if (!a) return; if (seen[a]) dup[a] = 1; seen[a] = 1; });
  return dup;
}

/* ── 🖵 모니터 연결 — PC 영상 포트 → 변환 잭 → 케이블 · 길이 → 모니터 입력 → 모니터 ── */
function specTopoMonitors(t) {
  return specTopoFlat(t).map(function (x) { return x.n; }).filter(function (n) { return n.kind === 'monitor'; }).map(function (m) {
    var path = specTopoPath(t, m.id), chain = path.concat([m]), port = null, adapters = [], cables = [];
    chain.forEach(function (n, i) {
      if (topoKind(n.kind).cat === 'dport' && !port) port = n;
      if (n.kind === 'adapter') adapters.push(specTopoName(n) + (n.model ? ' (' + n.model + ')' : ''));
      if (port && n !== port && (n.cable || n.len)) cables.push([n.cable, n.len].filter(Boolean).join(' '));
    });
    var pc = chain.filter(function (n) { return n.kind === 'pc'; })[0];
    return { n: m, pc: pc, port: port, adapters: adapters, cables: cables, input: m.port, name: specTopoName(m), model: m.model };
  });
}

/* ── 확인 ─────────────────────────────────────────────────────────────── */
function specTopoChecks(t) {
  var out = [];
  var roots = specTopoChildren(t, null);
  if (roots.length > 1) out.push('맨 위에 장치가 ' + roots.length + '개입니다 — 보통 PC 하나 아래로 모읍니다');
  var ax = specTopoAxes(t), chs = {};
  ax.forEach(function (n) {
    var inf = specTopoAxisInfo(t, n);
    if (!inf.ctrl) out.push('축 ' + specTopoName(n) + ': 모션 카드 · 컨트롤러 아래에 있지 않습니다');
    var key = (inf.ctrl ? inf.ctrl.id : '-') + '|' + _tpStr(inf.ch).trim();
    if (inf.ch && chs[key]) out.push('축 채널 중복: ' + specTopoName(chs[key]) + ' · ' + specTopoName(n) + ' (' + inf.ch + ')'); else if (inf.ch) chs[key] = n;
  });
  specTopoIoSummary(t).forEach(function (s) { if (s.over) out.push(specTopoName(s.n) + ': IO ' + s.used + '점 > ' + s.n.pts + '점'); });
  var dup = Object.keys(specTopoIoDup(t)); if (dup.length) out.push('IO 주소 중복: ' + dup.slice(0, 6).join(', ') + (dup.length > 6 ? ' …' : ''));
  specTopoMonitors(t).forEach(function (r) { if (!r.port) out.push('모니터 ' + r.name + ': PC 의 HDMI · DP · VGA · DVI 포트 아래에 있지 않습니다'); });
  var coms = {};
  t.nodes.forEach(function (n) { if ((n.kind === 'com' || n.kind === 'sport' || n.kind === 'usbser') && /^COM\s*\d+$/i.test(_tpStr(n.addr).trim())) { var k = n.addr.replace(/\s+/g, '').toUpperCase(); if (coms[k]) out.push(k + ' 번호가 두 곳에 있습니다 (' + specTopoName(coms[k]) + ' · ' + specTopoName(n) + ')'); else coms[k] = n; } });
  return out;
}

/* ── 사양 값으로 초안 ─────────────────────────────────────────────────── */
/** 지금 사양서 값(IPC · 모션 컨트롤러 · IO · 확장 모듈 · 외부장치 · 축 구성)으로 계층 초안 */
function specTopoSeed(sheet) {
  var V = (sheet && sheet.values) || {}, t = { v: 1, nodes: [], io: [] };
  function n(parent, kind, name, model, port, addr) { var x = specTopoAdd(t, parent, kind); if (name) x.name = name; if (model) x.model = model; if (port) x.port = port; if (addr) x.addr = addr; return x; }
  function num(v, d) { var k = parseInt(v, 10); return isFinite(k) && k > 0 ? k : d; }
  var pc = n(null, 'pc', '제어 PC', _tpStr(V.ipc_model));
  var lan = num(V.ipc_lan, 0), eths = [];
  for (var i = 0; i < Math.min(lan || 1, 4); i++) eths.push(n(pc.id, 'eth', 'Ethernet #' + (i + 1)));
  var slot = 0;
  function nextSlot(form) { slot++; return n(pc.id, /PCIe/.test(form || '') ? 'pcie' : /PCI/.test(form || '') ? 'pci' : 'pcie', (/PCI(?!e)/.test(form || '') ? 'PCI #' : 'PCIe #') + slot); }
  var mcQty = num(V.mc_qty, V.mc_model || V.mc_axes ? 1 : 0), cards = [], bbs = [];
  for (var bq = 0; bq < Math.min(num(V.bb_qty, V.bb_model ? 1 : 0), 4); bq++) bbs.push(n(nextSlot('PCIe').id, 'baseboard', '아진 베이스보드' + (num(V.bb_qty, 1) > 1 ? ' #' + (bq + 1) : ''), _tpStr(V.bb_model)));   // v13.450 모션 · IO 모듈은 베이스보드에
  for (var m = 0; m < Math.min(mcQty, 4); m++) {
    var holder = /EtherCAT/.test(_tpStr(V.mc_form)) ? eths[0] : /단독형/.test(_tpStr(V.mc_form)) ? eths[0] : bbs.length ? bbs[m % bbs.length] : nextSlot(V.mc_form);
    var mk = /EtherCAT/.test(_tpStr(V.mc_form)) ? 'ectmaster' : /단독형/.test(_tpStr(V.mc_form)) ? 'ctrl' : 'motion';
    cards.push(n(holder.id, mk, '모션 ' + (mcQty > 1 ? '#' + (m + 1) : (mk === 'motion' ? '카드' : '')), [_tpStr(V.mc_vendor), _tpStr(V.mc_model)].filter(Boolean).join(' ')));
  }
  var ioQty = num(V.io_in_cards, 0) + num(V.io_out_cards, 0) || (V.io_model ? 1 : 0);
  for (var q = 0; q < Math.min(ioQty, 6); q++) { var io = n((bbs.length ? bbs[q % bbs.length] : nextSlot(V.io_form)).id, 'iocard', 'IO 카드' + (ioQty > 1 ? ' #' + (q + 1) : ''), _tpStr(V.io_model)); io.pts = 32; }
  if (V.mp_vendor || V.mp_ports) {
    var mpq = num(V.mp_qty, 1);
    for (var p = 0; p < Math.min(mpq, 2); p++) {
      var mp = n(nextSlot('PCIe').id, 'multiport', (_tpStr(V.mp_vendor) || '멀티포트') + (mpq > 1 ? ' #' + (p + 1) : ''), _tpStr(V.mp_vendor));
      for (var s = 0; s < Math.min(num(V.mp_ports, 4), 16); s++) n(mp.id, 'sport', 'Port ' + (s + 1));
    }
  }
  var hub = V.hub_model || V.hub_qty ? n(eths[eths.length > 1 ? 1 : 0].id, 'hub', 'Switching Hub', _tpStr(V.hub_model)) : null;
  (Array.isArray(V.ext_devices) ? V.ext_devices : []).forEach(function (d) {
    if (!d || !_tpStr(d.name).trim()) return;
    var f = _tpStr(d.iface), par = pc.id;
    if (/Ethernet/i.test(f)) par = hub ? hub.id : eths[0].id;
    else if (/USB/i.test(f)) par = n(pc.id, 'usb').id;
    else if (/RS-?232|RS-?485/i.test(f)) { var sp = t.nodes.filter(function (x) { return x.kind === 'sport' && !specTopoChildren(t, x.id).length; })[0]; par = sp ? sp.id : n(pc.id, 'com').id; }
    else if (/EtherCAT/i.test(f)) par = cards[0] ? cards[0].id : eths[0].id;
    else if (/PCI/i.test(f)) par = nextSlot(f).id;
    var k = /카메라|camera|cam\b/i.test(d.name) ? 'camera' : 'ctrl';
    var x = n(par, k, _tpStr(d.name), _tpStr(d.vendor), _tpStr(d.port)); x.note = [_tpStr(d.protocol), d.qty && +d.qty > 1 ? '× ' + d.qty : ''].filter(Boolean).join(' · ');
  });
  var per = num(V.mc_axes, 0);
  (Array.isArray(V.axes) ? V.axes : []).forEach(function (a, i) {
    if (!a || !_tpStr(a.name).trim()) return;
    var card = cards.length ? cards[per ? Math.min(cards.length - 1, Math.floor(i / per)) : 0] : null;
    var par = card ? card.id : pc.id;
    var drv = n(par, 'drive', _tpStr(a.drv_model) ? '드라이브 ' + _tpStr(a.name) : '드라이브 ' + _tpStr(a.name), _tpStr(a.drv_model), _tpStr(a.ch) !== '' ? 'CH' + _tpStr(a.ch) : '');
    var ax = n(drv.id, 'axis', _tpStr(a.name), [_tpStr(a.motor_type), _tpStr(a.motor_model), _tpStr(a.motor_power) ? _tpStr(a.motor_power) + 'W' : ''].filter(Boolean).join(' '));
    ax.note = _tpStr(a.use);
  });
  _tpRenumberAxes(t);
  return t;
}

/* ── 거르기 — 고른 계통만 선명하게, 나머지는 흐리게 ─────────────────────── */
var TOPO_FILTERS = [
  { key: 'eth', label: 'Ethernet', kinds: ['eth', 'lancard', 'hub'] },
  { key: 'poe', label: 'PoE', kinds: ['poe'] },
  { key: 'usb', label: 'USB', kinds: ['usb'] },
  { key: 'serial', label: '시리얼 (COM · RS-232/485)', kinds: ['com', 'multiport', 'nport', 'usbser', 'sport'] },
  { key: 'slot', label: 'PCI · PCIe', kinds: ['pci', 'pcie'] },
  { key: 'motion', label: '모션 · 축', kinds: ['baseboard', 'motion', 'hyperwire', 'ectmaster', 'axisch', 'drive', 'axis'] },
  { key: 'io', label: 'IO', kinds: ['iocard', 'iomod'] },
  { key: 'vision', label: '비전', kinds: ['grabber', 'camera'] },
  { key: 'ctrl', label: '컨트롤러', kinds: ['ctrl', 'plc', 'robot'] },
  { key: 'display', label: '디스플레이 (모니터)', kinds: ['hdmi', 'dp', 'vga', 'dvi', 'adapter', 'monitor'] }
];
/** 선명하게 둘 노드 id 모음 (null = 거르지 않음) — 맞는 노드 · 그 아래 가지 전부 · 위로 PC 까지 가는 길 */
function specTopoFocus(t, key, q) {
  var f = TOPO_FILTERS.filter(function (x) { return x.key === key; })[0];
  q = _tpStr(q).trim().toLowerCase();
  if (!f && !q) return null;
  var hit = t.nodes.filter(function (n) {
    if (f && f.kinds.indexOf(n.kind) < 0) return false;
    if (q && [specTopoName(n), n.model, n.port, n.addr, n.note, topoKindN(n).label].join(' ').toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  var on = {};
  hit.forEach(function (n) {
    (function down(id) { on[id] = 1; specTopoChildren(t, id).forEach(function (c) { down(c.id); }); })(n.id);
    specTopoPath(t, n.id).forEach(function (p) { on[p.id] = 1; });
  });
  return on;
}
function specTopoFilterCount(t, key) { var f = TOPO_FILTERS.filter(function (x) { return x.key === key; })[0]; return f ? t.nodes.filter(function (n) { return f.kinds.indexOf(n.kind) >= 0; }).length : 0; }

/* ── 계층 구성도 배치 ─────────────────────────────────────────────────────
 *   mode 'h' 가로 펼침 — 위에 PC, 「장치 인터페이스」 띠에서 포트마다 내려감 (넓은 화면 · 그림으로 뽑기)
 *   mode 'v' 세로 트리 — 탐색기처럼 아래로 한 줄씩, 들여쓰기 (좁은 칸에서 읽기 쉬움)
 *   v13.452 글자는 자르지 않고 감쌈 — 이름은 두 줄까지, 주소 · IP · COM 은 따로 한 줄(고정폭 칩)에 늘 보이게 */
var TOPO_G = { w: 156, gx: 12, gy: 38, top: 18, pcW: 214, busGap: 34, leafGap: 6, stackMin: 3, vIndent: 24, vW: 268, vGap: 8 };
/** 글자 폭 어림 (px) — 한글 · 한자 · 넓은 글자 1em, 나머지 0.56em */
function _tpTextW(s, fs) { var w = 0; s = _tpStr(s); for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); w += c > 0x2e80 ? fs : c === 32 ? fs * 0.3 : (c >= 65 && c <= 90) || c === 87 ? fs * 0.64 : fs * 0.56; } return w; }
/** 폭에 맞춰 줄 나누기 — 띄어쓰기에서 먼저 끊고, 그래도 길면 글자 단위 · maxLines 를 넘으면 마지막 줄 끝에 … */
function _tpWrapPx(s, maxPx, fs, maxLines) {
  s = _tpStr(s).trim(); if (!s) return [];
  var words = s.split(/(\s+)/), lines = [], cur = '';
  function push(x) { lines.push(x); }
  words.forEach(function (w) {
    if (!w) return;
    var test = cur + w;
    if (_tpTextW(test, fs) <= maxPx) { cur = test; return; }
    if (cur.trim()) { push(cur.trim()); cur = ''; }
    w = w.trim(); if (!w) return;
    while (_tpTextW(w, fs) > maxPx) { var k = w.length; while (k > 1 && _tpTextW(w.slice(0, k), fs) > maxPx) k--; push(w.slice(0, k)); w = w.slice(k); }
    cur = w;
  });
  if (cur.trim()) push(cur.trim());
  if (lines.length > maxLines) { var last = lines.slice(maxLines - 1).join(' '); lines = lines.slice(0, maxLines - 1); var k2 = last.length; while (k2 > 1 && _tpTextW(last.slice(0, k2) + '…', fs) > maxPx) k2--; lines.push(last.slice(0, k2) + '…'); }
  return lines;
}
function _tpFit(s, maxPx, fs) { s = _tpStr(s); if (_tpTextW(s, fs) <= maxPx) return s; var k = s.length; while (k > 1 && _tpTextW(s.slice(0, k) + '…', fs) > maxPx) k--; return s.slice(0, k) + '…'; }
function _tpEdgeLabel(c) { return [c.port, [c.cable, c.len].filter(Boolean).join(' ')].filter(Boolean).join(' · '); }
/** 상자 안 글 준비 + 높이 — kind: pc · port · box · small */
function _tpBoxText(n, type, w, via) {
  var pad = type === 'small' ? 29 : type === 'port' ? 34 : type === 'pc' ? 62 : 9, inner = w - pad - 8;
  var b = { name: _tpWrapPx(specTopoName(n), inner, type === 'pc' ? 15 : 12, 2), model: n.model ? _tpFit(n.model, inner, 9.5) : '', addr: n.addr ? _tpFit(n.addr, inner - 8, 9.5) : '', via: via ? _tpFit('↳ ' + via, inner, 9.5) : '' };
  if (type === 'pc') { b.h = 26 + b.name.length * 18 + 14 + (b.addr ? 17 : 0); b.h = Math.max(b.h, 66); }
  else if (type === 'port') b.h = 10 + b.name.length * 14 + (b.addr ? 16 : 0) + (b.via ? 13 : 0) + 4;
  else if (type === 'small') b.h = Math.max(27, 9 + b.name.length * 13 + (b.model ? 12 : 0) + (b.addr ? 15 : 0) + (b.via ? 12 : 0) + 4);
  else b.h = 28 + b.name.length * 15 + (b.model ? 13 : 0) + (b.addr ? 16 : 0) + (b.via ? 13 : 0) + 5;
  return b;
}
function specTopoLayout(t, mode) {
  var G = TOPO_G, boxes = [], edges = [], W = 0, H = 0;
  var kidsOf = {}; t.nodes.forEach(function (n) { var p = n.parent || ''; (kidsOf[p] = kidsOf[p] || []).push(n); });
  function kids(n) { return n && n.fold ? [] : (kidsOf[n ? n.id : ''] || []); }
  function catOf(n) { return topoKind(n.kind).cat; }
  if (mode === 'v') {   // 세로 트리
    var y = G.top;
    (function walk(list, depth, parentBox) {
      list.forEach(function (n) {
        var type = n.kind === 'pc' && !depth ? 'pc' : catOf(n) === 'port' || catOf(n) === 'dport' ? 'port' : 'box';
        var w = type === 'pc' ? Math.max(G.vW, 230) : G.vW - Math.min(depth, 6) * 4;
        var tx = _tpBoxText(n, type, w, depth ? _tpEdgeLabel(n) : '');
        var b = Object.assign({ id: n.id, n: n, x: 12 + depth * G.vIndent, y: y, w: w, type: type, v: true }, tx);
        boxes.push(b); y += b.h + G.vGap; W = Math.max(W, b.x + b.w); H = Math.max(H, b.y + b.h);
        if (parentBox) edges.push({ a: parentBox, b: b, vtree: true });
        walk(kids(n), depth + 1, b);
      });
    })(kids(null), 0, null);
    return { boxes: boxes, edges: edges, bus: null, width: W + 24, height: H + 20, mode: 'v' };
  }
  function stacked(n) { var k = kids(n); return k.length >= G.stackMin && k.every(function (c) { return !kids(c).length; }); }
  var widthMemo = {};
  function width(n) {
    if (widthMemo[n.id] != null) return widthMemo[n.id];
    var k = kids(n), w;
    if (!k.length || stacked(n)) w = G.w;
    else w = Math.max(G.w, k.reduce(function (s, c) { return s + width(c); }, 0) + G.gx * (k.length - 1));
    return (widthMemo[n.id] = w);
  }
  function place(n, x, y) {   // x = 이 가지의 왼쪽
    var w = width(n), type = catOf(n) === 'port' || catOf(n) === 'dport' ? 'port' : 'box';
    var tx = _tpBoxText(n, type, G.w);
    var b = Object.assign({ id: n.id, n: n, x: x + (w - G.w) / 2, y: y, w: G.w, type: type, port: type === 'port' }, tx);
    boxes.push(b); H = Math.max(H, y + b.h); W = Math.max(W, x + w);
    var k = kids(n);
    if (!k.length) return b;
    if (stacked(n)) {   // 잎만 여럿 — 세로로 쌓아 폭을 아낌 (멀티포트의 포트 16개 등)
      var cy = y + b.h + 12, sx = b.x + 14;
      k.forEach(function (c) {
        var ct = _tpBoxText(c, 'small', G.w - 14, _tpEdgeLabel(c));
        var cb = Object.assign({ id: c.id, n: c, x: sx, y: cy, w: G.w - 14, type: 'small', small: true }, ct);
        boxes.push(cb); edges.push({ a: b, b: cb, stack: true }); cy += cb.h + G.leafGap; H = Math.max(H, cb.y + cb.h);
      });
      return b;
    }
    var cx = x + (w - (k.reduce(function (s, c) { return s + width(c); }, 0) + G.gx * (k.length - 1))) / 2;
    var row = k.map(function (c) { var cb = place(c, cx, y + b.h + G.gy); cx += width(c) + G.gx; return cb; });
    row.forEach(function (cb, i) { edges.push({ a: b, b: cb, label: _tpEdgeLabel(k[i]) }); });
    return b;
  }
  var roots = kids(null), x = 0, bus = null;
  roots.forEach(function (r) {
    if (r.kind === 'pc' && kids(r).length) {   // PC — 위에, 그 아래 가로 「장치 인터페이스」 띠에서 포트마다 내려감
      var ports = kids(r), pw = ports.reduce(function (s, c) { return s + width(c); }, 0) + G.gx * (ports.length - 1), tw = Math.max(pw, G.pcW);
      var pt = _tpBoxText(r, 'pc', G.pcW);
      var pcBox = Object.assign({ id: r.id, n: r, x: x + (tw - G.pcW) / 2, y: G.top, w: G.pcW, type: 'pc', pc: true }, pt);
      boxes.push(pcBox);
      var by = G.top + pcBox.h + G.busGap, px = x + (tw - pw) / 2, ys = by + 30;
      bus = { x1: px - 6, x2: px + pw + 6, y: by, pc: pcBox };
      ports.forEach(function (c) { var cb = place(c, px, ys); edges.push({ a: { x: cb.x + cb.w / 2, y: by, w: 0, h: 0, virt: true }, b: cb, bus: true, label: _tpEdgeLabel(c) }); px += width(c) + G.gx; });
      W = Math.max(W, x + tw); x += tw + G.gx * 3;
    } else { place(r, x, G.top); x += width(r) + G.gx * 3; }
  });
  return { boxes: boxes, edges: edges, bus: bus, width: Math.max(W, 200) + 24, height: H + 24, mode: 'h' };
}
function _tpEsc(s) { return _tpStr(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _tpCut(s, n) { s = _tpStr(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
/** 계층 구성도 SVG — opts.sel 고른 노드 · opts.focus 선명하게 둘 것 · opts.dark · opts.mode 'h' | 'v' */
function specTopoSvg(t, opts) {
  opts = opts || {};
  var L = specTopoLayout(t, opts.mode), dk = !!opts.dark, ox = 12, oy = 4;
  var ink = dk ? '#e5e7eb' : '#1f2937', sub = dk ? '#9ca3af' : '#6b7280', line = dk ? '#64748b' : '#94a3b8', bg = dk ? '#0f172a' : '#ffffff';
  var ipBg = dk ? '#172554' : '#eff6ff', ipInk = dk ? '#93c5fd' : '#1d4ed8', MONO = 'Consolas, Menlo, monospace';
  var o = ['<svg xmlns="http://www.w3.org/2000/svg" class="tp-svg" viewBox="0 0 ' + Math.round(L.width) + ' ' + Math.round(L.height) + '" width="' + Math.round(L.width) + '" height="' + Math.round(L.height) + '" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans KR, sans-serif">'];
  o.push('<defs><marker id="tpArr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="' + line + '"/></marker><filter id="tpSh" x="-8%" y="-8%" width="116%" height="130%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.8" flood-color="#0f172a" flood-opacity="' + (dk ? '.5' : '.16') + '"/></filter></defs>');
  var F = opts.focus || null, DIM = ' opacity=".16"';
  if (L.bus) {   // 장치 인터페이스 띠 (PPT 의 노란 화살표)
    var b = L.bus, y = b.y + oy, x1 = b.x1 + ox, x2 = b.x2 + ox, pc = b.pc;
    o.push('<line x1="' + (pc.x + pc.w / 2 + ox) + '" y1="' + (pc.y + pc.h + oy) + '" x2="' + (pc.x + pc.w / 2 + ox) + '" y2="' + (y - 11) + '" stroke="#d97706" stroke-width="3"/>');
    o.push('<path d="M' + x1 + ' ' + y + 'l14 -13v7h' + (x2 - x1 - 28) + 'v-7l14 13l-14 13v-7h-' + (x2 - x1 - 28) + 'v7z" fill="#f59e0b" stroke="#d97706" stroke-width="1"/>');
    o.push('<text x="' + ((x1 + x2) / 2) + '" y="' + (y + 4.5) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">장치 인터페이스</text>');
  }
  L.edges.forEach(function (e) {
    var a = e.a, c = e.b, dim = F && !F[c.id];
    if (dim) o.push('<g' + DIM + '>');
    var cx = c.x + c.w / 2 + ox, cy = c.y + oy;
    if (e.vtree) {   // 세로 트리 — 부모 왼쪽 아래에서 내려와 아이 왼쪽으로
      var sx = a.x + 12 + ox, sy = c.y + Math.min(c.h / 2, 16) + oy;
      o.push('<path d="M' + sx + ' ' + (a.y + a.h + oy) + 'V' + sy + 'H' + (c.x + ox) + '" fill="none" stroke="' + line + '" stroke-width="1.4"/>');
    } else if (e.bus) {
      o.push('<line x1="' + (a.x + ox) + '" y1="' + (a.y + oy + 13) + '" x2="' + cx + '" y2="' + cy + '" stroke="#d97706" stroke-width="3"/>');
    } else if (e.stack) {
      var tx = a.x + 7 + ox, ty = c.y + Math.min(c.h / 2, 15) + oy;
      o.push('<path d="M' + tx + ' ' + (a.y + a.h + oy) + 'V' + ty + 'H' + (c.x + ox) + '" fill="none" stroke="' + line + '" stroke-width="1.3"/>');
    } else {
      var ax = a.x + a.w / 2 + ox, ay = a.y + a.h + oy, my = ay + (cy - ay) / 2;
      o.push('<path d="M' + ax + ' ' + ay + 'V' + my + 'H' + cx + 'V' + (cy - 1) + '" fill="none" stroke="' + line + '" stroke-width="1.6" marker-end="url(#tpArr)"/>');
      if (e.label) {
        var lt = _tpFit(e.label, c.w + 10, 9.5), lw = Math.min(c.w + 16, 12 + _tpTextW(lt, 9.5));
        o.push('<rect x="' + (cx - lw / 2) + '" y="' + (cy - 20) + '" width="' + lw + '" height="15" rx="7.5" fill="' + bg + '" stroke="' + line + '" stroke-width=".8"/><text x="' + cx + '" y="' + (cy - 9.2) + '" text-anchor="middle" font-size="9.5" fill="' + sub + '">' + _tpEsc(lt) + '</text>');
      }
    }
    if (dim) o.push('</g>');
  });
  function ipChip(x, y, w, txt) {   // 주소 · IP · COM — 늘 보이게 (고정폭 · 파란 칩)
    var cw = Math.min(w, 10 + _tpTextW(txt, 9.5) * 1.02);
    return '<rect x="' + x + '" y="' + y + '" width="' + cw + '" height="13" rx="3" fill="' + ipBg + '"/><text x="' + (x + 4) + '" y="' + (y + 9.6) + '" font-size="9.5" font-family="' + MONO + '" fill="' + ipInk + '">' + _tpEsc(txt) + '</text>';
  }
  function lines(arr, x, y, fs, lh, fw, col) { return arr.map(function (s, i) { return '<text x="' + x + '" y="' + (y + i * lh) + '" font-size="' + fs + '"' + (fw ? ' font-weight="' + fw + '"' : '') + ' fill="' + col + '">' + _tpEsc(s) + '</text>'; }).join(''); }
  L.boxes.forEach(function (bx) {
    var n = bx.n, K = topoKindN(n), C = topoCatN(n), x = bx.x + ox, y = bx.y + oy, sel = opts.sel === n.id;
    var fill = dk ? '#111827' : '#ffffff', stroke = sel ? '#2563eb' : C.fill, sw = sel ? 2.4 : 1.3, w = bx.w, cy2;
    var kidN = t.nodes.filter(function (q) { return q.parent === n.id; }).length;
    o.push('<g class="tp-n' + (sel ? ' sel' : '') + '" data-id="' + _tpEsc(n.id) + '" style="cursor:pointer"' + (F && !F[n.id] ? DIM : '') + '>');
    var rx = bx.type === 'pc' ? 13 : bx.type === 'port' ? Math.min(15, bx.h / 2) : bx.type === 'small' ? 7 : 10;
    if (sel) o.push('<rect x="' + (x - 3.5) + '" y="' + (y - 3.5) + '" width="' + (w + 7) + '" height="' + (bx.h + 7) + '" rx="' + (rx + 3.5) + '" fill="none" stroke="#2563eb" stroke-opacity=".28" stroke-width="3"/>');   // 고른 장치 — 바깥 테
    if (bx.type === 'pc') {
      o.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + bx.h + '" rx="13" fill="' + (dk ? '#1e293b' : '#f8fafc') + '" stroke="' + stroke + '" stroke-width="' + (sel ? 2.6 : 2) + '" filter="url(#tpSh)"/>');
      o.push('<rect x="' + (x + 10) + '" y="' + (y + 12) + '" width="42" height="42" rx="11" fill="' + C.fill + '"/>');
      o.push(topoIconSvg(K.ico, 28, '#fff', x + 17, y + 19, true));
      o.push(lines(bx.name, x + 62, y + 27, 15, 18, 800, ink)); cy2 = y + 27 + (bx.name.length - 1) * 18;
      o.push('<text x="' + (x + 62) + '" y="' + (cy2 + 15) + '" font-size="10" fill="' + sub + '">' + _tpEsc(bx.model || K.label) + '</text>'); cy2 += 15;
      if (bx.addr) o.push(ipChip(x + 62, cy2 + 5, w - 70, bx.addr));
    } else if (bx.type === 'port') {
      o.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + bx.h + '" rx="' + rx + '" fill="' + (dk ? '#1f1a12' : C.soft) + '" stroke="' + stroke + '" stroke-width="' + sw + '"/>');
      o.push('<circle cx="' + (x + 15) + '" cy="' + (y + 14) + '" r="10.5" fill="' + C.fill + '"/>');
      o.push(topoIconSvg(K.ico, 14, '#fff', x + 8, y + 7, true));
      o.push(lines(bx.name, x + 32, y + 18, 11.5, 14, 700, ink)); cy2 = y + 18 + (bx.name.length - 1) * 14;
      if (bx.addr) { o.push(ipChip(x + 32, cy2 + 5, w - 40, bx.addr)); cy2 += 16; }
      if (bx.via) o.push('<text x="' + (x + 32) + '" y="' + (cy2 + 13) + '" font-size="9.5" fill="' + sub + '">' + _tpEsc(bx.via) + '</text>');
    } else if (bx.type === 'small') {
      o.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + bx.h + '" rx="7" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + (sel ? 2.2 : 1) + '"/>');
      o.push('<rect x="' + (x + 4.5) + '" y="' + (y + 4.5) + '" width="18" height="18" rx="5" fill="' + C.fill + '"/>');
      o.push(topoIconSvg(K.ico, 12, '#fff', x + 7.5, y + 7.5, true));
      o.push(lines(bx.name, x + 28, y + 17, 10.5, 13, 600, ink)); cy2 = y + 17 + (bx.name.length - 1) * 13;
      if (bx.model) { o.push('<text x="' + (x + 28) + '" y="' + (cy2 + 12) + '" font-size="9.5" fill="' + sub + '">' + _tpEsc(bx.model) + '</text>'); cy2 += 12; }
      if (bx.addr) { o.push(ipChip(x + 28, cy2 + 3, w - 33, bx.addr)); cy2 += 15; }
      if (bx.via) o.push('<text x="' + (x + 28) + '" y="' + (cy2 + 11) + '" font-size="9" fill="' + sub + '">' + _tpEsc(bx.via) + '</text>');
    } else {   // 카드 — 위에 분류 색 띠(아이콘 + 종류), 아래 이름 · 모델 · 주소
      o.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + bx.h + '" rx="10" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '" filter="url(#tpSh)"/>');
      o.push('<path d="M' + x + ' ' + (y + 22) + 'V' + (y + 10) + 'a10 10 0 0 1 10 -10h' + (w - 20) + 'a10 10 0 0 1 10 10V' + (y + 22) + 'z" fill="' + C.fill + '"/>');
      o.push(topoIconSvg(K.ico, 15, '#fff', x + 7, y + 3.5, true));
      o.push('<text x="' + (x + 27) + '" y="' + (y + 15) + '" font-size="10.5" font-weight="700" fill="#fff">' + _tpEsc(_tpFit(K.label, w - (n.fold && kidN ? 62 : n.kind === 'axis' && n.ord ? 56 : 34), 10.5)) + '</text>');
      if (n.fold && kidN) o.push('<rect x="' + (x + w - 31) + '" y="' + (y + 4) + '" width="26" height="14" rx="7" fill="#fff" fill-opacity=".92"/><text x="' + (x + w - 18) + '" y="' + (y + 14.5) + '" text-anchor="middle" font-size="9.5" font-weight="800" fill="' + C.fill + '">＋' + kidN + '</text>');
      else if (n.kind === 'axis' && n.ord) o.push('<rect x="' + (x + w - 27) + '" y="' + (y + 4) + '" width="22" height="14" rx="7" fill="#fff" fill-opacity=".92"/><text x="' + (x + w - 16) + '" y="' + (y + 14.5) + '" text-anchor="middle" font-size="9.5" font-weight="800" fill="' + C.fill + '">#' + n.ord + '</text>');
      o.push(lines(bx.name, x + 9, y + 39, 12, 15, 700, ink)); cy2 = y + 39 + (bx.name.length - 1) * 15;
      if (bx.model) { o.push('<text x="' + (x + 9) + '" y="' + (cy2 + 13) + '" font-size="9.5" fill="' + sub + '">' + _tpEsc(bx.model) + '</text>'); cy2 += 13; }
      if (bx.addr) { o.push(ipChip(x + 9, cy2 + 4, w - 18, bx.addr)); cy2 += 16; }
      if (bx.via) o.push('<text x="' + (x + 9) + '" y="' + (cy2 + 13) + '" font-size="9.5" fill="' + sub + '">' + _tpEsc(bx.via) + '</text>');
    }
    o.push('</g>');
  });
  o.push('</svg>');
  return o.join('');
}

/* ── 내보내기 표 (XLSX) — 장치 목록은 다시 불러올 수 있는 모양 (레벨 칸) ─── */
var TOPO_ROW_HEAD = ['레벨', '계층', '종류', '이름', '모델', '포트 · 채널', '주소 · IP · COM', '케이블', '길이', '축 번호', 'IO 점 수', '비고', '연결 경로'];
function specTopoRows(t) {
  var dev = [TOPO_ROW_HEAD.slice()];
  specTopoFlat(t).forEach(function (x) {
    var n = x.n;
    dev.push([x.depth, new Array(x.depth + 1).join('    ') + specTopoName(n), topoKindN(n).label, specTopoName(n), n.model, n.port, n.addr, n.cable || '', n.len || '', n.kind === 'axis' && n.ord != null ? n.ord : '', n.pts != null ? n.pts : '', n.note, specTopoPath(t, n.id).map(specTopoName).join(' › ')]);
  });
  var ax = [['축 번호', '축 이름', '모델 · 모터', '드라이브', '채널', '제어기', '포트', '용도 · 비고']];
  specTopoAxes(t).forEach(function (n) { var i = specTopoAxisInfo(t, n); ax.push([n.ord, specTopoName(n), n.model, i.drive ? specTopoName(i.drive) + (i.drive.model ? ' (' + i.drive.model + ')' : '') : '', i.ch, i.ctrl ? specTopoName(i.ctrl) : '', i.port ? specTopoName(i.port) : '', n.note]); });
  var io = [['장치', '방향', '주소', '이름', '설명', '연결 장치']];
  t.io.forEach(function (r) { var n = specTopoNode(t, r.node); io.push([n ? specTopoName(n) : '', r.dir, r.addr, r.name, r.desc, r.dev]); });
  var mon = [['모니터', '모델', '모니터 입력', 'PC 영상 포트', '변환 잭', '케이블 · 길이', 'PC']];
  specTopoMonitors(t).forEach(function (r) { mon.push([r.name, r.model, r.input, r.port ? specTopoName(r.port) + (r.port.port ? ' (' + r.port.port + ')' : '') : '', r.adapters.join(' → '), r.cables.join(' / '), r.pc ? specTopoName(r.pc) : '']); });
  return { devices: dev, axes: ax, io: io, monitors: mon };
}
/** 빈 양식 — 예시 몇 줄 (엑셀에서 레벨 · 종류만 맞추면 됨) */
function specTopoTemplateRows() {
  return [TOPO_ROW_HEAD.slice(),
    [0, '제어 PC', 'PC · IPC', '제어 PC', 'IPC-610H', '', '', '', '', '', '', '', ''],
    [1, '    Ethernet #1', 'Ethernet 포트', 'Ethernet #1', '', 'LAN1', '192.168.0.1', '', '', '', '', '설비망', ''],
    [2, '        Switching Hub', '스위칭 허브', 'Switching Hub', 'TL-SG108', '', '', 'LAN Cat6', '2m', '', '', '', ''],
    [3, '            카메라', '카메라', '얼라인 카메라', 'Basler ace', 'Port 1', '192.168.0.11', 'LAN Cat6', '5m', '', '', '', ''],
    [1, '    PCIe #1', 'PCIe 슬롯', 'PCIe #1', '', '', '', '', '', '', '', '', ''],
    [2, '        아진 베이스보드', '아진 베이스보드', '아진 베이스보드', 'BPHR', '', '', '', '', '', '', '', ''],
    [3, '            모션 모듈', '모션 카드', '모션 모듈', 'SMC-2V', '', '', '', '', '', '', '', ''],
    [4, '                드라이브 X', '드라이브 · 앰프', '드라이브 X', 'L7NH', 'CH0', '', '', '', '', '', '', ''],
    [5, '                    X 축', '액추에이터 · 모션 축', 'X 축', 'AC 서보 400W', '', '', '', '', 1, '', '', ''],
    [1, '    COM1', 'COM 포트 (RS-232C)', 'COM1', '', '', 'COM1', '', '', '', '', '', ''],
    [2, '        온도 컨트롤러', '컨트롤러', '온도 컨트롤러', 'TZ4ST', '국번 1', '', 'RS-232C', '3m', '', '', '9600bps', ''],
    [1, '    DP #1', 'DisplayPort', 'DP #1', '', '', '', '', '', '', '', '', ''],
    [2, '        DP → HDMI', '변환 잭 · 젠더', 'DP → HDMI', '', '', '', '직결', '', '', '', '', ''],
    [3, '            모니터', '모니터', '작업자 모니터', 'Dell 24"', 'HDMI 1', '', 'HDMI', '3m', '', '', '', '']];
}

/* ── 📥 엑셀 · CSV 에서 가져오기 — 트리 모양으로 쓴 표를 읽어 계층으로 ───────
 *   계층은 ① '레벨' 칸(0 · 1 · 2 …) ② 없으면 '계층' · '이름' 칸 앞 들여쓰기(공백 4칸 · 탭 · └ · ㄴ · - ) ③ 없으면 '상위' 칸(부모 이름) 으로 읽음
 *   종류는 이름 · 종류 칸을 보고 맞춤 (Ethernet · PCIe · 모션 · 모니터 …) — 모르면 '기타 장치' */
var _TP_HEAD = {
  level: /^(레벨|level|단계|depth|lv)$/i, tree: /^(계층|트리|tree|구조)$/i, kind: /^(종류|구분|kind|type|유형)$/i, name: /^(이름|장치|장치명|name|device|명칭)$/i,
  model: /^(모델|model|제조사|제조사\s*·?\s*모델|품번)$/i, port: /^(포트|채널|포트\s*·\s*채널|port|ch|channel|국번)$/i, addr: /^(주소|ip|com|주소\s*·\s*ip\s*·\s*com|address|ip\s*주소)$/i,
  cable: /^(케이블|cable)$/i, len: /^(길이|length|len)$/i, ord: /^(축\s*번호|축번호|axis\s*no\.?|순서)$/i, pts: /^(io\s*점\s*수|점\s*수|points)$/i, note: /^(비고|메모|note|remark|설명)$/i, parent: /^(상위|부모|parent|상위\s*장치)$/i
};
var _TP_KIND_GUESS = [
  [/^(pc|ipc|host)\b|산업용\s*pc|제어\s*pc/i, 'pc'], [/usb.*(rs|시리얼|serial|485|232)|usb\s*to/i, 'usbser'],
  [/변환|젠더|adapter|(dp|hdmi|vga|dvi|display\s*port)\s*(to|→|->)\s*(dp|hdmi|vga|dvi)|→|->/i, 'adapter'],
  [/hdmi/i, 'hdmi'], [/display\s*port|^dp\b|dp\s*#|dp\s*포트/i, 'dp'], [/vga|d-?sub/i, 'vga'], [/dvi/i, 'dvi'], [/모니터|monitor|display/i, 'monitor'], [/poe/i, 'poe'], [/usb.*(rs|시리얼|serial|485|232)|usb\s*to/i, 'usbser'], [/usb/i, 'usb'],
  [/베이스\s*보드|base\s*board/i, 'baseboard'], [/hyper\s*wire/i, 'hyperwire'], [/grabber|그래버/i, 'grabber'], [/멀티\s*포트|multi\s*port/i, 'multiport'], [/nport|시리얼\s*서버/i, 'nport'],
  [/ethercat/i, 'ectmaster'], [/pci\s*-?e|pcie/i, 'pcie'], [/\bpci\b|pci\s*슬롯|pci\s*#/i, 'pci'], [/lan\s*카드|nic/i, 'lancard'], [/허브|hub|switch/i, 'hub'], [/ethernet|이더넷|lan\s*포트|\blan\d?\b/i, 'eth'],
  [/^com\s*\d|rs-?232c?\s*포트|com\s*포트/i, 'com'], [/^(port|포트)\s*\d|시리얼\s*포트/i, 'sport'], [/모션|motion/i, 'motion'], [/^ch\s*\d|축\s*채널/i, 'axisch'],
  [/드라이브|drive|앰프|amp|servo\s*pack/i, 'drive'], [/축|axis|액추|actuator|모터|motor|스테이지|stage/i, 'axis'], [/io\s*카드|dio|io\s*card|입출력\s*카드/i, 'iocard'], [/리모트|remote\s*io|io\s*모듈/i, 'iomod'],
  [/plc/i, 'plc'], [/로봇|robot/i, 'robot'], [/카메라|camera|\bcam\b/i, 'camera'], [/컨트롤러|controller|제어기/i, 'ctrl']
];
function specTopoKindGuess(kindText, nameText) {
  var k = _tpStr(kindText).trim();
  if (k) {
    if (TOPO_KINDS[k]) return k;
    var lk = k.replace(/\s+/g, '').toLowerCase();
    for (var key in TOPO_KINDS) if (TOPO_KINDS[key][0].replace(/\s+/g, '').toLowerCase() === lk) return key;
    for (var i = 0; i < _TP_KIND_GUESS.length; i++) if (_TP_KIND_GUESS[i][0].test(k)) return _TP_KIND_GUESS[i][1];
  }
  var nm = _tpStr(nameText);
  for (var j = 0; j < _TP_KIND_GUESS.length; j++) if (_TP_KIND_GUESS[j][0].test(nm)) return _TP_KIND_GUESS[j][1];
  return 'device';
}
function _tpIndentW(s) {   // 앞 들여쓰기 폭 (공백 · 탭 4 · 전각 2 · 표시 └ ㄴ - 는 1칸씩 더)
  var m = /^([\s　]*)((?:[└ㄴ\-–·•>]\s*)*)/.exec(_tpStr(s)), sp = m[1].replace(/\t/g, '    ').replace(/　/g, '  ').length, mk = (m[2].match(/[└ㄴ\-–·•>]/g) || []).length;
  return sp + mk;
}
function _tpClean(s) { return _tpStr(s).replace(/^[\s　]*((?:[└ㄴ\-–·•>]\s*)*)/, '').trim(); }
/**
 * @param sheets { devices: [[...]], axes?: [[...]], io?: [[...]] }  (첫 줄 = 머리글)
 * @returns { t, warn: [], stat: { nodes, axes, io } }
 */
function specTopoFromSheets(sheets) {
  var warn = [], rows = (sheets && sheets.devices) || [];
  var hi = -1, H = {};
  for (var r = 0; r < Math.min(rows.length, 15) && hi < 0; r++) {   // 머리글 줄 찾기 — 이름 칸이 있는 첫 줄
    var tmp = {};
    (rows[r] || []).forEach(function (c, i) { var s = _tpStr(c).trim(); Object.keys(_TP_HEAD).forEach(function (k) { if (tmp[k] == null && _TP_HEAD[k].test(s)) tmp[k] = i; }); });
    if (tmp.name != null || tmp.tree != null) { hi = r; H = tmp; }
  }
  if (hi < 0) return { t: null, warn: ['머리글 줄을 찾지 못했습니다 — 「이름」(또는 「계층」) 칸이 있어야 합니다'], stat: { nodes: 0, axes: 0, io: 0 } };
  var t = { v: 1, nodes: [], io: [] }, stack = [], byName = {}, made = 0, lastDepth = -1;
  function cell(row, k) { return H[k] == null ? '' : row[H[k]]; }
  // 들여쓰기로 계층을 쓴 경우 — 쓰인 폭(2칸 · 4칸 · 탭 무엇이든)을 작은 순으로 0 · 1 · 2 … 단계로
  var widths = {}, indentCol = H.tree != null ? 'tree' : 'name';
  for (var w0 = hi + 1; w0 < rows.length; w0++) { var raw0 = cell(rows[w0] || [], indentCol); if (_tpClean(raw0)) widths[_tpIndentW(raw0)] = 1; }
  var wList = Object.keys(widths).map(Number).sort(function (x, y) { return x - y; });
  function _tpIndent(v) { return Math.max(0, wList.indexOf(_tpIndentW(v))); }
  for (var i = hi + 1; i < rows.length; i++) {
    var row = rows[i] || [];
    var treeTxt = cell(row, 'tree'), nameRaw = H.name != null ? cell(row, 'name') : treeTxt;
    var name = _tpClean(nameRaw) || _tpClean(treeTxt);
    if (!name) continue;
    if (t.nodes.length >= TOPO_MAX_NODES) { warn.push('장치가 ' + TOPO_MAX_NODES + '개를 넘어 나머지는 뺐습니다'); break; }
    var depth;
    var lv = cell(row, 'level');
    if (lv !== '' && lv != null && isFinite(+lv)) depth = Math.max(0, Math.round(+lv));
    else if (H.tree != null && _tpStr(treeTxt).trim()) depth = _tpIndent(treeTxt);
    else if (H.parent != null) depth = -1;
    else depth = _tpIndent(nameRaw);
    var parentId = null;
    if (depth === -1) {   // 상위 칸
      var pn = _tpClean(cell(row, 'parent')); parentId = pn && byName[pn] ? byName[pn] : null;
      if (pn && !parentId) warn.push((i + 1) + '줄 「' + name + '」: 상위 「' + pn + '」를 찾지 못해 맨 위에 둡니다');
    } else {
      if (depth > lastDepth + 1 && lastDepth >= -1) { if (depth > lastDepth + 1) warn.push((i + 1) + '줄 「' + name + '」: 레벨이 ' + (depth - lastDepth - 1) + '단계 건너뛰어 바로 위 장치 아래로 둡니다'); depth = lastDepth + 1; }
      stack.length = depth; parentId = depth > 0 ? stack[depth - 1] || null : null;
    }
    var kind = specTopoKindGuess(cell(row, 'kind'), name);
    var n = { id: _tpId('n'), parent: parentId, kind: kind, name: name.slice(0, 80), model: _tpStr(cell(row, 'model')).trim().slice(0, 80), port: _tpStr(cell(row, 'port')).trim().slice(0, 40), addr: _tpStr(cell(row, 'addr')).trim().slice(0, 60), note: _tpStr(cell(row, 'note')).trim().slice(0, 200) };
    var kt = _tpStr(cell(row, 'kind')).trim(); if (kind === 'device' && kt && kt !== TOPO_KINDS.device[0]) n.kl = kt.slice(0, 30);   // v13.479 모르는 종류 이름은 그대로 둠(직접 만든 항목)
    var cb = _tpStr(cell(row, 'cable')).trim(), ln = _tpStr(cell(row, 'len')).trim();
    if (cb) n.cable = cb.slice(0, 40); if (ln) n.len = ln.slice(0, 20);
    var od = cell(row, 'ord'); if (od !== '' && od != null && isFinite(+od)) n.ord = +od;
    var pt = cell(row, 'pts'); if (pt !== '' && pt != null && isFinite(+pt)) n.pts = Math.max(0, Math.round(+pt));
    t.nodes.push(n); made++;
    if (depth >= 0) { stack[depth] = n.id; lastDepth = depth; }
    if (!byName[name]) byName[name] = n.id;
  }
  // 축 순서 장 — 이름으로 맞춰 축 번호
  var axRows = (sheets && sheets.axes) || [], axN = 0;
  if (axRows.length > 1) {
    var ah = axRows[0].map(function (c) { return _tpStr(c).trim(); }), ai = ah.findIndex(function (c) { return _TP_HEAD.ord.test(c); }), an = ah.findIndex(function (c) { return /^(축\s*이름|이름|축)$/.test(c); });
    if (ai >= 0 && an >= 0) axRows.slice(1).forEach(function (row) {
      var nm = _tpStr(row[an]).trim(), ord = +row[ai]; if (!nm || !isFinite(ord)) return;
      var hit = t.nodes.filter(function (x) { return x.kind === 'axis' && x.name === nm; })[0];
      if (hit) { hit.ord = ord; axN++; }
    });
  }
  t.nodes.forEach(function (x) { if (x.kind !== 'axis') delete x.ord; });
  _tpRenumberAxes(t);
  // IO 장 — 장치 이름으로 맞춤
  var ioRows = (sheets && sheets.io) || [], ioN = 0, ioMiss = {};
  if (ioRows.length > 1) {
    var ih = ioRows[0].map(function (c) { return _tpStr(c).trim(); });
    var col = function (re) { return ih.findIndex(function (c) { return re.test(c); }); };
    var cDev = col(/^(장치|카드|device)$/), cDir = col(/^(방향|dir|구분)$/), cAddr = col(/^(주소|address|addr)$/), cNm = col(/^(이름|name|신호)$/), cDs = col(/^(설명|desc|비고)$/), cCon = col(/^(연결\s*장치|연결|대상)$/);
    ioRows.slice(1).forEach(function (row) {
      var dn = _tpStr(row[cDev]).trim(); if (!dn && cAddr < 0) return;
      var node = byName[dn]; if (!node) { if (dn) ioMiss[dn] = 1; return; }
      if (t.io.length >= TOPO_MAX_IO) return;
      var dir = _tpStr(row[cDir]).trim().toUpperCase(); dir = TOPO_IO_DIRS.indexOf(dir) >= 0 ? dir : /^Y/i.test(_tpStr(row[cAddr])) ? 'DO' : 'DI';
      t.io.push({ id: _tpId('io'), node: node, dir: dir, addr: _tpStr(row[cAddr]).trim().slice(0, 20), name: _tpStr(row[cNm]).trim().slice(0, 80), desc: _tpStr(row[cDs]).trim().slice(0, 200), dev: _tpStr(row[cCon]).trim().slice(0, 80) });
      ioN++;
    });
  }
  var miss = Object.keys(ioMiss); if (miss.length) warn.push('IO 리스트의 장치 ' + miss.slice(0, 5).join(', ') + (miss.length > 5 ? ' …' : '') + ' 를 장치 목록에서 찾지 못해 그 점은 뺐습니다');
  var guessed = t.nodes.filter(function (x) { return x.kind === 'device'; }).length; if (guessed) warn.push('종류를 알아보지 못한 장치 ' + guessed + '개는 「기타 장치」로 두었습니다 — 목록에서 종류를 고르세요');
  return { t: made ? specTopoNorm(t) : null, warn: warn, stat: { nodes: made, axes: axN, io: ioN } };
}
/** 가져온 것을 붙이기 — mode 'replace' 통째 바꾸기 · 'append' 고른 장치(없으면 맨 위 PC) 아래에 덧붙이기 (가져온 맨 위가 PC 면 그 아래 것만) */
function specTopoMerge(t, inc, mode, atId) {
  if (mode === 'replace' || !t || !t.nodes.length) return specTopoNorm(inc);
  var out = specTopoNorm(t), at = atId && specTopoNode(out, atId) ? atId : (specTopoChildren(out, null).filter(function (n) { return n.kind === 'pc'; })[0] || {}).id || null;
  var roots = specTopoChildren(inc, null), skip = {};
  if (at && roots.length === 1 && roots[0].kind === 'pc') skip[roots[0].id] = 1;   // 가져온 것의 PC 는 지금 PC 와 같은 것으로
  if (out.nodes.length + inc.nodes.length > TOPO_MAX_NODES) return null;
  inc.nodes.forEach(function (n) { if (skip[n.id]) return; var c = JSON.parse(JSON.stringify(n)); if (!c.parent || skip[c.parent]) c.parent = at; out.nodes.push(c); });
  inc.io.forEach(function (r) { if (!skip[r.node]) out.io.push(JSON.parse(JSON.stringify(r))); });
  _tpRenumberAxes(out);
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TOPO_KINDS: TOPO_KINDS, TOPO_CATS: TOPO_CATS, topoKind: topoKind, topoKindN: topoKindN, topoCatN: topoCatN, TOPO_CAT_ICON: TOPO_CAT_ICON, TOPO_KIND_ORDER: TOPO_KIND_ORDER, specTopoNorm: specTopoNorm, specTopoEmpty: specTopoEmpty, specTopoChildren: specTopoChildren, specTopoNode: specTopoNode, specTopoName: specTopoName, specTopoFlat: specTopoFlat, specTopoPath: specTopoPath,
    specTopoAdd: specTopoAdd, specTopoRemove: specTopoRemove, specTopoDup: specTopoDup, specTopoMove: specTopoMove, specTopoIndent: specTopoIndent, specTopoOutdent: specTopoOutdent, specTopoReparent: specTopoReparent,
    specTopoAxes: specTopoAxes, specTopoAxisMove: specTopoAxisMove, specTopoAxisInfo: specTopoAxisInfo, specTopoIoNodes: specTopoIoNodes, specTopoIoAdd: specTopoIoAdd, specTopoIoSummary: specTopoIoSummary, specTopoIoDup: specTopoIoDup,
    TOPO_PRESETS: TOPO_PRESETS, specTopoPreset: specTopoPreset, specTopoMonitors: specTopoMonitors, TOPO_ICONS: TOPO_ICONS, topoIconSvg: topoIconSvg, specTopoChecks: specTopoChecks, TOPO_FILTERS: TOPO_FILTERS, specTopoFocus: specTopoFocus, specTopoFilterCount: specTopoFilterCount, specTopoSeed: specTopoSeed, specTopoLayout: specTopoLayout, specTopoSvg: specTopoSvg, specTopoRows: specTopoRows, specTopoTemplateRows: specTopoTemplateRows, specTopoFromSheets: specTopoFromSheets, specTopoMerge: specTopoMerge, specTopoKindGuess: specTopoKindGuess, TOPO_ROW_HEAD: TOPO_ROW_HEAD };
}
