/* wr-filters.js — 주차 선택기 · 인원 칩 · 부서 버튼 · 수주/분장/부서 필터 · gF 필터 캐시
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ WEEK SELECTOR ═══ */
/* 일요일 시작 기준 주의 시작일 (YYYYMMDD) 구하기 */
function getSunStart(dateStr){
  const y=+dateStr.slice(0,4),m=+dateStr.slice(4,6)-1,d=+dateStr.slice(6,8);
  const dt=new Date(y,m,d);
  const day=dt.getDay(); // 0=일,1=월,...6=토
  dt.setDate(dt.getDate()-day);
  return String(dt.getFullYear())+String(dt.getMonth()+1).padStart(2,'0')+String(dt.getDate()).padStart(2,'0');
}
/* 날짜 문자열에서 토요일(주 마지막) 구하기 */
function getSatEnd(sunStartStr){
  const y=+sunStartStr.slice(0,4),m=+sunStartStr.slice(4,6)-1,d=+sunStartStr.slice(6,8);
  const dt=new Date(y,m,d+6);
  return String(dt.getFullYear())+String(dt.getMonth()+1).padStart(2,'0')+String(dt.getDate()).padStart(2,'0');
}
/* 오늘 날짜 YYYYMMDD */
function todayStr(){const d=new Date();return String(d.getFullYear())+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')}
/* aD에서 주차 목록 생성 (일요일 시작) */
function buildWeekList(){
  if(!aD.length)return[];
  const weekMap={};
  aD.forEach(function(r){
    const sun=getSunStart(r.date);
    if(!weekMap[sun])weekMap[sun]={start:sun,end:getSatEnd(sun),count:0};
    weekMap[sun].count++;
  });
  const weeks=Object.values(weekMap).sort(function(a,b){return b.start.localeCompare(a.start)}); // 최신순
  weeks.forEach(function(w){
    const s=w.start,e=w.end;
    w.label=fD(s)+' ~ '+fD(e);
  });
  return weeks;
}
/* 주차 선택기 렌더링 */
function renderWeekSelector(){
  const el=document.getElementById('weekSelectorChips');
  if(!el)return;
  const weeks=buildWeekList();
  // 연도 드롭다운 동적 생성
  const yearSet=new Set();
  weeks.forEach(function(w){yearSet.add(w.start.slice(0,4))});
  const years=Array.from(yearSet).sort().reverse();
  const ySel=document.getElementById('weekYearSel');
  if(ySel){
    const cv=weekYearFilter;
    ySel.innerHTML='<option value="">전체 연도</option>';
    years.forEach(function(y){ySel.innerHTML+='<option value="'+y+'"'+(cv===y?' selected':'')+'>'+y+'년</option>'});
  }
  // 연도 필터 먼저 적용
  var yearFiltered=weekYearFilter?weeks.filter(function(w){return w.start.slice(0,4)===weekYearFilter}):weeks;
  // 월 드롭다운 동적 생성 (선택된 연도 기준)
  const monthSet=new Set();
  yearFiltered.forEach(function(w){monthSet.add(w.start.slice(4,6))});
  const months=Array.from(monthSet).sort();
  const mSel=document.getElementById('weekMonthSel');
  if(mSel){
    const cv=weekMonthFilter;
    mSel.innerHTML='<option value="">전체 월</option>';
    months.forEach(function(m){mSel.innerHTML+='<option value="'+m+'"'+(cv===m?' selected':'')+'>'+m+'월</option>'});
  }
  // 월/분기 필터 적용
  var filtered=yearFiltered;
  if(weekQtrFilter){
    var qm={'1Q':['01','02','03'],'2Q':['04','05','06'],'3Q':['07','08','09'],'4Q':['10','11','12']};
    var mm=qm[weekQtrFilter]||[];
    filtered=yearFiltered.filter(function(w){return mm.indexOf(w.start.slice(4,6))>=0});
  }else if(weekMonthFilter){
    filtered=yearFiltered.filter(function(w){return w.start.slice(4,6)===weekMonthFilter});
  }
  const cntEl=document.getElementById('weekSelCount');
  if(cntEl){
    // 버튼에는 짧게 — 한 주면 'W15 · 04/12 ~ 04/18', 그 밖의 기간은 라벨 그대로
    var lab='전체 기간';
    if(selWeek){
      var one=selWeek.end===getSatEnd(selWeek.start);
      if(one){var s0=selWeek.start,dt0=new Date(+s0.slice(0,4),+s0.slice(4,6)-1,+s0.slice(6,8));lab='W'+String(getISOWeek(dt0)).padStart(2,'0')+' · '+s0.slice(4,6)+'/'+s0.slice(6,8)+' ~ '+selWeek.end.slice(4,6)+'/'+selWeek.end.slice(6,8)}
      else lab=selWeek.label;
    }
    cntEl.textContent=lab;
    cntEl.title=selWeek?selWeek.label:'모든 주';
  }
  if(!filtered.length){el.innerHTML='<div class="wq-empty">해당 기간 데이터 없음</div>';return}
  const today=todayStr();
  const todaySun=getSunStart(today);
  var maxC=filtered.reduce(function(m,w){return Math.max(m,w.count)},1);
  let html='<div class="wq-row'+(selWeek===null?' on':'')+'" role="option" onclick="pickWeek(null);wqClose()"><span class="wq-wk">전체</span><span class="wq-rg">모든 주</span><span class="wq-cnt">'+aD.length.toLocaleString()+'건</span></div>';
  var lastYM='';
  filtered.forEach(function(w){
    var ym=w.start.slice(0,6);
    if(ym!==lastYM){lastYM=ym;html+='<div class="wq-grp">'+ym.slice(0,4)+'년 '+(+ym.slice(4,6))+'월</div>'}
    const isSel=selWeek&&(selWeek.start===w.start||(w.start>=selWeek.start&&w.start<=selWeek.end));
    const isToday=w.start===todaySun;
    var dt=new Date(+w.start.slice(0,4),+w.start.slice(4,6)-1,+w.start.slice(6,8));
    html+='<div class="wq-row'+(isSel?' on':'')+(isToday?' today':'')+'" role="option" aria-selected="'+(!!isSel)+'" data-wk="'+w.start+'" onclick="pickWeek(\''+w.start+'\');wqClose()">'
      +'<span class="wq-wk">W'+String(getISOWeek(dt)).padStart(2,'0')+'</span>'
      +'<span class="wq-rg">'+w.start.slice(4,6)+'/'+w.start.slice(6,8)+' ~ '+w.end.slice(4,6)+'/'+w.end.slice(6,8)+(isToday?' <em>오늘</em>':'')+'</span>'
      +'<span class="wq-bar-s"><i style="width:'+Math.max(4,Math.round(w.count/maxC*100))+'%"></i></span>'
      +'<span class="wq-cnt">'+w.count.toLocaleString()+'건</span></div>';
  });
  el.innerHTML=html;
}
/* ◀ ▶ — 이전 · 다음 주 (dir 1 = 더 옛날). 전체 보기 중이면 가장 최근 주부터 */
function stepWeek(dir){
  var weeks=buildWeekList();if(!weeks.length)return;
  var i=selWeek?weeks.findIndex(function(w){return w.start===selWeek.start}):-1;
  var j=i<0?0:i+dir;
  if(j<0||j>=weeks.length){showToast(dir>0?'더 이전 주가 없습니다.':'가장 최근 주입니다.','warn');return}
  pickWeek(weeks[j].start);
}
/* 조회 조건 팝업 (주차 · 팀원) — 한 번에 하나, 바깥 클릭 · Esc 로 닫음 */
function wqToggle(id){
  var el=document.getElementById(id);if(!el)return;
  var open=!el.classList.contains('open');
  wqClose();
  if(!open)return;
  el.classList.add('open');
  if(id==='wqWeek'){var on=el.querySelector('.wq-row.on[data-wk]');if(on)on.scrollIntoView({block:'center'})}
  if(id==='wqName'){var f=document.getElementById('nameFind');if(f&&window.matchMedia&&matchMedia('(hover:hover)').matches)f.focus()}
}
function wqClose(){document.querySelectorAll('.wq-dd.open').forEach(function(d){d.classList.remove('open')})}
document.addEventListener('mousedown',function(e){if(!e.target.closest||e.target.closest('.wq-dd'))return;wqClose()});
document.addEventListener('keydown',function(e){if(e.key==='Escape')wqClose()});
/* 상세 필터 접기 · 펼치기 (기억) */
function wqFilterToggle(force){
  var box=document.getElementById('wqFilters'),btn=document.getElementById('wqFilterBtn');if(!box)return;
  var show=typeof force==='boolean'?force:box.classList.contains('hidden');
  box.classList.toggle('hidden',!show);
  if(btn){btn.classList.toggle('on',show);btn.setAttribute('aria-expanded',show)}
  try{localStorage.setItem('wm-wq-filters',show?'1':'0')}catch(e){}
}
(function(){function init(){try{if(localStorage.getItem('wm-wq-filters')==='1')wqFilterToggle(true)}catch(e){}}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init()})();
/* 기간 드롭다운으로 선택 (연도/분기/월) */
function pickPeriod(){
  renderWeekSelector();
  // 아무 필터도 없으면 전체
  if(!weekYearFilter&&!weekQtrFilter&&!weekMonthFilter){selWeek=null;gfInvalidate();if(aN.length)rNC();rFL();upV();return}
  var y=weekYearFilter||new Date().getFullYear().toString();
  var s,e;
  if(weekMonthFilter){
    // 특정 월
    var m=weekMonthFilter;
    s=y+m+'01';
    var last=new Date(+y,+m,0).getDate();
    e=y+m+String(last).padStart(2,'0');
  }else if(weekQtrFilter){
    var qr={'1Q':['01','03'],'2Q':['04','06'],'3Q':['07','09'],'4Q':['10','12']};
    var range=qr[weekQtrFilter];
    s=y+range[0]+'01';
    var last2=new Date(+y,+range[1],0).getDate();
    e=y+range[1]+String(last2).padStart(2,'0');
  }else{
    // 연도만
    s=y+'0101';e=y+'1231';
  }
  var label='';
  if(weekYearFilter)label+=y+'년 ';
  if(weekQtrFilter)label+=weekQtrFilter+' ';
  else if(weekMonthFilter)label+=weekMonthFilter+'월 ';
  selWeek={start:s,end:e,label:label.trim()};
  document.getElementById('weekLabel').value='';
  document.getElementById('weekAutoLabel').textContent='('+selWeek.label+')';
  renderWeekSelector();
  gfInvalidate();if(aN.length)rNC();rFL();upV();
}
/* 날짜 범위 직접 선택 */
function pickDateRange(){
  var fromEl=document.getElementById('dateRangeFrom');
  var toEl=document.getElementById('dateRangeTo');
  if(!fromEl.value||!toEl.value){showToast('시작일과 종료일을 모두 선택하세요.','warn');return}
  var s=fromEl.value.replace(/-/g,'');
  var e=toEl.value.replace(/-/g,'');
  if(s>e){showToast('시작일이 종료일보다 늦습니다.','warn');return}
  selWeek={start:s,end:e,label:fD(s)+' ~ '+fD(e)};
  document.getElementById('weekLabel').value='';
  document.getElementById('weekAutoLabel').textContent='('+selWeek.label+')';
  renderWeekSelector();
  gfInvalidate();if(aN.length)rNC();rFL();upV();
}
/* 주차 선택 */
function pickWeek(sunStart){
  if(sunStart===null){
    selWeek=null;
    try{localStorage.removeItem('wm-lastWeek')}catch(e){}
  }
  else{
    const end=getSatEnd(sunStart);
    selWeek={start:sunStart,end:end,label:fD(sunStart)+' ~ '+fD(end)};
    try{localStorage.setItem('wm-lastWeek',sunStart)}catch(e){}
  }
  renderWeekSelector();
  // 주차 라벨도 자동 갱신
  if(selWeek){
    const s=selWeek.start;
    const dt=new Date(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8));
    const wk=getISOWeek(dt);
    document.getElementById('weekLabel').value=s.slice(0,4)+'-W'+String(wk).padStart(2,'0');
    document.getElementById('weekAutoLabel').textContent='('+selWeek.label+')';
  }
  gfInvalidate();if(aN.length)rNC();rFL();upV();
}
/* applyADToUI 후 주차 선택기 초기화 — v13.60: 항상 한 주만 자동 선택 (성능)
 * 우선순위: ① localStorage에 저장된 마지막 선택 (해당 주가 데이터에 있을 때)
 *           ② 오늘이 속한 주
 *           ③ 데이터에서 가장 최근 주차 (오늘 주가 없을 때 — 전체 로드 폴백 제거)
 *           ④ 데이터 자체가 없으면 전체 (=null)
 * 사용자가 '전체'를 명시적으로 누르면 그 때만 selWeek=null 로 풀림.
 */
