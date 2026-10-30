// 🎯 내 업무 보드 화면 — 칸 높이 · 칸 관리(추가 · 이름 · 지우기) · 칸에 바로 추가 · 끌기 고정 · ⋯ 옮기기 · 카드 휴지통 · 휴지통 창 · 내보내기 · 맵으로 (v13.268)
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
    await c.query('DELETE FROM my_work_marks WHERE user_id = $1', [me.id]);
    await c.query('DELETE FROM my_work_categories WHERE user_id = $1', [me.id]);
    await c.query("DELETE FROM issues WHERE id LIKE 'bd-%'");
    await c.query("DELETE FROM prestudies WHERE id LIKE 'bd-%'");
    await c.query("DELETE FROM milestone_assignments WHERE id LIKE 'bd-%'");
    await c.query("DELETE FROM milestones WHERE id LIKE 'bd-%'");
    await c.query("DELETE FROM projects WHERE id LIKE 'bd-%'");
    await c.query("DELETE FROM mindmaps WHERE title LIKE '보드%' OR title LIKE '내 업무 %'");
  }
  await clean();
  await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('bd-p1', '보드 프로젝트', 'active', 'tenant', $1, $2)", [me.id, tid]);
  await c.query("INSERT INTO issues (id, project_id, title, status, urgency, due_date, assignees, tenant_id) VALUES ('bd-i1', 'bd-p1', '보드 이슈', 'open', 'high', $1, '[\"관리자\"]', $2)", [kst(1), tid]);
  await c.query("INSERT INTO prestudies (id, title, client, owner_id, due_date, status, priority, tenant_id) VALUES ('bd-s1', '보드 사전검토', 'C사', $1, $2, 'reviewing', 'normal', $3)", [me.id, kst(4), tid]);
  await c.query("INSERT INTO milestones (id, project_id, name, end_date, status, tenant_id) VALUES ('bd-ms1', 'bd-p1', '보드 마일스톤', $1, 'active', $2)", [kst(6), tid]);
  await c.query("INSERT INTO milestone_assignments (id, tenant_id, milestone_id, project_id, user_id) VALUES ('bd-ma1', $1, 'bd-ms1', 'bd-p1', $2)", [tid, me.id]);
  var ins = function (title, due, pri) { return c.query("INSERT INTO my_todos (id, tenant_id, user_id, title, due_date, priority, checklist) VALUES ($1,$2,$3,$4,$5,$6,$7)", ['todo-bd' + Math.random().toString(36).slice(2, 8), tid, me.id, title, due, pri, JSON.stringify(title === '보드 견적' ? [{ id: 'c1', t: '단가 확인', d: true }, { id: 'c2', t: '메일', d: false }] : [])]); };
  await ins('보드 견적', kst(0), 1);
  await ins('보드 계획', kst(9), 2);
  await ins('보드 잡일', kst(1), 3);
  await ins('보드 언젠가', null, 4);
  await c.query("INSERT INTO mindmaps (id, tenant_id, title, scope, owner_id, doc, node_count, version) VALUES ('mm-bd1', $1, '보드 기존 맵', 'personal', $2, $3, 1, 1)",
    [tid, me.id, JSON.stringify({ sheets: [{ id: 's1', title: '시트', root: { id: 'r', text: '보드 기존 맵', children: [] } }] })]);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function until(fn, arg, ms) { return page.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  function colOf(title) { return page.evaluate(function (t) { var i = Array.from(document.querySelectorAll('.mwb-i')).filter(function (x) { return x.querySelector('.mwb-t').textContent.indexOf(t) >= 0; })[0]; return i ? i.closest('.mwb-c').querySelector('.mwb-name').textContent : null; }, title); }
  function keyOf(title) { return page.evaluate(function (t) { var i = Array.from(document.querySelectorAll('.mwb-i')).filter(function (x) { return x.querySelector('.mwb-t').textContent.indexOf(t) >= 0; })[0]; return i ? i.getAttribute('data-qk') : null; }, title); }
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.evaluate(function () { try { ['mw-view', 'mw-bf', 'mw-bdone', 'mw-prif', 'mw-sort'].forEach(function (k) { localStorage.removeItem(k); }); } catch (_) {} });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(400);
    await page.click('#tabMyWork');
    await page.waitForSelector('#mwAddTitle');
    await page.click('#mMyWork [data-mwc-view="matrix"]');
    await page.waitForSelector('#mMyWork .mwb');
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 10000 }).catch(function () {});   // 사람 · 일정이 와서 다시 그리는 것까지 (v13.270)

    // 1. 기본 4칸 · 자동 분류 · 높이
    check(await page.evaluate(function () { return document.querySelectorAll('.mwb-c').length === 4; }), '기본 4칸');
    check(/지금 하기/.test(await colOf('보드 견적')) && /계획하기/.test(await colOf('보드 계획')) && /빨리 끝내기/.test(await colOf('보드 잡일')) && /나중에/.test(await colOf('보드 언젠가')) && /지금 하기/.test(await colOf('보드 이슈')), '중요 × 급함 자동 분류');
    var hgt = await page.evaluate(function () { return Array.from(document.querySelectorAll('.mwb-c')).map(function (x) { return x.getBoundingClientRect().height; }); });
    check(hgt.every(function (h) { return h >= 500; }), '칸 높이 — 화면에 맞춰 키움 ' + hgt.map(Math.round).join(','));
    check(await page.evaluate(function () { var c = document.querySelectorAll('.mwb-c'); return c[0].getBoundingClientRect().top === c[3].getBoundingClientRect().top; }), '넓은 화면은 4칸 한 줄');
    check(await page.evaluate(function () { var i = Array.from(document.querySelectorAll('.mwb-i')).filter(function (x) { return /보드 견적/.test(x.textContent); })[0]; return /☑ 1\/2/.test(i.textContent) && /오늘/.test(i.textContent) && /긴급/.test(i.textContent); }), '카드 — 하위 항목 · 마감 · 중요도');
    await page.screenshot({ path: path.join(SHOT, 'board.png') });

    // 1-2. 사전검토 · 마일스톤 완료 체크 (v13.269)
    var ps = await keyOf('보드 사전검토'), ms = await keyOf('보드 마일스톤');
    check(await page.evaluate(function (a) { return !!document.querySelector('[data-qk="' + a[0] + '"] input[data-done]') && !!document.querySelector('[data-qk="' + a[1] + '"] input[data-done]'); }, [ps, ms]), '사전검토 · 마일스톤에도 완료 체크');
    await page.click('[data-qk="' + ps + '"] input[data-done]');
    await page.waitForSelector('#mwbPop [data-v="hold"]');
    await wait(150);   // 바깥 누르기 감지는 메뉴가 뜬 다음 틱부터
    await page.mouse.click(5, 5);   // 고르지 않고 닫으면 체크 되돌림
    await wait(300);
    check(await page.evaluate(function (k) { var b = document.querySelector('[data-qk="' + k + '"] input[data-done]'); return b && !b.checked; }, ps) && (await c.query("SELECT status FROM prestudies WHERE id = 'bd-s1'")).rows[0].status === 'reviewing', '메뉴 그냥 닫기 → 체크 풀림 · 그대로');
    await page.click('[data-qk="' + ps + '"] input[data-done]');
    await page.waitForSelector('#mwbPop [data-v="hold"]');
    await page.click('#mwbPop [data-v="hold"]');
    await wait(700);
    check((await c.query("SELECT status FROM prestudies WHERE id = 'bd-s1'")).rows[0].status === 'hold' && !(await keyOf('보드 사전검토')), '사전검토 체크 → ⏸ 보류 고르기 → 사전검토에 반영 · 보드에서 빠짐');
    await page.click('#mwUndo button');
    await wait(700);
    check((await c.query("SELECT status FROM prestudies WHERE id = 'bd-s1'")).rows[0].status === 'reviewing' && !!(await keyOf('보드 사전검토')), '되돌리기 → 원래 상태 (검토중)');
    await page.click('[data-qk="' + ms + '"] input[data-done]');
    await wait(700);
    check((await c.query("SELECT status FROM milestones WHERE id = 'bd-ms1'")).rows[0].status === 'done', '마일스톤 체크 → 완료');
    await page.click('#mwUndo button');
    await wait(700);
    check((await c.query("SELECT status FROM milestones WHERE id = 'bd-ms1'")).rows[0].status === 'active', '되돌리기 → 진행');

    // 2. 위 요약 거르기
    await page.click('[data-bf="today"]');
    check(await until(function () { var t = Array.from(document.querySelectorAll('.mwb-i')).map(function (x) { return x.textContent; }).join('|'); return /보드 견적/.test(t) && !/보드 잡일/.test(t); }), '오늘만 보기');
    await page.click('[data-bf="today"]');
    await until(function () { return /보드 잡일/.test(document.querySelector('.mwb').textContent); });

    // 3. 칸 관리 — 추가 · 이름 바꾸기
    await page.click('[data-bact="cats"]');
    await page.waitForSelector('#mwCatsModal #mwcNewName');
    await page.type('#mwcNewIcon', '💼');
    await page.type('#mwcNewName', '보드 영업');
    await page.click('#mwCatsModal [data-ncol="green"]');
    await page.click('#mwCatsModal #mwkNew button[type=submit]').catch(async function () { await page.click('#mwCatsModal .mwk-new button[type=submit]'); });
    check(await until(function () { return document.querySelectorAll('#mwCatsModal .mwk-row').length === 5; }), '칸 추가');
    var nc = (await c.query("SELECT id, color, icon FROM my_work_categories WHERE user_id = $1 AND name = '보드 영업'", [me.id])).rows[0];
    check(nc && nc.color === 'green' && nc.icon === '💼', '새 칸 저장 ' + JSON.stringify(nc));
    await page.evaluate(function () { var i = document.querySelectorAll('#mwCatsModal .mwk-row')[1].querySelector('[data-cf="name"]'); i.value = '이번 주 계획'; i.dispatchEvent(new Event('change', { bubbles: true })); });
    await wait(500);
    check((await c.query("SELECT 1 FROM my_work_categories WHERE user_id = $1 AND name = '이번 주 계획' AND rule = 2", [me.id])).rows.length === 1, '이름 바꾸기 (자동 규칙은 그대로)');
    await page.keyboard.press('Escape');
    await until(function () { return !document.getElementById('mwCatsModal'); });
    check(await page.evaluate(function () { return document.querySelectorAll('.mwb-c').length === 5 && /이번 주 계획/.test(document.querySelector('.mwb').textContent); }), '보드에 5칸 · 바뀐 이름');

    // 4. 끌어서 새 칸에 고정
    var k1 = await keyOf('보드 이슈');
    await page.evaluate(function (k) {
      var dst = Array.from(document.querySelectorAll('.mwb-c')).filter(function (s) { return /보드 영업/.test(s.textContent); })[0].querySelector('.mwb-l');
      var src = document.querySelector('[data-qk="' + k + '"]'), dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, k1);
    await wait(700);
    check(/보드 영업/.test(await colOf('보드 이슈')), '끌기 → 영업 칸');
    check((await c.query("SELECT category_id FROM my_work_marks WHERE user_id = $1 AND item_key = 'issue:bd-i1'", [me.id])).rows[0].category_id === nc.id, '고정 저장');
    check((await c.query("SELECT urgency FROM issues WHERE id = 'bd-i1'")).rows[0].urgency === 'high', '이슈 중요도는 그대로');

    // 5. ⋯ 메뉴로 옮기기 · 고정 풀기
    await page.evaluate(function (k) { document.querySelector('[data-qk="' + k + '"] [data-bmenu]').click(); }, await keyOf('보드 언젠가'));
    await page.waitForSelector('#mwbPop');
    await page.evaluate(function (id) { document.querySelector('#mwbPop [data-v="' + id + '"]').click(); }, nc.id);
    await wait(600);
    check(/보드 영업/.test(await colOf('보드 언젠가')), '⋯ → 다른 칸으로');
    await page.evaluate(function (k) { document.querySelector('[data-qk="' + k + '"] [data-bmenu]').click(); }, await keyOf('보드 언젠가'));
    await page.waitForSelector('#mwbPop [data-v="__unpin"]');
    await page.click('#mwbPop [data-v="__unpin"]');
    await wait(600);
    check(/나중에/.test(await colOf('보드 언젠가')), '고정 풀기 → 자동 칸으로');

    // 6. 칸에 바로 추가
    await page.evaluate(function (id) { document.querySelector('[data-badd="' + id + '"]').click(); }, nc.id);
    await page.type('[data-bform="' + nc.id + '"] input', '내일 보드 제안서');
    await page.keyboard.press('Enter');
    check(await until(function () { return Array.from(document.querySelectorAll('.mwb-i')).some(function (x) { return /보드 제안서/.test(x.textContent) && /보드 영업/.test(x.closest('.mwb-c').textContent); }); }), '칸 [+] → 그 칸에 바로');
    await until(function () { return !document.querySelector('.is-pending'); });   // 저장 끝날 때까지 (바로 그리기 — v13.270)
    await wait(300);
    var nt = (await c.query("SELECT due_date FROM my_todos WHERE title = '보드 제안서'")).rows[0];
    check(nt && nt.due_date === kst(1), '한 줄 읽기 — 내일');
    check(await page.evaluate(function (id) { var f = document.querySelector('[data-bform="' + id + '"]'); return f && !f.hidden && document.activeElement === f.querySelector('input'); }, nc.id), '입력 칸 그대로 열려 있음 (연달아 넣기)');

    // 6-2. 바로 그리기 (v13.270) — 추가해도 전체 목록을 다시 받지 않음 · 다시 그려도 쓰던 글은 그대로
    var gets = 0;
    var onReq = function (rq) { if (/\/api\/my-work(\?|$)/.test(rq.url()) && rq.method() === 'GET') gets++; };
    page.on('request', onReq);
    await page.evaluate(function () { var f = document.querySelector('[data-bform]:not([hidden])'); if (f) f.hidden = true; document.activeElement && document.activeElement.blur(); });
    await page.click('#mwAddTitle');
    await page.type('#mwAddTitle', '보드 바로 추가');
    await page.keyboard.press('Enter');
    check(await page.evaluate(function () { return Array.from(document.querySelectorAll('.mwb-i')).some(function (x) { return /보드 바로 추가/.test(x.textContent); }); }), '엔터 즉시 화면에 (응답 기다리지 않음)');
    check(await until(function () { var x = Array.from(document.querySelectorAll('.mwb-i')).filter(function (x) { return /보드 바로 추가/.test(x.textContent); })[0]; return x && !x.classList.contains('is-pending') && /^issue|^todo:todo-/.test(x.getAttribute('data-qk')); }), '저장되면 진짜 항목으로 바뀜');
    check(await page.evaluate(function () { return document.activeElement && document.activeElement.id === 'mwAddTitle' && !document.activeElement.value; }), '입력 칸은 비고 커서 그대로 (연달아 입력)');
    await wait(400);
    check(gets === 0, '추가해도 전체 목록 다시 받기 없음 (GET ' + gets + '번)');
    page.off('request', onReq);
    await page.type('#mwAddTitle', '쓰는 중');
    await page.evaluate(function () { _mwPaint(); });
    check(await page.evaluate(function () { var x = document.getElementById('mwAddTitle'); return x.value === '쓰는 중' && document.activeElement === x; }), '다시 그려도 쓰던 글 · 커서 그대로');
    await page.evaluate(function () { var x = document.getElementById('mwAddTitle'); x.value = ''; x.blur(); });
    check((await c.query("SELECT COUNT(*)::int AS n FROM my_todos WHERE title = '보드 바로 추가' AND user_id = $1", [me.id])).rows[0].n === 1, '한 번만 저장');
    await c.query("DELETE FROM my_todos WHERE title = '보드 바로 추가'");
    await page.evaluate(function () { _mw.data.data = _mw.data.data.filter(function (x) { return x.title !== '보드 바로 추가'; }); _mwPaint(); });

    // 7. 카드에서 휴지통 → 되돌리기 · 휴지통 창
    await page.evaluate(function (k) { document.querySelector('[data-qk="' + k + '"] [data-btrash]').click(); }, await keyOf('보드 잡일'));
    await wait(600);
    check(!(await colOf('보드 잡일')) && (await c.query("SELECT 1 FROM my_todos WHERE title = '보드 잡일' AND deleted_at IS NOT NULL")).rows.length === 1, '카드 🗑 → 휴지통');
    check(await page.evaluate(function () { return /1/.test(document.querySelector('[data-mwio="trash"]').textContent); }), '머리 🗑 개수');
    await page.click('#mwUndo button');
    check(await until(function () { return /보드 잡일/.test(document.querySelector('.mwb').textContent); }), '되돌리기 → 되살림');
    await page.evaluate(function (k) { document.querySelector('[data-qk="' + k + '"] [data-btrash]').click(); }, await keyOf('보드 잡일'));
    await wait(500);
    await page.evaluate(function (k) { document.querySelector('[data-qk="' + k + '"] [data-btrash]').click(); }, await keyOf('보드 언젠가'));
    await wait(500);
    await page.click('[data-mwio="trash"]');
    await page.waitForSelector('#mwTrashModal .mwtr-row');
    check(await page.evaluate(function () { return document.querySelectorAll('#mwTrashModal .mwtr-row').length === 2; }), '휴지통 창 — 2개');
    await page.evaluate(function () { Array.from(document.querySelectorAll('#mwTrashModal .mwtr-row')).filter(function (r) { return /보드 잡일/.test(r.textContent); })[0].querySelector('[data-tr="restore"]').click(); });
    check(await until(function () { return document.querySelectorAll('#mwTrashModal .mwtr-row').length === 1; }), '창에서 되살리기');
    await page.click('#mwTrashModal [data-tr="empty"]');
    check(await until(function () { return !document.querySelector('#mwTrashModal .mwtr-row'); }), '휴지통 비우기');
    check((await c.query("SELECT COUNT(*)::int AS n FROM my_todos WHERE user_id = $1 AND deleted_at IS NOT NULL", [me.id])).rows[0].n === 0 && (await c.query("SELECT 1 FROM my_todos WHERE title = '보드 언젠가'")).rows.length === 0, '비우면 영구 삭제');
    await page.keyboard.press('Escape');
    check(await until(function () { return !document.getElementById('mwTrashModal') && /보드 잡일/.test(document.querySelector('.mwb').textContent); }), '닫으면 되살린 것 보드에');

    // 8. 내보내기 — CSV · 글로 복사 · 엑셀
    await page.evaluate(function () { window._dl = []; window._mwioDownload = function (n, b) { b.arrayBuffer().then(function (ab) { var u = new Uint8Array(ab); window._dl.push({ n: n, t: new TextDecoder('utf-8', { ignoreBOM: true }).decode(u), bom: u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF }); }); }; });
    await page.click('[data-mwio="export"]');
    await page.waitForSelector('#mwioMenu');
    await page.click('#mwioMenu [data-v="csv"]');
    await until(function () { return window._dl.length === 1; });
    var csv = await page.evaluate(function () { return window._dl[0]; });
    check(/\.csv$/.test(csv.n) && csv.bom && /^﻿칸,제목,출처/.test(csv.t) && /보드 영업.*보드 이슈|보드 이슈.*보드 영업/.test(csv.t.split('\r\n').filter(function (l) { return /보드 이슈/.test(l); })[0] || '') && /1\/2/.test(csv.t), 'CSV — 칸 · 제목 · 하위 항목');
    await page.evaluate(function () { window._clip = null; navigator.clipboard.writeText = function (t) { window._clip = t; return Promise.resolve(); }; });
    await page.click('[data-mwio="export"]');
    await page.click('#mwioMenu [data-v="text"]');
    await until(function () { return !!window._clip; });
    var clip = await page.evaluate(function () { return window._clip; });
    check(/■ 💼 보드 영업/.test(clip) && /- 보드 이슈/.test(clip), '글로 복사 — 칸별 글머리표');
    var hasX = await page.evaluate(function () { return typeof XLSX !== 'undefined'; });
    if (hasX) {
      await page.evaluate(function () { window._xf = null; XLSX.writeFile = function (wb, n) { window._xf = { n: n, sheets: wb.SheetNames, a1: wb.Sheets['목록'].A1.v, rows: XLSX.utils.sheet_to_json(wb.Sheets['목록']).length }; }; });
      await page.click('[data-mwio="export"]');
      await page.click('#mwioMenu [data-v="xlsx"]');
      await until(function () { return !!window._xf; });
      var xf = await page.evaluate(function () { return window._xf; });
      check(/\.xlsx$/.test(xf.n) && xf.sheets.join() === '목록,요약' && xf.a1 === '칸' && xf.rows >= 5, '엑셀 — 목록 + 요약 ' + JSON.stringify(xf));
    } else console.log('(엑셀 도구를 못 불러와 엑셀 확인은 건너뜀)');

    // 9. 맵으로 — 새 맵 · 복사 (담당 비우기)
    await page.click('[data-mwio="map"]');
    await page.waitForSelector('#mwToMapModal #mwmGo');
    await page.evaluate(function () { var i = document.getElementById('mwmTitle'); i.value = '보드 새 맵'; });
    await page.click('#mwmGo');
    await until(function () { return !document.getElementById('mwToMapModal'); });
    await wait(500);
    var nm = (await c.query("SELECT doc FROM mindmaps WHERE title = '보드 새 맵'")).rows[0];
    var root = nm && nm.doc.sheets[0].root;
    var flat = []; (function walk(n, d) { flat.push({ t: n.text, d: d, n: n }); (n.children || []).forEach(function (x) { walk(x, d + 1); }); })(root, 0);
    var issueNode = flat.filter(function (x) { return x.t === '보드 이슈'; })[0];
    var quoteNode = flat.filter(function (x) { return x.t === '보드 견적'; })[0];
    check(root && root.children.some(function (b) { return /보드 영업/.test(b.text) && b.color === 'green'; }), '맵 — 칸이 1단 가지 (색 그대로)');
    check(issueNode && issueNode.d === 2 && issueNode.n.ref && issueNode.n.ref.type === 'issue' && !issueNode.n.assigneeId && issueNode.n.markers[0] === 'priority-2', '이슈 주제 — 원래 화면 연결 · 담당 비움 · 중요도 마커');
    check(quoteNode && quoteNode.n.dueDate === kst(0) && quoteNode.n.children.length === 2 && quoteNode.n.children[0].done === true, '할 일 주제 — 마감 · 하위 항목(완료 표시)');
    check(await page.evaluate(function () { return /맵 열기/.test(document.querySelector('#mwUndo').textContent); }), '맵 열기 알림');
    check((await c.query("SELECT COUNT(*)::int AS n FROM my_todos WHERE user_id = $1 AND deleted_at IS NULL", [me.id])).rows[0].n === 4, '복사 — 할 일은 그대로');

    // 10. 맵으로 — 기존 맵에 가지로 · 옮기기 (영업 칸만)
    await page.click('[data-mwio="map"]');
    await page.waitForSelector('#mwToMapModal #mwmGo');
    await page.evaluate(function () {
      var sel = document.getElementById('mwmMap'); sel.value = 'mm-bd1'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelectorAll('#mwToMapModal [data-mg]').forEach(function (g) {
        var on = /보드 영업/.test(g.parentNode.textContent);
        if (g.checked !== on) { g.checked = on; g.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      var mv = document.querySelector('input[name="mwmMode"][value="move"]'); mv.checked = true; mv.dispatchEvent(new Event('change', { bubbles: true }));
    });
    check(await page.evaluate(function () { return /붙이기 \(2\)/.test(document.getElementById('mwmGo').textContent); }), '칸 하나만 고르기 — 2개');
    await page.click('#mwmGo');
    await until(function () { return !document.getElementById('mwToMapModal'); });
    await wait(800);
    var om = (await c.query("SELECT doc, version FROM mindmaps WHERE id = 'mm-bd1'")).rows[0];
    var top = om.doc.sheets[0].root.children[0];
    check(om.version === 2 && /내 업무/.test(top.text) && top.children.length === 1 && top.children[0].children.length === 2, '기존 맵에 가지 하나로 붙음');
    var prop = top.children[0].children.filter(function (x) { return x.text === '보드 제안서'; })[0];
    check(prop && prop.assigneeId === me.id, '옮긴 할 일 — 담당 나 (맵 주제로 내 업무에 다시 보임)');
    check((await c.query("SELECT deleted_at FROM my_todos WHERE title = '보드 제안서'")).rows[0].deleted_at && (await c.query("SELECT 1 FROM issues WHERE id = 'bd-i1'")).rows.length === 1, '옮기기 — 할 일은 휴지통 · 이슈는 그대로');
    check(await until(function () { return Array.from(document.querySelectorAll('.mwb-i')).some(function (x) { return /보드 제안서/.test(x.textContent) && /🧠/.test(x.textContent); }); }, null, 10000), '맵 주제가 되어 보드에 다시');

    // 11. 상세 패널 — 칸 고르기 · 넓어진 패널
    await page.evaluate(function (k) { document.querySelector('[data-qk="' + k + '"] .mwb-t').click(); }, await keyOf('보드 계획'));
    await page.waitForSelector('#mwPanel.on #mwpCat');
    check(await page.evaluate(function () { return document.getElementById('mwPanel').getBoundingClientRect().width >= 450; }), '패널 넓힘');
    await page.select('#mwpCat', nc.id);
    await wait(600);
    check(/보드 영업/.test(await colOf('보드 계획')), '패널에서 칸 옮기기');
    await page.keyboard.press('Escape');

    // 12. 칸 지우기 → 항목은 자동으로
    await page.click('[data-bact="cats"]');
    await page.waitForSelector('#mwCatsModal .mwk-row');
    await page.evaluate(function (id) { document.querySelector('#mwCatsModal [data-cdel="' + id + '"]').click(); }, nc.id);
    check(await until(function () { return document.querySelectorAll('#mwCatsModal .mwk-row').length === 4; }), '칸 지우기');
    await page.keyboard.press('Escape');
    await wait(300);
    check(/계획/.test(await colOf('보드 계획')), '지운 칸의 항목은 자동 칸으로');

    // 13. 휴대폰 폭
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
    await wait(400);
    check(await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth + 1; }), '휴대폰 — 가로 스크롤 없음');
    check(await page.evaluate(function () { var c = document.querySelectorAll('.mwb-c'); return c[1].getBoundingClientRect().top > c[0].getBoundingClientRect().bottom - 1; }), '휴대폰 — 칸 한 줄에 하나');
    await page.screenshot({ path: path.join(SHOT, 'board-mobile.png') });
    await page.evaluate(function () { try { ['mw-view', 'mw-bf', 'mw-bdone'].forEach(function (k) { localStorage.removeItem(k); }); } catch (_) {} });
    check(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) {
    fail++; console.log('FAIL', e.message);
    await page.screenshot({ path: path.join(SHOT, 'board-fail.png') }).catch(function () {});
  } finally {
    await browser.close();
    await clean();
    await c.end();
  }
  console.log(fail ? '\nFAIL ' + fail + ' / ok ' + ok : '\nALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERR', e.message, e.stack); process.exit(1); });
