// 📋 회의록 같이 고치기 (v13.541) — 내가 화면에서 고치는 사이 남이 저장해도(409) 3방향으로 합쳐 둘 다 살림
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var B = 'http://localhost:3000';
async function tok(email) { var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) }); return (await r.json()).data.accessToken; }
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0, pid = 'e2e-mm-' + Date.now();
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    var at = await tok('admin@t.com'), kt = await tok('kim@t.com');
    var H = function (t) { return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }; };
    var kId = (await (await fetch(B + '/api/auth/me', { headers: H(kt) })).json()).data; kId = kId.id || (kId.user && kId.user.id);
    await fetch(B + '/api/projects', { method: 'POST', headers: H(at), body: JSON.stringify({ id: pid, name: '회의 합치기 시험', status: 'active', checklists: false }) });
    await fetch(B + '/api/projects/' + pid + '/members', { method: 'POST', headers: H(at), body: JSON.stringify({ userId: kId, role: 'assignee' }) });
    var mt = (await (await fetch(B + '/api/meetings', { method: 'POST', headers: H(at), body: JSON.stringify({ projectId: pid, title: '주간 회의', meetDate: '2026-11-18', minutes: '1. 일정 확인\n2. 도면 검토\n3. 다음 회의', attendees: ['관리자'] }) })).json()).data;
    var mid = mt.id;
    await page.setViewport({ width: 1500, height: 950 });
    await page.goto(B + '/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    await page.evaluate(function (pid) { setPage('project'); return showProjectDetail(pid); }, pid);
    await page.waitForSelector('#projDetailPanel', { timeout: 10000 });
    await page.evaluate(function () { pdSwitchTab('meeting'); });
    await page.waitForFunction(function (mid) { return typeof _pmt !== 'undefined' && _pmt.list && _pmt.list.some(function (m) { return String(m.id) === String(mid); }); }, { timeout: 10000 }, mid);
    // 그사이 김팀원이 마지막 줄 · 참석자 · 양식 칸을 고쳐 저장
    var cur = (await (await fetch(B + '/api/meetings/' + mid, { headers: H(kt) })).json()).data;
    var kr = await fetch(B + '/api/meetings/' + mid, { method: 'PUT', headers: H(kt), body: JSON.stringify({ version: cur.version, minutes: '1. 일정 확인\n2. 도면 검토\n3. 다음 회의 — 금요일 (김팀원)', attendees: ['관리자', '김팀원'] }) });
    check(kr.status === 200, '김팀원 먼저 저장');
    // 관리자 화면(옛 version)에서 첫 줄 · 참석자 고쳐 저장 → 409 → 합쳐 다시
    var r = await page.evaluate(function (mid) {
      var m = _pmtFind(mid);
      return _pmtUpdate(mid, { title: m.title, meetDate: m.meetDate, attendees: ['관리자', '이팀원'], minutes: '1. 일정 확인 — 12월 납품 (관리자)\n2. 도면 검토\n3. 다음 회의', form: m.form }).then(function (ok) { var x = _pmtFind(mid); return { ok: ok, minutes: x.minutes, att: x.attendees }; });
    }, mid);
    check(r.ok, '관리자 저장 — 충돌 안내 없이 저장됨');
    check(/12월 납품 \(관리자\)/.test(r.minutes) && /금요일 \(김팀원\)/.test(r.minutes) && r.minutes.split('\n').length === 3, '회의록 — 둘이 고친 줄이 모두 남음 ' + JSON.stringify(r.minutes));
    check(r.att.join(',') === '관리자,김팀원,이팀원', '참석자 — 김팀원이 더한 것 + 관리자가 더한 것 ' + r.att.join(','));
    var srv = (await (await fetch(B + '/api/meetings/' + mid, { headers: H(at) })).json()).data;
    check(srv.minutes === r.minutes, '서버에도 합친 그대로');
    // 같은 줄을 둘 다 고친 경우 — 지우지 않고 둘 다 남김
    var cur2 = (await (await fetch(B + '/api/meetings/' + mid, { headers: H(kt) })).json()).data;
    await fetch(B + '/api/meetings/' + mid, { method: 'PUT', headers: H(kt), body: JSON.stringify({ version: cur2.version, minutes: srv.minutes.replace('2. 도면 검토', '2. 도면 검토 — 김: 간섭 있음') }) });
    var r2 = await page.evaluate(function (mid) {
      var m = _pmtFind(mid);
      return _pmtUpdate(mid, { minutes: m.minutes.replace('2. 도면 검토', '2. 도면 검토 — 관: 승인'), title: m.title }).then(function () { return _pmtFind(mid).minutes; });
    }, mid);
    check(/김: 간섭 있음/.test(r2) && /관: 승인/.test(r2), '같은 줄을 둘 다 고쳐도 둘 다 남김 ' + JSON.stringify(r2));
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
