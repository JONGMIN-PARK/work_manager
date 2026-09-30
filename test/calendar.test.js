// calendar.js — 보이는 범위(로컬 날짜)·항목 통합/정렬
// 실행: node --test
'use strict';
process.env.TZ = 'Asia/Seoul'; // UTC 변환으로 날짜가 밀리던 버그는 KST 오전에만 드러난다

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(now) {
  const RealDate = Date;
  // 고정 시각 Date (new Date() / Date.now() 만 고정, 인자 있는 생성은 그대로)
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(now); }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => now;
  FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, JSON, Math, Object, Array, String, Number, Set,
    Date: FakeDate,
    window: {}, document: { getElementById() { return null; }, addEventListener() {}, createElement() { return { style: {} }; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  vm.createContext(sandbox);
  for (const f of ['config.js', 'project-data.js', 'calendar.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

// 2026-09-27(일) 08:30 KST = 2026-09-26 23:30 UTC — UTC 로 자르면 전날이 된다
const KST_MORNING = Date.UTC(2026, 8, 26, 23, 30);

test('주간 범위는 로컬 날짜 기준 일~토 (KST 오전에도 하루 밀리지 않음)', () => {
  const s = load(KST_MORNING);
  s.calViewMode = 'week';
  s.calWeekStart = null;
  const rg = s._calViewRange();
  assert.strictEqual(rg.start, '2026-09-27');
  assert.strictEqual(rg.end, '2026-10-03');
});

test('월간 범위는 앞뒤 달을 포함한 주 단위 그리드', () => {
  const s = load(KST_MORNING);
  s.calViewMode = 'month'; s.calYear = 2026; s.calMonth = 8; // 9월
  const rg = s._calViewRange();
  assert.strictEqual(rg.monthStart, '2026-09-01');
  assert.strictEqual(rg.monthEnd, '2026-09-30', '말일이 빠지지 않음 (예전 toISOString 은 09-29)');
  assert.strictEqual(rg.start, '2026-08-30'); // 9/1(화) 이전 일요일
  assert.strictEqual(rg.end, '2026-10-03');   // 9/30(수) 이후 토요일
});

test('_calAddDays 는 월 경계·로컬 기준', () => {
  const s = load(KST_MORNING);
  assert.strictEqual(s._calAddDays('2026-09-30', 1), '2026-10-01');
  assert.strictEqual(s._calAddDays('2026-03-01', -1), '2026-02-28');
});

test('항목 통합: 지연 판정·완료·정렬(지연 → 납기 → 마일스톤 → 이슈 → 일정 → 착수, 완료는 맨 뒤)', () => {
  const s = load(KST_MORNING);
  const p = { id: 'p1', name: 'P', color: '#123456', startDate: '2026-09-01', endDate: '2026-09-20', status: 'active', assignees: ['a'] };
  const items = s._calBuildItems(
    [p],
    [{ id: 'e1', title: '회의', type: 'meeting', startDate: '2026-09-27', endDate: '2026-09-27' }],
    [{ id: 'm1', projectId: 'p1', name: 'FAT', endDate: '2026-09-25', status: 'active' },
     { id: 'm2', projectId: 'p1', name: '설계', endDate: '2026-09-28', status: 'done' }],
    [{ id: 'i1', title: '버그', dueDate: '2026-09-30', projectId: 'p1' }],
    { p1: p }
  );
  const byId = Object.fromEntries(items.map((it) => [it.id, it]));
  assert.strictEqual(byId.pe_p1.overdue, true, '납기 지난 진행 프로젝트 = 지연');
  assert.strictEqual(byId.ms_m1.overdue, true);
  assert.strictEqual(byId.ms_m2.overdue, false, '완료 마일스톤은 지연 아님');
  assert.strictEqual(byId.ms_m2.done, true);
  assert.strictEqual(byId.is_i1.overdue, false);
  assert.ok(byId.pp_p1, '기간 막대 항목 생성');

  const sorted = JSON.parse(JSON.stringify(items.filter((it) => it.kind !== 'pspan').sort(s._calItemCmp).map((it) => it.id)));
  assert.deepStrictEqual(sorted.slice(0, 2).sort(), ['ms_m1', 'pe_p1'], '지연 항목이 먼저');
  assert.strictEqual(sorted[sorted.length - 1], 'ms_m2', '완료는 맨 뒤');
  assert.ok(sorted.indexOf('is_i1') < sorted.indexOf('ev_e1_2026-09-27'), '이슈 기한이 일반 일정보다 앞');
});

/* 월간 그리드 — 날짜별 묶음(singlesByDate)으로 바꾼 뒤에도 칸별 항목·순서가 같아야 한다 */
function renderMonthHtml(s) {
  const els = {};
  s.eH = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  s.document.getElementById = (id) => (els[id] = els[id] || { id, style: {}, innerHTML: '', className: '', addEventListener() {}, querySelectorAll() { return []; } });
  s.calViewMode = 'month'; s.calYear = 2026; s.calMonth = 8; s.calSelDate = '2026-09-10';
  const P = [{ id: 'p1', name: 'P1', startDate: '2026-09-01', endDate: '2026-09-30', color: '#123456', status: 'active', assignees: [] }];
  const EV = [
    { id: 'e1', title: '킥오프', type: 'meeting', startDate: '2026-09-10', endDate: '2026-09-10', projectIds: ['p1'] },
    { id: 'e2', title: '검수', type: 'etc', startDate: '2026-09-10', endDate: '2026-09-10', projectIds: [] },
    { id: 'e3', title: '출장', type: 'trip', startDate: '2026-09-14', endDate: '2026-09-16', projectIds: [] },
  ];
  const MS = [{ id: 'm1', projectId: 'p1', name: '설계', startDate: '2026-09-10', endDate: '2026-09-10', status: 'waiting' }];
  const projMap = { p1: P[0] };
  const items = s._calBuildItems(P, EV, MS, [], projMap);
  items.sort(s._calItemCmp);
  const rg = s._calViewRange();
  s.renderMonthView(items, rg, []);
  return els.calGrid.innerHTML;
}

test('월간 그리드: 같은 날 여러 항목이 그 칸에만 들어간다', () => {
  const html = renderMonthHtml(load(KST_MORNING));
  // 날짜 칸(calm-chips)별로 잘라 본다
  const cells = {};
  html.split('<div class="calm-chips" data-date="').slice(1).forEach((seg) => { cells[seg.slice(0, 10)] = seg; });
  const c = cells['2026-09-10'];
  assert.ok(c, '9/10 칸 존재');
  ['킥오프', '검수', '설계'].forEach((t) => assert.ok(c.indexOf(t) > 0, '9/10 칸에 ' + t));
  Object.keys(cells).filter((d) => d !== '2026-09-10').forEach((d) => assert.ok(cells[d].indexOf('킥오프') < 0, d + ' 칸에 중복 없음'));
});
