// 👀 지금 같이 보는 사람 (v13.539) — 같은 프로젝트 상세를 열면 서로 보임 · 닫으면 사라짐 · 볼 권한 없는 프로젝트는 안 알려 줌
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var B = 'http://localhost:3000';
async function tok(email) { var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) }); return (await r.json()).data.accessToken; }
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var ok = 0, fail = 0, errs = [];
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var ctx = await browser.createBrowserContext(), page = await ctx.newPage();
    page.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    await page.setViewport({ width: 1500, height: 950 });
    await page.goto(B + '/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', email); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    return page;
  }
  var pid = 'e2e-pr-' + Date.now(), A;
  try {
    var at = await tok('admin@t.com'), kt = await tok('kim@t.com'), lt = await tok('lee@t.com');
    var H = function (t) { return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }; };
    var kId = (await (await fetch(B + '/api/auth/me', { headers: H(kt) })).json()).data; kId = kId.id || (kId.user && kId.user.id);
    await fetch(B + '/api/projects', { method: 'POST', headers: H(at), body: JSON.stringify({ id: pid, name: '같이 보기 시험', status: 'active', visibility: 'private', checklists: false }) });
    var me = (await (await fetch(B + '/api/projects/' + pid + '/members', { method: 'POST', headers: H(at), body: JSON.stringify({ userId: kId, role: 'assignee' }) })).json());
    A = await open('admin@t.com');
    var K = await open('kim@t.com');
    var show = function (P) { return P.evaluate(function (pid) { setPage('project'); return showProjectDetail(pid); }, pid); };
    await show(A);
    await A.waitForSelector('#projDetailPanel .wpr-slot', { timeout: 10000 });
    await A.evaluate(function () { return wprTick(); }); await wait(500);
    check(await A.evaluate(function () { return document.querySelector('#projDetailPanel .wpr-slot').hidden; }), '혼자 볼 때는 표시 없음');
    await show(K);
    await K.waitForSelector('#projDetailPanel .wpr-slot', { timeout: 10000 });
    await K.evaluate(function () { return wprTick(); }); await wait(700);
    var kv = await K.evaluate(function () { var s = document.querySelector('#projDetailPanel .wpr-slot'); return { hidden: s.hidden, t: s.textContent, title: s.title }; });
    check(!kv.hidden && /관리자/.test(kv.title) && /보는 중/.test(kv.t), '김팀원 화면 — 👀 관리자 보는 중 ' + JSON.stringify(kv));
    await A.evaluate(function () { return wprTick(); }); await wait(700);
    var av = await A.evaluate(function () { var s = document.querySelector('#projDetailPanel .wpr-slot'); return { hidden: s.hidden, title: s.title }; });
    check(!av.hidden && /김팀원/.test(av.title), '관리자 화면 — 👀 김팀원 ' + JSON.stringify(av));
    // 김팀원이 닫으면 — 바로 빠지기(leave)
    await K.evaluate(function () { pdCloseDetail(); });
    await wait(1200);
    await A.evaluate(function () { return wprTick(); }); await wait(700);
    check(await A.evaluate(function () { return document.querySelector('#projDetailPanel .wpr-slot').hidden; }), '김팀원이 닫으면 관리자 화면에서 사라짐');
    // 권한 — 볼 수 없는 비공개 프로젝트는 알려 주지 않음
    await K.evaluate(function (pid) { return showProjectDetail(pid); }, pid); await K.evaluate(function () { return wprTick(); });
    var lr = await (await fetch(B + '/api/presence', { method: 'POST', headers: H(lt), body: JSON.stringify({ keys: ['project:' + pid] }) })).json();
    check(Array.isArray(lr.data['project:' + pid]) && lr.data['project:' + pid].length === 0, '볼 권한 없는 사람 — 빈 목록');
    var bad = await (await fetch(B + '/api/presence', { method: 'POST', headers: H(lt), body: JSON.stringify({ keys: ['../x', 'project:' + pid + ' OR 1'] }) })).json();
    check(Object.keys(bad.data).length === 0, '이상한 키는 무시');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    try { var at2 = await tok('admin@t.com'); await fetch(B + '/api/projects/' + pid, { method: 'DELETE', headers: { Authorization: 'Bearer ' + at2 } }); } catch (_) {}
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
