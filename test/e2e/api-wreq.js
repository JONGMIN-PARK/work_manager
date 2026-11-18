// 📨 업무 요청 (v13.525) — 보내기 · 메신저 카드 · 수락 → 할 일/일정 · 완료 전파 · 이관 · 반려 · 거두기 · 권한
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
function uidOf(me) { var u = me.d.data || me.d; return u.id || (u.user && u.user.id); }
(async function () {
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com'));
  var aId = uidOf(await A('GET', '/api/auth/me')), kId = uidOf(await K('GET', '/api/auth/me'));
  check('사용자 id', aId && kId && aId !== kId, [aId, kId]);
  var T = Date.now();
  var pr = await A('POST', '/api/projects', { name: '요청 시험 ' + T, visibility: 'private', checklists: false });
  var pid = pr.d.data.id;

  // 1. 검사
  check('종류 없음 400', (await A('POST', '/api/work-requests', { title: 'x', toUserIds: [kId] })).s === 400);
  check('받는 사람 나만 400', (await A('POST', '/api/work-requests', { type: 'order', title: 'x', toUserIds: [aId] })).s === 400);
  check('일정은 날짜 필수', (await A('POST', '/api/work-requests', { type: 'event', title: 'x', toUserIds: [kId] })).s === 400);
  check('못 보는 프로젝트 403', (await K('POST', '/api/work-requests', { type: 'order', title: 'x', toUserIds: [aId], projectId: pid })).s === 403);

  // 2. 업무 지시 → 메신저 카드
  var s1 = await A('POST', '/api/work-requests', { type: 'order', title: '도면 검토 ' + T, body: '3번 축 간섭 확인', dueDate: '2026-12-01', toUserIds: [kId], projectId: pid });
  check('지시 보냄', s1.s === 201 && s1.d.data.length === 1 && s1.d.data[0].projectName === '요청 시험 ' + T, s1.d);
  var w1 = s1.d.data[0];
  check('메신저 메시지 연결', !!w1.chatMsgId);
  var rooms = (await K('GET', '/api/chat/rooms')).d.data || [];
  var dm = rooms.filter(function (r) { return r.peerId === aId; })[0];
  check('받는 사람 1:1 방', !!dm, rooms.map(function (r) { return r.kind; }));
  var msgs = (await K('GET', '/api/chat/rooms/' + dm.id + '/messages')).d.data || [];
  var card = msgs.filter(function (m) { return m.wreq && m.wreq.id === w1.id; })[0];
  check('카드(wreq) 실림 · 상태 sent', card && card.wreq.status === 'sent' && card.wreq.type === 'order' && card.wreq.due === '2026-12-01', card && card.wreq);
  check('받은 요청 수 1+', (await K('GET', '/api/work-requests/count')).d.count >= 1);
  var inbox = (await K('GET', '/api/work-requests?box=in&open=1')).d.data;
  check('받은 요청 목록', inbox.some(function (x) { return x.id === w1.id && x.fromName; }));
  check('보낸 요청 목록', (await A('GET', '/api/work-requests?box=out')).d.data.some(function (x) { return x.id === w1.id && x.toName; }));

  // 3. 권한 — 보낸 사람이 수락 못 함 · 남이 거두지 못 함
  check('보낸 사람이 수락 → 404', (await A('POST', '/api/work-requests/' + w1.id + '/accept')).s === 404);
  check('받은 사람이 거두기 → 404', (await K('POST', '/api/work-requests/' + w1.id + '/cancel')).s === 404);

  // 4. 수락 → 할 일 · 두 번 수락 409
  var ac = await K('POST', '/api/work-requests/' + w1.id + '/accept');
  check('수락 → 할 일', ac.s === 200 && /^todo:/.test(ac.d.data.resultKey) && ac.d.data.status === 'accepted', ac.d);
  check('두 번 수락 409', (await K('POST', '/api/work-requests/' + w1.id + '/accept')).s === 409);
  var todoId = ac.d.data.resultKey.slice(5);
  var mw = (await K('GET', '/api/my-work')).d;
  var items = (mw.data && mw.data.items) || mw.items || mw.data || [];
  var td = (Array.isArray(items) ? items : []).filter(function (x) { return x.id === todoId; })[0];
  check('내 할 일에 들어감 (마감 · 메모)', !!td && (td.due === '2026-12-01' || td.dueDate === '2026-12-01') && /업무 지시/.test(JSON.stringify(td)), td);
  msgs = (await K('GET', '/api/chat/rooms/' + dm.id + '/messages')).d.data || [];
  card = msgs.filter(function (m) { return m.wreq && m.wreq.id === w1.id; })[0];
  check('카드 상태 accepted', card.wreq.status === 'accepted', card.wreq);
  check('방에 수락 한 줄', msgs.some(function (m) { return m.kind === 'system' && /수락/.test(m.body); }));

  // 5. 할 일 끝내면 요청 완료 → 되돌리면 다시 수락
  await K('PUT', '/api/my-work/todos/' + todoId, { done: true });
  var o1 = (await A('GET', '/api/work-requests?box=out')).d.data.filter(function (x) { return x.id === w1.id; })[0];
  check('할 일 완료 → 요청 완료', o1.status === 'done', o1);
  await K('PUT', '/api/my-work/todos/' + todoId, { done: false });
  o1 = (await A('GET', '/api/work-requests?box=out')).d.data.filter(function (x) { return x.id === w1.id; })[0];
  check('완료 되돌림 → 수락', o1.status === 'accepted', o1);
  await K('PUT', '/api/my-work/done', { src: 'todo', id: todoId, done: true });
  o1 = (await A('GET', '/api/work-requests?box=out')).d.data.filter(function (x) { return x.id === w1.id; })[0];
  check('내 업무 ✅(done 경로) → 요청 완료', o1.status === 'done', o1);

  // 6. 이관 — 내 할 일을 보내고, 수락되면 내 원래 할 일이 닫힘
  var mine = await A('POST', '/api/my-work/todos', { title: '견적서 보내기 ' + T, dueDate: '2026-12-05' });
  var s2 = await A('POST', '/api/work-requests', { type: 'transfer', title: mine.d.data.title, toUserIds: [kId], srcKey: 'todo:' + mine.d.data.id, dueDate: '2026-12-05' });
  check('이관 보냄', s2.s === 201, s2.d);
  check('이관 여러 명 400', (await A('POST', '/api/work-requests', { type: 'transfer', title: 'x', toUserIds: [kId, kId + 'x'] })).s >= 400);
  await K('POST', '/api/work-requests/' + s2.d.data[0].id + '/accept');
  var src = (await A('GET', '/api/my-work')).d;
  var srcItems = (src.data && src.data.items) || src.items || src.data || [];
  var st = (Array.isArray(srcItems) ? srcItems : []).filter(function (x) { return x.id === mine.d.data.id; })[0];
  check('이관 수락 → 내 원래 할 일 닫힘', !!st && !!(st.done || st.doneAt), st);

  // 7. 일정 → 수락하면 일정
  var s3 = await A('POST', '/api/work-requests', { type: 'event', title: '현장 점검 ' + T, dueDate: '2026-12-10', dueTime: '10:00', endTime: '11:30', location: '2공장', toUserIds: [kId], projectId: pid });
  var a3 = await K('POST', '/api/work-requests/' + s3.d.data[0].id + '/accept');
  check('일정 수락 → event', /^event:/.test(a3.d.data.resultKey), a3.d);
  var evs = (await K('GET', '/api/my-work/events?from=2026-12-01&to=2026-12-31')).d;
  var evl = (evs && (evs.data || evs.events)) || [];
  check('받은 사람 일정에 보임', (Array.isArray(evl) ? evl : []).some(function (e) { return (e.title || '') === '현장 점검 ' + T && (e.startTime || e.start_time || '').indexOf('10:00') === 0; }), evl.slice ? evl.slice(0, 3) : evl);

  // 8. 반려 · 거두기 · 전달 바로 확인
  var s4 = await A('POST', '/api/work-requests', { type: 'todo', title: '자료 정리 ' + T, toUserIds: [kId] });
  var d4 = await K('POST', '/api/work-requests/' + s4.d.data[0].id + '/decline', { reply: '이번 주는 어려워요' });
  check('반려 + 사유', d4.d.data.status === 'declined' && d4.d.data.reply === '이번 주는 어려워요', d4.d);
  check('반려 뒤 수락 409', (await K('POST', '/api/work-requests/' + s4.d.data[0].id + '/accept')).s === 409);
  var s5 = await A('POST', '/api/work-requests', { type: 'order', title: '거둘 것 ' + T, toUserIds: [kId] });
  check('거두기', (await A('POST', '/api/work-requests/' + s5.d.data[0].id + '/cancel')).d.data.status === 'canceled');
  var s6 = await A('POST', '/api/work-requests', { type: 'forward', title: '회의록 공유 ' + T, toUserIds: [kId] });
  var d6 = await K('POST', '/api/work-requests/' + s6.d.data[0].id + '/done');
  check('전달 → 바로 확인(완료)', d6.d.data.status === 'done' && !d6.d.data.resultKey, d6.d);

  await A('DELETE', '/api/projects/' + pid);
  console.log('\nALL PASS ' + ok);
})().catch(function (e) { console.log('ERR', e.stack || e.message); process.exit(1); });
