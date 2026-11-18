// 👥 그룹(TFT) API (v13.535) — 만들기(대화방 함께) · 구성원 바꾸면 방도 · 이름 · 리더만 · 빠지기 · 보관 · 되살리기
var B = 'http://localhost:3000';
async function login(email) { var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) }); return (await r.json()).data.accessToken; }
function api(tok) { return async function (method, url, body) { var r = await fetch(B + url, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined }); var j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, d: j }; }; }
var ok = 0;
function check(n, c, x) { if (!c) { console.log('FAIL', n, JSON.stringify(x)); process.exit(1); } ok++; console.log('✔', n); }
function uid(me) { var u = me.d.data || me.d; return u.id || (u.user && u.user.id); }
(async function () {
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com')), L = api(await login('lee@t.com'));
  var aId = uid(await A('GET', '/api/auth/me')), kId = uid(await K('GET', '/api/auth/me')), lId = uid(await L('GET', '/api/auth/me'));
  var T = Date.now();
  check('이름 없이 400', (await A('POST', '/api/groups', { memberIds: [kId] })).s === 400);
  check('나만 400', (await A('POST', '/api/groups', { name: 'x', memberIds: [] })).s === 400);
  var g = await A('POST', '/api/groups', { name: '라인 증설 TFT ' + T, icon: '🏭', purpose: '2공장 라인 증설', memberIds: [kId, lId] });
  check('만들기 — 리더 포함 3명 · 대화방', g.s === 201 && g.d.data.members.length === 3 && g.d.data.ownerId === aId && g.d.data.roomId, g.d);
  var gid = g.d.data.id, rid = g.d.data.roomId;
  var lRoom = ((await L('GET', '/api/chat/rooms')).d.data || []).filter(function (r) { return r.id === rid; })[0];
  check('구성원 대화방 (🏭 이름)', lRoom && lRoom.kind === 'group' && lRoom.name === '🏭 라인 증설 TFT ' + T, lRoom);
  check('구성원도 그룹 목록에', (await K('GET', '/api/groups')).d.data.some(function (x) { return x.id === gid && x.ownerName; }));
  check('구성원은 못 고침', (await K('PUT', '/api/groups/' + gid, { name: 'x' })).s === 403);
  var up = await A('PUT', '/api/groups/' + gid, { name: '라인 TFT ' + T, memberIds: [aId, kId] });
  check('구성원 빼기 · 이름 바꾸기', up.s === 200 && up.d.data.members.length === 2 && up.d.data.name === '라인 TFT ' + T, up.d);
  check('빠진 사람 — 그룹 · 방에서 사라짐', !(await L('GET', '/api/groups')).d.data.some(function (x) { return x.id === gid; }) && !((await L('GET', '/api/chat/rooms')).d.data || []).some(function (r) { return r.id === rid; }));
  check('방 이름도 바뀜', ((await K('GET', '/api/chat/rooms')).d.data || []).filter(function (r) { return r.id === rid; })[0].name === '🏭 라인 TFT ' + T);
  await A('PUT', '/api/groups/' + gid, { memberIds: [aId, kId, lId] });
  check('다시 넣으면 방도 다시', ((await L('GET', '/api/chat/rooms')).d.data || []).some(function (r) { return r.id === rid; }));
  var msgs = (await A('GET', '/api/chat/rooms/' + rid + '/messages')).d.data || [];
  check('방에 구성원 바뀜 안내', msgs.some(function (m) { return m.kind === 'system' && /그룹 구성원을 바꿨습니다/.test(m.body); }));
  check('리더는 못 빠짐', (await A('POST', '/api/groups/' + gid + '/leave')).s === 409);
  check('구성원 빠지기', (await L('POST', '/api/groups/' + gid + '/leave')).s === 200 && !(await L('GET', '/api/groups')).d.data.some(function (x) { return x.id === gid; }));
  check('남 그룹 404', (await L('PUT', '/api/groups/' + gid, { name: 'x' })).s === 404);
  // 그룹 구성원에게 업무 요청 (화면은 그룹 단추로 모두 넣음 — 서버는 여러 명 그대로)
  var w = await A('POST', '/api/work-requests', { type: 'forward', title: 'TFT 공지 ' + T, toUserIds: (await A('GET', '/api/groups')).d.data.filter(function (x) { return x.id === gid; })[0].members.map(function (m) { return m.id; }) });
  check('그룹 구성원에게 업무 요청 (나는 빠짐)', w.s === 201 && w.d.data.length === 1 && w.d.data[0].toUserId === kId, w.d);
  check('보관', (await A('DELETE', '/api/groups/' + gid)).s === 200 && !(await A('GET', '/api/groups')).d.data.some(function (x) { return x.id === gid; }));
  check('보관 포함 목록', (await A('GET', '/api/groups?all=1')).d.data.some(function (x) { return x.id === gid && x.archived; }));
  check('되살리기', (await A('POST', '/api/groups/' + gid + '/restore')).s === 200 && (await A('GET', '/api/groups')).d.data.some(function (x) { return x.id === gid; }));
  await A('DELETE', '/api/groups/' + gid);
  console.log('\nALL PASS ' + ok);
})().catch(function (e) { console.log('ERR', e.stack || e.message); process.exit(1); });
