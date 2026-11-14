/**
 * 업무 관리자 PC 앱 (Electron) — v13.355
 *   같은 서버 · 같은 DB 를 쓰는 창. 화면은 서버의 웹 화면 그대로(늘 최신), PC 앱은 이것만 더한다:
 *   트레이 상주 · 윈도우 알림 · 작업 표시줄 숫자/깜빡임 · Ctrl+Shift+M · 자동 실행 · 화면 공유 · 자동 업데이트
 *   서버 주소: --server=URL  >  환경변수 WM_SERVER  >  설정 파일(userData/config.json)  >  기본값
 */
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, shell, globalShortcut, session, desktopCapturer, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_SERVER = 'https://work-manager-ws3t.onrender.com';
const APP_ID = 'kr.co.animotion.workmanager';
const ICON = path.join(__dirname, 'build', 'icon.png');
const TRAY_ICON = path.join(__dirname, 'build', 'tray.png');

let win = null, tray = null, quitting = false, retryTimer = null, unread = 0;
let sharedDisplayId = null, ctlOn = false;   // 🖱 원격 제어 (v13.360)
const remote = require('./remote-input');

/* ─── 설정 ─── */
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
function readCfg() { try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch (_) { return {}; } }
function writeCfg(c) { try { fs.writeFileSync(cfgPath(), JSON.stringify(c, null, 2)); } catch (_) {} }
function SERVER() {
  const arg = process.argv.find((a) => a.startsWith('--server='));
  const u = (arg && arg.slice(9)) || process.env.WM_SERVER || readCfg().server || DEFAULT_SERVER;
  return u.replace(/\/+$/, '');
}
function sameOrigin(u) { try { return new URL(u).origin === new URL(SERVER()).origin; } catch (_) { return false; } }

/* ─── 하나만 실행 ─── */
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', (_e, argv) => { showWin(); const l = deepLink(argv); if (l) handleLink(l); });

/* ─── workmanager:// — 기본 브라우저에서 구글 로그인을 마치면 이 주소로 앱에 돌아온다 (v13.357) ─── */
const PROTO = 'workmanager';
if (app.isPackaged) app.setAsDefaultProtocolClient(PROTO);   // 개발 실행(npm start)은 등록 안 함 — 설치한 앱의 등록을 덮지 않게
function deepLink(argv) { return (argv || []).find((a) => String(a).startsWith(PROTO + '://')) || null; }
let pendingLink = deepLink(process.argv);
function handleLink(link) {
  if (!win) { pendingLink = link; return; }
  try {
    const u = new URL(link);
    const code = u.searchParams.get('code');
    if (u.hostname === 'auth' && /^[a-f0-9]{20,100}$/.test(code || '')) {
      win.loadURL(SERVER() + '/api/auth/desktop-exchange?code=' + code).catch(() => {});
      showWin();
    }
  } catch (_) {}
}

app.setAppUserModelId(APP_ID);   // 윈도우 알림에 앱 이름 · 아이콘

function showWin(go) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus(); win.flashFrame(false);
  if (readCfg().onTop && !win.isAlwaysOnTop()) applyOnTop(true);   // v13.383 트레이에서 다시 열 때도 맨 위 유지
  if (go) win.webContents.send('wm:go', go);
}

function loadApp(go) {
  clearTimeout(retryTimer);
  const q = new URLSearchParams({ src: 'desktop', go: go || 'messages' });
  win.loadURL(SERVER() + '/?' + q.toString()).catch(() => {});
}

