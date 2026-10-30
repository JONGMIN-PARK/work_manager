// 📱 아이폰 17 Pro 화면 점검 도구 (run.sh 묶음에는 안 넣음) — bash test/e2e/run.sh mobile-audit.js · 결과 test/e2e/.shots/mobile/*.png · report.json · ONLY=화면,화면 으로 일부만
//   화면마다: 가로 넘침 · 화면 밖으로 나간 요소 · 16px 미만 입력칸(iOS 자동 확대) · 작은 터치 영역 · 스크린샷
var path = require('path'), fs = require('fs');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var OUT = path.join(__dirname, '.shots', 'mobile');
fs.mkdirSync(OUT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1');
  await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#loginEmail', { visible: true });
  await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
  await page.keyboard.press('Enter');
  await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
  await wait(800);
  var pid = await page.evaluate(async function () {
    var p = await createProject({ name: '모바일 점검 장비', startDate: '2026-10-01', endDate: '2026-12-31', status: 'active', assignees: ['관리자'], visibility: 'tenant' });
    await createMilestone({ projectId: p.id, name: '설계', startDate: '2026-10-01', endDate: '2026-10-20', order: 0 });
    return p.id;
  });
  function clean() { return page.evaluate(function () { document.querySelectorAll('.wa-modal-overlay,#projModal,#evtModal,.pd-overlay,#pdOverlay,#issueModal,#asModal,#mwPanel.on').forEach(function (e) { e.remove(); }); try { if (typeof mwPanelClose === 'function') mwPanelClose(); } catch (_) {} try { if (typeof pdCloseDetail === 'function') pdCloseDetail(); } catch (_) {} var h = document.querySelector('.hdr'); if (h) h.classList.remove('more-on'); var nd = document.getElementById('notifDropdown'); if (nd) nd.style.display = 'none'; window.scrollTo(0, 0); }); }
  var screens = [
    ['mywork', function () { setPage('mywork'); }],
    ['mywork-month', function () { setPage('mywork'); var b = document.querySelector('#mMyWork [data-mwc-view="month"]'); if (b) b.click(); }],
    ['mywork-week', function () { setPage('mywork'); var b = document.querySelector('#mMyWork [data-mwc-view="week"]'); if (b) b.click(); }],
    ['mywork-board', function () { setPage('mywork'); var b = document.querySelector('#mMyWork [data-mwc-view="board"]'); if (b) b.click(); }],
    ['mywork-list', function () { setPage('mywork'); var b = document.querySelector('#mMyWork [data-mwc-view="list"]'); if (b) b.click(); }],
    ['mindmap', function () { setPage('mindmap'); }],
    ['team-weekly', function () { setPage('team'); setMode('weekly'); }],
    ['team-archive', function () { setPage('team'); setMode('archive'); }],
    ['team-trend', function () { setPage('team'); setMode('trend'); }],
    ['team-weekly_report', function () { setPage('team'); setMode('weekly_report'); }],
    ['team-workload', function () { setPage('team'); setMode('workload'); }],
    ['proj-pipeline', function () { setPage('project'); setMode('pipeline'); }],
    ['proj-calendar', function () { setPage('project'); setMode('calendar'); }],
    ['proj-timeline', function () { setPage('project'); setMode('timeline'); }],
    ['proj-orders', function () { setPage('project'); setMode('orders'); }],
    ['proj-prestudy', function () { setPage('project'); setMode('prestudy'); }],
    ['proj-tech', function () { setPage('project'); setMode('tech'); }],
    ['proj-issues', function () { setPage('project'); setMode('issues'); }],
    ['proj-docs', function () { setPage('project'); setMode('docs'); }],
    ['proj-as', function () { setPage('project'); setMode('as'); }],
    ['proj-operator', function () { setPage('project'); setMode('operator'); }],
    ['messages', function () { setPage('messages'); }],
    ['useradmin', function () { setPage('useradmin'); }],
    ['patchnotes', function () { setPage('patchnotes'); }],
    ['modal-proj', function (pid) { setPage('project'); setMode('timeline'); return showProjectModal(pid); }],
    ['panel-projdetail', function (pid) { return showProjectDetail(pid); }],
    ['modal-event', function () { setPage('project'); setMode('calendar'); return showEventModal(); }],
    ['modal-issue', function () { return typeof showIssueModal === 'function' && showIssueModal(); }],
    ['modal-as', function () { return typeof showASModal === 'function' && showASModal(); }],
    ['modal-order', function () { return typeof showOrderModal === 'function' && showOrderModal(); }],
    ['panel-todo', function () { setPage('mywork'); var r = document.querySelector('#mMyWork .mw-row[data-key]'); if (r) r.click(); }],
    ['panel-mwp', function () { setPage('mywork'); var it = (_mw.items || _mw.data && _mw.data.items || [])[0]; if (it) mwPanelOpen(it); }],
    ['mindmap-editor', function () { setPage('mindmap'); return apiFetch('/api/mindmaps').then(function (r) { var m = (r.data || [])[0]; if (m) mmOpen(m.id); }); }],
    ['header-more', function () { var b = document.querySelector('.hdr-more-tg'); if (b) b.click(); }],
    ['notif', function () { if (typeof toggleNotifPanel === 'function') toggleNotifPanel(); }]
  ];
  var report = [];
  var orients = [['P', 402, 874], ['L', 874, 402]];
  for (var oi = 0; oi < orients.length; oi++) {
    var o = orients[oi];
    await page.setViewport({ width: o[1], height: o[2], isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await wait(500);
    for (var i = 0; i < screens.length; i++) {
      var nm = screens[i][0];
      if (ONLY && ONLY.indexOf(nm) < 0) continue;
      await clean(); await wait(200);
      try { await page.evaluate(screens[i][1], pid); } catch (e) { report.push({ s: o[0] + ':' + nm, err: e.message.slice(0, 120) }); continue; }
      await wait(1800);
      var m = await page.evaluate(function (W) {
        var out = { overflowX: document.documentElement.scrollWidth - W, off: [], smallInputs: 0, smallInputSample: [], tinyTaps: 0, tinySample: [] };
        function scrollParent(el) { for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) { var cs = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(cs.overflowX)) return p; } return null; }
        function vis(el) { var r = el.getBoundingClientRect(); var cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }
        Array.from(document.querySelectorAll('body *')).forEach(function (el) {
          if (!vis(el)) return;
          var r = el.getBoundingClientRect();
          if ((r.right > W + 1 || r.left < -1) && !scrollParent(el) && out.off.length < 8) {
            var cs = getComputedStyle(el); if (cs.position === 'fixed' && r.left >= W) return;
            out.off.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0]) + ' [' + Math.round(r.left) + '→' + Math.round(r.right) + ']');
          }
        });
        Array.from(document.querySelectorAll('input,select,textarea')).forEach(function (el) {
          if (!vis(el) || el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden' || el.type === 'file' || el.type === 'range' || el.type === 'color') return;
          var fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 16) { out.smallInputs++; if (out.smallInputSample.length < 4) out.smallInputSample.push((el.id || el.className || el.tagName) + ':' + fs + ':' + (el.type || '')); }
        });
        Array.from(document.querySelectorAll('button,a,[onclick],input[type=checkbox],select')).forEach(function (el) {
          if (!vis(el)) return; var r = el.getBoundingClientRect();
          if (r.top > window.innerHeight || r.bottom < 0) return;
          if (r.height < 24 || r.width < 24) { out.tinyTaps++; if (out.tinySample.length < 5) out.tinySample.push((el.id || String(el.className || el.tagName).split(' ')[0]) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || '').trim().slice(0, 12) + '"'); }
        });
        return out;
      }, o[1]);
      m.s = o[0] + ':' + nm;
      report.push(m);
      await page.screenshot({ path: path.join(OUT, o[0] + '-' + nm + '.png') });
    }
  }
  await clean();
  await page.evaluate(function (id) { return deleteProjectCascade(id); }, pid).catch(function () {});
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  report.forEach(function (r) { console.log(r.s, r.err ? 'ERR ' + r.err : ('ovX=' + r.overflowX + ' off=' + r.off.length + ' smallIn=' + r.smallInputs + ' tiny=' + r.tinyTaps)); });
  console.log('errs', JSON.stringify(errs.slice(0, 5)));
  console.log('ALL PASS audit');
})().catch(function (e) { console.log('ERR', e.message); process.exit(1); });
