/**
 * AI 라우트 — 웹 프론트엔드 AI 요약/분석
 */
var express = require('express');
var router = express.Router();
var config = require('../config');
var aiService = require('../services/ai.service');
var { authenticate } = require('../middleware/auth');

router.use(authenticate);

/**
 * POST /api/ai/summary
 * 프론트엔드에서 프롬프트를 보내면 서버의 AI 키로 처리
 */
router.post('/summary', async function (req, res) {
  try {
    if (!aiService.isConfigured()) {
      return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI API 키가 설정되지 않았습니다. 관리자에게 GEMINI_API_KEY 설정을 요청하세요.' });
    }

    var prompt = req.body.prompt || '';
    if (!prompt) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: '프롬프트가 필요합니다.' });
    }

    // 길이 제한 (토큰 절약)
    if (prompt.length > 8000) {
      prompt = prompt.slice(0, 8000) + '\n...(이하 생략)';
    }

    var provider = config.ai.provider === 'anthropic' ? 'Claude' : 'Gemini';

    // AI 호출 (ai.service.js의 callAI 재사용)
    var answer = await callAIWithPrompt(prompt);

    if (!answer) {
      return res.status(500).json({ error: 'AI_ERROR', message: 'AI 응답을 생성할 수 없습니다.' });
    }

    res.json({ data: { text: answer, provider: provider } });
  } catch (err) {
    console.error('[AI Route] summary error:', err.message);
    res.status(500).json({ error: 'AI_ERROR', message: 'AI 요약 실패: ' + err.message });
  }
});

/**
 * GET /api/ai/status
 * AI 설정 상태 확인
 */
router.get('/status', function (req, res) {
  var provider = config.ai.provider || 'gemini';
  var configured = aiService.isConfigured();
  res.json({
    data: {
      configured: configured,
      provider: configured ? (provider === 'anthropic' ? 'Claude' : 'Gemini') : null
    }
  });
});

/** AI 호출 (Gemini / Claude) */
async function callAIWithPrompt(prompt) {
  if (config.ai.provider === 'anthropic' && config.ai.anthropicKey) {
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.ai.anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: config.ai.anthropicModel,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    var data = await res.json();
    if (data.content && data.content[0]) return data.content[0].text;
    if (data.error) throw new Error(data.error.message);
    return null;
  }

  // Gemini (기본)
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + config.ai.geminiModel + ':generateContent?key=' + config.ai.geminiKey;
  var res2 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.3 }
    })
  });
  var data2 = await res2.json();
  if (data2.candidates && data2.candidates[0] && data2.candidates[0].content) {
    return data2.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('\n');
  }
  if (data2.error) throw new Error(data2.error.message);
  return null;
}

module.exports = router;
