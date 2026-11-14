// ⬆ PC 앱 자체 업데이트 연기 시험 (v13.495): 실제 main.js + electron-updater 로 우리 서버(/desktop-release/)에서
//   새 버전 확인 → 내려받기 → sha512 확인 → 웹에 '준비됨' → 웹 새로 고침(F5 대신 wmUpdateApply) 때 설치 명령까지.
//   진짜 설치는 막음(quitAndInstall 가로채기 · 끝낼 때 설치 끔) — 설치된 PC 앱은 그대로.
//   npx electron scripts/upd-smoke.js --server=http://localhost:3000   → 'UPD OK …'
const { app } = require('electron');
Object.defineProperty(app, 'isPackaged', { get: () => true, configurable: true });   // 개발 실행에서도 업데이트 길로
// scripts/ 로 띄우면 앱 버전이 Electron 버전(33.x)으로 잡힘 → 설치본과 같게 package.json 버전으로
const PKG_VER = require('../package.json').version;
app.getVersion = () => PKG_VER;
const au = require('electron-updater').autoUpdater;
au.forceDevUpdateConfig = true;
au.updateConfigPath = require('path').join(__dirname, '../dist/win-unpacked/resources/app-update.yml');   // 설치본과 같은 설정(내려받기 캐시 폴더 이름 등)
au.autoInstallOnAppQuit = false;
const log = [];
let installCalled = 0;
au.quitAndInstall = () => { installCalled++; log.push('quitAndInstall'); };
['checking-for-update', 'update-available', 'update-not-available', 'update-downloaded', 'error'].forEach((ev) => au.on(ev, (x) => log.push(ev + (x && x.version ? ' ' + x.version : '') + (ev === 'error' ? ' ' + (x && x.message || '').slice(0, 160) : ''))));
require('../main.js');
setTimeout(() => { try { au.autoInstallOnAppQuit = false; } catch (_) {} }, 0);   // setupUpdater 가 true 로 바꾼 뒤 다시 끔
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let asked = false;
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('did-finish-load', () => {
    if (!/^https?:/.test(w.webContents.getURL()) || asked) return;
    asked = true;
    (async () => {
      const js = (s) => w.webContents.executeJavaScript(s);
      try {
        au.autoInstallOnAppQuit = false;
        // 다 받을 때까지 (main.js 가 켜질 때 checkUpdate)
        for (let i = 0; i < 120 && !log.some((l) => /^update-downloaded|^error|^update-not-available/.test(l)); i++) await wait(500);
        await wait(800);
        const st = JSON.parse(await js(`JSON.stringify({ bar: (document.getElementById('wmUpd') || {}).textContent || '', api: !!(window.wmDesktop && window.wmDesktop.appUpdate) })`));
        const state = await js(`window.wmDesktop.appUpdate('state')`);
        // 웹 새로 고침 → 설치
        await js(`(function(){ window.__wmReload = function(){ window.__reloaded = true; }; wmUpdateApply(); })()`);
        await wait(1200);
        const after = await js(`(document.getElementById('wmUpd') || {}).textContent || ''`);
        if (!/설치 중/.test(after)) log.push('설치 중 띠 없음: ' + after.slice(0, 40));
        const ok = /설치 중/.test(after) && log.some((l) => /^update-downloaded 13\.496\.0/.test(l)) && /PC 앱 새 버전 v13\.496\.0 준비됨/.test(st.bar) && state && state.ready === '13.496.0' && installCalled === 1;
        console.log((ok ? 'UPD OK ' : 'UPD FAIL ') + JSON.stringify({ log, bar: st.bar.slice(0, 60), state, installCalled }));
        app.exit(ok ? 0 : 1);
      } catch (e) { console.log('UPD FAIL ' + (e && e.message) + ' ' + JSON.stringify(log)); app.exit(1); }
    })();
  });
});
setTimeout(() => { console.log('UPD timeout ' + JSON.stringify(log)); app.exit(1); }, 150000);
