// 🤝 같이 담당 · 함께 하기 화면 (v13.533~534) — 두 사람
//   관리자: 할 일 패널 🤝 같이 담당 ＋ 사람 → 목록 🤝 표시 / 🤝 함께 하기 시작 → 공동 메모 열림 · 진행 중 막대
//   김팀원: 내 업무에 같이 담당 할 일(주인 표시 · 휴지통 없음) · 막대 [참여] → 메모 / 관리자 ⏹ 끝내기 → 막대 사라짐 · 기록
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var ok = 0, fail = 0, errs = [];
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var ctx = await browser.createBrowserContext(), page = await ctx.newPage();
    page.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    page.on('dialog', function (d) { d.accept(); });
    await page.setViewport({ width: 1500, height: 950 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', email); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(800);
    return page;
  }
  var T = Date.now(), tid = null, A;
  try {
    A = await open('admin@t.com');
    tid = await A.evaluate(function (T) { return apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: '함께 시험 ' + T, dueDate: '2026-12-05' }) }).then(function (r) { return r.data.id; }); }, T);
    await A.evaluate(function () { setPage('mywork'); });
    await A.waitForFunction(function (tid) { return typeof _mw !== 'undefined' && _mw.data && (_mw.data.data || []).some(function (x) { return x.id === tid; }); }, { timeout: 15000 }, tid);
    var openPanel = function (P) { return P.evaluate(function (tid) { var it = _mw.data.data.filter(function (x) { return x.id === tid; })[0]; mwPanelOpen(it); }, tid); };
    await openPanel(A);
    await A.waitForSelector('[data-p="pair-add"]', { timeout: 6000 });
    check(!!(await A.$('[data-p="pair-start"]')), '할 일 패널 — 🤝 같이 담당 칸 · 🤝 함께 하기 단추');
    // 같이 담당 ＋ 사람
    await A.evaluate(function () { document.querySelector('[data-p="pair-add"]').click(); });
    await A.waitForSelector('#wpPickModal .wp-p', { timeout: 6000 });
    await A.type('#wpPickModal #wpQ', '김');
    await A.evaluate(function () { document.querySelector('#wpPickModal .wp-p').click(); });
    await A.waitForFunction(function (tid) { var it = (_mw.data.data || []).filter(function (x) { return x.id === tid; })[0]; return it && it.partners && it.partners.length; }, { timeout: 10000 }, tid).catch(function () {});
    await wait(500);
    var tag = await A.evaluate(function () { var t = [].filter.call(document.querySelectorAll('#mMyWork .mw-pair'), function (x) { return /김팀원/.test(x.textContent); })[0]; return t && t.textContent; });
    check(/🤝 김팀원/.test(tag || ''), '같이 담당 더하기 → 목록에 🤝 김팀원 ' + tag);

    // 김팀원 화면
    var K = await open('kim@t.com');
    await K.evaluate(function () { setPage('mywork'); });
    await K.waitForFunction(function (tid) { return typeof _mw !== 'undefined' && _mw.data && (_mw.data.data || []).some(function (x) { return x.id === tid; }); }, { timeout: 15000 }, tid).catch(function () {});
    var kv = await K.evaluate(function (tid) { var it = (_mw.data.data || []).filter(function (x) { return x.id === tid; })[0]; if (!it) return null; mwPanelOpen(it); return { owner: it.ownerName, isOwner: it.isOwner }; }, tid);
    await K.waitForSelector('.mwp-pair', { timeout: 6000 }).catch(function () {});
    var kp = await K.evaluate(function () { return { sec: (document.querySelector('.mwp-pair') || {}).textContent, del: !!document.querySelector('[data-p="delete"]'), leave: !!document.querySelector('[data-p="pair-leave"]') }; });
    check(kv && kv.isOwner === false && /👑/.test(kp.sec || '') && !kp.del && kp.leave, '김팀원 — 같이 담당 할 일 보임 · 👑 주인 · 휴지통 없음 · 나 빠지기 ' + JSON.stringify([kv, kp]));

    // 관리자 — 🤝 함께 하기
    await A.evaluate(function () { document.querySelector('[data-p="pair-start"]').click(); });
    await A.waitForSelector('#wpStartModal .wp-p input', { timeout: 6000 });
    var tt = await A.evaluate(function () { return document.querySelector('#wpStartModal #wpTitle').value; });
    check(/함께 시험/.test(tt), '시작 창 — 제목 채움');
    await A.type('#wpStartModal #wpQ2', '김팀원');
    await A.evaluate(function () { var c = document.querySelector('#wpStartModal .wp-p input'); c.click(); });
    await A.evaluate(function () { document.querySelector('#wpStartModal [data-go]').click(); });
    await A.waitForSelector('#cdDoc', { timeout: 10000 }).catch(function () {});
    var docOpen = await A.evaluate(function () { var d = document.getElementById('cdDoc'); return d ? d.textContent.slice(0, 80) : null; });
    check(!!docOpen, '시작 → 📝 공동 메모 열림');
    await A.evaluate(function () { var d = document.getElementById('cdDoc'); var x = d && (d.closest('.wa-modal-overlay') || d); if (x && x._wmClose) x._wmClose(); else if (x) x.remove(); });
    await wait(300);
    var bar = await A.evaluate(function () { var b = document.getElementById('wpBar'); return b ? b.textContent : null; });
    check(/함께 시험/.test(bar || '') && /김팀원/.test(bar || ''), '진행 중 막대 — 제목 · 사람 ' + (bar || '').slice(0, 60));

    // 김팀원 — 막대 [참여]
    await K.evaluate(function () { return wpLoad(); });
    await K.waitForSelector('#wpBar [data-wp="join"]', { timeout: 8000 }).catch(function () {});
    check(!!(await K.$('#wpBar [data-wp="join"]')), '초대받은 사람 — 막대에 [참여]');
    await K.evaluate(function () { document.querySelector('#wpBar [data-wp="join"]').click(); });
    await K.waitForSelector('#cdDoc', { timeout: 10000 }).catch(function () {});
    check(!!(await K.$('#cdDoc')) && !(await K.$('#wpBar [data-wp="join"]')), '참여 → 공동 메모 열림 · [참여] 사라짐');

    // 관리자 끝내기
    await A.evaluate(function () { document.querySelector('#wpBar [data-wp="end"]').click(); });
    await A.waitForSelector('#wpEndModal #wpSum', { timeout: 6000 });
    check(await A.evaluate(function () { var c = document.getElementById('wpAddP'); return c && c.checked; }), '끝내기 창 — 같이 담당으로(할 일) 기본 켬');
    await A.type('#wpEndModal #wpSum', '원인 정리 완료');
    await A.keyboard.press('Enter');
    await A.waitForFunction(function () { return !document.getElementById('wpBar'); }, { timeout: 8000 }).catch(function () {});
    check(!(await A.$('#wpBar')), '끝내면 막대 사라짐');
    await A.evaluate(function () { return wpHistory(); });
    await A.waitForSelector('#wpHistModal .wp-h', { timeout: 6000 }).catch(function () {});
    var hist = await A.evaluate(function () { var m = document.getElementById('wpHistModal'); return m ? m.textContent : ''; });
    check(/함께 시험/.test(hist) && /원인 정리 완료/.test(hist) && /\d+분/.test(hist), '🤝 함께 한 기록 — 시간 · 요약');
    await K.evaluate(function () { return wpLoad(); });
    check(!(await K.$('#wpBar')), '상대 쪽 막대도 사라짐(다시 받으면)');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    try { if (A && tid) await A.evaluate(function (tid) { return apiFetch('/api/my-work/todos/' + tid, { method: 'DELETE' }); }, tid); } catch (_) {}
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
