// notebook-print.js — 🖨 출력 양식 (v13.319)
var test = require('node:test');
var assert = require('node:assert');
var P = require('../notebook-print.js');

var MEET = '## 개요\n- **일시**: 2026-11-03 14:00~15:30\n- **장소**: 3층 회의실\n- **참석**: 김철수, 이영희, 박민수\n\n## 안건\n1. 소음 원인\n2. 일정\n\n' +
  '## 논의 내용\n- 베어링 마모 확인\n\n## 결정 사항\n> [!IMPORTANT] 결정\n> 베어링 교체\n\n## 할 일\n| 할 일 | 담당 | 기한 |\n|---|---|---|\n| 베어링 발주 | 김철수 | 11/10 |\n|  |  |  |\n- [ ] 도면 수정 @이영희 ~11/12\n\n## 다음 회의\n- 11/17';
var DAILY = '# 2026.11.02 (월) 업무 일지\n\n## 🗓 오늘 일정\n- **09:00** 🤝 주간 회의\n\n## 🎯 오늘 할 일\n- [x] 🐞 소음 확인 — A사\n- [ ] ✏️ 보고서 ⟦todo-1⟧\n\n' +
  '## ⚠️ 밀린 일 (1)\n- [ ] 도면 (마감 10/30)\n\n## ✅ 끝낸 일\n- [x] 견적서\n\n## 📝 메모\n- \n\n## 🔜 내일 이어서\n- [ ] 보고서 마무리\n';

test('회의록 — 개요 칸 · 안건 · 할 일(표 + 목록) · 결정 상자 풀기', function () {
  var m = P.parseMeeting(MEET, '회의록 — 컨베이어 소음', '2026-11-02');
  assert.strictEqual(m.title, '컨베이어 소음');
  assert.deepStrictEqual(m.att, ['김철수', '이영희', '박민수']);
  assert.deepStrictEqual(m.when, { date: '2026-11-03', start: '14:00', end: '15:30' });
  assert.strictEqual(m.fields.place, '3층 회의실');
  assert.deepStrictEqual(m.agenda.map(function (a) { return a.text; }), ['소음 원인', '일정']);
  assert.deepStrictEqual(m.todos.map(function (t) { return [t.title, t.who, t.due]; }), [['베어링 발주', '김철수', '11/10'], ['도면 수정', '이영희', '11/12']]);
  assert.strictEqual(m.decide, '베어링 교체');
});

test('회의록 — 칸 이름이 달라도 · 모르는 칸은 기타로', function () {
  var m = P.parseMeeting('## 회의 정보\n장소: 본사\n참석자: A / B\n## Action Items\n- 견적 회신 (담당: 김, 기한 11/15)\n## 논의 사항\n내용\n## 참고 자료\n- 링크', '주간 미팅', '2026-11-02');
  assert.strictEqual(m.fields.place, '본사');
  assert.deepStrictEqual(m.att, ['A', 'B']);
  assert.deepStrictEqual([m.todos[0].title, m.todos[0].who, m.todos[0].due], ['견적 회신', '김', '11/15']);
  assert.strictEqual(m.discuss, '내용');
  assert.strictEqual(m.others[0].head, '참고 자료');
  assert.strictEqual(m.when.date, '2026-11-02', '일시가 없으면 노트 날짜');
});

test('일일 업무 — 칸 나누기 · 실적 셈 · ⟦할 일⟧ 표시는 안 보임', function () {
  var d = P.parseDaily(DAILY, '');
  assert.strictEqual(d.date, '2026-11-02');
  assert.deepStrictEqual(d.schedule, [{ time: '09:00', text: '🤝 주간 회의' }]);
  assert.deepStrictEqual(d.stats, { done: 2, open: 2, late: 1, events: 1 });
  assert.strictEqual(d.memo, '', '빈 메모 칸은 없음');
  assert.strictEqual(d.tomorrow[0].text, '보고서 마무리');
  var b = P.build([{ kind: 'daily', date: '2026-11-02', body: DAILY }], { now: '2026-11-02 18:00' });
  assert.deepStrictEqual(b.forms, ['daily']);
  assert.ok(b.inner.indexOf('todo-1') < 0 && b.inner.indexOf('⟦') < 0);
  assert.ok(/업무 실적/.test(b.inner) && /밀린 일/.test(b.inner) && /내일 계획/.test(b.inner));
});

