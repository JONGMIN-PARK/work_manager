/* wr-view.js — 주간 분석 뷰(upV) · 테이블 가상 스크롤 · 셀 편집
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ VIEW ═══ */
function upV(){rAFT();const f=gF();const ss=document.getElementById('statsS');if(f.length===0&&sN.size===0){ss.classList.add('hidden');document.getElementById('cmpPanel').classList.add('hidden');return}ss.classList.remove('hidden');const tH=Math.round(f.reduce((s,r)=>s+r.hours,0)*10)/10;const ds=[...new Set(f.map(r=>r.date))].sort();document.getElementById('sC').textContent=f.length;document.getElementById('sH').textContent=tH+'h';document.getElementById('sP').textContent=ds.length>0?fD(ds[0])+' ~ '+fD(ds[ds.length-1]):'-';document.getElementById('sA').textContent=(ds.length>0?Math.round(tH/ds.length*10)/10:0)+'h';rTbl(f);if(!document.getElementById('tCht').classList.contains('hidden'))rCht(f);if(!document.getElementById('tSum').classList.contains('hidden'))rContentSum();if(!document.getElementById('tAi').classList.contains('hidden')){var so=document.getElementById('sumOut');if(so&&so.dataset.generated){so.innerHTML='<div style="text-align:center;color:'+SEM_COLOR.warn+';padding:20px;font-size:12px">⚠️ 데이터가 변경되었습니다. "요약 생성" 버튼을 눌러 갱신하세요.</div>';so.dataset.generated=''}}if(cmpMode&&sN.size>=2)rCmp(f);else document.getElementById('cmpPanel').classList.add('hidden')}
let editMode=false;
let lastFiltered=[]; // 현재 필터 결과 참조 보관
let editMap={}; // {rowIdx: {field: newValue}} 수정 추적
let delSet=new Set(); // 삭제 선택 인덱스

function rTbl(f){
  lastFiltered=f;
  editMode=false;editMap={};delSet=new Set();
  document.getElementById('editTogBtn').textContent='✏️ 편집모드';
  document.getElementById('editApplyBtn').classList.add('hidden');
  document.getElementById('editCancelBtn').classList.add('hidden');
  document.getElementById('editStatus').style.display='none';
  document.getElementById('thChk').style.display='none';
  document.getElementById('delBar').classList.remove('show');
  document.getElementById('tInfo').textContent=f.length+'건·'+sN.size+'명'+(hAF()?' (필터)':'');
  const tb=document.getElementById('tBody');
  if(!f.length){_vsData=[];tb.innerHTML='<tr><td colspan="10" style="text-align:center;color:var(--t6);padding:30px">결과 없음</td></tr>';document.getElementById('contentSummary').innerHTML='';return}
  renderTblRows(f,false);
}

/* ═══ Virtual Scroll 상태 ═══ */
var _vsData=[],_vsEditable=false,_vsKw='',_vsNameIdx=new Map(),_vsWrapEl=null;
var VS_ROW_H=36,VS_BUFFER=10;
var _vsRAF=0; // requestAnimationFrame guard

