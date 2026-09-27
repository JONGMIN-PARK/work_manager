// project-detail.js — 투입실적 순수 집계 함수 단위 테스트
// 실행: node --test
'use strict';
process.env.TZ = 'Asia/Seoul';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./fixtures/project-detail-harness');

// vm 샌드박스 객체는 realm이 달라 deepStrictEqual 프로토타입 검사에 걸림 → JSON 정규화
const plain = (x) => JSON.parse(JSON.stringify(x));
const { s } = H.load();

test('_pdAggregateReported: 작성자별·마일스톤별 합계, 최신 로그 id', () => {
  const r = plain(s._pdAggregateReported([
    { mid: 'm1', logs: [{ id: 'l3', authorName: 'A', hours: 2 }, { id: 'l2', authorName: 'B', hours: '1.5' }, { id: 'l1', authorName: 'A', hours: 3 }] },
    { mid: 'm2', logs: [{ id: 'l9', authorName: 'A', hours: 1 }] },
  ]));
  assert.deepStrictEqual(r.reportedByPerson, { A: 6, B: 1.5 });
  assert.deepStrictEqual(r.reportedByMsPerson, { m1: { A: 5, B: 1.5 }, m2: { A: 1 } });
  assert.deepStrictEqual(r.latestLogByMs, { m1: 'l3', m2: 'l9' });
});

test('_pdAggregateReported: 빈 로그·작성자 없음·숫자 아닌 hours', () => {
  const r = plain(s._pdAggregateReported([
    { mid: 'm1', logs: [] },
    { mid: 'm2', logs: [{ id: 'x', authorName: '', hours: 5 }, { id: 'y', authorName: 'C', hours: 'abc' }, { id: 'z', authorName: 'C' }] },
  ]));
  assert.deepStrictEqual(r.reportedByPerson, { C: 0 });
  assert.deepStrictEqual(r.reportedByMsPerson, { m1: {}, m2: { C: 0 } });
  assert.deepStrictEqual(r.latestLogByMs, { m2: 'x' }, '작성자 없는 로그도 최신 id 판정에는 포함');
  assert.deepStrictEqual(plain(s._pdAggregateReported([])), { reportedByPerson: {}, reportedByMsPerson: {}, latestLogByMs: {} });
});

test('_pdAggregateWork: 업무일지 합계·할당 외·목표·가중 진척률', () => {
  const fx = H.fixtures();
  const a = plain(s._pdAggregateWork(fx.proj, fx.milestones, fx.msHours));
  assert.strictEqual(Math.round(a.totalH * 100) / 100, 17.34);
  assert.deepStrictEqual(a.personMap, { '김철수': 13, '이영희': 4.34 });
  assert.deepStrictEqual(a.outsiderMap, { '외부인': 4, '협력사': 2.5 });
  assert.strictEqual(a.untaggedCount, 2);
  assert.deepStrictEqual(a.targetMap, { '이영희': 25, '김철수': 10 });
  assert.strictEqual(a.totalTarget, 35);
  assert.strictEqual(a.reportedHoursTotal, 20.5);
  // 가중평균: (0*20 + 40*15 + 100*0) / 35 = 17.1 → 17
  assert.strictEqual(a.reportedPct, 17);
  assert.strictEqual(a.rpAny, true);
  assert.deepStrictEqual(a.assignees, ['김철수', '이영희']);
});

test('_pdAggregateWork: 목표 없으면 단순 평균, 마일스톤 없으면 0', () => {
  const ms = [{ progress: 30 }, { progress: 61 }];
  const a = s._pdAggregateWork(null, ms, {});
  assert.strictEqual(a.reportedPct, 46);
  assert.strictEqual(a.rpAny, false);
  assert.strictEqual(plain(a.assignees).length, 0);
  assert.strictEqual(s._pdAggregateWork({}, [], { _meta: {} }).reportedPct, 0);
});

test('_pdWorkUnitFmt: 시간/일(8h) 변환', () => {
  const h = s._pdWorkUnitFmt('h');
  assert.strictEqual(h.hf(12.34), '12.3h');
  const d = s._pdWorkUnitFmt('d');
  assert.strictEqual(d.hf(12.34), '1.54d');
  assert.strictEqual(d.hv('x'), 0);
  assert.strictEqual(s._pdWorkUnitFmt(undefined).unit, 'h');
});

test('_pdProgColor: 구간별 색', () => {
  assert.strictEqual(s._pdProgColor(100), s.SEM_COLOR.ok);
  assert.strictEqual(s._pdProgColor(50), 'var(--ac)');
  assert.strictEqual(s._pdProgColor(1), s.SEM_COLOR.warn);
  assert.strictEqual(s._pdProgColor(0), 'var(--t6)');
});
