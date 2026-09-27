/* app-init.js — 로그인 후 초기화(_postAuthInit) · 부트스트랩 — 반드시 마지막에 로드
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ INIT ═══ */
var _initDone=false;
async function _postAuthInit(){
  if(_initDone)return;_initDone=true;
  if(typeof loadOrdersToMap==='function'){try{await loadOrdersToMap()}catch(ex){console.warn('loadOrdersToMap:',ex)}}
  if(typeof initSettings==='function')initSettings();
  ldFvS();upFvB();
  // 알림 뱃지 초기화
  setTimeout(refreshNotifBadge, 800);
  setTimeout(function(){if(typeof refreshMsgBadge==='function')refreshMsgBadge();}, 900);
  var _fo=lsGet('wa-fav-only');if(_fo==='1'&&fvN.length>0){fvO=true;document.getElementById('favOnlyTog').checked=true}
  initAk();rEC();
  // DB에 저장된 업무일지 자동 로드 — 서버 DB
  var _dataLoaded=false;
  var _toCamel=function(row){if(!row)return row;var out={};for(var k in row){var ck=k.replace(/_([a-z])/g,function(m,c){return c.toUpperCase()});out[ck]=row[k]}return out};
  // 레코드 정규화 (camelCase + hours/date 타입)
  var _normRec=function(r){
    var c=_toCamel(r);
    if(typeof c.hours==='string')c.hours=parseFloat(c.hours)||0;
    if(c.date&&typeof c.date==='string'&&c.date.length>8)c.date=c.date.replace(/[-\/]/g,'').slice(0,8);
    return c;
  };
  // 최근 60일 기준 YYYYMMDD
  var _today60=new Date();_today60.setDate(_today60.getDate()-60);
  var _cutoff60=_today60.getFullYear()+String(_today60.getMonth()+1).padStart(2,'0')+String(_today60.getDate()).padStart(2,'0');
  // 0차 시도: /api/bootstrap — projects+milestones+events+recent archives 번들
  var _tryBootstrap=async function(){
    try{
      var _bs=await Promise.race([
        apiFetch('/api/bootstrap?recentDays=60'),
        new Promise(function(_,rej){setTimeout(function(){rej(new Error('timeout'))},8000)})
      ]);
      if(!_bs||!_bs.archives||!Array.isArray(_bs.archives.data))return false;
      // 프로젝트/마일스톤/이벤트 캐시 프라이밍 (개별 API 호출 생략 가능)
      if(typeof _pdPrimeCache==='function')_pdPrimeCache(_bs.projects,_bs.milestones,_bs.events);
      // 아카이브(최근 60일) UI 주입
      aD=_bs.archives.data.map(_normRec);
      applyADToUI();
      _dataLoaded=true;
      var _ielB=document.getElementById('initLoading');if(_ielB)_ielB.remove();
      if(typeof syncSettingsFromServer==='function'){
        try{await syncSettingsFromServer()}catch(settEx){console.warn('settings sync:',settEx)}
      }
      // 2차 백그라운드: 60일 이전 히스토리
      setTimeout(function(){
        apiFetch('/api/archives/records?endDate='+_cutoff60+'&limit=50000&all=true').then(function(_srvFull){
          if(!_srvFull||!_srvFull.data||!_srvFull.data.length)return;
          var existingIds={};aD.forEach(function(r){if(r.id)existingIds[r.id]=true;});
          var hist=_srvFull.data.map(_normRec);
          var added=hist.filter(function(r){return r.id&&!existingIds[r.id];});
          if(!added.length)return;
          aD=aD.concat(added);applyADToUI();
          if(typeof console!=='undefined')console.info('[archive] 과거 '+added.length+'건 백그라운드 로드');
        }).catch(function(e){console.warn('[archive bg]',e);});
      },800);
      return true;
    }catch(ex){console.warn('[bootstrap] 실패, 개별 API 폴백:',ex&&ex.message);return false}
  };
  var _loadFromServer=async function(){
    // /api/bootstrap 경로 우선 시도
    if(await _tryBootstrap())return;
    try{
      // 1차: 최근 60일만 — 빠른 초기 렌더 (폴백)
      var _srvFast=await Promise.race([
        apiFetch('/api/archives/records?startDate='+_cutoff60+'&limit=50000&all=true'),
        new Promise(function(_,rej){setTimeout(function(){rej(new Error('timeout'))},8000)})
      ]);
      if(_srvFast&&_srvFast.data&&_srvFast.data.length>0){
        aD=_srvFast.data.map(_normRec);
        applyADToUI();
        _dataLoaded=true;
        var _iel=document.getElementById('initLoading');if(_iel)_iel.remove();
        if(typeof syncSettingsFromServer==='function'){
          try{await syncSettingsFromServer()}catch(settEx){console.warn('settings sync:',settEx)}
        }
        // 2차 백그라운드: 나머지 히스토리 (60일 이전). 지연 트리거로 초기 렌더 방해 없음.
        setTimeout(function(){
          apiFetch('/api/archives/records?endDate='+_cutoff60+'&limit=50000&all=true').then(function(_srvFull){
            if(!_srvFull||!_srvFull.data||!_srvFull.data.length)return;
            var existingIds={};aD.forEach(function(r){if(r.id)existingIds[r.id]=true;});
            var hist=_srvFull.data.map(_normRec);
            var added=hist.filter(function(r){return r.id&&!existingIds[r.id];});
            if(!added.length)return;
            aD=aD.concat(added);
            applyADToUI();
            if(typeof console!=='undefined')console.info('[archive] 과거 '+added.length+'건 백그라운드 로드');
          }).catch(function(e){console.warn('[archive bg]',e);});
        },800);
      }else{
        // 최근 60일 데이터가 없음 — 전체 로드 (신규 유저/오래된 데이터만 있는 경우)
        var _srvAll=await Promise.race([
          apiFetch('/api/archives/records?limit=50000&all=true'),
          new Promise(function(_,rej){setTimeout(function(){rej(new Error('timeout'))},8000)})
        ]);
        if(_srvAll&&_srvAll.data&&_srvAll.data.length>0){
          aD=_srvAll.data.map(_normRec);
          applyADToUI();
          _dataLoaded=true;
          var _iel2=document.getElementById('initLoading');if(_iel2)_iel2.remove();
          if(typeof syncSettingsFromServer==='function'){
            try{await syncSettingsFromServer()}catch(settEx){console.warn('settings sync:',settEx)}
          }
        }
      }
    }catch(ex){console.warn('auto-load server:',ex)}
  };
  // 1-c: 토큰이 늦게 도착해도 데이터를 재시도 — Render Free 콜드 스타트 race 대비
  // _tryRefresh가 부트스트랩 10s 타임아웃 이후 늦게 성공해도 wm:auth-ready 이벤트로 신호 받아 재시도.
  // _loadFromServer는 _dataLoaded 체크로 중복 로드 안전.
  var _authReadyHandled=false;
  var _onAuthReady=function(){
    if(_authReadyHandled)return; _authReadyHandled=true;
    if(_dataLoaded)return;
    if(_accessToken){_loadFromServer().catch(function(e){console.warn('[late auth load]',e)})}
  };
  try{window.addEventListener('wm:auth-ready',_onAuthReady)}catch(_){}
  // 1단계: 서버 API에서 전체 로드 (모든 기기에서 동일 데이터 보장)
  if(typeof apiFetch==='function'&&(typeof AUTH_SKIP==='undefined'||!AUTH_SKIP)&&_accessToken){
    await _loadFromServer();
  }
  // 1-b: 인증 지연 대비 — _accessToken이 아직 없으면 최대 30초 대기 후 재시도
  // (Render Free 플랜 콜드 스타트가 30~60s)
  if(!_dataLoaded&&typeof apiFetch==='function'&&(typeof AUTH_SKIP==='undefined'||!AUTH_SKIP)&&!_accessToken){
    for(var _aw=0;_aw<60;_aw++){
      await new Promise(function(r){setTimeout(r,500)});
      if(_accessToken)break;
      if(_dataLoaded)break; // wm:auth-ready 리스너가 이미 로드 시작했으면 중단
    }
    if(_accessToken&&!_dataLoaded){_authReadyHandled=true;await _loadFromServer()}
  }
  // 2단계: 서버에서 못 받았어도 그사이 파일 업로드 등으로 aD 가 채워졌으면 로드된 것으로 취급
  if(!_dataLoaded&&aD&&aD.length)_dataLoaded=true;
  // 로딩 표시 제거, 데이터 없으면 업로드 영역 표시
  var _initLoadEl=document.getElementById('initLoading');
  if(_initLoadEl)_initLoadEl.remove();
  if(!_dataLoaded){
    document.getElementById('uploadZone').classList.remove('hidden');
  }
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
