/**
 * 업무 관리자 PC 앱 (Electron) — v13.355
 *   같은 서버 · 같은 DB 를 쓰는 창. 화면은 서버의 웹 화면 그대로(늘 최신), PC 앱은 이것만 더한다:
 *   트레이 상주 · 윈도우 알림 · 작업 표시줄 숫자/깜빡임 · Ctrl+Shift+M · 자동 실행 · 화면 공유 · 자동 업데이트
 *   서버 주소: --server=URL  >  환경변수 WM_SERVER  >  설정 파일(userData/config.json)  >  기본값
 */
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, shell, globalShortcut, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_SERVER = 'https://work-manager-ws3t.onrender.com';
const APP_ID = 'kr.co.animotion.workmanager';
const ICON = path.join(__dirname, 'build', 'icon.png');
const TRAY_ICON = path.join(__dirname, 'build', 'tray.png');

let win = null, tray = null, quitting = false, retryTimer = null, unread = 0;

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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:wm', spellcheck: false }
  });
  if (st.max) win.maximize();
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
}

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
    { label: '윈도우 시작할 때 실행', type: 'checkbox', checked: login, click: (m) => app.setLoginItemSettings({ openAtLogin: m.checked, args: ['--hidden'] }) },
    { label: '새로 고침', click: () => { showWin(); loadApp(); } },
    { label: '서버: ' + SERVER(), enabled: false },
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

/* ─── 웹 화면 ↔ 앱 ─── */
ipcMain.on('wm:notify', (_e, o) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: String(o.title || '업무 관리자').slice(0, 120), body: String(o.body || '').slice(0, 300), icon: ICON });
  n.on('click', () => showWin(o.go || ''));
  n.show();
  if (win && !win.isFocused()) win.flashFrame(true);
});
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
ipcMain.on('wm:retry', () => loadApp());
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
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb(s[0] ? { video: s[0] } : {})).catch(() => cb({}));
  });

  createWindow();
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWin()));
  refreshTray();

  globalShortcut.register('CommandOrControl+Shift+M', () => (win.isVisible() && win.isFocused() ? win.hide() : showWin()));

  if (app.isPackaged) {
    try { require('electron-updater').autoUpdater.checkForUpdatesAndNotify(); } catch (e) { console.warn('[update]', e.message); }
  }
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* 트레이에 남음 */ });
