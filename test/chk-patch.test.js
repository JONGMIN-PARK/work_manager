// project-data.js chkPatchItem — 체크리스트 항목(flat id 'row::idx') 부분 수정 (project-detail 의 완료일/텍스트 인라인 수정)
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(apiFetch) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Promise, Date, JSON, Math, Object, Array, String, Number,
    window: {}, document: { getElementById() { return null; }, addEventListener() {}, createElement() { return { style: {} }; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    apiFetch,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'project-data.js'), 'utf8'), sandbox, { filename: 'project-data.js' });
  return sandbox;
}

test('부모 row 의 해당 항목만 고쳐 items 통째로 PUT', async () => {
  const calls = [];
  const s = load((url, opt) => {
    calls.push([url, opt && opt.method, opt && opt.body]);
    if (!opt) return Promise.resolve({ data: { id: 'c1', items: JSON.stringify([{ text: 'a' }, { text: 'b', done: true }]) } });
    return Promise.resolve({ data: { id: 'c1' } });
  });
  await s.chkPatchItem('c1::1', { doneDate: '2026-09-27' });
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[1].slice(0, 2), ['/api/checklists/c1', 'PUT']);
  assert.deepStrictEqual(JSON.parse(calls[1][2]), { items: [{ text: 'a' }, { text: 'b', done: true, doneDate: '2026-09-27' }] });
});

test("'::' 없는 id·범위 밖 인덱스는 거부 (예전엔 null db.transaction 으로 TypeError)", async () => {
  let n = 0;
  const s = load(() => { n++; return Promise.resolve({ data: { id: 'c1', items: [] } }); });
  await assert.rejects(s.chkPatchItem('legacy-id', { text: 'x' }), /수정할 수 없는/);
  assert.strictEqual(n, 0, '서버 호출 없음');
  await assert.rejects(s.chkPatchItem('c1::3', { text: 'x' }), /찾을 수 없습니다/);
});
