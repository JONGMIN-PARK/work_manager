// 📄 문서 미리보기 (v13.524) — PDF · PPTX · DOCX · XLSX · CSV(EUC-KR) · 글(EUC-KR) · 그림 · HWPX · 옛 PPT
//   run.sh 서버에는 GCS 가 없으므로 /api/docs/files/:id/raw 만 가로채 실제 파일(fixtures-docprev)을 돌려줌.
//   파일 기록 · 권한은 실제 서버. 문서 화면 미리보기 칸 · ⛶ 크게 보기 · 프로젝트 📂 문서 탭 👁
var path = require('path'), fs = require('fs'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var FIX = path.join(__dirname, 'fixtures-docprev');
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('console', function (m) { if (/warn|error/.test(m.type()) && !/401/.test(m.text())) console.log('  [console]', m.text().slice(0, 300)); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var byId = {}, raws = 0;   // 파일 id → 파일 이름
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    var m = /\/api\/docs\/files\/([^/]+)\/raw$/.exec(req.url().split('?')[0]);
    if (m && byId[decodeURIComponent(m[1])]) {
      raws++;
      return req.respond({ status: 200, contentType: 'application/octet-stream', body: fs.readFileSync(path.join(FIX, byId[decodeURIComponent(m[1])])) });
    }
    req.continue();
  });
  try {
    await page.setViewport({ width: 1500, height: 950 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    // 프로젝트 + 폴더 + 파일 기록 (원본 위치만 적어 둠)
    var names = fs.readdirSync(FIX);
    var made = await page.evaluate(async function (names) {
      var me = await apiFetch('/api/auth/me'); var u = me.data || me; var tid = u.tenant_id || u.tenantId || (u.user && (u.user.tenant_id || u.user.tenantId));
      var pid = 'e2e-dp-' + Date.now();
      await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ id: pid, name: '미리보기 시험', status: 'active', checklists: false }) });
      var fo = await apiFetch('/api/docs/folders', { method: 'POST', body: JSON.stringify({ projectId: pid, name: '자료' }) });
      var ids = {};
      for (var i = 0; i < names.length; i++) {
        var n = names[i], ext = n.split('.').pop();
        var r = await apiFetch('/api/docs/files', { method: 'POST', body: JSON.stringify({ id: 'dp-' + i + '-' + Date.now(), projectId: pid, folderId: fo.data.id, name: n, ext: ext, size: 1000, mimeType: '', storageKey: 'tenants/' + tid + '/docs/x' + i + '.' + ext }) });
        ids[r.data.id] = n;
      }
      return { pid: pid, ids: ids };
    }, names);
    byId = made.ids;
    var idOf = function (n) { for (var k in byId) if (byId[k] === n) return k; };
    check(Object.keys(byId).length === names.length, '파일 기록 ' + names.length + '개');

    // 문서 화면 → 그 프로젝트
    await page.evaluate(function () { setPage('project'); setMode('docs'); });
    await wait(800);
    await page.evaluate(function (pid) { if (typeof docSelectProject === 'function') docSelectProject(pid); }, made.pid);
    await wait(1200);
    async function pick(n, sel, test, ms) {
      await page.evaluate(function (id) { docPreviewTab = 'preview'; docClickFile(id); }, idOf(n));
      await page.evaluate(function () { var c = document.getElementById('docPreviewPanel'); if (c) c.scrollIntoView(); });
      await page.waitForFunction(function (sel) { return !!document.querySelector('#docPreviewContent ' + sel); }, { timeout: ms || 15000 }, sel).catch(function () {});
      await wait(400);
      return page.evaluate(test);
    }
    var r;
    r = await pick('도면.pdf', '.dp-page canvas', function () { var c = document.querySelectorAll('#docPreviewContent .dp-page'); var cv = document.querySelector('#docPreviewContent .dp-page canvas'); return { pages: c.length, w: cv && cv.width, bar: (document.querySelector('#docPreviewContent .dp-bar') || {}).textContent }; });
    check(r.pages === 2 && r.w > 100, 'PDF — 2쪽 · 첫 쪽 그림 ' + JSON.stringify(r));
    r = await pick('발표.pptx', '.dp-slide', function () {
      var s = document.querySelectorAll('#docPreviewContent .dp-slide-wrap'), first = document.querySelector('#docPreviewContent .dp-slide');
      var wrap = first && first.parentNode, rc = wrap && wrap.getBoundingClientRect(), fr = first && first.getBoundingClientRect();
      return { n: s.length, t: first && first.textContent, fit: rc && fr ? Math.abs(rc.width - fr.width) < 3 : false };
    });
    check(r.n === 3 && /장비 제안 발표/.test(r.t) && /자동화팀/.test(r.t), 'PPTX — 3장 · 제목/부제 ' + JSON.stringify(r));
    check(r.fit, 'PPTX — 슬라이드가 칸 폭에 맞춤');
    // 둘째 · 셋째 슬라이드(스크롤해야 보임) — 글머리 · 도형 · 표 · 그림
    await page.evaluate(function () { document.querySelectorAll('#docPreviewContent .dp-slide-wrap').forEach(function (w) { w.scrollIntoView(); }); });
    await page.waitForFunction(function () { return document.querySelectorAll('#docPreviewContent .dp-slide').length === 3; }, { timeout: 8000 }).catch(function () {});
    r = await page.evaluate(function () {
      var s = document.querySelectorAll('#docPreviewContent .dp-slide');
      var s2 = s[1], s3 = s[2];
      var box = s2 && Array.prototype.filter.call(s2.querySelectorAll('.dp-sh'), function (d) { return /중요 상자/.test(d.textContent); })[0];
      return { s2: s2 && s2.textContent, bu: s2 && s2.querySelectorAll('.dp-bu').length, boxBg: box && getComputedStyle(box).backgroundColor,
        tbl: s3 && s3.querySelectorAll('.dp-tbl td').length, img: s3 && (s3.querySelector('img') || {}).naturalWidth };
    });
    check(/설계 완료 12월/.test(r.s2) && r.bu >= 2, 'PPTX — 본문 글머리 ' + r.bu + '개');
    check(r.boxBg === 'rgb(255, 136, 0)', 'PPTX — 도형 채우기 색 ' + r.boxBg);
    check(r.tbl === 4 && r.img > 0, 'PPTX — 표 4칸 · 그림 ' + JSON.stringify({ tbl: r.tbl, img: r.img }));
    r = await pick('지시서.docx', '.dp-word', function () { var w = document.querySelector('#docPreviewContent .dp-word'); return { t: w && w.textContent, h: !!(w && w.querySelector('h1')), td: w ? w.querySelectorAll('td').length : 0 }; });
    check(/작업 지시서/.test(r.t) && /프레스 금형/.test(r.t) && r.h && r.td === 2, 'DOCX — 제목 · 본문 · 표 ' + JSON.stringify({ h: r.h, td: r.td }));
    r = await pick('견적.xlsx', '.dp-sheet table', function () { return { tabs: document.querySelectorAll('#docPreviewContent .dp-tabs button').length, t: (document.querySelector('#docPreviewContent .dp-sheet:not([hidden])') || {}).textContent }; });
    check(r.tabs === 2 && /모터/.test(r.t) && /120000/.test(r.t), 'XLSX — 시트 탭 2 · 내용');
    await page.evaluate(function () { document.querySelectorAll('#docPreviewContent .dp-tabs button')[1].click(); });
    r = await page.evaluate(function () { return (document.querySelector('#docPreviewContent .dp-sheet:not([hidden])') || {}).textContent; });
    check(/비고/.test(r || ''), 'XLSX — 둘째 시트로 바꾸기');
    r = await pick('목록.csv', '.dp-sheet table', function () { return document.querySelector('#docPreviewContent .dp-sheet table').textContent; });
    check(/볼트/.test(r) && /너트/.test(r), 'CSV(EUC-KR) — 표 · 한글 ' + r.slice(0, 30));
    r = await pick('메모.txt', '.dp-pre', function () { return document.querySelector('#docPreviewContent .dp-pre').textContent; });
    check(/한글 메모장 파일 - 이송 장치 점검/.test(r), '글(EUC-KR) — 한글 안 깨짐 ' + r);
    r = await pick('사진.png', '.dp-img img', function () { var i = document.querySelector('#docPreviewContent .dp-img img'); return new Promise(function (res) { var t = function () { res(i.naturalWidth); }; if (i.complete) t(); else i.onload = t; }); });
    check(r === 320, '그림 — 원래 폭 ' + r);
    r = await pick('보고서.hwpx', '.dp-hwp-img', function () { var i = document.querySelector('#docPreviewContent .dp-hwp-img'); return { img: !!i, t: (document.querySelector('#docPreviewContent .dp-pre') || {}).textContent }; });
    check(r.img && /한글 보고서 미리보기 글/.test(r.t || ''), 'HWPX — 미리보기 그림 · 글');
    r = await pick('옛발표.ppt', '.dp-msg', function () { return { m: document.querySelector('#docPreviewContent .dp-msg').textContent, b: document.querySelectorAll('#docPreviewContent .dp-fb-btns button').length }; });
    check(/옛 Office 형식/.test(r.m) && r.b >= 1, '옛 PPT — 안내 · 내려받기 단추');

    // ⛶ 크게 보기 — 이미 받은 원본은 다시 받지 않음
    await pick('발표.pptx', '.dp-slide', function () { return 1; });
    var before = raws;
    await page.evaluate(function () { var b = Array.prototype.filter.call(document.querySelectorAll('#docPreviewContent button'), function (x) { return /크게 보기/.test(x.textContent); })[0]; b.click(); });
    await page.waitForSelector('#docViewModal .dp-slide', { timeout: 10000 }).catch(function () {});
    r = await page.evaluate(function () {
      var m = document.getElementById('docViewModal'), w = m && m.querySelector('.dp-slide-wrap');
      return { open: !!m, nm: m && m.querySelector('.dpv-nm').textContent, w: w ? Math.round(w.getBoundingClientRect().width) : 0 };
    });
    check(r.open && r.nm === '발표.pptx' && r.w > 900, '크게 보기 — 열림 · 슬라이드 폭 ' + r.w);
    check(raws === before, '크게 보기 — 원본 다시 받지 않음');
    await page.evaluate(function () { var w = document.querySelectorAll('#docViewModal .dp-slide-wrap')[1]; if (w) w.scrollIntoView(); });
    await wait(800);
    await page.screenshot({ path: path.join(__dirname, '.shots', 'dp-pptx.png') });
    await page.keyboard.press('Escape');
    await wait(200);
    check(!(await page.$('#docViewModal')), 'Esc 로 닫힘');

    // 프로젝트 📂 문서 탭 — 이름 누르면 그 자리에서 크게
    await page.evaluate(function (pid) { setPage('project'); showProjectDetail(pid); }, made.pid);
    await page.waitForSelector('#pdTabDocs', { timeout: 10000 });
    await page.evaluate(function () { document.getElementById('pdTabDocs').click(); });
    await page.waitForSelector('#pdDocs .pdd-nm', { timeout: 8000 }).catch(function () {});
    await page.evaluate(function () { var n = Array.prototype.filter.call(document.querySelectorAll('#pdDocs .pdd-nm'), function (x) { return x.textContent === '지시서.docx'; })[0]; n.click(); });
    await page.waitForSelector('#docViewModal .dp-word', { timeout: 10000 }).catch(function () {});
    r = await page.evaluate(function () { var m = document.getElementById('docViewModal'); return { open: !!m, t: m && (m.querySelector('.dp-word') || {}).textContent, eye: document.querySelectorAll('#pdDocs .pdd-b[title^="미리보기"]').length }; });
    check(r.open && /작업 지시서/.test(r.t || ''), '📂 문서 탭 — 이름 누르면 미리보기 창');
    check(r.eye > 0, '📂 문서 탭 — 👁 단추');
    await page.evaluate(function () { docViewClose(); });

    // 좁은 화면(휴대폰) — 크게 보기가 화면 가득 · 가로 넘침 없음
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
    await page.evaluate(function (id) { return docViewFile(id); }, idOf('도면.pdf'));
    await page.waitForSelector('#docViewModal .dp-page canvas', { timeout: 10000 }).catch(function () {});
    r = await page.evaluate(function () { var b = document.querySelector('#docViewModal .dpv-box').getBoundingClientRect(); var body = document.querySelector('#docViewModal .dpv-body'); return { w: Math.round(b.width), hs: body.scrollWidth - body.clientWidth }; });
    check(r.w === 390 && r.hs <= 1, '휴대폰 — 크게 보기 전체 폭 · 가로 넘침 없음 ' + JSON.stringify(r));
    await page.evaluate(function () { docViewClose(); });

    await page.evaluate(function (pid) { return apiFetch('/api/projects/' + pid, { method: 'DELETE' }); }, made.pid);
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