function createWindow() {
  const st = readCfg().bounds || {};
  win = new BrowserWindow({
    width: st.width || 1280, height: st.height || 820, x: st.x, y: st.y,
    minWidth: 380, minHeight: 520,
    title: '업무 관리자', icon: ICON, show: false, backgroundColor: '#0f1220', autoHideMenuBar: true,
    // v13.454 윈도우 기본 제목 표시줄을 숨기고 웹 머리 줄이 그 자리를 맡음
    // v13.494 최소화 · 최대화 · 닫기도 윈도우 기본 단추(titleBarOverlay — 늘 맨 위에 덮여 알림 · 검색 · 창과 겹치고 색이 테마와 어긋남) 대신
    //         웹 머리 줄 안에 테마 색으로 그림 (wm:win · wm:winstate). 창 가장자리 크기 조절 · 머리 줄 끌기 · 두 번 눌러 최대화는 그대로
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:wm', spellcheck: false, backgroundThrottling: false }   // v13.382 창을 숨겨 둬도 실시간 연결 · 통화 울림이 늦지 않게
  });
  if (st.max) win.maximize();
  if (readCfg().onTop) applyOnTop(true);   // v13.382 📌 항상 위
  // 창 안 단축키: Ctrl+Alt+T 📌 항상 위 켜기 · 끄기
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.control && i.alt && !i.shift && (i.key === 't' || i.key === 'T')) { e.preventDefault(); setOnTop(!win.isAlwaysOnTop()); return; }
    // v13.495 새로 고침(F5 · Ctrl+R) 때 PC 앱 새 버전을 받아 두었으면 그것까지 설치하고 다시 시작
    if (upd.ready && app.isPackaged && (i.key === 'F5' || (i.control && !i.alt && (i.key === 'r' || i.key === 'R')))) { e.preventDefault(); installNow(); }
  });
  // 구글 로그인은 'Electron' 이 든 브라우저 이름을 막는다 → 보통 크롬 이름으로
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/\s(Electron|work-manager-desktop|업무 관리자)\/\S+/g, ''));
  win.loadFile(path.join(__dirname, 'offline.html'), { query: { server: SERVER() } });   // 서버가 깨어나는 동안 보이는 화면
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden') || pendingLink) win.show();
    if (pendingLink) { const l = pendingLink; pendingLink = null; handleLink(l); } else loadApp();
  });

  // 서버에 못 닿으면 안내 화면 + 15초마다 다시
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3 || !/^https?:/.test(url)) return;   // -3: 다른 이동으로 취소됨
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { server: SERVER(), err: '1' } });
    retryTimer = setTimeout(() => loadApp(), 15000);
  });

  // 새 창: 같은 서버(파일 미리보기 등)는 앱 안에서, 바깥 주소는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:') || url === 'about:blank' || sameOrigin(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON } };
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    const b = win.getNormalBounds();
    writeCfg(Object.assign(readCfg(), { bounds: Object.assign(b, { max: win.isMaximized() }) }));
    if (!quitting) { e.preventDefault(); win.hide(); trayHint(); }   // 닫아도 트레이에 남아 알림을 받는다
  });
  win.on('focus', () => win.flashFrame(false));
  // v13.494 최대화 · 이전 크기 · 전체 화면이 바뀌면 웹 창 단추 모양(□ ↔ ❐)도
  const sendState = () => { try { win.webContents.send('wm:winstate', winState()); } catch (_) {} };
  ['maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur'].forEach((ev) => win.on(ev, sendState));
}
function winState() { return { max: !!(win && win.isMaximized()), full: !!(win && win.isFullScreen()), focus: !!(win && win.isFocused()) }; }

/* v13.382 📌 항상 위 — 다른 프로그램을 써도 이 창이 위에 (기억해 둠) */
/* v13.383 윈도우는 단계('floating' 등)를 붙이면 맨 위가 걸리지 않음(Electron 33 실측) → 단계 없이. 맥만 'floating' */
function applyOnTop(on) {
  if (!win) return;
  if (process.platform === 'darwin') win.setAlwaysOnTop(!!on, 'floating'); else win.setAlwaysOnTop(!!on);
}
function setOnTop(on) {
  if (!win) return;
  applyOnTop(on);
  writeCfg(Object.assign(readCfg(), { onTop: !!on }));
  refreshTray();
  try { win.webContents.send('wm:ontop', !!on); } catch (_) {}
}
ipcMain.on('wm:ontop-set', (e, on) => { if (win && e.sender === win.webContents) setOnTop(on); });
ipcMain.handle('wm:ontop-get', () => !!(win && win.isAlwaysOnTop()));

function trayHint() {
  const c = readCfg();
  if (c.trayHinted) return;
  writeCfg(Object.assign(c, { trayHinted: true }));
  new Notification({ title: '업무 관리자는 계속 켜져 있습니다', body: '오른쪽 아래 트레이 아이콘에서 다시 열거나 끝낼 수 있습니다. (Ctrl+Shift+M)', icon: ICON }).show();
}

