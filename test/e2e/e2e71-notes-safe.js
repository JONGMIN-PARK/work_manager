// e2e71 — 📝 노트 서랍 v13.331: 불러오기 전 잠금 · 저장 실패 다시 · 임시 보관 되살리기 · 제목 줄 · 찾기 Esc · 화면 떠나면 닫힘
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var me = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var d0 = kst(0), d1 = kst(-1);
  async function body(d) { var r = (await c.query("SELECT body FROM my_notes WHERE user_id = $1 AND note_date = $2 AND ref = ''", [me.id, d])).rows[0]; return r ? r.body : null; }
  await c.query('DELETE FROM my_notes WHERE user_id = $1 AND note_date IN ($2, $3)', [me.id, d0, d1]);
  await c.query("INSERT INTO my_notes (tenant_id, user_id, note_date, ref, body) VALUES ($1, $2, $3, '', $4)", [me.tenant_id, me.id, d1, '## 어제 정리\n어제 쓴 중요한 글']);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function until(fn, arg, ms) { return page.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var ev = function (fn, arg) { return page.evaluate(fn, arg); };
  // 요청 가로채기 — 그날 GET 늦추기 · PUT 한 번 실패시키기
  var slowGet = null, failPut = 0;
  await page.setRequestInterception(true);
  page.on('request', function (rq) {
    var u = rq.url();
    if (slowGet && rq.method() === 'GET' && u.indexOf('/api/my-work/notes?date=' + slowGet) >= 0) { var s = slowGet; slowGet = null; return setTimeout(function () { rq.continue(); }, 2000); }
    if (failPut > 0 && rq.method() === 'PUT' && /\/api\/my-work\/notes$/.test(u)) { failPut--; return rq.respond({ status: 503, contentType: 'application/json', body: '{"error":"DOWN","message":"잠깐 안 됨"}' }); }
    rq.continue();
  });
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(400);
    await page.click('#tabMyWork');
    await page.waitForSelector('#mMyWork [data-mwn="open"]');
    await page.click('#mwMoreWrap .wm-more'); await page.click('#mMyWork [data-mwn="open"]');   // v13.338 ⋯ 메뉴 안
    await until(function () { return !!document.querySelector('#mwNotes.on .mwn-t'); });
    await ev(function (d) { mwNotesGo(d, ''); }, d0);   // 🔗 연동이면 타임라인 날짜로 열리므로 오늘부터
    await until(function (d) { return _mwn.loaded === d; }, d0);

    // 1. 불러오기 전엔 잠금 — 어제로 가는 동안 친 글이 어제 노트를 덮지 않음
    slowGet = d1;
    await page.click('#mwNotes [data-n="prev"]');
    await wait(150);
    check(await ev(function () { return !!document.querySelector('#mwnEd .mwn-lock') && !document.querySelector('#mwnEd .mwn-t'); }), '불러오는 동안 편집기 잠금 (자리만)');
    await page.keyboard.type('덮어쓰면 안 되는 글');
    check(await until(function () { return !!document.querySelector('#mwnEd .mwn-t'); }, null, 6000), '다 불러오면 편집기 열림');
    check(await ev(function () { return _mwn.rows.map(function (r) { return r.t; }).join('\n'); }) === '## 어제 정리\n어제 쓴 중요한 글', '불러온 글 그대로 (친 글이 섞이지 않음)');
    await wait(1000);
    check(await body(d1) === '## 어제 정리\n어제 쓴 중요한 글', 'DB 의 어제 노트도 그대로');

    // 2. 제목 줄 · 빈 줄 ➜ 없음
    check(await ev(function () { var r = document.querySelector('#mwnEd .mwn-r[data-i="0"]'); return r.classList.contains('is-h') && !r.querySelector('.mwn-up'); }), '## 줄은 제목 모양 · ➜ 없음');
    await page.click('#mwnEd .mwn-t[data-i="1"]');
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await page.keyboard.type('## ');
    check(await ev(function () { var r = document.querySelector('#mwnEd .mwn-r[data-i="2"]'); return r.classList.contains('is-h') && document.activeElement === r.querySelector('.mwn-t'); }), '쓰는 중 ## → 그 줄만 제목으로 · 커서 그대로');
    await page.keyboard.type('새 제목');

    // 3. 저장 실패 → 이 기기에 두고 다시 → 결국 저장
    failPut = 1;
    await page.keyboard.press('Enter'); await page.keyboard.type('실패 뒤 다시 저장될 글');
    check(await until(function () { return _mwn.state === 'error' || !!_mwn.retryT; }, null, 4000), '저장 실패 표시 · 다시 시도 예약');
    check(await ev(function (d) { return Object.keys(localStorage).some(function (k) { return k.indexOf('wm.mwn.draft:') === 0 && k.indexOf(d) > 0; }); }, d1), '못 보낸 글은 이 기기에 임시 보관');
    var saved = false;
    for (var i = 0; i < 20 && !saved; i++) { await wait(500); saved = /실패 뒤 다시 저장될 글/.test(await body(d1) || ''); }
    check(saved, '잠시 뒤 저절로 다시 저장');
    check(await until(function (d) { return !Object.keys(localStorage).some(function (k) { return k.indexOf('wm.mwn.draft:') === 0 && k.indexOf(d) > 0; }); }, d1), '저장되면 임시 보관 지움');

    // 4. 임시 보관 되살리기 — 서버 글이 base 와 같으면 그대로, 다르면 아래에 붙여 둘 다
    await page.click('#mwNotes [data-n="today"]');
    await until(function (d) { return _mwn.loaded === d; }, d0);
    var srv1 = await body(d1);
    await ev(function (a) { localStorage.setItem('wm.mwn.draft:' + _mwMe() + ':' + a.d + '|', JSON.stringify({ body: a.srv + '\n창 닫기 전에 쓴 줄', base: a.srv, at: Date.now() })); }, { d: d1, srv: srv1 });
    await page.click('#mwNotes [data-n="prev"]');
    check(await until(function () { return _mwn.rows.some(function (r) { return r.t === '창 닫기 전에 쓴 줄'; }); }), '되살림 — 서버 글이 그대로면 쓰던 글로');
    var back = false;
    for (var j = 0; j < 10 && !back; j++) { await wait(400); back = /창 닫기 전에 쓴 줄/.test(await body(d1) || ''); }
    check(back, '되살린 글 저장됨');
    await page.click('#mwNotes [data-n="today"]');
    await until(function (d) { return _mwn.loaded === d; }, d0);
    await c.query("UPDATE my_notes SET body = '다른 기기에서 고친 글' WHERE user_id = $1 AND note_date = $2 AND ref = ''", [me.id, d1]);
    await ev(function (d) { localStorage.setItem('wm.mwn.draft:' + _mwMe() + ':' + d + '|', JSON.stringify({ body: '이 기기에서 못 보낸 글', base: '옛 글', at: Date.now() })); }, d1);
    await page.click('#mwNotes [data-n="prev"]');
    check(await until(function () { var t = _mwn.rows.map(function (r) { return r.t; }).join('\n'); return /다른 기기에서 고친 글/.test(t) && /저장 못 한 글/.test(t) && /이 기기에서 못 보낸 글/.test(t); }), '되살림 — 그새 바뀌었으면 둘 다 남김');

    // 4-2. (v13.333) 동시 편집 — 다른 곳에서 덧붙인 줄과 서랍에서 덧붙인 줄을 합쳐 둘 다 남김
    await until(function () { return !_mwn.inflight && !_mwn.timer; }, null, 8000);
    var b0 = await body(d1);
    await c.query("UPDATE my_notes SET body = $3 WHERE user_id = $1 AND note_date = $2 AND ref = ''", [me.id, d1, b0 + '\n노트북에서 쓴 줄']);
    await ev(function () { var ts = document.querySelectorAll('#mwnEd .mwn-t'); ts[ts.length - 1].focus(); });
    await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('서랍에서 쓴 줄');
    var both = false, bb = '';
    for (var q = 0; q < 25 && !both; q++) { await wait(300); bb = await body(d1) || ''; both = /노트북에서 쓴 줄/.test(bb) && /서랍에서 쓴 줄/.test(bb); }
    check(both, '동시 편집 → 두 곳 글 다 남음 (' + JSON.stringify(bb.slice(-60)) + ')');
    check(await ev(function () { return _mwn.rows.some(function (r) { return r.t === '노트북에서 쓴 줄'; }); }), '합친 글이 서랍에도 보임');

    // 5. 찾기 칸 Esc — 찾기만 닫히고 서랍은 그대로
    await page.click('#mwNotes [data-n="find"]');
    await until(function () { return document.activeElement && document.activeElement.id === 'mwnQ'; });
    await page.keyboard.press('Escape');
    check(await ev(function () { return _mwn.open && !_mwn.find && !document.getElementById('mwnQ'); }), '찾기 Esc → 찾기만 닫힘');

    // 6. 다른 화면으로 가면 서랍 닫힘 (노트북 위에 떠 있지 않게)
    await ev(function () { setPage('notebook'); });
    check(await until(function () { return !_mwn.open && !document.getElementById('mwNotes').classList.contains('on'); }), '내 업무를 떠나면 서랍 닫힘');

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  await c.query('DELETE FROM my_notes WHERE user_id = $1 AND note_date IN ($2, $3)', [me.id, d0, d1]);
  await c.end(); await browser.close();
  console.log(fail ? 'FAILED ' + fail + ' (ok ' + ok + ')' : 'ALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})();
