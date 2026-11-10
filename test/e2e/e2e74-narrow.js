// 📱 작은 화면 (v13.415) — 프로젝트 파이프라인 위아래로 쌓기 · 높이는 카드 수만큼 / 마인드맵 편집기 머리 두 줄 · 자세히 창
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
    b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-n' + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(e.message); });
    var phone = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
    await p.emulate({ viewport: phone, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!'); await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);

    // ── 파이프라인 ──
    await p.evaluate(async function () {
      var ks = Object.keys(PROJ_PHASE);
      for (var i = 0; i < 7; i++) await projPut({ name: '좁은 화면 프로젝트 ' + (i + 1), status: 'active', currentPhase: ks[[0, 0, 0, 0, 1, 1, 3][i]], startDate: '2026-11-01', endDate: '2026-12-20', progress: i * 10, assignees: ['admin@t.com'] });
    });
    await p.evaluate(function () { setPage('project'); setMode('pipeline'); });
    await p.waitForSelector('#pipelineWrap .pipeline-lane', { timeout: 20000 });
    await wait(600);
    var pm = await p.evaluate(function () {
      var bd = document.querySelector('.pipeline-board'), ks = Object.keys(PROJ_PHASE);
      var h = function (k) { var l = bd.querySelector('.pipeline-lane[data-phase="' + k + '"]'); return l ? l.offsetHeight : 0; };
      var n = function (k) { return bd.querySelectorAll('.pipeline-lane[data-phase="' + k + '"] .pipeline-card').length; };
      var empty = ks.filter(function (k) { return !n(k); })[0];
      return { dir: getComputedStyle(bd).flexDirection, docW: document.documentElement.scrollWidth, vw: innerWidth, sw: bd.scrollWidth - bd.clientWidth,
        h0: h(ks[0]), n0: n(ks[0]), h1: h(ks[1]), n1: n(ks[1]), hE: empty ? h(empty) : 0, tabs: !!document.getElementById('pipeTabs').offsetParent };
    });
    check(pm.dir === 'column' && pm.sw <= 1 && pm.docW === pm.vw, '파이프라인 390px — 단계 칸을 위아래로 (가로로 넘치지 않음)');
    check(pm.n0 > pm.n1 && pm.h0 > pm.h1 + 40, '칸 높이는 카드 수만큼 (' + pm.n0 + '장 ' + pm.h0 + 'px · ' + pm.n1 + '장 ' + pm.h1 + 'px)');
    check(pm.hE > 0 && pm.hE < 56, '빈 단계는 머리 한 줄 (' + pm.hE + 'px)');
    check(pm.tabs, '단계 탭 줄 보임');
    var k3 = await p.evaluate(function () { return Object.keys(PROJ_PHASE)[3]; });
    await p.click('#pipeTabs .pipe-tab[data-phase="' + k3 + '"]');
    await wait(900);
    var go = await p.evaluate(function (k) {
      var l = document.querySelector('.pipeline-lane[data-phase="' + k + '"]').getBoundingClientRect(), t = document.getElementById('pipeTabs').getBoundingClientRect();
      var se = document.scrollingElement, end = se.scrollTop + innerHeight >= se.scrollHeight - 2;   // 아래 칸이 짧아 더 못 내려가면 맨 아래에서 멈춤
      return { d: l.top - t.bottom, end: end, on: document.querySelector('#pipeTabs .pipe-tab.on').dataset.phase === k };
    }, k3);
    check(go.on && go.d > -2 && (go.d < 30 || go.end), '탭 누르면 그 단계로 내려감 · 탭에 불 (탭 줄 아래 ' + Math.round(go.d) + 'px' + (go.end ? ' · 맨 아래' : '') + ')');
    await p.evaluate(function () { window.scrollTo(0, 0); var s = document.scrollingElement; s.scrollTop = 0; });
    await wait(500);
    await p.screenshot({ path: path.join(SHOT, 'e2e74-pipe-390.png'), fullPage: true });
    // 넓은 화면은 예전 그대로 (가로로 단계 칸)
    await p.setViewport({ width: 1500, height: 900 }); await wait(600);
    var wide = await p.evaluate(function () { var bd = document.querySelector('.pipeline-board'); return { disp: getComputedStyle(bd).display, tabs: !!document.getElementById('pipeTabs').offsetParent }; });
    check(wide.disp === 'grid' && !wide.tabs, '넓은 화면 — 단계 칸 가로 격자 그대로 · 탭 줄 없음');

    // ── 마인드맵 편집기 ──
    var id = await p.evaluate(function () {
      var t = MM_TEMPLATES.filter(function (x) { return x.k === 'meeting'; })[0];
      var root = _mmBuildTree(t.ex('작은 화면 맵')); root.id = 'n-root';
      return apiFetch('/api/mindmaps', { method: 'POST', body: JSON.stringify({ title: '작은 화면 맵', scope: 'personal', template: 'meeting', doc: { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: root, relations: [] }] } }) }).then(function (r) { return r.data.id; });
    });
    await p.evaluate(function () { setPage('mindmap'); });
    await wait(800);
    var wideTop = await p.evaluate(function (i) { mmOpen(i); return new Promise(function (r) { setTimeout(function () { r({ h: document.querySelector('.mm-top').offsetHeight, c: getComputedStyle(document.querySelector('.mm-top2')).display, nb: !!document.getElementById('mmPanelBtn').offsetParent }); }, 1500); }); }, id);
    check(wideTop.c === 'contents' && !wideTop.nb && wideTop.h < 80, '넓은 화면 — 편집기 머리 한 줄 그대로 (' + wideTop.h + 'px) · 자세히 단추 없음');
    await p.setViewport(phone); await wait(500);
    await p.evaluate(function (i) { mmOpen(i); }, id); await wait(1500);
    await p.evaluate(function () { var v = document.querySelector('[data-act=view-map]'); v && v.click(); }); await wait(700);
    var mm = await p.evaluate(function () {
      var t2 = document.querySelector('.mm-top2');
      return { top: document.querySelector('.mm-top').offsetHeight, t2h: t2.offsetHeight, t2scroll: t2.scrollWidth > t2.clientWidth, docW: document.documentElement.scrollWidth, vw: innerWidth,
        tools: document.querySelector('.mm-tools').offsetHeight, ph: document.querySelector('.mm-search').placeholder };
    });
    check(mm.top <= 110 && mm.t2h <= 40 && mm.docW === mm.vw, '휴대폰 — 편집기 머리 두 줄 (' + mm.top + 'px) · 둘째 줄 한 줄(' + mm.t2h + 'px) · 화면 밖으로 안 넘침');
    check(mm.t2scroll, '둘째 줄은 옆으로 밀어 나머지 도구');
    check(mm.tools <= 44, '도구 줄 얇게 — 아이콘만 (' + mm.tools + 'px)');
    check(!/Ctrl/.test(mm.ph), '손가락 기기 — 찾기 칸에 Ctrl+F 안내 없음');
    await p.evaluate(function () { var bt = document.querySelector('.mm-top2 [data-menu=mmExportMenu]'); bt.scrollIntoView({ inline: 'end' }); bt.click(); });
    await wait(300);
    var me = await p.evaluate(function () { var m = document.getElementById('mmExportMenu'), r = m.getBoundingClientRect(); return { pos: getComputedStyle(m).position, l: r.left, r: r.right, h: r.height }; });
    check(me.pos === 'fixed' && me.h > 60 && me.l >= 0 && me.r <= 390, '둘째 줄 펼침 메뉴 — 잘리지 않고 화면 안');
    await p.evaluate(function () { document.getElementById('mmExportMenu').classList.add('hidden'); });
    await p.evaluate(function () { var bt = document.getElementById('mmPanelBtn'); bt.scrollIntoView({ inline: 'end' }); bt.click(); });
    await wait(400);
    var ps = await p.evaluate(function () { var pn = document.getElementById('mmPanel'), r = pn.getBoundingClientRect(), x = document.querySelector('.mm-ps-x'); return { vis: getComputedStyle(pn).display !== 'none' && r.height > 150, w: r.width, x: !!x.offsetParent }; });
    check(ps.vis && ps.w > 340 && ps.x, '[✎ 자세히] → 아래에서 올라오는 창 · 닫기 단추');
    await p.screenshot({ path: path.join(SHOT, 'e2e74-mm-390.png') });
    await p.click('.mm-ps-x'); await wait(200);
    check(await p.evaluate(function () { return getComputedStyle(document.getElementById('mmPanel')).display === 'none' && !document.getElementById('mmEd').classList.contains('mm-psheet'); }), '닫기 → 창 닫힘');
    // v13.418 맵 · 간트 — 휴대폰
    await p.evaluate(function () { document.querySelector('[data-act=view-map]').click(); }); await wait(600);
    await p.evaluate(function (i) { mmOpen(i); }, id); await wait(1500);
    await p.evaluate(function () { var v = document.querySelector('[data-act=view-map]'); v && v.click(); _mmFit(); }); await wait(300);
    var z0 = await p.evaluate(function () { return _mm.zoom; });
    await p.evaluate(function () { document.querySelector('.mm-zoom [data-act=fit]').click(); }); await wait(300);
    var z1 = await p.evaluate(function () { return _mm.zoom; });
    check(z0 >= 0.6 && z1 < z0, '맵 — 처음엔 읽을 수 있는 크기(' + Math.round(z0 * 100) + '%) · [화면 맞춤]은 전체(' + Math.round(z1 * 100) + '%)');
    await p.evaluate(function () {
      var r = _mmRoot(), d = 0;
      (function walk(n) { (n.children || []).forEach(function (c) { d++; c.startDate = _mmgStr(_mmgToday() - 3 + d); c.dueDate = _mmgStr(_mmgToday() + 2 + d); walk(c); }); })(r);
      document.querySelector('[data-act=view-gantt]').click();
    });
    await wait(1200);
    var gt = await p.evaluate(function () {
      var l = document.querySelector('.mm-gt-l'), td = document.querySelector('.mm-gt-today'), sc = document.getElementById('mmGtScroll');
      var tr = td.getBoundingClientRect(), sr = sc.getBoundingClientRect(), bar = document.querySelector('.mm-gt-bar');
      return { lw: l.getBoundingClientRect().width, todayIn: tr.left > sr.left + l.getBoundingClientRect().width && tr.left < sr.right, barH: bar.offsetHeight };
    });
    check(gt.lw <= 160 && gt.todayIn, '간트 — 작업 칸 ' + Math.round(gt.lw) + 'px · 오늘 선이 화면 안');
    check(gt.barH <= 48, '간트 위 띠 한 줄 (' + gt.barH + 'px)');
    await p.screenshot({ path: path.join(SHOT, 'e2e74-gantt-390.png') });
    check(!errs.length, '페이지 오류 없음' + (errs.length ? ' — ' + errs.join(' | ') : ''));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  if (b) await b.close();
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
