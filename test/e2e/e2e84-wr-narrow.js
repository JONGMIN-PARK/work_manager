// 주간 업무 좁은 화면 (v13.461) — 작성 한 칸씩(지난주 · 금주 · 미리보기 · 업무일지) · 넓히면 원래 틀 · 검색 · 목록 카드 · 목록 날짜(하루 밀림)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0, made = [];
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var team = '좁은시험' + Date.now();
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    made = await page.evaluate(async function (team) {
      var r = await apiFetch('/api/weekly-reports', { method: 'POST', body: JSON.stringify({ autoName: { team: team, weekStart: '2026-11-09', weekEnd: '2026-11-13' }, curText: '[개발]\n- [좁은사이트] 좁은 화면 금주 일 ~12/04 40% @관리자 #진행중\n  : 세부 하나', lastText: '[개발]\n- [좁은사이트] 지난주 일 @관리자' }) });
      try { localStorage.setItem('wr-au-np', 'cur'); localStorage.setItem('wr-author-last-id', r.data[0].id); } catch (e) {}
      return [r.data[0].id];
    }, team);
    await page.setViewport({ width: 402, height: 874 }); await wait(500);
    await page.evaluate(function () { setPage('team'); setMode('weekly_report'); });
    await page.waitForSelector('#wrNp', { timeout: 8000 }); await wait(800);
    var vis = function () { return page.evaluate(function () { var v = function (id) { var e = document.getElementById(id); return !!(e && e.offsetParent); }; return { cur: v('wrAuEditorCur'), last: v('wrAuEditorLast'), pvC: v('wrAuPreviewCur'), pvL: v('wrAuPreviewLast'), src: v('wrSrc'), sw: document.documentElement.scrollWidth }; }); };
    var a = await vis();
    check(a.cur && !a.last && !a.pvC && !a.src && a.sw <= 404, '휴대폰 작성 — 금주 편집 칸만 ' + JSON.stringify(a));
    await page.click('#wrNp [data-np="last"]'); await wait(200); a = await vis();
    check(a.last && !a.cur && !a.src, '지난주 누르면 지난주 칸만 ' + JSON.stringify(a));
    await page.click('#wrNp [data-np="pv"]'); await wait(300); a = await vis();
    var pvTxt = await page.evaluate(function () { return document.getElementById('wrAuPreviewCur').textContent; });
    check(a.pvC && a.pvL && !a.cur && !a.last && /좁은 화면 금주 일/.test(pvTxt), '미리보기 — 금주 · 지난주 미리보기만 ' + JSON.stringify(a));
    await page.click('#wrNp [data-np="src"]'); await wait(300); a = await vis();
    check(a.src && !a.cur && !a.pvC, '업무일지 — 업무일지 패널만 ' + JSON.stringify(a));
    // 편집 내용이 칸을 바꿔도 남음 + 변경 점
    await page.click('#wrNp [data-np="cur"]'); await wait(200);
    await page.focus('#wrAuEditorCur'); await page.keyboard.press('End'); await page.keyboard.type(' 추가');
    await wait(300);
    var dot = await page.evaluate(function () { var d = document.querySelector('#wrNp [data-np="cur"] .wr-dirty'); return d && d.style.display !== 'none'; });
    check(dot, '금주 고치면 막대에 ● 변경 표시');
    await page.click('#wrNp [data-np="last"]'); await page.click('#wrNp [data-np="cur"]'); await wait(100);
    check(await page.evaluate(function () { return /추가$/.test(document.getElementById('wrAuEditorCur').value.split('\n')[1] || '') || / 추가/.test(document.getElementById('wrAuEditorCur').value); }), '칸을 바꿔도 쓴 글 그대로');
    // 넓히면 원래 틀(막대 없음 · 두 칸)
    await page.setViewport({ width: 1400, height: 900 }); await wait(800);
    var wide = await page.evaluate(function () { return { np: !!document.getElementById('wrNp'), cur: !!document.getElementById('wrAuEditorCur') && !!document.getElementById('wrAuEditorCur').offsetParent, txt: / 추가/.test((document.getElementById('wrAuEditorCur') || document.getElementById('wrAuEditor') || {}).value || '') }; });
    check(!wide.np && wide.txt, '넓히면 막대 없음 · 쓴 글 유지 ' + JSON.stringify(wide));
    // 목록 — 날짜가 하루 밀리지 않음 · 휴대폰은 카드
    await page.setViewport({ width: 402, height: 874 }); await wait(600);
    await page.click('#wrSubTabs [data-wt="list"]'); await page.waitForSelector('.wr-lcards', { timeout: 8000 });
    var li = await page.evaluate(function (team) {
      var tr = [].filter.call(document.querySelectorAll('.wr-lcards tbody tr'), function (t) { return t.textContent.indexOf(team) >= 0; })[0];
      return { rg: tr && tr.querySelector('.c-rg').textContent, disp: tr && getComputedStyle(tr).display, head: getComputedStyle(document.querySelector('.wr-lcards thead')).display, sw: document.documentElement.scrollWidth };
    }, team);
    check(li.rg === '11/09 ~ 11/13', '목록 기간 11/09 ~ 11/13 (예전엔 2026-11-08T15:00:00.000Z) ' + li.rg);
    check(li.disp === 'flex' && li.head === 'none' && li.sw <= 404, '휴대폰 목록 — 카드 ' + JSON.stringify(li));
    // 검색 — 카드
    await page.click('#wrSubTabs [data-wt="search"]'); await wait(400);
    await page.type('#wrSQ', '좁은 화면 금주'); await page.click('#wrSearchBtn');
    await page.waitForSelector('.wr-scards', { timeout: 8000 });
    var se = await page.evaluate(function () { var tr = document.querySelector('.wr-scards tbody tr'), nm = tr.querySelector('.c-nm'); return { w: Math.round(nm.getBoundingClientRect().width), sw: document.documentElement.scrollWidth }; });
    check(se.w >= 180 && se.sw <= 404, '휴대폰 검색 — 카드, 업무 글이 넓게 ' + JSON.stringify(se));
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  finally {
    try { await page.evaluate(async function (ids) { for (var i = 0; i < ids.length; i++) await apiFetch('/api/weekly-reports/' + ids[i], { method: 'DELETE' }); try { localStorage.removeItem('wr-au-np'); } catch (e) {} }, made); } catch (e) {}
    await browser.close();
  }
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
