// mindmap-keys.js — 키 이름 · 단축키 표 무결성 (겹침 · 브라우저 예약 조합 · 메뉴 항목)
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function load() {
  const ctx = vm.createContext({ console, window: {}, document: {}, setTimeout, clearTimeout });
  for (const f of ['mindmap-layout.js', 'mindmap.js', 'mindmap-keys.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

test('mmKeyName — 글자는 e.code 기준 (한글 자판 상태여도 같은 이름)', () => {
  const { mmKeyName } = load();
  assert.strictEqual(mmKeyName({ key: 'ㄱ', code: 'KeyR', altKey: true }), 'Alt+R');
  assert.strictEqual(mmKeyName({ key: ']', code: 'BracketRight', ctrlKey: true }), 'Ctrl+]');
  assert.strictEqual(mmKeyName({ key: 'Enter', code: 'Enter', shiftKey: true }), 'Shift+Enter');
  assert.strictEqual(mmKeyName({ key: ' ', code: 'Space' }), 'Space');
  assert.strictEqual(mmKeyName({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+=');
  assert.strictEqual(mmKeyName({ key: 'z', code: 'KeyZ', metaKey: true }), 'Ctrl+Z', 'Mac ⌘ = Ctrl');
  assert.strictEqual(mmKeyName({ key: 'ArrowUp', code: 'ArrowUp', altKey: true }), 'Alt+ArrowUp');
  assert.strictEqual(mmKeyName({ key: '1', code: 'Digit1', altKey: true }), 'Alt+1');
});

test('단축키 표 — 같은 키가 두 명령에 겹치지 않는다', () => {
  const { MM_COMMANDS } = load();
  const seen = {};
  const dup = [];
  for (const c of MM_COMMANDS) {
    for (const k of c.keys || []) {
      if (seen[k]) dup.push(k + ': ' + seen[k] + ' / ' + c.id);
      seen[k] = c.id;
    }
  }
  assert.deepStrictEqual(dup, []);
});

test('단축키 표 — 브라우저가 먼저 가져가는 조합은 쓰지 않는다', () => {
  const { MM_COMMANDS } = load();
  const reserved = ['Ctrl+T', 'Ctrl+W', 'Ctrl+N', 'Ctrl+L', 'Ctrl+P', 'Ctrl+R', 'Ctrl+K', 'Ctrl+Tab', 'Ctrl+PageUp', 'Ctrl+PageDown',
    'Ctrl+Shift+T', 'Ctrl+Shift+N', 'Ctrl+Shift+R', 'Ctrl+Shift+B', 'Ctrl+Shift+O', 'Ctrl+Shift+I', 'Ctrl+Shift+J', 'Ctrl+Shift+C',
    'Alt+D', 'Alt+E', 'Alt+F', 'Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+Home', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V'];
  const used = [].concat(...Array.from(MM_COMMANDS, (c) => Array.from(c.keys || [])));
  assert.deepStrictEqual(used.filter((k) => reserved.includes(k)), []);
});

test('모든 명령에 id · 이름 · 묶음 · 실행 함수, 메뉴 항목은 표에 있음', () => {
  const ctx = load();
  for (const c of ctx.MM_COMMANDS) {
    assert.ok(c.id && c.label && c.group, JSON.stringify(c.id));
    assert.strictEqual(typeof c.run, 'function', c.id);
  }
  const ids = new Set(ctx.MM_COMMANDS.map((c) => c.id));
  for (const list of [ctx.MM_CTX_NODE, ctx.MM_CTX_MULTI, ctx.MM_CTX_CANVAS]) {
    for (const id of list) if (id !== '|') assert.ok(ids.has(id), '메뉴 항목 ' + id);
  }
});

test('우선순위 1~9 · 색 · 마커 명령이 모두 있다', () => {
  const ctx = load();
  const ids = new Set(ctx.MM_COMMANDS.map((c) => c.id));
  for (let i = 1; i <= 9; i++) assert.ok(ids.has('priority:' + i));
  for (const c of ctx.MM_COLORS) assert.ok(ids.has('color:' + (c.key || 'auto')));
  for (const s of ctx.MM_SYMBOLS) assert.ok(ids.has('symbol:' + s.k));
});