/* ─── 트레이 ─── */
function buildTrayMenu() {
  const login = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: '업무 관리자 열기', click: () => showWin() },
    { type: 'separator' },
    { label: '💬 메신저' + (unread ? '  (' + unread + ')' : ''), click: () => showWin('messages') },
    { label: '📋 내 업무', click: () => showWin('mywork') },
    { type: 'separator' },
    { label: '📌 항상 위에 두기  (Ctrl+Alt+T)', type: 'checkbox', checked: !!(win && win.isAlwaysOnTop()), click: (m) => setOnTop(m.checked) },
    { label: '윈도우 시작할 때 실행', type: 'checkbox', checked: login, click: (m) => app.setLoginItemSettings({ openAtLogin: m.checked, args: ['--hidden'] }) },
    { label: '새로 고침', click: () => { showWin(); loadApp(); } },
    { label: '서버: ' + SERVER(), enabled: false },
    upd.ready ? { label: '⬆ 새 버전 ' + upd.ready + ' — 설치하고 다시 시작', click: () => { quitting = true; ctlStop(false); require('electron-updater').autoUpdater.quitAndInstall(true, true); } }
      : { label: upd.busy ? '업데이트 받는 중… ' + (upd.pct || 0) + '%' : '업데이트 확인', enabled: app.isPackaged && !upd.busy, click: () => checkUpdate(true) },
    { label: '버전 ' + app.getVersion(), enabled: false },
    { type: 'separator' },
    { label: '끝내기', click: () => { quitting = true; app.quit(); } }
  ]);
}
function refreshTray() {
  if (!tray) return;
  tray.setToolTip('업무 관리자' + (unread ? ' — 안 읽은 메시지 ' + unread : ''));
  tray.setContextMenu(buildTrayMenu());
}

/* ─── ⬆ 자동 업데이트 (v13.360) — latest.yml 을 보고 뒤에서 받아 두었다가, 끝낼 때 · 트레이 · 웹 새로 고침 때 설치 ───
 * v13.495 GitHub 릴리스(토큰이 있어야 올림) 대신 우리 서버 /desktop-release/ (저장소 desktop/release 를 서버가 내려 줌)
 *   → 저장소에 설치 파일을 커밋 · 푸시만 하면 PC 앱이 알아서 받음. 웹에서 새로 고치면(새 버전 띠 · F5 · Ctrl+R) 받아 둔 것을 바로 설치 */
const upd = { busy: false, ready: null, pct: 0, manual: false, applyWhenReady: false };
function feedUrl() { return SERVER().replace(/\/+$/, '') + '/desktop-release/'; }
function updState() { return { version: app.getVersion(), busy: upd.busy, pct: upd.pct, ready: upd.ready }; }
function sendUpd() { try { if (win) win.webContents.send('wm:update-state', updState()); } catch (_) {} }
function installNow() { quitting = true; ctlStop(false); require('electron-updater').autoUpdater.quitAndInstall(true, true); }
function setupUpdater() {
  const au = require('electron-updater').autoUpdater;
  try { au.setFeedURL({ provider: 'generic', url: feedUrl() }); } catch (e) { console.warn('[update] feed', e.message); }
  au.autoDownload = true; au.autoInstallOnAppQuit = true;
  au.on('update-available', (i) => { upd.busy = true; refreshTray(); sendUpd(); if (upd.manual) toast('⬆ 새 버전 ' + i.version + ' 을 받는 중입니다'); });
  au.on('update-not-available', () => { upd.busy = false; upd.applyWhenReady = false; refreshTray(); sendUpd(); if (upd.manual) toast('✅ 최신 버전입니다 (' + app.getVersion() + ')'); upd.manual = false; });
  au.on('download-progress', (p) => { const n = Math.round(p.percent || 0); if (n !== upd.pct) { upd.pct = n; refreshTray(); sendUpd(); } });
  au.on('update-downloaded', (i) => {
    upd.busy = false; upd.ready = i.version; refreshTray(); sendUpd();
    if (upd.applyWhenReady) { installNow(); return; }   // 웹에서 새로 고침을 눌렀을 때 아직 받는 중이었으면 — 다 받는 대로 설치
    const n = new Notification({ title: '⬆ 업무 관리자 ' + i.version + ' 준비됨', body: '누르면 바로 설치하고 다시 시작합니다 (그냥 두면 끝낼 때 설치)', icon: ICON });
    n.on('click', () => { quitting = true; ctlStop(false); au.quitAndInstall(true, true); });
    n.show();
  });
  au.on('error', (e) => { upd.busy = false; upd.applyWhenReady = false; refreshTray(); sendUpd(); if (upd.manual) toast('업데이트를 확인하지 못했습니다: ' + (e && e.message ? e.message.slice(0, 80) : '')); upd.manual = false; });
}
function checkUpdate(manual) {
  if (!app.isPackaged || upd.busy || upd.ready) { if (manual && upd.ready) toast('⬆ ' + upd.ready + ' 이 준비돼 있습니다 — 트레이 메뉴에서 설치'); return; }
  upd.manual = manual;
  try { require('electron-updater').autoUpdater.checkForUpdates().catch(() => {}); } catch (e) { console.warn('[update]', e.message); }
}
/* v13.495 웹 ↔ 업데이트 — 버전 · 상태 묻기, 확인(받기), 적용(받아 둔 것이 있으면 설치하고 다시 시작) */
ipcMain.handle('wm:update', (e, a) => {
  if (!win || e.sender !== win.webContents) return null;
  if (a === 'apply') {
    if (upd.ready && app.isPackaged) { setTimeout(installNow, 150); return Object.assign(updState(), { installing: true }); }
    if (upd.busy) { upd.applyWhenReady = true; return Object.assign(updState(), { waiting: true }); }
    return updState();
  }
  if (a === 'check') checkUpdate(false);
  return updState();
});
function toast(body) { if (Notification.isSupported()) new Notification({ title: '업무 관리자', body: body, icon: ICON }).show(); }

