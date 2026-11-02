// 📈 주간 업무 분석 (v13.310) — 4주치 보고서를 저장 → 분석 탭: 숫자 · 결론 · 추세 그래프 · 경과 체크 · 사람별 · CSV · AI 해석 · 휴대폰 폭
// /api/ai/summary 는 가로챔 (AI 키 없음)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var SHOTS = path.join(__dirname, '.shots');
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0, aiPrompt = '';
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    if (req.url().indexOf('/api/ai/summary') >= 0) {
      aiPrompt = (JSON.parse(req.postData() || '{}').prompt) || '';
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { text: '## 핵심\n- PICAlign 납기 지남 <img src=x onerror=alert(1)>\n## 다음 주 목표\n- 검사기 UI 60%', provider: 'Gemini', model: 'm' } }) });
    }
    req.continue();
  });
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    var team = 'E2E분석팀' + Date.now().toString().slice(-5);
    // 최근 4주 (월요일)
    await page.evaluate(function (team) {
      function mon(k) { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - k * 7); return d; }
      function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
      function md(d) { return ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2); }
      var w0 = mon(3), dl = new Date(mon(1)); dl.setDate(dl.getDate() + 2);   // PICAlign 납기 = 2주 전 수요일 → 지남
      var late = md(dl);
      var weeks = [
        ['[개발]', '[SENKO] PICAlign ~' + late + ' 10% @박종민', '[A사] 검사기 UI 20% @김철수', '[셋업]', '[LOTCES] 레이저 셋업 @이영희'],
        ['[개발]', '[SENKO] PICAlign ~' + late + ' 30% @박종민', '[A사] 검사기 UI 50% @김철수', '[셋업]', '[LOTCES] 레이저 셋업 #완료 @이영희', '[기타]', '[TSE] 잔건 처리 @이영희'],
        ['[개발]', '[SENKO] PICAlign ~' + late + ' 40% @박종민', '[A사] 검사기 UI 50% @김철수', '[기타]', '[TSE] 잔건 처리 #완료 @이영희'],
        ['[개발]', '[SENKO] PICAlign ~' + late + ' 45% @박종민', '[A사] 검사기 UI 50% @김철수', '[C/S]', '[디오] 통신 점검 #진행 @박종민']
      ];
      var p = Promise.resolve();
      weeks.forEach(function (lines, i) {
        var s = mon(3 - i), e = new Date(s); e.setDate(e.getDate() + 4);
        p = p.then(function () { return apiFetch('/api/weekly-reports', { method: 'POST', body: JSON.stringify({ autoName: { team: team, weekStart: ymd(s), weekEnd: ymd(e) }, lastText: '', curText: lines.join('\n') }) }); });
      });
      return p;
    }, team);
    await page.evaluate(function () { setPage('weekly_report'); });
    await page.waitForSelector('#wrSubTabs [data-wt="stats"]', { timeout: 15000 });
    var lbl = await page.$eval('#wrSubTabs [data-wt="stats"]', function (b) { return b.textContent; });
    check(/분석/.test(lbl), '탭 이름 📈 분석 — ' + lbl);
    await page.click('#wrSubTabs [data-wt="stats"]');
    await page.waitForSelector('#wriTeam option:nth-child(2)', { timeout: 10000 }).catch(function () {});
    await page.select('#wriTeam', team);
    await page.waitForSelector('#wriBody .wri-kpis', { timeout: 10000 }).catch(function () {});
    await wait(400);
    var v = await page.evaluate(function () {
      var kp = {}; document.querySelectorAll('#wriBody .wri-k').forEach(function (k) { kp[k.querySelector('.wri-kl').textContent] = k.querySelector('.wri-kv').textContent; });
      return { kp: kp, range: (document.querySelector('.wri-range') || {}).textContent, finds: Array.prototype.map.call(document.querySelectorAll('.wri-find li'), function (l) { return l.textContent; }),
        bars: document.querySelectorAll('.wri-chart rect').length, line: !!document.querySelector('.wri-chart polyline'),
        mem: Array.prototype.map.call(document.querySelectorAll('.wri-tbl tbody tr td:first-child'), function (t) { return t.textContent; }) };
    });
    check(/4주/.test(v.range) && /보고서 4개/.test(v.range), '기간 · 보고서 수 ' + v.range);
    check(v.kp['납기 지남'] === '1' && v.kp['정체'] === '1' && v.kp['주당 끝냄'] === '0.5', '숫자 — 지남 1 · 정체 1 · 주당 끝냄 0.5 ' + JSON.stringify(v.kp));
    check(v.finds.some(function (f) { return /납기 지난 일 1건 — SENKO PICAlign/.test(f); }) && v.finds.some(function (f) { return /3주째 진척 없는 일/.test(f); }), '결론 문장 ' + JSON.stringify(v.finds.slice(0, 4)));
    check(v.bars >= 4 && v.line, '주별 추세 막대 · 완료율 선 (' + v.bars + ')');
    check(v.mem.indexOf('박종민') >= 0 && v.mem.indexOf('이영희') >= 0, '사람별 효율 표 ' + JSON.stringify(v.mem));

    // 경과 체크 — 숫자 칸을 누르면 그 목록
    await page.evaluate(function () { document.querySelector('.wri-k[data-risk="stalled"]').click(); });
    await wait(400);
    var rk = await page.evaluate(function () { var on = document.querySelector('#wriRisk .wri-rtabs .on'); return { on: on && on.textContent, items: Array.prototype.map.call(document.querySelectorAll('#wriRisk .wri-ri .wri-nm'), function (n) { return n.textContent; }), spark: !!document.querySelector('#wriRisk .wri-spk') }; });
    check(/정체/.test(rk.on) && rk.items.indexOf('검사기 UI') >= 0 && rk.spark, '정체 칸 → 정체 목록 · 진행률 흐름선 ' + JSON.stringify(rk));
    await page.evaluate(function () { document.querySelector('#wriRisk [data-rt="overdue"]').click(); });
    await wait(300);
    var od = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('#wriRisk .wri-ri'), function (n) { return n.textContent; }); });
    check(od.length === 1 && /PICAlign/.test(od[0]) && /박종민/.test(od[0]) && /일정상/.test(od[0]) === false, '납기 지남 목록 — 담당 · 납기 ' + JSON.stringify(od));

    // AI 해석 — 숫자 요약을 보내고, 답은 막힌 HTML
    await page.click('#wriAi');
    await page.waitForSelector('#wriAiOut .wri-ai', { timeout: 8000 }).catch(function () {});
    var ai = await page.evaluate(function () { var o = document.querySelector('#wriAiOut .wri-ai'); return o && { txt: o.textContent, img: !!o.querySelector('img') }; });
    check(/\[납기 지남\] SENKO PICAlign/.test(aiPrompt) && /다음 주 목표/.test(aiPrompt), 'AI 에게 분석 요약 · 목표 제안 요청');
    check(ai && /다음 주 목표/.test(ai.txt) && !ai.img, 'AI 답 표시 (HTML 막힘) ' + JSON.stringify(ai));
    await page.screenshot({ path: path.join(SHOTS, 'wr-insights-desk.png'), fullPage: true });

    // 기간 바꾸기
    await page.evaluate(function () { document.querySelector('#wriWeeks [data-w="4"]').click(); });
    await wait(800);
    check(await page.evaluate(function () { return /4주|3주/.test((document.querySelector('.wri-range') || {}).textContent); }), '4주로 바꿈');

    // 휴대폰 폭
    await page.setViewport({ width: 402, height: 874 });
    await wait(500);
    var mob = await page.evaluate(function () { var wide = Array.prototype.filter.call(document.querySelectorAll('#mWeeklyReport *'), function (e) { var r = e.getBoundingClientRect(); return r.right > 404 && r.width > 0; }).slice(0, 6).map(function (e) { return (e.id || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().right); }); return { wide: wide, sw: document.documentElement.scrollWidth, cols: getComputedStyle(document.querySelector('.wri-kpis')).gridTemplateColumns.split(' ').length }; });
    check(mob.sw <= 402 && mob.cols === 4, '휴대폰 — 넘침 없음 · 숫자 4칸 ' + JSON.stringify(mob));
    await page.screenshot({ path: path.join(SHOTS, 'wr-insights-phone.png'), fullPage: true });
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack);
  }
  await browser.close();
  console.log(fail ? ('FAILED ' + fail + ' / ' + (ok + fail)) : ('ALL PASS (' + ok + ')'));
  process.exit(fail ? 1 : 0);
})();
