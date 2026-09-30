// 스크롤해도 고정되는(position:sticky) 영역이 반투명 배경 변수(--th/--bg-p/--bg-i/--bg-hv)를 그대로 쓰면
// 글래스 테마에서 밑으로 지나가는 행·글자가 비쳐 제목과 겹쳐 보인다(v13.209·v13.212).
// sticky 영역은 불투명 변수 var(--th-s, var(--th)) · var(--bg-ps, …) · var(--bg-is, …) · var(--bg-hvs, …) 를 써야 한다.
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// 반투명일 수 있는 배경 변수를 "첫 값"으로 바로 쓰는 경우 — var(--th-s,var(--th)) 처럼 폴백 안에 있는 건 괜찮다
const BAD = /background(?:-color)?\s*:\s*var\(--(th|bg-p|bg-i|bg-hv)\s*[,)]/;

function stickyChunks(src) {
  // CSS 규칙 본문 {...} 과 인라인 style="..."/'...' 문자열 중 position:sticky 를 포함하는 조각
  const out = [];
  const re = /\{[^{}]*\}|style=\\?["'][^"']*["']|'[^'\n]*position\s*:\s*sticky[^'\n]*'/g;
  let m;
  while ((m = re.exec(src))) if (/position\s*:\s*sticky/.test(m[0])) out.push(m[0]);
  return out;
}

test('sticky 영역은 반투명 배경 변수를 직접 쓰지 않는다 (불투명 --th-s/--bg-ps/--bg-is/--bg-hvs 사용)', () => {
  const html = fs.readFileSync(path.join(ROOT, '업무일지_분석기.html'), 'utf8');
  const files = ['style.css', '업무일지_분석기.html'].concat(
    [...html.matchAll(/<script[^>]*\ssrc="([^"?:]+\.js)/g)].map((m) => m[1]).filter((f) => fs.existsSync(path.join(ROOT, f)))
  );
  const bad = [];
  for (const f of files) {
    for (const c of stickyChunks(fs.readFileSync(path.join(ROOT, f), 'utf8'))) {
      if (BAD.test(c)) bad.push(f + ': ' + c.slice(0, 160));
    }
  }
  assert.deepStrictEqual(bad, [], '반투명 배경을 쓰는 sticky:\n' + bad.join('\n'));
});
