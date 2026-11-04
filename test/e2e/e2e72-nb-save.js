// e2e72 — 📓 노트북 저장 계층 v13.332: 노트마다 대기열 · 실패 뒤 다시 · 노트 바꿔도 섞이지 않음 · 충돌 중 임시 보관 지킴
//   · 시간 초과 뒤 같은 글 409 는 저장된 것으로 · 열기 순서 · 일일 노트 되살리기 · 낙서장 두 번 눌러도 한 번 · 로그아웃 때 비움
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var me = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  await c.query("DELETE FROM nb_notes WHERE user_id = $1 AND (title LIKE 'E72%' OR source = 'quick')", [me.id]);
  var dd = kst(-3);
  await c.query("DELETE FROM my_notes WHERE user_id = $1 AND note_date = $2", [me.id, dd]);
  await c.query("INSERT INTO my_notes (tenant_id, user_id, note_date, ref, body) VALUES ($1, $2, $3, '', '서버 일일 글')", [me.tenant_id, me.id, dd]);
  async function row(id) { return (await c.query('SELECT title, body, rev FROM nb_notes WHERE id = $1', [id])).rows[0]; }

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-72' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function until(fn, arg, ms) { return page.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var ev = function (fn, arg) { return page.evaluate(fn, arg); };
  async function waitBody(id, re, n) { for (var i = 0; i < (n || 30); i++) { var r = await row(id); if (r && re.test(r.body)) return r; await wait(300); } return await row(id); }
  // 요청 가로채기
  var failPut = 0, slowGet = null;
  await page.setRequestInterception(true);
  page.on('request', function (rq) {
    var u = rq.url();
    if (slowGet && rq.method() === 'GET' && u.indexOf('/api/notebook/notes/' + slowGet) >= 0) { slowGet = null; return setTimeout(function () { rq.continue(); }, 1500); }
    if (failPut > 0 && rq.method() === 'PUT' && /\/api\/notebook\/notes\/[^/]+$/.test(u)) { failPut--; return rq.respond({ status: 503, contentType: 'application/json', body: '{"error":"DOWN","message":"잠깐 안 됨"}' }); }
    rq.continue();
  });
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await ev(function () { localStorage.removeItem('nb-prefs'); setPage('notebook'); });
    await until(function () { return !!document.querySelector('#nbSide .nb-nav'); });
    var ids = await ev(function () {
      function mk(t, b) { return apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: t, body: b }) }).then(function (r) { return r.data.id; }); }
      return Promise.all([mk('E72 가', '가 본문'), mk('E72 나', '나 본문')]);
    });
    var A = ids[0], B = ids[1];
    async function open(id) { await ev(function (i) { return _nbOpen(i); }, id); await until(function (i) { return NB.cur && NB.cur.id === i && !!document.getElementById('nbSrc'); }, id); }
    async function typeEnd(txt) { await page.focus('#nbSrc'); await ev(function () { var s = document.getElementById('nbSrc'); s.setSelectionRange(s.value.length, s.value.length); }); await page.keyboard.type(txt); }

    // 1. 저장 실패 → 다른 노트로 가도 가 의 글은 가 에 · 나 에 섞이지 않음
    await open(A);
    failPut = 1;
    await typeEnd(' 가에 더 씀');
    check(await until(function () { return !!NB.retryT || /곧 다시|끊김/.test(document.getElementById('nbState').textContent); }, null, 5000), '저장 실패 → "곧 다시 보냄" 표시');
    check(await ev(function (i) { return Object.keys(localStorage).some(function (k) { return k === 'nb-draft:' + _nbUid() + ':' + i; }); }, A), '못 보낸 글은 이 사람 이름으로 임시 보관');
    await open(B);
    await typeEnd(' 나에 더 씀');
    var ra = await waitBody(A, /가에 더 씀/), rb = await waitBody(B, /나에 더 씀/);
    check(ra.body === '가 본문 가에 더 씀', '가 노트 = 가 글 (' + JSON.stringify(ra.body) + ')');
    check(rb.body === '나 본문 나에 더 씀', '나 노트 = 나 글 (섞이지 않음)');
    check(await until(function (i) { return !localStorage.getItem('nb-draft:' + _nbUid() + ':' + i); }, A), '닿은 뒤 임시 보관 지움');

    // 2. 충돌 — 다른 곳에서 먼저 고침 → 막대 · 임시 보관 남음 · 다른 노트 갔다 와도 내 글 · 내 것으로 덮기
    await open(A);
    await until(function () { return !Object.keys(NB.pend).length && !NB.saving; });
    await c.query("UPDATE nb_notes SET body = '다른 기기 글', rev = rev + 1 WHERE id = $1", [A]);
    await typeEnd(' 충돌 글');
    check(await until(function () { var b = document.getElementById('nbBars'); return b && /먼저 고쳤습니다/.test(b.textContent); }, null, 6000), '충돌 → 고르기 막대');
    check(await ev(function (i) { var d = JSON.parse(localStorage.getItem('nb-draft:' + _nbUid() + ':' + i) || 'null'); return !!d && /충돌 글/.test(d.body); }, A), '충돌 중 임시 보관 남아 있음');
    await open(B);
    await open(A);
    check(await ev(function () { return /충돌 글/.test(document.getElementById('nbSrc').value); }), '다른 노트 갔다 와도 내 글 그대로');
    check(await until(function () { var b = document.getElementById('nbBars'); return b && /먼저 고쳤습니다/.test(b.textContent); }, null, 6000), '다시 열면 다시 충돌 막대');
    await page.click('[data-nb="cf-mine"]');
    var rc = await waitBody(A, /충돌 글/);
    check(rc.body === '가 본문 가에 더 씀 충돌 글', '내 것으로 덮기 → DB 에 내 글');
    check(await until(function () { return /저장됨/.test(document.getElementById('nbState').textContent) && !NB.conflict; }), '덮은 뒤 ✓ 저장됨');

    // 3. 시간 초과 뒤 다시 보낸 것 — 서버가 이미 같은 글이면 충돌 아님
    var rev0 = (await row(A)).rev;
    await ev(function (i) { NB.revs[i] = NB.revs[i] - 1; var p = _nbPendOf(NB.cur); p.f.body = 1; return _nbFlush(); }, A);
    check(await ev(function () { return !NB.conflict && !/먼저 고쳤습니다/.test(document.getElementById('nbBars').textContent); }), '같은 글 409 → 충돌 막대 없음');
    check(await ev(function (a) { return NB.revs[a.i] === a.r; }, { i: A, r: rev0 }), '서버 rev 로 맞춤');

    // 4. 열기 순서 — 늦게 온 앞 응답이 뒤 노트를 덮지 않음
    await open(B);
    slowGet = A;
    await ev(function () { NB.cur = null; });   // 나 를 다시 열 수 있게
    await ev(function (a) { _nbOpen(a.A); return new Promise(function (r) { setTimeout(function () { _nbOpen(a.B).then(r); }, 50); }); }, { A: A, B: B });
    slowGet = null;
    await wait(1800);
    check(await ev(function (b) { return NB.cur && NB.cur.id === b; }, B), '빨리 두 번 열면 마지막 것 (' + await ev(function () { return NB.cur && NB.cur.title; }) + ')');

    // 5. 임시 보관 — rev 가 그새 바뀌었으면 "덮습니다" 경고 · 같으면 그냥
    await ev(function (a) { localStorage.setItem('nb-draft:' + _nbUid() + ':' + a, JSON.stringify({ rev: 1, title: 'E72 가', body: '옛 기기 글', t: Date.now() })); }, A);
    await open(A);
    check(await until(function () { var b = document.getElementById('nbBars'); return b && /덮습니다/.test(b.textContent) && !!b.querySelector('[data-nb="draft-copy"]'); }), '그새 바뀐 임시 보관 → 덮는다는 경고 · 사본으로');
    await page.click('[data-nb="draft-drop"]');
    check(await ev(function (a) { return !localStorage.getItem('nb-draft:' + _nbUid() + ':' + a); }, A), '버리기 → 지움');

    // 6. 일일 노트 — 📝 서랍과 같은 임시 보관을 되살림
    await ev(function (d) { localStorage.setItem('wm.mwn.draft:' + _nbUid() + ':' + d + '|', JSON.stringify({ body: '서버 일일 글\n서랍에서 못 보낸 줄', base: '서버 일일 글', at: Date.now() })); }, dd);
    await ev(function (d) { return _nbOpenDaily(d, ''); }, dd);
    check(await until(function () { return NB.daily1 && /서랍에서 못 보낸 줄/.test(document.getElementById('nbSrc').value); }), '일일 노트 — 서랍 임시 보관 되살림');
    var dr = null;
    for (var i = 0; i < 20; i++) { dr = (await c.query("SELECT body FROM my_notes WHERE user_id = $1 AND note_date = $2 AND ref = ''", [me.id, dd])).rows[0]; if (dr && /못 보낸 줄/.test(dr.body)) break; await wait(300); }
    check(dr && dr.body === '서버 일일 글\n서랍에서 못 보낸 줄', '되살린 일일 노트 저장');

    // 7. 낙서장 — 저장 두 번 눌러도 하나만
    await ev(function () { nbQuickOpen(); });
    await until(function () { return !!document.querySelector('#nbQuick textarea'); });
    await page.type('#nbQuick textarea', 'E72 낙서 한 번');
    await ev(function () { var b = document.querySelector('#nbQuick [data-q="save"]'); b.click(); b.click(); });
    await wait(1500);
    var nq = (await c.query("SELECT count(*)::int n FROM nb_notes WHERE user_id = $1 AND body = 'E72 낙서 한 번'", [me.id])).rows[0].n;
    check(nq === 1, '낙서장 두 번 눌러도 하나 (' + nq + ')');

    // 8. 화면 — 보기 모드엔 서식 단추 숨김(손글씨 · 마커만) · 1366 폭 머리 단추가 넘치지 않음 · 펼쳐 보기 일일 노트 ## · 목록 미리보기 띄어쓰기
    await open(A);
    await ev(function () { _nbSetMode('view'); });
    check(await ev(function () { var b = document.querySelector('#nbTb [data-fmt="b"]'), k = document.querySelector('#nbTb [data-fmt="ink"]'); return b && k && b.offsetParent === null && k.offsetParent !== null; }), '보기 모드 — 서식 단추 숨김 · 손글씨만');
    await ev(function () { _nbSetMode('split'); });
    await page.setViewport({ width: 1366, height: 768 }); await wait(300);
    check(await ev(function () { var t = document.querySelector('.nb-top'), r = t.getBoundingClientRect(); return t.scrollWidth <= t.clientWidth + 1 && [].every.call(t.querySelectorAll('.nb-ib'), function (b) { var q = b.getBoundingClientRect(); return q.right <= r.right + 1; }); }), '1366 폭 — 머리 단추가 넘치지 않음');
    check(await ev(function () { if (typeof _wbBodyHtml !== 'function') return true; var h = _wbBodyHtml({ text: '## 오늘 할 일\n- [ ] 센서\n- [x] 모터' }); return h.indexOf('##') < 0 && h.indexOf('is-h') > 0 && h.indexOf('mwns-box') > 0; }), '펼쳐 보기 일일 노트 — ## 대신 제목 · [ ] 대신 칸');
    check(await ev(function () { return _nbSnippet('- **납기**는 다음 주') === '납기는 다음 주'; }), '목록 미리보기 — 굵게 자리 빈칸 없음');
    await page.setViewport({ width: 1440, height: 900 });

    // 9. 로그아웃 — 노트북 화면 · 기억 비움
    await ev(function () { return authLogout(); });
    check(await ev(function () { return !NB.cur && !NB.inited && !document.querySelector('#mNotebook .nb') && !Object.keys(NB.pend).length; }), '로그아웃 → 노트북 화면 · 기억 비움');

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  await c.query("DELETE FROM nb_notes WHERE user_id = $1 AND (title LIKE 'E72%' OR body = 'E72 낙서 한 번')", [me.id]);
  await c.query("DELETE FROM my_notes WHERE user_id = $1 AND note_date = $2", [me.id, dd]);
  await c.end(); await browser.close();
  console.log(fail ? 'FAILED ' + fail + ' (ok ' + ok + ')' : 'ALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})();
