// 📒 업무 관리는 허락된 사람만 (v13.467) — 팀원은 탭 없음 · 바로 가도 내 업무로 · 관리자가 켜면 보임 · 권한 열쇠는 본인이 못 바꿈 · 새 버전 알림 제목은 관리자만
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var ok = 0, fail = 0, errs = [];
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  async function session(email) {
    var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now() + Math.random()) });
    var page = (await browser.pages())[0] || await browser.newPage();
    page.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', email); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(800);
    return { browser: browser, page: page };
  }
  var st = function (page) { return page.evaluate(function () { var t = document.querySelector('#pageTabs [data-page="team"]'); return { tab: !!(t && t.offsetParent), page: curPage, can: wmCanTeam(), ta: !!currentUser.teamAccess }; }); };
  var kim = null, adm = null;
  try {
    var kid = (await c.query("SELECT id FROM users WHERE email = 'kim@t.com'")).rows[0].id;
    await c.query("DELETE FROM user_settings WHERE user_id = $1 AND key = 'team_access'", [kid]);
    // 팀원 — 탭 없음 · 처음 화면도 업무 관리가 아님 · 바로 가도 내 업무로
    kim = await session('kim@t.com');
    var a = await st(kim.page);
    check(!a.tab && !a.can && a.page !== 'team', '팀원 — 업무 관리 탭 없음 · 처음 화면도 다른 곳 ' + JSON.stringify(a));
    await kim.page.evaluate(function () { setPage('team'); }); await wait(300);
    check((await st(kim.page)).page === 'mywork', '팀원 — setPage(team) 해도 내 업무로');
    await kim.page.evaluate(function () { setPage('weekly_report'); }); await wait(300);
    check((await st(kim.page)).page === 'mywork', '팀원 — 주간 업무 바로 가기도 내 업무로');
    // 권한 열쇠는 본인이 못 바꿈
    var self = await kim.page.evaluate(async function () { var out = {}; for (var k of ['team_access', 'operator_mode', 'mindmap_access']) { try { await apiFetch('/api/settings/' + k, { method: 'PUT', body: JSON.stringify({ value: { enabled: true } }) }); out[k] = 200; } catch (e) { out[k] = e.status; } } try { await apiFetch('/api/settings/zz_free', { method: 'PUT', body: JSON.stringify({ value: 1 }) }); out.free = 200; } catch (e) { out.free = e.status; } return out; });
    check(self.team_access === 403 && self.operator_mode === 403 && self.mindmap_access === 403 && self.free === 200, '권한 열쇠(team_access · operator_mode · mindmap_access)는 본인이 못 바꿈 · 다른 설정은 됨 ' + JSON.stringify(self));
    var selfApi = await kim.page.evaluate(async function (id) { try { await apiFetch('/api/users/' + id + '/team-access', { method: 'PUT', body: JSON.stringify({ enabled: true }) }); return 200; } catch (e) { return e.status; } }, kid);
    check(selfApi === 403, '팀원은 권한 주기 API 못 씀 ' + selfApi);
    // 새 버전 알림 — 팀원은 제목 안 보임
    var updK = await kim.page.evaluate(function () { _wmUpdateShow({ build: 'zz-test-' + Date.now(), version: '99.1', title: '비밀 변경 내용' }); var b = document.getElementById('wmUpd'); var t = b ? b.textContent : ''; if (b) b.remove(); return t; });
    check(/v99\.1/.test(updK) && !/비밀 변경 내용/.test(updK), '새 버전 알림 — 팀원은 버전만 ' + updK.slice(0, 60));
    // 관리자 — 탭 있음 · 사용자 관리에서 켬
    adm = await session('admin@t.com');
    check((await st(adm.page)).tab, '관리자 — 업무 관리 탭 있음');
    var updA = await adm.page.evaluate(function () { _wmUpdateShow({ build: 'zz-test-' + Date.now(), version: '99.1', title: '비밀 변경 내용' }); var b = document.getElementById('wmUpd'); var t = b ? b.textContent : ''; if (b) b.remove(); return t; });
    check(/비밀 변경 내용/.test(updA), '새 버전 알림 — 관리자는 제목도');
    await adm.page.evaluate(function () { setPage('useradmin'); });
    await adm.page.waitForSelector('[data-ua-team="' + kid + '"]', { timeout: 15000 });
    var row = await adm.page.evaluate(function (kid) { var cb = document.querySelector('[data-ua-team="' + kid + '"]'); return { chk: cb.checked, always: [].filter.call(document.querySelectorAll('#mUserAdmin td'), function (t) { return t.textContent === '늘 보임'; }).length }; }, kid);
    check(!row.chk && row.always >= 1, '사용자 관리 — 팀원은 체크 칸(꺼짐) · 관리자는 늘 보임 ' + JSON.stringify(row));
    await adm.page.evaluate(function (kid) { document.querySelector('[data-ua-team="' + kid + '"]').click(); }, kid);
    await wait(800);
    var db = (await c.query("SELECT value FROM user_settings WHERE user_id = $1 AND key = 'team_access'", [kid])).rows[0];
    check(db && db.value && db.value.enabled === true, '체크하면 저장 ' + JSON.stringify(db));
    // 팀원 새로 고침 → 보임
    await kim.page.reload({ waitUntil: 'networkidle2' });
    await kim.page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(800);
    a = await st(kim.page);
    check(a.tab && a.can && a.ta, '허락받은 팀원 — 새로 고치면 탭 보임 ' + JSON.stringify(a));
    await kim.page.evaluate(function () { setPage('team'); }); await wait(300);
    check((await st(kim.page)).page === 'team', '허락받은 팀원 — 업무 관리 열림');
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  finally {
    try { await c.query("DELETE FROM user_settings WHERE key IN ('team_access','zz_free') AND user_id IN (SELECT id FROM users WHERE email = 'kim@t.com')"); } catch (e) {}
    await c.end(); if (kim) await kim.browser.close(); if (adm) await adm.browser.close();
  }
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
