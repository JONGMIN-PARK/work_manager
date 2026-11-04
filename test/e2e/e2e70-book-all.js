// 📖 펼쳐 보기 — 모든 노트 (v13.326): 📓 노트북 노트 · 📋 업무일지 · 🤝 회의록 · 종류 칩 · 마크다운 종이 · 권한 · 원래 화면 열기 · 회의 카드 📖
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var me = (await c.query("SELECT id, tenant_id, name FROM users WHERE email = 'admin@t.com'")).rows[0];
  var K = 'bk' + Date.now().toString(36);
  async function clean() {
    await c.query('DELETE FROM my_notes WHERE user_id = $1', [me.id]);
    await c.query("DELETE FROM work_records WHERE content LIKE 'bk%'");
    await c.query("DELETE FROM nb_notes WHERE title LIKE 'bk%'");
    await c.query("DELETE FROM projects WHERE name LIKE 'bk% 책 프로젝트'");
  }
  await clean();
  await c.query('INSERT INTO work_records (date, name, order_no, hours, content, ocmt, user_id, tenant_id) VALUES ($1, $2, $3, 2, $4, $5, $6, $7), ($1, $2, NULL, 1.5, $8, NULL, $6, $7)',
    [kst(-1), me.name, 'S-' + K, K + ' 설비 점검', '고객 확인 필요', me.id, me.tenant_id, K + ' 보고서 작성']);
  await c.query("INSERT INTO my_notes (user_id, note_date, ref, tenant_id, body) VALUES ($1, $2, '', $3, $4)", [me.id, kst(0), me.tenant_id, K + ' 오늘 메모']);

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  var ok = 0, fail = 0;
  function check(cnd, m) { if (cnd) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function until(fn, arg, ms) { return page.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var ev = function (fn, arg) { return page.evaluate(fn, arg); };
  var api = function (url, method, body) { return ev(function (a) { return apiFetch(a[0], a[1] ? { method: a[1], body: JSON.stringify(a[2]) } : undefined).then(function (r) { return r && r.data; }).catch(function (e) { return { _err: e.message }; }); }, [url, method || null, body || null]); };
  var pages = function () { return ev(function () { return Array.prototype.map.call(document.querySelectorAll('#mwnsBook > .mwns-page'), function (p) { return p.getAttribute('data-k'); }); }); };
  var loaded = function (n) { return until(function (nn) { var b = document.getElementById('mwnsBook'); return b && b.querySelectorAll(':scope > .mwns-page').length === nn && !/불러오는 중/.test(b.textContent); }, n); };
  async function login(email) {
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await ev(function () { try { localStorage.clear(); } catch (_) {} });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', email); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(500);
  }
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await login('admin@t.com');
    // 노트북 노트 · 비공개 프로젝트 회의록
    var note = await api('/api/notebook/notes', 'POST', { title: K + ' 설계 노트', body: '# ' + K + ' 설계 노트\n\n## 할 것\n- [ ] 도면 검토\n- [x] 견적 요청\n\n**굵게** 쓴 글' });
    var proj = await api('/api/projects', 'POST', { name: K + ' 책 프로젝트', visibility: 'private' });
    var mtg = await api('/api/meetings', 'POST', { projectId: proj.id, title: K + ' 착수 회의', meetDate: kst(-2), minutes: '납기 ' + K + ' 확정', agenda: [{ text: '일정 확인', done: true, result: '12월 납품' }] });
    check(note && note.id && proj && proj.id && mtg && mtg.id, '시험 데이터 만듦');

    // 1. 서버 — 책장 · 종이
    var shelf = await api('/api/notebook/shelf');
    var kinds = {};
    (shelf || []).forEach(function (x) { if (String(x.title + x.snip + x.sub).indexOf(K) >= 0 || x.key === 'log:' + kst(-1)) kinds[x.kind] = x; });
    check(kinds.note && kinds.meeting && kinds.log && kinds.daily, '책장에 네 종류 ' + Object.keys(kinds).join(','));
    check(kinds.log && kinds.log.sub === '2건 · 3.5시간', '업무일지 = 날마다 한 장 (' + (kinds.log && kinds.log.sub) + ')');
    check(kinds.meeting && kinds.meeting.sub === K + ' 책 프로젝트', '회의록 옆에 프로젝트 이름');
    var pgs = await api('/api/notebook/shelf/pages', 'POST', { keys: ['meeting:' + mtg.id, 'log:' + kst(-1), 'note:' + note.id, 'note:없는것', 'daily:' + kst(0) + '|'] });
    var mp = pgs['meeting:' + mtg.id];
    check(mp && mp.mode === 'md' && /## 안건/.test(mp.text) && /- \[x\] 일정 확인 → 12월 납품/.test(mp.text) && /## 회의 내용/.test(mp.text), '회의록 종이 = 안건 · 회의 내용 마크다운');
    var lp = pgs['log:' + kst(-1)];
    check(lp && /설비 점검 _\(2h · S-/.test(lp.text) && /💬 고객 확인 필요/.test(lp.text), '업무일지 종이 = 한 줄씩 · 시간 · 수주 · 코멘트');
    check(pgs['daily:' + kst(0) + '|'] && pgs['daily:' + kst(0) + '|'].mode === 'lines', '일일 노트는 줄 그대로');
    check(!('note:없는것' in pgs), '없는 것은 빠짐');

    // 2. 노트북에서 📖 — 그 노트부터 · 📓 종류
    await ev(function (id) { nbOpenNote(id); }, note.id);
    await page.waitForSelector('#mNotebook .nb-top [data-nb="book"]', { visible: true, timeout: 10000 });
    await page.click('#mNotebook .nb-top [data-nb="book"]');
    check(await loaded(1) || await loaded(2), '노트북 📖 → 펼쳐 보기');
    var p = await pages();
    check(p.indexOf('note:' + note.id) >= 0, '보던 노트가 펼쳐짐 ' + JSON.stringify(p));
    check(await ev(function () { return document.querySelector('#mwnSpreadModal .mwns-kinds .on').getAttribute('data-v') === 'note'; }), '목록은 📓 노트 종류부터');
    check(await ev(function (id) { var pg = document.querySelector('#mwnsBook > .mwns-page[data-k="note:' + id + '"]'); return pg && !!pg.querySelector('.mwns-md h2') && pg.querySelectorAll('.mwns-md input[type=checkbox]').length === 2 && !!pg.querySelector('.mwns-md strong'); }, note.id), '노트는 마크다운으로 (제목 · 체크 · 굵게)');

    // 3. 전체 칩 → 업무일지 · 회의록 골라 같이 펼치기
    await page.click('#mwnSpreadModal .mwns-kinds [data-v="all"]');
    check(await until(function () { return !!document.querySelector('#mwnsList [data-pk^="log:"]') && !!document.querySelector('#mwnsList [data-pk^="meeting:"]') && !!document.querySelector('#mwnsList [data-pk^="daily:"]'); }), '전체 → 일일 노트 · 업무일지 · 회의록도 목록에');
    await ev(function () { _wb.pick = []; _wbPaintList(); _wbLoad(); });
    await page.click('#mwnsList [data-pk="note:' + note.id + '"]');
    await page.click('#mwnsList [data-pk="log:' + kst(-1) + '"]');
    await page.click('#mwnsList [data-pk="meeting:' + mtg.id + '"]');
    check(await loaded(3), '노트 · 업무일지 · 회의록 세 장');
    p = await pages();
    check(p[0] === 'meeting:' + mtg.id && p[1] === 'log:' + kst(-1) && p[2] === 'note:' + note.id, '날짜 순 (옛 장 왼쪽) ' + JSON.stringify(p));
    var hd = await ev(function () { return Array.prototype.map.call(document.querySelectorAll('#mwnsBook > .mwns-page header .mwns-ph'), function (h) { return h.textContent; }); });
    check(/🤝/.test(hd[0]) && hd[0].indexOf('착수 회의') >= 0 && hd[0].indexOf('책 프로젝트') >= 0, '회의록 머리 = 🤝 제목 · 프로젝트 [' + hd[0] + ']');
    check(/📋/.test(hd[1]) && /업무일지/.test(hd[1]) && /2건/.test(hd[1]), '업무일지 머리 = 📋 날짜 · 건수 [' + hd[1] + ']');
    var lg = await ev(function (k) { var pg = document.querySelector('#mwnsBook > .mwns-page[data-k="' + k + '"]'); return pg ? pg.querySelectorAll('.mwns-md li').length : -1; }, 'log:' + kst(-1));
    check(lg === 3, '업무일지 = 기록 2줄 + 코멘트 1줄 (' + lg + ')');
    await page.screenshot({ path: path.join(SHOT, 'e2e70-mixed.png') });

    // 4. 종류 칩으로 고르고 넘기기 — 🤝 회의록만 보이게 하고 ‹ 넘기면 회의록끼리
    await page.click('#mwnSpreadModal .mwns-kinds [data-v="meeting"]');
    check(await ev(function () { return Array.prototype.every.call(document.querySelectorAll('#mwnsList .mwns-it'), function (x) { return /^meeting:/.test(x.getAttribute('data-pk')); }); }), '🤝 칩 → 회의록만');
    await page.type('#mwnsQ', K);
    check(await until(function () { return document.querySelectorAll('#mwnsList .mwns-it').length === 1; }), '찾기 → 그 회의 하나');

    // 5. 회의록 머리 → 프로젝트 회의 화면
    await page.click('#mwnsBook > .mwns-page[data-k="meeting:' + mtg.id + '"] .mwns-ph');
    check(await until(function (id) { return !document.getElementById('mwnSpreadModal') && !!document.getElementById('pmt-card-' + id); }, mtg.id, 10000), '회의록 머리 → 프로젝트 회의 카드');
    // 6. 회의 카드의 📖 → 그 회의부터
    await wait(600);
    var hasBtn = await ev(function (id) { var b = document.querySelector('[data-pmt-book="' + id + '"]'); if (b) b.click(); return !!b; }, mtg.id);
    if (!hasBtn) await ev(function (id) { pmtToggleCard(id); }, mtg.id), await wait(500), hasBtn = await ev(function (id) { var b = document.querySelector('[data-pmt-book="' + id + '"]'); if (b) b.click(); return !!b; }, mtg.id);
    check(hasBtn, '회의 카드에 📖 펼쳐 보기');
    check(await until(function (id) { return !!document.querySelector('#mwnsBook > .mwns-page[data-k="meeting:' + id + '"]') && document.querySelector('#mwnSpreadModal .mwns-kinds .on').getAttribute('data-v') === 'meeting'; }, mtg.id), '회의 카드 📖 → 그 회의록 · 🤝 종류');
    await ev(function () { var m = document.getElementById('mwnSpreadModal'); if (m) m.remove(); });

    // 7. 업무일지 머리 → 주간 업무 화면
    await ev(function (d) { wmBookOpen({ cur: 'log:' + d }); }, kst(-1));
    await loaded(2).catch(function () {});
    await page.waitForSelector('#mwnsBook > .mwns-page[data-k="log:' + kst(-1) + '"] .mwns-ph', { timeout: 8000 });
    await page.click('#mwnsBook > .mwns-page[data-k="log:' + kst(-1) + '"] .mwns-ph');
    check(await until(function () { return !document.getElementById('mwnSpreadModal') && typeof curPage !== 'undefined' && curPage === 'team'; }, null, 8000), '업무일지 머리 → 업무 관리(주간 업무)');

    // 8. 권한 — 다른 사람은 내 노트 · 업무일지 · 비공개 프로젝트 회의록을 못 봄
    await login('kim@t.com');
    var ks = await api('/api/notebook/shelf');
    check(Array.isArray(ks) && !ks.some(function (x) { return String(x.title + x.snip + x.sub).indexOf(K) >= 0 || x.key === 'note:' + note.id || x.key === 'meeting:' + mtg.id; }), '다른 사람 책장엔 안 나옴');
    var kp = await api('/api/notebook/shelf/pages', 'POST', { keys: ['meeting:' + mtg.id, 'note:' + note.id, 'log:' + kst(-1)] });
    check(kp && !kp['meeting:' + mtg.id] && !kp['note:' + note.id] && !(kp['log:' + kst(-1)] && /설비 점검/.test(kp['log:' + kst(-1)].text)), '키를 알아도 못 받음');

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  await clean().catch(function () {});
  await c.end();
  await browser.close();
  console.log(fail ? 'FAILED ' + fail + ' (ok ' + ok + ')' : 'ALL PASS ' + ok);
  process.exit(fail ? 1 : 0);
})();
