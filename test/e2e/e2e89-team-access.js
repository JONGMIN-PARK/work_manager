// 📒 업무 관리는 모든 사용자에게 보임 (v13.478 — v13.467 의 '허락된 사람만' 을 풂) · 권한 열쇠는 본인이 못 바꿈 · 새 버전 알림 제목은 관리자만
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var ok = 0, fail = 0, errs = [];
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
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
  var st = function (page) { return page.evaluate(function () { var t = document.querySelector('#pageTabs [data-page="team"]'); return { tab: !!(t && t.offsetParent), page: curPage, mode: curMode, role: currentUser.role }; }); };
  var kim = null, adm = null;
  try {
    // 팀원 — 탭 보임 · 열림 · 새로 고쳐도 그 자리
    kim = await session('kim@t.com');
    var a = await st(kim.page);
    check(a.tab && a.role === 'member', '팀원 — 업무 관리 탭 보임 ' + JSON.stringify(a));
    await kim.page.evaluate(function () { setPage('mywork'); }); await wait(300);
    await kim.page.click('#pageTabs [data-page="team"]'); await wait(400);
    a = await st(kim.page);
    check(a.page === 'team', '팀원 — 탭 누르면 업무 관리 열림 ' + JSON.stringify(a));
    await kim.page.reload({ waitUntil: 'networkidle2' });
    await kim.page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(800);
    a = await st(kim.page);
    check(a.page === 'team' && a.tab, '팀원 — 새로 고쳐도 업무 관리 그대로 ' + JSON.stringify(a));
    // 권한 열쇠는 본인이 못 바꿈
    var self = await kim.page.evaluate(async function () { var out = {}; for (var k of ['operator_mode', 'mindmap_access']) { try { await apiFetch('/api/settings/' + k, { method: 'PUT', body: JSON.stringify({ value: { enabled: true } }) }); out[k] = 200; } catch (e) { out[k] = e.status; } } try { await apiFetch('/api/settings/zz_free', { method: 'PUT', body: JSON.stringify({ value: 1 }) }); out.free = 200; } catch (e) { out.free = e.status; } return out; });
    check(self.operator_mode === 403 && self.mindmap_access === 403 && self.free === 200, '권한 열쇠(operator_mode · mindmap_access)는 본인이 못 바꿈 · 다른 설정은 됨 ' + JSON.stringify(self));
    // 새 버전 알림 — 팀원은 제목 안 보임
    var updK = await kim.page.evaluate(function () { _wmUpdateShow({ build: 'zz-test-' + Date.now(), version: '99.1', title: '비밀 변경 내용' }); var b = document.getElementById('wmUpd'); var t = b ? b.textContent : ''; if (b) b.remove(); return t; });
    check(/v99\.1/.test(updK) && !/비밀 변경 내용/.test(updK), '새 버전 알림 — 팀원은 버전만 ' + updK.slice(0, 60));
    // 관리자
    adm = await session('admin@t.com');
    check((await st(adm.page)).tab, '관리자 — 업무 관리 탭 있음');
    var updA = await adm.page.evaluate(function () { _wmUpdateShow({ build: 'zz-test-' + Date.now(), version: '99.1', title: '비밀 변경 내용' }); var b = document.getElementById('wmUpd'); var t = b ? b.textContent : ''; if (b) b.remove(); return t; });
    check(/비밀 변경 내용/.test(updA), '새 버전 알림 — 관리자는 제목도');
    await adm.page.evaluate(function () { setPage('useradmin'); });
    await adm.page.waitForFunction(function () { return document.querySelectorAll('#mUserAdmin table tr').length > 1; }, { timeout: 15000 });
    var ua = await adm.page.evaluate(function () { var ths = [].map.call(document.querySelectorAll('#mUserAdmin table th'), function (t) { return t.textContent.trim(); }); var r = document.querySelector('#mUserAdmin table tr:nth-child(2)'); return { ths: ths, tds: r ? r.children.length : 0, cb: document.querySelectorAll('#mUserAdmin .ua-team').length }; });
    check(ua.ths.indexOf('업무 관리') < 0 && !ua.cb && ua.tds === ua.ths.length, '사용자 관리 — 「업무 관리」 칸 없음 · 칸 수 맞음 ' + JSON.stringify(ua));
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  finally { if (kim) await kim.browser.close(); if (adm) await adm.browser.close(); }
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
