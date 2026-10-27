// 프로젝트 범위 맵 — 프로젝트 권한을 따르는지
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
function check(n, c, x) { if (!c) { console.log('FAIL', n, JSON.stringify(x)); process.exit(1); } console.log('✔', n); }
(async function () {
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com'));
  var kimId = (await K('GET', '/api/auth/me')).d.data.id;
  await A('PUT', '/api/mindmaps/access/users/' + kimId, { enabled: true });
  var pid = 'p-mm-' + Date.now();
  var pr = await A('POST', '/api/projects', { id: pid, name: '비공개 프로젝트', visibility: 'private' });
  check('프로젝트 생성', pr.s === 200 || pr.s === 201, pr);
  pid = (pr.d.data && pr.d.data.id) || pid;
  var vis = await A('GET', '/api/projects/' + pid);
  console.log('  visibility =', vis.d.data && vis.d.data.visibility);
  check('김: 접근 못 하는 프로젝트로 맵 생성 불가', (await K('POST', '/api/mindmaps', { title: 'x', scope: 'project', projectId: pid })).s === 404);
  var c = await A('POST', '/api/mindmaps', { title: '프로젝트 맵', scope: 'project', projectId: pid });
  check('관리자: 프로젝트 맵 생성', c.s === 201, c);
  var id = c.d.data.id;
  check('김(비참여): 읽기 404', (await K('GET', '/api/mindmaps/' + id)).s === 404);
  check('김(비참여): 목록에 없음', !(await K('GET', '/api/mindmaps')).d.data.some(function (m) { return m.id === id; }));
  // 김을 참여자로
  var mem = await A('POST', '/api/projects/' + pid + '/members', { userId: kimId, role: 'assignee' });
  console.log('  member add', mem.s, mem.d && (mem.d.error || ''));
  if (mem.s < 300) {
    var g = await K('GET', '/api/mindmaps/' + id);
    check('김(참여자): 읽기 · 편집 가능', g.s === 200 && g.d.data.can_edit === true, g.d);
    check('김(참여자): 목록에 표시 · 프로젝트명', (await K('GET', '/api/mindmaps?scope=project')).d.data.some(function (m) { return m.id === id && m.project_name === '비공개 프로젝트'; }));
    check('김(참여자, 소유자 아님): 공유 설정 변경 불가', (await K('PUT', '/api/mindmaps/' + id, { version: 1, scope: 'personal' })).s === 403);
    check('김(참여자): 내용 저장', (await K('PUT', '/api/mindmaps/' + id, { version: 1, doc: g.d.data.doc })).s === 200);
  }
  console.log('ALL PASS');
})();
