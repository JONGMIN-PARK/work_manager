// 간트 보기 · 버전 기록 E2E — 실행: node e2e8.js
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var n = 0;
function check(name, c, x) { if (!c) { console.log('FAIL', name, JSON.stringify(x, null, 1).slice(0, 1200)); throw new Error('FAIL ' + name); } n++; console.log('✔', name); }
function dayStr(off) { var d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  var errs = [];
  page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', function (d) { d.accept(); });
  try {
    await page.setViewport({ width: 1500, height: 900 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com');
    await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id; });
    await wait(500);
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmNewTpl');
    await page.select('#mmNewTpl', 'wbs');
    await page.type('#mmNewTitle', '검사기 2호기 일정');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    var D = { a: dayStr(-12), b: dayStr(-4), c: dayStr(-2), d: dayStr(5), e: dayStr(9), f: dayStr(16), g: dayStr(3), h: dayStr(24) };
    await page.evaluate(function (D) {
      _mmMutate(function () {
        var r = _mmRoot();
        var k = r.children;
        k[0].children[0].startDate = D.a; k[0].children[0].dueDate = D.b; k[0].children[0].done = true;          // 완료
        k[0].children[1].startDate = D.a; k[0].children[1].dueDate = D.c; k[0].children[1].progress = 60;       // 지연
        k[0].children[2].dueDate = D.g;                                                                           // 마일스톤
        k[1].children[0].startDate = D.c; k[1].children[0].dueDate = D.e; k[1].children[0].progress = 30;       // 진행 중
        k[1].children[1].startDate = D.d; k[1].children[1].dueDate = D.f;
        k[2].startDate = D.f; k[2].dueDate = D.h;                                                                 // 자기 일정 있는 부모
        k[1].children[0].assigneeId = currentUser.id;
        _mmSheet().relations = [{ id: 'rl-1', from: k[0].children[1].id, to: k[1].children[0].id }, { id: 'rl-2', from: k[1].children[0].id, to: k[2].id }];
      });
    }, D);
    await wait(300);

    // ── 간트 열기
    await page.click('#mmVGantt');
    await page.waitForSelector('#mmGantt:not(.hidden) .mm-gt-row');
    var g = await page.evaluate(function () {
      var G = document.getElementById('mmGantt');
      var vis = 0; mmWalk(_mmRoot(), function (n) { vis++; if (n.collapsed) return false; });
      return {
        rows: G.querySelectorAll('.mm-gt-row').length, vis: vis,
        tasks: G.querySelectorAll('.mm-gt-task').length, miles: G.querySelectorAll('.mm-gt-mile').length, sums: G.querySelectorAll('.mm-gt-sum').length,
        late: G.querySelectorAll('.mm-gt-row.mm-gt-late').length, deps: G.querySelectorAll('.mm-gt-dep').length, bad: G.querySelectorAll('.mm-gt-dep-bad').length,
        today: !!G.querySelector('.mm-gt-today'), canvasHidden: document.getElementById('mmCanvas').classList.contains('hidden'),
        chips: Array.prototype.map.call(G.querySelectorAll('.mm-gt-chip'), function (c) { return c.getAttribute('data-gt-filter') + ':' + c.querySelector('b').textContent; }),
        av: G.querySelectorAll('.mm-gt-av').length, ring: G.querySelector('.mm-gt-ring span').textContent
      };
    });
    check('간트 — 보이는 주제 수만큼 행', g.rows === g.vis && g.canvasHidden, g);
    check('간트 — 막대 5 · 마일스톤 1 · 요약 막대(일정 없는 부모)', g.tasks === 5 && g.miles === 1 && g.sums >= 2, g);
    check('간트 — 지연 표시 · 오늘 선', g.late === 1 && g.today, g);
    check('간트 — 선후 화살표 2 (어긋난 것 1)', g.deps === 2 && g.bad === 1, g);
    check('간트 — 요약 칩', g.chips.indexOf('late:1') >= 0 && g.chips.indexOf('done:1') >= 0 && g.chips.indexOf('run:1') >= 0, g);
    check('간트 — 담당 표시 · 완료율', g.av === 1 && g.ring === '17%', g);
    await page.screenshot({ path: path.join(SHOT, 'gantt-day.png') });

    // ── 막대 끌어 옮기기 (+3일)
    var id1 = await page.evaluate(function () { return _mmRoot().children[1].children[1].id; });
    var bar = await page.$('.mm-gt-row[data-gt-row="' + id1 + '"] .mm-gt-task');
    var bb = await bar.boundingBox();
    var dw = 34;
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + dw * 1.5, bb.y + bb.height / 2, { steps: 4 });
    var tip = await page.evaluate(function () { var t = document.querySelector('.mm-gt-tip'); return t ? t.textContent : ''; });
    await page.mouse.move(bb.x + bb.width / 2 + dw * 3, bb.y + bb.height / 2, { steps: 4 });
    await page.mouse.up();
    await wait(150);
    var n1 = await page.evaluate(function (id) { var f = mmFind(_mmRoot(), id); return [f.node.startDate, f.node.dueDate]; }, id1);
    check('끌어 옮기기 +3일 (끄는 동안 날짜 표시)', n1[0] === dayStr(8) && n1[1] === dayStr(19) && /→/.test(tip), { n1: n1, tip: tip });
    // ── 오른쪽 끝 끌어 늘리기 (+2일)
    bar = await page.$('.mm-gt-row[data-gt-row="' + id1 + '"] .mm-gt-task');
    bb = await bar.boundingBox();
    await page.evaluate(function (x) { var sc = document.getElementById('mmGtScroll'), r = sc.getBoundingClientRect(); sc.scrollLeft += x - (r.left + r.width / 2); }, bb.x + bb.width);
    await wait(100);
    bb = await (await page.$('.mm-gt-row[data-gt-row="' + id1 + '"] .mm-gt-task')).boundingBox();
    await page.mouse.move(bb.x + bb.width - 3, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width - 3 + dw * 2, bb.y + bb.height / 2, { steps: 4 });
    await page.mouse.up();
    await wait(150);
    n1 = await page.evaluate(function (id) { var f = mmFind(_mmRoot(), id); return [f.node.startDate, f.node.dueDate]; }, id1);
    check('끝 끌어 늘리기 +2일', n1[0] === dayStr(8) && n1[1] === dayStr(21), n1);
    // ── Alt+→ 하루 옮기기 · Ctrl+Z
    await page.keyboard.down('Alt'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Alt');
    await wait(100);
    n1 = await page.evaluate(function (id) { var f = mmFind(_mmRoot(), id); return [f.node.startDate, f.node.dueDate]; }, id1);
    check('Alt+→ 하루 옮기기', n1[0] === dayStr(9) && n1[1] === dayStr(22), n1);
    await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
    await wait(100);
    n1 = await page.evaluate(function (id) { var f = mmFind(_mmRoot(), id); return [f.node.startDate, f.node.dueDate]; }, id1);
    check('Ctrl+Z 되돌리기', n1[0] === dayStr(8) && n1[1] === dayStr(21), n1);
    // ── 빈 줄 끌어 새 일정
    var id2 = await page.evaluate(function () { return _mmRoot().children[3].children[0].id; });
    await page.click('[data-gt-today]');
    await page.evaluate(function (id) { var sc = document.getElementById('mmGtScroll'), row = sc.querySelector('[data-gt-row="' + id + '"]'); sc.scrollTop = row.offsetTop - 120; }, id2);
    await wait(100);
    var tr = await page.$('.mm-gt-row[data-gt-row="' + id2 + '"] .mm-gt-track');
    var tb = await tr.boundingBox();
    var todayBox = await (await page.$('.mm-gt-today')).boundingBox();
    var sx = todayBox.x + dw * 2;
    await page.mouse.move(sx, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sx + dw * 4, tb.y + tb.height / 2, { steps: 5 });
    await page.mouse.up();
    await wait(150);
    var n2 = await page.evaluate(function (id) { var f = mmFind(_mmRoot(), id); return [f.node.startDate, f.node.dueDate]; }, id2);
    check('빈 줄 끌어 새 일정 (5일)', n2[0] === dayStr(2) && n2[1] === dayStr(6), n2);
    // ── 거르기 · 접기 · 눈금
    await page.click('[data-gt-filter="late"]');
    await wait(100);
    var fl = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('.mm-gt-row .mm-gt-txt'), function (x) { return x.textContent; }); });
    check('지연만 거르기 (위 단계 포함)', fl.length === 3 && fl[2] === '사양 확정', fl);
    await page.click('[data-gt-filter="late"]');
    var p0 = await page.evaluate(function () { return _mmRoot().children[0].id; });
    await page.click('[data-gt-tog="' + p0 + '"]');
    await wait(100);
    var fold = await page.evaluate(function (id) { return [mmFind(_mmRoot(), id).node.collapsed, document.querySelectorAll('.mm-gt-row').length]; }, p0);
    check('간트에서 접기 (맵과 같이)', fold[0] === true && fold[1] === g.rows + 0 - 3, { fold: fold, rows: g.rows });
    await page.click('[data-gt-tog="' + p0 + '"]');
    await page.click('[data-gt-scale="week"]');
    await wait(150);
    await page.screenshot({ path: path.join(SHOT, 'gantt-week.png') });
    await page.click('[data-gt-scale="month"]');
    await wait(150);
    check('월 눈금', await page.evaluate(function () { return document.getElementById('mmGantt').getAttribute('data-scale') === 'month' && document.querySelectorAll('.mm-gt-h2').length > 0; }));
    await page.click('[data-gt-scale="day"]');
    await wait(150);
    // 행 선택 → 속성 패널
    var id3 = await page.evaluate(function () { return _mmRoot().children[1].children[0].id; });
    await page.click('.mm-gt-row[data-gt-row="' + id3 + '"] .mm-gt-txt');
    await wait(150);
    check('행 누르면 속성 패널', await page.evaluate(function (id) { return _mm.sel === id && document.getElementById('mmPnText').value === '기구'; }, id3));
    await page.screenshot({ path: path.join(SHOT, 'gantt-sel.png') });
    // 테마
    await page.evaluate(function () { document.documentElement.setAttribute('data-theme', 'light'); });
    await wait(150);
    await page.screenshot({ path: path.join(SHOT, 'gantt-light.png') });
    await page.evaluate(function () { document.documentElement.removeAttribute('data-theme'); });
    // Alt+J → 맵으로
    await page.focus('#mmGtScroll');
    await page.evaluate(function () { mmRunCommand('gantt'); });
    await wait(200);
    check('간트 → 맵 전환', await page.evaluate(function () { return !_mm.gantt && !document.getElementById('mmCanvas').classList.contains('hidden') && document.getElementById('mmGantt').classList.contains('hidden'); }));

    // ── 버전 기록
    await page.evaluate(function () { return _mmSaveNow(); });
    await wait(300);
    await page.click('#mmEd [data-act="history"]');
    await page.waitForSelector('#mmHist:not(.hidden) .mm-hist-cur');
    await wait(300);
    await page.type('#mmHistLabel', '1차 일정안');
    await page.click('[data-act="history-save"]');
    await page.waitForFunction(function () { return document.querySelectorAll('.mm-hist-item[data-snap]').length === 1; }, { timeout: 5000 });
    check('지금 버전 저장 → 기록 1', await page.evaluate(function () { return document.querySelector('.mm-hist-item[data-snap] .mm-hist-t').textContent === '1차 일정안'; }));
    // 맵 바꾸기: 하나 지우고 · 하나 이름 바꾸고 · 하나 옮기고 · 새로 추가
    var ch = await page.evaluate(function () {
      var r = _mmRoot();
      var gone = r.children[4].children[2], ren = r.children[0], mv = r.children[3].children[1];
      _mmMutate(function () {
        r.children[4].children.splice(2, 1);
        ren.text = '기획 · 사양 (변경)';
        r.children[3].children.splice(1, 1); r.children[2].children.push(mv);
        r.children[1].children.push(mmNewNode('새 작업'));
      });
      return { gone: gone.id, ren: ren.id, mv: mv.id };
    });
    await page.evaluate(function () { return _mmSaveNow(); });
    await wait(200);
    var liveCount = await page.evaluate(function () { var c = 0; mmWalk(_mmRoot(), function () { c++; }); return c; });
    await page.click('.mm-hist-item[data-snap]');
    await page.waitForSelector('.mm-banner-hist');
    await wait(300);
    var pv = await page.evaluate(function (ch) {
      var st = document.getElementById('mmStage');
      return {
        ro: _mm.readOnly, del: !!st.querySelector('.mm-node.mm-df-del[data-id="' + ch.gone + '"]'), chg: !!st.querySelector('.mm-node.mm-df-chg[data-id="' + ch.ren + '"]'),
        mov: !!st.querySelector('.mm-node.mm-df-mov[data-id="' + ch.mv + '"]'), chips: document.querySelector('.mm-banner-hist .mm-bh-chips').textContent,
        rootText: _mmRoot().children[0].text, status: document.getElementById('mmStatus').textContent,
        adds: (document.querySelector('.mm-hist-adds') || {}).textContent || ''
      };
    }, ch);
    check('미리 보기 — 보기 전용 · 옛 내용', pv.ro && pv.rootText === '기획 · 사양' && /미리 보기/.test(pv.status), pv);
    check('미리 보기 — 삭제됨 · 바뀜 · 옮김 표시', pv.del && pv.chg && pv.mov, pv);
    check('미리 보기 — 비교 요약 (추가 1 · 삭제 1 · 수정 1 · 이동 1)', /추가 1/.test(pv.chips) && /삭제 1/.test(pv.chips) && /수정 1/.test(pv.chips) && /이동 1/.test(pv.chips) && /새 작업/.test(pv.adds), pv);
    await page.screenshot({ path: path.join(SHOT, 'hist-preview.png') });
    // 미리 보기 중 타이핑해도 안 바뀜
    await page.keyboard.type('x');
    await wait(100);
    check('미리 보기 중 편집 막힘', await page.evaluate(function () { return !_mm.editing && !_mm.dirty; }));
    // 지금 버전으로 돌아가기
    await page.click('.mm-banner-hist [data-act="history-current"]');
    await wait(200);
    var back = await page.evaluate(function () { var c = 0; mmWalk(_mmRoot(), function () { c++; }); return { c: c, ro: _mm.readOnly, t: _mmRoot().children[0].text, banner: !!document.querySelector('.mm-banner-hist') }; });
    check('지금 버전으로 돌아가기', back.c === liveCount && !back.ro && back.t === '기획 · 사양 (변경)' && !back.banner, back);
    // 다시 열어 되돌리기
    await page.click('.mm-hist-item[data-snap]');
    await page.waitForSelector('.mm-banner-hist [data-act="history-restore"]');
    await page.click('.mm-banner-hist [data-act="history-restore"]');
    await page.waitForFunction(function () { return !_mm.preview && _mmRoot().children[0].text === '기획 · 사양'; }, { timeout: 5000 });
    await wait(500);
    var rs = await page.evaluate(function () {
      return { ro: _mm.readOnly, kinds: Array.prototype.map.call(document.querySelectorAll('.mm-hist-item[data-snap]'), function (x) { return x.className; }), ver: _mm.version };
    });
    check('되돌리기 → 옛 내용 · 편집 가능 · 백업 기록', !rs.ro && rs.kinds.length === 2 && /mm-hk-restore/.test(rs.kinds[0]), rs);
    var srv = await page.evaluate(function () { return apiFetch('/api/mindmaps/' + _mm.mapId).then(function (r) { return { v: r.data.version, t: r.data.doc.sheets[0].root.children[0].text }; }); });
    check('서버 문서도 되돌려짐', srv.t === '기획 · 사양' && srv.v === rs.ver, srv);
    // Ctrl+Z → 되돌리기 취소
    await page.evaluate(function () { _mmFocusCanvas(); });
    await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
    await wait(200);
    check('Ctrl+Z 로 되돌리기 취소', await page.evaluate(function () { return _mmRoot().children[0].text === '기획 · 사양 (변경)'; }));
    // 이름 바꾸기 (자동 기록 아님 — 직접 저장한 것)
    await page.evaluate(function () { return _mmSaveNow(); });
    var sid = await page.evaluate(function () { return document.querySelectorAll('.mm-hist-item[data-snap]')[1].getAttribute('data-snap'); });
    await page.click('[data-act="history-rename"][data-snap="' + sid + '"]');
    await page.waitForSelector('.mm-hist-rename');
    await page.evaluate(function () { document.querySelector('.mm-hist-rename').value = ''; });
    await page.type('.mm-hist-rename', '고객 검토본');
    await page.keyboard.press('Enter');
    await wait(400);
    check('이름 바꾸기', await page.evaluate(function (sid) { return document.querySelector('.mm-hist-item[data-snap="' + sid + '"] .mm-hist-t').textContent === '고객 검토본'; }, sid));
    await page.screenshot({ path: path.join(SHOT, 'hist-list.png') });
    // 간트도 미리 보기 반영 · 닫기
    await page.click('.mm-hist-item[data-snap="' + sid + '"]');
    await page.waitForSelector('.mm-banner-hist');
    await page.click('#mmVGantt');
    await wait(200);
    check('미리 보기 중 간트 — 옛 일정 · 끌기 불가', await page.evaluate(function () { return _mm.gantt && _mm.readOnly && !document.querySelector('.mm-gt-hd'); }));
    await page.click('[data-act="history-close"]');
    await wait(200);
    check('기록 닫으면 미리 보기도 끝', await page.evaluate(function () { return !_mm.preview && !_mm.readOnly && document.getElementById('mmHist').classList.contains('hidden'); }));
    await page.click('#mmVMap');
    check('페이지 오류 없음', errs.length === 0, errs);
    console.log('\nALL PASS ' + n);
  } catch (e) { console.log(e.message); console.log('errs', errs); } finally { await browser.close(); }
})();
