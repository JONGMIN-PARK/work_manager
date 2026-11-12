/**
 * 통합 질의 2~4단계 (v13.298~300)
 *   · ai-tools: 인자 검사 · 기간 · 도구 고르기 답 읽기 · 권한 조건 · 차트
 *   · ai.service: 도구 고르기 → 실행 → 답 · 고르기 실패/끔 → 기본 묶음 · 이어 묻기 · 추천 질문
 *   · ai-insights: 규칙 카드 · 범위 · 텔레그램 브리핑 글
 */
jest.mock('../config/db', function () { return { query: jest.fn() }; });
jest.mock('../services/ai-provider', function () {
  return {
    resolve: jest.fn(async function () { return { provider: 'gemini' }; }),
    resolveEnv: jest.fn(function () { return { provider: 'gemini' }; }),
    generateText: jest.fn()
  };
});
var db = require('../config/db');
var aiProvider = require('../services/ai-provider');
var tools = require('../services/ai-tools');
var ai = require('../services/ai.service');
var ins = require('../services/ai-insights');

var T = '11111111-1111-1111-1111-111111111111';
var member = { userId: 'u-mem', role: 'member', departmentId: 'd1', tenantId: T, name: '홍길동' };
var admin = { userId: 'u-adm', role: 'admin', departmentId: null, tenantId: T, name: '관리자' };
function sqlCalls() { return db.query.mock.calls.map(function (c) { return { sql: c[0], params: c[1] || [] }; }); }

beforeEach(function () {
  db.query.mockReset();
  aiProvider.generateText.mockReset();
  aiProvider.resolve.mockClear();
  delete process.env.AI_QUERY_PLANNER;
  jest.spyOn(console, 'error').mockImplementation(function () {});
  jest.spyOn(console, 'warn').mockImplementation(function () {});
});
afterEach(function () { console.error.mockRestore(); console.warn.mockRestore(); });

describe('ai-tools — 인자 · 기간 · 계획 읽기', function () {
  test('cleanArgs: 모르는 값 · 모르는 인자는 버리고, 글은 자르고, 숫자는 범위 안으로', function () {
    expect(tools.cleanArgs('work_hours', { group_by: 'nope', period: 'last_week', person: 'x'.repeat(100), evil: 'DROP', start: '20261001' }))
      .toEqual({ period: 'last_week', person: 'x'.repeat(60), start: '2026-10-01' });
    expect(tools.cleanArgs('milestones_due', { days: 9999, overdue_only: 'true' })).toEqual({ days: 120, overdue_only: true });
    expect(tools.cleanArgs('as_tickets', { days: '-5', start: 'yesterday' })).toEqual({ days: 1 });
    expect(tools.cleanArgs('없는도구', { a: 1 })).toEqual({});
  });

  test('resolvePeriod: 한국 날짜 기준 (2026-11-01 일요일)', function () {
    var d = '2026-11-01';
    expect(tools.resolvePeriod('this_week', null, null, d)).toMatchObject({ start: '20261026', end: '20261101' });
    expect(tools.resolvePeriod('last_week', null, null, d)).toMatchObject({ start: '20261019', end: '20261025', label: '지난주' });
    expect(tools.resolvePeriod('last_month', null, null, d)).toMatchObject({ start: '20261001', end: '20261031' });
    expect(tools.resolvePeriod('last_30d', null, null, d)).toMatchObject({ start: '20261003', end: '20261101' });
    expect(tools.resolvePeriod('custom', '2026-10-31', '2026-10-01', d)).toMatchObject({ start: '20261001', end: '20261031' });
    expect(tools.resolvePeriod(undefined, null, null, d)).toMatchObject({ label: '이번 주' });
  });

  test('parsePlan: 코드블록 · 배열 · 모르는 도구 · 망가진 글', function () {
    expect(tools.parsePlan('```json\n{"calls":[{"tool":"projects","args":{"status":"delayed","x":1}},{"tool":"rm_rf"}]}\n```'))
      .toEqual([{ tool: 'projects', args: { status: 'delayed' } }]);
    expect(tools.parsePlan('[{"tool":"issues","args":{}}]')).toEqual([{ tool: 'issues', args: {} }]);
    expect(tools.parsePlan('{"calls":[{"tool":"nope"}]}')).toBeNull();
    expect(tools.parsePlan('그냥 글')).toBeNull();
    expect(tools.parsePlan(null)).toBeNull();
    var many = { calls: [] };
    for (var i = 0; i < 10; i++) many.calls.push({ tool: 'orders', args: {} });
    expect(tools.parsePlan(JSON.stringify(many)).length).toBe(6);
  });

  test('도구 설명에 모든 도구 · 질문자 이름', function () {
    var p = tools.planPrompt('내 이번 주 시간은?', member, [{ q: '앞 질문', a: '앞 답' }]);
    Object.keys(tools.TOOLS).forEach(function (k) { expect(p).toContain('- ' + k + '('); });
    expect(p).toContain('person 에 "홍길동"');
    expect(p).toContain('Q: 앞 질문');
  });
});

