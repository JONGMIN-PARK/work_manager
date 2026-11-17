// 📝 애니웍스 공수 등록 연기 시험 (v13.512): 실제 main.js 를 띄워 진짜 애니웍스(works.animotion.co.kr)까지 가 본다.
//   · 웹 화면의 공수 등록 창 → PC 앱 다리(wmDesktop.aw) → 숨은 창 로그인 → 수주번호 조회 → 「① 웹에 입력」 → 캡처가 창에 보이는지
//   · 📥 주간일지 받기가 사업부 파일을 넘기는지
//   ⚠ [등 록] 은 누르지 않는다 — 애니웍스에 아무것도 올리지 않는다.
//   계정: AW_ID · AW_PW 환경변수, 또는 AW_SETTINGS=<{username,password} 가 든 JSON 파일>.  수주번호: AW_ORDER (기본 공통업무)
//   AW_ID=.. AW_PW=.. npx electron scripts/aw-smoke.js --server=http://localhost:3000   → 'AW OK …'
const { app } = require('electron');
const fs = require('fs'), path = require('path');
require('../main.js');
let asked = false;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function cred() {
  if (process.env.AW_ID && process.env.AW_PW) return { id: process.env.AW_ID, pw: process.env.AW_PW };
  try { const j = JSON.parse(fs.readFileSync(process.env.AW_SETTINGS, 'utf8')); return { id: j.username, pw: j.password }; } catch (_) { return null; }
}
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('did-finish-load', () => {
    const u = w.webContents.getURL();
    if (!/^https?:\/\/localhost|^https?:\/\/127\./.test(u) && !/onrender/.test(u)) return;
    if (asked || /works\.animotion/.test(u)) return;
    asked = true;
    setTimeout(async () => {
      const js = (s) => w.webContents.executeJavaScript(s, true);
      const until = async (s, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await js(s)) return true; } catch (_) {} await wait(250); } fail.push('시간 초과: ' + label); return false; };
      const fail = [], c = cred(), ORDER = process.env.AW_ORDER || '공통업무';
      const t0 = Date.now();
      try {
        if (!c) throw new Error('계정 없음 — AW_ID · AW_PW 또는 AW_SETTINGS');
        await js(`(function(){var e=document.getElementById('loginEmail');if(e&&e.offsetParent){e.value='admin@t.com';document.getElementById('loginPw').value='Test1234!';var f=e.form||e.closest('form');if(f&&f.requestSubmit)f.requestSubmit();else document.getElementById('loginPw').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}})()`);
        await until(`typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading') && typeof awgOpen === 'function'`, 60000, '로그인');
        if (!(await js(`!!(window.wmDesktop && typeof window.wmDesktop.aw === 'function')`))) throw new Error('다리(wmDesktop.aw) 없음');
        const s0 = await js(`window.wmDesktop.aw('status')`);
        if (!s0.ok || !s0.safe) fail.push('status ' + JSON.stringify(s0));
        const set = await js(`window.wmDesktop.aw('cred-set', ${JSON.stringify(c)})`);
        if (!set.ok || !set.hasCred) fail.push('cred-set ' + JSON.stringify(set));
        if (JSON.stringify(set).indexOf(c.pw) >= 0) fail.push('비밀번호가 웹 화면으로 돌아옴');

        // 공수 등록 창
        await js(`window.__wmDialogUi = true; awgOpen()`);
        await until(`!!document.querySelector('#awgBox .awg-r') && !!document.querySelector('[data-awg="fill"]')`, 15000, '공수 등록 창 · ① 단추');
        const chip = await js(`(document.querySelector('.awg-chip')||{}).textContent`);
        if (chip.indexOf(c.id) < 0) fail.push('계정 표시 ' + chip);
        // 🔍 수주번호 찾기 (진짜 애니웍스 조회)
        await js(`document.querySelector('.awg-r [data-awg="find"]').click()`);
        await until(`!!document.getElementById('awgFindQ')`, 5000, '찾기 창');
        await js(`document.getElementById('awgFindQ').value=${JSON.stringify(ORDER)};document.querySelector('#awgFindModal form').requestSubmit()`);
        await until(`document.querySelectorAll('.awg-find-row').length > 0`, 30000, '수주번호 조회 결과');
        const found = await js(`(function(){var r=[].filter.call(document.querySelectorAll('.awg-find-row'),function(b){return b.querySelector('b').textContent===${JSON.stringify(ORDER)}})[0];if(!r)return 0;r.click();return document.querySelectorAll('.awg-find-row').length||1})()`);
        if (!found) fail.push('조회 결과에 ' + ORDER + ' 없음');
        await until(`!document.getElementById('awgFindModal') && _awg.items[0].orderno === ${JSON.stringify(ORDER)}`, 5000, '고른 수주번호가 행에');
        await js(`(function(){var set=function(f,v){var el=document.querySelector('.awg-r[data-i="0"] [data-f="'+f+'"]');el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));};set('hours','1');set('job','공통');set('memo','연동 시험 (등록 안 함)');})()`);
        // ① 웹에 입력 — 진짜 애니웍스 화면에 넣고 캡처
        await js(`document.querySelector('[data-awg="fill"]').click()`);
        const ok = await until(`!!document.querySelector('.awg-cap img') || !!document.querySelector('.awg-msg.err')`, 60000, '웹에 입력');
        const st = await js(`({ img: (function(i){return i?[i.naturalWidth,i.naturalHeight]:null})(document.querySelector('.awg-cap img')), err: (document.querySelector('.awg-msg.err')||{}).textContent||'', send: !!document.querySelector('[data-awg="send"]') && !document.querySelector('[data-awg="send"]').disabled, ps: _awg.items[0].prodspec, dup: (_awg.dup||[]).length })`);
        if (!ok || !st.img || st.img[0] < 300 || !st.send) fail.push('웹에 입력 ' + JSON.stringify(st));
        fs.writeFileSync(path.join(__dirname, '.aw-fill.png'), (await w.webContents.capturePage()).toPNG());
        // ⚠ 등록은 누르지 않는다. 창을 닫고 초안도 지운다
        await js(`_awgFlush().then(function(){ return apiFetch('/api/gongsu/' + _awg.day, { method: 'DELETE' }); }).then(function(){ document.querySelector('#awgModal [data-wm-close]').click(); })`);
        await wait(600);
        // 📥 주간일지 받기
        await js(`window.__hf=null; window.hFiles=function(f){window.__hf=[].map.call(f,function(x){return x.name+':'+x.size});return Promise.resolve();}; awgPullOpen()`);
        await until(`!!document.getElementById('awgPullGo')`, 5000, '주간일지 받기 창');
        await js(`document.getElementById('awgPullGo').click()`);
        const got = await until(`!!window.__hf || /❌|없습니다/.test((document.getElementById('awgPullMsg')||{}).textContent||'')`, 60000, '주간일지 받기');
        const files = await js(`window.__hf`);
        if (!got || !files || !files.length) fail.push('주간일지 받기 ' + (await js(`(document.getElementById('awgPullMsg')||{}).textContent`)));
        const filled = await js(`window.wmDesktop.aw('status')`);
        if (filled.filled) fail.push('내려받은 뒤에도 입력 상태가 남음 (등록이 눌릴 수 있음)');
        console.log('AW ' + (fail.length ? 'FAIL ' + fail.join(' | ') : 'OK') + ' — ' + JSON.stringify({ sec: Math.round((Date.now() - t0) / 100) / 10, order: ORDER, prodspec: st.ps, capture: st.img, already: st.dup, files: files }));
      } catch (e) { console.log('AW FAIL ' + (e && e.message)); }
      finally {
        try { await js(`window.wmDesktop.aw('cred-clear')`); } catch (_) {}   // 시험 계정은 남기지 않는다
        app.exit(fail.length ? 1 : 0);
      }
    }, 2500);
  });
});
setTimeout(() => { console.log('AW FAIL 전체 시간 초과'); app.exit(1); }, 170000);