function _vsRenderRow(r,idx,editable){
  var ni=_vsNameIdx.get(r.name)||0,c=COL[ni%COL.length];
  var dn=typeof shortName==='function'?shortName(r.name):r.name;
  var ocmt=r.ocmt||getOCmt(r.orderNo);
  var oclient=r.oclient||getOClient(r.orderNo);
  var em=editMap[idx]||{};
  var curOrder=em.orderNo!==undefined?em.orderNo:r.orderNo;
  var curOcmt=em.ocmt!==undefined?em.ocmt:(em.orderNo!==undefined?getOCmt(em.orderNo):ocmt);
  var curClient=em.oclient!==undefined?em.oclient:(em.orderNo!==undefined?getOClient(em.orderNo):oclient);
  var curHours=em.hours!==undefined?em.hours:r.hours;
  var curTask=em.taskType!==undefined?em.taskType:r.taskType;
  var curAbbr=em.abbr!==undefined?em.abbr:r.abbr;
  var curContent=em.content!==undefined?em.content:r.content;
  var hasEdit=Object.keys(em).length>0;

  var ch=eH(curContent);
  if(_vsKw&&!editable){var rx=new RegExp('('+_vsKw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');ch=ch.replace(rx,'<mark style="background:var(--mk);color:var(--mk-t);padding:0 2px;border-radius:2px">$1</mark>')}

  if(editable){
    var isDel=delSet.has(idx);
    return'<tr style="'+(isDel?'background:rgba(239,68,68,.08)':hasEdit?'background:rgba(245,158,11,.06)':'')+'">'
      +'<td><input type="checkbox" class="del-chk" data-delidx="'+idx+'" '+(isDel?'checked':'')+' onchange="toggleDelRow(this)"></td>'
      +'<td style="word-break:keep-all"><span style="display:inline-flex;align-items:center;gap:5px"><span style="width:5px;height:5px;border-radius:50%;background:'+c+'"></span><span style="font-size:11px;font-weight:500;color:var(--t3)" title="'+eH(r.name)+'">'+eH(dn)+'</span></span></td>'
      +'<td class="mono" style="color:var(--t4);white-space:nowrap">'+fD(r.date)+'</td>'
      +'<td class="editable '+(em.orderNo!==undefined?'modified':'')+'" contenteditable="true" data-row="'+idx+'" data-field="orderNo" oninput="onCellEdit(this)" style="color:var(--ac-t);word-break:break-all" title="'+eH(curOrder)+'">'+eH(curOrder)+'</td>'
      +'<td class="editable '+(em.ocmt!==undefined?'modified':'')+'" contenteditable="true" data-row="'+idx+'" data-field="ocmt" oninput="onCellEdit(this)" style="font-size:11px;color:var(--t5);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+eH(curOcmt)+'">'+eH(curOcmt)+'</td>'
      +'<td class="editable '+(em.oclient!==undefined?'modified':'')+'" contenteditable="true" data-row="'+idx+'" data-field="oclient" oninput="onCellEdit(this)" style="font-size:10px;color:var(--t5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+eH(curClient)+'">'+eH(curClient)+'</td>'
      +'<td class="editable mono '+(em.hours!==undefined?'modified':'')+'" contenteditable="true" data-row="'+idx+'" data-field="hours" oninput="onCellEdit(this)" style="text-align:right;color:#F59E0B;font-weight:600;white-space:nowrap">'+curHours+'</td>'
      +'<td class="editable '+(em.taskType!==undefined?'modified':'')+'" contenteditable="true" data-row="'+idx+'" data-field="taskType" oninput="onCellEdit(this)" style="font-size:11px;color:var(--c-t);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+eH(curTask)+'">'+eH(curTask)+'</td>'
      +'<td class="editable '+(em.abbr!==undefined?'modified':'')+'" contenteditable="true" data-row="'+idx+'" data-field="abbr" oninput="onCellEdit(this)" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+eH(curAbbr)+'"><span style="font-size:11px">'+eH(curAbbr)+'</span></td>'
      +'<td class="editable '+(em.content!==undefined?'modified':'')+'" contenteditable="true" data-row="'+idx+'" data-field="content" oninput="onCellEdit(this)" style="color:var(--t3);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+eH(curContent)+'">'+eH(curContent)+'</td>'
      +'</tr>';
  }else{
    return'<tr style="'+(hasEdit?'background:rgba(245,158,11,.06)':'')+'">'
      +'<td style="word-break:keep-all"><span style="display:inline-flex;align-items:center;gap:5px"><span style="width:5px;height:5px;border-radius:50%;background:'+c+'"></span><span style="font-size:11px;font-weight:500;color:var(--t3)" title="'+eH(r.name)+'">'+eH(dn)+'</span></span></td>'
      +'<td class="mono" style="color:var(--t4);white-space:nowrap">'+fD(r.date)+'</td>'
      +'<td class="mono" style="color:var(--ac-t);word-break:break-all" title="'+eH(curOrder)+'">'+eH(curOrder)+'</td>'
      +'<td style="font-size:11px;color:var(--t5);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+eH(curOcmt)+'">'+eH(curOcmt)+'</td>'
      +'<td style="font-size:10px;color:var(--t5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+eH(curClient)+'">'+eH(curClient)+'</td>'
      +'<td class="mono" style="text-align:right;color:#F59E0B;font-weight:600;white-space:nowrap">'+curHours+'</td>'
      +'<td style="font-size:11px;color:var(--c-t);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+eH(curTask)+'">'+eH(curTask)+'</td>'
      +'<td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+eH(curAbbr)+'"><span class="badge" style="background:'+(ABG[curAbbr]||'#1A1F35')+';color:'+(AFG[curAbbr]||'#94A3B8')+'">'+curAbbr+'</span></td>'
      +'<td style="color:var(--t3);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+eH(curContent)+'">'+ch+'</td>'
      +'</tr>';
  }
}

function _vsRender(){
  if(!_vsData.length){return}
  if(!_vsWrapEl){_vsWrapEl=document.getElementById('tBody').closest('.tw')}
  if(!_vsWrapEl)return;
  var scrollTop=_vsWrapEl.scrollTop;
  var viewH=_vsWrapEl.clientHeight;
  var total=_vsData.length;
  var colSpan=_vsEditable?10:9;

  var startIdx=Math.max(0,Math.floor(scrollTop/VS_ROW_H)-VS_BUFFER);
  var endIdx=Math.min(total,Math.ceil((scrollTop+viewH)/VS_ROW_H)+VS_BUFFER);

  var topPad=startIdx*VS_ROW_H;
  var bottomPad=(total-endIdx)*VS_ROW_H;

  var parts=[];
  if(topPad>0)parts.push('<tr style="height:'+topPad+'px"><td colspan="'+colSpan+'"></td></tr>');
  for(var i=startIdx;i<endIdx;i++){
    parts.push(_vsRenderRow(_vsData[i],i,_vsEditable));
  }
  if(bottomPad>0)parts.push('<tr style="height:'+bottomPad+'px"><td colspan="'+colSpan+'"></td></tr>');

  document.getElementById('tBody').innerHTML=parts.join('');
}

function _vsOnScroll(){
  if(_vsRAF)return;
  _vsRAF=requestAnimationFrame(function(){_vsRAF=0;_vsRender()});
}

function renderTblRows(f,editable){
  _vsData=f;
  _vsEditable=editable;
  _vsKw=cKw?cKw.toLowerCase():'';
  _vsNameIdx=new Map();
  aN.forEach(function(n,i){_vsNameIdx.set(n,i)});

  /* .tw 래퍼에 scroll 이벤트 바인딩 (최초 1회) */
  if(!_vsWrapEl){
    _vsWrapEl=document.getElementById('tBody').closest('.tw');
    if(_vsWrapEl)_vsWrapEl.addEventListener('scroll',_vsOnScroll);
  }
  /* 스크롤 위치 초기화 */
  if(_vsWrapEl)_vsWrapEl.scrollTop=0;
  _vsRender();
}

function onCellEdit(cell){
  const idx=+cell.dataset.row;const field=cell.dataset.field;
  const orig=lastFiltered[idx];if(!orig)return;
  const newVal=cell.textContent.trim();
  let origVal;
  if(field==='hours')origVal=String(orig[field]);
  else if(field==='ocmt')origVal=orig.ocmt||getOCmt(orig.orderNo);
  else if(field==='oclient')origVal=orig.oclient||getOClient(orig.orderNo);
  else origVal=orig[field]||'';
  if(origVal===undefined||origVal===null)origVal='';
  
  if(!editMap[idx])editMap[idx]={};
  if(newVal===origVal){
    delete editMap[idx][field];
    if(!Object.keys(editMap[idx]).length)delete editMap[idx]
  } else {
    editMap[idx][field]=field==='hours'?(parseFloat(newVal)||0):newVal;
  }
  cell.classList.toggle('modified',editMap[idx]&&editMap[idx][field]!==undefined);
  const hasAny=Object.keys(editMap).length>0;
  document.getElementById('editStatus').style.display=hasAny?'':'none';
  document.getElementById('editStatus').textContent='● '+Object.keys(editMap).length+'건 수정 중';
}

function togEdit(){
  editMode=!editMode;
  delSet=new Set();
  document.getElementById('editTogBtn').textContent=editMode?'🔒 편집종료':'✏️ 편집모드';
  document.getElementById('editApplyBtn').classList.toggle('hidden',!editMode);
  document.getElementById('editCancelBtn').classList.toggle('hidden',!editMode);
  document.getElementById('thChk').style.display=editMode?'':'none';
  document.getElementById('delBar').classList.remove('show');
  var thChkInput=document.querySelector('#thChk input');if(thChkInput)thChkInput.checked=false;
  renderTblRows(lastFiltered,editMode);
}

async function applyEdits(){
  if(!Object.keys(editMap).length){showToast('수정 사항이 없습니다.','warn');return}
  /* 편집된 행의 수주번호 수집 (ocmt/oclient 변경 시 같은 수주번호의 미편집 행도 per-row 고정 필요) */
  const editedOrders=new Set();
  const editedIndices=new Set();
  const recordsToSave=[]; // 변경 + cascade 픽스된 레코드 (PATCH /batch 대상)
  let count=0;
  for(const[idxStr,changes]of Object.entries(editMap)){
    const fRow=lastFiltered[+idxStr];if(!fRow)continue;
    const origIdx=aD.findIndex(r=>r===fRow);
    if(origIdx===-1)continue;
    editedIndices.add(origIdx);
    if(changes.ocmt!==undefined||changes.oclient!==undefined){
      editedOrders.add(changes.orderNo!==undefined?changes.orderNo:fRow.orderNo);
    }
    if(changes.orderNo!==undefined)aD[origIdx].orderNo=changes.orderNo;
    for(const[field,val]of Object.entries(changes)){
      if(field!=='orderNo'){aD[origIdx][field]=val}
    }
    recordsToSave.push(aD[origIdx]);
    count++;
  }
  /* ocmt/oclient가 수정된 수주번호에 속하는 미편집 행들:
     현재 표시값(order-level fallback)을 per-row로 고정하여 일괄 반영 방지.
     실제 값이 바뀐 경우에만 저장 대상에 추가. */
  if(editedOrders.size>0){
    aD.forEach(function(r,i){
      if(editedIndices.has(i))return;
      if(!editedOrders.has(r.orderNo))return;
      var changed=false;
      if(!r.ocmt){var cm=getOCmt(r.orderNo);if(cm){r.ocmt=cm;changed=true}}
      if(!r.oclient){var cl=getOClient(r.orderNo);if(cl){r.oclient=cl;changed=true}}
      if(changed)recordsToSave.push(r);
    });
  }
  // 변경된 레코드만 부분 업데이트
  // - 서버 모드(wrUpdateRecords 정의): PATCH /api/archives/records/batch — 사용자 스코프 안전, 중복 생성 방지
  // - 로컬 모드(IndexedDB): wrUpdateRecords 미정의 → wrBulkPut(aD) 폴백 (단일 사용자 환경이라 안전)
  try{
    if(typeof wrUpdateRecords==='function'){
      // ID 없는 레코드(import 직후 미동기화)는 PATCH로 갱신 불가 → 분리 처리
      var withId=recordsToSave.filter(function(r){return r.id});
      var withoutId=recordsToSave.filter(function(r){return !r.id});
      if(withId.length)await wrUpdateRecords(withId);
      if(withoutId.length){
        console.warn('[applyEdits] ID 없는 레코드 '+withoutId.length+'건 — bulkPut 폴백 (import 직후 케이스)');
        await wrBulkPut(aD);
      }
    }else{
      await wrBulkPut(aD);
    }
  }catch(dbErr){
    console.error('[applyEdits] DB 저장 실패:',dbErr);
    showToast('DB 저장 실패: '+(dbErr.message||'서버 오류')+' (메모리에는 반영됨)','error');
  }
  editMap={};editMode=false;
  document.getElementById('editTogBtn').textContent='✏️ 편집모드';
  document.getElementById('editApplyBtn').classList.add('hidden');
  document.getElementById('editCancelBtn').classList.add('hidden');
  document.getElementById('editStatus').style.display='none';
  gfInvalidate();rFL();upV();
  showToast(`✅ ${count}건 수정 적용 완료`);
}

function cancelEdits(){
  editMap={};editMode=false;delSet=new Set();
  document.getElementById('editTogBtn').textContent='✏️ 편집모드';
  document.getElementById('editApplyBtn').classList.add('hidden');
  document.getElementById('editCancelBtn').classList.add('hidden');
  document.getElementById('editStatus').style.display='none';
  document.getElementById('thChk').style.display='none';
  document.getElementById('delBar').classList.remove('show');
  renderTblRows(lastFiltered,false);
}

