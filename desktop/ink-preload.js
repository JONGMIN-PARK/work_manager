/**
 * 🎤 발표 펜 투명 창 다리 (v13.369) — 웹 화면(메인 창)과 잉크를 주고받고, 마우스를 잡을지(그리기) 흘릴지(아래 프로그램 조작) 알림.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wmInk', {
  send: (m) => { if (m && typeof m === 'object') ipcRenderer.send('wm:ink', m); },
  onMsg: (cb) => { ipcRenderer.on('wm:ink', (_e, m) => { try { cb(m); } catch (_) {} }); },
  onCmd: (cb) => { ipcRenderer.on('wm:ink-cmd', (_e, c) => { try { cb(String(c || '')); } catch (_) {} }); },
  mouse: (on, focus) => ipcRenderer.send('wm:ink-mouse', { on: !!on, focus: !!focus }),
  close: () => ipcRenderer.send('wm:ink-close')
});
