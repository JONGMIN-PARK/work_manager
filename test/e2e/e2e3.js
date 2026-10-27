// 마인드맵 단축키 · 여러 선택 · 오른쪽 클릭 · 명령 찾기 E2E — 실행: node e2e3.js
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var SHOT = path.join(__dirname, '.shots');
require('fs').mkdirSync(SHOT, { recursive: true });
var ok = 0, errs = [];
function check(name, cond, extra) { if (!cond) throw new Error('FAIL: ' + name + ' ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 1200)); ok++; console.log('✔', name); }
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

(async function () {
  var browser = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(require('os').tmpdir(), 'wm-e2e-chrome-' + Date.now()) });
  var page = (await browser.pages())[0] || await browser.newPage();
  try {
    await page.setViewport({ width: 1500, height: 900 });
    page.on('dialog', function (d) { d.accept(); });
    page.on('pageerror', function (e) { errs.push(e.message); });
    page.on('console', function (m) { if (m.type() === 'error' && !/Failed to load resource|favicon|fonts/.test(m.text())) errs.push('console: ' + m.text()); });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#loginEmail', { visible: true });
    await page.type('#loginEmail', 'admin@t.com');
    await page.type('#loginPw', 'Test1234!');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id; });
    await wait(600);
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    // 빈 맵: 중심 → A, B, C
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmNewTitle');
    await page.type('#mmNewTitle', '단축키 테스트');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(300);
    var key = async function (combo) {
      var parts = combo.split('+');
      var k = parts.pop();
      for (var m of parts) await page.keyboard.down(m);
      await page.keyboard.press(k);
      for (var m2 of parts.reverse()) await page.keyboard.up(m2);
      await wait(120);
    };
    var type = async function (t) { await page.waitForSelector('#mmCanvas textarea.mm-inline'); await page.keyboard.type(t); await page.keyboard.press('Enter'); await wait(120); };
    var kids = function () { return page.evaluate(function () { return _mmRoot().children.map(function (n) { return n.text; }); }); };
    var sel = function () { return page.evaluate(function () { var f = mmFind(_mmRoot(), _mm.sel); return f && f.node.text; }); };
    var node = function (t) { return page.evaluate(function (t) { var x = null; mmWalk(_mmRoot(), function (n) { if (n.text === t) x = n; }); return x; }, t); };

    await page.click('#mmStage .mm-root');
    await key('Tab'); await type('A');
    await key('Enter'); await type('B');
    await key('Enter'); await type('C');
    check('준비: A B C', JSON.stringify(await kids()) === '["A","B","C"]');

    // Shift+Enter: 위에 추가
    await key('Shift+Enter'); await type('B2');
    check('Shift+Enter → 위에 형제', JSON.stringify(await kids()) === '["A","B","B2","C"]', await kids());
    // Alt+↑ / Alt+↓
    await key('Alt+ArrowUp');
    check('Alt+↑ 순서 위로', JSON.stringify(await kids()) === '["A","B2","B","C"]', await kids());
    await key('Alt+ArrowDown'); await key('Alt+ArrowDown');
    check('Alt+↓ 순서 아래로', JSON.stringify(await kids()) === '["A","B","C","B2"]', await kids());
    // Ctrl+] 들여쓰기 → C 의 하위, Ctrl+[ 내어쓰기
    await key('Control+BracketRight');
    var c = await node('C');
    check('Ctrl+] 들여쓰기 → 앞 주제의 하위', c.children.length === 1 && c.children[0].text === 'B2' && (await kids()).length === 3);
    await key('Control+BracketLeft');
    check('Ctrl+[ 내어쓰기', JSON.stringify(await kids()) === '["A","B","C","B2"]', await kids());
    // Ctrl+D 복제
    await key('Control+KeyD');
    check('Ctrl+D 가지 복제', JSON.stringify(await kids()) === '["A","B","C","B2","B2"]', await kids());
    await key('Delete');
    check('Delete', (await kids()).length === 4);
    // 꾸미기: Alt+C · Alt+K · Alt+P · Alt+3
    await page.click('#mmStage .mm-node[data-id="' + (await page.evaluate(function () { return _mmRoot().children[0].id; })) + '"] .mm-txt');
    await key('Alt+KeyC'); await key('Alt+KeyK'); await key('Alt+KeyP'); await key('Alt+KeyP'); await key('Alt+Digit3');
    var a = await node('A');
    check('Alt+C 색 · Alt+K 완료 · Alt+P 진척 · Alt+3 우선순위', a.color === 'blue' && a.done === true && a.progress === 25 && a.markers.indexOf('priority-3') >= 0, a);
    // 하위 만들고 구조: Alt+B · Alt+S · Alt+N
    await key('Tab'); await type('A1');
    await key('Enter'); await type('A2');
    await key('ArrowLeft');
    check('방향키 ← 부모(A)', await sel() === 'A');
    await key('Alt+KeyB'); await key('Alt+KeyN');
    await key('Alt+KeyS');
    await wait(150);
    check('Alt+S → 요약 켜고 요약 칸으로', await page.evaluate(function () { return document.activeElement && document.activeElement.id === 'mmPnSumText'; }));
    await page.keyboard.type('정리'); await page.keyboard.press('Tab'); await wait(150);
    a = await node('A');
    check('Alt+B 경계 · Alt+N 번호 · 요약 글', !!a.boundary && a.numbering === true && /정리/.test(a.summary.text), a);
    check('그림: 경계·요약·번호', !!(await page.$('#mmEdges rect.mm-boundary')) && !!(await page.$('#mmStage .mm-sumlabel')) && (await page.$$('#mmStage .mm-num')).length === 2);
    // Alt+R 관계선 → 클릭
    await page.focus('#mmSink');
    await key('Alt+KeyR');
    var cid = await page.evaluate(function () { var x; mmWalk(_mmRoot(), function (n) { if (n.text === 'C') x = n.id; }); return x; });
    await page.click('#mmStage .mm-node[data-id="' + cid + '"] .mm-txt');
    await wait(150);
    check('Alt+R 관계선', await page.evaluate(function () { return (_mmSheet().relations || []).length === 1; }));
    // Alt+M 노트로
    await page.focus('#mmSink');
    await key('Alt+KeyM');
    check('Alt+M → 노트 칸', await page.evaluate(function () { return document.activeElement && document.activeElement.id === 'mmPnNote'; }));
    await page.keyboard.press('Escape'); await wait(100);

    // 여러 선택: Ctrl+클릭 → Alt+K → 모두 완료, Delete 로 모두 삭제
    var ids = await page.evaluate(function () { return _mmRoot().children.map(function (n) { return n.id; }); });   // A B C B2
    await page.click('#mmStage .mm-node[data-id="' + ids[1] + '"] .mm-txt');
    await page.keyboard.down('Control');
    await page.click('#mmStage .mm-node[data-id="' + ids[2] + '"] .mm-txt');
    await page.click('#mmStage .mm-node[data-id="' + ids[3] + '"] .mm-txt');
    await page.keyboard.up('Control');
    check('Ctrl+클릭 3개 선택 + 표시', (await page.evaluate(function () { return _mm.multi.length; })) === 3 && (await page.$$('#mmStage .mm-node.mm-multi')).length === 3);
    check('패널: N개 선택 일괄 편집', /3개 선택/.test(await page.$eval('#mmPanel', function (e) { return e.textContent; })));
    await key('Alt+KeyK');
    check('여러 선택 Alt+K → 모두 완료', await page.evaluate(function (ids) { return ids.slice(1).every(function (id) { return mmFind(_mmRoot(), id).node.done; }); }, ids));
    await page.click('#mmPanel [data-cmd="color:rose"]');
    await wait(100);
    check('패널 색 → 모두 빨강', await page.evaluate(function (ids) { return ids.slice(1).every(function (id) { return mmFind(_mmRoot(), id).node.color === 'rose'; }); }, ids));
    await page.screenshot({ path: path.join(SHOT, '1-multi.png') });
    // 오른쪽 클릭 (여러 선택 메뉴)
    var bb = await (await page.$('#mmStage .mm-node[data-id="' + ids[2] + '"]')).boundingBox();
    await page.mouse.click(bb.x + 10, bb.y + 8, { button: 'right' });
    await page.waitForSelector('#mmCtxMenu');
    check('여러 선택 오른쪽 클릭 메뉴 (3개 선택)', /3개 선택/.test(await page.$eval('#mmCtxMenu', function (e) { return e.textContent; })));
    await page.screenshot({ path: path.join(SHOT, '2-ctx-multi.png') });
    await page.click('#mmCtxMenu [data-cmd="delete"]');
    await wait(150);
    check('메뉴 → 3개 모두 삭제', JSON.stringify(await kids()) === '["A"]', await kids());
    await key('Control+KeyZ');
    check('Ctrl+Z 한 번에 되살림', (await kids()).length === 4);
    // Esc 로 여러 선택 해제
    await page.evaluate(function () { _mm.multi = []; });
    // Shift+끌기 상자 선택
    var cv = await (await page.$('#mmCanvas')).boundingBox();
    var b1 = await (await page.$('#mmStage .mm-node[data-id="' + ids[1] + '"]')).boundingBox();
    var b3 = await (await page.$('#mmStage .mm-node[data-id="' + ids[3] + '"]')).boundingBox();
    var x0 = Math.min(b1.x, b3.x) - 12, y0 = Math.min(b1.y, b3.y) - 6, x1 = Math.max(b1.x + b1.width, b3.x + b3.width) + 12, y1 = Math.max(b1.y + b1.height, b3.y + b3.height) + 6;
    await page.keyboard.down('Shift');
    await page.mouse.move(x0, y0); await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await wait(150);
    var boxSel = await page.evaluate(function () { return _mm.multi.map(function (id) { return mmFind(_mmRoot(), id).node.text; }).sort(); });
    check('Shift+끌기 상자 선택', boxSel.indexOf('B') >= 0 && boxSel.indexOf('B2') >= 0 && boxSel.length >= 3, boxSel);
    await page.focus('#mmSink');
    await key('Escape');
    check('Esc → 선택 해제', (await page.evaluate(function () { return _mm.multi.length; })) === 0);
    // Ctrl+A
    await key('Control+KeyA');
    check('Ctrl+A 모두 선택', (await page.evaluate(function () { return _mm.multi.length; })) === (await page.evaluate(function () { return Object.keys(_mm.layout.pos).length; })));
    await key('Escape');

    // 오른쪽 클릭 (한 주제) → 경계 해제
    var aId = ids[0];
    bb = await (await page.$('#mmStage .mm-node[data-id="' + aId + '"]')).boundingBox();
    await page.mouse.click(bb.x + 10, bb.y + 8, { button: 'right' });
    await page.waitForSelector('#mmCtxMenu');
    var items = await page.$$eval('#mmCtxMenu [data-cmd]', function (b) { return b.map(function (x) { return x.getAttribute('data-cmd'); }); });
    check('주제 메뉴: 추가·편집·구조·연결·승격 항목 + 단축키 표시', ['addChild', 'boundary', 'linkRef', 'promoteMs', 'moveUp'].every(function (i) { return items.indexOf(i) >= 0; }) && /Alt\+B/.test(await page.$eval('#mmCtxMenu', function (e) { return e.textContent; })), items);
    await page.screenshot({ path: path.join(SHOT, '3-ctx-node.png') });
    await page.click('#mmCtxMenu [data-cmd="boundary"]');
    await wait(150);
    check('메뉴 → 경계 끄기', !(await node('A')).boundary);
    // 빈 곳 오른쪽 클릭
    await page.mouse.click(cv.x + 30, cv.y + cv.height - 30, { button: 'right' });
    await page.waitForSelector('#mmCtxMenu');
    check('빈 곳 메뉴: 화면 맞춤 · 명령 찾기', /화면 맞춤/.test(await page.$eval('#mmCtxMenu', function (e) { return e.textContent; })) && !!(await page.$('#mmCtxMenu [data-cmd="palette"]')));
    await page.keyboard.press('Escape');
    await wait(100);
    check('Esc → 메뉴 닫힘', !(await page.$('#mmCtxMenu')));

    // 명령 찾기: Ctrl+/ → "번호" → Enter
    await page.click('#mmStage .mm-node[data-id="' + aId + '"] .mm-txt');
    await key('Control+Slash');
    await page.waitForSelector('#mmPalQ');
    await page.keyboard.type('번호');
    await wait(100);
    check('명령 찾기 검색', /하위 번호/.test(await page.$eval('#mmPalList', function (e) { return e.textContent; })));
    await page.screenshot({ path: path.join(SHOT, '4-palette.png') });
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return !document.getElementById('mmPaletteModal'); });
    await wait(200);
    check('명령 찾기 → 실행 (번호 끔)', !(await node('A')).numbering);
    check('실행 뒤 캔버스로 포커스', await page.evaluate(function () { return document.activeElement && document.activeElement.id === 'mmSink'; }));
    // F1 도움말
    await key('F1');
    await page.waitForSelector('#mmHelpModal');
    var help = await page.$eval('#mmHelpModal', function (e) { return e.textContent; });
    check('F1 도움말: 묶음별 단축키 (표에서 생성)', /Alt\+R/.test(help) && /Ctrl\+\]/.test(help) && /Shift\+Enter/.test(help) && /마우스/.test(help));
    await page.screenshot({ path: path.join(SHOT, '5-help.png') });
    await page.keyboard.press('Escape');
    await wait(150);
    // Alt+O 아웃라인 전환
    await page.focus('#mmSink');
    await key('Alt+KeyO');
    check('Alt+O → 아웃라인', await page.evaluate(function () { return _mm.outline; }));
    await page.click('[data-act="view-map"]');
    await wait(150);
    // 저장 확인 (여러 선택 표시는 저장 안 됨)
    await page.waitForFunction(function () { return !_mm.dirty && !_mm.saving; }, { timeout: 10000 });
    var saved = await page.evaluate(function () {
      return apiFetch('/api/mindmaps/' + _mm.mapId).then(function (r) { return JSON.stringify(r.data.doc); });
    });
    check('저장 문서 정상 (관계선 · 요약 · 색)', /"relations":\[\{/.test(saved) && /정리/.test(saved) && /"color":"rose"/.test(saved));
    console.log('\nALL PASS', ok);
  } catch (e) {
    console.log(e.message);
    try { await page.screenshot({ path: path.join(SHOT, 'fail.png') }); } catch (_) {}
    process.exitCode = 1;
  } finally {
    if (errs.length) console.log('PAGE ERRORS:\n' + errs.join('\n'));
    await browser.close();
  }
})();
