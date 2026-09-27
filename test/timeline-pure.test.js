// timeline.js — 순수 헬퍼(필터/정렬·범위/단위·HTML 조각) + 크리티컬 패스
// 실행: node --test
'use strict';
process.env.TZ = 'Asia/Seoul';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 2026-09-27(일) 10:00 KST
const NOW = Date.UTC(2026, 8, 27, 1, 0);

function load() {
  const RealDate = Date;
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW); }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => NOW;
  FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
  const els = {};
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, JSON, Math, Object, Array, String, Number, Set,
    Date: FakeDate,
    window: {},
    document: { getElementById(id) { return els[id] || null; }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return { style: {} }; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    eH: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
  };
  vm.createContext(sandbox);
  for (const f of ['config.js', 'project-data.js', 'timeline.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
  }
  sandbox.__els = els;
  return sandbox;
}
const plain = (x) => JSON.parse(JSON.stringify(x));
const ids = (list) => list.map((p) => p.id);

const P = [
  { id: 'a', name: '나', status: 'active', startDate: '2026-09-01', endDate: '2026-10-31', progress: 30, assignees: ['김', '이'], createdAt: '2026-01-02', sortOrder: 2 },
  { id: 'b', name: '가', status: 'active', startDate: '2026-08-01', endDate: '2026-09-10', progress: 90, assignees: ['박'], createdAt: '2026-01-01' },   // 지연
  { id: 'c', name: '다', status: 'done', startDate: '2026-05-01', endDate: '2026-06-30', progress: 100, assignees: ['김'], createdAt: '2026-01-03', sortOrder: 1 },
  { id: 'd', name: '라', status: 'hold', startDate: '2026-10-01', endDate: '2026-12-31', progress: 0, assignees: [], createdAt: '2026-01-04' },
  { id: 'e', name: 'ABC', status: 'waiting', startDate: '2026-11-01', endDate: '2027-01-31', createdAt: '2026-01-05' },
];
const MS = [{ id: 'm1', projectId: 'a' }, { id: 'm2', projectId: 'c' }, { id: 'm3', projectId: 'zz' }];
const OPT = { hideDone: false, status: 'all', assignee: 'all', sort: 'default', groupBy: 'none' };

/* ── _tlFilterSort ── */
test('_tlFilterSort: 기본 정렬(sortOrder → 미지정은 최신 등록 먼저) + 담당자 합집합 + 표시 프로젝트 마일스톤만', () => {
  const s = load();
  const r = s._tlFilterSort(P, MS, OPT);
  assert.deepStrictEqual(plain(ids(r.projects)), ['c', 'a', 'e', 'd', 'b']);
  assert.deepStrictEqual(plain(r.assigneeList), ['김', '박', '이']);
  assert.deepStrictEqual(plain(r.milestones.map((m) => m.id)), ['m1', 'm2']);
  assert.deepStrictEqual(plain(r.groupHeads), {}, '그룹 모드 아니면 헤더 없음');
});

test('_tlFilterSort: 완료 숨김 · 상태 · 담당자 필터', () => {
  const s = load();
  assert.deepStrictEqual(plain(ids(s._tlFilterSort(P, MS, Object.assign({}, OPT, { hideDone: true })).projects)), ['a', 'e', 'd', 'b']);
  assert.deepStrictEqual(plain(ids(s._tlFilterSort(P, MS, Object.assign({}, OPT, { status: 'delayed' })).projects)), ['b']);
  const r = s._tlFilterSort(P, MS, Object.assign({}, OPT, { assignee: '김' }));
  assert.deepStrictEqual(plain(ids(r.projects)), ['c', 'a']);
  assert.deepStrictEqual(plain(r.assigneeList), ['김', '박', '이'], '담당자 목록은 필터 전 전체 기준');
});

test('_tlFilterSort: 상태별 묶기 — 그룹 순서(지연→진행→대기→보류→완료)·그룹 헤더는 첫 프로젝트', () => {
  const s = load();
  const r = s._tlFilterSort(P, MS, Object.assign({}, OPT, { groupBy: 'status', sort: 'name' }));
  assert.deepStrictEqual(plain(ids(r.projects)), ['b', 'a', 'e', 'd', 'c']);
  assert.deepStrictEqual(plain(Object.keys(r.groupHeads)), ['b', 'a', 'e', 'd', 'c']);
  assert.strictEqual(r.groupHeads.b.key, 'delayed');
  assert.strictEqual(r.groupHeads.b.color, s.stColor('delayed'));
});