/* ─── 웹 화면 ↔ 앱 ─── */
const NOTES = new Map();   // v13.382 tag → 알림 (📞 통화가 끝나면 닫기)
ipcMain.on('wm:notify', (_e, o) => {
  if (!Notification.isSupported()) return;
  const urgent = !!o.urgent, tag = String(o.tag || '').slice(0, 80);
  // 📞 통화는 사라지지 않고 남음(받거나 끊길 때까지) · 소리
  const n = new Notification({ title: String(o.title || '업무 관리자').slice(0, 120), body: String(o.body || '').slice(0, 300), icon: ICON, urgency: urgent ? 'critical' : 'normal', timeoutType: urgent ? 'never' : 'default', silent: false });
  n.on('click', () => showWin(o.go || ''));
  if (tag) { const old = NOTES.get(tag); if (old) try { old.close(); } catch (_) {} NOTES.set(tag, n); n.on('close', () => { if (NOTES.get(tag) === n) NOTES.delete(tag); }); }
  n.show();
  if (win && !win.isFocused()) win.flashFrame(true);
});
ipcMain.on('wm:notify-close', (_e, tag) => { const n = NOTES.get(String(tag || '')); if (n) { NOTES.delete(String(tag)); try { n.close(); } catch (_) {} } });
ipcMain.on('wm:badge', (_e, o) => {
  const n = Math.max(0, o.n | 0), before = unread;
  unread = n;
  if (win) {
    if (n > 0 && o.png) win.setOverlayIcon(nativeImage.createFromDataURL(o.png), '안 읽은 메시지 ' + n + '개');
    else win.setOverlayIcon(null, '');
    if (n > before && !win.isFocused()) win.flashFrame(true);
  }
  app.setBadgeCount(n);
  refreshTray();
});
/* v13.401 트레이 아이콘에 빨간 숫자 — 창이 숨어 트레이에만 있어도 안 읽은 수가 보이게 */
ipcMain.handle('wm:tray-base', () => {
  const p2 = path.join(__dirname, 'build', 'tray@2x.png');
  try { return nativeImage.createFromPath(require('fs').existsSync(p2) ? p2 : TRAY_ICON).toDataURL(); } catch (_) { return ''; }
});
ipcMain.on('wm:tray-img', (_e, o) => {
  if (!tray) return;
  const n = Math.max(0, (o && o.n) | 0);
  if (n !== unread && n > 0) return;   // 늦게 온 옛 그림은 버림
  try {
    if (n > 0 && o.p16) {
      const im = nativeImage.createEmpty();
      im.addRepresentation({ scaleFactor: 1, width: 16, height: 16, dataURL: o.p16 });
      if (o.p32) im.addRepresentation({ scaleFactor: 2, width: 32, height: 32, dataURL: o.p32 });
      tray.setImage(im);
    } else tray.setImage(nativeImage.createFromPath(TRAY_ICON));
  } catch (_) {}
});
ipcMain.on('wm:retry', () => loadApp());
/* 🖱 원격 제어 — 화면 공유 중 내가 '허락'했을 때만 (웹 화면이 알려 줌) · Ctrl+Alt+End 로 언제든 끝 */
function ctlStop(fromKey) {
  if (!ctlOn) return;
  ctlOn = false; remote.stop();
  try { globalShortcut.unregister('Control+Alt+End'); } catch (_) {}
  if (fromKey && win) win.webContents.send('wm:ctl-stop');
}
ipcMain.on('wm:ctl', (e, on) => {
  if (!win || e.sender !== win.webContents) return;
  if (on && !ctlOn) {
    ctlOn = true; remote.start();
    try { globalShortcut.register('Control+Alt+End', () => ctlStop(true)); } catch (_) {}
  } else if (!on) ctlStop(false);
});
function sharedArea() {
  const { screen } = require('electron');
  const d = screen.getAllDisplays().find((x) => String(x.id) === String(sharedDisplayId)) || screen.getPrimaryDisplay();
  return process.platform === 'win32' ? screen.dipToScreenRect(null, d.bounds) : d.bounds;   // 실제 화면 픽셀
}
ipcMain.on('wm:input', (e, ev) => {
  if (!ctlOn || !win || e.sender !== win.webContents) return;
  remote.input(ev, sharedArea());
});
/* 📸 v13.445 찍을 곳 고르기 — 모니터 여러 대 · 열린 창
 *   wm:capture-sources → 우리 창을 잠깐 숨기고 ① 모니터 전부를 원래 해상도로 찍어 두고 ② 열린 창 목록(작은 미리보기)을 돌려줌
 *   wm:capture-window  → 고른 창 그림(간직해 둔 것)을 돌려줌
 *   옛 wm:capture(마우스가 있는 모니터 하나)는 그대로 둠 — 웹 화면이 새 것을 못 쓰는 경우의 폴백 */
