// patch-notes.js (패치노트 데이터) — 형식 · 버전 순서 · 헤더 배지 WM_VERSION 일치
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadPatches() {
  const src = fs.readFileSync(path.join(ROOT, 'patch-notes.js'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx, { filename: 'patch-notes.js' });
  return ctx.WM_PATCHES;
}

// '13.192' → [13, 192] ; '12.1.3' 같은 3단계도 허용
function parseVer(v) { return String(v).split('.').map(Number); }
function cmpVer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

test('WM_PATCHES — 배열이고 비어 있지 않다', () => {
  const P = loadPatches();
  assert.ok(Array.isArray(P), 'WM_PATCHES 는 배열');
  assert.ok(P.length > 0);
});

test('각 항목 형식: ver/date/title/tag/items', () => {
  for (const [i, p] of loadPatches().entries()) {
    const at = `#${i} (v${p && p.ver})`;
    assert.match(String(p.ver), /^\d+(\.\d+)+$/, `${at} ver`);
    assert.match(String(p.date), /^\d{4}-\d{2}-\d{2}(~\d{1,2})?$/, `${at} date (YYYY-MM-DD 또는 YYYY-MM-DD~DD)`);
    assert.strictEqual(typeof p.title, 'string', `${at} title`);
    assert.ok(p.title.length > 0, `${at} title 비어 있음`);
    assert.strictEqual(typeof p.tag, 'string', `${at} tag`);
    assert.ok(Array.isArray(p.items) && p.items.length > 0, `${at} items`);
    for (const it of p.items) assert.strictEqual(typeof it, 'string', `${at} item 은 문자열`);
  }
});

test('버전은 중복 없이 엄격한 내림차순 (최신이 맨 위)', () => {
  const P = loadPatches();
  const seen = new Set();
  for (let i = 0; i < P.length; i++) {
    assert.ok(!seen.has(P[i].ver), `중복 버전 v${P[i].ver}`);
    seen.add(P[i].ver);
    if (i > 0) assert.ok(cmpVer(P[i - 1].ver, P[i].ver) > 0, `v${P[i - 1].ver} 다음에 v${P[i].ver} — 내림차순이 아님`);
  }
});

test('HTML 헤더 배지의 WM_VERSION === WM_PATCHES[0].ver', () => {
  const html = fs.readFileSync(path.join(ROOT, '업무일지_분석기.html'), 'utf8');
  const m = html.match(/var WM_VERSION='([^']+)'/g) || [];
  assert.strictEqual(m.length, 1, 'WM_VERSION 은 HTML 에 한 번만 정의');
  const ver = m[0].match(/'([^']+)'/)[1];
  assert.strictEqual(ver, loadPatches()[0].ver, '배지 버전과 최신 패치노트 버전이 다름 — 둘 다 올리세요');
  // 배지는 WM_VERSION 으로 채워진다 (하드코딩된 vNN.NNN 텍스트가 남아 있지 않아야 함)
  assert.match(html, /<span[^>]*id="wmVerBadge"[^>]*><\/span><script>var WM_VERSION=/);
  assert.ok(!/title="패치노트 보기"[^>]*>v\d/.test(html), '배지에 버전 텍스트 하드코딩 금지');
});
