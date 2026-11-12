// 🧩 장치 계층 구성 — 되돌리기 · 팔레트 · 내 항목 · 아이콘/분류 · 범례 (v13.479)
var path = require('path'), fs = require('fs');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var SHOT = path.join(__dirname, '.shots');
(async function () {
  fs.mkdirSync(SHOT, { recursive: true });
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function until(fn, arg, ms) { return page.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var topo = function () { return page.evaluate(function () { return JSON.parse(JSON.stringify(_ps.sheet.topo || null)); }); };
  var hist = function () { return page.evaluate(function () { var q = function (k) { var b = document.querySelector('#psTopo [data-pt="' + k + '"]'); return b ? !b.disabled : null; }; return { u: PST.hist.undo.length, r: PST.hist.redo.length, ub: q('undo'), rb: q('redo'), vb: q('revert') }; }); };
  try {
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!'); await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    await page.evaluate(function () { window.__wmDialogUi = true; try { localStorage.removeItem('wm-topo-items'); } catch (e) {} });
    var pid = await page.evaluate(async function () {
      try { await apiFetch('/api/settings/topo_items', { method: 'PUT', body: JSON.stringify({ value: { items: [] } }) }); } catch (e) {}
      var p = (await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'E2E 구성 편집 ' + Date.now(), orderNo: 'TPE-' + Date.now() }) })).data;
      var sheet = { v: 2, templateId: 'builtin', templateVersion: 1, remarks: {}, status: {}, extra: {}, values: { ipc_model: 'IPC-610H', ipc_lan: '2', mc_vendor: 'Ajinextek', mc_model: 'PCIe-Rxx04-IP', mc_form: 'PCIe 보드', mc_axes: '2', mc_qty: '1', hub_model: 'TL-SG108',
        ext_devices: [{ id: 'r1', name: '얼라인 카메라', iface: 'Ethernet', vendor: 'Basler ace' }], axes: [{ id: 'a1', name: 'X', ch: '0', drv_model: 'L7NH' }, { id: 'a2', name: 'Y', ch: '1', drv_model: 'L7NH' }] } };
      await apiFetch('/api/projects/' + p.id + '/specs', { method: 'PATCH', body: JSON.stringify({ changes: [{ path: [], from: null, to: sheet }] }) });
      return p.id;
    });
    await page.evaluate(function () { try { localStorage.setItem('pd-panel-mode', 'full'); } catch (e) {} setPage('project'); setMode('pipeline'); });
    await page.evaluate(function (pid) { return showProjectDetail(pid); }, pid); await wait(1200);
    await page.evaluate(function () { var t = document.getElementById('pdTabSpec'); if (t) t.click(); });
    await until(function () { return !!document.getElementById('psTopo') && _ps && _ps.canEdit; }, null, 15000);

    // ── 되돌리기 기록 ──
    await page.click('#psTopo [data-pt="seed"]');
    await until(function () { return !!document.querySelector('#pstMap svg'); });
    await page.evaluate(function () { PST.mode = 'h'; PST.modeSet = true; psTopoRender(); });
    var h = await hist(), t0 = await topo();
    check(h.u === 1 && h.ub === true && h.rb === false && h.vb === true, '초안 뒤 — ↶ 켜짐 · ↷ 꺼짐 · ⟲ 켜짐 ' + JSON.stringify(h));
    await page.click('#psTopo [data-pt="undo"]');
    check(await until(function () { return !_ps.sheet.topo && !!document.querySelector('#psTopo [data-pt="seed"]'); }), '↶ — 초안 만들기 전(빈 상태)으로');
    h = await hist(); check(h.rb === true, '빈 상태에서도 ↷ 단추가 보임 ' + JSON.stringify(h));
    await page.click('#psTopo [data-pt="redo"]');
    check(await until(function (n) { return _ps.sheet.topo && _ps.sheet.topo.nodes.length === n; }, t0.nodes.length), '↷ — 초안이 그대로 돌아옴');
    check(JSON.stringify(await topo()) === JSON.stringify(t0), '돌아온 것이 글자 하나 안 틀리고 같음');

    // 이름 치기 — 여러 글자가 한 번으로 묶임 · Ctrl+Z
    var mcId = t0.nodes.filter(function (n) { return n.kind === 'motion'; })[0].id;
    await page.evaluate(function (id) { document.querySelector('#pstMap [data-id="' + id + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, mcId);
    await until(function (id) { return !!document.querySelector('.pst-ed[data-id="' + id + '"]'); }, mcId);
    var before = (await hist()).u, oldName = t0.nodes.filter(function (n) { return n.id === mcId; })[0].name;
    var nm = await page.$('.pst-ed input[data-f="name"]'); await nm.click({ clickCount: 3 }); await nm.type('메인 모션');
    h = await hist();
    check(h.u === before + 1, '이름 5글자 — 되돌리기 한 칸으로 묶임 (' + before + ' → ' + h.u + ')');
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    check(await until(function (a) { return _ps.sheet.topo.nodes.filter(function (n) { return n.id === a[0]; })[0].name === a[1]; }, [mcId, oldName]), 'Ctrl+Z — 이름이 원래대로');
    check(await page.evaluate(function () { var a = document.activeElement; return !!(a && a.dataset && a.dataset.f === 'name'); }), 'Ctrl+Z 뒤에도 커서가 그 칸에');
    await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control');
    check(await until(function (id) { return _ps.sheet.topo.nodes.filter(function (n) { return n.id === id; })[0].name === '메인 모션'; }, mcId), 'Ctrl+Y — 다시 「메인 모션」');

    // 지우기 → 되돌리기 (아래 장치까지)
    var nBefore = (await topo()).nodes.length;
    await page.click('.pst-ed [data-pt="del"]');
    await page.waitForSelector('.wmd-ov', { timeout: 5000 });
    await page.evaluate(function () { var b = Array.from(document.querySelectorAll('.wmd-ov button')).filter(function (x) { return !/취소|아니/.test(x.textContent); }).pop(); b.click(); });
    check(await until(function (n) { return _ps.sheet.topo.nodes.length < n; }, nBefore), '모션 카드 지움 (아래 장치까지)');
    await page.evaluate(function () { psTopoUndo(-1); });
    check(await until(function (n) { return _ps.sheet.topo.nodes.length === n; }, nBefore), '↶ — 지운 가지가 통째로 돌아옴');

    // ── 팔레트 ──
    await page.evaluate(function (id) { PST.sel = id; psTopoRender(); }, mcId);
    await page.click('#psTopo [data-pt="pal"]');
    check(await until(function () { return !!document.querySelector('#pstPal .pst-pal-s.rec [data-k="drive"]') && document.querySelectorAll('#pstPal .pst-pal-s[data-cat]').length >= 10; }), '＋ 장치 추가 — 팔레트: 흔히 붙는 것 + 분류별 타일');
    var tile = await page.evaluate(function () { var ti = document.querySelector('#pstPal .pst-tile .pst-ti'), r = ti.getBoundingClientRect(), sv = ti.querySelector('svg').getBoundingClientRect(); return { w: r.width, icon: sv.width, bg: getComputedStyle(ti).backgroundColor }; });
    check(tile.w >= 26 && tile.icon >= 16 && tile.bg !== 'rgba(0, 0, 0, 0)', '타일 아이콘 — 색 바탕 28px 칸 · 아이콘 18px ' + JSON.stringify(tile));
    await page.type('#pstPalQ', '카메라');
    check(await page.evaluate(function () { var v = Array.from(document.querySelectorAll('#pstPal .pst-tile[data-s]')).filter(function (b) { return !b.hidden; }); return v.length >= 1 && v.every(function (b) { return /카메라/.test(b.textContent); }); }), '종류 찾기 — 「카메라」만 남음');
    await page.evaluate(function () { var q = document.getElementById('pstPalQ'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); });
    var drv0 = (await topo()).nodes.filter(function (n) { return n.parent === mcId && n.kind === 'drive'; }).length;
    await page.click('#pstPal [data-pt="palstay"]');
    await page.click('#pstPal .pst-pal-s.rec [data-k="drive"]'); await wait(150);
    await page.click('#pstPal .pst-pal-s.rec [data-k="drive"]'); await wait(150);
    var tA = await topo();
    check(tA.nodes.filter(function (n) { return n.parent === mcId && n.kind === 'drive'; }).length === drv0 + 2 && await page.evaluate(function (id) { return PST.sel === id; }, mcId), '「같은 자리에 계속」 — 타일 두 번 → 드라이브 둘, 고른 장치 그대로');
    // 내 항목 — 직접 추가
    await page.click('#pstPal .pst-pal-s[data-cat="vision"] [data-pt="mineopen"]');
    await page.waitForSelector('#pstMineName');
    await page.type('#pstMineName', '이오나이저');
    await page.click('#pstPal .pst-mine [data-pt="mineico"][data-v="fan"]');
    await page.click('#pstPal .pst-mine [data-pt="mineadd"]');
    check(await until(function (id) { return _ps.sheet.topo.nodes.some(function (n) { return n.parent === id && n.kl === '이오나이저' && n.cat === 'vision' && n.ico === 'fan' && n.kind === 'device'; }); }, mcId), '직접 추가 — 「이오나이저」(비전 분류 · 팬 아이콘)가 붙음');
    check(await until(function () { return !!document.querySelector('#pstPal .pst-pal-s[data-cat="vision"] .pst-tile.mine') && JSON.parse(localStorage.getItem('wm-topo-items')).length === 1; }), '내 항목이 비전 분류에 남음');
    check(await page.evaluate(function () { return /이오나이저/.test(document.querySelector('#pstMap svg').textContent); }), '구성도에 종류 이름으로 표시');
    var saved = await page.evaluate(async function () { for (var i = 0; i < 20; i++) { var r = await apiFetch('/api/settings/topo_items'); if (r && r.data && r.data.items && r.data.items.length) return r.data.items[0]; await new Promise(function (x) { setTimeout(x, 200); }); } return null; });
    check(saved && saved.label === '이오나이저' && saved.cat === 'vision', '내 항목 — 계정에 저장 ' + JSON.stringify(saved));
    await page.click('#pstPal .pst-tile.mine [data-pt="palmine"]'); await wait(200);
    check((await topo()).nodes.filter(function (n) { return n.kl === '이오나이저'; }).length === 2, '내 항목 타일로 한 번 더');
    await page.screenshot({ path: path.join(SHOT, 'e2e91-palette.png') });
    await page.keyboard.press('Escape');
    check(await until(function () { return !document.getElementById('pstPal') && !!document.getElementById('psTopo'); }), 'Esc — 팔레트만 닫힘 (상세 창은 그대로)');

    // ── 아이콘 · 분류 바꾸기 ──
    var camId = tA.nodes.filter(function (n) { return n.kind === 'camera'; })[0].id;
    await page.evaluate(function (id) { PST.sel = id; psTopoRender(); }, camId);
    await page.click('.pst-ed [data-pt="icoopen"]');
    await page.waitForSelector('.pst-icg.ed');
    await page.click('.pst-icg.ed [data-v="laser"]');
    check(await until(function (id) { return _ps.sheet.topo.nodes.filter(function (n) { return n.id === id; })[0].ico === 'laser' && !document.querySelector('.pst-icg.ed'); }, camId), '아이콘 바꾸기 — 레이저 모양');
    await page.select('.pst-ed select[data-f="cat"]', 'io');
    check(await until(function (id) { return _ps.sheet.topo.nodes.filter(function (n) { return n.id === id; })[0].cat === 'io'; }, camId), '분류 바꾸기 — IO');
    var col = await page.evaluate(function (id) { var g = document.querySelector('#pstMap [data-id="' + id + '"]'); return Array.from(g.querySelectorAll('rect,path')).map(function (r) { return r.getAttribute('fill') || r.getAttribute('stroke'); }).join(' '); }, camId);
    check(col.indexOf(await page.evaluate(function () { return TOPO_CATS.io.fill; })) >= 0, '구성도 상자가 IO 색으로');
    // 흔히 붙는 것 칩
    var hubId = tA.nodes.filter(function (n) { return n.kind === 'hub'; })[0].id;
    await page.evaluate(function (id) { PST.sel = id; PST.stay = false; psTopoRender(); }, hubId);
    await page.click('.pst-ed .pst-rec[data-k="plc"]');
    check(await until(function (id) { var n = _ps.sheet.topo.nodes.filter(function (x) { return x.parent === id && x.kind === 'plc'; })[0]; return n && PST.sel === n.id; }, hubId), '＋ 아래에 칩 — PLC 가 붙고 그 장치가 골라짐');

    // ── 범례 ──
    check(await page.evaluate(function () { return document.querySelectorAll('#psTopo .pst-lg').length >= 5; }), '분류 범례 — 쓰인 분류와 개수');
    await page.click('#psTopo .pst-lg[data-v="drive"]');
    var dim = await page.evaluate(function () { var g = Array.from(document.querySelectorAll('#pstMap .tp-n')); var byId = {}; _ps.sheet.topo.nodes.forEach(function (n) { byId[n.id] = n; }); return { drv: g.filter(function (x) { return byId[x.dataset.id].kind === 'drive'; }).every(function (x) { return !x.getAttribute('opacity'); }), ax: g.filter(function (x) { return byId[x.dataset.id].kind === 'axis'; }).every(function (x) { return x.getAttribute('opacity'); }) }; });
    check(dim.drv && dim.ax, '범례 「드라이브」 — 드라이브만 선명 · 축은 흐리게 ' + JSON.stringify(dim));
    await page.click('#psTopo .pst-lg[data-v="drive"]');
    await page.screenshot({ path: path.join(SHOT, 'e2e91-map.png') });

    // ── 저장 → ⟲ 원래대로 ──
    await page.click('#pdSpecSaveBtn');
    check(await until(function () { return !_ps.dirty; }, null, 15000), '저장');
    var savedT = JSON.stringify(await topo());
    await page.evaluate(function () { psTopoRender(); });
    check((await hist()).vb === false, '저장 직후 — ⟲ 원래대로 꺼짐');
    await page.evaluate(function (id) { PST.sel = id; psTopoRender(); }, hubId);
    await page.click('.pst-ed .pst-rec[data-k="camera"]'); await wait(150);
    await page.evaluate(function () { psTopoUndo(-1); psTopoUndo(1); });
    await page.click('#psTopo [data-pt="revert"]');
    await page.waitForSelector('.wmd-ov', { timeout: 5000 });
    await page.evaluate(function () { var b = Array.from(document.querySelectorAll('.wmd-ov button')).filter(function (x) { return !/취소|아니/.test(x.textContent); }).pop(); b.click(); });
    check(await until(function (j) { return JSON.stringify(_ps.sheet.topo) === j; }, savedT), '⟲ 원래대로 — 저장된 모습과 같음');
    await page.evaluate(function () { psTopoUndo(-1); });
    check(await until(function (j) { return JSON.stringify(_ps.sheet.topo) !== j; }, savedT), '원래대로도 ↶ 로 다시 살림');
    // 다시 열어도 직접 만든 항목이 그대로
    await page.click('#pdSpecSaveBtn'); await until(function () { return !_ps.dirty; }, null, 15000);
    var again = await page.evaluate(async function (pid) { var r = await apiFetch('/api/projects/' + pid); var s = r.data && r.data.specs; var t = s && s.topo; return t ? t.nodes.filter(function (n) { return n.kl === '이오나이저' && n.cat === 'vision' && n.ico === 'fan'; }).length : -1; }, pid);
    check(again === 2, '서버에 저장 — 종류 이름 · 분류 · 아이콘 그대로 (' + again + ')');
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); try { await page.screenshot({ path: path.join(SHOT, 'e2e91-fail.png') }); } catch (x) {} }
  finally { await browser.close(); }
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
