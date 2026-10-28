// 상황별 추천 템플릿 — 갤러리 · 미리 보기 · 예제 넣기 / 빼기 · 기본 제목 · 구조, 팀원도 마인드맵 사용 · 카드에서 보내기 (v13.249)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function loginPage(browser, email) {
  var ctx = await browser.createBrowserContext();
  var page = await ctx.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#loginEmail', { visible: true });
  await page.type('#loginEmail', email); await page.type('#loginPw', 'Test1234!');
  await page.keyboard.press('Enter');
  await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
  await wait(400);
  return page;
}
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var errs = [];
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  try {
    // 팀원(이팀원)이 직접 씀
    var page = await loginPage(browser, 'lee@t.com');
    page.on('pageerror', function (e) { errs.push(e.message); });
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    // 모든 템플릿이 틀 · 예제 모두 나무로 만들어짐
    var bad = await page.evaluate(function () {
      var out = [];
      MM_TEMPLATES.forEach(function (t) {
        [t.tree, t.ex].forEach(function (fn) {
          if (!fn) return;
          try { var n = _mmBuildTree(fn('제목')); if (n.text !== '제목') out.push(t.k + ' 루트'); } catch (e) { out.push(t.k + ' ' + e.message); }
        });
        if (!MM_TPL_CATS.some(function (c) { return c.k === t.cat; })) out.push(t.k + ' 분류');
      });
      MM_TPL_REC.forEach(function (k) { if (!MM_TEMPLATES.some(function (t) { return t.k === k; })) out.push('추천 ' + k); });
      return { bad: out, n: MM_TEMPLATES.length, ex: MM_TEMPLATES.filter(function (t) { return t.ex; }).length };
    });
    check(!bad.bad.length && bad.n >= 18 && bad.ex >= 17, '템플릿 ' + bad.n + '개 · 예제 ' + bad.ex + '개 모두 만들어짐 ' + JSON.stringify(bad.bad));

    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmTplGrid .mm-tpl-card');
    var rec = await page.$$eval('#mmTplGrid .mm-tpl-card', function (c) { return c.map(function (x) { return x.getAttribute('data-k'); }); });
    check(rec.join(',') === 'meeting,weekly,kickoff,fishbone,brainstorm,handover', '처음엔 추천 6개 ' + rec);
    check(!(await page.$('#mmNewScope')), '공개 범위 고르기 없음');
    // 문제 해결 → 불량 원인 분석
    await page.click('#mmTplCats [data-cat="fix"]');
    await page.waitForSelector('#mmTplGrid [data-k="fishbone"]');
    await page.click('#mmTplGrid [data-k="fishbone"]');
    var prev = await page.$eval('#mmNewPrev', function (e) { return e.textContent; });
    check(/기계 \(Machine\)/.test(prev) && /그리퍼 마모/.test(prev), '미리 보기에 예제 ' + prev.slice(0, 80));
    await page.screenshot({ path: path.join(SHOT, 'templates.png') });
    await page.click('#mmNewOk');   // 제목 비움 → 템플릿 이름
    await page.waitForSelector('#mmStage .mm-root');
    await wait(300);
    var info = await page.evaluate(function () {
      var sh = _mm.doc.sheets[0];
      return { title: _mm.row.title, st: sh.structure, root: sh.root.text, kids: sh.root.children.map(function (c) { return c.text + ':' + c.children.map(function (k) { return k.text; }).join('/'); }) };
    });
    check(info.title === '불량 원인 분석 (4M)' && info.root === info.title, '제목 비우면 템플릿 이름 ' + info.title);
    check(info.st === 'fishbone', '구조 = 피시본');
    check(info.kids.some(function (k) { return /^기계 \(Machine\):그리퍼 마모/.test(k); }), '예제 내용이 들어감 ' + info.kids[1]);
    // 예제 빼고 — 킥오프 가지 이름만
    await page.click('[data-act="back"]');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmTplGrid [data-k="kickoff"]');
    await page.click('#mmTplGrid [data-k="kickoff"]');
    await page.click('#mmNewEx');
    await page.type('#mmNewTitle', '3호기 킥오프');
    await page.click('#mmNewOk');
    await page.waitForFunction(function () { return _mm.row && _mm.row.title === '3호기 킥오프' && document.querySelector('#mmStage .mm-root'); });
    var k = await page.evaluate(function () { var r = _mm.doc.sheets[0].root; return { n: r.children.length, deep: r.children.some(function (c) { return c.children.length; }) }; });
    check(k.n === 6 && !k.deep, '예제 끄면 가지 이름만 (6개)');
    var mapId = await page.evaluate(function () { return _mm.mapId; });
    // 목록 카드에서 김에게 보내기
    await page.click('[data-act="back"]');
    await page.waitForSelector('#mindmapWrap .mm-card[data-id="' + mapId + '"] [data-act="send"]');
    check(/내 맵/.test(await page.$eval('#mindmapWrap .mm-card[data-id="' + mapId + '"] .mm-badge', function (e) { return e.textContent; })), '내 맵 배지');
    await page.click('#mindmapWrap .mm-card[data-id="' + mapId + '"] [data-act="send"]');
    await page.waitForSelector('#mmShareModal .mm-sh-role');
    var kimId = await page.evaluate(function () { return _mm.members.filter(function (u) { return u.name === '김팀원'; })[0].id; });
    await page.select('#mmShareModal .mm-sh-role[data-uid="' + kimId + '"]', 'view');
    check(/1명이 볼 수 있음/.test(await page.$eval('#mmShCount', function (e) { return e.textContent; })), '보낼 사람 수 표시');
    await page.click('#mmShOk');
    await page.waitForFunction(function () { return !document.getElementById('mmShareModal'); });
    await page.waitForFunction(function (id) { var c = document.querySelector('#mindmapWrap .mm-card[data-id="' + id + '"]'); return c && /1명에게 보냄/.test(c.textContent); }, {}, mapId);
    check(true, '카드에 1명에게 보냄');
    // 김: 받은 맵 탭에 보기로
    var kim = await loginPage(browser, 'kim@t.com');
    await kim.click('#tabMindmap');
    await kim.waitForSelector('#mindmapWrap [data-act="tab"][data-tab="shared"]');
    await kim.click('#mindmapWrap [data-act="tab"][data-tab="shared"]');
    await kim.waitForSelector('#mindmapWrap .mm-card[data-id="' + mapId + '"]');
    var badge = await kim.$eval('#mindmapWrap .mm-card[data-id="' + mapId + '"] .mm-badge', function (e) { return e.textContent; });
    check(/받은 맵 · 보기/.test(badge), '김: 받은 맵 · 보기 ' + badge);
    check(!(await kim.$('#mindmapWrap .mm-card[data-id="' + mapId + '"] [data-act="send"]')) && !(await kim.$('#mindmapWrap .mm-card[data-id="' + mapId + '"] [data-act="del"]')), '받은 사람은 보내기 · 삭제 없음');
    // 보내지 않은 첫 맵(불량 원인)은 김에게 안 보임
    check(!(await kim.evaluate(function () { return _mm.list.some(function (m) { return m.title === '불량 원인 분석 (4M)'; }); })), '보내지 않은 맵은 안 보임');
    console.log(fail ? 'FAILED ' + fail : 'ALL PASS ' + ok, errs);
  } catch (e) { console.log('ERR', e.message); } finally { await browser.close(); }
})();
