// 💬 대화창 여러 개 (v13.447) — ① 대화 전용 화면 ② 새 창으로 떼어 내기 ③ 나란히 보기
//   관리자 본 창 + 떼어 낸 창 + 옆 칸, 그리고 김팀원(다른 브라우저)이 보내는 메시지
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
  function watch(p, tag) { p.on('pageerror', function (e) { errs.push(tag + ': ' + e.message); }); p.on('dialog', function (d) { d.accept(); }); p.on('console', function (m) { if (/\[chat\]|\[solo\]/.test(m.text())) console.log('CONSOLE', tag, m.text().slice(0, 300)); }); }
  async function open(email) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    watch(p, email);
    await p.setViewport({ width: 1500, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.waitForFunction(function () { return typeof CXS !== 'undefined' && CXS.on; }, { timeout: 10000 }).catch(function () {});
    return { b: b, p: p };
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 9000 }, arg).then(function () { return true; }, function () { return false; }); }
  function post(p, room, body) { return p.evaluate(function (room, body) { return apiFetch('/api/chat/rooms/' + room + '/messages', { method: 'POST', body: JSON.stringify({ body: body }) }).then(function () { return true; }, function () { return false; }); }, room, body); }

  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    // 방 3개: 1:1(김팀원) · 나에게 · 그룹
    var rooms = await a.evaluate(async function (kid) {
      var dm = (await apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: kid }) })).data.id;
      var self = (await apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'self' }) })).data.id;
      var grp = (await apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '셋업 TF', userIds: [kid] }) })).data.id;
      for (var i = 0; i < 3; i++) { await apiFetch('/api/chat/rooms/' + dm + '/messages', { method: 'POST', body: JSON.stringify({ body: '1:1 메시지 ' + i }) }); await apiFetch('/api/chat/rooms/' + grp + '/messages', { method: 'POST', body: JSON.stringify({ body: '그룹 메시지 ' + i }) }); }
      await apiFetch('/api/chat/rooms/' + self + '/messages', { method: 'POST', body: JSON.stringify({ body: '메모' }) });
      return { dm: dm, self: self, grp: grp };
    }, kim.id);
    await a.click('#hdrMsgBtn'); await a.waitForSelector('#mMessages .cx-r');
    await a.evaluate(function (r) { return chatOpenRoom(r); }, rooms.self);
    await until(a, function (r) { return CX.room === r && document.getElementById('cxIn'); }, rooms.self);

    // ── ② 떼어 내기 ──
    check(await a.evaluate(function () { return !!document.querySelector('#cxHead [data-h="pop"]') && document.querySelectorAll('#cxRooms .cx-r .cx-r-acts [data-rpop]').length >= 3; }), '대화방 머리 · 방 목록 줄에 ↗ 새 창 단추');
    var boots = 0;
    var popP = new Promise(function (res) { A.b.once('targetcreated', async function (t) { var pg0 = await t.page(); res(pg0); }); });
    check(await a.evaluate(function (r) { return wmChatPop(r); }, rooms.dm), '새 창 열기 (wmChatPop)');
    var w = await Promise.race([popP, wait(8000).then(function () { return null; })]);
    check(!!w, '새 창이 뜸');
    check(await until(w, function (r) { return typeof CX !== 'undefined' && CX.room === r && document.querySelectorAll('#cxMsgs .cx-mw').length >= 3; }, rooms.dm, 20000), '새 창에 그 방 대화가 보임');
    var sv = await w.evaluate(function () {
      var vis = function (s) { var e = document.querySelector(s); return !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'; };
      var cx = document.querySelector('#mMessages .cx').getBoundingClientRect();
      return { solo: document.documentElement.classList.contains('wm-solo'), hdr: vis('.hdr'), tabs: vis('#pageTabs'), side: vis('.cx-side'), back: vis('.cx-back'), comp: vis('#cxIn'), call: vis('#cxHead [data-h="call"]'), pop: !!document.querySelector('#cxHead [data-h="pop"]'), rect: [cx.left, cx.top, cx.width, cx.height, innerHeight], fill: cx.left === 0 && cx.top === 0 && Math.abs(cx.width - innerWidth) < 2 && Math.abs(cx.height - innerHeight) < 2, title: document.title, splash: vis('#initLoading'), w: innerWidth };
    });
    check(sv.solo && !sv.hdr && !sv.tabs && !sv.side && !sv.back && sv.comp, '전용 화면 — 앱 머리 · 메뉴 · 방 목록 없음 · 입력칸 있음');
    check(sv.fill && !sv.splash, '창을 가득 채움 (' + sv.w + 'px · ' + JSON.stringify(sv.rect) + ' · splash ' + sv.splash + ')');
    check(!sv.call && !sv.pop, '통화 · 새 창 단추는 전용 화면에 없음');
    check(/메신저/.test(sv.title) && !/업무 관리자$/.test(sv.title), '창 제목이 방 이름 (' + sv.title + ')');
    check(boots === 0, '업무 데이터는 받지 않음 (요청 ' + boots + ')');
    await w.screenshot({ path: path.join(SHOT, 'e2e79-popup.png') });
    // 로그인은 본 창 것을 그대로
    var tok = await Promise.all([a.evaluate(function () { return _accessToken; }), w.evaluate(function () { return _accessToken; })]);
    check(tok[0] && tok[0] === tok[1], '로그인은 본 창 것을 그대로 씀');
    // 새 창에서 보내기 → 본 창 목록에 반영
    await w.type('#cxIn', '새 창에서 보냅니다'); await w.keyboard.press('Enter');
    check(await until(a, function (r) { var x = CX.rooms.filter(function (y) { return y.id === r; })[0]; return x && x.last && /새 창에서 보냅니다/.test(x.last.body || ''); }, rooms.dm), '새 창에서 보낸 글이 본 창 목록에 바로');
    check(await until(k, function () { return CX.rooms.some(function (y) { return y.last && /새 창에서 보냅니다/.test(y.last.body || ''); }); }), '상대(김팀원)에게도 도착');
    // 본 창은 이 방이 떠 있음을 앎
    check(await until(a, function (r) { return typeof WM_CW !== 'undefined' && WM_CW.here[r] && Date.now() - WM_CW.here[r].at < 5000; }, rooms.dm), '본 창이 떠 있는 창을 앎 (창끼리 신호)');
    // 김팀원이 보냄 → 새 창에 뜨고, 새 창이 읽음 처리 → 본 창 숫자 0
    await w.bringToFront(); await wait(300);
    await post(k, rooms.dm, '김팀원이 보낸 글');
    check(await until(w, function () { return /김팀원이 보낸 글/.test(document.getElementById('cxMsgs').textContent); }), '상대 글이 새 창에 바로');
    check(await until(a, function (r) { var x = CX.rooms.filter(function (y) { return y.id === r; })[0]; return x && x.last && /김팀원이 보낸 글/.test(x.last.body || '') && !x.unread; }, rooms.dm, 6000), '새 창에서 읽으면 본 창 안 읽음 숫자도 0');
    // 같은 방 다시 → 새 창이 더 생기지 않음
    var before = (await A.b.pages()).length;
    await a.evaluate(function (r) { return wmChatPop(r); }, rooms.dm); await wait(800);
    check((await A.b.pages()).length === before, '이미 떠 있는 방은 새로 열지 않음 (그 창을 앞으로)');
    // 갱신 — 새 창이 갱신해도 본 창 · 새 창 모두 로그인 유지
    var rf = await w.evaluate(async function () { _accessToken = 'x'; var ok = await _tryRefresh(); var me = await apiFetch('/api/chat/rooms').then(function () { return true; }, function () { return false; }); return ok && me; });
    var rf2 = await a.evaluate(async function () { var ok = await _tryRefresh(); var me = await apiFetch('/api/chat/rooms').then(function () { return true; }, function () { return false; }); return ok && me; });
    var rf3 = await w.evaluate(function () { return apiFetch('/api/chat/rooms').then(function () { return true; }, function () { return false; }); });
    check(rf && rf2 && rf3, '로그인 갱신 뒤에도 본 창 · 새 창 모두 그대로');
    // 창 자리 기억
    await w.setViewport({ width: 520, height: 700 }); await wait(700);
    await w.evaluate(function () { _cwSavePos(); });
    var pos = await a.evaluate(function (r) { return (JSON.parse(localStorage.getItem('wm-cw-pos') || '{}'))[r]; }, rooms.dm);
    check(pos && pos.w === 520 && pos.h === 700, '창 크기를 방마다 기억 (' + JSON.stringify(pos) + ')');
    // 닫으면 본 창이 앎
    await w.close();
    check(await until(a, function (r) { return !WM_CW.here[r] || Date.now() - WM_CW.here[r].at >= 5000; }, rooms.dm, 9000), '창을 닫으면 본 창 기록에서 빠짐');

    // ── ③ 나란히 보기 ──
    await a.bringToFront();
    check(await a.evaluate(function (r) { return wmChatSplitAdd(r); }, rooms.grp), '옆 칸에 나란히 (wmChatSplitAdd)');
    await a.waitForSelector('#cxSplit .cx-pane iframe');
    var fr = null;
    for (var i = 0; i < 40 && !fr; i++) { fr = a.frames().filter(function (f) { return /solo=/.test(f.url()) && /embed=1/.test(f.url()); })[0]; if (!fr) await wait(250); }
    check(!!fr, '옆 칸이 생김');
    check(await fr.waitForFunction(function (r) { return typeof CX !== 'undefined' && CX.room === r && document.querySelectorAll('#cxMsgs .cx-mw').length >= 3; }, { timeout: 20000 }, rooms.grp).then(function () { return true; }, function () { return false; }), '옆 칸에 그 방 대화가 보임');
    var lay = await a.evaluate(function () { var m = document.querySelector('#mMessages .cx').getBoundingClientRect(), p = document.querySelector('#cxSplit .cx-pane').getBoundingClientRect(); return { side: p.left >= m.right - 1, same: Math.abs(p.height - m.height) < 3 && Math.abs(p.top - m.top) < 3, pw: Math.round(p.width), mw: Math.round(m.width), in: p.right <= innerWidth + 1 }; });
    check(lay.side && lay.same && lay.pw >= 340 && lay.in, '본 칸 옆에 같은 높이로 (' + lay.mw + ' + ' + lay.pw + 'px) ' + JSON.stringify(lay));
    check(await fr.evaluate(function () { return document.documentElement.classList.contains('wm-embed') && !!document.querySelector('#cxHead [data-h="closepane"]') && !!document.querySelector('#cxHead [data-h="pop"]'); }), '옆 칸 머리에 ✕ 닫기 · ↗ 새 창');
    await a.screenshot({ path: path.join(SHOT, 'e2e79-split.png') });
    // 옆 칸에서 보내기 · 받기
    await fr.type('#cxIn', '옆 칸에서 보냅니다'); await fr.evaluate(function () { var ta = document.getElementById('cxIn'); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true })); });
    check(await until(k, function () { return CX.rooms.some(function (y) { return y.last && /옆 칸에서 보냅니다/.test(y.last.body || ''); }); }), '옆 칸에서 보낸 글이 상대에게 도착');
    await post(k, rooms.grp, '그룹에 김팀원 글');
    check(await fr.waitForFunction(function () { return /그룹에 김팀원 글/.test(document.getElementById('cxMsgs').textContent); }, { timeout: 8000 }).then(function () { return true; }, function () { return false; }), '상대 글이 옆 칸에 바로');
    // 본 칸에서는 다른 방을 계속 씀
    check(await a.evaluate(function (r) { return CX.room === r && !!document.getElementById('cxIn'); }, rooms.self), '본 칸은 다른 방 그대로');
    // 옆 칸에 있는 방을 목록에서 누르면 본 칸에 열지 않고 그 칸을 알려 줌
    await a.evaluate(function (r) { document.querySelector('#cxRooms .cx-r[data-room="' + r + '"]').click(); }, rooms.grp);
    check(await a.evaluate(function (r) { return CX.room === r; }, rooms.self), '옆 칸에 둔 방은 본 칸에 또 열리지 않음');
    // 두 번째 칸 · 세 번째는 막힘
    check(await a.evaluate(function (r) { return wmChatSplitAdd(r); }, rooms.dm) && (await a.$$('#cxSplit .cx-pane')).length === 2, '옆 칸 2개까지');
    check(await a.evaluate(function () { return wmChatSplitAdd('없는-방-xyz'); }) === false && (await a.$$('#cxSplit .cx-pane')).length === 2, '세 번째는 막고 안내');
    check((await a.evaluate(function () { return localStorage.getItem('wm-cx-split'); })) === JSON.stringify([rooms.grp, rooms.dm]), '옆 칸 구성을 기억');
    // 좁히면 숨고, 넓히면 다시
    await a.setViewport({ width: 1000, height: 800 }); await wait(300);
    check(await a.evaluate(function () { return getComputedStyle(document.getElementById('cxSplit')).display === 'none' && document.querySelector('#mMessages .cx').getBoundingClientRect().width > 900; }), '창을 좁히면 옆 칸은 숨고 본 칸이 넓어짐');
    check(await a.evaluate(function () { return wmChatSplitAdd('아무-방'); }) === false, '좁은 창에서는 나란히 두기 안내만');
    await a.setViewport({ width: 1500, height: 900 }); await wait(300);
    check(await a.evaluate(function () { return getComputedStyle(document.getElementById('cxSplit')).display !== 'none'; }), '다시 넓히면 옆 칸이 그대로');
    // 옆 칸 ✕ → 닫힘
    await fr.evaluate(function () { setTimeout(function () { document.querySelector('#cxHead [data-h="closepane"]').click(); }, 0); }).catch(function () {});   // 누르면 이 칸(iframe)이 사라짐
    check(await until(a, function () { return document.querySelectorAll('#cxSplit .cx-pane').length === 1; }), '옆 칸 ✕ → 그 칸만 닫힘');
    await a.evaluate(function (r) { return wmChatSplitClose(r); }, rooms.dm);
    check(await a.evaluate(function () { return !document.getElementById('cxSplit') && !document.getElementById('mMessages').classList.contains('has-split') && !localStorage.getItem('wm-cx-split'); }), '모두 닫으면 원래 화면으로');

    // ── 본 창은 그대로 (보통 화면) ──
    check(await a.evaluate(function () { return !document.documentElement.classList.contains('wm-solo') && !!document.querySelector('.hdr') && getComputedStyle(document.querySelector('.hdr')).display !== 'none'; }), '본 창은 평소 화면 그대로');
    check(!errs.length, '화면 오류 없음' + (errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  if (A) await A.b.close(); if (K) await K.b.close();
  await c.end();
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
