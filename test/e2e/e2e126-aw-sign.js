// ✍ 애니웍스 팀장승인 v13.547 — 공수 등록이 주간일지에서 확인되면 그날 내 칸 [팀장승인] 까지 (가짜 PC 앱 다리)
//   진짜 사이트 확인(보기만, 누르지 않음): desktop/scripts/aw-probe-sign.js
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  await c.query('DELETE FROM gongsu_days');
  var ok = 0, fail = 0, errs = [], B = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function fakeDesk() {
    window.__awCalls = []; window.__awSite = []; window.__awFilled = null; window.__awSigned = {}; window.__awV = 4; window.__awSignArgs = null;
    var xls = function (rows) {
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
        if (cmd === 'status') return res({ ok: true, v: window.__awV, hasCred: true, id: 'tester', safe: true, maxRows: 15, memoMax: 50 });
        if (cmd === 'fill') { window.__awFilled = a; return res({ ok: true, date: a.date, rows: a.items.map(function (it) { return Object.assign({}, it, { prodspec: 'P' }); }), png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }); }
        if (cmd === 'submit') {
          var f = window.__awFilled; window.__awFilled = null;
          if (!window.__awLose) f.items.forEach(function (it) { window.__awSite.push({ day: f.date, name: 'tester', orderno: it.orderno, hours: it.hours, job: it.job, memo: it.memo }); });
          return res({ ok: true, date: f.date, count: f.items.length, messages: [], page: '/Sales/Week_List.asp' });
        }
        if (cmd === 'download') return res({ ok: true, files: [{ team: 'T1', name: 'T1.xls', size: 1, base64: xls(window.__awSite.filter(function (r) { return r.day >= a.start && r.day <= a.end; })) }], skipped: [], teams: ['T1'] });
        if (cmd === 'approve' && a.dry) { window.__awDry = (window.__awDry || 0) + 1; return res({ ok: true, date: a.date, seq: '1', dry: true, btn: !!window.__awLead && !window.__awSigned[a.date], signed: !!window.__awSigned[a.date], found: true }); }
        if (cmd === 'approve') {
          window.__awSignArgs = a;
          if (window.__awSigned[a.date]) return res({ ok: true, date: a.date, seq: '1', already: true, approved: true });
          window.__awSigned[a.date] = true;
          return res({ ok: true, date: a.date, seq: '1', approved: true, signed: true, messages: [] });
        }
        res({ ok: false, error: '?' });
      }, 30); });
    } };
  }
  var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-sign' + Date.now()) });
  B.push(b);
  var p = (await b.pages())[0] || await b.newPage();
  p.on('pageerror', function (e) { errs.push(e.message); });
  p.on('dialog', function (d) { errs.push('기본 알림 창이 뜸: ' + d.message()); d.dismiss(); });
  function until(fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  var setF = function (i, f, v) { return p.evaluate(function (i, f, v) { var el = document.querySelector('.awg-r[data-i="' + i + '"] [data-f="' + f + '"]'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, i, f, v); };
  async function writeRow() { await setF(0, 'orderno', 'B26031'); await setF(0, 'hours', '8'); await setF(0, 'job', '개발'); await setF(0, 'memo', 'sign test'); }
  async function fillSend(okDialog) {
    await p.click('[data-awg="fill"]');
    await until(function () { return !!document.querySelector('.awg-cap img'); }, null, 10000);
    await p.click('[data-awg="send"]');
    await until(function () { return !!document.querySelector('.wmd .wmd-btn.ok'); }, null, 3000);
    var t = await p.evaluate(function () { return document.querySelector('.wmd').textContent; });
    await p.click('.wmd .wmd-btn.ok');
    return t;
  }
  try {
    await p.evaluateOnNewDocument(fakeDesk);
    await p.setViewport({ width: 1400, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.evaluate(function () { window.__wmDialogUi = true; currentUser.display_name = 'tester'; try { localStorage.removeItem('wm_awg_signer'); } catch (_) {} awgOpen('2026-11-16'); });
    await until(function () { return !!document.querySelector('[data-awg="fill"]'); }, null, 10000);

    // 팀원 — 애니웍스에 승인 단추가 없음 → 묻지도 · 알리지도 않음
    check(await p.evaluate(function () { return !!document.querySelector('[data-awg="sign"]'); }), '등록 전에도 ✍ 팀장승인 단추 (날짜 상관없이)');
    // 팀원이 ✍ 를 누르면 — 단추가 없다고만
    await p.click('[data-awg="sign"]');
    check(await until(function () { var m = document.querySelector('.awg-msg.warn'); return !!m && /단추가 없습니다/.test(m.textContent); }) && await p.evaluate(function () { return !document.querySelector('.wmd') && !window.__awSignArgs; }), '팀원 — ✍ 누르면 「단추가 없습니다」 · 승인 안 함');
    await p.evaluate(function () { window.__awDry = 0; window.__awCalls.length = 0; });
    await writeRow();
    var t = await fillSend();
    check(!/팀장승인/.test(t), '등록 확인 창에는 승인 이야기 없음');
    check(await until(function () { var m = document.querySelector('.awg-msg.ok'); return !!m && /등록 완료/.test(m.textContent) && !_awg.busy; }, null, 10000), '팀원 — 등록 완료');
    await wait(300);
    check(await p.evaluate(function () { return window.__awDry === 1 && window.__awCalls.filter(function (x) { return x === 'approve'; }).length === 1 && !document.querySelector('.wmd') && !/팀장승인/.test(document.querySelector('.awg-msg.ok').textContent) && localStorage.getItem('wm_awg_signer') !== '1'; }), '팀원 — 등록 뒤 단추만 보고 끝 (묻지 않음 · 경고 없음)');

    // 팀장 — 단추가 있음 → 「팀장승인도 할까요?」 → 나중에
    await p.evaluate(function () { window.__awLead = true; document.querySelector('[data-awg-day="2026-11-17"]').click(); });
    await until(function () { return _awg.day === '2026-11-17' && !!document.querySelector('[data-awg="fill"]'); });
    await writeRow();
    await fillSend();
    check(await until(function () { var d = document.querySelector('.wmd'); return !!d && /팀장승인도 할까요/.test(d.textContent); }, null, 10000), '팀장 — 등록 확인 뒤 「팀장승인도 할까요?」');
    check(await p.evaluate(function () { var d = document.querySelector('.wmd'); return d.querySelector('.wmd-btn.ok').textContent === '승인' && /나중에/.test(d.textContent) && /등록 완료/.test(document.querySelector('.awg-msg.ok').textContent); }), '[승인] · [나중에] · 등록 완료는 이미 보임');
    await p.click('.wmd .wmd-btn:not(.ok)');
    check(await until(function () { return /하지 않았습니다/.test((document.querySelector('.awg-msg.ok') || {}).textContent || ''); }) && await p.evaluate(function () { return !window.__awSigned['2026-11-17'] && !window.__awSignArgs; }), '나중에 → 승인하지 않음');
    check(await until(function () { return !!document.querySelector('[data-awg="sign"]'); }), '✍ 팀장승인 단추');

    // ✍ 단추로 따로 승인
    await p.click('[data-awg="sign"]');
    await until(function () { return !!document.querySelector('.wmd .wmd-btn.ok'); }, null, 3000);
    await p.click('.wmd .wmd-btn.ok');
    check(await until(function () { var m = document.querySelector('.awg-msg.ok'); return !!m && /팀장승인 완료/.test(m.textContent); }) && await p.evaluate(function () { return window.__awSigned['2026-11-17'] && window.__awSignArgs.date === '2026-11-17' && window.__awSignArgs.names.indexOf('tester') >= 0; }), '✍ 단추 → 그 날짜 · 내 이름으로 승인 완료');

    // 팀장 — 다음 날 등록 → 승인
    await p.evaluate(function () { document.querySelector('[data-awg-day="2026-11-18"]').click(); });
    await until(function () { return _awg.day === '2026-11-18' && !!document.querySelector('[data-awg="fill"]'); });
    await writeRow();
    await fillSend();
    await until(function () { var d = document.querySelector('.wmd'); return !!d && /팀장승인도/.test(d.textContent); }, null, 10000);
    await p.click('.wmd .wmd-btn.ok');
    check(await until(function () { var m = document.querySelector('.awg-msg.ok'); return !!m && /등록 완료/.test(m.textContent) && /팀장승인 완료/.test(m.textContent); }, null, 10000), '팀장 — 등록 → 확인 → 승인 완료 한 번에');
    check(await p.evaluate(function () { var c = window.__awCalls, i = c.lastIndexOf('approve'); return i > c.lastIndexOf('submit') && c.lastIndexOf('download') < i; }), '승인은 등록 · 주간일지 확인 뒤');

    // 등록이 주간일지에서 확인되지 않으면 단추도 보지 않음
    await p.evaluate(function () { window.__awLose = true; window.__awDry = 0; document.querySelector('[data-awg-day="2026-11-19"]') ? document.querySelector('[data-awg-day="2026-11-19"]').click() : awgOpen('2026-11-19'); });
    await until(function () { return _awg && _awg.day === '2026-11-19' && !!document.querySelector('[data-awg="fill"]'); }, null, 8000);
    await writeRow();
    await fillSend();
    check(await until(function () { var m = document.querySelector('.awg-msg.warn'); return !!m && /찾지 못했습니다/.test(m.textContent); }, null, 10000) && await p.evaluate(function () { return !window.__awDry && !window.__awSigned['2026-11-19']; }), '주간일지에서 못 찾으면 승인하지 않음');

    // 예전 PC 앱(v3)이면 승인 기능을 보이지 않음
    await p.evaluate(function () { window.__awV = 3; document.querySelector('#awgModal [data-wm-close]').click(); });
    await wait(500);
    await p.evaluate(function () { awgOpen('2026-11-16'); });
    await until(function () { return !!document.querySelector('[data-awg="fill"]'); }, null, 10000);
    await p.click('[data-awg="sign"]');
    check(await until(function () { var m = document.querySelector('.awg-msg.warn'); return !!m && /새 버전/.test(m.textContent); }) && await p.evaluate(function () { return !document.querySelector('.wmd'); }), '예전 PC 앱 — ✍ 누르면 새 버전 안내');
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { for (var i = 0; i < B.length; i++) await B[i].close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
