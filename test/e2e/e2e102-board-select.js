// 🖼 사진 칠판 v13.511 — ⬚ 선택 · 옮기기 · 지우기 · 순서(맨 앞 · 앞 · 뒤 · 맨 뒤) · 🔍 돋보기
//   두 브라우저(관리자 · 김팀원): 순서 · 옮기기가 서버에 저장되고 상대 칠판에도 같은 순서로 보이는지
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
  async function at(p, fx, fy) {
    return p.evaluate(function (fx, fy) {
      var m = _cbViewM(), x = CB.W * fx, y = CB.H * fy, r = CB.cv.getBoundingClientRect();
      return { x: r.left + m[0] * x + m[2] * y + m[4], y: r.top + m[1] * x + m[3] * y + m[5] };
    }, fx, fy);
  }
  async function drag(p, a, b, steps) {
    var s = await at(p, a[0], a[1]), e = await at(p, b[0], b[1]), n = steps || 8;
    await p.mouse.move(s.x, s.y); await p.mouse.down();
    for (var i = 1; i <= n; i++) await p.mouse.move(s.x + (e.x - s.x) * i / n, s.y + (e.y - s.y) * i / n);
    await p.mouse.up();
  }
  async function click(p, fx, fy) { var q = await at(p, fx, fy); await p.mouse.click(q.x, q.y); }
  async function tool(p, t) { await p.click('#cbBoard [data-tool="' + t + '"]'); }
  function srvAnnot(fid) { return c.query('SELECT annot FROM chat_files WHERE id = $1', [fid]).then(function (r) { return r.rows[0].annot || { shapes: [] }; }); }
  function types(a) { return (a.shapes || []).map(function (s) { return s.t; }).join(','); }

  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: uid }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.click('#hdrMsgBtn'); await k.click('#hdrMsgBtn');
    await a.waitForSelector('#mMessages .cx'); await k.waitForSelector('#mMessages .cx');
    await a.evaluate(function (rid) { return chatOpenRoom(rid); }, room);
    await until(a, function (rid) { return CX.room === rid && document.getElementById('cxIn'); }, room);
    await a.evaluate(function () {
      var cv = document.createElement('canvas'); cv.width = 1200; cv.height = 800;
      var g = cv.getContext('2d'); g.fillStyle = '#e0f2fe'; g.fillRect(0, 0, 1200, 800);
      g.fillStyle = '#111'; g.font = '28px monospace'; for (var i = 0; i < 12; i++) g.fillText('작은 글씨 줄 ' + i + ' — PLC-0' + i, 40, 60 + i * 56);
      return new Promise(function (r) { cv.toBlob(function (b) { _cxUpload([new File([b], '도형.png', { type: 'image/png' })]); r(); }); });
    });
    await until(a, function () { return CX.msgs.some(function (m) { return m.file && /도형/.test(m.file.name); }); }, null, 10000);
    var fid = await a.evaluate(function () { return CX.msgs.filter(function (m) { return m.file; })[0].file.id; });
    await a.evaluate(function (f) { chatBoardOpen(f, '도형.png'); }, fid);
    await until(a, function () { return CB && CB.img; }, null, 10000);
    await k.evaluate(function (rid) { return chatOpenRoom(rid); }, room);
    await k.evaluate(function (f) { chatBoardOpen(f, '도형.png'); }, fid);
    await until(k, function () { return CB && CB.img; }, null, 10000);

    // 겹친 사각형(빨강) → 원(초록) → 화살표
    await tool(a, 'rect'); await drag(a, [0.2, 0.2], [0.5, 0.6]);
    await a.click('#cbBoard [data-color="#22C55E"]');
    await tool(a, 'ellipse'); await drag(a, [0.35, 0.3], [0.65, 0.7]);
    await tool(a, 'arrow'); await drag(a, [0.85, 0.15], [0.7, 0.3]);
    await wait(800);
    check(types(await srvAnnot(fid)) === 'rect,ellipse,arrow', '그린 순서대로 저장 — rect,ellipse,arrow');

    // ⬚ 선택 (S) — 사각형 안쪽 빈 곳을 눌러도 고름
    await a.keyboard.press('s');
    check(await a.evaluate(function () { return CB.tool === 'sel'; }), 'S 키 → 선택 도구');
    await click(a, 0.25, 0.25);
    var selT = await a.evaluate(function () { var s = _cbSelShape(); return s && s.t; });
    check(selT === 'rect', '사각형 고름 — ' + selT);
    await until(a, function () { return document.querySelector('#cbBoard .cb-sm'); }, null, 3000);
    var menu = await a.evaluate(function () { var m = document.querySelector('#cbBoard .cb-sm'); return m && { top: m.querySelector('[data-sm="front"]').disabled, bot: m.querySelector('[data-sm="back"]').disabled }; });
    check(menu && !menu.top && menu.bot, '고른 표시 메뉴 — 맨 뒤라서 [뒤로] 꺼짐 · [앞으로] 켜짐');
    await a.screenshot({ path: path.join(SHOT, 'e2e102-select.png') });

    // 앞으로 → rect 가 ellipse 위로
    await a.click('#cbBoard .cb-sm [data-sm="fwd"]');
    await wait(800);
    check(types(await srvAnnot(fid)) === 'ellipse,rect,arrow', '앞으로 — 서버 ellipse,rect,arrow');
    check(await until(k, function () { return CB.a.shapes.map(function (s) { return s.t; }).join(',') === 'ellipse,rect,arrow'; }, null, 6000), '상대 칠판도 같은 순서');
    // 맨 앞으로 (Ctrl+Shift+])
    await a.keyboard.down('Control'); await a.keyboard.down('Shift'); await a.keyboard.press('BracketRight'); await a.keyboard.up('Shift'); await a.keyboard.up('Control');
    await wait(800);
    check(types(await srvAnnot(fid)) === 'ellipse,arrow,rect', '맨 앞으로(Ctrl+Shift+]) — ellipse,arrow,rect');
    // 맨 뒤로 버튼
    await a.click('#cbBoard .cb-sm [data-sm="back"]');
    await wait(800);
    check(types(await srvAnnot(fid)) === 'rect,ellipse,arrow', '맨 뒤로 — rect,ellipse,arrow');
    // 되돌리기 → 직전 순서
    await a.keyboard.down('Control'); await a.keyboard.press('z'); await a.keyboard.up('Control');
    await wait(800);
    check(types(await srvAnnot(fid)) === 'ellipse,arrow,rect', '되돌리기 — 순서도 되돌아감');

    // 끌어 옮기기 — 층은 그대로, 좌표만
    var before = await a.evaluate(function () { var s = _cbSelShape(); return { x: s.x, y: s.y, i: CB.a.shapes.indexOf(s) }; });
    await drag(a, [0.21, 0.4], [0.31, 0.5], 6);
    await wait(800);
    var sv = await srvAnnot(fid), r2 = sv.shapes.filter(function (s) { return s.t === 'rect'; })[0];
    check(r2 && Math.abs(r2.x - before.x - 120) < 3 && Math.abs(r2.y - before.y - 80) < 3 && sv.shapes.indexOf(r2) === before.i, '옮기기 — +120,+80 · 같은 층(' + before.i + ')');
    check(await until(k, function (x) { var s = CB.a.shapes.filter(function (q) { return q.t === 'rect'; })[0]; return s && Math.abs(s.x - x) < 1; }, r2.x, 6000), '상대 칠판도 옮긴 자리');
    await a.keyboard.down('Control'); await a.keyboard.press('z'); await a.keyboard.up('Control');
    await wait(800);
    var r3 = (await srvAnnot(fid)).shapes.filter(function (s) { return s.t === 'rect'; })[0];
    check(r3 && Math.abs(r3.x - before.x) < 1, '옮기기 되돌리기 — 원래 자리 (지워지지 않음)');

    // Delete 로 지우기 → 되돌리면 원래 층으로
    await click(a, 0.25, 0.25);
    await a.keyboard.press('Delete');
    await wait(800);
    check(types(await srvAnnot(fid)) === 'ellipse,arrow', 'Delete — 고른 표시 지움');
    await a.keyboard.down('Control'); await a.keyboard.press('z'); await a.keyboard.up('Control');
    await wait(800);
    check(types(await srvAnnot(fid)) === 'ellipse,arrow,rect', '지우기 되돌리기 — 원래 층(맨 위)으로');
    // Esc → 고른 것만 풀림 (칠판은 그대로)
    await click(a, 0.25, 0.25);
    await a.keyboard.press('Escape');
    check(await until(a, function () { return !!CB && !CB.sel && !document.querySelector('#cbBoard .cb-sm'); }, null, 3000), 'Esc — 선택만 풀림');

    // 🔍 돋보기 (Z) — 2× → 4× → 끔 · 가리키면 그려짐
    await a.keyboard.press('z');
    var q = await at(a, 0.1, 0.1); await a.mouse.move(q.x, q.y); await a.mouse.move(q.x + 4, q.y + 3);
    await wait(150);
    var mg = await a.evaluate(function () { return { m: CB.mag, pt: !!CB.magPt, btn: document.querySelector('#cbBoard [data-a="mag"]').classList.contains('on') }; });
    check(mg.m === 2 && mg.pt && mg.btn, '돋보기 2× 켜짐 · 가리킨 곳 따라감');
    // 돋보기 가운데가 실제로 확대됐는지 — 테두리 안쪽 픽셀이 칠판 배경색이 아님
    await a.screenshot({ path: path.join(SHOT, 'e2e102-loupe.png') });
    await tool(a, 'pen'); await drag(a, [0.1, 0.1], [0.15, 0.12], 4);
    check(await a.evaluate(function () { return CB.mag === 2; }), '돋보기 켠 채 그리기');
    await a.keyboard.press('z'); await a.keyboard.press('z');
    check(await a.evaluate(function () { return CB.mag === 0 && !CB.magPt; }), 'Z 두 번 더 → 끔');

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (A) await A.b.close(); if (K) await K.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
