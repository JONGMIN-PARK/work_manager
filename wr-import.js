/* wr-import.js — 업무일지 컬럼 자동 감지 · 레코드 키/병합 · Import 분석/미리보기 · 파일 파싱/업로드/레코드 관리
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ 컬럼 자동 감지 ═══ */
/* 주의: 더 구체적인 패턴(ocmt='수주명', oclient='거래처')은 일반적인 패턴(orderNo='수주', name='담당자')보다 먼저 매칭되어야 함.
   pDetectColumns에서 COL_ALL 순서대로 첫 매칭만 사용하므로 ocmt/oclient를 orderNo/name보다 앞에 배치. */
var COL_PATTERNS={
  date:/날짜|일자|일시|date|작업일/i,
  ocmt:/수주명|프로젝트명|ocmt|사업명|건명/i,
  oclient:/거래처|고객사|업체|발주처|oclient|client/i,
  name:/이름|성명|name|작성자|작업자|담당자|사원/i,
  orderNo:/수주번호|수주|주문번호|order|프로젝트|project|pjt/i,
  hours:/시간|공수|hours|투입시간|작업시간|h/i,
  taskType:/업무분장|분장|업무유형|task|type|구분/i,
  abbr:/약자|약어|abbr|코드|code/i,
  content:/업무내용|내용|content|비고|작업내용|설명/i
};
// 전체 필드 (감지 우선순위 — 구체적인 패턴을 앞에)
var COL_ALL=['date','ocmt','oclient','name','orderNo','hours','taskType','abbr','content'];

function pDetectColumns(headerCells){
  var map={};
  var claimed={}; // 한 셀이 더 구체적인 키(예: ocmt='수주명')에 매칭되면 더 일반적인 키(orderNo='수주')가 같은 셀을 다시 잡지 못하게 함
  headerCells.forEach(function(cell,idx){
    if(cell===undefined||cell===null)return;
    var v=String(cell).replace(/\s/g,''); // 공백 제거 후 비교
    COL_ALL.forEach(function(key){
      if(map[key]!==undefined)return;
      if(claimed[idx])return;
      if(COL_PATTERNS[key].test(v)){map[key]=idx;claimed[idx]=true}
    });
  });
  // 날짜를 못 찾으면 셀 값 자체가 날짜 형식인 것을 찾음
  if(map.date===undefined){
    for(var i=0;i<headerCells.length;i++){
      if(claimed[i])continue;
      if(pNormDate(headerCells[i])){map.date=i;break}
    }
  }
  return map;
}

function pMapRow(cells,colMap){
  var dateIdx=colMap.date;
  if(dateIdx===undefined)return null;
  var dt=pNormDate(String(cells[dateIdx]||'').trim());
  if(!dt)return null;
  var rec={
    date:dt,
    name:String(cells[colMap.name!==undefined?colMap.name:1]||'').trim(),
    orderNo:String(cells[colMap.orderNo!==undefined?colMap.orderNo:-1]||'').trim(),
    hours:parseFloat(cells[colMap.hours!==undefined?colMap.hours:3])||0,
    taskType:String(cells[colMap.taskType!==undefined?colMap.taskType:-1]||'').trim(),
    abbr:String(cells[colMap.abbr!==undefined?colMap.abbr:-1]||'').trim(),
    content:String(cells[colMap.content!==undefined?colMap.content:(cells.length-1)]||'').trim()
  };
  // 수주명/거래처는 export round-trip 시에만 존재 — 매핑된 경우에만 채워서 ORDER_MAP 기본값을 가리지 않도록
  if(colMap.ocmt!==undefined){
    var v=String(cells[colMap.ocmt]||'').trim();
    if(v)rec.ocmt=v;
  }
  if(colMap.oclient!==undefined){
    var v2=String(cells[colMap.oclient]||'').trim();
    if(v2)rec.oclient=v2;
  }
  return rec;
}

var _lastColMap=null; // 마지막 컬럼 매핑 (누락 알림용)

function pH(text){
  const doc=new DOMParser().parseFromString(text,'text/html');
  const rows=doc.querySelectorAll('tr');
  if(!rows.length)return[];
  const r=[];
  var colMap=null;
  var lastDate=''; // 병합 셀 대응
  var lastName='';
  rows.forEach(function(tr){
    const tds=tr.querySelectorAll('td,th');
    if(tds.length<3)return;
    const c=Array.from(tds).map(function(td){return td.textContent.trim()});
    // 헤더 행 감지
    if(!colMap){
      var detected=pDetectColumns(c);
      if(detected.date!==undefined&&detected.name!==undefined){colMap=detected;_lastColMap=colMap;return}
      // 첫 행이 데이터일 수도 있음 (헤더 없는 파일)
      if(pNormDate(c[0])){
        colMap={date:0,name:1,orderNo:2,hours:3,taskType:c.length>=7?4:undefined,abbr:c.length>=7?5:undefined,content:c.length>=7?6:(c.length-1)};
        _lastColMap=colMap;
        var rec=pMapRow(c,colMap);if(rec){lastDate=rec.date;if(rec.name)lastName=rec.name;r.push(rec)}
        return;
      }
      return;
    }
    // 날짜 셀이 비어있으면 이전 날짜 사용 (병합 셀)
    if(colMap.date!==undefined&&!c[colMap.date]&&lastDate){c[colMap.date]=lastDate}
    // 이름 셀이 비어있으면 이전 이름 사용 (병합 셀)
    if(colMap.name!==undefined&&!c[colMap.name]&&lastName){c[colMap.name]=lastName}
    var rec=pMapRow(c,colMap);
    if(rec){lastDate=rec.date;if(rec.name)lastName=rec.name;r.push(rec)}
  });
  return r;
}

