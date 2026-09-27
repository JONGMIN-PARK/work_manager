// wmDataBus 탭 의존 맵(WM_TAB_DEPS) — 자동 재렌더(core-bus.js)와 탭 캐시 무효화(mode.js)가 같은 맵을 쓰는지
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function load() {
  const timers = new Map();
  let seq = 0;
  const rendered = [];
  const el = () => null;
  const ctx = vm.createContext({
    console,
    Date,
    setTimeout: (fn) => { const id = ++seq; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: 'complete', getElementById: el, querySelector: el, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {} }), body: { style: {}, classList: { toggle() {} } } },
    IntersectionObserver: function () { return { observe() {} }; },
  });
  ctx.window = ctx;
  for (const f of ['core-bus.js', 'mode.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  for (const fn of ['renderPipeline', 'initCalendar', 'renderTimeline', 'renderOrders', 'renderPrestudy', 'renderTech', 'renderIssues', 'renderDocManager', 'renderAS']) {
    ctx[fn] = () => rendered.push(fn);
  }
  const flush = () => { const fns = [...timers.values()]; timers.clear(); fns.forEach((f) => f()); };
  const run = (code) => vm.runInContext(code, ctx);
  return { ctx, rendered, flush, run };
}

test('WM_TAB_DEPS — 파이프라인·타임라인이 수주(order), 타임라인이 일정(event) 변경에 의존', () => {
  const { ctx } = load();
  const D = ctx.WM_TAB_DEPS;
  assert.ok(D && typeof D === 'object');
  assert.ok(D.pipeline.order && D.pipeline.project && D.pipeline.issue);
  assert.ok(D.timeline.order && D.timeline.event && D.timeline.milestone);
  assert.ok(D.archive.archive && D.trend.archive);
});

for (const [mode, fn, type] of [['timeline', 'renderTimeline', 'order'], ['timeline', 'renderTimeline', 'event'], ['pipeline', 'renderPipeline', 'order']]) {
  test(`${mode} 탭 열린 채 ${type} 변경 → 캐시 무효화 + 즉시 재렌더`, () => {
    const { rendered, flush, run } = load();
    run(`curPage='project'; curMode='${mode}'; _modeRendered['${mode}']=Date.now();`);
    run(`wmDataBus.emit('${type}','updated',{})`);
    assert.strictEqual(run(`_modeRendered['${mode}']`), undefined, '캐시가 무효화돼야 함');
    flush();
    assert.deepStrictEqual(rendered, [fn]);
    assert.ok(run(`_modeRendered['${mode}']`), '재렌더 후 캐시 타임스탬프 갱신');
  });
}

test('의존하지 않는 type 변경은 재렌더·무효화하지 않음', () => {
  const { rendered, flush, run } = load();
  run(`curPage='project'; curMode='timeline'; _modeRendered.timeline=123;`);
  run(`wmDataBus.emit('prestudy','updated',{})`);
  flush();
  assert.deepStrictEqual(rendered, []);
  assert.strictEqual(run('_modeRendered.timeline'), 123);
});

test('비활성 탭은 재렌더 없이 캐시만 무효화, 팀 페이지에선 재렌더 없음', () => {
  const { rendered, flush, run } = load();
  run(`curPage='team'; curMode='archive'; _modeRendered.timeline=1; _modeRendered.archive=1;`);
  run(`wmDataBus.emit('order','updated',{})`);
  run(`wmDataBus.emit('archive','updated',{})`);
  flush();
  assert.deepStrictEqual(rendered, []);
  assert.strictEqual(run('_modeRendered.timeline'), undefined);
  assert.strictEqual(run('_modeRendered.archive'), undefined);
});

test('두 리스너가 같은 맵 객체를 참조 — 맵 하나만 고치면 둘 다 반영', () => {
  const { rendered, flush, run } = load();
  run(`WM_TAB_DEPS.timeline.fooType=1; curPage='project'; curMode='timeline'; _modeRendered.timeline=1;`);
  run(`wmDataBus.emit('fooType','updated',{})`);
  assert.strictEqual(run('_modeRendered.timeline'), undefined);
  flush();
  assert.deepStrictEqual(rendered, ['renderTimeline']);
});
