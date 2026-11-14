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
  await db.query('DELETE FROM weekly_item_links WHERE tenant_id = $1', [T]);
  await db.query('DELETE FROM weekly_goals WHERE tenant_id = $1', [T]);
  await db.query('DELETE FROM weekly_item_bin WHERE tenant_id = $1', [T]);
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

/* ─── v13.311 묶기 · 나누기 · 경과 · 목표 · 작성 중 점검 ─── */
test('일 하나의 경과 — 주마다 진행률', async function () {
  var key = TEAM + '|a사|검사기';
  var r = await api('get', '/api/weekly-reports/insights/item?key=' + encodeURIComponent(key), admin);
  expect(r.status).toBe(200);
  expect(r.body.data.hist.map(function (h) { return h.pct; })).toEqual([20, 40]);
  var nf = await api('get', '/api/weekly-reports/insights/item?key=' + encodeURIComponent(TEAM + '|x|없음'), admin);
  expect(nf.status).toBe(404);
});

test('같은 일 묶기 → 하나로 · 되돌리기 → 다시 둘', async function () {
  var ka = TEAM + '|a사|검사기', kb = TEAM + '|b사|셋업';
  var bad = await api('post', '/api/weekly-reports/item-links', admin).send({ kind: 'merge', keys: [ka], target: ka });
  expect(bad.status).toBe(400);
  var m = await api('post', '/api/weekly-reports/item-links', admin).send({ kind: 'merge', keys: [kb], target: ka });
  expect(m.status).toBe(200);
  var r = await api('get', '/api/weekly-reports/insights?weeks=8&items=1&team=' + encodeURIComponent(TEAM), admin);
  expect(r.body.data.items.length).toBe(1);
  expect(r.body.data.items[0].linked).toBe('manual');
  await api('post', '/api/weekly-reports/item-links', admin).send({ kind: 'reset', key: kb });
  r = await api('get', '/api/weekly-reports/insights?weeks=8&items=1&team=' + encodeURIComponent(TEAM), admin);
  expect(r.body.data.items.length).toBe(2);
  var sp = await api('post', '/api/weekly-reports/item-links', admin).send({ kind: 'split', key: kb });
  expect(sp.status).toBe(200);
  var row = await db.query('SELECT kind FROM weekly_item_links WHERE tenant_id = $1 AND item_key = $2', [T, kb]);
  expect(row.rows[0].kind).toBe('split');
  var no = await api('post', '/api/weekly-reports/item-links', member).send({ kind: 'split', key: kb });
  expect(no.status).toBe(403);
});

test('목표 — 저장 · 검사 · 분석에 실적과 함께', async function () {
  var bad = await api('put', '/api/weekly-reports/goals', admin).send({ team: TEAM, goals: [{ metric: 'onTimeRate', target: 150 }] });
  expect(bad.status).toBe(400);
  var bad2 = await api('put', '/api/weekly-reports/goals', admin).send({ team: TEAM, goals: [{ member: '홍', metric: 'completionRate', target: 50 }] });
  expect(bad2.status).toBe(400);
  var ok = await api('put', '/api/weekly-reports/goals', admin).send({ team: TEAM, goals: [{ metric: 'completionRate', target: 40 }, { member: '홍', metric: 'active', target: 1 }] });
  expect(ok.status).toBe(200);
  var g = await api('get', '/api/weekly-reports/goals?team=' + encodeURIComponent(TEAM), admin);
  expect(g.body.data.length).toBe(2);
  expect(g.body.metrics.throughput.label).toBeTruthy();
  var r = await api('get', '/api/weekly-reports/insights?weeks=8&team=' + encodeURIComponent(TEAM), admin);
  var cr = r.body.data.goals.filter(function (x) { return x.metric === 'completionRate'; })[0];
  expect(cr.target).toBe(40);
  expect(cr.actual).toBe(25);          // 0% · 50% 평균
  expect(cr.ok).toBe(false);
  var hong = r.body.data.goals.filter(function (x) { return x.member === '홍'; })[0];
  expect(hong).toMatchObject({ actual: 1, ok: true });
  // 다른 팀(모든 팀) 목표는 따로
  var all = await api('get', '/api/weekly-reports/insights?weeks=8', admin);
  expect(all.body.data.goals).toEqual([]);
});

