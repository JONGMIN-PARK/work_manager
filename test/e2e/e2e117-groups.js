// 👥 그룹(TFT) 화면 (v13.535) — 내 그룹 창에서 만들기 → 📨 업무 보내기 · 🤝 함께 하기 · 🤝 같이 담당에서 그룹 하나로 모두
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0, gid = null, tid = null;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var T = Date.now();
  try {
    await page.setViewport({ width: 1500, height: 950 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(800);
    // 1) 내 그룹 → 새 그룹
    await page.evaluate(function () { return wgManage(); });
    await page.waitForSelector('#wgModal [data-wg="new"]', { timeout: 8000 });
    await page.evaluate(function () { document.querySelector('#wgModal [data-wg="new"]').click(); });
    await page.waitForSelector('#wgEditModal #wgName', { timeout: 8000 });
    await page.type('#wgEditModal #wgName', '증설 TFT ' + T);
    await page.evaluate(function () {   // 김 · 이 모두 — 누를 때마다 목록을 다시 그리므로 매번 다시 찾음
      for (var k = 0; k < 10; k++) { var c = document.querySelector('#wgEditModal .wp-p input:not(:checked)'); if (!c) break; c.click(); }
    });
    var n = await page.evaluate(function () { return document.querySelector('#wgEditModal #wgN').textContent; });
    await page.evaluate(function () { document.querySelector('#wgEditModal [data-go]').click(); });
    await page.waitForFunction(function (T) { return document.querySelector('#wgModal') && /증설 TFT/.test(document.querySelector('#wgModal').textContent) && !document.getElementById('wgEditModal'); }, { timeout: 10000 }, T).catch(function () {});
    var card = await page.evaluate(function () { var c = [].filter.call(document.querySelectorAll('#wgModal .wg-card'), function (x) { return /증설 TFT/.test(x.textContent); })[0]; return c && { t: c.textContent, n: c.querySelectorAll('.wg-mc').length }; });
    check(card && card.n === 3 && /👑/.test(card.t), '새 그룹 — 리더 포함 3명 ' + n + ' ' + JSON.stringify(card));
    gid = await page.evaluate(function (T) { return WG.list.filter(function (g) { return g.name === '증설 TFT ' + T; })[0].id; }, T);
    await page.evaluate(function () { var m = document.getElementById('wgModal'); m._wmClose ? m._wmClose() : m.remove(); });

    // 2) 📨 업무 보내기 — 그룹 단추로 모두
    await page.evaluate(function () { return wrqOpen({ type: 'order' }); });
    await page.waitForSelector('#wrqModal .wrq-who-in', { timeout: 8000 });
    await page.focus('#wrqModal .wrq-who-in');
    await page.waitForSelector('#wrqModal [data-grp]', { timeout: 5000 }).catch(function () {});
    await page.evaluate(function (gid) { document.querySelector('#wrqModal [data-grp="' + gid + '"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); }, gid);
    var chips = await page.evaluate(function () { return document.querySelectorAll('#wrqModal .wrq-chip').length; });
    check(chips === 2, '업무 보내기 — 👥 그룹 하나로 구성원 2명(나 빼고) ' + chips);
    await page.evaluate(function () { document.querySelector('#wrqModal .wrq-type[data-t="transfer"]').click(); });
    await page.evaluate(function () { var i = document.querySelector('#wrqModal .wrq-who-in'); i.value = ''; i.dispatchEvent(new Event('input')); });
    var dis = await page.evaluate(function (gid) { var b = document.querySelector('#wrqModal [data-grp="' + gid + '"]'); return b && b.disabled; }, gid);
    check(dis, '이관은 한 사람 — 그룹 단추 막힘');
    await page.evaluate(function () { var m = document.getElementById('wrqModal'); m._wmClose ? m._wmClose() : m.remove(); });

    // 3) 🤝 함께 하기 — 그룹으로 모두 고르기 · 이름 채움
    await page.evaluate(function () { return wpStart({}); });
    await page.waitForSelector('#wpStartModal [data-wgp]', { timeout: 8000 });
    await page.evaluate(function (gid) { document.querySelector('#wpStartModal [data-wgp="' + gid + '"]').click(); }, gid);
    var st = await page.evaluate(function () { return { n: document.querySelector('#wpStartModal #wpN').textContent, t: document.querySelector('#wpStartModal #wpTitle').value }; });
    check(st.n === '2명' && /증설 TFT/.test(st.t), '함께 하기 — 그룹으로 2명 · 제목 채움 ' + JSON.stringify(st));
    await page.evaluate(function (gid) { document.querySelector('#wpStartModal [data-wgp="' + gid + '"]').click(); }, gid);
    check(await page.evaluate(function () { return document.querySelector('#wpStartModal #wpN').textContent === ''; }), '한 번 더 누르면 모두 풀기');
    await page.evaluate(function () { var m = document.getElementById('wpStartModal'); m._wmClose ? m._wmClose() : m.remove(); });

    // 4) 🤝 같이 담당 — 그룹 구성원 모두
    tid = await page.evaluate(function (T) { return apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: 'TFT 할 일 ' + T }) }).then(function (r) { return r.data.id; }); }, T);
    await page.evaluate(function () { setPage('mywork'); });
    await page.waitForFunction(function (tid) { return typeof _mw !== 'undefined' && _mw.data && (_mw.data.data || []).some(function (x) { return x.id === tid; }); }, { timeout: 15000 }, tid);
    await page.evaluate(function (tid) { var it = _mw.data.data.filter(function (x) { return x.id === tid; })[0]; wpPickPerson(it); }, tid);
    await page.waitForSelector('#wpPickModal [data-wgp]', { timeout: 8000 });
    await page.evaluate(function (gid) { document.querySelector('#wpPickModal [data-wgp="' + gid + '"]').click(); }, gid);
    await page.waitForFunction(function (tid) { var it = (_mw.data.data || []).filter(function (x) { return x.id === tid; })[0]; return it && it.partners && it.partners.length === 2; }, { timeout: 10000 }, tid).catch(function () {});
    var pn = await page.evaluate(function (tid) { var it = (_mw.data.data || []).filter(function (x) { return x.id === tid; })[0]; return it && it.partners ? it.partners.length : 0; }, tid);
    check(pn === 2, '같이 담당 — 그룹 하나로 2명 ' + pn);
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    try { await page.evaluate(function (gid, tid) { return Promise.all([gid ? apiFetch('/api/groups/' + gid, { method: 'DELETE' }) : null, tid ? apiFetch('/api/my-work/todos/' + tid, { method: 'DELETE' }) : null]); }, gid, tid); } catch (_) {}
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
