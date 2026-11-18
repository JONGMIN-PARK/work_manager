// 🔖 바로가기 화면 (v13.528) — 머리 줄 🔖 · Alt+B · 프로젝트 ⋯ 로 지금 화면 추가(메뉴 › 파트 › 항목)
//   → 내 업무 오른쪽 아래 목록(메뉴별 묶음 · 칩 거르기 · 접기) → 눌러 이동(문서 화면 · 프로젝트 상세 · 노트) · 이름 · 순서 · 휴지통 · 되살리기 · 영구 삭제
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var T = Date.now(), pid = 'e2e-sc-' + T, nid = null;
  async function addViaModal() {
    await page.waitForSelector('#wscAddModal #wscName', { timeout: 6000 });
    var crumb = await page.evaluate(function () { return document.querySelector('#wscAddModal .wsc-crumb').textContent; });
    await page.focus('#wscAddModal #wscName');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return !document.getElementById('wscAddModal'); }, { timeout: 6000 }).catch(function () {});
    await wait(500);
    return crumb;
  }
  try {
    await page.setViewport({ width: 1600, height: 950 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(800);
    nid = await page.evaluate(async function (T, pid) {
      var l = (await apiFetch('/api/shortcuts')).data; for (var i = 0; i < l.length; i++) await apiFetch('/api/shortcuts/' + l[i].id, { method: 'DELETE' });
      await apiFetch('/api/shortcuts/trash', { method: 'DELETE' });
      await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ id: pid, name: '바로가기 시험 ' + T, status: 'active', checklists: false }) });
      if (typeof _pdInvalidate === 'function') { _pdInvalidate('proj'); _pdInvalidate('projAll'); }
      return (await apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: '회의록 ' + T, body: '본문' }) })).data.id;
    }, T, pid);

    // 1) 프로젝트 관리 › 문서 — 머리 줄 🔖
    await page.evaluate(function () { setPage('project'); setMode('docs'); });
    await wait(800);
    await page.click('#hdrScBtn');
    await page.waitForSelector('#wscPop:not([hidden]) #wscAddBtn', { timeout: 5000 });
    var popCrumb = await page.evaluate(function () { return document.querySelector('#wscPop .wsc-crumb').textContent; });
    check(/프로젝트 관리/.test(popCrumb) && /문서/.test(popCrumb), '🔖 팝업 — 지금 화면 메뉴 › 파트 ' + popCrumb);
    await page.evaluate(function () { document.getElementById('wscAddBtn').click(); });
    var c1 = await addViaModal();
    check(/프로젝트 관리 › 📂 문서/.test(c1), '추가 창 — 메뉴 › 파트 ' + c1);

    // 2) 프로젝트 상세 (타임라인에서) — Alt+B
    await page.evaluate(function () { setMode('timeline'); });
    await wait(600);
    await page.evaluate(function (pid) { return showProjectDetail(pid); }, pid);
    await page.waitForSelector('#projDetailPanel[data-pid]', { timeout: 8000 });
    await page.keyboard.down('Alt'); await page.keyboard.press('KeyB'); await page.keyboard.up('Alt');
    var c2 = await addViaModal();
    check(/프로젝트 관리/.test(c2) && /타임라인/.test(c2) && new RegExp('바로가기 시험 ' + T).test(c2), 'Alt+B — 메뉴 › 파트 › 항목(프로젝트) ' + c2);
    await page.evaluate(function () { if (typeof pdCloseDetail === 'function') pdCloseDetail(); });

    // 3) 노트 — 사용자 메뉴 경로와 같은 함수
    await page.evaluate(function () { setPage('notebook'); });
    await wait(1200);
    await page.evaluate(function (id) { nbOpenNote(id); }, nid);
    await page.waitForFunction(function (id) { return typeof NB !== 'undefined' && NB.cur && NB.cur.id === id; }, { timeout: 10000 }, nid);
    await page.evaluate(function () { wscAddHere(); });
    var c3 = await addViaModal();
    check(/노트 › 노트북 › 회의록/.test(c3), '노트 — 메뉴 › 파트 › 항목 ' + c3);

    // 4) 내 업무 오른쪽 아래 목록
    await page.evaluate(function () { setPage('mywork'); });
    await page.waitForSelector('#wscBox .wsc-row', { timeout: 15000 });
    await wait(500);
    var box = await page.evaluate(function () {
      var b = document.getElementById('wscBox'), side = b.closest('.mw-side'), sr = side && side.getBoundingClientRect(), br = b.getBoundingClientRect();
      return { rows: b.querySelectorAll('.wsc-row').length, chips: [].map.call(b.querySelectorAll('.wsc-chip'), function (x) { return x.textContent; }), groups: [].map.call(b.querySelectorAll('.wsc-gh'), function (x) { return x.textContent; }),
        inSide: !!side, last: side && side.lastElementChild === b, right: sr && br.left > window.innerWidth / 2 };
    });
    await page.evaluate(function () { document.getElementById('wscBox').scrollIntoView({ block: 'center' }); }); await wait(300);
    await (await page.$('.mw-side')).screenshot({ path: path.join(__dirname, '.shots', 'wsc-side.png') });
    check(box.rows === 3 && box.inSide && box.last && box.right, '내 업무 오른쪽 칸 맨 아래 — 3개 ' + JSON.stringify(box));
    check(box.chips.length === 3 && box.groups.length === 2 && /노트 1/.test(box.groups.join('|')) && /프로젝트 관리 2/.test(box.groups.join('|')), '메뉴별 묶음 · 칩 ' + JSON.stringify([box.chips, box.groups]));
    var sub = await page.evaluate(function () { return [].map.call(document.querySelectorAll('#wscBox .wsc-t small'), function (x) { return x.textContent; }); });
    check(sub.some(function (s) { return /타임라인/.test(s); }) && sub.some(function (s) { return /노트북/.test(s); }), '줄마다 파트 › 항목 ' + JSON.stringify(sub));
    // 칩 거르기 · 접기
    await page.evaluate(function () { [].filter.call(document.querySelectorAll('#wscBox .wsc-chip'), function (x) { return /노트/.test(x.textContent); })[0].click(); });
    var fr = await page.evaluate(function () { return document.querySelectorAll('#wscBox .wsc-row').length; });
    await page.evaluate(function () { document.querySelector('#wscBox .wsc-chip').click(); });
    await page.evaluate(function () { [].filter.call(document.querySelectorAll('#wscBox .wsc-gh'), function (x) { return /프로젝트 관리/.test(x.textContent); })[0].click(); });
    var fd = await page.evaluate(function () { return document.querySelectorAll('#wscBox .wsc-row').length; });
    await page.evaluate(function () { [].filter.call(document.querySelectorAll('#wscBox .wsc-gh'), function (x) { return /프로젝트 관리/.test(x.textContent); })[0].click(); });
    check(fr === 1 && fd === 1, '칩 거르기(노트만 1) · 묶음 접기(1) ' + fr + '/' + fd);

    // 5) 이동 — 프로젝트 상세
    await page.evaluate(function (pid) { var row = [].filter.call(document.querySelectorAll('#wscBox .wsc-go'), function (x) { return /바로가기 시험/.test(x.textContent); })[0]; row.click(); }, pid);
    await page.waitForSelector('#projDetailPanel[data-pid]', { timeout: 8000 }).catch(function () {});
    var g1 = await page.evaluate(function () { var p = document.getElementById('projDetailPanel'); return { page: curPage, mode: curMode, pid: p && p.getAttribute('data-pid') }; });
    check(g1.page === 'project' && g1.mode === 'timeline' && g1.pid === pid, '눌러 이동 — 프로젝트 관리 › 타임라인 › 그 프로젝트 ' + JSON.stringify(g1));
    await page.evaluate(function () { if (typeof pdCloseDetail === 'function') pdCloseDetail(); });
    // 머리 줄 팝업에서 노트로
    await page.click('#hdrScBtn');
    await page.waitForSelector('#wscPop:not([hidden]) .wsc-go', { timeout: 5000 });
    await page.evaluate(function () { [].filter.call(document.querySelectorAll('#wscPop .wsc-go'), function (x) { return /회의록/.test(x.textContent); })[0].click(); });
    await page.waitForFunction(function (id) { return curPage === 'notebook' && typeof NB !== 'undefined' && NB.cur && NB.cur.id === id; }, { timeout: 10000 }, nid).catch(function () {});
    var g2 = await page.evaluate(function () { return { page: curPage, id: NB.cur && NB.cur.id, pop: document.getElementById('wscPop').hidden }; });
    check(g2.page === 'notebook' && g2.id === nid && g2.pop, '팝업에서 이동 — 그 노트가 열림 · 팝업 닫힘');
    // 문서 화면
    await page.evaluate(function () { setPage('mywork'); });
    await page.waitForSelector('#wscBox .wsc-row', { timeout: 10000 });
    await page.evaluate(function () { [].filter.call(document.querySelectorAll('#wscBox .wsc-go'), function (x) { return /문서/.test(x.textContent) && !/바로가기 시험|회의록/.test(x.textContent); })[0].click(); });
    await wait(800);
    check(await page.evaluate(function () { return curPage === 'project' && curMode === 'docs'; }), '눌러 이동 — 프로젝트 관리 › 문서 화면');

    // 6) 관리 — 이름 · 순서 · 휴지통 · 되살리기 · 영구 삭제
    await page.evaluate(function () { setPage('mywork'); });
    await page.waitForSelector('#wscBox .wsc-row', { timeout: 10000 });
    await page.evaluate(function () { window.wmPrompt = function () { return Promise.resolve('주간 회의록'); }; window.wmConfirm = function () { return Promise.resolve(true); }; });
    await page.evaluate(function () { var r = [].filter.call(document.querySelectorAll('#wscBox .wsc-row'), function (x) { return /회의록/.test(x.textContent); })[0]; r.querySelector('[data-wsc="rename"]').click(); });
    await wait(600);
    check(await page.evaluate(function () { return /주간 회의록/.test(document.getElementById('wscBox').textContent); }), '✏️ 이름 바꾸기');
    var ord0 = await page.evaluate(function () { return [].map.call(document.querySelectorAll('#wscBox .wsc-t b'), function (x) { return x.textContent; }).join('|'); });
    await page.evaluate(function () { var rows = [].filter.call(document.querySelectorAll('#wscBox .wsc-row'), function (x) { return x.closest('.wsc-grp') && /프로젝트 관리/.test(x.closest('.wsc-grp').textContent); }); rows[1].querySelector('[data-wsc="up"]').click(); });
    await wait(600);
    var ord1 = await page.evaluate(function () { return apiFetch('/api/shortcuts').then(function (r) { return r.data.map(function (x) { return x.title; }).join('|'); }); });
    var grpOrder = await page.evaluate(function () { var g = [].filter.call(document.querySelectorAll('#wscBox .wsc-grp'), function (x) { return /프로젝트 관리/.test(x.textContent); })[0]; return [].map.call(g.querySelectorAll('.wsc-t b'), function (x) { return x.textContent; }); });
    check(grpOrder.length === 2 && ord1.indexOf(grpOrder[0]) < ord1.indexOf(grpOrder[1]), '↑ 순서 바꾸기 — 저장됨 ' + JSON.stringify(grpOrder) + ' / ' + ord1);
    await page.evaluate(function () { var r = [].filter.call(document.querySelectorAll('#wscBox .wsc-row'), function (x) { return /주간 회의록/.test(x.textContent); })[0]; r.querySelector('[data-wsc="trash"]').click(); });
    await wait(600);
    var t1 = await page.evaluate(function () { return { rows: document.querySelectorAll('#wscBox .wsc-row').length, ft: document.querySelector('#wscBox .wsc-ft').textContent }; });
    check(t1.rows === 2 && /휴지통 1/.test(t1.ft), '🗑 휴지통으로 ' + JSON.stringify(t1));
    await page.evaluate(function () { document.querySelector('#wscBox [data-wsc="trashon"]').click(); });
    await page.waitForFunction(function () { return document.querySelectorAll('#wscBox .wsc-row.tr').length === 1; }, { timeout: 5000 }).catch(function () {});
    await page.evaluate(function () { document.querySelector('#wscBox .wsc-row.tr [data-wsc="restore"]').click(); });
    await wait(700);
    await page.evaluate(function () { var b = document.querySelector('#wscBox [data-wsc="trashoff"]'); if (b) b.click(); });
    await wait(300);
    check(await page.evaluate(function () { return document.querySelectorAll('#wscBox .wsc-row').length === 3; }), '↺ 되살리기');
    await page.evaluate(function () { var r = [].filter.call(document.querySelectorAll('#wscBox .wsc-row'), function (x) { return /주간 회의록/.test(x.textContent); })[0]; r.querySelector('[data-wsc="trash"]').click(); });
    await wait(500);
    await page.evaluate(function () { document.querySelector('#wscBox [data-wsc="trashon"]').click(); });
    await page.waitForFunction(function () { return document.querySelectorAll('#wscBox .wsc-row.tr').length === 1; }, { timeout: 5000 }).catch(function () {});
    await page.evaluate(function () { document.querySelector('#wscBox .wsc-row.tr [data-wsc="hard"]').click(); });
    await wait(700);
    var hard = await page.evaluate(function () { return apiFetch('/api/shortcuts?trash=1').then(function (r) { return r.data.length; }); });
    check(hard === 0 && await page.evaluate(function () { return /휴지통이 비었습니다/.test(document.getElementById('wscBox').textContent); }), '✕ 영구 삭제');

    // 7) 프로젝트 ⋯ 메뉴에 🔖
    await page.evaluate(function (pid) { setPage('project'); return showProjectDetail(pid); }, pid);
    await page.waitForSelector('#projDetailPanel', { timeout: 8000 });
    check(await page.evaluate(function () { return [].some.call(document.querySelectorAll('#projDetailPanel .pd-more-menu *'), function (x) { return /바로가기에 추가/.test(x.textContent) && x.children.length === 0; }); }), '프로젝트 ⋯ — 🔖 바로가기에 추가');

    await page.evaluate(async function (pid, nid) {
      var l = (await apiFetch('/api/shortcuts')).data; for (var i = 0; i < l.length; i++) await apiFetch('/api/shortcuts/' + l[i].id, { method: 'DELETE' });
      await apiFetch('/api/shortcuts/trash', { method: 'DELETE' });
      await apiFetch('/api/projects/' + pid, { method: 'DELETE' }); await apiFetch('/api/notebook/notes/' + nid, { method: 'DELETE' }).catch(function () {});
    }, pid, nid);
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
