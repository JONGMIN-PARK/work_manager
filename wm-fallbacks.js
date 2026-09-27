/* wm-fallbacks.js — config.js / settings.js / project-data.js / defer 렌더러 로드 실패 대비 폴백 스텁
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ config.js / settings.js 폴백 (file:// 프로토콜 등 외부 JS 로드 실패 대비) ═══ */
if(typeof TH==='undefined'){
  var TH=[{id:'auto',l:'시스템',c:'linear-gradient(135deg,#F4F5FB 50%,#0D1017 50%)'},{id:'light',l:'클라우드',c:'linear-gradient(135deg,#F4F5FB,#EBEEF6)'},{id:'midnight',l:'미드나잇',c:'linear-gradient(135deg,#0E1120,#141A3A)'},{id:'forest',l:'포레스트',c:'linear-gradient(135deg,#101C16,#182A22)'},{id:'sand',l:'웜샌드',c:'linear-gradient(135deg,#F6F2EA,#E8E0D2)'},{id:'rose',l:'로즈',c:'linear-gradient(135deg,#1C1018,#281422)'},{id:'slate',l:'슬레이트',c:'linear-gradient(135deg,#222428,#2A2C32)'},{id:'ocean',l:'오션',c:'linear-gradient(135deg,#0E1824,#102438)'},{id:'nord',l:'노르드',c:'linear-gradient(135deg,#353C4A,#434C5E)'},{id:'amethyst',l:'아메시스트',c:'linear-gradient(135deg,#161028,#201838)'},{id:'linear',l:'리니어',c:'linear-gradient(135deg,#08090B,#1A1B2B)'}];
}
if(typeof ENC==='undefined'){
  var ENC=['euc-kr','utf-8','cp949','shift_jis','iso-8859-1'];
  var COL=['#3B82F6','#EF4444','#10B981','#F59E0B','#8B5CF6','#EC4899','#06B6D4','#F97316','#6366F1','#14B8A6','#E11D48','#84CC16','#0EA5E9','#D946EF','#FB923C'];
  var AM={A:'A(CS현장)',B:'B(수주)',D:'D(개발)',G:'G(공통)',M:'M(양산)',R:'R(제안)',S:'S(영업지원)',V:'V(휴가)'};
  var ABG={A:'#7F1D1D',B:'#1E3A5F',D:'#14532D',G:'#3B2F5E',S:'#78350F',M:'#1A1F35',R:'#4A1942',V:'#065F46'};
  var AFG={A:'#FCA5A5',B:'#93C5FD',D:'#86EFAC',G:'#C4B5FD',S:'#FCD34D',M:'#94A3B8',R:'#F0ABFC',V:'#5EEAD4'};
  var ABR_DEFAULT={A:'#EF4444',B:'#3B82F6',D:'#22C55E',G:'#A855F7',S:'#F59E0B',M:'#64748B',R:'#EC4899',V:'#2DD4BF'};
  var ABR=Object.assign({},ABR_DEFAULT);
  function getABR(c){return ABR[c]||'#64748B'}
  var CMP_COL=['#3B82F6','#EF4444','#10B981','#F59E0B','#A855F7','#EC4899','#06B6D4','#F97316','#84CC16','#E11D48','#6366F1','#14B8A6'];
  var CMP_DASH=[[],[5,5],[10,5],[2,2],[8,4,2,4],[15,5],[4,8],[1,4],[6,2],[3,6],[10,2,2,2],[5,10]];
  var CMP_PT=['circle','rect','triangle','rectRot','crossRot','star','circle','rect','triangle','rectRot','cross','star'];
  var AI_CONFIG={gemini:{label:'Gemini',icon:'🟦',model:'gemini-2.5-flash',url:'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',keyPlaceholder:'AIzaSy...',keyLabel:'🔑 Gemini Key',keyLink:'https://aistudio.google.com/apikey',keyLinkText:'Google AI Studio에서 발급 →'},anthropic:{label:'Claude',icon:'🟧',model:'claude-sonnet-4-20250514',url:'https://api.anthropic.com/v1/messages',keyPlaceholder:'sk-ant-api03-...',keyLabel:'🔑 Claude Key',keyLink:'https://console.anthropic.com/settings/keys',keyLinkText:'Anthropic Console에서 발급 →'}};
  var DIFF_KEYWORDS=[{kw:['개발','구현','설계','아키텍처','리팩토링','알고리즘'],tag:'개발',w:3},{kw:['분석','파싱','디버깅','디버그','버그','오류','에러'],tag:'분석/디버깅',w:2},{kw:['test','테스트','검증','검수','점검'],tag:'테스트',w:1},{kw:['회의','미팅','협의','보고','검토'],tag:'회의/협의',w:0},{kw:['설치','세팅','setup','배포','이관'],tag:'설치/배포',w:1},{kw:['cam','scanner','calibration','cal','보정'],tag:'장비보정',w:2},{kw:['신규','new','신기능','추가개발'],tag:'신규개발',w:3},{kw:['유지보수','패치','수정','처리'],tag:'유지보수',w:1},{kw:['cs','현장','출장','방문'],tag:'CS현장',w:2}];
  var AI_PRESETS=[{label:'⚡과부하',text:'특정 인원의 업무 과부하 여부를 중점 분석해줘.'},{label:'📦수주별',text:'수주번호별 진행상황과 투입 리소스 관점에서 분석해줘.'},{label:'⚖️균형',text:'업무 분장 간 균형과 개선점을 분석해줘.'},{label:'📝주간보고',text:'주간 보고서 형태로 정리해줘. 핵심 성과, 이슈, 다음주 계획 포함.'},{label:'📊월간보고',text:'월간 보고 관점에서 누적 트렌드와 리소스 효율성을 분석해줘.'}];
  var PROJ_STATUS={waiting:{label:'대기',color:'#94A3B8',bg:'rgba(148,163,184,.15)',icon:'⏳'},active:{label:'진행중',color:'#3B82F6',bg:'rgba(59,130,246,.15)',icon:'🔄'},delayed:{label:'지연',color:'#EF4444',bg:'rgba(239,68,68,.15)',icon:'⚠️'},done:{label:'완료',color:'#10B981',bg:'rgba(16,185,129,.15)',icon:'✅'},hold:{label:'보류',color:'#F59E0B',bg:'rgba(245,158,11,.15)',icon:'⏸️'}};
  var EVT_TYPE={milestone:{label:'마일스톤',color:'#8B5CF6',icon:'◆'},meeting:{label:'회의',color:'#06B6D4',icon:'🤝'},deadline:{label:'납기',color:'#EF4444',icon:'🏁'},trip:{label:'출장',color:'#F97316',icon:'✈️'},dayoff:{label:'연차',color:'#10B981',icon:'🌴'},amoff:{label:'오전반차',color:'#14B8A6',icon:'🌅'},pmoff:{label:'오후반차',color:'#0D9488',icon:'🌇'},etc:{label:'기타',color:'#64748B',icon:'📌'}};
  console.warn('⚠️ config.js 로드 실패 → 인라인 폴백 사용');
}
/* showToast 폴백 (project-data.js 미로드 대비) */
if(typeof showToast!=='function'){window.showToast=function(msg,type){console.log('[Toast]',type||'info',msg)}}
if(typeof initSettings==='undefined'){
  window.aliasMap={};window.memberGroups=[];
  window.loadAliases=function(){};window.saveAliases=function(){};
  window.setAlias=function(){};window.getAlias=function(){return null};
  window.displayName=function(n){return n};window.shortName=function(n){return n};
  window.loadGroups=function(){};window.saveGroups=function(){};
  window.createGroup=function(){};window.updateGroup=function(){};window.deleteGroup=function(){};window.getGroup=function(){return null};
  window.renderAliasModal=function(){showToast('settings.js 로드 필요','error')};
  window.renderGroupModal=function(){showToast('settings.js 로드 필요','error')};
  window.renderGroupQuickButtons=function(){};window.updateGroupButtons=function(){};
  window.showBackupRestoreModal=function(){showToast('settings.js 로드 필요','error')};
  window.exportBackupJSON=function(){};window.importBackupJSON=function(){};
  window.renderAbbrColorModal=function(){showToast('settings.js 로드 필요','error')};
  window.initSettings=function(){};
  console.warn('⚠️ settings.js 로드 실패 → 스텁 폴백 사용');
}

