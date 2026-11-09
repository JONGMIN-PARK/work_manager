// 메신저 내 말풍선 — 모든 테마에서 글자 대비 4.5 이상 (v13.393)
// 말풍선 색은 --cx-mine-a → --cx-mine-b 기울기, 글자는 --cx-mine-t. 테마가 값을 안 주면 :root 값, initial 이면 강조색 그대로(+보라 섞기 · 흰 글자)
// 새 테마를 넣었는데 이 테스트가 실패하면 style.css 의 'v13.393 내 말풍선' 칸에 그 테마의 --cx-mine-* 를 넣는다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const hx = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, t) => a.map((v, i) => Math.round(v * t + b[i] * (1 - t)));

function themeVars(re) {
  const out = {};
  let m;
  while ((m = re.exec(css))) { const n = m[2] || 'ROOT'; if (!(n in out)) out[n] = m[3]; }
  return out;
}

test('내 말풍선 글자 대비 — 모든 테마 4.5 이상', () => {
  const ac = themeVars(/(:root|\[data-theme="([\w-]+)"\])\{[^}]*?--ac:(#[0-9A-Fa-f]{6})/g);
  const tok = {};
  let m;
  const re = /(:root|\[data-theme="([\w-]+)"\])\{--cx-mine-a:(#[0-9A-Fa-f]{6});--cx-mine-b:(#[0-9A-Fa-f]{6});--cx-mine-t:(#[0-9A-Fa-f]{6})\}/g;
  while ((m = re.exec(css))) tok[m[2] || 'ROOT'] = { a: m[3], b: m[4], t: m[5] };
  const cleared = new Set();
  const cm = /((?:\[data-theme="[\w-]+"\],?)+)\{--cx-mine-a:initial/.exec(css);
  if (cm) cm[1].replace(/\[data-theme="([\w-]+)"\]/g, (_, n) => cleared.add(n));
  assert.ok(tok.ROOT, ':root 의 --cx-mine-* 가 없음');
  const bad = [];
  Object.keys(ac).forEach((n) => {
    let a, b, t;
    if (cleared.has(n)) { a = hx(ac[n]); b = mix(a, hx('#7C3AED'), 0.62); t = [255, 255, 255]; }
    else { const k = tok[n] || tok.ROOT; a = hx(k.a); b = hx(k.b); t = hx(k.t); }
    const r = Math.min(ratio(a, t), ratio(b, t));
    if (r < 4.5) bad.push(n + ' ' + r.toFixed(2));
  });
  assert.deepStrictEqual(bad, [], '대비 4.5 미만 테마: ' + bad.join(', '));
  assert.ok(Object.keys(ac).length >= 20, '테마를 다 못 읽음: ' + Object.keys(ac).length);
});
