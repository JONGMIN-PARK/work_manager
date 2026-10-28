// 반응 속도 개선 (v13.258) — refresh 가 내 정보 함께 · 썸네일 묶음 /projects/covers · 업무일지 바뀐 것만 /records/sync · 한 번에 넣는 /records/bulk
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var B = 'http://localhost:3000';
var assert = require('assert');
async function login(email) {
  var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) });
  return (await r.json()).data;
}
function api(tok) {
  return async function (method, url, body) {
    var r = await fetch(B + url, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
    var j = null; try { j = await r.json(); } catch (_) {}
    return { s: r.status, d: j };
  };
}
async function refresh(tok) {
  var r = await fetch(B + '/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: tok }) });
  var j = null; try { j = await r.json(); } catch (_) {}
  return { s: r.status, d: j };
}
var ok = 0;
function check(name, cond, extra) { assert.ok(cond, name + ' ' + JSON.stringify(extra || '')); ok++; console.log('✔', name); }

(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var la = await login('admin@t.com'), lk = await login('kim@t.com');
  var A = api(la.accessToken), K = api(lk.accessToken);
  var me = (await A('GET', '/api/auth/me')).d.data;

  // ── refresh: 내 정보 함께 · 토큰 로테이션 그대로
  var r1 = await refresh(la.refreshToken);
  check('refresh 200 + 내 정보', r1.s === 200 && r1.d.data.user && r1.d.data.user.id === me.id, r1.d);
  check('refresh 내 정보 = /me (권한 칸)', r1.d.data.user.role === me.role && r1.d.data.user.mindmapAccess === me.mindmapAccess && r1.d.data.user.operatorMode === me.operatorMode && Array.isArray(r1.d.data.user.plProjects));
  check('refresh 새 access 토큰 사용 가능', (await api(r1.d.data.accessToken)('GET', '/api/auth/me')).s === 200);
  check('쓴 refresh 토큰 다시 쓰면 401', (await refresh(la.refreshToken)).s === 401);
  check('새 refresh 토큰은 됨', (await refresh(r1.d.data.refreshToken)).s === 200);
  check('엉터리 토큰 401 INVALID_TOKEN', (await refresh('nope')).d.error === 'INVALID_TOKEN');

  // ── 썸네일 묶음 — 볼 수 있는 프로젝트의 첫 이미지만
  var tid = me.tenantId || me.tenant_id || (await c.query("SELECT tenant_id FROM users WHERE id = $1", [me.id])).rows[0].tenant_id;
  await c.query("DELETE FROM projects WHERE id LIKE 'spd-%'");
  await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('spd-pub', '공개 썸네일', 'active', 'tenant', $1, $2), ('spd-priv', '비공개 썸네일', 'active', 'private', $1, $2)", [me.id, tid]);
  var px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  check('이미지 등록', (await A('POST', '/api/projects/spd-pub/images', { images: [{ src: px, caption: '첫' }, { src: px + '#2', caption: '둘' }] })).s < 300);
  await A('POST', '/api/projects/spd-priv/images', { images: [{ src: px }] });
  var cov = await A('GET', '/api/projects/covers');
  var mine = (cov.d.data || []).filter(function (x) { return x.project_id === 'spd-pub'; });
  check('covers — 프로젝트마다 하나', cov.s === 200 && mine.length === 1, cov.d);
  var first = (await A('GET', '/api/projects/spd-pub/images')).d.data[0];
  check('covers — 첫 이미지 번호', mine[0].id === first.id);
  var src = await A('GET', '/api/projects/covers?ids=' + mine[0].id);
  check('covers?ids — src', src.s === 200 && src.d.data.length === 1 && src.d.data[0].src === px);
  var kc = (await K('GET', '/api/projects/covers')).d.data || [];
  var privImg = (await A('GET', '/api/projects/spd-priv/images')).d.data[0].id;
  check('팀원 — 공개 프로젝트 보임 · 비공개는 안 보임', kc.some(function (x) { return x.project_id === 'spd-pub'; }) && !kc.some(function (x) { return x.project_id === 'spd-priv'; }));
  check('팀원 — 비공개 이미지 src 못 받음', ((await K('GET', '/api/projects/covers?ids=' + privImg)).d.data || []).length === 0);
  await c.query("DELETE FROM project_images WHERE project_id LIKE 'spd-%'");
  await c.query("DELETE FROM projects WHERE id LIKE 'spd-%'");

  // ── 업무일지 — 한 번에 넣기 · 바뀐 것만
  await c.query('DELETE FROM work_records WHERE tenant_id = $1', [tid]);
  var rec = function (i, extra) { return Object.assign({ date: '2026010' + i, name: '김철수', orderNo: 'S' + i, hours: i, taskType: '설계', abbr: 'AB', content: '내용 ' + i }, extra || {}); };
  var bk = await A('POST', '/api/archives/records/bulk', { records: [rec(1), rec(2), rec(3)] });
  check('bulk 3건 (한 문장)', bk.s === 201 && bk.d.count === 3, bk.d);
  var all = (await A('GET', '/api/archives/records?all=true&limit=100')).d.data;
  var byNo = {}; all.forEach(function (r) { byNo[r.order_no] = r; });
  check('bulk 값 그대로 (시간 숫자)', all.length === 3 && parseFloat(byNo.S2.hours) === 2 && byNo.S3.task_type === '설계');
  await c.query("UPDATE work_records SET milestone_id = 'ms-keep' WHERE id = $1", [byNo.S1.id]);
  var sy = await A('POST', '/api/archives/records/sync', {
    insert: [rec(4), rec(5, { ocmt: '수주명5' })],
    update: [{ id: byNo.S1.id, date: byNo.S1.date, name: '김철수', orderNo: 'S1', hours: 1, taskType: '제작', abbr: 'AB', content: '내용 1' }],
    deleteIds: [byNo.S2.id]
  });
  check('sync 200 — 넣은 행 id 포함', sy.s === 200 && sy.d.inserted.length === 2 && sy.d.inserted.every(function (x) { return x.id; }) && sy.d.updated === 1 && sy.d.deleted === 1, sy.d);
  var after = (await A('GET', '/api/archives/records?all=true&limit=100')).d.data;
  var an = {}; after.forEach(function (r) { an[r.order_no] = r; });
  check('sync 결과 — 4건 (1 수정 · 1 삭제 · 2 추가)', after.length === 4 && !an.S2 && an.S4 && an.S5 && an.S5.ocmt === '수주명5');
  check('sync 수정 반영 · 마일스톤 연결 유지', an.S1.task_type === '제작' && an.S1.milestone_id === 'ms-keep', an.S1);
  check('sync 안 건드린 행 그대로', an.S3.id === byNo.S3.id && an.S3.task_type === '설계');
  // 팀원은 관리자 레코드를 지우거나 고칠 수 없음 (범위 밖은 조용히 무시)
  var ks = await K('POST', '/api/archives/records/sync', { update: [{ id: an.S3.id, date: an.S3.date, name: 'x', orderNo: 'S3', hours: 9 }], deleteIds: [an.S4.id] });
  var after2 = (await A('GET', '/api/archives/records?all=true&limit=100')).d.data;
  check('팀원 sync — 남의 레코드 안 바뀜', (ks.s === 200 || ks.s === 403) && after2.length === 4 && after2.some(function (r) { return r.id === an.S3.id && r.name === '김철수'; }), ks.d);
  check('sync 잘못된 id → 오류 · 전부 롤백', (await A('POST', '/api/archives/records/sync', { insert: [rec(6)], deleteIds: ['abc'] })).s >= 400 && (await A('GET', '/api/archives/records?all=true&limit=100')).d.data.length === 4);
  await c.query('DELETE FROM work_records WHERE tenant_id = $1', [tid]);

  // ── 내 업무 · 업무 부하 (쿼리 동시 실행으로 바꾼 곳) 그대로 동작
  var mw = await A('GET', '/api/my-work');
  check('내 업무 200', mw.s === 200 && Array.isArray(mw.d.data), mw.d);
  var ld = await A('GET', '/api/my-work/load?weeks=4');
  check('업무 부하 200 — 4주 · 휴가 칸', ld.s === 200 && ld.d.data.weeks.length === 4 && ld.d.data.leaves && typeof ld.d.data.leaves === 'object', ld.d);
  check('남의 내 업무 403 그대로', (await K('GET', '/api/my-work?userId=' + me.id)).s === 403);

  await c.end();
  console.log('ALL PASS', ok);
})().catch(function (e) { console.error('FAIL', e.message); process.exit(1); });
