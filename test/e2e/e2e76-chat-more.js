// 💬 메신저 v13.424 — ⑥ 화면 → 대화로 보내기 ⑦ 프로젝트 방 자동 소식 ⑧ ☀️ 아침 브리핑 ⑩ /meet 빈 시간 약속
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function kst(n) { return new Date(Date.now() + 9 * 3600000 + (n || 0) * 86400000).toISOString().slice(0, 10); }
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id, COALESCE(display_name, name) AS n FROM users WHERE email = 'admin@t.com'")).rows[0];
  var kim = (await c.query("SELECT id, name, COALESCE(display_name, name) AS n FROM users WHERE email = 'kim@t.com'")).rows[0];
  await c.query('DELETE FROM chat_rooms WHERE tenant_id = $1', [adm.tenant_id]);
  await c.query('DELETE FROM chat_daily').catch(function () {});
  require('fs').mkdirSync(SHOT, { recursive: true });
  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  async function sysIn(room, re, ms) {
    var end = Date.now() + (ms || 8000);
    while (Date.now() < end) {
      var r = await c.query("SELECT body, cards FROM chat_messages WHERE room_id = $1 AND kind = 'system' ORDER BY id DESC LIMIT 20", [room]);
      var hit = r.rows.filter(function (x) { return re.test(x.body); })[0];
      if (hit) return hit;
      await wait(500);
    }
    return null;
  }
  var b;
  try {
    b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-x' + Date.now()) });
    var a = (await b.pages())[0] || await b.newPage();
    a.on('pageerror', function (e) { errs.push(e.message); });
    a.on('dialog', function (d) { d.accept(); });
    await a.setViewport({ width: 1400, height: 900 });
    await a.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await a.waitForSelector('#loginEmail', { visible: true });
    await a.type('#loginEmail', 'admin@t.com'); await a.type('#loginPw', 'Test1234!'); await a.keyboard.press('Enter');
    await a.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    var S = await a.evaluate(async function (kimId) {
      var o = {};
      o.pid = (await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name: '소식 시험 프로젝트', orderNo: 'SO-2026-901', status: 'active', currentPhase: 'design', assignees: [] }) })).data.id;
      var t = new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
      o.mid = (await apiFetch('/api/milestones', { method: 'POST', body: JSON.stringify({ projectId: o.pid, name: '도면 승인', startDate: t, endDate: t, status: 'active' }) })).data.id;
      o.room = (await apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'project', projectId: o.pid }) })).data.id;
      o.grp = (await apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '보내기 시험', userIds: [kimId] }) })).data.id;
      o.tid = (await apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: '브리핑 할 일', dueDate: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) }) })).data.id;
      return o;
    }, kim.id);
    check(S.pid && S.room && S.grp, '표본 — 프로젝트 · 프로젝트 방 · 그룹 방');

    // ⑦ 이슈 · A/S 등록 → 프로젝트 방 소식 (카드)
    await a.evaluate(function (pid) { return apiFetch('/api/issues', { method: 'POST', body: JSON.stringify({ projectId: pid, title: '배선 간섭 확인', urgency: 'urgent', status: 'open' }) }); }, S.pid);
    var s1 = await sysIn(S.room, /새 이슈 \(긴급\) — 배선 간섭 확인/);
    check(s1 && s1.cards && s1.cards[0].show && s1.cards[0].type === 'issue', '이슈 → 프로젝트 방 "🐞 새 이슈 (긴급)" + 카드');
    await a.evaluate(function (pid) { return apiFetch('/api/as-tickets', { method: 'POST', body: JSON.stringify({ projectId: pid, customerName: '코아비스', issueSummary: '조명 깜빡임', priority: 'P2' }) }); }, S.pid);
    check(!!(await sysIn(S.room, /A\/S 접수 — 코아비스 · 조명 깜빡임/)), 'A/S → 프로젝트 방 "🔧 A/S 접수"');
    await a.evaluate(function (pid) { return apiFetch('/api/issues', { method: 'POST', body: JSON.stringify({ projectId: pid, title: '메신저에서 만든 이슈', fromChat: true }) }); }, S.pid);
    await wait(800);
    check(!(await sysIn(S.room, /메신저에서 만든 이슈/, 600)), '메신저에서 만든 것은 소식 안 겹침');
    // 화면에 카드로
    await a.evaluate(function (r) { if (typeof setPage === 'function') setPage('messages'); chatOpenRoom(r); }, S.room);
    check(await until(a, function () { return Array.from(document.querySelectorAll('#cxMsgs .cx-sys-cards .cx-card')).some(function (x) { return /배선 간섭 확인/.test(x.textContent); }); }, null, 10000), '방 화면 — 소식 줄 아래 카드');
    // 내일 마감 마일스톤 (관리자 지금 돌리기)
    var dr = await a.evaluate(function () { return apiFetch('/api/chat/daily-run', { method: 'POST', body: '{}' }).then(function (r) { return r.data; }); });
    check(dr && dr.msdue >= 1, '하루 작업 — 내일 마감 소식 ' + JSON.stringify(dr));
    check(!!(await sysIn(S.room, /내일 마감 — "도면 승인"/)), '프로젝트 방 "🚩 내일 마감 — 도면 승인"');
    var dr2 = await a.evaluate(function () { return apiFetch('/api/chat/daily-run', { method: 'POST', body: '{}' }).then(function (r) { return r.data; }); });
    check(dr2.msdue === 0, '같은 날 두 번 돌려도 한 번만');
    await a.screenshot({ path: path.join(SHOT, 'e2e76-proj.png') });

    // ⑥ 화면 → 대화로 보내기
    await a.evaluate(function (pid) { chatShareRef('project', pid); }, S.pid);
    check(await until(a, function () { return document.querySelectorAll('#chatShareModal [data-room]').length >= 2; }, null, 10000), '보내기 창 — 방 목록');
    check(await a.evaluate(function () { return /소식 시험 프로젝트/.test(document.querySelector('#chatShareModal .cw-share-c').textContent); }), '보낼 카드 이름 (peek 로 채움)');
    await a.type('#chatShareModal [data-q]', '보내기');
    await a.evaluate(function () { document.querySelector('#chatShareModal [data-room]').click(); });
    await a.type('#chatShareModal [data-m]', '이거 확인 부탁해요');
    await a.screenshot({ path: path.join(SHOT, 'e2e76-share.png') });
    await a.click('#chatShareModal [data-go]');
    check(await until(a, function () { return document.getElementById('cwOpenTip') && !document.getElementById('chatShareModal'); }, null, 8000), '보내면 "대화 열기" 알림');
    var sent = (await c.query("SELECT body, cards FROM chat_messages WHERE room_id = $1 AND kind = 'text' ORDER BY id DESC LIMIT 1", [S.grp])).rows[0];
    check(sent && sent.body === '이거 확인 부탁해요' && sent.cards[0].type === 'project' && sent.cards[0].id === S.pid, '그룹 방에 한마디 + 프로젝트 카드');
    await a.click('#cwOpenTip button');
    check(await until(a, function (r) { return CX.room === r; }, S.grp, 8000), '"대화 열기" → 그 방');
    // 사람 찾기 → 새 1:1
    await a.evaluate(function (id) { chatShareRef('todo', id); }, S.tid);
    await until(a, function () { return document.querySelector('#chatShareModal [data-q]'); }, null, 8000);
    await a.type('#chatShareModal [data-q]', kim.n.slice(0, 2));
    check(await until(a, function () { return document.querySelector('#chatShareModal [data-user]'); }, null, 8000), '사람 찾기 — 새 1:1 후보');
    await a.click('#chatShareModal [data-user]'); await a.click('#chatShareModal [data-go]');
    await until(a, function () { return !document.getElementById('chatShareModal'); }, null, 8000);
    var dm = (await c.query("SELECT m.cards FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id WHERE r.kind = 'dm' AND r.tenant_id = $1 ORDER BY m.id DESC LIMIT 1", [adm.tenant_id])).rows[0];
    check(dm && dm.cards && dm.cards[0].type === 'todo', '새 1:1 방에 할 일 카드');
    // 화면 단추 — 프로젝트 ⋯ · A/S 상세
    await a.evaluate(function (pid) { if (typeof showProjectDetail === 'function') showProjectDetail(pid); }, S.pid);
    check(await until(a, function () { return Array.from(document.querySelectorAll('.pd-more-menu *')).some(function (x) { return /대화로 보내기/.test(x.textContent); }); }, null, 8000), '프로젝트 상세 ⋯ 에 "📤 대화로 보내기"');

    // ⑧ 아침 브리핑
    var on = await a.evaluate(function () { return apiFetch('/api/chat/brief', { method: 'PUT', body: JSON.stringify({ on: true }) }).then(function () { return apiFetch('/api/chat/brief'); }).then(function (r) { return r.data.on; }); });
    check(on === true, '브리핑 켜기 저장');
    await a.evaluate(function () { chatBriefNow(); });
    check(await until(a, function () { return CX.info && CX.info.self && CX.msgs.some(function (m) { return m.kind === 'ai' && /^☀️/.test(m.body); }); }, null, 10000), '지금 받아 보기 → 나와의 채팅에 ☀️ 브리핑');
    var br = await a.evaluate(function () { var m = CX.msgs.filter(function (x) { return /^☀️/.test(x.body || ''); }).pop(); var el = document.querySelector('#cxMsgs .cx-m[data-mid="' + m.id + '"]'); return { body: m.body, cards: (m.cards || []).map(function (c) { return c.type + ':' + c.title; }), head: el && el.querySelector('.cx-ai-h') ? el.querySelector('.cx-ai-h').textContent : '' }; });
    check(/할 일 1/.test(br.body) && br.cards.indexOf('todo:브리핑 할 일') >= 0 && /도면 승인/.test(br.body), '브리핑 — 할 일 수 · 카드 · 이번 주 마감 ' + JSON.stringify(br).slice(0, 200));
    check(/아침 브리핑/.test(br.head), '머리 — "☀️ 아침 브리핑"');
    await a.screenshot({ path: path.join(SHOT, 'e2e76-brief.png') });
    await c.query('DELETE FROM chat_daily');
    var dr3 = await a.evaluate(function () { return apiFetch('/api/chat/daily-run', { method: 'POST', body: '{}' }).then(function (r) { return r.data; }); });
    check(dr3.brief >= 1, '하루 작업 — 켠 사람에게 브리핑 ' + JSON.stringify(dr3));

    // ⑩ /meet — 김의 내일 10~12시 일정은 피함
    var tmr = kst(1), tw = new Date(tmr + 'T00:00:00Z').getUTCDay();
    await c.query("INSERT INTO events (id, title, type, start_date, end_date, project_ids, assignees, created_by, tenant_id, start_time, end_time) VALUES ('evt-e2e76', '김 외근', 'etc', $1, $1, '[]', $2, $3, $4, '09:00', '12:00')", [tmr, JSON.stringify([kim.name]), kim.id, adm.tenant_id]);
    await a.evaluate(function (r) { chatOpenRoom(r); }, S.grp);
    await until(a, function (r) { return CX.room === r && document.getElementById('cxIn'); }, S.grp, 8000);
    await a.evaluate(function (n) { return _cxSend('/meet 설계 검토 1시간 @' + n + ' 내일'); }, kim.n);
    check(await until(a, function () { return CX.msgs.some(function (m) { return m.poll && m.poll.kind === 'time' && /설계 검토/.test(m.poll.q); }); }, null, 10000), '/meet → 📅 약속 잡기 투표');
    var pl = await a.evaluate(function () { return CX.msgs.filter(function (m) { return m.poll; }).pop().poll; });
    var hasOverlap = pl.opts.some(function (o) { return o.at === tmr && o.from < '12:00' && o.to > '09:00'; });
    check(pl.opts.length >= 2 && pl.opts.every(function (o) { return !o.busy.length; }), '후보 ' + pl.opts.length + '개 — 모두 빈 시간 ' + JSON.stringify(pl.opts.map(function (o) { return o.t; })));
    check(tw === 0 || tw === 6 || !hasOverlap, '김 외근(내일 9~12시)과 안 겹침');
    check(pl.opts.every(function (o) { var m = (+o.to.slice(0, 2) * 60 + +o.to.slice(3)) - (+o.from.slice(0, 2) * 60 + +o.from.slice(3)); return m === 60 && !(o.from < '13:00' && o.to > '12:00') && o.to <= '18:00'; }), '1시간 · 점심 피함 · 18시 전');
    check(/설계 검토 \(1시간\)/.test(pl.q), '제목에서 @사람 · 길이 · 내일 빠짐 (' + pl.q + ')');
    await a.screenshot({ path: path.join(SHOT, 'e2e76-meet.png') });
    // 1:1 에서 사람 초대 → 둘 + 고른 사람으로 새 그룹 방 (1:1 은 그대로)
    var dmId = await a.evaluate(function (k) { return apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: k }) }).then(function (r) { return r.data.id; }); }, kim.id);
    await a.evaluate(function (r) { chatOpenRoom(r); }, dmId);
    await until(a, function (r) { return CX.room === r && CX.info && CX.info.kind === 'dm'; }, dmId, 8000);
    await a.evaluate(function () { _cxMenu(document.body, []); var x = document.getElementById('cxMenu'); if (x) x.remove(); });
    await a.evaluate(function () { chatInviteModal(); });
    check(await until(a, function () { return document.querySelector('#chatInvModal [data-u]') && /새 그룹 방/.test(document.getElementById('chatInvModal').textContent); }, null, 8000), '1:1 에서 사람 초대 — 새 그룹 방 안내 · 후보');
    var third = await a.evaluate(function () { var b = document.querySelector('#chatInvModal [data-u]'); b.click(); return b.dataset.u; });
    await a.click('#chatInvModal [data-go]');
    check(await until(a, function (d) { return CX.room && CX.room !== d && CX.info && CX.info.kind === 'group' && CX.info.members.length === 3; }, dmId, 10000), '새 그룹 방 — 나 · 김 · 고른 사람 3명');
    var dmLeft = (await c.query('SELECT COUNT(*)::int AS n FROM chat_members WHERE room_id = $1 AND left_at IS NULL', [dmId])).rows[0].n;
    check(dmLeft === 2, '원래 1:1 은 그대로 (2명)');

    // ⑦ 프로젝트 고치기 → (1분 조용하면) 프로젝트 방에 "📁 … 바꿈"
    await a.evaluate(function (pid) { return apiFetch('/api/projects/' + pid, { method: 'PUT', body: JSON.stringify({ name: '소식 시험 프로젝트 2차' }) }); }, S.pid);
    var cf = await sysIn(S.room, /바꿈 — /, 80000);
    check(cf && /소식 시험 프로젝트 2차/.test(cf.body), '프로젝트 고침 → 방에 "📁 … 바꿈" ' + (cf ? cf.body : ''));
    check(!errs.length, '페이지 오류 없음 ' + JSON.stringify(errs));
  } catch (e) { fail++; console.log('FAIL', e.stack || e); }
  finally { if (b) await b.close(); await c.end(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