function initWeekSelector(){
  const weeks=buildWeekList();
  if(!weeks.length){selWeek=null;renderWeekSelector();return}
  // ⓪ v13.265 마지막으로 보던 기간 그대로 (전체 · 한 주 · 연도/분기/월 · 날짜 범위)
  var p=_wvPendWeek;_wvPendWeek=undefined;
  if(p===null){pickWeek(null);return}
  if(p&&p.start&&p.end){
    weekYearFilter=p.wy||'';weekQtrFilter=p.wq||'';weekMonthFilter=p.wm||'';
    var qs=document.getElementById('weekQtrSel');if(qs)qs.value=weekQtrFilter;
    if(p.end===getSatEnd(p.start)){if(weeks.find(function(w){return w.start===p.start})){pickWeek(p.start);return}}
    else{
      selWeek={start:p.start,end:p.end,label:p.label||(fD(p.start)+' ~ '+fD(p.end))};
      document.getElementById('weekLabel').value='';
      document.getElementById('weekAutoLabel').textContent='('+selWeek.label+')';
      renderWeekSelector();gfInvalidate();return;
    }
  }
  // ① 마지막 선택 복원
  try{
    var savedStart=localStorage.getItem('wm-lastWeek');
    if(savedStart && weeks.find(function(w){return w.start===savedStart})){
      pickWeek(savedStart); return;
    }
  }catch(e){}
  // ② 오늘 주
  const today=todayStr();
  const todaySun=getSunStart(today);
  const todayWeek=weeks.find(function(w){return w.start===todaySun});
  if(todayWeek){pickWeek(todayWeek.start);return}
  // ③ 데이터에서 가장 최근 주차 (weeks는 최신순으로 정렬됨)
  pickWeek(weeks[0].start);
}

