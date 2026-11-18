// 🤝 같이 담당(v13.533) · 함께 하기(v13.534) API
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
function uid(me) { var u = me.d.data || me.d; return u.id || (u.user && u.user.id); }
function kstToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
(async function () {
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com')), L = api(await login('lee@t.com'));
  var aId = uid(await A('GET', '/api/auth/me')), kId = uid(await K('GET', '/api/auth/me')), lId = uid(await L('GET', '/api/auth/me'));
  var T = Date.now();
  var mw = async function (X) { var r = (await X('GET', '/api/my-work')).d; return (r.data || r.items || []); };
  var find = function (list, id) { return list.filter(function (x) { return x.src === 'todo' && x.id === id; })[0]; };

  // ── 같이 담당 ──
  var t1 = (await A('POST', '/api/my-work/todos', { title: '같이 할 일 ' + T, dueDate: '2026-12-01' })).d.data;
  check('남은 같이 담당 못 정함', (await K('PUT', '/api/my-work/todos/' + t1.id + '/partners', { userIds: [kId] })).s === 404);
  var p1 = await A('PUT', '/api/my-work/todos/' + t1.id + '/partners', { userIds: [kId, aId, kId] });
  check('같이 담당 더하기 (주인 · 중복 빼고)', p1.s === 200 && p1.d.data.partners.length === 1 && p1.d.data.partners[0] === kId, p1.d);
  var kt = find(await mw(K), t1.id);
  check('같이 담당 내 업무에 보임 (주인 표시)', kt && kt.isOwner === false && kt.ownerId === aId && kt.ownerName && kt.partners.length === 1, kt);
  var at = find(await mw(A), t1.id);
  check('주인 쪽도 같이 담당 표시', at && at.isOwner === true && at.partners[0].id === kId, at);
  var rooms = (await K('GET', '/api/chat/rooms')).d.data || [];
  var dm = rooms.filter(function (r) { return r.peerId === aId; })[0];
  var msgs = dm ? (await K('GET', '/api/chat/rooms/' + dm.id + '/messages')).d.data || [] : [];
  check('같이 담당 알림 (1:1 메신저)', msgs.some(function (m) { return /같이 담당해요/.test(m.body) && m.body.indexOf('같이 할 일 ' + T) >= 0; }));
  check('같이 담당이 고치기', (await K('PUT', '/api/my-work/todos/' + t1.id, { title: '같이 할 일 ' + T + ' (수정)' })).s === 200);
  check('같이 담당이 마감 바꾸기', (await K('PUT', '/api/my-work/due', { src: 'todo', id: t1.id, due: '2026-12-02' })).s === 200 && find(await mw(A), t1.id).due === '2026-12-02');
  check('같이 담당은 휴지통 못 보냄', (await K('DELETE', '/api/my-work/todos/' + t1.id)).s === 404);
  await K('PUT', '/api/my-work/done', { src: 'todo', id: t1.id, done: true });
  check('같이 담당이 끝내면 주인도 완료', find(await mw(A), t1.id).done === true);
  await A('PUT', '/api/my-work/todos/' + t1.id, { done: false });
  await A('PUT', '/api/my-work/todos/' + t1.id + '/partners', { userIds: [kId, lId] });
  check('같이 담당은 남을 못 뺌', (await K('PUT', '/api/my-work/todos/' + t1.id + '/partners', { userIds: [kId] })).s === 403);
  check('나 빠지기', (await K('PUT', '/api/my-work/todos/' + t1.id + '/partners', { userIds: [lId] })).s === 200 && !find(await mw(K), t1.id));
  check('다른 회사 · 없는 사람 400', (await A('PUT', '/api/my-work/todos/' + t1.id + '/partners', { userIds: ['00000000-0000-0000-0000-000000000000'] })).s === 400);
  // 반복 — 같이 담당이 끝내도 다음 회차는 주인 것 + 같이 담당 그대로
  var t2 = (await A('POST', '/api/my-work/todos', { title: '매일 점검 ' + T, dueDate: '2026-12-01', repeat: 'daily' })).d.data;
  await A('PUT', '/api/my-work/todos/' + t2.id + '/partners', { userIds: [kId] });
  var dn = await K('PUT', '/api/my-work/todos/' + t2.id, { done: true });
  var nx = dn.d.nextRow;
  check('반복 — 다음 회차 주인 · 같이 담당 유지', nx && nx.user_id === aId && (nx.partners || []).indexOf(kId) >= 0 && nx.due_date === '2026-12-02', nx);
  // 업무 요청 받은 할 일을 같이 담당이 끝내도 요청 완료
  var w = (await A('POST', '/api/work-requests', { type: 'order', title: '요청 같이 ' + T, toUserIds: [kId] })).d.data[0];
  var acc = (await K('POST', '/api/work-requests/' + w.id + '/accept')).d.data;
  var wt = acc.resultKey.slice(5);
  await K('PUT', '/api/my-work/todos/' + wt + '/partners', { userIds: [lId] });
  await L('PUT', '/api/my-work/done', { src: 'todo', id: wt, done: true });
  check('받은 요청 — 같이 담당이 끝내도 보낸 사람에게 완료', (await A('GET', '/api/work-requests?box=out')).d.data.filter(function (x) { return x.id === w.id; })[0].status === 'done');

  // ── 함께 하기 ──
  check('사람 없이 400', (await A('POST', '/api/pair', { title: 'x', userIds: [] })).s === 400);
  var t3 = (await A('POST', '/api/my-work/todos', { title: '지그 디버깅 ' + T })).d.data;
  var s1 = await A('POST', '/api/pair', { title: '지그 디버깅 ' + T, userIds: [kId], itemKey: 'todo:' + t3.id });
  check('함께 하기 시작 — 방 · 메모', s1.s === 201 && s1.d.data.roomId && s1.d.data.docId && s1.d.data.members.length === 2, s1.d);
  var sid = s1.d.data.id;
  var ka = (await K('GET', '/api/pair?active=1')).d.data;
  check('초대받은 사람 진행 중 목록 (아직 참여 전)', ka.some(function (s) { return s.id === sid && s.members.some(function (m) { return m.id === kId && !m.joined; }); }));
  var doc = await K('GET', '/api/chat/docs/' + s1.d.data.docId);
  check('📝 공동 메모 — 함께 고칠 수 있음', doc.s === 200 && /## 메모/.test(JSON.stringify(doc.d)), doc.s);
  check('참여', (await K('POST', '/api/pair/' + sid + '/join')).d.data.members.every(function (m) { return m.joined; }));
  check('남은 못 끝냄', (await L('POST', '/api/pair/' + sid + '/end', {})).s === 404);
  var e1 = await K('POST', '/api/pair/' + sid + '/end', { summary: '원인 찾음 — 내일 지그 수정', addPartners: true });
  check('끝내기 — 걸린 시간', e1.s === 200 && e1.d.data.minutes >= 1 && e1.d.data.endedAt, e1.d);
  check('두 번 끝내기 409', (await A('POST', '/api/pair/' + sid + '/end', {})).s === 409);
  await new Promise(function (r) { setTimeout(r, 500); });
  var nA = (await A('GET', '/api/my-work/notes?date=' + kstToday())).d.data.notes, nK = (await K('GET', '/api/my-work/notes?date=' + kstToday())).d.data.notes;
  var has = function (ns) { return ns.some(function (n) { return n.ref === '' && n.body.indexOf('지그 디버깅 ' + T) >= 0 && /원인 찾음/.test(n.body) && /🤝 \d\d:\d\d~\d\d:\d\d \(\d+분\)/.test(n.body); }); };
  check('참여자 모두 그날 노트에 한 줄', has(nA) && has(nK));
  var t3b = find(await mw(A), t3.id);
  check('연결된 할 일 — 메모에 기록 · 같이 담당으로', t3b && /원인 찾음/.test(t3b.memo || '') && (t3b.partners || []).some(function (p) { return p.id === kId; }), t3b);
  check('끝난 뒤 진행 중 목록에서 빠짐 · 기록엔 있음', !(await K('GET', '/api/pair?active=1')).d.data.some(function (s) { return s.id === sid; }) && (await K('GET', '/api/pair')).d.data.some(function (s) { return s.id === sid && s.summary; }));
  // 여럿이면 그룹 방
  var s2 = await A('POST', '/api/pair', { title: '셋이 검토 ' + T, userIds: [kId, lId] });
  var lr = ((await L('GET', '/api/chat/rooms')).d.data || []).filter(function (r) { return r.id === s2.d.data.roomId; })[0];
  check('여럿 — 그룹 방 (이름 🤝)', lr && lr.kind === 'group' && /🤝 셋이 검토/.test(lr.name), lr);
  await L('POST', '/api/pair/' + s2.d.data.id + '/end', {});

  // 정리
  for (var id of [t1.id, t2.id, t3.id]) await A('DELETE', '/api/my-work/todos/' + id);
  if (nx) await A('DELETE', '/api/my-work/todos/' + nx.id);
  console.log('\nALL PASS ' + ok);
})().catch(function (e) { console.log('ERR', e.stack || e.message); process.exit(1); });
