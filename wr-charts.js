/* wr-charts.js — 차트 이미지 저장 · 업무 내용 요약 · 주간 차트 · 월별 추이(개인/코드) · 비교 차트
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ CHART IMAGE SAVE ═══ */
function toggleChartMenu(btn){
  var menu=btn.nextElementSibling;
  var isOpen=menu.classList.contains('show');
  document.querySelectorAll('.cht-save-menu.show').forEach(function(m){m.classList.remove('show')});
  if(isOpen)return;
  var targetId=menu.dataset.target;
  menu.innerHTML=
    '<div onclick="saveChartImg(\''+targetId+'\',\'panel\')">🖼 배경·테두리 포함</div>'+
    '<hr>'+
    '<div onclick="saveChartImg(\''+targetId+'\',\'white\')">⬜ 흰색 배경</div>'+
    '<div onclick="saveChartImg(\''+targetId+'\',\'black\')">⬛ 검정 배경</div>';
  menu.classList.add('show');
}
document.addEventListener('click',function(e){
  if(!e.target.closest('.cht-save-wrap'))document.querySelectorAll('.cht-save-menu.show').forEach(function(m){m.classList.remove('show')});
});

function saveChartImg(targetId,mode){
  document.querySelectorAll('.cht-save-menu.show').forEach(function(m){m.classList.remove('show')});
  var el=document.getElementById(targetId);if(!el)return;
  var title=el.querySelector('h3,h4');
  if(!title&&el.parentElement)title=el.parentElement.querySelector('h3,h4');
  var fname='차트_'+(title?title.textContent.replace(/[^\w가-힣]/g,'').slice(0,20):'export')+'_'+localDate();

  if(mode==='panel'){
    // 패널 전체 캡처 (배경·테두리 포함)
    if(typeof html2canvas==='undefined'){showToast('html2canvas 로딩 중...','warn');return}
    var captureEl=el.closest('.sc')||el.parentElement||el;
    // 저장 버튼 임시 숨기기
    var saveBtns=captureEl.querySelectorAll('.cht-save-wrap');
    saveBtns.forEach(function(b){b.style.display='none'});
    html2canvas(captureEl,{
      backgroundColor:null,
      scale:2,
      useCORS:true,
      logging:false
    }).then(function(canvas){
      saveBtns.forEach(function(b){b.style.display=''});
      downloadCanvas(canvas,fname+'.png');
    }).catch(function(err){
      saveBtns.forEach(function(b){b.style.display=''});
      console.error(err);showToast('캡처 실패','warn');
    });
  }else{
    // 흰색/검정 배경: canvas 직접 추출
    var cvs=el.querySelector('canvas')||el.closest('.sc').querySelector('canvas');
    if(!cvs){
      // canvas가 없는 패널 (인원별 분포, 업체 대응별 시간 등) → html2canvas 사용
      if(typeof html2canvas==='undefined'){showToast('html2canvas 로딩 중...','warn');return}
      var captureEl2=el.closest('.sc')||el;
      var saveBtns2=captureEl2.querySelectorAll('.cht-save-wrap');
      saveBtns2.forEach(function(b){b.style.display='none'});
      html2canvas(captureEl2,{backgroundColor:mode==='white'?'#FFFFFF':'#000000',scale:2,useCORS:true,logging:false}).then(function(canvas){
        saveBtns2.forEach(function(b){b.style.display=''});
        downloadCanvas(canvas,fname+'.png');
      }).catch(function(err){
        saveBtns2.forEach(function(b){b.style.display=''});
        showToast('캡처 실패','warn');
      });
      return;
    }
    var pad=24;
    var labelH=title?30:0;
    var tmp=document.createElement('canvas');
    tmp.width=cvs.width+pad*2;
    tmp.height=cvs.height+pad*2+labelH;
    var ctx=tmp.getContext('2d');
    ctx.fillStyle=mode==='white'?'#FFFFFF':'#000000';
    ctx.fillRect(0,0,tmp.width,tmp.height);
    if(title){
      ctx.fillStyle=mode==='white'?'#333333':'#E0E0E0';
      ctx.font='bold '+Math.round(14*(cvs.width/400))+'px "Noto Sans KR",sans-serif';
      ctx.fillText(title.textContent.trim(),pad,pad+Math.round(14*(cvs.width/400)));
    }
    ctx.drawImage(cvs,pad,pad+labelH);
    downloadCanvas(tmp,fname+'.png');
  }
}

function downloadCanvas(canvas,filename){
  var link=document.createElement('a');
  link.download=filename;
  link.href=canvas.toDataURL('image/png');
  link.click();
  showToast('이미지 저장 완료','success');
}