// SheetJS 바이너리 xls/xlsx 파싱
function pXLS(buf){
  try{
    const wb=XLSX.read(buf,{type:'array',codepage:949,cellDates:false,raw:true});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const json=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
    if(!json.length)return[];
    // 헤더 행 찾기 (상위 20행 검색)
    var colMap=null;var hIdx=-1;
    for(var i=0;i<Math.min(20,json.length);i++){
      var row=json[i].map(function(c){return String(c||'').trim()});
      var detected=pDetectColumns(row);
      if(detected.date!==undefined&&detected.name!==undefined){colMap=detected;hIdx=i;break}
    }
    // 헤더 못 찾으면 데이터 샘플링으로 추정
    if(!colMap){
      for(var i=0;i<Math.min(10,json.length);i++){
        var row=json[i];if(!row||row.length<2)continue;
        // 행에서 처음으로 날짜 형식인 컬럼 찾기
        var dIdx=-1;
        for(var ci=0;ci<Math.min(row.length,5);ci++){if(pNormDate(row[ci])){dIdx=ci;break}}
        if(dIdx!==-1){
          // 날짜 컬럼을 기준으로 이름(다음 또는 이전), 수주번호 등 추정
          var nIdx=row[dIdx+1]?dIdx+1:(dIdx>0?dIdx-1:undefined);
          if(nIdx!==undefined){
            colMap={date:dIdx,name:nIdx,orderNo:dIdx+2,hours:dIdx+3,taskType:row.length>=dIdx+7?dIdx+4:undefined,abbr:row.length>=dIdx+7?dIdx+5:undefined,content:row.length>=dIdx+7?dIdx+6:(row.length-1)};
            hIdx=i-1;break;
          }
        }
      }
    }
    if(!colMap)return[];
    _lastColMap=colMap;
    const r=[];
    var lastDate=''; // 병합 셀 대응
    var lastName='';
    for(var i=hIdx+1;i<json.length;i++){
      var row=json[i];if(!row)continue;
      // 유효 데이터 판단: 최소한 날짜 또는 이름 중 하나는 있거나, 병합 셀이어야 함
      var hasDate=!!String(row[colMap.date]||'').trim();
      var hasName=colMap.name!==undefined?!!String(row[colMap.name]||'').trim():false;
      if(!hasDate&&!hasName&&!lastDate)continue;
      
      var cloned=false;
      // 날짜 셀이 비어있으면 이전 날짜 사용 (병합 셀)
      var dateVal=String(row[colMap.date]||'').trim();
      if(!dateVal&&lastDate){if(!cloned){row=row.slice();cloned=true}row[colMap.date]=lastDate}
      // 이름 셀이 비어있으면 이전 이름 사용 (병합 셀)
      if(colMap.name!==undefined){var nameVal=String(row[colMap.name]||'').trim();if(!nameVal&&lastName){if(!cloned){row=row.slice();cloned=true}row[colMap.name]=lastName}}
      var rec=pMapRow(row,colMap);
      if(rec){lastDate=rec.date;if(rec.name)lastName=rec.name;r.push(rec)}
    }
    return r;
  }catch(e){console.log('SheetJS parse failed:',e);return[]}
}

/* ═══ DB 함수 (서버 API 전용 — project-data.js에서 오버라이드) ═══ */
let db=null;  // IndexedDB 시절 잔재 — 할당되는 곳 없음(항상 null). pipeline.js·project-detail.js 가 아직 이름을 참조하므로 선언만 유지
/* 완전 일치 키 (중복 제거용) */
function wrKey(r){return r.date+'|'+r.name+'|'+r.orderNo+'|'+r.hours+'|'+(r.abbr||'')+'|'+(r.dept||'')+'|'+r.content}
/* 식별 키 (같은 레코드 판별용 — 갱신 시 덮어쓰기) */
function wrIdKey(r){return r.date+'|'+r.name+'|'+(r.orderNo||'')+'|'+(r.hours||'')+'|'+(r.content||'').trim()}
/* 느슨한 매칭 키 (날짜+이름+수주번호) — 충돌 미리보기용 */
function wrLooseKey(r){return r.date+'|'+r.name+'|'+(r.orderNo||'')}

/* ═══ Import 분석 — 신규/동일/충돌 분류 ═══
   - identical : 모든 식별필드(hours+content) 동일 → 자동 갱신 대상 (taskType/abbr/ocmt/oclient 덮어쓰기)
   - conflict  : (날짜+이름+수주번호)는 일치하나 hours/content 차이 → 사용자 결정 필요
   - newRow    : 동일 (날짜+이름+수주번호) 후보 자체가 없음 → 신규 추가
   분석 시 existing은 자체 dedup 후 deduped 배열을 함께 반환. conflicts/identical의 인덱스는 deduped 기준. */
function wrAnalyzeImport(existing,newRecs){
  // existing 자체 중복 제거 (wrKey 완전일치 기준)
  var seen=new Set();var deduped=[];var dupRemoved=0;
  existing.forEach(function(r){var k=wrKey(r);if(seen.has(k)){dupRemoved++;return}seen.add(k);deduped.push(r)});
  var loose={};
  deduped.forEach(function(r,i){
    var lk=wrLooseKey(r);
    (loose[lk]=loose[lk]||[]).push({rec:r,idx:i});
  });
  var identical=[],conflicts=[],newRows=[];
  // identical 매칭 추적 — 같은 existing이 두 번 매칭되는 것을 막음
  var consumedExisting=new Set();
  newRecs.forEach(function(nr,ni){
    var lk=wrLooseKey(nr);
    var cands=(loose[lk]||[]).filter(function(c){return !consumedExisting.has(c.idx)});
    if(!cands.length){newRows.push({newRec:nr,newIdx:ni});return}
    var idK=wrIdKey(nr);
    var exact=cands.find(function(c){return wrIdKey(c.rec)===idK});
    if(exact){
      consumedExisting.add(exact.idx);
      identical.push({newRec:nr,newIdx:ni,existing:exact.rec,existingIdx:exact.idx});
      return;
    }
    conflicts.push({newRec:nr,newIdx:ni,candidates:cands.map(function(c){return{rec:c.rec,idx:c.idx}})});
  });
  return{deduped:deduped,dupRemoved:dupRemoved,identical:identical,conflicts:conflicts,newRows:newRows};
}

