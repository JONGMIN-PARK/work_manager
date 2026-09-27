/* archive-trend.js — AI 요약 · 주차 저장 · 아카이브 · 트렌드
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ AI ═══ */
var _aiConfigured=false;var _aiProvider='';
function initAk(){checkAiStatus()}
async function checkAiStatus(){
  var iconEl=document.getElementById('aiStatusIcon');var textEl=document.getElementById('aiStatusText');
  if(!iconEl||!textEl)return;
  if(AUTH_SKIP){iconEl.textContent='⚙️';textEl.textContent='로컬 모드 — 로컬 분석만 가능';return}
  try{
    var d=await apiFetch('/api/ai/status');
    if(d&&d.data&&d.data.configured){
      _aiConfigured=true;_aiProvider=d.data.provider;
      iconEl.textContent='✅';
      // v13.71: 모델·키 출처도 함께 노출 (진단 용이)
      var detail=' · 모델 <code style="font-size:10px;color:var(--ac-t);background:var(--ac-bg);padding:1px 5px;border-radius:3px">'+
        eH(d.data.model||'?')+'</code>';
      if(d.data.keySource==='tenant')detail+=' · <span style="color:var(--t5);font-size:10px">테넌트 키</span>';
      var quotaH=d.data.quota&&d.data.quota.limit?(' · '+d.data.quota.used+'/'+d.data.quota.limit+'회'):'';
      textEl.innerHTML='<b>'+d.data.provider+'</b> 연결됨'+detail+quotaH;
    }else{
      iconEl.textContent='⚠️';
      var h=(d&&d.data&&d.data.hint)?d.data.hint:'환경변수 설정 + 재시작 필요';
      textEl.innerHTML='AI 미설정 — <span style="color:var(--t5);font-size:10px">'+eH(h)+'</span>';
    }
  }
  catch(e){iconEl.textContent='⚠️';textEl.textContent='AI 상태 확인 실패 — 로컬 분석 사용'}
}
function gAk(){return _aiConfigured?'server':''}
function addPre(t){const ta=document.getElementById('sumCmt');ta.value=ta.value?(ta.value.trim()+'\n'+t):t;upCmCnt()}
function upCmCnt(){const l=document.getElementById('sumCmt').value.length;document.getElementById('cmCnt').textContent=l>0?l+'자':''}

function buildPmt(f,extra){
  const ns=[...new Set(f.map(r=>r.name))];const tH=Math.round(f.reduce((s,r)=>s+r.hours,0)*10)/10;const ds=[...new Set(f.map(r=>r.date))].sort();
  // 수주명 매핑 생성
  const orderSet=[...new Set(f.map(r=>r.orderNo))].sort();
  const ocMap=orderSet.map(o=>{const c=getOCmt(o);return c?`${o} = ${c}`:null}).filter(Boolean);
  const ocBlock=ocMap.length?`\n\n[수주번호-프로젝트명 매핑]\n${ocMap.join('\n')}`:'';
  const pp={};f.forEach(r=>{if(!pp[r.name])pp[r.name]={h:0,t:{}};pp[r.name].h+=r.hours;if(!pp[r.name].t[r.abbr])pp[r.name].t[r.abbr]=[];pp[r.name].t[r.abbr].push(r.content)});
  let dt=`기간: ${fD(ds[0])} ~ ${fD(ds[ds.length-1])}\n총 ${f.length}건, ${tH}시간, ${ns.length}명\n\n`;
  for(const[n,i]of Object.entries(pp)){dt+=`[${n}] ${Math.round(i.h*10)/10}h\n`;for(const[a,c]of Object.entries(i.t)){const u=[...new Set(c)];dt+=`  ${AM[a]||a}: ${u.slice(0,8).join(' / ')}\n`}}
  if(dt.length>3500)dt=dt.slice(0,3500)+'...(생략)';
  const cmt=(extra||(document.getElementById('sumCmt')?document.getElementById('sumCmt').value:'')||'').trim();
  const cb=cmt?`\n\n[팀장 추가 지시사항]\n${cmt}`:'';
  return `당신은 장비 제조회사의 SW팀 업무일지를 분석하는 전문가입니다.\n\n${dt}\n약자: A=CS현장,B=제작,D=개발,G=일반,M=관리,S=영업지원${ocBlock}${cb}\n\n다음 형식으로 한국어 분석:\n## 📋 업무 요약\n- 인원별 핵심 업무 2~3줄 (수주명이 있으면 프로젝트명으로 표기)\n## 📊 업무 분장 분석\n## 💡 인사이트\n- 팀장 관점 3~5개 (프로젝트별 리소스 배분 포함)\n## ⚠️ 주의사항\n\n추가 지시사항이 있으면 별도 섹션으로 상세 분석.`}

async function callAI(prompt){
  if(!_aiConfigured){return null}
  // v13.72: AI 호출은 120초 타임아웃 (Claude opus-4-7 + 긴 프롬프트 대응)
  const d=await apiFetch('/api/ai/summary',{method:'POST',body:JSON.stringify({prompt:prompt}),timeoutMs:120000});
  if(d&&d.data&&d.data.text)return d.data.text;
  return null;
}

