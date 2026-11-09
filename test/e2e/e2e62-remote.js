// 🖱 화면 공유 원격 제어 (v13.360) — 관리자(PC 앱 흉내: window.wmDesktop 가짜) 가 공유 · 김팀원(브라우저)이 제어
//   [제어 요청] → 공유하는 쪽 막대에 허락/거절 → 허락하면 마우스 · 클릭 · 휠 · 글자 · 특수키가 데이터 채널로 PC 앱에 → 끝내기
//   실제 윈도우 입력(SendInput)은 PC 앱(desktop/remote-input.js) 몫이라 여기선 PC 앱에 도착하는 것까지 본다
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
  async function open(email, desktop) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { d.accept(); });
    if (desktop) await p.evaluateOnNewDocument(function () {
      window.__ctl = []; window.__in = []; var stop = null;
      window.wmDesktop = { isDesktop: true, platform: 'win32', notify: function () {}, setBadge: function () {}, onGo: function () {}, retry: function () {},
        remoteControl: function (on) { window.__ctl.push(on); }, remoteInput: function (ev) { window.__in.push(ev); }, onCtlStop: function (cb) { stop = cb; }, __stop: function () { stop && stop(); } };
    });
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

  var A, K;
  try {
    A = await open('admin@t.com', true); K = await open('kim@t.com', false);
    var a = A.p, k = K.p;
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: uid }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.click('#hdrMsgBtn'); await k.click('#hdrMsgBtn');
    await a.evaluate(function (r) { chatOpenRoom(r); }, room); await k.evaluate(function (r) { chatOpenRoom(r); }, room);
    await until(a, function () { return CX.info; }); await until(k, function () { return CX.info; });

    // 공유 (가짜 화면 1280×720)
    await a.evaluate(function () {
      var cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; var g = cv.getContext('2d'), n = 0;
      setInterval(function () { g.fillStyle = 'hsl(' + (n++ * 10 % 360) + ',60%,50%)'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#fff'; g.font = '60px sans-serif'; g.fillText('원격 PC 화면', 420, 380); }, 100);
      navigator.mediaDevices.getDisplayMedia = function () { return Promise.resolve(cv.captureStream(10)); };
      chatRtcShare(CX.room);
    });
    await until(k, function () { return !!document.querySelector('#cxMsgs [data-watch]'); });
    await k.evaluate(function () { document.querySelector('#cxMsgs [data-watch]').click(); });
    check(await until(k, function () { var v = document.querySelector('#crtWin video'); return v && v.videoWidth > 0; }, null, 15000), '공유 영상 보임');
    // v13.416 화질 — 글자 화면(detail) · 해상도 유지 · 비트레이트 상한 · 마우스 이동 전용 채널
    var q = await a.evaluate(function () {
      var pc = CRT.viewers[Object.keys(CRT.viewers)[0]], sd = pc.getSenders().filter(function (x) { return x.track && x.track.kind === 'video'; })[0], pr = sd.getParameters();
      return { hint: sd.track.contentHint, deg: pr.degradationPreference, max: pr.encodings[0].maxBitrate, fps: pr.encodings[0].maxFramerate };
    });
    check(q.hint === 'detail' && q.deg === 'maintain-resolution' && q.max === 4000000 && q.fps === 15, '화면 공유 — 해상도 유지 · 4Mbps · 15fps ' + JSON.stringify(q));
    await new Promise(function (r) { setTimeout(r, 2500); });
    var rw = await k.evaluate(function () { var v = document.querySelector('#crtWin video'); return v.videoWidth; });
    check(rw === 1280, '받는 쪽 해상도 그대로 (' + rw + 'px — 예전엔 줄어 보냄)');
    check(await until(k, function () { return CRT.watch && CRT.watch.dcm && CRT.watch.dcm.readyState === 'open'; }), '마우스 이동 전용 채널(순서 · 재전송 없음) 열림');
    check(await until(k, function () { var b = document.querySelector('#crtWin [data-ctl]'); return b && !b.hidden && /제어 요청/.test(b.textContent); }), '상대가 PC 앱 → [🖱 제어 요청] 단추');

    // 요청 → 허락
    await k.click('#crtWin [data-ctl]');
    check(await until(a, function () { var b = document.getElementById('crtBar'); return b && b.classList.contains('ask') && /김팀원 님이 내 화면 제어를 요청/.test(b.textContent); }), '공유하는 쪽 — "제어를 요청합니다" 허락 · 거절');
    await a.screenshot({ path: path.join(SHOT, 'e2e62-ask.png'), clip: { x: 300, y: 0, width: 800, height: 80 } });
    await a.click('#crtBar [data-ok]');
    check(await until(a, function () { return window.__ctl[0] === true && /제어 중/.test(document.getElementById('crtBar').textContent); }), '허락 → PC 앱 제어 켬 · 막대 "제어 중"');
    check(await until(a, function () { var pc = CRT.viewers[Object.keys(CRT.viewers)[0]], sd = pc.getSenders().filter(function (x) { return x.track && x.track.kind === 'video'; })[0], e = sd.getParameters().encodings[0]; return e.maxFramerate === 30 && e.maxBitrate === 6000000; }), '제어 중 — 30fps · 6Mbps 로 올림');
    // v13.414 좁은 창에서도 띠는 한 줄 · 화면 안
    for (var vw of [1400, 516, 360]) {
      await a.setViewport({ width: vw, height: 900 }); await new Promise(function (r) { setTimeout(r, 150); });
      var bm = await a.evaluate(function () { var b = document.getElementById('crtBar'), r = b.getBoundingClientRect(); return { h: r.height, l: r.left, r: r.right, w: innerWidth, btn: Array.from(b.querySelectorAll('button')).every(function (x) { return x.getBoundingClientRect().height < 30; }) }; });
      check(bm.h <= 36 && bm.l >= 0 && bm.r <= bm.w && bm.btn, '제어 중 띠 ' + vw + 'px — 한 줄(' + Math.round(bm.h) + 'px) · 화면 안');
      await a.screenshot({ path: path.join(SHOT, 'e2e62-ctl-' + vw + '.png'), clip: { x: 0, y: 0, width: vw, height: 60 } });
    }
    await a.setViewport({ width: 1400, height: 900 });
    check(await until(k, function () { var w = document.getElementById('crtWin'); return w && w.classList.contains('ctl') && /제어 끝내기/.test(w.querySelector('[data-ctl]').textContent); }), '보는 쪽 — 제어 중 표시');
    var sys = await until(a, function () { return /화면 제어를 허락했습니다/.test(document.getElementById('cxMsgs').textContent); });
    check(sys, '방에 기록 — "화면 제어를 허락했습니다"');

    // 마우스: 영상 가운데 → (0.5, 0.5) 쯤 · 클릭 · 오른쪽 클릭 · 휠
    var r = await k.evaluate(function () { var v = document.querySelector('#crtWin video').getBoundingClientRect(); return { x: v.left + v.width / 2, y: v.top + v.height / 2, w: v.width, h: v.height, l: v.left, t: v.top }; });
    await k.mouse.move(r.x - 40, r.y - 20); await wait(60); await k.mouse.move(r.x, r.y); await wait(60);
    await k.mouse.click(r.x, r.y);
    await k.mouse.click(r.x, r.y, { button: 'right' });
    await k.mouse.wheel({ deltaY: 200 });
    await wait(150);
    // 키보드: 글자 · Enter · Ctrl+C
    await k.keyboard.type('abc');
    await k.keyboard.press('Enter');
    await k.keyboard.down('Control'); await k.keyboard.press('KeyC'); await k.keyboard.up('Control');
    var got = await until(a, function () {
      var e = window.__in, s = function (t) { return e.filter(function (x) { return x.t === t; }); };
      var mm = s('mm').pop(), md = s('md'), tx = s('tx').map(function (x) { return x.s; }).join('');
      return mm && Math.abs(mm.x - 0.5) < 0.03 && Math.abs(mm.y - 0.5) < 0.03 && md.length >= 2 && md.some(function (x) { return x.b === 2; }) && s('mu').length >= 2 && s('wh').length && s('wh')[0].dy === -120 &&
        tx === 'abc' && s('kd').some(function (x) { return x.k === 'Enter'; }) && s('kd').some(function (x) { return x.k === 'KeyC'; }) && s('kd').some(function (x) { return /Control/.test(x.k); });
    }, null, 6000);
    var summary = await a.evaluate(function () { var c = {}; window.__in.forEach(function (x) { c[x.t] = (c[x.t] || 0) + 1; }); return JSON.stringify(c) + ' tx=' + window.__in.filter(function (x) { return x.t === 'tx'; }).map(function (x) { return x.s; }).join(''); });
    check(got, '마우스 이동(가운데 0.5,0.5) · 클릭 · 오른쪽 · 휠 · 글자 abc · Enter · Ctrl+C 가 PC 앱에 ' + summary);
    await k.screenshot({ path: path.join(SHOT, 'e2e62-control-kim.png') });

    // Ctrl+Alt+End (PC 앱) → 끝
    await a.evaluate(function () { window.wmDesktop.__stop(); });
    check(await until(a, function () { return window.__ctl[window.__ctl.length - 1] === false && !/제어 중/.test(document.getElementById('crtBar').textContent); }), 'Ctrl+Alt+End → 제어 끔');
    check(await until(k, function () { var w = document.getElementById('crtWin'); return w && !w.classList.contains('ctl') && /제어 요청/.test(w.querySelector('[data-ctl]').textContent); }), '보는 쪽도 제어 풀림');
    var n0 = await a.evaluate(function () { return window.__in.length; });
    await k.mouse.move(r.x + 50, r.y + 50); await k.mouse.click(r.x + 50, r.y + 50); await wait(400);
    check(await a.evaluate(function (n) { return window.__in.length === n; }, n0), '끝난 뒤 입력은 안 감');

    // 다시 요청 → 거절
    await k.click('#crtWin [data-ctl]');
    await until(a, function () { return document.querySelector('#crtBar [data-no]'); });
    await a.click('#crtBar [data-no]');
    check(await until(k, function () { return /거절/.test(document.querySelector('#crtWin .crt-msg').textContent); }), '거절 → 보는 쪽에 안내');
    // v13.413 🔓 자동 허락 — ① 이번 공유 동안 모두
    await a.evaluate(function () { localStorage.removeItem(_crtAutoKey()); });
    await until(a, function () { return document.querySelector('#crtBar [data-auto]'); });
    await a.click('#crtBar [data-auto]');
    check(await until(a, function () { return /자동 허락 켬/.test(document.getElementById('crtBar').textContent); }), '공유 띠 [자동 허락] 켬');
    await until(k, function () { return /제어 요청/.test(document.querySelector('#crtWin [data-ctl]').textContent) && !/기다리/.test(document.querySelector('#crtWin .crt-msg').textContent); });
    await k.click('#crtWin [data-ctl]');
    check(await until(a, function () { return /제어 중/.test(document.getElementById('crtBar').textContent) && window.__ctl[window.__ctl.length - 1] === true; }), '자동 허락 켬 → 묻지 않고 바로 제어 중');
    await a.click('#crtBar [data-ctlx]');
    await until(a, function () { return document.querySelector('#crtBar [data-auto]'); });
    await a.click('#crtBar [data-auto]');   // 끔
    // ② [항상 허락] → 다음엔 묻지 않음
    await until(k, function () { var w = document.getElementById('crtWin'); return w && !w.classList.contains('ctl'); });
    await k.click('#crtWin [data-ctl]');
    check(await until(a, function () { return document.querySelector('#crtBar [data-always]'); }), '자동 허락 끄면 다시 물어봄 · [항상 허락] 단추');
    await a.click('#crtBar [data-always]');
    check(await until(a, function () { return /제어 중/.test(document.getElementById('crtBar').textContent) && Object.keys(_crtAutoList()).length === 1; }), '[항상 허락] → 제어 중 · 목록에 저장');
    await a.click('#crtBar [data-ctlx]');
    await until(k, function () { var w = document.getElementById('crtWin'); return w && !w.classList.contains('ctl'); });
    check(await until(a, function () { return /⭐ 1/.test(document.getElementById('crtBar').textContent); }), '공유 띠에 ⭐ 1 (항상 허락 1명)');
    await k.click('#crtWin [data-ctl]');
    check(await until(a, function () { return /제어 중/.test(document.getElementById('crtBar').textContent) && !document.querySelector('#crtBar.ask'); }), '항상 허락한 사람 → 다음 요청은 바로 제어 중');
    await a.screenshot({ path: path.join(SHOT, 'e2e62-auto.png'), clip: { x: 200, y: 0, width: 1000, height: 80 } });
    await a.click('#crtBar [data-ctlx]');
    await until(a, function () { return document.querySelector('#crtBar [data-trust]'); });
    await a.click('#crtBar [data-trust]');   // confirm → 수락(비움)
    check(await until(a, function () { return !document.querySelector('#crtBar [data-trust]') && !Object.keys(_crtAutoList()).length; }), '⭐ → 목록 비우기');
    await a.screenshot({ path: path.join(SHOT, 'e2e62-auto-off.png'), clip: { x: 200, y: 0, width: 1000, height: 80 } });

    await a.evaluate(function () { chatRtcStop(); });
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (A) await A.b.close(); if (K) await K.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