/* 사용자 결정에 따라 최종 merged 배열 생성
   decisions: { conflicts: { [newIdx]: 'update'|'skip'|'add' }, mode: 'merge'|'replace_keep_matched' }
   - update: 기존(첫 후보)을 신규로 덮어쓰기
   - skip:   기존 유지, 신규 무시
   - add:    기존도 유지하고 신규도 별개 레코드로 추가
   - mode='replace_keep_matched': 매칭(identical/conflict update or skip)된 기존만 유지, 나머지 기존 삭제 */
function wrApplyDecisions(newRecs,analysis,decisions){
  decisions=decisions||{};var dMap=decisions.conflicts||{};
  var mode=decisions.mode||'merge';
  var deduped=analysis.deduped;
  var keepFlags=deduped.map(function(){return mode==='merge'});
  var result=deduped.slice();
  var added=0,updated=0,skipped=0;

  analysis.identical.forEach(function(it){
    var i=it.existingIdx;
    result[i]=Object.assign({},result[i],it.newRec);
    keepFlags[i]=true;updated++;
  });
  // 충돌 후보 중 같은 existing이 여러 newRec의 update 대상이 되는 것을 막음
  var claimedForUpdate=new Set();
  analysis.conflicts.forEach(function(c){
    var dec=dMap[c.newIdx]||'skip';
    if(dec==='update'){
      var target=c.candidates.find(function(cd){return !claimedForUpdate.has(cd.idx)});
      if(target){
        claimedForUpdate.add(target.idx);
        result[target.idx]=Object.assign({},result[target.idx],c.newRec);
        keepFlags[target.idx]=true;updated++;
      }else{
        // 모든 후보가 이미 다른 newRec에 의해 갱신됨 → 별개 추가로 폴백
        result.push(c.newRec);added++;
      }
    }else if(dec==='add'){
      c.candidates.forEach(function(cd){keepFlags[cd.idx]=true});
      result.push(c.newRec);added++;
    }else{ // skip
      c.candidates.forEach(function(cd){keepFlags[cd.idx]=true});
      skipped++;
    }
  });
  analysis.newRows.forEach(function(n){result.push(n.newRec);added++});

  if(mode==='replace_keep_matched'){
    var origLen=deduped.length;
    var filtered=[];
    for(var i=0;i<origLen;i++){if(keepFlags[i])filtered.push(result[i])}
    for(var i=origLen;i<result.length;i++)filtered.push(result[i]);
    var deleted=origLen-filtered.length;
    return{merged:filtered,added:added,updated:updated,skipped:skipped,deleted:deleted,removedDups:analysis.dupRemoved};
  }
  return{merged:result,added:added,updated:updated,skipped:skipped,deleted:0,removedDups:analysis.dupRemoved};
}

/* ═══ Import 미리보기 모달 ═══
   resolve: { action: 'cancel' | 'apply', decisions: { conflicts: {...}, mode: 'merge'|'replace_keep_matched' } } */
