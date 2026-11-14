// 🪟 제목 줄 · 창 단추 연기 시험 (v13.454 → v13.494): 실제 main.js 를 띄워
//   · 윈도우 기본 단추(titleBarOverlay)가 없고 웹 머리 줄 오른쪽 끝에 창 단추 3개가 있는지
//   · 최대화 ↔ 이전 크기(아이콘도 바뀜) · 최소화 · 닫기(트레이로 숨김)가 실제로 되는지
//   · 머리 줄 사진 (라이트 · 다크 테마) → desktop/scripts/.tb-*.png
//   npx electron scripts/tb-smoke.js --server=http://localhost:3000   → 'TB OK …'
const { app } = require('electron');
const fs = require('fs'), path = require('path');
require('../main.js');
let asked = false;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('did-finish-load', () => {
    const u = w.webContents.getURL();
    if (!/^https?:/.test(u) || asked) return;
    asked = true;
    setTimeout(async () => {
      const js = (s) => w.webContents.executeJavaScript(s);
      const fail = [];
      try {
        if (!w.isVisible()) w.show();
        await js(`(function(){var e=document.getElementById('loginEmail');if(e&&e.offsetParent){e.value='admin@t.com';document.getElementById('loginPw').value='Test1234!';e.form?e.form.requestSubmit?e.form.requestSubmit():e.form.submit():document.getElementById('loginPw').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}})()`).catch(() => {});
        await wait(5000);
        const r = JSON.parse(await js(`JSON.stringify({ wc: document.documentElement.classList.contains('wm-wc'), btns: document.querySelectorAll('#wmWc button').length,
          wco: window.navigator.windowControlsOverlay ? window.navigator.windowControlsOverlay.visible : null,
          right: (function(){var b=document.getElementById('wmWc');return b?Math.round(window.innerWidth-b.getBoundingClientRect().right):-1})(),
          color: (function(){var b=document.querySelector('#wmWc button');return b?getComputedStyle(b).color:''})(), text: getComputedStyle(document.body).color })`));
        if (!r.wc || r.btns !== 3) fail.push('창 단추 없음');
        if (r.wco) fail.push('윈도우 기본 단추가 아직 보임');
        if (r.right !== 0) fail.push('오른쪽 끝에 붙지 않음 ' + r.right);
        const shot = async (name) => { const img = await w.webContents.capturePage({ x: 0, y: 0, width: w.getContentBounds().width, height: 70 }); fs.writeFileSync(path.join(__dirname, '.tb-' + name + '.png'), img.toPNG()); };
        if (w.isMaximized()) w.unmaximize();
        await wait(500);
        await shot('light');
        await js(`document.documentElement.setAttribute('data-theme','dark')`); await wait(400); await shot('dark');
        // 최대화 → 아이콘 바뀜 → 이전 크기
        await js(`document.querySelector('#wmWc [data-a="max"]').click()`); await wait(800);
        const m1 = w.isMaximized(), ic1 = await js(`document.querySelector('#wmWc [data-a="max"]').title`);
        if (!m1 || ic1 !== '이전 크기로') fail.push('최대화 ' + m1 + ' ' + ic1);
        await shot('max');
        await js(`document.querySelector('#wmWc [data-a="max"]').click()`); await wait(800);
        const ic2 = await js(`document.querySelector('#wmWc [data-a="max"]').title`);
        if (w.isMaximized() || ic2 !== '최대화') fail.push('이전 크기 ' + ic2);
        // 최소화
        await js(`document.querySelector('#wmWc [data-a="min"]').click()`); await wait(800);
        if (!w.isMinimized()) fail.push('최소화 안 됨');
        w.restore(); await wait(500);
        // 닫기 → 트레이로 숨김 (앱은 그대로)
        await js(`document.querySelector('#wmWc [data-a="close"]').click()`); await wait(800);
        if (w.isVisible()) fail.push('닫기 → 숨김 안 됨');
        console.log((fail.length ? 'TB FAIL ' + fail.join(' · ') + ' ' : 'TB OK ') + JSON.stringify(r));
        app.exit(fail.length ? 1 : 0);
      } catch (e) { console.log('TB FAIL ' + (e && e.message)); app.exit(1); }
    }, 4000);
  });
});
setTimeout(() => { console.log('TB timeout'); app.exit(1); }, 120000);
