// 🎯 메신저 집중 모드 (v13.363) — 두 브라우저(관리자 · 김팀원)
//   김팀원 🎯 → 1시간 집중 → 위 띠 · 관리자 화면 1:1 머리에 "🎯 집중 중 ~" · 목록 🎯
//   · 1:1 새 메시지는 알림 상자 없이 미룸(띠에 미룬 1) · @멘션은 받음 · 🖥 메신저만 크게(위 메뉴 숨김) · 끝내기 → "집중 끝 — 그동안 메시지 N개"
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
  await c.query('DELETE FROM chat_user_state').catch(function () {});
  require('fs').mkdirSync(SHOT, { recursive: true });

  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { d.accept(); });
    await p.setViewport({ width: 1400, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.waitForFunction(function () { return typeof CXS !== 'undefined' && CXS.on; }, { timeout: 10000 }).catch(function () {});
    return { b: b, p: p };
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  async function menu(p, re) { await p.waitForSelector('.cx-menu'); return p.evaluate(function (src) { var b = Array.prototype.filter.call(document.querySelectorAll('.cx-menu button'), function (x) { return new RegExp(src).test(x.textContent); })[0]; if (b) b.click(); return !!b; }, re.source); }

  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    var ids = await a.evaluate(function (uid) {
      return Promise.all([apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: uid }) }), apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '현장', userIds: [uid] }) }), apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '설계', userIds: [uid] }) })])
        .then(function (r) { return r.map(function (x) { return x.data.id; }); });
    }, kim.id);
    for (var p of [a, k]) await p.click('#hdrMsgBtn');
    await a.evaluate(function (r) { chatOpenRoom(r); }, ids[0]);
    await k.evaluate(function (r) { chatOpenRoom(r); }, ids[1]);   // 김팀원은 '현장' 방을 봄
    await until(a, function () { return CX.info; }); await until(k, function () { return CX.info; });

    // 🎯 1시간 집중
    await k.click('#cxFocus');
    await menu(k, /1시간 집중/);
    check(await until(k, function () { var b = document.getElementById('cfBar'); return b && b.classList.contains('on') && /집중 중/.test(b.textContent) && document.getElementById('cxFocus').classList.contains('on'); }), '김팀원 — 위 띠 "🎯 집중 중" · 🎯 단추 켜짐');
    check(await until(a, function () { return /🎯 집중 중 ~/.test(document.getElementById('cxHead').textContent) && document.querySelector('#cxRooms .cf-tag'); }, null, 6000), '관리자 화면 — 1:1 머리 "🎯 집중 중 ~ — 급하면 @멘션" · 목록 🎯');

    // 1:1 메시지 → 김팀원 알림 상자 없음 · 미룬 1
    await a.evaluate(function () { return _cxSend('견적 회신 언제 가능할까요?'); });
    await wait(1500);
    check(await k.evaluate(function () { return !document.querySelector('#cxPop .cx-pop') && /미룬 알림 1개/.test(document.getElementById('cfBar').textContent); }), '집중 중 — 알림 상자 없이 미룸 (미룬 1)');
    // @멘션 → 받음
    await a.evaluate(function (r) { return apiFetch('/api/chat/rooms/' + r + '/messages', { method: 'POST', body: JSON.stringify({ body: '@김팀원 도면 확인 급해요' }) }); }, ids[2]);
    check(await until(k, function () { var p = document.querySelector('#cxPop .cx-pop'); return p && /도면 확인 급해요/.test(p.textContent); }, null, 6000), '@멘션은 집중 중에도 알림');

    // 🖥 메신저만 크게
    await k.click('#cxFocus');
    await menu(k, /메신저만 크게/);
    check(await until(k, function () { var h = document.querySelector('.hdr'); return document.documentElement.classList.contains('wm-focus-big') && h && getComputedStyle(h).display === 'none'; }), '🖥 메신저만 크게 — 위 메뉴 숨김');
    await k.screenshot({ path: path.join(SHOT, 'e2e66-focus-big.png') });
    await k.evaluate(function () { document.querySelector('#cfBar [data-cfbig]').click(); });
    check(await until(k, function () { return getComputedStyle(document.querySelector('.hdr')).display !== 'none'; }), '↙ 원래 화면');

    // 끝내기 → 정리
    await k.evaluate(function () { document.querySelector('#cfBar [data-cfx]').click(); });
    check(await until(k, function () { var p = document.querySelector('#cxPop .cf-pop'); return p && /집중 끝 — 그동안 메시지 1개/.test(p.textContent); }), '끝내기 → "집중 끝 — 그동안 메시지 1개" 정리');
    check(await until(a, function () { return !/집중 중/.test(document.getElementById('cxHead').textContent); }, null, 6000), '관리자 화면에서도 집중 표시 사라짐');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (A) await A.b.close(); if (K) await K.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