function showImportPreviewModal(analysis,opts){
  opts=opts||{};
  return new Promise(function(resolve){
    var nIdent=analysis.identical.length,nConf=analysis.conflicts.length,nNew=analysis.newRows.length;
    var ov=createModal({id:'wrPreviewOverlay'}).overlay;  /* v13.190 공통 모달(z 자동 스택·id 중복 제거) */
    var dlg=ov.querySelector('.wa-modal-box');
    dlg.style.cssText='background:var(--bg-p);border-radius:12px;padding:0;max-width:880px;width:94%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);border:1px solid var(--bd)';

    var head='<div style="padding:18px 22px 12px;border-bottom:1px solid var(--bd)">'+
      '<div style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:6px">📊 업무일지 가져오기 미리보기</div>'+
      '<div style="font-size:11px;color:var(--t4)">DB 기존 <b style="color:var(--t2)">'+(opts.existCount||0)+'건</b> · 새 파일 <b style="color:var(--t2)">'+(opts.newCount||0)+'건</b></div>'+
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">'+
        '<span class="badge" style="background:rgba(16,185,129,.15);color:'+SEM_COLOR.ok+';font-size:11px;padding:4px 10px;border-radius:6px;font-weight:600">🆕 신규 '+nNew+'</span>'+
        '<span class="badge" style="background:rgba(59,130,246,.15);color:'+SEM_COLOR.info+';font-size:11px;padding:4px 10px;border-radius:6px;font-weight:600">✓ 자동 갱신 '+nIdent+'</span>'+
        '<span class="badge" style="background:rgba(245,158,11,.15);color:'+SEM_COLOR.warn+';font-size:11px;padding:4px 10px;border-radius:6px;font-weight:600">⚠️ 충돌 '+nConf+'</span>'+
      '</div>'+
    '</div>';

    // 충돌 행 렌더 — 행 단위 결정
    var conflictsHtml='';
    if(nConf>0){
      conflictsHtml='<div style="padding:14px 22px 4px;font-size:12px;color:var(--t3);font-weight:600">⚠️ 충돌 (날짜+이름+수주번호 일치하나 시간/내용 차이) — 행별 처리 선택</div>';
      conflictsHtml+='<div style="display:flex;gap:8px;padding:0 22px 8px"><button class="btn btn-g btn-s" id="wrConfAllUpd" style="font-size:10px">전체 갱신</button><button class="btn btn-g btn-s" id="wrConfAllSkip" style="font-size:10px">전체 무시</button><button class="btn btn-g btn-s" id="wrConfAllAdd" style="font-size:10px">전체 별개 추가</button></div>';
      conflictsHtml+='<div style="overflow:auto;flex:1;padding:0 22px"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="position:sticky;top:0;background:var(--bg-i)">'+
        '<th style="padding:6px;text-align:left;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">날짜</th>'+
        '<th style="padding:6px;text-align:left;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">이름</th>'+
        '<th style="padding:6px;text-align:left;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">수주번호</th>'+
        '<th style="padding:6px;text-align:right;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">기존 시간</th>'+
        '<th style="padding:6px;text-align:right;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">새 시간</th>'+
        '<th style="padding:6px;text-align:left;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">기존 내용 → 새 내용</th>'+
        '<th style="padding:6px;text-align:center;color:var(--t5);font-weight:600;border-bottom:1px solid var(--bd)">처리</th>'+
        '</tr></thead><tbody>';
      analysis.conflicts.forEach(function(c){
        var ex=c.candidates[0]?c.candidates[0].rec:{};
        var ambiguous=c.candidates.length>1;
        var diffH=Number(ex.hours||0)!==Number(c.newRec.hours||0);
        var diffC=String(ex.content||'')!==String(c.newRec.content||'');
        var contentCell='';
        if(diffC){
          contentCell='<span style="color:var(--t6)">'+eH(String(ex.content||'').slice(0,40))+'</span> → <span style="color:'+SEM_COLOR.warn+'">'+eH(String(c.newRec.content||'').slice(0,40))+'</span>';
        }else{
          contentCell='<span style="color:var(--t6)">'+eH(String(ex.content||'').slice(0,60))+'</span>';
        }
        conflictsHtml+='<tr data-newidx="'+c.newIdx+'" style="border-bottom:1px solid var(--bd)'+(ambiguous?';background:rgba(239,68,68,.06)':'')+'">'+
          '<td style="padding:5px 6px;color:var(--t3)">'+fD(c.newRec.date)+(ambiguous?'<span title="동일 키 후보 '+c.candidates.length+'건" style="color:'+SEM_COLOR.danger+';margin-left:4px">⚠'+c.candidates.length+'</span>':'')+'</td>'+
          '<td style="padding:5px 6px;color:var(--t3)">'+eH(c.newRec.name||'')+'</td>'+
          '<td style="padding:5px 6px;color:var(--t3)">'+eH(c.newRec.orderNo||'')+'</td>'+
          '<td style="padding:5px 6px;text-align:right;color:'+(diffH?'var(--t6)':'var(--t3)')+'">'+(ex.hours||0)+'</td>'+
          '<td style="padding:5px 6px;text-align:right;color:'+(diffH?SEM_COLOR.warn:'var(--t3)')+';font-weight:'+(diffH?'600':'400')+'">'+(c.newRec.hours||0)+'</td>'+
          '<td style="padding:5px 6px">'+contentCell+'</td>'+
          '<td style="padding:5px 6px;text-align:center"><select class="wrConfSel" data-newidx="'+c.newIdx+'" style="font-size:10px;padding:2px 4px;background:var(--bg-i);color:var(--t2);border:1px solid var(--bd);border-radius:4px">'+
            '<option value="skip">기존 유지</option>'+
            '<option value="update">새 값으로 갱신</option>'+
            '<option value="add">별개 추가</option>'+
          '</select></td></tr>';
      });
      conflictsHtml+='</tbody></table></div>';
    }else{
      conflictsHtml='<div style="padding:24px;text-align:center;color:var(--t6);font-size:12px;flex:1">충돌 없음 — 모두 자동 처리됩니다.</div>';
    }

    var foot='<div style="padding:14px 22px;border-top:1px solid var(--bd);display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
      '<label style="font-size:11px;color:var(--t4);display:flex;align-items:center;gap:6px;cursor:pointer">'+
        '<input type="checkbox" id="wrPreviewReplaceMode" style="cursor:pointer"> 매칭되지 않은 기존 데이터 삭제 (선택적 대체)'+
      '</label>'+
      '<div style="flex:1"></div>'+
      '<button id="wrPreviewCancel" class="btn btn-g btn-s">취소</button>'+
      '<button id="wrPreviewApply" class="btn btn-p btn-s" style="background:var(--ac);color:#fff">적용</button>'+
    '</div>';

    dlg.innerHTML=head+conflictsHtml+foot;
    ov.appendChild(dlg);document.body.appendChild(ov);
    function close(v){ov.remove();resolve(v)}
    dlg.querySelector('#wrPreviewCancel').onclick=function(){close({action:'cancel'})};
    dlg.querySelector('#wrPreviewApply').onclick=function(){
      var dec={};
      dlg.querySelectorAll('.wrConfSel').forEach(function(sel){dec[sel.dataset.newidx]=sel.value});
      var mode=dlg.querySelector('#wrPreviewReplaceMode').checked?'replace_keep_matched':'merge';
      close({action:'apply',decisions:{conflicts:dec,mode:mode}});
    };
    var allBtn=function(val){return function(){dlg.querySelectorAll('.wrConfSel').forEach(function(s){s.value=val})}};
    var b1=dlg.querySelector('#wrConfAllUpd');if(b1)b1.onclick=allBtn('update');
    var b2=dlg.querySelector('#wrConfAllSkip');if(b2)b2.onclick=allBtn('skip');
    var b3=dlg.querySelector('#wrConfAllAdd');if(b3)b3.onclick=allBtn('add');
    ov.onclick=function(e){if(e.target===ov)close({action:'cancel'})};
  });
}

