// 🧠 마인드맵 휴대폰 터치 (v13.308) — 누르면 고르기만(글자판 X) · 한 손가락 끌기 = 화면 이동(주제 위에서도) · 두 번 톡 = 고치기 X
//   · 길게 누르기 메뉴 X · 두 손가락 = 확대 · 마우스는 그대로(입력칸 초점 · 주제 끌기)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var cdp = await page.target().createCDPSession();
  function touch(type, pts) { return cdp.send('Input.dispatchTouchEvent', { type: type, touchPoints: pts.map(function (p, i) { return { x: p[0], y: p[1], id: i }; }) }); }
  async function tap(x, y) { await touch('touchStart', [[x, y]]); await wait(40); await touch('touchEnd', []); await wait(350); }
  function center(id) { return page.evaluate(function (id) { var r = document.querySelector('#mmStage .mm-node[data-id="' + id + '"]').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; }, id); }
  function st() { return page.evaluate(function () { var s = document.getElementById('mmSink'); return { sinkFocus: document.activeElement === s, panX: _mm.panX, panY: _mm.panY, zoom: _mm.zoom, sel: _mm.sel, editing: !!_mm.editing, ctx: !!document.querySelector('.mm-ctx, #mmCtxMenu') }; }); }
  try {
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    var mapId = await page.evaluate(function () {
      var doc = { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: { id: 'r', text: '터치 시험', children: [{ id: 'a', text: '주제 가', children: [] }, { id: 'b', text: '주제 나', children: [] }] } }] };
      return apiFetch('/api/mindmaps', { method: 'POST', body: JSON.stringify({ title: '터치 ' + Date.now(), scope: 'personal', doc: doc }) }).then(function (r) { return r.data.id; });
    });
    await page.evaluate(function () { setPage('mindmap'); });
    await wait(800);
    await page.evaluate(function (id) { mmOpen(id); }, mapId);
    await page.waitForSelector('#mmStage .mm-node[data-id="a"]', { timeout: 15000 });
    await page.evaluate(function () { _mmSetView('map'); if (typeof _mmFit === 'function') _mmFit(); });   // 휴대폰은 목록 보기로 시작 → 맵 보기로
    await page.waitForFunction(function () { var n = document.querySelector('#mmStage .mm-node[data-id="a"]'); return n && n.getBoundingClientRect().width > 0; }, { timeout: 15000 });
    await wait(600);
    await page.evaluate(function () { var s = document.getElementById('mmSink'); if (s) s.blur(); });

    // 1) 톡 → 고르기만, 입력칸 초점 없음
    var c = await center('a');
    await tap(c[0], c[1]);
    var s1 = await st();
    check(s1.sel === 'a' && !s1.sinkFocus && !s1.editing, '톡 → 고르기만 · 글자판(입력칸 초점) 없음 ' + JSON.stringify(s1));
    // 빈 곳 톡도
    await tap(30, 300);
    check(!(await st()).sinkFocus, '빈 곳 톡 — 입력칸 초점 없음');

    // 2) 주제 위에서 한 손가락 끌기 → 화면 이동, 주제 자리는 그대로
    var before = await st();
    var rootBefore = await page.evaluate(function () { return JSON.stringify(_mmRoot()); });
    c = await center('b');
    await touch('touchStart', [[c[0], c[1]]]);
    for (var i = 1; i <= 6; i++) { await touch('touchMove', [[c[0] + i * 12, c[1] + i * 15]]); await wait(16); }
    await touch('touchEnd', []); await wait(400);
    var after = await st();
    var rootAfter = await page.evaluate(function () { return JSON.stringify(_mmRoot()); });
    check(Math.abs(after.panX - before.panX - 72) <= 2 && Math.abs(after.panY - before.panY - 90) <= 2, '주제 위 끌기 → 화면 이동 ' + JSON.stringify([before.panX, after.panX, before.panY, after.panY]));
    check(rootAfter === rootBefore, '주제는 옮겨지지 않음');
    check(!after.sinkFocus, '끈 뒤에도 입력칸 초점 없음');

    // 3) 두 번 톡 → 고치기 안 함
    c = await center('a');
    await touch('touchStart', [[c[0], c[1]]]); await touch('touchEnd', []); await wait(80);
    await touch('touchStart', [[c[0], c[1]]]); await touch('touchEnd', []); await wait(500);
    var s3 = await page.evaluate(function () { return { editing: !!_mm.editing, inline: !!document.querySelector('#mmStage .mm-inline, #mmStage textarea'), n: _mmRoot().children.length + (_mmSheet().floating || []).length }; });
    check(!s3.editing && !s3.inline && s3.n === 2, '두 번 톡 → 고치기 · 주제 추가 없음 ' + JSON.stringify(s3));

    // 4) 길게 누르기 → 편집 메뉴 없음
    c = await center('b');
    await page.evaluate(function (x, y) { var el = document.elementFromPoint(x, y); _mmTouchT = Date.now(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })); }, c[0], c[1]);
    await wait(200);
    check(!(await st()).ctx, '길게 누르기 → 편집 메뉴 없음');

    // 5) 두 손가락 → 확대
    var z0 = (await st()).zoom;
    await touch('touchStart', [[150, 400], [250, 400]]);
    for (var k = 1; k <= 5; k++) { await touch('touchMove', [[150 - k * 15, 400], [250 + k * 15, 400]]); await wait(16); }
    await touch('touchEnd', []); await wait(300);
    var z1 = (await st()).zoom;
    check(z1 > z0 * 1.3, '두 손가락 벌리기 → 확대 ' + z0 + ' → ' + z1);

    // 6) 마우스는 그대로 — 누르면 입력칸 초점, 주제 끌기 됨
    await wait(1700);   // 터치 판정 시간이 지나도록
    await page.evaluate(function () { _mmFit(); }); await wait(300);   // 확대 뒤 화면 밖일 수 있어 다시 맞춤
    c = await center('a');
    await page.mouse.click(c[0], c[1]);
    await wait(200);
    check((await st()).sinkFocus, '마우스로 누르면 예전처럼 입력칸 초점 (키보드 단축키용)');

    await page.evaluate(function (id) { return apiFetch('/api/mindmaps/' + id, { method: 'DELETE' }).catch(function () {}); }, mapId);
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack);
  }
  await browser.close();
  console.log(fail ? ('FAILED ' + fail + ' / ' + (ok + fail)) : ('ALL PASS (' + ok + ')'));
  process.exit(fail ? 1 : 0);
})();
