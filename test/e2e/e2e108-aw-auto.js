// 🔄 애니웍스 자동 갱신 v13.521 — 주기마다 조용히 업무일지 · 수주 맞추기 · 이력 · 관리자 주기 설정 (가짜 PC 앱 다리)
//   + 🔔 알림 센터 항목을 누르면 그 화면으로
//   진짜 애니웍스에는 가지 않는다 — window.wmDesktop.aw 가 window.__awSite(주간일지) · window.__awOrders(수주 조회)로 답한다.
//   자동 시험 브라우저에서는 타이머가 저절로 돌지 않으므로 awaRun() / _awaTick() 을 직접 부른다.
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  await c.query('DELETE FROM work_records');
  await c.query("DELETE FROM orders WHERE order_no LIKE 'ZA%'");
  await c.query('DELETE FROM tenant_settings');
  var ok = 0, fail = 0, errs = [], b;
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function fakeDesk() {
    window.__awCalls = []; window.__awSite = []; window.__awOrders = []; window.__awFilled = null; window.__awTeams = ['장비사업부', '모션사업부'];
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
        if (cmd === 'status') return res({ ok: true, v: 3, hasCred: true, id: 'tester', safe: true, running: '', filled: window.__awFilled, maxRows: 15, memoMax: 50 });
        if (cmd === 'scan') return res({ ok: true, rows: window.__awOrders.slice() });
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
  var ords = async function () { return (await c.query("SELECT order_no, name, client FROM orders WHERE order_no LIKE 'ZA%' ORDER BY order_no")).rows; };
  try {
    b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-aa' + Date.now()) });
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
    await p.evaluate(function () { window.__wmDialogUi = true; ['wm_awa_log', 'wm_awa_off', 'wm_awa_new', 'wm_awa_last', 'wm_awa_ask', 'wm_awg_sig', 'wm_awg_first', 'wm_awo_skip'].forEach(function (k) { localStorage.removeItem(k); }); setPage('mywork'); });
    await wait(500);
    var run = function (opt) { return p.evaluate(function (opt) { window.__awCalls = []; return awaRun(opt).then(function (r) { return { r: r, dl: window.__awCalls.filter(function (x) { return x.cmd === 'download'; }).length, sc: window.__awCalls.filter(function (x) { return x.cmd === 'scan'; }).length, log: awaLog(), dot: !document.getElementById('awaDot').hidden, page: curPage, modal: !!document.querySelector('.wa-modal-overlay, #wmProgOverlay') }; }); }, opt || null); };
    var set = function (site, orders) { return p.evaluate(function (s, o) { window.__awSite = s; window.__awOrders = o; }, site, orders); };

    /* ⓪ 단추 — 저절로 돌지 않음(시험 브라우저) · 켜면 보임 */
    var u0 = await p.evaluate(function () { _awaPaintBtn(); var w = document.getElementById('hdrAwaWrap'); return { can: awaCan(), vis: !w.hidden && !!w.offsetParent, dl: window.__awCalls.filter(function (x) { return x.cmd === 'download' || x.cmd === 'scan'; }).length, dot: !document.getElementById('awaDot').hidden }; });
    check(u0.can && u0.vis && !u0.dl && !u0.dot, '머리 줄 🔄 단추가 보임 · 아직 받지 않음 · 점 없음 ' + JSON.stringify(u0));

    /* ① 첫 회차 — 업무일지 2건 + 새 수주 2건, 창 없이 */
    var S = [
      { team: '장비사업부', day: iso(-2), name: 'kim', orderno: 'ZA001', hours: 8, memo: 'wiring check' },
      { team: '모션사업부', day: iso(-1), name: 'lee', orderno: 'ZA002', hours: 8, memo: 'servo setup' }
    ];
    var O = [{ orderno: 'ZA001', client: 'ACME', name: 'UV LASER 1' }, { orderno: 'ZA002', client: '', name: 'MOTION STAGE' }];
    await set(S, O);
    var a = await run();
    check(a.r.wl && a.r.wl.changed === 2 && await cnt() === 2, '업무일지 2건이 들어옴 ' + JSON.stringify(a.r.wl));
    var od = await ords();
    check(a.r.od && a.r.od.added === 2 && od.length === 2 && od[0].name === 'UV LASER 1', '새 수주 2건이 대장에 들어옴 ' + JSON.stringify(a.r.od));
    check(!a.modal && a.page === 'mywork', '창을 띄우지 않고 보던 화면 그대로');
    check(a.log.length === 1 && a.log[0].lines.length === 2 && /업무일지 \+2/.test(a.log[0].lines[0].text) && /수주 새로 2건/.test(a.log[0].lines[1].text) && a.dot, '이력 한 줄(업무일지 · 수주) + 🔄 에 점 ' + JSON.stringify(a.log[0]));
    var toast = await p.evaluate(function () { var t = document.querySelector('.wa-toast.awa-toast'); return t ? t.textContent : ''; });
    check(/새 내용이 갱신되었습니다/.test(toast) && /업무일지 \+2/.test(toast), '「새 내용이 갱신되었습니다」 알림 — ' + toast);
    await p.evaluate(function () { document.querySelector('.wa-toast.awa-toast').click(); });
    await wait(300);
    check(await p.evaluate(function () { return curPage === 'team' && curMode === 'weekly' && !document.querySelector('.wa-toast.awa-toast'); }), '알림을 누르면 업무 관리 › 주간 분석으로');
    await p.evaluate(function () { setPage('mywork'); });

    /* ② 다시 — 바뀐 것 없음: 이력 안 쌓임 · 서버 기록을 다시 읽지 않음 */
    var hits = function () { return p.evaluate(function () { return performance.getEntriesByType('resource').filter(function (e) { return /\/api\/archives\/records\?/.test(e.name); }).length; }); };
    var h0 = await hits();
    a = await run();
    check(a.r.news === 0 && a.r.wl.quick && a.dl === 1 && a.sc === 1 && a.log.length === 1 && await cnt() === 2, '변동 없음 — 이력 그대로 ' + JSON.stringify(a.r.wl));
    check(await hits() === h0, '내려받은 것이 지난번과 같으면 서버 기록 5만 건을 다시 읽지 않음');
    check(!(await p.evaluate(function () { return document.querySelector('.wa-toast'); })) || !(await p.evaluate(function () { return /새 내용/.test((document.querySelector('.wa-toast:last-child') || {}).textContent || ''); })), '변동이 없으면 알리지 않음');
    var last = await p.evaluate(function () { return JSON.parse(localStorage.getItem('wm_awa_last')); });
    check(last && last.at > Date.now() - 20000 && last.note === '변동 없음' && !last.err, '마지막 확인 시각 · 「변동 없음」 ' + JSON.stringify(last));

    /* ③ 애니웍스에 새 일지 · 고친 일지 */
    S[0].hours = 6; S.push({ team: '모션사업부', day: iso(0), name: 'lee', orderno: 'ZA002', hours: 4, memo: 'gain tune' });
    await set(S, O);
    a = await run();
    check(a.r.wl.added === 1 && a.r.wl.updated === 1 && await cnt() === 3 && a.log.length === 2 && /업무일지 \+1 · 수정 1/.test(a.log[0].lines[0].text), '새 1 · 수정 1 → 이력 두 번째 줄 ' + JSON.stringify(a.log[0]));

    /* ④ 수주 — 빈 칸은 채우고, 적힌 값을 덮어써야 하는 것은 넣지 않고 알림만 */
    O[0].name = 'UV LASER 1 (rev)'; O[1].client = 'DAEDUCK'; O.push({ orderno: 'ZA003', client: 'ACME', name: 'NEW ONE' });
    await set(S, O);
    a = await run();
    od = await ords();
    check(a.r.od.added === 1 && a.r.od.filled === 1 && a.r.od.ask === 1, '새 1 · 빈 칸 채움 1 · 확인 필요 1 ' + JSON.stringify(a.r.od));
    check(od.length === 3 && od[0].name === 'UV LASER 1' && od[1].client === 'DAEDUCK' && od[2].name === 'NEW ONE', '적힌 프로젝트명은 덮어쓰지 않음 ' + JSON.stringify(od));
    check(a.log[0].lines.some(function (l) { return l.ask && /1건은 대장과 내용이 달라/.test(l.text); }), '이력에 「내용이 달라 넣지 않음」');
    check(!(await p.evaluate(function () { return Array.from(document.querySelectorAll('.wa-toast')).some(function (t) { return /넣지 않았습니다/.test(t.textContent); }); })), '확인 필요 건은 알림에 섞이지 않음 (이력에만)');
    var n3 = a.log.length;
    a = await run();
    check(a.log.length === n3, '같은 확인 필요 건은 회차마다 다시 쌓이지 않음');

    /* ⑤ 공수 등록 중(PC 앱이 입력해 둔 상태) · 애니웍스 창을 쓰는 중이면 건너뜀 */
    await p.evaluate(function () { window.__awFilled = { date: '2026-11-18', count: 2 }; });
    a = await run();
    check(a.r.skip === 'engine' && !a.dl && !a.sc, '공수를 입력해 둔 상태면 건드리지 않음');
    await p.evaluate(function () { window.__awFilled = null; var d = document.createElement('div'); d.className = 'awg'; d.id = 'zzAwg'; document.body.appendChild(d); });
    a = await run();
    check(a.r.skip === 'modal' && !a.dl, '애니웍스 창이 떠 있으면 그 회차는 건너뜀');
    a = await run({ manual: true });
    check(!a.r.skip && a.dl === 1, '「지금 갱신」 은 돌아감');
    await p.evaluate(function () { document.getElementById('zzAwg').remove(); });

    /* ⑥ 펼침 — 상태 · 이력 · 관리자 주기 */
    await p.evaluate(function () { awaToggle(); }); await wait(500);
    var m = await p.evaluate(function () {
      var w = document.getElementById('hdrAwaWrap'), r = document.getElementById('awaMenu').getBoundingClientRect();
      return { open: w.classList.contains('open'), st: document.querySelector('.awa-st').textContent, li: document.querySelectorAll('.awa-li').length, adm: !!document.getElementById('awaMin'), min: (document.getElementById('awaMin') || {}).value, dot: !document.getElementById('awaDot').hidden, inView: r.left >= 0 && r.right <= innerWidth && r.width > 200 };
    });
    check(m.open && /켜짐/.test(m.st) && /5분마다/.test(m.st) && /마지막 확인/.test(m.st) && m.li === n3 && m.inView, '펼침: 켜짐 · 5분마다 · 마지막 확인 · 이력 ' + JSON.stringify(m));
    await p.screenshot({ path: path.join(__dirname, '.shots', 'aw-auto-menu.png'), clip: { x: 780, y: 0, width: 620, height: 560 } }).catch(function () {});
    check(!m.dot, '열어 보면 점이 사라짐');
    check(m.adm && m.min === '5', '관리자에게 주기 설정이 보임 (기본 5분)');
    await p.evaluate(function () { var i = document.getElementById('awaMin'); i.value = '0'; document.querySelector('[data-awa="save"]').click(); }); await wait(300);
    check((await c.query('SELECT COUNT(*)::int AS n FROM tenant_settings')).rows[0].n === 0, '0분은 저장하지 않음');
    await p.evaluate(function () { var i = document.getElementById('awaMin'); i.value = '10'; document.querySelector('[data-awa="save"]').click(); });
    await p.waitForFunction(function () { return /10분마다/.test((document.querySelector('.awa-st') || {}).textContent || ''); }, { timeout: 8000 }).catch(function () {});
    var ts = (await c.query("SELECT value FROM tenant_settings WHERE key = 'aw_auto'")).rows[0];
    check(ts && ts.value.min === 10 && ts.value.on === true && /10분마다/.test(await p.evaluate(function () { return document.querySelector('.awa-st').textContent; })), '주기 10분 저장 → 서버 · 화면 ' + JSON.stringify(ts && ts.value));
    await p.evaluate(function () { document.querySelector('.awa-li p.awa-go[data-go="od"]').click(); }); await wait(400);
    var go = await p.evaluate(function () { return { page: curPage, mode: curMode, open: document.getElementById('hdrAwaWrap').classList.contains('open'), kw: typeof orderSearchKw !== 'undefined' ? orderSearchKw : null }; });
    check(go.page === 'project' && go.mode === 'orders' && !go.open && go.kw === 'ZA003', '이력의 수주 줄을 누르면 수주 대장으로 (새 수주 번호로 찾아 둠) ' + JSON.stringify(go));

    /* ⑦ 주기 — 때가 안 됐으면 안 돌고, 지났으면 돌고, 이 PC 에서 끄면 안 돎 */
    var tick = function (ago, off) { return p.evaluate(async function (ago, off) {
      window.__awCalls = []; _awa.bootAt = 0; _awa.typedAt = 0;
      localStorage.setItem('wm_awa_off', off ? '1' : '0');
      localStorage.setItem('wm_awa_last', JSON.stringify({ at: Date.now() - ago * 60000 }));
      await _awaTick();
      for (var i = 0; i < 40 && _awa.busy; i++) await new Promise(function (r) { setTimeout(r, 100); });
      await new Promise(function (r) { setTimeout(r, 200); });
      return window.__awCalls.filter(function (x) { return x.cmd === 'download'; }).length;
    }, ago, off || false); };
    check(await tick(9) === 0, '주기 10분 — 9분 지났을 때는 안 받음');
    check(await tick(11) === 1, '11분 지나면 받음');
    check(await tick(11, true) === 0, '「이 PC 에서 자동 갱신」 을 끄면 안 받음');
    check(await p.evaluate(function () { _awaPaintBtn(); return document.getElementById('hdrAwaBtn').classList.contains('off'); }), '끈 상태는 단추가 흐리게');
    await c.query("UPDATE tenant_settings SET value = '{\"on\":false,\"min\":10}' WHERE key = 'aw_auto'");
    await p.evaluate(function () { _awa.cfgAt = 0; });
    check(await tick(30) === 0, '관리자가 전체를 끄면 안 받음');
    await p.evaluate(function () { localStorage.setItem('wm_awa_off', '0'); });

    /* ⑧ 손으로 받기는 그대로 */
    var man = await p.evaluate(function () { setPage('team'); setMode('weekly'); window.__awCalls = []; return awgRecentPull().then(function (r) { return { r: r, t: document.body.textContent.indexOf('이미 최신') >= 0 }; }); });
    check(man.r && man.r.added === 0 && man.t, '🔄 최근 받기(손으로) — 그대로 동작 · 「이미 최신」 ' + JSON.stringify(man.r));

    /* ⑨ 🔔 알림 센터 — 항목을 누르면 그 화면으로 */
    var ids = await p.evaluate(async function () {
      var d = function (n) { var x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
      var pr = await createProject({ name: 'ZZ 지연 프로젝트', startDate: d(-40), endDate: d(-5), status: 'active', assignees: ['관리자'], visibility: 'tenant' });
      var is = await apiFetch('/api/issues', { method: 'POST', body: JSON.stringify({ projectId: pr.id, title: 'ZZ 기한 지난 이슈', dueDate: d(-2), status: 'open', type: 'bug', urgency: 'normal' }) });
      setPage('mywork');
      return { pid: pr.id, iid: is && is.data && is.data.id };
    });
    var openNotif = async function (text) {
      await p.evaluate(function () { _ncLast = null; _ncAt = 0; var dd = document.getElementById('notifDropdown'); dd.style.display = 'none'; toggleNotifPanel(); });
      await p.waitForFunction(function (t) { return Array.from(document.querySelectorAll('#notifDropdown .notif-item')).some(function (e) { return e.textContent.indexOf(t) >= 0; }); }, { timeout: 15000 }, text);
      await p.evaluate(function (t) { Array.from(document.querySelectorAll('#notifDropdown .notif-item')).filter(function (e) { return e.textContent.indexOf(t) >= 0; })[0].click(); }, text);
    };
    await openNotif('ZZ 기한 지난 이슈');
    var gi = await p.waitForFunction(function () { var el = document.getElementById('issueDetailPanel'); return curPage === 'project' && curMode === 'issues' && el && /ZZ 기한 지난 이슈/.test(el.textContent); }, { timeout: 10000 }).then(function () { return true; }, function () { return false; });
    check(gi && await p.evaluate(function () { return document.getElementById('notifDropdown').style.display === 'none'; }), '🔔 이슈 알림을 누르면 이슈 상세가 열림 · 알림 목록은 닫힘');
    await p.evaluate(function () { var x = document.getElementById('issueDetailPanel'); if (x) x.remove(); setPage('mywork'); });
    await openNotif('지연 프로젝트: ZZ 지연 프로젝트');
    var gp = await p.waitForFunction(function () { var el = document.getElementById('projDetailPanel'); return curPage === 'project' && el && /ZZ 지연 프로젝트/.test(el.textContent); }, { timeout: 10000 }).then(function () { return true; }, function () { return false; });
    check(gp, '🔔 지연 프로젝트 알림을 누르면 프로젝트 상세가 열림');

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (b) await b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
