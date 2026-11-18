// 📋 금주 할 일 — 처음 열 때 없던 보고서 · 나중에 넣은 다른 이름도 다시 그리면 보임 (v13.543) · '@이팀원·김팀원' 한 덩어리 담당도
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var B = 'http://localhost:3000';
async function tok(email) { var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) }); return (await r.json()).data.accessToken; }
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    var at = await tok('admin@t.com'), H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + at };
    function mon(k) { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - k * 7); return d; }
    function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    var team = 'E2E새로팀' + Date.now().toString().slice(-5), s0 = mon(0), e0 = new Date(s0); e0.setDate(e0.getDate() + 4);
    await page.setViewport({ width: 1500, height: 950 });
    await page.goto(B + '/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'lee@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    await page.evaluate(function () { setPage('mywork'); });
    await page.waitForFunction(function () { var s = document.getElementById('mwwStrip'); return s && s.querySelector('.mww-e') && !/⏳/.test(s.querySelector('.mww-e').textContent); }, { timeout: 15000 });
    var before = await page.evaluate(function () { return document.querySelectorAll('#mwwStrip .mww-r').length; });
    // 열어 둔 사이 이번 주 보고서가 저장됨 — 담당을 '@이팀원·김팀원' 한 덩어리로
    var cur = ['[개발]', '- [SENKO] PICAlign 70% @이팀원·김팀원', '[C/S]', '- [SDC] 글라스 챔퍼링'].join(String.fromCharCode(10));
    var pr = await fetch(B + '/api/weekly-reports', { method: 'POST', headers: H, body: JSON.stringify({ autoName: { team: team, weekStart: ymd(s0), weekEnd: ymd(e0) }, lastText: '', curText: cur }) });
    check(pr.status < 300, '이번 주 보고서 저장');
    // 30초가 지난 것처럼 → 내 업무를 다시 그리면 새로 받음 (예전엔 페이지를 새로 고칠 때까지 처음 것)
    await page.evaluate(function () { Object.keys(_mww.at).forEach(function (k) { _mww.at[k] = 0; }); renderMyWork(); });
    await page.waitForSelector('#mwwStrip .mww-r', { timeout: 10000 }).catch(function () {});
    var after = await page.evaluate(function () { return [].map.call(document.querySelectorAll('#mwwStrip .mww-r'), function (r) { return r.textContent; }); });
    check(before === 0 && after.length === 1 && /PICAlign/.test(after[0]), '다시 그리면 새 보고서가 보임 · 한 덩어리 담당도 알아봄 ' + JSON.stringify(after));
    // 저장하면 바로 (mwWeekReset)
    await fetch(B + '/api/weekly-reports', { method: 'POST', headers: H, body: JSON.stringify({ autoName: { team: team + 'B', weekStart: ymd(s0), weekEnd: ymd(e0) }, lastText: '', curText: ['[기타]', '- [사내] 회의 자료 @이팀원'].join(String.fromCharCode(10)) }) });
    await page.evaluate(function () { mwWeekReset(); });
    await page.waitForFunction(function () { return document.querySelectorAll('#mwwStrip .mww-r').length === 2; }, { timeout: 10000 }).catch(function () {});
    check(await page.evaluate(function () { return document.querySelectorAll('#mwwStrip .mww-r').length === 2; }), '저장 뒤 비우기 → 바로 새로 (2건)');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
