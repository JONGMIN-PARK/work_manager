// 할 일 상세 패널 닫기 (v13.465) — 열자마자 Esc · 바깥 누르기로 닫힘 (예전엔 패널 안을 한 번 눌러야 됐음) · 안 누르기 · 다른 할 일 누르기는 안 닫힘
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0, ids = [];
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    ids = await page.evaluate(async function () {
      var a = await apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: '닫기시험 하나' }) });
      var b = await apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: '닫기시험 둘' }) });
      return [a.data.id, b.data.id];
    });
    await page.evaluate(function () { setPage('mywork'); }); await wait(1500);
    var open = async function (t) { await page.evaluate(function (x) { Array.from(document.querySelectorAll('#mMyWork .mw-title')).filter(function (e) { return e.textContent === x; })[0].click(); }, t); await page.waitForSelector('#mwPanel.on #mwpTitle'); await wait(300); };
    var isOpen = function () { return page.evaluate(function () { var p = document.getElementById('mwPanel'); return !!(p && p.classList.contains('on')); }); };
    // ① 열자마자 Esc (패널 안을 누르지 않고)
    await open('닫기시험 하나');
    await page.evaluate(function () { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    await page.keyboard.press('Escape'); await wait(300);
    check(!(await isOpen()), '열자마자 Esc — 닫힘');
    // ② 위 검색칸에 커서가 있어도 Esc
    await open('닫기시험 하나');
    await page.evaluate(function () { var s = document.querySelector('#mMyWork input[type=search], #mMyWork input'); if (s) s.focus(); });
    await page.keyboard.press('Escape'); await wait(300);
    check(!(await isOpen()), '다른 입력 칸에 커서가 있어도 Esc — 닫힘');
    // ③ 패널 안 누르기는 그대로
    await open('닫기시험 하나');
    await page.click('#mwPanel #mwpTitle'); await wait(200);
    check(await isOpen(), '패널 안 누르면 그대로');
    // ④ 바깥(빈 곳) 누르기
    var r = await page.evaluate(function () { var p = document.getElementById('mwPanel').getBoundingClientRect(); return { x: Math.max(20, p.left - 300), y: 860 }; });
    await page.mouse.click(r.x, r.y); await wait(300);
    check(!(await isOpen()), '바깥 누르면 닫힘');
    // ⑤ 다른 할 일 누르면 그 할 일로
    await open('닫기시험 하나');
    await open('닫기시험 둘');
    check(await page.evaluate(function () { return document.getElementById('mwpTitle').value === '닫기시험 둘' && document.getElementById('mwPanel').classList.contains('on'); }), '다른 할 일 누르면 그 할 일로 바뀜');
    // ⑥ 위에 확인 창이 떠 있으면 Esc 는 확인 창 먼저
    await page.evaluate(function () { window.__wmDialogUi = true; wmConfirm('시험 확인 창'); return 1; }); await wait(300);
    await page.keyboard.press('Escape'); await wait(300);
    check(await isOpen(), '확인 창이 떠 있으면 Esc 는 확인 창만');
    await page.keyboard.press('Escape'); await wait(300);
    check(!(await isOpen()), '한 번 더 Esc — 패널 닫힘');
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  finally {
    try { await page.evaluate(async function (ids) { for (var i = 0; i < ids.length; i++) await apiFetch('/api/my-work/todos/' + ids[i], { method: 'DELETE' }); }, ids); } catch (e) {}
    await browser.close();
  }
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
