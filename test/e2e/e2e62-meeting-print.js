// 🖨 v13.320 프로젝트 › 회의 회의록 — 노트 출력과 같은 모양 · 결재란 · 회사 머리글 · 종이 미리 보기 · 📚 묶어 출력
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var PID = 'pmtpr-p1';
  await c.query('DELETE FROM meetings WHERE project_id = $1', [PID]);
  await c.query('DELETE FROM projects WHERE id = $1', [PID]);
  await c.query("INSERT INTO projects (id, name, status, progress, owner_id, visibility, tenant_id, start_date, end_date) VALUES ($1, '회의출력 장비', 'active', 10, $2, 'tenant', $3, '2026-10-01', '2026-12-31')", [PID, adm.id, adm.tenant_id]);
  await c.query("INSERT INTO doc_print_settings (tenant_id, company) VALUES ($1, '(주)회의출력') ON CONFLICT (tenant_id) DO UPDATE SET company = EXCLUDED.company, logo = NULL", [adm.tenant_id]);

  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-pmtpr' + Date.now()) });
  var p = (await b.pages())[0] || await b.newPage();
  p.on('pageerror', function (e) { errs.push(e.message); });
  p.on('dialog', function (d) { d.accept(); });
  function until(fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  function frame(id, re) { return until(function (a) { var f = document.getElementById(a[0]); var d = f && f.contentDocument; return d && d.body && new RegExp(a[1]).test(d.body.innerHTML); }, [id, re], 10000); }
  try {
    await p.setViewport({ width: 1500, height: 920 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.evaluate(function () { try { localStorage.removeItem('nb-print-v1'); localStorage.setItem('pmtSign', '1'); } catch (e) { /* */ } });
    var ids = await p.evaluate(function (pid) {
      var mk = function (t, d, f) { return apiFetch('/api/meetings', { method: 'POST', body: JSON.stringify({ projectId: pid, title: t, meetDate: d, attendees: ['관리자'], form: f }) }).then(function (r) { return r.data.id; }); };
      return mk('둘째 회의', '2026-10-08', { decisions: '결정 둘' }).then(function (a) { return mk('첫 회의', '2026-10-01', { decisions: '결정 하나', place: '3층' }).then(function (b2) { return [a, b2]; }); });
    }, PID);
    await p.evaluate(function (pid) { _gsOpenProject(pid, null, function () { pdSwitchTab('meeting', pid); }); }, PID);
    check(await until(function () { return !!document.getElementById('pmtBundleBtn'); }, null, 15000), '회의 탭 — [🖨 묶어 출력] 단추');

    // 1) 미리 보기 — 옛 결재란 설정 이어받기 · 종이 · 쪽 수
    await p.evaluate(function (id) { pmtPreview(id); }, ids[1]);
    check(await frame('pmtPreviewFrame', '회의록') && await frame('pmtPreviewFrame', '>승인<'), '미리 보기 — 옛 "결재란" 설정을 이어받아 작성 · 검토 · 승인');
    check(await until(function () { return /약 \d+쪽/.test((document.getElementById('pmtPages') || {}).textContent || ''); }), '종이 미리 보기 — 쪽 수 표시 (노트 출력과 같은 종이)');
    check(await frame('pmtPreviewFrame', '\\(주\\)회의출력'), '회사 머리글 (기본 켜짐)');

    // 2) 모양 · 결재란 바꾸기 → 노트 출력과 같은 설정에 기억
    await p.select('#pmtPreviewModal select[data-k="theme"]', 'formal');
    check(await frame('pmtPreviewFrame', '■ 1\\. 회의 개요'), '모양 "공문"');
    await p.select('#pmtPreviewModal select[data-k="sign"]', '담당,팀장,부서장');
    check(await frame('pmtPreviewFrame', '>부서장<') && !(await p.evaluate(function () { return />승인</.test(document.getElementById('pmtPreviewFrame').contentDocument.body.innerHTML); })), '결재란 담당 · 팀장 · 부서장 (승인 칸은 없어짐)');
    var prefs = await p.evaluate(function () { return wmPrintPrefs(); });
    check(prefs.theme === 'formal' && prefs.sign === '담당,팀장,부서장', '설정은 노트 출력과 공유 (nb-print-v1)');
    await p.click('#pmtPreviewModal input[data-k="header"]');
    check(await until(function () { var d = document.getElementById('pmtPreviewFrame').contentDocument; return d && d.body && /회의록/.test(d.body.innerHTML) && !/3px double/.test(d.body.innerHTML); }), '회사 머리글 끄기');
    await p.click('#pmtPreviewModal input[data-k="header"]');
    await p.evaluate(function () { var w = document.getElementById('pmtPreviewFrame').contentWindow; w.print = function () { window.__pp = 1; }; });
    await p.evaluate(function () { pmtPrint(); });
    check(await until(function () { return window.__pp === 1; }), '🖨 인쇄');
    await p.evaluate(function () { var m = document.getElementById('pmtPreviewModal'); if (m) m.remove(); });

    // 3) 📚 묶어 출력
    await p.click('#pmtBundleBtn');
    check(await frame('pmtBPreviewFrame', '회의출력 장비 회의록 모음') && await frame('pmtBPreviewFrame', '목차'), '묶어 출력 — 표지 · 목차 (프로젝트 이름)');
    var order = await p.evaluate(function () { var h = document.getElementById('pmtBPreviewFrame').contentDocument.body.innerHTML; return h.lastIndexOf('첫 회의') < h.lastIndexOf('둘째 회의'); });
    check(order, '날짜 순 (첫 회의 → 둘째 회의)');
    check(await until(function () { return /2건/.test(document.getElementById('pmtBMsg').textContent); }), '2건');
    check(await p.evaluate(function () { return document.getElementById('pmtBPreviewFrame').contentDocument.querySelectorAll('.pg-brk').length === 2; }), '한 건씩 새 쪽');
    check(await frame('pmtBPreviewFrame', '>부서장<') && (await p.evaluate(function () { return (document.getElementById('pmtBPreviewFrame').contentDocument.body.innerHTML.match(/>부서장</g) || []).length; })) === 1, '결재란은 표지에만');
    await p.click('#pmtBundleModal .pmt-bd-c[value="' + ids[0] + '"]');
    check(await until(function () { var d = document.getElementById('pmtBPreviewFrame').contentDocument; return /1건/.test(document.getElementById('pmtBMsg').textContent) && d && d.body && !/둘째 회의/.test(d.body.innerHTML); }), '회의 빼기 → 1건만');
    await p.evaluate(function () { _pmtBundleAll(true); });
    await until(function () { return /2건/.test(document.getElementById('pmtBMsg').textContent); });
    await p.click('#pmtBPer');
    check(await until(function () { var d = document.getElementById('pmtBPreviewFrame').contentDocument; return d && d.body && /목차/.test(d.body.innerHTML) && d.querySelectorAll('.pg-brk').length === 0; }), '이어 붙이기');
    await p.evaluate(function () { window.__wb = 0; var o = URL.createObjectURL; URL.createObjectURL = function (bl) { window.__wb = bl.size; return o.call(URL, bl); }; });
    await p.evaluate(function () { _pmtBundleWord(); });
    check(await until(function () { return window.__wb > 2000; }), '📝 Word');
    await p.evaluate(function () { navigator.clipboard.write = function () { window.__cp = 1; return Promise.resolve(); }; _pmtBundleCopy(); });
    check(await until(function () { return window.__cp === 1; }), '📋 서식째 복사');
    await p.screenshot({ path: path.join(SHOT, 'e2e62-bundle.png') });
    await p.evaluate(function () { var m = document.getElementById('pmtBundleModal'); if (m) m.remove(); });

    // 4) 노트 출력에서도 같은 모양으로 열림
    await p.click('#hdrNbBtn');
    await until(function () { return !!document.querySelector('#nbSide .nb-nav'); });
    var nid = await p.evaluate(function () { return apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: '공유 설정 확인', body: '본문' }) }).then(function (r) { return r.data.id; }); });
    await p.evaluate(function (id) { return nbOpenNote(id); }, nid);
    await until(function (id) { return NB.cur && NB.cur.id === id; }, nid);
    await p.evaluate(function () { nbPrintOpen(); });
    check(await until(function () { var b2 = document.querySelector('#nbprSide [data-o="theme"][data-v="formal"]'); return b2 && b2.classList.contains('on'); }) && await frame('nbprFrame', '>부서장<'), '노트 출력도 공문 · 담당 · 팀장 · 부서장으로');
    await p.evaluate(function () { var m = document.getElementById('nbPrintModal'); if (m) m.remove(); });
    // 노트 ⋯ 서식째 복사 · Word (공용 함수로 바뀜)
    await p.evaluate(function () { window.__cp = 0; window._nbSaveBlob = function (bl, n) { window.__dl = { n: n, s: bl.size }; }; _nbCopyRich('| a | b |\n|---|---|\n| 1 | 2 |\n- [x] 끝'); nbPrintQuickWord(); });
    check(await until(function () { return window.__cp === 1; }), '노트 서식째 복사 (공용)');
    check(await until(function () { return window.__dl && /\.doc$/.test(window.__dl.n) && window.__dl.s > 1500; }), '노트 ⋯ Word — 기억한 설정으로 바로');
    await p.evaluate(function (id) { return apiFetch('/api/notebook/notes/' + id + '?purge=1', { method: 'DELETE' }); }, nid);
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  check(!errs.length, '페이지 오류 없음' + (errs.length ? ' — ' + errs.join(' | ') : ''));
  await b.close();
  await c.query('DELETE FROM meetings WHERE project_id = $1', [PID]);
  await c.query('DELETE FROM doc_print_settings WHERE tenant_id = $1', [adm.tenant_id]);
  await c.end();
  console.log('\n' + ok + ' 통과 · ' + fail + ' 실패' + (fail ? '' : ' — ALL PASS'));
  process.exit(fail ? 1 : 0);
})();
