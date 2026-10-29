/* wr-drill.js — v13.266 업무일지 상세 결과 보기: 묶어 보기 · 표 안 부분 필터 · 정렬 · 결과 안 찾기 · 주간 격자 · 휴대폰 카드
 * 위쪽 조회 조건(gF) 결과를 받아 '보는 중에만' 좁힘 — 위 조건(sN · sO …)은 건드리지 않음 (⬆ 위 조건으로 버튼으로만 옮김).
 * upV · 내용요약 · 내보내기는 wdApply(gF()) 를 씀. 보기 모드 렌더는 renderTblRows → wdRender (편집 모드는 예전 평평한 표).
 * 묶음 · 정렬 · 펼친 묶음은 localStorage 'wm-wd' 에 기억, 부분 필터는 잠깐 쓰는 것이라 기억하지 않음. */
var WD_KEYS={name:{i:'👤',l:'이름'},date:{i:'📅',l:'날짜'},order:{i:'🔢',l:'수주번호'},ocmt:{i:'📁',l:'수주명'},client:{i:'🏢',l:'거래처'},abbr:{i:'🏷',l:'업무분장'}};
var WD_DOW=['일','월','화','수','목','금','토'];
var wdF=[];                       // 부분 필터 [{k, vs:[값…], not:빼기?, g:격자에서 고른 것?}]
var wdGroup='name',wdSort={k:'',d:1},wdOpen=new Set();
var wdFindQ='',wdFindI=-1,wdFindHits=[],_wdFindOpen=new Set();
var wdExpAll=false,wdLimit=200,_wdLastF=[],_wdItems=[];
(function(){try{var o=JSON.parse(localStorage.getItem('wm-wd')||'null');if(o){if(o.g)wdGroup=o.g;if(o.s&&typeof o.s==='object')wdSort=o.s;if(Array.isArray(o.o))wdOpen=new Set(o.o)}}catch(e){}})();
function _wdSave(){try{localStorage.setItem('wm-wd',JSON.stringify({g:wdGroup,s:wdSort,o:[...wdOpen].slice(-80)}))}catch(e){}}
function wdMobile(){return!!(window.matchMedia&&matchMedia('(max-width:700px)').matches)}
function _wdH(h){return Math.round((h||0)*10)/10}
function _wdNm(n){return typeof shortName==='function'?shortName(n):n}
function _wdDay(d){d=String(d||'');if(d.length!==8)return d;var dt=new Date(+d.slice(0,4),+d.slice(4,6)-1,+d.slice(6,8));return d.slice(4,6)+'/'+d.slice(6,8)+' ('+WD_DOW[dt.getDay()]+')'}
function _wdEditing(){if(typeof editMode!=='undefined'&&editMode){showToast('편집 모드에서는 바꿀 수 없습니다 — 먼저 편집을 마치세요','warn');return true}return false}
function _wdCol(n){var i=aN.indexOf(n);return COL[(i<0?0:i)%COL.length]}

/* ═══ 걸러내기 · 정렬 ═══ */
function wdVal(r,k){
  if(k==='name')return r.name;
  if(k==='date')return r.date;
  if(k==='order')return r.orderNo||'';
  if(k==='ocmt')return r.ocmt||getOCmt(r.orderNo)||'(미지정)';
  if(k==='client')return r.oclient||getOClient(r.orderNo)||'(미지정)';
  if(k==='abbr')return r.abbr||'';
  return '';
}
function _wdPass(r,skipG,skipK){
  for(var j=0;j<wdF.length;j++){var x=wdF[j];
    if(skipG&&x.g)continue;
    if(skipK&&x.k===skipK&&!x.not)continue;
    var has=x.vs.indexOf(String(wdVal(r,x.k)))>=0;
    if(x.not?has:!has)return false;
  }
  return true;
}
function wdApply(f,skipG){
  var out=wdF.length?f.filter(function(r){return _wdPass(r,skipG)}):f;
  if(wdSort.k){
    var k=wdSort.k,d=wdSort.d||1;out=out.slice();
    out.sort(function(a,b){var x=k==='hours'?(a.hours||0)-(b.hours||0):String(wdVal(a,k)).localeCompare(String(wdVal(b,k)),'ko');if(x)return x*d;var n=a.name.localeCompare(b.name,'ko');return n||a.date.localeCompare(b.date)});
  }
  return out;
}
function wdExportRows(){var b=gF();return wdExpAll?b:wdApply(b)}

