// 💬 메신저 고도화 (v13.366) — 관리자 · 김팀원
//   바뀐 것만 그리기(앞 메시지 노드 그대로) · ↓ 새 메시지 단추 · 읽음 숫자(모아 보내기) · 보내는 중/실패/다시 보내기 · 방마다 임시 글
//   · 방 목록 거르기 · 여기부터 안 읽음 줄 · Ctrl+K 방 이동 · Ctrl+F 이 방에서 찾기
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var kim = (await c.query("SELECT id FROM users WHERE email = 'kim@t.com'")).rows[0];
  await c.query('DELETE FROM chat_rooms WHERE tenant_id = $1', [adm.tenant_id]);
  require('fs').mkdirSync(SHOT, { recursive: true });

  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { d.accept(); });
    await p.setViewport({ width: 1500, height: 920 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    return { b: b, p: p };
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  function send(p, room, body) { return p.evaluate(function (r, t) { return apiFetch('/api/chat/rooms/' + r + '/messages', { method: 'POST', body: JSON.stringify({ body: t }) }).then(function (x) { return x.data.id; }); }, room, body); }

  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '품질팀', userIds: [uid] }) }).then(function (r) { return r.data.id; }); }, kim.id);
    for (var i = 1; i <= 40; i++) await send(k, room, '줄 채우기 메시지 ' + i + '\n둘째 줄');
    await a.click('#hdrMsgBtn'); await a.evaluate(function (r) { chatOpenRoom(r); }, room);
    check(await until(a, function () { return CX.info && document.querySelectorAll('#cxMsgs .cx-mw').length >= 40; }), '방 열림 — 메시지마다 감싼 노드(.cx-mw)');
    check(await until(a, function () { return document.querySelector('#cxMsgs .cx-unl'); }), '"여기부터 안 읽음" 줄');

    // ① 바뀐 것만 — 새 메시지가 와도 앞 노드는 그대로
    await a.evaluate(function () { document.querySelector('#cxMsgs .cx-mw')._keep = 1; var b = document.getElementById('cxMsgs'); b.scrollTop = b.scrollHeight; });
    await send(k, room, '새로 온 메시지 하나');
    check(await until(a, function () { return /새로 온 메시지 하나/.test(document.getElementById('cxMsgs').textContent); }), '새 메시지 덧붙음');
    check(await a.evaluate(function () { return document.querySelector('#cxMsgs .cx-mw')._keep === 1; }), '앞 메시지 노드는 다시 안 그림');

    // ② 위를 보고 있을 때 → ↓ 새 메시지 1개
    await a.evaluate(function () { document.getElementById('cxMsgs').scrollTop = 0; });
    await wait(300);
    await send(k, room, '위를 보는 동안 온 것');
    check(await until(a, function () { var b = document.getElementById('cxNewB'); return b && !b.hidden && /새 메시지 1개/.test(b.textContent); }), '↓ 새 메시지 1개 단추');
    await a.screenshot({ path: path.join(SHOT, 'e2e69-newbtn.png') });
    await a.click('#cxNewB');
    check(await until(a, function () { var b = document.getElementById('cxMsgs'); return b.scrollHeight - b.scrollTop - b.clientHeight < 80 && document.getElementById('cxNewB').hidden; }), '누르면 맨 아래 · 단추 사라짐');

    // ③ 읽음 숫자 — 내 메시지 1 → 김팀원이 읽으면 사라짐
    await a.focus('#cxIn'); await a.keyboard.type('읽음 숫자 확인'); await a.keyboard.press('Enter');
    check(await until(a, function () { var m = CX.msgs.filter(function (x) { return x.body === '읽음 숫자 확인'; }); return m.length === 1 && typeof m[0].id === 'number' && !document.querySelector('#cxMsgs .cx-pend'); }), '보내는 중 → 보냄 (한 번만)');
    var myId = await a.evaluate(function () { return CX.msgs.filter(function (x) { return x.body === '읽음 숫자 확인'; })[0].id; });
    check(await until(a, function (id) { var e = document.querySelector('#cxMsgs [data-un="' + id + '"]'); return e && e.textContent === '1'; }, myId), '안 읽은 사람 1');
    await k.click('#hdrMsgBtn'); await k.evaluate(function (r) { chatOpenRoom(r); }, room);
    check(await until(a, function (id) { var e = document.querySelector('#cxMsgs [data-un="' + id + '"]'); return e && e.textContent === ''; }, myId, 10000), '김팀원이 읽으면 숫자 사라짐 (모아 보낸 읽음)');

    // ④ 못 보냄 → ⚠ 다시 보내기
    await a.setRequestInterception(true);
    var block = true;
    var onReq = function (rq) { if (block && rq.method() === 'POST' && /\/api\/chat\/rooms\/[^/]+\/messages$/.test(rq.url())) rq.abort().catch(function () {}); else rq.continue().catch(function () {}); };
    a.on('request', onReq);
    await a.focus('#cxIn'); await a.keyboard.type('끊긴 동안 보낸 글'); await a.keyboard.press('Enter');
    check(await until(a, function () { return document.querySelector('#cxMsgs .cx-pend.failed [data-retry]'); }, null, 20000), '못 보냄 — ⚠ 다시 보내기');
    block = false;
    await a.evaluate(function () { document.querySelector('#cxMsgs .cx-pend.failed [data-retry]').click(); });
    check(await until(a, function () { return !document.querySelector('#cxMsgs .cx-pend') && CX.msgs.filter(function (x) { return x.body === '끊긴 동안 보낸 글'; }).length === 1; }, null, 10000), '다시 보내기 → 한 번 보냄');
    a.off('request', onReq); await a.setRequestInterception(false);

    // ⑤ 방마다 임시 글 · 거르기
    await a.focus('#cxIn'); await a.keyboard.type('나중에 마저 쓸 글');
    var dm = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: uid }) }).then(function (r) { return _cxLoadRooms().then(function () { chatOpenRoom(r.data.id); return r.data.id; }); }); }, kim.id);
    check(await until(a, function (r) { return CX.room === r && document.getElementById('cxIn') && document.getElementById('cxIn').value === ''; }, dm), '다른 방 — 입력칸 비어 있음');
    check(await until(a, function (r) { var b = document.querySelector('#cxRooms [data-room="' + r + '"] .cx-r-dr'); return b && /나중에 마저 쓸 글/.test(b.textContent); }, room), '방 목록에 ✏️ 임시 글');
    await a.click('#cxRf [data-rf="dm"]');
    check(await until(a, function (r) { return !document.querySelector('#cxRooms [data-room="' + r + '"]') && document.querySelectorAll('#cxRooms .cx-r').length === 1; }, room), '거르기 1:1 — 그룹 방 숨김');
    await a.click('#cxRf [data-rf="all"]');

    // ⑥ Ctrl+K 방 이동 → 임시 글 되살아남
    await a.keyboard.down('Control'); await a.keyboard.press('k'); await a.keyboard.up('Control');
    check(await until(a, function () { return document.querySelector('#chatQuickModal [data-q]'); }), 'Ctrl+K — 대화방 이동 창');
    await a.type('#chatQuickModal [data-q]', '품질');
    await a.keyboard.press('Enter');
    check(await until(a, function (r) { return CX.room === r && document.getElementById('cxIn') && document.getElementById('cxIn').value === '나중에 마저 쓸 글'; }, room), 'Enter 로 그 방 · 쓰다 만 글 되살아남');

    // ⑦ Ctrl+F 이 방에서 찾기 — 보낸 사람으로 거르기
    await a.evaluate(function () { document.getElementById('cxMsgs').focus(); });
    await a.keyboard.down('Control'); await a.keyboard.press('f'); await a.keyboard.up('Control');
    check(await until(a, function () { return document.querySelector('#cxFind [data-q]'); }), 'Ctrl+F — 찾기 띠');
    await a.type('#cxFind [data-q]', '줄 채우기 메시지 1');
    check(await until(a, function () { return document.querySelectorAll('#cxFind [data-res] [data-i]').length >= 2 && /건/.test(document.querySelector('#cxFind [data-n]').textContent); }), '찾은 것 목록 · 건수');
    await a.select('#cxFind [data-from]', adm.id);
    check(await until(a, function () { return /없음/.test(document.querySelector('#cxFind [data-n]').textContent); }), '보낸 사람 = 나 → 없음');
    await a.select('#cxFind [data-from]', '');
    await until(a, function () { return document.querySelectorAll('#cxFind [data-res] [data-i]').length >= 2; });
    await a.evaluate(function () { document.querySelector('#cxFind [data-res] [data-i]').click(); });
    check(await until(a, function () { return document.querySelector('#cxMsgs .cx-hl'); }), '누르면 그 메시지로 · 반짝');
    await a.screenshot({ path: path.join(SHOT, 'e2e69-find.png') });
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (A) await A.b.close(); if (K) await K.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
