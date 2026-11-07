// ⏰ 예약 보내기 · 다시 알림 · 📣 요청 다시 알림 (v13.362) — 두 브라우저(관리자 · 김팀원)
//   글 쓰고 ⏰ → 30분 뒤 예약 → 입력칸 위 '⏰ 예약 1' → 지금 보내기 → 상대 화면에
//   · 메시지 ⋯ → ⏰ 다시 알림 → 직접(40초 뒤) → 서버 메모리 타이머가 울림 → ⏰ 알림 상자 · 인앱 알림
//   · 🛠 요청 📣 다시 알림 → 담당자 알림 · 줄기에 기록 · 한 시간에 한 번 · 🗂 모아 보기 ⏰ 탭
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

  var ok = 0, fail = 0, errs = [], promptAns = null;
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { d.accept(d.type() === 'prompt' ? (promptAns || d.defaultValue()) : undefined); });
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
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '설비 예약', userIds: [uid] }) }).then(function (r) { return r.data.id; }); }, kim.id);
    for (var p of [a, k]) { await p.click('#hdrMsgBtn'); await p.evaluate(function (r) { chatOpenRoom(r); }, room); await until(p, function () { return CX.info && document.getElementById('cxIn'); }); }

    // ⏰ 예약 보내기
    await a.type('#cxIn', '내일 09시 라인 B 정지 점검 시작합니다');
    await a.click('#cxComp [data-c="sched"]');
    check(await menu(a, /30분 뒤/), '⏰ 메뉴 — 30분 뒤 · 1시간 뒤 · 내일 09:00 …');
    check(await until(a, function () { var s = document.querySelector('#cxComp .ct-strip'); return s && /예약 1/.test(s.textContent) && !document.getElementById('cxIn').value; }), '입력칸 비고 위에 "⏰ 예약 1"');
    var dbS = (await c.query('SELECT send_at FROM chat_scheduled WHERE room_id = $1', [room])).rows[0];
    var mins = Math.round((new Date(dbS.send_at) - Date.now()) / 60000);
    check(mins >= 29 && mins <= 30, '서버 예약 30분 뒤 (' + mins + '분)');
    check(!(await k.evaluate(function () { return /라인 B 정지/.test(document.getElementById('cxMsgs').textContent); })), '아직 상대 화면엔 없음');
    await a.click('#cxComp .ct-strip');
    await menu(a, /라인 B/);
    await menu(a, /지금 보내기/);
    check(await until(k, function () { return /라인 B 정지 점검/.test(document.getElementById('cxMsgs').textContent); }), '지금 보내기 → 상대 화면에');
    check(await until(a, function () { return !document.querySelector('#cxComp .ct-strip'); }), '예약 줄 사라짐');

    // ⏰ 다시 알림 (김팀원, 40초 뒤)
    var mid = await k.evaluate(function () { return CX.msgs.filter(function (m) { return /라인 B/.test(m.body || ''); })[0].id; });
    await k.evaluate(function (id) { document.querySelector('#cxMsgs .cx-m[data-mid="' + id + '"] [data-a="more"]').click(); }, mid);
    await menu(k, /다시 알림/);
    var t = new Date(Date.now() + 40000);
    promptAns = t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2) + ' ' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2);
    await menu(k, /직접 고르기/);
    await wait(800);
    var rr = (await c.query('SELECT remind_at FROM chat_reminders WHERE user_id = $1 AND done_at IS NULL', [kim.id])).rows;
    check(rr.length === 1, '다시 알림 저장 (' + (rr[0] && new Date(rr[0].remind_at).toLocaleTimeString()) + ')');
    await k.evaluate(function () { chatOpenRoom(null); }).catch(function () {});
    var popped = await until(k, function () { var p = document.querySelector('.ct-pop'); return p && /다시 알림/.test(p.textContent) && /라인 B/.test(p.textContent); }, null, 60000);
    check(popped, '40초 뒤 ⏰ 다시 알림 상자 (서버 메모리 타이머)');
    var ia = (await c.query("SELECT body FROM in_app_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [kim.id])).rows[0];
    check(ia && /라인 B/.test(ia.body), '인앱 알림에도');
    await k.screenshot({ path: path.join(SHOT, 'e2e65-remind.png') });

    // 📣 요청 다시 알림
    await k.evaluate(function (r) { chatOpenRoom(r); }, room);
    await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms/' + CX.room + '/posts', { method: 'POST', body: JSON.stringify({ cat: 'req', title: '조립기 #3 토크 설정 변경', assignee: uid }) }); }, kim.id);
    var pid = await a.evaluate(function () { return new Promise(function (r) { setTimeout(function () { r(CX.msgs.filter(function (m) { return m.post; })[0].id); }, 800); }); });
    check(await until(a, function (id) { return document.querySelector('#cxMsgs .cc-post[data-post="' + id + '"] [data-pnudge]'); }, pid), '요청 카드 — 📣 다시 알림 단추 (담당이 남일 때)');
    check(!(await k.evaluate(function (id) { return !!document.querySelector('#cxMsgs .cc-post[data-post="' + id + '"] [data-pnudge]'); }, pid)), '담당자 본인 화면엔 없음');
    await a.evaluate(function (id) { document.querySelector('#cxMsgs .cc-post[data-post="' + id + '"] [data-pnudge]').click(); }, pid);
    await wait(800);
    var nd = (await c.query("SELECT body FROM in_app_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [kim.id])).rows[0];
    check(nd && /요청 확인 부탁|토크 설정/.test(nd.body), '담당자에게 📣 알림');
    var again = await a.evaluate(function (id) { return apiFetch('/api/chat/messages/' + id + '/nudge', { method: 'POST', body: '{}' }).then(function () { return 'ok'; }, function (e) { return e.status; }); }, pid);
    check(again === 429, '한 시간 안 두 번째는 막힘');

    // 🗂 모아 보기 ⏰ 탭
    await k.evaluate(function (id) { return apiFetch('/api/chat/messages/' + id + '/remind', { method: 'POST', body: JSON.stringify({ at: new Date(Date.now() + 86400000).toISOString(), note: '내일 확인' }) }); }, mid);
    await k.evaluate(function () { chatLibrary('times'); });
    check(await until(k, function () { var l = document.querySelector('#cxLib .ct-list'); return l && /다시 알림/.test(l.textContent) && /내일 확인/.test(l.textContent); }), '모아 보기 ⏰ 알림 · 예약 탭');
    await k.screenshot({ path: path.join(SHOT, 'e2e65-times-tab.png') });
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (A) await A.b.close(); if (K) await K.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