/* ═══ FILE ═══ */
function parseFileBuf(buf,enc){
  const u8=new Uint8Array(buf);
  const isOLE2=u8[0]===0xD0&&u8[1]===0xCF&&u8[2]===0x11&&u8[3]===0xE0;
  const isPK=u8[0]===0x50&&u8[1]===0x4B&&u8[2]===0x03&&u8[3]===0x04;
  _lastColMap=null;
  var result=[];
  if(isOLE2||isPK){
    result=pXLS(u8);
    if(!result.length)console.log('SheetJS 파싱 실패, HTML 폴백 시도');
  }
  // HTML/텍스트 파싱 시도 (EUC-KR → UTF-8 순서)
  if(!result.length){
    var encs=[enc,'euc-kr','utf-8','cp949'];
    for(var ei=0;ei<encs.length;ei++){
      try{
        var text=new TextDecoder(encs[ei],{fatal:true}).decode(buf);
        result=pH(text);
        if(result.length){console.log('HTML 파싱 성공 (인코딩:'+encs[ei]+', '+result.length+'건)');break}
      }catch(e){/* 다음 인코딩 시도 */}
    }
  }
  if(!result.length){
    try{
      var text=new TextDecoder(enc,{fatal:false}).decode(buf);
      result=pH(text);
    }catch(e){}
  }
  if(!result.length){
    showToast('파일에서 데이터를 파싱하지 못했습니다. 최소 날짜, 이름 컬럼이 필요합니다.','error');
    return[];
  }
  // 누락 컬럼 안내 (수주명·거래처는 선택 컬럼 — 누락되어도 ORDER_MAP에서 자동 보완되므로 안내 제외)
  if(_lastColMap){
    var labels={date:'날짜',name:'이름',orderNo:'수주번호',hours:'시간',taskType:'업무분장',abbr:'약자',content:'업무내용'};
    var missing=COL_ALL.filter(function(k){return labels[k]&&_lastColMap[k]===undefined});
    if(missing.length>0){
      var names=missing.map(function(k){return labels[k]});
      showToast('📋 '+result.length+'건 로드 (누락 컬럼: '+names.join(', ')+' → 빈값 처리)','info');
    }
  }
  return result;
}

function applyADToUI(){
  /* 기존 필터 선택 보존 — 병합/갱신 시 사용자 뷰가 리셋되지 않도록 */
  var prevSN=new Set(sN),prevSO=new Set(sO),prevST=new Set(sT),prevSDV=new Set(sDV),prevKw=cKw||'';
  var aNSet=new Set(aD.map(r=>r.name));
  var aOSet=new Set(aD.map(r=>r.orderNo).filter(Boolean));
  var aTSet=new Set(aD.map(r=>r.abbr).filter(Boolean));
  var aDVSet=new Set(aD.map(r=>r.dept).filter(Boolean));
  aN=[...aNSet].sort();ldFvS();upFvB();if(fvO&&fvN.length>0)vN=aN.filter(n=>fvN.includes(n));else vN=[...aN];
  sN.clear();sO.clear();sT.clear();sDV.clear();cKw='';gfInvalidate();
  /* 이전 선택 중 현재 aD에도 존재하는 것만 복원 */
  prevSN.forEach(function(n){if(aNSet.has(n))sN.add(n)});
  prevSO.forEach(function(o){if(aOSet.has(o))sO.add(o)});
  prevST.forEach(function(t){if(aTSet.has(t))sT.add(t)});
  prevSDV.forEach(function(d){if(aDVSet.has(d))sDV.add(d)});
  if(prevKw)cKw=prevKw;
  document.getElementById('cSearch').value=cKw;
  document.getElementById('sClear').classList.toggle('hidden',!cKw);
  document.getElementById('fileInfo').classList.remove('hidden');document.getElementById('rcDisp').textContent=aD.length;document.getElementById('uploadZone').classList.add('hidden');document.getElementById('mainArea').classList.remove('hidden');
  /* 이전 선택이 하나도 없었을 때만 즐겨찾기로 초기 선택 */
  if(sN.size===0&&fvN.length>0){aN.forEach(n=>{if(fvN.includes(n))sN.add(n)});if(sN.size>1){multiSel=true;document.getElementById('multiSelTog').checked=true;document.getElementById('selAllBtn').classList.remove('hidden')}}
  if(sN.size>1){multiSel=true;document.getElementById('multiSelTog').checked=true;document.getElementById('selAllBtn').classList.remove('hidden')}
  const dates=[...new Set(aD.map(r=>r.date))].sort();if(dates.length>0){const d=dates[0];const dt=new Date(+d.slice(0,4),+d.slice(4,6)-1,+d.slice(6,8));const wk=getISOWeek(dt);document.getElementById('weekLabel').value=d.slice(0,4)+'-W'+String(wk).padStart(2,'0');document.getElementById('weekAutoLabel').textContent=`(${fD(dates[0])} ~ ${fD(dates[dates.length-1])})`}
  initWeekSelector();syncCmpVisibility();rNC();rFL();upV();document.getElementById('sumOut').innerHTML='<div style="text-align:center;color:var(--t6);padding:30px;font-size:12px">위 "요약 생성" 버튼을 눌러주세요.</div>';
  if(typeof mtrInit==='function')mtrInit();
  if(typeof mtrCInit==='function')mtrCInit();
}

