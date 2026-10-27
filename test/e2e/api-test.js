// 마인드맵 API 권한·충돌 검증 (서버 :3000)
var B = 'http://localhost:3000';
var assert = require('assert');
async function login(email) {
  var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) });
  var j = await r.json();
  return j.data.accessToken;
}
function api(tok) {
  return async function (method, url, body) {
    var r = await fetch(B + url, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
    var j = null; try { j = await r.json(); } catch (_) {}
    return { s: r.status, d: j };
  };
}
var ok = 0;
function check(name, cond, extra) { assert.ok(cond, name + ' ' + JSON.stringify(extra || '')); ok++; console.log('✔', name); }

(async function () {
  var A = api(await login('admin@t.com'));
  var K = api(await login('kim@t.com'));
  var L = api(await login('lee@t.com'));
  var me = { a: (await A('GET', '/api/auth/me')).d.data, k: (await K('GET', '/api/auth/me')).d.data, l: (await L('GET', '/api/auth/me')).d.data };
  // v13.249: 모든 사용자가 쓴다 — 맵은 소유자와 보낸 사람만 봄
  check('관리자 · 팀원 모두 mindmapAccess=true', me.a.mindmapAccess === true && me.k.mindmapAccess === true && me.l.mindmapAccess === true);
  check('팀원 목록 200', (await K('GET', '/api/mindmaps')).s === 200);
  check('사용 권한 관리 API 없어짐', (await A('GET', '/api/mindmaps/access/users')).s === 404);

  // 김: 개인 맵 생성
  var c = await K('POST', '/api/mindmaps', { title: '김 개인맵', scope: 'personal' });
  check('개인 맵 생성 201', c.s === 201, c);
  var id = c.d.data.id;
  check('기본 doc 중심 주제', c.d.data.doc.sheets[0].root.text === '김 개인맵');
  // 관리자는 남의 개인 맵 못 봄
  check('관리자 남의 개인 맵 404', (await A('GET', '/api/mindmaps/' + id)).s === 404);
  check('관리자 목록에 남의 개인 맵 없음', !(await A('GET', '/api/mindmaps')).d.data.some(function (m) { return m.id === id; }));
  // 조직 범위 맵이어도 소유자 · 보낸 사람만 봄 (관리자가 만든 조직 맵을 팀원이 못 봄)
  var om = (await A('POST', '/api/mindmaps', { title: '관리자 조직맵', scope: 'org' })).d.data;
  check('보내지 않은 맵은 다른 사람이 못 봄 (조직 범위여도)', (await K('GET', '/api/mindmaps/' + om.id)).s === 404 && !(await K('GET', '/api/mindmaps')).d.data.some(function (m) { return m.id === om.id; }));
  await A('DELETE', '/api/mindmaps/' + om.id);

  // 저장 + 충돌
  var doc = c.d.data.doc;
  doc.sheets[0].root.children.push({ id: 'n-a', text: 'A', children: [], progress: 0 });
  var s1 = await K('PUT', '/api/mindmaps/' + id, { version: 1, doc: doc });
  check('저장 200 version 2', s1.s === 200 && s1.d.data.version === 2, s1);
  var s2 = await K('PUT', '/api/mindmaps/' + id, { version: 1, doc: doc });
  check('옛 version 저장 409', s2.s === 409 && s2.d.error === 'CONFLICT', s2);
  var got = (await K('GET', '/api/mindmaps/' + id)).d.data;
  check('progress 0 보존 · node_count 2', got.doc.sheets[0].root.children[0].progress === 0 && got.node_count === 2, got.node_count);
  check('잘못된 doc 400', (await K('PUT', '/api/mindmaps/' + id, { version: 2, doc: { sheets: [{ root: { text: 'no id' } }] } })).s === 400);

  // 보내기: 없는 사람 id 는 빠짐
  var sh = await K('PUT', '/api/mindmaps/' + id, { version: 2, editors: ['00000000-0000-0000-0000-0000000000ff'] });
  check('없는 사람은 보낼 목록에서 제외', sh.s === 200 && sh.d.data.editors.length === 0, sh);
  check('보내기 전 이팀원은 못 봄', (await L('GET', '/api/mindmaps/' + id)).s === 404);
  var sh2 = await K('PUT', '/api/mindmaps/' + id, { version: 3, viewers: [me.l.id] });
  check('보기 공유', sh2.s === 200 && sh2.d.data.viewers[0] === me.l.id, sh2);
  var lr = await L('GET', '/api/mindmaps/' + id);
  check('보기 공유 받은 사람 읽기 · can_edit=false', lr.s === 200 && lr.d.data.can_edit === false);
  check('보기 공유 받은 사람 저장 403', (await L('PUT', '/api/mindmaps/' + id, { version: 4, doc: doc })).s === 403);
  check('공유 받은 사람 공유 설정 변경 불가', (await L('PUT', '/api/mindmaps/' + id, { version: 4, viewers: [] })).s === 403);
  check('공유 받은 사람 삭제 불가', (await L('DELETE', '/api/mindmaps/' + id)).s === 403);
  await K('PUT', '/api/mindmaps/' + id, { version: 4, editors: [me.l.id], viewers: [] });
  var le = await L('PUT', '/api/mindmaps/' + id, { version: 5, doc: doc });
  check('편집 공유 받은 사람 저장 200', le.s === 200, le);
  // 즐겨찾기는 version 안 올림
  await L('PUT', '/api/mindmaps/' + id + '/pin', { pinned: true });
  var after = (await K('GET', '/api/mindmaps/' + id)).d.data;
  check('즐겨찾기는 version 유지', after.version === 6 && after.pinned_by.indexOf(me.l.id) >= 0, after.version);
  // 복제는 내 개인 맵으로
  var dp = await L('POST', '/api/mindmaps/' + id + '/duplicate', {});
  check('복제 → 내 개인 맵', dp.s === 201 && dp.d.data.owner_id === me.l.id && dp.d.data.scope === 'personal');
  check('관리자도 받지 않은 맵은 못 봄', (await A('GET', '/api/mindmaps/' + id)).s === 404);
  check('소유자 삭제', (await K('DELETE', '/api/mindmaps/' + id)).s === 200);
  check('삭제 후 404', (await L('GET', '/api/mindmaps/' + id)).s === 404);
  console.log('\nALL PASS', ok);
})().catch(function (e) { console.error('FAIL', e.message); process.exit(1); });
