/* mode.js — 페이지/탭 라우팅(setPage/setMode) · 탭 렌더 캐시 · 즐겨찾기 · 패치노트 화면(데이터 patch-notes.js 는 지연 로드)
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ MODE ═══ */
let curMode='weekly';
var curPage='team';
/* 마지막 위치 기억 — 페이지 · 하위 탭을 옮길 때마다 저장하고, 다음 방문 때 데이터를 새로 받은 뒤 그 화면으로 들어간다 (wmRestoreLastView · app-init.js) */
var WM_LAST_VIEW='wm-last-view';
var _wmNavMoved=false;      // 시작 후 사용자가(또는 알림 링크 등이) 이미 화면을 옮겼으면 복원하지 않음
var _wmViewRestoring=false;
function _wmSaveView(){
  if(!_wmViewRestoring)_wmNavMoved=true;
  lsSetJSON(WM_LAST_VIEW,{page:curPage,mode:curMode});
}
function wmRestoreLastView(){
  if(_wmNavMoved)return;
  var v=lsGetJSON(WM_LAST_VIEW,null);
  if(v&&WM_TEAM_SUB[v.page])v={page:'team',mode:v.page};  // v13.280 전 저장값 — 업무 부하 · 주간 업무가 상위 탭이던 때
  if(!v||!v.page||(v.page==='team'&&(!v.mode||v.mode==='weekly')))return;  // 기본 화면이면 그대로
  var pb=document.querySelector('#pageTabs .tab[data-page="'+v.page+'"],.hdr [data-page="'+v.page+'"]');  // 메시지 · 패치노트는 헤더 (v13.287)
  if(!pb||pb.style.display==='none'||pb.classList.contains('hidden'))return;  // 지금 계정에 없는 탭 (권한)
  if(v.page==='team'&&v.mode&&WM_TEAM_SUB[v.mode]){var sb=document.querySelector('#modeTabs .tab[data-m="'+v.mode+'"]');if(!sb||sb.style.display==='none')return}  // 권한 없는 하위 탭
  if(v.page==='team'||v.page==='project'){
    // 하위 탭을 미리 골라 두면 setPage 가 그 탭 하나만 그린다 (기본 탭을 그렸다가 다시 그리지 않게). 운영자 권한은 setPage 가 확인
    var bar=document.getElementById(v.page==='team'?'modeTabs':'modeTabsProj');
    var mb=v.mode&&bar&&bar.querySelector('.tab[data-m="'+v.mode+'"]');
    if(mb)bar.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('on',t===mb)});
  }
  _wmViewRestoring=true;
  try{setPage(v.page)}finally{_wmViewRestoring=false}
  try{pb.scrollIntoView({block:'nearest',inline:'nearest'})}catch(_){}  // 휴대폰 — 가로로 밀리는 탭 줄에서 보이게
}
window.wmRestoreLastView=wmRestoreLastView;
/* v13.280 업무 관리(team) 하위 탭으로 옮긴 화면 — 예전 setPage('workload' · 'weekly_report') 도 그대로 동작 */
var WM_TEAM_SUB={workload:'mWorkload',weekly_report:'mWeeklyReport'};
/* 사용자 메뉴 ⚙️ 관리 › 운영자 — 하위 탭을 미리 골라 두고 들어가 프로젝트 첫 탭을 그렸다 다시 그리지 않게 (v13.288) */
function wmOpenOperator(){
  if(!(typeof isOperator==='function'&&isOperator()))return;
  document.querySelectorAll('#modeTabsProj .tab').forEach(function(t){t.classList.toggle('on',t.dataset.m==='operator')});
  setPage('project');
}
function wmCanSeePatchNotes(){return typeof currentUser!=='undefined'&&!!currentUser&&currentUser.role==='admin'}
function setPage(page){
  if(page==='patchnotes'&&!wmCanSeePatchNotes())return;  // 패치노트는 관리자만
  if(WM_TEAM_SUB[page]){  // 업무 관리 › 주간 업무 · 업무 부하
    document.querySelectorAll('#modeTabs .tab').forEach(function(t){t.classList.toggle('on',t.dataset.m===page)});
    page='team';
  }
  if(curPage==='mindmap'&&page!=='mindmap'&&typeof mmOnLeave==='function')mmOnLeave();  // 저장 마무리 · 편집 잠금 해제
  if(curPage==='mywork'&&page!=='mywork'&&typeof mwOnLeave==='function')mwOnLeave();  // 지금 상태 기억 — 다시 오면 그대로 (v13.286)
  if(curPage==='mywork'&&page!=='mywork'&&typeof mwPanelClose==='function')mwPanelClose();  // 내 업무 상세 패널 — 남은 저장 마저 하고 닫음 (다른 화면을 가리지 않게)
  curPage=page;
  document.querySelectorAll('#pageTabs .tab').forEach(function(t){var sel=t.dataset.page===page;t.classList.toggle('on',sel);t.setAttribute('aria-selected',sel)});
  document.querySelectorAll('.hdr [data-page]').forEach(function(t){t.classList.toggle('on',t.dataset.page===page)});  // 헤더 ✉️ · 📋 (v13.287)
  if(page!=='project'){var _opItem=document.getElementById('hdrOperatorItem');if(_opItem)_opItem.classList.remove('on')}
  document.getElementById('modeTabs').classList.toggle('hidden',page!=='team');
  document.getElementById('modeTabsProj').classList.toggle('hidden',page!=='project');
  // 모든 모드 숨기기
  ['mWeekly','mArchive','mTrend','mPipeline','mCalendar','mTimeline','mOrders','mPrestudy','mTech','mIssues','mDocs','mAs','mOperator','mUserAdmin','mWeeklyReport','mPatchNotes','mMessages','mMindmap','mMyWork','mWorkload'].forEach(function(id){var el=document.getElementById(id);if(el)el.classList.add('hidden')});
  // 해당 페이지의 첫 탭 활성화
  if(page==='useradmin'){
    document.getElementById('modeTabs').classList.add('hidden');
    document.getElementById('modeTabsProj').classList.add('hidden');
    var ua=document.getElementById('mUserAdmin');if(ua)ua.classList.remove('hidden');
    if(typeof renderUserAdmin==='function')renderUserAdmin();
  }else if(page==='patchnotes'){
    document.getElementById('modeTabs').classList.add('hidden');
    document.getElementById('modeTabsProj').classList.add('hidden');
    var pn=document.getElementById('mPatchNotes');if(pn)pn.classList.remove('hidden');
    renderPatchNotes();
  }else if(page==='mindmap'){
    document.getElementById('modeTabs').classList.add('hidden');
    document.getElementById('modeTabsProj').classList.add('hidden');
    var mmw=document.getElementById('mMindmap');if(mmw)mmw.classList.remove('hidden');
    if(typeof renderMindmap==='function')renderMindmap();
  }else if(page==='mywork'){
    document.getElementById('modeTabs').classList.add('hidden');
    document.getElementById('modeTabsProj').classList.add('hidden');
    var mwe=document.getElementById('mMyWork');if(mwe)mwe.classList.remove('hidden');
    if(typeof renderMyWork==='function')renderMyWork();
  }else if(page==='messages'){
    document.getElementById('modeTabs').classList.add('hidden');
    document.getElementById('modeTabsProj').classList.add('hidden');
    var mm=document.getElementById('mMessages');if(mm)mm.classList.remove('hidden');
    if(typeof renderMessages==='function')renderMessages();
  }else if(page==='team'){
    var activeTab=document.querySelector('#modeTabs .tab.on');
    var m=activeTab?activeTab.dataset.m:'weekly';
    if(WM_TEAM_SUB[m]&&activeTab.style.display==='none')m='weekly';  // 권한 없는 하위 탭이면 폴백
    setMode(m);
  }else{
    var activeTab=document.querySelector('#modeTabsProj .tab.on');
    var m=activeTab?activeTab.dataset.m:'pipeline';
    if(m==='operator'&&!(typeof isOperator==='function'&&isOperator()))m='pipeline';  // 권한 없으면 폴백
    setMode(m);
  }
  _wmSaveView();
}
/* v13.64: 탭 렌더 결과 메모리 캐시 — 한 번 그린 탭은 다시 진입해도 즉시 표시.
 * - _modeRendered[m] : 마지막 렌더 timestamp (없으면 첫 진입)
 * - mutation 발생 시 wmDataBus의 depMap 기반으로 의존 탭 캐시 자동 무효화
 * - TTL 5분 폴백 (시간 지나면 자동 새로고침)
 * - 화면 새로고침(F5) 시 자연 클리어 (전역 변수)
 * - mTrash·통계 등 동적 모드도 동일 적용
 */
