// 화면 툴바 공통 틀 (v13.289 ① 업무 관리) — 제목 · 주 버튼 하나 · ⋯ 메뉴 · 메뉴 안 기능이 그대로 동작
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var SHOTS = path.join(__dirname, '.shots');
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var dialogs = []; page.on('dialog', function (d) { dialogs.push(d.message()); d.dismiss(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function ready() {
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
  }
  // 화면 툴바 요약 — 제목 · 주 버튼 수 · 마지막 두 칸(주 버튼 · ⋯) · 한 줄인지
  function tb(id) {
    return page.evaluate(function (id) {
      var root = document.getElementById(id), bar = root && root.querySelector('.wm-tb');
      if (!bar) return null;
      var kids = Array.from(bar.children).filter(function (e) { return e.offsetParent; });
      var tops = kids.map(function (e) { var r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); });
      return { title: (bar.querySelector('.wm-tb-t') || {}).textContent, pri: bar.querySelectorAll('.wm-pri').length, last: kids.slice(-2).map(function (e) { return e.classList.contains('hdr-pop') ? 'more' : e.classList.contains('wm-pri') ? 'pri' : e.tagName; }).join(','), oneLine: Math.max.apply(null, tops) - Math.min.apply(null, tops) < 8, h: Math.round(bar.getBoundingClientRect().height) };
    }, id);
  }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { localStorage.removeItem('wm-last-view'); } catch (e) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await ready();

    // 📋 주간 분석 — 업무일지가 없으면 툴바가 숨은 업로드 화면이라 비어 있는 상태로 보이게
    await page.evaluate(function () { setPage('team'); setMode('weekly'); document.getElementById('mainArea').classList.remove('hidden'); });
    var w = await tb('mWeekly');
    check(w && w.title === '📋 주간 분석' && w.pri === 1 && w.last === 'pri,more' && w.oneLine, '주간 분석 툴바 ' + JSON.stringify(w));
    var wOut = await page.evaluate(function () { var bar = document.querySelector('#mWeekly .wm-tb'); return { enc: !!bar.querySelector('.hdr-pop-menu #encMain'), raw: !!bar.querySelector('.hdr-pop-menu #saveRawTog'), vis: Array.from(bar.querySelectorAll('button')).filter(function (b) { return b.offsetParent; }).map(function (b) { return b.textContent.trim(); }) }; });
    check(wOut.enc && wOut.raw && wOut.vis.length <= 4, '인코딩 · 원본 포함은 ⋯ 안, 밖 버튼 ' + wOut.vis.length + '개 ' + JSON.stringify(wOut.vis));
    await page.click('#wrToolsWrap > button'); await wait(150);
    await page.screenshot({ path: path.join(SHOTS, 'tb-weekly-more.png'), clip: { x: 700, y: 120, width: 700, height: 420 } });
    var encN = await page.$$eval('#encMain .chip', function (a) { return a.length; });
    check(encN >= 3, '⋯ 안 인코딩 칩 ' + encN);
    await page.click('#encMain .chip.co'); await wait(200);
    check(await page.evaluate(function () { return document.getElementById('wrToolsWrap').classList.contains('open'); }), '인코딩 칩을 눌러도 메뉴는 열린 채');
    await page.click('#saveRawTog'); await wait(100);
    check(await page.evaluate(function () { return document.getElementById('wrToolsWrap').classList.contains('open') && !document.getElementById('saveRawTog').checked; }), '원본 포함 체크 — 메뉴 열린 채 바뀜');
    await page.click('#saveRawTog');
    var n0 = dialogs.length;
    await page.click('#wrToolsWrap .hdr-mi[onclick*="deduplicateRecords"]'); await wait(300);
    check(!(await page.evaluate(function () { return document.getElementById('wrToolsWrap').classList.contains('open'); })), '메뉴 항목을 누르면 닫힘');
    await page.evaluate(function () { document.getElementById('mainArea').classList.add('hidden'); });

    // 🗄️ 아카이브 · 📈 트렌드
    await page.evaluate(function () { setMode('archive'); }); await wait(500);
    var a = await tb('mArchive');
    var delOut = await page.evaluate(function () { var b = document.querySelector('#mArchive [onclick*="clearAllWeeks"]'); return b && !b.offsetParent && !!b.closest('.hdr-pop-menu'); });
    check(a && a.title === '🗄️ 아카이브' && a.last.split(',')[1] === 'more' && delOut, '아카이브 — 전체 삭제는 ⋯ 안 ' + JSON.stringify(a));
    await page.evaluate(function () { setMode('trend'); }); await wait(500);
    var t = await tb('mTrend');
    check(t && t.title === '📈 트렌드' && t.pri === 1 && t.last.split(',')[1] === 'pri' && t.oneLine, '트렌드 — 분석 실행이 오른쪽 끝 ' + JSON.stringify(t));

    // 📅 주간 업무
    await page.evaluate(function () { setMode('weekly_report'); }); await wait(1500);
    var r = await tb('mWeeklyReport');
    var seg = await page.$$eval('#wrSubTabs > button', function (a) { return a.map(function (b) { return b.dataset.wt; }).join(','); });
    check(r && r.title === '📅 주간 업무' && seg === 'author,search,stats,list,upload', '주간 업무 — 툴바 전환 ' + seg + ' ' + JSON.stringify(r));
    var au = await page.evaluate(function () { var row = document.getElementById('wrAuSave').parentElement, r0 = row.getBoundingClientRect(); return { h: Math.round(r0.height), save: document.getElementById('wrAuSave').classList.contains('wm-pri'), inMenu: ['wrAuNew', 'wrAuLoadPrev', 'wrAuExport'].every(function (id) { return !!document.getElementById(id).closest('.hdr-pop-menu'); }) }; });
    check(au.save && au.inMenu && au.h < 50, '작성 줄 한 줄 · 저장이 주 버튼 · 새로 만들기 등은 ⋯ ' + JSON.stringify(au));
    await page.screenshot({ path: path.join(SHOTS, 'tb-weekly-report.png'), clip: { x: 0, y: 120, width: 1400, height: 200 } });
    await page.click('#wrSubTabs [data-wt="list"]'); await wait(500);
    check(await page.evaluate(function () { return document.querySelector('#wrSubTabs [data-wt="list"]').classList.contains('on'); }), '툴바 전환 — 목록');
    await page.click('#wrSubTabs [data-wt="author"]'); await wait(800);
    await page.click('#wrAuMoreWrap > button'); await page.click('#wrAuExport'); await wait(300);
    check(await page.evaluate(function () { return document.getElementById('wrAuExportPanel').style.display !== 'none' && !document.getElementById('wrAuMoreWrap').classList.contains('open'); }), '⋯ › HTML 내보내기 패널 열림 · 메뉴 닫힘');

    // 👥 업무 부하
    await page.evaluate(function () { setMode('workload'); }); await wait(1500);
    var l = await tb('mWorkload');
    check(l && l.title === '👥 업무 부하' && l.oneLine && !!(await page.$('#mWorkload .wm-tb-help')), '업무 부하 툴바 ' + JSON.stringify(l));
    await page.click('#mWorkload [data-lv="tl"]'); await wait(800);
    var lvS = await page.evaluate(function () { var o = document.querySelector('#mWorkload [data-lv].on'); return { on: o && o.getAttribute('data-lv'), slot: !!document.getElementById('mwtLoadSlot'), tlw: !!document.querySelector('#mWorkload .mtl, #mwLoadTimeline'), ls: _mwLS('loadview'), fn: typeof mwLoadTimelineMount, head: document.getElementById('mWorkload').innerHTML.slice(0, 160) }; });
    check(lvS.on === 'tl' && (lvS.slot || lvS.tlw), '보기 전환 — 타임라인 ' + JSON.stringify(lvS));
    await page.click('#mWorkload [data-lv="table"]'); await wait(800);

    // 휴대폰 — 툴바가 화면 안
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true }); await wait(300); await ready();
    var over = [];
    for (var m of ['archive', 'trend', 'weekly_report', 'workload']) {
      await page.evaluate(function (m) { setPage('team'); setMode(m); }, m); await wait(1200);
      var o = await page.evaluate(function () { var vw = document.documentElement.clientWidth; return Array.from(document.querySelectorAll('.wm-tb > *')).filter(function (e) { var r = e.getBoundingClientRect(); return e.offsetParent && (r.right > vw + 1 || r.left < -1); }).length; });
      if (o) over.push(m + ':' + o);
      await page.screenshot({ path: path.join(SHOTS, 'tb-phone-' + m + '.png'), clip: { x: 0, y: 0, width: 402, height: 360 } });
    }
    check(over.length === 0, '휴대폰 — 툴바 넘침 없음 ' + over.join(' '));
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    await browser.close();
  }
})();