async function reqSum(){
  const f=gF();if(!f.length){showToast('데이터 없음','warn');return}
  const el=document.getElementById('sumOut'),btn=document.getElementById('sumBtn');
  if(!_aiConfigured){el.innerHTML=`<div style="padding:4px"><div style="padding:8px 12px;background:var(--tg);border:1px solid var(--tg-bd);border-radius:7px;margin-bottom:12px;font-size:11px;color:var(--tg-t)">ℹ️ 서버 AI 미설정 → 로컬 분석</div>${genLocal(f)}</div>`;el.dataset.generated='1';return}
  const pl=_aiProvider||'AI';
  btn.disabled=true;btn.textContent=pl+' 분석중...';
  el.innerHTML=`<div class="sld"><div class="sp"></div>${pl} 분석 중...</div>`;
  // v13.72: 화려한 진행 모달 (AI는 응답까지 길 수 있어 명확한 피드백)
  if(window.wmProgress){
    wmProgress.show({icon:'🤖',title:pl+' AI 분석 중',sub:'주간 업무 데이터를 분석해 요약·인사이트를 작성합니다.',tip:'평균 10~30초 소요 · 모델: '+(document.getElementById('aiStatusText')?.innerText.match(/\[([^\]]+)\]/)?.[1] || 'claude-opus-4-7')});
    wmProgress.autoSteps(['📝 업무 분장 집계','👥 인원별 패턴 분석','🎯 프로젝트별 리소스 배분','💡 인사이트 도출','✅ 결과 정리'],3000);
  }
  try{
    const txt=await callAI(buildPmt(f));if(!txt)throw new Error('응답 없음');
    el.innerHTML=`<div style="font-size:10px;color:var(--t6);margin-bottom:6px">✨ ${pl} 응답</div>`+rMD(txt);
    if(window.wmProgress)wmProgress.hide();
  }
  catch(err){
    if(window.wmProgress)wmProgress.hide();
    var msg=err.message||'알 수 없는 오류';
    var errData=err.data||{};
    var actionHtml='';
    // v13.73: 크레딧 부족 친화 안내
    if(errData.error==='CREDIT_LOW' || /credit balance|insufficient.*credit/i.test(msg)){
      var url=(errData.action&&errData.action.url)||'https://console.anthropic.com/settings/plans';
      msg='💳 Anthropic API 크레딧이 부족합니다.';
      actionHtml=`<div style="margin-top:8px;padding:10px 12px;background:var(--bg-i);border-radius:6px;font-size:11px;color:var(--t3);line-height:1.7">
        <div style="font-weight:600;margin-bottom:6px">해결 방법 중 하나:</div>
        <div>① <a href="${eH(url)}" target="_blank" style="color:var(--ac-t);text-decoration:underline">Anthropic Console → Plans &amp; Billing</a>에서 크레딧 충전</div>
        <div>② 서버에 <code style="background:var(--bg-p);padding:1px 5px;border-radius:3px;font-size:10px">GEMINI_API_KEY</code>를 설정하면 자동 폴백 (무료)</div>
        <div>③ 환경변수 <code style="background:var(--bg-p);padding:1px 5px;border-radius:3px;font-size:10px">AI_PROVIDER=gemini</code> 로 전환</div>
      </div>`;
    }
    else if(errData.error==='AI_OVERLOADED' || /overloaded|high demand|unavailable/i.test(msg)){
      msg='🌐 AI 모델이 현재 과부하 상태입니다. 1~2분 후 다시 시도하세요. (서버에서 3회 자동 재시도 + 폴백 모델까지 시도했습니다)';
      actionHtml=`<div style="margin-top:8px;padding:10px 12px;background:var(--bg-i);border-radius:6px;font-size:11px;color:var(--t3);line-height:1.7">
        <div style="font-weight:600;margin-bottom:6px">대안:</div>
        <div>① 잠시 후 [요약 생성] 다시 클릭 — 과부하는 보통 1~2분 내 해소</div>
        <div>② 환경변수 <code style="background:var(--bg-p);padding:1px 5px;border-radius:3px;font-size:10px">GEMINI_FALLBACK_MODEL</code>에 다른 모델 지정 (기본: gemini-2.0-flash)</div>
        <div>③ 일단 아래 <b>로컬 분석 결과</b> 활용</div>
      </div>`;
    }
    else if(/aborted|timeout|signal/i.test(msg))msg='⏱️ 응답 타임아웃 — 모델이 응답에 시간이 더 필요합니다. 데이터를 줄이거나 다시 시도하세요.';
    el.innerHTML=`<div style="padding:4px"><div style="padding:10px 14px;background:var(--d-bg);border:1px solid var(--d-bd);border-radius:7px;margin-bottom:12px"><p style="font-weight:600;color:var(--d-t);font-size:12px">⚠️ ${pl} 실패</p><p style="font-size:11px;color:var(--t3);margin-top:4px">${eH(msg)}</p>${actionHtml}</div>${genLocal(f)}</div>`;
  }
  btn.disabled=false;btn.textContent='요약 생성';
  el.dataset.generated='1';
}

