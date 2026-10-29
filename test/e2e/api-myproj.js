// 내 업무 📁 내 프로젝트 API — 단독 만들기 · 고치기 · 본인만 · 할 일 소속 · 연계(후보 · 기간 · 마일스톤 · 권한 · 중복) · 빼기 표시 · 지우기 · 되살리기 · 순서 (v13.273)
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var B = 'http://localhost:3000';
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
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
function check(name, c, x) { if (!c) { console.log('FAIL', name, JSON.stringify(x, null, 1).slice(0, 1500)); throw new Error('FAIL ' + name); } n++; console.log('✔', name); }
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }

(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var U = {};
  (await c.query("SELECT id, email, name, tenant_id FROM users WHERE email IN ('admin@t.com','kim@t.com','lee@t.com')")).rows.forEach(function (r) { U[r.email.split('@')[0]] = r; });
  var tid = U.kim.tenant_id, kim = U.kim.id, lee = U.lee.id, adm = U.admin.id;
  async function clean() {
    await c.query('DELETE FROM my_work_marks WHERE user_id = ANY($1) AND project_id IS NOT NULL', [[kim, lee, adm]]);
    await c.query('DELETE FROM my_projects WHERE user_id = ANY($1)', [[kim, lee, adm]]);
    await c.query("DELETE FROM my_todos WHERE title LIKE 'MP %'");
    await c.query("DELETE FROM milestone_assignments WHERE milestone_id LIKE 'mp-%'");
    await c.query("DELETE FROM milestones WHERE id LIKE 'mp-%'");
    await c.query("DELETE FROM project_members WHERE project_id LIKE 'mp-%'");
    await c.query("DELETE FROM projects WHERE id LIKE 'mp-%'");
  }
  await clean();
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com')), L = api(await login('lee@t.com'));
  try {
    var d0 = kst(0);
    // ── 1. 처음엔 없음 ──
    var mine = (await K('GET', '/api/my-work')).d;
    check('내 업무에 projs · projCands 가 옴', Array.isArray(mine.projs) && mine.projs.length === 0 && Array.isArray(mine.projCands), mine.projs);

    // ── 2. 단독 만들기 ──
    var p = await K('POST', '/api/my-work/projects', { title: 'MP 홈페이지 개편', startDate: d0, endDate: kst(30), color: 'teal', icon: '🌐', memo: '목표: 11월 오픈' });
    check('단독 프로젝트 만들기', p.s === 201 && p.d.data.title === 'MP 홈페이지 개편' && p.d.data.start === d0 && p.d.data.end === kst(30) && p.d.data.status === 'doing' && p.d.data.visible === true && p.d.data.link === null, p.d);
    var pid = p.d.data.id;
    check('이름 없으면 400', (await K('POST', '/api/my-work/projects', { title: '  ' })).s === 400);
    check('끝이 시작보다 앞이면 400', (await K('POST', '/api/my-work/projects', { title: 'MP x', startDate: kst(5), endDate: kst(1) })).s === 400);
    var p2 = (await K('POST', '/api/my-work/projects', { title: 'MP 둘째' })).d.data;
    check('둘째는 뒤 순서', p2.order === p.d.data.order + 1, p2);

    // ── 3. 고치기 ──
    var u = await K('PUT', '/api/my-work/projects/' + pid, { status: 'hold', visible: false, progress: 40, color: 'nope' });
    check('상태 · 보이기 · 진행률 고치기 (모르는 색은 없음으로)', u.s === 200 && u.d.data.status === 'hold' && u.d.data.visible === false && u.d.data.progress === 40 && u.d.data.color === null, u.d);
    check('진행률 150 → 400', (await K('PUT', '/api/my-work/projects/' + pid, { progress: 150 })).s === 400);
    check('모르는 상태 → 400', (await K('PUT', '/api/my-work/projects/' + pid, { status: 'x' })).s === 400);
    check('진행률 비우면 자동(null)', (await K('PUT', '/api/my-work/projects/' + pid, { progress: null })).d.data.progress === null);
    var sw = await K('PUT', '/api/my-work/projects/' + pid, { startDate: kst(40) });
    check('시작을 끝 뒤로 옮기면 끝도 같이', sw.d.data.start === kst(40) && sw.d.data.end === kst(40), sw.d.data);
    await K('PUT', '/api/my-work/projects/' + pid, { startDate: d0, endDate: kst(30) });

    // ── 4. 본인만 ──
    check('다른 사람은 고칠 수 없음 (404)', (await L('PUT', '/api/my-work/projects/' + pid, { title: '해킹' })).s === 404);
    check('다른 사람은 지울 수 없음 (404)', (await L('DELETE', '/api/my-work/projects/' + pid)).s === 404);
    check('다른 사람 목록엔 없음', (await L('GET', '/api/my-work/projects')).d.data.length === 0);
    check('관리자가 김 업무를 봐도 프로젝트는 안 줌', (await A('GET', '/api/my-work?userId=' + kim)).d.projs.length === 0);

    // ── 5. 할 일 소속 ──
    var t = await K('POST', '/api/my-work/todos', { title: 'MP 시안 검토', dueDate: kst(3), myProjectId: pid });
    check('프로젝트에 바로 할 일 추가', t.s === 201 && t.d.data.my_project_id === pid, t.d);
    var t2 = (await K('POST', '/api/my-work/todos', { title: 'MP 남의 프로젝트로', myProjectId: 'mprj-nope' })).d.data;
    check('남의 · 없는 프로젝트면 그냥 할 일로', !t2.my_project_id);
    await K('PUT', '/api/my-work/done', { src: 'todo', id: t2.id, done: true });
    await K('PUT', '/api/my-work/mark', { key: 'todo:' + t2.id, project: pid });
    mine = (await K('GET', '/api/my-work')).d;
    var it1 = mine.data.filter(function (x) { return x.id === t.d.data.id; })[0];
    var pp = mine.projs.filter(function (x) { return x.id === pid; })[0];
    check('목록 항목에 proj · 프로젝트에 할 일 수(끝낸 것 포함)', it1.proj === pid && pp.todoN === 2 && pp.todoDone === 1, { it1: it1, pp: pp });
    var lp = (await L('POST', '/api/my-work/projects', { title: 'MP 이팀원 것' })).d.data;
    check('남의 프로젝트로 표시 → 404', (await K('PUT', '/api/my-work/mark', { key: 'todo:' + t.d.data.id, project: lp.id })).s === 404);
    check("'-' (연계에서 빼기) 표시는 됨", (await K('PUT', '/api/my-work/mark', { key: 'mindmap:x:y', project: '-' })).d.data.project === '-');
    check('표시 풀기 (null)', (await K('PUT', '/api/my-work/mark', { key: 'todo:' + t2.id, project: null })).d.data.project === null);
    check('지운 할 일은 수에서 빠짐', (await K('DELETE', '/api/my-work/todos/' + t.d.data.id)).s === 200 &&
      (await K('GET', '/api/my-work/projects')).d.data.filter(function (x) { return x.id === pid; })[0].todoN === 0);

    // ── 6. 연계 ──
    await c.query("INSERT INTO projects (id, name, start_date, end_date, status, progress, color, visibility, owner_id, tenant_id) VALUES " +
      "('mp-p1', 'MP 설비 A', $1, $2, 'active', 35, '#10B981', 'private', $3, $4), ('mp-p2', 'MP 비공개', $1, $2, 'active', 0, null, 'private', $3, $4), ('mp-p3', 'MP 공개', null, null, 'active', 0, null, 'tenant', $3, $4)",
      [kst(-10), kst(60), adm, tid]);
    await c.query("INSERT INTO project_members (project_id, user_id, role, tenant_id) VALUES ('mp-p1', $1, 'assignee', $2)", [kim, tid]);
    await c.query("INSERT INTO milestones (id, project_id, name, end_date, status, tenant_id) VALUES ('mp-ms1', 'mp-p1', 'MP 설계 완료', $1, 'progress', $2), ('mp-ms2', 'mp-p2', 'MP 숨은 마일스톤', $1, 'progress', $2)", [kst(7), tid]);
    var cands = (await K('GET', '/api/my-work/projects')).d.cands;
    check('연계 후보 — 멤버인 프로젝트만', cands.some(function (x) { return x.id === 'mp-p1'; }) && !cands.some(function (x) { return x.id === 'mp-p2' || x.id === 'mp-p3'; }), cands);
    var lk = await K('POST', '/api/my-work/projects', { linkProjectId: 'mp-p1' });
    var L1 = lk.d && lk.d.data;
    check('연계 — 이름 · 기간 · 진행률 · 마일스톤을 프로젝트 관리에서', lk.s === 201 && L1.title === 'MP 설비 A' && L1.link === 'mp-p1' && L1.start === kst(-10) && L1.end === kst(60) &&
      L1.progress === 35 && L1.linkInfo.name === 'MP 설비 A' && L1.linkInfo.canEdit === true && L1.linkInfo.ms.length === 1 && L1.linkInfo.ms[0].name === 'MP 설계 완료', lk.d);
    check('연결하면 후보에서 빠짐', !(await K('GET', '/api/my-work/projects')).d.cands.some(function (x) { return x.id === 'mp-p1'; }));
    check('같은 프로젝트 또 연결 → 409', (await K('POST', '/api/my-work/projects', { linkProjectId: 'mp-p1' })).s === 409);
    check('볼 수 없는 프로젝트 연결 → 403', (await K('POST', '/api/my-work/projects', { linkProjectId: 'mp-p2' })).s === 403);
    check('없는 프로젝트 연결 → 404', (await K('POST', '/api/my-work/projects', { linkProjectId: 'mp-none' })).s === 404);
    var pick = (await K('GET', '/api/my-work/projects/pick?q=' + encodeURIComponent('MP'))).d.data;
    check('고르기 — 볼 수 있는 것만 (멤버 · 공개)', pick.some(function (x) { return x.id === 'mp-p1'; }) && pick.some(function (x) { return x.id === 'mp-p3'; }) && !pick.some(function (x) { return x.id === 'mp-p2'; }), pick);
    check('고르기 — % 는 글자로', (await K('GET', '/api/my-work/projects/pick?q=%25')).d.data.length === 0);
    // 단독 → 연결 · 다른 것과 겹치면 409
    var ln = await K('PUT', '/api/my-work/projects/' + p2.id, { linkProjectId: 'mp-p3' });
    check('있던 프로젝트를 연결 (기간 없으면 내 것 그대로)', ln.s === 200 && ln.d.data.link === 'mp-p3' && ln.d.data.linkInfo.name === 'MP 공개' && ln.d.data.title === 'MP 둘째', ln.d);
    check('다른 내 프로젝트가 이미 연결한 것 → 409', (await K('PUT', '/api/my-work/projects/' + pid, { linkProjectId: 'mp-p1' })).s === 409);
    // 권한이 사라지면 잠김
    await c.query("DELETE FROM project_members WHERE project_id = 'mp-p1'");
    var gone = (await K('GET', '/api/my-work/projects')).d.data.filter(function (x) { return x.link === 'mp-p1'; })[0];
    check('멤버에서 빠지면 연계 정보 잠김 (이름 · 마일스톤 안 줌)', gone.linkInfo.locked && !gone.linkInfo.name && !gone.linkInfo.ms && gone.title === 'MP 설비 A', gone);
    check('연결 끊기', (await K('PUT', '/api/my-work/projects/' + gone.id, { linkProjectId: null })).d.data.link === null);

    // ── 7. 지우기 · 되살리기 · 순서 ──
    check('지우기', (await K('DELETE', '/api/my-work/projects/' + pid)).s === 200 && !(await K('GET', '/api/my-work/projects')).d.data.some(function (x) { return x.id === pid; }));
    check('지운 프로젝트로 표시 → 404', (await K('PUT', '/api/my-work/mark', { key: 'todo:' + t2.id, project: pid })).s === 404);
    var rs = await K('POST', '/api/my-work/projects/' + pid + '/restore');
    check('되살리기', rs.s === 200 && rs.d.data.id === pid && rs.d.data.title === 'MP 홈페이지 개편', rs.d);
    var ids = (await K('GET', '/api/my-work/projects')).d.data.map(function (x) { return x.id; }).reverse();
    check('순서 바꾸기', (await K('PUT', '/api/my-work/projects-order', { ids: ids })).s === 200 &&
      (await K('GET', '/api/my-work/projects')).d.data.map(function (x) { return x.id; }).join() === ids.join());
    console.log('\nALL PASS', n);
  } catch (e) {
    console.log(e.message);
  } finally {
    await clean();
    await c.end();
  }
})();
