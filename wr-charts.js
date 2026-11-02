/* wr-charts.js — 차트 이미지 저장 · 업무 내용 요약 · 📊 분석 진입(wr-analytics.js) · 비교 차트
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
  if (typeof wmLibRetry === 'function' && wmLibRetry('html2canvas', saveChartImg, this, arguments)) return;   // 무거운 도구는 처음 쓸 때 받음 (v13.310)
  document.querySelectorAll('.cht-save-menu.show').forEach(function(m){m.classList.remove('show')});
  var el=document.getElementById(targetId);if(!el)return;
  var title=el.querySelector('h3,h4');
  if(!title&&el.parentElement)title=el.parentElement.querySelector('h3,h4');
  var fname='차트_'+(title?title.textContent.replace(/[^\w가-힣]/g,'').slice(0,20):'export')+'_'+localDate();

  if(mode==='panel'){
    // 패널 전체 캡처 (배경·테두리 포함)
    if(typeof html2canvas==='undefined'){showToast('html2canvas 로딩 중...','warn');return}
    var captureEl=el.closest('.sc,.wa-card')||el.parentElement||el;
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
    var cvs=el.querySelector('canvas')||el.closest('.sc,.wa-card').querySelector('canvas');
    if(!cvs){
      // canvas가 없는 패널 (인원별 분포, 업체 대응별 시간 등) → html2canvas 사용
      if(typeof html2canvas==='undefined'){showToast('html2canvas 로딩 중...','warn');return}
      var captureEl2=el.closest('.sc,.wa-card')||el;
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
  const f=typeof wdApply==='function'?wdApply(gF()):gF();   // v13.266 표 안 부분 필터도
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
/* ═══ 📊 분석 (v13.312) — wr-analytics.js 의 waRender ═══
 * 예전 도넛 · 일별 누적막대(Chart.js) · 월별 비교 고르기 패널은 걷어 내고 한 장의 분석 화면으로 (8h 미달은 휴가로 채우지 않고 따로 보여 줌) */
function rCht(f){if(typeof waRender==='function')waRender(f)}
function sTab(t){document.querySelectorAll('#statsS .tab').forEach(x=>x.classList.toggle('on',x.dataset.t===t));document.getElementById('tTbl').classList.toggle('hidden',t!=='tbl');document.getElementById('tCht').classList.toggle('hidden',t!=='cht');document.getElementById('tAi').classList.toggle('hidden',t!=='ai');document.getElementById('tSum').classList.toggle('hidden',t!=='sum');if(t!=='cht')destroyCharts();if(t==='cht')rCht(typeof wdApply==='function'?wdApply(gF()):gF());if(t==='sum')rContentSum();if(typeof wvSave==='function')wvSave()}

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

