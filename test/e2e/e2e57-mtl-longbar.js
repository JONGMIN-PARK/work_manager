// 내 업무 타임라인 — 긴 프로젝트 막대 (v13.312) · 줄 이름 → 항목 목록 · 이동 (v13.313): 뒤쪽 달로 옮겨도 이름 · 진행률이 보이는 자리에 따라옴 · 막대 안 진행률 채움 · 끝 날짜 · 휴대폰
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var me = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  await c.query("DELETE FROM my_projects WHERE id LIKE 'mlb-%'");
  await c.query("INSERT INTO my_projects (id, tenant_id, user_id, title, start_date, end_date, status, progress, visible, color) VALUES ('mlb-1', $1, $2, '긴막대 장비 개조 프로젝트', $3, $4, 'doing', 40, true, '#3B82F6')", [me.tenant_id, me.id, kst(-60), kst(120)]);
  await c.query("INSERT INTO my_projects (id, tenant_id, user_id, title, start_date, end_date, status, progress, visible, color) VALUES ('mlb-2', $1, $2, '긴막대 짧은 일', $3, $4, 'doing', 70, true, '#10B981')", [me.tenant_id, me.id, kst(1), kst(2)]);
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var BAR = '.mtl-proj[data-tk="pj:mlb-1"]';
  function look() {
    return page.evaluate(function (sel) {
      var b = document.querySelector(sel); if (!b) return null;
      var sc = b.closest('.mtl-sc').getBoundingClientRect(), lnw = b.closest('.mtl-lane').querySelector('.mtl-ln').getBoundingClientRect().width;
      var s = b.querySelector('.mtl-stk'), e = b.querySelector('.mtl-end'), sr = s.getBoundingClientRect(), er = e && e.getBoundingClientRect();
      var visL = sc.left + lnw, visR = sc.right;
      return { txt: s.textContent, inView: sr.left >= visL - 1 && sr.left <= visL + 12 && sr.right <= visR + 1, barL: Math.round(b.getBoundingClientRect().left - visL),
        end: e ? e.textContent : null, endIn: er ? er.right <= visR + 1 && er.left >= visL : false, fill: b.querySelector('.mtl-pf').style.width };
    }, BAR);
  }
  try {
    await page.setViewport({ width: 1400, height: 1000 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await page.click('#tabMyWork');
    await page.waitForFunction(function () { return typeof _mtlMain !== 'undefined' && _mtlMain; }, { timeout: 15000 });
    await page.evaluate(function () { if (_mtlMain.st.fold) { _mtlMain.st.fold = false; } _mtlMain.st.group = 'proj'; _mtlMain.st.ppd = 8; _mtlMain.save(true); _mtlMain.update(); });
    await page.waitForSelector(BAR, { timeout: 10000 });
    // 시작 쪽 · 두 달 뒤 · 넉 달 뒤 — 언제 봐도 이름 · 진행률이 보이는 자리 왼쪽에
    var at = [];
    for (var k of [-50, 60, 110]) {
      await page.evaluate(function (d) { _mtlMain.goDate(d); }, kst(k));
      await wait(250);
      at.push(await look());
    }
    check(at.every(function (a) { return a && /긴막대 장비 개조 프로젝트/.test(a.txt) && /40%/.test(a.txt); }), '이름 + 진행률 배지 ' + JSON.stringify(at.map(function (a) { return a && a.txt; })));
    check(at[1].barL < -200 && at[1].inView && at[2].inView, '뒤쪽 달로 옮겨도 이름이 보이는 자리 왼쪽에 ' + JSON.stringify(at.map(function (a) { return [a.barL, a.inView]; })));
    check(at[1].endIn && /^~\d\d\/\d\d$/.test(at[1].end), '끝 날짜가 오른쪽 끝에 ' + at[1].end);
    check(at[0].fill === '40%', '막대 안 진행률 채움 40%');
    await page.screenshot({ path: path.join(SHOT, 'mtl-longbar.png') });

    // v13.313 줄 이름에 마우스 → 그 줄 항목 목록 · 누르면 그 항목으로 이동 · 반짝
    await page.evaluate(function (d) { _mtlMain.goDate(d); }, kst(300));
    await wait(250);
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(function () {});
    var lr = await page.evaluate(function () { var e = document.querySelector('.mtl-ln[data-ln="pj:mlb-1"]'); e.scrollIntoView({ block: 'nearest' }); var r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 10 }; });
    await page.mouse.move(lr.x - 300, lr.y); await page.mouse.move(lr.x, lr.y, { steps: 3 });
    await page.waitForSelector('#mtlLanePop .mtl-lp-r', { timeout: 3000 }).catch(function () {});
    var pop = await page.evaluate(function () { var p = document.getElementById('mtlLanePop'); return p && { h: p.querySelector('.mtl-lp-h').textContent, rows: Array.prototype.map.call(p.querySelectorAll('.mtl-lp-r'), function (r) { return r.textContent; }) }; });
    check(pop && /긴막대 장비 개조 프로젝트/.test(pop.h) && pop.rows.length === 1 && /40%/.test(pop.rows[0]) && /진행 중/.test(pop.rows[0]), '줄 이름 마우스 → 항목 목록 ' + JSON.stringify(pop));
    await page.screenshot({ path: path.join(SHOT, 'mtl-lanepop.png') });
    await page.evaluate(function () { document.querySelector('#mtlLanePop .mtl-lp-r').click(); });
    await wait(300);
    var j = await look();
    var fl = await page.evaluate(function (s) { return !!document.querySelector(s + '.mtl-flash') && !document.getElementById('mtlLanePop'); }, BAR);
    check(j && j.inView && fl, '누르면 그 항목으로 이동 · 반짝 · 목록 닫힘 ' + JSON.stringify([j && j.inView, fl]));
    // 키보드 — Enter 로 열고 Esc 로 닫기
    await page.evaluate(function () { document.querySelector('.mtl-ln[data-ln="pj:mlb-1"]').focus(); });
    await page.keyboard.press('Enter');
    var kb = await page.evaluate(function () { return !!document.getElementById('mtlLanePop') && document.activeElement.classList.contains('mtl-lp-r'); });
    await page.keyboard.press('Escape');
    check(kb && await page.evaluate(function () { return !document.getElementById('mtlLanePop'); }), '키보드 — Enter 열기 · 첫 줄 초점 · Esc 닫기');
    // ↗ 자세히 — 상세 패널
    await page.evaluate(function () { document.querySelector('.mtl-ln[data-ln="pj:mlb-1"]').click(); });
    await page.waitForSelector('#mtlLanePop [data-open]', { timeout: 3000 });
    await page.evaluate(function () { document.querySelector('#mtlLanePop [data-open]').click(); });
    check(await page.waitForFunction(function () { return /긴막대 장비 개조 프로젝트/.test((document.querySelector('.mwp') || {}).textContent || ''); }, { timeout: 5000 }).then(function () { return true; }, function () { return false; }), '↗ → 상세 패널');
    await page.evaluate(function () { if (typeof mwProjClose === 'function') mwProjClose(); });
    var short = await page.evaluate(function () { var b = document.querySelector('.mtl-proj[data-tk="pj:mlb-2"]'); return b && { short: b.classList.contains('is-short') || b.offsetWidth >= 60, txt: b.textContent }; });
    check(short && /긴막대 짧은 일/.test(short.txt) && /70%/.test(short.txt), '짧은 막대 — 옆 글자에 진행률 ' + JSON.stringify(short));
    // 휴대폰
    await page.setViewport({ width: 402, height: 874, isMobile: true, hasTouch: true });
    await wait(500);
    await wait(400); await page.evaluate(function () { if (typeof _mtlMain !== 'undefined' && _mtlMain && _mtlMain.st.collapsed) { _mtlMain.st.collapsed = false; _mtlMain.save(true); _mtlMain.update(); } });   // v13.403 좁은 창은 접힌 채 시작 — 펴고 시험
    await page.evaluate(function (d) { _mtlMain.update(); _mtlMain.goDate(d); }, kst(60));
    await wait(300);
    var m = await look();
    check(m && m.inView && /40%/.test(m.txt), '휴대폰 — 뒤쪽 달에서도 이름 · 진행률 ' + JSON.stringify(m));
    await page.evaluate(function (s) { document.querySelector(s).scrollIntoView({ block: 'center' }); }, BAR);
    await page.screenshot({ path: path.join(SHOT, 'mtl-longbar-phone.png') });
    await page.tap('.mtl-ln[data-ln="pj:mlb-1"]');
    await wait(400);
    var mp = await page.evaluate(function () { var p = document.getElementById('mtlLanePop'); if (!p) return null; var r = p.getBoundingClientRect(); return { l: r.left, r: r.right, rows: p.querySelectorAll('.mtl-lp-r').length }; });
    check(mp && mp.l >= 0 && mp.r <= 402 && mp.rows === 1, '휴대폰 — 줄 이름 누르면 목록 · 화면 안 ' + JSON.stringify(mp));
    await page.screenshot({ path: path.join(SHOT, 'mtl-lanepop-phone.png') });
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  } catch (e) {
    fail++; console.log('FAIL 예외', e && e.stack);
  }
  try { await c.query("DELETE FROM my_projects WHERE id LIKE 'mlb-%'"); } catch (e) {}
  await c.end();
  await browser.close();
  console.log(fail ? ('FAILED ' + fail + ' / ' + (ok + fail)) : ('ALL PASS (' + ok + ')'));
  process.exit(fail ? 1 : 0);
})();
