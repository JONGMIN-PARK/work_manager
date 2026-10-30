// 마인드맵 Phase 2 브라우저 E2E — 실행: node e2e2.js
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var ok = 0, errs = [];
function check(name, cond, extra) { if (!cond) throw new Error('FAIL: ' + name + ' ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 1500)); ok++; console.log('✔', name); }
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var promptAnswer = null;
var aiMock = false;

async function loginPage(browser, email) {
  var ctx = await browser.createBrowserContext();
  var page = await ctx.newPage();
  await page.setViewport({ width: 1500, height: 900 });
  page.on('dialog', function (d) { d.type() === 'prompt' ? d.accept(promptAnswer || '') : d.accept(); });
  page.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
  page.on('console', function (m) { if (m.type() === 'error' && !/Failed to load resource|favicon|fonts/.test(m.text())) errs.push(email + ' console: ' + m.text()); });
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    var u = req.url();
    if (aiMock && /\/api\/mindmaps\/ai\/status/.test(u)) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ready: true } }) });
    if (aiMock && /\/api\/mindmaps\/ai$/.test(u) && req.method() === 'POST') {
      var b = JSON.parse(req.postData() || '{}');
      var data = b.action === 'summarize' ? { summary: '핵심: 일정 관리' }
        : { nodes: [{ text: 'AI 제안 1', parent: -1 }, { text: 'AI 제안 2', parent: -1, note: '설명' }, { text: 'AI 하위', parent: 1, days: 3 }] };
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: data }) });
    }
    req.continue();
  });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#loginEmail', { visible: true });
  await page.type('#loginEmail', email);
  await page.type('#loginPw', 'Test1234!');
  await page.keyboard.press('Enter');
  await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
  await wait(800);
  return page;
}
function texts(page) {
  return page.$$eval('#mmStage .mm-node', function (els) { return els.filter(function (e) { return e.style.display !== 'none'; }).map(function (e) { return e.querySelector('.mm-txt').textContent; }); });
}
function nodeIdByText(page, t) {
  return page.evaluate(function (t) { var id = null; _mm.doc.sheets.forEach(function (sh) { mmWalk(sh.root, function (n) { if (!id && n.text === t) id = n.id; }); }); return id; }, t);
}
async function selectText(page, t) {
  var id = await nodeIdByText(page, t);
  await page.click('#mmStage .mm-node[data-id="' + id + '"] .mm-txt');
  return id;
}
async function waitSaved(page) { await page.waitForFunction(function () { return !_mm.dirty && !_mm.saving; }, { timeout: 10000 }); }
function overlap(page) {
  return page.evaluate(function () {
    var p = _mm.layout.pos, ids = Object.keys(p), n = 0;
    for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
      var a = p[ids[i]], b = p[ids[j]];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) n++;
    }
    // 요약 글상자도 노드와 겹치면 안 됨
    document.querySelectorAll('#mmStage .mm-sumlabel').forEach(function (s) {
      var r = { x: parseFloat(s.style.left), y: parseFloat(s.style.top), w: s.offsetWidth, h: s.offsetHeight };
      ids.forEach(function (id) { var a = p[id]; if (a.x < r.x + r.w && r.x < a.x + a.w && a.y < r.y + r.h && r.y < a.y + a.h) n++; });
    });
    return n;
  });
}

