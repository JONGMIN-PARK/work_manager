// 📓 노트북 (v13.316) — 새 노트 · 목록 이어 쓰기 · / 명령 · 체크 · ✍️ 손글씨 · 🖍 마커 · 사진 · 폴더 · 태그 · 찾기
//   · 고친 기록 · 충돌(다른 곳에서 고침) · 📥 낙서장 Alt+N · 일일 노트 · ✨ AI 창 · 휴지통 되돌리기 · 휴대폰 한 칸씩
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var c = new pg.Client(process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var adm = (await c.query("SELECT id, tenant_id FROM users WHERE email = 'admin@t.com'")).rows[0];
  await c.query('DELETE FROM nb_notes WHERE user_id = $1', [adm.id]);
  await c.query('DELETE FROM nb_folders WHERE user_id = $1', [adm.id]);
  await c.query("INSERT INTO my_notes (user_id, note_date, ref, tenant_id, body) VALUES ($1, '2026-10-30', '', $2, '지난 메모 줄') ON CONFLICT (user_id, note_date, ref) DO UPDATE SET body = EXCLUDED.body", [adm.id, adm.tenant_id]);
  async function note() { return (await c.query("SELECT * FROM nb_notes WHERE user_id = $1 AND NOT inbox AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [adm.id])).rows[0]; }

  var ok = 0, fail = 0, errs = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-nb' + Date.now()) });
  var p = (await b.pages())[0] || await b.newPage();
  p.on('pageerror', function (e) { errs.push(e.message); });
  p.on('dialog', function (d) { d.accept(d.type() === 'prompt' ? '고객 전달본' : undefined); });
  function until(fn, arg, ms) { return p.waitForFunction(fn, { timeout: ms || 8000 }, arg).then(function () { return true; }, function () { return false; }); }
  function saved() { return until(function () { var s = document.getElementById('nbState'); return s && /저장됨/.test(s.textContent) && !Object.keys(NB.pend).length && !NB.saving && !NB.timer; }, null, 10000); }
  try {
    await p.setViewport({ width: 1440, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });

    // 1) 들어가기 · 빈 화면 양식
    await p.click('#hdrNbBtn');
    check(await until(function () { return !document.getElementById('mNotebook').classList.contains('hidden') && document.querySelector('#nbSide .nb-nav') && document.querySelector('.nb-blank .nb-tplc'); }), '📓 들어가면 왼쪽 메뉴 · 양식 카드');

    // 2) 새 노트 · 제목 · 목록 이어 쓰기 · 자동 저장
    await p.click('[data-nb="new"]');
    await until(function () { return document.activeElement && document.activeElement.id === 'nbTitle'; });
    await p.keyboard.type('설비 점검 노트');
    await p.keyboard.press('Enter');
    await p.keyboard.type('# 점검 항목'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
    await p.keyboard.type('- [ ] 센서 확인'); await p.keyboard.press('Enter');
    await p.keyboard.type('모터 확인'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
    await p.keyboard.type('**굵게** 끝');
    var src = await p.$eval('#nbSrc', function (e) { return e.value; });
    check(src === '# 점검 항목\n\n- [ ] 센서 확인\n- [ ] 모터 확인\n**굵게** 끝', '목록 이어 쓰기 · 빈 항목 Enter 로 목록 끝 (' + JSON.stringify(src) + ')');
    check(await saved(), '자동 저장 → ✓ 저장됨');
    var n = await note();
    check(n && n.title === '설비 점검 노트' && n.body.indexOf('- [ ] 모터 확인') >= 0 && n.rev >= 2, 'DB 에 제목 · 본문 · rev');
    check(await p.$eval('#nbDoc', function (d) { return d.querySelectorAll('input[data-task]').length === 2 && !!d.querySelector('strong') && !!d.querySelector('h1'); }), '나란히 — 미리보기에 체크 · 굵게 · 제목');

    // 3) / 명령 → 표
    await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
    await p.keyboard.type('/표');
    check(await until(function () { var s = document.getElementById('nbSlash'); return s && /표/.test(s.textContent); }), '/ 명령 메뉴');
    await p.keyboard.press('Enter');
    check(await until(function () { return !!document.querySelector('#nbDoc .nb-tbl table'); }), '/표 → 표가 들어감');

    // 4) 미리보기 체크 누르기 → 원문 줄 바뀜
    await p.click('#nbDoc input[data-task="2"]');
    check((await p.$eval('#nbSrc', function (e) { return e.value; })).indexOf('- [x] 센서 확인') >= 0, '미리보기 체크 → 원문 [x]');

    // 5) 서식 단추 · 단축키
    await p.evaluate(function () { var s = document.getElementById('nbSrc'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); });
    await p.keyboard.press('Enter'); await p.keyboard.type('형광');
    await p.evaluate(function () { var s = document.getElementById('nbSrc'); s.setSelectionRange(s.value.length - 2, s.value.length); });
    await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyH'); await p.keyboard.up('Shift'); await p.keyboard.up('Control');
    check((await p.$eval('#nbSrc', function (e) { return e.value; })).indexOf('==형광==') >= 0, 'Ctrl+Shift+H → ==형광==');

    // 6) ✍️ 손글씨 칸 — 마우스로 그리기 · 도구 · 완료 · 저장
    await p.click('[data-fmt="ink"]');
    check(await until(function () { return !!document.querySelector('#nbDoc .nb-ink.nbk-on') && !!document.getElementById('nbInkBar'); }), '✍️ 손글씨 칸 + 도구 막대');
    await wait(900);   // 칸으로 부드럽게 스크롤하는 동안은 자리가 움직임
    var box = await p.$eval('#nbDoc .nb-ink.nbk-on', function (e) { e.scrollIntoView({ block: 'center' }); var r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await p.mouse.move(box.x + 40, box.y + 50); await p.mouse.down();
    for (var i = 1; i <= 15; i++) await p.mouse.move(box.x + 40 + i * 12, box.y + 50 + Math.sin(i / 2) * 20);
    await p.mouse.up();
    await p.click('#nbInkBar [data-ink-t="t:hl"]');
    box = await p.$eval('#nbDoc .nb-ink.nbk-on', function (e) { var r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await p.mouse.move(box.x + 60, box.y + box.h - 30); await p.mouse.down(); await p.mouse.move(box.x + 260, box.y + box.h - 30, { steps: 8 }); await p.mouse.up();
    check(await p.evaluate(function () { var b = NB.cur.ink.blocks[NB.inkId]; return b.s.length === 2 && b.s[1].t === 'hl'; }), '펜 · 형광펜 획 2개');
    await p.click('#nbInkBar [data-ink-t="undo"]');
    check(await p.evaluate(function () { return NB.cur.ink.blocks[NB.inkId].s.length === 1; }), '↶ 되돌리기');
    await p.click('#nbInkBar [data-ink-t="done"]');
    check(await until(function () { return !document.getElementById('nbInkBar') && document.querySelector('#nbDoc .nb-ink svg path'); }), '✓ 완료 → 그림으로 보임');
    await saved();
    n = await note();
    var ids = Object.keys((n.ink && n.ink.blocks) || {});
    check(ids.length === 1 && n.ink.blocks[ids[0]].s.length === 1 && n.body.indexOf('::ink[' + ids[0] + ']') >= 0, 'DB — 본문에 ::ink 줄 · ink 에 획');

    // 7) 🖍 마커 (보기에서 덮어 그리기)
    await p.click('[data-fmt="over"]');
    check(await until(function () { return document.getElementById('nbOver').classList.contains('editing') && NB.mode === 'view'; }), '🖍 마커 — 보기로 바뀌고 덮개');
    var ob = await p.$eval('#nbOver', function (e) { var r = e.getBoundingClientRect(); return { x: r.left, y: Math.max(r.top, 0) }; });
    await p.mouse.move(ob.x + 30, ob.y + 140); await p.mouse.down(); await p.mouse.move(ob.x + 200, ob.y + 170, { steps: 10 }); await p.mouse.up();
    await p.keyboard.press('Escape');
    await saved();
    n = await note();
    check(n.ink.over && n.ink.over.s.length === 1, 'DB — 마커 획 저장 (ink.over)');
    check(await p.$eval('#nbOver', function (e) { return e.classList.contains('has') && !e.classList.contains('editing') && !!e.querySelector('path'); }), '마커 표시가 노트 위에 남음');

    // 8) 사진 붙이기 (업로드 → nbf: → 미리보기에 사진)
    await p.click('[data-mode="split"]');
    await p.evaluate(function () {
      var cv = document.createElement('canvas'); cv.width = 40; cv.height = 30; var g = cv.getContext('2d'); g.fillStyle = '#f00'; g.fillRect(0, 0, 40, 30);
      return new Promise(function (res) { cv.toBlob(function (bl) { var s = document.getElementById('nbSrc'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); _nbUpload(new File([bl], '빨강.png', { type: 'image/png' })); res(); }); });
    });
    check(await until(function () { return /!\[빨강\.png\]\(nbf:nf-[a-z0-9]+\)/.test(document.getElementById('nbSrc').value); }, null, 10000), '사진 올리기 → ![](nbf:…)');
    check(await until(function () { var i = document.querySelector('#nbDoc img.nb-img'); return i && i.naturalWidth === 40; }, null, 10000), '미리보기에 사진 (인증 받아 blob)');

    // 8-1) v13.417 나란히 스크롤 — 옆에 나란히면 따라가고, 좁아서 위아래로 쌓이면 따로
    async function syncTest() {
      return p.evaluate(function () {
        var s = document.getElementById('nbSrc'), v = document.getElementById('nbPrev');
        s.value = s.value + String.fromCharCode(10) + Array.from({ length: 160 }, function (_, i) { return '줄 ' + i; }).join(String.fromCharCode(10, 10)); s.dispatchEvent(new Event('input', { bubbles: true }));
        return new Promise(function (res) { setTimeout(function () {
          v.scrollTop = 0; s.scrollTop = 0;
          setTimeout(function () { s.scrollTop = 400; s.dispatchEvent(new Event('scroll'));
            setTimeout(function () { var a = s.getBoundingClientRect(), b = v.getBoundingClientRect(); res({ prev: v.scrollTop, side: a.right <= b.left + 1 || b.right <= a.left + 1 }); }, 120); }, 120);
        }, 500); });
      });
    }
    var sw = await syncTest();
    check(!sw.side || sw.prev > 0, '나란히(넓게) — 편집을 굴리면 미리보기도 따라감 (' + JSON.stringify(sw) + ')');
    await p.setViewport({ width: 420, height: 900 }); await wait(500);
    var sn = await syncTest();
    check(sn.side || sn.prev === 0, '좁아서 위아래로 쌓이면 — 따라 움직이지 않음 (' + JSON.stringify(sn) + ')');
    await p.setViewport({ width: 1400, height: 900 }); await wait(400);

    // 9) 태그 · 폴더 (만들어 옮기기)
    await p.click('#nbTagIn'); await p.keyboard.type('설비'); await p.keyboard.press('Enter');
    check(await until(function () { return /#설비/.test(document.getElementById('nbTagRow').textContent); }), '태그 달기');
    await p.click('[data-nb="folder-pick"]');
    await until(function () { return !!document.getElementById('nbMenu'); });
    await p.evaluate(function () { [].slice.call(document.querySelectorAll('#nbMenu .nb-pop-i')).filter(function (x) { return /새 폴더/.test(x.textContent); })[0].click(); });
    await until(function () { return !!document.getElementById('nbFName'); });
    await p.type('#nbFName', '고객 미팅'); await p.keyboard.press('Enter');
    check(await until(function () { return /고객 미팅/.test(document.getElementById('nbSide').textContent) && /고객 미팅/.test(document.querySelector('.nb-crumb').textContent); }), '새 폴더 만들어 옮기기 → 왼쪽 · 머리에 표시');
    await saved();
    n = await note();
    check(n.folder_id && JSON.stringify(n.tags) === '["설비"]', 'DB — 폴더 · 태그');

    // 10) 찾기 — 목록에 찾은 조각
    await p.click('#nbQ'); await p.keyboard.type('모터');
    check(await until(function () { var it = document.querySelectorAll('#nbItems .nb-it'); return it.length === 1 && it[0].querySelector('mark'); }), '찾기 → 찾은 자리 형광');
    await p.evaluate(function () { var q = document.getElementById('nbQ'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); });

    // 11) 고친 기록 창 · 이름 붙여 남기기(prompt)
    await p.click('[data-nb="more"]');
    await p.evaluate(function () { [].slice.call(document.querySelectorAll('#nbMenu .nb-pop-i')).filter(function (x) { return /이름 붙여/.test(x.textContent); })[0].click(); });
    await wait(800);
    await p.click('[data-nb="more"]');
    await p.evaluate(function () { [].slice.call(document.querySelectorAll('#nbMenu .nb-pop-i')).filter(function (x) { return /고친 기록/.test(x.textContent); })[0].click(); });
    check(await until(function () { var m = document.getElementById('nbVerModal'); return m && /고객 전달본/.test(m.textContent) && document.getElementById('nbVerB').textContent.length > 0; }), '🕘 고친 기록 창 · 이름 붙인 기록 · 비교');
    await p.evaluate(function () { var m = document.getElementById('nbVerModal'); if (m) m.remove(); });

    // 12) 충돌 — 다른 곳에서 먼저 고침 → 고르기 막대
    await c.query("UPDATE nb_notes SET body = body || '\n다른 창에서 고침', rev = rev + 1 WHERE id = $1", [n.id]);
    await p.evaluate(function () { var s = document.getElementById('nbSrc'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); });
    await p.keyboard.type(' 내 글');
    check(await until(function () { var b = document.getElementById('nbBars'); return b && /먼저 고쳤습니다/.test(b.textContent); }, null, 10000), '충돌 → "먼저 고쳤습니다" 고르기 막대');
    await p.click('[data-nb="cf-mine"]');
    check(await until(function () { return /저장됨/.test(document.getElementById('nbState').textContent); }), '내 것으로 덮기 → 저장됨');
    n = await note();
    check(n.body.indexOf('내 글') >= 0 && n.body.indexOf('다른 창에서 고침') < 0, 'DB — 내 것으로 덮임');

    // 13) ✨ AI 창 (키 없는 환경 — 창 · 옵션 · 오류 안내)
    await p.click('[data-nb="ai"]');
    check(await until(function () { return !!document.getElementById('nbAiTo') && /메일 초안/.test(document.getElementById('nbAiModal').textContent); }), '✨ AI 창 — 메일 초안 옵션');
    await p.click('#nbAiModal [data-k="translate"]');
    check(await until(function () { return !!document.getElementById('nbAiLang'); }), '번역으로 바꾸면 언어 고르기');
    await p.click('#nbAiModal [data-x="run"]');
    check(await until(function () { return /❌|✓/.test(document.getElementById('nbAiSt').textContent); }, null, 20000), 'AI 만들기 → 결과 또는 안내 (' + await p.$eval('#nbAiSt', function (e) { return e.textContent; }) + ')');
    await p.evaluate(function () { var m = document.getElementById('nbAiModal'); if (m) m.remove(); });
    await p.screenshot({ path: path.join(SHOT, 'e2e59-notebook.png') });

    // 14) 📥 낙서장 — 다른 화면에서 Alt+N
    await p.evaluate(function () { setPage('mywork'); });
    await wait(400);
    await p.keyboard.down('Alt'); await p.keyboard.press('KeyN'); await p.keyboard.up('Alt');
    check(await until(function () { return !!document.querySelector('#nbQuick textarea') && document.activeElement === document.querySelector('#nbQuick textarea'); }), 'Alt+N → 낙서장 창 (내 업무 화면에서)');
    await p.keyboard.type('출하 전 포장 확인');
    await p.keyboard.down('Control'); await p.keyboard.press('Enter'); await p.keyboard.up('Control');
    check(await until(function () { return !document.getElementById('nbQuick'); }), 'Ctrl+Enter 저장 → 창 닫힘');
    await wait(300);
    var inbox = (await c.query('SELECT * FROM nb_notes WHERE user_id = $1 AND inbox', [adm.id])).rows;
    check(inbox.length === 1 && inbox[0].body === '출하 전 포장 확인' && inbox[0].source === 'quick', 'DB — 낙서장(inbox · quick)');

    // 15) 일일 노트 · 낙서장 목록
    await p.click('#hdrNbBtn');
    await p.click('#nbSide [data-view="inbox"]');
    check(await until(function () { return /출하 전 포장/.test(document.getElementById('nbItems').textContent); }), '📥 낙서장 목록');
    await p.click('#nbSide [data-view="daily"]');
    check(await until(function () { return !!document.querySelector('#nbItems [data-daily="2026-10-30"]'); }), '📅 일일 노트 목록');
    await p.click('#nbItems [data-daily="2026-10-30"]');
    check(await until(function () { return document.getElementById('nbSrc') && document.getElementById('nbSrc').value === '지난 메모 줄' && document.getElementById('nbTitle').readOnly; }), '일일 노트 열기 (같은 편집기)');
    await p.evaluate(function () { var s = document.getElementById('nbSrc'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); });
    await p.keyboard.type(' 보탬');
    await saved();
    check((await c.query("SELECT body FROM my_notes WHERE user_id = $1 AND note_date = '2026-10-30' AND ref = ''", [adm.id])).rows[0].body === '지난 메모 줄 보탬', 'DB — 일일 노트는 my_notes 로 저장');

    // 16) 휴지통 → 되돌리기 알림
    await p.click('#nbSide [data-view="all"]');
    await until(function () { return document.querySelectorAll('#nbItems .nb-it[data-id]').length === 1; });
    await p.click('#nbItems .nb-it[data-id]');
    await until(function () { return NB.cur && document.getElementById('nbSrc'); });
    await p.click('[data-nb="more"]');
    await p.evaluate(function () { [].slice.call(document.querySelectorAll('#nbMenu .nb-pop-i')).filter(function (x) { return /휴지통으로/.test(x.textContent); })[0].click(); });
    check(await until(function () { return !!document.querySelector('.nb-undo') && !document.querySelector('#nbItems .nb-it[data-id]'); }), '🗑 휴지통 → 목록에서 빠지고 되돌리기 알림');
    await p.click('.nb-undo button');
    check(await until(function () { return document.querySelectorAll('#nbItems .nb-it[data-id]').length === 1; }), '되돌리기 → 다시 목록에');

    // 17) 휴대폰 — 한 칸씩
    await p.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
    await wait(800);
    await p.evaluate(function () { _nbSetPane('list'); });
    check(await p.evaluate(function () { var l = document.getElementById('nbList'), m = document.getElementById('nbMain'); return getComputedStyle(l).display !== 'none' && getComputedStyle(m).display === 'none'; }), '휴대폰 — 목록만');
    await p.click('#nbItems .nb-it[data-id]');
    check(await until(function () { var l = document.getElementById('nbList'), m = document.getElementById('nbMain'); return getComputedStyle(l).display === 'none' && getComputedStyle(m).display !== 'none' && document.documentElement.scrollWidth <= 391; }), '휴대폰 — 노트 누르면 편집기만 · 가로 넘침 없음');
    await p.screenshot({ path: path.join(SHOT, 'e2e59-notebook-m.png') });
    await p.click('#nbMain [data-nb="to-list"]');
    check(await until(function () { return getComputedStyle(document.getElementById('nbList')).display !== 'none'; }), '휴대폰 — ‹ 로 목록');
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  check(!errs.length, '페이지 오류 없음' + (errs.length ? ' — ' + errs.join(' | ') : ''));
  await b.close();
  await c.end();
  console.log('\n' + ok + ' 통과 · ' + fail + ' 실패' + (fail ? '' : ' — ALL PASS'));
  process.exit(fail ? 1 : 0);
})();
