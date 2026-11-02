/**
 * 주간 보고 분석 v13.311 — 손으로 묶기 · 나누기 · 일 하나의 경과 · 목표 · 작성 중 점검
 */
var wi = require('../lib/weekly-insights');
var parser = require('../services/weekly-report-parser');

function rep(team, weekStart, lastText, curText) {
  return { id: team + weekStart, team: team, week_start: weekStart, updated_at: weekStart + 'T09:00:00Z',
    parsed: parser.buildParsed({ lastText: lastText, curText: curText }) };
}
var T = '시험팀';
var rows = [
  rep(T, '2026-10-05', '', '[개발]\n- [A사] 검사기 UI ~10/30 20% @홍\n- [B사] 비전 모듈 ~10/20 10% @김\n- [C사] 통신 점검 30% @이'),
  rep(T, '2026-10-12', '', '[개발]\n- [A사] 검사기 UI ~10/30 40% @홍\n- [B사] 비전 모듈 ~10/20 10% @김\n- [C사] 통신 점검 30% @이'),
  // 이름을 크게 바꿈 — 글자 비교로는 못 잇는다
  rep(T, '2026-10-19', '', '[개발]\n- [A사] 화면 개편 2차 ~11/06 60% @홍\n- [B사] 비전 모듈 ~10/20 10% @김\n- [C사] 통신 점검 30% @이')
];
var KUI = wi.itemKey(T, { client: 'A사', name: '검사기 UI' });
var KNEW = wi.itemKey(T, { client: 'A사', name: '화면 개편 2차' });

test('손으로 안 묶으면 이름을 크게 바꾼 일은 다른 일', function () {
  var r = wi.compute(rows, { withItems: true });
  expect(r.items.filter(function (i) { return i.client === 'A사'; }).length).toBe(2);
});

test('같은 일로 묶기 — 새 이름을 옛 일로 (경과가 이어지고 납기 연기도 셈)', function () {
  var r = wi.compute(rows, { withItems: true, links: { merge: { [KNEW]: KUI } } });
  var a = r.items.filter(function (i) { return i.client === 'A사'; });
  expect(a.length).toBe(1);
  expect(a[0].key).toBe(KUI);
  expect(a[0].name).toBe('화면 개편 2차');          // 이름은 마지막 것
  expect(a[0].pctHist.map(function (h) { return h.p; })).toEqual([20, 40, 60]);
  expect(a[0].slips).toBe(1);
  expect(a[0].linked).toBe('manual');
  expect(a[0].variants.map(function (v) { return v.key; })).toEqual([KUI, KNEW]);
});

test('묶을 곳이 나중에 나와도 — 옛 이름을 새 일로 묶기', function () {
  var r = wi.compute(rows, { withItems: true, links: { merge: { [KUI]: KNEW } } });
  var a = r.items.filter(function (i) { return i.client === 'A사'; });
  expect(a.length).toBe(1);
  expect(a[0].key).toBe(KNEW);
  expect(a[0].weeks).toBe(3);
});

test('나누기 — 글자가 비슷해도 따로 셈', function () {
  var rs = [
    rep(T, '2026-10-05', '', '[개발]\n- [D사] 검사 장비 1호기 50% @홍'),
    rep(T, '2026-10-12', '', '[개발]\n- [D사] 검사 장비 2호기 10% @홍')
  ];
  expect(wi.compute(rs, { withItems: true }).items.length).toBe(1);   // 자동으로는 이어 붙음
  var k2 = wi.itemKey(T, { client: 'D사', name: '검사 장비 2호기' });
  var r = wi.compute(rs, { withItems: true, links: { split: { [k2]: true } } });
  expect(r.items.length).toBe(2);
  expect(r.items.filter(function (i) { return i.key === k2; })[0].split).toBe(true);
});

