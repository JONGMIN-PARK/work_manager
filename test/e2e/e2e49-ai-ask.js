// ✨ AI에게 묻기 (v13.297) — 검색창 문장 → AI 줄 · Enter 로 창 · 답(막힌 HTML) · 근거 칩 → 그 화면 · 지난 답 다시 보기 · 휴대폰 폭
// /api/ai/status · /api/ai/query 응답은 가로채서 준다 (AI 키 · 실제 AI 호출 없음)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var SHOTS = path.join(__dirname, '.shots');
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var alerted = false;
  page.on('dialog', function (d) { alerted = true; d.dismiss(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var proj = null, asked = [];
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    if (req.url().indexOf('/api/ai/status') >= 0) {   // run.sh 서버엔 AI 키가 없음 → "연결됨" 으로
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { configured: true, provider: 'Gemini', model: 'gemini-2.5-flash', quota: { used: 0, limit: 999999 } } }) });
    }
    if (req.url().indexOf('/api/ai/query') >= 0 && req.method() === 'POST') {
      asked.push(JSON.parse(req.postData() || '{}').question);
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
        answer: '핵심: **' + (proj ? proj.name : '?') + '** 이 늦습니다 [P1].\n\n## 이유\n- 진행률이 낮음 [P1]\n- <img src=x onerror="alert(1)"> 지어낸 표시 [P9]',
        note: '', provider: 'Gemini', model: 'gemini-2.5-flash', context: '[진행 중 프로젝트]\n[P1] <b>테스트</b>',
        sources: [
          { key: 'P1', type: 'project', title: proj ? proj.name : 'x', sub: '', nav: { projectId: proj && proj.id }, cited: true },
          { key: 'I1', type: 'issue', title: '참고 이슈', sub: '', nav: { issueId: 'none' }, cited: false }
        ], quota: { used: 1, limit: 999999 } } }) });
    }
    req.continue();
  });
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    proj = await page.evaluate(function () { return apiFetch('/api/projects').then(function (r) { var p = (r.data || [])[0]; return p && { id: p.id, name: p.name }; }); });
    check(!!proj, '프로젝트 하나 ' + JSON.stringify(proj));

    // 1) 문장을 치면 ✨ 줄이 맨 위에
    await page.click('#globalSearchInput');
    await page.type('#globalSearchInput', '이번 주 지연 위험 프로젝트는?');
    await page.waitForSelector('#globalSearchDropdown .gs-ai', { timeout: 8000 }).catch(function () {});
    var row = await page.evaluate(function () { var dd = document.getElementById('globalSearchDropdown'); var a = dd.querySelector('.gs-ai'); var first = dd.querySelector('.gs-item'); return { has: !!a, first: first === a, text: a && a.textContent }; });
    check(row.has && row.first, '문장 → ✨ AI에게 묻기 줄이 맨 위 ' + JSON.stringify(row));
    // 짧은 낱말이면 맨 위가 아님
    await page.evaluate(function () { var i = document.getElementById('globalSearchInput'); i.value = ''; });
    await page.type('#globalSearchInput', '검사'); await wait(900);
    var row2 = await page.evaluate(function () { var dd = document.getElementById('globalSearchDropdown'); var items = dd.querySelectorAll('.gs-item'); return { n: items.length, firstAi: items[0] && items[0].classList.contains('gs-ai'), lastAi: items.length && items[items.length - 1].classList.contains('gs-ai') }; });
    check(!row2.firstAi && row2.lastAi, '낱말 검색 → ✨ 줄은 맨 아래 ' + JSON.stringify(row2));

    // 2) 문장 + Enter → 창 · 답
    await page.evaluate(function () { var i = document.getElementById('globalSearchInput'); i.value = ''; });
    await page.type('#globalSearchInput', '이번 주 지연 위험 프로젝트는?'); await wait(700);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#aiAskModal .ai-a:not(.ai-wait)', { timeout: 10000 }).catch(function () {});
    await wait(300);
    var ans = await page.evaluate(function () {
      var m = document.getElementById('aiAskModal'); if (!m) return null;
      var a = m.querySelector('.ai-a');
      return { q: (m.querySelector('.ai-q') || {}).textContent, img: !!m.querySelector('.ai-a img, .ai-ctx b'), imgText: a.textContent.indexOf('<img') >= 0,
        cites: m.querySelectorAll('.ai-a .ai-cite').length, z9: a.textContent.indexOf('P9') >= 0, h: !!a.querySelector('.ai-h'), li: a.querySelectorAll('.ai-li').length,
        srcs: m.querySelectorAll('.ai-srcs .ai-src').length, more: m.querySelectorAll('details.ai-more').length, meta: (m.querySelector('.ai-meta') || {}).textContent };
    });
    check(ans && ans.q === '이번 주 지연 위험 프로젝트는?', 'Enter → 창 열리고 질문 그대로 ' + JSON.stringify(ans && ans.q));
    check(asked.length === 1 && asked[0] === '이번 주 지연 위험 프로젝트는?', '서버로 질문 1번 ' + JSON.stringify(asked));
    check(ans && !ans.img && ans.imgText && !alerted, 'AI 답 속 HTML 은 글자로 (실행 안 됨)');
    check(ans && ans.cites === 2 && !ans.z9 && ans.h && ans.li === 2, '근거 칩 2 · 없는 표시 빠짐 · 소제목 · 목록 ' + JSON.stringify(ans));
    check(ans && ans.srcs === 2 && ans.more === 2 && /gemini-2\.5-flash/.test(ans.meta), '근거 목록 · 그 밖 · AI 가 본 데이터 · 모델 표시 ' + JSON.stringify(ans));
    await page.screenshot({ path: path.join(SHOTS, 'ai-ask.png') });

    // 3) 예시 단추 · 입력칸 Enter 로 이어 묻기
    await page.type('#aiAskInput', '긴급 이슈는?');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return document.querySelectorAll('#aiAskModal .ai-q').length === 2 && !document.querySelector('#aiAskModal .ai-wait'); }, { timeout: 10000 }).catch(function () {});
    check(asked.length === 2 && asked[1] === '긴급 이슈는?', '창 안에서 이어 묻기 ' + JSON.stringify(asked));

    // 4) 근거 칩 → 창 닫히고 프로젝트 상세 열림
    await page.click('#aiAskModal .ai-a .ai-cite');
    await page.waitForSelector('#projDetailPanel', { timeout: 8000 }).catch(function () {});
    await wait(500);
    var nav = await page.evaluate(function () { return { modal: !!document.getElementById('aiAskModal'), panel: !!document.getElementById('projDetailPanel'), pid: window._pdProj && window._pdProj.id }; });
    check(!nav.modal && nav.panel && nav.pid === proj.id, '근거 칩 → 창 닫고 그 프로젝트 상세 ' + JSON.stringify(nav));

    // 5) 패널 닫고 빈 검색창 → 지난 AI 답 다시 보기
    await page.mouse.click(5, 450); await wait(300);   // 패널 바깥(어두운 막) 누르면 닫힘
    await page.evaluate(function () { var i = document.getElementById('globalSearchInput'); i.value = ''; i.blur(); });
    var cover = await page.evaluate(function () { var ib = document.getElementById('globalSearchInput').getBoundingClientRect(); var el = document.elementFromPoint(ib.left + ib.width / 2, ib.top + ib.height / 2); return { at: el && (el.id || String(el.className) || el.tagName), act: document.activeElement && (document.activeElement.id || document.activeElement.tagName), r: [Math.round(ib.left), Math.round(ib.top), Math.round(ib.width), Math.round(ib.height)] }; });
    await page.click('#globalSearchInput'); await wait(400);
    var again = await page.evaluate(function () { var a = document.querySelector('#globalSearchDropdown .gs-ai'); return a && a.textContent; });
    if (!/지난 AI 답/.test(again || '')) console.log('  덮개', JSON.stringify(cover));
    check(/지난 AI 답 다시 보기/.test(again || ''), '빈 검색창 → 지난 AI 답 줄 ' + JSON.stringify(again));
    await page.click('#globalSearchDropdown .gs-ai');
    await page.waitForSelector('#aiAskModal', { timeout: 5000 }).catch(function () {});
    var hist = await page.evaluate(function () { return document.querySelectorAll('#aiAskModal .ai-q').length; });
    check(hist === 2 && asked.length === 2, '다시 열면 지난 답 그대로 · 새로 묻지 않음 (' + hist + ')');

    // 6) 휴대폰 폭 — 넘침 없음
    await page.setViewport({ width: 402, height: 874 }); await wait(600);   // isMobile 로 바꾸면 페이지가 다시 읽혀 창이 사라짐
    var mob = await page.evaluate(function () {
      var b = document.querySelector('#aiAskModal .wa-modal-box'); var r = b.getBoundingClientRect();
      var over = Array.from(b.querySelectorAll('*')).some(function (e) { var x = e.getBoundingClientRect(); return x.width && (x.right > window.innerWidth + 1); });
      return { w: Math.round(r.width), over: over, doc: document.documentElement.scrollWidth <= window.innerWidth };
    });
    check(!mob.over && mob.doc, '휴대폰 폭 — 넘침 없음 ' + JSON.stringify(mob));
    await page.screenshot({ path: path.join(SHOTS, 'ai-ask-mobile.png') });

    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  } catch (e) {
    fail++; console.log('FAIL 예외', e.message);
  }
  console.log('결과', ok, '통과', fail, '실패');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
