// mindmap-report.js — 맵 → 주간 보고 문장 (서버 주간 보고 파서로 다시 읽어 확인)
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const parser = require('../server/services/weekly-report-parser');

function load() {
  const ctx = vm.createContext({ console, window: {}, document: {}, setTimeout, clearTimeout, Date, localStorage: { getItem() { return null; }, setItem() {} } });
  for (const f of ['mindmap-layout.js', 'mindmap.js', 'mindmap-report.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('_mm.members = [{ id: "u1", name: "심정현" }];', ctx);
  return ctx;
}
const N = (id, text, extra, kids) => Object.assign({ id, text, children: kids || [] }, extra || {});
const plain = (x) => JSON.parse(JSON.stringify(x));

function tree() {
  return N('r', '현황', {}, [
    N('m1', 'TSE', {}, [
      N('t1', '기능 개발\n-. 드릴 + 커팅\n-. 해치 가공 @외주', { assigneeId: 'u1', dueDate: '2026-11-05', progress: 60 }, [
        N('d1', 'A1 검증', { done: true }, [N('dd1', '도면 확인')])
      ])
    ]),
    N('m2', '[SDC] 글라스 챔퍼링', {}, [N('t2', '대구경 셋업', { assigneeName: '김 태연' })]),
    N('m3', '[사내] 교육', { progress: 100 })
  ]);
}

test('mmWrSite — [사이트] 앞머리 나누기', () => {
  const g = load();
  assert.deepStrictEqual(plain(g.mmWrSite('[SDC] 글라스 챔퍼링')), { client: 'SDC', prefix: '글라스 챔퍼링' });
  assert.deepStrictEqual(plain(g.mmWrSite('TSE\n둘째 줄')), { client: 'TSE', prefix: '' });
});

test('mmWeeklyText — 서버 파서가 같은 항목 · 마감 · 진척 · 담당 · 상태 · 세부로 읽는다', () => {
  const g = load();
  const t = tree();
  const items = g.mmWeeklyItems(t, g._mmProgressMap(t), g._mmAssigneeName);
  const text = g.mmWeeklyText(items, (id) => (id === 'm3' ? 'etc' : 'dev'));
  const p = parser.parseText(text);
  assert.deepStrictEqual(p.sections.map((s) => s.type), ['dev', 'etc']);
  const [a, b, c] = p.items;
  assert.strictEqual(a.client, 'TSE');
  assert.strictEqual(a.name, '기능 개발');
  assert.strictEqual(a.deadline, '~11/05');
  assert.strictEqual(a.pct, 60);
  assert.deepStrictEqual(a.members, ['심정현', '외주']);
  assert.strictEqual(a.status, 'in_progress');
  assert.deepStrictEqual(a.details.map((d) => [d.text, d.sub]), [['드릴 + 커팅', false], ['해치 가공 @외주', false], ['A1 검증 #완료', false], ['도면 확인', true]]);
  assert.strictEqual(b.client, 'SDC');
  assert.strictEqual(b.name, '글라스 챔퍼링 대구경 셋업');
  assert.deepStrictEqual(b.members, ['김태연'], '이름 사이 공백은 붙여 @ 하나로');
  assert.strictEqual(c.client, '사내');
  assert.strictEqual(c.status, 'done', '하위 없는 1단계는 그 자체가 항목');
});

test('mmWeeklyDiff — 완료 · 진척 오름 · 새 작업 · 지연', () => {
  const g = load();
  const before = tree();
  before.children[0].children[0].progress = 30;
  before.children[0].children[0].children[0].done = false;
  const now = tree();
  now.children[1].children.push(N('t3', '비전 QC', { dueDate: '2026-10-01' }));
  const df = plain(g.mmWeeklyDiff(before, now, g._mmProgressMap(before), g._mmProgressMap(now), '2026-10-27'));
  assert.deepStrictEqual(df.done, ['A1 검증']);
  assert.deepStrictEqual(df.up, [{ text: '기능 개발', from: 30, to: 60 }]);
  assert.deepStrictEqual(df.added, ['비전 QC']);
  assert.deepStrictEqual(df.late, ['비전 QC']);
});

test('mmIsoWeek — 2026-10-27(화) = 26W44, 10/26~10/30', () => {
  const g = load();
  assert.deepStrictEqual(plain(g.mmIsoWeek(new Date(2026, 9, 27))), { yy: '26', ww: '44', mon: '10/26', fri: '10/30' });
  assert.deepStrictEqual(plain(g.mmIsoWeek(new Date(2027, 0, 1))), { yy: '26', ww: '53', mon: '12/28', fri: '01/01' });
});
