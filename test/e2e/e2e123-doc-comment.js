// 💬 문서 댓글 · @이름 (v13.542) — 문서 댓글 · 불린 사람 받는 사람에 (볼 수 있는 사람만) · 개인 문서 막힘 · 화면: 크게 보기 💬 · @ 고르기 · 📨 요청으로
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var B = 'http://localhost:3000';
async function tok(email) { var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) }); return (await r.json()).data.accessToken; }
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0, pid = 'e2e-dc-' + Date.now();
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    var at = await tok('admin@t.com'), kt = await tok('kim@t.com');
    var H = function (t) { return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }; };
    var kId = (await (await fetch(B + '/api/auth/me', { headers: H(kt) })).json()).data; kId = kId.id || (kId.user && kId.user.id);
    await fetch(B + '/api/projects', { method: 'POST', headers: H(at), body: JSON.stringify({ id: pid, name: '댓글 시험', status: 'active', visibility: 'private', checklists: false }) });
    await fetch(B + '/api/projects/' + pid + '/members', { method: 'POST', headers: H(at), body: JSON.stringify({ userId: kId, role: 'assignee' }) });
    var f = (await (await fetch(B + '/api/docs/files', { method: 'POST', headers: H(at), body: JSON.stringify({ projectId: pid, name: '사양.txt', ext: 'txt', size: 10 }) })).json()).data;
    var pf = (await (await fetch(B + '/api/docs/files', { method: 'POST', headers: H(at), body: JSON.stringify({ name: '내 메모.txt', ext: 'txt', size: 10 }) })).json()).data;
    // API
    var c1 = await (await fetch(B + '/api/comments', { method: 'POST', headers: H(at), body: JSON.stringify({ targetType: 'doc', targetId: f.id, body: '@김팀원 @이팀원 3쪽 치수 확인 부탁', sendEmail: false, sendTelegram: false }) })).json();
    var rc = c1.data && (typeof c1.data.recipients === 'string' ? JSON.parse(c1.data.recipients) : c1.data.recipients) || [];
    check(c1.data && c1.data.target_type === 'doc', '문서 댓글 저장');
    check(rc.some(function (r) { return r.userId === kId; }) && !rc.some(function (r) { return /이팀원/.test(r.name); }), '@김팀원 받는 사람 · @이팀원(프로젝트 못 봄) 빠짐 ' + JSON.stringify(rc.map(function (r) { return r.name; })));
    var lst = await (await fetch(B + '/api/comments?targetType=doc&targetId=' + f.id, { headers: H(kt) })).json();
    check((lst.data || []).length === 1, '구성원 — 문서 댓글 보임');
    var lt = await tok('lee@t.com');
    check((await fetch(B + '/api/comments?targetType=doc&targetId=' + f.id, { headers: H(lt) })).status === 403, '못 보는 사람 — 403');
    check((await fetch(B + '/api/comments', { method: 'POST', headers: H(at), body: JSON.stringify({ targetType: 'doc', targetId: pf.id, body: 'x' }) })).status === 400, '개인 문서 — 댓글 막힘');

    // 화면
    await page.setViewport({ width: 1500, height: 950 });
    await page.goto(B + '/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    await page.evaluate(function (f) { return docViewFile(f); }, f);
    await page.waitForSelector('#docViewModal .dpv-cmt-b', { timeout: 10000 });
    await page.evaluate(function () { document.querySelector('#docViewModal .dpv-cmt-b').click(); });
    await page.waitForSelector('#dpvCmtModal .cm-item', { timeout: 10000 });
    var th = await page.evaluate(function () { return { n: document.querySelectorAll('#dpvCmtModal .cm-item').length, at: [].map.call(document.querySelectorAll('#dpvCmtModal .cm-at'), function (x) { return x.textContent; }) }; });
    check(th.n === 1 && th.at.indexOf('@김팀원') >= 0, '💬 댓글 창 — 목록 · @이름 강조 ' + JSON.stringify(th));
    // 새 댓글 — 작성 창이 위로, @ 고르기
    await page.evaluate(function () { [].filter.call(document.querySelectorAll('#dpvCmtModal button'), function (b) { return /코멘트 추가/.test(b.textContent); })[0].click(); });
    await page.waitForSelector('#commentModal #commentBody', { timeout: 6000 });
    var zs = await page.evaluate(function () { return { c: +getComputedStyle(document.getElementById('commentModal')).zIndex, d: +getComputedStyle(document.getElementById('docViewModal')).zIndex, t: +getComputedStyle(document.getElementById('dpvCmtModal')).zIndex }; });
    check(zs.c > zs.d && zs.c > zs.t, '작성 창이 문서 · 댓글 창 위 ' + JSON.stringify(zs));
    await page.focus('#commentBody');
    await page.keyboard.type('확인했습니다 @김');
    await page.waitForSelector('.cm-at-pop button', { timeout: 5000 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('수정본 올려 주세요');
    var v = await page.evaluate(function () { return document.getElementById('commentBody').value; });
    check(v === '확인했습니다 @김팀원 수정본 올려 주세요', '@ 고르기 → @김팀원 들어감 ' + JSON.stringify(v));
    await page.evaluate(function () { document.getElementById('commentEmail').checked = false; document.getElementById('commentTg').checked = false; commentSendUI(); });
    await page.waitForFunction(function () { return document.querySelectorAll('#dpvCmtModal .cm-item').length === 2; }, { timeout: 8000 }).catch(function () {});
    check(await page.evaluate(function () { return document.querySelectorAll('#dpvCmtModal .cm-item').length === 2; }), '보내면 목록에 바로');
    // 📨 요청으로 — 불린 사람이 받는 사람
    await page.evaluate(function () { var it = [].filter.call(document.querySelectorAll('#dpvCmtModal .cm-item'), function (x) { return /수정본/.test(x.textContent); })[0]; it.querySelector('[data-cm-req]').click(); });
    await page.waitForSelector('#wrqModal .wrq-chips', { timeout: 8000 });
    var rq = await page.evaluate(function () { var m = document.getElementById('wrqModal'); return { to: m.querySelector('.wrq-chips').textContent, title: m.querySelector('[data-k="title"]').value, z: +getComputedStyle(m).zIndex, dz: +getComputedStyle(document.getElementById('docViewModal')).zIndex }; });
    check(rq.z > rq.dz, '요청 창이 문서 크게 보기 위 ' + rq.z + ' > ' + rq.dz);
    check(/김팀원/.test(rq.to) && /확인했습니다/.test(rq.title) && !/@/.test(rq.title), '📨 요청으로 — 받는 사람 김팀원 · 제목 ' + JSON.stringify(rq));
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    try { var at2 = await tok('admin@t.com'); await fetch(B + '/api/projects/' + pid, { method: 'DELETE', headers: { Authorization: 'Bearer ' + at2 } }); } catch (_) {}
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
