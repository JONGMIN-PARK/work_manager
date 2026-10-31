/* wm-state.js — 테마·폰트 적용(파싱 시점에 실행) · 주간 분석 전역 상태 · 공용 헬퍼(fD/eH/eA/pNormDate)
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ THEME (TH → config.js) ═══ */
let cTh='auto';
function gSysTh(){return matchMedia('(prefers-color-scheme:dark)').matches?'midnight':'light'}
function aTh(id){cTh=id;document.documentElement.setAttribute('data-theme',id==='auto'?gSysTh():id);rTh();lsSet('wa-theme',id);if(_wmFontReady)aFnt(cFnt)}  // 테마별 기본 글씨체(_wmFontFor) 반영 — 폰트 초기화 전(부팅 첫 호출)엔 건너뜀
var _wmFontReady=false;
/* 🎨 화면 설정 — 테마를 무리(TH.g)별 이름 있는 칸으로. 올리면 미리 보기, 누르면 적용 (v13.287) */
function rTh(){
  var cur=TH.find(function(t){return t.id===cTh})||TH[0];
  var dot=document.getElementById('hdrLookDot');if(dot)dot.style.background=cur.c;
  var bar=document.getElementById('themeBar');if(!bar)return;
  var html='',g=null;
  TH.forEach(function(t){
    if(t.g!==g){if(g!==null)html+='</div>';g=t.g;html+='<div class="thg-t">'+(g||'')+'</div><div class="thg">'}
    html+='<button class="thc'+(cTh===t.id?' on':'')+'" onclick="aTh(\''+t.id+'\')" onmouseenter="wmThPeek(\''+t.id+'\')" onmouseleave="wmThPeek()" title="'+t.l+'"><i class="thd" style="background:'+t.c+'"></i>'+t.l+'</button>';
  });
  bar.innerHTML=html+(g!==null?'</div>':'');
}
function wmThPeek(id){var v=id||cTh;document.documentElement.setAttribute('data-theme',v==='auto'?gSysTh():v)}
var _th=lsGet('wa-theme');if(_th)cTh=_th
aTh(cTh);matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{if(cTh==='auto')aTh('auto')});

/* ═══ FONT (FONTS → config.js) — 동적 Google Fonts 로드 + body 폰트 변경 ═══ */
let cFnt='noto';
/* 테마별 기본 글씨체 — 기본(노토)을 고른 상태에서 글래스 테마면 프리텐다드(흐린 배경에서 작은 글자가 더 또렷).
   사용자가 노토 외 글씨체를 직접 고르면 그대로. 저장값(wa-font)은 고른 글씨체 id 그대로 둔다 */
function _wmFontFor(id){ return (id==='noto' && document.documentElement.getAttribute('data-theme')==='glass') ? 'pretendard' : id; }
function aFnt(id){
  var FF = (typeof FONTS!=='undefined')?FONTS:[];
  var chosen = FF.find(function(x){return x.id===id}) || FF[0];
  if(!chosen) return;
  var f = FF.find(function(x){return x.id===_wmFontFor(chosen.id)}) || chosen;
  cFnt = chosen.id;
  // 동적 <link> 로드 (한 번만)
  if(!document.getElementById('fontLink_'+f.id)){
    var link = document.createElement('link');
    link.id = 'fontLink_'+f.id;
    link.rel = 'stylesheet';
    if(f.url){
      link.href = f.url;
    } else if(f.family){
      var primary = f.family.split(',')[0].replace(/['"]/g,'').trim();
      var w = f.weight || '400;700';
      link.href = 'https://fonts.googleapis.com/css2?family='+encodeURIComponent(primary).replace(/%20/g,'+')+':wght@'+w+'&display=swap';
    }
    document.head.appendChild(link);
  }
  document.documentElement.style.setProperty('--app-font', f.family + ',-apple-system,sans-serif');
  lsSet('wa-font', cFnt);
  rFnt();
}
function rFnt(){
  var bar=document.getElementById('fontBar');if(!bar)return;
  var FF = (typeof FONTS!=='undefined')?FONTS:[];
  // 그룹별로 묶어서 표시 (산세리프/세리프/표제/손글씨/코드)
  var groups = {};
  var order = [];
  FF.forEach(function(f){
    var g = f.group || '기타';
    if(!groups[g]){ groups[g]=[]; order.push(g); }
    groups[g].push(f);
  });
  var html = '';
  order.forEach(function(g){
    html += '<div class="fnd-group">'+g+'</div>';
    groups[g].forEach(function(f){
      var sub = (_wmFontFor(f.id)!==f.id) ? ' <span style="font-size:10px;opacity:.7">· 글래스 테마는 프리텐다드로 표시</span>' : '';
      html += '<div class="fnd '+(cFnt===f.id?'on':'')+'" onclick="aFnt(\''+f.id+'\')" title="'+f.l+'" style="font-family:'+f.family.replace(/"/g,'&quot;')+'">'+f.l+sub+'</div>';
    });
  });
  bar.innerHTML = html;
}
var _fnt=lsGet('wa-font');if(_fnt)aFnt(_fnt);else aFnt('noto');
_wmFontReady=true;
/* 헤더 · 툴바 펼침 메뉴(.hdr-pop) — 한 번에 하나만, 바깥 누르기 · Esc 로 닫음 (v13.287) */
function wmHdrPopClose(except){
  document.querySelectorAll('.hdr-pop.open').forEach(function(w){
    if(w===except)return;
    w.classList.remove('open');
    var b=w.querySelector('[aria-expanded]');if(b)b.setAttribute('aria-expanded','false');
    if(w.id==='hdrLookWrap')wmThPeek();  // 미리 보던 테마 되돌림
  });
}
function wmHdrPop(id){
  var w=document.getElementById(id);if(!w)return;
  wmHdrPopClose(w);
  var on=w.classList.toggle('open');
  var b=w.querySelector('[aria-expanded]');if(b)b.setAttribute('aria-expanded',on?'true':'false');
  if(on&&id==='hdrLookWrap'){var l=document.getElementById('fontBar'),c=l&&l.querySelector('.fnd.on');if(c)l.scrollTop=Math.max(0,c.offsetTop-l.clientHeight/2)}  // 고른 글씨체가 보이게
}
document.addEventListener('click',function(e){
  // 테마 · 글씨체를 누르면 목록을 다시 그려 누른 칸이 문서에서 빠짐 — 그때는 닫지 않고 계속 골라 보게
  if(e.target.isConnected===false||(e.target.closest&&e.target.closest('.hdr-pop')))return;
  wmHdrPopClose();
});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&document.querySelector('.hdr-pop.open'))wmHdrPopClose()});