if(typeof PROJ_PHASE==='undefined'){var PROJ_PHASE={order:{label:'수주',icon:'📋',color:'#6366F1',seq:1},design:{label:'설계',icon:'📐',color:'#8B5CF6',seq:2},manufacture:{label:'제작',icon:'🏭',color:'#3B82F6',seq:3},inspect:{label:'검수',icon:'🔍',color:'#06B6D4',seq:4},deliver:{label:'납품',icon:'🚚',color:'#10B981',seq:5},as:{label:'A/S',icon:'🛠️',color:'#F59E0B',seq:6}}}
if(typeof DEPT==='undefined'){var DEPT={design:{label:'설계',icon:'📐',color:'#8B5CF6'},manufacturing:{label:'제조',icon:'🏭',color:'#3B82F6'},electrical:{label:'전장',icon:'⚡',color:'#F59E0B'},control:{label:'제어',icon:'🎛️',color:'#06B6D4'},process:{label:'공정',icon:'⚙️',color:'#10B981'},software:{label:'소프트웨어',icon:'💻',color:'#EC4899'}}}
if(typeof ISSUE_TYPE==='undefined'){var ISSUE_TYPE={fault:{label:'장애',icon:'🔴',color:'#EF4444'},defect:{label:'불량',icon:'🟠',color:'#F97316'},change:{label:'설계변경',icon:'🔵',color:'#3B82F6'},performance:{label:'성능',icon:'🟡',color:'#F59E0B'},inquiry:{label:'문의',icon:'🟣',color:'#8B5CF6'},improve:{label:'개선',icon:'🟢',color:'#10B981'},periodic:{label:'정기점검',icon:'🔧',color:'#14B8A6'},etc:{label:'기타',icon:'⚪',color:'#64748B'}}}
if(typeof ISSUE_URGENCY==='undefined'){var ISSUE_URGENCY={urgent:{label:'긴급',icon:'🔴',color:'#EF4444'},normal:{label:'보통',icon:'🟡',color:'#F59E0B'},low:{label:'일반',icon:'🟢',color:'#10B981'}}}
if(typeof ISSUE_STATUS==='undefined'){var ISSUE_STATUS={open:{label:'접수',color:'#6366F1'},inProgress:{label:'대응중',color:'#3B82F6'},resolved:{label:'해결',color:'#10B981'},closed:{label:'종결',color:'#94A3B8'},hold:{label:'보류',color:'#F59E0B'}}}
if(typeof PROJ_STATUS==='undefined'){
  var PROJ_STATUS={waiting:{label:'대기',color:'#94A3B8',bg:'rgba(148,163,184,.15)',icon:'⏳'},active:{label:'진행중',color:'#3B82F6',bg:'rgba(59,130,246,.15)',icon:'🔄'},delayed:{label:'지연',color:'#EF4444',bg:'rgba(239,68,68,.15)',icon:'⚠️'},done:{label:'완료',color:'#10B981',bg:'rgba(16,185,129,.15)',icon:'✅'},hold:{label:'보류',color:'#F59E0B',bg:'rgba(245,158,11,.15)',icon:'⏸️'}};
  var EVT_TYPE={milestone:{label:'마일스톤',color:'#8B5CF6',icon:'◆'},meeting:{label:'회의',color:'#06B6D4',icon:'🤝'},deadline:{label:'납기',color:'#EF4444',icon:'🏁'},trip:{label:'출장',color:'#F97316',icon:'✈️'},dayoff:{label:'연차',color:'#10B981',icon:'🌴'},amoff:{label:'오전반차',color:'#14B8A6',icon:'🌅'},pmoff:{label:'오후반차',color:'#0D9488',icon:'🌇'},etc:{label:'기타',color:'#64748B',icon:'📌'}};
}
if(typeof SEM_COLOR==='undefined'){var SEM_COLOR={danger:'#EF4444',warn:'#F59E0B',ok:'#10B981',info:'#3B82F6',muted:'#94A3B8',purple:'#8B5CF6'};var stColor=function(st){return(PROJ_STATUS[st]||PROJ_STATUS.waiting).color};var stBg=function(st){return(PROJ_STATUS[st]||PROJ_STATUS.waiting).bg}}
if(typeof projGetAll==='undefined'){
  window.projGetAll=function(){return Promise.resolve([])};window.projGet=function(){return Promise.resolve(null)};window.projPut=function(p){return Promise.resolve(p)};window.projDel=function(){return Promise.resolve()};
  window.msGetAll=function(){return Promise.resolve([])};window.msGetByProject=function(){return Promise.resolve([])};window.msPut=function(m){return Promise.resolve(m)};window.msDel=function(){return Promise.resolve()};window.msDelByProject=function(){return Promise.resolve()};
  window.evtGetAll=function(){return Promise.resolve([])};window.evtGet=function(){return Promise.resolve(null)};window.evtPut=function(e){return Promise.resolve(e)};window.evtDel=function(){return Promise.resolve()};
  window.createProject=function(){return Promise.resolve({})};window.updateProject=function(){return Promise.resolve(null)};window.deleteProjectCascade=function(){return Promise.resolve()};
  window.createMilestone=function(){return Promise.resolve({})};window.createEvent=function(){return Promise.resolve({})};window.updateEvent=function(){return Promise.resolve(null)};
  window.autoProjectStatus=function(p){return p.status||'waiting'};window.uuid=function(){return Math.random().toString(36).slice(2)};
  window.daysDiff=function(a,b){return Math.round((new Date(b)-new Date(a))/86400000)};
  window.orderGetAll=function(){return Promise.resolve([])};window.orderGet=function(){return Promise.resolve(null)};window.orderPut=function(o){return Promise.resolve(o)};window.orderDel=function(){return Promise.resolve()};
  window.createOrder=function(){return Promise.resolve({})};window.deleteOrder=function(){return Promise.resolve()};window.syncOrderMapToDB=function(){return Promise.resolve()};window.loadOrdersToMap=function(){return Promise.resolve([])};window.createProjectFromOrder=function(){return Promise.resolve({})};
  window.chkPut=function(i){return Promise.resolve(i)};window.chkGetByProject=function(){return Promise.resolve([])};window.chkGetByPhase=function(){return Promise.resolve([])};window.chkDel=function(){return Promise.resolve()};window.chkDelByProject=function(){return Promise.resolve()};
  window.createCheckItem=function(){return Promise.resolve({})};window.toggleCheckItem=function(){return Promise.resolve(null)};window.calcPhaseProgress=function(){return Promise.resolve({total:0,done:0,pct:0})};
  window.createDefaultChecklists=function(){return Promise.resolve()};window.advancePhase=function(){return Promise.resolve(null)};window.executePhaseTransition=function(){return Promise.resolve(null)};
  window.DEFAULT_CHECKLIST={order:[],design:[],manufacture:[],inspect:[],deliver:[],as:[]};
  window.issueGetAll=function(){return Promise.resolve([])};window.issueGet=function(){return Promise.resolve(null)};window.issuePut=function(i){return Promise.resolve(i)};window.issueDel=function(){return Promise.resolve()};
  window.issueGetByProject=function(){return Promise.resolve([])};window.issueGetByOrder=function(){return Promise.resolve([])};
  window.createIssue=function(){return Promise.resolve({})};window.updateIssue=function(){return Promise.resolve(null)};window.deleteIssueCascade=function(){return Promise.resolve()};
  window.issueLogGetByIssue=function(){return Promise.resolve([])};window.issueLogPut=function(l){return Promise.resolve(l)};window.issueLogDel=function(){return Promise.resolve()};window.createIssueLog=function(){return Promise.resolve({})};
  console.warn('⚠️ project-data.js 로드 실패 → 스텁 폴백 사용');
}
// 렌더러는 defer 로드되므로 스텁 설치/경고는 DOMContentLoaded 시점으로 지연.
// defer 실패한 경우에만 실제로 스텁이 설치됨.
(function(){
  function _checkRendererFallbacks(){
    if(typeof initCalendar==='undefined'){window.initCalendar=function(){};window.renderCalendar=function(){};window.showEventModal=function(){};console.warn('⚠️ calendar.js 로드 실패')}
    if(typeof initTimeline==='undefined'){window.initTimeline=function(){};window.renderTimeline=function(){};window.showProjectModal=function(){};window.showProjectDetail=function(){};console.warn('⚠️ timeline.js 로드 실패')}
    if(typeof renderDashboard==='undefined'){window.renderDashboard=function(){};console.warn('⚠️ dashboard.js 로드 실패')}
    if(typeof renderPipeline==='undefined'){window.renderPipeline=function(){};console.warn('⚠️ pipeline.js 로드 실패')}
    if(typeof renderOrders==='undefined'){window.renderOrders=function(){};window.showOrderModal=function(){};console.warn('⚠️ order-view.js 로드 실패')}
    if(typeof renderIssues==='undefined'){window.renderIssues=function(){};window.showIssueModal=function(){};window.showIssueDetail=function(){};console.warn('⚠️ issue-manager.js 로드 실패')}
    if(typeof renderDocManager==='undefined'){window.renderDocManager=function(){};console.warn('⚠️ document-manager.js 로드 실패')}
    if(typeof renderAS==='undefined'){window.renderAS=function(){};window.showASModal=function(){};console.warn('⚠️ A/S 모듈(as-list.js 등) 로드 실패')}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',_checkRendererFallbacks);
  else _checkRendererFallbacks();
})();

