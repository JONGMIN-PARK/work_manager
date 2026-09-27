// timeline.js — renderTimeline / showProjectModal 출력 스냅샷 (리팩터링 안전망)
// 실행: node --test   · 스냅샷 갱신: UPDATE_SNAPSHOT=1 node --test test/timeline-render.test.js
'use strict';
process.env.TZ = 'Asia/Seoul';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SNAP_RENDER = path.join(__dirname, 'fixtures', 'timeline-render.html');
const SNAP_MODAL = path.join(__dirname, 'fixtures', 'timeline-modal.html');
const UPDATE = process.env.UPDATE_SNAPSHOT === '1';

// 2026-09-27(일) 10:00 KST
const NOW = Date.UTC(2026, 8, 27, 1, 0);

/* ── 픽스처 ── */
function fixture() {
  const projects = [
    { id: 'p1', name: '장비 A 개발', orderNo: 'SO-001', color: '#3B82F6', status: 'active', startDate: '2026-08-01', endDate: '2026-11-30',
      progress: 45, assignees: ['김철수', '이영희'], sortOrder: 2, createdAt: '2026-07-01T00:00:00Z', currentPhase: 'manufacture',
      phases: { order: { status: 'done', startDate: '2026-08-01', endDate: '2026-08-10' }, design: { status: 'done', startDate: '2026-08-11', endDate: '2026-09-10' }, manufacture: { status: 'active', startDate: '2026-09-11' } },
      memo: '<p>메모</p><img src="data:image/png;base64,AAAA"><img src="data:image/png;base64,BBBB">', visibility: 'dept', estimatedHours: 300, dependencies: [] },
    { id: 'p2', name: '라인 B 개조', orderNo: 'SO-002', color: '#F97316', status: 'active', startDate: '2026-07-01', endDate: '2026-09-15',
      progress: 80, assignees: ['박민수', '최지훈', '정다은', '한서준'], sortOrder: 1, createdAt: '2026-06-01T00:00:00Z', dependencies: ['p5'] },
    { id: 'p3', name: '검사기 C', orderNo: 'SO-003', color: '#10B981', status: 'done', startDate: '2026-05-01', endDate: '2026-07-31',
      progress: 100, assignees: ['김철수'], createdAt: '2026-04-01T00:00:00Z', currentPhase: 'deliver', dependencies: [] },
    { id: 'p4', name: '보류 과제 D', orderNo: 'SO-004', color: '#A855F7', status: 'hold', startDate: '2026-10-01', endDate: '2026-12-31',
      progress: 0, assignees: ['이영희'], sortOrder: 3, createdAt: '2026-08-01T00:00:00Z', dependencies: ['p1'] },
    { id: 'p5', name: '신규 E', orderNo: 'SO-005', color: '#EC4899', status: 'waiting', startDate: '2026-10-15', endDate: '2027-01-20',
      progress: 0, assignees: [], createdAt: '2026-09-01T00:00:00Z', dependencies: ['p3'] },
    { id: 'p6', name: '<특수&"이름">', orderNo: 'SO-006', color: '#64748B', status: 'waiting', startDate: '', endDate: '',
      progress: 10, assignees: ['김철수'], createdAt: '2026-09-10T00:00:00Z' },
  ];
  const milestones = [
    { id: 'm1', projectId: 'p1', name: '설계', startDate: '2026-08-01', endDate: '2026-08-31', status: 'done', order: 0, progress: 100,
      assigneeTargets: { '김철수': 40, '이영희': 20 }, reportedHours: 55, createdAt: '2026-07-01' },
    { id: 'm2', projectId: 'p1', name: '제작', startDate: '2026-09-01', endDate: '2026-10-15', status: 'active', order: 1, progress: 40,
      assigneeTargets: { '김철수': 80 }, reportedHours: 30.25, progressUpdatedAt: '2026-09-20', createdAt: '2026-07-02' },
    { id: 'm3', projectId: 'p1', name: '셋업', startDate: '2026-09-10', endDate: '2026-09-20', status: 'delayed', order: 2, progress: 0, createdAt: '2026-07-03' },
    { id: 'm4', projectId: 'p1', name: '출하', startDate: '', endDate: '2026-11-30', status: 'waiting', order: 3, createdAt: '2026-07-04' },
    { id: 'm5', projectId: 'p4', name: '재검토', startDate: '2026-10-01', endDate: '2026-10-20', status: 'hold', order: 0, createdAt: '2026-08-02' },
    { id: 'm6', projectId: 'p2', name: '철거', startDate: '2026-07-01', endDate: '2026-07-20', status: 'done', order: 0, progress: 100, createdAt: '2026-06-02' },
  ];
  const archive = [
    { milestoneId: 'm2', hours: 8 }, { milestoneId: 'm2', hours: 4.5 }, { milestoneId: 'm1', hours: 2 }, { hours: 3 },
  ];
  return { projects, milestones, archive };
}

