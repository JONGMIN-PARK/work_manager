// 📓 노트 쓰기 속도 (v13.527) — 미리보기 바꿔 끼우기가 통째로 그린 것과 같은지 · 줄이 밀린 뒤 체크 칸 · 보기 모드 도구 막대(:has 대신 클래스)
//   · 쓰는 동안 반응(느리게 하지 않은 PC 기준 넉넉한 상한)
var path = require('path'), os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0];
  var errs = []; page.on('pageerror', function (e) { errs.push(e.message); });
  var ok = 0, fail = 0;
  function check(c, m) { if (c) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var id = null;
  try {
    await page.setViewport({ width: 1600, height: 950 });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com'); await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    await wait(800);
    var body = '';
    for (var i = 0; i < 25; i++) body += '## ' + (i + 1) + '. 안건\n\n- [ ] 할 일 ' + i + '\n- [x] 끝난 일 ' + i + '\n\n문단 ' + i + ' 입니다.\n\n| 가 | 나 |\n|---|---|\n| ' + i + ' | 값 |\n\n';
    id = await page.evaluate(function (body) { return apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: '바꿔 끼우기 시험', body: body }) }).then(function (r) { return r.data.id; }); }, body);
    await page.evaluate(function () { setPage('notebook'); });
    await wait(1200);
    await page.evaluate(function (id) { nbOpenNote(id); }, id);
    await page.waitForSelector('#nbSrc', { timeout: 15000 });
    await wait(800);
    await page.evaluate(function () { _nbSetMode('split'); });
    await wait(600);

    // 지금 미리보기 == 통째로 그린 것 (줄 번호 · 체크 칸 번호 · 글)
    var same = function () {
      return page.evaluate(function () {
        var doc = document.getElementById('nbDoc'), t = document.createElement('template');
        t.innerHTML = NbMd.render(document.getElementById('nbSrc').value).html;
        var sig = function (root) {
          var c = root.cloneNode(true);
          c.querySelectorAll('.nb-task-acts,.nb-ink-go').forEach(function (x) { x.remove(); });
          var attrs = [].map.call(c.querySelectorAll('[data-line],[data-task]'), function (x) { return x.tagName + ':' + (x.getAttribute('data-line') || '') + ':' + (x.getAttribute('data-task') || ''); }).join(',');
          return { attrs: attrs, text: c.textContent.replace(/\s+/g, ' ').trim(), n: c.children.length };
        };
        var a = sig(doc), b = sig(t.content);
        return { ok: a.attrs === b.attrs && a.text === b.text && a.n === b.n, a: a.attrs.slice(0, 80), b: b.attrs.slice(0, 80), an: a.n, bn: b.n };
      });
    };
    var typeAt = async function (pos, txt) {
      await page.evaluate(function (pos) { var s = document.getElementById('nbSrc'); s.focus(); var p = pos < 0 ? s.value.length + pos : pos; s.setSelectionRange(p, p); }, pos);
      await page.keyboard.type(txt, { delay: 15 });
      await wait(700);
    };
    var r0 = await same();
    check(r0.ok, '처음 — 통째로 그린 것과 같음 ' + r0.an);

    // 뒤쪽 문단에 치기 → 앞 블록은 그대로(같은 요소)
    await page.evaluate(function () { window.__h1 = document.querySelector('#nbDoc h2'); window.__lastTbl = [].slice.call(document.querySelectorAll('#nbDoc .nb-tbl')).pop(); });
    var midPos = await page.evaluate(function () { var v = document.getElementById('nbSrc').value; return v.indexOf('문단 20 입니다.') + 5; });
    await typeAt(midPos, ' 추가 글');
    var r1 = await same();
    var kept = await page.evaluate(function () { return { h: window.__h1 === document.querySelector('#nbDoc h2'), t: window.__lastTbl === [].slice.call(document.querySelectorAll('#nbDoc .nb-tbl')).pop() }; });
    check(r1.ok && /추가 글/.test(await page.evaluate(function () { return document.getElementById('nbDoc').textContent; })), '가운데 치기 — 같음 · 반영');
    check(kept.h && kept.t, '고치지 않은 앞뒤 블록은 그대로 (다시 그리지 않음) ' + JSON.stringify(kept));

    // 맨 앞에 줄 넣기 → 뒤 블록 줄 번호가 모두 밀림
    await typeAt(0, '# 새 제목\n\n');
    var r2 = await same();
    check(r2.ok, '맨 앞 줄 넣기 — 줄 번호 · 체크 칸 번호 모두 새로 ' + JSON.stringify(r2).slice(0, 160));
    var stillKept = await page.evaluate(function () { return window.__lastTbl === [].slice.call(document.querySelectorAll('#nbDoc .nb-tbl')).pop(); });
    check(stillKept, '줄이 밀려도 내용이 같은 블록은 그대로');

    // 밀린 뒤 체크 — 맞는 줄이 바뀌는지
    var tk = await page.evaluate(function () {
      var cb = [].filter.call(document.querySelectorAll('#nbDoc input[data-task]'), function (x) { return !x.checked; })[10];
      var line = +cb.getAttribute('data-task'), before = document.getElementById('nbSrc').value.split('\n')[line];
      cb.click();
      return { line: line, before: before };
    });
    await wait(500);
    var after = await page.evaluate(function (l) { return document.getElementById('nbSrc').value.split('\n')[l]; }, tk.line);
    check(/^- \[ \] 할 일 10$/.test(tk.before) && /^- \[x\] 할 일 10$/i.test(after), '밀린 뒤 체크 — 그 줄만 바뀜 ' + tk.before + ' → ' + after);
    var r3 = await same();
    check(r3.ok, '체크 뒤 — 같음');

    // 블록 지우기 (표 하나)
    await page.evaluate(function () { var s = document.getElementById('nbSrc'), v = s.value, a = v.indexOf('| 가 | 나 |'), b = v.indexOf('\n\n', a); s.focus(); s.setSelectionRange(a, b + 2); });
    await page.keyboard.press('Backspace');
    await wait(700);
    var r4 = await same();
    check(r4.ok && r4.an === r0.an, '블록 지우기 — 같음 (머리 하나 늘고 표 하나 줄어 블록 수 같음) ' + r4.an + '/' + r0.an);

    // v13.551 빈 줄만 넣기 — 블록 내용은 모두 같고 줄 번호만 밀림 (조각 글 비교)
    await page.evaluate(function () { window.__lastTbl = [].slice.call(document.querySelectorAll('#nbDoc .nb-tbl')).pop(); });
    await typeAt(0, '\n\n');
    var r6 = await same();
    var kept6 = await page.evaluate(function () { return window.__lastTbl === [].slice.call(document.querySelectorAll('#nbDoc .nb-tbl')).pop(); });
    check(r6.ok && kept6, '빈 줄만 넣기 — 줄 번호만 밀리고 블록은 그대로 ' + JSON.stringify(r6).slice(0, 120));
    // v13.551 긴 노트(블록 80개 넘음)는 화면 밖 배치 건너뛰기 · 글 상자 · 미리보기 격리
    var cv = await page.evaluate(function () { var d = document.getElementById('nbDoc'); return { on: d.classList.contains('nb-cv'), cv: getComputedStyle(d.children[3]).contentVisibility, n: d.children.length, ct: getComputedStyle(document.getElementById('nbSrc')).contain }; });
    check(cv.on && cv.cv === 'auto' && cv.n > 80 && /strict|size/.test(cv.ct), '긴 노트 — content-visibility · contain ' + JSON.stringify(cv));

    // 보기 모드 — 도구 막대(손글씨 · 덮어 그리기만) : :has 대신 클래스
    await page.evaluate(function () { _nbSetMode('view'); });
    await wait(300);
    var vb = await page.evaluate(function () { var m = document.getElementById('nbMain'), b = document.querySelector('#nbTb [data-fmt="b"]'); return { cls: m.classList.contains('nb-mv-view'), b: b ? getComputedStyle(b).display : 'none' }; });
    await page.evaluate(function () { _nbSetMode('split'); });
    await wait(300);
    var sb = await page.evaluate(function () { var m = document.getElementById('nbMain'), b = document.querySelector('#nbTb [data-fmt="b"]'); return { cls: m.classList.contains('nb-mv-view'), b: b ? getComputedStyle(b).display : 'none' }; });
    check(vb.cls && vb.b === 'none' && !sb.cls && sb.b !== 'none', '보기 모드 — 서식 단추 숨김 · 나눠 보기 — 보임 ' + JSON.stringify([vb, sb]));

    // 반응 — 키 → 다음 그림 (느리게 하지 않은 PC: 넉넉히 p95 < 60ms)
    await page.evaluate(function () {
      window.__lat = [];
      var ta = document.getElementById('nbSrc');
      ta.addEventListener('keydown', function () { var t0 = performance.now(); requestAnimationFrame(function () { setTimeout(function () { window.__lat.push(performance.now() - t0); }, 0); }); });
      ta.focus(); ta.setSelectionRange(ta.value.length / 2 | 0, ta.value.length / 2 | 0);
    });
    for (var k = 0; k < 40; k++) { await page.keyboard.type('a'); await wait(k % 8 === 7 ? 300 : 60); }
    var lat = await page.evaluate(function () { var l = window.__lat.slice().sort(function (a, b) { return a - b; }); return { p50: Math.round(l[l.length / 2 | 0]), p95: Math.round(l[l.length * 0.95 | 0]) }; });
    check(lat.p95 < 60, '반응 — 키 → 화면 p50 ' + lat.p50 + 'ms · p95 ' + lat.p95 + 'ms');
    var r5 = await same();
    check(r5.ok, '쳐 본 뒤에도 같음');
    // 저장까지
    await page.waitForFunction(function () { return typeof NB !== 'undefined' && !Object.keys(NB.pend).length && !NB.saving; }, { timeout: 10000 }).catch(function () {});
    var saved = await page.evaluate(function (id) { return apiFetch('/api/notebook/notes/' + id).then(function (r) { return r.data.body === document.getElementById('nbSrc').value; }); }, id);
    check(saved, '저장된 글 == 쓴 글');

    // v13.551 목록에 올리면 미리 받기 → 누르면 다시 묻지 않음 · 짧은 노트는 content-visibility 안 씀
    var id2 = await page.evaluate(function () { return apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: '미리 받기 시험', body: '짧은 글\n\n- [ ] 하나' }) }).then(function (r) { return r.data.id; }); });
    await page.evaluate(function () { _nbLoadList(); });
    await page.waitForSelector('#nbItems .nb-it[data-id="' + id2 + '"]', { timeout: 8000 });
    var gets = 0;
    page.on('request', function (q) { if (q.method() === 'GET' && q.url().indexOf('/api/notebook/notes/' + id2) >= 0 && q.url().indexOf('backlinks') < 0) gets++; });
    await page.hover('#nbItems .nb-it[data-id="' + id2 + '"]');
    await wait(400);
    var pre = await page.evaluate(function (id2) { return !!(NB.pre && NB.pre[id2]); }, id2);
    await page.click('#nbItems .nb-it[data-id="' + id2 + '"]');
    await page.waitForFunction(function (id2) { return NB.cur && NB.cur.id === id2; }, { timeout: 8000 }, id2);
    await wait(300);
    var cv2 = await page.evaluate(function () { return document.getElementById('nbDoc').classList.contains('nb-cv'); });
    check(pre && gets === 1, '올리면 미리 받기 · 누르면 그것으로 (본문 요청 ' + gets + '번)');
    check(!cv2 && /짧은 글/.test(await page.evaluate(function () { return document.getElementById('nbDoc').textContent; })), '짧은 노트 — content-visibility 안 씀 · 내용 보임');
    await page.evaluate(function (id2) { return apiFetch('/api/notebook/notes/' + id2, { method: 'DELETE' }).catch(function () {}); }, id2);
    check(!errs.length, '페이지 오류 없음 ' + errs.join(' | '));
  } catch (e) {
    fail++; console.log('ERR', e && e.stack || e);
  } finally {
    if (id) await page.evaluate(function (id) { return apiFetch('/api/notebook/notes/' + id, { method: 'DELETE' }).catch(function () {}); }, id).catch(function () {});
    await browser.close();
    console.log(fail ? 'FAILED ' + fail + ' / ok ' + ok : 'ALL PASS ' + ok);
    process.exit(fail ? 1 : 0);
  }
})();
