// 📱 아이폰 17 Pro(402×874) 깊은 점검 — 화면마다 하위 탭 · 그 하위 탭까지 스스로 찾아 눌러 보며
//   txt  : 글자가 자기 칸(테두리 · 배경 있는 상자) 밖으로 삐져나감 / 말줄임 없이 잘림
//   clip : 단추 · 칸이 부모 밖으로 잘림     hs : 가로로 밀어야 보이는 칸
//   tap  : 손가락으로 누르기 작은 것(높이 또는 폭 < 32px)   in : 16px 미만 입력칸(누르면 확대)
//   run: bash test/e2e/run.sh zz-team-seed.js iphone-audit.js → .shots/iphone/report.json · PNG   ONLY=화면,화면
var path = require('path'), fs = require('fs');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var OUT = path.join(__dirname, '.shots', 'iphone');
fs.mkdirSync(OUT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
var W = +(process.env.VW || 402), H = +(process.env.VH || 874);
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.dismiss(); });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1');
  await page.setViewport({ width: W, height: H, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#loginEmail', { visible: true });
  await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
  await page.keyboard.press('Enter');
  await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
  await wait(800);
  var pid = await page.evaluate(async function () {
    var p = await createProject({ name: '모바일 점검 장비 — UV LASER CUT SYSTEM 증설', startDate: '2026-10-01', endDate: '2026-12-31', status: 'active', assignees: ['관리자'], visibility: 'tenant' });
    await createMilestone({ projectId: p.id, name: '설계 · 도면 검토', startDate: '2026-10-01', endDate: '2026-10-20', order: 0 });
    var d = function (n) { var x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    for (var t of [['EES 미팅 (MITech, DS ENT) 자료 준비와 장비 셋업 일정 조율 — 긴 제목 시험', 2], ['견적서 정리', 0], ['사양서 검토', 1], ['나중 일', 30]]) await apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: t[0], dueDate: d(t[1]) }) }).catch(function () {});
    for (var k = 0; k < 4; k++) await apiFetch('/api/issues', { method: 'POST', body: JSON.stringify({ projectId: p.id, title: '현장 이슈 ' + k + ' — 정렬 카메라 인식 오류가 간헐적으로 발생', dueDate: d(k - 2), status: k % 2 ? 'inProgress' : 'open', type: 'bug', urgency: k === 0 ? 'urgent' : 'normal' }) }).catch(function () {});
    for (var q = 1; q <= 3; q++) await createOrder({ orderNo: 'SP' + (3960 + q) + '-EPN', name: 'UV LASER CUT SYSTEM ' + q + '호기 — 고객사 라인 증설', client: '대덕전자', date: d(-20 * q), amount: 120000000 * q, manager: '관리자', delivery: d(30 * q) }).catch(function () {});
    return p.id;
  });
  function clean() { return page.evaluate(function () { try { if (window.wmIsland) wmIsland.close(); } catch (_) {} try { pdSwitchTab('overview'); } catch (_) {} var u = document.getElementById('wmUpd'); if (u) u.remove(); var gi = document.getElementById('globalSearchInput'); if (gi) { gi.value = ''; gi.blur(); } var gd = document.getElementById('globalSearchDropdown'); if (gd) gd.style.display = 'none'; if (typeof curPage !== 'undefined' && curPage === 'messages') try { setPage('mywork'); } catch (_) {} document.querySelectorAll('.nt-overlay,#ntOverlay,.wa-modal-overlay,#projModal,#evtModal,.pd-overlay,#pdOverlay,#issueModal,#asModal,#mwPanel.on,.wm-dlg-ov,.modal-overlay,.mo').forEach(function (e) { e.remove(); }); try { if (typeof mwPanelClose === 'function') mwPanelClose(); } catch (_) {} try { if (typeof pdCloseDetail === 'function') pdCloseDetail(); } catch (_) {} try { if (typeof chatCloseRoom === 'function') chatCloseRoom(); } catch (_) {} var nd = document.getElementById('notifDropdown'); if (nd) nd.style.display = 'none'; document.querySelectorAll('.wm-hdr-pop.on,.hdr-pop.on').forEach(function (e) { e.classList.remove('on'); }); }); }
  var R = [
    ['mywork', function () { setPage('mywork'); }],
    ['mindmap', function () { setPage('mindmap'); }],
    ['mindmap-editor', function () { setPage('mindmap'); return apiFetch('/api/mindmaps').then(function (r) { var m = (r.data || [])[0]; if (m) mmOpen(m.id); }); }],
    ['notebook', function () { setPage('notebook'); }],
    ['team-weekly', function () { setPage('team'); setMode('weekly'); try { selAll(); } catch (_) {} }],
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
    ['chat-room', function () { setPage('messages'); return new Promise(function (res) { setTimeout(function () { var r = (CX.rooms || [])[0]; if (r) chatOpenRoom(r.id); res(); }, 900); }); }],
    ['useradmin', function () { setPage('useradmin'); }],
    ['patchnotes', function () { setPage('patchnotes'); }],
    ['pd', function (pid) { return showProjectDetail(pid); }],
    ['modal-proj', function (pid) { setPage('project'); setMode('timeline'); return showProjectModal(pid); }],
    ['modal-event', function () { setPage('project'); setMode('calendar'); return showEventModal(); }],
    ['modal-issue', function () { return typeof showIssueModal === 'function' && showIssueModal(); }],
    ['modal-as', function () { return typeof showASModal === 'function' && showASModal(); }],
    ['modal-order', function () { return typeof showOrderModal === 'function' && showOrderModal(); }],
    ['panel-mwp', function () { setPage('mywork'); var it = (_mw.items || _mw.data && _mw.data.items || [])[0]; if (it) mwPanelOpen(it); }],
    ['header-look', function () { wmHdrPop('hdrLookWrap'); }],
    ['header-user', function () { wmHdrPop('hdrUserWrap'); }],
    ['island', function () { if (window.wmIsland) wmIsland.open(); }],
    ['notif', function () { if (typeof toggleNotifPanel === 'function') toggleNotifPanel(); }],
    ['ai-ask', function () { return wmAiAsk(); }],
    ['profile', function () { return showProfileModal(); }],
    ['notices', function () { if (typeof wmNoticeOpen === 'function') wmNoticeOpen(); }],
    ['search-results', function () { var i = document.getElementById('globalSearchInput'); i.focus(); i.value = '점검'; return globalSearch('점검'); }]
  ];
  // 지금 화면에서 하위 탭 후보 — 머리 줄 · 대메뉴 · 아일랜드 · 모드 탭은 뺌(뿌리 목록이 이미 다룸)
  async function findTabs(all) {
    return page.evaluate(function (all) {
      var SEL = '[role=tab],.tabs>button,.tabs>.tab,.sub-tabs>button,.sub-tabs>.tab,[class*="-tabs"]>button,[class*="-tabs"]>.tab,[class*="-tabs"]>[data-tab],[data-tab],[data-mwc-view],[data-view]';
      var NO = '.hdr,#pageTabs,#modeTabs,#modeTabsProj,#wmIslandPanel,#wmIsland,.page-tabs';
      var out = [], seen = {};
      document.querySelectorAll(SEL).forEach(function (el) {
        if (el.closest(NO)) return;
        var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (r.width < 4 || r.height < 4 || cs.visibility === 'hidden' || cs.display === 'none' || r.top > innerHeight * 2) return;
        if (/active|\bon\b|sel/.test(el.className) || el.getAttribute('aria-selected') === 'true') return;   // 이미 열린 탭
        var lab = (el.textContent || el.getAttribute('title') || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 18);
        if (!lab || /삭제|지우|휴지통|나가기|로그아웃|초기화|닫기|✕|×/.test(lab)) return;
        if (seen[lab]) return; seen[lab] = 1;
        var id = 'zt' + Math.random().toString(36).slice(2, 8); el.setAttribute('data-zt', id);
        out.push({ id: id, lab: lab });
      });
      return out.slice(0, 20);
    }, !!all);
  }
  async function clickLab(lab) {
    var ts = await findTabs(true), t = ts.filter(function (x) { return x.lab === lab; })[0];
    if (!t) return false;
    return page.evaluate(function (id) { var e = document.querySelector('[data-zt="' + id + '"]'); if (!e) return false; e.click(); return true; }, t.id).catch(function () { return false; });
  }
  async function measure() {
    return page.evaluate(function () {
      var W = window.innerWidth, Hh = window.innerHeight, out = { txt: [], clip: [], hs: [], tap: [], inp: [], tapN: 0 };
      function nm(el) { return (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || '').trim().split(/\s+/).slice(0, 2).join('.')); }
      function vis(el) { var r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; }
      function inView(r) { return r.bottom > 0 && r.top < Hh && r.right > 0 && r.left < W; }
      function boxed(cs) { return (cs.borderLeftWidth !== '0px' && cs.borderLeftStyle !== 'none') || (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) || cs.overflowX !== 'visible'; }
      // 1) 글자 넘침
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.nodeValue.trim().length > 1 ? 1 : 3; } });
      var n, cnt = 0, rg = document.createRange();
      while ((n = walker.nextNode()) && cnt < 6000) {
        cnt++;
        var el = n.parentElement; if (!el || !vis(el)) continue;
        if (el.closest('svg,canvas,script,style,.hdr-mark,[aria-hidden=true]')) continue;
        rg.selectNodeContents(n); var tr = rg.getBoundingClientRect();
        if (!tr.width || !inView(tr)) continue;
        for (var p = el; p && p !== document.body; p = p.parentElement) {
          var cs = getComputedStyle(p);
          if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') break;   // 밀어서 봄
          if (!boxed(cs)) continue;
          var pr = p.getBoundingClientRect();
          var padR = parseFloat(cs.borderRightWidth) || 0, padL = parseFloat(cs.borderLeftWidth) || 0;
          var over = Math.max(tr.right - (pr.right - padR), (pr.left + padL) - tr.left);
          if (over > 2) {
            var hidden = cs.overflowX !== 'visible';
            if (hidden && cs.textOverflow === 'ellipsis') break;
            if (hidden) { var ec = getComputedStyle(el); if (ec.textOverflow === 'ellipsis') break; }
            if (out.txt.length < 14) out.txt.push((hidden ? '잘림 ' : '넘침 ') + Math.round(over) + 'px "' + n.nodeValue.trim().slice(0, 16) + '" in ' + nm(p) + ' w' + Math.round(pr.width));
          }
          break;
        }
      }
      // 2) 잘린 단추 · 3) 가로 밀림
      Array.from(document.querySelectorAll('button,a,input,select,textarea,[onclick]')).forEach(function (el) {
        if (!vis(el) || out.clip.length >= 10) return;
        var r = el.getBoundingClientRect(); if (!inView(r)) return;
        for (var p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
          var cs = getComputedStyle(p), ox = cs.overflowX;
          if (ox === 'visible') continue;
          if (ox === 'auto' || ox === 'scroll') return;
          var pr = p.getBoundingClientRect();
          if ((r.right > pr.right + 2 || r.left < pr.left - 2) && !(r.left >= pr.right || r.right <= pr.left)) out.clip.push(nm(el) + ' "' + (el.textContent || el.value || el.placeholder || '').trim().slice(0, 10) + '" [' + Math.round(r.left) + '→' + Math.round(r.right) + '] in ' + nm(p));
          return;
        }
        if (r.right > W + 1 || r.left < -1) out.clip.push(nm(el) + ' 화면 밖 [' + Math.round(r.left) + '→' + Math.round(r.right) + ']');
      });
      Array.from(document.querySelectorAll('body *')).forEach(function (el) {
        if (out.hs.length >= 10 || !vis(el)) return;
        var cs = getComputedStyle(el); if (!/(auto|scroll)/.test(cs.overflowX)) return;
        var r = el.getBoundingClientRect(); if (!inView(r)) return;
        if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 60) out.hs.push(nm(el) + ' ' + el.clientWidth + '<' + el.scrollWidth);
      });
      // 4) 손가락 크기
      Array.from(document.querySelectorAll('button,a[href],a[onclick],[onclick],select,[role=tab],[role=button],input[type=checkbox],input[type=radio],label[for]')).forEach(function (el) {
        if (!vis(el)) return; var r = el.getBoundingClientRect(); if (!inView(r)) return;
        if (el.closest('.cx-msgs .cx-b')) return;   // 말풍선 안 글 링크
        if (r.height < 32 || r.width < 32) { out.tapAll = out.tapAll || {}; out.tapAll[nm(el)] = Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + (el.textContent || el.title || '').trim().slice(0, 8); out.tapN++; if (out.tap.length < 12) out.tap.push(nm(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || el.title || '').trim().slice(0, 10) + '"'); }
      });
      Array.from(document.querySelectorAll('input,select,textarea')).forEach(function (el) {
        if (!vis(el) || /checkbox|radio|hidden|file|range|color/.test(el.type)) return;
        var fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 16 && out.inp.length < 5) out.inp.push(nm(el) + ':' + fs);
      });
      Array.from(document.querySelectorAll('button,input[placeholder],select,.tab,[role=tab]')).forEach(function (el) {
        if (!vis(el) || out.txt.length >= 20) return; var r = el.getBoundingClientRect(); if (!inView(r)) return;
        var cs = getComputedStyle(el);
        if (el.tagName === 'INPUT' && !el.value && el.placeholder) {
          var c = document.createElement('canvas').getContext('2d'); c.font = cs.fontSize + ' ' + cs.fontFamily;
          var need = c.measureText(el.placeholder).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
          if (need > el.clientWidth + 6) out.txt.push('안내 잘림 "' + el.placeholder.slice(0, 14) + '" ' + Math.round(el.clientWidth) + '<' + Math.round(need) + ' ' + nm(el));
        } else if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis') out.txt.push('단추 글 넘침 "' + (el.textContent || '').trim().slice(0, 14) + '" ' + el.clientWidth + '<' + el.scrollWidth + ' ' + nm(el));
      });
      out.ovX = document.documentElement.scrollWidth - W;
      return out;
    });
  }
  var report = [], shot = 0;
  async function audit(name) {
    await wait(900);
    var m = await measure(); m.s = name; report.push(m);
    var f = name.replace(/[^\w가-힣.-]+/g, '_').slice(0, 80);
    if (m.txt.length || m.clip.length || m.tapN > 6) await page.screenshot({ path: path.join(OUT, f + '.png') }).catch(function () {});
    console.log(name, 'txt=' + m.txt.length, 'clip=' + m.clip.length, 'hs=' + m.hs.length, 'tap=' + m.tapN, 'in=' + m.inp.length);
  }
  for (var i = 0; i < R.length; i++) {
    var nm0 = R[i][0];
    if (ONLY && ONLY.indexOf(nm0) < 0) continue;
    await clean(); await wait(250);
    try { await page.evaluate(R[i][1], pid); } catch (e) { report.push({ s: nm0, err: String(e.message).slice(0, 120) }); continue; }
    await wait(900);
    await audit(nm0);
    var tabs = (await findTabs()).slice(0, 10), done = {};
    for (var a = 0; a < tabs.length; a++) {
      await clean(); await wait(200);
      try { await page.evaluate(R[i][1], pid); } catch (e) { continue; }
      await wait(900);
      if (!(await clickLab(tabs[a].lab))) continue;
      await audit(nm0 + ' › ' + tabs[a].lab);
      var sub = (await findTabs()).filter(function (t) { return !tabs.some(function (x) { return x.lab === t.lab; }); }).slice(0, 7);
      for (var b = 0; b < sub.length; b++) {
        if (done[sub[b].lab]) continue; done[sub[b].lab] = 1;
        if (b > 0) { await clean(); await wait(200); try { await page.evaluate(R[i][1], pid); } catch (e) { continue; } await wait(900); await clickLab(tabs[a].lab); await wait(700); }
        if (await clickLab(sub[b].lab)) await audit(nm0 + ' › ' + tabs[a].lab + ' › ' + sub[b].lab);
      }
    }
  }
  await clean();
  await page.evaluate(function (id) { return deleteProjectCascade(id); }, pid).catch(function () {});
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log('errs', JSON.stringify(errs.slice(0, 5)));
  console.log('ALL PASS iphone-audit ' + report.length);
})().catch(function (e) { console.log('ERR', e.message); process.exit(1); });
