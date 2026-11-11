// 🪟 제목 줄 연기 시험 (v13.454): 실제 main.js 를 띄워 웹 머리 줄이 제목 줄을 맡는지 · 단추 색을 보내는지 본다
//   npx electron scripts/tb-smoke.js --server=http://localhost:3000   → 'TB OK …'
const { app, ipcMain } = require('electron');
const sent = [];
ipcMain.on('wm:titlebar', (_e, o) => sent.push(o));   // main.js 의 것과 같이 받음
require('../main.js');
let asked = false;
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('did-finish-load', () => {
    const u = w.webContents.getURL();
    if (!/^https?:/.test(u) || asked) return;
    asked = true;
    setTimeout(async () => {
      try {
        const r = JSON.parse(await w.webContents.executeJavaScript(`JSON.stringify({ tbo: document.documentElement.classList.contains('wm-tbo'), api: !!(window.wmDesktop && window.wmDesktop.titleBarOverlay), drag: (function () { var h = document.querySelector('.hdr'); return h ? getComputedStyle(h).webkitAppRegion || getComputedStyle(h).getPropertyValue('-webkit-app-region') : ''; })(), area: [getComputedStyle(document.documentElement).getPropertyValue('--x'), window.navigator.windowControlsOverlay ? window.navigator.windowControlsOverlay.visible : null] })`));
        const ok = r.tbo && r.api && sent.length > 0 && /^#[0-9a-f]{6}$/i.test(sent[sent.length - 1].color);
        console.log((ok ? 'TB OK ' : 'TB FAIL ') + JSON.stringify(r) + ' sent=' + JSON.stringify(sent.slice(-2)));
        app.exit(ok ? 0 : 1);
      } catch (e) { console.log('TB FAIL ' + (e && e.message)); app.exit(1); }
    }, 4000);
  });
});
setTimeout(() => { console.log('TB timeout'); app.exit(1); }, 90000);
