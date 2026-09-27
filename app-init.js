/* app-init.js — 로그인 후 초기화(_postAuthInit) · 부트스트랩 — 반드시 마지막에 로드
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ INIT ═══
 * _postAuthInit 실행 순서 (각 단계는 아래 _wmInit* 함수):
 *   ① _wmLoadOrderMap + _wmInitPrelude — 수주맵·설정·즐겨찾기·알림 뱃지 타이머(800/900ms)·약자·색상
 *   ② _wmListenLateAuth     — wm:auth-ready 리스너 (토큰이 늦게 와도 재시도)
 *   ③ _wmLoadFromServer     — 부트스트랩(_wmLoadBootstrap) → 실패 시 최근 60일(_wmLoadRecent60)
 *                              성공하면 800ms 뒤 60일 이전 히스토리(_wmScheduleHistoryLoad)
 *   ④ _wmWaitAuthAndLoad    — 토큰이 아직 없으면 500ms × 최대 60회 대기 후 ③ 재시도
 *   ⑤ _wmFinishLoading      — 로딩 표시 제거 / 데이터 없으면 업로드 영역
 *   ⑥ _wmBindUploadUI       — AI 프리셋·파일 입력·드래그앤드롭
 * 단계 사이에 공유하는 상태는 ctx = {dataLoaded, authReadyHandled, cutoff60} */
var _initDone=false;
// 서버 레코드 → camelCase
function _wmToCamel(row){if(!row)return row;var out={};for(var k in row){var ck=k.replace(/_([a-z])/g,function(m,c){return c.toUpperCase()});out[ck]=row[k]}return out}
// 레코드 정규화 (camelCase + hours/date 타입)
function _wmNormRec(r){
  var c=_wmToCamel(r);
  if(typeof c.hours==='string')c.hours=parseFloat(c.hours)||0;
  if(c.date&&typeof c.date==='string'&&c.date.length>8)c.date=c.date.replace(/[-\/]/g,'').slice(0,8);
  return c;
}
// ms 안에 끝나지 않으면 Error('timeout') 로 reject
function _wmWithTimeout(p,ms){
  return Promise.race([p,new Promise(function(_,rej){setTimeout(function(){rej(new Error('timeout'))},ms)})]);
}
// 오늘로부터 days 일 전 YYYYMMDD
function _wmCutoffYmd(days){
  var d=new Date();d.setDate(d.getDate()-days);
  return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
}
function _wmServerLoadAllowed(){return typeof apiFetch==='function'&&(typeof AUTH_SKIP==='undefined'||!AUTH_SKIP)}

/* ① 로그인 직후 준비 — 수주맵(loadOrdersToMap 이 있을 때만 await) 뒤 동기 초기화 */
async function _wmLoadOrderMap(){try{await loadOrdersToMap()}catch(ex){console.warn('loadOrdersToMap:',ex)}}
function _wmInitPrelude(){
  if(typeof initSettings==='function')initSettings();
  ldFvS();upFvB();
  // 알림 뱃지 초기화
  setTimeout(refreshNotifBadge, 800);
  setTimeout(function(){if(typeof refreshMsgBadge==='function')refreshMsgBadge();}, 900);
  var _fo=lsGet('wa-fav-only');if(_fo==='1'&&fvN.length>0){fvO=true;document.getElementById('favOnlyTog').checked=true}
  initAk();rEC();
}

/* 서버에서 받은 레코드를 화면에 주입 + 로딩 표시 제거. 호출부는 이어서 설정 동기화(_wmSyncSettings) */
function _wmApplyServerRecords(ctx,rows){
  aD=rows.map(_wmNormRec);
  applyADToUI();
  ctx.dataLoaded=true;
  var _iel=document.getElementById('initLoading');if(_iel)_iel.remove();
}
async function _wmSyncSettings(){try{await syncSettingsFromServer()}catch(settEx){console.warn('settings sync:',settEx)}}

/* 히스토리 로드 — 800ms 뒤 백그라운드로 60일 이전 레코드를 받아 aD 에 없는 id 만 추가. 초기 렌더를 방해하지 않음 */
function _wmScheduleHistoryLoad(ctx){
  setTimeout(function(){
    apiFetch('/api/archives/records?endDate='+ctx.cutoff60+'&limit=50000&all=true').then(function(_srvFull){
      if(!_srvFull||!_srvFull.data||!_srvFull.data.length)return;
      var existingIds={};aD.forEach(function(r){if(r.id)existingIds[r.id]=true;});
      var hist=_srvFull.data.map(_wmNormRec);
      var added=hist.filter(function(r){return r.id&&!existingIds[r.id];});
      if(!added.length)return;
      aD=aD.concat(added);
      applyADToUI();
      if(typeof console!=='undefined')console.info('[archive] 과거 '+added.length+'건 백그라운드 로드');
    }).catch(function(e){console.warn('[archive bg]',e);});
  },800);
}

