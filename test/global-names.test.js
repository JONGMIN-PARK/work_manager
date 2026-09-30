// 화면 스크립트는 전역 스코프를 같이 쓴다 — 같은 이름의 최상위 function 이 두 파일에 있으면
// 나중에 로드된 쪽이 조용히 덮어쓴다. (v13.196 project-spec.js 의 _psRender 가 사전검토의 _psRender 를
// 덮어써 사전검토 화면이 "로딩 중..." 에서 멈췄다)
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('업무일지_분석기.html 이 로드하는 스크립트끼리 최상위 function 이름이 겹치지 않는다', () => {
  const html = fs.readFileSync(path.join(ROOT, '업무일지_분석기.html'), 'utf8');
  const files = [...html.matchAll(/<script[^>]*\ssrc="([^"?:]+\.js)/g)].map((m) => m[1])
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
  assert.ok(files.length > 20, '스크립트 목록을 읽었다');
  const where = {};
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      (where[m[1]] = where[m[1]] || []).push(f);
    }
  }
  const dups = Object.keys(where).filter((n) => where[n].length > 1).map((n) => n + ': ' + where[n].join(', '));
  assert.deepStrictEqual(dups, [], '겹치는 이름:\n' + dups.join('\n'));
});
