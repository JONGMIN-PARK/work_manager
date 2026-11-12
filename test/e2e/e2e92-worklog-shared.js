// 📒 공용 업무 데이터 (v13.481) — 관리자가 올린 업무일지를 모든 사용자가 같이 봄 · 넣기/고치기/지우기는 관리자 + 지정된 담당자만
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var ok = 0, fail = 0, errs = [];
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var ready = function (page) { return page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 }); };
  async function session(email) {
    var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now() + Math.random()) });
    var page = (await browser.pages())[0] || await browser.newPage();
    page.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', email); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await ready(page); await wait(800);
    return { browser: browser, page: page };
  }
  async function reload(s) { await s.page.reload({ waitUntil: 'networkidle2' }); await ready(s.page); await wait(1500); }
  // 화면 상태 — 업무 관리 › 주간 분석
  var view = function (page) {
    return page.evaluate(async function () {
      setPage('team'); setMode('weekly');
      await new Promise(function (r) { setTimeout(r, 600); });
      var vis = function (sel) { var e = document.querySelector(sel); return !!(e && e.offsetParent); };
      var shown = function (sel) { var e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };   // 다른 탭 안에 있어도 — 단추 자체가 숨겨졌는지
      var recs = (await apiFetch('/api/archives/records?all=true&limit=5000')).data || [];
      var info = (await apiFetch('/api/archives/records/info')).data;
      var pill = document.querySelector('#wlInfo .wl-pill');
      return { ro: document.body.classList.contains('wl-ro'), can: wmCanWorklog(), open: vis('#mainArea .wl-w[onclick*="fileInput2"]'), zone: vis('#uploadZone'), empty: vis('#wlEmpty'), main: vis('#mainArea'),
        edit: shown('#editTogBtn'), manual: shown('[onclick="openManualInput()"]'), aD: (typeof aD !== 'undefined' && aD.length) || 0, n: recs.length, mine: recs.filter(function (r) { return /^ZZ공용/.test(r.name); }).length,
        info: info, pill: pill ? pill.textContent : '', who: (document.getElementById('wlEmptyWho') || {}).textContent || '' };
    });
  };
  // 쓰기 API 를 직접 불러 봄 (화면 가드를 건너뛰고 서버 판단만)
  var rawWrites = function (page, id) {
    return page.evaluate(async function (id) {
      var out = {}, rec = { date: '20261110', name: 'ZZ침입', orderNo: 'ZZ-1', hours: 1, taskType: 't', abbr: 'D', content: 'x' };
      async function t(k, url, opt) { try { await apiFetch(url, opt); out[k] = 200; } catch (e) { out[k] = e.status; } }
      await t('sync', '/api/archives/records/sync', { method: 'POST', body: JSON.stringify({ insert: [rec], update: [], deleteIds: [] }) });
      await t('patch', '/api/archives/records/batch', { method: 'PATCH', body: JSON.stringify({ updates: [Object.assign({ id: id }, rec)] }) });
      await t('del', '/api/archives/records/batch', { method: 'DELETE', body: JSON.stringify({ ids: [id] }) });
      await t('one', '/api/archives/records', { method: 'POST', body: JSON.stringify(rec) });
      await t('self', '/api/settings/worklog_manager', { method: 'PUT', body: JSON.stringify({ value: { enabled: true } }) });
      return out;
    }, id);
  };
  var adm = null, kim = null;
  try {
    adm = await session('admin@t.com');
    // 깨끗이 → 팀원은 '아직 없음' 안내
    await adm.page.evaluate(async function () { await apiFetch('/api/archives/records', { method: 'DELETE' }); });
    kim = await session('kim@t.com');
    var k0 = await view(kim.page);
    check(k0.ro && !k0.can && k0.n === 0, '팀원 — 보기 전용 · 데이터 없음 ' + JSON.stringify([k0.ro, k0.can, k0.n]));
    check(!k0.zone && (k0.empty || k0.main) && /관리자/.test(k0.who), '팀원 — 올리는 칸은 안 보임 · 안내에 담당 표시 ' + JSON.stringify([k0.zone, k0.empty, k0.main, k0.who]));
    // 관리자가 올림
    var ids = await adm.page.evaluate(async function () {
      var recs = [1, 2, 3].map(function (i) { return { date: '2026111' + i, name: 'ZZ공용' + i, orderNo: 'ZZ-S' + i, hours: i, taskType: '개발', abbr: 'D', content: '공용 내용 ' + i }; });
      var r = await wrSync(recs, [], []);
      return r.inserted.map(function (x) { return x.id; });
    });
    check(ids.length === 3, '관리자 — 3건 올림');
    var a1 = await view(adm.page);
    check(!a1.ro && a1.can && a1.open && a1.info.canManage && /공용 데이터/.test(a1.pill), '관리자 — 파일 열기 보임 · 「공용 데이터」 알약 ' + JSON.stringify([a1.ro, a1.open, a1.pill]));
    // 팀원 — 새로 고치면 같이 보임
    await reload(kim);
    var k1 = await view(kim.page);
    check(k1.n === 3 && k1.mine === 3 && k1.aD === 3 && k1.main, '팀원 — 관리자가 올린 3건이 그대로 보임(화면에도) ' + JSON.stringify([k1.n, k1.aD, k1.main]));
    check(!k1.open && !k1.edit && !k1.manual && !k1.zone && /보기 전용/.test(k1.pill), '팀원 — 파일 열기 · 편집 · 수동입력 숨김 · 「보기 전용」 ' + JSON.stringify([k1.open, k1.edit, k1.manual, k1.pill]));
    check(k1.info.count === 3 && !k1.info.canManage && !!k1.info.lastAt && k1.info.managers.length >= 1, '현황 — 건수 · 마지막 올린 때 · 담당자 ' + JSON.stringify([k1.info.count, k1.info.lastBy, k1.info.managers.map(function (m) { return m.name; })]));
    var w1 = await rawWrites(kim.page, ids[0]);
    check(w1.sync === 403 && w1.patch === 403 && w1.del === 403 && w1.one === 403 && w1.self === 403, '팀원 — 서버가 쓰기 전부 거절 · 권한 스스로 못 켬 ' + JSON.stringify(w1));
    // 화면 가드 — 파일을 끌어 놓아도 · 함수로 불러도 안 됨
    var g = await kim.page.evaluate(async function () {
      var o = {}; try { await wrBulkPut([{ date: '20261101', name: 'x' }]); o.bulk = 'ok'; } catch (e) { o.bulk = e.status; }
      try { await wrClear(); o.clear = 'ok'; } catch (e) { o.clear = e.status; }
      await hFiles([new File(['a'], 'a.xls')]); o.toast = wlDenyToast(); o.n = (await apiFetch('/api/archives/records/count')).data.count; return o;
    });
    check(g.bulk === 403 && g.clear === 403 && g.toast === true && g.n === 3, '팀원 — 화면에서도 막음(전체 저장 · 초기화 · 파일) · 데이터 그대로 ' + JSON.stringify(g));
    // 관리자가 팀원을 담당으로 지정
    await adm.page.evaluate(function () { setPage('useradmin'); });
    await adm.page.waitForFunction(function () { return document.querySelectorAll('#mUserAdmin .ua-wlm').length > 0; }, { timeout: 15000 });
    var ua = await adm.page.evaluate(function () {
      var ths = [].map.call(document.querySelectorAll('#mUserAdmin table th'), function (t) { return t.textContent.trim(); });
      var row = [].filter.call(document.querySelectorAll('#mUserAdmin table tr'), function (r) { return /kim@t\.com/.test(r.textContent); })[0];
      var cb = row && row.querySelector('.ua-wlm'); if (cb) cb.click();
      return { th: ths.indexOf('업무 데이터') >= 0, cb: !!cb, tds: row ? row.children.length : 0, ths: ths.length };
    });
    await wait(900);
    check(ua.th && ua.cb && ua.tds === ua.ths, '사용자 관리 — 「업무 데이터」 칸에서 지정 ' + JSON.stringify(ua));
    await reload(kim);
    var k2 = await view(kim.page);
    check(!k2.ro && k2.can && k2.open && k2.edit && k2.manual && k2.info.canManage && /공용 데이터/.test(k2.pill), '지정된 팀원 — 파일 열기 · 편집 · 수동입력 보임 ' + JSON.stringify([k2.ro, k2.open, k2.edit, k2.manual]));
    check(k2.info.managers.length === k1.info.managers.length + 1, '담당자 목록에 추가됨 ' + JSON.stringify(k2.info.managers.map(function (m) { return m.name; })));
    var k3 = await kim.page.evaluate(async function (id) {
      var r = await wrSync([{ date: '20261114', name: 'ZZ공용4', orderNo: 'ZZ-S4', hours: 4, taskType: '개발', abbr: 'D', content: '팀원이 넣음' }], [], [id]);
      return { ins: r.inserted.length, del: r.deleted };
    }, ids[0]);
    check(k3.ins === 1 && k3.del === 1, '지정된 팀원 — 넣기 1 · 관리자가 올린 것 지우기 1 ' + JSON.stringify(k3));
    var a2 = await adm.page.evaluate(async function () { var d = (await apiFetch('/api/archives/records?all=true&limit=5000')).data; return d.map(function (r) { return r.name; }).filter(function (n) { return /^ZZ공용/.test(n); }).sort(); });
    check(a2.join() === 'ZZ공용2,ZZ공용3,ZZ공용4', '관리자 — 팀원이 바꾼 결과가 그대로 보임 ' + a2.join());
    // 중복 제거 — 겹친 것만 지움
    var dd = await adm.page.evaluate(async function () {
      window.__wmDialogUi = true;
      await wrSync([{ date: '20261112', name: 'ZZ공용2', orderNo: 'ZZ-S2', hours: 2, taskType: '개발', abbr: 'D', content: '공용 내용 2' }], [], []);
      aD = await wrGetAll(); var before = aD.length;
      var p = deduplicateRecords();
      for (var i = 0; i < 40 && !document.querySelector('.wmd-ov'); i++) await new Promise(function (r) { setTimeout(r, 50); });
      var okB = document.querySelector('.wmd-ov .wmd-ok') || [].filter.call(document.querySelectorAll('.wmd-ov button'), function (b) { return /확인|계속|예/.test(b.textContent); })[0];
      if (okB) okB.click(); await p;
      return { before: before, after: (await apiFetch('/api/archives/records/count')).data.count };
    });
    check(dd.before === 4 && dd.after === 3, '중복 제거 — 겹친 1건만 지움 ' + JSON.stringify(dd));
    // 지정 해제 → 다시 보기 전용
    await adm.page.evaluate(function () { var row = [].filter.call(document.querySelectorAll('#mUserAdmin table tr'), function (r) { return /kim@t\.com/.test(r.textContent); })[0]; row.querySelector('.ua-wlm').click(); });
    await wait(900); await reload(kim);
    var k4 = await view(kim.page);
    var w4 = await rawWrites(kim.page, ids[1]);
    check(k4.ro && !k4.open && k4.n === 3 && w4.sync === 403 && w4.del === 403, '지정 해제 — 다시 보기 전용 · 데이터는 계속 보임 ' + JSON.stringify([k4.ro, k4.open, k4.n, w4]));
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  finally { if (kim) await kim.browser.close(); if (adm) await adm.browser.close(); }
  console.log(fail ? 'FAILED ' + fail + ' / ' + (ok + fail) : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
