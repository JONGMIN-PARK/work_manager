// quick-parse.js — 한 줄 빠른 입력 읽기 (v13.253). 웹 할 일 입력 · 등록 창 · 텔레그램 /todo /event 공용
var test = require('node:test');
var assert = require('node:assert');
var Q = require('../quick-parse.js');
var T = '2026-10-28';   // 수요일

function p(s) { return Q.parse(s, T); }

test('날짜 · 시각 · 중요도를 읽고 제목에서 뺀다', function () {
  assert.deepStrictEqual(p('내일 14:00 !긴급 견적 회신'), { title: '견적 회신', due: '2026-10-29', time: '14:00', timeEnd: null, priority: 1, kind: null });
});
test('오늘 · 모레 · 요일 · 다음주 요일', function () {
  assert.strictEqual(p('오늘 정리').due, T);
  assert.strictEqual(p('모레 정리').due, '2026-10-30');
  assert.strictEqual(p('금요일 정리').due, '2026-10-30');
  assert.strictEqual(p('수요일 정리').due, T, '오늘이 그 요일이면 오늘');
  assert.strictEqual(p('월요일 정리').due, '2026-11-02');
  assert.strictEqual(p('다음주 월 정리').due, '2026-11-02');
  assert.strictEqual(p('다음주 금 정리').due, '2026-11-06');
});
test('한 글자 요일은 제목일 수 있어 읽지 않음', function () {
  assert.deepStrictEqual(p('월 마감 보고'), { title: '월 마감 보고', due: null, time: null, timeEnd: null, priority: null, kind: null });
});
test('월/일 · M월 D일 · YYYY-MM-DD — 두 달 넘게 지난 날은 내년', function () {
  assert.strictEqual(p('10/30 보고').due, '2026-10-30');
  assert.strictEqual(p('11월 3일 출장').due, '2026-11-03');
  assert.strictEqual(p('11월3일 출장').due, '2026-11-03');
  assert.strictEqual(p('1/5 신년회').due, '2027-01-05');
  assert.strictEqual(p('2026-12-01 정리').due, '2026-12-01');
  assert.strictEqual(p('2/30 이상한 날').due, null);
});
test('시각 — 24시간 · 범위 · 오전/오후 · 반 · 업무 시간 짐작', function () {
  var a = p('14:00~15:30 리뷰'); assert.strictEqual(a.time, '14:00'); assert.strictEqual(a.timeEnd, '15:30');
  assert.strictEqual(p('오후 3시 반 미팅').time, '15:30');
  assert.strictEqual(p('오후 3시반 미팅').time, '15:30');
  assert.strictEqual(p('오전 9시 조회').time, '09:00');
  assert.strictEqual(p('2시 교육').time, '14:00', '1~7시는 오후로');
  assert.strictEqual(p('9시~10시 회의').timeEnd, '10:00');
  assert.strictEqual(p('오후 2시~4시 교육').timeEnd, '16:00');
  assert.strictEqual(p('오전 정리').title, '오전 정리', '시각이 안 붙은 오전은 제목');
});
test('중요도 표시', function () {
  assert.strictEqual(p('!높음 정리').priority, 2);
  assert.strictEqual(p('!낮음 정리').priority, 4);
  assert.strictEqual(p('!3 정리').priority, 3);
  assert.strictEqual(p('!! 정리').priority, 1);
  assert.strictEqual(p('! 정리').priority, 2);
  assert.strictEqual(p('!!').title, '!!', '표시만 있으면 읽지 않음');
});
test('#종류 — 일정 만들 때', function () {
  assert.strictEqual(p('#회의 고객 미팅').kind, 'meeting');
  assert.strictEqual(p('#오후반차').kind, 'pmoff');
  assert.strictEqual(p('#없는종류 메모').title, '#없는종류 메모');
  var x = p('모레 #연차');
  assert.strictEqual(x.title, '', '날짜 · 종류만 있으면 제목 없이');
  assert.strictEqual(x.kind, 'dayoff');
  assert.strictEqual(x.due, '2026-10-30');
});
