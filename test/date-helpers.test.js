// project-data.js 날짜 헬퍼(ymdAddDays·monthEndYmd·weekRangeYmd) + 대시보드 금주/금월 범위 + 타임라인 단위
// 실행: node --test
'use strict';
process.env.TZ = 'Asia/Seoul'; // toISOString(UTC) 로 자르던 버그는 KST 09시 전에만 드러난다

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 2026-09-27(일) 08:30 KST = 2026-09-26 23:30 UTC
const KST_MORNING = Date.UTC(2026, 8, 26, 23, 30);

function load(now, files) {
  const RealDate = Date;
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(now); }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => now;
  FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, JSON, Math, Object, Array, String, Number, Set,
    Date: FakeDate,
    window: {},
    document: { getElementById() { return null; }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return { style: {} }; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    eH: (s) => String(s == null ? '' : s),
  };
  vm.createContext(sandbox);
  for (const f of ['config.js', 'project-data.js'].concat(files || [])) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('고정 시각 확인: KST 08:30 은 UTC 로는 전날', () => {
  const s = load(KST_MORNING);
  assert.strictEqual(new s.Date().toISOString().slice(0, 10), '2026-09-26');
  assert.strictEqual(s.localDate(), '2026-09-27');
});

test('ymdAddDays: 로컬 달력 기준·월/연/윤년 경계', () => {
  const s = load(KST_MORNING);
  assert.strictEqual(s.ymdAddDays('2026-09-27', 0), '2026-09-27');
  assert.strictEqual(s.ymdAddDays('2026-09-30', 1), '2026-10-01');
  assert.strictEqual(s.ymdAddDays('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(s.ymdAddDays('2028-03-01', -1), '2028-02-29');
  assert.strictEqual(s.ymdAddDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(s.ymdAddDays('2026-01-01', -365), '2025-01-01');
  assert.strictEqual(s.ymdAddDays('2026-09-27T12:00:00Z', 1), '2026-09-28', '시각 붙은 문자열은 날짜 부분만');
  assert.strictEqual(s.ymdAddDays('', 1), '', '잘못된 입력은 그대로');
  assert.strictEqual(s.ymdAddDays(s.localDate(), 1), '2026-09-28');
});

test('monthEndYmd: 말일 (m 은 1~12, 넘치면 이월)', () => {
  const s = load(KST_MORNING);
  assert.strictEqual(s.monthEndYmd(2026, 9), '2026-09-30', '예전 toISOString 은 09-29');
  assert.strictEqual(s.monthEndYmd(2026, 2), '2026-02-28');
  assert.strictEqual(s.monthEndYmd(2028, 2), '2028-02-29');
  assert.strictEqual(s.monthEndYmd(2026, 12), '2026-12-31');
  assert.strictEqual(s.monthEndYmd(2026, 13), '2027-01-31');
});

test('weekRangeYmd: 일요일/월요일 시작', () => {
  const s = load(KST_MORNING);
  assert.deepStrictEqual(plain(s.weekRangeYmd('2026-09-27', 0)), { start: '2026-09-27', end: '2026-10-03' }, '일요일 당일이 시작');
  assert.deepStrictEqual(plain(s.weekRangeYmd('2026-09-30')), { start: '2026-09-27', end: '2026-10-03' }, '기본 일요일 시작');
  assert.deepStrictEqual(plain(s.weekRangeYmd('2026-09-27', 1)), { start: '2026-09-21', end: '2026-09-27' }, '월요일 시작이면 일요일은 주의 끝');
  assert.deepStrictEqual(plain(s.weekRangeYmd('2026-10-01', 1)), { start: '2026-09-28', end: '2026-10-04' });
  assert.deepStrictEqual(plain(s.weekRangeYmd('', 0)), { start: '', end: '' });
});

test('datesBetween: 양끝 포함 로컬 날짜', () => {
  const s = load(KST_MORNING);
  assert.deepStrictEqual(plain(s.datesBetween('2026-09-29', '2026-10-02')), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepStrictEqual(plain(s.datesBetween('2026-09-29', '2026-09-28')), []);
});

test('대시보드 _dashDateRanges: KST 오전에도 금주가 밀리지 않고 금월 말일 포함', () => {
  const s = load(KST_MORNING, ['dashboard.js']);
  assert.deepStrictEqual(plain(s._dashDateRanges(s.localDate())), {
    weekStart: '2026-09-27', weekEnd: '2026-10-03', monthStart: '2026-09-01', monthEnd: '2026-09-30',
  });
  assert.deepStrictEqual(plain(s._dashDateRanges('2026-02-11')), {
    weekStart: '2026-02-08', weekEnd: '2026-02-14', monthStart: '2026-02-01', monthEnd: '2026-02-28',
  });
});

test('타임라인 월/분기 단위: 말일까지 포함 (예전엔 로컬 자정 → UTC 로 하루 짧았다)', () => {
  const s = load(KST_MORNING, ['timeline.js']);
  const start = new s.Date('2026-08-15'), end = new s.Date('2026-11-10');
  const months = plain(s.getTimeUnits(start, end, 'month').map((u) => [u.startDate, u.endDate]));
  assert.deepStrictEqual(months, [['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30']]);
  const q = plain(s.getTimeUnits(start, end, 'quarter').map((u) => [u.label, u.startDate, u.endDate]));
  assert.deepStrictEqual(q, [['2026 Q3', '2026-07-01', '2026-09-30'], ['2026 Q4', '2026-10-01', '2026-12-31']]);
  const wk = s.getTimeUnits(start, end, 'week');
  assert.strictEqual(wk[0].startDate, '2026-08-09');
  assert.strictEqual(wk[0].endDate, '2026-08-15');
});

test('타임라인 날짜 없음 폴백: KST 오전에도 오늘(로컬)이 일 단위에 들어간다', () => {
  const s = load(KST_MORNING, ['timeline.js']);
  const rg = s._tlComputeRange([{ id: 'x', startDate: '', endDate: '' }], null, 'day');
  const dates = rg.units.map((u) => u.date);
  assert.strictEqual(dates[0], '2026-09-06', '오늘 -7 -14일');
  assert.ok(dates.includes('2026-09-27'));
  assert.strictEqual(rg.todayStr, '2026-09-27');
});
