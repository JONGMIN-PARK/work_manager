// 💬 텔레그램 화면 (v13.304 · v13.305) — 프로젝트 ⋯ → 그룹방 창(목록 · 링크 · 해제) · 🌙 방해 금지 · ?go= 웹에서 열기 · 휴대폰 폭
// /api/telegram/* 는 가로채서 준다 (run.sh 서버엔 봇 토큰이 없음)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var hits = { code: 0, del: 0, quiet: [] };
  function json(req, body, status) { return req.respond({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) }); }
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    var u = req.url(), m = req.method();
    if (u.indexOf('/api/telegram/groups/') >= 0 && m === 'DELETE') { hits.del++; return json(req, { data: { removed: true } }); }
    if (u.indexOf('/api/telegram/groups?') >= 0) {
      return json(req, { data: hits.del ? [] : [{ id: 7, title: '<b>설비</b> 방', linked_at: '2026-11-02T01:00:00Z', linked_by_name: '김' }], canEdit: true, configured: true });
    }
    if (u.indexOf('/api/telegram/group-code') >= 0) { hits.code++; return json(req, { data: { code: 'G1A2B3C4D', botUsername: 'wm_bot', link: 'https://t.me/wm_bot?startgroup=G1A2B3C4D', expiresInSeconds: 1800 } }); }
    if (u.indexOf('/api/telegram/prefs/quiet') >= 0) { hits.quiet.push(JSON.parse(req.postData() || '{}')); return json(req, { data: {} }); }
    if (u.indexOf('/api/telegram/prefs') >= 0 && m === 'GET') {
      var q = hits.quiet.length ? hits.quiet[hits.quiet.length - 1] : { start: '22:00', end: '07:00' };
      return json(req, { data: {}, remindLead: 30, recSlots: '13:30', quietStart: q.start, quietEnd: q.end });
    }
    req.continue();
  });
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(600);
    var proj = await page.evaluate(function () { return apiFetch('/api/projects').then(function (r) { var p = (r.data || [])[0]; return p && { id: p.id, name: p.name }; }); });
    check(!!proj, '프로젝트 하나 ' + JSON.stringify(proj));

    // 1) 프로젝트 ⋯ → 💬 텔레그램 그룹방
    await page.evaluate(function (id) { setPage('project'); showProjectDetail(id); }, proj.id);
    await page.waitForSelector('#projDetailPanel .pd-more-menu', { timeout: 10000 });
    await page.evaluate(function () { pdToggleMore(); });
    var item = await page.evaluate(function () {
      var b = Array.prototype.filter.call(document.querySelectorAll('#projDetailPanel .pd-more-menu button'), function (x) { return x.textContent.indexOf('텔레그램 그룹방') >= 0; })[0];
      if (b) b.click();
      return !!b;
    });
    check(item, '⋯ 메뉴에 💬 텔레그램 그룹방');
    await page.waitForSelector('#tgGroupModal .tgg-row', { timeout: 8000 }).catch(function () {});
    var list = await page.evaluate(function () {
      var m = document.getElementById('tgGroupModal'); if (!m) return null;
      var row = m.querySelector('.tgg-row');
      return { title: row && row.querySelector('.tgg-t').textContent, bold: !!m.querySelector('.tgg-t b'), unlink: !!(row && row.querySelector('button')), make: !!m.querySelector('#tggMake') };
    });
    check(list && list.title.indexOf('<b>설비</b> 방') >= 0 && !list.bold, '연결된 방 이름 — 태그는 글자로 ' + JSON.stringify(list));
    check(list && list.unlink && list.make, '해제 · 연결 링크 만들기 단추');

    // 2) 연결 링크
    await page.click('#tggMake');
    await page.waitForSelector('#tggNew a[href*="startgroup"]', { timeout: 5000 }).catch(function () {});
    var link = await page.evaluate(function () {
      var a = document.querySelector('#tggNew a'); var c = document.querySelector('#tggNew .tgg-code');
      return { href: a && a.getAttribute('href'), target: a && a.target, code: c && c.textContent };
    });
    check(hits.code === 1 && link.href === 'https://t.me/wm_bot?startgroup=G1A2B3C4D' && link.target === '_blank', '그룹 고르기 링크 ' + JSON.stringify(link));
    check(link.code === '/linkgroup G1A2B3C4D', '링크가 안 될 때 쓸 명령');

    // 3) 해제
    await page.evaluate(function () { var b = document.querySelector('#tggList .tgg-row button'); b.click(); });
    await wait(800);
    var after = await page.evaluate(function () { return { rows: document.querySelectorAll('#tggList .tgg-row').length, empty: (document.querySelector('#tggList .tgg-empty') || {}).textContent }; });
    check(hits.del === 1 && after.rows === 0 && /없습니다/.test(after.empty || ''), '해제 → 목록 비움 ' + JSON.stringify(after));

    // 4) 휴대폰 폭 — 창이 넘치지 않음
    await page.setViewport({ width: 390, height: 800 });
    await wait(300);
    var mob = await page.evaluate(function () {
      var box = document.querySelector('#tgGroupModal .wa-modal-box'); var r = box.getBoundingClientRect();
      return { w: Math.round(r.width), right: Math.round(r.right), sw: document.documentElement.scrollWidth };
    });
    check(mob.right <= 390 && mob.sw <= 390, '휴대폰 폭에서 창이 화면 안 ' + JSON.stringify(mob));
    await page.setViewport({ width: 1400, height: 900 });
    await page.evaluate(function () { var m = document.getElementById('tgGroupModal'); if (m) m.remove(); pdCloseDetail && pdCloseDetail(); });

    // 5) 🌙 방해 금지
    await page.evaluate(function () {
      var c = document.createElement('div'); c.id = 'tgTestBox'; c.innerHTML = '<div id="tgPrefsArea"></div>'; document.body.appendChild(c);
      loadTelegramPrefs(c);
    });
    await page.waitForSelector('#tgQuietRow', { timeout: 5000 }).catch(function () {});
    var q1 = await page.evaluate(function () {
      var on = Array.prototype.filter.call(document.querySelectorAll('#tgQuietRow [data-quiet]'), function (b) { return b.style.color === 'rgb(255, 255, 255)' || /#fff/.test(b.getAttribute('style')); }).map(function (b) { return b.textContent; });
      return { n: document.querySelectorAll('#tgQuietRow [data-quiet]').length, on: on };
    });
    check(q1.n === 4 && q1.on.length === 1 && q1.on[0] === '22~07시', '방해 금지 — 지금 설정 표시 ' + JSON.stringify(q1));
    await page.evaluate(function () { document.querySelector('#tgQuietRow [data-quiet="|"]').click(); });
    await wait(600);
    var q2 = await page.evaluate(function () {
      return Array.prototype.filter.call(document.querySelectorAll('#tgQuietRow [data-quiet]'), function (b) { return /#fff/.test(b.getAttribute('style')); }).map(function (b) { return b.textContent; });
    });
    check(hits.quiet.length === 1 && hits.quiet[0].start === '' && hits.quiet[0].end === '' && q2[0] === '끄기', '끄기 → 저장 · 다시 그림 ' + JSON.stringify({ sent: hits.quiet, on: q2 }));

    // 6) 🌐 웹에서 열기 — ?go=project:id → 그 프로젝트 · 주소 정리
    await page.goto('http://localhost:3000/?go=' + encodeURIComponent('project:' + proj.id), { waitUntil: 'networkidle2' });
    var needLogin = await page.$('#loginEmail').then(function (el) { return el && el.boundingBox(); });
    if (needLogin) {
      await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('#projDetailPanel', { timeout: 30000 }).catch(function () {});
    await wait(500);
    var deep = await page.evaluate(function () {
      var p = document.getElementById('projDetailPanel');
      return { open: !!p, name: p && (p.querySelector('h3') || {}).textContent, search: location.search };
    });
    check(deep.open && deep.name.indexOf(proj.name) >= 0, '?go=project → 그 프로젝트가 열림 ' + JSON.stringify(deep));
    check(deep.search === '', '주소에서 ?go 지움');
    var bad = await page.evaluate(function () { return [wmDeepGo('nope:1'), wmDeepGo('issue'), wmDeepGo('<script>')]; });
    check(bad.every(function (x) { return x === false; }), '모르는 · 빈 링크는 무시 ' + JSON.stringify(bad));

    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack);
  }
  await browser.close();
  console.log(fail ? ('FAILED ' + fail + ' / ' + (ok + fail)) : ('ALL PASS (' + ok + ')'));
  process.exit(fail ? 1 : 0);
})();
