// v13.432 기본 confirm() · prompt() 금지 — 윈도우 기본 모양 창 대신 테마를 따르는 wmConfirm · wmPrompt (wm-dialog.js)
// 실행: node --test test/no-native-dialog.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('화면 코드에 기본 confirm( · prompt( 가 없다', () => {
  const bad = [];
  fs.readdirSync(ROOT).filter((f) => /\.js$/.test(f) && f !== 'wm-dialog.js').forEach((f) => {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
    lines.forEach((ln, i) => {
      const code = ln.replace(/\/\/.*$/, '').replace(/function\s+(confirm|prompt)\s*\(/g, '');
      // 앞이 . · 글자 · 숫자 · _ · $ 가 아닌 confirm( / prompt( / window.confirm(
      if (/(^|[^.\w$])(window\.)?(confirm|prompt)\s*\(/.test(code) && !/typeof (confirm|prompt)/.test(code.replace(/(^|[^.\w$])(window\.)?(confirm|prompt)\s*\(/, '')) ) {
        bad.push(f + ':' + (i + 1) + '  ' + ln.trim().slice(0, 100));
      }
    });
  });
  assert.deepStrictEqual(bad, [], '기본 창 대신 await wmConfirm(…) / await wmPrompt(…) 를 쓰세요:\n' + bad.join('\n'));
});

test('wm-dialog.js 가 다른 스크립트보다 먼저 실린다', () => {
  const html = fs.readFileSync(path.join(ROOT, '업무일지_분석기.html'), 'utf8');
  const a = html.indexOf('<script src="wm-dialog.js'), b = html.indexOf('<script src="core-bus.js');
  assert.ok(a > 0 && a < b, 'wm-dialog.js 를 core-bus.js 앞에');
});
