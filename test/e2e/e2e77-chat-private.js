// 💬 v13.426 — 👁 / 명령 결과 나만 보기 · @부른 사람 강조 · 🔒 채팅 잠금
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id, COALESCE(display_name, name) AS n FROM users WHERE email = 'admin@t.com'")).rows[0];
  var kim = (await c.query("SELECT id, COALESCE(display_name, name) AS n FROM users WHERE email = 'kim@t.com'")).rows[0];
  await c.query('DELETE FROM chat_rooms WHERE tenant_id = $1', [adm.tenant_id]);
  await c.query('UPDATE chat_user_state SET lock_pin = NULL, lock_auto = 0').catch(function () {});
  require('fs').mkdirSync(SHOT, { recursive: true });
  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var b;
  try {
    b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-p' + Date.now()) });
    var a = (await b.pages())[0] || await b.newPage();
    a.on('pageerror', function (e) { errs.push(e.message); });
    a.on('dialog', function (d) { d.accept(); });
    await a.setViewport({ width: 1400, height: 900 });
    await a.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await a.waitForSelector('#loginEmail', { visible: true });
    await a.type('#loginEmail', 'admin@t.com'); await a.type('#loginPw', 'Test1234!'); await a.keyboard.press('Enter');
    await a.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    var S = await a.evaluate(async function (kimId) {
      var o = {};
      o.pid = (await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name: '나만 보기 시험', status: 'active', currentPhase: 'design' }) })).data.id;
      o.prj = (await apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'project', projectId: o.pid }) })).data.id;
      o.grp = (await apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '비밀 시험', userIds: [kimId] }) })).data.id;
      return o;
    }, kim.id);
    await a.evaluate(function (r) { if (typeof setPage === 'function') setPage('messages'); chatOpenRoom(r); }, S.grp);
    check(await until(a, function (r) { return CX.room === r && document.getElementById('cxIn'); }, S.grp, 15000), '방 열림');
    var n0 = (await c.query('SELECT COUNT(*)::int AS n FROM chat_messages WHERE room_id = $1', [S.grp])).rows[0].n;

    // 👁 /todo · /help · /요약 — 나만 보임, 방에 안 남음
    await a.evaluate(function () { return _cxSend('/todo 내일 견적서 회신'); });
    check(await until(a, function () { return Array.from(document.querySelectorAll('#cxMsgs .cx-eph')).some(function (x) { return /나만 보임/.test(x.textContent) && /내 할 일에 넣었습니다/.test(x.textContent) && x.querySelector('.cx-card'); }); }, null, 8000), '/todo → "👁 나만 보임" 결과 + 카드');
    check((await c.query("SELECT COUNT(*)::int AS n FROM my_todos WHERE user_id = $1 AND title LIKE '%견적서 회신%'", [adm.id])).rows[0].n === 1, '할 일은 실제로 생김');
    await a.evaluate(function () { return _cxSend('/help'); });
    await a.evaluate(function () { return _cxSend('/요약'); });
    check(await until(a, function () { return document.querySelectorAll('#cxMsgs .cx-eph').length >= 3; }, null, 10000), '/help · /요약 결과도 나만 보임 (AI 없으면 안내)');
    var n1 = (await c.query('SELECT COUNT(*)::int AS n FROM chat_messages WHERE room_id = $1', [S.grp])).rows[0].n;
    check(n1 === n0, '방에는 아무것도 안 남음 (명령 글 · 결과 모두) ' + n0 + '→' + n1);
    await a.screenshot({ path: path.join(SHOT, 'e2e77-eph.png') });
    // 방을 옮겼다 와도 그대로 · ✕ 로 지우기
    await a.evaluate(function (r) { chatOpenRoom(r); }, S.prj);
    await until(a, function (r) { return CX.room === r; }, S.prj, 8000);
    await a.evaluate(function (r) { chatOpenRoom(r); }, S.grp);
    check(await until(a, function () { return document.querySelectorAll('#cxMsgs .cx-eph').length >= 3; }, null, 8000), '다른 방 갔다 와도 나만 보기 결과 그대로');
    await a.evaluate(function () { document.querySelector('#cxMsgs .cx-eph [data-ex]').click(); });
    check(await until(a, function () { return document.querySelectorAll('#cxMsgs .cx-eph').length === 2; }, null, 5000), '✕ 로 지우기');
    var sh = await a.evaluate(function (r) { return apiFetch('/api/chat/rooms/' + r + '/eph-share', { method: 'POST', body: JSON.stringify({ tok: 'e-nope' }) }).then(function () { return 'ok'; }, function (e) { return (e && e.status) || (e && e.message) || 'err'; }); }, S.grp);
    check(sh !== 'ok', '없는 토큰으로 AI 공유 못 함 (가짜 AI 글 막기) ' + sh);
    // /issue (프로젝트 방) — 확인은 나만, 이슈 소식은 방에
    await a.evaluate(function (r) { chatOpenRoom(r); }, S.prj);
    await until(a, function (r) { return CX.room === r && document.getElementById('cxIn'); }, S.prj, 8000);
    await a.evaluate(function () { return _cxSend('/issue 센서 케이블 단선 !'); });
    check(await until(a, function () { return Array.from(document.querySelectorAll('#cxMsgs .cx-eph')).some(function (x) { return /이슈를 올렸습니다/.test(x.textContent); }); }, null, 8000), '/issue — 확인은 나만');
    var pn = (await c.query("SELECT kind, body FROM chat_messages WHERE room_id = $1 AND body LIKE '%센서 케이블 단선%'", [S.prj])).rows;
    check(pn.length === 1 && pn[0].kind === 'system' && /새 이슈 \(긴급\)/.test(pn[0].body), '이슈 소식은 방 모두에게 (한 줄) ' + JSON.stringify(pn));

    // @ 강조
    await a.evaluate(function (r) { chatOpenRoom(r); }, S.grp);
    await until(a, function (r) { return CX.room === r && CX.info; }, S.grp, 8000);
    await c.query("INSERT INTO chat_messages (tenant_id, room_id, user_id, kind, body, mentions) VALUES ($1,$2,$3,'text',$4,$5)", [adm.tenant_id, S.grp, kim.id, '@' + adm.n + '님 이거 확인 부탁해요', JSON.stringify([adm.id])]);
    await c.query("INSERT INTO chat_messages (tenant_id, room_id, user_id, kind, body, mentions) VALUES ($1,$2,$3,'text',$4,'[]')", [adm.tenant_id, S.grp, adm.id, '@' + kim.n + ' 그리고 @없는사람 도요']);
    await a.evaluate(function (r) { chatOpenRoom(r, true); }, S.grp);
    check(await until(a, function () { return document.querySelector('#cxMsgs .cx-m.at-me .cx-atp.me') && document.querySelector('#cxMsgs .cx-m.at-me .cx-atme-tag'); }, null, 8000), '나를 부른 글 — 노란 알약 · 테두리 · "🔔 나를 불렀어요"');
    await until(a, function () { return Array.from(document.querySelectorAll('#cxMsgs .cx-m.mine')).some(function (x) { return /없는사람/.test(x.textContent); }); }, null, 8000);
    var at = await a.evaluate(function (kn) {
      var me = document.querySelector('#cxMsgs .cx-m.at-me .cx-atp.me'), mine = Array.from(document.querySelectorAll('#cxMsgs .cx-m.mine')).filter(function (x) { return /없는사람/.test(x.textContent); }).pop();
      return { meTxt: me.textContent, after: me.nextSibling && me.nextSibling.textContent, kim: !!Array.from(mine.querySelectorAll('.cx-atp')).filter(function (x) { return x.textContent === '@' + kn && !x.classList.contains('me'); }).length, none: !!Array.from(mine.querySelectorAll('.cx-at')).filter(function (x) { return /없는사람/.test(x.textContent); }).length };
    }, kim.n);
    check(at.meTxt === '@' + adm.n && /^님/.test(at.after || ''), '"@이름님" — 이름만 알약, "님" 은 뒤에 ' + JSON.stringify(at));
    check(at.kim && at.none, '다른 사람은 색 알약 · 방에 없는 이름은 그냥 글');
    await a.screenshot({ path: path.join(SHOT, 'e2e77-at.png') });

    // 🔒 잠금 — 정하기 전엔 🔒 누르면 설정 창
    await a.click('#cxLockBtn');
    check(await until(a, function () { return document.querySelector('#chatLockModal [data-pin]'); }, null, 5000), 'PIN 없으면 🔒 → 설정 창');
    await a.type('#chatLockModal [data-pin]', '12'); await a.type('#chatLockModal [data-pin2]', '12');
    await a.click('#chatLockModal [data-go]');
    check(await a.evaluate(function () { return /4~8자리/.test(document.querySelector('#chatLockModal [data-err]').textContent); }), '짧은 PIN 거절');
    await a.evaluate(function () { document.querySelector('#chatLockModal [data-pin]').value = '2468'; document.querySelector('#chatLockModal [data-pin2]').value = '2468'; document.querySelector('#chatLockModal [data-auto]').value = '5'; });
    await a.screenshot({ path: path.join(SHOT, 'e2e77-lockset.png') });
    await a.click('#chatLockModal [data-go]');
    check(await until(a, function () { return !document.getElementById('chatLockModal') && CXL.hasPin && CXL.auto === 5; }, null, 5000), 'PIN · 자동 5분 저장');
    var row = (await c.query('SELECT lock_pin, lock_auto FROM chat_user_state WHERE user_id = $1', [adm.id])).rows[0];
    check(row && row.lock_pin && row.lock_pin.indexOf('2468') < 0 && row.lock_auto === 5, 'PIN 은 해시로만 저장');
    // 지금 잠그기 (Ctrl+Shift+L)
    await a.keyboard.down('Control'); await a.keyboard.down('Shift'); await a.keyboard.press('KeyL'); await a.keyboard.up('Shift'); await a.keyboard.up('Control');
    check(await until(a, function () { return document.documentElement.classList.contains('cx-locked') && document.getElementById('cxLockOv'); }, null, 3000), 'Ctrl+Shift+L → 잠김 · 가리개');
    var hid = await a.evaluate(function () { var cs = getComputedStyle(document.querySelector('#mMessages .cx')); return { f: cs.filter, pe: cs.pointerEvents }; });
    check(/blur/.test(hid.f) && hid.pe === 'none', '대화 흐리게 · 못 누름 ' + JSON.stringify(hid));
    await a.screenshot({ path: path.join(SHOT, 'e2e77-locked.png') });
    await a.type('#cxLockOv [data-pin]', '1111'); await a.keyboard.press('Enter');
    check(await until(a, function () { return /맞지 않습니다/.test(document.querySelector('#cxLockOv [data-err]').textContent); }, null, 5000), '틀린 PIN → 안내 · 그대로 잠김');
    // 새로 고쳐도 잠김
    await a.reload({ waitUntil: 'networkidle2' });
    await a.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await a.evaluate(function () { if (typeof setPage === 'function') setPage('messages'); });
    check(await until(a, function () { return document.getElementById('cxLockOv') && document.documentElement.classList.contains('cx-locked'); }, null, 10000), '새로 고쳐도 잠김 유지');
    await a.type('#cxLockOv [data-pin]', '2468'); await a.keyboard.press('Enter');
    check(await until(a, function () { return !document.getElementById('cxLockOv') && !document.documentElement.classList.contains('cx-locked'); }, null, 5000), '맞는 PIN → 풀림');
    // 자리 비움 자동 잠금 (시험이라 1.5초)
    await a.evaluate(function () { CXL.autoMs = 1500; CXL.last = Date.now(); });
    check(await until(a, function () { return document.documentElement.classList.contains('cx-locked'); }, null, 6000), '자리 비움 → 자동 잠금');
    var nt = await a.evaluate(function () { var got = null; var old = window.showToast; window.chatAlertSysNotify = function (t, bd) { got = t + '|' + bd; }; Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } }); _cxNotify({ roomId: 'x', userName: '김', body: '비밀 내용', mentions: [] }, null); delete document.hidden; return got; });
    check(nt && !/비밀 내용/.test(nt) && /잠금을 풀면/.test(nt), '잠겨 있으면 알림에 내용 없음 (' + nt + ')');
    await a.type('#cxLockOv [data-pin]', '2468'); await a.keyboard.press('Enter');
    await until(a, function () { return !document.getElementById('cxLockOv'); }, null, 5000);
    // 끄기 — 지금 PIN 필요
    await a.evaluate(function () { CXL.autoMs = 0; chatLockSettings(false); });
    await until(a, function () { return document.querySelector('#chatLockModal [data-off]'); }, null, 5000);
    await a.type('#chatLockModal [data-old]', '2468');
    await a.click('#chatLockModal [data-off]');
    check(await until(a, function () { return !CXL.hasPin && !document.getElementById('chatLockModal'); }, null, 5000), '지금 PIN 넣고 잠금 끄기');
    // 5번 틀리면 1분 쉬기 (API)
    await a.evaluate(function () { return apiFetch('/api/chat/lock', { method: 'PUT', body: JSON.stringify({ pin: '1357', auto: 0 }) }); });
    var tries = await a.evaluate(async function () { var out = []; for (var i = 0; i < 6; i++) { out.push(await apiFetch('/api/chat/lock/verify', { method: 'POST', body: JSON.stringify({ pin: '0000' }) }).then(function () { return 'ok'; }, function (e) { return String((e && e.status) || ''); })); } return out; });
    check(tries[5] === '429' && tries.slice(0, 4).every(function (x) { return x === '403'; }), '5번 틀리면 잠깐 막힘 ' + JSON.stringify(tries));
    await c.query('UPDATE chat_user_state SET lock_pin = NULL, lock_auto = 0 WHERE user_id = $1', [adm.id]);
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL', e.stack || e); }
  finally { if (b) await b.close(); await c.end(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