test('_tlProjCmpBy: 정렬 모드별', () => {
  const s = load();
  const sorted = (mode) => plain(ids(P.slice().sort(s._tlProjCmpBy(mode))));
  assert.deepStrictEqual(sorted('name'), ['b', 'a', 'c', 'd', 'e']);       // ko 콜레이션: 한글(가나다라) → 라틴(ABC)
  assert.deepStrictEqual(sorted('name_desc'), ['e', 'd', 'c', 'a', 'b']);
  assert.deepStrictEqual(sorted('created'), ['b', 'a', 'c', 'd', 'e']);
  assert.deepStrictEqual(sorted('created_desc'), ['e', 'd', 'c', 'a', 'b']);
  assert.deepStrictEqual(sorted('deadline'), ['c', 'b', 'a', 'd', 'e']);
  assert.deepStrictEqual(sorted('progress'), ['c', 'b', 'a', 'd', 'e']);
  assert.deepStrictEqual(sorted('status'), ['b', 'a', 'e', 'd', 'c']);
});

test('_tlGroupProjects: opt 생략 시 전역 tlSort/tlGroupBy 사용 (좌측 목록과 동일)', () => {
  const s = load();
  s.tlSort = 'name'; s.tlGroupBy = 'none';
  assert.deepStrictEqual(plain(ids(s._tlGroupProjects(P)[0].items)), ['b', 'a', 'c', 'd', 'e']);
  assert.deepStrictEqual(plain(ids(s._tlGroupProjects(P, { sort: 'created', groupBy: 'none' })[0].items)), ['b', 'a', 'c', 'd', 'e']);
  s.tlGroupBy = 'status';
  assert.deepStrictEqual(plain(s._tlGroupProjects(P).map((g) => g.key)), ['delayed', 'active', 'waiting', 'hold', 'done']);
});

/* ── _tlComputeRange / 단위 ── */
test('_tlComputeRange: 최소~최대 날짜 −14/+30일, 일 단위 폭', () => {
  const s = load();
  const r = s._tlComputeRange(P, null, 'day');
  assert.strictEqual(s.localDate(), '2026-09-27');
  assert.strictEqual(r.todayStr, '2026-09-27');
  assert.strictEqual(r.unitW, 32);
  assert.strictEqual(r.units[0].date, '2026-04-17');                 // 05-01 − 14
  assert.strictEqual(r.units[r.units.length - 1].date, '2027-03-02'); // 01-31 + 30
  assert.strictEqual(r.totalWidth, r.units.length * 32);
});

test('_tlComputeRange: jumpDate 포함 · 날짜 없으면 오늘 기준 폴백 · 스케일별 폭', () => {
  const s = load();
  const j = s._tlComputeRange(P, '2028-01-10', 'month');
  assert.strictEqual(j.units[j.units.length - 1].startDate, '2028-02-01');
  assert.ok(j.units[j.units.length - 1].endDate >= '2028-01-31', '범위가 이동 날짜 +30일까지');
  assert.strictEqual(j.unitW, 120);
  const f = s._tlComputeRange([{ id: 'x', startDate: '', endDate: 'bad' }], null, 'week');
  assert.strictEqual(f.unitW, 60);
  // 오늘(9/27) −7 −14 = 9/6 (일요일 시작 주 → 9/6 자체가 일요일)
  assert.strictEqual(f.units[0].startDate, '2026-09-06');
  assert.ok(f.units.some((u) => u.contains('2026-09-27')), '폴백 범위에 오늘 포함');
  assert.deepStrictEqual([18, 32, 60, 120, 180].map(String), ['hour', 'day', 'week', 'month', 'quarter'].map((k) => String(s._tlUnitWidthFor(k))));
});

test('_tlBarsVars: 과거 음영 폭·주말 위치(일 스케일 전용)', () => {
  const s = load();
  const units = s.getTimeUnits(new Date('2026-09-20'), new Date('2026-10-10'), 'day'); // 9/20 = 일요일
  assert.strictEqual(s._tlBarsVars(units, 7 * 32, '2026-09-27', 32, 'day'), '--tl-uw:32px;--tl-pastw:224px;--tl-sat:192px;--tl-sun:0px;--tl-wkw:32px;');
  assert.strictEqual(s._tlBarsVars(units, -1, '2027-01-01', 32, 'week'), '--tl-uw:32px;--tl-pastw:' + units.length * 32 + 'px;--tl-wkw:0px;', '오늘이 범위 뒤면 전체 과거');
  assert.strictEqual(s._tlBarsVars(units, -1, '2026-01-01', 32, 'week'), '--tl-uw:32px;--tl-pastw:0px;--tl-wkw:0px;');
});