/* ═══ v13.265 주간 분석 마지막 상태 — 주차 · 팀원 · 필터 · 검색 · 보기 탭 · 인원 비교를 사람별로 기억 ═══
 * 바뀔 때마다(gfInvalidate · sTab · togCompare) 0.3초 뒤 저장. 기록이 처음 들어올 때(applyADToUI) 한 번 되살림.
 * 되살리기 전에는 저장하지 않음 — 빈 초기 상태가 저장된 값을 덮지 않게. */
var _wvRestored=false,_wvSaveT=0,_wvPendWeek;
function _wvKey(){var u=typeof currentUser!=='undefined'&&currentUser&&currentUser.id;return'wm-wv-state'+(u?':'+u:'')}
function _wvLoad(){try{var o=JSON.parse(localStorage.getItem(_wvKey())||'null');return o&&o.v===1?o:null}catch(e){return null}}
function wvSave(){if(!_wvRestored)return;clearTimeout(_wvSaveT);_wvSaveT=setTimeout(_wvSaveNow,300)}
function _wvSaveNow(){
  if(!_wvRestored)return;
  var tab=document.querySelector('#statsS .tabs .tab.on');
  var wk=selWeek?{start:selWeek.start,end:selWeek.end,label:selWeek.label,wy:weekYearFilter,wq:weekQtrFilter,wm:weekMonthFilter}:null;
  var st={v:1,wk:wk,n:[...sN],o:[...sO],t:[...sT],on:[...sON],cl:[...sCL],dv:[...sDV],kw:cKw||'',tab:tab?tab.dataset.t:'tbl',cmp:!!cmpMode};
  try{localStorage.setItem(_wvKey(),JSON.stringify(st))}catch(e){}
}
/* applyADToUI 안에서 — 고른 팀원 · 필터 · 검색어 · 기간을 되살림. 지금 기록에 없는 값은 버림. 저장된 게 있으면 그 상태를 돌려줌 */
function wvRestoreSel(){
  var st=_wvLoad();if(!st)return null;
  var has=function(arr,set){return(arr||[]).filter(function(x){return set.has(x)})};
  var nS=new Set(aN);sN.clear();has(st.n,nS).forEach(function(n){sN.add(n)});
  var oS=new Set(),tS=new Set(),dS=new Set();aD.forEach(function(r){if(r.orderNo)oS.add(r.orderNo);if(r.abbr)tS.add(r.abbr);dS.add(r.dept||'(미지정)')});
  sO.clear();has(st.o,oS).forEach(function(x){sO.add(x)});
  sT.clear();has(st.t,tS).forEach(function(x){sT.add(x)});
  sDV.clear();has(st.dv,dS).forEach(function(x){sDV.add(x)});
  sON.clear();(st.on||[]).forEach(function(x){sON.add(x)});   // 수주명 · 거래처는 rFL 이 지금 범위에 없는 것을 걸러냄
  sCL.clear();(st.cl||[]).forEach(function(x){sCL.add(x)});
  cKw=st.kw||'';document.getElementById('cSearch').value=cKw;document.getElementById('sClear').classList.toggle('hidden',!cKw);
  _wvPendWeek=st.wk===null?null:(st.wk||undefined);
  gfInvalidate();
  return st;
}
/* 화면을 다 그린 뒤 — 보기 탭 · 인원 비교 */
function wvRestoreView(st){
  if(st){
    if(st.cmp&&sN.size>=2){var ct=document.getElementById('cmpTog');if(ct&&!ct.checked){ct.checked=true;togCompare()}}
    if(st.tab&&st.tab!=='tbl'&&document.querySelector('#statsS .tabs .tab[data-t="'+st.tab+'"]'))sTab(st.tab);
  }
  _wvRestored=true;
}
/* ═══ NAME CHIPS ═══ */
function rNC(){
  // 표시할 인원 목록 결정: 그룹 필터 > 즐겨찾기 필터 > 전체
  let list;
  if(typeof activeGroupId!=='undefined'&&activeGroupId){
    const g=typeof getGroup==='function'?getGroup(activeGroupId):null;
    list=g?aN.filter(n=>g.members.includes(n)):aN;
  }else if(fvO&&fvN.length>0){
    list=vN;
  }else{
    list=[...aN];
  }
  // 이름 찾기
  var q=((document.getElementById('nameFind')||{}).value||'').trim().toLowerCase();
  var shown=q?list.filter(function(n){var dn=typeof shortName==='function'?shortName(n):n;return n.toLowerCase().indexOf(q)>=0||String(dn).toLowerCase().indexOf(q)>=0}):list;
  // 지금 기간의 사람별 건수 · 시간 — 누가 기록이 있는지 한눈에
  var stat={};
  aD.forEach(function(r){if(selWeek&&(r.date<selWeek.start||r.date>selWeek.end))return;var o=stat[r.name]||(stat[r.name]={c:0,h:0});o.c++;o.h+=r.hours||0});
  var rowFn=function(name){const i=aN.indexOf(name),on=sN.has(name),c=COL[i%COL.length],f=fvN.includes(name);const dn=typeof shortName==='function'?shortName(name):name;const hasAlias=typeof getAlias==='function'&&getAlias(name);const st=stat[name];
    return '<div class="wq-row wq-nm'+(on?' on':'')+(st?'':' none')+'" role="option" aria-selected="'+on+'" onclick="togN('+i+')" title="'+eH(name)+'">'
      +'<span class="wq-cb" style="'+(on?'background:'+c+';border-color:'+c:'')+'"></span>'
      +'<span class="dot" style="background:'+c+'"></span>'
      +'<span class="wq-nmt">'+(f?'⭐':'')+eH(hasAlias?dn:name)+(hasAlias&&dn!==name?' <em>'+eH(name)+'</em>':'')+'</span>'
      +'<span class="wq-cnt">'+(st?(Math.round(st.h*10)/10)+'h · '+st.c+'건':'기록 없음')+'</span>'
      +'<button class="wq-only" type="button" onclick="event.stopPropagation();togOnly('+i+')" title="이 사람만">만</button></div>'};
  var dm=getDeptMembers();var deptKeys=Object.keys(dm).sort(function(a,b){return a.localeCompare(b,'ko')});
  var html='';
  if(deptKeys.length>=2){
    var assigned=new Set();
    deptKeys.forEach(function(d){
      var members=shown.filter(function(n){return dm[d]&&dm[d].has(n)&&!assigned.has(n)});
      if(!members.length)return;
      members.forEach(function(n){assigned.add(n)});
      html+='<div class="wq-grp">'+eH(d)+'</div>'+members.map(rowFn).join('');
    });
    var unassigned=shown.filter(function(n){return!assigned.has(n)});
    if(unassigned.length)html+='<div class="wq-grp">미지정</div>'+unassigned.map(rowFn).join('');
  }else{
    html=shown.map(rowFn).join('');
  }
  if(!html)html='<div class="wq-empty">'+(q?'"'+eH(q)+'" 없음':'팀원 없음')+'</div>';
  document.getElementById('nameChips').innerHTML=html;
  const sc=[...sN].filter(n=>list.includes(n)).length;
  document.getElementById('nameCount').textContent=sc?sc+'/'+list.length:'';
  // 버튼 요약 · 아래 고른 사람 태그 (× 로 빼기)
  var sel=aN.filter(function(n){return sN.has(n)});
  var nm=function(n){return typeof shortName==='function'?shortName(n):n};
  var sum=document.getElementById('nameSum');
  if(sum){sum.textContent=!sel.length?'선택 안 함':sel.length===aN.length?'전원':sel.length<=2?sel.map(nm).join(', '):nm(sel[0])+', '+nm(sel[1])+' 외 '+(sel.length-2)+'명';sum.title=sel.map(nm).join(', ')}
  var ns=document.getElementById('nameSel');
  if(ns){
    var MAX=12;
    ns.innerHTML=sel.slice(0,MAX).map(function(n){var i=aN.indexOf(n),c=COL[i%COL.length];return'<span class="ft wq-nt" style="border-color:'+c+'"><span class="dot" style="background:'+c+'"></span>'+eH(nm(n))+'<span class="tx" onclick="togN('+i+')" title="빼기">&times;</span></span>'}).join('')
      +(sel.length>MAX?'<span class="ft wq-more" onclick="wqToggle(\'wqName\')">+'+(sel.length-MAX)+'명</span>':'')
      +(!sel.length&&aN.length?'<span class="wq-hint" onclick="wqToggle(\'wqName\')">👤 팀원을 고르면 기록이 보입니다</span>':'');
  }
  if(typeof updateGroupButtons==='function')updateGroupButtons();
  renderDeptBtns();
}
let multiSel=true;   // v13.264 팀원 목록은 체크 목록 — 늘 여러 명 (한 명만은 줄의 '만')
let cmpMode=false;
/* compare vars declared in COMPARE section */
function togMultiSel(){multiSel=document.getElementById('multiSelTog').checked;document.getElementById('selAllBtn').classList.toggle('hidden',!multiSel);if(!multiSel){cmpMode=false;document.getElementById('cmpTog').checked=false;document.getElementById('cmpPanel').classList.add('hidden');document.getElementById('cmpLabel').classList.add('hidden')}}
function togCompare(){cmpMode=document.getElementById('cmpTog').checked;upV();wvSave()}
function syncCmpVisibility(){
  const cnt=sN.size;
  // 2명 이상이면 다중선택 + 인원비교 체크박스 자동 표시
  if(cnt>=2){
    if(!multiSel){multiSel=true;document.getElementById('multiSelTog').checked=true;document.getElementById('selAllBtn').classList.remove('hidden')}
    document.getElementById('cmpLabel').classList.remove('hidden');
  }else{
    document.getElementById('cmpLabel').classList.add('hidden');
    if(cmpMode){cmpMode=false;document.getElementById('cmpTog').checked=false;document.getElementById('cmpPanel').classList.add('hidden')}
  }
}
function togN(i){const n=aN[i];if(multiSel){sN.has(n)?sN.delete(n):sN.add(n)}else{const wasOnly=sN.size===1&&sN.has(n);sN.clear();if(!wasOnly)sN.add(n)}gfInvalidate();syncCmpVisibility();rNC();rFL();upOP();upVD()}
function togOnly(i){sN.clear();sN.add(aN[i]);gfInvalidate();syncCmpVisibility();rNC();rFL();upOP();upVD()}
function selAll(){const l=getVisibleNames();l.forEach(n=>sN.add(n));gfInvalidate();syncCmpVisibility();rNC();rFL();upOP();upVD()}
function getVisibleNames(){if(typeof activeGroupId!=='undefined'&&activeGroupId){const g=typeof getGroup==='function'?getGroup(activeGroupId):null;return g?aN.filter(n=>g.members.includes(n)):aN}return fvO&&fvN.length>0?vN:[...aN]}
function deAll(){sN.clear();gfInvalidate();syncCmpVisibility();rNC();rFL();upOP();upVD()}

