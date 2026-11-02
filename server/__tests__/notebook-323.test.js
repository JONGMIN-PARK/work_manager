/**
 * 📓 노트북 v13.323 🔤 AI 맞춤법 · 띄어쓰기 — 답 읽기(원문에 없는 것 · 같은 것 · 겹침 버림) · POST /api/notebook/spell
 */
var h = require('./helpers');
var S = Date.now();
var nbLib = require('../lib/notebook');
var aiProvider = require('../services/ai-provider');
var a;
function api(m, u, who) { return h.request(h.app)[m](u).set('Authorization', 'Bearer ' + who.token); }

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('nb323-' + S);
  a = await h.createTestUser({ email: 'nb323-a-' + S + '@test.com', role: 'member', name: '맞춤' });
});
afterAll(async function () { await h.cleanup(); });

var TEXT = '## 회의\n- 몇일 뒤에 할수 있다\n- 설치 하는것 확인함\n- PLC 를 점검함';
var ANSWER = '```json\n{"items":[' +
  '{"wrong":"몇일 뒤에","right":"며칠 뒤에","type":"spell","why":"\'며칠\'이 바른 말"},' +
  '{"wrong":"할수 있다","right":"할 수 있다","type":"space","why":"의존 명사 \'수\'는 띄어 씀"},' +
  '{"wrong":"설치 하는것","right":"설치하는 것","why":"\'하다\'는 붙이고 \'것\'은 띄어 씀"},' +
  '{"wrong":"없는 말","right":"없는 말이","type":"grammar"},' +
  '{"wrong":"PLC 를","right":"PLC 를","type":"space"},' +
  '{"wrong":"할수 있다","right":"할 수 있다","type":"space"},' +
  '{"wrong":"점검함","right":"점검했음","type":"weird"}' +
']}\n```';

test('답 읽기 — 원문에 있는 것만 · 바뀐 것만 · 겹치지 않게 · 종류 추정', function () {
  var r = nbLib.parseSpell(ANSWER, TEXT);
  expect(r.items.map(function (x) { return x.wrong; })).toEqual(['몇일 뒤에', '할수 있다', '설치 하는것', '점검함']);
  expect(r.items[2].type).toBe('space');   // 종류가 없으면 — 글자는 같고 띄어쓰기만 다르면 띄어쓰기
  expect(r.items[3].type).toBe('spell');   // 모르는 종류
  expect(nbLib.parseSpell('{"items":[{"wrong":"할수","right":"할 수"}]}', '할수').items[0].type).toBe('space');
  expect(r.cut).toBe(false);
  expect(nbLib.parseSpell('엉뚱한 답', TEXT)).toBeNull();
  expect(nbLib.parseSpell('{"items":[]}', TEXT).items).toEqual([]);
  expect(nbLib.spellPrompt('x'.repeat(9000)).length).toBeLessThan(9000);
  expect(nbLib.parseSpell('{"items":[]}', 'x'.repeat(9000)).cut).toBe(true);
  expect(nbLib.spellPrompt(TEXT)).toContain('개조식');
});

test('POST /spell — AI 답을 읽어 돌려줌 · 빈 글 400 · AI 없으면 503', async function () {
  var orig = aiProvider.generateText, seen = null;
  try {
    aiProvider.generateText = async function (o) { seen = o.prompt; return { text: ANSWER, provider: 'gemini' }; };
    var r = await api('post', '/api/notebook/spell', a).send({ text: TEXT });
    expect(r.status).toBe(200);
    expect(r.body.data.items.length).toBe(4);
    expect(r.body.data.items[1]).toEqual(expect.objectContaining({ wrong: '할수 있다', right: '할 수 있다', type: 'space' }));
    expect(seen).toContain('할수 있다');
    expect((await api('post', '/api/notebook/spell', a).send({ text: '  ' })).status).toBe(400);
    aiProvider.generateText = async function () { return null; };
    expect((await api('post', '/api/notebook/spell', a).send({ text: TEXT })).status).toBe(503);
    aiProvider.generateText = async function () { return { text: '모르겠어요', provider: 'gemini' }; };
    expect((await api('post', '/api/notebook/spell', a).send({ text: TEXT })).status).toBe(502);
  } finally { aiProvider.generateText = orig; }
  expect((await h.request(h.app).post('/api/notebook/spell').send({ text: TEXT })).status).toBe(401);
});
