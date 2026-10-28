// 주간 업무 보고 작성 화면 — 공용 파서 미리보기 · 저장 안 됨 표시 · 새 버전 · 덮어쓰기 충돌 · 지난주 가져오기 · 스타일 이전 (v13.250)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var dialogs = [];
  page.on('dialog', function (d) { dialogs.push(d.message()); d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var team = 'UI팀' + Date.now();
  var made = [];
  try {
    await page.setViewport({ width: 1500, height: 950 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id; });
    await wait(500);
    // 지난주 보고서 하나 미리 (가져오기 대상) + 이번 주 보고서(예전엔 이걸 잘못 가져왔다)
    var prep = await page.evaluate(async function (team) {
      var a = await apiFetch('/api/weekly-reports', { method: 'POST', body: JSON.stringify({ autoName: { team: team, weekStart: '2026-10-19', weekEnd: '2026-10-23' }, curText: '[개발]\n- [P] 지난주 금주 내용 @관리자', lastText: '' }) });
      var b = await apiFetch('/api/weekly-reports', { method: 'POST', body: JSON.stringify({ autoName: { team: team, weekStart: '2026-10-26', weekEnd: '2026-10-30' }, curText: '[개발]\n- [Q] 이번 주 것', lastText: '' }) });
      return [a.data[0].id, b.data[0].id];
    }, team);
    made = made.concat(prep);
    await page.evaluate(function () { try { localStorage.removeItem('wr-author-last-id'); } catch (e) {} });
    await page.click('#tabWeeklyReport');
    await page.waitForSelector('#wrAuSave');
    await wait(600);
    check(!(await page.$('#wrSrcStyle')), 'JS 주입 스타일 없음 (style.css 로 이전)');
    var css = await page.evaluate(function () {
      var w = document.getElementById('wrAuWork');
      return { grid: getComputedStyle(w).display, card: getComputedStyle(document.querySelector('.wr-card')).borderRadius };
    });
    check(css.grid === 'grid' && css.card === '8px', 'style.css 의 .wr-au-work · .wr-card 적용 ' + JSON.stringify(css));
    // 새로 시작 → 팀 · 주차
    await page.click('#wrAuNew'); await wait(200);
    await page.$eval('#wrAuTeam', function (e, t) { e.value = t; e.dispatchEvent(new Event('input')); }, team);
    await page.$eval('#wrAuStart', function (e) { e.value = '2026-10-26'; e.dispatchEvent(new Event('change')); });
    await page.$eval('#wrAuEnd', function (e) { e.value = '2026-10-30'; e.dispatchEvent(new Event('change')); });
    // 지난주에서 가져오기 → 10/19 주의 금주
    await page.click('#wrAuLoadPrev');
    await page.waitForFunction(function () { var e = document.getElementById('wrAuEditorLast'); return e && /지난주 금주 내용/.test(e.value); }, { timeout: 5000 }).catch(function () {});
    var last = await page.$eval('#wrAuEditorLast', function (e) { return e.value; });
    check(/지난주 금주 내용/.test(last) && !/이번 주 것/.test(last), '지난주 가져오기 = 작성 주차 전 보고서');
    // 입력 → 미리보기(공용 파서) · 저장 안 됨
    await page.click('#wrAuEditorCur');
    await page.keyboard.type('[개발]\n- [A사] 검사기   개조 ~11/20 40% @관리자 #진행중\n  : 도면 검토 #완료');
    await wait(400);
    var pv = await page.$eval('#wrAuPreviewCur', function (e) { return e.textContent; });
    check(/검사기 개조/.test(pv) && /40%/.test(pv), '미리보기 (공용 파서 · 공백 정리) ' + pv.slice(0, 60));
    check(/저장 안 됨/.test(await page.$eval('#wrAuStatusBadge', function (e) { return e.textContent; })), '저장 안 됨 표시');
    // 새 버전 저장 → R2 (같은 주 R1 이 이미 있음)
    await page.click('#wrAuSave');
    await page.waitForFunction(function () { return /편집 중/.test(document.getElementById('wrAuStatusBadge').textContent); });
    var badge = await page.$eval('#wrAuStatusBadge', function (e) { return e.textContent; });
    check(new RegExp(team + '_26W44_10/26~10/30_R2').test(badge) && !/저장 안 됨/.test(badge), '새 버전 R2 · 저장 안 됨 사라짐 ' + badge);
    var st = await page.evaluate(function () { return apiFetch('/api/weekly-reports?team=' + encodeURIComponent(document.getElementById('wrAuTeam').value)); });
    var mine = st.data.filter(function (x) { return /_R2$/.test(x.name) && x.week_label === '26W44'; })[0];
    if (mine) made.push(mine.id);
    check(mine && mine.saved_at, '저장 시각 기록됨');
    // 다른 사람이 그 사이 저장 → 덮어쓰기 시 409 → 새 버전(R3)으로
    await page.evaluate(async function (name) {
      await apiFetch('/api/weekly-reports', { method: 'POST', body: JSON.stringify({ name: name, curText: '[개발]\n- [X] 남이 고침', lastText: '' }) });
    }, mine.name);
    await page.click('#wrAuEditorCur'); await page.keyboard.type('\n- [B사] 추가');
    await wait(300);
    await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control');
    await page.waitForFunction(function () { return /_R3/.test(document.getElementById('wrAuStatusBadge').textContent); }, { timeout: 6000 }).catch(function () {});
    check(dialogs.some(function (m) { return /그 사이/.test(m) && /새 버전/.test(m); }), '충돌 안내 ' + dialogs.join(' | '));
    var b2 = await page.$eval('#wrAuStatusBadge', function (e) { return e.textContent; });
    check(/_R3/.test(b2), '내 내용은 R3 로 따로 저장 ' + b2);
    var r2 = await page.evaluate(function (id) { return apiFetch('/api/weekly-reports/' + id); }, mine.id);
    check(/남이 고침/.test(r2.data.cur_text), '남이 저장한 R2 는 그대로');
    var r3 = await page.evaluate(function (t) { return apiFetch('/api/weekly-reports?team=' + encodeURIComponent(t)); }, team);
    r3.data.forEach(function (x) { if (made.indexOf(x.id) < 0) made.push(x.id); });
    // 덮어쓰기 정상 경로 → version 2
    await page.click('#wrAuEditorCur'); await page.keyboard.type(' #완료');
    await wait(300);
    await page.click('#wrAuOverwrite');
    await page.waitForFunction(function () { return !/저장 안 됨/.test(document.getElementById('wrAuStatusBadge').textContent); }, { timeout: 5000 }).catch(function () {});
    var v = await page.evaluate(function (t) { return apiFetch('/api/weekly-reports?team=' + encodeURIComponent(t)).then(function (r) { return r.data.filter(function (x) { return /_R3$/.test(x.name); })[0]; }); }, team);
    check(v && v.version === 2, '덮어쓰기 → version 2');
    // 저장 안 한 상태에서 불러오기 → 확인 창
    await page.click('#wrAuEditorCur'); await page.keyboard.type(' x');
    await wait(300);
    var n0 = dialogs.length;
    await page.click('#wrAuLoadList');
    await page.waitForSelector('#wrAuLoadDropdown [data-load-id]');
    await page.click('#wrAuLoadDropdown [data-load-id]');
    await wait(500);
    check(dialogs.slice(n0).some(function (m) { return /저장하지 않은/.test(m); }), '저장 안 한 내용 불러오기 전 확인');
    await page.screenshot({ path: path.join(SHOT, 'weekly-author.png') });
    // 목록 · 검색 탭 (클래스 이전 후에도 표)
    await page.click('#wrSubTabs [data-wt="list"]');
    await page.waitForSelector('#wrPanel table.wr-tbl td');
    check(true, '목록 표 .wr-tbl');
    await page.click('#wrSubTabs [data-wt="search"]');
    await page.waitForSelector('#wrSQ.wr-inp');
    await page.type('#wrSQ', '검사기'); await page.click('#wrSearchBtn');
    await page.waitForFunction(function () { return /건/.test(document.getElementById('wrSearchCount').textContent); });
    check(/[1-9]\d*건/.test(await page.$eval('#wrSearchCount', function (e) { return e.textContent; })), '검색 결과');
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally {
    try { await page.evaluate(async function (ids) { for (var i = 0; i < ids.length; i++) { try { await apiFetch('/api/weekly-reports/' + ids[i], { method: 'DELETE' }); } catch (e) {} } }, made); } catch (e) {}
    await browser.close();
  }
})();
