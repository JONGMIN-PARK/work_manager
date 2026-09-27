// project-data.js 읽기 캐시(_pdCached) — TTL·중복요청 공유·무효화 세대
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'project-data.js'), 'utf8');
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, Object, Array, String, Number,
    window: {}, document: { getElementById() { return null; }, addEventListener() {}, createElement() { return { style: {} }; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'project-data.js' });
  return sandbox;
}

function deferred() {
  let resolve; const p = new Promise((r) => { resolve = r; });
  return { p, resolve };
}

test('같은 키 동시 요청은 한 번만 로드 (in-flight 공유)', async () => {
  const s = load();
  let n = 0;
  const loader = () => { n++; return Promise.resolve(['a']); };
  const [a, b] = await Promise.all([s._pdCached('ms', loader), s._pdCached('ms', loader)]);
  assert.strictEqual(n, 1);
  assert.strictEqual(a, b);
  await s._pdCached('ms', loader);
  assert.strictEqual(n, 1, 'TTL 안에서는 캐시 사용');
});

test('로드 도중 무효화되면 그 결과는 캐시하지 않는다 (옛 데이터 재캐시 방지)', async () => {
  const s = load();
  const d = deferred();
  const first = s._pdCached('ms', () => d.p);
  s._pdInvalidate('ms');           // 쓰기 발생
  d.resolve(['old']);              // 쓰기 전에 출발한 조회가 늦게 도착
  assert.deepStrictEqual(Array.from(await first), ['old'], '호출자에게는 그대로 반환');
  let n = 0;
  const v = await s._pdCached('ms', () => { n++; return Promise.resolve(['new']); });
  assert.strictEqual(n, 1, '무효화 후에는 다시 로드해야 함');
  assert.deepStrictEqual(Array.from(v), ['new']);
});

test('쓰기 성공 이벤트(_emitBus)가 해당 캐시를 비운다', async () => {
  const s = load();
  await s._pdCached('ms', () => Promise.resolve(['v1']));
  await s._pdCached('proj', () => Promise.resolve(['p1']));
  s._emitBus('milestone', 'updated', {});
  let msLoads = 0, projLoads = 0;
  await s._pdCached('ms', () => { msLoads++; return Promise.resolve(['v2']); });
  await s._pdCached('proj', () => { projLoads++; return Promise.resolve(['p2']); });
  assert.strictEqual(msLoads, 1, 'milestone 이벤트 → ms 캐시 무효화');
  assert.strictEqual(projLoads, 0, 'proj 캐시는 유지');
});

test('전체 무효화는 projAll 포함 모든 키', async () => {
  const s = load();
  await s._pdCached('projAll', () => Promise.resolve(['x']));
  s._pdInvalidate();
  let n = 0;
  await s._pdCached('projAll', () => { n++; return Promise.resolve(['y']); });
  assert.strictEqual(n, 1);
});
