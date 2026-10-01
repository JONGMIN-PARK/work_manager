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
  const body = JSON.parse(calls[1][2]);
  // v13.213: 쓰기 때 항목마다 고유 iid 를 채운다 (위치가 바뀌어도 같은 항목을 찾도록)
  assert.ok(body.items.every((it) => /^i[a-z0-9]+$/.test(it.iid)));
  body.items.forEach((it) => { delete it.iid; });
  assert.deepStrictEqual(body, { items: [{ text: 'a' }, { text: 'b', done: true, doneDate: '2026-09-27' }] });
});

test('iid 로 항목을 찾고 version 을 보낸다 — 409 면 다시 읽어 같은 변경을 재적용', async () => {
  let row = { id: 'c1', version: 3, items: [{ iid: 'ia', text: 'a' }, { iid: 'ib', text: 'b' }] };
  const puts = [];
  let first = true;
  const s = load((url, opt) => {
    if (!opt) return Promise.resolve({ data: JSON.parse(JSON.stringify(row)) });
    const b = JSON.parse(opt.body);
    puts.push(b.version);
    if (first) {   // 그 사이 다른 사람이 맨 앞에 항목을 넣고 저장
      first = false;
      row = { id: 'c1', version: 4, items: [{ iid: 'iz', text: 'z' }].concat(row.items) };
      return Promise.reject(Object.assign(new Error('409'), { status: 409, data: { error: 'CONFLICT' } }));
    }
    row = Object.assign({}, row, { items: b.items, version: row.version + 1 });
    return Promise.resolve({ data: row });
  });
  await s.chkPatchItem('c1::ib', { done: true });
  assert.deepStrictEqual(puts, [3, 4]);
  assert.deepStrictEqual(row.items.map((it) => it.text + (it.done ? ':x' : '')), ['z', 'a', 'b:x']);
});

test("'::' 없는 id·범위 밖 인덱스는 거부 (예전엔 null db.transaction 으로 TypeError)", async () => {
  let n = 0;
  const s = load(() => { n++; return Promise.resolve({ data: { id: 'c1', items: [] } }); });
  await assert.rejects(s.chkPatchItem('legacy-id', { text: 'x' }), /수정할 수 없는/);
  assert.strictEqual(n, 0, '서버 호출 없음');
  await assert.rejects(s.chkPatchItem('c1::3', { text: 'x' }), /찾을 수 없습니다/);
});
