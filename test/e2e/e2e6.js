// 주제 안 내용 줄(글 · 이미지) E2E — 실행: node e2e6.js
var path = require('path');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
var pg = require(require('path').join(__dirname, '../../server/node_modules/pg'));
var SHOT = path.join(__dirname, '.shots');
var ok = 0, errs = [];
function check(name, cond, extra) { if (!cond) throw new Error('FAIL: ' + name + ' ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 1000)); ok++; console.log('✔', name); }
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
    await wait(500);
    await page.click('#tabMindmap');
    await page.waitForSelector('#mindmapWrap [data-act="new"]');
    await page.click('#mindmapWrap [data-act="new"]');
    await page.waitForSelector('#mmNewTitle');
    await page.type('#mmNewTitle', '이미지 테스트');
    await page.click('#mmNewOk');
    await page.waitForSelector('#mmStage .mm-root');
    await wait(300);
    await page.click('#mmStage .mm-root');
    await page.keyboard.press('Tab');
    await page.waitForSelector('#mmCanvas textarea.mm-inline');
    await page.keyboard.type('프레임 설계');
    await page.keyboard.press('Enter');
    await wait(150);
    var nodeId = await page.evaluate(function () { return _mm.sel; });

    // 1) 캡처 붙여넣기 (클립보드 이미지 800x400 PNG)
    await page.evaluate(function () {
      var c = document.createElement('canvas'); c.width = 800; c.height = 400;
      var g = c.getContext('2d'); g.fillStyle = '#3b82f6'; g.fillRect(0, 0, 800, 400); g.fillStyle = '#fff'; g.font = '60px sans-serif'; g.fillText('도면 캡처', 200, 220);
      return new Promise(function (res) { c.toBlob(function (b) {
        var dt = new DataTransfer(); dt.items.add(new File([b], 'cap.png', { type: 'image/png' }));
        document.getElementById('mmSink').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        res();
      }, 'image/png'); });
    });
    await page.waitForFunction(function (id) { var f = mmFind(_mmRoot(), id); return f && f.node.blocks && f.node.blocks.length === 1; }, { timeout: 10000 }, nodeId);
    var blk = await page.evaluate(function (id) { return mmFind(_mmRoot(), id).node.blocks[0]; }, nodeId);
    check('Ctrl+V 캡처 → 이미지 줄 (원본 크기 · 표시 폭 220)', blk.t === 'img' && blk.w === 800 && blk.h === 400 && blk.dw === 220, blk);
    check('주제 안에 이미지 그림 (220x110)', await page.evaluate(function () { var im = document.querySelector('#mmStage .mm-blk-img[data-img]'); return im && im.offsetWidth === 220 && im.offsetHeight === 110; }));
    // 2) 글 줄 추가 + 이미지 끌어다 놓기
    await page.click('#mmPanel [data-blk-act="add-text"]');
    await wait(150);
    await page.keyboard.type('치수 확인 필요');
    await page.keyboard.press('Tab');
    await wait(150);
    var nb = await (await page.$('#mmStage .mm-node[data-id="' + nodeId + '"]')).boundingBox();
    await page.evaluate(function (x, y) {
      var c = document.createElement('canvas'); c.width = 3200; c.height = 2400;   // 큰 사진 → 1600 으로 줄여야 함
      var g = c.getContext('2d'); g.fillStyle = '#10b981'; g.fillRect(0, 0, 3200, 2400);
      return new Promise(function (res) { c.toBlob(function (b) {
        var dt = new DataTransfer(); dt.items.add(new File([b], 'photo.jpg', { type: 'image/jpeg' }));
        var cv = document.getElementById('mmCanvas');
        cv.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
        cv.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
        res();
      }, 'image/jpeg', 0.9); });
    }, nb.x + nb.width / 2, nb.y + 10);
    await page.waitForFunction(function (id) { var f = mmFind(_mmRoot(), id); return f && f.node.blocks.length === 3; }, { timeout: 10000 }, nodeId);
    var bl = await page.evaluate(function (id) { return mmFind(_mmRoot(), id).node.blocks.map(function (b) { return b.t + ':' + (b.v || (b.w + 'x' + b.h)); }); }, nodeId);
    check('끌어다 놓기 → 이미지 줄 (큰 사진은 1600x1200 으로)', bl[0] === 'img:800x400' && bl[1] === 'text:치수 확인 필요' && bl[2] === 'img:1600x1200', bl);
    check('놓으면서 끼우는 표시 해제', await page.evaluate(function () { return !document.getElementById('mmCanvas').classList.contains('mm-dropping'); }));
    check('업무일지 가져오기로 넘어가지 않음 (오류 알림 없음)', await page.evaluate(function () { return !/지원하지 않는 파일/.test(document.body.innerText); }));
    // 3) 순서 바꾸기 · 크기 바꾸기
    await page.click('#mmPanel [data-blk-act="up"][data-i="1"]');
    await wait(150);
    bl = await page.evaluate(function (id) { return mmFind(_mmRoot(), id).node.blocks.map(function (b) { return b.t; }); }, nodeId);
    check('↑ 로 줄 순서 바꾸기 (글 줄이 먼저)', bl.join() === 'text,img,img', bl);
    await page.select('#mmPanel .mm-blk-size[data-i="1"]', '340');
    await wait(200);
    var dims = await page.evaluate(function (id) {
      var el = document.querySelector('#mmStage .mm-node[data-id="' + id + '"]');
      var ims = el.querySelectorAll('.mm-blk-img');
      return { w0: ims[0].offsetWidth, h0: ims[0].offsetHeight, nodeW: el.offsetWidth, layoutW: _mm.layout.pos[id].w };
    }, nodeId);
    check('크게(340) → 주제 폭도 넓어지고 배치에 반영', dims.w0 === 340 && dims.h0 === 170 && dims.nodeW >= 340 && Math.abs(dims.nodeW - dims.layoutW) < 1, dims);
    check('주제 안: 글 줄 표시', /치수 확인 필요/.test(await page.$eval('#mmStage .mm-node[data-id="' + nodeId + '"]', function (e) { return e.textContent; })));
    // 겹침 없음 (이미지로 커진 주제)
    var ov = await page.evaluate(function () { var p = _mm.layout.pos, ids = Object.keys(p), n = 0; for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) { var a = p[ids[i]], b = p[ids[j]]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) n++; } return n; });
    check('겹침 없음', ov === 0);
    await page.screenshot({ path: path.join(SHOT, '7-images.png') });
    // 4) 더블클릭 → 크게 보기
    var imgEl = await page.$('#mmStage .mm-node[data-id="' + nodeId + '"] .mm-blk-img');
    var ib = await imgEl.boundingBox();
    await page.mouse.click(ib.x + 20, ib.y + 20, { clickCount: 2 });
    await page.waitForSelector('#mmImgViewModal img');
    check('이미지 더블클릭 → 크게 보기', true);
    await page.keyboard.press('Escape');
    await wait(200);
    // 5) 검색: 글 줄도 찾음
    await page.focus('#mmSearch');
    await page.keyboard.type('치수');
    await page.keyboard.press('Enter');
    await wait(150);
    check('검색이 글 줄도 찾음', await page.evaluate(function (id) { return _mm.sel === id; }, nodeId));
    await page.keyboard.press('Escape');
    // 6) 저장 → 다시 열기
    await page.waitForFunction(function () { return !_mm.dirty && !_mm.saving; }, { timeout: 10000 });
    var mapId = await page.evaluate(function () { return _mm.mapId; });
    await page.click('[data-act="back"]');
    await page.waitForSelector('#mindmapWrap .mm-card[data-id="' + mapId + '"]');
    await page.click('#mindmapWrap .mm-card[data-id="' + mapId + '"]');
    await page.waitForSelector('#mmStage .mm-root');
    await page.waitForFunction(function () { return document.querySelectorAll('#mmStage .mm-blk-img[data-img]').length === 2; }, { timeout: 10000 });
    check('다시 열어도 이미지 2장 · 글 줄 유지', true);
    // 7) 서버 검사: 잘못된 파일 · 복제
    var bad = await page.evaluate(function (id) { return apiFetch('/api/mindmaps/' + id + '/images', { method: 'POST', body: JSON.stringify({ src: 'data:text/html;base64,PGI+', w: 1, h: 1 }) }).then(function () { return 'ok'; }).catch(function (e) { return e.status; }); }, mapId);
    check('이미지가 아닌 데이터 → 400', bad === 400);
    var dup = await page.evaluate(function (id) { return apiFetch('/api/mindmaps/' + id + '/duplicate', { method: 'POST', body: '{}' }).then(function (r) { return apiFetch('/api/mindmaps/' + r.data.id + '/images'); }).then(function (r) { return r.data.length; }); }, mapId);
    check('맵 복제 → 이미지도 복사', dup === 2, dup);
    // 8) 이미지 줄 삭제 → 저장 때 unref_at 표시 (7일 뒤 정리)
    await page.click('#mmStage .mm-node[data-id="' + nodeId + '"] .mm-txt');
    await page.click('#mmPanel [data-blk-act="del"][data-i="2"]');
    await wait(200);
    await page.waitForFunction(function () { return !_mm.dirty && !_mm.saving; }, { timeout: 10000 });
    var c = new pg.Client('postgres://postgres:pw@localhost:54329/wm'); await c.connect();
    var rows = (await c.query('SELECT id, unref_at FROM mindmap_images WHERE map_id = $1 ORDER BY created_at', [mapId])).rows;
    await c.end();
    check('지운 이미지는 unref 표시 · 남은 이미지는 그대로', rows.length === 2 && rows.filter(function (r) { return r.unref_at; }).length === 1, rows);
    // 9) Ctrl+Z 로 되살리면 표시 해제
    await page.focus('#mmSink');
    await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
    await wait(200);
    await page.waitForFunction(function () { return !_mm.dirty && !_mm.saving; }, { timeout: 10000 });
    c = new pg.Client('postgres://postgres:pw@localhost:54329/wm'); await c.connect();
    rows = (await c.query('SELECT unref_at FROM mindmap_images WHERE map_id = $1', [mapId])).rows;
    await c.end();
    check('되돌리면 unref 해제 (이미지 그대로 보임)', rows.every(function (r) { return !r.unref_at; }) && (await page.$$('#mmStage .mm-blk-img[data-img]')).length === 2);
    console.log('\nALL PASS', ok);
  } catch (e) {
    console.log(e.message);
    try { await page.screenshot({ path: path.join(SHOT, 'fail-img.png') }); } catch (_) {}
    process.exitCode = 1;
  } finally {
    if (errs.length) console.log('PAGE ERRORS:\n' + errs.join('\n'));
    await browser.close();
  }
})();
