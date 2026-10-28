// 마인드맵 브라우저 E2E (서버 :3000) — 실행: node e2e.js
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var ok = 0, errs = [];
function check(name, cond, extra) { if (!cond) throw new Error('FAIL: ' + name + ' ' + JSON.stringify(extra === undefined ? '' : extra)); ok++; console.log('✔', name); }
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function loginPage(browser, email) {
  var ctx = await browser.createBrowserContext();
  var page = await ctx.newPage();
  await page.setViewport({ width: 1500, height: 900 });
  page.on('dialog', function (d) { d.accept(); });
  page.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
  page.on('console', function (m) { if (m.type() === 'error' && !/Failed to load resource|favicon|fonts/.test(m.text())) errs.push(email + ' console: ' + m.text()); });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#loginEmail', { visible: true });
  await page.type('#loginEmail', email);
  await page.type('#loginPw', 'Test1234!');
  await page.keyboard.press('Enter');
  await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
  await wait(800);
  return page;
}
function nodes(page) {
  return page.$$eval('#mmStage .mm-node', function (els) { return els.filter(function (e) { return e.style.display !== 'none'; }).map(function (e) { return e.querySelector('.mm-txt').textContent; }); });
}
function selText(page) { return page.$eval('#mmStage .mm-node.mm-sel .mm-txt', function (e) { return e.textContent; }).catch(function () { return null; }); }
async function waitSaved(page) {
  await page.waitForFunction(function () { return !_mm.dirty && !_mm.saving; }, { timeout: 10000 });
}

