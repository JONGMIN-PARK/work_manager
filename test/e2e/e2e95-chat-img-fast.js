// 🖼 대화방 사진 빨리 보기 (v13.497) — 원본 미리 받기 · 기기에 담아 두기 · 원본 받는 중 % · 새로 열어도 서버에 다시 안 물음
//   관리자가 사진 5장을 보냄 → 김팀원이 방을 열고 잠시 쉼 → 최근 4장은 미리 받아 둠(누르면 바로) · 가장 오래된 1장은 누를 때 받음(진행률)
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
  var dirK = path.join(require('os').tmpdir(), 'wm-e2e-chrome-kimimg' + Date.now());
  async function open(email, dir) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: dir || path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { d.accept(); });
    await p.setViewport({ width: 1400, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    if (await p.$('#loginEmail') && await p.$eval('#loginEmail', function (e) { return !!e.offsetParent; }).catch(function () { return false; })) {
      await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
      await p.keyboard.press('Enter');
    }
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    return { b: b, p: p };
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var A, K;
  try {
    A = await open('admin@t.com');
    var a = A.p;
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: uid }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.click('#hdrMsgBtn'); await a.waitForSelector('#mMessages .cx');
    await a.evaluate(function (rid) { return chatOpenRoom(rid); }, room);
    await until(a, function (rid) { return CX.room === rid && document.getElementById('cxIn'); }, room);
    // 사진 5장 — 잡음이 있어 줄여도 수백 KB (진행률이 보일 만큼)
    for (var n = 1; n <= 5; n++) {
      await a.evaluate(function (n) {
        var cv = document.createElement('canvas'); cv.width = 1900; cv.height = 1300;
        var g = cv.getContext('2d'), d = g.createImageData(1900, 1300);
        for (var i = 0; i < d.data.length; i += 4) { var v = (Math.random() * 255) | 0; d.data[i] = v; d.data[i + 1] = (v * 7 + n * 40) & 255; d.data[i + 2] = (v * 3) & 255; d.data[i + 3] = 255; }
        g.putImageData(d, 0, 0); g.fillStyle = '#fff'; g.font = 'bold 120px sans-serif'; g.fillText('사진 ' + n, 80, 200);
        return new Promise(function (r) { cv.toBlob(function (b) { _cxUpload([new File([b], '사진' + n + '.jpg', { type: 'image/jpeg' })]); r(); }, 'image/jpeg', 0.92); });
      }, n);
      await until(a, function (n) { return CX.msgs.some(function (m) { return m.file && m.file.name === '사진' + n + '.jpg' && !m.pending; }); }, n, 15000);
    }
    var files = (await c.query("SELECT id, name, octet_length(data) AS sz FROM chat_files WHERE room_id = $1 ORDER BY created_at", [room])).rows;
    check(files.length === 5 && files[0].sz > 100000, '사진 5장 · 크기 ' + files.map(function (f) { return Math.round(f.sz / 1024) + 'KB'; }).join(' '));
    var oldest = files[0].id, newest = files[4].id;

    // 김팀원 — 방을 열고 쉼
    K = await open('kim@t.com', dirK);
    var k = K.p, fileReqs = [], thumbBodies = [];
    k.on('request', function (r) {
      var u = r.url();
      if (/\/api\/chat\/files\/[^/?]+(\?.*)?$/.test(u) && !/thumb=1/.test(u)) fileReqs.push(u.replace(/.*\/files\//, '').replace(/\?.*/, ''));
      if (/\/api\/chat\/thumbs$/.test(u) && r.method() === 'POST') thumbBodies.push(r.postData() || '');
    });
    await k.click('#hdrMsgBtn'); await k.waitForSelector('#mMessages .cx');
    await k.evaluate(function (rid) { return chatOpenRoom(rid); }, room);
    await until(k, function () { return document.querySelectorAll('#cxMsgs .cx-img img[src]').length >= 5; }, null, 15000);
    check(thumbBodies.some(function (b) { return /"urls":true/.test(b); }), '미리보기 묶음 요청에 원본 주소도 같이 (urls:true)');
    // 미리 받기 — 최근 4장
    var pre = await until(k, function (ids) { return ids.every(function (id) { return CX.blobs[id]; }); }, files.slice(1).map(function (f) { return f.id; }), 12000);
    await wait(500);
    var stored = await k.evaluate(function (ids) { return Promise.all(ids.map(function (id) { return chatFullGet(id).then(function (b) { return b ? b.size : 0; }); })); }, files.map(function (f) { return f.id; }));
    check(pre && stored.slice(1).every(function (s) { return s > 0; }) && !stored[0], '쉬는 동안 최근 4장 원본을 미리 받아 기기에 담음 · 오래된 1장은 아님 ' + JSON.stringify(stored));

    // 최근 사진 누르기 — 서버에 다시 묻지 않고 바로
    var before = fileReqs.length;
    var t0 = await k.evaluate(function () { return performance.now(); });
    await k.evaluate(function (fid) { document.querySelector('#cxMsgs .cx-img[data-file="' + fid + '"]').click(); }, newest);
    await until(k, function () { return typeof CB !== 'undefined' && CB && CB.img; }, null, 10000);
    var t1 = await k.evaluate(function () { return performance.now(); });
    check(fileReqs.length === before, '미리 받은 사진 — 누를 때 원본 요청 없음');
    check(t1 - t0 < 1500, '미리 받은 사진 — 칠판에 원본까지 ' + Math.round(t1 - t0) + 'ms');
    await k.keyboard.press('Escape'); await wait(300);

    // 오래된 사진 — 누를 때 받음 · 진행률 % 가 보임
    await k.evaluate(function () { window.__prog = []; document.addEventListener('cxfullprog', function (e) { window.__prog.push(e.detail.pct); }); });
    await k.evaluate(function (fid) { document.querySelector('#cxMsgs .cx-img[data-file="' + fid + '"]').click(); }, oldest);
    var sawLabel = await until(k, function () { var l = document.querySelector('#cbBoard [data-loading]'); return (l && /원본 받는 중|사진 여는 중/.test(l.textContent)) || (CB && CB.img); }, null, 8000);
    await until(k, function () { return CB && CB.img; }, null, 15000);
    var prog = await k.evaluate(function () { return window.__prog; });
    check(sawLabel && prog.length >= 2 && prog.some(function (x) { return x > 0 && x < 100; }) && prog[prog.length - 1] === 100, '누를 때 받는 사진 — 진행률 ' + prog.slice(0, 3).concat(['…', prog[prog.length - 1]]).join(','));
    check(fileReqs.indexOf(oldest) >= 0, '오래된 사진은 이때 원본 요청');
    await k.screenshot({ path: path.join(SHOT, 'chat-img-board.png') });
    await k.keyboard.press('Escape'); await wait(500);
    check(await k.evaluate(function (fid) { return chatFullGet(fid).then(function (b) { return !!b; }); }, oldest), '받은 원본은 기기에 담김');

    // 앱을 새로 열어도 — 기기에 담아 둔 원본으로 (서버 요청 없음)
    await K.b.close();
    K = await open('kim@t.com', dirK);
    k = K.p; fileReqs = [];
    k.on('request', function (r) { var u = r.url(); if (/\/api\/chat\/files\/[^/?]+(\?.*)?$/.test(u) && !/thumb=1/.test(u)) fileReqs.push(u); });
    var t2 = await k.evaluate(function (a) { var t = performance.now(); chatBoardOpen(a.fid, '사진1.jpg', a.room); return t; }, { fid: oldest, room: room });
    await until(k, function () { return typeof CB !== 'undefined' && CB && CB.img; }, null, 10000);
    var t3 = await k.evaluate(function () { return performance.now(); });
    check(!fileReqs.length && t3 - t2 < 1500, '새로 연 앱에서도 기기에 담긴 원본으로 바로 ' + Math.round(t3 - t2) + 'ms · 요청 ' + fileReqs.length);
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack || e);
  } finally {
    try { await c.query('DELETE FROM chat_rooms WHERE tenant_id = $1', [adm.tenant_id]); } catch (e) {}
    await c.end();
    if (A) await A.b.close(); if (K) await K.b.close();
    console.log(fail ? 'e2e95 FAIL ' + fail : 'e2e95-chat-img-fast.js ALL PASS ' + ok, '[]');
    process.exit(fail ? 1 : 0);
  }
})();