function genLocal(f){const ns=[...new Set(f.map(r=>r.name))];const tH=Math.round(f.reduce((s,r)=>s+r.hours,0)*10)/10;const pp={};f.forEach(r=>{if(!pp[r.name])pp[r.name]={h:0,a:{},c:[]};pp[r.name].h+=r.hours;pp[r.name].a[r.abbr]=(pp[r.name].a[r.abbr]||0)+r.hours;pp[r.name].c.push(r.content)});const td={};f.forEach(r=>{td[r.abbr]=(td[r.abbr]||0)+r.hours});let html='<div style="color:var(--t3)">';html+='<h4 style="color:var(--t1);font-size:13px;margin-bottom:8px">📋 인원별 요약</h4>';for(const[n,i]of Object.entries(pp).sort(([,a],[,b])=>b.h-a.h)){const ta=Object.entries(i.a).sort(([,a],[,b])=>b-a)[0];const uc=[...new Set(i.c)];html+=`<div style="margin-bottom:10px;padding:8px;background:var(--bg-i);border-radius:7px"><div style="font-weight:600;color:var(--t1);font-size:12px;margin-bottom:3px">${eH(n)} — ${Math.round(i.h*10)/10}h (주력: ${AM[ta[0]]||ta[0]})</div><div style="font-size:11px;color:var(--t4)">${uc.slice(0,5).map(c=>eH(c)).join(' · ')}</div></div>`}html+='<h4 style="color:var(--t1);font-size:13px;margin:14px 0 8px">📊 분장 분포</h4>';for(const[a,h]of Object.entries(td).sort(([,a],[,b])=>b-a)){const p=Math.round(h/tH*1000)/10;html+=`<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px"><span class="badge" style="background:${ABG[a]||'#1A1F35'};color:${AFG[a]||'#94A3B8'}">${a}</span><span style="font-size:11px">${AM[a]||a}</span><div style="flex:1;height:5px;background:var(--pt);border-radius:3px"><div style="width:${p}%;height:100%;background:${ABR[a]||'#64748B'};border-radius:3px"></div></div><span class="mono" style="color:var(--t4);font-size:10px">${Math.round(h*10)/10}h(${p}%)</span></div>`}html+='<h4 style="color:var(--t1);font-size:13px;margin:14px 0 8px">⚠️ 감지</h4>';const w=[];for(const[n,i]of Object.entries(pp)){const ds=[...new Set(f.filter(r=>r.name===n).map(r=>r.date))];const avg=i.h/ds.length;if(avg>9)w.push(`${n}: 일평균 ${Math.round(avg*10)/10}h — 과부하`)}const bR=(td['B']||0)/tH;if(bR>0.6)w.push(`제작(B) ${Math.round(bR*100)}% — 편중`);if(!w.length)w.push('이상 없음');w.forEach(x=>{html+=`<div style="font-size:11px;padding:5px 8px;background:var(--d-bg);border-radius:5px;margin-bottom:3px;color:var(--d-t)">⚡ ${eH(x)}</div>`});html+='</div>';return html}
function rMD(t){return t.replace(/^## (.*$)/gm,'<h4 style="color:var(--t1);font-size:14px;margin:16px 0 8px;font-weight:700">$1</h4>').replace(/^### (.*$)/gm,'<h5 style="color:var(--t4);font-size:12px;margin:10px 0 5px;font-weight:600">$1</h5>').replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--t1)">$1</strong>').replace(/^- (.*$)/gm,'<div style="padding:3px 0 3px 14px;position:relative"><span style="position:absolute;left:3px;color:var(--ac)">•</span>$1</div>').replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>')}

/* ═══ SAVE WEEK ═══ */
async function saveWeek(){
  if(!aD.length){showToast('데이터 없음','warn');return}
  // 선택된 인원의 전체 데이터를 아카이브에 저장
  if(!sN.size){showToast('선택된 인원이 없습니다. 먼저 팀원을 선택해주세요.','warn');return}
  const selNames=[...sN];
  const selData=aD.filter(r=>sN.has(r.name));
  if(!selData.length){showToast('선택 인원의 데이터가 없습니다.','warn');return}
  const label=document.getElementById('weekLabel').value.trim()||'unnamed';
  const id=label.replace(/[^a-zA-Z0-9가-힣_-]/g,'_')+'_'+Date.now();
  const sumHtml=document.getElementById('sumOut').innerHTML;
  const comment=(document.getElementById('sumCmt')||{}).value||'';
  const includeRaw=document.getElementById('saveRawTog').checked;
  const selTotalH=Math.round(selData.reduce((s,r)=>s+r.hours,0)*10)/10;
  const selAbbrDist=(()=>{const m={};selData.forEach(r=>{m[r.abbr]=(m[r.abbr]||0)+r.hours});return m})();
  // 저장 시점의 별칭 스냅샷
  const aliasSnapshot={};
  selNames.forEach(n=>{const a=typeof getAlias==='function'?getAlias(n):null;if(a)aliasSnapshot[n]=a});
  // 활성 그룹명
  const curGroup=(typeof activeGroupId!=='undefined'&&activeGroupId&&typeof getGroup==='function')?getGroup(activeGroupId):null;
  const record={
    id, label,
    groupName: curGroup?curGroup.name:'',
    groupColor: curGroup?curGroup.color:'',
    savedAt: new Date().toISOString(),
    fileName: document.getElementById('fnDisp').textContent||'',
    encoding: cEnc,
    data: selData,
    rawBuffer: includeRaw&&lBuf?lBuf:null,
    selectedNames: selNames,
    aliases: aliasSnapshot,
    selectedOrders: [...sO],
    selectedTasks: [...sT],
    contentKeyword: cKw,
    aiComment: comment,
    aiReport: sumHtml,
    totalRows: selData.length,
    filteredRows: selData.length,
    totalHours: selTotalH,
    dateRange: (()=>{const ds=[...new Set(selData.map(r=>r.date))].sort();return ds.length?[ds[0],ds[ds.length-1]]:[]})(),
    abbrDist: selAbbrDist
  };
  await wkPut(record);invalidateArchiveCache();
  const sizeInfo=includeRaw&&lBuf?` (원본 ${Math.round(lBuf.byteLength/1024)}KB 포함)`:'';
  showToast(`✅ "${label}" 저장 완료! 선택 ${selNames.length}명 · ${selData.length}건 · ${selTotalH}h${sizeInfo}`);
}

/* ═══ ARCHIVE ═══ */
async function renderArch(){
  const all=await wkGetAll();
  const list=all.sort((a,b)=>(b.savedAt||'').localeCompare(a.savedAt||''));
  document.getElementById('archEmpty').classList.toggle('hidden',list.length>0);
  document.getElementById('archDetail').classList.add('hidden');
  document.getElementById('archList').innerHTML=list.map(w=>{
    const dr=w.dateRange||[];
    const gn=w.groupName?`<span style="font-size:9px;padding:1px 6px;border-radius:3px;background:${w.groupColor||'var(--ac-bg)'};color:${w.groupColor?'#fff':'var(--ac-t)'};margin-left:6px">👥 ${eH(w.groupName)}</span>`:'';
    return`<div class="wk" onclick="showArchDetail('${eA(w.id)}')">
      <div class="wk-t">📅 ${eH(w.label)}${gn}</div>
      <div class="wk-s">${w.fileName||'?'} · ${w.totalRows||0}건 · ${w.totalHours||0}h</div>
      <div class="wk-m">${dr.length?fD(dr[0])+' ~ '+fD(dr[1]):''}<span style="margin-left:auto;font-size:9px">${w.savedAt?new Date(w.savedAt).toLocaleDateString('ko'):''}</span></div>
    </div>`}).join('')}
async function showArchDetail(id){
  archSel=id;const w=await wkGet(id);if(!w)return;
  document.getElementById('archDetail').classList.remove('hidden');
  document.getElementById('archTitle').textContent='📅 '+w.label;
  const dr=w.dateRange||[];
  const hasRaw=!!w.rawBuffer;
  let info=`<b>파일:</b> ${eH(w.fileName||'?')} · <b>인코딩:</b> ${w.encoding||'?'}`;
  info+=hasRaw?' · <span style="color:var(--ac-t)">📦 원본 포함 ('+Math.round(w.rawBuffer.byteLength/1024)+'KB)</span>':' · <span style="color:var(--t6)">원본 미포함</span>';
  info+=`<br><b>기간:</b> ${dr.length?fD(dr[0])+' ~ '+fD(dr[1]):'-'} · <b>전체:</b> ${w.totalRows}건 · <b>필터:</b> ${w.filteredRows}건 · <b>시간:</b> ${w.totalHours}h<br>`;
  if(w.groupName)info+=`<b>그룹:</b> <span style="padding:1px 8px;border-radius:3px;background:${w.groupColor||'var(--ac-bg)'};color:${w.groupColor?'#fff':'var(--ac-t)'}">👥 ${eH(w.groupName)}</span><br>`;
  const nameDisp=(w.selectedNames||[]).map(n=>{const a=(w.aliases||{})[n]||((typeof getAlias==='function')?getAlias(n):null);return a?`${a}(${n})`:n}).join(', ');
  info+=`<b>선택 팀원:</b> ${nameDisp||'-'}<br>`;
  if(w.aiComment)info+=`<b>추가 지시:</b> ${eH(w.aiComment)}<br>`;
  document.getElementById('archInfo').innerHTML=info;

  // 인원별 요약 + 분장 분포 생성
  let sumHtml='';
  if(w.data&&w.data.length){
    const selNames=new Set(w.selectedNames||[]);
    const filtered=selNames.size?w.data.filter(r=>selNames.has(r.name)):w.data;
    const totalH=Math.round(filtered.reduce((s,r)=>s+r.hours,0)*10)/10;

    // 전체 분장 분포
    const abbrDist={};filtered.forEach(r=>{abbrDist[r.abbr]=(abbrDist[r.abbr]||0)+r.hours});
    if(Object.keys(abbrDist).length){
      sumHtml+='<div style="margin-bottom:14px"><h4 style="font-size:12px;font-weight:600;color:var(--t4);margin-bottom:8px">📊 전체 업무 분장 분포</h4>';
      Object.entries(abbrDist).sort(([,a],[,b])=>b-a).forEach(([a,h])=>{
        const p=totalH>0?Math.round(h/totalH*1000)/10:0;
        sumHtml+=`<div style="display:flex;align-items:center;gap:7px;margin-bottom:4px"><span class="badge" style="background:${ABG[a]||'#1A1F35'};color:${AFG[a]||'#94A3B8'}">${a}</span><span style="font-size:11px;color:var(--t3);width:80px">${AM[a]||a}</span><div style="flex:1;height:6px;background:var(--pt);border-radius:3px"><div style="width:${p}%;height:100%;background:${ABR[a]||'#64748B'};border-radius:3px"></div></div><span class="mono" style="font-size:10px;color:var(--t4);width:70px;text-align:right">${Math.round(h*10)/10}h (${p}%)</span></div>`;
      });
      sumHtml+='</div>';
    }

    // 인원별 요약
    const byPerson={};
    filtered.forEach(r=>{
      if(!byPerson[r.name])byPerson[r.name]={h:0,byAbbr:{},byOrder:{},contents:[]};
      byPerson[r.name].h+=r.hours;
      byPerson[r.name].byAbbr[r.abbr]=(byPerson[r.name].byAbbr[r.abbr]||0)+r.hours;
      if(!byPerson[r.name].byOrder[r.orderNo])byPerson[r.name].byOrder[r.orderNo]={h:0,items:[]};
      byPerson[r.name].byOrder[r.orderNo].h+=r.hours;
      byPerson[r.name].byOrder[r.orderNo].items.push(r.content);
      byPerson[r.name].contents.push(r.content);
    });

    sumHtml+='<h4 style="font-size:12px;font-weight:600;color:var(--t4);margin-bottom:8px">👤 인원별 요약</h4>';
    Object.entries(byPerson).sort(([,a],[,b])=>b.h-a.h).forEach(([name,pi])=>{
      const abbrSorted=Object.entries(pi.byAbbr).sort(([,a],[,b])=>b-a);
      const topA=abbrSorted[0];
      const topRatio=topA?Math.round(topA[1]/pi.h*100):0;
      const abbrCount=abbrSorted.length;
      const orderCount=Object.keys(pi.byOrder).filter(o=>/[A-Za-z]/.test(o)&&/\d/.test(o)).length;

      // 분산도
      let spreadLv;
      if(abbrCount>=4)spreadLv='높음';
      else if(abbrCount>=2){spreadLv=topRatio>70?'편중':'보통'}
      else spreadLv='단일집중';

      // 주요 수주
      const topOrders=Object.entries(pi.byOrder).sort(([,a],[,b])=>b.h-a.h).slice(0,3);
      const orderStr=topOrders.map(([o,oi])=>{const nm=getOCmt(o);return(nm||o)+' '+Math.round(oi.h*10)/10+'h'}).join(', ');

      // 분장 바
      const abbrBar=abbrSorted.map(([a,h])=>`<div style="width:${h/pi.h*100}%;background:${ABR[a]||'#64748B'}" title="${AM[a]||a}: ${Math.round(h*10)/10}h"></div>`).join('');

      sumHtml+=`<div style="margin-bottom:10px;padding:10px;background:var(--bg-i);border-radius:7px;border-left:3px solid var(--ac)">`;
      sumHtml+=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:12px;font-weight:700;color:var(--t1)">${eH(name)}</span><span style="font-size:11px;color:var(--t4)">${Math.round(pi.h*10)/10}h</span></div>`;
      sumHtml+=`<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--pt);margin-bottom:6px">${abbrBar}</div>`;
      sumHtml+=`<div style="font-size:10px;color:var(--t3);line-height:1.7">`;
      sumHtml+=`🎯 주력: <b>${topA?AM[topA[0]]||topA[0]:'-'}</b> (${topRatio}%) · 분산: <b>${spreadLv}</b> (${abbrCount}분장, ${orderCount}수주)<br>`;
      sumHtml+=`📦 ${orderStr}`;
      sumHtml+=`</div></div>`;
    });
  }

  document.getElementById('archReport').innerHTML=sumHtml+(w.aiReport?'<h4 style="font-size:12px;font-weight:600;color:var(--t4);margin:16px 0 8px">🤖 AI 리포트</h4>'+w.aiReport:'<div style="color:var(--t6);font-size:11px;margin-top:12px">AI 리포트 없음</div>');
  // 재파싱 버튼 표시
  document.getElementById('archReparse').classList.toggle('hidden',!hasRaw);
  document.getElementById('archReparseArea').classList.add('hidden');
  archReparseEnc=w.encoding||'euc-kr';
}
let archReparseEnc='euc-kr';
function archReparse(){
  const area=document.getElementById('archReparseArea');
  area.classList.toggle('hidden');
  document.getElementById('archEncChips').innerHTML=ENC.map(e=>`<span class="chip ${e===archReparseEnc?'cn':'co'}" style="padding:3px 8px;font-size:10px;cursor:pointer" onclick="archReparseEnc='${e}';archReparse()">${e}</span>`).join('');
}
async function doReparse(){
  if(!archSel)return;const w=await wkGet(archSel);
  if(!w||!w.rawBuffer){showToast('원본 파일이 없습니다.','error');return}
  let text;try{text=new TextDecoder(archReparseEnc,{fatal:false}).decode(w.rawBuffer)}catch{text=new TextDecoder('utf-8',{fatal:false}).decode(w.rawBuffer)}
  const newData=pH(text);
  w.data=newData;w.encoding=archReparseEnc;w.totalRows=newData.length;
  const ds=[...new Set(newData.map(r=>r.date))].sort();
  w.dateRange=ds.length?[ds[0],ds[ds.length-1]]:[];
  await wkPut(w);invalidateArchiveCache();
  showToast(`✅ ${archReparseEnc} 인코딩으로 재파싱 완료! (${newData.length}건)`);
  showArchDetail(archSel);
}
async function archLoad(){if(!archSel)return;const w=await wkGet(archSel);if(!w||!w.data)return;aD=w.data;aN=[...new Set(aD.map(r=>r.name))].sort();vN=[...aN];sN=new Set(w.selectedNames||[]);sO=new Set(w.selectedOrders||[]);sT=new Set(w.selectedTasks||[]);cKw=w.contentKeyword||'';document.getElementById('cSearch').value=cKw;document.getElementById('weekLabel').value=w.label||'';document.getElementById('fnDisp').textContent=w.fileName||'';document.getElementById('rcDisp').textContent=aD.length;document.getElementById('fileInfo').classList.remove('hidden');document.getElementById('uploadZone').classList.add('hidden');document.getElementById('mainArea').classList.remove('hidden');if(w.rawBuffer)lBuf=w.rawBuffer;if(w.encoding)cEnc=w.encoding;rEC();if(w.aiComment&&document.getElementById('sumCmt'))document.getElementById('sumCmt').value=w.aiComment;if(w.aiReport)document.getElementById('sumOut').innerHTML=w.aiReport;rNC();rFL();upV();setMode('weekly')}
async function archDel(){if(!archSel)return;if(!confirm('이 주차를 삭제하시겠습니까?'))return;await wkDel(archSel);invalidateArchiveCache();archSel=null;renderArch()}
async function clearAllWeeks(){if(!confirm('저장된 모든 주차를 삭제하시겠습니까?'))return;await wkClear();invalidateArchiveCache();renderArch()}

/* ═══ TREND ═══ */
var trendGroupFilter=''; // 그룹명 필터 (빈 문자열=전체)
var trendAllWeeks=[]; // 캐시
async function renderTrend(){
  const all=await wkGetAll();trendAllWeeks=all.sort((a,b)=>(a.label||'').localeCompare(b.label||''));
  // 그룹명 목록 추출
  const groups=[...new Set(trendAllWeeks.map(w=>w.groupName||'').filter(Boolean))];
  const gfEl=document.getElementById('trendGroupFilter');
  if(groups.length>0){
    const allActive=!trendGroupFilter;
    gfEl.innerHTML=`<button class="btn ${allActive?'btn-p':'btn-g'} btn-s" onclick="trendFilterGroup('')">📋 전체</button>`+
      groups.map(g=>{
        const w0=trendAllWeeks.find(w=>w.groupName===g);
        const gc=w0&&w0.groupColor?w0.groupColor:'var(--ac)';
        const active=trendGroupFilter===g;
        return`<button class="btn ${active?'btn-p':'btn-g'} btn-s" style="border-left:3px solid ${gc}" onclick="trendFilterGroup('${eA(g)}')">👥 ${eH(g)}</button>`;
      }).join('');
  }else{gfEl.innerHTML=''}
  // 필터 적용
  const filtered=trendGroupFilter?trendAllWeeks.filter(w=>(w.groupName||'')===trendGroupFilter):trendAllWeeks;
  document.getElementById('trendEmpty').classList.toggle('hidden',filtered.length>0);
  document.getElementById('trendResult').classList.add('hidden');
  document.getElementById('trendList').innerHTML=filtered.map(w=>{
    const sel=trendSel.has(w.id);
    const gn=w.groupName?`<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:${w.groupColor||'var(--ac-bg)'};color:${w.groupColor?'#fff':'var(--ac-t)'};margin-left:4px">👥 ${eH(w.groupName)}</span>`:'';
    const dr=w.dateRange||[];
    const dateStr=dr.length?fD(dr[0]).slice(5)+' ~ '+fD(dr[1]).slice(5):'';
    return`<div class="wk ${sel?'sel':''}" onclick="togTrend('${eA(w.id)}')">
      <div class="wk-t">${sel?'☑️':'☐'} ${eH(w.label)}${gn}</div>
      <div class="wk-s">${w.totalRows||0}건 · ${w.totalHours||0}h</div>
      <div class="wk-m">${dateStr}</div>
    </div>`}).join('')}
function togTrend(id){trendSel.has(id)?trendSel.delete(id):trendSel.add(id);renderTrend()}
function trendFilterGroup(g){trendGroupFilter=g;renderTrend()}
function trendSelAll(){
  const filtered=trendGroupFilter?trendAllWeeks.filter(w=>(w.groupName||'')===trendGroupFilter):trendAllWeeks;
  filtered.forEach(w=>trendSel.add(w.id));renderTrend()
}
function trendDeAll(){
  if(trendGroupFilter){
    const filtered=trendAllWeeks.filter(w=>(w.groupName||'')===trendGroupFilter);
    filtered.forEach(w=>trendSel.delete(w.id));
  }else{trendSel.clear()}
  renderTrend()
}

let tPC=null; // person trend chart
async function runTrend(){
  if(trendSel.size<1){showToast('1개 이상의 주차를 선택하세요.','warn');return}
  const weeks=[];for(const id of trendSel){const w=await wkGet(id);if(w)weeks.push(w)}
  weeks.sort((a,b)=>(a.label||'').localeCompare(b.label||''));
  document.getElementById('trendResult').classList.remove('hidden');
  // Aggregate stats
  let totalRows=0,totalHours=0;const abbrAll={};const weekLabels=[],weekHours=[],weekByAbbr={};
  weeks.forEach(w=>{totalRows+=w.totalRows||0;totalHours+=w.totalHours||0;weekLabels.push(w.label);weekHours.push(w.totalHours||0);for(const[a,h]of Object.entries(w.abbrDist||{})){abbrAll[a]=(abbrAll[a]||0)+h;if(!weekByAbbr[a])weekByAbbr[a]=[];weekByAbbr[a].push(h)}});
  const trendGroups=[...new Set(weeks.map(w=>w.groupName||'').filter(Boolean))];
  const trendPersonCount=new Set();weeks.forEach(w=>{if(w.data)w.data.forEach(r=>trendPersonCount.add(r.name))});
  const groupLabel=trendGroups.length?trendGroups.map(g=>`<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:var(--ac-bg);color:var(--ac-t)">👥 ${eH(g)}</span>`).join(' '):'';
  document.getElementById('trendStats').innerHTML=`
    <div class="sc"><div class="sl">선택 주차</div><div class="sv">${weeks.length}</div></div>
    <div class="sc"><div class="sl">총 데이터</div><div class="sv">${totalRows}건</div></div>
    <div class="sc"><div class="sl">누적 시간</div><div class="sv bl">${Math.round(totalHours*10)/10}h</div></div>
    <div class="sc"><div class="sl">주평균</div><div class="sv gr">${Math.round(totalHours/weeks.length*10)/10}h</div></div>
    <div class="sc"><div class="sl">참여 인원</div><div class="sv">${trendPersonCount.size}명</div></div>
    ${groupLabel?`<div class="sc"><div class="sl">그룹</div><div style="margin-top:4px">${groupLabel}</div></div>`:''}`;
  // Abbr stacked bar chart
  const tc=gTC();const abbrKeys=Object.keys(abbrAll).sort();
  if(tC)tC.destroy();
  tC=new Chart(document.getElementById('trendChart').getContext('2d'),{type:'bar',data:{labels:weekLabels,datasets:abbrKeys.map(k=>{const data=weeks.map(w=>(w.abbrDist||{})[k]||0);return{label:AM[k]||k,data,backgroundColor:ABR[k]||'#64748B',borderRadius:3,borderSkipped:'bottom'}})},options:{responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true,ticks:{color:tc.t,font:{size:10}},grid:{color:tc.g}},y:{stacked:true,ticks:{color:tc.t,font:{size:10},callback:v=>v+'h'},grid:{color:tc.g}}},plugins:{legend:{labels:{color:tc.l,font:{size:10}}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+'h'}}}}});

  // Person line chart
  const personWeek={};
  weeks.forEach(w=>{if(w.data)w.data.forEach(r=>{if(!personWeek[r.name])personWeek[r.name]={};personWeek[r.name][w.label]=(personWeek[r.name][w.label]||0)+r.hours})});
  const personNames=Object.keys(personWeek).sort((a,b)=>a.localeCompare(b,'ko'));
  if(tPC)tPC.destroy();
  tPC=new Chart(document.getElementById('trendPersonChart').getContext('2d'),{
    type:'line',
    data:{labels:weekLabels,datasets:personNames.map((name,i)=>({
      label:typeof shortName==='function'?shortName(name):name,
      data:weekLabels.map(wl=>Math.round((personWeek[name][wl]||0)*10)/10),
      borderColor:COL[i%COL.length],
      backgroundColor:COL[i%COL.length]+'33',
      borderWidth:2,
      pointRadius:4,
      pointHoverRadius:6,
      tension:0.3,
      fill:false
    }))},
    options:{responsive:true,maintainAspectRatio:false,
      scales:{x:{ticks:{color:tc.t,font:{size:10}},grid:{color:tc.g}},y:{ticks:{color:tc.t,font:{size:10},callback:v=>v+'h'},grid:{color:tc.g}}},
      plugins:{legend:{labels:{color:tc.l,font:{size:10},usePointStyle:true,pointStyle:'circle'}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+'h'}}}
    }
  });

  document.getElementById('trendAIOut').innerHTML='';

  // Integration 7: 트렌드에 프로젝트 컨텍스트 추가
  const dateRanges=weeks.map(w=>w.dateRange||[]);
  if(typeof renderTrendProjectContext==='function')renderTrendProjectContext(weekLabels,dateRanges);
}

