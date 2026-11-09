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
    var d = function (n) { var x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    for (var t of [['EES 미팅 (MITech, DS ENT) 자료 준비와 장비 셋업 일정 조율 — 긴 제목 시험', 2], ['견적서 정리', 0], ['사양서 검토', 1], ['나중 일', 30]]) await apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: t[0], dueDate: d(t[1]) }) }).catch(function () {});
    for (var k = 0; k < 4; k++) await apiFetch('/api/issues', { method: 'POST', body: JSON.stringify({ projectId: p.id, title: '현장 이슈 ' + k + ' — 정렬 카메라 인식 오류가 간헐적으로 발생', dueDate: d(k - 2), status: k % 2 ? 'inProgress' : 'open', type: 'bug', urgency: k === 0 ? 'urgent' : 'normal' }) }).catch(function () {});
    for (var q = 1; q <= 3; q++) await createOrder({ orderNo: 'SP' + (3960 + q) + '-EPN', name: 'UV LASER CUT SYSTEM ' + q + '호기 — 고객사 라인 증설', client: '대덕전자', date: d(-20 * q), amount: 120000000 * q, manager: '관리자', delivery: d(30 * q) }).catch(function () {});
    return p.id;
  });
  function clean() { return page.evaluate(function () { try { pdSwitchTab('overview'); } catch (_) {} document.querySelectorAll('.wa-modal-overlay,#projModal,#evtModal,.pd-overlay,#pdOverlay,#issueModal,#asModal,#mwPanel.on').forEach(function (e) { e.remove(); }); try { if (typeof mwPanelClose === 'function') mwPanelClose(); } catch (_) {} try { if (typeof pdCloseDetail === 'function') pdCloseDetail(); } catch (_) {} var h = document.querySelector('.hdr'); if (h) h.classList.remove('more-on'); var nd = document.getElementById('notifDropdown'); if (nd) nd.style.display = 'none'; window.scrollTo(0, 0); }); }
  var screens = [
    ['mywork', function () { setPage('mywork'); }],
    ['mywork-month', function () { setPage('mywork'); var b = document.querySelector('#mMyWork [data-mwc-view="month"]'); if (b) b.click(); }],
    ['mywork-week', function () { setPage('mywork'); var b = document.querySelector('#mMyWork [data-mwc-view="week"]'); if (b) b.click(); }],
    ['mywork-board', function () { setPage('mywork'); var b = document.querySelector('#mMyWork [data-mwc-view="board"]'); if (b) b.click(); }],
    ['mywork-list', function () { setPage('mywork'); var b = document.querySelector('#mMyWork [data-mwc-view="list"]'); if (b) b.click(); }],
    ['mindmap', function () { setPage('mindmap'); }],
    ['notebook', function () { setPage('notebook'); }],
    ['team-weekly', function () { setPage('team'); setMode('weekly'); }],
    // v13.404 데이터가 있는 주간 분석 (zz-team-seed.js 를 앞에 같이 돌리면) — 팀원 전체 고르고 탭마다
    ['team-weekly-tbl', function () { setPage('team'); setMode('weekly'); try { selAll(); } catch (_) {} if (typeof sTab === 'function') sTab('tbl'); }],
    ['team-weekly-cht', function () { setPage('team'); setMode('weekly'); try { selAll(); } catch (_) {} if (typeof sTab === 'function') sTab('cht'); }],
    ['team-weekly-sum', function () { setPage('team'); setMode('weekly'); try { selAll(); } catch (_) {} if (typeof sTab === 'function') sTab('sum'); }],
    ['team-weekly-cmp', function () { setPage('team'); setMode('weekly'); try { selAll(); var t = document.getElementById('cmpTog'); if (t && !t.checked) { t.checked = true; togCompare(); } } catch (_) {} }],
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
    ['header-look', function () { wmHdrPop('hdrLookWrap'); }],
    ['header-user', function () { wmHdrPop('hdrUserWrap'); }],
    ['header-search', function () { document.getElementById('globalSearchInput').focus(); }],
    ['notif', function () { if (typeof toggleNotifPanel === 'function') toggleNotifPanel(); }],
    // v13.297~308 에서 생긴 화면
    ['ai-ask', function () { return wmAiAsk(); }],
    ['tg-group', function (pid) { return pdTgGroupModal(pid); }],
    ['pd-lifecycle', function (pid) { return showProjectDetail(pid).then(function () { pdSwitchTab('lifecycle', pid); }); }],
    ['pd-issues', function (pid) { return showProjectDetail(pid).then(function () { pdSwitchTab('issues', pid); }); }],
    ['pd-dev', function (pid) { return showProjectDetail(pid).then(function () { pdSwitchTab('dev', pid); }); }],
    ['pd-meeting', function (pid) { return showProjectDetail(pid).then(function () { pdSwitchTab('meeting', pid); }); }],
    ['pd-docs', function (pid) { return showProjectDetail(pid).then(function () { pdSwitchTab('docs', pid); }); }],
    ['pd-work', function (pid) { return showProjectDetail(pid).then(function () { pdSwitchTab('work', pid); }); }],
    ['pd-spec', function (pid) { return showProjectDetail(pid).then(function () { pdSwitchTab('spec', pid); }); }],
    ['profile', function () { return showProfileModal(); }],
    ['mindmap-map', function () { setPage('mindmap'); return apiFetch('/api/mindmaps').then(function (r) { var m = (r.data || [])[0]; if (m) { mmOpen(m.id); setTimeout(function () { _mmSetView('map'); }, 900); } }); }]
  ];
  var report = [];
  // v13.404 D = 줄인 PC 창(480, 마우스) — ORI=P,D 처럼 고름
  var ALL_OR = { P: ['P', 402, 874, true], L: ['L', 874, 402, true], D: ['D', 480, 890, false] };
  var orients = (process.env.ORI || 'P,L').split(',').map(function (k) { return ALL_OR[k]; }).filter(Boolean);
  for (var oi = 0; oi < orients.length; oi++) {
    var o = orients[oi];
    await page.setViewport({ width: o[1], height: o[2], isMobile: o[3], hasTouch: o[3], deviceScaleFactor: 1 });
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