var _modeRendered = window._modeRendered || {};
window._modeRendered = _modeRendered;
var _MODE_CACHE_TTL = 5 * 60 * 1000;
function _modeIsFresh(m){
  var ts = _modeRendered[m];
  return !!ts && (Date.now() - ts < _MODE_CACHE_TTL);
}
function _modeMarkRendered(m){ _modeRendered[m] = Date.now(); }
function refreshCurrentTab(){
  if(typeof curMode==='undefined' || !curMode) return;
  delete _modeRendered[curMode];
  setMode(curMode);
}
window.refreshCurrentTab = refreshCurrentTab;

// v13.251 모든 탭이 창 너비 전체를 쓴다 — 폭 캡(style.css .con · .hdr-in)을 없애 탭별 넓히기(_applyWideMode) 제거

function setMode(m){
  var prevMode = curMode;
  curMode=m;
  // 해당 페이지의 서브탭만 업데이트
  var teamModes=['weekly','archive','trend','weekly_report','workload'];
  var tabBar=teamModes.includes(m)?'#modeTabs':'#modeTabsProj';
  document.querySelectorAll(tabBar+' .tab').forEach(function(t){var sel=t.dataset.m===m;t.classList.toggle('on',sel);t.setAttribute('aria-selected',sel)});
  // 운영자 탭은 사용자 메뉴 ⚙️ 관리로 들어왔을 때만 보임 (v13.288) — 권한은 setPage 가 확인
  var _opTab=document.querySelector('#modeTabsProj .tab[data-m="operator"]');if(_opTab)_opTab.classList.toggle('hidden',m!=='operator');
  var _opItem=document.getElementById('hdrOperatorItem');if(_opItem)_opItem.classList.toggle('on',m==='operator'&&curPage==='project');
  ['mWeekly','mArchive','mTrend','mPipeline','mCalendar','mTimeline','mOrders','mPrestudy','mTech','mIssues','mDocs','mAs','mOperator','mUserAdmin','mWeeklyReport','mPatchNotes','mMessages','mMindmap','mWorkload'].forEach(function(id){var el=document.getElementById(id);if(el)el.classList.add('hidden')});
  var modeMap={weekly_report:'mWeeklyReport',workload:'mWorkload',weekly:'mWeekly',archive:'mArchive',trend:'mTrend',pipeline:'mPipeline',calendar:'mCalendar',timeline:'mTimeline',orders:'mOrders',prestudy:'mPrestudy',tech:'mTech',issues:'mIssues',docs:'mDocs',as:'mAs',operator:'mOperator'};
  var target=document.getElementById(modeMap[m]);if(target)target.classList.remove('hidden');
  _wmSaveView();
  // 주간 업무 · 업무 부하 — 예전 상위 탭 때처럼 들어올 때마다 새로 그림 (각자 불러오기 · 저장 충돌 확인)
  if(m==='weekly_report'){if(typeof renderWeeklyReportPage==='function')renderWeeklyReportPage();return}
  if(m==='workload'){if(typeof renderWorkload==='function')renderWorkload();return}

  // 캐시 hit이면 render 호출 자체를 스킵 → 이전 그려진 내용 즉시 표시
  if(_modeIsFresh(m)) return;

  // 캐시 miss / 만료 / dirty → 실제 render 호출 후 마킹
  var rendered = false;
  if(m==='archive'){renderArch();rendered=true}
  else if(m==='trend'){renderTrend();rendered=true}
  else if(m==='pipeline'&&typeof renderPipeline==='function'){renderPipeline();rendered=true}
  else if(m==='calendar'&&typeof initCalendar==='function'){initCalendar();rendered=true}
  else if(m==='timeline'&&typeof initTimeline==='function'){initTimeline();rendered=true}
  else if(m==='orders'&&typeof renderOrders==='function'){renderOrders();rendered=true}
  else if(m==='prestudy'&&typeof renderPrestudy==='function'){renderPrestudy();rendered=true}
  else if(m==='tech'&&typeof renderTech==='function'){renderTech();rendered=true}
  else if(m==='issues'&&typeof renderIssues==='function'){renderIssues();rendered=true}
  else if(m==='docs'&&typeof renderDocManager==='function'){renderDocManager();rendered=true}
  else if(m==='as'&&typeof renderAS==='function'){renderAS();rendered=true}
  else if(m==='operator'&&typeof renderOperator==='function'){renderOperator();rendered=true}
  if(rendered) _modeMarkRendered(m);
}