function rContentSum(){
  const el=document.getElementById('contentSummary');
  // 필터 반영: 현재 필터(수주/분장/검색/주차/부서/휴가제외 등)가 적용된 데이터 — gF()와 동일 기준
  const f=gF();
  if(!f.length){el.innerHTML='<div style="text-align:center;color:var(--t6);padding:30px;font-size:12px">'+(sN.size===0?'팀원을 선택하면':'필터 조건에 맞는')+' 업무 내용 요약이 표시됩니다.</div>';return}
  const byPerson={};
  f.forEach(r=>{
    if(!byPerson[r.name])byPerson[r.name]={h:0,byOrder:{},byAbbr:{},contents:[],orderSet:new Set()};
    byPerson[r.name].h+=r.hours;
    const oKey=r.orderNo;
    if(!byPerson[r.name].byOrder[oKey])byPerson[r.name].byOrder[oKey]={h:0,items:[]};
    byPerson[r.name].byOrder[oKey].h+=r.hours;
    byPerson[r.name].byOrder[oKey].items.push(r.content);
    if(!byPerson[r.name].byAbbr[r.abbr])byPerson[r.name].byAbbr[r.abbr]=0;
    byPerson[r.name].byAbbr[r.abbr]+=r.hours;
    byPerson[r.name].contents.push(r.content);
    if(/[A-Za-z]/.test(r.orderNo)&&/\d/.test(r.orderNo))byPerson[r.name].orderSet.add(r.orderNo);
  });
  let html='';
  Object.entries(byPerson).sort(([,a],[,b])=>b.h-a.h).forEach(([name,info])=>{
    const ni=aN.indexOf(name);const c=COL[ni%COL.length];
    const abbrEntries=Object.entries(info.byAbbr).sort(([,a],[,b])=>b-a);
    const topAbbr=abbrEntries[0];
    const abbrCount=abbrEntries.length;
    const topRatio=topAbbr?Math.round(topAbbr[1]/info.h*100):0;

    // ── 3줄 요약 분석 ──
    // 1) 주 치중업무
    const focusAbbr=topAbbr?(AM[topAbbr[0]]||topAbbr[0]):'없음';
    const topOrders=Object.entries(info.byOrder).sort(([,a],[,b])=>b.h-a.h).slice(0,2);
    const topOrderStr=topOrders.map(([o,oi])=>{const nm=getOCmt(o);return(nm||o)+' '+Math.round(oi.h*10)/10+'h'}).join(', ');
    const focusLine=`🎯 주 치중: <b>${focusAbbr}</b> (${topRatio}%) — ${topOrderStr}`;

    // 2) 업무 분산도
    let spreadLevel,spreadColor;
    if(abbrCount>=4){spreadLevel='높음 (다방면)';spreadColor=SEM_COLOR.ok}
    else if(abbrCount>=2){
      if(topRatio>70){spreadLevel='편중 ('+focusAbbr+' 집중)';spreadColor=SEM_COLOR.warn}
      else{spreadLevel='보통';spreadColor='var(--ac-t)'}
    }else{spreadLevel='단일 업무 집중';spreadColor=SEM_COLOR.danger}
    const orderCnt=info.orderSet.size;
    const spreadLine=`📊 분산도: <b style="color:${spreadColor}">${spreadLevel}</b> — ${abbrCount}개 분장, ${orderCnt}개 수주 투입`;

    // 3) 난이도 추정 (키워드 기반 휴리스틱)
    const allContent=info.contents.join(' ').toLowerCase();
    let diffScore=0;let diffTags=[];
    const diffKeywords=DIFF_KEYWORDS;
    diffKeywords.forEach(dk=>{
      if(dk.kw.some(k=>allContent.includes(k))){diffScore+=dk.w;diffTags.push(dk.tag)}
    });
    // 시간 대비 건수로 복잡도 가중
    const avgHPerTask=info.h/Object.values(info.byOrder).reduce((s,o)=>s+new Set(o.items).size,0);
    if(avgHPerTask>=4)diffScore+=2;
    let diffLabel,diffIcon;
    if(diffScore>=8){diffLabel='높음';diffIcon='🔴'}
    else if(diffScore>=4){diffLabel='중간';diffIcon='🟡'}
    else{diffLabel='낮음';diffIcon='🟢'}
    const tagStr=diffTags.length?diffTags.slice(0,4).join(', '):'일반';
    const diffLine=`${diffIcon} 난이도: <b>${diffLabel}</b> — ${tagStr} (건당 평균 ${Math.round(avgHPerTask*10)/10}h)`;

    html+='<div style="margin-bottom:14px;padding:12px;background:var(--bg-i);border-radius:8px;border-left:3px solid '+c+'">';
    const dnCS=typeof shortName==='function'?shortName(name):name;
    html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:12px;font-weight:700;color:'+c+'" title="'+eH(name)+'">'+eH(dnCS)+'</span><span style="font-size:11px;color:var(--t4)">'+Math.round(info.h*10)/10+'h</span></div>';

    // 3줄 요약 박스
    html+='<div style="margin-bottom:10px;padding:8px 10px;background:var(--bg-p);border-radius:6px;border:1px solid var(--bd);font-size:11px;line-height:1.8;color:var(--t3)">';
    html+=focusLine+'<br>'+spreadLine+'<br>'+diffLine;
    html+='</div>';

    // 수주별 상세
    Object.entries(info.byOrder).sort(([,a],[,b])=>b.h-a.h).forEach(([oNo,oInfo])=>{
      const ocmt=getOCmt(oNo);const uniqueItems=[...new Set(oInfo.items)];
      html+='<div style="margin-bottom:6px;padding:6px 8px;background:var(--bg-p);border-radius:5px">';
      html+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px"><span class="mono" style="font-size:10px;color:var(--ac-t);font-weight:600">'+eH(oNo)+'</span>';
      if(ocmt)html+='<span style="font-size:9px;color:var(--t5);font-style:italic">'+eH(ocmt)+'</span>';
      html+='<span class="mono" style="font-size:9px;color:var(--t6);margin-left:auto">'+Math.round(oInfo.h*10)/10+'h</span></div>';
      html+='<div style="font-size:11px;color:var(--t3);line-height:1.6">';
      uniqueItems.forEach(item=>{html+='<div style="padding:1px 0;display:flex;align-items:baseline;gap:4px"><span style="color:var(--ac);flex-shrink:0">·</span><span>'+eH(item)+'</span></div>'});
      html+='</div></div>';
    });
    html+='</div>';
  });
  el.innerHTML=html;
}
/* 평일 8시간 미달분을 V(휴가)로 자동 보정 — 업무분장 집계용 합성 레코드 생성 */
function _calcVacFill(rows){
  const byPD={};
  rows.forEach(r=>{
    const d=r.date;if(!d||String(d).length<8)return;
    const ds=String(d);
    const y=+ds.slice(0,4),mo=+ds.slice(4,6)-1,dd=+ds.slice(6,8);
    const dt=new Date(y,mo,dd);if(isNaN(dt.getTime()))return;
    const wd=dt.getDay();if(wd===0||wd===6)return;
    const k=(r.name||'')+'|'+ds;
    if(!byPD[k])byPD[k]={name:r.name,date:ds,sum:0};
    byPD[k].sum+=Number(r.hours)||0;
  });
  const out=[];
  Object.keys(byPD).forEach(k=>{
    const m=byPD[k];const gap=8-m.sum;
    if(gap>0.05)out.push({name:m.name,date:m.date,orderNo:'',hours:Math.round(gap*10)/10,taskType:(typeof AM!=='undefined'&&AM.V)||'V(휴가)',abbr:'V',content:'[자동] 휴가 보정',_synth:true});
  });
  return out;
}
function rCht(f){if(!f.length)return;const tc=gTC();const _skipVac=!!cKw||!!excludeVac||sO.size>0||sON.size>0||sCL.size>0||(sT.size>0&&!sT.has('V'));const _vac=_skipVac?[]:_calcVacFill(f);const fA=_vac.length?f.concat(_vac):f;const tm={};Object.keys(AM).forEach(function(k){tm[k]=0});let tH=0;fA.forEach(r=>{tm[r.abbr]=(tm[r.abbr]||0)+r.hours;tH+=r.hours});const ts=Object.entries(tm).map(([k,v])=>({a:k,n:AM[k]||k,v:Math.round(v*10)/10,p:tH>0?Math.round(v/tH*1000)/10:0})).sort((a,b)=>b.v-a.v);if(pC)pC.destroy();pC=new Chart(document.getElementById('pieC').getContext('2d'),{type:'doughnut',data:{labels:ts.map(s=>s.n),datasets:[{data:ts.map(s=>s.v),backgroundColor:ts.map(s=>getABR(s.a)),borderWidth:0}]},options:{responsive:true,maintainAspectRatio:true,cutout:'55%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed+' h'}}}}});document.getElementById('pieL').innerHTML=ts.map((s,i)=>'<div style="display:flex;align-items:center;gap:8px"><span style="width:9px;height:9px;border-radius:3px;background:'+getABR(s.a)+'"></span><span style="flex:1;font-size:12px;color:var(--t3)">'+s.n+'</span><span class="mono" style="color:var(--t4)">'+s.v+'h</span><span class="mono" style="color:var(--ac-t);width:44px;text-align:right">'+s.p+'%</span></div>').join('');
const ps=document.getElementById('perS');ps.classList.remove('hidden');document.getElementById('pieS').style.gridColumn='';const pm={};fA.forEach(r=>{if(!pm[r.name])pm[r.name]={t:0,a:{}};pm[r.name].t+=r.hours;pm[r.name].a[r.abbr]=(pm[r.name].a[r.abbr]||0)+r.hours});const pp=Object.entries(pm).map(([n,s])=>({n,...s})).sort((a,b)=>a.n.localeCompare(b.n,'ko'));
// 1명: 제목을 "업무분장별 시간"으로, 다중: "인원별 분포"
document.querySelector('#perS h3').textContent=sN.size>1?'인원별 분포':'업무분장별 시간';
document.getElementById('perB').innerHTML=pp.map(p=>{const ni=aN.indexOf(p.n);const bars=Object.entries(p.a).sort(([a],[b])=>a.localeCompare(b)).map(([ab,hr])=>'<div style="width:'+hr/p.t*100+'%;background:'+(ABR[ab]||'#64748B')+'" title="'+(AM[ab]||ab)+': '+hr+'h"></div>').join('');return'<div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px"><span style="font-size:11px;color:var(--t3);display:flex;align-items:center;gap:5px"><span style="width:5px;height:5px;border-radius:50%;background:'+COL[aN.indexOf(p.n)%COL.length]+'"></span>'+eH(p.n)+'</span><span class="mono" style="font-size:10px;color:var(--t4)">'+Math.round(p.t*10)/10+'h</span></div><div style="display:flex;height:7px;border-radius:3px;overflow:hidden;background:var(--pt)">'+bars+'</div></div>'}).join('');document.getElementById('abL').innerHTML=Object.keys(AM).map(a=>'<span style="font-size:9px;color:var(--t5);display:flex;align-items:center;gap:3px"><span style="width:7px;height:7px;border-radius:2px;background:'+ABR[a]+'"></span>'+(AM[a]||a)+'</span>').join('')
const dm={};fA.forEach(r=>{if(!dm[r.date])dm[r.date]={};dm[r.date][r.abbr]=(dm[r.date][r.abbr]||0)+r.hours});const de=Object.entries(dm).sort(([a],[b])=>a.localeCompare(b));const ak=Object.keys(AM).sort();if(bC)bC.destroy();bC=new Chart(document.getElementById('barC').getContext('2d'),{type:'bar',data:{labels:de.map(([d])=>fD(d)),datasets:ak.map(k=>({label:AM[k]||k,data:de.map(([,v])=>v[k]||0),backgroundColor:ABR[k]||'#64748B',borderRadius:3,borderSkipped:'bottom'}))},options:{responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true,ticks:{color:tc.t,font:{size:10}},grid:{color:tc.g}},y:{stacked:true,ticks:{color:tc.t,font:{size:10},callback:v=>v+'h'},grid:{color:tc.g}}},plugins:{legend:{labels:{color:tc.l,font:{size:10}}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+'h'}}}}})
/* ═══ 업체별 차트 ═══ */
const hideUn=document.getElementById('hideUnassignedClient')&&document.getElementById('hideUnassignedClient').checked;
const cm={};let cTH=0;f.forEach(r=>{
  const cl=r.oclient || getOClient(r.orderNo) || '(미지정)';
  if(hideUn&&cl==='(미지정)')return;
  cm[cl]=(cm[cl]||0)+r.hours;
  cTH+=r.hours
});
const cs=Object.entries(cm).map(([k,v])=>({n:k,v:Math.round(v*10)/10,p:cTH>0?Math.round(v/cTH*1000)/10:0})).sort((a,b)=>b.v-a.v);
// 1) 업체 대응 비율 도넛
if(clPieC)clPieC.destroy();clPieC=new Chart(document.getElementById('clientPieC').getContext('2d'),{type:'doughnut',data:{labels:cs.map(s=>s.n),datasets:[{data:cs.map(s=>s.v),backgroundColor:cs.map((_,i)=>COL[i%COL.length]),borderWidth:0}]},options:{responsive:true,maintainAspectRatio:true,cutout:'55%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed+' h'}}}}});
document.getElementById('clientPieL').innerHTML=cs.map((s,i)=>'<div style="display:flex;align-items:center;gap:8px"><span style="width:9px;height:9px;border-radius:3px;background:'+COL[i%COL.length]+'"></span><span style="flex:1;font-size:12px;color:var(--t3)">'+eH(s.n)+'</span><span class="mono" style="color:var(--t4)">'+s.v+'h</span><span class="mono" style="color:var(--ac-t);width:44px;text-align:right">'+s.p+'%</span></div>').join('');
// 2) 업체 대응별 시간 바
const maxClH=cs.length?cs[0].v:1;
document.getElementById('clientBarB').innerHTML=cs.map((s,i)=>'<div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px"><span style="font-size:11px;color:var(--t3);display:flex;align-items:center;gap:5px"><span style="width:5px;height:5px;border-radius:50%;background:'+COL[i%COL.length]+'"></span>'+eH(s.n)+'</span><span class="mono" style="font-size:10px;color:var(--t4)">'+s.v+'h ('+s.p+'%)</span></div><div style="height:7px;border-radius:3px;overflow:hidden;background:var(--pt)"><div style="width:'+Math.round(s.v/maxClH*100)+'%;height:100%;background:'+COL[i%COL.length]+';border-radius:3px"></div></div></div>').join('');
// 3) 일별 업체 투입시간 스택 바
const cdm={};f.forEach(r=>{const cl=r.oclient||getOClient(r.orderNo)||'(미지정)';if(hideUn&&cl==='(미지정)')return;if(!cdm[r.date])cdm[r.date]={};cdm[r.date][cl]=(cdm[r.date][cl]||0)+r.hours});
const cde=Object.entries(cdm).sort(([a],[b])=>a.localeCompare(b));const ck=cs.map(s=>s.n);
if(clDayC)clDayC.destroy();clDayC=new Chart(document.getElementById('clientDayC').getContext('2d'),{type:'bar',data:{labels:cde.map(([d])=>fD(d)),datasets:ck.map((k,i)=>({label:k,data:cde.map(([,v])=>Math.round((v[k]||0)*10)/10),backgroundColor:COL[i%COL.length],borderRadius:3,borderSkipped:'bottom'}))},options:{responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true,ticks:{color:tc.t,font:{size:10}},grid:{color:tc.g}},y:{stacked:true,ticks:{color:tc.t,font:{size:10},callback:v=>v+'h'},grid:{color:tc.g}}},plugins:{legend:{labels:{color:tc.l,font:{size:10}},position:'bottom'},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+'h'}}}}})}

