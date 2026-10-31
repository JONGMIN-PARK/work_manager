// 내 업무 · 마인드맵 툴바 (v13.295) — 공통 틀 한 줄 · ⋯ 메뉴 동작 · 필터 창 · 편집기 머리 한 줄 · 휴대폰
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var SHOTS = path.join(__dirname, '.shots');
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.dismiss(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function ready() {
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
  }
  // 툴바 줄 수 · 넘침
  function line(sel) {
    return page.evaluate(function (sel) {
      var bar = document.querySelector(sel); if (!bar) return null;
      var vw = document.documentElement.clientWidth;
      var kids = Array.from(bar.children).filter(function (e) { return e.offsetParent; });
      var tops = kids.map(function (e) { var r = e.getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 10); });
      return { lines: new Set(tops).size, over: kids.some(function (e) { var r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; }), last: kids.slice(-2).map(function (e) { return e.classList.contains('hdr-pop') ? 'more' : e.classList.contains('wm-pri') ? 'pri' : e.tagName; }).join(',') };
    }, sel);
  }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { localStorage.removeItem('wm-last-view'); } catch (e) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await ready();

    // 🎯 내 업무
    await page.evaluate(function () { setPage('mywork'); }); await wait(1800);
    var mw = await line('#mMyWork .mw-head');
    var mwOut = await page.evaluate(function () { var b = document.querySelector('#mMyWork .mw-head'); return { tb: b.classList.contains('wm-tb'), seg: !!b.querySelector('.wm-seg [data-mwc-view="month"]'), vis: Array.from(b.querySelectorAll('button, select')).filter(function (e) { return e.offsetParent && !e.closest('.hdr-pop-menu') && !e.closest('.wm-seg') && !e.closest('.mw-sum'); }).length, inMenu: ['export', 'map', 'tg', 'trash'].every(function (k) { return !!b.querySelector('.hdr-pop-menu [data-mwio="' + k + '"]'); }) && !!b.querySelector('.hdr-pop-menu [data-mwc="feed"]') && !!b.querySelector('.hdr-pop-menu [data-mw="refresh"]') }; });
    check(mw && mw.lines === 1 && !mw.over && mw.last.split(',')[1] === 'more', '내 업무 툴바 한 줄 · 끝 ⋯ ' + JSON.stringify(mw));
    check(mwOut.tb && mwOut.seg && mwOut.inMenu && mwOut.vis <= 3, '내 업무 — 밖 조작 ' + mwOut.vis + '개 · 나머지 ⋯ ' + JSON.stringify(mwOut));
    await page.screenshot({ path: path.join(SHOTS, 'tb3-mywork.png'), clip: { x: 0, y: 110, width: 1400, height: 120 } });
    // ⋯ › 내보내기 — 펼침 메뉴가 화면 안(⋯ 단추 밑)에
    await page.click('#mwMoreWrap > button'); await wait(150);
    await page.click('#mwMoreWrap [data-mwio="export"]'); await wait(400);
    var ex = await page.evaluate(function () { var m = document.getElementById('mwioMenu'); if (!m) return null; var r = m.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), vis: r.width > 0 && r.top > 50 }; });
    check(ex && ex.vis && ex.left >= 0 && ex.left + ex.w <= 1400, '⋯ › 내보내기 — 메뉴가 ⋯ 밑에 ' + JSON.stringify(ex));
    await page.keyboard.press('Escape'); await page.click('.hdr-brand h1'); await wait(200);
    // ⋯ › 휴지통 · 보기 전환
    await page.click('#mwMoreWrap > button'); await page.click('#mwMoreWrap [data-mwio="trash"]'); await wait(800);
    check(await page.evaluate(function () { return !!document.querySelector('.wa-modal-overlay, #mwTrash, [id*="Trash"]'); }), '⋯ › 휴지통 열림');
    await page.evaluate(function () { document.querySelectorAll('.wa-modal-overlay').forEach(function (o) { o.remove(); }); });
    await page.click('#mMyWork [data-mwc-view="month"]'); await wait(1000);
    check(await page.evaluate(function () { return !!document.querySelector('#mMyWork .mwc-month') && document.querySelector('#mMyWork .wm-seg [data-mwc-view="month"]').classList.contains('on'); }), '보기 전환 — 월');
    await page.click('#mMyWork [data-mwc-view="list"]'); await wait(800);

    // 🧠 마인드맵 목록
    await page.evaluate(function () { setPage('mindmap'); if (typeof _mmRenderList === 'function') _mmRenderList(); }); await wait(1800);
    var ml = await line('#mindmapWrap .mm-list-tb');
    check(ml && ml.lines === 1 && !ml.over && ml.last === 'pri,more', '마인드맵 목록 툴바 한 줄 ' + JSON.stringify(ml));
    check(await page.evaluate(function () { return !document.querySelector('#mindmapWrap .mm-list-head') && /맵 \d+개/.test(document.getElementById('mmListCount').textContent); }), '제목 · 설명 줄 없앰 · 개수는 제목 옆');
    await page.click('#mmFltBtn'); await wait(150);
    await page.evaluate(function () { var s = document.querySelector('#mmListFilt [data-f="age"]'); s.value = 'old'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(400);
    var f = await page.evaluate(function () { return { open: document.getElementById('mmFltWrap').classList.contains('open'), n: (document.querySelector('#mmFltBtn .wm-flt-n') || {}).textContent }; });
    check(f.open && f.n === '1', '마인드맵 필터 — 바꿔도 열린 채 · 배지 1 ' + JSON.stringify(f));
    await page.screenshot({ path: path.join(SHOTS, 'tb3-mm-list.png'), clip: { x: 0, y: 110, width: 1400, height: 330 } });
    await page.click('#mmListFilt [data-act="fclear"]'); await wait(300);
    check(await page.evaluate(function () { return !_mmLV.age && !document.querySelector('#mmFltBtn .wm-flt-n'); }), '필터 모두 지우기');
    await page.click('.hdr-brand h1'); await wait(150);
    await page.click('#mmListMore > button'); await wait(150);
    check(await page.evaluate(function () { var b = document.querySelector('#mmListMore [data-act="import"]'); return !!(b && b.offsetParent); }), '⋯ › 가져오기 보임');
    await page.click('.hdr-brand h1');

    // 🧠 편집기 머리 — 한 줄
    var id = await page.evaluate(function () { return apiFetch('/api/mindmaps', { method: 'POST', body: JSON.stringify({ title: '툴바 확인용 아주 긴 제목의 마인드맵 ' + Date.now(), scope: 'personal' }) }).then(function (r) { return r.data.id; }); });
    await page.evaluate(function (id) { mmOpen(id); }, id); await wait(2200);
    var ed = await page.evaluate(function () { var t = document.querySelector('#mindmapWrap .mm-top'); var kids = Array.from(t.children).filter(function (e) { return e.offsetParent; }); var tops = kids.map(function (e) { var r = e.getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 10); }); return { lines: new Set(tops).size, h: Math.round(t.getBoundingClientRect().height) }; });
    check(ed.lines === 1, '편집기 머리 한 줄 ' + JSON.stringify(ed));
    await page.screenshot({ path: path.join(SHOTS, 'tb3-mm-editor.png'), clip: { x: 0, y: 110, width: 1400, height: 140 } });
    await page.evaluate(function (id) { return apiFetch('/api/mindmaps/' + id, { method: 'DELETE' }); }, id);

    // 휴대폰
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true }); await wait(300); await ready();
    await page.evaluate(function () { setPage('mywork'); }); await wait(1500);
    var p1 = await line('#mMyWork .mw-head');
    await page.screenshot({ path: path.join(SHOTS, 'tb3-phone-mywork.png'), clip: { x: 0, y: 0, width: 402, height: 360 } });
    await page.evaluate(function () { setPage('mindmap'); if (typeof _mmRenderList === 'function') _mmRenderList(); }); await wait(1500);
    var p2 = await line('#mindmapWrap .mm-list-tb');
    await page.screenshot({ path: path.join(SHOTS, 'tb3-phone-mm.png'), clip: { x: 0, y: 0, width: 402, height: 360 } });
    check(p1 && !p1.over && p2 && !p2.over, '휴대폰 — 넘침 없음 ' + JSON.stringify([p1, p2]));
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    await browser.close();
  }
})();
