// 🎨 글자 크기 · 기본 테마/글씨체 (v13.463) — 처음 = 포커스 · 맑은 고딕 · 가+ 로 글자 키움(글씨체마다 따로) · 기본 · 작은 글자 키우기와 함께
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    var d0 = await page.evaluate(function () { return { th: document.documentElement.getAttribute('data-theme'), f: cFnt, ls: localStorage.getItem('wa-theme') }; });
    check(d0.th === 'focus' && d0.f === 'malgun', '처음 열면 포커스 · 맑은 고딕 ' + JSON.stringify(d0));
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    var fs = function () { return page.evaluate(function () { var t = document.querySelector('#pageTabs .tab, .page-tab, #pageTabs button'); return { tab: parseFloat(getComputedStyle(t).fontSize), html: parseFloat(getComputedStyle(document.documentElement).fontSize), val: document.getElementById('fszVal').textContent }; }); };
    var a = await fs();
    await page.evaluate(function () { wmHdrPop('hdrLookWrap'); }); await wait(200);
    check(await page.evaluate(function () { return !!document.getElementById('fszPlus').offsetParent && /맑은 고딕/.test(document.getElementById('fszFont').textContent); }), '🎨 화면 설정에 글자 크기 · 지금 글씨체 이름');
    await page.click('#fszPlus'); await page.click('#fszPlus'); await wait(300);
    var b = await fs();
    check(b.val === '120%' && Math.abs(b.tab - a.tab * 1.2) <= 0.6 && b.html === 19.2, '가+ 두 번 = 120% · 탭 글자 ' + a.tab + ' → ' + b.tab);
    // 화면이 직접 쓴 style="font-size:12px" 도
    var inl = await page.evaluate(function () { var d = document.createElement('div'); d.setAttribute('style', 'font-size:12px'); d.textContent = 'x'; document.body.appendChild(d); var v = parseFloat(getComputedStyle(d).fontSize); d.remove(); return v; });
    check(inl === 14.5 || inl === 14, 'style 속성 12px → ' + inl);
    // 글씨체마다 따로 — 노토로 바꾸면 100%, 다시 맑은 고딕이면 120%
    await page.evaluate(function () { aFnt('noto'); }); await wait(300);
    var c = await fs();
    check(c.val === '100%' && Math.abs(c.tab - a.tab) <= 0.6, '다른 글씨체는 따로 (100%) ' + JSON.stringify(c));
    await page.evaluate(function () { aFnt('malgun'); }); await wait(300);
    check((await fs()).val === '120%', '맑은 고딕으로 돌아오면 다시 120%');
    // 다시 열어도 그대로
    await page.reload({ waitUntil: 'networkidle2' }); await wait(1500);
    var r = await page.evaluate(function () { return { s: _wmFs.s, css: !!document.getElementById('wmCrispCss'), th: document.documentElement.getAttribute('data-theme') }; });
    check(r.s === 1.2 && r.css && r.th === 'focus', '새로 고쳐도 120% · 포커스 ' + JSON.stringify(r));
    // 작은 글자 키우기와 함께 — 10px → 11 × 1.2 = 13(반올림 0.5)
    var cr = await page.evaluate(function () { aCrisp(true); var d = document.createElement('div'); d.setAttribute('style', 'font-size:10px'); document.body.appendChild(d); var v = parseFloat(getComputedStyle(d).fontSize); d.remove(); return v; });
    check(cr === 13, '작은 글자 키우기 + 120% — 10px → ' + cr);
    // 기본
    await page.evaluate(function () { aCrisp(false); aFsz(1); }); await wait(200);
    check(await page.evaluate(function () { return !document.getElementById('wmCrispCss') && document.getElementById('fszVal').textContent === '100%' && document.getElementById('fszReset').hidden; }), '기본 — 덧붙인 규칙 없앰');
    // 예전에 고른 테마는 그대로 (자동 · 노토만 한 번 옮김)
    await page.evaluate(function () { localStorage.removeItem('wa-def463'); localStorage.setItem('wa-theme', 'nova'); localStorage.setItem('wa-font', 'pretendard'); });
    await page.reload({ waitUntil: 'networkidle2' }); await wait(800);
    var k = await page.evaluate(function () { return { th: document.documentElement.getAttribute('data-theme'), f: cFnt }; });
    check(k.th === 'nova' && k.f === 'pretendard', '직접 고른 테마 · 글씨체는 그대로 ' + JSON.stringify(k));
    await page.evaluate(function () { localStorage.removeItem('wa-def463'); localStorage.setItem('wa-theme', 'auto'); localStorage.setItem('wa-font', 'noto'); });
    await page.reload({ waitUntil: 'networkidle2' }); await wait(800);
    k = await page.evaluate(function () { return { th: document.documentElement.getAttribute('data-theme'), f: cFnt }; });
    check(k.th === 'focus' && k.f === 'malgun', '자동 · 노토(처음 값)는 포커스 · 맑은 고딕으로 ' + JSON.stringify(k));
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  await browser.close();
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
