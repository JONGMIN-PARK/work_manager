// apiFetch (auth.js) — 재시도·타임아웃 동작
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// fetch 는 호출 순서대로 handlers[i] 를 실행 — (url, opts) => Promise<Response 흉내>
function load(handlers) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
  const calls = [];
  const store = {};
  const sandbox = {
    console, setTimeout, clearTimeout, AbortController, Promise, Error, JSON, String,
    location: { protocol: 'https:', hostname: 'example.test' },
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    window: {},
    FormData: function FormData() {},
    fetch: (url, opts) => {
      const i = calls.length;
      calls.push({ url, signal: opts.signal });
      const h = handlers[Math.min(i, handlers.length - 1)];
      return h(url, opts);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'auth.js' });
  return { apiFetch: sandbox.apiFetch, calls };
}

const ok = (body) => () => Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(body) });
const netErr = () => () => Promise.reject(new TypeError('Failed to fetch'));
// signal 이 abort 될 때까지 대기 (응답 없는 서버)
const hang = () => (url, opts) => new Promise((_, rej) => {
  if (opts.signal.aborted) return rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

test('GET 네트워크 오류 → 재시도해서 성공', async () => {
  const { apiFetch, calls } = load([netErr(), ok({ data: [1] })]);
  const r = await apiFetch('/api/x');
  assert.deepStrictEqual(r.data, [1]);
  assert.strictEqual(calls.length, 2);
});

test('재시도마다 새 signal — 이전 시도의 abort 상태를 물려받지 않음', async () => {
  const { apiFetch, calls } = load([netErr(), netErr(), ok({ data: 'ok' })]);
  await apiFetch('/api/x');
  assert.strictEqual(calls.length, 3);
  assert.notStrictEqual(calls[0].signal, calls[1].signal);
  assert.notStrictEqual(calls[1].signal, calls[2].signal);
  assert.strictEqual(calls[2].signal.aborted, false);
});

test('네트워크 오류 재시도도 타임아웃이 걸린다 (무한 대기 없음)', async () => {
  const { apiFetch, calls } = load([netErr(), hang()]);
  const t0 = Date.now();
  await assert.rejects(apiFetch('/api/x', { timeoutMs: 80 }), (e) => e.name === 'AbortError');
  assert.ok(Date.now() - t0 < 2000, '재시도가 타임아웃 안에 끝나야 함');
  assert.strictEqual(calls.length, 2, '타임아웃(AbortError)은 재시도하지 않음');
});

test('POST 는 재시도하지 않음', async () => {
  const { apiFetch, calls } = load([netErr(), ok({})]);
  await assert.rejects(apiFetch('/api/x', { method: 'POST', body: '{}' }));
  assert.strictEqual(calls.length, 1);
});

test('호출자 signal 로 취소 가능', async () => {
  const { apiFetch } = load([hang()]);
  const ac = new AbortController();
  const p = apiFetch('/api/x', { signal: ac.signal, timeoutMs: 5000 });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, (e) => e.name === 'AbortError');
});
