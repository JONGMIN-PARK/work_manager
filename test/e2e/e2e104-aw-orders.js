// 🔄 애니웍스 수주 가져오기 · 📚 공수 이력 v13.513 (가짜 PC 앱 다리 — 진짜 애니웍스에는 가지 않는다)
//   수주: 훑기 → 새 수주 / 내용 다른 수주 견주기 → 고른 것만 반영(날짜 · 금액은 그대로) → 넘긴 것은 다시 안 물음
//   이력: 날짜별 목록 · 검색 · 행 골라 다른 날짜에 복사 · 열기
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  await c.query('DELETE FROM gongsu_days');
  await c.query("DELETE FROM orders WHERE order_no LIKE 'ZQ%'");
  require('fs').mkdirSync(SHOT, { recursive: true });
  var ok = 0, fail = 0, errs = [], B = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function fakeDesk() {
    window.__awCalls = []; window.__awCred = true;
    window.__awRows = [
      { orderno: 'ZQ001', client: 'ACME', name: 'Same Project' },          // 대장과 같음
      { orderno: 'ZQ002', client: 'ACME', name: 'Renamed In Anyworks' },   // 이름이 다름 (덮어씀 → 물어봄)
      { orderno: 'ZQ003', client: 'Beta', name: 'Fill Blank' },            // 대장은 빈 칸 (채움)
      { orderno: 'ZQ010', client: 'Gamma', name: 'Brand New A' },
      { orderno: 'ZQ011', client: '', name: 'Brand New B' },
      { orderno: 'ZQ010', client: 'Dup', name: 'Dup Line' }                // 애니웍스에 같은 번호 두 줄
    ];
    window.wmDesktop = { isDesktop: true, platform: 'win32', aw: function (cmd) {
      window.__awCalls.push(cmd);
      return new Promise(function (res) { setTimeout(function () {
        if (cmd === 'status') return res({ ok: true, v: 2, hasCred: window.__awCred, id: 'tester', safe: true, maxRows: 15, memoMax: 50 });
        if (cmd === 'scan') return res(window.__awOld ? { ok: false, code: 'BAD', error: '모르는 명령입니다' } : { ok: true, rows: window.__awRows });
        res({ ok: false, error: '?' });
      }, 30); });
    } };
  }
  async function open(email, desk) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    B.push(b);
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { errs.push('기본 알림 창이 뜸: ' + d.message()); d.dismiss(); });
    if (desk) await p.evaluateOnNewDocument(fakeDesk);
    await p.setViewport({ width: 1400, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.evaluate(function () { window.__wmDialogUi = true; });
    return p;
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var api = function (p, url, method, body) { return p.evaluate(function (u, m, b) { return apiFetch(u, { method: m, body: b ? JSON.stringify(b) : undefined }); }, url, method || 'GET', body); };
  try {
    var p = await open('admin@t.com', true);

    /* ── 🔄 수주 가져오기 ── */
    await api(p, '/api/orders/bulk', 'POST', { records: [
      { orderNo: 'ZQ001', name: 'Same Project', client: 'ACME', date: '2026-01-05', amount: 100 },
      { orderNo: 'ZQ002', name: 'My Own Name', client: 'ACME', date: '2026-02-06', amount: 2500, manager: 'Kim' },
      { orderNo: 'ZQ003', name: '', client: '', date: '2026-03-07', amount: 300 }
    ] });
    check(await p.evaluate(function () { return typeof awoCan === 'function' && awoCan(); }), '관리자 + PC 앱 → 수주 가져오기 쓸 수 있음');
    var cmp = await p.evaluate(function () { return awoScan({ auto: true }).then(function (c) { return c && { total: c.total, same: c.same, add: c.add.map(function (x) { return x.no; }), diff: c.diff.map(function (x) { return x.no + (x.fill ? ':fill' : ':over') + (x.on ? ':on' : ''); }) }; }); });
    check(cmp && cmp.total === 5 && cmp.same === 1 && cmp.add.join() === 'ZQ010,ZQ011' && cmp.diff.join() === 'ZQ002:over,ZQ003:fill:on', '견주기 — 같음 1 · 새 수주 2 · 다름 2 (덮어쓰는 것은 기본 해제) ' + JSON.stringify(cmp));
    check(await until(p, function () { return !!document.querySelector('#awoBox .awo-r'); }), '새 것이 있으면 창이 뜸');
    var first = await p.evaluate(function () { return { rows: document.querySelectorAll('#awoBox .awo-r').length, on: document.querySelectorAll('#awoBox .awo-r input:checked').length, tab: document.querySelector('.awo-tab.on').textContent, dupLine: /Dup Line/.test(document.getElementById('awoBox').textContent) }; });
    check(first.rows === 2 && first.on === 2 && /새 수주/.test(first.tab) && !first.dupLine, '새 수주 2건 — 모두 선택돼 있음 ' + JSON.stringify(first));
    // ZQ011 은 빼고 (다시 묻지 않을 것)
    await p.evaluate(function () { var c = document.querySelector('#awoBox input[data-no="ZQ011"]'); c.click(); });
    await p.click('#awoBox [data-awo-tab="diff"]');
    var diff = await p.evaluate(function () { return [].map.call(document.querySelectorAll('#awoBox .awo-r'), function (r) { return r.querySelector('b').textContent + '|' + r.querySelector('input').checked + '|' + r.querySelector('.awo-tag').textContent; }); });
    check(diff.join() === 'ZQ002|false|덮어씀,ZQ003|true|빈 칸 채움', '내용 다른 수주 — 덮어씀은 해제 · 빈 칸 채움은 선택 ' + diff.join());
    check(await p.evaluate(function () { var t = document.querySelector('#awoBox .awo-r').textContent; return /My Own Name/.test(t) && /Renamed In Anyworks/.test(t); }), '지금 값 → 애니웍스 값을 나란히 보여 줌');
    await p.screenshot({ path: path.join(SHOT, 'e2e104-orders.png') });
    await p.click('#awoGo');
    check(await until(p, function () { return !document.getElementById('awoModal'); }), '적용 → 창 닫힘');
    var db1 = (await c.query("SELECT order_no, name, client, date, amount::int AS amount, manager FROM orders WHERE order_no LIKE 'ZQ%' ORDER BY order_no")).rows;
    var by = {}; db1.forEach(function (r) { by[r.order_no] = r; });
    check(db1.length === 4 && by.ZQ010 && by.ZQ010.name === 'Brand New A' && by.ZQ010.client === 'Gamma' && !by.ZQ011, '고른 새 수주만 들어감 (첫 줄 기준 · 뺀 것은 안 들어감) ' + db1.map(function (r) { return r.order_no; }).join());
    check(by.ZQ003.name === 'Fill Blank' && by.ZQ003.client === 'Beta' && by.ZQ003.date === '2026-03-07' && by.ZQ003.amount === 300, '빈 칸 채움 — 수주일 · 금액은 그대로');
    check(by.ZQ002.name === 'My Own Name' && by.ZQ002.manager === 'Kim', '고르지 않은 것은 그대로');
    check(await p.evaluate(function () { return typeof ORDER_MAP !== 'undefined' && ORDER_MAP.ZQ010 && ORDER_MAP.ZQ010.name === 'Brand New A'; }), '화면의 수주 목록에도 바로 반영');
    // 다시 훑으면 — 넘긴 것(ZQ002 · ZQ011)은 조용히
    var again = await p.evaluate(function () { return awoScan({ auto: true }).then(function (c) { return c && { add: c.add.length, diff: c.diff.length, open: !!document.getElementById('awoModal') }; }); });
    check(again && again.add === 1 && again.diff === 1 && !again.open, '자동 확인 — 넘긴 것은 다시 묻지 않음 ' + JSON.stringify(again));
    // 애니웍스 쪽 이름이 바뀌면 다시 물음
    await p.evaluate(function () { window.__awRows[4].name = 'Brand New B2'; });
    await p.evaluate(function () { return awoScan({ auto: true }); });
    check(await until(p, function () { var r = document.querySelectorAll('#awoBox .awo-r'); return r.length === 1 && /Brand New B2/.test(r[0].textContent); }), '애니웍스 내용이 바뀐 것만 다시 물음');
    await p.click('#awoBox [data-awo="later"]');
    await until(p, function () { return !document.getElementById('awoModal'); });
    // 직접 누르면 넘긴 것까지 전부 · 덮어쓰기는 한 번 더 확인
    await p.evaluate(function () { setPage('project'); setMode('orders'); });
    var hasMenu = await until(p, function () { return [].some.call(document.querySelectorAll('#orderMoreWrap .hdr-mi'), function (b) { return /애니웍스에서 가져오기/.test(b.textContent); }); }, null, 15000);
    check(hasMenu, '수주 대장 ⋯ 메뉴에 「애니웍스에서 가져오기」');
    await p.evaluate(function () { awoScan(); });
    check(await until(p, function () { return document.querySelectorAll('#awoBox .awo-r').length === 1 && /내용이 다른/.test(document.querySelectorAll('.awo-tab')[1].textContent); }), '직접 열면 넘긴 것도 보임');
    await p.click('#awoBox [data-awo-tab="diff"]');
    await p.evaluate(function () { document.querySelector('#awoBox input[data-no="ZQ002"]').click(); });
    await p.click('#awoGo');
    check(await until(p, function () { return !!document.querySelector('.wmd .wmd-btn.ok'); }), '덮어쓰기는 한 번 더 확인');
    await p.click('.wmd .wmd-btn.ok');
    await until(p, function () { return !document.getElementById('awoModal'); });
    var z2 = (await c.query("SELECT name, date, amount::int AS amount, manager, version FROM orders WHERE order_no = 'ZQ002'")).rows[0];
    check(z2.name === 'Renamed In Anyworks' && z2.date === '2026-02-06' && z2.amount === 2500 && z2.manager === 'Kim' && z2.version >= 2, '덮어쓰기 — 이름만 바뀌고 수주일 · 금액 · 담당은 그대로 ' + JSON.stringify(z2));
    // 예전 PC 앱(scan 없음) → 조용히
    await p.evaluate(function () { window.__awOld = true; });
    check((await p.evaluate(function () { return awoScan({ auto: true }); })) === null && !(await p.$('#awoModal')), '예전 PC 앱이면 자동 확인은 조용히 넘어감');
    // 권한 없는 사람
    var forb = await p.evaluate(function () { return fetch('/api/orders/aw-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(function (r) { return r.status; }); });
    check(forb === 401 || forb === 403, '로그인 정보 없이 부르면 거절 ' + forb);

    /* ── 📚 공수 이력 ── */
    var iso = function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
    var T = new Date(), D1 = iso(new Date(T.getFullYear(), T.getMonth(), T.getDate() - 3)), D2 = iso(new Date(T.getFullYear(), T.getMonth(), T.getDate() - 10)), TO = iso(new Date(T.getFullYear(), T.getMonth(), T.getDate() + 1));
    await api(p, '/api/gongsu/' + D1, 'PUT', { items: [{ orderno: 'ZQ010', prodspec: 'Brand New A', hours: 5, divi: '사내', job: '개발', memo: 'alpha work' }, { orderno: 'ZQ001', prodspec: 'Same Project', hours: 3, divi: '사외', job: '지원', memo: 'beta visit' }] });
    await api(p, '/api/gongsu/' + D2 + '/sent', 'POST', { items: [{ orderno: 'ZQ010', prodspec: 'Brand New A', hours: 8, divi: '사내', job: '개발', memo: 'gamma build' }], message: 'ok' });
    await p.evaluate(function () { setPage('mywork'); });
    await until(p, function () { return !!document.querySelector('#mMyWork [data-awg-open]'); }, null, 15000);
    await p.evaluate(function () { awgOpen(); });
    check(await until(p, function () { return !!document.querySelector('#awgBox [data-awg="hist"]'); }), '공수 등록 창에 📚 이력 단추');
    await p.click('#awgBox [data-awg="hist"]');
    check(await until(p, function () { return document.querySelectorAll('#awgHList .awg-hday').length === 2; }), '이력 — 날짜 2개');
    var hv = await p.evaluate(function () { return { tot: document.getElementById('awgHTot').textContent, chips: [].map.call(document.querySelectorAll('.awg-hchip'), function (b) { return b.textContent.trim(); }), st: [].map.call(document.querySelectorAll('.awg-hday'), function (d) { return d.querySelector('.awg-st').textContent; }), put: document.getElementById('awgHPut').disabled, fit: document.getElementById('awgBox').scrollWidth <= document.getElementById('awgBox').clientWidth + 1 }; });
    check(/2일 · 3행 · 16h/.test(hv.tot) && hv.chips[0] === 'ZQ010 13h' && hv.chips[1] === 'ZQ001 3h', '합계 · 수주별 시간 ' + hv.tot + ' / ' + hv.chips.join(','));
    check(/작성 중/.test(hv.st[0]) && /등록함/.test(hv.st[1]) && hv.put && hv.fit, '날짜별 상태 · 고르기 전에는 복사 단추 꺼짐 ' + hv.st.join(','));
    await p.evaluate(function () { var q = document.getElementById('awgHQ'); q.value = 'beta'; q.dispatchEvent(new Event('input', { bubbles: true })); });
    check(await p.evaluate(function () { return document.querySelectorAll('.awg-hrow').length === 1 && /beta visit/.test(document.querySelector('.awg-hrow').textContent); }), '검색 — 내용으로 좁히기');
    await p.evaluate(function () { var q = document.getElementById('awgHQ'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); });
    // 행 2개(서로 다른 날짜) 골라 내일로 복사
    await p.evaluate(function (to) {
      var rows = document.querySelectorAll('.awg-hrow input');
      rows[0].click(); rows[2].click();
      var t = document.getElementById('awgHTo'); t.value = to; t.dispatchEvent(new Event('change', { bubbles: true }));
    }, TO);
    check(await p.evaluate(function () { return /선택 2행 · 13h/.test(document.getElementById('awgHSel').textContent) && !document.getElementById('awgHPut').disabled; }), '고른 행 수 · 시간 표시');
    await p.screenshot({ path: path.join(SHOT, 'e2e104-hist.png') });
    await p.click('#awgHPut');
    check(await until(p, function (to) { return _awg && _awg.view === 'edit' && _awg.day === to && document.querySelectorAll('#awgBox .awg-r').length === 2; }, TO), '「그 날짜에 복사해서 쓰기」 → 작성 화면에 2행');
    var put = await p.evaluate(function () { return _awg.items.map(function (it) { return it.orderno + ':' + it.hours + ':' + it.memo; }).join(); });
    check(put === 'ZQ010:8:gamma build,ZQ010:5:alpha work', '옛 날짜부터 순서대로 들어감 ' + put);
    await p.evaluate(function () { var el = document.querySelector('.awg-r[data-i="0"] [data-f="memo"]'); el.value = 'gamma build v2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    check(await until(p, function () { return /저장됨/.test((document.getElementById('awgSaved') || {}).textContent || ''); }, null, 6000), '고친 내용 자동 저장');
    var saved = (await c.query("SELECT items FROM gongsu_days WHERE day = $1", [TO])).rows[0];
    check(saved && saved.items.length === 2 && saved.items[0].memo === 'gamma build v2', '복사한 날짜로 서버에 저장');
    var src = (await c.query("SELECT status, items FROM gongsu_days WHERE day = $1", [D2])).rows[0];
    check(src.status === 'sent' && src.items[0].memo === 'gamma build', '원래 날짜는 그대로');
    // 이력 → 열기
    await p.click('#awgBox [data-awg="hist"]');
    await until(p, function () { return document.querySelectorAll('#awgHList .awg-hday').length === 3; });
    await p.evaluate(function (d) { document.querySelector('.awg-hday[data-day="' + d + '"] [data-awg="h-open"]').click(); }, D2);
    check(await until(p, function (d) { return _awg.view === 'edit' && _awg.day === d && /등록함/.test(document.getElementById('awgState').textContent); }, D2), '이력 → 열기 → 그 날짜 작성 화면 (등록 상태 그대로)');
    // 이미 쓴 날짜에 복사 → 바꿀지 · 붙일지 묻는다
    await p.click('#awgBox [data-awg="hist"]');
    await until(p, function () { return document.querySelectorAll('#awgHList .awg-hday').length === 3; });
    await p.evaluate(function (d1, to) {
      var t = document.getElementById('awgHTo'); t.value = to; t.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('.awg-hday[data-day="' + d1 + '"] [data-awg="h-dup"]').click();
    }, D1, TO);
    check(await until(p, function () { return !!document.querySelector('.wmd .wmd-btn.ok'); }), '이미 쓴 날짜에 복사 → 바꿀지 묻는다');
    await p.evaluate(function () { var b = document.querySelectorAll('.wmd .wmd-btn'); [].filter.call(b, function (x) { return !x.classList.contains('ok'); })[0].click(); });   // 뒤에 붙이기
    check(await until(p, function () { return _awg.view === 'edit' && document.querySelectorAll('#awgBox .awg-r').length === 4; }), '「뒤에 붙이기」 → 4행');
    // 내 업무 ⋯ 메뉴에서 바로 이력
    await p.evaluate(function () { return _awgFlush().then(function () { document.querySelector('#awgModal [data-wm-close]').click(); }); });
    await until(p, function () { return !document.getElementById('awgModal'); });
    check(await p.evaluate(function () { return !!document.querySelector('#mMyWork [data-awg-open="hist"]'); }), '내 업무 ⋯ 메뉴에 📚 공수 이력');
    await p.evaluate(function () { document.querySelector('#mMyWork [data-awg-open="hist"]').click(); });
    check(await until(p, function () { return _awg && _awg.view === 'hist' && document.querySelectorAll('#awgHList .awg-hday').length === 3; }), '메뉴 → 이력 화면으로 바로');

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { for (var i = 0; i < B.length; i++) await B[i].close(); await c.query("DELETE FROM orders WHERE order_no LIKE 'ZQ%'"); await c.query('DELETE FROM gongsu_days'); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
