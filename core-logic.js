/* ═══ GLOBAL STATE ═══ */
let aD=[], aN=[], vN=[];
let sN=new Set(), sO=new Set(), sT=new Set(), sON=new Set(), sCL=new Set();
let cKw='', cEnc='euc-kr', lBuf=null;
let selWeek=null;
let _gfCache=null, _gfDirty=true;
let _tmpOcmt={}, _tmpOclient={};

/* ═══ 메모 HTML 헬퍼 (v13.35~ 메모 인라인 이미지 지원) ═══ */
/* 메모가 HTML 마크업을 포함하는지 휴리스틱 감지 — 평문 메모와 HTML 메모를 구분해 적절히 렌더 */
function isHtmlMemo(memo) {
  return /<(img|br|p|div|span|b|i|u|strong|em|a|ul|ol|li|h[1-6]|blockquote|code|pre)\b/i.test(memo || '');
}
/* 평문 메모를 안전한 HTML로: HTML 이스케이프 후 줄바꿈을 <br> 로 */
function plainToHtml(text) {
  if (!text) return '';
  var d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML.replace(/\n/g, '<br>');
}
/* 메모 HTML 화이트리스트 sanitizer — XSS 방지
   허용 태그: img/br/p/div/span/b/i/u/strong/em/a/ul/ol/li/h1~6/blockquote/code/pre
   허용 src: http(s):, data:image/...;
   허용 href: http(s):, mailto:, tel:, # */
function sanitizeMemo(html) {
  if (!html) return '';
  var ALLOWED = { IMG:1, BR:1, P:1, DIV:1, SPAN:1, B:1, I:1, U:1, STRONG:1, EM:1, A:1, UL:1, OL:1, LI:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, BLOCKQUOTE:1, CODE:1, PRE:1, HR:1 };
  var SRC_OK = /^(https?:|data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp);)/i;
  var HREF_OK = /^(https?:|mailto:|tel:|#)/i;
  var doc = new DOMParser().parseFromString('<div id="_root">' + html + '</div>', 'text/html');
  var root = doc.getElementById('_root');
  function walk(node) {
    if (!node) return;
    var children = Array.prototype.slice.call(node.childNodes);
    children.forEach(function (c) { walk(c); });
    if (node.nodeType !== 1 || node === root) return;
    var tag = node.tagName;
    if (!ALLOWED[tag]) {
      // 허용 안 된 태그는 자식만 보존하고 제거
      var p = node.parentNode;
      while (node.firstChild) p.insertBefore(node.firstChild, node);
      p.removeChild(node);
      return;
    }
    // 속성 화이트리스트
    var attrs = Array.prototype.slice.call(node.attributes);
    attrs.forEach(function (a) {
      var n = a.name.toLowerCase();
      var v = a.value;
      // 모든 이벤트 핸들러 제거
      if (n.indexOf('on') === 0) { node.removeAttribute(a.name); return; }
      if (tag === 'IMG' && n === 'src') { if (!SRC_OK.test(v)) node.removeAttribute(a.name); return; }
      if (tag === 'A' && n === 'href') { if (!HREF_OK.test(v)) node.removeAttribute(a.name); return; }
      if (n === 'alt' || n === 'title') return; // 안전
      if (n === 'style') {
        // 위험 패턴 제거 — javascript:, expression(, url(, @import
        var safe = String(v).replace(/javascript:|expression\s*\(|url\s*\(|@import/gi, '');
        node.setAttribute('style', safe);
        return;
      }
      if (n === 'class' || n === 'id' || n === 'target' || n === 'rel') return;
      // 그 외 속성 제거
      node.removeAttribute(a.name);
    });
    // <a target="_blank">에 rel="noopener" 강제
    if (tag === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
  walk(root);
  return root.innerHTML;
}
/* 메모를 표시용 HTML로 변환 — HTML이면 sanitize, 아니면 평문→HTML */
function memoToHtml(memo) {
  if (!memo) return '';
  return isHtmlMemo(memo) ? sanitizeMemo(memo) : plainToHtml(memo);
}

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
