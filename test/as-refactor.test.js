/**
 * A/S 리팩터 회귀 테스트
 *  - _asOverlay: createModal 위에 기존 오버레이 모양(고정 z·블러 없음)을 유지하는지
 *  - as-stats.js 차트 테이블(_AS_STATS_CHARTS + _asChart): 순서·건너뛰기·commonOpts 공유
 *  - SEM_COLOR 치환 값이 원래 hex 와 같은지
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function makeCtx(canvasIds) {
  const noop = function () {};
  const store = {};
  const created = [];
  const sb = {
    console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
    setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise, Date: Date, JSON: JSON, Math: Math,
    localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: noop },
    document: {
      getElementById: function (id) { return (canvasIds || []).indexOf(id) >= 0 ? { id: id } : null; },
      querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      createElement: function () { return { style: {}, appendChild: noop }; }, addEventListener: noop,
      body: { appendChild: noop }, head: { appendChild: noop }
    },
    navigator: { userAgent: 'node' },
    location: { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', hostname: 'localhost', search: '' },
    __modals: created,
    createModal: function (opts) { created.push(opts); return { overlay: { opts: opts }, box: {}, close: noop }; },
    __charts: [],
  };
  sb.Chart = function (ctx, cfg) { sb.__charts.push({ canvasId: ctx.id, cfg: cfg }); this.destroy = noop; };
  sb.Chart.defaults = { font: {} };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  sb.addEventListener = noop;
  const ctx = vm.createContext(sb);
  ['config.js', 'as-core.js', 'as-stats.js'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}

function statsFixture() {
  return {
    period: { groupBy: 'month' },
    trend: { labels: ['2026-01-01', '2026-02-01'], newCount: [1, 2], closedCount: [1, 1], mttrHours: [3, 4] },
    distribution: {
      category: [{ code: 'mechanical', label: '기계', icon: '', value: 2 }],
      priority: [{ code: 'P1', value: 1, color: '#EF4444' }],
      status: [{ code: 'received', value: 1, color: '#94A3B8' }]
    },
    deptLoad: [{ dept: 'service', hours: 2, ticketCount: 1 }],
    sla: { byPriority: [{ priority: 'P1', withinSla: 1, breached: 0, breachPct: 0 }] },
    topCustomers: [{ name: 'A', value: 2, urgentCount: 1 }],
    topEquipment: [{ name: 'X', value: 1 }],
    rca: [{ code: 'wear', value: 1 }],
    csat: { labels: ['2026-01-01'], overall: [4], speed: [4], quality: [4] },
    parts: { byBilling: [{ billing: 'warranty', total: 100 }], labels: ['2026-01-01'], warranty: [1], paid: [0], goodwill: [0], check: [0] }
  };
}

const ALL_IDS = ['chart_trend', 'chart_category', 'chart_priority', 'chart_status', 'chart_sla', 'chart_dept', 'chart_mttr',
  'chart_topCustomers', 'chart_topEquipment', 'chart_rca', 'chart_csat', 'chart_partsBilling', 'chart_partsMonth'];

test('SEM_COLOR 값은 치환 전 hex 와 동일', function () {
  const ctx = makeCtx();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.SEM_COLOR)), {
    danger: '#EF4444', warn: '#F59E0B', ok: '#10B981', info: '#3B82F6', muted: '#94A3B8', purple: '#8B5CF6'
  });
});

test('_asOverlay 는 id·고정 z·블러 제거를 createModal 에 넘긴다 (backdrop 클릭 닫기 없음)', function () {
  const ctx = makeCtx();
  ctx._asOverlay('asDetailOverlay', 9990, 'background:rgba(0,0,0,0.6);padding:30px 20px');
  ctx._asOverlay('asPartAddOverlay', 10001);
  const m = ctx.__modals;
  assert.strictEqual(m.length, 2);
  assert.strictEqual(m[0].id, 'asDetailOverlay');
  assert.strictEqual(m[0].z, 9990);
  assert.strictEqual(m[0].overlayStyle, 'backdrop-filter:none;background:rgba(0,0,0,0.6);padding:30px 20px');
  assert.strictEqual(m[1].overlayStyle, 'backdrop-filter:none');
  assert.ok(!m[0].closeOnOverlay && !m[0].closeOnEsc);
});

test('_AS_STATS_CHARTS 는 13개 차트를 원래 순서대로 그린다', function () {
  const ctx = makeCtx(ALL_IDS);
  assert.deepStrictEqual(Array.from(ctx._AS_STATS_CHARTS, function (s) { return s.canvasId; }), ALL_IDS);
  ctx._asStatsDrawAll(statsFixture());
  assert.deepStrictEqual(ctx.__charts.map(function (c) { return c.canvasId; }), ALL_IDS);
  assert.strictEqual(vm.runInContext('_asStatsCharts.length', ctx), 13);
  const types = ctx.__charts.map(function (c) { return c.cfg.type; });
  assert.deepStrictEqual(types, ['line', 'doughnut', 'bar', 'doughnut', 'bar', 'bar', 'line', 'bar', 'bar', 'bar', 'line', 'doughnut', 'bar']);
  // 추이 차트는 commonOpts 를 그대로 공유, 긴급도·RCA 는 얕은 병합본
  const byId = {};
  ctx.__charts.forEach(function (c) { byId[c.canvasId] = c.cfg; });
  assert.strictEqual(byId.chart_trend.options.scales, byId.chart_priority.options.scales);
  assert.strictEqual(byId.chart_priority.options.plugins.legend.display, false);
  assert.strictEqual(byId.chart_trend.options.plugins.legend.display, undefined);
  assert.strictEqual(byId.chart_sla.data.datasets[0].backgroundColor, '#10B981');
  assert.strictEqual(byId.chart_topCustomers.data.datasets[0].backgroundColor[0], '#EF4444');
  assert.deepStrictEqual(Array.from(byId.chart_trend.data.labels), ['26.01', '26.02']);
});

test('데이터가 없거나 캔버스가 없는 차트는 건너뛴다 (캔버스 없으면 build 도 호출 안 함)', function () {
  const ctx = makeCtx(ALL_IDS.filter(function (id) { return id !== 'chart_dept'; }));
  const d = statsFixture();
  d.rca = [];
  d.deptLoad = null;   // 캔버스가 없으니 build 가 호출되지 않아야 throw 하지 않는다
  ctx._asStatsDrawAll(d);
  const ids = ctx.__charts.map(function (c) { return c.canvasId; });
  assert.strictEqual(ids.indexOf('chart_rca'), -1);
  assert.strictEqual(ids.indexOf('chart_dept'), -1);
  assert.strictEqual(ids.length, 11);
});
