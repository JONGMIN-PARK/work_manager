// 화면 툴바 ② (v13.292) — 프로젝트 관리 화면: 공통 틀 · 주 버튼 하나 · 필터 펼침 창(배지 · 다시 그려도 열린 채 · 모두 지우기) · ⋯
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var SHOTS = path.join(__dirname, '.shots');
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.dismiss(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function ready() {
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
  }
  // 화면 툴바 요약 — 제목 · 주 버튼 수 · 끝 두 칸 · 보이는 조작 수 · 줄 수
  function tb(id) {
    return page.evaluate(function (id) {
      var bar = document.querySelector('#' + id + ' .wm-tb') || (id === 'mTimeline' && document.querySelector('#mTimeline .tl-tb'));
      if (!bar) return null;
      var row = id === 'mTimeline' ? document.getElementById('tlControls') : bar;
      var kids = Array.from(row.children).filter(function (e) { return e.offsetParent; });
      var tops = Array.from(bar.querySelectorAll('*')).filter(function (e) { return e.offsetParent && e.parentElement && (e.parentElement === bar || e.parentElement === row); })
        .map(function (e) { var r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); });
      var ctl = Array.from(bar.querySelectorAll('button, select, input')).filter(function (e) { return e.offsetParent && !e.closest('.hdr-pop-menu') && !e.closest('.wm-seg'); }).length +
        bar.querySelectorAll('.wm-seg').length;
      return { title: ((bar.querySelector('.wm-tb-t, .pnl-t') || {}).textContent || '').trim(), pri: bar.querySelectorAll('.wm-pri').length,
        last: kids.slice(-2).map(function (e) { return e.classList.contains('wm-flt') ? 'flt' : e.classList.contains('hdr-pop') ? 'more' : e.classList.contains('wm-pri') ? 'pri' : e.tagName; }).join(','),
        ctl: ctl, lines: new Set(tops.map(function (t) { return Math.round(t / 12); })).size };
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

    var screens = [['pipeline', 'mPipeline', '🔀 파이프라인', 'pri,more'], ['timeline', 'mTimeline', '📊 프로젝트 타임라인', 'pri,more'], ['orders', 'mOrders', '📋 수주 대장', 'pri,more'],
      ['issues', 'mIssues', '🎫 이슈', 'pri,more'], ['docs', 'mDocs', '📂 문서', null], ['as', 'mAs', '🛠️ A/S', 'pri,more'], ['prestudy', 'mPrestudy', '🔍 사전검토', null], ['tech', 'mTech', '🧪 요소기술', null]];
    for (var s of screens) {
      await page.evaluate(function (m) { setPage('project'); setMode(m); }, s[0]); await wait(1800);
      var t = await tb(s[1]);
      var good = t && t.title === s[2] && t.pri <= 1 && (!s[3] || t.last === s[3]) && t.lines <= 2;
      check(good, s[0] + ' 툴바 ' + JSON.stringify(t));
      await page.screenshot({ path: path.join(SHOTS, 'tb2-' + s[0] + '.png'), clip: { x: 0, y: 110, width: 1400, height: 200 } });
    }
    // 타임라인 — 밖에 보이는 조작이 줄어듦 (예전 24개)
    await page.evaluate(function () { setMode('timeline'); }); await wait(1500);
    var tl = await tb('mTimeline');
    check(tl.ctl <= 9 && tl.lines === 1, '타임라인 — 밖 조작 ' + tl.ctl + '개 · 한 줄');

    // 필터 창 — 타임라인: 상태를 바꿔 다시 그려도 열린 채 · 배지 · 모두 지우기
    await page.click('#tlFltWrap > button'); await wait(150);
    await page.select('#tlFilterStatus', 'done'); await wait(1200);
    var f1 = await page.evaluate(function () { var w = document.getElementById('tlFltWrap'); return { open: w.classList.contains('open'), n: (w.querySelector('.wm-flt-n') || {}).textContent, val: tlFilterStatus }; });
    check(f1.open && f1.n === '1' && f1.val === 'done', '타임라인 필터 — 바꿔도 열린 채 · 배지 1 ' + JSON.stringify(f1));
    await page.screenshot({ path: path.join(SHOTS, 'tb2-timeline-flt.png'), clip: { x: 300, y: 110, width: 1100, height: 400 } });
    await page.click('#tlFltWrap .hdr-mi'); await wait(1200);
    check(await page.evaluate(function () { return tlFilterStatus === 'all' && !document.querySelector('#tlFltWrap .wm-flt-n'); }), '필터 모두 지우기 → 배지 없음');
    await page.click('.hdr-brand h1'); await wait(200);
    check(await page.evaluate(function () { return !document.querySelector('.hdr-pop.open'); }), '바깥 누르면 필터 창 닫힘');
    // 보기 창 — 컴팩트 토글
    await page.click('#tlViewWrap > button'); await wait(150);
    var d0 = await page.evaluate(function () { return tlDensity; });
    await page.click('#tlDensityTog'); await wait(800);
    check(await page.evaluate(function (d0) { return tlDensity !== d0; }, d0), '⚙ 보기 — 컴팩트 바뀜');
    await page.click('#tlDensityTog'); await wait(600);
    await page.click('.hdr-brand h1'); await wait(200);

    // 이슈 — 필터 창(부서 · 유형 · 긴급도 · 프로젝트) · 밖에는 검색 · 상태 · 단계
    await page.evaluate(function () { setMode('issues'); }); await wait(1500);
    var out = await page.evaluate(function () { var bar = document.querySelector('#mIssues .wm-tb'); return { q: !!bar.querySelector('#issueQ'), sel: bar.querySelectorAll(':scope > select').length, inFlt: bar.querySelectorAll('#issueFltWrap select').length, oldBar: !!document.querySelector('#mIssues [onclick*="issueClearFilters"]:not(.hdr-mi)') }; });
    check(out.q && out.sel === 2 && out.inFlt === 4 && !out.oldBar, '이슈 — 밖 검색 · 상태 · 단계, 필터 창 4개 ' + JSON.stringify(out));
    await page.click('#issueFltWrap > button'); await wait(150);
    await page.evaluate(function () { var s = document.querySelector('#issueFltWrap select'); s.value = s.options[1].value; s.dispatchEvent(new Event('change')); }); await wait(1200);
    var f2 = await page.evaluate(function () { var w = document.getElementById('issueFltWrap'); return { open: w.classList.contains('open'), n: (w.querySelector('.wm-flt-n') || {}).textContent }; });
    check(f2.open && f2.n === '1', '이슈 필터 — 바꿔도 열린 채 · 배지 1 ' + JSON.stringify(f2));
    await page.click('#issueFltWrap .hdr-mi'); await wait(1200);
    check(await page.evaluate(function () { return !issueFilterDept && !document.querySelector('#issueFltWrap .wm-flt-n'); }), '이슈 필터 모두 지우기');
    await page.click('.hdr-brand h1'); await wait(200);
    // 검색칸 입력 — 다시 그려도 포커스 유지
    await page.click('#issueQ'); await page.keyboard.type('zz'); await wait(900);
    check(await page.evaluate(function () { return document.activeElement && document.activeElement.id === 'issueQ' && document.activeElement.value === 'zz'; }), '이슈 검색 — 입력 중 포커스 유지');
    await page.evaluate(function () { issueClearFilters(); }); await wait(600);
    // ⋯ — 통계 보기
    await page.waitForSelector('#issueMoreWrap > button', { visible: true }); await page.click('#issueMoreWrap > button'); await wait(200);
    await page.click('#issueMoreWrap .hdr-mi'); await wait(1200);
    check(await page.evaluate(function () { return issueShowStats === true; }), '이슈 ⋯ › 통계 보기');
    await page.evaluate(function () { issueToggleStats(); }); await wait(600);

    // A/S — 보기 전환 · 휴지통은 ⋯ · 통계 화면에도 같은 전환
    await page.evaluate(function () { setMode('as'); }); await wait(1500);
    await page.click('#mAs .wm-tb .wm-seg button:nth-child(4)'); await wait(1500);
    check(await page.evaluate(function () { return asViewMode === 'stats' && !!document.querySelector('#mAs .wm-seg button.on') && document.querySelector('#mAs .wm-seg button.on').textContent.indexOf('통계') >= 0; }), 'A/S → 통계 화면에도 보기 전환');
    await page.click('#mAs .wm-seg button:nth-child(1)'); await wait(1500);
    await page.waitForSelector('#asMoreWrap > button', { visible: true }); await page.click('#asMoreWrap > button'); await wait(200);
    await page.click('#asMoreWrap .hdr-mi'); await wait(1500);
    check(await page.evaluate(function () { return asViewMode === 'trash' && !!document.querySelector('#mAs .wm-tb-badge'); }), 'A/S ⋯ › 휴지통 · 보는 중 배지');
    await page.evaluate(function () { asViewMode = 'all'; renderAS(); }); await wait(800);

    // 요소기술 — 필터 창 체크박스
    await page.evaluate(function () { setMode('tech'); }); await wait(1200);
    await page.click('#techFltWrap > button'); await wait(150);
    await page.click('#techFltWrap input[type=checkbox]'); await wait(900);
    check(await page.evaluate(function () { var w = document.getElementById('techFltWrap'); return _techFilter.mine && w.classList.contains('open') && (w.querySelector('.wm-flt-n') || {}).textContent === '1'; }), '요소기술 — 내 담당 체크 · 열린 채 · 배지');
    await page.click('#techFltWrap .hdr-mi'); await wait(800);
    await page.click('.hdr-brand h1');
    // 사전검토 — 내 담당 토글
    await page.evaluate(function () { setMode('prestudy'); }); await wait(1200);
    await page.click('#mPrestudy .wm-tb .wm-seg:last-of-type button'); await wait(900);
    check(await page.evaluate(function () { return _psFilter.mine === true; }), '사전검토 — 👤 내 담당 토글');
    await page.evaluate(function () { psSetMine(false); }); await wait(500);

    // 휴대폰 — 화면 밖으로 안 나감
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true }); await wait(300); await ready();
    var over = [];
    for (var s2 of screens) {
      await page.evaluate(function (m) { setPage('project'); setMode(m); }, s2[0]); await wait(1500);
      var o = await page.evaluate(function (id) { var vw = document.documentElement.clientWidth; var bar = document.querySelector('#' + id + ' .wm-tb') || document.querySelector('#mTimeline .tl-tb'); return bar ? Array.from(bar.querySelectorAll('*')).filter(function (e) { var r = e.getBoundingClientRect(); return e.offsetParent && !e.closest('.hdr-pop-menu') && !e.closest('.wm-seg') && (r.right > vw + 1 || r.left < -1); }).length : -1; }, s2[1]);
      if (o) over.push(s2[0] + ':' + o);
    }
    check(over.length === 0, '휴대폰 — 툴바 넘침 없음 ' + over.join(' '));
    await page.evaluate(function () { setMode('issues'); }); await wait(1200);
    await page.screenshot({ path: path.join(SHOTS, 'tb2-phone-issues.png'), clip: { x: 0, y: 0, width: 402, height: 420 } });
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    await browser.close();
  }
})();