/* mutation 발생 시 의존 탭 캐시 자동 무효화 (wmDataBus '*' 리스너) */
(function(){
  if(typeof window==='undefined' || !window.wmDataBus) return;
  var invDepMap = window.WM_TAB_DEPS || {};  // core-bus.js — 자동 재렌더와 같은 맵
  window.wmDataBus.on('*', function (e) {
    Object.keys(invDepMap).forEach(function(mode){
      if(invDepMap[mode][e.type]){
        delete _modeRendered[mode];
        // 현재 활성 탭이면 즉시 재렌더 (기존 wmDataBus 자동 재렌더 흐름은 그대로 동작)
      }
    });
  });
})();

/* ═══ FAVORITES ═══ */
function ldFvS(){fvN=lsGetJSON('wa-fav-names',[]);return fvN.length>0}
function saveFav(){const s=[...sN];if(!s.length){showToast('먼저 팀원을 선택하세요.','warn');return}fvN=s;lsSetJSON('wa-fav-names',fvN);upFvB();rNC();showToast(`⭐ ${s.length}명 즐겨찾기 저장`)}
function loadFav(){if(!fvN.length)return;sN.clear();aN.forEach(n=>{if(fvN.includes(n))sN.add(n)});if(sN.size>1){multiSel=true;document.getElementById('multiSelTog').checked=true;document.getElementById('selAllBtn').classList.remove('hidden')}gfInvalidate();syncCmpVisibility();rNC();rFL();upV()}
function clearFav(){fvN=[];lsRemove('wa-fav-names');lsRemove('wa-fav-only');upFvB();document.getElementById('favOnlyTog').checked=false;fvO=false;vN=[...aN];rNC()}
function upFvB(){const h=fvN.length>0;document.getElementById('loadFavBtn').classList.toggle('hidden',!h);document.getElementById('clearFavBtn').classList.toggle('hidden',!h)}
function togFavOnly(){fvO=document.getElementById('favOnlyTog').checked;lsSet('wa-fav-only',fvO?'1':'0');if(fvO&&fvN.length>0){vN=aN.filter(n=>fvN.includes(n));sN.forEach(n=>{if(!fvN.includes(n))sN.delete(n)})}else{vN=[...aN]}gfInvalidate();rNC();rFL();upV()}

