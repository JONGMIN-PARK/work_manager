// 📸 캡처 연기 시험 (v13.445): 실제 main.js 를 띄우고 모니터 · 창 목록을 받아 본다.
//   npx electron scripts/cap-smoke.js --server=http://localhost:3000   → 'CAP OK …' 이면 성공
const { app, screen } = require('electron');
require('../main.js');
let asked = false;
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('did-finish-load', () => {
    const u = w.webContents.getURL();
    if (!/^https?:/.test(u) || asked) return;
    asked = true;
    setTimeout(async () => {
      try {
        const r = await w.webContents.executeJavaScript(`(async function () {
          var d = window.wmDesktop, out = { api: typeof d.captureSources + '/' + typeof d.captureWindow };
          var s = await d.captureSources();
          function dim(url) { return new Promise(function (ok) { var im = new Image(); im.onload = function () { ok([im.naturalWidth, im.naturalHeight]); }; im.onerror = function () { ok(null); }; im.src = url; }); }
          out.screens = []; for (var i = 0; i < s.screens.length; i++) out.screens.push({ n: s.screens[i].n, w: s.screens[i].w, h: s.screens[i].h, img: await dim(s.screens[i].url), primary: s.screens[i].primary, current: s.screens[i].current });
          out.windows = s.windows.length; out.names = s.windows.slice(0, 4).map(function (x) { return x.name.slice(0, 24); });
          if (s.windows[0]) { var big = await d.captureWindow(s.windows[0].id); out.win = big ? await dim(big) : null; out.thumb = await dim(s.windows[0].thumb); out.said = [s.windows[0].w, s.windows[0].h]; out.again = await d.captureWindow(s.windows[0].id); }
          // 창을 원래 크기로 (웹 화면의 chatBoardGrabWindow — getUserMedia)
          if (s.windows[0] && typeof chatBoardGrabWindow === 'function') {
            try { var b = await chatBoardGrabWindow(s.windows[0].id); out.gum = await dim(URL.createObjectURL(b)); } catch (e) { out.gum = 'ERR ' + (e && e.message); }
          } else out.gum = 'no-fn';
          // 옛 앱 폴백 — 모니터를 번호로 하나씩 찍어 보기 (chatBoardProbeScreens)
          out.ids = s.screens.map(function (x) { return x.id; });
          if (typeof chatBoardProbeScreens === 'function') { try { var t0 = Date.now(); var ps = await chatBoardProbeScreens(); out.probeMs = Date.now() - t0; out.probe = []; for (var k = 0; k < ps.length; k++) out.probe.push(await dim(URL.createObjectURL(ps[k].blob))); } catch (e) { out.probe = 'ERR ' + (e && e.message); } }
          return JSON.stringify(out);
        })()`);
        const o = JSON.parse(r), displays = screen.getAllDisplays();
        const ok = o.api === 'function/function' && o.screens.length === displays.length && o.screens.every((s) => s.img && s.img[0] === s.w && s.img[1] === s.h) && Array.isArray(o.probe) && o.probe.length === displays.length && o.probe.every((d, i) => d && d[0] > 0) && (!o.windows || (o.win && o.win[0] === o.said[0] && o.win[1] === o.said[1] && o.thumb[0] <= 480 && o.again === ''));   // 창 그림은 알려 준 크기 그대로 · 한 번 주면 비움
        console.log((ok ? 'CAP OK ' : 'CAP FAIL ') + r + ' displays=' + displays.length + ' visibleAfter=' + w.isVisible());
        app.exit(ok ? 0 : 1);
      } catch (e) { console.log('CAP FAIL ' + (e && e.message)); app.exit(1); }
    }, 2500);
  });
});
setTimeout(() => { console.log('CAP timeout'); app.exit(1); }, 90000);
