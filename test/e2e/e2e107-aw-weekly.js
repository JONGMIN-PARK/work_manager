// 🌐 주간 업무 → 애니웍스 주간업무보고에 올리기 v13.517 (가짜 PC 앱 다리)
//   진짜 애니웍스에는 가지 않는다 — window.wmDesktop.aw 를 흉내 낸 다리가 wwrDates · wwrFill · wwrSave 에 답하고 받은 것을 window.__aww 에 남긴다.
//   진짜 사이트는 PC 앱 엔진(desktop/anyworks.js)을 직접 불러 「넣기」 까지만 확인 (저장은 사람이).
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var ok = 0, fail = 0, errs = [], B = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function fakeDesk() {
    window.__aww = { calls: [], dates: [{ date: '2026-11-13', seq: '643' }, { date: '2026-11-06', seq: '642' }], site: { '2026-11-13': { left: 'x'.repeat(120), right: 'y'.repeat(80) } }, filled: null, v: 3, cred: true };
    var PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    window.wmDesktop = { isDesktop: true, platform: 'win32', aw: function (cmd, a) {
      var W = window.__aww; W.calls.push({ cmd: cmd, a: a || null });
      return new Promise(function (res) { setTimeout(function () {
        if (cmd === 'status') return res({ ok: true, v: W.v, hasCred: W.cred, id: 'tester', safe: true });
        if (cmd === 'wwrDates') return res({ ok: true, dates: W.dates.slice() });
        if (cmd === 'wwrFill') {
          var hit = W.dates.filter(function (x) { return x.date === a.date; })[0], created = false;
          if (!hit) { if (!a.create) return res({ ok: false, code: 'NO_DATE', error: a.date + ' 없음' }); hit = { date: a.date, seq: '644' }; W.dates.unshift(hit); created = true; }
          var old = W.site[a.date] || { left: '', right: '' };
          W.filled = { date: a.date, left: a.left, right: a.right };
          return res({ ok: true, seq: hit.seq, date: a.date, created: created, before: { left: old.left.length, right: old.right.length }, after: { left: a.left.length, right: a.right.length }, png: PNG });
        }
        if (cmd === 'wwrSave') {
          if (!W.filled) return res({ ok: false, code: 'NOT_FILLED', error: '먼저 넣기' });
          var f = W.filled; W.filled = null; W.site[f.date] = { left: f.left, right: f.right };
          return res({ ok: true, seq: '644', date: f.date, messages: ['saved ok'], verified: true, sent: { left: f.left.length, right: f.right.length }, saved: { left: f.left.length, right: f.right.length } });
        }
        res({ ok: false, error: '?' });
      }, 30); });
    } };
  }
  async function open(desk) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-aww' + Date.now() + (desk ? 'd' : 'w')) });
    B.push(b);
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(e.message); });
    p.on('dialog', function (d) { errs.push('기본 알림 창이 뜸: ' + d.message()); d.dismiss(); });
    if (desk) await p.evaluateOnNewDocument(fakeDesk);
    await p.setViewport({ width: 1500, height: 950 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.evaluate(function () { window.__wmDialogUi = true; try { localStorage.removeItem('wr-author-last-id'); } catch (e) {} });
    await p.click('#pageTabs [data-page="team"]'); await p.click('#tabWeeklyReport');
    await p.waitForSelector('#wrAuSave');
    await wait(600);
    await p.click('#wrAuMoreWrap > button'); await p.click('#wrAuNew'); await wait(250);
    await p.$eval('#wrAuStart', function (e) { e.value = '2026-11-16'; e.dispatchEvent(new Event('change')); });
    await p.$eval('#wrAuEnd', function (e) { e.value = '2026-11-20'; e.dispatchEvent(new Event('change')); });
    return p;
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var setEd = function (p, id, v) { return p.$eval(id, function (e, v) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, v); };
  var menu = async function (p) { await p.click('#wrAuMoreWrap > button'); await wait(120); await p.click('#wrAuAw'); };
  try {
    var p = await open(true);
    check(await p.evaluate(function () { return !!document.getElementById('wrAuAw') && /애니웍스에 올리기/.test(document.getElementById('wrAuAw').textContent); }), '⋯ 메뉴에 🌐 애니웍스에 올리기');

    /* 한 칸이 비면 올리지 않음 */
    await setEd(p, '#wrAuEditorLast', '[개발]\n- [P사] 배선 점검 #완료 @관리자');
    await menu(p); await wait(500);
    check(!(await p.$('#awwModal')) && await p.evaluate(function () { return !window.__aww.calls.length; }), '금주 칸이 비면 창을 열지 않음');

    /* 창 — 기본 등록일은 작성 주차의 금요일 */
    await setEd(p, '#wrAuEditorCur', '[개발]\n- [Q사] 모션 튜닝 30% @관리자');
    await menu(p);
    check(await until(p, function () { return !!document.querySelector('#awwBox [data-aww-d]'); }), '창이 뜨고 애니웍스 날짜 목록이 보임');
    var v0 = await p.evaluate(function () { return { d: document.getElementById('awwDate').value, day: document.getElementById('awwDay').textContent, chips: document.querySelectorAll('[data-aww-d]').length, fill: document.getElementById('awwFill').disabled, save: document.getElementById('awwSave').disabled }; });
    check(v0.d === '2026-11-20' && /아직 없음/.test(v0.day) && !/금요일이 아님/.test(v0.day) && v0.chips === 2 && !v0.fill && v0.save, '등록일 = 그 주 금요일(11/20) · 아직 없음 표시 · ② 는 잠김 ' + JSON.stringify(v0));

    /* 있는 날짜 고르기 → 넣기 → 캡처 · 이미 있던 내용 경고 */
    await p.click('[data-aww-d="2026-11-13"]');
    check(await p.evaluate(function () { return document.getElementById('awwDate').value === '2026-11-13' && /있는 날짜/.test(document.getElementById('awwDay').textContent); }), '칩을 누르면 그 날짜로');
    await p.click('#awwFill');
    check(await until(p, function () { return !!document.querySelector('#awwCap img') && !document.getElementById('awwSave').disabled; }), '① 넣기 → 애니웍스 화면 캡처 · ② 열림');
    var f1 = await p.evaluate(function () { var c = window.__aww.calls.filter(function (x) { return x.cmd === 'wwrFill'; })[0].a; return { date: c.date, create: c.create, l: /wrp/.test(c.left) && /배선 점검/.test(c.left) && /지난주 실적/.test(c.left), r: /wrp/.test(c.right) && /모션 튜닝/.test(c.right) && /금주 계획/.test(c.right), style: /<style/.test(c.left), warn: document.getElementById('awwMsg').textContent }; });
    check(f1.date === '2026-11-13' && !f1.create && f1.l && f1.r && f1.style, '왼쪽 = 지난주 실적 미리보기 HTML · 오른쪽 = 금주 계획 미리보기 HTML ' + JSON.stringify({ l: f1.l, r: f1.r, style: f1.style }));
    check(/아직 저장 전/.test(f1.warn) && /이미 저장해 둔 내용/.test(f1.warn) && /120자/.test(f1.warn), '저장 전 안내 · 이미 있던 내용 경고 ' + f1.warn.slice(0, 90));

    /* 날짜를 바꾸면 다시 ① 부터 */
    await p.$eval('#awwDate', function (e) { e.value = '2026-11-06'; e.dispatchEvent(new Event('change')); });
    check(await p.evaluate(function () { return document.getElementById('awwSave').disabled && !document.querySelector('#awwCap img'); }), '날짜를 바꾸면 ② 가 잠기고 캡처가 사라짐');

    /* 없는 날짜 — 새로 등록할지 묻고, 취소하면 아무것도 안 함 */
    await p.$eval('#awwDate', function (e) { e.value = '2026-11-20'; e.dispatchEvent(new Event('change')); });
    var nFill = function () { return p.evaluate(function () { return window.__aww.calls.filter(function (x) { return x.cmd === 'wwrFill'; }).length; }); };
    await p.click('#awwFill');
    await until(p, function () { return !!document.querySelector('.wmd .wmd-btn.ok'); }, null, 3000);
    var dlg = await p.evaluate(function () { var d = document.querySelector('.wmd'); return d ? { ok: d.querySelector('.wmd-btn.ok').textContent, t: d.textContent } : {}; });
    check(dlg.ok === '새로 등록' && /아직 없습니다/.test(dlg.t) && !/금요일이 아닙니다/.test(dlg.t), '없는 날짜 → 새로 등록할지 물음 ' + (dlg.t || '').slice(0, 70));
    await p.click('.wmd .wmd-btn:not(.ok)'); await wait(300);
    check(await nFill() === 1, '취소 → 넣지 않음');
    await p.click('#awwFill');
    await until(p, function () { return !!document.querySelector('.wmd .wmd-btn.ok'); }, null, 3000);
    await p.click('.wmd .wmd-btn.ok');
    check(await until(p, function () { return !!document.querySelector('#awwCap img') && !document.getElementById('awwSave').disabled; }), '새로 등록 → 넣기');
    var f2 = await p.evaluate(function () { var c = window.__aww.calls.filter(function (x) { return x.cmd === 'wwrFill'; })[1].a; return { create: c.create, date: c.date, msg: document.getElementById('awwMsg').textContent, chips: document.querySelectorAll('[data-aww-d]').length }; });
    check(f2.create === true && f2.date === '2026-11-20' && /새로 등록했습니다/.test(f2.msg) && !/이미 저장해 둔/.test(f2.msg) && f2.chips === 3, '새 날짜로 넣음 · 목록에 추가 ' + JSON.stringify({ c: f2.create, chips: f2.chips }));

    /* ② 저장 — 취소하면 저장 안 함 · 확인하면 한 번만 */
    await p.click('#awwSave');
    await until(p, function () { return !!document.querySelector('.wmd .wmd-btn.ok'); }, null, 3000);
    check(await p.evaluate(function () { return document.querySelector('.wmd .wmd-btn.ok').textContent === '저장'; }), '저장 확인 창');
    await p.click('.wmd .wmd-btn:not(.ok)'); await wait(300);
    check(await p.evaluate(function () { return !window.__aww.calls.some(function (x) { return x.cmd === 'wwrSave'; }) && !document.getElementById('awwSave').disabled; }), '취소 → 저장하지 않음');
    await p.click('#awwSave');
    await until(p, function () { return !!document.querySelector('.wmd .wmd-btn.ok'); }, null, 3000);
    await p.click('.wmd .wmd-btn.ok');
    check(await until(p, function () { var m = document.querySelector('#awwMsg .awg-msg.ok'); return !!m && /저장 완료/.test(m.textContent) && /확인했습니다/.test(m.textContent); }), '저장 완료 · 다시 열어 확인');
    var s1 = await p.evaluate(function () { var W = window.__aww; return { n: W.calls.filter(function (x) { return x.cmd === 'wwrSave'; }).length, site: !!W.site['2026-11-20'] && /배선 점검/.test(W.site['2026-11-20'].left) && /모션 튜닝/.test(W.site['2026-11-20'].right), save: document.getElementById('awwSave').disabled }; });
    check(s1.n === 1 && s1.site && s1.save, '애니웍스에 한 번만 저장 · ② 다시 잠김 ' + JSON.stringify(s1));
    await p.screenshot({ path: path.join(__dirname, '.shots', 'e2e107-aww.png') }).catch(function () {});

    /* 금요일이 아닌 날짜 표시 · 예전 PC 앱 */
    await p.$eval('#awwDate', function (e) { e.value = '2026-11-19'; e.dispatchEvent(new Event('change')); });
    check(await p.evaluate(function () { return /금요일이 아님/.test(document.getElementById('awwDay').textContent); }), '금요일이 아니면 표시');
    await p.evaluate(function () { document.querySelector('#awwModal [data-wm-close]').click(); window.__aww.v = 2; });
    await wait(400);
    await menu(p);
    check(await until(p, function () { var m = document.querySelector('#awwMsg'); return !!m && /새 버전이 필요/.test(m.textContent) && document.getElementById('awwFill').disabled; }), '예전 PC 앱 — 새 버전 안내 · 단추 잠김');

    /* 웹 브라우저 (PC 앱 아님) */
    var w = await open(false);
    await setEd(w, '#wrAuEditorLast', '[개발]\n- [P사] a');
    await setEd(w, '#wrAuEditorCur', '[개발]\n- [Q사] b');
    await menu(w); await wait(500);
    check(!(await w.$('#awwModal')) && await w.evaluate(function () { return /PC 앱/.test(document.body.textContent); }), '웹 브라우저 — 창 대신 「PC 앱에서」 안내');

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { for (var i = 0; i < B.length; i++) await B[i].close(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
