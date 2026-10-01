// kr-holidays.js — 대한민국 공휴일·대체공휴일 (정부 발표 달력과 대조)
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { krHolidaysOfYear, krHolidayName, krHolidayCovered } = require('../kr-holidays.js');

const dates = (y) => Object.keys(krHolidaysOfYear(y)).sort();
const subs = (y) => dates(y).filter((d) => /대체공휴일/.test(krHolidaysOfYear(y)[d]));

test('2025: 대체공휴일 3/3 · 5/6 · 10/8 (외부 API 는 5/6·10/8 누락)', () => {
  assert.deepStrictEqual(subs(2025), ['2025-03-03', '2025-05-06', '2025-10-08']);
  assert.strictEqual(krHolidayName('2025-05-05'), '어린이날 · 부처님오신날');
  assert.strictEqual(krHolidayName('2025-06-03'), '대통령 선거일');
});

test('2026: 노동절·제헌절 신설, 원래 날짜도 공휴일로 남는다 (3/1 + 대체 3/2)', () => {
  assert.deepStrictEqual(subs(2026), ['2026-03-02', '2026-05-25', '2026-08-17', '2026-10-05']);
  assert.strictEqual(krHolidayName('2026-03-01'), '3·1절');
  assert.strictEqual(krHolidayName('2026-05-01'), '노동절');
  assert.strictEqual(krHolidayName('2026-07-17'), '제헌절');
  assert.strictEqual(krHolidayName('2026-08-17'), '광복절 대체공휴일');
  assert.strictEqual(dates(2026).length, 22);   // 법정 공휴일 18 + 대체 4
});

test('2027: 대체공휴일 7일 — 설날(일) · 토요일 노동절·제헌절·한글날·성탄절', () => {
  assert.deepStrictEqual(subs(2027), ['2027-02-09', '2027-05-03', '2027-07-19', '2027-08-16', '2027-10-04', '2027-10-11', '2027-12-27']);
  assert.deepStrictEqual(['2027-02-06', '2027-02-07', '2027-02-08'].map(krHolidayName), ['설날 연휴', '설날', '설날 연휴']);
  assert.strictEqual(dates(2027).length, 24);
});

test('설·추석은 토요일만 겹치면 대체 없음, 다른 공휴일과 겹치면 하루', () => {
  assert.strictEqual(krHolidayName('2026-09-26'), '추석 연휴');      // 토요일
  assert.ok(!subs(2026).some((d) => d.slice(5, 7) === '09'));
  assert.strictEqual(krHolidayName('2028-10-03'), '개천절 · 추석');  // 추석 당일 = 개천절
  assert.deepStrictEqual(subs(2028), ['2028-10-05']);
  assert.deepStrictEqual(subs(2029), ['2029-05-07', '2029-05-21', '2029-09-24']);
});

test('신정·현충일은 대체 없음, 평일은 빈 문자열, 표 밖의 해는 고정 공휴일만', () => {
  assert.strictEqual(krHolidayName('2027-06-06'), '현충일');          // 일요일
  assert.ok(!subs(2027).includes('2027-06-07'));
  assert.strictEqual(krHolidayName('2026-10-01'), '');
  assert.strictEqual(krHolidayCovered(2031), false);
  assert.strictEqual(krHolidayName('2031-12-25'), '성탄절');
});
