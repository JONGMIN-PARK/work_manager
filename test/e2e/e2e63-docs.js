// 📝 방 공동 문서 (v13.360) — 두 브라우저(관리자 · 김팀원)가 같은 문서를 같은 때 고침
//   📝 문서 탭 → ＋ 새 문서 → 방에 카드 · 카드 누르면 열림 → 서로 다른 줄을 동시에 고쳐도 둘 다 남음(줄 단위 합치기)
//   · 상대 화면에 바로 · 누가 몇째 줄 · 미리보기 체크리스트 눌러 체크 · 🕘 기록 되돌리기
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
    p.on('dialog', function (d) { d.accept(d.type() === 'prompt' ? '조립기 #3 시운전 체크리스트' : undefined); });
    await p.setViewport({ width: 1500, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.waitForFunction(function () { return typeof CXS !== 'undefined' && CXS.on; }, { timeout: 10000 }).catch(function () {});
    return { b: b, p: p };
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  async function typeAtLine(p, line, text, atEnd) {   // 그 줄 끝(또는 앞)에 글자 넣기
    await p.evaluate(function (line, atEnd) {
      var ta = CD.ta, ls = ta.value.split('\n'), pos = ls.slice(0, line).join('\n').length + (line ? 1 : 0) + (atEnd ? ls[line].length : 0);
      ta.focus(); ta.setSelectionRange(pos, pos);
    }, line, atEnd);
    await p.keyboard.type(text);
  }

  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '시운전', userIds: [uid] }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.click('#hdrMsgBtn'); await k.click('#hdrMsgBtn');
    await a.evaluate(function (r) { chatOpenRoom(r); }, room); await k.evaluate(function (r) { chatOpenRoom(r); }, room);
    await until(a, function () { return CX.info; }); await until(k, function () { return CX.info; });

    // 📝 문서 탭 → 새 문서
    await a.evaluate(function () { CX.aside = true; CX.asideTab = 'docs'; _cxDrawAside(); });
    await a.waitForSelector('#cxAsB [data-dnew]');
    await a.click('#cxAsB [data-dnew]');
    check(await until(a, function () { return CD && CD.ti.value === '조립기 #3 시운전 체크리스트'; }), '＋ 새 문서 → 바로 열림');
    var did = await a.evaluate(function () { return CD.id; });
    await a.evaluate(function () { CD.ta.value = '- [ ] 전원 확인\n- [ ] 통신 확인\n- [ ] 센서 확인\n- [ ] 비상 정지'; CD.ta.dispatchEvent(new Event('input')); });
    await until(a, function () { return CD && !CD.dirty && !CD.busy; }, null, 6000);
    // 김팀원: 방 카드 눌러 열기
    check(await until(k, function (id) { return document.querySelector('#cxMsgs .cx-card [data-open]') && CX.msgs.some(function (m) { return (m.cards || []).some(function (c) { return c.type === 'cdoc' && c.id === id; }); }); }, did), '방에 📝 문서 카드');
    await k.evaluate(function () { document.querySelector('#cxMsgs .cx-card [data-open]').click(); });
    check(await until(k, function () { return CD && /전원 확인/.test(CD.ta.value); }), '카드 누르면 같은 문서 · 같은 글');

    // 동시에: 관리자는 1째 줄 끝 · 김팀원은 3째 줄 끝 (저장 전 서로 모름)
    await Promise.all([typeAtLine(a, 0, ' — 220V OK', true), typeAtLine(k, 2, ' — 근접 센서 3개', true)]);
    var both = '- [ ] 전원 확인 — 220V OK\n- [ ] 통신 확인\n- [ ] 센서 확인 — 근접 센서 3개\n- [ ] 비상 정지';
    var aOk = await until(a, function (t) { return CD.ta.value === t && !CD.dirty && !CD.busy; }, both, 12000);
    var kOk = await until(k, function (t) { return CD.ta.value === t && !CD.dirty && !CD.busy; }, both, 12000);
    var srv = (await c.query('SELECT body, rev FROM chat_docs WHERE id = $1', [did])).rows[0];
    check(aOk && kOk && srv.body === both, '같은 때 다른 줄을 고쳐도 둘 다 남음 · 두 화면 · 서버 같음 (rev ' + srv.rev + ')');
    if (!(aOk && kOk)) console.log('A=', JSON.stringify(await a.evaluate(function () { return CD.ta.value; })), 'K=', JSON.stringify(await k.evaluate(function () { return CD.ta.value; })));

    // 누가 몇째 줄
    check(await until(k, function () { var p = document.querySelector('#cdDoc [data-peers] .cd-peer'); return p && /관/.test(p.textContent); }, null, 5000), '김팀원 화면 — 관리자가 고치는 줄 표시');
    // 미리보기 체크리스트 눌러 체크 → 상대 화면에
    await k.evaluate(function () { _cdView('split'); });
    await k.evaluate(function () { var cb = document.querySelector('#cdDoc [data-prev] input[type=checkbox]'); cb.click(); });
    check(await until(a, function () { return /^- \[x\] 전원 확인/.test(CD.ta.value); }, null, 8000), '미리보기 체크 → 관리자 화면 "- [x] 전원 확인"');
    await a.screenshot({ path: path.join(SHOT, 'e2e63-doc-admin.png') });

    // 🕘 기록 — 되돌리기
    await wait(800);
    await a.evaluate(function () { CD.ta.value = '다 지움'; CD.ta.dispatchEvent(new Event('input')); });
    await until(a, function () { return !CD.dirty && !CD.busy; }, null, 6000);
    await until(k, function () { return CD.ta.value === '다 지움'; }, null, 6000);
    await a.click('#cdDoc [data-hist]');
    await a.waitForSelector('.cx-menu button');
    await a.evaluate(function () { document.querySelector('.cx-menu button').click(); });
    var back = await until(k, function () { return /전원 확인/.test(CD.ta.value); }, null, 8000);
    check(back, '🕘 기록에서 되돌리기 → 상대 화면도');

    // 읽기만 멤버는 못 고침
    await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms/' + CX.room + '/members/' + uid, { method: 'PUT', body: JSON.stringify({ role: 'readonly' }) }); }, kim.id);
    await k.keyboard.press('Escape');
    await k.evaluate(function (id) { chatDocOpen(id); }, did);
    check(await until(k, function () { return CD && CD.ro && CD.ta.readOnly && /읽기만/.test(document.querySelector('#cdDoc [data-st]').textContent); }), '읽기만 멤버 — 보기만');
    await k.screenshot({ path: path.join(SHOT, 'e2e63-doc-kim.png') });
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (A) await A.b.close(); if (K) await K.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
