// 📨 업무 요청 화면 (v13.525) — 프로젝트 상세 📨 업무 보내기 → 받는 사람 메신저 카드 ✔ 수락 → 내 할 일 · 보낸 사람 요청함 상태
//   · 내 할 일 패널 📨 보내기(이관 기본) · 일정 창 📨 보내기 · 머리 줄 📨 배지
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var ok = 0, fail = 0, errs = [];
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email) {
    var ctx = await browser.createBrowserContext();
    var page = await ctx.newPage();
    page.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    page.on('dialog', function (d) { d.accept(); });
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', email); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(800);
    return page;
  }
  try {
    var A = await open('admin@t.com');
    var T = Date.now();
    var pid = await A.evaluate(function (T) {
      var id = 'e2e-wq-' + T;
      return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ id: id, name: '요청 화면 ' + T, status: 'active', checklists: false, visibility: 'tenant' }) }).then(function () { return id; });
    }, T);
    // 1) 프로젝트 상세 → 📨 업무 보내기
    await A.evaluate(function (id) { setPage('project'); showProjectDetail(id); }, pid);
    await A.waitForSelector('.pd-wrq-btn', { timeout: 10000 });
    await A.click('.pd-wrq-btn');
    await A.waitForSelector('#wrqModal .wrq-who-in', { timeout: 8000 });
    var m1 = await A.evaluate(function () {
      var on = document.querySelector('#wrqModal .wrq-type.on');
      return { type: on && on.dataset.t, proj: (document.querySelector('#wrqModal .wrq-proj') || {}).textContent, title: document.querySelector('#wrqModal [data-k="title"]').value,
        types: Array.prototype.map.call(document.querySelectorAll('#wrqModal .wrq-type'), function (b) { return b.dataset.t; }).join(',') };
    });
    check(m1.type === 'order' && /요청 화면/.test(m1.proj || '') && /요청 화면/.test(m1.title), '보내기 창 — 업무 지시 · 프로젝트 · 제목 채움 ' + JSON.stringify(m1));
    check(m1.types === 'order,transfer,forward,event', '프로젝트에서 — 지시 · 이관 · 전달 · 일정');
    // 빈 칸을 누르면 등록된 사람 모두 (예전엔 8명만)
    await A.focus('#wrqModal .wrq-who-in');
    await A.waitForSelector('#wrqModal .wrq-sg', { timeout: 5000 });
    var all = await A.evaluate(function () { return apiFetch('/api/users/lookup').then(function (r) { return { n: r.data.length, shown: document.querySelectorAll('#wrqModal .wrq-sg').length, dept: 'dept_name' in r.data[0] }; }); });
    check(all.shown === all.n - 1 && all.dept, '빈 칸 — 나 빼고 등록 인원 모두 ' + JSON.stringify(all));
    await A.evaluate(function () { var m = document.getElementById('wrqModal'); m._wmClose ? m._wmClose() : m.remove(); });
    // 15명 · 부서 3개로 — 다 보이고 부서별 묶음 · 부서 이름으로 찾기 · 부서 모두 넣기
    var big = await A.evaluate(function () {
      var save = _wqPeople;
      _wqPeople = []; for (var i = 0; i < 15; i++) _wqPeople.push({ id: 'u' + i, name: '사람' + String(i).padStart(2, '0'), dept: ['설계팀', '제어팀', '생산팀'][i % 3] });
      return wrqOpen({ type: 'order' }).then(function () {
        var inp = document.querySelector('#wrqModal .wrq-who-in'); inp.focus(); inp.dispatchEvent(new Event('focus'));
        var r = { shown: document.querySelectorAll('#wrqModal .wrq-sg').length, depts: [].map.call(document.querySelectorAll('#wrqModal .wrq-sg-dept'), function (x) { return x.textContent; }) };
        inp.value = '제어'; inp.dispatchEvent(new Event('input'));
        r.find = document.querySelectorAll('#wrqModal .wrq-sg').length;
        var d = document.querySelector('#wrqModal .wrq-sg-dept'); d.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        r.chips = document.querySelectorAll('#wrqModal .wrq-chip').length;
        var m = document.getElementById('wrqModal'); m._wmClose ? m._wmClose() : m.remove();
        _wqPeople = save;
        return r;
      });
    });
    check(big.shown === 15 && big.depts.length === 3 && big.find === 5 && big.chips === 5, '15명 모두 · 부서 3묶음 · 부서로 찾기 5 · 부서 모두 넣기 5 ' + JSON.stringify(big));
    await A.click('.pd-wrq-btn');
    await A.waitForSelector('#wrqModal .wrq-who-in', { timeout: 8000 });
    await A.type('#wrqModal .wrq-who-in', '김');
    await A.waitForSelector('#wrqModal .wrq-sg', { timeout: 5000 });
    await A.keyboard.press('Enter');
    var chips = await A.evaluate(function () { return document.querySelector('#wrqModal .wrq-chips').textContent; });
    check(/김팀원/.test(chips), '받는 사람 — 이름 치고 Enter ' + chips);
    await A.evaluate(function () { var t = document.querySelector('#wrqModal [data-k="title"]'); t.value += ' 도면 검토'; document.querySelector('#wrqModal [data-k="body"]').value = '3번 축 간섭 확인해 주세요'; document.querySelector('#wrqModal [data-k="dueDate"]').value = '2026-12-03'; });
    await A.click('#wrqModal [data-a="send"]');
    await A.waitForFunction(function () { return !document.getElementById('wrqModal'); }, { timeout: 8000 }).catch(function () {});
    check(!(await A.$('#wrqModal')), '보내고 창 닫힘');

    // 2) 받는 사람 — 머리 줄 배지 · 메신저 카드 · 수락
    var K = await open('kim@t.com');
    await K.evaluate(function () { _wqBadge(); });
    await wait(800);
    var badge = await K.evaluate(function () { var b = document.querySelector('#hdrWrqBtn .wrq-badge'); return b && !b.hidden ? b.textContent : ''; });
    check(+badge >= 1, '📨 배지 ' + badge);
    var room = await K.evaluate(function () {
      return apiFetch('/api/chat/rooms').then(function (r) { var me = currentUser.id; return ((r && r.data) || []).filter(function (x) { return x.kind === 'dm' && x.peerId && x.peerId !== me; }).map(function (x) { return x.id; }); });
    });
    await K.evaluate(function () { setPage('messages'); });
    await wait(1200);
    var found = null;
    for (var i = 0; i < room.length && !found; i++) {
      await K.evaluate(function (id) { chatOpenRoom(id); }, room[i]);
      await wait(1500);
      found = await K.evaluate(function () { var c = Array.prototype.filter.call(document.querySelectorAll('.wrq-card'), function (x) { return /도면 검토/.test(x.textContent); }).pop(); return c ? { t: c.textContent, btn: !!c.querySelector('[data-wq="accept"]') } : null; });
    }
    check(found && found.btn && /업무 지시/.test(found.t) && /2026-12-03/.test(found.t) && /3번 축/.test(found.t), '메신저 카드 — 지시 · 기한 · 내용 · 수락 단추 ' + JSON.stringify(found));
    await K.evaluate(function () { var c = Array.prototype.filter.call(document.querySelectorAll('.wrq-card'), function (x) { return /도면 검토/.test(x.textContent); }).pop(); c.querySelector('[data-wq="accept"]').click(); });
    await K.waitForFunction(function () { var c = Array.prototype.filter.call(document.querySelectorAll('.wrq-card'), function (x) { return /도면 검토/.test(x.textContent); }).pop(); return c && c.classList.contains('st-accepted'); }, { timeout: 8000 }).catch(function () {});
    var st = await K.evaluate(function () { var c = Array.prototype.filter.call(document.querySelectorAll('.wrq-card'), function (x) { return /도면 검토/.test(x.textContent); }).pop(); return c && { cls: c.className, done: !!c.querySelector('[data-wq="done"]') }; });
    check(st && /st-accepted/.test(st.cls) && st.done, '수락 → 카드 바뀜 · ✅ 완료 단추 ' + JSON.stringify(st));
    var todo = await K.evaluate(function () { return apiFetch('/api/my-work').then(function (r) { var d = r.data || r, items = d.items || d; return (items || []).filter(function (x) { return x.src === 'todo' && /도면 검토/.test(x.title); }).map(function (x) { return { due: x.due, memo: x.memo }; })[0]; }); });
    check(todo && todo.due === '2026-12-03' && /업무 지시/.test(todo.memo || ''), '받는 사람 내 할 일 ' + JSON.stringify(todo));

    // 3) 보낸 사람 — 📨 요청함 (보낸 요청 · 수락)
    await A.evaluate(function () { wrqBox('out'); });
    await A.waitForSelector('#wrqBox .wrq-item', { timeout: 8000 }).catch(function () {});
    var bx = await A.evaluate(function () { var it = Array.prototype.filter.call(document.querySelectorAll('#wrqBox .wrq-item'), function (x) { return /도면 검토/.test(x.textContent); })[0]; return it && it.textContent; });
    check(/수락/.test(bx || '') && /김팀원/.test(bx || ''), '요청함 — 보낸 요청 수락 상태 ' + (bx || '').slice(0, 80));
    await A.keyboard.press('Escape'); await wait(200);

    // 4) 내 할 일 패널 → 📨 보내기 (이관 기본 · 원래 할 일 연결)
    var tid = await A.evaluate(function (T) { return apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: '견적 회신 ' + T, dueDate: '2026-12-09' }) }).then(function (r) { return r.data.id; }); }, T);
    await A.evaluate(function () { setPage('mywork'); });
    await A.waitForFunction(function () { return typeof _mw !== 'undefined' && _mw.data && _mw.data.data && _mw.data.data.length; }, { timeout: 15000 }).catch(function () {});
    await wait(800);
    await A.evaluate(function (tid) { var it = _mw.data.data.filter(function (x) { return x.id === tid; })[0]; mwPanelOpen(it); }, tid);
    await A.waitForSelector('.mwp-chip[data-p="wreq"]', { timeout: 6000 }).catch(function () {});
    check(!!(await A.$('.mwp-chip[data-p="wreq"]')), '할 일 패널 — 📨 보내기');
    await A.evaluate(function () { document.querySelector('.mwp-chip[data-p="wreq"]').click(); });
    await A.waitForSelector('#wrqModal .wrq-type.on', { timeout: 6000 });
    var m2 = await A.evaluate(function () { return { type: document.querySelector('#wrqModal .wrq-type.on').dataset.t, title: document.querySelector('#wrqModal [data-k="title"]').value, due: document.querySelector('#wrqModal [data-k="dueDate"]').value }; });
    check(m2.type === 'transfer' && /견적 회신/.test(m2.title) && m2.due === '2026-12-09', '할 일 → 이관 기본 · 제목 · 기한 ' + JSON.stringify(m2));
    await A.evaluate(function () { var m = document.getElementById('wrqModal'); m._wmClose ? m._wmClose() : m.remove(); });
    check(!!(await A.$('.mw-wrq')), '내 업무 도구 막대 — 📨 보내기');
    await A.evaluate(function () { document.querySelector('.mw-wrq').click(); });
    await A.waitForSelector('#wrqModal .wrq-type.on', { timeout: 6000 });
    var m3 = await A.evaluate(function () { return { type: document.querySelector('#wrqModal .wrq-type.on').dataset.t, ev: !document.querySelector('#wrqModal .wrq-ev').hidden }; });
    check(m3.type === 'event' && m3.ev, '도구 막대 📨 — 일정 기본 · 끝 시각 · 장소 칸 ' + JSON.stringify(m3));
    await A.evaluate(function () { var m = document.getElementById('wrqModal'); m._wmClose ? m._wmClose() : m.remove(); });

    // 5) 일정 창 📨 보내기
    var eid = await A.evaluate(function (T) { return apiFetch('/api/events', { method: 'POST', body: JSON.stringify({ title: '현장 점검 ' + T, startDate: '2026-12-10', endDate: '2026-12-10', startTime: '10:00', endTime: '11:00', location: '2공장' }) }).then(function (r) { return r.data.id; }); }, T);
    await A.evaluate(function (id) { showEventModal(id); }, eid);
    await A.waitForSelector('#evtModal', { timeout: 8000 });
    await A.evaluate(function () { var b = Array.prototype.filter.call(document.querySelectorAll('#evtModal button'), function (x) { return /보내기/.test(x.textContent); })[0]; b.click(); });
    await A.waitForSelector('#wrqModal .wrq-type.on', { timeout: 6000 }).catch(function () {});
    var m4 = await A.evaluate(function () { var m = document.getElementById('wrqModal'); if (!m) return null; return { type: m.querySelector('.wrq-type.on').dataset.t, title: m.querySelector('[data-k="title"]').value, time: m.querySelector('[data-k="dueTime"]').value, loc: m.querySelector('[data-k="location"]').value }; });
    check(m4 && m4.type === 'event' && /현장 점검/.test(m4.title) && m4.time === '10:00' && m4.loc === '2공장', '일정 창 → 📨 일정 보내기 채움 ' + JSON.stringify(m4));

    await A.evaluate(function (id) { return apiFetch('/api/projects/' + id, { method: 'DELETE' }); }, pid);
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