/* 사업부별 인원 매핑 */
function getDeptMembers(){
  var dm={};
  aD.forEach(function(r){
    var d=r.dept||'';if(!d)return;
    if(!dm[d])dm[d]=new Set();
    dm[d].add(r.name);
  });
  return dm;
}
var _activeDept='';
function renderDeptBtns(){
  var dm=getDeptMembers();
  var depts=Object.keys(dm).sort(function(a,b){return a.localeCompare(b,'ko')});
  var el=document.getElementById('deptQuickBtns');
  if(!el)return;
  if(depts.length<2){el.innerHTML='';return}
  el.innerHTML='<span style="font-size:10px;color:var(--t5);font-weight:600;padding:3px 0">🏢</span>'+
    '<button class="btn '+(!_activeDept?'btn-p':'btn-g')+' btn-s" onclick="selDept(\'\')">전체</button>'+
    depts.map(function(d){
      var cnt=dm[d].size;
      var active=_activeDept===d;
      return'<button class="btn '+(active?'btn-p':'btn-g')+' btn-s" onclick="selDept(\''+eA(d)+'\')">'+eH(d)+' <span style="font-size:9px;opacity:.7">('+cnt+')</span></button>';
    }).join('');
}
function selDept(d){
  _activeDept=d;
  if(!d){
    // 전체: 사업부 필터 해제, 모든 인원 표시
    vN=[...aN];
    sN.clear();
    aN.forEach(function(n){sN.add(n)});
  }else{
    var dm=getDeptMembers();
    var members=dm[d]?[...dm[d]]:[];
    // 다중선택 모드 활성화
    if(!multiSel){multiSel=true;document.getElementById('multiSelTog').checked=true;document.getElementById('selAllBtn').classList.remove('hidden')}
    sN.clear();
    members.forEach(function(n){if(aN.includes(n))sN.add(n)});
  }
  gfInvalidate();syncCmpVisibility();renderDeptBtns();rNC();rFL();upOP();upVD();
}

