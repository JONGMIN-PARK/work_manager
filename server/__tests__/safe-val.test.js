// safe-val — 화면 속성에 그대로 들어가는 색 · id 검사 (v13.281)
const sv = require('../lib/safe-val');

test('safeColor: hex · rgb() · 이름만, 그 밖은 기본값', () => {
  expect(sv.safeColor('#3B82F6', 'x')).toBe('#3B82F6');
  expect(sv.safeColor('rgb(1, 2, 3)', 'x')).toBe('rgb(1, 2, 3)');
  expect(sv.safeColor('red', 'x')).toBe('red');
  expect(sv.safeColor('red" onmouseover="alert(1)', '#000')).toBe('#000');
  expect(sv.safeColor('', null)).toBe(null);
  expect(sv.safeColor(undefined, '#fff')).toBe('#fff');
});

test('safeId: 영문 · 숫자 · _ . : - 만, 아니면 새 id', () => {
  const gen = () => 'new-1';
  expect(sv.safeId('ms-abc_1.2:3', gen)).toBe('ms-abc_1.2:3');
  expect(sv.safeId("x');alert(1);('", gen)).toBe('new-1');
  expect(sv.safeId('', gen)).toBe('new-1');
  expect(sv.safeId(123, gen)).toBe('new-1');
  expect(sv.safeId('a'.repeat(101), gen)).toBe('new-1');
});
