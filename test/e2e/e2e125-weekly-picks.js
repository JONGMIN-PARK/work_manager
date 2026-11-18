// ☆ 찜 (v13.545) — 주간 보고서 보기에서 남의 일 ☆ → 내 업무 📋 금주 할 일 '★ 찜한 일' · 주마다 ☐ 확인 · ✕ 찜 풀기 · API 남의 찜 못 건드림
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var B = 'http://localhost:3000';
async function tok(email) { var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) }); return (await r.json()).data.accessToken; }
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    var at = await tok('admin@t.com'), H = function (t) { return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }; };
    function mon(k) { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - k * 7); return d; }
    function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    var team = 'E2E찜팀' + Date.now().toString().slice(-5), s0 = mon(0), e0 = new Date(s0); e0.setDate(e0.getDate() + 4);
    var cur = ['[개발]', '- [ACME] 비전 검사 개선 40% @김팀원', '  - 조명 각도 시험', '- [ACME] 다른 일 @이팀원'].join(String.fromCharCode(10));
    var rep = await (await fetch(B + '/api/weekly-reports', { method: 'POST', headers: H(at), body: JSON.stringify({ autoName: { team: team, weekStart: ymd(s0), weekEnd: ymd(e0) }, lastText: '', curText: cur }) })).json();
    var rid = rep.data && (Array.isArray(rep.data) ? rep.data[0] : rep.data).id;
    check(!!rid, '보고서 저장 ' + rid);

    await page.setViewport({ width: 1500, height: 950 });
    await page.goto(B + '/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    // 주간 업무 → 목록 → 보고서 보기 → ☆
    await page.evaluate(function () { setPage('weekly_report'); });
    await page.waitForSelector('#wrSubTabs .tab[data-wt="list"]', { timeout: 10000 });
    await page.evaluate(function () { document.querySelector('#wrSubTabs .tab[data-wt="list"]').click(); });
    await page.waitForFunction(function (rid) { if (document.getElementById('wrAuTeam')) document.querySelector('#wrSubTabs .tab[data-wt="list"]').click(); var b = document.querySelector('[data-prev="' + rid + '"]'); if (b) b.click(); return !!document.getElementById('wrPrevBody'); }, { timeout: 15000, polling: 300 }, rid).catch(async function (e) { console.log('DBG', await page.evaluate(function () { var p = document.getElementById('wrPanel'); return (p ? p.innerHTML.slice(0, 600) : 'no panel') + ' | prev=' + document.querySelectorAll('[data-prev]').length; }), errs.join('|')); throw e; });
    await page.waitForSelector('#wrPrevBody .wrp-pick', { timeout: 10000 });
    var nb = await page.evaluate(function () { return document.querySelectorAll('#wrPrevBody .wrp-pick').length; });
    check(nb === 2, '보고서 보기 — 일마다 ☆ ' + nb);
    await page.evaluate(function () { [].filter.call(document.querySelectorAll('#wrPrevBody .wrp-pick'), function (b) { return /비전/.test(b.getAttribute('data-wpk-n')); })[0].click(); });
    await page.waitForFunction(function () { var b = document.querySelector('#wrPrevBody .wrp-pick.on'); return b && b.textContent === '★'; }, { timeout: 8000 }).catch(function () {});
    check(await page.evaluate(function () { return document.querySelectorAll('#wrPrevBody .wrp-pick.on').length === 1; }), '☆ → ★ 찜');
    // 지난주 칸엔 ☆ 없음 · 내보내기 HTML 에 안 섞임
    check(await page.evaluate(function () { return !/wrp-pick/.test(document.body.innerHTML.replace(/<div id="wrPrevBody"[\s\S]*$/, '')); }), '보기 칸 밖엔 ☆ 없음');

    // 내 업무 — ★ 찜한 일
    await page.evaluate(function () { setPage('mywork'); });
    await page.waitForSelector('#mwwStrip .mww-r.is-pk', { timeout: 15000 });
    var pk = await page.evaluate(function () { var r = document.querySelector('#mwwStrip .mww-r.is-pk'); return { t: r.textContent, d: [].map.call(r.nextElementSibling ? r.nextElementSibling.querySelectorAll('li') : [], function (x) { return x.textContent; }), gh: document.querySelector('#mwwStrip .mww-gh').textContent }; });
    check(/비전 검사 개선/.test(pk.t) && /@김팀원/.test(pk.t) && /40%/.test(pk.t) && pk.d[0] === '조명 각도 시험' && /0\/1/.test(pk.gh), '★ 찜한 일 — 담당 · 진행률 · 할 내용 ' + JSON.stringify(pk));
    // ☐ 확인
    await page.evaluate(function () { document.querySelector('#mwwStrip .mww-r.is-pk [data-mww="ck"]').click(); });
    await page.waitForFunction(function () { return document.querySelector('#mwwStrip .mww-r.is-pk.is-ck'); }, { timeout: 8000 }).catch(function () {});
    check(await page.evaluate(function () { return !!document.querySelector('#mwwStrip .mww-r.is-pk.is-ck') && /1\/1/.test(document.querySelector('#mwwStrip .mww-gh').textContent); }), '☐ → ✓ 확인 (1/1)');
    // 다시 받아도 확인 유지 · 다음 주는 따로
    await page.evaluate(function () { mwWeekReset(); });
    await page.waitForFunction(function () { return document.querySelector('#mwwStrip .mww-r.is-pk.is-ck'); }, { timeout: 8000 }).catch(function () {});
    check(await page.evaluate(function () { return !!document.querySelector('#mwwStrip .mww-r.is-pk.is-ck'); }), '새로 받아도 확인 유지');
    var me = await (await fetch(B + '/api/weekly-reports/mine?week=' + ymd(s0), { headers: H(at) })).json();
    var p0 = (me.data.picks || [])[0];
    var lt = await tok('lee@t.com');
    check((await fetch(B + '/api/weekly-reports/picks/' + p0.pickId, { method: 'DELETE', headers: H(lt) })).ok && ((await (await fetch(B + '/api/weekly-reports/mine?week=' + ymd(s0), { headers: H(at) })).json()).data.picks || []).length === 1, '남의 찜은 못 지움');
    check((await fetch(B + '/api/weekly-reports/picks/' + p0.pickId + '/check', { method: 'PUT', headers: H(lt), body: JSON.stringify({ week: ymd(s0), checked: false }) })).status === 404, '남의 찜 확인 — 404');
    // ✕ 찜 풀기
    await page.evaluate(function () { document.querySelector('#mwwStrip .mww-r.is-pk [data-mww="unpick"]').click(); });
    await page.waitForFunction(function () { return !document.querySelector('#mwwStrip .mww-r.is-pk'); }, { timeout: 8000 }).catch(function () {});
    check(await page.evaluate(function () { return !document.querySelector('#mwwStrip .mww-r.is-pk') && !document.querySelector('#mwwStrip .mww-gh'); }), '✕ 찜 풀기');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