/* ── 가짜 DOM ── */
function fakeEl(tag, id) {
  const e = {
    tagName: String(tag || 'div').toUpperCase(), id: id || '', className: '', _html: '', children: [], attrs: {},
    style: {}, scrollLeft: 0, scrollTop: 0, clientWidth: 1200, scrollWidth: 5000, scrollHeight: 900,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild(c) { e.children.push(c); c.parentNode = e; return c; },
    setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute(k) { return e.attrs[k]; },
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {},
    remove() { e.removed = true; if (e.parentNode) { const i = e.parentNode.children.indexOf(e); if (i >= 0) e.parentNode.children.splice(i, 1); } },
  };
  Object.defineProperty(e, 'innerHTML', { get() { return e._html; }, set(v) { e._html = String(v); if (e.onHtml) e.onHtml(e._html); } });
  return e;
}
function serNS(n) {
  if (!n || !n.tag) return '';
  const a = Object.keys(n.attrs).map((k) => ' ' + k + '="' + n.attrs[k] + '"').join('');
  return '<' + n.tag + a + (n.style.cssText ? ' style="' + n.style.cssText + '"' : '') + '>' + n.children.map(serNS).join('') + '</' + n.tag + '>';
}

// tlScroll 안의 .tl-row[data-proj-id] 행을 HTML 에서 흉내 (offsetTop/바 위치)
const FAKE_LABEL_W = 240;
function fakeRows(html) {
  const rows = [];
  const re = /<div class="tl-row ([^"]*)"( data-ms-id="[^"]*")? data-proj-id="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    const idx = rows.length;
    const pid = m[3];
    const isProj = m[1].indexOf('tl-row-proj') >= 0;
    let bar = null;
    if (isProj) {
      const bre = new RegExp('data-type="proj" data-id="' + pid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '" style="([^"]*)"');
      const bm = bre.exec(html);
      const st = bm ? bm[1] : '';
      const l = /left:([\d.]+)px/.exec(st), w = /width:([\d.]+)px/.exec(st);
      const L = l ? +l[1] : 0, W = w ? +w[1] : 0, T = idx * 40 + 10;
      // 막대 영역은 라벨 열(FAKE_LABEL_W) 뒤에서 시작 — 스크롤 박스는 (0,0), 스크롤 0
      bar = { offsetLeft: L, offsetWidth: W,
        getBoundingClientRect: () => ({ left: FAKE_LABEL_W + L, right: FAKE_LABEL_W + L + W, top: T, bottom: T + 20, width: W, height: 20 }) };
    }
    rows.push({ dataset: { projId: pid }, offsetTop: idx * 40, offsetHeight: 40, querySelector: () => bar });
  }
  return rows;
}

