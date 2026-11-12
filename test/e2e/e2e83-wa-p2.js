// 업무일지 › 주간 분석 › 📊 분석 2단계 (v13.460) — 👤 자세히 · 🎯 목표 구성 대비(저장 · 실제로 채우기 · 권한) · 🧷 한 사람 의존 · 🔀 업체 이동 · 한눈에 문장
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
    await c.query("DELETE FROM work_records WHERE content LIKE 'E2E분석P%'");
    await c.query('DELETE FROM wa_targets WHERE tenant_id = $1', [adm.tenant_id]);
    var vals = [];
    function put(d, n, no, h, ab, cl, nm) { vals.push([d, n, no, h, ab, '업무', 'E2E분석P 긴 내용 작업 기록', cl, nm]); }
    // 12주(06/29 ~ 09/18)
    //   P1 개발(EK-1 · K전자) 2h → 7.5h 로 늘고 공통이 줆
    //   P2 앞 6주 수주 EK-2(K전자) 5h · 뒤 6주 EK-5(M기계 — 새 업체) 5h + CS EK-3(L산업) 3h 그대로 → 주력 업체 K전자 → M기계
    //   P3 양산 EK-4(L산업) 5h — 혼자
    var d0 = Date.UTC(2026, 5, 29);
    for (var wk = 0; wk < 12; wk++) for (var dd = 0; dd < 5; dd++) {
      var ds = new Date(d0 + (wk * 7 + dd) * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
      var dh = 2 + wk * 0.5;
      put(ds, '분석P1', 'EK-1', dh, 'D', 'K전자', '검사기'); put(ds, '분석P1', '공통', 8 - dh, 'G', '', '');
      if (wk < 6) put(ds, '분석P2', 'EK-2', 5, 'B', 'K전자', '설비 수주'); else put(ds, '분석P2', 'EK-5', 5, 'B', 'M기계', '새 설비');
      put(ds, '분석P2', 'EK-3', 3, 'A', 'L산업', 'CS');
      put(ds, '분석P3', 'EK-4', 5, 'M', 'L산업', '양산');
    }
    for (var i = 0; i < vals.length; i++) await c.query("INSERT INTO work_records (date, name, order_no, hours, abbr, task_type, content, oclient, ocmt, user_id, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", vals[i].concat([adm.id, adm.tenant_id]));

    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading') && aD.length > 0; }, { timeout: 60000 });
    await page.evaluate(function () { WA.sel = []; WA.kSort = null; WA.dN = 12; WA.sy = 'ord'; setPage('team'); setMode('weekly'); deAll(); ['분석P1', '분석P2', '분석P3'].forEach(function (n) { togN(aN.indexOf(n)); }); });
    await wait(600);
    await page.evaluate(function () { document.getElementById('dateRangeFrom').value = '2026-09-14'; document.getElementById('dateRangeTo').value = '2026-09-18'; pickDateRange(); sTab('cht'); });
    await page.waitForSelector('#waTgtC', { timeout: 8000 });
    await page.waitForFunction(function () { return WAT.rows != null; }, { timeout: 8000 });

    // 🧷 한 사람 의존
    var r = await page.evaluate(function () {
      return { rows: [].map.call(document.querySelectorAll('#waRiskC tbody tr'), function (t) { return t.getAttribute('data-wa-sel') + '|' + t.textContent; }), chips: document.querySelectorAll('#waRiskC .war-sum .war-pc').length };
    });
    var has = function (k) { return r.rows.filter(function (x) { return x.indexOf(k + '|') === 0; })[0] || ''; };
    check(/혼자/.test(has('ord:EK-4')) && /분석P3/.test(has('ord:EK-4')), '의존 — EK-4 분석P3 혼자 ' + has('ord:EK-4'));
    check(has('cl:M기계') && !has('cl:K전자') && !has('cl:L산업'), '의존 — 업체 M기계(P2 혼자)만 · K전자 · L산업은 나눠 함 ' + JSON.stringify(r.rows.map(function (x) { return x.split('|')[0]; })));
    check(r.chips === 3, '의존 — 사람마다 요약 칩 3 ' + r.chips);

    // 🔀 업체 이동
    var m = await page.evaluate(function () {
      return { tiles: [].map.call(document.querySelectorAll('#waMovC .wa-t'), function (t) { return t.textContent; }),
        cl: [].map.call(document.querySelectorAll('#waMovC .wav-tbl tbody tr'), function (t) { return t.getAttribute('data-wa-sel') + '|' + t.textContent; }),
        pp: [].map.call(document.querySelectorAll('#waMovC .wav-ptbl tbody tr'), function (t) { return t.getAttribute('data-wa-sel') + '|' + t.textContent; }),
        longs: document.querySelector('#waMovC .wap-mv') ? document.querySelector('#waMovC .wap-mv').textContent : '' };
    });
    check(/주력 업체L산업앞: K전자/.test(m.tiles[0]) && /새 업체 비중\s*24%/.test(m.tiles[1]) && /오래 붙잡힌 수주\s*68%3개/.test(m.tiles[2]), '업체 이동 숫자 — 주력 K전자 → L산업 · 새 업체 24% · 오래 붙잡힌 수주 3개 ' + JSON.stringify(m.tiles));
    var mk = m.cl.filter(function (x) { return x.indexOf('cl:M기계|') === 0; })[0] || '';
    check(/새로/.test(mk) && /\+24%p/.test(mk), '업체 표 — M기계 새로 +24%p ' + mk);
    var p2 = m.pp.filter(function (x) { return x.indexOf('p:분석P2|') === 0; })[0] || '';
    check(/K전자 → M기계/.test(p2) && /63%/.test(p2) && m.pp[0].indexOf('p:분석P2|') === 0, '사람마다 — P2 주력 K전자 → M기계 · 새 업체 63% · 맨 위 ' + JSON.stringify(m.pp));
    check(/검사기|EK-1/.test(m.longs) && /12주/.test(m.longs), '오래 붙잡힌 수주 이름 ' + m.longs);

    // 🔎 한눈에
    var f = await page.evaluate(function () { return [].map.call(document.querySelectorAll('#waFindC li'), function (l) { return l.textContent; }); });
    check(f.some(function (x) { return /한 사람 의존: 수주 \d개 · 업체 1곳/.test(x); }) && f.some(function (x) { return /업체 이동\(최근 6주\): 주력 업체 K전자 → L산업 \(38%\) · 새 업체 비중 24%/.test(x); }), '한눈에 — 의존 · 주력 업체 · 새 업체 ' + JSON.stringify(f));

    // 👤 자세히 — 한 사람만 고르면
    check(await page.evaluate(function () { var e = document.getElementById('waPerC'); return e && e.hidden; }), '아무도 안 고르면 자세히 숨김');
    await page.click('#waKpiC tbody tr[data-wa-sel="p:분석P1"] td.wak-nm'); await wait(300);
    var p = await page.evaluate(function () {
      var e = document.getElementById('waPerC');
      return { hidden: e.hidden, title: e.querySelector('h4').textContent, tiles: e.querySelectorAll('.wa-t').length, lines: e.querySelectorAll('.wap-ln').length, meds: e.querySelectorAll('.wap-med').length,
        bars: e.querySelectorAll('.wap-br').length, chg: (e.querySelector('.wap-chg') || {}).textContent, mv: [].map.call(e.querySelectorAll('.wap-mv'), function (x) { return x.textContent; }),
        hits: e.querySelectorAll('.wa-hit').length, end: [].map.call(e.querySelectorAll('.wap-end'), function (x) { return x.textContent; }), abD: _waAbName('D') };
    });
    check(!p.hidden && /분석P1/.test(p.title) && p.tiles === 4, '자세히 — P1 · 숫자 4개 ' + p.title);
    check(p.lines === 3 && p.meds === 3 && p.hits === 36, '작은 추이 3개 · 팀 중앙값 점선 · 주마다 말풍선 ' + JSON.stringify([p.lines, p.meds, p.hits]));
    check(p.end[1] === '94%', '수주 투입률 마지막 주 94% (7.5 / 8) ' + JSON.stringify(p.end));
    check(p.bars === 2 && p.chg.indexOf(p.abD + ' +') >= 0, '분장 구성 앞 · 최근 막대 + 바뀐 분장 ' + p.chg);
    check(p.mv.some(function (x) { return /주력 수주\s*검사기 그대로/.test(x); }), '주력 수주 그대로 ' + JSON.stringify(p.mv));
    // 두 사람 고르면 숨김 · 닫기 단추
    await page.keyboard.down('Control'); await page.click('#waPplC .wa-pr[data-wa-sel="p:분석P2"]'); await page.keyboard.up('Control'); await wait(250);
    check(await page.evaluate(function () { return document.getElementById('waPerC').hidden; }), '두 사람 고르면 자세히 숨김');
    await page.click('#waPplC .wa-pr[data-wa-sel="p:분석P2"]'); await wait(250);
    var p2t = await page.evaluate(function () { return document.querySelector('#waPerC h4').textContent + '|' + [].map.call(document.querySelectorAll('#waPerC .wap-mv'), function (x) { return x.textContent; }).join('/'); });
    check(/분석P2/.test(p2t) && /주력 업체\s*K전자.*→ M기계/.test(p2t), 'P2 자세히 — 주력 업체 K전자 → M기계 ' + p2t);
    await page.click('#waPerC .wap-x'); await wait(200);
    check(await page.evaluate(function () { return !WA.sel.length && document.getElementById('waPerC').hidden; }), '✕ 로 닫기 = 강조 풀기');

    // 🎯 목표 — 아직 없음 → 사람 목표 저장
    check(await page.evaluate(function () { return /아직 목표가 없습니다/.test(document.getElementById('waTgtC').textContent); }), '목표 없음 안내');
    await page.click('#waTgtC [data-wat-ed]'); await wait(200);
    await page.select('#watEd select', 'person:분석P1'); await wait(200);
    await page.evaluate(function () { var s = function (k, v) { var i = document.querySelector('#watEd [data-wat-k="' + k + '"]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; s('D', '90'); s('G', '20'); });
    check(await page.evaluate(function () { return document.getElementById('watSum').textContent === '합 110%' && document.querySelector('#watEd [data-wat-save]').disabled; }), '합 110% — 저장 막힘');
    await page.evaluate(function () { var i = document.querySelector('#watEd [data-wat-k="G"]'); i.value = '10'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('#watEd [data-wat-save]');
    await page.waitForFunction(function () { return (WAT.rows || []).some(function (r) { return r.scope === 'person' && r.key === '분석P1'; }); }, { timeout: 5000 });
    await wait(200);
    var t1 = await page.evaluate(function () { return [].map.call(document.querySelectorAll('#waTgtC .wat-r'), function (x) { return (x.getAttribute('data-wa-sel') || '') + '|' + x.textContent; }); });
    // P1 이번 주 D 7.5/8 = 93.75% → 목표 90 → +4%p · G 6.25% → 목표 10 → −4%p · 합 8%p
    check(t1.length === 1 && /^p:분석P1\|/.test(t1[0]) && /개인 목표/.test(t1[0]) && /8%p$/.test(t1[0]), '사람 목표 저장 → P1 줄 · 차이 합 8%p ' + JSON.stringify(t1));
    // 팀 목표 — 실제로 채우기
    await page.click('#waTgtC [data-wat-ed]'); await wait(150);
    if (!(await page.$('#watEd'))) { await page.click('#waTgtC [data-wat-ed]'); await wait(150); }
    await page.select('#watEd select', 'team:*'); await wait(150);
    await page.click('#watEd [data-wat-fill]'); await wait(100);
    var fill = await page.evaluate(function () { return document.getElementById('watSum').textContent; });
    check(fill === '합 100%', '실제로 채우기 — 합 100% ' + fill);
    await page.click('#watEd [data-wat-save]');
    await page.waitForFunction(function () { return (WAT.rows || []).some(function (r) { return r.scope === 'team'; }); }, { timeout: 5000 });
    await wait(200);
    var t2 = await page.evaluate(function () { return [].map.call(document.querySelectorAll('#waTgtC .wat-r'), function (x) { return (x.getAttribute('data-wa-sel') || '') + '|' + x.textContent; }); });
    check(t2.length === 4 && /^\|팀 전체/.test(t2[0]) && /[01]%p$/.test(t2[0]) && t2.filter(function (x) { return /팀 목표/.test(x); }).length === 2, '팀 목표 → 팀 줄(차이 0) + P2 · P3 은 팀 목표로 ' + JSON.stringify(t2));
    var db1 = (await c.query('SELECT scope, key, mix FROM wa_targets WHERE tenant_id = $1 ORDER BY scope', [adm.tenant_id])).rows;
    check(db1.length === 2 && db1[0].mix.D === 90 && db1[0].mix.G === 10, 'DB 저장 ' + JSON.stringify(db1));
    // 👤 자세히에도 목표 대비
    await page.click('#waKpiC tbody tr[data-wa-sel="p:분석P1"] td.wak-nm'); await wait(300);
    check(await page.evaluate(function () { return /목표 대비 \(개인 목표\)/.test(document.getElementById('waPerC').textContent); }), '자세히 — 목표 대비 줄');
    await page.keyboard.press('Escape'); await wait(150);
    // 새로 고쳐도 서버에서 다시 읽음
    await page.evaluate(function () { WAT.rows = null; WAT.ed = null; rCht(); });
    await page.waitForFunction(function () { return WAT.rows && WAT.rows.length === 2 && document.querySelectorAll('#waTgtC .wat-r').length === 4; }, { timeout: 5000 });
    check(true, '다시 읽어도 목표 그대로');

    // 권한 — 팀원: 본인 목표 줄만 · 정하기 단추 없음 · 의존은 내 것만 · 사람마다 업체 이동은 본인만
    var mem = await page.evaluate(function () {
      var bak = { role: currentUser.role, name: currentUser.name, dn: currentUser.display_name, ce: WAT.canEdit };
      currentUser.role = 'member'; currentUser.name = '분석P3'; currentUser.display_name = ''; WAT.canEdit = false;
      rCht();
      var o = { tg: [].map.call(document.querySelectorAll('#waTgtC .wat-r'), function (x) { return x.getAttribute('data-wa-sel') || 'team'; }), ed: !!document.querySelector('#waTgtC [data-wat-ed]'),
        risk: [].map.call(document.querySelectorAll('#waRiskC tbody tr'), function (t) { return t.getAttribute('data-wa-sel'); }), riskChips: document.querySelectorAll('#waRiskC .war-sum').length,
        mv: [].map.call(document.querySelectorAll('#waMovC .wav-ptbl tbody tr'), function (t) { return t.getAttribute('data-wa-sel'); }),
        find: [].some.call(document.querySelectorAll('#waFindC li'), function (l) { return /한 사람 의존/.test(l.textContent); }) };
      WA.sel = ['p:분석P1']; wsRefresh(); o.perOther = !document.getElementById('waPerC').hidden;
      WA.sel = ['p:분석P3']; wsRefresh(); o.perMe = !document.getElementById('waPerC').hidden;
      WA.sel = []; _waSave();
      currentUser.role = bak.role; currentUser.name = bak.name; currentUser.display_name = bak.dn; WAT.canEdit = bak.ce; rCht();
      return o;
    });
    check(mem.tg.join() === 'team,p:분석P3' && !mem.ed, '팀원 — 팀 줄 + 본인 줄 · 정하기 단추 없음 ' + JSON.stringify(mem.tg));
    check(mem.risk.join() === 'ord:EK-4' && !mem.riskChips && !mem.find, '팀원 — 의존은 내 것(EK-4)만 · 사람 칩 · 한눈에 문장 없음 ' + JSON.stringify(mem.risk));
    check(mem.mv.length === 0 || mem.mv.join() === 'p:분석P3', '팀원 — 사람마다 업체 이동은 본인만 ' + JSON.stringify(mem.mv));
    check(!mem.perOther && mem.perMe, '팀원 — 다른 사람 자세히 못 봄 · 본인은 봄');

    // 8주로 바꾸면 의존 · 이동도 다시
    await page.click('#waDirC [data-wad-n="8"]'); await wait(300);
    check(await page.evaluate(function () { return /최근 8주/.test(document.querySelector('#waRiskC .wa-sub').textContent) && /최근 8주/.test(document.querySelector('#waMovC .wa-sub').textContent); }), '주 수 8주 → 의존 · 이동도 8주');
    await page.click('#waDirC [data-wad-n="12"]'); await wait(200);

    // 휴대폰 — 넘침 없음
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true }); await wait(700);
    await page.evaluate(function () { WA.sel = ['p:분석P1']; rCht(); }); await wait(300);
    var mob = await page.evaluate(function () {
      var wide = [].filter.call(document.querySelectorAll('#waBox *'), function (e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.right > 404 && !e.closest('.wa-tw,.wa-chart'); }).slice(0, 5).map(function (e) { return String(e.className && e.className.baseVal != null ? e.className.baseVal : e.className); });
      return { sw: document.documentElement.scrollWidth, wide: wide };
    });
    check(mob.sw <= 404 && !mob.wide.length, '휴대폰 — 넘침 없음 ' + JSON.stringify(mob));
    await page.evaluate(function () { WA.sel = []; _waSave(); });
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  finally {
    try { await c.query("DELETE FROM work_records WHERE content LIKE 'E2E분석P%'"); await c.query("DELETE FROM wa_targets WHERE key IN ('*','분석P1')"); } catch (e) {}
    await c.end(); await browser.close();
  }
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
