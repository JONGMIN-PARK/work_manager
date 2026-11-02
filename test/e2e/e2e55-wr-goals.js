// 주간 업무 v13.311 — 작성 중 점검 · 목표 · 일 하나의 경과 · 같은 일 묶기 / 따로 세기 · 휴대폰 폭
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var SHOTS = path.join(__dirname, '.shots');
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function txt(sel) { return page.evaluate(function (s) { var e = document.querySelector(s); return e ? e.textContent : null; }, sel); }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    var team = 'E2E목표팀' + Date.now().toString().slice(-5);
    // 지난 3주 + 이번 주 — 4주째에 '검사기 UI' 를 '화면 개편 2차' 로 크게 바꿈
    var nextMon = await page.evaluate(function (team) {
      function mon(k) { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - k * 7); return d; }
      function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
      var weeks = [
        ['[개발]', '- [A사] 검사기 UI 10% @김철수', '- [B사] 비전 모듈 30% @박종민', '[C/S]', '- [C사] 통신 점검 #진행중 @이영희'],
        ['[개발]', '- [A사] 검사기 UI 30% @김철수', '- [B사] 비전 모듈 30% @박종민', '[C/S]', '- [C사] 통신 점검 #진행중 @이영희'],
        ['[개발]', '- [A사] 검사기 UI 40% @김철수', '- [B사] 비전 모듈 30% @박종민', '[C/S]', '- [C사] 통신 점검 #진행중 @이영희'],
        ['[개발]', '- [A사] 화면 개편 2차 60% @김철수', '- [B사] 비전 모듈 30% @박종민\n  : 조명 교체 대기', '[C/S]', '- [C사] 통신 점검 #진행중 @이영희']
      ];
      var p = Promise.resolve();
      weeks.forEach(function (lines, i) {
        var s = mon(3 - i), e = new Date(s); e.setDate(e.getDate() + 4);
        p = p.then(function () { return apiFetch('/api/weekly-reports', { method: 'POST', body: JSON.stringify({ autoName: { team: team, weekStart: ymd(s), weekEnd: ymd(e) }, lastText: '', curText: lines.join('\n') }) }); });
      });
      return p.then(function () { return ymd(mon(-1)); });
    }, team);

    /* ── ① 작성 중 점검 — 다음 주 보고서를 쓰는데 통신 점검이 빠짐 · 담당 없는 새 일 ── */
    await page.evaluate(function () { setPage('weekly_report'); });
    await page.waitForSelector('#wrSubTabs [data-wt="author"]', { timeout: 15000 });
    await page.evaluate(function () { document.querySelector('#wrSubTabs [data-wt="author"]').click(); });
    await page.waitForSelector('#wrAuTeam', { timeout: 10000 });
    await page.evaluate(function (a) {
      var t = document.getElementById('wrAuTeam'); t.value = a.team; t.dispatchEvent(new Event('input', { bubbles: true }));
      var s = document.getElementById('wrAuStart'); s.value = a.mon; s.dispatchEvent(new Event('change', { bubbles: true }));
      var ed = document.getElementById('wrAuEditorCur') || document.getElementById('wrAuEditor');
      var l = document.getElementById('wrAuEditorLast'); if (l) { l.value = ''; l.dispatchEvent(new Event('input', { bubbles: true })); }
      ed.value = '[개발]\n- [A사] 화면 개편 2차 70% @김철수\n- [B사] 비전 모듈 30% @박종민\n- [D사] 새 일 #진행중';
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }, { team: team, mon: nextMon });
    await page.waitForSelector('#wrAuCheck .wrc-sum', { timeout: 8000 }).catch(function () {});
    var ck = await page.evaluate(function () {
      var b = document.getElementById('wrAuCheck');
      if (b && !b.querySelector('.wrc-body')) b.querySelector('[data-wrc-tog]').click();
      return { sum: b && b.querySelector('.wrc-sum') && b.querySelector('.wrc-sum').textContent, rows: Array.prototype.map.call(b.querySelectorAll('.wrc-r'), function (r) { return r.textContent; }) };
    });
    check(ck.sum && /빠짐\s*1/.test(ck.sum) && /정체\s*1/.test(ck.sum) && /빠진 정보\s*1/.test(ck.sum), '점검 줄 — 빠짐 1 · 정체 1 · 빠진 정보 1 ' + JSON.stringify(ck.sum));
    check(ck.rows.some(function (r) { return /통신 점검/.test(r); }) && ck.rows.some(function (r) { return /새 일.*납기 · 담당 없음/.test(r); }), '점검 목록 ' + JSON.stringify(ck.rows));
    await page.screenshot({ path: path.join(SHOTS, 'wr-check-desk.png') });
    // 완료로 넣기 → 지난주 칸에 #완료 · 빠짐 사라짐
    await page.evaluate(function () { document.querySelector('#wrAuCheck [data-wrc-done]').click(); });
    await page.waitForFunction(function () { var s = document.querySelector('#wrAuCheck .wrc-sum'); return s && !/빠짐/.test(s.textContent); }, { timeout: 8000 }).catch(function () {});
    var after = await page.evaluate(function () { var l = document.getElementById('wrAuEditorLast'); return { last: l && l.value, sum: (document.querySelector('#wrAuCheck .wrc-sum') || {}).textContent }; });
    check(/- \[C사\] 통신 점검 @이영희 #완료/.test(after.last || '') && !/빠짐/.test(after.sum || ''), '✅ 완료로 → 지난주 칸에 넣고 빠짐 없어짐 ' + JSON.stringify(after));
    // 줄로 가기
    await page.evaluate(function () { var r = Array.prototype.filter.call(document.querySelectorAll('#wrAuCheck .wrc-r'), function (x) { return /정체/.test(x.textContent); })[0]; r.click(); });
    await wait(300);
    var sel = await page.evaluate(function () { var a = document.activeElement; return a && a.tagName === 'TEXTAREA' ? a.value.slice(a.selectionStart, a.selectionEnd) : null; });
    check(/비전 모듈/.test(sel || ''), '정체 줄 누르면 편집창의 그 줄 선택 ' + JSON.stringify(sel));

    /* ── ② 분석 탭 — 목표 ── */
    await page.evaluate(function () { document.querySelector('#wrSubTabs [data-wt="stats"]').click(); });
    await page.waitForSelector('#wriTeam option:nth-child(2)', { timeout: 10000 }).catch(function () {});
    await page.select('#wriTeam', team);
    await page.waitForSelector('#wriGoals', { timeout: 10000 });
    check(/목표를 정해 두면/.test(await txt('#wriGoals')), '목표 없을 때 안내');
    await page.click('#wriGoalEdit');
    await page.waitForSelector('#wriGoalModal .wri-gr', { timeout: 5000 });
    await page.evaluate(function () {
      var rows = document.querySelectorAll('#wriGoalModal .wri-gr');
      rows[0].querySelector('[data-f=metric]').value = 'completionRate'; rows[0].querySelector('[data-f=target]').value = '60';
      rows[1].querySelector('[data-f=member]').value = '박종민'; rows[1].querySelector('[data-f=metric]').value = 'stalled'; rows[1].querySelector('[data-f=target]').value = '0';
      document.getElementById('wriGoalSave').click();
    });
    await page.waitForFunction(function () { return !document.getElementById('wriGoalModal') && document.querySelectorAll('#wriGoals .wri-g').length === 2; }, { timeout: 8000 }).catch(function () {});
    var gl = await page.evaluate(function () { return { g: Array.prototype.map.call(document.querySelectorAll('#wriGoals .wri-g'), function (g) { return g.textContent; }), line: /목표 60%/.test(document.querySelector('.wri-chart').textContent) }; });
    check(gl.g.length === 2 && /완료율.*0%.*≥ 60%.*❌/.test(gl.g[0]) && /박종민.*정체된 일.*1건.*≤ 0건.*❌/.test(gl.g[1]) && gl.line, '목표 카드 · 그래프 목표선 ' + JSON.stringify(gl));

    /* ── ③ 일 하나의 경과 ── */
    await page.evaluate(function () { document.querySelector('.wri-k[data-risk="stalled"]').click(); });
    await wait(300);
    await page.evaluate(function () { document.querySelector('#wriRisk .wri-ri[data-key]').click(); });
    await page.waitForSelector('#wriItemModal .wri-hr', { timeout: 8000 });
    var hm = await page.evaluate(function () { var m = document.getElementById('wriItemModal'); return { rows: m.querySelectorAll('.wri-hr').length, chart: !!m.querySelector('svg polyline'), detail: /조명 교체 대기/.test(m.textContent), same: /진행률 그대로/.test(m.textContent) }; });
    check(hm.rows === 4 && hm.chart && hm.detail && hm.same, '경과 창 — 4주 · 그림 · 세부 · 진행률 그대로 표시 ' + JSON.stringify(hm));
    await page.screenshot({ path: path.join(SHOTS, 'wr-item-hist.png') });
    await page.keyboard.press('Escape');
    await wait(200);

    /* ── ④ 모든 일 → 같은 일로 묶기 → 따로 세기 ── */
    await page.evaluate(function () { document.querySelector('#wriRisk [data-rt="all"]').click(); });
    await wait(200);
    var n0 = await page.evaluate(function () { return document.querySelectorAll('#wriRisk .wri-ri').length; });
    await page.type('#wriQ', 'A사');
    await wait(200);
    var picked = await page.evaluate(function () { var cs = document.querySelectorAll('#wriRisk input[data-sel]'); cs.forEach(function (c) { c.click(); }); return { n: cs.length, bar: !document.getElementById('wriMergeBar').hidden, focus: document.activeElement && document.activeElement.id }; });
    check(n0 === 4 && picked.n === 2 && picked.bar, '모든 일 4개 · 찾기 A사 → 2개 고름 · 묶기 막대 ' + JSON.stringify(picked));
    await page.click('#wriMerge');
    await page.waitForFunction(function () { var on = document.querySelector('#wriRisk .wri-rtabs .on'); return on && /모든 일\s*3/.test(on.textContent); }, { timeout: 8000 }).catch(function () {});
    var mg = await page.evaluate(function () { var on = document.querySelector('#wriRisk .wri-rtabs .on'); var r = Array.prototype.filter.call(document.querySelectorAll('#wriRisk .wri-ri'), function (x) { return /A사/.test(x.textContent); }); return { tab: on && on.textContent, a: r.map(function (x) { return x.textContent; }) }; });
    check(/모든 일\s*3/.test(mg.tab) && mg.a.length === 1 && /화면 개편 2차/.test(mg.a[0]) && /🔗2/.test(mg.a[0]), '묶은 뒤 3개 · A사 하나(🔗2) ' + JSON.stringify(mg));
    await page.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll('#wriRisk .wri-ri'), function (x) { return /A사/.test(x.textContent); })[0].click(); });
    await page.waitForSelector('#wriItemModal [data-lk="split"]', { timeout: 8000 });
    var vm = await page.evaluate(function () { var m = document.getElementById('wriItemModal'); return { rows: m.querySelectorAll('.wri-hr').length, chg: /이름 바뀜/.test(m.textContent), v: m.querySelectorAll('.wri-v').length }; });
    check(vm.rows === 4 && vm.chg && vm.v === 2, '묶은 일 경과 — 4주 이어짐 · 이름 바뀜 표시 · 이름 2개 ' + JSON.stringify(vm));
    await page.evaluate(function () { document.querySelector('#wriItemModal [data-lk="split"]').click(); });
    await page.waitForFunction(function () { return !document.getElementById('wriItemModal'); }, { timeout: 8000 }).catch(function () {});
    await page.waitForFunction(function () { var on = document.querySelector('#wriRisk .wri-rtabs .on'); return on && /모든 일\s*4/.test(on.textContent); }, { timeout: 8000 }).catch(function () {});
    check(/모든 일\s*4/.test(await txt('#wriRisk .wri-rtabs .on')), '✂ 따로 세기 → 다시 4개');
    await page.screenshot({ path: path.join(SHOTS, 'wr-goals-desk.png'), fullPage: true });

    /* ── ⑤ 휴대폰 폭 — 분석 · 경과 창 · 목표 창 넘침 없음 ── */
    await page.setViewport({ width: 402, height: 874 });
    await wait(400);
    async function sw() { return page.evaluate(function () { return document.documentElement.scrollWidth; }); }
    var s1 = await sw();
    await page.evaluate(function () { document.querySelector('#wriRisk .wri-ri[data-key]').click(); });
    await page.waitForSelector('#wriItemModal .wri-hr', { timeout: 8000 });
    var s2 = await page.evaluate(function () { var b = document.querySelector('#wriItemModal .wa-modal-box'); return { sw: document.documentElement.scrollWidth, inner: b.scrollWidth - b.clientWidth }; });
    await page.screenshot({ path: path.join(SHOTS, 'wr-item-phone.png') });
    await page.keyboard.press('Escape'); await wait(200);
    await page.click('#wriGoalEdit');
    await page.waitForSelector('#wriGoalModal .wri-gr', { timeout: 5000 });
    var s3 = await page.evaluate(function () { var b = document.querySelector('#wriGoalModal .wa-modal-box'); return { sw: document.documentElement.scrollWidth, inner: b.scrollWidth - b.clientWidth }; });
    await page.screenshot({ path: path.join(SHOTS, 'wr-goal-phone.png') });
    check(s1 <= 402 && s2.sw <= 402 && s2.inner <= 1 && s3.sw <= 402 && s3.inner <= 1, '휴대폰 — 넘침 없음 ' + JSON.stringify([s1, s2, s3]));
    await page.evaluate(function () { document.getElementById('wriGoalCancel').click(); });
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack);
  }
  await browser.close();
  console.log(fail ? ('FAILED ' + fail + ' / ' + (ok + fail)) : ('ALL PASS (' + ok + ')'));
  process.exit(fail ? 1 : 0);
})();
