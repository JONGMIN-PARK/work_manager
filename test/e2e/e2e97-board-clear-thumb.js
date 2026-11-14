// 🖼 사진 칠판에서 표시를 지우면 대화방 미리보기도 원래 사진으로 (v13.500)
//   표시 그리기 → 닫기 → 미리보기 ✏️ → 다시 열어 🗑 모두 지우기 → 닫기 → 미리보기에 표시 없음 · ✏️ 딱지 없음 (방을 다시 열어도 · 앱을 새로 열어도)
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
  var dir = path.join(require('os').tmpdir(), 'wm-e2e-chrome-clr' + Date.now()), browser;
  async function launch() {
    browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: dir });
    var p = (await browser.pages())[0] || await browser.newPage();
    p.on('pageerror', function (e) { errs.push(e.message); });
    p.on('dialog', function (d) { d.accept(); });
    await p.setViewport({ width: 1400, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForSelector('#loginEmail', { timeout: 60000 }).catch(function () {});
    await wait(800);
    if (await p.$eval('#loginEmail', function (e) { return !!e.offsetParent; }).catch(function () { return false; })) {
      await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!'); await p.keyboard.press('Enter');
    }
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.waitForFunction(function () { return typeof CXS !== 'undefined' && CXS.on; }, { timeout: 10000 }).catch(function () {});
    return p;
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  async function at(p, fx, fy) {
    return p.evaluate(function (fx, fy) { var m = _cbViewM(), x = CB.W * fx, y = CB.H * fy, r = CB.cv.getBoundingClientRect(); return { x: r.left + m[0] * x + m[2] * y + m[4], y: r.top + m[1] * x + m[3] * y + m[5] }; }, fx, fy);
  }
  async function drag(p, a, b) {
    var s = await at(p, a[0], a[1]), e = await at(p, b[0], b[1]);
    await p.mouse.move(s.x, s.y); await p.mouse.down();
    for (var i = 1; i <= 8; i++) await p.mouse.move(s.x + (e.x - s.x) * i / 8, s.y + (e.y - s.y) * i / 8);
    await p.mouse.up();
  }
  // 미리보기 상태 — ✏️ 딱지 · 표시를 그린 미리보기(cbkey)인지
  function thumbState(p, fid) {
    return p.evaluate(function (fid) {
      var b = document.querySelector('#cxMsgs .cx-img[data-file="' + fid + '"]'); if (!b) return null;
      var img = b.querySelector('img'), tag = b.querySelector('.cx-img-tag');
      var ready = img && img.complete && img.naturalWidth ? Promise.resolve() : new Promise(function (ok) { if (!img) return ok(); img.addEventListener('load', ok, { once: true }); setTimeout(ok, 3000); });
      // 그림이 원래 사진과 얼마나 다른지 — 원본을 같은 크기로 그려 픽셀을 비교 (표시가 남아 있으면 많이 다름)
      function px(im) { var cv = document.createElement('canvas'); cv.width = 240; cv.height = 160; var g = cv.getContext('2d'); g.drawImage(im, 0, 0, 240, 160); return g.getImageData(0, 0, 240, 160).data; }
      return ready.then(function () { return _cxBlob(fid); }).then(function (u) {
        return new Promise(function (ok) { var o = new Image(); o.onload = function () { ok(o); }; o.onerror = function () { ok(null); }; o.src = u; });
      }).then(function (orig) {
        var diff = -1;
        try {
          if (orig && img && img.complete && img.naturalWidth) {
            var A = px(img), B = px(orig); diff = 0;
            for (var i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 90) diff++;
          }
        } catch (e) { diff = -2; }
        return { tag: tag ? tag.textContent : '', marked: !!(img && img.dataset.cbkey), red: diff };
      });
    }, fid);
  }
  try {
    var a = await launch();
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: uid }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.click('#hdrMsgBtn'); await a.waitForSelector('#mMessages .cx');
    await a.evaluate(function (rid) { return chatOpenRoom(rid); }, room);
    await until(a, function (rid) { return CX.room === rid && document.getElementById('cxIn'); }, room);
    await a.evaluate(function () {
      var cv = document.createElement('canvas'); cv.width = 1200; cv.height = 800;
      var g = cv.getContext('2d'); g.fillStyle = '#dbeafe'; g.fillRect(0, 0, 1200, 800); g.fillStyle = '#111'; g.font = 'bold 80px sans-serif'; g.fillText('지우기 시험', 80, 200);
      return new Promise(function (r) { cv.toBlob(function (b) { _cxUpload([new File([b], '지우기.png', { type: 'image/png' })]); r(); }); });
    });
    await until(a, function () { return CX.msgs.some(function (m) { return m.file && /지우기/.test(m.file.name) && !m.pending; }); }, null, 10000);
    var fid = await a.evaluate(function () { return CX.msgs.filter(function (m) { return m.file; })[0].file.id; });
    await until(a, function () { return document.querySelector('#cxMsgs .cx-img img[src]'); }, null, 10000);

    // 표시 두 개 그리고 닫기
    await a.click('#cxMsgs .cx-img');
    await until(a, function () { return typeof CB !== 'undefined' && CB && CB.img; }, null, 10000);
    await a.click('#cbBoard [data-mode="mark"]').catch(function () {});
    await a.click('#cbBoard [data-tool="rect"]'); await drag(a, [0.1, 0.3], [0.4, 0.6]);
    await a.click('#cbBoard [data-tool="arrow"]'); await drag(a, [0.8, 0.2], [0.6, 0.4]);
    await until(a, function () { return CB && !CB.saving && CB.a.shapes.length === 2; }, null, 5000);
    await wait(600);
    await a.keyboard.press('Escape');
    await until(a, function (fid) { var b = document.querySelector('#cxMsgs .cx-img[data-file="' + fid + '"] .cx-img-tag'); return b && /표시 2/.test(b.textContent); }, fid, 6000);
    var s1 = await thumbState(a, fid);
    check(/표시 2/.test(s1.tag) && s1.marked && s1.red > 150, '표시 2개 → 미리보기에 ✏️ 표시 2 · 표시 그린 모습 ' + JSON.stringify(s1));

    // 다시 열어 모두 지우기 → 닫기
    await a.click('#cxMsgs .cx-img');
    await until(a, function () { return typeof CB !== 'undefined' && CB && CB.img; }, null, 10000);
    await a.click('#cbBoard [data-a="clear"]');
    await until(a, function () { return CB && CB.a.shapes.length === 0 && !CB.saving; }, null, 5000);
    var srv = (await c.query('SELECT annot FROM chat_files WHERE id = $1', [fid])).rows[0].annot || {};
    check(!(srv.shapes || []).length, '서버에서도 표시 0개');
    await a.keyboard.press('Escape');
    await wait(2500);
    var s2 = await thumbState(a, fid);
    check(!s2.tag && !s2.marked && s2.red < 30, '지우고 닫으면 → 미리보기 ✏️ 딱지 없음 · 표시 없는 사진 ' + JSON.stringify(s2));
    await a.screenshot({ path: path.join(SHOT, 'board-clear-thumb.png') });

    // 방을 다시 열어도
    await a.evaluate(function () { chatOpenRoom(null); }).catch(function () {});
    await a.evaluate(function (rid) { return chatOpenRoom(rid); }, room);
    await until(a, function (fid) { return document.querySelector('#cxMsgs .cx-img[data-file="' + fid + '"] img[src]'); }, fid, 8000);
    await wait(1200);
    var s3 = await thumbState(a, fid);
    check(!s3.tag && !s3.marked && s3.red < 30, '방을 다시 열어도 표시 없음 ' + JSON.stringify(s3));
    // v13.500 실시간 신호가 끊긴 채로(운영에서 연결이 끊겼다 붙는 사이) 그리고 지워도 — 내 화면 미리보기는 바로
    await a.evaluate(function () { window.__origOnEv = chatBoardOnEvent; window.chatBoardOnEvent = function (ev, d) { if (ev === 'annot') return; return window.__origOnEv(ev, d); }; });
    await a.click('#cxMsgs .cx-img');
    await until(a, function () { return typeof CB !== 'undefined' && CB && CB.img; }, null, 10000);
    await a.click('#cbBoard [data-tool="rect"]'); await drag(a, [0.15, 0.35], [0.45, 0.65]);
    await until(a, function () { return CB && !CB.saving && CB.a.shapes.length === 1; }, null, 5000);
    await a.keyboard.press('Escape');
    await until(a, function (fid) { var b = document.querySelector('#cxMsgs .cx-img[data-file="' + fid + '"] .cx-img-tag'); return b && /표시 1/.test(b.textContent); }, fid, 4000);
    await until(a, function (fid) { var i = document.querySelector('#cxMsgs .cx-img[data-file="' + fid + '"] img'); return i && i.dataset.cbkey && i.complete && i.naturalWidth > 0 && /^blob:/.test(i.src); }, fid, 6000);
    await wait(400);
    var s5 = await thumbState(a, fid);
    check(/표시 1/.test(s5.tag) && s5.marked && s5.red > 150, '신호 없이도 — 그린 표시가 미리보기에 바로 ' + JSON.stringify(s5));
    await a.click('#cxMsgs .cx-img');
    await until(a, function () { return typeof CB !== 'undefined' && CB && CB.img; }, null, 10000);
    await a.click('#cbBoard [data-a="clear"]');
    await a.keyboard.press('Escape');   // 저장이 끝나기 전에 바로 닫아도
    await until(a, function (fid) { return !document.querySelector('#cxMsgs .cx-img[data-file="' + fid + '"] .cx-img-tag'); }, fid, 4000);
    await wait(800);
    var s6 = await thumbState(a, fid);
    check(!s6.tag && !s6.marked && s6.red < 30, '신호 없이도 — 지우고 바로 닫으면 미리보기가 원래 사진으로 ' + JSON.stringify(s6));
    await a.evaluate(function () { window.chatBoardOnEvent = window.__origOnEv; });
    // 앱을 새로 열어도 (기기에 담아 둔 대화 · 미리보기)
    await browser.close();
    a = await launch();
    await a.click('#hdrMsgBtn'); await a.waitForSelector('#mMessages .cx');
    await a.evaluate(function (rid) { return chatOpenRoom(rid); }, room);
    await until(a, function (fid) { return document.querySelector('#cxMsgs .cx-img[data-file="' + fid + '"] img[src]'); }, fid, 10000);
    await wait(1500);
    var s4 = await thumbState(a, fid);
    check(!s4.tag && !s4.marked && s4.red < 30, '앱을 새로 열어도 표시 없음 ' + JSON.stringify(s4));
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack || e);
  } finally {
    try { await c.query('DELETE FROM chat_rooms WHERE tenant_id = $1', [adm.tenant_id]); } catch (e) {}
    await c.end();
    if (browser) await browser.close();
    console.log(fail ? 'e2e97 FAIL ' + fail : 'e2e97-board-clear-thumb.js ALL PASS ' + ok, '[]');
    process.exit(fail ? 1 : 0);
  }
})();