test('일 하나의 경과 — 주마다 이름 · 진행률 · 납기 · 세부', function () {
  var rs = rows.concat([rep(T, '2026-10-26', '', '[개발]\n- [B사] 비전 모듈 ~10/27 30% @김\n  : 조명 교체 대기 #진행중')]);
  var kb = wi.itemKey(T, { client: 'B사', name: '비전 모듈' });
  var r = wi.compute(rs, { histKey: kb });
  expect(r.item.key).toBe(kb);
  expect(r.item.hist.map(function (h) { return h.pct; })).toEqual([10, 10, 10, 30]);
  expect(r.item.hist[3].details[0].text).toMatch(/조명 교체/);
  expect(r.item.dlHist.map(function (d) { return d.d; })).toEqual(['2026-10-20', '2026-10-27']);
  expect(r.items).toBeUndefined();
});

test('목표 — 팀 · 사람, 이상(ge) · 이하(le)', function () {
  var r = wi.compute(rows, { goals: [
    { member: '', metric: 'overdue', target: 0 },
    { member: '', metric: 'completionRate', target: 50 },
    { member: '홍', metric: 'active', target: 3 },
    { member: '홍', metric: 'completionRate', target: 10 },   // 사람에겐 없는 항목 — 빠짐
    { member: '', metric: 'nope', target: 1 }
  ] });
  expect(r.goals.length).toBe(3);
  var od = r.goals[0];
  expect(od.actual).toBe(r.kpi.overdue);
  expect(od.ok).toBe(r.kpi.overdue <= 0);
  expect(r.goals[1]).toMatchObject({ metric: 'completionRate', actual: 0, ok: false, ratio: 0 });
  expect(r.goals[2]).toMatchObject({ member: '홍', ok: true, ratio: 100 });
});

test('작성 중 점검 — 빠진 일 · 납기 지남 · 정체 · 연기 · 납기/담당 없음', function () {
  var draft = { team: T, week_start: '2026-10-26', parsed: parser.buildParsed({
    lastText: '',
    // 통신 점검이 빠짐 · 비전 모듈 납기(10/20) 지남 · 화면 개편 납기 미룸 · 새 일은 담당 없음
    curText: '[개발]\n- [A사] 화면 개편 2차 ~11/13 70% @홍\n- [B사] 비전 모듈 ~10/20 10% @김\n- [E사] 새 일 #진행중'
  }) };
  var c = wi.check(rows, { team: draft.team, week_start: draft.week_start, parsed: { last: draft.parsed.last, cur: draft.parsed.cur } });
  expect(c.lastEmpty).toBe(true);
  expect(c.missing.map(function (m) { return m.name; })).toEqual(['통신 점검']);
  expect(c.missing[0].line).toBe('- [C사] 통신 점검 30% @이');
  var kinds = c.flags.map(function (f) { return f.client + ':' + f.kind; });
  expect(kinds).toContain('B사:overdue');
  expect(kinds).toContain('A사:slipped');
  expect(c.quality.map(function (q) { return q.name + ' ' + q.text; })).toEqual(['새 일 납기 · 담당 없음']);
});

test('작성 중 점검 — 지난주 칸에 #완료 로 넣으면 빠진 일 아님 · 비슷한 이름도 인정', function () {
  var draft = parser.buildParsed({
    lastText: '[개발]\n- [C사] 통신 점검 #완료 @이',
    curText: '[개발]\n- [A사] 화면 개편 2차 ~11/06 70% @홍\n- [B사] 비전 모듈 개선 ~11/20 20% @김'
  });
  var c = wi.check(rows, { team: T, week_start: '2026-10-26', parsed: { last: draft.last, cur: draft.cur } });
  expect(c.missing).toEqual([]);
});

test('작성 중 점검 — 빈 보고서는 아무것도 안 함', function () {
  var c = wi.check(rows, { team: T, week_start: '2026-10-26', parsed: { last: { items: [] }, cur: { items: [] } } });
  expect(c.missing).toEqual([]);
  expect(c.flags).toEqual([]);
});
