// notebook-md.js · notebook-ink.js — 📓 노트북 마크다운 · 손글씨 (v13.316)
var test = require('node:test');
var assert = require('node:assert');
var M = require('../notebook-md.js');
var K = require('../notebook-ink.js');
function H(s) { return M.render(s).html; }

test('원문 HTML 은 절대 그대로 나가지 않음 (escape 먼저)', function () {
  var h = H('<img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1)) ![a](data:text/html,1)');
  assert.ok(h.indexOf('<img src=x') < 0 && h.indexOf('<script>') < 0);
  assert.ok(h.indexOf('href="javascript') < 0 && h.indexOf('src="data:') < 0);
  assert.ok(h.indexOf('&lt;script&gt;') >= 0);
  // 주소 안 따옴표로 속성을 빠져나가지 못함
  var h2 = H('![a](https://x" onerror="alert(1))');
  assert.ok(!/<img[^>]*onerror/.test(h2) && !/<a[^>]*onerror/.test(h2));
});

test('줄 안 꾸밈 · 주소 속 _ * 는 건드리지 않음', function () {
  var h = H('**굵게** *기울임* ~~취소~~ ==형광== `a*b*` [링크](https://a.com/x_y_z) https://b.com/a_b_c');
  assert.ok(h.indexOf('<strong>굵게</strong>') >= 0 && h.indexOf('<em>기울임</em>') >= 0 && h.indexOf('<del>취소</del>') >= 0 && h.indexOf('<mark>형광</mark>') >= 0);
  assert.ok(h.indexOf('<code>a*b*</code>') >= 0);
  assert.ok(h.indexOf('href="https://a.com/x_y_z"') >= 0 && h.indexOf('href="https://b.com/a_b_c"') >= 0);
  assert.ok(H('snake_case_name').indexOf('<em>') < 0);
});

test('제목 · 목차 · 같은 제목은 id 가 겹치지 않음', function () {
  var r = M.render('# 개요\n## 일정\n## 일정\n');
  assert.deepStrictEqual(r.toc.map(function (t) { return t.level + ':' + t.text; }), ['1:개요', '2:일정', '2:일정']);
  assert.notStrictEqual(r.toc[1].id, r.toc[2].id);
  assert.strictEqual(r.toc[2].line, 2);
});

test('목록 중첩 · 번호 시작 · 체크 · 줄 번호(data-line)', function () {
  var h = H('- 하나\n  - 둘\n- [x] 끝\n\n3. 셋\n4. 넷');
  assert.ok(/<ul><li data-line="0">하나<ul><li data-line="1">둘<\/li><\/ul><\/li>/.test(h), '섞인 목록은 글머리 유지');
  assert.ok(H('- [ ] a\n- [x] b').indexOf('<ul class="nb-tasks">') === 0, '모두 체크면 체크 목록');
  assert.ok(h.indexOf('class="nb-task done" data-line="2"') >= 0);
  assert.ok(h.indexOf('<ol start="3">') >= 0);
});

test('체크 토글은 그 줄만', function () {
  var s = '- [ ] a\n  - [x] b\n- c';
  assert.strictEqual(M.toggleTask(s, 0), '- [x] a\n  - [x] b\n- c');
  assert.strictEqual(M.toggleTask(s, 1), '- [ ] a\n  - [ ] b\n- c');
  assert.strictEqual(M.toggleTask(s, 2), s, '체크 줄이 아니면 그대로');
});

test('표(정렬) · 코드 블록 · 알림 상자 · 인용 · 구분선 · 손글씨 · 첨부 · 일일 노트 할 일', function () {
  var h = H('| a | b |\n|:--|--:|\n| 1 | 2 |');
  assert.ok(h.indexOf('<th style="text-align:left">a</th>') >= 0 && h.indexOf('<td style="text-align:right">2</td>') >= 0);
  var c = H('```js\nvar x = <1>;\n```');
  assert.ok(c.indexOf('nb-code-lang">js<') >= 0 && c.indexOf('var x = &lt;1&gt;;') >= 0);
  assert.ok(H('> [!WARNING] 조심\n> 내용').indexOf('nb-callout nb-co-warning') >= 0);
  assert.ok(H('> 인용').indexOf('<blockquote') >= 0);
  assert.ok(H('a\n\n---\n').indexOf('<hr') >= 0);
  assert.ok(H('::ink[k1]').indexOf('data-ink="k1"') >= 0);
  assert.ok(H('![사진](nbf:nf-1)').indexOf('data-nbf="nf-1"') >= 0);
  assert.ok(H('[📎 a.pdf](nbf:nf-2)').indexOf('class="nb-file" data-nbf="nf-2"') >= 0);
  assert.ok(H('- [x] 견적 ⟦todo-9⟧').indexOf('data-todo="todo-9"') >= 0);
});

test('✍️ 손글씨 — SVG · 형광펜은 아래 · 이상한 색은 막음 · 도형 보정', function () {
  var s = K.svg({ h: 200, s: [{ t: 'pen', c: '#000', w: 4, p: [0, 0, 50, 50, 50, 80] }, { t: 'hl', c: 'red;x:1', w: 18, p: [0, 0, 50, 90, 0, 50] }] });
  assert.ok(s.indexOf('viewBox="0 0 1000 200"') >= 0);
  assert.ok(s.indexOf('nbk-hl') < s.indexOf('nbk-pen'), '형광펜을 먼저 깔고 그 위에 펜');
  assert.ok(s.indexOf('red;x') < 0);
  var line = { t: 'pen', c: '#000', w: 4, p: [] };
  for (var i = 0; i < 20; i++) line.p.push(i * 10, i * 5 + (i % 2), 50);
  assert.strictEqual(K.snapShape(line).p.length, 6, '거의 곧은 선 → 직선 (두 점)');
  var c = { t: 'pen', c: '#000', w: 4, p: [] };
  for (var k = 0; k <= 40; k++) { var t = k / 40 * Math.PI * 2; c.p.push(300 + 100 * Math.cos(t), 200 + 60 * Math.sin(t), 50); }
  assert.ok(K.snapShape(c).p.length > 100, '원 → 반듯한 타원');
  assert.strictEqual(K.snapShape({ t: 'pen', c: '#000', w: 4, p: [0, 0, 50, 5, 30, 50, 9, 2, 50, 20, 40, 50, 33, 1, 50] }), null, '꼬불꼬불은 그대로');
  assert.ok(K.hitStroke({ w: 4, p: [0, 0, 50, 100, 0, 50] }, 50, 3, 2), '선분 중간도 지우개에 걸림');
});