(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  try {
    // ── 모든 사용자: 탭 보임 (v13.249) ──
    var api = await loginPage(browser, 'admin@t.com');
    var lee = await loginPage(browser, 'lee@t.com');
    check('팀원도 마인드맵 탭 보임', await lee.$eval('#tabMindmap', function (e) { return getComputedStyle(e).display !== 'none'; }));

    // ── 관리자: 탭 → 목록 → 새 맵(WBS 템플릿) ──
    var page = api;
    check('관리자: 마인드맵 탭 보임', await page.$eval('#tabMindmap', function (e) { return getComputedStyle(e).display !== 'none'; }));
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    check('사용 권한 버튼 없음 · 탭은 전체 · 내 맵 · 받은 맵', !(await page.$('#mindmapWrap [data-act="access"]')) &&
      (await page.$$eval('#mindmapWrap [data-act="tab"]', function (b) { return b.map(function (x) { return x.textContent; }).join(','); })) === '전체,내 맵,받은 맵');
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmNewTitle');
    await page.type('#mmNewTitle', 'E2E 장비 WBS');
    await page.select('#mmNewTpl', 'wbs');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(300);
    var ns = await nodes(page);
    check('WBS 템플릿 노드 생성', ns.length === 20 && ns[0] === 'E2E 장비 WBS', ns.length);
    check('논리도 구조 적용', await page.$eval('#mmStructure', function (e) { return e.value; }) === 'right');
    await page.screenshot({ path: path.join(SHOT, '1-wbs.png') });

    // 겹침 없음 (보이는 노드끼리 사각형 교차 없음)
    var overlap = await page.evaluate(function () {
      var p = _mm.layout.pos, ids = Object.keys(p), n = 0;
      for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
        var a = p[ids[i]], b = p[ids[j]];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) n++;
      }
      return n;
    });
    check('노드 겹침 없음', overlap === 0, overlap);

    // ── 키보드: Tab(하위) → 타이핑 → Enter ──
    await page.click('#mmStage .mm-root');
    await page.keyboard.press('Tab');
    await page.waitForSelector('#mmCanvas textarea.mm-inline');
    await page.keyboard.type('리스크 검토');
    await page.keyboard.press('Enter');
    await wait(200);
    check('Tab → 하위 주제 추가·편집', (await nodes(page)).indexOf('리스크 검토') >= 0);
    check('새 주제가 선택됨', await selText(page) === '리스크 검토');
    await page.keyboard.press('Enter');   // 형제
    await page.waitForSelector('#mmCanvas textarea.mm-inline');
    await page.keyboard.type('예산');
    await page.keyboard.press('Tab');     // 확정 + 하위
    await page.waitForSelector('#mmCanvas textarea.mm-inline');
    await page.keyboard.type('구매비');
    await page.keyboard.press('Enter');
    await wait(200);
    var ns2 = await nodes(page);
    check('Enter 형제 · 편집 중 Tab 하위', ns2.indexOf('예산') >= 0 && ns2.indexOf('구매비') >= 0);
    // 바로 타이핑하면 내용 바꿔 쓰기
    await page.keyboard.type('X');
    await page.waitForSelector('#mmCanvas textarea.mm-inline');
    await page.keyboard.type('재료비');
    await page.keyboard.press('Enter');
    await wait(200);
    check('선택 후 바로 타이핑 → 바꿔 쓰기', (await nodes(page)).indexOf('X재료비') >= 0);
    // 한글 IME 조합으로 편집 시작 (CDP)
    var cdp = await page.target().createCDPSession();
    await page.keyboard.press('ArrowLeft');   // 부모(예산)로
    check('방향키 ← 부모로 이동', await selText(page) === '예산', await selText(page));
    await cdp.send('Input.imeSetComposition', { text: 'ㅇ', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: '예', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.insertText', { text: '예산안' });
    await wait(100);
    var inl = await page.$eval('#mmCanvas textarea.mm-inline', function (e) { return e.value; }).catch(function () { return null; });
    check('한글 조합으로 편집 시작 · 글자 유지', inl === '예산안', inl);
    await page.keyboard.press('Enter');
    await wait(200);
    check('한글 편집 확정', (await nodes(page)).indexOf('예산안') >= 0);
    check('키 입력칸은 다시 숨김', await page.$eval('#mmSink', function (e) { return !e.classList.contains('mm-inline') && e.value === ''; }));

    // ── 삭제 · 되돌리기 ──
    await page.keyboard.press('ArrowRight');  // 하위(X재료비)
    var before = (await nodes(page)).length;
    await page.keyboard.press('Delete');
    await wait(150);
    check('Delete 삭제', (await nodes(page)).length === before - 1);
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    await wait(150);
    check('Ctrl+Z 되돌리기', (await nodes(page)).length === before);
    // ── 접기 ──
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press(' ');
    await wait(150);
    check('Space 접기', (await nodes(page)).indexOf('X재료비') < 0);
    check('접힌 노드에 하위 개수 표시', await page.$eval('#mmStage .mm-node.mm-sel .mm-fold', function (e) { return e.textContent; }) === '1');
    await page.keyboard.press(' ');
    // ── 우선순위 Alt+1 · 속성 패널 ──
    await page.keyboard.down('Alt'); await page.keyboard.press('1'); await page.keyboard.up('Alt');
    await wait(150);
    check('Alt+1 우선순위 마커', !!(await page.$('#mmStage .mm-node.mm-sel .mm-pri1')));
    // 마커 칸은 처음에 접혀 있음 — 제목을 눌러 펴고, 접기 상태 기억 확인
    check('마커 칸 기본 접힘', !!(await page.$('#mmPanel .mm-pn-folded [data-act="symbol"]')));
    await page.evaluate(function () {
      var h = Array.prototype.filter.call(document.querySelectorAll('#mmPanel .mm-pn-foldable > .mm-pn-h'), function (x) { return /^마커/.test(x.textContent); })[0];
      h.click();
    });
    await wait(100);
    check('제목 눌러 펴기 · 기억', !(await page.$('#mmPanel .mm-pn-folded [data-act="symbol"]')) && (await page.evaluate(function () { return localStorage.getItem('mm-pn-fold'); })).indexOf('마커') < 0);
    await page.click('#mmPanel [data-act="symbol"][data-v="flag"]');
    await page.$eval('#mmPnDue', function (e) { e.value = '2020-01-01'; e.dispatchEvent(new Event('change')); });
    await page.$eval('#mmPnProg', function (e) { e.value = '0'; e.dispatchEvent(new Event('change')); });
    await page.$eval('#mmPnLabels', function (e) { e.value = '검토필요, 긴급'; e.dispatchEvent(new Event('change')); });
    await wait(150);
    var nodeHtml = await page.$eval('#mmStage .mm-node.mm-sel', function (e) { return e.innerHTML; });
    check('마커·라벨·지연 마감·진척 0 표시', /🚩/.test(nodeHtml) && /검토필요/.test(nodeHtml) && /mm-late/.test(nodeHtml) && /<b>0%<\/b>/.test(nodeHtml));
    await page.click('#mmPanel [data-act="color"][data-v="rose"]');
    await wait(100);

    // ── 끌어 놓기: '예산안'을 '설계' 아래로 ──
    var target = await page.evaluate(function () {
      var id = null; mmWalk(_mmRoot(), function (n) { if (n.text === '설계') id = n.id; });
      return id;
    });
    var src = await page.$('#mmStage .mm-node.mm-sel');
    var dst = await page.$('#mmStage .mm-node[data-id="' + target + '"]');
    var sb = await src.boundingBox(), db = await dst.boundingBox();
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + 40, sb.y + 30, { steps: 5 });
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 8 });
    await page.mouse.up();
    await wait(200);
    var parentOf = await page.evaluate(function () {
      var f = null; mmWalk(_mmRoot(), function (n) { if (n.text === '예산안') f = mmFind(_mmRoot(), n.id); });
      return f && f.parent.text;
    });
    check('끌어 놓기 → 다른 주제의 하위로 이동', parentOf === '설계', parentOf);

    // ── 구조 바꾸기 · 겹침 ──
    for (var st of ['balanced', 'down']) {
      await page.select('#mmStructure', st);
      await wait(250);
      var ov = await page.evaluate(function () {
        var p = _mm.layout.pos, ids = Object.keys(p), n = 0;
        for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
          var a = p[ids[i]], b = p[ids[j]];
          if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) n++;
        }
        return n;
      });
      check('구조 ' + st + ' 겹침 없음', ov === 0, ov);
      await page.screenshot({ path: path.join(SHOT, '2-' + st + '.png') });
    }
    await page.select('#mmStructure', 'balanced');
    await wait(200);

    // ── 저장 → 새로고침 후 유지 ──
    await waitSaved(page);
    check('자동 저장 상태 ✓', /저장됨/.test(await page.$eval('#mmStatus', function (e) { return e.textContent; })));
    var mapId = await page.evaluate(function () { return _mm.mapId; });
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap .mm-card');
    await page.click('#mindmapWrap .mm-card[data-id="' + mapId + '"]');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(300);
    var ns3 = await nodes(page);
    check('새로고침 후 내용 유지', ns3.indexOf('예산안') >= 0 && ns3.indexOf('리스크 검토') >= 0);
    var saved = await page.evaluate(function () { var x = null; mmWalk(_mmRoot(), function (n) { if (n.text === '예산안') x = n; }); return x; });
    check('속성 유지 (progress 0 · 색 · 라벨 · 마커)', saved.progress === 0 && saved.color === 'rose' && saved.labels.length === 2 && saved.markers.indexOf('priority-1') >= 0, saved);
    check('구조 유지 (balanced)', await page.$eval('#mmStructure', function (e) { return e.value; }) === 'balanced');
    await page.screenshot({ path: path.join(SHOT, '3-reload.png') });

    // ── 아웃라인 ──
    await page.click('[data-act="view-outline"]');
    await page.waitForSelector('#mmOutline .mm-ol-in');
    var olCount = await page.$$eval('#mmOutline .mm-ol-in', function (e) { return e.length; });
    check('아웃라인 줄 수 = 노드 수', olCount === (await page.evaluate(function () { return mmCount(_mmRoot()); })), olCount);
    var riskId = await page.evaluate(function () { var id; mmWalk(_mmRoot(), function (n) { if (n.text === '리스크 검토') id = n.id; }); return id; });
    await page.click('#mmOutline .mm-ol-in[data-id="' + riskId + '"]');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('일정 리스크');
    await page.keyboard.press('Tab');
    await wait(150);
    var par = await page.evaluate(function () { var f; mmWalk(_mmRoot(), function (n) { if (n.text === '일정 리스크') f = mmFind(_mmRoot(), n.id); }); return f && f.parent.text; });
    check('아웃라인 Enter 새 줄 · Tab 들여쓰기', par === '리스크 검토', par);
    await page.screenshot({ path: path.join(SHOT, '4-outline.png') });
    await page.click('[data-act="view-map"]');
    await wait(200);
    check('맵 보기 복귀 후 반영', (await nodes(page)).indexOf('일정 리스크') >= 0);

    // ── 집중 모드 ──
    await page.focus('#mmSink');
    await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('f'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    await wait(200);
    check('집중 모드 켜짐 (툴바 숨김)', await page.$eval('#mmEd', function (e) { return e.classList.contains('mm-zen') && getComputedStyle(e.querySelector('.mm-top')).display === 'none'; }));
    await page.screenshot({ path: path.join(SHOT, '5-zen.png') });
    await page.keyboard.press('Escape');
    await wait(150);
    check('Esc 집중 모드 끝', await page.$eval('#mmEd', function (e) { return !e.classList.contains('mm-zen'); }));

    // ── 검색 ──
    await page.focus('#mmSearch');
    await page.keyboard.type('리스크');
    await page.keyboard.press('Enter');
    await wait(150);
    check('검색 → 일치 주제 선택', /리스크/.test(await selText(page)), await selText(page));

    // ── Markdown 내보내기 내용 ──
    var md = await page.evaluate(function () { return mmToMarkdown(_mmRoot()); });
    check('Markdown 내보내기', /^# E2E 장비 WBS/.test(md) && /- 리스크 검토/.test(md));

    // ── 공유 → 김팀원 편집자, 잠금 ──
    var kimId = await page.evaluate(function () { return apiFetch('/api/mindmaps/members').then(function (r) { return r.data.filter(function (u) { return u.name === '김팀원'; })[0].id; }); });
    await page.click('[data-act="share"]');
    await page.waitForSelector('#mmShareModal .mm-sh-role');
    await page.select('#mmShareModal .mm-sh-role[data-uid="' + kimId + '"]', 'edit');
    await page.click('#mmShOk');
    await page.waitForFunction(function () { return !document.getElementById('mmShareModal'); });
    check('공유 설정 저장', await page.evaluate(function () { return _mm.row.editors.length === 1; }));
    await waitSaved(page);
    var kim = await loginPage(browser, 'kim@t.com');
    await kim.click('#tabMindmap');
    await kim.waitForSelector('#mindmapWrap .mm-card[data-id="' + mapId + '"]');
    await kim.click('[data-act="tab"][data-tab="shared"]');
    check('받은 맵 탭에 표시', !!(await kim.$('#mindmapWrap .mm-card[data-id="' + mapId + '"]')));
    await kim.click('#mindmapWrap .mm-card[data-id="' + mapId + '"]');
    await kim.waitForSelector('#mmStage .mm-root');
    await kim.waitForFunction(function () { return _mm.lockedBy; }, { timeout: 8000 });
    var banner = await kim.$eval('#mmBanner', function (e) { return e.textContent; });
    check('다른 사람이 편집 중 → 보기 전용 배너', /관리자/.test(banner) && /편집 중/.test(banner), banner);
    check('보기 전용: 편집 도구 숨김', await kim.$eval('.mm-tools [data-act="child"]', function (e) { return getComputedStyle(e).display === 'none'; }));
    await kim.click('#mmStage .mm-root');
    await kim.keyboard.press('Tab');
    await wait(150);
    check('보기 전용: Tab 으로 추가 안 됨', !(await kim.$('#mmCanvas textarea.mm-inline')));
    await kim.screenshot({ path: path.join(SHOT, '6-locked.png') });
    // 관리자가 목록으로 나가면 잠금 해제 → 김이 편집 가져오기
    await page.click('[data-act="back"]');
    await wait(800);
    await kim.click('[data-act="take-lock"]');
    await kim.waitForFunction(function () { return !_mm.readOnly && !_mm.lockedBy && document.getElementById('mmStage') && document.querySelector('#mmStage .mm-root'); }, { timeout: 8000 });
    check('편집 가져오기 → 편집 가능', true);
    await kim.click('#mmStage .mm-root');
    await kim.keyboard.press('Tab');
    await kim.waitForSelector('#mmCanvas textarea.mm-inline');
    await kim.keyboard.type('김 추가');
    await kim.keyboard.press('Enter');
    await waitSaved(kim);
    check('공유 편집자 저장', true);
    // 관리자가 편집을 가져가면 김의 잠금 연장이 되찾지 않고 보기 전용으로 전환
    await page.evaluate(function (id) { return apiFetch('/api/locks', { method: 'PATCH', body: JSON.stringify({ resourceType: 'mindmap', resourceId: id }) }); }, mapId);
    await kim.evaluate(function () { return _mmLockBeat(_mm.mapId); });
    await wait(200);
    check('잠금을 빼앗기면 보기 전용 전환 (되찾지 않음)', await kim.evaluate(function () { return _mm.readOnly && /관리자/.test(_mm.lockedBy); }));
    var lockNow = await page.evaluate(function (id) { return apiFetch('/api/locks?resourceType=mindmap&resourceId=' + id).then(function (r) { return r.data.user_id === currentUser.id; }); }, mapId);
    check('잠금은 관리자에게 유지', lockNow);
    await page.evaluate(function (id) { return apiFetch('/api/locks?resourceType=mindmap&resourceId=' + id, { method: 'DELETE' }); }, mapId);

    // ── 버전 충돌: 관리자가 옛 버전으로 저장 시도 ──
    await page.click('#mindmapWrap .mm-card[data-id="' + mapId + '"]');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(500);
    await page.evaluate(function () { _mm.version = 1; _mm.readOnly = false; _mm.lockedBy = null; _mmRoot().text = '충돌 테스트'; _mmMarkDirty(); return _mmSaveNow(); });
    await wait(300);
    var cb = await page.$eval('#mmBanner', function (e) { return e.textContent; });
    check('버전 충돌 배너', /먼저 저장/.test(cb), cb);
    await page.click('[data-act="conflict-reload"]');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(400);
    check('최신본 불러오기 → 김의 변경 보임', (await nodes(page)).indexOf('김 추가') >= 0);

    // ── 가져오기 (Markdown) ──
    await page.click('[data-act="back"]');
    await page.waitForSelector('#mindmapWrap [data-act="import"]');
    await page.click('#mindmapWrap [data-act="import"]');
    await page.waitForSelector('#mmImpText');
    await page.type('#mmImpText', '# 가져온 회의\n## 안건\n- 일정\n  - 납기\n## 결정\n- 외주');
    await page.click('#mmImpOk');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(300);
    var ni = await nodes(page);
    check('Markdown 가져오기 → 맵', ni[0] === '가져온 회의' && ni.indexOf('납기') >= 0 && ni.length === 6, ni);

    // ── 목록 카드에서 📨 보내기 ──
    await page.click('[data-act="back"]');
    await page.waitForSelector('#mindmapWrap .mm-card[data-id="' + mapId + '"] [data-act="send"]');
    await page.click('#mindmapWrap .mm-card[data-id="' + mapId + '"] [data-act="send"]');
    await page.waitForSelector('#mmShareModal .mm-sh-role');
    var rows = await page.$$eval('#mmShareModal .mm-acc-row', function (r) { return r.map(function (x) { return [x.textContent, x.querySelector('select').value]; }); });
    check('보내기 창: 김 = 같이 편집 · 이 = 보내지 않음 (모든 사용자 고를 수 있음)', rows.some(function (r) { return /김팀원/.test(r[0]) && r[1] === 'edit'; }) && rows.some(function (r) { return /이팀원/.test(r[0]) && r[1] === ''; }), rows);
    await page.screenshot({ path: path.join(SHOT, '7-send.png') });

    // 테마 확인 (글래스 · 라이트)
    await page.keyboard.press('Escape');
    await page.click('#mindmapWrap .mm-card[data-id="' + mapId + '"]');
    await page.waitForSelector('#mmStage .mm-root');
    for (var th of ['glass', 'light']) {
      await page.evaluate(function (t) { document.documentElement.setAttribute('data-theme', t); }, th);
      await wait(200);
      await page.screenshot({ path: path.join(SHOT, '8-theme-' + th + '.png') });
    }
    console.log('\nALL PASS', ok);
  } catch (e) {
    console.log(e.message);
    var pages = await browser.pages();
    for (var i = 0; i < pages.length; i++) { try { await pages[i].screenshot({ path: path.join(SHOT, 'fail-' + i + '.png') }); } catch (_) {} }
    process.exitCode = 1;
  } finally {
    if (errs.length) console.log('PAGE ERRORS:\n' + errs.join('\n'));
    await browser.close();
  }
})();
