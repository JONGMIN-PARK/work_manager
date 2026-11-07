// PC 앱 연기 시험: 실제 main.js 를 띄우고 서버 화면이 뜨면 화면을 찍고 끝낸다.
//   npx electron scripts/smoke.js [--server=URL]   → dist/smoke.png
const { app } = require('electron');
const path = require('path'), fs = require('fs');
require('../main.js');
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('did-start-navigation', (_e, url, _inPage, isMain) => { if (isMain) console.log('SMOKE nav ' + url); });
  w.webContents.on('did-finish-load', () => {
    const u = w.webContents.getURL();
    if (!/^https?:/.test(u)) return;
    setTimeout(async () => {
      const img = await w.webContents.capturePage();
      fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '..', 'dist', 'smoke.png'), img.toPNG());
      const bridge = await w.webContents.executeJavaScript('typeof window.wmDesktop + "/" + (window.wmDesktop && window.wmDesktop.isDesktop)');
      console.log('SMOKE url=' + u + ' bridge=' + bridge);
      app.exit(0);
    }, 6000);
  });
});
setTimeout(() => { console.log('SMOKE timeout'); app.exit(1); }, 90000);
