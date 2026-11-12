// 업무일지 › 주간 분석 › 📊 분석 확장 (v13.459) — 👥 개인 KPI · 🎯 사분면 · 🧭 업무 방향(기울기 · 한눈에 문장) · 🎯 선택 강조(하나 · Ctrl 여러 개 · Esc · 만 보기 · 분장) · 정렬 · 권한
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  try {
    var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
    await c.query("DELETE FROM work_records WHERE content LIKE 'E2E분석K%'");
    var vals = [];
    function put(d, n, no, h, ab, cl, nm, long) { vals.push([d, n, no, h, ab, '업무', long === false ? 'E2E분석K' : 'E2E분석K 긴 내용 작업 기록', cl, nm]); }
    // 8주(07/27 ~ 09/18) — K1 개발(성장)이 주마다 늘고 공통(운영)이 줆 · K2 수주 4h + CS 4h 그대로 · K3 양산 5h (이번 주 앞 이틀은 10h · 내용 짧음)
    var d0 = Date.UTC(2026, 6, 27);
    for (var wk = 0; wk < 8; wk++) for (var dd = 0; dd < 5; dd++) {
      var ds = new Date(d0 + (wk * 7 + dd) * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
      var dh = 2 + wk * 0.75;
      put(ds, '분석K1', 'EK-1', dh, 'D', 'K전자', '검사기'); put(ds, '분석K1', '공통', 8 - dh, 'G', '', '');
      put(ds, '분석K2', 'EK-2', 4, 'B', 'K전자', '설비 수주'); put(ds, '분석K2', 'EK-3', 4, 'A', 'L산업', 'CS');
      put(ds, '분석K3', 'EK-4', wk === 7 && dd < 2 ? 10 : 5, 'M', 'L산업', '양산', false);
    }
    for (var i = 0; i < vals.length; i++) await c.query("INSERT INTO work_records (date, name, order_no, hours, abbr, task_type, content, oclient, ocmt, user_id, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", vals[i].concat([adm.id, adm.tenant_id]));

    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading') && aD.length > 0; }, { timeout: 60000 });
    await page.evaluate(function () { WA.sel = []; WA.kSort = null; WA.dN = 12; WA.sy = 'ord'; setPage('team'); setMode('weekly'); deAll(); ['분석K1', '분석K2', '분석K3'].forEach(function (n) { togN(aN.indexOf(n)); }); });
    await wait(600);
    await page.evaluate(function () { document.getElementById('dateRangeFrom').value = '2026-09-14'; document.getElementById('dateRangeTo').value = '2026-09-18'; pickDateRange(); sTab('cht'); });
    await page.waitForSelector('#waKpiC', { timeout: 8000 });

    // 👥 개인 KPI
    var k = await page.evaluate(function () {
      var rows = {}; document.querySelectorAll('#waKpiC tbody tr').forEach(function (tr) {
        var o = {}; var ths = document.querySelectorAll('#waKpiC thead tr:last-child th');
        tr.querySelectorAll('td').forEach(function (td, i) { o[ths[i].textContent.replace(/[↑↓]/g, '').trim()] = td.textContent.trim(); });
        rows[o['이름']] = o;
      });
      return { rows: rows, foot: document.querySelector('#waKpiC tfoot td').textContent, n: document.querySelectorAll('#waKpiC tbody tr').length };
    });
    check(k.n === 3 && /팀 중앙값/.test(k.foot), '개인 KPI 3명 + 팀 중앙값 줄 ' + k.n);
    check(k.rows['분석K3'] && /▲\s*40%/.test(k.rows['분석K3']['초과일']), 'K3 초과일 40% ▲ (살펴볼 쪽) ' + JSON.stringify(k.rows['분석K3']));
    check(k.rows['분석K3'] && k.rows['분석K3']['짧은 내용'] === '▲100%' && k.rows['분석K1']['짧은 내용'] === '0%', '짧은 내용 — K3 100% ▲ · K1 0%');
    check(k.rows['분석K2'] && /▲\s*2$/.test(k.rows['분석K2']['하루 수주 수']) && /^▼\s*9[01]%$/.test(k.rows['분석K1']['수주 투입률']), '하루 수주 수 K2 2 · 수주 투입률 K1 약 90% ▼(중앙값보다 낮음) ' + JSON.stringify([k.rows['분석K2']['하루 수주 수'], k.rows['분석K1']['수주 투입률']]));
    check(/성장\s*↑|운영\s*↓/.test(k.rows['분석K1']['방향']) && k.rows['분석K2']['방향'] === '–', '방향 열 — K1 성장 ↑ 또는 운영 ↓ · K2 – ' + k.rows['분석K1']['방향']);
    var tip = await page.evaluate(function () { var td = [].filter.call(document.querySelectorAll('#waKpiC tbody tr[data-wa-sel="p:분석K3"] td'), function (t) { return /▲/.test(t.textContent); })[0]; return td && td.dataset.tip; });
    check(tip && /팀 중앙값/.test(tip), '칸 말풍선 — 중앙값과 차이 ' + tip);
    // 정렬
    await page.click('#waKpiC th[data-wak-sort="avg"]'); await wait(150);
    var ord1 = await page.evaluate(function () { return [].map.call(document.querySelectorAll('#waKpiC tbody tr'), function (t) { return t.getAttribute('data-wa-sel'); }).join(','); });
    await page.click('#waKpiC th[data-wak-sort="avg"]'); await wait(150);
    var ord2 = await page.evaluate(function () { return [].map.call(document.querySelectorAll('#waKpiC tbody tr'), function (t) { return t.getAttribute('data-wa-sel'); }).join(','); });
    check(ord1 !== ord2 && ord1.split(',').reverse().join(',') === ord2, '열 눌러 정렬 · 다시 누르면 반대 ' + ord1 + ' / ' + ord2);

    // 🧭 업무 방향 · 한눈에
    var d = await page.evaluate(function () {
      return { sls: [].map.call(document.querySelectorAll('#waDirC .wad-sl'), function (s) { return s.className + '|' + s.textContent; }), bands: document.querySelectorAll('#waDirC path.wad-band').length,
        find: [].map.call(document.querySelectorAll('#waFindC li'), function (l) { return l.textContent; }), hits: document.querySelectorAll('#waDirC .wa-hit').length };
    });
    check(d.sls.some(function (s) { return /mv/.test(s) && /성장.*↑/.test(s); }) && d.sls.some(function (s) { return /mv/.test(s) && /운영.*↓/.test(s); }), '기울기 — 성장 ↑ · 운영 ↓ ' + JSON.stringify(d.sls));
    check(d.bands === 4 && d.hits >= 8, '100% 쌓은 영역 4갈래 · 주마다 말풍선 ' + d.bands + ' · ' + d.hits);
    check(d.find.some(function (f) { return /방향: 성장\(개발 · 제안\) 비중 주마다 \+/.test(f); }) && d.find.some(function (f) { return /분석K1 — (성장|운영)/.test(f); }), '한눈에 — 팀 방향 · 사람 방향 문장 ' + JSON.stringify(d.find));
    await page.click('#waDirC [data-wad-n="8"]'); await wait(200);
    var n8 = await page.evaluate(function () { return [WA.dN, document.querySelectorAll('#waDirC .wa-hit').length, document.querySelector('#waDirC [data-wad-n="8"]').classList.contains('on')]; });
    check(n8[0] === 8 && n8[1] === 8 && n8[2], '8주로 바꾸기 ' + JSON.stringify(n8));

    // 🎯 사분면
    var q = await page.evaluate(function () { return { pts: document.querySelectorAll('#waSctC .waq-pt').length, med: document.querySelectorAll('#waSctC .waq-med').length }; });
    check(q.pts === 3 && q.med === 2, '사분면 — 점 3 · 중앙값 선 2 ' + JSON.stringify(q));
    await page.click('#waSctC [data-waq-y="frag"]'); await wait(150);
    check(await page.evaluate(function () { return WA.sy === 'frag' && /하루 수주 수/.test(document.querySelector('#waSctC .wa-sub').textContent); }), '세로축 하루 수주 수로');

    // 🎯 선택 강조 — 줄 누르기
    await page.click('#waKpiC tbody tr[data-wa-sel="p:분석K1"] td.wak-nm'); await wait(250);
    var s1 = await page.evaluate(function () {
      return { sel: WA.sel, chip: document.querySelectorAll('#waSelBar .wa-chip').length, offP: document.querySelectorAll('#waPplC .wa-pr.wa-off').length, onP: document.querySelectorAll('#waPplC .wa-pr.wa-on').length,
        dot: !!document.querySelector('#waSctC .waq-pt.wa-on'), selc: document.querySelectorAll('#waMixC .wa-selc').length, ln: !!document.querySelector('#waDayC .wa-selln'), bsel: document.querySelectorAll('#waTopC .wa-bsel').length,
        mini: [].map.call(document.querySelectorAll('#waDirC .wad-sm-t'), function (t) { return t.textContent; }), first: document.querySelector('#waFindC li').textContent, fsel: document.querySelector('#waFindC li').className };
    });
    check(s1.sel.join() === 'p:분석K1' && s1.chip === 1, '줄 누르면 그 사람 강조 · 칩 ' + JSON.stringify(s1.sel));
    check(s1.onP === 1 && s1.offP === 2 && s1.dot, '사람별 부하 · 사분면도 같이 강조(나머지 흐림)');
    check(s1.selc > 1 && s1.ln && s1.bsel >= 1, '시간 구성 선택 열 · 날짜별 선 · 업체 막대 안 몫 ' + JSON.stringify([s1.selc, s1.ln, s1.bsel]));
    check(s1.mini.length === 2 && /분석K1/.test(s1.mini[1]), '업무 방향 — 고른 사람 그래프 ' + JSON.stringify(s1.mini));
    check(/분석K1/.test(s1.first) && s1.fsel === 'wa-fsel', '한눈에 — 고른 사람 이야기 맨 위 ' + s1.first);
    // Ctrl+누르기 = 여러 개
    await page.keyboard.down('Control'); await page.click('#waPplC .wa-pr[data-wa-sel="p:분석K2"]'); await page.keyboard.up('Control'); await wait(250);
    check(await page.evaluate(function () { return WA.sel.join() === 'p:분석K1,p:분석K2' && document.querySelectorAll('#waSelBar .wa-chip').length === 2 && document.querySelectorAll('#waKpiC tbody tr.wa-on').length === 2; }), 'Ctrl+누르기 — 두 사람');
    // 기억 → 다시 그려도 유지
    await page.evaluate(function () { rCht(); }); await wait(200);
    check(await page.evaluate(function () { return document.querySelectorAll('#waKpiC tbody tr.wa-on').length === 2 && JSON.parse(localStorage.getItem('wm-wa')).sel.length === 2; }), '다시 그려도 · 저장해도 유지');
    // Esc
    await page.keyboard.press('Escape'); await wait(200);
    check(await page.evaluate(function () { return !WA.sel.length && !document.querySelector('#waBox .wa-off') && !document.querySelector('#waSelBar .wa-chip'); }), 'Esc — 모두 풀기');
    // 분장 고르기 — 사람 줄은 흐려지지 않음
    await page.click('#waMixC tbody tr[data-wa-sel="ab:D"]'); await wait(200);
    var s2 = await page.evaluate(function () { return { sel: WA.sel, mixOff: document.querySelectorAll('#waMixC tr.wa-off').length, pOff: document.querySelectorAll('#waPplC .wa-off').length, lgOn: !!document.querySelector('#waDayC .wa-lgk.wa-on') }; });
    check(s2.sel.join() === 'ab:D' && s2.mixOff >= 3 && s2.pOff === 0 && s2.lgOn, '분장 고르기 — 같은 종류만 흐림 · 날짜별 범례도 ' + JSON.stringify(s2));
    await page.click('#waMixC tbody tr[data-wa-sel="ab:D"]'); await wait(150);
    check(await page.evaluate(function () { return !WA.sel.length; }), '다시 누르면 풀림');
    // 키보드 — Enter
    await page.focus('#waKpiC tbody tr[data-wa-sel="p:분석K3"]'); await page.keyboard.press('Enter'); await wait(200);
    check(await page.evaluate(function () { return WA.sel.join() === 'p:분석K3'; }), '키보드 Enter 로 고르기');
    // 만 보기 — 위 팀원 필터가 그 사람만
    await page.click('#waSelBar [data-ws-only]'); await wait(800);
    check(await page.evaluate(function () { return sN.size === 1 && sN.has('분석K3'); }), '「만 보기」 — 팀원 필터를 그 사람만으로');
    await page.evaluate(function () { deAll(); ['분석K1', '분석K2', '분석K3'].forEach(function (n) { togN(aN.indexOf(n)); }); WA.sel = []; _waSave(); }); await wait(600);

    // 권한 — 팀원은 본인 줄만 · 사분면 없음 · 사람별 방향 문장 없음
    var mem = await page.evaluate(function () {
      var bak = { role: currentUser.role, name: currentUser.name, dn: currentUser.display_name };
      currentUser.role = 'member'; currentUser.name = '분석K2'; currentUser.display_name = '';
      rCht();
      var r = { rows: [].map.call(document.querySelectorAll('#waKpiC tbody tr'), function (t) { return t.getAttribute('data-wa-sel'); }), foot: !!document.querySelector('#waKpiC tfoot'), sct: !!document.getElementById('waSctC'), dir: !!document.getElementById('waDirC'),
        pfind: [].some.call(document.querySelectorAll('#waFindC li'), function (l) { return /분석K1 — /.test(l.textContent); }) };
      currentUser.role = bak.role; currentUser.name = bak.name; currentUser.display_name = bak.dn; rCht();
      return r;
    });
    check(mem.rows.join() === 'p:분석K2' && mem.foot && !mem.sct && mem.dir && !mem.pfind, '팀원 — 본인 줄 + 중앙값 · 사분면 없음 · 사람 방향 문장 없음 ' + JSON.stringify(mem));

    // 휴대폰 — 넘침 없음
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true }); await wait(700);
    await page.evaluate(function () { rCht(); }); await wait(300);
    var mob = await page.evaluate(function () {
      var wide = [].filter.call(document.querySelectorAll('#waBox *'), function (e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.right > 404 && !e.closest('.wa-tw,.wa-chart'); }).slice(0, 5).map(function (e) { return String(e.className && e.className.baseVal != null ? e.className.baseVal : e.className); });
      return { sw: document.documentElement.scrollWidth, wide: wide };
    });
    check(mob.sw <= 404 && !mob.wide.length, '휴대폰 — 넘침 없음 ' + JSON.stringify(mob));
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  finally {
    try { await c.query("DELETE FROM work_records WHERE content LIKE 'E2E분석K%'"); } catch (e) {}
    await c.end(); await browser.close();
  }
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
