// 🎯 내 업무 점검 (v13.275) — 머리 숫자 → 묶음 · 긴 묶음 더 보기 · 마일스톤 이름 · 옆 달력 오늘 달 · 색 하나
//    · 패널 옮길 때 저장 대상 · 프로젝트 패널도 · 노트 차례 저장 · 남의 할 일 안 열림 · 휴대폰 줄 이름 폭
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
  async function clean() {
    await c.query("DELETE FROM my_todos WHERE user_id = $1 AND title LIKE '점검%'", [me.id]);
    await c.query("DELETE FROM my_projects WHERE user_id = $1 AND title LIKE '점검%'", [me.id]);
  }
  await clean();
  // 지연 20개 — 더 보기 확인용
  for (var i = 0; i < 20; i++) {
    await c.query("INSERT INTO my_todos (id, tenant_id, user_id, title, due_date) VALUES ($1, $2, $3, $4, $5)", ['mtp-' + i, me.tenant_id, me.id, '점검 지연 ' + String(i).padStart(2, '0'), kst(-3)]);
  }
  await c.query("INSERT INTO my_todos (id, tenant_id, user_id, title, due_date) VALUES ('mtp-a', $1, $2, '점검 A', $3), ('mtp-b', $1, $2, '점검 B', $3)", [me.tenant_id, me.id, kst(5)]);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function until(fn, arg, ms) { return page.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var ev = function (fn, arg) { return page.evaluate(fn, arg); };
  async function idle() { await page.waitForNetworkIdle({ idleTime: 300, timeout: 8000 }).catch(function () {}); }
  async function title(id) { return (await c.query('SELECT title FROM my_todos WHERE id = $1', [id])).rows[0].title; }
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { Object.keys(localStorage).filter(function (k) { return /^(mw|mtl)/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); } catch (_) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await page.click('#tabMyWork');
    await page.waitForSelector('#mwAdd'); await idle();
    await ev(function () { var b = document.querySelector('[data-mwc-view="list"]'); if (b) b.click(); }); await idle();

    // 1. 긴 묶음 — 15줄 + 더 보기
    var late = await ev(function () { var s = document.querySelector('.mw-grp[data-grp="late"]'); return { rows: s.querySelectorAll('.mw-row').length, more: (s.querySelector('[data-mw-more]') || {}).textContent }; });
    check(late.rows === 15 && /개 더 보기/.test(late.more || ''), '지연 묶음 15줄 + 더 보기 ' + JSON.stringify(late));
    await ev(function () { document.querySelector('[data-mw-more="late"]').click(); });
    check(await until(function () { var s = document.querySelector('.mw-grp[data-grp="late"]'); return s.querySelectorAll('.mw-row').length >= 20 && !s.querySelector('[data-mw-more]'); }), '더 보기 → 전부');

    // 2. 머리 숫자 → 접힌 묶음 펴고 그리로
    await ev(function () { var s = document.querySelector('.mw-grp[data-grp="late"] [data-fold]'); s.click(); });
    check(await ev(function () { return document.querySelector('.mw-grp[data-grp="late"]').classList.contains('mw-folded'); }), '지연 접음');
    await ev(function () { window.scrollTo(0, 0); document.querySelector('[data-mw-jump="late"]').click(); });
    check(await until(function () { var s = document.querySelector('.mw-grp[data-grp="late"]'); return !s.classList.contains('mw-folded'); }), '지연 숫자 누르면 펴짐');
    check(await until(function () { var r = document.querySelector('.mw-grp[data-grp="late"]').getBoundingClientRect(); return r.top < 300 && r.top > -50; }, null, 3000), '그 묶음으로 옮겨 감');
    check(await ev(function () { return document.querySelector('[data-mw-jump="today"]').tagName === 'BUTTON'; }), '오늘 · 이번 주도 단추');

    // 3. 마일스톤 이름 · 색 하나
    check(await ev(function () { return MW_SRC.milestone.label === '마일스톤' && typeof MWC_SRC_COLOR === 'undefined' && typeof MWT_SRC_COLOR === 'undefined' && mwSrcColor('issue') === MW_SRC.issue.color; }), '마일스톤 이름 · 색 MW_SRC 한 곳');
    check(await ev(function () { return typeof mwToday === 'function' && mwToday() === _mw.data.today && typeof _mtlToday === 'undefined' && typeof _mwcToday === 'undefined'; }), '오늘 함수 하나');

    // 4. 옆 달력 — 오늘이 보이면 오늘의 달
    var cal = await ev(function () {
      var tl = _mtlMain; if (!tl || !tl.sc) return null;
      tl.calMonth = null; tl.pick = null;
      var v = tl.view(), tn = _mtlNum(mwToday());
      return { inView: tn >= v.n0 && tn < v.n1, base: tl.calBase(), today: mwToday().slice(0, 7) };
    });
    check(cal && (!cal.inView || cal.base === cal.today), '옆 달력 기준 달 ' + JSON.stringify(cal));
    var far = await ev(function () { var tl = _mtlMain; tl.st.center = _mtlNum(mwToday()) + 120; tl.update(); var r = tl.calBase(); tl.st.center = null; tl.update(); return { r: r, back: tl.calBase(), today: mwToday().slice(0, 7) }; });
    check(far.r !== far.today && far.back === far.today, '오늘이 안 보이면 가운데 달 · 오늘 누르면 돌아옴 ' + JSON.stringify(far));

    // 5. 패널 — 저장 기다리는 중에 다른 항목으로 옮겨도 각자 자리에
    await ev(function () { mwPanelOpen(_mwFind('todo:mtp-a')); });
    await page.waitForSelector('#mwPanel');
    await ev(function () { _mwpQueue({ title: '점검 A 고침' }, 5000); mwPanelOpen(_mwFind('todo:mtp-b')); _mwpQueue({ title: '점검 B 고침' }, 0); });
    await idle(); await wait(400);
    check(await title('mtp-a') === '점검 A 고침' && await title('mtp-b') === '점검 B 고침', '옮겨도 A · B 각자 저장 (' + await title('mtp-a') + ' / ' + await title('mtp-b') + ')');
    // 저장 중(inflight)에 옮기기
    await ev(function () { mwPanelOpen(_mwFind('todo:mtp-a')); _mwpQueue({ title: '점검 A 둘째' }, 0); mwPanelOpen(_mwFind('todo:mtp-b')); _mwpQueue({ title: '점검 B 둘째' }, 0); });
    await idle(); await wait(400);
    check(await title('mtp-a') === '점검 A 둘째' && await title('mtp-b') === '점검 B 둘째', '저장 중에 옮겨도 (' + await title('mtp-a') + ' / ' + await title('mtp-b') + ')');
    // 닫을 때 남은 것
    await ev(function () { mwPanelOpen(_mwFind('todo:mtp-a')); _mwpQueue({ title: '점검 A 닫기' }, 5000); mwPanelClose(); });
    await idle(); await wait(400);
    check(await title('mtp-a') === '점검 A 닫기', '닫으면 남은 것 저장');

    // 6. 프로젝트 패널 — 같은 경우
    await ev(function () { return Promise.all(['점검 P1', '점검 P2'].map(function (t) { return apiFetch('/api/my-work/projects', { method: 'POST', body: JSON.stringify({ title: t }) }); })); });
    var rows = (await c.query("SELECT id, title FROM my_projects WHERE user_id = $1 AND title LIKE '점검 P%' ORDER BY title", [me.id])).rows;
    await ev(function () { renderMyWork(); });
    await idle();
    var have = await ev(function (ids) { return ids.every(function (id) { return !!mwProjById(id); }); }, rows.map(function (r) { return r.id; }));
    if (have) {
      await ev(function (ids) { mwProjOpen(ids[0]); _mwjQueue({ title: '점검 P1 고침' }, 0); mwProjOpen(ids[1]); _mwjQueue({ title: '점검 P2 고침' }, 0); }, rows.map(function (r) { return r.id; }));
      await idle(); await wait(400);
      var after = (await c.query("SELECT title FROM my_projects WHERE id = ANY($1) ORDER BY title", [rows.map(function (r) { return r.id; })])).rows.map(function (r) { return r.title; });
      check(after.join('|') === '점검 P1 고침|점검 P2 고침', '프로젝트 패널 옮겨도 각자 저장 ' + after.join('|'));
      await ev(function () { mwProjClose(); });
    } else check(false, '프로젝트 목록에 새 프로젝트 ' + JSON.stringify(rows));

    // 7. 남의 개인 할 일 — 안 열림
    var other = await ev(function () { var shown = []; var orig = _mwToast; _mwToast = function (m) { shown.push(m); }; mwOpenItem({ src: 'todo', id: 'x', key: 'todo:x', userId: 'someone-else', title: '개인 할 일' }); _mwToast = orig; return { msg: shown[0] || '', panel: !!document.querySelector('#mwPanel.open, #mwPanel.is-open') }; });
    check(/다른 사람/.test(other.msg), '남의 할 일 → 안내 ' + other.msg);

    // 8. 아이콘 이스케이프 — 칸 아이콘에 태그

    // 9. 휴대폰 — 줄 이름 폭
    // 마지막 상태 (v13.286) — 출처 칩 · 열린 상세 패널을 새로고침해도 · 다른 탭에 갔다 와도 그대로
    await ev(function () { mwPanelClose(); var c = document.querySelector('#mMyWork [data-src="todo"]') || document.querySelector('#mMyWork [data-src]:not([data-src="all"])'); if (c) c.click(); });
    await wait(200);
    var src0 = await ev(function () { return _mw.src; });
    await ev(function () { var it = _mwFind('todo:mtp-a'); mwPanelOpen(it); window.scrollTo(0, 200); document.body.click(); });
    await wait(700);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    var rs = await until(function (s) { return curPage === 'mywork' && _mw.src === s && typeof mwPanelIsOpen === 'function' && mwPanelIsOpen() && _mw.sel === 'todo:mtp-a'; }, src0, 10000);
    check(src0 !== 'all' && rs, '새로고침 — 출처 칩 · 상세 패널 그대로 ' + src0);
    await ev(function () { setPage('project'); }); await wait(400);
    check(await ev(function () { return !mwPanelIsOpen(); }), '다른 탭 — 패널 닫힘');
    await ev(function () { setPage('mywork'); });
    check(await until(function (s) { return _mw.src === s && mwPanelIsOpen() && _mw.sel === 'todo:mtp-a'; }, src0, 8000), '다시 오면 패널 · 칩 그대로');
    await ev(function () { mwPanelClose(); document.querySelector('#mMyWork [data-src="all"]').click(); }); await wait(600);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(1500);
    check(await ev(function () { return _mw.src === 'all' && !mwPanelIsOpen(); }), '닫고 전체로 바꾼 뒤 새로고침 — 그대로 닫힘 · 전체');

    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); await idle(); await wait(500);
    await ev(function () { _mwPaint(); }); await wait(300);
    var w = await ev(function () { var l = document.querySelector('#mMyWork .mtl-ln'); return { L: _mtlMain.L, w: l ? l.getBoundingClientRect().width : 0 }; });
    check(w.L === 92 && Math.abs(w.w - 92) < 2, '휴대폰 줄 이름 92 ' + JSON.stringify(w));
    check(await ev(function () { var z = document.querySelector('#mMyWork .mw-prog.is-zero'); return !z || getComputedStyle(z).display === 'none'; }), '휴대폰 0% 숨김');
    await page.screenshot({ path: path.join(SHOT, 'e2e39-mobile.png') });

    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  await clean();
  await browser.close(); await c.end();
  console.log(fail ? fail + ' FAIL' : 'ALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})();
