/**
 * GET /api/weekly-reports/insights · /stats (v13.310) — 관리자만 · 같은 주차 여러 버전은 마지막 것만
 */
var h = require('./helpers');
var db = h.db;
var T = h.TEST_TENANT_ID;
var S = Date.now();
var admin, member;
function api(m, u, who) { return h.request(h.app)[m](u).set('Authorization', 'Bearer ' + who.token); }
function monday(offsetWeeks) {
  var d = new Date(); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - offsetWeeks * 7);
  return d.toISOString().slice(0, 10);
}
var TEAM = 'API시험팀' + S;

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('wi-' + S);
  admin = await h.createTestUser({ email: 'wi-a-' + S + '@test.com', role: 'admin' });
  member = await h.createTestUser({ email: 'wi-m-' + S + '@test.com', role: 'member' });
  var parser = require('../services/weekly-report-parser');
  async function put(name, ws, cur, updated) {
    var parsed = parser.buildParsed({ curText: cur, lastText: '' });
    await db.query("INSERT INTO weekly_reports (tenant_id, name, team, week_start, week_end, cur_text, parsed, updated_at) VALUES ($1,$2,$3,$4,$4::date + 4,$5,$6,$7)",
      [T, name, TEAM, ws, cur, JSON.stringify(parsed), updated]);
  }
  await put('a_R1', monday(2), '[개발]\n[A사] 검사기 ~12/30 20% @홍', new Date(Date.now() - 3 * 86400000));
  await put('b_R1', monday(1), '[개발]\n[A사] 검사기 ~12/30 20% @홍', new Date(Date.now() - 2 * 86400000));
  await put('b_R2', monday(1), '[개발]\n[A사] 검사기 ~12/30 40% @홍\n[B사] 셋업 #완료 @김', new Date(Date.now() - 1 * 86400000));
});
afterAll(async function () {
  await db.query('DELETE FROM weekly_reports WHERE tenant_id = $1', [T]);
  await h.cleanup();
});

test('관리자만', async function () {
  var r = await api('get', '/api/weekly-reports/insights', member);
  expect(r.status).toBe(403);
});

test('분석 — 2주, 같은 주 R1·R2 중 R2 만', async function () {
  var r = await api('get', '/api/weekly-reports/insights?weeks=8&items=1&text=1&team=' + encodeURIComponent(TEAM), admin);
  expect(r.status).toBe(200);
  var d = r.body.data;
  expect(d.range.weeks).toBe(2);
  expect(d.range.reports).toBe(2);
  expect(d.weekly[1]).toMatchObject({ total: 2, done: 1 });
  expect(d.items.filter(function (i) { return i.client === 'A사'; })[0].pctHist.map(function (x) { return x.p; })).toEqual([20, 40]);
  expect(d.teams).toContain(TEAM);
  expect(d.text).toMatch(/기간/);
});

test('/stats 도 같은 주차는 마지막 버전만 (예전엔 두 번 셌다)', async function () {
  var r = await api('get', '/api/weekly-reports/stats?team=' + encodeURIComponent(TEAM), admin);
  expect(r.body.data.totals.weeks).toBe(2);
  expect(r.body.data.totals.items).toBe(3);
});
