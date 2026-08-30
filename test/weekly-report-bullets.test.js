// 주간업무 보고 — 세부(두 번째) 줄 기본 도형 인식 (v13.181)
// 실행: node --test  (Node 18+ 내장 러너)
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadClient() {
  const file = path.join(__dirname, '..', 'weekly-report-admin.js');
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(/\}\)\(\);\s*$/,
    '\n  window.__weekly = { clientParseText, buildPreviewHTML };\n})();\n');
  const sandbox = { window: {}, document: { getElementById() { return null; } } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'weekly-report-admin.js' });
  return sandbox.window.__weekly;
}

const client = loadClient();
const server = require('../server/services/weekly-report-parser');
const plain = (x) => JSON.parse(JSON.stringify(x));
const clientItems = (parsed) => parsed.sections.reduce((acc, s) => acc.concat(s.items), []);

// 세부 줄 앞에 올 수 있는 기본 도형들 — 이전에는 ':' 와 '-.' 만 인식하고 나머지는 줄째로 버려졌다
const BULLETS = [':', '-.', '-', '–', '*', '+', '·', '•', '○', '●', '▪', '▶', '>', '└', '↳', '→'];

test('세부 줄: 기본 도형 전부 인식 (클라/서버 동일)', () => {
  for (const mark of BULLETS) {
    const input = '[셋업]\n- [A] 업무 ~09/15 85%\n  ' + mark + ' 두번째줄 내용';
    const c = clientItems(client.clientParseText(input))[0];
    const s = server.parseText(input).items[0];
    assert.deepStrictEqual(plain(c.details.map((d) => d.text)), ['두번째줄 내용'], '클라 ' + mark);
    assert.deepStrictEqual(plain(s.details.map((d) => d.text)), ['두번째줄 내용'], '서버 ' + mark);
  }
});

test('세부 줄: 도형 없이 들여쓰기만 해도 인식, 들여쓰기 없는 줄은 무시', () => {
  const indented = '[셋업]\n- [A] 업무\n  들여쓴 세부';
  assert.strictEqual(clientItems(client.clientParseText(indented))[0].details.length, 1);
  assert.strictEqual(server.parseText(indented).items[0].details.length, 1);

  const flush = '[셋업]\n- [A] 업무\n들여쓰지 않은 메모';
  assert.strictEqual(clientItems(client.clientParseText(flush))[0].details.length, 0);
  assert.strictEqual(server.parseText(flush).items[0].details.length, 0);
});

test('하위 줄: └ ↳ → 또는 4칸 들여쓰기만 sub, 일반 도형은 아님', () => {
  const input = '[셋업]\n- [A] 업무\n  ○ 첫 세부\n  └ 하위 줄\n    깊게 들여쓴 줄';
  const c = clientItems(client.clientParseText(input))[0];
  const s = server.parseText(input).items[0];
  assert.deepStrictEqual(plain(c.details.map((d) => !!d.sub)), [false, true, true]);
  assert.deepStrictEqual(plain(s.details.map((d) => !!d.sub)), [false, true, true]);
});

test('항목 줄: 앞머리 도형이 무엇이든(또는 없어도) 항목으로 인식', () => {
  for (const head of ['- ', '○ ', '· ', '', '-']) {
    const input = '[개발]\n' + head + '[A] 업무 ~09/15';
    const c = clientItems(client.clientParseText(input))[0];
    const s = server.parseText(input).items[0];
    assert.strictEqual(c && c.client, 'A', '클라 head=' + JSON.stringify(head));
    assert.strictEqual(s && s.client, 'A', '서버 head=' + JSON.stringify(head));
  }
});

test('알 수 없는 [xxx] 단독 줄은 항목으로 오인하지 않음', () => {
  const input = '[개발]\n[오타섹션]\n- [A] 업무';
  assert.strictEqual(clientItems(client.clientParseText(input)).length, 1);
  assert.strictEqual(server.parseText(input).items.length, 1);
});

test('미리보기: 기본 도형이 두 번째 세부 줄에도 적용, 하위 줄만 └', () => {
  const parsed = client.clientParseText('[셋업]\n- [A] 업무 ~09/15\n  : 첫 세부\n  : 두 번째 세부\n  └ 하위 줄');
  const html = client.buildPreviewHTML(parsed);
  const planned = (html.match(/border:2px solid/g) || []).length;
  assert.strictEqual(planned, 2, '무태그 세부 2줄 모두 예정(○) 도형');
  assert.ok(html.includes('└'), '하위 줄은 └ 마커');
});

test('세부 줄 자체 상태 태그는 도형에 그대로 반영', () => {
  const parsed = client.clientParseText('[셋업]\n- [A] 업무\n  : 첫 세부 #완료\n  : 두 번째 세부 #진행중');
  const html = client.buildPreviewHTML(parsed);
  assert.ok(html.includes('#1a8a40'), '완료 도형');
  assert.ok(html.includes('#d03030'), '진행중 도형');
});