/* ═══ Integration 7: 트렌드 프로젝트 컨텍스트 ═══ */
async function renderTrendProjectContext(weekLabels,dateRanges){
  const el=document.getElementById('trendProjectContext');
  if(!el)return;
  if(typeof projGetAll!=='function'||typeof msGetAll!=='function'){el.innerHTML='';return}
  try{
    const projects=await projGetAll();
    const milestones=await msGetAll();
    if(!projects.length&&!milestones.length){el.innerHTML='';return}

    // YYYYMMDD → YYYY-MM-DD
    function toISO(d){if(!d)return'';return d.length===8?d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8):d}

    let rows='';
    weekLabels.forEach(function(label,idx){
      const dr=dateRanges[idx]||[];
      if(!dr.length||!dr[0])return;
      const wStart=toISO(dr[0]);
      const wEnd=dr[1]?toISO(dr[1]):wStart;
      const events=[];

      // 해당 주간에 endDate가 포함되는 마일스톤 (완료된 것)
      milestones.forEach(function(m){
        if(!m.endDate)return;
        if(m.endDate>=wStart&&m.endDate<=wEnd){
          const proj=projects.find(function(p){return p.id===m.projectId});
          const st=(typeof PROJ_STATUS!=='undefined'&&PROJ_STATUS[m.status])?PROJ_STATUS[m.status]:{label:m.status||'?',icon:'',color:'#888'};
          events.push(st.icon+' '+m.name+(proj?' ['+proj.name+']':'')+' — '+st.label);
        }
      });

      // 프로젝트 시작/종료가 이 주간에 포함되는 경우
      projects.forEach(function(p){
        if(p.startDate>=wStart&&p.startDate<=wEnd){
          events.push('🔄 '+p.name+' 시작');
        }
        if(p.endDate>=wStart&&p.endDate<=wEnd){
          const st=typeof autoProjectStatus==='function'?autoProjectStatus(p):(p.status||'?');
          const stLabel=(typeof PROJ_STATUS!=='undefined'&&PROJ_STATUS[st])?PROJ_STATUS[st].label:st;
          events.push('🏁 '+p.name+' 종료 예정 ('+stLabel+')');
        }
      });

      if(events.length){
        rows+='<tr><td style="padding:4px 8px;font-size:11px;font-weight:600;color:var(--t2);white-space:nowrap;vertical-align:top;border-bottom:1px solid var(--bd)">'+eH(label)+'</td>';
        rows+='<td style="padding:4px 8px;font-size:11px;color:var(--t3);border-bottom:1px solid var(--bd)">'+events.map(function(e){return eH(e)}).join('<br>')+'</td></tr>';
      }
    });

    if(!rows){el.innerHTML='';return}

    el.innerHTML='<div style="padding:12px;background:var(--bg-i);border:1px solid var(--bd-i);border-radius:8px;margin-bottom:16px">'+
      '<h4 style="font-size:12px;font-weight:600;color:var(--t4);margin-bottom:8px">📋 프로젝트 이벤트</h4>'+
      '<table style="width:100%;border-collapse:collapse"><tbody>'+rows+'</tbody></table></div>';
  }catch(e){el.innerHTML=''}
}

