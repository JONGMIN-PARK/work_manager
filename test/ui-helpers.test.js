// ui-helpers.js — wmRestoreFocus: 재렌더 뒤 검색창 포커스·캐럿 복원
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fakeInput(value, opts) {
  opts = opts || {};
  return {
    value,
    focused: false,
    sel: null,
    focus() { this.focused = true; },
    setSelectionRange(a, b) {
      if (opts.throws) throw new Error('InvalidStateError');
      this.sel = [a, b];
    },
  };
}

function load(elements) {
  const sandbox = {
    Math,
    document: { getElementById: (id) => (Object.prototype.hasOwnProperty.call(elements, id) ? elements[id] : null) },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui-helpers.js'), 'utf8'), sandbox, { filename: 'ui-helpers.js' });
  return sandbox;
}

test('캐럿 생략 → 포커스 + 값 끝으로', () => {
  const el = fakeInput('가나다');
  const s = load({ q: el });
  assert.strictEqual(s.wmRestoreFocus('q'), el);
  assert.strictEqual(el.focused, true);
  assert.deepStrictEqual(el.sel, [3, 3]);
});

test('캐럿 지정 → 그 위치, 값 길이를 넘으면 끝으로', () => {
  const el = fakeInput('가나X다');
  const s = load({ q: el });
  s.wmRestoreFocus('q', 2);
  assert.deepStrictEqual(el.sel, [2, 2]);
  s.wmRestoreFocus('q', 99);
  assert.deepStrictEqual(el.sel, [4, 4]);
  s.wmRestoreFocus('q', 0);
  assert.deepStrictEqual(el.sel, [0, 0]);
});

test('요소가 없으면 null, 아무 일도 안 함', () => {
  const s = load({});
  assert.strictEqual(s.wmRestoreFocus('nope'), null);
});

test('setSelectionRange 미지원 input 이어도 예외 없이 포커스는 유지', () => {
  const el = fakeInput('abc', { throws: true });
  const s = load({ q: el });
  assert.doesNotThrow(() => s.wmRestoreFocus('q'));
  assert.strictEqual(el.focused, true);
});

test('빈 값·value 없음 → 0 위치', () => {
  const el = fakeInput(undefined);
  const s = load({ q: el });
  s.wmRestoreFocus('q');
  assert.deepStrictEqual(el.sel, [0, 0]);
});