async function ldBuf(buf,enc,dept){lBuf=buf;
  var newRecords=parseFileBuf(buf,enc);
  if(!newRecords.length)return;
  if(dept)newRecords.forEach(function(r){r.dept=dept});
  /* 파일 자체 중복 제거 */
  var _seen=new Set();newRecords=newRecords.filter(function(r){var k=wrKey(r);if(_seen.has(k))return false;_seen.add(k);return true});

  // DB에 기존 데이터가 있는지 확인
  var existCount=0;
  try{if(typeof wrCount==='function')existCount=await wrCount()}catch(ex){console.warn('wrCount err:',ex)}

  if(existCount>0){
    // 기존 데이터 존재 → 갱신/대체/취소 선택
    var choice=await showWorkRecordChoiceModal(existCount, newRecords.length);
    if(choice==='cancel')return;
    if(choice==='merge'){
      // 병합 — 미리보기 모달로 충돌 행별 처리
      var existing=await wrGetAll();
      var analysis=wrAnalyzeImport(existing, newRecords);
      var needPreview=analysis.conflicts.length>0||analysis.identical.length>0;
      var decision;
      if(needPreview){
        decision=await showImportPreviewModal(analysis,{existCount:existCount,newCount:newRecords.length});
        if(decision.action==='cancel')return;
      }else{
        // 영향 없는 신규 추가만 — 미리보기 생략
        decision={action:'apply',decisions:{conflicts:{},mode:'merge'}};
      }
      var result=wrApplyDecisions(newRecords, analysis, decision.decisions);
      // wrBulkPut은 로컬·서버 모두에서 사용자 레코드 전체 삭제 후 재삽입 의미 — replace/merge 두 모드 모두 단일 호출로 충분
      await wrBulkPut(result.merged);
      // 서버에서 자동 생성된 신규 id로 aD를 리로드 — 이후 편집/PATCH 시 stale id로 인한 silent 실패 방지
      try{aD=await wrGetAll()}catch(e){aD=result.merged.map(function(r){var o={date:r.date,name:r.name,orderNo:r.orderNo,hours:r.hours,taskType:r.taskType,abbr:r.abbr,content:r.content};if(r.id)o.id=r.id;if(r.ocmt!==undefined)o.ocmt=r.ocmt;if(r.oclient!==undefined)o.oclient=r.oclient;if(r.dept)o.dept=r.dept;return o})}
      var parts=[];
      if(result.added)parts.push('추가 '+result.added);
      if(result.updated)parts.push('갱신 '+result.updated);
      if(result.skipped)parts.push('무시 '+result.skipped);
      if(result.deleted)parts.push('삭제 '+result.deleted);
      showToast('📊 업무일지 가져오기: 총 '+result.merged.length+'건'+(parts.length?' ('+parts.join(', ')+')':''));
    }else{
      // 대체: 기존 삭제 후 새로 저장
      await wrClear();
      await wrBulkPut(newRecords);
      try{aD=await wrGetAll()}catch(e){aD=newRecords}
      showToast('📊 업무일지 새로 불러오기: '+newRecords.length+'건');
    }
  }else{
    // 기존 데이터 없음 → 바로 저장
    await wrBulkPut(newRecords);
    try{aD=await wrGetAll()}catch(e){aD=newRecords}
    showToast('📊 업무일지 저장: '+newRecords.length+'건');
  }
  applyADToUI();
}

/* 업무일지 갱신/대체 선택 모달 */
function showWorkRecordChoiceModal(existCount, newCount){
  return new Promise(function(resolve){
    var ov=createModal({id:'wrChoiceOverlay'}).overlay;  /* v13.190 공통 모달(z 자동 스택·id 중복 제거) */
    var dlg=ov.querySelector('.wa-modal-box');
    dlg.style.cssText='background:var(--bg-p);border-radius:12px;padding:24px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3)';
    dlg.innerHTML='<div style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:12px">📊 업무일지 데이터 처리</div>'+
      '<p style="font-size:12px;color:var(--t3);margin-bottom:16px">기존 DB에 <b style="color:var(--ac-t)">'+existCount+'건</b>의 데이터가 있습니다.<br>새 파일에서 <b style="color:var(--ac-t)">'+newCount+'건</b>을 읽었습니다.</p>'+
      '<div style="display:flex;flex-direction:column;gap:8px">'+
      '<button id="wrMergeBtn" style="width:100%;padding:10px;border:1px solid var(--ac);border-radius:8px;background:var(--ac-bg);color:var(--ac-t);cursor:pointer;font-size:12px;font-weight:600">🔄 갱신 (기존 데이터에 추가, 중복 제외)</button>'+
      '<button id="wrReplaceBtn" style="width:100%;padding:10px;border:1px solid '+SEM_COLOR.warn+';border-radius:8px;background:rgba(245,158,11,.12);color:#FCD34D;cursor:pointer;font-size:12px;font-weight:600">🔃 새로 불러오기 (기존 데이터 대체)</button>'+
      '<button id="wrCancelBtn" style="width:100%;padding:8px;border:1px solid var(--bd);border-radius:8px;background:var(--bg-i);color:var(--t5);cursor:pointer;font-size:11px">취소</button>'+
      '</div>';
    ov.appendChild(dlg);document.body.appendChild(ov);
    function close(v){ov.remove();resolve(v)}
    dlg.querySelector('#wrMergeBtn').onclick=function(){close('merge')};
    dlg.querySelector('#wrReplaceBtn').onclick=function(){close('replace')};
    dlg.querySelector('#wrCancelBtn').onclick=function(){close('cancel')};
    ov.onclick=function(e){if(e.target===ov)close('cancel')};
  });
}