test('_tlRenderHeader: 오늘 포함 단위만 tl-unit-now', () => {
  const s = load();
  const units = s.getTimeUnits(new Date('2026-09-26'), new Date('2026-09-28'), 'day');
  assert.strictEqual(s._tlRenderHeader(units, 96, 32, '2026-09-27'),
    '<div class="tl-header" style="width:96px"><div class="tl-unit" style="width:32px">9/26</div><div class="tl-unit tl-unit-now" style="width:32px">9/27</div><div class="tl-unit" style="width:32px">9/28</div></div>');
});

/* ── HTML 조각 ── */
test('_tlDdayBadgeHtml: 오늘/미래/과거/기준일 없음', () => {
  const s = load();
  assert.strictEqual(s._tlDdayBadgeHtml('2026-09-27', '2026-09-27'), '<div class="tl-dday-badge tl-dday-now" title="오늘로부터 0일">D-day</div>');
  assert.strictEqual(s._tlDdayBadgeHtml('2026-09-30', '2026-09-27'), '<div class="tl-dday-badge tl-dday-future" title="오늘로부터 3일">+3 days</div>');
  assert.strictEqual(s._tlDdayBadgeHtml('2026-09-20', '2026-09-27'), '<div class="tl-dday-badge tl-dday-past" title="오늘로부터 -7일">-7 days</div>');
  assert.strictEqual(s._tlDdayBadgeHtml('', '2026-09-27'), '');
});

test('_tlFmtDday · _tlMsPerf: 의미색(SEM_COLOR) 값 유지', () => {
  const s = load();
  assert.deepStrictEqual(plain(s._tlFmtDday({ endDate: '2026-09-30' }, 'active')), { label: 'D-3', color: '#F59E0B' });
  assert.deepStrictEqual(plain(s._tlFmtDday({ endDate: '2026-09-20' }, 'active')), { label: 'D+7', color: '#EF4444' });
  assert.strictEqual(s._tlFmtDday({ endDate: '2026-09-20' }, 'done'), null);
  assert.ok(s._tlMsPerf({ progress: 100 }, {}).html.indexOf('color:#10B981') >= 0);
  assert.ok(s._tlMsPerf({ progress: 60 }, {}).html.indexOf('color:#8B5CF6') >= 0);
  assert.ok(s._tlMsPerf({ progress: 10 }, {}).html.indexOf('color:#F59E0B') >= 0);
});

test('_tlMsTitle: 기간·일수·실적(목표 대비 %)·업무일지(참고)', () => {
  const s = load();
  const t = s._tlMsTitle({ id: 'm', name: '제작', startDate: '2026-09-01', endDate: '2026-09-10', assigneeTargets: { a: 16, b: 8 }, reportedHours: 12 }, 'active', { m: 3.26 });
  assert.strictEqual(t, '제작 · 2026-09-01 ~ 2026-09-10 · 10일 · D+17 · 실적 12h/24h (50%) (1.5/3d, 8h=1일) · 업무일지 3.3h(참고)');
  assert.strictEqual(s._tlMsTitle({ id: 'x' }, 'waiting', {}), ' · ? ~ ? · 실적 0h (0d, 8h=1일)');
});

test('_projMsEditRowsHtml: 마일스톤 편집 행 (id·rowkey·상태 선택)', () => {
  const s = load();
  assert.strictEqual(s._projMsEditRowsHtml([]), '');
  const h = s._projMsEditRowsHtml([{ id: 'm1', name: '<설계>', startDate: '2026-09-01', endDate: '2026-09-10', status: 'done' }]);
  assert.ok(h.indexOf('data-msid="m1" data-rowkey="m1"') > 0);
  assert.ok(h.indexOf('value="&lt;설계&gt;"') > 0);
  assert.ok(h.indexOf('<option value="done" selected>완료</option>') > 0);
  assert.ok(h.indexOf('showMilestoneTransferModal(\'m1\')') > 0);
});

test('_projModalResetStaging: 원래 id·목표시간 스테이징 복사·rowkey 시퀀스 초기화', () => {
  const s = load();
  s._msRowKeySeq = 7;
  const tg = { 김: 3 };
  s._projModalResetStaging([{ id: 'm1', assigneeTargets: tg }, { id: 'm2' }]);
  assert.deepStrictEqual(plain(s.window._projMsOrigIds), ['m1', 'm2']);
  assert.deepStrictEqual(plain(s._msTargetStaging), { m1: { 김: 3 }, m2: {} });
  assert.notStrictEqual(s._msTargetStaging.m1, tg, '복사본');
  assert.strictEqual(s._msRowKeySeq, 0);
});

test('_projSaveErrMsg: CONFLICT / 서버 메시지 / 일반 오류 + HTTP 상태', () => {
  const s = load();
  assert.strictEqual(s._projSaveErrMsg({ data: { error: 'CONFLICT' }, status: 409, message: 'x' }), '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요. (HTTP 409)');
  assert.strictEqual(s._projSaveErrMsg({ data: { message: '권한' }, message: 'x' }), '권한');
  assert.strictEqual(s._projSaveErrMsg(new Error('net')), 'net');
});