test('작성 중 점검 — 지난주 보고서에 있던 일이 빠지면 알려줌', async function () {
  var r = await api('post', '/api/weekly-reports/check', admin).send({ team: TEAM, weekStart: monday(0), lastText: '', curText: '[개발]\n- [C사] 새 일 #진행중' });
  expect(r.status).toBe(200);
  expect(r.body.data.missing.map(function (m) { return m.client; })).toEqual(['A사']);   // B사 셋업은 끝낸 일
  expect(r.body.data.quality[0].text).toMatch(/납기 · 담당 없음/);
  var bad = await api('post', '/api/weekly-reports/check', admin).send({ team: TEAM, weekStart: 'x' });
  expect(bad.status).toBe(400);
});

test('🗑 휴지통 · 처리 대기 (v13.490) — 없애면 점검에서 빠지고 대기로 추적 · 완료 처리 · 다시 대기 · 삭제', async function () {
  var body = { team: TEAM, weekStart: monday(0), lastText: '', curText: '[개발]\n- [C사] 새 일 #진행중' };
  var c0 = await api('post', '/api/weekly-reports/check', admin).send(body);
  var m = c0.body.data.missing[0];
  expect(c0.body.data.bin).toEqual({ wait: 0, oldestAt: null });
  var put = await api('post', '/api/weekly-reports/bin', admin).send({ team: TEAM, items: [m] });
  expect(put.status).toBe(200);
  expect(put.body.data[0]).toMatchObject({ client: 'A사', state: 'wait', line: m.line });
  expect(put.body.summary.wait).toBe(1);
  var c1 = await api('post', '/api/weekly-reports/check', admin).send(body);
  expect(c1.body.data.missing).toEqual([]);            // 점검에서 빠짐
  expect(c1.body.data.binned).toBe(1);
  expect(c1.body.data.bin.wait).toBe(1);               // 하지만 처리 대기로 늘 보임
  var id = put.body.data[0].id;
  var note = await api('patch', '/api/weekly-reports/bin/' + id, admin).send({ note: '고객 회신 대기' });
  expect(note.body.data.note).toBe('고객 회신 대기');
  var use = await api('post', '/api/weekly-reports/bin/' + id + '/use', admin).send({ as: 'done' });
  expect(use.body.data).toMatchObject({ state: 'done', useCount: 1 });
  var list = await api('get', '/api/weekly-reports/bin?team=' + encodeURIComponent(TEAM), admin);
  expect(list.body.summary.wait).toBe(0);
  expect(list.body.data.length).toBe(1);               // 처리됨으로 남아 다시 꺼내 씀
  var back = await api('patch', '/api/weekly-reports/bin/' + id, admin).send({ state: 'wait' });
  expect(back.body.data.state).toBe('wait');
  // 같은 일을 또 없애면 다시 대기 (중복 없음)
  await api('post', '/api/weekly-reports/bin/' + id + '/use', admin).send({ as: 'resume' });
  var again = await api('post', '/api/weekly-reports/bin', admin).send({ team: TEAM, items: [m] });
  expect(again.body.data[0]).toMatchObject({ id: id, state: 'wait', note: '고객 회신 대기' });
  expect((await api('delete', '/api/weekly-reports/bin/' + id, admin)).status).toBe(200);
  expect((await api('delete', '/api/weekly-reports/bin/' + id, admin)).status).toBe(404);
  expect((await api('post', '/api/weekly-reports/bin', admin).send({ team: TEAM, items: [] })).status).toBe(400);
  expect((await api('patch', '/api/weekly-reports/bin/abc', admin).send({ note: 'x' })).status).toBe(400);
});
