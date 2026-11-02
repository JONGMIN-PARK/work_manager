// v13.322 ✍️ 글쓰기 시작 — 어디서든 Alt+W → 글 종류 → 양식 노트 + 코치 켜짐 · 이어 쓰기 · 노트북 왼쪽 단추
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  await c.query('DELETE FROM nb_notes WHERE user_id = $1', [adm.id]);
  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-ws' + Date.now()) });
  var p = (await b.pages())[0] || await b.newPage();
  p.on('pageerror', function (e) { errs.push(e.message); });
  p.on('dialog', function (d) { d.accept(); });
  function until(fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  try {
    await p.setViewport({ width: 1500, height: 920 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.evaluate(function () { try { localStorage.removeItem('nb-prefs'); } catch (e) { /* */ } });
    await p.evaluate(function () { return apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: '쓰던 보고서', body: '초안' }) }); });
    check(await p.evaluate(function () { return curPage !== 'notebook'; }), '노트북이 아닌 화면에서');
    await p.keyboard.down('Alt'); await p.keyboard.press('w'); await p.keyboard.up('Alt');
    check(await until(function () { return document.querySelectorAll('#nbWriteModal .nbw-c').length === 7; }), 'Alt+W → ✍️ 무엇을 쓸까요? (글 종류 7가지)');
    check(await until(function () { return /쓰던 보고서/.test((document.querySelector('#nbWriteModal .nbw-r') || {}).textContent || ''); }), '이어 쓰기 — 최근 노트');
    check(await p.evaluate(function () { return document.getElementById('nbwCoach').checked; }), '코치 켜고 쓰기 (기본)');
    await p.screenshot({ path: path.join(SHOT, 'e2e65-write-modal.png') });
    await p.click('#nbWriteModal .nbw-c[data-w="meeting"]');
    check(await until(function () { return curPage === 'notebook' && NB.cur && /^회의록/.test(NB.cur.title) && /## 안건/.test(document.getElementById('nbSrc').value); }, null, 10000), '한 번에 — 노트북 · 회의록 양식 새 노트');
    check(await until(function () { return NBP.coach && !!document.querySelector('#nbCoach') && document.querySelector('#nbMain').classList.contains('coach-on'); }), '✍️ 코치가 켜진 채로');
    await p.screenshot({ path: path.join(SHOT, 'e2e65-write-note.png') });
    // 이어 쓰기 · 코치 끄고
    check(await p.evaluate(function () { return !!document.querySelector('#nbSide [data-nb="write"]'); }), '노트북 왼쪽 맨 위 [✍️ 글쓰기]');
    await p.click('#nbSide [data-nb="write"]');
    await until(function () { return !!document.querySelector('#nbWriteModal .nbw-ri'); });
    await p.click('#nbwCoach');
    var tid = await p.evaluate(function () { var x = [].filter.call(document.querySelectorAll('#nbWriteModal .nbw-ri'), function (b) { return /쓰던 보고서/.test(b.textContent); })[0]; return x && x.getAttribute('data-wn'); });
    await p.click('#nbWriteModal .nbw-ri[data-wn="' + tid + '"]');
    check(await until(function (id) { return NB.cur && NB.cur.id === id && !NBP.coach && !document.querySelector('#nbCoach'); }, tid), '이어 쓰기 · 코치 끈 채로');
    check(await p.evaluate(function () { return _nbLS('writeCoach') === false; }), '고른 코치 설정 기억');
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  check(!errs.length, '페이지 오류 없음' + (errs.length ? ' — ' + errs.join(' | ') : ''));
  await b.close();
  await c.query('DELETE FROM nb_notes WHERE user_id = $1', [adm.id]);
  await c.end();
  console.log('\n' + ok + ' 통과 · ' + fail + ' 실패' + (fail ? '' : ' — ALL PASS'));
  process.exit(fail ? 1 : 0);
})();