test('renderAssigneeWorkload: 배정 건수별 의미색 (여유/적정/주의/과부하)', async () => {
  const s = load();
  const area = { innerHTML: '' };
  s.__els.assigneeWorkloadArea = area;
  s.__els.projAssignees = { value: '가, 나, 다, 라' };
  const mk = (n, who) => Array.from({ length: n }, (_, i) => ({ id: who + i, status: 'active', startDate: '2026-01-01', endDate: '2027-01-01', assignees: [who] }));
  const list = [].concat(mk(1, '가'), mk(2, '나'), mk(3, '다'), mk(4, '라'));
  s.projGetAll = async () => list;
  s.renderAssigneeWorkload('');
  await new Promise((r) => setImmediate(r));
  const h = area.innerHTML;
  ['#10B981', '#3B82F6', '#F59E0B', '#EF4444'].forEach((c) => assert.ok(h.indexOf('color:' + c + ';') >= 0, c));
  assert.ok(h.indexOf('<div style="font-size:10px;color:#F59E0B;margin-top:3px">⚠️ 3건 이상') >= 0);
});

/* ── 크리티컬 패스 ── */
const cp = (s, list) => plain(s.calcCriticalPath(list));

test('calcCriticalPath: 직렬 체인 — 여유 0 인 끝 노드만 (종료일=EF 기준이라 하루 여유가 생김)', () => {
  const s = load();
  const list = [
    { id: 'a', startDate: '2026-09-01', endDate: '2026-09-10' },
    { id: 'b', startDate: '2026-09-11', endDate: '2026-09-20', dependencies: ['a'] },
    { id: 'c', startDate: '2026-09-21', endDate: '2026-09-30', dependencies: ['b'] },
    { id: 'd', startDate: '2026-09-01', endDate: '2026-09-03' },
  ];
  assert.deepStrictEqual(cp(s, list), { c: true });
});

test('calcCriticalPath: 선행 종료가 후행 시작보다 늦으면 ES 밀림 → 둘 다 크리티컬', () => {
  const s = load();
  const list = [
    { id: 'a', startDate: '2026-09-01', endDate: '2026-09-10' },
    { id: 'b', startDate: '2026-09-05', endDate: '2026-09-08', dependencies: ['a'] },
    { id: 'x', startDate: '2026-09-01', endDate: '2026-09-02' },
  ];
  assert.deepStrictEqual(cp(s, list), { a: true, b: true });
});

test('calcCriticalPath: 의존관계 없음 → 기간 상위 30%(최소 1)', () => {
  const s = load();
  const list = [
    { id: 'p10', startDate: '2026-01-01', endDate: '2026-01-11' },
    { id: 'p20', startDate: '2026-01-01', endDate: '2026-01-21' },
    { id: 'p5', startDate: '2026-01-01', endDate: '2026-01-06' },
    { id: 'p30', startDate: '2026-01-01', endDate: '2026-01-31' },
    { id: 'nodate' },
  ];
  assert.deepStrictEqual(cp(s, list), { p30: true, p20: true });
  assert.deepStrictEqual(cp(s, [{ id: 'z' }]), {});
  assert.deepStrictEqual(plain(s.calcCriticalPathByDuration(list.slice(0, 1))), { p10: true });
});

test('calcCriticalPath: 순환/없는 선행 → 위상정렬 누락 → 기간 폴백', () => {
  const s = load();
  const cyc = [
    { id: 'a', startDate: '2026-01-01', endDate: '2026-01-31', dependencies: ['b'] },
    { id: 'b', startDate: '2026-01-01', endDate: '2026-01-05', dependencies: ['a'] },
  ];
  assert.deepStrictEqual(cp(s, cyc), { a: true });
  const missing = [
    { id: 'a', startDate: '2026-01-01', endDate: '2026-01-03', dependencies: ['ghost'] },
    { id: 'b', startDate: '2026-01-01', endDate: '2026-01-20' },
  ];
  // b 만 정렬됨 → ES==LS (종단) 이므로 크리티컬
  assert.deepStrictEqual(cp(s, missing), { b: true });
});

test('calcCriticalPath: 날짜 손상 값에도 예외 없음', () => {
  const s = load();
  assert.doesNotThrow(() => s.calcCriticalPath([
    { id: 'a', startDate: 'bad', endDate: 'worse' },
    { id: 'b', startDate: '2026-01-01', endDate: '2026-01-02', dependencies: ['a'] },
  ]));
});
