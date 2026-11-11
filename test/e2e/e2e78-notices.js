// 📢 공지사항 (v13.444) — 두 브라우저(관리자 · 김팀원)
//   권한(팀원은 못 씀) → 관리자가 쓰고 게시 → 팀원에게 바로 숫자 · '중요' 창 → 읽음 · 읽은 사람 → 고치기 · 다시 알림 · 내리기 · 지우기
//   → 작성자 지정 → 지정된 팀원이 쓰기 (자기 것만 고침) → 게시 끝 지난 공지는 안 보임
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  var kim = (await c.query("SELECT id FROM users WHERE email = 'kim@t.com'")).rows[0];
  await c.query('DELETE FROM notices WHERE tenant_id = $1', [adm.tenant_id]);
  await c.query('DELETE FROM notice_writers WHERE tenant_id = $1', [adm.tenant_id]);
  require('fs').mkdirSync(SHOT, { recursive: true });

  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  async function open(email, vp) {
    var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + email + Date.now()) });
    var p = (await b.pages())[0] || await b.newPage();
    p.on('pageerror', function (e) { errs.push(email + ': ' + e.message); });
    p.on('dialog', function (d) { d.accept(); });
    await p.setViewport(vp || { width: 1400, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', email); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.waitForFunction(function () { return typeof CXS !== 'undefined' && CXS.on; }, { timeout: 10000 }).catch(function () {});
    return { b: b, p: p };
  }
  function until(p, fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  function api(p, url, method, body) { return p.evaluate(function (url, method, body) { return apiFetch(url, { method: method || 'GET', body: body ? JSON.stringify(body) : undefined }).then(function (r) { return { ok: true, r: r }; }, function (e) { return { ok: false, status: e && e.status, msg: e && e.message }; }); }, url, method, body); }
  var badge = function (p) { return p.evaluate(function () { var b = document.getElementById('noticeBadge'); return b && b.style.display !== 'none' ? b.textContent : ''; }); };
  // 확인 대화(wmConfirm) — 자동 시험에서는 기본 confirm 으로 떠서 open() 의 dialog 처리로 수락됨
  async function confirmYes() { await wait(200); }

  var A, K;
  try {
    A = await open('admin@t.com'); K = await open('kim@t.com');
    var a = A.p, k = K.p;
    await wait(1600);   // 로그인 뒤 공지 요약 받기

    // ── 권한 ──
    check(await a.$('#hdrNoticeBtn') && await k.$('#hdrNoticeBtn'), '헤더에 📢 공지사항 단추');
    var s0 = await api(k, '/api/notices/summary');
    check(s0.ok && s0.r.data.unread === 0 && s0.r.data.canWrite === false, '팀원 — 안 읽은 공지 0 · 쓰기 권한 없음');
    var deny = await api(k, '/api/notices', 'POST', { title: '몰래 쓰기', body: 'x', publish: true });
    check(!deny.ok, '팀원은 공지를 쓸 수 없음 (' + (deny.msg || '') + ')');
    check(!(await api(k, '/api/notices/writers')).ok, '팀원은 작성자 지정 목록을 볼 수 없음');

    // ── 관리자: 창 열기 → 쓰기 → 임시 저장 ──
    await a.click('#hdrNoticeBtn');
    await a.waitForSelector('#wmNoticeModal [data-nt="new"]');
    check(await a.evaluate(function () { return !!document.querySelector('#wmNoticeModal .nt-tabs') && /게시된 공지가 없습니다/.test(document.getElementById('ntRoot').textContent); }), '관리자 — 보기 · 관리 탭 + 빈 목록 안내');
    await a.click('#wmNoticeModal [data-nt="new"]');
    await a.waitForSelector('#ntTitle');
    await a.type('#ntTitle', '11월 정기 점검 안내');
    await a.type('#ntBody', '11/15(토) 02:00~04:00 서버 점검이 있습니다.\n자세한 내용: https://example.com/notice <b>굵게?</b>');
    await a.click('#wmNoticeModal [data-nt="save"]');
    await until(a, function () { return !!document.querySelector('#wmNoticeModal .nt-row .st-draft'); });
    check(await a.evaluate(function () { return NT.tab === 'manage' && NT.list.length === 1 && NT.list[0].status === 'draft'; }), '임시 저장 → 관리 탭에 임시로');
    check((await api(k, '/api/notices')).r.data.length === 0 && (await badge(k)) === '', '임시 공지는 팀원에게 안 보임');
    await a.screenshot({ path: path.join(SHOT, 'e2e78-manage.png') });

    // ── 게시 → 팀원에게 바로 ──
    await a.click('#wmNoticeModal .nt-row [data-nt="pub"]');
    await confirmYes(a);
    check(await until(a, function () { return !!document.querySelector('#wmNoticeModal .nt-row .st-live'); }), '게시 → 게시 중');
    check(await until(k, function () { var b = document.getElementById('noticeBadge'); return b && b.style.display !== 'none' && b.textContent === '1'; }), '팀원 헤더에 바로 숫자 1 (실시간)');
    check((await badge(a)) === '', '게시한 사람은 읽은 것으로');
    // 팀원: 열기 → 펼치면 읽음
    await k.click('#hdrNoticeBtn');
    await k.waitForSelector('#wmNoticeModal .nt-card');
    check(await k.evaluate(function () { return !document.querySelector('#wmNoticeModal .nt-tabs') && !document.querySelector('#wmNoticeModal [data-nt="new"]') && !!document.querySelector('#wmNoticeModal .nt-card.unread .nt-new'); }), '팀원 창 — 쓰기 단추 없음 · NEW 표시');
    await k.click('#wmNoticeModal .nt-card [data-nt="toggle"]');
    await until(k, function () { return !!document.querySelector('#wmNoticeModal .nt-card.open .nt-body'); });
    var body = await k.evaluate(function () { var b = document.querySelector('#wmNoticeModal .nt-card.open .nt-body'); return { html: b.innerHTML, link: !!b.querySelector('a[href="https://example.com/notice"]'), bold: !!b.querySelector('b'), br: b.querySelectorAll('br').length }; });
    check(body.link && !body.bold && body.br === 1, '본문 — 주소는 링크 · 줄바꿈 유지 · HTML 은 글자 그대로');
    check(await until(k, function () { var b = document.getElementById('noticeBadge'); return b.style.display === 'none'; }), '펼치면 읽음 → 숫자 사라짐');
    await k.screenshot({ path: path.join(SHOT, 'e2e78-view.png') });
    // 관리자: 읽은 사람
    await a.evaluate(function () { return _ntLoad(); });
    var rc = await a.evaluate(function () { return [NT.list[0].readCount, NT.total]; });
    check(rc[0] === 2 && rc[1] >= 2, '읽음 수 2 / ' + rc[1] + ' (관리자 + 팀원)');
    await a.click('#wmNoticeModal [data-nt="readers"]');
    check(await until(a, function () { return /김/.test((document.querySelector('#wmNoticeModal .nt-rd.yes') || {}).textContent || ''); }), '읽은 사람 목록에 팀원');
    await a.click('#wmNoticeModal [data-nt="back"]');

    // ── 중요 공지 → 팀원에게 창으로 ──
    await k.evaluate(function () { NT.modal && NT.modal.close(); });
    var imp = await api(a, '/api/notices', 'POST', { title: '보안 점검 필수', body: '오늘 중 비밀번호를 바꿔 주세요.', level: 'important', pinned: true, publish: true });
    check(imp.ok && imp.r.data.status === 'published', '중요 공지 게시 (API)');
    check(await until(k, function () { return !!document.getElementById('wmNoticePop') && /보안 점검 필수/.test(document.getElementById('wmNoticePop').textContent); }), "팀원에게 '중요 공지' 창");
    await k.screenshot({ path: path.join(SHOT, 'e2e78-important.png') });
    await k.click('#wmNoticePop [data-nt="pop-ok"]');
    check(await until(k, function () { return !document.getElementById('wmNoticePop') && document.getElementById('noticeBadge').style.display === 'none'; }), '확인했습니다 → 읽음');
    var lk = (await api(k, '/api/notices')).r.data;
    check(lk.length === 2 && lk[0].title === '보안 점검 필수' && lk[0].pinned, '고정한 공지가 맨 위');

    // ── 고치기 + 다시 알림 ──
    var id1 = lk[1].id;
    var up = await api(a, '/api/notices/' + id1, 'PUT', { title: '11월 정기 점검 안내 (시간 바뀜)', notify: true });
    check(up.ok, '고치기 + 다시 알림');
    check(await until(k, function () { var b = document.getElementById('noticeBadge'); return b.style.display !== 'none' && b.textContent === '1'; }), '다시 알림 → 팀원에게 다시 안 읽음 1');
    // ── 내리기 → 사라짐 · 지우기 ──
    check((await api(a, '/api/notices/' + id1 + '/unpublish', 'POST')).ok && await until(k, function () { return document.getElementById('noticeBadge').style.display === 'none'; }), '내리기 → 팀원 숫자에서 빠짐');
    check((await api(k, '/api/notices')).r.data.length === 1, '내린 공지는 팀원 목록에 없음');
    check((await api(a, '/api/notices/' + id1, 'DELETE')).ok && (await api(a, '/api/notices?manage=1')).r.data.length === 1, '지우기');
    // ── 게시 끝 지난 공지 ──
    var old = await api(a, '/api/notices', 'POST', { title: '지난 행사', body: '끝', publish: true, expiresAt: new Date(Date.now() - 3600e3).toISOString() });
    check(old.ok && (await api(k, '/api/notices')).r.data.length === 1 && (await api(k, '/api/notices/summary')).r.data.unread === 0, '게시 끝이 지난 공지는 안 보이고 안 읽음에도 안 셈');
    check((await api(a, '/api/notices?manage=1')).r.data.some(function (n) { return n.title === '지난 행사' && n.ended; }), "관리 탭에는 '끝남' 으로 남음");

    // ── 작성자 지정 (화면) → 지정된 팀원이 쓰기 ──
    await a.evaluate(function () { NT.tab = 'manage'; NT.sub = null; return _ntLoad(); });
    await a.click('#wmNoticeModal [data-nt="writers"]');
    await a.waitForSelector('#wmNoticeModal .nt-w');
    check(await a.evaluate(function () { var f = document.querySelector('#wmNoticeModal .nt-w.fixed input'); return f && f.checked && f.disabled; }), '작성자 지정 — 관리자는 늘 포함(고정)');
    await a.type('#ntWSearch', '김');
    var vis = await a.evaluate(function () { return Array.from(document.querySelectorAll('#wmNoticeModal .nt-w')).filter(function (x) { return !x.hidden; }).length; });
    check(vis >= 1 && vis < await a.evaluate(function () { return document.querySelectorAll('#wmNoticeModal .nt-w').length; }), '이름으로 찾기');
    await a.evaluate(function (uid) { var i = document.querySelector('#wmNoticeModal .nt-w input[value="' + uid + '"]'); i.checked = true; }, kim.id);
    await a.click('#wmNoticeModal [data-nt="writers-save"]');
    check(await until(k, function () { return typeof NT !== 'undefined' && NT.canWrite === true; }), '지정되면 팀원 화면에 바로 반영');
    var kw = await api(k, '/api/notices', 'POST', { title: '팀 회식 안내', body: '금요일 18시', publish: true });
    check(kw.ok && kw.r.data.authorId === kim.id, '지정된 팀원이 공지 게시');
    check(await until(a, function () { var b = document.getElementById('noticeBadge'); return b.style.display !== 'none' && b.textContent === '1'; }), '관리자에게도 알림 숫자');
    var impId = (await api(k, '/api/notices')).r.data.filter(function (n) { return n.title === '보안 점검 필수'; })[0].id;
    check(!(await api(k, '/api/notices/' + impId, 'PUT', { title: '바꿔치기' })).ok && !(await api(k, '/api/notices/' + impId, 'DELETE')).ok, '작성자는 남이 쓴 공지를 고치거나 지울 수 없음');
    check(!(await api(k, '/api/notices/writers', 'PUT', { userIds: [] })).ok, '작성자는 작성자 지정을 바꿀 수 없음');
    check((await api(a, '/api/notices/' + kw.r.data.id, 'PUT', { title: '팀 회식 안내 (장소 추가)' })).ok, '관리자는 모든 공지를 고칠 수 있음');
    // 지정 해제
    check((await api(a, '/api/notices/writers', 'PUT', { userIds: [] })).ok && !(await api(k, '/api/notices', 'POST', { title: 'x' })).ok, '지정을 풀면 다시 못 씀');

    // ── 모두 읽음 ──
    check((await api(a, '/api/notices/read-all', 'POST')).ok && (await api(a, '/api/notices/summary')).r.data.unread === 0, '모두 읽음');

    // ── 다시 로그인하면 안 읽은 중요 공지 창 ──
    await api(a, '/api/notices', 'POST', { title: '전사 공지 — 필독', body: '확인 바랍니다', level: 'important', publish: true });
    await K.b.close();
    K = await open('kim@t.com', { width: 390, height: 780, isMobile: true, hasTouch: true });
    k = K.p;
    check(await until(k, function () { return !!document.getElementById('wmNoticePop') && /필독/.test(document.getElementById('wmNoticePop').textContent); }, null, 10000), '다시 로그인 → 안 읽은 중요 공지 창 (휴대폰 크기)');
    var fit = await k.evaluate(function () { var b = document.querySelector('#wmNoticePop .wa-modal-box').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1; });
    check(fit, '휴대폰 화면 안에 들어옴');
    await k.screenshot({ path: path.join(SHOT, 'e2e78-mobile-pop.png') });
    await k.click('#wmNoticePop [data-nt="pop-later"]');
    check((await api(k, '/api/notices/summary')).r.data.unread >= 1, '나중에 보기 → 안 읽음 그대로');
    await k.click('#hdrNoticeBtn');
    check(await until(k, function () { return !!document.querySelector('#wmNoticeModal .nt-card'); }), '휴대폰에서도 📢 단추로 창 열림');
    var over = await k.evaluate(function () { return document.documentElement.scrollWidth > innerWidth + 1; });
    check(!over, '휴대폰 — 가로로 넘치지 않음');
    await k.screenshot({ path: path.join(SHOT, 'e2e78-mobile-list.png') });

    check(!errs.length, '화면 오류 없음' + (errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''));
  } catch (e) { fail++; console.log('FAIL 예외', e && e.stack || e); }
  if (A) await A.b.close(); if (K) await K.b.close();
  await c.end();
  console.log(fail ? 'FAIL ' + fail + ' / ok ' + ok : 'ALL PASS (' + ok + ')');
  process.exit(fail ? 1 : 0);
})();
