// mindmap-risk.js — 규칙 점검 (지연 · 담당 없음 · 마감 없음 · 몰림 · 상위보다 늦은 하위 마감 · 선후 역전 · 진척 정체)
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
  for (const f of ['mindmap-layout.js', 'mindmap.js', 'mindmap-filter.js', 'mindmap-risk.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('_mm.members = [{ id: "u1", name: "심정현" }];', ctx);
  return ctx;
}
const N = (id, extra, kids) => Object.assign({ id, text: id, children: kids || [] }, extra || {});
const TODAY = '2026-10-27';

test('mmRiskFindings — 종류별로 잡고 심각한 것부터', () => {
  const g = load();
  const kids = [];
  for (let i = 0; i < 8; i++) kids.push(N('k' + i, { assigneeId: 'u1', dueDate: '2026-12-0' + (i % 9 + 1) }));
  const root = N('r', {}, [
    N('p', { dueDate: '2026-11-10', assigneeName: '외주' }, [
      N('late', { assigneeName: '외주', dueDate: '2026-10-20', progress: 30 }),
      N('after', { assigneeName: '외주', dueDate: '2026-11-20' }),          // 상위(11-10)보다 늦음
      N('nobody', { dueDate: '2026-11-01' }),                              // 담당 없음
      N('nodue', { assigneeName: '외주' }),                                // 마감 없음
      N('stuck', { assigneeName: '외주', dueDate: '2026-11-05', progress: 40 }),
      N('done', { assigneeName: '외주', dueDate: '2026-10-01', done: true })
    ]),
    N('load', {}, kids),
    N('a', { assigneeName: 'B', dueDate: '2026-11-15' }), N('b', { assigneeName: 'B', startDate: '2026-11-10', dueDate: '2026-11-30' })
  ]);
  const prog = g._mmProgressMap(root);
  const facts = g.mmTaskFacts(root, prog, TODAY);
  const oldProg = { stuck: { p: 40, own: true }, late: { p: 10, own: true } };
  const list = JSON.parse(JSON.stringify(g.mmRiskFindings(root, facts, prog, [{ id: 'r1', from: 'a', to: 'b' }], TODAY, { prog: oldProg, days: 7 })));
  const byKind = {};
  list.forEach((x) => { (byKind[x.kind] = byKind[x.kind] || []).push(x.id || x.who); });
  assert.deepStrictEqual(byKind.late, ['late'], '완료는 지연 아님');
  assert.deepStrictEqual(byKind.reverse, ['b']);
  assert.deepStrictEqual(byKind.parentdue, ['after']);
  assert.deepStrictEqual(byKind.stuck, ['stuck'], '진척이 바뀐 late 는 정체 아님');
  assert.deepStrictEqual(byKind.overload, ['심정현']);
  assert.deepStrictEqual(byKind.noowner, ['nobody']);
  assert.deepStrictEqual(byKind.nodue, ['nodue']);
  assert.strictEqual(list[0].kind, 'late', '지연이 맨 앞');
  assert.match(list[0].detail, /7일 지남 · 외주/);
});

test('mmRiskFindings — 지난 기록이 없으면 정체 점검만 빠짐', () => {
  const g = load();
  const root = N('r', {}, [N('x', { assigneeName: 'A', dueDate: '2026-11-01', progress: 10 })]);
  const prog = g._mmProgressMap(root);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.mmRiskFindings(root, g.mmTaskFacts(root, prog, TODAY), prog, [], TODAY, null))), []);
});
