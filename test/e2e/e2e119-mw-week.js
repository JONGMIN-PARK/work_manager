// 🎯 내 업무 오른쪽 칸 — 📋 금주 할 일(주간 업무) (v13.537) · 칸 폭 · ◀ ▶ 주 넘기기 · 실적 반영 · 접기
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setViewport({ width: 1600, height: 950 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'lee@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    var team = 'E2E금주팀' + Date.now().toString().slice(-5);
    // 보고서는 관리자가 올림 (주간 업무 API 는 관리자 전용) — 이팀원은 내 업무에서 자기 일만 봄
    var B = 'http://localhost:3000';
    var at = (await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@t.com', password: 'Test1234!' }) })).json()).data.accessToken;
    function mon(k) { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - k * 7); return d; }
    function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
    var fri = mon(0); fri.setDate(fri.getDate() + 4);
    var rows = [
      [0, '', ['[개발]', '- [SENKO] PICAlign 마무리 ~' + md(fri) + ' 60% @이팀원', '- [A사] 검사기 UI 40% @김팀원', '[C/S]', '- [디오] 통신 점검 #진행중 @이팀원 @김팀원', '[기타]', '- [사내] 팀 회의 자료 정리 @이팀원']],
      [-1, ['[C/S]', '- [디오] 통신 점검 #완료 @이팀원 @김팀원', '[개발]', '- [SENKO] PICAlign 마무리 80% @이팀원'].join(String.fromCharCode(10)), ['[개발]', '- [SENKO] PICAlign 마무리 90% @이팀원']]
    ];
    for (var ri = 0; ri < rows.length; ri++) {
      var s0 = mon(rows[ri][0]), e0 = new Date(s0); e0.setDate(e0.getDate() + 4);
      var pr = await fetch(B + '/api/weekly-reports', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + at }, body: JSON.stringify({ autoName: { team: team, weekStart: ymd(s0), weekEnd: ymd(e0) }, lastText: rows[ri][1], curText: rows[ri][2].join(String.fromCharCode(10)) }) });
      if (pr.status >= 300) throw new Error('보고서 올리기 ' + pr.status);
    }
    var deny = await page.evaluate(function () { return apiFetch('/api/weekly-reports').then(function () { return 'ok'; }, function (e) { return e.status || 'err'; }); });
    check(deny === 403, '직원은 주간 보고서 목록은 여전히 못 봄 (' + deny + ')');
    await page.evaluate(function () { setPage('mywork'); });
    await page.waitForSelector('#mwwStrip .mww-r', { timeout: 15000 });
    await wait(400);
    var s1 = await page.evaluate(function () {
      var st = document.getElementById('mwwStrip'), side = st.closest('.mw-side');
      var kids = [].map.call(side.children, function (c) { return c.id || c.className.split(' ')[0]; });
      return { rows: [].map.call(st.querySelectorAll('.mww-r'), function (r) { return r.textContent; }), lbl: st.querySelector('.mww-lbl').textContent, n: (st.querySelector('.mwj-n') || {}).textContent,
        w: Math.round(side.getBoundingClientRect().width), order: kids, cut: [].filter.call(st.querySelectorAll('.mww-t'), function (t) { return t.scrollWidth > t.clientWidth + 1; }).length };
    });
    check(s1.rows.length === 3 && !s1.rows.some(function (r) { return /검사기 UI/.test(r); }), '내 일만 3건 (김팀원 일 빠짐) ' + JSON.stringify(s1.rows));
    check(/이번 주/.test(s1.lbl) && s1.n === '2', '이번 주 · 남은 일 2 (완료 1) ' + s1.lbl + ' / ' + s1.n);
    check(s1.rows.some(function (r) { return /✅.*통신 점검/.test(r); }) && s1.rows.some(function (r) { return /PICAlign/.test(r) && /80%/.test(r); }), '다음 주 보고서 실적으로 — 완료 ✅ · 80% ' + JSON.stringify(s1.rows));
    check(s1.rows.some(function (r) { return /PICAlign/.test(r) && /D-|D\+|D-day/.test(r); }), 'D-day 표시');
    check(s1.w >= 300 && s1.w <= 362, '오른쪽 칸 폭 ' + s1.w + 'px (288 → 300~360)');
    check(s1.order.indexOf('mwwStrip') >= 0 && s1.order.indexOf('mwwStrip') < s1.order.indexOf('mwjStrip'), '자리 — 오늘 일정 다음, 내 프로젝트 앞 ' + JSON.stringify(s1.order));
    await (await page.$('.mw-side')).screenshot({ path: path.join(__dirname, '.shots', 'mww-side.png') });
    // ◀ 지난주 — 보고서 없음
    await page.evaluate(function () { document.querySelector('#mwwStrip [data-mww="prev"]').click(); });
    await page.waitForFunction(function () { var s = document.getElementById('mwwStrip'); return s && /지난주/.test(s.querySelector('.mww-lbl').textContent) && s.querySelector('.mww-e') && !/⏳/.test(s.querySelector('.mww-e').textContent); }, { timeout: 8000 }).catch(function () {});
    var s2 = await page.evaluate(function () { var s = document.getElementById('mwwStrip'); return { lbl: s.querySelector('.mww-lbl').textContent, e: (s.querySelector('.mww-e') || {}).textContent }; });
    check(/지난주/.test(s2.lbl) && /보고서가 아직 없습니다|붙은 일이 없습니다/.test(s2.e || ''), '◀ 지난주로 ' + JSON.stringify(s2));
    await page.evaluate(function () { document.querySelector('#mwwStrip [data-mww="now"]').click(); });
    await page.waitForSelector('#mwwStrip .mww-r', { timeout: 8000 });
    check(/이번 주/.test(await page.evaluate(function () { return document.querySelector('#mwwStrip .mww-lbl').textContent; })), '이번 주로 돌아옴');
    // 접기 — 다시 그려도 기억
    await page.evaluate(function () { document.querySelector('#mwwStrip [data-mww="fold"]').click(); });
    await page.evaluate(function () { renderMyWork(); });
    await page.waitForSelector('#mwwStrip', { timeout: 8000 });
    check(await page.evaluate(function () { var s = document.getElementById('mwwStrip'); return s.classList.contains('is-folded') && !s.querySelector('.mww-r'); }), '접기 — 다시 그려도 기억');
    await page.evaluate(function () { document.querySelector('#mwwStrip [data-mww="fold"]').click(); });
    // 오른쪽 칸이 가장 좁을 때(300px)도 머리 · 항목 한 줄 (v13.540)
    await page.setViewport({ width: 1200, height: 900 });
    await wait(600);
    var one = await page.evaluate(function () { var s = document.getElementById('mwwStrip'), h = s.querySelector('.mwj-h'); return { side: Math.round(s.closest('.mw-side').getBoundingClientRect().width), head: Math.round(h.getBoundingClientRect().height), rows: [].map.call(s.querySelectorAll('.mww-r'), function (r) { return Math.round(r.getBoundingClientRect().height); }) }; });
    check(one.side <= 302 && one.head <= 34 && one.rows.every(function (h) { return h <= 36; }), '좁은 칸 — 머리 · 항목 한 줄 ' + JSON.stringify(one));
    // 다른 이름 — 관리자 계정에 '박종민' → 보고서 @박종민 이 관리자 금주 할 일로
    var ah = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + at };
    var pf = await (await fetch(B + '/api/profile', { method: 'PUT', headers: ah, body: JSON.stringify({ aliases: '박종민, @Alex, 박종민' }) })).json();
    check(pf.data && pf.data.aliases === '박종민, Alex', '내 프로필 다른 이름 저장 (@ 떼고 · 중복 빼고) ' + (pf.data && pf.data.aliases));
    var s9 = mon(0), e9 = new Date(s9); e9.setDate(e9.getDate() + 4);
    await fetch(B + '/api/weekly-reports', { method: 'POST', headers: ah, body: JSON.stringify({ autoName: { team: team + 'B', weekStart: ymd(s9), weekEnd: ymd(e9) }, lastText: '', curText: ['[개발]', '- [SENKO] 비전 검사 50% @박종민'].join(String.fromCharCode(10)) }) });
    var mn = await (await fetch(B + '/api/weekly-reports/mine?week=' + ymd(s9), { headers: ah })).json();
    check((mn.data.items || []).some(function (x) { return x.name === '비전 검사'; }), '@박종민 일이 관리자 금주 할 일로');
    var lk = await (await fetch(B + '/api/users/lookup', { headers: ah })).json();
    check((lk.data || []).some(function (u) { return /박종민/.test(u.aliases || ''); }), '사람 목록에 다른 이름 (찾기 · 담당 맞추기)');
    await fetch(B + '/api/profile', { method: 'PUT', headers: ah, body: JSON.stringify({ aliases: '' }) });
    // 좁은 화면 — 넘침 없음
    await page.setViewport({ width: 900, height: 900 });
    await wait(500);
    check(await page.evaluate(function () { return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1; }), '좁은 화면 — 가로 넘침 없음');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
