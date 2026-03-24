/* ═══ GLOBAL STATE ═══ */
let aD=[], aN=[], vN=[];
let sN=new Set(), sO=new Set(), sT=new Set(), sON=new Set(), sCL=new Set();
let cKw='', cEnc='euc-kr', lBuf=null;
let selWeek=null;
let _gfCache=null, _gfDirty=true;
let _tmpOcmt={}, _tmpOclient={};

/* ═══ CONSTANTS (Fallbacks) ═══ */
if(typeof ENC==='undefined') var ENC=['euc-kr','utf-8','cp949','shift_jis','iso-8859-1'];
if(typeof COL==='undefined') var COL=['#3B82F6','#EF4444','#10B981','#F59E0B','#8B5CF6','#EC4899','#06B6D4','#F97316','#6366F1','#14B8A6','#E11D48','#84CC16','#0EA5E9','#D946EF','#FB923C'];

/* ═══ IndexedDB ═══ */
let db=null;
function openDB(){
  return new Promise((res,rej)=>{
    const req=indexedDB.open('WorkAnalyzerDB',2);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains('weeks')) d.createObjectStore('weeks',{keyPath:'id'});
      if(!d.objectStoreNames.contains('workRecords')) d.createObjectStore('workRecords',{autoIncrement:true});
    };
    req.onsuccess=e=>{db=e.target.result; res(db)};
    req.onerror=e=>rej(e);
  });
}

function wrBulkPut(records){
  return new Promise((res,rej)=>{
    const tx=db.transaction('workRecords','readwrite');
    const s=tx.objectStore('workRecords');
    s.clear();
    records.forEach(r=>s.put(r));
    tx.oncomplete=()=>res();
    tx.onerror=e=>rej(e);
  });
}

function wrGetAll(){
  return new Promise((res,rej)=>{
    const tx=db.transaction('workRecords','readonly');
    const req=tx.objectStore('workRecords').getAll();
    req.onsuccess=()=>res(req.result);
    req.onerror=e=>rej(e);
  });
}

/* ═══ FILTER LOGIC ═══ */
function gfInvalidate(){_gfDirty=true; _gfCache=null}

function gF(){
  if(!_gfDirty&&_gfCache) return _gfCache;
  if(sN.size===0){_gfCache=[]; _gfDirty=false; return _gfCache}
  let r=aD.filter(r=>sN.has(r.name));
  if(selWeek) r=r.filter(x=>x.date>=selWeek.start&&x.date<=selWeek.end);
  if(sO.size>0) r=r.filter(x=>sO.has(x.orderNo));
  if(sT.size>0) r=r.filter(x=>sT.has(x.abbr));
  if(sON.size>0) r=r.filter(x=>{
    const on=x.ocmt!==undefined?x.ocmt:(getOCmt(x.orderNo)||'(미지정)');
    return sON.has(on);
  });
  if(sCL.size>0) r=r.filter(x=>{
    const cl=x.oclient!==undefined?x.oclient:(getOClient(x.orderNo)||'(미지정)');
    return sCL.has(cl);
  });
  if(cKw){
    const k=cKw.toLowerCase();
    r=r.filter(x=>{
      const matchContent=x.content.toLowerCase().includes(k);
      const matchOcmt=(x.ocmt||getOCmt(x.orderNo)||'').toLowerCase().includes(k);
      const matchOcl=(x.oclient||getOClient(x.orderNo)||'').toLowerCase().includes(k);
      return matchContent||matchOcmt||matchOcl;
    });
  }
  _gfCache=r.sort((a,b)=>{
    const n=a.name.localeCompare(b.name,'ko');
    return n!==0?n:a.date.localeCompare(b.date);
  });
  _gfDirty=false; return _gfCache;
}

/* ═══ UTILS ═══ */
function fD(d){return d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)}
function eH(s){const d=document.createElement('div'); d.textContent=s; return d.innerHTML}
function lsSet(k,v){localStorage.setItem(k,v)}
function lsGet(k,d=''){return localStorage.getItem(k)||d}
function lsRemove(k){localStorage.removeItem(k)}
function lsSetJSON(k,v){localStorage.setItem(k,JSON.stringify(v))}
function lsGetJSON(k,d=[]){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}
