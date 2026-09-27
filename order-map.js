/* order-map.js — 수주번호 ↔ 수주 정보 매핑 · 수주맵 엑셀 불러오기/저장 · 수주 패널
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ 수주번호 ↔ 수주 정보 매핑 (엑셀 기반 + localStorage 병합) ═══ */
/* ORDER_MAP[수주번호] = {name, date, client, amount, manager, delivery} 또는 문자열(레거시) */
/* 수주명/거래처는 per-record ocmt/oclient 필드로 서버 DB에 직접 저장 */
var ORDER_FIELDS=['수주번호','수주일','거래처','프로젝트명','수주액','담당자','납품예정'];
var ORDER_FIELD_KEYS=['orderNo','date','client','name','amount','manager','delivery'];
function getOrderInfo(orderNo){
  var info=ORDER_MAP[orderNo];
  if(!info)return null;
  if(typeof info==='string')return{name:info,date:'',client:'',amount:'',manager:'',delivery:''};
  return info;
}
function getOCmt(orderNo){
  var info=getOrderInfo(orderNo);
  if(info&&info.name)return info.name;
  return '';
}
function getOClient(orderNo){
  var info=getOrderInfo(orderNo);
  return info&&info.client?info.client:'';
}
/* 전체 수주맵 상세 반환 — {수주번호: {name,date,client,...}} */
function getAllOrderDetails(){
  var merged={};
  if(typeof ORDER_MAP!=='undefined'){
    Object.keys(ORDER_MAP).forEach(function(k){
      var v=ORDER_MAP[k];
      if(typeof v==='object'&&v)merged[k]=v;
      else merged[k]={name:v||'',date:'',client:'',amount:'',manager:'',delivery:''};
    });
  }
  return merged;
}
function saveOCmt(orderNo){
  const inp=document.getElementById('oc_'+CSS.escape(orderNo));
  if(!inp)return;
  const val=inp.value.trim();
  /* per-record ocmt 업데이트: 해당 수주번호의 모든 레코드에 반영 후 서버 저장 */
  aD.forEach(function(r){if(r.orderNo===orderNo)r.ocmt=val||null});
  wrBulkPut(aD).catch(function(e){console.error('[saveOCmt] DB 저장 실패:',e)});
  gfInvalidate();
  rFL();rOL();upV();
  const fb=document.getElementById('ocfb_'+CSS.escape(orderNo));
  if(fb){fb.textContent='✅';setTimeout(()=>{fb.textContent=''},800)}
}
/* ═══ 수주맵 엑셀 불러오기 / 저장하기 ═══ */
function importOrderExcel(){document.getElementById('orderExcelInput').click()}
function handleOrderExcel(input){
  var file=input.files[0];if(!file)return;
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array',cellDates:false,raw:true});
      var ws=wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
      if(rows.length<2){throw new Error('데이터 행이 없습니다')}
      /* 헤더에서 컬럼 인덱스 매핑 (유연하게 매칭) */
      var hdr=rows[0].map(function(c){return String(c||'').replace(/[\uFEFF\u200B\u00A0]/g,'').trim()});
      console.log('[수주맵] 감지된 헤더:', JSON.stringify(hdr));
      var colMap={};
      var aliases={
        'orderNo':['수주번호','수주no','order','orderno','no','번호'],
        'date':['수주일','수주날짜','수주date','date','일자','날짜'],
        'client':['거래처','고객','고객사','client','customer','업체','업체명'],
        'name':['프로젝트명','프로젝트','project','name','수주명','건명','공사명'],
        'amount':['수주액','금액','수주금액','amount','계약금액'],
        'manager':['담당자','담당','manager','pm'],
        'delivery':['납품예정','납품일','납기','납기일','delivery','duedate','due','납품예정일']
      };
      /* 정규화 함수: 소문자 + 공백/특수문자 모두 제거 */
      function normH(s){return s.toLowerCase().replace(/[\s_\-\.·,()（）\u00A0]/g,'')}
      ORDER_FIELD_KEYS.forEach(function(key){
        if(colMap[key]!==undefined)return;
        var alts=aliases[key]||[];
        for(var ci=0;ci<hdr.length;ci++){
          var h=normH(hdr[ci]);
          if(!h)continue;
          for(var ai=0;ai<alts.length;ai++){
            if(h===normH(alts[ai])){colMap[key]=ci;return}
          }
        }
      });
      /* 부분 매칭 폴백: 정확 매칭 실패 시 포함 여부 확인 */
      if(colMap.orderNo===undefined){
        for(var ci=0;ci<hdr.length;ci++){
          var h=normH(hdr[ci]);
          if(h.indexOf('수주')>=0&&h.indexOf('번호')>=0){colMap.orderNo=ci;break}
          if(h.indexOf('order')>=0&&h.indexOf('no')>=0){colMap.orderNo=ci;break}
        }
      }
      /* 최종: 첫 번째 열을 수주번호로 추정 */
      if(colMap.orderNo===undefined&&hdr.length>=2){
        console.warn('[수주맵] 수주번호 컬럼 자동매칭 실패 → 첫 번째 열('+hdr[0]+')을 수주번호로 사용');
        colMap.orderNo=0;
      }
      if(colMap.orderNo===undefined){throw new Error('수주번호 컬럼을 찾을 수 없습니다. 헤더: '+hdr.join(', '))}
      /* 나머지 미매칭 필드도 부분매칭 시도 */
      var partialMap={'date':'수주일','client':'거래처','name':['프로젝트','수주명'],'delivery':['납품','납기']};
      ORDER_FIELD_KEYS.forEach(function(key){
        if(key==='orderNo'||colMap[key]!==undefined)return;
        var terms=partialMap[key];
        if(!terms)return;
        if(typeof terms==='string')terms=[terms];
        for(var ci=0;ci<hdr.length;ci++){
          if(ci===colMap.orderNo)continue;
          var alreadyUsed=false;
          Object.keys(colMap).forEach(function(k){if(colMap[k]===ci)alreadyUsed=true});
          if(alreadyUsed)continue;
          var h=normH(hdr[ci]);
          for(var ti=0;ti<terms.length;ti++){
            if(h.indexOf(normH(terms[ti]))>=0){colMap[key]=ci;return}
          }
        }
      });
      console.log('[수주맵] 컬럼 매핑:', JSON.stringify(colMap));
      var count=0;
      ORDER_MAP={};
      var dupNos=[];
      /* 날짜 정규화 — 엑셀 날짜 서식 셀은 raw 로 읽으면 시리얼(45815)로 들어오고,
         텍스트 셀은 '2026-03-03 00:00:00' 처럼 10자를 넘겨 서버 VARCHAR(10) 저장에 실패한다.
         project-data.js 의 wmNormOrderDate 를 쓰고, 로드 실패 시엔 원본을 그대로 둔다. */
      var normD=(typeof wmNormOrderDate==='function')?wmNormOrderDate:function(v){return String(v==null?'':v).trim()};
      for(var i=1;i<rows.length;i++){
        var r=rows[i];
        var no=String(r[colMap.orderNo]||'').trim();
        if(!no)continue;
        if(ORDER_MAP[no]!==undefined&&dupNos.indexOf(no)<0)dupNos.push(no);
        var info={name:'',date:'',client:'',amount:'',manager:'',delivery:''};
        ORDER_FIELD_KEYS.forEach(function(key){
          if(key==='orderNo'||colMap[key]===undefined)return;
          var raw=String(r[colMap[key]]||'').trim();
          info[key]=(key==='date'||key==='delivery')?normD(raw):raw;
        });
        ORDER_MAP[no]=info;   /* 같은 번호가 여러 줄이면 마지막 줄이 이긴다 */
        /* localStorage 캐시 제거됨 — ORDER_MAP에만 저장 */
        count++;
      }
      gfInvalidate();rFL();rOL();upOP();upV();
      var uniq=Object.keys(ORDER_MAP).length;
      var dupMsg=dupNos.length?' · 중복 '+dupNos.length+'건은 마지막 줄 기준으로 반영('+dupNos.slice(0,3).join(', ')+(dupNos.length>3?' 외':'')+')':'';
      if(typeof syncOrderMapToDB==='function'){
        showToast('⏳ 수주맵 '+uniq+'건 서버 반영 중...','info');
        syncOrderMapToDB().then(function(res){
          if(typeof renderOrders==='function')renderOrders();
          res=res||{};
          /* 여기까지 와야 "갱신 완료"다. 예전에는 서버 저장 결과와 무관하게
             성공 토스트를 띄워, 배치가 통째로 실패해도 사용자는 반영된 줄 알았다. */
          var msg='✅ 수주맵 '+uniq+'건 반영 완료 (신규 '+(res.inserted||0)+' · 갱신 '+(res.updated||0)+')';
          if(res.skipped)msg+=' · 건너뜀 '+res.skipped;
          showToast(msg+dupMsg,'success');
        }).catch(function(err){
          console.error('[수주맵] 서버 반영 실패:',err);
          var m=(err&&err.data&&err.data.message)||(err&&err.message)||'서버 오류';
          showToast('❌ 화면에는 '+uniq+'건 반영됐지만 서버 저장에 실패했습니다: '+m,'error');
        });
      }else{
        showToast('✅ 수주맵 '+uniq+'건 불러오기 완료'+dupMsg,'success');
      }
    }catch(err){
      console.error('수주맵 엑셀 파싱 실패:',err);
      showToast('⚠️ '+err.message,'error');
    }
  };
  reader.readAsArrayBuffer(file);
  input.value='';
}
function exportOrderExcel(){
  var details=getAllOrderDetails();
  var keys=Object.keys(details).sort();
  if(keys.length===0){
    showToast('저장할 수주맵이 없습니다','info');
    return;
  }
  var data=[ORDER_FIELDS.slice()];
  keys.forEach(function(k){
    var d=details[k];
    data.push([k,d.date||'',d.client||'',d.name||'',d.amount||'',d.manager||'',d.delivery||'']);
  });
  var ws=XLSX.utils.aoa_to_sheet(data);
  ws['!cols']=[{wch:14},{wch:12},{wch:18},{wch:28},{wch:14},{wch:10},{wch:12}];
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'수주맵');
  XLSX.writeFile(wb,'수주맵_'+localDate()+'.xlsx');
  showToast('📤 수주맵 '+keys.length+'건 저장 완료','success');
}