/* ═══ 부분 필터 바꾸기 ═══ */
function wdAdd(k,v,not){
  v=String(v);
  if(not){var ex=wdF.find(function(x){return x.k===k&&x.not});if(ex){if(ex.vs.indexOf(v)<0)ex.vs.push(v)}else wdF.push({k:k,vs:[v],not:true})}
  else{wdF=wdF.filter(function(x){return!(x.k===k&&!x.not&&!x.g)});wdF.push({k:k,vs:[v]})}
  _wdChanged();
}
function _wdChanged(){wdLimit=200;_wdCloseMenu();upV()}
function wdPop(){if(!wdF.length)return;wdF.pop();_wdChanged()}
function wdRm(i){wdF.splice(i,1);_wdChanged()}
function wdClear(){if(!wdF.length)return;wdF=[];_wdChanged()}
/* 지금 부분 필터를 위쪽 조회 조건으로 — 태그가 붙고 다음에 들어와도 기억됨. '빼기'는 이름만 옮길 수 있음 */
function wdPromote(){
  var skipped=0;
  wdF.forEach(function(x){
    if(x.not){if(x.k==='name')x.vs.forEach(function(n){sN.delete(n)});else skipped++;return}
    var put=function(set){set.clear();x.vs.forEach(function(v){set.add(v)})};
    if(x.k==='name'){sN.clear();x.vs.forEach(function(n){if(aN.indexOf(n)>=0)sN.add(n)})}
    else if(x.k==='order')put(sO);
    else if(x.k==='ocmt')put(sON);
    else if(x.k==='client')put(sCL);
    else if(x.k==='abbr')put(sT);
    else if(x.k==='date'){var ds=x.vs.slice().sort();selWeek={start:ds[0],end:ds[ds.length-1],label:fD(ds[0])+' ~ '+fD(ds[ds.length-1])};weekYearFilter='';weekQtrFilter='';weekMonthFilter='';document.getElementById('weekLabel').value='';document.getElementById('weekAutoLabel').textContent='('+selWeek.label+')';renderWeekSelector()}
  });
  wdF=[];_wdCloseMenu();gfInvalidate();syncCmpVisibility();rNC();rFL();upV();
  showToast('⬆ 위 조회 조건으로 옮겼습니다'+(skipped?' — 「빼기」 '+skipped+'개는 위 조건에 없어 뺐습니다':''));
}
function wdSetGroup(g){
if(_wdEditing())return;  if(g===wdGroup)return;
  wdGroup=g;if(g!=='grid')wdF=wdF.filter(function(x){return!x.g});
  _wdSave();if(typeof wvSave==='function')wvSave();wdLimit=200;upV();
}
function wdSetSort(v){if(_wdEditing())return;var p=String(v||'').split(':');wdSort=p[0]?{k:p[0],d:+p[1]||1}:{k:'',d:1};_wdSave();upV()}
/* 열 머리 누르기 — 없음 → 기본 방향 → 반대 → 없음 (시간은 많은 순부터) */
function wdSortBy(k){
if(_wdEditing())return;  var d0=k==='hours'?-1:1;
  if(wdSort.k!==k)wdSort={k:k,d:d0};else if(wdSort.d===d0)wdSort={k:k,d:-d0};else wdSort={k:'',d:1};
  _wdSave();upV();
}
function wdToggle(key){
  if(wdOpen.has(key))wdOpen.delete(key);else wdOpen.add(key);
  _wdSave();wdRender(_wdLastF);
}
function wdOpenAll(open){
  _wdItems.forEach(function(it){if(it.t==='g'){if(open)wdOpen.add(it.key);else wdOpen.delete(it.key)}});
  _wdSave();wdRender(_wdLastF);
}

