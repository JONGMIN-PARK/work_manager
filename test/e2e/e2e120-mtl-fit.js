// 🎯 내 업무 타임라인 높이 (v13.538) — 옆 달력에서 날짜를 고르면 📌 고른 날 목록까지 다 보이게 타임라인 높이를 맞춤 (달력 안 굴림 없음)
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0, ids = [];
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'lee@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    // 같은 날 마감 할 일 12개 · 다른 날 1개
    var days = await page.evaluate(async function () {
      var d = function (n) { var x = new Date(); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
      var out = [];
      for (var i = 0; i < 12; i++) out.push((await apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: '높이 시험 ' + i, dueDate: d(3) }) })).data.id);
      out.push((await apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: '하루 하나', dueDate: d(5) }) })).data.id);
      return { ids: out, many: d(3), one: d(5) };
    });
    ids = days.ids;
    await page.evaluate(function () { try { localStorage.setItem('mw-ntl', 'true'); } catch (_) {} setPage('mywork'); });
    await page.waitForSelector('#mwTimeline .mtl-cal .mtl-cd', { timeout: 15000 });
    await wait(800);
    var m = function () {
      return page.evaluate(function () {
        var main = document.querySelector('#mwTimeline .mtl-main'), cal = document.querySelector('#mwTimeline .mtl-cal');
        return { main: Math.round(main.getBoundingClientRect().height), calScroll: cal.scrollHeight - cal.clientHeight, list: (cal.querySelector('.mtl-dl') || { querySelectorAll: function () { return []; } }).querySelectorAll('.mtl-dli').length };
      });
    };
    var pick = function (d) { return page.evaluate(function (d) { var c = document.querySelector('#mwTimeline .mtl-cd[data-cd="' + d + '"]'); c.click(); }, d); };
    var h0 = await m();
    await pick(days.many); await wait(500);
    var h1 = await m();
    check(h1.list === 12 && h1.calScroll <= 1, '12개 날 고름 — 목록이 달력 안에서 굴리지 않고 다 보임 ' + JSON.stringify(h1));
    check(h1.main > h0.main, '타임라인 높이가 늘어남 ' + h0.main + ' → ' + h1.main);
    await pick(days.one); await wait(500);
    var h2 = await m();
    check(h2.list === 1 && h2.main < h1.main && h2.calScroll <= 1, '1개 날 — 높이가 다시 줄어듦 ' + h1.main + ' → ' + h2.main);
    // 달 넘기기에도
    await page.evaluate(function () { document.querySelector('#mwTimeline .mtl-cal [data-cn="1"]').click(); }); await wait(400);
    var h3 = await m();
    check(h3.calScroll <= 1, '다음 달로 넘겨도 달력이 다 보임 ' + JSON.stringify(h3));
    // 화면 85% 까지만
    check(h1.main <= Math.round(1000 * 0.85) + 2, '화면 높이 85% 이하 ' + h1.main);
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    try { await page.evaluate(async function (ids) { for (var i = 0; i < ids.length; i++) await apiFetch('/api/my-work/todos/' + ids[i], { method: 'DELETE' }); await apiFetch('/api/my-work/trash', { method: 'DELETE' }); }, ids); } catch (_) {}
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