function sTab(t){document.querySelectorAll('#statsS .tab').forEach(x=>x.classList.toggle('on',x.dataset.t===t));document.getElementById('tTbl').classList.toggle('hidden',t!=='tbl');document.getElementById('tCht').classList.toggle('hidden',t!=='cht');document.getElementById('tAi').classList.toggle('hidden',t!=='ai');document.getElementById('tSum').classList.toggle('hidden',t!=='sum');if(t!=='cht')destroyCharts();if(t==='cht'){destroyCharts();const f=gF();if(f.length>0)rCht(f);mtrInit();mtrCInit()}if(t==='sum')rContentSum()}

/* ═══ 월별 비교 (개인별 추이) — 2~6개월, 인원·코드 체크박스 ═══ */
const _mtrTop2PctPlugin={
  id:'mtrTop2Pct',
  afterDatasetsDraw:function(chart){
    var ctx=chart.ctx;var datasets=chart.data.datasets;var labels=chart.data.labels||[];
    var barIdx=[];for(var i=0;i<datasets.length;i++){var ty=datasets[i].type||(chart.config&&chart.config.type);if(ty==='bar')barIdx.push(i)}
    if(!barIdx.length)return;
    for(var xi=0;xi<labels.length;xi++){
      var items=[],total=0;
      for(var k=0;k<barIdx.length;k++){var di=barIdx[k];var v=datasets[di].data[xi];if(v==null||!isFinite(v))continue;items.push({idx:di,val:v});total+=v}
      if(total<=0)continue;
      items.sort(function(a,b){return b.val-a.val});
      var top=items.slice(0,2);
      for(var t2=0;t2<top.length;t2++){
        var it=top[t2];var pct=it.val/total*100;if(pct<5)continue;
        var meta=chart.getDatasetMeta(it.idx);var bar=meta&&meta.data?meta.data[xi]:null;if(!bar)continue;
        var props=bar.getProps?bar.getProps(['x','y','base'],true):{x:bar.x,y:bar.y,base:bar.base};
        var cx=props.x,cy=(props.y+props.base)/2,h=Math.abs(props.base-props.y);
        if(h<14)continue;
        ctx.save();
        ctx.fillStyle='#FFFFFF';ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.shadowColor='rgba(0,0,0,.55)';ctx.shadowBlur=2;
        ctx.fillText(Math.round(pct)+'%',cx,cy);
        ctx.restore();
      }
    }
  }
};
let mtrSelMembers=new Set();
let mtrSelCodes=new Set();
function _mtrYM(d){return d&&d.length>=6?d.slice(0,4)+'-'+d.slice(4,6):''}
function _mtrDiffMonths(a,b){if(!a||!b)return 0;return (b.y-a.y)*12+(b.m-a.m)+1}
function _mtrEnumerate(a,b){var out=[],y=a.y,m=a.m;while(y<b.y||(y===b.y&&m<=b.m)){out.push(y+'-'+String(m).padStart(2,'0'));m++;if(m>12){m=1;y++}}return out}
function mtrInit(){
  if(typeof aD==='undefined'||!aD||!aD.length)return;
  var fy=document.getElementById('mtrFromYear');if(!fy)return;
  // 사용 가능한 YYYY-MM 목록
  var ymSet={};aD.forEach(function(r){var k=_mtrYM(r.date);if(k)ymSet[k]=1});
  var ymList=Object.keys(ymSet).sort();
  if(!ymList.length){fy.innerHTML='<option value="">-</option>';return}
  var years={};ymList.forEach(function(k){years[k.slice(0,4)]=1});
  var yArr=Object.keys(years).sort();
  var months=['01','02','03','04','05','06','07','08','09','10','11','12'];
  function fillYear(sel,defVal){sel.innerHTML=yArr.map(function(y){return '<option value="'+y+'"'+(y===defVal?' selected':'')+'>'+y+'</option>'}).join('')}
  function fillMon(sel,defVal){sel.innerHTML=months.map(function(m){return '<option value="'+m+'"'+(m===defVal?' selected':'')+'>'+(+m)+'월</option>'}).join('')}
  // 기본값: 마지막 3개월 ([n-2..n])
  var last=ymList[ymList.length-1];
  var lastY=last.slice(0,4),lastM=last.slice(5,7);
  var firstObj={y:+lastY,m:+lastM-2};while(firstObj.m<1){firstObj.y--;firstObj.m+=12}
  var firstYStr=String(firstObj.y),firstMStr=String(firstObj.m).padStart(2,'0');
  var ty=document.getElementById('mtrToYear'),fm=document.getElementById('mtrFromMon'),tm=document.getElementById('mtrToMon');
  // 이미 사용자가 선택한 값이 있으면 보존
  var prev={fy:fy.value,fm:fm.value,ty:ty.value,tm:tm.value};
  fillYear(fy,prev.fy||firstYStr);fillMon(fm,prev.fm||firstMStr);
  fillYear(ty,prev.ty||lastY);fillMon(tm,prev.tm||lastM);
  // 인원 체크박스 — 처음이거나 멤버가 비어있으면 상단 선택과 동기화
  if(mtrSelMembers.size===0){
    if(typeof sN!=='undefined'&&sN.size>0)sN.forEach(function(n){mtrSelMembers.add(n)});
    else if(typeof aN!=='undefined')aN.slice(0,Math.min(6,aN.length)).forEach(function(n){mtrSelMembers.add(n)});
  }else{
    // aN에 더 이상 존재하지 않는 이름은 제거
    var aNSet=new Set(aN||[]);Array.from(mtrSelMembers).forEach(function(n){if(!aNSet.has(n))mtrSelMembers.delete(n)});
  }
  // 코드 체크박스 — 처음 진입 시 V 제외 전체 선택
  if(mtrSelCodes.size===0){Object.keys(AM).forEach(function(c){if(c!=='V')mtrSelCodes.add(c)})}
  mtrRenderMembers();mtrRenderCodes();mtrUpdateInfo()
}
function mtrRenderCodes(){
  var box=document.getElementById('mtrCodes');if(!box)return;
  var codes=Object.keys(AM);
  box.innerHTML=codes.map(function(c){
    var on=mtrSelCodes.has(c);
    var bg=ABG[c]||'#1A1F35',fg=AFG[c]||'#94A3B8',line=ABR[c]||'#64748B';
    return '<label class="mtr-code" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:3px 8px;border-radius:14px;cursor:pointer;background:'+(on?'rgba(59,130,246,.15)':'var(--lb)')+';border:1px solid '+(on?'var(--ac)':'var(--bd)')+';color:var(--t3)"><input type="checkbox" '+(on?'checked':'')+' onchange="mtrTogCode(\''+c+'\')" style="margin:0;cursor:pointer"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:'+line+'"></span><span class="badge" style="background:'+bg+';color:'+fg+';padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600">'+c+'</span></label>'
  }).join('');
  document.getElementById('mtrCodeCount').textContent='· '+mtrSelCodes.size+'개 선택';
}
function mtrTogCode(c){if(mtrSelCodes.has(c))mtrSelCodes.delete(c);else mtrSelCodes.add(c);mtrRenderCodes();if(mtrChart&&mtrSelMembers.size>0&&mtrSelCodes.size>0)mtrRun()}
function mtrSelAllCodes(){mtrSelCodes.clear();Object.keys(AM).forEach(function(c){mtrSelCodes.add(c)});mtrRenderCodes();if(mtrChart)mtrRun()}
function mtrDeAllCodes(){mtrSelCodes.clear();mtrRenderCodes()}
function mtrSelNoVacCodes(){mtrSelCodes.clear();Object.keys(AM).forEach(function(c){if(c!=='V')mtrSelCodes.add(c)});mtrRenderCodes();if(mtrChart)mtrRun()}
function mtrRenderMembers(){
  var box=document.getElementById('mtrMembers');if(!box)return;
  var list=(typeof aN!=='undefined'&&aN)?aN:[];
  if(!list.length){box.innerHTML='<div style="font-size:10.5px;color:var(--t6);padding:8px">데이터 없음</div>';return}
  box.innerHTML=list.map(function(n){
    var on=mtrSelMembers.has(n);
    var disp=typeof shortName==='function'?shortName(n):n;
    return '<label class="mtr-mem" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border-radius:14px;cursor:pointer;background:'+(on?'rgba(59,130,246,.15)':'var(--lb)')+';border:1px solid '+(on?'var(--ac)':'var(--bd)')+';color:'+(on?'var(--ac-t)':'var(--t3)')+'"><input type="checkbox" '+(on?'checked':'')+' onchange="mtrTogMember(\''+eA(n)+'\')" style="margin:0;cursor:pointer">'+eH(disp)+'</label>'
  }).join('');
  document.getElementById('mtrMemCount').textContent='· '+mtrSelMembers.size+'명 선택';
}
function mtrTogMember(n){if(mtrSelMembers.has(n))mtrSelMembers.delete(n);else mtrSelMembers.add(n);mtrRenderMembers();if(mtrChart&&mtrSelMembers.size>0)mtrRun()}
function mtrUseSelected(){mtrSelMembers.clear();if(typeof sN!=='undefined')sN.forEach(function(n){mtrSelMembers.add(n)});mtrRenderMembers();if(mtrChart&&mtrSelMembers.size>0)mtrRun();showToast('상단 선택 팀원 '+mtrSelMembers.size+'명을 적용했습니다.')}
function mtrSelAll(){mtrSelMembers.clear();(aN||[]).forEach(function(n){mtrSelMembers.add(n)});mtrRenderMembers();if(mtrChart)mtrRun()}
function mtrDeAll(){mtrSelMembers.clear();mtrRenderMembers()}
function mtrToggleLine(){if(mtrChart&&mtrSelMembers.size>0&&mtrSelCodes.size>0)mtrRun()}
function _mtrIsVac(r){if(!r)return false;if(r.abbr==='V'||r.abbr==='v')return true;var tt=String(r.taskType||'');return tt.indexOf('휴가')!==-1||tt.indexOf('연차')!==-1||tt.indexOf('반차')!==-1}
function mtrUpdateInfo(){
  var info=document.getElementById('mtrRangeInfo');if(!info)return;
  var fy=document.getElementById('mtrFromYear').value,fm=document.getElementById('mtrFromMon').value;
  var ty=document.getElementById('mtrToYear').value,tm=document.getElementById('mtrToMon').value;
  if(!fy||!fm||!ty||!tm){info.textContent='';return}
  var a={y:+fy,m:+fm},b={y:+ty,m:+tm};
  var diff=_mtrDiffMonths(a,b);
  if(diff<=0){info.textContent='⚠ 시작이 종료보다 이후입니다';info.style.color=SEM_COLOR.danger;return}
  if(diff<2){info.textContent='⚠ 최소 2개월 이상 필요 ('+diff+'개월)';info.style.color=SEM_COLOR.warn;return}
  if(diff>6){info.textContent='⚠ 최대 6개월까지 가능 ('+diff+'개월)';info.style.color=SEM_COLOR.warn;return}
  info.textContent='= '+diff+'개월';info.style.color='var(--ac-t)'
}
function mtrRun(){
  var fy=document.getElementById('mtrFromYear').value,fm=document.getElementById('mtrFromMon').value;
  var ty=document.getElementById('mtrToYear').value,tm=document.getElementById('mtrToMon').value;
  if(!fy||!fm||!ty||!tm){showToast('기간을 선택하세요.','warn');return}
  var a={y:+fy,m:+fm},b={y:+ty,m:+tm};
  var diff=_mtrDiffMonths(a,b);
  if(diff<2){showToast('최소 2개월 이상 선택하세요.','warn');return}
  if(diff>6){showToast('최대 6개월까지 선택할 수 있습니다.','warn');return}
  if(!mtrSelMembers.size){showToast('팀원을 1명 이상 선택하세요.','warn');return}
  if(!mtrSelCodes.size){showToast('분장 코드를 1개 이상 선택하세요.','warn');return}
  var ymList=_mtrEnumerate(a,b);
  var members=Array.from(mtrSelMembers).sort(function(x,y){return x.localeCompare(y,'ko')});
  var codes=Object.keys(AM).filter(function(c){return mtrSelCodes.has(c)});
  // 집계: data[member][code][ymKey] = hours
  var data={};
  members.forEach(function(n){data[n]={};codes.forEach(function(c){data[n][c]={};ymList.forEach(function(k){data[n][c][k]=0})})});
  aD.forEach(function(r){
    if(!r||!mtrSelMembers.has(r.name))return;
    var c=r.abbr;if(!c||!mtrSelCodes.has(c))return;
    if(c!=='V'&&_mtrIsVac(r))return;
    var k=_mtrYM(r.date);if(!k||ymList.indexOf(k)===-1)return;
    var h=parseFloat(r.hours);if(!isFinite(h))return;
    data[r.name][c][k]+=h
  });
  // 차트: 6슬롯 고정 (월별 그룹) + 각 인원 막대는 코드별 ABR 스택
  document.getElementById('mtrEmpty').classList.add('hidden');
  var chartWrap=document.getElementById('mtrChartWrap');
  chartWrap.classList.remove('hidden');
  var FULL_SLOTS=6;
  var paddedYm=ymList.slice();while(paddedYm.length<FULL_SLOTS)paddedYm.push('');
  var slotW=members.length>3?150:(members.length>1?115:90);
  chartWrap.style.width=(FULL_SLOTS*slotW)+'px';chartWrap.style.maxWidth='100%';
  var parent=chartWrap.parentNode;if(parent&&parent.style)parent.style.overflowX='auto';
  var tc=gTC();
  var showLine=!!(document.getElementById('mtrShowLine')&&document.getElementById('mtrShowLine').checked);
  if(mtrChart){try{mtrChart.destroy()}catch(e){}mtrChart=null}
  var ctx=document.getElementById('mtrChart').getContext('2d');
  // 라벨: (6슬롯 × 인원) 평탄화 — 빈 슬롯은 데이터 null
  var flatLabels=[];var personIdx=[];var monthIdx=[];
  paddedYm.forEach(function(k,mi){
    members.forEach(function(n,pi){
      var disp=typeof shortName==='function'?shortName(n):n;
      flatLabels.push(k?(members.length>1?(k+'\n'+disp):k):'');
      personIdx.push(n);monthIdx.push(mi);
    });
  });
  var barW=members.length>3?22:(members.length>1?32:42);
  var datasets=codes.map(function(c){
    var col=ABR[c]||'#64748B';
    return{
      type:'bar',label:AM[c]||c,_code:c,
      data:flatLabels.map(function(_,i){var k=ymList[monthIdx[i]];if(!k)return null;return Math.round(data[personIdx[i]][c][k]*10)/10}),
      backgroundColor:col,borderColor:col,borderWidth:0,borderSkipped:'bottom',
      barThickness:barW
    };
  });
  if(showLine){
    var totals=flatLabels.map(function(_,i){var k=ymList[monthIdx[i]];if(!k)return null;var s=0;codes.forEach(function(c){s+=data[personIdx[i]][c][k]});return Math.round(s*10)/10});
    datasets.push({type:'line',label:'합계',data:totals,borderColor:'#E2E8F0',backgroundColor:'rgba(226,232,240,.2)',borderWidth:2,pointRadius:3,pointHoverRadius:5,tension:.25,fill:false,order:0,spanGaps:false});
  }
  mtrChart=new Chart(ctx,{data:{labels:flatLabels,datasets:datasets},plugins:[_mtrTop2PctPlugin],options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    scales:{x:{stacked:true,ticks:{color:tc.t,font:{size:15},autoSkip:false,maxRotation:60,minRotation:members.length>1?40:0,callback:function(val,idx){var lab=this.getLabelForValue(val);return String(lab).split('\n')}},grid:{color:tc.g}},y:{stacked:true,beginAtZero:true,ticks:{color:tc.t,font:{size:15},callback:function(v){return v+'h'}},grid:{color:tc.g}}},
    plugins:{legend:{labels:{color:tc.l,font:{size:10},usePointStyle:true,pointStyle:'rect'}},
      tooltip:{callbacks:{
        title:function(items){if(!items.length)return '';var i=items[0].dataIndex;var disp=typeof shortName==='function'?shortName(personIdx[i]):personIdx[i];return ymList[monthIdx[i]]+' · '+disp},
        label:function(c){return c.dataset.label+': '+c.parsed.y+'h'}
      }}}}});
  // 표 — 인원 × 월 매트릭스 (각 셀은 모든 선택 코드 합)
  var tw=document.getElementById('mtrTblWrap');tw.classList.remove('hidden');
  var colTotals=ymList.map(function(){return 0});
  var rows=members.map(function(n){
    var disp=typeof shortName==='function'?shortName(n):n;
    var cells=ymList.map(function(k,i){var v=0;codes.forEach(function(c){v+=data[n][c][k]});v=Math.round(v*10)/10;colTotals[i]+=v;return '<td style="padding:5px 8px;text-align:right;color:var(--t3);font-variant-numeric:tabular-nums">'+v+'h</td>'}).join('');
    var sum=ymList.reduce(function(s,k){var v=0;codes.forEach(function(c){v+=data[n][c][k]});return s+v},0);
    return '<tr><td style="padding:5px 8px;color:var(--t2);font-weight:600;white-space:nowrap">'+eH(disp)+'</td>'+cells+'<td style="padding:5px 8px;text-align:right;color:var(--ac-t);font-weight:600;font-variant-numeric:tabular-nums">'+(Math.round(sum*10)/10)+'h</td></tr>'
  }).join('');
  var totRow='<tr style="border-top:1px solid var(--bd)"><td style="padding:5px 8px;color:var(--t4);font-weight:600">월합계</td>'+colTotals.map(function(t){return '<td style="padding:5px 8px;text-align:right;color:var(--t4);font-variant-numeric:tabular-nums">'+(Math.round(t*10)/10)+'h</td>'}).join('')+'<td style="padding:5px 8px;text-align:right;color:var(--ac-t);font-weight:700;font-variant-numeric:tabular-nums">'+(Math.round(colTotals.reduce(function(s,t){return s+t},0)*10)/10)+'h</td></tr>';
  tw.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--bg-i)"><th style="padding:6px 8px;text-align:left;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">팀원</th>'+ymList.map(function(k){return '<th style="padding:6px 8px;text-align:right;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">'+k+'</th>'}).join('')+'<th style="padding:6px 8px;text-align:right;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">합계</th></tr></thead><tbody>'+rows+totRow+'</tbody></table>';
}

