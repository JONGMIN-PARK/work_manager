/**
 * ai.service — 통합 질의 1단계 (v13.297)
 *   · 묻는 사람 권한 범위로만 데이터 수집 (프로젝트 가시성 · 업무일지 범위 · 회사 구분)
 *   · 답 속 [P1] 근거 표시: 없는 표시는 지우고, 인용된 근거를 먼저
 *   · 텔레그램 답에서는 근거 표시를 지움
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
var ai = require('../services/ai.service');

var T = '11111111-1111-1111-1111-111111111111';
var member = { userId: 'u-mem', role: 'member', departmentId: 'd1', tenantId: T, name: '홍길동' };
var admin = { userId: 'u-adm', role: 'admin', departmentId: null, tenantId: T, name: '관리자' };

function sqlCalls() { return db.query.mock.calls.map(function (c) { return { sql: c[0], params: c[1] || [] }; }); }

beforeEach(function () {
  db.query.mockReset();
  aiProvider.generateText.mockReset();
  jest.spyOn(console, 'error').mockImplementation(function () {});
});
afterEach(function () { console.error.mockRestore(); });

describe('gatherContext — 권한 범위', function () {
  test('일반 직원: 프로젝트는 가시성 조건, 업무일지는 본인 것만, 모든 조회에 회사 조건', async function () {
    db.query.mockImplementation(async function (sql) {
      if (/FROM projects p WHERE/.test(sql)) return { rows: [{ id: 'p1', name: '설비 A', order_no: 'O-1', status: 'delayed', progress: 30, end_date: '2026-11-10', assignees: '["홍길동"]' }] };
      if (/SELECT name, COALESCE\(SUM\(hours\)/.test(sql)) return { rows: [{ name: '홍길동', hours: '12.5', days: 3, orders: 2 }] };
      return { rows: [] };
    });
    var ctx = await ai.gatherContext(['general'], member);
    var calls = sqlCalls();
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach(function (c) { expect(c.params).toContain(T); });   // 회사 구분
    var proj = calls.filter(function (c) { return /FROM projects p WHERE/.test(c.sql); })[0];
    expect(proj.sql).toMatch(/owner_id = \$\d+ OR p\.visibility = 'tenant'/);
    expect(proj.params).toContain('u-mem');
    var work = calls.filter(function (c) { return /FROM work_records/.test(c.sql); })[0];
    expect(work.sql).toMatch(/user_id = \$2/);
    expect(work.params.slice(0, 2)).toEqual([T, 'u-mem']);
    expect(ctx.text).toMatch(/범위: 본인 것만/);
    expect(ctx.text).toMatch(/\[P1\] O-1 설비 A/);
    expect(ctx.sources[0]).toMatchObject({ key: 'P1', type: 'project', nav: { projectId: 'p1' } });
  });

  test('관리자: 프로젝트 조건 없음(TRUE), 업무일지 회사 전체', async function () {
    db.query.mockResolvedValue({ rows: [] });
    await ai.gatherContext(['people', 'projects'], admin);
    var calls = sqlCalls();
    var proj = calls.filter(function (c) { return /FROM projects p WHERE/.test(c.sql); })[0];
    expect(proj.sql).toMatch(/AND TRUE AND/);
    var work = calls.filter(function (c) { return /FROM work_records/.test(c.sql); })[0];
    expect(work.sql).not.toMatch(/user_id/);
  });

  test('이슈: 프로젝트 없는 이슈는 본인 것만 + 접근 가능한 프로젝트', async function () {
    db.query.mockResolvedValue({ rows: [] });
    await ai.gatherContext(['issues'], member);
    var iss = sqlCalls().filter(function (c) { return /FROM issues/.test(c.sql); })[0];
    expect(iss.sql).toMatch(/project_id IS NULL AND created_by = \$2/);
    expect(iss.sql).toMatch(/project_id IN \(SELECT p\.id FROM projects p WHERE p\.tenant_id = \$3/);
  });

  test('묻는 사람 정보가 없으면 아무것도 안 봄', async function () {
    var ctx = await ai.gatherContext(['general'], { tenantId: T });
    expect(ctx).toMatchObject({ text: '', sources: [], charts: [], ran: [] });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('한 범주가 실패해도 나머지는 그대로', async function () {
    db.query.mockImplementation(async function (sql) {
      if (/FROM work_records/.test(sql)) throw new Error('boom');
      if (/FROM issues/.test(sql)) return { rows: [{ id: 'i1', title: '센서 오류', urgency: 'urgent', status: 'open', assignees: [] }] };
      return { rows: [] };
    });
    var ctx = await ai.gatherContext(['general'], member);
    expect(ctx.text).toMatch(/\[I1\] \[urgent\] 센서 오류/);
  });
});

describe('answerWeb — 근거 표시', function () {
  test('없는 표시는 지우고, 인용된 근거를 앞으로', async function () {
    db.query.mockImplementation(async function (sql) {
      if (/FROM projects p WHERE/.test(sql)) return { rows: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] };
      return { rows: [] };
    });
    aiProvider.generateText.mockResolvedValue({ text: 'B 가 늦습니다 [P2, P9]. 근거 없음 [M7].', provider: 'gemini', model: 'gemini-2.5-flash', note: '' });
    var out = await ai.answerWeb('지연 프로젝트?', member);
    expect(out.answer).toBe('B 가 늦습니다 [P2]. 근거 없음 .');
    expect(out.sources[0]).toMatchObject({ key: 'P2', cited: true });
    expect(out.sources[1]).toMatchObject({ key: 'P1', cited: false });
    var calls = aiProvider.generateText.mock.calls;
    expect(calls[0][0].json).toBe(true);   // 1) 도구 고르기 (JSON 아님 → 기본 묶음)
    var prompt = calls[calls.length - 1][0].prompt;
    expect(prompt).toMatch(/\[P1\]/);
    expect(prompt).toMatch(/질문자: 홍길동/);
  });

  test('키가 없으면 null', async function () {
    db.query.mockResolvedValue({ rows: [] });
    aiProvider.generateText.mockResolvedValue(null);
    expect(await ai.answerWeb('?', member)).toBeNull();
  });
});

describe('answerQuestion — 텔레그램', function () {
  test('텔레그램 사용자 권한으로 수집하고, 답에서 근거 표시를 지움', async function () {
    db.query.mockResolvedValue({ rows: [] });
    aiProvider.generateText.mockResolvedValue({ text: '**지연** 1건 [P1, M2]', provider: 'gemini' });
    var ans = await ai.answerQuestion('프로젝트 현황', { user_id: 'u-mem', role: 'member', department_id: 'd1', tenant_id: T, name: '홍길동' });
    expect(ans).toBe('🤖 <b>지연</b> 1건');
    sqlCalls().forEach(function (c) { expect(c.params).toContain(T); });
    expect(sqlCalls().some(function (c) { return c.params.indexOf('u-mem') >= 0; })).toBe(true);
  });
});

describe('analyzeQuery', function () {
  test('A/S · 마일스톤 의도', function () {
    expect(ai.analyzeQuery('최근 A/S 반복 장비')).toContain('as');
    expect(ai.analyzeQuery('마감 임박 마일스톤')).toContain('milestones');
    expect(ai.analyzeQuery('안녕')).toEqual(['general']);
  });
});
