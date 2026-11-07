// 💬 메신저 협업 (v13.358) — 두 브라우저(관리자 · 김팀원)
//   </> 코드 블록 · ✍️ 🛠 요청 글(장비 · 담당 · 긴급) → 상대에게 바로 · 처리 시작 → 완료(실시간) · 📌 게시판 탭 · 댓글 줄기 기록
//   · 🛠 요청함 · 📁 폴더에 담기 → 📂 내 폴더 → 대화로 가기
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
  await c.query('DELETE FROM chat_folders WHERE tenant_id = $1', [adm.tenant_id]);
  require('fs').mkdirSync(SHOT, { recursive: true });

  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { d.accept(d.type() === 'prompt' ? '조립기 자료' : undefined); });
    await p.setViewport({ width: 1500, height: 920 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.waitForFunction(function () { return typeof CXS !== 'undefined' && CXS.on; }, { timeout: 10000 }).catch(function () {});
    return { b: b, p: p };
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  async function clickText(p, sel, re) {
    return p.evaluate(function (sel, src) { var b = Array.prototype.filter.call(document.querySelectorAll(sel), function (x) { return new RegExp(src).test(x.textContent) && x.offsetParent; })[0]; if (b) b.click(); return !!b; }, sel, re.source);
  }

  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '조립기 · 프로그램', userIds: [uid] }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.click('#hdrMsgBtn'); await k.click('#hdrMsgBtn');
    await a.waitForSelector('#mMessages .cx'); await k.waitForSelector('#mMessages .cx');
    await a.evaluate(function (r) { chatOpenRoom(r); }, room); await k.evaluate(function (r) { chatOpenRoom(r); }, room);
    await until(a, function () { return document.getElementById('cxIn') && CX.info; }); await until(k, function () { return document.getElementById('cxIn') && CX.info; });

    // </> 코드 블록
    await a.evaluate(function () { _cxSend('로그 확인 부탁 `ERR 0x21`\n```js\nplc.connect({ ip: "192.168.0.15" })\n  .retry(3)\n```'); });
    var code = await until(k, function () { var c = document.querySelector('#cxMsgs .cx-code'); return c && /plc\.connect/.test(c.textContent) && /js · 2줄/.test(c.textContent) && document.querySelector('#cxMsgs .cx-ic'); });
    check(code, '코드 블록 · 한 줄 코드 — 상대 화면');

    // ✍️ 🛠 요청 글
    await a.click('#cxComp [data-c="post"]');
    await a.waitForSelector('#cxPostModal');
    check(await a.evaluate(function () { return document.querySelector('#cxPostModal [data-cat="req"]').classList.contains('on') && /현상:/.test(document.getElementById('ccBody').value); }), '글쓰기 — 🛠 요청 기본 · 현상 틀');
    await a.type('#ccTitle', '조립기 #3 PLC 통신 10분마다 끊김');
    await a.type('#ccEquip', '조립기 #3');
    await a.select('#ccAsg', kim.id);
    await a.click('#ccUrg');
    await a.evaluate(function () { var d = new Date(Date.now() + 86400000); document.getElementById('ccDue').value = d.toISOString().slice(0, 10); });
    await a.click('#cxPostModal [data-ok]');
    var kGot = await until(k, function () { var p = document.querySelector('#cxMsgs .cc-post.cat-req.urg'); return p && /조립기 #3 PLC/.test(p.textContent) && /김팀원/.test(p.textContent) && /접수/.test(p.textContent) && /내일/.test(p.textContent); });
    check(kGot, '요청 글 — 상대에게 바로 (긴급 · 담당 · 접수 · 기한 내일)');
    var mid = await a.evaluate(function () { return CX.msgs.filter(function (m) { return m.post; })[0].id; });
    var notif = await k.evaluate(function () { return CX.rooms.length >= 0; });

    // 김팀원: ▶ 처리 시작 → 관리자 화면 실시간
    await k.evaluate(function (id) { document.querySelector('#cxMsgs .cc-post[data-post="' + id + '"] [data-pst="doing"]').click(); }, mid);
    var doing = await until(a, function (id) { var p = document.querySelector('#cxMsgs .cc-post[data-post="' + id + '"]'); return p && /처리 중/.test(p.querySelector('.cc-h').textContent); }, mid);
    check(doing, '처리 시작 → 관리자 화면에 "처리 중" 실시간');

    // 📌 게시판 탭
    await a.evaluate(function () { CX.aside = true; CX.asideTab = 'board'; _cxDrawAside(); });
    var board = await until(a, function () { var l = document.querySelector('#cxAsB [data-plist]'); return l && l.querySelectorAll('.cc-post').length === 1; });
    check(board, '📌 게시판 탭 — 글 1');
    await a.evaluate(function () { return apiFetch('/api/chat/rooms/' + CX.room + '/posts', { method: 'POST', body: JSON.stringify({ cat: 'notice', title: '다음 주 화요일 라인 정지 점검' }) }); });
    var board2 = await until(a, function () { return document.querySelectorAll('#cxAsB [data-plist] .cc-post').length === 2; });
    await a.evaluate(function () { document.querySelector('#cxAsB [data-pc="notice"]').click(); });
    var onlyNotice = await until(a, function () { var ps = document.querySelectorAll('#cxAsB [data-plist] .cc-post'); return ps.length === 1 && ps[0].classList.contains('cat-notice'); });
    check(board2 && onlyNotice, '새 글 실시간 반영 · 📢 공지만 거르기');
    await a.evaluate(function () { document.querySelector('#cxAsB [data-pc=""]').click(); });
    await a.screenshot({ path: path.join(SHOT, 'e2e60-board-admin.png') });

    // 💬 댓글 줄기 — 글 전체 + 상태 기록
    await a.evaluate(function (id) { document.querySelector('#cxMsgs .cc-post[data-post="' + id + '"] [data-pthread]').click(); }, mid);
    var th = await until(a, function () { var t = document.getElementById('cxThMsgs'); return t && t.querySelector('.cc-post .cc-acts') && /처리 중/.test(t.textContent) && /김팀원 님/.test(t.textContent); });
    check(th, '댓글 줄기 — 글 카드 · "처리 중" 기록');

    // 🛠 요청함 (김팀원) → ✅ 완료
    await k.click('#cxReqs');
    await k.waitForSelector('#cxLib');
    var inbox = await until(k, function (id) { return document.querySelector('#cxLib .cc-rlist .cc-post[data-post="' + id + '"]') && /처리 중 <b>1<\/b>/.test(document.querySelector('#cxLib [data-rsum]').innerHTML); }, mid);
    check(inbox, '🛠 요청함 — 나에게 온 요청 · 처리 중 1');
    await k.screenshot({ path: path.join(SHOT, 'e2e60-reqs-kim.png') });
    await k.evaluate(function (id) { document.querySelector('#cxLib .cc-post[data-post="' + id + '"] [data-pst="done"]').click(); }, mid);
    var gone = await until(k, function (id) { return !document.querySelector('#cxLib .cc-rlist .cc-post[data-post="' + id + '"]'); }, mid);
    var aDone = await until(a, function (id) { var p = document.querySelector('#cxMsgs .cc-post[data-post="' + id + '"]'); return p && p.classList.contains('fin') && /완료/.test(p.textContent); }, mid);
    check(gone && aDone, '완료 → 요청함에서 빠짐 · 관리자 화면 "완료"');
    await k.keyboard.press('Escape'); await wait(300);
    await k.evaluate(function () { var o = document.getElementById('cxLib'); if (o) o.closest('.wa-modal-overlay').remove(); });

    // 📁 폴더에 담기 (코드 메시지) → 📂 내 폴더
    var codeMid = await k.evaluate(function () { return CX.msgs.filter(function (m) { return /plc\.connect/.test(m.body || ''); })[0].id; });
    await k.evaluate(function (id) { var m = document.querySelector('#cxMsgs .cx-m[data-mid="' + id + '"]'); m.querySelector('[data-a="more"]').click(); }, codeMid);
    await k.waitForSelector('.cx-menu');
    await clickText(k, '.cx-menu button', /폴더에 담기/);
    await until(k, function () { return Array.prototype.some.call(document.querySelectorAll('.cx-menu button'), function (b) { return /새 내 폴더에 담기/.test(b.textContent); }); });
    await clickText(k, '.cx-menu button', /새 내 폴더에 담기/);
    await wait(800);
    var saved = await c.query("SELECT f.name, s.msg_id FROM chat_saved s JOIN chat_folders f ON f.id = s.folder_id WHERE s.user_id = $1", [kim.id]);
    check(saved.rows.length === 1 && saved.rows[0].name === '조립기 자료' && +saved.rows[0].msg_id === codeMid, '📁 새 폴더 "조립기 자료"에 담기');
    await k.click('#cxFolders');
    await k.waitForSelector('#cxLib .cc-grid');
    var lib = await until(k, function () { return document.querySelector('#cxLib .cc-f.on') && /조립기 자료/.test(document.querySelector('#cxLib .cc-f.on').textContent) && document.querySelector('#cxLib .cc-it .cx-code'); });
    check(lib, '📂 내 폴더 — 폴더 · 코드 메시지 카드');
    await k.screenshot({ path: path.join(SHOT, 'e2e60-folders-kim.png') });
    await k.evaluate(function () { document.querySelector('#cxLib .cc-it [data-igo]').click(); });
    var went = await until(k, function () { return !document.getElementById('cxLib') && document.querySelector('#cxMsgs .cx-hl'); }, null, 6000);
    check(went, '↗ 대화에서 보기 — 그 메시지로 이동 · 반짝');

    // 휴대폰 너비 — 게시판 글 카드가 넘치지 않음
    await k.setViewport({ width: 390, height: 844 });
    await wait(500);
    var over = await k.evaluate(function () { return Array.prototype.some.call(document.querySelectorAll('#cxMsgs .cc-post'), function (p) { return p.getBoundingClientRect().right > window.innerWidth + 1; }); });
    check(!over, '휴대폰 — 글 카드가 화면 밖으로 안 나감');
    await k.screenshot({ path: path.join(SHOT, 'e2e60-mobile-kim.png') });

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (A) await A.b.close(); if (K) await K.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
