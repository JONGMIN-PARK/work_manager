// 📞 음성 · 🎥 영상 통화 (v13.361) — 세 브라우저(관리자 · 김팀원 · 이팀원), 가짜 카메라 · 마이크
//   🎥 → 두 사람에게 울림 → 김팀원 영상으로 받기 · 이팀원 음성으로 받기 → 세 사람 서로 연결(그물형) · 영상 보임
//   · 🎤 끄기 · 📷 끄고 켜기 · 거절 안내 · 방 카드 [참여] · 끊기 → 마지막 사람이 나가면 "통화 끝 · N분"
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
  require('fs').mkdirSync(SHOT, { recursive: true });

  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' ')); });
    p.on('dialog', function (d) { d.accept(); });
    await p.setViewport({ width: 1300, height: 860 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.waitForFunction(function () { return typeof CXS !== 'undefined' && CXS.on; }, { timeout: 10000 }).catch(function () {});
    return { b: b, p: p };
  }
  // 🎥 · 📞 — 대화 칸이 640px 보다 좁으면 머리 단추가 ⋯ 안으로 들어감(앱 정상 동작) → 보이면 바로, 아니면 ⋯ 메뉴에서
  async function headBtn(p, h, label) {
    var shown = await p.evaluate(function (h) { var b = document.querySelector('#cxHead [data-h="' + h + '"]'); return !!b && getComputedStyle(b).display !== 'none'; }, h);
    if (shown) return p.click('#cxHead [data-h="' + h + '"]');
    await p.click('#cxHead [data-h="more"]');
    await p.waitForSelector('.cx-menu button');
    await p.evaluate(function (label) { var b = [].filter.call(document.querySelectorAll('.cx-menu button'), function (x) { return x.textContent.indexOf(label) >= 0; })[0]; if (!b) throw new Error('메뉴에 없음: ' + label); b.click(); }, label);
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  function videosOk(p, n, ms) { return until(p, function (n) { var vs = document.querySelectorAll('#clWin .cl-tile:not(.me) video'); return vs.length === n && Array.prototype.every.call(vs, function (v) { return v.srcObject && v.srcObject.getAudioTracks().length; }); }, n, ms); }

  var A, K, L;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com'); L = await open('lee@t.com');
    var a = A.p, k = K.p, l = L.p;
    var room = await a.evaluate(function (ids) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '현장 통화', userIds: ids }) }).then(function (r) { return r.data.id; }); }, [kim.id, lee.id]);
    for (var p of [a, k, l]) { await p.click('#hdrMsgBtn'); await p.evaluate(function (r) { chatOpenRoom(r); }, room); await until(p, function () { return CX.info; }); }
    check(await a.evaluate(function () { return !!document.querySelector('#cxHead [data-h="vcall"]') && !!document.querySelector('#cxHead [data-h="call"]'); }), '방 머리 📞 · 🎥 단추 (좁으면 🎥 는 ⋯ 안)');

    // 🎥 시작 → 울림
    await headBtn(a, 'vcall', '영상 통화');
    check(await until(a, function () { return document.getElementById('clWin') && CALL && CALL.video; }), '관리자 통화 창 (영상)');
    var rk = await until(k, function () { var r = document.getElementById('clRing'); return r && /관리자/.test(r.textContent) && /영상 통화/.test(r.textContent); });
    var rl = await until(l, function () { return !!document.getElementById('clRing'); });
    check(rk && rl, '김팀원 · 이팀원에게 울림 (받기 · 거절)');
    check(await until(k, function () { return /영상 통화를 시작했습니다/.test(document.getElementById('cxMsgs').textContent) && document.querySelector('#cxMsgs [data-calljoin]'); }), '방에 통화 카드 · [참여]');
    await k.screenshot({ path: path.join(SHOT, 'e2e64-ring.png') });

    // 김팀원 영상으로 · 이팀원 음성으로 받기
    await k.click('#clRing [data-vid]');
    await l.click('#clRing [data-aud]');
    var mA = await videosOk(a, 2, 20000);
    var mK = await videosOk(k, 2, 20000);
    var mL = await videosOk(l, 2, 20000);
    check(mA && mK && mL, '세 사람 서로 연결 (각자 상대 2명 · 소리)');
    var vidA = await until(a, function (uid) { var t = document.querySelector('#clWin [data-tile="' + uid + '"]'); var v = t && t.querySelector('video'); return t && !t.classList.contains('novid') && v.videoWidth > 0; }, kim.id, 15000);
    check(vidA, '관리자 화면에 김팀원 영상');
    var leeNoVid = await a.evaluate(function (uid) { var t = document.querySelector('#clWin [data-tile="' + uid + '"]'); return t && t.classList.contains('novid'); }, lee.id);
    check(leeNoVid, '음성으로 받은 이팀원은 얼굴 대신 아바타');
    await a.screenshot({ path: path.join(SHOT, 'e2e64-call-admin.png') });

    // 이팀원 📷 켜기 → 관리자 화면에 영상 (다시 연결 없이 자리 바꾸기)
    await l.click('#clWin [data-cam]');
    check(await until(a, function (uid) { var t = document.querySelector('#clWin [data-tile="' + uid + '"]'); var v = t && t.querySelector('video'); return v && v.videoWidth > 0; }, lee.id, 15000), '이팀원 📷 켜면 관리자 화면에 영상');
    // 🎤 끄기
    await k.click('#clWin [data-mic]');
    check(await k.evaluate(function () { return CALL.muted && !CALL.local.getAudioTracks()[0].enabled && document.querySelector('#clWin [data-mic]').classList.contains('off'); }), '🎤 끄기');
    // 서버가 아는 통화
    var srv = await a.evaluate(function () { return apiFetch('/api/chat/rooms/' + CX.room + '/call').then(function (r) { return r.data; }); });
    check(srv && srv.users.length === 3, '서버 — 통화 중 3명');

    // 끊기: 김팀원 → 나머지 둘은 계속 · 관리자 · 이팀원 끊으면 끝
    await k.click('#clWin [data-end]');
    check(await videosOk(a, 1, 8000), '김팀원 끊으면 관리자 화면 상대 1명');
    await l.click('#clWin [data-end]');
    await a.click('#clWin [data-end]');
    check(await until(k, function () { return /통화가 끝났습니다 · \d+분/.test(document.getElementById('cxMsgs').textContent) && !document.querySelector('#cxMsgs [data-calljoin]') && /통화 끝/.test(document.querySelector('#cxMsgs .cl-card').textContent); }, null, 8000), '모두 나가면 "통화가 끝났습니다 · N분" · 카드 [참여] 없어짐');
    check(await a.evaluate(function () { return !CALL && !document.getElementById('clWin'); }), '통화 창 닫힘');

    // 거절
    await headBtn(a, 'call', '음성 통화');
    await until(k, function () { return !!document.getElementById('clRing'); });
    await k.click('#clRing [data-no]');
    check(await until(a, function () { return Array.prototype.some.call(document.querySelectorAll('.wa-toast, .toast, [class*="toast"]'), function (t) { return /받지 않았습니다/.test(t.textContent); }); }, null, 6000), '거절 → "받지 않았습니다" 안내');
    await a.evaluate(function () { chatCallLeave(); });
    await l.evaluate(function () { if (typeof _clStopRing === 'function') _clStopRing(); });
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { for (var x of [A, K, L]) if (x) await x.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
