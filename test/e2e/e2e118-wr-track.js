// 📦 주간 업무 점검 — 빠진 일 보관(지우지 않음) · 🎯 추적(담당자에게 업무 요청) · 보관함에서 다시 넣기 (v13.536)
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setViewport({ width: 1500, height: 950 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    var team = 'E2E추적팀' + Date.now().toString().slice(-5);
    var nextMon = await page.evaluate(function (team) {
      function mon(k) { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - k * 7); return d; }
      function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
      var weeks = [['[개발]', '- [A사] 검사기 UI 30% @김팀원', '[C/S]', '- [C사] 통신 점검 ~2026-12-04 #진행중 @이팀원'],
        ['[개발]', '- [A사] 검사기 UI 50% @김팀원', '[C/S]', '- [C사] 통신 점검 ~2026-12-04 #진행중 @이팀원']];
      var p = Promise.resolve();
      weeks.forEach(function (lines, i) {
        var s = mon(1 - i), e = new Date(s); e.setDate(e.getDate() + 4);
        p = p.then(function () { return apiFetch('/api/weekly-reports', { method: 'POST', body: JSON.stringify({ autoName: { team: team, weekStart: ymd(s), weekEnd: ymd(e) }, lastText: '', curText: lines.join('\n') }) }); });
      });
      return p.then(function () { return ymd(mon(-1)); });
    }, team);
    await page.evaluate(function () { setPage('weekly_report'); });
    await page.waitForSelector('#wrSubTabs [data-wt="author"]', { timeout: 15000 });
    await page.evaluate(function () { document.querySelector('#wrSubTabs [data-wt="author"]').click(); });
    await page.waitForSelector('#wrAuTeam', { timeout: 10000 });
    await page.evaluate(function (a) {
      var t = document.getElementById('wrAuTeam'); t.value = a.team; t.dispatchEvent(new Event('input', { bubbles: true }));
      var s = document.getElementById('wrAuStart'); s.value = a.mon; s.dispatchEvent(new Event('change', { bubbles: true }));
      var ed = document.getElementById('wrAuEditorCur') || document.getElementById('wrAuEditor');
      var l = document.getElementById('wrAuEditorLast'); if (l) { l.value = ''; l.dispatchEvent(new Event('input', { bubbles: true })); }
      ed.value = '[개발]\n- [A사] 검사기 UI 70% @김팀원'; ed.dispatchEvent(new Event('input', { bubbles: true }));
    }, { team: team, mon: nextMon });
    await page.waitForSelector('#wrAuCheck .wrc-sum', { timeout: 8000 }).catch(function () {});
    await page.evaluate(function () { var b = document.getElementById('wrAuCheck'); if (b && !b.querySelector('.wrc-body')) b.querySelector('[data-wrc-tog]').click(); });
    await wait(300);
    var ui = await page.evaluate(function () {
      var b = document.getElementById('wrAuCheck');
      return { all: (b.querySelector('[data-wrc-binall]') || {}).textContent, keep: (b.querySelector('[data-wrc-bin]') || {}).textContent, track: (b.querySelector('[data-wrc-track]') || {}).textContent,
        box: (b.querySelector('[data-wrc-binopen]') || {}).textContent, row: [].map.call(b.querySelectorAll('.wrc-r'), function (r) { return r.textContent; }).join(' | ') };
    });
    check(/통신 점검/.test(ui.row), '빠진 일 — C사 통신 점검');
    check(/📦 모두 보관/.test(ui.all) && /📦 보관/.test(ui.keep) && /🎯 추적/.test(ui.track) && /📦 보관함/.test(ui.box) && !/없애기|휴지통/.test(ui.all + ui.keep + ui.box), '이름 — 없애기 → 📦 보관 · 🎯 추적 · 📦 보관함 ' + JSON.stringify(ui));

    // 🎯 추적 → 업무 요청(할 일) 창: 제목 · 기한 · 담당(이팀원) 미리
    await page.evaluate(function () { document.querySelector('#wrAuCheck [data-wrc-track]').click(); });
    await page.waitForSelector('#wrqModal .wrq-type.on', { timeout: 8000 });
    var rq = await page.evaluate(function () { var m = document.getElementById('wrqModal'); return { type: m.querySelector('.wrq-type.on').dataset.t, title: m.querySelector('[data-k="title"]').value, due: m.querySelector('[data-k="dueDate"]').value, to: m.querySelector('.wrq-chips').textContent, body: m.querySelector('[data-k="body"]').value }; });
    check(rq.type === 'todo' && rq.title === 'C사 통신 점검' && rq.due === '2026-12-04' && /이팀원/.test(rq.to) && /주간 업무에서 빠진 일/.test(rq.body), '추적 창 — 할 일 · 제목 · 기한 · 담당 미리 ' + JSON.stringify(rq));
    await page.evaluate(function () { document.querySelector('#wrqModal [data-a="send"]').click(); });
    await page.waitForFunction(function () { return !document.getElementById('wrqModal'); }, { timeout: 8000 }).catch(function () {});
    await page.waitForFunction(function () { var s = document.querySelector('#wrAuCheck .wrc-sum'); return s && !/빠짐/.test(s.textContent); }, { timeout: 8000 }).catch(function () {});
    var after = await page.evaluate(function (team) {
      return Promise.all([apiFetch('/api/weekly-reports/bin?team=' + encodeURIComponent(team)), apiFetch('/api/work-requests?box=out')]).then(function (r) {
        var b = (r[0].data || []).filter(function (x) { return /통신 점검/.test(x.name); })[0];
        var w = (r[1].data || []).filter(function (x) { return x.title === 'C사 통신 점검'; })[0];
        return { state: b && b.state, note: b && b.note, wTo: w && w.toName, wType: w && w.type, sum: (document.querySelector('#wrAuCheck .wrc-sum') || {}).textContent, binBtn: (document.querySelector('#wrAuCheck [data-wrc-binopen]') || {}).textContent };
      });
    }, team);
    check(after.wType === 'todo' && /이팀원/.test(after.wTo || ''), '이팀원에게 업무 요청(할 일) 보냄 ' + JSON.stringify(after));
    check(after.state === 'wait' && /🎯 추적 중 → 이팀원/.test(after.note || '') && /처리 대기 1/.test(after.binBtn), '보관(처리 대기) + 🎯 추적 중 메모 · 지우지 않음');

    // 보관함 — 이름 · 메모 · 다시 넣기
    await page.evaluate(function () { document.querySelector('#wrAuCheck [data-wrc-binopen]').click(); });
    await page.waitForSelector('#wrBinModal .wrb-r', { timeout: 8000 });
    var bx = await page.evaluate(function () { var m = document.getElementById('wrBinModal'); return { t: m.textContent, track: !!m.querySelector('[data-track]') }; });
    check(/📦 보관함 · 처리 대기/.test(bx.t) && /🎯 추적 중/.test(bx.t) && bx.track, '보관함 — 제목 · 추적 메모 · 🎯 단추');
    await page.evaluate(function () { document.querySelector('#wrBinModal [data-cur]').click(); });
    await wait(800);
    var ed = await page.evaluate(function () { var e = document.getElementById('wrAuEditorCur') || document.getElementById('wrAuEditor'); return e.value; });
    check(/통신 점검/.test(ed), '↩ 금주 — 다시 보고서에 넣음 (킵 → 다시 적용)');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
