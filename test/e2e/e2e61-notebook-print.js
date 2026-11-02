// 🖨 v13.319 출력 미리 보기 · 양식 — 관리자
//   회의록 노트 → 자동 양식(회의록) · 모양 · 결재란 · 쪽 수 · Word · 서식째 복사 · 인쇄 · 🏢 회사 머리글(로고)
//   · 🤝 프로젝트 회의로 올리기(액션 아이템) · 📅 일일 노트 한 장(Ctrl+P) · 📚 묶어 출력(표지 · 목차 · 쪽 나눔) · 휴대폰 폭
var path = require('path');
var fs = require('fs');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var MEET = '## 개요\n- **일시**: 2026-11-03 14:00~15:30\n- **장소**: 3층 회의실\n- **참석**: 김철수, 이영희\n\n## 안건\n1. 소음 원인\n2. 일정\n\n## 논의 내용\n- 베어링 마모 확인\n\n' +
  '## 결정 사항\n- 베어링 교체\n\n## 할 일\n| 할 일 | 담당 | 기한 |\n|---|---|---|\n| 베어링 발주 | 김철수 | 11/10 |\n- [ ] 도면 수정 @이영희 ~11/12\n\n관련: [📁 장비](wm:project:nbpr-p1)';
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  await c.query('DELETE FROM nb_notes WHERE user_id = $1', [adm.id]);
  await c.query('DELETE FROM my_notes WHERE user_id = $1', [adm.id]);
  await c.query('DELETE FROM doc_print_settings WHERE tenant_id = $1', [adm.tenant_id]);
  await c.query("DELETE FROM meetings WHERE project_id = 'nbpr-p1'");
  await c.query("DELETE FROM projects WHERE id = 'nbpr-p1'");
  await c.query("INSERT INTO projects (id, name, status, progress, owner_id, visibility, tenant_id, start_date, end_date) VALUES ('nbpr-p1', '출력시험 장비', 'active', 30, $1, 'tenant', $2, '2026-10-01', '2026-12-31')", [adm.id, adm.tenant_id]);
  var today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  var yday = new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
  var ins = 'INSERT INTO my_notes (user_id, note_date, ref, tenant_id, body) VALUES ($1,$2,$3,$4,$5)';
  await c.query(ins, [adm.id, today, '', adm.tenant_id, '## 🎯 오늘 할 일\n- [x] 견적서 보내기\n- [ ] 도면 검토\n\n## 🔜 내일 이어서\n- [ ] 시운전 준비']);
  await c.query(ins, [adm.id, yday, '', adm.tenant_id, '## ✅ 끝낸 일\n- [x] 현장 점검']);
  var png = path.join(require('os').tmpdir(), 'nbpr-logo.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJElEQVR42mNkYPj/n4GBgYGJAQ0wMjIyMjAwMDCgK8CqAqsJABjWBAm0xV9PAAAAAElFTkSuQmCC', 'base64'));

  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-nbpr' + Date.now()) });
  var p = (await b.pages())[0] || await b.newPage();
  p.on('pageerror', function (e) { errs.push(e.message); });
  p.on('dialog', function (d) { d.accept(); });
  function until(fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  function frame(re) { return until(function (src) { var f = document.getElementById('nbprFrame'); var d = f && f.contentDocument; return d && d.body && new RegExp(src).test(d.body.innerHTML); }, re, 8000); }
  function frameText() { return p.evaluate(function () { var f = document.getElementById('nbprFrame'); return f && f.contentDocument ? f.contentDocument.body.innerText : ''; }); }
  function closeModal() { return p.evaluate(function () { var m = document.getElementById('nbPrintModal'); if (m) m.remove(); }); }
  try {
    await p.setViewport({ width: 1500, height: 920 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.evaluate(function () { try { localStorage.removeItem('nb-print-v1'); } catch (e) { /* */ } });
    await p.click('#hdrNbBtn');
    await until(function () { return !!document.querySelector('#nbSide .nb-nav'); });
    var nid = await p.evaluate(function (body) { return apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: '회의록 — 컨베이어 소음', body: body }) }).then(function (r) { return r.data.id; }); }, MEET);
    await p.evaluate(function (id) { return nbOpenNote(id); }, nid);
    await until(function (id) { return NB.cur && NB.cur.id === id; }, nid);

    // 1) 🖨 → 자동으로 회의록 양식
    await p.click('[data-nb="print"]');
    check(await until(function () { return !!document.getElementById('nbprFrame'); }), '🖨 단추 → 출력 미리 보기 창');
    check(await frame('회의록') && await frame('베어링 발주'), '종이 미리 보기에 회의록 양식 (할 일 표)');
    check(await until(function () { return /→ 회의록/.test(document.getElementById('nbprSide').textContent); }), '양식 "자동 → 회의록" 으로 알아봄');
    var t1 = await frameText();
    check(/3층 회의실/.test(t1) && /김철수/.test(t1) && /이영희/.test(t1) && /11\/12/.test(t1), '개요 표 (장소 · 참석자) · 목록 할 일 (@담당 ~기한)');
    check(await until(function () { return /약 \d+쪽/.test(document.getElementById('nbprPages').textContent); }), '쪽 수 표시');

    // 2) 모양 · 결재란 · 기억
    await p.click('#nbprSide [data-o="theme"][data-v="formal"]');
    check(await frame('■ 1\\. 회의 개요'), '모양 "공문" — ■ 제목');
    await p.select('#nbprSide select[data-o="sign-pick"]', '작성,검토,승인');
    check(await frame('>검토<'), '결재란 작성 · 검토 · 승인');
    var saved = await p.evaluate(function () { return JSON.parse(localStorage.getItem('nb-print-v1') || '{}'); });
    check(saved.theme === 'formal' && saved.sign === '작성,검토,승인' && !saved.form, '설정 기억 (양식 칸은 매번 자동)');
    await p.click('#nbprSide [data-o="form"][data-v="doc"]');
    check(await frame('문서번호 DOC-'), '양식을 "문서" 로 바꾸면 문서 번호 DOC-');
    await p.click('#nbprSide [data-o="form"][data-v="auto"]');
    await frame('MTG-');

    // 3) Word · 서식째 복사 · 인쇄
    await p.evaluate(function () {
      window._nbSaveBlob = function (bl, n) { window.__dl = { n: n, s: bl.size, t: bl.type }; };
      window.__cp = null;
      navigator.clipboard.write = function (items) { window.__cp = items.length; return Promise.resolve(); };
    });
    await p.click('#nbprSide [data-pr="doc"]');
    check(await until(function () { return window.__dl && /\.doc$/.test(window.__dl.n) && window.__dl.s > 2000; }), '📝 Word(.doc) 내려받기');
    await p.click('#nbprSide [data-pr="copy"]');
    check(await until(function () { return window.__cp === 1; }), '📋 서식째 복사 (html + 글)');
    await p.evaluate(function () { var w = document.getElementById('nbprFrame').contentWindow; w.print = function () { window.__printed = 1; }; });
    await p.click('#nbprSide [data-pr="print"]');
    check(await until(function () { return window.__printed === 1; }), '🖨 인쇄 — 미리 보기 종이 그대로');

    // 4) 🏢 회사 머리글 (관리자) — 이름 · 로고
    await p.click('#nbprSide [data-pr="ps"]');
    await until(function () { return !!document.getElementById('nbPsC'); });
    await p.type('#nbPsC', '(주)출력시험');
    var fi = await p.$('#nbPsF'); await fi.uploadFile(png);
    check(await until(function () { return !!document.querySelector('#nbPsL img[src^="data:image/png"]'); }), '로고 그림 고르기 → 미리 보기');
    await p.click('#nbPrintPsModal [data-x="ok"]');
    check(await frame('\\(주\\)출력시험') && await frame('<img src="data:image/png'), '회사 이름 · 로고가 머리글에');
    var ps = (await c.query('SELECT company, logo FROM doc_print_settings WHERE tenant_id = $1', [adm.tenant_id])).rows[0];
    check(ps && ps.company === '(주)출력시험' && /^data:image\/png;base64,/.test(ps.logo), '회사 머리글 저장 (DB)');
    await p.click('#nbprSide input[data-o="header"]');
    check(await until(function () { var d = document.getElementById('nbprFrame').contentDocument; return d && d.body && /회의록/.test(d.body.innerHTML) && !/<img src="data:image\/png/.test(d.body.innerHTML); }), '머리글 끄기');
    await p.click('#nbprSide input[data-o="header"]');
    await frame('<img src="data:image/png');

    // 5) 🤝 프로젝트 회의로 올리기
    check(await until(function () { return !!document.querySelector('#nbprSide [data-pr="meet"]'); }), '회의록 양식이면 "프로젝트 회의로 올리기" 단추');
    await p.evaluate(function () { document.querySelector('#nbprSide [data-pr="meet"]').click(); });
    check(await until(function () { var b = document.querySelector('#nbPrintMeetModal .nb-pick-i.on'); return b && b.getAttribute('data-pid') === 'nbpr-p1'; }), '노트에 연결된 프로젝트가 먼저 골라져 있음');
    check(await p.evaluate(function () { return /안건 2 · 결정 있음 · 할 일 2/.test(document.querySelector('#nbPrintMeetModal .nbpr-sum').textContent); }), '올릴 내용 요약 (안건 · 결정 · 할 일)');
    await p.click('#nbPrintMeetModal [data-x="ok"]');
    check(await until(function () { return /wm:meeting:/.test(document.getElementById('nbSrc').value); }, null, 12000), '노트 끝에 🤝 프로젝트 회의록 칩');
    var mt = (await c.query("SELECT id, title, meet_date, attendees, form, agenda FROM meetings WHERE project_id = 'nbpr-p1'")).rows[0];
    check(mt && mt.title === '컨베이어 소음' && mt.meet_date === '2026-11-03' && mt.attendees.length === 2 && mt.form.place === '3층 회의실' && mt.form.timeStart === '14:00' && /베어링 교체/.test(mt.form.decisions) && mt.agenda.length === 2,
      '프로젝트 회의 — 제목 · 날짜 · 참석 · 장소 · 시간 · 결정 · 안건');
    var acts = mt ? (await c.query('SELECT title, assignee_name, due_date FROM meeting_action_items WHERE meeting_id = $1 ORDER BY sort_order', [mt.id])).rows : [];
    check(acts.length === 2 && acts[0].title === '베어링 발주' && acts[0].assignee_name === '김철수' && /-11-10$/.test(String(acts[0].due_date)) && acts[1].assignee_name === '이영희', '할 일 → 액션 아이템 (담당 · 기한)');
    await closeModal();

    // 6) 📅 일일 노트 한 장 — Ctrl+P
    await p.click('#nbSide [data-view="daily"]');
    await until(function () { return document.querySelectorAll('#nbItems .nb-it[data-daily]').length >= 2; });
    await p.click('#nbItems .nb-it[data-daily="' + today + '"]');
    await until(function (d) { return NB.daily1 && NB.daily1.date === d; }, today);
    await p.focus('#nbSrc');
    await p.keyboard.down('Control'); await p.keyboard.press('p'); await p.keyboard.up('Control');
    check(await frame('일일 업무 보고') && await frame('견적서 보내기'), 'Ctrl+P → 일일 업무 보고 양식');
    var t2 = await frameText();
    check(/완료 1 \/ 2/.test(t2) && /내일 계획/.test(t2) && /시운전 준비/.test(t2), '실적 (완료 1/2) · 내일 계획');
    await closeModal();

    // 7) 📚 묶어 출력
    await p.click('#nbLH [data-nb="print-bundle"]');
    var okB = await frame('일일 업무 보고 모음') && await frame('목차');
    if (!okB) console.log('  상태:', await p.evaluate(function () { return JSON.stringify({ mode: NBPR.mode, b: NBPR.bundle, n: NBPR.items.length, modal: !!document.getElementById('nbPrintModal'), btn: !!document.querySelector('#nbLH [data-nb="print-bundle"]') }); }));
    check(okB, '🖨 묶어 출력 — 표지 · 목차');
    check(await until(function () { return /2건/.test(document.getElementById('nbprBMsg').textContent); }), '최근 7일 일일 노트 2건');
    check(await p.evaluate(function () { return document.getElementById('nbprFrame').contentDocument.querySelectorAll('.pg-brk').length === 2; }), '한 건씩 새 쪽 (나눔 2곳)');
    await p.click('#nbprSide input[data-o="perPage"]');
    check(await until(function () { var d = document.getElementById('nbprFrame').contentDocument; return d && d.body && /목차/.test(d.body.innerHTML) && d.querySelectorAll('.pg-brk').length === 0; }), '이어 붙이기 — 쪽 나눔 없음');
    await p.click('#nbprSide [data-o="b-src"][data-v="notes"]');
    check(await until(function () { return /\d+건/.test(document.getElementById('nbprBMsg').textContent); }) && await frame('컨베이어 소음'), '📓 내 노트로 바꿔 묶기 (이 기간 노트 1건 — 표지 없이 그 노트 양식)');
    await p.screenshot({ path: path.join(SHOT, 'e2e61-bundle.png') });
    await closeModal();

    // 8) 휴대폰 폭 — 가로로 넘치지 않음
    await p.setViewport({ width: 390, height: 820, isMobile: true, hasTouch: true });
    await p.evaluate(function (id) { return nbOpenNote(id); }, nid);
    await until(function (id) { return NB.cur && NB.cur.id === id; }, nid);
    await p.evaluate(function () { nbPrintOpen(); });
    await frame('회의록');
    await wait(300);
    var mob = await p.evaluate(function () { var bx = document.querySelector('#nbPrintModal .wa-modal-box'), pv = document.getElementById('nbprPv'); return { bw: bx.scrollWidth - bx.clientWidth, pw: pv.scrollWidth - pv.clientWidth, sc: document.getElementById('nbprPaper').style.transform }; });
    check(mob.bw <= 1 && mob.pw <= 1 && /scale/.test(mob.sc), '휴대폰 — 종이를 줄여 가로 넘침 없음');
    await p.screenshot({ path: path.join(SHOT, 'e2e61-mobile.png') });
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  check(!errs.length, '페이지 오류 없음' + (errs.length ? ' — ' + errs.join(' | ') : ''));
  await b.close();
  await c.query('DELETE FROM doc_print_settings WHERE tenant_id = $1', [adm.tenant_id]);
  await c.end();
  console.log('\n' + ok + ' 통과 · ' + fail + ' 실패' + (fail ? '' : ' — ALL PASS'));
  process.exit(fail ? 1 : 0);
})();