function load(opts) {
  opts = opts || {};
  const RealDate = Date;
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW); }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => NOW;
  FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;

  const els = {};
  const body = fakeEl('body');
  const created = [];
  const st = { els, body, created, scroll: null, svg: '' };

  function mkScroll() {
    const sc = fakeEl('div', 'tlScroll');
    sc.querySelector = (sel) => (sel === '.tl-dep-svg' ? null : null);
    sc._rows = [];
    sc.querySelectorAll = (sel) => (sel === '.tl-row[data-proj-id]' ? sc._rows : []);
    sc.appendChild = (c) => { sc.children.push(c); st.svg = serNS(c); return c; };
    sc.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900 });
    return sc;
  }
  ['timelineWrap', 'tlContent', 'tlControls', 'tlProjList'].forEach((id) => { els[id] = fakeEl('div', id); });
  els.tlContent.onHtml = (h) => {
    if (h.indexOf('id="tlScroll"') >= 0) {
      const prev = st.scroll;
      st.scroll = mkScroll();
      st.scroll._rows = fakeRows(h);
      if (prev) { /* 새 요소 — 이전 위치는 렌더 코드가 복원 */ }
    } else st.scroll = null;
  };
  const document = {
    body,
    getElementById(id) {
      if (id === 'tlScroll') return st.scroll;
      if (els[id]) return els[id];
      // body 에 붙은 모달(가짜 트리)에서 id 검색
      const find = (n) => { if (n.id === id && !n.removed) return n; for (const c of n.children || []) { const r = find(c); if (r) return r; } return null; };
      const hit = find(body);
      if (hit) return hit;
      // innerHTML 문자열 안의 id → 루트별 가상 요소 (value/innerHTML 기록)
      const findIn = (n) => { if (n._html && n._html.indexOf('id="' + id + '"') >= 0) return n; for (const c of n.children || []) { const r = findIn(c); if (r) return r; } return null; };
      const root = findIn(body);
      if (!root) return null;
      root._virt = root._virt || {};
      if (!root._virt[id]) { root._virt[id] = fakeEl('div', id); root._virt[id].value = ''; }
      return root._virt[id];
    },
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === '.wa-modal-overlay') return body.children.filter((c) => c.className === 'wa-modal-overlay');
      return [];
    },
    createElement(tag) {
      if (tag === 'canvas') {
        return { getContext() { return { font: '', measureText(t) { const px = +((/(\d+)px/.exec(this.font) || [0, 10])[1]); return { width: String(t).length * px * 0.6 }; } }; } };
      }
      const e = fakeEl(tag); created.push(e); return e;
    },
    createElementNS(ns, tag) {
      const n = { tag, attrs: {}, children: [], style: {}, setAttribute(k, v) { n.attrs[k] = String(v); }, appendChild(c) { n.children.push(c); return c; } };
      return n;
    },
    addEventListener() {}, removeEventListener() {},
  };
  const store = Object.assign({}, opts.ls || {});
  const sandbox = {
    console, setTimeout: (fn, ms) => { (st.timers = st.timers || []).push(ms); return 0; }, clearTimeout() {}, Promise, JSON, Math, Object, Array, String, Number, Set, RegExp, parseInt, parseFloat, isNaN,
    Date: FakeDate,
    window: { _tlOv: {} }, document,
    localStorage: { getItem(k) { return k in store ? store[k] : null; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; } },
    DOMParser: function () { this.parseFromString = () => ({ getElementById: () => ({ childNodes: [], innerHTML: '' }) }); },
    eH: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    shortName: (n) => String(n).slice(1),
    requestAnimationFrame() {},
    getComputedStyle: (el) => ({ position: (el && el.style && el.style.position) || 'static' }),
  };
  vm.createContext(sandbox);
  for (const f of ['config.js', 'project-data.js', 'timeline.js']) {
    // TL_SRC: 비교용 원본 timeline.js 경로(스냅샷 생성 시에만)
    const file = (f === 'timeline.js' && process.env.TL_SRC) ? process.env.TL_SRC : path.join(ROOT, f);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: f });
  }
  const fx = opts.fixture || fixture();
  sandbox.pmGetProjects = async () => fx.projects;
  sandbox.projGetAll = async () => fx.projects;
  sandbox.msGetAll = async () => fx.milestones;
  sandbox.projGet = async (id) => fx.projects.find((p) => p.id === id) || null;
  sandbox.msGetByProject = async (id) => fx.milestones.filter((m) => m.projectId === id).map((m) => Object.assign({}, m));
  sandbox.msDel = async () => {};
  sandbox.readAllArchiveRecords = async () => fx.archive;
  sandbox.showToast = () => {};
  sandbox.memberGroups = [{ id: 'g1', name: '설계팀', members: ['김철수', '이영희'] }];
  sandbox.ORDER_MAP = { 'SO-001': { name: '장비 A 개발' }, 'SO-009': '문자열 이름' };
  st.sb = sandbox;
  return st;
}

