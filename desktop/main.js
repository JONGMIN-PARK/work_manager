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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:wm', spellcheck: false, backgroundThrottling: false }   // v13.382 창을 숨겨 둬도 실시간 연결 · 통화 울림이 늦지 않게
  });
  if (st.max) win.maximize();
  if (readCfg().onTop) applyOnTop(true);   // v13.382 📌 항상 위
  // 창 안 단축키: Ctrl+Alt+T 📌 항상 위 켜기 · 끄기
  win.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.control && i.alt && !i.shift && (i.key === 't' || i.key === 'T')) { e.preventDefault(); setOnTop(!win.isAlwaysOnTop()); } });
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

/* ─── ⬆ 자동 업데이트 (v13.360) — GitHub Releases 의 latest.yml 을 보고 뒤에서 받아 두었다가, 끝낼 때 또는 트레이에서 바로 설치 ─── */
const upd = { busy: false, ready: null, pct: 0, manual: false };
function setupUpdater() {
  const au = require('electron-updater').autoUpdater;
  au.autoDownload = true; au.autoInstallOnAppQuit = true;
  au.on('update-available', (i) => { upd.busy = true; refreshTray(); if (upd.manual) toast('⬆ 새 버전 ' + i.version + ' 을 받는 중입니다'); });
  au.on('update-not-available', () => { upd.busy = false; refreshTray(); if (upd.manual) toast('✅ 최신 버전입니다 (' + app.getVersion() + ')'); upd.manual = false; });
  au.on('download-progress', (p) => { upd.pct = Math.round(p.percent || 0); refreshTray(); });
  au.on('update-downloaded', (i) => {
    upd.busy = false; upd.ready = i.version; refreshTray();
    const n = new Notification({ title: '⬆ 업무 관리자 ' + i.version + ' 준비됨', body: '누르면 바로 설치하고 다시 시작합니다 (그냥 두면 끝낼 때 설치)', icon: ICON });
    n.on('click', () => { quitting = true; ctlStop(false); au.quitAndInstall(true, true); });
    n.show();
  });
  au.on('error', (e) => { upd.busy = false; refreshTray(); if (upd.manual) toast('업데이트를 확인하지 못했습니다: ' + (e && e.message ? e.message.slice(0, 80) : '')); upd.manual = false; });
}
function checkUpdate(manual) {
  if (!app.isPackaged || upd.busy || upd.ready) { if (manual && upd.ready) toast('⬆ ' + upd.ready + ' 이 준비돼 있습니다 — 트레이 메뉴에서 설치'); return; }
  upd.manual = manual;
  try { require('electron-updater').autoUpdater.checkForUpdates().catch(() => {}); } catch (e) { console.warn('[update]', e.message); }
}
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