async function trendAI(){
  const weeks=[];for(const id of trendSel){const w=await wkGet(id);if(w)weeks.push(w)}
  weeks.sort((a,b)=>(a.label||'').localeCompare(b.label||''));
  const el=document.getElementById('trendAIOut');
  if(!_aiConfigured){el.innerHTML=`<div style="padding:8px 12px;background:var(--tg);border:1px solid var(--tg-bd);border-radius:7px;font-size:11px;color:var(--tg-t)">ℹ️ 서버 AI가 설정되면 월간 AI 인사이트를 받을 수 있습니다.</div>`;return}
  el.innerHTML=`<div class="sld"><div class="sp"></div>${_aiProvider} 트렌드 분석 중...</div>`;
  // 주차별 요약 + 인원별 추이
  let summary='';
  const personWeekly={};
  weeks.forEach(w=>{
    summary+=`[${w.label}] ${w.totalRows}건, ${w.totalHours}h`;
    const ad=w.abbrDist||{};summary+=` (${Object.entries(ad).map(([a,h])=>`${a}:${Math.round(h*10)/10}h`).join(',')})\n`;
    // 인원별 시간 집계
    if(w.data){w.data.forEach(r=>{if(!personWeekly[r.name])personWeekly[r.name]={};if(!personWeekly[r.name][w.label])personWeekly[r.name][w.label]=0;personWeekly[r.name][w.label]+=r.hours})}
  });
  // 인원별 주차 추이 텍스트
  let personTrend='\n[인원별 주차 투입시간]\n';
  for(const[name,wks]of Object.entries(personWeekly).sort(([a],[b])=>a.localeCompare(b,'ko'))){
    const vals=weeks.map(w=>`${w.label}:${Math.round((wks[w.label]||0)*10)/10}h`).join(', ');
    personTrend+=`${name}: ${vals}\n`;
  }
  if(personTrend.length>1500)personTrend=personTrend.slice(0,1500)+'...(생략)';
  const prompt=`당신은 장비 제조회사 SW팀 업무일지 트렌드 분석 전문가입니다.\n\n아래는 복수 주차의 요약 데이터입니다:\n${summary}${personTrend}\n약자: A=CS현장,B=제작,D=개발,G=일반,M=관리,S=영업지원\n\n월간/연간 관점에서 한국어로 분석:\n## 📈 트렌드 요약\n- 주차별 업무량 변화 추이\n## 👤 인원별 추이 분석\n- 특정 인원의 연속 과부하, CS 고정 배치 등 패턴\n## 📊 업무 분장 변화\n- 시간 경과에 따른 분장 비율 변화\n## 💡 월간 인사이트\n- 리소스 효율성, 인력 운영 개선점 3~5개\n## 📋 월간 보고 핵심\n- 경영진/관리자에게 보고할 핵심 포인트\n## ⚠️ 리스크\n- 누적 트렌드에서 보이는 리스크`;
  try{const txt=await callAI(prompt);el.innerHTML=rMD(txt)}
  catch(err){el.innerHTML=`<div style="padding:8px;background:var(--d-bg);border-radius:7px;color:var(--d-t);font-size:11px">⚠️ ${eH(err.message)}</div>`}
}


