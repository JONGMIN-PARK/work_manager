/**
 * 🎯 계획 대비 실적 (v13.492) — 계획(금주 칸) ↔ 실적(다음 주 보고서의 지난주 칸) 짝짓기 · 결과 분류 · 업무일지 시간 · 거르기 · 부족 요인
 */
var pa = require('../lib/weekly-plan-actual');
var wi = require('../lib/weekly-insights');
var parser = require('../services/weekly-report-parser');

function rep(team, weekStart, lastText, curText) {
  return { id: team + weekStart, team: team, week_start: weekStart, updated_at: weekStart + 'T09:00:00Z',
    parsed: parser.buildParsed({ lastText: lastText, curText: curText }) };
}
var T = '시험팀';
var rows = [
  rep(T, '2026-10-05', '', '[개발]\n- [A사] 검사기 UI ~12/30 20% @홍\n- [B사] 비전 모듈 @김\n[C/S]\n- [C사] 통신 점검 @이\n[기타]\n- [D사] 교육 @박'),
  rep(T, '2026-10-12',
    '[개발]\n- [A사] 검사기 UI ~12/30 40% @홍\n- [B사] 비전 모듈 #완료 @김\n[C/S]\n- [E사] 긴급 A/S #완료 @김',
    '[개발]\n- [A사] 검사기 UI ~12/30 40% @홍\n- [B사] 비전 모듈 2차 @김'),
  rep(T, '2026-10-19',
    '[개발]\n- [A사] 검사기 UI ~12/30 40% @홍\n- [B사] 비전 모듈 2차 #진행중 @김',
    '[개발]\n- [A사] 검사기 UI ~12/30 50% @홍')
];
var hours = [
  { date: '20261007', name: '이', oclient: 'C사', ocmt: '통신', content: '통신 점검', abbr: 'A', hours: 8 },     // 실적 칸엔 없지만 일은 함 → 보고 누락
  { date: '20261006', name: '홍', oclient: 'A사', ocmt: '검사기 UI', content: '화면', abbr: 'D', hours: 46 },   // 과부하
  { date: '20261008', name: '김', oclient: '', ocmt: '', content: '휴가', abbr: 'V', hours: 8 },               // 휴가 — 뺌
  { date: '20261014', name: '홍', oclient: 'A사', ocmt: '검사기 UI', content: '화면', abbr: 'D', hours: 30 }
];
function run(filter, more) {
  var items = wi.compute(rows, { withItems: true }).items;
  return pa.compute(rows, hours, Object.assign({ from: '2026-10-05', to: '2026-10-19', filter: filter || {}, insightItems: items }, more || {}));
}

test('주마다 계획 ↔ 실적 — 완료 · 진척 · 정체 · 보고 누락 · 못 함 · 계획 외', function () {
  var o = run();
  expect(o.range.weeks).toEqual(['2026-10-05', '2026-10-12']);   // 10/19 계획은 아직 실적 보고가 없음
  expect(o.range.pending).toEqual(['2026-10-19']);
  var w1 = o.weekly[0];
  expect(w1).toMatchObject({ planned: 4, done: 1, progressed: 1, unreported: 1, missed: 1, unplanned: 1 });
  expect(w1.execRate).toBe(75);          // (완료 1 + 진척 1 + 보고 누락 1) / 4
  expect(w1.doneRate).toBe(25);
  expect(w1.unplannedRate).toBe(33.3);   // 계획 외 1 / 실적 칸 3
  var w2 = o.weekly[1];
  expect(w2).toMatchObject({ planned: 2, stalled: 1, progressed: 1 });   // 40% → 40% 는 정체 · '비전 모듈 2차' #진행 은 진척
  var c = o.records.filter(function (r) { return r.client === 'C사'; })[0];
  expect(c).toMatchObject({ res: 'unreported', hours: 8 });
  expect(o.kpi.planned).toBe(6);
});

test('업무일지 시간 — 휴가 빼고 · 사람별 주당 · 과부하', function () {
  var o = run();
  expect(o.kpi.hours).toBe(84);          // 8 + 46 + 30 (휴가 8 은 뺌)
  var hong = o.byMember.filter(function (m) { return m.key === '홍'; })[0];
  expect(hong).toMatchObject({ hours: 76, perWeek: 38, overWeeks: 1 });
  expect(o.byMember.some(function (m) { return m.key === '김' && m.hours === 0; })).toBe(true);
});

test('거르기 — 사람 · 업체 · 프로젝트 · 분야 (축끼리는 AND)', function () {
  var kim = run({ members: ['김'] });
  expect(kim.kpi).toMatchObject({ planned: 2, done: 1, progressed: 1, unplanned: 1 });
  expect(kim.kpi.hours).toBe(0);         // 김은 휴가만
  var a = run({ clients: ['A사'] });
  expect(a.kpi).toMatchObject({ planned: 2, progressed: 1, stalled: 1 });
  expect(a.kpi.hours).toBe(76);
  var pj = run({ projects: ['A사|검사기 UI'] });
  expect(pj.kpi.planned).toBe(2);
  expect(pj.projects.map(function (p) { return p.name; })).toEqual(['검사기 UI']);
  var cs = run({ sections: ['cs'] });
  expect(cs.kpi).toMatchObject({ planned: 1, unreported: 1, unplanned: 1 });
  expect(run({ members: ['김'], clients: ['A사'] }).kpi.planned).toBe(0);
  // 고를 수 있는 값은 거르기 전 전체
  expect(kim.options.clients.map(function (c) { return c.name; })).toEqual(expect.arrayContaining(['A사', 'B사', 'C사', 'D사', 'E사']));
  expect(kim.options.projects.map(function (p) { return p.key; })).toContain('A사|검사기 UI');
});

test('부족 요인 — 근거와 함께', function () {
  var o = run({}, { capacity: 40 });
  var kinds = o.diagnostics.map(function (d) { return d.kind; });
  expect(kinds).toContain('people');     // 홍 — 46h 인 주가 있음 (기준 40h 의 110% 초과)
  expect(kinds).toContain('report');     // C사 보고 누락
  expect(kinds).toContain('time');       // 계획만 하고 못 한 일(D사) 1/6 ≥ 15%
  expect(kinds).not.toContain('plan');   // 계획 외 1/5 = 20% — 30% 아래면 안 나옴
  expect(o.diagnostics.filter(function (d) { return d.kind === 'people'; })[0].items[0]).toMatch(/홍 평균 주 38h · 넘긴 주 1번/);
  var rp = o.diagnostics.filter(function (d) { return d.kind === 'report'; })[0];
  expect(rp.items[0]).toMatch(/C사 통신 점검 \(8h\)/);
});

test('계획 외가 30% 넘으면 계획 버퍼 권고 · 데이터 없으면 진단 없음', function () {
  var rs = [
    rep(T, '2026-10-05', '', '[개발]\n- [A사] 일 하나 @홍'),
    rep(T, '2026-10-12', '[개발]\n- [A사] 일 하나 #완료 @홍\n[C/S]\n- [X사] 돌발 1 #완료 @홍\n- [Y사] 돌발 2 #완료 @홍', '')
  ];
  var o = pa.compute(rs, [], { from: '2026-10-05', to: '2026-10-05' });
  expect(o.kpi.unplannedRate).toBe(66.7);
  var plan = o.diagnostics.filter(function (d) { return d.kind === 'plan'; })[0];
  expect(plan.level).toBe('high');
  expect(plan.detail).toMatch(/버퍼/);
  expect(pa.compute([], [], {}).diagnostics).toEqual([]);
});