(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  try {
    var page = await loginPage(browser, 'admin@t.com');
    // 시드: 새 프로젝트 + 마일스톤 + 이슈
    var seed = await page.evaluate(function () {
      var stamp = Date.now();
      return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'E2E 장비 ' + stamp, visibility: 'tenant', checklists: false }) }).then(function (r) {
        var pid = r.data.id;
        return Promise.all([
          apiFetch('/api/milestones', { method: 'POST', body: JSON.stringify({ projectId: pid, name: '기구 설계', status: 'active', endDate: '2020-01-10' }) }),
          apiFetch('/api/issues', { method: 'POST', body: JSON.stringify({ projectId: pid, title: '센서 간섭', urgency: 'urgent' }) })
        ]).then(function (x) { return { pid: pid, pname: r.data.name, ms: x[0].data.id, iss: x[1].data.id }; });
      });
    });
    if (typeof _pdInvalidate === 'undefined') {}
    await page.evaluate(function () { if (typeof _pdInvalidate === 'function') _pdInvalidate(); });

    // ── 1. 새 맵: 프로젝트 구조도 (자동) ──
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmNewTpl');
    await page.select('#mmNewTpl', 'gen-project');
    check('구조도 선택 → 프로젝트 칸 표시 · 공개 범위 고르기 없음', await page.evaluate(function () { return !document.getElementById('mmNewProjWrap').classList.contains('hidden') && !document.getElementById('mmNewScope'); }));
    check('AI 미설정 → AI 템플릿 없음', !(await page.$('#mmNewTpl option[value="ai-text"]')));
    await page.select('#mmNewProj', seed.pid);
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await page.waitForFunction(function () { return Object.keys(_mm.refs).length >= 3; }, { timeout: 8000 });
    await wait(300);
    var t1 = await texts(page);
    check('구조도: 루트=프로젝트 · 마일스톤 · 이슈', t1[0] === seed.pname && t1.indexOf('기구 설계') >= 0 && t1.indexOf('센서 간섭') >= 0, t1);
    var msNode = await page.evaluate(function (id) { var el = null; document.querySelectorAll('#mmStage .mm-node').forEach(function (e) { var f = mmFind(_mmRoot(), e.getAttribute('data-id')); if (f && f.node.ref && f.node.ref.id === id) el = e.innerText; }); return el; }, seed.ms);
    check('참조 노드에 실시간 상태 (진행중 · 지연 날짜)', /진행중/.test(msNode) && /01-10/.test(msNode), msNode);
    check('지난 마감은 빨간색', await page.evaluate(function (id) { var ok = false; document.querySelectorAll('#mmStage .mm-node').forEach(function (e) { var f = mmFind(_mmRoot(), e.getAttribute('data-id')); if (f && f.node.ref && f.node.ref.id === id) ok = !!e.querySelector('.mm-ref .mm-late'); }); return ok; }, seed.ms));
    check('자동 생성 맵 → [원본과 맞추기] 버튼', !!(await page.$('[data-act="resync"]')));
    check('노드 겹침 없음', (await overlap(page)) === 0);
    await page.screenshot({ path: path.join(SHOT, '1-gen-project.png') });
    var mapId = await page.evaluate(function () { return _mm.mapId; });

    // ── 2. 참조 열기 → 프로젝트 상세 → 관련 마인드맵 ──
    await page.click('#mmStage .mm-root .mm-ref-open');
    await page.waitForSelector('#projDetailPanel', { timeout: 8000 });
    await page.waitForSelector('#pdMindmapSection .mm-pd-row', { timeout: 8000 });
    check('프로젝트 상세에 관련 마인드맵', await page.$eval('#pdMindmapSection', function (e) { return /관련 마인드맵 \(1\)/.test(e.textContent); }));
    await page.screenshot({ path: path.join(SHOT, '2-project-detail.png') });
    await page.click('#pdMindmapSection .mm-pd-row');
    await page.waitForFunction(function () { return !document.getElementById('projDetailPanel') && document.querySelector('#mmStage .mm-root'); });
    check('관련 맵 → 마인드맵 편집기로 이동', await page.evaluate(function (id) { return _mm.mapId === id; }, mapId));
    await page.waitForFunction(function () { return Object.keys(_mm.refs).length >= 3; });

    // ── 3. 원본과 맞추기: 새 마일스톤 → 추가 ──
    await page.evaluate(function (pid) { return apiFetch('/api/milestones', { method: 'POST', body: JSON.stringify({ projectId: pid, name: '전장 설계' }) }); }, seed.pid);
    await page.click('[data-act="resync"]');
    await page.waitForFunction(function () { var ok = false; mmWalk(_mmRoot(), function (n) { if (n.text === '전장 설계') ok = true; }); return ok; }, { timeout: 8000 });
    var parentOfNew = await page.evaluate(function () { var p = null; mmWalk(_mmRoot(), function (n, par) { if (n.text === '전장 설계') p = par.text; }); return p; });
    check('원본과 맞추기 → 새 마일스톤이 마일스톤 묶음 아래', parentOfNew === '📅 마일스톤', parentOfNew);
    await page.click('[data-act="resync"]');
    await wait(800);
    check('다시 맞춰도 중복 없음', await page.evaluate(function () { var c = 0; mmWalk(_mmRoot(), function (n) { if (n.text === '전장 설계') c++; }); return c === 1; }));

    // ── 4. 자유 주제 → 앱 데이터 연결 ──
    await selectText(page, '💡 아이디어 · 리스크');
    await page.keyboard.press('Tab');
    await page.waitForSelector('#mmCanvas textarea.mm-inline');
    await page.keyboard.press('Enter');   // 기본 이름 "하위 주제"
    await wait(150);
    await page.click('.mm-tools [data-act="link-ref"]');
    await page.waitForSelector('#mmLinkModal [data-lt="issue"]');
    await page.click('#mmLinkModal [data-lt="issue"]');
    await page.waitForFunction(function () { return document.querySelector('#mmLinkModal .mm-link-row'); });
    await page.type('#mmLinkQ', '센서');
    await page.waitForFunction(function (id) { return document.querySelector('#mmLinkModal .mm-link-row[data-id="' + id + '"]') && !document.querySelector('#mmLinkModal .mm-link-row:not([data-title*="센서"])'); }, { timeout: 5000 }, seed.iss);
    await page.click('#mmLinkModal .mm-link-row[data-id="' + seed.iss + '"]');
    await page.waitForFunction(function () { return !document.getElementById('mmLinkModal'); });
    await wait(500);
    var linked = await page.evaluate(function () { var f = mmFind(_mmRoot(), _mm.sel); return { text: f.node.text, ref: f.node.ref }; });
    check('연결: 기본 이름은 항목 제목으로 · ref 저장', linked.text === '센서 간섭' && linked.ref.type === 'issue' && linked.ref.id === seed.iss, linked);

    // ── 5. 승격: 주제 → 마일스톤 (하위 포함) ──
    await page.keyboard.press('Enter');
    await page.waitForSelector('#mmCanvas textarea.mm-inline');
    await page.keyboard.type('시운전 준비');
    await page.keyboard.press('Tab');
    await page.waitForSelector('#mmCanvas textarea.mm-inline');
    await page.keyboard.type('치구 제작');
    await page.keyboard.press('Enter');
    await wait(100);
    await selectText(page, '시운전 준비');
    await page.click('#mmPanel [data-act="promote"][data-kind="milestone"]');
    await page.waitForSelector('#mmPrProj');
    check('승격 창: 가장 가까운 프로젝트 자동 선택', await page.$eval('#mmPrProj', function (e) { return e.value; }) === seed.pid);
    await page.click('#mmPrKids');
    await page.click('#mmPrOk');
    await page.waitForFunction(function () { return !document.getElementById('mmPromoteModal'); }, { timeout: 8000 });
    await wait(600);
    var prom = await page.evaluate(function () {
      var out = {}; mmWalk(_mmRoot(), function (n) { if (n.text === '시운전 준비' || n.text === '치구 제작') out[n.text] = n.ref; });
      return out;
    });
    check('승격: 주제와 하위 모두 마일스톤 참조', prom['시운전 준비'] && prom['시운전 준비'].type === 'milestone' && prom['치구 제작'] && prom['치구 제작'].type === 'milestone', prom);
    var msList = await page.evaluate(function (pid) { return apiFetch('/api/milestones?projectId=' + pid).then(function (r) { return (r.data || []).map(function (m) { return m.name; }); }); }, seed.pid);
    check('승격: 서버에 마일스톤 생성', msList.indexOf('시운전 준비') >= 0 && msList.indexOf('치구 제작') >= 0, msList);

    // ── 6. 경계 · 요약 · 번호 · 관계선 ──
    await selectText(page, '📅 마일스톤');
    await page.click('#mmPnBd');
    await wait(150);
    await page.$eval('#mmPnBdTitle', function (e) { e.value = '설계 묶음'; e.dispatchEvent(new Event('change')); });
    await page.click('#mmPnSum');
    await wait(150);
    await page.$eval('#mmPnSumText', function (e) { e.value = '설계 3건 진행'; e.dispatchEvent(new Event('change')); });
    await page.click('#mmPnNum');
    await wait(200);
    check('경계 상자 + 제목', !!(await page.$('#mmEdges rect.mm-boundary')) && /설계 묶음/.test(await page.$eval('#mmStage .mm-bd-title', function (e) { return e.textContent; })));
    check('요약 중괄호 + 글상자', !!(await page.$('#mmEdges path.mm-sumbrace')) && /설계 3건/.test(await page.$eval('#mmStage .mm-sumlabel', function (e) { return e.textContent; })));
    check('하위 번호', (await page.$$eval('#mmStage .mm-num', function (e) { return e.map(function (x) { return x.textContent; }); })).indexOf('1') >= 0);
    check('경계·요약 넣어도 겹침 없음', (await overlap(page)) === 0, await overlap(page));
    // 관계선: 이슈 → 마일스톤
    await selectText(page, '센서 간섭');
    await page.click('.mm-tools [data-act="relation"]');
    check('관계 잇기 모드 안내', /이을 주제/.test(await page.$eval('#mmStatus', function (e) { return e.textContent; })));
    var target = await nodeIdByText(page, '기구 설계');
    await page.click('#mmStage .mm-node[data-id="' + target + '"] .mm-txt');
    await wait(200);
    check('관계선 생성 + 화살표', await page.evaluate(function () { return (_mmSheet().relations || []).length === 1; }) && !!(await page.$('#mmEdges path.mm-relation')));
    await page.$eval('#mmPanel .mm-rel-in', function (e) { e.value = '원인'; e.dispatchEvent(new Event('change')); });
    await wait(150);
    check('관계 설명 표시', /원인/.test(await page.$eval('#mmStage .mm-rel-label', function (e) { return e.textContent; })));
    await page.screenshot({ path: path.join(SHOT, '3-decorations.png') });
    for (var st of ['balanced', 'down']) {
      await page.select('#mmStructure', st);
      await wait(250);
      check('구조 ' + st + ': 경계·요약 포함 겹침 없음', (await overlap(page)) === 0);
      await page.screenshot({ path: path.join(SHOT, '4-' + st + '.png') });
    }
    await page.select('#mmStructure', 'right');

    // ── 7. 시트 ──
    promptAnswer = '리스크 시트';
    await page.click('[data-act="sheet-add"]');
    await wait(300);
    check('시트 추가 → 새 시트로 전환', await page.evaluate(function () { return _mm.doc.sheets.length === 2 && _mm.sheetIdx === 1 && _mmRoot().text === '리스크 시트'; }));
    await page.keyboard.press('Tab');
    await page.waitForSelector('#mmCanvas textarea.mm-inline');
    await page.keyboard.type('납기 위험');
    await page.keyboard.press('Enter');
    await wait(100);
    await page.click('.mm-sheet[data-i="0"]');
    await wait(200);
    check('시트 전환: 첫 시트 내용', (await texts(page))[0] === seed.pname);

    // ── 8. 저장 → 다시 열어도 유지 ──
    await waitSaved(page);
    await page.click('[data-act="back"]');
    await page.waitForSelector('#mindmapWrap .mm-card[data-id="' + mapId + '"]');
    await page.click('#mindmapWrap .mm-card[data-id="' + mapId + '"]');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(500);
    var kept = await page.evaluate(function () {
      var m = null; mmWalk(_mm.doc.sheets[0].root, function (n) { if (n.text === '📅 마일스톤') m = n; });
      return { sheets: _mm.doc.sheets.length, s2: _mm.doc.sheets[1].root.children[0].text, rel: (_mm.doc.sheets[0].relations || [])[0], bd: m.boundary, sum: m.summary, num: m.numbering, gen: !!(_mm.doc.meta && _mm.doc.meta.gen) };
    });
    check('저장 유지: 시트·관계·경계·요약·번호·자동생성 정보', kept.sheets === 2 && kept.s2 === '납기 위험' && kept.rel.label === '원인' && kept.bd.title === '설계 묶음' && kept.sum.text === '설계 3건 진행' && kept.num === true && kept.gen, kept);
    var by = await page.evaluate(function (iss) { return apiFetch('/api/mindmaps/by-link?type=issue&id=' + iss).then(function (r) { return r.data.length; }); }, seed.iss);
    check('역참조: 이슈가 들어간 맵 조회', by >= 1);

    // ── 9. AI (응답 흉내) — 미리보기 · 채택 · 버리기 · 저장 제외 ──
    aiMock = true;
    await page.evaluate(function () { _mm.aiReady = null; });
    await page.click('[data-act="back"]');
    await page.waitForSelector('#mindmapWrap .mm-card[data-id="' + mapId + '"]');
    await page.click('#mindmapWrap .mm-card[data-id="' + mapId + '"]');
    await page.waitForSelector('#mmStage .mm-root');
    await page.waitForFunction(function () { var w = document.getElementById('mmAiWrap'); return w && !w.classList.contains('hidden'); }, { timeout: 5000 });
    check('AI 사용 가능 → ✨ AI 메뉴 표시', true);
    await page.waitForFunction(function () { return Object.keys(_mm.refs).length >= 5; }, { timeout: 8000 });
    await wait(300);
    await selectText(page, '💡 아이디어 · 리스크');
    await page.click('[data-act="menu"][data-menu="mmAiMenu"]');
    await page.click('[data-act="ai-expand"]');
    await page.waitForFunction(function () { return document.querySelectorAll('#mmStage .mm-node.mm-ai').length === 3; }, { timeout: 5000 });
    check('AI 제안 미리보기 (점선 3개) + 채택 막대', /AI 제안 3개/.test(await page.$eval('#mmAiBar', function (e) { return e.textContent; })));
    check('AI 예상 일수 → 노트', await page.evaluate(function () { var x = null; mmWalk(_mmRoot(), function (n) { if (n.text === 'AI 하위') x = n.note; }); return x === '예상 3일'; }));
    var savedDoc = await page.evaluate(function () { return JSON.stringify(_mmDocForSave()); });
    check('미리보기는 저장 문서에서 빠짐', savedDoc.indexOf('AI 제안') < 0);
    await page.click('[data-act="ai-discard"]');
    await wait(200);
    check('모두 버리기', (await page.$$('#mmStage .mm-node.mm-ai')).length === 0 && (await texts(page)).indexOf('AI 제안 1') < 0);
    await page.click('[data-act="menu"][data-menu="mmAiMenu"]');
    await page.click('[data-act="ai-expand"]');
    await page.waitForFunction(function () { return document.querySelectorAll('#mmStage .mm-node.mm-ai').length === 3; });
    await page.click('[data-act="ai-accept"]');
    await wait(200);
    check('모두 채택 → 일반 주제로', (await page.$$('#mmStage .mm-node.mm-ai')).length === 0 && (await texts(page)).indexOf('AI 제안 2') >= 0);
    await selectText(page, '📅 마일스톤');
    await page.click('[data-act="menu"][data-menu="mmAiMenu"]');
    await page.click('[data-act="ai-summary"]');
    await page.waitForFunction(function () { var s = document.querySelector('#mmStage .mm-sumlabel'); return s && /핵심/.test(s.textContent); }, { timeout: 5000 });
    check('AI 가지 요약 → 요약 글상자', true);
    await page.screenshot({ path: path.join(SHOT, '5-ai.png') });
    await waitSaved(page);
    aiMock = false;

    // ── 10. 가져오기: XMind(content.json) · OPML ──
    var imp = await page.evaluate(function () {
      var zip = new JSZip();
      zip.file('content.json', JSON.stringify([{ title: 'X시트', rootTopic: { id: 'r', title: 'XMind 맵', structureClass: 'org.xmind.ui.org-chart.down',
        children: { attached: [{ id: 'a', title: '가', markers: [{ markerId: 'priority-1' }] }, { id: 'b', title: '나', notes: { plain: { content: '노트' } } }] } },
        relationships: [{ end1Id: 'a', end2Id: 'b', title: '연결' }] }]));
      return zip.generateAsync({ type: 'blob' }).then(function (blob) {
        return mmReadImportFile(new File([blob], 'test.xmind'));
      }).then(function (r) {
        var opml = '<?xml version="1.0"?><opml version="2.0"><head><title>OP</title></head><body><outline text="루트"><outline text="하나" _note="n"/><outline text="둘"><outline text="둘-1"/></outline></outline></body></opml>';
        return mmReadImportFile(new File([opml], 'a.opml')).then(function (o) { return { x: r, o: o }; });
      });
    });
    var xs = imp.x.doc.sheets[0];
    check('XMind 가져오기: 제목·구조·마커·노트·관계선', imp.x.title === 'XMind 맵' && xs.structure === 'down' && xs.root.children[0].markers[0] === 'priority-1' && xs.root.children[1].note === '노트' && xs.relations.length === 1);
    check('OPML 가져오기', imp.o.doc.sheets[0].root.text === '루트' && imp.o.doc.sheets[0].root.children[1].children[0].text === '둘-1' && imp.o.doc.sheets[0].root.children[0].note === 'n');
    var opmlOut = await page.evaluate(function () { return mmToOpml(_mmRoot(), _mm.row.title); });
    check('OPML 내보내기', /<outline text="📅 마일스톤">/.test(opmlOut));

    // ── 11. 팀원 업무 지도 (설계팀 · 관리자가 부서 지정) ──
    await page.click('[data-act="back"]');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmNewTpl');
    await page.select('#mmNewTpl', 'gen-team');
    var deptVal = await page.evaluate(function () { return apiFetch('/api/users').then(function (r) { var k = (r.data || []).filter(function (u) { return u.email === 'kim@t.com'; })[0]; return k.department_id || k.departmentId; }); });
    await page.select('#mmNewDept', deptVal);
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(600);
    var tt = await texts(page);
    check('팀원 업무 지도: 설계팀 · 팀원 노드', tt[0] === '설계팀 업무 지도' && tt.indexOf('김팀원') >= 0 && tt.indexOf('이팀원') >= 0, tt);
    await page.screenshot({ path: path.join(SHOT, '6-team.png') });
    var teamId = await page.evaluate(function () { return _mm.mapId; });
    // v13.249: 같은 부서라도 보내야 보임 — 이팀원에게 보기로 보냄
    await page.evaluate(function () {
      return Promise.resolve(_mmSaveNow()).then(function () { return apiFetch('/api/mindmaps/members'); }).then(function (r) {
        var lee = r.data.filter(function (u) { return u.name === '이팀원'; })[0];
        return apiFetch('/api/mindmaps/' + _mm.mapId, { method: 'PUT', body: JSON.stringify({ version: _mm.version, viewers: [lee.id] }) });
      }).then(function (r) { _mm.version = r.data.version; });
    });
    var lee = await loginPage(browser, 'lee@t.com');
    await lee.click('#tabMindmap');
    await lee.waitForSelector('#mindmapWrap .mm-card');
    check('보내 준 이팀원 목록에 팀 맵', !!(await lee.$('#mindmapWrap .mm-card[data-id="' + teamId + '"]')));
    await lee.click('#mindmapWrap .mm-card[data-id="' + teamId + '"]');
    await lee.waitForSelector('#mmStage .mm-root');
    check('팀 맵: 보기로 받은 사람은 보기 전용', await lee.evaluate(function () { return _mm.readOnly === true; }));
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
