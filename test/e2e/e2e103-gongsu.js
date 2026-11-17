// 📝 애니웍스 공수 등록 v13.512 — 쓰기 · 자동 저장 · (가짜 PC 앱 다리로) 웹에 입력 → 등록 → 주간일지 확인
//   진짜 애니웍스에는 가지 않는다 — window.wmDesktop.aw 를 흉내 낸 다리가 답한다. 진짜 사이트 시험은 desktop/scripts/aw-smoke.js
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  await c.query('DELETE FROM gongsu_days');
  require('fs').mkdirSync(SHOT, { recursive: true });
  var ok = 0, fail = 0, errs = [], B = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  /* 가짜 PC 앱 다리 — 페이지 스크립트보다 먼저 심는다. 올린 것은 window.__awSite 에 쌓여 「주간일지」 로 다시 나온다 */
  function fakeDesk() {
    window.__awCalls = []; window.__awSite = []; window.__awCred = false; window.__awFilled = null;
    var xls = function (rows) {
      // 진짜는 EUC-KR — 시험은 글자를 그대로 두려고 UTF-8 (TextDecoder('euc-kr') 가 ASCII 는 그대로 읽음 → 한글은 이름 대신 영문 사용)
      var h = '<table><tr><td>일자</td><td>이름</td><td>수주번호</td><td>시간</td><td>업무분장</td><td>약자</td><td>업무내용</td></tr>' +
        rows.map(function (r) { return '<tr><td>' + r.day.replace(/-/g, '') + '</td><td>' + r.name + '</td><td>' + r.orderno + '</td><td>' + r.hours + '</td><td>' + r.job + '</td><td>D</td><td>' + r.memo + '</td></tr>'; }).join('') + '</table>';
      var eu = { '일자': [0xC0, 0xCF, 0xC0, 0xDA], '이름': [0xC0, 0xCC, 0xB8, 0xA7], '수주번호': [0xBC, 0xF6, 0xC1, 0xD6, 0xB9, 0xF8, 0xC8, 0xA3], '시간': [0xBD, 0xC3, 0xB0, 0xA3], '업무분장': [0xBE, 0xF7, 0xB9, 0xAB, 0xBA, 0xD0, 0xC0, 0xE5], '약자': [0xBE, 0xE0, 0xC0, 0xDA], '업무내용': [0xBE, 0xF7, 0xB9, 0xAB, 0xB3, 0xBB, 0xBF, 0xEB] };
      var bytes = [];
      for (var i = 0; i < h.length;) {
        var hit = null; for (var k in eu) if (h.substr(i, k.length) === k) { hit = k; break; }
        if (hit) { bytes = bytes.concat(eu[hit]); i += hit.length; } else { bytes.push(h.charCodeAt(i) & 0x7F); i++; }
      }
      return btoa(String.fromCharCode.apply(null, bytes));
    };
    window.wmDesktop = { isDesktop: true, platform: 'win32', aw: function (cmd, a) {
      window.__awCalls.push(cmd);
      return new Promise(function (res) { setTimeout(function () {
        if (cmd === 'status') return res({ ok: true, v: 1, hasCred: window.__awCred, id: window.__awCred ? 'tester' : '', safe: true, maxRows: 15, memoMax: 50 });
        if (cmd === 'cred-set') { window.__awCred = a.pw !== 'bad'; return res(window.__awCred ? { ok: true } : { ok: false, error: 'x' }); }
        if (cmd === 'cred-clear') { window.__awCred = false; return res({ ok: true }); }
        if (cmd === 'test') return res({ ok: true, id: 'tester' });
        if (!window.__awCred) return res({ ok: false, code: 'NO_CRED', error: '계정 없음' });
        if (cmd === 'orders') return res({ ok: true, rows: [{ orderno: 'B26031', prodspec: 'PICAligner Bonder', cells: ['B26031', 'ACME', 'PICAligner Bonder'] }, { orderno: 'B26032', prodspec: 'Other', cells: ['B26032', 'ACME', 'Other'] }].filter(function (r) { return !a.q || r.orderno.indexOf(a.q) >= 0 || r.prodspec.indexOf(a.q) >= 0; }) });
        if (cmd === 'fill') { window.__awFilled = a; return res({ ok: true, date: a.date, rows: a.items.map(function (it) { return Object.assign({}, it, { prodspec: 'P-' + it.orderno }); }), png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }); }
        if (cmd === 'submit') {
          if (!window.__awFilled) return res({ ok: false, code: 'NOT_FILLED', error: '먼저 입력' });
          var f = window.__awFilled; window.__awFilled = null;
          f.items.forEach(function (it) { window.__awSite.push({ day: f.date, name: window.__awName, orderno: it.orderno, hours: it.hours, job: it.job, memo: it.memo }); });
          return res({ ok: true, date: f.date, count: f.items.length, messages: ['OK registered'], page: '/Sales/Week_List.asp' });
        }
        if (cmd === 'download') { window.__awFilled = null; return res({ ok: true, files: [{ team: 'T1', name: 'T1.xls', size: 1, base64: xls(window.__awSite.filter(function (r) { return r.day >= a.start && r.day <= a.end; })) }], skipped: [], teams: ['T1'] }); }
        res({ ok: false, error: '?' });
      }, 30); });
    } };
  }
  async function open(email, desk, vw) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    B.push(b);
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { errs.push('기본 알림 창이 뜸: ' + d.message()); d.dismiss(); });
    if (desk) await p.evaluateOnNewDocument(fakeDesk);
    await p.setViewport(vw || { width: 1400, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.evaluate(function () { window.__wmDialogUi = true; });   // 확인 창을 우리 창(wm-dialog)으로
    if (desk) await p.evaluate(function () { window.__awName = 'tester'; currentUser.display_name = 'tester'; });
    return p;
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var setF = function (p, i, f, v) { return p.evaluate(function (i, f, v) { var el = document.querySelector('.awg-r[data-i="' + i + '"] [data-f="' + f + '"]'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, i, f, v); };
  var DAY = '2026-11-17';
  try {
    /* ── PC 앱(가짜 다리) ── */
    var p = await open('admin@t.com', true);
    await p.evaluate(function () { setPage('mywork'); });
    check(await until(p, function () { return !!document.querySelector('#mMyWork [data-awg-open]'); }, null, 15000), '내 업무 도구 막대에 📝 공수 단추');
    await p.click('#mMyWork .mw-add [data-awg-open]');
    check(await until(p, function () { return !!document.querySelector('#awgBox .awg-r'); }), '단추 → 공수 등록 창');
    await p.evaluate(function (d) { var el = document.getElementById('awgDay'); el.value = d; el.dispatchEvent(new Event('change', { bubbles: true })); }, DAY);
    await until(p, function (d) { return _awg && _awg.day === d && document.querySelector('.awg-r'); }, DAY);
    check(await p.evaluate(function () { return !!document.querySelector('#awgAct [data-awg="acct"]') && !document.querySelector('[data-awg="fill"]'); }), '계정이 없으면 「계정 연결」 만');

    // 계정 연결
    await p.click('#awgAct [data-awg="acct"]');
    await until(p, function () { return !!document.getElementById('awgAcctId'); });
    await p.type('#awgAcctId', 'tester'); await p.type('#awgAcctPw', 'pw');
    await p.click('#awgAcctModal button[type=submit]');
    check(await until(p, function () { return !document.getElementById('awgAcctModal') && !!document.querySelector('[data-awg="fill"]'); }), '계정 저장 → ① 웹에 입력 단추');
    check(await p.evaluate(function () { return document.querySelector('[data-awg="send"]').disabled && document.querySelector('[data-awg="fill"]').disabled; }), '빈 표 — ① ② 모두 잠김');

    // 쓰기
    await setF(p, 0, 'orderno', 'B26031'); await setF(p, 0, 'hours', '6.5'); await setF(p, 0, 'job', '개발'); await setF(p, 0, 'memo', 'step run test');
    await p.click('[data-awg="add"]');
    await setF(p, 1, 'orderno', 'COMMON'); await setF(p, 1, 'hours', '1.5'); await setF(p, 1, 'divi', '사외'); await setF(p, 1, 'job', '공통'); await setF(p, 1, 'memo', 'weekly meeting');
    check(await p.evaluate(function () { return /2행/.test(document.getElementById('awgSum').textContent) && /8h/.test(document.getElementById('awgSum').textContent); }), '합계 2행 · 8h');
    check(await p.evaluate(function () { return document.querySelector('.awg-r[data-i="0"] [data-cnt]').textContent === '13/50' && document.querySelector('.awg-r [data-f="memo"]').maxLength === 50; }), '작업내용 글자 수 13/50 · 50자 제한');
    check(await until(p, function () { return document.getElementById('awgSaved').textContent === '저장됨'; }, null, 5000), '자동 저장');
    var row = (await c.query("SELECT items, status FROM gongsu_days WHERE day = $1", [DAY])).rows[0];
    check(row && row.status === 'draft' && row.items.length === 2 && row.items[0].hours === 6.5 && row.items[1].divi === '사외', '서버에 초안 저장 ' + JSON.stringify(row && row.items));

    // 🔍 수주번호 찾기
    await p.click('.awg-r[data-i="1"] [data-awg="find"]');
    await until(p, function () { return !!document.getElementById('awgFindQ'); });
    await p.evaluate(function () { document.getElementById('awgFindQ').value = 'B2603'; document.querySelector('#awgFindModal form').requestSubmit(); });
    check(await until(p, function () { return document.querySelectorAll('.awg-find-row').length === 2; }), '수주번호 찾기 — 결과 2건');
    await p.evaluate(function () { document.querySelectorAll('.awg-find-row')[1].click(); });
    check(await until(p, function () { return !document.getElementById('awgFindModal') && _awg.items[1].orderno === 'B26032' && /Other/.test(document.querySelector('.awg-r[data-i="1"] [data-ps]').textContent); }), '고르면 그 행에 수주번호 · 프로젝트명');

    // 빠진 칸이 있으면 ① 이 막고 알려 줌
    await setF(p, 1, 'memo', '');
    await p.click('[data-awg="fill"]'); await wait(300);
    check(await p.evaluate(function () { return window.__awCalls.indexOf('fill') < 0 && document.activeElement && document.activeElement.getAttribute('data-f') === 'memo'; }), '작업내용이 비면 입력하지 않고 그 칸으로');
    await setF(p, 1, 'memo', 'weekly meeting');

    // 같은 날짜에 이미 올라간 것이 있으면 알림
    await p.evaluate(function (d) { window.__awSite.push({ day: d, name: 'tester', orderno: 'OLD1', hours: 2, job: '개발', memo: 'already there' }, { day: d, name: 'someone', orderno: 'X', hours: 8, job: '개발', memo: 'not mine' }); }, DAY);
    await p.click('[data-awg="fill"]');
    check(await until(p, function () { return !!document.querySelector('.awg-cap img') && !document.querySelector('[data-awg="send"]').disabled; }, null, 10000), '① 웹에 입력 → 캡처 보임 · ② 등록 열림');
    check(await p.evaluate(function () { var w = document.querySelector('.awg-msg.warn'); return !!w && /이미 1행/.test(w.textContent) && /already there/.test(w.textContent) && !/not mine/.test(w.textContent); }), '이미 올라간 내 행 1건만 알림 (남의 행은 빼고)');
    check(await p.evaluate(function () { return _awg.items[0].prodspec === 'P-B26031'; }), '애니웍스가 알려 준 프로젝트명으로 채움');
    await p.screenshot({ path: path.join(SHOT, 'e2e103-filled.png') });

    // 내용을 고치면 다시 ① 부터
    await setF(p, 0, 'hours', '6');
    check(await p.evaluate(function () { return document.querySelector('[data-awg="send"]').disabled && !document.querySelector('.awg-cap'); }), '입력 뒤에 고치면 ② 가 다시 잠기고 캡처가 사라짐');
    await p.click('[data-awg="fill"]');
    await until(p, function () { return !!document.querySelector('.awg-cap img'); }, null, 10000);

    // ② 등록 — 확인 창에서 취소하면 올리지 않음
    await p.click('[data-awg="send"]');
    await until(p, function () { return !!document.querySelector('.wmd .wmd-btn.ok'); }, null, 3000);
    var dlg = await p.evaluate(function () { var d = document.querySelector('.wmd'); return d ? { ok: d.querySelector('.wmd-btn.ok').textContent, text: d.textContent } : { ok: '', text: '' }; });
    check(dlg.ok === '등록' && /2행/.test(dlg.text) && /7.5h/.test(dlg.text) && /이미 1행/.test(dlg.text), '등록 확인 창 — 행 수 · 시간 · 이미 올라간 것 경고 ' + dlg.text.slice(0, 120));
    await p.click('.wmd .wmd-btn:not(.ok)');
    await wait(400);
    check(await p.evaluate(function () { return window.__awCalls.indexOf('submit') < 0 && !document.querySelector('.wmd'); }), '취소 → 등록하지 않음');
    await p.click('[data-awg="send"]');
    await until(p, function () { return !!document.querySelector('.wmd .wmd-btn.ok'); }, null, 3000);
    await p.click('.wmd .wmd-btn.ok');
    check(await until(p, function () { var m = document.querySelector('.awg-msg.ok'); return !!m && /등록 완료/.test(m.textContent) && /확인했습니다/.test(m.textContent); }, null, 10000), '등록 → 주간일지에서 확인까지');
    check(await p.evaluate(function () { return window.__awSite.length === 4 && window.__awCalls.filter(function (x) { return x === 'submit'; }).length === 1; }), '애니웍스에 2행이 한 번만 올라감');
    check(await p.evaluate(function () { return /애니웍스에 등록함/.test(document.getElementById('awgState').textContent) && /확인됨/.test(document.getElementById('awgState').textContent) && document.querySelector('.awg-wd.on').classList.contains('sent') && document.querySelector('[data-awg="send"]').disabled; }), '상태: 등록함 · 확인됨 · 주 표시 ✓ · ② 다시 잠김');
    row = (await c.query("SELECT status, sent_items, sent_msg, checked_at FROM gongsu_days WHERE day = $1", [DAY])).rows[0];
    check(row.status === 'sent' && row.sent_items.length === 2 && row.sent_items[0].hours === 6 && row.sent_msg === 'OK registered' && !!row.checked_at, '서버에 등록 기록 · 확인 시각');
    await p.screenshot({ path: path.join(SHOT, 'e2e103-sent.png') });

    // 등록 뒤에 고치면 알려 줌 · 다른 날에서 불러오기
    await setF(p, 0, 'memo', 'changed after');
    check(await p.evaluate(function () { return /등록한 뒤에 내용이 바뀜/.test(document.getElementById('awgState').textContent); }), '등록 뒤 고치면 「바뀜」 표시');
    await until(p, function () { return document.getElementById('awgSaved').textContent === '저장됨'; }, null, 5000);
    await p.evaluate(function () { document.querySelector('[data-awg-day="2026-11-18"]').click(); });
    await until(p, function () { return _awg.day === '2026-11-18' && document.querySelectorAll('.awg-r').length === 1; });
    check(await p.evaluate(function () { return /작성 중/.test(document.getElementById('awgState').textContent) && document.querySelector('#awgCopy option[value="2026-11-17"]') !== null; }), '다음 날 — 비어 있고, 불러오기에 어제 것');
    await p.evaluate(function () { var s = document.getElementById('awgCopy'); s.value = '2026-11-17'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    check(await until(p, function () { return _awg.items.length === 2 && _awg.items[0].memo === 'changed after'; }), '어제 것 불러오기 → 2행');

    // 닫았다 열어도 그대로 (닫을 때 저장)
    await p.evaluate(function () { document.querySelector('#awgModal [data-wm-close]').click(); });
    await wait(900);
    row = (await c.query("SELECT items FROM gongsu_days WHERE day = '2026-11-18'")).rows[0];
    check(row && row.items.length === 2, '닫을 때 저장됨');

    // 📥 주간일지 받기 — 🌐 애니웍스 단추가 PC 앱 창으로
    await p.evaluate(function () { window.__hf = null; window.hFiles = function (f) { window.__hf = [].map.call(f, function (x) { return x.name; }); return Promise.resolve(); }; openAnyworksModal(); });
    check(await until(p, function () { return !!document.getElementById('awgPullGo') && !document.getElementById('anyworksOverlay'); }), '🌐 애니웍스 → PC 앱 주간일지 받기 창');
    await p.evaluate(function () { document.getElementById('awgPullA').value = '2026-11-16'; document.getElementById('awgPullB').value = '2026-11-20'; document.getElementById('awgPullGo').click(); });
    check(await until(p, function () { return window.__hf && window.__hf[0] === 'T1.xls' && !document.getElementById('awgPullModal'); }), '받은 파일을 기존 가져오기로 넘김');
    await p.evaluate(function () { openAnyworksModal(true); });
    check(await until(p, function () { return !!document.getElementById('anyworksOverlay'); }), '「예전 방식」 창도 그대로 열림');

    /* ── 웹 · 휴대폰 (PC 앱 아님) ── */
    var m = await open('admin@t.com', false, { width: 390, height: 844, isMobile: true, hasTouch: true });
    await m.evaluate(function (d) { awgOpen(d); }, DAY);
    check(await until(m, function () { return document.querySelectorAll('#awgBox .awg-r').length === 2; }, null, 10000), '휴대폰 — PC 에서 쓴 2행이 그대로');
    var mob = await m.evaluate(function () {
      var box = document.querySelector('#awgModal .wa-modal-box'), r = document.querySelector('.awg-r').getBoundingClientRect();
      return { hint: /PC 앱/.test(document.getElementById('awgAct').textContent), noBtn: !document.querySelector('[data-awg="fill"]') && !document.querySelector('[data-awg="find"]'),
        fit: r.right <= innerWidth + 1 && (function (g) { return g.scrollWidth <= g.clientWidth + 1 && g.getBoundingClientRect().right <= box.getBoundingClientRect().right; })(document.getElementById('awgBox')),   /* 창 머리 줄(.wa-modal-hd)은 모든 창 공통이라 여기서 보지 않음 */ state: document.getElementById('awgState').textContent,
        over: [box.scrollWidth, box.clientWidth, Math.round(r.right), innerWidth].join('/') + ' ' + [].filter.call(box.querySelectorAll('*'), function (e) { return e.getBoundingClientRect().right > box.getBoundingClientRect().right - 1; }).slice(0, 6).map(function (e) { return e.tagName + '.' + e.className + '#' + e.id + ':' + Math.round(e.getBoundingClientRect().right); }).join(' , ') };
    });
    check(mob.hint && mob.noBtn, '휴대폰 — 등록 단추 대신 「PC 앱에서」 안내');
    check(mob.fit, '휴대폰 — 가로로 넘치지 않음 ' + mob.over);
    check(/등록함/.test(mob.state), '휴대폰 — 등록 상태 보임');
    await m.screenshot({ path: path.join(SHOT, 'e2e103-mobile.png') });

    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { for (var i = 0; i < B.length; i++) await B[i].close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
