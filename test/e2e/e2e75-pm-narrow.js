// 📱 프로젝트 관리 하위 화면 · A/S 작은 창 — 휴대폰 폭 (v13.416)
//   이슈 · 수주대장 · A/S 표 → 카드 / A/S 상세 화면 가득 · 1열 / 칸반 위아래 / 카테고리 관리 카드 / 문서 폴더 칩 / 타임라인 이름 칸 / 넘침 없음
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  require('fs').mkdirSync(SHOT, { recursive: true });
  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var b;
  try {
    b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-p' + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(e.message); });
    p.on('dialog', function (d) { d.dismiss(); });
    await p.emulate({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!'); await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    var seed = await p.evaluate(async function () {
      var out = {}, ks = Object.keys(PROJ_PHASE), pids = [];
      for (var o = 0; o < 3; o++) await orderPut({ orderNo: 'SO-N-' + (300 + o), client: '코아비스 ' + o, title: '검사 장비 ' + o, amount: 120000000, orderDate: '2026-10-01' });
      for (var i = 0; i < 3; i++) { var pj = await projPut({ name: '좁은 폭 프로젝트 ' + (i + 1) + ' 설비 제작', orderNo: 'SO-N-' + (300 + i), status: 'active', currentPhase: ks[i], startDate: '2026-10-20', endDate: '2026-12-10', progress: 20, assignees: ['admin@t.com'] }); pids.push(pj.id); }
      for (var s = 0; s < 3; s++) await issuePut({ projectId: pids[s], title: '이슈 ' + (s + 1) + ' — 배선 수정 필요 (고객 요청 사항 반영)', status: 'open' });
      for (var a = 0; a < 3; a++) { var t = await asPut({ customerName: '코아비스 ' + a, customerContact: '홍길동 010-1234-5678', issueSummary: '장비마다 저항값이 다름, Calibration 필요 ' + a, status: 'received', priority: 'P2', serialNo: 'SN-0' + a }); if (!a) out.as = t.id; }
      return out;
    });
    async function view(m) { await p.evaluate(function (m) { setPage('project'); setMode(m); window.scrollTo(0, 0); }, m); await wait(1500); }
    function noOver() { return p.evaluate(function () { return document.documentElement.scrollWidth <= innerWidth; }); }
    function cards(sel) {
      return p.evaluate(function (sel) {
        var t = document.querySelector(sel); if (!t) return null;
        var tr = t.querySelector('tbody>tr'), r = tr.getBoundingClientRect(), th = t.querySelector('thead');
        return { disp: getComputedStyle(tr).display, w: r.width, h: r.height, head: th ? getComputedStyle(th).display : 'none', right: t.getBoundingClientRect().right };
      }, sel);
    }
    // 이슈
    await view('issues');
    var ic = await cards('#mIssues .is-tbl');
    var tt = await p.evaluate(function () { var td = document.querySelector('#mIssues .is-tbl td.c-title'); return td.getBoundingClientRect().width; });
    check(ic && ic.disp === 'flex' && ic.head === 'none' && ic.right <= 391 && tt > 200 && await noOver(), '이슈 — 카드 (제목 칸 ' + Math.round(tt) + 'px · 화면 안)');
    // 수주대장
    await view('orders');
    var oc = await cards('#mOrders .od-tbl');
    var nm = await p.evaluate(function () { return document.querySelector('#mOrders .od-tbl tbody>tr>td:nth-child(4)').getBoundingClientRect().width; });
    check(oc && oc.disp === 'flex' && oc.head === 'none' && oc.right <= 391 && nm > 180 && await noOver(), '수주대장 — 카드 (프로젝트명 ' + Math.round(nm) + 'px)');
    // A/S 목록 · 칸반
    await view('as');
    var ac = await cards('#mAs .as-tbl');
    check(ac && ac.disp === 'flex' && ac.right <= 391 && await noOver(), 'A/S 목록 — 카드');
    await p.evaluate(function () { asViewMode = 'kanban'; renderAS(); }); await wait(1200);
    var kb = await p.evaluate(function () { var k = document.querySelector('#mAs .as-kb'); return { dir: getComputedStyle(k).flexDirection, emptyH: (document.querySelector('#mAs .as-kb-lane.empty') || {}).offsetHeight || 0, sw: k.parentElement.scrollWidth - k.parentElement.clientWidth }; });
    check(kb.dir === 'column' && kb.emptyH < 60 && kb.sw <= 1, 'A/S 칸반 — 단계 위아래 · 빈 단계는 머리만 (' + kb.emptyH + 'px)');
    await p.evaluate(function () { asViewMode = 'all'; renderAS(); }); await wait(800);
    // A/S 상세
    await p.evaluate(function (id) { _asDetailTab = 'overview'; showASDetail(id); }, seed.as); await wait(1000);
    var ad = await p.evaluate(function () {
      var box = document.querySelector('#asDetailOverlay .asd'), r = box.getBoundingClientRect(), no = document.querySelector('#asDetailOverlay .asd-no').getBoundingClientRect();
      var g = Array.from(document.querySelectorAll('#asDetailOverlay .asd-b [style*="grid-template-columns:1fr 1fr"]')).map(function (e) { return getComputedStyle(e).gridTemplateColumns.split(' ').length; });
      var tabs = document.querySelector('#asDetailOverlay .asd-tabs');
      return { w: r.width, left: r.left, noH: no.height, cols: g, tabsScroll: tabs.scrollWidth > tabs.clientWidth };
    });
    check(ad.w >= 388 && ad.left <= 1, 'A/S 상세 — 화면 가득 (' + Math.round(ad.w) + 'px)');
    check(ad.noH < 24, '접수번호 한 줄 (' + Math.round(ad.noH) + 'px)');
    check(ad.cols.length && ad.cols.every(function (n) { return n === 1; }), '고객/장비 · 접수 정보 1열');
    check(ad.tabsScroll, '단계 탭 옆으로 밀기');
    await p.screenshot({ path: path.join(SHOT, 'e2e75-asd.png') });
    await p.evaluate(function () { document.getElementById('asDetailOverlay').remove(); });
    // 접수 창 — 2열 입력 → 1열
    await p.evaluate(function () { showASModal(); }); await wait(900);
    var fm = await p.evaluate(function () { var g = document.querySelector('.wa-modal-overlay [style*="grid-template-columns:1fr 1fr;"]'); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : -1; });
    check(fm === 1, 'A/S 접수 창 — 입력 칸 1열');
    await p.evaluate(function () { document.querySelectorAll('.wa-modal-overlay').forEach(function (e) { e.remove(); }); });
    // 카테고리 관리
    await p.evaluate(function () { showASCategoryAdmin(); }); await wait(1000);
    var cm = await p.evaluate(function () { var tr = document.querySelector('#asCatAdminOverlay .as-cat-tbl tbody>tr'), lab = tr.querySelector('input[type=text]'); return { disp: getComputedStyle(tr).display, lw: lab.getBoundingClientRect().width, right: document.querySelector('#asCatAdminOverlay .as-cat-tbl').getBoundingClientRect().right }; });
    check(cm.disp === 'flex' && cm.lw > 120 && cm.right <= 391, '카테고리 관리 — 카드 · 라벨 칸 ' + Math.round(cm.lw) + 'px');
    await p.evaluate(function () { document.getElementById('asCatAdminOverlay').remove(); });
    // 문서 — 폴더 칩
    await view('docs');
    var dc = await p.evaluate(function () { var f = document.querySelector('#mDocs .doc-ftree'); return f ? { h: f.offsetHeight, disp: getComputedStyle(f).display } : null; });
    check(dc && dc.disp === 'flex' && dc.h < 70 && await noOver(), '문서 — 폴더 한 줄 칩 (' + (dc && dc.h) + 'px)');
    // 타임라인 — 이름 칸 화면의 35% 안
    await view('timeline');
    var tl = await p.evaluate(function () { var l = document.querySelector('#mTimeline .tl-label'); return l ? l.getBoundingClientRect().width : 0; });
    check(tl > 0 && tl <= 390 * 0.36, '타임라인 — 이름 칸 ' + Math.round(tl) + 'px (막대 칸 넓게)');
    // 넓은 화면은 예전 표 그대로
    await p.setViewport({ width: 1400, height: 900 }); await view('issues');
    var wide = await p.evaluate(function () { return getComputedStyle(document.querySelector('#mIssues .is-tbl thead')).display; });
    check(wide === 'table-header-group', '넓은 화면 — 이슈는 표 그대로');
    check(!errs.length, '페이지 오류 없음' + (errs.length ? ' — ' + errs.join(' | ') : ''));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  if (b) await b.close();
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