/* DB에서 업무일지 로드하여 aD 반영 */
async function loadWorkRecordsFromDB(){
  try{
    if(typeof wrGetAll!=='function')return false;
    var records=await wrGetAll();
    if(!records||!records.length)return false;
    aD=records;
    applyADToUI();
    return true;
  }catch(ex){console.warn('loadWorkRecordsFromDB err:',ex);return false}
}

/* 업무일지 DB를 JSON 파일로 내보내기 */
async function exportWorkRecordsJSON(){
  try{
    var records=await wrGetAll();
    if(!records.length){showToast('저장된 업무일지 데이터가 없습니다.','warn');return}
    var data={type:'workRecords',version:1,exportDate:new Date().toISOString(),count:records.length,records:records.map(function(r){var o={date:r.date,name:r.name,orderNo:r.orderNo,hours:r.hours,taskType:r.taskType,abbr:r.abbr,content:r.content};if(r.dept)o.dept=r.dept;if(r.ocmt!==undefined)o.ocmt=r.ocmt;if(r.oclient!==undefined)o.oclient=r.oclient;return o})};
    var json=JSON.stringify(data,null,2);
    var blob=new Blob([json],{type:'application/json'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');a.href=url;
    a.download='work-records-'+localDate()+'.json';
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
    showToast('💾 업무일지 내보내기 완료 ('+records.length+'건)');
  }catch(ex){showToast('내보내기 실패: '+ex.message,'error')}
}

/* 업무일지 JSON 파일 불러오기 */
function importWorkRecordsJSON(file){
  if(!file)return;
  var reader=new FileReader();
  reader.onload=async function(e){
    try{
      var data=JSON.parse(e.target.result);
      if(!data.records||!data.records.length){showToast('유효하지 않은 업무일지 파일입니다.','error');return}
      /* 파일 자체 중복 제거 */
      var _seen=new Set();data.records=data.records.filter(function(r){var k=wrKey(r);if(_seen.has(k))return false;_seen.add(k);return true});
      var existCount=await wrCount();
      if(existCount>0){
        var choice=await showWorkRecordChoiceModal(existCount, data.records.length);
        if(choice==='cancel')return;
        if(choice==='merge'){
          var existing=await wrGetAll();
          var analysis=wrAnalyzeImport(existing, data.records);
          var needPreview=analysis.conflicts.length>0||analysis.identical.length>0;
          var decision;
          if(needPreview){
            decision=await showImportPreviewModal(analysis,{existCount:existCount,newCount:data.records.length});
            if(decision.action==='cancel')return;
          }else{
            decision={action:'apply',decisions:{conflicts:{},mode:'merge'}};
          }
          var result=wrApplyDecisions(data.records, analysis, decision.decisions);
          await wrBulkPut(result.merged);
          try{aD=await wrGetAll()}catch(e){aD=result.merged.map(function(r){var o={date:r.date,name:r.name,orderNo:r.orderNo,hours:r.hours,taskType:r.taskType,abbr:r.abbr,content:r.content};if(r.id)o.id=r.id;if(r.ocmt!==undefined)o.ocmt=r.ocmt;if(r.oclient!==undefined)o.oclient=r.oclient;if(r.dept)o.dept=r.dept;return o})}
          var parts=[];
          if(result.added)parts.push('추가 '+result.added);
          if(result.updated)parts.push('갱신 '+result.updated);
          if(result.skipped)parts.push('무시 '+result.skipped);
          if(result.deleted)parts.push('삭제 '+result.deleted);
          showToast('📊 업무일지 가져오기: 총 '+result.merged.length+'건'+(parts.length?' ('+parts.join(', ')+')':''));
        }else{
          await wrClear();
          await wrBulkPut(data.records);
          try{aD=await wrGetAll()}catch(e){aD=data.records}
          showToast('📊 업무일지 불러오기: '+data.records.length+'건');
        }
      }else{
        await wrBulkPut(data.records);
        try{aD=await wrGetAll()}catch(e){aD=data.records}
        showToast('📊 업무일지 불러오기: '+data.records.length+'건');
      }
      applyADToUI();
    }catch(ex){showToast('파일 읽기 실패: '+ex.message,'error')}
  };
  reader.readAsText(file);
}

/* 중복 레코드 제거 */
async function deduplicateRecords(){
  if(!aD.length){showToast('데이터가 없습니다.','warn');return}
  var seen=new Set();var deduped=[];
  aD.forEach(function(r){var k=wrIdKey(r);if(!seen.has(k)){seen.add(k);deduped.push(r)}});
  var removed=aD.length-deduped.length;
  if(!removed){showToast('중복 레코드가 없습니다.','info');return}
  if(!confirm('총 '+aD.length+'건 중 '+removed+'건의 중복 레코드를 제거합니다.\n(날짜+이름+수주번호 기준)\n\n계속하시겠습니까?'))return;
  try{
    await wrBulkPut(deduped);
    aD=deduped;
    gfInvalidate();rFL();upV();
    showToast('✅ 중복 '+removed+'건 제거 완료 ('+deduped.length+'건 유지)');
  }catch(e){
    console.error('[dedup]',e);
    showToast('중복 제거 실패: '+(e.message||'서버 오류'),'error');
  }
}

/* 전체 데이터 초기화 (서버 API) — 서버에서 역할별 스코프로 삭제 */
async function resetAllData(){
  // 현재 보이는 건수로 사용자에게 실제 영향 범위 미리 표시
  var visibleCount=(typeof aD!=='undefined'&&Array.isArray(aD))?aD.length:0;
  var role=(typeof currentUser!=='undefined'&&currentUser&&currentUser.role)||'';
  var scopeHint='';
  if(role==='admin')scopeHint='⚠️ 관리자 권한 — 테넌트 전체 업무일지가 삭제됩니다.';
  else if(role==='manager'||role==='executive')scopeHint='⚠️ 매니저/임원 권한 — 소속 부서 전체 업무일지가 삭제됩니다 (부서원 모두).';
  else scopeHint='본인 계정의 업무일지 데이터만 삭제됩니다.';
  var msg='⚠️ 업무일지 데이터를 전체 초기화하시겠습니까?\n\n'+scopeHint+'\n현재 화면 표시 '+visibleCount+'건.\n이 작업은 되돌릴 수 없습니다.';
  if(!confirm(msg))return;
  if(!confirm('정말 초기화하시겠습니까?\n(한번 더 확인)'))return;
  try{
    var _clearResult=null;
    if(typeof wrClear==='function'){
      try{ _clearResult=await wrClear(); }catch(e1){
        if(e1.status>=500){
          await new Promise(function(r){setTimeout(r,2000)});
          _clearResult=await wrClear();
        }else throw e1;
      }
    }
    // 메모리 초기화
    aD=[];aN=[];vN=[];sN.clear();sO.clear();sT.clear();sON.clear();sCL.clear();sDV.clear();
    document.getElementById('uploadZone').classList.remove('hidden');
    document.getElementById('mainArea').classList.add('hidden');
    document.getElementById('fileInfo').classList.add('hidden');
    var deletedN=(_clearResult&&typeof _clearResult.deleted==='number')?_clearResult.deleted:null;
    var scope=(_clearResult&&_clearResult.scope)||'';
    var scopeLabel=scope==='tenant'?'테넌트 전체':(scope==='department'?'소속 부서':(scope==='self'?'본인':''));
    showToast('🗑️ 업무일지 초기화 완료'+(deletedN!==null?(' — '+deletedN+'건 삭제'+(scopeLabel?(' ('+scopeLabel+')'):'')):''));
  }catch(ex){showToast('초기화 실패: '+ex.message,'error')}
}
function getISOWeek(d){const t=new Date(d.valueOf());const n=((d.getDay()+6)%7);t.setDate(t.getDate()-n+3);const f=t.valueOf();t.setMonth(0,1);if(t.getDay()!==4)t.setMonth(0,1+((4-t.getDay())+7)%7);return 1+Math.ceil((f-t)/604800000)}
function detectDept(fileName){
  for(var i=0;i<DEPT_LIST.length;i++){if(fileName.indexOf(DEPT_LIST[i])!==-1)return DEPT_LIST[i]}
  return null;
}
function showDeptSelectModal(){
  return new Promise(function(resolve){
    var ov=createModal({}).overlay;  /* v13.190 공통 모달(z 자동 스택·id 중복 제거) */
    var dlg=ov.querySelector('.wa-modal-box');
    dlg.style.cssText='background:var(--bg-p);border-radius:12px;padding:24px;max-width:360px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3)';
    dlg.innerHTML='<div style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:8px">🏢 사업부 선택</div>'+
      '<p style="font-size:11px;color:var(--t5);margin-bottom:14px">파일명에서 사업부를 감지하지 못했습니다. 선택해주세요.</p>'+
      '<div style="display:flex;flex-direction:column;gap:8px">'+
      DEPT_LIST.map(function(d){return'<button class="deptBtn" data-dept="'+d+'" style="width:100%;padding:10px;border:1px solid var(--ac);border-radius:8px;background:var(--ac-bg);color:var(--ac-t);cursor:pointer;font-size:12px;font-weight:600">'+d+'</button>'}).join('')+
      '<button id="deptSkipBtn" style="width:100%;padding:8px;border:1px solid var(--bd);border-radius:8px;background:var(--bg-i);color:var(--t5);cursor:pointer;font-size:11px">사업부 없이 불러오기</button>'+
      '</div>';
    ov.appendChild(dlg);document.body.appendChild(ov);
    function close(v){ov.remove();resolve(v)}
    dlg.querySelectorAll('.deptBtn').forEach(function(btn){btn.onclick=function(){close(btn.dataset.dept)}});
    dlg.querySelector('#deptSkipBtn').onclick=function(){close('')};
    ov.onclick=function(e){if(e.target===ov)close('')};
  });
}
async function hFile(file,enc){if(!file)return;document.getElementById('fnDisp').textContent=file.name;
  var dept=detectDept(file.name);
  if(dept===null)dept=await showDeptSelectModal();
  const r=new FileReader();r.onload=async function(e){await ldBuf(e.target.result,enc||cEnc,dept)};r.readAsArrayBuffer(file)}

/* 여러 파일 순차 처리 */
async function hFiles(fileList){
  if(!fileList||!fileList.length)return;
  var files=Array.from(fileList).filter(function(f){return/\.(xls|xlsx|html?|csv)$/i.test(f.name)});
  if(!files.length){showToast('지원하지 않는 파일 형식입니다.','error');return}
  if(files.length===1){hFile(files[0]);return}
  showToast('📂 '+files.length+'개 파일 로드 중...');
  for(var i=0;i<files.length;i++){
    await hFile(files[i]);
  }
  showToast('✓ '+files.length+'개 파일 로드 완료','success');
}
function chEnc(enc){cEnc=enc;rEC();if(lBuf){var newRecords=parseFileBuf(lBuf,enc);if(newRecords.length){aD=newRecords;applyADToUI()}}}
function rEC(){['encUp','encMain'].forEach(id=>{const el=document.getElementById(id);if(!el)return;el.innerHTML=ENC.map(e=>`<span class="chip ${e===cEnc?'cn':'co'}" style="padding:3px 8px;font-size:10px" onclick="event.stopPropagation();chEnc('${e}')">${e}</span>`).join('')})}

