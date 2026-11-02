/**
 * 주간 보고 분석 (v13.310) — 실제 보고 문법(공용 파서)으로 만든 4주치로 추세 · 경과 · 효율을 확인
 */
var wi = require('../lib/weekly-insights');
var parser = require('../services/weekly-report-parser');

function rep(team, weekStart, lastText, curText, updated) {
  return { id: team + weekStart + (updated || ''), team: team, week_start: weekStart, updated_at: updated || weekStart + 'T09:00:00Z',
    parsed: parser.buildParsed({ lastText: lastText, curText: curText }) };
}
var T = '소프트웨어팀';
// 10/05 · 10/12 · 10/19 · 10/26 주 (월요일)
var rows = [
  rep(T, '2026-10-05', '', [
    '[개발]', '[SENKO] PICAlign ~10/30 10% @박종민', '[A사] 검사기 UI ~10/16 20% @김철수',
    '[셋업]', '[LOTCES] 레이저 트리밍 셋업 @이영희', '[C/S]', '[디오] 통신 점검 #진행 @박종민'
  ].join('\n')),
  rep(T, '2026-10-12', [
    '[개발]', '[SENKO] PICAlign ~10/30 30% @박종민', '[A사] 검사기 UI ~10/16 50% @김철수',
    '[셋업]', '[LOTCES] 레이저 트리밍 셋업 #완료 @이영희', '[C/S]', '[디오] 통신 점검 #진행 @박종민'
  ].join('\n'), [
    '[개발]', '[SENKO] PICAlign ~10/30 30% @박종민', '[A사] 검사기 UI ~10/23 50% @김철수', '[C/S]', '[디오] 통신 점검 #진행 @박종민',
    '[기타]', '[TSE] 잔건 처리 @이영희'
  ].join('\n')),
  rep(T, '2026-10-19', '', [
    '[개발]', '[SENKO] PICAlign 장비 ~10/30 40% @박종민', '[A사] 검사기 UI ~11/06 50% @김철수', '[C/S]', '[디오] 통신 점검 #진행 @박종민',
    '[기타]', '[TSE] 잔건 처리 #완료 @이영희'
  ].join('\n')),
  rep(T, '2026-10-26', '', [
    '[개발]', '[SENKO] PICAlign 장비 ~10/30 45% @박종민', '[A사] 검사기 UI ~11/06 50% @김철수', '[C/S]', '[디오] 통신 점검 #진행 @박종민'
  ].join('\n')),
  // 같은 주차의 예전 버전 — 무시되어야
  rep(T, '2026-10-26', '', '[개발]\n[X사] 옛 버전 항목 @누구', '2026-10-26T01:00:00Z')
];

var r = wi.compute(rows, { withItems: true });
function item(name) { return r.items.filter(function (i) { return i.name.indexOf(name) >= 0; })[0]; }

test('같은 팀 · 주차는 가장 최근 저장본만 — 옛 버전 항목 없음', function () {
  expect(r.range.reports).toBe(4);
  expect(item('옛 버전')).toBeUndefined();
});

test('주마다 결과(지난주 실적)가 계획보다 우선 — 10/05 주의 레이저 셋업은 완료', function () {
  var w = r.weekly.filter(function (x) { return x.week === '2026-10-05'; })[0];
  expect(w.done).toBe(1);
  expect(item('레이저').doneWeek).toBe('2026-10-05');
  expect(item('레이저').cycleWeeks).toBe(1);
});

test('이름이 조금 바뀐 같은 일을 이음 (PICAlign → PICAlign 장비)', function () {
  var it = item('PICAlign');
  expect(r.items.filter(function (i) { return /PICAlign/.test(i.name); }).length).toBe(1);
  expect(it.weeks).toBe(4);
  expect(it.pctHist.map(function (h) { return h.p; })).toEqual([30, 30, 40, 45]);
});

test('납기 연기 횟수 · 지난 납기', function () {
  var ui = item('검사기 UI');
  expect(ui.slips).toBe(2);              // 10/16 → 10/23 → 11/06
  expect(ui.deadlineFirst).toBe('2026-10-16');
  expect(ui.deadline).toBe('2026-11-06');
  expect(item('PICAlign').state).toBe('overdue');   // 10/30 < 마지막 주 끝 11/01
  expect(r.kpi.slipped).toBe(1);
});

test('정체 — 3주째 진행률 그대로', function () {
  expect(item('검사기 UI').state).toBe('stalled');
  expect(r.risks.stalled.map(function (i) { return i.name; })).toContain('검사기 UI');
});

test('효율 — 처리량 · 완료 소요 · 사람별', function () {
  expect(r.kpi.done).toBe(2);
  expect(r.kpi.throughput).toBe(0.5);
  expect(r.kpi.cycleMedian).toBe(1.5);   // 레이저 1주 · 잔건 2주
  var pjm = r.byMember.filter(function (m) { return m.key === '박종민'; })[0];
  expect(pjm.active).toBe(2);
  expect(pjm.overdue).toBe(1);
  var lyh = r.byMember.filter(function (m) { return m.key === '이영희'; })[0];
  expect(lyh.done).toBe(2);
});

test('결론 문장 — 지남 · 정체 · 연기가 나옴', function () {
  var t = r.findings.map(function (f) { return f.text; }).join('\n');
  expect(t).toMatch(/납기 지난 일 1건/);
  expect(t).toMatch(/3주째 진척 없는 일/);
  expect(t).toMatch(/납기를 미룬 일 1건 \(모두 2번\)/);
});

test('AI 용 요약 글', function () {
  var txt = wi.toText(r);
  expect(txt).toMatch(/\[납기 지남\] SENKO PICAlign/);
  expect(txt).toMatch(/\[사람\] 박종민/);
});

test('납기 해 넘김 — 12월 주에 ~01/10 은 다음 해', function () {
  expect(wi.deadlineDate('~01/10', '2026-12-21')).toBe('2027-01-10');
  expect(wi.deadlineDate('~12/20', '2027-01-04')).toBe('2026-12-20');
});

test('빈 입력', function () {
  var e = wi.compute([]);
  expect(e.weekly).toEqual([]);
  expect(e.findings).toEqual([]);
});
