// 🖼 사진 칠판 (v13.356) — 두 브라우저(관리자 · 김팀원)
//   사진 보내기 → 칠판 열기 → 펜 · 사각형 · 글자 · 흐리게 → 저장 · 상대에게 바로 보임 · 손가락(커서) · 회전 · 자르기
//   · 원본 ↔ 표시 보기 · 되돌리기 · 대화 속 미리보기 ✏️ 표시 수 · 붙여넣은 사진 표시 후 보내기
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
  // 칠판 위 사진 좌표(비율) → 화면 좌표
  async function at(p, fx, fy) {
    return p.evaluate(function (fx, fy) {
      var m = _cbViewM(), x = CB.W * fx, y = CB.H * fy, r = CB.cv.getBoundingClientRect();
      return { x: r.left + m[0] * x + m[2] * y + m[4], y: r.top + m[1] * x + m[3] * y + m[5] };
    }, fx, fy);
  }
  async function drag(p, a, b, steps) {
    var s = await at(p, a[0], a[1]), e = await at(p, b[0], b[1]);
    await p.mouse.move(s.x, s.y); await p.mouse.down();
    for (var i = 1; i <= (steps || 8); i++) await p.mouse.move(s.x + (e.x - s.x) * i / (steps || 8), s.y + (e.y - s.y) * i / (steps || 8) + (i % 2 ? 6 : 0));
    await p.mouse.up();
  }
  async function tool(p, t) { await p.click('#cbBoard [data-tool="' + t + '"]'); }
  function srvAnnot(fid) { return c.query('SELECT annot FROM chat_files WHERE id = $1', [fid]).then(function (r) { return r.rows[0].annot || { shapes: [] }; }); }

  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    // 1:1 방 · 사진 한 장 보내기 (그림은 브라우저 캔버스로 만듦)
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: uid }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.click('#hdrMsgBtn'); await k.click('#hdrMsgBtn');
    await a.waitForSelector('#mMessages .cx'); await k.waitForSelector('#mMessages .cx');
    await a.evaluate(function (rid) { return chatOpenRoom(rid); }, room);
    await until(a, function (rid) { return CX.room === rid && document.getElementById('cxIn'); }, room);
    await a.evaluate(function () {
      var cv = document.createElement('canvas'); cv.width = 1200; cv.height = 800;
      var g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 1200, 800); gr.addColorStop(0, '#dbeafe'); gr.addColorStop(1, '#fde68a');
      g.fillStyle = gr; g.fillRect(0, 0, 1200, 800);
      g.fillStyle = '#1f2937'; g.font = 'bold 64px sans-serif'; g.fillText('장비 배선도 (시험)', 60, 120);
      g.strokeStyle = '#2563eb'; g.lineWidth = 8; g.strokeRect(120, 220, 360, 260); g.strokeRect(700, 260, 360, 300);
      g.fillStyle = '#111'; g.font = '36px monospace'; g.fillText('PLC-01  192.168.0.15', 120, 650);
      return new Promise(function (r) { cv.toBlob(function (b) { _cxUpload([new File([b], '배선도.png', { type: 'image/png' })]); r(); }); });
    });
    var hasImg = await until(a, function () { return CX.msgs.some(function (m) { return m.file && /배선도/.test(m.file.name); }); }, null, 10000);
    var fid = await a.evaluate(function () { return CX.msgs.filter(function (m) { return m.file; })[0].file.id; });
    check(hasImg && fid, '사진 보내기 — ' + fid);
    await k.evaluate(function (rid) { return chatOpenRoom(rid); }, room);
    await until(k, function () { return document.querySelector('#cxMsgs .cx-img img[src]'); }, null, 10000);

    // 칠판 열기 (사진 누르기)
    await a.click('#cxMsgs .cx-img');
    var opened = await until(a, function () { return typeof CB !== 'undefined' && CB && CB.img; }, null, 10000);
    check(opened, '사진 누르면 칠판이 열림');
    await k.evaluate(function (f) { chatBoardOpen(f, '배선도.png'); }, fid);
    await until(k, function () { return CB && CB.img; }, null, 10000);

    // 펜 · 사각형 · 화살표 · 흐리게 · 집중 · 글자
    await tool(a, 'pen'); await drag(a, [0.1, 0.75], [0.45, 0.85], 12);
    await tool(a, 'rect'); await drag(a, [0.08, 0.25], [0.42, 0.62]);
    await a.click('#cbBoard [data-color="#22C55E"]');
    await tool(a, 'arrow'); await drag(a, [0.85, 0.15], [0.7, 0.32]);
    await tool(a, 'blur'); await drag(a, [0.09, 0.76], [0.5, 0.84]);
    await tool(a, 'text');
    var tp = await at(a, 0.6, 0.78); await a.mouse.click(tp.x, tp.y);
    await a.waitForSelector('#cbBoard .cb-text');
    await a.waitForFunction(function () { return document.activeElement && document.activeElement.classList.contains('cb-text'); });   // 글자 칸은 한 박자 뒤에 잡힘 — 잡힌 뒤 치기
    await a.keyboard.type('여기 확인');
    await a.keyboard.press('Enter');
    await wait(900);
    var sv = await srvAnnot(fid);
    var types = (sv.shapes || []).map(function (s) { return s.t; }).sort().join(',');
    check(types === 'arrow,blur,pen,rect,text', '저장됨 — ' + types);
    check((sv.shapes || []).every(function (s) { return s.by === adm.id; }), '누가 그렸는지 서버가 붙임');
    var kSees = await until(k, function () { return CB && CB.a.shapes.length === 5; }, null, 6000);
    check(kSees, '상대 칠판에 바로 보임 (5개)');

    // 손가락(커서) · 그리는 중인 선
    var h = await at(a, 0.5, 0.5); await a.mouse.move(h.x, h.y); await a.mouse.move(h.x + 20, h.y + 10);
    var peer = await until(k, function () { var ks = Object.keys(CB.peers); return ks.length && CB.peers[ks[0]].x != null && /관리자/.test(document.querySelector('#cbBoard [data-peers]').textContent + CB.peers[ks[0]].name); }, null, 5000);
    check(peer, '상대 손가락 · 같이 보는 중 표시');
    await tool(a, 'pen');
    var s0 = await at(a, 0.6, 0.4); await a.mouse.move(s0.x, s0.y); await a.mouse.down();
    for (var i = 1; i < 10; i++) { await a.mouse.move(s0.x + i * 12, s0.y + (i % 2) * 10); await wait(40); }
    var liveSeen = await until(k, function () { return Object.keys(CB.peers).some(function (x) { return CB.peers[x].live && CB.peers[x].live.p && CB.peers[x].live.p.length > 4; }); }, null, 4000);
    await a.mouse.up();
    check(liveSeen, '그리는 중인 선이 상대에게 실시간으로');
    await until(k, function () { return CB.a.shapes.length === 6; }, null, 5000);
    await k.screenshot({ path: path.join(SHOT, 'e2e59-board-kim.png') });

    // 되돌리기
    await a.keyboard.down('Control'); await a.keyboard.press('z'); await a.keyboard.up('Control');
    var undone = await until(k, function () { return CB.a.shapes.length === 5; }, null, 5000);
    check(undone, '되돌리기 (Ctrl+Z) — 상대에게도 반영');

    // v13.409 회전 — 내 화면에만 (상대 그대로) · 사람마다 저장
    function myView() { return c.query('SELECT angle, fill FROM chat_file_views WHERE user_id = $1 AND file_id = $2', [adm.id, fid]).then(function (r) { return r.rows[0] || null; }); }
    async function myViewUntil(fn) { var v = null; for (var tr = 0; tr < 40; tr++) { v = await myView(); if (fn(v)) return v; await wait(150); } return v; }
    await a.click('#cbBoard [data-a="rotr"]');
    var mine = await until(a, function () { return CB.my && CB.my.a === 90; }, null, 3000);
    var sv = await myViewUntil(function (v) { return v && v.angle === 90; });
    var kr = await k.evaluate(function () { return [CB.a.rot || 0, _cbAng()]; });
    check(mine && sv && sv.angle === 90 && kr[0] === 0 && kr[1] === 0 && !(await srvAnnot(fid)).rot, '⟳ 내 화면에만 90° — 저장됨 · 상대 · 같이 쓰는 회전은 그대로');
    var aw = await a.evaluate(function () { var c = _cbView(); return [c.width, c.height]; });
    check(aw[0] === 800 && aw[1] === 1200, '돌린 그림 크기 ' + aw.join('×'));
    // 📐 1° 단위 (. 키 세 번) · 비스듬히
    await a.click('#cbBoard [data-a="angle"]');
    check(await a.evaluate(function () { return !document.querySelector('#cbBoard [data-ang]').hidden; }), '📐 각도 띠 열림');
    await a.evaluate(function () { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    for (var pk = 0; pk < 3; pk++) await a.keyboard.press('Period');
    var a93 = await until(a, function () { return CB.my && CB.my.a === 93; }, null, 3000);
    var bw = await a.evaluate(function () { var c = _cbView(); return [c.width, c.height, document.querySelector('#cbBoard [data-angv]').textContent]; });
    check(a93 && bw[0] > 800 && bw[1] > 1200, '. 키로 1°씩 → 93° · 비스듬히 감싸는 크기 ' + bw.join(' '));
    // ⬚ 빈 모서리 채우기
    await a.click('#cbBoard [data-a="fill"]');
    var fw = await a.evaluate(function () { var c = _cbView(); return [CB.fill, c.width, c.height]; });
    var sv2 = await myViewUntil(function (v) { return v && v.fill; });
    check(fw[0] && fw[1] < 800 && fw[2] < 1200 && sv2 && sv2.fill, '빈 모서리 채우기 — 안쪽만 ' + fw.slice(1).join('×') + ' · 저장');
    await a.screenshot({ path: path.join(SHOT, 'e2e59-skew-fill.png') });
    await a.click('#cbBoard [data-a="fill"]');
    await myViewUntil(function (v) { return v && !v.fill; });
    // 다시 열어도 그대로 (서버에서)
    await a.keyboard.press('Escape');
    await a.evaluate(function (f) { _cbViews = null; chatBoardOpen(f, '배선도.png'); }, fid);
    var kept = await until(a, function () { return CB && CB.img && CB.my && CB.my.a === 93 && !CB.fill; }, null, 8000);
    check(kept, '닫고 다시 열어도 내 각도 93° 유지');
    // 대화 속 미리보기도 내 각도로 (비스듬하면 투명 모서리 png)
    var th = await until(a, function (f) { var i = document.querySelector('#cxMsgs img[data-cbthumb="' + f + '"]'); return i && /^data:image\/png/.test(i.src); }, fid, 6000);
    check(th, '대화 속 미리보기도 내 각도로');
    // 📏 수평 맞추기 — 화면에서 오른쪽 아래로 30/300 기울어진 선을 따라 끌면 그만큼 반대로
    await a.click('#cbBoard [data-a="rot0"]');
    await until(a, function () { return !CB.my; }, null, 3000);
    await a.click('#cbBoard [data-a="level"]');
    var cvr = await a.evaluate(function () { var r = CB.cv.getBoundingClientRect(); return { x: r.left + r.width / 2 - 150, y: r.top + r.height / 2 }; });
    await a.mouse.move(cvr.x, cvr.y); await a.mouse.down();
    for (var lv = 1; lv <= 6; lv++) await a.mouse.move(cvr.x + 50 * lv, cvr.y + 5 * lv);
    await a.mouse.up();
    var lvA = await a.evaluate(function () { return [CB.my && CB.my.a, CB.tool]; });
    check(lvA[0] && Math.abs(lvA[0] - (360 - 5.7)) < 0.15 && lvA[1] === 'pan', '📏 수평 맞추기 — ' + lvA.join(' · '));
    // 비스듬히 본 채로 자르기 — 이대로 자르기는 없고 복사 · 보내기만
    await tool(a, 'crop');
    var cr = await a.evaluate(function () { var r = CB.cv.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await a.mouse.move(cr.x - 100, cr.y - 60); await a.mouse.down(); await a.mouse.move(cr.x, cr.y, { steps: 4 }); await a.mouse.move(cr.x + 100, cr.y + 60, { steps: 4 }); await a.mouse.up();
    var cm = await a.evaluate(function () { var c = _cbCropCanvas(CB.cropSel); return [!!CB.cropSel.v, !!document.querySelector('.cb-cm [data-cm="apply"]'), !!document.querySelector('.cb-cm [data-cm="send"]'), c.width > 50 && c.height > 30]; });
    check(cm[0] && !cm[1] && cm[2] && cm[3], '비스듬히 자르기 — 돌린 모습 기준 · 이대로 자르기 숨김 ' + cm.join(','));
    await a.click('.cb-cm [data-cm="cancel"]'); await tool(a, 'pan');
    // 👥 모두에게 이렇게 → 상대도 같은 각도 · 내 것은 지움
    await a.click('#cbBoard [data-a="rotshare"]');
    var shared = await until(k, function () { return Math.abs((CB.a.rot || 0) - 354.3) < 0.01; }, null, 5000);
    var mineGone = await myViewUntil(function (v) { return !v; });
    check(shared && !mineGone, '👥 모두에게 — 상대도 354.3° · 내 따로 각도는 지움');
    await a.evaluate(function () { _cbCommit({ rot: 0 }); _cbFit(); });
    await until(k, function () { return !CB.a.rot; }, null, 5000);
    await a.click('#cbBoard [data-a="angle"]');   // 띠 닫기 (다음 시험이 띠에 안 가리게)

    // 자르기 → 잘라서 보내기 · 이대로 자르기
    await tool(a, 'crop');
    await drag(a, [0.05, 0.2], [0.55, 0.9]);
    await a.waitForSelector('#cbBoard .cb-cm');
    var nBefore = await a.evaluate(function () { return CX.msgs.length; });
    await a.click('#cbBoard [data-cm="send"]');
    var sentPart = await until(a, function (n) { return CX.msgs.length > n && /부분/.test(CX.msgs[CX.msgs.length - 1].file && CX.msgs[CX.msgs.length - 1].file.name); }, nBefore, 10000);
    check(sentPart, '잘라서 보내기 — 새 사진');
    await a.click('#cbBoard [data-cm="apply"]');
    var cr = null;
    for (var tt = 0; tt < 40 && !cr; tt++) { await wait(150); cr = (await srvAnnot(fid)).crop; }   // 저장될 때까지
    check(cr && cr.w > 500 && cr.h > 400, '이대로 자르기 저장 — ' + (cr && cr.w + '×' + cr.h));
    var vw = await a.evaluate(function () { var c = _cbView(); return [c.width, c.height]; });
    check(Math.abs(vw[0] - cr.w) < 2 && Math.abs(vw[1] - cr.h) < 2, '표시 보기 = 자른 부분');
    await a.click('#cbBoard [data-mode="orig"]');
    var ow = await a.evaluate(function () { var c = _cbView(); return [CB.mode, c.width, c.height]; });
    check(ow[0] === 'orig' && ow[1] === 1200 && ow[2] === 800, '원본 보기 = 원래 사진 전체 · 표시 없음');
    await a.click('#cbBoard [data-mode="mark"]');
    await a.screenshot({ path: path.join(SHOT, 'e2e59-board-admin.png') });

    // 닫기 → 대화 속 미리보기에 ✏️ 표시 수
    await a.keyboard.press('Escape'); await k.keyboard.press('Escape');
    check(await a.evaluate(function () { return !document.getElementById('cbBoard') && !CB; }) && await k.evaluate(function () { return !CB; }), 'Esc 로 닫기 (둘 다)');
    var tag = await until(k, function (f) { var t = document.querySelector('#cxMsgs [data-file="' + f + '"] .cx-img-tag'); return t && /표시 5/.test(t.textContent); }, fid, 8000);
    check(tag, '대화 속 미리보기 — ✏️ 표시 5');
    var thumbW = await k.evaluate(function (f) { var i = document.querySelector('#cxMsgs [data-file="' + f + '"] img'); return /^data:image/.test(i.src) && i.naturalWidth; }, fid);
    check(thumbW > 0, '미리보기가 표시 · 자른 모습으로 (' + thumbW + 'px)');
    await k.screenshot({ path: path.join(SHOT, 'e2e59-chat-kim.png') });

    // 붙여넣은 사진 — 칠판에서 표시하고 Enter 로 보내기 (받는 사람은 원본 + 표시)
    var n0 = await a.evaluate(function () { return CX.msgs.length; });
    await a.evaluate(function () {
      var cv = document.createElement('canvas'); cv.width = 600; cv.height = 400; var g = cv.getContext('2d'); g.fillStyle = '#e0f2fe'; g.fillRect(0, 0, 600, 400); g.fillStyle = '#0f172a'; g.font = '40px sans-serif'; g.fillText('에러 화면', 40, 80);
      return new Promise(function (r) { cv.toBlob(function (b) { chatBoardDraft(new File([b], 'paste.png', { type: 'image/png' })); r(); }); });
    });
    await until(a, function () { return CB && CB.img && !CB.fid; });
    check(await a.evaluate(function () { return !document.querySelector('#cbBoard [data-a="send"]').hidden && CB.tool === 'pen'; }), '보내기 전 칠판 — ➤ 보내기 · 펜');
    await tool(a, 'ellipse'); await drag(a, [0.05, 0.1], [0.5, 0.3]);
    await a.keyboard.press('Enter');
    var sent = await until(a, function (n) { return !CB && CX.msgs.length > n; }, n0, 10000);
    var lastF = await a.evaluate(function () { return CX.msgs[CX.msgs.length - 1].file.id; });
    await wait(600);
    var la = await srvAnnot(lastF);
    check(sent && la.shapes && la.shapes.length === 1 && la.shapes[0].t === 'ellipse', '표시 후 보내기 — 원본 + 표시 1');

    // v13.409 ◀ ▶ 방 사진 넘겨 보기
    await a.evaluate(function (f) { chatBoardOpen(f, '배선도.png'); }, fid);
    var nav = await until(a, function () { return CB && CB.list && !document.querySelector('#cbBoard [data-a="next"]').hidden; }, null, 8000);
    var p0 = await a.evaluate(function () { return [CB.idx, CB.list.length, document.querySelector('#cbBoard [data-pos]').textContent]; });
    await a.keyboard.press('ArrowRight');
    var moved = await until(a, function (f) { return CB && CB.fid !== f && CB.img && CB.list; }, fid, 8000);
    var p1 = await a.evaluate(function () { return document.querySelector('#cbBoard [data-pos]').textContent; });
    check(nav && p0[1] >= 2 && moved && p1 === (p0[0] + 2) + ' / ' + p0[1], '◀ ▶ 넘겨 보기 ' + p0[2] + ' → ' + p1);
    await a.keyboard.press('Escape');

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (A) await A.b.close(); if (K) await K.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
