// 노트 출력(notebook-print.js)과 회의록 문서(server/lib/meeting-minutes.js)의 모양 값이 어긋나지 않게 (v13.320)
var test = require('node:test');
var assert = require('node:assert');
var P = require('../notebook-print.js');
var M = require('../server/lib/meeting-minutes.js');

test('강조색 · 모양 이름 · 선 색이 같음', function () {
  assert.deepStrictEqual(P.ACCENTS, M.ACCENTS);
  assert.deepStrictEqual(Object.keys(P.THEMES).sort(), Object.keys(M.THEMES).sort());
  Object.keys(P.THEMES).forEach(function (k) {
    ['line', 'head', 'headInk', 'ink', 'sub'].forEach(function (f) { assert.strictEqual(P.THEMES[k][f], M.THEMES[k][f], k + '.' + f); });
    assert.strictEqual(P.THEMES[k].accent || null, M.THEMES[k].accent || null, k + '.accent');
  });
});
