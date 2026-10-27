// mindmap-filter.js — 작업 사실 · 사람별 요약 · 거르기 (순수 부분)
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
function load() {
  const ctx = vm.createContext({ console, window: {}, document: {}, setTimeout, clearTimeout, Date });
  for (const f of ['mindmap-layout.js', 'mindmap.js', 'mindmap-filter.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('_mm.members = [{ id: "u1", name: "심정현" }];', ctx);
  return ctx;
}
const N = (id, extra, kids) => Object.assign({ id, text: id, children: kids || [] }, extra || {});
const TODAY = '2026-10-27';
function tree() {
  return N('r', {}, [
    N('a', { assigneeId: 'u1' }, [
      N('a1', { assigneeId: 'u1', dueDate: '2026-10-20', progress: 40 }),   // 지연
      N('a2', { assigneeName: '외주', dueDate: '2026-10-30' }),             // 이번 주 · 미입력
      N('a3', { assigneeName: '외주', done: true, dueDate: '2026-10-01' })  // 완료 → 지연 아님
    ]),
    N('b', {}, [N('b1', { startDate: '2026-11-10' }), N('b2')])            // 담당 없는 작업 · 작업 아님
  ]);
}

test('mmTaskFacts — 작업 · 지연 · 이번 주 · 미입력 · 완료', () => {
  const g = load();
  const t = tree();
  const f = g.mmTaskFacts(t, g._mmProgressMap(t), TODAY);
  assert.strictEqual(f.r.task, false, '중심 주제는 작업 아님');
  assert.strictEqual(f.a.who, '심정현');
  assert.ok(f.a1.late && !f.a1.week && !f.a1.noprog);
  assert.ok(f.a2.week && f.a2.noprog && !f.a2.late);
  assert.ok(f.a3.done && !f.a3.late);
  assert.ok(f.b1.task && f.b1.noprog && f.b1.who === '');
  assert.strictEqual(f.b2.task, false);
  assert.strictEqual(f.a.p, 70, 'a: (40 + 100) / 2 — 미입력 a2 제외');
});

test('mmPeopleSummary — 작업 많은 순, 담당 없음은 맨 뒤', () => {
  const g = load();
  const t = tree();
  const s = JSON.parse(JSON.stringify(g.mmPeopleSummary(g.mmTaskFacts(t, g._mmProgressMap(t), TODAY))));
  assert.deepStrictEqual(s, [
    { who: '심정현', n: 2, avg: 55, late: 1, done: 0 },   // a(70) · a1(40)
    { who: '외주', n: 2, avg: 100, late: 0, done: 1 },     // a2 값 없음 · a3 100
    { who: '', n: 1, avg: null, late: 0, done: 0 }
  ]);
});

test('mmFilterMatch — 담당 · 상태 함께, 조건 없으면 null', () => {
  const g = load();
  const t = tree();
  const f = g.mmTaskFacts(t, g._mmProgressMap(t), TODAY);
  assert.strictEqual(g.mmFilterMatch(t, f, { who: null, st: null }), null);
  assert.deepStrictEqual(Array.from(g.mmFilterMatch(t, f, { who: '외주', st: null })), ['a2', 'a3']);
  assert.deepStrictEqual(Array.from(g.mmFilterMatch(t, f, { who: '외주', st: 'noprog' })), ['a2']);
  assert.deepStrictEqual(Array.from(g.mmFilterMatch(t, f, { who: null, st: 'late' })), ['a1']);
  assert.deepStrictEqual(Array.from(g.mmFilterMatch(t, f, { who: '', st: null })), ['b1']);
});
