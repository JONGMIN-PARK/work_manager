// 프로젝트 상세 — 화면 가득(기본) ↔ 옆 패널 (v13.453)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var SHOT = path.join(__dirname, '.shots');
(async function () {
  require('fs').mkdirSync(SHOT, { recursive: true });
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var box = function () { return page.evaluate(function () { var p = document.getElementById('projDetailPanel'); if (!p) return null; var r = p.getBoundingClientRect(); return { l: Math.round(r.left), w: Math.round(r.width), vw: innerWidth, max: p.classList.contains('pd-max'), btn: (function (b) { return b && getComputedStyle(b).display !== 'none'; })(p.querySelector('.pd-maxbtn')), hscroll: p.scrollWidth > p.clientWidth + 2 }; }); };
  try {
    await page.setViewport({ width: 1600, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { localStorage.removeItem('pd-panel-mode'); localStorage.removeItem('pd-panel-frac'); } catch (e) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!'); await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    var pid = await page.evaluate(function () { return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'E2E 최대화 ' + Date.now(), orderNo: 'MAX-' + Date.now() }) }).then(function (r) { return r.data.id; }); });
    await page.evaluate(function () { setPage('project'); setMode('pipeline'); });
    var open = async function () { await page.evaluate(function (pid) { if (typeof pdCloseDetail === 'function') pdCloseDetail(); return showProjectDetail(pid); }, pid); await wait(700); };
    await open();
    var b1 = await box();
    check(b1 && b1.max && b1.l === 0 && b1.w >= b1.vw - 2 && b1.btn, 'PC — 처음부터 화면 가득 (' + JSON.stringify(b1) + ')');
    await page.screenshot({ path: path.join(SHOT, 'e2e81-max.png') });
    await page.click('#projDetailPanel .pd-maxbtn');
    var b2 = await box();
    check(!b2.max && b2.l > b2.vw * 0.5 && b2.w < b2.vw * 0.45, '◧ 누르면 옆 패널 (' + b2.w + 'px)');
    await open();
    check(!(await box()).max, '다시 열어도 옆 패널 (기억)');
    await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyF'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    check((await box()).max, 'Ctrl+Shift+F — 다시 화면 가득');
    await page.evaluate(function () { pdSetPanelSize(0.5); });
    var b3 = await box();
    check(!b3.max && Math.abs(b3.w - b3.vw * 0.5) < 6, '패널 폭(보통)을 고르면 옆 패널 절반으로');
    await page.evaluate(function () { pdTogglePanelMax(true); });
    // 사양 탭 — 가득일 때 넓게
    await page.evaluate(function () { var t = document.getElementById('pdTabSpec'); if (t) t.click(); }); await wait(1200);
    var sw = await page.evaluate(function () { var s = document.getElementById('pdSpec'); return s ? s.clientWidth : 0; });
    check(sw > 1100, '화면 가득 — 사양 칸도 넓게 (' + sw + 'px)');
    check(!(await box()).hscroll, '옆으로 넘치지 않음');
    // 휴대폰 크기
    await page.setViewport({ width: 390, height: 820 }); await wait(400);
    var b4 = await box();
    check(b4.l === 0 && b4.w >= 388 && !b4.btn && !b4.hscroll, '휴대폰 — 늘 가득 · 단추 숨김 · 옆으로 안 넘침 (' + JSON.stringify(b4) + ')');
    await page.screenshot({ path: path.join(SHOT, 'e2e81-phone.png') });
    await page.evaluate(function () { pdTogglePanelMax(false); }); await wait(200);
    var b5 = await box();
    check(b5.l === 0 && b5.w >= 388, '휴대폰 — 옆 패널로 기억돼 있어도 가득');
    check(!errs.length, '화면 오류 없음' + (errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  await browser.close();
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
