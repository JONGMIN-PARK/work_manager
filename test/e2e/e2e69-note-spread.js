// 📖 노트 펼쳐 보기 (v13.325) — 고른 노트 2~4장 나란히 · 책장 넘기기(두 장 3D 넘김 · 3·4장 차례 넘김) · 끝 장 · 모서리 · 밀기 · 서랍에서 열기
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
  await c.query('DELETE FROM my_notes WHERE user_id = $1', [me.id]);
  // 6일치 노트 (오늘 ~ 5일 전) + 3일 전 회의 메모
  for (var i = 0; i < 6; i++) {
    await c.query('INSERT INTO my_notes (user_id, note_date, ref, tenant_id, body) VALUES ($1, $2, \'\', $3, $4)', [me.id, kst(-i), me.tenant_id, '펼침노트 ' + i + '일 전 첫 줄\n둘째 줄 ' + i + '\n- [x] 할 일 ' + i + ' ⟦t-' + i + '⟧']);
  }
  await c.query('INSERT INTO my_notes (user_id, note_date, ref, tenant_id, body) VALUES ($1, $2, \'ev:x1\', $3, $4)', [me.id, kst(-3), me.tenant_id, '회의 메모 줄']);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function until(fn, arg, ms) { return page.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var ev = function (fn, arg) { return page.evaluate(fn, arg); };
  var pages = function () { return ev(function () { return Array.prototype.map.call(document.querySelectorAll('#mwnsBook > .mwns-page'), function (p) { return p.getAttribute('data-k'); }); }); };
  var idle = function () { return until(function () { return !_mwns.flipping && !document.querySelector('#mwnsBook .mwns-leaf'); }, null, 4000); };
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);   // headless 는 기본이 reduce — 넘김 애니메이션 보려고
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
    await page.click('#mMyWork [data-mwn="open"]');
    await until(function () { var n = document.getElementById('mwNotes'); return n && n.classList.contains('on'); });
    await wait(400);

    // 1. 서랍 📖 → 오늘 장 + 어제 장 (옛 장이 왼쪽)
    await page.click('#mwNotes .mwn-ib[onclick="mwNotesSpread()"]');
    check(await until(function () { return document.querySelectorAll('#mwnsBook > .mwns-page').length === 2 && !/불러오는 중/.test(document.getElementById('mwnsBook').textContent); }), '📖 → 두 장 펼침');
    var p = await pages();
    check(p[0] === kst(-1) + '|' && p[1] === kst(0) + '|', '왼쪽 어제 · 오른쪽 오늘 ' + JSON.stringify(p));
    var txt = await ev(function () { return document.getElementById('mwnsBook').innerText; });
    check(/펼침노트 0일 전 첫 줄/.test(txt) && /할 일 0/.test(txt) && !/⟦/.test(txt), '본문 · 할 일 줄 보임 (표시 기호 없이)');
    check(await ev(function () { return document.getElementById('mwnsBook').classList.contains('is-pair') && !!document.querySelector('#mwnsBook .mwns-corner.l') && !!document.querySelector('#mwnsBook .mwns-corner.r'); }), '두 장 = 책 펼침면 · 바깥 모서리 둘');
    var cnt = await ev(function () { return document.getElementById('mwnsCnt').textContent; });
    check(/2 \/ 2장/.test(cnt), '고른 수 ' + cnt);
    await page.screenshot({ path: path.join(SHOT, 'e2e69-spread2.png') });

    // 2. ‹ 앞 장 → 두 장이 넘어감 (3D 장 · 덮개가 잠깐 생김) → 2·3일 전
    await page.click('#mwnSpreadModal [data-s="prev"]');
    check(await until(function () { return !!document.querySelector('#mwnsBook .mwns-leaf.to-r') && !!document.querySelector('#mwnsBook .mwns-cover'); }, null, 3000), '앞 장 → 왼쪽 장이 오른쪽으로 넘어가는 장 생김');
    await wait(380);
    await page.screenshot({ path: path.join(SHOT, 'e2e69-turning.png') });
    check(await idle(), '넘김 끝 → 넘어가는 장 · 덮개 사라짐');
    p = await pages();
    check(p[0] === kst(-3) + '|ev:x1' && p[1] === kst(-2) + '|', '앞 장 = 3일 전 회의 메모 · 2일 전 ' + JSON.stringify(p));
    // 3. ← 키 · → 키
    await page.keyboard.press('ArrowRight'); await idle();
    p = await pages();
    check(p[0] === kst(-1) + '|' && p[1] === kst(0) + '|', '→ 키 = 새 쪽으로 ' + JSON.stringify(p));
    // 4. 가장 최근에서 더 → 끝 (들썩 + 알림)
    await page.keyboard.press('ArrowRight');
    check(await until(function () { return !!document.querySelector('#mwnsBook .mwns-page.mwns-bump-r'); }, null, 1500), '최근 끝에서 더 넘기면 종이가 살짝 들썩');
    p = await pages();
    check(p[1] === kst(0) + '|', '끝에선 그대로');

    // 5. 장 수 3 · 4 — 목록에서 더 고르면 늘어남, 5번째는 막힘
    await page.click('#mwnSpreadModal .mwns-seg [data-v="3"]');
    check(await until(function () { return document.querySelectorAll('#mwnsBook > .mwns-page').length === 3 && !/불러오는 중/.test(document.getElementById('mwnsBook').textContent); }), '3장 → 옛 쪽 한 장 더 채움');
    p = await pages();
    check(p[0] === kst(-2) + '|', '3장 = 2일 전 · 어제 · 오늘 ' + JSON.stringify(p));
    check(await ev(function () { return !document.getElementById('mwnsBook').classList.contains('is-pair'); }), '3장은 펼침면 아님(따로 놓인 종이)');
    await page.click('#mwnsList [data-pk="' + kst(-5) + '|"]');
    check(await until(function () { return document.querySelectorAll('#mwnsBook > .mwns-page').length === 4; }), '목록에서 하나 더 고르면 4장으로');
    check(await ev(function () { return document.querySelector('#mwnSpreadModal .mwns-seg .on').getAttribute('data-v') === '4'; }), '장 수 단추도 4');
    await page.click('#mwnsList [data-pk="' + kst(-4) + '|"]');
    p = await pages();
    check(p.length === 4 && p.indexOf(kst(-4) + '|') < 0, '4장 넘으면 더 안 고름');
    await page.click('#mwnsList [data-pk="' + kst(-5) + '|"]');   // 빼기
    check((await pages()).length === 3, '다시 누르면 뺌');
    await page.click('#mwnsBook .mwns-x');
    check((await pages()).length === 2, '종이 ✕ 로 빼기');
    await page.click('#mwnSpreadModal .mwns-seg [data-v="4"]');
    await until(function () { return document.querySelectorAll('#mwnsBook > .mwns-page').length === 4 && !/불러오는 중/.test(document.getElementById('mwnsBook').textContent); });
    await page.screenshot({ path: path.join(SHOT, 'e2e69-spread4.png') });
    // 4장에서 넘기기 — 차례로 넘어오는 종이
    await page.click('#mwnSpreadModal [data-s="prev"]');
    check(await until(function () { return document.querySelectorAll('#mwnsBook .mwns-page.mwns-in-l').length === 4; }, null, 3000), '4장 넘기면 종이가 차례로 넘어옴');
    await idle(); await wait(900);
    p = await pages();
    check(p.length === 3 || p.length === 4, '옛 쪽 묶음 ' + JSON.stringify(p));
    var range = await ev(function () { return localStorage.getItem('mwn-spread-n'); });
    check(range === '4', '장 수 기억 (' + range + ')');

    // 6. 목록 찾기 — 본문 글자로
    await page.type('#mwnsQ', '회의 메모');
    check(await until(function () { var it = document.querySelectorAll('#mwnsList .mwns-it'); return it.length === 1 && /🤝/.test(it[0].textContent); }), '목록 찾기 → 회의 메모 한 줄');
    await ev(function () { var q = document.getElementById('mwnsQ'); q.value = ''; q.dispatchEvent(new Event('input')); });

    // 7. 밀어서 넘기기 (마우스로 끌기)
    await page.click('#mwnSpreadModal .mwns-seg [data-v="2"]');
    await until(function () { return document.querySelectorAll('#mwnsBook > .mwns-page').length === 2; });
    var before = await pages();
    var bx = await ev(function () { var r = document.querySelector('#mwnsBook .mwns-lines').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 60 }; });
    await page.mouse.move(bx.x, bx.y); await page.mouse.down(); await page.mouse.move(bx.x + 150, bx.y + 5, { steps: 5 }); await page.mouse.up();
    await idle();
    var after = await pages();
    check(JSON.stringify(after) !== JSON.stringify(before), '오른쪽으로 밀면 앞 장 ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));

    // 8. 종이 머리 → 서랍에서 그 노트 열기
    var k = after[0];
    await page.click('#mwnsBook > .mwns-page .mwns-ph');
    check(await until(function (kk) { return !document.getElementById('mwnSpreadModal') && _mwn.open && _mwn.date === kk.split('|')[0]; }, k), '종이 머리 → 창 닫고 📝 서랍에서 그 날 노트');

    // 9. 노트가 없으면 안 열림
    await c.query('DELETE FROM my_notes WHERE user_id = $1', [me.id]);
    await ev(function () { mwNotesSpread(); });
    await wait(800);
    check(!(await page.$('#mwnSpreadModal')), '노트 없으면 창 대신 안내');

    // 10. 휴대폰 — 목록 접힌 채 종이부터
    await page.setViewport({ width: 402, height: 874 });
    for (i = 0; i < 2; i++) await c.query('INSERT INTO my_notes (user_id, note_date, ref, tenant_id, body) VALUES ($1, $2, \'\', $3, $4)', [me.id, kst(-i), me.tenant_id, '폰 노트 ' + i]);
    await wait(300);
    await ev(function () { mwNotesSpread(); });
    check(await until(function () { var m = document.querySelector('#mwnSpreadModal .mwns'); return m && m.classList.contains('no-side') && document.querySelectorAll('#mwnsBook > .mwns-page').length === 2; }), '휴대폰 → 목록 접고 종이 보임');
    var over = await ev(function () { return document.documentElement.scrollWidth > window.innerWidth + 1; });
    check(!over, '휴대폰 가로 넘침 없음');
    await page.screenshot({ path: path.join(SHOT, 'e2e69-mobile.png') });

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  await c.query('DELETE FROM my_notes WHERE user_id = $1', [me.id]).catch(function () {});
  await c.end();
  await browser.close();
  console.log(fail ? 'FAILED ' + fail + ' (ok ' + ok + ')' : 'ALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})();
