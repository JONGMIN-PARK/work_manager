// 🎯 내 업무 보드 (v13.532) — 리스트 전부 보이게(칸 안 스크롤 없음 · 빈 칸 작게) · 넓으면 한 줄 카드(항목명 · 중요도 · 날짜 · D-day) · 좁으면 두 줄
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0, ids = [];
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setViewport({ width: 540, height: 950 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'lee@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    ids = await page.evaluate(async function () {
      var d = function (n) { var x = new Date(); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
      var rows = [['PICAlign 완료', 1, 2], ['키엔스 스마트 비전 연락', -1, 2], ['픽업 테스트', 2, 1], ['EES 미팅 (MITech, DS ENT)', 1, 1], ['풀 연동 테스트 다음 주', 9, 1], ['2027년 팀 운용 계획', 32, 2],
        ['PICAlign Kevence 셋업 및 교육 요청 — 아주 긴 제목이 들어가도 한 줄에서 말줄임으로', 14, 4], ['견적서 회신', 0, 2], ['도면 검토', 5, 4], ['보고서 정리', null, 3]];
      var out = [];
      for (var i = 0; i < rows.length; i++) { var r = await apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: rows[i][0], dueDate: rows[i][1] == null ? '' : d(rows[i][1]), priority: rows[i][2] }) }); out.push(r.data.id); }
      return out;
    });
    await page.evaluate(function () { try { localStorage.setItem('wm.mw.view', 'matrix'); } catch (_) {} setPage('mywork'); });
    await wait(800);
    await page.evaluate(function () { var s = document.getElementById('mwViewSel'); if (s && s.value !== 'matrix') { s.value = 'matrix'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    await page.waitForSelector('#mMyWork .mwb-i', { timeout: 15000 });
    await wait(600);
    var measure = function () {
      return page.evaluate(function () {
        var cards = [].slice.call(document.querySelectorAll('#mMyWork .mwb-i'));
        var lists = [].slice.call(document.querySelectorAll('#mMyWork .mwb-l'));
        var empty = [].slice.call(document.querySelectorAll('#mMyWork .mwb-c')).filter(function (c) { return !c.querySelector('.mwb-i'); }).map(function (c) { return Math.round(c.getBoundingClientRect().height); });
        var row = function (c) { var t = c.querySelector('.mwb-t').getBoundingClientRect(), m = c.querySelector('.mwb-meta').getBoundingClientRect(); return Math.abs((t.top + t.height / 2) - (m.top + m.height / 2)) < 6; };
        return { n: cards.length, maxH: Math.max.apply(null, cards.map(function (c) { return Math.round(c.getBoundingClientRect().height); })),
          oneLine: cards.filter(row).length, scroll: lists.filter(function (l) { return l.scrollHeight > l.clientHeight + 1; }).length, empty: empty,
          dd: [].map.call(document.querySelectorAll('#mMyWork .mwb-dd'), function (x) { return x.textContent; }), hs: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
    };
    var m1 = await measure();
    await page.screenshot({ path: path.join(__dirname, '.shots', 'mwb-540.png'), fullPage: false });
    check(m1.n === 10 && m1.oneLine === 10 && m1.maxH <= 34, '폭 540 — 10개 모두 한 줄 · 카드 높이 ' + m1.maxH + ' ' + JSON.stringify(m1).slice(0, 200));
    check(m1.scroll === 0, '칸 안 스크롤 없음 — 리스트 전부 보임');
    check(m1.empty.every(function (h) { return h < 140; }), '빈 칸은 작게 ' + JSON.stringify(m1.empty));
    check(m1.dd.indexOf('D-day') >= 0 && m1.dd.indexOf('D+1') >= 0 && m1.dd.indexOf('D-1') >= 0 && m1.dd.indexOf('D-14') >= 0, 'D-day 표시 ' + JSON.stringify(m1.dd));
    var late = await page.evaluate(function () { var x = [].filter.call(document.querySelectorAll('#mMyWork .mwb-dd'), function (e) { return e.textContent === 'D+1'; })[0]; return x && x.classList.contains('late'); });
    check(late && m1.hs <= 1, '지난 것은 빨간 D+ · 가로 넘침 없음');
    var tip = await page.evaluate(function () { var t = [].filter.call(document.querySelectorAll('#mMyWork .mwb-t'), function (x) { return /아주 긴 제목/.test(x.textContent); })[0]; return { tip: t.title, cut: t.scrollWidth > t.clientWidth }; });
    check(/한 줄에서 말줄임으로/.test(tip.tip) && tip.cut, '긴 제목 — 말줄임 · 올리면 전체(title)');
    // 넓은 화면
    await page.setViewport({ width: 1600, height: 950 });
    await wait(700);
    var m2 = await measure();
    await page.screenshot({ path: path.join(__dirname, '.shots', 'mwb-1600.png'), fullPage: false });
    check(m2.oneLine === 10 && m2.scroll === 0, '폭 1600 — 한 줄 · 전부 보임 ' + JSON.stringify({ one: m2.oneLine, maxH: m2.maxH }));
    // 아주 좁은 칸(휴대폰) — 두 줄로
    await page.setViewport({ width: 330, height: 800, isMobile: true, hasTouch: true });
    await wait(700);
    var m3 = await measure();
    check(m3.hs <= 1 && m3.n === 10, '휴대폰 330 — 넘침 없음 (한 줄 ' + m3.oneLine + ' / 10)');
    // 올리면 손질 단추가 겹쳐 뜸 — 누를 수 있음
    await page.setViewport({ width: 1600, height: 950 });
    await wait(500);
    var hov = await page.evaluate(function () { var c = document.querySelector('#mMyWork .mwb-i'); var a = c.querySelector('.mwb-acts'); return a ? getComputedStyle(a).position : 'none'; });
    var card = await page.$('#mMyWork .mwb-i');
    await card.hover(); await wait(250);
    var vis = await page.evaluate(function () { var a = document.querySelector('#mMyWork .mwb-i .mwb-acts'); return a ? +getComputedStyle(a).opacity : 1; });
    check(hov === 'absolute' && vis > 0.9, '한 줄일 때 손질 단추는 올리면 겹쳐 뜸');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    try { await page.evaluate(async function (ids) { for (var i = 0; i < ids.length; i++) { await apiFetch('/api/my-work/todos/' + ids[i], { method: 'DELETE' }); } await apiFetch('/api/my-work/trash', { method: 'DELETE' }); }, ids); } catch (_) {}
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
