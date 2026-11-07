/**
 * 웹 화면에 window.wmDesktop 다리를 놓는다 (wm-app.js 가 씀). 노드 기능은 넘기지 않는다.
 */
const { contextBridge, ipcRenderer } = require('electron');

// 작업 표시줄 아이콘 위 빨간 숫자 그림
function badgePng(n) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#EF4444'; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold ' + (n > 9 ? 14 : 19) + 'px "Segoe UI",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(n > 99 ? '99+' : String(n), 16, 17);
    return c.toDataURL('image/png');
  } catch (_) { return ''; }
}

contextBridge.exposeInMainWorld('wmDesktop', {
  isDesktop: true,
  platform: process.platform,
  notify: (o) => ipcRenderer.send('wm:notify', { title: o && o.title, body: o && o.body, go: o && o.go }),
  setBadge: (n) => { n = Math.max(0, n | 0); ipcRenderer.send('wm:badge', { n: n, png: n > 0 ? badgePng(n) : '' }); },
  onGo: (cb) => { ipcRenderer.on('wm:go', (_e, go) => { try { cb(go); } catch (_) {} }); },
  retry: () => ipcRenderer.send('wm:retry'),
  captureScreen: () => ipcRenderer.invoke('wm:capture'),
  googleLogin: () => ipcRenderer.send('wm:google'),
  remoteControl: (on) => ipcRenderer.send('wm:ctl', !!on),
  remoteInput: (ev) => { if (ev && typeof ev === 'object') ipcRenderer.send('wm:input', { t: String(ev.t || ''), x: +ev.x || 0, y: +ev.y || 0, b: ev.b | 0, dy: +ev.dy || 0, k: String(ev.k || '').slice(0, 30), s: String(ev.s || '').slice(0, 500) }); },
  onCtlStop: (cb) => { ipcRenderer.on('wm:ctl-stop', () => { try { cb(); } catch (_) {} }); },
  // 🎤 발표 펜 투명 창 (v13.369)
  inkOverlay: (o) => ipcRenderer.send('wm:ink-open', { me: String((o && o.me) || '').slice(0, 80) }),
  inkClose: () => ipcRenderer.send('wm:ink-close'),
  inkSend: (m) => { if (m && typeof m === 'object') ipcRenderer.send('wm:ink', m); },
  onInk: (cb) => { ipcRenderer.on('wm:ink', (_e, m) => { try { cb(m); } catch (_) {} }); }
});
