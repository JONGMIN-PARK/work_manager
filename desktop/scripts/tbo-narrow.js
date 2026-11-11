// 🪟 좁은 PC 창 — 오른쪽 위 창 단추(최소화 · 최대화 · 닫기)에 가려지는 것이 없는지 (v13.456)
//   npx electron scripts/tbo-narrow.js --server=http://localhost:3000 [--shots=폴더]   → 'TBN OK' / 'TBN FAIL …'
//   TBN_W=1250,1150 (폭) · TBN_V=home,messages (화면) · TBN_T=pearl (테마) 로 골라 돌릴 수 있음. v13.457 머리 줄로 올라간 대메뉴가 오른쪽 단추와 겹치는지(ovl)도 봄
//   여러 폭 × 여러 화면(머리 줄 · 메신저 · 프로젝트 상세 · 창)에서 눌러야 하는 것(단추 · 입력 · 링크)이 단추 자리와 겹치거나 머리 줄 밖으로 밀려나면 실패
const { app } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
app.setPath('userData', path.join(os.tmpdir(), 'wm-tbn-' + Date.now()));   // 깔려 있는 앱과 따로 (한 번만 실행 잠금)
const shotArg = process.argv.find((a) => a.startsWith('--shots='));
const SHOTS = shotArg ? shotArg.slice(8) : '';
require('../main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let started = false;
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('did-finish-load', () => {
    console.log('TBN url ' + w.webContents.getURL());
    if (started || !/^https?:/.test(w.webContents.getURL())) return;
    started = true;
    run(w).catch((e) => { console.log('TBN FAIL ' + (e && e.stack || e)); app.exit(1); });
  });
});
async function run(w) {
  const js = (s) => w.webContents.executeJavaScript(s);
  await wait(1500);
  await js(`(function(){var e=document.getElementById('loginEmail'),p=document.getElementById('loginPw');if(!e)return;e.value='admin@t.com';p.value='Test1234!';handleLogin();})()`);
  console.log('TBN login'); if(process.env.TBN_T) setTimeout(()=>js("aTh('"+process.env.TBN_T+"')").catch(()=>{}),4000);
  for (let i = 0; i < 60; i++) { if (await js(`!!(typeof currentUser!=='undefined'&&currentUser&&currentUser.id&&!document.getElementById('initLoading'))`)) break; await wait(500); }
  await wait(1200);
  // 가려진 것 찾기 — 창 단추 자리(오른쪽 위)와 겹치는, 눈에 보이고 누를 수 있는 것
  const PROBE = `(function(){
    var o=navigator.windowControlsOverlay, r=o&&o.visible?o.getTitlebarAreaRect():null; if(!r) return {err:'no overlay'};
    var bx=r.x+r.width, bh=r.height, W=innerWidth, bad=[], out=[];
    var els=document.querySelectorAll('button,a[href],a[onclick],input:not([type=hidden]),select,textarea,[onclick],[role=button],.hdr-ic');
    els.forEach(function(el){
      var b=el.getBoundingClientRect(); if(b.width<4||b.height<4) return;
      var cs=getComputedStyle(el); if(cs.visibility==='hidden'||+cs.opacity===0) return;
      var hit=document.elementFromPoint(Math.min(W-1,Math.max(0,b.left+b.width/2)),Math.min(innerHeight-1,Math.max(0,b.top+b.height/2)));
      if(!hit||!(el===hit||el.contains(hit)||hit.contains(el))) return;   // 다른 것에 덮인 것 제외
      var nm=(el.id?'#'+el.id:el.tagName.toLowerCase()+'.'+String(el.className||'').split(' ')[0])+' '+String(el.title||el.textContent||'').trim().slice(0,14);
      if(b.right>bx+1&&b.top<bh-1) bad.push(nm+' ['+Math.round(b.left)+'-'+Math.round(b.right)+','+Math.round(b.top)+']');
    });
    document.querySelectorAll('.hdr .hdr-ctl>*,.hdr .hdr-brand').forEach(function(el){ var b=el.getBoundingClientRect(); if(b.width>0&&(b.right>bx+1||b.left<0)) out.push((el.id||el.className)+' '+Math.round(b.left)+'-'+Math.round(b.right)); });
    var hd=document.querySelector('.hdr'),pt=document.getElementById('pageTabs');return {hdrH:hd.getBoundingClientRect().height,tabsIn:!!(pt&&pt.closest('.hdr')),tabsTop:pt&&pt.getBoundingClientRect().top,ovl:pt&&pt.closest('.hdr')?Math.round(pt.getBoundingClientRect().right-Math.min.apply(null,[].map.call(document.querySelector('.hdr-ctl').children,function(k){var q=k.getBoundingClientRect();return q.width>0?q.left:1e9}))):null,W:W, btn:W-bx, bh:bh, cssR:getComputedStyle(document.documentElement).getPropertyValue('--wm-tbo-r'), bad:bad, out:out};
  })()`;
  const ALL = {
    home: `setPage('mywork')`,
    messages: `setPage('messages')`,
    chatroom: `setPage('messages');(async function(){var r=await apiFetch('/api/chat/rooms',{method:'POST',body:JSON.stringify({kind:'self'})});chatOpenRoom(r.data.id)})()`,
    project: `setPage('project');(async function(){try{var r=await apiFetch('/api/projects');var l=(r.data&&(r.data.projects||r.data))||[];if(!l.length){await apiFetch('/api/projects',{method:'POST',body:JSON.stringify({name:'TBN 시험',status:'진행'})});r=await apiFetch('/api/projects');l=(r.data&&(r.data.projects||r.data))||[]}if(l[0]&&typeof showProjectDetail==='function')showProjectDetail(l[0].id)}catch(e){}})()`,
    modal: `wmHdrPopClose&&wmHdrPopClose();wmGuardedModal('profile',showProfileModal,'profName')`,
    notices: `typeof wmNoticeOpen==='function'&&wmNoticeOpen()`
  };
  const views = process.env.TBN_V ? Object.fromEntries(process.env.TBN_V.split(",").map(k=>[k,ALL[k]])) : ALL;
  const res = [];
  let fail = 0;
  for (const width of (process.env.TBN_W||"1600,1250,1150,1000,760,640,530,420").split(",").map(Number)) {
    w.setSize(width, 860); await wait(700);
    for (const [k, code] of Object.entries(views)) {
      await js(`(function(){try{document.querySelectorAll('.wa-modal-overlay').forEach(function(m){m.remove()});document.body.classList.remove('pd-open')}catch(e){}})()`);
      await js(`try{${code}}catch(e){}`); await wait(k === 'chatroom' || k === 'project' ? 1600 : 900);
      const r = await js(PROBE);
      console.log(JSON.stringify({hdrH:r.hdrH,tabsIn:r.tabsIn,tabsTop:r.tabsTop,ovl:r.ovl,bh:r.bh}));if(r.ovl>0)r.bad.push('tabs overlap '+r.ovl);const ok = !r.err && !r.bad.length && !r.out.length;
      if (!ok) fail++;
      console.log(width + ' ' + k + ' ' + (ok ? 'ok' : 'BAD ' + JSON.stringify(r))); res.push(width + ' ' + k + ' ' + (ok ? 'ok' : 'BAD ' + JSON.stringify(r)));
      if (SHOTS && (!ok || k === 'home' || k === 'project')) { fs.mkdirSync(SHOTS, { recursive: true }); const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, width + '-' + k + '.png'), img.toPNG()); }
      // 진짜 마우스로 눌러 봄 — 머리 줄 '끌기' 영역이 가로채지 않는지
      if (k === 'project' || k === 'home') {
        const sel = k === 'project' ? '.pd-panel .pd-sticky button[title^="닫기"]' : '#hdrLookWrap>.hdr-ic';
        const c = await js(`(function(){var b=document.querySelector('${sel}');if(!b||!b.offsetParent)return null;var r=b.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]})()`);
        if (c) {
          for (const type of ['mouseDown', 'mouseUp']) w.webContents.sendInputEvent({ type, x: c[0], y: c[1], button: 'left', clickCount: 1 });
          await wait(500);
          const done = await js(k === 'project' ? `!document.querySelector('.pd-panel.open,.pd-panel.show,body.pd-open .pd-panel')||!document.querySelector('.pd-panel').offsetParent` : `document.getElementById('hdrLookWrap').classList.contains('open')`);
          if (!done) fail++;
          console.log(width + ' ' + k + ' click ' + (done ? 'ok' : 'BAD'));
          await js(`try{wmHdrPopClose()}catch(e){}`);
        } else res.push(width + ' ' + k + ' click (없음)');
      }
    }
  }
  console.log(fail ? 'TBN FAIL ' + fail : 'TBN OK');
  app.exit(fail ? 1 : 0);
}
setTimeout(() => { console.log('TBN timeout'); app.exit(1); }, 600000);