const capWinCache = new Map(); let capWinTimer = null;
const CAP_SKIP = /^(작업 전환|Task Switching|Program Manager|Windows 입력 환경|Windows Input Experience)$/;   // 창처럼 잡히지만 창이 아닌 것
async function capHidden(fn) {
  const wasVisible = win && win.isVisible();
  try {
    if (wasVisible) { win.hide(); await new Promise((r) => setTimeout(r, 280)); }
    return await fn();
  } finally {
    if (wasVisible) { win.show(); win.focus(); }
  }
}
ipcMain.handle('wm:capture-sources', async () => {
  const { screen } = require('electron');
  return capHidden(async () => {
    const all = screen.getAllDisplays().slice().sort((a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y));   // 왼쪽 모니터부터
    const cur = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), pri = screen.getPrimaryDisplay();
    const screens = [];
    for (let i = 0; i < all.length; i++) {
      const d = all[i];
      const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
      const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });   // 모니터마다 제 해상도로 (한 번에 받으면 크기가 하나로 맞춰짐)
      const s = srcs.find((x) => String(x.display_id) === String(d.id)) || (all.length === 1 ? srcs[0] : srcs[i]);
      if (!s || s.thumbnail.isEmpty()) continue;
      screens.push({ id: s.id, n: i + 1, w: size.width, h: size.height, primary: d.id === pri.id, current: d.id === cur.id, url: s.thumbnail.toDataURL() });
    }
    // 창 — 한 번 숨긴 김에 크게 찍어 간직해 두고(1분), 목록에는 작은 그림만 보냄. 고르면 간직한 것을 그대로 줌
    //   (고른 뒤 다시 찍으면 우리 창을 또 숨겨야 하고, 그 사이 사라진 창은 못 찍음)
    let windows = [];
    capWinCache.clear(); clearTimeout(capWinTimer);
    try {
      let mw = 1920, mh = 1080;
      all.forEach((d) => { mw = Math.max(mw, Math.round(d.size.width * d.scaleFactor)); mh = Math.max(mh, Math.round(d.size.height * d.scaleFactor)); });
      const srcs = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: mw, height: mh } });
      srcs.forEach((w) => {
        if (!w.name || w.thumbnail.isEmpty() || CAP_SKIP.test(w.name)) return;
        const sz = w.thumbnail.getSize();
        if (sz.width < 60 || sz.height < 40) return;
        capWinCache.set(w.id, w.thumbnail);
        const small = sz.width > 480 ? w.thumbnail.resize({ width: 480, quality: 'good' }) : w.thumbnail;
        windows.push({ id: w.id, name: String(w.name).slice(0, 120), w: sz.width, h: sz.height, thumb: 'data:image/jpeg;base64,' + small.toJPEG(72).toString('base64') });
      });
      capWinTimer = setTimeout(() => capWinCache.clear(), 60000);
    } catch (_) {}
    return { screens, windows };
  });
});
ipcMain.handle('wm:capture-window', async (_e, id) => {
  const img = capWinCache.get(String(id));
  capWinCache.clear(); clearTimeout(capWinTimer);
  return img && !img.isEmpty() ? img.toDataURL() : '';
});
/* v13.494 웹 머리 줄의 창 단추 — 최소화 · 최대화/이전 크기 · 닫기(트레이로) */
ipcMain.on('wm:win', (e, a) => {
  if (!win || e.sender !== win.webContents) return;
  if (a === 'min') win.minimize();
  else if (a === 'max') { if (win.isFullScreen()) win.setFullScreen(false); else if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  else if (a === 'close') win.close();
});
ipcMain.handle('wm:winstate', (e) => (win && e.sender === win.webContents ? winState() : null));
/* v13.454 창 테두리 · 제목 줄 단추 색 — 웹 화면이 지금 테마의 머리 줄 색 · 글자 색 · 높이를 알려 줌 (v13.494 부터 기본 단추가 없어 바탕색만) */
ipcMain.on('wm:titlebar', (e, o) => {
  if (!win || e.sender !== win.webContents || process.platform !== 'win32' || !o) return;
  const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? v : d);
  try {
    win.setBackgroundColor(hex(o.color, '#0b1022'));
  } catch (_) {}
});
// 구글 로그인 — 앱 안 창은 구글이 '안전하지 않은 브라우저'로 막는다 → 기본 브라우저로
ipcMain.on('wm:google', () => { shell.openExternal(SERVER() + '/api/auth/google?app=desktop'); });
// 📸 화면 캡처 — 우리 창을 잠깐 숨기고, 마우스가 있는 화면을 원래 해상도로 찍는다 → 웹 화면이 잘라서 표시 · 보내기
ipcMain.handle('wm:capture', async () => {
  const { screen } = require('electron');
  const wasVisible = win && win.isVisible();
  try {
    if (wasVisible) { win.hide(); await new Promise((r) => setTimeout(r, 280)); }
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const s = srcs.find((x) => String(x.display_id) === String(d.id)) || srcs[0];
    return s ? s.thumbnail.toDataURL() : '';
  } finally {
    if (wasVisible) { win.show(); win.focus(); }
  }
});

