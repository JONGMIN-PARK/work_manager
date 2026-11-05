#!/usr/bin/env node
// CSS 죽은 규칙 정리 — 같은 미디어 조건 · 같은 선택자에서 "뒤 규칙이 앞 규칙의 속성을 모두 다시 정하면" 앞 규칙은 어디에도 영향이 없다 → 지움
//   · 같은 속성 이름끼리만 비교 (padding ↔ padding-left 같은 줄임 속성은 건드리지 않음 — 보수적으로)
//   · 앞이 !important 인데 뒤가 아니면 앞이 이기므로 남김
//   · 속성 일부만 덮이면 덮인 선언만 지움 (남은 선언은 그대로)
//   · @keyframes · @font-face 등은 통째로 같을 때만 앞 것을 지움
// 사용: node scripts/css-dead-rules.js style.css [--write]   (--write 없으면 몇 개 지울지 보고만)
'use strict';
var fs = require('fs');
var file = process.argv[2], write = process.argv.indexOf('--write') > 0;
if (!file) { console.error('사용: node scripts/css-dead-rules.js <css> [--write]'); process.exit(1); }
var src = fs.readFileSync(file, 'utf8');

// ── 아주 작은 파서: 주석 · 문자열 · 괄호를 따라 규칙 위치를 잡는다 ──
function skipWsComments(i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith('/*', i)) { var e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    return i;
  }
}
function findBlockEnd(i) { // i = '{' 위치 → 짝 '}' 다음 위치
  var depth = 0;
  for (; i < src.length; i++) {
    var ch = src[i];
    if (ch === '/' && src[i + 1] === '*') { var e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue; }
    if (ch === '"' || ch === "'") { var q = ch; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return src.length;
}
function findPreludeEnd(i) { // '{' 또는 ';' 위치
  for (; i < src.length; i++) {
    var ch = src[i];
    if (ch === '/' && src[i + 1] === '*') { var e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue; }
    if (ch === '"' || ch === "'") { var q = ch; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
    if (ch === '{' || ch === ';' || ch === '}') return i;
  }
  return src.length;
}
var norm = function (s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim(); };
// 선언 나누기 (괄호 · 문자열 안의 ; 는 무시)
function splitDecls(a, b) {
  var out = [], st = a, depth = 0;
  for (var i = a; i <= b; i++) {
    var ch = src[i];
    if (i < b && ch === '/' && src[i + 1] === '*') { var e = src.indexOf('*/', i + 2); i = e + 1; continue; }
    if (i < b && (ch === '"' || ch === "'")) { var q = ch; i++; while (i < b && src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (i === b || (ch === ';' && depth === 0)) {
      var text = src.slice(st, i), t = norm(text);
      if (t) {
        var c = t.indexOf(':');
        if (c > 0) out.push({ s: st, e: i === b ? i : i + 1, prop: t.slice(0, c).trim().toLowerCase(), val: t.slice(c + 1).trim(), imp: /!\s*important\s*$/i.test(t) });
      }
      st = i + 1;
    }
  }
  return out;
}

var rules = [], opaque = [];
function walk(a, b, ctx) {
  var i = a;
  while (i < b) {
    i = skipWsComments(i);
    if (i >= b) break;
    if (src[i] === '}') { i++; continue; }
    var pe = findPreludeEnd(i);
    if (pe >= b || src[pe] === ';') { i = pe + 1; continue; } // @import 등
    var prelude = norm(src.slice(i, pe)), end = findBlockEnd(pe);
    if (prelude[0] === '@') {
      if (/^@(media|supports|layer|container)\b/i.test(prelude)) walk(pe + 1, end - 1, ctx + '|' + prelude);
      else opaque.push({ s: i, e: end, key: ctx + '|' + norm(src.slice(i, end)) });
    } else {
      rules.push({ s: i, e: end, ctx: ctx, sel: prelude, decls: splitDecls(pe + 1, end - 1) });
    }
    i = end;
  }
}
walk(0, src.length, '');

// ── 뒤에서 앞으로: 같은 (ctx, sel) 에 대해 이미 본 뒤 규칙들의 속성 → 앞 규칙 선언 중 덮인 것 표시 ──
var seen = {}; // key → { prop: imp }
var cut = [], deadRules = 0, deadDecls = 0;
for (var r = rules.length - 1; r >= 0; r--) {
  var R = rules[r], key = R.ctx + '§' + R.sel, later = seen[key] || (seen[key] = {});
  var dead = R.decls.filter(function (d) { return d.prop in later && (later[d.prop] || !d.imp); });
  if (R.decls.length && dead.length === R.decls.length) { cut.push([R.s, R.e]); deadRules++; }
  else if (dead.length) {
    // 같은 규칙 안에서 같은 속성을 두 번 쓰는 대체값(-webkit- 등)은 남겨 둠 — 규칙 안 중복 속성이 있으면 건드리지 않음
    var names = R.decls.map(function (d) { return d.prop; });
    var dupInside = names.some(function (n, k) { return names.indexOf(n) !== k; });
    if (!dupInside) dead.forEach(function (d) { cut.push([d.s, d.e]); deadDecls++; });
  }
  R.decls.forEach(function (d) { if (!(d.prop in later)) later[d.prop] = d.imp; else later[d.prop] = later[d.prop] || d.imp; });
}
// 통째로 같은 @keyframes 등
var seenO = {};
for (var o = opaque.length - 1; o >= 0; o--) { if (seenO[opaque[o].key]) { cut.push([opaque[o].s, opaque[o].e]); deadRules++; } seenO[opaque[o].key] = 1; }

cut.sort(function (x, y) { return y[0] - x[0]; });
var out = src;
cut.forEach(function (c) { out = out.slice(0, c[0]) + out.slice(c[1]); });
out = out.replace(/\{\s*;?\s*\}/g, '{}');
console.log('규칙 ' + rules.length + '개 중 통째로 죽은 규칙 ' + deadRules + '개 · 덮인 선언 ' + deadDecls + '개 · ' + src.length + ' → ' + out.length + ' 바이트');
if (write) { fs.writeFileSync(file, out); console.log('썼음: ' + file); }
