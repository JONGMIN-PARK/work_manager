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
  // 공용 파서(전역 WeeklyReportParse)를 먼저 — 브라우저의 defer 순서와 같게
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'weekly-report-parse.js'), 'utf8'), sandbox, { filename: 'weekly-report-parse.js' });
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

test('세부 줄: 도형 없이 들여쓰기만 해도 인식 · 들여쓰기 없는 줄도 버리지 않음 (v13.353)', () => {
  const indented = '[셋업]\n- [A] 업무\n  들여쓴 세부';
  assert.strictEqual(clientItems(client.clientParseText(indented))[0].details.length, 1);
  assert.strictEqual(server.parseText(indented).items[0].details.length, 1);

  // 예전엔 버려졌다 → 세부 한 줄
  const flush = '[셋업]\n- [A] 업무\n들여쓰지 않은 메모';
  assert.strictEqual(clientItems(client.clientParseText(flush))[0].details.length, 1);
  assert.strictEqual(server.parseText(flush).items[0].details[0].text, '들여쓰지 않은 메모');

  // 앞 줄이 쉼표 · 및 등으로 끝나면 이어 붙임 (복사하다 줄이 넘어간 경우)
  const wrap = '[셋업]\n- [A] 셋업 2건,\n검사 장비 점검 #진행\n  : 세부 하나 및\n두 번째 부분';
  const w = server.parseText(wrap).items[0];
  assert.strictEqual(w.name, '셋업 2건, 검사 장비 점검');
  assert.strictEqual(w.status, 'in_progress');
  assert.strictEqual(w.details.length, 1);
  assert.strictEqual(w.details[0].text, '세부 하나 및 두 번째 부분');

  // 빈 줄 다음은 이어 붙이지 않음
  const gap = '[셋업]\n- [A] 셋업,\n\n따로 쓴 줄';
  assert.strictEqual(server.parseText(gap).items[0].name, '셋업,');
});

test('v13.353 항목 꼬리 정보: 이름 속 % 는 이름에 · 기한 여러 꼴 · 붙여 쓴 담당 · 전각 괄호 · 번호 세부', () => {
  const p = server.parseText('[개발]\n- [A] 불량률 30% 개선 ~12/4 60% @김민수,@박종민\n'
    + '【B】 전각 괄호 ~ 1/9(금) #%30 @이수진/최영호\n  1. 첫째\n  2) 둘째 #완료\n  ③ 셋째\n- [C] 기한 ~12-05 점');
  const [a, b, c] = p.items;
  assert.deepStrictEqual([a.name, a.deadline, a.pct], ['불량률 30% 개선', '~12/04', 60]);
  assert.deepStrictEqual(plain(a.members), ['김민수', '박종민']);
  assert.deepStrictEqual([b.client, b.name, b.deadline, b.pct], ['B', '전각 괄호', '~01/09', 30]);
  assert.deepStrictEqual(plain(b.members), ['이수진', '최영호']);
  assert.deepStrictEqual(plain(b.details.map((d) => d.text)), ['첫째', '둘째 #완료', '셋째']);
  assert.deepStrictEqual([c.name, c.deadline], ['기한 점', '~12/05']);
});

test('v13.353 상태: 낱말 완료는 띄어 쓴 낱말만 · 예정 줄은 아님 · #예정 · 세부 일부만 완료면 진행', () => {
  const st = (t) => server.detectStatus(t);
  assert.strictEqual(st('셋업 완료'), 'done');
  assert.strictEqual(st('미완료 건 정리'), 'none');
  assert.strictEqual(st('완료율 점검'), 'none');
  assert.strictEqual(st('완료 보고 예정'), 'none');
  assert.strictEqual(st('검토 #예정'), 'none');
  assert.strictEqual(st('검토 #진행'), 'in_progress');
  const it = server.parseText('[개발]\n- [A] 업무\n  : 하나 #완료\n  : 둘').items[0];
  assert.strictEqual(it.status, 'in_progress');   // 예전엔 done → 태그 없는 '둘' 까지 완료로 보였다
  assert.strictEqual(it.ownStatus, 'none');
  const allDone = server.parseText('[개발]\n- [A] 업무\n  : 하나 #완료\n  : 둘 #완료').items[0];
  assert.strictEqual(allDone.status, 'done');
  // 섹션 머리 없이 쓴 항목은 기타로
  assert.deepStrictEqual(plain(server.parseText('- [X] 섹션 없이\n[개발]\n- [Y] 있음').sections.map((s) => s.type)), ['etc', 'dev']);
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
  // 완료 항목이 하나 섞여 있어야 도형을 그림 (v13.349 — 칸 전체가 예정뿐이면 도형을 뺌)
  const parsed = client.clientParseText('[셋업]\n- [A] 업무 ~09/15\n  : 첫 세부\n  : 두 번째 세부\n  └ 하위 줄\n- [B] 끝난 일 #완료');
  const html = client.buildPreviewHTML(parsed);
  const planned = (html.match(/wrp-st-planned/g) || []).length;
  assert.strictEqual(planned, 2, '무태그 세부 2줄 모두 예정(○) 도형');
  assert.ok(html.includes('└'), '하위 줄은 └ 마커');
});

test('미리보기: 칸 전체가 예정뿐이면 세부 줄 앞 표시 없음 · 하위 줄만 └', () => {
  const parsed = client.clientParseText('[셋업]\n- [A] 업무 ~09/15\n  : 첫 세부\n  : 두 번째 세부\n  └ 하위 줄');
  const html = client.buildPreviewHTML(parsed);
  assert.strictEqual((html.match(/class="wrp-dic"/g) || []).length, 1, '└ 하위 줄 하나만 표시 칸');
  assert.match(html, /<div class="wrp-dl"><span class="wrp-dt" title="첫 세부">/);
  assert.ok(!/wrp-st-planned/.test(html));
  assert.ok(html.includes('└'));
});

test('세부 줄 자체 상태 태그는 도형에 그대로 반영', () => {
  const parsed = client.clientParseText('[셋업]\n- [A] 업무\n  : 첫 세부 #완료\n  : 두 번째 세부 #진행중');
  const html = client.buildPreviewHTML(parsed);
  assert.ok(html.includes('#16A34A'), '완료 도형');
  assert.ok(html.includes('#2563EB'), '진행중 도형');
});
