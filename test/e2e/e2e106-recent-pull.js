// 🔄 최근 내려받기 v13.515 — 마지막 기록 뒤 것만 받아 묻지 않고 합치기 (가짜 PC 앱 다리) · 내 업무 타임라인 돌아오면 · 폭 바뀌면 오늘로
//   진짜 애니웍스에는 가지 않는다 — window.wmDesktop.aw 를 흉내 낸 다리가 window.__awSite 를 사업부별 「주간일지」 로 돌려준다
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  await c.query('DELETE FROM work_records');
  var ok = 0, fail = 0, errs = [], b;
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function fakeDesk() {
    window.__awCalls = []; window.__awSite = []; window.__awTeams = ['장비사업부', '모션사업부'];
    var eu = { '일자': [0xC0, 0xCF, 0xC0, 0xDA], '이름': [0xC0, 0xCC, 0xB8, 0xA7], '수주번호': [0xBC, 0xF6, 0xC1, 0xD6, 0xB9, 0xF8, 0xC8, 0xA3], '시간': [0xBD, 0xC3, 0xB0, 0xA3], '업무분장': [0xBE, 0xF7, 0xB9, 0xAB, 0xBA, 0xD0, 0xC0, 0xE5], '약자': [0xBE, 0xE0, 0xC0, 0xDA], '업무내용': [0xBE, 0xF7, 0xB9, 0xAB, 0xB3, 0xBB, 0xBF, 0xEB] };
    var xls = function (rows) {
      var h = '<table><tr><td>일자</td><td>이름</td><td>수주번호</td><td>시간</td><td>업무분장</td><td>약자</td><td>업무내용</td></tr>' +
        rows.map(function (r) { return '<tr><td>' + r.day.replace(/-/g, '') + '</td><td>' + r.name + '</td><td>' + r.orderno + '</td><td>' + r.hours + '</td><td>dev</td><td>' + (r.abbr || 'D') + '</td><td>' + r.memo + '</td></tr>'; }).join('') + '</table>';
      var bytes = [];
      for (var i = 0; i < h.length;) {
        var hit = null; for (var k in eu) if (h.substr(i, k.length) === k) { hit = k; break; }
        if (hit) { bytes = bytes.concat(eu[hit]); i += hit.length; } else { bytes.push(h.charCodeAt(i) & 0x7F); i++; }
      }
      return btoa(String.fromCharCode.apply(null, bytes));
    };
    window.wmDesktop = { isDesktop: true, platform: 'win32', aw: function (cmd, a) {
      window.__awCalls.push({ cmd: cmd, a: a || null });
      return new Promise(function (res) { setTimeout(function () {
        if (cmd === 'status') return res({ ok: true, v: 2, hasCred: true, id: 'tester', safe: true, maxRows: 15, memoMax: 50 });
        if (cmd === 'download') {
          var teams = (a.teams && a.teams.length ? a.teams : window.__awTeams), files = [], skipped = [];
          teams.forEach(function (t) {
            var rows = window.__awSite.filter(function (r) { return r.team === t && r.day >= a.start && r.day <= a.end; });
            if (!rows.length) skipped.push({ team: t, why: '내용 없음' }); else files.push({ team: t, name: 'week.xls', size: 1, base64: xls(rows) });
          });
          return res({ ok: true, files: files, skipped: skipped, teams: window.__awTeams.slice(), start: a.start, end: a.end });
        }
        res({ ok: false, error: '?' });
      }, 20); });
    } };
  }
  var iso = function (off) { var d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  var cnt = async function () { return (await c.query('SELECT COUNT(*)::int AS n FROM work_records')).rows[0].n; };
  try {
    b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-rp' + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(e.message); });
    p.on('dialog', function (d) { errs.push('기본 알림 창이 뜸: ' + d.message()); d.dismiss(); });
    await p.evaluateOnNewDocument(fakeDesk);
    await p.setViewport({ width: 1400, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.evaluate(function () { window.__wmDialogUi = true; setPage('team'); setMode('weekly'); });
    var pull = function () { return p.evaluate(function () { window.__awCalls = []; return awgRecentPull().then(function (r) { return { r: r || null, calls: window.__awCalls.filter(function (x) { return x.cmd === 'download'; }).map(function (x) { return x.a; }), modal: !!document.querySelector('#wrChoiceOverlay, .wa-modal-box'), n: aD.length, main: !document.getElementById('mainArea').classList.contains('hidden') }; }); }); };
    var site = function (rows) { return p.evaluate(function (rows) { window.__awSite = rows; }, rows); };

    /* ① 처음 — 기록이 없으면 최근 3개월 */
    var S = [
      { team: '장비사업부', day: iso(-3), name: 'kim', orderno: 'B26031', hours: 8, memo: 'wiring check' },
      { team: '장비사업부', day: iso(-2), name: 'kim', orderno: 'B26031', hours: 4, memo: 'io test' },
      { team: '장비사업부', day: iso(-2), name: 'kim', orderno: 'B26031', hours: 4, memo: 'motion tune' },
      { team: '모션사업부', day: iso(-2), name: 'lee', orderno: 'M26007', hours: 8, memo: 'servo setup' }
    ];
    await site(S);
    var a = await pull();
    check(a.calls.length === 1 && a.calls[0].start === iso(-92) && a.calls[0].end === iso(0), '처음 — 최근 3개월 한 번만 받음 ' + JSON.stringify(a.calls));
    check(a.r && a.r.added === 4 && a.r.updated === 0 && await cnt() === 4, '4건 추가 ' + JSON.stringify(a.r));
    check(!a.modal && a.n === 4 && a.main, '창을 띄우지 않고 화면 갱신 (4건)');
    var d = (await c.query("SELECT dept, COUNT(*)::int AS n FROM work_records GROUP BY dept ORDER BY dept")).rows;
    check(d.length === 2 && d[0].dept === '모션사업부' && d[0].n === 1 && d[1].dept === '장비사업부' && d[1].n === 3, '사업부가 함께 저장됨 ' + JSON.stringify(d));

    /* ② 다시 — 마지막 기록 7일 전부터 · 바뀐 것만 */
    var idBefore = (await c.query("SELECT id FROM work_records WHERE content = 'io test'")).rows[0].id;
    S[1].memo = 'io test done'; S[1].hours = 5;                                                   // 고침 (같은 날 · 같은 수주에 다른 행도 있음)
    S.push({ team: '모션사업부', day: iso(-1), name: 'lee', orderno: 'M26007', hours: 6, memo: 'gain tune' });   // 새 행
    await site(S);
    a = await pull();
    check(a.calls.length === 1 && a.calls[0].start === iso(-9), '마지막 기록(가장 뒤처진 사업부 ' + iso(-2) + ')의 7일 전부터 ' + JSON.stringify(a.calls));
    check(a.r && a.r.added === 1 && a.r.updated === 1 && a.r.same === 3 && await cnt() === 5, '추가 1 · 수정 1 · 그대로 3 ' + JSON.stringify(a.r));
    var ed = (await c.query("SELECT id, hours::float AS h FROM work_records WHERE content = 'io test done'")).rows[0];
    check(ed && ed.id === idBefore && ed.h === 5 && (await c.query("SELECT 1 FROM work_records WHERE content = 'motion tune'")).rowCount === 1, '고친 행은 번호 그대로 고쳐짐 · 옆 행은 그대로');

    /* ③ 한 번 더 — 바뀐 것 없음 */
    a = await pull();
    check(a.r && a.r.added === 0 && a.r.updated === 0 && await cnt() === 5 && !a.modal, '다시 받아도 그대로 (겹쳐 쌓이지 않음) ' + JSON.stringify(a.r));
    check(await p.evaluate(function () { return /이미 최신/.test(document.body.textContent); }), '「이미 최신」 알림');

    /* ④ 애니웍스에서 지워진 행 — 지우지 않고 알림만 */
    S.splice(0, 1);
    await site(S);
    a = await pull();
    check(a.r && a.r.missing === 1 && await cnt() === 5, '애니웍스에 없는 기록 1건 — 지우지 않음 ' + JSON.stringify(a.r));

    /* ⑤ 처음 받는 사업부 — 그 사업부만 최근 3개월을 한 번 더 */
    await p.evaluate(function () { window.__awTeams.push('기술연구소'); });
    S.push({ team: '기술연구소', day: iso(-60), name: 'park', orderno: 'R26001', hours: 8, memo: 'old research' });
    await site(S);
    a = await pull();
    check(a.calls.length === 2 && a.calls[1].start === iso(-92) && a.calls[1].teams.join() === '기술연구소' && a.r.added === 1 && await cnt() === 6, '새 사업부만 3개월 더 받음 ' + JSON.stringify(a.calls[1]));
    a = await pull();
    check(a.calls.length === 1 && await cnt() === 6, '그다음부터는 한 번만');

    /* ⑥ 단추 */
    var ui = await p.evaluate(function () {
      var bt = document.getElementById('awRecentBtn'), bar = document.querySelector('#mWeekly .wm-tb');
      return { t: bt.textContent.trim(), vis: !!bt.offsetParent, out: Array.from(bar.querySelectorAll(':scope > button, :scope > .hdr-pop > button')).filter(function (x) { return x.offsetParent; }).length, mi: !!document.querySelector('#wrToolsWrap .hdr-mi[onclick*="openAnyworksModal"]') };
    });
    check(/최근 받기/.test(ui.t) && ui.vis && ui.out === 4 && ui.mi, '툴바 「🔄 최근 받기」 · 밖 단추 4개 그대로 · ⋯ 에 기간 골라 받기 ' + JSON.stringify(ui));
    await p.evaluate(function () { window.__awCalls = []; document.getElementById('awRecentBtn').click(); });
    check(await p.waitForFunction(function () { return window.__awCalls.some(function (x) { return x.cmd === 'download'; }) && !document.getElementById('wmProgOverlay'); }, { timeout: 8000 }).then(function () { return true; }, function () { return false; }) && !(await p.$('#awgPullModal')), '단추 한 번 → 바로 내려받기 (기간 창 없이)');

    /* ⑦ 파일 여러 개 — 하나씩 차례로 (hFile 이 다 넣을 때까지 기다림) */
    var seq = await p.evaluate(async function () {
      var log = [], o = ldBuf; ldBuf = async function () { log.push('s'); await new Promise(function (r) { setTimeout(r, 120); }); log.push('e'); };
      try { await hFiles([new File(['a'], '장비사업부1.xls'), new File(['b'], '모션사업부1.xls')]); } finally { ldBuf = o; }
      return log.join('');
    });
    check(seq === 'sese', '여러 파일은 겹치지 않고 차례로 ' + seq);

    /* ⑧ 내 업무 타임라인 — 다른 화면에 다녀오면 · 창 폭이 바뀌면 오늘로 */
    await p.evaluate(function () { setPage('mywork'); });
    await p.waitForFunction(function () { return typeof _mtlMain !== 'undefined' && _mtlMain && _mtlMain.el && _mtlMain.el.isConnected && _mtlMain.sc.clientWidth > 0; }, { timeout: 20000 });
    await wait(1200);
    var seen = function () { return p.evaluate(function () { var t = _mtlMain, x = t.X(_mtlNum(mwToday())) - t.sc.scrollLeft; return { vis: x >= t.L - 1 && x < t.sc.clientWidth, pick: t.pick === mwToday() }; }); };
    var away = async function () { await p.evaluate(function () { var t = _mtlMain; t.sc.scrollLeft += 4000; t.setPick(_mtlYmd(_mtlNum(mwToday()) + 40)); }); await wait(500); };
    await away();
    check(!(await seen()).vis, '(준비) 멀리 밀어 오늘이 안 보임');
    await p.evaluate(function () { _mwPaint(); }); await wait(300);
    check(!(await seen()).vis, '같은 화면에서 다시 그릴 때는 보던 자리 그대로');
    await p.evaluate(function () { setPage('team'); }); await wait(300);
    await p.evaluate(function () { setPage('mywork'); }); await wait(1500);
    var s1 = await seen();
    check(s1.vis && s1.pick, '다른 화면에 다녀오면 오늘로 · 오늘을 고름 ' + JSON.stringify(s1));
    await away();
    await p.setViewport({ width: 1400, height: 700 }); await wait(700);
    check(!(await seen()).vis, '높이만 바뀌면 그대로');
    await p.setViewport({ width: 1100, height: 700 }); await wait(900);
    var s2 = await seen();
    check(s2.vis && s2.pick, '창 폭이 바뀌면 오늘로 ' + JSON.stringify(s2));

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (b) await b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
