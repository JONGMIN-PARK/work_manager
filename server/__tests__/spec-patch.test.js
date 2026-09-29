/**
 * lib/spec-patch — 사양서 변경분 병합 규칙 (순수 함수)
 */
var sp = require('../lib/spec-patch');

function doc() {
  return { v: 2, templateId: 't', templateVersion: 1, values: { a: '1', axes: [{ id: 'r1', name: 'X1', stroke: '300' }] }, remarks: {}, status: {}, extra: { design: [] } };
}

describe('spec-patch', function () {
  test('from 이 현재 값과 같으면 적용', function () {
    var r = sp.applyChanges(doc(), [{ path: ['values', 'a'], from: '1', to: '2' }]);
    expect(r.doc.values.a).toBe('2');
    expect(r.applied.length).toBe(1);
    expect(r.conflicts).toEqual([]);
  });

  test('이미 같은 값이면 적용·충돌 모두 아님', function () {
    var r = sp.applyChanges(doc(), [{ path: ['values', 'a'], from: '0', to: '1' }]);
    expect(r.applied.length).toBe(0);
    expect(r.conflicts.length).toBe(0);
  });

  test('다르면 충돌 — 현재 값 유지', function () {
    var r = sp.applyChanges(doc(), [{ path: ['values', 'a'], from: '0', to: '5', label: 'A' }]);
    expect(r.doc.values.a).toBe('1');
    expect(r.conflicts).toEqual([{ path: ['values', 'a'], label: 'A', mine: '5', theirs: '1' }]);
  });

  test('빈 문자열·null·없음은 같은 값', function () {
    var r = sp.applyChanges(doc(), [{ path: ['remarks', 'a'], from: '', to: '메모' }, { path: ['values', 'b'], from: null, to: '0' }]);
    expect(r.doc.remarks.a).toBe('메모');
    expect(r.doc.values.b).toBe('0');
    var r2 = sp.applyChanges(r.doc, [{ path: ['remarks', 'a'], from: '메모', to: '' }]);
    expect(r2.doc.remarks.a).toBeUndefined();
  });

  test('표: 칸 수정·행 추가·행 삭제', function () {
    var r = sp.applyChanges(doc(), [
      { path: ['values', 'axes', 'r1', 'stroke'], from: '300', to: '350' },
      { path: ['values', 'axes', 'r2'], from: null, to: { id: 'zzz', name: 'Y1' } },
      { path: ['values', 'newtbl', 'n1'], from: null, to: { name: 'A' } }
    ]);
    expect(r.doc.values.axes).toEqual([{ id: 'r1', name: 'X1', stroke: '350' }, { id: 'r2', name: 'Y1' }]);
    expect(r.doc.values.newtbl).toEqual([{ id: 'n1', name: 'A' }]);
    var r2 = sp.applyChanges(r.doc, [{ path: ['values', 'axes', 'r1'], from: { id: 'r1', name: 'X1', stroke: '350' }, to: null }]);
    expect(r2.doc.values.axes.map(function (x) { return x.id; })).toEqual(['r2']);
  });

  test('표: 다른 사람이 행을 고쳤으면 행 삭제는 충돌', function () {
    var r = sp.applyChanges(doc(), [{ path: ['values', 'axes', 'r1'], from: { id: 'r1', name: 'X1', stroke: '200' }, to: null }]);
    expect(r.conflicts.length).toBe(1);
    expect(r.doc.values.axes.length).toBe(1);
  });

  test('표: 다른 사람이 지운 행의 칸을 고치면 행을 살린다', function () {
    var d = doc(); d.values.axes = [];
    var r = sp.applyChanges(d, [{ path: ['values', 'axes', 'r1', 'stroke'], from: '', to: '400' }]);
    expect(r.doc.values.axes).toEqual([{ id: 'r1', stroke: '400' }]);
  });

  test('문서 전체 교체는 기준이 같을 때만', function () {
    var legacy = { design: [{ id: 'x', item: 'A', value: '1' }] };
    var ok = sp.applyChanges(legacy, [{ path: [], from: legacy, to: { v: 2, values: { a: '1' } } }]);
    expect(ok.doc.v).toBe(2);
    var bad = sp.applyChanges(legacy, [{ path: [], from: {}, to: { v: 2 } }]);
    expect(bad.applied.length).toBe(0);
    expect(bad.conflicts.length).toBe(1);
    var fresh = sp.applyChanges({}, [{ path: [], from: { anything: 1 }, to: { v: 2 } }]);   // 빈 문서는 그대로 전환
    expect(fresh.doc.v).toBe(2);
  });

  test('이전 형식에 부분 변경은 stale, 빈 이전 형식은 v2 로 시작', function () {
    expect(sp.applyChanges({ design: [{ item: 'A' }] }, [{ path: ['values', 'a'], from: '', to: '1' }]).stale).toBe(true);
    var r = sp.applyChanges({ design: [] }, [{ path: ['values', 'a'], from: '', to: '1' }]);
    expect(r.stale).toBe(false);
    expect(r.doc).toMatchObject({ v: 2, values: { a: '1' } });
  });

  test('경로 검사', function () {
    expect(sp.validate([{ path: ['values', 'a'], from: '', to: '1' }])).toBeNull();
    expect(sp.validate([{ path: ['__proto__', 'a'] }])).not.toBeNull();
    expect(sp.validate([{ path: ['values', 'constructor'] }])).not.toBeNull();
    expect(sp.validate([{ path: ['remarks', 'a', 'b'] }])).not.toBeNull();
    expect(sp.validate([{ path: ['values'] }])).not.toBeNull();
    expect(sp.validate([{ path: [] }, { path: ['values', 'a'] }])).not.toBeNull();
    expect(sp.validate([{ path: ['values', 1] }])).not.toBeNull();
    expect(sp.validate('x')).not.toBeNull();
  });
});
