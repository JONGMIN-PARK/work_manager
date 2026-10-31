// 마인드맵 목록 — 미리보기 · 맵 안 내용 검색 · 필터 · 정렬 · 목록 보기 · 최근 연 맵 · 휴대폰 👁 (v13.267)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var detail = 0;
  page.on('request', function (r) { if (/\/api\/mindmaps\/mm[^/?]+$/.test(r.url()) && r.method() === 'GET') detail++; });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var ready = function () { return page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 }); };
  var ids = [];
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { localStorage.removeItem('wm-mm-list'); localStorage.removeItem('wm-mm-recent'); } catch (e) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await ready();
    ids = await page.evaluate(async function () {
      var N = function (id, text, kids, x) { return Object.assign({ id: id, text: text, children: kids || [] }, x || {}); };
      var a = await apiFetch('/api/mindmaps', { method: 'POST', body: JSON.stringify({ title: 'E2E목록 미리보기 맵', scope: 'personal', doc: { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: N('n-root', '중심A', [
        N('a1', '설계', [N('a11', '기구'), N('a12', '전장'), N('a13', '소프트'), N('a14', '검토'), N('a15', '시험')]),
        N('a2', '구매', [N('a21', '발주')]),
        N('a3', '일정', [N('a31', '출하 준비', [], { note: '고객과 납기 회의 메모' })])
      ]) }] } }) });
      var b = await apiFetch('/api/mindmaps', { method: 'POST', body: JSON.stringify({ title: 'E2E목록 다른 맵', scope: 'personal', doc: { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: N('n-root', '중심B', [N('b1', '고객 요청 변경', [], { labels: ['긴급처리'] })]) }] } }) });
      return [a.data.id, b.data.id];
    });
    await page.evaluate(function () { setPage('mindmap'); });
    await page.waitForSelector('#mindmapWrap .mm-card[data-id="' + ids[0] + '"]');
    var A = '#mindmapWrap .mm-card[data-id="' + ids[0] + '"]', B = '#mindmapWrap .mm-card[data-id="' + ids[1] + '"]';

    // 미리보기 — 올리면 작은 맵, 떼면 사라짐, 다시 올리면 받아 둔 것으로
    await page.hover(A + ' .mm-card-title'); await wait(900);
    var pk = await page.evaluate(function () { var p = document.getElementById('mmPeek'); return p ? { root: (p.querySelector('.mm-pk-root') || {}).textContent, br: Array.from(p.querySelectorAll('.mm-pk-bt')).map(function (x) { return x.textContent; }), kids: Array.from(p.querySelectorAll('.mm-pk-k span')).map(function (x) { return x.textContent; }), more: (p.querySelector('.mm-pk-k em') || {}).textContent, info: (p.querySelector('.mm-pk-info') || {}).textContent, l: p.querySelectorAll('.mm-pk-col.l .mm-pk-b').length, r: p.querySelectorAll('.mm-pk-col.r .mm-pk-b').length, left: p.getBoundingClientRect().left } : null; });
    check(pk && pk.root === '중심A' && pk.br.slice().sort().join() === ['설계','구매','일정'].sort().join() && pk.kids.indexOf('기구') >= 0 && pk.more === '+1', '올리면 미리보기 — 중심 · 가지 · 하위 · +1 ' + JSON.stringify(pk));
    check(pk && pk.l === 1 && pk.r === 2 && /주제 11개/.test(pk.info), '양쪽으로 나눈 가지 · 주제 수 ' + JSON.stringify(pk && pk.info));
    await page.screenshot({ path: path.join(__dirname, '.shots', 'e2e34-pc-peek.png') });
    await page.mouse.move(5, 890); await wait(250);
    check(!(await page.$('#mmPeek')), '떼면 사라짐');
    var d1 = detail;
    await page.hover(A + ' .mm-card-title'); await wait(900);
    check(!!(await page.$('#mmPeek')) && detail === d1, '다시 올리면 받아 둔 것으로 (요청 ' + (detail - d1) + '번)');
    await page.mouse.move(5, 890); await wait(200);

    // 맵 안 내용 검색 — 메모 · 라벨까지, 맞은 주제 표시
    await page.type('#mmListQ', '납기'); await wait(900);
    var s1 = await page.evaluate(function (A, B) { return { a: !!document.querySelector(A), b: !!document.querySelector(B), hit: (document.querySelector(A + ' .mm-hit') || {}).textContent, mark: !!document.querySelector(A + ' .mm-hit mark'), cnt: document.getElementById('mmListCount').textContent }; }, A, B);
    check(s1.a && !s1.b && /출하 준비/.test(s1.hit) && /메모/.test(s1.hit) && s1.mark, '메모 안 「납기」로 맵 찾기 · 맞은 주제 ' + JSON.stringify(s1));
    check(/맵 안 주제 \d+곳/.test(s1.cnt), '개수 표시 ' + s1.cnt);
    await page.screenshot({ path: path.join(__dirname, '.shots', 'e2e34-pc-search.png') });
    await page.click(A + ' .mm-hit'); await wait(1200);
    check(await page.evaluate(function () { return _mm.view === 'editor' && _mm.sel === 'a31'; }), '맞은 주제를 누르면 그 맵의 그 주제로');
    await page.evaluate(function () { _mm.q = ''; _mmRenderList(); }); await page.waitForSelector(A);
    await page.evaluate(function () { var q = document.getElementById('mmListQ'); q.value = '긴급'; q.dispatchEvent(new Event('input')); }); await wait(900);
    check(await page.evaluate(function (A, B) { return !document.querySelector(A) && !!document.querySelector(B + ' .mm-hit'); }, A, B), '라벨 「긴급처리」도 찾음');
    await page.evaluate(function () { var q = document.getElementById('mmListQ'); q.value = ''; q.dispatchEvent(new Event('input')); }); await wait(300);

    // 최근 연 맵
    check(await page.evaluate(function (id) { return !!document.querySelector('#mindmapWrap .mm-recent .mm-rchip[data-id="' + id + '"]'); }, ids[0]), '최근 연 맵 칩');

    // 필터 · 정렬 · 목록 보기
    await page.evaluate(function () { var s = document.querySelector('#mmListFilt [data-f="age"]'); s.value = 'old'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(200);
    check(await page.evaluate(function (A) { return !document.querySelector(A) && !!document.querySelector('#mmListFilt [data-act="fclear"]'); }, A), '90일 넘게 그대로 — 새 맵은 빠짐 · 필터 풀기 버튼');
    await page.click('#mmFltBtn'); await page.click('#mmListFilt [data-act="fclear"]'); await wait(200);   // v13.295 필터는 펼침 창 안
    await page.evaluate(function () { var s = document.querySelector('#mmListFilt [data-f="owner"]'); s.value = currentUser.id; s.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(200);
    check(await page.evaluate(function (A) { return !!document.querySelector(A) && (document.querySelector('#mmFltBtn .wm-flt-n') || {}).textContent === '1'; }, A), '만든 사람 필터 · 배지 1');
    if (!(await page.evaluate(function () { return document.getElementById('mmFltWrap').classList.contains('open'); }))) await page.click('#mmFltBtn');
    await page.click('#mmListFilt [data-act="fclear"]'); await wait(150);
    await page.select('#mmListSort', 'title'); await wait(150);
    var titles = await page.evaluate(function () { return Array.from(document.querySelectorAll('#mmListBody .mm-card-title')).map(function (t) { return t.textContent; }); });
    var sorted = titles.slice().sort(function (a, b) { return a.localeCompare(b, 'ko'); });
    check(titles.join('|') === sorted.join('|'), '제목순 정렬');
    await page.click('#mindmapWrap [data-act="view"][data-v="table"]'); await wait(200);
    var tb = await page.evaluate(function (id) { var r = document.querySelector('#mmListBody tr.mm-row[data-id="' + id + '"]'); return r ? r.textContent : null; }, ids[0]);
    check(tb && /E2E목록 미리보기 맵/.test(tb) && /11/.test(tb), '목록(표) 보기 ' + (tb || '').slice(0, 50));
    await page.hover('#mmListBody tr.mm-row[data-id="' + ids[0] + '"] .c-title b'); await wait(700);
    check(!!(await page.$('#mmPeek')), '목록 보기에서도 미리보기');
    await page.mouse.move(5, 890); await wait(200);
    await page.evaluate(function () { document.querySelector('#mmListBody th[data-v="nodes"]').click(); }); await wait(150);
    check(await page.evaluate(function () { return _mmLV.sort === 'nodes' && document.getElementById('mmListSort').value === 'nodes'; }), '머리 눌러 정렬');
    await page.reload({ waitUntil: 'networkidle2' }); await ready();
    await page.evaluate(function () { setPage('mindmap'); }); await page.waitForSelector('#mmListBody tr.mm-row');
    check(await page.evaluate(function () { return _mmLV.view === 'table' && _mmLV.sort === 'nodes'; }), '보기 · 정렬 기억');

    // 열어 둔 맵 — 새로고침해도 그 맵으로 (v13.285) · 목록으로 돌아온 뒤엔 목록
    await page.evaluate(function (id) { mmOpen(id); }, ids[0]);
    await page.waitForFunction(function (id) { return _mm.view === 'editor' && _mm.mapId === id && _mm.row; }, { timeout: 8000 }, ids[0]);
    await page.reload({ waitUntil: 'networkidle2' }); await ready();
    var ro = await page.waitForFunction(function (id) { return curPage === 'mindmap' && _mm.view === 'editor' && _mm.mapId === id && !!_mm.row; }, { timeout: 10000 }, ids[0]).then(function () { return true; }).catch(function () { return false; });
    check(ro, '열어 둔 맵 — 새로고침하면 그 맵이 다시 열림');
    await page.evaluate(function () { mmBack(); }); await wait(500);
    await page.reload({ waitUntil: 'networkidle2' }); await ready(); await wait(1500);
    check(await page.evaluate(function () { return _mm.view !== 'editor' && !_mm.mapId; }), '목록으로 돌아온 뒤 새로고침 — 목록');

    // 휴대폰 — 👁 로 아래에서 미리보기
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await ready(); await page.evaluate(function () { setPage('mindmap'); _mmLV.view = 'card'; }); await page.waitForSelector(A); await page.evaluate(function () { _mmPaintList(); }); await wait(300);
    var mb = await page.evaluate(function (A) { var b = document.querySelector(A + ' .mm-peek-btn'); return { vis: b && getComputedStyle(b).display !== 'none', sw: document.documentElement.scrollWidth }; }, A);
    check(mb.vis && mb.sw <= 392, '휴대폰 — 👁 버튼 · 가로 넘침 없음 ' + JSON.stringify(mb));
    await wait(1500); await page.evaluate(function () { _mmPaintList(); }); await wait(200);   // 화면 바뀐 뒤 마지막 화면 복원이 목록을 다시 그릴 때까지
    await page.tap(A + ' .mm-peek-btn'); await wait(900);
    var sh = await page.evaluate(function () { var p = document.getElementById('mmPeek'); return p ? { sheet: p.classList.contains('sheet'), bk: !!document.getElementById('mmPeekBk'), open: !!p.querySelector('[data-pk="open"]'), w: p.offsetWidth, ed: _mm.view } : null; });
    check(sh && sh.sheet && sh.bk && sh.open && sh.w <= 390 && sh.ed === 'list', '👁 — 아래에서 미리보기 · 맵 열기 버튼 ' + JSON.stringify(sh));
    await page.screenshot({ path: path.join(__dirname, '.shots', 'e2e34-phone-peek.png') });
    await page.evaluate(function () { document.getElementById('mmPeekBk').click(); }); await wait(150);
    check(!(await page.$('#mmPeek')), '바깥 누르면 닫힘');
    check(errs.length === 0, '화면 오류 없음 ' + JSON.stringify(errs));
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    try { await page.evaluate(function (ids) { return Promise.all(ids.map(function (id) { return apiFetch('/api/mindmaps/' + id, { method: 'DELETE' }).catch(function () {}); })); }, ids); } catch (e) {}
    await browser.close();
  }
})();
