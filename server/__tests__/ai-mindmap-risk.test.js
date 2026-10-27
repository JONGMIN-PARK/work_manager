/**
 * ai-mindmap.service riskReview — 프롬프트에 점검 결과 · 맵 · 오늘 날짜가 들어가고, 응답을 길이 · 개수 제한으로 정리 (v13.243)
 * 실제 AI 호출은 흉내(callJson mock) — 키가 없어 실제 응답은 배포 서버에서 확인.
 */
jest.mock('../services/ai-claude.service', function () {
  return {
    isReady: function () { return true; },
    callJson: jest.fn(function () {
      var risks = [];
      for (var i = 0; i < 10; i++) risks.push({ title: '위험' + i + 'x'.repeat(80), why: '이유', action: '대응' });
      return Promise.resolve({ data: { summary: '요약', risks: risks }, usage: { input_tokens: 1 } });
    })
  };
});
var aiClaude = require('../services/ai-claude.service');
var aiMindmap = require('../services/ai-mindmap.service');

describe('ai-mindmap riskReview', function () {
  test('입력이 프롬프트에 들어가고, 결과는 8개 · 제목 60자로 자른다', async function () {
    var out = await aiMindmap.riskReview({ outline: '# 맵\n- 설계', findings: '- [지연] 설계 — 3일 지남', today: '2026-10-27' });
    var msg = aiClaude.callJson.mock.calls[0][0].messages[0].content;
    expect(msg).toContain('2026-10-27');
    expect(msg).toContain('[지연] 설계');
    expect(msg).toContain('# 맵');
    expect(out.summary).toBe('요약');
    expect(out.risks.length).toBe(8);
    expect(out.risks[0].title.length).toBe(60);
    expect(out.risks[0].action).toBe('대응');
  });
});
