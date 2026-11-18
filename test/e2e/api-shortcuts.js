// 🔖 바로가기 API (v13.528) — 추가 · 같은 곳 · 순서 · 이름 · 휴지통 · 되살리기 · 영구 삭제 · 비우기 · 본인 것만 · 검사
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
var ok = 0;
function check(n, c, x) { if (!c) { console.log('FAIL', n, JSON.stringify(x)); process.exit(1); } ok++; console.log('✔', n); }
(async function () {
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com'));
  // 깨끗하게
  ((await A('GET', '/api/shortcuts')).d.data || []).forEach(function () {});
  for (var x of (await A('GET', '/api/shortcuts')).d.data) await A('DELETE', '/api/shortcuts/' + x.id);
  await A('DELETE', '/api/shortcuts/trash');
  check('공개 API 는 그대로 (로그인 401 아님)', (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status !== 401);

  check('위치 없음 400', (await A('POST', '/api/shortcuts', { title: 'x' })).s === 400);
  check('이상한 page 400', (await A('POST', '/api/shortcuts', { title: 'x', target: { page: 'a/b' } })).s === 400);
  var s1 = await A('POST', '/api/shortcuts', { title: '문서 화면', menu: '📁 프로젝트 관리', part: '📂 문서', icon: '📂', target: { page: 'project', mode: 'docs' } });
  check('추가 1', s1.s === 201 && s1.d.data.menu === '📁 프로젝트 관리', s1.d);
  var s2 = await A('POST', '/api/shortcuts', { title: '발표 자료', menu: '📁 프로젝트 관리', part: '📂 문서', item: '발표.pptx', icon: '📄', target: { page: 'project', mode: 'docs', ctx: { k: 'docview', id: 'pf-1', bad: 'x' } } });
  check('추가 2 — 항목 · ctx 정리', s2.s === 201 && s2.d.data.target.ctx.k === 'docview' && !s2.d.data.target.ctx.bad, s2.d);
  var s3 = await A('POST', '/api/shortcuts', { title: '노트', menu: '📓 노트', part: '노트북', item: '회의록', target: { page: 'notebook', ctx: { k: 'note', id: 'n-1' } } });
  var l1 = (await A('GET', '/api/shortcuts')).d.data;
  check('새 것이 맨 위', l1.length === 3 && l1[0].id === s3.d.data.id && l1[2].id === s1.d.data.id, l1.map(function (x) { return x.title; }));
  var dup = await A('POST', '/api/shortcuts', { title: '다른 이름', target: { page: 'project', mode: 'docs' } });
  check('같은 곳 — 새로 안 만들고 맨 위로', dup.d.existed && dup.d.data.id === s1.d.data.id && (await A('GET', '/api/shortcuts')).d.data[0].id === s1.d.data.id, dup.d);
  check('이름 바꾸기', (await A('PUT', '/api/shortcuts/' + s2.d.data.id, { title: '발표(최종)' })).d.data.title === '발표(최종)');
  check('빈 이름 400', (await A('PUT', '/api/shortcuts/' + s2.d.data.id, { title: '  ' })).s === 400);
  await A('PUT', '/api/shortcuts/order', { ids: [s2.d.data.id, s3.d.data.id, s1.d.data.id] });
  check('순서', (await A('GET', '/api/shortcuts')).d.data.map(function (x) { return x.id; }).join() === [s2.d.data.id, s3.d.data.id, s1.d.data.id].join());
  // 남의 것
  check('남이 못 봄', !((await K('GET', '/api/shortcuts')).d.data || []).some(function (x) { return x.id === s1.d.data.id; }));
  check('남이 못 지움', (await K('DELETE', '/api/shortcuts/' + s1.d.data.id)).s === 404);
  check('남이 못 고침', (await K('PUT', '/api/shortcuts/' + s1.d.data.id, { title: 'x' })).s === 404);
  // 휴지통
  check('휴지통으로', (await A('DELETE', '/api/shortcuts/' + s3.d.data.id)).s === 200);
  var l2 = await A('GET', '/api/shortcuts');
  check('목록에서 빠지고 휴지통 수 1', l2.d.data.length === 2 && l2.d.trashCount === 1);
  check('휴지통 목록', (await A('GET', '/api/shortcuts?trash=1')).d.data[0].id === s3.d.data.id);
  check('목록에 있는 것은 영구 삭제 안 됨', (await A('DELETE', '/api/shortcuts/' + s1.d.data.id + '?hard=1')).s === 404);
  check('되살리기 — 맨 아래', (await A('POST', '/api/shortcuts/' + s3.d.data.id + '/restore')).s === 200 && (await A('GET', '/api/shortcuts')).d.data.pop().id === s3.d.data.id);
  await A('DELETE', '/api/shortcuts/' + s3.d.data.id);
  check('영구 삭제', (await A('DELETE', '/api/shortcuts/' + s3.d.data.id + '?hard=1')).s === 200 && (await A('GET', '/api/shortcuts?trash=1')).d.data.length === 0);
  await A('DELETE', '/api/shortcuts/' + s2.d.data.id);
  var re = await A('POST', '/api/shortcuts', { title: '발표 다시', target: s2.d.data.target });
  check('휴지통에 있는 같은 곳을 다시 추가 → 되살림', re.d.existed && re.d.data.id === s2.d.data.id && (await A('GET', '/api/shortcuts')).d.trashCount === 0, re.d);
  await A('DELETE', '/api/shortcuts/' + s1.d.data.id); await A('DELETE', '/api/shortcuts/' + s2.d.data.id);
  check('비우기', (await A('DELETE', '/api/shortcuts/trash')).d.data.n === 2 && (await A('GET', '/api/shortcuts?trash=1')).d.data.length === 0);
  console.log('\nALL PASS ' + ok);
})().catch(function (e) { console.log('ERR', e.stack || e.message); process.exit(1); });
