// 🎤 발표 펜 2단계 (v13.369) — ① 번호 · 🔦 스포트라이트 · 🔍 돋보기 · 화면 바뀌면 자동 지움 · 📸 그림까지 캡처 → 방에 사진
//   · PC 앱 투명 창: 관리자는 가짜 PC 앱(window.wmDesktop) — 발표 펜 = 투명 창 열기 → 투명 창에서 온 잉크가 보는 쪽에 · 보는 쪽 잉크가 투명 창으로
//   · 투명 창 화면(pwa/ink-overlay.html → /ink-overlay)을 그대로 띄워 서버의 chat-ink.js 로 도구 막대 · 그리기 → 웹 화면으로 보냄
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
  var browsers = [];
  async function launch(tag) { var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--allow-file-access-from-files'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + tag + Date.now()) }); browsers.push(b); return b; }
  async function open(email, desktop) {
    var b = await launch(email);
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { d.accept(); });
    if (desktop) await p.evaluateOnNewDocument(function () {
      window.__ovl = []; window.__ovlOpen = 0; var inkCb = null;
      window.wmDesktop = { isDesktop: true, platform: 'win32', notify: function () {}, setBadge: function () {}, onGo: function () {}, retry: function () {}, onCtlStop: function () {},
        inkOverlay: function () { window.__ovlOpen++; }, inkClose: function () { window.__ovlOpen = 0; setTimeout(function () { inkCb && inkCb({ t: 'ovl-closed' }); }, 10); },
        inkSend: function (m) { window.__ovl.push(m); }, onInk: function (cb) { inkCb = cb; }, __fromOvl: function (m) { inkCb && inkCb(m); } };
    });
    await p.setViewport({ width: 1400, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.waitForFunction(function () { return typeof CXS !== 'undefined' && CXS.on; }, { timeout: 10000 }).catch(function () {});
    return p;
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  async function box(p, sel) { return p.evaluate(function (s) { var b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, sel); }
  async function key(p, k) { await p.evaluate(function () { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }); await p.keyboard.press(k); }
  try {
    var a = await open('admin@t.com', false), k = await open('kim@t.com', false);
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: uid }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.click('#hdrMsgBtn'); await k.click('#hdrMsgBtn');
    await a.evaluate(function (r) { chatOpenRoom(r); }, room); await k.evaluate(function (r) { chatOpenRoom(r); }, room);
    await until(a, function () { return CX.info; }); await until(k, function () { return CX.info; });
    // 슬라이드 두 장을 번갈아 보여 줄 수 있는 가짜 화면
    async function share(p) {
      await p.evaluate(function () {
        var cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; var g = cv.getContext('2d'); window.__slide = 1;
        setInterval(function () {
          var s = window.__slide; g.fillStyle = s === 1 ? '#F8FAFC' : '#0F172A'; g.fillRect(0, 0, 1280, 720); g.fillStyle = s === 1 ? '#0F172A' : '#F8FAFC';
          g.font = 'bold 56px sans-serif'; g.fillText(s === 1 ? '슬라이드 1 — 가동률' : '슬라이드 2 — 다음 계획', 120, 140);
          g.font = '28px sans-serif'; for (var i = 0; i < 6; i++) g.fillText('작은 글씨 항목 ' + (i + 1) + ' — 센서 값 0.' + (i * 7 + 13), 160, 260 + i * 60);
        }, 100);
        navigator.mediaDevices.getDisplayMedia = function () { return Promise.resolve(cv.captureStream(10)); };
        chatRtcShare(CX.room);
      });
    }
    async function watch() {
      await until(k, function () { var b = document.querySelectorAll('#cxMsgs [data-watch]'); return b.length && !document.querySelector('#crtWin'); });
      await k.evaluate(function () { var b = document.querySelectorAll('#cxMsgs [data-watch]'); b[b.length - 1].click(); });
      return until(k, function () { var v = document.querySelector('#crtWin video'); return v && v.videoWidth > 0 && CI.dc && CI.dc.readyState === 'open'; }, null, 15000);
    }
    await share(a);
    check(await watch(), '보는 쪽 연결');
    await k.evaluate(function () { document.getElementById('crtWin').classList.add('big'); });
    await a.click('#crtBar [data-ink]');
    await until(a, function () { var v = document.querySelector('#ciHost video'); return v && v.videoWidth > 0; });
    await a.click('#ciHost [data-cfade]');   // 남는 잉크
    var cr = await box(a, '#ciHost .ci-cv');
    // ① 번호
    await key(a, 'n');
    await a.mouse.click(cr.x + cr.w * 0.1, cr.y + cr.h * 0.36); await a.mouse.click(cr.x + cr.w * 0.1, cr.y + cr.h * 0.53);
    check(await until(k, function () { var n = CI.strokes.filter(function (s) { return s.t === 'num'; }).map(function (s) { return s.n; }); return n.join(',') === '1,2'; }), '번호 (N) — ① ② 차례로');
    // 🔦 스포트라이트
    await key(a, 's');
    await a.mouse.move(cr.x + cr.w * 0.4, cr.y + cr.h * 0.45); await wait(60); await a.mouse.move(cr.x + cr.w * 0.42, cr.y + cr.h * 0.46);
    check(await until(k, function () { return CI.spot && Math.abs(CI.spot.x - 0.42) < 0.03; }), '스포트라이트 (S) — 보는 쪽에 따라감');
    var dim = await k.evaluate(function () { var L = CI.layers[0], R = _ciRect(L), dpr = window.devicePixelRatio || 1, g = L.cv.getContext('2d'); var d = g.getImageData(Math.round((R.x + 8) * dpr), Math.round((R.y + 8) * dpr), 1, 1).data; return d[3]; });
    check(dim > 120, '스포트라이트 — 바깥이 어두움 (' + dim + ')');
    await wait(200); await k.screenshot({ path: path.join(SHOT, 'e2e71-spot.png') });
    // 🔍 돋보기
    await key(a, 'g');
    check(await until(k, function () { return !CI.spot; }), '도구 바꾸면 스포트라이트 꺼짐');
    await a.mouse.move(cr.x + cr.w * 0.3, cr.y + cr.h * 0.6); await wait(60); await a.mouse.move(cr.x + cr.w * 0.32, cr.y + cr.h * 0.62);
    check(await until(k, function () { return CI.mag && CI.mag.z >= 2; }), '돋보기 (G) — 보는 쪽에');
    await wait(300); await k.screenshot({ path: path.join(SHOT, 'e2e71-mag.png') });
    await key(a, 'v');
    check(await until(k, function () { return !CI.mag; }), '끄면 돋보기 사라짐');
    // 📸 그림까지 캡처 (보는 쪽에서)
    await k.click('#crtWin [data-csnap]');
    check(await until(k, function () { return CX.msgs.some(function (m) { return m.file && /^발표 캡처/.test(m.file.name); }); }, null, 10000), '📸 그림까지 캡처 → 방에 사진');
    // 화면 바뀌면 자동 지움
    await a.click('#ciHost [data-cauto]');
    check(await until(a, function () { return CI.auto && document.querySelector('#ciHost [data-cauto].on'); }), '자동 지우기 켬');
    await wait(1600);
    await a.evaluate(function () { window.__slide = 2; });
    check(await until(k, function () { return !CI.strokes.some(function (s) { return !s.f; }); }, null, 8000), '슬라이드가 바뀌면 남는 잉크 자동으로 지움');
    await a.evaluate(function () { chatRtcStop(); });
    await until(k, function () { return !document.getElementById('crtWin'); }, null, 6000);
    await k.evaluate(function () { var w = document.getElementById('crtWin'); if (w) chatRtcLeave(); });

    // ─── PC 앱 투명 창 중계 ───
    var d = await open('admin@t.com', true);
    await d.click('#hdrMsgBtn'); await d.evaluate(function (r) { chatOpenRoom(r); }, room); await until(d, function () { return CX.info; });
    await share(d);
    check(await watch(), 'PC 앱 공유 — 보는 쪽 연결');
    await d.click('#crtBar [data-ink]');
    check(await until(d, function () { return window.__ovlOpen === 1 && CI.ovl && !document.getElementById('ciHost') && /끄기/.test(document.querySelector('#crtBar [data-ink]').textContent); }), 'PC 앱 — 발표 펜 = 투명 창 (미리보기 창 대신)');
    await d.evaluate(function () { window.wmDesktop.__fromOvl({ t: 'ready' }); });
    check(await until(d, function () { return window.__ovl.some(function (m) { return m.t === 'sync'; }); }), '투명 창 준비 → 남은 잉크 보냄');
    await d.evaluate(function () { window.wmDesktop.__fromOvl({ t: 's', s: { id: CI_ME() + ':1', by: CI_ME(), t: 'arrow', c: '#EF4444', w: 1, x: 0.8, y: 0.8, x2: 0.5, y2: 0.5, done: true } }); function CI_ME() { return currentUser.id || currentUser.sub; } });
    check(await until(k, function () { return CI.strokes.some(function (s) { return s.t === 'arrow' && s.x2 === 0.5; }); }), '투명 창에서 그린 화살표 → 보는 쪽에');
    await d.evaluate(function () { window.wmDesktop.__fromOvl({ t: 'st', allow: 'all' }); });
    check(await until(k, function () { return CI.allow === 'all'; }), '투명 창에서 "모두 그리기" → 보는 쪽 풀림');
    await k.evaluate(function () { chatInkSetTool('pen'); CI.fade = false; });
    var kr = await box(k, '#crtWin .ci-cv');
    await k.mouse.move(kr.x + kr.w * 0.2, kr.y + kr.h * 0.3); await k.mouse.down();
    for (var i = 1; i <= 6; i++) { await k.mouse.move(kr.x + kr.w * (0.2 + i * 0.04), kr.y + kr.h * 0.3); await wait(25); }
    await k.mouse.up();
    check(await until(d, function (uid) { return window.__ovl.some(function (m) { return m.t === 's' && m.s.by === uid && m.s.done; }); }, kim.id), '보는 쪽 펜 → 투명 창으로 전달');
    await d.evaluate(function () { chatInkHostToggle(); });
    check(await until(d, function () { return !CI.ovl && /발표 펜$/.test(document.querySelector('#crtBar [data-ink]').textContent.trim()); }), '발표 펜 끄기 → 투명 창 닫힘');
    await d.evaluate(function () { chatRtcStop(); });

    // ─── 투명 창 화면 그대로 (pwa/ink-overlay.html → /ink-overlay) ───
    var ob = await launch('ovl'), o = (await ob.pages())[0] || await ob.newPage();
    o.on('pageerror', function (e) { errs.push('overlay: ' + e.message); });
    await o.evaluateOnNewDocument(function () {
      window.__out = []; window.__mouse = []; var msgCb = null, cmdCb = null;
      window.wmInk = { send: function (m) { window.__out.push(m); }, onMsg: function (cb) { msgCb = cb; }, onCmd: function (cb) { cmdCb = cb; }, mouse: function (on, f) { window.__mouse.push(on); }, close: function () { window.__closed = 1; }, __msg: function (m) { msgCb && msgCb(m); }, __cmd: function (c) { cmdCb && cmdCb(c); } };
    });
    await o.setViewport({ width: 1280, height: 720 });
    var url = 'http://localhost:3000/ink-overlay?me=' + adm.id;
    await o.goto(url, { waitUntil: 'networkidle0' });
    check(await until(o, function () { return typeof CI !== 'undefined' && CI.relay && document.querySelector('#bar .ci-tb .ci-b') && window.__out.some(function (m) { return m.t === 'ready'; }); }), '투명 창 — 서버 chat-ink.js 로 막대 · 준비 알림');
    check(await o.evaluate(function () { return getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)' && window.__mouse[window.__mouse.length - 1] === false; }), '투명 배경 · 도구 없으면 마우스는 아래로');
    await o.evaluate(function () { window.wmInk.__cmd('pen'); });
    check(await o.evaluate(function () { return CI.tool === 'pen' && window.__mouse[window.__mouse.length - 1] === true; }), 'Ctrl+Alt+P(전역) → 펜 · 마우스 잡음');
    await o.mouse.move(300, 300); await o.mouse.down(); for (var j = 1; j <= 6; j++) { await o.mouse.move(300 + j * 40, 320); await wait(25); } await o.mouse.up();
    check(await until(o, function () { return window.__out.some(function (m) { return m.t === 's' && m.s.t === 'pen' && m.s.done && Math.abs(m.s.p[0] - 300 / 1280) < 0.01; }); }), '투명 창 펜 → 화면 비율 좌표로 웹 화면에');
    await o.evaluate(function () { window.wmInk.__msg({ t: 's', s: { id: 'k:1', by: 'k', t: 'rect', c: '#3B82F6', w: 1, x: 0.5, y: 0.5, x2: 0.7, y2: 0.7, done: true } }); });
    check(await until(o, function () { return CI.strokes.some(function (s) { return s.id === 'k:1'; }); }), '보는 사람 잉크가 투명 창에 그려짐');
    await o.keyboard.press('Escape');
    check(await o.evaluate(function () { return CI.tool === null && window.__mouse[window.__mouse.length - 1] === false; }), 'Esc → 아래 화면 다시 조작');
    await o.evaluate(function () { document.body.style.background = '#334155'; });
    await o.screenshot({ path: path.join(SHOT, 'e2e71-overlay.png') });
    await o.click('#end');
    check(await o.evaluate(function () { return window.__closed === 1; }), '끝내기 → 창 닫기');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { for (var b of browsers) await b.close().catch(function () {}); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