/* ─── 🎤 발표 펜 투명 창 (v13.369) — 공유하는 모니터 전체 · 항상 위 · 화면 캡처에서 빠짐 · 도구가 꺼져 있으면 마우스는 아래로 ─── */
let inkWin = null;
const INK_KEYS = { 'Control+Alt+P': 'pen', 'Control+Alt+L': 'laser', 'Control+Alt+S': 'spot', 'Control+Alt+C': 'clear' };
function inkOpen(me) {
  if (inkWin && !inkWin.isDestroyed()) { inkWin.showInactive(); return; }
  const { screen } = require('electron');
  const d = screen.getAllDisplays().find((x) => String(x.id) === String(sharedDisplayId)) || screen.getPrimaryDisplay();
  inkWin = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, focusable: true, show: false, backgroundColor: '#00000000', title: '발표 펜',
    webPreferences: { preload: path.join(__dirname, 'ink-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  if (process.platform === 'darwin') inkWin.setAlwaysOnTop(true, 'screen-saver'); else inkWin.setAlwaysOnTop(true);   // v13.383 윈도우는 단계를 붙이면 맨 위가 풀림
  inkWin.setContentProtection(true);   // 화면 공유 · 캡처에 안 찍힘 (보는 쪽은 웹 층으로 봄)
  inkWin.setIgnoreMouseEvents(true, { forward: true });
  inkWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  inkWin.loadURL(SERVER() + '/ink-overlay?me=' + encodeURIComponent(me || '')).catch(() => {});   // 화면은 서버에서 — 고쳐도 다시 안 깔아도 됨
  // 윈도우는 처음 크기를 작업 영역(작업 표시줄 뺀 곳)으로 줄임 → 보여 준 뒤 화면 전체로 다시 (공유 영상과 좌표가 맞게)
  const fit = () => { if (inkWin && !inkWin.isDestroyed()) { inkWin.setBounds(d.bounds); if (inkWin.getBounds().height < d.bounds.height) inkWin.setSize(d.bounds.width, d.bounds.height); } };
  inkWin.once('ready-to-show', () => { if (inkWin) { inkWin.showInactive(); fit(); setTimeout(fit, 300); } });
  inkWin.on('closed', () => {
    inkWin = null;
    Object.keys(INK_KEYS).concat(['Control+Alt+X']).forEach((k) => { try { globalShortcut.unregister(k); } catch (_) {} });
    if (win && !win.isDestroyed()) win.webContents.send('wm:ink', { t: 'ovl-closed' });
  });
  Object.keys(INK_KEYS).forEach((k) => { try { globalShortcut.register(k, () => { if (inkWin) inkWin.webContents.send('wm:ink-cmd', INK_KEYS[k]); }); } catch (_) {} });
  try { globalShortcut.register('Control+Alt+X', inkClose); } catch (_) {}
}
function inkClose() { if (inkWin && !inkWin.isDestroyed()) inkWin.close(); }
ipcMain.on('wm:ink-open', (e, o) => { if (win && e.sender === win.webContents) inkOpen(o && o.me); });
ipcMain.on('wm:ink-close', (e) => { if ((win && e.sender === win.webContents) || (inkWin && e.sender === inkWin.webContents)) inkClose(); });
ipcMain.on('wm:ink', (e, m) => {   // 웹 화면 ↔ 투명 창 중계 (잉크 메시지만)
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
  if (win && e.sender === win.webContents) { if (inkWin && !inkWin.isDestroyed()) inkWin.webContents.send('wm:ink', m); }
  else if (inkWin && e.sender === inkWin.webContents) { if (win && !win.isDestroyed()) win.webContents.send('wm:ink', m); }
});
ipcMain.on('wm:ink-mouse', (e, o) => {   // 그리는 중 · 막대 위 = 잡음, 아니면 아래 프로그램으로
  if (!inkWin || e.sender !== inkWin.webContents) return;
  inkWin.setIgnoreMouseEvents(!(o && o.on), { forward: true });
  if (o && o.focus) inkWin.focus();
});

/* ─── 시작 ─── */
app.whenReady().then(() => {
  const ses = session.fromPartition('persist:wm');
  // 알림 · 마이크/카메라(화상) · 화면 공유 · 클립보드 — 우리 서버 화면에만
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    const ok = ['notifications', 'media', 'display-capture', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(perm);
    cb(ok && sameOrigin((details && details.requestingUrl) || wc.getURL()));
  });
  // 화면 공유(getDisplayMedia) — 주 화면을 바로 보냄
  ses.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => { sharedDisplayId = s[0] ? s[0].display_id : null; cb(s[0] ? { video: s[0] } : {}); }).catch(() => cb({}));
  });

  createWindow();
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWin()));
  refreshTray();

  // v13.382 잠자기에서 깨면 실시간 연결을 바로 다시 (죽은 연결로 통화 · 메시지를 놓치지 않게)
  const wake = () => { if (win) win.webContents.executeJavaScript("typeof _cxsRevive === 'function' && _cxsRevive(true)").catch(() => {}); };
  powerMonitor.on('resume', wake); powerMonitor.on('unlock-screen', wake);
  globalShortcut.register('CommandOrControl+Shift+M', () => (win.isVisible() && win.isFocused() ? win.hide() : showWin()));

  if (app.isPackaged) {
    setupUpdater();
    checkUpdate(false);
    setInterval(() => checkUpdate(false), 4 * 3600 * 1000);   // 4시간마다
  }
});

app.on('before-quit', () => { quitting = true; ctlStop(false); inkClose(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* 트레이에 남음 */ });
