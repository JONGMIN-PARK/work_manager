// 💬 사내 메신저 (v13.315) — 두 브라우저(관리자 · 김팀원)로 실시간 주고받기
//   새 1:1 · 실시간 도착 · 안 읽음 · 읽으면 "1" 사라짐 · 입력 중 · @멘션 · 답글 줄기 · 공감 · 파일 · 사진 · 공지
//   · 프로젝트 방(옆 현황 · /issue · 카드 버튼으로 이슈 상태) · 휴대폰 목록↔대화 · 화면 공유(가짜 화면 → WebRTC)
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
  await c.query("DELETE FROM issues WHERE id LIKE 'iss-%' AND description LIKE '%메신저%'");
  await c.query("DELETE FROM projects WHERE id = 'cxe-p1'");
  await c.query("INSERT INTO projects (id, name, status, progress, owner_id, visibility, tenant_id, start_date, end_date) VALUES ('cxe-p1', '메신저 시험 장비', 'active', 42, $1, 'tenant', $2, '2026-10-01', '2026-12-31')", [adm.id, adm.tenant_id]);
  await c.query("INSERT INTO project_members (project_id, user_id, tenant_id) VALUES ('cxe-p1', $1, $2) ON CONFLICT DO NOTHING", [kim.id, adm.tenant_id]).catch(function () {});

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
  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    await a.click('#hdrMsgBtn');
    await k.click('#hdrMsgBtn');
    await a.waitForSelector('#mMessages .cx');
    check(/💬/.test(await a.$eval('#hdrMsgBtn', function (b) { return b.textContent; })), '머리 ✉️ → 💬 메신저');

    // 새 1:1
    await a.click('#cxNew');
    await a.waitForSelector('#chatNewModal [data-u]');
    await a.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll('#chatNewModal [data-u]'), function (b) { return /김팀원/.test(b.textContent); })[0].click(); });
    await a.waitForSelector('#cxIn');
    await until(a, function () { return CX.info && CX.info.kind === 'dm'; });
    await a.type('#cxIn', '안녕하세요 @김팀원 내일 점검 가능할까요?');
    await a.keyboard.press('Enter');
    // 김팀원 — 실시간 도착 (목록 맨 위 · 안 읽음 1 · 머리 뱃지)
    var got = await until(k, function () { var r = document.querySelector('#cxRooms .cx-r'); return r && /관리자/.test(r.textContent) && /@?1$/.test(r.querySelector('.cx-r-m').textContent); });
    var badge = await k.evaluate(function () { var b = document.getElementById('msgBadge'); return b.style.display !== 'none' && b.textContent; });
    check(got && badge === '1', '실시간 도착 — 목록 · 안 읽음 1 · 뱃지 ' + badge);
    var unA = await a.evaluate(function () { var e = document.querySelector('#cxMsgs .cx-m.mine .cx-un'); return e && e.textContent; });
    check(unA === '1', '보낸 쪽 — 안 읽은 사람 수 1');
    await k.evaluate(function () { document.querySelector('#cxRooms .cx-r').click(); });
    await k.waitForSelector('#cxMsgs .cx-m');
    check(await until(a, function () { var e = document.querySelector('#cxMsgs .cx-m.mine .cx-un'); return e && e.textContent === ''; }), '김팀원이 열면 "1" 사라짐 (읽음)');
    check(await k.evaluate(function () { return /@김팀원/.test((document.querySelector('#cxMsgs .cx-at') || {}).textContent || '') && document.getElementById('msgBadge').style.display === 'none'; }), '@멘션 강조 · 뱃지 꺼짐');
    // 입력 중
    await k.type('#cxIn', '네 가능');
    check(await until(a, function () { return /김팀원 님이 입력 중/.test(document.getElementById('cxTyping').textContent); }), '입력 중 표시');
    await k.keyboard.press('Enter');
    await until(a, function () { return Array.prototype.some.call(document.querySelectorAll('#cxMsgs .cx-m:not(.mine) .cx-b'), function (b) { return /네 가능/.test(b.textContent); }); });
    // 공감 · 답글 줄기
    var mid = await a.evaluate(function () { var m = Array.prototype.filter.call(document.querySelectorAll('#cxMsgs .cx-m:not(.mine)'), function (e) { return /네 가능/.test(e.textContent); })[0]; return +m.dataset.mid; });
    await a.evaluate(function (id) { _cxReact(id, '👍'); }, mid);
    var rxOk = await until(k, function (id) { var m = document.querySelector('#cxMsgs [data-mid="' + id + '"] .cx-rx'); return m && /👍 1/.test(m.textContent); }, mid);
    check(rxOk, '공감 👍 — 상대 화면에 바로');
    await a.evaluate(function (id) { chatOpenThread(id); }, mid);
    await a.waitForSelector('#cxThIn');
    await a.type('#cxThIn', '오전 10시요');
    await a.keyboard.press('Enter');
    check(await until(k, function (id) { var t = document.querySelector('#cxMsgs [data-mid="' + id + '"] .cx-th'); return t && /답글 1/.test(t.textContent); }, mid), '답글 줄기 — 원글에 "답글 1"');
    // 파일 · 사진
    var input = await a.$('#cxComp [data-c="file"]');
    var tmp = require('os').tmpdir(), fs = require('fs');
    fs.writeFileSync(path.join(tmp, '점검표.txt'), '점검 항목 1\n점검 항목 2');
    var png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHklEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
    fs.writeFileSync(path.join(tmp, '현장.png'), png);
    await input.uploadFile(path.join(tmp, '점검표.txt'), path.join(tmp, '현장.png'));
    check(await until(k, function () { return document.querySelector('#cxMsgs .cx-file') && /점검표\.txt/.test(document.querySelector('#cxMsgs .cx-file').textContent); }, null, 10000), '파일 — 상대에게 파일 카드');
    check(await until(k, function () { var i = document.querySelector('#cxMsgs .cx-img img'); return i && i.complete && i.naturalWidth === 16; }, null, 10000), '사진 — 미리보기 (인증 붙여 받기)');
    await a.screenshot({ path: path.join(SHOT, 'chat-dm.png') });

    // 프로젝트 방 — 옆 현황 · /issue · 카드 버튼
    await a.evaluate(function () { chatOpenProject('cxe-p1'); });
    await until(a, function () { return CX.info && CX.info.kind === 'project'; });
    check(await until(a, function () { var b = document.getElementById('cxAsB'); return b && /메신저 시험 장비/.test(b.textContent) && /진척 42%/.test(b.textContent); }), '프로젝트 방 — 옆에 진척 · 이슈 · 마일스톤');
    await a.type('#cxIn', '/issue 진공 펌프 소음 !');
    await a.keyboard.press('Enter');
    check(await until(a, function () { var c = document.querySelector('#cxMsgs .cx-card'); return c && /진공 펌프 소음/.test(c.textContent) && /긴급/.test(c.textContent) && c.querySelector('[data-act="inProgress"]'); }), '/issue → 이슈 카드 (긴급 · 버튼)');
    await k.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(function () {});
    await until(k, function () { return Array.prototype.some.call(document.querySelectorAll('#cxRooms .cx-r'), function (r) { return /메신저 시험 장비/.test(r.textContent); }); });
    await k.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll('#cxRooms .cx-r'), function (r) { return /메신저 시험 장비/.test(r.textContent); })[0].click(); });
    await k.waitForSelector('#cxMsgs .cx-card [data-act="inProgress"]');
    await k.evaluate(function () { document.querySelector('#cxMsgs .cx-card [data-act="inProgress"]').click(); });
    check(await until(a, function () { var s = document.querySelector('#cxMsgs .cx-card .cx-st.st-inProgress'); return !!s && Array.prototype.some.call(document.querySelectorAll('#cxMsgs .cx-sys'), function (x) { return /김팀원 님이 이슈/.test(x.textContent); }); }), '김팀원이 카드에서 [대응 시작] → 관리자 화면 카드 상태 · 알림 줄');
    check(await until(a, function () { var b = document.getElementById('cxAsB'); return b && /진공 펌프 소음/.test(b.textContent) && /대응중/.test(b.textContent); }), '옆 현황도 바로 갱신 — 열린 이슈 · 대응중');
    var st = await c.query("SELECT status FROM issues WHERE title = '진공 펌프 소음'");
    check(st.rows[0] && st.rows[0].status === 'inProgress', 'DB 이슈 상태도 대응중');
    // 공지
    await a.evaluate(function () { var m = CX.msgs.filter(function (x) { return x.kind !== 'system'; })[0]; return apiFetch('/api/chat/rooms/' + CX.room + '/notice', { method: 'POST', body: JSON.stringify({ messageId: m.id }) }); });
    check(await until(k, function () { var n = document.getElementById('cxNotice'); return n && !n.hidden && /이슈를 올렸습니다/.test(n.textContent); }), '공지 — 상대 화면 위에 고정');
    await a.screenshot({ path: path.join(SHOT, 'chat-project.png') });

    // 화면 공유 — 가짜 화면(움직이는 캔버스) → 김팀원이 [보기] → 영상
    await a.evaluate(function () {
      var cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; var g = cv.getContext('2d'), n = 0;
      setInterval(function () { g.fillStyle = 'hsl(' + (n++ * 10 % 360) + ',70%,50%)'; g.fillRect(0, 0, 320, 180); }, 100);
      navigator.mediaDevices.getDisplayMedia = function () { return Promise.resolve(cv.captureStream(10)); };
      chatRtcShare(CX.room);
    });
    check(await until(a, function () { return !!document.getElementById('crtBar'); }), '화면 공유 시작 — 위에 공유 중 막대');
    check(await until(k, function () { return !!document.querySelector('#cxMsgs [data-watch]'); }), '상대 방에 [보기] 카드');
    await k.evaluate(function () { document.querySelector('#cxMsgs [data-watch]').click(); });
    check(await until(k, function () { var v = document.querySelector('#crtWin video'); return v && v.videoWidth > 0; }, null, 15000), '김팀원 화면에 공유 영상 (WebRTC)');
    check(await until(a, function () { return /보는 사람 1명/.test((document.getElementById('crtBar') || {}).textContent || ''); }), '공유하는 쪽 — 보는 사람 1명');
    await k.screenshot({ path: path.join(SHOT, 'chat-share.png') });
    await a.evaluate(function () { chatRtcStop(); });
    check(await until(k, function () { return !document.getElementById('crtWin'); }, null, 6000), '공유 끝 → 보는 창 닫힘');
    check(await until(k, function () { return !document.querySelector('#cxMsgs [data-watch]') && /화면 공유 끝남/.test(document.getElementById('cxMsgs').textContent); }), '끝난 공유 카드는 [보기] 없음');

    // 휴대폰 — 목록 ↔ 대화
    // 휴대폰 — (화면 바꾸면 페이지가 다시 열림) 목록 → 방 → ‹ 뒤로
    await k.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await k.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && document.querySelector('#cxRooms .cx-r'); }, { timeout: 30000 });
    var l0 = await k.evaluate(function () { return { side: getComputedStyle(document.querySelector('.cx-side')).display, main: getComputedStyle(document.querySelector('.cx-main')).display }; });
    await k.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }).catch(function () {});
    await k.tap('#cxRooms .cx-r');
    await k.waitForSelector('#cxMsgs .cx-m, #cxMsgs .cx-sys');
    var ph = await k.evaluate(function () { return { side: getComputedStyle(document.querySelector('.cx-side')).display, main: getComputedStyle(document.querySelector('.cx-main')).display, sw: document.documentElement.scrollWidth, back: getComputedStyle(document.querySelector('.cx-back')).display }; });
    await k.screenshot({ path: path.join(SHOT, 'chat-phone.png') });
    await k.tap('.cx-back');
    await wait(200);
    var ph2 = await k.evaluate(function () { return { side: getComputedStyle(document.querySelector('.cx-side')).display, main: getComputedStyle(document.querySelector('.cx-main')).display }; });
    check(l0.main === 'none' && ph.side === 'none' && ph.main === 'flex' && ph.back !== 'none' && ph.sw <= 390 && ph2.side !== 'none' && ph2.main === 'none', '휴대폰 — 목록 → 대화 → ‹ 뒤로 · 넘침 없음 ' + JSON.stringify([l0, ph, ph2]));

    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack);
  }
  try { if (A) await A.b.close(); if (K) await K.b.close(); } catch (e) {}
  await c.end();
  console.log(fail ? ('FAILED ' + fail + ' / ' + (ok + fail)) : ('ALL PASS (' + ok + ')'));
  process.exit(fail ? 1 : 0);
})();
