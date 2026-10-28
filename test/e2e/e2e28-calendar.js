// 🎯 내 업무 달력 화면 — 주 · 월 보기 · 빈 시간 칸 눌러 일정 등록 · 끌어서 마감/일정 옮기기 · 구독 창 · 달력 탭 시각 입력 · 휴대폰 폭 (v13.252)
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
/** 이번 주 안에서 오늘이 아닌 날 (월~일) */
function otherDayThisWeek() {
  var t = kst(0), w = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7;
  return kst(w === 6 ? -1 : 1);
}
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var me = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var tid = me.tenant_id;
  await c.query('DELETE FROM my_todos WHERE user_id = $1', [me.id]);
  await c.query("DELETE FROM mindmaps WHERE title LIKE '내업무%'");   // 앞 시험(e2e24)의 맵 주제가 같은 날 칸을 채우지 않게
  await c.query("DELETE FROM events WHERE title LIKE '화면%'");
  await c.query("DELETE FROM issues WHERE id LIKE 'cwu-%'");
  await c.query("DELETE FROM projects WHERE id LIKE 'cwu-%'");
  await c.query('DELETE FROM calendar_feeds WHERE user_id = $1', [me.id]);
  await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('cwu-p1', '달력화면 프로젝트', 'active', 'tenant', $1, $2)", [me.id, tid]);
  await c.query("INSERT INTO issues (id, project_id, title, status, urgency, due_date, assignees, tenant_id) VALUES ('cwu-i1', 'cwu-p1', '화면 이슈', 'open', 'normal', $1, '[\"관리자\"]', $2)", [kst(0), tid]);
  await c.query("INSERT INTO events (id, title, type, start_date, end_date, start_time, end_time, project_ids, assignees, created_by, tenant_id) VALUES ('evt-cwu1', '화면 회의', 'meeting', $1, $1, '10:00', '11:30', '[]', '[]', $2, $3)", [kst(0), me.id, tid]);
  await c.query("INSERT INTO events (id, title, type, start_date, end_date, start_time, end_time, project_ids, assignees, created_by, tenant_id) VALUES ('evt-cwu2', '화면 겹침', 'etc', $1, $1, '10:30', '11:00', '[]', '[]', $2, $3)", [kst(0), me.id, tid]);
  await c.query("INSERT INTO events (id, title, type, start_date, end_date, project_ids, assignees, created_by, tenant_id) VALUES ('evt-cwu3', '화면 출장', 'trip', $1, $2, '[]', '[]', $3, $4)", [kst(0), kst(1), me.id, tid]);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  /** HTML5 끌어 놓기 흉내 — 같은 DataTransfer 로 dragstart → dragover → drop → dragend */
  async function dnd(srcSel, dstSel, dy) {
    return page.evaluate(function (s, d, dy) {
      var src = document.querySelector(s), dst = document.querySelector(d);
      if (!src || !dst) return 'missing ' + (!src ? s : d);
      var dt = new DataTransfer(), r = src.getBoundingClientRect(), q = dst.getBoundingClientRect();
      var at = function (t, el, x, y) { el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y })); };
      at('dragstart', src, r.left + 5, r.top + 5);
      var y = q.top + (dy == null ? q.height / 2 : dy) + 5;
      at('dragover', dst, q.left + 10, y);
      at('drop', dst, q.left + 10, y);
      at('dragend', src, q.left + 10, y);
      return 'ok';
    }, srcSel, dstSel, dy);
  }
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { localStorage.removeItem('mw-view'); } catch (_) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    await page.click('#tabMyWork');
    await page.waitForSelector('#mMyWork .mwc-seg');
    // 목록 — 오늘 일정 띠
    check(await page.evaluate(function () { var b = document.querySelector('#mMyWork .mwc-todaybar'); return !!b && /10:00/.test(b.textContent) && /화면 회의/.test(b.textContent) && /화면 출장/.test(b.textContent); }), '목록 위 오늘 일정 띠 (시각 순)');
    // 주 보기
    await page.click('#mMyWork [data-mwc-view="week"]');
    await page.waitForSelector('#mMyWork .mwc-week');
    var wk = await page.evaluate(function (today) {
      var col = document.querySelector('.mwc-tcol[data-tday="' + today + '"]');
      var blk = Array.from(col.querySelectorAll('.mwc-blk')).map(function (b) { return { t: b.textContent, top: parseFloat(b.style.top), h: parseFloat(b.style.height), w: b.style.width }; });
      var ad = document.querySelector('.mwc-ad[data-day="' + today + '"]').textContent;
      return { blk: blk, ad: ad, scroll: document.getElementById('mwcTScroll').scrollTop, now: !!col.querySelector('.mwc-now') };
    }, kst(0));
    var mtg = wk.blk.filter(function (b) { return /화면 회의/.test(b.t); })[0];
    check(mtg && mtg.top === 10 * 44 && Math.round(mtg.h) === 64, '10:00~11:30 블록 자리 · 높이 ' + JSON.stringify(mtg));
    check(wk.blk.length === 2 && wk.blk.every(function (b) { return /50%/.test(b.w); }), '겹치는 두 일정은 나란히 (반씩)');
    check(/화면 이슈/.test(wk.ad) && /화면 출장/.test(wk.ad), '종일 칸 — 할 일 · 이틀 출장');
    check(wk.scroll > 300 && wk.now, '시간 칸은 08시부터 보임 · 지금 선');
    await page.screenshot({ path: path.join(SHOT, 'mywork-week.png') });

    // 빈 시간 칸 누르기 → 개인 일정 (그 시각)
    var other = otherDayThisWeek();
    await page.evaluate(function (d) {
      var col = document.querySelector('.mwc-tcol[data-tday="' + d + '"]'), r = col.getBoundingClientRect();
      document.getElementById('mwcTScroll').scrollTop = 14 * 44 - 100;
      r = col.getBoundingClientRect();
      col.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 10, clientY: r.top + 14 * 44 + 10 }));
    }, other);
    // v13.253 — 빈 칸은 종류별 등록 창 (시간 칸 = 기타 일정)
    await page.waitForSelector('#mwRegModal #mwrTitle');
    await wait(200);
    var q = await page.evaluate(function () { return { k: document.querySelector('#mwrKinds .on').getAttribute('data-k'), t1: document.getElementById('mwrT1').value, t2: document.getElementById('mwrT2').value, focus: document.activeElement && document.activeElement.id }; });
    check(q.k === 'etc' && q.t1 === '14:00' && q.t2 === '15:00' && q.focus === 'mwrTitle', '시간 칸 → 일정 · 14:00~15:00 · 제목에 커서 ' + JSON.stringify(q));
    await page.type('#mwrTitle', '화면 새 일정');
    await page.click('#mwrForm button[type=submit]');
    await page.waitForFunction(function (d) { var col = document.querySelector('.mwc-tcol[data-tday="' + d + '"]'); return col && /화면 새 일정/.test(col.textContent) && !document.getElementById('mwRegModal'); }, { timeout: 8000 }, other);
    var ne = (await c.query("SELECT start_date, start_time, end_time, project_ids FROM events WHERE title = '화면 새 일정'")).rows[0];
    check(ne && ne.start_date === other && ne.start_time === '14:00' && ne.end_time === '15:00' && ne.project_ids.length === 0, '개인 일정 저장 (프로젝트 없음) ' + JSON.stringify(ne));

    // 종일 칸 누르기 → 할 일
    await page.evaluate(function (d) { document.querySelector('.mwc-ad[data-day="' + d + '"]').click(); }, other);
    await page.waitForSelector('#mwRegModal #mwrTitle');
    check(await page.evaluate(function () { return document.querySelector('#mwrKinds .on').getAttribute('data-k') === 'todo' && !document.getElementById('mwrT1').value; }), '종일 칸 → 할 일 (시각 없음)');
    await page.type('#mwrTitle', '화면 새 할 일');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function (d) { var x = document.querySelector('.mwc-ad[data-day="' + d + '"]'); return x && /화면 새 할 일/.test(x.textContent); }, { timeout: 8000 }, other);
    check((await c.query("SELECT due_date FROM my_todos WHERE title = '화면 새 할 일'")).rows[0].due_date === other, '할 일 마감 = 누른 날');

    // 끌어서 — 이슈 마감 옮기기
    var issueKey = await page.evaluate(function () { return Object.keys(_mwc.map).filter(function (k) { return /cwu-i1/.test(k); })[0]; });
    var r1 = await dnd('[data-ck="' + issueKey + '"]', '.mwc-ad[data-day="' + other + '"]');
    await page.waitForFunction(function (d) { return /화면 이슈/.test(document.querySelector('.mwc-ad[data-day="' + d + '"]').textContent); }, { timeout: 8000 }, other).catch(function () {});
    check(r1 === 'ok' && (await c.query("SELECT due_date FROM issues WHERE id = 'cwu-i1'")).rows[0].due_date === other, '이슈를 다른 날로 끌기 → 원래 이슈 마감 바뀜');
    // 끌어서 — 시각 일정 옮기기 (다른 날 16:00)
    await page.evaluate(function () { document.getElementById('mwcTScroll').scrollTop = 0; });
    var r2 = await dnd('.mwc-tcol[data-tday="' + kst(0) + '"] [data-ck^="e|evt-cwu1"]', '.mwc-tcol[data-tday="' + other + '"]', 16 * 44);
    await page.waitForFunction(function (d) { return /화면 회의/.test(document.querySelector('.mwc-tcol[data-tday="' + d + '"]').textContent); }, { timeout: 8000 }, other).catch(function () {});
    var mv = (await c.query("SELECT start_date, start_time, end_time FROM events WHERE id = 'evt-cwu1'")).rows[0];
    check(r2 === 'ok' && mv.start_date === other && mv.start_time === '16:00' && mv.end_time === '17:30', '일정 끌기 → 날짜 · 16:00 · 길이 그대로 ' + JSON.stringify(mv));
    await page.screenshot({ path: path.join(SHOT, 'mywork-week2.png') });

    // 일정 누르기 → 편집 창 (시각 칸) → 시각 바꿔 저장 → 내 업무 달력 다시 그림
    await page.evaluate(function () { document.querySelector('[data-ck^="e|evt-cwu1"]').click(); });
    await page.waitForSelector('#evtModal #evtStartTime');
    check(await page.evaluate(function () { return document.getElementById('evtStartTime').value === '16:00' && document.getElementById('evtEndTime').value === '17:30'; }), '편집 창에 시각');
    await page.evaluate(function () { document.getElementById('evtStartTime').value = '08:00'; document.getElementById('evtEndTime').value = '09:00'; });
    await page.click('#evtModal .btn-p');
    await page.waitForFunction(function () { return !document.getElementById('evtModal') && Array.from(document.querySelectorAll('.mwc-blk')).some(function (b) { return /08:00~09:00/.test(b.textContent); }); }, { timeout: 8000 });
    check(true, '편집 창 저장 → 내 업무 달력에 바로 반영');

    // 월 보기
    await page.click('#mMyWork [data-mwc-view="month"]');
    await page.waitForSelector('#mMyWork .mwc-month');
    var mo = await page.evaluate(function (d) {
      var cells = document.querySelectorAll('.mwc-md');
      var cell = document.querySelector('.mwc-md[data-day="' + d + '"]');
      return { n: cells.length, today: !!document.querySelector('.mwc-md.is-today'), txt: cell && cell.textContent };
    }, other);
    check(mo.n === 42 && mo.today && /08:00/.test(mo.txt) && /화면 새 할 일/.test(mo.txt), '월 보기 42칸 · 오늘 · 시각 표시 ' + JSON.stringify(mo));
    await page.click('#mMyWork [data-mwc-nav="1"]');
    await wait(400);
    var lbl = await page.evaluate(function () { return document.querySelector('.mwc-label').textContent; });
    await page.click('#mMyWork [data-mwc-nav="0"]');
    await wait(400);
    var lbl0 = await page.evaluate(function () { return document.querySelector('.mwc-label').textContent; });
    check(lbl !== lbl0 && lbl0 === (+kst(0).slice(0, 4)) + '년 ' + (+kst(0).slice(5, 7)) + '월', '다음 달 → 오늘 ' + lbl + ' / ' + lbl0);
    await page.screenshot({ path: path.join(SHOT, 'mywork-month.png') });
    // 거르기 — 일정만
    await page.click('#mMyWork .mw-chip[data-src="event"]');
    check(await page.evaluate(function () { return document.querySelectorAll('.mwc-chip.mwc-task').length === 0 && document.querySelectorAll('.mwc-chip.mwc-evt').length > 0; }), '📅 일정 칩 → 일정만');
    await page.click('#mMyWork .mw-chip[data-src="all"]');
    // 보기 기억
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await page.click('#tabMyWork');
    await page.waitForSelector('#mMyWork .mwc-month', { timeout: 8000 });
    check(true, '새로 열어도 월 보기 그대로');

    // 구독 창
    await page.click('#mMyWork [data-mwc="feed"]');
    await page.waitForSelector('#mwcFeedModal [data-f="new"]');
    await page.click('#mwcFeedModal [data-f="new"]');
    await page.waitForSelector('#mwcFeedModal #mwcFeedUrl');
    var url = await page.evaluate(function () { return document.getElementById('mwcFeedUrl').value; });
    var ics = await (await fetch(url)).text();
    check(/\/api\/ics\/[a-f0-9]{48}\.ics$/.test(url) && /BEGIN:VCALENDAR/.test(ics) && /화면 새 일정/.test(ics.replace(/\r\n /g, '')), '구독 주소 만들기 → .ics 받아짐');
    await page.screenshot({ path: path.join(SHOT, 'mywork-feed.png') });
    await page.keyboard.press('Escape');
    await wait(200);

    // 프로젝트 › 달력 탭 — 칩에 시각 · 등록 창에 시각 칸
    await page.evaluate(function () { setPage('project'); setMode('calendar'); });
    await page.waitForFunction(function () { return Array.from(document.querySelectorAll('#calGrid .calm-chip')).some(function (x) { return /08:00/.test(x.textContent) && /화면 회의/.test(x.textContent); }); }, { timeout: 8000 })
      .then(function () { check(true, '달력 탭 칩에 시각 (08:00 화면 회의)'); }, function () { check(false, '달력 탭 칩에 시각'); });
    await page.evaluate(function () { showEventModal(null, null); });
    await page.waitForSelector('#evtModal #evtStartTime');
    await page.type('#evtTitle', '화면 달력탭 일정');
    await page.evaluate(function () { document.getElementById('evtStartTime').value = '15:00'; document.getElementById('evtEndTime').value = '14:00'; });
    await page.click('#evtModal .btn-p');
    await wait(400);
    check(await page.evaluate(function () { return !!document.getElementById('evtModal'); }) && !(await c.query("SELECT 1 FROM events WHERE title = '화면 달력탭 일정'")).rows.length, '끝 시각이 앞서면 저장 안 됨');
    await page.evaluate(function () { document.getElementById('evtEndTime').value = '16:00'; });
    await page.click('#evtModal .btn-p');
    await page.waitForFunction(function () { return !document.getElementById('evtModal'); }, { timeout: 8000 });
    var ct = (await c.query("SELECT start_time, end_time FROM events WHERE title = '화면 달력탭 일정'")).rows[0];
    check(ct && ct.start_time === '15:00' && ct.end_time === '16:00', '달력 탭에서 시각 넣어 저장');
    await page.click('#tabMyWork');
    await page.waitForSelector('#mMyWork .mwc-month', { timeout: 8000 });
    await page.waitForFunction(function () { return /화면 달력탭 일정/.test(document.getElementById('mMyWork').textContent); }, { timeout: 8000 })
      .then(function () { check(true, '다른 탭에서 만든 일정이 내 업무 달력에 보임'); }, function () { check(false, '다른 탭에서 만든 일정이 내 업무 달력에 보임'); });

    // 어두운 테마 그림 (눈으로 확인용)
    var theme = await page.evaluate(function () { var t = document.documentElement.getAttribute('data-theme'); document.documentElement.setAttribute('data-theme', 'dark'); return t; });
    await page.click('#mMyWork [data-mwc-view="week"]');
    await page.waitForSelector('#mMyWork .mwc-week');
    await wait(300);
    await page.screenshot({ path: path.join(SHOT, 'mywork-week-dark.png') });
    await page.evaluate(function (t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }, theme);

    // 휴대폰 폭 — 가로 스크롤 없음
    await page.setViewport({ width: 390, height: 800 });
    await page.click('#mMyWork [data-mwc-view="week"]');
    await page.waitForSelector('#mMyWork .mwc-week');
    await wait(300);
    check(await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth + 1; }), '휴대폰 폭 주 보기 — 가로 스크롤 없음');
    await page.screenshot({ path: path.join(SHOT, 'mywork-week-mobile.png') });
    await page.click('#mMyWork [data-mwc-view="month"]');
    await wait(300);
    check(await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth + 1; }), '휴대폰 폭 월 보기 — 가로 스크롤 없음');
    await page.screenshot({ path: path.join(SHOT, 'mywork-month-mobile.png') });
    await page.setViewport({ width: 1400, height: 900 });
    await page.evaluate(function () { try { localStorage.removeItem('mw-view'); } catch (_) {} });

    check(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) {
    fail++; console.log('FAIL', e.message);
    await page.screenshot({ path: path.join(SHOT, 'calendar-fail.png') }).catch(function () {});
  } finally {
    await browser.close();
    await c.query("DELETE FROM events WHERE title LIKE '화면%'");
    await c.query('DELETE FROM my_todos WHERE user_id = $1', [me.id]);
    await c.query('DELETE FROM calendar_feeds WHERE user_id = $1', [me.id]);
    await c.end();
  }
  console.log(fail ? '\nFAIL ' + fail + ' / ok ' + ok : '\nALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERR', e.message, e.stack); process.exit(1); });