function capture(st) {
  const s = st.sb;
  return [
    '== controls ==', st.els.tlControls.innerHTML,
    '== list ==', st.els.tlProjList.innerHTML,
    '== content ==', st.els.tlContent.innerHTML,
    '== state ==', JSON.stringify({
      scroll: st.scroll ? [st.scroll.scrollLeft, st.scroll.scrollTop] : null,
      rangeStart: s.tlRangeStart ? s.tlRangeStart.toISOString() : null,
      units: s.tlUnits ? s.tlUnits.length : null, labelW: s.tlLabelW, jump: s._tlJumpDate,
      ov: s.window._tlOv,
    }),
    '== svg ==', st.svg,
  ].join('\n');
}

/* ── 렌더 시나리오 ── */
const SCENARIOS = [
  ['default-day', {}],
  ['week-edit-dday-critical', { tlScale: 'week', tlEditMode: true, tlDayOffset: true, showCriticalPath: true }],
  ['month-group-reorder-nothumb-compact', { tlScale: 'month', tlGroupBy: 'status', tlMsReorder: true, tlShowThumb: false, tlDensity: 'compact' }],
  ['quarter-filter-active', { tlScale: 'quarter', tlFilterStatus: 'active' }],
  ['hour-filter-assignee', { tlScale: 'hour', tlFilterAssignee: '박민수' }],
  ['hide-done-name-desc', { tlHideDone: true, tlSort: 'name_desc', tlThumbSize: 56 }],
  ['sort-created', { tlSort: 'created', tlScale: 'month' }],
  ['sort-created-desc', { tlSort: 'created_desc', tlScale: 'month' }],
  ['sort-deadline', { tlSort: 'deadline', tlScale: 'month' }],
  ['sort-progress', { tlSort: 'progress', tlScale: 'month' }],
  ['sort-status-group', { tlSort: 'status', tlGroupBy: 'status', tlScale: 'month' }],
  ['sort-name-critical-day', { tlSort: 'name', showCriticalPath: true, tlDayOffset: true, tlEditMode: true, tlMsReorder: true }],
  ['filter-empty', { tlFilterStatus: 'delayed', tlFilterAssignee: '김철수' }],
  ['jump-out-of-range', { _tlJumpDate: '2028-03-15', tlScale: 'month' }],
  ['collapsed', { tlCollapsed: ['p1'], tlScale: 'week' }],
];

async function renderScenario(name, vars) {
  const st = load();
  for (const k of Object.keys(vars)) {
    if (k === 'tlCollapsed') vars[k].forEach((id) => st.sb.tlCollapsed.add(id));
    else st.sb[k] = vars[k];
  }
  await st.sb.renderTimeline();
  let out = capture(st);
  // 재렌더(이전 스크롤 위치 복원 경로)
  if (st.scroll) { st.scroll.scrollLeft = 321; st.scroll.scrollTop = 45; }
  await st.sb.renderTimeline();
  out += '\n== rerender ==\n' + JSON.stringify(st.scroll ? [st.scroll.scrollLeft, st.scroll.scrollTop] : null) + '\n' +
    (st.els.tlContent.innerHTML === out.split('== content ==\n')[1].split('\n== state ==')[0] ? 'same-content' : st.els.tlContent.innerHTML);
  return '<!-- scenario: ' + name + ' -->\n' + out + '\n';
}