/* 부트스트랩 — /api/bootstrap 한 번에 projects+milestones+events+최근 60일 아카이브. 성공 true / 실패 false */
async function _wmLoadBootstrap(ctx){
  try{
    var _bs=await _wmWithTimeout(apiFetch('/api/bootstrap?recentDays=60'),8000);
    if(!_bs||!_bs.archives||!Array.isArray(_bs.archives.data))return false;
    // 프로젝트/마일스톤/이벤트 캐시 프라이밍 (개별 API 호출 생략 가능)
    if(typeof _pdPrimeCache==='function')_pdPrimeCache(_bs.projects,_bs.milestones,_bs.events);
    // 아카이브(최근 60일) UI 주입
    _wmApplyServerRecords(ctx,_bs.archives.data);
    if(typeof syncSettingsFromServer==='function')await _wmSyncSettings();
    _wmScheduleHistoryLoad(ctx);
    return true;
  }catch(ex){console.warn('[bootstrap] 실패, 개별 API 폴백:',ex&&ex.message);return false}
}

/* 60일 로드 (부트스트랩 폴백) — 최근 60일만 먼저. 비어 있으면 전체 로드 (신규 유저/오래된 데이터만 있는 경우) */
async function _wmLoadRecent60(ctx){
  try{
    var _srvFast=await _wmWithTimeout(apiFetch('/api/archives/records?startDate='+ctx.cutoff60+'&limit=50000&all=true'),8000);
    if(_srvFast&&_srvFast.data&&_srvFast.data.length>0){
      _wmApplyServerRecords(ctx,_srvFast.data);
      if(typeof syncSettingsFromServer==='function')await _wmSyncSettings();
      _wmScheduleHistoryLoad(ctx);
    }else{
      var _srvAll=await _wmWithTimeout(apiFetch('/api/archives/records?limit=50000&all=true'),8000);
      if(_srvAll&&_srvAll.data&&_srvAll.data.length>0){
        _wmApplyServerRecords(ctx,_srvAll.data);
        if(typeof syncSettingsFromServer==='function')await _wmSyncSettings();
      }
    }
  }catch(ex){console.warn('auto-load server:',ex)}
}

/* ③ 서버 로드 — 부트스트랩 우선, 실패 시 60일 로드 */
async function _wmLoadFromServer(ctx){
  if(await _wmLoadBootstrap(ctx))return;
  await _wmLoadRecent60(ctx);
}

/* ② 인증 재시도 (a) — 토큰이 늦게 도착해도 데이터를 재시도 (Render Free 콜드 스타트 race 대비).
 * _tryRefresh 가 부트스트랩 10s 타임아웃 이후 늦게 성공해도 wm:auth-ready 이벤트로 신호 받아 재시도.
 * ctx.dataLoaded 체크로 중복 로드 안전 */
function _wmListenLateAuth(ctx){
  var _onAuthReady=function(){
    if(ctx.authReadyHandled)return; ctx.authReadyHandled=true;
    if(ctx.dataLoaded)return;
    if(_accessToken){_wmLoadFromServer(ctx).catch(function(e){console.warn('[late auth load]',e)})}
  };
  try{window.addEventListener('wm:auth-ready',_onAuthReady)}catch(_){}
}

/* ④ 인증 재시도 (b) — _accessToken 이 아직 없으면 최대 30초(500ms × 60) 대기 후 재시도 (Render Free 콜드 스타트 30~60s) */
function _wmNeedAuthWait(ctx){return !ctx.dataLoaded&&_wmServerLoadAllowed()&&!_accessToken}
async function _wmWaitAuthAndLoad(ctx){
  for(var _aw=0;_aw<60;_aw++){
    await new Promise(function(r){setTimeout(r,500)});
    if(_accessToken)break;
    if(ctx.dataLoaded)break; // wm:auth-ready 리스너가 이미 로드 시작했으면 중단
  }
  if(_accessToken&&!ctx.dataLoaded){ctx.authReadyHandled=true;await _wmLoadFromServer(ctx)}
}

