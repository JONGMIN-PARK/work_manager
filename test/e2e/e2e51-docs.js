// 📂 문서 넣기 보완 (v13.307) — 프로젝트 상세 📂 문서 탭 · 지금 단계 폴더 · 같은 이름 새 버전 · 실행 파일 막기 · 끌어다 놓기
//   · 문서 화면으로 · 📥 내 문서 → 프로젝트로 옮기기 · 문서 화면 어디든 끌어다 놓기
// GCS 는 run.sh 서버에 없으므로 upload-url 과 PUT 만 가로챔 (메타데이터 저장 · 권한은 실제 서버)
var path = require('path'), fs = require('fs'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var dialogs = [];
  page.on('dialog', function (d) { dialogs.push(d.message()); d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var tenantId = null, puts = 0;
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    var u = req.url();
    if (u.indexOf('/api/docs/files/upload-url') >= 0) {
      var b = JSON.parse(req.postData() || '{}');
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { uploadUrl: 'http://localhost:3000/__gcs_mock/put/' + Date.now(), storageKey: 'tenants/' + tenantId + '/docs/' + Date.now() + Math.random().toString(36).slice(2) + '.' + (b.ext || 'bin'), mimeType: b.mimeType } }) });
    }
    if (u.indexOf('http://localhost:3000/__gcs_mock/') === 0) {
      puts++;
      return req.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': '*' }, body: '' });
    }
    req.continue();
  });
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-docs-'));
  function mk(name, body) { var p = path.join(dir, name); fs.writeFileSync(p, body); return p; }
  var fA = mk('사양서.txt', '장비 사양 본문 검색어 프레스'), fB = mk('도면.hwp', 'hwp'), fX = mk('virus.exe', 'x');
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    tenantId = await page.evaluate(function () { return apiFetch('/api/auth/me').then(function (r) { var u = r.data || r; return u.tenant_id || u.tenantId || (u.user && (u.user.tenant_id || u.user.tenantId)); }); });
    check(!!tenantId, '회사 id ' + tenantId);
    // 새 프로젝트 (설계 단계)
    var proj = await page.evaluate(function () {
      var id = 'e2e-doc-' + Date.now();
      return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ id: id, name: '문서 시험 ' + id.slice(-4), currentPhase: 'design', status: 'active' }) })
        .then(function () { return typeof pmInvalidate === 'function' ? pmInvalidate() : null; }).then(function () { return { id: id }; });
    });
    await page.evaluate(function () { if (typeof _pmCache !== 'undefined') _pmCache = null; });

    // 1) 📂 문서 탭
    await page.evaluate(function (id) { setPage('project'); showProjectDetail(id); }, proj.id);
    await page.waitForSelector('#pdTabDocs', { timeout: 10000 });
    await page.evaluate(function () { document.getElementById('pdTabDocs').click(); });
    await page.waitForSelector('#pdDocs .pdd-empty', { timeout: 8000 }).catch(function () {});
    var empty = await page.evaluate(function () { var b = document.querySelector('#pdDocs .pdd-up button'); return { empty: !!document.querySelector('#pdDocs .pdd-empty'), btn: b && b.textContent, to: (document.querySelector('#pdDocsFolder option') || {}).textContent }; });
    check(empty.empty && /문서 넣기/.test(empty.btn || ''), '📂 문서 탭 — 빈 상태 · 넣기 단추 ' + JSON.stringify(empty));
    check(/지금 단계 \(설계\)/.test(empty.to || ''), '넣을 폴더 기본 = 지금 단계(설계)');

    // 2) 두 개 올리기 → 설계 폴더 · 탭 개수
    var inp = await page.$('#pdDocsInput');
    await inp.uploadFile(fA, fB);
    await page.waitForFunction(function () { return document.querySelectorAll('#pdDocs .pdd-row').length === 2; }, { timeout: 15000 }).catch(function () {});
    var up = await page.evaluate(function () {
      return { rows: document.querySelectorAll('#pdDocs .pdd-row').length, grp: (document.querySelector('#pdDocs .pdd-gh') || {}).textContent, n: (document.querySelector('[data-pd-n="docs"]') || {}).textContent, prog: !!document.getElementById('docUpProg'),
        hwpIcon: Array.prototype.some.call(document.querySelectorAll('#pdDocs .pdd-row'), function (r) { return /도면\.hwp/.test(r.textContent) && r.querySelector('.pdd-ic').textContent === '📘'; }) };
    });
    check(up.rows === 2 && /설계/.test(up.grp) && up.n === '2' && puts === 2, '올리기 → 📁 설계 · 탭 개수 2 ' + JSON.stringify(up) + ' puts=' + puts);
    check(up.hwpIcon && !up.prog, '한글 파일도 · 진행 표시는 끝나면 닫힘');
    var txt = await page.evaluate(function (id) { return fileGetByProject(id).then(function (a) { var f = a.filter(function (x) { return x.name === '사양서.txt'; })[0]; return f && f.textCache; }); }, proj.id);
    check(/프레스/.test(txt || ''), '본문 검색용 글 저장');

    // 3) 같은 이름 → 한 번 묻고 새 버전 · 실행 파일은 막음
    dialogs = [];
    inp = await page.$('#pdDocsInput');
    await inp.uploadFile(fA, fX);
    await page.waitForFunction(function () { return document.querySelectorAll('#pdDocs .pdd-row').length === 3; }, { timeout: 15000 }).catch(function () {});
    var ver = await page.evaluate(function () { return { rows: document.querySelectorAll('#pdDocs .pdd-row').length, old: document.querySelectorAll('#pdDocs .pdd-old').length, exe: /virus/.test(document.getElementById('pdDocs').textContent) }; });
    check(dialogs.length === 1 && /이미 있는 파일 1개/.test(dialogs[0]), '같은 이름 — 한 번만 물음 ' + JSON.stringify(dialogs));
    check(ver.rows === 3 && ver.old === 1 && !ver.exe, '새 버전 + 이전 것은 흐리게 · exe 는 안 올라감 ' + JSON.stringify(ver));

    // 4) 끌어다 놓기
    await page.evaluate(function () {
      var dt = new DataTransfer(); dt.items.add(new File(['검수 결과'], '검수표.csv', { type: 'text/csv' }));
      var el = document.querySelector('#pdDocs .pdd-row');
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await page.waitForFunction(function () { return /검수표\.csv/.test(document.getElementById('pdDocs').textContent); }, { timeout: 15000 }).catch(function () {});
    check(await page.evaluate(function () { return /검수표\.csv/.test(document.getElementById('pdDocs').textContent); }), '탭에 끌어다 놓기 → 올라감');

    // 5) ↗ 문서 화면
    await page.evaluate(function () { pdDocsOpenManager(); });
    await page.waitForSelector('#mDocs #docProjSel', { timeout: 10000 }).catch(function () {});
    await wait(500);
    var mgr = await page.evaluate(function () { return { sel: document.getElementById('docProjSel').value, panel: !!document.getElementById('projDetailPanel'), mine: !!document.querySelector('#docProjSel option[value="__mine"]') }; });
    check(mgr.sel === proj.id && !mgr.panel, '↗ 문서 화면 — 이 프로젝트로 ' + JSON.stringify(mgr));
    check(mgr.mine, '프로젝트 고르기에 📥 내 문서');

    // 6) 문서 화면 — 파일 목록 어디에 놓아도 (전체 보기 → 설계 폴더로)
    await page.evaluate(function () {
      var dt = new DataTransfer(); dt.items.add(new File(['x'], '견적.txt', { type: 'text/plain' }));
      var el = document.querySelector('#mDocs .doc-drop');
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await wait(1500);
    var placed = await page.evaluate(function (id) {
      return Promise.all([fileGetByProject(id), folderGetByProject(id)]).then(function (r) {
        var f = r[0].filter(function (x) { return x.name === '견적.txt'; })[0]; var fo = f && r[1].filter(function (x) { return x.id === f.folderId; })[0];
        return { has: !!f, folder: fo && fo.name, hint: (document.querySelector('#mDocs .doc-drop-hint') || {}).textContent };
      });
    }, proj.id);
    check(placed.has && placed.folder === '설계', '문서 화면 끌어다 놓기 → 지금 단계 폴더 ' + JSON.stringify(placed));
    var stray = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('.wa-toast'), function (t) { return t.textContent; }).filter(function (t) { return /파싱/.test(t); }); });
    check(!stray.length, '업무일지 가져오기가 끼어들지 않음 ' + JSON.stringify(stray));

    // 7) 📥 내 문서 → 프로젝트로 옮기기
    // 이전 실행이 남긴 내 문서는 지우고 시작
    var pfId = await page.evaluate(function () {
      return fileGetPersonal().then(function (a) { return Promise.all(a.map(function (f) { return fileDel(f.id); })); }).then(function () {
        var id = 'pf-e2e-' + Date.now();
        return apiFetch('/api/docs/files', { method: 'POST', body: JSON.stringify({ id: id, projectId: null, name: '텔레그램 사진.jpg', ext: 'jpg', size: 10 }) }).then(function () { return id; });
      });
    });
    await page.evaluate(function () { docViewMode = 'list'; docSelectProject('__mine'); });
    await page.waitForFunction(function () { return /텔레그램 사진/.test((document.getElementById('mDocs') || {}).textContent || ''); }, { timeout: 8000 }).catch(function () {});
    var mine = await page.evaluate(function () { var t = document.getElementById('mDocs').textContent; return { has: /텔레그램 사진/.test(t), tip: /텔레그램으로 보낸/.test(t), mv: !!document.querySelector('#mDocs [title="프로젝트로 옮기기"]') }; });
    check(mine.has && mine.tip && mine.mv, '📥 내 문서 — 목록 · 안내 · 옮기기 단추 ' + JSON.stringify(mine));
    await page.click('#mDocs [title="프로젝트로 옮기기"]');
    await page.waitForSelector('#docMoveProjModal #docMvProj', { timeout: 5000 });
    await page.select('#docMvProj', proj.id);
    await page.waitForFunction(function () { var s = document.getElementById('docMvFolder'); return s && !s.disabled; }, { timeout: 8000 });
    var fsel = await page.evaluate(function () { var s = document.getElementById('docMvFolder'); return s.options[s.selectedIndex].textContent; });
    check(/설계/.test(fsel), '옮길 폴더 기본 = 그 프로젝트 지금 단계 ' + fsel);
    await page.click('#docMvGo');
    await page.waitForFunction(function () { return !document.getElementById('docMoveProjModal'); }, { timeout: 8000 }).catch(function () {});
    await wait(800);
    var moved = await page.evaluate(function (id, pid) { return Promise.all([fileGetPersonal(), fileGetByProject(id)]).then(function (r) { return { personal: r[0].length, inProj: r[1].some(function (f) { return f.id === pid; }) }; }); }, proj.id, pfId);
    check(moved.personal === 0 && moved.inProj, '옮긴 뒤 — 내 문서 비고 프로젝트에 ' + JSON.stringify(moved));

    // 8) 휴대폰 폭 — 문서 탭이 넘치지 않음
    await page.setViewport({ width: 390, height: 800 });
    await page.evaluate(function (id) { setPage('project'); showProjectDetail(id); }, proj.id);
    await page.waitForSelector('#pdTabDocs', { timeout: 10000 });
    await page.evaluate(function () { document.getElementById('pdTabDocs').click(); });
    await page.waitForSelector('#pdDocs .pdd-row', { timeout: 8000 }).catch(function () {});
    var mob = await page.evaluate(function () { var p = document.getElementById('projDetailPanel'); return { sw: p.scrollWidth, cw: p.clientWidth }; });
    check(mob.sw <= mob.cw + 1, '휴대폰 폭에서 가로로 넘치지 않음 ' + JSON.stringify(mob));

    // 정리
    await page.evaluate(function (id) { return apiFetch('/api/projects/' + id, { method: 'DELETE' }).catch(function () {}); }, proj.id);
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack);
  }
  await browser.close();
  console.log(fail ? ('FAILED ' + fail + ' / ' + (ok + fail)) : ('ALL PASS (' + ok + ')'));
  process.exit(fail ? 1 : 0);
})();