async function renderAll() {
  let s = '';
  for (const [n, v] of SCENARIOS) s += await renderScenario(n, v);
  // 프로젝트 0건
  const st = load({ fixture: { projects: [], milestones: [], archive: [] } });
  await st.sb.renderTimeline();
  s += '<!-- scenario: no-projects -->\n' + capture(st) + '\n';
  // 전 프로젝트 날짜 없음(오늘 기준 폴백)
  const st2 = load({ fixture: { projects: [{ id: 'q1', name: 'X', color: '#123456', status: 'active', startDate: '', endDate: '' }], milestones: [], archive: [] } });
  await st2.sb.renderTimeline();
  s += '<!-- scenario: no-dates -->\n' + capture(st2) + '\n';
  return s;
}

function checkSnap(file, actual) {
  if (UPDATE || !fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, actual, 'utf8');
    return;
  }
  const expected = fs.readFileSync(file, 'utf8');
  if (expected !== actual) {
    // 첫 차이 위치를 보여준다
    let i = 0; while (i < expected.length && expected[i] === actual[i]) i++;
    assert.fail('스냅샷 불일치 @' + i + '\nexpected: ' + JSON.stringify(expected.slice(Math.max(0, i - 120), i + 120)) + '\nactual:   ' + JSON.stringify(actual.slice(Math.max(0, i - 120), i + 120)));
  }
}

test('renderTimeline 출력 스냅샷 (모든 시나리오 byte-identical)', async () => {
  checkSnap(SNAP_RENDER, await renderAll());
});

