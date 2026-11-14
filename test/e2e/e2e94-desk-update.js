// 🖥 PC 앱 자체 업데이트 (v13.495) — 서버 /desktop-release · /api/build 의 desktop · 웹 새로 고침과 같이 설치
//   PC 앱 다리(window.wmDesktop)는 흉내: 예전 앱(업데이트 다리 없음) → '설치 파일 받기' 띠 / 새 앱 → 받아 두기(check) · 새로 고침 때 설치(apply)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var base = 'http://localhost:3000';
  try {
    var page = (await browser.pages())[0] || await browser.newPage();
    var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
    // 서버 — 버전 정보 · 파일
    await page.goto(base + '/api/build');
    var b = JSON.parse(await page.evaluate(function () { return document.body.innerText; })).data;
    check(b.desktop && /^\d+\.\d+\.\d+$/.test(b.desktop.version) && /^https:\/\/github\.com\/.+\/release\/desktop\/WorkManager-Setup-[\d.]+\.exe$/.test(b.desktop.file) && /^\/desktop-release\/WorkManager-Setup-[\d.]+\.exe$/.test(b.desktop.local), '/api/build 에 PC 앱 최신 버전 ' + JSON.stringify(b.desktop));
    var r = await page.evaluate(async function (f) {
      var y = await fetch('/desktop-release/latest.yml'); var yt = await y.text();
      var e = await fetch(f, { method: 'HEAD' });
      var bad = await fetch('/desktop-release/..%2Fpackage.json'); var bad2 = await fetch('/desktop-release/main.js');
      return { y: y.status, cc: y.headers.get('cache-control'), ver: (/version: (\S+)/.exec(yt) || [])[1], e: e.status, len: +e.headers.get('content-length'), bad: bad.status, bad2: bad2.status };
    }, b.desktop.local);
    check(r.y === 200 && /no-cache/.test(r.cc) && r.ver === b.desktop.version, 'latest.yml 내려 줌 (늘 새로) ' + JSON.stringify(r));
    check(r.e === 200 && r.len > 50e6, '설치 파일 내려 줌 ' + r.len);
    check(r.bad === 404 && r.bad2 === 404, '다른 파일은 못 받음 ' + r.bad + '/' + r.bad2);

    // 예전 PC 앱 — 업데이트 다리 없음 → '설치 파일 받기' 띠
    await page.evaluateOnNewDocument(function () { window.wmDesktop = { isDesktop: true, titleBarOverlay: false, platform: 'win32' }; try { localStorage.clear(); } catch (e) {} });
    await page.goto(base + '/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { wmUpdateCheck(true); });
    await page.waitForSelector('#wmUpd', { timeout: 8000 }).catch(function () {});
    var old = await page.evaluate(function () { var u = document.getElementById('wmUpd'); return u ? u.textContent : ''; });
    check(/PC 앱 새 버전 v[\d.]+/.test(old) && /설치 파일 받기/.test(old), '예전 PC 앱 → 설치 파일 받기 띠 ' + old.slice(0, 80));
    await page.$eval('#wmUpd .wm-upd-x', function (b) { b.click(); }); await wait(200);   // 로그인 화면이 띠를 덮어 마우스 클릭은 안 닿음
    await page.evaluate(function () { WMU.t = 0; wmUpdateCheck(true); }); await wait(1200);
    check(!(await page.$('#wmUpd')), '나중에 → 하루 동안 조용히');

    // 새 PC 앱 — 버전이 낮으면 받아 두기 · 받아 두면 띠 · 새로 고침 때 설치
    var page2 = await browser.newPage();
    page2.on('pageerror', function (e) { errs.push(e.message); });
    await page2.evaluateOnNewDocument(function () {
      window.__calls = []; window.__cb = null;
      window.__st = { version: '13.400.0', busy: false, pct: 0, ready: null };
      window.wmDesktop = { isDesktop: true, titleBarOverlay: false, winControls: false, platform: 'win32',
        appUpdate: function (a) { window.__calls.push(a); if (a === 'check') { window.__st.busy = true; }
          if (a === 'apply') return Promise.resolve(window.__st.ready ? Object.assign({}, window.__st, { installing: true }) : Object.assign({}, window.__st));
          return Promise.resolve(Object.assign({}, window.__st)); },
        onAppUpdate: function (cb) { window.__cb = cb; } };
      window.__wmReload = function () { window.__reloaded = true; };
      try { localStorage.clear(); } catch (e) {}
    });
    await page2.goto(base + '/', { waitUntil: 'networkidle2' });
    await page2.evaluate(function () { wmUpdateCheck(true); }); await wait(1200);
    var c1 = await page2.evaluate(function () { return window.__calls.slice(); });
    check(c1.indexOf('check') >= 0, '새 PC 앱 — 더 새 버전이 있으면 뒤에서 받기 시작 ' + JSON.stringify(c1));
    // 다 받음 → 띠
    await page2.evaluate(function (v) { window.__st = { version: '13.400.0', busy: false, pct: 100, ready: v }; window.__cb(window.__st); }, b.desktop.version);
    await wait(200);
    var bar = await page2.evaluate(function () { var u = document.getElementById('wmUpd'); return u ? u.textContent : ''; });
    check(/PC 앱 새 버전 v[\d.]+ 준비됨/.test(bar) && /지금 적용/.test(bar), '받아 두면 → 「준비됨 · 지금 적용」 띠 ' + bar.slice(0, 60));
    await page2.$eval('#wmUpd .wm-upd-go', function (b) { b.click(); }); await wait(400);
    var ap = await page2.evaluate(function () { return { calls: window.__calls.slice(), reloaded: !!window.__reloaded, txt: (document.querySelector('#wmUpd .wm-upd-go') || {}).textContent }; });
    ap.txt = await page2.evaluate(function () { var u = document.getElementById('wmUpd'); return u ? u.textContent : ''; });
    check(ap.calls.indexOf('apply') >= 0 && !ap.reloaded && /PC 앱 업데이트 설치 중/.test(ap.txt), '지금 적용 → PC 앱 설치(웹만 새로 고치지 않음) ' + JSON.stringify(ap));
    // v13.496 받는 중에 새로 고침 → 띠에 % 막대 · 다 받으면 '설치 중'
    await page2.evaluate(function () {
      window.__st = { version: '13.400.0', busy: true, pct: 30, ready: null }; window.__wmUpdGoing = false; window.__reloaded = false;
      var u = document.getElementById('wmUpd'); if (u) u.remove();
      var orig = window.__origUpd = window.wmDesktop.appUpdate;
      window.wmDesktop.appUpdate = function (a) { if (a === 'apply') return Promise.resolve(Object.assign({}, window.__st, { waiting: true })); return orig(a); };
      wmUpdateApply();
    });
    await wait(300);
    await page2.evaluate(function () { window.__cb({ version: '13.400.0', busy: true, pct: 64, ready: null }); });
    await wait(200);
    var pg = await page2.evaluate(function () { var u = document.getElementById('wmUpd'), p = u && u.querySelector('.wm-upd-pg i'); return { t: u ? u.textContent : '', w: p ? p.style.width : '', reloaded: !!window.__reloaded }; });
    check(/PC 앱 새 버전 받는 중 64%/.test(pg.t) && pg.w === '64%' && !pg.reloaded, '받는 중 → 띠에 % 막대 (웹은 새로 고치지 않고 기다림) ' + JSON.stringify(pg));
    await page2.evaluate(function () { window.__cb({ version: '13.400.0', busy: false, pct: 100, ready: '13.496.0', installing: true }); });
    await wait(200);
    var ins = await page2.evaluate(function () { var u = document.getElementById('wmUpd'); return u ? u.textContent : ''; });
    check(/PC 앱 업데이트 설치 중/.test(ins) && /설치 창이 뜨고/.test(ins), '다 받으면 → 설치 중 띠 ' + ins.slice(0, 50));
    await page2.evaluate(function () { var u = document.getElementById('wmUpd'); if (u) u.remove(); WMD.waiting = false; window.__st.busy = false; window.wmDesktop.appUpdate = window.__origUpd; });
    // 받아 둔 것이 없으면 웹만 새로 고침
    await page2.evaluate(function () { window.__st.ready = null; window.__wmUpdGoing = false; window.__reloaded = false; var u = document.getElementById('wmUpd'); if (u) u.remove(); wmUpdateApply(); });
    await wait(1000);
    check(await page2.evaluate(function () { return window.__reloaded; }), '받아 둔 PC 앱이 없으면 웹만 새로 고침');
    // v13.499 띠가 떠 있는 채로 「지금 새로 고침」 — 받아 둔 PC 앱이 없으면 반드시 다시 엶 (v13.495~498 은 여기서 멈췄음)
    await page2.evaluate(function () {
      window.__st = { version: '13.400.0', busy: false, pct: 0, ready: null }; window.__wmUpdGoing = false; window.__reloaded = false; WMD.waiting = false;
      _wmUpdBar({ title: '새 버전 v9', go: wmUpdateApply });
      // 새 빌드인 척 — 지금 화면이 쓰는 스크립트 하나를 목록에서 빼 두면 미리 받을 것이 생김
      var sc = document.querySelector('script[src*="chat-ui.js?v="]'); if (sc) sc.removeAttribute('src');
      window.__steps = [];
      var orig = window._wmUpdStep; window._wmUpdStep = function (t, s, p) { window.__steps.push(t); return orig(t, s, p); };
    });
    await page2.$eval('#wmUpd .wm-upd-go', function (b) { b.click(); });
    var reloadedOk = await page2.waitForFunction(function () { return window.__reloaded; }, { timeout: 8000 }).then(function () { return true; }, function () { return false; });
    var steps = await page2.evaluate(function () { return window.__steps; });
    check(reloadedOk, '띠의 「지금 새로 고침」 → 실제로 다시 엶 (멈추지 않음)');
    check(steps.some(function (t) { return /PC 앱 업데이트 확인/.test(t); }) && steps.some(function (t) { return /새 화면 받는 중 1\/1/.test(t); }) && /다시 여는 중/.test(steps[steps.length - 1]), '단계가 보임 — ' + steps.join(' → '));
    // 브라우저(PC 앱 아님)에는 아무것도
    var page3 = await browser.newPage();
    await page3.evaluateOnNewDocument(function () { try { localStorage.clear(); } catch (e) {} });
    await page3.goto(base + '/', { waitUntil: 'networkidle2' });
    await page3.evaluate(function () { wmUpdateCheck(true); }); await wait(1200);
    check(!(await page3.$('#wmUpd')), '브라우저에는 PC 앱 띠 없음');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack || e);
  } finally {
    await browser.close();
    console.log(fail ? 'e2e94 FAIL ' + fail : 'e2e94-desk-update.js ALL PASS ' + ok, '[]');
    process.exit(fail ? 1 : 0);
  }
})();
