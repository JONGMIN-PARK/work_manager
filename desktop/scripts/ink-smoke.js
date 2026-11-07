// 🎤 발표 펜 투명 창 연기 시험: 실제 main.js 를 띄우고 웹 화면에서 투명 창을 열어 본다.
//   npx electron scripts/ink-smoke.js --server=http://localhost:3000   → 'INK OK …' 이면 성공
const { app } = require('electron');
require('../main.js');
let asked = false;
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('did-finish-load', () => {
    const u = w.webContents.getURL();
    if (/\/ink-overlay/.test(u)) {
      setTimeout(async () => {
        const r = await w.webContents.executeJavaScript('typeof CI + "/" + typeof wmInk + "/" + !!document.querySelector("#bar .ci-tb .ci-b") + "/" + (CI && CI.relay ? "relay" : "-")');
        const db = require('electron').screen.getPrimaryDisplay().bounds, wb = w.getBounds();
        const ok = r === 'object/object/true/relay' && w.isAlwaysOnTop() && wb.width === db.width && wb.height === db.height;   // 화면 전체(작업 표시줄 포함)를 덮어야 좌표가 맞음
        console.log((ok ? 'INK OK ' : 'INK FAIL ') + r + ' top=' + w.isAlwaysOnTop() + ' bounds=' + JSON.stringify(w.getBounds()) + ' display=' + JSON.stringify(require('electron').screen.getPrimaryDisplay().bounds) + ' work=' + JSON.stringify(require('electron').screen.getPrimaryDisplay().workArea));
        app.exit(ok ? 0 : 1);
      }, 3000);
      return;
    }
    if (/^https?:/.test(u) && !asked) { asked = true; setTimeout(() => w.webContents.executeJavaScript('window.wmDesktop.inkOverlay({ me: "smoke" })'), 1500); }
  });
});
setTimeout(() => { console.log('INK timeout'); app.exit(1); }, 90000);
