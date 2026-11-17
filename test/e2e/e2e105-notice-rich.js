// 📢 공지 꾸미기 · 그림 붙이기 · 미리보기 · ✨ 예시 (v13.514) — 두 브라우저(관리자 · 김팀원)
//   예시 넣기(공수 등록 안내 · 캡처 3장 · 중요) → 미리보기 → 게시 → 팀원에게 중요 창(그림 포함) → 목록 · 크게 보기
//   → 고치기(그림 빼기) → 붙여넣기 → 서버 검사(그림 아닌 것 · 너무 많은 것 거절) · HTML 은 글자 그대로
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  await c.query('DELETE FROM notices WHERE tenant_id = $1', [adm.tenant_id]);
  require('fs').mkdirSync(SHOT, { recursive: true });
  var ok = 0, fail = 0, errs = [], B = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email, vp) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    B.push(b);
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { errs.push('기본 알림 창이 뜸: ' + d.message()); d.dismiss(); });
    await p.setViewport(vp || { width: 1400, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.waitForFunction(function () { return typeof CXS !== 'undefined' && CXS.on; }, { timeout: 10000 }).catch(function () {});
    await p.evaluate(function () { window.__wmDialogUi = true; });
    return p;
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var okBtn = async function (p) { await until(p, function () { return !!document.querySelector('.wmd .wmd-btn.ok'); }); await p.click('.wmd .wmd-btn.ok'); };
  try {
    var a = await open('admin@t.com'), k = await open('kim@t.com');

    /* ── 쓰기: 꾸미기 단추 · 미리보기 ── */
    await a.evaluate(function () { wmNoticeOpen(); });
    await until(a, function () { return !!document.querySelector('#ntRoot [data-nt="new"]'); });
    await a.click('#ntRoot [data-nt="new"]');
    check(await until(a, function () { return !!document.getElementById('ntPv') && document.querySelectorAll('.nt-tool').length >= 9; }), '쓰기 화면 — 꾸미기 단추 · 미리보기 칸');
    await a.evaluate(function () { var t = document.getElementById('ntBody'); t.value = '첫 줄\n둘째 줄\n<script>window.__x=1</script> **굵게** ==형광=='; t.dispatchEvent(new Event('input', { bubbles: true })); t.selectionStart = 0; t.selectionEnd = 3; });
    await a.click('.nt-tool[data-v="h1"]');
    await a.evaluate(function () { var t = document.getElementById('ntBody'); t.selectionStart = t.value.indexOf('둘째'); t.selectionEnd = t.selectionStart + 4; });
    await a.click('.nt-tool[data-v="ul"]');
    var pv = await a.evaluate(function () { var p = document.getElementById('ntPv'); return { val: document.getElementById('ntBody').value.split('\n').slice(0, 2).join('|'), h1: (p.querySelector('.nt-h1') || {}).textContent, li: (p.querySelector('.nt-ul li') || {}).textContent, b: (p.querySelector('.nt-p b') || {}).textContent, mk: (p.querySelector('.nt-p mark') || {}).textContent, script: !!p.querySelector('script'), txt: /<script>/.test(p.textContent), x: window.__x }; });
    check(pv.val === '# 첫 줄|- 둘째 줄' && pv.h1 === '첫 줄' && pv.li === '둘째 줄', '제목 · 목록 단추 → 줄 앞 기호 + 미리보기 ' + JSON.stringify(pv));
    check(pv.b === '굵게' && pv.mk === '형광' && !pv.script && pv.txt && !pv.x, '굵게 · 형광 · HTML 은 글자 그대로(실행 안 됨)');

    /* ── ✨ 예시 넣기 ── */
    await a.click('#ntRoot [data-nt="sample"]');
    await okBtn(a);
    check(await until(a, function () { return document.querySelectorAll('#ntThumbs .nt-thumb').length === 3; }, null, 20000), '예시 넣기 — 캡처 3장이 붙음');
    var s = await a.evaluate(function () { var p = document.getElementById('ntPv'); return { title: document.getElementById('ntTitle').value, imp: document.getElementById('ntImp').checked, imgs: p.querySelectorAll('img.nt-img').length, h2: p.querySelectorAll('.nt-h2').length, ol: p.querySelectorAll('.nt-ol li').length, call: p.querySelectorAll('.nt-call').length, tail: p.querySelectorAll('.nt-imgs img').length, wide: document.querySelector('.nt-box').classList.contains('nt-wide'), big: NT.eimgs.map(function (x) { return x.length; }) }; });
    check(/공수 등록/.test(s.title) && s.imp, '제목 · 중요 표시가 채워짐');
    check(s.imgs === 3 && s.tail === 0 && s.h2 === 3 && s.ol === 5 && s.call === 2, '미리보기 — 그림 3장이 [그림N] 자리에 · 소제목 3 · 번호 5 · 상자 2 ' + JSON.stringify(s));
    check(s.big.every(function (n) { return n > 20000 && n < 1600000; }) && s.wide, '그림 크기 알맞음 · 쓰는 창이 넓어짐 ' + s.big.join());
    await a.screenshot({ path: path.join(SHOT, 'e2e105-edit.png') });
    await a.click('#ntRoot [data-nt="save-pub"]');
    await okBtn(a);
    check(await until(a, function () { return !document.getElementById('ntBody') && document.querySelectorAll('#ntRoot .nt-row').length === 1; }, null, 15000), '게시 → 관리 목록');
    var dbn = (await c.query("SELECT n.id, n.level, n.status, (SELECT COUNT(*)::int FROM notice_images i WHERE i.notice_id = n.id) AS imgs FROM notices n WHERE tenant_id = $1", [adm.tenant_id])).rows[0];
    check(dbn && dbn.level === 'important' && dbn.status === 'published' && dbn.imgs === 3, '서버 — 중요 · 게시 · 그림 3장 ' + JSON.stringify(dbn));
    check(await a.evaluate(function () { return /🖼 3/.test(document.querySelector('#ntRoot .nt-row').textContent) && !document.querySelector('.nt-box').classList.contains('nt-wide'); }), '관리 목록에 🖼 3 · 창 너비 원래대로');

    /* ── 팀원: 중요 창에 그림까지 ── */
    check(await until(k, function () { return !!document.getElementById('wmNoticePop'); }, null, 15000), '팀원 — 중요 공지 창이 뜸');
    check(await until(k, function () { var im = document.querySelectorAll('#wmNoticePop img.nt-img'); return im.length === 3 && [].every.call(im, function (i) { return i.complete && i.naturalWidth > 300; }); }, null, 15000), '중요 창에 그림 3장이 보임');
    var kp = await k.evaluate(function () { var b = document.getElementById('wmNoticePop'); return { h1: !!b.querySelector('.nt-h1'), ol: b.querySelectorAll('.nt-ol li').length, raw: /\[그림|\*\*|==|^#/m.test(b.querySelector('.nt-body').textContent), fit: b.querySelector('.nt-pop').scrollWidth <= b.querySelector('.nt-pop').clientWidth + 1 }; });
    check(kp.h1 && kp.ol === 5 && !kp.raw && kp.fit, '꾸민 모양 그대로 · 기호가 글자로 남지 않음 · 가로로 안 넘침 ' + JSON.stringify(kp));
    await k.screenshot({ path: path.join(SHOT, 'e2e105-pop.png') });
    await k.click('#wmNoticePop img.nt-img');
    check(await until(k, function () { var v = document.querySelector('#wmNoticeImg .nt-view img'); return v && v.naturalWidth > 300; }), '그림을 누르면 크게 보기');
    await k.evaluate(function () { document.querySelector('#wmNoticeImg [data-wm-close]').click(); });
    await k.click('#wmNoticePop [data-nt="pop-ok"]');
    await until(k, function () { return !document.getElementById('wmNoticePop'); });
    await k.evaluate(function () { wmNoticeOpen(); });
    await until(k, function () { return !!document.querySelector('#ntRoot .nt-card'); });
    var card = await k.evaluate(function () { var p = document.querySelector('#ntRoot .nt-prev'); return { t: p.textContent, raw: /[#*=>]|\[그림/.test(p.textContent) }; });
    check(/🖼 3/.test(card.t) && !card.raw, '목록 한 줄 미리보기 — 🖼 3 · 기호 없이 ' + card.t.slice(0, 50));
    await k.click('#ntRoot .nt-card-h');
    check(await until(k, function () { return document.querySelectorAll('#ntRoot .nt-card .nt-body img.nt-img').length === 3; }, null, 10000), '펼치면 그림까지');
    check(await k.evaluate(function () { return !document.querySelector('#ntRoot [data-nt="new"]'); }), '팀원은 쓰기 단추 없음');

    /* ── 고치기: 그림 그대로 · 한 장 빼기 ── */
    await a.click('#ntRoot .nt-row [data-nt="edit"]');
    check(await until(a, function () { return document.querySelectorAll('#ntThumbs .nt-thumb').length === 3; }, null, 10000), '고치기 — 붙어 있던 그림 3장');
    await a.click('#ntThumbs .nt-thumb:nth-child(3) [data-nt="img-del"]');
    check(await a.evaluate(function () { return document.querySelectorAll('#ntThumbs .nt-thumb').length === 2 && document.querySelectorAll('#ntPv img.nt-img').length === 2; }), '그림 빼기 → 미리보기에서도 사라짐');
    // 캡처 붙여넣기 (Ctrl+V)
    await a.evaluate(function () {
      var cv = document.createElement('canvas'); cv.width = 400; cv.height = 240; var x = cv.getContext('2d'); x.fillStyle = '#2563eb'; x.fillRect(0, 0, 400, 240); x.fillStyle = '#fff'; x.font = '30px sans-serif'; x.fillText('PASTE', 140, 130);
      return new Promise(function (res) { cv.toBlob(function (bl) {
        var dt = new DataTransfer(); dt.items.add(new File([bl], 'cap.png', { type: 'image/png' }));
        var ta = document.getElementById('ntBody'); ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length;
        var ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }); ta.dispatchEvent(ev); res();
      }, 'image/png'); });
    });
    check(await until(a, function () { return document.querySelectorAll('#ntThumbs .nt-thumb').length === 3 && /\[그림3\]\s*$/.test(document.getElementById('ntBody').value); }), '캡처 붙여넣기 → 그림 추가 + 그 자리에 [그림3]');
    await a.click('#ntRoot [data-nt="save"]');
    await until(a, function () { return !document.getElementById('ntBody'); }, null, 15000);
    var n2 = (await c.query('SELECT COUNT(*)::int AS n, MIN(length(src)) AS small FROM notice_images WHERE notice_id = $1', [dbn.id])).rows[0];
    check(n2.n === 3 && n2.small < 20000, '저장 — 그림 3장 (붙여넣은 것 포함)');

    /* ── 서버 검사 ── */
    var api = function (p, url, method, body) { return p.evaluate(function (u, m, b) { return fetch(u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + _accessToken }, body: b ? JSON.stringify(b) : undefined }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }, function () { return { s: r.status }; }); }); }, url, method, body); };
    var px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    check((await api(a, '/api/notices', 'POST', { title: 'x', images: ['data:text/html;base64,PHNjcmlwdD4='] })).s === 400, '그림이 아닌 것은 거절');
    check((await api(a, '/api/notices', 'POST', { title: 'x', images: ['javascript:alert(1)'] })).s === 400, '주소 모양은 거절');
    check((await api(a, '/api/notices', 'POST', { title: 'x', images: [px, px, px, px, px, px, px, px, px] })).s === 400, '9장은 거절 (8장까지)');
    var dr = await api(a, '/api/notices', 'POST', { title: '임시 공지', body: '[그림1]', images: [px] });
    check(dr.s === 201 && dr.j.data.imageCount === 1, '임시 저장에도 그림');
    check((await api(k, '/api/notices/' + dr.j.data.id + '/images', 'GET')).s === 404, '임시 공지의 그림은 팀원에게 안 보임');
    check((await api(k, '/api/notices/' + dbn.id + '/images', 'GET')).j.data.length === 3, '게시된 공지의 그림은 팀원도 받음');
    var keep = await api(a, '/api/notices/' + dr.j.data.id, 'PUT', { title: '임시 공지 2' });
    var cnt = (await c.query('SELECT COUNT(*)::int AS n FROM notice_images WHERE notice_id = $1', [dr.j.data.id])).rows[0].n;
    check(keep.s === 200 && cnt === 1, '그림 없이 고치면 붙어 있던 그림은 그대로');
    await api(a, '/api/notices/' + dr.j.data.id, 'DELETE');
    check((await c.query('SELECT COUNT(*)::int AS n FROM notice_images WHERE notice_id = $1', [dr.j.data.id])).rows[0].n === 0, '공지를 지우면 그림도 지워짐');

    /* ── 휴대폰 폭 ── */
    k = await open('kim@t.com', { width: 390, height: 800, isMobile: true, hasTouch: true });
    await k.evaluate(function (id) { wmNoticeOpen(id); }, dbn.id);
    check(await until(k, function () { var im = document.querySelectorAll('#ntRoot .nt-card .nt-body img.nt-img'); return im.length >= 3 && [].every.call(im, function (i) { return i.complete && i.naturalWidth; }); }, null, 15000), '휴대폰 — 공지를 열면 그림까지');
    var mob = await k.evaluate(function () { var r = document.getElementById('ntRoot'), im = document.querySelector('#ntRoot img.nt-img').getBoundingClientRect(); return { fit: r.scrollWidth <= r.clientWidth + 1, w: Math.round(im.width), right: Math.round(im.right) }; });
    check(mob.fit && mob.right <= 390 && mob.w > 200, '휴대폰 — 그림이 화면 폭에 맞음 ' + JSON.stringify(mob));
    await k.screenshot({ path: path.join(SHOT, 'e2e105-mobile.png') });

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { for (var i = 0; i < B.length; i++) await B[i].close(); await c.query('DELETE FROM notices WHERE tenant_id = $1', [adm.tenant_id]); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
