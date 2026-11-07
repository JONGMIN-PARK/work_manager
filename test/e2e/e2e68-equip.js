// 🏭 장비 단위 연결 (v13.365) — 관리자 · 김팀원
//   장비 마스터(A/S) + A/S 이력 → 글쓰기 장비 칸에서 고르기(equipId) → 요청 카드 🏭 누르면 장비 카드
//   (마스터 정보 · 보증 · 요청 · A/S 이력 · 문서) → 💬 장비 방 만들기(요청 맡은 김팀원도) → 방 옆 칸 🏭 장비 탭 → ✍️ 이 장비 요청(장비 미리 채움)
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
  await c.query("DELETE FROM as_tickets WHERE id = 'ast-e2e68'"); await c.query("DELETE FROM as_equipment_master WHERE id = 'eqm-e2e68'");
  await c.query("INSERT INTO as_equipment_master (id, tenant_id, serial_no, equipment_no, equipment_model, customer_name, site_line, warranty_status) VALUES ('eqm-e2e68',$1,'SN-6801','PRJ-68','VS-200 비전검사기','한빛전자','2라인','보증내')", [adm.tenant_id]);
  await c.query("INSERT INTO as_tickets (id, ticket_no, tenant_id, customer_name, serial_no, equipment_model, issue_summary, status, priority) VALUES ('ast-e2e68','AS-E2E-68',$1,'한빛전자','SN-6801','VS-200 비전검사기','조명 깜빡임 · 카메라 초점 틀어짐','in_progress','P2')", [adm.tenant_id]);
  require('fs').mkdirSync(SHOT, { recursive: true });

  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
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
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }

  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    var room = await a.evaluate(function (uid) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '품질팀', userIds: [uid] }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.click('#hdrMsgBtn'); await a.evaluate(function (r) { chatOpenRoom(r); }, room); await until(a, function () { return CX.info && document.getElementById('cxIn'); });

    // 글쓰기 — 장비 칸에서 마스터 고르기
    await a.click('#cxComp [data-c="post"]');
    await a.waitForSelector('#ccEquip');
    await a.focus('#ccEquip');
    check(await until(a, function () { var dl = document.getElementById(document.getElementById('ccEquip').getAttribute('list')); return dl && /VS-200 비전검사기 · SN-6801/.test(dl.innerHTML); }), '장비 칸 — 장비 마스터 고르기 목록');
    await a.type('#ccTitle', '카메라 초점 재조정 요청');
    await a.evaluate(function () { document.getElementById('ccEquip').value = 'VS-200 비전검사기 · SN-6801'; });
    await a.select('#ccAsg', kim.id);
    await a.click('#cxPostModal [data-ok]');
    await wait(800);
    var pst = (await c.query("SELECT post FROM chat_messages WHERE room_id = $1 AND post IS NOT NULL", [room])).rows[0].post;
    check(pst.equipId === 'eqm-e2e68', '글이 장비 마스터와 이어짐 (equipId)');

    // 🏭 누르면 장비 카드
    await until(a, function () { return document.querySelector('#cxMsgs .cc-post [data-equip]'); });
    await a.evaluate(function () { document.querySelector('#cxMsgs .cc-post [data-equip]').click(); });
    var card = await until(a, function () { var c = document.querySelector('#cxLib .ce-card'); return c && /VS-200 비전검사기/.test(c.textContent) && /한빛전자/.test(c.textContent) && /보증내/.test(c.textContent) && /카메라 초점 재조정 요청/.test(c.textContent) && /AS-E2E-68/.test(c.textContent) && /진행 중/.test(c.textContent); }, null, 10000);
    check(card, '장비 카드 — 마스터 · 보증 · 요청 · A/S 이력(진행 중)');
    check(await a.evaluate(function () { return /🏭 VS-200/.test(document.querySelector('#cxLib .ce-it.on').textContent); }), '왼쪽 목록에서 그 장비가 골라져 있음');
    await a.screenshot({ path: path.join(SHOT, 'e2e68-equip-card.png') });

    // 💬 장비 방 만들기
    await a.evaluate(function () { document.querySelector('#cxLib .ce-a [data-room]').click(); });
    check(await until(a, function () { return CX.info && CX.info.equipKey === 'm:eqm-e2e68' && /🏭 VS-200/.test(document.getElementById('cxHead').textContent); }, null, 8000), '장비 방 만들고 열림 — 이름 "🏭 VS-200 …"');
    var members = (await c.query("SELECT m.user_id FROM chat_members m JOIN chat_rooms r ON r.id = m.room_id WHERE r.equip_key = 'm:eqm-e2e68' AND m.left_at IS NULL", [])).rows.map(function (x) { return x.user_id; });
    check(members.indexOf(kim.id) >= 0, '요청 맡은 김팀원도 장비 방에');
    check(await until(a, function () { var t = document.querySelector('#cxAside [data-tab="equip"]'); return t && t.classList.contains('on') && document.querySelector('#cxAsB .ce-card.compact'); }), '장비 방 옆 칸 — 🏭 장비 탭이 먼저 · 작은 카드');
    // ✍️ 이 장비 요청
    await a.evaluate(function () { document.querySelector('#cxAsB [data-newreq]').click(); });
    check(await until(a, function () { var e = document.getElementById('ccEquip'); return e && e.value === 'VS-200 비전검사기 · SN-6801'; }, null, 8000), '✍️ 이 장비 요청 — 장비 칸 미리 채움');
    await a.screenshot({ path: path.join(SHOT, 'e2e68-equip-room.png') });
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack); }
  finally { if (A) await A.b.close(); if (K) await K.b.close(); await c.end(); }
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
