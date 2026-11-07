// 👥 메신저 참여자 · 🗂 방 폴더 · 🔔 알림 카드 (v13.359) — 두 브라우저(관리자 · 김팀원)
//   초대 때 '이전 대화 보여 주기' 끄기 → 이팀원은 앞 대화 못 봄 · 👁 읽기만으로 바꾸면 김팀원 화면이 바로 안내로
//   · 🗂 방 폴더 만들기 → 상대 화면에 바로 · 읽기만은 못 담음 · 담은 사람 표시 · 📲 앱 설치 창의 🔔 알림 카드
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var kim = (await c.query("SELECT id FROM users WHERE email = 'kim@t.com'")).rows[0];
  var lee = (await c.query("SELECT id FROM users WHERE email = 'lee@t.com'")).rows[0];
  await c.query('DELETE FROM chat_rooms WHERE tenant_id = $1', [adm.tenant_id]);
  await c.query('DELETE FROM chat_folders WHERE tenant_id = $1', [adm.tenant_id]);
  require('fs').mkdirSync(SHOT, { recursive: true });

  var ok = 0, fail = 0, errs = [], promptAns = '설계 도면';
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { d.accept(d.type() === 'prompt' ? promptAns : undefined); });
    await p.setViewport({ width: 1500, height: 920 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.waitForFunction(function () { return typeof CXS !== 'undefined' && CXS.on; }, { timeout: 10000 }).catch(function () {});
    return { b: b, p: p };
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  async function clickText(p, sel, src) { return p.evaluate(function (sel, src) { var b = Array.prototype.filter.call(document.querySelectorAll(sel), function (x) { return new RegExp(src).test(x.textContent); })[0]; if (b) b.click(); return !!b; }, sel, src); }

  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '설비팀', userIds: [uid] }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.click('#hdrMsgBtn'); await k.click('#hdrMsgBtn');
    await a.waitForSelector('#mMessages .cx'); await k.waitForSelector('#mMessages .cx');
    await a.evaluate(function (r) { chatOpenRoom(r); }, room); await k.evaluate(function (r) { chatOpenRoom(r); }, room);
    await until(a, function () { return document.getElementById('cxIn') && CX.info; }); await until(k, function () { return document.getElementById('cxIn') && CX.info; });
    await a.evaluate(function () { return _cxSend('지난주 견적가는 1,200만 원 (외부 비공개)'); });

    // 초대 — 이전 대화 보여 주기 끔
    await a.evaluate(function () { CX.aside = true; CX.asideTab = 'people'; _cxDrawAside(); });
    await a.waitForSelector('#cxAsB .cx-inv');
    check(await a.evaluate(function () { return /👑 방장/.test(document.getElementById('cxAsB').textContent); }), '멤버 탭 — 👑 방장 표시');
    await a.click('#cxAsB .cx-inv');
    await a.waitForSelector('#chatInvModal [data-hist]');
    check(await a.$eval('#chatInvModal [data-hist]', function (x) { return x.checked; }), '초대 창 — "이전 대화도 보여 주기" 기본 켬');
    await a.evaluate(function () { var b = Array.prototype.filter.call(document.querySelectorAll('#chatInvModal [data-u]'), function (x) { return /이팀원/.test(x.textContent); })[0]; b.click(); });
    await a.click('#chatInvModal [data-hist]');
    await a.click('#chatInvModal [data-go]');
    await wait(800);
    var hf = (await c.query('SELECT hist_from FROM chat_members WHERE room_id = $1 AND user_id = $2', [room, lee.id])).rows[0];
    check(hf && +hf.hist_from > 0, '이팀원 — 초대 앞 대화 안 보임 (hist_from ' + (hf && hf.hist_from) + ')');
    var leeSees = await a.evaluate(function () { return CX.msgs.some(function (m) { return /이전 대화는 안 보임/.test(m.body || ''); }); });
    check(leeSees, '방 안내 — "(이전 대화는 안 보임)"');

    // 👁 읽기만 — 김팀원 화면이 바로 안내로
    await a.evaluate(function () { CX.aside = true; CX.asideTab = 'people'; _cxDrawAside(); });
    await a.waitForSelector('#cxAsB [data-role]');
    await a.evaluate(function (uid) { document.querySelector('#cxAsB [data-role="' + uid + '"]').click(); }, kim.id);
    await a.waitForSelector('.cx-menu');
    await clickText(a, '.cx-menu button', '읽기만');
    var ro = await until(k, function () { return document.querySelector('#cxMain .cx-ro') && !document.getElementById('cxIn') && CX.info.myRole === 'readonly'; }, null, 6000);
    check(ro, '김팀원 화면 — 입력칸 대신 "읽기만" 안내 (실시간)');
    var kpost = await k.evaluate(function () { return apiFetch('/api/chat/rooms/' + CX.room + '/messages', { method: 'POST', body: JSON.stringify({ body: 'x' }) }).then(function () { return 'ok'; }, function (e) { return e && e.data && e.data.error; }); });
    check(kpost === 'READONLY', '읽기만 — 서버도 막음');
    await k.screenshot({ path: path.join(SHOT, 'e2e61-readonly-kim.png') });

    // 🗂 방 폴더 — 관리자가 파일 탭에서 만듦 → 김팀원 화면에 바로
    await a.evaluate(function () { CX.aside = true; CX.asideTab = 'files'; _cxDrawAside(); });
    await a.waitForSelector('#cxAsB .cc-rf [data-rfnew]');
    await a.click('#cxAsB .cc-rf [data-rfnew]');
    await until(a, function () { return /설계 도면/.test((document.querySelector('#cxAsB .cc-rf') || {}).textContent || ''); });
    await k.evaluate(function () { CX.aside = true; CX.asideTab = 'files'; _cxDrawAside(); });
    var kSee = await until(k, function () { var r = document.querySelector('#cxAsB .cc-rf'); return r && /설계 도면/.test(r.textContent) && !r.querySelector('[data-rfnew]'); });
    check(kSee, '방 폴더 — 김팀원에게도 보임 · 읽기만은 ＋ 없음');
    // 관리자가 메시지 담기 → 김팀원 파일 탭 숫자 실시간
    var mid = await a.evaluate(function () { return CX.msgs.filter(function (m) { return /견적가/.test(m.body || ''); })[0].id; });
    await a.evaluate(function (id) { document.querySelector('#cxMsgs .cx-m[data-mid="' + id + '"] [data-a="more"]').click(); }, mid);
    await a.waitForSelector('.cx-menu'); await clickText(a, '.cx-menu button', '폴더에 담기');
    await until(a, function () { return Array.prototype.some.call(document.querySelectorAll('.cx-menu button'), function (b) { return /방 폴더/.test(b.textContent); }); });
    await clickText(a, '.cx-menu button', '설계 도면.*방 폴더');
    var live = await until(k, function () { var r = document.querySelector('#cxAsB .cc-rf [data-rf] i'); return r && r.textContent.trim() === '1'; }, null, 6000);
    check(live, '담으면 김팀원 화면 폴더 수 1 (실시간)');
    // 김팀원 다시 멤버로 → 모아 보기에서 방 폴더 · 담은 사람
    await a.evaluate(function () { CX.aside = true; CX.asideTab = 'people'; _cxDrawAside(); });
    await a.waitForSelector('#cxAsB [data-role]');
    await a.evaluate(function (uid) { document.querySelector('#cxAsB [data-role="' + uid + '"]').click(); }, kim.id);
    await a.waitForSelector('.cx-menu'); await clickText(a, '.cx-menu button', '멤버로');
    var back = await until(k, function () { return document.getElementById('cxIn') && CX.info.myRole === 'member'; }, null, 6000);
    check(back, '멤버로 되돌리면 입력칸 다시');
    await k.evaluate(function () { CX.aside = true; CX.asideTab = 'files'; _cxDrawAside(); });
    await k.waitForSelector('#cxAsB [data-rf]');
    await k.evaluate(function () { document.querySelector('#cxAsB [data-rf]').click(); });
    await k.waitForSelector('#cxLib .cc-grid');
    var lib = await until(k, function () { return /방 폴더/.test(document.querySelector('#cxLib [data-flist]').textContent) && /📥 관리자/.test(document.querySelector('#cxLib .cc-grid').textContent); });
    check(lib, '모아 보기 — 🗂 방 폴더 칸 · 📥 담은 사람');
    await k.screenshot({ path: path.join(SHOT, 'e2e61-shared-folder-kim.png') });
    await k.evaluate(function () { var o = document.getElementById('cxLib'); if (o) o.closest('.wa-modal-overlay').remove(); });

    // 🔔 알림 카드 (앱 설치 창)
    await a.evaluate(function () { wmGuardedModal('appInstall', wmAppInstall, 'wmAppInstall'); });
    await a.waitForSelector('#wmPushCard [data-pst]');
    var st = await until(a, function () { var e = document.querySelector('#wmPushCard'); return e && e.dataset.st; });
    var stv = await a.evaluate(function () { return document.querySelector('#wmPushCard').dataset.st + ' / ' + document.querySelector('#wmPushCard [data-pst]').textContent; });
    check(st && /^(off|unsupported|denied|on)/.test(stv), '앱 설치 창 — 🔔 이 기기 알림 카드 (' + stv + ')');
    await a.screenshot({ path: path.join(SHOT, 'e2e61-push-card.png') });
    var key = await a.evaluate(function () { return apiFetch('/api/push/key').then(function (r) { return r.data.publicKey.length; }); });
    check(key > 60, '서버 푸시 키 ' + key + '자');

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (A) await A.b.close(); if (K) await K.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