/* ═══ 월별 비교 (업무분장 코드별 추이) — 2~6개월 범위, 코드 체크박스 ═══ */
let mtrCSelCodes=new Set();
function mtrCInit(){
  if(typeof aD==='undefined'||!aD||!aD.length)return;
  var fy=document.getElementById('mtrCFromYear');if(!fy)return;
  var ymSet={};aD.forEach(function(r){var k=_mtrYM(r.date);if(k)ymSet[k]=1});
  var ymList=Object.keys(ymSet).sort();
  if(!ymList.length){fy.innerHTML='<option value="">-</option>';return}
  var years={};ymList.forEach(function(k){years[k.slice(0,4)]=1});
  var yArr=Object.keys(years).sort();
  var months=['01','02','03','04','05','06','07','08','09','10','11','12'];
  function fillYear(sel,defVal){sel.innerHTML=yArr.map(function(y){return '<option value="'+y+'"'+(y===defVal?' selected':'')+'>'+y+'</option>'}).join('')}
  function fillMon(sel,defVal){sel.innerHTML=months.map(function(m){return '<option value="'+m+'"'+(m===defVal?' selected':'')+'>'+(+m)+'월</option>'}).join('')}
  var last=ymList[ymList.length-1];
  var lastY=last.slice(0,4),lastM=last.slice(5,7);
  var firstObj={y:+lastY,m:+lastM-2};while(firstObj.m<1){firstObj.y--;firstObj.m+=12}
  var firstYStr=String(firstObj.y),firstMStr=String(firstObj.m).padStart(2,'0');
  var ty=document.getElementById('mtrCToYear'),fm=document.getElementById('mtrCFromMon'),tm=document.getElementById('mtrCToMon');
  var prev={fy:fy.value,fm:fm.value,ty:ty.value,tm:tm.value};
  fillYear(fy,prev.fy||firstYStr);fillMon(fm,prev.fm||firstMStr);
  fillYear(ty,prev.ty||lastY);fillMon(tm,prev.tm||lastM);
  // 처음 진입 시 V 제외 전체 코드 선택
  if(mtrCSelCodes.size===0){Object.keys(AM).forEach(function(c){if(c!=='V')mtrCSelCodes.add(c)})}
  mtrCRenderCodes();mtrCUpdateInfo()
}
function mtrCRenderCodes(){
  var box=document.getElementById('mtrCCodes');if(!box)return;
  var codes=Object.keys(AM);
  box.innerHTML=codes.map(function(c){
    var on=mtrCSelCodes.has(c);
    var bg=ABG[c]||'#1A1F35',fg=AFG[c]||'#94A3B8',line=ABR[c]||'#64748B';
    return '<label class="mtr-code" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:3px 8px;border-radius:14px;cursor:pointer;background:'+(on?'rgba(59,130,246,.15)':'var(--lb)')+';border:1px solid '+(on?'var(--ac)':'var(--bd)')+';color:var(--t3)"><input type="checkbox" '+(on?'checked':'')+' onchange="mtrCTogCode(\''+c+'\')" style="margin:0;cursor:pointer"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:'+line+'"></span><span class="badge" style="background:'+bg+';color:'+fg+';padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600">'+c+'</span><span style="color:var(--t3)">'+(AM[c]||c).replace(/^[A-Z]\(|\)$/g,'').replace(c+'(','').replace(/\)$/,'')+'</span></label>'
  }).join('');
  document.getElementById('mtrCCodeCount').textContent='· '+mtrCSelCodes.size+'개 선택';
}
function mtrCTogCode(c){if(mtrCSelCodes.has(c))mtrCSelCodes.delete(c);else mtrCSelCodes.add(c);mtrCRenderCodes()}
function mtrCSelAll(){mtrCSelCodes.clear();Object.keys(AM).forEach(function(c){mtrCSelCodes.add(c)});mtrCRenderCodes()}
function mtrCDeAll(){mtrCSelCodes.clear();mtrCRenderCodes()}
function mtrCSelNoVac(){mtrCSelCodes.clear();Object.keys(AM).forEach(function(c){if(c!=='V')mtrCSelCodes.add(c)});mtrCRenderCodes()}
function mtrCSyncFromMtr(){
  var src=['mtrFromYear','mtrFromMon','mtrToYear','mtrToMon'];
  var dst=['mtrCFromYear','mtrCFromMon','mtrCToYear','mtrCToMon'];
  for(var i=0;i<src.length;i++){var s=document.getElementById(src[i]),d=document.getElementById(dst[i]);if(s&&d&&s.value)d.value=s.value}
  mtrCUpdateInfo()
}
function mtrCUpdateInfo(){
  var info=document.getElementById('mtrCRangeInfo');if(!info)return;
  var fy=document.getElementById('mtrCFromYear').value,fm=document.getElementById('mtrCFromMon').value;
  var ty=document.getElementById('mtrCToYear').value,tm=document.getElementById('mtrCToMon').value;
  if(!fy||!fm||!ty||!tm){info.textContent='';return}
  var a={y:+fy,m:+fm},b={y:+ty,m:+tm};
  var diff=_mtrDiffMonths(a,b);
  if(diff<=0){info.textContent='⚠ 시작이 종료보다 이후입니다';info.style.color=SEM_COLOR.danger;return}
  if(diff<2){info.textContent='⚠ 최소 2개월 이상 필요 ('+diff+'개월)';info.style.color=SEM_COLOR.warn;return}
  if(diff>6){info.textContent='⚠ 최대 6개월까지 가능 ('+diff+'개월)';info.style.color=SEM_COLOR.warn;return}
  info.textContent='= '+diff+'개월';info.style.color='var(--ac-t)'
}
function mtrCRun(){
  var fy=document.getElementById('mtrCFromYear').value,fm=document.getElementById('mtrCFromMon').value;
  var ty=document.getElementById('mtrCToYear').value,tm=document.getElementById('mtrCToMon').value;
  if(!fy||!fm||!ty||!tm){showToast('기간을 선택하세요.','warn');return}
  var a={y:+fy,m:+fm},b={y:+ty,m:+tm};
  var diff=_mtrDiffMonths(a,b);
  if(diff<2){showToast('최소 2개월 이상 선택하세요.','warn');return}
  if(diff>6){showToast('최대 6개월까지 선택할 수 있습니다.','warn');return}
  if(!mtrCSelCodes.size){showToast('분장 코드를 1개 이상 선택하세요.','warn');return}
  var ymList=_mtrEnumerate(a,b);
  // 정렬: AM 키 순서를 따름
  var codes=Object.keys(AM).filter(function(c){return mtrCSelCodes.has(c)});
  var data={};codes.forEach(function(c){data[c]={};ymList.forEach(function(k){data[c][k]=0})});
  aD.forEach(function(r){
    var c=r.abbr;if(!c||!mtrCSelCodes.has(c))return;
    var k=_mtrYM(r.date);if(!k||ymList.indexOf(k)===-1)return;
    data[c][k]+=(parseFloat(r.hours)||0)
  });
  document.getElementById('mtrCEmpty').classList.add('hidden');
  var chartWrapC=document.getElementById('mtrCChartWrap');
  chartWrapC.classList.remove('hidden');
  var FULL_SLOTS_C=6,SLOT_WC=110;
  chartWrapC.style.width=(FULL_SLOTS_C*SLOT_WC)+'px';chartWrapC.style.maxWidth='100%';
  var parentC=chartWrapC.parentNode;if(parentC&&parentC.style)parentC.style.overflowX='auto';
  var paddedYmC=ymList.slice();while(paddedYmC.length<FULL_SLOTS_C)paddedYmC.push('');
  var tc=gTC();
  var showLine=!!(document.getElementById('mtrCShowLine')&&document.getElementById('mtrCShowLine').checked);
  if(mtrCChart){try{mtrCChart.destroy()}catch(e){}mtrCChart=null}
  var ctx=document.getElementById('mtrCChart').getContext('2d');
  var datasets=codes.map(function(c){var col=ABR[c]||'#64748B';return{
    type:'bar',label:AM[c]||c,_code:c,
    data:paddedYmC.map(function(k){if(!k)return null;return Math.round(data[c][k]*10)/10}),
    backgroundColor:col,borderColor:col,borderWidth:0,borderRadius:0,borderSkipped:'bottom',
    barThickness:55
  }});
  if(showLine){
    var totals=paddedYmC.map(function(k){if(!k)return null;var s=0;codes.forEach(function(c){s+=data[c][k]});return Math.round(s*10)/10});
    datasets.push({type:'line',label:'월합계',data:totals,borderColor:'#E2E8F0',backgroundColor:'rgba(226,232,240,.2)',borderWidth:2,pointRadius:4,pointHoverRadius:6,tension:.3,fill:false,order:0,spanGaps:false});
  }
  mtrCChart=new Chart(ctx,{data:{labels:paddedYmC,datasets:datasets},plugins:[_mtrTop2PctPlugin],options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    scales:{x:{stacked:true,ticks:{color:tc.t,font:{size:15}},grid:{color:tc.g}},y:{stacked:true,beginAtZero:true,ticks:{color:tc.t,font:{size:15},callback:function(v){return v+'h'}},grid:{color:tc.g}}},
    plugins:{legend:{labels:{color:tc.l,font:{size:10},usePointStyle:true,pointStyle:'rect'}},
      tooltip:{callbacks:{label:function(c){return c.dataset.label+': '+c.parsed.y+'h'}}}}}});
  // 표
  var tw=document.getElementById('mtrCTblWrap');tw.classList.remove('hidden');
  var totals=ymList.map(function(){return 0});
  var rows=codes.map(function(c){
    var bg=ABG[c]||'#1A1F35',fg=AFG[c]||'#94A3B8';
    var cells=ymList.map(function(k,i){var v=Math.round(data[c][k]*10)/10;totals[i]+=v;return '<td style="padding:5px 8px;text-align:right;color:var(--t3);font-variant-numeric:tabular-nums">'+v+'h</td>'}).join('');
    var sum=ymList.reduce(function(s,k){return s+data[c][k]},0);
    return '<tr><td style="padding:5px 8px;color:var(--t2);font-weight:600;white-space:nowrap"><span class="badge" style="background:'+bg+';color:'+fg+';padding:1px 5px;border-radius:3px;font-size:10px;margin-right:5px">'+c+'</span>'+eH(AM[c]||c)+'</td>'+cells+'<td style="padding:5px 8px;text-align:right;color:var(--ac-t);font-weight:600;font-variant-numeric:tabular-nums">'+(Math.round(sum*10)/10)+'h</td></tr>'
  }).join('');
  var totRow='<tr style="border-top:1px solid var(--bd)"><td style="padding:5px 8px;color:var(--t4);font-weight:600">월합계</td>'+totals.map(function(t){return '<td style="padding:5px 8px;text-align:right;color:var(--t4);font-variant-numeric:tabular-nums">'+(Math.round(t*10)/10)+'h</td>'}).join('')+'<td style="padding:5px 8px;text-align:right;color:var(--ac-t);font-weight:700;font-variant-numeric:tabular-nums">'+(Math.round(totals.reduce(function(s,t){return s+t},0)*10)/10)+'h</td></tr>';
  tw.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--bg-i)"><th style="padding:6px 8px;text-align:left;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">분장</th>'+ymList.map(function(k){return '<th style="padding:6px 8px;text-align:right;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">'+k+'</th>'}).join('')+'<th style="padding:6px 8px;text-align:right;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">합계</th></tr></thead><tbody>'+rows+totRow+'</tbody></table>';
}
function mtrCToggleLine(){if(mtrCChart)mtrCRun()}

