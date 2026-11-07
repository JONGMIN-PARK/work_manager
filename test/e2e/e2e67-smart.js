// ✨ 메신저 AI 정리 (v13.364) — 시험 서버엔 AI 키가 없어 '⚙️ 자동 정리'(규칙) 길을 본다
//   안 읽은 7개 → 방 열면 "✨ 안 읽은 7개 — 요약 보기" → 요점 · 나를 부른 것 · 질문 · 요청
//   · 글쓰기 "✨ 내용으로 채우기" → 🛠 요청 · 장비 · 긴급 · 제목 · 🛠 요청함 "✨ 오늘 정리" → 긴급 먼저
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var kim = (await c.query("SELECT id FROM users WHERE email = 'kim@t.com'")).rows[0];
  await c.query('DELETE FROM chat_rooms WHERE tenant_id = $1', [adm.tenant_id]);
  require('fs').mkdirSync(SHOT, { recursive: true });

  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { d.accept(); });
    await p.setViewport({ width: 1400, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    return { b: b, p: p };
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }

  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '라인 B', userIds: [uid] }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.evaluate(function (r) {
      var msgs = ['오늘 라인 B 점검 시작합니다', '컨베이어 속도 20% 낮췄어요', '@김팀원 PLC 프로그램 백업 어디 있나요?', '비전 검사기 조명 교체 완료', '오후 3시에 시운전합니다', '안전 펜스 센서도 확인 부탁', '시운전 결과는 내일 공유할게요'];
      return msgs.reduce(function (p, m) { return p.then(function () { return apiFetch('/api/chat/rooms/' + r + '/messages', { method: 'POST', body: JSON.stringify({ body: m }) }); }); }, Promise.resolve());
    }, room);
    await k.click('#hdrMsgBtn');
    await k.evaluate(function (r) { chatOpenRoom(r); }, room);
    check(await until(k, function () { var e = document.getElementById('csCatch'); return e && /안 읽은 7개/.test(e.textContent); }), '방 열면 "✨ 안 읽은 7개 — 요약 보기"');
    await k.click('#csCatch [data-go]');
    var sum = await until(k, function () { var e = document.querySelector('#csCatch.open'); return e && /메시지 7개/.test(e.textContent) && /나를 부른 것/.test(e.textContent) && /PLC 프로그램 백업/.test(e.textContent) && /자동 정리|AI/.test(e.textContent); }, null, 20000);
    check(sum, '요약 — 요점 · 나를 부른 것 · 질문 (꼬리표)');
    await k.screenshot({ path: path.join(SHOT, 'e2e67-catchup.png') });

    // ✨ 내용으로 채우기
    await k.click('#cxComp [data-c="post"]');
    await k.waitForSelector('#cxPostModal [data-fill]');
    await k.evaluate(function () { document.getElementById('ccBody').value = '2호기 사출기 온도 알람이 계속 떠서 라인 정지했습니다. 히터 쪽 확인 필요'; });
    await k.click('#cxPostModal [data-fill]');
    var filled = await until(k, function () { return document.querySelector('#cxPostModal [data-cat="req"]').classList.contains('on') && document.getElementById('ccEquip').value === '2호기 사출기' && document.getElementById('ccUrg').checked && /사출기 온도 알람/.test(document.getElementById('ccTitle').value); }, null, 20000);
    check(filled, '✨ 채우기 — 🛠 요청 · 장비 "2호기 사출기" · 🔴 긴급 · 제목');
    await k.screenshot({ path: path.join(SHOT, 'e2e67-fill.png') });
    await k.evaluate(function () { var o = document.getElementById('cxPostModal'); o.closest('.wa-modal-overlay').remove(); });

    // ✨ 오늘 정리
    await a.evaluate(function (a) { var r = a[0], uid = a[1]; return Promise.all([
      apiFetch('/api/chat/rooms/' + r + '/posts', { method: 'POST', body: JSON.stringify({ cat: 'req', title: '여유 있는 문서 정리', assignee: uid }) }),
      apiFetch('/api/chat/rooms/' + r + '/posts', { method: 'POST', body: JSON.stringify({ cat: 'req', title: '안전 펜스 센서 교체', assignee: uid, urgency: 'urgent' }) })]); }, [room, kim.id]);
    await k.evaluate(function () { chatLibrary('reqs'); });
    await k.waitForSelector('#cxLib [data-brief]');
    await k.click('#cxLib [data-brief]');
    check(await until(k, function () { var e = document.querySelector('#cxLib .cs-brief'); var li = e && e.querySelector('li'); return e && /오늘 먼저 할 것/.test(e.textContent) && li && /🔴\s*안전 펜스 센서 교체/.test(li.textContent); }, null, 20000), '🛠 요청함 ✨ 오늘 정리 — 긴급 먼저');
    await k.screenshot({ path: path.join(SHOT, 'e2e67-brief.png') });
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (A) await A.b.close(); if (K) await K.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