function upOP(){
  const wrap=document.getElementById('orderDetailWrap');
  const pList=document.getElementById('orderPersonList');
  const cList=document.getElementById('orderCommentList');
  if(sO.size===0){wrap.classList.add('hidden');return}
  wrap.classList.remove('hidden');

  // 관련 인원
  const base=aD.filter(r=>sO.has(r.orderNo));
  const pm={};
  base.forEach(r=>{
    if(!pm[r.name])pm[r.name]={hours:0,orders:new Set(),abbrs:new Set()};
    pm[r.name].hours+=r.hours;
    pm[r.name].orders.add(r.orderNo);
    pm[r.name].abbrs.add(r.abbr);
  });
  const sorted=Object.entries(pm).sort(([,a],[,b])=>b.hours-a.hours);
  pList.innerHTML=sorted.map(([name,info])=>{
    const ni=aN.indexOf(name);
    const c=COL[ni%COL.length];
    const abbrTags=[...info.abbrs].map(a=>`<span class="badge" style="background:${ABG[a]||'#1A1F35'};color:${AFG[a]||'#94A3B8'};font-size:8px;padding:1px 5px">${a}</span>`).join(' ');
    const orderCnt=info.orders.size;
    return `<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--bg-p);border:1px solid var(--bd);border-radius:6px">
      <span style="width:6px;height:6px;border-radius:50%;background:${c};flex-shrink:0"></span>
      <span style="font-size:11px;font-weight:600;color:var(--t3)">${eH(name)}</span>
      <span class="mono" style="font-size:10px;color:var(--ac-t)">${Math.round(info.hours*10)/10}h</span>
      ${abbrTags}
      ${orderCnt>1?`<span style="font-size:9px;color:var(--t6)">${orderCnt}건</span>`:''}
    </div>`;
  }).join('');

  // 수주명 코멘트
  const orders=[...sO].sort();
  cList.innerHTML=orders.map(o=>{
    const saved=getOCmt(o);
    const client=getOClient(o);
    const eid=CSS.escape(o);
    return `<div style="display:flex;align-items:center;gap:6px">
      <span class="mono" style="font-size:11px;color:var(--ac-t);min-width:80px;font-weight:600">${eH(o)}</span>
      ${client?`<span style="font-size:10px;color:var(--t5);min-width:60px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${eH(client)}">${eH(client)}</span>`:''}
      <input type="text" id="oc_${eid}" class="si" style="flex:1;padding:5px 8px;padding-left:8px;font-size:11px" placeholder="수주명 또는 메모 입력..." value="${eH(saved)}" onkeydown="if(event.key==='Enter')saveOCmt('${eA(o)}')">
      <button class="btn btn-w btn-s" onclick="saveOCmt('${eA(o)}')" style="padding:3px 8px;font-size:9px">💾</button>
      <span id="ocfb_${eid}" style="font-size:11px;min-width:16px"></span>
    </div>`;
  }).join('');
}
