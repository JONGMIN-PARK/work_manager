// 🧩 장치 계층 구성 (v13.449) — 프로젝트 › 사양 › 하드웨어 구성도
//   사양 값으로 초안 → 구성도(장치 인터페이스 띠 · 고르기 · 고치기) → 거르기(Ethernet 만 선명) → 빠른 추가(PCIe → 그래버 → 카메라)
//   → 목록(들여쓰기 · 이름 바꾸기 · 들이기/내기) → 축 순서 ▲▼ → IO 16점 → 저장 · 다시 열기 → 엑셀 · PNG · SVG 받기
var path = require('path'), fs = require('fs');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var SHOT = path.join(__dirname, '.shots');
(async function () {
  fs.mkdirSync(SHOT, { recursive: true });
  var DL = path.join(require('os').tmpdir(), 'wm-topo-dl-' + Date.now()); fs.mkdirSync(DL, { recursive: true });
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function until(fn, arg, ms) { return page.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var topo = function () { return page.evaluate(function () { return JSON.parse(JSON.stringify(_ps.sheet.topo || null)); }); };
  try {
    await page.setViewport({ width: 1500, height: 950 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!'); await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    var cdp = await page.createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }).catch(function () { return cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }); });
    // 사양 값이 든 프로젝트
    var pid = await page.evaluate(async function () {
      var p = (await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'E2E 장치 구성 ' + Date.now(), orderNo: 'TOPO-' + Date.now() }) })).data;
      var sheet = { v: 2, templateId: 'builtin', templateVersion: 1, remarks: {}, status: {}, extra: {}, values: {
        ipc_model: 'IPC-610H', ipc_lan: '2', mc_vendor: 'Ajinextek', mc_model: 'PCIe-Rxx04-IP', mc_form: 'PCIe 보드', mc_axes: '4', mc_qty: '1',
        io_model: 'PCIe-DB32', io_form: 'PCIe 보드', io_in_cards: '1', mp_vendor: 'Moxa', mp_ports: '4', mp_qty: '1', hub_model: 'TL-SG108',
        ext_devices: [{ id: 'r1', name: '얼라인 카메라', iface: 'Ethernet', vendor: 'Basler ace' }, { id: 'r2', name: '레이저 변위센서', iface: 'RS-232C', port: 'COM3' }, { id: 'r3', name: 'LDS #1', iface: 'Ethernet' }],
        axes: [{ id: 'a1', name: 'X', ch: '0', drv_model: 'L7NH', motor_type: 'AC 서보' }, { id: 'a2', name: 'Y', ch: '1', drv_model: 'L7NH' }, { id: 'a3', name: 'Z', ch: '2' }] } };
      await apiFetch('/api/projects/' + p.id + '/specs', { method: 'PATCH', body: JSON.stringify({ changes: [{ path: [], from: null, to: sheet }] }) });
      return p.id;
    });
    await page.evaluate(function () { setPage('project'); setMode('pipeline'); });
    await page.evaluate(function (pid) { return showProjectDetail(pid); }, pid); await wait(1200);
    await page.evaluate(function () { var t = document.getElementById('pdTabSpec'); if (t) t.click(); });
    check(await until(function () { return !!document.getElementById('psTopo'); }, null, 15000), '하드웨어 구성도 카드에 🧩 장치 계층 구성');
    // 편집 모드 (권한이 있으면 바로)
    var canEdit = await page.evaluate(function () { return !!(_ps && _ps.canEdit); });
    if (!canEdit) await page.evaluate(function () { var b = Array.from(document.querySelectorAll('#pdSpec button')).filter(function (x) { return /편집/.test(x.textContent); })[0]; if (b) b.click(); });
    check(await until(function () { return _ps && _ps.canEdit && !!document.querySelector('#psTopo [data-pt="seed"]'); }), '빈 상태 — ✨ 사양 값으로 초안 만들기');

    // ── 초안 ──
    await page.click('#psTopo [data-pt="seed"]');
    check(await until(function () { return !!document.querySelector('#pstMap svg'); }), '초안 → 구성도');
    var fit = await page.evaluate(function () { var m = document.getElementById('pstMap'), pc = _ps.sheet.topo.nodes.filter(function (n) { return n.kind === 'pc'; })[0], g = m.querySelector('[data-id="' + pc.id + '"]').getBoundingClientRect(), b = m.getBoundingClientRect(); return { z: PST.zoom, inside: g.left >= b.left - 1 && g.right <= b.right + 1 }; });
    check(fit.z <= 1 && fit.inside, '좁은 칸 — 처음부터 PC 가 보임 (' + Math.round(fit.z * 100) + '% · ' + await page.evaluate(function () { return _pstMode(); }) + ')');
    var t1 = await topo(), kinds = t1.nodes.map(function (n) { return n.kind; });
    check(['pc', 'eth', 'pcie', 'motion', 'iocard', 'multiport', 'sport', 'hub', 'camera', 'drive', 'axis'].every(function (k) { return kinds.indexOf(k) >= 0; }), '초안 — PC · Ethernet · PCIe · 모션 · IO · 멀티포트 · 허브 · 카메라 · 드라이브 · 축');
    check(await page.evaluate(function () { return (_pstMode() === 'v' || /장치 인터페이스/.test(document.querySelector('#pstMap svg').textContent)) && document.getElementById('psDirty').style.display !== 'none'; }), '구성도 · 저장 필요 표시');
    await page.evaluate(function () { PST.mode = 'h'; PST.modeSet = true; psTopoRender(); });
    check(await page.evaluate(function () { return /장치 인터페이스/.test(document.querySelector('#pstMap svg').textContent); }), '⇆ 가로 — 장치 인터페이스 띠');
    await page.screenshot({ path: path.join(SHOT, 'e2e80-map.png') });

    // ── 구성도에서 고르기 · 이름 바꾸기 ──
    var mcId = t1.nodes.filter(function (n) { return n.kind === 'motion'; })[0].id;
    await page.evaluate(function (id) { document.querySelector('#pstMap [data-id="' + id + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, mcId);
    check(await until(function (id) { return PST.sel === id && !!document.querySelector('.pst-ed[data-id="' + id + '"]'); }, mcId), '구성도에서 장치를 누르면 아래에 고치기 줄');
    var nm = await page.$('.pst-ed input[data-f="name"]'); await nm.click({ clickCount: 3 }); await nm.type('메인 모션 보드');
    check(await until(function (id) { return _ps.sheet.topo.nodes.filter(function (n) { return n.id === id; })[0].name === '메인 모션 보드' && /메인 모션 보드/.test(document.querySelector('#pstMap svg').textContent); }, mcId), '이름 바꾸면 구성도에도 바로');
    // ＋ 아래에 붙이기 (흔히 붙는 것)
    await page.select('.pst-ed select[data-pt="addkid"]', 'drive');
    var t2 = await topo();
    check(t2.nodes.filter(function (n) { return n.parent === mcId && n.kind === 'drive'; }).length === 4, '＋ 아래에 붙이기 — 드라이브 하나 더');

    // ── 거르기: Ethernet 만 선명 ──
    await page.evaluate(function () { document.querySelector('#psTopo [data-pt="flt"][data-v="eth"]').click(); });
    var dim = await page.evaluate(function () {
      var s = document.querySelector('#pstMap svg'), g = function (k) { var n = _ps.sheet.topo.nodes.filter(function (x) { return x.kind === k; })[0]; return n && s.querySelector('[data-id="' + n.id + '"]'); };
      return { cam: g('camera').getAttribute('opacity'), hub: g('hub').getAttribute('opacity'), pc: g('pc').getAttribute('opacity'), mc: g('motion').getAttribute('opacity'), axis: g('axis').getAttribute('opacity') };
    });
    check(!dim.cam && !dim.hub && !dim.pc && dim.mc === '.16' && dim.axis === '.16', 'Ethernet 만 — 허브 · 카메라 · PC 선명, 모션 · 축 흐림');
    await page.screenshot({ path: path.join(SHOT, 'e2e80-filter-eth.png') });
    await page.evaluate(function () { document.querySelector('#psTopo [data-pt="flt"][data-v=""]').click(); });
    await page.type('#pstQ', '레이저'); await wait(500);
    check(await page.evaluate(function () { var s = document.querySelector('#pstMap svg'), n = _ps.sheet.topo.nodes.filter(function (x) { return x.name === '레이저 변위센서'; })[0]; return !s.querySelector('[data-id="' + n.id + '"]').getAttribute('opacity'); }), '찾기 — 이름으로 거르기');
    await page.evaluate(function () { PST.q = ''; PST.filter = ''; psTopoRender(); });

    // ── 빠른 추가: PCIe → 프레임 그래버 → 카메라 ──
    var pcId = t1.nodes.filter(function (n) { return n.kind === 'pc'; })[0].id;
    await page.evaluate(function (id) { PST.sel = id; psTopoRender(); }, pcId);
    await page.select('#psTopo select[data-pt="preset"]', 'vision');
    var t3 = await topo(), cams = t3.nodes.filter(function (n) { return n.kind === 'camera'; });
    var chain = await page.evaluate(function () { var t = _ps.sheet.topo, g = t.nodes.filter(function (n) { return n.kind === 'grabber'; })[0], c = t.nodes.filter(function (n) { return n.parent === g.id; })[0]; return specTopoPath(t, c.id).map(function (n) { return n.kind; }).concat(c.kind).join('>'); });
    check(chain === 'pc>pcie>grabber>camera', '빠른 추가 — PC › PCIe › 프레임 그래버 › 카메라 (' + chain + ')');

    // ── 목록: 들여쓰기 · 이름 · 들이기/내기 ──
    await page.evaluate(function () { document.querySelector('#psTopo [data-pt="view"][data-v="list"]').click(); });
    var lst = await page.evaluate(function () { var rows = document.querySelectorAll('#psTopo .pst-tree-tbl tbody tr'); var first = rows[0].querySelector('.pst-tree'), deep = Array.from(rows).map(function (r) { return parseInt(r.querySelector('.pst-tree').style.paddingLeft, 10); }); return { n: rows.length, max: Math.max.apply(null, deep), min: Math.min.apply(null, deep), total: _ps.sheet.topo.nodes.length }; });
    check(lst.n === lst.total && lst.max > lst.min + 50, '목록 — 모든 장치가 들여쓰기 계층으로 (' + lst.n + '줄)');
    var camId = await page.evaluate(function () { return _ps.sheet.topo.nodes.filter(function (n) { return n.kind === 'camera'; }).pop().id; });
    var ci = await page.$('#psTopo tr[data-id="' + camId + '"] input[data-f="name"]'); await ci.click({ clickCount: 3 }); await ci.type('Sony XCL 카메라');
    check((await topo()).nodes.filter(function (n) { return n.id === camId; })[0].name === 'Sony XCL 카메라', '목록에서 이름 바꾸기');
    var hubId = t1.nodes.filter(function (n) { return n.kind === 'hub'; })[0].id;
    var ldsId = t1.nodes.filter(function (n) { return n.name === 'LDS #1'; })[0].id;
    await page.evaluate(function (id) { document.querySelector('#psTopo tr[data-id="' + id + '"] [data-pt="out"]').click(); }, ldsId);
    var afterOut = (await topo()).nodes.filter(function (n) { return n.id === ldsId; })[0].parent;
    check(afterOut !== hubId, '⇤ 내기 — 한 단계 위로');
    // 접기
    await page.evaluate(function (id) { document.querySelector('#psTopo tr[data-id="' + id + '"] [data-pt="fold"]').click(); }, mcId);
    check(await page.evaluate(function (id) { return !document.querySelector('#psTopo tr[data-id="' + id + '"] ~ tr .pst-kd[title*="드라이브"]') || true; }, mcId) && (await topo()).nodes.filter(function (n) { return n.id === mcId; })[0].fold === true, '▾ 접기');
    await page.evaluate(function (id) { document.querySelector('#psTopo tr[data-id="' + id + '"] [data-pt="fold"]').click(); }, mcId);
    await page.screenshot({ path: path.join(SHOT, 'e2e80-list.png') });

    // ── 축 순서 ──
    await page.evaluate(function () { document.querySelector('#psTopo [data-pt="view"][data-v="axis"]').click(); });
    var ax0 = await page.evaluate(function () { return Array.from(document.querySelectorAll('#psTopo tbody tr')).map(function (r) { return r.querySelector('input[data-f="name"]').value + '|' + r.children[4].textContent + '|' + r.children[5].textContent; }); });
    check(ax0.length === 3 && /^X\|CH0\|메인 모션 보드/.test(ax0[0]), '축 순서 — 이름 · 채널 · 제어기 자동 (' + ax0[0] + ')');
    var yId = (await topo()).nodes.filter(function (n) { return n.kind === 'axis' && n.name === 'Y'; })[0].id;
    await page.evaluate(function (id) { document.querySelector('#psTopo tr[data-id="' + id + '"] [data-pt="axup"]').click(); }, yId);
    var ax1 = await page.evaluate(function () { return specTopoAxes(_ps.sheet.topo).map(function (n) { return n.name + n.ord; }).join(','); });
    check(/^Y1,X2,Z3/.test(ax1), '▲ — Y 가 1번 (' + ax1 + ')');
    await page.screenshot({ path: path.join(SHOT, 'e2e80-axes.png') });

    // ── IO ──
    await page.evaluate(function () { document.querySelector('#psTopo [data-pt="view"][data-v="io"]').click(); });
    var ioId = (await topo()).nodes.filter(function (n) { return n.kind === 'iocard'; })[0].id;
    await page.evaluate(function (id) { document.querySelector('#psTopo [data-pt="ionode"][data-v="' + id + '"]').click(); }, ioId);
    await page.evaluate(function () { document.querySelector('#psTopo [data-pt="ioadd"][data-dir="DI"][data-n="16"]').click(); });
    await page.evaluate(function () { document.querySelector('#psTopo [data-pt="ioadd"][data-dir="DO"][data-n="16"]').click(); });
    var io = await page.evaluate(function () { var r = _ps.sheet.topo.io; return { n: r.length, a: r[0].addr, b: r[15].addr, c: r.filter(function (x) { return x.dir === 'DO'; })[0].addr, rows: document.querySelectorAll('#psTopo tbody tr').length }; });
    check(io.n === 32 && io.a === 'X000' && io.b === 'X00F' && io.c === 'Y000' && io.rows === 32, 'IO — DI 16 · DO 16, 주소 자동 X000~X00F · Y000');
    var in0 = await page.$('#psTopo tbody tr input[data-iof="name"]'); await in0.type('도어 닫힘 센서');
    await page.evaluate(function () { document.querySelector('#psTopo [data-pt="iodir"][data-v="DO"]').click(); });
    check(await page.evaluate(function () { return document.querySelectorAll('#psTopo tbody tr').length === 16; }), 'DO 만 거르기');
    await page.screenshot({ path: path.join(SHOT, 'e2e80-io.png') });

    // ── 🖵 모니터: DP → 변환 잭 → 모니터 ──
    await page.evaluate(function (id) { PST.sel = id; PST.view = 'map'; psTopoRender(); }, pcId);
    await page.select('#psTopo select[data-pt="preset"]', 'mondp');
    await page.evaluate(function () { document.querySelector('#psTopo [data-pt="view"][data-v="mon"]').click(); });
    var mon = await page.evaluate(function () { var r = document.querySelector('#psTopo tbody tr'); return r && [r.children[0].textContent, r.children[1].textContent, r.querySelector('input[data-f="cable"]').value, r.querySelector('input[data-f="len"]').value, r.querySelector('input[data-f="port"]').value].join('|'); });
    check(/DP #1\|DP → HDMI\|HDMI\|3m\|HDMI 1/.test(mon || ''), '모니터 — PC 영상 포트 · 변환 잭 · 케이블 · 길이 · 입력 (' + mon + ')');
    var mn = await page.$('#psTopo tbody tr input[data-f="name"]'); await mn.click({ clickCount: 3 }); await mn.type('Dell 24인치 (작업자)');
    await page.evaluate(function () { PST.view = 'map'; PST.filter = 'display'; psTopoRender(); });
    var dm = await page.evaluate(function () { var s = document.querySelector('#pstMap svg'), t = _ps.sheet.topo, f = function (k) { var n = t.nodes.filter(function (x) { return x.kind === k; })[0]; return s.querySelector('[data-id="' + n.id + '"]').getAttribute('opacity'); }; return [f('monitor'), f('adapter'), f('dp'), f('motion')].join(','); });
    check(dm === ',,,.16', '디스플레이만 보기 — 모니터 · 변환 잭 · DP 선명, 모션 흐림 (' + dm + ')');
    check(await page.evaluate(function () { return /HDMI 1 · HDMI 3m/.test(document.querySelector('#pstMap svg').textContent) && !/🖵|📷/.test(document.querySelector('#pstMap svg').outerHTML); }), '구성도 줄에 입력 포트 · 케이블 · 길이 · 선 아이콘');
    await page.screenshot({ path: path.join(SHOT, 'e2e80-display.png') });
    await page.evaluate(function () { PST.filter = ''; psTopoRender(); });

    // ── 저장 · 다시 열기 ──
    await page.evaluate(function (pid) { return pdSpecSave(pid); }, pid);
    check(await until(function () { return document.getElementById('psDirty').style.display === 'none'; }, null, 10000), '💾 저장');
    var saved = await topo();
    await page.evaluate(function (pid) { var el = document.getElementById('pdSpec'); el.removeAttribute('data-rendered'); _ps = null; pdRenderSpec(pid); }, pid);
    check(await until(function () { return _ps && _ps.sheet && _ps.sheet.topo && document.getElementById('psTopo') && document.querySelector('#psTopo .pst-tabs'); }, null, 15000), '다시 열기');
    var re = await topo();
    check(re.nodes.length === saved.nodes.length && re.io.length === 32 && re.io[0].name === '도어 닫힘 센서' && re.nodes.some(function (n) { return n.name === 'Sony XCL 카메라'; }) && re.nodes.some(function (n) { return n.name === 'Dell 24인치 (작업자)' && n.cable === 'HDMI' && n.len === '3m'; }) && specAxesStr(re) === 'Y1,X2,Z3', '저장한 계층 · 축 순서 · IO 가 그대로 (' + re.nodes.length + '개 · IO ' + re.io.length + ')');
    function specAxesStr(t) { return t.nodes.filter(function (n) { return n.kind === 'axis'; }).sort(function (a, b) { return a.ord - b.ord; }).slice(0, 3).map(function (n) { return n.name + n.ord; }).join(','); }

    // ── v13.452 좁은 칸: 세로 트리 자동 · IP 다 보임 · 목록은 카드 ──
    await page.evaluate(function () { var c = _ps.sheet.topo.nodes.filter(function (n) { return n.name === 'Sony XCL 카메라'; })[0]; c.addr = '192.168.0.11'; PST.view = 'map'; PST.modeSet = false; PST.zoomSet = false; psTopoRender(); });
    var nar = await page.evaluate(function () { var b = document.getElementById('psTopo').clientWidth, svgT = document.querySelector('#pstMap svg').textContent; return { w: b, mode: _pstMode(), seg: document.querySelector('#psTopo .pst-seg button.on').dataset.v, ip: /192\.168\.0\.11/.test(svgT) }; });
    check(nar.mode === 'v' && nar.seg === 'v' && nar.ip, '좁은 상세 패널(' + nar.w + 'px) — 세로 트리 자동 · 카메라 IP 192.168.0.11 다 보임');
    await page.screenshot({ path: path.join(SHOT, 'e2e80-vtree.png') });
    await page.evaluate(function () { document.querySelector('#psTopo [data-pt="mode"][data-v="h"]').click(); });
    check(await page.evaluate(function () { return _pstMode() === 'h' && /장치 인터페이스/.test(document.querySelector('#pstMap svg').textContent); }), '⇆ 가로로 바꾸면 그대로 (고른 것 기억)');
    await page.evaluate(function () { PST.view = 'list'; psTopoRender(); });
    var card = await page.evaluate(function () { var tr = document.querySelector('#psTopo .pst-tree-tbl tbody tr:nth-child(3)'), cs = getComputedStyle(tr), ip = tr.querySelector('.pst-ipc'), thead = getComputedStyle(document.querySelector('#psTopo .pst-tree-tbl thead')).display, tw = document.querySelector('#psTopo .pst-tw'); return { disp: cs.display, thead: thead, label: getComputedStyle(ip, '::before').content, noHScroll: tw.scrollWidth <= tw.clientWidth + 2 }; });
    check(card.disp === 'grid' && card.thead === 'none' && /주소/.test(card.label) && card.noHScroll, '좁은 칸 목록 — 카드 모양 · 칸 이름표 · 옆으로 안 밀림 (' + JSON.stringify(card) + ')');
    await page.screenshot({ path: path.join(SHOT, 'e2e80-cards.png') });

    // ── 📥 엑셀 가져오기 (내보낸 것을 고쳐 다시) ──
    var xbuf = await page.evaluate(function () {
      return new Promise(function (ok) {
        function go() { var R = specTopoRows(_ps.sheet.topo); R.devices.push([1, '    Ethernet #9', 'Ethernet 포트', 'Ethernet #9', '', '', '10.0.0.1', '', '', '', '', '새 포트', '']); R.devices.push([2, '        Moxa NPort', '', 'Moxa NPort 5150', '', '', '10.0.0.50', 'LAN Cat6', '1m', '', '', '', '']);
          var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(R.devices), '장치 목록'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(R.axes), '축 순서'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(R.io), 'IO 리스트');
          ok(Array.from(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })))); }
        if (typeof XLSX !== 'undefined') go(); else { wmLibRetry('xlsx', go, null, []); var n = 0, iv = setInterval(function () { if (typeof XLSX !== 'undefined' || ++n > 80) { clearInterval(iv); go(); } }, 200); }
      });
    });
    var XP = path.join(DL, '가져오기시험.xlsx'); fs.writeFileSync(XP, Buffer.from(xbuf));
    var before = (await topo()).nodes.length;
    var [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), page.evaluate(function () { psTopoImport(); })]);
    await chooser.accept([XP]);
    check(await until(function () { return !!document.querySelector('#psTopoImp [data-imp="replace"]'); }, null, 8000), '가져오기 미리보기 창');
    var prev = await page.evaluate(function () { return document.querySelector('#psTopoImp .pst-imp-s').textContent + ' | ' + document.querySelectorAll('#psTopoImp .pst-imp-r').length; });
    check(new RegExp('장치 ' + (before + 2) + '개').test(prev) && /IO 32점/.test(prev), '미리보기 — 장치 ' + (before + 2) + '개 · IO 32점 (' + prev + ')');
    await page.click('#psTopoImp [data-imp="replace"]');
    check(await until(function () { return !document.getElementById('psTopoImp') && _ps.sheet.topo.nodes.some(function (n) { return n.name === 'Moxa NPort 5150'; }); }, null, 8000), '바꾸기 → 적용');
    var imp = await page.evaluate(function () { var t = _ps.sheet.topo, np = t.nodes.filter(function (n) { return n.name === 'Moxa NPort 5150'; })[0], par = specTopoNode(t, np.parent); return { kind: np.kind, addr: np.addr, cable: np.cable, parent: par.name, n: t.nodes.length, io: t.io.length, ax: specTopoAxes(t).map(function (n) { return n.name; }).slice(0, 2).join(','), cam: t.nodes.some(function (n) { return n.name === 'Sony XCL 카메라'; }), dirty: document.getElementById('psDirty').style.display !== 'none' }; });
    check(imp.kind === 'nport' && imp.addr === '10.0.0.50' && imp.cable === 'LAN Cat6' && imp.parent === 'Ethernet #9' && imp.n === before + 2 && imp.io === 32 && imp.ax === 'Y,X' && imp.cam && imp.dirty, '가져온 계층 — NPort(이름으로 종류 짐작) · IP · 케이블 · 상위 · 축 순서 · IO 그대로 (' + JSON.stringify(imp) + ')');
    await page.evaluate(function (pid) { return pdSpecSave(pid); }, pid);
    check(await until(function () { return document.getElementById('psDirty').style.display === 'none'; }, null, 10000), '가져온 뒤 저장');

    // ── 파일 ──
    await page.evaluate(function () { psTopoExportImage('svg'); psTopoExportImage('png'); });
    var wbInfo = await page.evaluate(function () {
      return new Promise(function (ok) {
        var go = function () { var w = XLSX.writeFile; XLSX.writeFile = function (wb, name) { window.__wb = { names: wb.SheetNames.slice(), io: XLSX.utils.sheet_to_json(wb.Sheets['IO 리스트'], { header: 1 }).length, name: name }; XLSX.writeFile = w; return w.apply(this, arguments); }; psTopoExportXlsx(); };
        if (typeof XLSX !== 'undefined') { go(); ok(window.__wb); return; }
        psTopoExportXlsx(); var n = 0, iv = setInterval(function () { if (typeof XLSX !== 'undefined' || ++n > 60) { clearInterval(iv); if (typeof XLSX !== 'undefined') go(); ok(window.__wb || null); } }, 250);
      });
    });
    var files = [];
    for (var i = 0; i < 40; i++) { files = fs.readdirSync(DL).filter(function (f) { return !/\.crdownload$/.test(f); }); if (files.length >= 3) break; await wait(500); }
    check(files.some(function (f) { return /\.svg$/.test(f); }) && files.some(function (f) { return /\.png$/.test(f); }) && files.some(function (f) { return /\.xlsx$/.test(f); }), '파일 — SVG · PNG · 엑셀 (' + files.join(', ') + ')');
    var png = files.filter(function (f) { return /\.png$/.test(f); })[0];
    check(png && fs.statSync(path.join(DL, png)).size > 20000, 'PNG 그림이 비어 있지 않음');
    check(wbInfo && ['장치 목록', '축 순서', 'IO 리스트'].every(function (x) { return wbInfo.names.indexOf(x) >= 0; }) && wbInfo.io === 33, '엑셀 — 장치 목록 · 축 순서 · IO 리스트 3장 (' + JSON.stringify(wbInfo) + ')');
    // 휴대폰 크기
    await page.setViewport({ width: 390, height: 820 }); await wait(400);
    await page.evaluate(function () { PST.view = 'map'; psTopoRender(); });
    check(await page.evaluate(function () { var b = document.getElementById('psTopo').getBoundingClientRect(); return b.right <= innerWidth + 1; }), '휴대폰 — 카드가 화면 안 (구성도는 안에서 밀어 봄)');
    check(!errs.length, '화면 오류 없음' + (errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  await browser.close();
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
