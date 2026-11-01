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
  var proj = null, asked = [], histSent = [], insightsHit = 0;
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    if (req.url().indexOf('/api/ai/status') >= 0) {   // run.sh 서버엔 AI 키가 없음 → "연결됨" 으로
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { configured: true, provider: 'Gemini', model: 'gemini-2.5-flash', quota: { used: 0, limit: 999999 } } }) });
    }
    if (req.url().indexOf('/api/ai/insights') >= 0) {
      insightsHit++;
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [
        { id: 'delayed', level: 'risk', icon: '🔴', title: '지연 프로젝트 1건', detail: '종료일이 지났습니다.', items: [{ label: proj ? proj.name : 'x', sub: '종료 2026-10-01', nav: { projectId: proj && proj.id } }], ask: '지연된 프로젝트 상황을 정리해줘' },
        { id: 'overload', level: 'warn', icon: '🔥', title: '지난주 52시간 넘게 일한 사람 1명', detail: '', items: [{ label: '<b>김</b>', sub: '60h', nav: { name: '김' } }], ask: '바빴던 사람은?' }
      ] }) });
    }
    if (req.url().indexOf('/api/ai/query') >= 0 && req.method() === 'POST') {
      var body = JSON.parse(req.postData() || '{}');
      histSent.push((body.history || []).length);
      asked.push(body.question);
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
        answer: '핵심: **' + (proj ? proj.name : '?') + '** 이 늦습니다 [P1].\n\n## 이유\n- 진행률이 낮음 [P1]\n- <img src=x onerror="alert(1)"> 지어낸 표시 [P9]',
        note: '', provider: 'Gemini', model: 'gemini-2.5-flash', context: '[진행 중 프로젝트]\n[P1] <b>테스트</b>',
        sources: [
          { key: 'P1', type: 'project', title: proj ? proj.name : 'x', sub: '', nav: { projectId: proj && proj.id }, cited: true },
          { key: 'I1', type: 'issue', title: '참고 이슈', sub: '', nav: { issueId: 'none' }, cited: false }
        ], charts: [{ title: '사람별 시간 · 지난주', unit: 'h', rows: [{ label: '<i>김</i>', value: 52 }, { label: '이', value: 26 }] }],
        followups: ['담당자별로 나눠줘', '<script>x</script>'],
        tools: [{ tool: 'projects', label: '프로젝트 목록', args: { status: 'delayed' }, rows: 1 }, { tool: 'work_hours', label: '업무일지 시간 집계', args: { group_by: 'person', period: 'last_week' }, rows: 2 }],
        planned: true, quota: { used: 1, limit: 999999 } } }) });
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
      return { q: (m.querySelector('.ai-q-t') || {}).textContent, img: !!m.querySelector('.ai-a img, .ai-ctx b'), imgText: a.textContent.indexOf('<img') >= 0,
        cites: m.querySelectorAll('.ai-a .ai-cite').length, z9: a.textContent.indexOf('P9') >= 0, h: !!a.querySelector('.ai-h'), li: a.querySelectorAll('.ai-li').length,
        srcs: m.querySelectorAll('.ai-srcs .ai-src').length, more: m.querySelectorAll('details.ai-more').length, meta: (m.querySelector('.ai-meta') || {}).textContent };
    });
    check(ans && ans.q === '이번 주 지연 위험 프로젝트는?', 'Enter → 창 열리고 질문 그대로 ' + JSON.stringify(ans && ans.q));
    check(asked.length === 1 && asked[0] === '이번 주 지연 위험 프로젝트는?', '서버로 질문 1번 ' + JSON.stringify(asked));
    check(ans && !ans.img && ans.imgText && !alerted, 'AI 답 속 HTML 은 글자로 (실행 안 됨)');
    check(ans && ans.cites === 2 && !ans.z9 && ans.h && ans.li === 2, '근거 칩 2 · 없는 표시 빠짐 · 소제목 · 목록 ' + JSON.stringify(ans));
    check(ans && ans.srcs === 2 && ans.more === 3 && /gemini-2\.5-flash/.test(ans.meta), '근거 목록 · 그 밖 · AI 가 본 데이터 · 모델 표시 ' + JSON.stringify(ans));
    var extra = await page.evaluate(function () {
      var m = document.getElementById('aiAskModal');
      var bars = m.querySelectorAll('.ai-chart .ai-bar');
      return { bars: bars.length, w0: bars[0] && bars[0].querySelector('.ai-bar-f').style.width, w1: bars[1] && bars[1].querySelector('.ai-bar-f').style.width, chartItalic: !!m.querySelector('.ai-chart i'),
        fu: Array.from(m.querySelectorAll('.ai-fu-b')).map(function (b) { return b.textContent; }), fuScript: !!m.querySelector('.ai-fu script'),
        tools: Array.from(m.querySelectorAll('.ai-tool')).map(function (t) { return t.textContent; }), acts: m.querySelectorAll('.ai-acts .ai-act').length };
    });
    check(extra.bars === 2 && extra.w0 === '100%' && extra.w1 === '50%' && !extra.chartItalic, '차트 막대 2 · 비율 · HTML 막힘 ' + JSON.stringify(extra));
    check(extra.fu.length === 2 && !extra.fuScript && /담당자별로/.test(extra.fu[0]), '추천 이어 질문 칩 ' + JSON.stringify(extra.fu));
    check(extra.tools.length === 2 && /지연/.test(extra.tools[0]) && /사람별 · 지난주/.test(extra.tools[1]) && extra.acts === 2, 'AI 가 조회한 것 · 복사/맵으로 단추 ' + JSON.stringify(extra.tools));
    await page.screenshot({ path: path.join(SHOTS, 'ai-ask.png') });

    // 3) 예시 단추 · 입력칸 Enter 로 이어 묻기
    await page.type('#aiAskInput', '긴급 이슈는?');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return document.querySelectorAll('#aiAskModal .ai-q').length === 2 && !document.querySelector('#aiAskModal .ai-wait'); }, { timeout: 10000 }).catch(function () {});
    check(asked.length === 2 && asked[1] === '긴급 이슈는?' && histSent[0] === 0 && histSent[1] === 1, '창 안에서 이어 묻기 · 앞 대화 함께 보냄 ' + JSON.stringify([asked, histSent]));
    await page.click('#aiAskModal .ai-fu-b');
    await page.waitForFunction(function () { return document.querySelectorAll('#aiAskModal .ai-q').length === 3 && !document.querySelector('#aiAskModal .ai-wait'); }, { timeout: 10000 }).catch(function () {});
    check(asked[2] === '담당자별로 나눠줘' && histSent[2] === 2, '추천 질문 누르면 바로 물음 ' + JSON.stringify(asked));
    await page.click('#aiAskModal .ai-star');
    var saved = await page.evaluate(function () { return { on: document.querySelector('#aiAskModal .ai-star').classList.contains('on'), ls: wmAiSaved() }; });
    check(saved.on && saved.ls[0] === '이번 주 지연 위험 프로젝트는?', '⭐ 질문 저장 ' + JSON.stringify(saved));

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
    check(hist === 3 && asked.length === 3, '다시 열면 지난 답 그대로 · 새로 묻지 않음 (' + hist + ')');

    // 5-2) 🏠 새 대화 → 💡 살펴볼 것 카드 · 저장한 질문 · 카드 항목 HTML 막힘
    await page.click('#aiAskHome');
    await page.waitForSelector('#aiAskModal .ai-card', { timeout: 5000 }).catch(function () {});
    var home = await page.evaluate(function () {
      var m = document.getElementById('aiAskModal');
      return { cards: m.querySelectorAll('.ai-card').length, risk: !!m.querySelector('.ai-card.ai-lv-risk'), bold: !!m.querySelector('.ai-card-l b'),
        savedBtn: Array.from(m.querySelectorAll('.ai-sv .ai-ex-b')).map(function (b) { return b.textContent; }), go: m.querySelectorAll('.ai-card-i.ai-go').length };
    });
    check(home.cards === 2 && home.risk && !home.bold && home.go === 2 && insightsHit >= 1, '💡 살펴볼 것 카드 2 ' + JSON.stringify(home));
    check(home.savedBtn.length === 1 && home.savedBtn[0] === '이번 주 지연 위험 프로젝트는?', '첫 화면에 저장한 질문 ' + JSON.stringify(home.savedBtn));
    await page.screenshot({ path: path.join(SHOTS, 'ai-ask-home.png') });
    // 카드의 "AI 에게 더 묻기" → 그 질문 (새 대화라 앞 대화 없음)
    await page.click('#aiAskModal .ai-card-ask');
    await page.waitForFunction(function () { return document.querySelectorAll('#aiAskModal .ai-q').length === 1 && !document.querySelector('#aiAskModal .ai-wait'); }, { timeout: 10000 }).catch(function () {});
    check(asked[asked.length - 1] === '지연된 프로젝트 상황을 정리해줘' && histSent[histSent.length - 1] === 0, '카드 → AI 에게 더 묻기 ' + JSON.stringify(asked.slice(-1)));
    // 🧠 맵으로 → 새 맵을 만들고 마인드맵 화면으로
    await page.click('#aiAskModal .ai-acts .ai-act:nth-child(2)');
    await page.waitForFunction(function () { return !document.getElementById('aiAskModal') && typeof _mm !== 'undefined' && _mm.mapId; }, { timeout: 10000 }).catch(function () {});
    var mp = await page.evaluate(function () {
      return apiFetch('/api/mindmaps/' + _mm.mapId).then(function (r) {
        var d = r.data, doc = typeof d.doc === 'string' ? JSON.parse(d.doc) : d.doc, root = doc.sheets[0].root;
        return { id: d.id, title: d.title, root: root.text, kids: (root.children || []).map(function (c) { return c.text; }) };
      }).catch(function (e) { return { err: e.message }; });
    });
    check(mp && /^✨ 지연된 프로젝트/.test(mp.title || '') && mp.root === '지연된 프로젝트 상황을 정리해줘' && mp.kids.indexOf('이유') >= 0, '🧠 맵으로 → 새 맵 (질문이 가운데 · 소제목이 가지) ' + JSON.stringify(mp));
    if (mp && mp.id) await page.evaluate(function (id) { return apiFetch('/api/mindmaps/' + id, { method: 'DELETE' }).catch(function () {}); }, mp.id);
    await page.evaluate(function () { if (typeof setPage === 'function') setPage('project'); });
    await wait(500);
    await page.evaluate(function () { wmAiAsk(); });
    await page.waitForSelector('#aiAskModal', { timeout: 5000 }).catch(function () {});

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
  console.log(fail ? '결과 ' + ok + ' 통과 ' + fail + ' 실패' : 'ALL PASS (' + ok + ')');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
