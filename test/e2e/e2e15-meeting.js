// 회의록 → 맵 — 새 맵 창의 [🤝 회의록 → 맵] · 액션 아이템 담당 · 마감 · 완료 · 남의 회의는 못 만듦 (v13.239)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    await page.setViewport({ width: 1500, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
    // 회의 만들기 (프로젝트 없음 — 만든 사람만 맵으로 만들 수 있음)
    var mt = await page.evaluate(function () {
      var title = '설계 검토 회의 ' + Date.now();
      return apiFetch('/api/meetings', { method: 'POST', body: JSON.stringify({
        title: title, meetDate: '2026-10-27', agenda: [{ text: '도면 검토', done: true, note: '- 치수 확인', result: '' }, { text: '일정' }],
        minutes: '-. 프레임 강성 부족\n-. 커버 간섭', attendees: ['김팀원'], form: { decisions: '1. 프레임 보강', nextDate: '2026-11-03' } }) })
        .then(function (r) {
          var id = r.data.id;
          return apiFetch('/api/meetings/' + id + '/actions', { method: 'POST', body: JSON.stringify({ title: '보강안 작성', assigneeName: '외주', dueDate: '2026-11-01' }) })
            .then(function () { return { id: id, title: title }; });
        });
    });
    check(!!mt.id, '회의 만들기');
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmNewTpl');
    await page.select('#mmNewTpl', 'gen-meeting');
    await page.waitForFunction(function (id) { return !!document.querySelector('#mmNewMeet option[value="' + id + '"]'); }, { timeout: 8000 }, mt.id);
    check(await page.evaluate(function () { return !_mmEl('mmNewMeetWrap').classList.contains('hidden') && _mmEl('mmNewProjWrap').classList.contains('hidden'); }), '회의 고르기 칸 표시 · 프로젝트 칸 숨김');
    await page.select('#mmNewMeet', mt.id);
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(400);
    var info = await page.evaluate(function () {
      var r = _mmRoot();
      var act = r.children.filter(function (c) { return /액션/.test(c.text); })[0];
      return { title: _mm.row.title, scope: _mm.row.scope, root: r.text, ref: r.ref, branches: r.children.map(function (c) { return c.text; }), act: act && act.children[0], gen: _mm.doc.meta && _mm.doc.meta.gen };
    });
    check(info.title === '회의 · ' + mt.title && info.scope === 'personal', '제목 · 범위 ' + info.title + ' ' + info.scope);
    check(info.ref && info.ref.type === 'meeting' && info.root === mt.title + ' (2026-10-27)', '중심 주제 = 회의(연결)');
    check(info.branches.join('|') === '📋 안건|💬 논의|✅ 결정 사항|🎯 액션 아이템|👥 참석자|📅 다음 회의 2026-11-03', '가지 ' + info.branches.join('|'));
    check(info.act && info.act.text === '보강안 작성' && info.act.assigneeName === '외주' && info.act.dueDate === '2026-11-01', '액션 아이템 담당 · 마감');
    check(info.gen && info.gen.kind === 'meeting' && info.gen.meetingId === mt.id, '원본과 맞추기 정보');
    await page.screenshot({ path: path.join(SHOT, 'meeting-map.png') });
    // 남의 회의(프로젝트 없음)는 못 만듦
    var other = await page.evaluate(function () {
      return fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'kim@t.com', password: 'Test1234!' }) })
        .then(function (r) { return r.json(); });
    });
    var st = await page.evaluate(function (tok, id) {
      return fetch('/api/mindmaps/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ kind: 'meeting', meetingId: id }) }).then(function (r) { return r.status; });
    }, other.data.accessToken, mt.id);
    check(st === 404 || st === 403, '다른 사람의 회의 → 만들 수 없음 ' + st);
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
