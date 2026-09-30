/* manual-input.js — 수동 입력 모달 · 행 선택 삭제 · 엑셀/TSV 내보내기
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ 수동 입력 모달 ═══ */
function openManualInput(){
  var existing=document.getElementById('manualInputOverlay');
  if(existing)existing.remove();
  var today=new Date();var td=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
  var nameOpts=aN.length?aN.map(function(n){return'<option value="'+eH(n)+'">'+eH(n)+'</option>'}).join(''):'';
  var abbrOpts=Object.keys(AM).map(function(k){return'<option value="'+k+'">'+k+' - '+eH(AM[k])+'</option>'}).join('');
  var orderOpts='';
  if(typeof ORDER_MAP!=='undefined'){
    var oks=Object.keys(ORDER_MAP).sort();
    orderOpts=oks.map(function(k){var info=ORDER_MAP[k];var label=typeof info==='object'&&info?info.name||'':'';return'<option value="'+eH(k)+'">'+(label?eH(k)+' ('+eH(label)+')':eH(k))+'</option>'}).join('');
  }
  var ov=createModal({id:'manualInputOverlay'}).overlay;  /* v13.190 공통 모달(z 자동 스택·id 중복 제거) */
  ov.onclick=function(e){if(e.target===ov)ov.remove()};
  ov.innerHTML=`<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:24px;width:520px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.3)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
      <h3 style="font-size:15px;font-weight:700;color:var(--t1)">➕ 상세 필드 수동 입력</h3>
      <button onclick="document.getElementById('manualInputOverlay').remove()" style="background:none;border:none;color:var(--t5);font-size:18px;cursor:pointer">&times;</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <label style="display:flex;flex-direction:column;gap:4px">
        <span style="font-size:11px;color:var(--t4);font-weight:600">날짜 *</span>
        <input type="date" id="mi_date" value="${td}" class="si" style="padding:7px 10px;font-size:12px">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px">
        <span style="font-size:11px;color:var(--t4);font-weight:600">이름 *</span>
        <input type="text" id="mi_name" list="mi_nameList" class="si" style="padding:7px 10px;font-size:12px" placeholder="이름 입력">
        <datalist id="mi_nameList">${nameOpts}</datalist>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px">
        <span style="font-size:11px;color:var(--t4);font-weight:600">수주번호</span>
        <input type="text" id="mi_orderNo" list="mi_orderList" class="si" style="padding:7px 10px;font-size:12px" placeholder="수주번호" oninput="onMiOrderChange()">
        <datalist id="mi_orderList">${orderOpts}</datalist>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px">
        <span style="font-size:11px;color:var(--t4);font-weight:600">시간 (h)</span>
        <input type="number" id="mi_hours" value="8" step="0.5" min="0" max="24" class="si" style="padding:7px 10px;font-size:12px">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px">
        <span style="font-size:11px;color:var(--t4);font-weight:600">수주명 (수동)</span>
        <input type="text" id="mi_ocmt" class="si" style="padding:7px 10px;font-size:12px" placeholder="엑셀 미반영 시 직접 입력">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px">
        <span style="font-size:11px;color:var(--t4);font-weight:600">거래처 (수동)</span>
        <input type="text" id="mi_oclient" class="si" style="padding:7px 10px;font-size:12px" placeholder="엑셀 미반영 시 직접 입력">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px">
        <span style="font-size:11px;color:var(--t4);font-weight:600">업무분장</span>
        <select id="mi_abbr" class="si" style="padding:7px 10px;font-size:12px">
          <option value="">선택</option>
          ${abbrOpts}
        </select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px">
        <span style="font-size:11px;color:var(--t4);font-weight:600">업무유형</span>
        <input type="text" id="mi_taskType" class="si" style="padding:7px 10px;font-size:12px" placeholder="업무유형">
      </label>
    </div>
    <label style="display:flex;flex-direction:column;gap:4px;margin-top:12px">
      <span style="font-size:11px;color:var(--t4);font-weight:600">업무내용</span>
      <textarea id="mi_content" class="si" rows="3" style="padding:7px 10px;font-size:12px;resize:vertical" placeholder="업무 내용 입력"></textarea>
    </label>
    <div id="mi_status" style="margin-top:10px;font-size:11px;color:var(--t5);min-height:18px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-g btn-s" onclick="document.getElementById('manualInputOverlay').remove()">취소</button>
      <button class="btn btn-p btn-s" id="mi_saveBtn" onclick="saveManualInput(false)">💾 저장 (서버)</button>
      <button class="btn btn-w btn-s" id="mi_saveMoreBtn" onclick="saveManualInput(true)">💾 저장 + 계속</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  document.getElementById('mi_name').focus();
}
function onMiOrderChange(){
  var orderNo=document.getElementById('mi_orderNo').value.trim();
  if(!orderNo)return;
  var ocmtEl=document.getElementById('mi_ocmt');
  var oclEl=document.getElementById('mi_oclient');
  if(ocmtEl.value)return; // 이미 수동 입력된 경우 덮어쓰지 않음
  var info=typeof ORDER_MAP!=='undefined'?ORDER_MAP[orderNo]:null;
  if(info&&typeof info==='object'){
    if(!ocmtEl.value&&info.name)ocmtEl.value=info.name;
    if(!oclEl.value&&info.client)oclEl.value=info.client;
  }
}
async function saveManualInput(keepOpen){
  var date=document.getElementById('mi_date').value;
  var name=document.getElementById('mi_name').value.trim();
  var orderNo=document.getElementById('mi_orderNo').value.trim();
  var hours=parseFloat(document.getElementById('mi_hours').value)||0;
  var ocmt=document.getElementById('mi_ocmt').value.trim();
  var oclient=document.getElementById('mi_oclient').value.trim();
  var abbr=document.getElementById('mi_abbr').value;
  var taskType=document.getElementById('mi_taskType').value.trim();
  var content=document.getElementById('mi_content').value.trim();
  var status=document.getElementById('mi_status');
  if(!date||!name){status.textContent='⚠️ 날짜와 이름은 필수입니다.';status.style.color=SEM_COLOR.danger;return}
  // YYYY-MM-DD → YYYYMMDD 변환
  var normDate=date.replace(/[-\/]/g,'');
  var record={date:normDate,name:name,orderNo:orderNo,hours:hours,ocmt:ocmt||null,oclient:oclient||null,abbr:abbr,taskType:taskType||AM[abbr]||'',content:content};
  status.textContent='저장 중...';status.style.color='var(--ac-t)';
  document.getElementById('mi_saveBtn').disabled=true;
  document.getElementById('mi_saveMoreBtn').disabled=true;
  try{
    var saved=null;
    if(typeof apiFetch==='function'){
      var res=await apiFetch('/api/archives/records',{method:'POST',body:JSON.stringify(record)});
      if(typeof invalidateArchiveCache==='function')invalidateArchiveCache();
      if(res&&res.data){
        saved=res.data;
        // snake_case → camelCase
        var cc={};for(var k in saved){var ck=k.replace(/_([a-z])/g,function(m,c){return c.toUpperCase()});cc[ck]=saved[k]}
        if(typeof cc.hours==='string')cc.hours=parseFloat(cc.hours)||0;
        if(cc.date&&/[-\/]/.test(cc.date))cc.date=cc.date.replace(/[-\/]/g,'').slice(0,8);
        saved=cc;
      }
    }
    // aD 배열에 추가
    var newRec=saved||record;
    aD.push(newRec);
    // 서버 DB에 이미 저장됨 — 별도 동기화 불필요
    status.textContent='✅ 저장 완료! (서버 DB 반영됨)';status.style.color=SEM_COLOR.ok;
    // UI 갱신 — 날짜순 정렬 + 필터/리스트 전체 갱신
    aD.sort(function(a,b){var n=a.name.localeCompare(b.name,'ko');return n!==0?n:a.date.localeCompare(b.date)});
    gfInvalidate();
    var isNew=!aN.includes(name);
    if(isNew){aN.push(name);aN.sort(function(a,b){return a.localeCompare(b,'ko')})}
    if(isNew||!sN.has(name)){sN.add(name)}
    rNC();rFL();upV()
    if(keepOpen){
      // 일부 필드만 초기화
      document.getElementById('mi_content').value='';
      document.getElementById('mi_ocmt').value='';
      document.getElementById('mi_oclient').value='';
      setTimeout(function(){status.textContent='';document.getElementById('mi_content').focus()},1200);
    }else{
      setTimeout(function(){var ov=document.getElementById('manualInputOverlay');if(ov)ov.remove()},800);
    }
  }catch(err){
    console.error('[saveManualInput]',err);
    status.textContent='❌ 저장 실패: '+(err.message||'서버 오류');status.style.color=SEM_COLOR.danger;
  }finally{
    document.getElementById('mi_saveBtn').disabled=false;
    document.getElementById('mi_saveMoreBtn').disabled=false;
  }
}

function toggleDelRow(chk){
  var idx=+chk.dataset.delidx;
  if(chk.checked)delSet.add(idx);else delSet.delete(idx);
  chk.closest('tr').style.background=chk.checked?'rgba(239,68,68,.08)':'';
  upDelBar();
}
function toggleSelectAll(chk){
  var boxes=document.querySelectorAll('#tBody .del-chk');
  boxes.forEach(function(b){b.checked=chk.checked;var idx=+b.dataset.delidx;if(chk.checked)delSet.add(idx);else delSet.delete(idx);b.closest('tr').style.background=chk.checked?'rgba(239,68,68,.08)':''});
  upDelBar();
}
function upDelBar(){
  var bar=document.getElementById('delBar');
  var cnt=document.getElementById('delCount');
  if(delSet.size>0){bar.classList.add('show');cnt.textContent=delSet.size+'건 선택'}
  else{bar.classList.remove('show')}
}
async function deleteSelected(){
  if(!delSet.size){showToast('삭제할 항목을 선택하세요.','warn');return}
  if(!confirm(delSet.size+'건을 삭제합니다.\n이 작업은 되돌릴 수 없습니다.\n\n계속하시겠습니까?'))return;
  // 삭제 대상과 남은 레코드 분리
  var toDeleteIds=[];
  var toDeleteRows=[];
  delSet.forEach(function(idx){
    var row=lastFiltered[idx];
    if(row){
      toDeleteRows.push(row);
      if(row.id)toDeleteIds.push(row.id);
    }
  });
  // aD에서 삭제
  toDeleteRows.forEach(function(row){
    var ai=aD.indexOf(row);
    if(ai!==-1)aD.splice(ai,1);
  });
  // DB 반영
  try{
    if(toDeleteIds.length===toDeleteRows.length&&toDeleteIds.length>0&&typeof wrDeleteRecords==='function'){
      await wrDeleteRecords(aD, toDeleteIds);
    }else{
      await wrBulkPut(aD);
    }
  }catch(dbErr){
    console.error('[deleteSelected] DB 삭제 실패:',dbErr);
    showToast('DB 삭제 실패: '+(dbErr.message||'서버 오류'),'error');
  }
  var cnt=delSet.size;
  delSet=new Set();editMap={};
  document.getElementById('delBar').classList.remove('show');
  var thChkInput=document.querySelector('#thChk input');if(thChkInput)thChkInput.checked=false;
  rFL();upV();
  showToast('🗑️ '+cnt+'건 삭제 완료');
}

async function resetOcmtOclient(){
  if(!aD.length){showToast('데이터가 없습니다.','warn');return}
  var cnt=aD.filter(function(r){return r.ocmt!==undefined||r.oclient!==undefined}).length;
  if(!cnt){showToast('초기화할 개별 수주명/거래처 값이 없습니다.','info');return}
  if(!confirm('전체 '+aD.length+'건 중 '+cnt+'건의 개별 수주명·거래처 값을 삭제합니다.\n삭제 후 수주맵(ORDER_MAP) 기본값으로 복원됩니다.\n\n계속하시겠습니까?'))return;
  aD.forEach(function(r){delete r.ocmt;delete r.oclient});
  await wrBulkPut(aD);
  editMap={};editMode=false;
  var elTog=document.getElementById('editTogBtn');if(elTog)elTog.textContent='✏️ 편집모드';
  ['editApplyBtn','editCancelBtn'].forEach(function(id){var el=document.getElementById(id);if(el)el.classList.add('hidden')});
  var elSt=document.getElementById('editStatus');if(elSt)elSt.style.display='none';
  gfInvalidate();rFL();upV();
  showToast('✅ '+cnt+'건 수주명·거래처 개별값 초기화 완료 (DB 반영)');
}

function exportXlsx(){
  const f=gF();if(!f.length){showToast('데이터 없음','warn');return}
  const rows=f.map(r=>{
    const em=editMap[lastFiltered.indexOf(r)]||{};
    const oNo=em.orderNo!==undefined?em.orderNo:r.orderNo;
    const baseOcmt=(r.ocmt||getOCmt(r.orderNo));
    const baseClient=(r.oclient||getOClient(r.orderNo));
    const curOcmt=em.ocmt!==undefined?em.ocmt:(em.orderNo!==undefined?getOCmt(em.orderNo):baseOcmt);
    const curClient=em.oclient!==undefined?em.oclient:(em.orderNo!==undefined?getOClient(em.orderNo):baseClient);
    return{
      '이름':r.name,'날짜':fD(r.date),
      '수주번호':oNo,'수주명':curOcmt,'거래처':curClient,
      '시간':em.hours!==undefined?em.hours:r.hours,
      '업무분장':em.taskType!==undefined?em.taskType:r.taskType,'약자':em.abbr!==undefined?em.abbr:r.abbr,
      '업무내용':em.content!==undefined?em.content:r.content
    };
  });
  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'업무일지');
  // 컬럼 너비 설정
  ws['!cols']=[{wch:10},{wch:12},{wch:14},{wch:20},{wch:16},{wch:6},{wch:10},{wch:6},{wch:50}];
  const now=new Date();const ts=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  XLSX.writeFile(wb,`업무일지_${ts}.xlsx`);
}

function cpTSV(){const f=gF(),h='이름\t날짜\t수주번호\t수주명\t거래처\t시간\t업무분장\t약자\t업무내용';const r=f.map((x,i)=>{const em=editMap[lastFiltered.indexOf(x)]||{};const oNo=em.orderNo!==undefined?em.orderNo:x.orderNo;const baseOcmt=x.ocmt!==undefined?x.ocmt:getOCmt(x.orderNo);const baseClient=x.oclient!==undefined?x.oclient:getOClient(x.orderNo);const curOcmt=em.ocmt!==undefined?em.ocmt:(em.orderNo!==undefined?getOCmt(em.orderNo):baseOcmt);const curClient=em.oclient!==undefined?em.oclient:(em.orderNo!==undefined?getOClient(em.orderNo):baseClient);return`${x.name}\t${fD(x.date)}\t${oNo}\t${curOcmt}\t${curClient}\t${em.hours!==undefined?em.hours:x.hours}\t${em.taskType!==undefined?em.taskType:x.taskType}\t${em.abbr!==undefined?em.abbr:x.abbr}\t${em.content!==undefined?em.content:x.content}`});navigator.clipboard.writeText([h,...r].join('\n')).then(()=>{const b=document.getElementById('cpBtn'),o=b.innerHTML;b.innerHTML='✅완료';setTimeout(()=>b.innerHTML=o,1200)})}

