/**
 * ai-mindmap.service — AI 응답 정리(cleanFlat): 잘못된 부모·빈 글자 제거, 고아 제거, 개수 제한
 */
var aiMindmap = require('../services/ai-mindmap.service');

describe('ai-mindmap cleanFlat', function () {
  test('부모 번호를 새 목록 기준으로 다시 매긴다', function () {
    var out = aiMindmap.cleanFlat([
      { text: '설계', parent: -1 },
      { text: '  ', parent: -1 },           // 빈 글자 → 버림
      { text: '기구', parent: 0 },
      { text: '전장', parent: 0, days: 5 }
    ], 10);
    expect(out.map(function (n) { return n.text; })).toEqual(['설계', '기구', '전장']);
    expect(out[1].parent).toBe(0);
    expect(out[2].days).toBe(5);
  });

  test('버려진 부모의 자식도 버리고, 앞에 없는 부모는 버린다', function () {
    var out = aiMindmap.cleanFlat([
      { text: '', parent: -1 },
      { text: '고아', parent: 0 },
      { text: '미래 부모', parent: 5 },
      { text: '정상', parent: -1 }
    ], 10);
    expect(out.map(function (n) { return n.text; })).toEqual(['정상']);
    expect(out[0].parent).toBe(-1);
  });

  test('개수 제한 · 일수 범위', function () {
    var list = [];
    for (var i = 0; i < 20; i++) list.push({ text: 't' + i, parent: -1, days: 9999 });
    var out = aiMindmap.cleanFlat(list, 7);
    expect(out.length).toBe(7);
    expect(out[0].days).toBe(365);
  });
});
