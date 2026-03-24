/* ═══ UI COMPONENTS ═══ */
let pC=null, bC=null, tC=null, clPieC=null, clDayC=null;
let editMode=false, editMap={}, lastFiltered=[];

function destroyCharts(){
  [pC,bC,tC,clPieC,clDayC].forEach(c=>{if(c){try{c.destroy()}catch(e){}}});
  pC=bC=tC=clPieC=clDayC=null;
}

function rTbl(f){
  lastFiltered=f;
  editMode=false; editMap={};
  const elTog=document.getElementById('editTogBtn');
  if(elTog) elTog.textContent='✏️ 편집모드';
  ['editApplyBtn','editCancelBtn'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.classList.add('hidden');
  });
  const elStatus=document.getElementById('editStatus');
  if(elStatus) elStatus.style.display='none';
  
  const elInfo=document.getElementById('tInfo');
  if(elInfo) elInfo.textContent=f.length+'건·'+sN.size+'명';
  
  const tb=document.getElementById('tBody');
  if(!tb) return;
  if(!f.length){
    tb.innerHTML='<tr><td colspan="9" style="text-align:center;color:var(--t6);padding:30px">결과 없음</td></tr>';
    return;
  }
  renderTblRows(f, false);
}

function renderTblRows(f, editable){
  const tb=document.getElementById('tBody');
  if(!tb) return;
  tb.innerHTML=f.map((r,idx)=>{
    const ni=aN.indexOf(r.name), c=COL[ni%COL.length];
    const dn=typeof shortName==='function'?shortName(r.name):r.name;
    return `<tr>
      <td><span style="display:inline-flex;align-items:center;gap:5px"><span style="width:5px;height:5px;border-radius:50%;background:${c}"></span><span style="font-size:11px;font-weight:500;color:var(--t3)">${eH(dn)}</span></span></td>
      <td class="mono">${fD(r.date)}</td>
      <td class="mono" style="color:var(--ac-t)">${eH(r.orderNo)}</td>
      <td style="font-size:10px;color:var(--t5);font-style:italic">${eH(r.ocmt||'')}</td>
      <td style="font-size:10px;color:var(--t5)">${eH(r.oclient||'')}</td>
      <td class="mono" style="text-align:right">${r.hours}</td>
      <td style="font-size:11px">${eH(r.taskType)}</td>
      <td><span class="badge" style="background:var(--ac-bg);color:var(--ac-t)">${r.abbr}</span></td>
      <td style="color:var(--t3);font-size:11px">${eH(r.content)}</td>
    </tr>`;
  }).join('');
}

function sTab(t){
  document.querySelectorAll('#statsS .tab').forEach(x=>x.classList.toggle('on', x.dataset.t===t));
  const tabs=['tTbl','tCht','tAi','tSum'];
  tabs.forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.classList.toggle('hidden', id!=='t'+t.charAt(0).toUpperCase()+t.slice(1));
  });
  if(t==='cht'){
    const f=gF(); if(f.length>0) rCht(f);
  }
}

/* ═══ CHART RENDER ═══ */
function rCht(f){
  if(!f.length) return;
  destroyCharts();
  const ctx=document.getElementById('pieC').getContext('2d');
  const tm={}; f.forEach(r=>{tm[r.abbr]=(tm[r.abbr]||0)+r.hours});
  const ts=Object.entries(tm).map(([k,v])=>({n:k, v})).sort((a,b)=>b.v-a.v);
  
  pC=new Chart(ctx,{
    type:'doughnut',
    data:{
      labels:ts.map(s=>s.n),
      datasets:[{data:ts.map(s=>s.v), backgroundColor:COL, borderWidth:0}]
    },
    options:{responsive:true, cutout:'55%', plugins:{legend:{display:false}}}
  });
}
