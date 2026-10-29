// 📝 내 업무 노트 서랍 — 열기(상세 패널 자리) · 줄 쓰기 · 자동 저장 · ➜ / '- [ ]' 할 일로 · ✓ 누르면 할 일 · 그날 회의 메모 · 회의록 요약
//    · 날짜 이동 · 🔗 연동(타임라인 고른 날) · 노트 점 · 회의 미리보기 카드 · 검색 · 패널과 하나만 · 휴대폰 (v13.272)
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var me = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var tid = me.tenant_id;
  async function clean() {
    await c.query('DELETE FROM my_notes WHERE user_id = $1', [me.id]);
    await c.query("DELETE FROM my_todos WHERE user_id = $1 AND title LIKE '노트%'", [me.id]);
    await c.query("DELETE FROM meeting_action_items WHERE id LIKE 'ne-%'");
    await c.query("DELETE FROM meetings WHERE id LIKE 'ne-%'");
    await c.query("DELETE FROM events WHERE id LIKE 'ne-%'");
    await c.query("DELETE FROM projects WHERE id LIKE 'ne-%'");
  }
  await clean();
  var d0 = kst(0);
  await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('ne-p1', '노트화면 프로젝트', 'active', 'tenant', $1, $2)", [me.id, tid]);
  await c.query("INSERT INTO events (id, title, type, start_date, end_date, start_time, end_time, project_ids, assignees, created_by, tenant_id) VALUES ('ne-e1', '노트화면 설계 회의', 'meeting', $1, $1, '14:00', '15:00', '[\"ne-p1\"]', '[]', $2, $3)", [d0, me.id, tid]);
  await c.query("INSERT INTO meetings (id, project_id, event_id, title, meet_date, agenda, minutes, tenant_id, created_by) VALUES ('ne-m1', 'ne-p1', 'ne-e1', '노트화면 설계 회의', $1, $2, '납품 일정 확정', $3, $4)",
    [d0, JSON.stringify([{ text: '노트화면 납기 확인', done: false }]), tid, me.id]);
  await c.query("INSERT INTO meeting_action_items (id, meeting_id, title, assignee_id, assignee_name, due_date, status, tenant_id) VALUES ('ne-a1', 'ne-m1', '노트화면 견적서', $1, '관리자', $2, 'open', $3)", [me.id, kst(2), tid]);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function until(fn, arg, ms) { return page.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var ev = function (fn, arg) { return page.evaluate(fn, arg); };
  async function body(ref) { var r = (await c.query('SELECT body FROM my_notes WHERE user_id = $1 AND note_date = $2 AND ref = $3', [me.id, d0, ref || ''])).rows[0]; return r ? r.body : null; }
  async function typeRow(i, text) { await page.click('#mwNotes .mwn-t[data-i="' + i + '"]'); await page.keyboard.type(text); }
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { Object.keys(localStorage).filter(function (k) { return /^(mw|mtl)/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); } catch (_) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(400);
    await page.click('#tabMyWork');
    await page.waitForSelector('#mMyWork [data-mwn="open"]');
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 10000 }).catch(function () {});

    // 1. 평소엔 버튼 하나 — 열면 오른쪽 서랍
    check(await ev(function () { return !document.getElementById('mwNotes') || !document.getElementById('mwNotes').classList.contains('on'); }), '평소엔 노트 안 보임 (버튼 하나)');
    await page.click('#mMyWork [data-mwn="open"]');
    check(await until(function () { var n = document.getElementById('mwNotes'); return n && n.classList.contains('on') && /오늘/.test(n.querySelector('.mwn-date').textContent) && !!n.querySelector('.mwn-t'); }), '📝 노트 → 오른쪽 서랍 · 오늘');
    check(await ev(function () { return document.querySelector('#mMyWork [data-mwn="open"]').classList.contains('on'); }), '버튼 켜짐 표시');
    await wait(350);

    // 2. 줄 쓰기 · 자동 저장
    await typeRow(0, '견적 단가 다시 확인');
    await page.keyboard.press('Enter');
    await page.keyboard.type('고객사 담당 바뀜');
    check(await until(function () { return /저장됨/.test(document.getElementById('mwnSave').textContent); }, null, 5000), '잠깐 쉬면 자동 저장');
    check((await body('')) === '견적 단가 다시 확인\n고객사 담당 바뀜', 'Enter = 다음 줄로 저장 ' + JSON.stringify(await body('')));
    // Backspace 로 줄 합치기 · ↑
    await page.keyboard.press('Home'); await page.keyboard.press('Backspace');
    check(await ev(function () { return _mwn.rows.length === 1 && _mwn.rows[0].t === '견적 단가 다시 확인고객사 담당 바뀜'; }), '줄 앞에서 Backspace → 윗줄과 합침');
    await page.keyboard.press('Enter');
    check(await ev(function () { return _mwn.rows.length === 2 && _mwn.rows[0].t === '견적 단가 다시 확인' && _mwn.rows[1].t === '고객사 담당 바뀜'; }), '가운데서 Enter → 둘로 나눔');

    // 3. '- [ ] ' 로 쓰면 저절로 할 일, ➜ 로 할 일
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await page.keyboard.type('- [ ] 노트 샘플 발송');
    await page.keyboard.press('Enter');
    check(await until(function () { return _mwn.rows.some(function (r) { return r.t === '노트 샘플 발송' && typeof r.todo === 'string'; }); }), "'- [ ] ' + Enter → 할 일로 (✓)");
    check((await c.query("SELECT 1 FROM my_todos WHERE title = '노트 샘플 발송' AND user_id = $1", [me.id])).rows.length === 1, '할 일 저장');
    await page.keyboard.type('내일 !높음 노트 견적 회신');
    var upI = await ev(function () { return _mwn.rows.length - 1; });
    await page.click('#mwNotes [data-up="' + upI + '"]');
    check(await until(function () { return _mwn.rows.some(function (r) { return r.t === '내일 !높음 노트 견적 회신' && typeof r.todo === 'string'; }); }), '➜ → 할 일로');
    var tq = (await c.query("SELECT due_date, priority, memo FROM my_todos WHERE title = '노트 견적 회신' AND user_id = $1", [me.id])).rows[0];
    check(tq && tq.due_date === kst(1) && tq.priority === 2 && /노트에서/.test(tq.memo), '한 줄 읽기 — 내일 · 높음 · 메모에 출처 ' + JSON.stringify(tq));
    check(await until(function () { return Array.from(document.querySelectorAll('#mMyWork .mw-title')).some(function (x) { return x.textContent === '노트 견적 회신'; }); }), '목록에도 바로');
    await wait(900);
    check(/- \[x\] 노트 샘플 발송 ⟦todo-/.test(await body('')), '노트엔 ✓ 로 남음 (할 일 연결)');
    // ✓ 누르면 그 할 일 패널 (노트는 닫힘 — 같은 자리)
    await page.click('#mwNotes .mwn-ok');
    check(await until(function () { var p = document.getElementById('mwPanel'); return p && p.classList.contains('on') && !document.getElementById('mwNotes').classList.contains('on'); }), '✓ → 할 일 패널 (노트 서랍은 닫힘)');
    await wait(350);
    await page.click('#mwPanel [data-p="close"]');

    // 4. 그날 회의 → 회의 메모 · 회의록 요약
    await page.click('#mMyWork [data-mwn="open"]');
    await page.waitForSelector('#mwNotes.on .mwn-mtr');
    await wait(350);   // 서랍이 미끄러져 들어오는 중엔 누르기가 빗나감
    check(await ev(function () { return /14:00/.test(document.querySelector('#mwNotes .mwn-mtr').textContent) && /노트화면 설계 회의/.test(document.querySelector('#mwNotes .mwn-mtr').textContent); }), '🤝 그날 회의 한 줄');
    await page.click('#mwNotes .mwn-mtr');
    check(await until(function () { return _mwn.ref === 'ev:ne-e1' && /노트화면 납기 확인/.test(document.getElementById('mwnBrief').textContent) && /노트화면 견적서/.test(document.getElementById('mwnBrief').textContent) && !!document.querySelector('#mwNotes [data-om]'); }), '회의 메모 — 회의록 요약(안건 · 내 액션) · [회의록 열기]');
    await typeRow(0, '결정: 다음 주 납품');
    check(await until(function () { return /저장됨/.test(document.getElementById('mwnSave').textContent); }, null, 5000) && (await body('ev:ne-e1')) === '결정: 다음 주 납품', '회의 메모는 따로 저장');
    await page.click('#mwNotes [data-n="back"]');
    check(await until(function () { return !_mwn.ref && /메모 1줄/.test(document.querySelector('#mwNotes .mwn-mtr').textContent); }), '‹ 그날 노트로 · 회의 줄에 메모 1줄');

    // 5. 날짜 이동 · 노트 점
    await page.click('#mwNotes [data-n="prev"]');
    check(await until(function (d) { return _mwn.date === d && /어제/.test(document.querySelector('#mwNotes .mwn-date').textContent) && _mwn.rows.length === 1 && !_mwn.rows[0].t; }, kst(-1)), '‹ → 어제 (빈 노트)');
    await page.click('#mwNotes [data-n="today"]');
    await until(function (d) { return _mwn.date === d && _mwn.rows.length > 2; }, d0);
    check(await ev(function (d) { return !!document.querySelector('#mwTimeline .mtl-nd[data-nd="' + d + '"]') && !!document.querySelector('#mwTimeline .mtl-cd.has-note[data-cd="' + d + '"]') && document.querySelector('#mMyWork [data-mwn="open"]').classList.contains('has'); }, d0), '노트 있는 날 — 타임라인 · 달력 점 · 버튼 점');

    // 6. 🔗 연동 — 타임라인에서 날짜 고르면 노트도
    await ev(function (d) { _mtlMain.goDate(d, true); }, kst(3));
    check(await until(function (d) { return _mwn.date === d; }, kst(3)), '연동 — 타임라인에서 고른 날로 노트가 따라감');
    await page.click('#mwNotes [data-n="today"]');

    // 7. 회의 미리보기 카드 (타임라인 회의 일정에 마우스)
    await page.click('#mwNotes [data-n="close"]');
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }).catch(function () {});
    await ev(function () { _mtlMain.st.center = null; _mtlMain.update(); });
    var mb = await ev(function () { var x = Array.from(document.querySelectorAll('#mwTimeline .mtl-it')).filter(function (e) { return /노트화면 설계 회의/.test(e.textContent); })[0]; if (!x) return null; var sc = _mtlMain.sc, lr = x.closest('.mtl-lane'); sc.scrollTop = Math.max(0, lr.offsetTop - 40); var r = x.getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height / 2 }; });
    if (mb) { await page.mouse.move(mb.x, mb.y); }
    check(mb && await until(function () { var c = document.getElementById('mwnCard'); return c && c.style.display === 'block' && /노트화면 납기 확인/.test(c.textContent) && !!c.querySelector('[data-cm="open"]'); }), '회의 일정에 마우스 → 회의록 미리보기 카드');
    await page.screenshot({ path: path.join(SHOT, 'notes-card.png') });
    if (mb) {
      var cm = await ev(function () { var b = document.querySelector('#mwnCard [data-cm="memo"]').getBoundingClientRect(); return { x: b.left + 5, y: b.top + 5 }; });
      await page.mouse.move(cm.x, cm.y); await page.mouse.click(cm.x, cm.y);
      check(await until(function () { return _mwn.open && _mwn.ref === 'ev:ne-e1'; }), '카드 [📝 메모] → 그 회의 메모');
    }

    // 8. 검색
    if (!(await ev(function () { return _mwn.open; }))) await ev(function () { mwNotesOpen(); });
    await wait(400);
    await page.click('#mwNotes [data-n="find"]');
    await page.waitForSelector('#mwnQ');
    await page.type('#mwnQ', '샘플');
    await page.keyboard.press('Enter');
    check(await until(function () { var f = document.querySelectorAll('#mwnFound .mwn-fi'); return f.length === 1 && /노트 샘플 발송/.test(f[0].textContent); }), '🔍 검색 — 맞은 줄');
    await page.screenshot({ path: path.join(SHOT, 'notes.png') });
    await page.click('#mwnFound .mwn-fi');
    check(await until(function () { return !_mwn.find && !_mwn.ref; }), '결과 누르면 그 노트로');

    // 9. 패널과 하나만 · Esc
    await page.keyboard.press('Escape');
    check(await until(function () { return !_mwn.open; }), 'Esc → 닫힘');
    await page.click('#mMyWork [data-mwn="open"]');
    await until(function () { return _mwn.open; });
    await ev(function () { mwPanelOpen(_mw.data.data.filter(function (x) { return x.src === 'todo'; })[0]); });
    check(await until(function () { return !_mwn.open && document.getElementById('mwPanel').classList.contains('on'); }), '상세 패널을 열면 노트는 닫힘 (같은 자리)');
    await ev(function () { mwPanelClose(); });

    // 10. 휴대폰 — 서랍이 화면 전체
    await page.setViewport({ width: 390, height: 860, isMobile: true, hasTouch: true });
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    if (!(await page.$('#mMyWork [data-mwn="open"]'))) await page.click('#tabMyWork').catch(function () {});
    await page.waitForSelector('#mMyWork [data-mwn="open"]');
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 10000 }).catch(function () {});
    await ev(function () { mwNotesOpen(); });
    check(await until(function () { var n = document.getElementById('mwNotes'); return n && n.classList.contains('on') && Math.abs(n.getBoundingClientRect().width - window.innerWidth) < 2; }), '휴대폰 — 노트가 화면 전체');
    check(await ev(function () { return document.documentElement.scrollWidth <= window.innerWidth + 1; }), '휴대폰 — 가로 스크롤 없음');
    await page.screenshot({ path: path.join(SHOT, 'notes-mobile.png') });
    check(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) {
    fail++; console.log('FAIL', e.message);
    await page.screenshot({ path: path.join(SHOT, 'notes-fail.png') }).catch(function () {});
  } finally {
    await browser.close();
    await clean();
    await c.end();
  }
  console.log(fail ? '\nFAIL ' + fail + ' / ok ' + ok : '\nALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERR', e.message, e.stack); process.exit(1); });
