// 📓 노트북 v13.317 연결 · 공유 · 리포트 + v13.318 ✍️ 글쓰기 코치 — 관리자 · 김팀원 두 사람
//   [[ 자동 완성 · 노트 잇기 · 가리키는 노트 · 📌 업무 칩(진척) · 체크 → 할 일 · 체크하면 할 일도 완료
//   · ✍️ 코치(규칙 · 왜/힌트/예시 · 이 자리로 · 데이터와 다름 · 나의 글쓰기) · 👥 공유(읽기 전용) · 📊 리포트 → 새 노트 · 주간 업무 작성에 넣기
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var kim = (await c.query("SELECT id FROM users WHERE email = 'kim@t.com'")).rows[0];
  await c.query('DELETE FROM nb_notes WHERE user_id = ANY($1)', [[adm.id, kim.id]]);
  await c.query('DELETE FROM nb_coach_logs WHERE user_id = ANY($1)', [[adm.id, kim.id]]);
  await c.query("DELETE FROM my_todos WHERE user_id = $1 AND title LIKE '%도면 확인%'", [adm.id]);
  await c.query("DELETE FROM projects WHERE id = 'nbe-p1'");
  await c.query("INSERT INTO projects (id, name, status, progress, owner_id, visibility, tenant_id, start_date, end_date) VALUES ('nbe-p1', '노트시험 장비', 'active', 42, $1, 'tenant', $2, '2026-10-01', '2026-12-31')", [adm.id, adm.tenant_id]);

  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-nb2' + email + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { d.accept(); });
    await p.setViewport({ width: 1500, height: 920 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    return { b: b, p: p };
  }
  var A, K, p;
  function until(fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  function saved() { return until(function () { var s = document.getElementById('nbState'); return s && /저장됨/.test(s.textContent) && !Object.keys(NB.pend).length && !NB.saving && !NB.timer; }, null, 10000); }
  async function endOfSrc() { await p.evaluate(function () { var s = document.getElementById('nbSrc'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }); }
  try {
    A = await open('admin@t.com'); p = A.p;
    await p.click('#hdrNbBtn');
    await until(function () { return !!document.querySelector('#nbSide .nb-nav'); });
    // 바탕 노트 하나
    await p.evaluate(function () { return apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: '센서 사양', body: '## 사양\n- 측정 범위 0~100' }) }); });

    // 1) [[ 자동 완성 → 노트 잇기
    await p.click('[data-nb="new"]');
    await until(function () { return document.activeElement && document.activeElement.id === 'nbTitle'; });
    await p.keyboard.type('설치 계획'); await p.keyboard.press('Enter');
    await p.keyboard.type('먼저 [[센');
    check(await until(function () { var w = document.getElementById('nbWiki'); return w && /센서 사양/.test(w.textContent); }), '[[ → 노트 제목 자동 완성');
    await p.keyboard.press('Enter');
    check((await p.$eval('#nbSrc', function (e) { return e.value; })) === '먼저 [[센서 사양]]', '고르면 [[센서 사양]]');
    check(await until(function () { var a = document.querySelector('#nbDoc a.nb-wl'); return a && a.getAttribute('data-id') && !a.classList.contains('missing'); }), '미리보기 — 있는 노트로 이어짐');
    await saved();

    // 2) 📌 업무 연결 → 칩에 진척
    await endOfSrc(); await p.keyboard.press('Enter');
    await p.keyboard.type('- 진척 70% ');
    await p.click('[data-fmt="wm"]');
    await until(function () { return !!document.getElementById('nbLkQ'); });
    await p.type('#nbLkQ', '노트시험');
    check(await until(function () { return /노트시험 장비/.test(document.getElementById('nbLkL').textContent); }), '🔗 업무 연결 — 프로젝트 찾기');
    await p.evaluate(function () { [].slice.call(document.querySelectorAll('#nbLkL [data-li]')).filter(function (b) { return /노트시험 장비/.test(b.textContent); })[0].click(); });
    check(/\]\(wm:project:nbe-p1\)/.test(await p.$eval('#nbSrc', function (e) { return e.value; })), '본문에 (wm:project:…)');
    check(await until(function () { var a = document.querySelector('#nbDoc a.nb-ref-project .nb-ref-st'); return a && /42%/.test(a.textContent); }), '칩에 지금 진척 42%');

    // 3) 체크 줄 → 내 할 일 · 체크하면 할 일도 완료
    await endOfSrc(); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');   // 목록 이어 쓰기를 끝내고
    await p.keyboard.type('- [ ] 내일 도면 확인');
    await until(function () { return !!document.querySelector('#nbDoc li.nb-task [data-tk="todo"]'); });
    await p.evaluate(function () { document.querySelector('#nbDoc li.nb-task [data-tk="todo"]').click(); });
    check(await until(function () { return /도면 확인 ⟦[^⟧]+⟧/.test(document.getElementById('nbSrc').value); }), '✏️ 할 일 → 줄 끝에 ⟦할 일⟧');
    var td = (await c.query("SELECT id, due_date, done_at FROM my_todos WHERE user_id = $1 AND title = '도면 확인'", [adm.id])).rows[0];
    check(td && td.due_date && !td.done_at, 'DB — 내 할 일 (내일 마감 읽음)');
    await p.evaluate(function () { var i = [].slice.call(document.querySelectorAll('#nbDoc input[data-task]')).pop(); i.click(); });
    check(await until(function () { return /- \[x\] 내일 도면 확인/.test(document.getElementById('nbSrc').value); }), '체크 → 노트 [x]');
    await wait(800);
    check(!!(await c.query('SELECT done_at FROM my_todos WHERE id = $1', [td.id])).rows[0].done_at, 'DB — 할 일도 완료');
    await saved();

    // 4) [[센서 사양]] 누르기 → 그 노트 · 가리키는 노트
    await p.click('#nbDoc a.nb-wl');
    check(await until(function () { return NB.cur && NB.cur.title === '센서 사양' && /설치 계획/.test(document.getElementById('nbBL').textContent); }), '[[ ]] 누르면 그 노트 · 아래에 "가리키는 노트"');
    await p.click('#nbBL [data-open-note]');
    await until(function () { return NB.cur && NB.cur.title === '설치 계획'; });

    // 5) ✍️ 코치 — 규칙 · 왜/힌트/예시 · 이 자리로 · 데이터와 다름
    await p.click('[data-nb="coach"]');
    check(await until(function () { return document.querySelector('#nbCoach .nb-cs-ring b') && document.getElementById('nbMain').classList.contains('coach-on'); }), '✍️ 코치 칸 · 점수');
    check(await until(function () { return [].slice.call(document.querySelectorAll('#nbCoach .nb-co-i')).some(function (x) { return /적은 진척 70% · 실제 프로젝트 42%/.test(x.textContent); }); }), '📊 데이터와 다름 — 적은 70% · 실제 42%');
    await endOfSrc(); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
    await p.keyboard.type('센서 교체를 진행하도록 하겠습니다. 몇일 뒤 다시 재검토 예정');
    check(await until(function () { var t = document.getElementById('nbCoach').textContent; return /군더더기/.test(t) && /맞춤법/.test(t) && /겹말/.test(t); }), '쓰는 동안 바로 — 군더더기 · 맞춤법 · 겹말');
    await p.evaluate(function () { var it = [].slice.call(document.querySelectorAll('#nbCoach .nb-co-i')).filter(function (x) { return /몇일/.test(x.textContent); })[0]; it.querySelector('[data-cstep]').click(); });
    check(await until(function () { var it = [].slice.call(document.querySelectorAll('#nbCoach .nb-co-i')).filter(function (x) { return /몇일/.test(x.textContent); })[0]; return it && it.querySelector('.nb-co-why') && !it.querySelector('.nb-co-hint'); }), '[왜?] → 이유만 (힌트는 아직)');
    await p.evaluate(function () { var it = [].slice.call(document.querySelectorAll('#nbCoach .nb-co-i')).filter(function (x) { return /몇일/.test(x.textContent); })[0]; it.querySelector('[data-cstep]').click(); });
    await p.evaluate(function () { var it = [].slice.call(document.querySelectorAll('#nbCoach .nb-co-i')).filter(function (x) { return /몇일/.test(x.textContent); })[0]; var b = it.querySelector('[data-cstep]'); if (b) b.click(); });
    check(await until(function () { var it = [].slice.call(document.querySelectorAll('#nbCoach .nb-co-i')).filter(function (x) { return /몇일/.test(x.textContent); })[0]; return it && it.querySelector('.nb-co-hint') && /며칠/.test(it.querySelector('.nb-co-ex').textContent); }), '[힌트] → [예시] 차례로');
    await p.evaluate(function () { var it = [].slice.call(document.querySelectorAll('#nbCoach .nb-co-i')).filter(function (x) { return /몇일/.test(x.textContent); })[0]; it.querySelector('[data-cgo]').click(); });
    check(await p.evaluate(function () { var s = document.getElementById('nbSrc'); return s.value.slice(s.selectionStart, s.selectionEnd) === '몇일'; }), '“인용” 누르면 원문의 그 자리를 고름');
    await p.evaluate(function () { var b = document.querySelector('#nbCoach [data-cf="spell"]'); if (b) b.click(); });
    check(await until(function () { var l = document.querySelectorAll('#nbCoach .nb-co-list .nb-co-i'); return l.length === 1 && /몇일/.test(l[0].textContent); }), '버릇 칩으로 거르기');
    await wait(2500);   // 코치 기록 (처음엔 1.5초 뒤)
    await p.evaluate(function () { document.querySelector('#nbCoach [data-cz="stats"]').click(); });
    check(await until(function () { return /이번 주 점수/.test(document.getElementById('nbCoach').textContent) && /이번 주 연습/.test(document.getElementById('nbCoach').textContent); }), '📈 나의 글쓰기 — 이번 주 점수 · 연습 과제');
    check((await c.query('SELECT counts FROM nb_coach_logs WHERE user_id = $1', [adm.id])).rows.length === 1, 'DB — 코치 기록');
    await p.screenshot({ path: path.join(SHOT, 'e2e60-coach.png') });
    await p.evaluate(function () { document.querySelector('#nbCoach [data-cz="now"]').click(); });

    // 6) 👥 공유 → 김팀원
    await saved();
    await p.click('[data-nb="share"]');
    await until(function () { return !!document.getElementById('nbShQ'); });
    await p.type('#nbShQ', '김');
    await until(function () { return !!document.querySelector('#nbShL [data-uid]'); });
    await p.evaluate(function (kid) { var c = document.querySelector('#nbShL [data-uid="' + kid + '"]'); c.click(); }, kim.id);
    await p.click('#nbShareModal [data-x="ok"]');
    check(await until(function () { return !document.getElementById('nbShareModal') && /1/.test((document.querySelector('[data-nb="share"] small') || {}).textContent || ''); }), '공유 저장 → 👥 1');
    var noteId = await p.evaluate(function () { return NB.cur.id; });
    check((await c.query('SELECT 1 FROM nb_shares WHERE note_id = $1 AND user_id = $2', [noteId, kim.id])).rows.length === 1, 'DB — 공유');

    // 7) 📊 리포트 → 새 노트
    await p.click('#nbSide [data-nb="report"]');
    await until(function () { return !!document.getElementById('nbRpF'); });
    await p.click('#nbReportModal [data-x="run"]');
    check(await until(function () { return !document.getElementById('nbRpOut').classList.contains('hidden') && /설치 계획/.test(document.getElementById('nbRpPrev').textContent); }), '📊 그대로 모으기 — 이번 주 노트가 날짜별로');
    await p.click('#nbReportModal [data-x="new"]');
    check(await until(function () { return NB.cur && /노트 모음/.test(NB.cur.title) && (NB.cur.tags || []).indexOf('리포트') >= 0; }), '리포트 → 새 노트 (#리포트)');

    // 8) 주간 업무 작성에 넣기
    await p.evaluate(function () { window.wrAuthorInsert('[개발]\n- [노트사] 리포트 넣기 시험 50%'); });
    check(await until(function () { var t = document.getElementById('wrAuEditor') || document.getElementById('wrAuEditorCur'); return t && t.value.indexOf('[노트사] 리포트 넣기 시험 50%') >= 0; }, null, 15000), '📝 주간 업무 작성 금주 칸에 들어감');

    // 9) 김팀원 — 공유받은 노트 (읽기 전용)
    K = await open('kim@t.com'); p = K.p;
    await p.click('#hdrNbBtn');
    check(await until(function () { return !!document.querySelector('#nbSide [data-view="shared"]'); }), '김팀원 — 왼쪽 "👥 공유받은 노트"');
    await p.click('#nbSide [data-view="shared"]');
    await until(function () { return !!document.querySelector('#nbItems .nb-it[data-id]'); });
    await p.click('#nbItems .nb-it[data-id]');
    check(await until(function () { return NB.cur && NB.cur.readOnly && /공유한 노트 — 읽기 전용/.test(document.getElementById('nbMain').textContent) && document.getElementById('nbSrc').readOnly && !document.getElementById('nbTb'); }), '읽기 전용 — 서식 막대 없음 · 글 못 고침');
    check(await p.evaluate(function () { return !document.querySelector('#nbDoc [data-tk]') && !document.querySelector('[data-nb="share"]'); }), '읽기 전용 — 할 일 · 공유 단추 없음');
    await p.click('[data-nb="copy-mine"]');
    check(await until(function () { return NB.cur && !NB.cur.readOnly && /설치 계획/.test(NB.cur.title); }), '📓 내 노트로 복사');
    var cardRow = (await c.query("SELECT m.cards FROM chat_messages m WHERE m.user_id = $1 AND m.cards IS NOT NULL ORDER BY m.id DESC LIMIT 1", [adm.id])).rows[0];
    check(cardRow && cardRow.cards[0].type === 'note' && cardRow.cards[0].id === noteId, '메신저 1:1 에 노트 카드');
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  check(!errs.length, '페이지 오류 없음' + (errs.length ? ' — ' + errs.join(' | ') : ''));
  if (A) await A.b.close(); if (K) await K.b.close();
  await c.end();
  console.log('\n' + ok + ' 통과 · ' + fail + ' 실패' + (fail ? '' : ' — ALL PASS'));
  process.exit(fail ? 1 : 0);
})();
