// 📁 프로젝트 관리 점검 (v13.281) — 하위 탭 전부 열기 · 창 연타 · 마일스톤 행 · 저장 · 상세에서 삭제 · 필터에 가린 프로젝트
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function toasts() { return page.evaluate(function () { return Array.from(document.querySelectorAll('.toast, #toastWrap *, [class*="toast"]')).map(function (e) { return e.textContent; }).join(' | '); }); }
  var pid = null;
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    await page.click('#pageTabs [data-page="project"]');
    // 1. 하위 탭 전부 — 화면 오류 없이
    var modes = await page.evaluate(function () { return Array.from(document.querySelectorAll('#modeTabsProj .tab')).filter(function (t) { return !t.classList.contains('hidden'); }).map(function (t) { return t.dataset.m; }); });
    for (var i = 0; i < modes.length; i++) {
      await page.click('#modeTabsProj [data-m="' + modes[i] + '"]'); await wait(1200);
    }
    check(errs.length === 0, '하위 탭 ' + modes.length + '개 열기 — 화면 오류 없음 ' + JSON.stringify(errs));
    // 2. 프로젝트 창 — 연타해도 하나
    await page.click('#modeTabsProj [data-m="timeline"]'); await wait(800);
    await page.evaluate(function () { showProjectModal(); showProjectModal(); showProjectModal(); });
    await page.waitForSelector('#projModal');
    await wait(500);
    check(await page.evaluate(function () { return document.querySelectorAll('#projModal').length; }) === 1, '프로젝트 창 연타 — 하나만');
    // 3. 마일스톤 행 — 새 행도 기존 행과 같은 열(손잡이 · 이관 자리 · 삭제) · rowkey
    await page.evaluate(function () { addMsRow(); addMsRow(); });
    var rows = await page.evaluate(function () { return Array.from(document.querySelectorAll('#msRows .proj-ms-row')).map(function (r) { return { k: r.getAttribute('data-rowkey'), n: r.children.length, h: !!r.querySelector('.ms-drag-handle') }; }); });
    check(rows.length === 2 && rows.every(function (r) { return /^new-/.test(r.k) && r.n === 7 && r.h; }), '새 마일스톤 행 — rowkey · 7칸 · 끌기 손잡이 ' + JSON.stringify(rows));
    // 4. 저장 — 이름 · 기간 · 마일스톤 하나
    var nm = 'E2E점검 ' + Date.now();
    await page.evaluate(function (nm) {
      document.getElementById('projName').value = nm;
      document.getElementById('projStart').value = '2026-10-01';
      document.getElementById('projEnd').value = '2026-11-30';
      var r = document.querySelectorAll('#msRows .proj-ms-row')[0];
      r.querySelector('.ms-name').value = '설계'; r.querySelector('.ms-start').value = '2026-10-01'; r.querySelector('.ms-end').value = '2026-10-15';
      var h = document.getElementById('projEstHoursHint'); if (h) h.textContent = '';
    }, nm);
    await page.evaluate(function () { return saveProjectUI(''); });
    await page.waitForFunction(function () { return !document.getElementById('projModal'); }, { timeout: 10000 });
    pid = await page.evaluate(async function (nm) { var l = await projGetAll(); var p = l.filter(function (x) { return x.name === nm; })[0]; return p && p.id; }, nm);
    check(!!pid, '프로젝트 저장');
    var mss = await page.evaluate(async function (id) { return (await msGetByProject(id)).length; }, pid);
    check(mss === 1, '마일스톤 하나만 (빈 행은 건너뜀) ' + mss);
    // 4-1. 편집 창에서 마일스톤을 완료로 → 진척 100 · 프로젝트 완료율 · 타임라인 막대 (v13.282)
    await page.evaluate(function (id) { return showProjectModal(id); }, pid);
    await page.waitForSelector('#msRows .proj-ms-row');
    await page.evaluate(function () { var h = document.getElementById('projEstHoursHint'); if (h) h.textContent = ''; document.querySelector('#msRows .proj-ms-row .ms-status').value = 'done'; });
    await page.evaluate(function (id) { return saveProjectUI(id); }, pid);
    await page.waitForFunction(function () { return !document.getElementById('projModal'); }, { timeout: 10000 });
    await wait(1500);
    var pr = await page.evaluate(async function (id) { var m = await msGetByProject(id); var p = await projGet(id); return { ms: m[0].progress, p: p.progress }; }, pid);
    check(pr.ms === 100 && pr.p === 100, '편집 창 완료 → 마일스톤 100 · 프로젝트 100 ' + JSON.stringify(pr));
    var fill = await page.evaluate(function (id) { var b = document.querySelector('.tl-row-sub[data-proj-id="' + id + '"] .tl-bar'); return b ? b.innerHTML : ''; }, pid);
    check(/100%/.test(fill) || /width:100%/.test(fill), '타임라인 마일스톤 막대 100% ' + fill.slice(0, 160));
    // 5. 타임라인 막대에 실제 날짜 — 끌기는 이 날짜 기준
    await wait(1200);
    var bar = await page.evaluate(function (id) { var b = document.querySelector('.tl-bar[data-type="proj"][data-id="' + id + '"]'); return b && { s: b.dataset.s, e: b.dataset.e }; }, pid);
    check(bar && bar.s === '2026-10-01' && bar.e === '2026-11-30', '막대 data-s · data-e ' + JSON.stringify(bar));
    // 6. 필터에 가린 프로젝트를 목록에서 누르면 안내
    await page.evaluate(function () { doTlScroll('없는-프로젝트'); });
    await wait(300);
    check(/필터/.test(await toasts()), '가린 프로젝트 — 안내 토스트');
    // 7. 상세 패널에서처럼(편집 창 없이) 삭제 — 오류 토스트 없음
    await page.evaluate(function (id) { return deleteProjectUI(id); }, pid);
    await wait(800);
    var t = await toasts();
    check(/삭제되었습니다/.test(t) && !/Cannot read/.test(t), '편집 창 없이 삭제 — 오류 없음 ' + t.slice(-120));
    pid = null;
    await page.screenshot({ path: path.join(SHOT, 'pm-refactor.png') });
    check(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) {
    fail++; console.log('FAIL', e.message);
    await page.screenshot({ path: path.join(SHOT, 'pm-refactor-fail.png') }).catch(function () {});
  } finally {
    if (pid) await page.evaluate(function (id) { return deleteProjectCascade(id); }, pid).catch(function () {});
    await browser.close();
  }
  console.log(fail ? '\nFAIL ' + fail + ' / ok ' + ok : '\nALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERR', e.message, e.stack); process.exit(1); });
