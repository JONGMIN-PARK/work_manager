// 🎯 내 업무 달력 풍선 도움말 — 월 · 주(종일 · 시간 칸) 항목에 마우스를 올리면 제목 · 종류 · 기한/일시 · 장소 · 메모 (v13.278)
//   목록 줄 메모 미리보기(v13.276)도 같이 확인
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
    await c.query('DELETE FROM my_todos WHERE user_id = $1', [me.id]);
    await c.query("DELETE FROM events WHERE title LIKE '풍선%'");
  }
  await clean();
  await c.query("INSERT INTO my_todos (id, user_id, tenant_id, title, due_date, priority, memo) VALUES ('tip-1', $1, $2, '풍선 견적 회신', $3, 1, $4)",
    [me.id, tid, kst(0), '고객 담당 김과장\n단가표 첨부할 것']);
  await c.query("INSERT INTO events (id, title, type, start_date, end_date, start_time, end_time, location, memo, project_ids, assignees, created_by, tenant_id) " +
    "VALUES ('evt-tip1', '풍선 회의', 'meeting', $1, $1, '10:00', '11:00', '3층 회의실', '안건: 일정 조율', '[]', '[\"관리자\"]', $2, $3)", [kst(0), me.id, tid]);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function tip() { return page.evaluate(function () { var e = document.querySelector('.mw-memo-tip'); return e && !e.hidden ? e.textContent : ''; }); }
  async function hover(sel) {   // 올린 뒤 살짝 움직임 — page.hover 가 스크롤하면 풍선이 닫혔다가 움직이면 다시 뜸
    await page.mouse.move(5, 5); await wait(100); await page.hover(sel); await wait(100);
    var b = await (await page.$(sel)).boundingBox(); await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2);
    await wait(450); return tip();
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
    // 목록 — 메모 미리보기
    await page.click('#mMyWork [data-mwc-view="list"]').catch(function () {});
    await page.waitForSelector('#mMyWork .mw-row[data-key="todo:tip-1"]', { timeout: 8000 });
    var t0 = await hover('#mMyWork .mw-row[data-key="todo:tip-1"] .mw-title');
    check(/단가표 첨부할 것/.test(t0) && /김과장/.test(t0), '목록 줄 — 메모 미리보기 ' + JSON.stringify(t0));
    // 월 보기
    await page.click('#mMyWork [data-mwc-view="month"]');
    await page.waitForSelector('#mMyWork .mwc-month');
    var t1 = await hover('#mMyWork .mwc-month [data-ck="t|todo:tip-1"]');
    check(/풍선 견적 회신/.test(t1) && /기한/.test(t1) && /오늘/.test(t1) && /긴급/.test(t1) && /단가표/.test(t1), '월 — 할 일 풍선 (기한 · 오늘 · 긴급 · 메모) ' + JSON.stringify(t1));
    var t2 = await hover('#mMyWork .mwc-month [data-ck^="e|evt-tip1"]');
    check(/풍선 회의/.test(t2) && /10:00 ~ 11:00/.test(t2) && /3층 회의실/.test(t2) && /관리자/.test(t2) && /안건/.test(t2), '월 — 일정 풍선 (일시 · 장소 · 함께 · 메모) ' + JSON.stringify(t2));
    check(await page.evaluate(function () { return !document.querySelector('#mMyWork [data-ck][title]'); }), '달력 항목에 브라우저 title 이 겹쳐 뜨지 않음');
    await page.screenshot({ path: path.join(SHOT, 'cal-tip-month.png') });
    // 누르면 사라짐
    await page.mouse.down(); await page.mouse.up(); await wait(100);
    check(await tip() === '', '누르면 풍선 닫힘');
    await page.evaluate(function () { var b = Array.from(document.querySelectorAll('button')).filter(function (x) { return /닫기/.test(x.textContent) && x.offsetParent; })[0]; if (b) b.click(); });   // 눌러 열린 일정 편집 창 닫기
    await wait(400);
    // 주 보기 — 시간 칸 블록
    await page.click('#mMyWork [data-mwc-view="week"]');
    await page.waitForSelector('#mMyWork .mwc-week');
    var t3 = await hover('#mMyWork .mwc-tcol [data-ck^="e|evt-tip1"]');
    check(/풍선 회의/.test(t3) && /3층 회의실/.test(t3), '주 — 시간 칸 일정 풍선 ' + JSON.stringify(t3));
    var t4 = await hover('#mMyWork .mwc-ad [data-ck="t|todo:tip-1"]');
    check(/풍선 견적 회신/.test(t4), '주 — 종일 칸 할 일 풍선');
    await page.screenshot({ path: path.join(SHOT, 'cal-tip-week.png') });
    // 타임라인 옆 달력 (v13.279) — 날짜 칸: 그날 항목 목록 · 타임라인 막대: 항목 상세
    await page.waitForSelector('#mwTimeline .mtl-cal [data-cd="' + kst(0) + '"]');
    var t5 = await hover('#mwTimeline .mtl-cal [data-cd="' + kst(0) + '"]');
    check(/오늘/.test(t5) && /풍선 견적 회신/.test(t5) && /풍선 회의/.test(t5) && /10:00/.test(t5), '옆 달력 날짜 칸 — 그날 목록 ' + JSON.stringify(t5));
    check(await page.evaluate(function () { return !document.querySelector('#mwTimeline [data-cd][title], #mwTimeline [data-tk][title]'); }), '타임라인 · 옆 달력에 기본 title 겹침 없음');
    var t6 = await hover('#mwTimeline [data-tk="todo:tip-1"]');
    check(/기한/.test(t6) && /단가표/.test(t6), '타임라인 막대 — 할 일 상세 ' + JSON.stringify(t6));
    await page.screenshot({ path: path.join(SHOT, 'cal-tip-tl.png') });
    // '오늘' 버튼 — 다른 날을 골라 둔 뒤 누르면 달력 아래 목록이 오늘로
    await page.evaluate(function (d) { document.querySelector('#mwTimeline .mtl-cal [data-cd="' + d + '"]').click(); }, kst(3));
    await wait(300);
    check(await page.evaluate(function (d) { return _mtlMain.pick === d; }, kst(3)), '다른 날 고름');
    await page.click('#mwTimeline [data-t="today"]'); await wait(400);
    var dl = await page.evaluate(function () { var x = document.querySelector('#mwTimeline .mtl-dl'); return { pick: _mtlMain.pick, txt: x ? x.textContent : '' }; });
    check(dl.pick === kst(0) && /풍선 견적 회신/.test(dl.txt) && /풍선 회의/.test(dl.txt), '오늘 버튼 — 달력 아래 목록이 오늘 항목으로 ' + JSON.stringify(dl));
    check(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) {
    fail++; console.log('FAIL', e.message);
    await page.screenshot({ path: path.join(SHOT, 'cal-tip-fail.png') }).catch(function () {});
  } finally {
    await browser.close();
    await clean();
    await c.end();
  }
  console.log(fail ? '\nFAIL ' + fail + ' / ok ' + ok : '\nALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERR', e.message, e.stack); process.exit(1); });
