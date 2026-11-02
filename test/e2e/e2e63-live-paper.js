// 📄 v13.321 쓰면서 보는 출력 모양 — 인쇄되는 종이 그대로
//   프로젝트 › 회의 작성 카드 옆 종이(쓰는 대로 · 다시 싣지 않고) · 장마다 따로 · 걸친 줄은 다음 장으로 · 머리글 · 쪽 번호
//   종이 숨기기 · 작성 완료 문서 보기 · 📓 노트 [🖨 출력 모양] 보기
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var PID = 'livepp-p1';
  await c.query('DELETE FROM meetings WHERE project_id = $1', [PID]);
  await c.query('DELETE FROM projects WHERE id = $1', [PID]);
  await c.query("INSERT INTO projects (id, name, status, progress, owner_id, visibility, tenant_id, start_date, end_date) VALUES ($1, '종이보기 장비', 'active', 10, $2, 'tenant', $3, '2026-10-01', '2026-12-31')", [PID, adm.id, adm.tenant_id]);
  await c.query("INSERT INTO doc_print_settings (tenant_id, company) VALUES ($1, '(주)종이회사') ON CONFLICT (tenant_id) DO UPDATE SET company = EXCLUDED.company, logo = NULL", [adm.tenant_id]);

  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-livepp' + Date.now()) });
  var p = (await b.pages())[0] || await b.newPage();
  p.on('pageerror', function (e) { errs.push(e.message); });
  p.on('dialog', function (d) { d.accept(); });
  function until(fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  function frameHas(id, re) { return until(function (a) { var f = document.getElementById(a[0]); var d = f && f.contentDocument; return !!(d && d.body && new RegExp(a[1]).test(d.body.innerHTML)); }, [id, re], 10000); }
  /** 종이 검사 — 장 수 · 쪽 번호 · 표 줄이 두 장에 걸치지 않는지 */
  function sheets(id) {
    return p.evaluate(function (fid) {
      var f = document.getElementById(fid), d = f && f.contentDocument; if (!d) return null;
      var o = wmPrintPrefs(), M = NbPrint.MARGIN[o.margin] || NbPrint.MARGIN.normal, T = NbPrint.mm(M[0]), S = 1123 + 18, CH = 1123 - 2 * T;
      var cross = 0;
      d.querySelectorAll('tr:not(.pv-sp)').forEach(function (tr) {
        var r = tr.getBoundingClientRect(); if (r.height < 2 || r.height > CH) return;
        var k = Math.floor((r.top - T) / S); if (r.bottom > k * S + T + CH + 1.5) cross++;
      });
      return { n: d.querySelectorAll('.pv-sheet').length, pn: [].map.call(d.querySelectorAll('.pv-pn'), function (x) { return x.textContent; }), mb: [].map.call(d.querySelectorAll('.pv-mb:not(.pv-pn)'), function (x) { return x.textContent; }), cross: cross, sp: d.querySelectorAll('.pv-sp').length, h: f.offsetHeight };
    }, id);
  }
  try {
    await p.setViewport({ width: 1600, height: 950 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.evaluate(function () { try { localStorage.removeItem('nb-print-v1'); localStorage.removeItem('pmt-live'); localStorage.removeItem('pmtSign'); } catch (e) { /* */ } });
    check(await p.evaluate(function () { return typeof MeetingMinutes !== 'undefined' && typeof MeetingMinutes.renderMinutes === 'function'; }), '회의록 문서 코드가 브라우저에도 (meeting-minutes.js)');

    // 긴 회의록 — 두 장 넘게
    var mid = await p.evaluate(function (pid) {
      var ag = []; for (var i = 1; i <= 14; i++) ag.push({ text: '안건 ' + i + ' 검토', done: false, note: '논의 내용 ' + i + '\n- 현장 측정값 확인\n- 공급사 회신 대기\n- 대안 비교', result: '결과 ' + i });
      return apiFetch('/api/meetings', { method: 'POST', body: JSON.stringify({ projectId: pid, title: '긴 회의', meetDate: '2026-11-02', attendees: ['관리자', '김철수'], agenda: ag, form: { decisions: '결정 하나' } }) }).then(function (r) { return r.data.id; });
    }, PID);
    var FR = 'pmtL-' + mid.replace(/[^A-Za-z0-9_-]/g, '_') + 'PreviewFrame';
    await p.evaluate(function (pid) { _gsOpenProject(pid, null, function () { pdSwitchTab('meeting', pid); }); }, PID);
    check(await until(function (id) { return !!document.querySelector('#pmt-card-' + CSS.escape(id) + ' .pmt-live-pv'); }, mid, 15000), '작성 카드 옆에 종이 (기본 켜짐)');
    check(await until(function (id) {
      var f = document.querySelector('#pmt-card-' + CSS.escape(id) + ' .pmt-live-form'), v = document.querySelector('#pmt-card-' + CSS.escape(id) + ' .pmt-live-pv');
      return f && v && v.getBoundingClientRect().left >= f.getBoundingClientRect().right - 2 && Math.abs(v.getBoundingClientRect().top - f.getBoundingClientRect().top) < 40;
    }, mid), '양식 · 종이 나란히 (좁은 패널은 잠깐 넓힘)');
    check(await frameHas(FR, '긴 회의') && await frameHas(FR, '안건 14 검토'), '종이에 회의록 내용');
    var s1 = await sheets(FR);
    check(s1 && s1.n >= 2 && s1.pn.length === s1.n && s1.pn[0] === '1 / ' + s1.n, '장마다 따로 · 쪽 번호 1 / ' + (s1 && s1.n));
    check(s1 && s1.cross === 0 && s1.sp >= 1, '쪽에 걸친 표 줄은 다음 장으로 (걸침 ' + (s1 && s1.cross) + ' · 넘긴 곳 ' + (s1 && s1.sp) + ')');
    check(s1 && s1.mb.some(function (t) { return /\(주\)종이회사/.test(t); }) && s1.mb.some(function (t) { return /^MTG-/.test(t); }), '매 장 위 회사 머리글 · 문서 번호');
    check(s1 && Math.abs(s1.h - (s1.n * 1141 - 18)) < 3, '종이 높이 = 장 수 × A4');
    await p.screenshot({ path: path.join(SHOT, 'e2e63-meeting-live.png') });

    // 쓰는 대로 — 다시 싣지 않고 본문만
    await p.evaluate(function (id) { document.getElementById(id).contentWindow.__keep = 1; }, FR);
    var sel = 'input[data-f="place"][data-m="' + mid + '"]';
    await p.click(sel); await p.type(sel, '본사 대회의실');
    check(await frameHas(FR, '본사 대회의실'), '장소를 쓰는 대로 종이에 (저장 전)');
    await p.type('textarea[data-f="decisions"][data-m="' + mid + '"]', '\n베어링 교체 확정');
    check(await frameHas(FR, '베어링 교체 확정'), '결정 사항도 바로');
    check(await p.evaluate(function (id) { return document.getElementById(id).contentWindow.__keep === 1; }, FR), '종이를 다시 싣지 않음 (깜빡임 · 스크롤 튐 없음)');
    // 모양 바꾸면 카드 종이도
    await p.evaluate(function () { var o = wmPrintPrefs(); o.theme = 'formal'; o.sign = '담당,팀장,부서장'; wmPrintPrefsSave(o); _pmtLiveAll(); });
    check(await frameHas(FR, '■ 1\\. 회의 개요') && await frameHas(FR, '>부서장<'), '모양 · 결재란 바꾸면 카드 종이도 (공문 · 담당 · 팀장 · 부서장)');

    // 숨기기 / 다시
    await p.evaluate(function (id) { pmtLiveToggle(id); }, mid);
    check(await until(function (id) { return !document.getElementById(id); }, FR), '📄 종이 숨기기');
    check(await p.evaluate(function () { var pn = document.getElementById('projDetailPanel'); return Math.abs(parseFloat(pn.style.getPropertyValue('--pd-frac')) - _pdPanelFrac()) < 0.01; }), '숨기면 패널 폭 되돌림');
    await p.evaluate(function (id) { pmtLiveToggle(id); }, mid);
    check(await frameHas(FR, '본사 대회의실'), '다시 켜면 쓰던 내용 그대로');

    // 작성 완료 → 카드 안 문서 보기도 종이 그대로
    await p.evaluate(function (id) { pmtComplete(id); }, mid);
    var DF = 'pmtD-' + mid.replace(/[^A-Za-z0-9_-]/g, '_') + 'PreviewFrame';
    check(await frameHas(DF, '본사 대회의실') && await frameHas(DF, '베어링 교체 확정'), '작성 완료 문서 보기도 A4 종이 (저장된 내용)');
    var s2 = await sheets(DF);
    check(s2 && s2.n >= 2 && s2.cross === 0, '문서 보기도 장마다 · 걸침 없음');
    await p.screenshot({ path: path.join(SHOT, 'e2e63-meeting-doc.png') });

    // 📓 노트 — 🖨 출력 모양 보기
    await p.evaluate(function () { pdCloseDetail(); });
    await p.click('#hdrNbBtn');
    await until(function () { return !!document.querySelector('#nbSide .nb-nav'); });
    var nid = await p.evaluate(function () { return apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: '주간 회의', body: '## 개요\n- **일시**: 2026-11-03 10:00\n- **참석**: 김철수\n\n## 안건\n1. 일정\n\n## 결정 사항\n- 다음 주 시운전' }) }).then(function (r) { return r.data.id; }); });
    await p.evaluate(function (id) { return nbOpenNote(id); }, nid);
    await until(function (id) { return NB.cur && NB.cur.id === id; }, nid);
    await p.click('#nbMain .nb-seg [data-mode="paper"]');
    check(await frameHas('nbPaperFrame', '시운전') && await until(function () { return /회의록/.test(document.getElementById('nbPaperInfo').textContent) && /\d+쪽/.test(document.getElementById('nbPaperInfo').textContent); }), '노트 [🖨 출력 모양] — 회의록 양식 종이 · 쪽 수');
    await p.evaluate(function () { document.getElementById('nbPaperFrame').contentWindow.__keep = 1; });
    await p.focus('#nbSrc');
    await p.evaluate(function () { var s = document.getElementById('nbSrc'); s.setSelectionRange(s.value.length, s.value.length); });
    await p.keyboard.type('\n- 도면 확정');
    check(await frameHas('nbPaperFrame', '도면 확정') && await p.evaluate(function () { return document.getElementById('nbPaperFrame').contentWindow.__keep === 1; }), '쓰는 대로 종이에 (다시 싣지 않고)');
    check(await p.evaluate(function () { var ed = document.getElementById('nbEd'); return ed.classList.contains('nb-m-paper') && getComputedStyle(document.getElementById('nbPrev')).display === 'none' && getComputedStyle(document.getElementById('nbSrc')).display !== 'none'; }), '왼쪽 쓰기 · 오른쪽 종이');
    await p.screenshot({ path: path.join(SHOT, 'e2e63-note-paper.png') });
    await p.keyboard.down('Control'); await p.keyboard.down('Alt'); await p.keyboard.press('2'); await p.keyboard.up('Alt'); await p.keyboard.up('Control');
    check(await until(function () { return NB.mode === 'split'; }), 'Ctrl+Alt+2 → 나란히로 돌아감');
    await p.evaluate(function () { _nbSetMode('paper'); });
    await p.setViewport({ width: 420, height: 860 });
    await p.evaluate(function () { nbPaperLive(0); });
    check(await until(function () { var pv = document.getElementById('nbPaperPv'), w = document.getElementById('nbPaperWrap'); return pv && w && w.offsetWidth <= pv.clientWidth && getComputedStyle(document.getElementById('nbSrc')).display === 'none'; }), '휴대폰 폭 — 종이만 · 가로 넘침 없음');
    await p.evaluate(function () { _nbSetMode('split'); });
    await p.evaluate(function (id) { return apiFetch('/api/notebook/notes/' + id + '?purge=1', { method: 'DELETE' }); }, nid);
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  check(!errs.length, '페이지 오류 없음' + (errs.length ? ' — ' + errs.join(' | ') : ''));
  await b.close();
  await c.query('DELETE FROM meetings WHERE project_id = $1', [PID]);
  await c.query('DELETE FROM projects WHERE id = $1', [PID]);
  await c.query('DELETE FROM doc_print_settings WHERE tenant_id = $1', [adm.tenant_id]);
  await c.end();
  console.log('\n' + ok + ' 통과 · ' + fail + ' 실패' + (fail ? '' : ' — ALL PASS'));
  process.exit(fail ? 1 : 0);
})();