/* ═══ FILTERS ═══ */
function rFL(){
  let b=sN.size===0?[]:aD.filter(r=>sN.has(r.name));
  if(selWeek)b=b.filter(r=>r.date>=selWeek.start&&r.date<=selWeek.end);
  const om={},tm={},onm={},clm={},dvm={};
  b.forEach(function(r){
    om[r.orderNo]=(om[r.orderNo]||0)+1;
    tm[r.abbr]=(tm[r.abbr]||0)+1;
    var on=(r.ocmt||getOCmt(r.orderNo)||'(미지정)');
    onm[on]=(onm[on]||0)+1;
    var cl=(r.oclient||getOClient(r.orderNo)||'(미지정)');
    clm[cl]=(clm[cl]||0)+1;
    var dv=r.dept||'(미지정)';
    dvm[dv]=(dvm[dv]||0)+1
  });
  avO=Object.entries(om).sort(([a],[b])=>a.localeCompare(b));
  avT=Object.entries(tm).sort(([a],[b])=>a.localeCompare(b));
  avON=Object.entries(onm).sort(([a],[b])=>a.localeCompare(b,'ko'));
  avCL=Object.entries(clm).sort(([a],[b])=>a.localeCompare(b,'ko'));
  avDV=Object.entries(dvm).sort(([a],[b])=>a.localeCompare(b,'ko'));
  sO.forEach(o=>{if(!om[o])sO.delete(o)});
  sT.forEach(t=>{if(!tm[t])sT.delete(t)});
  sON.forEach(n=>{if(!onm[n])sON.delete(n)});
  sCL.forEach(c=>{if(!clm[c])sCL.delete(c)});
  sDV.forEach(d=>{if(!dvm[d])sDV.delete(d)});
  gfInvalidate();rOL();rTL();rONL();rCLL();rDVL()
}
function rOL(){const q=(document.getElementById('oSearch')||{}).value||'';const ql=q.toLowerCase();const filtered=q?avO.filter(([o])=>{const cmt=getOCmt(o);const cl=getOClient(o);return o.toLowerCase().includes(ql)||(cmt&&cmt.toLowerCase().includes(ql))||(cl&&cl.toLowerCase().includes(ql))}):avO;document.getElementById('oLB').innerHTML=filtered.map(([o,c])=>{const on=sO.has(o);const cmt=getOCmt(o);return`<div class="li ${on?'ck':''}" onclick="togO('${eA(o)}')"><span class="cb2">${on?'✓':''}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:5px"><span class="mono">${eH(o)}</span>${cmt?`<span style="font-size:9px;color:var(--t5);font-style:italic">${eH(cmt)}</span>`:''}</span><span style="font-size:9px;color:var(--t6)" class="mono">${c}</span></div>`}).join('')||'<div style="padding:10px;text-align:center;color:var(--t6);font-size:10px">'+(q?'검색 결과 없음':'팀원 선택 필요')+'</div>';document.getElementById('oFC').textContent=sO.size>0?`(${sO.size})`:''}
function rTL(){document.getElementById('tLB').innerHTML=avT.map(([a,c])=>{const on=sT.has(a);return`<div class="li ${on?'ck':''}" onclick="togT('${a}')"><span class="cb2">${on?'✓':''}</span><span style="flex:1"><span class="badge" style="background:${ABG[a]||'#1A1F35'};color:${AFG[a]||'#94A3B8'};margin-right:4px">${a}</span>${AM[a]||a}</span><span style="font-size:9px;color:var(--t6)" class="mono">${c}</span></div>`}).join('')||'<div style="padding:10px;text-align:center;color:var(--t6);font-size:10px">팀원 선택 필요</div>';document.getElementById('tFC').textContent=sT.size>0?`(${sT.size})`:''}
function togO(o){sO.has(o)?sO.delete(o):sO.add(o);gfInvalidate();rOL();upOP();upV()}
function togT(t){sT.has(t)?sT.delete(t):sT.add(t);gfInvalidate();rTL();upV()}
function rstO(){sO.clear();gfInvalidate();rOL();upOP();upV()}
function rstT(){sT.clear();gfInvalidate();rTL();upV()}
function togON(n){sON.has(n)?sON.delete(n):sON.add(n);gfInvalidate();rONL();upV()}
function togCL(c){sCL.has(c)?sCL.delete(c):sCL.add(c);gfInvalidate();rCLL();upV()}
function rstON(){sON.clear();gfInvalidate();rONL();upV()}
function rstCL(){sCL.clear();gfInvalidate();rCLL();upV()}
function togDV(d){sDV.has(d)?sDV.delete(d):sDV.add(d);gfInvalidate();rDVL();upV()}
function rstDV(){sDV.clear();gfInvalidate();rDVL();upV()}
function rDVL(){document.getElementById('dvLB').innerHTML=avDV.map(([d,c])=>{const on=sDV.has(d);return`<div class="li ${on?'ck':''}" onclick="togDV('${eA(d)}')"><span class="cb2">${on?'✓':''}</span><span style="flex:1;font-size:11px">${eH(d)}</span><span style="font-size:9px;color:var(--t6)" class="mono">${c}</span></div>`}).join('')||'<div style="padding:10px;text-align:center;color:var(--t6);font-size:10px">팀원 선택 필요</div>';document.getElementById('dvFC').textContent=sDV.size>0?`(${sDV.size})`:''}
function rONL(){const q=(document.getElementById('onSearch')||{}).value||'';const ql=q.toLowerCase();const filtered=q?avON.filter(([n])=>n.toLowerCase().includes(ql)):avON;document.getElementById('onLB').innerHTML=filtered.map(([n,c])=>{const on=sON.has(n);return`<div class="li ${on?'ck':''}" onclick="togON('${eA(n)}')"><span class="cb2">${on?'✓':''}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${eH(n)}</span><span style="font-size:9px;color:var(--t6)" class="mono">${c}</span></div>`}).join('')||'<div style="padding:10px;text-align:center;color:var(--t6);font-size:10px">'+(q?'검색 결과 없음':'팀원 선택 필요')+'</div>';document.getElementById('onFC').textContent=sON.size>0?`(${sON.size})`:''}
function rCLL(){const q=(document.getElementById('clSearch')||{}).value||'';const ql=q.toLowerCase();const filtered=q?avCL.filter(([cl])=>cl.toLowerCase().includes(ql)):avCL;document.getElementById('clLB').innerHTML=filtered.map(([cl,c])=>{const on=sCL.has(cl);return`<div class="li ${on?'ck':''}" onclick="togCL('${eA(cl)}')"><span class="cb2">${on?'✓':''}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${eH(cl)}</span><span style="font-size:9px;color:var(--t6)" class="mono">${c}</span></div>`}).join('')||'<div style="padding:10px;text-align:center;color:var(--t6);font-size:10px">'+(q?'검색 결과 없음':'팀원 선택 필요')+'</div>';document.getElementById('clFC').textContent=sCL.size>0?`(${sCL.size})`:''}

