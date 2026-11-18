// 🎯 내 업무 — 📨 받은 요청 칸 (v13.531) — 목록 맨 위 · ✔ 할 일로(목록에 바로) · 일정에 넣기 · 👍 확인만 · ↩ 반려 · 다 답하면 칸 사라짐 · 접기
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var B = 'http://localhost:3000';
async function tok(email) { var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) }); return (await r.json()).data.accessToken; }
async function call(t, method, url, body) { var r = await fetch(B + url, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined }); return r.json(); }
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    var A = await tok('admin@t.com'), K = await tok('kim@t.com');
    var kId = (await call(K, 'GET', '/api/auth/me')).data; kId = kId.id || (kId.user && kId.user.id);
    // 김팀원에게 남은 답 안 한 요청은 정리하고 새로 4건
    var old = (await call(K, 'GET', '/api/work-requests?box=in&open=1')).data || [];
    for (var i = 0; i < old.length; i++) if (old[i].status === 'sent') await call(K, 'POST', '/api/work-requests/' + old[i].id + '/decline', { reply: '정리' });
    var T = Date.now();
    await call(A, 'POST', '/api/work-requests', { type: 'order', title: '견적 검토 ' + T, body: '단가 확인', dueDate: '2026-01-05', toUserIds: [kId] });
    await call(A, 'POST', '/api/work-requests', { type: 'forward', title: '회의록 공유 ' + T, toUserIds: [kId] });
    await call(A, 'POST', '/api/work-requests', { type: 'event', title: '현장 방문 ' + T, dueDate: '2026-12-20', dueTime: '14:00', toUserIds: [kId] });
    await call(A, 'POST', '/api/work-requests', { type: 'todo', title: '자료 정리 ' + T, toUserIds: [kId] });

    await page.setViewport({ width: 1500, height: 950 });
    await page.goto(B + '/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'kim@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    await page.evaluate(function () { setPage('mywork'); });
    await page.waitForSelector('#mwWrq:not([hidden]) .mwq-it', { timeout: 15000 });
    var s0 = await page.evaluate(function () {
      var box = document.getElementById('mwWrq'), main = box.closest('.mw-main');
      return { n: box.querySelectorAll('.mwq-it').length, head: box.querySelector('.mwq-hd').textContent, first: main && main.firstElementChild === box, late: box.querySelectorAll('.mwq-it.late').length,
        btns: [].map.call(box.querySelectorAll('.mwq-it'), function (it) { return [].map.call(it.querySelectorAll('[data-wq]'), function (b) { return b.dataset.wq; }).join('+'); }) };
    });
    check(s0.n === 4 && s0.first && /받은 요청 4/.test(s0.head), '내 업무 목록 맨 위에 📨 받은 요청 4 ' + JSON.stringify(s0));
    check(/기한 지남 1/.test(s0.head) && s0.late === 1, '기한 지난 것 표시');
    check(s0.btns.indexOf('accept+done+decline') >= 0 && s0.btns.filter(function (x) { return x === 'accept+decline'; }).length === 3, '전달만 👍 확인만 ' + JSON.stringify(s0.btns));

    var itemOf = function (re) { return page.evaluateHandle(function (re) { return [].filter.call(document.querySelectorAll('#mwWrq .mwq-it'), function (x) { return new RegExp(re).test(x.textContent); })[0]; }, re); };
    // ✔ 할 일로 — 칸에서 빠지고 내 할 일 목록에 바로
    await page.evaluate(function (T) { [].filter.call(document.querySelectorAll('#mwWrq .mwq-it'), function (x) { return x.textContent.indexOf('견적 검토 ' + T) >= 0; })[0].querySelector('[data-wq="accept"]').click(); }, T);
    await page.waitForFunction(function (T) { return typeof _mw !== 'undefined' && _mw.data && (_mw.data.data || []).some(function (x) { return x.src === 'todo' && x.title === '견적 검토 ' + T; }); }, { timeout: 10000 }, T).catch(function () {});
    var a1 = await page.evaluate(function (T) {
      var it = (_mw.data.data || []).filter(function (x) { return x.src === 'todo' && x.title === '견적 검토 ' + T; })[0];
      var onScreen = [].some.call(document.querySelectorAll('#mMyWork .mw-main *'), function (x) { return x.children.length === 0 && x.textContent === '견적 검토 ' + T; });
      return { todo: !!it, due: it && it.due, pri: it && it.pri, screen: onScreen, n: document.querySelectorAll('#mwWrq .mwq-it').length };
    }, T);
    check(a1.todo && a1.due === '2026-01-05' && a1.screen && a1.n === 3, '✔ 할 일로 — 내 할 일 목록에 바로 · 칸 3 ' + JSON.stringify(a1));
    // 일정에 넣기
    await page.evaluate(function (T) { [].filter.call(document.querySelectorAll('#mwWrq .mwq-it'), function (x) { return x.textContent.indexOf('현장 방문 ' + T) >= 0; })[0].querySelector('[data-wq="accept"]').click(); }, T);
    await wait(1200);
    var ev = (await call(K, 'GET', '/api/my-work/events?from=2026-12-01&to=2026-12-31')).data || [];
    check(ev.some(function (e) { return e.title === '현장 방문 ' + T; }), '🗓 일정에 넣기 — 내 일정');
    // 👍 확인만 (할 일 안 생김)
    await page.evaluate(function (T) { [].filter.call(document.querySelectorAll('#mwWrq .mwq-it'), function (x) { return x.textContent.indexOf('회의록 공유 ' + T) >= 0; })[0].querySelector('[data-wq="done"]').click(); }, T);
    await wait(1200);
    var noTodo = await page.evaluate(function (T) { return !(_mw.data.data || []).some(function (x) { return x.title === '회의록 공유 ' + T; }); }, T);
    var out = (await call(A, 'GET', '/api/work-requests?box=out')).data || [];
    check(noTodo && out.some(function (w) { return w.title === '회의록 공유 ' + T && w.status === 'done'; }), '👍 확인만 — 할 일 없이 보낸 사람에게 완료');
    // 접기 · 펴기
    await page.evaluate(function () { document.querySelector('#mwWrq [data-mwq="fold"]').click(); });
    var folded = await page.evaluate(function () { return document.querySelectorAll('#mwWrq .mwq-it').length; });
    await page.evaluate(function () { document.querySelector('#mwWrq [data-mwq="fold"]').click(); });
    check(folded === 0 && await page.evaluate(function () { return document.querySelectorAll('#mwWrq .mwq-it').length === 1; }), '접기 · 펴기');
    // ↩ 반려 (이유) → 다 답하면 칸 사라짐
    await page.evaluate(function () { window.wmPrompt = function () { return Promise.resolve('이번 주 어려움'); }; });
    await page.evaluate(function () { document.querySelector('#mwWrq [data-wq="decline"]').click(); });
    await page.waitForFunction(function () { return document.getElementById('mwWrq').hidden; }, { timeout: 8000 }).catch(function () {});
    out = (await call(A, 'GET', '/api/work-requests?box=out')).data || [];
    check(await page.evaluate(function () { return document.getElementById('mwWrq').hidden; }) && out.some(function (w) { return w.title === '자료 정리 ' + T && w.status === 'declined' && w.reply === '이번 주 어려움'; }), '↩ 반려(이유) · 다 답하면 칸 숨김');
    // 메신저에서 새로 온 요청 — 다시 그리면 다시 보임
    await call(A, 'POST', '/api/work-requests', { type: 'order', title: '추가 지시 ' + T, toUserIds: [kId] });
    await page.evaluate(function () { return wrqMwLoad(); });
    check(await page.evaluate(function () { var b = document.getElementById('mwWrq'); return !b.hidden && /추가 지시/.test(b.textContent); }), '새 요청 — 다시 받으면 보임');
    // 좁은 화면 — 넘침 없음
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
    await wait(500);
    var hs = await page.evaluate(function () { var b = document.getElementById('mwWrq'); return b ? b.scrollWidth - b.clientWidth : -1; });
    check(hs <= 1, '휴대폰 폭 — 가로 넘침 없음 ' + hs);
    var left = (await call(K, 'GET', '/api/work-requests?box=in&open=1')).data || [];
    for (var j = 0; j < left.length; j++) if (left[j].status === 'sent') await call(K, 'POST', '/api/work-requests/' + left[j].id + '/decline', {});
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
