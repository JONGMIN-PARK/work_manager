// 🎤 발표 모드 (v13.370) — 관리자 🎤 발표 시작(공유 + 음성 + 발표 펜) · 김팀원 봄
//   ✋ 손들기 → 발표자 패널 → 펜 주기 → 김팀원 그림이 발표자에게 → 회수 · 💬 질문 → 답함 · 👏 반응 떠오름 · Alt 이름표 포인터
//   → 발표 끝 → 방에 "🎤 발표 정리"(들은 사람 · 반응 · 질문)
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
  var ok = 0, fail = 0, errs = [], browsers = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    browsers.push(b);
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
    return p;
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  async function box(p, sel) { return p.evaluate(function (s) { var b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, sel); }
  try {
    var a = await open('admin@t.com'), k = await open('kim@t.com');
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '설비 보고회', userIds: [uid] }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.click('#hdrMsgBtn'); await k.click('#hdrMsgBtn');
    await a.evaluate(function (r) { chatOpenRoom(r); }, room); await k.evaluate(function (r) { chatOpenRoom(r); }, room);
    await until(a, function () { return CX.info && document.querySelector('#cxHead [data-h="present"]'); }); await until(k, function () { return CX.info; });
    await a.evaluate(function () {
      var cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; var g = cv.getContext('2d');
      setInterval(function () { g.fillStyle = '#F8FAFC'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#0F172A'; g.font = 'bold 56px sans-serif'; g.fillText('11월 설비 보고', 120, 140); }, 100);
      navigator.mediaDevices.getDisplayMedia = function () { return Promise.resolve(cv.captureStream(10)); };
    });
    await a.click('#cxHead [data-h="present"]');
    check(await until(a, function () { return CRT.share && CI.pres && CI.pres.on && document.querySelector('#ciHost') && typeof CALL !== 'undefined' && CALL && document.querySelector('#clWin.small'); }, null, 12000), '🎤 발표 시작 — 공유 · 발표 펜 창 · 음성 통화(작게) 한 번에');
    await until(k, function () { return document.querySelector('#cxMsgs [data-watch]'); });
    await k.evaluate(function () { document.querySelector('#cxMsgs [data-watch]').click(); });
    check(await until(k, function () { var v = document.querySelector('#crtWin video'); return v && v.videoWidth > 0 && CI.dc && CI.dc.readyState === 'open' && CI.pres && CI.pres.on; }, null, 15000), '보는 쪽 연결 · 발표 상태 받음');
    check(await until(k, function () { var t = document.querySelector('#crtWin .ci-tb'); var h = t && t.querySelector('[data-pr="hand"]'); return h && h.offsetParent && !h.disabled; }), '보는 쪽 막대 — ✋ 💬 👏 (펜 없어도 보임)');

    // ✋ → 패널 → 펜 주기
    await k.click('#crtWin [data-pr="hand"]');
    check(await until(a, function (id) { return CI.pres.hands[id] && document.querySelector('#ciHost [data-prn]:not([hidden])'); }, kim.id), '손들기 → 발표자 막대에 숫자');
    await a.click('#ciHost [data-pr="panel"]');
    check(await until(a, function () { var p = document.getElementById('cpPanel'); return p && /김팀원/.test(p.textContent) && p.querySelector('[data-pc="grant"]'); }), '참여자 패널 — 손든 김팀원');
    await a.evaluate(function () { document.querySelector('#cpPanel [data-pc="grant"]').click(); });
    check(await until(k, function () { var t = document.querySelector('#crtWin .ci-tb'); return _ciCanDraw() && t && !t.classList.contains('off') && /펜을 받았습니다/.test(t.textContent); }), '펜 주기 → 김팀원 막대 풀림');
    await k.evaluate(function () { CI.fade = false; chatInkSetTool('pen'); });
    var kr = await box(k, '#crtWin .ci-cv');
    await k.mouse.move(kr.x + kr.w * 0.2, kr.y + kr.h * 0.5); await k.mouse.down();
    for (var i = 1; i <= 6; i++) { await k.mouse.move(kr.x + kr.w * (0.2 + i * 0.05), kr.y + kr.h * 0.5); await wait(25); }
    await k.mouse.up();
    check(await until(a, function (id) { return CI.strokes.some(function (s) { return s.by === id && s.done; }); }, kim.id), '펜 받은 김팀원 그림 → 발표자에게');
    await a.evaluate(function () { document.querySelector('#cpPanel [data-pc="ungrant"]').click(); });
    check(await until(k, function () { return !_ciCanDraw() && CI.tool === null; }), '회수 → 김팀원 펜 꺼짐');

    // 💬 질문 → 답함
    await k.click('#crtWin [data-pr="ask"]');
    await k.waitForSelector('#crtWin .cp-ask input');
    await k.type('#crtWin .cp-ask input', '라인 B 조명은 언제 바꾸나요?'); await k.keyboard.press('Enter');
    check(await until(a, function () { var p = document.getElementById('cpPanel'); return CI.pres.qs.length === 1 && p && /라인 B 조명/.test(p.textContent); }), '질문 → 발표자 패널에');
    await a.evaluate(function () { document.querySelector('#cpPanel [data-pc="qdone"]').click(); });
    check(await until(k, function () { return CI.pres.qs[0] && CI.pres.qs[0].done; }), '답함 표시 → 모두에게');
    // 👏 반응
    await k.click('#crtWin [data-prx="👏"]');
    check(await until(a, function () { return CI.pres.rx['👏'] === 1 && document.querySelector('#ciHost .cp-fly'); }), '👏 반응 → 발표자 화면에 떠오름');
    // Alt 이름표 포인터
    await k.keyboard.down('Alt');
    await k.mouse.move(kr.x + kr.w * 0.5, kr.y + kr.h * 0.4); await wait(60); await k.mouse.move(kr.x + kr.w * 0.52, kr.y + kr.h * 0.42); await wait(60);
    check(await until(a, function (id) { return !!CI.ptr[id]; }, kim.id), 'Alt + 움직이기 → 김팀원 이름표 포인터');
    await k.keyboard.up('Alt');
    await wait(200);
    await a.screenshot({ path: path.join(SHOT, 'e2e72-host.png') });
    await k.screenshot({ path: path.join(SHOT, 'e2e72-viewer.png') });

    // 끝 → 정리
    await a.evaluate(function () { chatRtcStop(); });
    check(await until(a, function () { return CX.msgs.some(function (m) { return /🎤 발표 정리/.test(m.body || '') && /김팀원/.test(m.body) && /라인 B 조명/.test(m.body) && /👏 1/.test(m.body); }); }, null, 10000), '발표 끝 → 방에 "🎤 발표 정리"(들은 사람 · 질문 · 반응)');
    check(await until(a, function () { return !CALL; }, null, 6000), '음성 통화도 같이 끝');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { for (var b of browsers) await b.close().catch(function () {}); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
