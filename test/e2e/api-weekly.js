// 주간업무보고 저장 — 새 버전 R 번호는 서버가 · 덮어쓰기 충돌 409 · 저장 시각 · 목록 순서 (v13.250)
var B = 'http://localhost:3000';
async function login(email) {
  var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) });
  return (await r.json()).data.accessToken;
}
function api(tok) {
  return async function (method, url, body) {
    var r = await fetch(B + url, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
    var j = null; try { j = await r.json(); } catch (_) {}
    return { s: r.status, d: j };
  };
}
var n = 0;
function check(name, c, x) { if (!c) { console.log('FAIL', name, JSON.stringify(x).slice(0, 800)); throw new Error(name); } n++; console.log('✔', name); }

(async function () {
  var A = api(await login('admin@t.com'));
  var team = 'E2E팀' + Date.now();
  var auto = { team: team, weekStart: '2024-12-30', weekEnd: '2025-01-03' };
  var ids = [];
  try {
    // 동시에 새 버전 3개 — 예전엔 next-name 으로 같은 R 을 받아 서로 덮어씀
    var rs = await Promise.all([1, 2, 3].map(function (i) {
      return A('POST', '/api/weekly-reports', { autoName: auto, curText: '[개발]\n- [A] 작업' + i + ' @관리자', lastText: '' });
    }));
    rs.forEach(function (r) { if (r.d && r.d.data) ids.push(r.d.data[0].id); });
    var names = rs.map(function (r) { return r.s === 201 && r.d.data[0].name; }).sort();
    check('동시 새 버전 3개 → R1 · R2 · R3 (겹침 없음)', names.join(',') === [1, 2, 3].map(function (i) { return team + '_25W01_12/30~01/03_R' + i; }).join(','), names);
    var first = rs[0].d.data[0];
    check('ISO 주차 · 해 넘김 · version 1', first.week_label === '25W01' && first.version === 1, first);

    // 덮어쓰기 — 불러온 버전으로
    var g = (await A('GET', '/api/weekly-reports/' + first.id)).d.data;
    var ow = await A('POST', '/api/weekly-reports', { name: g.name, baseVersion: g.version, curText: '[개발]\n- [A] 고침', lastText: '' });
    check('덮어쓰기 성공 → version 2', ow.s === 201 && ow.d.data[0].version === 2, ow.d);
    var stale = await A('POST', '/api/weekly-reports', { name: g.name, baseVersion: g.version, curText: '[개발]\n- [A] 옛 화면에서', lastText: '' });
    check('옛 버전으로 덮어쓰기 → 409 · 누가', stale.s === 409 && stale.d.error === 'CONFLICT' && stale.d.data.version === 2 && stale.d.data.by, stale.d);
    var after = (await A('GET', '/api/weekly-reports/' + first.id)).d.data;
    check('409 이면 내용 그대로', /고침/.test(after.cur_text) && !/옛 화면/.test(after.cur_text));

    // 파일 업로드(버전 없음)는 예전처럼 덮어씀 · 예전 ko-KR 저장 시각도 읽음
    var up = await A('POST', '/api/weekly-reports', { name: g.name, savedAt: '2026. 4. 24. 오후 3:12:05', curText: '[개발]\n- [A] 업로드', lastText: '' });
    check('업로드 덮어쓰기 + ko-KR 시각', up.s === 201 && up.d.data[0].version === 3 && new Date(up.d.data[0].saved_at).toISOString() === '2026-04-24T06:12:05.000Z', up.d);
    var noAt = await A('POST', '/api/weekly-reports', { autoName: auto, curText: '', lastText: '' });
    ids.push(noAt.d.data[0].id);
    check('저장 시각 없으면 지금 (예전엔 비어 목록에 -)', !!noAt.d.data[0].saved_at && Math.abs(new Date(noAt.d.data[0].saved_at) - Date.now()) < 60000, noAt.d);

    // 목록 — 같은 주는 최근 저장 순 (R10 > R9)
    var list = (await A('GET', '/api/weekly-reports?team=' + encodeURIComponent(team))).d.data;
    check('목록 최근 저장 순 · version 포함', list[0].id === noAt.d.data[0].id && list[0].version === 1, list.map(function (x) { return x.name; }));
    check('잘못된 autoName → 400', (await A('POST', '/api/weekly-reports', { autoName: { team: team, weekStart: 'x', weekEnd: 'y' } })).s === 400);
    var nn = (await A('GET', '/api/weekly-reports/next-name?team=' + encodeURIComponent(team) + '&weekStart=2024-12-30&weekEnd=2025-01-03')).d.data;
    check('next-name 도 같은 계산 (R5)', nn.nextName === team + '_25W01_12/30~01/03_R5', nn);
  } finally {
    for (var i = 0; i < ids.length; i++) await A('DELETE', '/api/weekly-reports/' + ids[i]);
  }
  console.log('\nALL PASS', n);
})().catch(function (e) { console.error(e.message); process.exit(1); });
