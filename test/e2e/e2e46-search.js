// 통합 검색 (v13.291) — 서버 전체 범위 · 권한 · 범주 칩 · 고르면 그 자리로 가서 형광 표시
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var SHOTS = path.join(__dirname, '.shots');
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function ready() {
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
  }
  async function login(email) {
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { localStorage.removeItem('wm-last-view'); localStorage.removeItem('pd-last-tab'); } catch (e) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', email); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await ready();
  }
  var api = function (url, method, body) { return page.evaluate(function (u, m, b) { return apiFetch(u, m ? { method: m, body: JSON.stringify(b) } : undefined).then(function (r) { return r && r.data; }).catch(function (e) { return { _err: e.message }; }); }, url, method || null, body || null); };
  async function search(kw) {
    await page.evaluate(function () { var i = document.getElementById('globalSearchInput'); i.value = ''; i.blur(); var d = document.getElementById('globalSearchDropdown'); d.innerHTML = ''; d.style.display = 'none'; });   // 앞 결과를 지워야 새 결과를 기다림
    await page.click('#globalSearchInput');
    await page.type('#globalSearchInput', kw);
    await page.waitForFunction(function () { var d = document.getElementById('globalSearchDropdown'); return d && /gs-chip|검색 결과 없음/.test(d.innerHTML); }, { timeout: 8000 });
    return page.evaluate(function () { var o = {}; document.querySelectorAll('#globalSearchDropdown .gs-chip').forEach(function (c) { var m = /gsOnly\('(\w+)'\)/.exec(c.getAttribute('onclick')); if (m) o[m[1]] = +c.querySelector('b').textContent; }); return o; });
  }
  async function pick(cat) {
    await page.click('#globalSearchDropdown .gs-item[data-k="' + cat + '"]');
  }
  var K = 'zq' + Date.now().toString(36);   // 다른 데이터와 안 겹치는 낱말
  var made = {};
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await login('admin@t.com');
    var users = await api('/api/users');
    var kim = (users || []).filter(function (u) { return u.email === 'kim@t.com'; })[0];
    // 범주마다 하나씩 — 관리자 비공개 프로젝트 안에
    var proj = await api('/api/projects', 'POST', { name: K + ' 검색 프로젝트', orderNo: 'S-' + K, memo: '메모 ' + K, visibility: 'private' });
    made.proj = proj.id;
    await api('/api/issues', 'POST', { projectId: proj.id, title: '이슈 제목', description: '원인은 ' + K + ' 과열', status: 'open' });
    await api('/api/orders', 'POST', { orderNo: 'O-' + K, name: K + ' 수주', client: '검색상사', date: '2026-10-31' });
    await api('/api/archives/records', 'POST', { date: '2026-10-30', name: '관리자', content: '측정 ' + K + ' 완료', hours: 2 });
    var mtg = await api('/api/meetings', 'POST', { projectId: proj.id, title: '설계 회의', meetDate: '2026-10-31', minutes: '회의록에 ' + K + ' 대책' });
    made.mtg = mtg && mtg.id;
    await api('/api/my-work/todos', 'POST', { title: K + ' 할 일' });
    var mm = await api('/api/mindmaps', 'POST', { title: K + ' 맵', scope: 'personal' });
    made.mm = mm && mm.id;
    await api('/api/prestudies', 'POST', { title: K + ' 사전검토', client: '검색상사' });
    await api('/api/tech', 'POST', { name: K + ' 기술', code: 'T-' + K.slice(-5) });
    if (kim) await api('/api/messages', 'POST', { toUserId: kim.id, body: '확인 부탁 ' + K });

    // 1. 전체 범위 — 범주 칩
    var chips = await search(K);
    var want = ['project', 'issue', 'order', 'work', 'meeting', 'todo', 'mindmap', 'prestudy', 'tech', 'message'];
    var miss = want.filter(function (k) { return !chips[k]; });
    check(miss.length === 0, '관리자 — 범주 ' + Object.keys(chips).length + '개 ' + JSON.stringify(chips) + (miss.length ? ' 빠짐 ' + miss : ''));
    var snip = await page.evaluate(function () { var e = document.querySelector('#globalSearchDropdown .gs-item[data-k="meeting"] .gs-snip'); return e && e.innerHTML; });
    check(/\[회의록\].*<mark>/.test(snip || ''), '회의 — 문맥 줄 · 형광 ' + snip);
    await page.screenshot({ path: path.join(SHOTS, 'search-dropdown.png'), clip: { x: 300, y: 0, width: 900, height: 620 } });
    // 범주 칩 → 그 범주만
    await page.click('#globalSearchDropdown .gs-chip[onclick*="\'issue\'"]'); await wait(700);
    var only = await page.evaluate(function () { return Array.from(document.querySelectorAll('#globalSearchDropdown .gs-item')).map(function (e) { return e.dataset.k; }); });
    check(only.length >= 1 && only.every(function (k) { return k === 'issue'; }), '칩 — 이슈만 ' + only.join(','));

    // 2. 고르면 그 자리 + 형광
    await search(K); await pick('project'); await wait(1800);
    check(await page.evaluate(function (pid) { return window._pdProj && window._pdProj.id === pid && !!document.querySelector('#projDetailPanel mark.wm-hit'); }, made.proj), '프로젝트 → 상세 패널 · 형광');
    await page.evaluate(function () { pdCloseDetail(); });
    await search(K); await pick('meeting'); await wait(2500);
    var mt = await page.evaluate(function (mid) { var c = document.getElementById('pmt-card-' + mid); return { tab: document.getElementById('pdTabMeeting').classList.contains('on'), card: !!c, hit: !!(c && (c.querySelector('mark.wm-hit') || c.querySelector('.wm-hit-box'))) }; }, made.mtg);
    check(mt.tab && mt.card && mt.hit, '회의 → 회의 탭 · 그 회의 펼침 · 강조 ' + JSON.stringify(mt));
    await page.screenshot({ path: path.join(SHOTS, 'search-hit-meeting.png'), clip: { x: 924, y: 0, width: 476, height: 900 } });
    await page.evaluate(function () { pdCloseDetail(); });
    await search(K); await pick('issue'); await wait(1500);
    check(await page.evaluate(function () { var m = document.getElementById('issueDetailPanel'); return !!(m && m.querySelector('mark.wm-hit')); }), '이슈 → 상세 창 · 형광');
    await page.evaluate(function () { var p = document.getElementById('issueDetailPanel'); if (p) p.remove(); });
    await search(K); await pick('order'); await wait(1500);
    check(await page.evaluate(function () { return curMode === 'orders' && !!document.querySelector('#mOrders tr mark.wm-hit'); }), '수주 → 수주대장 그 줄 · 형광');
    await search(K); await pick('mindmap'); await wait(1500);
    check(await page.evaluate(function (id) { return curPage === 'mindmap' && _mm.mapId === id; }, made.mm), '마인드맵 → 그 맵 열림');
    // 형광은 다른 곳을 누르면 지움
    await page.evaluate(function () { setPage('project'); setMode('orders'); });
    await search(K); await pick('order'); await wait(1500);
    await page.mouse.click(700, 850); await wait(200);
    check(await page.evaluate(function () { return !document.querySelector('mark.wm-hit'); }), '다른 곳 누르면 형광 지움');
    // 최근 검색어
    await page.evaluate(function () { document.getElementById('globalSearchInput').value = ''; });
    await page.click('#globalSearchInput'); await wait(300);
    check(await page.evaluate(function (k) { return document.getElementById('globalSearchDropdown').innerHTML.indexOf('data-q="' + k + '"') >= 0; }, K), '빈 칸 — 최근 검색어');
    await page.keyboard.press('Escape');

    // 3. 권한 — 팀원은 관리자 비공개 프로젝트 · 내 것(할 일 · 맵 · 업무일지)은 못 봄, 받은 메시지 · 테넌트 공용은 봄
    await page.evaluate(function () { if (typeof authLogout === 'function') return authLogout(); });
    await wait(800);
    await login('kim@t.com');
    var c2 = await search(K);
    var hidden = ['project', 'issue', 'meeting', 'todo', 'mindmap', 'work'].filter(function (k) { return c2[k]; });
    check(hidden.length === 0, '팀원 — 남의 비공개 · 개인 것 안 보임 ' + JSON.stringify(c2));
    check(c2.message === 1 && c2.prestudy >= 1 && c2.order >= 1, '팀원 — 받은 메시지 · 사전검토 · 수주는 보임');
    await page.keyboard.press('Escape');
    await page.evaluate(function () { if (typeof authLogout === 'function') return authLogout(); });
    await wait(800);
    await login('admin@t.com');

    // 4. 휴대폰 — 결과 창 화면 안
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true }); await wait(300); await ready();
    await page.click('#globalSearchInput'); await page.type('#globalSearchInput', K);
    await page.waitForFunction(function () { return /gs-chip/.test(document.getElementById('globalSearchDropdown').innerHTML); }, { timeout: 8000 });
    var r = await page.evaluate(function () { var b = document.getElementById('globalSearchDropdown').getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), b: Math.round(b.bottom) }; });
    check(r.l >= 0 && r.r <= 402 && r.b <= 874, '휴대폰 — 결과 창 화면 안 ' + JSON.stringify(r));
    await page.screenshot({ path: path.join(SHOTS, 'search-phone.png') });

    // 정리
    await page.setViewport({ width: 1400, height: 900 }); await wait(300); await ready();
    if (made.mm) await api('/api/mindmaps/' + made.mm, 'DELETE');
    await api('/api/projects/' + made.proj, 'DELETE');
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    await browser.close();
  }
})();
