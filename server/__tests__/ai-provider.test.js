/**
 * ai-provider — AI 고르기 · Gemini 재시도/예비 모델 · 빈 답 · 테넌트 키 (v13.296)
 * 마인드맵 · A/S AI 가 Claude 키만 보고 꺼져 있던 문제의 회귀 테스트 포함
 */
jest.mock('../config/db', function () { return { query: jest.fn() }; });
var db = require('../config/db');
var config = require('../config');
var aiProvider = require('../services/ai-provider');
var aiClaude = require('../services/ai-claude.service');

var saved;
beforeEach(function () {
  saved = Object.assign({}, config.ai);
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [] });
  aiProvider.clearTenantCache();
  global.fetch = jest.fn();
  jest.spyOn(console, 'warn').mockImplementation(function () {});
});
afterEach(function () {
  Object.assign(config.ai, saved);
  console.warn.mockRestore();
});

function geminiOk(text) {
  return { status: 200, ok: true, json: async function () { return { candidates: [{ content: { parts: [{ text: text }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } }; } };
}
function geminiErr(code, msg) {
  return { status: code, ok: false, json: async function () { return { error: { code: code, message: msg } }; } };
}

describe('resolve — 어떤 AI 를 쓸지', function () {
  test('AI_PROVIDER=anthropic(기본)이어도 Gemini 키만 있으면 Gemini', function () {
    Object.assign(config.ai, { provider: 'anthropic', anthropicKey: '', geminiKey: 'g', geminiModel: 'gemini-2.5-pro' });
    var r = aiProvider.resolveEnv();
    expect(r.provider).toBe('gemini');
    expect(r.model).toBe('gemini-2.5-pro');
    expect(aiClaude.isReady()).toBe(true);
  });
  test('둘 다 있으면 AI_PROVIDER 를 따름', function () {
    Object.assign(config.ai, { provider: 'gemini', anthropicKey: 'a', geminiKey: 'g' });
    expect(aiProvider.resolveEnv().provider).toBe('gemini');
    config.ai.provider = 'anthropic';
    expect(aiProvider.resolveEnv().provider).toBe('anthropic');
  });
  test('키가 하나도 없으면 null', function () {
    Object.assign(config.ai, { anthropicKey: '', geminiKey: '' });
    expect(aiProvider.resolveEnv()).toBeNull();
    expect(aiClaude.isReady()).toBe(false);
  });
  test('테넌트 전용 키가 있으면 그것을 먼저', async function () {
    Object.assign(config.ai, { anthropicKey: '', geminiKey: '' });
    db.query.mockResolvedValue({ rows: [{ provider: 'gemini', api_key: 'tk', model: 'gemini-2.5-pro' }] });
    var r = await aiProvider.resolve('t1');
    expect(r).toMatchObject({ provider: 'gemini', key: 'tk', model: 'gemini-2.5-pro', source: 'tenant' });
    expect(await aiClaude.isReadyFor('t1')).toBe(true);
  });
});

describe('geminiGenerate', function () {
  test('붐비면(503) 다시 시도해서 성공 · 키는 헤더로', async function () {
    fetch.mockResolvedValueOnce(geminiErr(503, 'The model is overloaded')).mockResolvedValueOnce(geminiOk('안녕'));
    var g = await aiProvider.geminiGenerate({ key: 'k', model: 'gemini-2.5-flash', prompt: 'p' });
    expect(g.text).toBe('안녕');
    expect(fetch).toHaveBeenCalledTimes(2);
    var call = fetch.mock.calls[0];
    expect(call[0]).not.toMatch(/key=/);
    expect(call[1].headers['x-goog-api-key']).toBe('k');
    expect(JSON.parse(call[1].body).generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(32768);
  }, 15000);

  test('없는 모델(404)이면 예비 모델로', async function () {
    fetch.mockResolvedValueOnce(geminiErr(404, 'models/gemini-x is not found')).mockResolvedValueOnce(geminiOk('ok'));
    var g = await aiProvider.geminiGenerate({ key: 'k', model: 'gemini-x', prompt: 'p' });
    expect(g.fellBack).toBe(true);
    expect(g.model).toBe('gemini-2.5-flash');
  });

  test('잘못된 키는 바로 알려 줌 (재시도 안 함)', async function () {
    fetch.mockResolvedValueOnce(geminiErr(400, 'API key not valid. Please pass a valid API key.'));
    await expect(aiProvider.geminiGenerate({ key: 'k', model: 'gemini-2.5-flash', prompt: 'p' })).rejects.toMatchObject({ code: 'AI_KEY_INVALID' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('Gemini 3 는 temperature 를 넣지 않음', async function () {
    fetch.mockResolvedValueOnce(geminiOk('ok'));
    await aiProvider.geminiGenerate({ key: 'k', model: 'gemini-3-pro-preview', prompt: 'p' });
    expect(JSON.parse(fetch.mock.calls[0][1].body).generationConfig.temperature).toBeUndefined();
  });
});

describe('마인드맵 · A/S 구조화 응답 (callJson) — Gemini 키만 있을 때', function () {
  test('```json 울타리 답도 읽고, 쓴 AI 를 usage 에 남김', async function () {
    Object.assign(config.ai, { provider: 'anthropic', anthropicKey: '', geminiKey: 'g', geminiModel: 'gemini-2.5-flash' });
    fetch.mockResolvedValueOnce(geminiOk('```json\n{"nodes":[{"text":"설계","parent":-1}]}\n```'));
    var r = await aiClaude.callJson({ system: 's', messages: [{ role: 'user', content: 'u' }], schema: { type: 'object' } });
    expect(r.data.nodes[0].text).toBe('설계');
    expect(r.usage.provider).toBe('gemini');
    var body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.systemInstruction.parts[0].text).toBe('s');
  });

  test('키가 없으면 AI_NOT_READY', async function () {
    Object.assign(config.ai, { anthropicKey: '', geminiKey: '' });
    await expect(aiClaude.callJson({ messages: [], schema: {} })).rejects.toMatchObject({ code: 'AI_NOT_READY' });
  });
});

describe('generateText — 업무 관리 · 텔레그램', function () {
  test('Gemini 키만 있으면 Gemini 로 답', async function () {
    Object.assign(config.ai, { provider: 'anthropic', anthropicKey: '', geminiKey: 'g' });
    fetch.mockResolvedValueOnce(geminiOk('요약'));
    var out = await aiProvider.generateText({ prompt: 'p' });
    expect(out).toMatchObject({ text: '요약', provider: 'gemini', note: '' });
  });
  test('Claude 크레딧 부족이면 Gemini 로 넘기고 안내', async function () {
    Object.assign(config.ai, { provider: 'anthropic', anthropicKey: 'a', geminiKey: 'g' });
    fetch.mockResolvedValueOnce({ status: 400, ok: false, json: async function () { return { error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }; } })
      .mockResolvedValueOnce(geminiOk('대신 답'));
    var out = await aiProvider.generateText({ prompt: 'p' });
    expect(out.provider).toBe('gemini');
    expect(out.note).toMatch(/크레딧/);
  });
  test('키가 없으면 null', async function () {
    Object.assign(config.ai, { anthropicKey: '', geminiKey: '' });
    expect(await aiProvider.generateText({ prompt: 'p' })).toBeNull();
  });
});
