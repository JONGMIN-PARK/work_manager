// 🎤 발표 펜 (v13.368) — 관리자가 화면 공유(가짜 화면) · 김팀원이 봄
//   발표 펜 창 → 펜 · 형광펜(진하게) · 화살표 · 글자 · 레이저가 보는 쪽에 · 발표자만(보는 쪽 막대 잠김) → 모두 그리기 → 보는 쪽 사각형이 발표자에게
//   → 되돌리기 · 사라지는 잉크 · 모두 지우기 · 공유 끝
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
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
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
  async function box(p, sel) { return p.evaluate(function (s) { var b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, sel); }
  async function drag(p, sel, x1, y1, x2, y2) {   // 비율 좌표로 끌기
    var r = await box(p, sel);
    await p.mouse.move(r.x + r.w * x1, r.y + r.h * y1); await p.mouse.down();
    for (var i = 1; i <= 8; i++) { await p.mouse.move(r.x + r.w * (x1 + (x2 - x1) * i / 8), r.y + r.h * (y1 + (y2 - y1) * i / 8)); await wait(25); }
    await p.mouse.up();
  }
  async function key(p, k) { await p.evaluate(function () { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }); await p.keyboard.press(k); }
  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: uid }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.click('#hdrMsgBtn'); await k.click('#hdrMsgBtn');
    await a.evaluate(function (r) { chatOpenRoom(r); }, room); await k.evaluate(function (r) { chatOpenRoom(r); }, room);
    await until(a, function () { return CX.info; }); await until(k, function () { return CX.info; });
    await a.evaluate(function () {
      var cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; var g = cv.getContext('2d');
      setInterval(function () { g.fillStyle = '#F8FAFC'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#0F172A'; g.font = 'bold 56px sans-serif'; g.fillText('3분기 설비 가동률 보고', 120, 140); g.font = '34px sans-serif'; ['라인 A  92%', '라인 B  78%  (조명 교체)', '라인 C  88%'].forEach(function (t, i) { g.fillText(t, 160, 280 + i * 90); }); }, 100);
      navigator.mediaDevices.getDisplayMedia = function () { return Promise.resolve(cv.captureStream(10)); };
      chatRtcShare(CX.room);
    });
    await until(k, function () { return !!document.querySelector('#cxMsgs [data-watch]'); });
    await k.evaluate(function () { document.querySelector('#cxMsgs [data-watch]').click(); });
    check(await until(k, function () { var v = document.querySelector('#crtWin video'); return v && v.videoWidth > 0 && CI.role === 'view' && CI.dc && CI.dc.readyState === 'open'; }, null, 15000), '보는 쪽 — 영상 · 발표 펜 채널 열림');
    check(await until(k, function () { var t = document.querySelector('#crtWin .ci-tb'); return t && t.classList.contains('off') && /발표자만/.test(t.textContent); }), '보는 쪽 막대 — "발표자만 그립니다" (잠김)');

    // 발표 펜 창
    check(await until(a, function () { return document.querySelector('#crtBar [data-ink]'); }), '공유 막대에 ✎ 발표 펜');
    await a.click('#crtBar [data-ink]');
    check(await until(a, function () { var v = document.querySelector('#ciHost video'); return v && v.videoWidth > 0 && CI.tool === 'pen' && document.querySelector('#ciHost .ci-b[data-ct="pen"].on'); }), '발표 펜 창 — 내 화면 미리보기 · 펜 켜짐');
    await a.click('#ciHost [data-cfade]');   // 남는 잉크로
    await drag(a, '#ciHost .ci-cv', 0.15, 0.62, 0.55, 0.66);
    check(await until(k, function () { return CI.strokes.length === 1 && CI.strokes[0].t === 'pen' && CI.strokes[0].done && CI.strokes[0].p.length > 6; }), '펜 → 보는 쪽에 그대로');
    await key(a, 'h'); await key(a, 'b'); await key(a, '3'); await key(a, 'h');
    await drag(a, '#ciHost .ci-cv', 0.12, 0.505, 0.5, 0.505);
    check(await until(k, function () { var s = CI.strokes[1]; return s && s.t === 'hl' && s.b && s.c === '#FACC15'; }), '형광펜 · 진하게 · 노랑 (단축키 H · B · 3)');
    await key(a, 'b'); await key(a, '1'); await key(a, 'a');
    await drag(a, '#ciHost .ci-cv', 0.85, 0.85, 0.62, 0.64);
    check(await until(k, function () { var s = CI.strokes[2]; return s && s.t === 'arrow' && s.c === '#EF4444' && Math.abs(s.x2 - 0.62) < 0.03; }), '화살표 (A) — 같은 자리 비율로');
    await key(a, 't');
    var cr = await box(a, '#ciHost .ci-cv');
    await a.mouse.click(cr.x + cr.w * 0.66, cr.y + cr.h * 0.88);
    await a.waitForSelector('#ciHost .ci-txt');
    await a.type('#ciHost .ci-txt', '원인 확인'); await a.keyboard.press('Enter');
    check(await until(k, function () { return CI.strokes.some(function (s) { return s.t === 'text' && s.s === '원인 확인'; }); }), '글자 (T)');
    await key(a, 'l');
    await a.mouse.move(cr.x + cr.w * 0.3, cr.y + cr.h * 0.3); await wait(60); await a.mouse.move(cr.x + cr.w * 0.35, cr.y + cr.h * 0.32); await wait(60); await a.mouse.move(cr.x + cr.w * 0.4, cr.y + cr.h * 0.33);
    check(await until(k, function (id) { return !!CI.ptr[id]; }, adm.id), '레이저 포인터 (L) — 누르지 않아도 따라감');
    await k.evaluate(function () { document.getElementById('crtWin').classList.add('big'); });
    await wait(400);
    var px = await k.evaluate(function () { var cv = document.querySelector('#crtWin .ci-cv'), g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data, n = 0; for (var i = 3; i < d.length; i += 16) if (d[i] > 0) n++; return n; });
    check(px > 200, '보는 쪽 화면 위에 실제로 그려짐 (' + px + ')');
    await k.screenshot({ path: path.join(SHOT, 'e2e70-viewer.png') });
    await a.screenshot({ path: path.join(SHOT, 'e2e70-host.png') });

    // 보는 쪽은 아직 못 그림
    await k.evaluate(function () { chatInkSetTool('pen'); });
    check(await k.evaluate(function () { return CI.tool === null; }), '발표자만일 때 보는 쪽 펜 못 켬');
    // 모두 그리기
    await a.click('#ciHost [data-callow]');
    check(await until(k, function () { var t = document.querySelector('#crtWin .ci-tb'); return CI.allow === 'all' && t && !t.classList.contains('off'); }), '모두 그리기 → 보는 쪽 막대 풀림');
    await k.click('#crtWin [data-ct="rect"]');
    await k.click('#crtWin [data-cfade]');
    await drag(k, '#crtWin .ci-cv', 0.1, 0.25, 0.6, 0.45);
    check(await until(a, function (id) { return CI.strokes.some(function (s) { return s.t === 'rect' && s.by === id; }); }, kim.id), '보는 쪽 사각형 → 발표자에게');
    await key(k, 'z');
    check(await until(a, function (id) { return !CI.strokes.some(function (s) { return s.by === id; }); }, kim.id), '되돌리기 (Z) → 발표자에게서도 지워짐');
    // 사라지는 잉크
    await a.click('#ciHost [data-cfade]'); await key(a, 'p');
    var before = await k.evaluate(function () { return CI.strokes.length; });
    await drag(a, '#ciHost .ci-cv', 0.2, 0.2, 0.4, 0.22);
    check(await until(k, function (n) { return CI.strokes.length === n + 1; }, before), '사라지는 잉크 — 나타남');
    check(await until(k, function (n) { return CI.strokes.length === n; }, before, 6000), '사라지는 잉크 — 3초 뒤 저절로 지워짐');
    // 모두 지우기
    await key(a, 'c');
    check(await until(k, function () { return CI.strokes.length === 0; }), '모두 지우기 (C)');
    // 끝
    await a.evaluate(function () { chatRtcStop(); });
    check(await until(a, function () { return !document.getElementById('ciHost') && CI.role === null; }), '공유 끝 → 발표 펜 창 닫힘');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (A) await A.b.close(); if (K) await K.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