/* ═══ 줄 목록 만들기 — 묶음 머리(g) · 묶음 안 구분 줄(s) · 기록(r) ═══ */
function _wdBuild(f,grp,mob){
  var items=[];
  var sub=function(g){return grp==='name'?'date':grp==='date'?'name':mob?'nd':null};
  if(grp==='none'){_wdPushRecs(items,f.map(function(r,i){return i}),f,mob?'nd':null);return items}
  var gk=grp==='name'?function(r){return r.name}:grp==='date'?function(r){return r.date}:function(r){return r.orderNo||''};
  var map=new Map();
  f.forEach(function(r,i){var k=gk(r),g=map.get(k);if(!g){g={k:k,idx:[],h:0,days:new Set(),names:new Set(),oc:{}};map.set(k,g)}g.idx.push(i);g.h+=r.hours||0;g.days.add(r.date);g.names.add(r.name);var oc=wdVal(r,'ocmt');g.oc[oc]=(g.oc[oc]||0)+(r.hours||0)});
  var gs=Array.from(map.values());
  var sk=grp==='order'?'order':grp;
  if(wdSort.k==='hours')gs.sort(function(a,b){return(a.h-b.h)*(wdSort.d||1)});
  else{var dd=wdSort.k===sk?(wdSort.d||1):1;gs.sort(function(a,b){return String(a.k).localeCompare(String(b.k),'ko')*dd})}
  var maxH=gs.reduce(function(m,g){return Math.max(m,g.h)},0)||1;
  var one=gs.length===1;
  gs.forEach(function(g){
    var key=grp[0]+':'+g.k;
    var open=one||wdOpen.has(key)||_wdFindOpen.has(key);
    items.push({t:'g',key:key,open:open,one:one,g:g,grp:grp,maxH:maxH,r0:f[g.idx[0]]});
    if(open)_wdPushRecs(items,g.idx,f,sub(g));
  });
  return items;
}
function _wdPushRecs(items,idxs,f,subKey){
  if(!subKey){
    var pr=null;
    idxs.forEach(function(i){var r=f[i];
      items.push({t:'r',r:r,i:i,sn:!!pr&&pr.name===r.name,sd:!!pr&&pr.name===r.name&&pr.date===r.date,sep:!!pr&&pr.date!==r.date});
      pr=r;
    });
    return;
  }
  var kf=subKey==='date'?function(r){return r.date}:subKey==='name'?function(r){return r.name}:function(r){return r.name+'|'+r.date};
  var m=new Map();
  idxs.forEach(function(i){var k=kf(f[i]),s=m.get(k);if(!s){s={k:k,idx:[],h:0};m.set(k,s)}s.idx.push(i);s.h+=f[i].hours||0});
  var ss=Array.from(m.values());
  if(subKey==='date'){var dd=wdSort.k==='date'?(wdSort.d||1):1;ss.sort(function(a,b){return a.k.localeCompare(b.k)*dd})}
  else if(subKey==='name')ss.sort(function(a,b){return a.k.localeCompare(b.k,'ko')});
  ss.forEach(function(s){
    items.push({t:'s',sk:subKey,s:s,r0:f[s.idx[0]]});
    s.idx.forEach(function(i){items.push({t:'r',r:f[i],i:i,sn:true,sd:true,sep:false})});
  });
}
function _wdGParts(it){
  var g=it.g,grp=it.grp,r0=it.r0,title;
  if(grp==='name')title='<span class="dot" style="background:'+_wdCol(g.k)+'"></span><b>'+eH(_wdNm(g.k))+'</b>';
  else if(grp==='date')title='<b>📅 '+_wdDay(g.k)+'</b>';
  else title='<b class="mono">'+eH(g.k||'(수주번호 없음)')+'</b><span class="wd-goc">'+eH(wdVal(r0,'ocmt'))+'</span>';
  var stat=(grp==='date'?g.names.size+'명':g.days.size+'일')+' · '+g.idx.length+'건';
  var ocs=Object.keys(g.oc).sort(function(a,b){return g.oc[b]-g.oc[a]});
  var top=grp==='order'?eH(wdVal(r0,'client')):(ocs.length?eH(ocs[0])+(ocs.length>1?' <em>외 '+(ocs.length-1)+'</em>':''):'');
  return{title:title,stat:stat,h:_wdH(g.h)+'h',bar:Math.max(3,Math.round(g.h/it.maxH*100)),top:top};
}
function _wdSubHTML(it){
  var s=it.s,r0=it.r0;
  var lab=it.sk==='date'?'📅 '+_wdDay(r0.date):it.sk==='name'?'<span class="dot" style="background:'+_wdCol(r0.name)+'"></span>'+eH(_wdNm(r0.name)):'<span class="dot" style="background:'+_wdCol(r0.name)+'"></span>'+eH(_wdNm(r0.name))+' · '+_wdDay(r0.date);
  return '<span class="wd-sl">'+lab+'</span><span class="wd-sn">'+s.idx.length+'건 · <b>'+_wdH(s.h)+'h</b></span>';
}
/* 결과 안에서 찾기 강조 — 태그 밖 글자만 */
function _wdHL(html){
  if(!wdFindQ)return html;
  var q=eH(wdFindQ).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),rx=new RegExp('('+q+')','gi');
  return html.split(/(<[^>]+>)/).map(function(p){return p.charAt(0)==='<'?p:p.replace(rx,'<mark class="wd-hl">$1</mark>')}).join('');
}
function _wdIsCur(i){return wdFindI>=0&&wdFindHits[wdFindI]===i}

