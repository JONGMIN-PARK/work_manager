// 📦 배포판 소개 페이지용 데모 화면 (release/site/*.jpg) — 시험 DB 에 가상의 사람 · 회사 · 일로 채워서 (실제 이름 · 고객사 없음)
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var OUT = path.join(__dirname, '../../release/site');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client('postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email='admin@t.com'")).rows[0], T = adm.tenant_id;
  var kim = (await c.query("SELECT id FROM users WHERE email='kim@t.com'")).rows[0];
  async function rename(id, n) { try { await c.query('UPDATE users SET name=$2, display_name=$2 WHERE id=$1', [id, n]); } catch (e) { await c.query('UPDATE users SET name=$2 WHERE id=$1', [id, n]); } }
  await rename(adm.id, '김하늘'); await rename(kim.id, '이도윤');
  var WHO = ['김하늘', '이도윤', '박서준', '최유나', '정민재', '한소율'];
  var JOB = [['가람테크', '정렬 모듈', '설계', '정렬 알고리즘 개선'], ['나래전자', '검사기 UI', '개발', '검사 화면 개편'], ['다온정밀', '통신 점검', 'C/S', '현장 통신 점검'], ['라온시스템', '비전 검사기', '설계', '광학계 사양 검토'], ['마루로봇', '이송 장치', '개발', '이송 제어 프로그램'], ['사내', '품질 개선', '관리', '불량 원인 분석 회의']];
  var days = ['20261102', '20261103', '20261104', '20261105', '20261106', '20261109', '20261110', '20261111', '20261112', '20261113'];
  for (var d of days) for (var w = 0; w < WHO.length; w++) {
    var k = 2 + ((w + d.charCodeAt(7)) % 2);
    for (var j = 0; j < k; j++) {
      var J = JOB[(w * 3 + j + d.charCodeAt(7)) % JOB.length];
      await c.query('INSERT INTO work_records (date,name,order_no,hours,abbr,task_type,content,oclient,user_id,tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [d, WHO[w], 'D-' + J[1], [2, 3, 4, 1.5, 2.5][(w + j) % 5], J[0].slice(0, 2), J[2], J[3], J[0], adm.id, T]);
    }
  }
  var P = [['가람테크 정렬 장비', 'active', 62, '2026-09-01', '2026-12-20'], ['나래전자 검사기 2차', 'active', 38, '2026-10-01', '2027-01-31'], ['다온정밀 라인 증설', 'active', 81, '2026-07-15', '2026-11-30'], ['라온시스템 비전 모듈', 'planning', 12, '2026-11-10', '2027-03-31'], ['마루로봇 이송 장치', 'active', 47, '2026-08-20', '2026-12-31']];
  for (var i = 0; i < P.length; i++) {
    await c.query("INSERT INTO projects (id, name, status, progress, owner_id, visibility, tenant_id, start_date, end_date) VALUES ($1,$2,$3,$4,$5,'tenant',$6,$7,$8) ON CONFLICT DO NOTHING", ['demo-p' + i, P[i][0], P[i][1], P[i][2], adm.id, T, P[i][3], P[i][4]]).catch(function (e) { console.log('proj', e.message); });
  }
  await c.end();

  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  async function login(p) {
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await wait(1500);
    var logged = await p.evaluate(function () { return !!(typeof currentUser !== 'undefined' && currentUser && currentUser.id); });
    if (!logged) { await p.waitForSelector('#loginEmail', { visible: true }); await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!'); await p.keyboard.press('Enter'); }
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await p.evaluate(function () { try { aTh('pearl'); } catch (e) {} });
  }
  var shot = function (p, n) { return p.screenshot({ path: path.join(OUT, n + '.jpg'), type: 'jpeg', quality: 82 }); };
  try {
    var page = (await browser.pages())[0];
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' }); await page.waitForSelector('#loginEmail', { visible: true }); await wait(1200);
    await shot(page, 'login');
    await login(page);
    var room = await page.evaluate(async function (kid) {
      var t = [['고객사 정렬 장비 사양 검토', 1, 3], ['주간 업무 보고 작성', 0, 1], ['비전 모듈 시험 결과 정리', 2, 2], ['신규 프로젝트 착수 회의 준비', 3, 0], ['납품 일정 확인 전화', 0, 3], ['통신 점검 보고서 마무리', -1, 2]];
      for (var i = 0; i < t.length; i++) await apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: t[i][0], dueDate: new Date(Date.now() + t[i][1] * 86400000).toISOString().slice(0, 10), priority: t[i][2] }) }).catch(function () {});
      var r = await apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'group', name: '장비개발팀', userIds: [kid] }) });
      var id = r.data.id;
      var m = ['오늘 오후 3시에 정렬 장비 사양 검토 회의 있습니다 📅', '자료는 공유 폴더에 올려 두었어요', '시험 결과도 같이 정리해서 가겠습니다 👍'];
      for (var j = 0; j < m.length; j++) await apiFetch('/api/chat/rooms/' + id + '/messages', { method: 'POST', body: JSON.stringify({ body: m[j] }) });
      return id;
    }, kim.id);
    await page.reload({ waitUntil: 'networkidle2' }); await login(page);
    var shots = [['mywork', 'pc-mywork'], ['project', 'pc-project']];
    for (var i = 0; i < shots.length; i++) { await page.evaluate(function (p) { setPage(p); }, shots[i][0]); await wait(2500); await shot(page, shots[i][1]); }
    await page.evaluate(function () { setPage('team'); }); await wait(2500);
    await page.evaluate(function () { try { if (typeof selAll === 'function') selAll(); } catch (e) {} }); await wait(1500);
    await shot(page, 'pc-team');
    await page.evaluate(function (id) { setPage('messages'); setTimeout(function () { if (typeof chatOpenRoom === 'function') chatOpenRoom(id); }, 600); }, room); await wait(3000);
    await shot(page, 'pc-chat');
    // v13.503 랜딩 페이지 — 주요 기능 화면 더
    var ids = await page.evaluate(async function () {
      var N = function (t, c) { return { id: 'n' + Math.random().toString(36).slice(2, 9), text: t, children: (c || []) }; };
      var doc = { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: { id: 'n-root', text: '정렬 장비 2차 개발', children: [
        N('요구 사항', [N('정렬 정밀도 ±2µm'), N('택트 타임 12초'), N('고객 사양서 검토')]),
        N('설계', [N('스테이지 구조'), N('카메라 · 조명'), N('제어 보드')]),
        N('일정', [N('11월 설계 검토'), N('12월 시제품'), N('1월 납품')]),
        N('위험', [N('부품 납기 지연'), N('현장 진동')]),
        N('담당', [N('김하늘 — 총괄'), N('이도윤 — 비전'), N('박서준 — 기구')])
      ] } }] };
      var m = await apiFetch('/api/mindmaps', { method: 'POST', body: JSON.stringify({ title: '정렬 장비 2차 개발', doc: doc }) });
      var n = await apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: '11월 3주 정렬 장비 검토 회의', body: '## 회의 요약\n참석: 김하늘, 이도윤, 박서준\n\n### 결정 사항\n- 스테이지 구조는 **2안**으로 확정\n- 카메라는 5MP 모델로 시험 후 결정\n- 12월 2주 시제품 조립 시작\n\n### 할 일\n- [ ] 이도윤 — 비전 시험 결과 정리 (11/20)\n- [ ] 박서준 — 기구 도면 수정 (11/22)\n- [x] 김하늘 — 고객사 일정 공유' }) }).catch(function () { return {}; });
      // 상세 창이 비어 보이지 않게 — 마일스톤 · 체크리스트
      try {
        var ms = [['요구 사항 확정', '2026-09-01', '2026-09-20', 'done'], ['설계 · 도면 검토', '2026-09-21', '2026-10-25', 'done'], ['제작 · 조립', '2026-10-26', '2026-11-30', 'inProgress'], ['검수 · 납품', '2026-12-01', '2026-12-20', 'pending']];
        for (var k = 0; k < ms.length; k++) await createMilestone({ projectId: 'demo-p0', name: ms[k][0], startDate: ms[k][1], endDate: ms[k][2], status: ms[k][3], order: k });
        if (typeof pdGenerateChecklists === 'function') await pdGenerateChecklists('demo-p0');
      } catch (e) {}
      return { mm: m && m.data && m.data.id, nb: n && n.data && n.data.id };
    });
    var more = [
      ['pc-mindmap', function (x) { setPage('mindmap'); setTimeout(function () { if (x.mm) mmOpen(x.mm); }, 500); }],
      ['pc-notebook', function (x) { setPage('notebook'); setTimeout(function () { if (x.nb && typeof nbOpenNote === 'function') nbOpenNote(x.nb); }, 800); }],
      ['pc-weekly', function () { setPage('team'); setMode('weekly_report'); }],
      ['pc-workload', function () { setPage('team'); setMode('workload'); }],
      ['pc-timeline', function () { setPage('project'); setMode('timeline'); }],
      ['pc-detail', function () { setPage('project'); setMode('pipeline'); setTimeout(function () { showProjectDetail('demo-p0'); }, 600); }],
      ['pc-calendar', function () { setPage('mywork'); setTimeout(function () { var b = document.querySelector('#mMyWork [data-mwc-view="month"]'); if (b) b.click(); }, 600); }]
    ];
    for (var q = 0; q < more.length; q++) {
      await page.evaluate(function () { try { if (typeof pdCloseDetail === 'function') pdCloseDetail(); } catch (e) {} });
      await page.evaluate(more[q][1], ids); await wait(3200);
      await shot(page, more[q][0]);
    }
    await page.evaluate(function () { try { if (typeof pdCloseDetail === 'function') pdCloseDetail(); } catch (e) {} setPage('mywork'); try { var b = document.querySelector('#mMyWork [data-mwc-view="list"]'); if (b) b.click(); } catch (e) {} }); await wait(800);
    var m = await browser.newPage();
    await m.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1');
    await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await login(m);
    await m.evaluate(function () { setPage('mywork'); }); await wait(2500);
    await shot(m, 'm-mywork');
    await m.evaluate(function () { wmIsland.open(); }); await wait(700);
    await shot(m, 'm-island');
    await m.evaluate(function (id) { wmIsland.close(); setPage('messages'); setTimeout(function () { if (typeof chatOpenRoom === 'function') chatOpenRoom(id); }, 600); }, room); await wait(3000);
    await shot(m, 'm-chat');
    await m.evaluate(function () { if (typeof chatCloseRoom === 'function') try { chatCloseRoom(); } catch (e) {} setPage('project'); setMode('pipeline'); }); await wait(2500);
    await shot(m, 'm-project');
    await m.evaluate(function () { setPage('team'); setMode('weekly'); try { selAll(); } catch (e) {} }); await wait(2500);
    await shot(m, 'm-team');
    console.log('done');
  } catch (e) { console.log('FAIL', e && e.stack || e); }
  await browser.close();
})();