/* ⑤ 로딩 마무리 */
function _wmFinishLoading(ctx){
  // 서버에서 못 받았어도 그사이 파일 업로드 등으로 aD 가 채워졌으면 로드된 것으로 취급
  if(!ctx.dataLoaded&&aD&&aD.length)ctx.dataLoaded=true;
  // 로딩 표시 제거, 데이터 없으면 업로드 영역 표시
  var _initLoadEl=document.getElementById('initLoading');
  if(_initLoadEl)_initLoadEl.remove();
  if(!ctx.dataLoaded){
    document.getElementById('uploadZone').classList.remove('hidden');
  }
}

/* ⑥ 업로드 UI 바인딩 */
function _wmBindUploadUI(){
  // AI 프리셋 버튼 렌더
  const presetEl=document.getElementById('aiPresetBtns');
  if(presetEl&&typeof AI_PRESETS!=='undefined'){presetEl.innerHTML=AI_PRESETS.map(p=>`<span class="chip co" style="padding:2px 8px;font-size:9px" onclick="addPre('${p.text.replace(/'/g,"\\'")}')">${p.label}</span>`).join('')}
  document.getElementById('fileInput').addEventListener('change',e=>{hFiles(e.target.files);e.target.value=''});
  document.getElementById('fileInput2').addEventListener('change',e=>{hFiles(e.target.files);e.target.value=''});
  const dz=document.getElementById('uploadZone');
  dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('active')});
  dz.addEventListener('dragleave',()=>dz.classList.remove('active'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('active');hFiles(e.dataTransfer.files)});
  // 본문 어디서든 파일 드래그앤드롭 가능 (v13.153: 내부 요소 드래그(파이프라인 카드 등)와 충돌 방지 —
  //   OS 파일 드래그(dataTransfer.types에 'Files')일 때만 오버레이 표시/처리)
  var _dragOverlay=null;
  function _dragHasFiles(e){var t=e&&e.dataTransfer&&e.dataTransfer.types;if(!t)return false;try{for(var i=0;i<t.length;i++){if(t[i]==='Files')return true;}}catch(_){}return !!(t.contains&&t.contains('Files'));}
  document.body.addEventListener('dragover',e=>{
    if(!_dragHasFiles(e))return;  // 내부 드래그(카드 순서변경 등)는 무시
    e.preventDefault();
    if(!_dragOverlay){_dragOverlay=document.createElement('div');_dragOverlay.id='dropOverlay';_dragOverlay.style.cssText='position:fixed;inset:0;z-index:9990;background:rgba(6,182,212,.12);border:3px dashed #06B6D4;display:flex;align-items:center;justify-content:center;pointer-events:none';_dragOverlay.innerHTML='<div style="font-size:16px;font-weight:700;color:#22D3EE;background:var(--bg-p);padding:16px 32px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.3)">📂 파일을 여기에 놓으세요</div>';document.body.appendChild(_dragOverlay)}
  });
  document.body.addEventListener('dragleave',e=>{if(e.relatedTarget===null&&_dragOverlay){_dragOverlay.remove();_dragOverlay=null}});
  document.body.addEventListener('drop',e=>{if(_dragOverlay){_dragOverlay.remove();_dragOverlay=null}if(!_dragHasFiles(e))return;e.preventDefault();if(e.dataTransfer.files.length)hFiles(e.dataTransfer.files)});
}

async function _postAuthInit(){
  if(_initDone)return;_initDone=true;
  if(typeof loadOrdersToMap==='function')await _wmLoadOrderMap();
  _wmInitPrelude();
  var ctx={dataLoaded:false,authReadyHandled:false,cutoff60:_wmCutoffYmd(60)};  // 최근 60일 기준 YYYYMMDD
  _wmListenLateAuth(ctx);
  // 1단계: 서버 API에서 전체 로드 (모든 기기에서 동일 데이터 보장)
  if(_wmServerLoadAllowed()&&_accessToken){
    await _wmLoadFromServer(ctx);
  }
  if(_wmNeedAuthWait(ctx))await _wmWaitAuthAndLoad(ctx);
  _wmFinishLoading(ctx);
  _wmBindUploadUI();
}

// 로그인 성공 후 콜백 — auth.js에서 호출
function onAuthReady(){_postAuthInit()}
// defer 스크립트 실행 완료 후 부트스트랩 (DOMContentLoaded 시점)
function _bootstrap(){
  (async()=>{
    var authOk=true;
    if(typeof authInit==='function'){
      try{
        authOk=await Promise.race([
          authInit(),
          new Promise(function(r){setTimeout(function(){r(false)},10000)})
        ]);
      }catch(e){console.warn('authInit err:',e);authOk=false}
    }
    await _postAuthInit();
    _initExcludeVacChk();
  })();
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',_bootstrap)}else{_bootstrap()}