/* ═══ COMPARE (2D Chart.js) ═══ */
/* CMP_COL, CMP_DASH, CMP_PT → config.js */
let cmpBarChart=null,cmpLineChart=null,cmpPieCharts=[];

function rCmp(f){
  document.getElementById('cmpPanel').classList.remove('hidden');
  const names=[...sN].sort((a,b)=>a.localeCompare(b,'ko'));
  document.getElementById('cmpNames').textContent=names.map(n=>typeof shortName==='function'?shortName(n):n).join(' vs ');
  const pm={};const allDates=new Set();const abbrSet=new Set();
  f.forEach(r=>{
    if(!pm[r.name])pm[r.name]={h:0,a:{},dates:new Set(),rows:0};
    pm[r.name].h+=r.hours;pm[r.name].rows++;
    pm[r.name].a[r.abbr]=(pm[r.name].a[r.abbr]||0)+r.hours;
    pm[r.name].dates.add(r.date);allDates.add(r.date);abbrSet.add(r.abbr);
  });
  const sortedDates=[...allDates].sort();
  const abbrKeys=[...abbrSet].sort();
  const pCol={};names.forEach((n,i)=>{pCol[n]=CMP_COL[i%CMP_COL.length]});

  // Summary cards
  document.getElementById('cmpCards').innerHTML=names.map(name=>{
    const p=pm[name]||{h:0,a:{},dates:new Set(),rows:0};const c=pCol[name];
    const topAbbr=Object.entries(p.a).sort(([,a],[,b])=>b-a)[0];
    const avgD=p.dates.size>0?Math.round(p.h/p.dates.size*10)/10:0;
    return'<div class="sc" style="border-left:3px solid '+c+'"><div style="font-size:13px;font-weight:700;color:'+c+';margin-bottom:6px">'+eH(name)+'</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;color:var(--t4)"><div>총시간 <b style="color:var(--ac-t)">'+Math.round(p.h*10)/10+'h</b></div><div>건수 <b>'+p.rows+'</b></div><div>일수 <b>'+p.dates.size+'</b></div><div>일평균 <b style="color:'+(avgD>9?'var(--d-t)':SEM_COLOR.ok)+'">'+avgD+'h</b></div><div>주력 <b>'+(topAbbr?AM[topAbbr[0]]||topAbbr[0]:'-')+'</b></div></div></div>';
  }).join('');

  // Comparison table
  const thead=document.getElementById('cmpTHead'),tbody=document.getElementById('cmpTBody');
  const colW=Math.floor(80/names.length);
  thead.innerHTML='<tr><th style="width:90px;text-align:left">항목</th>'+names.map(n=>'<th style="color:'+pCol[n]+';text-align:center;width:'+colW+'%">'+eH(n)+'</th>').join('')+'</tr>';
  const rows=[];
  rows.push({l:'총 시간(h)',v:names.map(n=>pm[n]?Math.round(pm[n].h*10)/10:0)});
  rows.push({l:'건수',v:names.map(n=>pm[n]?pm[n].rows:0)});
  rows.push({l:'일수',v:names.map(n=>pm[n]?pm[n].dates.size:0)});
  rows.push({l:'일평균(h)',v:names.map(n=>{const p=pm[n];return p&&p.dates.size?Math.round(p.h/p.dates.size*10)/10:0})});
  abbrKeys.forEach(a=>{rows.push({l:AM[a]||a,v:names.map(n=>pm[n]&&pm[n].a[a]?Math.round(pm[n].a[a]*10)/10:0)})});
  tbody.innerHTML=rows.map(row=>{const mx=Math.max(...row.v);return'<tr><td style="font-size:11px;font-weight:600;color:var(--t4);text-align:left">'+row.l+'</td>'+row.v.map((v,vi)=>'<td class="mono" style="text-align:center;'+(v===mx&&mx>0?'color:'+pCol[names[vi]]+';font-weight:700':'color:var(--t3)')+'">'+v+'</td>').join('')+'</tr>'}).join('');

  // Bar chart: grouped
  const tc=gTC();
  if(cmpBarChart)cmpBarChart.destroy();
  cmpBarChart=new Chart(document.getElementById('cmpBarC').getContext('2d'),{
    type:'bar',
    data:{labels:abbrKeys.map(a=>AM[a]||a),datasets:names.map((name,i)=>({
      label:name,data:abbrKeys.map(a=>pm[name]&&pm[name].a[a]?Math.round(pm[name].a[a]*10)/10:0),
      backgroundColor:pCol[name],borderColor:pCol[name],borderWidth:1,borderRadius:3
    }))},
    options:{responsive:true,maintainAspectRatio:false,
      scales:{x:{ticks:{color:tc.t,font:{size:10}},grid:{color:tc.g}},y:{ticks:{color:tc.t,font:{size:10},callback:v=>v+'h'},grid:{color:tc.g}}},
      plugins:{legend:{labels:{color:tc.l,font:{size:10},usePointStyle:true,pointStyle:'rectRounded'}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+'h'}}}}
  });

  // Line chart: daily compare
  const dailyByP={};names.forEach(n=>{dailyByP[n]={};f.filter(r=>r.name===n).forEach(r=>{dailyByP[n][r.date]=(dailyByP[n][r.date]||0)+r.hours})});
  if(cmpLineChart)cmpLineChart.destroy();
  cmpLineChart=new Chart(document.getElementById('cmpLineC').getContext('2d'),{
    type:'line',
    data:{labels:sortedDates.map(d=>fD(d)),datasets:names.map((name,i)=>({
      label:name,data:sortedDates.map(d=>Math.round((dailyByP[name][d]||0)*10)/10),
      borderColor:pCol[name],backgroundColor:pCol[name]+'44',
      borderWidth:2.5,borderDash:CMP_DASH[i%CMP_DASH.length],
      pointRadius:5,pointHoverRadius:8,pointStyle:CMP_PT[i%CMP_PT.length],
      pointBackgroundColor:pCol[name],pointBorderColor:'#fff',pointBorderWidth:1.5,
      tension:0.3,fill:false
    }))},
    options:{responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      scales:{x:{ticks:{color:tc.t,font:{size:9}},grid:{color:tc.g}},y:{ticks:{color:tc.t,font:{size:10},callback:v=>v+'h'},grid:{color:tc.g}}},
      plugins:{legend:{labels:{color:tc.l,font:{size:10},usePointStyle:true}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+'h'}}}}
  });

  // Per-person pie charts
  cmpPieCharts.forEach(c=>c.destroy());cmpPieCharts=[];
  const piesDiv=document.getElementById('cmpPies');
  piesDiv.innerHTML=names.map((name,i)=>'<div class="sc" style="border-top:3px solid '+pCol[name]+';padding:12px;text-align:center"><div style="font-size:12px;font-weight:700;color:'+pCol[name]+';margin-bottom:8px">'+eH(name)+' ('+Math.round((pm[name]||{h:0}).h*10)/10+'h)</div><div style="width:160px;height:160px;margin:0 auto"><canvas id="cmpPie'+i+'"></canvas></div></div>').join('');
  names.forEach((name,i)=>{
    const p=pm[name];if(!p)return;
    const entries=abbrKeys.map(a=>({a,v:p.a[a]||0})).filter(x=>x.v>0);
    const ch=new Chart(document.getElementById('cmpPie'+i).getContext('2d'),{
      type:'doughnut',
      data:{labels:entries.map(e=>AM[e.a]||e.a),datasets:[{data:entries.map(e=>Math.round(e.v*10)/10),backgroundColor:entries.map(e=>ABR[e.a]||'#64748B'),borderWidth:0}]},
      options:{responsive:true,maintainAspectRatio:true,cutout:'50%',plugins:{legend:{display:true,position:'bottom',labels:{color:tc.l,font:{size:9},usePointStyle:true,pointStyle:'circle',padding:6}},tooltip:{callbacks:{label:c=>{const t=c.dataset.data.reduce((s,v)=>s+v,0);return c.label+': '+c.parsed+'h ('+Math.round(c.parsed/t*100)+'%)'}}}}}
    });
    cmpPieCharts.push(ch);
  });
}

