// 🖍 문서 칠판 · ▶ 발표 모드 (v13.526) — 크게 보기 ✏️ 칠판(펜 · 글자 · 그림 붙여넣기 · 옮기기 · 지우기 · 되돌리기 · 자동 저장)
//   ▶ 발표(한 쪽씩 · ← → · 쪽 맞춤 · 발표 중 그리기 · Esc) · 다시 열면 그대로 · 목록 🖍 · 남(고칠 권한 없음)은 저장 403
var path = require('path'), fs = require('fs'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var FIX = path.join(__dirname, 'fixtures-docprev');
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var byId = {};
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    var m = /\/api\/docs\/files\/([^/]+)\/raw$/.exec(req.url().split('?')[0]);
    if (m && byId[decodeURIComponent(m[1])]) return req.respond({ status: 200, contentType: 'application/octet-stream', body: fs.readFileSync(path.join(FIX, byId[decodeURIComponent(m[1])])) });
    req.continue();
  });
  async function annot(id) { return page.evaluate(function (id) { return apiFetch('/api/docs/files/' + id + '/annot').then(function (r) { return r.data; }); }, id); }
  async function drag(sel, from, to, idx) {   // 쪽 안 비율 좌표로 끌기
    var r = await page.evaluate(function (sel, idx) { var el = document.querySelectorAll(sel)[idx || 0]; var b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, sel, idx);
    await page.mouse.move(r.x + r.w * from[0], r.y + r.h * from[1]);
    await page.mouse.down();
    for (var i = 1; i <= 6; i++) await page.mouse.move(r.x + r.w * (from[0] + (to[0] - from[0]) * i / 6), r.y + r.h * (from[1] + (to[1] - from[1]) * i / 6));
    await page.mouse.up();
  }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    var made = await page.evaluate(async function (names) {
      var me = await apiFetch('/api/auth/me'); var u = me.data || me; var tid = u.tenant_id || u.tenantId || (u.user && (u.user.tenant_id || u.user.tenantId));
      var pid = 'e2e-db-' + Date.now();
      await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ id: pid, name: '칠판 시험', status: 'active', checklists: false, visibility: 'tenant' }) });
      var fo = await apiFetch('/api/docs/folders', { method: 'POST', body: JSON.stringify({ projectId: pid, name: '자료' }) });
      var ids = {};
      for (var i = 0; i < names.length; i++) {
        var n = names[i], ext = n.split('.').pop();
        var r = await apiFetch('/api/docs/files', { method: 'POST', body: JSON.stringify({ id: 'db-' + i + '-' + Date.now(), projectId: pid, folderId: fo.data.id, name: n, ext: ext, size: 1000, storageKey: 'tenants/' + tid + '/docs/b' + i + '.' + ext }) });
        ids[r.data.id] = n;
      }
      return { pid: pid, ids: ids };
    }, ['발표.pptx', '도면.pdf']);
    byId = made.ids;
    var idOf = function (n) { for (var k in byId) if (byId[k] === n) return k; };
    var ppt = idOf('발표.pptx'), pdf = idOf('도면.pdf');

    // 1) 크게 보기 → ✏️ 칠판
    await page.evaluate(function (id) { return docViewFile(id); }, ppt);
    await page.waitForSelector('#docViewModal .dp-slide', { timeout: 15000 });
    await page.waitForFunction(function () { var b = document.querySelector('#docViewModal .dpv-board-b'); return b && !b.disabled; }, { timeout: 8000 });
    await page.click('#docViewModal .dpv-board-b');
    var st = await page.evaluate(function () { var d = document.querySelector('#docViewModal .dpv-bdock'); return { dock: d && !d.hidden, tool: document.querySelector('#docViewModal .db-b.on') && document.querySelector('#docViewModal .db-b.on').dataset.tool, svgs: document.querySelectorAll('#docViewModal .db-svg').length }; });
    check(st.dock && st.tool === 'pen' && st.svgs === 3, '✏️ 칠판 — 도구 막대 · 펜 · 쪽마다 그림판 ' + JSON.stringify(st));
    // 펜으로 긋기
    await drag('#docViewModal .dp-pg', [0.2, 0.6], [0.5, 0.7], 0);
    var n1 = await page.evaluate(function () { return document.querySelectorAll('#docViewModal .dp-pg')[0].querySelectorAll('.db-svg path:not(.db-hit)').length; });
    check(n1 === 1, '펜 — 선 1개');
    await wait(1600);
    var a1 = await annot(ppt);
    check(a1.canEdit && a1.pages[0] && a1.pages[0].items.length === 1 && a1.pages[0].items[0].k === 'pen', '자동 저장 — 0쪽 펜 1 ' + JSON.stringify(a1.pages[0] && a1.pages[0].items.map(function (x) { return x.k; })));
    var stt = await page.evaluate(function () { return document.querySelector('#docViewModal .db-state').textContent; });
    check(/저장됨/.test(stt), '막대 — ☁ 저장됨 ' + stt);
    // 글자
    await page.evaluate(function () { document.querySelector('#docViewModal [data-tool="text"]').click(); });
    var r0 = await page.evaluate(function () { var b = document.querySelectorAll('#docViewModal .dp-pg')[0].getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    await page.mouse.click(r0.x + r0.w * 0.6, r0.y + r0.h * 0.3);
    await page.waitForSelector('#docViewModal .db-ta', { timeout: 3000 });
    await page.keyboard.type('검토 필요');
    await page.keyboard.press('Enter');
    var tx = await page.evaluate(function () { var t = document.querySelector('#docViewModal .db-text'); return t && t.textContent; });
    check(tx === '검토 필요', '글자 — 쓰고 Enter ' + tx);
    // 캡처 그림 붙여넣기 (Ctrl+V)
    var png = fs.readFileSync(path.join(FIX, '사진.png')).toString('base64');
    await page.evaluate(function (b64) {
      var bin = atob(b64), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var dt = new DataTransfer(); dt.items.add(new File([u8], 'image.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png);
    await page.waitForSelector('#docViewModal .db-img', { timeout: 5000 }).catch(function () {});
    var im = await page.evaluate(function () { var i = document.querySelector('#docViewModal .db-img'); return i && { x: +i.getAttribute('x'), sel: !!document.querySelector('#docViewModal .db-selbox'), tool: document.querySelector('#docViewModal .db-b.on').dataset.tool }; });
    check(im && im.sel && im.tool === 'select', '그림 붙여넣기 — 들어가고 골라짐 ' + JSON.stringify(im));
    // 끌어 옮기기
    var ib = await page.evaluate(function () { var b = document.querySelector('#docViewModal .db-img').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await page.mouse.move(ib.x, ib.y); await page.mouse.down();
    for (var k = 1; k <= 5; k++) await page.mouse.move(ib.x - 20 * k, ib.y + 4 * k);
    await page.mouse.up();
    var im2 = await page.evaluate(function () { return +document.querySelector('#docViewModal .db-img').getAttribute('x'); });
    check(im2 < im.x - 30, '그림 끌어 옮기기 ' + im.x + ' → ' + im2);
    // Delete → 지움, Ctrl+Z → 되살림
    await page.keyboard.press('Delete');
    var gone = await page.evaluate(function () { return !document.querySelector('#docViewModal .db-img'); });
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    var back = await page.evaluate(function () { return !!document.querySelector('#docViewModal .db-img'); });
    check(gone && back, 'Delete 지우기 · Ctrl+Z 되돌리기');
    await wait(1600);
    var a2 = await annot(ppt);
    var kinds = (a2.pages[0].items || []).map(function (x) { return x.k; }).sort().join(',');
    check(kinds === 'img,pen,text' && /^data:image\/(webp|jpeg)/.test(a2.pages[0].items.filter(function (x) { return x.k === 'img'; })[0].src), '저장 — 펜 · 글자 · 그림(줄여서) ' + kinds);

    // 2) ▶ 발표
    await page.evaluate(function () { document.querySelector('#docViewModal .dpv-pres-b').click(); });
    await wait(500);
    var p1 = await page.evaluate(function () {
      var m = document.getElementById('docViewModal'), cur = m.querySelectorAll('.dp-pg.cur'), vis = Array.prototype.filter.call(m.querySelectorAll('.dp-pg'), function (x) { return x.offsetParent !== null; });
      var r = cur[0] && cur[0].getBoundingClientRect();
      return { pres: m.classList.contains('pres'), cur: cur.length, vis: vis.length, no: m.querySelector('.dpv-pno').textContent, w: r && Math.round(r.width), h: r && Math.round(r.height), head: m.querySelector('.dpv-head').offsetParent !== null };
    });
    check(p1.pres && p1.cur === 1 && p1.vis === 1 && p1.no === '1 / 3' && !p1.head, '발표 — 한 쪽만 · 1 / 3 · 머리 숨김 ' + JSON.stringify(p1));
    check(p1.h >= 860 || p1.w >= 1370, '발표 — 화면에 꽉 맞춤 ' + p1.w + '×' + p1.h);
    await page.keyboard.press('Escape');   // 펜 도구 끄기 (발표는 그대로)
    await page.keyboard.press('ArrowRight');
    await wait(500);
    var p2 = await page.evaluate(function () { var m = document.getElementById('docViewModal'), c = m.querySelector('.dp-pg.cur'); var s = c.querySelector('.dp-slide'); return { no: m.querySelector('.dpv-pno').textContent, pres: m.classList.contains('pres'), t: s && s.textContent, sw: s && Math.round(s.getBoundingClientRect().width), cw: Math.round(c.getBoundingClientRect().width) }; });
    check(p2.pres && p2.no === '2 / 3' && /추진 일정/.test(p2.t || '') && Math.abs(p2.sw - p2.cw) < 3, '→ 다음 슬라이드 · 크기 맞춤 ' + JSON.stringify(p2));
    // 발표 중 그리기 (막대에서 형광펜)
    await page.evaluate(function () { document.querySelector('#docViewModal .dpv-pbar [data-tool="hl"]').click(); });
    await drag('#docViewModal .dp-pg.cur', [0.3, 0.3], [0.7, 0.3]);
    await wait(1600);
    var a3 = await annot(ppt);
    check(a3.pages[1] && a3.pages[1].items.length === 1 && a3.pages[1].items[0].a, '발표 중 형광펜 → 2쪽에 저장');
    await page.mouse.move(700, 450); await wait(300); await page.screenshot({ path: path.join(__dirname, '.shots', 'db-pres.png') });
    await page.keyboard.press('Escape');   // 도구 끄기
    await page.keyboard.press('Escape');   // 발표 끝
    await wait(300);
    var p3 = await page.evaluate(function () { var m = document.getElementById('docViewModal'); return { open: !!m, pres: m && m.classList.contains('pres') }; });
    check(p3.open && !p3.pres, 'Esc — 발표 끝 (크게 보기는 그대로)');
    await page.evaluate(function () { docViewClose(); });

    // 3) 다시 열면 그대로
    await page.evaluate(function (id) { return docViewFile(id); }, ppt);
    await page.waitForFunction(function () { return document.querySelectorAll('#docViewModal .db-svg [data-id]').length >= 4; }, { timeout: 10000 }).catch(function () {});
    await page.evaluate(function () { docViewBoard(true); }); await wait(300); await page.screenshot({ path: path.join(__dirname, '.shots', 'db-view.png') });
    var re = await page.evaluate(function () { var p = document.querySelectorAll('#docViewModal .dp-pg'); return [p[0].querySelectorAll('.db-svg [data-id]:not(.db-hit)').length, p[1].querySelectorAll('.db-svg [data-id]:not(.db-hit)').length]; });
    check(re[0] === 3 && re[1] === 1, '다시 열면 표시 그대로 ' + JSON.stringify(re));
    await page.evaluate(function () { docViewClose(); });

    // 4) PDF 발표 — 다음 쪽도 그림
    await page.evaluate(function (id) { return docViewFile(id); }, pdf);
    await page.waitForSelector('#docViewModal .dp-page canvas', { timeout: 15000 });
    await page.waitForFunction(function () { var b = document.querySelector('#docViewModal .dpv-pres-b'); return b && !b.disabled; }, { timeout: 8000 });
    await page.evaluate(function () { docViewPresent(); });
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(function () { var c = document.querySelector('#docViewModal .dp-pg.cur canvas'); return c && c.width > 600; }, { timeout: 8000 }).catch(function () {});
    var pp = await page.evaluate(function () { var c = document.querySelector('#docViewModal .dp-pg.cur canvas'); return { no: document.querySelector('#docViewModal .dpv-pno').textContent, cw: c && c.width }; });
    check(pp.no === '2 / 2' && pp.cw > 600, 'PDF 발표 — 2쪽 선명하게 ' + JSON.stringify(pp));
    await page.keyboard.press('Escape');
    await page.evaluate(function () { docViewClose(); });

    // 5) 목록 🖍 · 남은 저장 못 함
    var list = await page.evaluate(function (pid) { return apiFetch('/api/docs/files?projectId=' + pid).then(function (r) { return r.data.map(function (f) { return [f.name, f.annot_pages]; }); }); }, made.pid);
    check(list.some(function (x) { return x[0] === '발표.pptx' && x[1] === 2; }), '목록 — 표시 있는 쪽 2 ' + JSON.stringify(list));
    var kimRes = await (async function () {
      var r = await fetch('http://localhost:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'kim@t.com', password: 'Test1234!' }) });
      var tok = (await r.json()).data.accessToken, H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
      var g = await fetch('http://localhost:3000/api/docs/files/' + ppt + '/annot', { headers: H }); var gj = await g.json();
      var p = await fetch('http://localhost:3000/api/docs/files/' + ppt + '/annot/0', { method: 'PUT', headers: H, body: JSON.stringify({ items: [], version: 1 }) });
      return { read: g.status, canEdit: gj.data && gj.data.canEdit, put: p.status };
    })();
    check(kimRes.read === 200 && kimRes.canEdit === false && kimRes.put === 403, '참여자 아님 — 보기만 · 저장 403 ' + JSON.stringify(kimRes));

    await page.evaluate(function (pid) { return apiFetch('/api/projects/' + pid, { method: 'DELETE' }); }, made.pid);
    var left = await page.evaluate(function (id) { return apiFetch('/api/docs/files/' + id + '/annot').then(function () { return 'still'; }, function (e) { return e.status || 'gone'; }); }, ppt);
    check(left !== 'still', '프로젝트 지우면 표시도 ' + left);
    var bad = errs.filter(function (e) { return !/ResizeObserver/.test(e); });
    check(!bad.length, '페이지 오류 없음 ' + bad.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