function clrS(){cKw='';document.getElementById('cSearch').value='';document.getElementById('sClear').classList.add('hidden');gfInvalidate();upV()}
function resetAll(){sO.clear();sT.clear();sON.clear();sCL.clear();sDV.clear();cKw='';document.getElementById('cSearch').value='';document.getElementById('sClear').classList.add('hidden');gfInvalidate();rOL();rTL();rONL();rCLL();rDVL();upOP();upV()}
var _siTimer;
function onSI(){cKw=document.getElementById('cSearch').value.trim();document.getElementById('sClear').classList.toggle('hidden',!cKw);gfInvalidate();clearTimeout(_siTimer);_siTimer=setTimeout(upV,200)}
function togExcludeVac(el){excludeVac=!!el.checked;try{localStorage.setItem('wm_excludeVac',excludeVac?'1':'0')}catch(e){}gfInvalidate();upV()}
function _initExcludeVacChk(){var el=document.getElementById('excludeVacChk');if(el)el.checked=!!excludeVac}
var _gfCache=null,_gfDirty=true;
function gfInvalidate(){_gfDirty=true;_gfCache=null;wvSave()}
function gF(){
  if(!_gfDirty&&_gfCache)return _gfCache;
  if(sN.size===0){_gfCache=[];_gfDirty=false;return _gfCache}
  let r=aD.filter(r=>sN.has(r.name));
  if(selWeek)r=r.filter(x=>x.date>=selWeek.start&&x.date<=selWeek.end);
  if(sO.size>0)r=r.filter(x=>sO.has(x.orderNo));
  if(sT.size>0)r=r.filter(x=>sT.has(x.abbr));
  if(sON.size>0)r=r.filter(x=>{
    const on=(x.ocmt||getOCmt(x.orderNo)||'(미지정)');
    return sON.has(on)
  });
  if(sCL.size>0)r=r.filter(x=>{
    const cl=(x.oclient||getOClient(x.orderNo)||'(미지정)');
    return sCL.has(cl)
  });
  if(sDV.size>0)r=r.filter(x=>sDV.has(x.dept||'(미지정)'));
  // 휴가 판정: abbr='V' 또는 taskType/content에 '휴가' 포함
  const _isVac=function(x){
    if(x.abbr==='V'||x.abbr==='v')return true;
    var tt=String(x.taskType||'');
    if(tt.indexOf('휴가')!==-1||tt.indexOf('연차')!==-1||tt.indexOf('반차')!==-1)return true;
    return false;
  };
  if(cKw){
    const k=cKw.toLowerCase();
    const includeV=sT.has('V'); // 사용자가 V를 명시 선택한 경우만 휴가 포함
    r=r.filter(x=>{
      if(_isVac(x)&&!includeV)return false;
      const matchContent=x.content.toLowerCase().includes(k);
      const matchOcmt=(x.ocmt||getOCmt(x.orderNo)||'').toLowerCase().includes(k);
      const matchOcl=(x.oclient||getOClient(x.orderNo)||'').toLowerCase().includes(k);
      return matchContent||matchOcmt||matchOcl
    });
  }
  if(excludeVac&&!sT.has('V'))r=r.filter(x=>!_isVac(x));
  _gfCache=r.sort((a,b)=>{
    const n=a.name.localeCompare(b.name,'ko');
    return n!==0?n:a.date.localeCompare(b.date)
  });
  _gfDirty=false;return _gfCache
}
function hAF(){return sO.size>0||sT.size>0||sON.size>0||sCL.size>0||sDV.size>0||!!cKw||!!selWeek}
function rAFT(){const t=[];sO.forEach(o=>t.push({y:'o',l:'수주:'+o,v:o}));sT.forEach(x=>t.push({y:'t',l:AM[x]||x,v:x}));sON.forEach(x=>t.push({y:'on',l:'수주명:'+x,v:x}));sCL.forEach(x=>t.push({y:'cl',l:'거래처:'+x,v:x}));sDV.forEach(x=>t.push({y:'dv',l:'사업부:'+x,v:x}));if(cKw)t.push({y:'s',l:'검색:"'+cKw+'"',v:''});document.getElementById('afTags').innerHTML=t.map(x=>`<span class="ft">${eH(x.l)}<span class="tx" onclick="rmFT('${x.y}','${eA(x.v)}')">&times;</span></span>`).join('');document.getElementById('resetBtn').classList.toggle('hidden',t.length===0);var fn=document.getElementById('wqFilterN');if(fn){var n=sO.size+sT.size+sON.size+sCL.size+sDV.size;fn.textContent=n?n:''}}
function rmFT(y,v){if(y==='w'){selWeek=null;weekYearFilter='';weekQtrFilter='';weekMonthFilter='';var ys=document.getElementById('weekYearSel');if(ys)ys.value='';var qs=document.getElementById('weekQtrSel');if(qs)qs.value='';var ms=document.getElementById('weekMonthSel');if(ms)ms.value='';renderWeekSelector()}if(y==='o'){sO.delete(v);rOL()}if(y==='t'){sT.delete(v);rTL()}if(y==='on'){sON.delete(v);rONL()}if(y==='cl'){sCL.delete(v);rCLL()}if(y==='dv'){sDV.delete(v);rDVL()}if(y==='s')clrS();gfInvalidate();upV()}
function gTC(){const s=getComputedStyle(document.documentElement);return{g:s.getPropertyValue('--cg').trim(),t:s.getPropertyValue('--ct').trim(),l:s.getPropertyValue('--cl').trim()}}

