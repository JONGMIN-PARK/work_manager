// 📱 휴대폰 대화방 굴림 (v13.414) — 옛 대화를 받을 때 목록을 다시 그리지 않고 위에만 끼워 넣음 · 보던 자리 그대로 · 미리 받기
//   + 손가락 기기에서 무거운 효과(목록 mask · 이모지 filter) 끔
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
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var b;
  try {
    b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-m' + Date.now()) });
    var a = (await b.pages())[0] || await b.newPage();
    a.on('pageerror', function (e) { errs.push(e.message); });
    await a.emulate({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    await a.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await a.waitForSelector('#loginEmail', { visible: true });
    await a.type('#loginEmail', 'admin@t.com'); await a.type('#loginPw', 'Test1234!'); await a.keyboard.press('Enter');
    await a.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '굴림 시험', userIds: [uid] }) }).then(function (r) { return r.data.id; }); }, kim.id);
    // 메시지 180개 (DB 에 바로) — 한 번에 받는 양(50)보다 훨씬 많게
    var vals = [], prm = [];
    for (var i = 1; i <= 180; i++) {
      prm.push(adm.tenant_id, room, i % 3 ? adm.id : kim.id, '굴림 메시지 ' + i + (i % 4 ? '' : '\n둘째 줄 😀'));
      var o = prm.length; vals.push('($' + (o - 3) + ',$' + (o - 2) + ',$' + (o - 1) + ",'text',$" + o + ')');
    }
    await c.query('INSERT INTO chat_messages (tenant_id, room_id, user_id, kind, body) VALUES ' + vals.join(','), prm);
    await a.evaluate(function (r) { if (typeof setPage === 'function') setPage('messages'); chatOpenRoom(r); }, room);
    check(await until(a, function () { return CX.info && document.querySelectorAll('#cxMsgs .cx-mw').length > 10 && CX.more; }, null, 15000), '방 열림 — 앞 대화가 더 있음');
    await wait(500);
    var n0 = await a.evaluate(function () { return CX.msgs.length; });

    // 손가락 기기 — 목록 mask · 이모지 filter 꺼짐
    var st = await a.evaluate(function () { var bx = document.getElementById('cxMsgs'), ej = bx.querySelector('.cx-ej'); var cs = getComputedStyle(bx); return { mask: cs.maskImage || cs.webkitMaskImage, ej: ej ? getComputedStyle(ej).filter : 'none' }; });
    check(st.mask === 'none' && st.ej === 'none', '휴대폰 — 목록 위 흐림(mask) · 이모지 그림자 꺼짐 (' + st.mask + ' / ' + st.ej + ')');

    // 보던 자리 표시 → 위로 굴려 옛 대화 받기 — 노드 그대로 · 자리 그대로
    await a.evaluate(function () {
      var bx = document.getElementById('cxMsgs'); _cxUnstick(); bx.scrollTop = Math.min(700, bx.scrollHeight - bx.clientHeight);   // v13.484 대화 칸이 머리 줄만큼 낮아져 미리 받기 기준(칸 높이 × 1.5) 안쪽으로
      var ws = bx.querySelectorAll('.cx-mw'); ws[ws.length - 1]._keep = 1;
      var mid = Array.from(ws).find(function (w) { var r = w.getBoundingClientRect(); return r.top > 200 && r.top < 600; }) || ws[ws.length - 5];
      window.__anc = mid; window.__ancTop = mid.getBoundingClientRect().top;
    });
    await a.evaluate(function () { var bx = document.getElementById('cxMsgs'); bx.scrollTop = bx.scrollTop - 1; });
    check(await until(a, function (n) { return CX.msgs.length > n && !CX.loading; }, n0, 10000), '위 끝에 닿기 전에 미리 받음 (' + n0 + ' → 더)');
    await wait(300);
    var aft = await a.evaluate(function () {
      var bx = document.getElementById('cxMsgs'), ws = Array.from(bx.querySelectorAll('.cx-mw'));
      var domIds = ws.map(function (w) { return w.dataset.k; }), ids = CX.msgs.map(function (m) { return String(m.id); });
      return { keep: !!ws[ws.length - 1]._keep, anc: document.contains(window.__anc), dy: window.__anc.getBoundingClientRect().top - window.__ancTop,
        order: domIds.join() === ids.join(), dup: new Set(domIds).size !== domIds.length, n: ids.length, olderFirst: !CX.more || bx.firstElementChild.matches('[data-older]') };
    });
    check(aft.keep && aft.anc, '옛 대화 받을 때 목록을 다시 그리지 않음 (원래 노드 그대로)');
    check(Math.abs(aft.dy) <= 2, '보던 메시지가 제자리 (' + aft.dy.toFixed(1) + 'px)');
    check(aft.order && !aft.dup, '화면 순서 = 메시지 순서 · 겹침 없음 (' + aft.n + '개)');
    check(aft.olderFirst, '"이전 대화 더 보기" 단추는 맨 위');
    // 끝까지 받기
    for (var t = 0; t < 10; t++) {
      var more = await a.evaluate(function () { var bx = document.getElementById('cxMsgs'); bx.scrollTop = 0; bx.dispatchEvent(new Event('scroll')); return CX.more; });
      if (!more) break; await until(a, function () { return !CX.loading; }); await wait(250);
    }
    var all = await a.evaluate(function () { var bx = document.getElementById('cxMsgs'), d = Array.from(bx.querySelectorAll('.cx-mw')).map(function (w) { return w.dataset.k; }); return { n: CX.msgs.length, d: d.join() === CX.msgs.map(function (m) { return String(m.id); }).join(), older: !!bx.querySelector('[data-older]'), more: CX.more, first: /굴림 메시지 1(\D|$)/.test(bx.textContent) }; });
    check(all.n >= 180 && all.d && !all.older && !all.more && all.first, '끝까지 받으면 180개 전부 · 순서 그대로 · 더 보기 단추 없어짐 (' + JSON.stringify(all) + ')');
    // ↓ 단추 — 굴리는 동안 같은 걸 다시 쓰지 않음
    var nb = await a.evaluate(function () {
      var bt = document.getElementById('cxNewB'), bx = document.getElementById('cxMsgs'), cnt = 0;
      bx.scrollTop = 300; _cxNewBtn();
      var mo = new MutationObserver(function (l) { cnt += l.length; }); mo.observe(bt, { subtree: true, childList: true, characterData: true, attributes: true });
      for (var i = 0; i < 20; i++) { bx.scrollTop = 300 + i * 10; _cxNewBtn(); }
      return new Promise(function (r) { setTimeout(function () { mo.disconnect(); r({ cnt: cnt, shown: !bt.hidden }); }, 50); });
    });
    check(nb.shown && nb.cnt === 0, '↓ 단추 — 굴리는 동안 바뀐 게 없으면 손대지 않음 (변경 ' + nb.cnt + '번)');
    await a.screenshot({ path: path.join(SHOT, 'e2e73-mobile.png') });
    check(!errs.length, '페이지 오류 없음' + (errs.length ? ' — ' + errs.join(' | ') : ''));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  if (b) await b.close();
  await c.end();
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
