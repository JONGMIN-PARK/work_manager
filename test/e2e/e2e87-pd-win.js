// 📁 프로젝트 상세 새 창 (v13.464) — ↗ 로 떼어 내기 · 새 창은 상세만 창 가득 · 본 창 로그인 · 고치면 본 창 다시 그림 · 마지막 화면 안 바뀜 · ✕ = 창 닫기
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push('main: ' + e.message); });
  var ok = 0, fail = 0, pid = null;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    pid = await page.evaluate(async function () {
      var id = 'pdw' + Date.now();
      await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ id: id, name: '새창 시험 프로젝트', status: 'active', color: '#3b82f6' }) });
      _pdInvalidate(); setPage('project'); return id;
    });
    await wait(800);
    var lv0 = await page.evaluate(function () { return localStorage.getItem('wm-last-view'); });
    await page.evaluate(function (id) { return showProjectDetail(id); }, pid);
    await page.waitForSelector('#projDetailPanel .pd-popbtn', { timeout: 8000 });
    check(true, '상세 머리에 ↗ 새 창 단추');
    var tgtP = browser.waitForTarget(function (t) { return t.url().indexOf('?pd=') >= 0; }, { timeout: 15000 });
    await page.click('#projDetailPanel .pd-popbtn');
    var tgt = await tgtP, pw = await tgt.page();
    pw.on('pageerror', function (e) { errs.push('pd: ' + e.message); });
    check(await page.evaluate(function () { return !document.getElementById('projDetailPanel'); }), '본 창 상세는 닫힘');
    await pw.waitForSelector('#projDetailPanel', { timeout: 30000 }); await wait(800);
    var w = await pw.evaluate(function () {
      var p = document.getElementById('projDetailPanel'), r = p.getBoundingClientRect();
      return { cls: document.documentElement.classList.contains('wm-pdwin'), max: p.classList.contains('pd-max'), x: r.left, w: Math.round(r.width), iw: innerWidth, hdr: !!document.querySelector('.hdr').offsetParent, bd: !!(document.getElementById('projDetailBackdrop') || {}).offsetParent, title: document.title, pop: !!(p.querySelector('.pd-popbtn') || {}).offsetParent, login: !!currentUser && !!currentUser.id };
    });
    check(w.cls && w.max && w.x === 0 && w.w === w.iw && !w.hdr && !w.bd, '새 창 — 상세만 창 가득 · 머리 · 뒤 화면 숨김 ' + JSON.stringify(w));
    check(/새창 시험 프로젝트/.test(w.title) && !w.pop && w.login, '창 제목 = 프로젝트 이름 · ↗ 없음 · 따로 로그인 안 함 ' + w.title);
    // 새 창에서 고침 → 본 창 캐시 비움
    await page.evaluate(function () { _modeRendered.__probe = Date.now(); });
    await pw.evaluate(function (id) { return apiFetch('/api/projects/' + id, { method: 'PUT', body: JSON.stringify({ id: id, name: '새창 시험 프로젝트 고침', status: 'active', color: '#3b82f6' }) }); }, pid);
    await wait(1200);
    check(await page.evaluate(function () { return !_modeRendered.__probe; }), '새 창에서 고치면 본 창 화면 캐시를 비우고 다시 그림');
    // Esc 로 닫히지 않음 · 마지막 화면 그대로
    await pw.keyboard.press('Escape'); await wait(300);
    check(await pw.evaluate(function () { return !!document.getElementById('projDetailPanel'); }), '새 창은 Esc 로 안 닫힘');
    var lv1 = await page.evaluate(function () { return localStorage.getItem('wm-last-view'); });
    check(lv1 === lv0 || /project/.test(lv1), '본 창 마지막 화면 그대로 ' + lv0 + ' / ' + lv1);
    // ✕ = 창 닫기
    var closed = new Promise(function (r) { pw.once('close', function () { r(true); }); setTimeout(function () { r(false); }, 5000); });
    await pw.click('#projDetailPanel .pd-sticky button[title="창 닫기"]');
    check(await closed, '✕ 누르면 창이 닫힘');
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  finally {
    try { if (pid) await page.evaluate(function (id) { return apiFetch('/api/projects/' + id, { method: 'DELETE' }); }, pid); } catch (e) {}
    await browser.close();
  }
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