/* ═══ PATCH NOTES ═══ */
/* 패치노트 데이터(patch-notes.js, 수백 KB)는 첫 진입 때만 <script> 주입으로 불러온다 — 초기 로드 경량화. file:// 에서도 동작 */
var _patchNotesLoading=false;
function _loadPatchNotesData(el){
  if(_patchNotesLoading)return;
  _patchNotesLoading=true;
  el.innerHTML='<div style="text-align:center;color:var(--t6);padding:40px;font-size:12px">📋 패치노트 불러오는 중…</div>';
  var s=document.createElement('script');
  s.src='patch-notes.js?v='+encodeURIComponent(typeof WM_VERSION!=='undefined'?WM_VERSION:'0');
  function fail(){el.innerHTML='<div style="text-align:center;color:var(--t6);padding:40px;font-size:12px">⚠️ 패치노트를 불러오지 못했습니다 (patch-notes.js). 새로고침 후 다시 시도하세요.</div>'}
  s.onload=function(){_patchNotesLoading=false;if(typeof WM_PATCHES==='undefined'){fail();return}if(curPage==='patchnotes')renderPatchNotes()};
  s.onerror=function(){_patchNotesLoading=false;s.remove();fail()};
  document.head.appendChild(s);
}
function renderPatchNotes(){
  var el=document.getElementById('mPatchNotes');if(!el)return;
  if(typeof WM_PATCHES==='undefined'){_loadPatchNotesData(el);return}
  var PATCHES=WM_PATCHES;
  var tagStyle={
    major:'background:#7C3AED;color:#fff',
    feature:'background:#3B82F6;color:#fff',
    feat:'background:#3B82F6;color:#fff',
    perf:'background:#10B981;color:#fff',
    fix:'background:#F59E0B;color:#000',
    style:'background:#EC4899;color:#fff',
    refactor:'background:#06B6D4;color:#fff',
    initial:'background:#6B7280;color:#fff'
  };
  var tagLabel={major:'Major',feature:'Feature',feat:'Feature',perf:'Perf',fix:'Fix',style:'Style',refactor:'Refactor',initial:'Initial'};
  function _patchTagStyle(t){return tagStyle[t]||'background:#6B7280;color:#fff';}
  function _patchTagLabel(t){return tagLabel[t]||(t?String(t):'Update');}
  var html='<div style="padding:20px 0">';
  html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px"><h2 style="margin:0;font-size:20px;color:var(--t2)">📋 패치노트</h2><span style="font-size:12px;color:var(--t6)">현재 v'+PATCHES[0].ver+'</span></div>';
  PATCHES.forEach(function(p,i){
    var isLatest=i===0;
    html+='<div style="position:relative;padding-left:28px;margin-bottom:8px">';
    // timeline line
    html+='<div style="position:absolute;left:8px;top:0;bottom:0;width:2px;background:var(--bd)"></div>';
    // timeline dot
    html+='<div style="position:absolute;left:3px;top:18px;width:12px;height:12px;border-radius:50%;background:'+(isLatest?'var(--ac)':'var(--t6)')+';border:2px solid var(--bg)"></div>';
    // card
    html+='<div style="background:var(--bg-i);border:1px solid '+(isLatest?'var(--ac)':'var(--bd)')+';border-radius:10px;padding:16px 20px;margin-bottom:12px'+(isLatest?';box-shadow:0 0 12px rgba(99,102,241,.15)':'')+'">';
    // header
    html+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">';
    html+='<span style="font-size:18px;font-weight:700;color:var(--t2)">v'+p.ver+'</span>';
    html+='<span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;'+_patchTagStyle(p.tag)+'">'+_patchTagLabel(p.tag)+'</span>';
    if(isLatest)html+='<span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;background:'+SEM_COLOR.ok+';color:#fff">Latest</span>';
    html+='<span style="font-size:11px;color:var(--t6);margin-left:auto">'+p.date+'</span>';
    html+='</div>';
    // title — v13.42: 안전 escape (마찬가지로 < > 사고 방지)
    var safeTitle = String(p.title || '')
      .replace(/&(?!(amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html+='<div style="font-size:14px;font-weight:600;color:var(--t3);margin-bottom:8px">'+safeTitle+'</div>';
    // items
    html+='<ul style="margin:0;padding-left:18px;list-style:none">';
    p.items.forEach(function(item){
      // v13.42: 항목 텍스트 안의 < > 를 escape — 실수로 들어간 <style> 등이 실제 태그로 해석돼
      // 후속 패치노트 카드가 사라지는 사고 방지. 이미 escape된 &lt;/&gt;는 두 번 escape 안 함.
      var safe = String(item == null ? '' : item)
        .replace(/&(?!(amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html+='<li style="font-size:12px;color:var(--t4);line-height:1.8;position:relative;padding-left:4px"><span style="position:absolute;left:-14px;color:var(--ac)">›</span>'+safe+'</li>';
    });
    html+='</ul>';
    html+='</div></div>';
  });
  html+='</div>';
  el.innerHTML=html;
}

