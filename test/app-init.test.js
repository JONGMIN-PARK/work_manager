// app-init.js — _postAuthInit 단계 함수 (레코드 정규화·부트스트랩/60일 로드·히스토리 800ms 지연)
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(apiFetch) {
  const timers = [];
  const sandbox = {
    console: { warn() {}, info() {}, log() {} }, Promise, JSON, Math, Object, Array, String, Number, Set, Date, Error,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    window: { addEventListener() {} },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
    apiFetch,
    aD: [], applied: 0,
    applyADToUI() { sandbox.applied++; },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app-init.js'), 'utf8'), sandbox, { filename: 'app-init.js' });
  sandbox.timers = timers;
  return sandbox;
}
const flush = () => new Promise((r) => setImmediate(r));

test('_wmNormRec: camelCase + hours 숫자 + date YYYYMMDD', () => {
  const s = load(async () => null);
  const r = s._wmNormRec({ order_no: 'A', hours: '2.5', date: '2026-09-21', task_type: 'x' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { orderNo: 'A', hours: 2.5, date: '20260921', taskType: 'x' });
  assert.strictEqual(s._wmNormRec({ hours: 'abc' }).hours, 0);
});

test('_wmCutoffYmd: N일 전 YYYYMMDD', () => {
  const s = load(async () => null);
  const d = new Date(); d.setDate(d.getDate() - 60);
  const exp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  assert.strictEqual(s._wmCutoffYmd(60), exp);
});

test('부트스트랩 성공 → aD 주입 + 800ms 뒤 히스토리 로드(없는 id 만 추가)', async () => {
  const calls = [];
  const s = load(async (url) => {
    calls.push(url);
    if (url.startsWith('/api/bootstrap')) return { archives: { data: [{ id: 1, hours: '1', date: '20260920' }] } };
    return { data: [{ id: 1, hours: 1 }, { id: 2, hours: '3' }] };
  });
  const ctx = { dataLoaded: false, authReadyHandled: false, cutoff60: '20260729' };
  await s._wmLoadFromServer(ctx);
  assert.strictEqual(ctx.dataLoaded, true);
  assert.strictEqual(s.aD.length, 1);
  assert.deepStrictEqual(calls, ['/api/bootstrap?recentDays=60']);
  // 타이머: 8000(타임아웃 race) 다음 800(히스토리)
  assert.deepStrictEqual(s.timers.map((t) => t.ms), [8000, 800]);
  s.timers[1].fn();
  await flush();
  assert.strictEqual(calls[1], '/api/archives/records?endDate=20260729&limit=50000&all=true');
  assert.deepStrictEqual(s.aD.map((r) => r.id), [1, 2]);
  assert.strictEqual(s.aD[1].hours, 3);
  assert.strictEqual(s.applied, 2);
});

test('부트스트랩 실패 → 최근 60일, 그것도 비면 전체 로드 (히스토리 예약 없음)', async () => {
  const calls = [];
  const s = load(async (url) => {
    calls.push(url);
    if (url.startsWith('/api/bootstrap')) return null;
    if (url.includes('startDate=')) return { data: [] };
    return { data: [{ id: 9, hours: 2 }] };
  });
  const ctx = { dataLoaded: false, authReadyHandled: false, cutoff60: '20260729' };
  await s._wmLoadFromServer(ctx);
  assert.deepStrictEqual(calls, ['/api/bootstrap?recentDays=60', '/api/archives/records?startDate=20260729&limit=50000&all=true', '/api/archives/records?limit=50000&all=true']);
  assert.strictEqual(ctx.dataLoaded, true);
  assert.deepStrictEqual(s.aD.map((r) => r.id), [9]);
  assert.deepStrictEqual(s.timers.map((t) => t.ms), [8000, 8000, 8000]);
});

test('_wmNeedAuthWait: 토큰 없고 미로드일 때만', () => {
  const s = load(async () => null);
  s._accessToken = null;
  assert.strictEqual(s._wmNeedAuthWait({ dataLoaded: false }), true);
  assert.strictEqual(s._wmNeedAuthWait({ dataLoaded: true }), false);
  s._accessToken = 't';
  assert.strictEqual(s._wmNeedAuthWait({ dataLoaded: false }), false);
});
