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

// 트레이 아이콘 + 빨간 숫자 (v13.401) — 16px · 32px 두 크기 (화면 배율마다 또렷하게)
let trayBase = null;
function trayPngs(n) {
  if (!trayBase) trayBase = ipcRenderer.invoke('wm:tray-base').catch(() => '');
  return trayBase.then((url) => new Promise((ok) => {
    if (!url) return ok(null);
    const img = new Image();
    img.onload = () => {
      const out = {};
      [16, 32].forEach((S) => {
        const c = document.createElement('canvas'); c.width = c.height = S;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, S, S);
        const t = n > 9 ? '9+' : String(n), r = S * (n > 9 ? 0.36 : 0.32), cx = S - r, cy = r;
        g.fillStyle = '#EF4444'; g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, S / 16);
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(r * (n > 9 ? 1.15 : 1.4)) + 'px "Segoe UI",sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, cx, cy + S / 32);
        out[S] = c.toDataURL('image/png');
      });
      ok(out);
    };
    img.onerror = () => ok(null);
    img.src = url;
  }));
}

contextBridge.exposeInMainWorld('wmDesktop', {
  isDesktop: true,
  titleBarOverlay: process.platform === 'win32',   // v13.454 제목 줄을 웹 머리 줄이 맡음 (드래그 영역 · 단추 색)
  setTitleBar: (o) => { if (o && typeof o === 'object') ipcRenderer.send('wm:titlebar', { color: String(o.color || ''), symbol: String(o.symbol || ''), h: +o.h || 0 }); },
  platform: process.platform,
  notify: (o) => ipcRenderer.send('wm:notify', { title: o && o.title, body: o && o.body, go: o && o.go, urgent: !!(o && o.urgent), tag: o && o.tag ? String(o.tag) : '' }),
  notifyClose: (tag) => ipcRenderer.send('wm:notify-close', String(tag || '')),
  setOnTop: (on) => ipcRenderer.send('wm:ontop-set', !!on),
  getOnTop: () => ipcRenderer.invoke('wm:ontop-get'),
  onOnTop: (cb) => { ipcRenderer.on('wm:ontop', (_e, on) => { try { cb(!!on); } catch (_) {} }); },
  setBadge: (n) => {
    n = Math.max(0, n | 0);
    ipcRenderer.send('wm:badge', { n: n, png: n > 0 ? badgePng(n) : '' });
    if (n > 0) trayPngs(n).then((p) => ipcRenderer.send('wm:tray-img', { n: n, p16: p && p[16], p32: p && p[32] })); else ipcRenderer.send('wm:tray-img', { n: 0 });
  },
  onGo: (cb) => { ipcRenderer.on('wm:go', (_e, go) => { try { cb(go); } catch (_) {} }); },
  retry: () => ipcRenderer.send('wm:retry'),
  captureScreen: () => ipcRenderer.invoke('wm:capture'),
  // v13.445 📸 모니터 여러 대 · 창 고르기
  captureSources: () => ipcRenderer.invoke('wm:capture-sources'),
  captureWindow: (id) => ipcRenderer.invoke('wm:capture-window', String(id || '')),
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
