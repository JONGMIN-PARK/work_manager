// notebook-coach.js — ✍️ 글쓰기 코치 규칙 (v13.318) · notebook-md.js [[노트]] · 업무 칩 (v13.317)
var test = require('node:test');
var assert = require('node:assert');
var C = require('../notebook-coach.js');
var M = require('../notebook-md.js');
function ks(r) { return r.findings.map(function (f) { return f.k; }); }

test('군더더기 · 번역투 · 모호 · 겹말 · 맞춤법을 찾고 원문 위치가 맞음', function () {
  var t = '센서 교체를 진행하도록 하겠습니다.\n작업자에 의해 교체되어지는 부분입니다.\n조만간 다시 재검토하고 몇일 뒤 확인 필요';
  var r = C.check(t);
  ['filler', 'passive', 'vague', 'double', 'spell'].forEach(function (k) { assert.ok(ks(r).indexOf(k) >= 0, k); });
  r.findings.forEach(function (f) { if (f.start >= 0) assert.strictEqual(t.slice(f.start, f.start + f.quote.length), f.quote, f.k + ' 위치'); });
  var sp = r.findings.filter(function (f) { return f.k === 'spell'; })[0];
  assert.strictEqual(sp.ex, '며칠');
  assert.ok(sp.why && sp.hint, '이유 · 힌트');
});

test('같은 자리 같은 종류는 한 번만 · 코드 블록 · 주소 · 손글씨 줄은 건너뜀', function () {
  var r = C.check('검토를 진행하도록 하겠습니다');
  assert.strictEqual(r.findings.filter(function (f) { return f.k === 'filler'; }).length, 1);
  var r2 = C.check('```\n되어지다 몇일 조만간\n```\nhttps://a.com/되어지다\n::ink[k1]');
  assert.strictEqual(r2.findings.length, 0);
});

test('긴 문장 · 같은 말 되풀이 · 숫자 없는 진척', function () {
  var long = '이번 작업은 작업자가 교체하는 작업으로 작업 일정은 작업팀이 정하며 고객사와 협의하여 최종 결정되는 사항이고 납기 일정은 아직 정해지지 않은 상태로 남아 있습니다.';
  var r = C.check(long + '\n- 컨베이어 설치 진행 중\n- 배선 진행 중 70%\n- 도장 작업 중 ~11/15');
  assert.ok(ks(r).indexOf('long') >= 0 && ks(r).indexOf('repeat') >= 0);
  assert.strictEqual(r.findings.filter(function (f) { return f.k === 'number'; }).length, 1, '숫자 · 날짜가 있는 줄은 빼고 한 줄만');
});

test('글 종류 — 제목 · 태그로 알아냄 · 빠진 칸 · 결론이 뒤에', function () {
  assert.strictEqual(C.detectKind({ title: '주간 회의록' }), 'meeting');
  assert.strictEqual(C.detectKind({ title: 'x', tags: ['출장'] }), 'trip');
  assert.strictEqual(C.detectKind({ kind: 'mail', title: '회의' }), 'mail');
  var r = C.check('## 일시\n11/3\n## 참석\n김, 이\n## 논의\n소음 원인', { title: '회의록' });
  assert.deepStrictEqual(r.outline.filter(function (o) { return !o.ok; }).map(function (o) { return o.label; }), ['결정 사항', '할 일 · 담당 · 기한']);
  assert.strictEqual(ks(r).filter(function (k) { return k === 'missing'; }).length, 2);
  var body = new Array(15).join('현장에서 모터 소음을 측정했고 수치를 기록했습니다.\n') + '결론: 베어링 교체가 필요합니다.';
  var r2 = C.check(body, { kind: 'review' });
  var hd = r2.findings.filter(function (f) { return f.k === 'head'; })[0];
  assert.ok(hd && /15번째 줄/.test(hd.msg), '결론이 몇째 줄에 있는지');
  assert.ok(!C.check('결론: 베어링 교체\n' + body, { kind: 'review' }).findings.some(function (f) { return f.k === 'head'; }), '앞에 있으면 없음');
});

test('주간 보고 — 진척률 · 마감 없는 항목', function () {
  var r = C.check('[개발]\n- [A사] 컨베이어 설치\n- [B사] 배선 50%\n- [C사] 도장 ~11/15\n- [D사] 시운전 #완료', { kind: 'weekly' });
  var nums = r.findings.filter(function (f) { return f.k === 'number'; });
  assert.strictEqual(nums.length, 1);
  assert.ok(nums[0].quote.indexOf('A사') >= 0);
});

test('점수 — 글이 길어도 손해 보지 않음 (1000자당) · 0~100 · 연습 과제', function () {
  var s1 = C.score({ filler: 2 }, 500, null), s2 = C.score({ filler: 8 }, 2000, null);
  assert.strictEqual(s1.concise, s2.concise);
  var s3 = C.score({ long: 50, filler: 50, spell: 50, number: 50 }, 500, null);
  assert.ok(s3.clarity >= 20 && s3.total >= 20);
  assert.strictEqual(C.score({}, 800, [{ ok: true }, { ok: false }]).structure, 50);
  assert.ok(/결론/.test(C.taskFor('head')) && C.taskFor('없음'));
});

test('[[노트]] · 업무 칩 — 안전한 것만', function () {
  var h = M.render('[[센서 사양]] [[A|에이]] [🐞 소음](wm:issue:iss-1) [x](wm:bad:1) [y](wm:project:<b>)').html;
  assert.ok(h.indexOf('class="nb-wl" data-wl="센서 사양"') >= 0 && h.indexOf('>에이</a>') >= 0);
  assert.ok(h.indexOf('class="nb-ref" data-ref="issue:iss-1"') >= 0);
  assert.ok(h.indexOf('wm:bad') >= 0 && h.indexOf('data-ref="bad') < 0, '모르는 종류는 링크로 안 바꿈');
  assert.ok(h.indexOf('<b>') < 0);
  var x = M.render('[[<img src=x onerror=1>]]').html;
  assert.ok(x.indexOf('<img') < 0);
});
