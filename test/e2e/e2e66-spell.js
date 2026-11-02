// v13.323 🔤 AI 맞춤법 · 띄어쓰기 — ⋯ 메뉴/코치 칸 · 바뀐 곳 표시 · 고치기 · 무시 · 모두 고치기 · Ctrl+Z · 노트 바꾸면 비움
//   AI 답은 서버 경로 /api/notebook/spell 을 가로채 정해 둔 답으로 (실제 AI 키 없이)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var BODY = '## 회의\n- 몇일 뒤에 할수 있다\n- 설치 하는것 확인함\n- 다음주 에 다시 봄';
var ANS = { items: [
  { wrong: '몇일 뒤에', right: '며칠 뒤에', type: 'spell', why: "'며칠'이 바른 말" },
  { wrong: '할수 있다', right: '할 수 있다', type: 'space', why: "의존 명사 '수'는 띄어 씀" },
  { wrong: '설치 하는것', right: '설치하는 것', type: 'space', why: "'하다'는 붙이고 '것'은 띄어 씀" },
  { wrong: '다음주 에', right: '다음 주에', type: 'space', why: '조사는 붙여 씀' }
], cut: false, provider: '시험' };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id FROM users WHERE email = 'admin@t.com'")).rows[0];
  await c.query('DELETE FROM nb_notes WHERE user_id = $1', [adm.id]);
  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-sp' + Date.now()) });
  var p = (await b.pages())[0] || await b.newPage();
  p.on('pageerror', function (e) { errs.push(e.message); });
  p.on('dialog', function (d) { d.accept(); });
  var asked = 0;
  await p.setRequestInterception(true);
  p.on('request', function (r) {
    if (/\/api\/notebook\/spell$/.test(r.url()) && r.method() === 'POST') { asked++; return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: ANS }) }); }
    r.continue();
  });
  function until(fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  function src() { return p.evaluate(function () { return document.getElementById('nbSrc').value; }); }
  try {
    await p.setViewport({ width: 1500, height: 920 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.evaluate(function () { try { localStorage.removeItem('nb-prefs'); } catch (e) { /* */ } });
    await p.click('#hdrNbBtn');
    await until(function () { return !!document.querySelector('#nbSide .nb-nav'); });
    var nid = await p.evaluate(function (body) { return apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: '맞춤법 시험', body: body }) }).then(function (r) { return r.data.id; }); }, BODY);
    await p.evaluate(function (id) { return nbOpenNote(id); }, nid);
    await until(function (id) { return NB.cur && NB.cur.id === id && document.getElementById('nbSrc'); }, nid);
    check(await p.evaluate(function () { return !NBP.coach; }), '코치 꺼진 채로 시작');
    // ⋯ 메뉴 → 🔤
    await p.click('#nbMain [data-nb="more"]');
    var clicked = await p.evaluate(function () { var x = [].filter.call(document.querySelectorAll('button, [role=menuitem], .nb-menu *'), function (e) { return /맞춤법 · 띄어쓰기 검사/.test(e.textContent) && e.children.length < 3; })[0]; if (x) { x.click(); return true; } return false; });
    check(clicked, '⋯ 메뉴에 [🔤 맞춤법 · 띄어쓰기 검사 (AI)]');
    check(await until(function () { return NBP.coach && document.querySelectorAll('#nbCoach .nb-sp-i').length === 4; }), '코치가 켜지고 바로 검사 → 4곳');
    check(asked === 1, 'AI 에게 한 번 물음');
    var d = await p.evaluate(function () { var x = document.querySelectorAll('#nbCoach .nb-sp-d'); return { a: x[0].innerHTML, b: x[1].innerHTML }; });
    check(/<del>몇<\/del><ins>며칠<\/ins>|<del>몇일<\/del><ins>며칠<\/ins>/.test(d.a.replace(/<i[^>]*>␣<\/i>/g, ' ')) || (/<del>/.test(d.a) && /<ins>/.test(d.a)), '바뀐 곳만 색 (맞춤법) ' + d.a);
    check(/<ins><i class="nb-sp-sp">␣<\/i><\/ins>/.test(d.b), '띄어쓰기는 ␣ 로 표시');
    check(await p.evaluate(function () { return /2곳|4곳/.test(document.querySelector('#nbCoach .nb-sp-sum').textContent) && /모두 고치기 4/.test(document.querySelector('#nbCoach .nb-sp-sum').textContent); }), '4곳 남음 · [모두 고치기 4]');
    await p.screenshot({ path: path.join(SHOT, 'e2e66-spell.png') });
    // 자리로
    await p.click('#nbCoach [data-csp="go:1"]');
    check(await p.evaluate(function () { var s = document.getElementById('nbSrc'); return s.value.slice(s.selectionStart, s.selectionEnd) === '할수 있다'; }), '누르면 그 자리를 골라 줌');
    // 하나 고치기 → Ctrl+Z
    await p.click('#nbCoach [data-csp="fix:0"]');
    check(/며칠 뒤에/.test(await src()) && await p.evaluate(function () { return document.querySelectorAll('#nbCoach .nb-sp-i.done').length === 1; }), '[고치기] → 며칠 · ✓ 고침');
    await p.focus('#nbSrc');
    await p.keyboard.down('Control'); await p.keyboard.press('z'); await p.keyboard.up('Control');
    check(/몇일 뒤에/.test(await src()), 'Ctrl+Z 로 되돌림');
    // 무시 · 모두 고치기
    await p.evaluate(function () { _nbpCoachRun(); });
    await p.click('#nbCoach [data-csp="skip:3"]');
    check(await p.evaluate(function () { return /무시함/.test(document.querySelectorAll('#nbCoach .nb-sp-i')[3].textContent); }), '[무시]');
    await p.click('#nbCoach [data-csp="all"]');
    var s2 = await src();
    check(/며칠 뒤에 할 수 있다/.test(s2) && /설치하는 것 확인함/.test(s2) && /다음주 에/.test(s2), '[모두 고치기] — 무시한 것은 그대로');
    check(await until(function () { return NB.dirty && (NB.dirty.body || document.getElementById('nbState').className.indexOf('saved') >= 0 || /저장/.test(document.getElementById('nbState').textContent)); }), '고친 글은 저장으로 이어짐');
    // 노트 바꾸면 비움
    var n2 = await p.evaluate(function () { return apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: '다른 노트', body: '글' }) }).then(function (r) { return r.data.id; }); });
    await p.evaluate(function (id) { return nbOpenNote(id); }, n2);
    check(await until(function (id) { return NB.cur && NB.cur.id === id && !document.querySelector('#nbCoach .nb-sp-i') && !!document.querySelector('#nbCoach [data-csp="run"]'); }, n2), '다른 노트로 가면 결과는 비우고 [🔤 맞춤법 검사] 단추');
    await p.evaluate(function () { nbpCoachToggle(false); });
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  check(!errs.length, '페이지 오류 없음' + (errs.length ? ' — ' + errs.join(' | ') : ''));
  await b.close();
  await c.query('DELETE FROM nb_notes WHERE user_id = $1', [adm.id]);
  await c.end();
  console.log('\n' + ok + ' 통과 · ' + fail + ' 실패' + (fail ? '' : ' — ALL PASS'));
  process.exit(fail ? 1 : 0);
})();