test('일일 — 제목 없는 자유 메모: 체크 줄은 표로 · 메모에서는 뺌', function () {
  var d = P.parseDaily('그냥 메모\n- [x] 일 하나\n- [ ] 일 둘', '2026-11-03');
  assert.strictEqual(d.plan.length, 2);
  assert.strictEqual(d.free, '그냥 메모');
});

test('양식 알아내기', function () {
  assert.strictEqual(P.detectForm({ kind: 'daily', body: 'x' }), 'daily');
  assert.strictEqual(P.detectForm({ kind: 'daily', ref: 'mtg-1', body: 'x' }), 'memo');
  assert.strictEqual(P.detectForm({ kind: 'note', title: '주간 회의록', body: '' }), 'meeting');
  assert.strictEqual(P.detectForm({ kind: 'note', title: 'x', tags: ['일일업무'], body: '' }), 'daily');
  assert.strictEqual(P.detectForm({ kind: 'note', title: '무제', body: MEET }), 'meeting', '칸 이름으로');
  assert.strictEqual(P.detectForm({ kind: 'note', title: '센서 사양', body: '# 사양\n본문' }), 'doc');
});

test('만들기 — 결재란 · 머리글 · 문서 번호 · 이스케이프', function () {
  var r = P.build([{ kind: 'note', id: 'n-abc123', title: '<b>위험</b> 사양', body: '본문 <script>x</script>', date: '2026-11-02' }],
    { form: 'doc', sign: '담당,팀장', company: '애니모션', writer: '박', now: '2026-11-02 18:00' });
  assert.strictEqual(r.docNo, 'DOC-20261102-C123');
  assert.ok(r.inner.indexOf('<script>') < 0 && r.inner.indexOf('<b>위험') < 0);
  assert.ok(/>담당</.test(r.inner) && />팀장</.test(r.inner) && r.inner.indexOf('애니모션') >= 0);
  var none = P.build([{ kind: 'note', title: 'a', body: 'b' }], { form: 'doc', header: false, docNo: false, company: '애니모션' });
  assert.ok(none.inner.indexOf('문서번호') < 0 && none.inner.indexOf('3px double') < 0);
  var pg = P.page(r.inner, { pageNo: true, docNo: true, company: '애"니' }, r.title, r.docNo);
  assert.ok(/counter\(page\)/.test(pg) && /@top-right\{content:"DOC-20261102-C123"/.test(pg));
  assert.ok(pg.indexOf('애"니') < 0, 'CSS 문자열 안 따옴표는 지움');
  assert.ok(/<br clear="all" style="page-break-before:always">/.test(P.word('a<div class="pg-brk" style="x"></div>b', {}, 't')));
});

test('묶음 — 표지 · 목차 · 쪽 나눔 · 결재란은 표지에만', function () {
  var items = [{ kind: 'daily', date: '2026-11-02', body: DAILY }, { kind: 'daily', date: '2026-11-03', body: '- [x] 하나' }];
  var r = P.build(items, { sign: '작성,승인', perPage: true, toc: true });
  assert.strictEqual(r.title, '일일 업무 보고 모음');
  assert.strictEqual((r.inner.match(/class="pg-brk"/g) || []).length, 2);
  assert.strictEqual((r.inner.match(/>승인</g) || []).length, 1);
  assert.ok(/목차/.test(r.inner) && /기록한 날/.test(r.inner));
  var c = P.build(items, { perPage: false, toc: false });
  assert.strictEqual((c.inner.match(/class="pg-brk"/g) || []).length, 0);
});

test('모양 3가지 · 날짜 읽기', function () {
  ['basic', 'formal', 'clean'].forEach(function (t) { assert.ok(P.build([{ kind: 'note', title: '회의록', body: MEET }], { theme: t }).inner.length > 1000, t); });
  assert.ok(/■ 1\. 회의 개요/.test(P.build([{ kind: 'note', title: '회의록', body: MEET }], { theme: 'formal' }).inner));
  assert.deepStrictEqual(P.parseWhen('11/3(월) 14:00', '2026-01-01'), { date: '2026-11-03', start: '14:00', end: null });
  assert.strictEqual(P.parseWhen('2026년 1월 5일').date, '2026-01-05');
  assert.strictEqual(P.parseWhen('13/40').date, null);
});