/* 표(PC) 한 줄 — 가상 스크롤(_vsRender)이 부름 */
function wdRowHTML(it){
  if(it.t==='g'){var p=_wdGParts(it);
    return '<tr class="wd-g'+(it.open?' open':'')+'" data-wdg="'+eH(it.key)+'"><td colspan="9"><div class="wd-gi"><span class="wd-car">'+(it.one?'•':'▸')+'</span>'+p.title+'<span class="wd-st">'+p.stat+'</span><span class="wd-gbar"><i style="width:'+p.bar+'%"></i></span><span class="wd-hr">'+p.h+'</span><span class="wd-top">'+p.top+'</span></div></td></tr>'}
  if(it.t==='s')return '<tr class="wd-s"><td colspan="9"><div class="wd-si">'+_wdSubHTML(it)+'</div></td></tr>';
  return _vsRenderRow(it.r,it.i,false,it);
}
/* 휴대폰 카드 */
function _wdCardRec(it){
  var r=it.r,oc=r.ocmt||getOCmt(r.orderNo),cl=r.oclient||getOClient(r.orderNo);
  var ch=eH(r.content);
  if(cKw){var rx=new RegExp('('+cKw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');ch=ch.replace(rx,'<mark>$1</mark>')}
  return '<div class="wdc-r'+(_wdIsCur(it.i)?' wd-cur':'')+'" id="wdc'+it.i+'">'
    +'<div class="wdc-l1"><span class="wdc-oc" data-wk="ocmt" data-wv="'+eH(oc||'(미지정)')+'">'+(oc?eH(oc):'<span class="oc-none">수주명 없음</span>')+'</span>'
    +(cl?'<span class="oc-cl" data-wk="client" data-wv="'+eH(cl)+'">'+eH(cl)+'</span>':'')+'<span class="wdc-hr">'+_wdH(r.hours)+'h</span></div>'
    +'<div class="wdc-ct">'+_wdHL(ch)+'</div>'
    +'<div class="wdc-mt">'+(it.sn?'':'<span data-wk="name" data-wv="'+eH(r.name)+'"><span class="dot" style="background:'+_wdCol(r.name)+'"></span>'+eH(_wdNm(r.name))+'</span>')
    +(it.sd?'':'<span data-wk="date" data-wv="'+r.date+'">'+_wdDay(r.date)+'</span>')
    +'<span class="mono" data-wk="order" data-wv="'+eH(r.orderNo||'')+'">'+eH(r.orderNo||'')+'</span>'
    +'<span class="badge" data-wk="abbr" data-wv="'+eH(r.abbr||'')+'" style="background:'+(ABG[r.abbr]||'#1A1F35')+';color:'+(AFG[r.abbr]||'#94A3B8')+'" title="'+eH(AM[r.abbr]||'')+'">'+eH(r.abbr||'')+'</span></div></div>';
}
function _wdCardsHTML(items,f,gridNoSel){
  if(gridNoSel)return '<div class="wd-hint">▦ 칸을 누르면 그 사람의 그날 업무가 여기에 나옵니다</div>';
  if(!f.length)return '<div class="wd-hint">결과 없음</div>';
  var html='',recN=0,more=0;
  items.forEach(function(it){
    if(it.t==='g'){var p=_wdGParts(it);
      html+='<div class="wdc-g'+(it.open?' open':'')+'" data-wdg="'+eH(it.key)+'"><div class="wdc-h"><span class="wd-car">'+(it.one?'•':'▸')+'</span>'+p.title+'<span class="wdc-hh">'+p.h+'</span><span class="wdc-hn">'+p.stat+'</span></div>'
        +'<div class="wdc-hs"><span class="wd-gbar"><i style="width:'+p.bar+'%"></i></span><span class="wd-top">'+p.top+'</span></div></div>';return}
    if(recN>=wdLimit){if(it.t==='r')more++;return}
    if(it.t==='s'){html+='<div class="wdc-s">'+_wdSubHTML(it)+'</div>';return}
    recN++;html+=_wdCardRec(it);
  });
  if(more)html+='<button class="btn btn-g wdc-more" type="button" onclick="wdLimit+=200;wdRender(_wdLastF)">더 보기 (+'+more+'건)</button>';
  return html;
}

/* ═══ 주간 격자 — 사람 × 요일(한두 주) 또는 사람 × 주 ═══ */
function _wdDateAdd(d,n){var dt=new Date(+d.slice(0,4),+d.slice(4,6)-1,+d.slice(6,8)+n);return String(dt.getFullYear())+String(dt.getMonth()+1).padStart(2,'0')+String(dt.getDate()).padStart(2,'0')}
function _wdGridHTML(base){
  if(!base.length)return '<div class="wd-hint">결과 없음</div>';
  var mn=base[0].date,mx=base[0].date;base.forEach(function(r){if(r.date<mn)mn=r.date;if(r.date>mx)mx=r.date});
  var s=selWeek&&selWeek.start>'0'?selWeek.start:mn,e=selWeek?selWeek.end:mx;
  var span=0,d=s;while(d<=e&&span<40){span++;d=_wdDateAdd(d,1)}
  var cols=[];
  if(span<=14){for(d=s;d<=e;d=_wdDateAdd(d,1)){var dw=new Date(+d.slice(0,4),+d.slice(4,6)-1,+d.slice(6,8)).getDay();cols.push({k:d,l:WD_DOW[dw]+'<small>'+d.slice(4,6)+'/'+d.slice(6,8)+'</small>',ds:[d],we:dw===0||dw===6})}}
  else{for(var w=getSunStart(mn);w<=mx;w=_wdDateAdd(w,7)){var dt=new Date(+w.slice(0,4),+w.slice(4,6)-1,+w.slice(6,8)),ds=[];for(var j=0;j<7;j++)ds.push(_wdDateAdd(w,j));cols.push({k:w,l:'W'+String(getISOWeek(dt)).padStart(2,'0')+'<small>'+w.slice(4,6)+'/'+w.slice(6,8)+'</small>',ds:ds})}}
  var colOf={};cols.forEach(function(c,ci){c.ds.forEach(function(x){colOf[x]=ci})});
  var cell={},tot={},ctot=cols.map(function(){return 0}),maxH=0;
  base.forEach(function(r){var ci=colOf[r.date];if(ci===undefined)return;var k=r.name+'|'+ci,o=cell[k]||(cell[k]={h:0,c:0});o.h+=r.hours||0;o.c++;tot[r.name]=(tot[r.name]||0)+(r.hours||0);ctot[ci]+=r.hours||0});
  Object.keys(cell).forEach(function(k){if(cell[k].h>maxH)maxH=cell[k].h});maxH=maxH||1;
  var names=Object.keys(tot);
  if(wdSort.k==='hours')names.sort(function(a,b){return(tot[a]-tot[b])*(wdSort.d||1)});else names.sort(function(a,b){return a.localeCompare(b,'ko')});
  var gN=wdF.find(function(x){return x.g&&x.k==='name'}),gD=wdF.find(function(x){return x.g&&x.k==='date'});
  var selN=gN?gN.vs[0]:null,selD=gD?gD.vs.join(','):null;
  var html='<div class="wd-gw"><table class="wd-grid"><thead><tr><th class="wd-gn">이름</th>'+cols.map(function(c){return'<th'+(c.we?' class="we"':'')+'>'+c.l+'</th>'}).join('')+'<th class="wd-gt">합계</th></tr></thead><tbody>';
  names.forEach(function(n){
    html+='<tr><td class="wd-gn"><span data-wk="name" data-wv="'+eH(n)+'"><span class="dot" style="background:'+_wdCol(n)+'"></span>'+eH(_wdNm(n))+'</span></td>';
    cols.forEach(function(c,ci){var o=cell[n+'|'+ci];
      if(!o){html+='<td class="wd-gc0'+(c.we?' we':'')+'"></td>';return}
      var sel=selN===n&&selD===c.ds.join(',');
      html+='<td class="wd-gc'+(sel?' sel':'')+(c.we?' we':'')+'" data-gn="'+eH(n)+'" data-gd="'+c.ds.join(',')+'" style="--a:'+(0.12+0.5*o.h/maxH).toFixed(2)+'" title="'+eH(_wdNm(n))+' · '+_wdH(o.h)+'h · '+o.c+'건"><b>'+_wdH(o.h)+'</b><small>'+o.c+'건</small></td>'});
    html+='<td class="wd-gt">'+_wdH(tot[n])+'h</td></tr>';
  });
  html+='</tbody><tfoot><tr><td class="wd-gn">합계</td>'+ctot.map(function(h){return'<td>'+(h?_wdH(h):'')+'</td>'}).join('')+'<td class="wd-gt">'+_wdH(ctot.reduce(function(a,b){return a+b},0))+'h</td></tr></tfoot></table></div>';
  return html;
}
function wdGridPick(n,dsStr){
  var gN=wdF.find(function(x){return x.g&&x.k==='name'}),gD=wdF.find(function(x){return x.g&&x.k==='date'});
  var same=gN&&gN.vs[0]===n&&gD&&gD.vs.join(',')===dsStr;
  wdF=wdF.filter(function(x){return!x.g});
  if(!same)wdF.push({k:'name',vs:[n],g:true},{k:'date',vs:dsStr.split(','),g:true});
  _wdChanged();
  if(!same)setTimeout(function(){var el=document.getElementById(wdMobile()?'wdCards':'wrTbl');if(el&&el.scrollIntoView)el.scrollIntoView({block:'nearest',behavior:'smooth'})},60);
}

/* ═══ 그리기 ═══ */
function _wdBars(f){
  document.querySelectorAll('#wdBar [data-g]').forEach(function(b){b.classList.toggle('on',b.dataset.g===wdGroup);b.setAttribute('aria-pressed',b.dataset.g===wdGroup)});
  var oc=document.getElementById('wdOC');if(oc)oc.classList.toggle('hidden',wdGroup==='none'||wdGroup==='grid');
  var ss=document.getElementById('wdSortSel');if(ss)ss.value=wdSort.k?wdSort.k+':'+wdSort.d:'';
  document.querySelectorAll('#wrTbl th[data-sk]').forEach(function(th){var on=wdSort.k===th.dataset.sk;th.classList.toggle('wd-sorted',on);var a=th.querySelector('.wd-arr');if(a)a.textContent=on?(wdSort.d>0?'▲':'▼'):''});
  document.querySelectorAll('#wrTbl th[data-fk]').forEach(function(th){th.classList.toggle('wd-filtered',wdF.some(function(x){return x.k===th.dataset.fk}))});
  var fn=document.getElementById('wdFindN');if(fn)fn.textContent=wdFindQ?(wdFindHits.length?(wdFindI+1)+'/'+wdFindHits.length:'0건'):'';
  var path=document.getElementById('wdPath');if(!path)return;
  if(!wdF.length){path.classList.add('hidden');path.innerHTML='';return}
  path.classList.remove('hidden');
  var lab=function(x){var v=x.vs.map(function(s){return x.k==='date'?_wdDay(s):x.k==='name'?_wdNm(s):s});return v.length>1?v[0]+' 외 '+(v.length-1):v[0]};
  path.innerHTML='<button class="wd-all" type="button" onclick="wdClear()" title="부분 필터 모두 풀기">전체 '+gF().length.toLocaleString()+'건</button>'
    +wdF.map(function(x,i){return'<span class="wd-arrow">›</span><span class="wd-chip'+(x.not?' not':'')+(x.g?' grid':'')+'" title="'+eH(WD_KEYS[x.k].l+(x.not?' 빼기':'')+': '+x.vs.join(', '))+'">'+(x.not?'🚫':x.g?'▦':WD_KEYS[x.k].i)+' '+eH(lab(x))+'<span class="tx" onclick="wdRm('+i+')" title="빼기">&times;</span></span>'}).join('')
    +'<b class="wd-cnt">'+f.length.toLocaleString()+'건</b><span class="wd-sp"></span>'
    +'<button class="btn btn-g btn-s" type="button" onclick="wdPop()" title="한 단계 뒤로 (Backspace · 휴대폰은 화면 왼쪽 끝에서 밀기)">← 뒤로</button>'
    +'<button class="btn btn-g btn-s" type="button" onclick="wdClear()">✕ 모두 풀기</button>'
    +'<button class="btn btn-p btn-s" type="button" onclick="wdPromote()" title="위쪽 조회 조건(태그)으로 옮겨 계속 쓰기">⬆ 위 조건으로</button>'
    +'<label class="wd-exp" title="엑셀 저장 · TSV 복사 범위"><input type="checkbox" onchange="wdExpAll=this.checked"'+(wdExpAll?' checked':'')+'> 내보내기는 위 조건 전체</label>';
}
/* empty: rTbl 이 '결과 없음'을 이미 그림 — 막대 · 경로만 갱신 */
function wdRender(f,empty){
  _wdLastF=f;
  var mob=wdMobile(),isGrid=wdGroup==='grid',gSel=wdF.some(function(x){return x.g});
  var tw=document.querySelector('#tTbl .tw'),cards=document.getElementById('wdCards'),grid=document.getElementById('wdGrid');
  var tt=document.getElementById('tTbl');if(tt)tt.classList.remove('wd-edit');
  if(grid){if(isGrid){grid.classList.remove('hidden');grid.innerHTML=_wdGridHTML(wdApply(gF(),true))}else{grid.classList.add('hidden');grid.innerHTML=''}}
  var showList=!isGrid||gSel;
  var grp=isGrid?'none':wdGroup;
  _wdFindCalc(f,grp);
  var items=f.length&&showList?_wdBuild(f,grp,mob):[];
  _wdItems=items;
  _wdBars(f);
  if(mob){
    if(tw)tw.classList.add('wd-off');
    if(cards){cards.classList.remove('hidden');cards.innerHTML=_wdCardsHTML(items,f,isGrid&&!gSel)}
  }else{
    if(cards){cards.classList.add('hidden');cards.innerHTML=''}
    if(tw)tw.classList.toggle('wd-off',!showList);
    if(!empty){_vsData=items;_vsEditable=false;if(items.length)_vsRender();else document.getElementById('tBody').innerHTML=''}
    if(isGrid&&!gSel&&cards){cards.classList.remove('hidden');cards.innerHTML='<div class="wd-hint">▦ 칸을 누르면 그 사람의 그날 업무가 아래 표에 나옵니다</div>'}
  }
}
/* 편집 모드 — 묶음 · 카드 · 격자 감추고 평평한 넓은 표 */
function wdEditMode(on){var tt=document.getElementById('tTbl');if(tt)tt.classList.toggle('wd-edit',!!on);if(on){var tw=document.querySelector('#tTbl .tw');if(tw)tw.classList.remove('wd-off')}}

/* ═══ 결과 안에서 찾기 — 줄은 그대로, 강조 · ▲▼ 이동 ═══ */
function _wdFindCalc(f,grp){
  wdFindHits=[];_wdFindOpen=new Set();
  if(!wdFindQ){wdFindI=-1;return}
  var q=wdFindQ.toLowerCase();
  f.forEach(function(r,i){
    if(String(r.content||'').toLowerCase().indexOf(q)>=0||String(wdVal(r,'ocmt')).toLowerCase().indexOf(q)>=0||String(wdVal(r,'client')).toLowerCase().indexOf(q)>=0){
      wdFindHits.push(i);
      if(grp!=='none')_wdFindOpen.add(grp[0]+':'+(grp==='name'?r.name:grp==='date'?r.date:(r.orderNo||'')));
    }
  });
  if(wdFindI>=wdFindHits.length||wdFindI<0)wdFindI=wdFindHits.length?0:-1;
}
var _wdFindT=0;
function wdFindInput(v){clearTimeout(_wdFindT);_wdFindT=setTimeout(function(){wdFindQ=String(v||'').trim();wdFindI=wdFindQ?0:-1;wdRender(_wdLastF);_wdFindScroll()},200)}
function wdFindGo(dir){if(!wdFindHits.length)return;wdFindI=(wdFindI+dir+wdFindHits.length)%wdFindHits.length;wdRender(_wdLastF);_wdFindScroll()}
function _wdFindScroll(){
  if(wdFindI<0)return;var i=wdFindHits[wdFindI];
  if(wdMobile()){
    var el=document.getElementById('wdc'+i);
    if(!el){var pos=_wdItems.filter(function(it){return it.t==='r'}).findIndex(function(it){return it.i===i});if(pos>=wdLimit){wdLimit=pos+50;wdRender(_wdLastF);el=document.getElementById('wdc'+i)}}
    if(el)el.scrollIntoView({block:'center'});
    return;
  }
  var p=_vsData.findIndex(function(it){return it&&it.t==='r'&&it.i===i});
  if(p<0||!_vsWrapEl)return;
  _vsWrapEl.scrollTop=Math.max(0,p*VS_ROW_H-_vsWrapEl.clientHeight/2);_vsRender();
}

/* ═══ 값 메뉴 (이것만 · 빼기 · 복사) · 열 거르기 목록 ═══ */
function _wdCloseMenu(){var m=document.getElementById('wdMenu');if(m)m.remove();var b=document.getElementById('wdMenuBk');if(b)b.remove()}
function _wdPlace(m,anchor){
  if(wdMobile()){m.classList.add('sheet');var bk=document.createElement('div');bk.id='wdMenuBk';bk.className='wd-bk';bk.onclick=_wdCloseMenu;document.body.insertBefore(bk,m);return}
  var r=anchor.getBoundingClientRect(),w=m.offsetWidth,h=m.offsetHeight;
  var left=Math.max(8,Math.min(r.left,innerWidth-w-8)),top=r.bottom+4;
  if(top+h>innerHeight-8)top=Math.max(8,r.top-h-4);
  m.style.left=left+'px';m.style.top=top+'px';
}
function wdValMenu(el){
  _wdCloseMenu();
  var k=el.dataset.wk,v=el.dataset.wv;if(!k||!WD_KEYS[k])return;
  var shown=k==='date'?_wdDay(v):k==='name'?_wdNm(v):k==='abbr'?(v+(AM[v]?' · '+AM[v]:'')):v;
  var m=document.createElement('div');m.id='wdMenu';m.className='wd-menu';m.setAttribute('role','menu');
  m.innerHTML='<div class="wd-mh">'+WD_KEYS[k].i+' '+WD_KEYS[k].l+' <b>'+eH(shown||'(없음)')+'</b></div>'
    +'<button type="button" role="menuitem" data-act="only">🔍 이것만 보기</button>'
    +'<button type="button" role="menuitem" data-act="not">🚫 이것 빼기</button>'
    +'<button type="button" role="menuitem" data-act="copy">📋 복사</button>';
  m.addEventListener('click',function(e){var b=e.target.closest('[data-act]');if(!b)return;var a=b.dataset.act;
    if(a==='copy'){try{navigator.clipboard.writeText(v)}catch(x){}showToast('📋 복사했습니다');_wdCloseMenu();return}
    wdAdd(k,v,a==='not')});
  document.body.appendChild(m);_wdPlace(m,el);
}
function wdColMenu(k,anchor){if(_wdEditing())return;_wdCloseMenu();var m=document.createElement('div');m.id='wdMenu';m.className='wd-menu wd-cm';document.body.appendChild(m);_wdColFill(m,k);_wdPlace(m,anchor)}
function _wdColFill(m,k){
  var base=gF().filter(function(r){return _wdPass(r,false,k)});
  var cnt=new Map();base.forEach(function(r){var v=String(wdVal(r,k)),o=cnt.get(v);if(!o){o={c:0,h:0};cnt.set(v,o)}o.c++;o.h+=r.hours||0});
  var vals=Array.from(cnt.entries());
  vals.sort(k==='date'?function(a,b){return a[0].localeCompare(b[0])}:function(a,b){return b[1].h-a[1].h});
  var cur=wdF.find(function(x){return x.k===k&&!x.not&&!x.g}),sel=new Set(cur?cur.vs:[]);
  var tx=function(v){return k==='date'?_wdDay(v):k==='name'?_wdNm(v):k==='abbr'?v+(AM[v]?' · '+AM[v]:''):v};
  m.dataset.k=k;
  m.innerHTML='<div class="wd-cm-tabs">'+Object.keys(WD_KEYS).map(function(kk){return'<button type="button" class="'+(kk===k?'on':'')+'" data-ck="'+kk+'">'+WD_KEYS[kk].i+' '+WD_KEYS[kk].l+'</button>'}).join('')+'</div>'
    +(vals.length>8?'<input class="wd-cm-q" type="search" placeholder="찾기">':'')
    +'<div class="wd-cm-list">'+(vals.map(function(e){return'<label class="wd-cm-row" data-t="'+eH(String(tx(e[0])).toLowerCase())+'"><input type="checkbox" value="'+eH(e[0])+'"'+(sel.has(e[0])?' checked':'')+'><span class="wd-cm-t">'+eH(tx(e[0])||'(없음)')+'</span><span class="wd-cm-c">'+e[1].c+'건 · '+_wdH(e[1].h)+'h</span></label>'}).join('')||'<div class="wd-hint">값 없음</div>')+'</div>'
    +'<div class="wd-cm-ft"><span class="wd-cm-n">'+vals.length+'개</span><button type="button" class="btn btn-g btn-s" data-act="none">해제</button><button type="button" class="btn btn-p btn-s" data-act="ok">적용</button></div>';
  m.onclick=function(e){
    var t=e.target.closest('[data-ck]');if(t){_wdColFill(m,t.dataset.ck);return}
    var b=e.target.closest('[data-act]');if(!b)return;
    var vs=b.dataset.act==='ok'?Array.from(m.querySelectorAll('.wd-cm-list input:checked')).map(function(i){return i.value}):[];
    wdF=wdF.filter(function(x){return!(x.k===k&&!x.not&&!x.g)});
    if(vs.length&&vs.length<vals.length)wdF.push({k:k,vs:vs});
    _wdChanged();
  };
  var q=m.querySelector('.wd-cm-q');
  if(q)q.oninput=function(){var s=q.value.trim().toLowerCase();m.querySelectorAll('.wd-cm-row').forEach(function(r){r.style.display=!s||r.dataset.t.indexOf(s)>=0?'':'none'})};
}

/* ═══ 이벤트 — 묶음 머리 누르기 · 값 누르기(PC) / 길게 누르기(휴대폰) · 격자 칸 · 뒤로 ═══ */
var _wdLP=false,_wdLPT=0,_wdLPXY=null,_wdSw=null;
document.addEventListener('click',function(e){
  var t=document.getElementById('tTbl');if(!t||!t.contains(e.target))return;
  if(_wdLP){_wdLP=false;e.preventDefault();e.stopPropagation();return}
  if(typeof editMode!=='undefined'&&editMode)return;
  var g=e.target.closest('[data-wdg]');if(g){wdToggle(g.dataset.wdg);return}
  var gc=e.target.closest('[data-gd]');if(gc){wdGridPick(gc.dataset.gn,gc.dataset.gd);return}
  var v=e.target.closest('[data-wk]');if(v&&!wdMobile())wdValMenu(v);
},true);
document.addEventListener('pointerdown',function(e){var m=document.getElementById('wdMenu');if(m&&!m.contains(e.target)&&e.target.id!=='wdMenuBk')_wdCloseMenu()},true);
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){_wdCloseMenu();return}
  if(e.key!=='Backspace'||!wdF.length)return;
  var a=document.activeElement;if(a&&(/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)||a.isContentEditable))return;
  var t=document.getElementById('tTbl');if(!t||!t.offsetParent)return;
  e.preventDefault();wdPop();
});
document.addEventListener('touchstart',function(e){
  var t0=e.touches[0];if(!t0)return;
  var tt=document.getElementById('tTbl');if(!tt||!tt.offsetParent)return;
  if(wdF.length&&t0.clientX<24)_wdSw=[t0.clientX,t0.clientY];
  var v=e.target.closest&&e.target.closest('#tTbl [data-wk]');if(!v||(typeof editMode!=='undefined'&&editMode))return;
  _wdLPXY=[t0.clientX,t0.clientY];clearTimeout(_wdLPT);
  _wdLPT=setTimeout(function(){_wdLP=true;setTimeout(function(){_wdLP=false},700);try{if(navigator.vibrate)navigator.vibrate(12)}catch(x){}wdValMenu(v)},450);
},{passive:true});
document.addEventListener('touchmove',function(e){var t0=e.touches[0];if(_wdLPXY&&t0&&(Math.abs(t0.clientX-_wdLPXY[0])>10||Math.abs(t0.clientY-_wdLPXY[1])>10))clearTimeout(_wdLPT)},{passive:true});
document.addEventListener('touchend',function(e){
  clearTimeout(_wdLPT);_wdLPXY=null;
  if(_wdSw){var t0=e.changedTouches[0],dx=t0.clientX-_wdSw[0],dy=t0.clientY-_wdSw[1];_wdSw=null;if(dx>80&&Math.abs(dy)<60)wdPop()}
},{passive:true});
document.addEventListener('contextmenu',function(e){if(wdMobile()&&e.target.closest&&e.target.closest('#tTbl [data-wk]'))e.preventDefault()});
(function(){if(!window.matchMedia)return;var mq=matchMedia('(max-width:700px)');var h=function(){if(_wdLastF&&_wdLastF.length&&!(typeof editMode!=='undefined'&&editMode)){_wdCloseMenu();wdRender(_wdLastF)}};if(mq.addEventListener)mq.addEventListener('change',h);else if(mq.addListener)mq.addListener(h)})();