/* ═══ CONSTS: config.js에서 로드 (TH, ENC, COL, AM, ABG, AFG, ABR, CMP_COL, CMP_DASH, CMP_PT, AI_CONFIG, DIFF_KEYWORDS, AI_PRESETS) ═══ */

/* ═══ STATE ═══ */
let aD=[],aN=[],vN=[];
let sN=new Set(),sO=new Set(),sT=new Set(),sON=new Set(),sCL=new Set(),sDV=new Set();
let cKw='',cEnc='euc-kr',lBuf=null;
let excludeVac=(function(){try{return localStorage.getItem('wm_excludeVac')==='1'}catch(e){return false}})();
let selWeek=null; // 선택된 주차 {start:'YYYYMMDD', end:'YYYYMMDD', label:'...'} or null=전체
let pC=null,bC=null,tC=null,clPieC=null,clDayC=null,mtrChart=null,mtrCChart=null,mtrLineChart=null,mtrCLineChart=null;
function destroyCharts(){[pC,bC,tC,clPieC,clDayC,mtrChart,mtrCChart,mtrLineChart,mtrCLineChart].forEach(function(c){if(c){try{c.destroy()}catch(e){}}});pC=bC=tC=clPieC=clDayC=mtrChart=mtrCChart=mtrLineChart=mtrCLineChart=null;cmpPieCharts.forEach(function(c){if(c){try{c.destroy()}catch(e){}}});cmpPieCharts=[];if(cmpBarChart){try{cmpBarChart.destroy()}catch(e){}}cmpBarChart=null;if(cmpLineChart){try{cmpLineChart.destroy()}catch(e){}}cmpLineChart=null}
var _upVTimer;
function upVD(){clearTimeout(_upVTimer);_upVTimer=setTimeout(upV,30)}
let avO=[],avT=[],avON=[],avCL=[],avDV=[];
var DEPT_LIST=['장비사업부','기술연구소','모션사업부'];
let fvN=[],fvO=false;
let aiProv='anthropic'; // v13.65: 기본 Claude — 서버 응답으로 자동 갱신
let archSel=null; // selected archive id for detail
var weekYearFilter=""; // 주차 선택기 연도 필터
var weekMonthFilter=""; // 주차 선택기 월 필터 (빈 문자열=전체)
var weekQtrFilter=""; // 주차 선택기 분기 필터 (빈 문자열=전체)
var archMonthFilter=""; // 아카이브 월 필터
var trendMonthFilter=""; // 트렌드 월 필터
let trendSel=new Set(); // selected week ids for trend

function fD(d){return d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)}
/* v13.189 따옴표까지 이스케이프 — 속성값(title="…", value="…")에 들어가도 안전. 이전 DOM 방식은 " ' 를 그대로 둬 저장형 XSS 가능 */
function eH(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
/* onclick="f('…')" 용 — JS 문자열 이스케이프 + 속성 구분자(") 보호 */
function eA(s){return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,'\\n').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}  // & 도 — &#39; 가 속성에서 ' 로 풀려 문자열을 탈출하던 것
/* style="background:…" 용 색 — #hex · rgb()/hsl() · 영문 이름만, 아니면 fb (서버 lib/safe-val.js 와 같은 규칙) */
function eC(c,fb){var s=String(c==null?'':c).trim();return /^#[0-9a-f]{3,8}$/i.test(s)||/^(rgb|hsl)a?\([\d\s.,%]+\)$/i.test(s)||/^[a-z]{3,20}$/i.test(s)?s:(fb||'#3B82F6')}
// HTML 테이블 파싱 (기존)
function pNormDate(v){
  if(v===undefined||v===null)return null;
  v=String(v).trim();
  if(!v)return null;
  // YYYYMMDD
  if(/^\d{8}$/.test(v))return v;
  // YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD (시간 정보 무시)
  var m=v.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if(m)return m[1]+m[2].padStart(2,'0')+m[3].padStart(2,'0');
  // YY-MM-DD, YY.MM.DD, YY/MM/DD
  m=v.match(/^(\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if(m){
    var y=parseInt(m[1]);
    y+=(y<70?2000:1900);
    return String(y)+m[2].padStart(2,'0')+m[3].padStart(2,'0');
  }
  // Excel serial number
  var n=Number(v);
  if(!isNaN(n)&&n>30000&&n<70000){
    // 30000=1982-02-18, 70000=2091-10-14
    var d=new Date(Math.round((n-25569)*86400000));
    // 타임존 보정 (UTC 기준 자정 부근 날짜 뒤틀림 방지)
    if(d.getHours()>20)d.setDate(d.getDate()+1);
    return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
  }
  return null;
}
