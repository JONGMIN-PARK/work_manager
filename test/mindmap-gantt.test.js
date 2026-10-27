// mindmap-gantt.js · mindmap-history.js — 일정 계산(막대 · 요약 · 통계 · 거르기) · 버전 비교
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function load(root) {
  const ctx = vm.createContext({ console, window: {}, document: {}, setTimeout, clearTimeout, Date });
  for (const f of ['mindmap-layout.js', 'mindmap.js', 'mindmap-gantt.js', 'mindmap-history.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  // 화면 없이 쓰는 최소 대역
  vm.runInContext('function _mmRefDone(n) { return false; } function _mmNodeColor() { return "c"; }', ctx);
  if (root) vm.runInContext('_mm.doc = { sheets: [{ id: "s", root: ' + JSON.stringify(root) + ' }] }; _mm.sheetIdx = 0;', ctx);
  return ctx;
}
const N = (id, extra, kids) => Object.assign({ id, text: id, children: kids || [] }, extra || {});

test('날짜 ↔ 일 번호 왕복 · 요일', () => {
  const g = load();
  const d = g._mmgDay('2026-10-27');
  assert.strictEqual(g._mmgStr(d), '2026-10-27');
  assert.strictEqual(g._mmgStr(d + 5), '2026-11-01', '월 넘김');
  assert.strictEqual(g._mmgDow(d), 2, '화요일');
  assert.strictEqual(g._mmgDay(''), null);
});

test('막대 종류 — 시작~마감 / 마감만 ◆ / 시작만 하루 / 뒤바뀐 날짜', () => {
  const g = load();
  const day = g._mmgDay;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g._mmgSpan({ startDate: '2026-10-01', dueDate: '2026-10-05' }))), { s: day('2026-10-01'), e: day('2026-10-05'), kind: 'task', src: 'own' });
  assert.strictEqual(g._mmgSpan({ dueDate: '2026-10-05' }).kind, 'mile');
  const one = g._mmgSpan({ startDate: '2026-10-05' });
  assert.strictEqual(one.e - one.s, 0);
  const sw = g._mmgSpan({ startDate: '2026-10-09', dueDate: '2026-10-01' });
  assert.ok(sw.s < sw.e, '시작 > 마감이면 바꿔서');
  assert.strictEqual(g._mmgSpan({}), null);
});

test('연결된 앱 데이터는 원본 날짜로 (자기 날짜가 없을 때)', () => {
  const g = load();
  g._mm.refs = { 'milestone:m1': { start: '2026-10-01T00:00:00.000Z', end: '2026-10-10T00:00:00.000Z', progress: 40 } };
  const sp = g._mmgSpan({ ref: { type: 'milestone', id: 'm1' } });
  assert.strictEqual(sp.src, 'ref');
  assert.strictEqual(sp.e - sp.s, 9);
  assert.strictEqual(g._mmgProg({ ref: { type: 'milestone', id: 'm1' } }), 40);
  assert.strictEqual(g._mmgSpan({ startDate: '2026-11-01', ref: { type: 'milestone', id: 'm1' } }).src, 'own', '자기 날짜가 먼저');
});

test('부모 요약 — 하위 일정 묶음 · 진척은 맵과 같은 값', () => {
  const root = N('r', {}, [
    N('a', {}, [
      N('a1', { startDate: '2026-10-01', dueDate: '2026-10-10', progress: 100 }),   // 10일 100%
      N('a2', { startDate: '2026-10-11', dueDate: '2026-10-20', progress: 0 })      // 10일 0%
    ]),
    N('b')
  ]);
  const g = load(root);
  const data = g._mmgCollect(root);
  const a = data.info.a.sum;
  assert.strictEqual(g._mmgStr(a.s), '2026-10-01');
  assert.strictEqual(g._mmgStr(a.e), '2026-10-20');
  assert.strictEqual(a.prog, 50);
  assert.strictEqual(data.info.b.sum, undefined, '하위 일정이 없으면 요약 없음');
  assert.strictEqual(data.info.r.sum.prog, 50);
});

test('진척 — 맵(mmProgressRollup)과 같다: 기간 가중 아님 · 값 없는 하위 제외', () => {
  const root = N('r', {}, [
    N('a', {}, [
      N('a1', { startDate: '2026-10-01', dueDate: '2026-10-02', progress: 100 }),   // 2일 100%
      N('a2', { startDate: '2026-10-03', dueDate: '2026-10-12', progress: 0 }),     // 10일 0%
      N('a3', { startDate: '2026-10-13', dueDate: '2026-10-14' })                   // 값 없음 → 제외
    ])
  ]);
  const g = load(root);
  const data = g._mmgCollect(root);
  assert.strictEqual(data.info.a.sum.prog, 50, '(100 + 0) / 2');
  assert.strictEqual(g._mmgProg(root.children[0]), g._mmProgressMap(root).a.p);
  assert.strictEqual(g._mmgProg(root.children[0].children[2]), 0, '값 없는 행은 0');
});

test('통계 · 거르기 (지연만 → 위 단계 포함)', () => {
  const today = new Date();
  const ds = (o) => { const d = new Date(today); d.setDate(d.getDate() + o); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const root = N('r', {}, [
    N('p', {}, [
      N('late', { startDate: ds(-10), dueDate: ds(-2), progress: 50 }),
      N('done', { startDate: ds(-10), dueDate: ds(-3), done: true }),
      N('run', { startDate: ds(-1), dueDate: ds(3) }),
      N('none')
    ])
  ]);
  const g = load(root);
  const data = g._mmgCollect(root);
  const st = g._mmgStats(data);
  assert.deepStrictEqual([st.all, st.late, st.done, st.run, st.week, st.nodate], [3, 1, 1, 1, 1, 1]);
  assert.deepStrictEqual(Array.from(g._mmgRows(data, 'late')), ['r', 'p', 'late']);
  assert.deepStrictEqual(Array.from(g._mmgRows(data, 'nodate')), ['r', 'p', 'none']);
  assert.strictEqual(g._mmgRows(data, '').length, 6);
});

test('버전 비교 — 추가 · 삭제 · 수정 · 이동 (주제 id 기준)', () => {
  const g = load();
  const old = { sheets: [{ root: N('r', {}, [N('a', {}, [N('a1')]), N('b'), N('c', { dueDate: '2026-10-01' })]) }] };
  const cur = { sheets: [{ root: N('r', {}, [N('a'), N('b', {}, [N('a1')]), N('c', { dueDate: '2026-10-09' }), N('new')]) }] };
  cur.sheets[0].root.children[0].text = 'A 바뀜';
  const d = g.mmHistDiff(old, cur);
  assert.deepStrictEqual(Object.assign({}, d.counts), { del: 0, chg: 2, mov: 1, add: 1 });
  assert.ok(d.mov.a1, 'a1 은 a → b 로 옮김');
  assert.deepStrictEqual(Array.from(d.chg.c.fields), ['dueDate']);
  assert.deepStrictEqual(Array.from(d.add), ['new']);
  const d2 = g.mmHistDiff(cur, old);
  assert.ok(d2.del.new, '반대로 보면 new 는 이후 삭제됨');
});