/* ── 모달 스냅샷 — 오버레이/박스의 유효 스타일 + 본문 마크업 ── */
// cssText → { prop: value } (뒤 선언 우선) — 원본(수제 오버레이)과 createModal 결과를 같은 기준으로 비교
function cssMap(css) {
  const m = {};
  String(css || '').split(';').forEach((d) => {
    const i = d.indexOf(':'); if (i <= 0) return;
    const k = d.slice(0, i).trim(), v = d.slice(i + 1).trim();
    if (k === 'inset') { m.top = v; m.left = v; m.width = '100%'; m.height = '100%'; return; } // fixed + inset:0 ≡ top/left 0 + 100%
    if (k === 'overflow') delete m['overflow-y'];   // 단축 속성이 뒤에 오면 overflow-y 덮어씀
    m[k] = v;
  });
  // 효과 없는(초기값) 선언 제거 → 원본에 없던 속성과 동치
  const NEUTRAL = { padding: '0', 'box-shadow': 'none', color: 'inherit', 'max-height': 'none', 'overflow-y': 'visible', width: 'auto' };
  Object.keys(NEUTRAL).forEach((k) => { if (m[k] === NEUTRAL[k]) delete m[k]; });
  const o = {}; Object.keys(m).sort().forEach((k) => { o[k] = m[k]; }); return o;
}
// 모달 루트(오버레이) → { id, overlay, boxCls, box, content } — 수제 오버레이/createModal 공통 기준
function describeModal(ov) {
  if (!ov) return null;
  let boxStyle, content, boxCls;
  const box = ov.children.find((c) => c.className && c.className.indexOf('wa-modal-box') >= 0);
  if (box) {
    boxStyle = box.style.cssText; boxCls = box.className.replace('wa-modal-box', '').trim();
    content = box.children.map((c) => c.innerHTML).join('');
  } else {
    const mm = /^<div( class="([^"]*)")? style="([^"]*)">([\s\S]*)<\/div>$/.exec(ov.innerHTML);
    boxStyle = mm ? mm[3] : ''; boxCls = mm && mm[2] ? mm[2] : ''; content = mm ? mm[4] : ov.innerHTML;
  }
  return { id: ov.id, overlay: cssMap(ov.style.cssText), boxCls, box: cssMap(boxStyle), content };
}

async function modalSnapshot() {
  const out = [];
  const st = load();
  const s = st.sb;
  const top = () => st.body.children[st.body.children.length - 1];
  await s.showProjectModal();
  out.push(['projModal:new', describeModal(s.document.getElementById('projModal'))]);
  await s.showProjectModal('p1');
  out.push(['projModal:edit', describeModal(s.document.getElementById('projModal'))]);
  out.push(['staging', { orig: s.window._projMsOrigIds, stg: s._msTargetStaging, seq: s._msRowKeySeq }]);
  await s.showProjectModal('p4');
  out.push(['projModal:edit-p4', describeModal(top())]);
  // 목표 배분 매트릭스
  const aEl = s.document.getElementById('projAssignees');
  const origGet = s.document.getElementById;
  s.document.getElementById = (id) => (id === 'projAssignees' ? { value: '김철수, 이영희, 김철수' } : origGet(id));
  s.document.querySelectorAll = (sel) => (sel === '#msRows .proj-ms-row'
    ? [{ getAttribute: () => 'm5', querySelector: () => ({ value: '재검토' }) }, { getAttribute: () => 'new-1', querySelector: () => ({ value: '' }) }]
    : []);
  s._msTargetStaging['m5'] = { '김철수': 12 };
  s.editMsTargetsMatrix();
  s.document.getElementById = origGet;
  s.document.querySelectorAll = (sel) => (sel === '.wa-modal-overlay' ? st.body.children.filter((c) => c.className === 'wa-modal-overlay') : []);
  void aEl;
  out.push(['msTargetsModal', describeModal(top())]);
  s.projCopy = async () => {};
  s.showProjectCopyModal('p1');
  await new Promise((r) => setImmediate(r));
  out.push(['projCopyModal', describeModal(top())]);
  s.projMembersGet = async () => [{ userId: 'u1', userName: '김철수', role: 'pl' }];
  s.userLookup = async () => [{ id: 'u1', displayName: '김철수' }, { id: 'u2', displayName: '이영희' }];
  await s.showProjectShareModal('p1');
  out.push(['projShareModal', describeModal(top()), s.document.getElementById('projShareBody') && s.document.getElementById('projShareBody').innerHTML]);
  s.projMembersGet = async () => { throw new Error('boom'); };
  await s.showProjectShareModal('p1');
  out.push(['projShareModal:err', s.document.getElementById('projShareBody').innerHTML]);
  await s.showProjectTransferModal('p1');
  out.push(['projTransferModal', describeModal(top()), s.document.getElementById('projTransferBody').innerHTML]);
  await s.showMilestoneTransferModal('m1');
  out.push(['msTransferModal', describeModal(top()), s.document.getElementById('msTransferBody').innerHTML]);
  out.push(['open-ids', st.body.children.map((c) => c.id)]);
  return out.map((x) => '<!-- ' + x[0] + ' -->\n' + JSON.stringify(x.slice(1), null, 1)).join('\n') + '\n';
}

test('모달 스냅샷 (유효 스타일·본문 마크업·id 동일)', async () => {
  checkSnap(SNAP_MODAL, await modalSnapshot());
});

/* ── saveProjectUI 호출 기록 스냅샷 — 검증·payload·마일스톤 diff·오류 메시지 ── */
const SNAP_SAVE = path.join(__dirname, 'fixtures', 'timeline-save.html');
function msRow(msid, rowkey, name, start, end, status) {
  const f = { '.ms-name': { value: name }, '.ms-start': { value: start }, '.ms-end': { value: end }, '.ms-status': { value: status } };
  const a = { 'data-msid': msid, 'data-rowkey': rowkey };
  return { querySelector: (q) => f[q], getAttribute: (k) => (a[k] == null ? null : a[k]) };
}
async function saveCase(name, form, opts) {
  opts = opts || {};
  const st = load();
  const s = st.sb;
  const log = [];
  const rec = (fn) => async (...a) => { log.push([fn, JSON.parse(JSON.stringify(a))]); if (opts[fn]) return opts[fn](...a); return undefined; };
  s.updateProject = rec('updateProject'); s.createProject = rec('createProject');
  s.msPut = rec('msPut'); s.createMilestone = rec('createMilestone'); s.msDel = rec('msDel');
  s.syncAssigneesToMembers = rec('syncAssigneesToMembers'); s.pimgFlushStaging = rec('pimgFlushStaging');
  s.showToast = (m, t) => log.push(['toast', m, t || '']);
  s.window._projMsOrigIds = opts.origIds || null;
  s._msTargetStaging = opts.staging || {};
  const modal = fakeEl('div', 'projModal');
  const ids = Object.assign({ projModal: modal }, form.ids);
  const origGet = s.document.getElementById;
  s.document.getElementById = (id) => (id in ids ? ids[id] : origGet(id));
  s.document.querySelectorAll = (q) => (q === '.proj-dep-chk:checked' ? (form.deps || []).map((v) => ({ value: v }))
    : q === '#msRows .proj-ms-row' ? (form.rows || []) : []);
  const errs = [];
  const oe = console.error; console.error = (...a) => errs.push(a.map(String).join(' ').slice(0, 80));
  try { await s.saveProjectUI(form.existingId || ''); } finally { console.error = oe; }
  return '<!-- save: ' + name + ' -->\n' + JSON.stringify({ log, removed: !!modal.removed, origIds: s.window._projMsOrigIds, timers: st.timers || [], errs }, null, 1) + '\n';
}
function baseIds(o) {
  const v = (x) => ({ value: x });
  return Object.assign({
    projName: v('  새 이름 '), projOrderNo: v(' SO-9 '), projStart: v('2026-09-01'), projEnd: v('2026-12-31'),
    projAssignees: v('김철수, , 이영희 '), projStatus: v('active'), projEstHours: v('12.5'),
    projMemo: { innerHTML: ' <br> ' }, projVisibility: v('dept'),
  }, o || {});
}
async function saveAll() {
  let out = '';
  out += await saveCase('no-dates', { ids: baseIds({ projEnd: { value: '' } }) });
  out += await saveCase('start-after-end', { ids: baseIds({ projStart: { value: '2027-01-01' } }) });
  out += await saveCase('self-dep', { existingId: 'p1', deps: ['p2', 'p1'], ids: baseIds() });
  out += await saveCase('edit-diff', {
    existingId: 'p1', deps: ['p3'],
    ids: baseIds({ projName: { value: '' }, projVisibility: undefined, projEstHours: { value: 'x' } }),
    rows: [msRow('m1', 'm1', ' 설계2 ', '2026-08-01', '2026-08-31', 'done'), msRow(null, 'new-1', '신규', '2026-10-01', '2026-10-05', 'waiting'),
      msRow(null, 'new-2', '신규', '2026-10-01', '2026-10-05', 'active'), msRow(null, 'new-3', '  ', '', '', 'waiting'), msRow('zz', 'zz', '외부', '', '', 'hold')],
  }, { origIds: ['m1', 'm2', 'm3'], staging: { m1: { '김철수': 10 }, 'new-1': { '이영희': 4 } } });
  out += await saveCase('create-private-alone', { ids: baseIds({ projName: { value: '' }, projOrderNo: { value: '' }, projAssignees: { value: '' }, projVisibility: { value: 'private' }, projMemo: { innerHTML: '<div><br></div>' } }) },
    { createProject: async () => ({ id: 'new1' }) });
  out += await saveCase('create-null', { ids: baseIds() }, { createProject: async () => null });
  out += await saveCase('conflict', { existingId: 'p1', ids: baseIds() },
    { updateProject: async () => { const e = new Error('x'); e.data = { error: 'CONFLICT' }; e.status = 409; throw e; } });
  out += await saveCase('server-msg', { existingId: 'p1', ids: baseIds() },
    { updateProject: async () => { const e = new Error('plain'); e.data = { message: '권한 없음' }; throw e; } });
  out += await saveCase('plain-err', { existingId: 'p1', ids: baseIds() },
    { updateProject: async () => { throw new Error('network'); } });
  return out;
}
test('saveProjectUI 호출 기록 스냅샷', async () => {
  checkSnap(SNAP_SAVE, await saveAll());
});
