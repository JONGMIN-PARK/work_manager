// 📱 내 업무 상세 창 작은 화면 (v13.501) — 칸 · 프로젝트도 굴림 안에(메모 아래를 가리던 것) · 끝까지 굴리면 메모 전체 · 옆으로 안 넘침
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = [], ok = 0, fail = 0; page.on('pageerror', function (e) { errs.push(e.message); });
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#loginEmail', { visible: true });
  await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!'); await page.keyboard.press('Enter');
  await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
  await page.evaluate(async function () {
    var r = await apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: '상세 창 시험 — 고객사 장비 사양 검토 및 견적 회신', dueDate: new Date().toISOString().slice(0, 10) }) });
    window.__tid = r.data && r.data.id;
    if (window.__tid) await apiFetch('/api/my-work/todos/' + window.__tid, { method: 'PUT', body: JSON.stringify({ memo: '첫 줄 메모\n둘째 줄\n셋째 줄\n넷째 줄 길게 써 봅니다 길게 길게 길게 길게 길게 길게 길게\n다섯\n여섯\n일곱\n여덟', checklist: [{ t: '사양서 받기', d: true }, { t: '견적 작성', d: false }, { t: '회신', d: false }] }) }).catch(function () {});
  });
  await page.evaluate(function () { setPage('mywork'); }); await wait(2000);
  async function openAndShot(name) {
    await page.evaluate(function () { var row = Array.from(document.querySelectorAll('#mMyWork .mw-row')).find(function (r) { return /상세 창 시험/.test(r.textContent); }); if (row) (row.querySelector('.mw-t,.mw-title') || row).click(); });
    await wait(900);
    var info = await page.evaluate(function () {
      var p = document.getElementById('mwPanel'); if (!p) return null;
      var r = p.getBoundingClientRect(), b = p.querySelector('.mwp-b'), f = p.querySelector('.mwp-f'), m = p.querySelector('.mwp-memo');
      var hd = document.querySelector('.hdr').getBoundingClientRect();
      return { panel: [r.top, r.bottom, r.width], vh: innerHeight, body: b && [b.scrollHeight, b.clientHeight], foot: f && f.getBoundingClientRect().bottom, memo: m && [Math.round(m.getBoundingClientRect().top), Math.round(m.getBoundingClientRect().bottom), m.scrollHeight, m.clientHeight], hdr: hd.bottom, z: getComputedStyle(p).zIndex };
    });
    var chk = await page.evaluate(function () {
      var p = document.getElementById('mwPanel'), b = p.querySelector('.mwp-b'), cat = p.querySelector('#mwpCat');
      b.scrollTop = 99999;
      var m = p.querySelector('.mwp-memo').getBoundingClientRect(), f = p.querySelector('.mwp-f').getBoundingClientRect(), br = b.getBoundingClientRect();
      var wide = Array.from(p.querySelectorAll('.mwp-b *')).filter(function (e) { var r = e.getBoundingClientRect(); return r.width && r.right > p.getBoundingClientRect().right + 1; }).map(function (e) { return e.className || e.tagName; });
      return { catIn: !cat || b.contains(cat), memoOk: m.bottom <= f.top + 1 && m.top >= br.top - 1, wide: wide.slice(0, 5), panelW: p.getBoundingClientRect().width, vw: innerWidth };
    });
    check(chk.catIn, name + ' — 칸 고르기도 굴림 안에');
    check(chk.memoOk, name + ' — 끝까지 굴리면 메모가 아래 단추에 안 가림');
    check(!chk.wide.length && chk.panelW <= chk.vw, name + ' — 옆으로 넘치는 것 없음 ' + JSON.stringify(chk.wide));
    await page.evaluate(function () { document.querySelector('#mwPanel .mwp-b').scrollTop = 0; });
    await page.screenshot({ path: path.join(SHOT, 'mwp-' + name + '.png') });
    await page.evaluate(function () { var b = document.querySelector('#mwPanel .mwp-b'); if (b) b.scrollTop = 99999; }); await wait(300);
    await page.screenshot({ path: path.join(SHOT, 'mwp-' + name + '-end.png') });
  }
  await openAndShot('phone');
  await page.evaluate(function () { if (typeof mwPanelClose === 'function') mwPanelClose(); });
  await page.setViewport({ width: 760, height: 560, isMobile: false, hasTouch: false }); await wait(800);
  await openAndShot('small');
  check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  await browser.close();
  console.log(fail ? 'e2e101 FAIL ' + fail : 'e2e101-mwp-small.js ALL PASS ' + ok, '[]');
  process.exit(fail ? 1 : 0);
})();