describe('ai-tools — 실행 · 권한', function () {
  test('일반 직원 work_hours: 회사 전체(v13.481 공용) + 거르기 인자는 매개변수로 (SQL 에 안 섞임)', async function () {
    db.query.mockResolvedValue({ rows: [{ label: 'D', hours: '10', people: 1 }, { label: 'M', hours: '5', people: 1 }] });
    var r = await tools.runCalls([{ tool: 'work_hours', args: { group_by: 'abbr', period: 'last_week', person: "x' OR 1=1 --" } }], member);
    var c = sqlCalls()[0];
    expect(c.sql).not.toMatch(/user_id/);
    expect(c.sql).not.toMatch(/OR 1=1/);
    expect(c.params).toContain("%x' OR 1=1 --%");
    expect(c.params[0]).toBe(T);
    expect(r.text).toMatch(/업무분장별 투입시간 · 지난주 .* 범위: 회사 전체/);
    expect(r.charts[0]).toMatchObject({ unit: 'h', rows: [{ label: 'D(개발)', value: 10 }, { label: 'M(양산)', value: 5 }] });
    expect(r.ran).toEqual([{ tool: 'work_hours', label: '업무일지 시간 집계', args: { group_by: 'abbr', period: 'last_week', person: "x' OR 1=1 --" }, rows: 2 }]);
  });

  test('같은 대상은 같은 근거 키 · 같은 호출은 한 번만 · 실패한 도구는 -1', async function () {
    db.query.mockImplementation(async function (sql) {
      if (/FROM projects p/.test(sql)) return { rows: [{ id: 'p1', name: 'A', status: 'active' }] };
      if (/FROM orders/.test(sql)) throw new Error('boom');
      return { rows: [] };
    });
    var r = await tools.runCalls([
      { tool: 'projects', args: { status: 'open' } },
      { tool: 'projects', args: { status: 'open' } },
      { tool: 'projects', args: { status: 'all' } },
      { tool: 'orders', args: {} }
    ], admin);
    expect(r.ran.map(function (x) { return x.rows; })).toEqual([1, 1, -1]);
    expect(r.sources.length).toBe(1);
    expect(r.text.match(/\[P1\]/g).length).toBe(2);
  });

  test('project_detail: 볼 수 있는 프로젝트에서만 찾음 (가시성 조건)', async function () {
    db.query.mockResolvedValue({ rows: [] });
    var r = await tools.runCalls([{ tool: 'project_detail', args: { project: '설비' } }], member);
    var c = sqlCalls()[0];
    expect(c.sql).toMatch(/owner_id = \$\d+ OR p\.visibility = 'tenant'/);
    expect(c.params).toContain('%설비%');
    expect(r.text).toMatch(/볼 수 있는 프로젝트 중/);
  });

  test('묻는 사람 정보 없으면 조회 안 함', async function () {
    var r = await tools.runCalls([{ tool: 'projects', args: {} }], { tenantId: T });
    expect(r.ran).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('ai.service — 도구 고르기 → 답', function () {
  test('AI 가 고른 도구만 실행 · 추천 질문 분리 · 이어 묻기 대화 전달', async function () {
    db.query.mockImplementation(async function (sql) {
      if (/FROM projects p/.test(sql)) return { rows: [{ id: 'p1', name: '설비 A', status: 'delayed', progress: 20 }] };
      return { rows: [] };
    });
    aiProvider.generateText
      .mockResolvedValueOnce({ text: '{"calls":[{"tool":"projects","args":{"status":"delayed"}}]}', provider: 'gemini' })
      .mockResolvedValueOnce({ text: '설비 A 가 늦습니다 [P1].\n\n이어서: 설비 A 마일스톤은? | 담당자는 누구?', provider: 'gemini', model: 'gemini-2.5-flash' });
    var out = await ai.answerWeb('지연 프로젝트?', member, { history: [{ q: '앞 질문', a: '앞 답 [P3]' }, { q: '', a: 'x' }] });
    var sql = sqlCalls();
    expect(sql.length).toBe(1);
    expect(sql[0].sql).toMatch(/= 'delayed'/);
    expect(out.planned).toBe(true);
    expect(out.answer).toBe('설비 A 가 늦습니다 [P1].');
    expect(out.followups).toEqual(['설비 A 마일스톤은?', '담당자는 누구?']);
    expect(out.tools).toEqual([{ tool: 'projects', label: '프로젝트 목록', args: { status: 'delayed' }, rows: 1 }]);
    var answerPrompt = aiProvider.generateText.mock.calls[1][0].prompt;
    expect(answerPrompt).toMatch(/Q: 앞 질문\nA: 앞 답/);
    expect(answerPrompt).not.toMatch(/\[P3\]/);
    expect(answerPrompt).toMatch(/이어서: 질문1/);
  });

  test('도구 고르기가 오류면 낱말 의도 묶음으로', async function () {
    db.query.mockResolvedValue({ rows: [] });
    aiProvider.generateText
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({ text: '답', provider: 'gemini' });
    var out = await ai.answerWeb('긴급 이슈 알려줘', member);
    expect(out.planned).toBe(false);
    expect(out.tools.map(function (t) { return t.tool; })).toEqual(['issues']);
  });

  test('크레딧 부족은 그대로 올림 (화면에 원인 표시)', async function () {
    var e = new Error('credit'); e.code = 'CREDIT_LOW';
    aiProvider.generateText.mockRejectedValueOnce(e);
    await expect(ai.answerWeb('?', member)).rejects.toMatchObject({ code: 'CREDIT_LOW' });
  });

  test('AI_QUERY_PLANNER=0 이면 고르기 없이 한 번만 부름', async function () {
    process.env.AI_QUERY_PLANNER = '0';
    db.query.mockResolvedValue({ rows: [] });
    aiProvider.generateText.mockResolvedValue({ text: '답', provider: 'gemini' });
    await ai.answerWeb('수주 현황', member);
    expect(aiProvider.generateText).toHaveBeenCalledTimes(1);
  });

  test('AI 가 준비 안 됐으면 null', async function () {
    aiProvider.resolve.mockResolvedValueOnce(null);
    expect(await ai.answerWeb('?', member)).toBeNull();
    expect(aiProvider.generateText).not.toHaveBeenCalled();
  });

  test('splitFollowups — 굵게 · 따옴표 · 없을 때', function () {
    expect(ai.splitFollowups('본문\n**이어서:** "A 는?" | 2. B 는?')).toEqual({ text: '본문', followups: ['A 는?', 'B 는?'] });
    expect(ai.splitFollowups('본문만')).toEqual({ text: '본문만', followups: [] });
  });
});

describe('ai-insights — 규칙 카드', function () {
  test('관리자: 위험 → 주의 → 참고 순, 항목에 이동 정보', async function () {
    var old = new Date(Date.now() - 20 * 86400000).toISOString();
    db.query.mockImplementation(async function (sql) {
      if (/= 'delayed' ORDER BY/.test(sql)) return { rows: [{ id: 'p1', name: '설비 A', end_date: '2026-10-01', progress: 40 }] };
      if (/FROM milestones m/.test(sql)) return { rows: [{ id: 'm1', name: '조립', end_date: '2000-01-01', progress: 10, project_id: 'p1', proj_name: '설비 A' }] };
      if (/FROM issues/.test(sql)) return { rows: [{ id: 'i1', title: '센서', urgency: 'urgent', created_at: old }, { id: 'i2', title: '도면', urgency: 'normal', created_at: old }] };
      if (/HAVING SUM\(hours\) > 52/.test(sql)) return { rows: [{ name: '김철수', hours: '60', days: 5 }] };
      if (/NOT EXISTS \(SELECT 1 FROM work_records/.test(sql)) return { rows: [{ id: 'p2', name: '설비 B', order_no: 'O-2' }] };
      return { rows: [] };
    });
    var cards = await ins.computeInsights(admin);
    expect(cards.map(function (c) { return c.id; })).toEqual(['delayed', 'ms-overdue', 'urgent', 'stale', 'overload', 'idle']);
    expect(cards[0].items[0].nav).toEqual({ projectId: 'p1' });
    expect(cards[4].items[0]).toMatchObject({ label: '김철수', nav: { name: '김철수' } });
    cards.forEach(function (c) { expect(c.ask).toBeTruthy(); });
    sqlCalls().forEach(function (c) { expect(c.params).toContain(T); });
    var txt = ins.briefText(cards, '관리<자>');
    expect(txt).toMatch(/💡 <b>이번 주 살펴볼 것<\/b> · 관리&lt;자&gt;/);
    expect(txt).toMatch(/🔴 <b>지연 프로젝트 1건<\/b>/);
  });

  test('일반 직원: 업무일지는 회사 전체(v13.481 공용) · "기록 없는 프로젝트"도 계산', async function () {
    db.query.mockResolvedValue({ rows: [] });
    var cards = await ins.computeInsights(member);
    expect(cards).toEqual([]);
    var sql = sqlCalls();
    expect(sql.some(function (c) { return /NOT EXISTS \(SELECT 1 FROM work_records/.test(c.sql); })).toBe(true);
    var w = sql.filter(function (c) { return /HAVING SUM\(hours\)/.test(c.sql); })[0];
    expect(w.sql).not.toMatch(/user_id/);
    expect(ins.briefText([], 'x')).toBe('');
  });
});
