// 공지 예시(✨ 예시 넣기 — 공수 등록 안내)에 붙일 캡처 3장을 만든다 → pwa/notice/gongsu-*.png
//   bash test/e2e/run.sh zz-notice-shots.js   (가짜 PC 앱 다리 · 꾸민 표본 자료 — 진짜 애니웍스에는 가지 않는다)
var path = require('path'), fs = require('fs');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var OUT = path.join(__dirname, '../../pwa/notice');
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  await c.query('DELETE FROM gongsu_days');
  fs.mkdirSync(OUT, { recursive: true });
  var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-shots' + Date.now()) });
  var fail = 0;
  try {
    var p = (await b.pages())[0] || await b.newPage();
    await p.evaluateOnNewDocument(function () {
      window.wmDesktop = { isDesktop: true, platform: 'win32', aw: function (cmd) { return Promise.resolve(cmd === 'status' ? { ok: true, v: 2, hasCred: true, id: 'hong', safe: true, maxRows: 15, memoMax: 50 } : { ok: false, error: '?' }); } };
    });
    await p.setViewport({ width: 1400, height: 940, deviceScaleFactor: 1.25 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    var iso = function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
    var T = new Date(), day = function (n) { return iso(new Date(T.getFullYear(), T.getMonth(), T.getDate() - n)); };
    var R = function (o, ps, h, dv, j, m) { return { orderno: o, prodspec: ps, hours: h, divi: dv, job: j, memo: m }; };
    var A = ['A26101', '레이저 가공기 정밀 스테이지'], B = ['B26034', '검사 장비 모션 제어 개발'], G = ['공통업무', '공통업무'];
    var days = [
      [0, false, [R(A[0], A[1], 4, '사내', '개발', '축 정렬 시퀀스 수정 · 반복 정밀도 측정'), R(B[0], B[1], 3, '사내', '개발', '비전 트리거 타이밍 조정'), R(G[0], G[1], 1, '사내', '공통', '주간 회의')]],
      [1, true, [R(A[0], A[1], 6, '사내', '개발', '리니어 모터 튜닝 · 진동 측정'), R(B[0], B[1], 2, '사외', '지원', '고객사 현장 셋업 지원')]],
      [2, true, [R(B[0], B[1], 8, '사외', '지원', '현장 시운전 · 인터록 점검')]],
      [3, true, [R(A[0], A[1], 5, '사내', '개발', '제어 프로그램 검토 · 수정'), R(G[0], G[1], 3, '사내', '공통', '교육 자료 정리')]]
    ];
    for (var i = 0; i < days.length; i++) {
      await p.evaluate(function (d, sent, items) { return apiFetch('/api/gongsu/' + d + (sent ? '/sent' : ''), { method: sent ? 'POST' : 'PUT', body: JSON.stringify({ items: items, message: '' }) }); }, day(days[i][0]), days[i][1], days[i][2]);
    }
    // ① 어디에 — 내 업무 도구 막대의 📝 공수 단추
    await p.evaluate(function () { setPage('mywork'); });
    await p.waitForFunction(function () { return !!document.querySelector('#mMyWork .mw-add [data-awg-open]'); }, { timeout: 20000 });
    await new Promise(function (r) { setTimeout(r, 1200); });
    var box = await p.evaluate(function () {
      var bt = document.querySelector('#mMyWork .mw-add [data-awg-open]'), r = bt.getBoundingClientRect();
      var ring = document.createElement('div');
      ring.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;border:3px solid #EF4444;border-radius:12px;box-shadow:0 0 0 4px rgba(239,68,68,.22);left:' + (r.left - 7) + 'px;top:' + (r.top - 7) + 'px;width:' + (r.width + 8) + 'px;height:' + (r.height + 8) + 'px';
      document.body.appendChild(ring);
      var tag = document.createElement('div');
      tag.textContent = '여기 — 📝 공수';
      tag.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;background:#EF4444;color:#fff;font-size:13px;font-weight:700;padding:5px 11px;border-radius:8px;top:' + (r.bottom + 12) + 'px;left:' + Math.max(8, r.left - 40) + 'px';
      document.body.appendChild(tag);
      window.__ring = [ring, tag];
      return { top: r.top, bottom: r.bottom };
    });
    await p.screenshot({ path: path.join(OUT, 'gongsu-where.png'), clip: { x: 0, y: 0, width: 1400, height: Math.min(940, Math.round(box.bottom + 230)) } });
    await p.evaluate(function () { window.__ring.forEach(function (e) { e.remove(); }); });
    // ② 쓰는 화면
    await p.evaluate(function () { awgOpen(); });
    await p.waitForFunction(function () { return document.querySelectorAll('#awgBox .awg-r').length === 3 && !!document.querySelector('[data-awg="fill"]'); }, { timeout: 15000 });
    await new Promise(function (r) { setTimeout(r, 500); });
    await (await p.$('#awgModal .wa-modal-box')).screenshot({ path: path.join(OUT, 'gongsu-write.png') });
    // ③ 이력
    await p.click('#awgBox [data-awg="hist"]');
    await p.waitForFunction(function () { return document.querySelectorAll('#awgHList .awg-hday').length === 4; }, { timeout: 15000 });
    await p.evaluate(function () { var r = document.querySelectorAll('.awg-hrow input'); r[3].click(); r[4].click(); });
    await new Promise(function (r) { setTimeout(r, 400); });
    await (await p.$('#awgModal .wa-modal-box')).screenshot({ path: path.join(OUT, 'gongsu-history.png') });
    fs.readdirSync(OUT).forEach(function (f) { console.log(f, fs.statSync(path.join(OUT, f)).size); });
  } catch (e) { fail = 1; console.log('FAIL', e && e.stack); }
  finally { await b.close(); await c.query('DELETE FROM gongsu_days'); await c.end(); }
  console.log(fail ? 'FAIL 1' : 'ALL PASS (3)');
  process.exit(fail);
})();
