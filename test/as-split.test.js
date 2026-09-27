/**
 * as-manager.js 분할 회귀 테스트 — config.js · project-data.js · as-*.js 를
 * HTML 과 같은 순서로 vm 샌드박스에 로드하고, 로드가 throw 하지 않으며
 * 각 분할 파일의 핵심 전역 함수가 정의되는지 확인한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const AS_FILES = ['as-core.js', 'as-list.js', 'as-form.js', 'as-detail.js', 'as-detail-actions.js', 'as-report.js', 'as-category-admin.js'];

function makeSandbox() {
  const noop = function () {};
  const el = function () {
    return { style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: function () { return false; } },
      appendChild: noop, remove: noop, setAttribute: noop, addEventListener: noop, querySelector: function () { return null; },
      querySelectorAll: function () { return []; }, innerHTML: '' };
  };
  const store = {};
  const listeners = {};
  const sb = {
    console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
    Promise: Promise, URL: URL, Date: Date, JSON: JSON, Math: Math,
    localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } },
    sessionStorage: { getItem: function () { return null; }, setItem: noop, removeItem: noop },
    document: { getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      createElement: el, addEventListener: noop, body: el(), head: el(), documentElement: el() },
    navigator: { userAgent: 'node' },
    location: { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', hostname: 'localhost', search: '' },
    fetch: function () { return Promise.reject(new Error('no network')); },
    apiFetch: function () { return Promise.resolve({ data: [] }); },
    // wmDataBus 가 있으면 as-category-admin.js 의 로드 시점 IIFE 가 청취자를 등록한다
    wmDataBus: { on: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); }, emit: noop },
    __listeners: listeners,
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  sb.addEventListener = noop;
  sb.removeEventListener = noop;
  return vm.createContext(sb);
}

function loadAll() {
  const ctx = makeSandbox();
  ['config.js', 'project-data.js'].concat(AS_FILES).forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}

test('as-*.js 분할 파일이 순서대로 로드되며 throw 하지 않는다', function () {
  assert.doesNotThrow(loadAll);
});

test('as-manager.js 는 더 이상 존재하지 않는다 (완전 분할)', function () {
  assert.strictEqual(fs.existsSync(path.join(ROOT, 'as-manager.js')), false);
});

test('각 분할 파일의 핵심 전역이 정의된다', function () {
  const ctx = loadAll();
  const expected = {
    'as-core.js': ['_asCats', '_asLoadCats', '_asEsc', '_asJsArg', '_asFmtDate', '_asFmtDT'],
    'as-list.js': ['renderAS', 'asClearFilters', 'asOnSearchInput', '_asRenderKanban'],
    'as-form.js': ['showASModal', 'saveASModal', '_asAiAnalyzeClick', '_asModalAttachPicked'],
    'as-detail.js': ['showASDetail', '_asRenderDetail', 'asAttachPreview', '_asTabReportDoc'],
    'as-detail-actions.js': ['asSignSave', 'asPartAdd', 'asAssignmentAdd', 'asLogAdd', 'asReportSave', 'asSoftDeleteTicket', 'asTriggerLinkIssue'],
    'as-report.js': ['asExportExcel', 'asPrintReport', 'asReportPdfPreview', '_asBuildComposeUrl'],
    'as-category-admin.js': ['showASCategoryAdmin', 'saveASCategoryNew', 'deleteASCategory'],
  };
  Object.keys(expected).forEach(function (file) {
    expected[file].forEach(function (name) {
      assert.strictEqual(typeof ctx[name], 'function', file + ': ' + name + ' 미정의');
    });
  });
  assert.strictEqual(ctx.asViewMode, 'all');
  assert.strictEqual(ctx._asEsc('<a&"b">'), '&lt;a&amp;&quot;b&quot;&gt;');
  assert.strictEqual(ctx._asJsArg("it's"), 'it\\&#39;s');
});

test('로드 시 wmDataBus asCategory 청취자가 카테고리 캐시를 무효화한다', function () {
  const ctx = loadAll();
  const fns = ctx.__listeners.asCategory || [];
  assert.strictEqual(fns.length, 1);
  vm.runInContext('_AS_CAT_CACHE = { x: 1 };', ctx);
  fns[0]();
  assert.strictEqual(vm.runInContext('_AS_CAT_CACHE', ctx), null);
});
